# In-Place Resizable and Growable `ArrayBuffer`s

Stage: 4, [landed in the specification](https://github.com/tc39/ecma262/pull/3116).

Author: Shu-yu Guo (@syg)

Champion: Shu-yu Guo (@syg)

## Introduction

`ArrayBuffer`s have enabled in-memory handling of binary data and have enjoyed great success. This proposal extends the `ArrayBuffer` constructors to take an additional maximum length that allows in-place growth and shrinking of buffers. Similarly, `SharedArrayBuffer` is extended to take an additional maximum length that allows in-place growth.

## Motivation and use cases

### Better memory management

Growing a new buffer right now requires allocating a new buffer and copying. Not only is this inefficient, it needlessly fragments the address space on 32-bit systems.

### Sync up capability with WebAssembly memory.grow

WebAssembly memory can grow. Every time it does, wasm vends a new `ArrayBuffer` instance and detaches the old one. Any JS-side "pointers" into wasm memory would need to be updated when a grow happens. This is an [open problem](https://github.com/WebAssembly/design/issues/1296) and currently requires polling, which is super slow:

```javascript
// The backing buffer gets detached on every grow in wasm!
let U8 = new Uint8Array(WebAssembly.Memory.buffer);

function derefPointerIntoWasmMemory(idx) {
  // Do we need to re-create U8 because memory grew, causing the old buffer
  // to detach?
  if (U8.length === 0) {
    U8 = new Uint8Array(WebAssembly.Memory.buffer);
  }
  doSomethingWith(U8[idx]);
}
```

It also spurred proposals such as having a signal handler-like synchronous callback on growth events for wasm's JS API, which doesn't feel great due to the issues of signal handler re-entrancy being difficult to reason about.

Having growable `ArrayBuffer`s and auto-tracking TypedArrays would solve this problem more cleanly.

### WebGPU buffers

WebGPU would like to [repoint the same `ArrayBuffer` instances to different backing buffers](https://github.com/gpuweb/gpuweb/issues/747#issuecomment-642938376). This is important for performance during animations, as remaking `ArrayBuffer` instances multiple times per frame of animation incurs GC pressure and pauses.

Having a resizable `ArrayBuffer` would let WebGPU explain repointing as a resize + overwrite. Under the hood, browsers can implement WebGPU-vended resizable `ArrayBuffer`s as repointable without actually adding a repointable `ArrayBuffer` into the language.

## Proposal

### `ArrayBuffer`

```javascript
class ArrayBuffer {
  // If the options parameter is not an object with a "maxByteLength"
  // property, the ArrayBuffer can neither grow nor shrink (status quo).
  // Otherwise it is resizable.
  //
  // A resizable ArrayBuffer can grow up to the provided
  // options.maxByteLength and shrink.
  //
  // If options is an object with a "maxByteLength" property,
  // - Throws a RangeError if maxByteLength is not finite.
  // - Throws a RangeError if byteLength > maxByteLength.
  constructor(byteLength [, options ]);

  // Resizes the buffer.
  //
  // Grows are designed to be implemented in-place, i.e. address space is
  // reserved up front but the pages are not committed until grown.
  //
  // Shrinks are also designed to be in-place, with a length change and
  // no realloc.
  //
  // Throws a TypeError if the this value is not resizable.
  // Throws a RangeError unless 0 <= newByteLength <= this.maxByteLength.
  //
  // Can throw OOM.
  resize(newByteLength);

  // Returns a *non*-resizable ArrayBuffer.
  slice(start, end);

  // Returns true if the `this` value is resizable `ArrayBuffer`,
  // false otherwise.
  //
  // No setter.
  get resizable();

  // If resizable, returns the maximum byte length passed in during construction.
  // If not resizable, returns the byte length.
  //
  // No setter.
  get maxByteLength();

  // No setter.
  get byteLength();
}
```

### `SharedArrayBuffer`

```javascript
class SharedArrayBuffer {
  // If the options parameter is not an object with a "maxByteLength"
  // property, the SharedArrayBuffer cannot grow (status quo).
  // Otherwise it is growable.
  //
  // A growable SharedArrayBuffer can only grow up to the provided
  // options.maxByteLength.
  //
  // If options is an object with a "maxByteLength" property,
  // - Throws a RangeError if options.maxByteLength is not finite.
  // - Throws a RangeError if byteLength > options.maxByteLength.
  constructor(byteLength [, options ]);

  // Grows the buffer.
  //
  // Grows are designed to be implemented in-place, i.e. address space is
  // reserved up front but the pages are not committed until grown.
  //
  // Growable SharedArrayBuffers cannot shrink because it is real scary to
  // allow for shared memory.
  //
  // Throws a TypeError if the `this` value is not a growable
  // SharedArrayBuffer.
  // Throws a RangeError unless
  // this.byteLength <= newByteLength <= this.maxByteLength.
  //
  // Can throw OOM.
  grow(newByteLength);

  // Returns a *non*-growable SharedArrayBuffer.
  slice(start, end);

  // Returns true if the `this` value is a growable SharedArrayBuffer,
  // false otherwise.
  //
  // No setter.
  get growable();

  // If resizable, returns the maximum byte length passed in during construction.
  // If not resizable, returns the byte length.
  //
  // No setter.
  get maxByteLength();

  // No setter.
  get byteLength();
}
```

### Modifications to _TypedArray_

TypedArrays are extended to make use of these buffers. When a TypedArray is backed by a resizable buffer, its byte offset length may automatically change if the backing buffer is resized.

The _TypedArray_ (_buffer_, [, _byteOffset_ [, _length_ ] ] ) constructor is modified as follows:

- If _buffer_ is a resizable `ArrayBuffer` or a growable `SharedArrayBuffer`, if the _length_ is `undefined`, then the constructed TA automatically tracks the length of the backing buffer.

The length getter on _TypedArray_.prototype is modified as follows:

- If this TA is backed by a resizable `ArrayBuffer` or growable `SharedArrayBuffer` and is automatically tracking the length of the backing buffer, then return floor((buffer byte length - byte offset) / element size).
- If this TA is backed by a resizable `ArrayBuffer` and the length is out of bounds, then return 0.

All methods and internal methods that access indexed properties on TypedArrays are modified as follow:

- If this TA is backed by a resizable `ArrayBuffer` and the translated byte index on the backing buffer is out of bounds, return undefined.
- If this TA is backed by a resizable `ArrayBuffer` and the translated byte length is out of bounds, return 0.

This change generalizes the detachment check: if a fixed-length window on a backing buffer becomes out of bounds, either in whole or in part, due to resizing, treat it like a detached buffer.

This generalized bounds check is performed on every index access on TypedArrays backed by resizable `ArrayBuffer`.

Growable `SharedArrayBuffer`s can only grow, so TAs backed by growable `SharedArrayBuffer`s cannot go out of bounds.

An example:

```javascript
let rab = new ArrayBuffer(1024, { maxByteLength: 1024 ** 2 });
// 0 offset, auto length
let U32a = new Uint32Array(rab);
assert(U32a.length === 256); // (1024 - 0) / 4
rab.resize(1024 * 2);
assert(U32a.length === 512); // (2048 - 0) / 4

// Non-0 offset, auto length
let U32b = new Uint32Array(rab, 256);
assert(U32b.length === 448); // (2048 - 256) / 4
rab.resize(1024);
assert(U32b.length === 192); // (1024 - 256) / 4

// Non-0 offset, fixed length
let U32c = new Uint32Array(rab, 128, 4);
assert(U32c.length === 4);
rab.resize(1024 * 2);
assert(U32c.length === 4);

// If a resize makes any accessible part of a TA OOB, the TA acts like
// it's been detached.
rab.resize(256);
assertThrows(() => U32b[0]);
assert(U32b.length === 0);
rab.resize(132);
// U32c can address rab[128] to rab[144]. Being partially OOB still makes
// it act like it's been detached.
assertThrows(() => U32c[0]);
assert(U32c.length === 0);
// Resizing the underlying buffer can bring a TA back into bounds.
// New memory is zeroed.
rab.resize(1024);
assert(U32b[0] === 0);
assert(U32b.length === 192);
```

## Implementation

- Both resizable `ArrayBuffer` and growable `SharedArrayBuffer` are designed to be direct buffers where the virtual memory is reserved for the address range but not backed by physical memory until needed.

- TypedArrays that are backed by resizable and growable buffers have more complex, but similar-in-kind, logic to detachment checks. The performance expectation is that these TypedArrays will be slower than TypedArrays backed by fixed-size buffers. In tight loops, however, this generalized check is hoistable in the same way that the current detach check is hoistable.

- TypedArrays that are backed by resizable and growable buffers are recommended to have a distinct hidden class from TypedArrays backed by fixed-size buffers for maintainability of security-sensitive fast paths. This unfortunately makes use sites polymorphic. The slowdown from the polymorphism needs to be benchmarked.

## Security

`ArrayBuffer`s and TypedArrays are one of the most common attack vectors for web browsers. Resizability adds non-zero security risk to the platform in that bugs in bounds checking code for resizable buffers may be easily exploited.

This security risk is intrinsic to the proposal and is not entirely eliminable. This proposal tries to mitigate with the following design choices:

- Existing uses of `ArrayBuffer` and `SharedArrayBuffer` constructors remain fixed-length and are not retrofitted to be resizable. Internally the resizable buffer types may have different hidden classes so existing code paths can be kept separate
- Make partially OOB TypedArrays act like their buffers are detached instead of auto-updating the length
- Make in-place implementation always possible to limit data pointer moves

## FAQ and design rationale tradeoffs

### What happened to `transfer()`? It used to be here.

It has been separated into its [own proposal](https://github.com/syg/proposal-arraybuffer-transfer) to further explore the design space.

### Why not retrofit all `ArrayBuffer`s to be resizable?

Retrofitting the single-parameter `ArrayBuffer` instead of adding an explicit opt-in overload is hard because of both language and implementation concerns:

1. TypedArray views have particular offsets and lengths that would need to be updated. It is messy to determine what TAs' lengths should be updated. If growing, it seems like user intention needs to be taken into account, and those with explicitly provided lengths should not be updated. If shrinking, it seems like all views need to be updated. This would not only require tracking all created views but is not clean to reason about.
1. Browsers and VMs have battle-hardened code paths around existing TypedArrays and `ArrayBuffer`s, as they are the most popular way to attack browsers. By introducing new types, we hope to leave those existing paths alone. Otherwise we'd need to audit all existing paths, of which there are many because of web APIs' use of buffers, to ensure they handle the possibility of growth and shrinking. This is scary and is likely a security bug farm.

### Why require maximum length?

The API is designed to be implementable as an in-place growth. Non in-place growth (i.e. realloc) semantics presents more challenges for implementation as well as a bigger attack surface. In-place growth has the guarantee that the data pointer of the backing store does not move.

Under the hood, this means the backing store pointer can be made immovable. Note that this immovability of the data pointer is unobservable from within JS. For resizable `ArrayBuffer`s, it would be conformant, but possibly undesirable, to implement growth and shrinking as realloc. For growable `SharedArrayBuffer`s, due to memory model constraints, it is unlikely that a realloc implementation is possible.

### Why can't growable `SharedArrayBuffer` shrink?

Shrinking shared memory is scary and seems like a bad time.

### How would growable `SharedArrayBuffer` growth work with the memory model?

Growing a growable `SharedArrayBuffer` performs a SeqCst access on the buffer length. Explicit accesses to length, such as to the `byteLength` accessor, and built-in functions, such as `slice`, perform a SeqCst access on the buffer length. Bounds checks as part of indexed access, such as via `ta[idx]` and `Atomics.load(ta, idx)`, perform an Unordered access on the buffer length.

This aligns with WebAssembly as well as enable more optimization opportunities for bounds checking codegen. It also means that other threads are not guaranteed to see the grown length without synchronizing on an explicit length access, such as by reading the `byteLength` accessor.

## Open questions

### Should `resize(0)` be allowed?

~~Currently a length of 0 always denotes a detached buffer. Are there use cases for `resize(0)`? Should it mean detach if allowed? Or should the buffer be allowed to grow again afterwards?~~

https://github.com/tc39/proposal-resizablearraybuffer/issues/22 points out that `ArrayBuffer(0)` is already a thing. This proposal thus allows `resize(0)`.

## History and acknowledgment

Thanks to:
  - @lukewagner for the original straw-person https://gist.github.com/lukewagner/2735af7eea411e18cf20
  - @domenic for https://github.com/domenic/proposal-arraybuffer-transfer
  - @ulan for discussion and guidance of the implementation of ArrayBuffers in V8 and Chrome
  - @kainino0x for discussion of the WebGPU use case
  - @binji and @azakai for discussion of the WebAssembly use case
