'use strict';
let sdoBox = {
  init() {
    this.$alternativeId = null;
    this.$outer = document.createElement('div');
    this.$outer.classList.add('toolbox-container');
    this.$container = document.createElement('div');
    this.$container.classList.add('toolbox');
    this.$displayLink = document.createElement('a');
    this.$displayLink.setAttribute('href', '#');
    this.$displayLink.textContent = 'Syntax-Directed Operations';
    this.$displayLink.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      referencePane.showSDOs(sdoMap[this.$alternativeId] || {}, this.$alternativeId);
    });
    this.$container.appendChild(this.$displayLink);
    this.$outer.appendChild(this.$container);
    document.body.appendChild(this.$outer);
  },

  activate(el) {
    clearTimeout(this.deactiveTimeout);
    Toolbox.deactivate();
    this.$alternativeId = el.id;
    let numSdos = Object.keys(sdoMap[this.$alternativeId] || {}).length;
    this.$displayLink.textContent = 'Syntax-Directed Operations (' + numSdos + ')';
    this.$outer.classList.add('active');
    let top = el.offsetTop - this.$outer.offsetHeight;
    let left = el.offsetLeft + 50 - 10; // 50px = padding-left(=75px) + text-indent(=-25px)
    this.$outer.setAttribute('style', 'left: ' + left + 'px; top: ' + top + 'px');
    if (top < document.body.scrollTop) {
      this.$container.scrollIntoView();
    }
  },

  deactivate() {
    clearTimeout(this.deactiveTimeout);
    this.$outer.classList.remove('active');
  },
};

document.addEventListener('DOMContentLoaded', () => {
  if (typeof sdoMap == 'undefined') {
    console.error('could not find sdo map');
    return;
  }
  sdoBox.init();

  let insideTooltip = false;
  sdoBox.$outer.addEventListener('pointerenter', () => {
    insideTooltip = true;
  });
  sdoBox.$outer.addEventListener('pointerleave', () => {
    insideTooltip = false;
    sdoBox.deactivate();
  });

  sdoBox.deactiveTimeout = null;
  [].forEach.call(document.querySelectorAll('emu-grammar[type=definition] emu-rhs'), node => {
    node.addEventListener('pointerenter', function () {
      sdoBox.activate(this);
    });

    node.addEventListener('pointerleave', () => {
      sdoBox.deactiveTimeout = setTimeout(() => {
        if (!insideTooltip) {
          sdoBox.deactivate();
        }
      }, 500);
    });
  });

  document.addEventListener(
    'keydown',
    debounce(e => {
      if (e.code === 'Escape') {
        sdoBox.deactivate();
      }
    })
  );
});

'use strict';
function Search(menu) {
  this.menu = menu;
  this.$search = document.getElementById('menu-search');
  this.$searchBox = document.getElementById('menu-search-box');
  this.$searchResults = document.getElementById('menu-search-results');

  this.loadBiblio();

  document.addEventListener('keydown', this.documentKeydown.bind(this));

  this.$searchBox.addEventListener(
    'keydown',
    debounce(this.searchBoxKeydown.bind(this), { stopPropagation: true })
  );
  this.$searchBox.addEventListener(
    'keyup',
    debounce(this.searchBoxKeyup.bind(this), { stopPropagation: true })
  );

  // Perform an initial search if the box is not empty.
  if (this.$searchBox.value) {
    this.search(this.$searchBox.value);
  }
}

Search.prototype.loadBiblio = function () {
  if (typeof biblio === 'undefined') {
    console.error('could not find biblio');
    this.biblio = { refToClause: {}, entries: [] };
  } else {
    this.biblio = biblio;
    this.biblio.clauses = this.biblio.entries.filter(e => e.type === 'clause');
    this.biblio.byId = this.biblio.entries.reduce((map, entry) => {
      map[entry.id] = entry;
      return map;
    }, {});
    let refParentClause = Object.create(null);
    this.biblio.refParentClause = refParentClause;
    let refsByClause = this.biblio.refsByClause;
    Object.keys(refsByClause).forEach(clause => {
      refsByClause[clause].forEach(ref => {
        refParentClause[ref] = clause;
      });
    });
  }
};

Search.prototype.documentKeydown = function (e) {
  if (e.keyCode === 191) {
    e.preventDefault();
    e.stopPropagation();
    this.triggerSearch();
  }
};

Search.prototype.searchBoxKeydown = function (e) {
  e.stopPropagation();
  e.preventDefault();
  if (e.keyCode === 191 && e.target.value.length === 0) {
    e.preventDefault();
  } else if (e.keyCode === 13) {
    e.preventDefault();
    this.selectResult();
  }
};

Search.prototype.searchBoxKeyup = function (e) {
  if (e.keyCode === 13 || e.keyCode === 9) {
    return;
  }

  this.search(e.target.value);
};

Search.prototype.triggerSearch = function () {
  if (this.menu.isVisible()) {
    this._closeAfterSearch = false;
  } else {
    this._closeAfterSearch = true;
    this.menu.show();
  }

  this.$searchBox.focus();
  this.$searchBox.select();
};
// bit 12 - Set if the result starts with searchString
// bits 8-11: 8 - number of chunks multiplied by 2 if cases match, otherwise 1.
// bits 1-7: 127 - length of the entry
// General scheme: prefer case sensitive matches with fewer chunks, and otherwise
// prefer shorter matches.
function relevance(result) {
  let relevance = 0;

  relevance = Math.max(0, 8 - result.match.chunks) << 7;

  if (result.match.caseMatch) {
    relevance *= 2;
  }

  if (result.match.prefix) {
    relevance += 2048;
  }

  relevance += Math.max(0, 255 - result.key.length);

  return relevance;
}

Search.prototype.search = function (searchString) {
  if (searchString === '') {
    this.displayResults([]);
    this.hideSearch();
    return;
  } else {
    this.showSearch();
  }

  if (searchString.length === 1) {
    this.displayResults([]);
    return;
  }

  let results;

  if (/^[\d.]*$/.test(searchString)) {
    results = this.biblio.clauses
      .filter(clause => clause.number.substring(0, searchString.length) === searchString)
      .map(clause => ({ entry: clause }));
  } else {
    results = [];

    for (let i = 0; i < this.biblio.entries.length; i++) {
      let entry = this.biblio.entries[i];
      let key = getKey(entry);
      if (!key) {
        // biblio entries without a key aren't searchable
        continue;
      }

      let match = fuzzysearch(searchString, key);
      if (match) {
        results.push({ key, entry, match });
      }
    }

    results.forEach(result => {
      result.relevance = relevance(result, searchString);
    });

    results = results.sort((a, b) => b.relevance - a.relevance);
  }

  if (results.length > 50) {
    results = results.slice(0, 50);
  }

  this.displayResults(results);
};
Search.prototype.hideSearch = function () {
  this.$search.classList.remove('active');
};

Search.prototype.showSearch = function () {
  this.$search.classList.add('active');
};

Search.prototype.selectResult = function () {
  let $first = this.$searchResults.querySelector('li:first-child a');

  if ($first) {
    document.location = $first.getAttribute('href');
  }

  this.$searchBox.value = '';
  this.$searchBox.blur();
  this.displayResults([]);
  this.hideSearch();

  if (this._closeAfterSearch) {
    this.menu.hide();
  }
};

Search.prototype.displayResults = function (results) {
  if (results.length > 0) {
    this.$searchResults.classList.remove('no-results');

    let html = '<ul>';

    results.forEach(result => {
      let key = result.key;
      let entry = result.entry;
      let id = entry.id;
      let cssClass = '';
      let text = '';

      if (entry.type === 'clause') {
        let number = entry.number ? entry.number + ' ' : '';
        text = number + key;
        cssClass = 'clause';
        id = entry.id;
      } else if (entry.type === 'production') {
        text = key;
        cssClass = 'prod';
        id = entry.id;
      } else if (entry.type === 'op') {
        text = key;
        cssClass = 'op';
        id = entry.id || entry.refId;
      } else if (entry.type === 'term') {
        text = key;
        cssClass = 'term';
        id = entry.id || entry.refId;
      }

      if (text) {
        // prettier-ignore
        html += `<li class=menu-search-result-${cssClass}><a href="${makeLinkToId(id)}">${text}</a></li>`;
      }
    });

    html += '</ul>';

    this.$searchResults.innerHTML = html;
  } else {
    this.$searchResults.innerHTML = '';
    this.$searchResults.classList.add('no-results');
  }
};

function getKey(item) {
  if (item.key) {
    return item.key;
  }
  switch (item.type) {
    case 'clause':
      return item.title || item.titleHTML;
    case 'production':
      return item.name;
    case 'op':
      return item.aoid;
    case 'term':
      return item.term;
    case 'table':
    case 'figure':
    case 'example':
    case 'note':
      return item.caption;
    case 'step':
      return item.id;
    default:
      throw new Error("Can't get key for " + item.type);
  }
}

function Menu() {
  this.$toggle = document.getElementById('menu-toggle');
  this.$menu = document.getElementById('menu');
  this.$toc = document.querySelector('menu-toc > ol');
  this.$pins = document.querySelector('#menu-pins');
  this.$pinList = document.getElementById('menu-pins-list');
  this.$toc = document.querySelector('#menu-toc > ol');
  this.$specContainer = document.getElementById('spec-container');
  this.search = new Search(this);

  this._pinnedIds = {};
  this.loadPinEntries();

  // toggle menu
  this.$toggle.addEventListener('click', this.toggle.bind(this));

  // keydown events for pinned clauses
  document.addEventListener('keydown', this.documentKeydown.bind(this));

  // toc expansion
  let tocItems = this.$menu.querySelectorAll('#menu-toc li');
  for (let i = 0; i < tocItems.length; i++) {
    let $item = tocItems[i];
    $item.addEventListener('click', event => {
      $item.classList.toggle('active');
      event.stopPropagation();
    });
  }

  // close toc on toc item selection
  let tocLinks = this.$menu.querySelectorAll('#menu-toc li > a');
  for (let i = 0; i < tocLinks.length; i++) {
    let $link = tocLinks[i];
    $link.addEventListener('click', event => {
      this.toggle();
      event.stopPropagation();
    });
  }

  // update active clause on scroll
  window.addEventListener('scroll', debounce(this.updateActiveClause.bind(this)));
  this.updateActiveClause();

  // prevent menu scrolling from scrolling the body
  this.$toc.addEventListener('wheel', e => {
    let target = e.currentTarget;
    let offTop = e.deltaY < 0 && target.scrollTop === 0;
    if (offTop) {
      e.preventDefault();
    }
    let offBottom = e.deltaY > 0 && target.offsetHeight + target.scrollTop >= target.scrollHeight;

    if (offBottom) {
      e.preventDefault();
    }
  });
}

Menu.prototype.documentKeydown = function (e) {
  e.stopPropagation();
  if (e.keyCode === 80) {
    this.togglePinEntry();
  } else if (e.keyCode > 48 && e.keyCode < 58) {
    this.selectPin(e.keyCode - 49);
  }
};

Menu.prototype.updateActiveClause = function () {
  this.setActiveClause(findActiveClause(this.$specContainer));
};

Menu.prototype.setActiveClause = function (clause) {
  this.$activeClause = clause;
  this.revealInToc(this.$activeClause);
};

Menu.prototype.revealInToc = function (path) {
  let current = this.$toc.querySelectorAll('li.revealed');
  for (let i = 0; i < current.length; i++) {
    current[i].classList.remove('revealed');
    current[i].classList.remove('revealed-leaf');
  }

  current = this.$toc;
  let index = 0;
  outer: while (index < path.length) {
    let children = current.children;
    for (let i = 0; i < children.length; i++) {
      if ('#' + path[index].id === children[i].children[1].hash) {
        children[i].classList.add('revealed');
        if (index === path.length - 1) {
          children[i].classList.add('revealed-leaf');
          let rect = children[i].getBoundingClientRect();
          // this.$toc.getBoundingClientRect().top;
          let tocRect = this.$toc.getBoundingClientRect();
          if (rect.top + 10 > tocRect.bottom) {
            this.$toc.scrollTop =
              this.$toc.scrollTop + (rect.top - tocRect.bottom) + (rect.bottom - rect.top);
          } else if (rect.top < tocRect.top) {
            this.$toc.scrollTop = this.$toc.scrollTop - (tocRect.top - rect.top);
          }
        }
        current = children[i].querySelector('ol');
        index++;
        continue outer;
      }
    }
    console.log('could not find location in table of contents', path);
    break;
  }
};

function findActiveClause(root, path) {
  let clauses = getChildClauses(root);
  path = path || [];

  for (let $clause of clauses) {
    let rect = $clause.getBoundingClientRect();
    let $header = $clause.querySelector('h1');
    let marginTop = Math.max(
      parseInt(getComputedStyle($clause)['margin-top']),
      parseInt(getComputedStyle($header)['margin-top'])
    );

    if (rect.top - marginTop <= 1 && rect.bottom > 0) {
      return findActiveClause($clause, path.concat($clause)) || path;
    }
  }

  return path;
}

function* getChildClauses(root) {
  for (let el of root.children) {
    switch (el.nodeName) {
      // descend into <emu-import>
      case 'EMU-IMPORT':
        yield* getChildClauses(el);
        break;

      // accept <emu-clause>, <emu-intro>, and <emu-annex>
      case 'EMU-CLAUSE':
      case 'EMU-INTRO':
      case 'EMU-ANNEX':
        yield el;
    }
  }
}

Menu.prototype.toggle = function () {
  this.$menu.classList.toggle('active');
};

Menu.prototype.show = function () {
  this.$menu.classList.add('active');
};

Menu.prototype.hide = function () {
  this.$menu.classList.remove('active');
};

Menu.prototype.isVisible = function () {
  return this.$menu.classList.contains('active');
};

Menu.prototype.showPins = function () {
  this.$pins.classList.add('active');
};

Menu.prototype.hidePins = function () {
  this.$pins.classList.remove('active');
};

Menu.prototype.addPinEntry = function (id) {
  let entry = this.search.biblio.byId[id];
  if (!entry) {
    // id was deleted after pin (or something) so remove it
    delete this._pinnedIds[id];
    this.persistPinEntries();
    return;
  }

  if (entry.type === 'clause') {
    let prefix;
    if (entry.number) {
      prefix = entry.number + ' ';
    } else {
      prefix = '';
    }
    // prettier-ignore
    this.$pinList.innerHTML += `<li><a href="${makeLinkToId(entry.id)}">${prefix}${entry.titleHTML}</a></li>`;
  } else {
    this.$pinList.innerHTML += `<li><a href="${makeLinkToId(entry.id)}">${entry.key}</a></li>`;
  }

  if (Object.keys(this._pinnedIds).length === 0) {
    this.showPins();
  }
  this._pinnedIds[id] = true;
  this.persistPinEntries();
};

Menu.prototype.removePinEntry = function (id) {
  let item = this.$pinList.querySelector(`a[href="${makeLinkToId(id)}"]`).parentNode;
  this.$pinList.removeChild(item);
  delete this._pinnedIds[id];
  if (Object.keys(this._pinnedIds).length === 0) {
    this.hidePins();
  }

  this.persistPinEntries();
};

Menu.prototype.persistPinEntries = function () {
  try {
    if (!window.localStorage) return;
  } catch (e) {
    return;
  }

  localStorage.pinEntries = JSON.stringify(Object.keys(this._pinnedIds));
};

Menu.prototype.loadPinEntries = function () {
  try {
    if (!window.localStorage) return;
  } catch (e) {
    return;
  }

  let pinsString = window.localStorage.pinEntries;
  if (!pinsString) return;
  let pins = JSON.parse(pinsString);
  for (let i = 0; i < pins.length; i++) {
    this.addPinEntry(pins[i]);
  }
};

Menu.prototype.togglePinEntry = function (id) {
  if (!id) {
    id = this.$activeClause[this.$activeClause.length - 1].id;
  }

  if (this._pinnedIds[id]) {
    this.removePinEntry(id);
  } else {
    this.addPinEntry(id);
  }
};

Menu.prototype.selectPin = function (num) {
  document.location = this.$pinList.children[num].children[0].href;
};

let menu;

document.addEventListener('DOMContentLoaded', init);

function debounce(fn, opts) {
  opts = opts || {};
  let timeout;
  return function (e) {
    if (opts.stopPropagation) {
      e.stopPropagation();
    }
    let args = arguments;
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      timeout = null;
      fn.apply(this, args);
    }, 150);
  };
}

let CLAUSE_NODES = ['EMU-CLAUSE', 'EMU-INTRO', 'EMU-ANNEX'];
function findContainer($elem) {
  let parentClause = $elem.parentNode;
  while (parentClause && CLAUSE_NODES.indexOf(parentClause.nodeName) === -1) {
    parentClause = parentClause.parentNode;
  }
  return parentClause;
}

function findLocalReferences(parentClause, name) {
  let vars = parentClause.querySelectorAll('var');
  let references = [];

  for (let i = 0; i < vars.length; i++) {
    let $var = vars[i];

    if ($var.innerHTML === name) {
      references.push($var);
    }
  }

  return references;
}

let REFERENCED_CLASSES = Array.from({ length: 7 }, (x, i) => `referenced${i}`);
function chooseHighlightIndex(parentClause) {
  let counts = REFERENCED_CLASSES.map($class => parentClause.getElementsByClassName($class).length);
  // Find the earliest index with the lowest count.
  let minCount = Infinity;
  let index = null;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] < minCount) {
      minCount = counts[i];
      index = i;
    }
  }
  return index;
}

function toggleFindLocalReferences($elem) {
  let parentClause = findContainer($elem);
  let references = findLocalReferences(parentClause, $elem.innerHTML);
  if ($elem.classList.contains('referenced')) {
    references.forEach($reference => {
      $reference.classList.remove('referenced', ...REFERENCED_CLASSES);
    });
  } else {
    let index = chooseHighlightIndex(parentClause);
    references.forEach($reference => {
      $reference.classList.add('referenced', `referenced${index}`);
    });
  }
}

function installFindLocalReferences() {
  document.addEventListener('click', e => {
    if (e.target.nodeName === 'VAR') {
      toggleFindLocalReferences(e.target);
    }
  });
}

document.addEventListener('DOMContentLoaded', installFindLocalReferences);

// The following license applies to the fuzzysearch function
// The MIT License (MIT)
// Copyright © 2015 Nicolas Bevacqua
// Copyright © 2016 Brian Terlson
// Permission is hereby granted, free of charge, to any person obtaining a copy of
// this software and associated documentation files (the "Software"), to deal in
// the Software without restriction, including without limitation the rights to
// use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
// the Software, and to permit persons to whom the Software is furnished to do so,
// subject to the following conditions:

// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
// FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
// COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
// IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
// CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
function fuzzysearch(searchString, haystack, caseInsensitive) {
  let tlen = haystack.length;
  let qlen = searchString.length;
  let chunks = 1;
  let finding = false;

  if (qlen > tlen) {
    return false;
  }

  if (qlen === tlen) {
    if (searchString === haystack) {
      return { caseMatch: true, chunks: 1, prefix: true };
    } else if (searchString.toLowerCase() === haystack.toLowerCase()) {
      return { caseMatch: false, chunks: 1, prefix: true };
    } else {
      return false;
    }
  }

  let j = 0;
  outer: for (let i = 0; i < qlen; i++) {
    let nch = searchString[i];
    while (j < tlen) {
      let targetChar = haystack[j++];
      if (targetChar === nch) {
        finding = true;
        continue outer;
      }
      if (finding) {
        chunks++;
        finding = false;
      }
    }

    if (caseInsensitive) {
      return false;
    }

    return fuzzysearch(searchString.toLowerCase(), haystack.toLowerCase(), true);
  }

  return { caseMatch: !caseInsensitive, chunks, prefix: j <= qlen };
}

let referencePane = {
  init() {
    this.$container = document.createElement('div');
    this.$container.setAttribute('id', 'references-pane-container');

    let $spacer = document.createElement('div');
    $spacer.setAttribute('id', 'references-pane-spacer');

    this.$pane = document.createElement('div');
    this.$pane.setAttribute('id', 'references-pane');

    this.$container.appendChild($spacer);
    this.$container.appendChild(this.$pane);

    this.$header = document.createElement('div');
    this.$header.classList.add('menu-pane-header');
    this.$headerText = document.createElement('span');
    this.$header.appendChild(this.$headerText);
    this.$headerRefId = document.createElement('a');
    this.$header.appendChild(this.$headerRefId);
    this.$closeButton = document.createElement('span');
    this.$closeButton.setAttribute('id', 'references-pane-close');
    this.$closeButton.addEventListener('click', () => {
      this.deactivate();
    });
    this.$header.appendChild(this.$closeButton);

    this.$pane.appendChild(this.$header);
    let tableContainer = document.createElement('div');
    tableContainer.setAttribute('id', 'references-pane-table-container');

    this.$table = document.createElement('table');
    this.$table.setAttribute('id', 'references-pane-table');

    this.$tableBody = this.$table.createTBody();

    tableContainer.appendChild(this.$table);
    this.$pane.appendChild(tableContainer);

    menu.$specContainer.appendChild(this.$container);
  },

  activate() {
    this.$container.classList.add('active');
  },

  deactivate() {
    this.$container.classList.remove('active');
    this.state = null;
  },

  showReferencesFor(entry) {
    this.activate();
    this.state = { type: 'ref', id: entry.id };
    this.$headerText.textContent = 'References to ';
    let newBody = document.createElement('tbody');
    let previousId;
    let previousCell;
    let dupCount = 0;
    this.$headerRefId.textContent = '#' + entry.id;
    this.$headerRefId.setAttribute('href', makeLinkToId(entry.id));
    this.$headerRefId.style.display = 'inline';
    entry.referencingIds
      .map(id => {
        let cid = menu.search.biblio.refParentClause[id];
        let clause = menu.search.biblio.byId[cid];
        if (clause == null) {
          throw new Error('could not find clause for id ' + cid);
        }
        return { id, clause };
      })
      .sort((a, b) => sortByClauseNumber(a.clause, b.clause))
      .forEach(record => {
        if (previousId === record.clause.id) {
          previousCell.innerHTML += ` (<a href="${makeLinkToId(record.id)}">${dupCount + 2}</a>)`;
          dupCount++;
        } else {
          let row = newBody.insertRow();
          let cell = row.insertCell();
          cell.innerHTML = record.clause.number;
          cell = row.insertCell();
          cell.innerHTML = `<a href="${makeLinkToId(record.id)}">${record.clause.titleHTML}</a>`;
          previousCell = cell;
          previousId = record.clause.id;
          dupCount = 0;
        }
      }, this);
    this.$table.removeChild(this.$tableBody);
    this.$tableBody = newBody;
    this.$table.appendChild(this.$tableBody);
  },

  showSDOs(sdos, alternativeId) {
    let rhs = document.getElementById(alternativeId);
    let parentName = rhs.parentNode.getAttribute('name');
    let colons = rhs.parentNode.querySelector('emu-geq');
    rhs = rhs.cloneNode(true);
    rhs.querySelectorAll('emu-params,emu-constraints').forEach(e => {
      e.remove();
    });
    rhs.querySelectorAll('[id]').forEach(e => {
      e.removeAttribute('id');
    });
    rhs.querySelectorAll('a').forEach(e => {
      e.parentNode.replaceChild(document.createTextNode(e.textContent), e);
    });

    // prettier-ignore
    this.$headerText.innerHTML = `Syntax-Directed Operations for<br><a href="${makeLinkToId(alternativeId)}" class="menu-pane-header-production"><emu-nt>${parentName}</emu-nt> ${colons.outerHTML} </a>`;
    this.$headerText.querySelector('a').append(rhs);
    this.showSDOsBody(sdos, alternativeId);
  },

  showSDOsBody(sdos, alternativeId) {
    this.activate();
    this.state = { type: 'sdo', id: alternativeId, html: this.$headerText.innerHTML };
    this.$headerRefId.style.display = 'none';
    let newBody = document.createElement('tbody');
    Object.keys(sdos).forEach(sdoName => {
      let pair = sdos[sdoName];
      let clause = pair.clause;
      let ids = pair.ids;
      let first = ids[0];
      let row = newBody.insertRow();
      let cell = row.insertCell();
      cell.innerHTML = clause;
      cell = row.insertCell();
      let html = '<a href="' + makeLinkToId(first) + '">' + sdoName + '</a>';
      for (let i = 1; i < ids.length; ++i) {
        html += ' (<a href="' + makeLinkToId(ids[i]) + '">' + (i + 1) + '</a>)';
      }
      cell.innerHTML = html;
    });
    this.$table.removeChild(this.$tableBody);
    this.$tableBody = newBody;
    this.$table.appendChild(this.$tableBody);
  },
};

let Toolbox = {
  init() {
    this.$outer = document.createElement('div');
    this.$outer.classList.add('toolbox-container');
    this.$container = document.createElement('div');
    this.$container.classList.add('toolbox');
    this.$outer.appendChild(this.$container);
    this.$permalink = document.createElement('a');
    this.$permalink.textContent = 'Permalink';
    this.$pinLink = document.createElement('a');
    this.$pinLink.textContent = 'Pin';
    this.$pinLink.setAttribute('href', '#');
    this.$pinLink.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      menu.togglePinEntry(this.entry.id);
    });

    this.$refsLink = document.createElement('a');
    this.$refsLink.setAttribute('href', '#');
    this.$refsLink.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      referencePane.showReferencesFor(this.entry);
    });
    this.$container.appendChild(this.$permalink);
    this.$container.appendChild(this.$pinLink);
    this.$container.appendChild(this.$refsLink);
    document.body.appendChild(this.$outer);
  },

  activate(el, entry, target) {
    if (el === this._activeEl) return;
    sdoBox.deactivate();
    this.active = true;
    this.entry = entry;
    this.$outer.classList.add('active');
    this.top = el.offsetTop - this.$outer.offsetHeight;
    this.left = el.offsetLeft - 10;
    this.$outer.setAttribute('style', 'left: ' + this.left + 'px; top: ' + this.top + 'px');
    this.updatePermalink();
    this.updateReferences();
    this._activeEl = el;
    if (this.top < document.body.scrollTop && el === target) {
      // don't scroll unless it's a small thing (< 200px)
      this.$outer.scrollIntoView();
    }
  },

  updatePermalink() {
    this.$permalink.setAttribute('href', makeLinkToId(this.entry.id));
  },

  updateReferences() {
    this.$refsLink.textContent = `References (${this.entry.referencingIds.length})`;
  },

  activateIfMouseOver(e) {
    let ref = this.findReferenceUnder(e.target);
    if (ref && (!this.active || e.pageY > this._activeEl.offsetTop)) {
      let entry = menu.search.biblio.byId[ref.id];
      this.activate(ref.element, entry, e.target);
    } else if (
      this.active &&
      (e.pageY < this.top || e.pageY > this._activeEl.offsetTop + this._activeEl.offsetHeight)
    ) {
      this.deactivate();
    }
  },

  findReferenceUnder(el) {
    while (el) {
      let parent = el.parentNode;
      if (el.nodeName === 'EMU-RHS' || el.nodeName === 'EMU-PRODUCTION') {
        return null;
      }
      if (
        el.nodeName === 'H1' &&
        parent.nodeName.match(/EMU-CLAUSE|EMU-ANNEX|EMU-INTRO/) &&
        parent.id
      ) {
        return { element: el, id: parent.id };
      } else if (el.nodeName === 'EMU-NT') {
        if (
          parent.nodeName === 'EMU-PRODUCTION' &&
          parent.id &&
          parent.id[0] !== '_' &&
          parent.firstElementChild === el
        ) {
          // return the LHS non-terminal element
          return { element: el, id: parent.id };
        }
        return null;
      } else if (
        el.nodeName.match(/EMU-(?!CLAUSE|XREF|ANNEX|INTRO)|DFN/) &&
        el.id &&
        el.id[0] !== '_'
      ) {
        if (
          el.nodeName === 'EMU-FIGURE' ||
          el.nodeName === 'EMU-TABLE' ||
          el.nodeName === 'EMU-EXAMPLE'
        ) {
          // return the figcaption element
          return { element: el.children[0].children[0], id: el.id };
        } else {
          return { element: el, id: el.id };
        }
      }
      el = parent;
    }
  },

  deactivate() {
    this.$outer.classList.remove('active');
    this._activeEl = null;
    this.active = false;
  },
};

function sortByClauseNumber(clause1, clause2) {
  let c1c = clause1.number.split('.');
  let c2c = clause2.number.split('.');

  for (let i = 0; i < c1c.length; i++) {
    if (i >= c2c.length) {
      return 1;
    }

    let c1 = c1c[i];
    let c2 = c2c[i];
    let c1cn = Number(c1);
    let c2cn = Number(c2);

    if (Number.isNaN(c1cn) && Number.isNaN(c2cn)) {
      if (c1 > c2) {
        return 1;
      } else if (c1 < c2) {
        return -1;
      }
    } else if (!Number.isNaN(c1cn) && Number.isNaN(c2cn)) {
      return -1;
    } else if (Number.isNaN(c1cn) && !Number.isNaN(c2cn)) {
      return 1;
    } else if (c1cn > c2cn) {
      return 1;
    } else if (c1cn < c2cn) {
      return -1;
    }
  }

  if (c1c.length === c2c.length) {
    return 0;
  }
  return -1;
}

function makeLinkToId(id) {
  let hash = '#' + id;
  if (typeof idToSection === 'undefined' || !idToSection[id]) {
    return hash;
  }
  let targetSec = idToSection[id];
  return (targetSec === 'index' ? './' : targetSec + '.html') + hash;
}

let stylesheetWorkaroundForCanCallUserCodeAnnotation;

function doShortcut(e) {
  if (!(e.target instanceof HTMLElement)) {
    return;
  }
  let target = e.target;
  let name = target.nodeName.toLowerCase();
  if (name === 'textarea' || name === 'input' || name === 'select' || target.isContentEditable) {
    return;
  }
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) {
    return;
  }
  if (e.key === 'm' && usesMultipage) {
    let pathParts = location.pathname.split('/');
    let hash = location.hash;
    if (pathParts[pathParts.length - 2] === 'multipage') {
      if (hash === '') {
        let sectionName = pathParts[pathParts.length - 1];
        if (sectionName.endsWith('.html')) {
          sectionName = sectionName.slice(0, -5);
        }
        if (idToSection['sec-' + sectionName] !== undefined) {
          hash = '#sec-' + sectionName;
        }
      }
      location = pathParts.slice(0, -2).join('/') + '/' + hash;
    } else {
      location = 'multipage/' + hash;
    }
  } else if (e.key === 'u') {
    if (stylesheetWorkaroundForCanCallUserCodeAnnotation.innerText === '') {
      stylesheetWorkaroundForCanCallUserCodeAnnotation.textContent =
        'a.e-user-code::before { display: block !important; }';
    } else {
      stylesheetWorkaroundForCanCallUserCodeAnnotation.textContent = '';
    }
  }
}

function init() {
  menu = new Menu();
  let $container = document.getElementById('spec-container');
  $container.addEventListener(
    'mouseover',
    debounce(e => {
      Toolbox.activateIfMouseOver(e);
    })
  );
  document.addEventListener(
    'keydown',
    debounce(e => {
      if (e.code === 'Escape' && Toolbox.active) {
        Toolbox.deactivate();
      }
    })
  );
}

document.addEventListener('keypress', doShortcut);

document.addEventListener('DOMContentLoaded', () => {
  Toolbox.init();
  referencePane.init();
  stylesheetWorkaroundForCanCallUserCodeAnnotation = document.createElement('style');
  document.head.appendChild(stylesheetWorkaroundForCanCallUserCodeAnnotation);
});

'use strict';
let decimalBullet = Array.from({ length: 100 }, (a, i) => '' + (i + 1));
let alphaBullet = Array.from({ length: 26 }, (a, i) => String.fromCharCode('a'.charCodeAt(0) + i));

// prettier-ignore
let romanBullet = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi', 'xvii', 'xviii', 'xix', 'xx', 'xxi', 'xxii', 'xxiii', 'xxiv', 'xxv'];
// prettier-ignore
let bullets = [decimalBullet, alphaBullet, romanBullet, decimalBullet, alphaBullet, romanBullet];

function addStepNumberText(ol, parentIndex) {
  for (let i = 0; i < ol.children.length; ++i) {
    let child = ol.children[i];
    let index = parentIndex.concat([i]);
    let applicable = bullets[Math.min(index.length - 1, 5)];
    let span = document.createElement('span');
    span.textContent = (applicable[i] || '?') + '. ';
    span.style.fontSize = '0';
    span.setAttribute('aria-hidden', 'true');
    child.prepend(span);
    let sublist = child.querySelector('ol');
    if (sublist != null) {
      addStepNumberText(sublist, index);
    }
  }
}
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('emu-alg > ol').forEach(ol => {
    addStepNumberText(ol, []);
  });
});

let sdoMap = JSON.parse(`{}`);
let biblio = JSON.parse(`{"refsByClause":{"sec-get-arraybuffer-@@species":["_ref_0"],"sec-detacharraybuffer":["_ref_1","_ref_2","_ref_3","_ref_4"],"sec-allocatearraybuffer":["_ref_5","_ref_6"],"sec-arraybufferlength":["_ref_7","_ref_8","_ref_9","_ref_10"],"sec-makeidempotentarraybufferbytelengthgetter":["_ref_11","_ref_12"],"sec-isresizablearraybuffer":["_ref_13"],"sec-getarraybuffermaxbytelengthoption":["_ref_14","_ref_15","_ref_16"],"sec-hostresizearraybuffer":["_ref_17","_ref_18"],"sec-arraybuffer-length":["_ref_19","_ref_20","_ref_21"],"sec-get-arraybuffer.prototype.maxbytelength":["_ref_22","_ref_23","_ref_24","_ref_25"],"sec-get-arraybuffer.prototype.resizable":["_ref_26","_ref_27","_ref_28"],"sec-arraybuffer.prototype.slice":["_ref_29","_ref_30","_ref_31","_ref_32","_ref_33","_ref_34","_ref_35","_ref_36","_ref_37","_ref_38","_ref_39","_ref_40"],"sec-arraybuffer.prototype.resize":["_ref_41","_ref_42","_ref_43","_ref_44","_ref_45","_ref_46"],"sec-arraybuffer.prototype.transfer":["_ref_47","_ref_48","_ref_49","_ref_50","_ref_51","_ref_52","_ref_53"],"sec-allocatesharedarraybuffer":["_ref_54","_ref_55","_ref_56","_ref_57"],"sec-hostgrowsharedarraybuffer":["_ref_58","_ref_59","_ref_60","_ref_61"],"sec-sharedarraybuffer-length":["_ref_62","_ref_63","_ref_64"],"sec-get-sharedarraybuffer.prototype.bytelength":["_ref_65","_ref_66","_ref_67"],"sec-get-sharedarraybuffer.prototype.growable":["_ref_68","_ref_69","_ref_70"],"sec-get-sharedarraybuffer.prototype.maxbytelength":["_ref_71","_ref_72","_ref_73"],"sec-sharedarraybuffer.prototype.grow":["_ref_74","_ref_75","_ref_76","_ref_77","_ref_78","_ref_79"],"sec-sharedarraybuffer.prototype.slice":["_ref_80","_ref_81","_ref_82","_ref_83","_ref_84","_ref_85","_ref_86","_ref_87","_ref_88"],"sec-integer-indexed-exotic-objects-ownpropertykeys":["_ref_89","_ref_90","_ref_91","_ref_92","_ref_93","_ref_94","_ref_95"],"sec-isvalidintegerindex":["_ref_96","_ref_97","_ref_98"],"sec-integerindexedobjectbytelength":["_ref_99"],"sec-integerindexedobjectlength":["_ref_100","_ref_101"],"sec-isintegerindexedobjectoutofbounds":["_ref_102"],"sec-validatetypedarray":["_ref_103","_ref_104","_ref_105","_ref_106"],"sec-get-%typedarray%.prototype.bytelength":["_ref_107","_ref_108","_ref_109","_ref_110"],"sec-get-%typedarray%.prototype.byteoffset":["_ref_111","_ref_112","_ref_113","_ref_114"],"sec-get-%typedarray%.prototype.length":["_ref_115","_ref_116","_ref_117","_ref_118"],"sec-%typedarray%.prototype.copywithin":["_ref_119","_ref_120","_ref_121","_ref_122","_ref_123","_ref_124","_ref_125","_ref_126"],"sec-%typedarray%.prototype.fill":["_ref_127","_ref_128","_ref_129","_ref_130","_ref_131","_ref_132","_ref_133","_ref_134","_ref_135","_ref_136"],"sec-%typedarray%.prototype.slice":["_ref_137","_ref_138","_ref_139","_ref_140","_ref_141","_ref_142","_ref_143","_ref_144","_ref_145","_ref_146","_ref_147","_ref_148","_ref_149"],"sec-%typedarray%.prototype.sort":["_ref_150","_ref_151","_ref_152","_ref_153","_ref_154","_ref_155","_ref_156","_ref_157","_ref_158","_ref_159"],"sec-settypedarrayfromtypedarray":["_ref_160","_ref_161","_ref_162","_ref_163","_ref_164","_ref_165","_ref_166","_ref_167","_ref_168","_ref_169","_ref_170","_ref_171","_ref_172","_ref_173","_ref_174","_ref_175"],"sec-initializetypedarrayfromtypedarray":["_ref_176","_ref_177","_ref_178","_ref_179","_ref_180","_ref_181","_ref_182","_ref_183","_ref_184","_ref_185","_ref_186","_ref_187","_ref_188"],"sec-initializetypedarrayfromarraybuffer":["_ref_189","_ref_190","_ref_191","_ref_192","_ref_193"],"sec-getviewbytelength":["_ref_194"],"sec-isviewoutofbounds":["_ref_195","_ref_196","_ref_197"],"sec-getviewvalue":["_ref_198","_ref_199","_ref_200","_ref_201","_ref_202","_ref_203","_ref_204","_ref_205"],"sec-setviewvalue":["_ref_206","_ref_207","_ref_208","_ref_209","_ref_210","_ref_211","_ref_212","_ref_213","_ref_214","_ref_215","_ref_216"],"sec-dataview-buffer-byteoffset-bytelength":["_ref_217","_ref_218","_ref_219","_ref_220","_ref_221","_ref_222","_ref_223","_ref_224","_ref_225","_ref_226"],"sec-get-dataview.prototype.bytelength":["_ref_227","_ref_228","_ref_229","_ref_230","_ref_231"],"sec-get-dataview.prototype.byteoffset":["_ref_232","_ref_233","_ref_234","_ref_235"],"sec-validateatomicaccess":["_ref_236","_ref_237","_ref_238"],"omitted-for-brevity":["_ref_239","_ref_240"]},"entries":[{"type":"clause","id":"intro","aoid":null,"titleHTML":"Resizable ArrayBuffer and growable SharedArrayBuffer","number":"","referencingIds":[]},{"type":"op","aoid":"DetachArrayBuffer","refId":"sec-detacharraybuffer","referencingIds":[]},{"type":"clause","id":"sec-detacharraybuffer","aoid":"DetachArrayBuffer","title":"DetachArrayBuffer ( arrayBuffer [ , key ] )","titleHTML":"DetachArrayBuffer ( <var>arrayBuffer</var> [ , <var>key</var> ] )","number":"1.1.1","referencingIds":["_ref_53"]},{"type":"op","aoid":"AllocateArrayBuffer","refId":"sec-allocatearraybuffer","referencingIds":[]},{"type":"clause","id":"sec-allocatearraybuffer","aoid":"AllocateArrayBuffer","title":"AllocateArrayBuffer ( constructor, byteLength [ , maxByteLength ] )","titleHTML":"AllocateArrayBuffer ( <var>constructor</var>, <var>byteLength</var> [ , <var>maxByteLength</var> ] )","number":"1.1.2","referencingIds":["_ref_20","_ref_21","_ref_184"]},{"type":"op","aoid":"ArrayBufferByteLength","refId":"sec-arraybufferlength","referencingIds":[]},{"type":"clause","id":"sec-arraybufferlength","aoid":"ArrayBufferByteLength","title":"ArrayBufferByteLength ( arrayBuffer, order )","titleHTML":"ArrayBufferByteLength ( <var>arrayBuffer</var>, <var>order</var> )","number":"1.1.3","referencingIds":["_ref_11","_ref_67","_ref_82","_ref_193","_ref_220","_ref_240"]},{"type":"op","aoid":"MakeIdempotentArrayBufferByteLengthGetter","refId":"sec-makeidempotentarraybufferbytelengthgetter","referencingIds":[]},{"type":"clause","id":"sec-makeidempotentarraybufferbytelengthgetter","aoid":"MakeIdempotentArrayBufferByteLengthGetter","title":"MakeIdempotentArrayBufferByteLengthGetter ( order )","titleHTML":"MakeIdempotentArrayBufferByteLengthGetter ( <var>order</var> )","number":"1.1.4","referencingIds":["_ref_91","_ref_97","_ref_105","_ref_109","_ref_113","_ref_117","_ref_120","_ref_122","_ref_128","_ref_133","_ref_138","_ref_142","_ref_158","_ref_161","_ref_177","_ref_202","_ref_213","_ref_226","_ref_229","_ref_234","_ref_236"]},{"type":"op","aoid":"IsResizableArrayBuffer","refId":"sec-isresizablearraybuffer","referencingIds":[]},{"type":"clause","id":"sec-isresizablearraybuffer","aoid":"IsResizableArrayBuffer","title":"IsResizableArrayBuffer ( arrayBuffer )","titleHTML":"IsResizableArrayBuffer ( <var>arrayBuffer</var> )","number":"1.1.5","referencingIds":["_ref_25","_ref_28","_ref_70","_ref_73","_ref_101","_ref_190","_ref_221"]},{"type":"clause","id":"sec-getarraybuffermaxbytelengthoption","aoid":null,"title":"GetArrayBufferMaxByteLengthOption ( options )","titleHTML":"GetArrayBufferMaxByteLengthOption ( <var>options</var> )","number":"1.1.6","referencingIds":[]},{"type":"op","aoid":"HostResizeArrayBuffer","refId":"sec-hostresizearraybuffer","referencingIds":[]},{"type":"clause","id":"sec-hostresizearraybuffer","aoid":"HostResizeArrayBuffer","title":"HostResizeArrayBuffer ( buffer, newByteLength )","titleHTML":"HostResizeArrayBuffer ( <var>buffer</var>, <var>newByteLength</var> )","number":"1.1.7","referencingIds":["_ref_44","_ref_61"]},{"type":"clause","id":"sec-abstract-operations-for-arraybuffer-objects-mods","aoid":null,"titleHTML":"Modifications to Abstract Operations for ArrayBuffer Objects","number":"1.1","referencingIds":[]},{"type":"clause","id":"sec-arraybuffer-length","aoid":null,"title":"ArrayBuffer ( length[ , options ] )","titleHTML":"ArrayBuffer ( <var>length</var><ins>[ , <var>options</var> ]</ins> )","number":"1.2.1","referencingIds":[]},{"type":"clause","id":"sec-arraybuffer-constructor","aoid":null,"titleHTML":"The ArrayBuffer Constructor","number":"1.2","referencingIds":["_ref_33","_ref_51","_ref_170","_ref_171","_ref_181","_ref_182"]},{"type":"clause","id":"sec-get-arraybuffer-@@species","aoid":null,"titleHTML":"get ArrayBuffer [ @@species ]","number":"1.3.1","referencingIds":[]},{"type":"clause","id":"sec-get-arraybuffer.prototype.maxbytelength","aoid":null,"titleHTML":"get ArrayBuffer.prototype.maxByteLength","number":"1.3.2","referencingIds":[]},{"type":"clause","id":"sec-get-arraybuffer.prototype.resizable","aoid":null,"titleHTML":"get ArrayBuffer.prototype.resizable","number":"1.3.3","referencingIds":[]},{"type":"clause","id":"sec-arraybuffer.prototype.slice","aoid":null,"title":"ArrayBuffer.prototype.slice ( start, end )","titleHTML":"ArrayBuffer.prototype.slice ( <var>start</var>, <var>end</var> )","number":"1.3.4","referencingIds":["_ref_0"]},{"type":"clause","id":"sec-arraybuffer.prototype.resize","aoid":null,"title":"ArrayBuffer.prototype.resize ( newLength )","titleHTML":"ArrayBuffer.prototype.resize ( <var>newLength</var> )","number":"1.3.5","referencingIds":[]},{"type":"clause","id":"sec-arraybuffer.prototype.transfer","aoid":null,"title":"ArrayBuffer.prototype.transfer ( [ newLength ] )","titleHTML":"ArrayBuffer.prototype.transfer ( [ <var>newLength</var> ] )","number":"1.3.6","referencingIds":[]},{"type":"clause","id":"sec-properties-of-the-arraybuffer-prototype-object-mods","aoid":null,"titleHTML":"Modifications to the Properties of the ArrayBuffer Prototype Object","number":"1.3","referencingIds":[]},{"type":"clause","id":"sec-arraybuffer-objects-mods","aoid":null,"titleHTML":"Modifications to ArrayBuffer Objects","number":"1","referencingIds":[]},{"type":"op","aoid":"AllocateSharedArrayBuffer","refId":"sec-allocatesharedarraybuffer","referencingIds":[]},{"type":"clause","id":"sec-allocatesharedarraybuffer","aoid":"AllocateSharedArrayBuffer","title":"AllocateSharedArrayBuffer ( constructor, byteLength [ , maxByteLength ] )","titleHTML":"AllocateSharedArrayBuffer ( <var>constructor</var>, <var>byteLength</var> [ , <var>maxByteLength</var> ] )","number":"2.1.1","referencingIds":["_ref_63","_ref_64"]},{"type":"op","aoid":"HostGrowSharedArrayBuffer","refId":"sec-hostgrowsharedarraybuffer","referencingIds":[]},{"type":"clause","id":"sec-hostgrowsharedarraybuffer","aoid":"HostGrowSharedArrayBuffer","title":"HostGrowSharedArrayBuffer ( buffer, newByteLength )","titleHTML":"HostGrowSharedArrayBuffer ( <var>buffer</var>, <var>newByteLength</var> )","number":"2.1.2","referencingIds":["_ref_76"]},{"type":"clause","id":"sec-abstract-operations-for-sharedarraybuffer-objects-mods","aoid":null,"titleHTML":"Modifications to Abstract Operations for SharedArrayBuffer Objects","number":"2.1","referencingIds":[]},{"type":"clause","id":"sec-sharedarraybuffer-length","aoid":null,"title":"SharedArrayBuffer ( length[ , options ] )","titleHTML":"SharedArrayBuffer ( <var>length</var><ins>[ , <var>options</var> ]</ins> )","number":"2.2.1","referencingIds":[]},{"type":"clause","id":"sec-sharedarraybuffer-constructor","aoid":null,"titleHTML":"The SharedArrayBuffer Constructor","number":"2.2","referencingIds":["_ref_84"]},{"type":"clause","id":"sec-get-sharedarraybuffer.prototype.bytelength","aoid":null,"titleHTML":"get SharedArrayBuffer.prototype.byteLength","number":"2.3.1","referencingIds":[]},{"type":"clause","id":"sec-get-sharedarraybuffer.prototype.growable","aoid":null,"titleHTML":"get SharedArrayBuffer.prototype.growable","number":"2.3.2","referencingIds":[]},{"type":"clause","id":"sec-get-sharedarraybuffer.prototype.maxbytelength","aoid":null,"titleHTML":"get SharedArrayBuffer.prototype.maxByteLength","number":"2.3.3","referencingIds":[]},{"type":"clause","id":"sec-sharedarraybuffer.prototype.grow","aoid":null,"title":"SharedArrayBuffer.prototype.grow ( newLength )","titleHTML":"SharedArrayBuffer.prototype.grow ( <var>newLength</var> )","number":"2.3.4","referencingIds":[]},{"type":"clause","id":"sec-sharedarraybuffer.prototype.slice","aoid":null,"title":"SharedArrayBuffer.prototype.slice ( start, end )","titleHTML":"SharedArrayBuffer.prototype.slice ( <var>start</var>, <var>end</var> )","number":"2.3.5","referencingIds":[]},{"type":"clause","id":"sec-properties-of-the-sharedarraybuffer-prototype-object-mods","aoid":null,"titleHTML":"Modifications to the Properties of the SharedArrayBuffer Prototype Object","number":"2.3","referencingIds":[]},{"type":"clause","id":"sec-sharedarraybuffer-objects-mods","aoid":null,"titleHTML":"Modifications to SharedArrayBuffer Objects","number":"2","referencingIds":[]},{"type":"clause","id":"sec-integer-indexed-exotic-objects-ownpropertykeys","aoid":null,"titleHTML":"[[OwnPropertyKeys]] ( )","number":"3.1","referencingIds":[]},{"type":"op","aoid":"IsValidIntegerIndex","refId":"sec-isvalidintegerindex","referencingIds":[]},{"type":"clause","id":"sec-isvalidintegerindex","aoid":"IsValidIntegerIndex","title":"IsValidIntegerIndex ( O, index )","titleHTML":"IsValidIntegerIndex ( <var>O</var>, <var>index</var> )","number":"3.2","referencingIds":[]},{"type":"op","aoid":"IntegerIndexedObjectByteLength","refId":"sec-integerindexedobjectbytelength","referencingIds":[]},{"type":"clause","id":"sec-integerindexedobjectbytelength","aoid":"IntegerIndexedObjectByteLength","title":"IntegerIndexedObjectByteLength ( O, getBufferByteLength )","titleHTML":"IntegerIndexedObjectByteLength ( <var>O</var>, <var>getBufferByteLength</var> )","number":"3.3","referencingIds":["_ref_110","_ref_168"]},{"type":"op","aoid":"IntegerIndexedObjectLength","refId":"sec-integerindexedobjectlength","referencingIds":[]},{"type":"clause","id":"sec-integerindexedobjectlength","aoid":"IntegerIndexedObjectLength","title":"IntegerIndexedObjectLength ( O, getBufferByteLength )","titleHTML":"IntegerIndexedObjectLength ( <var>O</var>, <var>getBufferByteLength</var> )","number":"3.4","referencingIds":["_ref_92","_ref_98","_ref_99","_ref_118","_ref_121","_ref_123","_ref_129","_ref_134","_ref_139","_ref_143","_ref_162","_ref_178","_ref_237","_ref_239"]},{"type":"op","aoid":"IsIntegerIndexedObjectOutOfBounds","refId":"sec-isintegerindexedobjectoutofbounds","referencingIds":[]},{"type":"clause","id":"sec-isintegerindexedobjectoutofbounds","aoid":"IsIntegerIndexedObjectOutOfBounds","title":"IsIntegerIndexedObjectOutOfBounds ( O, getBufferByteLength )","titleHTML":"IsIntegerIndexedObjectOutOfBounds ( <var>O</var>, <var>getBufferByteLength</var> )","number":"3.5","referencingIds":["_ref_100","_ref_106","_ref_114","_ref_159","_ref_164","_ref_186"]},{"type":"clause","id":"sec-integer-indexed-exotic-objects-mods","aoid":null,"titleHTML":"Modifications to Integer-Indexed Exotic Objects","number":"3","referencingIds":[]},{"type":"op","aoid":"ValidateTypedArray","refId":"sec-validatetypedarray","referencingIds":[]},{"type":"clause","id":"sec-validatetypedarray","aoid":"ValidateTypedArray","title":"ValidateTypedArray ( O )","titleHTML":"ValidateTypedArray ( <var>O</var> )","number":"4.1.1","referencingIds":["_ref_119","_ref_127","_ref_137","_ref_151"]},{"type":"clause","id":"sec-get-%typedarray%.prototype.bytelength","aoid":null,"titleHTML":"get %TypedArray%.prototype.byteLength","number":"4.1.2","referencingIds":[]},{"type":"clause","id":"sec-get-%typedarray%.prototype.byteoffset","aoid":null,"titleHTML":"get %TypedArray%.prototype.byteOffset","number":"4.1.3","referencingIds":[]},{"type":"clause","id":"sec-get-%typedarray%.prototype.length","aoid":null,"titleHTML":"get %TypedArray%.prototype.length","number":"4.1.4","referencingIds":[]},{"type":"clause","id":"sec-%typedarray%.prototype.copywithin","aoid":null,"title":"%TypedArray%.prototype.copyWithin ( target, start [ , end ] )","titleHTML":"%TypedArray%.prototype.copyWithin ( <var>target</var>, <var>start</var> [ , <var>end</var> ] )","number":"4.1.5","referencingIds":[]},{"type":"clause","id":"sec-%typedarray%.prototype.fill","aoid":null,"title":"%TypedArray%.prototype.fill ( value [ , start [ , end ] ] )","titleHTML":"%TypedArray%.prototype.fill ( <var>value</var> [ , <var>start</var> [ , <var>end</var> ] ] )","number":"4.1.6","referencingIds":[]},{"type":"clause","id":"sec-%typedarray%.prototype.slice","aoid":null,"title":"%TypedArray%.prototype.slice ( start, end )","titleHTML":"%TypedArray%.prototype.slice ( <var>start</var>, <var>end</var> )","number":"4.1.7","referencingIds":[]},{"type":"clause","id":"sec-%typedarray%.prototype.sort","aoid":null,"title":"%TypedArray%.prototype.sort ( comparefn )","titleHTML":"%TypedArray%.prototype.sort ( <var>comparefn</var> )","number":"4.1.8","referencingIds":[]},{"type":"op","aoid":"SetTypedArrayFromTypedArray","refId":"sec-settypedarrayfromtypedarray","referencingIds":[]},{"type":"clause","id":"sec-settypedarrayfromtypedarray","aoid":"SetTypedArrayFromTypedArray","title":"SetTypedArrayFromTypedArray ( target, targetOffset, source )","titleHTML":"SetTypedArrayFromTypedArray ( <var>target</var>, <var>targetOffset</var>, <var>source</var> )","number":"4.1.9","referencingIds":[]},{"type":"clause","id":"sec-properties-of-the-%typedarrayprototype%-object-mods","aoid":null,"titleHTML":"Modifications to Properties of the %TypedArray.prototype% Object","number":"4.1","referencingIds":[]},{"type":"op","aoid":"InitializeTypedArrayFromTypedArray","refId":"sec-initializetypedarrayfromtypedarray","referencingIds":[]},{"type":"clause","id":"sec-initializetypedarrayfromtypedarray","aoid":"InitializeTypedArrayFromTypedArray","title":"InitializeTypedArrayFromTypedArray ( O, srcArray )","titleHTML":"InitializeTypedArrayFromTypedArray ( <var>O</var>, <var>srcArray</var> )","number":"4.2.1","referencingIds":[]},{"type":"op","aoid":"InitializeTypedArrayFromArrayBuffer","refId":"sec-initializetypedarrayfromarraybuffer","referencingIds":[]},{"type":"clause","id":"sec-initializetypedarrayfromarraybuffer","aoid":"InitializeTypedArrayFromArrayBuffer","title":"InitializeTypedArrayFromArrayBuffer ( O, buffer, byteOffset, length )","titleHTML":"InitializeTypedArrayFromArrayBuffer ( <var>O</var>, <var>buffer</var>, <var>byteOffset</var>, <var>length</var> )","number":"4.2.2","referencingIds":[]},{"type":"clause","id":"sec-typedarray-constructors-mods","aoid":null,"title":"Modifications to the TypedArray Constructors","titleHTML":"Modifications to the <var>TypedArray</var> Constructors","number":"4.2","referencingIds":[]},{"type":"clause","id":"sec-typedarray-objects-mods","aoid":null,"titleHTML":"Modifications to TypedArray Objects","number":"4","referencingIds":[]},{"type":"op","aoid":"GetViewByteLength","refId":"sec-getviewbytelength","referencingIds":[]},{"type":"clause","id":"sec-getviewbytelength","aoid":"GetViewByteLength","title":"GetViewByteLength ( view, getBufferByteLength )","titleHTML":"GetViewByteLength ( <var>view</var>, <var>getBufferByteLength</var> )","number":"5.1.1","referencingIds":["_ref_197","_ref_204","_ref_215","_ref_231"]},{"type":"op","aoid":"IsViewOutOfBounds","refId":"sec-isviewoutofbounds","referencingIds":[]},{"type":"clause","id":"sec-isviewoutofbounds","aoid":"IsViewOutOfBounds","title":"IsViewOutOfBounds ( view, getBufferByteLength )","titleHTML":"IsViewOutOfBounds ( <var>view</var>, <var>getBufferByteLength</var> )","number":"5.1.2","referencingIds":["_ref_203","_ref_214","_ref_230","_ref_235"]},{"type":"op","aoid":"GetViewValue","refId":"sec-getviewvalue","referencingIds":[]},{"type":"clause","id":"sec-getviewvalue","aoid":"GetViewValue","title":"GetViewValue ( view, requestIndex, isLittleEndian, type )","titleHTML":"GetViewValue ( <var>view</var>, <var>requestIndex</var>, <var>isLittleEndian</var>, <var>type</var> )","number":"5.1.3","referencingIds":[]},{"type":"op","aoid":"SetViewValue","refId":"sec-setviewvalue","referencingIds":[]},{"type":"clause","id":"sec-setviewvalue","aoid":"SetViewValue","title":"SetViewValue ( view, requestIndex, isLittleEndian, type, value )","titleHTML":"SetViewValue ( <var>view</var>, <var>requestIndex</var>, <var>isLittleEndian</var>, <var>type</var>, <var>value</var> )","number":"5.1.4","referencingIds":[]},{"type":"clause","id":"sec-abstract-operations-for-dataview-objects-mods","aoid":null,"titleHTML":"Modifications to Abstract Operations For DataView Objects","number":"5.1","referencingIds":[]},{"type":"clause","id":"sec-dataview-buffer-byteoffset-bytelength","aoid":null,"title":"DataView ( buffer [ , byteOffset [ , byteLength ] ] )","titleHTML":"DataView ( <var>buffer</var> [ , <var>byteOffset</var> [ , <var>byteLength</var> ] ] )","number":"5.2.1","referencingIds":[]},{"type":"clause","id":"sec-dataview-constructor-mods","aoid":null,"titleHTML":"Modifications to the DataView Constructor","number":"5.2","referencingIds":[]},{"type":"clause","id":"sec-get-dataview.prototype.bytelength","aoid":null,"titleHTML":"get DataView.prototype.byteLength","number":"5.3.1","referencingIds":[]},{"type":"clause","id":"sec-get-dataview.prototype.byteoffset","aoid":null,"titleHTML":"get DataView.prototype.byteOffset","number":"5.3.2","referencingIds":[]},{"type":"clause","id":"sec-properties-of-the-dataview-prototype-object-mods","aoid":null,"titleHTML":"Modifications to Properties of the DataView Prototype Object","number":"5.3","referencingIds":[]},{"type":"clause","id":"sec-dataview-objects-mods","aoid":null,"titleHTML":"Modifications to DataView Objects","number":"5","referencingIds":[]},{"type":"op","aoid":"ValidateAtomicAccess","refId":"sec-validateatomicaccess","referencingIds":[]},{"type":"clause","id":"sec-validateatomicaccess","aoid":"ValidateAtomicAccess","title":"ValidateAtomicAccess ( typedArray, requestIndex )","titleHTML":"ValidateAtomicAccess ( <var>typedArray</var>, <var>requestIndex</var> )","number":"6.1","referencingIds":[]},{"type":"clause","id":"sec-abstract-operations-for-atomics-mods","aoid":null,"titleHTML":"Modifications to Abstract Operations for Atomics","number":"6","referencingIds":[]},{"type":"clause","id":"sec-maxbytelength-guidelines","aoid":null,"titleHTML":"Resizable ArrayBuffer and growable SharedArrayBuffer Guidelines","number":"7","referencingIds":[]},{"type":"clause","id":"omitted-for-brevity","aoid":null,"titleHTML":"Mechanical Changes Omitted for Brevity","number":"8","referencingIds":[]}]}`);
;let usesMultipage = false