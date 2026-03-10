var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ObjectLinksPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian4 = require("obsidian");

// src/parser.ts
function parseMultiObjectFile(content, filePath) {
  const lines = content.split("\n");
  let startIdx = 0;
  if (lines.length > 0 && lines[0].trim() === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        startIdx = i + 1;
        break;
      }
    }
  }
  let keyLine = "";
  for (let i = startIdx; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0)
      continue;
    if (trimmed.startsWith("#") && !trimmed.includes(":"))
      continue;
    keyLine = trimmed;
    break;
  }
  const keyMatch = keyLine.match(/^key:\s*(.+)$/i);
  if (!keyMatch)
    return null;
  const keyProperty = keyMatch[1].trim();
  const fileLabel = filePath.replace(/^.*\//, "").replace(/\.md$/i, "");
  const objects = [];
  let currentBlock = null;
  let passedFirstSeparator = false;
  for (let i = startIdx; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "---") {
      if (currentBlock && passedFirstSeparator) {
        const obj = parseBlock(currentBlock, keyProperty, filePath, fileLabel);
        if (obj)
          objects.push(obj);
      }
      passedFirstSeparator = true;
      currentBlock = { lines: [], startLine: i + 1 };
      continue;
    }
    if (currentBlock && passedFirstSeparator) {
      currentBlock.lines.push(trimmed);
    }
  }
  if (currentBlock && passedFirstSeparator) {
    const obj = parseBlock(currentBlock, keyProperty, filePath, fileLabel);
    if (obj)
      objects.push(obj);
  }
  if (objects.length === 0)
    return null;
  return { keyProperty, objects, filePath };
}
function parseBlock(block, keyProperty, filePath, fileLabel) {
  const properties = {};
  const propertyOrder = [];
  for (const line of block.lines) {
    if (!line)
      continue;
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1)
      continue;
    const prop = line.substring(0, colonIndex).trim();
    const val = line.substring(colonIndex + 1).trim();
    if (prop && val) {
      properties[prop] = val;
      propertyOrder.push(prop);
    }
  }
  const keyValue = properties[keyProperty];
  if (!keyValue)
    return null;
  const rawId = properties["id"];
  if (!rawId)
    return null;
  const id2 = Number(rawId);
  if (isNaN(id2))
    return null;
  return {
    keyValue,
    displayKey: keyValue,
    // default; disambiguated later in fullRefresh()
    id: id2,
    properties,
    propertyOrder,
    filePath,
    fileLabel,
    startLine: block.startLine
  };
}
function getSecondProperty(obj, keyProperty) {
  for (const prop of obj.propertyOrder) {
    if (prop === keyProperty || prop === "id")
      continue;
    const val = obj.properties[prop];
    if (val)
      return val;
  }
  return null;
}
function extractObjectLinks(content) {
  const links = [];
  const regex = /\{\{([^}]+)\}\}/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    let linkTarget = match[1];
    const pipeIndex = linkTarget.indexOf("|");
    if (pipeIndex !== -1) {
      linkTarget = linkTarget.substring(0, pipeIndex);
    }
    links.push(linkTarget.trim());
  }
  return links;
}
function extractWikilinks(content) {
  const links = [];
  const regex = /\[\[([^\]]+)\]\]/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    let linkTarget = match[1];
    const pipeIndex = linkTarget.indexOf("|");
    if (pipeIndex !== -1) {
      linkTarget = linkTarget.substring(0, pipeIndex);
    }
    links.push(linkTarget.trim());
  }
  return links;
}

// src/graph-data.ts
function buildGraph(parsedFiles, allFiles) {
  const nodes = [];
  const edges = [];
  const edgeSet = /* @__PURE__ */ new Set();
  const nodeMap = /* @__PURE__ */ new Map();
  const multiObjectPaths = new Set(parsedFiles.map((f) => f.filePath));
  const objKeyToNodeId = /* @__PURE__ */ new Map();
  const basenameToPath = /* @__PURE__ */ new Map();
  for (const f of allFiles) {
    basenameToPath.set(f.basename.toLowerCase(), f.path);
  }
  for (const file of parsedFiles) {
    for (const obj of file.objects) {
      const nodeId = `obj::${file.filePath}::${obj.displayKey}`;
      const node = {
        id: nodeId,
        label: obj.displayKey,
        type: "object",
        filePath: obj.filePath,
        fileLabel: obj.fileLabel,
        properties: obj.properties,
        startLine: obj.startLine,
        connections: 0
      };
      nodes.push(node);
      nodeMap.set(nodeId, node);
      objKeyToNodeId.set(obj.displayKey.toLowerCase(), nodeId);
      const plain = obj.keyValue.toLowerCase();
      if (!objKeyToNodeId.has(plain)) {
        objKeyToNodeId.set(plain, nodeId);
      }
    }
  }
  function ensureFileNode(path, basename) {
    const nodeId = `file::${path}`;
    if (!nodeMap.has(nodeId)) {
      const node = {
        id: nodeId,
        label: basename,
        type: "file",
        filePath: path,
        fileLabel: basename,
        properties: {},
        startLine: 0,
        connections: 0
      };
      nodes.push(node);
      nodeMap.set(nodeId, node);
    }
    return nodeId;
  }
  function addEdge(src, tgt, type2) {
    const edgeId = [src, tgt].sort().join("--");
    if (edgeSet.has(edgeId))
      return;
    edgeSet.add(edgeId);
    edges.push({ source: src, target: tgt, edgeType: type2 });
  }
  for (const file of allFiles) {
    if (multiObjectPaths.has(file.path))
      continue;
    const objectLinks = extractObjectLinks(file.content);
    const wikilinks = extractWikilinks(file.content);
    let fileNodeId = null;
    for (const link of objectLinks) {
      const targetObjId = objKeyToNodeId.get(link.toLowerCase());
      if (targetObjId) {
        if (!fileNodeId)
          fileNodeId = ensureFileNode(file.path, file.basename);
        addEdge(fileNodeId, targetObjId, "object");
      }
    }
    for (const link of wikilinks) {
      const targetPath = basenameToPath.get(link.toLowerCase());
      if (!targetPath)
        continue;
      if (multiObjectPaths.has(targetPath))
        continue;
      const targetFile = allFiles.find((f) => f.path === targetPath);
      if (!targetFile)
        continue;
      if (!fileNodeId)
        fileNodeId = ensureFileNode(file.path, file.basename);
      const targetFileId = ensureFileNode(targetPath, targetFile.basename);
      if (fileNodeId !== targetFileId) {
        addEdge(fileNodeId, targetFileId, "wiki");
      }
    }
  }
  for (const file of parsedFiles) {
    for (const obj of file.objects) {
      const srcId = `obj::${file.filePath}::${obj.displayKey}`;
      for (const val of Object.values(obj.properties)) {
        for (const link of extractObjectLinks(val)) {
          const tgtId = objKeyToNodeId.get(link.toLowerCase());
          if (tgtId && tgtId !== srcId) {
            addEdge(srcId, tgtId, "object");
          }
        }
      }
    }
  }
  for (const edge of edges) {
    const src = nodeMap.get(edge.source);
    const tgt = nodeMap.get(edge.target);
    if (src)
      src.connections++;
    if (tgt)
      tgt.connections++;
  }
  return { nodes, edges };
}

// src/graph-view.ts
var import_obsidian2 = require("obsidian");

// node_modules/d3-dispatch/src/dispatch.js
var noop = { value: () => {
} };
function dispatch() {
  for (var i = 0, n = arguments.length, _ = {}, t; i < n; ++i) {
    if (!(t = arguments[i] + "") || t in _ || /[\s.]/.test(t))
      throw new Error("illegal type: " + t);
    _[t] = [];
  }
  return new Dispatch(_);
}
function Dispatch(_) {
  this._ = _;
}
function parseTypenames(typenames, types) {
  return typenames.trim().split(/^|\s+/).map(function(t) {
    var name = "", i = t.indexOf(".");
    if (i >= 0)
      name = t.slice(i + 1), t = t.slice(0, i);
    if (t && !types.hasOwnProperty(t))
      throw new Error("unknown type: " + t);
    return { type: t, name };
  });
}
Dispatch.prototype = dispatch.prototype = {
  constructor: Dispatch,
  on: function(typename, callback) {
    var _ = this._, T = parseTypenames(typename + "", _), t, i = -1, n = T.length;
    if (arguments.length < 2) {
      while (++i < n)
        if ((t = (typename = T[i]).type) && (t = get(_[t], typename.name)))
          return t;
      return;
    }
    if (callback != null && typeof callback !== "function")
      throw new Error("invalid callback: " + callback);
    while (++i < n) {
      if (t = (typename = T[i]).type)
        _[t] = set(_[t], typename.name, callback);
      else if (callback == null)
        for (t in _)
          _[t] = set(_[t], typename.name, null);
    }
    return this;
  },
  copy: function() {
    var copy = {}, _ = this._;
    for (var t in _)
      copy[t] = _[t].slice();
    return new Dispatch(copy);
  },
  call: function(type2, that) {
    if ((n = arguments.length - 2) > 0)
      for (var args = new Array(n), i = 0, n, t; i < n; ++i)
        args[i] = arguments[i + 2];
    if (!this._.hasOwnProperty(type2))
      throw new Error("unknown type: " + type2);
    for (t = this._[type2], i = 0, n = t.length; i < n; ++i)
      t[i].value.apply(that, args);
  },
  apply: function(type2, that, args) {
    if (!this._.hasOwnProperty(type2))
      throw new Error("unknown type: " + type2);
    for (var t = this._[type2], i = 0, n = t.length; i < n; ++i)
      t[i].value.apply(that, args);
  }
};
function get(type2, name) {
  for (var i = 0, n = type2.length, c2; i < n; ++i) {
    if ((c2 = type2[i]).name === name) {
      return c2.value;
    }
  }
}
function set(type2, name, callback) {
  for (var i = 0, n = type2.length; i < n; ++i) {
    if (type2[i].name === name) {
      type2[i] = noop, type2 = type2.slice(0, i).concat(type2.slice(i + 1));
      break;
    }
  }
  if (callback != null)
    type2.push({ name, value: callback });
  return type2;
}
var dispatch_default = dispatch;

// node_modules/d3-selection/src/namespaces.js
var xhtml = "http://www.w3.org/1999/xhtml";
var namespaces_default = {
  svg: "http://www.w3.org/2000/svg",
  xhtml,
  xlink: "http://www.w3.org/1999/xlink",
  xml: "http://www.w3.org/XML/1998/namespace",
  xmlns: "http://www.w3.org/2000/xmlns/"
};

// node_modules/d3-selection/src/namespace.js
function namespace_default(name) {
  var prefix = name += "", i = prefix.indexOf(":");
  if (i >= 0 && (prefix = name.slice(0, i)) !== "xmlns")
    name = name.slice(i + 1);
  return namespaces_default.hasOwnProperty(prefix) ? { space: namespaces_default[prefix], local: name } : name;
}

// node_modules/d3-selection/src/creator.js
function creatorInherit(name) {
  return function() {
    var document2 = this.ownerDocument, uri = this.namespaceURI;
    return uri === xhtml && document2.documentElement.namespaceURI === xhtml ? document2.createElement(name) : document2.createElementNS(uri, name);
  };
}
function creatorFixed(fullname) {
  return function() {
    return this.ownerDocument.createElementNS(fullname.space, fullname.local);
  };
}
function creator_default(name) {
  var fullname = namespace_default(name);
  return (fullname.local ? creatorFixed : creatorInherit)(fullname);
}

// node_modules/d3-selection/src/selector.js
function none() {
}
function selector_default(selector) {
  return selector == null ? none : function() {
    return this.querySelector(selector);
  };
}

// node_modules/d3-selection/src/selection/select.js
function select_default(select) {
  if (typeof select !== "function")
    select = selector_default(select);
  for (var groups = this._groups, m2 = groups.length, subgroups = new Array(m2), j = 0; j < m2; ++j) {
    for (var group = groups[j], n = group.length, subgroup = subgroups[j] = new Array(n), node, subnode, i = 0; i < n; ++i) {
      if ((node = group[i]) && (subnode = select.call(node, node.__data__, i, group))) {
        if ("__data__" in node)
          subnode.__data__ = node.__data__;
        subgroup[i] = subnode;
      }
    }
  }
  return new Selection(subgroups, this._parents);
}

// node_modules/d3-selection/src/array.js
function array(x3) {
  return x3 == null ? [] : Array.isArray(x3) ? x3 : Array.from(x3);
}

// node_modules/d3-selection/src/selectorAll.js
function empty() {
  return [];
}
function selectorAll_default(selector) {
  return selector == null ? empty : function() {
    return this.querySelectorAll(selector);
  };
}

// node_modules/d3-selection/src/selection/selectAll.js
function arrayAll(select) {
  return function() {
    return array(select.apply(this, arguments));
  };
}
function selectAll_default(select) {
  if (typeof select === "function")
    select = arrayAll(select);
  else
    select = selectorAll_default(select);
  for (var groups = this._groups, m2 = groups.length, subgroups = [], parents = [], j = 0; j < m2; ++j) {
    for (var group = groups[j], n = group.length, node, i = 0; i < n; ++i) {
      if (node = group[i]) {
        subgroups.push(select.call(node, node.__data__, i, group));
        parents.push(node);
      }
    }
  }
  return new Selection(subgroups, parents);
}

// node_modules/d3-selection/src/matcher.js
function matcher_default(selector) {
  return function() {
    return this.matches(selector);
  };
}
function childMatcher(selector) {
  return function(node) {
    return node.matches(selector);
  };
}

// node_modules/d3-selection/src/selection/selectChild.js
var find = Array.prototype.find;
function childFind(match) {
  return function() {
    return find.call(this.children, match);
  };
}
function childFirst() {
  return this.firstElementChild;
}
function selectChild_default(match) {
  return this.select(match == null ? childFirst : childFind(typeof match === "function" ? match : childMatcher(match)));
}

// node_modules/d3-selection/src/selection/selectChildren.js
var filter = Array.prototype.filter;
function children() {
  return Array.from(this.children);
}
function childrenFilter(match) {
  return function() {
    return filter.call(this.children, match);
  };
}
function selectChildren_default(match) {
  return this.selectAll(match == null ? children : childrenFilter(typeof match === "function" ? match : childMatcher(match)));
}

// node_modules/d3-selection/src/selection/filter.js
function filter_default(match) {
  if (typeof match !== "function")
    match = matcher_default(match);
  for (var groups = this._groups, m2 = groups.length, subgroups = new Array(m2), j = 0; j < m2; ++j) {
    for (var group = groups[j], n = group.length, subgroup = subgroups[j] = [], node, i = 0; i < n; ++i) {
      if ((node = group[i]) && match.call(node, node.__data__, i, group)) {
        subgroup.push(node);
      }
    }
  }
  return new Selection(subgroups, this._parents);
}

// node_modules/d3-selection/src/selection/sparse.js
function sparse_default(update) {
  return new Array(update.length);
}

// node_modules/d3-selection/src/selection/enter.js
function enter_default() {
  return new Selection(this._enter || this._groups.map(sparse_default), this._parents);
}
function EnterNode(parent, datum2) {
  this.ownerDocument = parent.ownerDocument;
  this.namespaceURI = parent.namespaceURI;
  this._next = null;
  this._parent = parent;
  this.__data__ = datum2;
}
EnterNode.prototype = {
  constructor: EnterNode,
  appendChild: function(child) {
    return this._parent.insertBefore(child, this._next);
  },
  insertBefore: function(child, next) {
    return this._parent.insertBefore(child, next);
  },
  querySelector: function(selector) {
    return this._parent.querySelector(selector);
  },
  querySelectorAll: function(selector) {
    return this._parent.querySelectorAll(selector);
  }
};

// node_modules/d3-selection/src/constant.js
function constant_default(x3) {
  return function() {
    return x3;
  };
}

// node_modules/d3-selection/src/selection/data.js
function bindIndex(parent, group, enter, update, exit, data) {
  var i = 0, node, groupLength = group.length, dataLength = data.length;
  for (; i < dataLength; ++i) {
    if (node = group[i]) {
      node.__data__ = data[i];
      update[i] = node;
    } else {
      enter[i] = new EnterNode(parent, data[i]);
    }
  }
  for (; i < groupLength; ++i) {
    if (node = group[i]) {
      exit[i] = node;
    }
  }
}
function bindKey(parent, group, enter, update, exit, data, key) {
  var i, node, nodeByKeyValue = /* @__PURE__ */ new Map(), groupLength = group.length, dataLength = data.length, keyValues = new Array(groupLength), keyValue;
  for (i = 0; i < groupLength; ++i) {
    if (node = group[i]) {
      keyValues[i] = keyValue = key.call(node, node.__data__, i, group) + "";
      if (nodeByKeyValue.has(keyValue)) {
        exit[i] = node;
      } else {
        nodeByKeyValue.set(keyValue, node);
      }
    }
  }
  for (i = 0; i < dataLength; ++i) {
    keyValue = key.call(parent, data[i], i, data) + "";
    if (node = nodeByKeyValue.get(keyValue)) {
      update[i] = node;
      node.__data__ = data[i];
      nodeByKeyValue.delete(keyValue);
    } else {
      enter[i] = new EnterNode(parent, data[i]);
    }
  }
  for (i = 0; i < groupLength; ++i) {
    if ((node = group[i]) && nodeByKeyValue.get(keyValues[i]) === node) {
      exit[i] = node;
    }
  }
}
function datum(node) {
  return node.__data__;
}
function data_default(value, key) {
  if (!arguments.length)
    return Array.from(this, datum);
  var bind = key ? bindKey : bindIndex, parents = this._parents, groups = this._groups;
  if (typeof value !== "function")
    value = constant_default(value);
  for (var m2 = groups.length, update = new Array(m2), enter = new Array(m2), exit = new Array(m2), j = 0; j < m2; ++j) {
    var parent = parents[j], group = groups[j], groupLength = group.length, data = arraylike(value.call(parent, parent && parent.__data__, j, parents)), dataLength = data.length, enterGroup = enter[j] = new Array(dataLength), updateGroup = update[j] = new Array(dataLength), exitGroup = exit[j] = new Array(groupLength);
    bind(parent, group, enterGroup, updateGroup, exitGroup, data, key);
    for (var i0 = 0, i1 = 0, previous, next; i0 < dataLength; ++i0) {
      if (previous = enterGroup[i0]) {
        if (i0 >= i1)
          i1 = i0 + 1;
        while (!(next = updateGroup[i1]) && ++i1 < dataLength)
          ;
        previous._next = next || null;
      }
    }
  }
  update = new Selection(update, parents);
  update._enter = enter;
  update._exit = exit;
  return update;
}
function arraylike(data) {
  return typeof data === "object" && "length" in data ? data : Array.from(data);
}

// node_modules/d3-selection/src/selection/exit.js
function exit_default() {
  return new Selection(this._exit || this._groups.map(sparse_default), this._parents);
}

// node_modules/d3-selection/src/selection/join.js
function join_default(onenter, onupdate, onexit) {
  var enter = this.enter(), update = this, exit = this.exit();
  if (typeof onenter === "function") {
    enter = onenter(enter);
    if (enter)
      enter = enter.selection();
  } else {
    enter = enter.append(onenter + "");
  }
  if (onupdate != null) {
    update = onupdate(update);
    if (update)
      update = update.selection();
  }
  if (onexit == null)
    exit.remove();
  else
    onexit(exit);
  return enter && update ? enter.merge(update).order() : update;
}

// node_modules/d3-selection/src/selection/merge.js
function merge_default(context) {
  var selection2 = context.selection ? context.selection() : context;
  for (var groups0 = this._groups, groups1 = selection2._groups, m0 = groups0.length, m1 = groups1.length, m2 = Math.min(m0, m1), merges = new Array(m0), j = 0; j < m2; ++j) {
    for (var group0 = groups0[j], group1 = groups1[j], n = group0.length, merge = merges[j] = new Array(n), node, i = 0; i < n; ++i) {
      if (node = group0[i] || group1[i]) {
        merge[i] = node;
      }
    }
  }
  for (; j < m0; ++j) {
    merges[j] = groups0[j];
  }
  return new Selection(merges, this._parents);
}

// node_modules/d3-selection/src/selection/order.js
function order_default() {
  for (var groups = this._groups, j = -1, m2 = groups.length; ++j < m2; ) {
    for (var group = groups[j], i = group.length - 1, next = group[i], node; --i >= 0; ) {
      if (node = group[i]) {
        if (next && node.compareDocumentPosition(next) ^ 4)
          next.parentNode.insertBefore(node, next);
        next = node;
      }
    }
  }
  return this;
}

// node_modules/d3-selection/src/selection/sort.js
function sort_default(compare) {
  if (!compare)
    compare = ascending;
  function compareNode(a2, b) {
    return a2 && b ? compare(a2.__data__, b.__data__) : !a2 - !b;
  }
  for (var groups = this._groups, m2 = groups.length, sortgroups = new Array(m2), j = 0; j < m2; ++j) {
    for (var group = groups[j], n = group.length, sortgroup = sortgroups[j] = new Array(n), node, i = 0; i < n; ++i) {
      if (node = group[i]) {
        sortgroup[i] = node;
      }
    }
    sortgroup.sort(compareNode);
  }
  return new Selection(sortgroups, this._parents).order();
}
function ascending(a2, b) {
  return a2 < b ? -1 : a2 > b ? 1 : a2 >= b ? 0 : NaN;
}

// node_modules/d3-selection/src/selection/call.js
function call_default() {
  var callback = arguments[0];
  arguments[0] = this;
  callback.apply(null, arguments);
  return this;
}

// node_modules/d3-selection/src/selection/nodes.js
function nodes_default() {
  return Array.from(this);
}

// node_modules/d3-selection/src/selection/node.js
function node_default() {
  for (var groups = this._groups, j = 0, m2 = groups.length; j < m2; ++j) {
    for (var group = groups[j], i = 0, n = group.length; i < n; ++i) {
      var node = group[i];
      if (node)
        return node;
    }
  }
  return null;
}

// node_modules/d3-selection/src/selection/size.js
function size_default() {
  let size = 0;
  for (const node of this)
    ++size;
  return size;
}

// node_modules/d3-selection/src/selection/empty.js
function empty_default() {
  return !this.node();
}

// node_modules/d3-selection/src/selection/each.js
function each_default(callback) {
  for (var groups = this._groups, j = 0, m2 = groups.length; j < m2; ++j) {
    for (var group = groups[j], i = 0, n = group.length, node; i < n; ++i) {
      if (node = group[i])
        callback.call(node, node.__data__, i, group);
    }
  }
  return this;
}

// node_modules/d3-selection/src/selection/attr.js
function attrRemove(name) {
  return function() {
    this.removeAttribute(name);
  };
}
function attrRemoveNS(fullname) {
  return function() {
    this.removeAttributeNS(fullname.space, fullname.local);
  };
}
function attrConstant(name, value) {
  return function() {
    this.setAttribute(name, value);
  };
}
function attrConstantNS(fullname, value) {
  return function() {
    this.setAttributeNS(fullname.space, fullname.local, value);
  };
}
function attrFunction(name, value) {
  return function() {
    var v = value.apply(this, arguments);
    if (v == null)
      this.removeAttribute(name);
    else
      this.setAttribute(name, v);
  };
}
function attrFunctionNS(fullname, value) {
  return function() {
    var v = value.apply(this, arguments);
    if (v == null)
      this.removeAttributeNS(fullname.space, fullname.local);
    else
      this.setAttributeNS(fullname.space, fullname.local, v);
  };
}
function attr_default(name, value) {
  var fullname = namespace_default(name);
  if (arguments.length < 2) {
    var node = this.node();
    return fullname.local ? node.getAttributeNS(fullname.space, fullname.local) : node.getAttribute(fullname);
  }
  return this.each((value == null ? fullname.local ? attrRemoveNS : attrRemove : typeof value === "function" ? fullname.local ? attrFunctionNS : attrFunction : fullname.local ? attrConstantNS : attrConstant)(fullname, value));
}

// node_modules/d3-selection/src/window.js
function window_default(node) {
  return node.ownerDocument && node.ownerDocument.defaultView || node.document && node || node.defaultView;
}

// node_modules/d3-selection/src/selection/style.js
function styleRemove(name) {
  return function() {
    this.style.removeProperty(name);
  };
}
function styleConstant(name, value, priority) {
  return function() {
    this.style.setProperty(name, value, priority);
  };
}
function styleFunction(name, value, priority) {
  return function() {
    var v = value.apply(this, arguments);
    if (v == null)
      this.style.removeProperty(name);
    else
      this.style.setProperty(name, v, priority);
  };
}
function style_default(name, value, priority) {
  return arguments.length > 1 ? this.each((value == null ? styleRemove : typeof value === "function" ? styleFunction : styleConstant)(name, value, priority == null ? "" : priority)) : styleValue(this.node(), name);
}
function styleValue(node, name) {
  return node.style.getPropertyValue(name) || window_default(node).getComputedStyle(node, null).getPropertyValue(name);
}

// node_modules/d3-selection/src/selection/property.js
function propertyRemove(name) {
  return function() {
    delete this[name];
  };
}
function propertyConstant(name, value) {
  return function() {
    this[name] = value;
  };
}
function propertyFunction(name, value) {
  return function() {
    var v = value.apply(this, arguments);
    if (v == null)
      delete this[name];
    else
      this[name] = v;
  };
}
function property_default(name, value) {
  return arguments.length > 1 ? this.each((value == null ? propertyRemove : typeof value === "function" ? propertyFunction : propertyConstant)(name, value)) : this.node()[name];
}

// node_modules/d3-selection/src/selection/classed.js
function classArray(string) {
  return string.trim().split(/^|\s+/);
}
function classList(node) {
  return node.classList || new ClassList(node);
}
function ClassList(node) {
  this._node = node;
  this._names = classArray(node.getAttribute("class") || "");
}
ClassList.prototype = {
  add: function(name) {
    var i = this._names.indexOf(name);
    if (i < 0) {
      this._names.push(name);
      this._node.setAttribute("class", this._names.join(" "));
    }
  },
  remove: function(name) {
    var i = this._names.indexOf(name);
    if (i >= 0) {
      this._names.splice(i, 1);
      this._node.setAttribute("class", this._names.join(" "));
    }
  },
  contains: function(name) {
    return this._names.indexOf(name) >= 0;
  }
};
function classedAdd(node, names) {
  var list = classList(node), i = -1, n = names.length;
  while (++i < n)
    list.add(names[i]);
}
function classedRemove(node, names) {
  var list = classList(node), i = -1, n = names.length;
  while (++i < n)
    list.remove(names[i]);
}
function classedTrue(names) {
  return function() {
    classedAdd(this, names);
  };
}
function classedFalse(names) {
  return function() {
    classedRemove(this, names);
  };
}
function classedFunction(names, value) {
  return function() {
    (value.apply(this, arguments) ? classedAdd : classedRemove)(this, names);
  };
}
function classed_default(name, value) {
  var names = classArray(name + "");
  if (arguments.length < 2) {
    var list = classList(this.node()), i = -1, n = names.length;
    while (++i < n)
      if (!list.contains(names[i]))
        return false;
    return true;
  }
  return this.each((typeof value === "function" ? classedFunction : value ? classedTrue : classedFalse)(names, value));
}

// node_modules/d3-selection/src/selection/text.js
function textRemove() {
  this.textContent = "";
}
function textConstant(value) {
  return function() {
    this.textContent = value;
  };
}
function textFunction(value) {
  return function() {
    var v = value.apply(this, arguments);
    this.textContent = v == null ? "" : v;
  };
}
function text_default(value) {
  return arguments.length ? this.each(value == null ? textRemove : (typeof value === "function" ? textFunction : textConstant)(value)) : this.node().textContent;
}

// node_modules/d3-selection/src/selection/html.js
function htmlRemove() {
  this.innerHTML = "";
}
function htmlConstant(value) {
  return function() {
    this.innerHTML = value;
  };
}
function htmlFunction(value) {
  return function() {
    var v = value.apply(this, arguments);
    this.innerHTML = v == null ? "" : v;
  };
}
function html_default(value) {
  return arguments.length ? this.each(value == null ? htmlRemove : (typeof value === "function" ? htmlFunction : htmlConstant)(value)) : this.node().innerHTML;
}

// node_modules/d3-selection/src/selection/raise.js
function raise() {
  if (this.nextSibling)
    this.parentNode.appendChild(this);
}
function raise_default() {
  return this.each(raise);
}

// node_modules/d3-selection/src/selection/lower.js
function lower() {
  if (this.previousSibling)
    this.parentNode.insertBefore(this, this.parentNode.firstChild);
}
function lower_default() {
  return this.each(lower);
}

// node_modules/d3-selection/src/selection/append.js
function append_default(name) {
  var create2 = typeof name === "function" ? name : creator_default(name);
  return this.select(function() {
    return this.appendChild(create2.apply(this, arguments));
  });
}

// node_modules/d3-selection/src/selection/insert.js
function constantNull() {
  return null;
}
function insert_default(name, before) {
  var create2 = typeof name === "function" ? name : creator_default(name), select = before == null ? constantNull : typeof before === "function" ? before : selector_default(before);
  return this.select(function() {
    return this.insertBefore(create2.apply(this, arguments), select.apply(this, arguments) || null);
  });
}

// node_modules/d3-selection/src/selection/remove.js
function remove() {
  var parent = this.parentNode;
  if (parent)
    parent.removeChild(this);
}
function remove_default() {
  return this.each(remove);
}

// node_modules/d3-selection/src/selection/clone.js
function selection_cloneShallow() {
  var clone = this.cloneNode(false), parent = this.parentNode;
  return parent ? parent.insertBefore(clone, this.nextSibling) : clone;
}
function selection_cloneDeep() {
  var clone = this.cloneNode(true), parent = this.parentNode;
  return parent ? parent.insertBefore(clone, this.nextSibling) : clone;
}
function clone_default(deep) {
  return this.select(deep ? selection_cloneDeep : selection_cloneShallow);
}

// node_modules/d3-selection/src/selection/datum.js
function datum_default(value) {
  return arguments.length ? this.property("__data__", value) : this.node().__data__;
}

// node_modules/d3-selection/src/selection/on.js
function contextListener(listener) {
  return function(event) {
    listener.call(this, event, this.__data__);
  };
}
function parseTypenames2(typenames) {
  return typenames.trim().split(/^|\s+/).map(function(t) {
    var name = "", i = t.indexOf(".");
    if (i >= 0)
      name = t.slice(i + 1), t = t.slice(0, i);
    return { type: t, name };
  });
}
function onRemove(typename) {
  return function() {
    var on = this.__on;
    if (!on)
      return;
    for (var j = 0, i = -1, m2 = on.length, o; j < m2; ++j) {
      if (o = on[j], (!typename.type || o.type === typename.type) && o.name === typename.name) {
        this.removeEventListener(o.type, o.listener, o.options);
      } else {
        on[++i] = o;
      }
    }
    if (++i)
      on.length = i;
    else
      delete this.__on;
  };
}
function onAdd(typename, value, options) {
  return function() {
    var on = this.__on, o, listener = contextListener(value);
    if (on)
      for (var j = 0, m2 = on.length; j < m2; ++j) {
        if ((o = on[j]).type === typename.type && o.name === typename.name) {
          this.removeEventListener(o.type, o.listener, o.options);
          this.addEventListener(o.type, o.listener = listener, o.options = options);
          o.value = value;
          return;
        }
      }
    this.addEventListener(typename.type, listener, options);
    o = { type: typename.type, name: typename.name, value, listener, options };
    if (!on)
      this.__on = [o];
    else
      on.push(o);
  };
}
function on_default(typename, value, options) {
  var typenames = parseTypenames2(typename + ""), i, n = typenames.length, t;
  if (arguments.length < 2) {
    var on = this.node().__on;
    if (on)
      for (var j = 0, m2 = on.length, o; j < m2; ++j) {
        for (i = 0, o = on[j]; i < n; ++i) {
          if ((t = typenames[i]).type === o.type && t.name === o.name) {
            return o.value;
          }
        }
      }
    return;
  }
  on = value ? onAdd : onRemove;
  for (i = 0; i < n; ++i)
    this.each(on(typenames[i], value, options));
  return this;
}

// node_modules/d3-selection/src/selection/dispatch.js
function dispatchEvent(node, type2, params) {
  var window2 = window_default(node), event = window2.CustomEvent;
  if (typeof event === "function") {
    event = new event(type2, params);
  } else {
    event = window2.document.createEvent("Event");
    if (params)
      event.initEvent(type2, params.bubbles, params.cancelable), event.detail = params.detail;
    else
      event.initEvent(type2, false, false);
  }
  node.dispatchEvent(event);
}
function dispatchConstant(type2, params) {
  return function() {
    return dispatchEvent(this, type2, params);
  };
}
function dispatchFunction(type2, params) {
  return function() {
    return dispatchEvent(this, type2, params.apply(this, arguments));
  };
}
function dispatch_default2(type2, params) {
  return this.each((typeof params === "function" ? dispatchFunction : dispatchConstant)(type2, params));
}

// node_modules/d3-selection/src/selection/iterator.js
function* iterator_default() {
  for (var groups = this._groups, j = 0, m2 = groups.length; j < m2; ++j) {
    for (var group = groups[j], i = 0, n = group.length, node; i < n; ++i) {
      if (node = group[i])
        yield node;
    }
  }
}

// node_modules/d3-selection/src/selection/index.js
var root = [null];
function Selection(groups, parents) {
  this._groups = groups;
  this._parents = parents;
}
function selection() {
  return new Selection([[document.documentElement]], root);
}
function selection_selection() {
  return this;
}
Selection.prototype = selection.prototype = {
  constructor: Selection,
  select: select_default,
  selectAll: selectAll_default,
  selectChild: selectChild_default,
  selectChildren: selectChildren_default,
  filter: filter_default,
  data: data_default,
  enter: enter_default,
  exit: exit_default,
  join: join_default,
  merge: merge_default,
  selection: selection_selection,
  order: order_default,
  sort: sort_default,
  call: call_default,
  nodes: nodes_default,
  node: node_default,
  size: size_default,
  empty: empty_default,
  each: each_default,
  attr: attr_default,
  style: style_default,
  property: property_default,
  classed: classed_default,
  text: text_default,
  html: html_default,
  raise: raise_default,
  lower: lower_default,
  append: append_default,
  insert: insert_default,
  remove: remove_default,
  clone: clone_default,
  datum: datum_default,
  on: on_default,
  dispatch: dispatch_default2,
  [Symbol.iterator]: iterator_default
};
var selection_default = selection;

// node_modules/d3-selection/src/select.js
function select_default2(selector) {
  return typeof selector === "string" ? new Selection([[document.querySelector(selector)]], [document.documentElement]) : new Selection([[selector]], root);
}

// node_modules/d3-selection/src/sourceEvent.js
function sourceEvent_default(event) {
  let sourceEvent;
  while (sourceEvent = event.sourceEvent)
    event = sourceEvent;
  return event;
}

// node_modules/d3-selection/src/pointer.js
function pointer_default(event, node) {
  event = sourceEvent_default(event);
  if (node === void 0)
    node = event.currentTarget;
  if (node) {
    var svg = node.ownerSVGElement || node;
    if (svg.createSVGPoint) {
      var point = svg.createSVGPoint();
      point.x = event.clientX, point.y = event.clientY;
      point = point.matrixTransform(node.getScreenCTM().inverse());
      return [point.x, point.y];
    }
    if (node.getBoundingClientRect) {
      var rect = node.getBoundingClientRect();
      return [event.clientX - rect.left - node.clientLeft, event.clientY - rect.top - node.clientTop];
    }
  }
  return [event.pageX, event.pageY];
}

// node_modules/d3-drag/src/noevent.js
var nonpassive = { passive: false };
var nonpassivecapture = { capture: true, passive: false };
function nopropagation(event) {
  event.stopImmediatePropagation();
}
function noevent_default(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

// node_modules/d3-drag/src/nodrag.js
function nodrag_default(view) {
  var root2 = view.document.documentElement, selection2 = select_default2(view).on("dragstart.drag", noevent_default, nonpassivecapture);
  if ("onselectstart" in root2) {
    selection2.on("selectstart.drag", noevent_default, nonpassivecapture);
  } else {
    root2.__noselect = root2.style.MozUserSelect;
    root2.style.MozUserSelect = "none";
  }
}
function yesdrag(view, noclick) {
  var root2 = view.document.documentElement, selection2 = select_default2(view).on("dragstart.drag", null);
  if (noclick) {
    selection2.on("click.drag", noevent_default, nonpassivecapture);
    setTimeout(function() {
      selection2.on("click.drag", null);
    }, 0);
  }
  if ("onselectstart" in root2) {
    selection2.on("selectstart.drag", null);
  } else {
    root2.style.MozUserSelect = root2.__noselect;
    delete root2.__noselect;
  }
}

// node_modules/d3-drag/src/constant.js
var constant_default2 = (x3) => () => x3;

// node_modules/d3-drag/src/event.js
function DragEvent(type2, {
  sourceEvent,
  subject,
  target,
  identifier,
  active,
  x: x3,
  y: y3,
  dx,
  dy,
  dispatch: dispatch2
}) {
  Object.defineProperties(this, {
    type: { value: type2, enumerable: true, configurable: true },
    sourceEvent: { value: sourceEvent, enumerable: true, configurable: true },
    subject: { value: subject, enumerable: true, configurable: true },
    target: { value: target, enumerable: true, configurable: true },
    identifier: { value: identifier, enumerable: true, configurable: true },
    active: { value: active, enumerable: true, configurable: true },
    x: { value: x3, enumerable: true, configurable: true },
    y: { value: y3, enumerable: true, configurable: true },
    dx: { value: dx, enumerable: true, configurable: true },
    dy: { value: dy, enumerable: true, configurable: true },
    _: { value: dispatch2 }
  });
}
DragEvent.prototype.on = function() {
  var value = this._.on.apply(this._, arguments);
  return value === this._ ? this : value;
};

// node_modules/d3-drag/src/drag.js
function defaultFilter(event) {
  return !event.ctrlKey && !event.button;
}
function defaultContainer() {
  return this.parentNode;
}
function defaultSubject(event, d) {
  return d == null ? { x: event.x, y: event.y } : d;
}
function defaultTouchable() {
  return navigator.maxTouchPoints || "ontouchstart" in this;
}
function drag_default() {
  var filter2 = defaultFilter, container = defaultContainer, subject = defaultSubject, touchable = defaultTouchable, gestures = {}, listeners = dispatch_default("start", "drag", "end"), active = 0, mousedownx, mousedowny, mousemoving, touchending, clickDistance2 = 0;
  function drag(selection2) {
    selection2.on("mousedown.drag", mousedowned).filter(touchable).on("touchstart.drag", touchstarted).on("touchmove.drag", touchmoved, nonpassive).on("touchend.drag touchcancel.drag", touchended).style("touch-action", "none").style("-webkit-tap-highlight-color", "rgba(0,0,0,0)");
  }
  function mousedowned(event, d) {
    if (touchending || !filter2.call(this, event, d))
      return;
    var gesture = beforestart(this, container.call(this, event, d), event, d, "mouse");
    if (!gesture)
      return;
    select_default2(event.view).on("mousemove.drag", mousemoved, nonpassivecapture).on("mouseup.drag", mouseupped, nonpassivecapture);
    nodrag_default(event.view);
    nopropagation(event);
    mousemoving = false;
    mousedownx = event.clientX;
    mousedowny = event.clientY;
    gesture("start", event);
  }
  function mousemoved(event) {
    noevent_default(event);
    if (!mousemoving) {
      var dx = event.clientX - mousedownx, dy = event.clientY - mousedowny;
      mousemoving = dx * dx + dy * dy > clickDistance2;
    }
    gestures.mouse("drag", event);
  }
  function mouseupped(event) {
    select_default2(event.view).on("mousemove.drag mouseup.drag", null);
    yesdrag(event.view, mousemoving);
    noevent_default(event);
    gestures.mouse("end", event);
  }
  function touchstarted(event, d) {
    if (!filter2.call(this, event, d))
      return;
    var touches = event.changedTouches, c2 = container.call(this, event, d), n = touches.length, i, gesture;
    for (i = 0; i < n; ++i) {
      if (gesture = beforestart(this, c2, event, d, touches[i].identifier, touches[i])) {
        nopropagation(event);
        gesture("start", event, touches[i]);
      }
    }
  }
  function touchmoved(event) {
    var touches = event.changedTouches, n = touches.length, i, gesture;
    for (i = 0; i < n; ++i) {
      if (gesture = gestures[touches[i].identifier]) {
        noevent_default(event);
        gesture("drag", event, touches[i]);
      }
    }
  }
  function touchended(event) {
    var touches = event.changedTouches, n = touches.length, i, gesture;
    if (touchending)
      clearTimeout(touchending);
    touchending = setTimeout(function() {
      touchending = null;
    }, 500);
    for (i = 0; i < n; ++i) {
      if (gesture = gestures[touches[i].identifier]) {
        nopropagation(event);
        gesture("end", event, touches[i]);
      }
    }
  }
  function beforestart(that, container2, event, d, identifier, touch) {
    var dispatch2 = listeners.copy(), p = pointer_default(touch || event, container2), dx, dy, s;
    if ((s = subject.call(that, new DragEvent("beforestart", {
      sourceEvent: event,
      target: drag,
      identifier,
      active,
      x: p[0],
      y: p[1],
      dx: 0,
      dy: 0,
      dispatch: dispatch2
    }), d)) == null)
      return;
    dx = s.x - p[0] || 0;
    dy = s.y - p[1] || 0;
    return function gesture(type2, event2, touch2) {
      var p0 = p, n;
      switch (type2) {
        case "start":
          gestures[identifier] = gesture, n = active++;
          break;
        case "end":
          delete gestures[identifier], --active;
        case "drag":
          p = pointer_default(touch2 || event2, container2), n = active;
          break;
      }
      dispatch2.call(
        type2,
        that,
        new DragEvent(type2, {
          sourceEvent: event2,
          subject: s,
          target: drag,
          identifier,
          active: n,
          x: p[0] + dx,
          y: p[1] + dy,
          dx: p[0] - p0[0],
          dy: p[1] - p0[1],
          dispatch: dispatch2
        }),
        d
      );
    };
  }
  drag.filter = function(_) {
    return arguments.length ? (filter2 = typeof _ === "function" ? _ : constant_default2(!!_), drag) : filter2;
  };
  drag.container = function(_) {
    return arguments.length ? (container = typeof _ === "function" ? _ : constant_default2(_), drag) : container;
  };
  drag.subject = function(_) {
    return arguments.length ? (subject = typeof _ === "function" ? _ : constant_default2(_), drag) : subject;
  };
  drag.touchable = function(_) {
    return arguments.length ? (touchable = typeof _ === "function" ? _ : constant_default2(!!_), drag) : touchable;
  };
  drag.on = function() {
    var value = listeners.on.apply(listeners, arguments);
    return value === listeners ? drag : value;
  };
  drag.clickDistance = function(_) {
    return arguments.length ? (clickDistance2 = (_ = +_) * _, drag) : Math.sqrt(clickDistance2);
  };
  return drag;
}

// node_modules/d3-color/src/define.js
function define_default(constructor, factory, prototype) {
  constructor.prototype = factory.prototype = prototype;
  prototype.constructor = constructor;
}
function extend(parent, definition) {
  var prototype = Object.create(parent.prototype);
  for (var key in definition)
    prototype[key] = definition[key];
  return prototype;
}

// node_modules/d3-color/src/color.js
function Color() {
}
var darker = 0.7;
var brighter = 1 / darker;
var reI = "\\s*([+-]?\\d+)\\s*";
var reN = "\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)\\s*";
var reP = "\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)%\\s*";
var reHex = /^#([0-9a-f]{3,8})$/;
var reRgbInteger = new RegExp(`^rgb\\(${reI},${reI},${reI}\\)$`);
var reRgbPercent = new RegExp(`^rgb\\(${reP},${reP},${reP}\\)$`);
var reRgbaInteger = new RegExp(`^rgba\\(${reI},${reI},${reI},${reN}\\)$`);
var reRgbaPercent = new RegExp(`^rgba\\(${reP},${reP},${reP},${reN}\\)$`);
var reHslPercent = new RegExp(`^hsl\\(${reN},${reP},${reP}\\)$`);
var reHslaPercent = new RegExp(`^hsla\\(${reN},${reP},${reP},${reN}\\)$`);
var named = {
  aliceblue: 15792383,
  antiquewhite: 16444375,
  aqua: 65535,
  aquamarine: 8388564,
  azure: 15794175,
  beige: 16119260,
  bisque: 16770244,
  black: 0,
  blanchedalmond: 16772045,
  blue: 255,
  blueviolet: 9055202,
  brown: 10824234,
  burlywood: 14596231,
  cadetblue: 6266528,
  chartreuse: 8388352,
  chocolate: 13789470,
  coral: 16744272,
  cornflowerblue: 6591981,
  cornsilk: 16775388,
  crimson: 14423100,
  cyan: 65535,
  darkblue: 139,
  darkcyan: 35723,
  darkgoldenrod: 12092939,
  darkgray: 11119017,
  darkgreen: 25600,
  darkgrey: 11119017,
  darkkhaki: 12433259,
  darkmagenta: 9109643,
  darkolivegreen: 5597999,
  darkorange: 16747520,
  darkorchid: 10040012,
  darkred: 9109504,
  darksalmon: 15308410,
  darkseagreen: 9419919,
  darkslateblue: 4734347,
  darkslategray: 3100495,
  darkslategrey: 3100495,
  darkturquoise: 52945,
  darkviolet: 9699539,
  deeppink: 16716947,
  deepskyblue: 49151,
  dimgray: 6908265,
  dimgrey: 6908265,
  dodgerblue: 2003199,
  firebrick: 11674146,
  floralwhite: 16775920,
  forestgreen: 2263842,
  fuchsia: 16711935,
  gainsboro: 14474460,
  ghostwhite: 16316671,
  gold: 16766720,
  goldenrod: 14329120,
  gray: 8421504,
  green: 32768,
  greenyellow: 11403055,
  grey: 8421504,
  honeydew: 15794160,
  hotpink: 16738740,
  indianred: 13458524,
  indigo: 4915330,
  ivory: 16777200,
  khaki: 15787660,
  lavender: 15132410,
  lavenderblush: 16773365,
  lawngreen: 8190976,
  lemonchiffon: 16775885,
  lightblue: 11393254,
  lightcoral: 15761536,
  lightcyan: 14745599,
  lightgoldenrodyellow: 16448210,
  lightgray: 13882323,
  lightgreen: 9498256,
  lightgrey: 13882323,
  lightpink: 16758465,
  lightsalmon: 16752762,
  lightseagreen: 2142890,
  lightskyblue: 8900346,
  lightslategray: 7833753,
  lightslategrey: 7833753,
  lightsteelblue: 11584734,
  lightyellow: 16777184,
  lime: 65280,
  limegreen: 3329330,
  linen: 16445670,
  magenta: 16711935,
  maroon: 8388608,
  mediumaquamarine: 6737322,
  mediumblue: 205,
  mediumorchid: 12211667,
  mediumpurple: 9662683,
  mediumseagreen: 3978097,
  mediumslateblue: 8087790,
  mediumspringgreen: 64154,
  mediumturquoise: 4772300,
  mediumvioletred: 13047173,
  midnightblue: 1644912,
  mintcream: 16121850,
  mistyrose: 16770273,
  moccasin: 16770229,
  navajowhite: 16768685,
  navy: 128,
  oldlace: 16643558,
  olive: 8421376,
  olivedrab: 7048739,
  orange: 16753920,
  orangered: 16729344,
  orchid: 14315734,
  palegoldenrod: 15657130,
  palegreen: 10025880,
  paleturquoise: 11529966,
  palevioletred: 14381203,
  papayawhip: 16773077,
  peachpuff: 16767673,
  peru: 13468991,
  pink: 16761035,
  plum: 14524637,
  powderblue: 11591910,
  purple: 8388736,
  rebeccapurple: 6697881,
  red: 16711680,
  rosybrown: 12357519,
  royalblue: 4286945,
  saddlebrown: 9127187,
  salmon: 16416882,
  sandybrown: 16032864,
  seagreen: 3050327,
  seashell: 16774638,
  sienna: 10506797,
  silver: 12632256,
  skyblue: 8900331,
  slateblue: 6970061,
  slategray: 7372944,
  slategrey: 7372944,
  snow: 16775930,
  springgreen: 65407,
  steelblue: 4620980,
  tan: 13808780,
  teal: 32896,
  thistle: 14204888,
  tomato: 16737095,
  turquoise: 4251856,
  violet: 15631086,
  wheat: 16113331,
  white: 16777215,
  whitesmoke: 16119285,
  yellow: 16776960,
  yellowgreen: 10145074
};
define_default(Color, color, {
  copy(channels) {
    return Object.assign(new this.constructor(), this, channels);
  },
  displayable() {
    return this.rgb().displayable();
  },
  hex: color_formatHex,
  // Deprecated! Use color.formatHex.
  formatHex: color_formatHex,
  formatHex8: color_formatHex8,
  formatHsl: color_formatHsl,
  formatRgb: color_formatRgb,
  toString: color_formatRgb
});
function color_formatHex() {
  return this.rgb().formatHex();
}
function color_formatHex8() {
  return this.rgb().formatHex8();
}
function color_formatHsl() {
  return hslConvert(this).formatHsl();
}
function color_formatRgb() {
  return this.rgb().formatRgb();
}
function color(format) {
  var m2, l;
  format = (format + "").trim().toLowerCase();
  return (m2 = reHex.exec(format)) ? (l = m2[1].length, m2 = parseInt(m2[1], 16), l === 6 ? rgbn(m2) : l === 3 ? new Rgb(m2 >> 8 & 15 | m2 >> 4 & 240, m2 >> 4 & 15 | m2 & 240, (m2 & 15) << 4 | m2 & 15, 1) : l === 8 ? rgba(m2 >> 24 & 255, m2 >> 16 & 255, m2 >> 8 & 255, (m2 & 255) / 255) : l === 4 ? rgba(m2 >> 12 & 15 | m2 >> 8 & 240, m2 >> 8 & 15 | m2 >> 4 & 240, m2 >> 4 & 15 | m2 & 240, ((m2 & 15) << 4 | m2 & 15) / 255) : null) : (m2 = reRgbInteger.exec(format)) ? new Rgb(m2[1], m2[2], m2[3], 1) : (m2 = reRgbPercent.exec(format)) ? new Rgb(m2[1] * 255 / 100, m2[2] * 255 / 100, m2[3] * 255 / 100, 1) : (m2 = reRgbaInteger.exec(format)) ? rgba(m2[1], m2[2], m2[3], m2[4]) : (m2 = reRgbaPercent.exec(format)) ? rgba(m2[1] * 255 / 100, m2[2] * 255 / 100, m2[3] * 255 / 100, m2[4]) : (m2 = reHslPercent.exec(format)) ? hsla(m2[1], m2[2] / 100, m2[3] / 100, 1) : (m2 = reHslaPercent.exec(format)) ? hsla(m2[1], m2[2] / 100, m2[3] / 100, m2[4]) : named.hasOwnProperty(format) ? rgbn(named[format]) : format === "transparent" ? new Rgb(NaN, NaN, NaN, 0) : null;
}
function rgbn(n) {
  return new Rgb(n >> 16 & 255, n >> 8 & 255, n & 255, 1);
}
function rgba(r, g, b, a2) {
  if (a2 <= 0)
    r = g = b = NaN;
  return new Rgb(r, g, b, a2);
}
function rgbConvert(o) {
  if (!(o instanceof Color))
    o = color(o);
  if (!o)
    return new Rgb();
  o = o.rgb();
  return new Rgb(o.r, o.g, o.b, o.opacity);
}
function rgb(r, g, b, opacity) {
  return arguments.length === 1 ? rgbConvert(r) : new Rgb(r, g, b, opacity == null ? 1 : opacity);
}
function Rgb(r, g, b, opacity) {
  this.r = +r;
  this.g = +g;
  this.b = +b;
  this.opacity = +opacity;
}
define_default(Rgb, rgb, extend(Color, {
  brighter(k) {
    k = k == null ? brighter : Math.pow(brighter, k);
    return new Rgb(this.r * k, this.g * k, this.b * k, this.opacity);
  },
  darker(k) {
    k = k == null ? darker : Math.pow(darker, k);
    return new Rgb(this.r * k, this.g * k, this.b * k, this.opacity);
  },
  rgb() {
    return this;
  },
  clamp() {
    return new Rgb(clampi(this.r), clampi(this.g), clampi(this.b), clampa(this.opacity));
  },
  displayable() {
    return -0.5 <= this.r && this.r < 255.5 && (-0.5 <= this.g && this.g < 255.5) && (-0.5 <= this.b && this.b < 255.5) && (0 <= this.opacity && this.opacity <= 1);
  },
  hex: rgb_formatHex,
  // Deprecated! Use color.formatHex.
  formatHex: rgb_formatHex,
  formatHex8: rgb_formatHex8,
  formatRgb: rgb_formatRgb,
  toString: rgb_formatRgb
}));
function rgb_formatHex() {
  return `#${hex(this.r)}${hex(this.g)}${hex(this.b)}`;
}
function rgb_formatHex8() {
  return `#${hex(this.r)}${hex(this.g)}${hex(this.b)}${hex((isNaN(this.opacity) ? 1 : this.opacity) * 255)}`;
}
function rgb_formatRgb() {
  const a2 = clampa(this.opacity);
  return `${a2 === 1 ? "rgb(" : "rgba("}${clampi(this.r)}, ${clampi(this.g)}, ${clampi(this.b)}${a2 === 1 ? ")" : `, ${a2})`}`;
}
function clampa(opacity) {
  return isNaN(opacity) ? 1 : Math.max(0, Math.min(1, opacity));
}
function clampi(value) {
  return Math.max(0, Math.min(255, Math.round(value) || 0));
}
function hex(value) {
  value = clampi(value);
  return (value < 16 ? "0" : "") + value.toString(16);
}
function hsla(h, s, l, a2) {
  if (a2 <= 0)
    h = s = l = NaN;
  else if (l <= 0 || l >= 1)
    h = s = NaN;
  else if (s <= 0)
    h = NaN;
  return new Hsl(h, s, l, a2);
}
function hslConvert(o) {
  if (o instanceof Hsl)
    return new Hsl(o.h, o.s, o.l, o.opacity);
  if (!(o instanceof Color))
    o = color(o);
  if (!o)
    return new Hsl();
  if (o instanceof Hsl)
    return o;
  o = o.rgb();
  var r = o.r / 255, g = o.g / 255, b = o.b / 255, min2 = Math.min(r, g, b), max2 = Math.max(r, g, b), h = NaN, s = max2 - min2, l = (max2 + min2) / 2;
  if (s) {
    if (r === max2)
      h = (g - b) / s + (g < b) * 6;
    else if (g === max2)
      h = (b - r) / s + 2;
    else
      h = (r - g) / s + 4;
    s /= l < 0.5 ? max2 + min2 : 2 - max2 - min2;
    h *= 60;
  } else {
    s = l > 0 && l < 1 ? 0 : h;
  }
  return new Hsl(h, s, l, o.opacity);
}
function hsl(h, s, l, opacity) {
  return arguments.length === 1 ? hslConvert(h) : new Hsl(h, s, l, opacity == null ? 1 : opacity);
}
function Hsl(h, s, l, opacity) {
  this.h = +h;
  this.s = +s;
  this.l = +l;
  this.opacity = +opacity;
}
define_default(Hsl, hsl, extend(Color, {
  brighter(k) {
    k = k == null ? brighter : Math.pow(brighter, k);
    return new Hsl(this.h, this.s, this.l * k, this.opacity);
  },
  darker(k) {
    k = k == null ? darker : Math.pow(darker, k);
    return new Hsl(this.h, this.s, this.l * k, this.opacity);
  },
  rgb() {
    var h = this.h % 360 + (this.h < 0) * 360, s = isNaN(h) || isNaN(this.s) ? 0 : this.s, l = this.l, m2 = l + (l < 0.5 ? l : 1 - l) * s, m1 = 2 * l - m2;
    return new Rgb(
      hsl2rgb(h >= 240 ? h - 240 : h + 120, m1, m2),
      hsl2rgb(h, m1, m2),
      hsl2rgb(h < 120 ? h + 240 : h - 120, m1, m2),
      this.opacity
    );
  },
  clamp() {
    return new Hsl(clamph(this.h), clampt(this.s), clampt(this.l), clampa(this.opacity));
  },
  displayable() {
    return (0 <= this.s && this.s <= 1 || isNaN(this.s)) && (0 <= this.l && this.l <= 1) && (0 <= this.opacity && this.opacity <= 1);
  },
  formatHsl() {
    const a2 = clampa(this.opacity);
    return `${a2 === 1 ? "hsl(" : "hsla("}${clamph(this.h)}, ${clampt(this.s) * 100}%, ${clampt(this.l) * 100}%${a2 === 1 ? ")" : `, ${a2})`}`;
  }
}));
function clamph(value) {
  value = (value || 0) % 360;
  return value < 0 ? value + 360 : value;
}
function clampt(value) {
  return Math.max(0, Math.min(1, value || 0));
}
function hsl2rgb(h, m1, m2) {
  return (h < 60 ? m1 + (m2 - m1) * h / 60 : h < 180 ? m2 : h < 240 ? m1 + (m2 - m1) * (240 - h) / 60 : m1) * 255;
}

// node_modules/d3-interpolate/src/basis.js
function basis(t1, v0, v1, v2, v3) {
  var t2 = t1 * t1, t3 = t2 * t1;
  return ((1 - 3 * t1 + 3 * t2 - t3) * v0 + (4 - 6 * t2 + 3 * t3) * v1 + (1 + 3 * t1 + 3 * t2 - 3 * t3) * v2 + t3 * v3) / 6;
}
function basis_default(values) {
  var n = values.length - 1;
  return function(t) {
    var i = t <= 0 ? t = 0 : t >= 1 ? (t = 1, n - 1) : Math.floor(t * n), v1 = values[i], v2 = values[i + 1], v0 = i > 0 ? values[i - 1] : 2 * v1 - v2, v3 = i < n - 1 ? values[i + 2] : 2 * v2 - v1;
    return basis((t - i / n) * n, v0, v1, v2, v3);
  };
}

// node_modules/d3-interpolate/src/basisClosed.js
function basisClosed_default(values) {
  var n = values.length;
  return function(t) {
    var i = Math.floor(((t %= 1) < 0 ? ++t : t) * n), v0 = values[(i + n - 1) % n], v1 = values[i % n], v2 = values[(i + 1) % n], v3 = values[(i + 2) % n];
    return basis((t - i / n) * n, v0, v1, v2, v3);
  };
}

// node_modules/d3-interpolate/src/constant.js
var constant_default3 = (x3) => () => x3;

// node_modules/d3-interpolate/src/color.js
function linear(a2, d) {
  return function(t) {
    return a2 + t * d;
  };
}
function exponential(a2, b, y3) {
  return a2 = Math.pow(a2, y3), b = Math.pow(b, y3) - a2, y3 = 1 / y3, function(t) {
    return Math.pow(a2 + t * b, y3);
  };
}
function gamma(y3) {
  return (y3 = +y3) === 1 ? nogamma : function(a2, b) {
    return b - a2 ? exponential(a2, b, y3) : constant_default3(isNaN(a2) ? b : a2);
  };
}
function nogamma(a2, b) {
  var d = b - a2;
  return d ? linear(a2, d) : constant_default3(isNaN(a2) ? b : a2);
}

// node_modules/d3-interpolate/src/rgb.js
var rgb_default = function rgbGamma(y3) {
  var color2 = gamma(y3);
  function rgb2(start2, end) {
    var r = color2((start2 = rgb(start2)).r, (end = rgb(end)).r), g = color2(start2.g, end.g), b = color2(start2.b, end.b), opacity = nogamma(start2.opacity, end.opacity);
    return function(t) {
      start2.r = r(t);
      start2.g = g(t);
      start2.b = b(t);
      start2.opacity = opacity(t);
      return start2 + "";
    };
  }
  rgb2.gamma = rgbGamma;
  return rgb2;
}(1);
function rgbSpline(spline) {
  return function(colors) {
    var n = colors.length, r = new Array(n), g = new Array(n), b = new Array(n), i, color2;
    for (i = 0; i < n; ++i) {
      color2 = rgb(colors[i]);
      r[i] = color2.r || 0;
      g[i] = color2.g || 0;
      b[i] = color2.b || 0;
    }
    r = spline(r);
    g = spline(g);
    b = spline(b);
    color2.opacity = 1;
    return function(t) {
      color2.r = r(t);
      color2.g = g(t);
      color2.b = b(t);
      return color2 + "";
    };
  };
}
var rgbBasis = rgbSpline(basis_default);
var rgbBasisClosed = rgbSpline(basisClosed_default);

// node_modules/d3-interpolate/src/number.js
function number_default(a2, b) {
  return a2 = +a2, b = +b, function(t) {
    return a2 * (1 - t) + b * t;
  };
}

// node_modules/d3-interpolate/src/string.js
var reA = /[-+]?(?:\d+\.?\d*|\.?\d+)(?:[eE][-+]?\d+)?/g;
var reB = new RegExp(reA.source, "g");
function zero(b) {
  return function() {
    return b;
  };
}
function one(b) {
  return function(t) {
    return b(t) + "";
  };
}
function string_default(a2, b) {
  var bi = reA.lastIndex = reB.lastIndex = 0, am, bm, bs, i = -1, s = [], q = [];
  a2 = a2 + "", b = b + "";
  while ((am = reA.exec(a2)) && (bm = reB.exec(b))) {
    if ((bs = bm.index) > bi) {
      bs = b.slice(bi, bs);
      if (s[i])
        s[i] += bs;
      else
        s[++i] = bs;
    }
    if ((am = am[0]) === (bm = bm[0])) {
      if (s[i])
        s[i] += bm;
      else
        s[++i] = bm;
    } else {
      s[++i] = null;
      q.push({ i, x: number_default(am, bm) });
    }
    bi = reB.lastIndex;
  }
  if (bi < b.length) {
    bs = b.slice(bi);
    if (s[i])
      s[i] += bs;
    else
      s[++i] = bs;
  }
  return s.length < 2 ? q[0] ? one(q[0].x) : zero(b) : (b = q.length, function(t) {
    for (var i2 = 0, o; i2 < b; ++i2)
      s[(o = q[i2]).i] = o.x(t);
    return s.join("");
  });
}

// node_modules/d3-interpolate/src/transform/decompose.js
var degrees = 180 / Math.PI;
var identity = {
  translateX: 0,
  translateY: 0,
  rotate: 0,
  skewX: 0,
  scaleX: 1,
  scaleY: 1
};
function decompose_default(a2, b, c2, d, e, f) {
  var scaleX, scaleY, skewX;
  if (scaleX = Math.sqrt(a2 * a2 + b * b))
    a2 /= scaleX, b /= scaleX;
  if (skewX = a2 * c2 + b * d)
    c2 -= a2 * skewX, d -= b * skewX;
  if (scaleY = Math.sqrt(c2 * c2 + d * d))
    c2 /= scaleY, d /= scaleY, skewX /= scaleY;
  if (a2 * d < b * c2)
    a2 = -a2, b = -b, skewX = -skewX, scaleX = -scaleX;
  return {
    translateX: e,
    translateY: f,
    rotate: Math.atan2(b, a2) * degrees,
    skewX: Math.atan(skewX) * degrees,
    scaleX,
    scaleY
  };
}

// node_modules/d3-interpolate/src/transform/parse.js
var svgNode;
function parseCss(value) {
  const m2 = new (typeof DOMMatrix === "function" ? DOMMatrix : WebKitCSSMatrix)(value + "");
  return m2.isIdentity ? identity : decompose_default(m2.a, m2.b, m2.c, m2.d, m2.e, m2.f);
}
function parseSvg(value) {
  if (value == null)
    return identity;
  if (!svgNode)
    svgNode = document.createElementNS("http://www.w3.org/2000/svg", "g");
  svgNode.setAttribute("transform", value);
  if (!(value = svgNode.transform.baseVal.consolidate()))
    return identity;
  value = value.matrix;
  return decompose_default(value.a, value.b, value.c, value.d, value.e, value.f);
}

// node_modules/d3-interpolate/src/transform/index.js
function interpolateTransform(parse, pxComma, pxParen, degParen) {
  function pop(s) {
    return s.length ? s.pop() + " " : "";
  }
  function translate(xa, ya, xb, yb, s, q) {
    if (xa !== xb || ya !== yb) {
      var i = s.push("translate(", null, pxComma, null, pxParen);
      q.push({ i: i - 4, x: number_default(xa, xb) }, { i: i - 2, x: number_default(ya, yb) });
    } else if (xb || yb) {
      s.push("translate(" + xb + pxComma + yb + pxParen);
    }
  }
  function rotate(a2, b, s, q) {
    if (a2 !== b) {
      if (a2 - b > 180)
        b += 360;
      else if (b - a2 > 180)
        a2 += 360;
      q.push({ i: s.push(pop(s) + "rotate(", null, degParen) - 2, x: number_default(a2, b) });
    } else if (b) {
      s.push(pop(s) + "rotate(" + b + degParen);
    }
  }
  function skewX(a2, b, s, q) {
    if (a2 !== b) {
      q.push({ i: s.push(pop(s) + "skewX(", null, degParen) - 2, x: number_default(a2, b) });
    } else if (b) {
      s.push(pop(s) + "skewX(" + b + degParen);
    }
  }
  function scale(xa, ya, xb, yb, s, q) {
    if (xa !== xb || ya !== yb) {
      var i = s.push(pop(s) + "scale(", null, ",", null, ")");
      q.push({ i: i - 4, x: number_default(xa, xb) }, { i: i - 2, x: number_default(ya, yb) });
    } else if (xb !== 1 || yb !== 1) {
      s.push(pop(s) + "scale(" + xb + "," + yb + ")");
    }
  }
  return function(a2, b) {
    var s = [], q = [];
    a2 = parse(a2), b = parse(b);
    translate(a2.translateX, a2.translateY, b.translateX, b.translateY, s, q);
    rotate(a2.rotate, b.rotate, s, q);
    skewX(a2.skewX, b.skewX, s, q);
    scale(a2.scaleX, a2.scaleY, b.scaleX, b.scaleY, s, q);
    a2 = b = null;
    return function(t) {
      var i = -1, n = q.length, o;
      while (++i < n)
        s[(o = q[i]).i] = o.x(t);
      return s.join("");
    };
  };
}
var interpolateTransformCss = interpolateTransform(parseCss, "px, ", "px)", "deg)");
var interpolateTransformSvg = interpolateTransform(parseSvg, ", ", ")", ")");

// node_modules/d3-interpolate/src/zoom.js
var epsilon2 = 1e-12;
function cosh(x3) {
  return ((x3 = Math.exp(x3)) + 1 / x3) / 2;
}
function sinh(x3) {
  return ((x3 = Math.exp(x3)) - 1 / x3) / 2;
}
function tanh(x3) {
  return ((x3 = Math.exp(2 * x3)) - 1) / (x3 + 1);
}
var zoom_default = function zoomRho(rho, rho2, rho4) {
  function zoom(p0, p1) {
    var ux0 = p0[0], uy0 = p0[1], w0 = p0[2], ux1 = p1[0], uy1 = p1[1], w1 = p1[2], dx = ux1 - ux0, dy = uy1 - uy0, d2 = dx * dx + dy * dy, i, S;
    if (d2 < epsilon2) {
      S = Math.log(w1 / w0) / rho;
      i = function(t) {
        return [
          ux0 + t * dx,
          uy0 + t * dy,
          w0 * Math.exp(rho * t * S)
        ];
      };
    } else {
      var d1 = Math.sqrt(d2), b0 = (w1 * w1 - w0 * w0 + rho4 * d2) / (2 * w0 * rho2 * d1), b1 = (w1 * w1 - w0 * w0 - rho4 * d2) / (2 * w1 * rho2 * d1), r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0), r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
      S = (r1 - r0) / rho;
      i = function(t) {
        var s = t * S, coshr0 = cosh(r0), u = w0 / (rho2 * d1) * (coshr0 * tanh(rho * s + r0) - sinh(r0));
        return [
          ux0 + u * dx,
          uy0 + u * dy,
          w0 * coshr0 / cosh(rho * s + r0)
        ];
      };
    }
    i.duration = S * 1e3 * rho / Math.SQRT2;
    return i;
  }
  zoom.rho = function(_) {
    var _1 = Math.max(1e-3, +_), _2 = _1 * _1, _4 = _2 * _2;
    return zoomRho(_1, _2, _4);
  };
  return zoom;
}(Math.SQRT2, 2, 4);

// node_modules/d3-timer/src/timer.js
var frame = 0;
var timeout = 0;
var interval = 0;
var pokeDelay = 1e3;
var taskHead;
var taskTail;
var clockLast = 0;
var clockNow = 0;
var clockSkew = 0;
var clock = typeof performance === "object" && performance.now ? performance : Date;
var setFrame = typeof window === "object" && window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : function(f) {
  setTimeout(f, 17);
};
function now() {
  return clockNow || (setFrame(clearNow), clockNow = clock.now() + clockSkew);
}
function clearNow() {
  clockNow = 0;
}
function Timer() {
  this._call = this._time = this._next = null;
}
Timer.prototype = timer.prototype = {
  constructor: Timer,
  restart: function(callback, delay, time) {
    if (typeof callback !== "function")
      throw new TypeError("callback is not a function");
    time = (time == null ? now() : +time) + (delay == null ? 0 : +delay);
    if (!this._next && taskTail !== this) {
      if (taskTail)
        taskTail._next = this;
      else
        taskHead = this;
      taskTail = this;
    }
    this._call = callback;
    this._time = time;
    sleep();
  },
  stop: function() {
    if (this._call) {
      this._call = null;
      this._time = Infinity;
      sleep();
    }
  }
};
function timer(callback, delay, time) {
  var t = new Timer();
  t.restart(callback, delay, time);
  return t;
}
function timerFlush() {
  now();
  ++frame;
  var t = taskHead, e;
  while (t) {
    if ((e = clockNow - t._time) >= 0)
      t._call.call(void 0, e);
    t = t._next;
  }
  --frame;
}
function wake() {
  clockNow = (clockLast = clock.now()) + clockSkew;
  frame = timeout = 0;
  try {
    timerFlush();
  } finally {
    frame = 0;
    nap();
    clockNow = 0;
  }
}
function poke() {
  var now2 = clock.now(), delay = now2 - clockLast;
  if (delay > pokeDelay)
    clockSkew -= delay, clockLast = now2;
}
function nap() {
  var t0, t1 = taskHead, t2, time = Infinity;
  while (t1) {
    if (t1._call) {
      if (time > t1._time)
        time = t1._time;
      t0 = t1, t1 = t1._next;
    } else {
      t2 = t1._next, t1._next = null;
      t1 = t0 ? t0._next = t2 : taskHead = t2;
    }
  }
  taskTail = t0;
  sleep(time);
}
function sleep(time) {
  if (frame)
    return;
  if (timeout)
    timeout = clearTimeout(timeout);
  var delay = time - clockNow;
  if (delay > 24) {
    if (time < Infinity)
      timeout = setTimeout(wake, time - clock.now() - clockSkew);
    if (interval)
      interval = clearInterval(interval);
  } else {
    if (!interval)
      clockLast = clock.now(), interval = setInterval(poke, pokeDelay);
    frame = 1, setFrame(wake);
  }
}

// node_modules/d3-timer/src/timeout.js
function timeout_default(callback, delay, time) {
  var t = new Timer();
  delay = delay == null ? 0 : +delay;
  t.restart((elapsed) => {
    t.stop();
    callback(elapsed + delay);
  }, delay, time);
  return t;
}

// node_modules/d3-transition/src/transition/schedule.js
var emptyOn = dispatch_default("start", "end", "cancel", "interrupt");
var emptyTween = [];
var CREATED = 0;
var SCHEDULED = 1;
var STARTING = 2;
var STARTED = 3;
var RUNNING = 4;
var ENDING = 5;
var ENDED = 6;
function schedule_default(node, name, id2, index2, group, timing) {
  var schedules = node.__transition;
  if (!schedules)
    node.__transition = {};
  else if (id2 in schedules)
    return;
  create(node, id2, {
    name,
    index: index2,
    // For context during callback.
    group,
    // For context during callback.
    on: emptyOn,
    tween: emptyTween,
    time: timing.time,
    delay: timing.delay,
    duration: timing.duration,
    ease: timing.ease,
    timer: null,
    state: CREATED
  });
}
function init(node, id2) {
  var schedule = get2(node, id2);
  if (schedule.state > CREATED)
    throw new Error("too late; already scheduled");
  return schedule;
}
function set2(node, id2) {
  var schedule = get2(node, id2);
  if (schedule.state > STARTED)
    throw new Error("too late; already running");
  return schedule;
}
function get2(node, id2) {
  var schedule = node.__transition;
  if (!schedule || !(schedule = schedule[id2]))
    throw new Error("transition not found");
  return schedule;
}
function create(node, id2, self) {
  var schedules = node.__transition, tween;
  schedules[id2] = self;
  self.timer = timer(schedule, 0, self.time);
  function schedule(elapsed) {
    self.state = SCHEDULED;
    self.timer.restart(start2, self.delay, self.time);
    if (self.delay <= elapsed)
      start2(elapsed - self.delay);
  }
  function start2(elapsed) {
    var i, j, n, o;
    if (self.state !== SCHEDULED)
      return stop();
    for (i in schedules) {
      o = schedules[i];
      if (o.name !== self.name)
        continue;
      if (o.state === STARTED)
        return timeout_default(start2);
      if (o.state === RUNNING) {
        o.state = ENDED;
        o.timer.stop();
        o.on.call("interrupt", node, node.__data__, o.index, o.group);
        delete schedules[i];
      } else if (+i < id2) {
        o.state = ENDED;
        o.timer.stop();
        o.on.call("cancel", node, node.__data__, o.index, o.group);
        delete schedules[i];
      }
    }
    timeout_default(function() {
      if (self.state === STARTED) {
        self.state = RUNNING;
        self.timer.restart(tick, self.delay, self.time);
        tick(elapsed);
      }
    });
    self.state = STARTING;
    self.on.call("start", node, node.__data__, self.index, self.group);
    if (self.state !== STARTING)
      return;
    self.state = STARTED;
    tween = new Array(n = self.tween.length);
    for (i = 0, j = -1; i < n; ++i) {
      if (o = self.tween[i].value.call(node, node.__data__, self.index, self.group)) {
        tween[++j] = o;
      }
    }
    tween.length = j + 1;
  }
  function tick(elapsed) {
    var t = elapsed < self.duration ? self.ease.call(null, elapsed / self.duration) : (self.timer.restart(stop), self.state = ENDING, 1), i = -1, n = tween.length;
    while (++i < n) {
      tween[i].call(node, t);
    }
    if (self.state === ENDING) {
      self.on.call("end", node, node.__data__, self.index, self.group);
      stop();
    }
  }
  function stop() {
    self.state = ENDED;
    self.timer.stop();
    delete schedules[id2];
    for (var i in schedules)
      return;
    delete node.__transition;
  }
}

// node_modules/d3-transition/src/interrupt.js
function interrupt_default(node, name) {
  var schedules = node.__transition, schedule, active, empty2 = true, i;
  if (!schedules)
    return;
  name = name == null ? null : name + "";
  for (i in schedules) {
    if ((schedule = schedules[i]).name !== name) {
      empty2 = false;
      continue;
    }
    active = schedule.state > STARTING && schedule.state < ENDING;
    schedule.state = ENDED;
    schedule.timer.stop();
    schedule.on.call(active ? "interrupt" : "cancel", node, node.__data__, schedule.index, schedule.group);
    delete schedules[i];
  }
  if (empty2)
    delete node.__transition;
}

// node_modules/d3-transition/src/selection/interrupt.js
function interrupt_default2(name) {
  return this.each(function() {
    interrupt_default(this, name);
  });
}

// node_modules/d3-transition/src/transition/tween.js
function tweenRemove(id2, name) {
  var tween0, tween1;
  return function() {
    var schedule = set2(this, id2), tween = schedule.tween;
    if (tween !== tween0) {
      tween1 = tween0 = tween;
      for (var i = 0, n = tween1.length; i < n; ++i) {
        if (tween1[i].name === name) {
          tween1 = tween1.slice();
          tween1.splice(i, 1);
          break;
        }
      }
    }
    schedule.tween = tween1;
  };
}
function tweenFunction(id2, name, value) {
  var tween0, tween1;
  if (typeof value !== "function")
    throw new Error();
  return function() {
    var schedule = set2(this, id2), tween = schedule.tween;
    if (tween !== tween0) {
      tween1 = (tween0 = tween).slice();
      for (var t = { name, value }, i = 0, n = tween1.length; i < n; ++i) {
        if (tween1[i].name === name) {
          tween1[i] = t;
          break;
        }
      }
      if (i === n)
        tween1.push(t);
    }
    schedule.tween = tween1;
  };
}
function tween_default(name, value) {
  var id2 = this._id;
  name += "";
  if (arguments.length < 2) {
    var tween = get2(this.node(), id2).tween;
    for (var i = 0, n = tween.length, t; i < n; ++i) {
      if ((t = tween[i]).name === name) {
        return t.value;
      }
    }
    return null;
  }
  return this.each((value == null ? tweenRemove : tweenFunction)(id2, name, value));
}
function tweenValue(transition2, name, value) {
  var id2 = transition2._id;
  transition2.each(function() {
    var schedule = set2(this, id2);
    (schedule.value || (schedule.value = {}))[name] = value.apply(this, arguments);
  });
  return function(node) {
    return get2(node, id2).value[name];
  };
}

// node_modules/d3-transition/src/transition/interpolate.js
function interpolate_default(a2, b) {
  var c2;
  return (typeof b === "number" ? number_default : b instanceof color ? rgb_default : (c2 = color(b)) ? (b = c2, rgb_default) : string_default)(a2, b);
}

// node_modules/d3-transition/src/transition/attr.js
function attrRemove2(name) {
  return function() {
    this.removeAttribute(name);
  };
}
function attrRemoveNS2(fullname) {
  return function() {
    this.removeAttributeNS(fullname.space, fullname.local);
  };
}
function attrConstant2(name, interpolate, value1) {
  var string00, string1 = value1 + "", interpolate0;
  return function() {
    var string0 = this.getAttribute(name);
    return string0 === string1 ? null : string0 === string00 ? interpolate0 : interpolate0 = interpolate(string00 = string0, value1);
  };
}
function attrConstantNS2(fullname, interpolate, value1) {
  var string00, string1 = value1 + "", interpolate0;
  return function() {
    var string0 = this.getAttributeNS(fullname.space, fullname.local);
    return string0 === string1 ? null : string0 === string00 ? interpolate0 : interpolate0 = interpolate(string00 = string0, value1);
  };
}
function attrFunction2(name, interpolate, value) {
  var string00, string10, interpolate0;
  return function() {
    var string0, value1 = value(this), string1;
    if (value1 == null)
      return void this.removeAttribute(name);
    string0 = this.getAttribute(name);
    string1 = value1 + "";
    return string0 === string1 ? null : string0 === string00 && string1 === string10 ? interpolate0 : (string10 = string1, interpolate0 = interpolate(string00 = string0, value1));
  };
}
function attrFunctionNS2(fullname, interpolate, value) {
  var string00, string10, interpolate0;
  return function() {
    var string0, value1 = value(this), string1;
    if (value1 == null)
      return void this.removeAttributeNS(fullname.space, fullname.local);
    string0 = this.getAttributeNS(fullname.space, fullname.local);
    string1 = value1 + "";
    return string0 === string1 ? null : string0 === string00 && string1 === string10 ? interpolate0 : (string10 = string1, interpolate0 = interpolate(string00 = string0, value1));
  };
}
function attr_default2(name, value) {
  var fullname = namespace_default(name), i = fullname === "transform" ? interpolateTransformSvg : interpolate_default;
  return this.attrTween(name, typeof value === "function" ? (fullname.local ? attrFunctionNS2 : attrFunction2)(fullname, i, tweenValue(this, "attr." + name, value)) : value == null ? (fullname.local ? attrRemoveNS2 : attrRemove2)(fullname) : (fullname.local ? attrConstantNS2 : attrConstant2)(fullname, i, value));
}

// node_modules/d3-transition/src/transition/attrTween.js
function attrInterpolate(name, i) {
  return function(t) {
    this.setAttribute(name, i.call(this, t));
  };
}
function attrInterpolateNS(fullname, i) {
  return function(t) {
    this.setAttributeNS(fullname.space, fullname.local, i.call(this, t));
  };
}
function attrTweenNS(fullname, value) {
  var t0, i0;
  function tween() {
    var i = value.apply(this, arguments);
    if (i !== i0)
      t0 = (i0 = i) && attrInterpolateNS(fullname, i);
    return t0;
  }
  tween._value = value;
  return tween;
}
function attrTween(name, value) {
  var t0, i0;
  function tween() {
    var i = value.apply(this, arguments);
    if (i !== i0)
      t0 = (i0 = i) && attrInterpolate(name, i);
    return t0;
  }
  tween._value = value;
  return tween;
}
function attrTween_default(name, value) {
  var key = "attr." + name;
  if (arguments.length < 2)
    return (key = this.tween(key)) && key._value;
  if (value == null)
    return this.tween(key, null);
  if (typeof value !== "function")
    throw new Error();
  var fullname = namespace_default(name);
  return this.tween(key, (fullname.local ? attrTweenNS : attrTween)(fullname, value));
}

// node_modules/d3-transition/src/transition/delay.js
function delayFunction(id2, value) {
  return function() {
    init(this, id2).delay = +value.apply(this, arguments);
  };
}
function delayConstant(id2, value) {
  return value = +value, function() {
    init(this, id2).delay = value;
  };
}
function delay_default(value) {
  var id2 = this._id;
  return arguments.length ? this.each((typeof value === "function" ? delayFunction : delayConstant)(id2, value)) : get2(this.node(), id2).delay;
}

// node_modules/d3-transition/src/transition/duration.js
function durationFunction(id2, value) {
  return function() {
    set2(this, id2).duration = +value.apply(this, arguments);
  };
}
function durationConstant(id2, value) {
  return value = +value, function() {
    set2(this, id2).duration = value;
  };
}
function duration_default(value) {
  var id2 = this._id;
  return arguments.length ? this.each((typeof value === "function" ? durationFunction : durationConstant)(id2, value)) : get2(this.node(), id2).duration;
}

// node_modules/d3-transition/src/transition/ease.js
function easeConstant(id2, value) {
  if (typeof value !== "function")
    throw new Error();
  return function() {
    set2(this, id2).ease = value;
  };
}
function ease_default(value) {
  var id2 = this._id;
  return arguments.length ? this.each(easeConstant(id2, value)) : get2(this.node(), id2).ease;
}

// node_modules/d3-transition/src/transition/easeVarying.js
function easeVarying(id2, value) {
  return function() {
    var v = value.apply(this, arguments);
    if (typeof v !== "function")
      throw new Error();
    set2(this, id2).ease = v;
  };
}
function easeVarying_default(value) {
  if (typeof value !== "function")
    throw new Error();
  return this.each(easeVarying(this._id, value));
}

// node_modules/d3-transition/src/transition/filter.js
function filter_default2(match) {
  if (typeof match !== "function")
    match = matcher_default(match);
  for (var groups = this._groups, m2 = groups.length, subgroups = new Array(m2), j = 0; j < m2; ++j) {
    for (var group = groups[j], n = group.length, subgroup = subgroups[j] = [], node, i = 0; i < n; ++i) {
      if ((node = group[i]) && match.call(node, node.__data__, i, group)) {
        subgroup.push(node);
      }
    }
  }
  return new Transition(subgroups, this._parents, this._name, this._id);
}

// node_modules/d3-transition/src/transition/merge.js
function merge_default2(transition2) {
  if (transition2._id !== this._id)
    throw new Error();
  for (var groups0 = this._groups, groups1 = transition2._groups, m0 = groups0.length, m1 = groups1.length, m2 = Math.min(m0, m1), merges = new Array(m0), j = 0; j < m2; ++j) {
    for (var group0 = groups0[j], group1 = groups1[j], n = group0.length, merge = merges[j] = new Array(n), node, i = 0; i < n; ++i) {
      if (node = group0[i] || group1[i]) {
        merge[i] = node;
      }
    }
  }
  for (; j < m0; ++j) {
    merges[j] = groups0[j];
  }
  return new Transition(merges, this._parents, this._name, this._id);
}

// node_modules/d3-transition/src/transition/on.js
function start(name) {
  return (name + "").trim().split(/^|\s+/).every(function(t) {
    var i = t.indexOf(".");
    if (i >= 0)
      t = t.slice(0, i);
    return !t || t === "start";
  });
}
function onFunction(id2, name, listener) {
  var on0, on1, sit = start(name) ? init : set2;
  return function() {
    var schedule = sit(this, id2), on = schedule.on;
    if (on !== on0)
      (on1 = (on0 = on).copy()).on(name, listener);
    schedule.on = on1;
  };
}
function on_default2(name, listener) {
  var id2 = this._id;
  return arguments.length < 2 ? get2(this.node(), id2).on.on(name) : this.each(onFunction(id2, name, listener));
}

// node_modules/d3-transition/src/transition/remove.js
function removeFunction(id2) {
  return function() {
    var parent = this.parentNode;
    for (var i in this.__transition)
      if (+i !== id2)
        return;
    if (parent)
      parent.removeChild(this);
  };
}
function remove_default2() {
  return this.on("end.remove", removeFunction(this._id));
}

// node_modules/d3-transition/src/transition/select.js
function select_default3(select) {
  var name = this._name, id2 = this._id;
  if (typeof select !== "function")
    select = selector_default(select);
  for (var groups = this._groups, m2 = groups.length, subgroups = new Array(m2), j = 0; j < m2; ++j) {
    for (var group = groups[j], n = group.length, subgroup = subgroups[j] = new Array(n), node, subnode, i = 0; i < n; ++i) {
      if ((node = group[i]) && (subnode = select.call(node, node.__data__, i, group))) {
        if ("__data__" in node)
          subnode.__data__ = node.__data__;
        subgroup[i] = subnode;
        schedule_default(subgroup[i], name, id2, i, subgroup, get2(node, id2));
      }
    }
  }
  return new Transition(subgroups, this._parents, name, id2);
}

// node_modules/d3-transition/src/transition/selectAll.js
function selectAll_default2(select) {
  var name = this._name, id2 = this._id;
  if (typeof select !== "function")
    select = selectorAll_default(select);
  for (var groups = this._groups, m2 = groups.length, subgroups = [], parents = [], j = 0; j < m2; ++j) {
    for (var group = groups[j], n = group.length, node, i = 0; i < n; ++i) {
      if (node = group[i]) {
        for (var children2 = select.call(node, node.__data__, i, group), child, inherit2 = get2(node, id2), k = 0, l = children2.length; k < l; ++k) {
          if (child = children2[k]) {
            schedule_default(child, name, id2, k, children2, inherit2);
          }
        }
        subgroups.push(children2);
        parents.push(node);
      }
    }
  }
  return new Transition(subgroups, parents, name, id2);
}

// node_modules/d3-transition/src/transition/selection.js
var Selection2 = selection_default.prototype.constructor;
function selection_default2() {
  return new Selection2(this._groups, this._parents);
}

// node_modules/d3-transition/src/transition/style.js
function styleNull(name, interpolate) {
  var string00, string10, interpolate0;
  return function() {
    var string0 = styleValue(this, name), string1 = (this.style.removeProperty(name), styleValue(this, name));
    return string0 === string1 ? null : string0 === string00 && string1 === string10 ? interpolate0 : interpolate0 = interpolate(string00 = string0, string10 = string1);
  };
}
function styleRemove2(name) {
  return function() {
    this.style.removeProperty(name);
  };
}
function styleConstant2(name, interpolate, value1) {
  var string00, string1 = value1 + "", interpolate0;
  return function() {
    var string0 = styleValue(this, name);
    return string0 === string1 ? null : string0 === string00 ? interpolate0 : interpolate0 = interpolate(string00 = string0, value1);
  };
}
function styleFunction2(name, interpolate, value) {
  var string00, string10, interpolate0;
  return function() {
    var string0 = styleValue(this, name), value1 = value(this), string1 = value1 + "";
    if (value1 == null)
      string1 = value1 = (this.style.removeProperty(name), styleValue(this, name));
    return string0 === string1 ? null : string0 === string00 && string1 === string10 ? interpolate0 : (string10 = string1, interpolate0 = interpolate(string00 = string0, value1));
  };
}
function styleMaybeRemove(id2, name) {
  var on0, on1, listener0, key = "style." + name, event = "end." + key, remove2;
  return function() {
    var schedule = set2(this, id2), on = schedule.on, listener = schedule.value[key] == null ? remove2 || (remove2 = styleRemove2(name)) : void 0;
    if (on !== on0 || listener0 !== listener)
      (on1 = (on0 = on).copy()).on(event, listener0 = listener);
    schedule.on = on1;
  };
}
function style_default2(name, value, priority) {
  var i = (name += "") === "transform" ? interpolateTransformCss : interpolate_default;
  return value == null ? this.styleTween(name, styleNull(name, i)).on("end.style." + name, styleRemove2(name)) : typeof value === "function" ? this.styleTween(name, styleFunction2(name, i, tweenValue(this, "style." + name, value))).each(styleMaybeRemove(this._id, name)) : this.styleTween(name, styleConstant2(name, i, value), priority).on("end.style." + name, null);
}

// node_modules/d3-transition/src/transition/styleTween.js
function styleInterpolate(name, i, priority) {
  return function(t) {
    this.style.setProperty(name, i.call(this, t), priority);
  };
}
function styleTween(name, value, priority) {
  var t, i0;
  function tween() {
    var i = value.apply(this, arguments);
    if (i !== i0)
      t = (i0 = i) && styleInterpolate(name, i, priority);
    return t;
  }
  tween._value = value;
  return tween;
}
function styleTween_default(name, value, priority) {
  var key = "style." + (name += "");
  if (arguments.length < 2)
    return (key = this.tween(key)) && key._value;
  if (value == null)
    return this.tween(key, null);
  if (typeof value !== "function")
    throw new Error();
  return this.tween(key, styleTween(name, value, priority == null ? "" : priority));
}

// node_modules/d3-transition/src/transition/text.js
function textConstant2(value) {
  return function() {
    this.textContent = value;
  };
}
function textFunction2(value) {
  return function() {
    var value1 = value(this);
    this.textContent = value1 == null ? "" : value1;
  };
}
function text_default2(value) {
  return this.tween("text", typeof value === "function" ? textFunction2(tweenValue(this, "text", value)) : textConstant2(value == null ? "" : value + ""));
}

// node_modules/d3-transition/src/transition/textTween.js
function textInterpolate(i) {
  return function(t) {
    this.textContent = i.call(this, t);
  };
}
function textTween(value) {
  var t0, i0;
  function tween() {
    var i = value.apply(this, arguments);
    if (i !== i0)
      t0 = (i0 = i) && textInterpolate(i);
    return t0;
  }
  tween._value = value;
  return tween;
}
function textTween_default(value) {
  var key = "text";
  if (arguments.length < 1)
    return (key = this.tween(key)) && key._value;
  if (value == null)
    return this.tween(key, null);
  if (typeof value !== "function")
    throw new Error();
  return this.tween(key, textTween(value));
}

// node_modules/d3-transition/src/transition/transition.js
function transition_default() {
  var name = this._name, id0 = this._id, id1 = newId();
  for (var groups = this._groups, m2 = groups.length, j = 0; j < m2; ++j) {
    for (var group = groups[j], n = group.length, node, i = 0; i < n; ++i) {
      if (node = group[i]) {
        var inherit2 = get2(node, id0);
        schedule_default(node, name, id1, i, group, {
          time: inherit2.time + inherit2.delay + inherit2.duration,
          delay: 0,
          duration: inherit2.duration,
          ease: inherit2.ease
        });
      }
    }
  }
  return new Transition(groups, this._parents, name, id1);
}

// node_modules/d3-transition/src/transition/end.js
function end_default() {
  var on0, on1, that = this, id2 = that._id, size = that.size();
  return new Promise(function(resolve, reject) {
    var cancel = { value: reject }, end = { value: function() {
      if (--size === 0)
        resolve();
    } };
    that.each(function() {
      var schedule = set2(this, id2), on = schedule.on;
      if (on !== on0) {
        on1 = (on0 = on).copy();
        on1._.cancel.push(cancel);
        on1._.interrupt.push(cancel);
        on1._.end.push(end);
      }
      schedule.on = on1;
    });
    if (size === 0)
      resolve();
  });
}

// node_modules/d3-transition/src/transition/index.js
var id = 0;
function Transition(groups, parents, name, id2) {
  this._groups = groups;
  this._parents = parents;
  this._name = name;
  this._id = id2;
}
function transition(name) {
  return selection_default().transition(name);
}
function newId() {
  return ++id;
}
var selection_prototype = selection_default.prototype;
Transition.prototype = transition.prototype = {
  constructor: Transition,
  select: select_default3,
  selectAll: selectAll_default2,
  selectChild: selection_prototype.selectChild,
  selectChildren: selection_prototype.selectChildren,
  filter: filter_default2,
  merge: merge_default2,
  selection: selection_default2,
  transition: transition_default,
  call: selection_prototype.call,
  nodes: selection_prototype.nodes,
  node: selection_prototype.node,
  size: selection_prototype.size,
  empty: selection_prototype.empty,
  each: selection_prototype.each,
  on: on_default2,
  attr: attr_default2,
  attrTween: attrTween_default,
  style: style_default2,
  styleTween: styleTween_default,
  text: text_default2,
  textTween: textTween_default,
  remove: remove_default2,
  tween: tween_default,
  delay: delay_default,
  duration: duration_default,
  ease: ease_default,
  easeVarying: easeVarying_default,
  end: end_default,
  [Symbol.iterator]: selection_prototype[Symbol.iterator]
};

// node_modules/d3-ease/src/cubic.js
function cubicInOut(t) {
  return ((t *= 2) <= 1 ? t * t * t : (t -= 2) * t * t + 2) / 2;
}

// node_modules/d3-transition/src/selection/transition.js
var defaultTiming = {
  time: null,
  // Set on use.
  delay: 0,
  duration: 250,
  ease: cubicInOut
};
function inherit(node, id2) {
  var timing;
  while (!(timing = node.__transition) || !(timing = timing[id2])) {
    if (!(node = node.parentNode)) {
      throw new Error(`transition ${id2} not found`);
    }
  }
  return timing;
}
function transition_default2(name) {
  var id2, timing;
  if (name instanceof Transition) {
    id2 = name._id, name = name._name;
  } else {
    id2 = newId(), (timing = defaultTiming).time = now(), name = name == null ? null : name + "";
  }
  for (var groups = this._groups, m2 = groups.length, j = 0; j < m2; ++j) {
    for (var group = groups[j], n = group.length, node, i = 0; i < n; ++i) {
      if (node = group[i]) {
        schedule_default(node, name, id2, i, group, timing || inherit(node, id2));
      }
    }
  }
  return new Transition(groups, this._parents, name, id2);
}

// node_modules/d3-transition/src/selection/index.js
selection_default.prototype.interrupt = interrupt_default2;
selection_default.prototype.transition = transition_default2;

// node_modules/d3-brush/src/brush.js
var { abs, max, min } = Math;
function number1(e) {
  return [+e[0], +e[1]];
}
function number2(e) {
  return [number1(e[0]), number1(e[1])];
}
var X = {
  name: "x",
  handles: ["w", "e"].map(type),
  input: function(x3, e) {
    return x3 == null ? null : [[+x3[0], e[0][1]], [+x3[1], e[1][1]]];
  },
  output: function(xy) {
    return xy && [xy[0][0], xy[1][0]];
  }
};
var Y = {
  name: "y",
  handles: ["n", "s"].map(type),
  input: function(y3, e) {
    return y3 == null ? null : [[e[0][0], +y3[0]], [e[1][0], +y3[1]]];
  },
  output: function(xy) {
    return xy && [xy[0][1], xy[1][1]];
  }
};
var XY = {
  name: "xy",
  handles: ["n", "w", "e", "s", "nw", "ne", "sw", "se"].map(type),
  input: function(xy) {
    return xy == null ? null : number2(xy);
  },
  output: function(xy) {
    return xy;
  }
};
function type(t) {
  return { type: t };
}

// node_modules/d3-force/src/center.js
function center_default(x3, y3) {
  var nodes, strength = 1;
  if (x3 == null)
    x3 = 0;
  if (y3 == null)
    y3 = 0;
  function force() {
    var i, n = nodes.length, node, sx = 0, sy = 0;
    for (i = 0; i < n; ++i) {
      node = nodes[i], sx += node.x, sy += node.y;
    }
    for (sx = (sx / n - x3) * strength, sy = (sy / n - y3) * strength, i = 0; i < n; ++i) {
      node = nodes[i], node.x -= sx, node.y -= sy;
    }
  }
  force.initialize = function(_) {
    nodes = _;
  };
  force.x = function(_) {
    return arguments.length ? (x3 = +_, force) : x3;
  };
  force.y = function(_) {
    return arguments.length ? (y3 = +_, force) : y3;
  };
  force.strength = function(_) {
    return arguments.length ? (strength = +_, force) : strength;
  };
  return force;
}

// node_modules/d3-quadtree/src/add.js
function add_default(d) {
  const x3 = +this._x.call(null, d), y3 = +this._y.call(null, d);
  return add(this.cover(x3, y3), x3, y3, d);
}
function add(tree, x3, y3, d) {
  if (isNaN(x3) || isNaN(y3))
    return tree;
  var parent, node = tree._root, leaf = { data: d }, x0 = tree._x0, y0 = tree._y0, x1 = tree._x1, y1 = tree._y1, xm, ym, xp, yp, right, bottom, i, j;
  if (!node)
    return tree._root = leaf, tree;
  while (node.length) {
    if (right = x3 >= (xm = (x0 + x1) / 2))
      x0 = xm;
    else
      x1 = xm;
    if (bottom = y3 >= (ym = (y0 + y1) / 2))
      y0 = ym;
    else
      y1 = ym;
    if (parent = node, !(node = node[i = bottom << 1 | right]))
      return parent[i] = leaf, tree;
  }
  xp = +tree._x.call(null, node.data);
  yp = +tree._y.call(null, node.data);
  if (x3 === xp && y3 === yp)
    return leaf.next = node, parent ? parent[i] = leaf : tree._root = leaf, tree;
  do {
    parent = parent ? parent[i] = new Array(4) : tree._root = new Array(4);
    if (right = x3 >= (xm = (x0 + x1) / 2))
      x0 = xm;
    else
      x1 = xm;
    if (bottom = y3 >= (ym = (y0 + y1) / 2))
      y0 = ym;
    else
      y1 = ym;
  } while ((i = bottom << 1 | right) === (j = (yp >= ym) << 1 | xp >= xm));
  return parent[j] = node, parent[i] = leaf, tree;
}
function addAll(data) {
  var d, i, n = data.length, x3, y3, xz = new Array(n), yz = new Array(n), x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (i = 0; i < n; ++i) {
    if (isNaN(x3 = +this._x.call(null, d = data[i])) || isNaN(y3 = +this._y.call(null, d)))
      continue;
    xz[i] = x3;
    yz[i] = y3;
    if (x3 < x0)
      x0 = x3;
    if (x3 > x1)
      x1 = x3;
    if (y3 < y0)
      y0 = y3;
    if (y3 > y1)
      y1 = y3;
  }
  if (x0 > x1 || y0 > y1)
    return this;
  this.cover(x0, y0).cover(x1, y1);
  for (i = 0; i < n; ++i) {
    add(this, xz[i], yz[i], data[i]);
  }
  return this;
}

// node_modules/d3-quadtree/src/cover.js
function cover_default(x3, y3) {
  if (isNaN(x3 = +x3) || isNaN(y3 = +y3))
    return this;
  var x0 = this._x0, y0 = this._y0, x1 = this._x1, y1 = this._y1;
  if (isNaN(x0)) {
    x1 = (x0 = Math.floor(x3)) + 1;
    y1 = (y0 = Math.floor(y3)) + 1;
  } else {
    var z = x1 - x0 || 1, node = this._root, parent, i;
    while (x0 > x3 || x3 >= x1 || y0 > y3 || y3 >= y1) {
      i = (y3 < y0) << 1 | x3 < x0;
      parent = new Array(4), parent[i] = node, node = parent, z *= 2;
      switch (i) {
        case 0:
          x1 = x0 + z, y1 = y0 + z;
          break;
        case 1:
          x0 = x1 - z, y1 = y0 + z;
          break;
        case 2:
          x1 = x0 + z, y0 = y1 - z;
          break;
        case 3:
          x0 = x1 - z, y0 = y1 - z;
          break;
      }
    }
    if (this._root && this._root.length)
      this._root = node;
  }
  this._x0 = x0;
  this._y0 = y0;
  this._x1 = x1;
  this._y1 = y1;
  return this;
}

// node_modules/d3-quadtree/src/data.js
function data_default2() {
  var data = [];
  this.visit(function(node) {
    if (!node.length)
      do
        data.push(node.data);
      while (node = node.next);
  });
  return data;
}

// node_modules/d3-quadtree/src/extent.js
function extent_default(_) {
  return arguments.length ? this.cover(+_[0][0], +_[0][1]).cover(+_[1][0], +_[1][1]) : isNaN(this._x0) ? void 0 : [[this._x0, this._y0], [this._x1, this._y1]];
}

// node_modules/d3-quadtree/src/quad.js
function quad_default(node, x0, y0, x1, y1) {
  this.node = node;
  this.x0 = x0;
  this.y0 = y0;
  this.x1 = x1;
  this.y1 = y1;
}

// node_modules/d3-quadtree/src/find.js
function find_default(x3, y3, radius) {
  var data, x0 = this._x0, y0 = this._y0, x1, y1, x22, y22, x32 = this._x1, y32 = this._y1, quads = [], node = this._root, q, i;
  if (node)
    quads.push(new quad_default(node, x0, y0, x32, y32));
  if (radius == null)
    radius = Infinity;
  else {
    x0 = x3 - radius, y0 = y3 - radius;
    x32 = x3 + radius, y32 = y3 + radius;
    radius *= radius;
  }
  while (q = quads.pop()) {
    if (!(node = q.node) || (x1 = q.x0) > x32 || (y1 = q.y0) > y32 || (x22 = q.x1) < x0 || (y22 = q.y1) < y0)
      continue;
    if (node.length) {
      var xm = (x1 + x22) / 2, ym = (y1 + y22) / 2;
      quads.push(
        new quad_default(node[3], xm, ym, x22, y22),
        new quad_default(node[2], x1, ym, xm, y22),
        new quad_default(node[1], xm, y1, x22, ym),
        new quad_default(node[0], x1, y1, xm, ym)
      );
      if (i = (y3 >= ym) << 1 | x3 >= xm) {
        q = quads[quads.length - 1];
        quads[quads.length - 1] = quads[quads.length - 1 - i];
        quads[quads.length - 1 - i] = q;
      }
    } else {
      var dx = x3 - +this._x.call(null, node.data), dy = y3 - +this._y.call(null, node.data), d2 = dx * dx + dy * dy;
      if (d2 < radius) {
        var d = Math.sqrt(radius = d2);
        x0 = x3 - d, y0 = y3 - d;
        x32 = x3 + d, y32 = y3 + d;
        data = node.data;
      }
    }
  }
  return data;
}

// node_modules/d3-quadtree/src/remove.js
function remove_default3(d) {
  if (isNaN(x3 = +this._x.call(null, d)) || isNaN(y3 = +this._y.call(null, d)))
    return this;
  var parent, node = this._root, retainer, previous, next, x0 = this._x0, y0 = this._y0, x1 = this._x1, y1 = this._y1, x3, y3, xm, ym, right, bottom, i, j;
  if (!node)
    return this;
  if (node.length)
    while (true) {
      if (right = x3 >= (xm = (x0 + x1) / 2))
        x0 = xm;
      else
        x1 = xm;
      if (bottom = y3 >= (ym = (y0 + y1) / 2))
        y0 = ym;
      else
        y1 = ym;
      if (!(parent = node, node = node[i = bottom << 1 | right]))
        return this;
      if (!node.length)
        break;
      if (parent[i + 1 & 3] || parent[i + 2 & 3] || parent[i + 3 & 3])
        retainer = parent, j = i;
    }
  while (node.data !== d)
    if (!(previous = node, node = node.next))
      return this;
  if (next = node.next)
    delete node.next;
  if (previous)
    return next ? previous.next = next : delete previous.next, this;
  if (!parent)
    return this._root = next, this;
  next ? parent[i] = next : delete parent[i];
  if ((node = parent[0] || parent[1] || parent[2] || parent[3]) && node === (parent[3] || parent[2] || parent[1] || parent[0]) && !node.length) {
    if (retainer)
      retainer[j] = node;
    else
      this._root = node;
  }
  return this;
}
function removeAll(data) {
  for (var i = 0, n = data.length; i < n; ++i)
    this.remove(data[i]);
  return this;
}

// node_modules/d3-quadtree/src/root.js
function root_default() {
  return this._root;
}

// node_modules/d3-quadtree/src/size.js
function size_default2() {
  var size = 0;
  this.visit(function(node) {
    if (!node.length)
      do
        ++size;
      while (node = node.next);
  });
  return size;
}

// node_modules/d3-quadtree/src/visit.js
function visit_default(callback) {
  var quads = [], q, node = this._root, child, x0, y0, x1, y1;
  if (node)
    quads.push(new quad_default(node, this._x0, this._y0, this._x1, this._y1));
  while (q = quads.pop()) {
    if (!callback(node = q.node, x0 = q.x0, y0 = q.y0, x1 = q.x1, y1 = q.y1) && node.length) {
      var xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
      if (child = node[3])
        quads.push(new quad_default(child, xm, ym, x1, y1));
      if (child = node[2])
        quads.push(new quad_default(child, x0, ym, xm, y1));
      if (child = node[1])
        quads.push(new quad_default(child, xm, y0, x1, ym));
      if (child = node[0])
        quads.push(new quad_default(child, x0, y0, xm, ym));
    }
  }
  return this;
}

// node_modules/d3-quadtree/src/visitAfter.js
function visitAfter_default(callback) {
  var quads = [], next = [], q;
  if (this._root)
    quads.push(new quad_default(this._root, this._x0, this._y0, this._x1, this._y1));
  while (q = quads.pop()) {
    var node = q.node;
    if (node.length) {
      var child, x0 = q.x0, y0 = q.y0, x1 = q.x1, y1 = q.y1, xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
      if (child = node[0])
        quads.push(new quad_default(child, x0, y0, xm, ym));
      if (child = node[1])
        quads.push(new quad_default(child, xm, y0, x1, ym));
      if (child = node[2])
        quads.push(new quad_default(child, x0, ym, xm, y1));
      if (child = node[3])
        quads.push(new quad_default(child, xm, ym, x1, y1));
    }
    next.push(q);
  }
  while (q = next.pop()) {
    callback(q.node, q.x0, q.y0, q.x1, q.y1);
  }
  return this;
}

// node_modules/d3-quadtree/src/x.js
function defaultX(d) {
  return d[0];
}
function x_default(_) {
  return arguments.length ? (this._x = _, this) : this._x;
}

// node_modules/d3-quadtree/src/y.js
function defaultY(d) {
  return d[1];
}
function y_default(_) {
  return arguments.length ? (this._y = _, this) : this._y;
}

// node_modules/d3-quadtree/src/quadtree.js
function quadtree(nodes, x3, y3) {
  var tree = new Quadtree(x3 == null ? defaultX : x3, y3 == null ? defaultY : y3, NaN, NaN, NaN, NaN);
  return nodes == null ? tree : tree.addAll(nodes);
}
function Quadtree(x3, y3, x0, y0, x1, y1) {
  this._x = x3;
  this._y = y3;
  this._x0 = x0;
  this._y0 = y0;
  this._x1 = x1;
  this._y1 = y1;
  this._root = void 0;
}
function leaf_copy(leaf) {
  var copy = { data: leaf.data }, next = copy;
  while (leaf = leaf.next)
    next = next.next = { data: leaf.data };
  return copy;
}
var treeProto = quadtree.prototype = Quadtree.prototype;
treeProto.copy = function() {
  var copy = new Quadtree(this._x, this._y, this._x0, this._y0, this._x1, this._y1), node = this._root, nodes, child;
  if (!node)
    return copy;
  if (!node.length)
    return copy._root = leaf_copy(node), copy;
  nodes = [{ source: node, target: copy._root = new Array(4) }];
  while (node = nodes.pop()) {
    for (var i = 0; i < 4; ++i) {
      if (child = node.source[i]) {
        if (child.length)
          nodes.push({ source: child, target: node.target[i] = new Array(4) });
        else
          node.target[i] = leaf_copy(child);
      }
    }
  }
  return copy;
};
treeProto.add = add_default;
treeProto.addAll = addAll;
treeProto.cover = cover_default;
treeProto.data = data_default2;
treeProto.extent = extent_default;
treeProto.find = find_default;
treeProto.remove = remove_default3;
treeProto.removeAll = removeAll;
treeProto.root = root_default;
treeProto.size = size_default2;
treeProto.visit = visit_default;
treeProto.visitAfter = visitAfter_default;
treeProto.x = x_default;
treeProto.y = y_default;

// node_modules/d3-force/src/constant.js
function constant_default5(x3) {
  return function() {
    return x3;
  };
}

// node_modules/d3-force/src/jiggle.js
function jiggle_default(random) {
  return (random() - 0.5) * 1e-6;
}

// node_modules/d3-force/src/collide.js
function x(d) {
  return d.x + d.vx;
}
function y(d) {
  return d.y + d.vy;
}
function collide_default(radius) {
  var nodes, radii, random, strength = 1, iterations = 1;
  if (typeof radius !== "function")
    radius = constant_default5(radius == null ? 1 : +radius);
  function force() {
    var i, n = nodes.length, tree, node, xi, yi, ri, ri2;
    for (var k = 0; k < iterations; ++k) {
      tree = quadtree(nodes, x, y).visitAfter(prepare);
      for (i = 0; i < n; ++i) {
        node = nodes[i];
        ri = radii[node.index], ri2 = ri * ri;
        xi = node.x + node.vx;
        yi = node.y + node.vy;
        tree.visit(apply);
      }
    }
    function apply(quad, x0, y0, x1, y1) {
      var data = quad.data, rj = quad.r, r = ri + rj;
      if (data) {
        if (data.index > node.index) {
          var x3 = xi - data.x - data.vx, y3 = yi - data.y - data.vy, l = x3 * x3 + y3 * y3;
          if (l < r * r) {
            if (x3 === 0)
              x3 = jiggle_default(random), l += x3 * x3;
            if (y3 === 0)
              y3 = jiggle_default(random), l += y3 * y3;
            l = (r - (l = Math.sqrt(l))) / l * strength;
            node.vx += (x3 *= l) * (r = (rj *= rj) / (ri2 + rj));
            node.vy += (y3 *= l) * r;
            data.vx -= x3 * (r = 1 - r);
            data.vy -= y3 * r;
          }
        }
        return;
      }
      return x0 > xi + r || x1 < xi - r || y0 > yi + r || y1 < yi - r;
    }
  }
  function prepare(quad) {
    if (quad.data)
      return quad.r = radii[quad.data.index];
    for (var i = quad.r = 0; i < 4; ++i) {
      if (quad[i] && quad[i].r > quad.r) {
        quad.r = quad[i].r;
      }
    }
  }
  function initialize() {
    if (!nodes)
      return;
    var i, n = nodes.length, node;
    radii = new Array(n);
    for (i = 0; i < n; ++i)
      node = nodes[i], radii[node.index] = +radius(node, i, nodes);
  }
  force.initialize = function(_nodes, _random) {
    nodes = _nodes;
    random = _random;
    initialize();
  };
  force.iterations = function(_) {
    return arguments.length ? (iterations = +_, force) : iterations;
  };
  force.strength = function(_) {
    return arguments.length ? (strength = +_, force) : strength;
  };
  force.radius = function(_) {
    return arguments.length ? (radius = typeof _ === "function" ? _ : constant_default5(+_), initialize(), force) : radius;
  };
  return force;
}

// node_modules/d3-force/src/link.js
function index(d) {
  return d.index;
}
function find2(nodeById, nodeId) {
  var node = nodeById.get(nodeId);
  if (!node)
    throw new Error("node not found: " + nodeId);
  return node;
}
function link_default(links) {
  var id2 = index, strength = defaultStrength, strengths, distance = constant_default5(30), distances, nodes, count, bias, random, iterations = 1;
  if (links == null)
    links = [];
  function defaultStrength(link) {
    return 1 / Math.min(count[link.source.index], count[link.target.index]);
  }
  function force(alpha) {
    for (var k = 0, n = links.length; k < iterations; ++k) {
      for (var i = 0, link, source, target, x3, y3, l, b; i < n; ++i) {
        link = links[i], source = link.source, target = link.target;
        x3 = target.x + target.vx - source.x - source.vx || jiggle_default(random);
        y3 = target.y + target.vy - source.y - source.vy || jiggle_default(random);
        l = Math.sqrt(x3 * x3 + y3 * y3);
        l = (l - distances[i]) / l * alpha * strengths[i];
        x3 *= l, y3 *= l;
        target.vx -= x3 * (b = bias[i]);
        target.vy -= y3 * b;
        source.vx += x3 * (b = 1 - b);
        source.vy += y3 * b;
      }
    }
  }
  function initialize() {
    if (!nodes)
      return;
    var i, n = nodes.length, m2 = links.length, nodeById = new Map(nodes.map((d, i2) => [id2(d, i2, nodes), d])), link;
    for (i = 0, count = new Array(n); i < m2; ++i) {
      link = links[i], link.index = i;
      if (typeof link.source !== "object")
        link.source = find2(nodeById, link.source);
      if (typeof link.target !== "object")
        link.target = find2(nodeById, link.target);
      count[link.source.index] = (count[link.source.index] || 0) + 1;
      count[link.target.index] = (count[link.target.index] || 0) + 1;
    }
    for (i = 0, bias = new Array(m2); i < m2; ++i) {
      link = links[i], bias[i] = count[link.source.index] / (count[link.source.index] + count[link.target.index]);
    }
    strengths = new Array(m2), initializeStrength();
    distances = new Array(m2), initializeDistance();
  }
  function initializeStrength() {
    if (!nodes)
      return;
    for (var i = 0, n = links.length; i < n; ++i) {
      strengths[i] = +strength(links[i], i, links);
    }
  }
  function initializeDistance() {
    if (!nodes)
      return;
    for (var i = 0, n = links.length; i < n; ++i) {
      distances[i] = +distance(links[i], i, links);
    }
  }
  force.initialize = function(_nodes, _random) {
    nodes = _nodes;
    random = _random;
    initialize();
  };
  force.links = function(_) {
    return arguments.length ? (links = _, initialize(), force) : links;
  };
  force.id = function(_) {
    return arguments.length ? (id2 = _, force) : id2;
  };
  force.iterations = function(_) {
    return arguments.length ? (iterations = +_, force) : iterations;
  };
  force.strength = function(_) {
    return arguments.length ? (strength = typeof _ === "function" ? _ : constant_default5(+_), initializeStrength(), force) : strength;
  };
  force.distance = function(_) {
    return arguments.length ? (distance = typeof _ === "function" ? _ : constant_default5(+_), initializeDistance(), force) : distance;
  };
  return force;
}

// node_modules/d3-force/src/lcg.js
var a = 1664525;
var c = 1013904223;
var m = 4294967296;
function lcg_default() {
  let s = 1;
  return () => (s = (a * s + c) % m) / m;
}

// node_modules/d3-force/src/simulation.js
function x2(d) {
  return d.x;
}
function y2(d) {
  return d.y;
}
var initialRadius = 10;
var initialAngle = Math.PI * (3 - Math.sqrt(5));
function simulation_default(nodes) {
  var simulation, alpha = 1, alphaMin = 1e-3, alphaDecay = 1 - Math.pow(alphaMin, 1 / 300), alphaTarget = 0, velocityDecay = 0.6, forces = /* @__PURE__ */ new Map(), stepper = timer(step), event = dispatch_default("tick", "end"), random = lcg_default();
  if (nodes == null)
    nodes = [];
  function step() {
    tick();
    event.call("tick", simulation);
    if (alpha < alphaMin) {
      stepper.stop();
      event.call("end", simulation);
    }
  }
  function tick(iterations) {
    var i, n = nodes.length, node;
    if (iterations === void 0)
      iterations = 1;
    for (var k = 0; k < iterations; ++k) {
      alpha += (alphaTarget - alpha) * alphaDecay;
      forces.forEach(function(force) {
        force(alpha);
      });
      for (i = 0; i < n; ++i) {
        node = nodes[i];
        if (node.fx == null)
          node.x += node.vx *= velocityDecay;
        else
          node.x = node.fx, node.vx = 0;
        if (node.fy == null)
          node.y += node.vy *= velocityDecay;
        else
          node.y = node.fy, node.vy = 0;
      }
    }
    return simulation;
  }
  function initializeNodes() {
    for (var i = 0, n = nodes.length, node; i < n; ++i) {
      node = nodes[i], node.index = i;
      if (node.fx != null)
        node.x = node.fx;
      if (node.fy != null)
        node.y = node.fy;
      if (isNaN(node.x) || isNaN(node.y)) {
        var radius = initialRadius * Math.sqrt(0.5 + i), angle = i * initialAngle;
        node.x = radius * Math.cos(angle);
        node.y = radius * Math.sin(angle);
      }
      if (isNaN(node.vx) || isNaN(node.vy)) {
        node.vx = node.vy = 0;
      }
    }
  }
  function initializeForce(force) {
    if (force.initialize)
      force.initialize(nodes, random);
    return force;
  }
  initializeNodes();
  return simulation = {
    tick,
    restart: function() {
      return stepper.restart(step), simulation;
    },
    stop: function() {
      return stepper.stop(), simulation;
    },
    nodes: function(_) {
      return arguments.length ? (nodes = _, initializeNodes(), forces.forEach(initializeForce), simulation) : nodes;
    },
    alpha: function(_) {
      return arguments.length ? (alpha = +_, simulation) : alpha;
    },
    alphaMin: function(_) {
      return arguments.length ? (alphaMin = +_, simulation) : alphaMin;
    },
    alphaDecay: function(_) {
      return arguments.length ? (alphaDecay = +_, simulation) : +alphaDecay;
    },
    alphaTarget: function(_) {
      return arguments.length ? (alphaTarget = +_, simulation) : alphaTarget;
    },
    velocityDecay: function(_) {
      return arguments.length ? (velocityDecay = 1 - _, simulation) : 1 - velocityDecay;
    },
    randomSource: function(_) {
      return arguments.length ? (random = _, forces.forEach(initializeForce), simulation) : random;
    },
    force: function(name, _) {
      return arguments.length > 1 ? (_ == null ? forces.delete(name) : forces.set(name, initializeForce(_)), simulation) : forces.get(name);
    },
    find: function(x3, y3, radius) {
      var i = 0, n = nodes.length, dx, dy, d2, node, closest;
      if (radius == null)
        radius = Infinity;
      else
        radius *= radius;
      for (i = 0; i < n; ++i) {
        node = nodes[i];
        dx = x3 - node.x;
        dy = y3 - node.y;
        d2 = dx * dx + dy * dy;
        if (d2 < radius)
          closest = node, radius = d2;
      }
      return closest;
    },
    on: function(name, _) {
      return arguments.length > 1 ? (event.on(name, _), simulation) : event.on(name);
    }
  };
}

// node_modules/d3-force/src/manyBody.js
function manyBody_default() {
  var nodes, node, random, alpha, strength = constant_default5(-30), strengths, distanceMin2 = 1, distanceMax2 = Infinity, theta2 = 0.81;
  function force(_) {
    var i, n = nodes.length, tree = quadtree(nodes, x2, y2).visitAfter(accumulate);
    for (alpha = _, i = 0; i < n; ++i)
      node = nodes[i], tree.visit(apply);
  }
  function initialize() {
    if (!nodes)
      return;
    var i, n = nodes.length, node2;
    strengths = new Array(n);
    for (i = 0; i < n; ++i)
      node2 = nodes[i], strengths[node2.index] = +strength(node2, i, nodes);
  }
  function accumulate(quad) {
    var strength2 = 0, q, c2, weight = 0, x3, y3, i;
    if (quad.length) {
      for (x3 = y3 = i = 0; i < 4; ++i) {
        if ((q = quad[i]) && (c2 = Math.abs(q.value))) {
          strength2 += q.value, weight += c2, x3 += c2 * q.x, y3 += c2 * q.y;
        }
      }
      quad.x = x3 / weight;
      quad.y = y3 / weight;
    } else {
      q = quad;
      q.x = q.data.x;
      q.y = q.data.y;
      do
        strength2 += strengths[q.data.index];
      while (q = q.next);
    }
    quad.value = strength2;
  }
  function apply(quad, x1, _, x22) {
    if (!quad.value)
      return true;
    var x3 = quad.x - node.x, y3 = quad.y - node.y, w = x22 - x1, l = x3 * x3 + y3 * y3;
    if (w * w / theta2 < l) {
      if (l < distanceMax2) {
        if (x3 === 0)
          x3 = jiggle_default(random), l += x3 * x3;
        if (y3 === 0)
          y3 = jiggle_default(random), l += y3 * y3;
        if (l < distanceMin2)
          l = Math.sqrt(distanceMin2 * l);
        node.vx += x3 * quad.value * alpha / l;
        node.vy += y3 * quad.value * alpha / l;
      }
      return true;
    } else if (quad.length || l >= distanceMax2)
      return;
    if (quad.data !== node || quad.next) {
      if (x3 === 0)
        x3 = jiggle_default(random), l += x3 * x3;
      if (y3 === 0)
        y3 = jiggle_default(random), l += y3 * y3;
      if (l < distanceMin2)
        l = Math.sqrt(distanceMin2 * l);
    }
    do
      if (quad.data !== node) {
        w = strengths[quad.data.index] * alpha / l;
        node.vx += x3 * w;
        node.vy += y3 * w;
      }
    while (quad = quad.next);
  }
  force.initialize = function(_nodes, _random) {
    nodes = _nodes;
    random = _random;
    initialize();
  };
  force.strength = function(_) {
    return arguments.length ? (strength = typeof _ === "function" ? _ : constant_default5(+_), initialize(), force) : strength;
  };
  force.distanceMin = function(_) {
    return arguments.length ? (distanceMin2 = _ * _, force) : Math.sqrt(distanceMin2);
  };
  force.distanceMax = function(_) {
    return arguments.length ? (distanceMax2 = _ * _, force) : Math.sqrt(distanceMax2);
  };
  force.theta = function(_) {
    return arguments.length ? (theta2 = _ * _, force) : Math.sqrt(theta2);
  };
  return force;
}

// node_modules/d3-force/src/x.js
function x_default2(x3) {
  var strength = constant_default5(0.1), nodes, strengths, xz;
  if (typeof x3 !== "function")
    x3 = constant_default5(x3 == null ? 0 : +x3);
  function force(alpha) {
    for (var i = 0, n = nodes.length, node; i < n; ++i) {
      node = nodes[i], node.vx += (xz[i] - node.x) * strengths[i] * alpha;
    }
  }
  function initialize() {
    if (!nodes)
      return;
    var i, n = nodes.length;
    strengths = new Array(n);
    xz = new Array(n);
    for (i = 0; i < n; ++i) {
      strengths[i] = isNaN(xz[i] = +x3(nodes[i], i, nodes)) ? 0 : +strength(nodes[i], i, nodes);
    }
  }
  force.initialize = function(_) {
    nodes = _;
    initialize();
  };
  force.strength = function(_) {
    return arguments.length ? (strength = typeof _ === "function" ? _ : constant_default5(+_), initialize(), force) : strength;
  };
  force.x = function(_) {
    return arguments.length ? (x3 = typeof _ === "function" ? _ : constant_default5(+_), initialize(), force) : x3;
  };
  return force;
}

// node_modules/d3-force/src/y.js
function y_default2(y3) {
  var strength = constant_default5(0.1), nodes, strengths, yz;
  if (typeof y3 !== "function")
    y3 = constant_default5(y3 == null ? 0 : +y3);
  function force(alpha) {
    for (var i = 0, n = nodes.length, node; i < n; ++i) {
      node = nodes[i], node.vy += (yz[i] - node.y) * strengths[i] * alpha;
    }
  }
  function initialize() {
    if (!nodes)
      return;
    var i, n = nodes.length;
    strengths = new Array(n);
    yz = new Array(n);
    for (i = 0; i < n; ++i) {
      strengths[i] = isNaN(yz[i] = +y3(nodes[i], i, nodes)) ? 0 : +strength(nodes[i], i, nodes);
    }
  }
  force.initialize = function(_) {
    nodes = _;
    initialize();
  };
  force.strength = function(_) {
    return arguments.length ? (strength = typeof _ === "function" ? _ : constant_default5(+_), initialize(), force) : strength;
  };
  force.y = function(_) {
    return arguments.length ? (y3 = typeof _ === "function" ? _ : constant_default5(+_), initialize(), force) : y3;
  };
  return force;
}

// node_modules/d3-zoom/src/constant.js
var constant_default6 = (x3) => () => x3;

// node_modules/d3-zoom/src/event.js
function ZoomEvent(type2, {
  sourceEvent,
  target,
  transform: transform2,
  dispatch: dispatch2
}) {
  Object.defineProperties(this, {
    type: { value: type2, enumerable: true, configurable: true },
    sourceEvent: { value: sourceEvent, enumerable: true, configurable: true },
    target: { value: target, enumerable: true, configurable: true },
    transform: { value: transform2, enumerable: true, configurable: true },
    _: { value: dispatch2 }
  });
}

// node_modules/d3-zoom/src/transform.js
function Transform(k, x3, y3) {
  this.k = k;
  this.x = x3;
  this.y = y3;
}
Transform.prototype = {
  constructor: Transform,
  scale: function(k) {
    return k === 1 ? this : new Transform(this.k * k, this.x, this.y);
  },
  translate: function(x3, y3) {
    return x3 === 0 & y3 === 0 ? this : new Transform(this.k, this.x + this.k * x3, this.y + this.k * y3);
  },
  apply: function(point) {
    return [point[0] * this.k + this.x, point[1] * this.k + this.y];
  },
  applyX: function(x3) {
    return x3 * this.k + this.x;
  },
  applyY: function(y3) {
    return y3 * this.k + this.y;
  },
  invert: function(location) {
    return [(location[0] - this.x) / this.k, (location[1] - this.y) / this.k];
  },
  invertX: function(x3) {
    return (x3 - this.x) / this.k;
  },
  invertY: function(y3) {
    return (y3 - this.y) / this.k;
  },
  rescaleX: function(x3) {
    return x3.copy().domain(x3.range().map(this.invertX, this).map(x3.invert, x3));
  },
  rescaleY: function(y3) {
    return y3.copy().domain(y3.range().map(this.invertY, this).map(y3.invert, y3));
  },
  toString: function() {
    return "translate(" + this.x + "," + this.y + ") scale(" + this.k + ")";
  }
};
var identity2 = new Transform(1, 0, 0);
transform.prototype = Transform.prototype;
function transform(node) {
  while (!node.__zoom)
    if (!(node = node.parentNode))
      return identity2;
  return node.__zoom;
}

// node_modules/d3-zoom/src/noevent.js
function nopropagation3(event) {
  event.stopImmediatePropagation();
}
function noevent_default3(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

// node_modules/d3-zoom/src/zoom.js
function defaultFilter2(event) {
  return (!event.ctrlKey || event.type === "wheel") && !event.button;
}
function defaultExtent() {
  var e = this;
  if (e instanceof SVGElement) {
    e = e.ownerSVGElement || e;
    if (e.hasAttribute("viewBox")) {
      e = e.viewBox.baseVal;
      return [[e.x, e.y], [e.x + e.width, e.y + e.height]];
    }
    return [[0, 0], [e.width.baseVal.value, e.height.baseVal.value]];
  }
  return [[0, 0], [e.clientWidth, e.clientHeight]];
}
function defaultTransform() {
  return this.__zoom || identity2;
}
function defaultWheelDelta(event) {
  return -event.deltaY * (event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 2e-3) * (event.ctrlKey ? 10 : 1);
}
function defaultTouchable2() {
  return navigator.maxTouchPoints || "ontouchstart" in this;
}
function defaultConstrain(transform2, extent, translateExtent) {
  var dx0 = transform2.invertX(extent[0][0]) - translateExtent[0][0], dx1 = transform2.invertX(extent[1][0]) - translateExtent[1][0], dy0 = transform2.invertY(extent[0][1]) - translateExtent[0][1], dy1 = transform2.invertY(extent[1][1]) - translateExtent[1][1];
  return transform2.translate(
    dx1 > dx0 ? (dx0 + dx1) / 2 : Math.min(0, dx0) || Math.max(0, dx1),
    dy1 > dy0 ? (dy0 + dy1) / 2 : Math.min(0, dy0) || Math.max(0, dy1)
  );
}
function zoom_default2() {
  var filter2 = defaultFilter2, extent = defaultExtent, constrain = defaultConstrain, wheelDelta = defaultWheelDelta, touchable = defaultTouchable2, scaleExtent = [0, Infinity], translateExtent = [[-Infinity, -Infinity], [Infinity, Infinity]], duration = 250, interpolate = zoom_default, listeners = dispatch_default("start", "zoom", "end"), touchstarting, touchfirst, touchending, touchDelay = 500, wheelDelay = 150, clickDistance2 = 0, tapDistance = 10;
  function zoom(selection2) {
    selection2.property("__zoom", defaultTransform).on("wheel.zoom", wheeled, { passive: false }).on("mousedown.zoom", mousedowned).on("dblclick.zoom", dblclicked).filter(touchable).on("touchstart.zoom", touchstarted).on("touchmove.zoom", touchmoved).on("touchend.zoom touchcancel.zoom", touchended).style("-webkit-tap-highlight-color", "rgba(0,0,0,0)");
  }
  zoom.transform = function(collection, transform2, point, event) {
    var selection2 = collection.selection ? collection.selection() : collection;
    selection2.property("__zoom", defaultTransform);
    if (collection !== selection2) {
      schedule(collection, transform2, point, event);
    } else {
      selection2.interrupt().each(function() {
        gesture(this, arguments).event(event).start().zoom(null, typeof transform2 === "function" ? transform2.apply(this, arguments) : transform2).end();
      });
    }
  };
  zoom.scaleBy = function(selection2, k, p, event) {
    zoom.scaleTo(selection2, function() {
      var k0 = this.__zoom.k, k1 = typeof k === "function" ? k.apply(this, arguments) : k;
      return k0 * k1;
    }, p, event);
  };
  zoom.scaleTo = function(selection2, k, p, event) {
    zoom.transform(selection2, function() {
      var e = extent.apply(this, arguments), t0 = this.__zoom, p0 = p == null ? centroid(e) : typeof p === "function" ? p.apply(this, arguments) : p, p1 = t0.invert(p0), k1 = typeof k === "function" ? k.apply(this, arguments) : k;
      return constrain(translate(scale(t0, k1), p0, p1), e, translateExtent);
    }, p, event);
  };
  zoom.translateBy = function(selection2, x3, y3, event) {
    zoom.transform(selection2, function() {
      return constrain(this.__zoom.translate(
        typeof x3 === "function" ? x3.apply(this, arguments) : x3,
        typeof y3 === "function" ? y3.apply(this, arguments) : y3
      ), extent.apply(this, arguments), translateExtent);
    }, null, event);
  };
  zoom.translateTo = function(selection2, x3, y3, p, event) {
    zoom.transform(selection2, function() {
      var e = extent.apply(this, arguments), t = this.__zoom, p0 = p == null ? centroid(e) : typeof p === "function" ? p.apply(this, arguments) : p;
      return constrain(identity2.translate(p0[0], p0[1]).scale(t.k).translate(
        typeof x3 === "function" ? -x3.apply(this, arguments) : -x3,
        typeof y3 === "function" ? -y3.apply(this, arguments) : -y3
      ), e, translateExtent);
    }, p, event);
  };
  function scale(transform2, k) {
    k = Math.max(scaleExtent[0], Math.min(scaleExtent[1], k));
    return k === transform2.k ? transform2 : new Transform(k, transform2.x, transform2.y);
  }
  function translate(transform2, p0, p1) {
    var x3 = p0[0] - p1[0] * transform2.k, y3 = p0[1] - p1[1] * transform2.k;
    return x3 === transform2.x && y3 === transform2.y ? transform2 : new Transform(transform2.k, x3, y3);
  }
  function centroid(extent2) {
    return [(+extent2[0][0] + +extent2[1][0]) / 2, (+extent2[0][1] + +extent2[1][1]) / 2];
  }
  function schedule(transition2, transform2, point, event) {
    transition2.on("start.zoom", function() {
      gesture(this, arguments).event(event).start();
    }).on("interrupt.zoom end.zoom", function() {
      gesture(this, arguments).event(event).end();
    }).tween("zoom", function() {
      var that = this, args = arguments, g = gesture(that, args).event(event), e = extent.apply(that, args), p = point == null ? centroid(e) : typeof point === "function" ? point.apply(that, args) : point, w = Math.max(e[1][0] - e[0][0], e[1][1] - e[0][1]), a2 = that.__zoom, b = typeof transform2 === "function" ? transform2.apply(that, args) : transform2, i = interpolate(a2.invert(p).concat(w / a2.k), b.invert(p).concat(w / b.k));
      return function(t) {
        if (t === 1)
          t = b;
        else {
          var l = i(t), k = w / l[2];
          t = new Transform(k, p[0] - l[0] * k, p[1] - l[1] * k);
        }
        g.zoom(null, t);
      };
    });
  }
  function gesture(that, args, clean) {
    return !clean && that.__zooming || new Gesture(that, args);
  }
  function Gesture(that, args) {
    this.that = that;
    this.args = args;
    this.active = 0;
    this.sourceEvent = null;
    this.extent = extent.apply(that, args);
    this.taps = 0;
  }
  Gesture.prototype = {
    event: function(event) {
      if (event)
        this.sourceEvent = event;
      return this;
    },
    start: function() {
      if (++this.active === 1) {
        this.that.__zooming = this;
        this.emit("start");
      }
      return this;
    },
    zoom: function(key, transform2) {
      if (this.mouse && key !== "mouse")
        this.mouse[1] = transform2.invert(this.mouse[0]);
      if (this.touch0 && key !== "touch")
        this.touch0[1] = transform2.invert(this.touch0[0]);
      if (this.touch1 && key !== "touch")
        this.touch1[1] = transform2.invert(this.touch1[0]);
      this.that.__zoom = transform2;
      this.emit("zoom");
      return this;
    },
    end: function() {
      if (--this.active === 0) {
        delete this.that.__zooming;
        this.emit("end");
      }
      return this;
    },
    emit: function(type2) {
      var d = select_default2(this.that).datum();
      listeners.call(
        type2,
        this.that,
        new ZoomEvent(type2, {
          sourceEvent: this.sourceEvent,
          target: zoom,
          type: type2,
          transform: this.that.__zoom,
          dispatch: listeners
        }),
        d
      );
    }
  };
  function wheeled(event, ...args) {
    if (!filter2.apply(this, arguments))
      return;
    var g = gesture(this, args).event(event), t = this.__zoom, k = Math.max(scaleExtent[0], Math.min(scaleExtent[1], t.k * Math.pow(2, wheelDelta.apply(this, arguments)))), p = pointer_default(event);
    if (g.wheel) {
      if (g.mouse[0][0] !== p[0] || g.mouse[0][1] !== p[1]) {
        g.mouse[1] = t.invert(g.mouse[0] = p);
      }
      clearTimeout(g.wheel);
    } else if (t.k === k)
      return;
    else {
      g.mouse = [p, t.invert(p)];
      interrupt_default(this);
      g.start();
    }
    noevent_default3(event);
    g.wheel = setTimeout(wheelidled, wheelDelay);
    g.zoom("mouse", constrain(translate(scale(t, k), g.mouse[0], g.mouse[1]), g.extent, translateExtent));
    function wheelidled() {
      g.wheel = null;
      g.end();
    }
  }
  function mousedowned(event, ...args) {
    if (touchending || !filter2.apply(this, arguments))
      return;
    var currentTarget = event.currentTarget, g = gesture(this, args, true).event(event), v = select_default2(event.view).on("mousemove.zoom", mousemoved, true).on("mouseup.zoom", mouseupped, true), p = pointer_default(event, currentTarget), x0 = event.clientX, y0 = event.clientY;
    nodrag_default(event.view);
    nopropagation3(event);
    g.mouse = [p, this.__zoom.invert(p)];
    interrupt_default(this);
    g.start();
    function mousemoved(event2) {
      noevent_default3(event2);
      if (!g.moved) {
        var dx = event2.clientX - x0, dy = event2.clientY - y0;
        g.moved = dx * dx + dy * dy > clickDistance2;
      }
      g.event(event2).zoom("mouse", constrain(translate(g.that.__zoom, g.mouse[0] = pointer_default(event2, currentTarget), g.mouse[1]), g.extent, translateExtent));
    }
    function mouseupped(event2) {
      v.on("mousemove.zoom mouseup.zoom", null);
      yesdrag(event2.view, g.moved);
      noevent_default3(event2);
      g.event(event2).end();
    }
  }
  function dblclicked(event, ...args) {
    if (!filter2.apply(this, arguments))
      return;
    var t0 = this.__zoom, p0 = pointer_default(event.changedTouches ? event.changedTouches[0] : event, this), p1 = t0.invert(p0), k1 = t0.k * (event.shiftKey ? 0.5 : 2), t1 = constrain(translate(scale(t0, k1), p0, p1), extent.apply(this, args), translateExtent);
    noevent_default3(event);
    if (duration > 0)
      select_default2(this).transition().duration(duration).call(schedule, t1, p0, event);
    else
      select_default2(this).call(zoom.transform, t1, p0, event);
  }
  function touchstarted(event, ...args) {
    if (!filter2.apply(this, arguments))
      return;
    var touches = event.touches, n = touches.length, g = gesture(this, args, event.changedTouches.length === n).event(event), started, i, t, p;
    nopropagation3(event);
    for (i = 0; i < n; ++i) {
      t = touches[i], p = pointer_default(t, this);
      p = [p, this.__zoom.invert(p), t.identifier];
      if (!g.touch0)
        g.touch0 = p, started = true, g.taps = 1 + !!touchstarting;
      else if (!g.touch1 && g.touch0[2] !== p[2])
        g.touch1 = p, g.taps = 0;
    }
    if (touchstarting)
      touchstarting = clearTimeout(touchstarting);
    if (started) {
      if (g.taps < 2)
        touchfirst = p[0], touchstarting = setTimeout(function() {
          touchstarting = null;
        }, touchDelay);
      interrupt_default(this);
      g.start();
    }
  }
  function touchmoved(event, ...args) {
    if (!this.__zooming)
      return;
    var g = gesture(this, args).event(event), touches = event.changedTouches, n = touches.length, i, t, p, l;
    noevent_default3(event);
    for (i = 0; i < n; ++i) {
      t = touches[i], p = pointer_default(t, this);
      if (g.touch0 && g.touch0[2] === t.identifier)
        g.touch0[0] = p;
      else if (g.touch1 && g.touch1[2] === t.identifier)
        g.touch1[0] = p;
    }
    t = g.that.__zoom;
    if (g.touch1) {
      var p0 = g.touch0[0], l0 = g.touch0[1], p1 = g.touch1[0], l1 = g.touch1[1], dp = (dp = p1[0] - p0[0]) * dp + (dp = p1[1] - p0[1]) * dp, dl = (dl = l1[0] - l0[0]) * dl + (dl = l1[1] - l0[1]) * dl;
      t = scale(t, Math.sqrt(dp / dl));
      p = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
      l = [(l0[0] + l1[0]) / 2, (l0[1] + l1[1]) / 2];
    } else if (g.touch0)
      p = g.touch0[0], l = g.touch0[1];
    else
      return;
    g.zoom("touch", constrain(translate(t, p, l), g.extent, translateExtent));
  }
  function touchended(event, ...args) {
    if (!this.__zooming)
      return;
    var g = gesture(this, args).event(event), touches = event.changedTouches, n = touches.length, i, t;
    nopropagation3(event);
    if (touchending)
      clearTimeout(touchending);
    touchending = setTimeout(function() {
      touchending = null;
    }, touchDelay);
    for (i = 0; i < n; ++i) {
      t = touches[i];
      if (g.touch0 && g.touch0[2] === t.identifier)
        delete g.touch0;
      else if (g.touch1 && g.touch1[2] === t.identifier)
        delete g.touch1;
    }
    if (g.touch1 && !g.touch0)
      g.touch0 = g.touch1, delete g.touch1;
    if (g.touch0)
      g.touch0[1] = this.__zoom.invert(g.touch0[0]);
    else {
      g.end();
      if (g.taps === 2) {
        t = pointer_default(t, this);
        if (Math.hypot(touchfirst[0] - t[0], touchfirst[1] - t[1]) < tapDistance) {
          var p = select_default2(this).on("dblclick.zoom");
          if (p)
            p.apply(this, arguments);
        }
      }
    }
  }
  zoom.wheelDelta = function(_) {
    return arguments.length ? (wheelDelta = typeof _ === "function" ? _ : constant_default6(+_), zoom) : wheelDelta;
  };
  zoom.filter = function(_) {
    return arguments.length ? (filter2 = typeof _ === "function" ? _ : constant_default6(!!_), zoom) : filter2;
  };
  zoom.touchable = function(_) {
    return arguments.length ? (touchable = typeof _ === "function" ? _ : constant_default6(!!_), zoom) : touchable;
  };
  zoom.extent = function(_) {
    return arguments.length ? (extent = typeof _ === "function" ? _ : constant_default6([[+_[0][0], +_[0][1]], [+_[1][0], +_[1][1]]]), zoom) : extent;
  };
  zoom.scaleExtent = function(_) {
    return arguments.length ? (scaleExtent[0] = +_[0], scaleExtent[1] = +_[1], zoom) : [scaleExtent[0], scaleExtent[1]];
  };
  zoom.translateExtent = function(_) {
    return arguments.length ? (translateExtent[0][0] = +_[0][0], translateExtent[1][0] = +_[1][0], translateExtent[0][1] = +_[0][1], translateExtent[1][1] = +_[1][1], zoom) : [[translateExtent[0][0], translateExtent[0][1]], [translateExtent[1][0], translateExtent[1][1]]];
  };
  zoom.constrain = function(_) {
    return arguments.length ? (constrain = _, zoom) : constrain;
  };
  zoom.duration = function(_) {
    return arguments.length ? (duration = +_, zoom) : duration;
  };
  zoom.interpolate = function(_) {
    return arguments.length ? (interpolate = _, zoom) : interpolate;
  };
  zoom.on = function() {
    var value = listeners.on.apply(listeners, arguments);
    return value === listeners ? zoom : value;
  };
  zoom.clickDistance = function(_) {
    return arguments.length ? (clickDistance2 = (_ = +_) * _, zoom) : Math.sqrt(clickDistance2);
  };
  zoom.tapDistance = function(_) {
    return arguments.length ? (tapDistance = +_, zoom) : tapDistance;
  };
  return zoom;
}

// src/settings.ts
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  objectFileTag: "object-links"
};
var ObjectLinksSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Object Links" });
    new import_obsidian.Setting(containerEl).setName("Object file tag").setDesc(
      "Tag used to identify object files. Only markdown files that include this tag will be parsed. Supports bare #tags (e.g. #object-links on any line) and YAML frontmatter tags (e.g. tags: [object-links])."
    ).addText(
      (text) => text.setPlaceholder("object-links").setValue(this.plugin.settings.objectFileTag).onChange(async (value) => {
        this.plugin.settings.objectFileTag = value.trim();
        await this.plugin.saveSettings();
      })
    );
  }
};
var DEFAULT_CONFIG = {
  search: "",
  showOrphans: false,
  showFiles: true,
  showObjects: true,
  showWikiEdges: true,
  showObjectEdges: true,
  pathFilter: "",
  sourceFilter: "",
  nodeSizeMultiplier: 1,
  linkDistance: 150,
  centerStrength: 0.04,
  repelStrength: 400,
  labelOpacity: 0.65
};
var ConfigPanel = class {
  constructor(parent, config, onChange) {
    this.collapsed = {
      filter: false,
      display: true
    };
    this.config = { ...config };
    this.onChange = onChange;
    this.containerEl = document.createElement("div");
    this.containerEl.className = "ol-config-panel";
    parent.appendChild(this.containerEl);
    this.render();
  }
  getConfig() {
    return { ...this.config };
  }
  destroy() {
    this.containerEl.remove();
  }
  render() {
    this.containerEl.empty();
    this.renderSection("filter", "Filters", () => {
      this.renderTextInput("Search", this.config.search, (v) => {
        this.config.search = v;
        this.emit();
      });
      this.renderTextInput("Path filter", this.config.pathFilter, (v) => {
        this.config.pathFilter = v;
        this.emit();
      }, "e.g. 00 Daily");
      this.renderTextInput("Source filter", this.config.sourceFilter, (v) => {
        this.config.sourceFilter = v;
        this.emit();
      }, "e.g. Films");
      this.renderToggle("Show files", this.config.showFiles, (v) => {
        this.config.showFiles = v;
        this.emit();
      });
      this.renderToggle("Show objects", this.config.showObjects, (v) => {
        this.config.showObjects = v;
        this.emit();
      });
      this.renderToggle("Show orphans", this.config.showOrphans, (v) => {
        this.config.showOrphans = v;
        this.emit();
      });
      this.renderToggle("Wiki links", this.config.showWikiEdges, (v) => {
        this.config.showWikiEdges = v;
        this.emit();
      });
      this.renderToggle("Object links", this.config.showObjectEdges, (v) => {
        this.config.showObjectEdges = v;
        this.emit();
      });
    });
    this.renderSection("display", "Display", () => {
      this.renderSlider("Node size", this.config.nodeSizeMultiplier, 0.2, 3, 0.1, (v) => {
        this.config.nodeSizeMultiplier = v;
        this.emit();
      });
      this.renderSlider("Link distance", this.config.linkDistance, 30, 500, 10, (v) => {
        this.config.linkDistance = v;
        this.emit();
      });
      this.renderSlider("Center force", this.config.centerStrength, 0, 0.2, 5e-3, (v) => {
        this.config.centerStrength = v;
        this.emit();
      });
      this.renderSlider("Repel force", this.config.repelStrength, 50, 1e3, 25, (v) => {
        this.config.repelStrength = v;
        this.emit();
      });
      this.renderSlider("Label opacity", this.config.labelOpacity, 0, 1, 0.05, (v) => {
        this.config.labelOpacity = v;
        this.emit();
      });
    });
  }
  renderSection(key, title, contentFn) {
    const section = document.createElement("div");
    section.className = "ol-config-section";
    const header = document.createElement("div");
    header.className = "ol-config-section-header";
    header.addEventListener("click", () => {
      this.collapsed[key] = !this.collapsed[key];
      this.render();
    });
    const arrow = document.createElement("span");
    arrow.className = "ol-config-arrow";
    arrow.textContent = this.collapsed[key] ? "\u25B6" : "\u25BC";
    header.appendChild(arrow);
    const titleEl = document.createElement("span");
    titleEl.textContent = title;
    header.appendChild(titleEl);
    section.appendChild(header);
    if (!this.collapsed[key]) {
      const content = document.createElement("div");
      content.className = "ol-config-section-content";
      section.appendChild(content);
      const savedContainer = this.containerEl;
      this.containerEl = content;
      contentFn();
      this.containerEl = savedContainer;
    }
    const panel = document.querySelector(".ol-config-panel");
    if (panel) {
      panel.appendChild(section);
    }
  }
  renderTextInput(label, value, onChange, placeholder) {
    const row = document.createElement("div");
    row.className = "ol-config-row";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "ol-config-input";
    input.placeholder = placeholder || label;
    input.value = value;
    input.addEventListener("input", () => onChange(input.value));
    row.appendChild(input);
    this.containerEl.appendChild(row);
  }
  renderToggle(label, value, onChange) {
    const row = document.createElement("div");
    row.className = "ol-config-row ol-config-toggle-row";
    const labelEl = document.createElement("span");
    labelEl.className = "ol-config-label";
    labelEl.textContent = label;
    row.appendChild(labelEl);
    const toggle = document.createElement("div");
    toggle.className = `ol-config-toggle ${value ? "is-enabled" : ""}`;
    toggle.addEventListener("click", () => {
      const newVal = !value;
      onChange(newVal);
    });
    const knob = document.createElement("div");
    knob.className = "ol-config-toggle-knob";
    toggle.appendChild(knob);
    row.appendChild(toggle);
    this.containerEl.appendChild(row);
  }
  renderSlider(label, value, min2, max2, step, onChange) {
    const row = document.createElement("div");
    row.className = "ol-config-row ol-config-slider-row";
    const labelEl = document.createElement("span");
    labelEl.className = "ol-config-label";
    labelEl.textContent = label;
    row.appendChild(labelEl);
    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "ol-config-slider";
    slider.min = String(min2);
    slider.max = String(max2);
    slider.step = String(step);
    slider.value = String(value);
    slider.addEventListener("input", () => {
      onChange(parseFloat(slider.value));
    });
    row.appendChild(slider);
    this.containerEl.appendChild(row);
  }
  emit() {
    this.onChange({ ...this.config });
  }
};

// src/graph-view.ts
var VIEW_TYPE = "object-links-graph";
var GraphView = class extends import_obsidian2.ItemView {
  constructor(leaf) {
    super(leaf);
    this.graphData = null;
    this.simulation = null;
    this.resizeObserver = null;
    this.configPanel = null;
    this.config = { ...DEFAULT_CONFIG };
    /** Callback set by the plugin to navigate to an object */
    this.navigateToObject = null;
    /** Callback set by the plugin to navigate to a file */
    this.navigateToFile = null;
  }
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "Object Links";
  }
  getIcon() {
    return "git-fork";
  }
  setGraphData(data) {
    this.graphData = data;
    if (this.containerEl) {
      this.renderGraph();
    }
  }
  async onOpen() {
    const container = this.contentEl;
    container.empty();
    container.addClass("ol-graph-container");
    if (this.graphData) {
      this.renderGraph();
    } else {
      container.createEl("div", {
        cls: "ol-empty-state",
        text: "Open the graph using the command palette or ribbon icon."
      });
    }
  }
  async onClose() {
    this.cleanup();
  }
  cleanup() {
    if (this.simulation) {
      this.simulation.stop();
      this.simulation = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.configPanel) {
      this.configPanel.destroy();
      this.configPanel = null;
    }
  }
  applyFilters(data) {
    const c2 = this.config;
    let nodes = [...data.nodes];
    let edges = [...data.edges];
    if (!c2.showFiles) {
      const fileIds = new Set(nodes.filter((n) => n.type === "file").map((n) => n.id));
      nodes = nodes.filter((n) => n.type !== "file");
      edges = edges.filter((e) => !fileIds.has(e.source) && !fileIds.has(e.target));
    }
    if (!c2.showObjects) {
      const objIds = new Set(nodes.filter((n) => n.type === "object").map((n) => n.id));
      nodes = nodes.filter((n) => n.type !== "object");
      edges = edges.filter((e) => !objIds.has(e.source) && !objIds.has(e.target));
    }
    if (!c2.showWikiEdges) {
      edges = edges.filter((e) => e.edgeType !== "wiki");
    }
    if (!c2.showObjectEdges) {
      edges = edges.filter((e) => e.edgeType !== "object");
    }
    if (c2.search) {
      const q = c2.search.toLowerCase();
      const matchedIds = new Set(
        nodes.filter((n) => n.label.toLowerCase().includes(q)).map((n) => n.id)
      );
      for (const e of edges) {
        if (matchedIds.has(e.source))
          matchedIds.add(e.target);
        if (matchedIds.has(e.target))
          matchedIds.add(e.source);
      }
      nodes = nodes.filter((n) => matchedIds.has(n.id));
      const nodeIds = new Set(nodes.map((n) => n.id));
      edges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
    }
    if (c2.pathFilter) {
      const pf = c2.pathFilter.toLowerCase();
      const matchedIds = new Set(
        nodes.filter((n) => n.filePath.toLowerCase().includes(pf)).map((n) => n.id)
      );
      for (const e of edges) {
        if (matchedIds.has(e.source))
          matchedIds.add(e.target);
        if (matchedIds.has(e.target))
          matchedIds.add(e.source);
      }
      nodes = nodes.filter((n) => matchedIds.has(n.id));
      const nodeIds = new Set(nodes.map((n) => n.id));
      edges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
    }
    if (c2.sourceFilter) {
      const sf = c2.sourceFilter.toLowerCase();
      const removedIds = new Set(
        nodes.filter(
          (n) => n.type === "object" && !n.fileLabel.toLowerCase().includes(sf)
        ).map((n) => n.id)
      );
      nodes = nodes.filter((n) => !removedIds.has(n.id));
      edges = edges.filter(
        (e) => !removedIds.has(e.source) && !removedIds.has(e.target)
      );
    }
    if (!c2.showOrphans) {
      const connectedIds = /* @__PURE__ */ new Set();
      for (const e of edges) {
        connectedIds.add(e.source);
        connectedIds.add(e.target);
      }
      nodes = nodes.filter((n) => connectedIds.has(n.id));
    }
    const connCount = /* @__PURE__ */ new Map();
    for (const e of edges) {
      connCount.set(e.source, (connCount.get(e.source) || 0) + 1);
      connCount.set(e.target, (connCount.get(e.target) || 0) + 1);
    }
    for (const n of nodes) {
      n.connections = connCount.get(n.id) || 0;
    }
    return { nodes, edges };
  }
  renderGraph() {
    if (!this.graphData)
      return;
    const container = this.contentEl;
    container.empty();
    container.addClass("ol-graph-container");
    this.configPanel = new ConfigPanel(container, this.config, (newConfig) => {
      this.config = newConfig;
      this.renderGraph();
    });
    const filtered = this.applyFilters(this.graphData);
    if (filtered.nodes.length === 0) {
      container.createEl("div", {
        cls: "ol-empty-state",
        text: "No nodes match the current filters."
      });
      return;
    }
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;
    const svg = select_default2(container).append("svg").attr("class", "ol-graph-svg").attr("width", "100%").attr("height", "100%").attr("viewBox", `0 0 ${width} ${height}`);
    svg.append("rect").attr("width", width).attr("height", height).attr("fill", "transparent").on("click", () => {
      this.clearSelection(nodeGroup, edgeGroup, labelGroup, container);
    });
    const g = svg.append("g").attr("class", "ol-zoom-group");
    const zoom = zoom_default2().scaleExtent([0.03, 12]).on("zoom", (event) => {
      g.attr("transform", event.transform);
    });
    svg.call(zoom);
    svg.call(
      zoom.transform,
      identity2.translate(width / 2, height / 2).scale(0.7)
    );
    const c2 = this.config;
    const simNodes = filtered.nodes.map((n) => ({
      ...n,
      x: (Math.random() - 0.5) * width * 0.6,
      y: (Math.random() - 0.5) * height * 0.6
    }));
    const nodeMap = new Map(simNodes.map((n) => [n.id, n]));
    const simEdges = filtered.edges.map((e) => ({
      source: nodeMap.get(e.source),
      target: nodeMap.get(e.target),
      edgeType: e.edgeType
    })).filter((e) => e.source && e.target);
    const edgeGroup = g.append("g").attr("class", "ol-edges").selectAll("line").data(simEdges).enter().append("line").attr(
      "class",
      (d) => d.edgeType === "object" ? "ol-edge ol-edge-obj" : "ol-edge ol-edge-wiki"
    );
    const self = this;
    let lastClickTime = 0;
    let lastClickId = "";
    const nodeGroup = g.append("g").attr("class", "ol-nodes").selectAll("circle").data(simNodes).enter().append("circle").attr(
      "class",
      (d) => d.type === "object" ? "ol-node ol-node-object" : "ol-node ol-node-file"
    ).attr("r", (d) => this.getNodeRadius(d)).on("mouseenter", (_event, d) => {
      this.highlightNode(d, simEdges, nodeGroup, edgeGroup, labelGroup);
      this.showTooltip(d, container);
    }).on("mouseleave", () => {
      this.unhighlightAll(nodeGroup, edgeGroup, labelGroup);
      this.hideTooltip(container);
    }).on("click", function(_event, d) {
      _event.stopPropagation();
      const now2 = Date.now();
      if (lastClickId === d.id && now2 - lastClickTime < 300) {
        if (d.type === "object" && self.navigateToObject) {
          self.navigateToObject(d.filePath, d.startLine);
        } else if (d.type === "file" && self.navigateToFile) {
          self.navigateToFile(d.filePath);
        }
        lastClickTime = 0;
        lastClickId = "";
        return;
      }
      lastClickTime = now2;
      lastClickId = d.id;
      self.selectNode(
        d,
        simEdges,
        nodeGroup,
        edgeGroup,
        labelGroup,
        container
      );
    }).call(
      drag_default().on("start", (event, d) => {
        if (!event.active && this.simulation)
          this.simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      }).on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      }).on("end", (event, d) => {
        if (!event.active && this.simulation)
          this.simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      })
    );
    const labelGroup = g.append("g").attr("class", "ol-labels").selectAll("text").data(simNodes).enter().append("text").attr("class", "ol-label").text((d) => d.label).attr("dy", (d) => this.getNodeRadius(d) + 14).style("opacity", c2.labelOpacity);
    this.simulation = simulation_default(simNodes).force(
      "link",
      link_default(simEdges).id((d) => d.id).distance(c2.linkDistance).strength(0.6)
    ).force(
      "charge",
      manyBody_default().strength(-c2.repelStrength).distanceMax(c2.repelStrength * 1.5)
    ).force("center", center_default(0, 0).strength(c2.centerStrength)).force(
      "collision",
      collide_default().radius((d) => this.getNodeRadius(d) + 8)
    ).force("x", x_default2(0).strength(0.012)).force("y", y_default2(0).strength(0.012)).alphaDecay(0.015).on("tick", () => {
      edgeGroup.attr("x1", (d) => d.source.x).attr("y1", (d) => d.source.y).attr("x2", (d) => d.target.x).attr("y2", (d) => d.target.y);
      nodeGroup.attr("cx", (d) => d.x).attr("cy", (d) => d.y);
      labelGroup.attr("x", (d) => d.x).attr("y", (d) => d.y);
    });
    this.resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      svg.attr("viewBox", `0 0 ${w} ${h}`);
    });
    this.resizeObserver.observe(container);
  }
  getNodeRadius(d) {
    const c2 = this.config.nodeSizeMultiplier;
    const base = d.type === "file" ? 4 : 5;
    return Math.max(base, Math.min(20, base + d.connections * 1.5)) * c2;
  }
  highlightNode(d, edges, nodeGroup, edgeGroup, labelGroup) {
    const connected = /* @__PURE__ */ new Set();
    connected.add(d.id);
    edges.forEach((e) => {
      const s = typeof e.source === "object" ? e.source.id : e.source;
      const t = typeof e.target === "object" ? e.target.id : e.target;
      if (s === d.id)
        connected.add(t);
      if (t === d.id)
        connected.add(s);
    });
    nodeGroup.classed("ol-dimmed", (n) => !connected.has(n.id));
    nodeGroup.classed("ol-highlighted", (n) => n.id === d.id);
    edgeGroup.classed("ol-dimmed", (e) => {
      const s = typeof e.source === "object" ? e.source.id : e.source;
      const t = typeof e.target === "object" ? e.target.id : e.target;
      return s !== d.id && t !== d.id;
    });
    edgeGroup.classed("ol-edge-highlighted", (e) => {
      const s = typeof e.source === "object" ? e.source.id : e.source;
      const t = typeof e.target === "object" ? e.target.id : e.target;
      return s === d.id || t === d.id;
    });
    labelGroup.classed("ol-dimmed", (n) => !connected.has(n.id));
    labelGroup.classed("ol-label-visible", (n) => connected.has(n.id));
  }
  unhighlightAll(nodeGroup, edgeGroup, labelGroup) {
    nodeGroup.classed("ol-dimmed", false).classed("ol-highlighted", false);
    edgeGroup.classed("ol-dimmed", false).classed("ol-edge-highlighted", false);
    labelGroup.classed("ol-dimmed", false).classed("ol-label-visible", false);
  }
  clearSelection(nodeGroup, edgeGroup, labelGroup, container) {
    this.unhighlightAll(nodeGroup, edgeGroup, labelGroup);
    const panel = container.querySelector(".ol-info-panel");
    if (panel)
      panel.remove();
  }
  selectNode(d, edges, nodeGroup, edgeGroup, labelGroup, container) {
    this.highlightNode(d, edges, nodeGroup, edgeGroup, labelGroup);
    const existing = container.querySelector(".ol-info-panel");
    if (existing)
      existing.remove();
    const panel = document.createElement("div");
    panel.className = "ol-info-panel";
    const title = document.createElement("div");
    title.className = "ol-info-title";
    title.textContent = d.label;
    panel.appendChild(title);
    const badge = document.createElement("div");
    badge.className = `ol-info-type ol-info-type-${d.type}`;
    badge.textContent = d.type === "object" ? "Object" : "File";
    panel.appendChild(badge);
    const filePath = document.createElement("div");
    filePath.className = "ol-info-file";
    filePath.textContent = d.filePath;
    panel.appendChild(filePath);
    if (d.type === "object" && Object.keys(d.properties).length > 0) {
      const props = document.createElement("div");
      props.className = "ol-info-props";
      for (const [k, v] of Object.entries(d.properties)) {
        const row = document.createElement("div");
        row.className = "ol-info-prop-row";
        const keyEl = document.createElement("span");
        keyEl.className = "ol-info-prop-key";
        keyEl.textContent = k;
        const valEl = document.createElement("span");
        valEl.className = "ol-info-prop-val";
        valEl.textContent = v;
        row.appendChild(keyEl);
        row.appendChild(valEl);
        props.appendChild(row);
      }
      panel.appendChild(props);
    }
    const conn = document.createElement("div");
    conn.className = "ol-info-connections";
    conn.textContent = `${d.connections} connection${d.connections !== 1 ? "s" : ""}`;
    panel.appendChild(conn);
    const goBtn = document.createElement("button");
    goBtn.className = "ol-info-go-btn";
    goBtn.textContent = d.type === "object" ? "Go to object" : "Open file";
    goBtn.addEventListener("click", () => {
      if (d.type === "object" && this.navigateToObject) {
        this.navigateToObject(d.filePath, d.startLine);
      } else if (this.navigateToFile) {
        this.navigateToFile(d.filePath);
      }
    });
    panel.appendChild(goBtn);
    container.appendChild(panel);
  }
  showTooltip(d, container) {
    let tooltip = container.querySelector(".ol-tooltip");
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.className = "ol-tooltip";
      container.appendChild(tooltip);
    }
    tooltip.textContent = d.label;
    tooltip.style.display = "block";
    const onMove = (e) => {
      const rect = container.getBoundingClientRect();
      tooltip.style.left = e.clientX - rect.left + 14 + "px";
      tooltip.style.top = e.clientY - rect.top - 10 + "px";
    };
    container.addEventListener("mousemove", onMove);
    tooltip.__moveHandler = onMove;
  }
  hideTooltip(container) {
    const tooltip = container.querySelector(".ol-tooltip");
    if (tooltip) {
      tooltip.style.display = "none";
      if (tooltip.__moveHandler) {
        container.removeEventListener("mousemove", tooltip.__moveHandler);
      }
    }
  }
};

// src/suggest.ts
var import_obsidian3 = require("obsidian");
var ObjectLinkSuggest = class extends import_obsidian3.EditorSuggest {
  constructor() {
    super(...arguments);
    this.objects = [];
  }
  setObjects(objects) {
    this.objects = objects.map((o) => ({
      displayKey: o.displayKey,
      keyValue: o.keyValue,
      fileLabel: o.fileLabel,
      filePath: o.filePath,
      properties: o.properties
    }));
  }
  onTrigger(cursor, editor, _file) {
    const line = editor.getLine(cursor.line);
    const sub = line.substring(0, cursor.ch);
    const lastOpen = sub.lastIndexOf("{{");
    if (lastOpen === -1)
      return null;
    const afterOpen = sub.substring(lastOpen + 2);
    if (afterOpen.includes("}}"))
      return null;
    const query = afterOpen;
    return {
      start: { line: cursor.line, ch: lastOpen + 2 },
      end: cursor,
      query
    };
  }
  getSuggestions(context) {
    const query = context.query.toLowerCase();
    if (!query)
      return this.objects.slice(0, 20);
    return this.objects.filter(
      (o) => o.displayKey.toLowerCase().includes(query) || o.keyValue.toLowerCase().includes(query)
    ).slice(0, 20);
  }
  renderSuggestion(suggestion, el) {
    const container = el.createDiv({ cls: "ol-suggestion" });
    const titleEl = container.createDiv({ cls: "ol-suggestion-title" });
    titleEl.textContent = suggestion.displayKey;
    const fileEl = container.createDiv({ cls: "ol-suggestion-file" });
    fileEl.textContent = suggestion.fileLabel;
  }
  selectSuggestion(suggestion, _evt) {
    if (!this.context)
      return;
    const editor = this.context.editor;
    const start2 = this.context.start;
    const end = this.context.end;
    const lineText = editor.getLine(end.line);
    const afterCursor = lineText.substring(end.ch);
    const hasClosing = afterCursor.startsWith("}}");
    const replaceTo = hasClosing ? { line: end.line, ch: end.ch + 2 } : end;
    editor.replaceRange(suggestion.displayKey + "}}", start2, replaceTo);
  }
};

// src/editor-extension.ts
var import_view = require("@codemirror/view");
var import_state = require("@codemirror/state");
var linkDeco = import_view.Decoration.mark({ class: "ol-cm-link" });
var linkEditingDeco = import_view.Decoration.mark({ class: "ol-cm-link-editing" });
function buildDecorations(view) {
  const builder = new import_state.RangeSetBuilder();
  const cursorHead = view.state.selection.main.head;
  const regex = /\{\{([^}]+)\}\}/g;
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to);
    let match;
    while ((match = regex.exec(text)) !== null) {
      const start2 = from + match.index;
      const end = start2 + match[0].length;
      const cursorInside = cursorHead >= start2 && cursorHead <= end;
      builder.add(start2, end, cursorInside ? linkEditingDeco : linkDeco);
    }
  }
  return builder.finish();
}
var objectLinkHighlighter = import_view.ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildDecorations(view);
    }
    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations
  }
);

// src/main.ts
var ObjectLinksPlugin = class extends import_obsidian4.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.graphData = null;
    this.suggestProvider = null;
    this.allObjects = [];
    /** Map: lowercase key value -> ParsedObject (for quick lookups) */
    this.objectIndex = /* @__PURE__ */ new Map();
    // ── Debounce ────────────────────────────────────────────────────────
    this.debounceTimer = null;
    // ── Object popover on hover ────────────────────────────────────────
    this.popoverEl = null;
  }
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new ObjectLinksSettingTab(this.app, this));
    this.registerView(VIEW_TYPE, (leaf) => {
      const view = new GraphView(leaf);
      view.navigateToObject = (filePath, startLine) => this.goToObject(filePath, startLine);
      view.navigateToFile = (filePath) => this.goToFile(filePath);
      return view;
    });
    this.suggestProvider = new ObjectLinkSuggest(this.app);
    this.registerEditorSuggest(this.suggestProvider);
    this.registerEditorExtension(objectLinkHighlighter);
    this.registerMarkdownPostProcessor(
      (el, ctx) => {
        this.processObjectLinks(el);
      }
    );
    this.addRibbonIcon("git-fork", "Open Object Links", () => {
      this.activateView();
    });
    this.addCommand({
      id: "open-ol-graph",
      name: "Open graph view",
      callback: () => this.activateView()
    });
    this.addCommand({
      id: "refresh-ol-graph",
      name: "Refresh graph",
      callback: () => this.fullRefresh()
    });
    this.app.workspace.onLayoutReady(() => {
      this.fullRefresh();
    });
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof import_obsidian4.TFile && file.extension === "md") {
          this.debounceRefresh();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof import_obsidian4.TFile && file.extension === "md") {
          this.debounceRefresh();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof import_obsidian4.TFile && file.extension === "md") {
          this.debounceRefresh();
        }
      })
    );
  }
  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }
  debounceRefresh() {
    if (this.debounceTimer)
      clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.fullRefresh(), 800);
  }
  // ── Full refresh: scan, check dupes, update views ──────────────────
  async fullRefresh() {
    const parsedFiles = await this.scanMultiObjectFiles();
    const allFiles = await this.getAllVaultFiles();
    this.allObjects = [];
    this.objectIndex = /* @__PURE__ */ new Map();
    const idDupes = [];
    const fileIdSets = /* @__PURE__ */ new Map();
    const fileKeyProps = /* @__PURE__ */ new Map();
    for (const file of parsedFiles) {
      fileKeyProps.set(file.filePath, file.keyProperty);
      if (!fileIdSets.has(file.filePath)) {
        fileIdSets.set(file.filePath, /* @__PURE__ */ new Map());
      }
      const idSet = fileIdSets.get(file.filePath);
      for (const obj of file.objects) {
        this.allObjects.push(obj);
        if (idSet.has(obj.id)) {
          idDupes.push(
            `id ${obj.id} duplicated in ${obj.fileLabel}: "${idSet.get(obj.id)}" and "${obj.keyValue}"`
          );
        }
        idSet.set(obj.id, obj.keyValue);
      }
    }
    const keyGroups = /* @__PURE__ */ new Map();
    for (const obj of this.allObjects) {
      const k = obj.keyValue.toLowerCase();
      if (!keyGroups.has(k))
        keyGroups.set(k, []);
      keyGroups.get(k).push(obj);
    }
    for (const [, group] of keyGroups) {
      if (group.length === 1) {
        continue;
      }
      const fileGroups = /* @__PURE__ */ new Map();
      for (const obj of group) {
        const fk = obj.fileLabel.toLowerCase();
        if (!fileGroups.has(fk))
          fileGroups.set(fk, []);
        fileGroups.get(fk).push(obj);
      }
      for (const [, fGroup] of fileGroups) {
        if (fGroup.length === 1) {
          fGroup[0].displayKey = `${fGroup[0].keyValue} (${fGroup[0].fileLabel})`;
        } else {
          for (const obj of fGroup) {
            const keyProp = fileKeyProps.get(obj.filePath) || "";
            const secondVal = getSecondProperty(obj, keyProp);
            if (secondVal) {
              obj.displayKey = `${obj.keyValue} (${secondVal})`;
            } else {
              obj.displayKey = `${obj.keyValue} (#${obj.id})`;
            }
          }
        }
      }
    }
    for (const obj of this.allObjects) {
      this.objectIndex.set(obj.displayKey.toLowerCase(), obj);
    }
    for (const [k, group] of keyGroups) {
      if (group.length === 1) {
        this.objectIndex.set(k, group[0]);
      }
    }
    if (idDupes.length > 0) {
      new import_obsidian4.Notice(
        `Object Links: Duplicate IDs found:
${idDupes.join("\n")}`,
        8e3
      );
    }
    if (this.suggestProvider) {
      this.suggestProvider.setObjects(this.allObjects);
    }
    this.graphData = buildGraph(parsedFiles, allFiles);
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
      if (leaf.view instanceof GraphView) {
        leaf.view.navigateToObject = (fp, sl) => this.goToObject(fp, sl);
        leaf.view.navigateToFile = (fp) => this.goToFile(fp);
        leaf.view.setGraphData(this.graphData);
      }
    });
  }
  // ── Vault scanning ─────────────────────────────────────────────────
  async scanMultiObjectFiles() {
    const files = this.app.vault.getMarkdownFiles();
    const parsed = [];
    const tag = this.settings.objectFileTag.trim();
    for (const file of files) {
      try {
        const content = await this.app.vault.read(file);
        if (tag) {
          if (!this.hasFileTag(content, tag))
            continue;
        }
        const result = parseMultiObjectFile(content, file.path);
        if (result)
          parsed.push(result);
      } catch {
      }
    }
    return parsed;
  }
  /**
   * Check if a markdown file contains the given tag.
   * Supports:
   *  1. Bare `#tag` anywhere in the file (e.g. `#object-links` on line 1)
   *  2. YAML frontmatter `tags: [a, b]`, `tags: a`, or list form
   *  3. The `tag:` alias used by some Obsidian setups
   */
  hasFileTag(content, tag) {
    const lowerTag = tag.toLowerCase();
    const bareTagRegex = new RegExp(
      `(?:^|\\s)#${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`,
      "im"
    );
    if (bareTagRegex.test(content))
      return true;
    if (!content.startsWith("---"))
      return false;
    const endIdx = content.indexOf("\n---", 3);
    if (endIdx === -1)
      return false;
    const frontmatter = content.substring(3, endIdx);
    for (const line of frontmatter.split("\n")) {
      const trimmed = line.trim();
      const match = trimmed.match(/^tags?\s*:\s*(.+)$/i);
      if (!match)
        continue;
      let value = match[1].trim();
      if (value.startsWith("[") && value.endsWith("]")) {
        value = value.slice(1, -1);
      }
      const tags = value.split(",").map((t) => t.trim().toLowerCase());
      if (tags.includes(lowerTag))
        return true;
    }
    const listRegex = /^tags?\s*:\s*$/im;
    const listMatch = listRegex.exec(frontmatter);
    if (listMatch) {
      const afterTags = frontmatter.substring(
        listMatch.index + listMatch[0].length
      );
      for (const line of afterTags.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("- ")) {
          const tagVal = trimmed.substring(2).trim().toLowerCase();
          if (tagVal === lowerTag)
            return true;
        } else if (trimmed.length > 0 && !trimmed.startsWith("#")) {
          break;
        }
      }
    }
    return false;
  }
  async getAllVaultFiles() {
    const files = this.app.vault.getMarkdownFiles();
    const result = [];
    for (const file of files) {
      try {
        const content = await this.app.vault.read(file);
        result.push({ path: file.path, basename: file.basename, content });
      } catch {
      }
    }
    return result;
  }
  // ── Markdown post-processor for {{object}} links ───────────────────
  processObjectLinks(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodesToReplace = [];
    let textNode;
    while (textNode = walker.nextNode()) {
      const text = textNode.textContent || "";
      const regex = /\{\{([^}]+)\}\}/g;
      const matches = [];
      let match;
      while ((match = regex.exec(text)) !== null) {
        matches.push({ ...match, index: match.index });
      }
      if (matches.length > 0) {
        nodesToReplace.push({ node: textNode, matches });
      }
    }
    for (const { node, matches } of nodesToReplace) {
      const text = node.textContent || "";
      const parent = node.parentNode;
      if (!parent)
        continue;
      const frag = document.createDocumentFragment();
      let lastIndex = 0;
      for (const match of matches) {
        if (match.index > lastIndex) {
          frag.appendChild(
            document.createTextNode(text.substring(lastIndex, match.index))
          );
        }
        let linkTarget = match[1];
        let displayText = linkTarget;
        const pipeIdx = linkTarget.indexOf("|");
        if (pipeIdx !== -1) {
          displayText = linkTarget.substring(pipeIdx + 1).trim();
          linkTarget = linkTarget.substring(0, pipeIdx).trim();
        }
        const span = document.createElement("span");
        span.className = "ol-inline-link";
        span.textContent = displayText;
        span.setAttribute("data-ol-target", linkTarget);
        const obj = this.objectIndex.get(linkTarget.toLowerCase());
        if (!obj) {
          span.classList.add("ol-inline-link-unresolved");
        }
        span.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const target = span.getAttribute("data-ol-target") || "";
          const targetObj = this.objectIndex.get(target.toLowerCase());
          if (targetObj) {
            this.goToObject(targetObj.filePath, targetObj.startLine);
          } else {
            new import_obsidian4.Notice(`Object "${target}" not found`);
          }
        });
        span.addEventListener("mouseenter", (e) => {
          const target = span.getAttribute("data-ol-target") || "";
          const targetObj = this.objectIndex.get(target.toLowerCase());
          if (targetObj) {
            this.showObjectPopover(span, targetObj);
          }
        });
        span.addEventListener("mouseleave", () => {
          this.hideObjectPopover();
        });
        frag.appendChild(span);
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < text.length) {
        frag.appendChild(document.createTextNode(text.substring(lastIndex)));
      }
      parent.replaceChild(frag, node);
    }
  }
  showObjectPopover(anchor, obj) {
    this.hideObjectPopover();
    const pop = document.createElement("div");
    pop.className = "ol-popover";
    const title = document.createElement("div");
    title.className = "ol-popover-title";
    title.textContent = obj.displayKey;
    pop.appendChild(title);
    const file = document.createElement("div");
    file.className = "ol-popover-file";
    file.textContent = obj.fileLabel;
    pop.appendChild(file);
    for (const [k, v] of Object.entries(obj.properties)) {
      const row = document.createElement("div");
      row.className = "ol-popover-row";
      row.innerHTML = `<span class="ol-popover-key">${k}</span><span class="ol-popover-val">${v}</span>`;
      pop.appendChild(row);
    }
    document.body.appendChild(pop);
    this.popoverEl = pop;
    const rect = anchor.getBoundingClientRect();
    pop.style.top = rect.bottom + 4 + "px";
    pop.style.left = rect.left + "px";
  }
  hideObjectPopover() {
    if (this.popoverEl) {
      this.popoverEl.remove();
      this.popoverEl = null;
    }
  }
  // ── Navigation helpers ─────────────────────────────────────────────
  async goToObject(filePath, startLine) {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof import_obsidian4.TFile)) {
      new import_obsidian4.Notice(`File not found: ${filePath}`);
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
    const view = leaf.view;
    if (view && view.editor) {
      setTimeout(() => {
        try {
          view.editor.setCursor({ line: startLine, ch: 0 });
          view.editor.scrollIntoView(
            { from: { line: startLine, ch: 0 }, to: { line: startLine + 5, ch: 0 } },
            true
          );
        } catch {
        }
      }, 100);
    }
  }
  async goToFile(filePath) {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof import_obsidian4.TFile)) {
      new import_obsidian4.Notice(`File not found: ${filePath}`);
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
  }
  // ── Activate view ──────────────────────────────────────────────────
  async activateView() {
    const { workspace } = this.app;
    let leaf = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE);
    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
    await this.fullRefresh();
  }
  // ── Settings persistence ───────────────────────────────────────────
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this.fullRefresh();
  }
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL3BhcnNlci50cyIsICJzcmMvZ3JhcGgtZGF0YS50cyIsICJzcmMvZ3JhcGgtdmlldy50cyIsICJub2RlX21vZHVsZXMvZDMtZGlzcGF0Y2gvc3JjL2Rpc3BhdGNoLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL25hbWVzcGFjZXMuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvbmFtZXNwYWNlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL2NyZWF0b3IuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0b3IuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL3NlbGVjdC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9hcnJheS5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3RvckFsbC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vc2VsZWN0QWxsLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL21hdGNoZXIuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL3NlbGVjdENoaWxkLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9zZWxlY3RDaGlsZHJlbi5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vZmlsdGVyLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9zcGFyc2UuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2VudGVyLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL2NvbnN0YW50LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9kYXRhLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9leGl0LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9qb2luLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9tZXJnZS5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vb3JkZXIuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL3NvcnQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2NhbGwuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL25vZGVzLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9ub2RlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9zaXplLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9lbXB0eS5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vZWFjaC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vYXR0ci5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy93aW5kb3cuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL3N0eWxlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9wcm9wZXJ0eS5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vY2xhc3NlZC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vdGV4dC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vaHRtbC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vcmFpc2UuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2xvd2VyLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9hcHBlbmQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2luc2VydC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vcmVtb3ZlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9jbG9uZS5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vZGF0dW0uanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL29uLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9kaXNwYXRjaC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vaXRlcmF0b3IuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2luZGV4LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zb3VyY2VFdmVudC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9wb2ludGVyLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1kcmFnL3NyYy9ub2V2ZW50LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1kcmFnL3NyYy9ub2RyYWcuanMiLCAibm9kZV9tb2R1bGVzL2QzLWRyYWcvc3JjL2NvbnN0YW50LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1kcmFnL3NyYy9ldmVudC5qcyIsICJub2RlX21vZHVsZXMvZDMtZHJhZy9zcmMvZHJhZy5qcyIsICJub2RlX21vZHVsZXMvZDMtY29sb3Ivc3JjL2RlZmluZS5qcyIsICJub2RlX21vZHVsZXMvZDMtY29sb3Ivc3JjL2NvbG9yLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1pbnRlcnBvbGF0ZS9zcmMvYmFzaXMuanMiLCAibm9kZV9tb2R1bGVzL2QzLWludGVycG9sYXRlL3NyYy9iYXNpc0Nsb3NlZC5qcyIsICJub2RlX21vZHVsZXMvZDMtaW50ZXJwb2xhdGUvc3JjL2NvbnN0YW50LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1pbnRlcnBvbGF0ZS9zcmMvY29sb3IuanMiLCAibm9kZV9tb2R1bGVzL2QzLWludGVycG9sYXRlL3NyYy9yZ2IuanMiLCAibm9kZV9tb2R1bGVzL2QzLWludGVycG9sYXRlL3NyYy9udW1iZXIuanMiLCAibm9kZV9tb2R1bGVzL2QzLWludGVycG9sYXRlL3NyYy9zdHJpbmcuanMiLCAibm9kZV9tb2R1bGVzL2QzLWludGVycG9sYXRlL3NyYy90cmFuc2Zvcm0vZGVjb21wb3NlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1pbnRlcnBvbGF0ZS9zcmMvdHJhbnNmb3JtL3BhcnNlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1pbnRlcnBvbGF0ZS9zcmMvdHJhbnNmb3JtL2luZGV4LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1pbnRlcnBvbGF0ZS9zcmMvem9vbS5qcyIsICJub2RlX21vZHVsZXMvZDMtdGltZXIvc3JjL3RpbWVyLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10aW1lci9zcmMvdGltZW91dC5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvdHJhbnNpdGlvbi9zY2hlZHVsZS5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvaW50ZXJydXB0LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy9zZWxlY3Rpb24vaW50ZXJydXB0LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy90cmFuc2l0aW9uL3R3ZWVuLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy90cmFuc2l0aW9uL2ludGVycG9sYXRlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy90cmFuc2l0aW9uL2F0dHIuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vYXR0clR3ZWVuLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy90cmFuc2l0aW9uL2RlbGF5LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy90cmFuc2l0aW9uL2R1cmF0aW9uLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy90cmFuc2l0aW9uL2Vhc2UuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vZWFzZVZhcnlpbmcuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vZmlsdGVyLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy90cmFuc2l0aW9uL21lcmdlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy90cmFuc2l0aW9uL29uLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy90cmFuc2l0aW9uL3JlbW92ZS5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvdHJhbnNpdGlvbi9zZWxlY3QuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vc2VsZWN0QWxsLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy90cmFuc2l0aW9uL3NlbGVjdGlvbi5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvdHJhbnNpdGlvbi9zdHlsZS5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvdHJhbnNpdGlvbi9zdHlsZVR3ZWVuLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy90cmFuc2l0aW9uL3RleHQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vdGV4dFR3ZWVuLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy90cmFuc2l0aW9uL3RyYW5zaXRpb24uanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vZW5kLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy90cmFuc2l0aW9uL2luZGV4LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1lYXNlL3NyYy9jdWJpYy5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvc2VsZWN0aW9uL3RyYW5zaXRpb24uanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3NlbGVjdGlvbi9pbmRleC5qcyIsICJub2RlX21vZHVsZXMvZDMtYnJ1c2gvc3JjL2JydXNoLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1mb3JjZS9zcmMvY2VudGVyLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1xdWFkdHJlZS9zcmMvYWRkLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1xdWFkdHJlZS9zcmMvY292ZXIuanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9kYXRhLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1xdWFkdHJlZS9zcmMvZXh0ZW50LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1xdWFkdHJlZS9zcmMvcXVhZC5qcyIsICJub2RlX21vZHVsZXMvZDMtcXVhZHRyZWUvc3JjL2ZpbmQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9yZW1vdmUuanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9yb290LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1xdWFkdHJlZS9zcmMvc2l6ZS5qcyIsICJub2RlX21vZHVsZXMvZDMtcXVhZHRyZWUvc3JjL3Zpc2l0LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1xdWFkdHJlZS9zcmMvdmlzaXRBZnRlci5qcyIsICJub2RlX21vZHVsZXMvZDMtcXVhZHRyZWUvc3JjL3guanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy95LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1xdWFkdHJlZS9zcmMvcXVhZHRyZWUuanMiLCAibm9kZV9tb2R1bGVzL2QzLWZvcmNlL3NyYy9jb25zdGFudC5qcyIsICJub2RlX21vZHVsZXMvZDMtZm9yY2Uvc3JjL2ppZ2dsZS5qcyIsICJub2RlX21vZHVsZXMvZDMtZm9yY2Uvc3JjL2NvbGxpZGUuanMiLCAibm9kZV9tb2R1bGVzL2QzLWZvcmNlL3NyYy9saW5rLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1mb3JjZS9zcmMvbGNnLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1mb3JjZS9zcmMvc2ltdWxhdGlvbi5qcyIsICJub2RlX21vZHVsZXMvZDMtZm9yY2Uvc3JjL21hbnlCb2R5LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1mb3JjZS9zcmMveC5qcyIsICJub2RlX21vZHVsZXMvZDMtZm9yY2Uvc3JjL3kuanMiLCAibm9kZV9tb2R1bGVzL2QzLXpvb20vc3JjL2NvbnN0YW50LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy16b29tL3NyYy9ldmVudC5qcyIsICJub2RlX21vZHVsZXMvZDMtem9vbS9zcmMvdHJhbnNmb3JtLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy16b29tL3NyYy9ub2V2ZW50LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy16b29tL3NyYy96b29tLmpzIiwgInNyYy9zZXR0aW5ncy50cyIsICJzcmMvc3VnZ2VzdC50cyIsICJzcmMvZWRpdG9yLWV4dGVuc2lvbi50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHtcbiAgTWFya2Rvd25Qb3N0UHJvY2Vzc29yQ29udGV4dCxcbiAgTm90aWNlLFxuICBQbHVnaW4sXG4gIFRGaWxlLFxuICBXb3Jrc3BhY2VMZWFmLFxufSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB7XG4gIHBhcnNlTXVsdGlPYmplY3RGaWxlLFxuICBQYXJzZWRGaWxlLFxuICBQYXJzZWRPYmplY3QsXG4gIGdldFNlY29uZFByb3BlcnR5LFxufSBmcm9tIFwiLi9wYXJzZXJcIjtcbmltcG9ydCB7IGJ1aWxkR3JhcGgsIEdyYXBoRGF0YSwgVmF1bHRGaWxlIH0gZnJvbSBcIi4vZ3JhcGgtZGF0YVwiO1xuaW1wb3J0IHsgR3JhcGhWaWV3LCBWSUVXX1RZUEUgfSBmcm9tIFwiLi9ncmFwaC12aWV3XCI7XG5pbXBvcnQgeyBPYmplY3RMaW5rU3VnZ2VzdCB9IGZyb20gXCIuL3N1Z2dlc3RcIjtcbmltcG9ydCB7IG9iamVjdExpbmtIaWdobGlnaHRlciB9IGZyb20gXCIuL2VkaXRvci1leHRlbnNpb25cIjtcbmltcG9ydCB7XG4gIE9iamVjdExpbmtzU2V0dGluZ3MsXG4gIERFRkFVTFRfU0VUVElOR1MsXG4gIE9iamVjdExpbmtzU2V0dGluZ1RhYixcbn0gZnJvbSBcIi4vc2V0dGluZ3NcIjtcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgT2JqZWN0TGlua3NQbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xuICBzZXR0aW5nczogT2JqZWN0TGlua3NTZXR0aW5ncyA9IERFRkFVTFRfU0VUVElOR1M7XG4gIHByaXZhdGUgZ3JhcGhEYXRhOiBHcmFwaERhdGEgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzdWdnZXN0UHJvdmlkZXI6IE9iamVjdExpbmtTdWdnZXN0IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgYWxsT2JqZWN0czogUGFyc2VkT2JqZWN0W10gPSBbXTtcbiAgLyoqIE1hcDogbG93ZXJjYXNlIGtleSB2YWx1ZSAtPiBQYXJzZWRPYmplY3QgKGZvciBxdWljayBsb29rdXBzKSAqL1xuICBwcml2YXRlIG9iamVjdEluZGV4OiBNYXA8c3RyaW5nLCBQYXJzZWRPYmplY3Q+ID0gbmV3IE1hcCgpO1xuXG4gIGFzeW5jIG9ubG9hZCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBcdTI1MDBcdTI1MDAgTG9hZCBzZXR0aW5ncyBcdTI1MDBcdTI1MDBcbiAgICBhd2FpdCB0aGlzLmxvYWRTZXR0aW5ncygpO1xuXG4gICAgLy8gXHUyNTAwXHUyNTAwIFNldHRpbmdzIHRhYiBcdTI1MDBcdTI1MDBcbiAgICB0aGlzLmFkZFNldHRpbmdUYWIobmV3IE9iamVjdExpbmtzU2V0dGluZ1RhYih0aGlzLmFwcCwgdGhpcykpO1xuXG4gICAgLy8gXHUyNTAwXHUyNTAwIFJlZ2lzdGVyIHZpZXcgXHUyNTAwXHUyNTAwXG4gICAgdGhpcy5yZWdpc3RlclZpZXcoVklFV19UWVBFLCAobGVhZikgPT4ge1xuICAgICAgY29uc3QgdmlldyA9IG5ldyBHcmFwaFZpZXcobGVhZik7XG4gICAgICB2aWV3Lm5hdmlnYXRlVG9PYmplY3QgPSAoZmlsZVBhdGgsIHN0YXJ0TGluZSkgPT5cbiAgICAgICAgdGhpcy5nb1RvT2JqZWN0KGZpbGVQYXRoLCBzdGFydExpbmUpO1xuICAgICAgdmlldy5uYXZpZ2F0ZVRvRmlsZSA9IChmaWxlUGF0aCkgPT4gdGhpcy5nb1RvRmlsZShmaWxlUGF0aCk7XG4gICAgICByZXR1cm4gdmlldztcbiAgICB9KTtcblxuICAgIC8vIFx1MjUwMFx1MjUwMCBSZWdpc3RlciBzdWdnZXN0IHByb3ZpZGVyIFx1MjUwMFx1MjUwMFxuICAgIHRoaXMuc3VnZ2VzdFByb3ZpZGVyID0gbmV3IE9iamVjdExpbmtTdWdnZXN0KHRoaXMuYXBwKTtcbiAgICB0aGlzLnJlZ2lzdGVyRWRpdG9yU3VnZ2VzdCh0aGlzLnN1Z2dlc3RQcm92aWRlcik7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgUmVnaXN0ZXIgQ002IGVkaXRvciBleHRlbnNpb24gZm9yIHt7fX0gc3ludGF4IGhpZ2hsaWdodGluZyBcdTI1MDBcdTI1MDBcbiAgICB0aGlzLnJlZ2lzdGVyRWRpdG9yRXh0ZW5zaW9uKG9iamVjdExpbmtIaWdobGlnaHRlcik7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgTWFya2Rvd24gcG9zdC1wcm9jZXNzb3I6IHJlbmRlciB7e29iamVjdH19IGFzIGNsaWNrYWJsZSBsaW5rcyBcdTI1MDBcdTI1MDBcbiAgICB0aGlzLnJlZ2lzdGVyTWFya2Rvd25Qb3N0UHJvY2Vzc29yKFxuICAgICAgKGVsOiBIVE1MRWxlbWVudCwgY3R4OiBNYXJrZG93blBvc3RQcm9jZXNzb3JDb250ZXh0KSA9PiB7XG4gICAgICAgIHRoaXMucHJvY2Vzc09iamVjdExpbmtzKGVsKTtcbiAgICAgIH1cbiAgICApO1xuXG4gICAgLy8gXHUyNTAwXHUyNTAwIFJpYmJvbiBpY29uIFx1MjUwMFx1MjUwMFxuICAgIHRoaXMuYWRkUmliYm9uSWNvbihcImdpdC1mb3JrXCIsIFwiT3BlbiBPYmplY3QgTGlua3NcIiwgKCkgPT4ge1xuICAgICAgdGhpcy5hY3RpdmF0ZVZpZXcoKTtcbiAgICB9KTtcblxuICAgIC8vIFx1MjUwMFx1MjUwMCBDb21tYW5kcyBcdTI1MDBcdTI1MDBcbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwib3Blbi1vbC1ncmFwaFwiLFxuICAgICAgbmFtZTogXCJPcGVuIGdyYXBoIHZpZXdcIixcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB0aGlzLmFjdGl2YXRlVmlldygpLFxuICAgIH0pO1xuXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcInJlZnJlc2gtb2wtZ3JhcGhcIixcbiAgICAgIG5hbWU6IFwiUmVmcmVzaCBncmFwaFwiLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHRoaXMuZnVsbFJlZnJlc2goKSxcbiAgICB9KTtcblxuICAgIC8vIFx1MjUwMFx1MjUwMCBJbml0aWFsIHNjYW4gb24gbGF5b3V0IHJlYWR5IFx1MjUwMFx1MjUwMFxuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcbiAgICAgIHRoaXMuZnVsbFJlZnJlc2goKTtcbiAgICB9KTtcblxuICAgIC8vIFx1MjUwMFx1MjUwMCBGaWxlIHdhdGNoZXJzIFx1MjUwMFx1MjUwMFxuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLnZhdWx0Lm9uKFwibW9kaWZ5XCIsIChmaWxlKSA9PiB7XG4gICAgICAgIGlmIChmaWxlIGluc3RhbmNlb2YgVEZpbGUgJiYgZmlsZS5leHRlbnNpb24gPT09IFwibWRcIikge1xuICAgICAgICAgIHRoaXMuZGVib3VuY2VSZWZyZXNoKCk7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgKTtcbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICB0aGlzLmFwcC52YXVsdC5vbihcImNyZWF0ZVwiLCAoZmlsZSkgPT4ge1xuICAgICAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGaWxlICYmIGZpbGUuZXh0ZW5zaW9uID09PSBcIm1kXCIpIHtcbiAgICAgICAgICB0aGlzLmRlYm91bmNlUmVmcmVzaCgpO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICk7XG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAudmF1bHQub24oXCJkZWxldGVcIiwgKGZpbGUpID0+IHtcbiAgICAgICAgaWYgKGZpbGUgaW5zdGFuY2VvZiBURmlsZSAmJiBmaWxlLmV4dGVuc2lvbiA9PT0gXCJtZFwiKSB7XG4gICAgICAgICAgdGhpcy5kZWJvdW5jZVJlZnJlc2goKTtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICApO1xuICB9XG5cbiAgb251bmxvYWQoKTogdm9pZCB7XG4gICAgdGhpcy5hcHAud29ya3NwYWNlLmRldGFjaExlYXZlc09mVHlwZShWSUVXX1RZUEUpO1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIERlYm91bmNlIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG4gIHByaXZhdGUgZGVib3VuY2VUaW1lcjogUmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsID0gbnVsbDtcblxuICBwcml2YXRlIGRlYm91bmNlUmVmcmVzaCgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5kZWJvdW5jZVRpbWVyKSBjbGVhclRpbWVvdXQodGhpcy5kZWJvdW5jZVRpbWVyKTtcbiAgICB0aGlzLmRlYm91bmNlVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHRoaXMuZnVsbFJlZnJlc2goKSwgODAwKTtcbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCBGdWxsIHJlZnJlc2g6IHNjYW4sIGNoZWNrIGR1cGVzLCB1cGRhdGUgdmlld3MgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbiAgcHJpdmF0ZSBhc3luYyBmdWxsUmVmcmVzaCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBwYXJzZWRGaWxlcyA9IGF3YWl0IHRoaXMuc2Nhbk11bHRpT2JqZWN0RmlsZXMoKTtcbiAgICBjb25zdCBhbGxGaWxlcyA9IGF3YWl0IHRoaXMuZ2V0QWxsVmF1bHRGaWxlcygpO1xuXG4gICAgLy8gQnVpbGQgaW5kZXggKyBkaXNhbWJpZ3VhdGUgZHVwbGljYXRlIGtleSB2YWx1ZXNcbiAgICB0aGlzLmFsbE9iamVjdHMgPSBbXTtcbiAgICB0aGlzLm9iamVjdEluZGV4ID0gbmV3IE1hcCgpO1xuICAgIGNvbnN0IGlkRHVwZXM6IHN0cmluZ1tdID0gW107XG4gICAgLyoqIFRyYWNrIGlkcyBwZXIgZmlsZSB0byBkZXRlY3QgZHVwbGljYXRlIGlkcyB3aXRoaW4gYSBmaWxlICovXG4gICAgY29uc3QgZmlsZUlkU2V0czogTWFwPHN0cmluZywgTWFwPG51bWJlciwgc3RyaW5nPj4gPSBuZXcgTWFwKCk7XG4gICAgLyoqIE1hcCBmcm9tIHBhcnNlZCBmaWxlIHBhdGggdG8gaXRzIGtleVByb3BlcnR5IG5hbWUgKi9cbiAgICBjb25zdCBmaWxlS2V5UHJvcHM6IE1hcDxzdHJpbmcsIHN0cmluZz4gPSBuZXcgTWFwKCk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgUGhhc2UgMTogQ29sbGVjdCBhbGwgb2JqZWN0cyBhbmQgY2hlY2sgaWQgZHVwbGljYXRlcyBcdTI1MDBcdTI1MDBcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgcGFyc2VkRmlsZXMpIHtcbiAgICAgIGZpbGVLZXlQcm9wcy5zZXQoZmlsZS5maWxlUGF0aCwgZmlsZS5rZXlQcm9wZXJ0eSk7XG5cbiAgICAgIGlmICghZmlsZUlkU2V0cy5oYXMoZmlsZS5maWxlUGF0aCkpIHtcbiAgICAgICAgZmlsZUlkU2V0cy5zZXQoZmlsZS5maWxlUGF0aCwgbmV3IE1hcCgpKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGlkU2V0ID0gZmlsZUlkU2V0cy5nZXQoZmlsZS5maWxlUGF0aCkhO1xuXG4gICAgICBmb3IgKGNvbnN0IG9iaiBvZiBmaWxlLm9iamVjdHMpIHtcbiAgICAgICAgdGhpcy5hbGxPYmplY3RzLnB1c2gob2JqKTtcblxuICAgICAgICAvLyBDaGVjayBkdXBsaWNhdGUgaWRzIHdpdGhpbiB0aGUgc2FtZSBmaWxlXG4gICAgICAgIGlmIChpZFNldC5oYXMob2JqLmlkKSkge1xuICAgICAgICAgIGlkRHVwZXMucHVzaChcbiAgICAgICAgICAgIGBpZCAke29iai5pZH0gZHVwbGljYXRlZCBpbiAke29iai5maWxlTGFiZWx9OiBcIiR7aWRTZXQuZ2V0KG9iai5pZCl9XCIgYW5kIFwiJHtvYmoua2V5VmFsdWV9XCJgXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICBpZFNldC5zZXQob2JqLmlkLCBvYmoua2V5VmFsdWUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFx1MjUwMFx1MjUwMCBQaGFzZSAyOiBEaXNhbWJpZ3VhdGUgZHVwbGljYXRlIGtleVZhbHVlcyBcdTI1MDBcdTI1MDBcbiAgICAvLyBHcm91cCBvYmplY3RzIGJ5IGxvd2VyY2FzZSBrZXlWYWx1ZVxuICAgIGNvbnN0IGtleUdyb3VwcyA9IG5ldyBNYXA8c3RyaW5nLCBQYXJzZWRPYmplY3RbXT4oKTtcbiAgICBmb3IgKGNvbnN0IG9iaiBvZiB0aGlzLmFsbE9iamVjdHMpIHtcbiAgICAgIGNvbnN0IGsgPSBvYmoua2V5VmFsdWUudG9Mb3dlckNhc2UoKTtcbiAgICAgIGlmICgha2V5R3JvdXBzLmhhcyhrKSkga2V5R3JvdXBzLnNldChrLCBbXSk7XG4gICAgICBrZXlHcm91cHMuZ2V0KGspIS5wdXNoKG9iaik7XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBbLCBncm91cF0gb2Yga2V5R3JvdXBzKSB7XG4gICAgICBpZiAoZ3JvdXAubGVuZ3RoID09PSAxKSB7XG4gICAgICAgIC8vIFVuaXF1ZSBrZXk6IGRpc3BsYXlLZXkgPSBrZXlWYWx1ZSAoYWxyZWFkeSB0aGUgZGVmYXVsdClcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIC8vIE11bHRpcGxlIG9iamVjdHMgc2hhcmUgdGhlIHNhbWUga2V5VmFsdWUgLS0gZGlzYW1iaWd1YXRlXG4gICAgICAvLyBTdGVwIDE6IFRyeSBcImtleVZhbHVlIChmaWxlTGFiZWwpXCJcbiAgICAgIGNvbnN0IGZpbGVHcm91cHMgPSBuZXcgTWFwPHN0cmluZywgUGFyc2VkT2JqZWN0W10+KCk7XG4gICAgICBmb3IgKGNvbnN0IG9iaiBvZiBncm91cCkge1xuICAgICAgICBjb25zdCBmayA9IG9iai5maWxlTGFiZWwudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgaWYgKCFmaWxlR3JvdXBzLmhhcyhmaykpIGZpbGVHcm91cHMuc2V0KGZrLCBbXSk7XG4gICAgICAgIGZpbGVHcm91cHMuZ2V0KGZrKSEucHVzaChvYmopO1xuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IFssIGZHcm91cF0gb2YgZmlsZUdyb3Vwcykge1xuICAgICAgICBpZiAoZkdyb3VwLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICAgIC8vIGtleSArIGZpbGVuYW1lIGlzIHVuaXF1ZVxuICAgICAgICAgIGZHcm91cFswXS5kaXNwbGF5S2V5ID0gYCR7Zkdyb3VwWzBdLmtleVZhbHVlfSAoJHtmR3JvdXBbMF0uZmlsZUxhYmVsfSlgO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIGtleSArIGZpbGVuYW1lIHN0aWxsIGNvbGxpZGVzOiB1c2Ugc2Vjb25kIHByb3BlcnR5XG4gICAgICAgICAgZm9yIChjb25zdCBvYmogb2YgZkdyb3VwKSB7XG4gICAgICAgICAgICBjb25zdCBrZXlQcm9wID0gZmlsZUtleVByb3BzLmdldChvYmouZmlsZVBhdGgpIHx8IFwiXCI7XG4gICAgICAgICAgICBjb25zdCBzZWNvbmRWYWwgPSBnZXRTZWNvbmRQcm9wZXJ0eShvYmosIGtleVByb3ApO1xuICAgICAgICAgICAgaWYgKHNlY29uZFZhbCkge1xuICAgICAgICAgICAgICBvYmouZGlzcGxheUtleSA9IGAke29iai5rZXlWYWx1ZX0gKCR7c2Vjb25kVmFsfSlgO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgLy8gRmFsbGJhY2s6IHVzZSBpZFxuICAgICAgICAgICAgICBvYmouZGlzcGxheUtleSA9IGAke29iai5rZXlWYWx1ZX0gKCMke29iai5pZH0pYDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgUGhhc2UgMzogQnVpbGQgb2JqZWN0SW5kZXggdXNpbmcgZGlzcGxheUtleSBcdTI1MDBcdTI1MDBcbiAgICAvLyBSZWdpc3RlciBlYWNoIG9iamVjdCBieSBpdHMgZGlzcGxheUtleSAocHJpbWFyeSBsb29rdXApXG4gICAgZm9yIChjb25zdCBvYmogb2YgdGhpcy5hbGxPYmplY3RzKSB7XG4gICAgICB0aGlzLm9iamVjdEluZGV4LnNldChvYmouZGlzcGxheUtleS50b0xvd2VyQ2FzZSgpLCBvYmopO1xuICAgIH1cbiAgICAvLyBBbHNvIHJlZ2lzdGVyIGJ5IHBsYWluIGtleVZhbHVlIGZvciBub24tYW1iaWd1b3VzIGtleXNcbiAgICAvLyAoc28gZXhpc3Rpbmcge3trZXlWYWx1ZX19IGxpbmtzIHN0aWxsIHJlc29sdmUgd2hlbiB0aGVyZSdzIG5vIGNvbGxpc2lvbilcbiAgICBmb3IgKGNvbnN0IFtrLCBncm91cF0gb2Yga2V5R3JvdXBzKSB7XG4gICAgICBpZiAoZ3JvdXAubGVuZ3RoID09PSAxKSB7XG4gICAgICAgIHRoaXMub2JqZWN0SW5kZXguc2V0KGssIGdyb3VwWzBdKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBXYXJuIG9uIGR1cGxpY2F0ZSBpZHNcbiAgICBpZiAoaWREdXBlcy5sZW5ndGggPiAwKSB7XG4gICAgICBuZXcgTm90aWNlKFxuICAgICAgICBgT2JqZWN0IExpbmtzOiBEdXBsaWNhdGUgSURzIGZvdW5kOlxcbiR7aWREdXBlcy5qb2luKFwiXFxuXCIpfWAsXG4gICAgICAgIDgwMDBcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gVXBkYXRlIHN1Z2dlc3QgcHJvdmlkZXJcbiAgICBpZiAodGhpcy5zdWdnZXN0UHJvdmlkZXIpIHtcbiAgICAgIHRoaXMuc3VnZ2VzdFByb3ZpZGVyLnNldE9iamVjdHModGhpcy5hbGxPYmplY3RzKTtcbiAgICB9XG5cbiAgICAvLyBCdWlsZCBncmFwaFxuICAgIHRoaXMuZ3JhcGhEYXRhID0gYnVpbGRHcmFwaChwYXJzZWRGaWxlcywgYWxsRmlsZXMpO1xuXG4gICAgLy8gVXBkYXRlIG9wZW4gZ3JhcGggdmlld3NcbiAgICB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFZJRVdfVFlQRSkuZm9yRWFjaCgobGVhZikgPT4ge1xuICAgICAgaWYgKGxlYWYudmlldyBpbnN0YW5jZW9mIEdyYXBoVmlldykge1xuICAgICAgICBsZWFmLnZpZXcubmF2aWdhdGVUb09iamVjdCA9IChmcCwgc2wpID0+IHRoaXMuZ29Ub09iamVjdChmcCwgc2wpO1xuICAgICAgICBsZWFmLnZpZXcubmF2aWdhdGVUb0ZpbGUgPSAoZnApID0+IHRoaXMuZ29Ub0ZpbGUoZnApO1xuICAgICAgICBsZWFmLnZpZXcuc2V0R3JhcGhEYXRhKHRoaXMuZ3JhcGhEYXRhISk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgVmF1bHQgc2Nhbm5pbmcgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbiAgcHJpdmF0ZSBhc3luYyBzY2FuTXVsdGlPYmplY3RGaWxlcygpOiBQcm9taXNlPFBhcnNlZEZpbGVbXT4ge1xuICAgIGNvbnN0IGZpbGVzID0gdGhpcy5hcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpO1xuICAgIGNvbnN0IHBhcnNlZDogUGFyc2VkRmlsZVtdID0gW107XG4gICAgY29uc3QgdGFnID0gdGhpcy5zZXR0aW5ncy5vYmplY3RGaWxlVGFnLnRyaW0oKTtcblxuICAgIGZvciAoY29uc3QgZmlsZSBvZiBmaWxlcykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSk7XG5cbiAgICAgICAgLy8gSWYgYSB0YWcgaXMgY29uZmlndXJlZCwgb25seSBwYXJzZSBmaWxlcyB3aG9zZSBmcm9udG1hdHRlclxuICAgICAgICAvLyBpbmNsdWRlcyB0aGF0IHRhZy5cbiAgICAgICAgaWYgKHRhZykge1xuICAgICAgICAgIGlmICghdGhpcy5oYXNGaWxlVGFnKGNvbnRlbnQsIHRhZykpIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmVzdWx0ID0gcGFyc2VNdWx0aU9iamVjdEZpbGUoY29udGVudCwgZmlsZS5wYXRoKTtcbiAgICAgICAgaWYgKHJlc3VsdCkgcGFyc2VkLnB1c2gocmVzdWx0KTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvKiBza2lwICovXG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBwYXJzZWQ7XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2sgaWYgYSBtYXJrZG93biBmaWxlIGNvbnRhaW5zIHRoZSBnaXZlbiB0YWcuXG4gICAqIFN1cHBvcnRzOlxuICAgKiAgMS4gQmFyZSBgI3RhZ2AgYW55d2hlcmUgaW4gdGhlIGZpbGUgKGUuZy4gYCNvYmplY3QtbGlua3NgIG9uIGxpbmUgMSlcbiAgICogIDIuIFlBTUwgZnJvbnRtYXR0ZXIgYHRhZ3M6IFthLCBiXWAsIGB0YWdzOiBhYCwgb3IgbGlzdCBmb3JtXG4gICAqICAzLiBUaGUgYHRhZzpgIGFsaWFzIHVzZWQgYnkgc29tZSBPYnNpZGlhbiBzZXR1cHNcbiAgICovXG4gIHByaXZhdGUgaGFzRmlsZVRhZyhjb250ZW50OiBzdHJpbmcsIHRhZzogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgY29uc3QgbG93ZXJUYWcgPSB0YWcudG9Mb3dlckNhc2UoKTtcblxuICAgIC8vIFx1MjUwMFx1MjUwMCAxLiBCYXJlICN0YWcgYW55d2hlcmUgaW4gdGhlIGNvbnRlbnQgXHUyNTAwXHUyNTAwXG4gICAgLy8gTWF0Y2ggI3RhZyBhcyBhIHdob2xlIHdvcmQgKG5vdCBpbnNpZGUgYW5vdGhlciB3b3JkKVxuICAgIGNvbnN0IGJhcmVUYWdSZWdleCA9IG5ldyBSZWdFeHAoXG4gICAgICBgKD86XnxcXFxccykjJHt0YWcucmVwbGFjZSgvWy4qKz9eJHt9KCl8W1xcXVxcXFxdL2csIFwiXFxcXCQmXCIpfSg/OlxcXFxzfCQpYCxcbiAgICAgIFwiaW1cIlxuICAgICk7XG4gICAgaWYgKGJhcmVUYWdSZWdleC50ZXN0KGNvbnRlbnQpKSByZXR1cm4gdHJ1ZTtcblxuICAgIC8vIFx1MjUwMFx1MjUwMCAyLiBZQU1MIGZyb250bWF0dGVyIHRhZ3MgXHUyNTAwXHUyNTAwXG4gICAgaWYgKCFjb250ZW50LnN0YXJ0c1dpdGgoXCItLS1cIikpIHJldHVybiBmYWxzZTtcbiAgICBjb25zdCBlbmRJZHggPSBjb250ZW50LmluZGV4T2YoXCJcXG4tLS1cIiwgMyk7XG4gICAgaWYgKGVuZElkeCA9PT0gLTEpIHJldHVybiBmYWxzZTtcbiAgICBjb25zdCBmcm9udG1hdHRlciA9IGNvbnRlbnQuc3Vic3RyaW5nKDMsIGVuZElkeCk7XG5cbiAgICAvLyBNYXRjaCBcInRhZ3M6XCIgb3IgXCJ0YWc6XCIgbGluZXMgd2l0aCBpbmxpbmUgdmFsdWVzXG4gICAgZm9yIChjb25zdCBsaW5lIG9mIGZyb250bWF0dGVyLnNwbGl0KFwiXFxuXCIpKSB7XG4gICAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gICAgICBjb25zdCBtYXRjaCA9IHRyaW1tZWQubWF0Y2goL150YWdzP1xccyo6XFxzKiguKykkL2kpO1xuICAgICAgaWYgKCFtYXRjaCkgY29udGludWU7XG5cbiAgICAgIGxldCB2YWx1ZSA9IG1hdGNoWzFdLnRyaW0oKTtcblxuICAgICAgLy8gQXJyYXkgZm9ybTogW2EsIGIsIGNdXG4gICAgICBpZiAodmFsdWUuc3RhcnRzV2l0aChcIltcIikgJiYgdmFsdWUuZW5kc1dpdGgoXCJdXCIpKSB7XG4gICAgICAgIHZhbHVlID0gdmFsdWUuc2xpY2UoMSwgLTEpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCB0YWdzID0gdmFsdWUuc3BsaXQoXCIsXCIpLm1hcCgodCkgPT4gdC50cmltKCkudG9Mb3dlckNhc2UoKSk7XG4gICAgICBpZiAodGFncy5pbmNsdWRlcyhsb3dlclRhZykpIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIC8vIFlBTUwgbGlzdCBmb3JtOlxuICAgIC8vICAgdGFnczpcbiAgICAvLyAgICAgLSB0YWcxXG4gICAgLy8gICAgIC0gdGFnMlxuICAgIGNvbnN0IGxpc3RSZWdleCA9IC9edGFncz9cXHMqOlxccyokL2ltO1xuICAgIGNvbnN0IGxpc3RNYXRjaCA9IGxpc3RSZWdleC5leGVjKGZyb250bWF0dGVyKTtcbiAgICBpZiAobGlzdE1hdGNoKSB7XG4gICAgICBjb25zdCBhZnRlclRhZ3MgPSBmcm9udG1hdHRlci5zdWJzdHJpbmcoXG4gICAgICAgIGxpc3RNYXRjaC5pbmRleCArIGxpc3RNYXRjaFswXS5sZW5ndGhcbiAgICAgICk7XG4gICAgICBmb3IgKGNvbnN0IGxpbmUgb2YgYWZ0ZXJUYWdzLnNwbGl0KFwiXFxuXCIpKSB7XG4gICAgICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICAgICAgaWYgKHRyaW1tZWQuc3RhcnRzV2l0aChcIi0gXCIpKSB7XG4gICAgICAgICAgY29uc3QgdGFnVmFsID0gdHJpbW1lZC5zdWJzdHJpbmcoMikudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgICAgaWYgKHRhZ1ZhbCA9PT0gbG93ZXJUYWcpIHJldHVybiB0cnVlO1xuICAgICAgICB9IGVsc2UgaWYgKHRyaW1tZWQubGVuZ3RoID4gMCAmJiAhdHJpbW1lZC5zdGFydHNXaXRoKFwiI1wiKSkge1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBnZXRBbGxWYXVsdEZpbGVzKCk6IFByb21pc2U8VmF1bHRGaWxlW10+IHtcbiAgICBjb25zdCBmaWxlcyA9IHRoaXMuYXBwLnZhdWx0LmdldE1hcmtkb3duRmlsZXMoKTtcbiAgICBjb25zdCByZXN1bHQ6IFZhdWx0RmlsZVtdID0gW107XG4gICAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQucmVhZChmaWxlKTtcbiAgICAgICAgcmVzdWx0LnB1c2goeyBwYXRoOiBmaWxlLnBhdGgsIGJhc2VuYW1lOiBmaWxlLmJhc2VuYW1lLCBjb250ZW50IH0pO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8qIHNraXAgKi9cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCBNYXJrZG93biBwb3N0LXByb2Nlc3NvciBmb3Ige3tvYmplY3R9fSBsaW5rcyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBwcml2YXRlIHByb2Nlc3NPYmplY3RMaW5rcyhlbDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICAvLyBXYWxrIGFsbCB0ZXh0IG5vZGVzIGFuZCByZXBsYWNlIHt7Li4ufX0gd2l0aCBjbGlja2FibGUgc3BhbnNcbiAgICBjb25zdCB3YWxrZXIgPSBkb2N1bWVudC5jcmVhdGVUcmVlV2Fsa2VyKGVsLCBOb2RlRmlsdGVyLlNIT1dfVEVYVCk7XG4gICAgY29uc3Qgbm9kZXNUb1JlcGxhY2U6IHsgbm9kZTogVGV4dDsgbWF0Y2hlczogUmVnRXhwRXhlY0FycmF5W10gfVtdID0gW107XG5cbiAgICBsZXQgdGV4dE5vZGU6IFRleHQgfCBudWxsO1xuICAgIHdoaWxlICgodGV4dE5vZGUgPSB3YWxrZXIubmV4dE5vZGUoKSBhcyBUZXh0IHwgbnVsbCkpIHtcbiAgICAgIGNvbnN0IHRleHQgPSB0ZXh0Tm9kZS50ZXh0Q29udGVudCB8fCBcIlwiO1xuICAgICAgY29uc3QgcmVnZXggPSAvXFx7XFx7KFtefV0rKVxcfVxcfS9nO1xuICAgICAgY29uc3QgbWF0Y2hlczogUmVnRXhwRXhlY0FycmF5W10gPSBbXTtcbiAgICAgIGxldCBtYXRjaDogUmVnRXhwRXhlY0FycmF5IHwgbnVsbDtcbiAgICAgIHdoaWxlICgobWF0Y2ggPSByZWdleC5leGVjKHRleHQpKSAhPT0gbnVsbCkge1xuICAgICAgICBtYXRjaGVzLnB1c2goeyAuLi5tYXRjaCwgaW5kZXg6IG1hdGNoLmluZGV4IH0gYXMgUmVnRXhwRXhlY0FycmF5KTtcbiAgICAgIH1cbiAgICAgIGlmIChtYXRjaGVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgbm9kZXNUb1JlcGxhY2UucHVzaCh7IG5vZGU6IHRleHROb2RlLCBtYXRjaGVzIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgeyBub2RlLCBtYXRjaGVzIH0gb2Ygbm9kZXNUb1JlcGxhY2UpIHtcbiAgICAgIGNvbnN0IHRleHQgPSBub2RlLnRleHRDb250ZW50IHx8IFwiXCI7XG4gICAgICBjb25zdCBwYXJlbnQgPSBub2RlLnBhcmVudE5vZGU7XG4gICAgICBpZiAoIXBhcmVudCkgY29udGludWU7XG5cbiAgICAgIGNvbnN0IGZyYWcgPSBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCk7XG4gICAgICBsZXQgbGFzdEluZGV4ID0gMDtcblxuICAgICAgZm9yIChjb25zdCBtYXRjaCBvZiBtYXRjaGVzKSB7XG4gICAgICAgIC8vIFRleHQgYmVmb3JlIHRoZSBtYXRjaFxuICAgICAgICBpZiAobWF0Y2guaW5kZXggPiBsYXN0SW5kZXgpIHtcbiAgICAgICAgICBmcmFnLmFwcGVuZENoaWxkKFxuICAgICAgICAgICAgZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUodGV4dC5zdWJzdHJpbmcobGFzdEluZGV4LCBtYXRjaC5pbmRleCkpXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFRoZSB7e2xpbmt9fSBpdHNlbGZcbiAgICAgICAgbGV0IGxpbmtUYXJnZXQgPSBtYXRjaFsxXTtcbiAgICAgICAgbGV0IGRpc3BsYXlUZXh0ID0gbGlua1RhcmdldDtcbiAgICAgICAgY29uc3QgcGlwZUlkeCA9IGxpbmtUYXJnZXQuaW5kZXhPZihcInxcIik7XG4gICAgICAgIGlmIChwaXBlSWR4ICE9PSAtMSkge1xuICAgICAgICAgIGRpc3BsYXlUZXh0ID0gbGlua1RhcmdldC5zdWJzdHJpbmcocGlwZUlkeCArIDEpLnRyaW0oKTtcbiAgICAgICAgICBsaW5rVGFyZ2V0ID0gbGlua1RhcmdldC5zdWJzdHJpbmcoMCwgcGlwZUlkeCkudHJpbSgpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc3BhbiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgICAgICBzcGFuLmNsYXNzTmFtZSA9IFwib2wtaW5saW5lLWxpbmtcIjtcbiAgICAgICAgc3Bhbi50ZXh0Q29udGVudCA9IGRpc3BsYXlUZXh0O1xuICAgICAgICBzcGFuLnNldEF0dHJpYnV0ZShcImRhdGEtb2wtdGFyZ2V0XCIsIGxpbmtUYXJnZXQpO1xuXG4gICAgICAgIGNvbnN0IG9iaiA9IHRoaXMub2JqZWN0SW5kZXguZ2V0KGxpbmtUYXJnZXQudG9Mb3dlckNhc2UoKSk7XG4gICAgICAgIGlmICghb2JqKSB7XG4gICAgICAgICAgc3Bhbi5jbGFzc0xpc3QuYWRkKFwib2wtaW5saW5lLWxpbmstdW5yZXNvbHZlZFwiKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENsaWNrIC0+IG5hdmlnYXRlIHRvIHRoZSBvYmplY3RcbiAgICAgICAgc3Bhbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGUpID0+IHtcbiAgICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgICBjb25zdCB0YXJnZXQgPSBzcGFuLmdldEF0dHJpYnV0ZShcImRhdGEtb2wtdGFyZ2V0XCIpIHx8IFwiXCI7XG4gICAgICAgICAgY29uc3QgdGFyZ2V0T2JqID0gdGhpcy5vYmplY3RJbmRleC5nZXQodGFyZ2V0LnRvTG93ZXJDYXNlKCkpO1xuICAgICAgICAgIGlmICh0YXJnZXRPYmopIHtcbiAgICAgICAgICAgIHRoaXMuZ29Ub09iamVjdCh0YXJnZXRPYmouZmlsZVBhdGgsIHRhcmdldE9iai5zdGFydExpbmUpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBuZXcgTm90aWNlKGBPYmplY3QgXCIke3RhcmdldH1cIiBub3QgZm91bmRgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIEhvdmVyIC0+IHNob3cgdG9vbHRpcCB3aXRoIHByb3BlcnRpZXNcbiAgICAgICAgc3Bhbi5hZGRFdmVudExpc3RlbmVyKFwibW91c2VlbnRlclwiLCAoZSkgPT4ge1xuICAgICAgICAgIGNvbnN0IHRhcmdldCA9IHNwYW4uZ2V0QXR0cmlidXRlKFwiZGF0YS1vbC10YXJnZXRcIikgfHwgXCJcIjtcbiAgICAgICAgICBjb25zdCB0YXJnZXRPYmogPSB0aGlzLm9iamVjdEluZGV4LmdldCh0YXJnZXQudG9Mb3dlckNhc2UoKSk7XG4gICAgICAgICAgaWYgKHRhcmdldE9iaikge1xuICAgICAgICAgICAgdGhpcy5zaG93T2JqZWN0UG9wb3ZlcihzcGFuLCB0YXJnZXRPYmopO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIHNwYW4uYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlbGVhdmVcIiwgKCkgPT4ge1xuICAgICAgICAgIHRoaXMuaGlkZU9iamVjdFBvcG92ZXIoKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgZnJhZy5hcHBlbmRDaGlsZChzcGFuKTtcbiAgICAgICAgbGFzdEluZGV4ID0gbWF0Y2guaW5kZXggKyBtYXRjaFswXS5sZW5ndGg7XG4gICAgICB9XG5cbiAgICAgIC8vIFJlbWFpbmluZyB0ZXh0XG4gICAgICBpZiAobGFzdEluZGV4IDwgdGV4dC5sZW5ndGgpIHtcbiAgICAgICAgZnJhZy5hcHBlbmRDaGlsZChkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZSh0ZXh0LnN1YnN0cmluZyhsYXN0SW5kZXgpKSk7XG4gICAgICB9XG5cbiAgICAgIHBhcmVudC5yZXBsYWNlQ2hpbGQoZnJhZywgbm9kZSk7XG4gICAgfVxuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIE9iamVjdCBwb3BvdmVyIG9uIGhvdmVyIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG4gIHByaXZhdGUgcG9wb3ZlckVsOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xuXG4gIHByaXZhdGUgc2hvd09iamVjdFBvcG92ZXIoYW5jaG9yOiBIVE1MRWxlbWVudCwgb2JqOiBQYXJzZWRPYmplY3QpOiB2b2lkIHtcbiAgICB0aGlzLmhpZGVPYmplY3RQb3BvdmVyKCk7XG5cbiAgICBjb25zdCBwb3AgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHBvcC5jbGFzc05hbWUgPSBcIm9sLXBvcG92ZXJcIjtcblxuICAgIGNvbnN0IHRpdGxlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICB0aXRsZS5jbGFzc05hbWUgPSBcIm9sLXBvcG92ZXItdGl0bGVcIjtcbiAgICB0aXRsZS50ZXh0Q29udGVudCA9IG9iai5kaXNwbGF5S2V5O1xuICAgIHBvcC5hcHBlbmRDaGlsZCh0aXRsZSk7XG5cbiAgICBjb25zdCBmaWxlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICBmaWxlLmNsYXNzTmFtZSA9IFwib2wtcG9wb3Zlci1maWxlXCI7XG4gICAgZmlsZS50ZXh0Q29udGVudCA9IG9iai5maWxlTGFiZWw7XG4gICAgcG9wLmFwcGVuZENoaWxkKGZpbGUpO1xuXG4gICAgZm9yIChjb25zdCBbaywgdl0gb2YgT2JqZWN0LmVudHJpZXMob2JqLnByb3BlcnRpZXMpKSB7XG4gICAgICBjb25zdCByb3cgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgcm93LmNsYXNzTmFtZSA9IFwib2wtcG9wb3Zlci1yb3dcIjtcbiAgICAgIHJvdy5pbm5lckhUTUwgPSBgPHNwYW4gY2xhc3M9XCJvbC1wb3BvdmVyLWtleVwiPiR7a308L3NwYW4+PHNwYW4gY2xhc3M9XCJvbC1wb3BvdmVyLXZhbFwiPiR7dn08L3NwYW4+YDtcbiAgICAgIHBvcC5hcHBlbmRDaGlsZChyb3cpO1xuICAgIH1cblxuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQocG9wKTtcbiAgICB0aGlzLnBvcG92ZXJFbCA9IHBvcDtcblxuICAgIC8vIFBvc2l0aW9uIGJlbG93IHRoZSBhbmNob3JcbiAgICBjb25zdCByZWN0ID0gYW5jaG9yLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgIHBvcC5zdHlsZS50b3AgPSByZWN0LmJvdHRvbSArIDQgKyBcInB4XCI7XG4gICAgcG9wLnN0eWxlLmxlZnQgPSByZWN0LmxlZnQgKyBcInB4XCI7XG4gIH1cblxuICBwcml2YXRlIGhpZGVPYmplY3RQb3BvdmVyKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLnBvcG92ZXJFbCkge1xuICAgICAgdGhpcy5wb3BvdmVyRWwucmVtb3ZlKCk7XG4gICAgICB0aGlzLnBvcG92ZXJFbCA9IG51bGw7XG4gICAgfVxuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIE5hdmlnYXRpb24gaGVscGVycyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBwcml2YXRlIGFzeW5jIGdvVG9PYmplY3QoZmlsZVBhdGg6IHN0cmluZywgc3RhcnRMaW5lOiBudW1iZXIpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGZpbGVQYXRoKTtcbiAgICBpZiAoIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpKSB7XG4gICAgICBuZXcgTm90aWNlKGBGaWxlIG5vdCBmb3VuZDogJHtmaWxlUGF0aH1gKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBsZWFmID0gdGhpcy5hcHAud29ya3NwYWNlLmdldExlYWYoXCJ0YWJcIik7XG4gICAgYXdhaXQgbGVhZi5vcGVuRmlsZShmaWxlKTtcblxuICAgIC8vIFNjcm9sbCB0byB0aGUgbGluZVxuICAgIGNvbnN0IHZpZXcgPSBsZWFmLnZpZXcgYXMgYW55O1xuICAgIGlmICh2aWV3ICYmIHZpZXcuZWRpdG9yKSB7XG4gICAgICAvLyBHaXZlIHRoZSBlZGl0b3IgYSBtb21lbnQgdG8gbG9hZFxuICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgdmlldy5lZGl0b3Iuc2V0Q3Vyc29yKHsgbGluZTogc3RhcnRMaW5lLCBjaDogMCB9KTtcbiAgICAgICAgICB2aWV3LmVkaXRvci5zY3JvbGxJbnRvVmlldyhcbiAgICAgICAgICAgIHsgZnJvbTogeyBsaW5lOiBzdGFydExpbmUsIGNoOiAwIH0sIHRvOiB7IGxpbmU6IHN0YXJ0TGluZSArIDUsIGNoOiAwIH0gfSxcbiAgICAgICAgICAgIHRydWVcbiAgICAgICAgICApO1xuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAvKiBlZGl0b3IgbWlnaHQgbm90IHN1cHBvcnQgdGhpcyAqL1xuICAgICAgICB9XG4gICAgICB9LCAxMDApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZ29Ub0ZpbGUoZmlsZVBhdGg6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoZmlsZVBhdGgpO1xuICAgIGlmICghKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHtcbiAgICAgIG5ldyBOb3RpY2UoYEZpbGUgbm90IGZvdW5kOiAke2ZpbGVQYXRofWApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBsZWFmID0gdGhpcy5hcHAud29ya3NwYWNlLmdldExlYWYoXCJ0YWJcIik7XG4gICAgYXdhaXQgbGVhZi5vcGVuRmlsZShmaWxlKTtcbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCBBY3RpdmF0ZSB2aWV3IFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG4gIGFzeW5jIGFjdGl2YXRlVmlldygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB7IHdvcmtzcGFjZSB9ID0gdGhpcy5hcHA7XG5cbiAgICBsZXQgbGVhZjogV29ya3NwYWNlTGVhZiB8IG51bGwgPSBudWxsO1xuICAgIGNvbnN0IGxlYXZlcyA9IHdvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoVklFV19UWVBFKTtcblxuICAgIGlmIChsZWF2ZXMubGVuZ3RoID4gMCkge1xuICAgICAgbGVhZiA9IGxlYXZlc1swXTtcbiAgICB9IGVsc2Uge1xuICAgICAgbGVhZiA9IHdvcmtzcGFjZS5nZXRMZWFmKFwidGFiXCIpO1xuICAgICAgYXdhaXQgbGVhZi5zZXRWaWV3U3RhdGUoeyB0eXBlOiBWSUVXX1RZUEUsIGFjdGl2ZTogdHJ1ZSB9KTtcbiAgICB9XG5cbiAgICB3b3Jrc3BhY2UucmV2ZWFsTGVhZihsZWFmKTtcblxuICAgIC8vIEJ1aWxkL3JlZnJlc2ggZ3JhcGhcbiAgICBhd2FpdCB0aGlzLmZ1bGxSZWZyZXNoKCk7XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgU2V0dGluZ3MgcGVyc2lzdGVuY2UgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbiAgYXN5bmMgbG9hZFNldHRpbmdzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuc2V0dGluZ3MgPSBPYmplY3QuYXNzaWduKHt9LCBERUZBVUxUX1NFVFRJTkdTLCBhd2FpdCB0aGlzLmxvYWREYXRhKCkpO1xuICB9XG5cbiAgYXN5bmMgc2F2ZVNldHRpbmdzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuc2F2ZURhdGEodGhpcy5zZXR0aW5ncyk7XG4gICAgLy8gUmUtc2NhbiBhZnRlciBzZXR0aW5ncyBjaGFuZ2UgKHRhZyBtYXkgaGF2ZSBjaGFuZ2VkKVxuICAgIHRoaXMuZnVsbFJlZnJlc2goKTtcbiAgfVxufVxuIiwgIi8qKlxuICogUGFyc2VyIGZvciBtdWx0aS1vYmplY3QgbWFya2Rvd24gZmlsZXMuXG4gKlxuICogRm9ybWF0OlxuICogICBrZXk6IDxwcm9wZXJ0eV9uYW1lPlxuICpcbiAqICAgLS0tXG4gKlxuICogICBwcm9wMTogdmFsdWUxXG4gKiAgIHByb3AyOiB2YWx1ZTJcbiAqXG4gKiAgIC0tLVxuICpcbiAqICAgcHJvcDE6IHZhbHVlM1xuICogICBwcm9wMjogdmFsdWU0XG4gKi9cblxuZXhwb3J0IGludGVyZmFjZSBQYXJzZWRPYmplY3Qge1xuICAvKiogVGhlIHZhbHVlIG9mIHRoZSBrZXkgcHJvcGVydHkgLS0gdXNlZCBhcyB0aGUgbGlua2FibGUgbmFtZSAqL1xuICBrZXlWYWx1ZTogc3RyaW5nO1xuICAvKipcbiAgICogRGlzYW1iaWd1YXRlZCBpZGVudGlmaWVyIHVzZWQgZm9yIHt7fX0gbGlua3MsIGluZGV4IGxvb2t1cHMsIGFuZCBncmFwaCBsYWJlbHMuXG4gICAqIERlZmF1bHRzIHRvIGtleVZhbHVlLiBJZiBkdXBsaWNhdGVzIGV4aXN0OlxuICAgKiAgIC0gZGlmZmVyZW50IGZpbGVzOiBcImtleVZhbHVlIChmaWxlTGFiZWwpXCJcbiAgICogICAtIHNhbWUgZmlsZTogXCJrZXlWYWx1ZSAoc2Vjb25kUHJvcGVydHlWYWx1ZSlcIlxuICAgKiBTZXQgZHVyaW5nIGZ1bGxSZWZyZXNoKCkgaW4gbWFpbi50cy5cbiAgICovXG4gIGRpc3BsYXlLZXk6IHN0cmluZztcbiAgLyoqIE1hbmRhdG9yeSBudW1lcmljIGlkIGZvciB0aGlzIG9iamVjdCAqL1xuICBpZDogbnVtYmVyO1xuICAvKiogQWxsIHByb3BlcnRpZXMgb2YgdGhpcyBvYmplY3QgKGluc2VydGlvbi1vcmRlcmVkKSAqL1xuICBwcm9wZXJ0aWVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICAvKiogT3JkZXJlZCBsaXN0IG9mIHByb3BlcnR5IG5hbWVzIGFzIHRoZXkgYXBwZWFyIGluIHRoZSBmaWxlICovXG4gIHByb3BlcnR5T3JkZXI6IHN0cmluZ1tdO1xuICAvKiogU291cmNlIGZpbGUgcGF0aCAqL1xuICBmaWxlUGF0aDogc3RyaW5nO1xuICAvKiogU291cmNlIGZpbGUgYmFzZW5hbWUgKHdpdGhvdXQgZXh0ZW5zaW9uKSAqL1xuICBmaWxlTGFiZWw6IHN0cmluZztcbiAgLyoqIDAtaW5kZXhlZCBsaW5lIG51bWJlciB3aGVyZSB0aGlzIG9iamVjdCBibG9jayBzdGFydHMgaW4gdGhlIGZpbGUgKi9cbiAgc3RhcnRMaW5lOiBudW1iZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUGFyc2VkRmlsZSB7XG4gIC8qKiBUaGUgcHJvcGVydHkgbmFtZSB1c2VkIGFzIGtleSAqL1xuICBrZXlQcm9wZXJ0eTogc3RyaW5nO1xuICAvKiogQWxsIHBhcnNlZCBvYmplY3RzIGluIHRoaXMgZmlsZSAqL1xuICBvYmplY3RzOiBQYXJzZWRPYmplY3RbXTtcbiAgLyoqIFNvdXJjZSBmaWxlIHBhdGggKi9cbiAgZmlsZVBhdGg6IHN0cmluZztcbn1cblxuLyoqXG4gKiBQYXJzZSBhIG11bHRpLW9iamVjdCBtYXJrZG93biBmaWxlLlxuICogUmV0dXJucyBudWxsIGlmIHRoZSBmaWxlIGRvZXNuJ3QgZm9sbG93IHRoZSBleHBlY3RlZCBmb3JtYXQuXG4gKlxuICogU2tpcHMgWUFNTCBmcm9udG1hdHRlciAoaWYgcHJlc2VudCkgYmVmb3JlIGxvb2tpbmcgZm9yIHRoZVxuICogYGtleTogPHByb3BlcnR5PmAgaGVhZGVyIGFuZCBgLS0tYCBzZXBhcmF0ZWQgb2JqZWN0IGJsb2Nrcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTXVsdGlPYmplY3RGaWxlKFxuICBjb250ZW50OiBzdHJpbmcsXG4gIGZpbGVQYXRoOiBzdHJpbmdcbik6IFBhcnNlZEZpbGUgfCBudWxsIHtcbiAgY29uc3QgbGluZXMgPSBjb250ZW50LnNwbGl0KFwiXFxuXCIpO1xuXG4gIC8vIFNraXAgWUFNTCBmcm9udG1hdHRlciAob3BlbmluZyAtLS0gb24gZmlyc3QgbGluZSwgY2xvc2luZyAtLS0gbGF0ZXIpXG4gIGxldCBzdGFydElkeCA9IDA7XG4gIGlmIChsaW5lcy5sZW5ndGggPiAwICYmIGxpbmVzWzBdLnRyaW0oKSA9PT0gXCItLS1cIikge1xuICAgIGZvciAobGV0IGkgPSAxOyBpIDwgbGluZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGlmIChsaW5lc1tpXS50cmltKCkgPT09IFwiLS0tXCIpIHtcbiAgICAgICAgc3RhcnRJZHggPSBpICsgMTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gRmlyc3Qgbm9uLWVtcHR5IGxpbmUgKGFmdGVyIGZyb250bWF0dGVyKSBzaG91bGQgYmUgXCJrZXk6IDxwcm9wZXJ0eT5cIlxuICAvLyBCdXQgc2tpcCBiYXJlICN0YWcgbGluZXMgKGUuZy4gI29iamVjdC1saW5rcykgdGhhdCBwcmVjZWRlIGl0XG4gIGxldCBrZXlMaW5lID0gXCJcIjtcbiAgZm9yIChsZXQgaSA9IHN0YXJ0SWR4OyBpIDwgbGluZXMubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZXNbaV0udHJpbSgpO1xuICAgIGlmICh0cmltbWVkLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgLy8gU2tpcCBiYXJlIHRhZyBsaW5lcyBsaWtlIFwiI29iamVjdC1saW5rc1wiXG4gICAgaWYgKHRyaW1tZWQuc3RhcnRzV2l0aChcIiNcIikgJiYgIXRyaW1tZWQuaW5jbHVkZXMoXCI6XCIpKSBjb250aW51ZTtcbiAgICBrZXlMaW5lID0gdHJpbW1lZDtcbiAgICBicmVhaztcbiAgfVxuXG4gIGNvbnN0IGtleU1hdGNoID0ga2V5TGluZS5tYXRjaCgvXmtleTpcXHMqKC4rKSQvaSk7XG4gIGlmICgha2V5TWF0Y2gpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGtleVByb3BlcnR5ID0ga2V5TWF0Y2hbMV0udHJpbSgpO1xuICBjb25zdCBmaWxlTGFiZWwgPSBmaWxlUGF0aC5yZXBsYWNlKC9eLipcXC8vLCBcIlwiKS5yZXBsYWNlKC9cXC5tZCQvaSwgXCJcIik7XG5cbiAgLy8gV2FsayBsaW5lcyAoYWZ0ZXIgZnJvbnRtYXR0ZXIpIHRvIGZpbmQgLS0tIHNlcGFyYXRvcnMgYW5kIGJ1aWxkIG9iamVjdHNcbiAgY29uc3Qgb2JqZWN0czogUGFyc2VkT2JqZWN0W10gPSBbXTtcbiAgbGV0IGN1cnJlbnRCbG9jazogeyBsaW5lczogc3RyaW5nW107IHN0YXJ0TGluZTogbnVtYmVyIH0gfCBudWxsID0gbnVsbDtcbiAgbGV0IHBhc3NlZEZpcnN0U2VwYXJhdG9yID0gZmFsc2U7XG5cbiAgZm9yIChsZXQgaSA9IHN0YXJ0SWR4OyBpIDwgbGluZXMubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZXNbaV0udHJpbSgpO1xuXG4gICAgaWYgKHRyaW1tZWQgPT09IFwiLS0tXCIpIHtcbiAgICAgIC8vIEZsdXNoIHRoZSBjdXJyZW50IGJsb2NrIGlmIHdlIGhhdmUgb25lXG4gICAgICBpZiAoY3VycmVudEJsb2NrICYmIHBhc3NlZEZpcnN0U2VwYXJhdG9yKSB7XG4gICAgICAgIGNvbnN0IG9iaiA9IHBhcnNlQmxvY2soY3VycmVudEJsb2NrLCBrZXlQcm9wZXJ0eSwgZmlsZVBhdGgsIGZpbGVMYWJlbCk7XG4gICAgICAgIGlmIChvYmopIG9iamVjdHMucHVzaChvYmopO1xuICAgICAgfVxuICAgICAgcGFzc2VkRmlyc3RTZXBhcmF0b3IgPSB0cnVlO1xuICAgICAgY3VycmVudEJsb2NrID0geyBsaW5lczogW10sIHN0YXJ0TGluZTogaSArIDEgfTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChjdXJyZW50QmxvY2sgJiYgcGFzc2VkRmlyc3RTZXBhcmF0b3IpIHtcbiAgICAgIGN1cnJlbnRCbG9jay5saW5lcy5wdXNoKHRyaW1tZWQpO1xuICAgIH1cbiAgfVxuXG4gIC8vIEZsdXNoIHRoZSBsYXN0IGJsb2NrXG4gIGlmIChjdXJyZW50QmxvY2sgJiYgcGFzc2VkRmlyc3RTZXBhcmF0b3IpIHtcbiAgICBjb25zdCBvYmogPSBwYXJzZUJsb2NrKGN1cnJlbnRCbG9jaywga2V5UHJvcGVydHksIGZpbGVQYXRoLCBmaWxlTGFiZWwpO1xuICAgIGlmIChvYmopIG9iamVjdHMucHVzaChvYmopO1xuICB9XG5cbiAgaWYgKG9iamVjdHMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICByZXR1cm4geyBrZXlQcm9wZXJ0eSwgb2JqZWN0cywgZmlsZVBhdGggfTtcbn1cblxuZnVuY3Rpb24gcGFyc2VCbG9jayhcbiAgYmxvY2s6IHsgbGluZXM6IHN0cmluZ1tdOyBzdGFydExpbmU6IG51bWJlciB9LFxuICBrZXlQcm9wZXJ0eTogc3RyaW5nLFxuICBmaWxlUGF0aDogc3RyaW5nLFxuICBmaWxlTGFiZWw6IHN0cmluZ1xuKTogUGFyc2VkT2JqZWN0IHwgbnVsbCB7XG4gIGNvbnN0IHByb3BlcnRpZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcbiAgY29uc3QgcHJvcGVydHlPcmRlcjogc3RyaW5nW10gPSBbXTtcblxuICBmb3IgKGNvbnN0IGxpbmUgb2YgYmxvY2subGluZXMpIHtcbiAgICBpZiAoIWxpbmUpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGNvbG9uSW5kZXggPSBsaW5lLmluZGV4T2YoXCI6XCIpO1xuICAgIGlmIChjb2xvbkluZGV4ID09PSAtMSkgY29udGludWU7XG5cbiAgICBjb25zdCBwcm9wID0gbGluZS5zdWJzdHJpbmcoMCwgY29sb25JbmRleCkudHJpbSgpO1xuICAgIGNvbnN0IHZhbCA9IGxpbmUuc3Vic3RyaW5nKGNvbG9uSW5kZXggKyAxKS50cmltKCk7XG4gICAgaWYgKHByb3AgJiYgdmFsKSB7XG4gICAgICBwcm9wZXJ0aWVzW3Byb3BdID0gdmFsO1xuICAgICAgcHJvcGVydHlPcmRlci5wdXNoKHByb3ApO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGtleVZhbHVlID0gcHJvcGVydGllc1trZXlQcm9wZXJ0eV07XG4gIGlmICgha2V5VmFsdWUpIHJldHVybiBudWxsO1xuXG4gIC8vIE1hbmRhdG9yeSBpZCBwcm9wZXJ0eTogbXVzdCBiZSBwcmVzZW50IGFuZCBudW1lcmljXG4gIGNvbnN0IHJhd0lkID0gcHJvcGVydGllc1tcImlkXCJdO1xuICBpZiAoIXJhd0lkKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgaWQgPSBOdW1iZXIocmF3SWQpO1xuICBpZiAoaXNOYU4oaWQpKSByZXR1cm4gbnVsbDtcblxuICByZXR1cm4ge1xuICAgIGtleVZhbHVlLFxuICAgIGRpc3BsYXlLZXk6IGtleVZhbHVlLCAvLyBkZWZhdWx0OyBkaXNhbWJpZ3VhdGVkIGxhdGVyIGluIGZ1bGxSZWZyZXNoKClcbiAgICBpZCxcbiAgICBwcm9wZXJ0aWVzLFxuICAgIHByb3BlcnR5T3JkZXIsXG4gICAgZmlsZVBhdGgsXG4gICAgZmlsZUxhYmVsLFxuICAgIHN0YXJ0TGluZTogYmxvY2suc3RhcnRMaW5lLFxuICB9O1xufVxuXG4vKipcbiAqIEdldCB0aGUgdmFsdWUgb2YgdGhlIFwic2Vjb25kIHByb3BlcnR5XCIgb2YgYW4gb2JqZWN0IGZvciBkaXNhbWJpZ3VhdGlvbi5cbiAqIFRoaXMgaXMgdGhlIGZpcnN0IHByb3BlcnR5IHRoYXQgaXMgbm90IHRoZSBrZXkgcHJvcGVydHkgYW5kIG5vdCBcImlkXCIuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRTZWNvbmRQcm9wZXJ0eShcbiAgb2JqOiBQYXJzZWRPYmplY3QsXG4gIGtleVByb3BlcnR5OiBzdHJpbmdcbik6IHN0cmluZyB8IG51bGwge1xuICBmb3IgKGNvbnN0IHByb3Agb2Ygb2JqLnByb3BlcnR5T3JkZXIpIHtcbiAgICBpZiAocHJvcCA9PT0ga2V5UHJvcGVydHkgfHwgcHJvcCA9PT0gXCJpZFwiKSBjb250aW51ZTtcbiAgICBjb25zdCB2YWwgPSBvYmoucHJvcGVydGllc1twcm9wXTtcbiAgICBpZiAodmFsKSByZXR1cm4gdmFsO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIEV4dHJhY3QgYWxsIHt7b2JqZWN0IGxpbmtzfX0gZnJvbSBjb250ZW50LlxuICogUmV0dXJucyB0aGUgbGluayB0YXJnZXQgbmFtZXMgKHdpdGhvdXQge3sgfX0pLlxuICogSGFuZGxlcyBhbGlhc2VzIGxpa2Uge3t0YXJnZXR8YWxpYXN9fSBieSByZXR1cm5pbmcganVzdCBcInRhcmdldFwiLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdE9iamVjdExpbmtzKGNvbnRlbnQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgbGlua3M6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IHJlZ2V4ID0gL1xce1xceyhbXn1dKylcXH1cXH0vZztcbiAgbGV0IG1hdGNoO1xuXG4gIHdoaWxlICgobWF0Y2ggPSByZWdleC5leGVjKGNvbnRlbnQpKSAhPT0gbnVsbCkge1xuICAgIGxldCBsaW5rVGFyZ2V0ID0gbWF0Y2hbMV07XG4gICAgY29uc3QgcGlwZUluZGV4ID0gbGlua1RhcmdldC5pbmRleE9mKFwifFwiKTtcbiAgICBpZiAocGlwZUluZGV4ICE9PSAtMSkge1xuICAgICAgbGlua1RhcmdldCA9IGxpbmtUYXJnZXQuc3Vic3RyaW5nKDAsIHBpcGVJbmRleCk7XG4gICAgfVxuICAgIGxpbmtzLnB1c2gobGlua1RhcmdldC50cmltKCkpO1xuICB9XG5cbiAgcmV0dXJuIGxpbmtzO1xufVxuXG4vKipcbiAqIEV4dHJhY3QgYWxsIFtbd2lraWxpbmtzXV0gZnJvbSBjb250ZW50LlxuICogUmV0dXJucyB0aGUgbGluayB0YXJnZXQgbmFtZXMgKHdpdGhvdXQgW1sgXV0pLlxuICogSGFuZGxlcyBhbGlhc2VzIGxpa2UgW1t0YXJnZXR8YWxpYXNdXSBieSByZXR1cm5pbmcganVzdCBcInRhcmdldFwiLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdFdpa2lsaW5rcyhjb250ZW50OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IGxpbmtzOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCByZWdleCA9IC9cXFtcXFsoW15cXF1dKylcXF1cXF0vZztcbiAgbGV0IG1hdGNoO1xuXG4gIHdoaWxlICgobWF0Y2ggPSByZWdleC5leGVjKGNvbnRlbnQpKSAhPT0gbnVsbCkge1xuICAgIGxldCBsaW5rVGFyZ2V0ID0gbWF0Y2hbMV07XG4gICAgY29uc3QgcGlwZUluZGV4ID0gbGlua1RhcmdldC5pbmRleE9mKFwifFwiKTtcbiAgICBpZiAocGlwZUluZGV4ICE9PSAtMSkge1xuICAgICAgbGlua1RhcmdldCA9IGxpbmtUYXJnZXQuc3Vic3RyaW5nKDAsIHBpcGVJbmRleCk7XG4gICAgfVxuICAgIGxpbmtzLnB1c2gobGlua1RhcmdldC50cmltKCkpO1xuICB9XG5cbiAgcmV0dXJuIGxpbmtzO1xufVxuIiwgImltcG9ydCB7IFBhcnNlZEZpbGUsIGV4dHJhY3RPYmplY3RMaW5rcywgZXh0cmFjdFdpa2lsaW5rcyB9IGZyb20gXCIuL3BhcnNlclwiO1xuXG5leHBvcnQgaW50ZXJmYWNlIEdyYXBoTm9kZSB7XG4gIGlkOiBzdHJpbmc7XG4gIGxhYmVsOiBzdHJpbmc7XG4gIC8qKiBcIm9iamVjdFwiIGZvciBtdWx0aS1vYmplY3QgZW50cmllcywgXCJmaWxlXCIgZm9yIHJlZ3VsYXIgdmF1bHQgZmlsZXMgKi9cbiAgdHlwZTogXCJvYmplY3RcIiB8IFwiZmlsZVwiO1xuICBmaWxlUGF0aDogc3RyaW5nO1xuICBmaWxlTGFiZWw6IHN0cmluZztcbiAgcHJvcGVydGllczogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgLyoqIDAtaW5kZXhlZCBzdGFydCBsaW5lIGluIHRoZSBzb3VyY2UgZmlsZSAob2JqZWN0cyBvbmx5KSAqL1xuICBzdGFydExpbmU6IG51bWJlcjtcbiAgLyoqIE51bWJlciBvZiBjb25uZWN0aW9ucyAqL1xuICBjb25uZWN0aW9uczogbnVtYmVyO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEdyYXBoRWRnZSB7XG4gIHNvdXJjZTogc3RyaW5nO1xuICB0YXJnZXQ6IHN0cmluZztcbiAgLyoqIFwib2JqZWN0XCIgaWYgdGhpcyBlZGdlIGludm9sdmVzIGEge3t9fSBsaW5rLCBcIndpa2lcIiBmb3IgbmF0aXZlIFtbXV0gbGlua3MgKi9cbiAgZWRnZVR5cGU6IFwib2JqZWN0XCIgfCBcIndpa2lcIjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBHcmFwaERhdGEge1xuICBub2RlczogR3JhcGhOb2RlW107XG4gIGVkZ2VzOiBHcmFwaEVkZ2VbXTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBWYXVsdEZpbGUge1xuICBwYXRoOiBzdHJpbmc7XG4gIGJhc2VuYW1lOiBzdHJpbmc7XG4gIGNvbnRlbnQ6IHN0cmluZztcbn1cblxuLyoqXG4gKiBCdWlsZCB0aGUgZnVsbCBncmFwaCBmcm9tIHRoZSB2YXVsdC5cbiAqXG4gKiBOb2RlczpcbiAqICAgLSBFYWNoIG9iamVjdCBpbiBhIG11bHRpLW9iamVjdCBmaWxlIC0+IHR5cGUgXCJvYmplY3RcIlxuICogICAtIEVhY2ggcmVndWxhciB2YXVsdCBmaWxlIHRoYXQgcGFydGljaXBhdGVzIGluIGFueSBsaW5rIC0+IHR5cGUgXCJmaWxlXCJcbiAqXG4gKiBFZGdlczpcbiAqICAgLSBmaWxlIC0+IG9iamVjdCAgd2hlbiBhIGZpbGUgY29udGFpbnMge3tPYmplY3RLZXl9fVxuICogICAtIGZpbGUgLT4gZmlsZSAgICB3aGVuIGEgZmlsZSBjb250YWlucyBbW090aGVyRmlsZV1dIChuYXRpdmUgd2lraWxpbmtzKVxuICogICAtIG9iamVjdCAtPiBvYmplY3Qgd2hlbiBhbiBvYmplY3QncyBwcm9wZXJ0eSB2YWx1ZSBjb250YWlucyB7e090aGVyT2JqZWN0fX1cbiAqXG4gKiBNdWx0aS1vYmplY3Qgc291cmNlIGZpbGVzIChlLmcuLCBGaWxtcy5tZCkgZG8gTk9UIGFwcGVhciBhcyBmaWxlIG5vZGVzO1xuICogb25seSB0aGVpciBpbmRpdmlkdWFsIG9iamVjdHMgZG8uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZEdyYXBoKFxuICBwYXJzZWRGaWxlczogUGFyc2VkRmlsZVtdLFxuICBhbGxGaWxlczogVmF1bHRGaWxlW11cbik6IEdyYXBoRGF0YSB7XG4gIGNvbnN0IG5vZGVzOiBHcmFwaE5vZGVbXSA9IFtdO1xuICBjb25zdCBlZGdlczogR3JhcGhFZGdlW10gPSBbXTtcbiAgY29uc3QgZWRnZVNldCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBjb25zdCBub2RlTWFwID0gbmV3IE1hcDxzdHJpbmcsIEdyYXBoTm9kZT4oKTtcblxuICAvLyBQYXRocyBvZiBtdWx0aS1vYmplY3Qgc291cmNlIGZpbGVzIC0tIHRoZXNlIGFyZSByZXBsYWNlZCBieSB0aGVpciBvYmplY3RzXG4gIGNvbnN0IG11bHRpT2JqZWN0UGF0aHMgPSBuZXcgU2V0KHBhcnNlZEZpbGVzLm1hcCgoZikgPT4gZi5maWxlUGF0aCkpO1xuXG4gIC8vIE1hcDogbG93ZXJjYXNlIGtleSB2YWx1ZSAtPiBvYmplY3Qgbm9kZSBpZFxuICBjb25zdCBvYmpLZXlUb05vZGVJZCA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCk7XG5cbiAgLy8gTWFwOiBsb3dlcmNhc2UgZmlsZSBiYXNlbmFtZSAtPiBmaWxlIHBhdGggKGZvciByZXNvbHZpbmcgW1t3aWtpbGlua3NdXSlcbiAgY29uc3QgYmFzZW5hbWVUb1BhdGggPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpO1xuICBmb3IgKGNvbnN0IGYgb2YgYWxsRmlsZXMpIHtcbiAgICBiYXNlbmFtZVRvUGF0aC5zZXQoZi5iYXNlbmFtZS50b0xvd2VyQ2FzZSgpLCBmLnBhdGgpO1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIDEuIENyZWF0ZSBvYmplY3Qgbm9kZXMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG4gIGZvciAoY29uc3QgZmlsZSBvZiBwYXJzZWRGaWxlcykge1xuICAgIGZvciAoY29uc3Qgb2JqIG9mIGZpbGUub2JqZWN0cykge1xuICAgICAgY29uc3Qgbm9kZUlkID0gYG9iajo6JHtmaWxlLmZpbGVQYXRofTo6JHtvYmouZGlzcGxheUtleX1gO1xuICAgICAgY29uc3Qgbm9kZTogR3JhcGhOb2RlID0ge1xuICAgICAgICBpZDogbm9kZUlkLFxuICAgICAgICBsYWJlbDogb2JqLmRpc3BsYXlLZXksXG4gICAgICAgIHR5cGU6IFwib2JqZWN0XCIsXG4gICAgICAgIGZpbGVQYXRoOiBvYmouZmlsZVBhdGgsXG4gICAgICAgIGZpbGVMYWJlbDogb2JqLmZpbGVMYWJlbCxcbiAgICAgICAgcHJvcGVydGllczogb2JqLnByb3BlcnRpZXMsXG4gICAgICAgIHN0YXJ0TGluZTogb2JqLnN0YXJ0TGluZSxcbiAgICAgICAgY29ubmVjdGlvbnM6IDAsXG4gICAgICB9O1xuICAgICAgbm9kZXMucHVzaChub2RlKTtcbiAgICAgIG5vZGVNYXAuc2V0KG5vZGVJZCwgbm9kZSk7XG4gICAgICAvLyBSZWdpc3RlciBieSBkaXNwbGF5S2V5IChwcmltYXJ5IGxvb2t1cCBmb3IgZGlzYW1iaWd1YXRlZCBuYW1lcylcbiAgICAgIG9iaktleVRvTm9kZUlkLnNldChvYmouZGlzcGxheUtleS50b0xvd2VyQ2FzZSgpLCBub2RlSWQpO1xuICAgICAgLy8gQWxzbyByZWdpc3RlciBieSBwbGFpbiBrZXlWYWx1ZSBpZiBub3QgYWxyZWFkeSB0YWtlbiAoYmFja3dhcmRzIGNvbXBhdClcbiAgICAgIGNvbnN0IHBsYWluID0gb2JqLmtleVZhbHVlLnRvTG93ZXJDYXNlKCk7XG4gICAgICBpZiAoIW9iaktleVRvTm9kZUlkLmhhcyhwbGFpbikpIHtcbiAgICAgICAgb2JqS2V5VG9Ob2RlSWQuc2V0KHBsYWluLCBub2RlSWQpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIEhlbHBlcjogZ2V0IG9yIGNyZWF0ZSBhIGZpbGUgbm9kZVxuICBmdW5jdGlvbiBlbnN1cmVGaWxlTm9kZShwYXRoOiBzdHJpbmcsIGJhc2VuYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IG5vZGVJZCA9IGBmaWxlOjoke3BhdGh9YDtcbiAgICBpZiAoIW5vZGVNYXAuaGFzKG5vZGVJZCkpIHtcbiAgICAgIGNvbnN0IG5vZGU6IEdyYXBoTm9kZSA9IHtcbiAgICAgICAgaWQ6IG5vZGVJZCxcbiAgICAgICAgbGFiZWw6IGJhc2VuYW1lLFxuICAgICAgICB0eXBlOiBcImZpbGVcIixcbiAgICAgICAgZmlsZVBhdGg6IHBhdGgsXG4gICAgICAgIGZpbGVMYWJlbDogYmFzZW5hbWUsXG4gICAgICAgIHByb3BlcnRpZXM6IHt9LFxuICAgICAgICBzdGFydExpbmU6IDAsXG4gICAgICAgIGNvbm5lY3Rpb25zOiAwLFxuICAgICAgfTtcbiAgICAgIG5vZGVzLnB1c2gobm9kZSk7XG4gICAgICBub2RlTWFwLnNldChub2RlSWQsIG5vZGUpO1xuICAgIH1cbiAgICByZXR1cm4gbm9kZUlkO1xuICB9XG5cbiAgLy8gSGVscGVyOiBhZGQgYW4gZWRnZSAoZGVkdXBsaWNhdGVkKVxuICBmdW5jdGlvbiBhZGRFZGdlKHNyYzogc3RyaW5nLCB0Z3Q6IHN0cmluZywgdHlwZTogXCJvYmplY3RcIiB8IFwid2lraVwiKTogdm9pZCB7XG4gICAgY29uc3QgZWRnZUlkID0gW3NyYywgdGd0XS5zb3J0KCkuam9pbihcIi0tXCIpO1xuICAgIGlmIChlZGdlU2V0LmhhcyhlZGdlSWQpKSByZXR1cm47XG4gICAgZWRnZVNldC5hZGQoZWRnZUlkKTtcbiAgICBlZGdlcy5wdXNoKHsgc291cmNlOiBzcmMsIHRhcmdldDogdGd0LCBlZGdlVHlwZTogdHlwZSB9KTtcbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCAyLiBTY2FuIGFsbCBmaWxlcyBmb3IgbGlua3MgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG4gIGZvciAoY29uc3QgZmlsZSBvZiBhbGxGaWxlcykge1xuICAgIC8vIFNraXAgbXVsdGktb2JqZWN0IHNvdXJjZSBmaWxlcyAodGhlaXIgb2JqZWN0cyBhcmUgYWxyZWFkeSBub2RlcylcbiAgICBpZiAobXVsdGlPYmplY3RQYXRocy5oYXMoZmlsZS5wYXRoKSkgY29udGludWU7XG5cbiAgICBjb25zdCBvYmplY3RMaW5rcyA9IGV4dHJhY3RPYmplY3RMaW5rcyhmaWxlLmNvbnRlbnQpO1xuICAgIGNvbnN0IHdpa2lsaW5rcyA9IGV4dHJhY3RXaWtpbGlua3MoZmlsZS5jb250ZW50KTtcblxuICAgIGxldCBmaWxlTm9kZUlkOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcblxuICAgIC8vIHt7b2JqZWN0IGxpbmtzfX0gLT4gZmlsZS10by1vYmplY3QgZWRnZXNcbiAgICBmb3IgKGNvbnN0IGxpbmsgb2Ygb2JqZWN0TGlua3MpIHtcbiAgICAgIGNvbnN0IHRhcmdldE9iaklkID0gb2JqS2V5VG9Ob2RlSWQuZ2V0KGxpbmsudG9Mb3dlckNhc2UoKSk7XG4gICAgICBpZiAodGFyZ2V0T2JqSWQpIHtcbiAgICAgICAgaWYgKCFmaWxlTm9kZUlkKSBmaWxlTm9kZUlkID0gZW5zdXJlRmlsZU5vZGUoZmlsZS5wYXRoLCBmaWxlLmJhc2VuYW1lKTtcbiAgICAgICAgYWRkRWRnZShmaWxlTm9kZUlkLCB0YXJnZXRPYmpJZCwgXCJvYmplY3RcIik7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gW1t3aWtpbGlua3NdXSAtPiBmaWxlLXRvLWZpbGUgZWRnZXNcbiAgICBmb3IgKGNvbnN0IGxpbmsgb2Ygd2lraWxpbmtzKSB7XG4gICAgICBjb25zdCB0YXJnZXRQYXRoID0gYmFzZW5hbWVUb1BhdGguZ2V0KGxpbmsudG9Mb3dlckNhc2UoKSk7XG4gICAgICBpZiAoIXRhcmdldFBhdGgpIGNvbnRpbnVlO1xuICAgICAgLy8gRG9uJ3QgbGluayB0byBtdWx0aS1vYmplY3Qgc291cmNlIGZpbGVzIGFzIGZpbGUgbm9kZXNcbiAgICAgIGlmIChtdWx0aU9iamVjdFBhdGhzLmhhcyh0YXJnZXRQYXRoKSkgY29udGludWU7XG5cbiAgICAgIC8vIEZpbmQgdGhlIHRhcmdldCBmaWxlIHRvIGdldCBpdHMgYmFzZW5hbWVcbiAgICAgIGNvbnN0IHRhcmdldEZpbGUgPSBhbGxGaWxlcy5maW5kKChmKSA9PiBmLnBhdGggPT09IHRhcmdldFBhdGgpO1xuICAgICAgaWYgKCF0YXJnZXRGaWxlKSBjb250aW51ZTtcblxuICAgICAgaWYgKCFmaWxlTm9kZUlkKSBmaWxlTm9kZUlkID0gZW5zdXJlRmlsZU5vZGUoZmlsZS5wYXRoLCBmaWxlLmJhc2VuYW1lKTtcbiAgICAgIGNvbnN0IHRhcmdldEZpbGVJZCA9IGVuc3VyZUZpbGVOb2RlKHRhcmdldFBhdGgsIHRhcmdldEZpbGUuYmFzZW5hbWUpO1xuXG4gICAgICBpZiAoZmlsZU5vZGVJZCAhPT0gdGFyZ2V0RmlsZUlkKSB7XG4gICAgICAgIGFkZEVkZ2UoZmlsZU5vZGVJZCwgdGFyZ2V0RmlsZUlkLCBcIndpa2lcIik7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIDMuIE9iamVjdC10by1vYmplY3QgbGlua3MgdmlhIHt7fX0gaW4gcHJvcGVydHkgdmFsdWVzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuICBmb3IgKGNvbnN0IGZpbGUgb2YgcGFyc2VkRmlsZXMpIHtcbiAgICBmb3IgKGNvbnN0IG9iaiBvZiBmaWxlLm9iamVjdHMpIHtcbiAgICAgIGNvbnN0IHNyY0lkID0gYG9iajo6JHtmaWxlLmZpbGVQYXRofTo6JHtvYmouZGlzcGxheUtleX1gO1xuICAgICAgZm9yIChjb25zdCB2YWwgb2YgT2JqZWN0LnZhbHVlcyhvYmoucHJvcGVydGllcykpIHtcbiAgICAgICAgZm9yIChjb25zdCBsaW5rIG9mIGV4dHJhY3RPYmplY3RMaW5rcyh2YWwpKSB7XG4gICAgICAgICAgY29uc3QgdGd0SWQgPSBvYmpLZXlUb05vZGVJZC5nZXQobGluay50b0xvd2VyQ2FzZSgpKTtcbiAgICAgICAgICBpZiAodGd0SWQgJiYgdGd0SWQgIT09IHNyY0lkKSB7XG4gICAgICAgICAgICBhZGRFZGdlKHNyY0lkLCB0Z3RJZCwgXCJvYmplY3RcIik7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIDQuIENvdW50IGNvbm5lY3Rpb25zIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuICBmb3IgKGNvbnN0IGVkZ2Ugb2YgZWRnZXMpIHtcbiAgICBjb25zdCBzcmMgPSBub2RlTWFwLmdldChlZGdlLnNvdXJjZSk7XG4gICAgY29uc3QgdGd0ID0gbm9kZU1hcC5nZXQoZWRnZS50YXJnZXQpO1xuICAgIGlmIChzcmMpIHNyYy5jb25uZWN0aW9ucysrO1xuICAgIGlmICh0Z3QpIHRndC5jb25uZWN0aW9ucysrO1xuICB9XG5cbiAgcmV0dXJuIHsgbm9kZXMsIGVkZ2VzIH07XG59XG4iLCAiaW1wb3J0IHsgQXBwLCBJdGVtVmlldywgV29ya3NwYWNlTGVhZiB9IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0ICogYXMgZDMgZnJvbSBcImQzXCI7XG5pbXBvcnQgeyBHcmFwaERhdGEsIEdyYXBoTm9kZSwgR3JhcGhFZGdlIH0gZnJvbSBcIi4vZ3JhcGgtZGF0YVwiO1xuaW1wb3J0IHsgQ29uZmlnUGFuZWwsIEdyYXBoQ29uZmlnLCBERUZBVUxUX0NPTkZJRyB9IGZyb20gXCIuL3NldHRpbmdzXCI7XG5cbmV4cG9ydCBjb25zdCBWSUVXX1RZUEUgPSBcIm9iamVjdC1saW5rcy1ncmFwaFwiO1xuXG5pbnRlcmZhY2UgU2ltTm9kZSBleHRlbmRzIGQzLlNpbXVsYXRpb25Ob2RlRGF0dW0ge1xuICBpZDogc3RyaW5nO1xuICBsYWJlbDogc3RyaW5nO1xuICB0eXBlOiBcIm9iamVjdFwiIHwgXCJmaWxlXCI7XG4gIGZpbGVQYXRoOiBzdHJpbmc7XG4gIGZpbGVMYWJlbDogc3RyaW5nO1xuICBwcm9wZXJ0aWVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICBzdGFydExpbmU6IG51bWJlcjtcbiAgY29ubmVjdGlvbnM6IG51bWJlcjtcbn1cblxuaW50ZXJmYWNlIFNpbUVkZ2UgZXh0ZW5kcyBkMy5TaW11bGF0aW9uTGlua0RhdHVtPFNpbU5vZGU+IHtcbiAgZWRnZVR5cGU6IFwib2JqZWN0XCIgfCBcIndpa2lcIjtcbn1cblxuZXhwb3J0IGNsYXNzIEdyYXBoVmlldyBleHRlbmRzIEl0ZW1WaWV3IHtcbiAgcHJpdmF0ZSBncmFwaERhdGE6IEdyYXBoRGF0YSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHNpbXVsYXRpb246IGQzLlNpbXVsYXRpb248U2ltTm9kZSwgU2ltRWRnZT4gfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSByZXNpemVPYnNlcnZlcjogUmVzaXplT2JzZXJ2ZXIgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBjb25maWdQYW5lbDogQ29uZmlnUGFuZWwgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBjb25maWc6IEdyYXBoQ29uZmlnID0geyAuLi5ERUZBVUxUX0NPTkZJRyB9O1xuICAvKiogQ2FsbGJhY2sgc2V0IGJ5IHRoZSBwbHVnaW4gdG8gbmF2aWdhdGUgdG8gYW4gb2JqZWN0ICovXG4gIHB1YmxpYyBuYXZpZ2F0ZVRvT2JqZWN0OlxuICAgIHwgKChmaWxlUGF0aDogc3RyaW5nLCBzdGFydExpbmU6IG51bWJlcikgPT4gdm9pZClcbiAgICB8IG51bGwgPSBudWxsO1xuICAvKiogQ2FsbGJhY2sgc2V0IGJ5IHRoZSBwbHVnaW4gdG8gbmF2aWdhdGUgdG8gYSBmaWxlICovXG4gIHB1YmxpYyBuYXZpZ2F0ZVRvRmlsZTogKChmaWxlUGF0aDogc3RyaW5nKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuXG4gIGNvbnN0cnVjdG9yKGxlYWY6IFdvcmtzcGFjZUxlYWYpIHtcbiAgICBzdXBlcihsZWFmKTtcbiAgfVxuXG4gIGdldFZpZXdUeXBlKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIFZJRVdfVFlQRTtcbiAgfVxuXG4gIGdldERpc3BsYXlUZXh0KCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIFwiT2JqZWN0IExpbmtzXCI7XG4gIH1cblxuICBnZXRJY29uKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIFwiZ2l0LWZvcmtcIjtcbiAgfVxuXG4gIHNldEdyYXBoRGF0YShkYXRhOiBHcmFwaERhdGEpOiB2b2lkIHtcbiAgICB0aGlzLmdyYXBoRGF0YSA9IGRhdGE7XG4gICAgaWYgKHRoaXMuY29udGFpbmVyRWwpIHtcbiAgICAgIHRoaXMucmVuZGVyR3JhcGgoKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBvbk9wZW4oKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgY29udGFpbmVyID0gdGhpcy5jb250ZW50RWw7XG4gICAgY29udGFpbmVyLmVtcHR5KCk7XG4gICAgY29udGFpbmVyLmFkZENsYXNzKFwib2wtZ3JhcGgtY29udGFpbmVyXCIpO1xuXG4gICAgaWYgKHRoaXMuZ3JhcGhEYXRhKSB7XG4gICAgICB0aGlzLnJlbmRlckdyYXBoKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnRhaW5lci5jcmVhdGVFbChcImRpdlwiLCB7XG4gICAgICAgIGNsczogXCJvbC1lbXB0eS1zdGF0ZVwiLFxuICAgICAgICB0ZXh0OiBcIk9wZW4gdGhlIGdyYXBoIHVzaW5nIHRoZSBjb21tYW5kIHBhbGV0dGUgb3IgcmliYm9uIGljb24uXCIsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBvbkNsb3NlKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuY2xlYW51cCgpO1xuICB9XG5cbiAgcHJpdmF0ZSBjbGVhbnVwKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLnNpbXVsYXRpb24pIHtcbiAgICAgIHRoaXMuc2ltdWxhdGlvbi5zdG9wKCk7XG4gICAgICB0aGlzLnNpbXVsYXRpb24gPSBudWxsO1xuICAgIH1cbiAgICBpZiAodGhpcy5yZXNpemVPYnNlcnZlcikge1xuICAgICAgdGhpcy5yZXNpemVPYnNlcnZlci5kaXNjb25uZWN0KCk7XG4gICAgICB0aGlzLnJlc2l6ZU9ic2VydmVyID0gbnVsbDtcbiAgICB9XG4gICAgaWYgKHRoaXMuY29uZmlnUGFuZWwpIHtcbiAgICAgIHRoaXMuY29uZmlnUGFuZWwuZGVzdHJveSgpO1xuICAgICAgdGhpcy5jb25maWdQYW5lbCA9IG51bGw7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhcHBseUZpbHRlcnMoZGF0YTogR3JhcGhEYXRhKTogR3JhcGhEYXRhIHtcbiAgICBjb25zdCBjID0gdGhpcy5jb25maWc7XG4gICAgbGV0IG5vZGVzID0gWy4uLmRhdGEubm9kZXNdO1xuICAgIGxldCBlZGdlcyA9IFsuLi5kYXRhLmVkZ2VzXTtcblxuICAgIC8vIFx1MjUwMFx1MjUwMCBUeXBlIGZpbHRlcnMgXHUyNTAwXHUyNTAwXG4gICAgaWYgKCFjLnNob3dGaWxlcykge1xuICAgICAgY29uc3QgZmlsZUlkcyA9IG5ldyBTZXQobm9kZXMuZmlsdGVyKChuKSA9PiBuLnR5cGUgPT09IFwiZmlsZVwiKS5tYXAoKG4pID0+IG4uaWQpKTtcbiAgICAgIG5vZGVzID0gbm9kZXMuZmlsdGVyKChuKSA9PiBuLnR5cGUgIT09IFwiZmlsZVwiKTtcbiAgICAgIGVkZ2VzID0gZWRnZXMuZmlsdGVyKChlKSA9PiAhZmlsZUlkcy5oYXMoZS5zb3VyY2UpICYmICFmaWxlSWRzLmhhcyhlLnRhcmdldCkpO1xuICAgIH1cbiAgICBpZiAoIWMuc2hvd09iamVjdHMpIHtcbiAgICAgIGNvbnN0IG9iaklkcyA9IG5ldyBTZXQobm9kZXMuZmlsdGVyKChuKSA9PiBuLnR5cGUgPT09IFwib2JqZWN0XCIpLm1hcCgobikgPT4gbi5pZCkpO1xuICAgICAgbm9kZXMgPSBub2Rlcy5maWx0ZXIoKG4pID0+IG4udHlwZSAhPT0gXCJvYmplY3RcIik7XG4gICAgICBlZGdlcyA9IGVkZ2VzLmZpbHRlcigoZSkgPT4gIW9iaklkcy5oYXMoZS5zb3VyY2UpICYmICFvYmpJZHMuaGFzKGUudGFyZ2V0KSk7XG4gICAgfVxuXG4gICAgLy8gXHUyNTAwXHUyNTAwIEVkZ2UgdHlwZSBmaWx0ZXJzIFx1MjUwMFx1MjUwMFxuICAgIGlmICghYy5zaG93V2lraUVkZ2VzKSB7XG4gICAgICBlZGdlcyA9IGVkZ2VzLmZpbHRlcigoZSkgPT4gZS5lZGdlVHlwZSAhPT0gXCJ3aWtpXCIpO1xuICAgIH1cbiAgICBpZiAoIWMuc2hvd09iamVjdEVkZ2VzKSB7XG4gICAgICBlZGdlcyA9IGVkZ2VzLmZpbHRlcigoZSkgPT4gZS5lZGdlVHlwZSAhPT0gXCJvYmplY3RcIik7XG4gICAgfVxuXG4gICAgLy8gXHUyNTAwXHUyNTAwIFNlYXJjaCBmaWx0ZXIgXHUyNTAwXHUyNTAwXG4gICAgaWYgKGMuc2VhcmNoKSB7XG4gICAgICBjb25zdCBxID0gYy5zZWFyY2gudG9Mb3dlckNhc2UoKTtcbiAgICAgIGNvbnN0IG1hdGNoZWRJZHMgPSBuZXcgU2V0KFxuICAgICAgICBub2Rlcy5maWx0ZXIoKG4pID0+IG4ubGFiZWwudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhxKSkubWFwKChuKSA9PiBuLmlkKVxuICAgICAgKTtcbiAgICAgIC8vIEFsc28ga2VlcCBub2RlcyBjb25uZWN0ZWQgdG8gbWF0Y2hlc1xuICAgICAgZm9yIChjb25zdCBlIG9mIGVkZ2VzKSB7XG4gICAgICAgIGlmIChtYXRjaGVkSWRzLmhhcyhlLnNvdXJjZSkpIG1hdGNoZWRJZHMuYWRkKGUudGFyZ2V0KTtcbiAgICAgICAgaWYgKG1hdGNoZWRJZHMuaGFzKGUudGFyZ2V0KSkgbWF0Y2hlZElkcy5hZGQoZS5zb3VyY2UpO1xuICAgICAgfVxuICAgICAgbm9kZXMgPSBub2Rlcy5maWx0ZXIoKG4pID0+IG1hdGNoZWRJZHMuaGFzKG4uaWQpKTtcbiAgICAgIGNvbnN0IG5vZGVJZHMgPSBuZXcgU2V0KG5vZGVzLm1hcCgobikgPT4gbi5pZCkpO1xuICAgICAgZWRnZXMgPSBlZGdlcy5maWx0ZXIoKGUpID0+IG5vZGVJZHMuaGFzKGUuc291cmNlKSAmJiBub2RlSWRzLmhhcyhlLnRhcmdldCkpO1xuICAgIH1cblxuICAgIC8vIFx1MjUwMFx1MjUwMCBQYXRoIGZpbHRlciBcdTI1MDBcdTI1MDBcbiAgICBpZiAoYy5wYXRoRmlsdGVyKSB7XG4gICAgICBjb25zdCBwZiA9IGMucGF0aEZpbHRlci50b0xvd2VyQ2FzZSgpO1xuICAgICAgY29uc3QgbWF0Y2hlZElkcyA9IG5ldyBTZXQoXG4gICAgICAgIG5vZGVzLmZpbHRlcigobikgPT4gbi5maWxlUGF0aC50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHBmKSkubWFwKChuKSA9PiBuLmlkKVxuICAgICAgKTtcbiAgICAgIC8vIEtlZXAgY29ubmVjdGVkIG5vZGVzIHRvb1xuICAgICAgZm9yIChjb25zdCBlIG9mIGVkZ2VzKSB7XG4gICAgICAgIGlmIChtYXRjaGVkSWRzLmhhcyhlLnNvdXJjZSkpIG1hdGNoZWRJZHMuYWRkKGUudGFyZ2V0KTtcbiAgICAgICAgaWYgKG1hdGNoZWRJZHMuaGFzKGUudGFyZ2V0KSkgbWF0Y2hlZElkcy5hZGQoZS5zb3VyY2UpO1xuICAgICAgfVxuICAgICAgbm9kZXMgPSBub2Rlcy5maWx0ZXIoKG4pID0+IG1hdGNoZWRJZHMuaGFzKG4uaWQpKTtcbiAgICAgIGNvbnN0IG5vZGVJZHMgPSBuZXcgU2V0KG5vZGVzLm1hcCgobikgPT4gbi5pZCkpO1xuICAgICAgZWRnZXMgPSBlZGdlcy5maWx0ZXIoKGUpID0+IG5vZGVJZHMuaGFzKGUuc291cmNlKSAmJiBub2RlSWRzLmhhcyhlLnRhcmdldCkpO1xuICAgIH1cblxuICAgIC8vIFx1MjUwMFx1MjUwMCBTb3VyY2UgZmlsdGVyIChmb3Igb2JqZWN0cyBvbmx5KSBcdTI1MDBcdTI1MDBcbiAgICBpZiAoYy5zb3VyY2VGaWx0ZXIpIHtcbiAgICAgIGNvbnN0IHNmID0gYy5zb3VyY2VGaWx0ZXIudG9Mb3dlckNhc2UoKTtcbiAgICAgIGNvbnN0IHJlbW92ZWRJZHMgPSBuZXcgU2V0KFxuICAgICAgICBub2Rlc1xuICAgICAgICAgIC5maWx0ZXIoXG4gICAgICAgICAgICAobikgPT5cbiAgICAgICAgICAgICAgbi50eXBlID09PSBcIm9iamVjdFwiICYmXG4gICAgICAgICAgICAgICFuLmZpbGVMYWJlbC50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHNmKVxuICAgICAgICAgIClcbiAgICAgICAgICAubWFwKChuKSA9PiBuLmlkKVxuICAgICAgKTtcbiAgICAgIG5vZGVzID0gbm9kZXMuZmlsdGVyKChuKSA9PiAhcmVtb3ZlZElkcy5oYXMobi5pZCkpO1xuICAgICAgZWRnZXMgPSBlZGdlcy5maWx0ZXIoXG4gICAgICAgIChlKSA9PiAhcmVtb3ZlZElkcy5oYXMoZS5zb3VyY2UpICYmICFyZW1vdmVkSWRzLmhhcyhlLnRhcmdldClcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gXHUyNTAwXHUyNTAwIE9ycGhhbiBmaWx0ZXIgXHUyNTAwXHUyNTAwXG4gICAgaWYgKCFjLnNob3dPcnBoYW5zKSB7XG4gICAgICBjb25zdCBjb25uZWN0ZWRJZHMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICAgIGZvciAoY29uc3QgZSBvZiBlZGdlcykge1xuICAgICAgICBjb25uZWN0ZWRJZHMuYWRkKGUuc291cmNlKTtcbiAgICAgICAgY29ubmVjdGVkSWRzLmFkZChlLnRhcmdldCk7XG4gICAgICB9XG4gICAgICBub2RlcyA9IG5vZGVzLmZpbHRlcigobikgPT4gY29ubmVjdGVkSWRzLmhhcyhuLmlkKSk7XG4gICAgfVxuXG4gICAgLy8gUmVjYWxjdWxhdGUgY29ubmVjdGlvbnMgZm9yIHRoZSBmaWx0ZXJlZCBzZXRcbiAgICBjb25zdCBjb25uQ291bnQgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xuICAgIGZvciAoY29uc3QgZSBvZiBlZGdlcykge1xuICAgICAgY29ubkNvdW50LnNldChlLnNvdXJjZSwgKGNvbm5Db3VudC5nZXQoZS5zb3VyY2UpIHx8IDApICsgMSk7XG4gICAgICBjb25uQ291bnQuc2V0KGUudGFyZ2V0LCAoY29ubkNvdW50LmdldChlLnRhcmdldCkgfHwgMCkgKyAxKTtcbiAgICB9XG4gICAgZm9yIChjb25zdCBuIG9mIG5vZGVzKSB7XG4gICAgICBuLmNvbm5lY3Rpb25zID0gY29ubkNvdW50LmdldChuLmlkKSB8fCAwO1xuICAgIH1cblxuICAgIHJldHVybiB7IG5vZGVzLCBlZGdlcyB9O1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJHcmFwaCgpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMuZ3JhcGhEYXRhKSByZXR1cm47XG5cbiAgICBjb25zdCBjb250YWluZXIgPSB0aGlzLmNvbnRlbnRFbDtcbiAgICBjb250YWluZXIuZW1wdHkoKTtcbiAgICBjb250YWluZXIuYWRkQ2xhc3MoXCJvbC1ncmFwaC1jb250YWluZXJcIik7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgQ29uZmlnIHBhbmVsIFx1MjUwMFx1MjUwMFxuICAgIHRoaXMuY29uZmlnUGFuZWwgPSBuZXcgQ29uZmlnUGFuZWwoY29udGFpbmVyLCB0aGlzLmNvbmZpZywgKG5ld0NvbmZpZykgPT4ge1xuICAgICAgdGhpcy5jb25maWcgPSBuZXdDb25maWc7XG4gICAgICB0aGlzLnJlbmRlckdyYXBoKCk7XG4gICAgfSk7XG5cbiAgICBjb25zdCBmaWx0ZXJlZCA9IHRoaXMuYXBwbHlGaWx0ZXJzKHRoaXMuZ3JhcGhEYXRhKTtcblxuICAgIGlmIChmaWx0ZXJlZC5ub2Rlcy5sZW5ndGggPT09IDApIHtcbiAgICAgIGNvbnRhaW5lci5jcmVhdGVFbChcImRpdlwiLCB7XG4gICAgICAgIGNsczogXCJvbC1lbXB0eS1zdGF0ZVwiLFxuICAgICAgICB0ZXh0OiBcIk5vIG5vZGVzIG1hdGNoIHRoZSBjdXJyZW50IGZpbHRlcnMuXCIsXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCB3aWR0aCA9IGNvbnRhaW5lci5jbGllbnRXaWR0aCB8fCA4MDA7XG4gICAgY29uc3QgaGVpZ2h0ID0gY29udGFpbmVyLmNsaWVudEhlaWdodCB8fCA2MDA7XG5cbiAgICAvLyBDcmVhdGUgU1ZHXG4gICAgY29uc3Qgc3ZnID0gZDNcbiAgICAgIC5zZWxlY3QoY29udGFpbmVyKVxuICAgICAgLmFwcGVuZChcInN2Z1wiKVxuICAgICAgLmF0dHIoXCJjbGFzc1wiLCBcIm9sLWdyYXBoLXN2Z1wiKVxuICAgICAgLmF0dHIoXCJ3aWR0aFwiLCBcIjEwMCVcIilcbiAgICAgIC5hdHRyKFwiaGVpZ2h0XCIsIFwiMTAwJVwiKVxuICAgICAgLmF0dHIoXCJ2aWV3Qm94XCIsIGAwIDAgJHt3aWR0aH0gJHtoZWlnaHR9YCk7XG5cbiAgICAvLyBCYWNrZ3JvdW5kIC0tIGNsaWNrIHRvIGRlc2VsZWN0XG4gICAgc3ZnXG4gICAgICAuYXBwZW5kKFwicmVjdFwiKVxuICAgICAgLmF0dHIoXCJ3aWR0aFwiLCB3aWR0aClcbiAgICAgIC5hdHRyKFwiaGVpZ2h0XCIsIGhlaWdodClcbiAgICAgIC5hdHRyKFwiZmlsbFwiLCBcInRyYW5zcGFyZW50XCIpXG4gICAgICAub24oXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgICAgIHRoaXMuY2xlYXJTZWxlY3Rpb24obm9kZUdyb3VwLCBlZGdlR3JvdXAsIGxhYmVsR3JvdXAsIGNvbnRhaW5lcik7XG4gICAgICB9KTtcblxuICAgIGNvbnN0IGcgPSBzdmcuYXBwZW5kKFwiZ1wiKS5hdHRyKFwiY2xhc3NcIiwgXCJvbC16b29tLWdyb3VwXCIpO1xuXG4gICAgLy8gWm9vbVxuICAgIGNvbnN0IHpvb20gPSBkM1xuICAgICAgLnpvb208U1ZHU1ZHRWxlbWVudCwgdW5rbm93bj4oKVxuICAgICAgLnNjYWxlRXh0ZW50KFswLjAzLCAxMl0pXG4gICAgICAub24oXCJ6b29tXCIsIChldmVudCkgPT4ge1xuICAgICAgICBnLmF0dHIoXCJ0cmFuc2Zvcm1cIiwgZXZlbnQudHJhbnNmb3JtKTtcbiAgICAgIH0pO1xuICAgIHN2Zy5jYWxsKHpvb20pO1xuICAgIHN2Zy5jYWxsKFxuICAgICAgem9vbS50cmFuc2Zvcm0sXG4gICAgICBkMy56b29tSWRlbnRpdHkudHJhbnNsYXRlKHdpZHRoIC8gMiwgaGVpZ2h0IC8gMikuc2NhbGUoMC43KVxuICAgICk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgU2ltIGRhdGEgXHUyNTAwXHUyNTAwXG4gICAgY29uc3QgYyA9IHRoaXMuY29uZmlnO1xuXG4gICAgY29uc3Qgc2ltTm9kZXM6IFNpbU5vZGVbXSA9IGZpbHRlcmVkLm5vZGVzLm1hcCgobikgPT4gKHtcbiAgICAgIC4uLm4sXG4gICAgICB4OiAoTWF0aC5yYW5kb20oKSAtIDAuNSkgKiB3aWR0aCAqIDAuNixcbiAgICAgIHk6IChNYXRoLnJhbmRvbSgpIC0gMC41KSAqIGhlaWdodCAqIDAuNixcbiAgICB9KSk7XG5cbiAgICBjb25zdCBub2RlTWFwID0gbmV3IE1hcChzaW1Ob2Rlcy5tYXAoKG4pID0+IFtuLmlkLCBuXSkpO1xuXG4gICAgY29uc3Qgc2ltRWRnZXM6IFNpbUVkZ2VbXSA9IGZpbHRlcmVkLmVkZ2VzXG4gICAgICAubWFwKChlKSA9PiAoe1xuICAgICAgICBzb3VyY2U6IG5vZGVNYXAuZ2V0KGUuc291cmNlKSEsXG4gICAgICAgIHRhcmdldDogbm9kZU1hcC5nZXQoZS50YXJnZXQpISxcbiAgICAgICAgZWRnZVR5cGU6IGUuZWRnZVR5cGUsXG4gICAgICB9KSlcbiAgICAgIC5maWx0ZXIoKGUpID0+IGUuc291cmNlICYmIGUudGFyZ2V0KTtcblxuICAgIC8vIFx1MjUwMFx1MjUwMCBFZGdlcyBcdTI1MDBcdTI1MDBcbiAgICBjb25zdCBlZGdlR3JvdXAgPSBnXG4gICAgICAuYXBwZW5kKFwiZ1wiKVxuICAgICAgLmF0dHIoXCJjbGFzc1wiLCBcIm9sLWVkZ2VzXCIpXG4gICAgICAuc2VsZWN0QWxsKFwibGluZVwiKVxuICAgICAgLmRhdGEoc2ltRWRnZXMpXG4gICAgICAuZW50ZXIoKVxuICAgICAgLmFwcGVuZChcImxpbmVcIilcbiAgICAgIC5hdHRyKFwiY2xhc3NcIiwgKGQpID0+XG4gICAgICAgIGQuZWRnZVR5cGUgPT09IFwib2JqZWN0XCIgPyBcIm9sLWVkZ2Ugb2wtZWRnZS1vYmpcIiA6IFwib2wtZWRnZSBvbC1lZGdlLXdpa2lcIlxuICAgICAgKTtcblxuICAgIC8vIFx1MjUwMFx1MjUwMCBOb2RlcyBcdTI1MDBcdTI1MDBcbiAgICBjb25zdCBzZWxmID0gdGhpcztcbiAgICBsZXQgbGFzdENsaWNrVGltZSA9IDA7XG4gICAgbGV0IGxhc3RDbGlja0lkID0gXCJcIjtcblxuICAgIGNvbnN0IG5vZGVHcm91cCA9IGdcbiAgICAgIC5hcHBlbmQoXCJnXCIpXG4gICAgICAuYXR0cihcImNsYXNzXCIsIFwib2wtbm9kZXNcIilcbiAgICAgIC5zZWxlY3RBbGwoXCJjaXJjbGVcIilcbiAgICAgIC5kYXRhKHNpbU5vZGVzKVxuICAgICAgLmVudGVyKClcbiAgICAgIC5hcHBlbmQoXCJjaXJjbGVcIilcbiAgICAgIC5hdHRyKFwiY2xhc3NcIiwgKGQpID0+XG4gICAgICAgIGQudHlwZSA9PT0gXCJvYmplY3RcIlxuICAgICAgICAgID8gXCJvbC1ub2RlIG9sLW5vZGUtb2JqZWN0XCJcbiAgICAgICAgICA6IFwib2wtbm9kZSBvbC1ub2RlLWZpbGVcIlxuICAgICAgKVxuICAgICAgLmF0dHIoXCJyXCIsIChkKSA9PiB0aGlzLmdldE5vZGVSYWRpdXMoZCkpXG4gICAgICAub24oXCJtb3VzZWVudGVyXCIsIChfZXZlbnQsIGQpID0+IHtcbiAgICAgICAgdGhpcy5oaWdobGlnaHROb2RlKGQsIHNpbUVkZ2VzLCBub2RlR3JvdXAsIGVkZ2VHcm91cCwgbGFiZWxHcm91cCk7XG4gICAgICAgIHRoaXMuc2hvd1Rvb2x0aXAoZCwgY29udGFpbmVyKTtcbiAgICAgIH0pXG4gICAgICAub24oXCJtb3VzZWxlYXZlXCIsICgpID0+IHtcbiAgICAgICAgdGhpcy51bmhpZ2hsaWdodEFsbChub2RlR3JvdXAsIGVkZ2VHcm91cCwgbGFiZWxHcm91cCk7XG4gICAgICAgIHRoaXMuaGlkZVRvb2x0aXAoY29udGFpbmVyKTtcbiAgICAgIH0pXG4gICAgICAub24oXCJjbGlja1wiLCBmdW5jdGlvbiAoX2V2ZW50LCBkKSB7XG4gICAgICAgIF9ldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcblxuICAgICAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpO1xuICAgICAgICAvLyBEb3VibGUtY2xpY2sgZGV0ZWN0aW9uICgzMDBtcyB3aW5kb3cpXG4gICAgICAgIGlmIChsYXN0Q2xpY2tJZCA9PT0gZC5pZCAmJiBub3cgLSBsYXN0Q2xpY2tUaW1lIDwgMzAwKSB7XG4gICAgICAgICAgLy8gRG91YmxlIGNsaWNrIC0+IG5hdmlnYXRlXG4gICAgICAgICAgaWYgKGQudHlwZSA9PT0gXCJvYmplY3RcIiAmJiBzZWxmLm5hdmlnYXRlVG9PYmplY3QpIHtcbiAgICAgICAgICAgIHNlbGYubmF2aWdhdGVUb09iamVjdChkLmZpbGVQYXRoLCBkLnN0YXJ0TGluZSk7XG4gICAgICAgICAgfSBlbHNlIGlmIChkLnR5cGUgPT09IFwiZmlsZVwiICYmIHNlbGYubmF2aWdhdGVUb0ZpbGUpIHtcbiAgICAgICAgICAgIHNlbGYubmF2aWdhdGVUb0ZpbGUoZC5maWxlUGF0aCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGxhc3RDbGlja1RpbWUgPSAwO1xuICAgICAgICAgIGxhc3RDbGlja0lkID0gXCJcIjtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBsYXN0Q2xpY2tUaW1lID0gbm93O1xuICAgICAgICBsYXN0Q2xpY2tJZCA9IGQuaWQ7XG5cbiAgICAgICAgLy8gU2luZ2xlIGNsaWNrIC0+IGluZm8gcGFuZWxcbiAgICAgICAgc2VsZi5zZWxlY3ROb2RlKFxuICAgICAgICAgIGQsXG4gICAgICAgICAgc2ltRWRnZXMsXG4gICAgICAgICAgbm9kZUdyb3VwLFxuICAgICAgICAgIGVkZ2VHcm91cCxcbiAgICAgICAgICBsYWJlbEdyb3VwLFxuICAgICAgICAgIGNvbnRhaW5lclxuICAgICAgICApO1xuICAgICAgfSlcbiAgICAgIC5jYWxsKFxuICAgICAgICBkM1xuICAgICAgICAgIC5kcmFnPFNWR0NpcmNsZUVsZW1lbnQsIFNpbU5vZGU+KClcbiAgICAgICAgICAub24oXCJzdGFydFwiLCAoZXZlbnQsIGQpID0+IHtcbiAgICAgICAgICAgIGlmICghZXZlbnQuYWN0aXZlICYmIHRoaXMuc2ltdWxhdGlvbilcbiAgICAgICAgICAgICAgdGhpcy5zaW11bGF0aW9uLmFscGhhVGFyZ2V0KDAuMykucmVzdGFydCgpO1xuICAgICAgICAgICAgZC5meCA9IGQueDtcbiAgICAgICAgICAgIGQuZnkgPSBkLnk7XG4gICAgICAgICAgfSlcbiAgICAgICAgICAub24oXCJkcmFnXCIsIChldmVudCwgZCkgPT4ge1xuICAgICAgICAgICAgZC5meCA9IGV2ZW50Lng7XG4gICAgICAgICAgICBkLmZ5ID0gZXZlbnQueTtcbiAgICAgICAgICB9KVxuICAgICAgICAgIC5vbihcImVuZFwiLCAoZXZlbnQsIGQpID0+IHtcbiAgICAgICAgICAgIGlmICghZXZlbnQuYWN0aXZlICYmIHRoaXMuc2ltdWxhdGlvbilcbiAgICAgICAgICAgICAgdGhpcy5zaW11bGF0aW9uLmFscGhhVGFyZ2V0KDApO1xuICAgICAgICAgICAgZC5meCA9IG51bGw7XG4gICAgICAgICAgICBkLmZ5ID0gbnVsbDtcbiAgICAgICAgICB9KVxuICAgICAgKTtcblxuICAgIC8vIFx1MjUwMFx1MjUwMCBMYWJlbHMgXHUyNTAwXHUyNTAwXG4gICAgY29uc3QgbGFiZWxHcm91cCA9IGdcbiAgICAgIC5hcHBlbmQoXCJnXCIpXG4gICAgICAuYXR0cihcImNsYXNzXCIsIFwib2wtbGFiZWxzXCIpXG4gICAgICAuc2VsZWN0QWxsKFwidGV4dFwiKVxuICAgICAgLmRhdGEoc2ltTm9kZXMpXG4gICAgICAuZW50ZXIoKVxuICAgICAgLmFwcGVuZChcInRleHRcIilcbiAgICAgIC5hdHRyKFwiY2xhc3NcIiwgXCJvbC1sYWJlbFwiKVxuICAgICAgLnRleHQoKGQpID0+IGQubGFiZWwpXG4gICAgICAuYXR0cihcImR5XCIsIChkKSA9PiB0aGlzLmdldE5vZGVSYWRpdXMoZCkgKyAxNClcbiAgICAgIC5zdHlsZShcIm9wYWNpdHlcIiwgYy5sYWJlbE9wYWNpdHkpO1xuXG4gICAgLy8gXHUyNTAwXHUyNTAwIFNpbXVsYXRpb24gXHUyNTAwXHUyNTAwXG4gICAgdGhpcy5zaW11bGF0aW9uID0gZDNcbiAgICAgIC5mb3JjZVNpbXVsYXRpb248U2ltTm9kZT4oc2ltTm9kZXMpXG4gICAgICAuZm9yY2UoXG4gICAgICAgIFwibGlua1wiLFxuICAgICAgICBkM1xuICAgICAgICAgIC5mb3JjZUxpbms8U2ltTm9kZSwgU2ltRWRnZT4oc2ltRWRnZXMpXG4gICAgICAgICAgLmlkKChkKSA9PiBkLmlkKVxuICAgICAgICAgIC5kaXN0YW5jZShjLmxpbmtEaXN0YW5jZSlcbiAgICAgICAgICAuc3RyZW5ndGgoMC42KVxuICAgICAgKVxuICAgICAgLmZvcmNlKFxuICAgICAgICBcImNoYXJnZVwiLFxuICAgICAgICBkM1xuICAgICAgICAgIC5mb3JjZU1hbnlCb2R5KClcbiAgICAgICAgICAuc3RyZW5ndGgoLWMucmVwZWxTdHJlbmd0aClcbiAgICAgICAgICAuZGlzdGFuY2VNYXgoYy5yZXBlbFN0cmVuZ3RoICogMS41KVxuICAgICAgKVxuICAgICAgLmZvcmNlKFwiY2VudGVyXCIsIGQzLmZvcmNlQ2VudGVyKDAsIDApLnN0cmVuZ3RoKGMuY2VudGVyU3RyZW5ndGgpKVxuICAgICAgLmZvcmNlKFxuICAgICAgICBcImNvbGxpc2lvblwiLFxuICAgICAgICBkM1xuICAgICAgICAgIC5mb3JjZUNvbGxpZGU8U2ltTm9kZT4oKVxuICAgICAgICAgIC5yYWRpdXMoKGQpID0+IHRoaXMuZ2V0Tm9kZVJhZGl1cyhkKSArIDgpXG4gICAgICApXG4gICAgICAuZm9yY2UoXCJ4XCIsIGQzLmZvcmNlWCgwKS5zdHJlbmd0aCgwLjAxMikpXG4gICAgICAuZm9yY2UoXCJ5XCIsIGQzLmZvcmNlWSgwKS5zdHJlbmd0aCgwLjAxMikpXG4gICAgICAuYWxwaGFEZWNheSgwLjAxNSlcbiAgICAgIC5vbihcInRpY2tcIiwgKCkgPT4ge1xuICAgICAgICBlZGdlR3JvdXBcbiAgICAgICAgICAuYXR0cihcIngxXCIsIChkOiBhbnkpID0+IGQuc291cmNlLngpXG4gICAgICAgICAgLmF0dHIoXCJ5MVwiLCAoZDogYW55KSA9PiBkLnNvdXJjZS55KVxuICAgICAgICAgIC5hdHRyKFwieDJcIiwgKGQ6IGFueSkgPT4gZC50YXJnZXQueClcbiAgICAgICAgICAuYXR0cihcInkyXCIsIChkOiBhbnkpID0+IGQudGFyZ2V0LnkpO1xuXG4gICAgICAgIG5vZGVHcm91cC5hdHRyKFwiY3hcIiwgKGQpID0+IGQueCEpLmF0dHIoXCJjeVwiLCAoZCkgPT4gZC55ISk7XG5cbiAgICAgICAgbGFiZWxHcm91cC5hdHRyKFwieFwiLCAoZCkgPT4gZC54ISkuYXR0cihcInlcIiwgKGQpID0+IGQueSEpO1xuICAgICAgfSk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgUmVzaXplIFx1MjUwMFx1MjUwMFxuICAgIHRoaXMucmVzaXplT2JzZXJ2ZXIgPSBuZXcgUmVzaXplT2JzZXJ2ZXIoKCkgPT4ge1xuICAgICAgY29uc3QgdyA9IGNvbnRhaW5lci5jbGllbnRXaWR0aDtcbiAgICAgIGNvbnN0IGggPSBjb250YWluZXIuY2xpZW50SGVpZ2h0O1xuICAgICAgc3ZnLmF0dHIoXCJ2aWV3Qm94XCIsIGAwIDAgJHt3fSAke2h9YCk7XG4gICAgfSk7XG4gICAgdGhpcy5yZXNpemVPYnNlcnZlci5vYnNlcnZlKGNvbnRhaW5lcik7XG4gIH1cblxuICBwcml2YXRlIGdldE5vZGVSYWRpdXMoZDogU2ltTm9kZSk6IG51bWJlciB7XG4gICAgY29uc3QgYyA9IHRoaXMuY29uZmlnLm5vZGVTaXplTXVsdGlwbGllcjtcbiAgICBjb25zdCBiYXNlID0gZC50eXBlID09PSBcImZpbGVcIiA/IDQgOiA1O1xuICAgIHJldHVybiBNYXRoLm1heChiYXNlLCBNYXRoLm1pbigyMCwgYmFzZSArIGQuY29ubmVjdGlvbnMgKiAxLjUpKSAqIGM7XG4gIH1cblxuICBwcml2YXRlIGhpZ2hsaWdodE5vZGUoXG4gICAgZDogU2ltTm9kZSxcbiAgICBlZGdlczogU2ltRWRnZVtdLFxuICAgIG5vZGVHcm91cDogZDMuU2VsZWN0aW9uPFNWR0NpcmNsZUVsZW1lbnQsIFNpbU5vZGUsIFNWR0dFbGVtZW50LCB1bmtub3duPixcbiAgICBlZGdlR3JvdXA6IGQzLlNlbGVjdGlvbjxTVkdMaW5lRWxlbWVudCwgU2ltRWRnZSwgU1ZHR0VsZW1lbnQsIHVua25vd24+LFxuICAgIGxhYmVsR3JvdXA6IGQzLlNlbGVjdGlvbjxTVkdUZXh0RWxlbWVudCwgU2ltTm9kZSwgU1ZHR0VsZW1lbnQsIHVua25vd24+XG4gICk6IHZvaWQge1xuICAgIGNvbnN0IGNvbm5lY3RlZCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgIGNvbm5lY3RlZC5hZGQoZC5pZCk7XG4gICAgZWRnZXMuZm9yRWFjaCgoZSkgPT4ge1xuICAgICAgY29uc3QgcyA9IHR5cGVvZiBlLnNvdXJjZSA9PT0gXCJvYmplY3RcIiA/IChlLnNvdXJjZSBhcyBTaW1Ob2RlKS5pZCA6IGUuc291cmNlO1xuICAgICAgY29uc3QgdCA9IHR5cGVvZiBlLnRhcmdldCA9PT0gXCJvYmplY3RcIiA/IChlLnRhcmdldCBhcyBTaW1Ob2RlKS5pZCA6IGUudGFyZ2V0O1xuICAgICAgaWYgKHMgPT09IGQuaWQpIGNvbm5lY3RlZC5hZGQodCBhcyBzdHJpbmcpO1xuICAgICAgaWYgKHQgPT09IGQuaWQpIGNvbm5lY3RlZC5hZGQocyBhcyBzdHJpbmcpO1xuICAgIH0pO1xuXG4gICAgbm9kZUdyb3VwLmNsYXNzZWQoXCJvbC1kaW1tZWRcIiwgKG4pID0+ICFjb25uZWN0ZWQuaGFzKG4uaWQpKTtcbiAgICBub2RlR3JvdXAuY2xhc3NlZChcIm9sLWhpZ2hsaWdodGVkXCIsIChuKSA9PiBuLmlkID09PSBkLmlkKTtcbiAgICBlZGdlR3JvdXAuY2xhc3NlZChcIm9sLWRpbW1lZFwiLCAoZSkgPT4ge1xuICAgICAgY29uc3QgcyA9IHR5cGVvZiBlLnNvdXJjZSA9PT0gXCJvYmplY3RcIiA/IChlLnNvdXJjZSBhcyBTaW1Ob2RlKS5pZCA6IGUuc291cmNlO1xuICAgICAgY29uc3QgdCA9IHR5cGVvZiBlLnRhcmdldCA9PT0gXCJvYmplY3RcIiA/IChlLnRhcmdldCBhcyBTaW1Ob2RlKS5pZCA6IGUudGFyZ2V0O1xuICAgICAgcmV0dXJuIHMgIT09IGQuaWQgJiYgdCAhPT0gZC5pZDtcbiAgICB9KTtcbiAgICBlZGdlR3JvdXAuY2xhc3NlZChcIm9sLWVkZ2UtaGlnaGxpZ2h0ZWRcIiwgKGUpID0+IHtcbiAgICAgIGNvbnN0IHMgPSB0eXBlb2YgZS5zb3VyY2UgPT09IFwib2JqZWN0XCIgPyAoZS5zb3VyY2UgYXMgU2ltTm9kZSkuaWQgOiBlLnNvdXJjZTtcbiAgICAgIGNvbnN0IHQgPSB0eXBlb2YgZS50YXJnZXQgPT09IFwib2JqZWN0XCIgPyAoZS50YXJnZXQgYXMgU2ltTm9kZSkuaWQgOiBlLnRhcmdldDtcbiAgICAgIHJldHVybiBzID09PSBkLmlkIHx8IHQgPT09IGQuaWQ7XG4gICAgfSk7XG4gICAgbGFiZWxHcm91cC5jbGFzc2VkKFwib2wtZGltbWVkXCIsIChuKSA9PiAhY29ubmVjdGVkLmhhcyhuLmlkKSk7XG4gICAgbGFiZWxHcm91cC5jbGFzc2VkKFwib2wtbGFiZWwtdmlzaWJsZVwiLCAobikgPT4gY29ubmVjdGVkLmhhcyhuLmlkKSk7XG4gIH1cblxuICBwcml2YXRlIHVuaGlnaGxpZ2h0QWxsKFxuICAgIG5vZGVHcm91cDogZDMuU2VsZWN0aW9uPFNWR0NpcmNsZUVsZW1lbnQsIFNpbU5vZGUsIFNWR0dFbGVtZW50LCB1bmtub3duPixcbiAgICBlZGdlR3JvdXA6IGQzLlNlbGVjdGlvbjxTVkdMaW5lRWxlbWVudCwgU2ltRWRnZSwgU1ZHR0VsZW1lbnQsIHVua25vd24+LFxuICAgIGxhYmVsR3JvdXA6IGQzLlNlbGVjdGlvbjxTVkdUZXh0RWxlbWVudCwgU2ltTm9kZSwgU1ZHR0VsZW1lbnQsIHVua25vd24+XG4gICk6IHZvaWQge1xuICAgIG5vZGVHcm91cC5jbGFzc2VkKFwib2wtZGltbWVkXCIsIGZhbHNlKS5jbGFzc2VkKFwib2wtaGlnaGxpZ2h0ZWRcIiwgZmFsc2UpO1xuICAgIGVkZ2VHcm91cC5jbGFzc2VkKFwib2wtZGltbWVkXCIsIGZhbHNlKS5jbGFzc2VkKFwib2wtZWRnZS1oaWdobGlnaHRlZFwiLCBmYWxzZSk7XG4gICAgbGFiZWxHcm91cC5jbGFzc2VkKFwib2wtZGltbWVkXCIsIGZhbHNlKS5jbGFzc2VkKFwib2wtbGFiZWwtdmlzaWJsZVwiLCBmYWxzZSk7XG4gIH1cblxuICBwcml2YXRlIGNsZWFyU2VsZWN0aW9uKFxuICAgIG5vZGVHcm91cDogZDMuU2VsZWN0aW9uPFNWR0NpcmNsZUVsZW1lbnQsIFNpbU5vZGUsIFNWR0dFbGVtZW50LCB1bmtub3duPixcbiAgICBlZGdlR3JvdXA6IGQzLlNlbGVjdGlvbjxTVkdMaW5lRWxlbWVudCwgU2ltRWRnZSwgU1ZHR0VsZW1lbnQsIHVua25vd24+LFxuICAgIGxhYmVsR3JvdXA6IGQzLlNlbGVjdGlvbjxTVkdUZXh0RWxlbWVudCwgU2ltTm9kZSwgU1ZHR0VsZW1lbnQsIHVua25vd24+LFxuICAgIGNvbnRhaW5lcjogSFRNTEVsZW1lbnRcbiAgKTogdm9pZCB7XG4gICAgdGhpcy51bmhpZ2hsaWdodEFsbChub2RlR3JvdXAsIGVkZ2VHcm91cCwgbGFiZWxHcm91cCk7XG4gICAgY29uc3QgcGFuZWwgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcihcIi5vbC1pbmZvLXBhbmVsXCIpO1xuICAgIGlmIChwYW5lbCkgcGFuZWwucmVtb3ZlKCk7XG4gIH1cblxuICBwcml2YXRlIHNlbGVjdE5vZGUoXG4gICAgZDogU2ltTm9kZSxcbiAgICBlZGdlczogU2ltRWRnZVtdLFxuICAgIG5vZGVHcm91cDogZDMuU2VsZWN0aW9uPFNWR0NpcmNsZUVsZW1lbnQsIFNpbU5vZGUsIFNWR0dFbGVtZW50LCB1bmtub3duPixcbiAgICBlZGdlR3JvdXA6IGQzLlNlbGVjdGlvbjxTVkdMaW5lRWxlbWVudCwgU2ltRWRnZSwgU1ZHR0VsZW1lbnQsIHVua25vd24+LFxuICAgIGxhYmVsR3JvdXA6IGQzLlNlbGVjdGlvbjxTVkdUZXh0RWxlbWVudCwgU2ltTm9kZSwgU1ZHR0VsZW1lbnQsIHVua25vd24+LFxuICAgIGNvbnRhaW5lcjogSFRNTEVsZW1lbnRcbiAgKTogdm9pZCB7XG4gICAgdGhpcy5oaWdobGlnaHROb2RlKGQsIGVkZ2VzLCBub2RlR3JvdXAsIGVkZ2VHcm91cCwgbGFiZWxHcm91cCk7XG5cbiAgICBjb25zdCBleGlzdGluZyA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKFwiLm9sLWluZm8tcGFuZWxcIik7XG4gICAgaWYgKGV4aXN0aW5nKSBleGlzdGluZy5yZW1vdmUoKTtcblxuICAgIGNvbnN0IHBhbmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICBwYW5lbC5jbGFzc05hbWUgPSBcIm9sLWluZm8tcGFuZWxcIjtcblxuICAgIC8vIFRpdGxlXG4gICAgY29uc3QgdGl0bGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHRpdGxlLmNsYXNzTmFtZSA9IFwib2wtaW5mby10aXRsZVwiO1xuICAgIHRpdGxlLnRleHRDb250ZW50ID0gZC5sYWJlbDtcbiAgICBwYW5lbC5hcHBlbmRDaGlsZCh0aXRsZSk7XG5cbiAgICAvLyBUeXBlIGJhZGdlXG4gICAgY29uc3QgYmFkZ2UgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIGJhZGdlLmNsYXNzTmFtZSA9IGBvbC1pbmZvLXR5cGUgb2wtaW5mby10eXBlLSR7ZC50eXBlfWA7XG4gICAgYmFkZ2UudGV4dENvbnRlbnQgPSBkLnR5cGUgPT09IFwib2JqZWN0XCIgPyBcIk9iamVjdFwiIDogXCJGaWxlXCI7XG4gICAgcGFuZWwuYXBwZW5kQ2hpbGQoYmFkZ2UpO1xuXG4gICAgLy8gRmlsZSBwYXRoXG4gICAgY29uc3QgZmlsZVBhdGggPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIGZpbGVQYXRoLmNsYXNzTmFtZSA9IFwib2wtaW5mby1maWxlXCI7XG4gICAgZmlsZVBhdGgudGV4dENvbnRlbnQgPSBkLmZpbGVQYXRoO1xuICAgIHBhbmVsLmFwcGVuZENoaWxkKGZpbGVQYXRoKTtcblxuICAgIC8vIFByb3BlcnRpZXMgKG9iamVjdCBub2RlcyBvbmx5KVxuICAgIGlmIChkLnR5cGUgPT09IFwib2JqZWN0XCIgJiYgT2JqZWN0LmtleXMoZC5wcm9wZXJ0aWVzKS5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBwcm9wcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICBwcm9wcy5jbGFzc05hbWUgPSBcIm9sLWluZm8tcHJvcHNcIjtcbiAgICAgIGZvciAoY29uc3QgW2ssIHZdIG9mIE9iamVjdC5lbnRyaWVzKGQucHJvcGVydGllcykpIHtcbiAgICAgICAgY29uc3Qgcm93ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgICAgcm93LmNsYXNzTmFtZSA9IFwib2wtaW5mby1wcm9wLXJvd1wiO1xuICAgICAgICBjb25zdCBrZXlFbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgICAgICBrZXlFbC5jbGFzc05hbWUgPSBcIm9sLWluZm8tcHJvcC1rZXlcIjtcbiAgICAgICAga2V5RWwudGV4dENvbnRlbnQgPSBrO1xuICAgICAgICBjb25zdCB2YWxFbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgICAgICB2YWxFbC5jbGFzc05hbWUgPSBcIm9sLWluZm8tcHJvcC12YWxcIjtcbiAgICAgICAgdmFsRWwudGV4dENvbnRlbnQgPSB2O1xuICAgICAgICByb3cuYXBwZW5kQ2hpbGQoa2V5RWwpO1xuICAgICAgICByb3cuYXBwZW5kQ2hpbGQodmFsRWwpO1xuICAgICAgICBwcm9wcy5hcHBlbmRDaGlsZChyb3cpO1xuICAgICAgfVxuICAgICAgcGFuZWwuYXBwZW5kQ2hpbGQocHJvcHMpO1xuICAgIH1cblxuICAgIC8vIENvbm5lY3Rpb25zXG4gICAgY29uc3QgY29ubiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgY29ubi5jbGFzc05hbWUgPSBcIm9sLWluZm8tY29ubmVjdGlvbnNcIjtcbiAgICBjb25uLnRleHRDb250ZW50ID0gYCR7ZC5jb25uZWN0aW9uc30gY29ubmVjdGlvbiR7ZC5jb25uZWN0aW9ucyAhPT0gMSA/IFwic1wiIDogXCJcIn1gO1xuICAgIHBhbmVsLmFwcGVuZENoaWxkKGNvbm4pO1xuXG4gICAgLy8gXCJHbyB0b1wiIGJ1dHRvblxuICAgIGNvbnN0IGdvQnRuID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImJ1dHRvblwiKTtcbiAgICBnb0J0bi5jbGFzc05hbWUgPSBcIm9sLWluZm8tZ28tYnRuXCI7XG4gICAgZ29CdG4udGV4dENvbnRlbnQgPSBkLnR5cGUgPT09IFwib2JqZWN0XCIgPyBcIkdvIHRvIG9iamVjdFwiIDogXCJPcGVuIGZpbGVcIjtcbiAgICBnb0J0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgaWYgKGQudHlwZSA9PT0gXCJvYmplY3RcIiAmJiB0aGlzLm5hdmlnYXRlVG9PYmplY3QpIHtcbiAgICAgICAgdGhpcy5uYXZpZ2F0ZVRvT2JqZWN0KGQuZmlsZVBhdGgsIGQuc3RhcnRMaW5lKTtcbiAgICAgIH0gZWxzZSBpZiAodGhpcy5uYXZpZ2F0ZVRvRmlsZSkge1xuICAgICAgICB0aGlzLm5hdmlnYXRlVG9GaWxlKGQuZmlsZVBhdGgpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHBhbmVsLmFwcGVuZENoaWxkKGdvQnRuKTtcblxuICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChwYW5lbCk7XG4gIH1cblxuICBwcml2YXRlIHNob3dUb29sdGlwKGQ6IFNpbU5vZGUsIGNvbnRhaW5lcjogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICBsZXQgdG9vbHRpcCA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKFwiLm9sLXRvb2x0aXBcIikgYXMgSFRNTEVsZW1lbnQ7XG4gICAgaWYgKCF0b29sdGlwKSB7XG4gICAgICB0b29sdGlwID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgIHRvb2x0aXAuY2xhc3NOYW1lID0gXCJvbC10b29sdGlwXCI7XG4gICAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQodG9vbHRpcCk7XG4gICAgfVxuICAgIHRvb2x0aXAudGV4dENvbnRlbnQgPSBkLmxhYmVsO1xuICAgIHRvb2x0aXAuc3R5bGUuZGlzcGxheSA9IFwiYmxvY2tcIjtcblxuICAgIGNvbnN0IG9uTW92ZSA9IChlOiBNb3VzZUV2ZW50KSA9PiB7XG4gICAgICBjb25zdCByZWN0ID0gY29udGFpbmVyLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgdG9vbHRpcC5zdHlsZS5sZWZ0ID0gZS5jbGllbnRYIC0gcmVjdC5sZWZ0ICsgMTQgKyBcInB4XCI7XG4gICAgICB0b29sdGlwLnN0eWxlLnRvcCA9IGUuY2xpZW50WSAtIHJlY3QudG9wIC0gMTAgKyBcInB4XCI7XG4gICAgfTtcbiAgICBjb250YWluZXIuYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlbW92ZVwiLCBvbk1vdmUpO1xuICAgICh0b29sdGlwIGFzIGFueSkuX19tb3ZlSGFuZGxlciA9IG9uTW92ZTtcbiAgfVxuXG4gIHByaXZhdGUgaGlkZVRvb2x0aXAoY29udGFpbmVyOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIGNvbnN0IHRvb2x0aXAgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcihcIi5vbC10b29sdGlwXCIpIGFzIEhUTUxFbGVtZW50O1xuICAgIGlmICh0b29sdGlwKSB7XG4gICAgICB0b29sdGlwLnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcbiAgICAgIGlmICgodG9vbHRpcCBhcyBhbnkpLl9fbW92ZUhhbmRsZXIpIHtcbiAgICAgICAgY29udGFpbmVyLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJtb3VzZW1vdmVcIiwgKHRvb2x0aXAgYXMgYW55KS5fX21vdmVIYW5kbGVyKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cbiIsICJ2YXIgbm9vcCA9IHt2YWx1ZTogKCkgPT4ge319O1xuXG5mdW5jdGlvbiBkaXNwYXRjaCgpIHtcbiAgZm9yICh2YXIgaSA9IDAsIG4gPSBhcmd1bWVudHMubGVuZ3RoLCBfID0ge30sIHQ7IGkgPCBuOyArK2kpIHtcbiAgICBpZiAoISh0ID0gYXJndW1lbnRzW2ldICsgXCJcIikgfHwgKHQgaW4gXykgfHwgL1tcXHMuXS8udGVzdCh0KSkgdGhyb3cgbmV3IEVycm9yKFwiaWxsZWdhbCB0eXBlOiBcIiArIHQpO1xuICAgIF9bdF0gPSBbXTtcbiAgfVxuICByZXR1cm4gbmV3IERpc3BhdGNoKF8pO1xufVxuXG5mdW5jdGlvbiBEaXNwYXRjaChfKSB7XG4gIHRoaXMuXyA9IF87XG59XG5cbmZ1bmN0aW9uIHBhcnNlVHlwZW5hbWVzKHR5cGVuYW1lcywgdHlwZXMpIHtcbiAgcmV0dXJuIHR5cGVuYW1lcy50cmltKCkuc3BsaXQoL158XFxzKy8pLm1hcChmdW5jdGlvbih0KSB7XG4gICAgdmFyIG5hbWUgPSBcIlwiLCBpID0gdC5pbmRleE9mKFwiLlwiKTtcbiAgICBpZiAoaSA+PSAwKSBuYW1lID0gdC5zbGljZShpICsgMSksIHQgPSB0LnNsaWNlKDAsIGkpO1xuICAgIGlmICh0ICYmICF0eXBlcy5oYXNPd25Qcm9wZXJ0eSh0KSkgdGhyb3cgbmV3IEVycm9yKFwidW5rbm93biB0eXBlOiBcIiArIHQpO1xuICAgIHJldHVybiB7dHlwZTogdCwgbmFtZTogbmFtZX07XG4gIH0pO1xufVxuXG5EaXNwYXRjaC5wcm90b3R5cGUgPSBkaXNwYXRjaC5wcm90b3R5cGUgPSB7XG4gIGNvbnN0cnVjdG9yOiBEaXNwYXRjaCxcbiAgb246IGZ1bmN0aW9uKHR5cGVuYW1lLCBjYWxsYmFjaykge1xuICAgIHZhciBfID0gdGhpcy5fLFxuICAgICAgICBUID0gcGFyc2VUeXBlbmFtZXModHlwZW5hbWUgKyBcIlwiLCBfKSxcbiAgICAgICAgdCxcbiAgICAgICAgaSA9IC0xLFxuICAgICAgICBuID0gVC5sZW5ndGg7XG5cbiAgICAvLyBJZiBubyBjYWxsYmFjayB3YXMgc3BlY2lmaWVkLCByZXR1cm4gdGhlIGNhbGxiYWNrIG9mIHRoZSBnaXZlbiB0eXBlIGFuZCBuYW1lLlxuICAgIGlmIChhcmd1bWVudHMubGVuZ3RoIDwgMikge1xuICAgICAgd2hpbGUgKCsraSA8IG4pIGlmICgodCA9ICh0eXBlbmFtZSA9IFRbaV0pLnR5cGUpICYmICh0ID0gZ2V0KF9bdF0sIHR5cGVuYW1lLm5hbWUpKSkgcmV0dXJuIHQ7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gSWYgYSB0eXBlIHdhcyBzcGVjaWZpZWQsIHNldCB0aGUgY2FsbGJhY2sgZm9yIHRoZSBnaXZlbiB0eXBlIGFuZCBuYW1lLlxuICAgIC8vIE90aGVyd2lzZSwgaWYgYSBudWxsIGNhbGxiYWNrIHdhcyBzcGVjaWZpZWQsIHJlbW92ZSBjYWxsYmFja3Mgb2YgdGhlIGdpdmVuIG5hbWUuXG4gICAgaWYgKGNhbGxiYWNrICE9IG51bGwgJiYgdHlwZW9mIGNhbGxiYWNrICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcihcImludmFsaWQgY2FsbGJhY2s6IFwiICsgY2FsbGJhY2spO1xuICAgIHdoaWxlICgrK2kgPCBuKSB7XG4gICAgICBpZiAodCA9ICh0eXBlbmFtZSA9IFRbaV0pLnR5cGUpIF9bdF0gPSBzZXQoX1t0XSwgdHlwZW5hbWUubmFtZSwgY2FsbGJhY2spO1xuICAgICAgZWxzZSBpZiAoY2FsbGJhY2sgPT0gbnVsbCkgZm9yICh0IGluIF8pIF9bdF0gPSBzZXQoX1t0XSwgdHlwZW5hbWUubmFtZSwgbnVsbCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXM7XG4gIH0sXG4gIGNvcHk6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBjb3B5ID0ge30sIF8gPSB0aGlzLl87XG4gICAgZm9yICh2YXIgdCBpbiBfKSBjb3B5W3RdID0gX1t0XS5zbGljZSgpO1xuICAgIHJldHVybiBuZXcgRGlzcGF0Y2goY29weSk7XG4gIH0sXG4gIGNhbGw6IGZ1bmN0aW9uKHR5cGUsIHRoYXQpIHtcbiAgICBpZiAoKG4gPSBhcmd1bWVudHMubGVuZ3RoIC0gMikgPiAwKSBmb3IgKHZhciBhcmdzID0gbmV3IEFycmF5KG4pLCBpID0gMCwgbiwgdDsgaSA8IG47ICsraSkgYXJnc1tpXSA9IGFyZ3VtZW50c1tpICsgMl07XG4gICAgaWYgKCF0aGlzLl8uaGFzT3duUHJvcGVydHkodHlwZSkpIHRocm93IG5ldyBFcnJvcihcInVua25vd24gdHlwZTogXCIgKyB0eXBlKTtcbiAgICBmb3IgKHQgPSB0aGlzLl9bdHlwZV0sIGkgPSAwLCBuID0gdC5sZW5ndGg7IGkgPCBuOyArK2kpIHRbaV0udmFsdWUuYXBwbHkodGhhdCwgYXJncyk7XG4gIH0sXG4gIGFwcGx5OiBmdW5jdGlvbih0eXBlLCB0aGF0LCBhcmdzKSB7XG4gICAgaWYgKCF0aGlzLl8uaGFzT3duUHJvcGVydHkodHlwZSkpIHRocm93IG5ldyBFcnJvcihcInVua25vd24gdHlwZTogXCIgKyB0eXBlKTtcbiAgICBmb3IgKHZhciB0ID0gdGhpcy5fW3R5cGVdLCBpID0gMCwgbiA9IHQubGVuZ3RoOyBpIDwgbjsgKytpKSB0W2ldLnZhbHVlLmFwcGx5KHRoYXQsIGFyZ3MpO1xuICB9XG59O1xuXG5mdW5jdGlvbiBnZXQodHlwZSwgbmFtZSkge1xuICBmb3IgKHZhciBpID0gMCwgbiA9IHR5cGUubGVuZ3RoLCBjOyBpIDwgbjsgKytpKSB7XG4gICAgaWYgKChjID0gdHlwZVtpXSkubmFtZSA9PT0gbmFtZSkge1xuICAgICAgcmV0dXJuIGMudmFsdWU7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIHNldCh0eXBlLCBuYW1lLCBjYWxsYmFjaykge1xuICBmb3IgKHZhciBpID0gMCwgbiA9IHR5cGUubGVuZ3RoOyBpIDwgbjsgKytpKSB7XG4gICAgaWYgKHR5cGVbaV0ubmFtZSA9PT0gbmFtZSkge1xuICAgICAgdHlwZVtpXSA9IG5vb3AsIHR5cGUgPSB0eXBlLnNsaWNlKDAsIGkpLmNvbmNhdCh0eXBlLnNsaWNlKGkgKyAxKSk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgaWYgKGNhbGxiYWNrICE9IG51bGwpIHR5cGUucHVzaCh7bmFtZTogbmFtZSwgdmFsdWU6IGNhbGxiYWNrfSk7XG4gIHJldHVybiB0eXBlO1xufVxuXG5leHBvcnQgZGVmYXVsdCBkaXNwYXRjaDtcbiIsICJleHBvcnQgdmFyIHhodG1sID0gXCJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hodG1sXCI7XG5cbmV4cG9ydCBkZWZhdWx0IHtcbiAgc3ZnOiBcImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCIsXG4gIHhodG1sOiB4aHRtbCxcbiAgeGxpbms6IFwiaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGlua1wiLFxuICB4bWw6IFwiaHR0cDovL3d3dy53My5vcmcvWE1MLzE5OTgvbmFtZXNwYWNlXCIsXG4gIHhtbG5zOiBcImh0dHA6Ly93d3cudzMub3JnLzIwMDAveG1sbnMvXCJcbn07XG4iLCAiaW1wb3J0IG5hbWVzcGFjZXMgZnJvbSBcIi4vbmFtZXNwYWNlcy5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihuYW1lKSB7XG4gIHZhciBwcmVmaXggPSBuYW1lICs9IFwiXCIsIGkgPSBwcmVmaXguaW5kZXhPZihcIjpcIik7XG4gIGlmIChpID49IDAgJiYgKHByZWZpeCA9IG5hbWUuc2xpY2UoMCwgaSkpICE9PSBcInhtbG5zXCIpIG5hbWUgPSBuYW1lLnNsaWNlKGkgKyAxKTtcbiAgcmV0dXJuIG5hbWVzcGFjZXMuaGFzT3duUHJvcGVydHkocHJlZml4KSA/IHtzcGFjZTogbmFtZXNwYWNlc1twcmVmaXhdLCBsb2NhbDogbmFtZX0gOiBuYW1lOyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXByb3RvdHlwZS1idWlsdGluc1xufVxuIiwgImltcG9ydCBuYW1lc3BhY2UgZnJvbSBcIi4vbmFtZXNwYWNlLmpzXCI7XG5pbXBvcnQge3hodG1sfSBmcm9tIFwiLi9uYW1lc3BhY2VzLmpzXCI7XG5cbmZ1bmN0aW9uIGNyZWF0b3JJbmhlcml0KG5hbWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBkb2N1bWVudCA9IHRoaXMub3duZXJEb2N1bWVudCxcbiAgICAgICAgdXJpID0gdGhpcy5uYW1lc3BhY2VVUkk7XG4gICAgcmV0dXJuIHVyaSA9PT0geGh0bWwgJiYgZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50Lm5hbWVzcGFjZVVSSSA9PT0geGh0bWxcbiAgICAgICAgPyBkb2N1bWVudC5jcmVhdGVFbGVtZW50KG5hbWUpXG4gICAgICAgIDogZG9jdW1lbnQuY3JlYXRlRWxlbWVudE5TKHVyaSwgbmFtZSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGNyZWF0b3JGaXhlZChmdWxsbmFtZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMub3duZXJEb2N1bWVudC5jcmVhdGVFbGVtZW50TlMoZnVsbG5hbWUuc3BhY2UsIGZ1bGxuYW1lLmxvY2FsKTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSkge1xuICB2YXIgZnVsbG5hbWUgPSBuYW1lc3BhY2UobmFtZSk7XG4gIHJldHVybiAoZnVsbG5hbWUubG9jYWxcbiAgICAgID8gY3JlYXRvckZpeGVkXG4gICAgICA6IGNyZWF0b3JJbmhlcml0KShmdWxsbmFtZSk7XG59XG4iLCAiZnVuY3Rpb24gbm9uZSgpIHt9XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHNlbGVjdG9yKSB7XG4gIHJldHVybiBzZWxlY3RvciA9PSBudWxsID8gbm9uZSA6IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5U2VsZWN0b3Ioc2VsZWN0b3IpO1xuICB9O1xufVxuIiwgImltcG9ydCB7U2VsZWN0aW9ufSBmcm9tIFwiLi9pbmRleC5qc1wiO1xuaW1wb3J0IHNlbGVjdG9yIGZyb20gXCIuLi9zZWxlY3Rvci5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihzZWxlY3QpIHtcbiAgaWYgKHR5cGVvZiBzZWxlY3QgIT09IFwiZnVuY3Rpb25cIikgc2VsZWN0ID0gc2VsZWN0b3Ioc2VsZWN0KTtcblxuICBmb3IgKHZhciBncm91cHMgPSB0aGlzLl9ncm91cHMsIG0gPSBncm91cHMubGVuZ3RoLCBzdWJncm91cHMgPSBuZXcgQXJyYXkobSksIGogPSAwOyBqIDwgbTsgKytqKSB7XG4gICAgZm9yICh2YXIgZ3JvdXAgPSBncm91cHNbal0sIG4gPSBncm91cC5sZW5ndGgsIHN1Ymdyb3VwID0gc3ViZ3JvdXBzW2pdID0gbmV3IEFycmF5KG4pLCBub2RlLCBzdWJub2RlLCBpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgaWYgKChub2RlID0gZ3JvdXBbaV0pICYmIChzdWJub2RlID0gc2VsZWN0LmNhbGwobm9kZSwgbm9kZS5fX2RhdGFfXywgaSwgZ3JvdXApKSkge1xuICAgICAgICBpZiAoXCJfX2RhdGFfX1wiIGluIG5vZGUpIHN1Ym5vZGUuX19kYXRhX18gPSBub2RlLl9fZGF0YV9fO1xuICAgICAgICBzdWJncm91cFtpXSA9IHN1Ym5vZGU7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG5ldyBTZWxlY3Rpb24oc3ViZ3JvdXBzLCB0aGlzLl9wYXJlbnRzKTtcbn1cbiIsICIvLyBHaXZlbiBzb21ldGhpbmcgYXJyYXkgbGlrZSAob3IgbnVsbCksIHJldHVybnMgc29tZXRoaW5nIHRoYXQgaXMgc3RyaWN0bHkgYW5cbi8vIGFycmF5LiBUaGlzIGlzIHVzZWQgdG8gZW5zdXJlIHRoYXQgYXJyYXktbGlrZSBvYmplY3RzIHBhc3NlZCB0byBkMy5zZWxlY3RBbGxcbi8vIG9yIHNlbGVjdGlvbi5zZWxlY3RBbGwgYXJlIGNvbnZlcnRlZCBpbnRvIHByb3BlciBhcnJheXMgd2hlbiBjcmVhdGluZyBhXG4vLyBzZWxlY3Rpb247IHdlIGRvblx1MjAxOXQgZXZlciB3YW50IHRvIGNyZWF0ZSBhIHNlbGVjdGlvbiBiYWNrZWQgYnkgYSBsaXZlXG4vLyBIVE1MQ29sbGVjdGlvbiBvciBOb2RlTGlzdC4gSG93ZXZlciwgbm90ZSB0aGF0IHNlbGVjdGlvbi5zZWxlY3RBbGwgd2lsbCB1c2UgYVxuLy8gc3RhdGljIE5vZGVMaXN0IGFzIGEgZ3JvdXAsIHNpbmNlIGl0IHNhZmVseSBkZXJpdmVkIGZyb20gcXVlcnlTZWxlY3RvckFsbC5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIGFycmF5KHgpIHtcbiAgcmV0dXJuIHggPT0gbnVsbCA/IFtdIDogQXJyYXkuaXNBcnJheSh4KSA/IHggOiBBcnJheS5mcm9tKHgpO1xufVxuIiwgImZ1bmN0aW9uIGVtcHR5KCkge1xuICByZXR1cm4gW107XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHNlbGVjdG9yKSB7XG4gIHJldHVybiBzZWxlY3RvciA9PSBudWxsID8gZW1wdHkgOiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeVNlbGVjdG9yQWxsKHNlbGVjdG9yKTtcbiAgfTtcbn1cbiIsICJpbXBvcnQge1NlbGVjdGlvbn0gZnJvbSBcIi4vaW5kZXguanNcIjtcbmltcG9ydCBhcnJheSBmcm9tIFwiLi4vYXJyYXkuanNcIjtcbmltcG9ydCBzZWxlY3RvckFsbCBmcm9tIFwiLi4vc2VsZWN0b3JBbGwuanNcIjtcblxuZnVuY3Rpb24gYXJyYXlBbGwoc2VsZWN0KSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gYXJyYXkoc2VsZWN0LmFwcGx5KHRoaXMsIGFyZ3VtZW50cykpO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihzZWxlY3QpIHtcbiAgaWYgKHR5cGVvZiBzZWxlY3QgPT09IFwiZnVuY3Rpb25cIikgc2VsZWN0ID0gYXJyYXlBbGwoc2VsZWN0KTtcbiAgZWxzZSBzZWxlY3QgPSBzZWxlY3RvckFsbChzZWxlY3QpO1xuXG4gIGZvciAodmFyIGdyb3VwcyA9IHRoaXMuX2dyb3VwcywgbSA9IGdyb3Vwcy5sZW5ndGgsIHN1Ymdyb3VwcyA9IFtdLCBwYXJlbnRzID0gW10sIGogPSAwOyBqIDwgbTsgKytqKSB7XG4gICAgZm9yICh2YXIgZ3JvdXAgPSBncm91cHNbal0sIG4gPSBncm91cC5sZW5ndGgsIG5vZGUsIGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAobm9kZSA9IGdyb3VwW2ldKSB7XG4gICAgICAgIHN1Ymdyb3Vwcy5wdXNoKHNlbGVjdC5jYWxsKG5vZGUsIG5vZGUuX19kYXRhX18sIGksIGdyb3VwKSk7XG4gICAgICAgIHBhcmVudHMucHVzaChub2RlKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gbmV3IFNlbGVjdGlvbihzdWJncm91cHMsIHBhcmVudHMpO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHNlbGVjdG9yKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5tYXRjaGVzKHNlbGVjdG9yKTtcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNoaWxkTWF0Y2hlcihzZWxlY3Rvcikge1xuICByZXR1cm4gZnVuY3Rpb24obm9kZSkge1xuICAgIHJldHVybiBub2RlLm1hdGNoZXMoc2VsZWN0b3IpO1xuICB9O1xufVxuXG4iLCAiaW1wb3J0IHtjaGlsZE1hdGNoZXJ9IGZyb20gXCIuLi9tYXRjaGVyLmpzXCI7XG5cbnZhciBmaW5kID0gQXJyYXkucHJvdG90eXBlLmZpbmQ7XG5cbmZ1bmN0aW9uIGNoaWxkRmluZChtYXRjaCkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGZpbmQuY2FsbCh0aGlzLmNoaWxkcmVuLCBtYXRjaCk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGNoaWxkRmlyc3QoKSB7XG4gIHJldHVybiB0aGlzLmZpcnN0RWxlbWVudENoaWxkO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihtYXRjaCkge1xuICByZXR1cm4gdGhpcy5zZWxlY3QobWF0Y2ggPT0gbnVsbCA/IGNoaWxkRmlyc3RcbiAgICAgIDogY2hpbGRGaW5kKHR5cGVvZiBtYXRjaCA9PT0gXCJmdW5jdGlvblwiID8gbWF0Y2ggOiBjaGlsZE1hdGNoZXIobWF0Y2gpKSk7XG59XG4iLCAiaW1wb3J0IHtjaGlsZE1hdGNoZXJ9IGZyb20gXCIuLi9tYXRjaGVyLmpzXCI7XG5cbnZhciBmaWx0ZXIgPSBBcnJheS5wcm90b3R5cGUuZmlsdGVyO1xuXG5mdW5jdGlvbiBjaGlsZHJlbigpIHtcbiAgcmV0dXJuIEFycmF5LmZyb20odGhpcy5jaGlsZHJlbik7XG59XG5cbmZ1bmN0aW9uIGNoaWxkcmVuRmlsdGVyKG1hdGNoKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gZmlsdGVyLmNhbGwodGhpcy5jaGlsZHJlbiwgbWF0Y2gpO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihtYXRjaCkge1xuICByZXR1cm4gdGhpcy5zZWxlY3RBbGwobWF0Y2ggPT0gbnVsbCA/IGNoaWxkcmVuXG4gICAgICA6IGNoaWxkcmVuRmlsdGVyKHR5cGVvZiBtYXRjaCA9PT0gXCJmdW5jdGlvblwiID8gbWF0Y2ggOiBjaGlsZE1hdGNoZXIobWF0Y2gpKSk7XG59XG4iLCAiaW1wb3J0IHtTZWxlY3Rpb259IGZyb20gXCIuL2luZGV4LmpzXCI7XG5pbXBvcnQgbWF0Y2hlciBmcm9tIFwiLi4vbWF0Y2hlci5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihtYXRjaCkge1xuICBpZiAodHlwZW9mIG1hdGNoICE9PSBcImZ1bmN0aW9uXCIpIG1hdGNoID0gbWF0Y2hlcihtYXRjaCk7XG5cbiAgZm9yICh2YXIgZ3JvdXBzID0gdGhpcy5fZ3JvdXBzLCBtID0gZ3JvdXBzLmxlbmd0aCwgc3ViZ3JvdXBzID0gbmV3IEFycmF5KG0pLCBqID0gMDsgaiA8IG07ICsraikge1xuICAgIGZvciAodmFyIGdyb3VwID0gZ3JvdXBzW2pdLCBuID0gZ3JvdXAubGVuZ3RoLCBzdWJncm91cCA9IHN1Ymdyb3Vwc1tqXSA9IFtdLCBub2RlLCBpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgaWYgKChub2RlID0gZ3JvdXBbaV0pICYmIG1hdGNoLmNhbGwobm9kZSwgbm9kZS5fX2RhdGFfXywgaSwgZ3JvdXApKSB7XG4gICAgICAgIHN1Ymdyb3VwLnB1c2gobm9kZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG5ldyBTZWxlY3Rpb24oc3ViZ3JvdXBzLCB0aGlzLl9wYXJlbnRzKTtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbih1cGRhdGUpIHtcbiAgcmV0dXJuIG5ldyBBcnJheSh1cGRhdGUubGVuZ3RoKTtcbn1cbiIsICJpbXBvcnQgc3BhcnNlIGZyb20gXCIuL3NwYXJzZS5qc1wiO1xuaW1wb3J0IHtTZWxlY3Rpb259IGZyb20gXCIuL2luZGV4LmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gbmV3IFNlbGVjdGlvbih0aGlzLl9lbnRlciB8fCB0aGlzLl9ncm91cHMubWFwKHNwYXJzZSksIHRoaXMuX3BhcmVudHMpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gRW50ZXJOb2RlKHBhcmVudCwgZGF0dW0pIHtcbiAgdGhpcy5vd25lckRvY3VtZW50ID0gcGFyZW50Lm93bmVyRG9jdW1lbnQ7XG4gIHRoaXMubmFtZXNwYWNlVVJJID0gcGFyZW50Lm5hbWVzcGFjZVVSSTtcbiAgdGhpcy5fbmV4dCA9IG51bGw7XG4gIHRoaXMuX3BhcmVudCA9IHBhcmVudDtcbiAgdGhpcy5fX2RhdGFfXyA9IGRhdHVtO1xufVxuXG5FbnRlck5vZGUucHJvdG90eXBlID0ge1xuICBjb25zdHJ1Y3RvcjogRW50ZXJOb2RlLFxuICBhcHBlbmRDaGlsZDogZnVuY3Rpb24oY2hpbGQpIHsgcmV0dXJuIHRoaXMuX3BhcmVudC5pbnNlcnRCZWZvcmUoY2hpbGQsIHRoaXMuX25leHQpOyB9LFxuICBpbnNlcnRCZWZvcmU6IGZ1bmN0aW9uKGNoaWxkLCBuZXh0KSB7IHJldHVybiB0aGlzLl9wYXJlbnQuaW5zZXJ0QmVmb3JlKGNoaWxkLCBuZXh0KTsgfSxcbiAgcXVlcnlTZWxlY3RvcjogZnVuY3Rpb24oc2VsZWN0b3IpIHsgcmV0dXJuIHRoaXMuX3BhcmVudC5xdWVyeVNlbGVjdG9yKHNlbGVjdG9yKTsgfSxcbiAgcXVlcnlTZWxlY3RvckFsbDogZnVuY3Rpb24oc2VsZWN0b3IpIHsgcmV0dXJuIHRoaXMuX3BhcmVudC5xdWVyeVNlbGVjdG9yQWxsKHNlbGVjdG9yKTsgfVxufTtcbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbih4KSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4geDtcbiAgfTtcbn1cbiIsICJpbXBvcnQge1NlbGVjdGlvbn0gZnJvbSBcIi4vaW5kZXguanNcIjtcbmltcG9ydCB7RW50ZXJOb2RlfSBmcm9tIFwiLi9lbnRlci5qc1wiO1xuaW1wb3J0IGNvbnN0YW50IGZyb20gXCIuLi9jb25zdGFudC5qc1wiO1xuXG5mdW5jdGlvbiBiaW5kSW5kZXgocGFyZW50LCBncm91cCwgZW50ZXIsIHVwZGF0ZSwgZXhpdCwgZGF0YSkge1xuICB2YXIgaSA9IDAsXG4gICAgICBub2RlLFxuICAgICAgZ3JvdXBMZW5ndGggPSBncm91cC5sZW5ndGgsXG4gICAgICBkYXRhTGVuZ3RoID0gZGF0YS5sZW5ndGg7XG5cbiAgLy8gUHV0IGFueSBub24tbnVsbCBub2RlcyB0aGF0IGZpdCBpbnRvIHVwZGF0ZS5cbiAgLy8gUHV0IGFueSBudWxsIG5vZGVzIGludG8gZW50ZXIuXG4gIC8vIFB1dCBhbnkgcmVtYWluaW5nIGRhdGEgaW50byBlbnRlci5cbiAgZm9yICg7IGkgPCBkYXRhTGVuZ3RoOyArK2kpIHtcbiAgICBpZiAobm9kZSA9IGdyb3VwW2ldKSB7XG4gICAgICBub2RlLl9fZGF0YV9fID0gZGF0YVtpXTtcbiAgICAgIHVwZGF0ZVtpXSA9IG5vZGU7XG4gICAgfSBlbHNlIHtcbiAgICAgIGVudGVyW2ldID0gbmV3IEVudGVyTm9kZShwYXJlbnQsIGRhdGFbaV0pO1xuICAgIH1cbiAgfVxuXG4gIC8vIFB1dCBhbnkgbm9uLW51bGwgbm9kZXMgdGhhdCBkb25cdTIwMTl0IGZpdCBpbnRvIGV4aXQuXG4gIGZvciAoOyBpIDwgZ3JvdXBMZW5ndGg7ICsraSkge1xuICAgIGlmIChub2RlID0gZ3JvdXBbaV0pIHtcbiAgICAgIGV4aXRbaV0gPSBub2RlO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBiaW5kS2V5KHBhcmVudCwgZ3JvdXAsIGVudGVyLCB1cGRhdGUsIGV4aXQsIGRhdGEsIGtleSkge1xuICB2YXIgaSxcbiAgICAgIG5vZGUsXG4gICAgICBub2RlQnlLZXlWYWx1ZSA9IG5ldyBNYXAsXG4gICAgICBncm91cExlbmd0aCA9IGdyb3VwLmxlbmd0aCxcbiAgICAgIGRhdGFMZW5ndGggPSBkYXRhLmxlbmd0aCxcbiAgICAgIGtleVZhbHVlcyA9IG5ldyBBcnJheShncm91cExlbmd0aCksXG4gICAgICBrZXlWYWx1ZTtcblxuICAvLyBDb21wdXRlIHRoZSBrZXkgZm9yIGVhY2ggbm9kZS5cbiAgLy8gSWYgbXVsdGlwbGUgbm9kZXMgaGF2ZSB0aGUgc2FtZSBrZXksIHRoZSBkdXBsaWNhdGVzIGFyZSBhZGRlZCB0byBleGl0LlxuICBmb3IgKGkgPSAwOyBpIDwgZ3JvdXBMZW5ndGg7ICsraSkge1xuICAgIGlmIChub2RlID0gZ3JvdXBbaV0pIHtcbiAgICAgIGtleVZhbHVlc1tpXSA9IGtleVZhbHVlID0ga2V5LmNhbGwobm9kZSwgbm9kZS5fX2RhdGFfXywgaSwgZ3JvdXApICsgXCJcIjtcbiAgICAgIGlmIChub2RlQnlLZXlWYWx1ZS5oYXMoa2V5VmFsdWUpKSB7XG4gICAgICAgIGV4aXRbaV0gPSBub2RlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbm9kZUJ5S2V5VmFsdWUuc2V0KGtleVZhbHVlLCBub2RlKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyBDb21wdXRlIHRoZSBrZXkgZm9yIGVhY2ggZGF0dW0uXG4gIC8vIElmIHRoZXJlIGEgbm9kZSBhc3NvY2lhdGVkIHdpdGggdGhpcyBrZXksIGpvaW4gYW5kIGFkZCBpdCB0byB1cGRhdGUuXG4gIC8vIElmIHRoZXJlIGlzIG5vdCAob3IgdGhlIGtleSBpcyBhIGR1cGxpY2F0ZSksIGFkZCBpdCB0byBlbnRlci5cbiAgZm9yIChpID0gMDsgaSA8IGRhdGFMZW5ndGg7ICsraSkge1xuICAgIGtleVZhbHVlID0ga2V5LmNhbGwocGFyZW50LCBkYXRhW2ldLCBpLCBkYXRhKSArIFwiXCI7XG4gICAgaWYgKG5vZGUgPSBub2RlQnlLZXlWYWx1ZS5nZXQoa2V5VmFsdWUpKSB7XG4gICAgICB1cGRhdGVbaV0gPSBub2RlO1xuICAgICAgbm9kZS5fX2RhdGFfXyA9IGRhdGFbaV07XG4gICAgICBub2RlQnlLZXlWYWx1ZS5kZWxldGUoa2V5VmFsdWUpO1xuICAgIH0gZWxzZSB7XG4gICAgICBlbnRlcltpXSA9IG5ldyBFbnRlck5vZGUocGFyZW50LCBkYXRhW2ldKTtcbiAgICB9XG4gIH1cblxuICAvLyBBZGQgYW55IHJlbWFpbmluZyBub2RlcyB0aGF0IHdlcmUgbm90IGJvdW5kIHRvIGRhdGEgdG8gZXhpdC5cbiAgZm9yIChpID0gMDsgaSA8IGdyb3VwTGVuZ3RoOyArK2kpIHtcbiAgICBpZiAoKG5vZGUgPSBncm91cFtpXSkgJiYgKG5vZGVCeUtleVZhbHVlLmdldChrZXlWYWx1ZXNbaV0pID09PSBub2RlKSkge1xuICAgICAgZXhpdFtpXSA9IG5vZGU7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGRhdHVtKG5vZGUpIHtcbiAgcmV0dXJuIG5vZGUuX19kYXRhX187XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHZhbHVlLCBrZXkpIHtcbiAgaWYgKCFhcmd1bWVudHMubGVuZ3RoKSByZXR1cm4gQXJyYXkuZnJvbSh0aGlzLCBkYXR1bSk7XG5cbiAgdmFyIGJpbmQgPSBrZXkgPyBiaW5kS2V5IDogYmluZEluZGV4LFxuICAgICAgcGFyZW50cyA9IHRoaXMuX3BhcmVudHMsXG4gICAgICBncm91cHMgPSB0aGlzLl9ncm91cHM7XG5cbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJmdW5jdGlvblwiKSB2YWx1ZSA9IGNvbnN0YW50KHZhbHVlKTtcblxuICBmb3IgKHZhciBtID0gZ3JvdXBzLmxlbmd0aCwgdXBkYXRlID0gbmV3IEFycmF5KG0pLCBlbnRlciA9IG5ldyBBcnJheShtKSwgZXhpdCA9IG5ldyBBcnJheShtKSwgaiA9IDA7IGogPCBtOyArK2opIHtcbiAgICB2YXIgcGFyZW50ID0gcGFyZW50c1tqXSxcbiAgICAgICAgZ3JvdXAgPSBncm91cHNbal0sXG4gICAgICAgIGdyb3VwTGVuZ3RoID0gZ3JvdXAubGVuZ3RoLFxuICAgICAgICBkYXRhID0gYXJyYXlsaWtlKHZhbHVlLmNhbGwocGFyZW50LCBwYXJlbnQgJiYgcGFyZW50Ll9fZGF0YV9fLCBqLCBwYXJlbnRzKSksXG4gICAgICAgIGRhdGFMZW5ndGggPSBkYXRhLmxlbmd0aCxcbiAgICAgICAgZW50ZXJHcm91cCA9IGVudGVyW2pdID0gbmV3IEFycmF5KGRhdGFMZW5ndGgpLFxuICAgICAgICB1cGRhdGVHcm91cCA9IHVwZGF0ZVtqXSA9IG5ldyBBcnJheShkYXRhTGVuZ3RoKSxcbiAgICAgICAgZXhpdEdyb3VwID0gZXhpdFtqXSA9IG5ldyBBcnJheShncm91cExlbmd0aCk7XG5cbiAgICBiaW5kKHBhcmVudCwgZ3JvdXAsIGVudGVyR3JvdXAsIHVwZGF0ZUdyb3VwLCBleGl0R3JvdXAsIGRhdGEsIGtleSk7XG5cbiAgICAvLyBOb3cgY29ubmVjdCB0aGUgZW50ZXIgbm9kZXMgdG8gdGhlaXIgZm9sbG93aW5nIHVwZGF0ZSBub2RlLCBzdWNoIHRoYXRcbiAgICAvLyBhcHBlbmRDaGlsZCBjYW4gaW5zZXJ0IHRoZSBtYXRlcmlhbGl6ZWQgZW50ZXIgbm9kZSBiZWZvcmUgdGhpcyBub2RlLFxuICAgIC8vIHJhdGhlciB0aGFuIGF0IHRoZSBlbmQgb2YgdGhlIHBhcmVudCBub2RlLlxuICAgIGZvciAodmFyIGkwID0gMCwgaTEgPSAwLCBwcmV2aW91cywgbmV4dDsgaTAgPCBkYXRhTGVuZ3RoOyArK2kwKSB7XG4gICAgICBpZiAocHJldmlvdXMgPSBlbnRlckdyb3VwW2kwXSkge1xuICAgICAgICBpZiAoaTAgPj0gaTEpIGkxID0gaTAgKyAxO1xuICAgICAgICB3aGlsZSAoIShuZXh0ID0gdXBkYXRlR3JvdXBbaTFdKSAmJiArK2kxIDwgZGF0YUxlbmd0aCk7XG4gICAgICAgIHByZXZpb3VzLl9uZXh0ID0gbmV4dCB8fCBudWxsO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHVwZGF0ZSA9IG5ldyBTZWxlY3Rpb24odXBkYXRlLCBwYXJlbnRzKTtcbiAgdXBkYXRlLl9lbnRlciA9IGVudGVyO1xuICB1cGRhdGUuX2V4aXQgPSBleGl0O1xuICByZXR1cm4gdXBkYXRlO1xufVxuXG4vLyBHaXZlbiBzb21lIGRhdGEsIHRoaXMgcmV0dXJucyBhbiBhcnJheS1saWtlIHZpZXcgb2YgaXQ6IGFuIG9iamVjdCB0aGF0XG4vLyBleHBvc2VzIGEgbGVuZ3RoIHByb3BlcnR5IGFuZCBhbGxvd3MgbnVtZXJpYyBpbmRleGluZy4gTm90ZSB0aGF0IHVubGlrZVxuLy8gc2VsZWN0QWxsLCB0aGlzIGlzblx1MjAxOXQgd29ycmllZCBhYm91dCBcdTIwMUNsaXZlXHUyMDFEIGNvbGxlY3Rpb25zIGJlY2F1c2UgdGhlIHJlc3VsdGluZ1xuLy8gYXJyYXkgd2lsbCBvbmx5IGJlIHVzZWQgYnJpZWZseSB3aGlsZSBkYXRhIGlzIGJlaW5nIGJvdW5kLiAoSXQgaXMgcG9zc2libGUgdG9cbi8vIGNhdXNlIHRoZSBkYXRhIHRvIGNoYW5nZSB3aGlsZSBpdGVyYXRpbmcgYnkgdXNpbmcgYSBrZXkgZnVuY3Rpb24sIGJ1dCBwbGVhc2Vcbi8vIGRvblx1MjAxOXQ7IHdlXHUyMDE5ZCByYXRoZXIgYXZvaWQgYSBncmF0dWl0b3VzIGNvcHkuKVxuZnVuY3Rpb24gYXJyYXlsaWtlKGRhdGEpIHtcbiAgcmV0dXJuIHR5cGVvZiBkYXRhID09PSBcIm9iamVjdFwiICYmIFwibGVuZ3RoXCIgaW4gZGF0YVxuICAgID8gZGF0YSAvLyBBcnJheSwgVHlwZWRBcnJheSwgTm9kZUxpc3QsIGFycmF5LWxpa2VcbiAgICA6IEFycmF5LmZyb20oZGF0YSk7IC8vIE1hcCwgU2V0LCBpdGVyYWJsZSwgc3RyaW5nLCBvciBhbnl0aGluZyBlbHNlXG59XG4iLCAiaW1wb3J0IHNwYXJzZSBmcm9tIFwiLi9zcGFyc2UuanNcIjtcbmltcG9ydCB7U2VsZWN0aW9ufSBmcm9tIFwiLi9pbmRleC5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIG5ldyBTZWxlY3Rpb24odGhpcy5fZXhpdCB8fCB0aGlzLl9ncm91cHMubWFwKHNwYXJzZSksIHRoaXMuX3BhcmVudHMpO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG9uZW50ZXIsIG9udXBkYXRlLCBvbmV4aXQpIHtcbiAgdmFyIGVudGVyID0gdGhpcy5lbnRlcigpLCB1cGRhdGUgPSB0aGlzLCBleGl0ID0gdGhpcy5leGl0KCk7XG4gIGlmICh0eXBlb2Ygb25lbnRlciA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgZW50ZXIgPSBvbmVudGVyKGVudGVyKTtcbiAgICBpZiAoZW50ZXIpIGVudGVyID0gZW50ZXIuc2VsZWN0aW9uKCk7XG4gIH0gZWxzZSB7XG4gICAgZW50ZXIgPSBlbnRlci5hcHBlbmQob25lbnRlciArIFwiXCIpO1xuICB9XG4gIGlmIChvbnVwZGF0ZSAhPSBudWxsKSB7XG4gICAgdXBkYXRlID0gb251cGRhdGUodXBkYXRlKTtcbiAgICBpZiAodXBkYXRlKSB1cGRhdGUgPSB1cGRhdGUuc2VsZWN0aW9uKCk7XG4gIH1cbiAgaWYgKG9uZXhpdCA9PSBudWxsKSBleGl0LnJlbW92ZSgpOyBlbHNlIG9uZXhpdChleGl0KTtcbiAgcmV0dXJuIGVudGVyICYmIHVwZGF0ZSA/IGVudGVyLm1lcmdlKHVwZGF0ZSkub3JkZXIoKSA6IHVwZGF0ZTtcbn1cbiIsICJpbXBvcnQge1NlbGVjdGlvbn0gZnJvbSBcIi4vaW5kZXguanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oY29udGV4dCkge1xuICB2YXIgc2VsZWN0aW9uID0gY29udGV4dC5zZWxlY3Rpb24gPyBjb250ZXh0LnNlbGVjdGlvbigpIDogY29udGV4dDtcblxuICBmb3IgKHZhciBncm91cHMwID0gdGhpcy5fZ3JvdXBzLCBncm91cHMxID0gc2VsZWN0aW9uLl9ncm91cHMsIG0wID0gZ3JvdXBzMC5sZW5ndGgsIG0xID0gZ3JvdXBzMS5sZW5ndGgsIG0gPSBNYXRoLm1pbihtMCwgbTEpLCBtZXJnZXMgPSBuZXcgQXJyYXkobTApLCBqID0gMDsgaiA8IG07ICsraikge1xuICAgIGZvciAodmFyIGdyb3VwMCA9IGdyb3VwczBbal0sIGdyb3VwMSA9IGdyb3VwczFbal0sIG4gPSBncm91cDAubGVuZ3RoLCBtZXJnZSA9IG1lcmdlc1tqXSA9IG5ldyBBcnJheShuKSwgbm9kZSwgaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIGlmIChub2RlID0gZ3JvdXAwW2ldIHx8IGdyb3VwMVtpXSkge1xuICAgICAgICBtZXJnZVtpXSA9IG5vZGU7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZm9yICg7IGogPCBtMDsgKytqKSB7XG4gICAgbWVyZ2VzW2pdID0gZ3JvdXBzMFtqXTtcbiAgfVxuXG4gIHJldHVybiBuZXcgU2VsZWN0aW9uKG1lcmdlcywgdGhpcy5fcGFyZW50cyk7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG5cbiAgZm9yICh2YXIgZ3JvdXBzID0gdGhpcy5fZ3JvdXBzLCBqID0gLTEsIG0gPSBncm91cHMubGVuZ3RoOyArK2ogPCBtOykge1xuICAgIGZvciAodmFyIGdyb3VwID0gZ3JvdXBzW2pdLCBpID0gZ3JvdXAubGVuZ3RoIC0gMSwgbmV4dCA9IGdyb3VwW2ldLCBub2RlOyAtLWkgPj0gMDspIHtcbiAgICAgIGlmIChub2RlID0gZ3JvdXBbaV0pIHtcbiAgICAgICAgaWYgKG5leHQgJiYgbm9kZS5jb21wYXJlRG9jdW1lbnRQb3NpdGlvbihuZXh0KSBeIDQpIG5leHQucGFyZW50Tm9kZS5pbnNlcnRCZWZvcmUobm9kZSwgbmV4dCk7XG4gICAgICAgIG5leHQgPSBub2RlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0aGlzO1xufVxuIiwgImltcG9ydCB7U2VsZWN0aW9ufSBmcm9tIFwiLi9pbmRleC5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihjb21wYXJlKSB7XG4gIGlmICghY29tcGFyZSkgY29tcGFyZSA9IGFzY2VuZGluZztcblxuICBmdW5jdGlvbiBjb21wYXJlTm9kZShhLCBiKSB7XG4gICAgcmV0dXJuIGEgJiYgYiA/IGNvbXBhcmUoYS5fX2RhdGFfXywgYi5fX2RhdGFfXykgOiAhYSAtICFiO1xuICB9XG5cbiAgZm9yICh2YXIgZ3JvdXBzID0gdGhpcy5fZ3JvdXBzLCBtID0gZ3JvdXBzLmxlbmd0aCwgc29ydGdyb3VwcyA9IG5ldyBBcnJheShtKSwgaiA9IDA7IGogPCBtOyArK2opIHtcbiAgICBmb3IgKHZhciBncm91cCA9IGdyb3Vwc1tqXSwgbiA9IGdyb3VwLmxlbmd0aCwgc29ydGdyb3VwID0gc29ydGdyb3Vwc1tqXSA9IG5ldyBBcnJheShuKSwgbm9kZSwgaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIGlmIChub2RlID0gZ3JvdXBbaV0pIHtcbiAgICAgICAgc29ydGdyb3VwW2ldID0gbm9kZTtcbiAgICAgIH1cbiAgICB9XG4gICAgc29ydGdyb3VwLnNvcnQoY29tcGFyZU5vZGUpO1xuICB9XG5cbiAgcmV0dXJuIG5ldyBTZWxlY3Rpb24oc29ydGdyb3VwcywgdGhpcy5fcGFyZW50cykub3JkZXIoKTtcbn1cblxuZnVuY3Rpb24gYXNjZW5kaW5nKGEsIGIpIHtcbiAgcmV0dXJuIGEgPCBiID8gLTEgOiBhID4gYiA/IDEgOiBhID49IGIgPyAwIDogTmFOO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKCkge1xuICB2YXIgY2FsbGJhY2sgPSBhcmd1bWVudHNbMF07XG4gIGFyZ3VtZW50c1swXSA9IHRoaXM7XG4gIGNhbGxiYWNrLmFwcGx5KG51bGwsIGFyZ3VtZW50cyk7XG4gIHJldHVybiB0aGlzO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gQXJyYXkuZnJvbSh0aGlzKTtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcblxuICBmb3IgKHZhciBncm91cHMgPSB0aGlzLl9ncm91cHMsIGogPSAwLCBtID0gZ3JvdXBzLmxlbmd0aDsgaiA8IG07ICsraikge1xuICAgIGZvciAodmFyIGdyb3VwID0gZ3JvdXBzW2pdLCBpID0gMCwgbiA9IGdyb3VwLmxlbmd0aDsgaSA8IG47ICsraSkge1xuICAgICAgdmFyIG5vZGUgPSBncm91cFtpXTtcbiAgICAgIGlmIChub2RlKSByZXR1cm4gbm9kZTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gbnVsbDtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgbGV0IHNpemUgPSAwO1xuICBmb3IgKGNvbnN0IG5vZGUgb2YgdGhpcykgKytzaXplOyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gIHJldHVybiBzaXplO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gIXRoaXMubm9kZSgpO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGNhbGxiYWNrKSB7XG5cbiAgZm9yICh2YXIgZ3JvdXBzID0gdGhpcy5fZ3JvdXBzLCBqID0gMCwgbSA9IGdyb3Vwcy5sZW5ndGg7IGogPCBtOyArK2opIHtcbiAgICBmb3IgKHZhciBncm91cCA9IGdyb3Vwc1tqXSwgaSA9IDAsIG4gPSBncm91cC5sZW5ndGgsIG5vZGU7IGkgPCBuOyArK2kpIHtcbiAgICAgIGlmIChub2RlID0gZ3JvdXBbaV0pIGNhbGxiYWNrLmNhbGwobm9kZSwgbm9kZS5fX2RhdGFfXywgaSwgZ3JvdXApO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0aGlzO1xufVxuIiwgImltcG9ydCBuYW1lc3BhY2UgZnJvbSBcIi4uL25hbWVzcGFjZS5qc1wiO1xuXG5mdW5jdGlvbiBhdHRyUmVtb3ZlKG5hbWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHRoaXMucmVtb3ZlQXR0cmlidXRlKG5hbWUpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBhdHRyUmVtb3ZlTlMoZnVsbG5hbWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHRoaXMucmVtb3ZlQXR0cmlidXRlTlMoZnVsbG5hbWUuc3BhY2UsIGZ1bGxuYW1lLmxvY2FsKTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gYXR0ckNvbnN0YW50KG5hbWUsIHZhbHVlKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnNldEF0dHJpYnV0ZShuYW1lLCB2YWx1ZSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGF0dHJDb25zdGFudE5TKGZ1bGxuYW1lLCB2YWx1ZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5zZXRBdHRyaWJ1dGVOUyhmdWxsbmFtZS5zcGFjZSwgZnVsbG5hbWUubG9jYWwsIHZhbHVlKTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gYXR0ckZ1bmN0aW9uKG5hbWUsIHZhbHVlKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgdiA9IHZhbHVlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgaWYgKHYgPT0gbnVsbCkgdGhpcy5yZW1vdmVBdHRyaWJ1dGUobmFtZSk7XG4gICAgZWxzZSB0aGlzLnNldEF0dHJpYnV0ZShuYW1lLCB2KTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gYXR0ckZ1bmN0aW9uTlMoZnVsbG5hbWUsIHZhbHVlKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgdiA9IHZhbHVlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgaWYgKHYgPT0gbnVsbCkgdGhpcy5yZW1vdmVBdHRyaWJ1dGVOUyhmdWxsbmFtZS5zcGFjZSwgZnVsbG5hbWUubG9jYWwpO1xuICAgIGVsc2UgdGhpcy5zZXRBdHRyaWJ1dGVOUyhmdWxsbmFtZS5zcGFjZSwgZnVsbG5hbWUubG9jYWwsIHYpO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihuYW1lLCB2YWx1ZSkge1xuICB2YXIgZnVsbG5hbWUgPSBuYW1lc3BhY2UobmFtZSk7XG5cbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPCAyKSB7XG4gICAgdmFyIG5vZGUgPSB0aGlzLm5vZGUoKTtcbiAgICByZXR1cm4gZnVsbG5hbWUubG9jYWxcbiAgICAgICAgPyBub2RlLmdldEF0dHJpYnV0ZU5TKGZ1bGxuYW1lLnNwYWNlLCBmdWxsbmFtZS5sb2NhbClcbiAgICAgICAgOiBub2RlLmdldEF0dHJpYnV0ZShmdWxsbmFtZSk7XG4gIH1cblxuICByZXR1cm4gdGhpcy5lYWNoKCh2YWx1ZSA9PSBudWxsXG4gICAgICA/IChmdWxsbmFtZS5sb2NhbCA/IGF0dHJSZW1vdmVOUyA6IGF0dHJSZW1vdmUpIDogKHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgICA/IChmdWxsbmFtZS5sb2NhbCA/IGF0dHJGdW5jdGlvbk5TIDogYXR0ckZ1bmN0aW9uKVxuICAgICAgOiAoZnVsbG5hbWUubG9jYWwgPyBhdHRyQ29uc3RhbnROUyA6IGF0dHJDb25zdGFudCkpKShmdWxsbmFtZSwgdmFsdWUpKTtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbihub2RlKSB7XG4gIHJldHVybiAobm9kZS5vd25lckRvY3VtZW50ICYmIG5vZGUub3duZXJEb2N1bWVudC5kZWZhdWx0VmlldykgLy8gbm9kZSBpcyBhIE5vZGVcbiAgICAgIHx8IChub2RlLmRvY3VtZW50ICYmIG5vZGUpIC8vIG5vZGUgaXMgYSBXaW5kb3dcbiAgICAgIHx8IG5vZGUuZGVmYXVsdFZpZXc7IC8vIG5vZGUgaXMgYSBEb2N1bWVudFxufVxuIiwgImltcG9ydCBkZWZhdWx0VmlldyBmcm9tIFwiLi4vd2luZG93LmpzXCI7XG5cbmZ1bmN0aW9uIHN0eWxlUmVtb3ZlKG5hbWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuc3R5bGUucmVtb3ZlUHJvcGVydHkobmFtZSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIHN0eWxlQ29uc3RhbnQobmFtZSwgdmFsdWUsIHByaW9yaXR5KSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnN0eWxlLnNldFByb3BlcnR5KG5hbWUsIHZhbHVlLCBwcmlvcml0eSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIHN0eWxlRnVuY3Rpb24obmFtZSwgdmFsdWUsIHByaW9yaXR5KSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgdiA9IHZhbHVlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgaWYgKHYgPT0gbnVsbCkgdGhpcy5zdHlsZS5yZW1vdmVQcm9wZXJ0eShuYW1lKTtcbiAgICBlbHNlIHRoaXMuc3R5bGUuc2V0UHJvcGVydHkobmFtZSwgdiwgcHJpb3JpdHkpO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihuYW1lLCB2YWx1ZSwgcHJpb3JpdHkpIHtcbiAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPiAxXG4gICAgICA/IHRoaXMuZWFjaCgodmFsdWUgPT0gbnVsbFxuICAgICAgICAgICAgPyBzdHlsZVJlbW92ZSA6IHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgICAgICAgICA/IHN0eWxlRnVuY3Rpb25cbiAgICAgICAgICAgIDogc3R5bGVDb25zdGFudCkobmFtZSwgdmFsdWUsIHByaW9yaXR5ID09IG51bGwgPyBcIlwiIDogcHJpb3JpdHkpKVxuICAgICAgOiBzdHlsZVZhbHVlKHRoaXMubm9kZSgpLCBuYW1lKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHN0eWxlVmFsdWUobm9kZSwgbmFtZSkge1xuICByZXR1cm4gbm9kZS5zdHlsZS5nZXRQcm9wZXJ0eVZhbHVlKG5hbWUpXG4gICAgICB8fCBkZWZhdWx0Vmlldyhub2RlKS5nZXRDb21wdXRlZFN0eWxlKG5vZGUsIG51bGwpLmdldFByb3BlcnR5VmFsdWUobmFtZSk7XG59XG4iLCAiZnVuY3Rpb24gcHJvcGVydHlSZW1vdmUobmFtZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgZGVsZXRlIHRoaXNbbmFtZV07XG4gIH07XG59XG5cbmZ1bmN0aW9uIHByb3BlcnR5Q29uc3RhbnQobmFtZSwgdmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHRoaXNbbmFtZV0gPSB2YWx1ZTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gcHJvcGVydHlGdW5jdGlvbihuYW1lLCB2YWx1ZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHYgPSB2YWx1ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIGlmICh2ID09IG51bGwpIGRlbGV0ZSB0aGlzW25hbWVdO1xuICAgIGVsc2UgdGhpc1tuYW1lXSA9IHY7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG5hbWUsIHZhbHVlKSB7XG4gIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID4gMVxuICAgICAgPyB0aGlzLmVhY2goKHZhbHVlID09IG51bGxcbiAgICAgICAgICA/IHByb3BlcnR5UmVtb3ZlIDogdHlwZW9mIHZhbHVlID09PSBcImZ1bmN0aW9uXCJcbiAgICAgICAgICA/IHByb3BlcnR5RnVuY3Rpb25cbiAgICAgICAgICA6IHByb3BlcnR5Q29uc3RhbnQpKG5hbWUsIHZhbHVlKSlcbiAgICAgIDogdGhpcy5ub2RlKClbbmFtZV07XG59XG4iLCAiZnVuY3Rpb24gY2xhc3NBcnJheShzdHJpbmcpIHtcbiAgcmV0dXJuIHN0cmluZy50cmltKCkuc3BsaXQoL158XFxzKy8pO1xufVxuXG5mdW5jdGlvbiBjbGFzc0xpc3Qobm9kZSkge1xuICByZXR1cm4gbm9kZS5jbGFzc0xpc3QgfHwgbmV3IENsYXNzTGlzdChub2RlKTtcbn1cblxuZnVuY3Rpb24gQ2xhc3NMaXN0KG5vZGUpIHtcbiAgdGhpcy5fbm9kZSA9IG5vZGU7XG4gIHRoaXMuX25hbWVzID0gY2xhc3NBcnJheShub2RlLmdldEF0dHJpYnV0ZShcImNsYXNzXCIpIHx8IFwiXCIpO1xufVxuXG5DbGFzc0xpc3QucHJvdG90eXBlID0ge1xuICBhZGQ6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICB2YXIgaSA9IHRoaXMuX25hbWVzLmluZGV4T2YobmFtZSk7XG4gICAgaWYgKGkgPCAwKSB7XG4gICAgICB0aGlzLl9uYW1lcy5wdXNoKG5hbWUpO1xuICAgICAgdGhpcy5fbm9kZS5zZXRBdHRyaWJ1dGUoXCJjbGFzc1wiLCB0aGlzLl9uYW1lcy5qb2luKFwiIFwiKSk7XG4gICAgfVxuICB9LFxuICByZW1vdmU6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICB2YXIgaSA9IHRoaXMuX25hbWVzLmluZGV4T2YobmFtZSk7XG4gICAgaWYgKGkgPj0gMCkge1xuICAgICAgdGhpcy5fbmFtZXMuc3BsaWNlKGksIDEpO1xuICAgICAgdGhpcy5fbm9kZS5zZXRBdHRyaWJ1dGUoXCJjbGFzc1wiLCB0aGlzLl9uYW1lcy5qb2luKFwiIFwiKSk7XG4gICAgfVxuICB9LFxuICBjb250YWluczogZnVuY3Rpb24obmFtZSkge1xuICAgIHJldHVybiB0aGlzLl9uYW1lcy5pbmRleE9mKG5hbWUpID49IDA7XG4gIH1cbn07XG5cbmZ1bmN0aW9uIGNsYXNzZWRBZGQobm9kZSwgbmFtZXMpIHtcbiAgdmFyIGxpc3QgPSBjbGFzc0xpc3Qobm9kZSksIGkgPSAtMSwgbiA9IG5hbWVzLmxlbmd0aDtcbiAgd2hpbGUgKCsraSA8IG4pIGxpc3QuYWRkKG5hbWVzW2ldKTtcbn1cblxuZnVuY3Rpb24gY2xhc3NlZFJlbW92ZShub2RlLCBuYW1lcykge1xuICB2YXIgbGlzdCA9IGNsYXNzTGlzdChub2RlKSwgaSA9IC0xLCBuID0gbmFtZXMubGVuZ3RoO1xuICB3aGlsZSAoKytpIDwgbikgbGlzdC5yZW1vdmUobmFtZXNbaV0pO1xufVxuXG5mdW5jdGlvbiBjbGFzc2VkVHJ1ZShuYW1lcykge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgY2xhc3NlZEFkZCh0aGlzLCBuYW1lcyk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGNsYXNzZWRGYWxzZShuYW1lcykge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgY2xhc3NlZFJlbW92ZSh0aGlzLCBuYW1lcyk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGNsYXNzZWRGdW5jdGlvbihuYW1lcywgdmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgICh2YWx1ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpID8gY2xhc3NlZEFkZCA6IGNsYXNzZWRSZW1vdmUpKHRoaXMsIG5hbWVzKTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSwgdmFsdWUpIHtcbiAgdmFyIG5hbWVzID0gY2xhc3NBcnJheShuYW1lICsgXCJcIik7XG5cbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPCAyKSB7XG4gICAgdmFyIGxpc3QgPSBjbGFzc0xpc3QodGhpcy5ub2RlKCkpLCBpID0gLTEsIG4gPSBuYW1lcy5sZW5ndGg7XG4gICAgd2hpbGUgKCsraSA8IG4pIGlmICghbGlzdC5jb250YWlucyhuYW1lc1tpXSkpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIHJldHVybiB0aGlzLmVhY2goKHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgICA/IGNsYXNzZWRGdW5jdGlvbiA6IHZhbHVlXG4gICAgICA/IGNsYXNzZWRUcnVlXG4gICAgICA6IGNsYXNzZWRGYWxzZSkobmFtZXMsIHZhbHVlKSk7XG59XG4iLCAiZnVuY3Rpb24gdGV4dFJlbW92ZSgpIHtcbiAgdGhpcy50ZXh0Q29udGVudCA9IFwiXCI7XG59XG5cbmZ1bmN0aW9uIHRleHRDb25zdGFudCh2YWx1ZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy50ZXh0Q29udGVudCA9IHZhbHVlO1xuICB9O1xufVxuXG5mdW5jdGlvbiB0ZXh0RnVuY3Rpb24odmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciB2ID0gdmFsdWUuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICB0aGlzLnRleHRDb250ZW50ID0gdiA9PSBudWxsID8gXCJcIiA6IHY7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHZhbHVlKSB7XG4gIHJldHVybiBhcmd1bWVudHMubGVuZ3RoXG4gICAgICA/IHRoaXMuZWFjaCh2YWx1ZSA9PSBudWxsXG4gICAgICAgICAgPyB0ZXh0UmVtb3ZlIDogKHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgICAgICAgPyB0ZXh0RnVuY3Rpb25cbiAgICAgICAgICA6IHRleHRDb25zdGFudCkodmFsdWUpKVxuICAgICAgOiB0aGlzLm5vZGUoKS50ZXh0Q29udGVudDtcbn1cbiIsICJmdW5jdGlvbiBodG1sUmVtb3ZlKCkge1xuICB0aGlzLmlubmVySFRNTCA9IFwiXCI7XG59XG5cbmZ1bmN0aW9uIGh0bWxDb25zdGFudCh2YWx1ZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5pbm5lckhUTUwgPSB2YWx1ZTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gaHRtbEZ1bmN0aW9uKHZhbHVlKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgdiA9IHZhbHVlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgdGhpcy5pbm5lckhUTUwgPSB2ID09IG51bGwgPyBcIlwiIDogdjtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24odmFsdWUpIHtcbiAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGhcbiAgICAgID8gdGhpcy5lYWNoKHZhbHVlID09IG51bGxcbiAgICAgICAgICA/IGh0bWxSZW1vdmUgOiAodHlwZW9mIHZhbHVlID09PSBcImZ1bmN0aW9uXCJcbiAgICAgICAgICA/IGh0bWxGdW5jdGlvblxuICAgICAgICAgIDogaHRtbENvbnN0YW50KSh2YWx1ZSkpXG4gICAgICA6IHRoaXMubm9kZSgpLmlubmVySFRNTDtcbn1cbiIsICJmdW5jdGlvbiByYWlzZSgpIHtcbiAgaWYgKHRoaXMubmV4dFNpYmxpbmcpIHRoaXMucGFyZW50Tm9kZS5hcHBlbmRDaGlsZCh0aGlzKTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLmVhY2gocmFpc2UpO1xufVxuIiwgImZ1bmN0aW9uIGxvd2VyKCkge1xuICBpZiAodGhpcy5wcmV2aW91c1NpYmxpbmcpIHRoaXMucGFyZW50Tm9kZS5pbnNlcnRCZWZvcmUodGhpcywgdGhpcy5wYXJlbnROb2RlLmZpcnN0Q2hpbGQpO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuZWFjaChsb3dlcik7XG59XG4iLCAiaW1wb3J0IGNyZWF0b3IgZnJvbSBcIi4uL2NyZWF0b3IuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSkge1xuICB2YXIgY3JlYXRlID0gdHlwZW9mIG5hbWUgPT09IFwiZnVuY3Rpb25cIiA/IG5hbWUgOiBjcmVhdG9yKG5hbWUpO1xuICByZXR1cm4gdGhpcy5zZWxlY3QoZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuYXBwZW5kQ2hpbGQoY3JlYXRlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykpO1xuICB9KTtcbn1cbiIsICJpbXBvcnQgY3JlYXRvciBmcm9tIFwiLi4vY3JlYXRvci5qc1wiO1xuaW1wb3J0IHNlbGVjdG9yIGZyb20gXCIuLi9zZWxlY3Rvci5qc1wiO1xuXG5mdW5jdGlvbiBjb25zdGFudE51bGwoKSB7XG4gIHJldHVybiBudWxsO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihuYW1lLCBiZWZvcmUpIHtcbiAgdmFyIGNyZWF0ZSA9IHR5cGVvZiBuYW1lID09PSBcImZ1bmN0aW9uXCIgPyBuYW1lIDogY3JlYXRvcihuYW1lKSxcbiAgICAgIHNlbGVjdCA9IGJlZm9yZSA9PSBudWxsID8gY29uc3RhbnROdWxsIDogdHlwZW9mIGJlZm9yZSA9PT0gXCJmdW5jdGlvblwiID8gYmVmb3JlIDogc2VsZWN0b3IoYmVmb3JlKTtcbiAgcmV0dXJuIHRoaXMuc2VsZWN0KGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLmluc2VydEJlZm9yZShjcmVhdGUuYXBwbHkodGhpcywgYXJndW1lbnRzKSwgc2VsZWN0LmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgfHwgbnVsbCk7XG4gIH0pO1xufVxuIiwgImZ1bmN0aW9uIHJlbW92ZSgpIHtcbiAgdmFyIHBhcmVudCA9IHRoaXMucGFyZW50Tm9kZTtcbiAgaWYgKHBhcmVudCkgcGFyZW50LnJlbW92ZUNoaWxkKHRoaXMpO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuZWFjaChyZW1vdmUpO1xufVxuIiwgImZ1bmN0aW9uIHNlbGVjdGlvbl9jbG9uZVNoYWxsb3coKSB7XG4gIHZhciBjbG9uZSA9IHRoaXMuY2xvbmVOb2RlKGZhbHNlKSwgcGFyZW50ID0gdGhpcy5wYXJlbnROb2RlO1xuICByZXR1cm4gcGFyZW50ID8gcGFyZW50Lmluc2VydEJlZm9yZShjbG9uZSwgdGhpcy5uZXh0U2libGluZykgOiBjbG9uZTtcbn1cblxuZnVuY3Rpb24gc2VsZWN0aW9uX2Nsb25lRGVlcCgpIHtcbiAgdmFyIGNsb25lID0gdGhpcy5jbG9uZU5vZGUodHJ1ZSksIHBhcmVudCA9IHRoaXMucGFyZW50Tm9kZTtcbiAgcmV0dXJuIHBhcmVudCA/IHBhcmVudC5pbnNlcnRCZWZvcmUoY2xvbmUsIHRoaXMubmV4dFNpYmxpbmcpIDogY2xvbmU7XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGRlZXApIHtcbiAgcmV0dXJuIHRoaXMuc2VsZWN0KGRlZXAgPyBzZWxlY3Rpb25fY2xvbmVEZWVwIDogc2VsZWN0aW9uX2Nsb25lU2hhbGxvdyk7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24odmFsdWUpIHtcbiAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGhcbiAgICAgID8gdGhpcy5wcm9wZXJ0eShcIl9fZGF0YV9fXCIsIHZhbHVlKVxuICAgICAgOiB0aGlzLm5vZGUoKS5fX2RhdGFfXztcbn1cbiIsICJmdW5jdGlvbiBjb250ZXh0TGlzdGVuZXIobGlzdGVuZXIpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgbGlzdGVuZXIuY2FsbCh0aGlzLCBldmVudCwgdGhpcy5fX2RhdGFfXyk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIHBhcnNlVHlwZW5hbWVzKHR5cGVuYW1lcykge1xuICByZXR1cm4gdHlwZW5hbWVzLnRyaW0oKS5zcGxpdCgvXnxcXHMrLykubWFwKGZ1bmN0aW9uKHQpIHtcbiAgICB2YXIgbmFtZSA9IFwiXCIsIGkgPSB0LmluZGV4T2YoXCIuXCIpO1xuICAgIGlmIChpID49IDApIG5hbWUgPSB0LnNsaWNlKGkgKyAxKSwgdCA9IHQuc2xpY2UoMCwgaSk7XG4gICAgcmV0dXJuIHt0eXBlOiB0LCBuYW1lOiBuYW1lfTtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIG9uUmVtb3ZlKHR5cGVuYW1lKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgb24gPSB0aGlzLl9fb247XG4gICAgaWYgKCFvbikgcmV0dXJuO1xuICAgIGZvciAodmFyIGogPSAwLCBpID0gLTEsIG0gPSBvbi5sZW5ndGgsIG87IGogPCBtOyArK2opIHtcbiAgICAgIGlmIChvID0gb25bal0sICghdHlwZW5hbWUudHlwZSB8fCBvLnR5cGUgPT09IHR5cGVuYW1lLnR5cGUpICYmIG8ubmFtZSA9PT0gdHlwZW5hbWUubmFtZSkge1xuICAgICAgICB0aGlzLnJlbW92ZUV2ZW50TGlzdGVuZXIoby50eXBlLCBvLmxpc3RlbmVyLCBvLm9wdGlvbnMpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgb25bKytpXSA9IG87XG4gICAgICB9XG4gICAgfVxuICAgIGlmICgrK2kpIG9uLmxlbmd0aCA9IGk7XG4gICAgZWxzZSBkZWxldGUgdGhpcy5fX29uO1xuICB9O1xufVxuXG5mdW5jdGlvbiBvbkFkZCh0eXBlbmFtZSwgdmFsdWUsIG9wdGlvbnMpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBvbiA9IHRoaXMuX19vbiwgbywgbGlzdGVuZXIgPSBjb250ZXh0TGlzdGVuZXIodmFsdWUpO1xuICAgIGlmIChvbikgZm9yICh2YXIgaiA9IDAsIG0gPSBvbi5sZW5ndGg7IGogPCBtOyArK2opIHtcbiAgICAgIGlmICgobyA9IG9uW2pdKS50eXBlID09PSB0eXBlbmFtZS50eXBlICYmIG8ubmFtZSA9PT0gdHlwZW5hbWUubmFtZSkge1xuICAgICAgICB0aGlzLnJlbW92ZUV2ZW50TGlzdGVuZXIoby50eXBlLCBvLmxpc3RlbmVyLCBvLm9wdGlvbnMpO1xuICAgICAgICB0aGlzLmFkZEV2ZW50TGlzdGVuZXIoby50eXBlLCBvLmxpc3RlbmVyID0gbGlzdGVuZXIsIG8ub3B0aW9ucyA9IG9wdGlvbnMpO1xuICAgICAgICBvLnZhbHVlID0gdmFsdWU7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5hZGRFdmVudExpc3RlbmVyKHR5cGVuYW1lLnR5cGUsIGxpc3RlbmVyLCBvcHRpb25zKTtcbiAgICBvID0ge3R5cGU6IHR5cGVuYW1lLnR5cGUsIG5hbWU6IHR5cGVuYW1lLm5hbWUsIHZhbHVlOiB2YWx1ZSwgbGlzdGVuZXI6IGxpc3RlbmVyLCBvcHRpb25zOiBvcHRpb25zfTtcbiAgICBpZiAoIW9uKSB0aGlzLl9fb24gPSBbb107XG4gICAgZWxzZSBvbi5wdXNoKG8pO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih0eXBlbmFtZSwgdmFsdWUsIG9wdGlvbnMpIHtcbiAgdmFyIHR5cGVuYW1lcyA9IHBhcnNlVHlwZW5hbWVzKHR5cGVuYW1lICsgXCJcIiksIGksIG4gPSB0eXBlbmFtZXMubGVuZ3RoLCB0O1xuXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoIDwgMikge1xuICAgIHZhciBvbiA9IHRoaXMubm9kZSgpLl9fb247XG4gICAgaWYgKG9uKSBmb3IgKHZhciBqID0gMCwgbSA9IG9uLmxlbmd0aCwgbzsgaiA8IG07ICsraikge1xuICAgICAgZm9yIChpID0gMCwgbyA9IG9uW2pdOyBpIDwgbjsgKytpKSB7XG4gICAgICAgIGlmICgodCA9IHR5cGVuYW1lc1tpXSkudHlwZSA9PT0gby50eXBlICYmIHQubmFtZSA9PT0gby5uYW1lKSB7XG4gICAgICAgICAgcmV0dXJuIG8udmFsdWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgb24gPSB2YWx1ZSA/IG9uQWRkIDogb25SZW1vdmU7XG4gIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHRoaXMuZWFjaChvbih0eXBlbmFtZXNbaV0sIHZhbHVlLCBvcHRpb25zKSk7XG4gIHJldHVybiB0aGlzO1xufVxuIiwgImltcG9ydCBkZWZhdWx0VmlldyBmcm9tIFwiLi4vd2luZG93LmpzXCI7XG5cbmZ1bmN0aW9uIGRpc3BhdGNoRXZlbnQobm9kZSwgdHlwZSwgcGFyYW1zKSB7XG4gIHZhciB3aW5kb3cgPSBkZWZhdWx0Vmlldyhub2RlKSxcbiAgICAgIGV2ZW50ID0gd2luZG93LkN1c3RvbUV2ZW50O1xuXG4gIGlmICh0eXBlb2YgZXZlbnQgPT09IFwiZnVuY3Rpb25cIikge1xuICAgIGV2ZW50ID0gbmV3IGV2ZW50KHR5cGUsIHBhcmFtcyk7XG4gIH0gZWxzZSB7XG4gICAgZXZlbnQgPSB3aW5kb3cuZG9jdW1lbnQuY3JlYXRlRXZlbnQoXCJFdmVudFwiKTtcbiAgICBpZiAocGFyYW1zKSBldmVudC5pbml0RXZlbnQodHlwZSwgcGFyYW1zLmJ1YmJsZXMsIHBhcmFtcy5jYW5jZWxhYmxlKSwgZXZlbnQuZGV0YWlsID0gcGFyYW1zLmRldGFpbDtcbiAgICBlbHNlIGV2ZW50LmluaXRFdmVudCh0eXBlLCBmYWxzZSwgZmFsc2UpO1xuICB9XG5cbiAgbm9kZS5kaXNwYXRjaEV2ZW50KGV2ZW50KTtcbn1cblxuZnVuY3Rpb24gZGlzcGF0Y2hDb25zdGFudCh0eXBlLCBwYXJhbXMpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBkaXNwYXRjaEV2ZW50KHRoaXMsIHR5cGUsIHBhcmFtcyk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGRpc3BhdGNoRnVuY3Rpb24odHlwZSwgcGFyYW1zKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gZGlzcGF0Y2hFdmVudCh0aGlzLCB0eXBlLCBwYXJhbXMuYXBwbHkodGhpcywgYXJndW1lbnRzKSk7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHR5cGUsIHBhcmFtcykge1xuICByZXR1cm4gdGhpcy5lYWNoKCh0eXBlb2YgcGFyYW1zID09PSBcImZ1bmN0aW9uXCJcbiAgICAgID8gZGlzcGF0Y2hGdW5jdGlvblxuICAgICAgOiBkaXNwYXRjaENvbnN0YW50KSh0eXBlLCBwYXJhbXMpKTtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbiooKSB7XG4gIGZvciAodmFyIGdyb3VwcyA9IHRoaXMuX2dyb3VwcywgaiA9IDAsIG0gPSBncm91cHMubGVuZ3RoOyBqIDwgbTsgKytqKSB7XG4gICAgZm9yICh2YXIgZ3JvdXAgPSBncm91cHNbal0sIGkgPSAwLCBuID0gZ3JvdXAubGVuZ3RoLCBub2RlOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAobm9kZSA9IGdyb3VwW2ldKSB5aWVsZCBub2RlO1xuICAgIH1cbiAgfVxufVxuIiwgImltcG9ydCBzZWxlY3Rpb25fc2VsZWN0IGZyb20gXCIuL3NlbGVjdC5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9zZWxlY3RBbGwgZnJvbSBcIi4vc2VsZWN0QWxsLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX3NlbGVjdENoaWxkIGZyb20gXCIuL3NlbGVjdENoaWxkLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX3NlbGVjdENoaWxkcmVuIGZyb20gXCIuL3NlbGVjdENoaWxkcmVuLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2ZpbHRlciBmcm9tIFwiLi9maWx0ZXIuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fZGF0YSBmcm9tIFwiLi9kYXRhLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2VudGVyIGZyb20gXCIuL2VudGVyLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2V4aXQgZnJvbSBcIi4vZXhpdC5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9qb2luIGZyb20gXCIuL2pvaW4uanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fbWVyZ2UgZnJvbSBcIi4vbWVyZ2UuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fb3JkZXIgZnJvbSBcIi4vb3JkZXIuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fc29ydCBmcm9tIFwiLi9zb3J0LmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2NhbGwgZnJvbSBcIi4vY2FsbC5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9ub2RlcyBmcm9tIFwiLi9ub2Rlcy5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9ub2RlIGZyb20gXCIuL25vZGUuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fc2l6ZSBmcm9tIFwiLi9zaXplLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2VtcHR5IGZyb20gXCIuL2VtcHR5LmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2VhY2ggZnJvbSBcIi4vZWFjaC5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9hdHRyIGZyb20gXCIuL2F0dHIuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fc3R5bGUgZnJvbSBcIi4vc3R5bGUuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fcHJvcGVydHkgZnJvbSBcIi4vcHJvcGVydHkuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fY2xhc3NlZCBmcm9tIFwiLi9jbGFzc2VkLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX3RleHQgZnJvbSBcIi4vdGV4dC5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9odG1sIGZyb20gXCIuL2h0bWwuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fcmFpc2UgZnJvbSBcIi4vcmFpc2UuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fbG93ZXIgZnJvbSBcIi4vbG93ZXIuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fYXBwZW5kIGZyb20gXCIuL2FwcGVuZC5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9pbnNlcnQgZnJvbSBcIi4vaW5zZXJ0LmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX3JlbW92ZSBmcm9tIFwiLi9yZW1vdmUuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fY2xvbmUgZnJvbSBcIi4vY2xvbmUuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fZGF0dW0gZnJvbSBcIi4vZGF0dW0uanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fb24gZnJvbSBcIi4vb24uanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fZGlzcGF0Y2ggZnJvbSBcIi4vZGlzcGF0Y2guanNcIjtcbmltcG9ydCBzZWxlY3Rpb25faXRlcmF0b3IgZnJvbSBcIi4vaXRlcmF0b3IuanNcIjtcblxuZXhwb3J0IHZhciByb290ID0gW251bGxdO1xuXG5leHBvcnQgZnVuY3Rpb24gU2VsZWN0aW9uKGdyb3VwcywgcGFyZW50cykge1xuICB0aGlzLl9ncm91cHMgPSBncm91cHM7XG4gIHRoaXMuX3BhcmVudHMgPSBwYXJlbnRzO1xufVxuXG5mdW5jdGlvbiBzZWxlY3Rpb24oKSB7XG4gIHJldHVybiBuZXcgU2VsZWN0aW9uKFtbZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50XV0sIHJvb3QpO1xufVxuXG5mdW5jdGlvbiBzZWxlY3Rpb25fc2VsZWN0aW9uKCkge1xuICByZXR1cm4gdGhpcztcbn1cblxuU2VsZWN0aW9uLnByb3RvdHlwZSA9IHNlbGVjdGlvbi5wcm90b3R5cGUgPSB7XG4gIGNvbnN0cnVjdG9yOiBTZWxlY3Rpb24sXG4gIHNlbGVjdDogc2VsZWN0aW9uX3NlbGVjdCxcbiAgc2VsZWN0QWxsOiBzZWxlY3Rpb25fc2VsZWN0QWxsLFxuICBzZWxlY3RDaGlsZDogc2VsZWN0aW9uX3NlbGVjdENoaWxkLFxuICBzZWxlY3RDaGlsZHJlbjogc2VsZWN0aW9uX3NlbGVjdENoaWxkcmVuLFxuICBmaWx0ZXI6IHNlbGVjdGlvbl9maWx0ZXIsXG4gIGRhdGE6IHNlbGVjdGlvbl9kYXRhLFxuICBlbnRlcjogc2VsZWN0aW9uX2VudGVyLFxuICBleGl0OiBzZWxlY3Rpb25fZXhpdCxcbiAgam9pbjogc2VsZWN0aW9uX2pvaW4sXG4gIG1lcmdlOiBzZWxlY3Rpb25fbWVyZ2UsXG4gIHNlbGVjdGlvbjogc2VsZWN0aW9uX3NlbGVjdGlvbixcbiAgb3JkZXI6IHNlbGVjdGlvbl9vcmRlcixcbiAgc29ydDogc2VsZWN0aW9uX3NvcnQsXG4gIGNhbGw6IHNlbGVjdGlvbl9jYWxsLFxuICBub2Rlczogc2VsZWN0aW9uX25vZGVzLFxuICBub2RlOiBzZWxlY3Rpb25fbm9kZSxcbiAgc2l6ZTogc2VsZWN0aW9uX3NpemUsXG4gIGVtcHR5OiBzZWxlY3Rpb25fZW1wdHksXG4gIGVhY2g6IHNlbGVjdGlvbl9lYWNoLFxuICBhdHRyOiBzZWxlY3Rpb25fYXR0cixcbiAgc3R5bGU6IHNlbGVjdGlvbl9zdHlsZSxcbiAgcHJvcGVydHk6IHNlbGVjdGlvbl9wcm9wZXJ0eSxcbiAgY2xhc3NlZDogc2VsZWN0aW9uX2NsYXNzZWQsXG4gIHRleHQ6IHNlbGVjdGlvbl90ZXh0LFxuICBodG1sOiBzZWxlY3Rpb25faHRtbCxcbiAgcmFpc2U6IHNlbGVjdGlvbl9yYWlzZSxcbiAgbG93ZXI6IHNlbGVjdGlvbl9sb3dlcixcbiAgYXBwZW5kOiBzZWxlY3Rpb25fYXBwZW5kLFxuICBpbnNlcnQ6IHNlbGVjdGlvbl9pbnNlcnQsXG4gIHJlbW92ZTogc2VsZWN0aW9uX3JlbW92ZSxcbiAgY2xvbmU6IHNlbGVjdGlvbl9jbG9uZSxcbiAgZGF0dW06IHNlbGVjdGlvbl9kYXR1bSxcbiAgb246IHNlbGVjdGlvbl9vbixcbiAgZGlzcGF0Y2g6IHNlbGVjdGlvbl9kaXNwYXRjaCxcbiAgW1N5bWJvbC5pdGVyYXRvcl06IHNlbGVjdGlvbl9pdGVyYXRvclxufTtcblxuZXhwb3J0IGRlZmF1bHQgc2VsZWN0aW9uO1xuIiwgImltcG9ydCB7U2VsZWN0aW9uLCByb290fSBmcm9tIFwiLi9zZWxlY3Rpb24vaW5kZXguanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oc2VsZWN0b3IpIHtcbiAgcmV0dXJuIHR5cGVvZiBzZWxlY3RvciA9PT0gXCJzdHJpbmdcIlxuICAgICAgPyBuZXcgU2VsZWN0aW9uKFtbZG9jdW1lbnQucXVlcnlTZWxlY3RvcihzZWxlY3RvcildXSwgW2RvY3VtZW50LmRvY3VtZW50RWxlbWVudF0pXG4gICAgICA6IG5ldyBTZWxlY3Rpb24oW1tzZWxlY3Rvcl1dLCByb290KTtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbihldmVudCkge1xuICBsZXQgc291cmNlRXZlbnQ7XG4gIHdoaWxlIChzb3VyY2VFdmVudCA9IGV2ZW50LnNvdXJjZUV2ZW50KSBldmVudCA9IHNvdXJjZUV2ZW50O1xuICByZXR1cm4gZXZlbnQ7XG59XG4iLCAiaW1wb3J0IHNvdXJjZUV2ZW50IGZyb20gXCIuL3NvdXJjZUV2ZW50LmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGV2ZW50LCBub2RlKSB7XG4gIGV2ZW50ID0gc291cmNlRXZlbnQoZXZlbnQpO1xuICBpZiAobm9kZSA9PT0gdW5kZWZpbmVkKSBub2RlID0gZXZlbnQuY3VycmVudFRhcmdldDtcbiAgaWYgKG5vZGUpIHtcbiAgICB2YXIgc3ZnID0gbm9kZS5vd25lclNWR0VsZW1lbnQgfHwgbm9kZTtcbiAgICBpZiAoc3ZnLmNyZWF0ZVNWR1BvaW50KSB7XG4gICAgICB2YXIgcG9pbnQgPSBzdmcuY3JlYXRlU1ZHUG9pbnQoKTtcbiAgICAgIHBvaW50LnggPSBldmVudC5jbGllbnRYLCBwb2ludC55ID0gZXZlbnQuY2xpZW50WTtcbiAgICAgIHBvaW50ID0gcG9pbnQubWF0cml4VHJhbnNmb3JtKG5vZGUuZ2V0U2NyZWVuQ1RNKCkuaW52ZXJzZSgpKTtcbiAgICAgIHJldHVybiBbcG9pbnQueCwgcG9pbnQueV07XG4gICAgfVxuICAgIGlmIChub2RlLmdldEJvdW5kaW5nQ2xpZW50UmVjdCkge1xuICAgICAgdmFyIHJlY3QgPSBub2RlLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgcmV0dXJuIFtldmVudC5jbGllbnRYIC0gcmVjdC5sZWZ0IC0gbm9kZS5jbGllbnRMZWZ0LCBldmVudC5jbGllbnRZIC0gcmVjdC50b3AgLSBub2RlLmNsaWVudFRvcF07XG4gICAgfVxuICB9XG4gIHJldHVybiBbZXZlbnQucGFnZVgsIGV2ZW50LnBhZ2VZXTtcbn1cbiIsICIvLyBUaGVzZSBhcmUgdHlwaWNhbGx5IHVzZWQgaW4gY29uanVuY3Rpb24gd2l0aCBub2V2ZW50IHRvIGVuc3VyZSB0aGF0IHdlIGNhblxuLy8gcHJldmVudERlZmF1bHQgb24gdGhlIGV2ZW50LlxuZXhwb3J0IGNvbnN0IG5vbnBhc3NpdmUgPSB7cGFzc2l2ZTogZmFsc2V9O1xuZXhwb3J0IGNvbnN0IG5vbnBhc3NpdmVjYXB0dXJlID0ge2NhcHR1cmU6IHRydWUsIHBhc3NpdmU6IGZhbHNlfTtcblxuZXhwb3J0IGZ1bmN0aW9uIG5vcHJvcGFnYXRpb24oZXZlbnQpIHtcbiAgZXZlbnQuc3RvcEltbWVkaWF0ZVByb3BhZ2F0aW9uKCk7XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGV2ZW50KSB7XG4gIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gIGV2ZW50LnN0b3BJbW1lZGlhdGVQcm9wYWdhdGlvbigpO1xufVxuIiwgImltcG9ydCB7c2VsZWN0fSBmcm9tIFwiZDMtc2VsZWN0aW9uXCI7XG5pbXBvcnQgbm9ldmVudCwge25vbnBhc3NpdmVjYXB0dXJlfSBmcm9tIFwiLi9ub2V2ZW50LmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHZpZXcpIHtcbiAgdmFyIHJvb3QgPSB2aWV3LmRvY3VtZW50LmRvY3VtZW50RWxlbWVudCxcbiAgICAgIHNlbGVjdGlvbiA9IHNlbGVjdCh2aWV3KS5vbihcImRyYWdzdGFydC5kcmFnXCIsIG5vZXZlbnQsIG5vbnBhc3NpdmVjYXB0dXJlKTtcbiAgaWYgKFwib25zZWxlY3RzdGFydFwiIGluIHJvb3QpIHtcbiAgICBzZWxlY3Rpb24ub24oXCJzZWxlY3RzdGFydC5kcmFnXCIsIG5vZXZlbnQsIG5vbnBhc3NpdmVjYXB0dXJlKTtcbiAgfSBlbHNlIHtcbiAgICByb290Ll9fbm9zZWxlY3QgPSByb290LnN0eWxlLk1velVzZXJTZWxlY3Q7XG4gICAgcm9vdC5zdHlsZS5Nb3pVc2VyU2VsZWN0ID0gXCJub25lXCI7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHllc2RyYWcodmlldywgbm9jbGljaykge1xuICB2YXIgcm9vdCA9IHZpZXcuZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LFxuICAgICAgc2VsZWN0aW9uID0gc2VsZWN0KHZpZXcpLm9uKFwiZHJhZ3N0YXJ0LmRyYWdcIiwgbnVsbCk7XG4gIGlmIChub2NsaWNrKSB7XG4gICAgc2VsZWN0aW9uLm9uKFwiY2xpY2suZHJhZ1wiLCBub2V2ZW50LCBub25wYXNzaXZlY2FwdHVyZSk7XG4gICAgc2V0VGltZW91dChmdW5jdGlvbigpIHsgc2VsZWN0aW9uLm9uKFwiY2xpY2suZHJhZ1wiLCBudWxsKTsgfSwgMCk7XG4gIH1cbiAgaWYgKFwib25zZWxlY3RzdGFydFwiIGluIHJvb3QpIHtcbiAgICBzZWxlY3Rpb24ub24oXCJzZWxlY3RzdGFydC5kcmFnXCIsIG51bGwpO1xuICB9IGVsc2Uge1xuICAgIHJvb3Quc3R5bGUuTW96VXNlclNlbGVjdCA9IHJvb3QuX19ub3NlbGVjdDtcbiAgICBkZWxldGUgcm9vdC5fX25vc2VsZWN0O1xuICB9XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgeCA9PiAoKSA9PiB4O1xuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIERyYWdFdmVudCh0eXBlLCB7XG4gIHNvdXJjZUV2ZW50LFxuICBzdWJqZWN0LFxuICB0YXJnZXQsXG4gIGlkZW50aWZpZXIsXG4gIGFjdGl2ZSxcbiAgeCwgeSwgZHgsIGR5LFxuICBkaXNwYXRjaFxufSkge1xuICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyh0aGlzLCB7XG4gICAgdHlwZToge3ZhbHVlOiB0eXBlLCBlbnVtZXJhYmxlOiB0cnVlLCBjb25maWd1cmFibGU6IHRydWV9LFxuICAgIHNvdXJjZUV2ZW50OiB7dmFsdWU6IHNvdXJjZUV2ZW50LCBlbnVtZXJhYmxlOiB0cnVlLCBjb25maWd1cmFibGU6IHRydWV9LFxuICAgIHN1YmplY3Q6IHt2YWx1ZTogc3ViamVjdCwgZW51bWVyYWJsZTogdHJ1ZSwgY29uZmlndXJhYmxlOiB0cnVlfSxcbiAgICB0YXJnZXQ6IHt2YWx1ZTogdGFyZ2V0LCBlbnVtZXJhYmxlOiB0cnVlLCBjb25maWd1cmFibGU6IHRydWV9LFxuICAgIGlkZW50aWZpZXI6IHt2YWx1ZTogaWRlbnRpZmllciwgZW51bWVyYWJsZTogdHJ1ZSwgY29uZmlndXJhYmxlOiB0cnVlfSxcbiAgICBhY3RpdmU6IHt2YWx1ZTogYWN0aXZlLCBlbnVtZXJhYmxlOiB0cnVlLCBjb25maWd1cmFibGU6IHRydWV9LFxuICAgIHg6IHt2YWx1ZTogeCwgZW51bWVyYWJsZTogdHJ1ZSwgY29uZmlndXJhYmxlOiB0cnVlfSxcbiAgICB5OiB7dmFsdWU6IHksIGVudW1lcmFibGU6IHRydWUsIGNvbmZpZ3VyYWJsZTogdHJ1ZX0sXG4gICAgZHg6IHt2YWx1ZTogZHgsIGVudW1lcmFibGU6IHRydWUsIGNvbmZpZ3VyYWJsZTogdHJ1ZX0sXG4gICAgZHk6IHt2YWx1ZTogZHksIGVudW1lcmFibGU6IHRydWUsIGNvbmZpZ3VyYWJsZTogdHJ1ZX0sXG4gICAgXzoge3ZhbHVlOiBkaXNwYXRjaH1cbiAgfSk7XG59XG5cbkRyYWdFdmVudC5wcm90b3R5cGUub24gPSBmdW5jdGlvbigpIHtcbiAgdmFyIHZhbHVlID0gdGhpcy5fLm9uLmFwcGx5KHRoaXMuXywgYXJndW1lbnRzKTtcbiAgcmV0dXJuIHZhbHVlID09PSB0aGlzLl8gPyB0aGlzIDogdmFsdWU7XG59O1xuIiwgImltcG9ydCB7ZGlzcGF0Y2h9IGZyb20gXCJkMy1kaXNwYXRjaFwiO1xuaW1wb3J0IHtzZWxlY3QsIHBvaW50ZXJ9IGZyb20gXCJkMy1zZWxlY3Rpb25cIjtcbmltcG9ydCBub2RyYWcsIHt5ZXNkcmFnfSBmcm9tIFwiLi9ub2RyYWcuanNcIjtcbmltcG9ydCBub2V2ZW50LCB7bm9ucGFzc2l2ZSwgbm9ucGFzc2l2ZWNhcHR1cmUsIG5vcHJvcGFnYXRpb259IGZyb20gXCIuL25vZXZlbnQuanNcIjtcbmltcG9ydCBjb25zdGFudCBmcm9tIFwiLi9jb25zdGFudC5qc1wiO1xuaW1wb3J0IERyYWdFdmVudCBmcm9tIFwiLi9ldmVudC5qc1wiO1xuXG4vLyBJZ25vcmUgcmlnaHQtY2xpY2ssIHNpbmNlIHRoYXQgc2hvdWxkIG9wZW4gdGhlIGNvbnRleHQgbWVudS5cbmZ1bmN0aW9uIGRlZmF1bHRGaWx0ZXIoZXZlbnQpIHtcbiAgcmV0dXJuICFldmVudC5jdHJsS2V5ICYmICFldmVudC5idXR0b247XG59XG5cbmZ1bmN0aW9uIGRlZmF1bHRDb250YWluZXIoKSB7XG4gIHJldHVybiB0aGlzLnBhcmVudE5vZGU7XG59XG5cbmZ1bmN0aW9uIGRlZmF1bHRTdWJqZWN0KGV2ZW50LCBkKSB7XG4gIHJldHVybiBkID09IG51bGwgPyB7eDogZXZlbnQueCwgeTogZXZlbnQueX0gOiBkO1xufVxuXG5mdW5jdGlvbiBkZWZhdWx0VG91Y2hhYmxlKCkge1xuICByZXR1cm4gbmF2aWdhdG9yLm1heFRvdWNoUG9pbnRzIHx8IChcIm9udG91Y2hzdGFydFwiIGluIHRoaXMpO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgdmFyIGZpbHRlciA9IGRlZmF1bHRGaWx0ZXIsXG4gICAgICBjb250YWluZXIgPSBkZWZhdWx0Q29udGFpbmVyLFxuICAgICAgc3ViamVjdCA9IGRlZmF1bHRTdWJqZWN0LFxuICAgICAgdG91Y2hhYmxlID0gZGVmYXVsdFRvdWNoYWJsZSxcbiAgICAgIGdlc3R1cmVzID0ge30sXG4gICAgICBsaXN0ZW5lcnMgPSBkaXNwYXRjaChcInN0YXJ0XCIsIFwiZHJhZ1wiLCBcImVuZFwiKSxcbiAgICAgIGFjdGl2ZSA9IDAsXG4gICAgICBtb3VzZWRvd254LFxuICAgICAgbW91c2Vkb3dueSxcbiAgICAgIG1vdXNlbW92aW5nLFxuICAgICAgdG91Y2hlbmRpbmcsXG4gICAgICBjbGlja0Rpc3RhbmNlMiA9IDA7XG5cbiAgZnVuY3Rpb24gZHJhZyhzZWxlY3Rpb24pIHtcbiAgICBzZWxlY3Rpb25cbiAgICAgICAgLm9uKFwibW91c2Vkb3duLmRyYWdcIiwgbW91c2Vkb3duZWQpXG4gICAgICAuZmlsdGVyKHRvdWNoYWJsZSlcbiAgICAgICAgLm9uKFwidG91Y2hzdGFydC5kcmFnXCIsIHRvdWNoc3RhcnRlZClcbiAgICAgICAgLm9uKFwidG91Y2htb3ZlLmRyYWdcIiwgdG91Y2htb3ZlZCwgbm9ucGFzc2l2ZSlcbiAgICAgICAgLm9uKFwidG91Y2hlbmQuZHJhZyB0b3VjaGNhbmNlbC5kcmFnXCIsIHRvdWNoZW5kZWQpXG4gICAgICAgIC5zdHlsZShcInRvdWNoLWFjdGlvblwiLCBcIm5vbmVcIilcbiAgICAgICAgLnN0eWxlKFwiLXdlYmtpdC10YXAtaGlnaGxpZ2h0LWNvbG9yXCIsIFwicmdiYSgwLDAsMCwwKVwiKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIG1vdXNlZG93bmVkKGV2ZW50LCBkKSB7XG4gICAgaWYgKHRvdWNoZW5kaW5nIHx8ICFmaWx0ZXIuY2FsbCh0aGlzLCBldmVudCwgZCkpIHJldHVybjtcbiAgICB2YXIgZ2VzdHVyZSA9IGJlZm9yZXN0YXJ0KHRoaXMsIGNvbnRhaW5lci5jYWxsKHRoaXMsIGV2ZW50LCBkKSwgZXZlbnQsIGQsIFwibW91c2VcIik7XG4gICAgaWYgKCFnZXN0dXJlKSByZXR1cm47XG4gICAgc2VsZWN0KGV2ZW50LnZpZXcpXG4gICAgICAub24oXCJtb3VzZW1vdmUuZHJhZ1wiLCBtb3VzZW1vdmVkLCBub25wYXNzaXZlY2FwdHVyZSlcbiAgICAgIC5vbihcIm1vdXNldXAuZHJhZ1wiLCBtb3VzZXVwcGVkLCBub25wYXNzaXZlY2FwdHVyZSk7XG4gICAgbm9kcmFnKGV2ZW50LnZpZXcpO1xuICAgIG5vcHJvcGFnYXRpb24oZXZlbnQpO1xuICAgIG1vdXNlbW92aW5nID0gZmFsc2U7XG4gICAgbW91c2Vkb3dueCA9IGV2ZW50LmNsaWVudFg7XG4gICAgbW91c2Vkb3dueSA9IGV2ZW50LmNsaWVudFk7XG4gICAgZ2VzdHVyZShcInN0YXJ0XCIsIGV2ZW50KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIG1vdXNlbW92ZWQoZXZlbnQpIHtcbiAgICBub2V2ZW50KGV2ZW50KTtcbiAgICBpZiAoIW1vdXNlbW92aW5nKSB7XG4gICAgICB2YXIgZHggPSBldmVudC5jbGllbnRYIC0gbW91c2Vkb3dueCwgZHkgPSBldmVudC5jbGllbnRZIC0gbW91c2Vkb3dueTtcbiAgICAgIG1vdXNlbW92aW5nID0gZHggKiBkeCArIGR5ICogZHkgPiBjbGlja0Rpc3RhbmNlMjtcbiAgICB9XG4gICAgZ2VzdHVyZXMubW91c2UoXCJkcmFnXCIsIGV2ZW50KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIG1vdXNldXBwZWQoZXZlbnQpIHtcbiAgICBzZWxlY3QoZXZlbnQudmlldykub24oXCJtb3VzZW1vdmUuZHJhZyBtb3VzZXVwLmRyYWdcIiwgbnVsbCk7XG4gICAgeWVzZHJhZyhldmVudC52aWV3LCBtb3VzZW1vdmluZyk7XG4gICAgbm9ldmVudChldmVudCk7XG4gICAgZ2VzdHVyZXMubW91c2UoXCJlbmRcIiwgZXZlbnQpO1xuICB9XG5cbiAgZnVuY3Rpb24gdG91Y2hzdGFydGVkKGV2ZW50LCBkKSB7XG4gICAgaWYgKCFmaWx0ZXIuY2FsbCh0aGlzLCBldmVudCwgZCkpIHJldHVybjtcbiAgICB2YXIgdG91Y2hlcyA9IGV2ZW50LmNoYW5nZWRUb3VjaGVzLFxuICAgICAgICBjID0gY29udGFpbmVyLmNhbGwodGhpcywgZXZlbnQsIGQpLFxuICAgICAgICBuID0gdG91Y2hlcy5sZW5ndGgsIGksIGdlc3R1cmU7XG5cbiAgICBmb3IgKGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAoZ2VzdHVyZSA9IGJlZm9yZXN0YXJ0KHRoaXMsIGMsIGV2ZW50LCBkLCB0b3VjaGVzW2ldLmlkZW50aWZpZXIsIHRvdWNoZXNbaV0pKSB7XG4gICAgICAgIG5vcHJvcGFnYXRpb24oZXZlbnQpO1xuICAgICAgICBnZXN0dXJlKFwic3RhcnRcIiwgZXZlbnQsIHRvdWNoZXNbaV0pO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHRvdWNobW92ZWQoZXZlbnQpIHtcbiAgICB2YXIgdG91Y2hlcyA9IGV2ZW50LmNoYW5nZWRUb3VjaGVzLFxuICAgICAgICBuID0gdG91Y2hlcy5sZW5ndGgsIGksIGdlc3R1cmU7XG5cbiAgICBmb3IgKGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAoZ2VzdHVyZSA9IGdlc3R1cmVzW3RvdWNoZXNbaV0uaWRlbnRpZmllcl0pIHtcbiAgICAgICAgbm9ldmVudChldmVudCk7XG4gICAgICAgIGdlc3R1cmUoXCJkcmFnXCIsIGV2ZW50LCB0b3VjaGVzW2ldKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiB0b3VjaGVuZGVkKGV2ZW50KSB7XG4gICAgdmFyIHRvdWNoZXMgPSBldmVudC5jaGFuZ2VkVG91Y2hlcyxcbiAgICAgICAgbiA9IHRvdWNoZXMubGVuZ3RoLCBpLCBnZXN0dXJlO1xuXG4gICAgaWYgKHRvdWNoZW5kaW5nKSBjbGVhclRpbWVvdXQodG91Y2hlbmRpbmcpO1xuICAgIHRvdWNoZW5kaW5nID0gc2V0VGltZW91dChmdW5jdGlvbigpIHsgdG91Y2hlbmRpbmcgPSBudWxsOyB9LCA1MDApOyAvLyBHaG9zdCBjbGlja3MgYXJlIGRlbGF5ZWQhXG4gICAgZm9yIChpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgaWYgKGdlc3R1cmUgPSBnZXN0dXJlc1t0b3VjaGVzW2ldLmlkZW50aWZpZXJdKSB7XG4gICAgICAgIG5vcHJvcGFnYXRpb24oZXZlbnQpO1xuICAgICAgICBnZXN0dXJlKFwiZW5kXCIsIGV2ZW50LCB0b3VjaGVzW2ldKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBiZWZvcmVzdGFydCh0aGF0LCBjb250YWluZXIsIGV2ZW50LCBkLCBpZGVudGlmaWVyLCB0b3VjaCkge1xuICAgIHZhciBkaXNwYXRjaCA9IGxpc3RlbmVycy5jb3B5KCksXG4gICAgICAgIHAgPSBwb2ludGVyKHRvdWNoIHx8IGV2ZW50LCBjb250YWluZXIpLCBkeCwgZHksXG4gICAgICAgIHM7XG5cbiAgICBpZiAoKHMgPSBzdWJqZWN0LmNhbGwodGhhdCwgbmV3IERyYWdFdmVudChcImJlZm9yZXN0YXJ0XCIsIHtcbiAgICAgICAgc291cmNlRXZlbnQ6IGV2ZW50LFxuICAgICAgICB0YXJnZXQ6IGRyYWcsXG4gICAgICAgIGlkZW50aWZpZXIsXG4gICAgICAgIGFjdGl2ZSxcbiAgICAgICAgeDogcFswXSxcbiAgICAgICAgeTogcFsxXSxcbiAgICAgICAgZHg6IDAsXG4gICAgICAgIGR5OiAwLFxuICAgICAgICBkaXNwYXRjaFxuICAgICAgfSksIGQpKSA9PSBudWxsKSByZXR1cm47XG5cbiAgICBkeCA9IHMueCAtIHBbMF0gfHwgMDtcbiAgICBkeSA9IHMueSAtIHBbMV0gfHwgMDtcblxuICAgIHJldHVybiBmdW5jdGlvbiBnZXN0dXJlKHR5cGUsIGV2ZW50LCB0b3VjaCkge1xuICAgICAgdmFyIHAwID0gcCwgbjtcbiAgICAgIHN3aXRjaCAodHlwZSkge1xuICAgICAgICBjYXNlIFwic3RhcnRcIjogZ2VzdHVyZXNbaWRlbnRpZmllcl0gPSBnZXN0dXJlLCBuID0gYWN0aXZlKys7IGJyZWFrO1xuICAgICAgICBjYXNlIFwiZW5kXCI6IGRlbGV0ZSBnZXN0dXJlc1tpZGVudGlmaWVyXSwgLS1hY3RpdmU7IC8vIGZhbGxzIHRocm91Z2hcbiAgICAgICAgY2FzZSBcImRyYWdcIjogcCA9IHBvaW50ZXIodG91Y2ggfHwgZXZlbnQsIGNvbnRhaW5lciksIG4gPSBhY3RpdmU7IGJyZWFrO1xuICAgICAgfVxuICAgICAgZGlzcGF0Y2guY2FsbChcbiAgICAgICAgdHlwZSxcbiAgICAgICAgdGhhdCxcbiAgICAgICAgbmV3IERyYWdFdmVudCh0eXBlLCB7XG4gICAgICAgICAgc291cmNlRXZlbnQ6IGV2ZW50LFxuICAgICAgICAgIHN1YmplY3Q6IHMsXG4gICAgICAgICAgdGFyZ2V0OiBkcmFnLFxuICAgICAgICAgIGlkZW50aWZpZXIsXG4gICAgICAgICAgYWN0aXZlOiBuLFxuICAgICAgICAgIHg6IHBbMF0gKyBkeCxcbiAgICAgICAgICB5OiBwWzFdICsgZHksXG4gICAgICAgICAgZHg6IHBbMF0gLSBwMFswXSxcbiAgICAgICAgICBkeTogcFsxXSAtIHAwWzFdLFxuICAgICAgICAgIGRpc3BhdGNoXG4gICAgICAgIH0pLFxuICAgICAgICBkXG4gICAgICApO1xuICAgIH07XG4gIH1cblxuICBkcmFnLmZpbHRlciA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChmaWx0ZXIgPSB0eXBlb2YgXyA9PT0gXCJmdW5jdGlvblwiID8gXyA6IGNvbnN0YW50KCEhXyksIGRyYWcpIDogZmlsdGVyO1xuICB9O1xuXG4gIGRyYWcuY29udGFpbmVyID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGNvbnRhaW5lciA9IHR5cGVvZiBfID09PSBcImZ1bmN0aW9uXCIgPyBfIDogY29uc3RhbnQoXyksIGRyYWcpIDogY29udGFpbmVyO1xuICB9O1xuXG4gIGRyYWcuc3ViamVjdCA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChzdWJqZWN0ID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudChfKSwgZHJhZykgOiBzdWJqZWN0O1xuICB9O1xuXG4gIGRyYWcudG91Y2hhYmxlID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHRvdWNoYWJsZSA9IHR5cGVvZiBfID09PSBcImZ1bmN0aW9uXCIgPyBfIDogY29uc3RhbnQoISFfKSwgZHJhZykgOiB0b3VjaGFibGU7XG4gIH07XG5cbiAgZHJhZy5vbiA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciB2YWx1ZSA9IGxpc3RlbmVycy5vbi5hcHBseShsaXN0ZW5lcnMsIGFyZ3VtZW50cyk7XG4gICAgcmV0dXJuIHZhbHVlID09PSBsaXN0ZW5lcnMgPyBkcmFnIDogdmFsdWU7XG4gIH07XG5cbiAgZHJhZy5jbGlja0Rpc3RhbmNlID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGNsaWNrRGlzdGFuY2UyID0gKF8gPSArXykgKiBfLCBkcmFnKSA6IE1hdGguc3FydChjbGlja0Rpc3RhbmNlMik7XG4gIH07XG5cbiAgcmV0dXJuIGRyYWc7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oY29uc3RydWN0b3IsIGZhY3RvcnksIHByb3RvdHlwZSkge1xuICBjb25zdHJ1Y3Rvci5wcm90b3R5cGUgPSBmYWN0b3J5LnByb3RvdHlwZSA9IHByb3RvdHlwZTtcbiAgcHJvdG90eXBlLmNvbnN0cnVjdG9yID0gY29uc3RydWN0b3I7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBleHRlbmQocGFyZW50LCBkZWZpbml0aW9uKSB7XG4gIHZhciBwcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKHBhcmVudC5wcm90b3R5cGUpO1xuICBmb3IgKHZhciBrZXkgaW4gZGVmaW5pdGlvbikgcHJvdG90eXBlW2tleV0gPSBkZWZpbml0aW9uW2tleV07XG4gIHJldHVybiBwcm90b3R5cGU7XG59XG4iLCAiaW1wb3J0IGRlZmluZSwge2V4dGVuZH0gZnJvbSBcIi4vZGVmaW5lLmpzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiBDb2xvcigpIHt9XG5cbmV4cG9ydCB2YXIgZGFya2VyID0gMC43O1xuZXhwb3J0IHZhciBicmlnaHRlciA9IDEgLyBkYXJrZXI7XG5cbnZhciByZUkgPSBcIlxcXFxzKihbKy1dP1xcXFxkKylcXFxccypcIixcbiAgICByZU4gPSBcIlxcXFxzKihbKy1dPyg/OlxcXFxkKlxcXFwuKT9cXFxcZCsoPzpbZUVdWystXT9cXFxcZCspPylcXFxccypcIixcbiAgICByZVAgPSBcIlxcXFxzKihbKy1dPyg/OlxcXFxkKlxcXFwuKT9cXFxcZCsoPzpbZUVdWystXT9cXFxcZCspPyklXFxcXHMqXCIsXG4gICAgcmVIZXggPSAvXiMoWzAtOWEtZl17Myw4fSkkLyxcbiAgICByZVJnYkludGVnZXIgPSBuZXcgUmVnRXhwKGBecmdiXFxcXCgke3JlSX0sJHtyZUl9LCR7cmVJfVxcXFwpJGApLFxuICAgIHJlUmdiUGVyY2VudCA9IG5ldyBSZWdFeHAoYF5yZ2JcXFxcKCR7cmVQfSwke3JlUH0sJHtyZVB9XFxcXCkkYCksXG4gICAgcmVSZ2JhSW50ZWdlciA9IG5ldyBSZWdFeHAoYF5yZ2JhXFxcXCgke3JlSX0sJHtyZUl9LCR7cmVJfSwke3JlTn1cXFxcKSRgKSxcbiAgICByZVJnYmFQZXJjZW50ID0gbmV3IFJlZ0V4cChgXnJnYmFcXFxcKCR7cmVQfSwke3JlUH0sJHtyZVB9LCR7cmVOfVxcXFwpJGApLFxuICAgIHJlSHNsUGVyY2VudCA9IG5ldyBSZWdFeHAoYF5oc2xcXFxcKCR7cmVOfSwke3JlUH0sJHtyZVB9XFxcXCkkYCksXG4gICAgcmVIc2xhUGVyY2VudCA9IG5ldyBSZWdFeHAoYF5oc2xhXFxcXCgke3JlTn0sJHtyZVB9LCR7cmVQfSwke3JlTn1cXFxcKSRgKTtcblxudmFyIG5hbWVkID0ge1xuICBhbGljZWJsdWU6IDB4ZjBmOGZmLFxuICBhbnRpcXVld2hpdGU6IDB4ZmFlYmQ3LFxuICBhcXVhOiAweDAwZmZmZixcbiAgYXF1YW1hcmluZTogMHg3ZmZmZDQsXG4gIGF6dXJlOiAweGYwZmZmZixcbiAgYmVpZ2U6IDB4ZjVmNWRjLFxuICBiaXNxdWU6IDB4ZmZlNGM0LFxuICBibGFjazogMHgwMDAwMDAsXG4gIGJsYW5jaGVkYWxtb25kOiAweGZmZWJjZCxcbiAgYmx1ZTogMHgwMDAwZmYsXG4gIGJsdWV2aW9sZXQ6IDB4OGEyYmUyLFxuICBicm93bjogMHhhNTJhMmEsXG4gIGJ1cmx5d29vZDogMHhkZWI4ODcsXG4gIGNhZGV0Ymx1ZTogMHg1ZjllYTAsXG4gIGNoYXJ0cmV1c2U6IDB4N2ZmZjAwLFxuICBjaG9jb2xhdGU6IDB4ZDI2OTFlLFxuICBjb3JhbDogMHhmZjdmNTAsXG4gIGNvcm5mbG93ZXJibHVlOiAweDY0OTVlZCxcbiAgY29ybnNpbGs6IDB4ZmZmOGRjLFxuICBjcmltc29uOiAweGRjMTQzYyxcbiAgY3lhbjogMHgwMGZmZmYsXG4gIGRhcmtibHVlOiAweDAwMDA4YixcbiAgZGFya2N5YW46IDB4MDA4YjhiLFxuICBkYXJrZ29sZGVucm9kOiAweGI4ODYwYixcbiAgZGFya2dyYXk6IDB4YTlhOWE5LFxuICBkYXJrZ3JlZW46IDB4MDA2NDAwLFxuICBkYXJrZ3JleTogMHhhOWE5YTksXG4gIGRhcmtraGFraTogMHhiZGI3NmIsXG4gIGRhcmttYWdlbnRhOiAweDhiMDA4YixcbiAgZGFya29saXZlZ3JlZW46IDB4NTU2YjJmLFxuICBkYXJrb3JhbmdlOiAweGZmOGMwMCxcbiAgZGFya29yY2hpZDogMHg5OTMyY2MsXG4gIGRhcmtyZWQ6IDB4OGIwMDAwLFxuICBkYXJrc2FsbW9uOiAweGU5OTY3YSxcbiAgZGFya3NlYWdyZWVuOiAweDhmYmM4ZixcbiAgZGFya3NsYXRlYmx1ZTogMHg0ODNkOGIsXG4gIGRhcmtzbGF0ZWdyYXk6IDB4MmY0ZjRmLFxuICBkYXJrc2xhdGVncmV5OiAweDJmNGY0ZixcbiAgZGFya3R1cnF1b2lzZTogMHgwMGNlZDEsXG4gIGRhcmt2aW9sZXQ6IDB4OTQwMGQzLFxuICBkZWVwcGluazogMHhmZjE0OTMsXG4gIGRlZXBza3libHVlOiAweDAwYmZmZixcbiAgZGltZ3JheTogMHg2OTY5NjksXG4gIGRpbWdyZXk6IDB4Njk2OTY5LFxuICBkb2RnZXJibHVlOiAweDFlOTBmZixcbiAgZmlyZWJyaWNrOiAweGIyMjIyMixcbiAgZmxvcmFsd2hpdGU6IDB4ZmZmYWYwLFxuICBmb3Jlc3RncmVlbjogMHgyMjhiMjIsXG4gIGZ1Y2hzaWE6IDB4ZmYwMGZmLFxuICBnYWluc2Jvcm86IDB4ZGNkY2RjLFxuICBnaG9zdHdoaXRlOiAweGY4ZjhmZixcbiAgZ29sZDogMHhmZmQ3MDAsXG4gIGdvbGRlbnJvZDogMHhkYWE1MjAsXG4gIGdyYXk6IDB4ODA4MDgwLFxuICBncmVlbjogMHgwMDgwMDAsXG4gIGdyZWVueWVsbG93OiAweGFkZmYyZixcbiAgZ3JleTogMHg4MDgwODAsXG4gIGhvbmV5ZGV3OiAweGYwZmZmMCxcbiAgaG90cGluazogMHhmZjY5YjQsXG4gIGluZGlhbnJlZDogMHhjZDVjNWMsXG4gIGluZGlnbzogMHg0YjAwODIsXG4gIGl2b3J5OiAweGZmZmZmMCxcbiAga2hha2k6IDB4ZjBlNjhjLFxuICBsYXZlbmRlcjogMHhlNmU2ZmEsXG4gIGxhdmVuZGVyYmx1c2g6IDB4ZmZmMGY1LFxuICBsYXduZ3JlZW46IDB4N2NmYzAwLFxuICBsZW1vbmNoaWZmb246IDB4ZmZmYWNkLFxuICBsaWdodGJsdWU6IDB4YWRkOGU2LFxuICBsaWdodGNvcmFsOiAweGYwODA4MCxcbiAgbGlnaHRjeWFuOiAweGUwZmZmZixcbiAgbGlnaHRnb2xkZW5yb2R5ZWxsb3c6IDB4ZmFmYWQyLFxuICBsaWdodGdyYXk6IDB4ZDNkM2QzLFxuICBsaWdodGdyZWVuOiAweDkwZWU5MCxcbiAgbGlnaHRncmV5OiAweGQzZDNkMyxcbiAgbGlnaHRwaW5rOiAweGZmYjZjMSxcbiAgbGlnaHRzYWxtb246IDB4ZmZhMDdhLFxuICBsaWdodHNlYWdyZWVuOiAweDIwYjJhYSxcbiAgbGlnaHRza3libHVlOiAweDg3Y2VmYSxcbiAgbGlnaHRzbGF0ZWdyYXk6IDB4Nzc4ODk5LFxuICBsaWdodHNsYXRlZ3JleTogMHg3Nzg4OTksXG4gIGxpZ2h0c3RlZWxibHVlOiAweGIwYzRkZSxcbiAgbGlnaHR5ZWxsb3c6IDB4ZmZmZmUwLFxuICBsaW1lOiAweDAwZmYwMCxcbiAgbGltZWdyZWVuOiAweDMyY2QzMixcbiAgbGluZW46IDB4ZmFmMGU2LFxuICBtYWdlbnRhOiAweGZmMDBmZixcbiAgbWFyb29uOiAweDgwMDAwMCxcbiAgbWVkaXVtYXF1YW1hcmluZTogMHg2NmNkYWEsXG4gIG1lZGl1bWJsdWU6IDB4MDAwMGNkLFxuICBtZWRpdW1vcmNoaWQ6IDB4YmE1NWQzLFxuICBtZWRpdW1wdXJwbGU6IDB4OTM3MGRiLFxuICBtZWRpdW1zZWFncmVlbjogMHgzY2IzNzEsXG4gIG1lZGl1bXNsYXRlYmx1ZTogMHg3YjY4ZWUsXG4gIG1lZGl1bXNwcmluZ2dyZWVuOiAweDAwZmE5YSxcbiAgbWVkaXVtdHVycXVvaXNlOiAweDQ4ZDFjYyxcbiAgbWVkaXVtdmlvbGV0cmVkOiAweGM3MTU4NSxcbiAgbWlkbmlnaHRibHVlOiAweDE5MTk3MCxcbiAgbWludGNyZWFtOiAweGY1ZmZmYSxcbiAgbWlzdHlyb3NlOiAweGZmZTRlMSxcbiAgbW9jY2FzaW46IDB4ZmZlNGI1LFxuICBuYXZham93aGl0ZTogMHhmZmRlYWQsXG4gIG5hdnk6IDB4MDAwMDgwLFxuICBvbGRsYWNlOiAweGZkZjVlNixcbiAgb2xpdmU6IDB4ODA4MDAwLFxuICBvbGl2ZWRyYWI6IDB4NmI4ZTIzLFxuICBvcmFuZ2U6IDB4ZmZhNTAwLFxuICBvcmFuZ2VyZWQ6IDB4ZmY0NTAwLFxuICBvcmNoaWQ6IDB4ZGE3MGQ2LFxuICBwYWxlZ29sZGVucm9kOiAweGVlZThhYSxcbiAgcGFsZWdyZWVuOiAweDk4ZmI5OCxcbiAgcGFsZXR1cnF1b2lzZTogMHhhZmVlZWUsXG4gIHBhbGV2aW9sZXRyZWQ6IDB4ZGI3MDkzLFxuICBwYXBheWF3aGlwOiAweGZmZWZkNSxcbiAgcGVhY2hwdWZmOiAweGZmZGFiOSxcbiAgcGVydTogMHhjZDg1M2YsXG4gIHBpbms6IDB4ZmZjMGNiLFxuICBwbHVtOiAweGRkYTBkZCxcbiAgcG93ZGVyYmx1ZTogMHhiMGUwZTYsXG4gIHB1cnBsZTogMHg4MDAwODAsXG4gIHJlYmVjY2FwdXJwbGU6IDB4NjYzMzk5LFxuICByZWQ6IDB4ZmYwMDAwLFxuICByb3N5YnJvd246IDB4YmM4ZjhmLFxuICByb3lhbGJsdWU6IDB4NDE2OWUxLFxuICBzYWRkbGVicm93bjogMHg4YjQ1MTMsXG4gIHNhbG1vbjogMHhmYTgwNzIsXG4gIHNhbmR5YnJvd246IDB4ZjRhNDYwLFxuICBzZWFncmVlbjogMHgyZThiNTcsXG4gIHNlYXNoZWxsOiAweGZmZjVlZSxcbiAgc2llbm5hOiAweGEwNTIyZCxcbiAgc2lsdmVyOiAweGMwYzBjMCxcbiAgc2t5Ymx1ZTogMHg4N2NlZWIsXG4gIHNsYXRlYmx1ZTogMHg2YTVhY2QsXG4gIHNsYXRlZ3JheTogMHg3MDgwOTAsXG4gIHNsYXRlZ3JleTogMHg3MDgwOTAsXG4gIHNub3c6IDB4ZmZmYWZhLFxuICBzcHJpbmdncmVlbjogMHgwMGZmN2YsXG4gIHN0ZWVsYmx1ZTogMHg0NjgyYjQsXG4gIHRhbjogMHhkMmI0OGMsXG4gIHRlYWw6IDB4MDA4MDgwLFxuICB0aGlzdGxlOiAweGQ4YmZkOCxcbiAgdG9tYXRvOiAweGZmNjM0NyxcbiAgdHVycXVvaXNlOiAweDQwZTBkMCxcbiAgdmlvbGV0OiAweGVlODJlZSxcbiAgd2hlYXQ6IDB4ZjVkZWIzLFxuICB3aGl0ZTogMHhmZmZmZmYsXG4gIHdoaXRlc21va2U6IDB4ZjVmNWY1LFxuICB5ZWxsb3c6IDB4ZmZmZjAwLFxuICB5ZWxsb3dncmVlbjogMHg5YWNkMzJcbn07XG5cbmRlZmluZShDb2xvciwgY29sb3IsIHtcbiAgY29weShjaGFubmVscykge1xuICAgIHJldHVybiBPYmplY3QuYXNzaWduKG5ldyB0aGlzLmNvbnN0cnVjdG9yLCB0aGlzLCBjaGFubmVscyk7XG4gIH0sXG4gIGRpc3BsYXlhYmxlKCkge1xuICAgIHJldHVybiB0aGlzLnJnYigpLmRpc3BsYXlhYmxlKCk7XG4gIH0sXG4gIGhleDogY29sb3JfZm9ybWF0SGV4LCAvLyBEZXByZWNhdGVkISBVc2UgY29sb3IuZm9ybWF0SGV4LlxuICBmb3JtYXRIZXg6IGNvbG9yX2Zvcm1hdEhleCxcbiAgZm9ybWF0SGV4ODogY29sb3JfZm9ybWF0SGV4OCxcbiAgZm9ybWF0SHNsOiBjb2xvcl9mb3JtYXRIc2wsXG4gIGZvcm1hdFJnYjogY29sb3JfZm9ybWF0UmdiLFxuICB0b1N0cmluZzogY29sb3JfZm9ybWF0UmdiXG59KTtcblxuZnVuY3Rpb24gY29sb3JfZm9ybWF0SGV4KCkge1xuICByZXR1cm4gdGhpcy5yZ2IoKS5mb3JtYXRIZXgoKTtcbn1cblxuZnVuY3Rpb24gY29sb3JfZm9ybWF0SGV4OCgpIHtcbiAgcmV0dXJuIHRoaXMucmdiKCkuZm9ybWF0SGV4OCgpO1xufVxuXG5mdW5jdGlvbiBjb2xvcl9mb3JtYXRIc2woKSB7XG4gIHJldHVybiBoc2xDb252ZXJ0KHRoaXMpLmZvcm1hdEhzbCgpO1xufVxuXG5mdW5jdGlvbiBjb2xvcl9mb3JtYXRSZ2IoKSB7XG4gIHJldHVybiB0aGlzLnJnYigpLmZvcm1hdFJnYigpO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBjb2xvcihmb3JtYXQpIHtcbiAgdmFyIG0sIGw7XG4gIGZvcm1hdCA9IChmb3JtYXQgKyBcIlwiKS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgcmV0dXJuIChtID0gcmVIZXguZXhlYyhmb3JtYXQpKSA/IChsID0gbVsxXS5sZW5ndGgsIG0gPSBwYXJzZUludChtWzFdLCAxNiksIGwgPT09IDYgPyByZ2JuKG0pIC8vICNmZjAwMDBcbiAgICAgIDogbCA9PT0gMyA/IG5ldyBSZ2IoKG0gPj4gOCAmIDB4ZikgfCAobSA+PiA0ICYgMHhmMCksIChtID4+IDQgJiAweGYpIHwgKG0gJiAweGYwKSwgKChtICYgMHhmKSA8PCA0KSB8IChtICYgMHhmKSwgMSkgLy8gI2YwMFxuICAgICAgOiBsID09PSA4ID8gcmdiYShtID4+IDI0ICYgMHhmZiwgbSA+PiAxNiAmIDB4ZmYsIG0gPj4gOCAmIDB4ZmYsIChtICYgMHhmZikgLyAweGZmKSAvLyAjZmYwMDAwMDBcbiAgICAgIDogbCA9PT0gNCA/IHJnYmEoKG0gPj4gMTIgJiAweGYpIHwgKG0gPj4gOCAmIDB4ZjApLCAobSA+PiA4ICYgMHhmKSB8IChtID4+IDQgJiAweGYwKSwgKG0gPj4gNCAmIDB4ZikgfCAobSAmIDB4ZjApLCAoKChtICYgMHhmKSA8PCA0KSB8IChtICYgMHhmKSkgLyAweGZmKSAvLyAjZjAwMFxuICAgICAgOiBudWxsKSAvLyBpbnZhbGlkIGhleFxuICAgICAgOiAobSA9IHJlUmdiSW50ZWdlci5leGVjKGZvcm1hdCkpID8gbmV3IFJnYihtWzFdLCBtWzJdLCBtWzNdLCAxKSAvLyByZ2IoMjU1LCAwLCAwKVxuICAgICAgOiAobSA9IHJlUmdiUGVyY2VudC5leGVjKGZvcm1hdCkpID8gbmV3IFJnYihtWzFdICogMjU1IC8gMTAwLCBtWzJdICogMjU1IC8gMTAwLCBtWzNdICogMjU1IC8gMTAwLCAxKSAvLyByZ2IoMTAwJSwgMCUsIDAlKVxuICAgICAgOiAobSA9IHJlUmdiYUludGVnZXIuZXhlYyhmb3JtYXQpKSA/IHJnYmEobVsxXSwgbVsyXSwgbVszXSwgbVs0XSkgLy8gcmdiYSgyNTUsIDAsIDAsIDEpXG4gICAgICA6IChtID0gcmVSZ2JhUGVyY2VudC5leGVjKGZvcm1hdCkpID8gcmdiYShtWzFdICogMjU1IC8gMTAwLCBtWzJdICogMjU1IC8gMTAwLCBtWzNdICogMjU1IC8gMTAwLCBtWzRdKSAvLyByZ2IoMTAwJSwgMCUsIDAlLCAxKVxuICAgICAgOiAobSA9IHJlSHNsUGVyY2VudC5leGVjKGZvcm1hdCkpID8gaHNsYShtWzFdLCBtWzJdIC8gMTAwLCBtWzNdIC8gMTAwLCAxKSAvLyBoc2woMTIwLCA1MCUsIDUwJSlcbiAgICAgIDogKG0gPSByZUhzbGFQZXJjZW50LmV4ZWMoZm9ybWF0KSkgPyBoc2xhKG1bMV0sIG1bMl0gLyAxMDAsIG1bM10gLyAxMDAsIG1bNF0pIC8vIGhzbGEoMTIwLCA1MCUsIDUwJSwgMSlcbiAgICAgIDogbmFtZWQuaGFzT3duUHJvcGVydHkoZm9ybWF0KSA/IHJnYm4obmFtZWRbZm9ybWF0XSkgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1wcm90b3R5cGUtYnVpbHRpbnNcbiAgICAgIDogZm9ybWF0ID09PSBcInRyYW5zcGFyZW50XCIgPyBuZXcgUmdiKE5hTiwgTmFOLCBOYU4sIDApXG4gICAgICA6IG51bGw7XG59XG5cbmZ1bmN0aW9uIHJnYm4obikge1xuICByZXR1cm4gbmV3IFJnYihuID4+IDE2ICYgMHhmZiwgbiA+PiA4ICYgMHhmZiwgbiAmIDB4ZmYsIDEpO1xufVxuXG5mdW5jdGlvbiByZ2JhKHIsIGcsIGIsIGEpIHtcbiAgaWYgKGEgPD0gMCkgciA9IGcgPSBiID0gTmFOO1xuICByZXR1cm4gbmV3IFJnYihyLCBnLCBiLCBhKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJnYkNvbnZlcnQobykge1xuICBpZiAoIShvIGluc3RhbmNlb2YgQ29sb3IpKSBvID0gY29sb3Iobyk7XG4gIGlmICghbykgcmV0dXJuIG5ldyBSZ2I7XG4gIG8gPSBvLnJnYigpO1xuICByZXR1cm4gbmV3IFJnYihvLnIsIG8uZywgby5iLCBvLm9wYWNpdHkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmdiKHIsIGcsIGIsIG9wYWNpdHkpIHtcbiAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPT09IDEgPyByZ2JDb252ZXJ0KHIpIDogbmV3IFJnYihyLCBnLCBiLCBvcGFjaXR5ID09IG51bGwgPyAxIDogb3BhY2l0eSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBSZ2IociwgZywgYiwgb3BhY2l0eSkge1xuICB0aGlzLnIgPSArcjtcbiAgdGhpcy5nID0gK2c7XG4gIHRoaXMuYiA9ICtiO1xuICB0aGlzLm9wYWNpdHkgPSArb3BhY2l0eTtcbn1cblxuZGVmaW5lKFJnYiwgcmdiLCBleHRlbmQoQ29sb3IsIHtcbiAgYnJpZ2h0ZXIoaykge1xuICAgIGsgPSBrID09IG51bGwgPyBicmlnaHRlciA6IE1hdGgucG93KGJyaWdodGVyLCBrKTtcbiAgICByZXR1cm4gbmV3IFJnYih0aGlzLnIgKiBrLCB0aGlzLmcgKiBrLCB0aGlzLmIgKiBrLCB0aGlzLm9wYWNpdHkpO1xuICB9LFxuICBkYXJrZXIoaykge1xuICAgIGsgPSBrID09IG51bGwgPyBkYXJrZXIgOiBNYXRoLnBvdyhkYXJrZXIsIGspO1xuICAgIHJldHVybiBuZXcgUmdiKHRoaXMuciAqIGssIHRoaXMuZyAqIGssIHRoaXMuYiAqIGssIHRoaXMub3BhY2l0eSk7XG4gIH0sXG4gIHJnYigpIHtcbiAgICByZXR1cm4gdGhpcztcbiAgfSxcbiAgY2xhbXAoKSB7XG4gICAgcmV0dXJuIG5ldyBSZ2IoY2xhbXBpKHRoaXMuciksIGNsYW1waSh0aGlzLmcpLCBjbGFtcGkodGhpcy5iKSwgY2xhbXBhKHRoaXMub3BhY2l0eSkpO1xuICB9LFxuICBkaXNwbGF5YWJsZSgpIHtcbiAgICByZXR1cm4gKC0wLjUgPD0gdGhpcy5yICYmIHRoaXMuciA8IDI1NS41KVxuICAgICAgICAmJiAoLTAuNSA8PSB0aGlzLmcgJiYgdGhpcy5nIDwgMjU1LjUpXG4gICAgICAgICYmICgtMC41IDw9IHRoaXMuYiAmJiB0aGlzLmIgPCAyNTUuNSlcbiAgICAgICAgJiYgKDAgPD0gdGhpcy5vcGFjaXR5ICYmIHRoaXMub3BhY2l0eSA8PSAxKTtcbiAgfSxcbiAgaGV4OiByZ2JfZm9ybWF0SGV4LCAvLyBEZXByZWNhdGVkISBVc2UgY29sb3IuZm9ybWF0SGV4LlxuICBmb3JtYXRIZXg6IHJnYl9mb3JtYXRIZXgsXG4gIGZvcm1hdEhleDg6IHJnYl9mb3JtYXRIZXg4LFxuICBmb3JtYXRSZ2I6IHJnYl9mb3JtYXRSZ2IsXG4gIHRvU3RyaW5nOiByZ2JfZm9ybWF0UmdiXG59KSk7XG5cbmZ1bmN0aW9uIHJnYl9mb3JtYXRIZXgoKSB7XG4gIHJldHVybiBgIyR7aGV4KHRoaXMucil9JHtoZXgodGhpcy5nKX0ke2hleCh0aGlzLmIpfWA7XG59XG5cbmZ1bmN0aW9uIHJnYl9mb3JtYXRIZXg4KCkge1xuICByZXR1cm4gYCMke2hleCh0aGlzLnIpfSR7aGV4KHRoaXMuZyl9JHtoZXgodGhpcy5iKX0ke2hleCgoaXNOYU4odGhpcy5vcGFjaXR5KSA/IDEgOiB0aGlzLm9wYWNpdHkpICogMjU1KX1gO1xufVxuXG5mdW5jdGlvbiByZ2JfZm9ybWF0UmdiKCkge1xuICBjb25zdCBhID0gY2xhbXBhKHRoaXMub3BhY2l0eSk7XG4gIHJldHVybiBgJHthID09PSAxID8gXCJyZ2IoXCIgOiBcInJnYmEoXCJ9JHtjbGFtcGkodGhpcy5yKX0sICR7Y2xhbXBpKHRoaXMuZyl9LCAke2NsYW1waSh0aGlzLmIpfSR7YSA9PT0gMSA/IFwiKVwiIDogYCwgJHthfSlgfWA7XG59XG5cbmZ1bmN0aW9uIGNsYW1wYShvcGFjaXR5KSB7XG4gIHJldHVybiBpc05hTihvcGFjaXR5KSA/IDEgOiBNYXRoLm1heCgwLCBNYXRoLm1pbigxLCBvcGFjaXR5KSk7XG59XG5cbmZ1bmN0aW9uIGNsYW1waSh2YWx1ZSkge1xuICByZXR1cm4gTWF0aC5tYXgoMCwgTWF0aC5taW4oMjU1LCBNYXRoLnJvdW5kKHZhbHVlKSB8fCAwKSk7XG59XG5cbmZ1bmN0aW9uIGhleCh2YWx1ZSkge1xuICB2YWx1ZSA9IGNsYW1waSh2YWx1ZSk7XG4gIHJldHVybiAodmFsdWUgPCAxNiA/IFwiMFwiIDogXCJcIikgKyB2YWx1ZS50b1N0cmluZygxNik7XG59XG5cbmZ1bmN0aW9uIGhzbGEoaCwgcywgbCwgYSkge1xuICBpZiAoYSA8PSAwKSBoID0gcyA9IGwgPSBOYU47XG4gIGVsc2UgaWYgKGwgPD0gMCB8fCBsID49IDEpIGggPSBzID0gTmFOO1xuICBlbHNlIGlmIChzIDw9IDApIGggPSBOYU47XG4gIHJldHVybiBuZXcgSHNsKGgsIHMsIGwsIGEpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaHNsQ29udmVydChvKSB7XG4gIGlmIChvIGluc3RhbmNlb2YgSHNsKSByZXR1cm4gbmV3IEhzbChvLmgsIG8ucywgby5sLCBvLm9wYWNpdHkpO1xuICBpZiAoIShvIGluc3RhbmNlb2YgQ29sb3IpKSBvID0gY29sb3Iobyk7XG4gIGlmICghbykgcmV0dXJuIG5ldyBIc2w7XG4gIGlmIChvIGluc3RhbmNlb2YgSHNsKSByZXR1cm4gbztcbiAgbyA9IG8ucmdiKCk7XG4gIHZhciByID0gby5yIC8gMjU1LFxuICAgICAgZyA9IG8uZyAvIDI1NSxcbiAgICAgIGIgPSBvLmIgLyAyNTUsXG4gICAgICBtaW4gPSBNYXRoLm1pbihyLCBnLCBiKSxcbiAgICAgIG1heCA9IE1hdGgubWF4KHIsIGcsIGIpLFxuICAgICAgaCA9IE5hTixcbiAgICAgIHMgPSBtYXggLSBtaW4sXG4gICAgICBsID0gKG1heCArIG1pbikgLyAyO1xuICBpZiAocykge1xuICAgIGlmIChyID09PSBtYXgpIGggPSAoZyAtIGIpIC8gcyArIChnIDwgYikgKiA2O1xuICAgIGVsc2UgaWYgKGcgPT09IG1heCkgaCA9IChiIC0gcikgLyBzICsgMjtcbiAgICBlbHNlIGggPSAociAtIGcpIC8gcyArIDQ7XG4gICAgcyAvPSBsIDwgMC41ID8gbWF4ICsgbWluIDogMiAtIG1heCAtIG1pbjtcbiAgICBoICo9IDYwO1xuICB9IGVsc2Uge1xuICAgIHMgPSBsID4gMCAmJiBsIDwgMSA/IDAgOiBoO1xuICB9XG4gIHJldHVybiBuZXcgSHNsKGgsIHMsIGwsIG8ub3BhY2l0eSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBoc2woaCwgcywgbCwgb3BhY2l0eSkge1xuICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA9PT0gMSA/IGhzbENvbnZlcnQoaCkgOiBuZXcgSHNsKGgsIHMsIGwsIG9wYWNpdHkgPT0gbnVsbCA/IDEgOiBvcGFjaXR5KTtcbn1cblxuZnVuY3Rpb24gSHNsKGgsIHMsIGwsIG9wYWNpdHkpIHtcbiAgdGhpcy5oID0gK2g7XG4gIHRoaXMucyA9ICtzO1xuICB0aGlzLmwgPSArbDtcbiAgdGhpcy5vcGFjaXR5ID0gK29wYWNpdHk7XG59XG5cbmRlZmluZShIc2wsIGhzbCwgZXh0ZW5kKENvbG9yLCB7XG4gIGJyaWdodGVyKGspIHtcbiAgICBrID0gayA9PSBudWxsID8gYnJpZ2h0ZXIgOiBNYXRoLnBvdyhicmlnaHRlciwgayk7XG4gICAgcmV0dXJuIG5ldyBIc2wodGhpcy5oLCB0aGlzLnMsIHRoaXMubCAqIGssIHRoaXMub3BhY2l0eSk7XG4gIH0sXG4gIGRhcmtlcihrKSB7XG4gICAgayA9IGsgPT0gbnVsbCA/IGRhcmtlciA6IE1hdGgucG93KGRhcmtlciwgayk7XG4gICAgcmV0dXJuIG5ldyBIc2wodGhpcy5oLCB0aGlzLnMsIHRoaXMubCAqIGssIHRoaXMub3BhY2l0eSk7XG4gIH0sXG4gIHJnYigpIHtcbiAgICB2YXIgaCA9IHRoaXMuaCAlIDM2MCArICh0aGlzLmggPCAwKSAqIDM2MCxcbiAgICAgICAgcyA9IGlzTmFOKGgpIHx8IGlzTmFOKHRoaXMucykgPyAwIDogdGhpcy5zLFxuICAgICAgICBsID0gdGhpcy5sLFxuICAgICAgICBtMiA9IGwgKyAobCA8IDAuNSA/IGwgOiAxIC0gbCkgKiBzLFxuICAgICAgICBtMSA9IDIgKiBsIC0gbTI7XG4gICAgcmV0dXJuIG5ldyBSZ2IoXG4gICAgICBoc2wycmdiKGggPj0gMjQwID8gaCAtIDI0MCA6IGggKyAxMjAsIG0xLCBtMiksXG4gICAgICBoc2wycmdiKGgsIG0xLCBtMiksXG4gICAgICBoc2wycmdiKGggPCAxMjAgPyBoICsgMjQwIDogaCAtIDEyMCwgbTEsIG0yKSxcbiAgICAgIHRoaXMub3BhY2l0eVxuICAgICk7XG4gIH0sXG4gIGNsYW1wKCkge1xuICAgIHJldHVybiBuZXcgSHNsKGNsYW1waCh0aGlzLmgpLCBjbGFtcHQodGhpcy5zKSwgY2xhbXB0KHRoaXMubCksIGNsYW1wYSh0aGlzLm9wYWNpdHkpKTtcbiAgfSxcbiAgZGlzcGxheWFibGUoKSB7XG4gICAgcmV0dXJuICgwIDw9IHRoaXMucyAmJiB0aGlzLnMgPD0gMSB8fCBpc05hTih0aGlzLnMpKVxuICAgICAgICAmJiAoMCA8PSB0aGlzLmwgJiYgdGhpcy5sIDw9IDEpXG4gICAgICAgICYmICgwIDw9IHRoaXMub3BhY2l0eSAmJiB0aGlzLm9wYWNpdHkgPD0gMSk7XG4gIH0sXG4gIGZvcm1hdEhzbCgpIHtcbiAgICBjb25zdCBhID0gY2xhbXBhKHRoaXMub3BhY2l0eSk7XG4gICAgcmV0dXJuIGAke2EgPT09IDEgPyBcImhzbChcIiA6IFwiaHNsYShcIn0ke2NsYW1waCh0aGlzLmgpfSwgJHtjbGFtcHQodGhpcy5zKSAqIDEwMH0lLCAke2NsYW1wdCh0aGlzLmwpICogMTAwfSUke2EgPT09IDEgPyBcIilcIiA6IGAsICR7YX0pYH1gO1xuICB9XG59KSk7XG5cbmZ1bmN0aW9uIGNsYW1waCh2YWx1ZSkge1xuICB2YWx1ZSA9ICh2YWx1ZSB8fCAwKSAlIDM2MDtcbiAgcmV0dXJuIHZhbHVlIDwgMCA/IHZhbHVlICsgMzYwIDogdmFsdWU7XG59XG5cbmZ1bmN0aW9uIGNsYW1wdCh2YWx1ZSkge1xuICByZXR1cm4gTWF0aC5tYXgoMCwgTWF0aC5taW4oMSwgdmFsdWUgfHwgMCkpO1xufVxuXG4vKiBGcm9tIEZ2RCAxMy4zNywgQ1NTIENvbG9yIE1vZHVsZSBMZXZlbCAzICovXG5mdW5jdGlvbiBoc2wycmdiKGgsIG0xLCBtMikge1xuICByZXR1cm4gKGggPCA2MCA/IG0xICsgKG0yIC0gbTEpICogaCAvIDYwXG4gICAgICA6IGggPCAxODAgPyBtMlxuICAgICAgOiBoIDwgMjQwID8gbTEgKyAobTIgLSBtMSkgKiAoMjQwIC0gaCkgLyA2MFxuICAgICAgOiBtMSkgKiAyNTU7XG59XG4iLCAiZXhwb3J0IGZ1bmN0aW9uIGJhc2lzKHQxLCB2MCwgdjEsIHYyLCB2Mykge1xuICB2YXIgdDIgPSB0MSAqIHQxLCB0MyA9IHQyICogdDE7XG4gIHJldHVybiAoKDEgLSAzICogdDEgKyAzICogdDIgLSB0MykgKiB2MFxuICAgICAgKyAoNCAtIDYgKiB0MiArIDMgKiB0MykgKiB2MVxuICAgICAgKyAoMSArIDMgKiB0MSArIDMgKiB0MiAtIDMgKiB0MykgKiB2MlxuICAgICAgKyB0MyAqIHYzKSAvIDY7XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHZhbHVlcykge1xuICB2YXIgbiA9IHZhbHVlcy5sZW5ndGggLSAxO1xuICByZXR1cm4gZnVuY3Rpb24odCkge1xuICAgIHZhciBpID0gdCA8PSAwID8gKHQgPSAwKSA6IHQgPj0gMSA/ICh0ID0gMSwgbiAtIDEpIDogTWF0aC5mbG9vcih0ICogbiksXG4gICAgICAgIHYxID0gdmFsdWVzW2ldLFxuICAgICAgICB2MiA9IHZhbHVlc1tpICsgMV0sXG4gICAgICAgIHYwID0gaSA+IDAgPyB2YWx1ZXNbaSAtIDFdIDogMiAqIHYxIC0gdjIsXG4gICAgICAgIHYzID0gaSA8IG4gLSAxID8gdmFsdWVzW2kgKyAyXSA6IDIgKiB2MiAtIHYxO1xuICAgIHJldHVybiBiYXNpcygodCAtIGkgLyBuKSAqIG4sIHYwLCB2MSwgdjIsIHYzKTtcbiAgfTtcbn1cbiIsICJpbXBvcnQge2Jhc2lzfSBmcm9tIFwiLi9iYXNpcy5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih2YWx1ZXMpIHtcbiAgdmFyIG4gPSB2YWx1ZXMubGVuZ3RoO1xuICByZXR1cm4gZnVuY3Rpb24odCkge1xuICAgIHZhciBpID0gTWF0aC5mbG9vcigoKHQgJT0gMSkgPCAwID8gKyt0IDogdCkgKiBuKSxcbiAgICAgICAgdjAgPSB2YWx1ZXNbKGkgKyBuIC0gMSkgJSBuXSxcbiAgICAgICAgdjEgPSB2YWx1ZXNbaSAlIG5dLFxuICAgICAgICB2MiA9IHZhbHVlc1soaSArIDEpICUgbl0sXG4gICAgICAgIHYzID0gdmFsdWVzWyhpICsgMikgJSBuXTtcbiAgICByZXR1cm4gYmFzaXMoKHQgLSBpIC8gbikgKiBuLCB2MCwgdjEsIHYyLCB2Myk7XG4gIH07XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgeCA9PiAoKSA9PiB4O1xuIiwgImltcG9ydCBjb25zdGFudCBmcm9tIFwiLi9jb25zdGFudC5qc1wiO1xuXG5mdW5jdGlvbiBsaW5lYXIoYSwgZCkge1xuICByZXR1cm4gZnVuY3Rpb24odCkge1xuICAgIHJldHVybiBhICsgdCAqIGQ7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGV4cG9uZW50aWFsKGEsIGIsIHkpIHtcbiAgcmV0dXJuIGEgPSBNYXRoLnBvdyhhLCB5KSwgYiA9IE1hdGgucG93KGIsIHkpIC0gYSwgeSA9IDEgLyB5LCBmdW5jdGlvbih0KSB7XG4gICAgcmV0dXJuIE1hdGgucG93KGEgKyB0ICogYiwgeSk7XG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBodWUoYSwgYikge1xuICB2YXIgZCA9IGIgLSBhO1xuICByZXR1cm4gZCA/IGxpbmVhcihhLCBkID4gMTgwIHx8IGQgPCAtMTgwID8gZCAtIDM2MCAqIE1hdGgucm91bmQoZCAvIDM2MCkgOiBkKSA6IGNvbnN0YW50KGlzTmFOKGEpID8gYiA6IGEpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2FtbWEoeSkge1xuICByZXR1cm4gKHkgPSAreSkgPT09IDEgPyBub2dhbW1hIDogZnVuY3Rpb24oYSwgYikge1xuICAgIHJldHVybiBiIC0gYSA/IGV4cG9uZW50aWFsKGEsIGIsIHkpIDogY29uc3RhbnQoaXNOYU4oYSkgPyBiIDogYSk7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIG5vZ2FtbWEoYSwgYikge1xuICB2YXIgZCA9IGIgLSBhO1xuICByZXR1cm4gZCA/IGxpbmVhcihhLCBkKSA6IGNvbnN0YW50KGlzTmFOKGEpID8gYiA6IGEpO1xufVxuIiwgImltcG9ydCB7cmdiIGFzIGNvbG9yUmdifSBmcm9tIFwiZDMtY29sb3JcIjtcbmltcG9ydCBiYXNpcyBmcm9tIFwiLi9iYXNpcy5qc1wiO1xuaW1wb3J0IGJhc2lzQ2xvc2VkIGZyb20gXCIuL2Jhc2lzQ2xvc2VkLmpzXCI7XG5pbXBvcnQgbm9nYW1tYSwge2dhbW1hfSBmcm9tIFwiLi9jb2xvci5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCAoZnVuY3Rpb24gcmdiR2FtbWEoeSkge1xuICB2YXIgY29sb3IgPSBnYW1tYSh5KTtcblxuICBmdW5jdGlvbiByZ2Ioc3RhcnQsIGVuZCkge1xuICAgIHZhciByID0gY29sb3IoKHN0YXJ0ID0gY29sb3JSZ2Ioc3RhcnQpKS5yLCAoZW5kID0gY29sb3JSZ2IoZW5kKSkuciksXG4gICAgICAgIGcgPSBjb2xvcihzdGFydC5nLCBlbmQuZyksXG4gICAgICAgIGIgPSBjb2xvcihzdGFydC5iLCBlbmQuYiksXG4gICAgICAgIG9wYWNpdHkgPSBub2dhbW1hKHN0YXJ0Lm9wYWNpdHksIGVuZC5vcGFjaXR5KTtcbiAgICByZXR1cm4gZnVuY3Rpb24odCkge1xuICAgICAgc3RhcnQuciA9IHIodCk7XG4gICAgICBzdGFydC5nID0gZyh0KTtcbiAgICAgIHN0YXJ0LmIgPSBiKHQpO1xuICAgICAgc3RhcnQub3BhY2l0eSA9IG9wYWNpdHkodCk7XG4gICAgICByZXR1cm4gc3RhcnQgKyBcIlwiO1xuICAgIH07XG4gIH1cblxuICByZ2IuZ2FtbWEgPSByZ2JHYW1tYTtcblxuICByZXR1cm4gcmdiO1xufSkoMSk7XG5cbmZ1bmN0aW9uIHJnYlNwbGluZShzcGxpbmUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKGNvbG9ycykge1xuICAgIHZhciBuID0gY29sb3JzLmxlbmd0aCxcbiAgICAgICAgciA9IG5ldyBBcnJheShuKSxcbiAgICAgICAgZyA9IG5ldyBBcnJheShuKSxcbiAgICAgICAgYiA9IG5ldyBBcnJheShuKSxcbiAgICAgICAgaSwgY29sb3I7XG4gICAgZm9yIChpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgY29sb3IgPSBjb2xvclJnYihjb2xvcnNbaV0pO1xuICAgICAgcltpXSA9IGNvbG9yLnIgfHwgMDtcbiAgICAgIGdbaV0gPSBjb2xvci5nIHx8IDA7XG4gICAgICBiW2ldID0gY29sb3IuYiB8fCAwO1xuICAgIH1cbiAgICByID0gc3BsaW5lKHIpO1xuICAgIGcgPSBzcGxpbmUoZyk7XG4gICAgYiA9IHNwbGluZShiKTtcbiAgICBjb2xvci5vcGFjaXR5ID0gMTtcbiAgICByZXR1cm4gZnVuY3Rpb24odCkge1xuICAgICAgY29sb3IuciA9IHIodCk7XG4gICAgICBjb2xvci5nID0gZyh0KTtcbiAgICAgIGNvbG9yLmIgPSBiKHQpO1xuICAgICAgcmV0dXJuIGNvbG9yICsgXCJcIjtcbiAgICB9O1xuICB9O1xufVxuXG5leHBvcnQgdmFyIHJnYkJhc2lzID0gcmdiU3BsaW5lKGJhc2lzKTtcbmV4cG9ydCB2YXIgcmdiQmFzaXNDbG9zZWQgPSByZ2JTcGxpbmUoYmFzaXNDbG9zZWQpO1xuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGEsIGIpIHtcbiAgcmV0dXJuIGEgPSArYSwgYiA9ICtiLCBmdW5jdGlvbih0KSB7XG4gICAgcmV0dXJuIGEgKiAoMSAtIHQpICsgYiAqIHQ7XG4gIH07XG59XG4iLCAiaW1wb3J0IG51bWJlciBmcm9tIFwiLi9udW1iZXIuanNcIjtcblxudmFyIHJlQSA9IC9bLStdPyg/OlxcZCtcXC4/XFxkKnxcXC4/XFxkKykoPzpbZUVdWy0rXT9cXGQrKT8vZyxcbiAgICByZUIgPSBuZXcgUmVnRXhwKHJlQS5zb3VyY2UsIFwiZ1wiKTtcblxuZnVuY3Rpb24gemVybyhiKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gYjtcbiAgfTtcbn1cblxuZnVuY3Rpb24gb25lKGIpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKHQpIHtcbiAgICByZXR1cm4gYih0KSArIFwiXCI7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGEsIGIpIHtcbiAgdmFyIGJpID0gcmVBLmxhc3RJbmRleCA9IHJlQi5sYXN0SW5kZXggPSAwLCAvLyBzY2FuIGluZGV4IGZvciBuZXh0IG51bWJlciBpbiBiXG4gICAgICBhbSwgLy8gY3VycmVudCBtYXRjaCBpbiBhXG4gICAgICBibSwgLy8gY3VycmVudCBtYXRjaCBpbiBiXG4gICAgICBicywgLy8gc3RyaW5nIHByZWNlZGluZyBjdXJyZW50IG51bWJlciBpbiBiLCBpZiBhbnlcbiAgICAgIGkgPSAtMSwgLy8gaW5kZXggaW4gc1xuICAgICAgcyA9IFtdLCAvLyBzdHJpbmcgY29uc3RhbnRzIGFuZCBwbGFjZWhvbGRlcnNcbiAgICAgIHEgPSBbXTsgLy8gbnVtYmVyIGludGVycG9sYXRvcnNcblxuICAvLyBDb2VyY2UgaW5wdXRzIHRvIHN0cmluZ3MuXG4gIGEgPSBhICsgXCJcIiwgYiA9IGIgKyBcIlwiO1xuXG4gIC8vIEludGVycG9sYXRlIHBhaXJzIG9mIG51bWJlcnMgaW4gYSAmIGIuXG4gIHdoaWxlICgoYW0gPSByZUEuZXhlYyhhKSlcbiAgICAgICYmIChibSA9IHJlQi5leGVjKGIpKSkge1xuICAgIGlmICgoYnMgPSBibS5pbmRleCkgPiBiaSkgeyAvLyBhIHN0cmluZyBwcmVjZWRlcyB0aGUgbmV4dCBudW1iZXIgaW4gYlxuICAgICAgYnMgPSBiLnNsaWNlKGJpLCBicyk7XG4gICAgICBpZiAoc1tpXSkgc1tpXSArPSBiczsgLy8gY29hbGVzY2Ugd2l0aCBwcmV2aW91cyBzdHJpbmdcbiAgICAgIGVsc2Ugc1srK2ldID0gYnM7XG4gICAgfVxuICAgIGlmICgoYW0gPSBhbVswXSkgPT09IChibSA9IGJtWzBdKSkgeyAvLyBudW1iZXJzIGluIGEgJiBiIG1hdGNoXG4gICAgICBpZiAoc1tpXSkgc1tpXSArPSBibTsgLy8gY29hbGVzY2Ugd2l0aCBwcmV2aW91cyBzdHJpbmdcbiAgICAgIGVsc2Ugc1srK2ldID0gYm07XG4gICAgfSBlbHNlIHsgLy8gaW50ZXJwb2xhdGUgbm9uLW1hdGNoaW5nIG51bWJlcnNcbiAgICAgIHNbKytpXSA9IG51bGw7XG4gICAgICBxLnB1c2goe2k6IGksIHg6IG51bWJlcihhbSwgYm0pfSk7XG4gICAgfVxuICAgIGJpID0gcmVCLmxhc3RJbmRleDtcbiAgfVxuXG4gIC8vIEFkZCByZW1haW5zIG9mIGIuXG4gIGlmIChiaSA8IGIubGVuZ3RoKSB7XG4gICAgYnMgPSBiLnNsaWNlKGJpKTtcbiAgICBpZiAoc1tpXSkgc1tpXSArPSBiczsgLy8gY29hbGVzY2Ugd2l0aCBwcmV2aW91cyBzdHJpbmdcbiAgICBlbHNlIHNbKytpXSA9IGJzO1xuICB9XG5cbiAgLy8gU3BlY2lhbCBvcHRpbWl6YXRpb24gZm9yIG9ubHkgYSBzaW5nbGUgbWF0Y2guXG4gIC8vIE90aGVyd2lzZSwgaW50ZXJwb2xhdGUgZWFjaCBvZiB0aGUgbnVtYmVycyBhbmQgcmVqb2luIHRoZSBzdHJpbmcuXG4gIHJldHVybiBzLmxlbmd0aCA8IDIgPyAocVswXVxuICAgICAgPyBvbmUocVswXS54KVxuICAgICAgOiB6ZXJvKGIpKVxuICAgICAgOiAoYiA9IHEubGVuZ3RoLCBmdW5jdGlvbih0KSB7XG4gICAgICAgICAgZm9yICh2YXIgaSA9IDAsIG87IGkgPCBiOyArK2kpIHNbKG8gPSBxW2ldKS5pXSA9IG8ueCh0KTtcbiAgICAgICAgICByZXR1cm4gcy5qb2luKFwiXCIpO1xuICAgICAgICB9KTtcbn1cbiIsICJ2YXIgZGVncmVlcyA9IDE4MCAvIE1hdGguUEk7XG5cbmV4cG9ydCB2YXIgaWRlbnRpdHkgPSB7XG4gIHRyYW5zbGF0ZVg6IDAsXG4gIHRyYW5zbGF0ZVk6IDAsXG4gIHJvdGF0ZTogMCxcbiAgc2tld1g6IDAsXG4gIHNjYWxlWDogMSxcbiAgc2NhbGVZOiAxXG59O1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihhLCBiLCBjLCBkLCBlLCBmKSB7XG4gIHZhciBzY2FsZVgsIHNjYWxlWSwgc2tld1g7XG4gIGlmIChzY2FsZVggPSBNYXRoLnNxcnQoYSAqIGEgKyBiICogYikpIGEgLz0gc2NhbGVYLCBiIC89IHNjYWxlWDtcbiAgaWYgKHNrZXdYID0gYSAqIGMgKyBiICogZCkgYyAtPSBhICogc2tld1gsIGQgLT0gYiAqIHNrZXdYO1xuICBpZiAoc2NhbGVZID0gTWF0aC5zcXJ0KGMgKiBjICsgZCAqIGQpKSBjIC89IHNjYWxlWSwgZCAvPSBzY2FsZVksIHNrZXdYIC89IHNjYWxlWTtcbiAgaWYgKGEgKiBkIDwgYiAqIGMpIGEgPSAtYSwgYiA9IC1iLCBza2V3WCA9IC1za2V3WCwgc2NhbGVYID0gLXNjYWxlWDtcbiAgcmV0dXJuIHtcbiAgICB0cmFuc2xhdGVYOiBlLFxuICAgIHRyYW5zbGF0ZVk6IGYsXG4gICAgcm90YXRlOiBNYXRoLmF0YW4yKGIsIGEpICogZGVncmVlcyxcbiAgICBza2V3WDogTWF0aC5hdGFuKHNrZXdYKSAqIGRlZ3JlZXMsXG4gICAgc2NhbGVYOiBzY2FsZVgsXG4gICAgc2NhbGVZOiBzY2FsZVlcbiAgfTtcbn1cbiIsICJpbXBvcnQgZGVjb21wb3NlLCB7aWRlbnRpdHl9IGZyb20gXCIuL2RlY29tcG9zZS5qc1wiO1xuXG52YXIgc3ZnTm9kZTtcblxuLyogZXNsaW50LWRpc2FibGUgbm8tdW5kZWYgKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUNzcyh2YWx1ZSkge1xuICBjb25zdCBtID0gbmV3ICh0eXBlb2YgRE9NTWF0cml4ID09PSBcImZ1bmN0aW9uXCIgPyBET01NYXRyaXggOiBXZWJLaXRDU1NNYXRyaXgpKHZhbHVlICsgXCJcIik7XG4gIHJldHVybiBtLmlzSWRlbnRpdHkgPyBpZGVudGl0eSA6IGRlY29tcG9zZShtLmEsIG0uYiwgbS5jLCBtLmQsIG0uZSwgbS5mKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlU3ZnKHZhbHVlKSB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gaWRlbnRpdHk7XG4gIGlmICghc3ZnTm9kZSkgc3ZnTm9kZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnROUyhcImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCIsIFwiZ1wiKTtcbiAgc3ZnTm9kZS5zZXRBdHRyaWJ1dGUoXCJ0cmFuc2Zvcm1cIiwgdmFsdWUpO1xuICBpZiAoISh2YWx1ZSA9IHN2Z05vZGUudHJhbnNmb3JtLmJhc2VWYWwuY29uc29saWRhdGUoKSkpIHJldHVybiBpZGVudGl0eTtcbiAgdmFsdWUgPSB2YWx1ZS5tYXRyaXg7XG4gIHJldHVybiBkZWNvbXBvc2UodmFsdWUuYSwgdmFsdWUuYiwgdmFsdWUuYywgdmFsdWUuZCwgdmFsdWUuZSwgdmFsdWUuZik7XG59XG4iLCAiaW1wb3J0IG51bWJlciBmcm9tIFwiLi4vbnVtYmVyLmpzXCI7XG5pbXBvcnQge3BhcnNlQ3NzLCBwYXJzZVN2Z30gZnJvbSBcIi4vcGFyc2UuanNcIjtcblxuZnVuY3Rpb24gaW50ZXJwb2xhdGVUcmFuc2Zvcm0ocGFyc2UsIHB4Q29tbWEsIHB4UGFyZW4sIGRlZ1BhcmVuKSB7XG5cbiAgZnVuY3Rpb24gcG9wKHMpIHtcbiAgICByZXR1cm4gcy5sZW5ndGggPyBzLnBvcCgpICsgXCIgXCIgOiBcIlwiO1xuICB9XG5cbiAgZnVuY3Rpb24gdHJhbnNsYXRlKHhhLCB5YSwgeGIsIHliLCBzLCBxKSB7XG4gICAgaWYgKHhhICE9PSB4YiB8fCB5YSAhPT0geWIpIHtcbiAgICAgIHZhciBpID0gcy5wdXNoKFwidHJhbnNsYXRlKFwiLCBudWxsLCBweENvbW1hLCBudWxsLCBweFBhcmVuKTtcbiAgICAgIHEucHVzaCh7aTogaSAtIDQsIHg6IG51bWJlcih4YSwgeGIpfSwge2k6IGkgLSAyLCB4OiBudW1iZXIoeWEsIHliKX0pO1xuICAgIH0gZWxzZSBpZiAoeGIgfHwgeWIpIHtcbiAgICAgIHMucHVzaChcInRyYW5zbGF0ZShcIiArIHhiICsgcHhDb21tYSArIHliICsgcHhQYXJlbik7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gcm90YXRlKGEsIGIsIHMsIHEpIHtcbiAgICBpZiAoYSAhPT0gYikge1xuICAgICAgaWYgKGEgLSBiID4gMTgwKSBiICs9IDM2MDsgZWxzZSBpZiAoYiAtIGEgPiAxODApIGEgKz0gMzYwOyAvLyBzaG9ydGVzdCBwYXRoXG4gICAgICBxLnB1c2goe2k6IHMucHVzaChwb3AocykgKyBcInJvdGF0ZShcIiwgbnVsbCwgZGVnUGFyZW4pIC0gMiwgeDogbnVtYmVyKGEsIGIpfSk7XG4gICAgfSBlbHNlIGlmIChiKSB7XG4gICAgICBzLnB1c2gocG9wKHMpICsgXCJyb3RhdGUoXCIgKyBiICsgZGVnUGFyZW4pO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHNrZXdYKGEsIGIsIHMsIHEpIHtcbiAgICBpZiAoYSAhPT0gYikge1xuICAgICAgcS5wdXNoKHtpOiBzLnB1c2gocG9wKHMpICsgXCJza2V3WChcIiwgbnVsbCwgZGVnUGFyZW4pIC0gMiwgeDogbnVtYmVyKGEsIGIpfSk7XG4gICAgfSBlbHNlIGlmIChiKSB7XG4gICAgICBzLnB1c2gocG9wKHMpICsgXCJza2V3WChcIiArIGIgKyBkZWdQYXJlbik7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gc2NhbGUoeGEsIHlhLCB4YiwgeWIsIHMsIHEpIHtcbiAgICBpZiAoeGEgIT09IHhiIHx8IHlhICE9PSB5Yikge1xuICAgICAgdmFyIGkgPSBzLnB1c2gocG9wKHMpICsgXCJzY2FsZShcIiwgbnVsbCwgXCIsXCIsIG51bGwsIFwiKVwiKTtcbiAgICAgIHEucHVzaCh7aTogaSAtIDQsIHg6IG51bWJlcih4YSwgeGIpfSwge2k6IGkgLSAyLCB4OiBudW1iZXIoeWEsIHliKX0pO1xuICAgIH0gZWxzZSBpZiAoeGIgIT09IDEgfHwgeWIgIT09IDEpIHtcbiAgICAgIHMucHVzaChwb3AocykgKyBcInNjYWxlKFwiICsgeGIgKyBcIixcIiArIHliICsgXCIpXCIpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBmdW5jdGlvbihhLCBiKSB7XG4gICAgdmFyIHMgPSBbXSwgLy8gc3RyaW5nIGNvbnN0YW50cyBhbmQgcGxhY2Vob2xkZXJzXG4gICAgICAgIHEgPSBbXTsgLy8gbnVtYmVyIGludGVycG9sYXRvcnNcbiAgICBhID0gcGFyc2UoYSksIGIgPSBwYXJzZShiKTtcbiAgICB0cmFuc2xhdGUoYS50cmFuc2xhdGVYLCBhLnRyYW5zbGF0ZVksIGIudHJhbnNsYXRlWCwgYi50cmFuc2xhdGVZLCBzLCBxKTtcbiAgICByb3RhdGUoYS5yb3RhdGUsIGIucm90YXRlLCBzLCBxKTtcbiAgICBza2V3WChhLnNrZXdYLCBiLnNrZXdYLCBzLCBxKTtcbiAgICBzY2FsZShhLnNjYWxlWCwgYS5zY2FsZVksIGIuc2NhbGVYLCBiLnNjYWxlWSwgcywgcSk7XG4gICAgYSA9IGIgPSBudWxsOyAvLyBnY1xuICAgIHJldHVybiBmdW5jdGlvbih0KSB7XG4gICAgICB2YXIgaSA9IC0xLCBuID0gcS5sZW5ndGgsIG87XG4gICAgICB3aGlsZSAoKytpIDwgbikgc1sobyA9IHFbaV0pLmldID0gby54KHQpO1xuICAgICAgcmV0dXJuIHMuam9pbihcIlwiKTtcbiAgICB9O1xuICB9O1xufVxuXG5leHBvcnQgdmFyIGludGVycG9sYXRlVHJhbnNmb3JtQ3NzID0gaW50ZXJwb2xhdGVUcmFuc2Zvcm0ocGFyc2VDc3MsIFwicHgsIFwiLCBcInB4KVwiLCBcImRlZylcIik7XG5leHBvcnQgdmFyIGludGVycG9sYXRlVHJhbnNmb3JtU3ZnID0gaW50ZXJwb2xhdGVUcmFuc2Zvcm0ocGFyc2VTdmcsIFwiLCBcIiwgXCIpXCIsIFwiKVwiKTtcbiIsICJ2YXIgZXBzaWxvbjIgPSAxZS0xMjtcblxuZnVuY3Rpb24gY29zaCh4KSB7XG4gIHJldHVybiAoKHggPSBNYXRoLmV4cCh4KSkgKyAxIC8geCkgLyAyO1xufVxuXG5mdW5jdGlvbiBzaW5oKHgpIHtcbiAgcmV0dXJuICgoeCA9IE1hdGguZXhwKHgpKSAtIDEgLyB4KSAvIDI7XG59XG5cbmZ1bmN0aW9uIHRhbmgoeCkge1xuICByZXR1cm4gKCh4ID0gTWF0aC5leHAoMiAqIHgpKSAtIDEpIC8gKHggKyAxKTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgKGZ1bmN0aW9uIHpvb21SaG8ocmhvLCByaG8yLCByaG80KSB7XG5cbiAgLy8gcDAgPSBbdXgwLCB1eTAsIHcwXVxuICAvLyBwMSA9IFt1eDEsIHV5MSwgdzFdXG4gIGZ1bmN0aW9uIHpvb20ocDAsIHAxKSB7XG4gICAgdmFyIHV4MCA9IHAwWzBdLCB1eTAgPSBwMFsxXSwgdzAgPSBwMFsyXSxcbiAgICAgICAgdXgxID0gcDFbMF0sIHV5MSA9IHAxWzFdLCB3MSA9IHAxWzJdLFxuICAgICAgICBkeCA9IHV4MSAtIHV4MCxcbiAgICAgICAgZHkgPSB1eTEgLSB1eTAsXG4gICAgICAgIGQyID0gZHggKiBkeCArIGR5ICogZHksXG4gICAgICAgIGksXG4gICAgICAgIFM7XG5cbiAgICAvLyBTcGVjaWFsIGNhc2UgZm9yIHUwIFx1MjI0NSB1MS5cbiAgICBpZiAoZDIgPCBlcHNpbG9uMikge1xuICAgICAgUyA9IE1hdGgubG9nKHcxIC8gdzApIC8gcmhvO1xuICAgICAgaSA9IGZ1bmN0aW9uKHQpIHtcbiAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICB1eDAgKyB0ICogZHgsXG4gICAgICAgICAgdXkwICsgdCAqIGR5LFxuICAgICAgICAgIHcwICogTWF0aC5leHAocmhvICogdCAqIFMpXG4gICAgICAgIF07XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gR2VuZXJhbCBjYXNlLlxuICAgIGVsc2Uge1xuICAgICAgdmFyIGQxID0gTWF0aC5zcXJ0KGQyKSxcbiAgICAgICAgICBiMCA9ICh3MSAqIHcxIC0gdzAgKiB3MCArIHJobzQgKiBkMikgLyAoMiAqIHcwICogcmhvMiAqIGQxKSxcbiAgICAgICAgICBiMSA9ICh3MSAqIHcxIC0gdzAgKiB3MCAtIHJobzQgKiBkMikgLyAoMiAqIHcxICogcmhvMiAqIGQxKSxcbiAgICAgICAgICByMCA9IE1hdGgubG9nKE1hdGguc3FydChiMCAqIGIwICsgMSkgLSBiMCksXG4gICAgICAgICAgcjEgPSBNYXRoLmxvZyhNYXRoLnNxcnQoYjEgKiBiMSArIDEpIC0gYjEpO1xuICAgICAgUyA9IChyMSAtIHIwKSAvIHJobztcbiAgICAgIGkgPSBmdW5jdGlvbih0KSB7XG4gICAgICAgIHZhciBzID0gdCAqIFMsXG4gICAgICAgICAgICBjb3NocjAgPSBjb3NoKHIwKSxcbiAgICAgICAgICAgIHUgPSB3MCAvIChyaG8yICogZDEpICogKGNvc2hyMCAqIHRhbmgocmhvICogcyArIHIwKSAtIHNpbmgocjApKTtcbiAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICB1eDAgKyB1ICogZHgsXG4gICAgICAgICAgdXkwICsgdSAqIGR5LFxuICAgICAgICAgIHcwICogY29zaHIwIC8gY29zaChyaG8gKiBzICsgcjApXG4gICAgICAgIF07XG4gICAgICB9XG4gICAgfVxuXG4gICAgaS5kdXJhdGlvbiA9IFMgKiAxMDAwICogcmhvIC8gTWF0aC5TUVJUMjtcblxuICAgIHJldHVybiBpO1xuICB9XG5cbiAgem9vbS5yaG8gPSBmdW5jdGlvbihfKSB7XG4gICAgdmFyIF8xID0gTWF0aC5tYXgoMWUtMywgK18pLCBfMiA9IF8xICogXzEsIF80ID0gXzIgKiBfMjtcbiAgICByZXR1cm4gem9vbVJobyhfMSwgXzIsIF80KTtcbiAgfTtcblxuICByZXR1cm4gem9vbTtcbn0pKE1hdGguU1FSVDIsIDIsIDQpO1xuIiwgInZhciBmcmFtZSA9IDAsIC8vIGlzIGFuIGFuaW1hdGlvbiBmcmFtZSBwZW5kaW5nP1xuICAgIHRpbWVvdXQgPSAwLCAvLyBpcyBhIHRpbWVvdXQgcGVuZGluZz9cbiAgICBpbnRlcnZhbCA9IDAsIC8vIGFyZSBhbnkgdGltZXJzIGFjdGl2ZT9cbiAgICBwb2tlRGVsYXkgPSAxMDAwLCAvLyBob3cgZnJlcXVlbnRseSB3ZSBjaGVjayBmb3IgY2xvY2sgc2tld1xuICAgIHRhc2tIZWFkLFxuICAgIHRhc2tUYWlsLFxuICAgIGNsb2NrTGFzdCA9IDAsXG4gICAgY2xvY2tOb3cgPSAwLFxuICAgIGNsb2NrU2tldyA9IDAsXG4gICAgY2xvY2sgPSB0eXBlb2YgcGVyZm9ybWFuY2UgPT09IFwib2JqZWN0XCIgJiYgcGVyZm9ybWFuY2Uubm93ID8gcGVyZm9ybWFuY2UgOiBEYXRlLFxuICAgIHNldEZyYW1lID0gdHlwZW9mIHdpbmRvdyA9PT0gXCJvYmplY3RcIiAmJiB3aW5kb3cucmVxdWVzdEFuaW1hdGlvbkZyYW1lID8gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZS5iaW5kKHdpbmRvdykgOiBmdW5jdGlvbihmKSB7IHNldFRpbWVvdXQoZiwgMTcpOyB9O1xuXG5leHBvcnQgZnVuY3Rpb24gbm93KCkge1xuICByZXR1cm4gY2xvY2tOb3cgfHwgKHNldEZyYW1lKGNsZWFyTm93KSwgY2xvY2tOb3cgPSBjbG9jay5ub3coKSArIGNsb2NrU2tldyk7XG59XG5cbmZ1bmN0aW9uIGNsZWFyTm93KCkge1xuICBjbG9ja05vdyA9IDA7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBUaW1lcigpIHtcbiAgdGhpcy5fY2FsbCA9XG4gIHRoaXMuX3RpbWUgPVxuICB0aGlzLl9uZXh0ID0gbnVsbDtcbn1cblxuVGltZXIucHJvdG90eXBlID0gdGltZXIucHJvdG90eXBlID0ge1xuICBjb25zdHJ1Y3RvcjogVGltZXIsXG4gIHJlc3RhcnQ6IGZ1bmN0aW9uKGNhbGxiYWNrLCBkZWxheSwgdGltZSkge1xuICAgIGlmICh0eXBlb2YgY2FsbGJhY2sgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IFR5cGVFcnJvcihcImNhbGxiYWNrIGlzIG5vdCBhIGZ1bmN0aW9uXCIpO1xuICAgIHRpbWUgPSAodGltZSA9PSBudWxsID8gbm93KCkgOiArdGltZSkgKyAoZGVsYXkgPT0gbnVsbCA/IDAgOiArZGVsYXkpO1xuICAgIGlmICghdGhpcy5fbmV4dCAmJiB0YXNrVGFpbCAhPT0gdGhpcykge1xuICAgICAgaWYgKHRhc2tUYWlsKSB0YXNrVGFpbC5fbmV4dCA9IHRoaXM7XG4gICAgICBlbHNlIHRhc2tIZWFkID0gdGhpcztcbiAgICAgIHRhc2tUYWlsID0gdGhpcztcbiAgICB9XG4gICAgdGhpcy5fY2FsbCA9IGNhbGxiYWNrO1xuICAgIHRoaXMuX3RpbWUgPSB0aW1lO1xuICAgIHNsZWVwKCk7XG4gIH0sXG4gIHN0b3A6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLl9jYWxsKSB7XG4gICAgICB0aGlzLl9jYWxsID0gbnVsbDtcbiAgICAgIHRoaXMuX3RpbWUgPSBJbmZpbml0eTtcbiAgICAgIHNsZWVwKCk7XG4gICAgfVxuICB9XG59O1xuXG5leHBvcnQgZnVuY3Rpb24gdGltZXIoY2FsbGJhY2ssIGRlbGF5LCB0aW1lKSB7XG4gIHZhciB0ID0gbmV3IFRpbWVyO1xuICB0LnJlc3RhcnQoY2FsbGJhY2ssIGRlbGF5LCB0aW1lKTtcbiAgcmV0dXJuIHQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB0aW1lckZsdXNoKCkge1xuICBub3coKTsgLy8gR2V0IHRoZSBjdXJyZW50IHRpbWUsIGlmIG5vdCBhbHJlYWR5IHNldC5cbiAgKytmcmFtZTsgLy8gUHJldGVuZCB3ZVx1MjAxOXZlIHNldCBhbiBhbGFybSwgaWYgd2UgaGF2ZW5cdTIwMTl0IGFscmVhZHkuXG4gIHZhciB0ID0gdGFza0hlYWQsIGU7XG4gIHdoaWxlICh0KSB7XG4gICAgaWYgKChlID0gY2xvY2tOb3cgLSB0Ll90aW1lKSA+PSAwKSB0Ll9jYWxsLmNhbGwodW5kZWZpbmVkLCBlKTtcbiAgICB0ID0gdC5fbmV4dDtcbiAgfVxuICAtLWZyYW1lO1xufVxuXG5mdW5jdGlvbiB3YWtlKCkge1xuICBjbG9ja05vdyA9IChjbG9ja0xhc3QgPSBjbG9jay5ub3coKSkgKyBjbG9ja1NrZXc7XG4gIGZyYW1lID0gdGltZW91dCA9IDA7XG4gIHRyeSB7XG4gICAgdGltZXJGbHVzaCgpO1xuICB9IGZpbmFsbHkge1xuICAgIGZyYW1lID0gMDtcbiAgICBuYXAoKTtcbiAgICBjbG9ja05vdyA9IDA7XG4gIH1cbn1cblxuZnVuY3Rpb24gcG9rZSgpIHtcbiAgdmFyIG5vdyA9IGNsb2NrLm5vdygpLCBkZWxheSA9IG5vdyAtIGNsb2NrTGFzdDtcbiAgaWYgKGRlbGF5ID4gcG9rZURlbGF5KSBjbG9ja1NrZXcgLT0gZGVsYXksIGNsb2NrTGFzdCA9IG5vdztcbn1cblxuZnVuY3Rpb24gbmFwKCkge1xuICB2YXIgdDAsIHQxID0gdGFza0hlYWQsIHQyLCB0aW1lID0gSW5maW5pdHk7XG4gIHdoaWxlICh0MSkge1xuICAgIGlmICh0MS5fY2FsbCkge1xuICAgICAgaWYgKHRpbWUgPiB0MS5fdGltZSkgdGltZSA9IHQxLl90aW1lO1xuICAgICAgdDAgPSB0MSwgdDEgPSB0MS5fbmV4dDtcbiAgICB9IGVsc2Uge1xuICAgICAgdDIgPSB0MS5fbmV4dCwgdDEuX25leHQgPSBudWxsO1xuICAgICAgdDEgPSB0MCA/IHQwLl9uZXh0ID0gdDIgOiB0YXNrSGVhZCA9IHQyO1xuICAgIH1cbiAgfVxuICB0YXNrVGFpbCA9IHQwO1xuICBzbGVlcCh0aW1lKTtcbn1cblxuZnVuY3Rpb24gc2xlZXAodGltZSkge1xuICBpZiAoZnJhbWUpIHJldHVybjsgLy8gU29vbmVzdCBhbGFybSBhbHJlYWR5IHNldCwgb3Igd2lsbCBiZS5cbiAgaWYgKHRpbWVvdXQpIHRpbWVvdXQgPSBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gIHZhciBkZWxheSA9IHRpbWUgLSBjbG9ja05vdzsgLy8gU3RyaWN0bHkgbGVzcyB0aGFuIGlmIHdlIHJlY29tcHV0ZWQgY2xvY2tOb3cuXG4gIGlmIChkZWxheSA+IDI0KSB7XG4gICAgaWYgKHRpbWUgPCBJbmZpbml0eSkgdGltZW91dCA9IHNldFRpbWVvdXQod2FrZSwgdGltZSAtIGNsb2NrLm5vdygpIC0gY2xvY2tTa2V3KTtcbiAgICBpZiAoaW50ZXJ2YWwpIGludGVydmFsID0gY2xlYXJJbnRlcnZhbChpbnRlcnZhbCk7XG4gIH0gZWxzZSB7XG4gICAgaWYgKCFpbnRlcnZhbCkgY2xvY2tMYXN0ID0gY2xvY2subm93KCksIGludGVydmFsID0gc2V0SW50ZXJ2YWwocG9rZSwgcG9rZURlbGF5KTtcbiAgICBmcmFtZSA9IDEsIHNldEZyYW1lKHdha2UpO1xuICB9XG59XG4iLCAiaW1wb3J0IHtUaW1lcn0gZnJvbSBcIi4vdGltZXIuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oY2FsbGJhY2ssIGRlbGF5LCB0aW1lKSB7XG4gIHZhciB0ID0gbmV3IFRpbWVyO1xuICBkZWxheSA9IGRlbGF5ID09IG51bGwgPyAwIDogK2RlbGF5O1xuICB0LnJlc3RhcnQoZWxhcHNlZCA9PiB7XG4gICAgdC5zdG9wKCk7XG4gICAgY2FsbGJhY2soZWxhcHNlZCArIGRlbGF5KTtcbiAgfSwgZGVsYXksIHRpbWUpO1xuICByZXR1cm4gdDtcbn1cbiIsICJpbXBvcnQge2Rpc3BhdGNofSBmcm9tIFwiZDMtZGlzcGF0Y2hcIjtcbmltcG9ydCB7dGltZXIsIHRpbWVvdXR9IGZyb20gXCJkMy10aW1lclwiO1xuXG52YXIgZW1wdHlPbiA9IGRpc3BhdGNoKFwic3RhcnRcIiwgXCJlbmRcIiwgXCJjYW5jZWxcIiwgXCJpbnRlcnJ1cHRcIik7XG52YXIgZW1wdHlUd2VlbiA9IFtdO1xuXG5leHBvcnQgdmFyIENSRUFURUQgPSAwO1xuZXhwb3J0IHZhciBTQ0hFRFVMRUQgPSAxO1xuZXhwb3J0IHZhciBTVEFSVElORyA9IDI7XG5leHBvcnQgdmFyIFNUQVJURUQgPSAzO1xuZXhwb3J0IHZhciBSVU5OSU5HID0gNDtcbmV4cG9ydCB2YXIgRU5ESU5HID0gNTtcbmV4cG9ydCB2YXIgRU5ERUQgPSA2O1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihub2RlLCBuYW1lLCBpZCwgaW5kZXgsIGdyb3VwLCB0aW1pbmcpIHtcbiAgdmFyIHNjaGVkdWxlcyA9IG5vZGUuX190cmFuc2l0aW9uO1xuICBpZiAoIXNjaGVkdWxlcykgbm9kZS5fX3RyYW5zaXRpb24gPSB7fTtcbiAgZWxzZSBpZiAoaWQgaW4gc2NoZWR1bGVzKSByZXR1cm47XG4gIGNyZWF0ZShub2RlLCBpZCwge1xuICAgIG5hbWU6IG5hbWUsXG4gICAgaW5kZXg6IGluZGV4LCAvLyBGb3IgY29udGV4dCBkdXJpbmcgY2FsbGJhY2suXG4gICAgZ3JvdXA6IGdyb3VwLCAvLyBGb3IgY29udGV4dCBkdXJpbmcgY2FsbGJhY2suXG4gICAgb246IGVtcHR5T24sXG4gICAgdHdlZW46IGVtcHR5VHdlZW4sXG4gICAgdGltZTogdGltaW5nLnRpbWUsXG4gICAgZGVsYXk6IHRpbWluZy5kZWxheSxcbiAgICBkdXJhdGlvbjogdGltaW5nLmR1cmF0aW9uLFxuICAgIGVhc2U6IHRpbWluZy5lYXNlLFxuICAgIHRpbWVyOiBudWxsLFxuICAgIHN0YXRlOiBDUkVBVEVEXG4gIH0pO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaW5pdChub2RlLCBpZCkge1xuICB2YXIgc2NoZWR1bGUgPSBnZXQobm9kZSwgaWQpO1xuICBpZiAoc2NoZWR1bGUuc3RhdGUgPiBDUkVBVEVEKSB0aHJvdyBuZXcgRXJyb3IoXCJ0b28gbGF0ZTsgYWxyZWFkeSBzY2hlZHVsZWRcIik7XG4gIHJldHVybiBzY2hlZHVsZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNldChub2RlLCBpZCkge1xuICB2YXIgc2NoZWR1bGUgPSBnZXQobm9kZSwgaWQpO1xuICBpZiAoc2NoZWR1bGUuc3RhdGUgPiBTVEFSVEVEKSB0aHJvdyBuZXcgRXJyb3IoXCJ0b28gbGF0ZTsgYWxyZWFkeSBydW5uaW5nXCIpO1xuICByZXR1cm4gc2NoZWR1bGU7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXQobm9kZSwgaWQpIHtcbiAgdmFyIHNjaGVkdWxlID0gbm9kZS5fX3RyYW5zaXRpb247XG4gIGlmICghc2NoZWR1bGUgfHwgIShzY2hlZHVsZSA9IHNjaGVkdWxlW2lkXSkpIHRocm93IG5ldyBFcnJvcihcInRyYW5zaXRpb24gbm90IGZvdW5kXCIpO1xuICByZXR1cm4gc2NoZWR1bGU7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZShub2RlLCBpZCwgc2VsZikge1xuICB2YXIgc2NoZWR1bGVzID0gbm9kZS5fX3RyYW5zaXRpb24sXG4gICAgICB0d2VlbjtcblxuICAvLyBJbml0aWFsaXplIHRoZSBzZWxmIHRpbWVyIHdoZW4gdGhlIHRyYW5zaXRpb24gaXMgY3JlYXRlZC5cbiAgLy8gTm90ZSB0aGUgYWN0dWFsIGRlbGF5IGlzIG5vdCBrbm93biB1bnRpbCB0aGUgZmlyc3QgY2FsbGJhY2shXG4gIHNjaGVkdWxlc1tpZF0gPSBzZWxmO1xuICBzZWxmLnRpbWVyID0gdGltZXIoc2NoZWR1bGUsIDAsIHNlbGYudGltZSk7XG5cbiAgZnVuY3Rpb24gc2NoZWR1bGUoZWxhcHNlZCkge1xuICAgIHNlbGYuc3RhdGUgPSBTQ0hFRFVMRUQ7XG4gICAgc2VsZi50aW1lci5yZXN0YXJ0KHN0YXJ0LCBzZWxmLmRlbGF5LCBzZWxmLnRpbWUpO1xuXG4gICAgLy8gSWYgdGhlIGVsYXBzZWQgZGVsYXkgaXMgbGVzcyB0aGFuIG91ciBmaXJzdCBzbGVlcCwgc3RhcnQgaW1tZWRpYXRlbHkuXG4gICAgaWYgKHNlbGYuZGVsYXkgPD0gZWxhcHNlZCkgc3RhcnQoZWxhcHNlZCAtIHNlbGYuZGVsYXkpO1xuICB9XG5cbiAgZnVuY3Rpb24gc3RhcnQoZWxhcHNlZCkge1xuICAgIHZhciBpLCBqLCBuLCBvO1xuXG4gICAgLy8gSWYgdGhlIHN0YXRlIGlzIG5vdCBTQ0hFRFVMRUQsIHRoZW4gd2UgcHJldmlvdXNseSBlcnJvcmVkIG9uIHN0YXJ0LlxuICAgIGlmIChzZWxmLnN0YXRlICE9PSBTQ0hFRFVMRUQpIHJldHVybiBzdG9wKCk7XG5cbiAgICBmb3IgKGkgaW4gc2NoZWR1bGVzKSB7XG4gICAgICBvID0gc2NoZWR1bGVzW2ldO1xuICAgICAgaWYgKG8ubmFtZSAhPT0gc2VsZi5uYW1lKSBjb250aW51ZTtcblxuICAgICAgLy8gV2hpbGUgdGhpcyBlbGVtZW50IGFscmVhZHkgaGFzIGEgc3RhcnRpbmcgdHJhbnNpdGlvbiBkdXJpbmcgdGhpcyBmcmFtZSxcbiAgICAgIC8vIGRlZmVyIHN0YXJ0aW5nIGFuIGludGVycnVwdGluZyB0cmFuc2l0aW9uIHVudGlsIHRoYXQgdHJhbnNpdGlvbiBoYXMgYVxuICAgICAgLy8gY2hhbmNlIHRvIHRpY2sgKGFuZCBwb3NzaWJseSBlbmQpOyBzZWUgZDMvZDMtdHJhbnNpdGlvbiM1NCFcbiAgICAgIGlmIChvLnN0YXRlID09PSBTVEFSVEVEKSByZXR1cm4gdGltZW91dChzdGFydCk7XG5cbiAgICAgIC8vIEludGVycnVwdCB0aGUgYWN0aXZlIHRyYW5zaXRpb24sIGlmIGFueS5cbiAgICAgIGlmIChvLnN0YXRlID09PSBSVU5OSU5HKSB7XG4gICAgICAgIG8uc3RhdGUgPSBFTkRFRDtcbiAgICAgICAgby50aW1lci5zdG9wKCk7XG4gICAgICAgIG8ub24uY2FsbChcImludGVycnVwdFwiLCBub2RlLCBub2RlLl9fZGF0YV9fLCBvLmluZGV4LCBvLmdyb3VwKTtcbiAgICAgICAgZGVsZXRlIHNjaGVkdWxlc1tpXTtcbiAgICAgIH1cblxuICAgICAgLy8gQ2FuY2VsIGFueSBwcmUtZW1wdGVkIHRyYW5zaXRpb25zLlxuICAgICAgZWxzZSBpZiAoK2kgPCBpZCkge1xuICAgICAgICBvLnN0YXRlID0gRU5ERUQ7XG4gICAgICAgIG8udGltZXIuc3RvcCgpO1xuICAgICAgICBvLm9uLmNhbGwoXCJjYW5jZWxcIiwgbm9kZSwgbm9kZS5fX2RhdGFfXywgby5pbmRleCwgby5ncm91cCk7XG4gICAgICAgIGRlbGV0ZSBzY2hlZHVsZXNbaV07XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gRGVmZXIgdGhlIGZpcnN0IHRpY2sgdG8gZW5kIG9mIHRoZSBjdXJyZW50IGZyYW1lOyBzZWUgZDMvZDMjMTU3Ni5cbiAgICAvLyBOb3RlIHRoZSB0cmFuc2l0aW9uIG1heSBiZSBjYW5jZWxlZCBhZnRlciBzdGFydCBhbmQgYmVmb3JlIHRoZSBmaXJzdCB0aWNrIVxuICAgIC8vIE5vdGUgdGhpcyBtdXN0IGJlIHNjaGVkdWxlZCBiZWZvcmUgdGhlIHN0YXJ0IGV2ZW50OyBzZWUgZDMvZDMtdHJhbnNpdGlvbiMxNiFcbiAgICAvLyBBc3N1bWluZyB0aGlzIGlzIHN1Y2Nlc3NmdWwsIHN1YnNlcXVlbnQgY2FsbGJhY2tzIGdvIHN0cmFpZ2h0IHRvIHRpY2suXG4gICAgdGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgIGlmIChzZWxmLnN0YXRlID09PSBTVEFSVEVEKSB7XG4gICAgICAgIHNlbGYuc3RhdGUgPSBSVU5OSU5HO1xuICAgICAgICBzZWxmLnRpbWVyLnJlc3RhcnQodGljaywgc2VsZi5kZWxheSwgc2VsZi50aW1lKTtcbiAgICAgICAgdGljayhlbGFwc2VkKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIERpc3BhdGNoIHRoZSBzdGFydCBldmVudC5cbiAgICAvLyBOb3RlIHRoaXMgbXVzdCBiZSBkb25lIGJlZm9yZSB0aGUgdHdlZW4gYXJlIGluaXRpYWxpemVkLlxuICAgIHNlbGYuc3RhdGUgPSBTVEFSVElORztcbiAgICBzZWxmLm9uLmNhbGwoXCJzdGFydFwiLCBub2RlLCBub2RlLl9fZGF0YV9fLCBzZWxmLmluZGV4LCBzZWxmLmdyb3VwKTtcbiAgICBpZiAoc2VsZi5zdGF0ZSAhPT0gU1RBUlRJTkcpIHJldHVybjsgLy8gaW50ZXJydXB0ZWRcbiAgICBzZWxmLnN0YXRlID0gU1RBUlRFRDtcblxuICAgIC8vIEluaXRpYWxpemUgdGhlIHR3ZWVuLCBkZWxldGluZyBudWxsIHR3ZWVuLlxuICAgIHR3ZWVuID0gbmV3IEFycmF5KG4gPSBzZWxmLnR3ZWVuLmxlbmd0aCk7XG4gICAgZm9yIChpID0gMCwgaiA9IC0xOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAobyA9IHNlbGYudHdlZW5baV0udmFsdWUuY2FsbChub2RlLCBub2RlLl9fZGF0YV9fLCBzZWxmLmluZGV4LCBzZWxmLmdyb3VwKSkge1xuICAgICAgICB0d2VlblsrK2pdID0gbztcbiAgICAgIH1cbiAgICB9XG4gICAgdHdlZW4ubGVuZ3RoID0gaiArIDE7XG4gIH1cblxuICBmdW5jdGlvbiB0aWNrKGVsYXBzZWQpIHtcbiAgICB2YXIgdCA9IGVsYXBzZWQgPCBzZWxmLmR1cmF0aW9uID8gc2VsZi5lYXNlLmNhbGwobnVsbCwgZWxhcHNlZCAvIHNlbGYuZHVyYXRpb24pIDogKHNlbGYudGltZXIucmVzdGFydChzdG9wKSwgc2VsZi5zdGF0ZSA9IEVORElORywgMSksXG4gICAgICAgIGkgPSAtMSxcbiAgICAgICAgbiA9IHR3ZWVuLmxlbmd0aDtcblxuICAgIHdoaWxlICgrK2kgPCBuKSB7XG4gICAgICB0d2VlbltpXS5jYWxsKG5vZGUsIHQpO1xuICAgIH1cblxuICAgIC8vIERpc3BhdGNoIHRoZSBlbmQgZXZlbnQuXG4gICAgaWYgKHNlbGYuc3RhdGUgPT09IEVORElORykge1xuICAgICAgc2VsZi5vbi5jYWxsKFwiZW5kXCIsIG5vZGUsIG5vZGUuX19kYXRhX18sIHNlbGYuaW5kZXgsIHNlbGYuZ3JvdXApO1xuICAgICAgc3RvcCgpO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHN0b3AoKSB7XG4gICAgc2VsZi5zdGF0ZSA9IEVOREVEO1xuICAgIHNlbGYudGltZXIuc3RvcCgpO1xuICAgIGRlbGV0ZSBzY2hlZHVsZXNbaWRdO1xuICAgIGZvciAodmFyIGkgaW4gc2NoZWR1bGVzKSByZXR1cm47IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICBkZWxldGUgbm9kZS5fX3RyYW5zaXRpb247XG4gIH1cbn1cbiIsICJpbXBvcnQge1NUQVJUSU5HLCBFTkRJTkcsIEVOREVEfSBmcm9tIFwiLi90cmFuc2l0aW9uL3NjaGVkdWxlLmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG5vZGUsIG5hbWUpIHtcbiAgdmFyIHNjaGVkdWxlcyA9IG5vZGUuX190cmFuc2l0aW9uLFxuICAgICAgc2NoZWR1bGUsXG4gICAgICBhY3RpdmUsXG4gICAgICBlbXB0eSA9IHRydWUsXG4gICAgICBpO1xuXG4gIGlmICghc2NoZWR1bGVzKSByZXR1cm47XG5cbiAgbmFtZSA9IG5hbWUgPT0gbnVsbCA/IG51bGwgOiBuYW1lICsgXCJcIjtcblxuICBmb3IgKGkgaW4gc2NoZWR1bGVzKSB7XG4gICAgaWYgKChzY2hlZHVsZSA9IHNjaGVkdWxlc1tpXSkubmFtZSAhPT0gbmFtZSkgeyBlbXB0eSA9IGZhbHNlOyBjb250aW51ZTsgfVxuICAgIGFjdGl2ZSA9IHNjaGVkdWxlLnN0YXRlID4gU1RBUlRJTkcgJiYgc2NoZWR1bGUuc3RhdGUgPCBFTkRJTkc7XG4gICAgc2NoZWR1bGUuc3RhdGUgPSBFTkRFRDtcbiAgICBzY2hlZHVsZS50aW1lci5zdG9wKCk7XG4gICAgc2NoZWR1bGUub24uY2FsbChhY3RpdmUgPyBcImludGVycnVwdFwiIDogXCJjYW5jZWxcIiwgbm9kZSwgbm9kZS5fX2RhdGFfXywgc2NoZWR1bGUuaW5kZXgsIHNjaGVkdWxlLmdyb3VwKTtcbiAgICBkZWxldGUgc2NoZWR1bGVzW2ldO1xuICB9XG5cbiAgaWYgKGVtcHR5KSBkZWxldGUgbm9kZS5fX3RyYW5zaXRpb247XG59XG4iLCAiaW1wb3J0IGludGVycnVwdCBmcm9tIFwiLi4vaW50ZXJydXB0LmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG5hbWUpIHtcbiAgcmV0dXJuIHRoaXMuZWFjaChmdW5jdGlvbigpIHtcbiAgICBpbnRlcnJ1cHQodGhpcywgbmFtZSk7XG4gIH0pO1xufVxuIiwgImltcG9ydCB7Z2V0LCBzZXR9IGZyb20gXCIuL3NjaGVkdWxlLmpzXCI7XG5cbmZ1bmN0aW9uIHR3ZWVuUmVtb3ZlKGlkLCBuYW1lKSB7XG4gIHZhciB0d2VlbjAsIHR3ZWVuMTtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBzY2hlZHVsZSA9IHNldCh0aGlzLCBpZCksXG4gICAgICAgIHR3ZWVuID0gc2NoZWR1bGUudHdlZW47XG5cbiAgICAvLyBJZiB0aGlzIG5vZGUgc2hhcmVkIHR3ZWVuIHdpdGggdGhlIHByZXZpb3VzIG5vZGUsXG4gICAgLy8ganVzdCBhc3NpZ24gdGhlIHVwZGF0ZWQgc2hhcmVkIHR3ZWVuIGFuZCB3ZVx1MjAxOXJlIGRvbmUhXG4gICAgLy8gT3RoZXJ3aXNlLCBjb3B5LW9uLXdyaXRlLlxuICAgIGlmICh0d2VlbiAhPT0gdHdlZW4wKSB7XG4gICAgICB0d2VlbjEgPSB0d2VlbjAgPSB0d2VlbjtcbiAgICAgIGZvciAodmFyIGkgPSAwLCBuID0gdHdlZW4xLmxlbmd0aDsgaSA8IG47ICsraSkge1xuICAgICAgICBpZiAodHdlZW4xW2ldLm5hbWUgPT09IG5hbWUpIHtcbiAgICAgICAgICB0d2VlbjEgPSB0d2VlbjEuc2xpY2UoKTtcbiAgICAgICAgICB0d2VlbjEuc3BsaWNlKGksIDEpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgc2NoZWR1bGUudHdlZW4gPSB0d2VlbjE7XG4gIH07XG59XG5cbmZ1bmN0aW9uIHR3ZWVuRnVuY3Rpb24oaWQsIG5hbWUsIHZhbHVlKSB7XG4gIHZhciB0d2VlbjAsIHR3ZWVuMTtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3I7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2NoZWR1bGUgPSBzZXQodGhpcywgaWQpLFxuICAgICAgICB0d2VlbiA9IHNjaGVkdWxlLnR3ZWVuO1xuXG4gICAgLy8gSWYgdGhpcyBub2RlIHNoYXJlZCB0d2VlbiB3aXRoIHRoZSBwcmV2aW91cyBub2RlLFxuICAgIC8vIGp1c3QgYXNzaWduIHRoZSB1cGRhdGVkIHNoYXJlZCB0d2VlbiBhbmQgd2VcdTIwMTlyZSBkb25lIVxuICAgIC8vIE90aGVyd2lzZSwgY29weS1vbi13cml0ZS5cbiAgICBpZiAodHdlZW4gIT09IHR3ZWVuMCkge1xuICAgICAgdHdlZW4xID0gKHR3ZWVuMCA9IHR3ZWVuKS5zbGljZSgpO1xuICAgICAgZm9yICh2YXIgdCA9IHtuYW1lOiBuYW1lLCB2YWx1ZTogdmFsdWV9LCBpID0gMCwgbiA9IHR3ZWVuMS5sZW5ndGg7IGkgPCBuOyArK2kpIHtcbiAgICAgICAgaWYgKHR3ZWVuMVtpXS5uYW1lID09PSBuYW1lKSB7XG4gICAgICAgICAgdHdlZW4xW2ldID0gdDtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKGkgPT09IG4pIHR3ZWVuMS5wdXNoKHQpO1xuICAgIH1cblxuICAgIHNjaGVkdWxlLnR3ZWVuID0gdHdlZW4xO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihuYW1lLCB2YWx1ZSkge1xuICB2YXIgaWQgPSB0aGlzLl9pZDtcblxuICBuYW1lICs9IFwiXCI7XG5cbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPCAyKSB7XG4gICAgdmFyIHR3ZWVuID0gZ2V0KHRoaXMubm9kZSgpLCBpZCkudHdlZW47XG4gICAgZm9yICh2YXIgaSA9IDAsIG4gPSB0d2Vlbi5sZW5ndGgsIHQ7IGkgPCBuOyArK2kpIHtcbiAgICAgIGlmICgodCA9IHR3ZWVuW2ldKS5uYW1lID09PSBuYW1lKSB7XG4gICAgICAgIHJldHVybiB0LnZhbHVlO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHJldHVybiB0aGlzLmVhY2goKHZhbHVlID09IG51bGwgPyB0d2VlblJlbW92ZSA6IHR3ZWVuRnVuY3Rpb24pKGlkLCBuYW1lLCB2YWx1ZSkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gdHdlZW5WYWx1ZSh0cmFuc2l0aW9uLCBuYW1lLCB2YWx1ZSkge1xuICB2YXIgaWQgPSB0cmFuc2l0aW9uLl9pZDtcblxuICB0cmFuc2l0aW9uLmVhY2goZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNjaGVkdWxlID0gc2V0KHRoaXMsIGlkKTtcbiAgICAoc2NoZWR1bGUudmFsdWUgfHwgKHNjaGVkdWxlLnZhbHVlID0ge30pKVtuYW1lXSA9IHZhbHVlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gIH0pO1xuXG4gIHJldHVybiBmdW5jdGlvbihub2RlKSB7XG4gICAgcmV0dXJuIGdldChub2RlLCBpZCkudmFsdWVbbmFtZV07XG4gIH07XG59XG4iLCAiaW1wb3J0IHtjb2xvcn0gZnJvbSBcImQzLWNvbG9yXCI7XG5pbXBvcnQge2ludGVycG9sYXRlTnVtYmVyLCBpbnRlcnBvbGF0ZVJnYiwgaW50ZXJwb2xhdGVTdHJpbmd9IGZyb20gXCJkMy1pbnRlcnBvbGF0ZVwiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihhLCBiKSB7XG4gIHZhciBjO1xuICByZXR1cm4gKHR5cGVvZiBiID09PSBcIm51bWJlclwiID8gaW50ZXJwb2xhdGVOdW1iZXJcbiAgICAgIDogYiBpbnN0YW5jZW9mIGNvbG9yID8gaW50ZXJwb2xhdGVSZ2JcbiAgICAgIDogKGMgPSBjb2xvcihiKSkgPyAoYiA9IGMsIGludGVycG9sYXRlUmdiKVxuICAgICAgOiBpbnRlcnBvbGF0ZVN0cmluZykoYSwgYik7XG59XG4iLCAiaW1wb3J0IHtpbnRlcnBvbGF0ZVRyYW5zZm9ybVN2ZyBhcyBpbnRlcnBvbGF0ZVRyYW5zZm9ybX0gZnJvbSBcImQzLWludGVycG9sYXRlXCI7XG5pbXBvcnQge25hbWVzcGFjZX0gZnJvbSBcImQzLXNlbGVjdGlvblwiO1xuaW1wb3J0IHt0d2VlblZhbHVlfSBmcm9tIFwiLi90d2Vlbi5qc1wiO1xuaW1wb3J0IGludGVycG9sYXRlIGZyb20gXCIuL2ludGVycG9sYXRlLmpzXCI7XG5cbmZ1bmN0aW9uIGF0dHJSZW1vdmUobmFtZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5yZW1vdmVBdHRyaWJ1dGUobmFtZSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGF0dHJSZW1vdmVOUyhmdWxsbmFtZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5yZW1vdmVBdHRyaWJ1dGVOUyhmdWxsbmFtZS5zcGFjZSwgZnVsbG5hbWUubG9jYWwpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBhdHRyQ29uc3RhbnQobmFtZSwgaW50ZXJwb2xhdGUsIHZhbHVlMSkge1xuICB2YXIgc3RyaW5nMDAsXG4gICAgICBzdHJpbmcxID0gdmFsdWUxICsgXCJcIixcbiAgICAgIGludGVycG9sYXRlMDtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBzdHJpbmcwID0gdGhpcy5nZXRBdHRyaWJ1dGUobmFtZSk7XG4gICAgcmV0dXJuIHN0cmluZzAgPT09IHN0cmluZzEgPyBudWxsXG4gICAgICAgIDogc3RyaW5nMCA9PT0gc3RyaW5nMDAgPyBpbnRlcnBvbGF0ZTBcbiAgICAgICAgOiBpbnRlcnBvbGF0ZTAgPSBpbnRlcnBvbGF0ZShzdHJpbmcwMCA9IHN0cmluZzAsIHZhbHVlMSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGF0dHJDb25zdGFudE5TKGZ1bGxuYW1lLCBpbnRlcnBvbGF0ZSwgdmFsdWUxKSB7XG4gIHZhciBzdHJpbmcwMCxcbiAgICAgIHN0cmluZzEgPSB2YWx1ZTEgKyBcIlwiLFxuICAgICAgaW50ZXJwb2xhdGUwO1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHN0cmluZzAgPSB0aGlzLmdldEF0dHJpYnV0ZU5TKGZ1bGxuYW1lLnNwYWNlLCBmdWxsbmFtZS5sb2NhbCk7XG4gICAgcmV0dXJuIHN0cmluZzAgPT09IHN0cmluZzEgPyBudWxsXG4gICAgICAgIDogc3RyaW5nMCA9PT0gc3RyaW5nMDAgPyBpbnRlcnBvbGF0ZTBcbiAgICAgICAgOiBpbnRlcnBvbGF0ZTAgPSBpbnRlcnBvbGF0ZShzdHJpbmcwMCA9IHN0cmluZzAsIHZhbHVlMSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGF0dHJGdW5jdGlvbihuYW1lLCBpbnRlcnBvbGF0ZSwgdmFsdWUpIHtcbiAgdmFyIHN0cmluZzAwLFxuICAgICAgc3RyaW5nMTAsXG4gICAgICBpbnRlcnBvbGF0ZTA7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc3RyaW5nMCwgdmFsdWUxID0gdmFsdWUodGhpcyksIHN0cmluZzE7XG4gICAgaWYgKHZhbHVlMSA9PSBudWxsKSByZXR1cm4gdm9pZCB0aGlzLnJlbW92ZUF0dHJpYnV0ZShuYW1lKTtcbiAgICBzdHJpbmcwID0gdGhpcy5nZXRBdHRyaWJ1dGUobmFtZSk7XG4gICAgc3RyaW5nMSA9IHZhbHVlMSArIFwiXCI7XG4gICAgcmV0dXJuIHN0cmluZzAgPT09IHN0cmluZzEgPyBudWxsXG4gICAgICAgIDogc3RyaW5nMCA9PT0gc3RyaW5nMDAgJiYgc3RyaW5nMSA9PT0gc3RyaW5nMTAgPyBpbnRlcnBvbGF0ZTBcbiAgICAgICAgOiAoc3RyaW5nMTAgPSBzdHJpbmcxLCBpbnRlcnBvbGF0ZTAgPSBpbnRlcnBvbGF0ZShzdHJpbmcwMCA9IHN0cmluZzAsIHZhbHVlMSkpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBhdHRyRnVuY3Rpb25OUyhmdWxsbmFtZSwgaW50ZXJwb2xhdGUsIHZhbHVlKSB7XG4gIHZhciBzdHJpbmcwMCxcbiAgICAgIHN0cmluZzEwLFxuICAgICAgaW50ZXJwb2xhdGUwO1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHN0cmluZzAsIHZhbHVlMSA9IHZhbHVlKHRoaXMpLCBzdHJpbmcxO1xuICAgIGlmICh2YWx1ZTEgPT0gbnVsbCkgcmV0dXJuIHZvaWQgdGhpcy5yZW1vdmVBdHRyaWJ1dGVOUyhmdWxsbmFtZS5zcGFjZSwgZnVsbG5hbWUubG9jYWwpO1xuICAgIHN0cmluZzAgPSB0aGlzLmdldEF0dHJpYnV0ZU5TKGZ1bGxuYW1lLnNwYWNlLCBmdWxsbmFtZS5sb2NhbCk7XG4gICAgc3RyaW5nMSA9IHZhbHVlMSArIFwiXCI7XG4gICAgcmV0dXJuIHN0cmluZzAgPT09IHN0cmluZzEgPyBudWxsXG4gICAgICAgIDogc3RyaW5nMCA9PT0gc3RyaW5nMDAgJiYgc3RyaW5nMSA9PT0gc3RyaW5nMTAgPyBpbnRlcnBvbGF0ZTBcbiAgICAgICAgOiAoc3RyaW5nMTAgPSBzdHJpbmcxLCBpbnRlcnBvbGF0ZTAgPSBpbnRlcnBvbGF0ZShzdHJpbmcwMCA9IHN0cmluZzAsIHZhbHVlMSkpO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihuYW1lLCB2YWx1ZSkge1xuICB2YXIgZnVsbG5hbWUgPSBuYW1lc3BhY2UobmFtZSksIGkgPSBmdWxsbmFtZSA9PT0gXCJ0cmFuc2Zvcm1cIiA/IGludGVycG9sYXRlVHJhbnNmb3JtIDogaW50ZXJwb2xhdGU7XG4gIHJldHVybiB0aGlzLmF0dHJUd2VlbihuYW1lLCB0eXBlb2YgdmFsdWUgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgPyAoZnVsbG5hbWUubG9jYWwgPyBhdHRyRnVuY3Rpb25OUyA6IGF0dHJGdW5jdGlvbikoZnVsbG5hbWUsIGksIHR3ZWVuVmFsdWUodGhpcywgXCJhdHRyLlwiICsgbmFtZSwgdmFsdWUpKVxuICAgICAgOiB2YWx1ZSA9PSBudWxsID8gKGZ1bGxuYW1lLmxvY2FsID8gYXR0clJlbW92ZU5TIDogYXR0clJlbW92ZSkoZnVsbG5hbWUpXG4gICAgICA6IChmdWxsbmFtZS5sb2NhbCA/IGF0dHJDb25zdGFudE5TIDogYXR0ckNvbnN0YW50KShmdWxsbmFtZSwgaSwgdmFsdWUpKTtcbn1cbiIsICJpbXBvcnQge25hbWVzcGFjZX0gZnJvbSBcImQzLXNlbGVjdGlvblwiO1xuXG5mdW5jdGlvbiBhdHRySW50ZXJwb2xhdGUobmFtZSwgaSkge1xuICByZXR1cm4gZnVuY3Rpb24odCkge1xuICAgIHRoaXMuc2V0QXR0cmlidXRlKG5hbWUsIGkuY2FsbCh0aGlzLCB0KSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGF0dHJJbnRlcnBvbGF0ZU5TKGZ1bGxuYW1lLCBpKSB7XG4gIHJldHVybiBmdW5jdGlvbih0KSB7XG4gICAgdGhpcy5zZXRBdHRyaWJ1dGVOUyhmdWxsbmFtZS5zcGFjZSwgZnVsbG5hbWUubG9jYWwsIGkuY2FsbCh0aGlzLCB0KSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGF0dHJUd2Vlbk5TKGZ1bGxuYW1lLCB2YWx1ZSkge1xuICB2YXIgdDAsIGkwO1xuICBmdW5jdGlvbiB0d2VlbigpIHtcbiAgICB2YXIgaSA9IHZhbHVlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgaWYgKGkgIT09IGkwKSB0MCA9IChpMCA9IGkpICYmIGF0dHJJbnRlcnBvbGF0ZU5TKGZ1bGxuYW1lLCBpKTtcbiAgICByZXR1cm4gdDA7XG4gIH1cbiAgdHdlZW4uX3ZhbHVlID0gdmFsdWU7XG4gIHJldHVybiB0d2Vlbjtcbn1cblxuZnVuY3Rpb24gYXR0clR3ZWVuKG5hbWUsIHZhbHVlKSB7XG4gIHZhciB0MCwgaTA7XG4gIGZ1bmN0aW9uIHR3ZWVuKCkge1xuICAgIHZhciBpID0gdmFsdWUuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICBpZiAoaSAhPT0gaTApIHQwID0gKGkwID0gaSkgJiYgYXR0ckludGVycG9sYXRlKG5hbWUsIGkpO1xuICAgIHJldHVybiB0MDtcbiAgfVxuICB0d2Vlbi5fdmFsdWUgPSB2YWx1ZTtcbiAgcmV0dXJuIHR3ZWVuO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihuYW1lLCB2YWx1ZSkge1xuICB2YXIga2V5ID0gXCJhdHRyLlwiICsgbmFtZTtcbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPCAyKSByZXR1cm4gKGtleSA9IHRoaXMudHdlZW4oa2V5KSkgJiYga2V5Ll92YWx1ZTtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiB0aGlzLnR3ZWVuKGtleSwgbnVsbCk7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yO1xuICB2YXIgZnVsbG5hbWUgPSBuYW1lc3BhY2UobmFtZSk7XG4gIHJldHVybiB0aGlzLnR3ZWVuKGtleSwgKGZ1bGxuYW1lLmxvY2FsID8gYXR0clR3ZWVuTlMgOiBhdHRyVHdlZW4pKGZ1bGxuYW1lLCB2YWx1ZSkpO1xufVxuIiwgImltcG9ydCB7Z2V0LCBpbml0fSBmcm9tIFwiLi9zY2hlZHVsZS5qc1wiO1xuXG5mdW5jdGlvbiBkZWxheUZ1bmN0aW9uKGlkLCB2YWx1ZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgaW5pdCh0aGlzLCBpZCkuZGVsYXkgPSArdmFsdWUuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gZGVsYXlDb25zdGFudChpZCwgdmFsdWUpIHtcbiAgcmV0dXJuIHZhbHVlID0gK3ZhbHVlLCBmdW5jdGlvbigpIHtcbiAgICBpbml0KHRoaXMsIGlkKS5kZWxheSA9IHZhbHVlO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih2YWx1ZSkge1xuICB2YXIgaWQgPSB0aGlzLl9pZDtcblxuICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aFxuICAgICAgPyB0aGlzLmVhY2goKHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgICAgICAgPyBkZWxheUZ1bmN0aW9uXG4gICAgICAgICAgOiBkZWxheUNvbnN0YW50KShpZCwgdmFsdWUpKVxuICAgICAgOiBnZXQodGhpcy5ub2RlKCksIGlkKS5kZWxheTtcbn1cbiIsICJpbXBvcnQge2dldCwgc2V0fSBmcm9tIFwiLi9zY2hlZHVsZS5qc1wiO1xuXG5mdW5jdGlvbiBkdXJhdGlvbkZ1bmN0aW9uKGlkLCB2YWx1ZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgc2V0KHRoaXMsIGlkKS5kdXJhdGlvbiA9ICt2YWx1ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBkdXJhdGlvbkNvbnN0YW50KGlkLCB2YWx1ZSkge1xuICByZXR1cm4gdmFsdWUgPSArdmFsdWUsIGZ1bmN0aW9uKCkge1xuICAgIHNldCh0aGlzLCBpZCkuZHVyYXRpb24gPSB2YWx1ZTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24odmFsdWUpIHtcbiAgdmFyIGlkID0gdGhpcy5faWQ7XG5cbiAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGhcbiAgICAgID8gdGhpcy5lYWNoKCh0eXBlb2YgdmFsdWUgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgICAgID8gZHVyYXRpb25GdW5jdGlvblxuICAgICAgICAgIDogZHVyYXRpb25Db25zdGFudCkoaWQsIHZhbHVlKSlcbiAgICAgIDogZ2V0KHRoaXMubm9kZSgpLCBpZCkuZHVyYXRpb247XG59XG4iLCAiaW1wb3J0IHtnZXQsIHNldH0gZnJvbSBcIi4vc2NoZWR1bGUuanNcIjtcblxuZnVuY3Rpb24gZWFzZUNvbnN0YW50KGlkLCB2YWx1ZSkge1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcjtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHNldCh0aGlzLCBpZCkuZWFzZSA9IHZhbHVlO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih2YWx1ZSkge1xuICB2YXIgaWQgPSB0aGlzLl9pZDtcblxuICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aFxuICAgICAgPyB0aGlzLmVhY2goZWFzZUNvbnN0YW50KGlkLCB2YWx1ZSkpXG4gICAgICA6IGdldCh0aGlzLm5vZGUoKSwgaWQpLmVhc2U7XG59XG4iLCAiaW1wb3J0IHtzZXR9IGZyb20gXCIuL3NjaGVkdWxlLmpzXCI7XG5cbmZ1bmN0aW9uIGVhc2VWYXJ5aW5nKGlkLCB2YWx1ZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHYgPSB2YWx1ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIGlmICh0eXBlb2YgdiAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3I7XG4gICAgc2V0KHRoaXMsIGlkKS5lYXNlID0gdjtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24odmFsdWUpIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3I7XG4gIHJldHVybiB0aGlzLmVhY2goZWFzZVZhcnlpbmcodGhpcy5faWQsIHZhbHVlKSk7XG59XG4iLCAiaW1wb3J0IHttYXRjaGVyfSBmcm9tIFwiZDMtc2VsZWN0aW9uXCI7XG5pbXBvcnQge1RyYW5zaXRpb259IGZyb20gXCIuL2luZGV4LmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG1hdGNoKSB7XG4gIGlmICh0eXBlb2YgbWF0Y2ggIT09IFwiZnVuY3Rpb25cIikgbWF0Y2ggPSBtYXRjaGVyKG1hdGNoKTtcblxuICBmb3IgKHZhciBncm91cHMgPSB0aGlzLl9ncm91cHMsIG0gPSBncm91cHMubGVuZ3RoLCBzdWJncm91cHMgPSBuZXcgQXJyYXkobSksIGogPSAwOyBqIDwgbTsgKytqKSB7XG4gICAgZm9yICh2YXIgZ3JvdXAgPSBncm91cHNbal0sIG4gPSBncm91cC5sZW5ndGgsIHN1Ymdyb3VwID0gc3ViZ3JvdXBzW2pdID0gW10sIG5vZGUsIGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAoKG5vZGUgPSBncm91cFtpXSkgJiYgbWF0Y2guY2FsbChub2RlLCBub2RlLl9fZGF0YV9fLCBpLCBncm91cCkpIHtcbiAgICAgICAgc3ViZ3JvdXAucHVzaChub2RlKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gbmV3IFRyYW5zaXRpb24oc3ViZ3JvdXBzLCB0aGlzLl9wYXJlbnRzLCB0aGlzLl9uYW1lLCB0aGlzLl9pZCk7XG59XG4iLCAiaW1wb3J0IHtUcmFuc2l0aW9ufSBmcm9tIFwiLi9pbmRleC5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih0cmFuc2l0aW9uKSB7XG4gIGlmICh0cmFuc2l0aW9uLl9pZCAhPT0gdGhpcy5faWQpIHRocm93IG5ldyBFcnJvcjtcblxuICBmb3IgKHZhciBncm91cHMwID0gdGhpcy5fZ3JvdXBzLCBncm91cHMxID0gdHJhbnNpdGlvbi5fZ3JvdXBzLCBtMCA9IGdyb3VwczAubGVuZ3RoLCBtMSA9IGdyb3VwczEubGVuZ3RoLCBtID0gTWF0aC5taW4obTAsIG0xKSwgbWVyZ2VzID0gbmV3IEFycmF5KG0wKSwgaiA9IDA7IGogPCBtOyArK2opIHtcbiAgICBmb3IgKHZhciBncm91cDAgPSBncm91cHMwW2pdLCBncm91cDEgPSBncm91cHMxW2pdLCBuID0gZ3JvdXAwLmxlbmd0aCwgbWVyZ2UgPSBtZXJnZXNbal0gPSBuZXcgQXJyYXkobiksIG5vZGUsIGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAobm9kZSA9IGdyb3VwMFtpXSB8fCBncm91cDFbaV0pIHtcbiAgICAgICAgbWVyZ2VbaV0gPSBub2RlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGZvciAoOyBqIDwgbTA7ICsraikge1xuICAgIG1lcmdlc1tqXSA9IGdyb3VwczBbal07XG4gIH1cblxuICByZXR1cm4gbmV3IFRyYW5zaXRpb24obWVyZ2VzLCB0aGlzLl9wYXJlbnRzLCB0aGlzLl9uYW1lLCB0aGlzLl9pZCk7XG59XG4iLCAiaW1wb3J0IHtnZXQsIHNldCwgaW5pdH0gZnJvbSBcIi4vc2NoZWR1bGUuanNcIjtcblxuZnVuY3Rpb24gc3RhcnQobmFtZSkge1xuICByZXR1cm4gKG5hbWUgKyBcIlwiKS50cmltKCkuc3BsaXQoL158XFxzKy8pLmV2ZXJ5KGZ1bmN0aW9uKHQpIHtcbiAgICB2YXIgaSA9IHQuaW5kZXhPZihcIi5cIik7XG4gICAgaWYgKGkgPj0gMCkgdCA9IHQuc2xpY2UoMCwgaSk7XG4gICAgcmV0dXJuICF0IHx8IHQgPT09IFwic3RhcnRcIjtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIG9uRnVuY3Rpb24oaWQsIG5hbWUsIGxpc3RlbmVyKSB7XG4gIHZhciBvbjAsIG9uMSwgc2l0ID0gc3RhcnQobmFtZSkgPyBpbml0IDogc2V0O1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNjaGVkdWxlID0gc2l0KHRoaXMsIGlkKSxcbiAgICAgICAgb24gPSBzY2hlZHVsZS5vbjtcblxuICAgIC8vIElmIHRoaXMgbm9kZSBzaGFyZWQgYSBkaXNwYXRjaCB3aXRoIHRoZSBwcmV2aW91cyBub2RlLFxuICAgIC8vIGp1c3QgYXNzaWduIHRoZSB1cGRhdGVkIHNoYXJlZCBkaXNwYXRjaCBhbmQgd2VcdTIwMTlyZSBkb25lIVxuICAgIC8vIE90aGVyd2lzZSwgY29weS1vbi13cml0ZS5cbiAgICBpZiAob24gIT09IG9uMCkgKG9uMSA9IChvbjAgPSBvbikuY29weSgpKS5vbihuYW1lLCBsaXN0ZW5lcik7XG5cbiAgICBzY2hlZHVsZS5vbiA9IG9uMTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSwgbGlzdGVuZXIpIHtcbiAgdmFyIGlkID0gdGhpcy5faWQ7XG5cbiAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPCAyXG4gICAgICA/IGdldCh0aGlzLm5vZGUoKSwgaWQpLm9uLm9uKG5hbWUpXG4gICAgICA6IHRoaXMuZWFjaChvbkZ1bmN0aW9uKGlkLCBuYW1lLCBsaXN0ZW5lcikpO1xufVxuIiwgImZ1bmN0aW9uIHJlbW92ZUZ1bmN0aW9uKGlkKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgcGFyZW50ID0gdGhpcy5wYXJlbnROb2RlO1xuICAgIGZvciAodmFyIGkgaW4gdGhpcy5fX3RyYW5zaXRpb24pIGlmICgraSAhPT0gaWQpIHJldHVybjtcbiAgICBpZiAocGFyZW50KSBwYXJlbnQucmVtb3ZlQ2hpbGQodGhpcyk7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5vbihcImVuZC5yZW1vdmVcIiwgcmVtb3ZlRnVuY3Rpb24odGhpcy5faWQpKTtcbn1cbiIsICJpbXBvcnQge3NlbGVjdG9yfSBmcm9tIFwiZDMtc2VsZWN0aW9uXCI7XG5pbXBvcnQge1RyYW5zaXRpb259IGZyb20gXCIuL2luZGV4LmpzXCI7XG5pbXBvcnQgc2NoZWR1bGUsIHtnZXR9IGZyb20gXCIuL3NjaGVkdWxlLmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHNlbGVjdCkge1xuICB2YXIgbmFtZSA9IHRoaXMuX25hbWUsXG4gICAgICBpZCA9IHRoaXMuX2lkO1xuXG4gIGlmICh0eXBlb2Ygc2VsZWN0ICE9PSBcImZ1bmN0aW9uXCIpIHNlbGVjdCA9IHNlbGVjdG9yKHNlbGVjdCk7XG5cbiAgZm9yICh2YXIgZ3JvdXBzID0gdGhpcy5fZ3JvdXBzLCBtID0gZ3JvdXBzLmxlbmd0aCwgc3ViZ3JvdXBzID0gbmV3IEFycmF5KG0pLCBqID0gMDsgaiA8IG07ICsraikge1xuICAgIGZvciAodmFyIGdyb3VwID0gZ3JvdXBzW2pdLCBuID0gZ3JvdXAubGVuZ3RoLCBzdWJncm91cCA9IHN1Ymdyb3Vwc1tqXSA9IG5ldyBBcnJheShuKSwgbm9kZSwgc3Vibm9kZSwgaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIGlmICgobm9kZSA9IGdyb3VwW2ldKSAmJiAoc3Vibm9kZSA9IHNlbGVjdC5jYWxsKG5vZGUsIG5vZGUuX19kYXRhX18sIGksIGdyb3VwKSkpIHtcbiAgICAgICAgaWYgKFwiX19kYXRhX19cIiBpbiBub2RlKSBzdWJub2RlLl9fZGF0YV9fID0gbm9kZS5fX2RhdGFfXztcbiAgICAgICAgc3ViZ3JvdXBbaV0gPSBzdWJub2RlO1xuICAgICAgICBzY2hlZHVsZShzdWJncm91cFtpXSwgbmFtZSwgaWQsIGksIHN1Ymdyb3VwLCBnZXQobm9kZSwgaWQpKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gbmV3IFRyYW5zaXRpb24oc3ViZ3JvdXBzLCB0aGlzLl9wYXJlbnRzLCBuYW1lLCBpZCk7XG59XG4iLCAiaW1wb3J0IHtzZWxlY3RvckFsbH0gZnJvbSBcImQzLXNlbGVjdGlvblwiO1xuaW1wb3J0IHtUcmFuc2l0aW9ufSBmcm9tIFwiLi9pbmRleC5qc1wiO1xuaW1wb3J0IHNjaGVkdWxlLCB7Z2V0fSBmcm9tIFwiLi9zY2hlZHVsZS5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihzZWxlY3QpIHtcbiAgdmFyIG5hbWUgPSB0aGlzLl9uYW1lLFxuICAgICAgaWQgPSB0aGlzLl9pZDtcblxuICBpZiAodHlwZW9mIHNlbGVjdCAhPT0gXCJmdW5jdGlvblwiKSBzZWxlY3QgPSBzZWxlY3RvckFsbChzZWxlY3QpO1xuXG4gIGZvciAodmFyIGdyb3VwcyA9IHRoaXMuX2dyb3VwcywgbSA9IGdyb3Vwcy5sZW5ndGgsIHN1Ymdyb3VwcyA9IFtdLCBwYXJlbnRzID0gW10sIGogPSAwOyBqIDwgbTsgKytqKSB7XG4gICAgZm9yICh2YXIgZ3JvdXAgPSBncm91cHNbal0sIG4gPSBncm91cC5sZW5ndGgsIG5vZGUsIGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAobm9kZSA9IGdyb3VwW2ldKSB7XG4gICAgICAgIGZvciAodmFyIGNoaWxkcmVuID0gc2VsZWN0LmNhbGwobm9kZSwgbm9kZS5fX2RhdGFfXywgaSwgZ3JvdXApLCBjaGlsZCwgaW5oZXJpdCA9IGdldChub2RlLCBpZCksIGsgPSAwLCBsID0gY2hpbGRyZW4ubGVuZ3RoOyBrIDwgbDsgKytrKSB7XG4gICAgICAgICAgaWYgKGNoaWxkID0gY2hpbGRyZW5ba10pIHtcbiAgICAgICAgICAgIHNjaGVkdWxlKGNoaWxkLCBuYW1lLCBpZCwgaywgY2hpbGRyZW4sIGluaGVyaXQpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBzdWJncm91cHMucHVzaChjaGlsZHJlbik7XG4gICAgICAgIHBhcmVudHMucHVzaChub2RlKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gbmV3IFRyYW5zaXRpb24oc3ViZ3JvdXBzLCBwYXJlbnRzLCBuYW1lLCBpZCk7XG59XG4iLCAiaW1wb3J0IHtzZWxlY3Rpb259IGZyb20gXCJkMy1zZWxlY3Rpb25cIjtcblxudmFyIFNlbGVjdGlvbiA9IHNlbGVjdGlvbi5wcm90b3R5cGUuY29uc3RydWN0b3I7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gbmV3IFNlbGVjdGlvbih0aGlzLl9ncm91cHMsIHRoaXMuX3BhcmVudHMpO1xufVxuIiwgImltcG9ydCB7aW50ZXJwb2xhdGVUcmFuc2Zvcm1Dc3MgYXMgaW50ZXJwb2xhdGVUcmFuc2Zvcm19IGZyb20gXCJkMy1pbnRlcnBvbGF0ZVwiO1xuaW1wb3J0IHtzdHlsZX0gZnJvbSBcImQzLXNlbGVjdGlvblwiO1xuaW1wb3J0IHtzZXR9IGZyb20gXCIuL3NjaGVkdWxlLmpzXCI7XG5pbXBvcnQge3R3ZWVuVmFsdWV9IGZyb20gXCIuL3R3ZWVuLmpzXCI7XG5pbXBvcnQgaW50ZXJwb2xhdGUgZnJvbSBcIi4vaW50ZXJwb2xhdGUuanNcIjtcblxuZnVuY3Rpb24gc3R5bGVOdWxsKG5hbWUsIGludGVycG9sYXRlKSB7XG4gIHZhciBzdHJpbmcwMCxcbiAgICAgIHN0cmluZzEwLFxuICAgICAgaW50ZXJwb2xhdGUwO1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHN0cmluZzAgPSBzdHlsZSh0aGlzLCBuYW1lKSxcbiAgICAgICAgc3RyaW5nMSA9ICh0aGlzLnN0eWxlLnJlbW92ZVByb3BlcnR5KG5hbWUpLCBzdHlsZSh0aGlzLCBuYW1lKSk7XG4gICAgcmV0dXJuIHN0cmluZzAgPT09IHN0cmluZzEgPyBudWxsXG4gICAgICAgIDogc3RyaW5nMCA9PT0gc3RyaW5nMDAgJiYgc3RyaW5nMSA9PT0gc3RyaW5nMTAgPyBpbnRlcnBvbGF0ZTBcbiAgICAgICAgOiBpbnRlcnBvbGF0ZTAgPSBpbnRlcnBvbGF0ZShzdHJpbmcwMCA9IHN0cmluZzAsIHN0cmluZzEwID0gc3RyaW5nMSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIHN0eWxlUmVtb3ZlKG5hbWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuc3R5bGUucmVtb3ZlUHJvcGVydHkobmFtZSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIHN0eWxlQ29uc3RhbnQobmFtZSwgaW50ZXJwb2xhdGUsIHZhbHVlMSkge1xuICB2YXIgc3RyaW5nMDAsXG4gICAgICBzdHJpbmcxID0gdmFsdWUxICsgXCJcIixcbiAgICAgIGludGVycG9sYXRlMDtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBzdHJpbmcwID0gc3R5bGUodGhpcywgbmFtZSk7XG4gICAgcmV0dXJuIHN0cmluZzAgPT09IHN0cmluZzEgPyBudWxsXG4gICAgICAgIDogc3RyaW5nMCA9PT0gc3RyaW5nMDAgPyBpbnRlcnBvbGF0ZTBcbiAgICAgICAgOiBpbnRlcnBvbGF0ZTAgPSBpbnRlcnBvbGF0ZShzdHJpbmcwMCA9IHN0cmluZzAsIHZhbHVlMSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIHN0eWxlRnVuY3Rpb24obmFtZSwgaW50ZXJwb2xhdGUsIHZhbHVlKSB7XG4gIHZhciBzdHJpbmcwMCxcbiAgICAgIHN0cmluZzEwLFxuICAgICAgaW50ZXJwb2xhdGUwO1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHN0cmluZzAgPSBzdHlsZSh0aGlzLCBuYW1lKSxcbiAgICAgICAgdmFsdWUxID0gdmFsdWUodGhpcyksXG4gICAgICAgIHN0cmluZzEgPSB2YWx1ZTEgKyBcIlwiO1xuICAgIGlmICh2YWx1ZTEgPT0gbnVsbCkgc3RyaW5nMSA9IHZhbHVlMSA9ICh0aGlzLnN0eWxlLnJlbW92ZVByb3BlcnR5KG5hbWUpLCBzdHlsZSh0aGlzLCBuYW1lKSk7XG4gICAgcmV0dXJuIHN0cmluZzAgPT09IHN0cmluZzEgPyBudWxsXG4gICAgICAgIDogc3RyaW5nMCA9PT0gc3RyaW5nMDAgJiYgc3RyaW5nMSA9PT0gc3RyaW5nMTAgPyBpbnRlcnBvbGF0ZTBcbiAgICAgICAgOiAoc3RyaW5nMTAgPSBzdHJpbmcxLCBpbnRlcnBvbGF0ZTAgPSBpbnRlcnBvbGF0ZShzdHJpbmcwMCA9IHN0cmluZzAsIHZhbHVlMSkpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBzdHlsZU1heWJlUmVtb3ZlKGlkLCBuYW1lKSB7XG4gIHZhciBvbjAsIG9uMSwgbGlzdGVuZXIwLCBrZXkgPSBcInN0eWxlLlwiICsgbmFtZSwgZXZlbnQgPSBcImVuZC5cIiArIGtleSwgcmVtb3ZlO1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNjaGVkdWxlID0gc2V0KHRoaXMsIGlkKSxcbiAgICAgICAgb24gPSBzY2hlZHVsZS5vbixcbiAgICAgICAgbGlzdGVuZXIgPSBzY2hlZHVsZS52YWx1ZVtrZXldID09IG51bGwgPyByZW1vdmUgfHwgKHJlbW92ZSA9IHN0eWxlUmVtb3ZlKG5hbWUpKSA6IHVuZGVmaW5lZDtcblxuICAgIC8vIElmIHRoaXMgbm9kZSBzaGFyZWQgYSBkaXNwYXRjaCB3aXRoIHRoZSBwcmV2aW91cyBub2RlLFxuICAgIC8vIGp1c3QgYXNzaWduIHRoZSB1cGRhdGVkIHNoYXJlZCBkaXNwYXRjaCBhbmQgd2VcdTIwMTlyZSBkb25lIVxuICAgIC8vIE90aGVyd2lzZSwgY29weS1vbi13cml0ZS5cbiAgICBpZiAob24gIT09IG9uMCB8fCBsaXN0ZW5lcjAgIT09IGxpc3RlbmVyKSAob24xID0gKG9uMCA9IG9uKS5jb3B5KCkpLm9uKGV2ZW50LCBsaXN0ZW5lcjAgPSBsaXN0ZW5lcik7XG5cbiAgICBzY2hlZHVsZS5vbiA9IG9uMTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSwgdmFsdWUsIHByaW9yaXR5KSB7XG4gIHZhciBpID0gKG5hbWUgKz0gXCJcIikgPT09IFwidHJhbnNmb3JtXCIgPyBpbnRlcnBvbGF0ZVRyYW5zZm9ybSA6IGludGVycG9sYXRlO1xuICByZXR1cm4gdmFsdWUgPT0gbnVsbCA/IHRoaXNcbiAgICAgIC5zdHlsZVR3ZWVuKG5hbWUsIHN0eWxlTnVsbChuYW1lLCBpKSlcbiAgICAgIC5vbihcImVuZC5zdHlsZS5cIiArIG5hbWUsIHN0eWxlUmVtb3ZlKG5hbWUpKVxuICAgIDogdHlwZW9mIHZhbHVlID09PSBcImZ1bmN0aW9uXCIgPyB0aGlzXG4gICAgICAuc3R5bGVUd2VlbihuYW1lLCBzdHlsZUZ1bmN0aW9uKG5hbWUsIGksIHR3ZWVuVmFsdWUodGhpcywgXCJzdHlsZS5cIiArIG5hbWUsIHZhbHVlKSkpXG4gICAgICAuZWFjaChzdHlsZU1heWJlUmVtb3ZlKHRoaXMuX2lkLCBuYW1lKSlcbiAgICA6IHRoaXNcbiAgICAgIC5zdHlsZVR3ZWVuKG5hbWUsIHN0eWxlQ29uc3RhbnQobmFtZSwgaSwgdmFsdWUpLCBwcmlvcml0eSlcbiAgICAgIC5vbihcImVuZC5zdHlsZS5cIiArIG5hbWUsIG51bGwpO1xufVxuIiwgImZ1bmN0aW9uIHN0eWxlSW50ZXJwb2xhdGUobmFtZSwgaSwgcHJpb3JpdHkpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKHQpIHtcbiAgICB0aGlzLnN0eWxlLnNldFByb3BlcnR5KG5hbWUsIGkuY2FsbCh0aGlzLCB0KSwgcHJpb3JpdHkpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBzdHlsZVR3ZWVuKG5hbWUsIHZhbHVlLCBwcmlvcml0eSkge1xuICB2YXIgdCwgaTA7XG4gIGZ1bmN0aW9uIHR3ZWVuKCkge1xuICAgIHZhciBpID0gdmFsdWUuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICBpZiAoaSAhPT0gaTApIHQgPSAoaTAgPSBpKSAmJiBzdHlsZUludGVycG9sYXRlKG5hbWUsIGksIHByaW9yaXR5KTtcbiAgICByZXR1cm4gdDtcbiAgfVxuICB0d2Vlbi5fdmFsdWUgPSB2YWx1ZTtcbiAgcmV0dXJuIHR3ZWVuO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihuYW1lLCB2YWx1ZSwgcHJpb3JpdHkpIHtcbiAgdmFyIGtleSA9IFwic3R5bGUuXCIgKyAobmFtZSArPSBcIlwiKTtcbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPCAyKSByZXR1cm4gKGtleSA9IHRoaXMudHdlZW4oa2V5KSkgJiYga2V5Ll92YWx1ZTtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiB0aGlzLnR3ZWVuKGtleSwgbnVsbCk7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yO1xuICByZXR1cm4gdGhpcy50d2VlbihrZXksIHN0eWxlVHdlZW4obmFtZSwgdmFsdWUsIHByaW9yaXR5ID09IG51bGwgPyBcIlwiIDogcHJpb3JpdHkpKTtcbn1cbiIsICJpbXBvcnQge3R3ZWVuVmFsdWV9IGZyb20gXCIuL3R3ZWVuLmpzXCI7XG5cbmZ1bmN0aW9uIHRleHRDb25zdGFudCh2YWx1ZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy50ZXh0Q29udGVudCA9IHZhbHVlO1xuICB9O1xufVxuXG5mdW5jdGlvbiB0ZXh0RnVuY3Rpb24odmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciB2YWx1ZTEgPSB2YWx1ZSh0aGlzKTtcbiAgICB0aGlzLnRleHRDb250ZW50ID0gdmFsdWUxID09IG51bGwgPyBcIlwiIDogdmFsdWUxO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih2YWx1ZSkge1xuICByZXR1cm4gdGhpcy50d2VlbihcInRleHRcIiwgdHlwZW9mIHZhbHVlID09PSBcImZ1bmN0aW9uXCJcbiAgICAgID8gdGV4dEZ1bmN0aW9uKHR3ZWVuVmFsdWUodGhpcywgXCJ0ZXh0XCIsIHZhbHVlKSlcbiAgICAgIDogdGV4dENvbnN0YW50KHZhbHVlID09IG51bGwgPyBcIlwiIDogdmFsdWUgKyBcIlwiKSk7XG59XG4iLCAiZnVuY3Rpb24gdGV4dEludGVycG9sYXRlKGkpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKHQpIHtcbiAgICB0aGlzLnRleHRDb250ZW50ID0gaS5jYWxsKHRoaXMsIHQpO1xuICB9O1xufVxuXG5mdW5jdGlvbiB0ZXh0VHdlZW4odmFsdWUpIHtcbiAgdmFyIHQwLCBpMDtcbiAgZnVuY3Rpb24gdHdlZW4oKSB7XG4gICAgdmFyIGkgPSB2YWx1ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIGlmIChpICE9PSBpMCkgdDAgPSAoaTAgPSBpKSAmJiB0ZXh0SW50ZXJwb2xhdGUoaSk7XG4gICAgcmV0dXJuIHQwO1xuICB9XG4gIHR3ZWVuLl92YWx1ZSA9IHZhbHVlO1xuICByZXR1cm4gdHdlZW47XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHZhbHVlKSB7XG4gIHZhciBrZXkgPSBcInRleHRcIjtcbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPCAxKSByZXR1cm4gKGtleSA9IHRoaXMudHdlZW4oa2V5KSkgJiYga2V5Ll92YWx1ZTtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiB0aGlzLnR3ZWVuKGtleSwgbnVsbCk7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yO1xuICByZXR1cm4gdGhpcy50d2VlbihrZXksIHRleHRUd2Vlbih2YWx1ZSkpO1xufVxuIiwgImltcG9ydCB7VHJhbnNpdGlvbiwgbmV3SWR9IGZyb20gXCIuL2luZGV4LmpzXCI7XG5pbXBvcnQgc2NoZWR1bGUsIHtnZXR9IGZyb20gXCIuL3NjaGVkdWxlLmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKCkge1xuICB2YXIgbmFtZSA9IHRoaXMuX25hbWUsXG4gICAgICBpZDAgPSB0aGlzLl9pZCxcbiAgICAgIGlkMSA9IG5ld0lkKCk7XG5cbiAgZm9yICh2YXIgZ3JvdXBzID0gdGhpcy5fZ3JvdXBzLCBtID0gZ3JvdXBzLmxlbmd0aCwgaiA9IDA7IGogPCBtOyArK2opIHtcbiAgICBmb3IgKHZhciBncm91cCA9IGdyb3Vwc1tqXSwgbiA9IGdyb3VwLmxlbmd0aCwgbm9kZSwgaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIGlmIChub2RlID0gZ3JvdXBbaV0pIHtcbiAgICAgICAgdmFyIGluaGVyaXQgPSBnZXQobm9kZSwgaWQwKTtcbiAgICAgICAgc2NoZWR1bGUobm9kZSwgbmFtZSwgaWQxLCBpLCBncm91cCwge1xuICAgICAgICAgIHRpbWU6IGluaGVyaXQudGltZSArIGluaGVyaXQuZGVsYXkgKyBpbmhlcml0LmR1cmF0aW9uLFxuICAgICAgICAgIGRlbGF5OiAwLFxuICAgICAgICAgIGR1cmF0aW9uOiBpbmhlcml0LmR1cmF0aW9uLFxuICAgICAgICAgIGVhc2U6IGluaGVyaXQuZWFzZVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gbmV3IFRyYW5zaXRpb24oZ3JvdXBzLCB0aGlzLl9wYXJlbnRzLCBuYW1lLCBpZDEpO1xufVxuIiwgImltcG9ydCB7c2V0fSBmcm9tIFwiLi9zY2hlZHVsZS5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgdmFyIG9uMCwgb24xLCB0aGF0ID0gdGhpcywgaWQgPSB0aGF0Ll9pZCwgc2l6ZSA9IHRoYXQuc2l6ZSgpO1xuICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgdmFyIGNhbmNlbCA9IHt2YWx1ZTogcmVqZWN0fSxcbiAgICAgICAgZW5kID0ge3ZhbHVlOiBmdW5jdGlvbigpIHsgaWYgKC0tc2l6ZSA9PT0gMCkgcmVzb2x2ZSgpOyB9fTtcblxuICAgIHRoYXQuZWFjaChmdW5jdGlvbigpIHtcbiAgICAgIHZhciBzY2hlZHVsZSA9IHNldCh0aGlzLCBpZCksXG4gICAgICAgICAgb24gPSBzY2hlZHVsZS5vbjtcblxuICAgICAgLy8gSWYgdGhpcyBub2RlIHNoYXJlZCBhIGRpc3BhdGNoIHdpdGggdGhlIHByZXZpb3VzIG5vZGUsXG4gICAgICAvLyBqdXN0IGFzc2lnbiB0aGUgdXBkYXRlZCBzaGFyZWQgZGlzcGF0Y2ggYW5kIHdlXHUyMDE5cmUgZG9uZSFcbiAgICAgIC8vIE90aGVyd2lzZSwgY29weS1vbi13cml0ZS5cbiAgICAgIGlmIChvbiAhPT0gb24wKSB7XG4gICAgICAgIG9uMSA9IChvbjAgPSBvbikuY29weSgpO1xuICAgICAgICBvbjEuXy5jYW5jZWwucHVzaChjYW5jZWwpO1xuICAgICAgICBvbjEuXy5pbnRlcnJ1cHQucHVzaChjYW5jZWwpO1xuICAgICAgICBvbjEuXy5lbmQucHVzaChlbmQpO1xuICAgICAgfVxuXG4gICAgICBzY2hlZHVsZS5vbiA9IG9uMTtcbiAgICB9KTtcblxuICAgIC8vIFRoZSBzZWxlY3Rpb24gd2FzIGVtcHR5LCByZXNvbHZlIGVuZCBpbW1lZGlhdGVseVxuICAgIGlmIChzaXplID09PSAwKSByZXNvbHZlKCk7XG4gIH0pO1xufVxuIiwgImltcG9ydCB7c2VsZWN0aW9ufSBmcm9tIFwiZDMtc2VsZWN0aW9uXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl9hdHRyIGZyb20gXCIuL2F0dHIuanNcIjtcbmltcG9ydCB0cmFuc2l0aW9uX2F0dHJUd2VlbiBmcm9tIFwiLi9hdHRyVHdlZW4uanNcIjtcbmltcG9ydCB0cmFuc2l0aW9uX2RlbGF5IGZyb20gXCIuL2RlbGF5LmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl9kdXJhdGlvbiBmcm9tIFwiLi9kdXJhdGlvbi5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fZWFzZSBmcm9tIFwiLi9lYXNlLmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl9lYXNlVmFyeWluZyBmcm9tIFwiLi9lYXNlVmFyeWluZy5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fZmlsdGVyIGZyb20gXCIuL2ZpbHRlci5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fbWVyZ2UgZnJvbSBcIi4vbWVyZ2UuanNcIjtcbmltcG9ydCB0cmFuc2l0aW9uX29uIGZyb20gXCIuL29uLmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl9yZW1vdmUgZnJvbSBcIi4vcmVtb3ZlLmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl9zZWxlY3QgZnJvbSBcIi4vc2VsZWN0LmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl9zZWxlY3RBbGwgZnJvbSBcIi4vc2VsZWN0QWxsLmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl9zZWxlY3Rpb24gZnJvbSBcIi4vc2VsZWN0aW9uLmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl9zdHlsZSBmcm9tIFwiLi9zdHlsZS5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fc3R5bGVUd2VlbiBmcm9tIFwiLi9zdHlsZVR3ZWVuLmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl90ZXh0IGZyb20gXCIuL3RleHQuanNcIjtcbmltcG9ydCB0cmFuc2l0aW9uX3RleHRUd2VlbiBmcm9tIFwiLi90ZXh0VHdlZW4uanNcIjtcbmltcG9ydCB0cmFuc2l0aW9uX3RyYW5zaXRpb24gZnJvbSBcIi4vdHJhbnNpdGlvbi5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fdHdlZW4gZnJvbSBcIi4vdHdlZW4uanNcIjtcbmltcG9ydCB0cmFuc2l0aW9uX2VuZCBmcm9tIFwiLi9lbmQuanNcIjtcblxudmFyIGlkID0gMDtcblxuZXhwb3J0IGZ1bmN0aW9uIFRyYW5zaXRpb24oZ3JvdXBzLCBwYXJlbnRzLCBuYW1lLCBpZCkge1xuICB0aGlzLl9ncm91cHMgPSBncm91cHM7XG4gIHRoaXMuX3BhcmVudHMgPSBwYXJlbnRzO1xuICB0aGlzLl9uYW1lID0gbmFtZTtcbiAgdGhpcy5faWQgPSBpZDtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gdHJhbnNpdGlvbihuYW1lKSB7XG4gIHJldHVybiBzZWxlY3Rpb24oKS50cmFuc2l0aW9uKG5hbWUpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbmV3SWQoKSB7XG4gIHJldHVybiArK2lkO1xufVxuXG52YXIgc2VsZWN0aW9uX3Byb3RvdHlwZSA9IHNlbGVjdGlvbi5wcm90b3R5cGU7XG5cblRyYW5zaXRpb24ucHJvdG90eXBlID0gdHJhbnNpdGlvbi5wcm90b3R5cGUgPSB7XG4gIGNvbnN0cnVjdG9yOiBUcmFuc2l0aW9uLFxuICBzZWxlY3Q6IHRyYW5zaXRpb25fc2VsZWN0LFxuICBzZWxlY3RBbGw6IHRyYW5zaXRpb25fc2VsZWN0QWxsLFxuICBzZWxlY3RDaGlsZDogc2VsZWN0aW9uX3Byb3RvdHlwZS5zZWxlY3RDaGlsZCxcbiAgc2VsZWN0Q2hpbGRyZW46IHNlbGVjdGlvbl9wcm90b3R5cGUuc2VsZWN0Q2hpbGRyZW4sXG4gIGZpbHRlcjogdHJhbnNpdGlvbl9maWx0ZXIsXG4gIG1lcmdlOiB0cmFuc2l0aW9uX21lcmdlLFxuICBzZWxlY3Rpb246IHRyYW5zaXRpb25fc2VsZWN0aW9uLFxuICB0cmFuc2l0aW9uOiB0cmFuc2l0aW9uX3RyYW5zaXRpb24sXG4gIGNhbGw6IHNlbGVjdGlvbl9wcm90b3R5cGUuY2FsbCxcbiAgbm9kZXM6IHNlbGVjdGlvbl9wcm90b3R5cGUubm9kZXMsXG4gIG5vZGU6IHNlbGVjdGlvbl9wcm90b3R5cGUubm9kZSxcbiAgc2l6ZTogc2VsZWN0aW9uX3Byb3RvdHlwZS5zaXplLFxuICBlbXB0eTogc2VsZWN0aW9uX3Byb3RvdHlwZS5lbXB0eSxcbiAgZWFjaDogc2VsZWN0aW9uX3Byb3RvdHlwZS5lYWNoLFxuICBvbjogdHJhbnNpdGlvbl9vbixcbiAgYXR0cjogdHJhbnNpdGlvbl9hdHRyLFxuICBhdHRyVHdlZW46IHRyYW5zaXRpb25fYXR0clR3ZWVuLFxuICBzdHlsZTogdHJhbnNpdGlvbl9zdHlsZSxcbiAgc3R5bGVUd2VlbjogdHJhbnNpdGlvbl9zdHlsZVR3ZWVuLFxuICB0ZXh0OiB0cmFuc2l0aW9uX3RleHQsXG4gIHRleHRUd2VlbjogdHJhbnNpdGlvbl90ZXh0VHdlZW4sXG4gIHJlbW92ZTogdHJhbnNpdGlvbl9yZW1vdmUsXG4gIHR3ZWVuOiB0cmFuc2l0aW9uX3R3ZWVuLFxuICBkZWxheTogdHJhbnNpdGlvbl9kZWxheSxcbiAgZHVyYXRpb246IHRyYW5zaXRpb25fZHVyYXRpb24sXG4gIGVhc2U6IHRyYW5zaXRpb25fZWFzZSxcbiAgZWFzZVZhcnlpbmc6IHRyYW5zaXRpb25fZWFzZVZhcnlpbmcsXG4gIGVuZDogdHJhbnNpdGlvbl9lbmQsXG4gIFtTeW1ib2wuaXRlcmF0b3JdOiBzZWxlY3Rpb25fcHJvdG90eXBlW1N5bWJvbC5pdGVyYXRvcl1cbn07XG4iLCAiZXhwb3J0IGZ1bmN0aW9uIGN1YmljSW4odCkge1xuICByZXR1cm4gdCAqIHQgKiB0O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3ViaWNPdXQodCkge1xuICByZXR1cm4gLS10ICogdCAqIHQgKyAxO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3ViaWNJbk91dCh0KSB7XG4gIHJldHVybiAoKHQgKj0gMikgPD0gMSA/IHQgKiB0ICogdCA6ICh0IC09IDIpICogdCAqIHQgKyAyKSAvIDI7XG59XG4iLCAiaW1wb3J0IHtUcmFuc2l0aW9uLCBuZXdJZH0gZnJvbSBcIi4uL3RyYW5zaXRpb24vaW5kZXguanNcIjtcbmltcG9ydCBzY2hlZHVsZSBmcm9tIFwiLi4vdHJhbnNpdGlvbi9zY2hlZHVsZS5qc1wiO1xuaW1wb3J0IHtlYXNlQ3ViaWNJbk91dH0gZnJvbSBcImQzLWVhc2VcIjtcbmltcG9ydCB7bm93fSBmcm9tIFwiZDMtdGltZXJcIjtcblxudmFyIGRlZmF1bHRUaW1pbmcgPSB7XG4gIHRpbWU6IG51bGwsIC8vIFNldCBvbiB1c2UuXG4gIGRlbGF5OiAwLFxuICBkdXJhdGlvbjogMjUwLFxuICBlYXNlOiBlYXNlQ3ViaWNJbk91dFxufTtcblxuZnVuY3Rpb24gaW5oZXJpdChub2RlLCBpZCkge1xuICB2YXIgdGltaW5nO1xuICB3aGlsZSAoISh0aW1pbmcgPSBub2RlLl9fdHJhbnNpdGlvbikgfHwgISh0aW1pbmcgPSB0aW1pbmdbaWRdKSkge1xuICAgIGlmICghKG5vZGUgPSBub2RlLnBhcmVudE5vZGUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHRyYW5zaXRpb24gJHtpZH0gbm90IGZvdW5kYCk7XG4gICAgfVxuICB9XG4gIHJldHVybiB0aW1pbmc7XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG5hbWUpIHtcbiAgdmFyIGlkLFxuICAgICAgdGltaW5nO1xuXG4gIGlmIChuYW1lIGluc3RhbmNlb2YgVHJhbnNpdGlvbikge1xuICAgIGlkID0gbmFtZS5faWQsIG5hbWUgPSBuYW1lLl9uYW1lO1xuICB9IGVsc2Uge1xuICAgIGlkID0gbmV3SWQoKSwgKHRpbWluZyA9IGRlZmF1bHRUaW1pbmcpLnRpbWUgPSBub3coKSwgbmFtZSA9IG5hbWUgPT0gbnVsbCA/IG51bGwgOiBuYW1lICsgXCJcIjtcbiAgfVxuXG4gIGZvciAodmFyIGdyb3VwcyA9IHRoaXMuX2dyb3VwcywgbSA9IGdyb3Vwcy5sZW5ndGgsIGogPSAwOyBqIDwgbTsgKytqKSB7XG4gICAgZm9yICh2YXIgZ3JvdXAgPSBncm91cHNbal0sIG4gPSBncm91cC5sZW5ndGgsIG5vZGUsIGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAobm9kZSA9IGdyb3VwW2ldKSB7XG4gICAgICAgIHNjaGVkdWxlKG5vZGUsIG5hbWUsIGlkLCBpLCBncm91cCwgdGltaW5nIHx8IGluaGVyaXQobm9kZSwgaWQpKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gbmV3IFRyYW5zaXRpb24oZ3JvdXBzLCB0aGlzLl9wYXJlbnRzLCBuYW1lLCBpZCk7XG59XG4iLCAiaW1wb3J0IHtzZWxlY3Rpb259IGZyb20gXCJkMy1zZWxlY3Rpb25cIjtcbmltcG9ydCBzZWxlY3Rpb25faW50ZXJydXB0IGZyb20gXCIuL2ludGVycnVwdC5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl90cmFuc2l0aW9uIGZyb20gXCIuL3RyYW5zaXRpb24uanNcIjtcblxuc2VsZWN0aW9uLnByb3RvdHlwZS5pbnRlcnJ1cHQgPSBzZWxlY3Rpb25faW50ZXJydXB0O1xuc2VsZWN0aW9uLnByb3RvdHlwZS50cmFuc2l0aW9uID0gc2VsZWN0aW9uX3RyYW5zaXRpb247XG4iLCAiaW1wb3J0IHtkaXNwYXRjaH0gZnJvbSBcImQzLWRpc3BhdGNoXCI7XG5pbXBvcnQge2RyYWdEaXNhYmxlLCBkcmFnRW5hYmxlfSBmcm9tIFwiZDMtZHJhZ1wiO1xuaW1wb3J0IHtpbnRlcnBvbGF0ZX0gZnJvbSBcImQzLWludGVycG9sYXRlXCI7XG5pbXBvcnQge3BvaW50ZXIsIHNlbGVjdH0gZnJvbSBcImQzLXNlbGVjdGlvblwiO1xuaW1wb3J0IHtpbnRlcnJ1cHR9IGZyb20gXCJkMy10cmFuc2l0aW9uXCI7XG5pbXBvcnQgY29uc3RhbnQgZnJvbSBcIi4vY29uc3RhbnQuanNcIjtcbmltcG9ydCBCcnVzaEV2ZW50IGZyb20gXCIuL2V2ZW50LmpzXCI7XG5pbXBvcnQgbm9ldmVudCwge25vcHJvcGFnYXRpb259IGZyb20gXCIuL25vZXZlbnQuanNcIjtcblxudmFyIE1PREVfRFJBRyA9IHtuYW1lOiBcImRyYWdcIn0sXG4gICAgTU9ERV9TUEFDRSA9IHtuYW1lOiBcInNwYWNlXCJ9LFxuICAgIE1PREVfSEFORExFID0ge25hbWU6IFwiaGFuZGxlXCJ9LFxuICAgIE1PREVfQ0VOVEVSID0ge25hbWU6IFwiY2VudGVyXCJ9O1xuXG5jb25zdCB7YWJzLCBtYXgsIG1pbn0gPSBNYXRoO1xuXG5mdW5jdGlvbiBudW1iZXIxKGUpIHtcbiAgcmV0dXJuIFsrZVswXSwgK2VbMV1dO1xufVxuXG5mdW5jdGlvbiBudW1iZXIyKGUpIHtcbiAgcmV0dXJuIFtudW1iZXIxKGVbMF0pLCBudW1iZXIxKGVbMV0pXTtcbn1cblxudmFyIFggPSB7XG4gIG5hbWU6IFwieFwiLFxuICBoYW5kbGVzOiBbXCJ3XCIsIFwiZVwiXS5tYXAodHlwZSksXG4gIGlucHV0OiBmdW5jdGlvbih4LCBlKSB7IHJldHVybiB4ID09IG51bGwgPyBudWxsIDogW1sreFswXSwgZVswXVsxXV0sIFsreFsxXSwgZVsxXVsxXV1dOyB9LFxuICBvdXRwdXQ6IGZ1bmN0aW9uKHh5KSB7IHJldHVybiB4eSAmJiBbeHlbMF1bMF0sIHh5WzFdWzBdXTsgfVxufTtcblxudmFyIFkgPSB7XG4gIG5hbWU6IFwieVwiLFxuICBoYW5kbGVzOiBbXCJuXCIsIFwic1wiXS5tYXAodHlwZSksXG4gIGlucHV0OiBmdW5jdGlvbih5LCBlKSB7IHJldHVybiB5ID09IG51bGwgPyBudWxsIDogW1tlWzBdWzBdLCAreVswXV0sIFtlWzFdWzBdLCAreVsxXV1dOyB9LFxuICBvdXRwdXQ6IGZ1bmN0aW9uKHh5KSB7IHJldHVybiB4eSAmJiBbeHlbMF1bMV0sIHh5WzFdWzFdXTsgfVxufTtcblxudmFyIFhZID0ge1xuICBuYW1lOiBcInh5XCIsXG4gIGhhbmRsZXM6IFtcIm5cIiwgXCJ3XCIsIFwiZVwiLCBcInNcIiwgXCJud1wiLCBcIm5lXCIsIFwic3dcIiwgXCJzZVwiXS5tYXAodHlwZSksXG4gIGlucHV0OiBmdW5jdGlvbih4eSkgeyByZXR1cm4geHkgPT0gbnVsbCA/IG51bGwgOiBudW1iZXIyKHh5KTsgfSxcbiAgb3V0cHV0OiBmdW5jdGlvbih4eSkgeyByZXR1cm4geHk7IH1cbn07XG5cbnZhciBjdXJzb3JzID0ge1xuICBvdmVybGF5OiBcImNyb3NzaGFpclwiLFxuICBzZWxlY3Rpb246IFwibW92ZVwiLFxuICBuOiBcIm5zLXJlc2l6ZVwiLFxuICBlOiBcImV3LXJlc2l6ZVwiLFxuICBzOiBcIm5zLXJlc2l6ZVwiLFxuICB3OiBcImV3LXJlc2l6ZVwiLFxuICBudzogXCJud3NlLXJlc2l6ZVwiLFxuICBuZTogXCJuZXN3LXJlc2l6ZVwiLFxuICBzZTogXCJud3NlLXJlc2l6ZVwiLFxuICBzdzogXCJuZXN3LXJlc2l6ZVwiXG59O1xuXG52YXIgZmxpcFggPSB7XG4gIGU6IFwid1wiLFxuICB3OiBcImVcIixcbiAgbnc6IFwibmVcIixcbiAgbmU6IFwibndcIixcbiAgc2U6IFwic3dcIixcbiAgc3c6IFwic2VcIlxufTtcblxudmFyIGZsaXBZID0ge1xuICBuOiBcInNcIixcbiAgczogXCJuXCIsXG4gIG53OiBcInN3XCIsXG4gIG5lOiBcInNlXCIsXG4gIHNlOiBcIm5lXCIsXG4gIHN3OiBcIm53XCJcbn07XG5cbnZhciBzaWduc1ggPSB7XG4gIG92ZXJsYXk6ICsxLFxuICBzZWxlY3Rpb246ICsxLFxuICBuOiBudWxsLFxuICBlOiArMSxcbiAgczogbnVsbCxcbiAgdzogLTEsXG4gIG53OiAtMSxcbiAgbmU6ICsxLFxuICBzZTogKzEsXG4gIHN3OiAtMVxufTtcblxudmFyIHNpZ25zWSA9IHtcbiAgb3ZlcmxheTogKzEsXG4gIHNlbGVjdGlvbjogKzEsXG4gIG46IC0xLFxuICBlOiBudWxsLFxuICBzOiArMSxcbiAgdzogbnVsbCxcbiAgbnc6IC0xLFxuICBuZTogLTEsXG4gIHNlOiArMSxcbiAgc3c6ICsxXG59O1xuXG5mdW5jdGlvbiB0eXBlKHQpIHtcbiAgcmV0dXJuIHt0eXBlOiB0fTtcbn1cblxuLy8gSWdub3JlIHJpZ2h0LWNsaWNrLCBzaW5jZSB0aGF0IHNob3VsZCBvcGVuIHRoZSBjb250ZXh0IG1lbnUuXG5mdW5jdGlvbiBkZWZhdWx0RmlsdGVyKGV2ZW50KSB7XG4gIHJldHVybiAhZXZlbnQuY3RybEtleSAmJiAhZXZlbnQuYnV0dG9uO1xufVxuXG5mdW5jdGlvbiBkZWZhdWx0RXh0ZW50KCkge1xuICB2YXIgc3ZnID0gdGhpcy5vd25lclNWR0VsZW1lbnQgfHwgdGhpcztcbiAgaWYgKHN2Zy5oYXNBdHRyaWJ1dGUoXCJ2aWV3Qm94XCIpKSB7XG4gICAgc3ZnID0gc3ZnLnZpZXdCb3guYmFzZVZhbDtcbiAgICByZXR1cm4gW1tzdmcueCwgc3ZnLnldLCBbc3ZnLnggKyBzdmcud2lkdGgsIHN2Zy55ICsgc3ZnLmhlaWdodF1dO1xuICB9XG4gIHJldHVybiBbWzAsIDBdLCBbc3ZnLndpZHRoLmJhc2VWYWwudmFsdWUsIHN2Zy5oZWlnaHQuYmFzZVZhbC52YWx1ZV1dO1xufVxuXG5mdW5jdGlvbiBkZWZhdWx0VG91Y2hhYmxlKCkge1xuICByZXR1cm4gbmF2aWdhdG9yLm1heFRvdWNoUG9pbnRzIHx8IChcIm9udG91Y2hzdGFydFwiIGluIHRoaXMpO1xufVxuXG4vLyBMaWtlIGQzLmxvY2FsLCBidXQgd2l0aCB0aGUgbmFtZSBcdTIwMUNfX2JydXNoXHUyMDFEIHJhdGhlciB0aGFuIGF1dG8tZ2VuZXJhdGVkLlxuZnVuY3Rpb24gbG9jYWwobm9kZSkge1xuICB3aGlsZSAoIW5vZGUuX19icnVzaCkgaWYgKCEobm9kZSA9IG5vZGUucGFyZW50Tm9kZSkpIHJldHVybjtcbiAgcmV0dXJuIG5vZGUuX19icnVzaDtcbn1cblxuZnVuY3Rpb24gZW1wdHkoZXh0ZW50KSB7XG4gIHJldHVybiBleHRlbnRbMF1bMF0gPT09IGV4dGVudFsxXVswXVxuICAgICAgfHwgZXh0ZW50WzBdWzFdID09PSBleHRlbnRbMV1bMV07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBicnVzaFNlbGVjdGlvbihub2RlKSB7XG4gIHZhciBzdGF0ZSA9IG5vZGUuX19icnVzaDtcbiAgcmV0dXJuIHN0YXRlID8gc3RhdGUuZGltLm91dHB1dChzdGF0ZS5zZWxlY3Rpb24pIDogbnVsbDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJydXNoWCgpIHtcbiAgcmV0dXJuIGJydXNoKFgpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYnJ1c2hZKCkge1xuICByZXR1cm4gYnJ1c2goWSk7XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gYnJ1c2goWFkpO1xufVxuXG5mdW5jdGlvbiBicnVzaChkaW0pIHtcbiAgdmFyIGV4dGVudCA9IGRlZmF1bHRFeHRlbnQsXG4gICAgICBmaWx0ZXIgPSBkZWZhdWx0RmlsdGVyLFxuICAgICAgdG91Y2hhYmxlID0gZGVmYXVsdFRvdWNoYWJsZSxcbiAgICAgIGtleXMgPSB0cnVlLFxuICAgICAgbGlzdGVuZXJzID0gZGlzcGF0Y2goXCJzdGFydFwiLCBcImJydXNoXCIsIFwiZW5kXCIpLFxuICAgICAgaGFuZGxlU2l6ZSA9IDYsXG4gICAgICB0b3VjaGVuZGluZztcblxuICBmdW5jdGlvbiBicnVzaChncm91cCkge1xuICAgIHZhciBvdmVybGF5ID0gZ3JvdXBcbiAgICAgICAgLnByb3BlcnR5KFwiX19icnVzaFwiLCBpbml0aWFsaXplKVxuICAgICAgLnNlbGVjdEFsbChcIi5vdmVybGF5XCIpXG4gICAgICAuZGF0YShbdHlwZShcIm92ZXJsYXlcIildKTtcblxuICAgIG92ZXJsYXkuZW50ZXIoKS5hcHBlbmQoXCJyZWN0XCIpXG4gICAgICAgIC5hdHRyKFwiY2xhc3NcIiwgXCJvdmVybGF5XCIpXG4gICAgICAgIC5hdHRyKFwicG9pbnRlci1ldmVudHNcIiwgXCJhbGxcIilcbiAgICAgICAgLmF0dHIoXCJjdXJzb3JcIiwgY3Vyc29ycy5vdmVybGF5KVxuICAgICAgLm1lcmdlKG92ZXJsYXkpXG4gICAgICAgIC5lYWNoKGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHZhciBleHRlbnQgPSBsb2NhbCh0aGlzKS5leHRlbnQ7XG4gICAgICAgICAgc2VsZWN0KHRoaXMpXG4gICAgICAgICAgICAgIC5hdHRyKFwieFwiLCBleHRlbnRbMF1bMF0pXG4gICAgICAgICAgICAgIC5hdHRyKFwieVwiLCBleHRlbnRbMF1bMV0pXG4gICAgICAgICAgICAgIC5hdHRyKFwid2lkdGhcIiwgZXh0ZW50WzFdWzBdIC0gZXh0ZW50WzBdWzBdKVxuICAgICAgICAgICAgICAuYXR0cihcImhlaWdodFwiLCBleHRlbnRbMV1bMV0gLSBleHRlbnRbMF1bMV0pO1xuICAgICAgICB9KTtcblxuICAgIGdyb3VwLnNlbGVjdEFsbChcIi5zZWxlY3Rpb25cIilcbiAgICAgIC5kYXRhKFt0eXBlKFwic2VsZWN0aW9uXCIpXSlcbiAgICAgIC5lbnRlcigpLmFwcGVuZChcInJlY3RcIilcbiAgICAgICAgLmF0dHIoXCJjbGFzc1wiLCBcInNlbGVjdGlvblwiKVxuICAgICAgICAuYXR0cihcImN1cnNvclwiLCBjdXJzb3JzLnNlbGVjdGlvbilcbiAgICAgICAgLmF0dHIoXCJmaWxsXCIsIFwiIzc3N1wiKVxuICAgICAgICAuYXR0cihcImZpbGwtb3BhY2l0eVwiLCAwLjMpXG4gICAgICAgIC5hdHRyKFwic3Ryb2tlXCIsIFwiI2ZmZlwiKVxuICAgICAgICAuYXR0cihcInNoYXBlLXJlbmRlcmluZ1wiLCBcImNyaXNwRWRnZXNcIik7XG5cbiAgICB2YXIgaGFuZGxlID0gZ3JvdXAuc2VsZWN0QWxsKFwiLmhhbmRsZVwiKVxuICAgICAgLmRhdGEoZGltLmhhbmRsZXMsIGZ1bmN0aW9uKGQpIHsgcmV0dXJuIGQudHlwZTsgfSk7XG5cbiAgICBoYW5kbGUuZXhpdCgpLnJlbW92ZSgpO1xuXG4gICAgaGFuZGxlLmVudGVyKCkuYXBwZW5kKFwicmVjdFwiKVxuICAgICAgICAuYXR0cihcImNsYXNzXCIsIGZ1bmN0aW9uKGQpIHsgcmV0dXJuIFwiaGFuZGxlIGhhbmRsZS0tXCIgKyBkLnR5cGU7IH0pXG4gICAgICAgIC5hdHRyKFwiY3Vyc29yXCIsIGZ1bmN0aW9uKGQpIHsgcmV0dXJuIGN1cnNvcnNbZC50eXBlXTsgfSk7XG5cbiAgICBncm91cFxuICAgICAgICAuZWFjaChyZWRyYXcpXG4gICAgICAgIC5hdHRyKFwiZmlsbFwiLCBcIm5vbmVcIilcbiAgICAgICAgLmF0dHIoXCJwb2ludGVyLWV2ZW50c1wiLCBcImFsbFwiKVxuICAgICAgICAub24oXCJtb3VzZWRvd24uYnJ1c2hcIiwgc3RhcnRlZClcbiAgICAgIC5maWx0ZXIodG91Y2hhYmxlKVxuICAgICAgICAub24oXCJ0b3VjaHN0YXJ0LmJydXNoXCIsIHN0YXJ0ZWQpXG4gICAgICAgIC5vbihcInRvdWNobW92ZS5icnVzaFwiLCB0b3VjaG1vdmVkKVxuICAgICAgICAub24oXCJ0b3VjaGVuZC5icnVzaCB0b3VjaGNhbmNlbC5icnVzaFwiLCB0b3VjaGVuZGVkKVxuICAgICAgICAuc3R5bGUoXCJ0b3VjaC1hY3Rpb25cIiwgXCJub25lXCIpXG4gICAgICAgIC5zdHlsZShcIi13ZWJraXQtdGFwLWhpZ2hsaWdodC1jb2xvclwiLCBcInJnYmEoMCwwLDAsMClcIik7XG4gIH1cblxuICBicnVzaC5tb3ZlID0gZnVuY3Rpb24oZ3JvdXAsIHNlbGVjdGlvbiwgZXZlbnQpIHtcbiAgICBpZiAoZ3JvdXAudHdlZW4pIHtcbiAgICAgIGdyb3VwXG4gICAgICAgICAgLm9uKFwic3RhcnQuYnJ1c2hcIiwgZnVuY3Rpb24oZXZlbnQpIHsgZW1pdHRlcih0aGlzLCBhcmd1bWVudHMpLmJlZm9yZXN0YXJ0KCkuc3RhcnQoZXZlbnQpOyB9KVxuICAgICAgICAgIC5vbihcImludGVycnVwdC5icnVzaCBlbmQuYnJ1c2hcIiwgZnVuY3Rpb24oZXZlbnQpIHsgZW1pdHRlcih0aGlzLCBhcmd1bWVudHMpLmVuZChldmVudCk7IH0pXG4gICAgICAgICAgLnR3ZWVuKFwiYnJ1c2hcIiwgZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB2YXIgdGhhdCA9IHRoaXMsXG4gICAgICAgICAgICAgICAgc3RhdGUgPSB0aGF0Ll9fYnJ1c2gsXG4gICAgICAgICAgICAgICAgZW1pdCA9IGVtaXR0ZXIodGhhdCwgYXJndW1lbnRzKSxcbiAgICAgICAgICAgICAgICBzZWxlY3Rpb24wID0gc3RhdGUuc2VsZWN0aW9uLFxuICAgICAgICAgICAgICAgIHNlbGVjdGlvbjEgPSBkaW0uaW5wdXQodHlwZW9mIHNlbGVjdGlvbiA9PT0gXCJmdW5jdGlvblwiID8gc2VsZWN0aW9uLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgOiBzZWxlY3Rpb24sIHN0YXRlLmV4dGVudCksXG4gICAgICAgICAgICAgICAgaSA9IGludGVycG9sYXRlKHNlbGVjdGlvbjAsIHNlbGVjdGlvbjEpO1xuXG4gICAgICAgICAgICBmdW5jdGlvbiB0d2Vlbih0KSB7XG4gICAgICAgICAgICAgIHN0YXRlLnNlbGVjdGlvbiA9IHQgPT09IDEgJiYgc2VsZWN0aW9uMSA9PT0gbnVsbCA/IG51bGwgOiBpKHQpO1xuICAgICAgICAgICAgICByZWRyYXcuY2FsbCh0aGF0KTtcbiAgICAgICAgICAgICAgZW1pdC5icnVzaCgpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gc2VsZWN0aW9uMCAhPT0gbnVsbCAmJiBzZWxlY3Rpb24xICE9PSBudWxsID8gdHdlZW4gOiB0d2VlbigxKTtcbiAgICAgICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgZ3JvdXBcbiAgICAgICAgICAuZWFjaChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHZhciB0aGF0ID0gdGhpcyxcbiAgICAgICAgICAgICAgICBhcmdzID0gYXJndW1lbnRzLFxuICAgICAgICAgICAgICAgIHN0YXRlID0gdGhhdC5fX2JydXNoLFxuICAgICAgICAgICAgICAgIHNlbGVjdGlvbjEgPSBkaW0uaW5wdXQodHlwZW9mIHNlbGVjdGlvbiA9PT0gXCJmdW5jdGlvblwiID8gc2VsZWN0aW9uLmFwcGx5KHRoYXQsIGFyZ3MpIDogc2VsZWN0aW9uLCBzdGF0ZS5leHRlbnQpLFxuICAgICAgICAgICAgICAgIGVtaXQgPSBlbWl0dGVyKHRoYXQsIGFyZ3MpLmJlZm9yZXN0YXJ0KCk7XG5cbiAgICAgICAgICAgIGludGVycnVwdCh0aGF0KTtcbiAgICAgICAgICAgIHN0YXRlLnNlbGVjdGlvbiA9IHNlbGVjdGlvbjEgPT09IG51bGwgPyBudWxsIDogc2VsZWN0aW9uMTtcbiAgICAgICAgICAgIHJlZHJhdy5jYWxsKHRoYXQpO1xuICAgICAgICAgICAgZW1pdC5zdGFydChldmVudCkuYnJ1c2goZXZlbnQpLmVuZChldmVudCk7XG4gICAgICAgICAgfSk7XG4gICAgfVxuICB9O1xuXG4gIGJydXNoLmNsZWFyID0gZnVuY3Rpb24oZ3JvdXAsIGV2ZW50KSB7XG4gICAgYnJ1c2gubW92ZShncm91cCwgbnVsbCwgZXZlbnQpO1xuICB9O1xuXG4gIGZ1bmN0aW9uIHJlZHJhdygpIHtcbiAgICB2YXIgZ3JvdXAgPSBzZWxlY3QodGhpcyksXG4gICAgICAgIHNlbGVjdGlvbiA9IGxvY2FsKHRoaXMpLnNlbGVjdGlvbjtcblxuICAgIGlmIChzZWxlY3Rpb24pIHtcbiAgICAgIGdyb3VwLnNlbGVjdEFsbChcIi5zZWxlY3Rpb25cIilcbiAgICAgICAgICAuc3R5bGUoXCJkaXNwbGF5XCIsIG51bGwpXG4gICAgICAgICAgLmF0dHIoXCJ4XCIsIHNlbGVjdGlvblswXVswXSlcbiAgICAgICAgICAuYXR0cihcInlcIiwgc2VsZWN0aW9uWzBdWzFdKVxuICAgICAgICAgIC5hdHRyKFwid2lkdGhcIiwgc2VsZWN0aW9uWzFdWzBdIC0gc2VsZWN0aW9uWzBdWzBdKVxuICAgICAgICAgIC5hdHRyKFwiaGVpZ2h0XCIsIHNlbGVjdGlvblsxXVsxXSAtIHNlbGVjdGlvblswXVsxXSk7XG5cbiAgICAgIGdyb3VwLnNlbGVjdEFsbChcIi5oYW5kbGVcIilcbiAgICAgICAgICAuc3R5bGUoXCJkaXNwbGF5XCIsIG51bGwpXG4gICAgICAgICAgLmF0dHIoXCJ4XCIsIGZ1bmN0aW9uKGQpIHsgcmV0dXJuIGQudHlwZVtkLnR5cGUubGVuZ3RoIC0gMV0gPT09IFwiZVwiID8gc2VsZWN0aW9uWzFdWzBdIC0gaGFuZGxlU2l6ZSAvIDIgOiBzZWxlY3Rpb25bMF1bMF0gLSBoYW5kbGVTaXplIC8gMjsgfSlcbiAgICAgICAgICAuYXR0cihcInlcIiwgZnVuY3Rpb24oZCkgeyByZXR1cm4gZC50eXBlWzBdID09PSBcInNcIiA/IHNlbGVjdGlvblsxXVsxXSAtIGhhbmRsZVNpemUgLyAyIDogc2VsZWN0aW9uWzBdWzFdIC0gaGFuZGxlU2l6ZSAvIDI7IH0pXG4gICAgICAgICAgLmF0dHIoXCJ3aWR0aFwiLCBmdW5jdGlvbihkKSB7IHJldHVybiBkLnR5cGUgPT09IFwiblwiIHx8IGQudHlwZSA9PT0gXCJzXCIgPyBzZWxlY3Rpb25bMV1bMF0gLSBzZWxlY3Rpb25bMF1bMF0gKyBoYW5kbGVTaXplIDogaGFuZGxlU2l6ZTsgfSlcbiAgICAgICAgICAuYXR0cihcImhlaWdodFwiLCBmdW5jdGlvbihkKSB7IHJldHVybiBkLnR5cGUgPT09IFwiZVwiIHx8IGQudHlwZSA9PT0gXCJ3XCIgPyBzZWxlY3Rpb25bMV1bMV0gLSBzZWxlY3Rpb25bMF1bMV0gKyBoYW5kbGVTaXplIDogaGFuZGxlU2l6ZTsgfSk7XG4gICAgfVxuXG4gICAgZWxzZSB7XG4gICAgICBncm91cC5zZWxlY3RBbGwoXCIuc2VsZWN0aW9uLC5oYW5kbGVcIilcbiAgICAgICAgICAuc3R5bGUoXCJkaXNwbGF5XCIsIFwibm9uZVwiKVxuICAgICAgICAgIC5hdHRyKFwieFwiLCBudWxsKVxuICAgICAgICAgIC5hdHRyKFwieVwiLCBudWxsKVxuICAgICAgICAgIC5hdHRyKFwid2lkdGhcIiwgbnVsbClcbiAgICAgICAgICAuYXR0cihcImhlaWdodFwiLCBudWxsKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBlbWl0dGVyKHRoYXQsIGFyZ3MsIGNsZWFuKSB7XG4gICAgdmFyIGVtaXQgPSB0aGF0Ll9fYnJ1c2guZW1pdHRlcjtcbiAgICByZXR1cm4gZW1pdCAmJiAoIWNsZWFuIHx8ICFlbWl0LmNsZWFuKSA/IGVtaXQgOiBuZXcgRW1pdHRlcih0aGF0LCBhcmdzLCBjbGVhbik7XG4gIH1cblxuICBmdW5jdGlvbiBFbWl0dGVyKHRoYXQsIGFyZ3MsIGNsZWFuKSB7XG4gICAgdGhpcy50aGF0ID0gdGhhdDtcbiAgICB0aGlzLmFyZ3MgPSBhcmdzO1xuICAgIHRoaXMuc3RhdGUgPSB0aGF0Ll9fYnJ1c2g7XG4gICAgdGhpcy5hY3RpdmUgPSAwO1xuICAgIHRoaXMuY2xlYW4gPSBjbGVhbjtcbiAgfVxuXG4gIEVtaXR0ZXIucHJvdG90eXBlID0ge1xuICAgIGJlZm9yZXN0YXJ0OiBmdW5jdGlvbigpIHtcbiAgICAgIGlmICgrK3RoaXMuYWN0aXZlID09PSAxKSB0aGlzLnN0YXRlLmVtaXR0ZXIgPSB0aGlzLCB0aGlzLnN0YXJ0aW5nID0gdHJ1ZTtcbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH0sXG4gICAgc3RhcnQ6IGZ1bmN0aW9uKGV2ZW50LCBtb2RlKSB7XG4gICAgICBpZiAodGhpcy5zdGFydGluZykgdGhpcy5zdGFydGluZyA9IGZhbHNlLCB0aGlzLmVtaXQoXCJzdGFydFwiLCBldmVudCwgbW9kZSk7XG4gICAgICBlbHNlIHRoaXMuZW1pdChcImJydXNoXCIsIGV2ZW50KTtcbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH0sXG4gICAgYnJ1c2g6IGZ1bmN0aW9uKGV2ZW50LCBtb2RlKSB7XG4gICAgICB0aGlzLmVtaXQoXCJicnVzaFwiLCBldmVudCwgbW9kZSk7XG4gICAgICByZXR1cm4gdGhpcztcbiAgICB9LFxuICAgIGVuZDogZnVuY3Rpb24oZXZlbnQsIG1vZGUpIHtcbiAgICAgIGlmICgtLXRoaXMuYWN0aXZlID09PSAwKSBkZWxldGUgdGhpcy5zdGF0ZS5lbWl0dGVyLCB0aGlzLmVtaXQoXCJlbmRcIiwgZXZlbnQsIG1vZGUpO1xuICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfSxcbiAgICBlbWl0OiBmdW5jdGlvbih0eXBlLCBldmVudCwgbW9kZSkge1xuICAgICAgdmFyIGQgPSBzZWxlY3QodGhpcy50aGF0KS5kYXR1bSgpO1xuICAgICAgbGlzdGVuZXJzLmNhbGwoXG4gICAgICAgIHR5cGUsXG4gICAgICAgIHRoaXMudGhhdCxcbiAgICAgICAgbmV3IEJydXNoRXZlbnQodHlwZSwge1xuICAgICAgICAgIHNvdXJjZUV2ZW50OiBldmVudCxcbiAgICAgICAgICB0YXJnZXQ6IGJydXNoLFxuICAgICAgICAgIHNlbGVjdGlvbjogZGltLm91dHB1dCh0aGlzLnN0YXRlLnNlbGVjdGlvbiksXG4gICAgICAgICAgbW9kZSxcbiAgICAgICAgICBkaXNwYXRjaDogbGlzdGVuZXJzXG4gICAgICAgIH0pLFxuICAgICAgICBkXG4gICAgICApO1xuICAgIH1cbiAgfTtcblxuICBmdW5jdGlvbiBzdGFydGVkKGV2ZW50KSB7XG4gICAgaWYgKHRvdWNoZW5kaW5nICYmICFldmVudC50b3VjaGVzKSByZXR1cm47XG4gICAgaWYgKCFmaWx0ZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKSkgcmV0dXJuO1xuXG4gICAgdmFyIHRoYXQgPSB0aGlzLFxuICAgICAgICB0eXBlID0gZXZlbnQudGFyZ2V0Ll9fZGF0YV9fLnR5cGUsXG4gICAgICAgIG1vZGUgPSAoa2V5cyAmJiBldmVudC5tZXRhS2V5ID8gdHlwZSA9IFwib3ZlcmxheVwiIDogdHlwZSkgPT09IFwic2VsZWN0aW9uXCIgPyBNT0RFX0RSQUcgOiAoa2V5cyAmJiBldmVudC5hbHRLZXkgPyBNT0RFX0NFTlRFUiA6IE1PREVfSEFORExFKSxcbiAgICAgICAgc2lnblggPSBkaW0gPT09IFkgPyBudWxsIDogc2lnbnNYW3R5cGVdLFxuICAgICAgICBzaWduWSA9IGRpbSA9PT0gWCA/IG51bGwgOiBzaWduc1lbdHlwZV0sXG4gICAgICAgIHN0YXRlID0gbG9jYWwodGhhdCksXG4gICAgICAgIGV4dGVudCA9IHN0YXRlLmV4dGVudCxcbiAgICAgICAgc2VsZWN0aW9uID0gc3RhdGUuc2VsZWN0aW9uLFxuICAgICAgICBXID0gZXh0ZW50WzBdWzBdLCB3MCwgdzEsXG4gICAgICAgIE4gPSBleHRlbnRbMF1bMV0sIG4wLCBuMSxcbiAgICAgICAgRSA9IGV4dGVudFsxXVswXSwgZTAsIGUxLFxuICAgICAgICBTID0gZXh0ZW50WzFdWzFdLCBzMCwgczEsXG4gICAgICAgIGR4ID0gMCxcbiAgICAgICAgZHkgPSAwLFxuICAgICAgICBtb3ZpbmcsXG4gICAgICAgIHNoaWZ0aW5nID0gc2lnblggJiYgc2lnblkgJiYga2V5cyAmJiBldmVudC5zaGlmdEtleSxcbiAgICAgICAgbG9ja1gsXG4gICAgICAgIGxvY2tZLFxuICAgICAgICBwb2ludHMgPSBBcnJheS5mcm9tKGV2ZW50LnRvdWNoZXMgfHwgW2V2ZW50XSwgdCA9PiB7XG4gICAgICAgICAgY29uc3QgaSA9IHQuaWRlbnRpZmllcjtcbiAgICAgICAgICB0ID0gcG9pbnRlcih0LCB0aGF0KTtcbiAgICAgICAgICB0LnBvaW50MCA9IHQuc2xpY2UoKTtcbiAgICAgICAgICB0LmlkZW50aWZpZXIgPSBpO1xuICAgICAgICAgIHJldHVybiB0O1xuICAgICAgICB9KTtcblxuICAgIGludGVycnVwdCh0aGF0KTtcbiAgICB2YXIgZW1pdCA9IGVtaXR0ZXIodGhhdCwgYXJndW1lbnRzLCB0cnVlKS5iZWZvcmVzdGFydCgpO1xuXG4gICAgaWYgKHR5cGUgPT09IFwib3ZlcmxheVwiKSB7XG4gICAgICBpZiAoc2VsZWN0aW9uKSBtb3ZpbmcgPSB0cnVlO1xuICAgICAgY29uc3QgcHRzID0gW3BvaW50c1swXSwgcG9pbnRzWzFdIHx8IHBvaW50c1swXV07XG4gICAgICBzdGF0ZS5zZWxlY3Rpb24gPSBzZWxlY3Rpb24gPSBbW1xuICAgICAgICAgIHcwID0gZGltID09PSBZID8gVyA6IG1pbihwdHNbMF1bMF0sIHB0c1sxXVswXSksXG4gICAgICAgICAgbjAgPSBkaW0gPT09IFggPyBOIDogbWluKHB0c1swXVsxXSwgcHRzWzFdWzFdKVxuICAgICAgICBdLCBbXG4gICAgICAgICAgZTAgPSBkaW0gPT09IFkgPyBFIDogbWF4KHB0c1swXVswXSwgcHRzWzFdWzBdKSxcbiAgICAgICAgICBzMCA9IGRpbSA9PT0gWCA/IFMgOiBtYXgocHRzWzBdWzFdLCBwdHNbMV1bMV0pXG4gICAgICAgIF1dO1xuICAgICAgaWYgKHBvaW50cy5sZW5ndGggPiAxKSBtb3ZlKGV2ZW50KTtcbiAgICB9IGVsc2Uge1xuICAgICAgdzAgPSBzZWxlY3Rpb25bMF1bMF07XG4gICAgICBuMCA9IHNlbGVjdGlvblswXVsxXTtcbiAgICAgIGUwID0gc2VsZWN0aW9uWzFdWzBdO1xuICAgICAgczAgPSBzZWxlY3Rpb25bMV1bMV07XG4gICAgfVxuXG4gICAgdzEgPSB3MDtcbiAgICBuMSA9IG4wO1xuICAgIGUxID0gZTA7XG4gICAgczEgPSBzMDtcblxuICAgIHZhciBncm91cCA9IHNlbGVjdCh0aGF0KVxuICAgICAgICAuYXR0cihcInBvaW50ZXItZXZlbnRzXCIsIFwibm9uZVwiKTtcblxuICAgIHZhciBvdmVybGF5ID0gZ3JvdXAuc2VsZWN0QWxsKFwiLm92ZXJsYXlcIilcbiAgICAgICAgLmF0dHIoXCJjdXJzb3JcIiwgY3Vyc29yc1t0eXBlXSk7XG5cbiAgICBpZiAoZXZlbnQudG91Y2hlcykge1xuICAgICAgZW1pdC5tb3ZlZCA9IG1vdmVkO1xuICAgICAgZW1pdC5lbmRlZCA9IGVuZGVkO1xuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgdmlldyA9IHNlbGVjdChldmVudC52aWV3KVxuICAgICAgICAgIC5vbihcIm1vdXNlbW92ZS5icnVzaFwiLCBtb3ZlZCwgdHJ1ZSlcbiAgICAgICAgICAub24oXCJtb3VzZXVwLmJydXNoXCIsIGVuZGVkLCB0cnVlKTtcbiAgICAgIGlmIChrZXlzKSB2aWV3XG4gICAgICAgICAgLm9uKFwia2V5ZG93bi5icnVzaFwiLCBrZXlkb3duZWQsIHRydWUpXG4gICAgICAgICAgLm9uKFwia2V5dXAuYnJ1c2hcIiwga2V5dXBwZWQsIHRydWUpXG5cbiAgICAgIGRyYWdEaXNhYmxlKGV2ZW50LnZpZXcpO1xuICAgIH1cblxuICAgIHJlZHJhdy5jYWxsKHRoYXQpO1xuICAgIGVtaXQuc3RhcnQoZXZlbnQsIG1vZGUubmFtZSk7XG5cbiAgICBmdW5jdGlvbiBtb3ZlZChldmVudCkge1xuICAgICAgZm9yIChjb25zdCBwIG9mIGV2ZW50LmNoYW5nZWRUb3VjaGVzIHx8IFtldmVudF0pIHtcbiAgICAgICAgZm9yIChjb25zdCBkIG9mIHBvaW50cylcbiAgICAgICAgICBpZiAoZC5pZGVudGlmaWVyID09PSBwLmlkZW50aWZpZXIpIGQuY3VyID0gcG9pbnRlcihwLCB0aGF0KTtcbiAgICAgIH1cbiAgICAgIGlmIChzaGlmdGluZyAmJiAhbG9ja1ggJiYgIWxvY2tZICYmIHBvaW50cy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgY29uc3QgcG9pbnQgPSBwb2ludHNbMF07XG4gICAgICAgIGlmIChhYnMocG9pbnQuY3VyWzBdIC0gcG9pbnRbMF0pID4gYWJzKHBvaW50LmN1clsxXSAtIHBvaW50WzFdKSlcbiAgICAgICAgICBsb2NrWSA9IHRydWU7XG4gICAgICAgIGVsc2VcbiAgICAgICAgICBsb2NrWCA9IHRydWU7XG4gICAgICB9XG4gICAgICBmb3IgKGNvbnN0IHBvaW50IG9mIHBvaW50cylcbiAgICAgICAgaWYgKHBvaW50LmN1cikgcG9pbnRbMF0gPSBwb2ludC5jdXJbMF0sIHBvaW50WzFdID0gcG9pbnQuY3VyWzFdO1xuICAgICAgbW92aW5nID0gdHJ1ZTtcbiAgICAgIG5vZXZlbnQoZXZlbnQpO1xuICAgICAgbW92ZShldmVudCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbW92ZShldmVudCkge1xuICAgICAgY29uc3QgcG9pbnQgPSBwb2ludHNbMF0sIHBvaW50MCA9IHBvaW50LnBvaW50MDtcbiAgICAgIHZhciB0O1xuXG4gICAgICBkeCA9IHBvaW50WzBdIC0gcG9pbnQwWzBdO1xuICAgICAgZHkgPSBwb2ludFsxXSAtIHBvaW50MFsxXTtcblxuICAgICAgc3dpdGNoIChtb2RlKSB7XG4gICAgICAgIGNhc2UgTU9ERV9TUEFDRTpcbiAgICAgICAgY2FzZSBNT0RFX0RSQUc6IHtcbiAgICAgICAgICBpZiAoc2lnblgpIGR4ID0gbWF4KFcgLSB3MCwgbWluKEUgLSBlMCwgZHgpKSwgdzEgPSB3MCArIGR4LCBlMSA9IGUwICsgZHg7XG4gICAgICAgICAgaWYgKHNpZ25ZKSBkeSA9IG1heChOIC0gbjAsIG1pbihTIC0gczAsIGR5KSksIG4xID0gbjAgKyBkeSwgczEgPSBzMCArIGR5O1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGNhc2UgTU9ERV9IQU5ETEU6IHtcbiAgICAgICAgICBpZiAocG9pbnRzWzFdKSB7XG4gICAgICAgICAgICBpZiAoc2lnblgpIHcxID0gbWF4KFcsIG1pbihFLCBwb2ludHNbMF1bMF0pKSwgZTEgPSBtYXgoVywgbWluKEUsIHBvaW50c1sxXVswXSkpLCBzaWduWCA9IDE7XG4gICAgICAgICAgICBpZiAoc2lnblkpIG4xID0gbWF4KE4sIG1pbihTLCBwb2ludHNbMF1bMV0pKSwgczEgPSBtYXgoTiwgbWluKFMsIHBvaW50c1sxXVsxXSkpLCBzaWduWSA9IDE7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGlmIChzaWduWCA8IDApIGR4ID0gbWF4KFcgLSB3MCwgbWluKEUgLSB3MCwgZHgpKSwgdzEgPSB3MCArIGR4LCBlMSA9IGUwO1xuICAgICAgICAgICAgZWxzZSBpZiAoc2lnblggPiAwKSBkeCA9IG1heChXIC0gZTAsIG1pbihFIC0gZTAsIGR4KSksIHcxID0gdzAsIGUxID0gZTAgKyBkeDtcbiAgICAgICAgICAgIGlmIChzaWduWSA8IDApIGR5ID0gbWF4KE4gLSBuMCwgbWluKFMgLSBuMCwgZHkpKSwgbjEgPSBuMCArIGR5LCBzMSA9IHMwO1xuICAgICAgICAgICAgZWxzZSBpZiAoc2lnblkgPiAwKSBkeSA9IG1heChOIC0gczAsIG1pbihTIC0gczAsIGR5KSksIG4xID0gbjAsIHMxID0gczAgKyBkeTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgY2FzZSBNT0RFX0NFTlRFUjoge1xuICAgICAgICAgIGlmIChzaWduWCkgdzEgPSBtYXgoVywgbWluKEUsIHcwIC0gZHggKiBzaWduWCkpLCBlMSA9IG1heChXLCBtaW4oRSwgZTAgKyBkeCAqIHNpZ25YKSk7XG4gICAgICAgICAgaWYgKHNpZ25ZKSBuMSA9IG1heChOLCBtaW4oUywgbjAgLSBkeSAqIHNpZ25ZKSksIHMxID0gbWF4KE4sIG1pbihTLCBzMCArIGR5ICogc2lnblkpKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoZTEgPCB3MSkge1xuICAgICAgICBzaWduWCAqPSAtMTtcbiAgICAgICAgdCA9IHcwLCB3MCA9IGUwLCBlMCA9IHQ7XG4gICAgICAgIHQgPSB3MSwgdzEgPSBlMSwgZTEgPSB0O1xuICAgICAgICBpZiAodHlwZSBpbiBmbGlwWCkgb3ZlcmxheS5hdHRyKFwiY3Vyc29yXCIsIGN1cnNvcnNbdHlwZSA9IGZsaXBYW3R5cGVdXSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChzMSA8IG4xKSB7XG4gICAgICAgIHNpZ25ZICo9IC0xO1xuICAgICAgICB0ID0gbjAsIG4wID0gczAsIHMwID0gdDtcbiAgICAgICAgdCA9IG4xLCBuMSA9IHMxLCBzMSA9IHQ7XG4gICAgICAgIGlmICh0eXBlIGluIGZsaXBZKSBvdmVybGF5LmF0dHIoXCJjdXJzb3JcIiwgY3Vyc29yc1t0eXBlID0gZmxpcFlbdHlwZV1dKTtcbiAgICAgIH1cblxuICAgICAgaWYgKHN0YXRlLnNlbGVjdGlvbikgc2VsZWN0aW9uID0gc3RhdGUuc2VsZWN0aW9uOyAvLyBNYXkgYmUgc2V0IGJ5IGJydXNoLm1vdmUhXG4gICAgICBpZiAobG9ja1gpIHcxID0gc2VsZWN0aW9uWzBdWzBdLCBlMSA9IHNlbGVjdGlvblsxXVswXTtcbiAgICAgIGlmIChsb2NrWSkgbjEgPSBzZWxlY3Rpb25bMF1bMV0sIHMxID0gc2VsZWN0aW9uWzFdWzFdO1xuXG4gICAgICBpZiAoc2VsZWN0aW9uWzBdWzBdICE9PSB3MVxuICAgICAgICAgIHx8IHNlbGVjdGlvblswXVsxXSAhPT0gbjFcbiAgICAgICAgICB8fCBzZWxlY3Rpb25bMV1bMF0gIT09IGUxXG4gICAgICAgICAgfHwgc2VsZWN0aW9uWzFdWzFdICE9PSBzMSkge1xuICAgICAgICBzdGF0ZS5zZWxlY3Rpb24gPSBbW3cxLCBuMV0sIFtlMSwgczFdXTtcbiAgICAgICAgcmVkcmF3LmNhbGwodGhhdCk7XG4gICAgICAgIGVtaXQuYnJ1c2goZXZlbnQsIG1vZGUubmFtZSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZW5kZWQoZXZlbnQpIHtcbiAgICAgIG5vcHJvcGFnYXRpb24oZXZlbnQpO1xuICAgICAgaWYgKGV2ZW50LnRvdWNoZXMpIHtcbiAgICAgICAgaWYgKGV2ZW50LnRvdWNoZXMubGVuZ3RoKSByZXR1cm47XG4gICAgICAgIGlmICh0b3VjaGVuZGluZykgY2xlYXJUaW1lb3V0KHRvdWNoZW5kaW5nKTtcbiAgICAgICAgdG91Y2hlbmRpbmcgPSBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkgeyB0b3VjaGVuZGluZyA9IG51bGw7IH0sIDUwMCk7IC8vIEdob3N0IGNsaWNrcyBhcmUgZGVsYXllZCFcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRyYWdFbmFibGUoZXZlbnQudmlldywgbW92aW5nKTtcbiAgICAgICAgdmlldy5vbihcImtleWRvd24uYnJ1c2gga2V5dXAuYnJ1c2ggbW91c2Vtb3ZlLmJydXNoIG1vdXNldXAuYnJ1c2hcIiwgbnVsbCk7XG4gICAgICB9XG4gICAgICBncm91cC5hdHRyKFwicG9pbnRlci1ldmVudHNcIiwgXCJhbGxcIik7XG4gICAgICBvdmVybGF5LmF0dHIoXCJjdXJzb3JcIiwgY3Vyc29ycy5vdmVybGF5KTtcbiAgICAgIGlmIChzdGF0ZS5zZWxlY3Rpb24pIHNlbGVjdGlvbiA9IHN0YXRlLnNlbGVjdGlvbjsgLy8gTWF5IGJlIHNldCBieSBicnVzaC5tb3ZlIChvbiBzdGFydCkhXG4gICAgICBpZiAoZW1wdHkoc2VsZWN0aW9uKSkgc3RhdGUuc2VsZWN0aW9uID0gbnVsbCwgcmVkcmF3LmNhbGwodGhhdCk7XG4gICAgICBlbWl0LmVuZChldmVudCwgbW9kZS5uYW1lKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBrZXlkb3duZWQoZXZlbnQpIHtcbiAgICAgIHN3aXRjaCAoZXZlbnQua2V5Q29kZSkge1xuICAgICAgICBjYXNlIDE2OiB7IC8vIFNISUZUXG4gICAgICAgICAgc2hpZnRpbmcgPSBzaWduWCAmJiBzaWduWTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjYXNlIDE4OiB7IC8vIEFMVFxuICAgICAgICAgIGlmIChtb2RlID09PSBNT0RFX0hBTkRMRSkge1xuICAgICAgICAgICAgaWYgKHNpZ25YKSBlMCA9IGUxIC0gZHggKiBzaWduWCwgdzAgPSB3MSArIGR4ICogc2lnblg7XG4gICAgICAgICAgICBpZiAoc2lnblkpIHMwID0gczEgLSBkeSAqIHNpZ25ZLCBuMCA9IG4xICsgZHkgKiBzaWduWTtcbiAgICAgICAgICAgIG1vZGUgPSBNT0RFX0NFTlRFUjtcbiAgICAgICAgICAgIG1vdmUoZXZlbnQpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjYXNlIDMyOiB7IC8vIFNQQUNFOyB0YWtlcyBwcmlvcml0eSBvdmVyIEFMVFxuICAgICAgICAgIGlmIChtb2RlID09PSBNT0RFX0hBTkRMRSB8fCBtb2RlID09PSBNT0RFX0NFTlRFUikge1xuICAgICAgICAgICAgaWYgKHNpZ25YIDwgMCkgZTAgPSBlMSAtIGR4OyBlbHNlIGlmIChzaWduWCA+IDApIHcwID0gdzEgLSBkeDtcbiAgICAgICAgICAgIGlmIChzaWduWSA8IDApIHMwID0gczEgLSBkeTsgZWxzZSBpZiAoc2lnblkgPiAwKSBuMCA9IG4xIC0gZHk7XG4gICAgICAgICAgICBtb2RlID0gTU9ERV9TUEFDRTtcbiAgICAgICAgICAgIG92ZXJsYXkuYXR0cihcImN1cnNvclwiLCBjdXJzb3JzLnNlbGVjdGlvbik7XG4gICAgICAgICAgICBtb3ZlKGV2ZW50KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgZGVmYXVsdDogcmV0dXJuO1xuICAgICAgfVxuICAgICAgbm9ldmVudChldmVudCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24ga2V5dXBwZWQoZXZlbnQpIHtcbiAgICAgIHN3aXRjaCAoZXZlbnQua2V5Q29kZSkge1xuICAgICAgICBjYXNlIDE2OiB7IC8vIFNISUZUXG4gICAgICAgICAgaWYgKHNoaWZ0aW5nKSB7XG4gICAgICAgICAgICBsb2NrWCA9IGxvY2tZID0gc2hpZnRpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgIG1vdmUoZXZlbnQpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjYXNlIDE4OiB7IC8vIEFMVFxuICAgICAgICAgIGlmIChtb2RlID09PSBNT0RFX0NFTlRFUikge1xuICAgICAgICAgICAgaWYgKHNpZ25YIDwgMCkgZTAgPSBlMTsgZWxzZSBpZiAoc2lnblggPiAwKSB3MCA9IHcxO1xuICAgICAgICAgICAgaWYgKHNpZ25ZIDwgMCkgczAgPSBzMTsgZWxzZSBpZiAoc2lnblkgPiAwKSBuMCA9IG4xO1xuICAgICAgICAgICAgbW9kZSA9IE1PREVfSEFORExFO1xuICAgICAgICAgICAgbW92ZShldmVudCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGNhc2UgMzI6IHsgLy8gU1BBQ0VcbiAgICAgICAgICBpZiAobW9kZSA9PT0gTU9ERV9TUEFDRSkge1xuICAgICAgICAgICAgaWYgKGV2ZW50LmFsdEtleSkge1xuICAgICAgICAgICAgICBpZiAoc2lnblgpIGUwID0gZTEgLSBkeCAqIHNpZ25YLCB3MCA9IHcxICsgZHggKiBzaWduWDtcbiAgICAgICAgICAgICAgaWYgKHNpZ25ZKSBzMCA9IHMxIC0gZHkgKiBzaWduWSwgbjAgPSBuMSArIGR5ICogc2lnblk7XG4gICAgICAgICAgICAgIG1vZGUgPSBNT0RFX0NFTlRFUjtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGlmIChzaWduWCA8IDApIGUwID0gZTE7IGVsc2UgaWYgKHNpZ25YID4gMCkgdzAgPSB3MTtcbiAgICAgICAgICAgICAgaWYgKHNpZ25ZIDwgMCkgczAgPSBzMTsgZWxzZSBpZiAoc2lnblkgPiAwKSBuMCA9IG4xO1xuICAgICAgICAgICAgICBtb2RlID0gTU9ERV9IQU5ETEU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBvdmVybGF5LmF0dHIoXCJjdXJzb3JcIiwgY3Vyc29yc1t0eXBlXSk7XG4gICAgICAgICAgICBtb3ZlKGV2ZW50KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgZGVmYXVsdDogcmV0dXJuO1xuICAgICAgfVxuICAgICAgbm9ldmVudChldmVudCk7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gdG91Y2htb3ZlZChldmVudCkge1xuICAgIGVtaXR0ZXIodGhpcywgYXJndW1lbnRzKS5tb3ZlZChldmVudCk7XG4gIH1cblxuICBmdW5jdGlvbiB0b3VjaGVuZGVkKGV2ZW50KSB7XG4gICAgZW1pdHRlcih0aGlzLCBhcmd1bWVudHMpLmVuZGVkKGV2ZW50KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGluaXRpYWxpemUoKSB7XG4gICAgdmFyIHN0YXRlID0gdGhpcy5fX2JydXNoIHx8IHtzZWxlY3Rpb246IG51bGx9O1xuICAgIHN0YXRlLmV4dGVudCA9IG51bWJlcjIoZXh0ZW50LmFwcGx5KHRoaXMsIGFyZ3VtZW50cykpO1xuICAgIHN0YXRlLmRpbSA9IGRpbTtcbiAgICByZXR1cm4gc3RhdGU7XG4gIH1cblxuICBicnVzaC5leHRlbnQgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoZXh0ZW50ID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudChudW1iZXIyKF8pKSwgYnJ1c2gpIDogZXh0ZW50O1xuICB9O1xuXG4gIGJydXNoLmZpbHRlciA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChmaWx0ZXIgPSB0eXBlb2YgXyA9PT0gXCJmdW5jdGlvblwiID8gXyA6IGNvbnN0YW50KCEhXyksIGJydXNoKSA6IGZpbHRlcjtcbiAgfTtcblxuICBicnVzaC50b3VjaGFibGUgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAodG91Y2hhYmxlID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudCghIV8pLCBicnVzaCkgOiB0b3VjaGFibGU7XG4gIH07XG5cbiAgYnJ1c2guaGFuZGxlU2l6ZSA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChoYW5kbGVTaXplID0gK18sIGJydXNoKSA6IGhhbmRsZVNpemU7XG4gIH07XG5cbiAgYnJ1c2gua2V5TW9kaWZpZXJzID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGtleXMgPSAhIV8sIGJydXNoKSA6IGtleXM7XG4gIH07XG5cbiAgYnJ1c2gub24gPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgdmFsdWUgPSBsaXN0ZW5lcnMub24uYXBwbHkobGlzdGVuZXJzLCBhcmd1bWVudHMpO1xuICAgIHJldHVybiB2YWx1ZSA9PT0gbGlzdGVuZXJzID8gYnJ1c2ggOiB2YWx1ZTtcbiAgfTtcblxuICByZXR1cm4gYnJ1c2g7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oeCwgeSkge1xuICB2YXIgbm9kZXMsIHN0cmVuZ3RoID0gMTtcblxuICBpZiAoeCA9PSBudWxsKSB4ID0gMDtcbiAgaWYgKHkgPT0gbnVsbCkgeSA9IDA7XG5cbiAgZnVuY3Rpb24gZm9yY2UoKSB7XG4gICAgdmFyIGksXG4gICAgICAgIG4gPSBub2Rlcy5sZW5ndGgsXG4gICAgICAgIG5vZGUsXG4gICAgICAgIHN4ID0gMCxcbiAgICAgICAgc3kgPSAwO1xuXG4gICAgZm9yIChpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgbm9kZSA9IG5vZGVzW2ldLCBzeCArPSBub2RlLngsIHN5ICs9IG5vZGUueTtcbiAgICB9XG5cbiAgICBmb3IgKHN4ID0gKHN4IC8gbiAtIHgpICogc3RyZW5ndGgsIHN5ID0gKHN5IC8gbiAtIHkpICogc3RyZW5ndGgsIGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICBub2RlID0gbm9kZXNbaV0sIG5vZGUueCAtPSBzeCwgbm9kZS55IC09IHN5O1xuICAgIH1cbiAgfVxuXG4gIGZvcmNlLmluaXRpYWxpemUgPSBmdW5jdGlvbihfKSB7XG4gICAgbm9kZXMgPSBfO1xuICB9O1xuXG4gIGZvcmNlLnggPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoeCA9ICtfLCBmb3JjZSkgOiB4O1xuICB9O1xuXG4gIGZvcmNlLnkgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoeSA9ICtfLCBmb3JjZSkgOiB5O1xuICB9O1xuXG4gIGZvcmNlLnN0cmVuZ3RoID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHN0cmVuZ3RoID0gK18sIGZvcmNlKSA6IHN0cmVuZ3RoO1xuICB9O1xuXG4gIHJldHVybiBmb3JjZTtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbihkKSB7XG4gIGNvbnN0IHggPSArdGhpcy5feC5jYWxsKG51bGwsIGQpLFxuICAgICAgeSA9ICt0aGlzLl95LmNhbGwobnVsbCwgZCk7XG4gIHJldHVybiBhZGQodGhpcy5jb3Zlcih4LCB5KSwgeCwgeSwgZCk7XG59XG5cbmZ1bmN0aW9uIGFkZCh0cmVlLCB4LCB5LCBkKSB7XG4gIGlmIChpc05hTih4KSB8fCBpc05hTih5KSkgcmV0dXJuIHRyZWU7IC8vIGlnbm9yZSBpbnZhbGlkIHBvaW50c1xuXG4gIHZhciBwYXJlbnQsXG4gICAgICBub2RlID0gdHJlZS5fcm9vdCxcbiAgICAgIGxlYWYgPSB7ZGF0YTogZH0sXG4gICAgICB4MCA9IHRyZWUuX3gwLFxuICAgICAgeTAgPSB0cmVlLl95MCxcbiAgICAgIHgxID0gdHJlZS5feDEsXG4gICAgICB5MSA9IHRyZWUuX3kxLFxuICAgICAgeG0sXG4gICAgICB5bSxcbiAgICAgIHhwLFxuICAgICAgeXAsXG4gICAgICByaWdodCxcbiAgICAgIGJvdHRvbSxcbiAgICAgIGksXG4gICAgICBqO1xuXG4gIC8vIElmIHRoZSB0cmVlIGlzIGVtcHR5LCBpbml0aWFsaXplIHRoZSByb290IGFzIGEgbGVhZi5cbiAgaWYgKCFub2RlKSByZXR1cm4gdHJlZS5fcm9vdCA9IGxlYWYsIHRyZWU7XG5cbiAgLy8gRmluZCB0aGUgZXhpc3RpbmcgbGVhZiBmb3IgdGhlIG5ldyBwb2ludCwgb3IgYWRkIGl0LlxuICB3aGlsZSAobm9kZS5sZW5ndGgpIHtcbiAgICBpZiAocmlnaHQgPSB4ID49ICh4bSA9ICh4MCArIHgxKSAvIDIpKSB4MCA9IHhtOyBlbHNlIHgxID0geG07XG4gICAgaWYgKGJvdHRvbSA9IHkgPj0gKHltID0gKHkwICsgeTEpIC8gMikpIHkwID0geW07IGVsc2UgeTEgPSB5bTtcbiAgICBpZiAocGFyZW50ID0gbm9kZSwgIShub2RlID0gbm9kZVtpID0gYm90dG9tIDw8IDEgfCByaWdodF0pKSByZXR1cm4gcGFyZW50W2ldID0gbGVhZiwgdHJlZTtcbiAgfVxuXG4gIC8vIElzIHRoZSBuZXcgcG9pbnQgaXMgZXhhY3RseSBjb2luY2lkZW50IHdpdGggdGhlIGV4aXN0aW5nIHBvaW50P1xuICB4cCA9ICt0cmVlLl94LmNhbGwobnVsbCwgbm9kZS5kYXRhKTtcbiAgeXAgPSArdHJlZS5feS5jYWxsKG51bGwsIG5vZGUuZGF0YSk7XG4gIGlmICh4ID09PSB4cCAmJiB5ID09PSB5cCkgcmV0dXJuIGxlYWYubmV4dCA9IG5vZGUsIHBhcmVudCA/IHBhcmVudFtpXSA9IGxlYWYgOiB0cmVlLl9yb290ID0gbGVhZiwgdHJlZTtcblxuICAvLyBPdGhlcndpc2UsIHNwbGl0IHRoZSBsZWFmIG5vZGUgdW50aWwgdGhlIG9sZCBhbmQgbmV3IHBvaW50IGFyZSBzZXBhcmF0ZWQuXG4gIGRvIHtcbiAgICBwYXJlbnQgPSBwYXJlbnQgPyBwYXJlbnRbaV0gPSBuZXcgQXJyYXkoNCkgOiB0cmVlLl9yb290ID0gbmV3IEFycmF5KDQpO1xuICAgIGlmIChyaWdodCA9IHggPj0gKHhtID0gKHgwICsgeDEpIC8gMikpIHgwID0geG07IGVsc2UgeDEgPSB4bTtcbiAgICBpZiAoYm90dG9tID0geSA+PSAoeW0gPSAoeTAgKyB5MSkgLyAyKSkgeTAgPSB5bTsgZWxzZSB5MSA9IHltO1xuICB9IHdoaWxlICgoaSA9IGJvdHRvbSA8PCAxIHwgcmlnaHQpID09PSAoaiA9ICh5cCA+PSB5bSkgPDwgMSB8ICh4cCA+PSB4bSkpKTtcbiAgcmV0dXJuIHBhcmVudFtqXSA9IG5vZGUsIHBhcmVudFtpXSA9IGxlYWYsIHRyZWU7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhZGRBbGwoZGF0YSkge1xuICB2YXIgZCwgaSwgbiA9IGRhdGEubGVuZ3RoLFxuICAgICAgeCxcbiAgICAgIHksXG4gICAgICB4eiA9IG5ldyBBcnJheShuKSxcbiAgICAgIHl6ID0gbmV3IEFycmF5KG4pLFxuICAgICAgeDAgPSBJbmZpbml0eSxcbiAgICAgIHkwID0gSW5maW5pdHksXG4gICAgICB4MSA9IC1JbmZpbml0eSxcbiAgICAgIHkxID0gLUluZmluaXR5O1xuXG4gIC8vIENvbXB1dGUgdGhlIHBvaW50cyBhbmQgdGhlaXIgZXh0ZW50LlxuICBmb3IgKGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgaWYgKGlzTmFOKHggPSArdGhpcy5feC5jYWxsKG51bGwsIGQgPSBkYXRhW2ldKSkgfHwgaXNOYU4oeSA9ICt0aGlzLl95LmNhbGwobnVsbCwgZCkpKSBjb250aW51ZTtcbiAgICB4eltpXSA9IHg7XG4gICAgeXpbaV0gPSB5O1xuICAgIGlmICh4IDwgeDApIHgwID0geDtcbiAgICBpZiAoeCA+IHgxKSB4MSA9IHg7XG4gICAgaWYgKHkgPCB5MCkgeTAgPSB5O1xuICAgIGlmICh5ID4geTEpIHkxID0geTtcbiAgfVxuXG4gIC8vIElmIHRoZXJlIHdlcmUgbm8gKHZhbGlkKSBwb2ludHMsIGFib3J0LlxuICBpZiAoeDAgPiB4MSB8fCB5MCA+IHkxKSByZXR1cm4gdGhpcztcblxuICAvLyBFeHBhbmQgdGhlIHRyZWUgdG8gY292ZXIgdGhlIG5ldyBwb2ludHMuXG4gIHRoaXMuY292ZXIoeDAsIHkwKS5jb3Zlcih4MSwgeTEpO1xuXG4gIC8vIEFkZCB0aGUgbmV3IHBvaW50cy5cbiAgZm9yIChpID0gMDsgaSA8IG47ICsraSkge1xuICAgIGFkZCh0aGlzLCB4eltpXSwgeXpbaV0sIGRhdGFbaV0pO1xuICB9XG5cbiAgcmV0dXJuIHRoaXM7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oeCwgeSkge1xuICBpZiAoaXNOYU4oeCA9ICt4KSB8fCBpc05hTih5ID0gK3kpKSByZXR1cm4gdGhpczsgLy8gaWdub3JlIGludmFsaWQgcG9pbnRzXG5cbiAgdmFyIHgwID0gdGhpcy5feDAsXG4gICAgICB5MCA9IHRoaXMuX3kwLFxuICAgICAgeDEgPSB0aGlzLl94MSxcbiAgICAgIHkxID0gdGhpcy5feTE7XG5cbiAgLy8gSWYgdGhlIHF1YWR0cmVlIGhhcyBubyBleHRlbnQsIGluaXRpYWxpemUgdGhlbS5cbiAgLy8gSW50ZWdlciBleHRlbnQgYXJlIG5lY2Vzc2FyeSBzbyB0aGF0IGlmIHdlIGxhdGVyIGRvdWJsZSB0aGUgZXh0ZW50LFxuICAvLyB0aGUgZXhpc3RpbmcgcXVhZHJhbnQgYm91bmRhcmllcyBkb25cdTIwMTl0IGNoYW5nZSBkdWUgdG8gZmxvYXRpbmcgcG9pbnQgZXJyb3IhXG4gIGlmIChpc05hTih4MCkpIHtcbiAgICB4MSA9ICh4MCA9IE1hdGguZmxvb3IoeCkpICsgMTtcbiAgICB5MSA9ICh5MCA9IE1hdGguZmxvb3IoeSkpICsgMTtcbiAgfVxuXG4gIC8vIE90aGVyd2lzZSwgZG91YmxlIHJlcGVhdGVkbHkgdG8gY292ZXIuXG4gIGVsc2Uge1xuICAgIHZhciB6ID0geDEgLSB4MCB8fCAxLFxuICAgICAgICBub2RlID0gdGhpcy5fcm9vdCxcbiAgICAgICAgcGFyZW50LFxuICAgICAgICBpO1xuXG4gICAgd2hpbGUgKHgwID4geCB8fCB4ID49IHgxIHx8IHkwID4geSB8fCB5ID49IHkxKSB7XG4gICAgICBpID0gKHkgPCB5MCkgPDwgMSB8ICh4IDwgeDApO1xuICAgICAgcGFyZW50ID0gbmV3IEFycmF5KDQpLCBwYXJlbnRbaV0gPSBub2RlLCBub2RlID0gcGFyZW50LCB6ICo9IDI7XG4gICAgICBzd2l0Y2ggKGkpIHtcbiAgICAgICAgY2FzZSAwOiB4MSA9IHgwICsgeiwgeTEgPSB5MCArIHo7IGJyZWFrO1xuICAgICAgICBjYXNlIDE6IHgwID0geDEgLSB6LCB5MSA9IHkwICsgejsgYnJlYWs7XG4gICAgICAgIGNhc2UgMjogeDEgPSB4MCArIHosIHkwID0geTEgLSB6OyBicmVhaztcbiAgICAgICAgY2FzZSAzOiB4MCA9IHgxIC0geiwgeTAgPSB5MSAtIHo7IGJyZWFrO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0aGlzLl9yb290ICYmIHRoaXMuX3Jvb3QubGVuZ3RoKSB0aGlzLl9yb290ID0gbm9kZTtcbiAgfVxuXG4gIHRoaXMuX3gwID0geDA7XG4gIHRoaXMuX3kwID0geTA7XG4gIHRoaXMuX3gxID0geDE7XG4gIHRoaXMuX3kxID0geTE7XG4gIHJldHVybiB0aGlzO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKCkge1xuICB2YXIgZGF0YSA9IFtdO1xuICB0aGlzLnZpc2l0KGZ1bmN0aW9uKG5vZGUpIHtcbiAgICBpZiAoIW5vZGUubGVuZ3RoKSBkbyBkYXRhLnB1c2gobm9kZS5kYXRhKTsgd2hpbGUgKG5vZGUgPSBub2RlLm5leHQpXG4gIH0pO1xuICByZXR1cm4gZGF0YTtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbihfKSB7XG4gIHJldHVybiBhcmd1bWVudHMubGVuZ3RoXG4gICAgICA/IHRoaXMuY292ZXIoK19bMF1bMF0sICtfWzBdWzFdKS5jb3ZlcigrX1sxXVswXSwgK19bMV1bMV0pXG4gICAgICA6IGlzTmFOKHRoaXMuX3gwKSA/IHVuZGVmaW5lZCA6IFtbdGhpcy5feDAsIHRoaXMuX3kwXSwgW3RoaXMuX3gxLCB0aGlzLl95MV1dO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG5vZGUsIHgwLCB5MCwgeDEsIHkxKSB7XG4gIHRoaXMubm9kZSA9IG5vZGU7XG4gIHRoaXMueDAgPSB4MDtcbiAgdGhpcy55MCA9IHkwO1xuICB0aGlzLngxID0geDE7XG4gIHRoaXMueTEgPSB5MTtcbn1cbiIsICJpbXBvcnQgUXVhZCBmcm9tIFwiLi9xdWFkLmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHgsIHksIHJhZGl1cykge1xuICB2YXIgZGF0YSxcbiAgICAgIHgwID0gdGhpcy5feDAsXG4gICAgICB5MCA9IHRoaXMuX3kwLFxuICAgICAgeDEsXG4gICAgICB5MSxcbiAgICAgIHgyLFxuICAgICAgeTIsXG4gICAgICB4MyA9IHRoaXMuX3gxLFxuICAgICAgeTMgPSB0aGlzLl95MSxcbiAgICAgIHF1YWRzID0gW10sXG4gICAgICBub2RlID0gdGhpcy5fcm9vdCxcbiAgICAgIHEsXG4gICAgICBpO1xuXG4gIGlmIChub2RlKSBxdWFkcy5wdXNoKG5ldyBRdWFkKG5vZGUsIHgwLCB5MCwgeDMsIHkzKSk7XG4gIGlmIChyYWRpdXMgPT0gbnVsbCkgcmFkaXVzID0gSW5maW5pdHk7XG4gIGVsc2Uge1xuICAgIHgwID0geCAtIHJhZGl1cywgeTAgPSB5IC0gcmFkaXVzO1xuICAgIHgzID0geCArIHJhZGl1cywgeTMgPSB5ICsgcmFkaXVzO1xuICAgIHJhZGl1cyAqPSByYWRpdXM7XG4gIH1cblxuICB3aGlsZSAocSA9IHF1YWRzLnBvcCgpKSB7XG5cbiAgICAvLyBTdG9wIHNlYXJjaGluZyBpZiB0aGlzIHF1YWRyYW50IGNhblx1MjAxOXQgY29udGFpbiBhIGNsb3NlciBub2RlLlxuICAgIGlmICghKG5vZGUgPSBxLm5vZGUpXG4gICAgICAgIHx8ICh4MSA9IHEueDApID4geDNcbiAgICAgICAgfHwgKHkxID0gcS55MCkgPiB5M1xuICAgICAgICB8fCAoeDIgPSBxLngxKSA8IHgwXG4gICAgICAgIHx8ICh5MiA9IHEueTEpIDwgeTApIGNvbnRpbnVlO1xuXG4gICAgLy8gQmlzZWN0IHRoZSBjdXJyZW50IHF1YWRyYW50LlxuICAgIGlmIChub2RlLmxlbmd0aCkge1xuICAgICAgdmFyIHhtID0gKHgxICsgeDIpIC8gMixcbiAgICAgICAgICB5bSA9ICh5MSArIHkyKSAvIDI7XG5cbiAgICAgIHF1YWRzLnB1c2goXG4gICAgICAgIG5ldyBRdWFkKG5vZGVbM10sIHhtLCB5bSwgeDIsIHkyKSxcbiAgICAgICAgbmV3IFF1YWQobm9kZVsyXSwgeDEsIHltLCB4bSwgeTIpLFxuICAgICAgICBuZXcgUXVhZChub2RlWzFdLCB4bSwgeTEsIHgyLCB5bSksXG4gICAgICAgIG5ldyBRdWFkKG5vZGVbMF0sIHgxLCB5MSwgeG0sIHltKVxuICAgICAgKTtcblxuICAgICAgLy8gVmlzaXQgdGhlIGNsb3Nlc3QgcXVhZHJhbnQgZmlyc3QuXG4gICAgICBpZiAoaSA9ICh5ID49IHltKSA8PCAxIHwgKHggPj0geG0pKSB7XG4gICAgICAgIHEgPSBxdWFkc1txdWFkcy5sZW5ndGggLSAxXTtcbiAgICAgICAgcXVhZHNbcXVhZHMubGVuZ3RoIC0gMV0gPSBxdWFkc1txdWFkcy5sZW5ndGggLSAxIC0gaV07XG4gICAgICAgIHF1YWRzW3F1YWRzLmxlbmd0aCAtIDEgLSBpXSA9IHE7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gVmlzaXQgdGhpcyBwb2ludC4gKFZpc2l0aW5nIGNvaW5jaWRlbnQgcG9pbnRzIGlzblx1MjAxOXQgbmVjZXNzYXJ5ISlcbiAgICBlbHNlIHtcbiAgICAgIHZhciBkeCA9IHggLSArdGhpcy5feC5jYWxsKG51bGwsIG5vZGUuZGF0YSksXG4gICAgICAgICAgZHkgPSB5IC0gK3RoaXMuX3kuY2FsbChudWxsLCBub2RlLmRhdGEpLFxuICAgICAgICAgIGQyID0gZHggKiBkeCArIGR5ICogZHk7XG4gICAgICBpZiAoZDIgPCByYWRpdXMpIHtcbiAgICAgICAgdmFyIGQgPSBNYXRoLnNxcnQocmFkaXVzID0gZDIpO1xuICAgICAgICB4MCA9IHggLSBkLCB5MCA9IHkgLSBkO1xuICAgICAgICB4MyA9IHggKyBkLCB5MyA9IHkgKyBkO1xuICAgICAgICBkYXRhID0gbm9kZS5kYXRhO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBkYXRhO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGQpIHtcbiAgaWYgKGlzTmFOKHggPSArdGhpcy5feC5jYWxsKG51bGwsIGQpKSB8fCBpc05hTih5ID0gK3RoaXMuX3kuY2FsbChudWxsLCBkKSkpIHJldHVybiB0aGlzOyAvLyBpZ25vcmUgaW52YWxpZCBwb2ludHNcblxuICB2YXIgcGFyZW50LFxuICAgICAgbm9kZSA9IHRoaXMuX3Jvb3QsXG4gICAgICByZXRhaW5lcixcbiAgICAgIHByZXZpb3VzLFxuICAgICAgbmV4dCxcbiAgICAgIHgwID0gdGhpcy5feDAsXG4gICAgICB5MCA9IHRoaXMuX3kwLFxuICAgICAgeDEgPSB0aGlzLl94MSxcbiAgICAgIHkxID0gdGhpcy5feTEsXG4gICAgICB4LFxuICAgICAgeSxcbiAgICAgIHhtLFxuICAgICAgeW0sXG4gICAgICByaWdodCxcbiAgICAgIGJvdHRvbSxcbiAgICAgIGksXG4gICAgICBqO1xuXG4gIC8vIElmIHRoZSB0cmVlIGlzIGVtcHR5LCBpbml0aWFsaXplIHRoZSByb290IGFzIGEgbGVhZi5cbiAgaWYgKCFub2RlKSByZXR1cm4gdGhpcztcblxuICAvLyBGaW5kIHRoZSBsZWFmIG5vZGUgZm9yIHRoZSBwb2ludC5cbiAgLy8gV2hpbGUgZGVzY2VuZGluZywgYWxzbyByZXRhaW4gdGhlIGRlZXBlc3QgcGFyZW50IHdpdGggYSBub24tcmVtb3ZlZCBzaWJsaW5nLlxuICBpZiAobm9kZS5sZW5ndGgpIHdoaWxlICh0cnVlKSB7XG4gICAgaWYgKHJpZ2h0ID0geCA+PSAoeG0gPSAoeDAgKyB4MSkgLyAyKSkgeDAgPSB4bTsgZWxzZSB4MSA9IHhtO1xuICAgIGlmIChib3R0b20gPSB5ID49ICh5bSA9ICh5MCArIHkxKSAvIDIpKSB5MCA9IHltOyBlbHNlIHkxID0geW07XG4gICAgaWYgKCEocGFyZW50ID0gbm9kZSwgbm9kZSA9IG5vZGVbaSA9IGJvdHRvbSA8PCAxIHwgcmlnaHRdKSkgcmV0dXJuIHRoaXM7XG4gICAgaWYgKCFub2RlLmxlbmd0aCkgYnJlYWs7XG4gICAgaWYgKHBhcmVudFsoaSArIDEpICYgM10gfHwgcGFyZW50WyhpICsgMikgJiAzXSB8fCBwYXJlbnRbKGkgKyAzKSAmIDNdKSByZXRhaW5lciA9IHBhcmVudCwgaiA9IGk7XG4gIH1cblxuICAvLyBGaW5kIHRoZSBwb2ludCB0byByZW1vdmUuXG4gIHdoaWxlIChub2RlLmRhdGEgIT09IGQpIGlmICghKHByZXZpb3VzID0gbm9kZSwgbm9kZSA9IG5vZGUubmV4dCkpIHJldHVybiB0aGlzO1xuICBpZiAobmV4dCA9IG5vZGUubmV4dCkgZGVsZXRlIG5vZGUubmV4dDtcblxuICAvLyBJZiB0aGVyZSBhcmUgbXVsdGlwbGUgY29pbmNpZGVudCBwb2ludHMsIHJlbW92ZSBqdXN0IHRoZSBwb2ludC5cbiAgaWYgKHByZXZpb3VzKSByZXR1cm4gKG5leHQgPyBwcmV2aW91cy5uZXh0ID0gbmV4dCA6IGRlbGV0ZSBwcmV2aW91cy5uZXh0KSwgdGhpcztcblxuICAvLyBJZiB0aGlzIGlzIHRoZSByb290IHBvaW50LCByZW1vdmUgaXQuXG4gIGlmICghcGFyZW50KSByZXR1cm4gdGhpcy5fcm9vdCA9IG5leHQsIHRoaXM7XG5cbiAgLy8gUmVtb3ZlIHRoaXMgbGVhZi5cbiAgbmV4dCA/IHBhcmVudFtpXSA9IG5leHQgOiBkZWxldGUgcGFyZW50W2ldO1xuXG4gIC8vIElmIHRoZSBwYXJlbnQgbm93IGNvbnRhaW5zIGV4YWN0bHkgb25lIGxlYWYsIGNvbGxhcHNlIHN1cGVyZmx1b3VzIHBhcmVudHMuXG4gIGlmICgobm9kZSA9IHBhcmVudFswXSB8fCBwYXJlbnRbMV0gfHwgcGFyZW50WzJdIHx8IHBhcmVudFszXSlcbiAgICAgICYmIG5vZGUgPT09IChwYXJlbnRbM10gfHwgcGFyZW50WzJdIHx8IHBhcmVudFsxXSB8fCBwYXJlbnRbMF0pXG4gICAgICAmJiAhbm9kZS5sZW5ndGgpIHtcbiAgICBpZiAocmV0YWluZXIpIHJldGFpbmVyW2pdID0gbm9kZTtcbiAgICBlbHNlIHRoaXMuX3Jvb3QgPSBub2RlO1xuICB9XG5cbiAgcmV0dXJuIHRoaXM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZW1vdmVBbGwoZGF0YSkge1xuICBmb3IgKHZhciBpID0gMCwgbiA9IGRhdGEubGVuZ3RoOyBpIDwgbjsgKytpKSB0aGlzLnJlbW92ZShkYXRhW2ldKTtcbiAgcmV0dXJuIHRoaXM7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLl9yb290O1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKCkge1xuICB2YXIgc2l6ZSA9IDA7XG4gIHRoaXMudmlzaXQoZnVuY3Rpb24obm9kZSkge1xuICAgIGlmICghbm9kZS5sZW5ndGgpIGRvICsrc2l6ZTsgd2hpbGUgKG5vZGUgPSBub2RlLm5leHQpXG4gIH0pO1xuICByZXR1cm4gc2l6ZTtcbn1cbiIsICJpbXBvcnQgUXVhZCBmcm9tIFwiLi9xdWFkLmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGNhbGxiYWNrKSB7XG4gIHZhciBxdWFkcyA9IFtdLCBxLCBub2RlID0gdGhpcy5fcm9vdCwgY2hpbGQsIHgwLCB5MCwgeDEsIHkxO1xuICBpZiAobm9kZSkgcXVhZHMucHVzaChuZXcgUXVhZChub2RlLCB0aGlzLl94MCwgdGhpcy5feTAsIHRoaXMuX3gxLCB0aGlzLl95MSkpO1xuICB3aGlsZSAocSA9IHF1YWRzLnBvcCgpKSB7XG4gICAgaWYgKCFjYWxsYmFjayhub2RlID0gcS5ub2RlLCB4MCA9IHEueDAsIHkwID0gcS55MCwgeDEgPSBxLngxLCB5MSA9IHEueTEpICYmIG5vZGUubGVuZ3RoKSB7XG4gICAgICB2YXIgeG0gPSAoeDAgKyB4MSkgLyAyLCB5bSA9ICh5MCArIHkxKSAvIDI7XG4gICAgICBpZiAoY2hpbGQgPSBub2RlWzNdKSBxdWFkcy5wdXNoKG5ldyBRdWFkKGNoaWxkLCB4bSwgeW0sIHgxLCB5MSkpO1xuICAgICAgaWYgKGNoaWxkID0gbm9kZVsyXSkgcXVhZHMucHVzaChuZXcgUXVhZChjaGlsZCwgeDAsIHltLCB4bSwgeTEpKTtcbiAgICAgIGlmIChjaGlsZCA9IG5vZGVbMV0pIHF1YWRzLnB1c2gobmV3IFF1YWQoY2hpbGQsIHhtLCB5MCwgeDEsIHltKSk7XG4gICAgICBpZiAoY2hpbGQgPSBub2RlWzBdKSBxdWFkcy5wdXNoKG5ldyBRdWFkKGNoaWxkLCB4MCwgeTAsIHhtLCB5bSkpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdGhpcztcbn1cbiIsICJpbXBvcnQgUXVhZCBmcm9tIFwiLi9xdWFkLmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGNhbGxiYWNrKSB7XG4gIHZhciBxdWFkcyA9IFtdLCBuZXh0ID0gW10sIHE7XG4gIGlmICh0aGlzLl9yb290KSBxdWFkcy5wdXNoKG5ldyBRdWFkKHRoaXMuX3Jvb3QsIHRoaXMuX3gwLCB0aGlzLl95MCwgdGhpcy5feDEsIHRoaXMuX3kxKSk7XG4gIHdoaWxlIChxID0gcXVhZHMucG9wKCkpIHtcbiAgICB2YXIgbm9kZSA9IHEubm9kZTtcbiAgICBpZiAobm9kZS5sZW5ndGgpIHtcbiAgICAgIHZhciBjaGlsZCwgeDAgPSBxLngwLCB5MCA9IHEueTAsIHgxID0gcS54MSwgeTEgPSBxLnkxLCB4bSA9ICh4MCArIHgxKSAvIDIsIHltID0gKHkwICsgeTEpIC8gMjtcbiAgICAgIGlmIChjaGlsZCA9IG5vZGVbMF0pIHF1YWRzLnB1c2gobmV3IFF1YWQoY2hpbGQsIHgwLCB5MCwgeG0sIHltKSk7XG4gICAgICBpZiAoY2hpbGQgPSBub2RlWzFdKSBxdWFkcy5wdXNoKG5ldyBRdWFkKGNoaWxkLCB4bSwgeTAsIHgxLCB5bSkpO1xuICAgICAgaWYgKGNoaWxkID0gbm9kZVsyXSkgcXVhZHMucHVzaChuZXcgUXVhZChjaGlsZCwgeDAsIHltLCB4bSwgeTEpKTtcbiAgICAgIGlmIChjaGlsZCA9IG5vZGVbM10pIHF1YWRzLnB1c2gobmV3IFF1YWQoY2hpbGQsIHhtLCB5bSwgeDEsIHkxKSk7XG4gICAgfVxuICAgIG5leHQucHVzaChxKTtcbiAgfVxuICB3aGlsZSAocSA9IG5leHQucG9wKCkpIHtcbiAgICBjYWxsYmFjayhxLm5vZGUsIHEueDAsIHEueTAsIHEueDEsIHEueTEpO1xuICB9XG4gIHJldHVybiB0aGlzO1xufVxuIiwgImV4cG9ydCBmdW5jdGlvbiBkZWZhdWx0WChkKSB7XG4gIHJldHVybiBkWzBdO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihfKSB7XG4gIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHRoaXMuX3ggPSBfLCB0aGlzKSA6IHRoaXMuX3g7XG59XG4iLCAiZXhwb3J0IGZ1bmN0aW9uIGRlZmF1bHRZKGQpIHtcbiAgcmV0dXJuIGRbMV07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKF8pIHtcbiAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAodGhpcy5feSA9IF8sIHRoaXMpIDogdGhpcy5feTtcbn1cbiIsICJpbXBvcnQgdHJlZV9hZGQsIHthZGRBbGwgYXMgdHJlZV9hZGRBbGx9IGZyb20gXCIuL2FkZC5qc1wiO1xuaW1wb3J0IHRyZWVfY292ZXIgZnJvbSBcIi4vY292ZXIuanNcIjtcbmltcG9ydCB0cmVlX2RhdGEgZnJvbSBcIi4vZGF0YS5qc1wiO1xuaW1wb3J0IHRyZWVfZXh0ZW50IGZyb20gXCIuL2V4dGVudC5qc1wiO1xuaW1wb3J0IHRyZWVfZmluZCBmcm9tIFwiLi9maW5kLmpzXCI7XG5pbXBvcnQgdHJlZV9yZW1vdmUsIHtyZW1vdmVBbGwgYXMgdHJlZV9yZW1vdmVBbGx9IGZyb20gXCIuL3JlbW92ZS5qc1wiO1xuaW1wb3J0IHRyZWVfcm9vdCBmcm9tIFwiLi9yb290LmpzXCI7XG5pbXBvcnQgdHJlZV9zaXplIGZyb20gXCIuL3NpemUuanNcIjtcbmltcG9ydCB0cmVlX3Zpc2l0IGZyb20gXCIuL3Zpc2l0LmpzXCI7XG5pbXBvcnQgdHJlZV92aXNpdEFmdGVyIGZyb20gXCIuL3Zpc2l0QWZ0ZXIuanNcIjtcbmltcG9ydCB0cmVlX3gsIHtkZWZhdWx0WH0gZnJvbSBcIi4veC5qc1wiO1xuaW1wb3J0IHRyZWVfeSwge2RlZmF1bHRZfSBmcm9tIFwiLi95LmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIHF1YWR0cmVlKG5vZGVzLCB4LCB5KSB7XG4gIHZhciB0cmVlID0gbmV3IFF1YWR0cmVlKHggPT0gbnVsbCA/IGRlZmF1bHRYIDogeCwgeSA9PSBudWxsID8gZGVmYXVsdFkgOiB5LCBOYU4sIE5hTiwgTmFOLCBOYU4pO1xuICByZXR1cm4gbm9kZXMgPT0gbnVsbCA/IHRyZWUgOiB0cmVlLmFkZEFsbChub2Rlcyk7XG59XG5cbmZ1bmN0aW9uIFF1YWR0cmVlKHgsIHksIHgwLCB5MCwgeDEsIHkxKSB7XG4gIHRoaXMuX3ggPSB4O1xuICB0aGlzLl95ID0geTtcbiAgdGhpcy5feDAgPSB4MDtcbiAgdGhpcy5feTAgPSB5MDtcbiAgdGhpcy5feDEgPSB4MTtcbiAgdGhpcy5feTEgPSB5MTtcbiAgdGhpcy5fcm9vdCA9IHVuZGVmaW5lZDtcbn1cblxuZnVuY3Rpb24gbGVhZl9jb3B5KGxlYWYpIHtcbiAgdmFyIGNvcHkgPSB7ZGF0YTogbGVhZi5kYXRhfSwgbmV4dCA9IGNvcHk7XG4gIHdoaWxlIChsZWFmID0gbGVhZi5uZXh0KSBuZXh0ID0gbmV4dC5uZXh0ID0ge2RhdGE6IGxlYWYuZGF0YX07XG4gIHJldHVybiBjb3B5O1xufVxuXG52YXIgdHJlZVByb3RvID0gcXVhZHRyZWUucHJvdG90eXBlID0gUXVhZHRyZWUucHJvdG90eXBlO1xuXG50cmVlUHJvdG8uY29weSA9IGZ1bmN0aW9uKCkge1xuICB2YXIgY29weSA9IG5ldyBRdWFkdHJlZSh0aGlzLl94LCB0aGlzLl95LCB0aGlzLl94MCwgdGhpcy5feTAsIHRoaXMuX3gxLCB0aGlzLl95MSksXG4gICAgICBub2RlID0gdGhpcy5fcm9vdCxcbiAgICAgIG5vZGVzLFxuICAgICAgY2hpbGQ7XG5cbiAgaWYgKCFub2RlKSByZXR1cm4gY29weTtcblxuICBpZiAoIW5vZGUubGVuZ3RoKSByZXR1cm4gY29weS5fcm9vdCA9IGxlYWZfY29weShub2RlKSwgY29weTtcblxuICBub2RlcyA9IFt7c291cmNlOiBub2RlLCB0YXJnZXQ6IGNvcHkuX3Jvb3QgPSBuZXcgQXJyYXkoNCl9XTtcbiAgd2hpbGUgKG5vZGUgPSBub2Rlcy5wb3AoKSkge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgNDsgKytpKSB7XG4gICAgICBpZiAoY2hpbGQgPSBub2RlLnNvdXJjZVtpXSkge1xuICAgICAgICBpZiAoY2hpbGQubGVuZ3RoKSBub2Rlcy5wdXNoKHtzb3VyY2U6IGNoaWxkLCB0YXJnZXQ6IG5vZGUudGFyZ2V0W2ldID0gbmV3IEFycmF5KDQpfSk7XG4gICAgICAgIGVsc2Ugbm9kZS50YXJnZXRbaV0gPSBsZWFmX2NvcHkoY2hpbGQpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBjb3B5O1xufTtcblxudHJlZVByb3RvLmFkZCA9IHRyZWVfYWRkO1xudHJlZVByb3RvLmFkZEFsbCA9IHRyZWVfYWRkQWxsO1xudHJlZVByb3RvLmNvdmVyID0gdHJlZV9jb3ZlcjtcbnRyZWVQcm90by5kYXRhID0gdHJlZV9kYXRhO1xudHJlZVByb3RvLmV4dGVudCA9IHRyZWVfZXh0ZW50O1xudHJlZVByb3RvLmZpbmQgPSB0cmVlX2ZpbmQ7XG50cmVlUHJvdG8ucmVtb3ZlID0gdHJlZV9yZW1vdmU7XG50cmVlUHJvdG8ucmVtb3ZlQWxsID0gdHJlZV9yZW1vdmVBbGw7XG50cmVlUHJvdG8ucm9vdCA9IHRyZWVfcm9vdDtcbnRyZWVQcm90by5zaXplID0gdHJlZV9zaXplO1xudHJlZVByb3RvLnZpc2l0ID0gdHJlZV92aXNpdDtcbnRyZWVQcm90by52aXNpdEFmdGVyID0gdHJlZV92aXNpdEFmdGVyO1xudHJlZVByb3RvLnggPSB0cmVlX3g7XG50cmVlUHJvdG8ueSA9IHRyZWVfeTtcbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbih4KSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4geDtcbiAgfTtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbihyYW5kb20pIHtcbiAgcmV0dXJuIChyYW5kb20oKSAtIDAuNSkgKiAxZS02O1xufVxuIiwgImltcG9ydCB7cXVhZHRyZWV9IGZyb20gXCJkMy1xdWFkdHJlZVwiO1xuaW1wb3J0IGNvbnN0YW50IGZyb20gXCIuL2NvbnN0YW50LmpzXCI7XG5pbXBvcnQgamlnZ2xlIGZyb20gXCIuL2ppZ2dsZS5qc1wiO1xuXG5mdW5jdGlvbiB4KGQpIHtcbiAgcmV0dXJuIGQueCArIGQudng7XG59XG5cbmZ1bmN0aW9uIHkoZCkge1xuICByZXR1cm4gZC55ICsgZC52eTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24ocmFkaXVzKSB7XG4gIHZhciBub2RlcyxcbiAgICAgIHJhZGlpLFxuICAgICAgcmFuZG9tLFxuICAgICAgc3RyZW5ndGggPSAxLFxuICAgICAgaXRlcmF0aW9ucyA9IDE7XG5cbiAgaWYgKHR5cGVvZiByYWRpdXMgIT09IFwiZnVuY3Rpb25cIikgcmFkaXVzID0gY29uc3RhbnQocmFkaXVzID09IG51bGwgPyAxIDogK3JhZGl1cyk7XG5cbiAgZnVuY3Rpb24gZm9yY2UoKSB7XG4gICAgdmFyIGksIG4gPSBub2Rlcy5sZW5ndGgsXG4gICAgICAgIHRyZWUsXG4gICAgICAgIG5vZGUsXG4gICAgICAgIHhpLFxuICAgICAgICB5aSxcbiAgICAgICAgcmksXG4gICAgICAgIHJpMjtcblxuICAgIGZvciAodmFyIGsgPSAwOyBrIDwgaXRlcmF0aW9uczsgKytrKSB7XG4gICAgICB0cmVlID0gcXVhZHRyZWUobm9kZXMsIHgsIHkpLnZpc2l0QWZ0ZXIocHJlcGFyZSk7XG4gICAgICBmb3IgKGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICAgIG5vZGUgPSBub2Rlc1tpXTtcbiAgICAgICAgcmkgPSByYWRpaVtub2RlLmluZGV4XSwgcmkyID0gcmkgKiByaTtcbiAgICAgICAgeGkgPSBub2RlLnggKyBub2RlLnZ4O1xuICAgICAgICB5aSA9IG5vZGUueSArIG5vZGUudnk7XG4gICAgICAgIHRyZWUudmlzaXQoYXBwbHkpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGFwcGx5KHF1YWQsIHgwLCB5MCwgeDEsIHkxKSB7XG4gICAgICB2YXIgZGF0YSA9IHF1YWQuZGF0YSwgcmogPSBxdWFkLnIsIHIgPSByaSArIHJqO1xuICAgICAgaWYgKGRhdGEpIHtcbiAgICAgICAgaWYgKGRhdGEuaW5kZXggPiBub2RlLmluZGV4KSB7XG4gICAgICAgICAgdmFyIHggPSB4aSAtIGRhdGEueCAtIGRhdGEudngsXG4gICAgICAgICAgICAgIHkgPSB5aSAtIGRhdGEueSAtIGRhdGEudnksXG4gICAgICAgICAgICAgIGwgPSB4ICogeCArIHkgKiB5O1xuICAgICAgICAgIGlmIChsIDwgciAqIHIpIHtcbiAgICAgICAgICAgIGlmICh4ID09PSAwKSB4ID0gamlnZ2xlKHJhbmRvbSksIGwgKz0geCAqIHg7XG4gICAgICAgICAgICBpZiAoeSA9PT0gMCkgeSA9IGppZ2dsZShyYW5kb20pLCBsICs9IHkgKiB5O1xuICAgICAgICAgICAgbCA9IChyIC0gKGwgPSBNYXRoLnNxcnQobCkpKSAvIGwgKiBzdHJlbmd0aDtcbiAgICAgICAgICAgIG5vZGUudnggKz0gKHggKj0gbCkgKiAociA9IChyaiAqPSByaikgLyAocmkyICsgcmopKTtcbiAgICAgICAgICAgIG5vZGUudnkgKz0gKHkgKj0gbCkgKiByO1xuICAgICAgICAgICAgZGF0YS52eCAtPSB4ICogKHIgPSAxIC0gcik7XG4gICAgICAgICAgICBkYXRhLnZ5IC09IHkgKiByO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICByZXR1cm4geDAgPiB4aSArIHIgfHwgeDEgPCB4aSAtIHIgfHwgeTAgPiB5aSArIHIgfHwgeTEgPCB5aSAtIHI7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gcHJlcGFyZShxdWFkKSB7XG4gICAgaWYgKHF1YWQuZGF0YSkgcmV0dXJuIHF1YWQuciA9IHJhZGlpW3F1YWQuZGF0YS5pbmRleF07XG4gICAgZm9yICh2YXIgaSA9IHF1YWQuciA9IDA7IGkgPCA0OyArK2kpIHtcbiAgICAgIGlmIChxdWFkW2ldICYmIHF1YWRbaV0uciA+IHF1YWQucikge1xuICAgICAgICBxdWFkLnIgPSBxdWFkW2ldLnI7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gaW5pdGlhbGl6ZSgpIHtcbiAgICBpZiAoIW5vZGVzKSByZXR1cm47XG4gICAgdmFyIGksIG4gPSBub2Rlcy5sZW5ndGgsIG5vZGU7XG4gICAgcmFkaWkgPSBuZXcgQXJyYXkobik7XG4gICAgZm9yIChpID0gMDsgaSA8IG47ICsraSkgbm9kZSA9IG5vZGVzW2ldLCByYWRpaVtub2RlLmluZGV4XSA9ICtyYWRpdXMobm9kZSwgaSwgbm9kZXMpO1xuICB9XG5cbiAgZm9yY2UuaW5pdGlhbGl6ZSA9IGZ1bmN0aW9uKF9ub2RlcywgX3JhbmRvbSkge1xuICAgIG5vZGVzID0gX25vZGVzO1xuICAgIHJhbmRvbSA9IF9yYW5kb207XG4gICAgaW5pdGlhbGl6ZSgpO1xuICB9O1xuXG4gIGZvcmNlLml0ZXJhdGlvbnMgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoaXRlcmF0aW9ucyA9ICtfLCBmb3JjZSkgOiBpdGVyYXRpb25zO1xuICB9O1xuXG4gIGZvcmNlLnN0cmVuZ3RoID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHN0cmVuZ3RoID0gK18sIGZvcmNlKSA6IHN0cmVuZ3RoO1xuICB9O1xuXG4gIGZvcmNlLnJhZGl1cyA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChyYWRpdXMgPSB0eXBlb2YgXyA9PT0gXCJmdW5jdGlvblwiID8gXyA6IGNvbnN0YW50KCtfKSwgaW5pdGlhbGl6ZSgpLCBmb3JjZSkgOiByYWRpdXM7XG4gIH07XG5cbiAgcmV0dXJuIGZvcmNlO1xufVxuIiwgImltcG9ydCBjb25zdGFudCBmcm9tIFwiLi9jb25zdGFudC5qc1wiO1xuaW1wb3J0IGppZ2dsZSBmcm9tIFwiLi9qaWdnbGUuanNcIjtcblxuZnVuY3Rpb24gaW5kZXgoZCkge1xuICByZXR1cm4gZC5pbmRleDtcbn1cblxuZnVuY3Rpb24gZmluZChub2RlQnlJZCwgbm9kZUlkKSB7XG4gIHZhciBub2RlID0gbm9kZUJ5SWQuZ2V0KG5vZGVJZCk7XG4gIGlmICghbm9kZSkgdGhyb3cgbmV3IEVycm9yKFwibm9kZSBub3QgZm91bmQ6IFwiICsgbm9kZUlkKTtcbiAgcmV0dXJuIG5vZGU7XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGxpbmtzKSB7XG4gIHZhciBpZCA9IGluZGV4LFxuICAgICAgc3RyZW5ndGggPSBkZWZhdWx0U3RyZW5ndGgsXG4gICAgICBzdHJlbmd0aHMsXG4gICAgICBkaXN0YW5jZSA9IGNvbnN0YW50KDMwKSxcbiAgICAgIGRpc3RhbmNlcyxcbiAgICAgIG5vZGVzLFxuICAgICAgY291bnQsXG4gICAgICBiaWFzLFxuICAgICAgcmFuZG9tLFxuICAgICAgaXRlcmF0aW9ucyA9IDE7XG5cbiAgaWYgKGxpbmtzID09IG51bGwpIGxpbmtzID0gW107XG5cbiAgZnVuY3Rpb24gZGVmYXVsdFN0cmVuZ3RoKGxpbmspIHtcbiAgICByZXR1cm4gMSAvIE1hdGgubWluKGNvdW50W2xpbmsuc291cmNlLmluZGV4XSwgY291bnRbbGluay50YXJnZXQuaW5kZXhdKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGZvcmNlKGFscGhhKSB7XG4gICAgZm9yICh2YXIgayA9IDAsIG4gPSBsaW5rcy5sZW5ndGg7IGsgPCBpdGVyYXRpb25zOyArK2spIHtcbiAgICAgIGZvciAodmFyIGkgPSAwLCBsaW5rLCBzb3VyY2UsIHRhcmdldCwgeCwgeSwgbCwgYjsgaSA8IG47ICsraSkge1xuICAgICAgICBsaW5rID0gbGlua3NbaV0sIHNvdXJjZSA9IGxpbmsuc291cmNlLCB0YXJnZXQgPSBsaW5rLnRhcmdldDtcbiAgICAgICAgeCA9IHRhcmdldC54ICsgdGFyZ2V0LnZ4IC0gc291cmNlLnggLSBzb3VyY2UudnggfHwgamlnZ2xlKHJhbmRvbSk7XG4gICAgICAgIHkgPSB0YXJnZXQueSArIHRhcmdldC52eSAtIHNvdXJjZS55IC0gc291cmNlLnZ5IHx8IGppZ2dsZShyYW5kb20pO1xuICAgICAgICBsID0gTWF0aC5zcXJ0KHggKiB4ICsgeSAqIHkpO1xuICAgICAgICBsID0gKGwgLSBkaXN0YW5jZXNbaV0pIC8gbCAqIGFscGhhICogc3RyZW5ndGhzW2ldO1xuICAgICAgICB4ICo9IGwsIHkgKj0gbDtcbiAgICAgICAgdGFyZ2V0LnZ4IC09IHggKiAoYiA9IGJpYXNbaV0pO1xuICAgICAgICB0YXJnZXQudnkgLT0geSAqIGI7XG4gICAgICAgIHNvdXJjZS52eCArPSB4ICogKGIgPSAxIC0gYik7XG4gICAgICAgIHNvdXJjZS52eSArPSB5ICogYjtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBpbml0aWFsaXplKCkge1xuICAgIGlmICghbm9kZXMpIHJldHVybjtcblxuICAgIHZhciBpLFxuICAgICAgICBuID0gbm9kZXMubGVuZ3RoLFxuICAgICAgICBtID0gbGlua3MubGVuZ3RoLFxuICAgICAgICBub2RlQnlJZCA9IG5ldyBNYXAobm9kZXMubWFwKChkLCBpKSA9PiBbaWQoZCwgaSwgbm9kZXMpLCBkXSkpLFxuICAgICAgICBsaW5rO1xuXG4gICAgZm9yIChpID0gMCwgY291bnQgPSBuZXcgQXJyYXkobik7IGkgPCBtOyArK2kpIHtcbiAgICAgIGxpbmsgPSBsaW5rc1tpXSwgbGluay5pbmRleCA9IGk7XG4gICAgICBpZiAodHlwZW9mIGxpbmsuc291cmNlICE9PSBcIm9iamVjdFwiKSBsaW5rLnNvdXJjZSA9IGZpbmQobm9kZUJ5SWQsIGxpbmsuc291cmNlKTtcbiAgICAgIGlmICh0eXBlb2YgbGluay50YXJnZXQgIT09IFwib2JqZWN0XCIpIGxpbmsudGFyZ2V0ID0gZmluZChub2RlQnlJZCwgbGluay50YXJnZXQpO1xuICAgICAgY291bnRbbGluay5zb3VyY2UuaW5kZXhdID0gKGNvdW50W2xpbmsuc291cmNlLmluZGV4XSB8fCAwKSArIDE7XG4gICAgICBjb3VudFtsaW5rLnRhcmdldC5pbmRleF0gPSAoY291bnRbbGluay50YXJnZXQuaW5kZXhdIHx8IDApICsgMTtcbiAgICB9XG5cbiAgICBmb3IgKGkgPSAwLCBiaWFzID0gbmV3IEFycmF5KG0pOyBpIDwgbTsgKytpKSB7XG4gICAgICBsaW5rID0gbGlua3NbaV0sIGJpYXNbaV0gPSBjb3VudFtsaW5rLnNvdXJjZS5pbmRleF0gLyAoY291bnRbbGluay5zb3VyY2UuaW5kZXhdICsgY291bnRbbGluay50YXJnZXQuaW5kZXhdKTtcbiAgICB9XG5cbiAgICBzdHJlbmd0aHMgPSBuZXcgQXJyYXkobSksIGluaXRpYWxpemVTdHJlbmd0aCgpO1xuICAgIGRpc3RhbmNlcyA9IG5ldyBBcnJheShtKSwgaW5pdGlhbGl6ZURpc3RhbmNlKCk7XG4gIH1cblxuICBmdW5jdGlvbiBpbml0aWFsaXplU3RyZW5ndGgoKSB7XG4gICAgaWYgKCFub2RlcykgcmV0dXJuO1xuXG4gICAgZm9yICh2YXIgaSA9IDAsIG4gPSBsaW5rcy5sZW5ndGg7IGkgPCBuOyArK2kpIHtcbiAgICAgIHN0cmVuZ3Roc1tpXSA9ICtzdHJlbmd0aChsaW5rc1tpXSwgaSwgbGlua3MpO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGluaXRpYWxpemVEaXN0YW5jZSgpIHtcbiAgICBpZiAoIW5vZGVzKSByZXR1cm47XG5cbiAgICBmb3IgKHZhciBpID0gMCwgbiA9IGxpbmtzLmxlbmd0aDsgaSA8IG47ICsraSkge1xuICAgICAgZGlzdGFuY2VzW2ldID0gK2Rpc3RhbmNlKGxpbmtzW2ldLCBpLCBsaW5rcyk7XG4gICAgfVxuICB9XG5cbiAgZm9yY2UuaW5pdGlhbGl6ZSA9IGZ1bmN0aW9uKF9ub2RlcywgX3JhbmRvbSkge1xuICAgIG5vZGVzID0gX25vZGVzO1xuICAgIHJhbmRvbSA9IF9yYW5kb207XG4gICAgaW5pdGlhbGl6ZSgpO1xuICB9O1xuXG4gIGZvcmNlLmxpbmtzID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGxpbmtzID0gXywgaW5pdGlhbGl6ZSgpLCBmb3JjZSkgOiBsaW5rcztcbiAgfTtcblxuICBmb3JjZS5pZCA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChpZCA9IF8sIGZvcmNlKSA6IGlkO1xuICB9O1xuXG4gIGZvcmNlLml0ZXJhdGlvbnMgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoaXRlcmF0aW9ucyA9ICtfLCBmb3JjZSkgOiBpdGVyYXRpb25zO1xuICB9O1xuXG4gIGZvcmNlLnN0cmVuZ3RoID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHN0cmVuZ3RoID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudCgrXyksIGluaXRpYWxpemVTdHJlbmd0aCgpLCBmb3JjZSkgOiBzdHJlbmd0aDtcbiAgfTtcblxuICBmb3JjZS5kaXN0YW5jZSA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChkaXN0YW5jZSA9IHR5cGVvZiBfID09PSBcImZ1bmN0aW9uXCIgPyBfIDogY29uc3RhbnQoK18pLCBpbml0aWFsaXplRGlzdGFuY2UoKSwgZm9yY2UpIDogZGlzdGFuY2U7XG4gIH07XG5cbiAgcmV0dXJuIGZvcmNlO1xufVxuIiwgIi8vIGh0dHBzOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL0xpbmVhcl9jb25ncnVlbnRpYWxfZ2VuZXJhdG9yI1BhcmFtZXRlcnNfaW5fY29tbW9uX3VzZVxuY29uc3QgYSA9IDE2NjQ1MjU7XG5jb25zdCBjID0gMTAxMzkwNDIyMztcbmNvbnN0IG0gPSA0Mjk0OTY3Mjk2OyAvLyAyXjMyXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKCkge1xuICBsZXQgcyA9IDE7XG4gIHJldHVybiAoKSA9PiAocyA9IChhICogcyArIGMpICUgbSkgLyBtO1xufVxuIiwgImltcG9ydCB7ZGlzcGF0Y2h9IGZyb20gXCJkMy1kaXNwYXRjaFwiO1xuaW1wb3J0IHt0aW1lcn0gZnJvbSBcImQzLXRpbWVyXCI7XG5pbXBvcnQgbGNnIGZyb20gXCIuL2xjZy5qc1wiO1xuXG5leHBvcnQgZnVuY3Rpb24geChkKSB7XG4gIHJldHVybiBkLng7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB5KGQpIHtcbiAgcmV0dXJuIGQueTtcbn1cblxudmFyIGluaXRpYWxSYWRpdXMgPSAxMCxcbiAgICBpbml0aWFsQW5nbGUgPSBNYXRoLlBJICogKDMgLSBNYXRoLnNxcnQoNSkpO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihub2Rlcykge1xuICB2YXIgc2ltdWxhdGlvbixcbiAgICAgIGFscGhhID0gMSxcbiAgICAgIGFscGhhTWluID0gMC4wMDEsXG4gICAgICBhbHBoYURlY2F5ID0gMSAtIE1hdGgucG93KGFscGhhTWluLCAxIC8gMzAwKSxcbiAgICAgIGFscGhhVGFyZ2V0ID0gMCxcbiAgICAgIHZlbG9jaXR5RGVjYXkgPSAwLjYsXG4gICAgICBmb3JjZXMgPSBuZXcgTWFwKCksXG4gICAgICBzdGVwcGVyID0gdGltZXIoc3RlcCksXG4gICAgICBldmVudCA9IGRpc3BhdGNoKFwidGlja1wiLCBcImVuZFwiKSxcbiAgICAgIHJhbmRvbSA9IGxjZygpO1xuXG4gIGlmIChub2RlcyA9PSBudWxsKSBub2RlcyA9IFtdO1xuXG4gIGZ1bmN0aW9uIHN0ZXAoKSB7XG4gICAgdGljaygpO1xuICAgIGV2ZW50LmNhbGwoXCJ0aWNrXCIsIHNpbXVsYXRpb24pO1xuICAgIGlmIChhbHBoYSA8IGFscGhhTWluKSB7XG4gICAgICBzdGVwcGVyLnN0b3AoKTtcbiAgICAgIGV2ZW50LmNhbGwoXCJlbmRcIiwgc2ltdWxhdGlvbik7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gdGljayhpdGVyYXRpb25zKSB7XG4gICAgdmFyIGksIG4gPSBub2Rlcy5sZW5ndGgsIG5vZGU7XG5cbiAgICBpZiAoaXRlcmF0aW9ucyA9PT0gdW5kZWZpbmVkKSBpdGVyYXRpb25zID0gMTtcblxuICAgIGZvciAodmFyIGsgPSAwOyBrIDwgaXRlcmF0aW9uczsgKytrKSB7XG4gICAgICBhbHBoYSArPSAoYWxwaGFUYXJnZXQgLSBhbHBoYSkgKiBhbHBoYURlY2F5O1xuXG4gICAgICBmb3JjZXMuZm9yRWFjaChmdW5jdGlvbihmb3JjZSkge1xuICAgICAgICBmb3JjZShhbHBoYSk7XG4gICAgICB9KTtcblxuICAgICAgZm9yIChpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgICBub2RlID0gbm9kZXNbaV07XG4gICAgICAgIGlmIChub2RlLmZ4ID09IG51bGwpIG5vZGUueCArPSBub2RlLnZ4ICo9IHZlbG9jaXR5RGVjYXk7XG4gICAgICAgIGVsc2Ugbm9kZS54ID0gbm9kZS5meCwgbm9kZS52eCA9IDA7XG4gICAgICAgIGlmIChub2RlLmZ5ID09IG51bGwpIG5vZGUueSArPSBub2RlLnZ5ICo9IHZlbG9jaXR5RGVjYXk7XG4gICAgICAgIGVsc2Ugbm9kZS55ID0gbm9kZS5meSwgbm9kZS52eSA9IDA7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHNpbXVsYXRpb247XG4gIH1cblxuICBmdW5jdGlvbiBpbml0aWFsaXplTm9kZXMoKSB7XG4gICAgZm9yICh2YXIgaSA9IDAsIG4gPSBub2Rlcy5sZW5ndGgsIG5vZGU7IGkgPCBuOyArK2kpIHtcbiAgICAgIG5vZGUgPSBub2Rlc1tpXSwgbm9kZS5pbmRleCA9IGk7XG4gICAgICBpZiAobm9kZS5meCAhPSBudWxsKSBub2RlLnggPSBub2RlLmZ4O1xuICAgICAgaWYgKG5vZGUuZnkgIT0gbnVsbCkgbm9kZS55ID0gbm9kZS5meTtcbiAgICAgIGlmIChpc05hTihub2RlLngpIHx8IGlzTmFOKG5vZGUueSkpIHtcbiAgICAgICAgdmFyIHJhZGl1cyA9IGluaXRpYWxSYWRpdXMgKiBNYXRoLnNxcnQoMC41ICsgaSksIGFuZ2xlID0gaSAqIGluaXRpYWxBbmdsZTtcbiAgICAgICAgbm9kZS54ID0gcmFkaXVzICogTWF0aC5jb3MoYW5nbGUpO1xuICAgICAgICBub2RlLnkgPSByYWRpdXMgKiBNYXRoLnNpbihhbmdsZSk7XG4gICAgICB9XG4gICAgICBpZiAoaXNOYU4obm9kZS52eCkgfHwgaXNOYU4obm9kZS52eSkpIHtcbiAgICAgICAgbm9kZS52eCA9IG5vZGUudnkgPSAwO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGluaXRpYWxpemVGb3JjZShmb3JjZSkge1xuICAgIGlmIChmb3JjZS5pbml0aWFsaXplKSBmb3JjZS5pbml0aWFsaXplKG5vZGVzLCByYW5kb20pO1xuICAgIHJldHVybiBmb3JjZTtcbiAgfVxuXG4gIGluaXRpYWxpemVOb2RlcygpO1xuXG4gIHJldHVybiBzaW11bGF0aW9uID0ge1xuICAgIHRpY2s6IHRpY2ssXG5cbiAgICByZXN0YXJ0OiBmdW5jdGlvbigpIHtcbiAgICAgIHJldHVybiBzdGVwcGVyLnJlc3RhcnQoc3RlcCksIHNpbXVsYXRpb247XG4gICAgfSxcblxuICAgIHN0b3A6IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIHN0ZXBwZXIuc3RvcCgpLCBzaW11bGF0aW9uO1xuICAgIH0sXG5cbiAgICBub2RlczogZnVuY3Rpb24oXykge1xuICAgICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAobm9kZXMgPSBfLCBpbml0aWFsaXplTm9kZXMoKSwgZm9yY2VzLmZvckVhY2goaW5pdGlhbGl6ZUZvcmNlKSwgc2ltdWxhdGlvbikgOiBub2RlcztcbiAgICB9LFxuXG4gICAgYWxwaGE6IGZ1bmN0aW9uKF8pIHtcbiAgICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGFscGhhID0gK18sIHNpbXVsYXRpb24pIDogYWxwaGE7XG4gICAgfSxcblxuICAgIGFscGhhTWluOiBmdW5jdGlvbihfKSB7XG4gICAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChhbHBoYU1pbiA9ICtfLCBzaW11bGF0aW9uKSA6IGFscGhhTWluO1xuICAgIH0sXG5cbiAgICBhbHBoYURlY2F5OiBmdW5jdGlvbihfKSB7XG4gICAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChhbHBoYURlY2F5ID0gK18sIHNpbXVsYXRpb24pIDogK2FscGhhRGVjYXk7XG4gICAgfSxcblxuICAgIGFscGhhVGFyZ2V0OiBmdW5jdGlvbihfKSB7XG4gICAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChhbHBoYVRhcmdldCA9ICtfLCBzaW11bGF0aW9uKSA6IGFscGhhVGFyZ2V0O1xuICAgIH0sXG5cbiAgICB2ZWxvY2l0eURlY2F5OiBmdW5jdGlvbihfKSB7XG4gICAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/ICh2ZWxvY2l0eURlY2F5ID0gMSAtIF8sIHNpbXVsYXRpb24pIDogMSAtIHZlbG9jaXR5RGVjYXk7XG4gICAgfSxcblxuICAgIHJhbmRvbVNvdXJjZTogZnVuY3Rpb24oXykge1xuICAgICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAocmFuZG9tID0gXywgZm9yY2VzLmZvckVhY2goaW5pdGlhbGl6ZUZvcmNlKSwgc2ltdWxhdGlvbikgOiByYW5kb207XG4gICAgfSxcblxuICAgIGZvcmNlOiBmdW5jdGlvbihuYW1lLCBfKSB7XG4gICAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA+IDEgPyAoKF8gPT0gbnVsbCA/IGZvcmNlcy5kZWxldGUobmFtZSkgOiBmb3JjZXMuc2V0KG5hbWUsIGluaXRpYWxpemVGb3JjZShfKSkpLCBzaW11bGF0aW9uKSA6IGZvcmNlcy5nZXQobmFtZSk7XG4gICAgfSxcblxuICAgIGZpbmQ6IGZ1bmN0aW9uKHgsIHksIHJhZGl1cykge1xuICAgICAgdmFyIGkgPSAwLFxuICAgICAgICAgIG4gPSBub2Rlcy5sZW5ndGgsXG4gICAgICAgICAgZHgsXG4gICAgICAgICAgZHksXG4gICAgICAgICAgZDIsXG4gICAgICAgICAgbm9kZSxcbiAgICAgICAgICBjbG9zZXN0O1xuXG4gICAgICBpZiAocmFkaXVzID09IG51bGwpIHJhZGl1cyA9IEluZmluaXR5O1xuICAgICAgZWxzZSByYWRpdXMgKj0gcmFkaXVzO1xuXG4gICAgICBmb3IgKGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICAgIG5vZGUgPSBub2Rlc1tpXTtcbiAgICAgICAgZHggPSB4IC0gbm9kZS54O1xuICAgICAgICBkeSA9IHkgLSBub2RlLnk7XG4gICAgICAgIGQyID0gZHggKiBkeCArIGR5ICogZHk7XG4gICAgICAgIGlmIChkMiA8IHJhZGl1cykgY2xvc2VzdCA9IG5vZGUsIHJhZGl1cyA9IGQyO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gY2xvc2VzdDtcbiAgICB9LFxuXG4gICAgb246IGZ1bmN0aW9uKG5hbWUsIF8pIHtcbiAgICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID4gMSA/IChldmVudC5vbihuYW1lLCBfKSwgc2ltdWxhdGlvbikgOiBldmVudC5vbihuYW1lKTtcbiAgICB9XG4gIH07XG59XG4iLCAiaW1wb3J0IHtxdWFkdHJlZX0gZnJvbSBcImQzLXF1YWR0cmVlXCI7XG5pbXBvcnQgY29uc3RhbnQgZnJvbSBcIi4vY29uc3RhbnQuanNcIjtcbmltcG9ydCBqaWdnbGUgZnJvbSBcIi4vamlnZ2xlLmpzXCI7XG5pbXBvcnQge3gsIHl9IGZyb20gXCIuL3NpbXVsYXRpb24uanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIHZhciBub2RlcyxcbiAgICAgIG5vZGUsXG4gICAgICByYW5kb20sXG4gICAgICBhbHBoYSxcbiAgICAgIHN0cmVuZ3RoID0gY29uc3RhbnQoLTMwKSxcbiAgICAgIHN0cmVuZ3RocyxcbiAgICAgIGRpc3RhbmNlTWluMiA9IDEsXG4gICAgICBkaXN0YW5jZU1heDIgPSBJbmZpbml0eSxcbiAgICAgIHRoZXRhMiA9IDAuODE7XG5cbiAgZnVuY3Rpb24gZm9yY2UoXykge1xuICAgIHZhciBpLCBuID0gbm9kZXMubGVuZ3RoLCB0cmVlID0gcXVhZHRyZWUobm9kZXMsIHgsIHkpLnZpc2l0QWZ0ZXIoYWNjdW11bGF0ZSk7XG4gICAgZm9yIChhbHBoYSA9IF8sIGkgPSAwOyBpIDwgbjsgKytpKSBub2RlID0gbm9kZXNbaV0sIHRyZWUudmlzaXQoYXBwbHkpO1xuICB9XG5cbiAgZnVuY3Rpb24gaW5pdGlhbGl6ZSgpIHtcbiAgICBpZiAoIW5vZGVzKSByZXR1cm47XG4gICAgdmFyIGksIG4gPSBub2Rlcy5sZW5ndGgsIG5vZGU7XG4gICAgc3RyZW5ndGhzID0gbmV3IEFycmF5KG4pO1xuICAgIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIG5vZGUgPSBub2Rlc1tpXSwgc3RyZW5ndGhzW25vZGUuaW5kZXhdID0gK3N0cmVuZ3RoKG5vZGUsIGksIG5vZGVzKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGFjY3VtdWxhdGUocXVhZCkge1xuICAgIHZhciBzdHJlbmd0aCA9IDAsIHEsIGMsIHdlaWdodCA9IDAsIHgsIHksIGk7XG5cbiAgICAvLyBGb3IgaW50ZXJuYWwgbm9kZXMsIGFjY3VtdWxhdGUgZm9yY2VzIGZyb20gY2hpbGQgcXVhZHJhbnRzLlxuICAgIGlmIChxdWFkLmxlbmd0aCkge1xuICAgICAgZm9yICh4ID0geSA9IGkgPSAwOyBpIDwgNDsgKytpKSB7XG4gICAgICAgIGlmICgocSA9IHF1YWRbaV0pICYmIChjID0gTWF0aC5hYnMocS52YWx1ZSkpKSB7XG4gICAgICAgICAgc3RyZW5ndGggKz0gcS52YWx1ZSwgd2VpZ2h0ICs9IGMsIHggKz0gYyAqIHEueCwgeSArPSBjICogcS55O1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBxdWFkLnggPSB4IC8gd2VpZ2h0O1xuICAgICAgcXVhZC55ID0geSAvIHdlaWdodDtcbiAgICB9XG5cbiAgICAvLyBGb3IgbGVhZiBub2RlcywgYWNjdW11bGF0ZSBmb3JjZXMgZnJvbSBjb2luY2lkZW50IHF1YWRyYW50cy5cbiAgICBlbHNlIHtcbiAgICAgIHEgPSBxdWFkO1xuICAgICAgcS54ID0gcS5kYXRhLng7XG4gICAgICBxLnkgPSBxLmRhdGEueTtcbiAgICAgIGRvIHN0cmVuZ3RoICs9IHN0cmVuZ3Roc1txLmRhdGEuaW5kZXhdO1xuICAgICAgd2hpbGUgKHEgPSBxLm5leHQpO1xuICAgIH1cblxuICAgIHF1YWQudmFsdWUgPSBzdHJlbmd0aDtcbiAgfVxuXG4gIGZ1bmN0aW9uIGFwcGx5KHF1YWQsIHgxLCBfLCB4Mikge1xuICAgIGlmICghcXVhZC52YWx1ZSkgcmV0dXJuIHRydWU7XG5cbiAgICB2YXIgeCA9IHF1YWQueCAtIG5vZGUueCxcbiAgICAgICAgeSA9IHF1YWQueSAtIG5vZGUueSxcbiAgICAgICAgdyA9IHgyIC0geDEsXG4gICAgICAgIGwgPSB4ICogeCArIHkgKiB5O1xuXG4gICAgLy8gQXBwbHkgdGhlIEJhcm5lcy1IdXQgYXBwcm94aW1hdGlvbiBpZiBwb3NzaWJsZS5cbiAgICAvLyBMaW1pdCBmb3JjZXMgZm9yIHZlcnkgY2xvc2Ugbm9kZXM7IHJhbmRvbWl6ZSBkaXJlY3Rpb24gaWYgY29pbmNpZGVudC5cbiAgICBpZiAodyAqIHcgLyB0aGV0YTIgPCBsKSB7XG4gICAgICBpZiAobCA8IGRpc3RhbmNlTWF4Mikge1xuICAgICAgICBpZiAoeCA9PT0gMCkgeCA9IGppZ2dsZShyYW5kb20pLCBsICs9IHggKiB4O1xuICAgICAgICBpZiAoeSA9PT0gMCkgeSA9IGppZ2dsZShyYW5kb20pLCBsICs9IHkgKiB5O1xuICAgICAgICBpZiAobCA8IGRpc3RhbmNlTWluMikgbCA9IE1hdGguc3FydChkaXN0YW5jZU1pbjIgKiBsKTtcbiAgICAgICAgbm9kZS52eCArPSB4ICogcXVhZC52YWx1ZSAqIGFscGhhIC8gbDtcbiAgICAgICAgbm9kZS52eSArPSB5ICogcXVhZC52YWx1ZSAqIGFscGhhIC8gbDtcbiAgICAgIH1cbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIC8vIE90aGVyd2lzZSwgcHJvY2VzcyBwb2ludHMgZGlyZWN0bHkuXG4gICAgZWxzZSBpZiAocXVhZC5sZW5ndGggfHwgbCA+PSBkaXN0YW5jZU1heDIpIHJldHVybjtcblxuICAgIC8vIExpbWl0IGZvcmNlcyBmb3IgdmVyeSBjbG9zZSBub2RlczsgcmFuZG9taXplIGRpcmVjdGlvbiBpZiBjb2luY2lkZW50LlxuICAgIGlmIChxdWFkLmRhdGEgIT09IG5vZGUgfHwgcXVhZC5uZXh0KSB7XG4gICAgICBpZiAoeCA9PT0gMCkgeCA9IGppZ2dsZShyYW5kb20pLCBsICs9IHggKiB4O1xuICAgICAgaWYgKHkgPT09IDApIHkgPSBqaWdnbGUocmFuZG9tKSwgbCArPSB5ICogeTtcbiAgICAgIGlmIChsIDwgZGlzdGFuY2VNaW4yKSBsID0gTWF0aC5zcXJ0KGRpc3RhbmNlTWluMiAqIGwpO1xuICAgIH1cblxuICAgIGRvIGlmIChxdWFkLmRhdGEgIT09IG5vZGUpIHtcbiAgICAgIHcgPSBzdHJlbmd0aHNbcXVhZC5kYXRhLmluZGV4XSAqIGFscGhhIC8gbDtcbiAgICAgIG5vZGUudnggKz0geCAqIHc7XG4gICAgICBub2RlLnZ5ICs9IHkgKiB3O1xuICAgIH0gd2hpbGUgKHF1YWQgPSBxdWFkLm5leHQpO1xuICB9XG5cbiAgZm9yY2UuaW5pdGlhbGl6ZSA9IGZ1bmN0aW9uKF9ub2RlcywgX3JhbmRvbSkge1xuICAgIG5vZGVzID0gX25vZGVzO1xuICAgIHJhbmRvbSA9IF9yYW5kb207XG4gICAgaW5pdGlhbGl6ZSgpO1xuICB9O1xuXG4gIGZvcmNlLnN0cmVuZ3RoID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHN0cmVuZ3RoID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudCgrXyksIGluaXRpYWxpemUoKSwgZm9yY2UpIDogc3RyZW5ndGg7XG4gIH07XG5cbiAgZm9yY2UuZGlzdGFuY2VNaW4gPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoZGlzdGFuY2VNaW4yID0gXyAqIF8sIGZvcmNlKSA6IE1hdGguc3FydChkaXN0YW5jZU1pbjIpO1xuICB9O1xuXG4gIGZvcmNlLmRpc3RhbmNlTWF4ID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGRpc3RhbmNlTWF4MiA9IF8gKiBfLCBmb3JjZSkgOiBNYXRoLnNxcnQoZGlzdGFuY2VNYXgyKTtcbiAgfTtcblxuICBmb3JjZS50aGV0YSA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/ICh0aGV0YTIgPSBfICogXywgZm9yY2UpIDogTWF0aC5zcXJ0KHRoZXRhMik7XG4gIH07XG5cbiAgcmV0dXJuIGZvcmNlO1xufVxuIiwgImltcG9ydCBjb25zdGFudCBmcm9tIFwiLi9jb25zdGFudC5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih4KSB7XG4gIHZhciBzdHJlbmd0aCA9IGNvbnN0YW50KDAuMSksXG4gICAgICBub2RlcyxcbiAgICAgIHN0cmVuZ3RocyxcbiAgICAgIHh6O1xuXG4gIGlmICh0eXBlb2YgeCAhPT0gXCJmdW5jdGlvblwiKSB4ID0gY29uc3RhbnQoeCA9PSBudWxsID8gMCA6ICt4KTtcblxuICBmdW5jdGlvbiBmb3JjZShhbHBoYSkge1xuICAgIGZvciAodmFyIGkgPSAwLCBuID0gbm9kZXMubGVuZ3RoLCBub2RlOyBpIDwgbjsgKytpKSB7XG4gICAgICBub2RlID0gbm9kZXNbaV0sIG5vZGUudnggKz0gKHh6W2ldIC0gbm9kZS54KSAqIHN0cmVuZ3Roc1tpXSAqIGFscGhhO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGluaXRpYWxpemUoKSB7XG4gICAgaWYgKCFub2RlcykgcmV0dXJuO1xuICAgIHZhciBpLCBuID0gbm9kZXMubGVuZ3RoO1xuICAgIHN0cmVuZ3RocyA9IG5ldyBBcnJheShuKTtcbiAgICB4eiA9IG5ldyBBcnJheShuKTtcbiAgICBmb3IgKGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICBzdHJlbmd0aHNbaV0gPSBpc05hTih4eltpXSA9ICt4KG5vZGVzW2ldLCBpLCBub2RlcykpID8gMCA6ICtzdHJlbmd0aChub2Rlc1tpXSwgaSwgbm9kZXMpO1xuICAgIH1cbiAgfVxuXG4gIGZvcmNlLmluaXRpYWxpemUgPSBmdW5jdGlvbihfKSB7XG4gICAgbm9kZXMgPSBfO1xuICAgIGluaXRpYWxpemUoKTtcbiAgfTtcblxuICBmb3JjZS5zdHJlbmd0aCA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChzdHJlbmd0aCA9IHR5cGVvZiBfID09PSBcImZ1bmN0aW9uXCIgPyBfIDogY29uc3RhbnQoK18pLCBpbml0aWFsaXplKCksIGZvcmNlKSA6IHN0cmVuZ3RoO1xuICB9O1xuXG4gIGZvcmNlLnggPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoeCA9IHR5cGVvZiBfID09PSBcImZ1bmN0aW9uXCIgPyBfIDogY29uc3RhbnQoK18pLCBpbml0aWFsaXplKCksIGZvcmNlKSA6IHg7XG4gIH07XG5cbiAgcmV0dXJuIGZvcmNlO1xufVxuIiwgImltcG9ydCBjb25zdGFudCBmcm9tIFwiLi9jb25zdGFudC5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih5KSB7XG4gIHZhciBzdHJlbmd0aCA9IGNvbnN0YW50KDAuMSksXG4gICAgICBub2RlcyxcbiAgICAgIHN0cmVuZ3RocyxcbiAgICAgIHl6O1xuXG4gIGlmICh0eXBlb2YgeSAhPT0gXCJmdW5jdGlvblwiKSB5ID0gY29uc3RhbnQoeSA9PSBudWxsID8gMCA6ICt5KTtcblxuICBmdW5jdGlvbiBmb3JjZShhbHBoYSkge1xuICAgIGZvciAodmFyIGkgPSAwLCBuID0gbm9kZXMubGVuZ3RoLCBub2RlOyBpIDwgbjsgKytpKSB7XG4gICAgICBub2RlID0gbm9kZXNbaV0sIG5vZGUudnkgKz0gKHl6W2ldIC0gbm9kZS55KSAqIHN0cmVuZ3Roc1tpXSAqIGFscGhhO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGluaXRpYWxpemUoKSB7XG4gICAgaWYgKCFub2RlcykgcmV0dXJuO1xuICAgIHZhciBpLCBuID0gbm9kZXMubGVuZ3RoO1xuICAgIHN0cmVuZ3RocyA9IG5ldyBBcnJheShuKTtcbiAgICB5eiA9IG5ldyBBcnJheShuKTtcbiAgICBmb3IgKGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICBzdHJlbmd0aHNbaV0gPSBpc05hTih5eltpXSA9ICt5KG5vZGVzW2ldLCBpLCBub2RlcykpID8gMCA6ICtzdHJlbmd0aChub2Rlc1tpXSwgaSwgbm9kZXMpO1xuICAgIH1cbiAgfVxuXG4gIGZvcmNlLmluaXRpYWxpemUgPSBmdW5jdGlvbihfKSB7XG4gICAgbm9kZXMgPSBfO1xuICAgIGluaXRpYWxpemUoKTtcbiAgfTtcblxuICBmb3JjZS5zdHJlbmd0aCA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChzdHJlbmd0aCA9IHR5cGVvZiBfID09PSBcImZ1bmN0aW9uXCIgPyBfIDogY29uc3RhbnQoK18pLCBpbml0aWFsaXplKCksIGZvcmNlKSA6IHN0cmVuZ3RoO1xuICB9O1xuXG4gIGZvcmNlLnkgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoeSA9IHR5cGVvZiBfID09PSBcImZ1bmN0aW9uXCIgPyBfIDogY29uc3RhbnQoK18pLCBpbml0aWFsaXplKCksIGZvcmNlKSA6IHk7XG4gIH07XG5cbiAgcmV0dXJuIGZvcmNlO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IHggPT4gKCkgPT4geDtcbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBab29tRXZlbnQodHlwZSwge1xuICBzb3VyY2VFdmVudCxcbiAgdGFyZ2V0LFxuICB0cmFuc2Zvcm0sXG4gIGRpc3BhdGNoXG59KSB7XG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzKHRoaXMsIHtcbiAgICB0eXBlOiB7dmFsdWU6IHR5cGUsIGVudW1lcmFibGU6IHRydWUsIGNvbmZpZ3VyYWJsZTogdHJ1ZX0sXG4gICAgc291cmNlRXZlbnQ6IHt2YWx1ZTogc291cmNlRXZlbnQsIGVudW1lcmFibGU6IHRydWUsIGNvbmZpZ3VyYWJsZTogdHJ1ZX0sXG4gICAgdGFyZ2V0OiB7dmFsdWU6IHRhcmdldCwgZW51bWVyYWJsZTogdHJ1ZSwgY29uZmlndXJhYmxlOiB0cnVlfSxcbiAgICB0cmFuc2Zvcm06IHt2YWx1ZTogdHJhbnNmb3JtLCBlbnVtZXJhYmxlOiB0cnVlLCBjb25maWd1cmFibGU6IHRydWV9LFxuICAgIF86IHt2YWx1ZTogZGlzcGF0Y2h9XG4gIH0pO1xufVxuIiwgImV4cG9ydCBmdW5jdGlvbiBUcmFuc2Zvcm0oaywgeCwgeSkge1xuICB0aGlzLmsgPSBrO1xuICB0aGlzLnggPSB4O1xuICB0aGlzLnkgPSB5O1xufVxuXG5UcmFuc2Zvcm0ucHJvdG90eXBlID0ge1xuICBjb25zdHJ1Y3RvcjogVHJhbnNmb3JtLFxuICBzY2FsZTogZnVuY3Rpb24oaykge1xuICAgIHJldHVybiBrID09PSAxID8gdGhpcyA6IG5ldyBUcmFuc2Zvcm0odGhpcy5rICogaywgdGhpcy54LCB0aGlzLnkpO1xuICB9LFxuICB0cmFuc2xhdGU6IGZ1bmN0aW9uKHgsIHkpIHtcbiAgICByZXR1cm4geCA9PT0gMCAmIHkgPT09IDAgPyB0aGlzIDogbmV3IFRyYW5zZm9ybSh0aGlzLmssIHRoaXMueCArIHRoaXMuayAqIHgsIHRoaXMueSArIHRoaXMuayAqIHkpO1xuICB9LFxuICBhcHBseTogZnVuY3Rpb24ocG9pbnQpIHtcbiAgICByZXR1cm4gW3BvaW50WzBdICogdGhpcy5rICsgdGhpcy54LCBwb2ludFsxXSAqIHRoaXMuayArIHRoaXMueV07XG4gIH0sXG4gIGFwcGx5WDogZnVuY3Rpb24oeCkge1xuICAgIHJldHVybiB4ICogdGhpcy5rICsgdGhpcy54O1xuICB9LFxuICBhcHBseVk6IGZ1bmN0aW9uKHkpIHtcbiAgICByZXR1cm4geSAqIHRoaXMuayArIHRoaXMueTtcbiAgfSxcbiAgaW52ZXJ0OiBmdW5jdGlvbihsb2NhdGlvbikge1xuICAgIHJldHVybiBbKGxvY2F0aW9uWzBdIC0gdGhpcy54KSAvIHRoaXMuaywgKGxvY2F0aW9uWzFdIC0gdGhpcy55KSAvIHRoaXMua107XG4gIH0sXG4gIGludmVydFg6IGZ1bmN0aW9uKHgpIHtcbiAgICByZXR1cm4gKHggLSB0aGlzLngpIC8gdGhpcy5rO1xuICB9LFxuICBpbnZlcnRZOiBmdW5jdGlvbih5KSB7XG4gICAgcmV0dXJuICh5IC0gdGhpcy55KSAvIHRoaXMuaztcbiAgfSxcbiAgcmVzY2FsZVg6IGZ1bmN0aW9uKHgpIHtcbiAgICByZXR1cm4geC5jb3B5KCkuZG9tYWluKHgucmFuZ2UoKS5tYXAodGhpcy5pbnZlcnRYLCB0aGlzKS5tYXAoeC5pbnZlcnQsIHgpKTtcbiAgfSxcbiAgcmVzY2FsZVk6IGZ1bmN0aW9uKHkpIHtcbiAgICByZXR1cm4geS5jb3B5KCkuZG9tYWluKHkucmFuZ2UoKS5tYXAodGhpcy5pbnZlcnRZLCB0aGlzKS5tYXAoeS5pbnZlcnQsIHkpKTtcbiAgfSxcbiAgdG9TdHJpbmc6IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBcInRyYW5zbGF0ZShcIiArIHRoaXMueCArIFwiLFwiICsgdGhpcy55ICsgXCIpIHNjYWxlKFwiICsgdGhpcy5rICsgXCIpXCI7XG4gIH1cbn07XG5cbmV4cG9ydCB2YXIgaWRlbnRpdHkgPSBuZXcgVHJhbnNmb3JtKDEsIDAsIDApO1xuXG50cmFuc2Zvcm0ucHJvdG90eXBlID0gVHJhbnNmb3JtLnByb3RvdHlwZTtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gdHJhbnNmb3JtKG5vZGUpIHtcbiAgd2hpbGUgKCFub2RlLl9fem9vbSkgaWYgKCEobm9kZSA9IG5vZGUucGFyZW50Tm9kZSkpIHJldHVybiBpZGVudGl0eTtcbiAgcmV0dXJuIG5vZGUuX196b29tO1xufVxuIiwgImV4cG9ydCBmdW5jdGlvbiBub3Byb3BhZ2F0aW9uKGV2ZW50KSB7XG4gIGV2ZW50LnN0b3BJbW1lZGlhdGVQcm9wYWdhdGlvbigpO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihldmVudCkge1xuICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICBldmVudC5zdG9wSW1tZWRpYXRlUHJvcGFnYXRpb24oKTtcbn1cbiIsICJpbXBvcnQge2Rpc3BhdGNofSBmcm9tIFwiZDMtZGlzcGF0Y2hcIjtcbmltcG9ydCB7ZHJhZ0Rpc2FibGUsIGRyYWdFbmFibGV9IGZyb20gXCJkMy1kcmFnXCI7XG5pbXBvcnQge2ludGVycG9sYXRlWm9vbX0gZnJvbSBcImQzLWludGVycG9sYXRlXCI7XG5pbXBvcnQge3NlbGVjdCwgcG9pbnRlcn0gZnJvbSBcImQzLXNlbGVjdGlvblwiO1xuaW1wb3J0IHtpbnRlcnJ1cHR9IGZyb20gXCJkMy10cmFuc2l0aW9uXCI7XG5pbXBvcnQgY29uc3RhbnQgZnJvbSBcIi4vY29uc3RhbnQuanNcIjtcbmltcG9ydCBab29tRXZlbnQgZnJvbSBcIi4vZXZlbnQuanNcIjtcbmltcG9ydCB7VHJhbnNmb3JtLCBpZGVudGl0eX0gZnJvbSBcIi4vdHJhbnNmb3JtLmpzXCI7XG5pbXBvcnQgbm9ldmVudCwge25vcHJvcGFnYXRpb259IGZyb20gXCIuL25vZXZlbnQuanNcIjtcblxuLy8gSWdub3JlIHJpZ2h0LWNsaWNrLCBzaW5jZSB0aGF0IHNob3VsZCBvcGVuIHRoZSBjb250ZXh0IG1lbnUuXG4vLyBleGNlcHQgZm9yIHBpbmNoLXRvLXpvb20sIHdoaWNoIGlzIHNlbnQgYXMgYSB3aGVlbCtjdHJsS2V5IGV2ZW50XG5mdW5jdGlvbiBkZWZhdWx0RmlsdGVyKGV2ZW50KSB7XG4gIHJldHVybiAoIWV2ZW50LmN0cmxLZXkgfHwgZXZlbnQudHlwZSA9PT0gJ3doZWVsJykgJiYgIWV2ZW50LmJ1dHRvbjtcbn1cblxuZnVuY3Rpb24gZGVmYXVsdEV4dGVudCgpIHtcbiAgdmFyIGUgPSB0aGlzO1xuICBpZiAoZSBpbnN0YW5jZW9mIFNWR0VsZW1lbnQpIHtcbiAgICBlID0gZS5vd25lclNWR0VsZW1lbnQgfHwgZTtcbiAgICBpZiAoZS5oYXNBdHRyaWJ1dGUoXCJ2aWV3Qm94XCIpKSB7XG4gICAgICBlID0gZS52aWV3Qm94LmJhc2VWYWw7XG4gICAgICByZXR1cm4gW1tlLngsIGUueV0sIFtlLnggKyBlLndpZHRoLCBlLnkgKyBlLmhlaWdodF1dO1xuICAgIH1cbiAgICByZXR1cm4gW1swLCAwXSwgW2Uud2lkdGguYmFzZVZhbC52YWx1ZSwgZS5oZWlnaHQuYmFzZVZhbC52YWx1ZV1dO1xuICB9XG4gIHJldHVybiBbWzAsIDBdLCBbZS5jbGllbnRXaWR0aCwgZS5jbGllbnRIZWlnaHRdXTtcbn1cblxuZnVuY3Rpb24gZGVmYXVsdFRyYW5zZm9ybSgpIHtcbiAgcmV0dXJuIHRoaXMuX196b29tIHx8IGlkZW50aXR5O1xufVxuXG5mdW5jdGlvbiBkZWZhdWx0V2hlZWxEZWx0YShldmVudCkge1xuICByZXR1cm4gLWV2ZW50LmRlbHRhWSAqIChldmVudC5kZWx0YU1vZGUgPT09IDEgPyAwLjA1IDogZXZlbnQuZGVsdGFNb2RlID8gMSA6IDAuMDAyKSAqIChldmVudC5jdHJsS2V5ID8gMTAgOiAxKTtcbn1cblxuZnVuY3Rpb24gZGVmYXVsdFRvdWNoYWJsZSgpIHtcbiAgcmV0dXJuIG5hdmlnYXRvci5tYXhUb3VjaFBvaW50cyB8fCAoXCJvbnRvdWNoc3RhcnRcIiBpbiB0aGlzKTtcbn1cblxuZnVuY3Rpb24gZGVmYXVsdENvbnN0cmFpbih0cmFuc2Zvcm0sIGV4dGVudCwgdHJhbnNsYXRlRXh0ZW50KSB7XG4gIHZhciBkeDAgPSB0cmFuc2Zvcm0uaW52ZXJ0WChleHRlbnRbMF1bMF0pIC0gdHJhbnNsYXRlRXh0ZW50WzBdWzBdLFxuICAgICAgZHgxID0gdHJhbnNmb3JtLmludmVydFgoZXh0ZW50WzFdWzBdKSAtIHRyYW5zbGF0ZUV4dGVudFsxXVswXSxcbiAgICAgIGR5MCA9IHRyYW5zZm9ybS5pbnZlcnRZKGV4dGVudFswXVsxXSkgLSB0cmFuc2xhdGVFeHRlbnRbMF1bMV0sXG4gICAgICBkeTEgPSB0cmFuc2Zvcm0uaW52ZXJ0WShleHRlbnRbMV1bMV0pIC0gdHJhbnNsYXRlRXh0ZW50WzFdWzFdO1xuICByZXR1cm4gdHJhbnNmb3JtLnRyYW5zbGF0ZShcbiAgICBkeDEgPiBkeDAgPyAoZHgwICsgZHgxKSAvIDIgOiBNYXRoLm1pbigwLCBkeDApIHx8IE1hdGgubWF4KDAsIGR4MSksXG4gICAgZHkxID4gZHkwID8gKGR5MCArIGR5MSkgLyAyIDogTWF0aC5taW4oMCwgZHkwKSB8fCBNYXRoLm1heCgwLCBkeTEpXG4gICk7XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKCkge1xuICB2YXIgZmlsdGVyID0gZGVmYXVsdEZpbHRlcixcbiAgICAgIGV4dGVudCA9IGRlZmF1bHRFeHRlbnQsXG4gICAgICBjb25zdHJhaW4gPSBkZWZhdWx0Q29uc3RyYWluLFxuICAgICAgd2hlZWxEZWx0YSA9IGRlZmF1bHRXaGVlbERlbHRhLFxuICAgICAgdG91Y2hhYmxlID0gZGVmYXVsdFRvdWNoYWJsZSxcbiAgICAgIHNjYWxlRXh0ZW50ID0gWzAsIEluZmluaXR5XSxcbiAgICAgIHRyYW5zbGF0ZUV4dGVudCA9IFtbLUluZmluaXR5LCAtSW5maW5pdHldLCBbSW5maW5pdHksIEluZmluaXR5XV0sXG4gICAgICBkdXJhdGlvbiA9IDI1MCxcbiAgICAgIGludGVycG9sYXRlID0gaW50ZXJwb2xhdGVab29tLFxuICAgICAgbGlzdGVuZXJzID0gZGlzcGF0Y2goXCJzdGFydFwiLCBcInpvb21cIiwgXCJlbmRcIiksXG4gICAgICB0b3VjaHN0YXJ0aW5nLFxuICAgICAgdG91Y2hmaXJzdCxcbiAgICAgIHRvdWNoZW5kaW5nLFxuICAgICAgdG91Y2hEZWxheSA9IDUwMCxcbiAgICAgIHdoZWVsRGVsYXkgPSAxNTAsXG4gICAgICBjbGlja0Rpc3RhbmNlMiA9IDAsXG4gICAgICB0YXBEaXN0YW5jZSA9IDEwO1xuXG4gIGZ1bmN0aW9uIHpvb20oc2VsZWN0aW9uKSB7XG4gICAgc2VsZWN0aW9uXG4gICAgICAgIC5wcm9wZXJ0eShcIl9fem9vbVwiLCBkZWZhdWx0VHJhbnNmb3JtKVxuICAgICAgICAub24oXCJ3aGVlbC56b29tXCIsIHdoZWVsZWQsIHtwYXNzaXZlOiBmYWxzZX0pXG4gICAgICAgIC5vbihcIm1vdXNlZG93bi56b29tXCIsIG1vdXNlZG93bmVkKVxuICAgICAgICAub24oXCJkYmxjbGljay56b29tXCIsIGRibGNsaWNrZWQpXG4gICAgICAuZmlsdGVyKHRvdWNoYWJsZSlcbiAgICAgICAgLm9uKFwidG91Y2hzdGFydC56b29tXCIsIHRvdWNoc3RhcnRlZClcbiAgICAgICAgLm9uKFwidG91Y2htb3ZlLnpvb21cIiwgdG91Y2htb3ZlZClcbiAgICAgICAgLm9uKFwidG91Y2hlbmQuem9vbSB0b3VjaGNhbmNlbC56b29tXCIsIHRvdWNoZW5kZWQpXG4gICAgICAgIC5zdHlsZShcIi13ZWJraXQtdGFwLWhpZ2hsaWdodC1jb2xvclwiLCBcInJnYmEoMCwwLDAsMClcIik7XG4gIH1cblxuICB6b29tLnRyYW5zZm9ybSA9IGZ1bmN0aW9uKGNvbGxlY3Rpb24sIHRyYW5zZm9ybSwgcG9pbnQsIGV2ZW50KSB7XG4gICAgdmFyIHNlbGVjdGlvbiA9IGNvbGxlY3Rpb24uc2VsZWN0aW9uID8gY29sbGVjdGlvbi5zZWxlY3Rpb24oKSA6IGNvbGxlY3Rpb247XG4gICAgc2VsZWN0aW9uLnByb3BlcnR5KFwiX196b29tXCIsIGRlZmF1bHRUcmFuc2Zvcm0pO1xuICAgIGlmIChjb2xsZWN0aW9uICE9PSBzZWxlY3Rpb24pIHtcbiAgICAgIHNjaGVkdWxlKGNvbGxlY3Rpb24sIHRyYW5zZm9ybSwgcG9pbnQsIGV2ZW50KTtcbiAgICB9IGVsc2Uge1xuICAgICAgc2VsZWN0aW9uLmludGVycnVwdCgpLmVhY2goZnVuY3Rpb24oKSB7XG4gICAgICAgIGdlc3R1cmUodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAgIC5ldmVudChldmVudClcbiAgICAgICAgICAuc3RhcnQoKVxuICAgICAgICAgIC56b29tKG51bGwsIHR5cGVvZiB0cmFuc2Zvcm0gPT09IFwiZnVuY3Rpb25cIiA/IHRyYW5zZm9ybS5hcHBseSh0aGlzLCBhcmd1bWVudHMpIDogdHJhbnNmb3JtKVxuICAgICAgICAgIC5lbmQoKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfTtcblxuICB6b29tLnNjYWxlQnkgPSBmdW5jdGlvbihzZWxlY3Rpb24sIGssIHAsIGV2ZW50KSB7XG4gICAgem9vbS5zY2FsZVRvKHNlbGVjdGlvbiwgZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgazAgPSB0aGlzLl9fem9vbS5rLFxuICAgICAgICAgIGsxID0gdHlwZW9mIGsgPT09IFwiZnVuY3Rpb25cIiA/IGsuYXBwbHkodGhpcywgYXJndW1lbnRzKSA6IGs7XG4gICAgICByZXR1cm4gazAgKiBrMTtcbiAgICB9LCBwLCBldmVudCk7XG4gIH07XG5cbiAgem9vbS5zY2FsZVRvID0gZnVuY3Rpb24oc2VsZWN0aW9uLCBrLCBwLCBldmVudCkge1xuICAgIHpvb20udHJhbnNmb3JtKHNlbGVjdGlvbiwgZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgZSA9IGV4dGVudC5hcHBseSh0aGlzLCBhcmd1bWVudHMpLFxuICAgICAgICAgIHQwID0gdGhpcy5fX3pvb20sXG4gICAgICAgICAgcDAgPSBwID09IG51bGwgPyBjZW50cm9pZChlKSA6IHR5cGVvZiBwID09PSBcImZ1bmN0aW9uXCIgPyBwLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgOiBwLFxuICAgICAgICAgIHAxID0gdDAuaW52ZXJ0KHAwKSxcbiAgICAgICAgICBrMSA9IHR5cGVvZiBrID09PSBcImZ1bmN0aW9uXCIgPyBrLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgOiBrO1xuICAgICAgcmV0dXJuIGNvbnN0cmFpbih0cmFuc2xhdGUoc2NhbGUodDAsIGsxKSwgcDAsIHAxKSwgZSwgdHJhbnNsYXRlRXh0ZW50KTtcbiAgICB9LCBwLCBldmVudCk7XG4gIH07XG5cbiAgem9vbS50cmFuc2xhdGVCeSA9IGZ1bmN0aW9uKHNlbGVjdGlvbiwgeCwgeSwgZXZlbnQpIHtcbiAgICB6b29tLnRyYW5zZm9ybShzZWxlY3Rpb24sIGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIGNvbnN0cmFpbih0aGlzLl9fem9vbS50cmFuc2xhdGUoXG4gICAgICAgIHR5cGVvZiB4ID09PSBcImZ1bmN0aW9uXCIgPyB4LmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgOiB4LFxuICAgICAgICB0eXBlb2YgeSA9PT0gXCJmdW5jdGlvblwiID8geS5hcHBseSh0aGlzLCBhcmd1bWVudHMpIDogeVxuICAgICAgKSwgZXh0ZW50LmFwcGx5KHRoaXMsIGFyZ3VtZW50cyksIHRyYW5zbGF0ZUV4dGVudCk7XG4gICAgfSwgbnVsbCwgZXZlbnQpO1xuICB9O1xuXG4gIHpvb20udHJhbnNsYXRlVG8gPSBmdW5jdGlvbihzZWxlY3Rpb24sIHgsIHksIHAsIGV2ZW50KSB7XG4gICAgem9vbS50cmFuc2Zvcm0oc2VsZWN0aW9uLCBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBlID0gZXh0ZW50LmFwcGx5KHRoaXMsIGFyZ3VtZW50cyksXG4gICAgICAgICAgdCA9IHRoaXMuX196b29tLFxuICAgICAgICAgIHAwID0gcCA9PSBudWxsID8gY2VudHJvaWQoZSkgOiB0eXBlb2YgcCA9PT0gXCJmdW5jdGlvblwiID8gcC5hcHBseSh0aGlzLCBhcmd1bWVudHMpIDogcDtcbiAgICAgIHJldHVybiBjb25zdHJhaW4oaWRlbnRpdHkudHJhbnNsYXRlKHAwWzBdLCBwMFsxXSkuc2NhbGUodC5rKS50cmFuc2xhdGUoXG4gICAgICAgIHR5cGVvZiB4ID09PSBcImZ1bmN0aW9uXCIgPyAteC5hcHBseSh0aGlzLCBhcmd1bWVudHMpIDogLXgsXG4gICAgICAgIHR5cGVvZiB5ID09PSBcImZ1bmN0aW9uXCIgPyAteS5hcHBseSh0aGlzLCBhcmd1bWVudHMpIDogLXlcbiAgICAgICksIGUsIHRyYW5zbGF0ZUV4dGVudCk7XG4gICAgfSwgcCwgZXZlbnQpO1xuICB9O1xuXG4gIGZ1bmN0aW9uIHNjYWxlKHRyYW5zZm9ybSwgaykge1xuICAgIGsgPSBNYXRoLm1heChzY2FsZUV4dGVudFswXSwgTWF0aC5taW4oc2NhbGVFeHRlbnRbMV0sIGspKTtcbiAgICByZXR1cm4gayA9PT0gdHJhbnNmb3JtLmsgPyB0cmFuc2Zvcm0gOiBuZXcgVHJhbnNmb3JtKGssIHRyYW5zZm9ybS54LCB0cmFuc2Zvcm0ueSk7XG4gIH1cblxuICBmdW5jdGlvbiB0cmFuc2xhdGUodHJhbnNmb3JtLCBwMCwgcDEpIHtcbiAgICB2YXIgeCA9IHAwWzBdIC0gcDFbMF0gKiB0cmFuc2Zvcm0uaywgeSA9IHAwWzFdIC0gcDFbMV0gKiB0cmFuc2Zvcm0uaztcbiAgICByZXR1cm4geCA9PT0gdHJhbnNmb3JtLnggJiYgeSA9PT0gdHJhbnNmb3JtLnkgPyB0cmFuc2Zvcm0gOiBuZXcgVHJhbnNmb3JtKHRyYW5zZm9ybS5rLCB4LCB5KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGNlbnRyb2lkKGV4dGVudCkge1xuICAgIHJldHVybiBbKCtleHRlbnRbMF1bMF0gKyArZXh0ZW50WzFdWzBdKSAvIDIsICgrZXh0ZW50WzBdWzFdICsgK2V4dGVudFsxXVsxXSkgLyAyXTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHNjaGVkdWxlKHRyYW5zaXRpb24sIHRyYW5zZm9ybSwgcG9pbnQsIGV2ZW50KSB7XG4gICAgdHJhbnNpdGlvblxuICAgICAgICAub24oXCJzdGFydC56b29tXCIsIGZ1bmN0aW9uKCkgeyBnZXN0dXJlKHRoaXMsIGFyZ3VtZW50cykuZXZlbnQoZXZlbnQpLnN0YXJ0KCk7IH0pXG4gICAgICAgIC5vbihcImludGVycnVwdC56b29tIGVuZC56b29tXCIsIGZ1bmN0aW9uKCkgeyBnZXN0dXJlKHRoaXMsIGFyZ3VtZW50cykuZXZlbnQoZXZlbnQpLmVuZCgpOyB9KVxuICAgICAgICAudHdlZW4oXCJ6b29tXCIsIGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHZhciB0aGF0ID0gdGhpcyxcbiAgICAgICAgICAgICAgYXJncyA9IGFyZ3VtZW50cyxcbiAgICAgICAgICAgICAgZyA9IGdlc3R1cmUodGhhdCwgYXJncykuZXZlbnQoZXZlbnQpLFxuICAgICAgICAgICAgICBlID0gZXh0ZW50LmFwcGx5KHRoYXQsIGFyZ3MpLFxuICAgICAgICAgICAgICBwID0gcG9pbnQgPT0gbnVsbCA/IGNlbnRyb2lkKGUpIDogdHlwZW9mIHBvaW50ID09PSBcImZ1bmN0aW9uXCIgPyBwb2ludC5hcHBseSh0aGF0LCBhcmdzKSA6IHBvaW50LFxuICAgICAgICAgICAgICB3ID0gTWF0aC5tYXgoZVsxXVswXSAtIGVbMF1bMF0sIGVbMV1bMV0gLSBlWzBdWzFdKSxcbiAgICAgICAgICAgICAgYSA9IHRoYXQuX196b29tLFxuICAgICAgICAgICAgICBiID0gdHlwZW9mIHRyYW5zZm9ybSA9PT0gXCJmdW5jdGlvblwiID8gdHJhbnNmb3JtLmFwcGx5KHRoYXQsIGFyZ3MpIDogdHJhbnNmb3JtLFxuICAgICAgICAgICAgICBpID0gaW50ZXJwb2xhdGUoYS5pbnZlcnQocCkuY29uY2F0KHcgLyBhLmspLCBiLmludmVydChwKS5jb25jYXQodyAvIGIuaykpO1xuICAgICAgICAgIHJldHVybiBmdW5jdGlvbih0KSB7XG4gICAgICAgICAgICBpZiAodCA9PT0gMSkgdCA9IGI7IC8vIEF2b2lkIHJvdW5kaW5nIGVycm9yIG9uIGVuZC5cbiAgICAgICAgICAgIGVsc2UgeyB2YXIgbCA9IGkodCksIGsgPSB3IC8gbFsyXTsgdCA9IG5ldyBUcmFuc2Zvcm0oaywgcFswXSAtIGxbMF0gKiBrLCBwWzFdIC0gbFsxXSAqIGspOyB9XG4gICAgICAgICAgICBnLnpvb20obnVsbCwgdCk7XG4gICAgICAgICAgfTtcbiAgICAgICAgfSk7XG4gIH1cblxuICBmdW5jdGlvbiBnZXN0dXJlKHRoYXQsIGFyZ3MsIGNsZWFuKSB7XG4gICAgcmV0dXJuICghY2xlYW4gJiYgdGhhdC5fX3pvb21pbmcpIHx8IG5ldyBHZXN0dXJlKHRoYXQsIGFyZ3MpO1xuICB9XG5cbiAgZnVuY3Rpb24gR2VzdHVyZSh0aGF0LCBhcmdzKSB7XG4gICAgdGhpcy50aGF0ID0gdGhhdDtcbiAgICB0aGlzLmFyZ3MgPSBhcmdzO1xuICAgIHRoaXMuYWN0aXZlID0gMDtcbiAgICB0aGlzLnNvdXJjZUV2ZW50ID0gbnVsbDtcbiAgICB0aGlzLmV4dGVudCA9IGV4dGVudC5hcHBseSh0aGF0LCBhcmdzKTtcbiAgICB0aGlzLnRhcHMgPSAwO1xuICB9XG5cbiAgR2VzdHVyZS5wcm90b3R5cGUgPSB7XG4gICAgZXZlbnQ6IGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICBpZiAoZXZlbnQpIHRoaXMuc291cmNlRXZlbnQgPSBldmVudDtcbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH0sXG4gICAgc3RhcnQ6IGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKCsrdGhpcy5hY3RpdmUgPT09IDEpIHtcbiAgICAgICAgdGhpcy50aGF0Ll9fem9vbWluZyA9IHRoaXM7XG4gICAgICAgIHRoaXMuZW1pdChcInN0YXJ0XCIpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfSxcbiAgICB6b29tOiBmdW5jdGlvbihrZXksIHRyYW5zZm9ybSkge1xuICAgICAgaWYgKHRoaXMubW91c2UgJiYga2V5ICE9PSBcIm1vdXNlXCIpIHRoaXMubW91c2VbMV0gPSB0cmFuc2Zvcm0uaW52ZXJ0KHRoaXMubW91c2VbMF0pO1xuICAgICAgaWYgKHRoaXMudG91Y2gwICYmIGtleSAhPT0gXCJ0b3VjaFwiKSB0aGlzLnRvdWNoMFsxXSA9IHRyYW5zZm9ybS5pbnZlcnQodGhpcy50b3VjaDBbMF0pO1xuICAgICAgaWYgKHRoaXMudG91Y2gxICYmIGtleSAhPT0gXCJ0b3VjaFwiKSB0aGlzLnRvdWNoMVsxXSA9IHRyYW5zZm9ybS5pbnZlcnQodGhpcy50b3VjaDFbMF0pO1xuICAgICAgdGhpcy50aGF0Ll9fem9vbSA9IHRyYW5zZm9ybTtcbiAgICAgIHRoaXMuZW1pdChcInpvb21cIik7XG4gICAgICByZXR1cm4gdGhpcztcbiAgICB9LFxuICAgIGVuZDogZnVuY3Rpb24oKSB7XG4gICAgICBpZiAoLS10aGlzLmFjdGl2ZSA9PT0gMCkge1xuICAgICAgICBkZWxldGUgdGhpcy50aGF0Ll9fem9vbWluZztcbiAgICAgICAgdGhpcy5lbWl0KFwiZW5kXCIpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfSxcbiAgICBlbWl0OiBmdW5jdGlvbih0eXBlKSB7XG4gICAgICB2YXIgZCA9IHNlbGVjdCh0aGlzLnRoYXQpLmRhdHVtKCk7XG4gICAgICBsaXN0ZW5lcnMuY2FsbChcbiAgICAgICAgdHlwZSxcbiAgICAgICAgdGhpcy50aGF0LFxuICAgICAgICBuZXcgWm9vbUV2ZW50KHR5cGUsIHtcbiAgICAgICAgICBzb3VyY2VFdmVudDogdGhpcy5zb3VyY2VFdmVudCxcbiAgICAgICAgICB0YXJnZXQ6IHpvb20sXG4gICAgICAgICAgdHlwZSxcbiAgICAgICAgICB0cmFuc2Zvcm06IHRoaXMudGhhdC5fX3pvb20sXG4gICAgICAgICAgZGlzcGF0Y2g6IGxpc3RlbmVyc1xuICAgICAgICB9KSxcbiAgICAgICAgZFxuICAgICAgKTtcbiAgICB9XG4gIH07XG5cbiAgZnVuY3Rpb24gd2hlZWxlZChldmVudCwgLi4uYXJncykge1xuICAgIGlmICghZmlsdGVyLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykpIHJldHVybjtcbiAgICB2YXIgZyA9IGdlc3R1cmUodGhpcywgYXJncykuZXZlbnQoZXZlbnQpLFxuICAgICAgICB0ID0gdGhpcy5fX3pvb20sXG4gICAgICAgIGsgPSBNYXRoLm1heChzY2FsZUV4dGVudFswXSwgTWF0aC5taW4oc2NhbGVFeHRlbnRbMV0sIHQuayAqIE1hdGgucG93KDIsIHdoZWVsRGVsdGEuYXBwbHkodGhpcywgYXJndW1lbnRzKSkpKSxcbiAgICAgICAgcCA9IHBvaW50ZXIoZXZlbnQpO1xuXG4gICAgLy8gSWYgdGhlIG1vdXNlIGlzIGluIHRoZSBzYW1lIGxvY2F0aW9uIGFzIGJlZm9yZSwgcmV1c2UgaXQuXG4gICAgLy8gSWYgdGhlcmUgd2VyZSByZWNlbnQgd2hlZWwgZXZlbnRzLCByZXNldCB0aGUgd2hlZWwgaWRsZSB0aW1lb3V0LlxuICAgIGlmIChnLndoZWVsKSB7XG4gICAgICBpZiAoZy5tb3VzZVswXVswXSAhPT0gcFswXSB8fCBnLm1vdXNlWzBdWzFdICE9PSBwWzFdKSB7XG4gICAgICAgIGcubW91c2VbMV0gPSB0LmludmVydChnLm1vdXNlWzBdID0gcCk7XG4gICAgICB9XG4gICAgICBjbGVhclRpbWVvdXQoZy53aGVlbCk7XG4gICAgfVxuXG4gICAgLy8gSWYgdGhpcyB3aGVlbCBldmVudCB3b25cdTIwMTl0IHRyaWdnZXIgYSB0cmFuc2Zvcm0gY2hhbmdlLCBpZ25vcmUgaXQuXG4gICAgZWxzZSBpZiAodC5rID09PSBrKSByZXR1cm47XG5cbiAgICAvLyBPdGhlcndpc2UsIGNhcHR1cmUgdGhlIG1vdXNlIHBvaW50IGFuZCBsb2NhdGlvbiBhdCB0aGUgc3RhcnQuXG4gICAgZWxzZSB7XG4gICAgICBnLm1vdXNlID0gW3AsIHQuaW52ZXJ0KHApXTtcbiAgICAgIGludGVycnVwdCh0aGlzKTtcbiAgICAgIGcuc3RhcnQoKTtcbiAgICB9XG5cbiAgICBub2V2ZW50KGV2ZW50KTtcbiAgICBnLndoZWVsID0gc2V0VGltZW91dCh3aGVlbGlkbGVkLCB3aGVlbERlbGF5KTtcbiAgICBnLnpvb20oXCJtb3VzZVwiLCBjb25zdHJhaW4odHJhbnNsYXRlKHNjYWxlKHQsIGspLCBnLm1vdXNlWzBdLCBnLm1vdXNlWzFdKSwgZy5leHRlbnQsIHRyYW5zbGF0ZUV4dGVudCkpO1xuXG4gICAgZnVuY3Rpb24gd2hlZWxpZGxlZCgpIHtcbiAgICAgIGcud2hlZWwgPSBudWxsO1xuICAgICAgZy5lbmQoKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBtb3VzZWRvd25lZChldmVudCwgLi4uYXJncykge1xuICAgIGlmICh0b3VjaGVuZGluZyB8fCAhZmlsdGVyLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykpIHJldHVybjtcbiAgICB2YXIgY3VycmVudFRhcmdldCA9IGV2ZW50LmN1cnJlbnRUYXJnZXQsXG4gICAgICAgIGcgPSBnZXN0dXJlKHRoaXMsIGFyZ3MsIHRydWUpLmV2ZW50KGV2ZW50KSxcbiAgICAgICAgdiA9IHNlbGVjdChldmVudC52aWV3KS5vbihcIm1vdXNlbW92ZS56b29tXCIsIG1vdXNlbW92ZWQsIHRydWUpLm9uKFwibW91c2V1cC56b29tXCIsIG1vdXNldXBwZWQsIHRydWUpLFxuICAgICAgICBwID0gcG9pbnRlcihldmVudCwgY3VycmVudFRhcmdldCksXG4gICAgICAgIHgwID0gZXZlbnQuY2xpZW50WCxcbiAgICAgICAgeTAgPSBldmVudC5jbGllbnRZO1xuXG4gICAgZHJhZ0Rpc2FibGUoZXZlbnQudmlldyk7XG4gICAgbm9wcm9wYWdhdGlvbihldmVudCk7XG4gICAgZy5tb3VzZSA9IFtwLCB0aGlzLl9fem9vbS5pbnZlcnQocCldO1xuICAgIGludGVycnVwdCh0aGlzKTtcbiAgICBnLnN0YXJ0KCk7XG5cbiAgICBmdW5jdGlvbiBtb3VzZW1vdmVkKGV2ZW50KSB7XG4gICAgICBub2V2ZW50KGV2ZW50KTtcbiAgICAgIGlmICghZy5tb3ZlZCkge1xuICAgICAgICB2YXIgZHggPSBldmVudC5jbGllbnRYIC0geDAsIGR5ID0gZXZlbnQuY2xpZW50WSAtIHkwO1xuICAgICAgICBnLm1vdmVkID0gZHggKiBkeCArIGR5ICogZHkgPiBjbGlja0Rpc3RhbmNlMjtcbiAgICAgIH1cbiAgICAgIGcuZXZlbnQoZXZlbnQpXG4gICAgICAgLnpvb20oXCJtb3VzZVwiLCBjb25zdHJhaW4odHJhbnNsYXRlKGcudGhhdC5fX3pvb20sIGcubW91c2VbMF0gPSBwb2ludGVyKGV2ZW50LCBjdXJyZW50VGFyZ2V0KSwgZy5tb3VzZVsxXSksIGcuZXh0ZW50LCB0cmFuc2xhdGVFeHRlbnQpKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBtb3VzZXVwcGVkKGV2ZW50KSB7XG4gICAgICB2Lm9uKFwibW91c2Vtb3ZlLnpvb20gbW91c2V1cC56b29tXCIsIG51bGwpO1xuICAgICAgZHJhZ0VuYWJsZShldmVudC52aWV3LCBnLm1vdmVkKTtcbiAgICAgIG5vZXZlbnQoZXZlbnQpO1xuICAgICAgZy5ldmVudChldmVudCkuZW5kKCk7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gZGJsY2xpY2tlZChldmVudCwgLi4uYXJncykge1xuICAgIGlmICghZmlsdGVyLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykpIHJldHVybjtcbiAgICB2YXIgdDAgPSB0aGlzLl9fem9vbSxcbiAgICAgICAgcDAgPSBwb2ludGVyKGV2ZW50LmNoYW5nZWRUb3VjaGVzID8gZXZlbnQuY2hhbmdlZFRvdWNoZXNbMF0gOiBldmVudCwgdGhpcyksXG4gICAgICAgIHAxID0gdDAuaW52ZXJ0KHAwKSxcbiAgICAgICAgazEgPSB0MC5rICogKGV2ZW50LnNoaWZ0S2V5ID8gMC41IDogMiksXG4gICAgICAgIHQxID0gY29uc3RyYWluKHRyYW5zbGF0ZShzY2FsZSh0MCwgazEpLCBwMCwgcDEpLCBleHRlbnQuYXBwbHkodGhpcywgYXJncyksIHRyYW5zbGF0ZUV4dGVudCk7XG5cbiAgICBub2V2ZW50KGV2ZW50KTtcbiAgICBpZiAoZHVyYXRpb24gPiAwKSBzZWxlY3QodGhpcykudHJhbnNpdGlvbigpLmR1cmF0aW9uKGR1cmF0aW9uKS5jYWxsKHNjaGVkdWxlLCB0MSwgcDAsIGV2ZW50KTtcbiAgICBlbHNlIHNlbGVjdCh0aGlzKS5jYWxsKHpvb20udHJhbnNmb3JtLCB0MSwgcDAsIGV2ZW50KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHRvdWNoc3RhcnRlZChldmVudCwgLi4uYXJncykge1xuICAgIGlmICghZmlsdGVyLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykpIHJldHVybjtcbiAgICB2YXIgdG91Y2hlcyA9IGV2ZW50LnRvdWNoZXMsXG4gICAgICAgIG4gPSB0b3VjaGVzLmxlbmd0aCxcbiAgICAgICAgZyA9IGdlc3R1cmUodGhpcywgYXJncywgZXZlbnQuY2hhbmdlZFRvdWNoZXMubGVuZ3RoID09PSBuKS5ldmVudChldmVudCksXG4gICAgICAgIHN0YXJ0ZWQsIGksIHQsIHA7XG5cbiAgICBub3Byb3BhZ2F0aW9uKGV2ZW50KTtcbiAgICBmb3IgKGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICB0ID0gdG91Y2hlc1tpXSwgcCA9IHBvaW50ZXIodCwgdGhpcyk7XG4gICAgICBwID0gW3AsIHRoaXMuX196b29tLmludmVydChwKSwgdC5pZGVudGlmaWVyXTtcbiAgICAgIGlmICghZy50b3VjaDApIGcudG91Y2gwID0gcCwgc3RhcnRlZCA9IHRydWUsIGcudGFwcyA9IDEgKyAhIXRvdWNoc3RhcnRpbmc7XG4gICAgICBlbHNlIGlmICghZy50b3VjaDEgJiYgZy50b3VjaDBbMl0gIT09IHBbMl0pIGcudG91Y2gxID0gcCwgZy50YXBzID0gMDtcbiAgICB9XG5cbiAgICBpZiAodG91Y2hzdGFydGluZykgdG91Y2hzdGFydGluZyA9IGNsZWFyVGltZW91dCh0b3VjaHN0YXJ0aW5nKTtcblxuICAgIGlmIChzdGFydGVkKSB7XG4gICAgICBpZiAoZy50YXBzIDwgMikgdG91Y2hmaXJzdCA9IHBbMF0sIHRvdWNoc3RhcnRpbmcgPSBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkgeyB0b3VjaHN0YXJ0aW5nID0gbnVsbDsgfSwgdG91Y2hEZWxheSk7XG4gICAgICBpbnRlcnJ1cHQodGhpcyk7XG4gICAgICBnLnN0YXJ0KCk7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gdG91Y2htb3ZlZChldmVudCwgLi4uYXJncykge1xuICAgIGlmICghdGhpcy5fX3pvb21pbmcpIHJldHVybjtcbiAgICB2YXIgZyA9IGdlc3R1cmUodGhpcywgYXJncykuZXZlbnQoZXZlbnQpLFxuICAgICAgICB0b3VjaGVzID0gZXZlbnQuY2hhbmdlZFRvdWNoZXMsXG4gICAgICAgIG4gPSB0b3VjaGVzLmxlbmd0aCwgaSwgdCwgcCwgbDtcblxuICAgIG5vZXZlbnQoZXZlbnQpO1xuICAgIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIHQgPSB0b3VjaGVzW2ldLCBwID0gcG9pbnRlcih0LCB0aGlzKTtcbiAgICAgIGlmIChnLnRvdWNoMCAmJiBnLnRvdWNoMFsyXSA9PT0gdC5pZGVudGlmaWVyKSBnLnRvdWNoMFswXSA9IHA7XG4gICAgICBlbHNlIGlmIChnLnRvdWNoMSAmJiBnLnRvdWNoMVsyXSA9PT0gdC5pZGVudGlmaWVyKSBnLnRvdWNoMVswXSA9IHA7XG4gICAgfVxuICAgIHQgPSBnLnRoYXQuX196b29tO1xuICAgIGlmIChnLnRvdWNoMSkge1xuICAgICAgdmFyIHAwID0gZy50b3VjaDBbMF0sIGwwID0gZy50b3VjaDBbMV0sXG4gICAgICAgICAgcDEgPSBnLnRvdWNoMVswXSwgbDEgPSBnLnRvdWNoMVsxXSxcbiAgICAgICAgICBkcCA9IChkcCA9IHAxWzBdIC0gcDBbMF0pICogZHAgKyAoZHAgPSBwMVsxXSAtIHAwWzFdKSAqIGRwLFxuICAgICAgICAgIGRsID0gKGRsID0gbDFbMF0gLSBsMFswXSkgKiBkbCArIChkbCA9IGwxWzFdIC0gbDBbMV0pICogZGw7XG4gICAgICB0ID0gc2NhbGUodCwgTWF0aC5zcXJ0KGRwIC8gZGwpKTtcbiAgICAgIHAgPSBbKHAwWzBdICsgcDFbMF0pIC8gMiwgKHAwWzFdICsgcDFbMV0pIC8gMl07XG4gICAgICBsID0gWyhsMFswXSArIGwxWzBdKSAvIDIsIChsMFsxXSArIGwxWzFdKSAvIDJdO1xuICAgIH1cbiAgICBlbHNlIGlmIChnLnRvdWNoMCkgcCA9IGcudG91Y2gwWzBdLCBsID0gZy50b3VjaDBbMV07XG4gICAgZWxzZSByZXR1cm47XG5cbiAgICBnLnpvb20oXCJ0b3VjaFwiLCBjb25zdHJhaW4odHJhbnNsYXRlKHQsIHAsIGwpLCBnLmV4dGVudCwgdHJhbnNsYXRlRXh0ZW50KSk7XG4gIH1cblxuICBmdW5jdGlvbiB0b3VjaGVuZGVkKGV2ZW50LCAuLi5hcmdzKSB7XG4gICAgaWYgKCF0aGlzLl9fem9vbWluZykgcmV0dXJuO1xuICAgIHZhciBnID0gZ2VzdHVyZSh0aGlzLCBhcmdzKS5ldmVudChldmVudCksXG4gICAgICAgIHRvdWNoZXMgPSBldmVudC5jaGFuZ2VkVG91Y2hlcyxcbiAgICAgICAgbiA9IHRvdWNoZXMubGVuZ3RoLCBpLCB0O1xuXG4gICAgbm9wcm9wYWdhdGlvbihldmVudCk7XG4gICAgaWYgKHRvdWNoZW5kaW5nKSBjbGVhclRpbWVvdXQodG91Y2hlbmRpbmcpO1xuICAgIHRvdWNoZW5kaW5nID0gc2V0VGltZW91dChmdW5jdGlvbigpIHsgdG91Y2hlbmRpbmcgPSBudWxsOyB9LCB0b3VjaERlbGF5KTtcbiAgICBmb3IgKGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICB0ID0gdG91Y2hlc1tpXTtcbiAgICAgIGlmIChnLnRvdWNoMCAmJiBnLnRvdWNoMFsyXSA9PT0gdC5pZGVudGlmaWVyKSBkZWxldGUgZy50b3VjaDA7XG4gICAgICBlbHNlIGlmIChnLnRvdWNoMSAmJiBnLnRvdWNoMVsyXSA9PT0gdC5pZGVudGlmaWVyKSBkZWxldGUgZy50b3VjaDE7XG4gICAgfVxuICAgIGlmIChnLnRvdWNoMSAmJiAhZy50b3VjaDApIGcudG91Y2gwID0gZy50b3VjaDEsIGRlbGV0ZSBnLnRvdWNoMTtcbiAgICBpZiAoZy50b3VjaDApIGcudG91Y2gwWzFdID0gdGhpcy5fX3pvb20uaW52ZXJ0KGcudG91Y2gwWzBdKTtcbiAgICBlbHNlIHtcbiAgICAgIGcuZW5kKCk7XG4gICAgICAvLyBJZiB0aGlzIHdhcyBhIGRibHRhcCwgcmVyb3V0ZSB0byB0aGUgKG9wdGlvbmFsKSBkYmxjbGljay56b29tIGhhbmRsZXIuXG4gICAgICBpZiAoZy50YXBzID09PSAyKSB7XG4gICAgICAgIHQgPSBwb2ludGVyKHQsIHRoaXMpO1xuICAgICAgICBpZiAoTWF0aC5oeXBvdCh0b3VjaGZpcnN0WzBdIC0gdFswXSwgdG91Y2hmaXJzdFsxXSAtIHRbMV0pIDwgdGFwRGlzdGFuY2UpIHtcbiAgICAgICAgICB2YXIgcCA9IHNlbGVjdCh0aGlzKS5vbihcImRibGNsaWNrLnpvb21cIik7XG4gICAgICAgICAgaWYgKHApIHAuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHpvb20ud2hlZWxEZWx0YSA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/ICh3aGVlbERlbHRhID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudCgrXyksIHpvb20pIDogd2hlZWxEZWx0YTtcbiAgfTtcblxuICB6b29tLmZpbHRlciA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChmaWx0ZXIgPSB0eXBlb2YgXyA9PT0gXCJmdW5jdGlvblwiID8gXyA6IGNvbnN0YW50KCEhXyksIHpvb20pIDogZmlsdGVyO1xuICB9O1xuXG4gIHpvb20udG91Y2hhYmxlID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHRvdWNoYWJsZSA9IHR5cGVvZiBfID09PSBcImZ1bmN0aW9uXCIgPyBfIDogY29uc3RhbnQoISFfKSwgem9vbSkgOiB0b3VjaGFibGU7XG4gIH07XG5cbiAgem9vbS5leHRlbnQgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoZXh0ZW50ID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudChbWytfWzBdWzBdLCArX1swXVsxXV0sIFsrX1sxXVswXSwgK19bMV1bMV1dXSksIHpvb20pIDogZXh0ZW50O1xuICB9O1xuXG4gIHpvb20uc2NhbGVFeHRlbnQgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoc2NhbGVFeHRlbnRbMF0gPSArX1swXSwgc2NhbGVFeHRlbnRbMV0gPSArX1sxXSwgem9vbSkgOiBbc2NhbGVFeHRlbnRbMF0sIHNjYWxlRXh0ZW50WzFdXTtcbiAgfTtcblxuICB6b29tLnRyYW5zbGF0ZUV4dGVudCA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/ICh0cmFuc2xhdGVFeHRlbnRbMF1bMF0gPSArX1swXVswXSwgdHJhbnNsYXRlRXh0ZW50WzFdWzBdID0gK19bMV1bMF0sIHRyYW5zbGF0ZUV4dGVudFswXVsxXSA9ICtfWzBdWzFdLCB0cmFuc2xhdGVFeHRlbnRbMV1bMV0gPSArX1sxXVsxXSwgem9vbSkgOiBbW3RyYW5zbGF0ZUV4dGVudFswXVswXSwgdHJhbnNsYXRlRXh0ZW50WzBdWzFdXSwgW3RyYW5zbGF0ZUV4dGVudFsxXVswXSwgdHJhbnNsYXRlRXh0ZW50WzFdWzFdXV07XG4gIH07XG5cbiAgem9vbS5jb25zdHJhaW4gPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoY29uc3RyYWluID0gXywgem9vbSkgOiBjb25zdHJhaW47XG4gIH07XG5cbiAgem9vbS5kdXJhdGlvbiA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChkdXJhdGlvbiA9ICtfLCB6b29tKSA6IGR1cmF0aW9uO1xuICB9O1xuXG4gIHpvb20uaW50ZXJwb2xhdGUgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoaW50ZXJwb2xhdGUgPSBfLCB6b29tKSA6IGludGVycG9sYXRlO1xuICB9O1xuXG4gIHpvb20ub24gPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgdmFsdWUgPSBsaXN0ZW5lcnMub24uYXBwbHkobGlzdGVuZXJzLCBhcmd1bWVudHMpO1xuICAgIHJldHVybiB2YWx1ZSA9PT0gbGlzdGVuZXJzID8gem9vbSA6IHZhbHVlO1xuICB9O1xuXG4gIHpvb20uY2xpY2tEaXN0YW5jZSA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChjbGlja0Rpc3RhbmNlMiA9IChfID0gK18pICogXywgem9vbSkgOiBNYXRoLnNxcnQoY2xpY2tEaXN0YW5jZTIpO1xuICB9O1xuXG4gIHpvb20udGFwRGlzdGFuY2UgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAodGFwRGlzdGFuY2UgPSArXywgem9vbSkgOiB0YXBEaXN0YW5jZTtcbiAgfTtcblxuICByZXR1cm4gem9vbTtcbn1cbiIsICJpbXBvcnQgeyBBcHAsIFBsdWdpblNldHRpbmdUYWIsIFNldHRpbmcgfSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB0eXBlIE9iamVjdExpbmtzUGx1Z2luIGZyb20gXCIuL21haW5cIjtcblxuLyoqXG4gKiBQZXJzaXN0ZW50IHBsdWdpbiBzZXR0aW5ncyAoc2F2ZWQgdG8gZGF0YS5qc29uKS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBPYmplY3RMaW5rc1NldHRpbmdzIHtcbiAgLyoqXG4gICAqIEZyb250bWF0dGVyIHRhZyB1c2VkIHRvIGlkZW50aWZ5IG9iamVjdCBmaWxlcy5cbiAgICogT25seSBtYXJrZG93biBmaWxlcyB3aG9zZSBmcm9udG1hdHRlciBjb250YWlucyB0aGlzIHRhZyB3aWxsIGJlIHBhcnNlZC5cbiAgICogRXhhbXBsZTogaWYgc2V0IHRvIFwib2JqZWN0LWZpbGVcIiwgYSBmaWxlIG5lZWRzIGB0YWdzOiBbb2JqZWN0LWZpbGVdYCBpblxuICAgKiBpdHMgWUFNTCBmcm9udG1hdHRlciB0byBiZSByZWNvZ25pc2VkIGJ5IHRoZSBwbHVnaW4uXG4gICAqL1xuICBvYmplY3RGaWxlVGFnOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjb25zdCBERUZBVUxUX1NFVFRJTkdTOiBPYmplY3RMaW5rc1NldHRpbmdzID0ge1xuICBvYmplY3RGaWxlVGFnOiBcIm9iamVjdC1saW5rc1wiLFxufTtcblxuLyoqXG4gKiBQbHVnaW4gc2V0dGluZ3MgdGFiIHNob3duIGluIE9ic2lkaWFuJ3Mgc2V0dGluZ3MgcGFuZWwuXG4gKi9cbmV4cG9ydCBjbGFzcyBPYmplY3RMaW5rc1NldHRpbmdUYWIgZXh0ZW5kcyBQbHVnaW5TZXR0aW5nVGFiIHtcbiAgcGx1Z2luOiBPYmplY3RMaW5rc1BsdWdpbjtcblxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgcGx1Z2luOiBPYmplY3RMaW5rc1BsdWdpbikge1xuICAgIHN1cGVyKGFwcCwgcGx1Z2luKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgfVxuXG4gIGRpc3BsYXkoKTogdm9pZCB7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcbiAgICBjb250YWluZXJFbC5lbXB0eSgpO1xuXG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwiT2JqZWN0IExpbmtzXCIgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiT2JqZWN0IGZpbGUgdGFnXCIpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgXCJUYWcgdXNlZCB0byBpZGVudGlmeSBvYmplY3QgZmlsZXMuIFwiICtcbiAgICAgICAgXCJPbmx5IG1hcmtkb3duIGZpbGVzIHRoYXQgaW5jbHVkZSB0aGlzIHRhZyB3aWxsIGJlIHBhcnNlZC4gXCIgK1xuICAgICAgICBcIlN1cHBvcnRzIGJhcmUgI3RhZ3MgKGUuZy4gI29iamVjdC1saW5rcyBvbiBhbnkgbGluZSkgXCIgK1xuICAgICAgICBcImFuZCBZQU1MIGZyb250bWF0dGVyIHRhZ3MgKGUuZy4gdGFnczogW29iamVjdC1saW5rc10pLlwiXG4gICAgICApXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dFxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihcIm9iamVjdC1saW5rc1wiKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5vYmplY3RGaWxlVGFnKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm9iamVjdEZpbGVUYWcgPSB2YWx1ZS50cmltKCk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KVxuICAgICAgKTtcbiAgfVxufVxuXG4vKipcbiAqIEdyYXBoIGNvbmZpZ3VyYXRpb24gcGFuZWwgLS0gcmVuZGVyZWQgaW5zaWRlIHRoZSBncmFwaCB2aWV3LlxuICogTWlycm9ycyB0aGUgc3R5bGUgYW5kIGxheW91dCBvZiBPYnNpZGlhbidzIG5hdGl2ZSBncmFwaCBjb250cm9scy5cbiAqL1xuXG5leHBvcnQgaW50ZXJmYWNlIEdyYXBoQ29uZmlnIHtcbiAgc2VhcmNoOiBzdHJpbmc7XG4gIHNob3dPcnBoYW5zOiBib29sZWFuO1xuICBzaG93RmlsZXM6IGJvb2xlYW47XG4gIHNob3dPYmplY3RzOiBib29sZWFuO1xuICBzaG93V2lraUVkZ2VzOiBib29sZWFuO1xuICBzaG93T2JqZWN0RWRnZXM6IGJvb2xlYW47XG4gIHBhdGhGaWx0ZXI6IHN0cmluZztcbiAgc291cmNlRmlsdGVyOiBzdHJpbmc7XG4gIC8vIERpc3BsYXlcbiAgbm9kZVNpemVNdWx0aXBsaWVyOiBudW1iZXI7XG4gIGxpbmtEaXN0YW5jZTogbnVtYmVyO1xuICBjZW50ZXJTdHJlbmd0aDogbnVtYmVyO1xuICByZXBlbFN0cmVuZ3RoOiBudW1iZXI7XG4gIGxhYmVsT3BhY2l0eTogbnVtYmVyO1xufVxuXG5leHBvcnQgY29uc3QgREVGQVVMVF9DT05GSUc6IEdyYXBoQ29uZmlnID0ge1xuICBzZWFyY2g6IFwiXCIsXG4gIHNob3dPcnBoYW5zOiBmYWxzZSxcbiAgc2hvd0ZpbGVzOiB0cnVlLFxuICBzaG93T2JqZWN0czogdHJ1ZSxcbiAgc2hvd1dpa2lFZGdlczogdHJ1ZSxcbiAgc2hvd09iamVjdEVkZ2VzOiB0cnVlLFxuICBwYXRoRmlsdGVyOiBcIlwiLFxuICBzb3VyY2VGaWx0ZXI6IFwiXCIsXG4gIG5vZGVTaXplTXVsdGlwbGllcjogMSxcbiAgbGlua0Rpc3RhbmNlOiAxNTAsXG4gIGNlbnRlclN0cmVuZ3RoOiAwLjA0LFxuICByZXBlbFN0cmVuZ3RoOiA0MDAsXG4gIGxhYmVsT3BhY2l0eTogMC42NSxcbn07XG5cbmV4cG9ydCB0eXBlIENvbmZpZ0NoYW5nZUNhbGxiYWNrID0gKGNvbmZpZzogR3JhcGhDb25maWcpID0+IHZvaWQ7XG5cbmV4cG9ydCBjbGFzcyBDb25maWdQYW5lbCB7XG4gIHByaXZhdGUgY29udGFpbmVyRWw6IEhUTUxFbGVtZW50O1xuICBwcml2YXRlIGNvbmZpZzogR3JhcGhDb25maWc7XG4gIHByaXZhdGUgb25DaGFuZ2U6IENvbmZpZ0NoYW5nZUNhbGxiYWNrO1xuICBwcml2YXRlIGNvbGxhcHNlZDogUmVjb3JkPHN0cmluZywgYm9vbGVhbj4gPSB7XG4gICAgZmlsdGVyOiBmYWxzZSxcbiAgICBkaXNwbGF5OiB0cnVlLFxuICB9O1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHBhcmVudDogSFRNTEVsZW1lbnQsXG4gICAgY29uZmlnOiBHcmFwaENvbmZpZyxcbiAgICBvbkNoYW5nZTogQ29uZmlnQ2hhbmdlQ2FsbGJhY2tcbiAgKSB7XG4gICAgdGhpcy5jb25maWcgPSB7IC4uLmNvbmZpZyB9O1xuICAgIHRoaXMub25DaGFuZ2UgPSBvbkNoYW5nZTtcblxuICAgIHRoaXMuY29udGFpbmVyRWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHRoaXMuY29udGFpbmVyRWwuY2xhc3NOYW1lID0gXCJvbC1jb25maWctcGFuZWxcIjtcbiAgICBwYXJlbnQuYXBwZW5kQ2hpbGQodGhpcy5jb250YWluZXJFbCk7XG5cbiAgICB0aGlzLnJlbmRlcigpO1xuICB9XG5cbiAgZ2V0Q29uZmlnKCk6IEdyYXBoQ29uZmlnIHtcbiAgICByZXR1cm4geyAuLi50aGlzLmNvbmZpZyB9O1xuICB9XG5cbiAgZGVzdHJveSgpOiB2b2lkIHtcbiAgICB0aGlzLmNvbnRhaW5lckVsLnJlbW92ZSgpO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXIoKTogdm9pZCB7XG4gICAgdGhpcy5jb250YWluZXJFbC5lbXB0eSgpO1xuXG4gICAgLy8gXHUyNTAwXHUyNTAwIEZpbHRlciBzZWN0aW9uIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuICAgIHRoaXMucmVuZGVyU2VjdGlvbihcImZpbHRlclwiLCBcIkZpbHRlcnNcIiwgKCkgPT4ge1xuICAgICAgLy8gU2VhcmNoXG4gICAgICB0aGlzLnJlbmRlclRleHRJbnB1dChcIlNlYXJjaFwiLCB0aGlzLmNvbmZpZy5zZWFyY2gsICh2KSA9PiB7XG4gICAgICAgIHRoaXMuY29uZmlnLnNlYXJjaCA9IHY7XG4gICAgICAgIHRoaXMuZW1pdCgpO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIFBhdGggZmlsdGVyXG4gICAgICB0aGlzLnJlbmRlclRleHRJbnB1dChcIlBhdGggZmlsdGVyXCIsIHRoaXMuY29uZmlnLnBhdGhGaWx0ZXIsICh2KSA9PiB7XG4gICAgICAgIHRoaXMuY29uZmlnLnBhdGhGaWx0ZXIgPSB2O1xuICAgICAgICB0aGlzLmVtaXQoKTtcbiAgICAgIH0sIFwiZS5nLiAwMCBEYWlseVwiKTtcblxuICAgICAgLy8gU291cmNlIGZpbHRlclxuICAgICAgdGhpcy5yZW5kZXJUZXh0SW5wdXQoXCJTb3VyY2UgZmlsdGVyXCIsIHRoaXMuY29uZmlnLnNvdXJjZUZpbHRlciwgKHYpID0+IHtcbiAgICAgICAgdGhpcy5jb25maWcuc291cmNlRmlsdGVyID0gdjtcbiAgICAgICAgdGhpcy5lbWl0KCk7XG4gICAgICB9LCBcImUuZy4gRmlsbXNcIik7XG5cbiAgICAgIC8vIFRvZ2dsZXNcbiAgICAgIHRoaXMucmVuZGVyVG9nZ2xlKFwiU2hvdyBmaWxlc1wiLCB0aGlzLmNvbmZpZy5zaG93RmlsZXMsICh2KSA9PiB7XG4gICAgICAgIHRoaXMuY29uZmlnLnNob3dGaWxlcyA9IHY7XG4gICAgICAgIHRoaXMuZW1pdCgpO1xuICAgICAgfSk7XG5cbiAgICAgIHRoaXMucmVuZGVyVG9nZ2xlKFwiU2hvdyBvYmplY3RzXCIsIHRoaXMuY29uZmlnLnNob3dPYmplY3RzLCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5zaG93T2JqZWN0cyA9IHY7XG4gICAgICAgIHRoaXMuZW1pdCgpO1xuICAgICAgfSk7XG5cbiAgICAgIHRoaXMucmVuZGVyVG9nZ2xlKFwiU2hvdyBvcnBoYW5zXCIsIHRoaXMuY29uZmlnLnNob3dPcnBoYW5zLCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5zaG93T3JwaGFucyA9IHY7XG4gICAgICAgIHRoaXMuZW1pdCgpO1xuICAgICAgfSk7XG5cbiAgICAgIHRoaXMucmVuZGVyVG9nZ2xlKFwiV2lraSBsaW5rc1wiLCB0aGlzLmNvbmZpZy5zaG93V2lraUVkZ2VzLCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5zaG93V2lraUVkZ2VzID0gdjtcbiAgICAgICAgdGhpcy5lbWl0KCk7XG4gICAgICB9KTtcblxuICAgICAgdGhpcy5yZW5kZXJUb2dnbGUoXCJPYmplY3QgbGlua3NcIiwgdGhpcy5jb25maWcuc2hvd09iamVjdEVkZ2VzLCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5zaG93T2JqZWN0RWRnZXMgPSB2O1xuICAgICAgICB0aGlzLmVtaXQoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gXHUyNTAwXHUyNTAwIERpc3BsYXkgc2VjdGlvbiBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcbiAgICB0aGlzLnJlbmRlclNlY3Rpb24oXCJkaXNwbGF5XCIsIFwiRGlzcGxheVwiLCAoKSA9PiB7XG4gICAgICB0aGlzLnJlbmRlclNsaWRlcihcIk5vZGUgc2l6ZVwiLCB0aGlzLmNvbmZpZy5ub2RlU2l6ZU11bHRpcGxpZXIsIDAuMiwgMywgMC4xLCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5ub2RlU2l6ZU11bHRpcGxpZXIgPSB2O1xuICAgICAgICB0aGlzLmVtaXQoKTtcbiAgICAgIH0pO1xuXG4gICAgICB0aGlzLnJlbmRlclNsaWRlcihcIkxpbmsgZGlzdGFuY2VcIiwgdGhpcy5jb25maWcubGlua0Rpc3RhbmNlLCAzMCwgNTAwLCAxMCwgKHYpID0+IHtcbiAgICAgICAgdGhpcy5jb25maWcubGlua0Rpc3RhbmNlID0gdjtcbiAgICAgICAgdGhpcy5lbWl0KCk7XG4gICAgICB9KTtcblxuICAgICAgdGhpcy5yZW5kZXJTbGlkZXIoXCJDZW50ZXIgZm9yY2VcIiwgdGhpcy5jb25maWcuY2VudGVyU3RyZW5ndGgsIDAsIDAuMiwgMC4wMDUsICh2KSA9PiB7XG4gICAgICAgIHRoaXMuY29uZmlnLmNlbnRlclN0cmVuZ3RoID0gdjtcbiAgICAgICAgdGhpcy5lbWl0KCk7XG4gICAgICB9KTtcblxuICAgICAgdGhpcy5yZW5kZXJTbGlkZXIoXCJSZXBlbCBmb3JjZVwiLCB0aGlzLmNvbmZpZy5yZXBlbFN0cmVuZ3RoLCA1MCwgMTAwMCwgMjUsICh2KSA9PiB7XG4gICAgICAgIHRoaXMuY29uZmlnLnJlcGVsU3RyZW5ndGggPSB2O1xuICAgICAgICB0aGlzLmVtaXQoKTtcbiAgICAgIH0pO1xuXG4gICAgICB0aGlzLnJlbmRlclNsaWRlcihcIkxhYmVsIG9wYWNpdHlcIiwgdGhpcy5jb25maWcubGFiZWxPcGFjaXR5LCAwLCAxLCAwLjA1LCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5sYWJlbE9wYWNpdHkgPSB2O1xuICAgICAgICB0aGlzLmVtaXQoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJTZWN0aW9uKFxuICAgIGtleTogc3RyaW5nLFxuICAgIHRpdGxlOiBzdHJpbmcsXG4gICAgY29udGVudEZuOiAoKSA9PiB2b2lkXG4gICk6IHZvaWQge1xuICAgIGNvbnN0IHNlY3Rpb24gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHNlY3Rpb24uY2xhc3NOYW1lID0gXCJvbC1jb25maWctc2VjdGlvblwiO1xuXG4gICAgY29uc3QgaGVhZGVyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICBoZWFkZXIuY2xhc3NOYW1lID0gXCJvbC1jb25maWctc2VjdGlvbi1oZWFkZXJcIjtcbiAgICBoZWFkZXIuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgIHRoaXMuY29sbGFwc2VkW2tleV0gPSAhdGhpcy5jb2xsYXBzZWRba2V5XTtcbiAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgfSk7XG5cbiAgICBjb25zdCBhcnJvdyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgIGFycm93LmNsYXNzTmFtZSA9IFwib2wtY29uZmlnLWFycm93XCI7XG4gICAgYXJyb3cudGV4dENvbnRlbnQgPSB0aGlzLmNvbGxhcHNlZFtrZXldID8gXCJcXHUyNUI2XCIgOiBcIlxcdTI1QkNcIjtcbiAgICBoZWFkZXIuYXBwZW5kQ2hpbGQoYXJyb3cpO1xuXG4gICAgY29uc3QgdGl0bGVFbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgIHRpdGxlRWwudGV4dENvbnRlbnQgPSB0aXRsZTtcbiAgICBoZWFkZXIuYXBwZW5kQ2hpbGQodGl0bGVFbCk7XG5cbiAgICBzZWN0aW9uLmFwcGVuZENoaWxkKGhlYWRlcik7XG5cbiAgICBpZiAoIXRoaXMuY29sbGFwc2VkW2tleV0pIHtcbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgY29udGVudC5jbGFzc05hbWUgPSBcIm9sLWNvbmZpZy1zZWN0aW9uLWNvbnRlbnRcIjtcbiAgICAgIHNlY3Rpb24uYXBwZW5kQ2hpbGQoY29udGVudCk7XG5cbiAgICAgIC8vIFRlbXBvcmFyaWx5IHNldCBjb250YWluZXJFbCB0byBjb250ZW50IGZvciBoZWxwZXJzXG4gICAgICBjb25zdCBzYXZlZENvbnRhaW5lciA9IHRoaXMuY29udGFpbmVyRWw7XG4gICAgICB0aGlzLmNvbnRhaW5lckVsID0gY29udGVudDtcbiAgICAgIGNvbnRlbnRGbigpO1xuICAgICAgdGhpcy5jb250YWluZXJFbCA9IHNhdmVkQ29udGFpbmVyO1xuICAgIH1cblxuICAgIC8vIEFwcGVuZCB0byB0aGUgcmVhbCBjb250YWluZXIgKHRoZSBwYW5lbClcbiAgICAvLyBXZSBuZWVkIHRvIHVzZSB0aGUgYWN0dWFsIHBhbmVsIGVsZW1lbnRcbiAgICBjb25zdCBwYW5lbCA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoXCIub2wtY29uZmlnLXBhbmVsXCIpO1xuICAgIGlmIChwYW5lbCkge1xuICAgICAgcGFuZWwuYXBwZW5kQ2hpbGQoc2VjdGlvbik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJUZXh0SW5wdXQoXG4gICAgbGFiZWw6IHN0cmluZyxcbiAgICB2YWx1ZTogc3RyaW5nLFxuICAgIG9uQ2hhbmdlOiAodjogc3RyaW5nKSA9PiB2b2lkLFxuICAgIHBsYWNlaG9sZGVyPzogc3RyaW5nXG4gICk6IHZvaWQge1xuICAgIGNvbnN0IHJvdyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgcm93LmNsYXNzTmFtZSA9IFwib2wtY29uZmlnLXJvd1wiO1xuXG4gICAgY29uc3QgaW5wdXQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiaW5wdXRcIik7XG4gICAgaW5wdXQudHlwZSA9IFwidGV4dFwiO1xuICAgIGlucHV0LmNsYXNzTmFtZSA9IFwib2wtY29uZmlnLWlucHV0XCI7XG4gICAgaW5wdXQucGxhY2Vob2xkZXIgPSBwbGFjZWhvbGRlciB8fCBsYWJlbDtcbiAgICBpbnB1dC52YWx1ZSA9IHZhbHVlO1xuICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJpbnB1dFwiLCAoKSA9PiBvbkNoYW5nZShpbnB1dC52YWx1ZSkpO1xuXG4gICAgcm93LmFwcGVuZENoaWxkKGlucHV0KTtcbiAgICB0aGlzLmNvbnRhaW5lckVsLmFwcGVuZENoaWxkKHJvdyk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlclRvZ2dsZShcbiAgICBsYWJlbDogc3RyaW5nLFxuICAgIHZhbHVlOiBib29sZWFuLFxuICAgIG9uQ2hhbmdlOiAodjogYm9vbGVhbikgPT4gdm9pZFxuICApOiB2b2lkIHtcbiAgICBjb25zdCByb3cgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHJvdy5jbGFzc05hbWUgPSBcIm9sLWNvbmZpZy1yb3cgb2wtY29uZmlnLXRvZ2dsZS1yb3dcIjtcblxuICAgIGNvbnN0IGxhYmVsRWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcbiAgICBsYWJlbEVsLmNsYXNzTmFtZSA9IFwib2wtY29uZmlnLWxhYmVsXCI7XG4gICAgbGFiZWxFbC50ZXh0Q29udGVudCA9IGxhYmVsO1xuICAgIHJvdy5hcHBlbmRDaGlsZChsYWJlbEVsKTtcblxuICAgIGNvbnN0IHRvZ2dsZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgdG9nZ2xlLmNsYXNzTmFtZSA9IGBvbC1jb25maWctdG9nZ2xlICR7dmFsdWUgPyBcImlzLWVuYWJsZWRcIiA6IFwiXCJ9YDtcbiAgICB0b2dnbGUuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IG5ld1ZhbCA9ICF2YWx1ZTtcbiAgICAgIG9uQ2hhbmdlKG5ld1ZhbCk7XG4gICAgfSk7XG5cbiAgICBjb25zdCBrbm9iID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICBrbm9iLmNsYXNzTmFtZSA9IFwib2wtY29uZmlnLXRvZ2dsZS1rbm9iXCI7XG4gICAgdG9nZ2xlLmFwcGVuZENoaWxkKGtub2IpO1xuXG4gICAgcm93LmFwcGVuZENoaWxkKHRvZ2dsZSk7XG4gICAgdGhpcy5jb250YWluZXJFbC5hcHBlbmRDaGlsZChyb3cpO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJTbGlkZXIoXG4gICAgbGFiZWw6IHN0cmluZyxcbiAgICB2YWx1ZTogbnVtYmVyLFxuICAgIG1pbjogbnVtYmVyLFxuICAgIG1heDogbnVtYmVyLFxuICAgIHN0ZXA6IG51bWJlcixcbiAgICBvbkNoYW5nZTogKHY6IG51bWJlcikgPT4gdm9pZFxuICApOiB2b2lkIHtcbiAgICBjb25zdCByb3cgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHJvdy5jbGFzc05hbWUgPSBcIm9sLWNvbmZpZy1yb3cgb2wtY29uZmlnLXNsaWRlci1yb3dcIjtcblxuICAgIGNvbnN0IGxhYmVsRWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcbiAgICBsYWJlbEVsLmNsYXNzTmFtZSA9IFwib2wtY29uZmlnLWxhYmVsXCI7XG4gICAgbGFiZWxFbC50ZXh0Q29udGVudCA9IGxhYmVsO1xuICAgIHJvdy5hcHBlbmRDaGlsZChsYWJlbEVsKTtcblxuICAgIGNvbnN0IHNsaWRlciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJpbnB1dFwiKTtcbiAgICBzbGlkZXIudHlwZSA9IFwicmFuZ2VcIjtcbiAgICBzbGlkZXIuY2xhc3NOYW1lID0gXCJvbC1jb25maWctc2xpZGVyXCI7XG4gICAgc2xpZGVyLm1pbiA9IFN0cmluZyhtaW4pO1xuICAgIHNsaWRlci5tYXggPSBTdHJpbmcobWF4KTtcbiAgICBzbGlkZXIuc3RlcCA9IFN0cmluZyhzdGVwKTtcbiAgICBzbGlkZXIudmFsdWUgPSBTdHJpbmcodmFsdWUpO1xuICAgIHNsaWRlci5hZGRFdmVudExpc3RlbmVyKFwiaW5wdXRcIiwgKCkgPT4ge1xuICAgICAgb25DaGFuZ2UocGFyc2VGbG9hdChzbGlkZXIudmFsdWUpKTtcbiAgICB9KTtcblxuICAgIHJvdy5hcHBlbmRDaGlsZChzbGlkZXIpO1xuICAgIHRoaXMuY29udGFpbmVyRWwuYXBwZW5kQ2hpbGQocm93KTtcbiAgfVxuXG4gIHByaXZhdGUgZW1pdCgpOiB2b2lkIHtcbiAgICB0aGlzLm9uQ2hhbmdlKHsgLi4udGhpcy5jb25maWcgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQge1xuICBFZGl0b3IsXG4gIEVkaXRvclBvc2l0aW9uLFxuICBFZGl0b3JTdWdnZXN0LFxuICBFZGl0b3JTdWdnZXN0Q29udGV4dCxcbiAgRWRpdG9yU3VnZ2VzdFRyaWdnZXJJbmZvLFxuICBURmlsZSxcbn0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgeyBQYXJzZWRPYmplY3QgfSBmcm9tIFwiLi9wYXJzZXJcIjtcblxuZXhwb3J0IGludGVyZmFjZSBPYmplY3RTdWdnZXN0aW9uIHtcbiAgLyoqIFRoZSBkaXNhbWJpZ3VhdGVkIGtleSB1c2VkIGZvciB7e319IGxpbmtzICovXG4gIGRpc3BsYXlLZXk6IHN0cmluZztcbiAgLyoqIFRoZSBvcmlnaW5hbCBrZXkgdmFsdWUgKGZvciBkaXNwbGF5L3NlYXJjaCkgKi9cbiAga2V5VmFsdWU6IHN0cmluZztcbiAgZmlsZUxhYmVsOiBzdHJpbmc7XG4gIGZpbGVQYXRoOiBzdHJpbmc7XG4gIHByb3BlcnRpZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG59XG5cbmV4cG9ydCBjbGFzcyBPYmplY3RMaW5rU3VnZ2VzdCBleHRlbmRzIEVkaXRvclN1Z2dlc3Q8T2JqZWN0U3VnZ2VzdGlvbj4ge1xuICBwcml2YXRlIG9iamVjdHM6IE9iamVjdFN1Z2dlc3Rpb25bXSA9IFtdO1xuXG4gIHNldE9iamVjdHMob2JqZWN0czogUGFyc2VkT2JqZWN0W10pOiB2b2lkIHtcbiAgICB0aGlzLm9iamVjdHMgPSBvYmplY3RzLm1hcCgobykgPT4gKHtcbiAgICAgIGRpc3BsYXlLZXk6IG8uZGlzcGxheUtleSxcbiAgICAgIGtleVZhbHVlOiBvLmtleVZhbHVlLFxuICAgICAgZmlsZUxhYmVsOiBvLmZpbGVMYWJlbCxcbiAgICAgIGZpbGVQYXRoOiBvLmZpbGVQYXRoLFxuICAgICAgcHJvcGVydGllczogby5wcm9wZXJ0aWVzLFxuICAgIH0pKTtcbiAgfVxuXG4gIG9uVHJpZ2dlcihcbiAgICBjdXJzb3I6IEVkaXRvclBvc2l0aW9uLFxuICAgIGVkaXRvcjogRWRpdG9yLFxuICAgIF9maWxlOiBURmlsZSB8IG51bGxcbiAgKTogRWRpdG9yU3VnZ2VzdFRyaWdnZXJJbmZvIHwgbnVsbCB7XG4gICAgY29uc3QgbGluZSA9IGVkaXRvci5nZXRMaW5lKGN1cnNvci5saW5lKTtcbiAgICBjb25zdCBzdWIgPSBsaW5lLnN1YnN0cmluZygwLCBjdXJzb3IuY2gpO1xuXG4gICAgLy8gRmluZCB0aGUgbGFzdCB7eyB0aGF0IGlzbid0IGNsb3NlZFxuICAgIGNvbnN0IGxhc3RPcGVuID0gc3ViLmxhc3RJbmRleE9mKFwie3tcIik7XG4gICAgaWYgKGxhc3RPcGVuID09PSAtMSkgcmV0dXJuIG51bGw7XG5cbiAgICAvLyBDaGVjayBpdCdzIG5vdCBhbHJlYWR5IGNsb3NlZFxuICAgIGNvbnN0IGFmdGVyT3BlbiA9IHN1Yi5zdWJzdHJpbmcobGFzdE9wZW4gKyAyKTtcbiAgICBpZiAoYWZ0ZXJPcGVuLmluY2x1ZGVzKFwifX1cIikpIHJldHVybiBudWxsO1xuXG4gICAgY29uc3QgcXVlcnkgPSBhZnRlck9wZW47XG5cbiAgICByZXR1cm4ge1xuICAgICAgc3RhcnQ6IHsgbGluZTogY3Vyc29yLmxpbmUsIGNoOiBsYXN0T3BlbiArIDIgfSxcbiAgICAgIGVuZDogY3Vyc29yLFxuICAgICAgcXVlcnksXG4gICAgfTtcbiAgfVxuXG4gIGdldFN1Z2dlc3Rpb25zKGNvbnRleHQ6IEVkaXRvclN1Z2dlc3RDb250ZXh0KTogT2JqZWN0U3VnZ2VzdGlvbltdIHtcbiAgICBjb25zdCBxdWVyeSA9IGNvbnRleHQucXVlcnkudG9Mb3dlckNhc2UoKTtcbiAgICBpZiAoIXF1ZXJ5KSByZXR1cm4gdGhpcy5vYmplY3RzLnNsaWNlKDAsIDIwKTtcblxuICAgIHJldHVybiB0aGlzLm9iamVjdHNcbiAgICAgIC5maWx0ZXIoXG4gICAgICAgIChvKSA9PlxuICAgICAgICAgIG8uZGlzcGxheUtleS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHF1ZXJ5KSB8fFxuICAgICAgICAgIG8ua2V5VmFsdWUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhxdWVyeSlcbiAgICAgIClcbiAgICAgIC5zbGljZSgwLCAyMCk7XG4gIH1cblxuICByZW5kZXJTdWdnZXN0aW9uKHN1Z2dlc3Rpb246IE9iamVjdFN1Z2dlc3Rpb24sIGVsOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIGNvbnN0IGNvbnRhaW5lciA9IGVsLmNyZWF0ZURpdih7IGNsczogXCJvbC1zdWdnZXN0aW9uXCIgfSk7XG5cbiAgICBjb25zdCB0aXRsZUVsID0gY29udGFpbmVyLmNyZWF0ZURpdih7IGNsczogXCJvbC1zdWdnZXN0aW9uLXRpdGxlXCIgfSk7XG4gICAgdGl0bGVFbC50ZXh0Q29udGVudCA9IHN1Z2dlc3Rpb24uZGlzcGxheUtleTtcblxuICAgIGNvbnN0IGZpbGVFbCA9IGNvbnRhaW5lci5jcmVhdGVEaXYoeyBjbHM6IFwib2wtc3VnZ2VzdGlvbi1maWxlXCIgfSk7XG4gICAgZmlsZUVsLnRleHRDb250ZW50ID0gc3VnZ2VzdGlvbi5maWxlTGFiZWw7XG4gIH1cblxuICBzZWxlY3RTdWdnZXN0aW9uKFxuICAgIHN1Z2dlc3Rpb246IE9iamVjdFN1Z2dlc3Rpb24sXG4gICAgX2V2dDogTW91c2VFdmVudCB8IEtleWJvYXJkRXZlbnRcbiAgKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLmNvbnRleHQpIHJldHVybjtcblxuICAgIGNvbnN0IGVkaXRvciA9IHRoaXMuY29udGV4dC5lZGl0b3I7XG4gICAgY29uc3Qgc3RhcnQgPSB0aGlzLmNvbnRleHQuc3RhcnQ7XG4gICAgY29uc3QgZW5kID0gdGhpcy5jb250ZXh0LmVuZDtcblxuICAgIC8vIENoZWNrIGlmIH19IGFscmVhZHkgZXhpc3RzIHJpZ2h0IGFmdGVyIHRoZSBjdXJzb3IgKGF1dG8tY2xvc2VkIGJ5IE9ic2lkaWFuKVxuICAgIGNvbnN0IGxpbmVUZXh0ID0gZWRpdG9yLmdldExpbmUoZW5kLmxpbmUpO1xuICAgIGNvbnN0IGFmdGVyQ3Vyc29yID0gbGluZVRleHQuc3Vic3RyaW5nKGVuZC5jaCk7XG4gICAgY29uc3QgaGFzQ2xvc2luZyA9IGFmdGVyQ3Vyc29yLnN0YXJ0c1dpdGgoXCJ9fVwiKTtcblxuICAgIC8vIFJlcGxhY2UgdGhlIHF1ZXJ5IHRleHQgd2l0aCB0aGUgZGlzcGxheSBrZXksIGNvbnN1bWluZyBleGlzdGluZyB9fSBpZiBwcmVzZW50XG4gICAgY29uc3QgcmVwbGFjZVRvID0gaGFzQ2xvc2luZ1xuICAgICAgPyB7IGxpbmU6IGVuZC5saW5lLCBjaDogZW5kLmNoICsgMiB9XG4gICAgICA6IGVuZDtcbiAgICBlZGl0b3IucmVwbGFjZVJhbmdlKHN1Z2dlc3Rpb24uZGlzcGxheUtleSArIFwifX1cIiwgc3RhcnQsIHJlcGxhY2VUbyk7XG4gIH1cbn1cbiIsICIvKipcbiAqIENvZGVNaXJyb3IgNiBlZGl0b3IgZXh0ZW5zaW9uIHRoYXQgaGlnaGxpZ2h0cyB7e29iamVjdCBsaW5rc319XG4gKiBpbiBsaXZlLXByZXZpZXcgbW9kZSB0byBtYXRjaCB0aGUgYXBwZWFyYW5jZSBvZiBbW3dpa2lsaW5rc11dLlxuICpcbiAqIFVzZXMgT2JzaWRpYW4ncyBvd24gQ1NTIHZhcmlhYmxlcyBhbmQgY2xhc3NlcyBzbyB0aGUgc3R5bGluZ1xuICogaXMgY29uc2lzdGVudCB3aXRoIHRoZSBuYXRpdmUgbGluayBhcHBlYXJhbmNlLlxuICovXG5cbmltcG9ydCB7XG4gIERlY29yYXRpb24sXG4gIERlY29yYXRpb25TZXQsXG4gIEVkaXRvclZpZXcsXG4gIFZpZXdQbHVnaW4sXG4gIFZpZXdVcGRhdGUsXG59IGZyb20gXCJAY29kZW1pcnJvci92aWV3XCI7XG5pbXBvcnQgeyBSYW5nZVNldEJ1aWxkZXIgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivc3RhdGVcIjtcblxuLyogXHUyNTAwXHUyNTAwIERlY29yYXRpb24gc3BlY3MgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwICovXG5cbmNvbnN0IGxpbmtEZWNvID0gRGVjb3JhdGlvbi5tYXJrKHsgY2xhc3M6IFwib2wtY20tbGlua1wiIH0pO1xuY29uc3QgbGlua0VkaXRpbmdEZWNvID0gRGVjb3JhdGlvbi5tYXJrKHsgY2xhc3M6IFwib2wtY20tbGluay1lZGl0aW5nXCIgfSk7XG5cbi8qIFx1MjUwMFx1MjUwMCBCdWlsZCBkZWNvcmF0aW9ucyBmb3IgdmlzaWJsZSByYW5nZXMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwICovXG5cbmZ1bmN0aW9uIGJ1aWxkRGVjb3JhdGlvbnModmlldzogRWRpdG9yVmlldyk6IERlY29yYXRpb25TZXQge1xuICBjb25zdCBidWlsZGVyID0gbmV3IFJhbmdlU2V0QnVpbGRlcjxEZWNvcmF0aW9uPigpO1xuICBjb25zdCBjdXJzb3JIZWFkID0gdmlldy5zdGF0ZS5zZWxlY3Rpb24ubWFpbi5oZWFkO1xuICBjb25zdCByZWdleCA9IC9cXHtcXHsoW159XSspXFx9XFx9L2c7XG5cbiAgZm9yIChjb25zdCB7IGZyb20sIHRvIH0gb2Ygdmlldy52aXNpYmxlUmFuZ2VzKSB7XG4gICAgY29uc3QgdGV4dCA9IHZpZXcuc3RhdGUuc2xpY2VEb2MoZnJvbSwgdG8pO1xuICAgIGxldCBtYXRjaDogUmVnRXhwRXhlY0FycmF5IHwgbnVsbDtcblxuICAgIHdoaWxlICgobWF0Y2ggPSByZWdleC5leGVjKHRleHQpKSAhPT0gbnVsbCkge1xuICAgICAgY29uc3Qgc3RhcnQgPSBmcm9tICsgbWF0Y2guaW5kZXg7XG4gICAgICBjb25zdCBlbmQgPSBzdGFydCArIG1hdGNoWzBdLmxlbmd0aDtcblxuICAgICAgLy8gVXNlIGEgc3VidGxlciBzdHlsZSB3aGVuIHRoZSBjdXJzb3IgaXMgaW5zaWRlIHRoZSBtYXRjaFxuICAgICAgY29uc3QgY3Vyc29ySW5zaWRlID0gY3Vyc29ySGVhZCA+PSBzdGFydCAmJiBjdXJzb3JIZWFkIDw9IGVuZDtcbiAgICAgIGJ1aWxkZXIuYWRkKHN0YXJ0LCBlbmQsIGN1cnNvckluc2lkZSA/IGxpbmtFZGl0aW5nRGVjbyA6IGxpbmtEZWNvKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gYnVpbGRlci5maW5pc2goKTtcbn1cblxuLyogXHUyNTAwXHUyNTAwIFZpZXdQbHVnaW4gXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwICovXG5cbmV4cG9ydCBjb25zdCBvYmplY3RMaW5rSGlnaGxpZ2h0ZXIgPSBWaWV3UGx1Z2luLmZyb21DbGFzcyhcbiAgY2xhc3Mge1xuICAgIGRlY29yYXRpb25zOiBEZWNvcmF0aW9uU2V0O1xuXG4gICAgY29uc3RydWN0b3IodmlldzogRWRpdG9yVmlldykge1xuICAgICAgdGhpcy5kZWNvcmF0aW9ucyA9IGJ1aWxkRGVjb3JhdGlvbnModmlldyk7XG4gICAgfVxuXG4gICAgdXBkYXRlKHVwZGF0ZTogVmlld1VwZGF0ZSk6IHZvaWQge1xuICAgICAgaWYgKFxuICAgICAgICB1cGRhdGUuZG9jQ2hhbmdlZCB8fFxuICAgICAgICB1cGRhdGUudmlld3BvcnRDaGFuZ2VkIHx8XG4gICAgICAgIHVwZGF0ZS5zZWxlY3Rpb25TZXRcbiAgICAgICkge1xuICAgICAgICB0aGlzLmRlY29yYXRpb25zID0gYnVpbGREZWNvcmF0aW9ucyh1cGRhdGUudmlldyk7XG4gICAgICB9XG4gICAgfVxuICB9LFxuICB7XG4gICAgZGVjb3JhdGlvbnM6ICh2KSA9PiB2LmRlY29yYXRpb25zLFxuICB9XG4pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxJQUFBQSxtQkFNTzs7O0FDb0RBLFNBQVMscUJBQ2QsU0FDQSxVQUNtQjtBQUNuQixRQUFNLFFBQVEsUUFBUSxNQUFNLElBQUk7QUFHaEMsTUFBSSxXQUFXO0FBQ2YsTUFBSSxNQUFNLFNBQVMsS0FBSyxNQUFNLENBQUMsRUFBRSxLQUFLLE1BQU0sT0FBTztBQUNqRCxhQUFTLElBQUksR0FBRyxJQUFJLE1BQU0sUUFBUSxLQUFLO0FBQ3JDLFVBQUksTUFBTSxDQUFDLEVBQUUsS0FBSyxNQUFNLE9BQU87QUFDN0IsbUJBQVcsSUFBSTtBQUNmO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBSUEsTUFBSSxVQUFVO0FBQ2QsV0FBUyxJQUFJLFVBQVUsSUFBSSxNQUFNLFFBQVEsS0FBSztBQUM1QyxVQUFNLFVBQVUsTUFBTSxDQUFDLEVBQUUsS0FBSztBQUM5QixRQUFJLFFBQVEsV0FBVztBQUFHO0FBRTFCLFFBQUksUUFBUSxXQUFXLEdBQUcsS0FBSyxDQUFDLFFBQVEsU0FBUyxHQUFHO0FBQUc7QUFDdkQsY0FBVTtBQUNWO0FBQUEsRUFDRjtBQUVBLFFBQU0sV0FBVyxRQUFRLE1BQU0sZ0JBQWdCO0FBQy9DLE1BQUksQ0FBQztBQUFVLFdBQU87QUFFdEIsUUFBTSxjQUFjLFNBQVMsQ0FBQyxFQUFFLEtBQUs7QUFDckMsUUFBTSxZQUFZLFNBQVMsUUFBUSxTQUFTLEVBQUUsRUFBRSxRQUFRLFVBQVUsRUFBRTtBQUdwRSxRQUFNLFVBQTBCLENBQUM7QUFDakMsTUFBSSxlQUE4RDtBQUNsRSxNQUFJLHVCQUF1QjtBQUUzQixXQUFTLElBQUksVUFBVSxJQUFJLE1BQU0sUUFBUSxLQUFLO0FBQzVDLFVBQU0sVUFBVSxNQUFNLENBQUMsRUFBRSxLQUFLO0FBRTlC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LE1BQU07QUFBQSxFQUNOLFlBQVk7QUFBQSxFQUNaLE9BQU87QUFBQSxFQUNQLFdBQVc7QUFBQSxFQUNYLFdBQVc7QUFBQSxFQUNYLFlBQVk7QUFBQSxFQUNaLFdBQVc7QUFBQSxFQUNYLE9BQU87QUFBQSxFQUNQLGdCQUFnQjtBQUFBLEVBQ2hCLFVBQVU7QUFBQSxFQUNWLFNBQVM7QUFBQSxFQUNULE1BQU07QUFBQSxFQUNOLFVBQVU7QUFBQSxFQUNWLFVBQVU7QUFBQSxFQUNWLGVBQWU7QUFBQSxFQUNmLFVBQVU7QUFBQSxFQUNWLFdBQVc7QUFBQSxFQUNYLFVBQVU7QUFBQSxFQUNWLFdBQVc7QUFBQSxFQUNYLGFBQWE7QUFBQSxFQUNiLGdCQUFnQjtBQUFBLEVBQ2hCLFlBQVk7QUFBQSxFQUNaLFlBQVk7QUFBQSxFQUNaLFNBQVM7QUFBQSxFQUNULFlBQVk7QUFBQSxFQUNaLGNBQWM7QUFBQSxFQUNkLGVBQWU7QUFBQSxFQUNmLGVBQWU7QUFBQSxFQUNmLGVBQWU7QUFBQSxFQUNmLGVBQWU7QUFBQSxFQUNmLFlBQVk7QUFBQSxFQUNaLFVBQVU7QUFBQSxFQUNWLGFBQWE7QUFBQSxFQUNiLFNBQVM7QUFBQSxFQUNULFNBQVM7QUFBQSxFQUNULFlBQVk7QUFBQSxFQUNaLFdBQVc7QUFBQSxFQUNYLGFBQWE7QUFBQSxFQUNiLGFBQWE7QUFBQSxFQUNiLFNBQVM7QUFBQSxFQUNULFdBQVc7QUFBQSxFQUNYLFlBQVk7QUFBQSxFQUNaLE1BQU07QUFBQSxFQUNOLFdBQVc7QUFBQSxFQUNYLE1BQU07QUFBQSxFQUNOLE9BQU87QUFBQSxFQUNQLGFBQWE7QUFBQSxFQUNiLE1BQU07QUFBQSxFQUNOLFVBQVU7QUFBQSxFQUNWLFNBQVM7QUFBQSxFQUNULFdBQVc7QUFBQSxFQUNYLFFBQVE7QUFBQSxFQUNSLE9BQU87QUFBQSxFQUNQLE9BQU87QUFBQSxFQUNQLFVBQVU7QUFBQSxFQUNWLGVBQWU7QUFBQSxFQUNmLFdBQVc7QUFBQSxFQUNYLGNBQWM7QUFBQSxFQUNkLFdBQVc7QUFBQSxFQUNYLFlBQVk7QUFB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QkFBZ0IsU0FBUztBQUVsRCxRQUFJLE9BQU8sU0FBUyxHQUFHO0FBQ3JCLGFBQU8sT0FBTyxDQUFDO0FBQUEsSUFDakIsT0FBTztBQUNMLGFBQU8sVUFBVSxRQUFRLEtBQUs7QUFDOUIsWUFBTSxLQUFLLGFBQWEsRUFBRSxNQUFNLFdBQVcsUUFBUSxLQUFLLENBQUM7QUFBQSxJQUMzRDtBQUVBLGNBQVUsV0FBVyxJQUFJO0FBR3pCLFVBQU0sS0FBSyxZQUFZO0FBQUEsRUFDekI7QUFBQTtBQUFBLEVBSUEsTUFBTSxlQUE4QjtBQUNsQyxTQUFLLFdBQVcsT0FBTyxPQUFPLENBQUMsR0FBRyxrQkFBa0IsTUFBTSxLQUFLLFNBQVMsQ0FBQztBQUFBLEVBQzNFO0FBQUEsRUFFQSxNQUFNLGVBQThCO0FBQ2xDLFVBQU0sS0FBSyxTQUFTLEtBQUssUUFBUTtBQUVqQyxTQUFLLFlBQVk7QUFBQSxFQUNuQjtBQUNGOyIsCiAgIm5hbWVzIjogWyJpbXBvcnRfb2JzaWRpYW4iLCAiaWQiLCAidHlwZSIsICJpbXBvcnRfb2JzaWRpYW4iLCAidHlwZSIsICJjIiwgImRvY3VtZW50IiwgIm0iLCAieCIsICJtIiwgIm0iLCAiZGF0dW0iLCAieCIsICJtIiwgInNlbGVjdGlvbiIsICJtIiwgIm0iLCAiYSIsICJtIiwgIm0iLCAibSIsICJjcmVhdGUiLCAiY3JlYXRlIiwgInBhcnNlVHlwZW5hbWVzIiwgIm0iLCAidHlwZSIsICJ3aW5kb3ciLCAiZGlzcGF0Y2hfZGVmYXVsdCIsICJtIiwgImRpc3BhdGNoX2RlZmF1bHQiLCAic2VsZWN0X2RlZmF1bHQiLCAicm9vdCIsICJzZWxlY3Rpb24iLCAic2VsZWN0X2RlZmF1bHQiLCAiY29uc3RhbnRfZGVmYXVsdCIsICJ4IiwgInR5cGUiLCAieCIsICJ5IiwgImRpc3BhdGNoIiwgImZpbHRlciIsICJzZWxlY3Rpb24iLCAic2VsZWN0X2RlZmF1bHQiLCAiYyIsICJjb250YWluZXIiLCAiZGlzcGF0Y2giLCAidHlwZSIsICJldmVudCIsICJ0b3VjaCIsICJjb25zdGFudF9kZWZhdWx0IiwgIm0iLCAiYSIsICJtaW4iLCAibWF4IiwgImNvbnN0YW50X2RlZmF1bHQiLCAieCIsICJhIiwgInkiLCAieSIsICJhIiwgImNvbnN0YW50X2RlZmF1bHQiLCAieSIsICJjb2xvciIsICJyZ2IiLCAic3RhcnQiLCAiYSIsICJhIiwgImkiLCAiYSIsICJjIiwgIm0iLCAiYSIsICJ4IiwgIm5vdyIsICJpZCIsICJpbmRleCIsICJnZXQiLCAic2V0IiwgInN0YXJ0IiwgImVtcHR5IiwgImludGVycnVwdF9kZWZhdWx0IiwgImlkIiwgInNldCIsICJnZXQiLCAidHJhbnNpdGlvbiIsICJhIiwgImMiLCAiYXR0clJlbW92ZSIsICJhdHRyUmVtb3ZlTlMiLCAiYXR0ckNvbnN0YW50IiwgImF0dHJDb25zdGFudE5TIiwgImF0dHJGdW5jdGlvbiIsICJhdHRyRnVuY3Rpb25OUyIsICJhdHRyX2RlZmF1bHQiLCAiaWQiLCAiZ2V0IiwgImlkIiwgInNldCIsICJnZXQiLCAiaWQiLCAic2V0IiwgImdldCIsICJpZCIsICJzZXQiLCAiZmlsdGVyX2RlZmF1bHQiLCAibSIsICJtZXJnZV9kZWZhdWx0IiwgInRyYW5zaXRpb24iLCAibSIsICJpZCIsICJzZXQiLCAib25fZGVmYXVsdCIsICJnZXQiLCAiaWQiLCAicmVtb3ZlX2RlZmF1bHQiLCAic2VsZWN0X2RlZmF1bHQiLCAiaWQiLCAibSIsICJnZXQiLCAic2VsZWN0QWxsX2RlZmF1bHQiLCAiaWQiLCAibSIsICJjaGlsZHJlbiIsICJpbmhlcml0IiwgImdldCIsICJTZWxlY3Rpb24iLCAic2VsZWN0aW9uX2RlZmF1bHQiLCAic3R5bGVSZW1vdmUiLCAic3R5bGVDb25zdGFudCIsICJzdHlsZUZ1bmN0aW9uIiwgImlkIiwgInJlbW92ZSIsICJzZXQiLCAic3R5bGVfZGVmYXVsdCIsICJ0ZXh0Q29uc3RhbnQiLCAidGV4dEZ1bmN0aW9uIiwgInRleHRfZGVmYXVsdCIsICJtIiwgImluaGVyaXQiLCAiZ2V0IiwgImlkIiwgInNldCIsICJpZCIsICJzZWxlY3RfZGVmYXVsdCIsICJzZWxlY3RBbGxfZGVmYXVsdCIsICJmaWx0ZXJfZGVmYXVsdCIsICJtZXJnZV9kZWZhdWx0IiwgInNlbGVjdGlvbl9kZWZhdWx0IiwgIm9uX2RlZmF1bHQiLCAiYXR0cl9kZWZhdWx0IiwgInN0eWxlX2RlZmF1bHQiLCAidGV4dF9kZWZhdWx0IiwgInJlbW92ZV9kZWZhdWx0IiwgImlkIiwgInRyYW5zaXRpb25fZGVmYXVsdCIsICJtIiwgImludGVycnVwdF9kZWZhdWx0IiwgInRyYW5zaXRpb25fZGVmYXVsdCIsICJ4IiwgInkiLCAieCIsICJ5IiwgIngiLCAieSIsICJ4IiwgInkiLCAiZGF0YV9kZWZhdWx0IiwgIngiLCAieSIsICJ4MiIsICJ5MiIsICJ4MyIsICJ5MyIsICJyZW1vdmVfZGVmYXVsdCIsICJ4IiwgInkiLCAic2l6ZV9kZWZhdWx0IiwgIngiLCAieSIsICJkYXRhX2RlZmF1bHQiLCAicmVtb3ZlX2RlZmF1bHQiLCAic2l6ZV9kZWZhdWx0IiwgImNvbnN0YW50X2RlZmF1bHQiLCAieCIsICJjb25zdGFudF9kZWZhdWx0IiwgIngiLCAieSIsICJmaW5kIiwgImlkIiwgImNvbnN0YW50X2RlZmF1bHQiLCAieCIsICJ5IiwgIm0iLCAiaSIsICJ4IiwgInkiLCAiY29uc3RhbnRfZGVmYXVsdCIsICJ4IiwgInkiLCAibm9kZSIsICJzdHJlbmd0aCIsICJjIiwgIngyIiwgInhfZGVmYXVsdCIsICJ4IiwgImNvbnN0YW50X2RlZmF1bHQiLCAieV9kZWZhdWx0IiwgInkiLCAiY29uc3RhbnRfZGVmYXVsdCIsICJjb25zdGFudF9kZWZhdWx0IiwgIngiLCAidHlwZSIsICJ0cmFuc2Zvcm0iLCAiZGlzcGF0Y2giLCAieCIsICJ5IiwgImlkZW50aXR5IiwgIm5vcHJvcGFnYXRpb24iLCAibm9ldmVudF9kZWZhdWx0IiwgImRlZmF1bHRGaWx0ZXIiLCAiaWRlbnRpdHkiLCAiZGVmYXVsdFRvdWNoYWJsZSIsICJ0cmFuc2Zvcm0iLCAiem9vbV9kZWZhdWx0IiwgImZpbHRlciIsICJzZWxlY3Rpb24iLCAieCIsICJ5IiwgImV4dGVudCIsICJ0cmFuc2l0aW9uIiwgImEiLCAidHlwZSIsICJzZWxlY3RfZGVmYXVsdCIsICJub2V2ZW50X2RlZmF1bHQiLCAibm9wcm9wYWdhdGlvbiIsICJldmVudCIsICJjb25zdGFudF9kZWZhdWx0IiwgIm1pbiIsICJtYXgiLCAiYyIsICJzZWxlY3RfZGVmYXVsdCIsICJ6b29tX2RlZmF1bHQiLCAiaWRlbnRpdHkiLCAibm93IiwgInhfZGVmYXVsdCIsICJ5X2RlZmF1bHQiLCAiaW1wb3J0X29ic2lkaWFuIiwgInN0YXJ0IiwgInN0YXJ0Il0KfQo=
