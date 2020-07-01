# In-Place Resizable and Growable `ArrayBuffer`s

Stage: 0

Author: Shu-yu Guo (@syg)

Champion: Shu-yu Guo (@syg)

## Introduction

`ArrayBuffer`s have enabled in-memory handling of binary data and have enjoyed great success. This proposal adds new expressivity with two new types, `ResizableArrayBuffer` and `GrowableSharedArrayBuffer`, that allow in-place growth and shrinking of buffers. The `transfer` method is also re-introduced here as a standard way to detach `ArrayBuffer`s, perform zero-copy moves, and to "fix" `ResizableArrayBuffer` instances to `ArrayBuffer` instances.

## Proposal

### `ResizableArrayBuffer`

```javascript
class ResizableArrayBuffer {
  // Both parameters are required.
  //
  // The ResizableArrayBuffer can only grow up to the provided
  // maximumByteLength.
  constructor(byteLength, maximumByteLength);

  // Returns a *non*-resizable ArrayBuffer with the same byte content
  // at this buffer for [0, min(this.byteLength, newByteLength)],
  // then detaches this buffer.
  //
  // Any new memory is zeroed.
  //
  // Designed to be implementable as a copy-free move or a realloc.
  //
  // Throws a TypeError if resizableAB is not a ResizableArrayBuffer.
  // Throws a RangeError unless 0 < newByteLength.
  static transfer(resizableAB, newByteLength);

  // Resizes the buffer.
  //
  // Grows are designed to be implemented in-place, i.e. address space is
  // reserved up front but the pages are not committed until grown.
  //
  // Shrinks are also designed to be in-place, with a length change and
  // no realloc.
  //
  // Throws a RangeError unless 1 < newByteLength < this.maximumByteLength.
  //
  // Can throw OOM.
  resize(newByteLength);

  // Returns a *non*-resizable ArrayBuffer.
  slice(start, end);

  // No setter.
  get maximumByteLength();

  // No setter.
  get byteLength();
}
```

`ResizableArrayBuffer` is detachable, like `ArrayBuffer`. Once detached, `ResizableArrayBuffer` instances remain detached and throw on access, like `ArrayBuffer` instances.

`ResizableArrayBuffer#transfer` may be used to "fix" resizable buffers in a zero-copy move to normal `ArrayBuffer`s.

Example:

```javascript
let rab = new ResizableArrayBuffer(1024, 1024 ** 2);
assert(rab.byteLength === 1024);
assert(rab.maximumByteLength === 1024 ** 2);

rab.resize(rab.byteLength * 2);
assert(rab.byteLength === 1024 * 2);

// Transfer the first 1024 bytes.
let ab = ResizableArrayBuffer.transfer(rab, 1024);
// rab is now detached
assert(rab.byteLength === 0);
assert(rab.maximumByteLength === 0);

// The contents are moved to ab.
assert(ab instanceof ArrayBuffer);
assert(ab.byteLength === 1024);
```

### `GrowableSharedArrayBuffer`

```javascript
class GrowableSharedArrayBuffer {
  // Both parameters are required.
  //
  // The GrowableSharedArrayBuffer can only grow up to the provided
  // maximumByteLength.
  constructor(byteLength, maximumByteLength);

  // Grows the buffer.
  //
  // Grows are designed to be implemented in-place, i.e. address space is
  // reserved up front but the pages are not committed until grown.
  //
  // GrowableSharedArrayBuffers cannot shrink because it is real scary to
  // allow for shared memory.
  //
  // Throws a RangeError unless
  // this.byteLength < newByteLength < this.maximumByteLength.
  //
  // Can throw OOM.
  grow(newByteLength);

  // Returns a *non*-growable SharedArrayBuffer.
  slice(start, end);

  // No setter.
  get maximumByteLength();

  // No setter.
  get byteLength();
}
```

### ArrayBuffer#transfer

Add a `transfer` method to `ArrayBuffer` for symmetry:

```javascript
class ArrayBuffer {
  // ...

  // Returns a ArrayBuffer with the same byte content
  // at this buffer for [0, min(this.byteLength, newByteLength)],
  // then detaches this buffer.
  //
  // Any new memory is zeroed.
  //
  // Designed to be implementable as a copy-free move or a realloc.
  //
  // Throws a TypeError if arrayBuffer is not an ArrayBuffer.
  // Throws a RangeError unless 0 < newByteLength < this.byteLength.
  static transfer(arrayBuffer, newByteLength);

  // ...
}
```

### Modifications to the _TypedArray_ constructor

TypedArrays are extended to make use of these buffers. When a TypedArray is backed by a resizable buffer, its byte offset is always 0 and its length always automatically tracks the byte length of the underlying buffer.

These new buffers can only be used with these new kinds of TypedArrays.

The _TypedArray_ (_buffer_, [, _byteOffset_ [, _length_ ] ] ) constructor is modified as follows:

- If _buffer_ is a `ResizableArrayBuffer` or a `GrowableSharedArrayBuffer`, throw a TypeError unless either _byteOffset_ is not undefined and is not 0 and _length_ is not undefined.

_TypedArray_s backed by `ResizableArrayBuffer` or `GrowableSharedArrayBuffer` have the following modifications to its length getter on _TypedArray_.prototype:

- If this buffer is backed by a `ResizableArrayBuffer` or `GrowableSharedArrayBuffer`, return floor(buffer byte length / element size).

An example:

```javascript
let rab = new ResizableArrayBuffer(1024, 1024 ** 2);
let U32 = new Uint32Array(rab);
assert(U32.length === 256);
rab.resize(1024 * 2);
assert(U32.length === 512);

assertThrows(() => { new Uint32Array(rab, 4, 512); });
assertThrows(() => { new Uint32Array(rab, 4); });
```

## Motivation and use cases

### Better memory management

Growing a new buffer right now requires allocating a new buffer and copying. Not only is this inefficient, it needlessly fragments the address space on 32-bit systems.

### Sync up capability with WebAssembly memory.grow

WebAssembly memory can grow. Every time it does, vends a new `ArrayBuffer` instance and detaches the old one. Any JS-side "pointers" into wasm memory would need to be updated when a grow happens. Imagine something like the following:

This is an [open problem](https://github.com/WebAssembly/design/issues/1296) and currently requires polling, which is super slow:

```javascript
// The backing buffer gets detached on every grow in wasm!
let U8 = new Uint8Array(WebAssembly.Memory.buffer);

function derefPointerIntoWasmMemory(idx) {
  // Do we need to re-create U8 because memory grew?
  if (U8.length === 0) {
    U8 = new Uint8Array(WebAssembly.Memory.buffer);
  }
  doSomethingWith(U8[idx]);
}
```

It also spurred proposals such as having a signal handler-like synchronous callback on growth events for wasm's JS API, which doesn't feel great due to the issues of signal handler re-entrancy being difficult to reason about.

Having growable `ArrayBuffer`s and auto-tracking _TypedArray_s would solve this problem more cleanly.

### WebGPU buffers

WebGPU would like to [repoint the same `ArrayBuffer` instances to different backing buffers](https://github.com/gpuweb/gpuweb/issues/747#issuecomment-642938376). This is important for performance during animations, as remaking `ArrayBuffer` instances multiple times per frame of animation stresses the GC.

Having a `ResizableArrayBuffer` would let WebGPU explain repointing as a resize + overwrite. Under the hood, browsers can implement WebGPU-vended `ResizableArrayBuffer`s as repointable without actually adding a repointable `ArrayBuffer` into the language.

## Implementation

- Both `ResizableArrayBuffer` and `GrowableSharedArrayBuffer` are designed to be direct buffers where the virtual memory is reserved for the address range but not backed by physical memory until needed.

- _TypedArray_s that are backed by resizable and growable buffers have more complex, but similar-in-kind, logic to detachment checks. The performance expectation is that these _TypedArray_s will be slower than _TypedArray_s backed by fixed-size buffers.

- _TypedArray_s that are backed by resizable and growable buffers are recommended to have a distinct hidden class from _TypedArray_s backed by fixed-size buffers for maintainability of security-sensitive fast paths. This unfortunately makes use sites polymorphic.

## FAQ and design rationale tradeoffs

### Why not retrofit `ArrayBuffer`s to be resizable?

Retrofitting `ArrayBuffer` is hard because of both language and implementation concerns:

1. _TypedArray_ views have particular offsets and lengths that would need to be updated. It is messy to determine what TAs' lengths should be updated. If growing, it seems like user intention needs to be taken into account, and those with explicitly provided lengths should not be updated. If shrinking, it seems like all views need to be updated. This would not only require tracking all created views but is not clean to reason about.
1. Browsers and VMs have battle-hardened code paths around existing _TypedArray_s and `ArrayBuffer`s, as they are the most popular way to attack browsers. By introducing new types, we hope to leave those existing paths alone. Otherwise we'd need to audit all existing paths, of which there are many because of web APIs' use of buffers, to ensure they handle the possibility of growth and shrinking. This is scary and is likely a security bug farm.

### Why require maximum length?

The API is designed to be implementable as an in-place growth. Non in-place growth (i.e. realloc) semantics presents more challenges for implementation as well as a bigger attack surface. In-place growth has the guarantee that the data pointer of the backing store does not move.

### Why can't `GrowableSharedArrayBuffer` shrink?

Shrinking shared memory is scary and seems like a bad time.

### How would `GrowableSharedArrayBuffer` growth work with the memory model?

We'll probably make `byteLength` accesses synchronize-with growth events. Will ultimately converge with wasm here.

## History and acknowledgment

Thanks to:
  - @lukewagner for the OG proposal https://gist.github.com/lukewagner/2735af7eea411e18cf20
  - @domenic for https://github.com/domenic/proposal-arraybuffer-transfer
  - @ulan for discussion and guidance of the implementation of ArrayBuffers in V8 and Chrome
  - @kainino0x for discussion of the WebGPU use case
  - @binji and @azakai for discussion of the WebAssembly use case
