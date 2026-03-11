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
  // Display
  nodeSizeMultiplier: 1,
  nodeMaxScreenRadius: 16,
  labelOpacity: 0.65,
  labelMinZoom: 1.05,
  labelMaxWidth: 160,
  // Forces
  linkDistance: 100,
  centerStrength: 0.03,
  repelStrength: 300
};
var ConfigPanel = class {
  constructor(parent, config, onChange) {
    this.collapsed = {
      filter: false,
      display: true
    };
    this.debounceTimers = /* @__PURE__ */ new Map();
    this.config = { ...config };
    this.onChange = onChange;
    this.panelEl = document.createElement("div");
    this.panelEl.className = "ol-config-panel";
    parent.appendChild(this.panelEl);
    this.render();
  }
  getConfig() {
    return { ...this.config };
  }
  destroy() {
    for (const t of this.debounceTimers.values())
      clearTimeout(t);
    this.debounceTimers.clear();
    this.panelEl.remove();
  }
  render() {
    this.panelEl.empty();
    this.renderSection("filter", "Filters", (contentEl) => {
      this.renderTextInput(contentEl, "Search", this.config.search, (v) => {
        this.config.search = v;
        this.emitDebounced("search", 250);
      });
      this.renderTextInput(contentEl, "Path filter", this.config.pathFilter, (v) => {
        this.config.pathFilter = v;
        this.emitDebounced("pathFilter", 250);
      }, "e.g. 00 Daily");
      this.renderTextInput(contentEl, "Source filter", this.config.sourceFilter, (v) => {
        this.config.sourceFilter = v;
        this.emitDebounced("sourceFilter", 250);
      }, "e.g. Films");
      this.renderToggle(contentEl, "Show files", this.config.showFiles, (v) => {
        this.config.showFiles = v;
        this.emit();
      });
      this.renderToggle(contentEl, "Show objects", this.config.showObjects, (v) => {
        this.config.showObjects = v;
        this.emit();
      });
      this.renderToggle(contentEl, "Show orphans", this.config.showOrphans, (v) => {
        this.config.showOrphans = v;
        this.emit();
      });
      this.renderToggle(contentEl, "Wiki links", this.config.showWikiEdges, (v) => {
        this.config.showWikiEdges = v;
        this.emit();
      });
      this.renderToggle(contentEl, "Object links", this.config.showObjectEdges, (v) => {
        this.config.showObjectEdges = v;
        this.emit();
      });
    });
    this.renderSection("display", "Display", (contentEl) => {
      this.renderSlider(contentEl, "Node size", this.config.nodeSizeMultiplier, 0.2, 3, 0.1, (v) => {
        this.config.nodeSizeMultiplier = v;
        this.emit();
      });
      this.renderSlider(contentEl, "Node max size (on screen)", this.config.nodeMaxScreenRadius, 6, 40, 1, (v) => {
        this.config.nodeMaxScreenRadius = v;
        this.emit();
      });
      this.renderSlider(contentEl, "Labels appear at zoom", this.config.labelMinZoom, 0.2, 3, 0.05, (v) => {
        this.config.labelMinZoom = v;
        this.emit();
      });
      this.renderSlider(contentEl, "Label max width", this.config.labelMaxWidth, 60, 360, 10, (v) => {
        this.config.labelMaxWidth = v;
        this.emit();
      });
      this.renderSlider(contentEl, "Label opacity", this.config.labelOpacity, 0, 1, 0.05, (v) => {
        this.config.labelOpacity = v;
        this.emit();
      });
      this.renderSlider(contentEl, "Link distance", this.config.linkDistance, 30, 500, 10, (v) => {
        this.config.linkDistance = v;
        this.emit();
      });
      this.renderSlider(contentEl, "Center force", this.config.centerStrength, 0, 0.2, 5e-3, (v) => {
        this.config.centerStrength = v;
        this.emit();
      });
      this.renderSlider(contentEl, "Repel force", this.config.repelStrength, 50, 1e3, 25, (v) => {
        this.config.repelStrength = v;
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
      contentFn(content);
    }
    this.panelEl.appendChild(section);
  }
  renderTextInput(parent, label, value, onChange, placeholder) {
    const row = document.createElement("div");
    row.className = "ol-config-row ol-config-text-row";
    const labelEl = document.createElement("span");
    labelEl.className = "ol-config-label";
    labelEl.textContent = label;
    row.appendChild(labelEl);
    const input = document.createElement("input");
    input.type = "text";
    input.className = "ol-config-input";
    input.placeholder = placeholder || "";
    input.value = value;
    input.addEventListener("input", () => onChange(input.value));
    row.appendChild(input);
    parent.appendChild(row);
  }
  renderToggle(parent, label, value, onChange) {
    const row = document.createElement("div");
    row.className = "ol-config-row ol-config-toggle-row";
    const labelEl = document.createElement("span");
    labelEl.className = "ol-config-label";
    labelEl.textContent = label;
    row.appendChild(labelEl);
    const toggle = document.createElement("div");
    toggle.className = `ol-config-toggle ${value ? "is-enabled" : ""}`;
    const knob = document.createElement("div");
    knob.className = "ol-config-toggle-knob";
    toggle.appendChild(knob);
    toggle.addEventListener("click", () => {
      const newVal = !toggle.classList.contains("is-enabled");
      toggle.classList.toggle("is-enabled", newVal);
      onChange(newVal);
    });
    row.appendChild(toggle);
    parent.appendChild(row);
  }
  renderSlider(parent, label, value, min2, max2, step, onChange) {
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
    parent.appendChild(row);
  }
  emit() {
    this.onChange({ ...this.config });
  }
  emitDebounced(key, ms) {
    const existing = this.debounceTimers.get(key);
    if (existing)
      clearTimeout(existing);
    this.debounceTimers.set(key, setTimeout(() => {
      this.debounceTimers.delete(key);
      this.emit();
    }, ms));
  }
};

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
var nonpassivecapture = { capture: true, passive: false };
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
var constant_default2 = (x3) => () => x3;

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
    return b - a2 ? exponential(a2, b, y3) : constant_default2(isNaN(a2) ? b : a2);
  };
}
function nogamma(a2, b) {
  var d = b - a2;
  return d ? linear(a2, d) : constant_default2(isNaN(a2) ? b : a2);
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
function constant_default4(x3) {
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
    radius = constant_default4(radius == null ? 1 : +radius);
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
    return arguments.length ? (radius = typeof _ === "function" ? _ : constant_default4(+_), initialize(), force) : radius;
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
  var id2 = index, strength = defaultStrength, strengths, distance = constant_default4(30), distances, nodes, count, bias, random, iterations = 1;
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
    return arguments.length ? (strength = typeof _ === "function" ? _ : constant_default4(+_), initializeStrength(), force) : strength;
  };
  force.distance = function(_) {
    return arguments.length ? (distance = typeof _ === "function" ? _ : constant_default4(+_), initializeDistance(), force) : distance;
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
  var nodes, node, random, alpha, strength = constant_default4(-30), strengths, distanceMin2 = 1, distanceMax2 = Infinity, theta2 = 0.81;
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
    return arguments.length ? (strength = typeof _ === "function" ? _ : constant_default4(+_), initialize(), force) : strength;
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
  var strength = constant_default4(0.1), nodes, strengths, xz;
  if (typeof x3 !== "function")
    x3 = constant_default4(x3 == null ? 0 : +x3);
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
    return arguments.length ? (strength = typeof _ === "function" ? _ : constant_default4(+_), initialize(), force) : strength;
  };
  force.x = function(_) {
    return arguments.length ? (x3 = typeof _ === "function" ? _ : constant_default4(+_), initialize(), force) : x3;
  };
  return force;
}

// node_modules/d3-force/src/y.js
function y_default2(y3) {
  var strength = constant_default4(0.1), nodes, strengths, yz;
  if (typeof y3 !== "function")
    y3 = constant_default4(y3 == null ? 0 : +y3);
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
    return arguments.length ? (strength = typeof _ === "function" ? _ : constant_default4(+_), initialize(), force) : strength;
  };
  force.y = function(_) {
    return arguments.length ? (y3 = typeof _ === "function" ? _ : constant_default4(+_), initialize(), force) : y3;
  };
  return force;
}

// node_modules/d3-zoom/src/constant.js
var constant_default5 = (x3) => () => x3;

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
function nopropagation2(event) {
  event.stopImmediatePropagation();
}
function noevent_default3(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

// node_modules/d3-zoom/src/zoom.js
function defaultFilter(event) {
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
function defaultTouchable() {
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
  var filter2 = defaultFilter, extent = defaultExtent, constrain = defaultConstrain, wheelDelta = defaultWheelDelta, touchable = defaultTouchable, scaleExtent = [0, Infinity], translateExtent = [[-Infinity, -Infinity], [Infinity, Infinity]], duration = 250, interpolate = zoom_default, listeners = dispatch_default("start", "zoom", "end"), touchstarting, touchfirst, touchending, touchDelay = 500, wheelDelay = 150, clickDistance2 = 0, tapDistance = 10;
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
    nopropagation2(event);
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
    nopropagation2(event);
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
    nopropagation2(event);
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
    return arguments.length ? (wheelDelta = typeof _ === "function" ? _ : constant_default5(+_), zoom) : wheelDelta;
  };
  zoom.filter = function(_) {
    return arguments.length ? (filter2 = typeof _ === "function" ? _ : constant_default5(!!_), zoom) : filter2;
  };
  zoom.touchable = function(_) {
    return arguments.length ? (touchable = typeof _ === "function" ? _ : constant_default5(!!_), zoom) : touchable;
  };
  zoom.extent = function(_) {
    return arguments.length ? (extent = typeof _ === "function" ? _ : constant_default5([[+_[0][0], +_[0][1]], [+_[1][0], +_[1][1]]]), zoom) : extent;
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

// src/graph-view.ts
var VIEW_TYPE = "object-links-graph";
function parseColor(css) {
  if (css.startsWith("#")) {
    const hex2 = css.slice(1);
    if (hex2.length === 3) {
      return [
        parseInt(hex2[0] + hex2[0], 16) / 255,
        parseInt(hex2[1] + hex2[1], 16) / 255,
        parseInt(hex2[2] + hex2[2], 16) / 255
      ];
    }
    return [
      parseInt(hex2.slice(0, 2), 16) / 255,
      parseInt(hex2.slice(2, 4), 16) / 255,
      parseInt(hex2.slice(4, 6), 16) / 255
    ];
  }
  const m2 = css.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
  if (m2)
    return [parseInt(m2[1]) / 255, parseInt(m2[2]) / 255, parseInt(m2[3]) / 255];
  return [0.6, 0.6, 0.6];
}
function getThemeColor(el, varName, fallback) {
  const style = getComputedStyle(el);
  const val = style.getPropertyValue(varName).trim();
  return parseColor(val || fallback);
}
function colorToCSS(c2) {
  return `rgb(${Math.round(c2[0] * 255)},${Math.round(c2[1] * 255)},${Math.round(c2[2] * 255)})`;
}
function lerp(a2, b, t) {
  return a2 + (b - a2) * t;
}
var GraphView = class extends import_obsidian2.ItemView {
  constructor(leaf) {
    super(leaf);
    this.graphData = null;
    this.simulation = null;
    this.resizeObserver = null;
    this.configPanel = null;
    this.config = { ...DEFAULT_CONFIG };
    // Canvas state
    this.canvasWrapper = null;
    this.canvasEl = null;
    this.ctx = null;
    this.dpr = 1;
    // d3-zoom
    this.zoomBehavior = null;
    this.zoomTransform = identity2;
    this.isSyncingZoom = false;
    // Sim data
    this.simNodes = [];
    this.simEdges = [];
    // Camera (current = smoothed, target = where we want to be)
    this.camX = 0;
    this.camY = 0;
    this.camScale = 0.7;
    this.targetCamX = 0;
    this.targetCamY = 0;
    this.targetCamScale = 0.7;
    // Interaction state
    this.hoveredNode = null;
    this.selectedNode = null;
    this.dragNode = null;
    this.isDragging = false;
    this.lastClickTime = 0;
    this.lastClickId = "";
    // Render loop
    this.renderLoopId = 0;
    this.needsRedraw = true;
    // Theme colors (cached)
    this.colorNodeObject = [0.5, 0.5, 1];
    this.colorNodeFile = [0.6, 0.6, 0.6];
    this.colorEdgeWiki = [0.5, 0.5, 0.5];
    this.colorEdgeObj = [0.5, 0.5, 1];
    this.colorHighlight = [0.5, 0.5, 1];
    this.colorBg = [0.1, 0.1, 0.1];
    this.colorText = "#dcddde";
    // Callbacks
    this.navigateToObject = null;
    this.navigateToFile = null;
    // Bound handlers
    this._onWheel = null;
    this._onMouseDown = null;
    this._onMouseMove = null;
    this._onMouseUp = null;
    this._onDblClick = null;
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
    if (this.containerEl)
      this.renderGraph();
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
    this.stopRenderLoop();
    if (this.simulation) {
      this.simulation.stop();
      this.simulation.on("tick", null);
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
    this.removeCanvasListeners();
    this.simNodes = [];
    this.simEdges = [];
    this.canvasEl?.remove();
    this.canvasEl = null;
    this.ctx = null;
    this.canvasWrapper = null;
  }
  removeCanvasListeners() {
    const c2 = this.canvasEl;
    if (!c2)
      return;
    if (this._onWheel)
      c2.removeEventListener("wheel", this._onWheel);
    if (this._onMouseDown)
      c2.removeEventListener("mousedown", this._onMouseDown, true);
    if (this._onMouseMove)
      c2.removeEventListener("mousemove", this._onMouseMove);
    if (this._onMouseUp)
      c2.removeEventListener("mouseup", this._onMouseUp);
    if (this._onDblClick)
      c2.removeEventListener("dblclick", this._onDblClick);
  }
  /* ── Render loop ───────────────────────────────────────────────── */
  startRenderLoop() {
    if (this.renderLoopId)
      return;
    const frame2 = () => {
      this.renderLoopId = requestAnimationFrame(frame2);
      this.updateAndDraw();
    };
    this.renderLoopId = requestAnimationFrame(frame2);
  }
  stopRenderLoop() {
    if (this.renderLoopId) {
      cancelAnimationFrame(this.renderLoopId);
      this.renderLoopId = 0;
    }
  }
  updateAndDraw() {
    let animating = false;
    const camLerp = 0.15;
    if (Math.abs(this.camX - this.targetCamX) > 0.01 || Math.abs(this.camY - this.targetCamY) > 0.01 || Math.abs(this.camScale - this.targetCamScale) > 1e-4) {
      this.camX = lerp(this.camX, this.targetCamX, camLerp);
      this.camY = lerp(this.camY, this.targetCamY, camLerp);
      this.camScale = lerp(this.camScale, this.targetCamScale, camLerp);
      if (Math.abs(this.camScale - this.targetCamScale) < 1e-4) {
        this.camScale = this.targetCamScale;
        this.camX = this.targetCamX;
        this.camY = this.targetCamY;
      }
      animating = true;
    }
    const alphaLerp = 0.12;
    for (const n of this.simNodes) {
      if (Math.abs(n.alpha - n.targetAlpha) > 5e-3) {
        n.alpha = lerp(n.alpha, n.targetAlpha, alphaLerp);
        animating = true;
      } else {
        n.alpha = n.targetAlpha;
      }
    }
    for (const e of this.simEdges) {
      if (Math.abs(e.alpha - e.targetAlpha) > 5e-3) {
        e.alpha = lerp(e.alpha, e.targetAlpha, alphaLerp);
        animating = true;
      } else {
        e.alpha = e.targetAlpha;
      }
    }
    const simActive = (this.simulation?.alpha() ?? 0) > 1e-3;
    if (animating || simActive || this.needsRedraw) {
      this.needsRedraw = false;
      this.draw();
    }
  }
  /* ── Filtering ─────────────────────────────────────────────────── */
  applyFilters(data) {
    const c2 = this.config;
    let nodes = [...data.nodes];
    let edges = [...data.edges];
    if (!c2.showFiles) {
      const ids = new Set(nodes.filter((n) => n.type === "file").map((n) => n.id));
      nodes = nodes.filter((n) => n.type !== "file");
      edges = edges.filter((e) => !ids.has(e.source) && !ids.has(e.target));
    }
    if (!c2.showObjects) {
      const ids = new Set(nodes.filter((n) => n.type === "object").map((n) => n.id));
      nodes = nodes.filter((n) => n.type !== "object");
      edges = edges.filter((e) => !ids.has(e.source) && !ids.has(e.target));
    }
    if (!c2.showWikiEdges)
      edges = edges.filter((e) => e.edgeType !== "wiki");
    if (!c2.showObjectEdges)
      edges = edges.filter((e) => e.edgeType !== "object");
    if (c2.search) {
      const q = c2.search.toLowerCase();
      const matched = new Set(nodes.filter((n) => n.label.toLowerCase().includes(q)).map((n) => n.id));
      for (const e of edges) {
        if (matched.has(e.source))
          matched.add(e.target);
        if (matched.has(e.target))
          matched.add(e.source);
      }
      nodes = nodes.filter((n) => matched.has(n.id));
      const nodeIds = new Set(nodes.map((n) => n.id));
      edges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
    }
    if (c2.pathFilter) {
      const pf = c2.pathFilter.toLowerCase();
      const matched = new Set(nodes.filter((n) => n.filePath.toLowerCase().includes(pf)).map((n) => n.id));
      for (const e of edges) {
        if (matched.has(e.source))
          matched.add(e.target);
        if (matched.has(e.target))
          matched.add(e.source);
      }
      nodes = nodes.filter((n) => matched.has(n.id));
      const nodeIds = new Set(nodes.map((n) => n.id));
      edges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
    }
    if (c2.sourceFilter) {
      const sf = c2.sourceFilter.toLowerCase();
      const removed = new Set(
        nodes.filter((n) => n.type === "object" && !n.fileLabel.toLowerCase().includes(sf)).map((n) => n.id)
      );
      nodes = nodes.filter((n) => !removed.has(n.id));
      edges = edges.filter((e) => !removed.has(e.source) && !removed.has(e.target));
    }
    if (!c2.showOrphans) {
      const connected = /* @__PURE__ */ new Set();
      for (const e of edges) {
        connected.add(e.source);
        connected.add(e.target);
      }
      nodes = nodes.filter((n) => connected.has(n.id));
    }
    const cc = /* @__PURE__ */ new Map();
    for (const e of edges) {
      cc.set(e.source, (cc.get(e.source) || 0) + 1);
      cc.set(e.target, (cc.get(e.target) || 0) + 1);
    }
    for (const n of nodes)
      n.connections = cc.get(n.id) || 0;
    return { nodes, edges };
  }
  /* ── Node radius ───────────────────────────────────────────────── */
  getNodeRadius(n) {
    const m2 = this.config.nodeSizeMultiplier;
    const base = n.type === "file" ? 4.5 : 5.5;
    const deg = Math.max(0, n.connections);
    const bump = Math.min(10, Math.sqrt(deg) * 1.6);
    return (base + bump) * m2;
  }
  /* ── Theme colors ──────────────────────────────────────────────── */
  refreshColors() {
    const el = this.contentEl;
    this.colorNodeObject = getThemeColor(el, "--interactive-accent", "#7f6df2");
    this.colorNodeFile = getThemeColor(el, "--text-muted", "#999999");
    this.colorEdgeWiki = getThemeColor(el, "--background-modifier-border", "#555555");
    this.colorEdgeObj = getThemeColor(el, "--interactive-accent", "#7f6df2");
    this.colorHighlight = getThemeColor(el, "--interactive-accent", "#7f6df2");
    this.colorBg = getThemeColor(el, "--background-primary", "#1e1e1e");
    const style = getComputedStyle(el);
    this.colorText = style.getPropertyValue("--text-normal").trim() || "#dcddde";
  }
  /* ── Coordinate transforms ─────────────────────────────────────── */
  getScreenSize() {
    const c2 = this.canvasEl;
    if (!c2)
      return { w: 0, h: 0 };
    return { w: c2.clientWidth, h: c2.clientHeight };
  }
  worldToScreen(wx, wy) {
    const { w, h } = this.getScreenSize();
    return [
      (wx - this.camX) * this.camScale + w / 2,
      (wy - this.camY) * this.camScale + h / 2
    ];
  }
  screenToWorld(sx, sy) {
    const { w, h } = this.getScreenSize();
    return [
      (sx - w / 2) / this.camScale + this.camX,
      (sy - h / 2) / this.camScale + this.camY
    ];
  }
  screenToWorldTarget(sx, sy) {
    const { w, h } = this.getScreenSize();
    return [
      (sx - w / 2) / this.targetCamScale + this.targetCamX,
      (sy - h / 2) / this.targetCamScale + this.targetCamY
    ];
  }
  /* ── Hit test ──────────────────────────────────────────────────── */
  hitTestNode(sx, sy) {
    const [wx, wy] = this.screenToWorld(sx, sy);
    let best = null;
    let bestDist = Infinity;
    for (const n of this.simNodes) {
      const nx = n.x ?? 0;
      const ny = n.y ?? 0;
      const dx = nx - wx;
      const dy = ny - wy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const hitRadius = Math.max(n.radius + 4, 8 / this.camScale);
      if (dist < hitRadius && dist < bestDist) {
        best = n;
        bestDist = dist;
      }
    }
    return best;
  }
  /* ── Update highlight targets ──────────────────────────────────── */
  updateHighlightTargets() {
    const focus = this.hoveredNode || this.selectedNode;
    if (!focus) {
      for (const n of this.simNodes) {
        n.targetAlpha = n.type === "object" ? 0.9 : 0.5;
      }
      for (const e of this.simEdges) {
        e.targetAlpha = e.edgeType === "wiki" ? 0.35 : 0.25;
      }
      return;
    }
    const connected = /* @__PURE__ */ new Set();
    connected.add(focus.id);
    for (const e of this.simEdges) {
      const s = e.source.id;
      const t = e.target.id;
      if (s === focus.id)
        connected.add(t);
      if (t === focus.id)
        connected.add(s);
    }
    for (const n of this.simNodes) {
      if (n === focus) {
        n.targetAlpha = 1;
      } else if (connected.has(n.id)) {
        n.targetAlpha = n.type === "object" ? 0.9 : 0.7;
      } else {
        n.targetAlpha = 0.06;
      }
    }
    for (const e of this.simEdges) {
      const s = e.source.id;
      const t = e.target.id;
      if (s === focus.id || t === focus.id) {
        e.targetAlpha = 0.8;
      } else {
        e.targetAlpha = 0.03;
      }
    }
  }
  /* ══════════════════════════════════════════════════════════════════
     Main Render — called once on initial data, and on filter changes
     ══════════════════════════════════════════════════════════════════ */
  renderGraph() {
    if (!this.graphData)
      return;
    const container = this.contentEl;
    const isFirstRender = !this.canvasEl;
    if (isFirstRender) {
      container.empty();
      container.addClass("ol-graph-container");
      this.configPanel = new ConfigPanel(container, this.config, (newConfig) => {
        this.handleConfigChange(newConfig);
      });
      this.canvasWrapper = document.createElement("div");
      this.canvasWrapper.style.cssText = "position:absolute;inset:0;";
      container.appendChild(this.canvasWrapper);
      this.refreshColors();
      this.initCanvas();
      this.rebuildSimData();
      return;
    }
    this.rebuildSimData();
  }
  initCanvas() {
    const wrapper = this.canvasWrapper;
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
    wrapper.appendChild(canvas);
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx)
      throw new Error("Failed to init 2D canvas context");
    this.canvasEl = canvas;
    this.ctx = ctx;
    this.resizeObserver = new ResizeObserver(() => {
      this.resizeCanvas();
      this.needsRedraw = true;
    });
    this.resizeObserver.observe(this.contentEl);
    this.resizeCanvas();
    this.setupInputHandlers();
    this.startRenderLoop();
  }
  resizeCanvas() {
    const canvas = this.canvasEl;
    const wrapper = this.canvasWrapper;
    if (!canvas || !wrapper)
      return;
    const w = wrapper.clientWidth || this.contentEl.clientWidth || 800;
    const h = wrapper.clientHeight || this.contentEl.clientHeight || 600;
    this.dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(w * this.dpr));
    canvas.height = Math.max(1, Math.floor(h * this.dpr));
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }
  /** Rebuild simulation nodes/edges from current graphData + filters */
  rebuildSimData() {
    if (!this.graphData)
      return;
    const filtered = this.applyFilters(this.graphData);
    const container = this.contentEl;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;
    const existingEmpty = container.querySelector(".ol-empty-state");
    if (existingEmpty)
      existingEmpty.remove();
    if (filtered.nodes.length === 0) {
      if (this.canvasWrapper)
        this.canvasWrapper.style.display = "none";
      container.createEl("div", {
        cls: "ol-empty-state",
        text: "No nodes match the current filters."
      });
      if (this.simulation) {
        this.simulation.stop();
        this.simulation = null;
      }
      return;
    }
    if (this.canvasWrapper)
      this.canvasWrapper.style.display = "";
    const oldPositions = /* @__PURE__ */ new Map();
    for (const n of this.simNodes) {
      oldPositions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
    }
    const nodeById = /* @__PURE__ */ new Map();
    this.simNodes = filtered.nodes.map((n) => {
      const old = oldPositions.get(n.id);
      const baseAlpha = n.type === "object" ? 0.9 : 0.5;
      const node = {
        ...n,
        x: old ? old.x : (Math.random() - 0.5) * width * 0.4,
        y: old ? old.y : (Math.random() - 0.5) * height * 0.4,
        vx: 0,
        vy: 0,
        fx: null,
        fy: null,
        radius: this.getNodeRadius(n),
        alpha: baseAlpha,
        targetAlpha: baseAlpha
      };
      nodeById.set(node.id, node);
      return node;
    });
    this.simEdges = filtered.edges.map((e) => {
      const s = nodeById.get(e.source);
      const t = nodeById.get(e.target);
      if (!s || !t)
        return null;
      const baseAlpha = e.edgeType === "wiki" ? 0.35 : 0.25;
      const edge = {
        source: s,
        target: t,
        edgeType: e.edgeType,
        alpha: baseAlpha,
        targetAlpha: baseAlpha
      };
      return edge;
    }).filter((e) => e !== null);
    this.hoveredNode = null;
    this.selectedNode = null;
    this.dragNode = null;
    this.startSimulation();
    this.updateHighlightTargets();
    this.needsRedraw = true;
  }
  startSimulation() {
    if (this.simulation) {
      this.simulation.stop();
      this.simulation.on("tick", null);
      this.simulation = null;
    }
    const sim = simulation_default(this.simNodes).alpha(1).alphaTarget(0).alphaDecay(0.0228).alphaMin(1e-3).velocityDecay(0.4);
    const linkForce = link_default(this.simEdges).distance(this.config.linkDistance).strength(0.4);
    const chargeForce = manyBody_default().strength(-this.config.repelStrength).distanceMax(Math.max(this.config.repelStrength * 2, 600));
    const centerX = x_default2(0).strength(this.config.centerStrength);
    const centerY = y_default2(0).strength(this.config.centerStrength);
    const collide = collide_default((d) => d.radius + 14).strength(0.95).iterations(2);
    sim.force("link", linkForce).force("charge", chargeForce).force("centerX", centerX).force("centerY", centerY).force("collide", collide);
    sim.on("tick", () => {
      this.needsRedraw = true;
    });
    this.simulation = sim;
  }
  /** Handle config panel changes without rebuilding the entire view */
  handleConfigChange(newConfig) {
    const old = this.config;
    this.config = newConfig;
    const filterChanged = old.showFiles !== newConfig.showFiles || old.showObjects !== newConfig.showObjects || old.showWikiEdges !== newConfig.showWikiEdges || old.showObjectEdges !== newConfig.showObjectEdges || old.showOrphans !== newConfig.showOrphans || old.search !== newConfig.search || old.pathFilter !== newConfig.pathFilter || old.sourceFilter !== newConfig.sourceFilter;
    if (filterChanged) {
      this.rebuildSimData();
      return;
    }
    for (const n of this.simNodes) {
      n.radius = this.getNodeRadius(n);
    }
    if (this.simulation) {
      const link = this.simulation.force("link");
      link?.distance?.(newConfig.linkDistance);
      const charge = this.simulation.force("charge");
      charge?.strength?.(-newConfig.repelStrength);
      charge?.distanceMax?.(Math.max(newConfig.repelStrength * 2, 600));
      const cx = this.simulation.force("centerX");
      cx?.strength?.(newConfig.centerStrength);
      const cy = this.simulation.force("centerY");
      cy?.strength?.(newConfig.centerStrength);
      const collide = this.simulation.force("collide");
      collide?.radius?.((d) => d.radius + 14);
      this.simulation.alpha(Math.max(this.simulation.alpha(), 0.3)).restart();
    }
    this.updateHighlightTargets();
    this.needsRedraw = true;
  }
  /* ══════════════════════════════════════════════════════════════════
     Canvas Draw
     ══════════════════════════════════════════════════════════════════ */
  clear() {
    const ctx = this.ctx;
    const canvas = this.canvasEl;
    if (!ctx || !canvas)
      return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = colorToCSS(this.colorBg);
    ctx.globalAlpha = 1;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  draw() {
    if (!this.ctx || !this.canvasEl)
      return;
    this.refreshColors();
    this.clear();
    if (this.simNodes.length === 0)
      return;
    this.drawEdges();
    this.drawNodes();
    this.drawLabels();
  }
  drawEdges() {
    const ctx = this.ctx;
    const canvas = this.canvasEl;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const halfW = w / 2;
    const halfH = h / 2;
    if (this.simEdges.length === 0)
      return;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.lineCap = "round";
    for (const e of this.simEdges) {
      const s = e.source;
      const t = e.target;
      const sxw = s.x ?? 0;
      const syw = s.y ?? 0;
      const txw = t.x ?? 0;
      const tyw = t.y ?? 0;
      const sx = (sxw - this.camX) * this.camScale + halfW;
      const sy = (syw - this.camY) * this.camScale + halfH;
      const tx = (txw - this.camX) * this.camScale + halfW;
      const ty = (tyw - this.camY) * this.camScale + halfH;
      const isWiki = e.edgeType === "wiki";
      const col = isWiki ? this.colorEdgeWiki : this.colorEdgeObj;
      ctx.strokeStyle = colorToCSS(col);
      ctx.globalAlpha = e.alpha;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }
    ctx.restore();
  }
  drawNodes() {
    const ctx = this.ctx;
    const canvas = this.canvasEl;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const halfW = w / 2;
    const halfH = h / 2;
    const focus = this.hoveredNode || this.selectedNode;
    ctx.save();
    for (const n of this.simNodes) {
      const nxw = n.x ?? 0;
      const nyw = n.y ?? 0;
      const isOrphan = (n.connections || 0) === 0;
      let col;
      if (focus && n === focus) {
        col = isOrphan ? this.colorNodeFile : this.colorHighlight;
      } else {
        col = isOrphan ? this.colorNodeFile : this.colorNodeObject;
      }
      const cx = (nxw - this.camX) * this.camScale + halfW;
      const cy = (nyw - this.camY) * this.camScale + halfH;
      const maxR = Math.max(2, this.config.nodeMaxScreenRadius);
      const r = Math.min(maxR, n.radius * this.camScale);
      ctx.fillStyle = colorToCSS(col);
      ctx.globalAlpha = n.alpha;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  drawLabels() {
    const ctx = this.ctx;
    const canvas = this.canvasEl;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const halfW = w / 2;
    const halfH = h / 2;
    const labelOpacity = this.config.labelOpacity;
    const zoomFactor = this.camScale;
    const baseFontSize = 11;
    const fontSize = Math.max(8, Math.min(16, baseFontSize * Math.sqrt(zoomFactor)));
    const minZoom = Math.max(0, this.config.labelMinZoom);
    const zoomGate = zoomFactor >= minZoom;
    if (!zoomGate)
      return;
    ctx.save();
    ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = this.colorText;
    const placedRects = [];
    const intersects = (r1, r2) => r1.x < r2.x + r2.w && r1.x + r1.w > r2.x && r1.y < r2.y + r2.h && r1.y + r1.h > r2.y;
    const orderedNodes = [...this.simNodes].sort((a2, b) => {
      if (b.alpha !== a2.alpha)
        return b.alpha - a2.alpha;
      return (b.connections || 0) - (a2.connections || 0);
    });
    const maxW = Math.max(40, this.config.labelMaxWidth || 160);
    const ellipsis = "\u2026";
    for (const n of orderedNodes) {
      const nxw = n.x ?? 0;
      const nyw = n.y ?? 0;
      const sx = (nxw - this.camX) * this.camScale + halfW;
      const sy = (nyw - this.camY) * this.camScale + halfH;
      const screenY = sy + n.radius * this.camScale + 6;
      if (sx < -100 || sx > w + 100 || sy < -100 || sy > h + 100)
        continue;
      let alpha;
      if (n.targetAlpha < 0.1) {
        alpha = Math.min(labelOpacity, n.alpha) * 0.3;
      } else {
        alpha = labelOpacity * (n.alpha / Math.max(1e-4, n.targetAlpha));
        if (n === (this.hoveredNode || this.selectedNode))
          alpha = 1;
      }
      if (alpha < 0.01)
        continue;
      const full = n.label;
      let shown = full;
      if (ctx.measureText(full).width > maxW) {
        let lo = 0, hi = full.length;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          const candidate = full.slice(0, mid) + ellipsis;
          if (ctx.measureText(candidate).width <= maxW)
            lo = mid;
          else
            hi = mid - 1;
        }
        shown = full.slice(0, Math.max(0, lo)) + ellipsis;
      }
      const metrics = ctx.measureText(shown);
      const textW = metrics.width;
      const textH = fontSize;
      const pad = 3;
      const rect = {
        x: sx - textW / 2 - pad,
        y: screenY - pad,
        w: textW + pad * 2,
        h: textH + pad * 2
      };
      let collides = false;
      for (const r of placedRects) {
        if (intersects(rect, r)) {
          collides = true;
          break;
        }
      }
      const isFocus = n === (this.hoveredNode || this.selectedNode);
      if (!isFocus && collides)
        continue;
      ctx.globalAlpha = alpha;
      ctx.fillText(shown, sx, screenY);
      placedRects.push(rect);
    }
    ctx.restore();
  }
  /* ══════════════════════════════════════════════════════════════════
     Input Handlers
     ══════════════════════════════════════════════════════════════════ */
  setupInputHandlers() {
    const canvas = this.canvasEl;
    const container = this.contentEl;
    const updateTargetFromZoom = (t, sourceEvent) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const k = Math.max(0.03, Math.min(12, t.k));
      const x3 = t.x;
      const y3 = t.y;
      const camX = (w / 2 - x3) / k;
      const camY = (h / 2 - y3) / k;
      this.zoomTransform = t;
      this.targetCamScale = k;
      this.targetCamX = camX;
      this.targetCamY = camY;
      const se = sourceEvent;
      const isWheel = se?.type === "wheel";
      if (!isWheel) {
        this.camScale = this.targetCamScale;
        this.camX = this.targetCamX;
        this.camY = this.targetCamY;
      }
      this.needsRedraw = true;
    };
    if (!this.zoomBehavior) {
      this.zoomBehavior = zoom_default2().scaleExtent([0.03, 12]).filter((event) => {
        if (this.dragNode)
          return false;
        if (event?.type?.startsWith("mouse") && event.button !== 0)
          return false;
        return true;
      }).on("zoom", (event) => {
        if (this.isSyncingZoom)
          return;
        updateTargetFromZoom(event.transform, event.sourceEvent);
      });
      const sel = select_default2(canvas);
      sel.call(this.zoomBehavior);
      sel.on("dblclick.zoom", null);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const k = this.targetCamScale;
      const x3 = -this.targetCamX * k + w / 2;
      const y3 = -this.targetCamY * k + h / 2;
      this.isSyncingZoom = true;
      try {
        sel.call(this.zoomBehavior.transform, identity2.translate(x3, y3).scale(k));
      } finally {
        this.isSyncingZoom = false;
      }
    }
    let downX = 0;
    let downY = 0;
    let downNode = null;
    this._onMouseDown = (e) => {
      if (e.button !== 0)
        return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      downX = e.clientX;
      downY = e.clientY;
      downNode = this.hitTestNode(mx, my);
      if (downNode) {
        e.stopPropagation();
        this.dragNode = downNode;
        this.isDragging = false;
        downNode.fx = downNode.x ?? 0;
        downNode.fy = downNode.y ?? 0;
        this.simulation?.alphaTarget(0.3).restart();
      }
    };
    canvas.addEventListener("mousedown", this._onMouseDown, { capture: true });
    this._onMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      if (this.dragNode) {
        this.isDragging = true;
        const [wx, wy] = this.screenToWorld(mx, my);
        this.dragNode.fx = wx;
        this.dragNode.fy = wy;
        this.needsRedraw = true;
        return;
      }
      const node = this.hitTestNode(mx, my);
      if (node !== this.hoveredNode) {
        this.hoveredNode = node;
        canvas.style.cursor = node ? "pointer" : "default";
        this.updateHighlightTargets();
        if (node) {
          this.showTooltip(node, container);
        } else {
          this.hideTooltip(container);
        }
      } else if (node) {
        this.moveTooltip(e, container);
      }
    };
    canvas.addEventListener("mousemove", this._onMouseMove);
    this._onMouseUp = (e) => {
      const upDx = Math.abs(e.clientX - downX);
      const upDy = Math.abs(e.clientY - downY);
      const isClick = upDx < 3 && upDy < 3;
      if (this.dragNode) {
        const wasDragging = this.isDragging;
        this.dragNode.fx = null;
        this.dragNode.fy = null;
        if (!wasDragging) {
          const now2 = Date.now();
          const node = this.dragNode;
          if (this.lastClickId === node.id && now2 - this.lastClickTime < 300) {
            if (node.type === "object" && this.navigateToObject) {
              this.navigateToObject(node.filePath, node.startLine);
            } else if (node.type === "file" && this.navigateToFile) {
              this.navigateToFile(node.filePath);
            }
            this.lastClickTime = 0;
            this.lastClickId = "";
          } else {
            this.lastClickTime = now2;
            this.lastClickId = node.id;
            this.selectedNode = node;
            this.updateHighlightTargets();
            this.showInfoPanel(node, container);
          }
        }
        this.dragNode = null;
        this.isDragging = false;
        this.simulation?.alphaTarget(0);
        return;
      }
      if (isClick && !downNode) {
        this.selectedNode = null;
        this.updateHighlightTargets();
        this.removeInfoPanel(container);
      }
    };
    canvas.addEventListener("mouseup", this._onMouseUp);
    this._onDblClick = (e) => {
      e.preventDefault();
    };
    canvas.addEventListener("dblclick", this._onDblClick);
  }
  /* ── Tooltip ───────────────────────────────────────────────────── */
  showTooltip(node, container) {
    let tooltip = container.querySelector(".ol-tooltip");
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.className = "ol-tooltip";
      container.appendChild(tooltip);
    }
    tooltip.textContent = node.label;
    tooltip.style.display = "block";
  }
  moveTooltip(e, container) {
    const tooltip = container.querySelector(".ol-tooltip");
    if (!tooltip)
      return;
    const rect = container.getBoundingClientRect();
    tooltip.style.left = e.clientX - rect.left + 14 + "px";
    tooltip.style.top = e.clientY - rect.top - 10 + "px";
  }
  hideTooltip(container) {
    const tooltip = container.querySelector(".ol-tooltip");
    if (tooltip)
      tooltip.style.display = "none";
  }
  /* ── Info Panel ────────────────────────────────────────────────── */
  removeInfoPanel(container) {
    const panel = container.querySelector(".ol-info-panel");
    if (panel)
      panel.remove();
  }
  showInfoPanel(d, container) {
    this.removeInfoPanel(container);
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
};

// src/suggest.ts
var import_obsidian3 = require("obsidian");
var ObjectLinkSuggest = class extends import_obsidian3.EditorSuggest {
  constructor(app) {
    super(app);
    this.objects = [];
    this.setInstructions([
      { command: "\u2191\u2193", purpose: "to navigate" },
      { command: "Enter", purpose: "to insert" },
      { command: "Tab", purpose: "to insert" },
      { command: "Esc", purpose: "to dismiss" }
    ]);
    this.scope.register([], "Tab", (evt) => {
      const e = evt;
      e.preventDefault();
      e.stopPropagation();
      const chooser = this.chooser;
      if (chooser && typeof chooser.useSelectedItem === "function") {
        chooser.useSelectedItem(e);
        return true;
      }
      if (chooser && typeof chooser.onEnter === "function") {
        chooser.onEnter(e);
        return true;
      }
      return true;
    });
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
var objectLinkWrapperKeymap = import_view.keymap.of([
  {
    key: "{",
    run: (view) => {
      const sel = view.state.selection;
      if (sel.ranges.every((r) => r.empty))
        return false;
      const changes = [];
      const newRanges = [];
      for (const r of sel.ranges) {
        const text = view.state.doc.sliceString(r.from, r.to);
        const insert = `{{${text}}}`;
        changes.push({ from: r.from, to: r.to, insert });
        const start2 = r.from + 2;
        const end = start2 + text.length;
        newRanges.push(import_state.EditorSelection.range(start2, end));
      }
      view.dispatch({
        changes,
        selection: import_state.EditorSelection.create(newRanges, sel.mainIndex)
      });
      return true;
    }
  }
]);

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
    this.registerEditorExtension([objectLinkHighlighter, objectLinkWrapperKeymap]);
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
    this.addCommand({
      id: "open-under-cursor",
      name: "Open link under cursor",
      callback: () => this.openUnderCursor(),
      hotkeys: [{ modifiers: ["Mod"], key: "Enter" }]
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
  // ── Editor helpers ───────────────────────────────────────────────
  /**
   * Command: open the file/object "under the cursor".
   * - If cursor is inside a wikilink ([[...]]), opens that file.
   * - If cursor is inside an object link ({{...}}), opens the object's source file.
   */
  async openUnderCursor() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian4.MarkdownView);
    const editor = view?.editor;
    if (!editor) {
      new import_obsidian4.Notice("Object Links: No active editor");
      return;
    }
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    const ch = cursor.ch;
    const within = (open, close) => {
      const left = line.lastIndexOf(open, ch);
      if (left === -1)
        return null;
      const right = line.indexOf(close, left + open.length);
      if (right === -1)
        return null;
      if (ch < left + open.length || ch > right)
        return null;
      return line.substring(left + open.length, right);
    };
    const wik = within("[[", "]]");
    if (wik) {
      const target = wik.split("|")[0].trim();
      const dest = this.app.metadataCache.getFirstLinkpathDest(target, view?.file?.path || "");
      if (dest) {
        await this.app.workspace.getLeaf("tab").openFile(dest);
        return;
      }
      new import_obsidian4.Notice(`File not found: ${target}`);
      return;
    }
    const obj = within("{{", "}}");
    if (obj) {
      const target = obj.split("|")[0].trim();
      const found = this.objectIndex.get(target.toLowerCase());
      if (found) {
        await this.goToObject(found.filePath, found.startLine);
        return;
      }
      new import_obsidian4.Notice(`Object "${target}" not found`);
      return;
    }
    new import_obsidian4.Notice("No link under cursor");
  }
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL3BhcnNlci50cyIsICJzcmMvZ3JhcGgtZGF0YS50cyIsICJzcmMvZ3JhcGgtdmlldy50cyIsICJzcmMvc2V0dGluZ3MudHMiLCAibm9kZV9tb2R1bGVzL2QzLWRpc3BhdGNoL3NyYy9kaXNwYXRjaC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9uYW1lc3BhY2VzLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL25hbWVzcGFjZS5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9jcmVhdG9yLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdG9yLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9zZWxlY3QuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvYXJyYXkuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0b3JBbGwuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL3NlbGVjdEFsbC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9tYXRjaGVyLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9zZWxlY3RDaGlsZC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vc2VsZWN0Q2hpbGRyZW4uanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2ZpbHRlci5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vc3BhcnNlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9lbnRlci5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9jb25zdGFudC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vZGF0YS5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vZXhpdC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vam9pbi5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vbWVyZ2UuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL29yZGVyLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9zb3J0LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9jYWxsLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9ub2Rlcy5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vbm9kZS5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vc2l6ZS5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vZW1wdHkuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2VhY2guanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2F0dHIuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvd2luZG93LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9zdHlsZS5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vcHJvcGVydHkuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2NsYXNzZWQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL3RleHQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2h0bWwuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL3JhaXNlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9sb3dlci5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vYXBwZW5kLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9pbnNlcnQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL3JlbW92ZS5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vY2xvbmUuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2RhdHVtLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9vbi5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vZGlzcGF0Y2guanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2l0ZXJhdG9yLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9pbmRleC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3QuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc291cmNlRXZlbnQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvcG9pbnRlci5qcyIsICJub2RlX21vZHVsZXMvZDMtZHJhZy9zcmMvbm9ldmVudC5qcyIsICJub2RlX21vZHVsZXMvZDMtZHJhZy9zcmMvbm9kcmFnLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1jb2xvci9zcmMvZGVmaW5lLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1jb2xvci9zcmMvY29sb3IuanMiLCAibm9kZV9tb2R1bGVzL2QzLWludGVycG9sYXRlL3NyYy9iYXNpcy5qcyIsICJub2RlX21vZHVsZXMvZDMtaW50ZXJwb2xhdGUvc3JjL2Jhc2lzQ2xvc2VkLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1pbnRlcnBvbGF0ZS9zcmMvY29uc3RhbnQuanMiLCAibm9kZV9tb2R1bGVzL2QzLWludGVycG9sYXRlL3NyYy9jb2xvci5qcyIsICJub2RlX21vZHVsZXMvZDMtaW50ZXJwb2xhdGUvc3JjL3JnYi5qcyIsICJub2RlX21vZHVsZXMvZDMtaW50ZXJwb2xhdGUvc3JjL251bWJlci5qcyIsICJub2RlX21vZHVsZXMvZDMtaW50ZXJwb2xhdGUvc3JjL3N0cmluZy5qcyIsICJub2RlX21vZHVsZXMvZDMtaW50ZXJwb2xhdGUvc3JjL3RyYW5zZm9ybS9kZWNvbXBvc2UuanMiLCAibm9kZV9tb2R1bGVzL2QzLWludGVycG9sYXRlL3NyYy90cmFuc2Zvcm0vcGFyc2UuanMiLCAibm9kZV9tb2R1bGVzL2QzLWludGVycG9sYXRlL3NyYy90cmFuc2Zvcm0vaW5kZXguanMiLCAibm9kZV9tb2R1bGVzL2QzLWludGVycG9sYXRlL3NyYy96b29tLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10aW1lci9zcmMvdGltZXIuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRpbWVyL3NyYy90aW1lb3V0LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy90cmFuc2l0aW9uL3NjaGVkdWxlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy9pbnRlcnJ1cHQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3NlbGVjdGlvbi9pbnRlcnJ1cHQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vdHdlZW4uanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vaW50ZXJwb2xhdGUuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vYXR0ci5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvdHJhbnNpdGlvbi9hdHRyVHdlZW4uanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vZGVsYXkuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vZHVyYXRpb24uanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vZWFzZS5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvdHJhbnNpdGlvbi9lYXNlVmFyeWluZy5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvdHJhbnNpdGlvbi9maWx0ZXIuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vbWVyZ2UuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vb24uanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vcmVtb3ZlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy90cmFuc2l0aW9uL3NlbGVjdC5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvdHJhbnNpdGlvbi9zZWxlY3RBbGwuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vc2VsZWN0aW9uLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy90cmFuc2l0aW9uL3N0eWxlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy90cmFuc2l0aW9uL3N0eWxlVHdlZW4uanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vdGV4dC5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvdHJhbnNpdGlvbi90ZXh0VHdlZW4uanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vdHJhbnNpdGlvbi5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvdHJhbnNpdGlvbi9lbmQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vaW5kZXguanMiLCAibm9kZV9tb2R1bGVzL2QzLWVhc2Uvc3JjL2N1YmljLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy9zZWxlY3Rpb24vdHJhbnNpdGlvbi5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvc2VsZWN0aW9uL2luZGV4LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1icnVzaC9zcmMvYnJ1c2guanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9hZGQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9jb3Zlci5qcyIsICJub2RlX21vZHVsZXMvZDMtcXVhZHRyZWUvc3JjL2RhdGEuanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9leHRlbnQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9xdWFkLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1xdWFkdHJlZS9zcmMvZmluZC5qcyIsICJub2RlX21vZHVsZXMvZDMtcXVhZHRyZWUvc3JjL3JlbW92ZS5qcyIsICJub2RlX21vZHVsZXMvZDMtcXVhZHRyZWUvc3JjL3Jvb3QuanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9zaXplLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1xdWFkdHJlZS9zcmMvdmlzaXQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy92aXNpdEFmdGVyLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1xdWFkdHJlZS9zcmMveC5qcyIsICJub2RlX21vZHVsZXMvZDMtcXVhZHRyZWUvc3JjL3kuanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9xdWFkdHJlZS5qcyIsICJub2RlX21vZHVsZXMvZDMtZm9yY2Uvc3JjL2NvbnN0YW50LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1mb3JjZS9zcmMvamlnZ2xlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1mb3JjZS9zcmMvY29sbGlkZS5qcyIsICJub2RlX21vZHVsZXMvZDMtZm9yY2Uvc3JjL2xpbmsuanMiLCAibm9kZV9tb2R1bGVzL2QzLWZvcmNlL3NyYy9sY2cuanMiLCAibm9kZV9tb2R1bGVzL2QzLWZvcmNlL3NyYy9zaW11bGF0aW9uLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1mb3JjZS9zcmMvbWFueUJvZHkuanMiLCAibm9kZV9tb2R1bGVzL2QzLWZvcmNlL3NyYy94LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1mb3JjZS9zcmMveS5qcyIsICJub2RlX21vZHVsZXMvZDMtem9vbS9zcmMvY29uc3RhbnQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXpvb20vc3JjL2V2ZW50LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy16b29tL3NyYy90cmFuc2Zvcm0uanMiLCAibm9kZV9tb2R1bGVzL2QzLXpvb20vc3JjL25vZXZlbnQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXpvb20vc3JjL3pvb20uanMiLCAic3JjL3N1Z2dlc3QudHMiLCAic3JjL2VkaXRvci1leHRlbnNpb24udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7XG4gIE1hcmtkb3duUG9zdFByb2Nlc3NvckNvbnRleHQsXG4gIE1hcmtkb3duVmlldyxcbiAgTm90aWNlLFxuICBQbHVnaW4sXG4gIFRGaWxlLFxuICBXb3Jrc3BhY2VMZWFmLFxufSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB7XG4gIHBhcnNlTXVsdGlPYmplY3RGaWxlLFxuICBQYXJzZWRGaWxlLFxuICBQYXJzZWRPYmplY3QsXG4gIGdldFNlY29uZFByb3BlcnR5LFxufSBmcm9tIFwiLi9wYXJzZXJcIjtcbmltcG9ydCB7IGJ1aWxkR3JhcGgsIEdyYXBoRGF0YSwgVmF1bHRGaWxlIH0gZnJvbSBcIi4vZ3JhcGgtZGF0YVwiO1xuaW1wb3J0IHsgR3JhcGhWaWV3LCBWSUVXX1RZUEUgfSBmcm9tIFwiLi9ncmFwaC12aWV3XCI7XG5pbXBvcnQgeyBPYmplY3RMaW5rU3VnZ2VzdCB9IGZyb20gXCIuL3N1Z2dlc3RcIjtcbmltcG9ydCB7IG9iamVjdExpbmtIaWdobGlnaHRlciwgb2JqZWN0TGlua1dyYXBwZXJLZXltYXAgfSBmcm9tIFwiLi9lZGl0b3ItZXh0ZW5zaW9uXCI7XG5pbXBvcnQge1xuICBPYmplY3RMaW5rc1NldHRpbmdzLFxuICBERUZBVUxUX1NFVFRJTkdTLFxuICBPYmplY3RMaW5rc1NldHRpbmdUYWIsXG59IGZyb20gXCIuL3NldHRpbmdzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIE9iamVjdExpbmtzUGx1Z2luIGV4dGVuZHMgUGx1Z2luIHtcbiAgc2V0dGluZ3M6IE9iamVjdExpbmtzU2V0dGluZ3MgPSBERUZBVUxUX1NFVFRJTkdTO1xuICBwcml2YXRlIGdyYXBoRGF0YTogR3JhcGhEYXRhIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgc3VnZ2VzdFByb3ZpZGVyOiBPYmplY3RMaW5rU3VnZ2VzdCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGFsbE9iamVjdHM6IFBhcnNlZE9iamVjdFtdID0gW107XG4gIC8qKiBNYXA6IGxvd2VyY2FzZSBrZXkgdmFsdWUgLT4gUGFyc2VkT2JqZWN0IChmb3IgcXVpY2sgbG9va3VwcykgKi9cbiAgcHJpdmF0ZSBvYmplY3RJbmRleDogTWFwPHN0cmluZywgUGFyc2VkT2JqZWN0PiA9IG5ldyBNYXAoKTtcblxuICBhc3luYyBvbmxvYWQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gXHUyNTAwXHUyNTAwIExvYWQgc2V0dGluZ3MgXHUyNTAwXHUyNTAwXG4gICAgYXdhaXQgdGhpcy5sb2FkU2V0dGluZ3MoKTtcblxuICAgIC8vIFx1MjUwMFx1MjUwMCBTZXR0aW5ncyB0YWIgXHUyNTAwXHUyNTAwXG4gICAgdGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBPYmplY3RMaW5rc1NldHRpbmdUYWIodGhpcy5hcHAsIHRoaXMpKTtcblxuICAgIC8vIFx1MjUwMFx1MjUwMCBSZWdpc3RlciB2aWV3IFx1MjUwMFx1MjUwMFxuICAgIHRoaXMucmVnaXN0ZXJWaWV3KFZJRVdfVFlQRSwgKGxlYWYpID0+IHtcbiAgICAgIGNvbnN0IHZpZXcgPSBuZXcgR3JhcGhWaWV3KGxlYWYpO1xuICAgICAgdmlldy5uYXZpZ2F0ZVRvT2JqZWN0ID0gKGZpbGVQYXRoLCBzdGFydExpbmUpID0+XG4gICAgICAgIHRoaXMuZ29Ub09iamVjdChmaWxlUGF0aCwgc3RhcnRMaW5lKTtcbiAgICAgIHZpZXcubmF2aWdhdGVUb0ZpbGUgPSAoZmlsZVBhdGgpID0+IHRoaXMuZ29Ub0ZpbGUoZmlsZVBhdGgpO1xuICAgICAgcmV0dXJuIHZpZXc7XG4gICAgfSk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgUmVnaXN0ZXIgc3VnZ2VzdCBwcm92aWRlciBcdTI1MDBcdTI1MDBcbiAgICB0aGlzLnN1Z2dlc3RQcm92aWRlciA9IG5ldyBPYmplY3RMaW5rU3VnZ2VzdCh0aGlzLmFwcCk7XG4gICAgdGhpcy5yZWdpc3RlckVkaXRvclN1Z2dlc3QodGhpcy5zdWdnZXN0UHJvdmlkZXIpO1xuXG4gICAgLy8gXHUyNTAwXHUyNTAwIFJlZ2lzdGVyIENNNiBlZGl0b3IgZXh0ZW5zaW9uczogaGlnaGxpZ2h0aW5nICsgc2VsZWN0aW9uIHdyYXBwZXIgXHUyNTAwXHUyNTAwXG4gICAgdGhpcy5yZWdpc3RlckVkaXRvckV4dGVuc2lvbihbb2JqZWN0TGlua0hpZ2hsaWdodGVyLCBvYmplY3RMaW5rV3JhcHBlcktleW1hcF0pO1xuXG4gICAgLy8gXHUyNTAwXHUyNTAwIE1hcmtkb3duIHBvc3QtcHJvY2Vzc29yOiByZW5kZXIge3tvYmplY3R9fSBhcyBjbGlja2FibGUgbGlua3MgXHUyNTAwXHUyNTAwXG4gICAgdGhpcy5yZWdpc3Rlck1hcmtkb3duUG9zdFByb2Nlc3NvcihcbiAgICAgIChlbDogSFRNTEVsZW1lbnQsIGN0eDogTWFya2Rvd25Qb3N0UHJvY2Vzc29yQ29udGV4dCkgPT4ge1xuICAgICAgICB0aGlzLnByb2Nlc3NPYmplY3RMaW5rcyhlbCk7XG4gICAgICB9XG4gICAgKTtcblxuICAgIC8vIFx1MjUwMFx1MjUwMCBSaWJib24gaWNvbiBcdTI1MDBcdTI1MDBcbiAgICB0aGlzLmFkZFJpYmJvbkljb24oXCJnaXQtZm9ya1wiLCBcIk9wZW4gT2JqZWN0IExpbmtzXCIsICgpID0+IHtcbiAgICAgIHRoaXMuYWN0aXZhdGVWaWV3KCk7XG4gICAgfSk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgQ29tbWFuZHMgXHUyNTAwXHUyNTAwXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcIm9wZW4tb2wtZ3JhcGhcIixcbiAgICAgIG5hbWU6IFwiT3BlbiBncmFwaCB2aWV3XCIsXG4gICAgICBjYWxsYmFjazogKCkgPT4gdGhpcy5hY3RpdmF0ZVZpZXcoKSxcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJyZWZyZXNoLW9sLWdyYXBoXCIsXG4gICAgICBuYW1lOiBcIlJlZnJlc2ggZ3JhcGhcIixcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB0aGlzLmZ1bGxSZWZyZXNoKCksXG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwib3Blbi11bmRlci1jdXJzb3JcIixcbiAgICAgIG5hbWU6IFwiT3BlbiBsaW5rIHVuZGVyIGN1cnNvclwiLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHRoaXMub3BlblVuZGVyQ3Vyc29yKCksXG4gICAgICBob3RrZXlzOiBbeyBtb2RpZmllcnM6IFtcIk1vZFwiXSwga2V5OiBcIkVudGVyXCIgfV0sXG4gICAgfSk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgSW5pdGlhbCBzY2FuIG9uIGxheW91dCByZWFkeSBcdTI1MDBcdTI1MDBcbiAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiB7XG4gICAgICB0aGlzLmZ1bGxSZWZyZXNoKCk7XG4gICAgfSk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgRmlsZSB3YXRjaGVycyBcdTI1MDBcdTI1MDBcbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICB0aGlzLmFwcC52YXVsdC5vbihcIm1vZGlmeVwiLCAoZmlsZSkgPT4ge1xuICAgICAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGaWxlICYmIGZpbGUuZXh0ZW5zaW9uID09PSBcIm1kXCIpIHtcbiAgICAgICAgICB0aGlzLmRlYm91bmNlUmVmcmVzaCgpO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICk7XG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAudmF1bHQub24oXCJjcmVhdGVcIiwgKGZpbGUpID0+IHtcbiAgICAgICAgaWYgKGZpbGUgaW5zdGFuY2VvZiBURmlsZSAmJiBmaWxlLmV4dGVuc2lvbiA9PT0gXCJtZFwiKSB7XG4gICAgICAgICAgdGhpcy5kZWJvdW5jZVJlZnJlc2goKTtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICApO1xuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLnZhdWx0Lm9uKFwiZGVsZXRlXCIsIChmaWxlKSA9PiB7XG4gICAgICAgIGlmIChmaWxlIGluc3RhbmNlb2YgVEZpbGUgJiYgZmlsZS5leHRlbnNpb24gPT09IFwibWRcIikge1xuICAgICAgICAgIHRoaXMuZGVib3VuY2VSZWZyZXNoKCk7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgKTtcbiAgfVxuXG4gIG9udW5sb2FkKCk6IHZvaWQge1xuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5kZXRhY2hMZWF2ZXNPZlR5cGUoVklFV19UWVBFKTtcbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCBEZWJvdW5jZSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBwcml2YXRlIGRlYm91bmNlVGltZXI6IFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbCA9IG51bGw7XG5cbiAgcHJpdmF0ZSBkZWJvdW5jZVJlZnJlc2goKTogdm9pZCB7XG4gICAgaWYgKHRoaXMuZGVib3VuY2VUaW1lcikgY2xlYXJUaW1lb3V0KHRoaXMuZGVib3VuY2VUaW1lcik7XG4gICAgdGhpcy5kZWJvdW5jZVRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB0aGlzLmZ1bGxSZWZyZXNoKCksIDgwMCk7XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgRnVsbCByZWZyZXNoOiBzY2FuLCBjaGVjayBkdXBlcywgdXBkYXRlIHZpZXdzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG4gIHByaXZhdGUgYXN5bmMgZnVsbFJlZnJlc2goKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgcGFyc2VkRmlsZXMgPSBhd2FpdCB0aGlzLnNjYW5NdWx0aU9iamVjdEZpbGVzKCk7XG4gICAgY29uc3QgYWxsRmlsZXMgPSBhd2FpdCB0aGlzLmdldEFsbFZhdWx0RmlsZXMoKTtcblxuICAgIC8vIEJ1aWxkIGluZGV4ICsgZGlzYW1iaWd1YXRlIGR1cGxpY2F0ZSBrZXkgdmFsdWVzXG4gICAgdGhpcy5hbGxPYmplY3RzID0gW107XG4gICAgdGhpcy5vYmplY3RJbmRleCA9IG5ldyBNYXAoKTtcbiAgICBjb25zdCBpZER1cGVzOiBzdHJpbmdbXSA9IFtdO1xuICAgIC8qKiBUcmFjayBpZHMgcGVyIGZpbGUgdG8gZGV0ZWN0IGR1cGxpY2F0ZSBpZHMgd2l0aGluIGEgZmlsZSAqL1xuICAgIGNvbnN0IGZpbGVJZFNldHM6IE1hcDxzdHJpbmcsIE1hcDxudW1iZXIsIHN0cmluZz4+ID0gbmV3IE1hcCgpO1xuICAgIC8qKiBNYXAgZnJvbSBwYXJzZWQgZmlsZSBwYXRoIHRvIGl0cyBrZXlQcm9wZXJ0eSBuYW1lICovXG4gICAgY29uc3QgZmlsZUtleVByb3BzOiBNYXA8c3RyaW5nLCBzdHJpbmc+ID0gbmV3IE1hcCgpO1xuXG4gICAgLy8gXHUyNTAwXHUyNTAwIFBoYXNlIDE6IENvbGxlY3QgYWxsIG9iamVjdHMgYW5kIGNoZWNrIGlkIGR1cGxpY2F0ZXMgXHUyNTAwXHUyNTAwXG4gICAgZm9yIChjb25zdCBmaWxlIG9mIHBhcnNlZEZpbGVzKSB7XG4gICAgICBmaWxlS2V5UHJvcHMuc2V0KGZpbGUuZmlsZVBhdGgsIGZpbGUua2V5UHJvcGVydHkpO1xuXG4gICAgICBpZiAoIWZpbGVJZFNldHMuaGFzKGZpbGUuZmlsZVBhdGgpKSB7XG4gICAgICAgIGZpbGVJZFNldHMuc2V0KGZpbGUuZmlsZVBhdGgsIG5ldyBNYXAoKSk7XG4gICAgICB9XG4gICAgICBjb25zdCBpZFNldCA9IGZpbGVJZFNldHMuZ2V0KGZpbGUuZmlsZVBhdGgpITtcblxuICAgICAgZm9yIChjb25zdCBvYmogb2YgZmlsZS5vYmplY3RzKSB7XG4gICAgICAgIHRoaXMuYWxsT2JqZWN0cy5wdXNoKG9iaik7XG5cbiAgICAgICAgLy8gQ2hlY2sgZHVwbGljYXRlIGlkcyB3aXRoaW4gdGhlIHNhbWUgZmlsZVxuICAgICAgICBpZiAoaWRTZXQuaGFzKG9iai5pZCkpIHtcbiAgICAgICAgICBpZER1cGVzLnB1c2goXG4gICAgICAgICAgICBgaWQgJHtvYmouaWR9IGR1cGxpY2F0ZWQgaW4gJHtvYmouZmlsZUxhYmVsfTogXCIke2lkU2V0LmdldChvYmouaWQpfVwiIGFuZCBcIiR7b2JqLmtleVZhbHVlfVwiYFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgaWRTZXQuc2V0KG9iai5pZCwgb2JqLmtleVZhbHVlKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgUGhhc2UgMjogRGlzYW1iaWd1YXRlIGR1cGxpY2F0ZSBrZXlWYWx1ZXMgXHUyNTAwXHUyNTAwXG4gICAgLy8gR3JvdXAgb2JqZWN0cyBieSBsb3dlcmNhc2Uga2V5VmFsdWVcbiAgICBjb25zdCBrZXlHcm91cHMgPSBuZXcgTWFwPHN0cmluZywgUGFyc2VkT2JqZWN0W10+KCk7XG4gICAgZm9yIChjb25zdCBvYmogb2YgdGhpcy5hbGxPYmplY3RzKSB7XG4gICAgICBjb25zdCBrID0gb2JqLmtleVZhbHVlLnRvTG93ZXJDYXNlKCk7XG4gICAgICBpZiAoIWtleUdyb3Vwcy5oYXMoaykpIGtleUdyb3Vwcy5zZXQoaywgW10pO1xuICAgICAga2V5R3JvdXBzLmdldChrKSEucHVzaChvYmopO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgWywgZ3JvdXBdIG9mIGtleUdyb3Vwcykge1xuICAgICAgaWYgKGdyb3VwLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICAvLyBVbmlxdWUga2V5OiBkaXNwbGF5S2V5ID0ga2V5VmFsdWUgKGFscmVhZHkgdGhlIGRlZmF1bHQpXG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICAvLyBNdWx0aXBsZSBvYmplY3RzIHNoYXJlIHRoZSBzYW1lIGtleVZhbHVlIC0tIGRpc2FtYmlndWF0ZVxuICAgICAgLy8gU3RlcCAxOiBUcnkgXCJrZXlWYWx1ZSAoZmlsZUxhYmVsKVwiXG4gICAgICBjb25zdCBmaWxlR3JvdXBzID0gbmV3IE1hcDxzdHJpbmcsIFBhcnNlZE9iamVjdFtdPigpO1xuICAgICAgZm9yIChjb25zdCBvYmogb2YgZ3JvdXApIHtcbiAgICAgICAgY29uc3QgZmsgPSBvYmouZmlsZUxhYmVsLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIGlmICghZmlsZUdyb3Vwcy5oYXMoZmspKSBmaWxlR3JvdXBzLnNldChmaywgW10pO1xuICAgICAgICBmaWxlR3JvdXBzLmdldChmaykhLnB1c2gob2JqKTtcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBbLCBmR3JvdXBdIG9mIGZpbGVHcm91cHMpIHtcbiAgICAgICAgaWYgKGZHcm91cC5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgICAvLyBrZXkgKyBmaWxlbmFtZSBpcyB1bmlxdWVcbiAgICAgICAgICBmR3JvdXBbMF0uZGlzcGxheUtleSA9IGAke2ZHcm91cFswXS5rZXlWYWx1ZX0gKCR7Zkdyb3VwWzBdLmZpbGVMYWJlbH0pYDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBrZXkgKyBmaWxlbmFtZSBzdGlsbCBjb2xsaWRlczogdXNlIHNlY29uZCBwcm9wZXJ0eVxuICAgICAgICAgIGZvciAoY29uc3Qgb2JqIG9mIGZHcm91cCkge1xuICAgICAgICAgICAgY29uc3Qga2V5UHJvcCA9IGZpbGVLZXlQcm9wcy5nZXQob2JqLmZpbGVQYXRoKSB8fCBcIlwiO1xuICAgICAgICAgICAgY29uc3Qgc2Vjb25kVmFsID0gZ2V0U2Vjb25kUHJvcGVydHkob2JqLCBrZXlQcm9wKTtcbiAgICAgICAgICAgIGlmIChzZWNvbmRWYWwpIHtcbiAgICAgICAgICAgICAgb2JqLmRpc3BsYXlLZXkgPSBgJHtvYmoua2V5VmFsdWV9ICgke3NlY29uZFZhbH0pYDtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIC8vIEZhbGxiYWNrOiB1c2UgaWRcbiAgICAgICAgICAgICAgb2JqLmRpc3BsYXlLZXkgPSBgJHtvYmoua2V5VmFsdWV9ICgjJHtvYmouaWR9KWA7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gXHUyNTAwXHUyNTAwIFBoYXNlIDM6IEJ1aWxkIG9iamVjdEluZGV4IHVzaW5nIGRpc3BsYXlLZXkgXHUyNTAwXHUyNTAwXG4gICAgLy8gUmVnaXN0ZXIgZWFjaCBvYmplY3QgYnkgaXRzIGRpc3BsYXlLZXkgKHByaW1hcnkgbG9va3VwKVxuICAgIGZvciAoY29uc3Qgb2JqIG9mIHRoaXMuYWxsT2JqZWN0cykge1xuICAgICAgdGhpcy5vYmplY3RJbmRleC5zZXQob2JqLmRpc3BsYXlLZXkudG9Mb3dlckNhc2UoKSwgb2JqKTtcbiAgICB9XG4gICAgLy8gQWxzbyByZWdpc3RlciBieSBwbGFpbiBrZXlWYWx1ZSBmb3Igbm9uLWFtYmlndW91cyBrZXlzXG4gICAgLy8gKHNvIGV4aXN0aW5nIHt7a2V5VmFsdWV9fSBsaW5rcyBzdGlsbCByZXNvbHZlIHdoZW4gdGhlcmUncyBubyBjb2xsaXNpb24pXG4gICAgZm9yIChjb25zdCBbaywgZ3JvdXBdIG9mIGtleUdyb3Vwcykge1xuICAgICAgaWYgKGdyb3VwLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICB0aGlzLm9iamVjdEluZGV4LnNldChrLCBncm91cFswXSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gV2FybiBvbiBkdXBsaWNhdGUgaWRzXG4gICAgaWYgKGlkRHVwZXMubGVuZ3RoID4gMCkge1xuICAgICAgbmV3IE5vdGljZShcbiAgICAgICAgYE9iamVjdCBMaW5rczogRHVwbGljYXRlIElEcyBmb3VuZDpcXG4ke2lkRHVwZXMuam9pbihcIlxcblwiKX1gLFxuICAgICAgICA4MDAwXG4gICAgICApO1xuICAgIH1cblxuICAgIC8vIFVwZGF0ZSBzdWdnZXN0IHByb3ZpZGVyXG4gICAgaWYgKHRoaXMuc3VnZ2VzdFByb3ZpZGVyKSB7XG4gICAgICB0aGlzLnN1Z2dlc3RQcm92aWRlci5zZXRPYmplY3RzKHRoaXMuYWxsT2JqZWN0cyk7XG4gICAgfVxuXG4gICAgLy8gQnVpbGQgZ3JhcGhcbiAgICB0aGlzLmdyYXBoRGF0YSA9IGJ1aWxkR3JhcGgocGFyc2VkRmlsZXMsIGFsbEZpbGVzKTtcblxuICAgIC8vIFVwZGF0ZSBvcGVuIGdyYXBoIHZpZXdzXG4gICAgdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShWSUVXX1RZUEUpLmZvckVhY2goKGxlYWYpID0+IHtcbiAgICAgIGlmIChsZWFmLnZpZXcgaW5zdGFuY2VvZiBHcmFwaFZpZXcpIHtcbiAgICAgICAgbGVhZi52aWV3Lm5hdmlnYXRlVG9PYmplY3QgPSAoZnAsIHNsKSA9PiB0aGlzLmdvVG9PYmplY3QoZnAsIHNsKTtcbiAgICAgICAgbGVhZi52aWV3Lm5hdmlnYXRlVG9GaWxlID0gKGZwKSA9PiB0aGlzLmdvVG9GaWxlKGZwKTtcbiAgICAgICAgbGVhZi52aWV3LnNldEdyYXBoRGF0YSh0aGlzLmdyYXBoRGF0YSEpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIFZhdWx0IHNjYW5uaW5nIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG4gIHByaXZhdGUgYXN5bmMgc2Nhbk11bHRpT2JqZWN0RmlsZXMoKTogUHJvbWlzZTxQYXJzZWRGaWxlW10+IHtcbiAgICBjb25zdCBmaWxlcyA9IHRoaXMuYXBwLnZhdWx0LmdldE1hcmtkb3duRmlsZXMoKTtcbiAgICBjb25zdCBwYXJzZWQ6IFBhcnNlZEZpbGVbXSA9IFtdO1xuICAgIGNvbnN0IHRhZyA9IHRoaXMuc2V0dGluZ3Mub2JqZWN0RmlsZVRhZy50cmltKCk7XG5cbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5yZWFkKGZpbGUpO1xuXG4gICAgICAgIC8vIElmIGEgdGFnIGlzIGNvbmZpZ3VyZWQsIG9ubHkgcGFyc2UgZmlsZXMgd2hvc2UgZnJvbnRtYXR0ZXJcbiAgICAgICAgLy8gaW5jbHVkZXMgdGhhdCB0YWcuXG4gICAgICAgIGlmICh0YWcpIHtcbiAgICAgICAgICBpZiAoIXRoaXMuaGFzRmlsZVRhZyhjb250ZW50LCB0YWcpKSBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHBhcnNlTXVsdGlPYmplY3RGaWxlKGNvbnRlbnQsIGZpbGUucGF0aCk7XG4gICAgICAgIGlmIChyZXN1bHQpIHBhcnNlZC5wdXNoKHJlc3VsdCk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLyogc2tpcCAqL1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcGFyc2VkO1xuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrIGlmIGEgbWFya2Rvd24gZmlsZSBjb250YWlucyB0aGUgZ2l2ZW4gdGFnLlxuICAgKiBTdXBwb3J0czpcbiAgICogIDEuIEJhcmUgYCN0YWdgIGFueXdoZXJlIGluIHRoZSBmaWxlIChlLmcuIGAjb2JqZWN0LWxpbmtzYCBvbiBsaW5lIDEpXG4gICAqICAyLiBZQU1MIGZyb250bWF0dGVyIGB0YWdzOiBbYSwgYl1gLCBgdGFnczogYWAsIG9yIGxpc3QgZm9ybVxuICAgKiAgMy4gVGhlIGB0YWc6YCBhbGlhcyB1c2VkIGJ5IHNvbWUgT2JzaWRpYW4gc2V0dXBzXG4gICAqL1xuICBwcml2YXRlIGhhc0ZpbGVUYWcoY29udGVudDogc3RyaW5nLCB0YWc6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IGxvd2VyVGFnID0gdGFnLnRvTG93ZXJDYXNlKCk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgMS4gQmFyZSAjdGFnIGFueXdoZXJlIGluIHRoZSBjb250ZW50IFx1MjUwMFx1MjUwMFxuICAgIC8vIE1hdGNoICN0YWcgYXMgYSB3aG9sZSB3b3JkIChub3QgaW5zaWRlIGFub3RoZXIgd29yZClcbiAgICBjb25zdCBiYXJlVGFnUmVnZXggPSBuZXcgUmVnRXhwKFxuICAgICAgYCg/Ol58XFxcXHMpIyR7dGFnLnJlcGxhY2UoL1suKis/XiR7fSgpfFtcXF1cXFxcXS9nLCBcIlxcXFwkJlwiKX0oPzpcXFxcc3wkKWAsXG4gICAgICBcImltXCJcbiAgICApO1xuICAgIGlmIChiYXJlVGFnUmVnZXgudGVzdChjb250ZW50KSkgcmV0dXJuIHRydWU7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgMi4gWUFNTCBmcm9udG1hdHRlciB0YWdzIFx1MjUwMFx1MjUwMFxuICAgIGlmICghY29udGVudC5zdGFydHNXaXRoKFwiLS0tXCIpKSByZXR1cm4gZmFsc2U7XG4gICAgY29uc3QgZW5kSWR4ID0gY29udGVudC5pbmRleE9mKFwiXFxuLS0tXCIsIDMpO1xuICAgIGlmIChlbmRJZHggPT09IC0xKSByZXR1cm4gZmFsc2U7XG4gICAgY29uc3QgZnJvbnRtYXR0ZXIgPSBjb250ZW50LnN1YnN0cmluZygzLCBlbmRJZHgpO1xuXG4gICAgLy8gTWF0Y2ggXCJ0YWdzOlwiIG9yIFwidGFnOlwiIGxpbmVzIHdpdGggaW5saW5lIHZhbHVlc1xuICAgIGZvciAoY29uc3QgbGluZSBvZiBmcm9udG1hdHRlci5zcGxpdChcIlxcblwiKSkge1xuICAgICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgICAgY29uc3QgbWF0Y2ggPSB0cmltbWVkLm1hdGNoKC9edGFncz9cXHMqOlxccyooLispJC9pKTtcbiAgICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlO1xuXG4gICAgICBsZXQgdmFsdWUgPSBtYXRjaFsxXS50cmltKCk7XG5cbiAgICAgIC8vIEFycmF5IGZvcm06IFthLCBiLCBjXVxuICAgICAgaWYgKHZhbHVlLnN0YXJ0c1dpdGgoXCJbXCIpICYmIHZhbHVlLmVuZHNXaXRoKFwiXVwiKSkge1xuICAgICAgICB2YWx1ZSA9IHZhbHVlLnNsaWNlKDEsIC0xKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgdGFncyA9IHZhbHVlLnNwbGl0KFwiLFwiKS5tYXAoKHQpID0+IHQudHJpbSgpLnRvTG93ZXJDYXNlKCkpO1xuICAgICAgaWYgKHRhZ3MuaW5jbHVkZXMobG93ZXJUYWcpKSByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBZQU1MIGxpc3QgZm9ybTpcbiAgICAvLyAgIHRhZ3M6XG4gICAgLy8gICAgIC0gdGFnMVxuICAgIC8vICAgICAtIHRhZzJcbiAgICBjb25zdCBsaXN0UmVnZXggPSAvXnRhZ3M/XFxzKjpcXHMqJC9pbTtcbiAgICBjb25zdCBsaXN0TWF0Y2ggPSBsaXN0UmVnZXguZXhlYyhmcm9udG1hdHRlcik7XG4gICAgaWYgKGxpc3RNYXRjaCkge1xuICAgICAgY29uc3QgYWZ0ZXJUYWdzID0gZnJvbnRtYXR0ZXIuc3Vic3RyaW5nKFxuICAgICAgICBsaXN0TWF0Y2guaW5kZXggKyBsaXN0TWF0Y2hbMF0ubGVuZ3RoXG4gICAgICApO1xuICAgICAgZm9yIChjb25zdCBsaW5lIG9mIGFmdGVyVGFncy5zcGxpdChcIlxcblwiKSkge1xuICAgICAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gICAgICAgIGlmICh0cmltbWVkLnN0YXJ0c1dpdGgoXCItIFwiKSkge1xuICAgICAgICAgIGNvbnN0IHRhZ1ZhbCA9IHRyaW1tZWQuc3Vic3RyaW5nKDIpLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICAgIGlmICh0YWdWYWwgPT09IGxvd2VyVGFnKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIGlmICh0cmltbWVkLmxlbmd0aCA+IDAgJiYgIXRyaW1tZWQuc3RhcnRzV2l0aChcIiNcIikpIHtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZ2V0QWxsVmF1bHRGaWxlcygpOiBQcm9taXNlPFZhdWx0RmlsZVtdPiB7XG4gICAgY29uc3QgZmlsZXMgPSB0aGlzLmFwcC52YXVsdC5nZXRNYXJrZG93bkZpbGVzKCk7XG4gICAgY29uc3QgcmVzdWx0OiBWYXVsdEZpbGVbXSA9IFtdO1xuICAgIGZvciAoY29uc3QgZmlsZSBvZiBmaWxlcykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSk7XG4gICAgICAgIHJlc3VsdC5wdXNoKHsgcGF0aDogZmlsZS5wYXRoLCBiYXNlbmFtZTogZmlsZS5iYXNlbmFtZSwgY29udGVudCB9KTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvKiBza2lwICovXG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgTWFya2Rvd24gcG9zdC1wcm9jZXNzb3IgZm9yIHt7b2JqZWN0fX0gbGlua3MgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbiAgcHJpdmF0ZSBwcm9jZXNzT2JqZWN0TGlua3MoZWw6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgLy8gV2FsayBhbGwgdGV4dCBub2RlcyBhbmQgcmVwbGFjZSB7ey4uLn19IHdpdGggY2xpY2thYmxlIHNwYW5zXG4gICAgY29uc3Qgd2Fsa2VyID0gZG9jdW1lbnQuY3JlYXRlVHJlZVdhbGtlcihlbCwgTm9kZUZpbHRlci5TSE9XX1RFWFQpO1xuICAgIGNvbnN0IG5vZGVzVG9SZXBsYWNlOiB7IG5vZGU6IFRleHQ7IG1hdGNoZXM6IFJlZ0V4cEV4ZWNBcnJheVtdIH1bXSA9IFtdO1xuXG4gICAgbGV0IHRleHROb2RlOiBUZXh0IHwgbnVsbDtcbiAgICB3aGlsZSAoKHRleHROb2RlID0gd2Fsa2VyLm5leHROb2RlKCkgYXMgVGV4dCB8IG51bGwpKSB7XG4gICAgICBjb25zdCB0ZXh0ID0gdGV4dE5vZGUudGV4dENvbnRlbnQgfHwgXCJcIjtcbiAgICAgIGNvbnN0IHJlZ2V4ID0gL1xce1xceyhbXn1dKylcXH1cXH0vZztcbiAgICAgIGNvbnN0IG1hdGNoZXM6IFJlZ0V4cEV4ZWNBcnJheVtdID0gW107XG4gICAgICBsZXQgbWF0Y2g6IFJlZ0V4cEV4ZWNBcnJheSB8IG51bGw7XG4gICAgICB3aGlsZSAoKG1hdGNoID0gcmVnZXguZXhlYyh0ZXh0KSkgIT09IG51bGwpIHtcbiAgICAgICAgbWF0Y2hlcy5wdXNoKHsgLi4ubWF0Y2gsIGluZGV4OiBtYXRjaC5pbmRleCB9IGFzIFJlZ0V4cEV4ZWNBcnJheSk7XG4gICAgICB9XG4gICAgICBpZiAobWF0Y2hlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIG5vZGVzVG9SZXBsYWNlLnB1c2goeyBub2RlOiB0ZXh0Tm9kZSwgbWF0Y2hlcyB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHsgbm9kZSwgbWF0Y2hlcyB9IG9mIG5vZGVzVG9SZXBsYWNlKSB7XG4gICAgICBjb25zdCB0ZXh0ID0gbm9kZS50ZXh0Q29udGVudCB8fCBcIlwiO1xuICAgICAgY29uc3QgcGFyZW50ID0gbm9kZS5wYXJlbnROb2RlO1xuICAgICAgaWYgKCFwYXJlbnQpIGNvbnRpbnVlO1xuXG4gICAgICBjb25zdCBmcmFnID0gZG9jdW1lbnQuY3JlYXRlRG9jdW1lbnRGcmFnbWVudCgpO1xuICAgICAgbGV0IGxhc3RJbmRleCA9IDA7XG5cbiAgICAgIGZvciAoY29uc3QgbWF0Y2ggb2YgbWF0Y2hlcykge1xuICAgICAgICAvLyBUZXh0IGJlZm9yZSB0aGUgbWF0Y2hcbiAgICAgICAgaWYgKG1hdGNoLmluZGV4ID4gbGFzdEluZGV4KSB7XG4gICAgICAgICAgZnJhZy5hcHBlbmRDaGlsZChcbiAgICAgICAgICAgIGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKHRleHQuc3Vic3RyaW5nKGxhc3RJbmRleCwgbWF0Y2guaW5kZXgpKVxuICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBUaGUge3tsaW5rfX0gaXRzZWxmXG4gICAgICAgIGxldCBsaW5rVGFyZ2V0ID0gbWF0Y2hbMV07XG4gICAgICAgIGxldCBkaXNwbGF5VGV4dCA9IGxpbmtUYXJnZXQ7XG4gICAgICAgIGNvbnN0IHBpcGVJZHggPSBsaW5rVGFyZ2V0LmluZGV4T2YoXCJ8XCIpO1xuICAgICAgICBpZiAocGlwZUlkeCAhPT0gLTEpIHtcbiAgICAgICAgICBkaXNwbGF5VGV4dCA9IGxpbmtUYXJnZXQuc3Vic3RyaW5nKHBpcGVJZHggKyAxKS50cmltKCk7XG4gICAgICAgICAgbGlua1RhcmdldCA9IGxpbmtUYXJnZXQuc3Vic3RyaW5nKDAsIHBpcGVJZHgpLnRyaW0oKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNwYW4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcbiAgICAgICAgc3Bhbi5jbGFzc05hbWUgPSBcIm9sLWlubGluZS1saW5rXCI7XG4gICAgICAgIHNwYW4udGV4dENvbnRlbnQgPSBkaXNwbGF5VGV4dDtcbiAgICAgICAgc3Bhbi5zZXRBdHRyaWJ1dGUoXCJkYXRhLW9sLXRhcmdldFwiLCBsaW5rVGFyZ2V0KTtcblxuICAgICAgICBjb25zdCBvYmogPSB0aGlzLm9iamVjdEluZGV4LmdldChsaW5rVGFyZ2V0LnRvTG93ZXJDYXNlKCkpO1xuICAgICAgICBpZiAoIW9iaikge1xuICAgICAgICAgIHNwYW4uY2xhc3NMaXN0LmFkZChcIm9sLWlubGluZS1saW5rLXVucmVzb2x2ZWRcIik7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDbGljayAtPiBuYXZpZ2F0ZSB0byB0aGUgb2JqZWN0XG4gICAgICAgIHNwYW4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIChlKSA9PiB7XG4gICAgICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgICAgY29uc3QgdGFyZ2V0ID0gc3Bhbi5nZXRBdHRyaWJ1dGUoXCJkYXRhLW9sLXRhcmdldFwiKSB8fCBcIlwiO1xuICAgICAgICAgIGNvbnN0IHRhcmdldE9iaiA9IHRoaXMub2JqZWN0SW5kZXguZ2V0KHRhcmdldC50b0xvd2VyQ2FzZSgpKTtcbiAgICAgICAgICBpZiAodGFyZ2V0T2JqKSB7XG4gICAgICAgICAgICB0aGlzLmdvVG9PYmplY3QodGFyZ2V0T2JqLmZpbGVQYXRoLCB0YXJnZXRPYmouc3RhcnRMaW5lKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbmV3IE5vdGljZShgT2JqZWN0IFwiJHt0YXJnZXR9XCIgbm90IGZvdW5kYCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBIb3ZlciAtPiBzaG93IHRvb2x0aXAgd2l0aCBwcm9wZXJ0aWVzXG4gICAgICAgIHNwYW4uYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlZW50ZXJcIiwgKGUpID0+IHtcbiAgICAgICAgICBjb25zdCB0YXJnZXQgPSBzcGFuLmdldEF0dHJpYnV0ZShcImRhdGEtb2wtdGFyZ2V0XCIpIHx8IFwiXCI7XG4gICAgICAgICAgY29uc3QgdGFyZ2V0T2JqID0gdGhpcy5vYmplY3RJbmRleC5nZXQodGFyZ2V0LnRvTG93ZXJDYXNlKCkpO1xuICAgICAgICAgIGlmICh0YXJnZXRPYmopIHtcbiAgICAgICAgICAgIHRoaXMuc2hvd09iamVjdFBvcG92ZXIoc3BhbiwgdGFyZ2V0T2JqKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBzcGFuLmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZWxlYXZlXCIsICgpID0+IHtcbiAgICAgICAgICB0aGlzLmhpZGVPYmplY3RQb3BvdmVyKCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGZyYWcuYXBwZW5kQ2hpbGQoc3Bhbik7XG4gICAgICAgIGxhc3RJbmRleCA9IG1hdGNoLmluZGV4ICsgbWF0Y2hbMF0ubGVuZ3RoO1xuICAgICAgfVxuXG4gICAgICAvLyBSZW1haW5pbmcgdGV4dFxuICAgICAgaWYgKGxhc3RJbmRleCA8IHRleHQubGVuZ3RoKSB7XG4gICAgICAgIGZyYWcuYXBwZW5kQ2hpbGQoZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUodGV4dC5zdWJzdHJpbmcobGFzdEluZGV4KSkpO1xuICAgICAgfVxuXG4gICAgICBwYXJlbnQucmVwbGFjZUNoaWxkKGZyYWcsIG5vZGUpO1xuICAgIH1cbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCBPYmplY3QgcG9wb3ZlciBvbiBob3ZlciBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBwcml2YXRlIHBvcG92ZXJFbDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcblxuICBwcml2YXRlIHNob3dPYmplY3RQb3BvdmVyKGFuY2hvcjogSFRNTEVsZW1lbnQsIG9iajogUGFyc2VkT2JqZWN0KTogdm9pZCB7XG4gICAgdGhpcy5oaWRlT2JqZWN0UG9wb3ZlcigpO1xuXG4gICAgY29uc3QgcG9wID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICBwb3AuY2xhc3NOYW1lID0gXCJvbC1wb3BvdmVyXCI7XG5cbiAgICBjb25zdCB0aXRsZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgdGl0bGUuY2xhc3NOYW1lID0gXCJvbC1wb3BvdmVyLXRpdGxlXCI7XG4gICAgdGl0bGUudGV4dENvbnRlbnQgPSBvYmouZGlzcGxheUtleTtcbiAgICBwb3AuYXBwZW5kQ2hpbGQodGl0bGUpO1xuXG4gICAgY29uc3QgZmlsZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgZmlsZS5jbGFzc05hbWUgPSBcIm9sLXBvcG92ZXItZmlsZVwiO1xuICAgIGZpbGUudGV4dENvbnRlbnQgPSBvYmouZmlsZUxhYmVsO1xuICAgIHBvcC5hcHBlbmRDaGlsZChmaWxlKTtcblxuICAgIGZvciAoY29uc3QgW2ssIHZdIG9mIE9iamVjdC5lbnRyaWVzKG9iai5wcm9wZXJ0aWVzKSkge1xuICAgICAgY29uc3Qgcm93ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgIHJvdy5jbGFzc05hbWUgPSBcIm9sLXBvcG92ZXItcm93XCI7XG4gICAgICByb3cuaW5uZXJIVE1MID0gYDxzcGFuIGNsYXNzPVwib2wtcG9wb3Zlci1rZXlcIj4ke2t9PC9zcGFuPjxzcGFuIGNsYXNzPVwib2wtcG9wb3Zlci12YWxcIj4ke3Z9PC9zcGFuPmA7XG4gICAgICBwb3AuYXBwZW5kQ2hpbGQocm93KTtcbiAgICB9XG5cbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKHBvcCk7XG4gICAgdGhpcy5wb3BvdmVyRWwgPSBwb3A7XG5cbiAgICAvLyBQb3NpdGlvbiBiZWxvdyB0aGUgYW5jaG9yXG4gICAgY29uc3QgcmVjdCA9IGFuY2hvci5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICBwb3Auc3R5bGUudG9wID0gcmVjdC5ib3R0b20gKyA0ICsgXCJweFwiO1xuICAgIHBvcC5zdHlsZS5sZWZ0ID0gcmVjdC5sZWZ0ICsgXCJweFwiO1xuICB9XG5cbiAgcHJpdmF0ZSBoaWRlT2JqZWN0UG9wb3ZlcigpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5wb3BvdmVyRWwpIHtcbiAgICAgIHRoaXMucG9wb3ZlckVsLnJlbW92ZSgpO1xuICAgICAgdGhpcy5wb3BvdmVyRWwgPSBudWxsO1xuICAgIH1cbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCBOYXZpZ2F0aW9uIGhlbHBlcnMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbiAgcHJpdmF0ZSBhc3luYyBnb1RvT2JqZWN0KGZpbGVQYXRoOiBzdHJpbmcsIHN0YXJ0TGluZTogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChmaWxlUGF0aCk7XG4gICAgaWYgKCEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkge1xuICAgICAgbmV3IE5vdGljZShgRmlsZSBub3QgZm91bmQ6ICR7ZmlsZVBhdGh9YCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgbGVhZiA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRMZWFmKFwidGFiXCIpO1xuICAgIGF3YWl0IGxlYWYub3BlbkZpbGUoZmlsZSk7XG5cbiAgICAvLyBTY3JvbGwgdG8gdGhlIGxpbmVcbiAgICBjb25zdCB2aWV3ID0gbGVhZi52aWV3IGFzIGFueTtcbiAgICBpZiAodmlldyAmJiB2aWV3LmVkaXRvcikge1xuICAgICAgLy8gR2l2ZSB0aGUgZWRpdG9yIGEgbW9tZW50IHRvIGxvYWRcbiAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHZpZXcuZWRpdG9yLnNldEN1cnNvcih7IGxpbmU6IHN0YXJ0TGluZSwgY2g6IDAgfSk7XG4gICAgICAgICAgdmlldy5lZGl0b3Iuc2Nyb2xsSW50b1ZpZXcoXG4gICAgICAgICAgICB7IGZyb206IHsgbGluZTogc3RhcnRMaW5lLCBjaDogMCB9LCB0bzogeyBsaW5lOiBzdGFydExpbmUgKyA1LCBjaDogMCB9IH0sXG4gICAgICAgICAgICB0cnVlXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgLyogZWRpdG9yIG1pZ2h0IG5vdCBzdXBwb3J0IHRoaXMgKi9cbiAgICAgICAgfVxuICAgICAgfSwgMTAwKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGdvVG9GaWxlKGZpbGVQYXRoOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGZpbGVQYXRoKTtcbiAgICBpZiAoIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpKSB7XG4gICAgICBuZXcgTm90aWNlKGBGaWxlIG5vdCBmb3VuZDogJHtmaWxlUGF0aH1gKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgbGVhZiA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRMZWFmKFwidGFiXCIpO1xuICAgIGF3YWl0IGxlYWYub3BlbkZpbGUoZmlsZSk7XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgQWN0aXZhdGUgdmlldyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBhc3luYyBhY3RpdmF0ZVZpZXcoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgeyB3b3Jrc3BhY2UgfSA9IHRoaXMuYXBwO1xuXG4gICAgbGV0IGxlYWY6IFdvcmtzcGFjZUxlYWYgfCBudWxsID0gbnVsbDtcbiAgICBjb25zdCBsZWF2ZXMgPSB3b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFZJRVdfVFlQRSk7XG5cbiAgICBpZiAobGVhdmVzLmxlbmd0aCA+IDApIHtcbiAgICAgIGxlYWYgPSBsZWF2ZXNbMF07XG4gICAgfSBlbHNlIHtcbiAgICAgIGxlYWYgPSB3b3Jrc3BhY2UuZ2V0TGVhZihcInRhYlwiKTtcbiAgICAgIGF3YWl0IGxlYWYuc2V0Vmlld1N0YXRlKHsgdHlwZTogVklFV19UWVBFLCBhY3RpdmU6IHRydWUgfSk7XG4gICAgfVxuXG4gICAgd29ya3NwYWNlLnJldmVhbExlYWYobGVhZik7XG5cbiAgICAvLyBCdWlsZC9yZWZyZXNoIGdyYXBoXG4gICAgYXdhaXQgdGhpcy5mdWxsUmVmcmVzaCgpO1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIFNldHRpbmdzIHBlcnNpc3RlbmNlIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG4gIGFzeW5jIGxvYWRTZXR0aW5ncygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLnNldHRpbmdzID0gT2JqZWN0LmFzc2lnbih7fSwgREVGQVVMVF9TRVRUSU5HUywgYXdhaXQgdGhpcy5sb2FkRGF0YSgpKTtcbiAgfVxuXG4gIGFzeW5jIHNhdmVTZXR0aW5ncygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLnNhdmVEYXRhKHRoaXMuc2V0dGluZ3MpO1xuICAgIC8vIFJlLXNjYW4gYWZ0ZXIgc2V0dGluZ3MgY2hhbmdlICh0YWcgbWF5IGhhdmUgY2hhbmdlZClcbiAgICB0aGlzLmZ1bGxSZWZyZXNoKCk7XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgRWRpdG9yIGhlbHBlcnMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbiAgLyoqXG4gICAqIENvbW1hbmQ6IG9wZW4gdGhlIGZpbGUvb2JqZWN0IFwidW5kZXIgdGhlIGN1cnNvclwiLlxuICAgKiAtIElmIGN1cnNvciBpcyBpbnNpZGUgYSB3aWtpbGluayAoW1suLi5dXSksIG9wZW5zIHRoYXQgZmlsZS5cbiAgICogLSBJZiBjdXJzb3IgaXMgaW5zaWRlIGFuIG9iamVjdCBsaW5rICh7ey4uLn19KSwgb3BlbnMgdGhlIG9iamVjdCdzIHNvdXJjZSBmaWxlLlxuICAgKi9cbiAgYXN5bmMgb3BlblVuZGVyQ3Vyc29yKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHZpZXcgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShNYXJrZG93blZpZXcpO1xuICAgIGNvbnN0IGVkaXRvciA9IHZpZXc/LmVkaXRvcjtcbiAgICBpZiAoIWVkaXRvcikge1xuICAgICAgbmV3IE5vdGljZShcIk9iamVjdCBMaW5rczogTm8gYWN0aXZlIGVkaXRvclwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBjdXJzb3IgPSBlZGl0b3IuZ2V0Q3Vyc29yKCk7XG4gICAgY29uc3QgbGluZSA9IGVkaXRvci5nZXRMaW5lKGN1cnNvci5saW5lKSBhcyBzdHJpbmc7XG4gICAgY29uc3QgY2ggPSBjdXJzb3IuY2ggYXMgbnVtYmVyO1xuXG4gICAgY29uc3Qgd2l0aGluID0gKG9wZW46IHN0cmluZywgY2xvc2U6IHN0cmluZyk6IHN0cmluZyB8IG51bGwgPT4ge1xuICAgICAgY29uc3QgbGVmdCA9IGxpbmUubGFzdEluZGV4T2Yob3BlbiwgY2gpO1xuICAgICAgaWYgKGxlZnQgPT09IC0xKSByZXR1cm4gbnVsbDtcbiAgICAgIGNvbnN0IHJpZ2h0ID0gbGluZS5pbmRleE9mKGNsb3NlLCBsZWZ0ICsgb3Blbi5sZW5ndGgpO1xuICAgICAgaWYgKHJpZ2h0ID09PSAtMSkgcmV0dXJuIG51bGw7XG4gICAgICBpZiAoY2ggPCBsZWZ0ICsgb3Blbi5sZW5ndGggfHwgY2ggPiByaWdodCkgcmV0dXJuIG51bGw7XG4gICAgICByZXR1cm4gbGluZS5zdWJzdHJpbmcobGVmdCArIG9wZW4ubGVuZ3RoLCByaWdodCk7XG4gICAgfTtcblxuICAgIC8vIDEpIFdpa2lsaW5rOiBbW3RhcmdldHxhbGlhc11dXG4gICAgY29uc3Qgd2lrID0gd2l0aGluKFwiW1tcIiwgXCJdXVwiKTtcbiAgICBpZiAod2lrKSB7XG4gICAgICBjb25zdCB0YXJnZXQgPSB3aWsuc3BsaXQoXCJ8XCIpWzBdLnRyaW0oKTtcbiAgICAgIGNvbnN0IGRlc3QgPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpcnN0TGlua3BhdGhEZXN0KHRhcmdldCwgdmlldz8uZmlsZT8ucGF0aCB8fCBcIlwiKTtcbiAgICAgIGlmIChkZXN0KSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRMZWFmKFwidGFiXCIpLm9wZW5GaWxlKGRlc3QpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBuZXcgTm90aWNlKGBGaWxlIG5vdCBmb3VuZDogJHt0YXJnZXR9YCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gMikgT2JqZWN0IGxpbms6IHt7b2JqZWN0fGFsaWFzfX1cbiAgICBjb25zdCBvYmogPSB3aXRoaW4oXCJ7e1wiLCBcIn19XCIpO1xuICAgIGlmIChvYmopIHtcbiAgICAgIGNvbnN0IHRhcmdldCA9IG9iai5zcGxpdChcInxcIilbMF0udHJpbSgpO1xuICAgICAgY29uc3QgZm91bmQgPSB0aGlzLm9iamVjdEluZGV4LmdldCh0YXJnZXQudG9Mb3dlckNhc2UoKSk7XG4gICAgICBpZiAoZm91bmQpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5nb1RvT2JqZWN0KGZvdW5kLmZpbGVQYXRoLCBmb3VuZC5zdGFydExpbmUpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBuZXcgTm90aWNlKGBPYmplY3QgXCIke3RhcmdldH1cIiBub3QgZm91bmRgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBuZXcgTm90aWNlKFwiTm8gbGluayB1bmRlciBjdXJzb3JcIik7XG4gIH1cbn1cblxuIiwgIi8qKlxuICogUGFyc2VyIGZvciBtdWx0aS1vYmplY3QgbWFya2Rvd24gZmlsZXMuXG4gKlxuICogRm9ybWF0OlxuICogICBrZXk6IDxwcm9wZXJ0eV9uYW1lPlxuICpcbiAqICAgLS0tXG4gKlxuICogICBwcm9wMTogdmFsdWUxXG4gKiAgIHByb3AyOiB2YWx1ZTJcbiAqXG4gKiAgIC0tLVxuICpcbiAqICAgcHJvcDE6IHZhbHVlM1xuICogICBwcm9wMjogdmFsdWU0XG4gKi9cblxuZXhwb3J0IGludGVyZmFjZSBQYXJzZWRPYmplY3Qge1xuICAvKiogVGhlIHZhbHVlIG9mIHRoZSBrZXkgcHJvcGVydHkgLS0gdXNlZCBhcyB0aGUgbGlua2FibGUgbmFtZSAqL1xuICBrZXlWYWx1ZTogc3RyaW5nO1xuICAvKipcbiAgICogRGlzYW1iaWd1YXRlZCBpZGVudGlmaWVyIHVzZWQgZm9yIHt7fX0gbGlua3MsIGluZGV4IGxvb2t1cHMsIGFuZCBncmFwaCBsYWJlbHMuXG4gICAqIERlZmF1bHRzIHRvIGtleVZhbHVlLiBJZiBkdXBsaWNhdGVzIGV4aXN0OlxuICAgKiAgIC0gZGlmZmVyZW50IGZpbGVzOiBcImtleVZhbHVlIChmaWxlTGFiZWwpXCJcbiAgICogICAtIHNhbWUgZmlsZTogXCJrZXlWYWx1ZSAoc2Vjb25kUHJvcGVydHlWYWx1ZSlcIlxuICAgKiBTZXQgZHVyaW5nIGZ1bGxSZWZyZXNoKCkgaW4gbWFpbi50cy5cbiAgICovXG4gIGRpc3BsYXlLZXk6IHN0cmluZztcbiAgLyoqIE1hbmRhdG9yeSBudW1lcmljIGlkIGZvciB0aGlzIG9iamVjdCAqL1xuICBpZDogbnVtYmVyO1xuICAvKiogQWxsIHByb3BlcnRpZXMgb2YgdGhpcyBvYmplY3QgKGluc2VydGlvbi1vcmRlcmVkKSAqL1xuICBwcm9wZXJ0aWVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICAvKiogT3JkZXJlZCBsaXN0IG9mIHByb3BlcnR5IG5hbWVzIGFzIHRoZXkgYXBwZWFyIGluIHRoZSBmaWxlICovXG4gIHByb3BlcnR5T3JkZXI6IHN0cmluZ1tdO1xuICAvKiogU291cmNlIGZpbGUgcGF0aCAqL1xuICBmaWxlUGF0aDogc3RyaW5nO1xuICAvKiogU291cmNlIGZpbGUgYmFzZW5hbWUgKHdpdGhvdXQgZXh0ZW5zaW9uKSAqL1xuICBmaWxlTGFiZWw6IHN0cmluZztcbiAgLyoqIDAtaW5kZXhlZCBsaW5lIG51bWJlciB3aGVyZSB0aGlzIG9iamVjdCBibG9jayBzdGFydHMgaW4gdGhlIGZpbGUgKi9cbiAgc3RhcnRMaW5lOiBudW1iZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUGFyc2VkRmlsZSB7XG4gIC8qKiBUaGUgcHJvcGVydHkgbmFtZSB1c2VkIGFzIGtleSAqL1xuICBrZXlQcm9wZXJ0eTogc3RyaW5nO1xuICAvKiogQWxsIHBhcnNlZCBvYmplY3RzIGluIHRoaXMgZmlsZSAqL1xuICBvYmplY3RzOiBQYXJzZWRPYmplY3RbXTtcbiAgLyoqIFNvdXJjZSBmaWxlIHBhdGggKi9cbiAgZmlsZVBhdGg6IHN0cmluZztcbn1cblxuLyoqXG4gKiBQYXJzZSBhIG11bHRpLW9iamVjdCBtYXJrZG93biBmaWxlLlxuICogUmV0dXJucyBudWxsIGlmIHRoZSBmaWxlIGRvZXNuJ3QgZm9sbG93IHRoZSBleHBlY3RlZCBmb3JtYXQuXG4gKlxuICogU2tpcHMgWUFNTCBmcm9udG1hdHRlciAoaWYgcHJlc2VudCkgYmVmb3JlIGxvb2tpbmcgZm9yIHRoZVxuICogYGtleTogPHByb3BlcnR5PmAgaGVhZGVyIGFuZCBgLS0tYCBzZXBhcmF0ZWQgb2JqZWN0IGJsb2Nrcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTXVsdGlPYmplY3RGaWxlKFxuICBjb250ZW50OiBzdHJpbmcsXG4gIGZpbGVQYXRoOiBzdHJpbmdcbik6IFBhcnNlZEZpbGUgfCBudWxsIHtcbiAgY29uc3QgbGluZXMgPSBjb250ZW50LnNwbGl0KFwiXFxuXCIpO1xuXG4gIC8vIFNraXAgWUFNTCBmcm9udG1hdHRlciAob3BlbmluZyAtLS0gb24gZmlyc3QgbGluZSwgY2xvc2luZyAtLS0gbGF0ZXIpXG4gIGxldCBzdGFydElkeCA9IDA7XG4gIGlmIChsaW5lcy5sZW5ndGggPiAwICYmIGxpbmVzWzBdLnRyaW0oKSA9PT0gXCItLS1cIikge1xuICAgIGZvciAobGV0IGkgPSAxOyBpIDwgbGluZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGlmIChsaW5lc1tpXS50cmltKCkgPT09IFwiLS0tXCIpIHtcbiAgICAgICAgc3RhcnRJZHggPSBpICsgMTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gRmlyc3Qgbm9uLWVtcHR5IGxpbmUgKGFmdGVyIGZyb250bWF0dGVyKSBzaG91bGQgYmUgXCJrZXk6IDxwcm9wZXJ0eT5cIlxuICAvLyBCdXQgc2tpcCBiYXJlICN0YWcgbGluZXMgKGUuZy4gI29iamVjdC1saW5rcykgdGhhdCBwcmVjZWRlIGl0XG4gIGxldCBrZXlMaW5lID0gXCJcIjtcbiAgZm9yIChsZXQgaSA9IHN0YXJ0SWR4OyBpIDwgbGluZXMubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZXNbaV0udHJpbSgpO1xuICAgIGlmICh0cmltbWVkLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgLy8gU2tpcCBiYXJlIHRhZyBsaW5lcyBsaWtlIFwiI29iamVjdC1saW5rc1wiXG4gICAgaWYgKHRyaW1tZWQuc3RhcnRzV2l0aChcIiNcIikgJiYgIXRyaW1tZWQuaW5jbHVkZXMoXCI6XCIpKSBjb250aW51ZTtcbiAgICBrZXlMaW5lID0gdHJpbW1lZDtcbiAgICBicmVhaztcbiAgfVxuXG4gIGNvbnN0IGtleU1hdGNoID0ga2V5TGluZS5tYXRjaCgvXmtleTpcXHMqKC4rKSQvaSk7XG4gIGlmICgha2V5TWF0Y2gpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGtleVByb3BlcnR5ID0ga2V5TWF0Y2hbMV0udHJpbSgpO1xuICBjb25zdCBmaWxlTGFiZWwgPSBmaWxlUGF0aC5yZXBsYWNlKC9eLipcXC8vLCBcIlwiKS5yZXBsYWNlKC9cXC5tZCQvaSwgXCJcIik7XG5cbiAgLy8gV2FsayBsaW5lcyAoYWZ0ZXIgZnJvbnRtYXR0ZXIpIHRvIGZpbmQgLS0tIHNlcGFyYXRvcnMgYW5kIGJ1aWxkIG9iamVjdHNcbiAgY29uc3Qgb2JqZWN0czogUGFyc2VkT2JqZWN0W10gPSBbXTtcbiAgbGV0IGN1cnJlbnRCbG9jazogeyBsaW5lczogc3RyaW5nW107IHN0YXJ0TGluZTogbnVtYmVyIH0gfCBudWxsID0gbnVsbDtcbiAgbGV0IHBhc3NlZEZpcnN0U2VwYXJhdG9yID0gZmFsc2U7XG5cbiAgZm9yIChsZXQgaSA9IHN0YXJ0SWR4OyBpIDwgbGluZXMubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZXNbaV0udHJpbSgpO1xuXG4gICAgaWYgKHRyaW1tZWQgPT09IFwiLS0tXCIpIHtcbiAgICAgIC8vIEZsdXNoIHRoZSBjdXJyZW50IGJsb2NrIGlmIHdlIGhhdmUgb25lXG4gICAgICBpZiAoY3VycmVudEJsb2NrICYmIHBhc3NlZEZpcnN0U2VwYXJhdG9yKSB7XG4gICAgICAgIGNvbnN0IG9iaiA9IHBhcnNlQmxvY2soY3VycmVudEJsb2NrLCBrZXlQcm9wZXJ0eSwgZmlsZVBhdGgsIGZpbGVMYWJlbCk7XG4gICAgICAgIGlmIChvYmopIG9iamVjdHMucHVzaChvYmopO1xuICAgICAgfVxuICAgICAgcGFzc2VkRmlyc3RTZXBhcmF0b3IgPSB0cnVlO1xuICAgICAgY3VycmVudEJsb2NrID0geyBsaW5lczogW10sIHN0YXJ0TGluZTogaSArIDEgfTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChjdXJyZW50QmxvY2sgJiYgcGFzc2VkRmlyc3RTZXBhcmF0b3IpIHtcbiAgICAgIGN1cnJlbnRCbG9jay5saW5lcy5wdXNoKHRyaW1tZWQpO1xuICAgIH1cbiAgfVxuXG4gIC8vIEZsdXNoIHRoZSBsYXN0IGJsb2NrXG4gIGlmIChjdXJyZW50QmxvY2sgJiYgcGFzc2VkRmlyc3RTZXBhcmF0b3IpIHtcbiAgICBjb25zdCBvYmogPSBwYXJzZUJsb2NrKGN1cnJlbnRCbG9jaywga2V5UHJvcGVydHksIGZpbGVQYXRoLCBmaWxlTGFiZWwpO1xuICAgIGlmIChvYmopIG9iamVjdHMucHVzaChvYmopO1xuICB9XG5cbiAgaWYgKG9iamVjdHMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICByZXR1cm4geyBrZXlQcm9wZXJ0eSwgb2JqZWN0cywgZmlsZVBhdGggfTtcbn1cblxuZnVuY3Rpb24gcGFyc2VCbG9jayhcbiAgYmxvY2s6IHsgbGluZXM6IHN0cmluZ1tdOyBzdGFydExpbmU6IG51bWJlciB9LFxuICBrZXlQcm9wZXJ0eTogc3RyaW5nLFxuICBmaWxlUGF0aDogc3RyaW5nLFxuICBmaWxlTGFiZWw6IHN0cmluZ1xuKTogUGFyc2VkT2JqZWN0IHwgbnVsbCB7XG4gIGNvbnN0IHByb3BlcnRpZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcbiAgY29uc3QgcHJvcGVydHlPcmRlcjogc3RyaW5nW10gPSBbXTtcblxuICBmb3IgKGNvbnN0IGxpbmUgb2YgYmxvY2subGluZXMpIHtcbiAgICBpZiAoIWxpbmUpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGNvbG9uSW5kZXggPSBsaW5lLmluZGV4T2YoXCI6XCIpO1xuICAgIGlmIChjb2xvbkluZGV4ID09PSAtMSkgY29udGludWU7XG5cbiAgICBjb25zdCBwcm9wID0gbGluZS5zdWJzdHJpbmcoMCwgY29sb25JbmRleCkudHJpbSgpO1xuICAgIGNvbnN0IHZhbCA9IGxpbmUuc3Vic3RyaW5nKGNvbG9uSW5kZXggKyAxKS50cmltKCk7XG4gICAgaWYgKHByb3AgJiYgdmFsKSB7XG4gICAgICBwcm9wZXJ0aWVzW3Byb3BdID0gdmFsO1xuICAgICAgcHJvcGVydHlPcmRlci5wdXNoKHByb3ApO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGtleVZhbHVlID0gcHJvcGVydGllc1trZXlQcm9wZXJ0eV07XG4gIGlmICgha2V5VmFsdWUpIHJldHVybiBudWxsO1xuXG4gIC8vIE1hbmRhdG9yeSBpZCBwcm9wZXJ0eTogbXVzdCBiZSBwcmVzZW50IGFuZCBudW1lcmljXG4gIGNvbnN0IHJhd0lkID0gcHJvcGVydGllc1tcImlkXCJdO1xuICBpZiAoIXJhd0lkKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgaWQgPSBOdW1iZXIocmF3SWQpO1xuICBpZiAoaXNOYU4oaWQpKSByZXR1cm4gbnVsbDtcblxuICByZXR1cm4ge1xuICAgIGtleVZhbHVlLFxuICAgIGRpc3BsYXlLZXk6IGtleVZhbHVlLCAvLyBkZWZhdWx0OyBkaXNhbWJpZ3VhdGVkIGxhdGVyIGluIGZ1bGxSZWZyZXNoKClcbiAgICBpZCxcbiAgICBwcm9wZXJ0aWVzLFxuICAgIHByb3BlcnR5T3JkZXIsXG4gICAgZmlsZVBhdGgsXG4gICAgZmlsZUxhYmVsLFxuICAgIHN0YXJ0TGluZTogYmxvY2suc3RhcnRMaW5lLFxuICB9O1xufVxuXG4vKipcbiAqIEdldCB0aGUgdmFsdWUgb2YgdGhlIFwic2Vjb25kIHByb3BlcnR5XCIgb2YgYW4gb2JqZWN0IGZvciBkaXNhbWJpZ3VhdGlvbi5cbiAqIFRoaXMgaXMgdGhlIGZpcnN0IHByb3BlcnR5IHRoYXQgaXMgbm90IHRoZSBrZXkgcHJvcGVydHkgYW5kIG5vdCBcImlkXCIuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRTZWNvbmRQcm9wZXJ0eShcbiAgb2JqOiBQYXJzZWRPYmplY3QsXG4gIGtleVByb3BlcnR5OiBzdHJpbmdcbik6IHN0cmluZyB8IG51bGwge1xuICBmb3IgKGNvbnN0IHByb3Agb2Ygb2JqLnByb3BlcnR5T3JkZXIpIHtcbiAgICBpZiAocHJvcCA9PT0ga2V5UHJvcGVydHkgfHwgcHJvcCA9PT0gXCJpZFwiKSBjb250aW51ZTtcbiAgICBjb25zdCB2YWwgPSBvYmoucHJvcGVydGllc1twcm9wXTtcbiAgICBpZiAodmFsKSByZXR1cm4gdmFsO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIEV4dHJhY3QgYWxsIHt7b2JqZWN0IGxpbmtzfX0gZnJvbSBjb250ZW50LlxuICogUmV0dXJucyB0aGUgbGluayB0YXJnZXQgbmFtZXMgKHdpdGhvdXQge3sgfX0pLlxuICogSGFuZGxlcyBhbGlhc2VzIGxpa2Uge3t0YXJnZXR8YWxpYXN9fSBieSByZXR1cm5pbmcganVzdCBcInRhcmdldFwiLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdE9iamVjdExpbmtzKGNvbnRlbnQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgbGlua3M6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IHJlZ2V4ID0gL1xce1xceyhbXn1dKylcXH1cXH0vZztcbiAgbGV0IG1hdGNoO1xuXG4gIHdoaWxlICgobWF0Y2ggPSByZWdleC5leGVjKGNvbnRlbnQpKSAhPT0gbnVsbCkge1xuICAgIGxldCBsaW5rVGFyZ2V0ID0gbWF0Y2hbMV07XG4gICAgY29uc3QgcGlwZUluZGV4ID0gbGlua1RhcmdldC5pbmRleE9mKFwifFwiKTtcbiAgICBpZiAocGlwZUluZGV4ICE9PSAtMSkge1xuICAgICAgbGlua1RhcmdldCA9IGxpbmtUYXJnZXQuc3Vic3RyaW5nKDAsIHBpcGVJbmRleCk7XG4gICAgfVxuICAgIGxpbmtzLnB1c2gobGlua1RhcmdldC50cmltKCkpO1xuICB9XG5cbiAgcmV0dXJuIGxpbmtzO1xufVxuXG4vKipcbiAqIEV4dHJhY3QgYWxsIFtbd2lraWxpbmtzXV0gZnJvbSBjb250ZW50LlxuICogUmV0dXJucyB0aGUgbGluayB0YXJnZXQgbmFtZXMgKHdpdGhvdXQgW1sgXV0pLlxuICogSGFuZGxlcyBhbGlhc2VzIGxpa2UgW1t0YXJnZXR8YWxpYXNdXSBieSByZXR1cm5pbmcganVzdCBcInRhcmdldFwiLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdFdpa2lsaW5rcyhjb250ZW50OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IGxpbmtzOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCByZWdleCA9IC9cXFtcXFsoW15cXF1dKylcXF1cXF0vZztcbiAgbGV0IG1hdGNoO1xuXG4gIHdoaWxlICgobWF0Y2ggPSByZWdleC5leGVjKGNvbnRlbnQpKSAhPT0gbnVsbCkge1xuICAgIGxldCBsaW5rVGFyZ2V0ID0gbWF0Y2hbMV07XG4gICAgY29uc3QgcGlwZUluZGV4ID0gbGlua1RhcmdldC5pbmRleE9mKFwifFwiKTtcbiAgICBpZiAocGlwZUluZGV4ICE9PSAtMSkge1xuICAgICAgbGlua1RhcmdldCA9IGxpbmtUYXJnZXQuc3Vic3RyaW5nKDAsIHBpcGVJbmRleCk7XG4gICAgfVxuICAgIGxpbmtzLnB1c2gobGlua1RhcmdldC50cmltKCkpO1xuICB9XG5cbiAgcmV0dXJuIGxpbmtzO1xufVxuIiwgImltcG9ydCB7IFBhcnNlZEZpbGUsIGV4dHJhY3RPYmplY3RMaW5rcywgZXh0cmFjdFdpa2lsaW5rcyB9IGZyb20gXCIuL3BhcnNlclwiO1xuXG5leHBvcnQgaW50ZXJmYWNlIEdyYXBoTm9kZSB7XG4gIGlkOiBzdHJpbmc7XG4gIGxhYmVsOiBzdHJpbmc7XG4gIC8qKiBcIm9iamVjdFwiIGZvciBtdWx0aS1vYmplY3QgZW50cmllcywgXCJmaWxlXCIgZm9yIHJlZ3VsYXIgdmF1bHQgZmlsZXMgKi9cbiAgdHlwZTogXCJvYmplY3RcIiB8IFwiZmlsZVwiO1xuICBmaWxlUGF0aDogc3RyaW5nO1xuICBmaWxlTGFiZWw6IHN0cmluZztcbiAgcHJvcGVydGllczogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgLyoqIDAtaW5kZXhlZCBzdGFydCBsaW5lIGluIHRoZSBzb3VyY2UgZmlsZSAob2JqZWN0cyBvbmx5KSAqL1xuICBzdGFydExpbmU6IG51bWJlcjtcbiAgLyoqIE51bWJlciBvZiBjb25uZWN0aW9ucyAqL1xuICBjb25uZWN0aW9uczogbnVtYmVyO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEdyYXBoRWRnZSB7XG4gIHNvdXJjZTogc3RyaW5nO1xuICB0YXJnZXQ6IHN0cmluZztcbiAgLyoqIFwib2JqZWN0XCIgaWYgdGhpcyBlZGdlIGludm9sdmVzIGEge3t9fSBsaW5rLCBcIndpa2lcIiBmb3IgbmF0aXZlIFtbXV0gbGlua3MgKi9cbiAgZWRnZVR5cGU6IFwib2JqZWN0XCIgfCBcIndpa2lcIjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBHcmFwaERhdGEge1xuICBub2RlczogR3JhcGhOb2RlW107XG4gIGVkZ2VzOiBHcmFwaEVkZ2VbXTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBWYXVsdEZpbGUge1xuICBwYXRoOiBzdHJpbmc7XG4gIGJhc2VuYW1lOiBzdHJpbmc7XG4gIGNvbnRlbnQ6IHN0cmluZztcbn1cblxuLyoqXG4gKiBCdWlsZCB0aGUgZnVsbCBncmFwaCBmcm9tIHRoZSB2YXVsdC5cbiAqXG4gKiBOb2RlczpcbiAqICAgLSBFYWNoIG9iamVjdCBpbiBhIG11bHRpLW9iamVjdCBmaWxlIC0+IHR5cGUgXCJvYmplY3RcIlxuICogICAtIEVhY2ggcmVndWxhciB2YXVsdCBmaWxlIHRoYXQgcGFydGljaXBhdGVzIGluIGFueSBsaW5rIC0+IHR5cGUgXCJmaWxlXCJcbiAqXG4gKiBFZGdlczpcbiAqICAgLSBmaWxlIC0+IG9iamVjdCAgd2hlbiBhIGZpbGUgY29udGFpbnMge3tPYmplY3RLZXl9fVxuICogICAtIGZpbGUgLT4gZmlsZSAgICB3aGVuIGEgZmlsZSBjb250YWlucyBbW090aGVyRmlsZV1dIChuYXRpdmUgd2lraWxpbmtzKVxuICogICAtIG9iamVjdCAtPiBvYmplY3Qgd2hlbiBhbiBvYmplY3QncyBwcm9wZXJ0eSB2YWx1ZSBjb250YWlucyB7e090aGVyT2JqZWN0fX1cbiAqXG4gKiBNdWx0aS1vYmplY3Qgc291cmNlIGZpbGVzIChlLmcuLCBGaWxtcy5tZCkgZG8gTk9UIGFwcGVhciBhcyBmaWxlIG5vZGVzO1xuICogb25seSB0aGVpciBpbmRpdmlkdWFsIG9iamVjdHMgZG8uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZEdyYXBoKFxuICBwYXJzZWRGaWxlczogUGFyc2VkRmlsZVtdLFxuICBhbGxGaWxlczogVmF1bHRGaWxlW11cbik6IEdyYXBoRGF0YSB7XG4gIGNvbnN0IG5vZGVzOiBHcmFwaE5vZGVbXSA9IFtdO1xuICBjb25zdCBlZGdlczogR3JhcGhFZGdlW10gPSBbXTtcbiAgY29uc3QgZWRnZVNldCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBjb25zdCBub2RlTWFwID0gbmV3IE1hcDxzdHJpbmcsIEdyYXBoTm9kZT4oKTtcblxuICAvLyBQYXRocyBvZiBtdWx0aS1vYmplY3Qgc291cmNlIGZpbGVzIC0tIHRoZXNlIGFyZSByZXBsYWNlZCBieSB0aGVpciBvYmplY3RzXG4gIGNvbnN0IG11bHRpT2JqZWN0UGF0aHMgPSBuZXcgU2V0KHBhcnNlZEZpbGVzLm1hcCgoZikgPT4gZi5maWxlUGF0aCkpO1xuXG4gIC8vIE1hcDogbG93ZXJjYXNlIGtleSB2YWx1ZSAtPiBvYmplY3Qgbm9kZSBpZFxuICBjb25zdCBvYmpLZXlUb05vZGVJZCA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCk7XG5cbiAgLy8gTWFwOiBsb3dlcmNhc2UgZmlsZSBiYXNlbmFtZSAtPiBmaWxlIHBhdGggKGZvciByZXNvbHZpbmcgW1t3aWtpbGlua3NdXSlcbiAgY29uc3QgYmFzZW5hbWVUb1BhdGggPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpO1xuICBmb3IgKGNvbnN0IGYgb2YgYWxsRmlsZXMpIHtcbiAgICBiYXNlbmFtZVRvUGF0aC5zZXQoZi5iYXNlbmFtZS50b0xvd2VyQ2FzZSgpLCBmLnBhdGgpO1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIDEuIENyZWF0ZSBvYmplY3Qgbm9kZXMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG4gIGZvciAoY29uc3QgZmlsZSBvZiBwYXJzZWRGaWxlcykge1xuICAgIGZvciAoY29uc3Qgb2JqIG9mIGZpbGUub2JqZWN0cykge1xuICAgICAgY29uc3Qgbm9kZUlkID0gYG9iajo6JHtmaWxlLmZpbGVQYXRofTo6JHtvYmouZGlzcGxheUtleX1gO1xuICAgICAgY29uc3Qgbm9kZTogR3JhcGhOb2RlID0ge1xuICAgICAgICBpZDogbm9kZUlkLFxuICAgICAgICBsYWJlbDogb2JqLmRpc3BsYXlLZXksXG4gICAgICAgIHR5cGU6IFwib2JqZWN0XCIsXG4gICAgICAgIGZpbGVQYXRoOiBvYmouZmlsZVBhdGgsXG4gICAgICAgIGZpbGVMYWJlbDogb2JqLmZpbGVMYWJlbCxcbiAgICAgICAgcHJvcGVydGllczogb2JqLnByb3BlcnRpZXMsXG4gICAgICAgIHN0YXJ0TGluZTogb2JqLnN0YXJ0TGluZSxcbiAgICAgICAgY29ubmVjdGlvbnM6IDAsXG4gICAgICB9O1xuICAgICAgbm9kZXMucHVzaChub2RlKTtcbiAgICAgIG5vZGVNYXAuc2V0KG5vZGVJZCwgbm9kZSk7XG4gICAgICAvLyBSZWdpc3RlciBieSBkaXNwbGF5S2V5IChwcmltYXJ5IGxvb2t1cCBmb3IgZGlzYW1iaWd1YXRlZCBuYW1lcylcbiAgICAgIG9iaktleVRvTm9kZUlkLnNldChvYmouZGlzcGxheUtleS50b0xvd2VyQ2FzZSgpLCBub2RlSWQpO1xuICAgICAgLy8gQWxzbyByZWdpc3RlciBieSBwbGFpbiBrZXlWYWx1ZSBpZiBub3QgYWxyZWFkeSB0YWtlbiAoYmFja3dhcmRzIGNvbXBhdClcbiAgICAgIGNvbnN0IHBsYWluID0gb2JqLmtleVZhbHVlLnRvTG93ZXJDYXNlKCk7XG4gICAgICBpZiAoIW9iaktleVRvTm9kZUlkLmhhcyhwbGFpbikpIHtcbiAgICAgICAgb2JqS2V5VG9Ob2RlSWQuc2V0KHBsYWluLCBub2RlSWQpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIEhlbHBlcjogZ2V0IG9yIGNyZWF0ZSBhIGZpbGUgbm9kZVxuICBmdW5jdGlvbiBlbnN1cmVGaWxlTm9kZShwYXRoOiBzdHJpbmcsIGJhc2VuYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IG5vZGVJZCA9IGBmaWxlOjoke3BhdGh9YDtcbiAgICBpZiAoIW5vZGVNYXAuaGFzKG5vZGVJZCkpIHtcbiAgICAgIGNvbnN0IG5vZGU6IEdyYXBoTm9kZSA9IHtcbiAgICAgICAgaWQ6IG5vZGVJZCxcbiAgICAgICAgbGFiZWw6IGJhc2VuYW1lLFxuICAgICAgICB0eXBlOiBcImZpbGVcIixcbiAgICAgICAgZmlsZVBhdGg6IHBhdGgsXG4gICAgICAgIGZpbGVMYWJlbDogYmFzZW5hbWUsXG4gICAgICAgIHByb3BlcnRpZXM6IHt9LFxuICAgICAgICBzdGFydExpbmU6IDAsXG4gICAgICAgIGNvbm5lY3Rpb25zOiAwLFxuICAgICAgfTtcbiAgICAgIG5vZGVzLnB1c2gobm9kZSk7XG4gICAgICBub2RlTWFwLnNldChub2RlSWQsIG5vZGUpO1xuICAgIH1cbiAgICByZXR1cm4gbm9kZUlkO1xuICB9XG5cbiAgLy8gSGVscGVyOiBhZGQgYW4gZWRnZSAoZGVkdXBsaWNhdGVkKVxuICBmdW5jdGlvbiBhZGRFZGdlKHNyYzogc3RyaW5nLCB0Z3Q6IHN0cmluZywgdHlwZTogXCJvYmplY3RcIiB8IFwid2lraVwiKTogdm9pZCB7XG4gICAgY29uc3QgZWRnZUlkID0gW3NyYywgdGd0XS5zb3J0KCkuam9pbihcIi0tXCIpO1xuICAgIGlmIChlZGdlU2V0LmhhcyhlZGdlSWQpKSByZXR1cm47XG4gICAgZWRnZVNldC5hZGQoZWRnZUlkKTtcbiAgICBlZGdlcy5wdXNoKHsgc291cmNlOiBzcmMsIHRhcmdldDogdGd0LCBlZGdlVHlwZTogdHlwZSB9KTtcbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCAyLiBTY2FuIGFsbCBmaWxlcyBmb3IgbGlua3MgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG4gIGZvciAoY29uc3QgZmlsZSBvZiBhbGxGaWxlcykge1xuICAgIC8vIFNraXAgbXVsdGktb2JqZWN0IHNvdXJjZSBmaWxlcyAodGhlaXIgb2JqZWN0cyBhcmUgYWxyZWFkeSBub2RlcylcbiAgICBpZiAobXVsdGlPYmplY3RQYXRocy5oYXMoZmlsZS5wYXRoKSkgY29udGludWU7XG5cbiAgICBjb25zdCBvYmplY3RMaW5rcyA9IGV4dHJhY3RPYmplY3RMaW5rcyhmaWxlLmNvbnRlbnQpO1xuICAgIGNvbnN0IHdpa2lsaW5rcyA9IGV4dHJhY3RXaWtpbGlua3MoZmlsZS5jb250ZW50KTtcblxuICAgIGxldCBmaWxlTm9kZUlkOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcblxuICAgIC8vIHt7b2JqZWN0IGxpbmtzfX0gLT4gZmlsZS10by1vYmplY3QgZWRnZXNcbiAgICBmb3IgKGNvbnN0IGxpbmsgb2Ygb2JqZWN0TGlua3MpIHtcbiAgICAgIGNvbnN0IHRhcmdldE9iaklkID0gb2JqS2V5VG9Ob2RlSWQuZ2V0KGxpbmsudG9Mb3dlckNhc2UoKSk7XG4gICAgICBpZiAodGFyZ2V0T2JqSWQpIHtcbiAgICAgICAgaWYgKCFmaWxlTm9kZUlkKSBmaWxlTm9kZUlkID0gZW5zdXJlRmlsZU5vZGUoZmlsZS5wYXRoLCBmaWxlLmJhc2VuYW1lKTtcbiAgICAgICAgYWRkRWRnZShmaWxlTm9kZUlkLCB0YXJnZXRPYmpJZCwgXCJvYmplY3RcIik7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gW1t3aWtpbGlua3NdXSAtPiBmaWxlLXRvLWZpbGUgZWRnZXNcbiAgICBmb3IgKGNvbnN0IGxpbmsgb2Ygd2lraWxpbmtzKSB7XG4gICAgICBjb25zdCB0YXJnZXRQYXRoID0gYmFzZW5hbWVUb1BhdGguZ2V0KGxpbmsudG9Mb3dlckNhc2UoKSk7XG4gICAgICBpZiAoIXRhcmdldFBhdGgpIGNvbnRpbnVlO1xuICAgICAgLy8gRG9uJ3QgbGluayB0byBtdWx0aS1vYmplY3Qgc291cmNlIGZpbGVzIGFzIGZpbGUgbm9kZXNcbiAgICAgIGlmIChtdWx0aU9iamVjdFBhdGhzLmhhcyh0YXJnZXRQYXRoKSkgY29udGludWU7XG5cbiAgICAgIC8vIEZpbmQgdGhlIHRhcmdldCBmaWxlIHRvIGdldCBpdHMgYmFzZW5hbWVcbiAgICAgIGNvbnN0IHRhcmdldEZpbGUgPSBhbGxGaWxlcy5maW5kKChmKSA9PiBmLnBhdGggPT09IHRhcmdldFBhdGgpO1xuICAgICAgaWYgKCF0YXJnZXRGaWxlKSBjb250aW51ZTtcblxuICAgICAgaWYgKCFmaWxlTm9kZUlkKSBmaWxlTm9kZUlkID0gZW5zdXJlRmlsZU5vZGUoZmlsZS5wYXRoLCBmaWxlLmJhc2VuYW1lKTtcbiAgICAgIGNvbnN0IHRhcmdldEZpbGVJZCA9IGVuc3VyZUZpbGVOb2RlKHRhcmdldFBhdGgsIHRhcmdldEZpbGUuYmFzZW5hbWUpO1xuXG4gICAgICBpZiAoZmlsZU5vZGVJZCAhPT0gdGFyZ2V0RmlsZUlkKSB7XG4gICAgICAgIGFkZEVkZ2UoZmlsZU5vZGVJZCwgdGFyZ2V0RmlsZUlkLCBcIndpa2lcIik7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIDMuIE9iamVjdC10by1vYmplY3QgbGlua3MgdmlhIHt7fX0gaW4gcHJvcGVydHkgdmFsdWVzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuICBmb3IgKGNvbnN0IGZpbGUgb2YgcGFyc2VkRmlsZXMpIHtcbiAgICBmb3IgKGNvbnN0IG9iaiBvZiBmaWxlLm9iamVjdHMpIHtcbiAgICAgIGNvbnN0IHNyY0lkID0gYG9iajo6JHtmaWxlLmZpbGVQYXRofTo6JHtvYmouZGlzcGxheUtleX1gO1xuICAgICAgZm9yIChjb25zdCB2YWwgb2YgT2JqZWN0LnZhbHVlcyhvYmoucHJvcGVydGllcykpIHtcbiAgICAgICAgZm9yIChjb25zdCBsaW5rIG9mIGV4dHJhY3RPYmplY3RMaW5rcyh2YWwpKSB7XG4gICAgICAgICAgY29uc3QgdGd0SWQgPSBvYmpLZXlUb05vZGVJZC5nZXQobGluay50b0xvd2VyQ2FzZSgpKTtcbiAgICAgICAgICBpZiAodGd0SWQgJiYgdGd0SWQgIT09IHNyY0lkKSB7XG4gICAgICAgICAgICBhZGRFZGdlKHNyY0lkLCB0Z3RJZCwgXCJvYmplY3RcIik7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIDQuIENvdW50IGNvbm5lY3Rpb25zIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuICBmb3IgKGNvbnN0IGVkZ2Ugb2YgZWRnZXMpIHtcbiAgICBjb25zdCBzcmMgPSBub2RlTWFwLmdldChlZGdlLnNvdXJjZSk7XG4gICAgY29uc3QgdGd0ID0gbm9kZU1hcC5nZXQoZWRnZS50YXJnZXQpO1xuICAgIGlmIChzcmMpIHNyYy5jb25uZWN0aW9ucysrO1xuICAgIGlmICh0Z3QpIHRndC5jb25uZWN0aW9ucysrO1xuICB9XG5cbiAgcmV0dXJuIHsgbm9kZXMsIGVkZ2VzIH07XG59XG4iLCAiaW1wb3J0IHsgSXRlbVZpZXcsIFdvcmtzcGFjZUxlYWYgfSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB7IEdyYXBoRGF0YSB9IGZyb20gXCIuL2dyYXBoLWRhdGFcIjtcbmltcG9ydCB7IENvbmZpZ1BhbmVsLCBHcmFwaENvbmZpZywgREVGQVVMVF9DT05GSUcgfSBmcm9tIFwiLi9zZXR0aW5nc1wiO1xuaW1wb3J0IHtcbiAgc2VsZWN0LFxuICBmb3JjZVNpbXVsYXRpb24sXG4gIGZvcmNlTGluayxcbiAgZm9yY2VNYW55Qm9keSxcbiAgZm9yY2VDb2xsaWRlLFxuICBmb3JjZVgsXG4gIGZvcmNlWSxcbiAgem9vbSxcbiAgem9vbUlkZW50aXR5LFxuICB6b29tVHJhbnNmb3JtLFxuICBab29tQmVoYXZpb3IsXG4gIFpvb21UcmFuc2Zvcm0sXG4gIFNpbXVsYXRpb24sXG4gIFNpbXVsYXRpb25Ob2RlRGF0dW0sXG4gIFNpbXVsYXRpb25MaW5rRGF0dW0sXG59IGZyb20gXCJkM1wiO1xuXG5leHBvcnQgY29uc3QgVklFV19UWVBFID0gXCJvYmplY3QtbGlua3MtZ3JhcGhcIjtcblxuLyogXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXG4gICBTaW11bGF0aW9uIE5vZGUvRWRnZSBUeXBlc1xuICAgXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwICovXG5cbnR5cGUgTm9kZVR5cGUgPSBcIm9iamVjdFwiIHwgXCJmaWxlXCI7XG5cbnR5cGUgU2ltTm9kZSA9IFNpbXVsYXRpb25Ob2RlRGF0dW0gJiB7XG4gIGlkOiBzdHJpbmc7XG4gIGxhYmVsOiBzdHJpbmc7XG4gIHR5cGU6IE5vZGVUeXBlO1xuICBmaWxlUGF0aDogc3RyaW5nO1xuICBmaWxlTGFiZWw6IHN0cmluZztcbiAgcHJvcGVydGllczogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgc3RhcnRMaW5lOiBudW1iZXI7XG4gIGNvbm5lY3Rpb25zOiBudW1iZXI7XG4gIHJhZGl1czogbnVtYmVyO1xuICAvKiogQ3VycmVudCB2aXN1YWwgYWxwaGEgKGludGVycG9sYXRlZCBmb3Igc21vb3RoIHRyYW5zaXRpb25zKSAqL1xuICBhbHBoYTogbnVtYmVyO1xuICAvKiogVGFyZ2V0IGFscGhhIGJhc2VkIG9uIGhpZ2hsaWdodCBzdGF0ZSAqL1xuICB0YXJnZXRBbHBoYTogbnVtYmVyO1xuICAvKiogZDMgZml4ZWQgcG9zaXRpb24gKi9cbiAgZng6IG51bWJlciB8IG51bGw7XG4gIGZ5OiBudW1iZXIgfCBudWxsO1xufTtcblxudHlwZSBTaW1FZGdlID0gU2ltdWxhdGlvbkxpbmtEYXR1bTxTaW1Ob2RlPiAmIHtcbiAgZWRnZVR5cGU6IFwib2JqZWN0XCIgfCBcIndpa2lcIjtcbiAgLyoqIEN1cnJlbnQgdmlzdWFsIGFscGhhICovXG4gIGFscGhhOiBudW1iZXI7XG4gIC8qKiBUYXJnZXQgYWxwaGEgKi9cbiAgdGFyZ2V0QWxwaGE6IG51bWJlcjtcbn07XG5cbi8qIFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFxuICAgQ29sb3IgSGVscGVyc1xuICAgXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwICovXG5cbmZ1bmN0aW9uIHBhcnNlQ29sb3IoY3NzOiBzdHJpbmcpOiBbbnVtYmVyLCBudW1iZXIsIG51bWJlcl0ge1xuICBpZiAoY3NzLnN0YXJ0c1dpdGgoXCIjXCIpKSB7XG4gICAgY29uc3QgaGV4ID0gY3NzLnNsaWNlKDEpO1xuICAgIGlmIChoZXgubGVuZ3RoID09PSAzKSB7XG4gICAgICByZXR1cm4gW1xuICAgICAgICBwYXJzZUludChoZXhbMF0gKyBoZXhbMF0sIDE2KSAvIDI1NSxcbiAgICAgICAgcGFyc2VJbnQoaGV4WzFdICsgaGV4WzFdLCAxNikgLyAyNTUsXG4gICAgICAgIHBhcnNlSW50KGhleFsyXSArIGhleFsyXSwgMTYpIC8gMjU1LFxuICAgICAgXTtcbiAgICB9XG4gICAgcmV0dXJuIFtcbiAgICAgIHBhcnNlSW50KGhleC5zbGljZSgwLCAyKSwgMTYpIC8gMjU1LFxuICAgICAgcGFyc2VJbnQoaGV4LnNsaWNlKDIsIDQpLCAxNikgLyAyNTUsXG4gICAgICBwYXJzZUludChoZXguc2xpY2UoNCwgNiksIDE2KSAvIDI1NSxcbiAgICBdO1xuICB9XG4gIGNvbnN0IG0gPSBjc3MubWF0Y2goL3JnYmE/XFwoXFxzKihcXGQrKSxcXHMqKFxcZCspLFxccyooXFxkKykvKTtcbiAgaWYgKG0pIHJldHVybiBbcGFyc2VJbnQobVsxXSkgLyAyNTUsIHBhcnNlSW50KG1bMl0pIC8gMjU1LCBwYXJzZUludChtWzNdKSAvIDI1NV07XG4gIHJldHVybiBbMC42LCAwLjYsIDAuNl07XG59XG5cbmZ1bmN0aW9uIGdldFRoZW1lQ29sb3IoZWw6IEhUTUxFbGVtZW50LCB2YXJOYW1lOiBzdHJpbmcsIGZhbGxiYWNrOiBzdHJpbmcpOiBbbnVtYmVyLCBudW1iZXIsIG51bWJlcl0ge1xuICBjb25zdCBzdHlsZSA9IGdldENvbXB1dGVkU3R5bGUoZWwpO1xuICBjb25zdCB2YWwgPSBzdHlsZS5nZXRQcm9wZXJ0eVZhbHVlKHZhck5hbWUpLnRyaW0oKTtcbiAgcmV0dXJuIHBhcnNlQ29sb3IodmFsIHx8IGZhbGxiYWNrKTtcbn1cblxuZnVuY3Rpb24gY29sb3JUb0NTUyhjOiBbbnVtYmVyLCBudW1iZXIsIG51bWJlcl0pOiBzdHJpbmcge1xuICByZXR1cm4gYHJnYigke01hdGgucm91bmQoY1swXSAqIDI1NSl9LCR7TWF0aC5yb3VuZChjWzFdICogMjU1KX0sJHtNYXRoLnJvdW5kKGNbMl0gKiAyNTUpfSlgO1xufVxuXG4vKiBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcbiAgIExlcnAgaGVscGVyXG4gICBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTAgKi9cblxuZnVuY3Rpb24gbGVycChhOiBudW1iZXIsIGI6IG51bWJlciwgdDogbnVtYmVyKTogbnVtYmVyIHtcbiAgcmV0dXJuIGEgKyAoYiAtIGEpICogdDtcbn1cblxuLyogXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXG4gICBHcmFwaFZpZXcgXHUyMDE0IENhbnZhcyArIGQzLWZvcmNlXG4gICBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTAgKi9cblxuZXhwb3J0IGNsYXNzIEdyYXBoVmlldyBleHRlbmRzIEl0ZW1WaWV3IHtcbiAgcHJpdmF0ZSBncmFwaERhdGE6IEdyYXBoRGF0YSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHNpbXVsYXRpb246IFNpbXVsYXRpb248U2ltTm9kZSwgU2ltRWRnZT4gfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSByZXNpemVPYnNlcnZlcjogUmVzaXplT2JzZXJ2ZXIgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBjb25maWdQYW5lbDogQ29uZmlnUGFuZWwgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBjb25maWc6IEdyYXBoQ29uZmlnID0geyAuLi5ERUZBVUxUX0NPTkZJRyB9O1xuXG4gIC8vIENhbnZhcyBzdGF0ZVxuICBwcml2YXRlIGNhbnZhc1dyYXBwZXI6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgY2FudmFzRWw6IEhUTUxDYW52YXNFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgY3R4OiBDYW52YXNSZW5kZXJpbmdDb250ZXh0MkQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBkcHIgPSAxO1xuXG4gIC8vIGQzLXpvb21cbiAgcHJpdmF0ZSB6b29tQmVoYXZpb3I6IFpvb21CZWhhdmlvcjxIVE1MQ2FudmFzRWxlbWVudCwgdW5rbm93bj4gfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSB6b29tVHJhbnNmb3JtOiBab29tVHJhbnNmb3JtID0gem9vbUlkZW50aXR5O1xuICBwcml2YXRlIGlzU3luY2luZ1pvb20gPSBmYWxzZTtcblxuICAvLyBTaW0gZGF0YVxuICBwcml2YXRlIHNpbU5vZGVzOiBTaW1Ob2RlW10gPSBbXTtcbiAgcHJpdmF0ZSBzaW1FZGdlczogU2ltRWRnZVtdID0gW107XG5cbiAgLy8gQ2FtZXJhIChjdXJyZW50ID0gc21vb3RoZWQsIHRhcmdldCA9IHdoZXJlIHdlIHdhbnQgdG8gYmUpXG4gIHByaXZhdGUgY2FtWCA9IDA7XG4gIHByaXZhdGUgY2FtWSA9IDA7XG4gIHByaXZhdGUgY2FtU2NhbGUgPSAwLjc7XG4gIHByaXZhdGUgdGFyZ2V0Q2FtWCA9IDA7XG4gIHByaXZhdGUgdGFyZ2V0Q2FtWSA9IDA7XG4gIHByaXZhdGUgdGFyZ2V0Q2FtU2NhbGUgPSAwLjc7XG5cbiAgLy8gSW50ZXJhY3Rpb24gc3RhdGVcbiAgcHJpdmF0ZSBob3ZlcmVkTm9kZTogU2ltTm9kZSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHNlbGVjdGVkTm9kZTogU2ltTm9kZSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGRyYWdOb2RlOiBTaW1Ob2RlIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgaXNEcmFnZ2luZyA9IGZhbHNlO1xuICBwcml2YXRlIGxhc3RDbGlja1RpbWUgPSAwO1xuICBwcml2YXRlIGxhc3RDbGlja0lkID0gXCJcIjtcblxuICAvLyBSZW5kZXIgbG9vcFxuICBwcml2YXRlIHJlbmRlckxvb3BJZDogbnVtYmVyID0gMDtcbiAgcHJpdmF0ZSBuZWVkc1JlZHJhdyA9IHRydWU7XG5cbiAgLy8gVGhlbWUgY29sb3JzIChjYWNoZWQpXG4gIHByaXZhdGUgY29sb3JOb2RlT2JqZWN0OiBbbnVtYmVyLCBudW1iZXIsIG51bWJlcl0gPSBbMC41LCAwLjUsIDEuMF07XG4gIHByaXZhdGUgY29sb3JOb2RlRmlsZTogW251bWJlciwgbnVtYmVyLCBudW1iZXJdID0gWzAuNiwgMC42LCAwLjZdO1xuICBwcml2YXRlIGNvbG9yRWRnZVdpa2k6IFtudW1iZXIsIG51bWJlciwgbnVtYmVyXSA9IFswLjUsIDAuNSwgMC41XTtcbiAgcHJpdmF0ZSBjb2xvckVkZ2VPYmo6IFtudW1iZXIsIG51bWJlciwgbnVtYmVyXSA9IFswLjUsIDAuNSwgMS4wXTtcbiAgcHJpdmF0ZSBjb2xvckhpZ2hsaWdodDogW251bWJlciwgbnVtYmVyLCBudW1iZXJdID0gWzAuNSwgMC41LCAxLjBdO1xuICBwcml2YXRlIGNvbG9yQmc6IFtudW1iZXIsIG51bWJlciwgbnVtYmVyXSA9IFswLjEsIDAuMSwgMC4xXTtcbiAgcHJpdmF0ZSBjb2xvclRleHQgPSBcIiNkY2RkZGVcIjtcblxuICAvLyBDYWxsYmFja3NcbiAgcHVibGljIG5hdmlnYXRlVG9PYmplY3Q6ICgoZmlsZVBhdGg6IHN0cmluZywgc3RhcnRMaW5lOiBudW1iZXIpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG4gIHB1YmxpYyBuYXZpZ2F0ZVRvRmlsZTogKChmaWxlUGF0aDogc3RyaW5nKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuXG4gIC8vIEJvdW5kIGhhbmRsZXJzXG4gIHByaXZhdGUgX29uV2hlZWw6ICgoZTogV2hlZWxFdmVudCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBfb25Nb3VzZURvd246ICgoZTogTW91c2VFdmVudCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBfb25Nb3VzZU1vdmU6ICgoZTogTW91c2VFdmVudCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBfb25Nb3VzZVVwOiAoKGU6IE1vdXNlRXZlbnQpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgX29uRGJsQ2xpY2s6ICgoZTogTW91c2VFdmVudCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcblxuICBjb25zdHJ1Y3RvcihsZWFmOiBXb3Jrc3BhY2VMZWFmKSB7XG4gICAgc3VwZXIobGVhZik7XG4gIH1cblxuICBnZXRWaWV3VHlwZSgpOiBzdHJpbmcgeyByZXR1cm4gVklFV19UWVBFOyB9XG4gIGdldERpc3BsYXlUZXh0KCk6IHN0cmluZyB7IHJldHVybiBcIk9iamVjdCBMaW5rc1wiOyB9XG4gIGdldEljb24oKTogc3RyaW5nIHsgcmV0dXJuIFwiZ2l0LWZvcmtcIjsgfVxuXG4gIHNldEdyYXBoRGF0YShkYXRhOiBHcmFwaERhdGEpOiB2b2lkIHtcbiAgICB0aGlzLmdyYXBoRGF0YSA9IGRhdGE7XG4gICAgaWYgKHRoaXMuY29udGFpbmVyRWwpIHRoaXMucmVuZGVyR3JhcGgoKTtcbiAgfVxuXG4gIGFzeW5jIG9uT3BlbigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBjb250YWluZXIgPSB0aGlzLmNvbnRlbnRFbDtcbiAgICBjb250YWluZXIuZW1wdHkoKTtcbiAgICBjb250YWluZXIuYWRkQ2xhc3MoXCJvbC1ncmFwaC1jb250YWluZXJcIik7XG5cbiAgICBpZiAodGhpcy5ncmFwaERhdGEpIHtcbiAgICAgIHRoaXMucmVuZGVyR3JhcGgoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29udGFpbmVyLmNyZWF0ZUVsKFwiZGl2XCIsIHtcbiAgICAgICAgY2xzOiBcIm9sLWVtcHR5LXN0YXRlXCIsXG4gICAgICAgIHRleHQ6IFwiT3BlbiB0aGUgZ3JhcGggdXNpbmcgdGhlIGNvbW1hbmQgcGFsZXR0ZSBvciByaWJib24gaWNvbi5cIixcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIG9uQ2xvc2UoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5jbGVhbnVwKCk7XG4gIH1cblxuICBwcml2YXRlIGNsZWFudXAoKTogdm9pZCB7XG4gICAgdGhpcy5zdG9wUmVuZGVyTG9vcCgpO1xuICAgIGlmICh0aGlzLnNpbXVsYXRpb24pIHtcbiAgICAgIHRoaXMuc2ltdWxhdGlvbi5zdG9wKCk7XG4gICAgICB0aGlzLnNpbXVsYXRpb24ub24oXCJ0aWNrXCIsIG51bGwpO1xuICAgICAgdGhpcy5zaW11bGF0aW9uID0gbnVsbDtcbiAgICB9XG4gICAgaWYgKHRoaXMucmVzaXplT2JzZXJ2ZXIpIHsgdGhpcy5yZXNpemVPYnNlcnZlci5kaXNjb25uZWN0KCk7IHRoaXMucmVzaXplT2JzZXJ2ZXIgPSBudWxsOyB9XG4gICAgaWYgKHRoaXMuY29uZmlnUGFuZWwpIHsgdGhpcy5jb25maWdQYW5lbC5kZXN0cm95KCk7IHRoaXMuY29uZmlnUGFuZWwgPSBudWxsOyB9XG4gICAgdGhpcy5yZW1vdmVDYW52YXNMaXN0ZW5lcnMoKTtcblxuICAgIHRoaXMuc2ltTm9kZXMgPSBbXTtcbiAgICB0aGlzLnNpbUVkZ2VzID0gW107XG5cbiAgICB0aGlzLmNhbnZhc0VsPy5yZW1vdmUoKTtcbiAgICB0aGlzLmNhbnZhc0VsID0gbnVsbDtcbiAgICB0aGlzLmN0eCA9IG51bGw7XG4gICAgdGhpcy5jYW52YXNXcmFwcGVyID0gbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgcmVtb3ZlQ2FudmFzTGlzdGVuZXJzKCk6IHZvaWQge1xuICAgIGNvbnN0IGMgPSB0aGlzLmNhbnZhc0VsO1xuICAgIGlmICghYykgcmV0dXJuO1xuICAgIGlmICh0aGlzLl9vbldoZWVsKSBjLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJ3aGVlbFwiLCB0aGlzLl9vbldoZWVsKTtcbiAgICAvLyBtb3VzZWRvd24gd2FzIHJlZ2lzdGVyZWQgd2l0aCBjYXB0dXJlOnRydWUgdG8gaW50ZXJjZXB0IGJlZm9yZSBkMy16b29tXG4gICAgaWYgKHRoaXMuX29uTW91c2VEb3duKSBjLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJtb3VzZWRvd25cIiwgdGhpcy5fb25Nb3VzZURvd24sIHRydWUpO1xuICAgIGlmICh0aGlzLl9vbk1vdXNlTW92ZSkgYy5yZW1vdmVFdmVudExpc3RlbmVyKFwibW91c2Vtb3ZlXCIsIHRoaXMuX29uTW91c2VNb3ZlKTtcbiAgICBpZiAodGhpcy5fb25Nb3VzZVVwKSBjLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJtb3VzZXVwXCIsIHRoaXMuX29uTW91c2VVcCk7XG4gICAgaWYgKHRoaXMuX29uRGJsQ2xpY2spIGMucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImRibGNsaWNrXCIsIHRoaXMuX29uRGJsQ2xpY2spO1xuICB9XG5cbiAgLyogXHUyNTAwXHUyNTAwIFJlbmRlciBsb29wIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMCAqL1xuXG4gIHByaXZhdGUgc3RhcnRSZW5kZXJMb29wKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLnJlbmRlckxvb3BJZCkgcmV0dXJuO1xuICAgIGNvbnN0IGZyYW1lID0gKCkgPT4ge1xuICAgICAgdGhpcy5yZW5kZXJMb29wSWQgPSByZXF1ZXN0QW5pbWF0aW9uRnJhbWUoZnJhbWUpO1xuICAgICAgdGhpcy51cGRhdGVBbmREcmF3KCk7XG4gICAgfTtcbiAgICB0aGlzLnJlbmRlckxvb3BJZCA9IHJlcXVlc3RBbmltYXRpb25GcmFtZShmcmFtZSk7XG4gIH1cblxuICBwcml2YXRlIHN0b3BSZW5kZXJMb29wKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLnJlbmRlckxvb3BJZCkge1xuICAgICAgY2FuY2VsQW5pbWF0aW9uRnJhbWUodGhpcy5yZW5kZXJMb29wSWQpO1xuICAgICAgdGhpcy5yZW5kZXJMb29wSWQgPSAwO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgdXBkYXRlQW5kRHJhdygpOiB2b2lkIHtcbiAgICBsZXQgYW5pbWF0aW5nID0gZmFsc2U7XG5cbiAgICAvLyBTbW9vdGggY2FtZXJhIGludGVycG9sYXRpb25cbiAgICBjb25zdCBjYW1MZXJwID0gMC4xNTtcbiAgICBpZiAoTWF0aC5hYnModGhpcy5jYW1YIC0gdGhpcy50YXJnZXRDYW1YKSA+IDAuMDEgfHxcbiAgICAgICAgTWF0aC5hYnModGhpcy5jYW1ZIC0gdGhpcy50YXJnZXRDYW1ZKSA+IDAuMDEgfHxcbiAgICAgICAgTWF0aC5hYnModGhpcy5jYW1TY2FsZSAtIHRoaXMudGFyZ2V0Q2FtU2NhbGUpID4gMC4wMDAxKSB7XG4gICAgICB0aGlzLmNhbVggPSBsZXJwKHRoaXMuY2FtWCwgdGhpcy50YXJnZXRDYW1YLCBjYW1MZXJwKTtcbiAgICAgIHRoaXMuY2FtWSA9IGxlcnAodGhpcy5jYW1ZLCB0aGlzLnRhcmdldENhbVksIGNhbUxlcnApO1xuICAgICAgdGhpcy5jYW1TY2FsZSA9IGxlcnAodGhpcy5jYW1TY2FsZSwgdGhpcy50YXJnZXRDYW1TY2FsZSwgY2FtTGVycCk7XG4gICAgICBpZiAoTWF0aC5hYnModGhpcy5jYW1TY2FsZSAtIHRoaXMudGFyZ2V0Q2FtU2NhbGUpIDwgMC4wMDAxKSB7XG4gICAgICAgIHRoaXMuY2FtU2NhbGUgPSB0aGlzLnRhcmdldENhbVNjYWxlO1xuICAgICAgICB0aGlzLmNhbVggPSB0aGlzLnRhcmdldENhbVg7XG4gICAgICAgIHRoaXMuY2FtWSA9IHRoaXMudGFyZ2V0Q2FtWTtcbiAgICAgIH1cbiAgICAgIGFuaW1hdGluZyA9IHRydWU7XG4gICAgfVxuXG4gICAgLy8gU21vb3RoIGFscGhhIGludGVycG9sYXRpb24gZm9yIG5vZGVzL2VkZ2VzXG4gICAgY29uc3QgYWxwaGFMZXJwID0gMC4xMjtcbiAgICBmb3IgKGNvbnN0IG4gb2YgdGhpcy5zaW1Ob2Rlcykge1xuICAgICAgaWYgKE1hdGguYWJzKG4uYWxwaGEgLSBuLnRhcmdldEFscGhhKSA+IDAuMDA1KSB7XG4gICAgICAgIG4uYWxwaGEgPSBsZXJwKG4uYWxwaGEsIG4udGFyZ2V0QWxwaGEsIGFscGhhTGVycCk7XG4gICAgICAgIGFuaW1hdGluZyA9IHRydWU7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBuLmFscGhhID0gbi50YXJnZXRBbHBoYTtcbiAgICAgIH1cbiAgICB9XG4gICAgZm9yIChjb25zdCBlIG9mIHRoaXMuc2ltRWRnZXMpIHtcbiAgICAgIGlmIChNYXRoLmFicyhlLmFscGhhIC0gZS50YXJnZXRBbHBoYSkgPiAwLjAwNSkge1xuICAgICAgICBlLmFscGhhID0gbGVycChlLmFscGhhLCBlLnRhcmdldEFscGhhLCBhbHBoYUxlcnApO1xuICAgICAgICBhbmltYXRpbmcgPSB0cnVlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZS5hbHBoYSA9IGUudGFyZ2V0QWxwaGE7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3Qgc2ltQWN0aXZlID0gKHRoaXMuc2ltdWxhdGlvbj8uYWxwaGEoKSA/PyAwKSA+IDAuMDAxO1xuXG4gICAgaWYgKGFuaW1hdGluZyB8fCBzaW1BY3RpdmUgfHwgdGhpcy5uZWVkc1JlZHJhdykge1xuICAgICAgdGhpcy5uZWVkc1JlZHJhdyA9IGZhbHNlO1xuICAgICAgdGhpcy5kcmF3KCk7XG4gICAgfVxuICB9XG5cbiAgLyogXHUyNTAwXHUyNTAwIEZpbHRlcmluZyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cblxuICBwcml2YXRlIGFwcGx5RmlsdGVycyhkYXRhOiBHcmFwaERhdGEpOiBHcmFwaERhdGEge1xuICAgIGNvbnN0IGMgPSB0aGlzLmNvbmZpZztcbiAgICBsZXQgbm9kZXMgPSBbLi4uZGF0YS5ub2Rlc107XG4gICAgbGV0IGVkZ2VzID0gWy4uLmRhdGEuZWRnZXNdO1xuXG4gICAgaWYgKCFjLnNob3dGaWxlcykge1xuICAgICAgY29uc3QgaWRzID0gbmV3IFNldChub2Rlcy5maWx0ZXIoKG4pID0+IG4udHlwZSA9PT0gXCJmaWxlXCIpLm1hcCgobikgPT4gbi5pZCkpO1xuICAgICAgbm9kZXMgPSBub2Rlcy5maWx0ZXIoKG4pID0+IG4udHlwZSAhPT0gXCJmaWxlXCIpO1xuICAgICAgZWRnZXMgPSBlZGdlcy5maWx0ZXIoKGUpID0+ICFpZHMuaGFzKGUuc291cmNlKSAmJiAhaWRzLmhhcyhlLnRhcmdldCkpO1xuICAgIH1cbiAgICBpZiAoIWMuc2hvd09iamVjdHMpIHtcbiAgICAgIGNvbnN0IGlkcyA9IG5ldyBTZXQobm9kZXMuZmlsdGVyKChuKSA9PiBuLnR5cGUgPT09IFwib2JqZWN0XCIpLm1hcCgobikgPT4gbi5pZCkpO1xuICAgICAgbm9kZXMgPSBub2Rlcy5maWx0ZXIoKG4pID0+IG4udHlwZSAhPT0gXCJvYmplY3RcIik7XG4gICAgICBlZGdlcyA9IGVkZ2VzLmZpbHRlcigoZSkgPT4gIWlkcy5oYXMoZS5zb3VyY2UpICYmICFpZHMuaGFzKGUudGFyZ2V0KSk7XG4gICAgfVxuICAgIGlmICghYy5zaG93V2lraUVkZ2VzKSBlZGdlcyA9IGVkZ2VzLmZpbHRlcigoZSkgPT4gZS5lZGdlVHlwZSAhPT0gXCJ3aWtpXCIpO1xuICAgIGlmICghYy5zaG93T2JqZWN0RWRnZXMpIGVkZ2VzID0gZWRnZXMuZmlsdGVyKChlKSA9PiBlLmVkZ2VUeXBlICE9PSBcIm9iamVjdFwiKTtcbiAgICBpZiAoYy5zZWFyY2gpIHtcbiAgICAgIGNvbnN0IHEgPSBjLnNlYXJjaC50b0xvd2VyQ2FzZSgpO1xuICAgICAgY29uc3QgbWF0Y2hlZCA9IG5ldyBTZXQobm9kZXMuZmlsdGVyKChuKSA9PiBuLmxhYmVsLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMocSkpLm1hcCgobikgPT4gbi5pZCkpO1xuICAgICAgZm9yIChjb25zdCBlIG9mIGVkZ2VzKSB7XG4gICAgICAgIGlmIChtYXRjaGVkLmhhcyhlLnNvdXJjZSkpIG1hdGNoZWQuYWRkKGUudGFyZ2V0KTtcbiAgICAgICAgaWYgKG1hdGNoZWQuaGFzKGUudGFyZ2V0KSkgbWF0Y2hlZC5hZGQoZS5zb3VyY2UpO1xuICAgICAgfVxuICAgICAgbm9kZXMgPSBub2Rlcy5maWx0ZXIoKG4pID0+IG1hdGNoZWQuaGFzKG4uaWQpKTtcbiAgICAgIGNvbnN0IG5vZGVJZHMgPSBuZXcgU2V0KG5vZGVzLm1hcCgobikgPT4gbi5pZCkpO1xuICAgICAgZWRnZXMgPSBlZGdlcy5maWx0ZXIoKGUpID0+IG5vZGVJZHMuaGFzKGUuc291cmNlKSAmJiBub2RlSWRzLmhhcyhlLnRhcmdldCkpO1xuICAgIH1cbiAgICBpZiAoYy5wYXRoRmlsdGVyKSB7XG4gICAgICBjb25zdCBwZiA9IGMucGF0aEZpbHRlci50b0xvd2VyQ2FzZSgpO1xuICAgICAgY29uc3QgbWF0Y2hlZCA9IG5ldyBTZXQobm9kZXMuZmlsdGVyKChuKSA9PiBuLmZpbGVQYXRoLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMocGYpKS5tYXAoKG4pID0+IG4uaWQpKTtcbiAgICAgIGZvciAoY29uc3QgZSBvZiBlZGdlcykge1xuICAgICAgICBpZiAobWF0Y2hlZC5oYXMoZS5zb3VyY2UpKSBtYXRjaGVkLmFkZChlLnRhcmdldCk7XG4gICAgICAgIGlmIChtYXRjaGVkLmhhcyhlLnRhcmdldCkpIG1hdGNoZWQuYWRkKGUuc291cmNlKTtcbiAgICAgIH1cbiAgICAgIG5vZGVzID0gbm9kZXMuZmlsdGVyKChuKSA9PiBtYXRjaGVkLmhhcyhuLmlkKSk7XG4gICAgICBjb25zdCBub2RlSWRzID0gbmV3IFNldChub2Rlcy5tYXAoKG4pID0+IG4uaWQpKTtcbiAgICAgIGVkZ2VzID0gZWRnZXMuZmlsdGVyKChlKSA9PiBub2RlSWRzLmhhcyhlLnNvdXJjZSkgJiYgbm9kZUlkcy5oYXMoZS50YXJnZXQpKTtcbiAgICB9XG4gICAgaWYgKGMuc291cmNlRmlsdGVyKSB7XG4gICAgICBjb25zdCBzZiA9IGMuc291cmNlRmlsdGVyLnRvTG93ZXJDYXNlKCk7XG4gICAgICBjb25zdCByZW1vdmVkID0gbmV3IFNldChcbiAgICAgICAgbm9kZXMuZmlsdGVyKChuKSA9PiBuLnR5cGUgPT09IFwib2JqZWN0XCIgJiYgIW4uZmlsZUxhYmVsLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoc2YpKS5tYXAoKG4pID0+IG4uaWQpXG4gICAgICApO1xuICAgICAgbm9kZXMgPSBub2Rlcy5maWx0ZXIoKG4pID0+ICFyZW1vdmVkLmhhcyhuLmlkKSk7XG4gICAgICBlZGdlcyA9IGVkZ2VzLmZpbHRlcigoZSkgPT4gIXJlbW92ZWQuaGFzKGUuc291cmNlKSAmJiAhcmVtb3ZlZC5oYXMoZS50YXJnZXQpKTtcbiAgICB9XG4gICAgaWYgKCFjLnNob3dPcnBoYW5zKSB7XG4gICAgICBjb25zdCBjb25uZWN0ZWQgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICAgIGZvciAoY29uc3QgZSBvZiBlZGdlcykgeyBjb25uZWN0ZWQuYWRkKGUuc291cmNlKTsgY29ubmVjdGVkLmFkZChlLnRhcmdldCk7IH1cbiAgICAgIG5vZGVzID0gbm9kZXMuZmlsdGVyKChuKSA9PiBjb25uZWN0ZWQuaGFzKG4uaWQpKTtcbiAgICB9XG5cbiAgICBjb25zdCBjYyA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXI+KCk7XG4gICAgZm9yIChjb25zdCBlIG9mIGVkZ2VzKSB7XG4gICAgICBjYy5zZXQoZS5zb3VyY2UsIChjYy5nZXQoZS5zb3VyY2UpIHx8IDApICsgMSk7XG4gICAgICBjYy5zZXQoZS50YXJnZXQsIChjYy5nZXQoZS50YXJnZXQpIHx8IDApICsgMSk7XG4gICAgfVxuICAgIGZvciAoY29uc3QgbiBvZiBub2Rlcykgbi5jb25uZWN0aW9ucyA9IGNjLmdldChuLmlkKSB8fCAwO1xuXG4gICAgcmV0dXJuIHsgbm9kZXMsIGVkZ2VzIH07XG4gIH1cblxuICAvKiBcdTI1MDBcdTI1MDAgTm9kZSByYWRpdXMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwICovXG5cbiAgcHJpdmF0ZSBnZXROb2RlUmFkaXVzKG46IHsgdHlwZTogc3RyaW5nOyBjb25uZWN0aW9uczogbnVtYmVyIH0pOiBudW1iZXIge1xuICAgIGNvbnN0IG0gPSB0aGlzLmNvbmZpZy5ub2RlU2l6ZU11bHRpcGxpZXI7XG4gICAgY29uc3QgYmFzZSA9IG4udHlwZSA9PT0gXCJmaWxlXCIgPyA0LjUgOiA1LjU7XG4gICAgY29uc3QgZGVnID0gTWF0aC5tYXgoMCwgbi5jb25uZWN0aW9ucyk7XG4gICAgY29uc3QgYnVtcCA9IE1hdGgubWluKDEwLCBNYXRoLnNxcnQoZGVnKSAqIDEuNik7XG4gICAgcmV0dXJuIChiYXNlICsgYnVtcCkgKiBtO1xuICB9XG5cbiAgLyogXHUyNTAwXHUyNTAwIFRoZW1lIGNvbG9ycyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cblxuICBwcml2YXRlIHJlZnJlc2hDb2xvcnMoKTogdm9pZCB7XG4gICAgY29uc3QgZWwgPSB0aGlzLmNvbnRlbnRFbDtcbiAgICB0aGlzLmNvbG9yTm9kZU9iamVjdCA9IGdldFRoZW1lQ29sb3IoZWwsIFwiLS1pbnRlcmFjdGl2ZS1hY2NlbnRcIiwgXCIjN2Y2ZGYyXCIpO1xuICAgIHRoaXMuY29sb3JOb2RlRmlsZSA9IGdldFRoZW1lQ29sb3IoZWwsIFwiLS10ZXh0LW11dGVkXCIsIFwiIzk5OTk5OVwiKTtcbiAgICB0aGlzLmNvbG9yRWRnZVdpa2kgPSBnZXRUaGVtZUNvbG9yKGVsLCBcIi0tYmFja2dyb3VuZC1tb2RpZmllci1ib3JkZXJcIiwgXCIjNTU1NTU1XCIpO1xuICAgIHRoaXMuY29sb3JFZGdlT2JqID0gZ2V0VGhlbWVDb2xvcihlbCwgXCItLWludGVyYWN0aXZlLWFjY2VudFwiLCBcIiM3ZjZkZjJcIik7XG4gICAgdGhpcy5jb2xvckhpZ2hsaWdodCA9IGdldFRoZW1lQ29sb3IoZWwsIFwiLS1pbnRlcmFjdGl2ZS1hY2NlbnRcIiwgXCIjN2Y2ZGYyXCIpO1xuICAgIHRoaXMuY29sb3JCZyA9IGdldFRoZW1lQ29sb3IoZWwsIFwiLS1iYWNrZ3JvdW5kLXByaW1hcnlcIiwgXCIjMWUxZTFlXCIpO1xuICAgIGNvbnN0IHN0eWxlID0gZ2V0Q29tcHV0ZWRTdHlsZShlbCk7XG4gICAgdGhpcy5jb2xvclRleHQgPSBzdHlsZS5nZXRQcm9wZXJ0eVZhbHVlKFwiLS10ZXh0LW5vcm1hbFwiKS50cmltKCkgfHwgXCIjZGNkZGRlXCI7XG4gIH1cblxuICAvKiBcdTI1MDBcdTI1MDAgQ29vcmRpbmF0ZSB0cmFuc2Zvcm1zIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMCAqL1xuXG4gIHByaXZhdGUgZ2V0U2NyZWVuU2l6ZSgpOiB7IHc6IG51bWJlcjsgaDogbnVtYmVyIH0ge1xuICAgIGNvbnN0IGMgPSB0aGlzLmNhbnZhc0VsO1xuICAgIGlmICghYykgcmV0dXJuIHsgdzogMCwgaDogMCB9O1xuICAgIC8vIFVzZSBDU1MgcGl4ZWxzOyBkcmF3aW5nIGNvZGUgdXNlcyBDU1MgcHggY29vcmRpbmF0ZXMuXG4gICAgcmV0dXJuIHsgdzogYy5jbGllbnRXaWR0aCwgaDogYy5jbGllbnRIZWlnaHQgfTtcbiAgfVxuXG4gIHByaXZhdGUgd29ybGRUb1NjcmVlbih3eDogbnVtYmVyLCB3eTogbnVtYmVyKTogW251bWJlciwgbnVtYmVyXSB7XG4gICAgY29uc3QgeyB3LCBoIH0gPSB0aGlzLmdldFNjcmVlblNpemUoKTtcbiAgICByZXR1cm4gW1xuICAgICAgKHd4IC0gdGhpcy5jYW1YKSAqIHRoaXMuY2FtU2NhbGUgKyB3IC8gMixcbiAgICAgICh3eSAtIHRoaXMuY2FtWSkgKiB0aGlzLmNhbVNjYWxlICsgaCAvIDIsXG4gICAgXTtcbiAgfVxuXG4gIHByaXZhdGUgc2NyZWVuVG9Xb3JsZChzeDogbnVtYmVyLCBzeTogbnVtYmVyKTogW251bWJlciwgbnVtYmVyXSB7XG4gICAgY29uc3QgeyB3LCBoIH0gPSB0aGlzLmdldFNjcmVlblNpemUoKTtcbiAgICByZXR1cm4gW1xuICAgICAgKHN4IC0gdyAvIDIpIC8gdGhpcy5jYW1TY2FsZSArIHRoaXMuY2FtWCxcbiAgICAgIChzeSAtIGggLyAyKSAvIHRoaXMuY2FtU2NhbGUgKyB0aGlzLmNhbVksXG4gICAgXTtcbiAgfVxuXG4gIHByaXZhdGUgc2NyZWVuVG9Xb3JsZFRhcmdldChzeDogbnVtYmVyLCBzeTogbnVtYmVyKTogW251bWJlciwgbnVtYmVyXSB7XG4gICAgY29uc3QgeyB3LCBoIH0gPSB0aGlzLmdldFNjcmVlblNpemUoKTtcbiAgICByZXR1cm4gW1xuICAgICAgKHN4IC0gdyAvIDIpIC8gdGhpcy50YXJnZXRDYW1TY2FsZSArIHRoaXMudGFyZ2V0Q2FtWCxcbiAgICAgIChzeSAtIGggLyAyKSAvIHRoaXMudGFyZ2V0Q2FtU2NhbGUgKyB0aGlzLnRhcmdldENhbVksXG4gICAgXTtcbiAgfVxuXG4gIC8qIFx1MjUwMFx1MjUwMCBIaXQgdGVzdCBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cblxuICBwcml2YXRlIGhpdFRlc3ROb2RlKHN4OiBudW1iZXIsIHN5OiBudW1iZXIpOiBTaW1Ob2RlIHwgbnVsbCB7XG4gICAgY29uc3QgW3d4LCB3eV0gPSB0aGlzLnNjcmVlblRvV29ybGQoc3gsIHN5KTtcbiAgICBsZXQgYmVzdDogU2ltTm9kZSB8IG51bGwgPSBudWxsO1xuICAgIGxldCBiZXN0RGlzdCA9IEluZmluaXR5O1xuICAgIGZvciAoY29uc3QgbiBvZiB0aGlzLnNpbU5vZGVzKSB7XG4gICAgICBjb25zdCBueCA9IG4ueCA/PyAwO1xuICAgICAgY29uc3QgbnkgPSBuLnkgPz8gMDtcbiAgICAgIGNvbnN0IGR4ID0gbnggLSB3eDtcbiAgICAgIGNvbnN0IGR5ID0gbnkgLSB3eTtcbiAgICAgIGNvbnN0IGRpc3QgPSBNYXRoLnNxcnQoZHggKiBkeCArIGR5ICogZHkpO1xuICAgICAgY29uc3QgaGl0UmFkaXVzID0gTWF0aC5tYXgobi5yYWRpdXMgKyA0LCA4IC8gdGhpcy5jYW1TY2FsZSk7XG4gICAgICBpZiAoZGlzdCA8IGhpdFJhZGl1cyAmJiBkaXN0IDwgYmVzdERpc3QpIHtcbiAgICAgICAgYmVzdCA9IG47XG4gICAgICAgIGJlc3REaXN0ID0gZGlzdDtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGJlc3Q7XG4gIH1cblxuICAvKiBcdTI1MDBcdTI1MDAgVXBkYXRlIGhpZ2hsaWdodCB0YXJnZXRzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMCAqL1xuXG4gIHByaXZhdGUgdXBkYXRlSGlnaGxpZ2h0VGFyZ2V0cygpOiB2b2lkIHtcbiAgICBjb25zdCBmb2N1cyA9IHRoaXMuaG92ZXJlZE5vZGUgfHwgdGhpcy5zZWxlY3RlZE5vZGU7XG4gICAgaWYgKCFmb2N1cykge1xuICAgICAgZm9yIChjb25zdCBuIG9mIHRoaXMuc2ltTm9kZXMpIHtcbiAgICAgICAgbi50YXJnZXRBbHBoYSA9IG4udHlwZSA9PT0gXCJvYmplY3RcIiA/IDAuOSA6IDAuNTtcbiAgICAgIH1cbiAgICAgIGZvciAoY29uc3QgZSBvZiB0aGlzLnNpbUVkZ2VzKSB7XG4gICAgICAgIGUudGFyZ2V0QWxwaGEgPSBlLmVkZ2VUeXBlID09PSBcIndpa2lcIiA/IDAuMzUgOiAwLjI1O1xuICAgICAgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGNvbm5lY3RlZCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgIGNvbm5lY3RlZC5hZGQoZm9jdXMuaWQpO1xuICAgIGZvciAoY29uc3QgZSBvZiB0aGlzLnNpbUVkZ2VzKSB7XG4gICAgICBjb25zdCBzID0gKGUuc291cmNlIGFzIFNpbU5vZGUpLmlkO1xuICAgICAgY29uc3QgdCA9IChlLnRhcmdldCBhcyBTaW1Ob2RlKS5pZDtcbiAgICAgIGlmIChzID09PSBmb2N1cy5pZCkgY29ubmVjdGVkLmFkZCh0KTtcbiAgICAgIGlmICh0ID09PSBmb2N1cy5pZCkgY29ubmVjdGVkLmFkZChzKTtcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IG4gb2YgdGhpcy5zaW1Ob2Rlcykge1xuICAgICAgaWYgKG4gPT09IGZvY3VzKSB7XG4gICAgICAgIG4udGFyZ2V0QWxwaGEgPSAxLjA7XG4gICAgICB9IGVsc2UgaWYgKGNvbm5lY3RlZC5oYXMobi5pZCkpIHtcbiAgICAgICAgbi50YXJnZXRBbHBoYSA9IG4udHlwZSA9PT0gXCJvYmplY3RcIiA/IDAuOSA6IDAuNztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG4udGFyZ2V0QWxwaGEgPSAwLjA2O1xuICAgICAgfVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgZSBvZiB0aGlzLnNpbUVkZ2VzKSB7XG4gICAgICBjb25zdCBzID0gKGUuc291cmNlIGFzIFNpbU5vZGUpLmlkO1xuICAgICAgY29uc3QgdCA9IChlLnRhcmdldCBhcyBTaW1Ob2RlKS5pZDtcbiAgICAgIGlmIChzID09PSBmb2N1cy5pZCB8fCB0ID09PSBmb2N1cy5pZCkge1xuICAgICAgICBlLnRhcmdldEFscGhhID0gMC44O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZS50YXJnZXRBbHBoYSA9IDAuMDM7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyogXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXG4gICAgIE1haW4gUmVuZGVyIFx1MjAxNCBjYWxsZWQgb25jZSBvbiBpbml0aWFsIGRhdGEsIGFuZCBvbiBmaWx0ZXIgY2hhbmdlc1xuICAgICBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTAgKi9cblxuICBwcml2YXRlIHJlbmRlckdyYXBoKCk6IHZvaWQge1xuICAgIGlmICghdGhpcy5ncmFwaERhdGEpIHJldHVybjtcblxuICAgIGNvbnN0IGNvbnRhaW5lciA9IHRoaXMuY29udGVudEVsO1xuICAgIGNvbnN0IGlzRmlyc3RSZW5kZXIgPSAhdGhpcy5jYW52YXNFbDtcblxuICAgIGlmIChpc0ZpcnN0UmVuZGVyKSB7XG4gICAgICBjb250YWluZXIuZW1wdHkoKTtcbiAgICAgIGNvbnRhaW5lci5hZGRDbGFzcyhcIm9sLWdyYXBoLWNvbnRhaW5lclwiKTtcblxuICAgICAgLy8gQ29uZmlnIHBhbmVsXG4gICAgICB0aGlzLmNvbmZpZ1BhbmVsID0gbmV3IENvbmZpZ1BhbmVsKGNvbnRhaW5lciwgdGhpcy5jb25maWcsIChuZXdDb25maWcpID0+IHtcbiAgICAgICAgdGhpcy5oYW5kbGVDb25maWdDaGFuZ2UobmV3Q29uZmlnKTtcbiAgICAgIH0pO1xuXG4gICAgICAvLyBDYW52YXMgd3JhcHBlclxuICAgICAgdGhpcy5jYW52YXNXcmFwcGVyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgIHRoaXMuY2FudmFzV3JhcHBlci5zdHlsZS5jc3NUZXh0ID0gXCJwb3NpdGlvbjphYnNvbHV0ZTtpbnNldDowO1wiO1xuICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKHRoaXMuY2FudmFzV3JhcHBlcik7XG5cbiAgICAgIHRoaXMucmVmcmVzaENvbG9ycygpO1xuICAgICAgdGhpcy5pbml0Q2FudmFzKCk7XG4gICAgICB0aGlzLnJlYnVpbGRTaW1EYXRhKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5yZWJ1aWxkU2ltRGF0YSgpO1xuICB9XG5cbiAgcHJpdmF0ZSBpbml0Q2FudmFzKCk6IHZvaWQge1xuICAgIGNvbnN0IHdyYXBwZXIgPSB0aGlzLmNhbnZhc1dyYXBwZXIhO1xuXG4gICAgY29uc3QgY2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImNhbnZhc1wiKTtcbiAgICBjYW52YXMuc3R5bGUuY3NzVGV4dCA9IFwicG9zaXRpb246YWJzb2x1dGU7aW5zZXQ6MDt3aWR0aDoxMDAlO2hlaWdodDoxMDAlO1wiO1xuICAgIHdyYXBwZXIuYXBwZW5kQ2hpbGQoY2FudmFzKTtcblxuICAgIGNvbnN0IGN0eCA9IGNhbnZhcy5nZXRDb250ZXh0KFwiMmRcIiwgeyBhbHBoYTogZmFsc2UgfSk7XG4gICAgaWYgKCFjdHgpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBpbml0IDJEIGNhbnZhcyBjb250ZXh0XCIpO1xuXG4gICAgdGhpcy5jYW52YXNFbCA9IGNhbnZhcztcbiAgICB0aGlzLmN0eCA9IGN0eDtcblxuICAgIHRoaXMucmVzaXplT2JzZXJ2ZXIgPSBuZXcgUmVzaXplT2JzZXJ2ZXIoKCkgPT4ge1xuICAgICAgdGhpcy5yZXNpemVDYW52YXMoKTtcbiAgICAgIHRoaXMubmVlZHNSZWRyYXcgPSB0cnVlO1xuICAgIH0pO1xuICAgIHRoaXMucmVzaXplT2JzZXJ2ZXIub2JzZXJ2ZSh0aGlzLmNvbnRlbnRFbCk7XG5cbiAgICB0aGlzLnJlc2l6ZUNhbnZhcygpO1xuICAgIHRoaXMuc2V0dXBJbnB1dEhhbmRsZXJzKCk7XG4gICAgdGhpcy5zdGFydFJlbmRlckxvb3AoKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVzaXplQ2FudmFzKCk6IHZvaWQge1xuICAgIGNvbnN0IGNhbnZhcyA9IHRoaXMuY2FudmFzRWw7XG4gICAgY29uc3Qgd3JhcHBlciA9IHRoaXMuY2FudmFzV3JhcHBlcjtcbiAgICBpZiAoIWNhbnZhcyB8fCAhd3JhcHBlcikgcmV0dXJuO1xuXG4gICAgY29uc3QgdyA9IHdyYXBwZXIuY2xpZW50V2lkdGggfHwgdGhpcy5jb250ZW50RWwuY2xpZW50V2lkdGggfHwgODAwO1xuICAgIGNvbnN0IGggPSB3cmFwcGVyLmNsaWVudEhlaWdodCB8fCB0aGlzLmNvbnRlbnRFbC5jbGllbnRIZWlnaHQgfHwgNjAwO1xuXG4gICAgdGhpcy5kcHIgPSB3aW5kb3cuZGV2aWNlUGl4ZWxSYXRpbyB8fCAxO1xuICAgIGNhbnZhcy53aWR0aCA9IE1hdGgubWF4KDEsIE1hdGguZmxvb3IodyAqIHRoaXMuZHByKSk7XG4gICAgY2FudmFzLmhlaWdodCA9IE1hdGgubWF4KDEsIE1hdGguZmxvb3IoaCAqIHRoaXMuZHByKSk7XG5cbiAgICAvLyBNYWtlIGRyYXdpbmcgY29tbWFuZHMgaW4gQ1NTIHBpeGVsc1xuICAgIGNvbnN0IGN0eCA9IHRoaXMuY3R4ITtcbiAgICBjdHguc2V0VHJhbnNmb3JtKHRoaXMuZHByLCAwLCAwLCB0aGlzLmRwciwgMCwgMCk7XG4gIH1cblxuICAvKiogUmVidWlsZCBzaW11bGF0aW9uIG5vZGVzL2VkZ2VzIGZyb20gY3VycmVudCBncmFwaERhdGEgKyBmaWx0ZXJzICovXG4gIHByaXZhdGUgcmVidWlsZFNpbURhdGEoKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLmdyYXBoRGF0YSkgcmV0dXJuO1xuXG4gICAgY29uc3QgZmlsdGVyZWQgPSB0aGlzLmFwcGx5RmlsdGVycyh0aGlzLmdyYXBoRGF0YSk7XG4gICAgY29uc3QgY29udGFpbmVyID0gdGhpcy5jb250ZW50RWw7XG4gICAgY29uc3Qgd2lkdGggPSBjb250YWluZXIuY2xpZW50V2lkdGggfHwgODAwO1xuICAgIGNvbnN0IGhlaWdodCA9IGNvbnRhaW5lci5jbGllbnRIZWlnaHQgfHwgNjAwO1xuXG4gICAgLy8gU2hvdy9oaWRlIGVtcHR5IHN0YXRlXG4gICAgY29uc3QgZXhpc3RpbmdFbXB0eSA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKFwiLm9sLWVtcHR5LXN0YXRlXCIpO1xuICAgIGlmIChleGlzdGluZ0VtcHR5KSBleGlzdGluZ0VtcHR5LnJlbW92ZSgpO1xuXG4gICAgaWYgKGZpbHRlcmVkLm5vZGVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgaWYgKHRoaXMuY2FudmFzV3JhcHBlcikgdGhpcy5jYW52YXNXcmFwcGVyLnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcbiAgICAgIGNvbnRhaW5lci5jcmVhdGVFbChcImRpdlwiLCB7XG4gICAgICAgIGNsczogXCJvbC1lbXB0eS1zdGF0ZVwiLFxuICAgICAgICB0ZXh0OiBcIk5vIG5vZGVzIG1hdGNoIHRoZSBjdXJyZW50IGZpbHRlcnMuXCIsXG4gICAgICB9KTtcbiAgICAgIGlmICh0aGlzLnNpbXVsYXRpb24pIHsgdGhpcy5zaW11bGF0aW9uLnN0b3AoKTsgdGhpcy5zaW11bGF0aW9uID0gbnVsbDsgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAodGhpcy5jYW52YXNXcmFwcGVyKSB0aGlzLmNhbnZhc1dyYXBwZXIuc3R5bGUuZGlzcGxheSA9IFwiXCI7XG5cbiAgICAvLyBQcmVzZXJ2ZSBleGlzdGluZyBub2RlIHBvc2l0aW9ucyB3aGVyZSBwb3NzaWJsZVxuICAgIGNvbnN0IG9sZFBvc2l0aW9ucyA9IG5ldyBNYXA8c3RyaW5nLCB7IHg6IG51bWJlcjsgeTogbnVtYmVyIH0+KCk7XG4gICAgZm9yIChjb25zdCBuIG9mIHRoaXMuc2ltTm9kZXMpIHtcbiAgICAgIG9sZFBvc2l0aW9ucy5zZXQobi5pZCwgeyB4OiBuLnggPz8gMCwgeTogbi55ID8/IDAgfSk7XG4gICAgfVxuXG4gICAgY29uc3Qgbm9kZUJ5SWQgPSBuZXcgTWFwPHN0cmluZywgU2ltTm9kZT4oKTtcblxuICAgIHRoaXMuc2ltTm9kZXMgPSBmaWx0ZXJlZC5ub2Rlcy5tYXAoKG4pID0+IHtcbiAgICAgIGNvbnN0IG9sZCA9IG9sZFBvc2l0aW9ucy5nZXQobi5pZCk7XG4gICAgICBjb25zdCBiYXNlQWxwaGEgPSBuLnR5cGUgPT09IFwib2JqZWN0XCIgPyAwLjkgOiAwLjU7XG4gICAgICBjb25zdCBub2RlOiBTaW1Ob2RlID0ge1xuICAgICAgICAuLi4obiBhcyBhbnkpLFxuICAgICAgICB4OiBvbGQgPyBvbGQueCA6IChNYXRoLnJhbmRvbSgpIC0gMC41KSAqIHdpZHRoICogMC40LFxuICAgICAgICB5OiBvbGQgPyBvbGQueSA6IChNYXRoLnJhbmRvbSgpIC0gMC41KSAqIGhlaWdodCAqIDAuNCxcbiAgICAgICAgdng6IDAsXG4gICAgICAgIHZ5OiAwLFxuICAgICAgICBmeDogbnVsbCxcbiAgICAgICAgZnk6IG51bGwsXG4gICAgICAgIHJhZGl1czogdGhpcy5nZXROb2RlUmFkaXVzKG4pLFxuICAgICAgICBhbHBoYTogYmFzZUFscGhhLFxuICAgICAgICB0YXJnZXRBbHBoYTogYmFzZUFscGhhLFxuICAgICAgfTtcbiAgICAgIG5vZGVCeUlkLnNldChub2RlLmlkLCBub2RlKTtcbiAgICAgIHJldHVybiBub2RlO1xuICAgIH0pO1xuXG4gICAgdGhpcy5zaW1FZGdlcyA9IGZpbHRlcmVkLmVkZ2VzXG4gICAgICAubWFwKChlKSA9PiB7XG4gICAgICAgIGNvbnN0IHMgPSBub2RlQnlJZC5nZXQoZS5zb3VyY2UpO1xuICAgICAgICBjb25zdCB0ID0gbm9kZUJ5SWQuZ2V0KGUudGFyZ2V0KTtcbiAgICAgICAgaWYgKCFzIHx8ICF0KSByZXR1cm4gbnVsbDtcbiAgICAgICAgY29uc3QgYmFzZUFscGhhID0gZS5lZGdlVHlwZSA9PT0gXCJ3aWtpXCIgPyAwLjM1IDogMC4yNTtcbiAgICAgICAgY29uc3QgZWRnZTogU2ltRWRnZSA9IHtcbiAgICAgICAgICBzb3VyY2U6IHMsXG4gICAgICAgICAgdGFyZ2V0OiB0LFxuICAgICAgICAgIGVkZ2VUeXBlOiBlLmVkZ2VUeXBlLFxuICAgICAgICAgIGFscGhhOiBiYXNlQWxwaGEsXG4gICAgICAgICAgdGFyZ2V0QWxwaGE6IGJhc2VBbHBoYSxcbiAgICAgICAgfTtcbiAgICAgICAgcmV0dXJuIGVkZ2U7XG4gICAgICB9KVxuICAgICAgLmZpbHRlcigoZSk6IGUgaXMgU2ltRWRnZSA9PiBlICE9PSBudWxsKTtcblxuICAgIHRoaXMuaG92ZXJlZE5vZGUgPSBudWxsO1xuICAgIHRoaXMuc2VsZWN0ZWROb2RlID0gbnVsbDtcbiAgICB0aGlzLmRyYWdOb2RlID0gbnVsbDtcblxuICAgIHRoaXMuc3RhcnRTaW11bGF0aW9uKCk7XG4gICAgdGhpcy51cGRhdGVIaWdobGlnaHRUYXJnZXRzKCk7XG4gICAgdGhpcy5uZWVkc1JlZHJhdyA9IHRydWU7XG4gIH1cblxuICBwcml2YXRlIHN0YXJ0U2ltdWxhdGlvbigpOiB2b2lkIHtcbiAgICAvLyBTdG9wIG9sZCBzaW1cbiAgICBpZiAodGhpcy5zaW11bGF0aW9uKSB7XG4gICAgICB0aGlzLnNpbXVsYXRpb24uc3RvcCgpO1xuICAgICAgdGhpcy5zaW11bGF0aW9uLm9uKFwidGlja1wiLCBudWxsKTtcbiAgICAgIHRoaXMuc2ltdWxhdGlvbiA9IG51bGw7XG4gICAgfVxuXG4gICAgY29uc3Qgc2ltID0gZm9yY2VTaW11bGF0aW9uPFNpbU5vZGUsIFNpbUVkZ2U+KHRoaXMuc2ltTm9kZXMpXG4gICAgICAuYWxwaGEoMSlcbiAgICAgIC5hbHBoYVRhcmdldCgwKVxuICAgICAgLmFscGhhRGVjYXkoMC4wMjI4KVxuICAgICAgLmFscGhhTWluKDAuMDAxKVxuICAgICAgLnZlbG9jaXR5RGVjYXkoMC40KTtcblxuICAgIGNvbnN0IGxpbmtGb3JjZSA9IGZvcmNlTGluazxTaW1Ob2RlLCBTaW1FZGdlPih0aGlzLnNpbUVkZ2VzKVxuICAgICAgLmRpc3RhbmNlKHRoaXMuY29uZmlnLmxpbmtEaXN0YW5jZSlcbiAgICAgIC5zdHJlbmd0aCgwLjQpO1xuXG4gICAgLy8gUmVwZWwuIENvbmZpZyBpcyBwb3NpdGl2ZSwgZDMgZXhwZWN0cyBuZWdhdGl2ZSBmb3IgcmVwdWxzaW9uLlxuICAgIGNvbnN0IGNoYXJnZUZvcmNlID0gZm9yY2VNYW55Qm9keTxTaW1Ob2RlPigpXG4gICAgICAuc3RyZW5ndGgoLXRoaXMuY29uZmlnLnJlcGVsU3RyZW5ndGgpXG4gICAgICAuZGlzdGFuY2VNYXgoTWF0aC5tYXgodGhpcy5jb25maWcucmVwZWxTdHJlbmd0aCAqIDIsIDYwMCkpO1xuXG4gICAgLy8gQ2VudGVyaW5nOiB1c2UgZm9yY2VYL1kgd2l0aCBjb25maWd1cmFibGUgc3RyZW5ndGguXG4gICAgY29uc3QgY2VudGVyWCA9IGZvcmNlWDxTaW1Ob2RlPigwKS5zdHJlbmd0aCh0aGlzLmNvbmZpZy5jZW50ZXJTdHJlbmd0aCk7XG4gICAgY29uc3QgY2VudGVyWSA9IGZvcmNlWTxTaW1Ob2RlPigwKS5zdHJlbmd0aCh0aGlzLmNvbmZpZy5jZW50ZXJTdHJlbmd0aCk7XG5cbiAgICAvLyBDb2xsaXNpb246IGd1YXJhbnRlZSBub24tb3ZlcmxhcCArIGEgbGl0dGxlIHBhZGRpbmcuXG4gICAgY29uc3QgY29sbGlkZSA9IGZvcmNlQ29sbGlkZTxTaW1Ob2RlPigoZCkgPT4gZC5yYWRpdXMgKyAxNClcbiAgICAgIC5zdHJlbmd0aCgwLjk1KVxuICAgICAgLml0ZXJhdGlvbnMoMik7XG5cbiAgICBzaW1cbiAgICAgIC5mb3JjZShcImxpbmtcIiwgbGlua0ZvcmNlKVxuICAgICAgLmZvcmNlKFwiY2hhcmdlXCIsIGNoYXJnZUZvcmNlKVxuICAgICAgLmZvcmNlKFwiY2VudGVyWFwiLCBjZW50ZXJYKVxuICAgICAgLmZvcmNlKFwiY2VudGVyWVwiLCBjZW50ZXJZKVxuICAgICAgLmZvcmNlKFwiY29sbGlkZVwiLCBjb2xsaWRlKTtcblxuICAgIHNpbS5vbihcInRpY2tcIiwgKCkgPT4ge1xuICAgICAgdGhpcy5uZWVkc1JlZHJhdyA9IHRydWU7XG4gICAgfSk7XG5cbiAgICB0aGlzLnNpbXVsYXRpb24gPSBzaW07XG4gIH1cblxuICAvKiogSGFuZGxlIGNvbmZpZyBwYW5lbCBjaGFuZ2VzIHdpdGhvdXQgcmVidWlsZGluZyB0aGUgZW50aXJlIHZpZXcgKi9cbiAgcHJpdmF0ZSBoYW5kbGVDb25maWdDaGFuZ2UobmV3Q29uZmlnOiBHcmFwaENvbmZpZyk6IHZvaWQge1xuICAgIGNvbnN0IG9sZCA9IHRoaXMuY29uZmlnO1xuICAgIHRoaXMuY29uZmlnID0gbmV3Q29uZmlnO1xuXG4gICAgY29uc3QgZmlsdGVyQ2hhbmdlZCA9XG4gICAgICBvbGQuc2hvd0ZpbGVzICE9PSBuZXdDb25maWcuc2hvd0ZpbGVzIHx8XG4gICAgICBvbGQuc2hvd09iamVjdHMgIT09IG5ld0NvbmZpZy5zaG93T2JqZWN0cyB8fFxuICAgICAgb2xkLnNob3dXaWtpRWRnZXMgIT09IG5ld0NvbmZpZy5zaG93V2lraUVkZ2VzIHx8XG4gICAgICBvbGQuc2hvd09iamVjdEVkZ2VzICE9PSBuZXdDb25maWcuc2hvd09iamVjdEVkZ2VzIHx8XG4gICAgICBvbGQuc2hvd09ycGhhbnMgIT09IG5ld0NvbmZpZy5zaG93T3JwaGFucyB8fFxuICAgICAgb2xkLnNlYXJjaCAhPT0gbmV3Q29uZmlnLnNlYXJjaCB8fFxuICAgICAgb2xkLnBhdGhGaWx0ZXIgIT09IG5ld0NvbmZpZy5wYXRoRmlsdGVyIHx8XG4gICAgICBvbGQuc291cmNlRmlsdGVyICE9PSBuZXdDb25maWcuc291cmNlRmlsdGVyO1xuXG4gICAgaWYgKGZpbHRlckNoYW5nZWQpIHtcbiAgICAgIHRoaXMucmVidWlsZFNpbURhdGEoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBVcGRhdGUgcmFkaWlcbiAgICBmb3IgKGNvbnN0IG4gb2YgdGhpcy5zaW1Ob2Rlcykge1xuICAgICAgbi5yYWRpdXMgPSB0aGlzLmdldE5vZGVSYWRpdXMobik7XG4gICAgfVxuXG4gICAgLy8gVXBkYXRlIGZvcmNlc1xuICAgIGlmICh0aGlzLnNpbXVsYXRpb24pIHtcbiAgICAgIGNvbnN0IGxpbmsgPSB0aGlzLnNpbXVsYXRpb24uZm9yY2UoXCJsaW5rXCIpIGFzIGFueTtcbiAgICAgIGxpbms/LmRpc3RhbmNlPy4obmV3Q29uZmlnLmxpbmtEaXN0YW5jZSk7XG5cbiAgICAgIGNvbnN0IGNoYXJnZSA9IHRoaXMuc2ltdWxhdGlvbi5mb3JjZShcImNoYXJnZVwiKSBhcyBhbnk7XG4gICAgICBjaGFyZ2U/LnN0cmVuZ3RoPy4oLW5ld0NvbmZpZy5yZXBlbFN0cmVuZ3RoKTtcbiAgICAgIGNoYXJnZT8uZGlzdGFuY2VNYXg/LihNYXRoLm1heChuZXdDb25maWcucmVwZWxTdHJlbmd0aCAqIDIsIDYwMCkpO1xuXG4gICAgICBjb25zdCBjeCA9IHRoaXMuc2ltdWxhdGlvbi5mb3JjZShcImNlbnRlclhcIikgYXMgYW55O1xuICAgICAgY3g/LnN0cmVuZ3RoPy4obmV3Q29uZmlnLmNlbnRlclN0cmVuZ3RoKTtcbiAgICAgIGNvbnN0IGN5ID0gdGhpcy5zaW11bGF0aW9uLmZvcmNlKFwiY2VudGVyWVwiKSBhcyBhbnk7XG4gICAgICBjeT8uc3RyZW5ndGg/LihuZXdDb25maWcuY2VudGVyU3RyZW5ndGgpO1xuXG4gICAgICBjb25zdCBjb2xsaWRlID0gdGhpcy5zaW11bGF0aW9uLmZvcmNlKFwiY29sbGlkZVwiKSBhcyBhbnk7XG4gICAgICBjb2xsaWRlPy5yYWRpdXM/LigoZDogU2ltTm9kZSkgPT4gZC5yYWRpdXMgKyAxNCk7XG5cbiAgICAgIHRoaXMuc2ltdWxhdGlvbi5hbHBoYShNYXRoLm1heCh0aGlzLnNpbXVsYXRpb24uYWxwaGEoKSwgMC4zKSkucmVzdGFydCgpO1xuICAgIH1cblxuICAgIHRoaXMudXBkYXRlSGlnaGxpZ2h0VGFyZ2V0cygpO1xuICAgIHRoaXMubmVlZHNSZWRyYXcgPSB0cnVlO1xuICB9XG5cbiAgLyogXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXG4gICAgIENhbnZhcyBEcmF3XG4gICAgIFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MCAqL1xuXG4gIHByaXZhdGUgY2xlYXIoKTogdm9pZCB7XG4gICAgY29uc3QgY3R4ID0gdGhpcy5jdHg7XG4gICAgY29uc3QgY2FudmFzID0gdGhpcy5jYW52YXNFbDtcbiAgICBpZiAoIWN0eCB8fCAhY2FudmFzKSByZXR1cm47XG4gICAgY29uc3QgdyA9IGNhbnZhcy5jbGllbnRXaWR0aDtcbiAgICBjb25zdCBoID0gY2FudmFzLmNsaWVudEhlaWdodDtcbiAgICBjdHguc2F2ZSgpO1xuICAgIGN0eC5zZXRUcmFuc2Zvcm0odGhpcy5kcHIsIDAsIDAsIHRoaXMuZHByLCAwLCAwKTtcbiAgICBjdHguZmlsbFN0eWxlID0gY29sb3JUb0NTUyh0aGlzLmNvbG9yQmcpO1xuICAgIGN0eC5nbG9iYWxBbHBoYSA9IDE7XG4gICAgY3R4LmZpbGxSZWN0KDAsIDAsIHcsIGgpO1xuICAgIGN0eC5yZXN0b3JlKCk7XG4gIH1cblxuICBwcml2YXRlIGRyYXcoKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLmN0eCB8fCAhdGhpcy5jYW52YXNFbCkgcmV0dXJuO1xuXG4gICAgLy8gVGhlbWUgbWlnaHQgY2hhbmdlIGR1cmluZyBydW50aW1lXG4gICAgdGhpcy5yZWZyZXNoQ29sb3JzKCk7XG5cbiAgICB0aGlzLmNsZWFyKCk7XG5cbiAgICBpZiAodGhpcy5zaW1Ob2Rlcy5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAgIHRoaXMuZHJhd0VkZ2VzKCk7XG4gICAgdGhpcy5kcmF3Tm9kZXMoKTtcbiAgICB0aGlzLmRyYXdMYWJlbHMoKTtcbiAgfVxuXG4gIHByaXZhdGUgZHJhd0VkZ2VzKCk6IHZvaWQge1xuICAgIGNvbnN0IGN0eCA9IHRoaXMuY3R4ITtcbiAgICBjb25zdCBjYW52YXMgPSB0aGlzLmNhbnZhc0VsITtcbiAgICBjb25zdCB3ID0gY2FudmFzLmNsaWVudFdpZHRoO1xuICAgIGNvbnN0IGggPSBjYW52YXMuY2xpZW50SGVpZ2h0O1xuICAgIGNvbnN0IGhhbGZXID0gdyAvIDI7XG4gICAgY29uc3QgaGFsZkggPSBoIC8gMjtcblxuICAgIGlmICh0aGlzLnNpbUVkZ2VzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gICAgY3R4LnNhdmUoKTtcbiAgICBjdHgubGluZVdpZHRoID0gMTtcbiAgICBjdHgubGluZUNhcCA9IFwicm91bmRcIjtcblxuICAgIGZvciAoY29uc3QgZSBvZiB0aGlzLnNpbUVkZ2VzKSB7XG4gICAgICBjb25zdCBzID0gZS5zb3VyY2UgYXMgU2ltTm9kZTtcbiAgICAgIGNvbnN0IHQgPSBlLnRhcmdldCBhcyBTaW1Ob2RlO1xuXG4gICAgICBjb25zdCBzeHcgPSBzLnggPz8gMDtcbiAgICAgIGNvbnN0IHN5dyA9IHMueSA/PyAwO1xuICAgICAgY29uc3QgdHh3ID0gdC54ID8/IDA7XG4gICAgICBjb25zdCB0eXcgPSB0LnkgPz8gMDtcblxuICAgICAgY29uc3Qgc3ggPSAoc3h3IC0gdGhpcy5jYW1YKSAqIHRoaXMuY2FtU2NhbGUgKyBoYWxmVztcbiAgICAgIGNvbnN0IHN5ID0gKHN5dyAtIHRoaXMuY2FtWSkgKiB0aGlzLmNhbVNjYWxlICsgaGFsZkg7XG4gICAgICBjb25zdCB0eCA9ICh0eHcgLSB0aGlzLmNhbVgpICogdGhpcy5jYW1TY2FsZSArIGhhbGZXO1xuICAgICAgY29uc3QgdHkgPSAodHl3IC0gdGhpcy5jYW1ZKSAqIHRoaXMuY2FtU2NhbGUgKyBoYWxmSDtcblxuICAgICAgY29uc3QgaXNXaWtpID0gZS5lZGdlVHlwZSA9PT0gXCJ3aWtpXCI7XG4gICAgICBjb25zdCBjb2wgPSBpc1dpa2kgPyB0aGlzLmNvbG9yRWRnZVdpa2kgOiB0aGlzLmNvbG9yRWRnZU9iajtcblxuICAgICAgY3R4LnN0cm9rZVN0eWxlID0gY29sb3JUb0NTUyhjb2wpO1xuICAgICAgY3R4Lmdsb2JhbEFscGhhID0gZS5hbHBoYTtcbiAgICAgIGN0eC5iZWdpblBhdGgoKTtcbiAgICAgIGN0eC5tb3ZlVG8oc3gsIHN5KTtcbiAgICAgIGN0eC5saW5lVG8odHgsIHR5KTtcbiAgICAgIGN0eC5zdHJva2UoKTtcbiAgICB9XG5cbiAgICBjdHgucmVzdG9yZSgpO1xuICB9XG5cbiAgcHJpdmF0ZSBkcmF3Tm9kZXMoKTogdm9pZCB7XG4gICAgY29uc3QgY3R4ID0gdGhpcy5jdHghO1xuICAgIGNvbnN0IGNhbnZhcyA9IHRoaXMuY2FudmFzRWwhO1xuICAgIGNvbnN0IHcgPSBjYW52YXMuY2xpZW50V2lkdGg7XG4gICAgY29uc3QgaCA9IGNhbnZhcy5jbGllbnRIZWlnaHQ7XG4gICAgY29uc3QgaGFsZlcgPSB3IC8gMjtcbiAgICBjb25zdCBoYWxmSCA9IGggLyAyO1xuICAgIGNvbnN0IGZvY3VzID0gdGhpcy5ob3ZlcmVkTm9kZSB8fCB0aGlzLnNlbGVjdGVkTm9kZTtcblxuICAgIGN0eC5zYXZlKCk7XG5cbiAgICBmb3IgKGNvbnN0IG4gb2YgdGhpcy5zaW1Ob2Rlcykge1xuICAgICAgY29uc3Qgbnh3ID0gbi54ID8/IDA7XG4gICAgICBjb25zdCBueXcgPSBuLnkgPz8gMDtcblxuICAgICAgLy8gQWxsIG5vZGVzIHVzZSB0aGUgdGhlbWUgYWNjZW50IGNvbG9yLCBleGNlcHQgb3JwaGFucyB3aGljaCBhcmUgZ3JleS5cbiAgICAgIGNvbnN0IGlzT3JwaGFuID0gKG4uY29ubmVjdGlvbnMgfHwgMCkgPT09IDA7XG5cbiAgICAgIGxldCBjb2w6IFtudW1iZXIsIG51bWJlciwgbnVtYmVyXTtcbiAgICAgIGlmIChmb2N1cyAmJiBuID09PSBmb2N1cykge1xuICAgICAgICBjb2wgPSBpc09ycGhhbiA/IHRoaXMuY29sb3JOb2RlRmlsZSA6IHRoaXMuY29sb3JIaWdobGlnaHQ7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb2wgPSBpc09ycGhhbiA/IHRoaXMuY29sb3JOb2RlRmlsZSA6IHRoaXMuY29sb3JOb2RlT2JqZWN0O1xuICAgICAgfVxuXG4gICAgICBjb25zdCBjeCA9IChueHcgLSB0aGlzLmNhbVgpICogdGhpcy5jYW1TY2FsZSArIGhhbGZXO1xuICAgICAgY29uc3QgY3kgPSAobnl3IC0gdGhpcy5jYW1ZKSAqIHRoaXMuY2FtU2NhbGUgKyBoYWxmSDtcblxuICAgICAgLy8gQ2xhbXAgbm9kZSBzaXplIG9uIHNjcmVlbiBzbyB6b29taW5nIGluIGRvZXNuJ3QgY3JlYXRlIGdpYW50IGJhbGxzLlxuICAgICAgY29uc3QgbWF4UiA9IE1hdGgubWF4KDIsIHRoaXMuY29uZmlnLm5vZGVNYXhTY3JlZW5SYWRpdXMpO1xuICAgICAgY29uc3QgciA9IE1hdGgubWluKG1heFIsIG4ucmFkaXVzICogdGhpcy5jYW1TY2FsZSk7XG5cbiAgICAgIGN0eC5maWxsU3R5bGUgPSBjb2xvclRvQ1NTKGNvbCk7XG4gICAgICBjdHguZ2xvYmFsQWxwaGEgPSBuLmFscGhhO1xuICAgICAgY3R4LmJlZ2luUGF0aCgpO1xuICAgICAgY3R4LmFyYyhjeCwgY3ksIHIsIDAsIE1hdGguUEkgKiAyKTtcbiAgICAgIGN0eC5maWxsKCk7XG4gICAgfVxuXG4gICAgY3R4LnJlc3RvcmUoKTtcbiAgfVxuXG4gIHByaXZhdGUgZHJhd0xhYmVscygpOiB2b2lkIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCE7XG4gICAgY29uc3QgY2FudmFzID0gdGhpcy5jYW52YXNFbCE7XG4gICAgY29uc3QgdyA9IGNhbnZhcy5jbGllbnRXaWR0aDtcbiAgICBjb25zdCBoID0gY2FudmFzLmNsaWVudEhlaWdodDtcbiAgICBjb25zdCBoYWxmVyA9IHcgLyAyO1xuICAgIGNvbnN0IGhhbGZIID0gaCAvIDI7XG5cbiAgICBjb25zdCBsYWJlbE9wYWNpdHkgPSB0aGlzLmNvbmZpZy5sYWJlbE9wYWNpdHk7XG4gICAgY29uc3Qgem9vbUZhY3RvciA9IHRoaXMuY2FtU2NhbGU7XG5cbiAgICAvLyBPbmx5IHNob3cgbGFiZWxzIGFmdGVyIGEgem9vbSB0aHJlc2hvbGQgKGNvbmZpZ3VyYWJsZSksIGFuZCBzY2FsZSBmb250IHNtb290aGx5LlxuICAgIGNvbnN0IGJhc2VGb250U2l6ZSA9IDExO1xuICAgIGNvbnN0IGZvbnRTaXplID0gTWF0aC5tYXgoOCwgTWF0aC5taW4oMTYsIGJhc2VGb250U2l6ZSAqIE1hdGguc3FydCh6b29tRmFjdG9yKSkpO1xuICAgIGNvbnN0IG1pblpvb20gPSBNYXRoLm1heCgwLCB0aGlzLmNvbmZpZy5sYWJlbE1pblpvb20pO1xuICAgIGNvbnN0IHpvb21HYXRlID0gem9vbUZhY3RvciA+PSBtaW5ab29tO1xuXG4gICAgaWYgKCF6b29tR2F0ZSkgcmV0dXJuO1xuXG4gICAgY3R4LnNhdmUoKTtcbiAgICBjdHguZm9udCA9IGAke2ZvbnRTaXplfXB4IC1hcHBsZS1zeXN0ZW0sIEJsaW5rTWFjU3lzdGVtRm9udCwgXCJTZWdvZSBVSVwiLCBSb2JvdG8sIHNhbnMtc2VyaWZgO1xuICAgIGN0eC50ZXh0QWxpZ24gPSBcImNlbnRlclwiO1xuICAgIGN0eC50ZXh0QmFzZWxpbmUgPSBcInRvcFwiO1xuICAgIGN0eC5maWxsU3R5bGUgPSB0aGlzLmNvbG9yVGV4dDtcblxuICAgIGNvbnN0IHBsYWNlZFJlY3RzOiBBcnJheTx7IHg6IG51bWJlcjsgeTogbnVtYmVyOyB3OiBudW1iZXI7IGg6IG51bWJlciB9PiA9IFtdO1xuICAgIGNvbnN0IGludGVyc2VjdHMgPSAocjE6IGFueSwgcjI6IGFueSkgPT5cbiAgICAgIHIxLnggPCByMi54ICsgcjIudyAmJiByMS54ICsgcjEudyA+IHIyLnggJiYgcjEueSA8IHIyLnkgKyByMi5oICYmIHIxLnkgKyByMS5oID4gcjIueTtcblxuICAgIC8vIEdyZWVkeSBsYWJlbCBwbGFjZW1lbnQgdG8gcmVkdWNlIG92ZXJsYXBwaW5nIGxhYmVscy5cbiAgICBjb25zdCBvcmRlcmVkTm9kZXMgPSBbLi4udGhpcy5zaW1Ob2Rlc10uc29ydCgoYSwgYikgPT4ge1xuICAgICAgaWYgKGIuYWxwaGEgIT09IGEuYWxwaGEpIHJldHVybiBiLmFscGhhIC0gYS5hbHBoYTtcbiAgICAgIHJldHVybiAoYi5jb25uZWN0aW9ucyB8fCAwKSAtIChhLmNvbm5lY3Rpb25zIHx8IDApO1xuICAgIH0pO1xuXG4gICAgY29uc3QgbWF4VyA9IE1hdGgubWF4KDQwLCB0aGlzLmNvbmZpZy5sYWJlbE1heFdpZHRoIHx8IDE2MCk7XG4gICAgY29uc3QgZWxsaXBzaXMgPSBcIlx1MjAyNlwiO1xuXG4gICAgZm9yIChjb25zdCBuIG9mIG9yZGVyZWROb2Rlcykge1xuICAgICAgY29uc3Qgbnh3ID0gbi54ID8/IDA7XG4gICAgICBjb25zdCBueXcgPSBuLnkgPz8gMDtcbiAgICAgIGNvbnN0IHN4ID0gKG54dyAtIHRoaXMuY2FtWCkgKiB0aGlzLmNhbVNjYWxlICsgaGFsZlc7XG4gICAgICBjb25zdCBzeSA9IChueXcgLSB0aGlzLmNhbVkpICogdGhpcy5jYW1TY2FsZSArIGhhbGZIO1xuICAgICAgY29uc3Qgc2NyZWVuWSA9IHN5ICsgbi5yYWRpdXMgKiB0aGlzLmNhbVNjYWxlICsgNjtcblxuICAgICAgLy8gQ3VsbCBvZmYtc2NyZWVuIGxhYmVsc1xuICAgICAgaWYgKHN4IDwgLTEwMCB8fCBzeCA+IHcgKyAxMDAgfHwgc3kgPCAtMTAwIHx8IHN5ID4gaCArIDEwMCkgY29udGludWU7XG5cbiAgICAgIGxldCBhbHBoYTogbnVtYmVyO1xuICAgICAgaWYgKG4udGFyZ2V0QWxwaGEgPCAwLjEpIHtcbiAgICAgICAgYWxwaGEgPSBNYXRoLm1pbihsYWJlbE9wYWNpdHksIG4uYWxwaGEpICogMC4zO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYWxwaGEgPSBsYWJlbE9wYWNpdHkgKiAobi5hbHBoYSAvIE1hdGgubWF4KDAuMDAwMSwgbi50YXJnZXRBbHBoYSkpO1xuICAgICAgICBpZiAobiA9PT0gKHRoaXMuaG92ZXJlZE5vZGUgfHwgdGhpcy5zZWxlY3RlZE5vZGUpKSBhbHBoYSA9IDEuMDtcbiAgICAgIH1cblxuICAgICAgaWYgKGFscGhhIDwgMC4wMSkgY29udGludWU7XG5cbiAgICAgIC8vIFRydW5jYXRlIGxhYmVsIHRvIGEgbWF4IHBpeGVsIHdpZHRoLlxuICAgICAgY29uc3QgZnVsbCA9IG4ubGFiZWw7XG4gICAgICBsZXQgc2hvd24gPSBmdWxsO1xuICAgICAgaWYgKGN0eC5tZWFzdXJlVGV4dChmdWxsKS53aWR0aCA+IG1heFcpIHtcbiAgICAgICAgbGV0IGxvID0gMCwgaGkgPSBmdWxsLmxlbmd0aDtcbiAgICAgICAgd2hpbGUgKGxvIDwgaGkpIHtcbiAgICAgICAgICBjb25zdCBtaWQgPSBNYXRoLmNlaWwoKGxvICsgaGkpIC8gMik7XG4gICAgICAgICAgY29uc3QgY2FuZGlkYXRlID0gZnVsbC5zbGljZSgwLCBtaWQpICsgZWxsaXBzaXM7XG4gICAgICAgICAgaWYgKGN0eC5tZWFzdXJlVGV4dChjYW5kaWRhdGUpLndpZHRoIDw9IG1heFcpIGxvID0gbWlkO1xuICAgICAgICAgIGVsc2UgaGkgPSBtaWQgLSAxO1xuICAgICAgICB9XG4gICAgICAgIHNob3duID0gZnVsbC5zbGljZSgwLCBNYXRoLm1heCgwLCBsbykpICsgZWxsaXBzaXM7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG1ldHJpY3MgPSBjdHgubWVhc3VyZVRleHQoc2hvd24pO1xuICAgICAgY29uc3QgdGV4dFcgPSBtZXRyaWNzLndpZHRoO1xuICAgICAgY29uc3QgdGV4dEggPSBmb250U2l6ZTsgLy8gZ29vZCBlbm91Z2ggZm9yIG92ZXJsYXAgY3VsbGluZ1xuXG4gICAgICBjb25zdCBwYWQgPSAzO1xuICAgICAgY29uc3QgcmVjdCA9IHtcbiAgICAgICAgeDogc3ggLSB0ZXh0VyAvIDIgLSBwYWQsXG4gICAgICAgIHk6IHNjcmVlblkgLSBwYWQsXG4gICAgICAgIHc6IHRleHRXICsgcGFkICogMixcbiAgICAgICAgaDogdGV4dEggKyBwYWQgKiAyLFxuICAgICAgfTtcblxuICAgICAgbGV0IGNvbGxpZGVzID0gZmFsc2U7XG4gICAgICBmb3IgKGNvbnN0IHIgb2YgcGxhY2VkUmVjdHMpIHtcbiAgICAgICAgaWYgKGludGVyc2VjdHMocmVjdCwgcikpIHsgY29sbGlkZXMgPSB0cnVlOyBicmVhazsgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBpc0ZvY3VzID0gbiA9PT0gKHRoaXMuaG92ZXJlZE5vZGUgfHwgdGhpcy5zZWxlY3RlZE5vZGUpO1xuICAgICAgaWYgKCFpc0ZvY3VzICYmIGNvbGxpZGVzKSBjb250aW51ZTtcblxuICAgICAgY3R4Lmdsb2JhbEFscGhhID0gYWxwaGE7XG4gICAgICBjdHguZmlsbFRleHQoc2hvd24sIHN4LCBzY3JlZW5ZKTtcbiAgICAgIHBsYWNlZFJlY3RzLnB1c2gocmVjdCk7XG4gICAgfVxuXG4gICAgY3R4LnJlc3RvcmUoKTtcbiAgfVxuXG4gIC8qIFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFxuICAgICBJbnB1dCBIYW5kbGVyc1xuICAgICBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTAgKi9cblxuICBwcml2YXRlIHNldHVwSW5wdXRIYW5kbGVycygpOiB2b2lkIHtcbiAgICBjb25zdCBjYW52YXMgPSB0aGlzLmNhbnZhc0VsITtcbiAgICBjb25zdCBjb250YWluZXIgPSB0aGlzLmNvbnRlbnRFbDtcblxuICAgIC8vIGQzLXpvb20gKHBhbiArIHdoZWVsIHpvb20pIG9uIGNhbnZhcy5cbiAgICAvLyBXZSBrZWVwIG91ciBvd24gKGNhbVgvY2FtWS9jYW1TY2FsZSkgY2FtZXJhLCBidXQgZHJpdmUgdGFyZ2V0Q2FtKiBmcm9tIHpvb20gdHJhbnNmb3JtLlxuICAgIGNvbnN0IHVwZGF0ZVRhcmdldEZyb21ab29tID0gKHQ6IGFueSwgc291cmNlRXZlbnQ/OiBFdmVudCB8IG51bGwpID0+IHtcbiAgICAgIGNvbnN0IHcgPSBjYW52YXMuY2xpZW50V2lkdGg7XG4gICAgICBjb25zdCBoID0gY2FudmFzLmNsaWVudEhlaWdodDtcbiAgICAgIGNvbnN0IGsgPSBNYXRoLm1heCgwLjAzLCBNYXRoLm1pbigxMiwgdC5rKSk7XG4gICAgICBjb25zdCB4ID0gdC54O1xuICAgICAgY29uc3QgeSA9IHQueTtcblxuICAgICAgLy8gc2NyZWVuID0gd29ybGQgKiBrICsgKHgsIHkpXG4gICAgICAvLyBvdXIgY2FtZXJhOiBzY3JlZW4gPSAod29ybGQgLSBjYW0pICogayArICh3LzIsaC8yKVxuICAgICAgLy8gPT4geCA9IC1jYW1YKmsgKyB3LzIgID0+IGNhbVggPSAody8yIC0geCkva1xuICAgICAgY29uc3QgY2FtWCA9ICh3IC8gMiAtIHgpIC8gaztcbiAgICAgIGNvbnN0IGNhbVkgPSAoaCAvIDIgLSB5KSAvIGs7XG5cbiAgICAgIHRoaXMuem9vbVRyYW5zZm9ybSA9IHQ7XG4gICAgICB0aGlzLnRhcmdldENhbVNjYWxlID0gaztcbiAgICAgIHRoaXMudGFyZ2V0Q2FtWCA9IGNhbVg7XG4gICAgICB0aGlzLnRhcmdldENhbVkgPSBjYW1ZO1xuXG4gICAgICAvLyBGb3IgZHJhZy1wYW5uaW5nLCBhdm9pZCBjYW1lcmEgbGFnIChrZWVwIGl0IDE6MSkuXG4gICAgICBjb25zdCBzZTogYW55ID0gc291cmNlRXZlbnQgYXMgYW55O1xuICAgICAgY29uc3QgaXNXaGVlbCA9IHNlPy50eXBlID09PSBcIndoZWVsXCI7XG4gICAgICBpZiAoIWlzV2hlZWwpIHtcbiAgICAgICAgdGhpcy5jYW1TY2FsZSA9IHRoaXMudGFyZ2V0Q2FtU2NhbGU7XG4gICAgICAgIHRoaXMuY2FtWCA9IHRoaXMudGFyZ2V0Q2FtWDtcbiAgICAgICAgdGhpcy5jYW1ZID0gdGhpcy50YXJnZXRDYW1ZO1xuICAgICAgfVxuXG4gICAgICB0aGlzLm5lZWRzUmVkcmF3ID0gdHJ1ZTtcbiAgICB9O1xuXG4gICAgLy8gQXR0YWNoIHpvb20gYmVoYXZpb3Igb25jZS5cbiAgICBpZiAoIXRoaXMuem9vbUJlaGF2aW9yKSB7XG4gICAgICB0aGlzLnpvb21CZWhhdmlvciA9IHpvb208SFRNTENhbnZhc0VsZW1lbnQsIHVua25vd24+KClcbiAgICAgICAgLnNjYWxlRXh0ZW50KFswLjAzLCAxMl0pXG4gICAgICAgIC5maWx0ZXIoKGV2ZW50OiBhbnkpID0+IHtcbiAgICAgICAgICAvLyBEaXNhYmxlIHBhbi96b29tIHdoaWxlIGRyYWdnaW5nIGEgbm9kZS5cbiAgICAgICAgICBpZiAodGhpcy5kcmFnTm9kZSkgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgIC8vIE9ubHkgbGVmdCBtb3VzZSBmb3IgZHJhZy1wYW4uXG4gICAgICAgICAgaWYgKGV2ZW50Py50eXBlPy5zdGFydHNXaXRoKFwibW91c2VcIikgJiYgZXZlbnQuYnV0dG9uICE9PSAwKSByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH0pXG4gICAgICAgIC5vbihcInpvb21cIiwgKGV2ZW50OiBhbnkpID0+IHtcbiAgICAgICAgICBpZiAodGhpcy5pc1N5bmNpbmdab29tKSByZXR1cm47XG4gICAgICAgICAgdXBkYXRlVGFyZ2V0RnJvbVpvb20oZXZlbnQudHJhbnNmb3JtLCBldmVudC5zb3VyY2VFdmVudCk7XG4gICAgICAgIH0pO1xuXG4gICAgICBjb25zdCBzZWwgPSBzZWxlY3QoY2FudmFzKTtcbiAgICAgIHNlbC5jYWxsKHRoaXMuem9vbUJlaGF2aW9yIGFzIGFueSk7XG4gICAgICAvLyBXZSBoYW5kbGUgZG91YmxlIGNsaWNrIG91cnNlbHZlcyAob3BlbiBub2RlKSwgc28gZGlzYWJsZSBkMydzIGRlZmF1bHQgem9vbS1vbi1kYmxjbGljay5cbiAgICAgIHNlbC5vbihcImRibGNsaWNrLnpvb21cIiwgbnVsbCk7XG5cbiAgICAgIC8vIEluaXRpYWxpemUgdHJhbnNmb3JtIHRvIG1hdGNoIG91ciBzdGFydGluZyBjYW1lcmEuXG4gICAgICBjb25zdCB3ID0gY2FudmFzLmNsaWVudFdpZHRoO1xuICAgICAgY29uc3QgaCA9IGNhbnZhcy5jbGllbnRIZWlnaHQ7XG4gICAgICBjb25zdCBrID0gdGhpcy50YXJnZXRDYW1TY2FsZTtcbiAgICAgIGNvbnN0IHggPSAtdGhpcy50YXJnZXRDYW1YICogayArIHcgLyAyO1xuICAgICAgY29uc3QgeSA9IC10aGlzLnRhcmdldENhbVkgKiBrICsgaCAvIDI7XG4gICAgICB0aGlzLmlzU3luY2luZ1pvb20gPSB0cnVlO1xuICAgICAgdHJ5IHtcbiAgICAgICAgc2VsLmNhbGwoKHRoaXMuem9vbUJlaGF2aW9yIGFzIGFueSkudHJhbnNmb3JtLCB6b29tSWRlbnRpdHkudHJhbnNsYXRlKHgsIHkpLnNjYWxlKGspKTtcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIHRoaXMuaXNTeW5jaW5nWm9vbSA9IGZhbHNlO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIE1vdXNlIGRvd246IG9ubHkgdXNlZCBmb3Igbm9kZSBkcmFnICsgY2xpY2sgc2VsZWN0aW9uIHRyYWNraW5nLlxuICAgIGxldCBkb3duWCA9IDA7XG4gICAgbGV0IGRvd25ZID0gMDtcbiAgICBsZXQgZG93bk5vZGU6IFNpbU5vZGUgfCBudWxsID0gbnVsbDtcblxuICAgIHRoaXMuX29uTW91c2VEb3duID0gKGU6IE1vdXNlRXZlbnQpID0+IHtcbiAgICAgIGlmIChlLmJ1dHRvbiAhPT0gMCkgcmV0dXJuO1xuICAgICAgY29uc3QgcmVjdCA9IGNhbnZhcy5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgIGNvbnN0IG14ID0gZS5jbGllbnRYIC0gcmVjdC5sZWZ0O1xuICAgICAgY29uc3QgbXkgPSBlLmNsaWVudFkgLSByZWN0LnRvcDtcbiAgICAgIGRvd25YID0gZS5jbGllbnRYO1xuICAgICAgZG93blkgPSBlLmNsaWVudFk7XG4gICAgICBkb3duTm9kZSA9IHRoaXMuaGl0VGVzdE5vZGUobXgsIG15KTtcblxuICAgICAgaWYgKGRvd25Ob2RlKSB7XG4gICAgICAgIC8vIFByZXZlbnQgZDMtem9vbSBmcm9tIHN0YXJ0aW5nIGEgcGFuIHdoZW4gd2UgaW50ZW5kIHRvIGRyYWcgYSBub2RlLlxuICAgICAgICBlLnN0b3BQcm9wYWdhdGlvbigpO1xuXG4gICAgICAgIHRoaXMuZHJhZ05vZGUgPSBkb3duTm9kZTtcbiAgICAgICAgdGhpcy5pc0RyYWdnaW5nID0gZmFsc2U7XG4gICAgICAgIGRvd25Ob2RlLmZ4ID0gZG93bk5vZGUueCA/PyAwO1xuICAgICAgICBkb3duTm9kZS5meSA9IGRvd25Ob2RlLnkgPz8gMDtcbiAgICAgICAgdGhpcy5zaW11bGF0aW9uPy5hbHBoYVRhcmdldCgwLjMpLnJlc3RhcnQoKTtcbiAgICAgIH1cbiAgICB9O1xuICAgIGNhbnZhcy5hZGRFdmVudExpc3RlbmVyKFwibW91c2Vkb3duXCIsIHRoaXMuX29uTW91c2VEb3duLCB7IGNhcHR1cmU6IHRydWUgfSk7XG5cbiAgICAvLyBNb3VzZSBtb3ZlOiB1cGRhdGUgbm9kZSBkcmFnIE9SIGhvdmVyL3Rvb2x0aXAuXG4gICAgdGhpcy5fb25Nb3VzZU1vdmUgPSAoZTogTW91c2VFdmVudCkgPT4ge1xuICAgICAgY29uc3QgcmVjdCA9IGNhbnZhcy5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgIGNvbnN0IG14ID0gZS5jbGllbnRYIC0gcmVjdC5sZWZ0O1xuICAgICAgY29uc3QgbXkgPSBlLmNsaWVudFkgLSByZWN0LnRvcDtcblxuICAgICAgaWYgKHRoaXMuZHJhZ05vZGUpIHtcbiAgICAgICAgdGhpcy5pc0RyYWdnaW5nID0gdHJ1ZTtcbiAgICAgICAgY29uc3QgW3d4LCB3eV0gPSB0aGlzLnNjcmVlblRvV29ybGQobXgsIG15KTtcbiAgICAgICAgdGhpcy5kcmFnTm9kZS5meCA9IHd4O1xuICAgICAgICB0aGlzLmRyYWdOb2RlLmZ5ID0gd3k7XG4gICAgICAgIHRoaXMubmVlZHNSZWRyYXcgPSB0cnVlO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIC8vIEhvdmVyIGRldGVjdGlvblxuICAgICAgY29uc3Qgbm9kZSA9IHRoaXMuaGl0VGVzdE5vZGUobXgsIG15KTtcbiAgICAgIGlmIChub2RlICE9PSB0aGlzLmhvdmVyZWROb2RlKSB7XG4gICAgICAgIHRoaXMuaG92ZXJlZE5vZGUgPSBub2RlO1xuICAgICAgICBjYW52YXMuc3R5bGUuY3Vyc29yID0gbm9kZSA/IFwicG9pbnRlclwiIDogXCJkZWZhdWx0XCI7XG4gICAgICAgIHRoaXMudXBkYXRlSGlnaGxpZ2h0VGFyZ2V0cygpO1xuXG4gICAgICAgIGlmIChub2RlKSB7XG4gICAgICAgICAgdGhpcy5zaG93VG9vbHRpcChub2RlLCBjb250YWluZXIpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMuaGlkZVRvb2x0aXAoY29udGFpbmVyKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmIChub2RlKSB7XG4gICAgICAgIHRoaXMubW92ZVRvb2x0aXAoZSwgY29udGFpbmVyKTtcbiAgICAgIH1cbiAgICB9O1xuICAgIGNhbnZhcy5hZGRFdmVudExpc3RlbmVyKFwibW91c2Vtb3ZlXCIsIHRoaXMuX29uTW91c2VNb3ZlKTtcblxuICAgIC8vIE1vdXNlIHVwOiBkcm9wIGRyYWcgbm9kZSwgaGFuZGxlIGNsaWNrL3NlbGVjdC9kYmxjbGljayBsb2dpYy5cbiAgICB0aGlzLl9vbk1vdXNlVXAgPSAoZTogTW91c2VFdmVudCkgPT4ge1xuICAgICAgY29uc3QgdXBEeCA9IE1hdGguYWJzKGUuY2xpZW50WCAtIGRvd25YKTtcbiAgICAgIGNvbnN0IHVwRHkgPSBNYXRoLmFicyhlLmNsaWVudFkgLSBkb3duWSk7XG4gICAgICBjb25zdCBpc0NsaWNrID0gdXBEeCA8IDMgJiYgdXBEeSA8IDM7XG5cbiAgICAgIGlmICh0aGlzLmRyYWdOb2RlKSB7XG4gICAgICAgIGNvbnN0IHdhc0RyYWdnaW5nID0gdGhpcy5pc0RyYWdnaW5nO1xuICAgICAgICB0aGlzLmRyYWdOb2RlLmZ4ID0gbnVsbDtcbiAgICAgICAgdGhpcy5kcmFnTm9kZS5meSA9IG51bGw7XG5cbiAgICAgICAgaWYgKCF3YXNEcmFnZ2luZykge1xuICAgICAgICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XG4gICAgICAgICAgY29uc3Qgbm9kZSA9IHRoaXMuZHJhZ05vZGU7XG5cbiAgICAgICAgICBpZiAodGhpcy5sYXN0Q2xpY2tJZCA9PT0gbm9kZS5pZCAmJiBub3cgLSB0aGlzLmxhc3RDbGlja1RpbWUgPCAzMDApIHtcbiAgICAgICAgICAgIGlmIChub2RlLnR5cGUgPT09IFwib2JqZWN0XCIgJiYgdGhpcy5uYXZpZ2F0ZVRvT2JqZWN0KSB7XG4gICAgICAgICAgICAgIHRoaXMubmF2aWdhdGVUb09iamVjdChub2RlLmZpbGVQYXRoLCBub2RlLnN0YXJ0TGluZSk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKG5vZGUudHlwZSA9PT0gXCJmaWxlXCIgJiYgdGhpcy5uYXZpZ2F0ZVRvRmlsZSkge1xuICAgICAgICAgICAgICB0aGlzLm5hdmlnYXRlVG9GaWxlKG5vZGUuZmlsZVBhdGgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5sYXN0Q2xpY2tUaW1lID0gMDtcbiAgICAgICAgICAgIHRoaXMubGFzdENsaWNrSWQgPSBcIlwiO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmxhc3RDbGlja1RpbWUgPSBub3c7XG4gICAgICAgICAgICB0aGlzLmxhc3RDbGlja0lkID0gbm9kZS5pZDtcbiAgICAgICAgICAgIHRoaXMuc2VsZWN0ZWROb2RlID0gbm9kZTtcbiAgICAgICAgICAgIHRoaXMudXBkYXRlSGlnaGxpZ2h0VGFyZ2V0cygpO1xuICAgICAgICAgICAgdGhpcy5zaG93SW5mb1BhbmVsKG5vZGUsIGNvbnRhaW5lcik7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5kcmFnTm9kZSA9IG51bGw7XG4gICAgICAgIHRoaXMuaXNEcmFnZ2luZyA9IGZhbHNlO1xuICAgICAgICB0aGlzLnNpbXVsYXRpb24/LmFscGhhVGFyZ2V0KDApO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIC8vIENsaWNrIG9uIGVtcHR5IHNwYWNlIGNsZWFycyBzZWxlY3Rpb24uXG4gICAgICBpZiAoaXNDbGljayAmJiAhZG93bk5vZGUpIHtcbiAgICAgICAgdGhpcy5zZWxlY3RlZE5vZGUgPSBudWxsO1xuICAgICAgICB0aGlzLnVwZGF0ZUhpZ2hsaWdodFRhcmdldHMoKTtcbiAgICAgICAgdGhpcy5yZW1vdmVJbmZvUGFuZWwoY29udGFpbmVyKTtcbiAgICAgIH1cbiAgICB9O1xuICAgIGNhbnZhcy5hZGRFdmVudExpc3RlbmVyKFwibW91c2V1cFwiLCB0aGlzLl9vbk1vdXNlVXApO1xuXG4gICAgLy8gUHJldmVudCBicm93c2VyIGRlZmF1bHRzXG4gICAgdGhpcy5fb25EYmxDbGljayA9IChlOiBNb3VzZUV2ZW50KSA9PiB7IGUucHJldmVudERlZmF1bHQoKTsgfTtcbiAgICBjYW52YXMuYWRkRXZlbnRMaXN0ZW5lcihcImRibGNsaWNrXCIsIHRoaXMuX29uRGJsQ2xpY2spO1xuICB9XG5cbiAgLyogXHUyNTAwXHUyNTAwIFRvb2x0aXAgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwICovXG5cbiAgcHJpdmF0ZSBzaG93VG9vbHRpcChub2RlOiBTaW1Ob2RlLCBjb250YWluZXI6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgbGV0IHRvb2x0aXAgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcihcIi5vbC10b29sdGlwXCIpIGFzIEhUTUxFbGVtZW50O1xuICAgIGlmICghdG9vbHRpcCkge1xuICAgICAgdG9vbHRpcCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICB0b29sdGlwLmNsYXNzTmFtZSA9IFwib2wtdG9vbHRpcFwiO1xuICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKHRvb2x0aXApO1xuICAgIH1cbiAgICB0b29sdGlwLnRleHRDb250ZW50ID0gbm9kZS5sYWJlbDtcbiAgICB0b29sdGlwLnN0eWxlLmRpc3BsYXkgPSBcImJsb2NrXCI7XG4gIH1cblxuICBwcml2YXRlIG1vdmVUb29sdGlwKGU6IE1vdXNlRXZlbnQsIGNvbnRhaW5lcjogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICBjb25zdCB0b29sdGlwID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoXCIub2wtdG9vbHRpcFwiKSBhcyBIVE1MRWxlbWVudDtcbiAgICBpZiAoIXRvb2x0aXApIHJldHVybjtcbiAgICBjb25zdCByZWN0ID0gY29udGFpbmVyLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgIHRvb2x0aXAuc3R5bGUubGVmdCA9IGUuY2xpZW50WCAtIHJlY3QubGVmdCArIDE0ICsgXCJweFwiO1xuICAgIHRvb2x0aXAuc3R5bGUudG9wID0gZS5jbGllbnRZIC0gcmVjdC50b3AgLSAxMCArIFwicHhcIjtcbiAgfVxuXG4gIHByaXZhdGUgaGlkZVRvb2x0aXAoY29udGFpbmVyOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIGNvbnN0IHRvb2x0aXAgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcihcIi5vbC10b29sdGlwXCIpIGFzIEhUTUxFbGVtZW50O1xuICAgIGlmICh0b29sdGlwKSB0b29sdGlwLnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcbiAgfVxuXG4gIC8qIFx1MjUwMFx1MjUwMCBJbmZvIFBhbmVsIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMCAqL1xuXG4gIHByaXZhdGUgcmVtb3ZlSW5mb1BhbmVsKGNvbnRhaW5lcjogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICBjb25zdCBwYW5lbCA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKFwiLm9sLWluZm8tcGFuZWxcIik7XG4gICAgaWYgKHBhbmVsKSBwYW5lbC5yZW1vdmUoKTtcbiAgfVxuXG4gIHByaXZhdGUgc2hvd0luZm9QYW5lbChkOiBTaW1Ob2RlLCBjb250YWluZXI6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgdGhpcy5yZW1vdmVJbmZvUGFuZWwoY29udGFpbmVyKTtcblxuICAgIGNvbnN0IHBhbmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICBwYW5lbC5jbGFzc05hbWUgPSBcIm9sLWluZm8tcGFuZWxcIjtcblxuICAgIGNvbnN0IHRpdGxlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICB0aXRsZS5jbGFzc05hbWUgPSBcIm9sLWluZm8tdGl0bGVcIjtcbiAgICB0aXRsZS50ZXh0Q29udGVudCA9IGQubGFiZWw7XG4gICAgcGFuZWwuYXBwZW5kQ2hpbGQodGl0bGUpO1xuXG4gICAgY29uc3QgYmFkZ2UgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIGJhZGdlLmNsYXNzTmFtZSA9IGBvbC1pbmZvLXR5cGUgb2wtaW5mby10eXBlLSR7ZC50eXBlfWA7XG4gICAgYmFkZ2UudGV4dENvbnRlbnQgPSBkLnR5cGUgPT09IFwib2JqZWN0XCIgPyBcIk9iamVjdFwiIDogXCJGaWxlXCI7XG4gICAgcGFuZWwuYXBwZW5kQ2hpbGQoYmFkZ2UpO1xuXG4gICAgY29uc3QgZmlsZVBhdGggPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIGZpbGVQYXRoLmNsYXNzTmFtZSA9IFwib2wtaW5mby1maWxlXCI7XG4gICAgZmlsZVBhdGgudGV4dENvbnRlbnQgPSBkLmZpbGVQYXRoO1xuICAgIHBhbmVsLmFwcGVuZENoaWxkKGZpbGVQYXRoKTtcblxuICAgIGlmIChkLnR5cGUgPT09IFwib2JqZWN0XCIgJiYgT2JqZWN0LmtleXMoZC5wcm9wZXJ0aWVzKS5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBwcm9wcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICBwcm9wcy5jbGFzc05hbWUgPSBcIm9sLWluZm8tcHJvcHNcIjtcbiAgICAgIGZvciAoY29uc3QgW2ssIHZdIG9mIE9iamVjdC5lbnRyaWVzKGQucHJvcGVydGllcykpIHtcbiAgICAgICAgY29uc3Qgcm93ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgICAgcm93LmNsYXNzTmFtZSA9IFwib2wtaW5mby1wcm9wLXJvd1wiO1xuICAgICAgICBjb25zdCBrZXlFbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgICAgICBrZXlFbC5jbGFzc05hbWUgPSBcIm9sLWluZm8tcHJvcC1rZXlcIjtcbiAgICAgICAga2V5RWwudGV4dENvbnRlbnQgPSBrO1xuICAgICAgICBjb25zdCB2YWxFbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgICAgICB2YWxFbC5jbGFzc05hbWUgPSBcIm9sLWluZm8tcHJvcC12YWxcIjtcbiAgICAgICAgdmFsRWwudGV4dENvbnRlbnQgPSB2O1xuICAgICAgICByb3cuYXBwZW5kQ2hpbGQoa2V5RWwpO1xuICAgICAgICByb3cuYXBwZW5kQ2hpbGQodmFsRWwpO1xuICAgICAgICBwcm9wcy5hcHBlbmRDaGlsZChyb3cpO1xuICAgICAgfVxuICAgICAgcGFuZWwuYXBwZW5kQ2hpbGQocHJvcHMpO1xuICAgIH1cblxuICAgIGNvbnN0IGNvbm4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIGNvbm4uY2xhc3NOYW1lID0gXCJvbC1pbmZvLWNvbm5lY3Rpb25zXCI7XG4gICAgY29ubi50ZXh0Q29udGVudCA9IGAke2QuY29ubmVjdGlvbnN9IGNvbm5lY3Rpb24ke2QuY29ubmVjdGlvbnMgIT09IDEgPyBcInNcIiA6IFwiXCJ9YDtcbiAgICBwYW5lbC5hcHBlbmRDaGlsZChjb25uKTtcblxuICAgIGNvbnN0IGdvQnRuID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImJ1dHRvblwiKTtcbiAgICBnb0J0bi5jbGFzc05hbWUgPSBcIm9sLWluZm8tZ28tYnRuXCI7XG4gICAgZ29CdG4udGV4dENvbnRlbnQgPSBkLnR5cGUgPT09IFwib2JqZWN0XCIgPyBcIkdvIHRvIG9iamVjdFwiIDogXCJPcGVuIGZpbGVcIjtcbiAgICBnb0J0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgaWYgKGQudHlwZSA9PT0gXCJvYmplY3RcIiAmJiB0aGlzLm5hdmlnYXRlVG9PYmplY3QpIHtcbiAgICAgICAgdGhpcy5uYXZpZ2F0ZVRvT2JqZWN0KGQuZmlsZVBhdGgsIGQuc3RhcnRMaW5lKTtcbiAgICAgIH0gZWxzZSBpZiAodGhpcy5uYXZpZ2F0ZVRvRmlsZSkge1xuICAgICAgICB0aGlzLm5hdmlnYXRlVG9GaWxlKGQuZmlsZVBhdGgpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHBhbmVsLmFwcGVuZENoaWxkKGdvQnRuKTtcblxuICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChwYW5lbCk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBBcHAsIFBsdWdpblNldHRpbmdUYWIsIFNldHRpbmcgfSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB0eXBlIE9iamVjdExpbmtzUGx1Z2luIGZyb20gXCIuL21haW5cIjtcblxuLyoqXG4gKiBQZXJzaXN0ZW50IHBsdWdpbiBzZXR0aW5ncyAoc2F2ZWQgdG8gZGF0YS5qc29uKS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBPYmplY3RMaW5rc1NldHRpbmdzIHtcbiAgb2JqZWN0RmlsZVRhZzogc3RyaW5nO1xufVxuXG5leHBvcnQgY29uc3QgREVGQVVMVF9TRVRUSU5HUzogT2JqZWN0TGlua3NTZXR0aW5ncyA9IHtcbiAgb2JqZWN0RmlsZVRhZzogXCJvYmplY3QtbGlua3NcIixcbn07XG5cbi8qKlxuICogUGx1Z2luIHNldHRpbmdzIHRhYiBzaG93biBpbiBPYnNpZGlhbidzIHNldHRpbmdzIHBhbmVsLlxuICovXG5leHBvcnQgY2xhc3MgT2JqZWN0TGlua3NTZXR0aW5nVGFiIGV4dGVuZHMgUGx1Z2luU2V0dGluZ1RhYiB7XG4gIHBsdWdpbjogT2JqZWN0TGlua3NQbHVnaW47XG5cbiAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHBsdWdpbjogT2JqZWN0TGlua3NQbHVnaW4pIHtcbiAgICBzdXBlcihhcHAsIHBsdWdpbik7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gIH1cblxuICBkaXNwbGF5KCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcblxuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiaDJcIiwgeyB0ZXh0OiBcIk9iamVjdCBMaW5rc1wiIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIk9iamVjdCBmaWxlIHRhZ1wiKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgIFwiVGFnIHVzZWQgdG8gaWRlbnRpZnkgb2JqZWN0IGZpbGVzLiBcIiArXG4gICAgICAgIFwiT25seSBtYXJrZG93biBmaWxlcyB0aGF0IGluY2x1ZGUgdGhpcyB0YWcgd2lsbCBiZSBwYXJzZWQuIFwiICtcbiAgICAgICAgXCJTdXBwb3J0cyBiYXJlICN0YWdzIChlLmcuICNvYmplY3QtbGlua3Mgb24gYW55IGxpbmUpIFwiICtcbiAgICAgICAgXCJhbmQgWUFNTCBmcm9udG1hdHRlciB0YWdzIChlLmcuIHRhZ3M6IFtvYmplY3QtbGlua3NdKS5cIlxuICAgICAgKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoXCJvYmplY3QtbGlua3NcIilcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3Mub2JqZWN0RmlsZVRhZylcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5vYmplY3RGaWxlVGFnID0gdmFsdWUudHJpbSgpO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG4gIH1cbn1cblxuLyoqXG4gKiBHcmFwaCBjb25maWd1cmF0aW9uIHBhbmVsIC0tIHJlbmRlcmVkIGluc2lkZSB0aGUgZ3JhcGggdmlldy5cbiAqL1xuXG5leHBvcnQgaW50ZXJmYWNlIEdyYXBoQ29uZmlnIHtcbiAgc2VhcmNoOiBzdHJpbmc7XG4gIHNob3dPcnBoYW5zOiBib29sZWFuO1xuICBzaG93RmlsZXM6IGJvb2xlYW47XG4gIHNob3dPYmplY3RzOiBib29sZWFuO1xuICBzaG93V2lraUVkZ2VzOiBib29sZWFuO1xuICBzaG93T2JqZWN0RWRnZXM6IGJvb2xlYW47XG4gIHBhdGhGaWx0ZXI6IHN0cmluZztcbiAgc291cmNlRmlsdGVyOiBzdHJpbmc7XG4gIC8vIERpc3BsYXlcbiAgbm9kZVNpemVNdWx0aXBsaWVyOiBudW1iZXI7XG4gIG5vZGVNYXhTY3JlZW5SYWRpdXM6IG51bWJlcjtcbiAgbGFiZWxPcGFjaXR5OiBudW1iZXI7XG4gIGxhYmVsTWluWm9vbTogbnVtYmVyO1xuICBsYWJlbE1heFdpZHRoOiBudW1iZXI7XG4gIC8vIEZvcmNlc1xuICBsaW5rRGlzdGFuY2U6IG51bWJlcjtcbiAgY2VudGVyU3RyZW5ndGg6IG51bWJlcjtcbiAgcmVwZWxTdHJlbmd0aDogbnVtYmVyO1xufVxuXG5leHBvcnQgY29uc3QgREVGQVVMVF9DT05GSUc6IEdyYXBoQ29uZmlnID0ge1xuICBzZWFyY2g6IFwiXCIsXG4gIHNob3dPcnBoYW5zOiBmYWxzZSxcbiAgc2hvd0ZpbGVzOiB0cnVlLFxuICBzaG93T2JqZWN0czogdHJ1ZSxcbiAgc2hvd1dpa2lFZGdlczogdHJ1ZSxcbiAgc2hvd09iamVjdEVkZ2VzOiB0cnVlLFxuICBwYXRoRmlsdGVyOiBcIlwiLFxuICBzb3VyY2VGaWx0ZXI6IFwiXCIsXG4gIC8vIERpc3BsYXlcbiAgbm9kZVNpemVNdWx0aXBsaWVyOiAxLFxuICBub2RlTWF4U2NyZWVuUmFkaXVzOiAxNixcbiAgbGFiZWxPcGFjaXR5OiAwLjY1LFxuICBsYWJlbE1pblpvb206IDEuMDUsXG4gIGxhYmVsTWF4V2lkdGg6IDE2MCxcbiAgLy8gRm9yY2VzXG4gIGxpbmtEaXN0YW5jZTogMTAwLFxuICBjZW50ZXJTdHJlbmd0aDogMC4wMyxcbiAgcmVwZWxTdHJlbmd0aDogMzAwLFxufTtcblxuZXhwb3J0IHR5cGUgQ29uZmlnQ2hhbmdlQ2FsbGJhY2sgPSAoY29uZmlnOiBHcmFwaENvbmZpZykgPT4gdm9pZDtcblxuZXhwb3J0IGNsYXNzIENvbmZpZ1BhbmVsIHtcbiAgcHJpdmF0ZSBwYW5lbEVsOiBIVE1MRWxlbWVudDtcbiAgcHJpdmF0ZSBjb25maWc6IEdyYXBoQ29uZmlnO1xuICBwcml2YXRlIG9uQ2hhbmdlOiBDb25maWdDaGFuZ2VDYWxsYmFjaztcbiAgcHJpdmF0ZSBjb2xsYXBzZWQ6IFJlY29yZDxzdHJpbmcsIGJvb2xlYW4+ID0ge1xuICAgIGZpbHRlcjogZmFsc2UsXG4gICAgZGlzcGxheTogdHJ1ZSxcbiAgfTtcbiAgcHJpdmF0ZSBkZWJvdW5jZVRpbWVyczogTWFwPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4+ID0gbmV3IE1hcCgpO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHBhcmVudDogSFRNTEVsZW1lbnQsXG4gICAgY29uZmlnOiBHcmFwaENvbmZpZyxcbiAgICBvbkNoYW5nZTogQ29uZmlnQ2hhbmdlQ2FsbGJhY2tcbiAgKSB7XG4gICAgdGhpcy5jb25maWcgPSB7IC4uLmNvbmZpZyB9O1xuICAgIHRoaXMub25DaGFuZ2UgPSBvbkNoYW5nZTtcblxuICAgIHRoaXMucGFuZWxFbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgdGhpcy5wYW5lbEVsLmNsYXNzTmFtZSA9IFwib2wtY29uZmlnLXBhbmVsXCI7XG4gICAgcGFyZW50LmFwcGVuZENoaWxkKHRoaXMucGFuZWxFbCk7XG5cbiAgICB0aGlzLnJlbmRlcigpO1xuICB9XG5cbiAgZ2V0Q29uZmlnKCk6IEdyYXBoQ29uZmlnIHtcbiAgICByZXR1cm4geyAuLi50aGlzLmNvbmZpZyB9O1xuICB9XG5cbiAgZGVzdHJveSgpOiB2b2lkIHtcbiAgICBmb3IgKGNvbnN0IHQgb2YgdGhpcy5kZWJvdW5jZVRpbWVycy52YWx1ZXMoKSkgY2xlYXJUaW1lb3V0KHQpO1xuICAgIHRoaXMuZGVib3VuY2VUaW1lcnMuY2xlYXIoKTtcbiAgICB0aGlzLnBhbmVsRWwucmVtb3ZlKCk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlcigpOiB2b2lkIHtcbiAgICB0aGlzLnBhbmVsRWwuZW1wdHkoKTtcblxuICAgIC8vIFx1MjUwMFx1MjUwMCBGaWx0ZXIgc2VjdGlvbiBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcbiAgICB0aGlzLnJlbmRlclNlY3Rpb24oXCJmaWx0ZXJcIiwgXCJGaWx0ZXJzXCIsIChjb250ZW50RWwpID0+IHtcbiAgICAgIC8vIFNlYXJjaFxuICAgICAgdGhpcy5yZW5kZXJUZXh0SW5wdXQoY29udGVudEVsLCBcIlNlYXJjaFwiLCB0aGlzLmNvbmZpZy5zZWFyY2gsICh2KSA9PiB7XG4gICAgICAgIHRoaXMuY29uZmlnLnNlYXJjaCA9IHY7XG4gICAgICAgIHRoaXMuZW1pdERlYm91bmNlZChcInNlYXJjaFwiLCAyNTApO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIFBhdGggZmlsdGVyXG4gICAgICB0aGlzLnJlbmRlclRleHRJbnB1dChjb250ZW50RWwsIFwiUGF0aCBmaWx0ZXJcIiwgdGhpcy5jb25maWcucGF0aEZpbHRlciwgKHYpID0+IHtcbiAgICAgICAgdGhpcy5jb25maWcucGF0aEZpbHRlciA9IHY7XG4gICAgICAgIHRoaXMuZW1pdERlYm91bmNlZChcInBhdGhGaWx0ZXJcIiwgMjUwKTtcbiAgICAgIH0sIFwiZS5nLiAwMCBEYWlseVwiKTtcblxuICAgICAgLy8gU291cmNlIGZpbHRlclxuICAgICAgdGhpcy5yZW5kZXJUZXh0SW5wdXQoY29udGVudEVsLCBcIlNvdXJjZSBmaWx0ZXJcIiwgdGhpcy5jb25maWcuc291cmNlRmlsdGVyLCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5zb3VyY2VGaWx0ZXIgPSB2O1xuICAgICAgICB0aGlzLmVtaXREZWJvdW5jZWQoXCJzb3VyY2VGaWx0ZXJcIiwgMjUwKTtcbiAgICAgIH0sIFwiZS5nLiBGaWxtc1wiKTtcblxuICAgICAgLy8gVG9nZ2xlc1xuICAgICAgdGhpcy5yZW5kZXJUb2dnbGUoY29udGVudEVsLCBcIlNob3cgZmlsZXNcIiwgdGhpcy5jb25maWcuc2hvd0ZpbGVzLCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5zaG93RmlsZXMgPSB2O1xuICAgICAgICB0aGlzLmVtaXQoKTtcbiAgICAgIH0pO1xuXG4gICAgICB0aGlzLnJlbmRlclRvZ2dsZShjb250ZW50RWwsIFwiU2hvdyBvYmplY3RzXCIsIHRoaXMuY29uZmlnLnNob3dPYmplY3RzLCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5zaG93T2JqZWN0cyA9IHY7XG4gICAgICAgIHRoaXMuZW1pdCgpO1xuICAgICAgfSk7XG5cbiAgICAgIHRoaXMucmVuZGVyVG9nZ2xlKGNvbnRlbnRFbCwgXCJTaG93IG9ycGhhbnNcIiwgdGhpcy5jb25maWcuc2hvd09ycGhhbnMsICh2KSA9PiB7XG4gICAgICAgIHRoaXMuY29uZmlnLnNob3dPcnBoYW5zID0gdjtcbiAgICAgICAgdGhpcy5lbWl0KCk7XG4gICAgICB9KTtcblxuICAgICAgdGhpcy5yZW5kZXJUb2dnbGUoY29udGVudEVsLCBcIldpa2kgbGlua3NcIiwgdGhpcy5jb25maWcuc2hvd1dpa2lFZGdlcywgKHYpID0+IHtcbiAgICAgICAgdGhpcy5jb25maWcuc2hvd1dpa2lFZGdlcyA9IHY7XG4gICAgICAgIHRoaXMuZW1pdCgpO1xuICAgICAgfSk7XG5cbiAgICAgIHRoaXMucmVuZGVyVG9nZ2xlKGNvbnRlbnRFbCwgXCJPYmplY3QgbGlua3NcIiwgdGhpcy5jb25maWcuc2hvd09iamVjdEVkZ2VzLCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5zaG93T2JqZWN0RWRnZXMgPSB2O1xuICAgICAgICB0aGlzLmVtaXQoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gXHUyNTAwXHUyNTAwIERpc3BsYXkgc2VjdGlvbiBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcbiAgICB0aGlzLnJlbmRlclNlY3Rpb24oXCJkaXNwbGF5XCIsIFwiRGlzcGxheVwiLCAoY29udGVudEVsKSA9PiB7XG4gICAgICB0aGlzLnJlbmRlclNsaWRlcihjb250ZW50RWwsIFwiTm9kZSBzaXplXCIsIHRoaXMuY29uZmlnLm5vZGVTaXplTXVsdGlwbGllciwgMC4yLCAzLCAwLjEsICh2KSA9PiB7XG4gICAgICAgIHRoaXMuY29uZmlnLm5vZGVTaXplTXVsdGlwbGllciA9IHY7XG4gICAgICAgIHRoaXMuZW1pdCgpO1xuICAgICAgfSk7XG5cbiAgICAgIHRoaXMucmVuZGVyU2xpZGVyKGNvbnRlbnRFbCwgXCJOb2RlIG1heCBzaXplIChvbiBzY3JlZW4pXCIsIHRoaXMuY29uZmlnLm5vZGVNYXhTY3JlZW5SYWRpdXMsIDYsIDQwLCAxLCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5ub2RlTWF4U2NyZWVuUmFkaXVzID0gdjtcbiAgICAgICAgdGhpcy5lbWl0KCk7XG4gICAgICB9KTtcblxuICAgICAgdGhpcy5yZW5kZXJTbGlkZXIoY29udGVudEVsLCBcIkxhYmVscyBhcHBlYXIgYXQgem9vbVwiLCB0aGlzLmNvbmZpZy5sYWJlbE1pblpvb20sIDAuMiwgMywgMC4wNSwgKHYpID0+IHtcbiAgICAgICAgdGhpcy5jb25maWcubGFiZWxNaW5ab29tID0gdjtcbiAgICAgICAgdGhpcy5lbWl0KCk7XG4gICAgICB9KTtcblxuICAgICAgdGhpcy5yZW5kZXJTbGlkZXIoY29udGVudEVsLCBcIkxhYmVsIG1heCB3aWR0aFwiLCB0aGlzLmNvbmZpZy5sYWJlbE1heFdpZHRoLCA2MCwgMzYwLCAxMCwgKHYpID0+IHtcbiAgICAgICAgdGhpcy5jb25maWcubGFiZWxNYXhXaWR0aCA9IHY7XG4gICAgICAgIHRoaXMuZW1pdCgpO1xuICAgICAgfSk7XG5cbiAgICAgIHRoaXMucmVuZGVyU2xpZGVyKGNvbnRlbnRFbCwgXCJMYWJlbCBvcGFjaXR5XCIsIHRoaXMuY29uZmlnLmxhYmVsT3BhY2l0eSwgMCwgMSwgMC4wNSwgKHYpID0+IHtcbiAgICAgICAgdGhpcy5jb25maWcubGFiZWxPcGFjaXR5ID0gdjtcbiAgICAgICAgdGhpcy5lbWl0KCk7XG4gICAgICB9KTtcblxuICAgICAgLy8gRm9yY2VzXG4gICAgICB0aGlzLnJlbmRlclNsaWRlcihjb250ZW50RWwsIFwiTGluayBkaXN0YW5jZVwiLCB0aGlzLmNvbmZpZy5saW5rRGlzdGFuY2UsIDMwLCA1MDAsIDEwLCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5saW5rRGlzdGFuY2UgPSB2O1xuICAgICAgICB0aGlzLmVtaXQoKTtcbiAgICAgIH0pO1xuXG4gICAgICB0aGlzLnJlbmRlclNsaWRlcihjb250ZW50RWwsIFwiQ2VudGVyIGZvcmNlXCIsIHRoaXMuY29uZmlnLmNlbnRlclN0cmVuZ3RoLCAwLCAwLjIsIDAuMDA1LCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5jZW50ZXJTdHJlbmd0aCA9IHY7XG4gICAgICAgIHRoaXMuZW1pdCgpO1xuICAgICAgfSk7XG5cbiAgICAgIHRoaXMucmVuZGVyU2xpZGVyKGNvbnRlbnRFbCwgXCJSZXBlbCBmb3JjZVwiLCB0aGlzLmNvbmZpZy5yZXBlbFN0cmVuZ3RoLCA1MCwgMTAwMCwgMjUsICh2KSA9PiB7XG4gICAgICAgIHRoaXMuY29uZmlnLnJlcGVsU3RyZW5ndGggPSB2O1xuICAgICAgICB0aGlzLmVtaXQoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJTZWN0aW9uKFxuICAgIGtleTogc3RyaW5nLFxuICAgIHRpdGxlOiBzdHJpbmcsXG4gICAgY29udGVudEZuOiAoY29udGVudEVsOiBIVE1MRWxlbWVudCkgPT4gdm9pZFxuICApOiB2b2lkIHtcbiAgICBjb25zdCBzZWN0aW9uID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICBzZWN0aW9uLmNsYXNzTmFtZSA9IFwib2wtY29uZmlnLXNlY3Rpb25cIjtcblxuICAgIGNvbnN0IGhlYWRlciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgaGVhZGVyLmNsYXNzTmFtZSA9IFwib2wtY29uZmlnLXNlY3Rpb24taGVhZGVyXCI7XG4gICAgaGVhZGVyLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgICB0aGlzLmNvbGxhcHNlZFtrZXldID0gIXRoaXMuY29sbGFwc2VkW2tleV07XG4gICAgICB0aGlzLnJlbmRlcigpO1xuICAgIH0pO1xuXG4gICAgY29uc3QgYXJyb3cgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcbiAgICBhcnJvdy5jbGFzc05hbWUgPSBcIm9sLWNvbmZpZy1hcnJvd1wiO1xuICAgIGFycm93LnRleHRDb250ZW50ID0gdGhpcy5jb2xsYXBzZWRba2V5XSA/IFwiXFx1MjVCNlwiIDogXCJcXHUyNUJDXCI7XG4gICAgaGVhZGVyLmFwcGVuZENoaWxkKGFycm93KTtcblxuICAgIGNvbnN0IHRpdGxlRWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcbiAgICB0aXRsZUVsLnRleHRDb250ZW50ID0gdGl0bGU7XG4gICAgaGVhZGVyLmFwcGVuZENoaWxkKHRpdGxlRWwpO1xuXG4gICAgc2VjdGlvbi5hcHBlbmRDaGlsZChoZWFkZXIpO1xuXG4gICAgaWYgKCF0aGlzLmNvbGxhcHNlZFtrZXldKSB7XG4gICAgICBjb25zdCBjb250ZW50ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgIGNvbnRlbnQuY2xhc3NOYW1lID0gXCJvbC1jb25maWctc2VjdGlvbi1jb250ZW50XCI7XG4gICAgICBzZWN0aW9uLmFwcGVuZENoaWxkKGNvbnRlbnQpO1xuICAgICAgY29udGVudEZuKGNvbnRlbnQpO1xuICAgIH1cblxuICAgIHRoaXMucGFuZWxFbC5hcHBlbmRDaGlsZChzZWN0aW9uKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyVGV4dElucHV0KFxuICAgIHBhcmVudDogSFRNTEVsZW1lbnQsXG4gICAgbGFiZWw6IHN0cmluZyxcbiAgICB2YWx1ZTogc3RyaW5nLFxuICAgIG9uQ2hhbmdlOiAodjogc3RyaW5nKSA9PiB2b2lkLFxuICAgIHBsYWNlaG9sZGVyPzogc3RyaW5nXG4gICk6IHZvaWQge1xuICAgIGNvbnN0IHJvdyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgcm93LmNsYXNzTmFtZSA9IFwib2wtY29uZmlnLXJvdyBvbC1jb25maWctdGV4dC1yb3dcIjtcblxuICAgIGNvbnN0IGxhYmVsRWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcbiAgICBsYWJlbEVsLmNsYXNzTmFtZSA9IFwib2wtY29uZmlnLWxhYmVsXCI7XG4gICAgbGFiZWxFbC50ZXh0Q29udGVudCA9IGxhYmVsO1xuICAgIHJvdy5hcHBlbmRDaGlsZChsYWJlbEVsKTtcblxuICAgIGNvbnN0IGlucHV0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImlucHV0XCIpO1xuICAgIGlucHV0LnR5cGUgPSBcInRleHRcIjtcbiAgICBpbnB1dC5jbGFzc05hbWUgPSBcIm9sLWNvbmZpZy1pbnB1dFwiO1xuICAgIGlucHV0LnBsYWNlaG9sZGVyID0gcGxhY2Vob2xkZXIgfHwgXCJcIjtcbiAgICBpbnB1dC52YWx1ZSA9IHZhbHVlO1xuICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJpbnB1dFwiLCAoKSA9PiBvbkNoYW5nZShpbnB1dC52YWx1ZSkpO1xuXG4gICAgcm93LmFwcGVuZENoaWxkKGlucHV0KTtcbiAgICBwYXJlbnQuYXBwZW5kQ2hpbGQocm93KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyVG9nZ2xlKFxuICAgIHBhcmVudDogSFRNTEVsZW1lbnQsXG4gICAgbGFiZWw6IHN0cmluZyxcbiAgICB2YWx1ZTogYm9vbGVhbixcbiAgICBvbkNoYW5nZTogKHY6IGJvb2xlYW4pID0+IHZvaWRcbiAgKTogdm9pZCB7XG4gICAgY29uc3Qgcm93ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICByb3cuY2xhc3NOYW1lID0gXCJvbC1jb25maWctcm93IG9sLWNvbmZpZy10b2dnbGUtcm93XCI7XG5cbiAgICBjb25zdCBsYWJlbEVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XG4gICAgbGFiZWxFbC5jbGFzc05hbWUgPSBcIm9sLWNvbmZpZy1sYWJlbFwiO1xuICAgIGxhYmVsRWwudGV4dENvbnRlbnQgPSBsYWJlbDtcbiAgICByb3cuYXBwZW5kQ2hpbGQobGFiZWxFbCk7XG5cbiAgICBjb25zdCB0b2dnbGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHRvZ2dsZS5jbGFzc05hbWUgPSBgb2wtY29uZmlnLXRvZ2dsZSAke3ZhbHVlID8gXCJpcy1lbmFibGVkXCIgOiBcIlwifWA7XG5cbiAgICBjb25zdCBrbm9iID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICBrbm9iLmNsYXNzTmFtZSA9IFwib2wtY29uZmlnLXRvZ2dsZS1rbm9iXCI7XG4gICAgdG9nZ2xlLmFwcGVuZENoaWxkKGtub2IpO1xuXG4gICAgdG9nZ2xlLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgICBjb25zdCBuZXdWYWwgPSAhdG9nZ2xlLmNsYXNzTGlzdC5jb250YWlucyhcImlzLWVuYWJsZWRcIik7XG4gICAgICB0b2dnbGUuY2xhc3NMaXN0LnRvZ2dsZShcImlzLWVuYWJsZWRcIiwgbmV3VmFsKTtcbiAgICAgIG9uQ2hhbmdlKG5ld1ZhbCk7XG4gICAgfSk7XG5cbiAgICByb3cuYXBwZW5kQ2hpbGQodG9nZ2xlKTtcbiAgICBwYXJlbnQuYXBwZW5kQ2hpbGQocm93KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyU2xpZGVyKFxuICAgIHBhcmVudDogSFRNTEVsZW1lbnQsXG4gICAgbGFiZWw6IHN0cmluZyxcbiAgICB2YWx1ZTogbnVtYmVyLFxuICAgIG1pbjogbnVtYmVyLFxuICAgIG1heDogbnVtYmVyLFxuICAgIHN0ZXA6IG51bWJlcixcbiAgICBvbkNoYW5nZTogKHY6IG51bWJlcikgPT4gdm9pZFxuICApOiB2b2lkIHtcbiAgICBjb25zdCByb3cgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHJvdy5jbGFzc05hbWUgPSBcIm9sLWNvbmZpZy1yb3cgb2wtY29uZmlnLXNsaWRlci1yb3dcIjtcblxuICAgIGNvbnN0IGxhYmVsRWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcbiAgICBsYWJlbEVsLmNsYXNzTmFtZSA9IFwib2wtY29uZmlnLWxhYmVsXCI7XG4gICAgbGFiZWxFbC50ZXh0Q29udGVudCA9IGxhYmVsO1xuICAgIHJvdy5hcHBlbmRDaGlsZChsYWJlbEVsKTtcblxuICAgIGNvbnN0IHNsaWRlciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJpbnB1dFwiKTtcbiAgICBzbGlkZXIudHlwZSA9IFwicmFuZ2VcIjtcbiAgICBzbGlkZXIuY2xhc3NOYW1lID0gXCJvbC1jb25maWctc2xpZGVyXCI7XG4gICAgc2xpZGVyLm1pbiA9IFN0cmluZyhtaW4pO1xuICAgIHNsaWRlci5tYXggPSBTdHJpbmcobWF4KTtcbiAgICBzbGlkZXIuc3RlcCA9IFN0cmluZyhzdGVwKTtcbiAgICBzbGlkZXIudmFsdWUgPSBTdHJpbmcodmFsdWUpO1xuICAgIHNsaWRlci5hZGRFdmVudExpc3RlbmVyKFwiaW5wdXRcIiwgKCkgPT4ge1xuICAgICAgb25DaGFuZ2UocGFyc2VGbG9hdChzbGlkZXIudmFsdWUpKTtcbiAgICB9KTtcblxuICAgIHJvdy5hcHBlbmRDaGlsZChzbGlkZXIpO1xuICAgIHBhcmVudC5hcHBlbmRDaGlsZChyb3cpO1xuICB9XG5cbiAgcHJpdmF0ZSBlbWl0KCk6IHZvaWQge1xuICAgIHRoaXMub25DaGFuZ2UoeyAuLi50aGlzLmNvbmZpZyB9KTtcbiAgfVxuXG4gIHByaXZhdGUgZW1pdERlYm91bmNlZChrZXk6IHN0cmluZywgbXM6IG51bWJlcik6IHZvaWQge1xuICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5kZWJvdW5jZVRpbWVycy5nZXQoa2V5KTtcbiAgICBpZiAoZXhpc3RpbmcpIGNsZWFyVGltZW91dChleGlzdGluZyk7XG4gICAgdGhpcy5kZWJvdW5jZVRpbWVycy5zZXQoa2V5LCBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMuZGVib3VuY2VUaW1lcnMuZGVsZXRlKGtleSk7XG4gICAgICB0aGlzLmVtaXQoKTtcbiAgICB9LCBtcykpO1xuICB9XG59XG4iLCAidmFyIG5vb3AgPSB7dmFsdWU6ICgpID0+IHt9fTtcblxuZnVuY3Rpb24gZGlzcGF0Y2goKSB7XG4gIGZvciAodmFyIGkgPSAwLCBuID0gYXJndW1lbnRzLmxlbmd0aCwgXyA9IHt9LCB0OyBpIDwgbjsgKytpKSB7XG4gICAgaWYgKCEodCA9IGFyZ3VtZW50c1tpXSArIFwiXCIpIHx8ICh0IGluIF8pIHx8IC9bXFxzLl0vLnRlc3QodCkpIHRocm93IG5ldyBFcnJvcihcImlsbGVnYWwgdHlwZTogXCIgKyB0KTtcbiAgICBfW3RdID0gW107XG4gIH1cbiAgcmV0dXJuIG5ldyBEaXNwYXRjaChfKTtcbn1cblxuZnVuY3Rpb24gRGlzcGF0Y2goXykge1xuICB0aGlzLl8gPSBfO1xufVxuXG5mdW5jdGlvbiBwYXJzZVR5cGVuYW1lcyh0eXBlbmFtZXMsIHR5cGVzKSB7XG4gIHJldHVybiB0eXBlbmFtZXMudHJpbSgpLnNwbGl0KC9efFxccysvKS5tYXAoZnVuY3Rpb24odCkge1xuICAgIHZhciBuYW1lID0gXCJcIiwgaSA9IHQuaW5kZXhPZihcIi5cIik7XG4gICAgaWYgKGkgPj0gMCkgbmFtZSA9IHQuc2xpY2UoaSArIDEpLCB0ID0gdC5zbGljZSgwLCBpKTtcbiAgICBpZiAodCAmJiAhdHlwZXMuaGFzT3duUHJvcGVydHkodCkpIHRocm93IG5ldyBFcnJvcihcInVua25vd24gdHlwZTogXCIgKyB0KTtcbiAgICByZXR1cm4ge3R5cGU6IHQsIG5hbWU6IG5hbWV9O1xuICB9KTtcbn1cblxuRGlzcGF0Y2gucHJvdG90eXBlID0gZGlzcGF0Y2gucHJvdG90eXBlID0ge1xuICBjb25zdHJ1Y3RvcjogRGlzcGF0Y2gsXG4gIG9uOiBmdW5jdGlvbih0eXBlbmFtZSwgY2FsbGJhY2spIHtcbiAgICB2YXIgXyA9IHRoaXMuXyxcbiAgICAgICAgVCA9IHBhcnNlVHlwZW5hbWVzKHR5cGVuYW1lICsgXCJcIiwgXyksXG4gICAgICAgIHQsXG4gICAgICAgIGkgPSAtMSxcbiAgICAgICAgbiA9IFQubGVuZ3RoO1xuXG4gICAgLy8gSWYgbm8gY2FsbGJhY2sgd2FzIHNwZWNpZmllZCwgcmV0dXJuIHRoZSBjYWxsYmFjayBvZiB0aGUgZ2l2ZW4gdHlwZSBhbmQgbmFtZS5cbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA8IDIpIHtcbiAgICAgIHdoaWxlICgrK2kgPCBuKSBpZiAoKHQgPSAodHlwZW5hbWUgPSBUW2ldKS50eXBlKSAmJiAodCA9IGdldChfW3RdLCB0eXBlbmFtZS5uYW1lKSkpIHJldHVybiB0O1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIElmIGEgdHlwZSB3YXMgc3BlY2lmaWVkLCBzZXQgdGhlIGNhbGxiYWNrIGZvciB0aGUgZ2l2ZW4gdHlwZSBhbmQgbmFtZS5cbiAgICAvLyBPdGhlcndpc2UsIGlmIGEgbnVsbCBjYWxsYmFjayB3YXMgc3BlY2lmaWVkLCByZW1vdmUgY2FsbGJhY2tzIG9mIHRoZSBnaXZlbiBuYW1lLlxuICAgIGlmIChjYWxsYmFjayAhPSBudWxsICYmIHR5cGVvZiBjYWxsYmFjayAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoXCJpbnZhbGlkIGNhbGxiYWNrOiBcIiArIGNhbGxiYWNrKTtcbiAgICB3aGlsZSAoKytpIDwgbikge1xuICAgICAgaWYgKHQgPSAodHlwZW5hbWUgPSBUW2ldKS50eXBlKSBfW3RdID0gc2V0KF9bdF0sIHR5cGVuYW1lLm5hbWUsIGNhbGxiYWNrKTtcbiAgICAgIGVsc2UgaWYgKGNhbGxiYWNrID09IG51bGwpIGZvciAodCBpbiBfKSBfW3RdID0gc2V0KF9bdF0sIHR5cGVuYW1lLm5hbWUsIG51bGwpO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzO1xuICB9LFxuICBjb3B5OiBmdW5jdGlvbigpIHtcbiAgICB2YXIgY29weSA9IHt9LCBfID0gdGhpcy5fO1xuICAgIGZvciAodmFyIHQgaW4gXykgY29weVt0XSA9IF9bdF0uc2xpY2UoKTtcbiAgICByZXR1cm4gbmV3IERpc3BhdGNoKGNvcHkpO1xuICB9LFxuICBjYWxsOiBmdW5jdGlvbih0eXBlLCB0aGF0KSB7XG4gICAgaWYgKChuID0gYXJndW1lbnRzLmxlbmd0aCAtIDIpID4gMCkgZm9yICh2YXIgYXJncyA9IG5ldyBBcnJheShuKSwgaSA9IDAsIG4sIHQ7IGkgPCBuOyArK2kpIGFyZ3NbaV0gPSBhcmd1bWVudHNbaSArIDJdO1xuICAgIGlmICghdGhpcy5fLmhhc093blByb3BlcnR5KHR5cGUpKSB0aHJvdyBuZXcgRXJyb3IoXCJ1bmtub3duIHR5cGU6IFwiICsgdHlwZSk7XG4gICAgZm9yICh0ID0gdGhpcy5fW3R5cGVdLCBpID0gMCwgbiA9IHQubGVuZ3RoOyBpIDwgbjsgKytpKSB0W2ldLnZhbHVlLmFwcGx5KHRoYXQsIGFyZ3MpO1xuICB9LFxuICBhcHBseTogZnVuY3Rpb24odHlwZSwgdGhhdCwgYXJncykge1xuICAgIGlmICghdGhpcy5fLmhhc093blByb3BlcnR5KHR5cGUpKSB0aHJvdyBuZXcgRXJyb3IoXCJ1bmtub3duIHR5cGU6IFwiICsgdHlwZSk7XG4gICAgZm9yICh2YXIgdCA9IHRoaXMuX1t0eXBlXSwgaSA9IDAsIG4gPSB0Lmxlbmd0aDsgaSA8IG47ICsraSkgdFtpXS52YWx1ZS5hcHBseSh0aGF0LCBhcmdzKTtcbiAgfVxufTtcblxuZnVuY3Rpb24gZ2V0KHR5cGUsIG5hbWUpIHtcbiAgZm9yICh2YXIgaSA9IDAsIG4gPSB0eXBlLmxlbmd0aCwgYzsgaSA8IG47ICsraSkge1xuICAgIGlmICgoYyA9IHR5cGVbaV0pLm5hbWUgPT09IG5hbWUpIHtcbiAgICAgIHJldHVybiBjLnZhbHVlO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBzZXQodHlwZSwgbmFtZSwgY2FsbGJhY2spIHtcbiAgZm9yICh2YXIgaSA9IDAsIG4gPSB0eXBlLmxlbmd0aDsgaSA8IG47ICsraSkge1xuICAgIGlmICh0eXBlW2ldLm5hbWUgPT09IG5hbWUpIHtcbiAgICAgIHR5cGVbaV0gPSBub29wLCB0eXBlID0gdHlwZS5zbGljZSgwLCBpKS5jb25jYXQodHlwZS5zbGljZShpICsgMSkpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG4gIGlmIChjYWxsYmFjayAhPSBudWxsKSB0eXBlLnB1c2goe25hbWU6IG5hbWUsIHZhbHVlOiBjYWxsYmFja30pO1xuICByZXR1cm4gdHlwZTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZGlzcGF0Y2g7XG4iLCAiZXhwb3J0IHZhciB4aHRtbCA9IFwiaHR0cDovL3d3dy53My5vcmcvMTk5OS94aHRtbFwiO1xuXG5leHBvcnQgZGVmYXVsdCB7XG4gIHN2ZzogXCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiLFxuICB4aHRtbDogeGh0bWwsXG4gIHhsaW5rOiBcImh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmtcIixcbiAgeG1sOiBcImh0dHA6Ly93d3cudzMub3JnL1hNTC8xOTk4L25hbWVzcGFjZVwiLFxuICB4bWxuczogXCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3htbG5zL1wiXG59O1xuIiwgImltcG9ydCBuYW1lc3BhY2VzIGZyb20gXCIuL25hbWVzcGFjZXMuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSkge1xuICB2YXIgcHJlZml4ID0gbmFtZSArPSBcIlwiLCBpID0gcHJlZml4LmluZGV4T2YoXCI6XCIpO1xuICBpZiAoaSA+PSAwICYmIChwcmVmaXggPSBuYW1lLnNsaWNlKDAsIGkpKSAhPT0gXCJ4bWxuc1wiKSBuYW1lID0gbmFtZS5zbGljZShpICsgMSk7XG4gIHJldHVybiBuYW1lc3BhY2VzLmhhc093blByb3BlcnR5KHByZWZpeCkgPyB7c3BhY2U6IG5hbWVzcGFjZXNbcHJlZml4XSwgbG9jYWw6IG5hbWV9IDogbmFtZTsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1wcm90b3R5cGUtYnVpbHRpbnNcbn1cbiIsICJpbXBvcnQgbmFtZXNwYWNlIGZyb20gXCIuL25hbWVzcGFjZS5qc1wiO1xuaW1wb3J0IHt4aHRtbH0gZnJvbSBcIi4vbmFtZXNwYWNlcy5qc1wiO1xuXG5mdW5jdGlvbiBjcmVhdG9ySW5oZXJpdChuYW1lKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgZG9jdW1lbnQgPSB0aGlzLm93bmVyRG9jdW1lbnQsXG4gICAgICAgIHVyaSA9IHRoaXMubmFtZXNwYWNlVVJJO1xuICAgIHJldHVybiB1cmkgPT09IHhodG1sICYmIGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5uYW1lc3BhY2VVUkkgPT09IHhodG1sXG4gICAgICAgID8gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChuYW1lKVxuICAgICAgICA6IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnROUyh1cmksIG5hbWUpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBjcmVhdG9yRml4ZWQoZnVsbG5hbWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLm93bmVyRG9jdW1lbnQuY3JlYXRlRWxlbWVudE5TKGZ1bGxuYW1lLnNwYWNlLCBmdWxsbmFtZS5sb2NhbCk7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG5hbWUpIHtcbiAgdmFyIGZ1bGxuYW1lID0gbmFtZXNwYWNlKG5hbWUpO1xuICByZXR1cm4gKGZ1bGxuYW1lLmxvY2FsXG4gICAgICA/IGNyZWF0b3JGaXhlZFxuICAgICAgOiBjcmVhdG9ySW5oZXJpdCkoZnVsbG5hbWUpO1xufVxuIiwgImZ1bmN0aW9uIG5vbmUoKSB7fVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihzZWxlY3Rvcikge1xuICByZXR1cm4gc2VsZWN0b3IgPT0gbnVsbCA/IG5vbmUgOiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeVNlbGVjdG9yKHNlbGVjdG9yKTtcbiAgfTtcbn1cbiIsICJpbXBvcnQge1NlbGVjdGlvbn0gZnJvbSBcIi4vaW5kZXguanNcIjtcbmltcG9ydCBzZWxlY3RvciBmcm9tIFwiLi4vc2VsZWN0b3IuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oc2VsZWN0KSB7XG4gIGlmICh0eXBlb2Ygc2VsZWN0ICE9PSBcImZ1bmN0aW9uXCIpIHNlbGVjdCA9IHNlbGVjdG9yKHNlbGVjdCk7XG5cbiAgZm9yICh2YXIgZ3JvdXBzID0gdGhpcy5fZ3JvdXBzLCBtID0gZ3JvdXBzLmxlbmd0aCwgc3ViZ3JvdXBzID0gbmV3IEFycmF5KG0pLCBqID0gMDsgaiA8IG07ICsraikge1xuICAgIGZvciAodmFyIGdyb3VwID0gZ3JvdXBzW2pdLCBuID0gZ3JvdXAubGVuZ3RoLCBzdWJncm91cCA9IHN1Ymdyb3Vwc1tqXSA9IG5ldyBBcnJheShuKSwgbm9kZSwgc3Vibm9kZSwgaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIGlmICgobm9kZSA9IGdyb3VwW2ldKSAmJiAoc3Vibm9kZSA9IHNlbGVjdC5jYWxsKG5vZGUsIG5vZGUuX19kYXRhX18sIGksIGdyb3VwKSkpIHtcbiAgICAgICAgaWYgKFwiX19kYXRhX19cIiBpbiBub2RlKSBzdWJub2RlLl9fZGF0YV9fID0gbm9kZS5fX2RhdGFfXztcbiAgICAgICAgc3ViZ3JvdXBbaV0gPSBzdWJub2RlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBuZXcgU2VsZWN0aW9uKHN1Ymdyb3VwcywgdGhpcy5fcGFyZW50cyk7XG59XG4iLCAiLy8gR2l2ZW4gc29tZXRoaW5nIGFycmF5IGxpa2UgKG9yIG51bGwpLCByZXR1cm5zIHNvbWV0aGluZyB0aGF0IGlzIHN0cmljdGx5IGFuXG4vLyBhcnJheS4gVGhpcyBpcyB1c2VkIHRvIGVuc3VyZSB0aGF0IGFycmF5LWxpa2Ugb2JqZWN0cyBwYXNzZWQgdG8gZDMuc2VsZWN0QWxsXG4vLyBvciBzZWxlY3Rpb24uc2VsZWN0QWxsIGFyZSBjb252ZXJ0ZWQgaW50byBwcm9wZXIgYXJyYXlzIHdoZW4gY3JlYXRpbmcgYVxuLy8gc2VsZWN0aW9uOyB3ZSBkb25cdTIwMTl0IGV2ZXIgd2FudCB0byBjcmVhdGUgYSBzZWxlY3Rpb24gYmFja2VkIGJ5IGEgbGl2ZVxuLy8gSFRNTENvbGxlY3Rpb24gb3IgTm9kZUxpc3QuIEhvd2V2ZXIsIG5vdGUgdGhhdCBzZWxlY3Rpb24uc2VsZWN0QWxsIHdpbGwgdXNlIGFcbi8vIHN0YXRpYyBOb2RlTGlzdCBhcyBhIGdyb3VwLCBzaW5jZSBpdCBzYWZlbHkgZGVyaXZlZCBmcm9tIHF1ZXJ5U2VsZWN0b3JBbGwuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBhcnJheSh4KSB7XG4gIHJldHVybiB4ID09IG51bGwgPyBbXSA6IEFycmF5LmlzQXJyYXkoeCkgPyB4IDogQXJyYXkuZnJvbSh4KTtcbn1cbiIsICJmdW5jdGlvbiBlbXB0eSgpIHtcbiAgcmV0dXJuIFtdO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihzZWxlY3Rvcikge1xuICByZXR1cm4gc2VsZWN0b3IgPT0gbnVsbCA/IGVtcHR5IDogZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnlTZWxlY3RvckFsbChzZWxlY3Rvcik7XG4gIH07XG59XG4iLCAiaW1wb3J0IHtTZWxlY3Rpb259IGZyb20gXCIuL2luZGV4LmpzXCI7XG5pbXBvcnQgYXJyYXkgZnJvbSBcIi4uL2FycmF5LmpzXCI7XG5pbXBvcnQgc2VsZWN0b3JBbGwgZnJvbSBcIi4uL3NlbGVjdG9yQWxsLmpzXCI7XG5cbmZ1bmN0aW9uIGFycmF5QWxsKHNlbGVjdCkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGFycmF5KHNlbGVjdC5hcHBseSh0aGlzLCBhcmd1bWVudHMpKTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oc2VsZWN0KSB7XG4gIGlmICh0eXBlb2Ygc2VsZWN0ID09PSBcImZ1bmN0aW9uXCIpIHNlbGVjdCA9IGFycmF5QWxsKHNlbGVjdCk7XG4gIGVsc2Ugc2VsZWN0ID0gc2VsZWN0b3JBbGwoc2VsZWN0KTtcblxuICBmb3IgKHZhciBncm91cHMgPSB0aGlzLl9ncm91cHMsIG0gPSBncm91cHMubGVuZ3RoLCBzdWJncm91cHMgPSBbXSwgcGFyZW50cyA9IFtdLCBqID0gMDsgaiA8IG07ICsraikge1xuICAgIGZvciAodmFyIGdyb3VwID0gZ3JvdXBzW2pdLCBuID0gZ3JvdXAubGVuZ3RoLCBub2RlLCBpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgaWYgKG5vZGUgPSBncm91cFtpXSkge1xuICAgICAgICBzdWJncm91cHMucHVzaChzZWxlY3QuY2FsbChub2RlLCBub2RlLl9fZGF0YV9fLCBpLCBncm91cCkpO1xuICAgICAgICBwYXJlbnRzLnB1c2gobm9kZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG5ldyBTZWxlY3Rpb24oc3ViZ3JvdXBzLCBwYXJlbnRzKTtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbihzZWxlY3Rvcikge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMubWF0Y2hlcyhzZWxlY3Rvcik7XG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjaGlsZE1hdGNoZXIoc2VsZWN0b3IpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKG5vZGUpIHtcbiAgICByZXR1cm4gbm9kZS5tYXRjaGVzKHNlbGVjdG9yKTtcbiAgfTtcbn1cblxuIiwgImltcG9ydCB7Y2hpbGRNYXRjaGVyfSBmcm9tIFwiLi4vbWF0Y2hlci5qc1wiO1xuXG52YXIgZmluZCA9IEFycmF5LnByb3RvdHlwZS5maW5kO1xuXG5mdW5jdGlvbiBjaGlsZEZpbmQobWF0Y2gpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBmaW5kLmNhbGwodGhpcy5jaGlsZHJlbiwgbWF0Y2gpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBjaGlsZEZpcnN0KCkge1xuICByZXR1cm4gdGhpcy5maXJzdEVsZW1lbnRDaGlsZDtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obWF0Y2gpIHtcbiAgcmV0dXJuIHRoaXMuc2VsZWN0KG1hdGNoID09IG51bGwgPyBjaGlsZEZpcnN0XG4gICAgICA6IGNoaWxkRmluZCh0eXBlb2YgbWF0Y2ggPT09IFwiZnVuY3Rpb25cIiA/IG1hdGNoIDogY2hpbGRNYXRjaGVyKG1hdGNoKSkpO1xufVxuIiwgImltcG9ydCB7Y2hpbGRNYXRjaGVyfSBmcm9tIFwiLi4vbWF0Y2hlci5qc1wiO1xuXG52YXIgZmlsdGVyID0gQXJyYXkucHJvdG90eXBlLmZpbHRlcjtcblxuZnVuY3Rpb24gY2hpbGRyZW4oKSB7XG4gIHJldHVybiBBcnJheS5mcm9tKHRoaXMuY2hpbGRyZW4pO1xufVxuXG5mdW5jdGlvbiBjaGlsZHJlbkZpbHRlcihtYXRjaCkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGZpbHRlci5jYWxsKHRoaXMuY2hpbGRyZW4sIG1hdGNoKTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obWF0Y2gpIHtcbiAgcmV0dXJuIHRoaXMuc2VsZWN0QWxsKG1hdGNoID09IG51bGwgPyBjaGlsZHJlblxuICAgICAgOiBjaGlsZHJlbkZpbHRlcih0eXBlb2YgbWF0Y2ggPT09IFwiZnVuY3Rpb25cIiA/IG1hdGNoIDogY2hpbGRNYXRjaGVyKG1hdGNoKSkpO1xufVxuIiwgImltcG9ydCB7U2VsZWN0aW9ufSBmcm9tIFwiLi9pbmRleC5qc1wiO1xuaW1wb3J0IG1hdGNoZXIgZnJvbSBcIi4uL21hdGNoZXIuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obWF0Y2gpIHtcbiAgaWYgKHR5cGVvZiBtYXRjaCAhPT0gXCJmdW5jdGlvblwiKSBtYXRjaCA9IG1hdGNoZXIobWF0Y2gpO1xuXG4gIGZvciAodmFyIGdyb3VwcyA9IHRoaXMuX2dyb3VwcywgbSA9IGdyb3Vwcy5sZW5ndGgsIHN1Ymdyb3VwcyA9IG5ldyBBcnJheShtKSwgaiA9IDA7IGogPCBtOyArK2opIHtcbiAgICBmb3IgKHZhciBncm91cCA9IGdyb3Vwc1tqXSwgbiA9IGdyb3VwLmxlbmd0aCwgc3ViZ3JvdXAgPSBzdWJncm91cHNbal0gPSBbXSwgbm9kZSwgaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIGlmICgobm9kZSA9IGdyb3VwW2ldKSAmJiBtYXRjaC5jYWxsKG5vZGUsIG5vZGUuX19kYXRhX18sIGksIGdyb3VwKSkge1xuICAgICAgICBzdWJncm91cC5wdXNoKG5vZGUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBuZXcgU2VsZWN0aW9uKHN1Ymdyb3VwcywgdGhpcy5fcGFyZW50cyk7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24odXBkYXRlKSB7XG4gIHJldHVybiBuZXcgQXJyYXkodXBkYXRlLmxlbmd0aCk7XG59XG4iLCAiaW1wb3J0IHNwYXJzZSBmcm9tIFwiLi9zcGFyc2UuanNcIjtcbmltcG9ydCB7U2VsZWN0aW9ufSBmcm9tIFwiLi9pbmRleC5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIG5ldyBTZWxlY3Rpb24odGhpcy5fZW50ZXIgfHwgdGhpcy5fZ3JvdXBzLm1hcChzcGFyc2UpLCB0aGlzLl9wYXJlbnRzKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIEVudGVyTm9kZShwYXJlbnQsIGRhdHVtKSB7XG4gIHRoaXMub3duZXJEb2N1bWVudCA9IHBhcmVudC5vd25lckRvY3VtZW50O1xuICB0aGlzLm5hbWVzcGFjZVVSSSA9IHBhcmVudC5uYW1lc3BhY2VVUkk7XG4gIHRoaXMuX25leHQgPSBudWxsO1xuICB0aGlzLl9wYXJlbnQgPSBwYXJlbnQ7XG4gIHRoaXMuX19kYXRhX18gPSBkYXR1bTtcbn1cblxuRW50ZXJOb2RlLnByb3RvdHlwZSA9IHtcbiAgY29uc3RydWN0b3I6IEVudGVyTm9kZSxcbiAgYXBwZW5kQ2hpbGQ6IGZ1bmN0aW9uKGNoaWxkKSB7IHJldHVybiB0aGlzLl9wYXJlbnQuaW5zZXJ0QmVmb3JlKGNoaWxkLCB0aGlzLl9uZXh0KTsgfSxcbiAgaW5zZXJ0QmVmb3JlOiBmdW5jdGlvbihjaGlsZCwgbmV4dCkgeyByZXR1cm4gdGhpcy5fcGFyZW50Lmluc2VydEJlZm9yZShjaGlsZCwgbmV4dCk7IH0sXG4gIHF1ZXJ5U2VsZWN0b3I6IGZ1bmN0aW9uKHNlbGVjdG9yKSB7IHJldHVybiB0aGlzLl9wYXJlbnQucXVlcnlTZWxlY3RvcihzZWxlY3Rvcik7IH0sXG4gIHF1ZXJ5U2VsZWN0b3JBbGw6IGZ1bmN0aW9uKHNlbGVjdG9yKSB7IHJldHVybiB0aGlzLl9wYXJlbnQucXVlcnlTZWxlY3RvckFsbChzZWxlY3Rvcik7IH1cbn07XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oeCkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHg7XG4gIH07XG59XG4iLCAiaW1wb3J0IHtTZWxlY3Rpb259IGZyb20gXCIuL2luZGV4LmpzXCI7XG5pbXBvcnQge0VudGVyTm9kZX0gZnJvbSBcIi4vZW50ZXIuanNcIjtcbmltcG9ydCBjb25zdGFudCBmcm9tIFwiLi4vY29uc3RhbnQuanNcIjtcblxuZnVuY3Rpb24gYmluZEluZGV4KHBhcmVudCwgZ3JvdXAsIGVudGVyLCB1cGRhdGUsIGV4aXQsIGRhdGEpIHtcbiAgdmFyIGkgPSAwLFxuICAgICAgbm9kZSxcbiAgICAgIGdyb3VwTGVuZ3RoID0gZ3JvdXAubGVuZ3RoLFxuICAgICAgZGF0YUxlbmd0aCA9IGRhdGEubGVuZ3RoO1xuXG4gIC8vIFB1dCBhbnkgbm9uLW51bGwgbm9kZXMgdGhhdCBmaXQgaW50byB1cGRhdGUuXG4gIC8vIFB1dCBhbnkgbnVsbCBub2RlcyBpbnRvIGVudGVyLlxuICAvLyBQdXQgYW55IHJlbWFpbmluZyBkYXRhIGludG8gZW50ZXIuXG4gIGZvciAoOyBpIDwgZGF0YUxlbmd0aDsgKytpKSB7XG4gICAgaWYgKG5vZGUgPSBncm91cFtpXSkge1xuICAgICAgbm9kZS5fX2RhdGFfXyA9IGRhdGFbaV07XG4gICAgICB1cGRhdGVbaV0gPSBub2RlO1xuICAgIH0gZWxzZSB7XG4gICAgICBlbnRlcltpXSA9IG5ldyBFbnRlck5vZGUocGFyZW50LCBkYXRhW2ldKTtcbiAgICB9XG4gIH1cblxuICAvLyBQdXQgYW55IG5vbi1udWxsIG5vZGVzIHRoYXQgZG9uXHUyMDE5dCBmaXQgaW50byBleGl0LlxuICBmb3IgKDsgaSA8IGdyb3VwTGVuZ3RoOyArK2kpIHtcbiAgICBpZiAobm9kZSA9IGdyb3VwW2ldKSB7XG4gICAgICBleGl0W2ldID0gbm9kZTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gYmluZEtleShwYXJlbnQsIGdyb3VwLCBlbnRlciwgdXBkYXRlLCBleGl0LCBkYXRhLCBrZXkpIHtcbiAgdmFyIGksXG4gICAgICBub2RlLFxuICAgICAgbm9kZUJ5S2V5VmFsdWUgPSBuZXcgTWFwLFxuICAgICAgZ3JvdXBMZW5ndGggPSBncm91cC5sZW5ndGgsXG4gICAgICBkYXRhTGVuZ3RoID0gZGF0YS5sZW5ndGgsXG4gICAgICBrZXlWYWx1ZXMgPSBuZXcgQXJyYXkoZ3JvdXBMZW5ndGgpLFxuICAgICAga2V5VmFsdWU7XG5cbiAgLy8gQ29tcHV0ZSB0aGUga2V5IGZvciBlYWNoIG5vZGUuXG4gIC8vIElmIG11bHRpcGxlIG5vZGVzIGhhdmUgdGhlIHNhbWUga2V5LCB0aGUgZHVwbGljYXRlcyBhcmUgYWRkZWQgdG8gZXhpdC5cbiAgZm9yIChpID0gMDsgaSA8IGdyb3VwTGVuZ3RoOyArK2kpIHtcbiAgICBpZiAobm9kZSA9IGdyb3VwW2ldKSB7XG4gICAgICBrZXlWYWx1ZXNbaV0gPSBrZXlWYWx1ZSA9IGtleS5jYWxsKG5vZGUsIG5vZGUuX19kYXRhX18sIGksIGdyb3VwKSArIFwiXCI7XG4gICAgICBpZiAobm9kZUJ5S2V5VmFsdWUuaGFzKGtleVZhbHVlKSkge1xuICAgICAgICBleGl0W2ldID0gbm9kZTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG5vZGVCeUtleVZhbHVlLnNldChrZXlWYWx1ZSwgbm9kZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gQ29tcHV0ZSB0aGUga2V5IGZvciBlYWNoIGRhdHVtLlxuICAvLyBJZiB0aGVyZSBhIG5vZGUgYXNzb2NpYXRlZCB3aXRoIHRoaXMga2V5LCBqb2luIGFuZCBhZGQgaXQgdG8gdXBkYXRlLlxuICAvLyBJZiB0aGVyZSBpcyBub3QgKG9yIHRoZSBrZXkgaXMgYSBkdXBsaWNhdGUpLCBhZGQgaXQgdG8gZW50ZXIuXG4gIGZvciAoaSA9IDA7IGkgPCBkYXRhTGVuZ3RoOyArK2kpIHtcbiAgICBrZXlWYWx1ZSA9IGtleS5jYWxsKHBhcmVudCwgZGF0YVtpXSwgaSwgZGF0YSkgKyBcIlwiO1xuICAgIGlmIChub2RlID0gbm9kZUJ5S2V5VmFsdWUuZ2V0KGtleVZhbHVlKSkge1xuICAgICAgdXBkYXRlW2ldID0gbm9kZTtcbiAgICAgIG5vZGUuX19kYXRhX18gPSBkYXRhW2ldO1xuICAgICAgbm9kZUJ5S2V5VmFsdWUuZGVsZXRlKGtleVZhbHVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgZW50ZXJbaV0gPSBuZXcgRW50ZXJOb2RlKHBhcmVudCwgZGF0YVtpXSk7XG4gICAgfVxuICB9XG5cbiAgLy8gQWRkIGFueSByZW1haW5pbmcgbm9kZXMgdGhhdCB3ZXJlIG5vdCBib3VuZCB0byBkYXRhIHRvIGV4aXQuXG4gIGZvciAoaSA9IDA7IGkgPCBncm91cExlbmd0aDsgKytpKSB7XG4gICAgaWYgKChub2RlID0gZ3JvdXBbaV0pICYmIChub2RlQnlLZXlWYWx1ZS5nZXQoa2V5VmFsdWVzW2ldKSA9PT0gbm9kZSkpIHtcbiAgICAgIGV4aXRbaV0gPSBub2RlO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBkYXR1bShub2RlKSB7XG4gIHJldHVybiBub2RlLl9fZGF0YV9fO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih2YWx1ZSwga2V5KSB7XG4gIGlmICghYXJndW1lbnRzLmxlbmd0aCkgcmV0dXJuIEFycmF5LmZyb20odGhpcywgZGF0dW0pO1xuXG4gIHZhciBiaW5kID0ga2V5ID8gYmluZEtleSA6IGJpbmRJbmRleCxcbiAgICAgIHBhcmVudHMgPSB0aGlzLl9wYXJlbnRzLFxuICAgICAgZ3JvdXBzID0gdGhpcy5fZ3JvdXBzO1xuXG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwiZnVuY3Rpb25cIikgdmFsdWUgPSBjb25zdGFudCh2YWx1ZSk7XG5cbiAgZm9yICh2YXIgbSA9IGdyb3Vwcy5sZW5ndGgsIHVwZGF0ZSA9IG5ldyBBcnJheShtKSwgZW50ZXIgPSBuZXcgQXJyYXkobSksIGV4aXQgPSBuZXcgQXJyYXkobSksIGogPSAwOyBqIDwgbTsgKytqKSB7XG4gICAgdmFyIHBhcmVudCA9IHBhcmVudHNbal0sXG4gICAgICAgIGdyb3VwID0gZ3JvdXBzW2pdLFxuICAgICAgICBncm91cExlbmd0aCA9IGdyb3VwLmxlbmd0aCxcbiAgICAgICAgZGF0YSA9IGFycmF5bGlrZSh2YWx1ZS5jYWxsKHBhcmVudCwgcGFyZW50ICYmIHBhcmVudC5fX2RhdGFfXywgaiwgcGFyZW50cykpLFxuICAgICAgICBkYXRhTGVuZ3RoID0gZGF0YS5sZW5ndGgsXG4gICAgICAgIGVudGVyR3JvdXAgPSBlbnRlcltqXSA9IG5ldyBBcnJheShkYXRhTGVuZ3RoKSxcbiAgICAgICAgdXBkYXRlR3JvdXAgPSB1cGRhdGVbal0gPSBuZXcgQXJyYXkoZGF0YUxlbmd0aCksXG4gICAgICAgIGV4aXRHcm91cCA9IGV4aXRbal0gPSBuZXcgQXJyYXkoZ3JvdXBMZW5ndGgpO1xuXG4gICAgYmluZChwYXJlbnQsIGdyb3VwLCBlbnRlckdyb3VwLCB1cGRhdGVHcm91cCwgZXhpdEdyb3VwLCBkYXRhLCBrZXkpO1xuXG4gICAgLy8gTm93IGNvbm5lY3QgdGhlIGVudGVyIG5vZGVzIHRvIHRoZWlyIGZvbGxvd2luZyB1cGRhdGUgbm9kZSwgc3VjaCB0aGF0XG4gICAgLy8gYXBwZW5kQ2hpbGQgY2FuIGluc2VydCB0aGUgbWF0ZXJpYWxpemVkIGVudGVyIG5vZGUgYmVmb3JlIHRoaXMgbm9kZSxcbiAgICAvLyByYXRoZXIgdGhhbiBhdCB0aGUgZW5kIG9mIHRoZSBwYXJlbnQgbm9kZS5cbiAgICBmb3IgKHZhciBpMCA9IDAsIGkxID0gMCwgcHJldmlvdXMsIG5leHQ7IGkwIDwgZGF0YUxlbmd0aDsgKytpMCkge1xuICAgICAgaWYgKHByZXZpb3VzID0gZW50ZXJHcm91cFtpMF0pIHtcbiAgICAgICAgaWYgKGkwID49IGkxKSBpMSA9IGkwICsgMTtcbiAgICAgICAgd2hpbGUgKCEobmV4dCA9IHVwZGF0ZUdyb3VwW2kxXSkgJiYgKytpMSA8IGRhdGFMZW5ndGgpO1xuICAgICAgICBwcmV2aW91cy5fbmV4dCA9IG5leHQgfHwgbnVsbDtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICB1cGRhdGUgPSBuZXcgU2VsZWN0aW9uKHVwZGF0ZSwgcGFyZW50cyk7XG4gIHVwZGF0ZS5fZW50ZXIgPSBlbnRlcjtcbiAgdXBkYXRlLl9leGl0ID0gZXhpdDtcbiAgcmV0dXJuIHVwZGF0ZTtcbn1cblxuLy8gR2l2ZW4gc29tZSBkYXRhLCB0aGlzIHJldHVybnMgYW4gYXJyYXktbGlrZSB2aWV3IG9mIGl0OiBhbiBvYmplY3QgdGhhdFxuLy8gZXhwb3NlcyBhIGxlbmd0aCBwcm9wZXJ0eSBhbmQgYWxsb3dzIG51bWVyaWMgaW5kZXhpbmcuIE5vdGUgdGhhdCB1bmxpa2Vcbi8vIHNlbGVjdEFsbCwgdGhpcyBpc25cdTIwMTl0IHdvcnJpZWQgYWJvdXQgXHUyMDFDbGl2ZVx1MjAxRCBjb2xsZWN0aW9ucyBiZWNhdXNlIHRoZSByZXN1bHRpbmdcbi8vIGFycmF5IHdpbGwgb25seSBiZSB1c2VkIGJyaWVmbHkgd2hpbGUgZGF0YSBpcyBiZWluZyBib3VuZC4gKEl0IGlzIHBvc3NpYmxlIHRvXG4vLyBjYXVzZSB0aGUgZGF0YSB0byBjaGFuZ2Ugd2hpbGUgaXRlcmF0aW5nIGJ5IHVzaW5nIGEga2V5IGZ1bmN0aW9uLCBidXQgcGxlYXNlXG4vLyBkb25cdTIwMTl0OyB3ZVx1MjAxOWQgcmF0aGVyIGF2b2lkIGEgZ3JhdHVpdG91cyBjb3B5LilcbmZ1bmN0aW9uIGFycmF5bGlrZShkYXRhKSB7XG4gIHJldHVybiB0eXBlb2YgZGF0YSA9PT0gXCJvYmplY3RcIiAmJiBcImxlbmd0aFwiIGluIGRhdGFcbiAgICA/IGRhdGEgLy8gQXJyYXksIFR5cGVkQXJyYXksIE5vZGVMaXN0LCBhcnJheS1saWtlXG4gICAgOiBBcnJheS5mcm9tKGRhdGEpOyAvLyBNYXAsIFNldCwgaXRlcmFibGUsIHN0cmluZywgb3IgYW55dGhpbmcgZWxzZVxufVxuIiwgImltcG9ydCBzcGFyc2UgZnJvbSBcIi4vc3BhcnNlLmpzXCI7XG5pbXBvcnQge1NlbGVjdGlvbn0gZnJvbSBcIi4vaW5kZXguanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIHJldHVybiBuZXcgU2VsZWN0aW9uKHRoaXMuX2V4aXQgfHwgdGhpcy5fZ3JvdXBzLm1hcChzcGFyc2UpLCB0aGlzLl9wYXJlbnRzKTtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbihvbmVudGVyLCBvbnVwZGF0ZSwgb25leGl0KSB7XG4gIHZhciBlbnRlciA9IHRoaXMuZW50ZXIoKSwgdXBkYXRlID0gdGhpcywgZXhpdCA9IHRoaXMuZXhpdCgpO1xuICBpZiAodHlwZW9mIG9uZW50ZXIgPT09IFwiZnVuY3Rpb25cIikge1xuICAgIGVudGVyID0gb25lbnRlcihlbnRlcik7XG4gICAgaWYgKGVudGVyKSBlbnRlciA9IGVudGVyLnNlbGVjdGlvbigpO1xuICB9IGVsc2Uge1xuICAgIGVudGVyID0gZW50ZXIuYXBwZW5kKG9uZW50ZXIgKyBcIlwiKTtcbiAgfVxuICBpZiAob251cGRhdGUgIT0gbnVsbCkge1xuICAgIHVwZGF0ZSA9IG9udXBkYXRlKHVwZGF0ZSk7XG4gICAgaWYgKHVwZGF0ZSkgdXBkYXRlID0gdXBkYXRlLnNlbGVjdGlvbigpO1xuICB9XG4gIGlmIChvbmV4aXQgPT0gbnVsbCkgZXhpdC5yZW1vdmUoKTsgZWxzZSBvbmV4aXQoZXhpdCk7XG4gIHJldHVybiBlbnRlciAmJiB1cGRhdGUgPyBlbnRlci5tZXJnZSh1cGRhdGUpLm9yZGVyKCkgOiB1cGRhdGU7XG59XG4iLCAiaW1wb3J0IHtTZWxlY3Rpb259IGZyb20gXCIuL2luZGV4LmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGNvbnRleHQpIHtcbiAgdmFyIHNlbGVjdGlvbiA9IGNvbnRleHQuc2VsZWN0aW9uID8gY29udGV4dC5zZWxlY3Rpb24oKSA6IGNvbnRleHQ7XG5cbiAgZm9yICh2YXIgZ3JvdXBzMCA9IHRoaXMuX2dyb3VwcywgZ3JvdXBzMSA9IHNlbGVjdGlvbi5fZ3JvdXBzLCBtMCA9IGdyb3VwczAubGVuZ3RoLCBtMSA9IGdyb3VwczEubGVuZ3RoLCBtID0gTWF0aC5taW4obTAsIG0xKSwgbWVyZ2VzID0gbmV3IEFycmF5KG0wKSwgaiA9IDA7IGogPCBtOyArK2opIHtcbiAgICBmb3IgKHZhciBncm91cDAgPSBncm91cHMwW2pdLCBncm91cDEgPSBncm91cHMxW2pdLCBuID0gZ3JvdXAwLmxlbmd0aCwgbWVyZ2UgPSBtZXJnZXNbal0gPSBuZXcgQXJyYXkobiksIG5vZGUsIGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAobm9kZSA9IGdyb3VwMFtpXSB8fCBncm91cDFbaV0pIHtcbiAgICAgICAgbWVyZ2VbaV0gPSBub2RlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGZvciAoOyBqIDwgbTA7ICsraikge1xuICAgIG1lcmdlc1tqXSA9IGdyb3VwczBbal07XG4gIH1cblxuICByZXR1cm4gbmV3IFNlbGVjdGlvbihtZXJnZXMsIHRoaXMuX3BhcmVudHMpO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKCkge1xuXG4gIGZvciAodmFyIGdyb3VwcyA9IHRoaXMuX2dyb3VwcywgaiA9IC0xLCBtID0gZ3JvdXBzLmxlbmd0aDsgKytqIDwgbTspIHtcbiAgICBmb3IgKHZhciBncm91cCA9IGdyb3Vwc1tqXSwgaSA9IGdyb3VwLmxlbmd0aCAtIDEsIG5leHQgPSBncm91cFtpXSwgbm9kZTsgLS1pID49IDA7KSB7XG4gICAgICBpZiAobm9kZSA9IGdyb3VwW2ldKSB7XG4gICAgICAgIGlmIChuZXh0ICYmIG5vZGUuY29tcGFyZURvY3VtZW50UG9zaXRpb24obmV4dCkgXiA0KSBuZXh0LnBhcmVudE5vZGUuaW5zZXJ0QmVmb3JlKG5vZGUsIG5leHQpO1xuICAgICAgICBuZXh0ID0gbm9kZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn1cbiIsICJpbXBvcnQge1NlbGVjdGlvbn0gZnJvbSBcIi4vaW5kZXguanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oY29tcGFyZSkge1xuICBpZiAoIWNvbXBhcmUpIGNvbXBhcmUgPSBhc2NlbmRpbmc7XG5cbiAgZnVuY3Rpb24gY29tcGFyZU5vZGUoYSwgYikge1xuICAgIHJldHVybiBhICYmIGIgPyBjb21wYXJlKGEuX19kYXRhX18sIGIuX19kYXRhX18pIDogIWEgLSAhYjtcbiAgfVxuXG4gIGZvciAodmFyIGdyb3VwcyA9IHRoaXMuX2dyb3VwcywgbSA9IGdyb3Vwcy5sZW5ndGgsIHNvcnRncm91cHMgPSBuZXcgQXJyYXkobSksIGogPSAwOyBqIDwgbTsgKytqKSB7XG4gICAgZm9yICh2YXIgZ3JvdXAgPSBncm91cHNbal0sIG4gPSBncm91cC5sZW5ndGgsIHNvcnRncm91cCA9IHNvcnRncm91cHNbal0gPSBuZXcgQXJyYXkobiksIG5vZGUsIGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAobm9kZSA9IGdyb3VwW2ldKSB7XG4gICAgICAgIHNvcnRncm91cFtpXSA9IG5vZGU7XG4gICAgICB9XG4gICAgfVxuICAgIHNvcnRncm91cC5zb3J0KGNvbXBhcmVOb2RlKTtcbiAgfVxuXG4gIHJldHVybiBuZXcgU2VsZWN0aW9uKHNvcnRncm91cHMsIHRoaXMuX3BhcmVudHMpLm9yZGVyKCk7XG59XG5cbmZ1bmN0aW9uIGFzY2VuZGluZyhhLCBiKSB7XG4gIHJldHVybiBhIDwgYiA/IC0xIDogYSA+IGIgPyAxIDogYSA+PSBiID8gMCA6IE5hTjtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgdmFyIGNhbGxiYWNrID0gYXJndW1lbnRzWzBdO1xuICBhcmd1bWVudHNbMF0gPSB0aGlzO1xuICBjYWxsYmFjay5hcHBseShudWxsLCBhcmd1bWVudHMpO1xuICByZXR1cm4gdGhpcztcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIEFycmF5LmZyb20odGhpcyk7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG5cbiAgZm9yICh2YXIgZ3JvdXBzID0gdGhpcy5fZ3JvdXBzLCBqID0gMCwgbSA9IGdyb3Vwcy5sZW5ndGg7IGogPCBtOyArK2opIHtcbiAgICBmb3IgKHZhciBncm91cCA9IGdyb3Vwc1tqXSwgaSA9IDAsIG4gPSBncm91cC5sZW5ndGg7IGkgPCBuOyArK2kpIHtcbiAgICAgIHZhciBub2RlID0gZ3JvdXBbaV07XG4gICAgICBpZiAobm9kZSkgcmV0dXJuIG5vZGU7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG51bGw7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIGxldCBzaXplID0gMDtcbiAgZm9yIChjb25zdCBub2RlIG9mIHRoaXMpICsrc2l6ZTsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICByZXR1cm4gc2l6ZTtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgcmV0dXJuICF0aGlzLm5vZGUoKTtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbihjYWxsYmFjaykge1xuXG4gIGZvciAodmFyIGdyb3VwcyA9IHRoaXMuX2dyb3VwcywgaiA9IDAsIG0gPSBncm91cHMubGVuZ3RoOyBqIDwgbTsgKytqKSB7XG4gICAgZm9yICh2YXIgZ3JvdXAgPSBncm91cHNbal0sIGkgPSAwLCBuID0gZ3JvdXAubGVuZ3RoLCBub2RlOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAobm9kZSA9IGdyb3VwW2ldKSBjYWxsYmFjay5jYWxsKG5vZGUsIG5vZGUuX19kYXRhX18sIGksIGdyb3VwKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn1cbiIsICJpbXBvcnQgbmFtZXNwYWNlIGZyb20gXCIuLi9uYW1lc3BhY2UuanNcIjtcblxuZnVuY3Rpb24gYXR0clJlbW92ZShuYW1lKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnJlbW92ZUF0dHJpYnV0ZShuYW1lKTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gYXR0clJlbW92ZU5TKGZ1bGxuYW1lKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnJlbW92ZUF0dHJpYnV0ZU5TKGZ1bGxuYW1lLnNwYWNlLCBmdWxsbmFtZS5sb2NhbCk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGF0dHJDb25zdGFudChuYW1lLCB2YWx1ZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5zZXRBdHRyaWJ1dGUobmFtZSwgdmFsdWUpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBhdHRyQ29uc3RhbnROUyhmdWxsbmFtZSwgdmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuc2V0QXR0cmlidXRlTlMoZnVsbG5hbWUuc3BhY2UsIGZ1bGxuYW1lLmxvY2FsLCB2YWx1ZSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGF0dHJGdW5jdGlvbihuYW1lLCB2YWx1ZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHYgPSB2YWx1ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIGlmICh2ID09IG51bGwpIHRoaXMucmVtb3ZlQXR0cmlidXRlKG5hbWUpO1xuICAgIGVsc2UgdGhpcy5zZXRBdHRyaWJ1dGUobmFtZSwgdik7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGF0dHJGdW5jdGlvbk5TKGZ1bGxuYW1lLCB2YWx1ZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHYgPSB2YWx1ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIGlmICh2ID09IG51bGwpIHRoaXMucmVtb3ZlQXR0cmlidXRlTlMoZnVsbG5hbWUuc3BhY2UsIGZ1bGxuYW1lLmxvY2FsKTtcbiAgICBlbHNlIHRoaXMuc2V0QXR0cmlidXRlTlMoZnVsbG5hbWUuc3BhY2UsIGZ1bGxuYW1lLmxvY2FsLCB2KTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSwgdmFsdWUpIHtcbiAgdmFyIGZ1bGxuYW1lID0gbmFtZXNwYWNlKG5hbWUpO1xuXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoIDwgMikge1xuICAgIHZhciBub2RlID0gdGhpcy5ub2RlKCk7XG4gICAgcmV0dXJuIGZ1bGxuYW1lLmxvY2FsXG4gICAgICAgID8gbm9kZS5nZXRBdHRyaWJ1dGVOUyhmdWxsbmFtZS5zcGFjZSwgZnVsbG5hbWUubG9jYWwpXG4gICAgICAgIDogbm9kZS5nZXRBdHRyaWJ1dGUoZnVsbG5hbWUpO1xuICB9XG5cbiAgcmV0dXJuIHRoaXMuZWFjaCgodmFsdWUgPT0gbnVsbFxuICAgICAgPyAoZnVsbG5hbWUubG9jYWwgPyBhdHRyUmVtb3ZlTlMgOiBhdHRyUmVtb3ZlKSA6ICh0eXBlb2YgdmFsdWUgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgPyAoZnVsbG5hbWUubG9jYWwgPyBhdHRyRnVuY3Rpb25OUyA6IGF0dHJGdW5jdGlvbilcbiAgICAgIDogKGZ1bGxuYW1lLmxvY2FsID8gYXR0ckNvbnN0YW50TlMgOiBhdHRyQ29uc3RhbnQpKSkoZnVsbG5hbWUsIHZhbHVlKSk7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obm9kZSkge1xuICByZXR1cm4gKG5vZGUub3duZXJEb2N1bWVudCAmJiBub2RlLm93bmVyRG9jdW1lbnQuZGVmYXVsdFZpZXcpIC8vIG5vZGUgaXMgYSBOb2RlXG4gICAgICB8fCAobm9kZS5kb2N1bWVudCAmJiBub2RlKSAvLyBub2RlIGlzIGEgV2luZG93XG4gICAgICB8fCBub2RlLmRlZmF1bHRWaWV3OyAvLyBub2RlIGlzIGEgRG9jdW1lbnRcbn1cbiIsICJpbXBvcnQgZGVmYXVsdFZpZXcgZnJvbSBcIi4uL3dpbmRvdy5qc1wiO1xuXG5mdW5jdGlvbiBzdHlsZVJlbW92ZShuYW1lKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnN0eWxlLnJlbW92ZVByb3BlcnR5KG5hbWUpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBzdHlsZUNvbnN0YW50KG5hbWUsIHZhbHVlLCBwcmlvcml0eSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5zdHlsZS5zZXRQcm9wZXJ0eShuYW1lLCB2YWx1ZSwgcHJpb3JpdHkpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBzdHlsZUZ1bmN0aW9uKG5hbWUsIHZhbHVlLCBwcmlvcml0eSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHYgPSB2YWx1ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIGlmICh2ID09IG51bGwpIHRoaXMuc3R5bGUucmVtb3ZlUHJvcGVydHkobmFtZSk7XG4gICAgZWxzZSB0aGlzLnN0eWxlLnNldFByb3BlcnR5KG5hbWUsIHYsIHByaW9yaXR5KTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSwgdmFsdWUsIHByaW9yaXR5KSB7XG4gIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID4gMVxuICAgICAgPyB0aGlzLmVhY2goKHZhbHVlID09IG51bGxcbiAgICAgICAgICAgID8gc3R5bGVSZW1vdmUgOiB0eXBlb2YgdmFsdWUgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgICAgICAgPyBzdHlsZUZ1bmN0aW9uXG4gICAgICAgICAgICA6IHN0eWxlQ29uc3RhbnQpKG5hbWUsIHZhbHVlLCBwcmlvcml0eSA9PSBudWxsID8gXCJcIiA6IHByaW9yaXR5KSlcbiAgICAgIDogc3R5bGVWYWx1ZSh0aGlzLm5vZGUoKSwgbmFtZSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzdHlsZVZhbHVlKG5vZGUsIG5hbWUpIHtcbiAgcmV0dXJuIG5vZGUuc3R5bGUuZ2V0UHJvcGVydHlWYWx1ZShuYW1lKVxuICAgICAgfHwgZGVmYXVsdFZpZXcobm9kZSkuZ2V0Q29tcHV0ZWRTdHlsZShub2RlLCBudWxsKS5nZXRQcm9wZXJ0eVZhbHVlKG5hbWUpO1xufVxuIiwgImZ1bmN0aW9uIHByb3BlcnR5UmVtb3ZlKG5hbWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIGRlbGV0ZSB0aGlzW25hbWVdO1xuICB9O1xufVxuXG5mdW5jdGlvbiBwcm9wZXJ0eUNvbnN0YW50KG5hbWUsIHZhbHVlKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB0aGlzW25hbWVdID0gdmFsdWU7XG4gIH07XG59XG5cbmZ1bmN0aW9uIHByb3BlcnR5RnVuY3Rpb24obmFtZSwgdmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciB2ID0gdmFsdWUuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICBpZiAodiA9PSBudWxsKSBkZWxldGUgdGhpc1tuYW1lXTtcbiAgICBlbHNlIHRoaXNbbmFtZV0gPSB2O1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihuYW1lLCB2YWx1ZSkge1xuICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA+IDFcbiAgICAgID8gdGhpcy5lYWNoKCh2YWx1ZSA9PSBudWxsXG4gICAgICAgICAgPyBwcm9wZXJ0eVJlbW92ZSA6IHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgICAgICAgPyBwcm9wZXJ0eUZ1bmN0aW9uXG4gICAgICAgICAgOiBwcm9wZXJ0eUNvbnN0YW50KShuYW1lLCB2YWx1ZSkpXG4gICAgICA6IHRoaXMubm9kZSgpW25hbWVdO1xufVxuIiwgImZ1bmN0aW9uIGNsYXNzQXJyYXkoc3RyaW5nKSB7XG4gIHJldHVybiBzdHJpbmcudHJpbSgpLnNwbGl0KC9efFxccysvKTtcbn1cblxuZnVuY3Rpb24gY2xhc3NMaXN0KG5vZGUpIHtcbiAgcmV0dXJuIG5vZGUuY2xhc3NMaXN0IHx8IG5ldyBDbGFzc0xpc3Qobm9kZSk7XG59XG5cbmZ1bmN0aW9uIENsYXNzTGlzdChub2RlKSB7XG4gIHRoaXMuX25vZGUgPSBub2RlO1xuICB0aGlzLl9uYW1lcyA9IGNsYXNzQXJyYXkobm9kZS5nZXRBdHRyaWJ1dGUoXCJjbGFzc1wiKSB8fCBcIlwiKTtcbn1cblxuQ2xhc3NMaXN0LnByb3RvdHlwZSA9IHtcbiAgYWRkOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgdmFyIGkgPSB0aGlzLl9uYW1lcy5pbmRleE9mKG5hbWUpO1xuICAgIGlmIChpIDwgMCkge1xuICAgICAgdGhpcy5fbmFtZXMucHVzaChuYW1lKTtcbiAgICAgIHRoaXMuX25vZGUuc2V0QXR0cmlidXRlKFwiY2xhc3NcIiwgdGhpcy5fbmFtZXMuam9pbihcIiBcIikpO1xuICAgIH1cbiAgfSxcbiAgcmVtb3ZlOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgdmFyIGkgPSB0aGlzLl9uYW1lcy5pbmRleE9mKG5hbWUpO1xuICAgIGlmIChpID49IDApIHtcbiAgICAgIHRoaXMuX25hbWVzLnNwbGljZShpLCAxKTtcbiAgICAgIHRoaXMuX25vZGUuc2V0QXR0cmlidXRlKFwiY2xhc3NcIiwgdGhpcy5fbmFtZXMuam9pbihcIiBcIikpO1xuICAgIH1cbiAgfSxcbiAgY29udGFpbnM6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5fbmFtZXMuaW5kZXhPZihuYW1lKSA+PSAwO1xuICB9XG59O1xuXG5mdW5jdGlvbiBjbGFzc2VkQWRkKG5vZGUsIG5hbWVzKSB7XG4gIHZhciBsaXN0ID0gY2xhc3NMaXN0KG5vZGUpLCBpID0gLTEsIG4gPSBuYW1lcy5sZW5ndGg7XG4gIHdoaWxlICgrK2kgPCBuKSBsaXN0LmFkZChuYW1lc1tpXSk7XG59XG5cbmZ1bmN0aW9uIGNsYXNzZWRSZW1vdmUobm9kZSwgbmFtZXMpIHtcbiAgdmFyIGxpc3QgPSBjbGFzc0xpc3Qobm9kZSksIGkgPSAtMSwgbiA9IG5hbWVzLmxlbmd0aDtcbiAgd2hpbGUgKCsraSA8IG4pIGxpc3QucmVtb3ZlKG5hbWVzW2ldKTtcbn1cblxuZnVuY3Rpb24gY2xhc3NlZFRydWUobmFtZXMpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIGNsYXNzZWRBZGQodGhpcywgbmFtZXMpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBjbGFzc2VkRmFsc2UobmFtZXMpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIGNsYXNzZWRSZW1vdmUodGhpcywgbmFtZXMpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBjbGFzc2VkRnVuY3Rpb24obmFtZXMsIHZhbHVlKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAodmFsdWUuYXBwbHkodGhpcywgYXJndW1lbnRzKSA/IGNsYXNzZWRBZGQgOiBjbGFzc2VkUmVtb3ZlKSh0aGlzLCBuYW1lcyk7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG5hbWUsIHZhbHVlKSB7XG4gIHZhciBuYW1lcyA9IGNsYXNzQXJyYXkobmFtZSArIFwiXCIpO1xuXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoIDwgMikge1xuICAgIHZhciBsaXN0ID0gY2xhc3NMaXN0KHRoaXMubm9kZSgpKSwgaSA9IC0xLCBuID0gbmFtZXMubGVuZ3RoO1xuICAgIHdoaWxlICgrK2kgPCBuKSBpZiAoIWxpc3QuY29udGFpbnMobmFtZXNbaV0pKSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICByZXR1cm4gdGhpcy5lYWNoKCh0eXBlb2YgdmFsdWUgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgPyBjbGFzc2VkRnVuY3Rpb24gOiB2YWx1ZVxuICAgICAgPyBjbGFzc2VkVHJ1ZVxuICAgICAgOiBjbGFzc2VkRmFsc2UpKG5hbWVzLCB2YWx1ZSkpO1xufVxuIiwgImZ1bmN0aW9uIHRleHRSZW1vdmUoKSB7XG4gIHRoaXMudGV4dENvbnRlbnQgPSBcIlwiO1xufVxuXG5mdW5jdGlvbiB0ZXh0Q29uc3RhbnQodmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHRoaXMudGV4dENvbnRlbnQgPSB2YWx1ZTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gdGV4dEZ1bmN0aW9uKHZhbHVlKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgdiA9IHZhbHVlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgdGhpcy50ZXh0Q29udGVudCA9IHYgPT0gbnVsbCA/IFwiXCIgOiB2O1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih2YWx1ZSkge1xuICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aFxuICAgICAgPyB0aGlzLmVhY2godmFsdWUgPT0gbnVsbFxuICAgICAgICAgID8gdGV4dFJlbW92ZSA6ICh0eXBlb2YgdmFsdWUgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgICAgID8gdGV4dEZ1bmN0aW9uXG4gICAgICAgICAgOiB0ZXh0Q29uc3RhbnQpKHZhbHVlKSlcbiAgICAgIDogdGhpcy5ub2RlKCkudGV4dENvbnRlbnQ7XG59XG4iLCAiZnVuY3Rpb24gaHRtbFJlbW92ZSgpIHtcbiAgdGhpcy5pbm5lckhUTUwgPSBcIlwiO1xufVxuXG5mdW5jdGlvbiBodG1sQ29uc3RhbnQodmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuaW5uZXJIVE1MID0gdmFsdWU7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGh0bWxGdW5jdGlvbih2YWx1ZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHYgPSB2YWx1ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIHRoaXMuaW5uZXJIVE1MID0gdiA9PSBudWxsID8gXCJcIiA6IHY7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHZhbHVlKSB7XG4gIHJldHVybiBhcmd1bWVudHMubGVuZ3RoXG4gICAgICA/IHRoaXMuZWFjaCh2YWx1ZSA9PSBudWxsXG4gICAgICAgICAgPyBodG1sUmVtb3ZlIDogKHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgICAgICAgPyBodG1sRnVuY3Rpb25cbiAgICAgICAgICA6IGh0bWxDb25zdGFudCkodmFsdWUpKVxuICAgICAgOiB0aGlzLm5vZGUoKS5pbm5lckhUTUw7XG59XG4iLCAiZnVuY3Rpb24gcmFpc2UoKSB7XG4gIGlmICh0aGlzLm5leHRTaWJsaW5nKSB0aGlzLnBhcmVudE5vZGUuYXBwZW5kQ2hpbGQodGhpcyk7XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5lYWNoKHJhaXNlKTtcbn1cbiIsICJmdW5jdGlvbiBsb3dlcigpIHtcbiAgaWYgKHRoaXMucHJldmlvdXNTaWJsaW5nKSB0aGlzLnBhcmVudE5vZGUuaW5zZXJ0QmVmb3JlKHRoaXMsIHRoaXMucGFyZW50Tm9kZS5maXJzdENoaWxkKTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLmVhY2gobG93ZXIpO1xufVxuIiwgImltcG9ydCBjcmVhdG9yIGZyb20gXCIuLi9jcmVhdG9yLmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG5hbWUpIHtcbiAgdmFyIGNyZWF0ZSA9IHR5cGVvZiBuYW1lID09PSBcImZ1bmN0aW9uXCIgPyBuYW1lIDogY3JlYXRvcihuYW1lKTtcbiAgcmV0dXJuIHRoaXMuc2VsZWN0KGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLmFwcGVuZENoaWxkKGNyZWF0ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpKTtcbiAgfSk7XG59XG4iLCAiaW1wb3J0IGNyZWF0b3IgZnJvbSBcIi4uL2NyZWF0b3IuanNcIjtcbmltcG9ydCBzZWxlY3RvciBmcm9tIFwiLi4vc2VsZWN0b3IuanNcIjtcblxuZnVuY3Rpb24gY29uc3RhbnROdWxsKCkge1xuICByZXR1cm4gbnVsbDtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSwgYmVmb3JlKSB7XG4gIHZhciBjcmVhdGUgPSB0eXBlb2YgbmFtZSA9PT0gXCJmdW5jdGlvblwiID8gbmFtZSA6IGNyZWF0b3IobmFtZSksXG4gICAgICBzZWxlY3QgPSBiZWZvcmUgPT0gbnVsbCA/IGNvbnN0YW50TnVsbCA6IHR5cGVvZiBiZWZvcmUgPT09IFwiZnVuY3Rpb25cIiA/IGJlZm9yZSA6IHNlbGVjdG9yKGJlZm9yZSk7XG4gIHJldHVybiB0aGlzLnNlbGVjdChmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5pbnNlcnRCZWZvcmUoY3JlYXRlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyksIHNlbGVjdC5hcHBseSh0aGlzLCBhcmd1bWVudHMpIHx8IG51bGwpO1xuICB9KTtcbn1cbiIsICJmdW5jdGlvbiByZW1vdmUoKSB7XG4gIHZhciBwYXJlbnQgPSB0aGlzLnBhcmVudE5vZGU7XG4gIGlmIChwYXJlbnQpIHBhcmVudC5yZW1vdmVDaGlsZCh0aGlzKTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLmVhY2gocmVtb3ZlKTtcbn1cbiIsICJmdW5jdGlvbiBzZWxlY3Rpb25fY2xvbmVTaGFsbG93KCkge1xuICB2YXIgY2xvbmUgPSB0aGlzLmNsb25lTm9kZShmYWxzZSksIHBhcmVudCA9IHRoaXMucGFyZW50Tm9kZTtcbiAgcmV0dXJuIHBhcmVudCA/IHBhcmVudC5pbnNlcnRCZWZvcmUoY2xvbmUsIHRoaXMubmV4dFNpYmxpbmcpIDogY2xvbmU7XG59XG5cbmZ1bmN0aW9uIHNlbGVjdGlvbl9jbG9uZURlZXAoKSB7XG4gIHZhciBjbG9uZSA9IHRoaXMuY2xvbmVOb2RlKHRydWUpLCBwYXJlbnQgPSB0aGlzLnBhcmVudE5vZGU7XG4gIHJldHVybiBwYXJlbnQgPyBwYXJlbnQuaW5zZXJ0QmVmb3JlKGNsb25lLCB0aGlzLm5leHRTaWJsaW5nKSA6IGNsb25lO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihkZWVwKSB7XG4gIHJldHVybiB0aGlzLnNlbGVjdChkZWVwID8gc2VsZWN0aW9uX2Nsb25lRGVlcCA6IHNlbGVjdGlvbl9jbG9uZVNoYWxsb3cpO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHZhbHVlKSB7XG4gIHJldHVybiBhcmd1bWVudHMubGVuZ3RoXG4gICAgICA/IHRoaXMucHJvcGVydHkoXCJfX2RhdGFfX1wiLCB2YWx1ZSlcbiAgICAgIDogdGhpcy5ub2RlKCkuX19kYXRhX187XG59XG4iLCAiZnVuY3Rpb24gY29udGV4dExpc3RlbmVyKGxpc3RlbmVyKSB7XG4gIHJldHVybiBmdW5jdGlvbihldmVudCkge1xuICAgIGxpc3RlbmVyLmNhbGwodGhpcywgZXZlbnQsIHRoaXMuX19kYXRhX18pO1xuICB9O1xufVxuXG5mdW5jdGlvbiBwYXJzZVR5cGVuYW1lcyh0eXBlbmFtZXMpIHtcbiAgcmV0dXJuIHR5cGVuYW1lcy50cmltKCkuc3BsaXQoL158XFxzKy8pLm1hcChmdW5jdGlvbih0KSB7XG4gICAgdmFyIG5hbWUgPSBcIlwiLCBpID0gdC5pbmRleE9mKFwiLlwiKTtcbiAgICBpZiAoaSA+PSAwKSBuYW1lID0gdC5zbGljZShpICsgMSksIHQgPSB0LnNsaWNlKDAsIGkpO1xuICAgIHJldHVybiB7dHlwZTogdCwgbmFtZTogbmFtZX07XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBvblJlbW92ZSh0eXBlbmFtZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIG9uID0gdGhpcy5fX29uO1xuICAgIGlmICghb24pIHJldHVybjtcbiAgICBmb3IgKHZhciBqID0gMCwgaSA9IC0xLCBtID0gb24ubGVuZ3RoLCBvOyBqIDwgbTsgKytqKSB7XG4gICAgICBpZiAobyA9IG9uW2pdLCAoIXR5cGVuYW1lLnR5cGUgfHwgby50eXBlID09PSB0eXBlbmFtZS50eXBlKSAmJiBvLm5hbWUgPT09IHR5cGVuYW1lLm5hbWUpIHtcbiAgICAgICAgdGhpcy5yZW1vdmVFdmVudExpc3RlbmVyKG8udHlwZSwgby5saXN0ZW5lciwgby5vcHRpb25zKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG9uWysraV0gPSBvO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoKytpKSBvbi5sZW5ndGggPSBpO1xuICAgIGVsc2UgZGVsZXRlIHRoaXMuX19vbjtcbiAgfTtcbn1cblxuZnVuY3Rpb24gb25BZGQodHlwZW5hbWUsIHZhbHVlLCBvcHRpb25zKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgb24gPSB0aGlzLl9fb24sIG8sIGxpc3RlbmVyID0gY29udGV4dExpc3RlbmVyKHZhbHVlKTtcbiAgICBpZiAob24pIGZvciAodmFyIGogPSAwLCBtID0gb24ubGVuZ3RoOyBqIDwgbTsgKytqKSB7XG4gICAgICBpZiAoKG8gPSBvbltqXSkudHlwZSA9PT0gdHlwZW5hbWUudHlwZSAmJiBvLm5hbWUgPT09IHR5cGVuYW1lLm5hbWUpIHtcbiAgICAgICAgdGhpcy5yZW1vdmVFdmVudExpc3RlbmVyKG8udHlwZSwgby5saXN0ZW5lciwgby5vcHRpb25zKTtcbiAgICAgICAgdGhpcy5hZGRFdmVudExpc3RlbmVyKG8udHlwZSwgby5saXN0ZW5lciA9IGxpc3RlbmVyLCBvLm9wdGlvbnMgPSBvcHRpb25zKTtcbiAgICAgICAgby52YWx1ZSA9IHZhbHVlO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfVxuICAgIHRoaXMuYWRkRXZlbnRMaXN0ZW5lcih0eXBlbmFtZS50eXBlLCBsaXN0ZW5lciwgb3B0aW9ucyk7XG4gICAgbyA9IHt0eXBlOiB0eXBlbmFtZS50eXBlLCBuYW1lOiB0eXBlbmFtZS5uYW1lLCB2YWx1ZTogdmFsdWUsIGxpc3RlbmVyOiBsaXN0ZW5lciwgb3B0aW9uczogb3B0aW9uc307XG4gICAgaWYgKCFvbikgdGhpcy5fX29uID0gW29dO1xuICAgIGVsc2Ugb24ucHVzaChvKTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24odHlwZW5hbWUsIHZhbHVlLCBvcHRpb25zKSB7XG4gIHZhciB0eXBlbmFtZXMgPSBwYXJzZVR5cGVuYW1lcyh0eXBlbmFtZSArIFwiXCIpLCBpLCBuID0gdHlwZW5hbWVzLmxlbmd0aCwgdDtcblxuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA8IDIpIHtcbiAgICB2YXIgb24gPSB0aGlzLm5vZGUoKS5fX29uO1xuICAgIGlmIChvbikgZm9yICh2YXIgaiA9IDAsIG0gPSBvbi5sZW5ndGgsIG87IGogPCBtOyArK2opIHtcbiAgICAgIGZvciAoaSA9IDAsIG8gPSBvbltqXTsgaSA8IG47ICsraSkge1xuICAgICAgICBpZiAoKHQgPSB0eXBlbmFtZXNbaV0pLnR5cGUgPT09IG8udHlwZSAmJiB0Lm5hbWUgPT09IG8ubmFtZSkge1xuICAgICAgICAgIHJldHVybiBvLnZhbHVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybjtcbiAgfVxuXG4gIG9uID0gdmFsdWUgPyBvbkFkZCA6IG9uUmVtb3ZlO1xuICBmb3IgKGkgPSAwOyBpIDwgbjsgKytpKSB0aGlzLmVhY2gob24odHlwZW5hbWVzW2ldLCB2YWx1ZSwgb3B0aW9ucykpO1xuICByZXR1cm4gdGhpcztcbn1cbiIsICJpbXBvcnQgZGVmYXVsdFZpZXcgZnJvbSBcIi4uL3dpbmRvdy5qc1wiO1xuXG5mdW5jdGlvbiBkaXNwYXRjaEV2ZW50KG5vZGUsIHR5cGUsIHBhcmFtcykge1xuICB2YXIgd2luZG93ID0gZGVmYXVsdFZpZXcobm9kZSksXG4gICAgICBldmVudCA9IHdpbmRvdy5DdXN0b21FdmVudDtcblxuICBpZiAodHlwZW9mIGV2ZW50ID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICBldmVudCA9IG5ldyBldmVudCh0eXBlLCBwYXJhbXMpO1xuICB9IGVsc2Uge1xuICAgIGV2ZW50ID0gd2luZG93LmRvY3VtZW50LmNyZWF0ZUV2ZW50KFwiRXZlbnRcIik7XG4gICAgaWYgKHBhcmFtcykgZXZlbnQuaW5pdEV2ZW50KHR5cGUsIHBhcmFtcy5idWJibGVzLCBwYXJhbXMuY2FuY2VsYWJsZSksIGV2ZW50LmRldGFpbCA9IHBhcmFtcy5kZXRhaWw7XG4gICAgZWxzZSBldmVudC5pbml0RXZlbnQodHlwZSwgZmFsc2UsIGZhbHNlKTtcbiAgfVxuXG4gIG5vZGUuZGlzcGF0Y2hFdmVudChldmVudCk7XG59XG5cbmZ1bmN0aW9uIGRpc3BhdGNoQ29uc3RhbnQodHlwZSwgcGFyYW1zKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gZGlzcGF0Y2hFdmVudCh0aGlzLCB0eXBlLCBwYXJhbXMpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBkaXNwYXRjaEZ1bmN0aW9uKHR5cGUsIHBhcmFtcykge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGRpc3BhdGNoRXZlbnQodGhpcywgdHlwZSwgcGFyYW1zLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykpO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih0eXBlLCBwYXJhbXMpIHtcbiAgcmV0dXJuIHRoaXMuZWFjaCgodHlwZW9mIHBhcmFtcyA9PT0gXCJmdW5jdGlvblwiXG4gICAgICA/IGRpc3BhdGNoRnVuY3Rpb25cbiAgICAgIDogZGlzcGF0Y2hDb25zdGFudCkodHlwZSwgcGFyYW1zKSk7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24qKCkge1xuICBmb3IgKHZhciBncm91cHMgPSB0aGlzLl9ncm91cHMsIGogPSAwLCBtID0gZ3JvdXBzLmxlbmd0aDsgaiA8IG07ICsraikge1xuICAgIGZvciAodmFyIGdyb3VwID0gZ3JvdXBzW2pdLCBpID0gMCwgbiA9IGdyb3VwLmxlbmd0aCwgbm9kZTsgaSA8IG47ICsraSkge1xuICAgICAgaWYgKG5vZGUgPSBncm91cFtpXSkgeWllbGQgbm9kZTtcbiAgICB9XG4gIH1cbn1cbiIsICJpbXBvcnQgc2VsZWN0aW9uX3NlbGVjdCBmcm9tIFwiLi9zZWxlY3QuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fc2VsZWN0QWxsIGZyb20gXCIuL3NlbGVjdEFsbC5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9zZWxlY3RDaGlsZCBmcm9tIFwiLi9zZWxlY3RDaGlsZC5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9zZWxlY3RDaGlsZHJlbiBmcm9tIFwiLi9zZWxlY3RDaGlsZHJlbi5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9maWx0ZXIgZnJvbSBcIi4vZmlsdGVyLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2RhdGEgZnJvbSBcIi4vZGF0YS5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9lbnRlciBmcm9tIFwiLi9lbnRlci5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9leGl0IGZyb20gXCIuL2V4aXQuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fam9pbiBmcm9tIFwiLi9qb2luLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX21lcmdlIGZyb20gXCIuL21lcmdlLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX29yZGVyIGZyb20gXCIuL29yZGVyLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX3NvcnQgZnJvbSBcIi4vc29ydC5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9jYWxsIGZyb20gXCIuL2NhbGwuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fbm9kZXMgZnJvbSBcIi4vbm9kZXMuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fbm9kZSBmcm9tIFwiLi9ub2RlLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX3NpemUgZnJvbSBcIi4vc2l6ZS5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9lbXB0eSBmcm9tIFwiLi9lbXB0eS5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9lYWNoIGZyb20gXCIuL2VhY2guanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fYXR0ciBmcm9tIFwiLi9hdHRyLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX3N0eWxlIGZyb20gXCIuL3N0eWxlLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX3Byb3BlcnR5IGZyb20gXCIuL3Byb3BlcnR5LmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2NsYXNzZWQgZnJvbSBcIi4vY2xhc3NlZC5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl90ZXh0IGZyb20gXCIuL3RleHQuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25faHRtbCBmcm9tIFwiLi9odG1sLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX3JhaXNlIGZyb20gXCIuL3JhaXNlLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2xvd2VyIGZyb20gXCIuL2xvd2VyLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2FwcGVuZCBmcm9tIFwiLi9hcHBlbmQuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25faW5zZXJ0IGZyb20gXCIuL2luc2VydC5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9yZW1vdmUgZnJvbSBcIi4vcmVtb3ZlLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2Nsb25lIGZyb20gXCIuL2Nsb25lLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2RhdHVtIGZyb20gXCIuL2RhdHVtLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX29uIGZyb20gXCIuL29uLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2Rpc3BhdGNoIGZyb20gXCIuL2Rpc3BhdGNoLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2l0ZXJhdG9yIGZyb20gXCIuL2l0ZXJhdG9yLmpzXCI7XG5cbmV4cG9ydCB2YXIgcm9vdCA9IFtudWxsXTtcblxuZXhwb3J0IGZ1bmN0aW9uIFNlbGVjdGlvbihncm91cHMsIHBhcmVudHMpIHtcbiAgdGhpcy5fZ3JvdXBzID0gZ3JvdXBzO1xuICB0aGlzLl9wYXJlbnRzID0gcGFyZW50cztcbn1cblxuZnVuY3Rpb24gc2VsZWN0aW9uKCkge1xuICByZXR1cm4gbmV3IFNlbGVjdGlvbihbW2RvY3VtZW50LmRvY3VtZW50RWxlbWVudF1dLCByb290KTtcbn1cblxuZnVuY3Rpb24gc2VsZWN0aW9uX3NlbGVjdGlvbigpIHtcbiAgcmV0dXJuIHRoaXM7XG59XG5cblNlbGVjdGlvbi5wcm90b3R5cGUgPSBzZWxlY3Rpb24ucHJvdG90eXBlID0ge1xuICBjb25zdHJ1Y3RvcjogU2VsZWN0aW9uLFxuICBzZWxlY3Q6IHNlbGVjdGlvbl9zZWxlY3QsXG4gIHNlbGVjdEFsbDogc2VsZWN0aW9uX3NlbGVjdEFsbCxcbiAgc2VsZWN0Q2hpbGQ6IHNlbGVjdGlvbl9zZWxlY3RDaGlsZCxcbiAgc2VsZWN0Q2hpbGRyZW46IHNlbGVjdGlvbl9zZWxlY3RDaGlsZHJlbixcbiAgZmlsdGVyOiBzZWxlY3Rpb25fZmlsdGVyLFxuICBkYXRhOiBzZWxlY3Rpb25fZGF0YSxcbiAgZW50ZXI6IHNlbGVjdGlvbl9lbnRlcixcbiAgZXhpdDogc2VsZWN0aW9uX2V4aXQsXG4gIGpvaW46IHNlbGVjdGlvbl9qb2luLFxuICBtZXJnZTogc2VsZWN0aW9uX21lcmdlLFxuICBzZWxlY3Rpb246IHNlbGVjdGlvbl9zZWxlY3Rpb24sXG4gIG9yZGVyOiBzZWxlY3Rpb25fb3JkZXIsXG4gIHNvcnQ6IHNlbGVjdGlvbl9zb3J0LFxuICBjYWxsOiBzZWxlY3Rpb25fY2FsbCxcbiAgbm9kZXM6IHNlbGVjdGlvbl9ub2RlcyxcbiAgbm9kZTogc2VsZWN0aW9uX25vZGUsXG4gIHNpemU6IHNlbGVjdGlvbl9zaXplLFxuICBlbXB0eTogc2VsZWN0aW9uX2VtcHR5LFxuICBlYWNoOiBzZWxlY3Rpb25fZWFjaCxcbiAgYXR0cjogc2VsZWN0aW9uX2F0dHIsXG4gIHN0eWxlOiBzZWxlY3Rpb25fc3R5bGUsXG4gIHByb3BlcnR5OiBzZWxlY3Rpb25fcHJvcGVydHksXG4gIGNsYXNzZWQ6IHNlbGVjdGlvbl9jbGFzc2VkLFxuICB0ZXh0OiBzZWxlY3Rpb25fdGV4dCxcbiAgaHRtbDogc2VsZWN0aW9uX2h0bWwsXG4gIHJhaXNlOiBzZWxlY3Rpb25fcmFpc2UsXG4gIGxvd2VyOiBzZWxlY3Rpb25fbG93ZXIsXG4gIGFwcGVuZDogc2VsZWN0aW9uX2FwcGVuZCxcbiAgaW5zZXJ0OiBzZWxlY3Rpb25faW5zZXJ0LFxuICByZW1vdmU6IHNlbGVjdGlvbl9yZW1vdmUsXG4gIGNsb25lOiBzZWxlY3Rpb25fY2xvbmUsXG4gIGRhdHVtOiBzZWxlY3Rpb25fZGF0dW0sXG4gIG9uOiBzZWxlY3Rpb25fb24sXG4gIGRpc3BhdGNoOiBzZWxlY3Rpb25fZGlzcGF0Y2gsXG4gIFtTeW1ib2wuaXRlcmF0b3JdOiBzZWxlY3Rpb25faXRlcmF0b3Jcbn07XG5cbmV4cG9ydCBkZWZhdWx0IHNlbGVjdGlvbjtcbiIsICJpbXBvcnQge1NlbGVjdGlvbiwgcm9vdH0gZnJvbSBcIi4vc2VsZWN0aW9uL2luZGV4LmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHNlbGVjdG9yKSB7XG4gIHJldHVybiB0eXBlb2Ygc2VsZWN0b3IgPT09IFwic3RyaW5nXCJcbiAgICAgID8gbmV3IFNlbGVjdGlvbihbW2RvY3VtZW50LnF1ZXJ5U2VsZWN0b3Ioc2VsZWN0b3IpXV0sIFtkb2N1bWVudC5kb2N1bWVudEVsZW1lbnRdKVxuICAgICAgOiBuZXcgU2VsZWN0aW9uKFtbc2VsZWN0b3JdXSwgcm9vdCk7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oZXZlbnQpIHtcbiAgbGV0IHNvdXJjZUV2ZW50O1xuICB3aGlsZSAoc291cmNlRXZlbnQgPSBldmVudC5zb3VyY2VFdmVudCkgZXZlbnQgPSBzb3VyY2VFdmVudDtcbiAgcmV0dXJuIGV2ZW50O1xufVxuIiwgImltcG9ydCBzb3VyY2VFdmVudCBmcm9tIFwiLi9zb3VyY2VFdmVudC5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihldmVudCwgbm9kZSkge1xuICBldmVudCA9IHNvdXJjZUV2ZW50KGV2ZW50KTtcbiAgaWYgKG5vZGUgPT09IHVuZGVmaW5lZCkgbm9kZSA9IGV2ZW50LmN1cnJlbnRUYXJnZXQ7XG4gIGlmIChub2RlKSB7XG4gICAgdmFyIHN2ZyA9IG5vZGUub3duZXJTVkdFbGVtZW50IHx8IG5vZGU7XG4gICAgaWYgKHN2Zy5jcmVhdGVTVkdQb2ludCkge1xuICAgICAgdmFyIHBvaW50ID0gc3ZnLmNyZWF0ZVNWR1BvaW50KCk7XG4gICAgICBwb2ludC54ID0gZXZlbnQuY2xpZW50WCwgcG9pbnQueSA9IGV2ZW50LmNsaWVudFk7XG4gICAgICBwb2ludCA9IHBvaW50Lm1hdHJpeFRyYW5zZm9ybShub2RlLmdldFNjcmVlbkNUTSgpLmludmVyc2UoKSk7XG4gICAgICByZXR1cm4gW3BvaW50LngsIHBvaW50LnldO1xuICAgIH1cbiAgICBpZiAobm9kZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QpIHtcbiAgICAgIHZhciByZWN0ID0gbm9kZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgIHJldHVybiBbZXZlbnQuY2xpZW50WCAtIHJlY3QubGVmdCAtIG5vZGUuY2xpZW50TGVmdCwgZXZlbnQuY2xpZW50WSAtIHJlY3QudG9wIC0gbm9kZS5jbGllbnRUb3BdO1xuICAgIH1cbiAgfVxuICByZXR1cm4gW2V2ZW50LnBhZ2VYLCBldmVudC5wYWdlWV07XG59XG4iLCAiLy8gVGhlc2UgYXJlIHR5cGljYWxseSB1c2VkIGluIGNvbmp1bmN0aW9uIHdpdGggbm9ldmVudCB0byBlbnN1cmUgdGhhdCB3ZSBjYW5cbi8vIHByZXZlbnREZWZhdWx0IG9uIHRoZSBldmVudC5cbmV4cG9ydCBjb25zdCBub25wYXNzaXZlID0ge3Bhc3NpdmU6IGZhbHNlfTtcbmV4cG9ydCBjb25zdCBub25wYXNzaXZlY2FwdHVyZSA9IHtjYXB0dXJlOiB0cnVlLCBwYXNzaXZlOiBmYWxzZX07XG5cbmV4cG9ydCBmdW5jdGlvbiBub3Byb3BhZ2F0aW9uKGV2ZW50KSB7XG4gIGV2ZW50LnN0b3BJbW1lZGlhdGVQcm9wYWdhdGlvbigpO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihldmVudCkge1xuICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICBldmVudC5zdG9wSW1tZWRpYXRlUHJvcGFnYXRpb24oKTtcbn1cbiIsICJpbXBvcnQge3NlbGVjdH0gZnJvbSBcImQzLXNlbGVjdGlvblwiO1xuaW1wb3J0IG5vZXZlbnQsIHtub25wYXNzaXZlY2FwdHVyZX0gZnJvbSBcIi4vbm9ldmVudC5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih2aWV3KSB7XG4gIHZhciByb290ID0gdmlldy5kb2N1bWVudC5kb2N1bWVudEVsZW1lbnQsXG4gICAgICBzZWxlY3Rpb24gPSBzZWxlY3Qodmlldykub24oXCJkcmFnc3RhcnQuZHJhZ1wiLCBub2V2ZW50LCBub25wYXNzaXZlY2FwdHVyZSk7XG4gIGlmIChcIm9uc2VsZWN0c3RhcnRcIiBpbiByb290KSB7XG4gICAgc2VsZWN0aW9uLm9uKFwic2VsZWN0c3RhcnQuZHJhZ1wiLCBub2V2ZW50LCBub25wYXNzaXZlY2FwdHVyZSk7XG4gIH0gZWxzZSB7XG4gICAgcm9vdC5fX25vc2VsZWN0ID0gcm9vdC5zdHlsZS5Nb3pVc2VyU2VsZWN0O1xuICAgIHJvb3Quc3R5bGUuTW96VXNlclNlbGVjdCA9IFwibm9uZVwiO1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB5ZXNkcmFnKHZpZXcsIG5vY2xpY2spIHtcbiAgdmFyIHJvb3QgPSB2aWV3LmRvY3VtZW50LmRvY3VtZW50RWxlbWVudCxcbiAgICAgIHNlbGVjdGlvbiA9IHNlbGVjdCh2aWV3KS5vbihcImRyYWdzdGFydC5kcmFnXCIsIG51bGwpO1xuICBpZiAobm9jbGljaykge1xuICAgIHNlbGVjdGlvbi5vbihcImNsaWNrLmRyYWdcIiwgbm9ldmVudCwgbm9ucGFzc2l2ZWNhcHR1cmUpO1xuICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7IHNlbGVjdGlvbi5vbihcImNsaWNrLmRyYWdcIiwgbnVsbCk7IH0sIDApO1xuICB9XG4gIGlmIChcIm9uc2VsZWN0c3RhcnRcIiBpbiByb290KSB7XG4gICAgc2VsZWN0aW9uLm9uKFwic2VsZWN0c3RhcnQuZHJhZ1wiLCBudWxsKTtcbiAgfSBlbHNlIHtcbiAgICByb290LnN0eWxlLk1velVzZXJTZWxlY3QgPSByb290Ll9fbm9zZWxlY3Q7XG4gICAgZGVsZXRlIHJvb3QuX19ub3NlbGVjdDtcbiAgfVxufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGNvbnN0cnVjdG9yLCBmYWN0b3J5LCBwcm90b3R5cGUpIHtcbiAgY29uc3RydWN0b3IucHJvdG90eXBlID0gZmFjdG9yeS5wcm90b3R5cGUgPSBwcm90b3R5cGU7XG4gIHByb3RvdHlwZS5jb25zdHJ1Y3RvciA9IGNvbnN0cnVjdG9yO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZXh0ZW5kKHBhcmVudCwgZGVmaW5pdGlvbikge1xuICB2YXIgcHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShwYXJlbnQucHJvdG90eXBlKTtcbiAgZm9yICh2YXIga2V5IGluIGRlZmluaXRpb24pIHByb3RvdHlwZVtrZXldID0gZGVmaW5pdGlvbltrZXldO1xuICByZXR1cm4gcHJvdG90eXBlO1xufVxuIiwgImltcG9ydCBkZWZpbmUsIHtleHRlbmR9IGZyb20gXCIuL2RlZmluZS5qc1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gQ29sb3IoKSB7fVxuXG5leHBvcnQgdmFyIGRhcmtlciA9IDAuNztcbmV4cG9ydCB2YXIgYnJpZ2h0ZXIgPSAxIC8gZGFya2VyO1xuXG52YXIgcmVJID0gXCJcXFxccyooWystXT9cXFxcZCspXFxcXHMqXCIsXG4gICAgcmVOID0gXCJcXFxccyooWystXT8oPzpcXFxcZCpcXFxcLik/XFxcXGQrKD86W2VFXVsrLV0/XFxcXGQrKT8pXFxcXHMqXCIsXG4gICAgcmVQID0gXCJcXFxccyooWystXT8oPzpcXFxcZCpcXFxcLik/XFxcXGQrKD86W2VFXVsrLV0/XFxcXGQrKT8pJVxcXFxzKlwiLFxuICAgIHJlSGV4ID0gL14jKFswLTlhLWZdezMsOH0pJC8sXG4gICAgcmVSZ2JJbnRlZ2VyID0gbmV3IFJlZ0V4cChgXnJnYlxcXFwoJHtyZUl9LCR7cmVJfSwke3JlSX1cXFxcKSRgKSxcbiAgICByZVJnYlBlcmNlbnQgPSBuZXcgUmVnRXhwKGBecmdiXFxcXCgke3JlUH0sJHtyZVB9LCR7cmVQfVxcXFwpJGApLFxuICAgIHJlUmdiYUludGVnZXIgPSBuZXcgUmVnRXhwKGBecmdiYVxcXFwoJHtyZUl9LCR7cmVJfSwke3JlSX0sJHtyZU59XFxcXCkkYCksXG4gICAgcmVSZ2JhUGVyY2VudCA9IG5ldyBSZWdFeHAoYF5yZ2JhXFxcXCgke3JlUH0sJHtyZVB9LCR7cmVQfSwke3JlTn1cXFxcKSRgKSxcbiAgICByZUhzbFBlcmNlbnQgPSBuZXcgUmVnRXhwKGBeaHNsXFxcXCgke3JlTn0sJHtyZVB9LCR7cmVQfVxcXFwpJGApLFxuICAgIHJlSHNsYVBlcmNlbnQgPSBuZXcgUmVnRXhwKGBeaHNsYVxcXFwoJHtyZU59LCR7cmVQfSwke3JlUH0sJHtyZU59XFxcXCkkYCk7XG5cbnZhciBuYW1lZCA9IHtcbiAgYWxpY2VibHVlOiAweGYwZjhmZixcbiAgYW50aXF1ZXdoaXRlOiAweGZhZWJkNyxcbiAgYXF1YTogMHgwMGZmZmYsXG4gIGFxdWFtYXJpbmU6IDB4N2ZmZmQ0LFxuICBhenVyZTogMHhmMGZmZmYsXG4gIGJlaWdlOiAweGY1ZjVkYyxcbiAgYmlzcXVlOiAweGZmZTRjNCxcbiAgYmxhY2s6IDB4MDAwMDAwLFxuICBibGFuY2hlZGFsbW9uZDogMHhmZmViY2QsXG4gIGJsdWU6IDB4MDAwMGZmLFxuICBibHVldmlvbGV0OiAweDhhMmJlMixcbiAgYnJvd246IDB4YTUyYTJhLFxuICBidXJseXdvb2Q6IDB4ZGViODg3LFxuICBjYWRldGJsdWU6IDB4NWY5ZWEwLFxuICBjaGFydHJldXNlOiAweDdmZmYwMCxcbiAgY2hvY29sYXRlOiAweGQyNjkxZSxcbiAgY29yYWw6IDB4ZmY3ZjUwLFxuICBjb3JuZmxvd2VyYmx1ZTogMHg2NDk1ZWQsXG4gIGNvcm5zaWxrOiAweGZmZjhkYyxcbiAgY3JpbXNvbjogMHhkYzE0M2MsXG4gIGN5YW46IDB4MDBmZmZmLFxuICBkYXJrYmx1ZTogMHgwMDAwOGIsXG4gIGRhcmtjeWFuOiAweDAwOGI4YixcbiAgZGFya2dvbGRlbnJvZDogMHhiODg2MGIsXG4gIGRhcmtncmF5OiAweGE5YTlhOSxcbiAgZGFya2dyZWVuOiAweDAwNjQwMCxcbiAgZGFya2dyZXk6IDB4YTlhOWE5LFxuICBkYXJra2hha2k6IDB4YmRiNzZiLFxuICBkYXJrbWFnZW50YTogMHg4YjAwOGIsXG4gIGRhcmtvbGl2ZWdyZWVuOiAweDU1NmIyZixcbiAgZGFya29yYW5nZTogMHhmZjhjMDAsXG4gIGRhcmtvcmNoaWQ6IDB4OTkzMmNjLFxuICBkYXJrcmVkOiAweDhiMDAwMCxcbiAgZGFya3NhbG1vbjogMHhlOTk2N2EsXG4gIGRhcmtzZWFncmVlbjogMHg4ZmJjOGYsXG4gIGRhcmtzbGF0ZWJsdWU6IDB4NDgzZDhiLFxuICBkYXJrc2xhdGVncmF5OiAweDJmNGY0ZixcbiAgZGFya3NsYXRlZ3JleTogMHgyZjRmNGYsXG4gIGRhcmt0dXJxdW9pc2U6IDB4MDBjZWQxLFxuICBkYXJrdmlvbGV0OiAweDk0MDBkMyxcbiAgZGVlcHBpbms6IDB4ZmYxNDkzLFxuICBkZWVwc2t5Ymx1ZTogMHgwMGJmZmYsXG4gIGRpbWdyYXk6IDB4Njk2OTY5LFxuICBkaW1ncmV5OiAweDY5Njk2OSxcbiAgZG9kZ2VyYmx1ZTogMHgxZTkwZmYsXG4gIGZpcmVicmljazogMHhiMjIyMjIsXG4gIGZsb3JhbHdoaXRlOiAweGZmZmFmMCxcbiAgZm9yZXN0Z3JlZW46IDB4MjI4YjIyLFxuICBmdWNoc2lhOiAweGZmMDBmZixcbiAgZ2FpbnNib3JvOiAweGRjZGNkYyxcbiAgZ2hvc3R3aGl0ZTogMHhmOGY4ZmYsXG4gIGdvbGQ6IDB4ZmZkNzAwLFxuICBnb2xkZW5yb2Q6IDB4ZGFhNTIwLFxuICBncmF5OiAweDgwODA4MCxcbiAgZ3JlZW46IDB4MDA4MDAwLFxuICBncmVlbnllbGxvdzogMHhhZGZmMmYsXG4gIGdyZXk6IDB4ODA4MDgwLFxuICBob25leWRldzogMHhmMGZmZjAsXG4gIGhvdHBpbms6IDB4ZmY2OWI0LFxuICBpbmRpYW5yZWQ6IDB4Y2Q1YzVjLFxuICBpbmRpZ286IDB4NGIwMDgyLFxuICBpdm9yeTogMHhmZmZmZjAsXG4gIGtoYWtpOiAweGYwZTY4YyxcbiAgbGF2ZW5kZXI6IDB4ZTZlNmZhLFxuICBsYXZlbmRlcmJsdXNoOiAweGZmZjBmNSxcbiAgbGF3bmdyZWVuOiAweDdjZmMwMCxcbiAgbGVtb25jaGlmZm9uOiAweGZmZmFjZCxcbiAgbGlnaHRibHVlOiAweGFkZDhlNixcbiAgbGlnaHRjb3JhbDogMHhmMDgwODAsXG4gIGxpZ2h0Y3lhbjogMHhlMGZmZmYsXG4gIGxpZ2h0Z29sZGVucm9keWVsbG93OiAweGZhZmFkMixcbiAgbGlnaHRncmF5OiAweGQzZDNkMyxcbiAgbGlnaHRncmVlbjogMHg5MGVlOTAsXG4gIGxpZ2h0Z3JleTogMHhkM2QzZDMsXG4gIGxpZ2h0cGluazogMHhmZmI2YzEsXG4gIGxpZ2h0c2FsbW9uOiAweGZmYTA3YSxcbiAgbGlnaHRzZWFncmVlbjogMHgyMGIyYWEsXG4gIGxpZ2h0c2t5Ymx1ZTogMHg4N2NlZmEsXG4gIGxpZ2h0c2xhdGVncmF5OiAweDc3ODg5OSxcbiAgbGlnaHRzbGF0ZWdyZXk6IDB4Nzc4ODk5LFxuICBsaWdodHN0ZWVsYmx1ZTogMHhiMGM0ZGUsXG4gIGxpZ2h0eWVsbG93OiAweGZmZmZlMCxcbiAgbGltZTogMHgwMGZmMDAsXG4gIGxpbWVncmVlbjogMHgzMmNkMzIsXG4gIGxpbmVuOiAweGZhZjBlNixcbiAgbWFnZW50YTogMHhmZjAwZmYsXG4gIG1hcm9vbjogMHg4MDAwMDAsXG4gIG1lZGl1bWFxdWFtYXJpbmU6IDB4NjZjZGFhLFxuICBtZWRpdW1ibHVlOiAweDAwMDBjZCxcbiAgbWVkaXVtb3JjaGlkOiAweGJhNTVkMyxcbiAgbWVkaXVtcHVycGxlOiAweDkzNzBkYixcbiAgbWVkaXVtc2VhZ3JlZW46IDB4M2NiMzcxLFxuICBtZWRpdW1zbGF0ZWJsdWU6IDB4N2I2OGVlLFxuICBtZWRpdW1zcHJpbmdncmVlbjogMHgwMGZhOWEsXG4gIG1lZGl1bXR1cnF1b2lzZTogMHg0OGQxY2MsXG4gIG1lZGl1bXZpb2xldHJlZDogMHhjNzE1ODUsXG4gIG1pZG5pZ2h0Ymx1ZTogMHgxOTE5NzAsXG4gIG1pbnRjcmVhbTogMHhmNWZmZmEsXG4gIG1pc3R5cm9zZTogMHhmZmU0ZTEsXG4gIG1vY2Nhc2luOiAweGZmZTRiNSxcbiAgbmF2YWpvd2hpdGU6IDB4ZmZkZWFkLFxuICBuYXZ5OiAweDAwMDA4MCxcbiAgb2xkbGFjZTogMHhmZGY1ZTYsXG4gIG9saXZlOiAweDgwODAwMCxcbiAgb2xpdmVkcmFiOiAweDZiOGUyMyxcbiAgb3JhbmdlOiAweGZmYTUwMCxcbiAgb3JhbmdlcmVkOiAweGZmNDUwMCxcbiAgb3JjaGlkOiAweGRhNzBkNixcbiAgcGFsZWdvbGRlbnJvZDogMHhlZWU4YWEsXG4gIHBhbGVncmVlbjogMHg5OGZiOTgsXG4gIHBhbGV0dXJxdW9pc2U6IDB4YWZlZWVlLFxuICBwYWxldmlvbGV0cmVkOiAweGRiNzA5MyxcbiAgcGFwYXlhd2hpcDogMHhmZmVmZDUsXG4gIHBlYWNocHVmZjogMHhmZmRhYjksXG4gIHBlcnU6IDB4Y2Q4NTNmLFxuICBwaW5rOiAweGZmYzBjYixcbiAgcGx1bTogMHhkZGEwZGQsXG4gIHBvd2RlcmJsdWU6IDB4YjBlMGU2LFxuICBwdXJwbGU6IDB4ODAwMDgwLFxuICByZWJlY2NhcHVycGxlOiAweDY2MzM5OSxcbiAgcmVkOiAweGZmMDAwMCxcbiAgcm9zeWJyb3duOiAweGJjOGY4ZixcbiAgcm95YWxibHVlOiAweDQxNjllMSxcbiAgc2FkZGxlYnJvd246IDB4OGI0NTEzLFxuICBzYWxtb246IDB4ZmE4MDcyLFxuICBzYW5keWJyb3duOiAweGY0YTQ2MCxcbiAgc2VhZ3JlZW46IDB4MmU4YjU3LFxuICBzZWFzaGVsbDogMHhmZmY1ZWUsXG4gIHNpZW5uYTogMHhhMDUyMmQsXG4gIHNpbHZlcjogMHhjMGMwYzAsXG4gIHNreWJsdWU6IDB4ODdjZWViLFxuICBzbGF0ZWJsdWU6IDB4NmE1YWNkLFxuICBzbGF0ZWdyYXk6IDB4NzA4MDkwLFxuICBzbGF0ZWdyZXk6IDB4NzA4MDkwLFxuICBzbm93OiAweGZmZmFmYSxcbiAgc3ByaW5nZ3JlZW46IDB4MDBmZjdmLFxuICBzdGVlbGJsdWU6IDB4NDY4MmI0LFxuICB0YW46IDB4ZDJiNDhjLFxuICB0ZWFsOiAweDAwODA4MCxcbiAgdGhpc3RsZTogMHhkOGJmZDgsXG4gIHRvbWF0bzogMHhmZjYzNDcsXG4gIHR1cnF1b2lzZTogMHg0MGUwZDAsXG4gIHZpb2xldDogMHhlZTgyZWUsXG4gIHdoZWF0OiAweGY1ZGViMyxcbiAgd2hpdGU6IDB4ZmZmZmZmLFxuICB3aGl0ZXNtb2tlOiAweGY1ZjVmNSxcbiAgeWVsbG93OiAweGZmZmYwMCxcbiAgeWVsbG93Z3JlZW46IDB4OWFjZDMyXG59O1xuXG5kZWZpbmUoQ29sb3IsIGNvbG9yLCB7XG4gIGNvcHkoY2hhbm5lbHMpIHtcbiAgICByZXR1cm4gT2JqZWN0LmFzc2lnbihuZXcgdGhpcy5jb25zdHJ1Y3RvciwgdGhpcywgY2hhbm5lbHMpO1xuICB9LFxuICBkaXNwbGF5YWJsZSgpIHtcbiAgICByZXR1cm4gdGhpcy5yZ2IoKS5kaXNwbGF5YWJsZSgpO1xuICB9LFxuICBoZXg6IGNvbG9yX2Zvcm1hdEhleCwgLy8gRGVwcmVjYXRlZCEgVXNlIGNvbG9yLmZvcm1hdEhleC5cbiAgZm9ybWF0SGV4OiBjb2xvcl9mb3JtYXRIZXgsXG4gIGZvcm1hdEhleDg6IGNvbG9yX2Zvcm1hdEhleDgsXG4gIGZvcm1hdEhzbDogY29sb3JfZm9ybWF0SHNsLFxuICBmb3JtYXRSZ2I6IGNvbG9yX2Zvcm1hdFJnYixcbiAgdG9TdHJpbmc6IGNvbG9yX2Zvcm1hdFJnYlxufSk7XG5cbmZ1bmN0aW9uIGNvbG9yX2Zvcm1hdEhleCgpIHtcbiAgcmV0dXJuIHRoaXMucmdiKCkuZm9ybWF0SGV4KCk7XG59XG5cbmZ1bmN0aW9uIGNvbG9yX2Zvcm1hdEhleDgoKSB7XG4gIHJldHVybiB0aGlzLnJnYigpLmZvcm1hdEhleDgoKTtcbn1cblxuZnVuY3Rpb24gY29sb3JfZm9ybWF0SHNsKCkge1xuICByZXR1cm4gaHNsQ29udmVydCh0aGlzKS5mb3JtYXRIc2woKTtcbn1cblxuZnVuY3Rpb24gY29sb3JfZm9ybWF0UmdiKCkge1xuICByZXR1cm4gdGhpcy5yZ2IoKS5mb3JtYXRSZ2IoKTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gY29sb3IoZm9ybWF0KSB7XG4gIHZhciBtLCBsO1xuICBmb3JtYXQgPSAoZm9ybWF0ICsgXCJcIikudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gIHJldHVybiAobSA9IHJlSGV4LmV4ZWMoZm9ybWF0KSkgPyAobCA9IG1bMV0ubGVuZ3RoLCBtID0gcGFyc2VJbnQobVsxXSwgMTYpLCBsID09PSA2ID8gcmdibihtKSAvLyAjZmYwMDAwXG4gICAgICA6IGwgPT09IDMgPyBuZXcgUmdiKChtID4+IDggJiAweGYpIHwgKG0gPj4gNCAmIDB4ZjApLCAobSA+PiA0ICYgMHhmKSB8IChtICYgMHhmMCksICgobSAmIDB4ZikgPDwgNCkgfCAobSAmIDB4ZiksIDEpIC8vICNmMDBcbiAgICAgIDogbCA9PT0gOCA/IHJnYmEobSA+PiAyNCAmIDB4ZmYsIG0gPj4gMTYgJiAweGZmLCBtID4+IDggJiAweGZmLCAobSAmIDB4ZmYpIC8gMHhmZikgLy8gI2ZmMDAwMDAwXG4gICAgICA6IGwgPT09IDQgPyByZ2JhKChtID4+IDEyICYgMHhmKSB8IChtID4+IDggJiAweGYwKSwgKG0gPj4gOCAmIDB4ZikgfCAobSA+PiA0ICYgMHhmMCksIChtID4+IDQgJiAweGYpIHwgKG0gJiAweGYwKSwgKCgobSAmIDB4ZikgPDwgNCkgfCAobSAmIDB4ZikpIC8gMHhmZikgLy8gI2YwMDBcbiAgICAgIDogbnVsbCkgLy8gaW52YWxpZCBoZXhcbiAgICAgIDogKG0gPSByZVJnYkludGVnZXIuZXhlYyhmb3JtYXQpKSA/IG5ldyBSZ2IobVsxXSwgbVsyXSwgbVszXSwgMSkgLy8gcmdiKDI1NSwgMCwgMClcbiAgICAgIDogKG0gPSByZVJnYlBlcmNlbnQuZXhlYyhmb3JtYXQpKSA/IG5ldyBSZ2IobVsxXSAqIDI1NSAvIDEwMCwgbVsyXSAqIDI1NSAvIDEwMCwgbVszXSAqIDI1NSAvIDEwMCwgMSkgLy8gcmdiKDEwMCUsIDAlLCAwJSlcbiAgICAgIDogKG0gPSByZVJnYmFJbnRlZ2VyLmV4ZWMoZm9ybWF0KSkgPyByZ2JhKG1bMV0sIG1bMl0sIG1bM10sIG1bNF0pIC8vIHJnYmEoMjU1LCAwLCAwLCAxKVxuICAgICAgOiAobSA9IHJlUmdiYVBlcmNlbnQuZXhlYyhmb3JtYXQpKSA/IHJnYmEobVsxXSAqIDI1NSAvIDEwMCwgbVsyXSAqIDI1NSAvIDEwMCwgbVszXSAqIDI1NSAvIDEwMCwgbVs0XSkgLy8gcmdiKDEwMCUsIDAlLCAwJSwgMSlcbiAgICAgIDogKG0gPSByZUhzbFBlcmNlbnQuZXhlYyhmb3JtYXQpKSA/IGhzbGEobVsxXSwgbVsyXSAvIDEwMCwgbVszXSAvIDEwMCwgMSkgLy8gaHNsKDEyMCwgNTAlLCA1MCUpXG4gICAgICA6IChtID0gcmVIc2xhUGVyY2VudC5leGVjKGZvcm1hdCkpID8gaHNsYShtWzFdLCBtWzJdIC8gMTAwLCBtWzNdIC8gMTAwLCBtWzRdKSAvLyBoc2xhKDEyMCwgNTAlLCA1MCUsIDEpXG4gICAgICA6IG5hbWVkLmhhc093blByb3BlcnR5KGZvcm1hdCkgPyByZ2JuKG5hbWVkW2Zvcm1hdF0pIC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tcHJvdG90eXBlLWJ1aWx0aW5zXG4gICAgICA6IGZvcm1hdCA9PT0gXCJ0cmFuc3BhcmVudFwiID8gbmV3IFJnYihOYU4sIE5hTiwgTmFOLCAwKVxuICAgICAgOiBudWxsO1xufVxuXG5mdW5jdGlvbiByZ2JuKG4pIHtcbiAgcmV0dXJuIG5ldyBSZ2IobiA+PiAxNiAmIDB4ZmYsIG4gPj4gOCAmIDB4ZmYsIG4gJiAweGZmLCAxKTtcbn1cblxuZnVuY3Rpb24gcmdiYShyLCBnLCBiLCBhKSB7XG4gIGlmIChhIDw9IDApIHIgPSBnID0gYiA9IE5hTjtcbiAgcmV0dXJuIG5ldyBSZ2IociwgZywgYiwgYSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZ2JDb252ZXJ0KG8pIHtcbiAgaWYgKCEobyBpbnN0YW5jZW9mIENvbG9yKSkgbyA9IGNvbG9yKG8pO1xuICBpZiAoIW8pIHJldHVybiBuZXcgUmdiO1xuICBvID0gby5yZ2IoKTtcbiAgcmV0dXJuIG5ldyBSZ2Ioby5yLCBvLmcsIG8uYiwgby5vcGFjaXR5KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJnYihyLCBnLCBiLCBvcGFjaXR5KSB7XG4gIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID09PSAxID8gcmdiQ29udmVydChyKSA6IG5ldyBSZ2IociwgZywgYiwgb3BhY2l0eSA9PSBudWxsID8gMSA6IG9wYWNpdHkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gUmdiKHIsIGcsIGIsIG9wYWNpdHkpIHtcbiAgdGhpcy5yID0gK3I7XG4gIHRoaXMuZyA9ICtnO1xuICB0aGlzLmIgPSArYjtcbiAgdGhpcy5vcGFjaXR5ID0gK29wYWNpdHk7XG59XG5cbmRlZmluZShSZ2IsIHJnYiwgZXh0ZW5kKENvbG9yLCB7XG4gIGJyaWdodGVyKGspIHtcbiAgICBrID0gayA9PSBudWxsID8gYnJpZ2h0ZXIgOiBNYXRoLnBvdyhicmlnaHRlciwgayk7XG4gICAgcmV0dXJuIG5ldyBSZ2IodGhpcy5yICogaywgdGhpcy5nICogaywgdGhpcy5iICogaywgdGhpcy5vcGFjaXR5KTtcbiAgfSxcbiAgZGFya2VyKGspIHtcbiAgICBrID0gayA9PSBudWxsID8gZGFya2VyIDogTWF0aC5wb3coZGFya2VyLCBrKTtcbiAgICByZXR1cm4gbmV3IFJnYih0aGlzLnIgKiBrLCB0aGlzLmcgKiBrLCB0aGlzLmIgKiBrLCB0aGlzLm9wYWNpdHkpO1xuICB9LFxuICByZ2IoKSB7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH0sXG4gIGNsYW1wKCkge1xuICAgIHJldHVybiBuZXcgUmdiKGNsYW1waSh0aGlzLnIpLCBjbGFtcGkodGhpcy5nKSwgY2xhbXBpKHRoaXMuYiksIGNsYW1wYSh0aGlzLm9wYWNpdHkpKTtcbiAgfSxcbiAgZGlzcGxheWFibGUoKSB7XG4gICAgcmV0dXJuICgtMC41IDw9IHRoaXMuciAmJiB0aGlzLnIgPCAyNTUuNSlcbiAgICAgICAgJiYgKC0wLjUgPD0gdGhpcy5nICYmIHRoaXMuZyA8IDI1NS41KVxuICAgICAgICAmJiAoLTAuNSA8PSB0aGlzLmIgJiYgdGhpcy5iIDwgMjU1LjUpXG4gICAgICAgICYmICgwIDw9IHRoaXMub3BhY2l0eSAmJiB0aGlzLm9wYWNpdHkgPD0gMSk7XG4gIH0sXG4gIGhleDogcmdiX2Zvcm1hdEhleCwgLy8gRGVwcmVjYXRlZCEgVXNlIGNvbG9yLmZvcm1hdEhleC5cbiAgZm9ybWF0SGV4OiByZ2JfZm9ybWF0SGV4LFxuICBmb3JtYXRIZXg4OiByZ2JfZm9ybWF0SGV4OCxcbiAgZm9ybWF0UmdiOiByZ2JfZm9ybWF0UmdiLFxuICB0b1N0cmluZzogcmdiX2Zvcm1hdFJnYlxufSkpO1xuXG5mdW5jdGlvbiByZ2JfZm9ybWF0SGV4KCkge1xuICByZXR1cm4gYCMke2hleCh0aGlzLnIpfSR7aGV4KHRoaXMuZyl9JHtoZXgodGhpcy5iKX1gO1xufVxuXG5mdW5jdGlvbiByZ2JfZm9ybWF0SGV4OCgpIHtcbiAgcmV0dXJuIGAjJHtoZXgodGhpcy5yKX0ke2hleCh0aGlzLmcpfSR7aGV4KHRoaXMuYil9JHtoZXgoKGlzTmFOKHRoaXMub3BhY2l0eSkgPyAxIDogdGhpcy5vcGFjaXR5KSAqIDI1NSl9YDtcbn1cblxuZnVuY3Rpb24gcmdiX2Zvcm1hdFJnYigpIHtcbiAgY29uc3QgYSA9IGNsYW1wYSh0aGlzLm9wYWNpdHkpO1xuICByZXR1cm4gYCR7YSA9PT0gMSA/IFwicmdiKFwiIDogXCJyZ2JhKFwifSR7Y2xhbXBpKHRoaXMucil9LCAke2NsYW1waSh0aGlzLmcpfSwgJHtjbGFtcGkodGhpcy5iKX0ke2EgPT09IDEgPyBcIilcIiA6IGAsICR7YX0pYH1gO1xufVxuXG5mdW5jdGlvbiBjbGFtcGEob3BhY2l0eSkge1xuICByZXR1cm4gaXNOYU4ob3BhY2l0eSkgPyAxIDogTWF0aC5tYXgoMCwgTWF0aC5taW4oMSwgb3BhY2l0eSkpO1xufVxuXG5mdW5jdGlvbiBjbGFtcGkodmFsdWUpIHtcbiAgcmV0dXJuIE1hdGgubWF4KDAsIE1hdGgubWluKDI1NSwgTWF0aC5yb3VuZCh2YWx1ZSkgfHwgMCkpO1xufVxuXG5mdW5jdGlvbiBoZXgodmFsdWUpIHtcbiAgdmFsdWUgPSBjbGFtcGkodmFsdWUpO1xuICByZXR1cm4gKHZhbHVlIDwgMTYgPyBcIjBcIiA6IFwiXCIpICsgdmFsdWUudG9TdHJpbmcoMTYpO1xufVxuXG5mdW5jdGlvbiBoc2xhKGgsIHMsIGwsIGEpIHtcbiAgaWYgKGEgPD0gMCkgaCA9IHMgPSBsID0gTmFOO1xuICBlbHNlIGlmIChsIDw9IDAgfHwgbCA+PSAxKSBoID0gcyA9IE5hTjtcbiAgZWxzZSBpZiAocyA8PSAwKSBoID0gTmFOO1xuICByZXR1cm4gbmV3IEhzbChoLCBzLCBsLCBhKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGhzbENvbnZlcnQobykge1xuICBpZiAobyBpbnN0YW5jZW9mIEhzbCkgcmV0dXJuIG5ldyBIc2woby5oLCBvLnMsIG8ubCwgby5vcGFjaXR5KTtcbiAgaWYgKCEobyBpbnN0YW5jZW9mIENvbG9yKSkgbyA9IGNvbG9yKG8pO1xuICBpZiAoIW8pIHJldHVybiBuZXcgSHNsO1xuICBpZiAobyBpbnN0YW5jZW9mIEhzbCkgcmV0dXJuIG87XG4gIG8gPSBvLnJnYigpO1xuICB2YXIgciA9IG8uciAvIDI1NSxcbiAgICAgIGcgPSBvLmcgLyAyNTUsXG4gICAgICBiID0gby5iIC8gMjU1LFxuICAgICAgbWluID0gTWF0aC5taW4ociwgZywgYiksXG4gICAgICBtYXggPSBNYXRoLm1heChyLCBnLCBiKSxcbiAgICAgIGggPSBOYU4sXG4gICAgICBzID0gbWF4IC0gbWluLFxuICAgICAgbCA9IChtYXggKyBtaW4pIC8gMjtcbiAgaWYgKHMpIHtcbiAgICBpZiAociA9PT0gbWF4KSBoID0gKGcgLSBiKSAvIHMgKyAoZyA8IGIpICogNjtcbiAgICBlbHNlIGlmIChnID09PSBtYXgpIGggPSAoYiAtIHIpIC8gcyArIDI7XG4gICAgZWxzZSBoID0gKHIgLSBnKSAvIHMgKyA0O1xuICAgIHMgLz0gbCA8IDAuNSA/IG1heCArIG1pbiA6IDIgLSBtYXggLSBtaW47XG4gICAgaCAqPSA2MDtcbiAgfSBlbHNlIHtcbiAgICBzID0gbCA+IDAgJiYgbCA8IDEgPyAwIDogaDtcbiAgfVxuICByZXR1cm4gbmV3IEhzbChoLCBzLCBsLCBvLm9wYWNpdHkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaHNsKGgsIHMsIGwsIG9wYWNpdHkpIHtcbiAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPT09IDEgPyBoc2xDb252ZXJ0KGgpIDogbmV3IEhzbChoLCBzLCBsLCBvcGFjaXR5ID09IG51bGwgPyAxIDogb3BhY2l0eSk7XG59XG5cbmZ1bmN0aW9uIEhzbChoLCBzLCBsLCBvcGFjaXR5KSB7XG4gIHRoaXMuaCA9ICtoO1xuICB0aGlzLnMgPSArcztcbiAgdGhpcy5sID0gK2w7XG4gIHRoaXMub3BhY2l0eSA9ICtvcGFjaXR5O1xufVxuXG5kZWZpbmUoSHNsLCBoc2wsIGV4dGVuZChDb2xvciwge1xuICBicmlnaHRlcihrKSB7XG4gICAgayA9IGsgPT0gbnVsbCA/IGJyaWdodGVyIDogTWF0aC5wb3coYnJpZ2h0ZXIsIGspO1xuICAgIHJldHVybiBuZXcgSHNsKHRoaXMuaCwgdGhpcy5zLCB0aGlzLmwgKiBrLCB0aGlzLm9wYWNpdHkpO1xuICB9LFxuICBkYXJrZXIoaykge1xuICAgIGsgPSBrID09IG51bGwgPyBkYXJrZXIgOiBNYXRoLnBvdyhkYXJrZXIsIGspO1xuICAgIHJldHVybiBuZXcgSHNsKHRoaXMuaCwgdGhpcy5zLCB0aGlzLmwgKiBrLCB0aGlzLm9wYWNpdHkpO1xuICB9LFxuICByZ2IoKSB7XG4gICAgdmFyIGggPSB0aGlzLmggJSAzNjAgKyAodGhpcy5oIDwgMCkgKiAzNjAsXG4gICAgICAgIHMgPSBpc05hTihoKSB8fCBpc05hTih0aGlzLnMpID8gMCA6IHRoaXMucyxcbiAgICAgICAgbCA9IHRoaXMubCxcbiAgICAgICAgbTIgPSBsICsgKGwgPCAwLjUgPyBsIDogMSAtIGwpICogcyxcbiAgICAgICAgbTEgPSAyICogbCAtIG0yO1xuICAgIHJldHVybiBuZXcgUmdiKFxuICAgICAgaHNsMnJnYihoID49IDI0MCA/IGggLSAyNDAgOiBoICsgMTIwLCBtMSwgbTIpLFxuICAgICAgaHNsMnJnYihoLCBtMSwgbTIpLFxuICAgICAgaHNsMnJnYihoIDwgMTIwID8gaCArIDI0MCA6IGggLSAxMjAsIG0xLCBtMiksXG4gICAgICB0aGlzLm9wYWNpdHlcbiAgICApO1xuICB9LFxuICBjbGFtcCgpIHtcbiAgICByZXR1cm4gbmV3IEhzbChjbGFtcGgodGhpcy5oKSwgY2xhbXB0KHRoaXMucyksIGNsYW1wdCh0aGlzLmwpLCBjbGFtcGEodGhpcy5vcGFjaXR5KSk7XG4gIH0sXG4gIGRpc3BsYXlhYmxlKCkge1xuICAgIHJldHVybiAoMCA8PSB0aGlzLnMgJiYgdGhpcy5zIDw9IDEgfHwgaXNOYU4odGhpcy5zKSlcbiAgICAgICAgJiYgKDAgPD0gdGhpcy5sICYmIHRoaXMubCA8PSAxKVxuICAgICAgICAmJiAoMCA8PSB0aGlzLm9wYWNpdHkgJiYgdGhpcy5vcGFjaXR5IDw9IDEpO1xuICB9LFxuICBmb3JtYXRIc2woKSB7XG4gICAgY29uc3QgYSA9IGNsYW1wYSh0aGlzLm9wYWNpdHkpO1xuICAgIHJldHVybiBgJHthID09PSAxID8gXCJoc2woXCIgOiBcImhzbGEoXCJ9JHtjbGFtcGgodGhpcy5oKX0sICR7Y2xhbXB0KHRoaXMucykgKiAxMDB9JSwgJHtjbGFtcHQodGhpcy5sKSAqIDEwMH0lJHthID09PSAxID8gXCIpXCIgOiBgLCAke2F9KWB9YDtcbiAgfVxufSkpO1xuXG5mdW5jdGlvbiBjbGFtcGgodmFsdWUpIHtcbiAgdmFsdWUgPSAodmFsdWUgfHwgMCkgJSAzNjA7XG4gIHJldHVybiB2YWx1ZSA8IDAgPyB2YWx1ZSArIDM2MCA6IHZhbHVlO1xufVxuXG5mdW5jdGlvbiBjbGFtcHQodmFsdWUpIHtcbiAgcmV0dXJuIE1hdGgubWF4KDAsIE1hdGgubWluKDEsIHZhbHVlIHx8IDApKTtcbn1cblxuLyogRnJvbSBGdkQgMTMuMzcsIENTUyBDb2xvciBNb2R1bGUgTGV2ZWwgMyAqL1xuZnVuY3Rpb24gaHNsMnJnYihoLCBtMSwgbTIpIHtcbiAgcmV0dXJuIChoIDwgNjAgPyBtMSArIChtMiAtIG0xKSAqIGggLyA2MFxuICAgICAgOiBoIDwgMTgwID8gbTJcbiAgICAgIDogaCA8IDI0MCA/IG0xICsgKG0yIC0gbTEpICogKDI0MCAtIGgpIC8gNjBcbiAgICAgIDogbTEpICogMjU1O1xufVxuIiwgImV4cG9ydCBmdW5jdGlvbiBiYXNpcyh0MSwgdjAsIHYxLCB2MiwgdjMpIHtcbiAgdmFyIHQyID0gdDEgKiB0MSwgdDMgPSB0MiAqIHQxO1xuICByZXR1cm4gKCgxIC0gMyAqIHQxICsgMyAqIHQyIC0gdDMpICogdjBcbiAgICAgICsgKDQgLSA2ICogdDIgKyAzICogdDMpICogdjFcbiAgICAgICsgKDEgKyAzICogdDEgKyAzICogdDIgLSAzICogdDMpICogdjJcbiAgICAgICsgdDMgKiB2MykgLyA2O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih2YWx1ZXMpIHtcbiAgdmFyIG4gPSB2YWx1ZXMubGVuZ3RoIC0gMTtcbiAgcmV0dXJuIGZ1bmN0aW9uKHQpIHtcbiAgICB2YXIgaSA9IHQgPD0gMCA/ICh0ID0gMCkgOiB0ID49IDEgPyAodCA9IDEsIG4gLSAxKSA6IE1hdGguZmxvb3IodCAqIG4pLFxuICAgICAgICB2MSA9IHZhbHVlc1tpXSxcbiAgICAgICAgdjIgPSB2YWx1ZXNbaSArIDFdLFxuICAgICAgICB2MCA9IGkgPiAwID8gdmFsdWVzW2kgLSAxXSA6IDIgKiB2MSAtIHYyLFxuICAgICAgICB2MyA9IGkgPCBuIC0gMSA/IHZhbHVlc1tpICsgMl0gOiAyICogdjIgLSB2MTtcbiAgICByZXR1cm4gYmFzaXMoKHQgLSBpIC8gbikgKiBuLCB2MCwgdjEsIHYyLCB2Myk7XG4gIH07XG59XG4iLCAiaW1wb3J0IHtiYXNpc30gZnJvbSBcIi4vYmFzaXMuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24odmFsdWVzKSB7XG4gIHZhciBuID0gdmFsdWVzLmxlbmd0aDtcbiAgcmV0dXJuIGZ1bmN0aW9uKHQpIHtcbiAgICB2YXIgaSA9IE1hdGguZmxvb3IoKCh0ICU9IDEpIDwgMCA/ICsrdCA6IHQpICogbiksXG4gICAgICAgIHYwID0gdmFsdWVzWyhpICsgbiAtIDEpICUgbl0sXG4gICAgICAgIHYxID0gdmFsdWVzW2kgJSBuXSxcbiAgICAgICAgdjIgPSB2YWx1ZXNbKGkgKyAxKSAlIG5dLFxuICAgICAgICB2MyA9IHZhbHVlc1soaSArIDIpICUgbl07XG4gICAgcmV0dXJuIGJhc2lzKCh0IC0gaSAvIG4pICogbiwgdjAsIHYxLCB2MiwgdjMpO1xuICB9O1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IHggPT4gKCkgPT4geDtcbiIsICJpbXBvcnQgY29uc3RhbnQgZnJvbSBcIi4vY29uc3RhbnQuanNcIjtcblxuZnVuY3Rpb24gbGluZWFyKGEsIGQpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKHQpIHtcbiAgICByZXR1cm4gYSArIHQgKiBkO1xuICB9O1xufVxuXG5mdW5jdGlvbiBleHBvbmVudGlhbChhLCBiLCB5KSB7XG4gIHJldHVybiBhID0gTWF0aC5wb3coYSwgeSksIGIgPSBNYXRoLnBvdyhiLCB5KSAtIGEsIHkgPSAxIC8geSwgZnVuY3Rpb24odCkge1xuICAgIHJldHVybiBNYXRoLnBvdyhhICsgdCAqIGIsIHkpO1xuICB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaHVlKGEsIGIpIHtcbiAgdmFyIGQgPSBiIC0gYTtcbiAgcmV0dXJuIGQgPyBsaW5lYXIoYSwgZCA+IDE4MCB8fCBkIDwgLTE4MCA/IGQgLSAzNjAgKiBNYXRoLnJvdW5kKGQgLyAzNjApIDogZCkgOiBjb25zdGFudChpc05hTihhKSA/IGIgOiBhKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdhbW1hKHkpIHtcbiAgcmV0dXJuICh5ID0gK3kpID09PSAxID8gbm9nYW1tYSA6IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICByZXR1cm4gYiAtIGEgPyBleHBvbmVudGlhbChhLCBiLCB5KSA6IGNvbnN0YW50KGlzTmFOKGEpID8gYiA6IGEpO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBub2dhbW1hKGEsIGIpIHtcbiAgdmFyIGQgPSBiIC0gYTtcbiAgcmV0dXJuIGQgPyBsaW5lYXIoYSwgZCkgOiBjb25zdGFudChpc05hTihhKSA/IGIgOiBhKTtcbn1cbiIsICJpbXBvcnQge3JnYiBhcyBjb2xvclJnYn0gZnJvbSBcImQzLWNvbG9yXCI7XG5pbXBvcnQgYmFzaXMgZnJvbSBcIi4vYmFzaXMuanNcIjtcbmltcG9ydCBiYXNpc0Nsb3NlZCBmcm9tIFwiLi9iYXNpc0Nsb3NlZC5qc1wiO1xuaW1wb3J0IG5vZ2FtbWEsIHtnYW1tYX0gZnJvbSBcIi4vY29sb3IuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgKGZ1bmN0aW9uIHJnYkdhbW1hKHkpIHtcbiAgdmFyIGNvbG9yID0gZ2FtbWEoeSk7XG5cbiAgZnVuY3Rpb24gcmdiKHN0YXJ0LCBlbmQpIHtcbiAgICB2YXIgciA9IGNvbG9yKChzdGFydCA9IGNvbG9yUmdiKHN0YXJ0KSkuciwgKGVuZCA9IGNvbG9yUmdiKGVuZCkpLnIpLFxuICAgICAgICBnID0gY29sb3Ioc3RhcnQuZywgZW5kLmcpLFxuICAgICAgICBiID0gY29sb3Ioc3RhcnQuYiwgZW5kLmIpLFxuICAgICAgICBvcGFjaXR5ID0gbm9nYW1tYShzdGFydC5vcGFjaXR5LCBlbmQub3BhY2l0eSk7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKHQpIHtcbiAgICAgIHN0YXJ0LnIgPSByKHQpO1xuICAgICAgc3RhcnQuZyA9IGcodCk7XG4gICAgICBzdGFydC5iID0gYih0KTtcbiAgICAgIHN0YXJ0Lm9wYWNpdHkgPSBvcGFjaXR5KHQpO1xuICAgICAgcmV0dXJuIHN0YXJ0ICsgXCJcIjtcbiAgICB9O1xuICB9XG5cbiAgcmdiLmdhbW1hID0gcmdiR2FtbWE7XG5cbiAgcmV0dXJuIHJnYjtcbn0pKDEpO1xuXG5mdW5jdGlvbiByZ2JTcGxpbmUoc3BsaW5lKSB7XG4gIHJldHVybiBmdW5jdGlvbihjb2xvcnMpIHtcbiAgICB2YXIgbiA9IGNvbG9ycy5sZW5ndGgsXG4gICAgICAgIHIgPSBuZXcgQXJyYXkobiksXG4gICAgICAgIGcgPSBuZXcgQXJyYXkobiksXG4gICAgICAgIGIgPSBuZXcgQXJyYXkobiksXG4gICAgICAgIGksIGNvbG9yO1xuICAgIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIGNvbG9yID0gY29sb3JSZ2IoY29sb3JzW2ldKTtcbiAgICAgIHJbaV0gPSBjb2xvci5yIHx8IDA7XG4gICAgICBnW2ldID0gY29sb3IuZyB8fCAwO1xuICAgICAgYltpXSA9IGNvbG9yLmIgfHwgMDtcbiAgICB9XG4gICAgciA9IHNwbGluZShyKTtcbiAgICBnID0gc3BsaW5lKGcpO1xuICAgIGIgPSBzcGxpbmUoYik7XG4gICAgY29sb3Iub3BhY2l0eSA9IDE7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKHQpIHtcbiAgICAgIGNvbG9yLnIgPSByKHQpO1xuICAgICAgY29sb3IuZyA9IGcodCk7XG4gICAgICBjb2xvci5iID0gYih0KTtcbiAgICAgIHJldHVybiBjb2xvciArIFwiXCI7XG4gICAgfTtcbiAgfTtcbn1cblxuZXhwb3J0IHZhciByZ2JCYXNpcyA9IHJnYlNwbGluZShiYXNpcyk7XG5leHBvcnQgdmFyIHJnYkJhc2lzQ2xvc2VkID0gcmdiU3BsaW5lKGJhc2lzQ2xvc2VkKTtcbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhID0gK2EsIGIgPSArYiwgZnVuY3Rpb24odCkge1xuICAgIHJldHVybiBhICogKDEgLSB0KSArIGIgKiB0O1xuICB9O1xufVxuIiwgImltcG9ydCBudW1iZXIgZnJvbSBcIi4vbnVtYmVyLmpzXCI7XG5cbnZhciByZUEgPSAvWy0rXT8oPzpcXGQrXFwuP1xcZCp8XFwuP1xcZCspKD86W2VFXVstK10/XFxkKyk/L2csXG4gICAgcmVCID0gbmV3IFJlZ0V4cChyZUEuc291cmNlLCBcImdcIik7XG5cbmZ1bmN0aW9uIHplcm8oYikge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGI7XG4gIH07XG59XG5cbmZ1bmN0aW9uIG9uZShiKSB7XG4gIHJldHVybiBmdW5jdGlvbih0KSB7XG4gICAgcmV0dXJuIGIodCkgKyBcIlwiO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihhLCBiKSB7XG4gIHZhciBiaSA9IHJlQS5sYXN0SW5kZXggPSByZUIubGFzdEluZGV4ID0gMCwgLy8gc2NhbiBpbmRleCBmb3IgbmV4dCBudW1iZXIgaW4gYlxuICAgICAgYW0sIC8vIGN1cnJlbnQgbWF0Y2ggaW4gYVxuICAgICAgYm0sIC8vIGN1cnJlbnQgbWF0Y2ggaW4gYlxuICAgICAgYnMsIC8vIHN0cmluZyBwcmVjZWRpbmcgY3VycmVudCBudW1iZXIgaW4gYiwgaWYgYW55XG4gICAgICBpID0gLTEsIC8vIGluZGV4IGluIHNcbiAgICAgIHMgPSBbXSwgLy8gc3RyaW5nIGNvbnN0YW50cyBhbmQgcGxhY2Vob2xkZXJzXG4gICAgICBxID0gW107IC8vIG51bWJlciBpbnRlcnBvbGF0b3JzXG5cbiAgLy8gQ29lcmNlIGlucHV0cyB0byBzdHJpbmdzLlxuICBhID0gYSArIFwiXCIsIGIgPSBiICsgXCJcIjtcblxuICAvLyBJbnRlcnBvbGF0ZSBwYWlycyBvZiBudW1iZXJzIGluIGEgJiBiLlxuICB3aGlsZSAoKGFtID0gcmVBLmV4ZWMoYSkpXG4gICAgICAmJiAoYm0gPSByZUIuZXhlYyhiKSkpIHtcbiAgICBpZiAoKGJzID0gYm0uaW5kZXgpID4gYmkpIHsgLy8gYSBzdHJpbmcgcHJlY2VkZXMgdGhlIG5leHQgbnVtYmVyIGluIGJcbiAgICAgIGJzID0gYi5zbGljZShiaSwgYnMpO1xuICAgICAgaWYgKHNbaV0pIHNbaV0gKz0gYnM7IC8vIGNvYWxlc2NlIHdpdGggcHJldmlvdXMgc3RyaW5nXG4gICAgICBlbHNlIHNbKytpXSA9IGJzO1xuICAgIH1cbiAgICBpZiAoKGFtID0gYW1bMF0pID09PSAoYm0gPSBibVswXSkpIHsgLy8gbnVtYmVycyBpbiBhICYgYiBtYXRjaFxuICAgICAgaWYgKHNbaV0pIHNbaV0gKz0gYm07IC8vIGNvYWxlc2NlIHdpdGggcHJldmlvdXMgc3RyaW5nXG4gICAgICBlbHNlIHNbKytpXSA9IGJtO1xuICAgIH0gZWxzZSB7IC8vIGludGVycG9sYXRlIG5vbi1tYXRjaGluZyBudW1iZXJzXG4gICAgICBzWysraV0gPSBudWxsO1xuICAgICAgcS5wdXNoKHtpOiBpLCB4OiBudW1iZXIoYW0sIGJtKX0pO1xuICAgIH1cbiAgICBiaSA9IHJlQi5sYXN0SW5kZXg7XG4gIH1cblxuICAvLyBBZGQgcmVtYWlucyBvZiBiLlxuICBpZiAoYmkgPCBiLmxlbmd0aCkge1xuICAgIGJzID0gYi5zbGljZShiaSk7XG4gICAgaWYgKHNbaV0pIHNbaV0gKz0gYnM7IC8vIGNvYWxlc2NlIHdpdGggcHJldmlvdXMgc3RyaW5nXG4gICAgZWxzZSBzWysraV0gPSBicztcbiAgfVxuXG4gIC8vIFNwZWNpYWwgb3B0aW1pemF0aW9uIGZvciBvbmx5IGEgc2luZ2xlIG1hdGNoLlxuICAvLyBPdGhlcndpc2UsIGludGVycG9sYXRlIGVhY2ggb2YgdGhlIG51bWJlcnMgYW5kIHJlam9pbiB0aGUgc3RyaW5nLlxuICByZXR1cm4gcy5sZW5ndGggPCAyID8gKHFbMF1cbiAgICAgID8gb25lKHFbMF0ueClcbiAgICAgIDogemVybyhiKSlcbiAgICAgIDogKGIgPSBxLmxlbmd0aCwgZnVuY3Rpb24odCkge1xuICAgICAgICAgIGZvciAodmFyIGkgPSAwLCBvOyBpIDwgYjsgKytpKSBzWyhvID0gcVtpXSkuaV0gPSBvLngodCk7XG4gICAgICAgICAgcmV0dXJuIHMuam9pbihcIlwiKTtcbiAgICAgICAgfSk7XG59XG4iLCAidmFyIGRlZ3JlZXMgPSAxODAgLyBNYXRoLlBJO1xuXG5leHBvcnQgdmFyIGlkZW50aXR5ID0ge1xuICB0cmFuc2xhdGVYOiAwLFxuICB0cmFuc2xhdGVZOiAwLFxuICByb3RhdGU6IDAsXG4gIHNrZXdYOiAwLFxuICBzY2FsZVg6IDEsXG4gIHNjYWxlWTogMVxufTtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oYSwgYiwgYywgZCwgZSwgZikge1xuICB2YXIgc2NhbGVYLCBzY2FsZVksIHNrZXdYO1xuICBpZiAoc2NhbGVYID0gTWF0aC5zcXJ0KGEgKiBhICsgYiAqIGIpKSBhIC89IHNjYWxlWCwgYiAvPSBzY2FsZVg7XG4gIGlmIChza2V3WCA9IGEgKiBjICsgYiAqIGQpIGMgLT0gYSAqIHNrZXdYLCBkIC09IGIgKiBza2V3WDtcbiAgaWYgKHNjYWxlWSA9IE1hdGguc3FydChjICogYyArIGQgKiBkKSkgYyAvPSBzY2FsZVksIGQgLz0gc2NhbGVZLCBza2V3WCAvPSBzY2FsZVk7XG4gIGlmIChhICogZCA8IGIgKiBjKSBhID0gLWEsIGIgPSAtYiwgc2tld1ggPSAtc2tld1gsIHNjYWxlWCA9IC1zY2FsZVg7XG4gIHJldHVybiB7XG4gICAgdHJhbnNsYXRlWDogZSxcbiAgICB0cmFuc2xhdGVZOiBmLFxuICAgIHJvdGF0ZTogTWF0aC5hdGFuMihiLCBhKSAqIGRlZ3JlZXMsXG4gICAgc2tld1g6IE1hdGguYXRhbihza2V3WCkgKiBkZWdyZWVzLFxuICAgIHNjYWxlWDogc2NhbGVYLFxuICAgIHNjYWxlWTogc2NhbGVZXG4gIH07XG59XG4iLCAiaW1wb3J0IGRlY29tcG9zZSwge2lkZW50aXR5fSBmcm9tIFwiLi9kZWNvbXBvc2UuanNcIjtcblxudmFyIHN2Z05vZGU7XG5cbi8qIGVzbGludC1kaXNhYmxlIG5vLXVuZGVmICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDc3ModmFsdWUpIHtcbiAgY29uc3QgbSA9IG5ldyAodHlwZW9mIERPTU1hdHJpeCA9PT0gXCJmdW5jdGlvblwiID8gRE9NTWF0cml4IDogV2ViS2l0Q1NTTWF0cml4KSh2YWx1ZSArIFwiXCIpO1xuICByZXR1cm4gbS5pc0lkZW50aXR5ID8gaWRlbnRpdHkgOiBkZWNvbXBvc2UobS5hLCBtLmIsIG0uYywgbS5kLCBtLmUsIG0uZik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVN2Zyh2YWx1ZSkge1xuICBpZiAodmFsdWUgPT0gbnVsbCkgcmV0dXJuIGlkZW50aXR5O1xuICBpZiAoIXN2Z05vZGUpIHN2Z05vZGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50TlMoXCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiLCBcImdcIik7XG4gIHN2Z05vZGUuc2V0QXR0cmlidXRlKFwidHJhbnNmb3JtXCIsIHZhbHVlKTtcbiAgaWYgKCEodmFsdWUgPSBzdmdOb2RlLnRyYW5zZm9ybS5iYXNlVmFsLmNvbnNvbGlkYXRlKCkpKSByZXR1cm4gaWRlbnRpdHk7XG4gIHZhbHVlID0gdmFsdWUubWF0cml4O1xuICByZXR1cm4gZGVjb21wb3NlKHZhbHVlLmEsIHZhbHVlLmIsIHZhbHVlLmMsIHZhbHVlLmQsIHZhbHVlLmUsIHZhbHVlLmYpO1xufVxuIiwgImltcG9ydCBudW1iZXIgZnJvbSBcIi4uL251bWJlci5qc1wiO1xuaW1wb3J0IHtwYXJzZUNzcywgcGFyc2VTdmd9IGZyb20gXCIuL3BhcnNlLmpzXCI7XG5cbmZ1bmN0aW9uIGludGVycG9sYXRlVHJhbnNmb3JtKHBhcnNlLCBweENvbW1hLCBweFBhcmVuLCBkZWdQYXJlbikge1xuXG4gIGZ1bmN0aW9uIHBvcChzKSB7XG4gICAgcmV0dXJuIHMubGVuZ3RoID8gcy5wb3AoKSArIFwiIFwiIDogXCJcIjtcbiAgfVxuXG4gIGZ1bmN0aW9uIHRyYW5zbGF0ZSh4YSwgeWEsIHhiLCB5YiwgcywgcSkge1xuICAgIGlmICh4YSAhPT0geGIgfHwgeWEgIT09IHliKSB7XG4gICAgICB2YXIgaSA9IHMucHVzaChcInRyYW5zbGF0ZShcIiwgbnVsbCwgcHhDb21tYSwgbnVsbCwgcHhQYXJlbik7XG4gICAgICBxLnB1c2goe2k6IGkgLSA0LCB4OiBudW1iZXIoeGEsIHhiKX0sIHtpOiBpIC0gMiwgeDogbnVtYmVyKHlhLCB5Yil9KTtcbiAgICB9IGVsc2UgaWYgKHhiIHx8IHliKSB7XG4gICAgICBzLnB1c2goXCJ0cmFuc2xhdGUoXCIgKyB4YiArIHB4Q29tbWEgKyB5YiArIHB4UGFyZW4pO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHJvdGF0ZShhLCBiLCBzLCBxKSB7XG4gICAgaWYgKGEgIT09IGIpIHtcbiAgICAgIGlmIChhIC0gYiA+IDE4MCkgYiArPSAzNjA7IGVsc2UgaWYgKGIgLSBhID4gMTgwKSBhICs9IDM2MDsgLy8gc2hvcnRlc3QgcGF0aFxuICAgICAgcS5wdXNoKHtpOiBzLnB1c2gocG9wKHMpICsgXCJyb3RhdGUoXCIsIG51bGwsIGRlZ1BhcmVuKSAtIDIsIHg6IG51bWJlcihhLCBiKX0pO1xuICAgIH0gZWxzZSBpZiAoYikge1xuICAgICAgcy5wdXNoKHBvcChzKSArIFwicm90YXRlKFwiICsgYiArIGRlZ1BhcmVuKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBza2V3WChhLCBiLCBzLCBxKSB7XG4gICAgaWYgKGEgIT09IGIpIHtcbiAgICAgIHEucHVzaCh7aTogcy5wdXNoKHBvcChzKSArIFwic2tld1goXCIsIG51bGwsIGRlZ1BhcmVuKSAtIDIsIHg6IG51bWJlcihhLCBiKX0pO1xuICAgIH0gZWxzZSBpZiAoYikge1xuICAgICAgcy5wdXNoKHBvcChzKSArIFwic2tld1goXCIgKyBiICsgZGVnUGFyZW4pO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHNjYWxlKHhhLCB5YSwgeGIsIHliLCBzLCBxKSB7XG4gICAgaWYgKHhhICE9PSB4YiB8fCB5YSAhPT0geWIpIHtcbiAgICAgIHZhciBpID0gcy5wdXNoKHBvcChzKSArIFwic2NhbGUoXCIsIG51bGwsIFwiLFwiLCBudWxsLCBcIilcIik7XG4gICAgICBxLnB1c2goe2k6IGkgLSA0LCB4OiBudW1iZXIoeGEsIHhiKX0sIHtpOiBpIC0gMiwgeDogbnVtYmVyKHlhLCB5Yil9KTtcbiAgICB9IGVsc2UgaWYgKHhiICE9PSAxIHx8IHliICE9PSAxKSB7XG4gICAgICBzLnB1c2gocG9wKHMpICsgXCJzY2FsZShcIiArIHhiICsgXCIsXCIgKyB5YiArIFwiKVwiKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gZnVuY3Rpb24oYSwgYikge1xuICAgIHZhciBzID0gW10sIC8vIHN0cmluZyBjb25zdGFudHMgYW5kIHBsYWNlaG9sZGVyc1xuICAgICAgICBxID0gW107IC8vIG51bWJlciBpbnRlcnBvbGF0b3JzXG4gICAgYSA9IHBhcnNlKGEpLCBiID0gcGFyc2UoYik7XG4gICAgdHJhbnNsYXRlKGEudHJhbnNsYXRlWCwgYS50cmFuc2xhdGVZLCBiLnRyYW5zbGF0ZVgsIGIudHJhbnNsYXRlWSwgcywgcSk7XG4gICAgcm90YXRlKGEucm90YXRlLCBiLnJvdGF0ZSwgcywgcSk7XG4gICAgc2tld1goYS5za2V3WCwgYi5za2V3WCwgcywgcSk7XG4gICAgc2NhbGUoYS5zY2FsZVgsIGEuc2NhbGVZLCBiLnNjYWxlWCwgYi5zY2FsZVksIHMsIHEpO1xuICAgIGEgPSBiID0gbnVsbDsgLy8gZ2NcbiAgICByZXR1cm4gZnVuY3Rpb24odCkge1xuICAgICAgdmFyIGkgPSAtMSwgbiA9IHEubGVuZ3RoLCBvO1xuICAgICAgd2hpbGUgKCsraSA8IG4pIHNbKG8gPSBxW2ldKS5pXSA9IG8ueCh0KTtcbiAgICAgIHJldHVybiBzLmpvaW4oXCJcIik7XG4gICAgfTtcbiAgfTtcbn1cblxuZXhwb3J0IHZhciBpbnRlcnBvbGF0ZVRyYW5zZm9ybUNzcyA9IGludGVycG9sYXRlVHJhbnNmb3JtKHBhcnNlQ3NzLCBcInB4LCBcIiwgXCJweClcIiwgXCJkZWcpXCIpO1xuZXhwb3J0IHZhciBpbnRlcnBvbGF0ZVRyYW5zZm9ybVN2ZyA9IGludGVycG9sYXRlVHJhbnNmb3JtKHBhcnNlU3ZnLCBcIiwgXCIsIFwiKVwiLCBcIilcIik7XG4iLCAidmFyIGVwc2lsb24yID0gMWUtMTI7XG5cbmZ1bmN0aW9uIGNvc2goeCkge1xuICByZXR1cm4gKCh4ID0gTWF0aC5leHAoeCkpICsgMSAvIHgpIC8gMjtcbn1cblxuZnVuY3Rpb24gc2luaCh4KSB7XG4gIHJldHVybiAoKHggPSBNYXRoLmV4cCh4KSkgLSAxIC8geCkgLyAyO1xufVxuXG5mdW5jdGlvbiB0YW5oKHgpIHtcbiAgcmV0dXJuICgoeCA9IE1hdGguZXhwKDIgKiB4KSkgLSAxKSAvICh4ICsgMSk7XG59XG5cbmV4cG9ydCBkZWZhdWx0IChmdW5jdGlvbiB6b29tUmhvKHJobywgcmhvMiwgcmhvNCkge1xuXG4gIC8vIHAwID0gW3V4MCwgdXkwLCB3MF1cbiAgLy8gcDEgPSBbdXgxLCB1eTEsIHcxXVxuICBmdW5jdGlvbiB6b29tKHAwLCBwMSkge1xuICAgIHZhciB1eDAgPSBwMFswXSwgdXkwID0gcDBbMV0sIHcwID0gcDBbMl0sXG4gICAgICAgIHV4MSA9IHAxWzBdLCB1eTEgPSBwMVsxXSwgdzEgPSBwMVsyXSxcbiAgICAgICAgZHggPSB1eDEgLSB1eDAsXG4gICAgICAgIGR5ID0gdXkxIC0gdXkwLFxuICAgICAgICBkMiA9IGR4ICogZHggKyBkeSAqIGR5LFxuICAgICAgICBpLFxuICAgICAgICBTO1xuXG4gICAgLy8gU3BlY2lhbCBjYXNlIGZvciB1MCBcdTIyNDUgdTEuXG4gICAgaWYgKGQyIDwgZXBzaWxvbjIpIHtcbiAgICAgIFMgPSBNYXRoLmxvZyh3MSAvIHcwKSAvIHJobztcbiAgICAgIGkgPSBmdW5jdGlvbih0KSB7XG4gICAgICAgIHJldHVybiBbXG4gICAgICAgICAgdXgwICsgdCAqIGR4LFxuICAgICAgICAgIHV5MCArIHQgKiBkeSxcbiAgICAgICAgICB3MCAqIE1hdGguZXhwKHJobyAqIHQgKiBTKVxuICAgICAgICBdO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEdlbmVyYWwgY2FzZS5cbiAgICBlbHNlIHtcbiAgICAgIHZhciBkMSA9IE1hdGguc3FydChkMiksXG4gICAgICAgICAgYjAgPSAodzEgKiB3MSAtIHcwICogdzAgKyByaG80ICogZDIpIC8gKDIgKiB3MCAqIHJobzIgKiBkMSksXG4gICAgICAgICAgYjEgPSAodzEgKiB3MSAtIHcwICogdzAgLSByaG80ICogZDIpIC8gKDIgKiB3MSAqIHJobzIgKiBkMSksXG4gICAgICAgICAgcjAgPSBNYXRoLmxvZyhNYXRoLnNxcnQoYjAgKiBiMCArIDEpIC0gYjApLFxuICAgICAgICAgIHIxID0gTWF0aC5sb2coTWF0aC5zcXJ0KGIxICogYjEgKyAxKSAtIGIxKTtcbiAgICAgIFMgPSAocjEgLSByMCkgLyByaG87XG4gICAgICBpID0gZnVuY3Rpb24odCkge1xuICAgICAgICB2YXIgcyA9IHQgKiBTLFxuICAgICAgICAgICAgY29zaHIwID0gY29zaChyMCksXG4gICAgICAgICAgICB1ID0gdzAgLyAocmhvMiAqIGQxKSAqIChjb3NocjAgKiB0YW5oKHJobyAqIHMgKyByMCkgLSBzaW5oKHIwKSk7XG4gICAgICAgIHJldHVybiBbXG4gICAgICAgICAgdXgwICsgdSAqIGR4LFxuICAgICAgICAgIHV5MCArIHUgKiBkeSxcbiAgICAgICAgICB3MCAqIGNvc2hyMCAvIGNvc2gocmhvICogcyArIHIwKVxuICAgICAgICBdO1xuICAgICAgfVxuICAgIH1cblxuICAgIGkuZHVyYXRpb24gPSBTICogMTAwMCAqIHJobyAvIE1hdGguU1FSVDI7XG5cbiAgICByZXR1cm4gaTtcbiAgfVxuXG4gIHpvb20ucmhvID0gZnVuY3Rpb24oXykge1xuICAgIHZhciBfMSA9IE1hdGgubWF4KDFlLTMsICtfKSwgXzIgPSBfMSAqIF8xLCBfNCA9IF8yICogXzI7XG4gICAgcmV0dXJuIHpvb21SaG8oXzEsIF8yLCBfNCk7XG4gIH07XG5cbiAgcmV0dXJuIHpvb207XG59KShNYXRoLlNRUlQyLCAyLCA0KTtcbiIsICJ2YXIgZnJhbWUgPSAwLCAvLyBpcyBhbiBhbmltYXRpb24gZnJhbWUgcGVuZGluZz9cbiAgICB0aW1lb3V0ID0gMCwgLy8gaXMgYSB0aW1lb3V0IHBlbmRpbmc/XG4gICAgaW50ZXJ2YWwgPSAwLCAvLyBhcmUgYW55IHRpbWVycyBhY3RpdmU/XG4gICAgcG9rZURlbGF5ID0gMTAwMCwgLy8gaG93IGZyZXF1ZW50bHkgd2UgY2hlY2sgZm9yIGNsb2NrIHNrZXdcbiAgICB0YXNrSGVhZCxcbiAgICB0YXNrVGFpbCxcbiAgICBjbG9ja0xhc3QgPSAwLFxuICAgIGNsb2NrTm93ID0gMCxcbiAgICBjbG9ja1NrZXcgPSAwLFxuICAgIGNsb2NrID0gdHlwZW9mIHBlcmZvcm1hbmNlID09PSBcIm9iamVjdFwiICYmIHBlcmZvcm1hbmNlLm5vdyA/IHBlcmZvcm1hbmNlIDogRGF0ZSxcbiAgICBzZXRGcmFtZSA9IHR5cGVvZiB3aW5kb3cgPT09IFwib2JqZWN0XCIgJiYgd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSA/IHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUuYmluZCh3aW5kb3cpIDogZnVuY3Rpb24oZikgeyBzZXRUaW1lb3V0KGYsIDE3KTsgfTtcblxuZXhwb3J0IGZ1bmN0aW9uIG5vdygpIHtcbiAgcmV0dXJuIGNsb2NrTm93IHx8IChzZXRGcmFtZShjbGVhck5vdyksIGNsb2NrTm93ID0gY2xvY2subm93KCkgKyBjbG9ja1NrZXcpO1xufVxuXG5mdW5jdGlvbiBjbGVhck5vdygpIHtcbiAgY2xvY2tOb3cgPSAwO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gVGltZXIoKSB7XG4gIHRoaXMuX2NhbGwgPVxuICB0aGlzLl90aW1lID1cbiAgdGhpcy5fbmV4dCA9IG51bGw7XG59XG5cblRpbWVyLnByb3RvdHlwZSA9IHRpbWVyLnByb3RvdHlwZSA9IHtcbiAgY29uc3RydWN0b3I6IFRpbWVyLFxuICByZXN0YXJ0OiBmdW5jdGlvbihjYWxsYmFjaywgZGVsYXksIHRpbWUpIHtcbiAgICBpZiAodHlwZW9mIGNhbGxiYWNrICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJjYWxsYmFjayBpcyBub3QgYSBmdW5jdGlvblwiKTtcbiAgICB0aW1lID0gKHRpbWUgPT0gbnVsbCA/IG5vdygpIDogK3RpbWUpICsgKGRlbGF5ID09IG51bGwgPyAwIDogK2RlbGF5KTtcbiAgICBpZiAoIXRoaXMuX25leHQgJiYgdGFza1RhaWwgIT09IHRoaXMpIHtcbiAgICAgIGlmICh0YXNrVGFpbCkgdGFza1RhaWwuX25leHQgPSB0aGlzO1xuICAgICAgZWxzZSB0YXNrSGVhZCA9IHRoaXM7XG4gICAgICB0YXNrVGFpbCA9IHRoaXM7XG4gICAgfVxuICAgIHRoaXMuX2NhbGwgPSBjYWxsYmFjaztcbiAgICB0aGlzLl90aW1lID0gdGltZTtcbiAgICBzbGVlcCgpO1xuICB9LFxuICBzdG9wOiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5fY2FsbCkge1xuICAgICAgdGhpcy5fY2FsbCA9IG51bGw7XG4gICAgICB0aGlzLl90aW1lID0gSW5maW5pdHk7XG4gICAgICBzbGVlcCgpO1xuICAgIH1cbiAgfVxufTtcblxuZXhwb3J0IGZ1bmN0aW9uIHRpbWVyKGNhbGxiYWNrLCBkZWxheSwgdGltZSkge1xuICB2YXIgdCA9IG5ldyBUaW1lcjtcbiAgdC5yZXN0YXJ0KGNhbGxiYWNrLCBkZWxheSwgdGltZSk7XG4gIHJldHVybiB0O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gdGltZXJGbHVzaCgpIHtcbiAgbm93KCk7IC8vIEdldCB0aGUgY3VycmVudCB0aW1lLCBpZiBub3QgYWxyZWFkeSBzZXQuXG4gICsrZnJhbWU7IC8vIFByZXRlbmQgd2VcdTIwMTl2ZSBzZXQgYW4gYWxhcm0sIGlmIHdlIGhhdmVuXHUyMDE5dCBhbHJlYWR5LlxuICB2YXIgdCA9IHRhc2tIZWFkLCBlO1xuICB3aGlsZSAodCkge1xuICAgIGlmICgoZSA9IGNsb2NrTm93IC0gdC5fdGltZSkgPj0gMCkgdC5fY2FsbC5jYWxsKHVuZGVmaW5lZCwgZSk7XG4gICAgdCA9IHQuX25leHQ7XG4gIH1cbiAgLS1mcmFtZTtcbn1cblxuZnVuY3Rpb24gd2FrZSgpIHtcbiAgY2xvY2tOb3cgPSAoY2xvY2tMYXN0ID0gY2xvY2subm93KCkpICsgY2xvY2tTa2V3O1xuICBmcmFtZSA9IHRpbWVvdXQgPSAwO1xuICB0cnkge1xuICAgIHRpbWVyRmx1c2goKTtcbiAgfSBmaW5hbGx5IHtcbiAgICBmcmFtZSA9IDA7XG4gICAgbmFwKCk7XG4gICAgY2xvY2tOb3cgPSAwO1xuICB9XG59XG5cbmZ1bmN0aW9uIHBva2UoKSB7XG4gIHZhciBub3cgPSBjbG9jay5ub3coKSwgZGVsYXkgPSBub3cgLSBjbG9ja0xhc3Q7XG4gIGlmIChkZWxheSA+IHBva2VEZWxheSkgY2xvY2tTa2V3IC09IGRlbGF5LCBjbG9ja0xhc3QgPSBub3c7XG59XG5cbmZ1bmN0aW9uIG5hcCgpIHtcbiAgdmFyIHQwLCB0MSA9IHRhc2tIZWFkLCB0MiwgdGltZSA9IEluZmluaXR5O1xuICB3aGlsZSAodDEpIHtcbiAgICBpZiAodDEuX2NhbGwpIHtcbiAgICAgIGlmICh0aW1lID4gdDEuX3RpbWUpIHRpbWUgPSB0MS5fdGltZTtcbiAgICAgIHQwID0gdDEsIHQxID0gdDEuX25leHQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIHQyID0gdDEuX25leHQsIHQxLl9uZXh0ID0gbnVsbDtcbiAgICAgIHQxID0gdDAgPyB0MC5fbmV4dCA9IHQyIDogdGFza0hlYWQgPSB0MjtcbiAgICB9XG4gIH1cbiAgdGFza1RhaWwgPSB0MDtcbiAgc2xlZXAodGltZSk7XG59XG5cbmZ1bmN0aW9uIHNsZWVwKHRpbWUpIHtcbiAgaWYgKGZyYW1lKSByZXR1cm47IC8vIFNvb25lc3QgYWxhcm0gYWxyZWFkeSBzZXQsIG9yIHdpbGwgYmUuXG4gIGlmICh0aW1lb3V0KSB0aW1lb3V0ID0gY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuICB2YXIgZGVsYXkgPSB0aW1lIC0gY2xvY2tOb3c7IC8vIFN0cmljdGx5IGxlc3MgdGhhbiBpZiB3ZSByZWNvbXB1dGVkIGNsb2NrTm93LlxuICBpZiAoZGVsYXkgPiAyNCkge1xuICAgIGlmICh0aW1lIDwgSW5maW5pdHkpIHRpbWVvdXQgPSBzZXRUaW1lb3V0KHdha2UsIHRpbWUgLSBjbG9jay5ub3coKSAtIGNsb2NrU2tldyk7XG4gICAgaWYgKGludGVydmFsKSBpbnRlcnZhbCA9IGNsZWFySW50ZXJ2YWwoaW50ZXJ2YWwpO1xuICB9IGVsc2Uge1xuICAgIGlmICghaW50ZXJ2YWwpIGNsb2NrTGFzdCA9IGNsb2NrLm5vdygpLCBpbnRlcnZhbCA9IHNldEludGVydmFsKHBva2UsIHBva2VEZWxheSk7XG4gICAgZnJhbWUgPSAxLCBzZXRGcmFtZSh3YWtlKTtcbiAgfVxufVxuIiwgImltcG9ydCB7VGltZXJ9IGZyb20gXCIuL3RpbWVyLmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGNhbGxiYWNrLCBkZWxheSwgdGltZSkge1xuICB2YXIgdCA9IG5ldyBUaW1lcjtcbiAgZGVsYXkgPSBkZWxheSA9PSBudWxsID8gMCA6ICtkZWxheTtcbiAgdC5yZXN0YXJ0KGVsYXBzZWQgPT4ge1xuICAgIHQuc3RvcCgpO1xuICAgIGNhbGxiYWNrKGVsYXBzZWQgKyBkZWxheSk7XG4gIH0sIGRlbGF5LCB0aW1lKTtcbiAgcmV0dXJuIHQ7XG59XG4iLCAiaW1wb3J0IHtkaXNwYXRjaH0gZnJvbSBcImQzLWRpc3BhdGNoXCI7XG5pbXBvcnQge3RpbWVyLCB0aW1lb3V0fSBmcm9tIFwiZDMtdGltZXJcIjtcblxudmFyIGVtcHR5T24gPSBkaXNwYXRjaChcInN0YXJ0XCIsIFwiZW5kXCIsIFwiY2FuY2VsXCIsIFwiaW50ZXJydXB0XCIpO1xudmFyIGVtcHR5VHdlZW4gPSBbXTtcblxuZXhwb3J0IHZhciBDUkVBVEVEID0gMDtcbmV4cG9ydCB2YXIgU0NIRURVTEVEID0gMTtcbmV4cG9ydCB2YXIgU1RBUlRJTkcgPSAyO1xuZXhwb3J0IHZhciBTVEFSVEVEID0gMztcbmV4cG9ydCB2YXIgUlVOTklORyA9IDQ7XG5leHBvcnQgdmFyIEVORElORyA9IDU7XG5leHBvcnQgdmFyIEVOREVEID0gNjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obm9kZSwgbmFtZSwgaWQsIGluZGV4LCBncm91cCwgdGltaW5nKSB7XG4gIHZhciBzY2hlZHVsZXMgPSBub2RlLl9fdHJhbnNpdGlvbjtcbiAgaWYgKCFzY2hlZHVsZXMpIG5vZGUuX190cmFuc2l0aW9uID0ge307XG4gIGVsc2UgaWYgKGlkIGluIHNjaGVkdWxlcykgcmV0dXJuO1xuICBjcmVhdGUobm9kZSwgaWQsIHtcbiAgICBuYW1lOiBuYW1lLFxuICAgIGluZGV4OiBpbmRleCwgLy8gRm9yIGNvbnRleHQgZHVyaW5nIGNhbGxiYWNrLlxuICAgIGdyb3VwOiBncm91cCwgLy8gRm9yIGNvbnRleHQgZHVyaW5nIGNhbGxiYWNrLlxuICAgIG9uOiBlbXB0eU9uLFxuICAgIHR3ZWVuOiBlbXB0eVR3ZWVuLFxuICAgIHRpbWU6IHRpbWluZy50aW1lLFxuICAgIGRlbGF5OiB0aW1pbmcuZGVsYXksXG4gICAgZHVyYXRpb246IHRpbWluZy5kdXJhdGlvbixcbiAgICBlYXNlOiB0aW1pbmcuZWFzZSxcbiAgICB0aW1lcjogbnVsbCxcbiAgICBzdGF0ZTogQ1JFQVRFRFxuICB9KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGluaXQobm9kZSwgaWQpIHtcbiAgdmFyIHNjaGVkdWxlID0gZ2V0KG5vZGUsIGlkKTtcbiAgaWYgKHNjaGVkdWxlLnN0YXRlID4gQ1JFQVRFRCkgdGhyb3cgbmV3IEVycm9yKFwidG9vIGxhdGU7IGFscmVhZHkgc2NoZWR1bGVkXCIpO1xuICByZXR1cm4gc2NoZWR1bGU7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzZXQobm9kZSwgaWQpIHtcbiAgdmFyIHNjaGVkdWxlID0gZ2V0KG5vZGUsIGlkKTtcbiAgaWYgKHNjaGVkdWxlLnN0YXRlID4gU1RBUlRFRCkgdGhyb3cgbmV3IEVycm9yKFwidG9vIGxhdGU7IGFscmVhZHkgcnVubmluZ1wiKTtcbiAgcmV0dXJuIHNjaGVkdWxlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0KG5vZGUsIGlkKSB7XG4gIHZhciBzY2hlZHVsZSA9IG5vZGUuX190cmFuc2l0aW9uO1xuICBpZiAoIXNjaGVkdWxlIHx8ICEoc2NoZWR1bGUgPSBzY2hlZHVsZVtpZF0pKSB0aHJvdyBuZXcgRXJyb3IoXCJ0cmFuc2l0aW9uIG5vdCBmb3VuZFwiKTtcbiAgcmV0dXJuIHNjaGVkdWxlO1xufVxuXG5mdW5jdGlvbiBjcmVhdGUobm9kZSwgaWQsIHNlbGYpIHtcbiAgdmFyIHNjaGVkdWxlcyA9IG5vZGUuX190cmFuc2l0aW9uLFxuICAgICAgdHdlZW47XG5cbiAgLy8gSW5pdGlhbGl6ZSB0aGUgc2VsZiB0aW1lciB3aGVuIHRoZSB0cmFuc2l0aW9uIGlzIGNyZWF0ZWQuXG4gIC8vIE5vdGUgdGhlIGFjdHVhbCBkZWxheSBpcyBub3Qga25vd24gdW50aWwgdGhlIGZpcnN0IGNhbGxiYWNrIVxuICBzY2hlZHVsZXNbaWRdID0gc2VsZjtcbiAgc2VsZi50aW1lciA9IHRpbWVyKHNjaGVkdWxlLCAwLCBzZWxmLnRpbWUpO1xuXG4gIGZ1bmN0aW9uIHNjaGVkdWxlKGVsYXBzZWQpIHtcbiAgICBzZWxmLnN0YXRlID0gU0NIRURVTEVEO1xuICAgIHNlbGYudGltZXIucmVzdGFydChzdGFydCwgc2VsZi5kZWxheSwgc2VsZi50aW1lKTtcblxuICAgIC8vIElmIHRoZSBlbGFwc2VkIGRlbGF5IGlzIGxlc3MgdGhhbiBvdXIgZmlyc3Qgc2xlZXAsIHN0YXJ0IGltbWVkaWF0ZWx5LlxuICAgIGlmIChzZWxmLmRlbGF5IDw9IGVsYXBzZWQpIHN0YXJ0KGVsYXBzZWQgLSBzZWxmLmRlbGF5KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHN0YXJ0KGVsYXBzZWQpIHtcbiAgICB2YXIgaSwgaiwgbiwgbztcblxuICAgIC8vIElmIHRoZSBzdGF0ZSBpcyBub3QgU0NIRURVTEVELCB0aGVuIHdlIHByZXZpb3VzbHkgZXJyb3JlZCBvbiBzdGFydC5cbiAgICBpZiAoc2VsZi5zdGF0ZSAhPT0gU0NIRURVTEVEKSByZXR1cm4gc3RvcCgpO1xuXG4gICAgZm9yIChpIGluIHNjaGVkdWxlcykge1xuICAgICAgbyA9IHNjaGVkdWxlc1tpXTtcbiAgICAgIGlmIChvLm5hbWUgIT09IHNlbGYubmFtZSkgY29udGludWU7XG5cbiAgICAgIC8vIFdoaWxlIHRoaXMgZWxlbWVudCBhbHJlYWR5IGhhcyBhIHN0YXJ0aW5nIHRyYW5zaXRpb24gZHVyaW5nIHRoaXMgZnJhbWUsXG4gICAgICAvLyBkZWZlciBzdGFydGluZyBhbiBpbnRlcnJ1cHRpbmcgdHJhbnNpdGlvbiB1bnRpbCB0aGF0IHRyYW5zaXRpb24gaGFzIGFcbiAgICAgIC8vIGNoYW5jZSB0byB0aWNrIChhbmQgcG9zc2libHkgZW5kKTsgc2VlIGQzL2QzLXRyYW5zaXRpb24jNTQhXG4gICAgICBpZiAoby5zdGF0ZSA9PT0gU1RBUlRFRCkgcmV0dXJuIHRpbWVvdXQoc3RhcnQpO1xuXG4gICAgICAvLyBJbnRlcnJ1cHQgdGhlIGFjdGl2ZSB0cmFuc2l0aW9uLCBpZiBhbnkuXG4gICAgICBpZiAoby5zdGF0ZSA9PT0gUlVOTklORykge1xuICAgICAgICBvLnN0YXRlID0gRU5ERUQ7XG4gICAgICAgIG8udGltZXIuc3RvcCgpO1xuICAgICAgICBvLm9uLmNhbGwoXCJpbnRlcnJ1cHRcIiwgbm9kZSwgbm9kZS5fX2RhdGFfXywgby5pbmRleCwgby5ncm91cCk7XG4gICAgICAgIGRlbGV0ZSBzY2hlZHVsZXNbaV07XG4gICAgICB9XG5cbiAgICAgIC8vIENhbmNlbCBhbnkgcHJlLWVtcHRlZCB0cmFuc2l0aW9ucy5cbiAgICAgIGVsc2UgaWYgKCtpIDwgaWQpIHtcbiAgICAgICAgby5zdGF0ZSA9IEVOREVEO1xuICAgICAgICBvLnRpbWVyLnN0b3AoKTtcbiAgICAgICAgby5vbi5jYWxsKFwiY2FuY2VsXCIsIG5vZGUsIG5vZGUuX19kYXRhX18sIG8uaW5kZXgsIG8uZ3JvdXApO1xuICAgICAgICBkZWxldGUgc2NoZWR1bGVzW2ldO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIERlZmVyIHRoZSBmaXJzdCB0aWNrIHRvIGVuZCBvZiB0aGUgY3VycmVudCBmcmFtZTsgc2VlIGQzL2QzIzE1NzYuXG4gICAgLy8gTm90ZSB0aGUgdHJhbnNpdGlvbiBtYXkgYmUgY2FuY2VsZWQgYWZ0ZXIgc3RhcnQgYW5kIGJlZm9yZSB0aGUgZmlyc3QgdGljayFcbiAgICAvLyBOb3RlIHRoaXMgbXVzdCBiZSBzY2hlZHVsZWQgYmVmb3JlIHRoZSBzdGFydCBldmVudDsgc2VlIGQzL2QzLXRyYW5zaXRpb24jMTYhXG4gICAgLy8gQXNzdW1pbmcgdGhpcyBpcyBzdWNjZXNzZnVsLCBzdWJzZXF1ZW50IGNhbGxiYWNrcyBnbyBzdHJhaWdodCB0byB0aWNrLlxuICAgIHRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICBpZiAoc2VsZi5zdGF0ZSA9PT0gU1RBUlRFRCkge1xuICAgICAgICBzZWxmLnN0YXRlID0gUlVOTklORztcbiAgICAgICAgc2VsZi50aW1lci5yZXN0YXJ0KHRpY2ssIHNlbGYuZGVsYXksIHNlbGYudGltZSk7XG4gICAgICAgIHRpY2soZWxhcHNlZCk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBEaXNwYXRjaCB0aGUgc3RhcnQgZXZlbnQuXG4gICAgLy8gTm90ZSB0aGlzIG11c3QgYmUgZG9uZSBiZWZvcmUgdGhlIHR3ZWVuIGFyZSBpbml0aWFsaXplZC5cbiAgICBzZWxmLnN0YXRlID0gU1RBUlRJTkc7XG4gICAgc2VsZi5vbi5jYWxsKFwic3RhcnRcIiwgbm9kZSwgbm9kZS5fX2RhdGFfXywgc2VsZi5pbmRleCwgc2VsZi5ncm91cCk7XG4gICAgaWYgKHNlbGYuc3RhdGUgIT09IFNUQVJUSU5HKSByZXR1cm47IC8vIGludGVycnVwdGVkXG4gICAgc2VsZi5zdGF0ZSA9IFNUQVJURUQ7XG5cbiAgICAvLyBJbml0aWFsaXplIHRoZSB0d2VlbiwgZGVsZXRpbmcgbnVsbCB0d2Vlbi5cbiAgICB0d2VlbiA9IG5ldyBBcnJheShuID0gc2VsZi50d2Vlbi5sZW5ndGgpO1xuICAgIGZvciAoaSA9IDAsIGogPSAtMTsgaSA8IG47ICsraSkge1xuICAgICAgaWYgKG8gPSBzZWxmLnR3ZWVuW2ldLnZhbHVlLmNhbGwobm9kZSwgbm9kZS5fX2RhdGFfXywgc2VsZi5pbmRleCwgc2VsZi5ncm91cCkpIHtcbiAgICAgICAgdHdlZW5bKytqXSA9IG87XG4gICAgICB9XG4gICAgfVxuICAgIHR3ZWVuLmxlbmd0aCA9IGogKyAxO1xuICB9XG5cbiAgZnVuY3Rpb24gdGljayhlbGFwc2VkKSB7XG4gICAgdmFyIHQgPSBlbGFwc2VkIDwgc2VsZi5kdXJhdGlvbiA/IHNlbGYuZWFzZS5jYWxsKG51bGwsIGVsYXBzZWQgLyBzZWxmLmR1cmF0aW9uKSA6IChzZWxmLnRpbWVyLnJlc3RhcnQoc3RvcCksIHNlbGYuc3RhdGUgPSBFTkRJTkcsIDEpLFxuICAgICAgICBpID0gLTEsXG4gICAgICAgIG4gPSB0d2Vlbi5sZW5ndGg7XG5cbiAgICB3aGlsZSAoKytpIDwgbikge1xuICAgICAgdHdlZW5baV0uY2FsbChub2RlLCB0KTtcbiAgICB9XG5cbiAgICAvLyBEaXNwYXRjaCB0aGUgZW5kIGV2ZW50LlxuICAgIGlmIChzZWxmLnN0YXRlID09PSBFTkRJTkcpIHtcbiAgICAgIHNlbGYub24uY2FsbChcImVuZFwiLCBub2RlLCBub2RlLl9fZGF0YV9fLCBzZWxmLmluZGV4LCBzZWxmLmdyb3VwKTtcbiAgICAgIHN0b3AoKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBzdG9wKCkge1xuICAgIHNlbGYuc3RhdGUgPSBFTkRFRDtcbiAgICBzZWxmLnRpbWVyLnN0b3AoKTtcbiAgICBkZWxldGUgc2NoZWR1bGVzW2lkXTtcbiAgICBmb3IgKHZhciBpIGluIHNjaGVkdWxlcykgcmV0dXJuOyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgZGVsZXRlIG5vZGUuX190cmFuc2l0aW9uO1xuICB9XG59XG4iLCAiaW1wb3J0IHtTVEFSVElORywgRU5ESU5HLCBFTkRFRH0gZnJvbSBcIi4vdHJhbnNpdGlvbi9zY2hlZHVsZS5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihub2RlLCBuYW1lKSB7XG4gIHZhciBzY2hlZHVsZXMgPSBub2RlLl9fdHJhbnNpdGlvbixcbiAgICAgIHNjaGVkdWxlLFxuICAgICAgYWN0aXZlLFxuICAgICAgZW1wdHkgPSB0cnVlLFxuICAgICAgaTtcblxuICBpZiAoIXNjaGVkdWxlcykgcmV0dXJuO1xuXG4gIG5hbWUgPSBuYW1lID09IG51bGwgPyBudWxsIDogbmFtZSArIFwiXCI7XG5cbiAgZm9yIChpIGluIHNjaGVkdWxlcykge1xuICAgIGlmICgoc2NoZWR1bGUgPSBzY2hlZHVsZXNbaV0pLm5hbWUgIT09IG5hbWUpIHsgZW1wdHkgPSBmYWxzZTsgY29udGludWU7IH1cbiAgICBhY3RpdmUgPSBzY2hlZHVsZS5zdGF0ZSA+IFNUQVJUSU5HICYmIHNjaGVkdWxlLnN0YXRlIDwgRU5ESU5HO1xuICAgIHNjaGVkdWxlLnN0YXRlID0gRU5ERUQ7XG4gICAgc2NoZWR1bGUudGltZXIuc3RvcCgpO1xuICAgIHNjaGVkdWxlLm9uLmNhbGwoYWN0aXZlID8gXCJpbnRlcnJ1cHRcIiA6IFwiY2FuY2VsXCIsIG5vZGUsIG5vZGUuX19kYXRhX18sIHNjaGVkdWxlLmluZGV4LCBzY2hlZHVsZS5ncm91cCk7XG4gICAgZGVsZXRlIHNjaGVkdWxlc1tpXTtcbiAgfVxuXG4gIGlmIChlbXB0eSkgZGVsZXRlIG5vZGUuX190cmFuc2l0aW9uO1xufVxuIiwgImltcG9ydCBpbnRlcnJ1cHQgZnJvbSBcIi4uL2ludGVycnVwdC5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihuYW1lKSB7XG4gIHJldHVybiB0aGlzLmVhY2goZnVuY3Rpb24oKSB7XG4gICAgaW50ZXJydXB0KHRoaXMsIG5hbWUpO1xuICB9KTtcbn1cbiIsICJpbXBvcnQge2dldCwgc2V0fSBmcm9tIFwiLi9zY2hlZHVsZS5qc1wiO1xuXG5mdW5jdGlvbiB0d2VlblJlbW92ZShpZCwgbmFtZSkge1xuICB2YXIgdHdlZW4wLCB0d2VlbjE7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2NoZWR1bGUgPSBzZXQodGhpcywgaWQpLFxuICAgICAgICB0d2VlbiA9IHNjaGVkdWxlLnR3ZWVuO1xuXG4gICAgLy8gSWYgdGhpcyBub2RlIHNoYXJlZCB0d2VlbiB3aXRoIHRoZSBwcmV2aW91cyBub2RlLFxuICAgIC8vIGp1c3QgYXNzaWduIHRoZSB1cGRhdGVkIHNoYXJlZCB0d2VlbiBhbmQgd2VcdTIwMTlyZSBkb25lIVxuICAgIC8vIE90aGVyd2lzZSwgY29weS1vbi13cml0ZS5cbiAgICBpZiAodHdlZW4gIT09IHR3ZWVuMCkge1xuICAgICAgdHdlZW4xID0gdHdlZW4wID0gdHdlZW47XG4gICAgICBmb3IgKHZhciBpID0gMCwgbiA9IHR3ZWVuMS5sZW5ndGg7IGkgPCBuOyArK2kpIHtcbiAgICAgICAgaWYgKHR3ZWVuMVtpXS5uYW1lID09PSBuYW1lKSB7XG4gICAgICAgICAgdHdlZW4xID0gdHdlZW4xLnNsaWNlKCk7XG4gICAgICAgICAgdHdlZW4xLnNwbGljZShpLCAxKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHNjaGVkdWxlLnR3ZWVuID0gdHdlZW4xO1xuICB9O1xufVxuXG5mdW5jdGlvbiB0d2VlbkZ1bmN0aW9uKGlkLCBuYW1lLCB2YWx1ZSkge1xuICB2YXIgdHdlZW4wLCB0d2VlbjE7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yO1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNjaGVkdWxlID0gc2V0KHRoaXMsIGlkKSxcbiAgICAgICAgdHdlZW4gPSBzY2hlZHVsZS50d2VlbjtcblxuICAgIC8vIElmIHRoaXMgbm9kZSBzaGFyZWQgdHdlZW4gd2l0aCB0aGUgcHJldmlvdXMgbm9kZSxcbiAgICAvLyBqdXN0IGFzc2lnbiB0aGUgdXBkYXRlZCBzaGFyZWQgdHdlZW4gYW5kIHdlXHUyMDE5cmUgZG9uZSFcbiAgICAvLyBPdGhlcndpc2UsIGNvcHktb24td3JpdGUuXG4gICAgaWYgKHR3ZWVuICE9PSB0d2VlbjApIHtcbiAgICAgIHR3ZWVuMSA9ICh0d2VlbjAgPSB0d2Vlbikuc2xpY2UoKTtcbiAgICAgIGZvciAodmFyIHQgPSB7bmFtZTogbmFtZSwgdmFsdWU6IHZhbHVlfSwgaSA9IDAsIG4gPSB0d2VlbjEubGVuZ3RoOyBpIDwgbjsgKytpKSB7XG4gICAgICAgIGlmICh0d2VlbjFbaV0ubmFtZSA9PT0gbmFtZSkge1xuICAgICAgICAgIHR3ZWVuMVtpXSA9IHQ7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChpID09PSBuKSB0d2VlbjEucHVzaCh0KTtcbiAgICB9XG5cbiAgICBzY2hlZHVsZS50d2VlbiA9IHR3ZWVuMTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSwgdmFsdWUpIHtcbiAgdmFyIGlkID0gdGhpcy5faWQ7XG5cbiAgbmFtZSArPSBcIlwiO1xuXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoIDwgMikge1xuICAgIHZhciB0d2VlbiA9IGdldCh0aGlzLm5vZGUoKSwgaWQpLnR3ZWVuO1xuICAgIGZvciAodmFyIGkgPSAwLCBuID0gdHdlZW4ubGVuZ3RoLCB0OyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAoKHQgPSB0d2VlbltpXSkubmFtZSA9PT0gbmFtZSkge1xuICAgICAgICByZXR1cm4gdC52YWx1ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICByZXR1cm4gdGhpcy5lYWNoKCh2YWx1ZSA9PSBudWxsID8gdHdlZW5SZW1vdmUgOiB0d2VlbkZ1bmN0aW9uKShpZCwgbmFtZSwgdmFsdWUpKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHR3ZWVuVmFsdWUodHJhbnNpdGlvbiwgbmFtZSwgdmFsdWUpIHtcbiAgdmFyIGlkID0gdHJhbnNpdGlvbi5faWQ7XG5cbiAgdHJhbnNpdGlvbi5lYWNoKGZ1bmN0aW9uKCkge1xuICAgIHZhciBzY2hlZHVsZSA9IHNldCh0aGlzLCBpZCk7XG4gICAgKHNjaGVkdWxlLnZhbHVlIHx8IChzY2hlZHVsZS52YWx1ZSA9IHt9KSlbbmFtZV0gPSB2YWx1ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICB9KTtcblxuICByZXR1cm4gZnVuY3Rpb24obm9kZSkge1xuICAgIHJldHVybiBnZXQobm9kZSwgaWQpLnZhbHVlW25hbWVdO1xuICB9O1xufVxuIiwgImltcG9ydCB7Y29sb3J9IGZyb20gXCJkMy1jb2xvclwiO1xuaW1wb3J0IHtpbnRlcnBvbGF0ZU51bWJlciwgaW50ZXJwb2xhdGVSZ2IsIGludGVycG9sYXRlU3RyaW5nfSBmcm9tIFwiZDMtaW50ZXJwb2xhdGVcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oYSwgYikge1xuICB2YXIgYztcbiAgcmV0dXJuICh0eXBlb2YgYiA9PT0gXCJudW1iZXJcIiA/IGludGVycG9sYXRlTnVtYmVyXG4gICAgICA6IGIgaW5zdGFuY2VvZiBjb2xvciA/IGludGVycG9sYXRlUmdiXG4gICAgICA6IChjID0gY29sb3IoYikpID8gKGIgPSBjLCBpbnRlcnBvbGF0ZVJnYilcbiAgICAgIDogaW50ZXJwb2xhdGVTdHJpbmcpKGEsIGIpO1xufVxuIiwgImltcG9ydCB7aW50ZXJwb2xhdGVUcmFuc2Zvcm1TdmcgYXMgaW50ZXJwb2xhdGVUcmFuc2Zvcm19IGZyb20gXCJkMy1pbnRlcnBvbGF0ZVwiO1xuaW1wb3J0IHtuYW1lc3BhY2V9IGZyb20gXCJkMy1zZWxlY3Rpb25cIjtcbmltcG9ydCB7dHdlZW5WYWx1ZX0gZnJvbSBcIi4vdHdlZW4uanNcIjtcbmltcG9ydCBpbnRlcnBvbGF0ZSBmcm9tIFwiLi9pbnRlcnBvbGF0ZS5qc1wiO1xuXG5mdW5jdGlvbiBhdHRyUmVtb3ZlKG5hbWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHRoaXMucmVtb3ZlQXR0cmlidXRlKG5hbWUpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBhdHRyUmVtb3ZlTlMoZnVsbG5hbWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHRoaXMucmVtb3ZlQXR0cmlidXRlTlMoZnVsbG5hbWUuc3BhY2UsIGZ1bGxuYW1lLmxvY2FsKTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gYXR0ckNvbnN0YW50KG5hbWUsIGludGVycG9sYXRlLCB2YWx1ZTEpIHtcbiAgdmFyIHN0cmluZzAwLFxuICAgICAgc3RyaW5nMSA9IHZhbHVlMSArIFwiXCIsXG4gICAgICBpbnRlcnBvbGF0ZTA7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc3RyaW5nMCA9IHRoaXMuZ2V0QXR0cmlidXRlKG5hbWUpO1xuICAgIHJldHVybiBzdHJpbmcwID09PSBzdHJpbmcxID8gbnVsbFxuICAgICAgICA6IHN0cmluZzAgPT09IHN0cmluZzAwID8gaW50ZXJwb2xhdGUwXG4gICAgICAgIDogaW50ZXJwb2xhdGUwID0gaW50ZXJwb2xhdGUoc3RyaW5nMDAgPSBzdHJpbmcwLCB2YWx1ZTEpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBhdHRyQ29uc3RhbnROUyhmdWxsbmFtZSwgaW50ZXJwb2xhdGUsIHZhbHVlMSkge1xuICB2YXIgc3RyaW5nMDAsXG4gICAgICBzdHJpbmcxID0gdmFsdWUxICsgXCJcIixcbiAgICAgIGludGVycG9sYXRlMDtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBzdHJpbmcwID0gdGhpcy5nZXRBdHRyaWJ1dGVOUyhmdWxsbmFtZS5zcGFjZSwgZnVsbG5hbWUubG9jYWwpO1xuICAgIHJldHVybiBzdHJpbmcwID09PSBzdHJpbmcxID8gbnVsbFxuICAgICAgICA6IHN0cmluZzAgPT09IHN0cmluZzAwID8gaW50ZXJwb2xhdGUwXG4gICAgICAgIDogaW50ZXJwb2xhdGUwID0gaW50ZXJwb2xhdGUoc3RyaW5nMDAgPSBzdHJpbmcwLCB2YWx1ZTEpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBhdHRyRnVuY3Rpb24obmFtZSwgaW50ZXJwb2xhdGUsIHZhbHVlKSB7XG4gIHZhciBzdHJpbmcwMCxcbiAgICAgIHN0cmluZzEwLFxuICAgICAgaW50ZXJwb2xhdGUwO1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHN0cmluZzAsIHZhbHVlMSA9IHZhbHVlKHRoaXMpLCBzdHJpbmcxO1xuICAgIGlmICh2YWx1ZTEgPT0gbnVsbCkgcmV0dXJuIHZvaWQgdGhpcy5yZW1vdmVBdHRyaWJ1dGUobmFtZSk7XG4gICAgc3RyaW5nMCA9IHRoaXMuZ2V0QXR0cmlidXRlKG5hbWUpO1xuICAgIHN0cmluZzEgPSB2YWx1ZTEgKyBcIlwiO1xuICAgIHJldHVybiBzdHJpbmcwID09PSBzdHJpbmcxID8gbnVsbFxuICAgICAgICA6IHN0cmluZzAgPT09IHN0cmluZzAwICYmIHN0cmluZzEgPT09IHN0cmluZzEwID8gaW50ZXJwb2xhdGUwXG4gICAgICAgIDogKHN0cmluZzEwID0gc3RyaW5nMSwgaW50ZXJwb2xhdGUwID0gaW50ZXJwb2xhdGUoc3RyaW5nMDAgPSBzdHJpbmcwLCB2YWx1ZTEpKTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gYXR0ckZ1bmN0aW9uTlMoZnVsbG5hbWUsIGludGVycG9sYXRlLCB2YWx1ZSkge1xuICB2YXIgc3RyaW5nMDAsXG4gICAgICBzdHJpbmcxMCxcbiAgICAgIGludGVycG9sYXRlMDtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBzdHJpbmcwLCB2YWx1ZTEgPSB2YWx1ZSh0aGlzKSwgc3RyaW5nMTtcbiAgICBpZiAodmFsdWUxID09IG51bGwpIHJldHVybiB2b2lkIHRoaXMucmVtb3ZlQXR0cmlidXRlTlMoZnVsbG5hbWUuc3BhY2UsIGZ1bGxuYW1lLmxvY2FsKTtcbiAgICBzdHJpbmcwID0gdGhpcy5nZXRBdHRyaWJ1dGVOUyhmdWxsbmFtZS5zcGFjZSwgZnVsbG5hbWUubG9jYWwpO1xuICAgIHN0cmluZzEgPSB2YWx1ZTEgKyBcIlwiO1xuICAgIHJldHVybiBzdHJpbmcwID09PSBzdHJpbmcxID8gbnVsbFxuICAgICAgICA6IHN0cmluZzAgPT09IHN0cmluZzAwICYmIHN0cmluZzEgPT09IHN0cmluZzEwID8gaW50ZXJwb2xhdGUwXG4gICAgICAgIDogKHN0cmluZzEwID0gc3RyaW5nMSwgaW50ZXJwb2xhdGUwID0gaW50ZXJwb2xhdGUoc3RyaW5nMDAgPSBzdHJpbmcwLCB2YWx1ZTEpKTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSwgdmFsdWUpIHtcbiAgdmFyIGZ1bGxuYW1lID0gbmFtZXNwYWNlKG5hbWUpLCBpID0gZnVsbG5hbWUgPT09IFwidHJhbnNmb3JtXCIgPyBpbnRlcnBvbGF0ZVRyYW5zZm9ybSA6IGludGVycG9sYXRlO1xuICByZXR1cm4gdGhpcy5hdHRyVHdlZW4obmFtZSwgdHlwZW9mIHZhbHVlID09PSBcImZ1bmN0aW9uXCJcbiAgICAgID8gKGZ1bGxuYW1lLmxvY2FsID8gYXR0ckZ1bmN0aW9uTlMgOiBhdHRyRnVuY3Rpb24pKGZ1bGxuYW1lLCBpLCB0d2VlblZhbHVlKHRoaXMsIFwiYXR0ci5cIiArIG5hbWUsIHZhbHVlKSlcbiAgICAgIDogdmFsdWUgPT0gbnVsbCA/IChmdWxsbmFtZS5sb2NhbCA/IGF0dHJSZW1vdmVOUyA6IGF0dHJSZW1vdmUpKGZ1bGxuYW1lKVxuICAgICAgOiAoZnVsbG5hbWUubG9jYWwgPyBhdHRyQ29uc3RhbnROUyA6IGF0dHJDb25zdGFudCkoZnVsbG5hbWUsIGksIHZhbHVlKSk7XG59XG4iLCAiaW1wb3J0IHtuYW1lc3BhY2V9IGZyb20gXCJkMy1zZWxlY3Rpb25cIjtcblxuZnVuY3Rpb24gYXR0ckludGVycG9sYXRlKG5hbWUsIGkpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKHQpIHtcbiAgICB0aGlzLnNldEF0dHJpYnV0ZShuYW1lLCBpLmNhbGwodGhpcywgdCkpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBhdHRySW50ZXJwb2xhdGVOUyhmdWxsbmFtZSwgaSkge1xuICByZXR1cm4gZnVuY3Rpb24odCkge1xuICAgIHRoaXMuc2V0QXR0cmlidXRlTlMoZnVsbG5hbWUuc3BhY2UsIGZ1bGxuYW1lLmxvY2FsLCBpLmNhbGwodGhpcywgdCkpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBhdHRyVHdlZW5OUyhmdWxsbmFtZSwgdmFsdWUpIHtcbiAgdmFyIHQwLCBpMDtcbiAgZnVuY3Rpb24gdHdlZW4oKSB7XG4gICAgdmFyIGkgPSB2YWx1ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIGlmIChpICE9PSBpMCkgdDAgPSAoaTAgPSBpKSAmJiBhdHRySW50ZXJwb2xhdGVOUyhmdWxsbmFtZSwgaSk7XG4gICAgcmV0dXJuIHQwO1xuICB9XG4gIHR3ZWVuLl92YWx1ZSA9IHZhbHVlO1xuICByZXR1cm4gdHdlZW47XG59XG5cbmZ1bmN0aW9uIGF0dHJUd2VlbihuYW1lLCB2YWx1ZSkge1xuICB2YXIgdDAsIGkwO1xuICBmdW5jdGlvbiB0d2VlbigpIHtcbiAgICB2YXIgaSA9IHZhbHVlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgaWYgKGkgIT09IGkwKSB0MCA9IChpMCA9IGkpICYmIGF0dHJJbnRlcnBvbGF0ZShuYW1lLCBpKTtcbiAgICByZXR1cm4gdDA7XG4gIH1cbiAgdHdlZW4uX3ZhbHVlID0gdmFsdWU7XG4gIHJldHVybiB0d2Vlbjtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSwgdmFsdWUpIHtcbiAgdmFyIGtleSA9IFwiYXR0ci5cIiArIG5hbWU7XG4gIGlmIChhcmd1bWVudHMubGVuZ3RoIDwgMikgcmV0dXJuIChrZXkgPSB0aGlzLnR3ZWVuKGtleSkpICYmIGtleS5fdmFsdWU7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gdGhpcy50d2VlbihrZXksIG51bGwpO1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcjtcbiAgdmFyIGZ1bGxuYW1lID0gbmFtZXNwYWNlKG5hbWUpO1xuICByZXR1cm4gdGhpcy50d2VlbihrZXksIChmdWxsbmFtZS5sb2NhbCA/IGF0dHJUd2Vlbk5TIDogYXR0clR3ZWVuKShmdWxsbmFtZSwgdmFsdWUpKTtcbn1cbiIsICJpbXBvcnQge2dldCwgaW5pdH0gZnJvbSBcIi4vc2NoZWR1bGUuanNcIjtcblxuZnVuY3Rpb24gZGVsYXlGdW5jdGlvbihpZCwgdmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIGluaXQodGhpcywgaWQpLmRlbGF5ID0gK3ZhbHVlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGRlbGF5Q29uc3RhbnQoaWQsIHZhbHVlKSB7XG4gIHJldHVybiB2YWx1ZSA9ICt2YWx1ZSwgZnVuY3Rpb24oKSB7XG4gICAgaW5pdCh0aGlzLCBpZCkuZGVsYXkgPSB2YWx1ZTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24odmFsdWUpIHtcbiAgdmFyIGlkID0gdGhpcy5faWQ7XG5cbiAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGhcbiAgICAgID8gdGhpcy5lYWNoKCh0eXBlb2YgdmFsdWUgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgICAgID8gZGVsYXlGdW5jdGlvblxuICAgICAgICAgIDogZGVsYXlDb25zdGFudCkoaWQsIHZhbHVlKSlcbiAgICAgIDogZ2V0KHRoaXMubm9kZSgpLCBpZCkuZGVsYXk7XG59XG4iLCAiaW1wb3J0IHtnZXQsIHNldH0gZnJvbSBcIi4vc2NoZWR1bGUuanNcIjtcblxuZnVuY3Rpb24gZHVyYXRpb25GdW5jdGlvbihpZCwgdmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHNldCh0aGlzLCBpZCkuZHVyYXRpb24gPSArdmFsdWUuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gZHVyYXRpb25Db25zdGFudChpZCwgdmFsdWUpIHtcbiAgcmV0dXJuIHZhbHVlID0gK3ZhbHVlLCBmdW5jdGlvbigpIHtcbiAgICBzZXQodGhpcywgaWQpLmR1cmF0aW9uID0gdmFsdWU7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHZhbHVlKSB7XG4gIHZhciBpZCA9IHRoaXMuX2lkO1xuXG4gIHJldHVybiBhcmd1bWVudHMubGVuZ3RoXG4gICAgICA/IHRoaXMuZWFjaCgodHlwZW9mIHZhbHVlID09PSBcImZ1bmN0aW9uXCJcbiAgICAgICAgICA/IGR1cmF0aW9uRnVuY3Rpb25cbiAgICAgICAgICA6IGR1cmF0aW9uQ29uc3RhbnQpKGlkLCB2YWx1ZSkpXG4gICAgICA6IGdldCh0aGlzLm5vZGUoKSwgaWQpLmR1cmF0aW9uO1xufVxuIiwgImltcG9ydCB7Z2V0LCBzZXR9IGZyb20gXCIuL3NjaGVkdWxlLmpzXCI7XG5cbmZ1bmN0aW9uIGVhc2VDb25zdGFudChpZCwgdmFsdWUpIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3I7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICBzZXQodGhpcywgaWQpLmVhc2UgPSB2YWx1ZTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24odmFsdWUpIHtcbiAgdmFyIGlkID0gdGhpcy5faWQ7XG5cbiAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGhcbiAgICAgID8gdGhpcy5lYWNoKGVhc2VDb25zdGFudChpZCwgdmFsdWUpKVxuICAgICAgOiBnZXQodGhpcy5ub2RlKCksIGlkKS5lYXNlO1xufVxuIiwgImltcG9ydCB7c2V0fSBmcm9tIFwiLi9zY2hlZHVsZS5qc1wiO1xuXG5mdW5jdGlvbiBlYXNlVmFyeWluZyhpZCwgdmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciB2ID0gdmFsdWUuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICBpZiAodHlwZW9mIHYgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yO1xuICAgIHNldCh0aGlzLCBpZCkuZWFzZSA9IHY7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHZhbHVlKSB7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yO1xuICByZXR1cm4gdGhpcy5lYWNoKGVhc2VWYXJ5aW5nKHRoaXMuX2lkLCB2YWx1ZSkpO1xufVxuIiwgImltcG9ydCB7bWF0Y2hlcn0gZnJvbSBcImQzLXNlbGVjdGlvblwiO1xuaW1wb3J0IHtUcmFuc2l0aW9ufSBmcm9tIFwiLi9pbmRleC5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihtYXRjaCkge1xuICBpZiAodHlwZW9mIG1hdGNoICE9PSBcImZ1bmN0aW9uXCIpIG1hdGNoID0gbWF0Y2hlcihtYXRjaCk7XG5cbiAgZm9yICh2YXIgZ3JvdXBzID0gdGhpcy5fZ3JvdXBzLCBtID0gZ3JvdXBzLmxlbmd0aCwgc3ViZ3JvdXBzID0gbmV3IEFycmF5KG0pLCBqID0gMDsgaiA8IG07ICsraikge1xuICAgIGZvciAodmFyIGdyb3VwID0gZ3JvdXBzW2pdLCBuID0gZ3JvdXAubGVuZ3RoLCBzdWJncm91cCA9IHN1Ymdyb3Vwc1tqXSA9IFtdLCBub2RlLCBpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgaWYgKChub2RlID0gZ3JvdXBbaV0pICYmIG1hdGNoLmNhbGwobm9kZSwgbm9kZS5fX2RhdGFfXywgaSwgZ3JvdXApKSB7XG4gICAgICAgIHN1Ymdyb3VwLnB1c2gobm9kZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG5ldyBUcmFuc2l0aW9uKHN1Ymdyb3VwcywgdGhpcy5fcGFyZW50cywgdGhpcy5fbmFtZSwgdGhpcy5faWQpO1xufVxuIiwgImltcG9ydCB7VHJhbnNpdGlvbn0gZnJvbSBcIi4vaW5kZXguanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24odHJhbnNpdGlvbikge1xuICBpZiAodHJhbnNpdGlvbi5faWQgIT09IHRoaXMuX2lkKSB0aHJvdyBuZXcgRXJyb3I7XG5cbiAgZm9yICh2YXIgZ3JvdXBzMCA9IHRoaXMuX2dyb3VwcywgZ3JvdXBzMSA9IHRyYW5zaXRpb24uX2dyb3VwcywgbTAgPSBncm91cHMwLmxlbmd0aCwgbTEgPSBncm91cHMxLmxlbmd0aCwgbSA9IE1hdGgubWluKG0wLCBtMSksIG1lcmdlcyA9IG5ldyBBcnJheShtMCksIGogPSAwOyBqIDwgbTsgKytqKSB7XG4gICAgZm9yICh2YXIgZ3JvdXAwID0gZ3JvdXBzMFtqXSwgZ3JvdXAxID0gZ3JvdXBzMVtqXSwgbiA9IGdyb3VwMC5sZW5ndGgsIG1lcmdlID0gbWVyZ2VzW2pdID0gbmV3IEFycmF5KG4pLCBub2RlLCBpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgaWYgKG5vZGUgPSBncm91cDBbaV0gfHwgZ3JvdXAxW2ldKSB7XG4gICAgICAgIG1lcmdlW2ldID0gbm9kZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBmb3IgKDsgaiA8IG0wOyArK2opIHtcbiAgICBtZXJnZXNbal0gPSBncm91cHMwW2pdO1xuICB9XG5cbiAgcmV0dXJuIG5ldyBUcmFuc2l0aW9uKG1lcmdlcywgdGhpcy5fcGFyZW50cywgdGhpcy5fbmFtZSwgdGhpcy5faWQpO1xufVxuIiwgImltcG9ydCB7Z2V0LCBzZXQsIGluaXR9IGZyb20gXCIuL3NjaGVkdWxlLmpzXCI7XG5cbmZ1bmN0aW9uIHN0YXJ0KG5hbWUpIHtcbiAgcmV0dXJuIChuYW1lICsgXCJcIikudHJpbSgpLnNwbGl0KC9efFxccysvKS5ldmVyeShmdW5jdGlvbih0KSB7XG4gICAgdmFyIGkgPSB0LmluZGV4T2YoXCIuXCIpO1xuICAgIGlmIChpID49IDApIHQgPSB0LnNsaWNlKDAsIGkpO1xuICAgIHJldHVybiAhdCB8fCB0ID09PSBcInN0YXJ0XCI7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBvbkZ1bmN0aW9uKGlkLCBuYW1lLCBsaXN0ZW5lcikge1xuICB2YXIgb24wLCBvbjEsIHNpdCA9IHN0YXJ0KG5hbWUpID8gaW5pdCA6IHNldDtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBzY2hlZHVsZSA9IHNpdCh0aGlzLCBpZCksXG4gICAgICAgIG9uID0gc2NoZWR1bGUub247XG5cbiAgICAvLyBJZiB0aGlzIG5vZGUgc2hhcmVkIGEgZGlzcGF0Y2ggd2l0aCB0aGUgcHJldmlvdXMgbm9kZSxcbiAgICAvLyBqdXN0IGFzc2lnbiB0aGUgdXBkYXRlZCBzaGFyZWQgZGlzcGF0Y2ggYW5kIHdlXHUyMDE5cmUgZG9uZSFcbiAgICAvLyBPdGhlcndpc2UsIGNvcHktb24td3JpdGUuXG4gICAgaWYgKG9uICE9PSBvbjApIChvbjEgPSAob24wID0gb24pLmNvcHkoKSkub24obmFtZSwgbGlzdGVuZXIpO1xuXG4gICAgc2NoZWR1bGUub24gPSBvbjE7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG5hbWUsIGxpc3RlbmVyKSB7XG4gIHZhciBpZCA9IHRoaXMuX2lkO1xuXG4gIHJldHVybiBhcmd1bWVudHMubGVuZ3RoIDwgMlxuICAgICAgPyBnZXQodGhpcy5ub2RlKCksIGlkKS5vbi5vbihuYW1lKVxuICAgICAgOiB0aGlzLmVhY2gob25GdW5jdGlvbihpZCwgbmFtZSwgbGlzdGVuZXIpKTtcbn1cbiIsICJmdW5jdGlvbiByZW1vdmVGdW5jdGlvbihpZCkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHBhcmVudCA9IHRoaXMucGFyZW50Tm9kZTtcbiAgICBmb3IgKHZhciBpIGluIHRoaXMuX190cmFuc2l0aW9uKSBpZiAoK2kgIT09IGlkKSByZXR1cm47XG4gICAgaWYgKHBhcmVudCkgcGFyZW50LnJlbW92ZUNoaWxkKHRoaXMpO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMub24oXCJlbmQucmVtb3ZlXCIsIHJlbW92ZUZ1bmN0aW9uKHRoaXMuX2lkKSk7XG59XG4iLCAiaW1wb3J0IHtzZWxlY3Rvcn0gZnJvbSBcImQzLXNlbGVjdGlvblwiO1xuaW1wb3J0IHtUcmFuc2l0aW9ufSBmcm9tIFwiLi9pbmRleC5qc1wiO1xuaW1wb3J0IHNjaGVkdWxlLCB7Z2V0fSBmcm9tIFwiLi9zY2hlZHVsZS5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihzZWxlY3QpIHtcbiAgdmFyIG5hbWUgPSB0aGlzLl9uYW1lLFxuICAgICAgaWQgPSB0aGlzLl9pZDtcblxuICBpZiAodHlwZW9mIHNlbGVjdCAhPT0gXCJmdW5jdGlvblwiKSBzZWxlY3QgPSBzZWxlY3RvcihzZWxlY3QpO1xuXG4gIGZvciAodmFyIGdyb3VwcyA9IHRoaXMuX2dyb3VwcywgbSA9IGdyb3Vwcy5sZW5ndGgsIHN1Ymdyb3VwcyA9IG5ldyBBcnJheShtKSwgaiA9IDA7IGogPCBtOyArK2opIHtcbiAgICBmb3IgKHZhciBncm91cCA9IGdyb3Vwc1tqXSwgbiA9IGdyb3VwLmxlbmd0aCwgc3ViZ3JvdXAgPSBzdWJncm91cHNbal0gPSBuZXcgQXJyYXkobiksIG5vZGUsIHN1Ym5vZGUsIGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAoKG5vZGUgPSBncm91cFtpXSkgJiYgKHN1Ym5vZGUgPSBzZWxlY3QuY2FsbChub2RlLCBub2RlLl9fZGF0YV9fLCBpLCBncm91cCkpKSB7XG4gICAgICAgIGlmIChcIl9fZGF0YV9fXCIgaW4gbm9kZSkgc3Vibm9kZS5fX2RhdGFfXyA9IG5vZGUuX19kYXRhX187XG4gICAgICAgIHN1Ymdyb3VwW2ldID0gc3Vibm9kZTtcbiAgICAgICAgc2NoZWR1bGUoc3ViZ3JvdXBbaV0sIG5hbWUsIGlkLCBpLCBzdWJncm91cCwgZ2V0KG5vZGUsIGlkKSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG5ldyBUcmFuc2l0aW9uKHN1Ymdyb3VwcywgdGhpcy5fcGFyZW50cywgbmFtZSwgaWQpO1xufVxuIiwgImltcG9ydCB7c2VsZWN0b3JBbGx9IGZyb20gXCJkMy1zZWxlY3Rpb25cIjtcbmltcG9ydCB7VHJhbnNpdGlvbn0gZnJvbSBcIi4vaW5kZXguanNcIjtcbmltcG9ydCBzY2hlZHVsZSwge2dldH0gZnJvbSBcIi4vc2NoZWR1bGUuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oc2VsZWN0KSB7XG4gIHZhciBuYW1lID0gdGhpcy5fbmFtZSxcbiAgICAgIGlkID0gdGhpcy5faWQ7XG5cbiAgaWYgKHR5cGVvZiBzZWxlY3QgIT09IFwiZnVuY3Rpb25cIikgc2VsZWN0ID0gc2VsZWN0b3JBbGwoc2VsZWN0KTtcblxuICBmb3IgKHZhciBncm91cHMgPSB0aGlzLl9ncm91cHMsIG0gPSBncm91cHMubGVuZ3RoLCBzdWJncm91cHMgPSBbXSwgcGFyZW50cyA9IFtdLCBqID0gMDsgaiA8IG07ICsraikge1xuICAgIGZvciAodmFyIGdyb3VwID0gZ3JvdXBzW2pdLCBuID0gZ3JvdXAubGVuZ3RoLCBub2RlLCBpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgaWYgKG5vZGUgPSBncm91cFtpXSkge1xuICAgICAgICBmb3IgKHZhciBjaGlsZHJlbiA9IHNlbGVjdC5jYWxsKG5vZGUsIG5vZGUuX19kYXRhX18sIGksIGdyb3VwKSwgY2hpbGQsIGluaGVyaXQgPSBnZXQobm9kZSwgaWQpLCBrID0gMCwgbCA9IGNoaWxkcmVuLmxlbmd0aDsgayA8IGw7ICsraykge1xuICAgICAgICAgIGlmIChjaGlsZCA9IGNoaWxkcmVuW2tdKSB7XG4gICAgICAgICAgICBzY2hlZHVsZShjaGlsZCwgbmFtZSwgaWQsIGssIGNoaWxkcmVuLCBpbmhlcml0KTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgc3ViZ3JvdXBzLnB1c2goY2hpbGRyZW4pO1xuICAgICAgICBwYXJlbnRzLnB1c2gobm9kZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG5ldyBUcmFuc2l0aW9uKHN1Ymdyb3VwcywgcGFyZW50cywgbmFtZSwgaWQpO1xufVxuIiwgImltcG9ydCB7c2VsZWN0aW9ufSBmcm9tIFwiZDMtc2VsZWN0aW9uXCI7XG5cbnZhciBTZWxlY3Rpb24gPSBzZWxlY3Rpb24ucHJvdG90eXBlLmNvbnN0cnVjdG9yO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIG5ldyBTZWxlY3Rpb24odGhpcy5fZ3JvdXBzLCB0aGlzLl9wYXJlbnRzKTtcbn1cbiIsICJpbXBvcnQge2ludGVycG9sYXRlVHJhbnNmb3JtQ3NzIGFzIGludGVycG9sYXRlVHJhbnNmb3JtfSBmcm9tIFwiZDMtaW50ZXJwb2xhdGVcIjtcbmltcG9ydCB7c3R5bGV9IGZyb20gXCJkMy1zZWxlY3Rpb25cIjtcbmltcG9ydCB7c2V0fSBmcm9tIFwiLi9zY2hlZHVsZS5qc1wiO1xuaW1wb3J0IHt0d2VlblZhbHVlfSBmcm9tIFwiLi90d2Vlbi5qc1wiO1xuaW1wb3J0IGludGVycG9sYXRlIGZyb20gXCIuL2ludGVycG9sYXRlLmpzXCI7XG5cbmZ1bmN0aW9uIHN0eWxlTnVsbChuYW1lLCBpbnRlcnBvbGF0ZSkge1xuICB2YXIgc3RyaW5nMDAsXG4gICAgICBzdHJpbmcxMCxcbiAgICAgIGludGVycG9sYXRlMDtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBzdHJpbmcwID0gc3R5bGUodGhpcywgbmFtZSksXG4gICAgICAgIHN0cmluZzEgPSAodGhpcy5zdHlsZS5yZW1vdmVQcm9wZXJ0eShuYW1lKSwgc3R5bGUodGhpcywgbmFtZSkpO1xuICAgIHJldHVybiBzdHJpbmcwID09PSBzdHJpbmcxID8gbnVsbFxuICAgICAgICA6IHN0cmluZzAgPT09IHN0cmluZzAwICYmIHN0cmluZzEgPT09IHN0cmluZzEwID8gaW50ZXJwb2xhdGUwXG4gICAgICAgIDogaW50ZXJwb2xhdGUwID0gaW50ZXJwb2xhdGUoc3RyaW5nMDAgPSBzdHJpbmcwLCBzdHJpbmcxMCA9IHN0cmluZzEpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBzdHlsZVJlbW92ZShuYW1lKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnN0eWxlLnJlbW92ZVByb3BlcnR5KG5hbWUpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBzdHlsZUNvbnN0YW50KG5hbWUsIGludGVycG9sYXRlLCB2YWx1ZTEpIHtcbiAgdmFyIHN0cmluZzAwLFxuICAgICAgc3RyaW5nMSA9IHZhbHVlMSArIFwiXCIsXG4gICAgICBpbnRlcnBvbGF0ZTA7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc3RyaW5nMCA9IHN0eWxlKHRoaXMsIG5hbWUpO1xuICAgIHJldHVybiBzdHJpbmcwID09PSBzdHJpbmcxID8gbnVsbFxuICAgICAgICA6IHN0cmluZzAgPT09IHN0cmluZzAwID8gaW50ZXJwb2xhdGUwXG4gICAgICAgIDogaW50ZXJwb2xhdGUwID0gaW50ZXJwb2xhdGUoc3RyaW5nMDAgPSBzdHJpbmcwLCB2YWx1ZTEpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBzdHlsZUZ1bmN0aW9uKG5hbWUsIGludGVycG9sYXRlLCB2YWx1ZSkge1xuICB2YXIgc3RyaW5nMDAsXG4gICAgICBzdHJpbmcxMCxcbiAgICAgIGludGVycG9sYXRlMDtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBzdHJpbmcwID0gc3R5bGUodGhpcywgbmFtZSksXG4gICAgICAgIHZhbHVlMSA9IHZhbHVlKHRoaXMpLFxuICAgICAgICBzdHJpbmcxID0gdmFsdWUxICsgXCJcIjtcbiAgICBpZiAodmFsdWUxID09IG51bGwpIHN0cmluZzEgPSB2YWx1ZTEgPSAodGhpcy5zdHlsZS5yZW1vdmVQcm9wZXJ0eShuYW1lKSwgc3R5bGUodGhpcywgbmFtZSkpO1xuICAgIHJldHVybiBzdHJpbmcwID09PSBzdHJpbmcxID8gbnVsbFxuICAgICAgICA6IHN0cmluZzAgPT09IHN0cmluZzAwICYmIHN0cmluZzEgPT09IHN0cmluZzEwID8gaW50ZXJwb2xhdGUwXG4gICAgICAgIDogKHN0cmluZzEwID0gc3RyaW5nMSwgaW50ZXJwb2xhdGUwID0gaW50ZXJwb2xhdGUoc3RyaW5nMDAgPSBzdHJpbmcwLCB2YWx1ZTEpKTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gc3R5bGVNYXliZVJlbW92ZShpZCwgbmFtZSkge1xuICB2YXIgb24wLCBvbjEsIGxpc3RlbmVyMCwga2V5ID0gXCJzdHlsZS5cIiArIG5hbWUsIGV2ZW50ID0gXCJlbmQuXCIgKyBrZXksIHJlbW92ZTtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBzY2hlZHVsZSA9IHNldCh0aGlzLCBpZCksXG4gICAgICAgIG9uID0gc2NoZWR1bGUub24sXG4gICAgICAgIGxpc3RlbmVyID0gc2NoZWR1bGUudmFsdWVba2V5XSA9PSBudWxsID8gcmVtb3ZlIHx8IChyZW1vdmUgPSBzdHlsZVJlbW92ZShuYW1lKSkgOiB1bmRlZmluZWQ7XG5cbiAgICAvLyBJZiB0aGlzIG5vZGUgc2hhcmVkIGEgZGlzcGF0Y2ggd2l0aCB0aGUgcHJldmlvdXMgbm9kZSxcbiAgICAvLyBqdXN0IGFzc2lnbiB0aGUgdXBkYXRlZCBzaGFyZWQgZGlzcGF0Y2ggYW5kIHdlXHUyMDE5cmUgZG9uZSFcbiAgICAvLyBPdGhlcndpc2UsIGNvcHktb24td3JpdGUuXG4gICAgaWYgKG9uICE9PSBvbjAgfHwgbGlzdGVuZXIwICE9PSBsaXN0ZW5lcikgKG9uMSA9IChvbjAgPSBvbikuY29weSgpKS5vbihldmVudCwgbGlzdGVuZXIwID0gbGlzdGVuZXIpO1xuXG4gICAgc2NoZWR1bGUub24gPSBvbjE7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG5hbWUsIHZhbHVlLCBwcmlvcml0eSkge1xuICB2YXIgaSA9IChuYW1lICs9IFwiXCIpID09PSBcInRyYW5zZm9ybVwiID8gaW50ZXJwb2xhdGVUcmFuc2Zvcm0gOiBpbnRlcnBvbGF0ZTtcbiAgcmV0dXJuIHZhbHVlID09IG51bGwgPyB0aGlzXG4gICAgICAuc3R5bGVUd2VlbihuYW1lLCBzdHlsZU51bGwobmFtZSwgaSkpXG4gICAgICAub24oXCJlbmQuc3R5bGUuXCIgKyBuYW1lLCBzdHlsZVJlbW92ZShuYW1lKSlcbiAgICA6IHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiID8gdGhpc1xuICAgICAgLnN0eWxlVHdlZW4obmFtZSwgc3R5bGVGdW5jdGlvbihuYW1lLCBpLCB0d2VlblZhbHVlKHRoaXMsIFwic3R5bGUuXCIgKyBuYW1lLCB2YWx1ZSkpKVxuICAgICAgLmVhY2goc3R5bGVNYXliZVJlbW92ZSh0aGlzLl9pZCwgbmFtZSkpXG4gICAgOiB0aGlzXG4gICAgICAuc3R5bGVUd2VlbihuYW1lLCBzdHlsZUNvbnN0YW50KG5hbWUsIGksIHZhbHVlKSwgcHJpb3JpdHkpXG4gICAgICAub24oXCJlbmQuc3R5bGUuXCIgKyBuYW1lLCBudWxsKTtcbn1cbiIsICJmdW5jdGlvbiBzdHlsZUludGVycG9sYXRlKG5hbWUsIGksIHByaW9yaXR5KSB7XG4gIHJldHVybiBmdW5jdGlvbih0KSB7XG4gICAgdGhpcy5zdHlsZS5zZXRQcm9wZXJ0eShuYW1lLCBpLmNhbGwodGhpcywgdCksIHByaW9yaXR5KTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gc3R5bGVUd2VlbihuYW1lLCB2YWx1ZSwgcHJpb3JpdHkpIHtcbiAgdmFyIHQsIGkwO1xuICBmdW5jdGlvbiB0d2VlbigpIHtcbiAgICB2YXIgaSA9IHZhbHVlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgaWYgKGkgIT09IGkwKSB0ID0gKGkwID0gaSkgJiYgc3R5bGVJbnRlcnBvbGF0ZShuYW1lLCBpLCBwcmlvcml0eSk7XG4gICAgcmV0dXJuIHQ7XG4gIH1cbiAgdHdlZW4uX3ZhbHVlID0gdmFsdWU7XG4gIHJldHVybiB0d2Vlbjtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSwgdmFsdWUsIHByaW9yaXR5KSB7XG4gIHZhciBrZXkgPSBcInN0eWxlLlwiICsgKG5hbWUgKz0gXCJcIik7XG4gIGlmIChhcmd1bWVudHMubGVuZ3RoIDwgMikgcmV0dXJuIChrZXkgPSB0aGlzLnR3ZWVuKGtleSkpICYmIGtleS5fdmFsdWU7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gdGhpcy50d2VlbihrZXksIG51bGwpO1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcjtcbiAgcmV0dXJuIHRoaXMudHdlZW4oa2V5LCBzdHlsZVR3ZWVuKG5hbWUsIHZhbHVlLCBwcmlvcml0eSA9PSBudWxsID8gXCJcIiA6IHByaW9yaXR5KSk7XG59XG4iLCAiaW1wb3J0IHt0d2VlblZhbHVlfSBmcm9tIFwiLi90d2Vlbi5qc1wiO1xuXG5mdW5jdGlvbiB0ZXh0Q29uc3RhbnQodmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHRoaXMudGV4dENvbnRlbnQgPSB2YWx1ZTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gdGV4dEZ1bmN0aW9uKHZhbHVlKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgdmFsdWUxID0gdmFsdWUodGhpcyk7XG4gICAgdGhpcy50ZXh0Q29udGVudCA9IHZhbHVlMSA9PSBudWxsID8gXCJcIiA6IHZhbHVlMTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24odmFsdWUpIHtcbiAgcmV0dXJuIHRoaXMudHdlZW4oXCJ0ZXh0XCIsIHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgICA/IHRleHRGdW5jdGlvbih0d2VlblZhbHVlKHRoaXMsIFwidGV4dFwiLCB2YWx1ZSkpXG4gICAgICA6IHRleHRDb25zdGFudCh2YWx1ZSA9PSBudWxsID8gXCJcIiA6IHZhbHVlICsgXCJcIikpO1xufVxuIiwgImZ1bmN0aW9uIHRleHRJbnRlcnBvbGF0ZShpKSB7XG4gIHJldHVybiBmdW5jdGlvbih0KSB7XG4gICAgdGhpcy50ZXh0Q29udGVudCA9IGkuY2FsbCh0aGlzLCB0KTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gdGV4dFR3ZWVuKHZhbHVlKSB7XG4gIHZhciB0MCwgaTA7XG4gIGZ1bmN0aW9uIHR3ZWVuKCkge1xuICAgIHZhciBpID0gdmFsdWUuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICBpZiAoaSAhPT0gaTApIHQwID0gKGkwID0gaSkgJiYgdGV4dEludGVycG9sYXRlKGkpO1xuICAgIHJldHVybiB0MDtcbiAgfVxuICB0d2Vlbi5fdmFsdWUgPSB2YWx1ZTtcbiAgcmV0dXJuIHR3ZWVuO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih2YWx1ZSkge1xuICB2YXIga2V5ID0gXCJ0ZXh0XCI7XG4gIGlmIChhcmd1bWVudHMubGVuZ3RoIDwgMSkgcmV0dXJuIChrZXkgPSB0aGlzLnR3ZWVuKGtleSkpICYmIGtleS5fdmFsdWU7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gdGhpcy50d2VlbihrZXksIG51bGwpO1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcjtcbiAgcmV0dXJuIHRoaXMudHdlZW4oa2V5LCB0ZXh0VHdlZW4odmFsdWUpKTtcbn1cbiIsICJpbXBvcnQge1RyYW5zaXRpb24sIG5ld0lkfSBmcm9tIFwiLi9pbmRleC5qc1wiO1xuaW1wb3J0IHNjaGVkdWxlLCB7Z2V0fSBmcm9tIFwiLi9zY2hlZHVsZS5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgdmFyIG5hbWUgPSB0aGlzLl9uYW1lLFxuICAgICAgaWQwID0gdGhpcy5faWQsXG4gICAgICBpZDEgPSBuZXdJZCgpO1xuXG4gIGZvciAodmFyIGdyb3VwcyA9IHRoaXMuX2dyb3VwcywgbSA9IGdyb3Vwcy5sZW5ndGgsIGogPSAwOyBqIDwgbTsgKytqKSB7XG4gICAgZm9yICh2YXIgZ3JvdXAgPSBncm91cHNbal0sIG4gPSBncm91cC5sZW5ndGgsIG5vZGUsIGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAobm9kZSA9IGdyb3VwW2ldKSB7XG4gICAgICAgIHZhciBpbmhlcml0ID0gZ2V0KG5vZGUsIGlkMCk7XG4gICAgICAgIHNjaGVkdWxlKG5vZGUsIG5hbWUsIGlkMSwgaSwgZ3JvdXAsIHtcbiAgICAgICAgICB0aW1lOiBpbmhlcml0LnRpbWUgKyBpbmhlcml0LmRlbGF5ICsgaW5oZXJpdC5kdXJhdGlvbixcbiAgICAgICAgICBkZWxheTogMCxcbiAgICAgICAgICBkdXJhdGlvbjogaW5oZXJpdC5kdXJhdGlvbixcbiAgICAgICAgICBlYXNlOiBpbmhlcml0LmVhc2VcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG5ldyBUcmFuc2l0aW9uKGdyb3VwcywgdGhpcy5fcGFyZW50cywgbmFtZSwgaWQxKTtcbn1cbiIsICJpbXBvcnQge3NldH0gZnJvbSBcIi4vc2NoZWR1bGUuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIHZhciBvbjAsIG9uMSwgdGhhdCA9IHRoaXMsIGlkID0gdGhhdC5faWQsIHNpemUgPSB0aGF0LnNpemUoKTtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgIHZhciBjYW5jZWwgPSB7dmFsdWU6IHJlamVjdH0sXG4gICAgICAgIGVuZCA9IHt2YWx1ZTogZnVuY3Rpb24oKSB7IGlmICgtLXNpemUgPT09IDApIHJlc29sdmUoKTsgfX07XG5cbiAgICB0aGF0LmVhY2goZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgc2NoZWR1bGUgPSBzZXQodGhpcywgaWQpLFxuICAgICAgICAgIG9uID0gc2NoZWR1bGUub247XG5cbiAgICAgIC8vIElmIHRoaXMgbm9kZSBzaGFyZWQgYSBkaXNwYXRjaCB3aXRoIHRoZSBwcmV2aW91cyBub2RlLFxuICAgICAgLy8ganVzdCBhc3NpZ24gdGhlIHVwZGF0ZWQgc2hhcmVkIGRpc3BhdGNoIGFuZCB3ZVx1MjAxOXJlIGRvbmUhXG4gICAgICAvLyBPdGhlcndpc2UsIGNvcHktb24td3JpdGUuXG4gICAgICBpZiAob24gIT09IG9uMCkge1xuICAgICAgICBvbjEgPSAob24wID0gb24pLmNvcHkoKTtcbiAgICAgICAgb24xLl8uY2FuY2VsLnB1c2goY2FuY2VsKTtcbiAgICAgICAgb24xLl8uaW50ZXJydXB0LnB1c2goY2FuY2VsKTtcbiAgICAgICAgb24xLl8uZW5kLnB1c2goZW5kKTtcbiAgICAgIH1cblxuICAgICAgc2NoZWR1bGUub24gPSBvbjE7XG4gICAgfSk7XG5cbiAgICAvLyBUaGUgc2VsZWN0aW9uIHdhcyBlbXB0eSwgcmVzb2x2ZSBlbmQgaW1tZWRpYXRlbHlcbiAgICBpZiAoc2l6ZSA9PT0gMCkgcmVzb2x2ZSgpO1xuICB9KTtcbn1cbiIsICJpbXBvcnQge3NlbGVjdGlvbn0gZnJvbSBcImQzLXNlbGVjdGlvblwiO1xuaW1wb3J0IHRyYW5zaXRpb25fYXR0ciBmcm9tIFwiLi9hdHRyLmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl9hdHRyVHdlZW4gZnJvbSBcIi4vYXR0clR3ZWVuLmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl9kZWxheSBmcm9tIFwiLi9kZWxheS5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fZHVyYXRpb24gZnJvbSBcIi4vZHVyYXRpb24uanNcIjtcbmltcG9ydCB0cmFuc2l0aW9uX2Vhc2UgZnJvbSBcIi4vZWFzZS5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fZWFzZVZhcnlpbmcgZnJvbSBcIi4vZWFzZVZhcnlpbmcuanNcIjtcbmltcG9ydCB0cmFuc2l0aW9uX2ZpbHRlciBmcm9tIFwiLi9maWx0ZXIuanNcIjtcbmltcG9ydCB0cmFuc2l0aW9uX21lcmdlIGZyb20gXCIuL21lcmdlLmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl9vbiBmcm9tIFwiLi9vbi5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fcmVtb3ZlIGZyb20gXCIuL3JlbW92ZS5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fc2VsZWN0IGZyb20gXCIuL3NlbGVjdC5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fc2VsZWN0QWxsIGZyb20gXCIuL3NlbGVjdEFsbC5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fc2VsZWN0aW9uIGZyb20gXCIuL3NlbGVjdGlvbi5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fc3R5bGUgZnJvbSBcIi4vc3R5bGUuanNcIjtcbmltcG9ydCB0cmFuc2l0aW9uX3N0eWxlVHdlZW4gZnJvbSBcIi4vc3R5bGVUd2Vlbi5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fdGV4dCBmcm9tIFwiLi90ZXh0LmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl90ZXh0VHdlZW4gZnJvbSBcIi4vdGV4dFR3ZWVuLmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl90cmFuc2l0aW9uIGZyb20gXCIuL3RyYW5zaXRpb24uanNcIjtcbmltcG9ydCB0cmFuc2l0aW9uX3R3ZWVuIGZyb20gXCIuL3R3ZWVuLmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl9lbmQgZnJvbSBcIi4vZW5kLmpzXCI7XG5cbnZhciBpZCA9IDA7XG5cbmV4cG9ydCBmdW5jdGlvbiBUcmFuc2l0aW9uKGdyb3VwcywgcGFyZW50cywgbmFtZSwgaWQpIHtcbiAgdGhpcy5fZ3JvdXBzID0gZ3JvdXBzO1xuICB0aGlzLl9wYXJlbnRzID0gcGFyZW50cztcbiAgdGhpcy5fbmFtZSA9IG5hbWU7XG4gIHRoaXMuX2lkID0gaWQ7XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIHRyYW5zaXRpb24obmFtZSkge1xuICByZXR1cm4gc2VsZWN0aW9uKCkudHJhbnNpdGlvbihuYW1lKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG5ld0lkKCkge1xuICByZXR1cm4gKytpZDtcbn1cblxudmFyIHNlbGVjdGlvbl9wcm90b3R5cGUgPSBzZWxlY3Rpb24ucHJvdG90eXBlO1xuXG5UcmFuc2l0aW9uLnByb3RvdHlwZSA9IHRyYW5zaXRpb24ucHJvdG90eXBlID0ge1xuICBjb25zdHJ1Y3RvcjogVHJhbnNpdGlvbixcbiAgc2VsZWN0OiB0cmFuc2l0aW9uX3NlbGVjdCxcbiAgc2VsZWN0QWxsOiB0cmFuc2l0aW9uX3NlbGVjdEFsbCxcbiAgc2VsZWN0Q2hpbGQ6IHNlbGVjdGlvbl9wcm90b3R5cGUuc2VsZWN0Q2hpbGQsXG4gIHNlbGVjdENoaWxkcmVuOiBzZWxlY3Rpb25fcHJvdG90eXBlLnNlbGVjdENoaWxkcmVuLFxuICBmaWx0ZXI6IHRyYW5zaXRpb25fZmlsdGVyLFxuICBtZXJnZTogdHJhbnNpdGlvbl9tZXJnZSxcbiAgc2VsZWN0aW9uOiB0cmFuc2l0aW9uX3NlbGVjdGlvbixcbiAgdHJhbnNpdGlvbjogdHJhbnNpdGlvbl90cmFuc2l0aW9uLFxuICBjYWxsOiBzZWxlY3Rpb25fcHJvdG90eXBlLmNhbGwsXG4gIG5vZGVzOiBzZWxlY3Rpb25fcHJvdG90eXBlLm5vZGVzLFxuICBub2RlOiBzZWxlY3Rpb25fcHJvdG90eXBlLm5vZGUsXG4gIHNpemU6IHNlbGVjdGlvbl9wcm90b3R5cGUuc2l6ZSxcbiAgZW1wdHk6IHNlbGVjdGlvbl9wcm90b3R5cGUuZW1wdHksXG4gIGVhY2g6IHNlbGVjdGlvbl9wcm90b3R5cGUuZWFjaCxcbiAgb246IHRyYW5zaXRpb25fb24sXG4gIGF0dHI6IHRyYW5zaXRpb25fYXR0cixcbiAgYXR0clR3ZWVuOiB0cmFuc2l0aW9uX2F0dHJUd2VlbixcbiAgc3R5bGU6IHRyYW5zaXRpb25fc3R5bGUsXG4gIHN0eWxlVHdlZW46IHRyYW5zaXRpb25fc3R5bGVUd2VlbixcbiAgdGV4dDogdHJhbnNpdGlvbl90ZXh0LFxuICB0ZXh0VHdlZW46IHRyYW5zaXRpb25fdGV4dFR3ZWVuLFxuICByZW1vdmU6IHRyYW5zaXRpb25fcmVtb3ZlLFxuICB0d2VlbjogdHJhbnNpdGlvbl90d2VlbixcbiAgZGVsYXk6IHRyYW5zaXRpb25fZGVsYXksXG4gIGR1cmF0aW9uOiB0cmFuc2l0aW9uX2R1cmF0aW9uLFxuICBlYXNlOiB0cmFuc2l0aW9uX2Vhc2UsXG4gIGVhc2VWYXJ5aW5nOiB0cmFuc2l0aW9uX2Vhc2VWYXJ5aW5nLFxuICBlbmQ6IHRyYW5zaXRpb25fZW5kLFxuICBbU3ltYm9sLml0ZXJhdG9yXTogc2VsZWN0aW9uX3Byb3RvdHlwZVtTeW1ib2wuaXRlcmF0b3JdXG59O1xuIiwgImV4cG9ydCBmdW5jdGlvbiBjdWJpY0luKHQpIHtcbiAgcmV0dXJuIHQgKiB0ICogdDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGN1YmljT3V0KHQpIHtcbiAgcmV0dXJuIC0tdCAqIHQgKiB0ICsgMTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGN1YmljSW5PdXQodCkge1xuICByZXR1cm4gKCh0ICo9IDIpIDw9IDEgPyB0ICogdCAqIHQgOiAodCAtPSAyKSAqIHQgKiB0ICsgMikgLyAyO1xufVxuIiwgImltcG9ydCB7VHJhbnNpdGlvbiwgbmV3SWR9IGZyb20gXCIuLi90cmFuc2l0aW9uL2luZGV4LmpzXCI7XG5pbXBvcnQgc2NoZWR1bGUgZnJvbSBcIi4uL3RyYW5zaXRpb24vc2NoZWR1bGUuanNcIjtcbmltcG9ydCB7ZWFzZUN1YmljSW5PdXR9IGZyb20gXCJkMy1lYXNlXCI7XG5pbXBvcnQge25vd30gZnJvbSBcImQzLXRpbWVyXCI7XG5cbnZhciBkZWZhdWx0VGltaW5nID0ge1xuICB0aW1lOiBudWxsLCAvLyBTZXQgb24gdXNlLlxuICBkZWxheTogMCxcbiAgZHVyYXRpb246IDI1MCxcbiAgZWFzZTogZWFzZUN1YmljSW5PdXRcbn07XG5cbmZ1bmN0aW9uIGluaGVyaXQobm9kZSwgaWQpIHtcbiAgdmFyIHRpbWluZztcbiAgd2hpbGUgKCEodGltaW5nID0gbm9kZS5fX3RyYW5zaXRpb24pIHx8ICEodGltaW5nID0gdGltaW5nW2lkXSkpIHtcbiAgICBpZiAoIShub2RlID0gbm9kZS5wYXJlbnROb2RlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGB0cmFuc2l0aW9uICR7aWR9IG5vdCBmb3VuZGApO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdGltaW5nO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihuYW1lKSB7XG4gIHZhciBpZCxcbiAgICAgIHRpbWluZztcblxuICBpZiAobmFtZSBpbnN0YW5jZW9mIFRyYW5zaXRpb24pIHtcbiAgICBpZCA9IG5hbWUuX2lkLCBuYW1lID0gbmFtZS5fbmFtZTtcbiAgfSBlbHNlIHtcbiAgICBpZCA9IG5ld0lkKCksICh0aW1pbmcgPSBkZWZhdWx0VGltaW5nKS50aW1lID0gbm93KCksIG5hbWUgPSBuYW1lID09IG51bGwgPyBudWxsIDogbmFtZSArIFwiXCI7XG4gIH1cblxuICBmb3IgKHZhciBncm91cHMgPSB0aGlzLl9ncm91cHMsIG0gPSBncm91cHMubGVuZ3RoLCBqID0gMDsgaiA8IG07ICsraikge1xuICAgIGZvciAodmFyIGdyb3VwID0gZ3JvdXBzW2pdLCBuID0gZ3JvdXAubGVuZ3RoLCBub2RlLCBpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgaWYgKG5vZGUgPSBncm91cFtpXSkge1xuICAgICAgICBzY2hlZHVsZShub2RlLCBuYW1lLCBpZCwgaSwgZ3JvdXAsIHRpbWluZyB8fCBpbmhlcml0KG5vZGUsIGlkKSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG5ldyBUcmFuc2l0aW9uKGdyb3VwcywgdGhpcy5fcGFyZW50cywgbmFtZSwgaWQpO1xufVxuIiwgImltcG9ydCB7c2VsZWN0aW9ufSBmcm9tIFwiZDMtc2VsZWN0aW9uXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2ludGVycnVwdCBmcm9tIFwiLi9pbnRlcnJ1cHQuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fdHJhbnNpdGlvbiBmcm9tIFwiLi90cmFuc2l0aW9uLmpzXCI7XG5cbnNlbGVjdGlvbi5wcm90b3R5cGUuaW50ZXJydXB0ID0gc2VsZWN0aW9uX2ludGVycnVwdDtcbnNlbGVjdGlvbi5wcm90b3R5cGUudHJhbnNpdGlvbiA9IHNlbGVjdGlvbl90cmFuc2l0aW9uO1xuIiwgImltcG9ydCB7ZGlzcGF0Y2h9IGZyb20gXCJkMy1kaXNwYXRjaFwiO1xuaW1wb3J0IHtkcmFnRGlzYWJsZSwgZHJhZ0VuYWJsZX0gZnJvbSBcImQzLWRyYWdcIjtcbmltcG9ydCB7aW50ZXJwb2xhdGV9IGZyb20gXCJkMy1pbnRlcnBvbGF0ZVwiO1xuaW1wb3J0IHtwb2ludGVyLCBzZWxlY3R9IGZyb20gXCJkMy1zZWxlY3Rpb25cIjtcbmltcG9ydCB7aW50ZXJydXB0fSBmcm9tIFwiZDMtdHJhbnNpdGlvblwiO1xuaW1wb3J0IGNvbnN0YW50IGZyb20gXCIuL2NvbnN0YW50LmpzXCI7XG5pbXBvcnQgQnJ1c2hFdmVudCBmcm9tIFwiLi9ldmVudC5qc1wiO1xuaW1wb3J0IG5vZXZlbnQsIHtub3Byb3BhZ2F0aW9ufSBmcm9tIFwiLi9ub2V2ZW50LmpzXCI7XG5cbnZhciBNT0RFX0RSQUcgPSB7bmFtZTogXCJkcmFnXCJ9LFxuICAgIE1PREVfU1BBQ0UgPSB7bmFtZTogXCJzcGFjZVwifSxcbiAgICBNT0RFX0hBTkRMRSA9IHtuYW1lOiBcImhhbmRsZVwifSxcbiAgICBNT0RFX0NFTlRFUiA9IHtuYW1lOiBcImNlbnRlclwifTtcblxuY29uc3Qge2FicywgbWF4LCBtaW59ID0gTWF0aDtcblxuZnVuY3Rpb24gbnVtYmVyMShlKSB7XG4gIHJldHVybiBbK2VbMF0sICtlWzFdXTtcbn1cblxuZnVuY3Rpb24gbnVtYmVyMihlKSB7XG4gIHJldHVybiBbbnVtYmVyMShlWzBdKSwgbnVtYmVyMShlWzFdKV07XG59XG5cbnZhciBYID0ge1xuICBuYW1lOiBcInhcIixcbiAgaGFuZGxlczogW1wid1wiLCBcImVcIl0ubWFwKHR5cGUpLFxuICBpbnB1dDogZnVuY3Rpb24oeCwgZSkgeyByZXR1cm4geCA9PSBudWxsID8gbnVsbCA6IFtbK3hbMF0sIGVbMF1bMV1dLCBbK3hbMV0sIGVbMV1bMV1dXTsgfSxcbiAgb3V0cHV0OiBmdW5jdGlvbih4eSkgeyByZXR1cm4geHkgJiYgW3h5WzBdWzBdLCB4eVsxXVswXV07IH1cbn07XG5cbnZhciBZID0ge1xuICBuYW1lOiBcInlcIixcbiAgaGFuZGxlczogW1wiblwiLCBcInNcIl0ubWFwKHR5cGUpLFxuICBpbnB1dDogZnVuY3Rpb24oeSwgZSkgeyByZXR1cm4geSA9PSBudWxsID8gbnVsbCA6IFtbZVswXVswXSwgK3lbMF1dLCBbZVsxXVswXSwgK3lbMV1dXTsgfSxcbiAgb3V0cHV0OiBmdW5jdGlvbih4eSkgeyByZXR1cm4geHkgJiYgW3h5WzBdWzFdLCB4eVsxXVsxXV07IH1cbn07XG5cbnZhciBYWSA9IHtcbiAgbmFtZTogXCJ4eVwiLFxuICBoYW5kbGVzOiBbXCJuXCIsIFwid1wiLCBcImVcIiwgXCJzXCIsIFwibndcIiwgXCJuZVwiLCBcInN3XCIsIFwic2VcIl0ubWFwKHR5cGUpLFxuICBpbnB1dDogZnVuY3Rpb24oeHkpIHsgcmV0dXJuIHh5ID09IG51bGwgPyBudWxsIDogbnVtYmVyMih4eSk7IH0sXG4gIG91dHB1dDogZnVuY3Rpb24oeHkpIHsgcmV0dXJuIHh5OyB9XG59O1xuXG52YXIgY3Vyc29ycyA9IHtcbiAgb3ZlcmxheTogXCJjcm9zc2hhaXJcIixcbiAgc2VsZWN0aW9uOiBcIm1vdmVcIixcbiAgbjogXCJucy1yZXNpemVcIixcbiAgZTogXCJldy1yZXNpemVcIixcbiAgczogXCJucy1yZXNpemVcIixcbiAgdzogXCJldy1yZXNpemVcIixcbiAgbnc6IFwibndzZS1yZXNpemVcIixcbiAgbmU6IFwibmVzdy1yZXNpemVcIixcbiAgc2U6IFwibndzZS1yZXNpemVcIixcbiAgc3c6IFwibmVzdy1yZXNpemVcIlxufTtcblxudmFyIGZsaXBYID0ge1xuICBlOiBcIndcIixcbiAgdzogXCJlXCIsXG4gIG53OiBcIm5lXCIsXG4gIG5lOiBcIm53XCIsXG4gIHNlOiBcInN3XCIsXG4gIHN3OiBcInNlXCJcbn07XG5cbnZhciBmbGlwWSA9IHtcbiAgbjogXCJzXCIsXG4gIHM6IFwiblwiLFxuICBudzogXCJzd1wiLFxuICBuZTogXCJzZVwiLFxuICBzZTogXCJuZVwiLFxuICBzdzogXCJud1wiXG59O1xuXG52YXIgc2lnbnNYID0ge1xuICBvdmVybGF5OiArMSxcbiAgc2VsZWN0aW9uOiArMSxcbiAgbjogbnVsbCxcbiAgZTogKzEsXG4gIHM6IG51bGwsXG4gIHc6IC0xLFxuICBudzogLTEsXG4gIG5lOiArMSxcbiAgc2U6ICsxLFxuICBzdzogLTFcbn07XG5cbnZhciBzaWduc1kgPSB7XG4gIG92ZXJsYXk6ICsxLFxuICBzZWxlY3Rpb246ICsxLFxuICBuOiAtMSxcbiAgZTogbnVsbCxcbiAgczogKzEsXG4gIHc6IG51bGwsXG4gIG53OiAtMSxcbiAgbmU6IC0xLFxuICBzZTogKzEsXG4gIHN3OiArMVxufTtcblxuZnVuY3Rpb24gdHlwZSh0KSB7XG4gIHJldHVybiB7dHlwZTogdH07XG59XG5cbi8vIElnbm9yZSByaWdodC1jbGljaywgc2luY2UgdGhhdCBzaG91bGQgb3BlbiB0aGUgY29udGV4dCBtZW51LlxuZnVuY3Rpb24gZGVmYXVsdEZpbHRlcihldmVudCkge1xuICByZXR1cm4gIWV2ZW50LmN0cmxLZXkgJiYgIWV2ZW50LmJ1dHRvbjtcbn1cblxuZnVuY3Rpb24gZGVmYXVsdEV4dGVudCgpIHtcbiAgdmFyIHN2ZyA9IHRoaXMub3duZXJTVkdFbGVtZW50IHx8IHRoaXM7XG4gIGlmIChzdmcuaGFzQXR0cmlidXRlKFwidmlld0JveFwiKSkge1xuICAgIHN2ZyA9IHN2Zy52aWV3Qm94LmJhc2VWYWw7XG4gICAgcmV0dXJuIFtbc3ZnLngsIHN2Zy55XSwgW3N2Zy54ICsgc3ZnLndpZHRoLCBzdmcueSArIHN2Zy5oZWlnaHRdXTtcbiAgfVxuICByZXR1cm4gW1swLCAwXSwgW3N2Zy53aWR0aC5iYXNlVmFsLnZhbHVlLCBzdmcuaGVpZ2h0LmJhc2VWYWwudmFsdWVdXTtcbn1cblxuZnVuY3Rpb24gZGVmYXVsdFRvdWNoYWJsZSgpIHtcbiAgcmV0dXJuIG5hdmlnYXRvci5tYXhUb3VjaFBvaW50cyB8fCAoXCJvbnRvdWNoc3RhcnRcIiBpbiB0aGlzKTtcbn1cblxuLy8gTGlrZSBkMy5sb2NhbCwgYnV0IHdpdGggdGhlIG5hbWUgXHUyMDFDX19icnVzaFx1MjAxRCByYXRoZXIgdGhhbiBhdXRvLWdlbmVyYXRlZC5cbmZ1bmN0aW9uIGxvY2FsKG5vZGUpIHtcbiAgd2hpbGUgKCFub2RlLl9fYnJ1c2gpIGlmICghKG5vZGUgPSBub2RlLnBhcmVudE5vZGUpKSByZXR1cm47XG4gIHJldHVybiBub2RlLl9fYnJ1c2g7XG59XG5cbmZ1bmN0aW9uIGVtcHR5KGV4dGVudCkge1xuICByZXR1cm4gZXh0ZW50WzBdWzBdID09PSBleHRlbnRbMV1bMF1cbiAgICAgIHx8IGV4dGVudFswXVsxXSA9PT0gZXh0ZW50WzFdWzFdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYnJ1c2hTZWxlY3Rpb24obm9kZSkge1xuICB2YXIgc3RhdGUgPSBub2RlLl9fYnJ1c2g7XG4gIHJldHVybiBzdGF0ZSA/IHN0YXRlLmRpbS5vdXRwdXQoc3RhdGUuc2VsZWN0aW9uKSA6IG51bGw7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBicnVzaFgoKSB7XG4gIHJldHVybiBicnVzaChYKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJydXNoWSgpIHtcbiAgcmV0dXJuIGJydXNoKFkpO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIGJydXNoKFhZKTtcbn1cblxuZnVuY3Rpb24gYnJ1c2goZGltKSB7XG4gIHZhciBleHRlbnQgPSBkZWZhdWx0RXh0ZW50LFxuICAgICAgZmlsdGVyID0gZGVmYXVsdEZpbHRlcixcbiAgICAgIHRvdWNoYWJsZSA9IGRlZmF1bHRUb3VjaGFibGUsXG4gICAgICBrZXlzID0gdHJ1ZSxcbiAgICAgIGxpc3RlbmVycyA9IGRpc3BhdGNoKFwic3RhcnRcIiwgXCJicnVzaFwiLCBcImVuZFwiKSxcbiAgICAgIGhhbmRsZVNpemUgPSA2LFxuICAgICAgdG91Y2hlbmRpbmc7XG5cbiAgZnVuY3Rpb24gYnJ1c2goZ3JvdXApIHtcbiAgICB2YXIgb3ZlcmxheSA9IGdyb3VwXG4gICAgICAgIC5wcm9wZXJ0eShcIl9fYnJ1c2hcIiwgaW5pdGlhbGl6ZSlcbiAgICAgIC5zZWxlY3RBbGwoXCIub3ZlcmxheVwiKVxuICAgICAgLmRhdGEoW3R5cGUoXCJvdmVybGF5XCIpXSk7XG5cbiAgICBvdmVybGF5LmVudGVyKCkuYXBwZW5kKFwicmVjdFwiKVxuICAgICAgICAuYXR0cihcImNsYXNzXCIsIFwib3ZlcmxheVwiKVxuICAgICAgICAuYXR0cihcInBvaW50ZXItZXZlbnRzXCIsIFwiYWxsXCIpXG4gICAgICAgIC5hdHRyKFwiY3Vyc29yXCIsIGN1cnNvcnMub3ZlcmxheSlcbiAgICAgIC5tZXJnZShvdmVybGF5KVxuICAgICAgICAuZWFjaChmdW5jdGlvbigpIHtcbiAgICAgICAgICB2YXIgZXh0ZW50ID0gbG9jYWwodGhpcykuZXh0ZW50O1xuICAgICAgICAgIHNlbGVjdCh0aGlzKVxuICAgICAgICAgICAgICAuYXR0cihcInhcIiwgZXh0ZW50WzBdWzBdKVxuICAgICAgICAgICAgICAuYXR0cihcInlcIiwgZXh0ZW50WzBdWzFdKVxuICAgICAgICAgICAgICAuYXR0cihcIndpZHRoXCIsIGV4dGVudFsxXVswXSAtIGV4dGVudFswXVswXSlcbiAgICAgICAgICAgICAgLmF0dHIoXCJoZWlnaHRcIiwgZXh0ZW50WzFdWzFdIC0gZXh0ZW50WzBdWzFdKTtcbiAgICAgICAgfSk7XG5cbiAgICBncm91cC5zZWxlY3RBbGwoXCIuc2VsZWN0aW9uXCIpXG4gICAgICAuZGF0YShbdHlwZShcInNlbGVjdGlvblwiKV0pXG4gICAgICAuZW50ZXIoKS5hcHBlbmQoXCJyZWN0XCIpXG4gICAgICAgIC5hdHRyKFwiY2xhc3NcIiwgXCJzZWxlY3Rpb25cIilcbiAgICAgICAgLmF0dHIoXCJjdXJzb3JcIiwgY3Vyc29ycy5zZWxlY3Rpb24pXG4gICAgICAgIC5hdHRyKFwiZmlsbFwiLCBcIiM3NzdcIilcbiAgICAgICAgLmF0dHIoXCJmaWxsLW9wYWNpdHlcIiwgMC4zKVxuICAgICAgICAuYXR0cihcInN0cm9rZVwiLCBcIiNmZmZcIilcbiAgICAgICAgLmF0dHIoXCJzaGFwZS1yZW5kZXJpbmdcIiwgXCJjcmlzcEVkZ2VzXCIpO1xuXG4gICAgdmFyIGhhbmRsZSA9IGdyb3VwLnNlbGVjdEFsbChcIi5oYW5kbGVcIilcbiAgICAgIC5kYXRhKGRpbS5oYW5kbGVzLCBmdW5jdGlvbihkKSB7IHJldHVybiBkLnR5cGU7IH0pO1xuXG4gICAgaGFuZGxlLmV4aXQoKS5yZW1vdmUoKTtcblxuICAgIGhhbmRsZS5lbnRlcigpLmFwcGVuZChcInJlY3RcIilcbiAgICAgICAgLmF0dHIoXCJjbGFzc1wiLCBmdW5jdGlvbihkKSB7IHJldHVybiBcImhhbmRsZSBoYW5kbGUtLVwiICsgZC50eXBlOyB9KVxuICAgICAgICAuYXR0cihcImN1cnNvclwiLCBmdW5jdGlvbihkKSB7IHJldHVybiBjdXJzb3JzW2QudHlwZV07IH0pO1xuXG4gICAgZ3JvdXBcbiAgICAgICAgLmVhY2gocmVkcmF3KVxuICAgICAgICAuYXR0cihcImZpbGxcIiwgXCJub25lXCIpXG4gICAgICAgIC5hdHRyKFwicG9pbnRlci1ldmVudHNcIiwgXCJhbGxcIilcbiAgICAgICAgLm9uKFwibW91c2Vkb3duLmJydXNoXCIsIHN0YXJ0ZWQpXG4gICAgICAuZmlsdGVyKHRvdWNoYWJsZSlcbiAgICAgICAgLm9uKFwidG91Y2hzdGFydC5icnVzaFwiLCBzdGFydGVkKVxuICAgICAgICAub24oXCJ0b3VjaG1vdmUuYnJ1c2hcIiwgdG91Y2htb3ZlZClcbiAgICAgICAgLm9uKFwidG91Y2hlbmQuYnJ1c2ggdG91Y2hjYW5jZWwuYnJ1c2hcIiwgdG91Y2hlbmRlZClcbiAgICAgICAgLnN0eWxlKFwidG91Y2gtYWN0aW9uXCIsIFwibm9uZVwiKVxuICAgICAgICAuc3R5bGUoXCItd2Via2l0LXRhcC1oaWdobGlnaHQtY29sb3JcIiwgXCJyZ2JhKDAsMCwwLDApXCIpO1xuICB9XG5cbiAgYnJ1c2gubW92ZSA9IGZ1bmN0aW9uKGdyb3VwLCBzZWxlY3Rpb24sIGV2ZW50KSB7XG4gICAgaWYgKGdyb3VwLnR3ZWVuKSB7XG4gICAgICBncm91cFxuICAgICAgICAgIC5vbihcInN0YXJ0LmJydXNoXCIsIGZ1bmN0aW9uKGV2ZW50KSB7IGVtaXR0ZXIodGhpcywgYXJndW1lbnRzKS5iZWZvcmVzdGFydCgpLnN0YXJ0KGV2ZW50KTsgfSlcbiAgICAgICAgICAub24oXCJpbnRlcnJ1cHQuYnJ1c2ggZW5kLmJydXNoXCIsIGZ1bmN0aW9uKGV2ZW50KSB7IGVtaXR0ZXIodGhpcywgYXJndW1lbnRzKS5lbmQoZXZlbnQpOyB9KVxuICAgICAgICAgIC50d2VlbihcImJydXNoXCIsIGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdmFyIHRoYXQgPSB0aGlzLFxuICAgICAgICAgICAgICAgIHN0YXRlID0gdGhhdC5fX2JydXNoLFxuICAgICAgICAgICAgICAgIGVtaXQgPSBlbWl0dGVyKHRoYXQsIGFyZ3VtZW50cyksXG4gICAgICAgICAgICAgICAgc2VsZWN0aW9uMCA9IHN0YXRlLnNlbGVjdGlvbixcbiAgICAgICAgICAgICAgICBzZWxlY3Rpb24xID0gZGltLmlucHV0KHR5cGVvZiBzZWxlY3Rpb24gPT09IFwiZnVuY3Rpb25cIiA/IHNlbGVjdGlvbi5hcHBseSh0aGlzLCBhcmd1bWVudHMpIDogc2VsZWN0aW9uLCBzdGF0ZS5leHRlbnQpLFxuICAgICAgICAgICAgICAgIGkgPSBpbnRlcnBvbGF0ZShzZWxlY3Rpb24wLCBzZWxlY3Rpb24xKTtcblxuICAgICAgICAgICAgZnVuY3Rpb24gdHdlZW4odCkge1xuICAgICAgICAgICAgICBzdGF0ZS5zZWxlY3Rpb24gPSB0ID09PSAxICYmIHNlbGVjdGlvbjEgPT09IG51bGwgPyBudWxsIDogaSh0KTtcbiAgICAgICAgICAgICAgcmVkcmF3LmNhbGwodGhhdCk7XG4gICAgICAgICAgICAgIGVtaXQuYnJ1c2goKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHNlbGVjdGlvbjAgIT09IG51bGwgJiYgc2VsZWN0aW9uMSAhPT0gbnVsbCA/IHR3ZWVuIDogdHdlZW4oMSk7XG4gICAgICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGdyb3VwXG4gICAgICAgICAgLmVhY2goZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB2YXIgdGhhdCA9IHRoaXMsXG4gICAgICAgICAgICAgICAgYXJncyA9IGFyZ3VtZW50cyxcbiAgICAgICAgICAgICAgICBzdGF0ZSA9IHRoYXQuX19icnVzaCxcbiAgICAgICAgICAgICAgICBzZWxlY3Rpb24xID0gZGltLmlucHV0KHR5cGVvZiBzZWxlY3Rpb24gPT09IFwiZnVuY3Rpb25cIiA/IHNlbGVjdGlvbi5hcHBseSh0aGF0LCBhcmdzKSA6IHNlbGVjdGlvbiwgc3RhdGUuZXh0ZW50KSxcbiAgICAgICAgICAgICAgICBlbWl0ID0gZW1pdHRlcih0aGF0LCBhcmdzKS5iZWZvcmVzdGFydCgpO1xuXG4gICAgICAgICAgICBpbnRlcnJ1cHQodGhhdCk7XG4gICAgICAgICAgICBzdGF0ZS5zZWxlY3Rpb24gPSBzZWxlY3Rpb24xID09PSBudWxsID8gbnVsbCA6IHNlbGVjdGlvbjE7XG4gICAgICAgICAgICByZWRyYXcuY2FsbCh0aGF0KTtcbiAgICAgICAgICAgIGVtaXQuc3RhcnQoZXZlbnQpLmJydXNoKGV2ZW50KS5lbmQoZXZlbnQpO1xuICAgICAgICAgIH0pO1xuICAgIH1cbiAgfTtcblxuICBicnVzaC5jbGVhciA9IGZ1bmN0aW9uKGdyb3VwLCBldmVudCkge1xuICAgIGJydXNoLm1vdmUoZ3JvdXAsIG51bGwsIGV2ZW50KTtcbiAgfTtcblxuICBmdW5jdGlvbiByZWRyYXcoKSB7XG4gICAgdmFyIGdyb3VwID0gc2VsZWN0KHRoaXMpLFxuICAgICAgICBzZWxlY3Rpb24gPSBsb2NhbCh0aGlzKS5zZWxlY3Rpb247XG5cbiAgICBpZiAoc2VsZWN0aW9uKSB7XG4gICAgICBncm91cC5zZWxlY3RBbGwoXCIuc2VsZWN0aW9uXCIpXG4gICAgICAgICAgLnN0eWxlKFwiZGlzcGxheVwiLCBudWxsKVxuICAgICAgICAgIC5hdHRyKFwieFwiLCBzZWxlY3Rpb25bMF1bMF0pXG4gICAgICAgICAgLmF0dHIoXCJ5XCIsIHNlbGVjdGlvblswXVsxXSlcbiAgICAgICAgICAuYXR0cihcIndpZHRoXCIsIHNlbGVjdGlvblsxXVswXSAtIHNlbGVjdGlvblswXVswXSlcbiAgICAgICAgICAuYXR0cihcImhlaWdodFwiLCBzZWxlY3Rpb25bMV1bMV0gLSBzZWxlY3Rpb25bMF1bMV0pO1xuXG4gICAgICBncm91cC5zZWxlY3RBbGwoXCIuaGFuZGxlXCIpXG4gICAgICAgICAgLnN0eWxlKFwiZGlzcGxheVwiLCBudWxsKVxuICAgICAgICAgIC5hdHRyKFwieFwiLCBmdW5jdGlvbihkKSB7IHJldHVybiBkLnR5cGVbZC50eXBlLmxlbmd0aCAtIDFdID09PSBcImVcIiA/IHNlbGVjdGlvblsxXVswXSAtIGhhbmRsZVNpemUgLyAyIDogc2VsZWN0aW9uWzBdWzBdIC0gaGFuZGxlU2l6ZSAvIDI7IH0pXG4gICAgICAgICAgLmF0dHIoXCJ5XCIsIGZ1bmN0aW9uKGQpIHsgcmV0dXJuIGQudHlwZVswXSA9PT0gXCJzXCIgPyBzZWxlY3Rpb25bMV1bMV0gLSBoYW5kbGVTaXplIC8gMiA6IHNlbGVjdGlvblswXVsxXSAtIGhhbmRsZVNpemUgLyAyOyB9KVxuICAgICAgICAgIC5hdHRyKFwid2lkdGhcIiwgZnVuY3Rpb24oZCkgeyByZXR1cm4gZC50eXBlID09PSBcIm5cIiB8fCBkLnR5cGUgPT09IFwic1wiID8gc2VsZWN0aW9uWzFdWzBdIC0gc2VsZWN0aW9uWzBdWzBdICsgaGFuZGxlU2l6ZSA6IGhhbmRsZVNpemU7IH0pXG4gICAgICAgICAgLmF0dHIoXCJoZWlnaHRcIiwgZnVuY3Rpb24oZCkgeyByZXR1cm4gZC50eXBlID09PSBcImVcIiB8fCBkLnR5cGUgPT09IFwid1wiID8gc2VsZWN0aW9uWzFdWzFdIC0gc2VsZWN0aW9uWzBdWzFdICsgaGFuZGxlU2l6ZSA6IGhhbmRsZVNpemU7IH0pO1xuICAgIH1cblxuICAgIGVsc2Uge1xuICAgICAgZ3JvdXAuc2VsZWN0QWxsKFwiLnNlbGVjdGlvbiwuaGFuZGxlXCIpXG4gICAgICAgICAgLnN0eWxlKFwiZGlzcGxheVwiLCBcIm5vbmVcIilcbiAgICAgICAgICAuYXR0cihcInhcIiwgbnVsbClcbiAgICAgICAgICAuYXR0cihcInlcIiwgbnVsbClcbiAgICAgICAgICAuYXR0cihcIndpZHRoXCIsIG51bGwpXG4gICAgICAgICAgLmF0dHIoXCJoZWlnaHRcIiwgbnVsbCk7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gZW1pdHRlcih0aGF0LCBhcmdzLCBjbGVhbikge1xuICAgIHZhciBlbWl0ID0gdGhhdC5fX2JydXNoLmVtaXR0ZXI7XG4gICAgcmV0dXJuIGVtaXQgJiYgKCFjbGVhbiB8fCAhZW1pdC5jbGVhbikgPyBlbWl0IDogbmV3IEVtaXR0ZXIodGhhdCwgYXJncywgY2xlYW4pO1xuICB9XG5cbiAgZnVuY3Rpb24gRW1pdHRlcih0aGF0LCBhcmdzLCBjbGVhbikge1xuICAgIHRoaXMudGhhdCA9IHRoYXQ7XG4gICAgdGhpcy5hcmdzID0gYXJncztcbiAgICB0aGlzLnN0YXRlID0gdGhhdC5fX2JydXNoO1xuICAgIHRoaXMuYWN0aXZlID0gMDtcbiAgICB0aGlzLmNsZWFuID0gY2xlYW47XG4gIH1cblxuICBFbWl0dGVyLnByb3RvdHlwZSA9IHtcbiAgICBiZWZvcmVzdGFydDogZnVuY3Rpb24oKSB7XG4gICAgICBpZiAoKyt0aGlzLmFjdGl2ZSA9PT0gMSkgdGhpcy5zdGF0ZS5lbWl0dGVyID0gdGhpcywgdGhpcy5zdGFydGluZyA9IHRydWU7XG4gICAgICByZXR1cm4gdGhpcztcbiAgICB9LFxuICAgIHN0YXJ0OiBmdW5jdGlvbihldmVudCwgbW9kZSkge1xuICAgICAgaWYgKHRoaXMuc3RhcnRpbmcpIHRoaXMuc3RhcnRpbmcgPSBmYWxzZSwgdGhpcy5lbWl0KFwic3RhcnRcIiwgZXZlbnQsIG1vZGUpO1xuICAgICAgZWxzZSB0aGlzLmVtaXQoXCJicnVzaFwiLCBldmVudCk7XG4gICAgICByZXR1cm4gdGhpcztcbiAgICB9LFxuICAgIGJydXNoOiBmdW5jdGlvbihldmVudCwgbW9kZSkge1xuICAgICAgdGhpcy5lbWl0KFwiYnJ1c2hcIiwgZXZlbnQsIG1vZGUpO1xuICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfSxcbiAgICBlbmQ6IGZ1bmN0aW9uKGV2ZW50LCBtb2RlKSB7XG4gICAgICBpZiAoLS10aGlzLmFjdGl2ZSA9PT0gMCkgZGVsZXRlIHRoaXMuc3RhdGUuZW1pdHRlciwgdGhpcy5lbWl0KFwiZW5kXCIsIGV2ZW50LCBtb2RlKTtcbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH0sXG4gICAgZW1pdDogZnVuY3Rpb24odHlwZSwgZXZlbnQsIG1vZGUpIHtcbiAgICAgIHZhciBkID0gc2VsZWN0KHRoaXMudGhhdCkuZGF0dW0oKTtcbiAgICAgIGxpc3RlbmVycy5jYWxsKFxuICAgICAgICB0eXBlLFxuICAgICAgICB0aGlzLnRoYXQsXG4gICAgICAgIG5ldyBCcnVzaEV2ZW50KHR5cGUsIHtcbiAgICAgICAgICBzb3VyY2VFdmVudDogZXZlbnQsXG4gICAgICAgICAgdGFyZ2V0OiBicnVzaCxcbiAgICAgICAgICBzZWxlY3Rpb246IGRpbS5vdXRwdXQodGhpcy5zdGF0ZS5zZWxlY3Rpb24pLFxuICAgICAgICAgIG1vZGUsXG4gICAgICAgICAgZGlzcGF0Y2g6IGxpc3RlbmVyc1xuICAgICAgICB9KSxcbiAgICAgICAgZFxuICAgICAgKTtcbiAgICB9XG4gIH07XG5cbiAgZnVuY3Rpb24gc3RhcnRlZChldmVudCkge1xuICAgIGlmICh0b3VjaGVuZGluZyAmJiAhZXZlbnQudG91Y2hlcykgcmV0dXJuO1xuICAgIGlmICghZmlsdGVyLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykpIHJldHVybjtcblxuICAgIHZhciB0aGF0ID0gdGhpcyxcbiAgICAgICAgdHlwZSA9IGV2ZW50LnRhcmdldC5fX2RhdGFfXy50eXBlLFxuICAgICAgICBtb2RlID0gKGtleXMgJiYgZXZlbnQubWV0YUtleSA/IHR5cGUgPSBcIm92ZXJsYXlcIiA6IHR5cGUpID09PSBcInNlbGVjdGlvblwiID8gTU9ERV9EUkFHIDogKGtleXMgJiYgZXZlbnQuYWx0S2V5ID8gTU9ERV9DRU5URVIgOiBNT0RFX0hBTkRMRSksXG4gICAgICAgIHNpZ25YID0gZGltID09PSBZID8gbnVsbCA6IHNpZ25zWFt0eXBlXSxcbiAgICAgICAgc2lnblkgPSBkaW0gPT09IFggPyBudWxsIDogc2lnbnNZW3R5cGVdLFxuICAgICAgICBzdGF0ZSA9IGxvY2FsKHRoYXQpLFxuICAgICAgICBleHRlbnQgPSBzdGF0ZS5leHRlbnQsXG4gICAgICAgIHNlbGVjdGlvbiA9IHN0YXRlLnNlbGVjdGlvbixcbiAgICAgICAgVyA9IGV4dGVudFswXVswXSwgdzAsIHcxLFxuICAgICAgICBOID0gZXh0ZW50WzBdWzFdLCBuMCwgbjEsXG4gICAgICAgIEUgPSBleHRlbnRbMV1bMF0sIGUwLCBlMSxcbiAgICAgICAgUyA9IGV4dGVudFsxXVsxXSwgczAsIHMxLFxuICAgICAgICBkeCA9IDAsXG4gICAgICAgIGR5ID0gMCxcbiAgICAgICAgbW92aW5nLFxuICAgICAgICBzaGlmdGluZyA9IHNpZ25YICYmIHNpZ25ZICYmIGtleXMgJiYgZXZlbnQuc2hpZnRLZXksXG4gICAgICAgIGxvY2tYLFxuICAgICAgICBsb2NrWSxcbiAgICAgICAgcG9pbnRzID0gQXJyYXkuZnJvbShldmVudC50b3VjaGVzIHx8IFtldmVudF0sIHQgPT4ge1xuICAgICAgICAgIGNvbnN0IGkgPSB0LmlkZW50aWZpZXI7XG4gICAgICAgICAgdCA9IHBvaW50ZXIodCwgdGhhdCk7XG4gICAgICAgICAgdC5wb2ludDAgPSB0LnNsaWNlKCk7XG4gICAgICAgICAgdC5pZGVudGlmaWVyID0gaTtcbiAgICAgICAgICByZXR1cm4gdDtcbiAgICAgICAgfSk7XG5cbiAgICBpbnRlcnJ1cHQodGhhdCk7XG4gICAgdmFyIGVtaXQgPSBlbWl0dGVyKHRoYXQsIGFyZ3VtZW50cywgdHJ1ZSkuYmVmb3Jlc3RhcnQoKTtcblxuICAgIGlmICh0eXBlID09PSBcIm92ZXJsYXlcIikge1xuICAgICAgaWYgKHNlbGVjdGlvbikgbW92aW5nID0gdHJ1ZTtcbiAgICAgIGNvbnN0IHB0cyA9IFtwb2ludHNbMF0sIHBvaW50c1sxXSB8fCBwb2ludHNbMF1dO1xuICAgICAgc3RhdGUuc2VsZWN0aW9uID0gc2VsZWN0aW9uID0gW1tcbiAgICAgICAgICB3MCA9IGRpbSA9PT0gWSA/IFcgOiBtaW4ocHRzWzBdWzBdLCBwdHNbMV1bMF0pLFxuICAgICAgICAgIG4wID0gZGltID09PSBYID8gTiA6IG1pbihwdHNbMF1bMV0sIHB0c1sxXVsxXSlcbiAgICAgICAgXSwgW1xuICAgICAgICAgIGUwID0gZGltID09PSBZID8gRSA6IG1heChwdHNbMF1bMF0sIHB0c1sxXVswXSksXG4gICAgICAgICAgczAgPSBkaW0gPT09IFggPyBTIDogbWF4KHB0c1swXVsxXSwgcHRzWzFdWzFdKVxuICAgICAgICBdXTtcbiAgICAgIGlmIChwb2ludHMubGVuZ3RoID4gMSkgbW92ZShldmVudCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHcwID0gc2VsZWN0aW9uWzBdWzBdO1xuICAgICAgbjAgPSBzZWxlY3Rpb25bMF1bMV07XG4gICAgICBlMCA9IHNlbGVjdGlvblsxXVswXTtcbiAgICAgIHMwID0gc2VsZWN0aW9uWzFdWzFdO1xuICAgIH1cblxuICAgIHcxID0gdzA7XG4gICAgbjEgPSBuMDtcbiAgICBlMSA9IGUwO1xuICAgIHMxID0gczA7XG5cbiAgICB2YXIgZ3JvdXAgPSBzZWxlY3QodGhhdClcbiAgICAgICAgLmF0dHIoXCJwb2ludGVyLWV2ZW50c1wiLCBcIm5vbmVcIik7XG5cbiAgICB2YXIgb3ZlcmxheSA9IGdyb3VwLnNlbGVjdEFsbChcIi5vdmVybGF5XCIpXG4gICAgICAgIC5hdHRyKFwiY3Vyc29yXCIsIGN1cnNvcnNbdHlwZV0pO1xuXG4gICAgaWYgKGV2ZW50LnRvdWNoZXMpIHtcbiAgICAgIGVtaXQubW92ZWQgPSBtb3ZlZDtcbiAgICAgIGVtaXQuZW5kZWQgPSBlbmRlZDtcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIHZpZXcgPSBzZWxlY3QoZXZlbnQudmlldylcbiAgICAgICAgICAub24oXCJtb3VzZW1vdmUuYnJ1c2hcIiwgbW92ZWQsIHRydWUpXG4gICAgICAgICAgLm9uKFwibW91c2V1cC5icnVzaFwiLCBlbmRlZCwgdHJ1ZSk7XG4gICAgICBpZiAoa2V5cykgdmlld1xuICAgICAgICAgIC5vbihcImtleWRvd24uYnJ1c2hcIiwga2V5ZG93bmVkLCB0cnVlKVxuICAgICAgICAgIC5vbihcImtleXVwLmJydXNoXCIsIGtleXVwcGVkLCB0cnVlKVxuXG4gICAgICBkcmFnRGlzYWJsZShldmVudC52aWV3KTtcbiAgICB9XG5cbiAgICByZWRyYXcuY2FsbCh0aGF0KTtcbiAgICBlbWl0LnN0YXJ0KGV2ZW50LCBtb2RlLm5hbWUpO1xuXG4gICAgZnVuY3Rpb24gbW92ZWQoZXZlbnQpIHtcbiAgICAgIGZvciAoY29uc3QgcCBvZiBldmVudC5jaGFuZ2VkVG91Y2hlcyB8fCBbZXZlbnRdKSB7XG4gICAgICAgIGZvciAoY29uc3QgZCBvZiBwb2ludHMpXG4gICAgICAgICAgaWYgKGQuaWRlbnRpZmllciA9PT0gcC5pZGVudGlmaWVyKSBkLmN1ciA9IHBvaW50ZXIocCwgdGhhdCk7XG4gICAgICB9XG4gICAgICBpZiAoc2hpZnRpbmcgJiYgIWxvY2tYICYmICFsb2NrWSAmJiBwb2ludHMubGVuZ3RoID09PSAxKSB7XG4gICAgICAgIGNvbnN0IHBvaW50ID0gcG9pbnRzWzBdO1xuICAgICAgICBpZiAoYWJzKHBvaW50LmN1clswXSAtIHBvaW50WzBdKSA+IGFicyhwb2ludC5jdXJbMV0gLSBwb2ludFsxXSkpXG4gICAgICAgICAgbG9ja1kgPSB0cnVlO1xuICAgICAgICBlbHNlXG4gICAgICAgICAgbG9ja1ggPSB0cnVlO1xuICAgICAgfVxuICAgICAgZm9yIChjb25zdCBwb2ludCBvZiBwb2ludHMpXG4gICAgICAgIGlmIChwb2ludC5jdXIpIHBvaW50WzBdID0gcG9pbnQuY3VyWzBdLCBwb2ludFsxXSA9IHBvaW50LmN1clsxXTtcbiAgICAgIG1vdmluZyA9IHRydWU7XG4gICAgICBub2V2ZW50KGV2ZW50KTtcbiAgICAgIG1vdmUoZXZlbnQpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG1vdmUoZXZlbnQpIHtcbiAgICAgIGNvbnN0IHBvaW50ID0gcG9pbnRzWzBdLCBwb2ludDAgPSBwb2ludC5wb2ludDA7XG4gICAgICB2YXIgdDtcblxuICAgICAgZHggPSBwb2ludFswXSAtIHBvaW50MFswXTtcbiAgICAgIGR5ID0gcG9pbnRbMV0gLSBwb2ludDBbMV07XG5cbiAgICAgIHN3aXRjaCAobW9kZSkge1xuICAgICAgICBjYXNlIE1PREVfU1BBQ0U6XG4gICAgICAgIGNhc2UgTU9ERV9EUkFHOiB7XG4gICAgICAgICAgaWYgKHNpZ25YKSBkeCA9IG1heChXIC0gdzAsIG1pbihFIC0gZTAsIGR4KSksIHcxID0gdzAgKyBkeCwgZTEgPSBlMCArIGR4O1xuICAgICAgICAgIGlmIChzaWduWSkgZHkgPSBtYXgoTiAtIG4wLCBtaW4oUyAtIHMwLCBkeSkpLCBuMSA9IG4wICsgZHksIHMxID0gczAgKyBkeTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjYXNlIE1PREVfSEFORExFOiB7XG4gICAgICAgICAgaWYgKHBvaW50c1sxXSkge1xuICAgICAgICAgICAgaWYgKHNpZ25YKSB3MSA9IG1heChXLCBtaW4oRSwgcG9pbnRzWzBdWzBdKSksIGUxID0gbWF4KFcsIG1pbihFLCBwb2ludHNbMV1bMF0pKSwgc2lnblggPSAxO1xuICAgICAgICAgICAgaWYgKHNpZ25ZKSBuMSA9IG1heChOLCBtaW4oUywgcG9pbnRzWzBdWzFdKSksIHMxID0gbWF4KE4sIG1pbihTLCBwb2ludHNbMV1bMV0pKSwgc2lnblkgPSAxO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpZiAoc2lnblggPCAwKSBkeCA9IG1heChXIC0gdzAsIG1pbihFIC0gdzAsIGR4KSksIHcxID0gdzAgKyBkeCwgZTEgPSBlMDtcbiAgICAgICAgICAgIGVsc2UgaWYgKHNpZ25YID4gMCkgZHggPSBtYXgoVyAtIGUwLCBtaW4oRSAtIGUwLCBkeCkpLCB3MSA9IHcwLCBlMSA9IGUwICsgZHg7XG4gICAgICAgICAgICBpZiAoc2lnblkgPCAwKSBkeSA9IG1heChOIC0gbjAsIG1pbihTIC0gbjAsIGR5KSksIG4xID0gbjAgKyBkeSwgczEgPSBzMDtcbiAgICAgICAgICAgIGVsc2UgaWYgKHNpZ25ZID4gMCkgZHkgPSBtYXgoTiAtIHMwLCBtaW4oUyAtIHMwLCBkeSkpLCBuMSA9IG4wLCBzMSA9IHMwICsgZHk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGNhc2UgTU9ERV9DRU5URVI6IHtcbiAgICAgICAgICBpZiAoc2lnblgpIHcxID0gbWF4KFcsIG1pbihFLCB3MCAtIGR4ICogc2lnblgpKSwgZTEgPSBtYXgoVywgbWluKEUsIGUwICsgZHggKiBzaWduWCkpO1xuICAgICAgICAgIGlmIChzaWduWSkgbjEgPSBtYXgoTiwgbWluKFMsIG4wIC0gZHkgKiBzaWduWSkpLCBzMSA9IG1heChOLCBtaW4oUywgczAgKyBkeSAqIHNpZ25ZKSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKGUxIDwgdzEpIHtcbiAgICAgICAgc2lnblggKj0gLTE7XG4gICAgICAgIHQgPSB3MCwgdzAgPSBlMCwgZTAgPSB0O1xuICAgICAgICB0ID0gdzEsIHcxID0gZTEsIGUxID0gdDtcbiAgICAgICAgaWYgKHR5cGUgaW4gZmxpcFgpIG92ZXJsYXkuYXR0cihcImN1cnNvclwiLCBjdXJzb3JzW3R5cGUgPSBmbGlwWFt0eXBlXV0pO1xuICAgICAgfVxuXG4gICAgICBpZiAoczEgPCBuMSkge1xuICAgICAgICBzaWduWSAqPSAtMTtcbiAgICAgICAgdCA9IG4wLCBuMCA9IHMwLCBzMCA9IHQ7XG4gICAgICAgIHQgPSBuMSwgbjEgPSBzMSwgczEgPSB0O1xuICAgICAgICBpZiAodHlwZSBpbiBmbGlwWSkgb3ZlcmxheS5hdHRyKFwiY3Vyc29yXCIsIGN1cnNvcnNbdHlwZSA9IGZsaXBZW3R5cGVdXSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChzdGF0ZS5zZWxlY3Rpb24pIHNlbGVjdGlvbiA9IHN0YXRlLnNlbGVjdGlvbjsgLy8gTWF5IGJlIHNldCBieSBicnVzaC5tb3ZlIVxuICAgICAgaWYgKGxvY2tYKSB3MSA9IHNlbGVjdGlvblswXVswXSwgZTEgPSBzZWxlY3Rpb25bMV1bMF07XG4gICAgICBpZiAobG9ja1kpIG4xID0gc2VsZWN0aW9uWzBdWzFdLCBzMSA9IHNlbGVjdGlvblsxXVsxXTtcblxuICAgICAgaWYgKHNlbGVjdGlvblswXVswXSAhPT0gdzFcbiAgICAgICAgICB8fCBzZWxlY3Rpb25bMF1bMV0gIT09IG4xXG4gICAgICAgICAgfHwgc2VsZWN0aW9uWzFdWzBdICE9PSBlMVxuICAgICAgICAgIHx8IHNlbGVjdGlvblsxXVsxXSAhPT0gczEpIHtcbiAgICAgICAgc3RhdGUuc2VsZWN0aW9uID0gW1t3MSwgbjFdLCBbZTEsIHMxXV07XG4gICAgICAgIHJlZHJhdy5jYWxsKHRoYXQpO1xuICAgICAgICBlbWl0LmJydXNoKGV2ZW50LCBtb2RlLm5hbWUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGVuZGVkKGV2ZW50KSB7XG4gICAgICBub3Byb3BhZ2F0aW9uKGV2ZW50KTtcbiAgICAgIGlmIChldmVudC50b3VjaGVzKSB7XG4gICAgICAgIGlmIChldmVudC50b3VjaGVzLmxlbmd0aCkgcmV0dXJuO1xuICAgICAgICBpZiAodG91Y2hlbmRpbmcpIGNsZWFyVGltZW91dCh0b3VjaGVuZGluZyk7XG4gICAgICAgIHRvdWNoZW5kaW5nID0gc2V0VGltZW91dChmdW5jdGlvbigpIHsgdG91Y2hlbmRpbmcgPSBudWxsOyB9LCA1MDApOyAvLyBHaG9zdCBjbGlja3MgYXJlIGRlbGF5ZWQhXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkcmFnRW5hYmxlKGV2ZW50LnZpZXcsIG1vdmluZyk7XG4gICAgICAgIHZpZXcub24oXCJrZXlkb3duLmJydXNoIGtleXVwLmJydXNoIG1vdXNlbW92ZS5icnVzaCBtb3VzZXVwLmJydXNoXCIsIG51bGwpO1xuICAgICAgfVxuICAgICAgZ3JvdXAuYXR0cihcInBvaW50ZXItZXZlbnRzXCIsIFwiYWxsXCIpO1xuICAgICAgb3ZlcmxheS5hdHRyKFwiY3Vyc29yXCIsIGN1cnNvcnMub3ZlcmxheSk7XG4gICAgICBpZiAoc3RhdGUuc2VsZWN0aW9uKSBzZWxlY3Rpb24gPSBzdGF0ZS5zZWxlY3Rpb247IC8vIE1heSBiZSBzZXQgYnkgYnJ1c2gubW92ZSAob24gc3RhcnQpIVxuICAgICAgaWYgKGVtcHR5KHNlbGVjdGlvbikpIHN0YXRlLnNlbGVjdGlvbiA9IG51bGwsIHJlZHJhdy5jYWxsKHRoYXQpO1xuICAgICAgZW1pdC5lbmQoZXZlbnQsIG1vZGUubmFtZSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24ga2V5ZG93bmVkKGV2ZW50KSB7XG4gICAgICBzd2l0Y2ggKGV2ZW50LmtleUNvZGUpIHtcbiAgICAgICAgY2FzZSAxNjogeyAvLyBTSElGVFxuICAgICAgICAgIHNoaWZ0aW5nID0gc2lnblggJiYgc2lnblk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgY2FzZSAxODogeyAvLyBBTFRcbiAgICAgICAgICBpZiAobW9kZSA9PT0gTU9ERV9IQU5ETEUpIHtcbiAgICAgICAgICAgIGlmIChzaWduWCkgZTAgPSBlMSAtIGR4ICogc2lnblgsIHcwID0gdzEgKyBkeCAqIHNpZ25YO1xuICAgICAgICAgICAgaWYgKHNpZ25ZKSBzMCA9IHMxIC0gZHkgKiBzaWduWSwgbjAgPSBuMSArIGR5ICogc2lnblk7XG4gICAgICAgICAgICBtb2RlID0gTU9ERV9DRU5URVI7XG4gICAgICAgICAgICBtb3ZlKGV2ZW50KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgY2FzZSAzMjogeyAvLyBTUEFDRTsgdGFrZXMgcHJpb3JpdHkgb3ZlciBBTFRcbiAgICAgICAgICBpZiAobW9kZSA9PT0gTU9ERV9IQU5ETEUgfHwgbW9kZSA9PT0gTU9ERV9DRU5URVIpIHtcbiAgICAgICAgICAgIGlmIChzaWduWCA8IDApIGUwID0gZTEgLSBkeDsgZWxzZSBpZiAoc2lnblggPiAwKSB3MCA9IHcxIC0gZHg7XG4gICAgICAgICAgICBpZiAoc2lnblkgPCAwKSBzMCA9IHMxIC0gZHk7IGVsc2UgaWYgKHNpZ25ZID4gMCkgbjAgPSBuMSAtIGR5O1xuICAgICAgICAgICAgbW9kZSA9IE1PREVfU1BBQ0U7XG4gICAgICAgICAgICBvdmVybGF5LmF0dHIoXCJjdXJzb3JcIiwgY3Vyc29ycy5zZWxlY3Rpb24pO1xuICAgICAgICAgICAgbW92ZShldmVudCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGRlZmF1bHQ6IHJldHVybjtcbiAgICAgIH1cbiAgICAgIG5vZXZlbnQoZXZlbnQpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGtleXVwcGVkKGV2ZW50KSB7XG4gICAgICBzd2l0Y2ggKGV2ZW50LmtleUNvZGUpIHtcbiAgICAgICAgY2FzZSAxNjogeyAvLyBTSElGVFxuICAgICAgICAgIGlmIChzaGlmdGluZykge1xuICAgICAgICAgICAgbG9ja1ggPSBsb2NrWSA9IHNoaWZ0aW5nID0gZmFsc2U7XG4gICAgICAgICAgICBtb3ZlKGV2ZW50KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgY2FzZSAxODogeyAvLyBBTFRcbiAgICAgICAgICBpZiAobW9kZSA9PT0gTU9ERV9DRU5URVIpIHtcbiAgICAgICAgICAgIGlmIChzaWduWCA8IDApIGUwID0gZTE7IGVsc2UgaWYgKHNpZ25YID4gMCkgdzAgPSB3MTtcbiAgICAgICAgICAgIGlmIChzaWduWSA8IDApIHMwID0gczE7IGVsc2UgaWYgKHNpZ25ZID4gMCkgbjAgPSBuMTtcbiAgICAgICAgICAgIG1vZGUgPSBNT0RFX0hBTkRMRTtcbiAgICAgICAgICAgIG1vdmUoZXZlbnQpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjYXNlIDMyOiB7IC8vIFNQQUNFXG4gICAgICAgICAgaWYgKG1vZGUgPT09IE1PREVfU1BBQ0UpIHtcbiAgICAgICAgICAgIGlmIChldmVudC5hbHRLZXkpIHtcbiAgICAgICAgICAgICAgaWYgKHNpZ25YKSBlMCA9IGUxIC0gZHggKiBzaWduWCwgdzAgPSB3MSArIGR4ICogc2lnblg7XG4gICAgICAgICAgICAgIGlmIChzaWduWSkgczAgPSBzMSAtIGR5ICogc2lnblksIG4wID0gbjEgKyBkeSAqIHNpZ25ZO1xuICAgICAgICAgICAgICBtb2RlID0gTU9ERV9DRU5URVI7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBpZiAoc2lnblggPCAwKSBlMCA9IGUxOyBlbHNlIGlmIChzaWduWCA+IDApIHcwID0gdzE7XG4gICAgICAgICAgICAgIGlmIChzaWduWSA8IDApIHMwID0gczE7IGVsc2UgaWYgKHNpZ25ZID4gMCkgbjAgPSBuMTtcbiAgICAgICAgICAgICAgbW9kZSA9IE1PREVfSEFORExFO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgb3ZlcmxheS5hdHRyKFwiY3Vyc29yXCIsIGN1cnNvcnNbdHlwZV0pO1xuICAgICAgICAgICAgbW92ZShldmVudCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGRlZmF1bHQ6IHJldHVybjtcbiAgICAgIH1cbiAgICAgIG5vZXZlbnQoZXZlbnQpO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHRvdWNobW92ZWQoZXZlbnQpIHtcbiAgICBlbWl0dGVyKHRoaXMsIGFyZ3VtZW50cykubW92ZWQoZXZlbnQpO1xuICB9XG5cbiAgZnVuY3Rpb24gdG91Y2hlbmRlZChldmVudCkge1xuICAgIGVtaXR0ZXIodGhpcywgYXJndW1lbnRzKS5lbmRlZChldmVudCk7XG4gIH1cblxuICBmdW5jdGlvbiBpbml0aWFsaXplKCkge1xuICAgIHZhciBzdGF0ZSA9IHRoaXMuX19icnVzaCB8fCB7c2VsZWN0aW9uOiBudWxsfTtcbiAgICBzdGF0ZS5leHRlbnQgPSBudW1iZXIyKGV4dGVudC5hcHBseSh0aGlzLCBhcmd1bWVudHMpKTtcbiAgICBzdGF0ZS5kaW0gPSBkaW07XG4gICAgcmV0dXJuIHN0YXRlO1xuICB9XG5cbiAgYnJ1c2guZXh0ZW50ID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGV4dGVudCA9IHR5cGVvZiBfID09PSBcImZ1bmN0aW9uXCIgPyBfIDogY29uc3RhbnQobnVtYmVyMihfKSksIGJydXNoKSA6IGV4dGVudDtcbiAgfTtcblxuICBicnVzaC5maWx0ZXIgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoZmlsdGVyID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudCghIV8pLCBicnVzaCkgOiBmaWx0ZXI7XG4gIH07XG5cbiAgYnJ1c2gudG91Y2hhYmxlID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHRvdWNoYWJsZSA9IHR5cGVvZiBfID09PSBcImZ1bmN0aW9uXCIgPyBfIDogY29uc3RhbnQoISFfKSwgYnJ1c2gpIDogdG91Y2hhYmxlO1xuICB9O1xuXG4gIGJydXNoLmhhbmRsZVNpemUgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoaGFuZGxlU2l6ZSA9ICtfLCBicnVzaCkgOiBoYW5kbGVTaXplO1xuICB9O1xuXG4gIGJydXNoLmtleU1vZGlmaWVycyA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChrZXlzID0gISFfLCBicnVzaCkgOiBrZXlzO1xuICB9O1xuXG4gIGJydXNoLm9uID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHZhbHVlID0gbGlzdGVuZXJzLm9uLmFwcGx5KGxpc3RlbmVycywgYXJndW1lbnRzKTtcbiAgICByZXR1cm4gdmFsdWUgPT09IGxpc3RlbmVycyA/IGJydXNoIDogdmFsdWU7XG4gIH07XG5cbiAgcmV0dXJuIGJydXNoO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGQpIHtcbiAgY29uc3QgeCA9ICt0aGlzLl94LmNhbGwobnVsbCwgZCksXG4gICAgICB5ID0gK3RoaXMuX3kuY2FsbChudWxsLCBkKTtcbiAgcmV0dXJuIGFkZCh0aGlzLmNvdmVyKHgsIHkpLCB4LCB5LCBkKTtcbn1cblxuZnVuY3Rpb24gYWRkKHRyZWUsIHgsIHksIGQpIHtcbiAgaWYgKGlzTmFOKHgpIHx8IGlzTmFOKHkpKSByZXR1cm4gdHJlZTsgLy8gaWdub3JlIGludmFsaWQgcG9pbnRzXG5cbiAgdmFyIHBhcmVudCxcbiAgICAgIG5vZGUgPSB0cmVlLl9yb290LFxuICAgICAgbGVhZiA9IHtkYXRhOiBkfSxcbiAgICAgIHgwID0gdHJlZS5feDAsXG4gICAgICB5MCA9IHRyZWUuX3kwLFxuICAgICAgeDEgPSB0cmVlLl94MSxcbiAgICAgIHkxID0gdHJlZS5feTEsXG4gICAgICB4bSxcbiAgICAgIHltLFxuICAgICAgeHAsXG4gICAgICB5cCxcbiAgICAgIHJpZ2h0LFxuICAgICAgYm90dG9tLFxuICAgICAgaSxcbiAgICAgIGo7XG5cbiAgLy8gSWYgdGhlIHRyZWUgaXMgZW1wdHksIGluaXRpYWxpemUgdGhlIHJvb3QgYXMgYSBsZWFmLlxuICBpZiAoIW5vZGUpIHJldHVybiB0cmVlLl9yb290ID0gbGVhZiwgdHJlZTtcblxuICAvLyBGaW5kIHRoZSBleGlzdGluZyBsZWFmIGZvciB0aGUgbmV3IHBvaW50LCBvciBhZGQgaXQuXG4gIHdoaWxlIChub2RlLmxlbmd0aCkge1xuICAgIGlmIChyaWdodCA9IHggPj0gKHhtID0gKHgwICsgeDEpIC8gMikpIHgwID0geG07IGVsc2UgeDEgPSB4bTtcbiAgICBpZiAoYm90dG9tID0geSA+PSAoeW0gPSAoeTAgKyB5MSkgLyAyKSkgeTAgPSB5bTsgZWxzZSB5MSA9IHltO1xuICAgIGlmIChwYXJlbnQgPSBub2RlLCAhKG5vZGUgPSBub2RlW2kgPSBib3R0b20gPDwgMSB8IHJpZ2h0XSkpIHJldHVybiBwYXJlbnRbaV0gPSBsZWFmLCB0cmVlO1xuICB9XG5cbiAgLy8gSXMgdGhlIG5ldyBwb2ludCBpcyBleGFjdGx5IGNvaW5jaWRlbnQgd2l0aCB0aGUgZXhpc3RpbmcgcG9pbnQ/XG4gIHhwID0gK3RyZWUuX3guY2FsbChudWxsLCBub2RlLmRhdGEpO1xuICB5cCA9ICt0cmVlLl95LmNhbGwobnVsbCwgbm9kZS5kYXRhKTtcbiAgaWYgKHggPT09IHhwICYmIHkgPT09IHlwKSByZXR1cm4gbGVhZi5uZXh0ID0gbm9kZSwgcGFyZW50ID8gcGFyZW50W2ldID0gbGVhZiA6IHRyZWUuX3Jvb3QgPSBsZWFmLCB0cmVlO1xuXG4gIC8vIE90aGVyd2lzZSwgc3BsaXQgdGhlIGxlYWYgbm9kZSB1bnRpbCB0aGUgb2xkIGFuZCBuZXcgcG9pbnQgYXJlIHNlcGFyYXRlZC5cbiAgZG8ge1xuICAgIHBhcmVudCA9IHBhcmVudCA/IHBhcmVudFtpXSA9IG5ldyBBcnJheSg0KSA6IHRyZWUuX3Jvb3QgPSBuZXcgQXJyYXkoNCk7XG4gICAgaWYgKHJpZ2h0ID0geCA+PSAoeG0gPSAoeDAgKyB4MSkgLyAyKSkgeDAgPSB4bTsgZWxzZSB4MSA9IHhtO1xuICAgIGlmIChib3R0b20gPSB5ID49ICh5bSA9ICh5MCArIHkxKSAvIDIpKSB5MCA9IHltOyBlbHNlIHkxID0geW07XG4gIH0gd2hpbGUgKChpID0gYm90dG9tIDw8IDEgfCByaWdodCkgPT09IChqID0gKHlwID49IHltKSA8PCAxIHwgKHhwID49IHhtKSkpO1xuICByZXR1cm4gcGFyZW50W2pdID0gbm9kZSwgcGFyZW50W2ldID0gbGVhZiwgdHJlZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFkZEFsbChkYXRhKSB7XG4gIHZhciBkLCBpLCBuID0gZGF0YS5sZW5ndGgsXG4gICAgICB4LFxuICAgICAgeSxcbiAgICAgIHh6ID0gbmV3IEFycmF5KG4pLFxuICAgICAgeXogPSBuZXcgQXJyYXkobiksXG4gICAgICB4MCA9IEluZmluaXR5LFxuICAgICAgeTAgPSBJbmZpbml0eSxcbiAgICAgIHgxID0gLUluZmluaXR5LFxuICAgICAgeTEgPSAtSW5maW5pdHk7XG5cbiAgLy8gQ29tcHV0ZSB0aGUgcG9pbnRzIGFuZCB0aGVpciBleHRlbnQuXG4gIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICBpZiAoaXNOYU4oeCA9ICt0aGlzLl94LmNhbGwobnVsbCwgZCA9IGRhdGFbaV0pKSB8fCBpc05hTih5ID0gK3RoaXMuX3kuY2FsbChudWxsLCBkKSkpIGNvbnRpbnVlO1xuICAgIHh6W2ldID0geDtcbiAgICB5eltpXSA9IHk7XG4gICAgaWYgKHggPCB4MCkgeDAgPSB4O1xuICAgIGlmICh4ID4geDEpIHgxID0geDtcbiAgICBpZiAoeSA8IHkwKSB5MCA9IHk7XG4gICAgaWYgKHkgPiB5MSkgeTEgPSB5O1xuICB9XG5cbiAgLy8gSWYgdGhlcmUgd2VyZSBubyAodmFsaWQpIHBvaW50cywgYWJvcnQuXG4gIGlmICh4MCA+IHgxIHx8IHkwID4geTEpIHJldHVybiB0aGlzO1xuXG4gIC8vIEV4cGFuZCB0aGUgdHJlZSB0byBjb3ZlciB0aGUgbmV3IHBvaW50cy5cbiAgdGhpcy5jb3Zlcih4MCwgeTApLmNvdmVyKHgxLCB5MSk7XG5cbiAgLy8gQWRkIHRoZSBuZXcgcG9pbnRzLlxuICBmb3IgKGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgYWRkKHRoaXMsIHh6W2ldLCB5eltpXSwgZGF0YVtpXSk7XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbih4LCB5KSB7XG4gIGlmIChpc05hTih4ID0gK3gpIHx8IGlzTmFOKHkgPSAreSkpIHJldHVybiB0aGlzOyAvLyBpZ25vcmUgaW52YWxpZCBwb2ludHNcblxuICB2YXIgeDAgPSB0aGlzLl94MCxcbiAgICAgIHkwID0gdGhpcy5feTAsXG4gICAgICB4MSA9IHRoaXMuX3gxLFxuICAgICAgeTEgPSB0aGlzLl95MTtcblxuICAvLyBJZiB0aGUgcXVhZHRyZWUgaGFzIG5vIGV4dGVudCwgaW5pdGlhbGl6ZSB0aGVtLlxuICAvLyBJbnRlZ2VyIGV4dGVudCBhcmUgbmVjZXNzYXJ5IHNvIHRoYXQgaWYgd2UgbGF0ZXIgZG91YmxlIHRoZSBleHRlbnQsXG4gIC8vIHRoZSBleGlzdGluZyBxdWFkcmFudCBib3VuZGFyaWVzIGRvblx1MjAxOXQgY2hhbmdlIGR1ZSB0byBmbG9hdGluZyBwb2ludCBlcnJvciFcbiAgaWYgKGlzTmFOKHgwKSkge1xuICAgIHgxID0gKHgwID0gTWF0aC5mbG9vcih4KSkgKyAxO1xuICAgIHkxID0gKHkwID0gTWF0aC5mbG9vcih5KSkgKyAxO1xuICB9XG5cbiAgLy8gT3RoZXJ3aXNlLCBkb3VibGUgcmVwZWF0ZWRseSB0byBjb3Zlci5cbiAgZWxzZSB7XG4gICAgdmFyIHogPSB4MSAtIHgwIHx8IDEsXG4gICAgICAgIG5vZGUgPSB0aGlzLl9yb290LFxuICAgICAgICBwYXJlbnQsXG4gICAgICAgIGk7XG5cbiAgICB3aGlsZSAoeDAgPiB4IHx8IHggPj0geDEgfHwgeTAgPiB5IHx8IHkgPj0geTEpIHtcbiAgICAgIGkgPSAoeSA8IHkwKSA8PCAxIHwgKHggPCB4MCk7XG4gICAgICBwYXJlbnQgPSBuZXcgQXJyYXkoNCksIHBhcmVudFtpXSA9IG5vZGUsIG5vZGUgPSBwYXJlbnQsIHogKj0gMjtcbiAgICAgIHN3aXRjaCAoaSkge1xuICAgICAgICBjYXNlIDA6IHgxID0geDAgKyB6LCB5MSA9IHkwICsgejsgYnJlYWs7XG4gICAgICAgIGNhc2UgMTogeDAgPSB4MSAtIHosIHkxID0geTAgKyB6OyBicmVhaztcbiAgICAgICAgY2FzZSAyOiB4MSA9IHgwICsgeiwgeTAgPSB5MSAtIHo7IGJyZWFrO1xuICAgICAgICBjYXNlIDM6IHgwID0geDEgLSB6LCB5MCA9IHkxIC0gejsgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX3Jvb3QgJiYgdGhpcy5fcm9vdC5sZW5ndGgpIHRoaXMuX3Jvb3QgPSBub2RlO1xuICB9XG5cbiAgdGhpcy5feDAgPSB4MDtcbiAgdGhpcy5feTAgPSB5MDtcbiAgdGhpcy5feDEgPSB4MTtcbiAgdGhpcy5feTEgPSB5MTtcbiAgcmV0dXJuIHRoaXM7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIHZhciBkYXRhID0gW107XG4gIHRoaXMudmlzaXQoZnVuY3Rpb24obm9kZSkge1xuICAgIGlmICghbm9kZS5sZW5ndGgpIGRvIGRhdGEucHVzaChub2RlLmRhdGEpOyB3aGlsZSAobm9kZSA9IG5vZGUubmV4dClcbiAgfSk7XG4gIHJldHVybiBkYXRhO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKF8pIHtcbiAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGhcbiAgICAgID8gdGhpcy5jb3ZlcigrX1swXVswXSwgK19bMF1bMV0pLmNvdmVyKCtfWzFdWzBdLCArX1sxXVsxXSlcbiAgICAgIDogaXNOYU4odGhpcy5feDApID8gdW5kZWZpbmVkIDogW1t0aGlzLl94MCwgdGhpcy5feTBdLCBbdGhpcy5feDEsIHRoaXMuX3kxXV07XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obm9kZSwgeDAsIHkwLCB4MSwgeTEpIHtcbiAgdGhpcy5ub2RlID0gbm9kZTtcbiAgdGhpcy54MCA9IHgwO1xuICB0aGlzLnkwID0geTA7XG4gIHRoaXMueDEgPSB4MTtcbiAgdGhpcy55MSA9IHkxO1xufVxuIiwgImltcG9ydCBRdWFkIGZyb20gXCIuL3F1YWQuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oeCwgeSwgcmFkaXVzKSB7XG4gIHZhciBkYXRhLFxuICAgICAgeDAgPSB0aGlzLl94MCxcbiAgICAgIHkwID0gdGhpcy5feTAsXG4gICAgICB4MSxcbiAgICAgIHkxLFxuICAgICAgeDIsXG4gICAgICB5MixcbiAgICAgIHgzID0gdGhpcy5feDEsXG4gICAgICB5MyA9IHRoaXMuX3kxLFxuICAgICAgcXVhZHMgPSBbXSxcbiAgICAgIG5vZGUgPSB0aGlzLl9yb290LFxuICAgICAgcSxcbiAgICAgIGk7XG5cbiAgaWYgKG5vZGUpIHF1YWRzLnB1c2gobmV3IFF1YWQobm9kZSwgeDAsIHkwLCB4MywgeTMpKTtcbiAgaWYgKHJhZGl1cyA9PSBudWxsKSByYWRpdXMgPSBJbmZpbml0eTtcbiAgZWxzZSB7XG4gICAgeDAgPSB4IC0gcmFkaXVzLCB5MCA9IHkgLSByYWRpdXM7XG4gICAgeDMgPSB4ICsgcmFkaXVzLCB5MyA9IHkgKyByYWRpdXM7XG4gICAgcmFkaXVzICo9IHJhZGl1cztcbiAgfVxuXG4gIHdoaWxlIChxID0gcXVhZHMucG9wKCkpIHtcblxuICAgIC8vIFN0b3Agc2VhcmNoaW5nIGlmIHRoaXMgcXVhZHJhbnQgY2FuXHUyMDE5dCBjb250YWluIGEgY2xvc2VyIG5vZGUuXG4gICAgaWYgKCEobm9kZSA9IHEubm9kZSlcbiAgICAgICAgfHwgKHgxID0gcS54MCkgPiB4M1xuICAgICAgICB8fCAoeTEgPSBxLnkwKSA+IHkzXG4gICAgICAgIHx8ICh4MiA9IHEueDEpIDwgeDBcbiAgICAgICAgfHwgKHkyID0gcS55MSkgPCB5MCkgY29udGludWU7XG5cbiAgICAvLyBCaXNlY3QgdGhlIGN1cnJlbnQgcXVhZHJhbnQuXG4gICAgaWYgKG5vZGUubGVuZ3RoKSB7XG4gICAgICB2YXIgeG0gPSAoeDEgKyB4MikgLyAyLFxuICAgICAgICAgIHltID0gKHkxICsgeTIpIC8gMjtcblxuICAgICAgcXVhZHMucHVzaChcbiAgICAgICAgbmV3IFF1YWQobm9kZVszXSwgeG0sIHltLCB4MiwgeTIpLFxuICAgICAgICBuZXcgUXVhZChub2RlWzJdLCB4MSwgeW0sIHhtLCB5MiksXG4gICAgICAgIG5ldyBRdWFkKG5vZGVbMV0sIHhtLCB5MSwgeDIsIHltKSxcbiAgICAgICAgbmV3IFF1YWQobm9kZVswXSwgeDEsIHkxLCB4bSwgeW0pXG4gICAgICApO1xuXG4gICAgICAvLyBWaXNpdCB0aGUgY2xvc2VzdCBxdWFkcmFudCBmaXJzdC5cbiAgICAgIGlmIChpID0gKHkgPj0geW0pIDw8IDEgfCAoeCA+PSB4bSkpIHtcbiAgICAgICAgcSA9IHF1YWRzW3F1YWRzLmxlbmd0aCAtIDFdO1xuICAgICAgICBxdWFkc1txdWFkcy5sZW5ndGggLSAxXSA9IHF1YWRzW3F1YWRzLmxlbmd0aCAtIDEgLSBpXTtcbiAgICAgICAgcXVhZHNbcXVhZHMubGVuZ3RoIC0gMSAtIGldID0gcTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBWaXNpdCB0aGlzIHBvaW50LiAoVmlzaXRpbmcgY29pbmNpZGVudCBwb2ludHMgaXNuXHUyMDE5dCBuZWNlc3NhcnkhKVxuICAgIGVsc2Uge1xuICAgICAgdmFyIGR4ID0geCAtICt0aGlzLl94LmNhbGwobnVsbCwgbm9kZS5kYXRhKSxcbiAgICAgICAgICBkeSA9IHkgLSArdGhpcy5feS5jYWxsKG51bGwsIG5vZGUuZGF0YSksXG4gICAgICAgICAgZDIgPSBkeCAqIGR4ICsgZHkgKiBkeTtcbiAgICAgIGlmIChkMiA8IHJhZGl1cykge1xuICAgICAgICB2YXIgZCA9IE1hdGguc3FydChyYWRpdXMgPSBkMik7XG4gICAgICAgIHgwID0geCAtIGQsIHkwID0geSAtIGQ7XG4gICAgICAgIHgzID0geCArIGQsIHkzID0geSArIGQ7XG4gICAgICAgIGRhdGEgPSBub2RlLmRhdGE7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGRhdGE7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oZCkge1xuICBpZiAoaXNOYU4oeCA9ICt0aGlzLl94LmNhbGwobnVsbCwgZCkpIHx8IGlzTmFOKHkgPSArdGhpcy5feS5jYWxsKG51bGwsIGQpKSkgcmV0dXJuIHRoaXM7IC8vIGlnbm9yZSBpbnZhbGlkIHBvaW50c1xuXG4gIHZhciBwYXJlbnQsXG4gICAgICBub2RlID0gdGhpcy5fcm9vdCxcbiAgICAgIHJldGFpbmVyLFxuICAgICAgcHJldmlvdXMsXG4gICAgICBuZXh0LFxuICAgICAgeDAgPSB0aGlzLl94MCxcbiAgICAgIHkwID0gdGhpcy5feTAsXG4gICAgICB4MSA9IHRoaXMuX3gxLFxuICAgICAgeTEgPSB0aGlzLl95MSxcbiAgICAgIHgsXG4gICAgICB5LFxuICAgICAgeG0sXG4gICAgICB5bSxcbiAgICAgIHJpZ2h0LFxuICAgICAgYm90dG9tLFxuICAgICAgaSxcbiAgICAgIGo7XG5cbiAgLy8gSWYgdGhlIHRyZWUgaXMgZW1wdHksIGluaXRpYWxpemUgdGhlIHJvb3QgYXMgYSBsZWFmLlxuICBpZiAoIW5vZGUpIHJldHVybiB0aGlzO1xuXG4gIC8vIEZpbmQgdGhlIGxlYWYgbm9kZSBmb3IgdGhlIHBvaW50LlxuICAvLyBXaGlsZSBkZXNjZW5kaW5nLCBhbHNvIHJldGFpbiB0aGUgZGVlcGVzdCBwYXJlbnQgd2l0aCBhIG5vbi1yZW1vdmVkIHNpYmxpbmcuXG4gIGlmIChub2RlLmxlbmd0aCkgd2hpbGUgKHRydWUpIHtcbiAgICBpZiAocmlnaHQgPSB4ID49ICh4bSA9ICh4MCArIHgxKSAvIDIpKSB4MCA9IHhtOyBlbHNlIHgxID0geG07XG4gICAgaWYgKGJvdHRvbSA9IHkgPj0gKHltID0gKHkwICsgeTEpIC8gMikpIHkwID0geW07IGVsc2UgeTEgPSB5bTtcbiAgICBpZiAoIShwYXJlbnQgPSBub2RlLCBub2RlID0gbm9kZVtpID0gYm90dG9tIDw8IDEgfCByaWdodF0pKSByZXR1cm4gdGhpcztcbiAgICBpZiAoIW5vZGUubGVuZ3RoKSBicmVhaztcbiAgICBpZiAocGFyZW50WyhpICsgMSkgJiAzXSB8fCBwYXJlbnRbKGkgKyAyKSAmIDNdIHx8IHBhcmVudFsoaSArIDMpICYgM10pIHJldGFpbmVyID0gcGFyZW50LCBqID0gaTtcbiAgfVxuXG4gIC8vIEZpbmQgdGhlIHBvaW50IHRvIHJlbW92ZS5cbiAgd2hpbGUgKG5vZGUuZGF0YSAhPT0gZCkgaWYgKCEocHJldmlvdXMgPSBub2RlLCBub2RlID0gbm9kZS5uZXh0KSkgcmV0dXJuIHRoaXM7XG4gIGlmIChuZXh0ID0gbm9kZS5uZXh0KSBkZWxldGUgbm9kZS5uZXh0O1xuXG4gIC8vIElmIHRoZXJlIGFyZSBtdWx0aXBsZSBjb2luY2lkZW50IHBvaW50cywgcmVtb3ZlIGp1c3QgdGhlIHBvaW50LlxuICBpZiAocHJldmlvdXMpIHJldHVybiAobmV4dCA/IHByZXZpb3VzLm5leHQgPSBuZXh0IDogZGVsZXRlIHByZXZpb3VzLm5leHQpLCB0aGlzO1xuXG4gIC8vIElmIHRoaXMgaXMgdGhlIHJvb3QgcG9pbnQsIHJlbW92ZSBpdC5cbiAgaWYgKCFwYXJlbnQpIHJldHVybiB0aGlzLl9yb290ID0gbmV4dCwgdGhpcztcblxuICAvLyBSZW1vdmUgdGhpcyBsZWFmLlxuICBuZXh0ID8gcGFyZW50W2ldID0gbmV4dCA6IGRlbGV0ZSBwYXJlbnRbaV07XG5cbiAgLy8gSWYgdGhlIHBhcmVudCBub3cgY29udGFpbnMgZXhhY3RseSBvbmUgbGVhZiwgY29sbGFwc2Ugc3VwZXJmbHVvdXMgcGFyZW50cy5cbiAgaWYgKChub2RlID0gcGFyZW50WzBdIHx8IHBhcmVudFsxXSB8fCBwYXJlbnRbMl0gfHwgcGFyZW50WzNdKVxuICAgICAgJiYgbm9kZSA9PT0gKHBhcmVudFszXSB8fCBwYXJlbnRbMl0gfHwgcGFyZW50WzFdIHx8IHBhcmVudFswXSlcbiAgICAgICYmICFub2RlLmxlbmd0aCkge1xuICAgIGlmIChyZXRhaW5lcikgcmV0YWluZXJbal0gPSBub2RlO1xuICAgIGVsc2UgdGhpcy5fcm9vdCA9IG5vZGU7XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbW92ZUFsbChkYXRhKSB7XG4gIGZvciAodmFyIGkgPSAwLCBuID0gZGF0YS5sZW5ndGg7IGkgPCBuOyArK2kpIHRoaXMucmVtb3ZlKGRhdGFbaV0pO1xuICByZXR1cm4gdGhpcztcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuX3Jvb3Q7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIHZhciBzaXplID0gMDtcbiAgdGhpcy52aXNpdChmdW5jdGlvbihub2RlKSB7XG4gICAgaWYgKCFub2RlLmxlbmd0aCkgZG8gKytzaXplOyB3aGlsZSAobm9kZSA9IG5vZGUubmV4dClcbiAgfSk7XG4gIHJldHVybiBzaXplO1xufVxuIiwgImltcG9ydCBRdWFkIGZyb20gXCIuL3F1YWQuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oY2FsbGJhY2spIHtcbiAgdmFyIHF1YWRzID0gW10sIHEsIG5vZGUgPSB0aGlzLl9yb290LCBjaGlsZCwgeDAsIHkwLCB4MSwgeTE7XG4gIGlmIChub2RlKSBxdWFkcy5wdXNoKG5ldyBRdWFkKG5vZGUsIHRoaXMuX3gwLCB0aGlzLl95MCwgdGhpcy5feDEsIHRoaXMuX3kxKSk7XG4gIHdoaWxlIChxID0gcXVhZHMucG9wKCkpIHtcbiAgICBpZiAoIWNhbGxiYWNrKG5vZGUgPSBxLm5vZGUsIHgwID0gcS54MCwgeTAgPSBxLnkwLCB4MSA9IHEueDEsIHkxID0gcS55MSkgJiYgbm9kZS5sZW5ndGgpIHtcbiAgICAgIHZhciB4bSA9ICh4MCArIHgxKSAvIDIsIHltID0gKHkwICsgeTEpIC8gMjtcbiAgICAgIGlmIChjaGlsZCA9IG5vZGVbM10pIHF1YWRzLnB1c2gobmV3IFF1YWQoY2hpbGQsIHhtLCB5bSwgeDEsIHkxKSk7XG4gICAgICBpZiAoY2hpbGQgPSBub2RlWzJdKSBxdWFkcy5wdXNoKG5ldyBRdWFkKGNoaWxkLCB4MCwgeW0sIHhtLCB5MSkpO1xuICAgICAgaWYgKGNoaWxkID0gbm9kZVsxXSkgcXVhZHMucHVzaChuZXcgUXVhZChjaGlsZCwgeG0sIHkwLCB4MSwgeW0pKTtcbiAgICAgIGlmIChjaGlsZCA9IG5vZGVbMF0pIHF1YWRzLnB1c2gobmV3IFF1YWQoY2hpbGQsIHgwLCB5MCwgeG0sIHltKSk7XG4gICAgfVxuICB9XG4gIHJldHVybiB0aGlzO1xufVxuIiwgImltcG9ydCBRdWFkIGZyb20gXCIuL3F1YWQuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oY2FsbGJhY2spIHtcbiAgdmFyIHF1YWRzID0gW10sIG5leHQgPSBbXSwgcTtcbiAgaWYgKHRoaXMuX3Jvb3QpIHF1YWRzLnB1c2gobmV3IFF1YWQodGhpcy5fcm9vdCwgdGhpcy5feDAsIHRoaXMuX3kwLCB0aGlzLl94MSwgdGhpcy5feTEpKTtcbiAgd2hpbGUgKHEgPSBxdWFkcy5wb3AoKSkge1xuICAgIHZhciBub2RlID0gcS5ub2RlO1xuICAgIGlmIChub2RlLmxlbmd0aCkge1xuICAgICAgdmFyIGNoaWxkLCB4MCA9IHEueDAsIHkwID0gcS55MCwgeDEgPSBxLngxLCB5MSA9IHEueTEsIHhtID0gKHgwICsgeDEpIC8gMiwgeW0gPSAoeTAgKyB5MSkgLyAyO1xuICAgICAgaWYgKGNoaWxkID0gbm9kZVswXSkgcXVhZHMucHVzaChuZXcgUXVhZChjaGlsZCwgeDAsIHkwLCB4bSwgeW0pKTtcbiAgICAgIGlmIChjaGlsZCA9IG5vZGVbMV0pIHF1YWRzLnB1c2gobmV3IFF1YWQoY2hpbGQsIHhtLCB5MCwgeDEsIHltKSk7XG4gICAgICBpZiAoY2hpbGQgPSBub2RlWzJdKSBxdWFkcy5wdXNoKG5ldyBRdWFkKGNoaWxkLCB4MCwgeW0sIHhtLCB5MSkpO1xuICAgICAgaWYgKGNoaWxkID0gbm9kZVszXSkgcXVhZHMucHVzaChuZXcgUXVhZChjaGlsZCwgeG0sIHltLCB4MSwgeTEpKTtcbiAgICB9XG4gICAgbmV4dC5wdXNoKHEpO1xuICB9XG4gIHdoaWxlIChxID0gbmV4dC5wb3AoKSkge1xuICAgIGNhbGxiYWNrKHEubm9kZSwgcS54MCwgcS55MCwgcS54MSwgcS55MSk7XG4gIH1cbiAgcmV0dXJuIHRoaXM7XG59XG4iLCAiZXhwb3J0IGZ1bmN0aW9uIGRlZmF1bHRYKGQpIHtcbiAgcmV0dXJuIGRbMF07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKF8pIHtcbiAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAodGhpcy5feCA9IF8sIHRoaXMpIDogdGhpcy5feDtcbn1cbiIsICJleHBvcnQgZnVuY3Rpb24gZGVmYXVsdFkoZCkge1xuICByZXR1cm4gZFsxXTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oXykge1xuICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/ICh0aGlzLl95ID0gXywgdGhpcykgOiB0aGlzLl95O1xufVxuIiwgImltcG9ydCB0cmVlX2FkZCwge2FkZEFsbCBhcyB0cmVlX2FkZEFsbH0gZnJvbSBcIi4vYWRkLmpzXCI7XG5pbXBvcnQgdHJlZV9jb3ZlciBmcm9tIFwiLi9jb3Zlci5qc1wiO1xuaW1wb3J0IHRyZWVfZGF0YSBmcm9tIFwiLi9kYXRhLmpzXCI7XG5pbXBvcnQgdHJlZV9leHRlbnQgZnJvbSBcIi4vZXh0ZW50LmpzXCI7XG5pbXBvcnQgdHJlZV9maW5kIGZyb20gXCIuL2ZpbmQuanNcIjtcbmltcG9ydCB0cmVlX3JlbW92ZSwge3JlbW92ZUFsbCBhcyB0cmVlX3JlbW92ZUFsbH0gZnJvbSBcIi4vcmVtb3ZlLmpzXCI7XG5pbXBvcnQgdHJlZV9yb290IGZyb20gXCIuL3Jvb3QuanNcIjtcbmltcG9ydCB0cmVlX3NpemUgZnJvbSBcIi4vc2l6ZS5qc1wiO1xuaW1wb3J0IHRyZWVfdmlzaXQgZnJvbSBcIi4vdmlzaXQuanNcIjtcbmltcG9ydCB0cmVlX3Zpc2l0QWZ0ZXIgZnJvbSBcIi4vdmlzaXRBZnRlci5qc1wiO1xuaW1wb3J0IHRyZWVfeCwge2RlZmF1bHRYfSBmcm9tIFwiLi94LmpzXCI7XG5pbXBvcnQgdHJlZV95LCB7ZGVmYXVsdFl9IGZyb20gXCIuL3kuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gcXVhZHRyZWUobm9kZXMsIHgsIHkpIHtcbiAgdmFyIHRyZWUgPSBuZXcgUXVhZHRyZWUoeCA9PSBudWxsID8gZGVmYXVsdFggOiB4LCB5ID09IG51bGwgPyBkZWZhdWx0WSA6IHksIE5hTiwgTmFOLCBOYU4sIE5hTik7XG4gIHJldHVybiBub2RlcyA9PSBudWxsID8gdHJlZSA6IHRyZWUuYWRkQWxsKG5vZGVzKTtcbn1cblxuZnVuY3Rpb24gUXVhZHRyZWUoeCwgeSwgeDAsIHkwLCB4MSwgeTEpIHtcbiAgdGhpcy5feCA9IHg7XG4gIHRoaXMuX3kgPSB5O1xuICB0aGlzLl94MCA9IHgwO1xuICB0aGlzLl95MCA9IHkwO1xuICB0aGlzLl94MSA9IHgxO1xuICB0aGlzLl95MSA9IHkxO1xuICB0aGlzLl9yb290ID0gdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiBsZWFmX2NvcHkobGVhZikge1xuICB2YXIgY29weSA9IHtkYXRhOiBsZWFmLmRhdGF9LCBuZXh0ID0gY29weTtcbiAgd2hpbGUgKGxlYWYgPSBsZWFmLm5leHQpIG5leHQgPSBuZXh0Lm5leHQgPSB7ZGF0YTogbGVhZi5kYXRhfTtcbiAgcmV0dXJuIGNvcHk7XG59XG5cbnZhciB0cmVlUHJvdG8gPSBxdWFkdHJlZS5wcm90b3R5cGUgPSBRdWFkdHJlZS5wcm90b3R5cGU7XG5cbnRyZWVQcm90by5jb3B5ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBjb3B5ID0gbmV3IFF1YWR0cmVlKHRoaXMuX3gsIHRoaXMuX3ksIHRoaXMuX3gwLCB0aGlzLl95MCwgdGhpcy5feDEsIHRoaXMuX3kxKSxcbiAgICAgIG5vZGUgPSB0aGlzLl9yb290LFxuICAgICAgbm9kZXMsXG4gICAgICBjaGlsZDtcblxuICBpZiAoIW5vZGUpIHJldHVybiBjb3B5O1xuXG4gIGlmICghbm9kZS5sZW5ndGgpIHJldHVybiBjb3B5Ll9yb290ID0gbGVhZl9jb3B5KG5vZGUpLCBjb3B5O1xuXG4gIG5vZGVzID0gW3tzb3VyY2U6IG5vZGUsIHRhcmdldDogY29weS5fcm9vdCA9IG5ldyBBcnJheSg0KX1dO1xuICB3aGlsZSAobm9kZSA9IG5vZGVzLnBvcCgpKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCA0OyArK2kpIHtcbiAgICAgIGlmIChjaGlsZCA9IG5vZGUuc291cmNlW2ldKSB7XG4gICAgICAgIGlmIChjaGlsZC5sZW5ndGgpIG5vZGVzLnB1c2goe3NvdXJjZTogY2hpbGQsIHRhcmdldDogbm9kZS50YXJnZXRbaV0gPSBuZXcgQXJyYXkoNCl9KTtcbiAgICAgICAgZWxzZSBub2RlLnRhcmdldFtpXSA9IGxlYWZfY29weShjaGlsZCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGNvcHk7XG59O1xuXG50cmVlUHJvdG8uYWRkID0gdHJlZV9hZGQ7XG50cmVlUHJvdG8uYWRkQWxsID0gdHJlZV9hZGRBbGw7XG50cmVlUHJvdG8uY292ZXIgPSB0cmVlX2NvdmVyO1xudHJlZVByb3RvLmRhdGEgPSB0cmVlX2RhdGE7XG50cmVlUHJvdG8uZXh0ZW50ID0gdHJlZV9leHRlbnQ7XG50cmVlUHJvdG8uZmluZCA9IHRyZWVfZmluZDtcbnRyZWVQcm90by5yZW1vdmUgPSB0cmVlX3JlbW92ZTtcbnRyZWVQcm90by5yZW1vdmVBbGwgPSB0cmVlX3JlbW92ZUFsbDtcbnRyZWVQcm90by5yb290ID0gdHJlZV9yb290O1xudHJlZVByb3RvLnNpemUgPSB0cmVlX3NpemU7XG50cmVlUHJvdG8udmlzaXQgPSB0cmVlX3Zpc2l0O1xudHJlZVByb3RvLnZpc2l0QWZ0ZXIgPSB0cmVlX3Zpc2l0QWZ0ZXI7XG50cmVlUHJvdG8ueCA9IHRyZWVfeDtcbnRyZWVQcm90by55ID0gdHJlZV95O1xuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHgpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB4O1xuICB9O1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHJhbmRvbSkge1xuICByZXR1cm4gKHJhbmRvbSgpIC0gMC41KSAqIDFlLTY7XG59XG4iLCAiaW1wb3J0IHtxdWFkdHJlZX0gZnJvbSBcImQzLXF1YWR0cmVlXCI7XG5pbXBvcnQgY29uc3RhbnQgZnJvbSBcIi4vY29uc3RhbnQuanNcIjtcbmltcG9ydCBqaWdnbGUgZnJvbSBcIi4vamlnZ2xlLmpzXCI7XG5cbmZ1bmN0aW9uIHgoZCkge1xuICByZXR1cm4gZC54ICsgZC52eDtcbn1cblxuZnVuY3Rpb24geShkKSB7XG4gIHJldHVybiBkLnkgKyBkLnZ5O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihyYWRpdXMpIHtcbiAgdmFyIG5vZGVzLFxuICAgICAgcmFkaWksXG4gICAgICByYW5kb20sXG4gICAgICBzdHJlbmd0aCA9IDEsXG4gICAgICBpdGVyYXRpb25zID0gMTtcblxuICBpZiAodHlwZW9mIHJhZGl1cyAhPT0gXCJmdW5jdGlvblwiKSByYWRpdXMgPSBjb25zdGFudChyYWRpdXMgPT0gbnVsbCA/IDEgOiArcmFkaXVzKTtcblxuICBmdW5jdGlvbiBmb3JjZSgpIHtcbiAgICB2YXIgaSwgbiA9IG5vZGVzLmxlbmd0aCxcbiAgICAgICAgdHJlZSxcbiAgICAgICAgbm9kZSxcbiAgICAgICAgeGksXG4gICAgICAgIHlpLFxuICAgICAgICByaSxcbiAgICAgICAgcmkyO1xuXG4gICAgZm9yICh2YXIgayA9IDA7IGsgPCBpdGVyYXRpb25zOyArK2spIHtcbiAgICAgIHRyZWUgPSBxdWFkdHJlZShub2RlcywgeCwgeSkudmlzaXRBZnRlcihwcmVwYXJlKTtcbiAgICAgIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgICAgbm9kZSA9IG5vZGVzW2ldO1xuICAgICAgICByaSA9IHJhZGlpW25vZGUuaW5kZXhdLCByaTIgPSByaSAqIHJpO1xuICAgICAgICB4aSA9IG5vZGUueCArIG5vZGUudng7XG4gICAgICAgIHlpID0gbm9kZS55ICsgbm9kZS52eTtcbiAgICAgICAgdHJlZS52aXNpdChhcHBseSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYXBwbHkocXVhZCwgeDAsIHkwLCB4MSwgeTEpIHtcbiAgICAgIHZhciBkYXRhID0gcXVhZC5kYXRhLCByaiA9IHF1YWQuciwgciA9IHJpICsgcmo7XG4gICAgICBpZiAoZGF0YSkge1xuICAgICAgICBpZiAoZGF0YS5pbmRleCA+IG5vZGUuaW5kZXgpIHtcbiAgICAgICAgICB2YXIgeCA9IHhpIC0gZGF0YS54IC0gZGF0YS52eCxcbiAgICAgICAgICAgICAgeSA9IHlpIC0gZGF0YS55IC0gZGF0YS52eSxcbiAgICAgICAgICAgICAgbCA9IHggKiB4ICsgeSAqIHk7XG4gICAgICAgICAgaWYgKGwgPCByICogcikge1xuICAgICAgICAgICAgaWYgKHggPT09IDApIHggPSBqaWdnbGUocmFuZG9tKSwgbCArPSB4ICogeDtcbiAgICAgICAgICAgIGlmICh5ID09PSAwKSB5ID0gamlnZ2xlKHJhbmRvbSksIGwgKz0geSAqIHk7XG4gICAgICAgICAgICBsID0gKHIgLSAobCA9IE1hdGguc3FydChsKSkpIC8gbCAqIHN0cmVuZ3RoO1xuICAgICAgICAgICAgbm9kZS52eCArPSAoeCAqPSBsKSAqIChyID0gKHJqICo9IHJqKSAvIChyaTIgKyByaikpO1xuICAgICAgICAgICAgbm9kZS52eSArPSAoeSAqPSBsKSAqIHI7XG4gICAgICAgICAgICBkYXRhLnZ4IC09IHggKiAociA9IDEgLSByKTtcbiAgICAgICAgICAgIGRhdGEudnkgLT0geSAqIHI7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHJldHVybiB4MCA+IHhpICsgciB8fCB4MSA8IHhpIC0gciB8fCB5MCA+IHlpICsgciB8fCB5MSA8IHlpIC0gcjtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBwcmVwYXJlKHF1YWQpIHtcbiAgICBpZiAocXVhZC5kYXRhKSByZXR1cm4gcXVhZC5yID0gcmFkaWlbcXVhZC5kYXRhLmluZGV4XTtcbiAgICBmb3IgKHZhciBpID0gcXVhZC5yID0gMDsgaSA8IDQ7ICsraSkge1xuICAgICAgaWYgKHF1YWRbaV0gJiYgcXVhZFtpXS5yID4gcXVhZC5yKSB7XG4gICAgICAgIHF1YWQuciA9IHF1YWRbaV0ucjtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBpbml0aWFsaXplKCkge1xuICAgIGlmICghbm9kZXMpIHJldHVybjtcbiAgICB2YXIgaSwgbiA9IG5vZGVzLmxlbmd0aCwgbm9kZTtcbiAgICByYWRpaSA9IG5ldyBBcnJheShuKTtcbiAgICBmb3IgKGkgPSAwOyBpIDwgbjsgKytpKSBub2RlID0gbm9kZXNbaV0sIHJhZGlpW25vZGUuaW5kZXhdID0gK3JhZGl1cyhub2RlLCBpLCBub2Rlcyk7XG4gIH1cblxuICBmb3JjZS5pbml0aWFsaXplID0gZnVuY3Rpb24oX25vZGVzLCBfcmFuZG9tKSB7XG4gICAgbm9kZXMgPSBfbm9kZXM7XG4gICAgcmFuZG9tID0gX3JhbmRvbTtcbiAgICBpbml0aWFsaXplKCk7XG4gIH07XG5cbiAgZm9yY2UuaXRlcmF0aW9ucyA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChpdGVyYXRpb25zID0gK18sIGZvcmNlKSA6IGl0ZXJhdGlvbnM7XG4gIH07XG5cbiAgZm9yY2Uuc3RyZW5ndGggPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoc3RyZW5ndGggPSArXywgZm9yY2UpIDogc3RyZW5ndGg7XG4gIH07XG5cbiAgZm9yY2UucmFkaXVzID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHJhZGl1cyA9IHR5cGVvZiBfID09PSBcImZ1bmN0aW9uXCIgPyBfIDogY29uc3RhbnQoK18pLCBpbml0aWFsaXplKCksIGZvcmNlKSA6IHJhZGl1cztcbiAgfTtcblxuICByZXR1cm4gZm9yY2U7XG59XG4iLCAiaW1wb3J0IGNvbnN0YW50IGZyb20gXCIuL2NvbnN0YW50LmpzXCI7XG5pbXBvcnQgamlnZ2xlIGZyb20gXCIuL2ppZ2dsZS5qc1wiO1xuXG5mdW5jdGlvbiBpbmRleChkKSB7XG4gIHJldHVybiBkLmluZGV4O1xufVxuXG5mdW5jdGlvbiBmaW5kKG5vZGVCeUlkLCBub2RlSWQpIHtcbiAgdmFyIG5vZGUgPSBub2RlQnlJZC5nZXQobm9kZUlkKTtcbiAgaWYgKCFub2RlKSB0aHJvdyBuZXcgRXJyb3IoXCJub2RlIG5vdCBmb3VuZDogXCIgKyBub2RlSWQpO1xuICByZXR1cm4gbm9kZTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obGlua3MpIHtcbiAgdmFyIGlkID0gaW5kZXgsXG4gICAgICBzdHJlbmd0aCA9IGRlZmF1bHRTdHJlbmd0aCxcbiAgICAgIHN0cmVuZ3RocyxcbiAgICAgIGRpc3RhbmNlID0gY29uc3RhbnQoMzApLFxuICAgICAgZGlzdGFuY2VzLFxuICAgICAgbm9kZXMsXG4gICAgICBjb3VudCxcbiAgICAgIGJpYXMsXG4gICAgICByYW5kb20sXG4gICAgICBpdGVyYXRpb25zID0gMTtcblxuICBpZiAobGlua3MgPT0gbnVsbCkgbGlua3MgPSBbXTtcblxuICBmdW5jdGlvbiBkZWZhdWx0U3RyZW5ndGgobGluaykge1xuICAgIHJldHVybiAxIC8gTWF0aC5taW4oY291bnRbbGluay5zb3VyY2UuaW5kZXhdLCBjb3VudFtsaW5rLnRhcmdldC5pbmRleF0pO1xuICB9XG5cbiAgZnVuY3Rpb24gZm9yY2UoYWxwaGEpIHtcbiAgICBmb3IgKHZhciBrID0gMCwgbiA9IGxpbmtzLmxlbmd0aDsgayA8IGl0ZXJhdGlvbnM7ICsraykge1xuICAgICAgZm9yICh2YXIgaSA9IDAsIGxpbmssIHNvdXJjZSwgdGFyZ2V0LCB4LCB5LCBsLCBiOyBpIDwgbjsgKytpKSB7XG4gICAgICAgIGxpbmsgPSBsaW5rc1tpXSwgc291cmNlID0gbGluay5zb3VyY2UsIHRhcmdldCA9IGxpbmsudGFyZ2V0O1xuICAgICAgICB4ID0gdGFyZ2V0LnggKyB0YXJnZXQudnggLSBzb3VyY2UueCAtIHNvdXJjZS52eCB8fCBqaWdnbGUocmFuZG9tKTtcbiAgICAgICAgeSA9IHRhcmdldC55ICsgdGFyZ2V0LnZ5IC0gc291cmNlLnkgLSBzb3VyY2UudnkgfHwgamlnZ2xlKHJhbmRvbSk7XG4gICAgICAgIGwgPSBNYXRoLnNxcnQoeCAqIHggKyB5ICogeSk7XG4gICAgICAgIGwgPSAobCAtIGRpc3RhbmNlc1tpXSkgLyBsICogYWxwaGEgKiBzdHJlbmd0aHNbaV07XG4gICAgICAgIHggKj0gbCwgeSAqPSBsO1xuICAgICAgICB0YXJnZXQudnggLT0geCAqIChiID0gYmlhc1tpXSk7XG4gICAgICAgIHRhcmdldC52eSAtPSB5ICogYjtcbiAgICAgICAgc291cmNlLnZ4ICs9IHggKiAoYiA9IDEgLSBiKTtcbiAgICAgICAgc291cmNlLnZ5ICs9IHkgKiBiO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGluaXRpYWxpemUoKSB7XG4gICAgaWYgKCFub2RlcykgcmV0dXJuO1xuXG4gICAgdmFyIGksXG4gICAgICAgIG4gPSBub2Rlcy5sZW5ndGgsXG4gICAgICAgIG0gPSBsaW5rcy5sZW5ndGgsXG4gICAgICAgIG5vZGVCeUlkID0gbmV3IE1hcChub2Rlcy5tYXAoKGQsIGkpID0+IFtpZChkLCBpLCBub2RlcyksIGRdKSksXG4gICAgICAgIGxpbms7XG5cbiAgICBmb3IgKGkgPSAwLCBjb3VudCA9IG5ldyBBcnJheShuKTsgaSA8IG07ICsraSkge1xuICAgICAgbGluayA9IGxpbmtzW2ldLCBsaW5rLmluZGV4ID0gaTtcbiAgICAgIGlmICh0eXBlb2YgbGluay5zb3VyY2UgIT09IFwib2JqZWN0XCIpIGxpbmsuc291cmNlID0gZmluZChub2RlQnlJZCwgbGluay5zb3VyY2UpO1xuICAgICAgaWYgKHR5cGVvZiBsaW5rLnRhcmdldCAhPT0gXCJvYmplY3RcIikgbGluay50YXJnZXQgPSBmaW5kKG5vZGVCeUlkLCBsaW5rLnRhcmdldCk7XG4gICAgICBjb3VudFtsaW5rLnNvdXJjZS5pbmRleF0gPSAoY291bnRbbGluay5zb3VyY2UuaW5kZXhdIHx8IDApICsgMTtcbiAgICAgIGNvdW50W2xpbmsudGFyZ2V0LmluZGV4XSA9IChjb3VudFtsaW5rLnRhcmdldC5pbmRleF0gfHwgMCkgKyAxO1xuICAgIH1cblxuICAgIGZvciAoaSA9IDAsIGJpYXMgPSBuZXcgQXJyYXkobSk7IGkgPCBtOyArK2kpIHtcbiAgICAgIGxpbmsgPSBsaW5rc1tpXSwgYmlhc1tpXSA9IGNvdW50W2xpbmsuc291cmNlLmluZGV4XSAvIChjb3VudFtsaW5rLnNvdXJjZS5pbmRleF0gKyBjb3VudFtsaW5rLnRhcmdldC5pbmRleF0pO1xuICAgIH1cblxuICAgIHN0cmVuZ3RocyA9IG5ldyBBcnJheShtKSwgaW5pdGlhbGl6ZVN0cmVuZ3RoKCk7XG4gICAgZGlzdGFuY2VzID0gbmV3IEFycmF5KG0pLCBpbml0aWFsaXplRGlzdGFuY2UoKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGluaXRpYWxpemVTdHJlbmd0aCgpIHtcbiAgICBpZiAoIW5vZGVzKSByZXR1cm47XG5cbiAgICBmb3IgKHZhciBpID0gMCwgbiA9IGxpbmtzLmxlbmd0aDsgaSA8IG47ICsraSkge1xuICAgICAgc3RyZW5ndGhzW2ldID0gK3N0cmVuZ3RoKGxpbmtzW2ldLCBpLCBsaW5rcyk7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gaW5pdGlhbGl6ZURpc3RhbmNlKCkge1xuICAgIGlmICghbm9kZXMpIHJldHVybjtcblxuICAgIGZvciAodmFyIGkgPSAwLCBuID0gbGlua3MubGVuZ3RoOyBpIDwgbjsgKytpKSB7XG4gICAgICBkaXN0YW5jZXNbaV0gPSArZGlzdGFuY2UobGlua3NbaV0sIGksIGxpbmtzKTtcbiAgICB9XG4gIH1cblxuICBmb3JjZS5pbml0aWFsaXplID0gZnVuY3Rpb24oX25vZGVzLCBfcmFuZG9tKSB7XG4gICAgbm9kZXMgPSBfbm9kZXM7XG4gICAgcmFuZG9tID0gX3JhbmRvbTtcbiAgICBpbml0aWFsaXplKCk7XG4gIH07XG5cbiAgZm9yY2UubGlua3MgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAobGlua3MgPSBfLCBpbml0aWFsaXplKCksIGZvcmNlKSA6IGxpbmtzO1xuICB9O1xuXG4gIGZvcmNlLmlkID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGlkID0gXywgZm9yY2UpIDogaWQ7XG4gIH07XG5cbiAgZm9yY2UuaXRlcmF0aW9ucyA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChpdGVyYXRpb25zID0gK18sIGZvcmNlKSA6IGl0ZXJhdGlvbnM7XG4gIH07XG5cbiAgZm9yY2Uuc3RyZW5ndGggPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoc3RyZW5ndGggPSB0eXBlb2YgXyA9PT0gXCJmdW5jdGlvblwiID8gXyA6IGNvbnN0YW50KCtfKSwgaW5pdGlhbGl6ZVN0cmVuZ3RoKCksIGZvcmNlKSA6IHN0cmVuZ3RoO1xuICB9O1xuXG4gIGZvcmNlLmRpc3RhbmNlID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGRpc3RhbmNlID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudCgrXyksIGluaXRpYWxpemVEaXN0YW5jZSgpLCBmb3JjZSkgOiBkaXN0YW5jZTtcbiAgfTtcblxuICByZXR1cm4gZm9yY2U7XG59XG4iLCAiLy8gaHR0cHM6Ly9lbi53aWtpcGVkaWEub3JnL3dpa2kvTGluZWFyX2NvbmdydWVudGlhbF9nZW5lcmF0b3IjUGFyYW1ldGVyc19pbl9jb21tb25fdXNlXG5jb25zdCBhID0gMTY2NDUyNTtcbmNvbnN0IGMgPSAxMDEzOTA0MjIzO1xuY29uc3QgbSA9IDQyOTQ5NjcyOTY7IC8vIDJeMzJcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIGxldCBzID0gMTtcbiAgcmV0dXJuICgpID0+IChzID0gKGEgKiBzICsgYykgJSBtKSAvIG07XG59XG4iLCAiaW1wb3J0IHtkaXNwYXRjaH0gZnJvbSBcImQzLWRpc3BhdGNoXCI7XG5pbXBvcnQge3RpbWVyfSBmcm9tIFwiZDMtdGltZXJcIjtcbmltcG9ydCBsY2cgZnJvbSBcIi4vbGNnLmpzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiB4KGQpIHtcbiAgcmV0dXJuIGQueDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHkoZCkge1xuICByZXR1cm4gZC55O1xufVxuXG52YXIgaW5pdGlhbFJhZGl1cyA9IDEwLFxuICAgIGluaXRpYWxBbmdsZSA9IE1hdGguUEkgKiAoMyAtIE1hdGguc3FydCg1KSk7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG5vZGVzKSB7XG4gIHZhciBzaW11bGF0aW9uLFxuICAgICAgYWxwaGEgPSAxLFxuICAgICAgYWxwaGFNaW4gPSAwLjAwMSxcbiAgICAgIGFscGhhRGVjYXkgPSAxIC0gTWF0aC5wb3coYWxwaGFNaW4sIDEgLyAzMDApLFxuICAgICAgYWxwaGFUYXJnZXQgPSAwLFxuICAgICAgdmVsb2NpdHlEZWNheSA9IDAuNixcbiAgICAgIGZvcmNlcyA9IG5ldyBNYXAoKSxcbiAgICAgIHN0ZXBwZXIgPSB0aW1lcihzdGVwKSxcbiAgICAgIGV2ZW50ID0gZGlzcGF0Y2goXCJ0aWNrXCIsIFwiZW5kXCIpLFxuICAgICAgcmFuZG9tID0gbGNnKCk7XG5cbiAgaWYgKG5vZGVzID09IG51bGwpIG5vZGVzID0gW107XG5cbiAgZnVuY3Rpb24gc3RlcCgpIHtcbiAgICB0aWNrKCk7XG4gICAgZXZlbnQuY2FsbChcInRpY2tcIiwgc2ltdWxhdGlvbik7XG4gICAgaWYgKGFscGhhIDwgYWxwaGFNaW4pIHtcbiAgICAgIHN0ZXBwZXIuc3RvcCgpO1xuICAgICAgZXZlbnQuY2FsbChcImVuZFwiLCBzaW11bGF0aW9uKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiB0aWNrKGl0ZXJhdGlvbnMpIHtcbiAgICB2YXIgaSwgbiA9IG5vZGVzLmxlbmd0aCwgbm9kZTtcblxuICAgIGlmIChpdGVyYXRpb25zID09PSB1bmRlZmluZWQpIGl0ZXJhdGlvbnMgPSAxO1xuXG4gICAgZm9yICh2YXIgayA9IDA7IGsgPCBpdGVyYXRpb25zOyArK2spIHtcbiAgICAgIGFscGhhICs9IChhbHBoYVRhcmdldCAtIGFscGhhKSAqIGFscGhhRGVjYXk7XG5cbiAgICAgIGZvcmNlcy5mb3JFYWNoKGZ1bmN0aW9uKGZvcmNlKSB7XG4gICAgICAgIGZvcmNlKGFscGhhKTtcbiAgICAgIH0pO1xuXG4gICAgICBmb3IgKGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICAgIG5vZGUgPSBub2Rlc1tpXTtcbiAgICAgICAgaWYgKG5vZGUuZnggPT0gbnVsbCkgbm9kZS54ICs9IG5vZGUudnggKj0gdmVsb2NpdHlEZWNheTtcbiAgICAgICAgZWxzZSBub2RlLnggPSBub2RlLmZ4LCBub2RlLnZ4ID0gMDtcbiAgICAgICAgaWYgKG5vZGUuZnkgPT0gbnVsbCkgbm9kZS55ICs9IG5vZGUudnkgKj0gdmVsb2NpdHlEZWNheTtcbiAgICAgICAgZWxzZSBub2RlLnkgPSBub2RlLmZ5LCBub2RlLnZ5ID0gMDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gc2ltdWxhdGlvbjtcbiAgfVxuXG4gIGZ1bmN0aW9uIGluaXRpYWxpemVOb2RlcygpIHtcbiAgICBmb3IgKHZhciBpID0gMCwgbiA9IG5vZGVzLmxlbmd0aCwgbm9kZTsgaSA8IG47ICsraSkge1xuICAgICAgbm9kZSA9IG5vZGVzW2ldLCBub2RlLmluZGV4ID0gaTtcbiAgICAgIGlmIChub2RlLmZ4ICE9IG51bGwpIG5vZGUueCA9IG5vZGUuZng7XG4gICAgICBpZiAobm9kZS5meSAhPSBudWxsKSBub2RlLnkgPSBub2RlLmZ5O1xuICAgICAgaWYgKGlzTmFOKG5vZGUueCkgfHwgaXNOYU4obm9kZS55KSkge1xuICAgICAgICB2YXIgcmFkaXVzID0gaW5pdGlhbFJhZGl1cyAqIE1hdGguc3FydCgwLjUgKyBpKSwgYW5nbGUgPSBpICogaW5pdGlhbEFuZ2xlO1xuICAgICAgICBub2RlLnggPSByYWRpdXMgKiBNYXRoLmNvcyhhbmdsZSk7XG4gICAgICAgIG5vZGUueSA9IHJhZGl1cyAqIE1hdGguc2luKGFuZ2xlKTtcbiAgICAgIH1cbiAgICAgIGlmIChpc05hTihub2RlLnZ4KSB8fCBpc05hTihub2RlLnZ5KSkge1xuICAgICAgICBub2RlLnZ4ID0gbm9kZS52eSA9IDA7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gaW5pdGlhbGl6ZUZvcmNlKGZvcmNlKSB7XG4gICAgaWYgKGZvcmNlLmluaXRpYWxpemUpIGZvcmNlLmluaXRpYWxpemUobm9kZXMsIHJhbmRvbSk7XG4gICAgcmV0dXJuIGZvcmNlO1xuICB9XG5cbiAgaW5pdGlhbGl6ZU5vZGVzKCk7XG5cbiAgcmV0dXJuIHNpbXVsYXRpb24gPSB7XG4gICAgdGljazogdGljayxcblxuICAgIHJlc3RhcnQ6IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIHN0ZXBwZXIucmVzdGFydChzdGVwKSwgc2ltdWxhdGlvbjtcbiAgICB9LFxuXG4gICAgc3RvcDogZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gc3RlcHBlci5zdG9wKCksIHNpbXVsYXRpb247XG4gICAgfSxcblxuICAgIG5vZGVzOiBmdW5jdGlvbihfKSB7XG4gICAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChub2RlcyA9IF8sIGluaXRpYWxpemVOb2RlcygpLCBmb3JjZXMuZm9yRWFjaChpbml0aWFsaXplRm9yY2UpLCBzaW11bGF0aW9uKSA6IG5vZGVzO1xuICAgIH0sXG5cbiAgICBhbHBoYTogZnVuY3Rpb24oXykge1xuICAgICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoYWxwaGEgPSArXywgc2ltdWxhdGlvbikgOiBhbHBoYTtcbiAgICB9LFxuXG4gICAgYWxwaGFNaW46IGZ1bmN0aW9uKF8pIHtcbiAgICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGFscGhhTWluID0gK18sIHNpbXVsYXRpb24pIDogYWxwaGFNaW47XG4gICAgfSxcblxuICAgIGFscGhhRGVjYXk6IGZ1bmN0aW9uKF8pIHtcbiAgICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGFscGhhRGVjYXkgPSArXywgc2ltdWxhdGlvbikgOiArYWxwaGFEZWNheTtcbiAgICB9LFxuXG4gICAgYWxwaGFUYXJnZXQ6IGZ1bmN0aW9uKF8pIHtcbiAgICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGFscGhhVGFyZ2V0ID0gK18sIHNpbXVsYXRpb24pIDogYWxwaGFUYXJnZXQ7XG4gICAgfSxcblxuICAgIHZlbG9jaXR5RGVjYXk6IGZ1bmN0aW9uKF8pIHtcbiAgICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHZlbG9jaXR5RGVjYXkgPSAxIC0gXywgc2ltdWxhdGlvbikgOiAxIC0gdmVsb2NpdHlEZWNheTtcbiAgICB9LFxuXG4gICAgcmFuZG9tU291cmNlOiBmdW5jdGlvbihfKSB7XG4gICAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChyYW5kb20gPSBfLCBmb3JjZXMuZm9yRWFjaChpbml0aWFsaXplRm9yY2UpLCBzaW11bGF0aW9uKSA6IHJhbmRvbTtcbiAgICB9LFxuXG4gICAgZm9yY2U6IGZ1bmN0aW9uKG5hbWUsIF8pIHtcbiAgICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID4gMSA/ICgoXyA9PSBudWxsID8gZm9yY2VzLmRlbGV0ZShuYW1lKSA6IGZvcmNlcy5zZXQobmFtZSwgaW5pdGlhbGl6ZUZvcmNlKF8pKSksIHNpbXVsYXRpb24pIDogZm9yY2VzLmdldChuYW1lKTtcbiAgICB9LFxuXG4gICAgZmluZDogZnVuY3Rpb24oeCwgeSwgcmFkaXVzKSB7XG4gICAgICB2YXIgaSA9IDAsXG4gICAgICAgICAgbiA9IG5vZGVzLmxlbmd0aCxcbiAgICAgICAgICBkeCxcbiAgICAgICAgICBkeSxcbiAgICAgICAgICBkMixcbiAgICAgICAgICBub2RlLFxuICAgICAgICAgIGNsb3Nlc3Q7XG5cbiAgICAgIGlmIChyYWRpdXMgPT0gbnVsbCkgcmFkaXVzID0gSW5maW5pdHk7XG4gICAgICBlbHNlIHJhZGl1cyAqPSByYWRpdXM7XG5cbiAgICAgIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgICAgbm9kZSA9IG5vZGVzW2ldO1xuICAgICAgICBkeCA9IHggLSBub2RlLng7XG4gICAgICAgIGR5ID0geSAtIG5vZGUueTtcbiAgICAgICAgZDIgPSBkeCAqIGR4ICsgZHkgKiBkeTtcbiAgICAgICAgaWYgKGQyIDwgcmFkaXVzKSBjbG9zZXN0ID0gbm9kZSwgcmFkaXVzID0gZDI7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBjbG9zZXN0O1xuICAgIH0sXG5cbiAgICBvbjogZnVuY3Rpb24obmFtZSwgXykge1xuICAgICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPiAxID8gKGV2ZW50Lm9uKG5hbWUsIF8pLCBzaW11bGF0aW9uKSA6IGV2ZW50Lm9uKG5hbWUpO1xuICAgIH1cbiAgfTtcbn1cbiIsICJpbXBvcnQge3F1YWR0cmVlfSBmcm9tIFwiZDMtcXVhZHRyZWVcIjtcbmltcG9ydCBjb25zdGFudCBmcm9tIFwiLi9jb25zdGFudC5qc1wiO1xuaW1wb3J0IGppZ2dsZSBmcm9tIFwiLi9qaWdnbGUuanNcIjtcbmltcG9ydCB7eCwgeX0gZnJvbSBcIi4vc2ltdWxhdGlvbi5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgdmFyIG5vZGVzLFxuICAgICAgbm9kZSxcbiAgICAgIHJhbmRvbSxcbiAgICAgIGFscGhhLFxuICAgICAgc3RyZW5ndGggPSBjb25zdGFudCgtMzApLFxuICAgICAgc3RyZW5ndGhzLFxuICAgICAgZGlzdGFuY2VNaW4yID0gMSxcbiAgICAgIGRpc3RhbmNlTWF4MiA9IEluZmluaXR5LFxuICAgICAgdGhldGEyID0gMC44MTtcblxuICBmdW5jdGlvbiBmb3JjZShfKSB7XG4gICAgdmFyIGksIG4gPSBub2Rlcy5sZW5ndGgsIHRyZWUgPSBxdWFkdHJlZShub2RlcywgeCwgeSkudmlzaXRBZnRlcihhY2N1bXVsYXRlKTtcbiAgICBmb3IgKGFscGhhID0gXywgaSA9IDA7IGkgPCBuOyArK2kpIG5vZGUgPSBub2Rlc1tpXSwgdHJlZS52aXNpdChhcHBseSk7XG4gIH1cblxuICBmdW5jdGlvbiBpbml0aWFsaXplKCkge1xuICAgIGlmICghbm9kZXMpIHJldHVybjtcbiAgICB2YXIgaSwgbiA9IG5vZGVzLmxlbmd0aCwgbm9kZTtcbiAgICBzdHJlbmd0aHMgPSBuZXcgQXJyYXkobik7XG4gICAgZm9yIChpID0gMDsgaSA8IG47ICsraSkgbm9kZSA9IG5vZGVzW2ldLCBzdHJlbmd0aHNbbm9kZS5pbmRleF0gPSArc3RyZW5ndGgobm9kZSwgaSwgbm9kZXMpO1xuICB9XG5cbiAgZnVuY3Rpb24gYWNjdW11bGF0ZShxdWFkKSB7XG4gICAgdmFyIHN0cmVuZ3RoID0gMCwgcSwgYywgd2VpZ2h0ID0gMCwgeCwgeSwgaTtcblxuICAgIC8vIEZvciBpbnRlcm5hbCBub2RlcywgYWNjdW11bGF0ZSBmb3JjZXMgZnJvbSBjaGlsZCBxdWFkcmFudHMuXG4gICAgaWYgKHF1YWQubGVuZ3RoKSB7XG4gICAgICBmb3IgKHggPSB5ID0gaSA9IDA7IGkgPCA0OyArK2kpIHtcbiAgICAgICAgaWYgKChxID0gcXVhZFtpXSkgJiYgKGMgPSBNYXRoLmFicyhxLnZhbHVlKSkpIHtcbiAgICAgICAgICBzdHJlbmd0aCArPSBxLnZhbHVlLCB3ZWlnaHQgKz0gYywgeCArPSBjICogcS54LCB5ICs9IGMgKiBxLnk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHF1YWQueCA9IHggLyB3ZWlnaHQ7XG4gICAgICBxdWFkLnkgPSB5IC8gd2VpZ2h0O1xuICAgIH1cblxuICAgIC8vIEZvciBsZWFmIG5vZGVzLCBhY2N1bXVsYXRlIGZvcmNlcyBmcm9tIGNvaW5jaWRlbnQgcXVhZHJhbnRzLlxuICAgIGVsc2Uge1xuICAgICAgcSA9IHF1YWQ7XG4gICAgICBxLnggPSBxLmRhdGEueDtcbiAgICAgIHEueSA9IHEuZGF0YS55O1xuICAgICAgZG8gc3RyZW5ndGggKz0gc3RyZW5ndGhzW3EuZGF0YS5pbmRleF07XG4gICAgICB3aGlsZSAocSA9IHEubmV4dCk7XG4gICAgfVxuXG4gICAgcXVhZC52YWx1ZSA9IHN0cmVuZ3RoO1xuICB9XG5cbiAgZnVuY3Rpb24gYXBwbHkocXVhZCwgeDEsIF8sIHgyKSB7XG4gICAgaWYgKCFxdWFkLnZhbHVlKSByZXR1cm4gdHJ1ZTtcblxuICAgIHZhciB4ID0gcXVhZC54IC0gbm9kZS54LFxuICAgICAgICB5ID0gcXVhZC55IC0gbm9kZS55LFxuICAgICAgICB3ID0geDIgLSB4MSxcbiAgICAgICAgbCA9IHggKiB4ICsgeSAqIHk7XG5cbiAgICAvLyBBcHBseSB0aGUgQmFybmVzLUh1dCBhcHByb3hpbWF0aW9uIGlmIHBvc3NpYmxlLlxuICAgIC8vIExpbWl0IGZvcmNlcyBmb3IgdmVyeSBjbG9zZSBub2RlczsgcmFuZG9taXplIGRpcmVjdGlvbiBpZiBjb2luY2lkZW50LlxuICAgIGlmICh3ICogdyAvIHRoZXRhMiA8IGwpIHtcbiAgICAgIGlmIChsIDwgZGlzdGFuY2VNYXgyKSB7XG4gICAgICAgIGlmICh4ID09PSAwKSB4ID0gamlnZ2xlKHJhbmRvbSksIGwgKz0geCAqIHg7XG4gICAgICAgIGlmICh5ID09PSAwKSB5ID0gamlnZ2xlKHJhbmRvbSksIGwgKz0geSAqIHk7XG4gICAgICAgIGlmIChsIDwgZGlzdGFuY2VNaW4yKSBsID0gTWF0aC5zcXJ0KGRpc3RhbmNlTWluMiAqIGwpO1xuICAgICAgICBub2RlLnZ4ICs9IHggKiBxdWFkLnZhbHVlICogYWxwaGEgLyBsO1xuICAgICAgICBub2RlLnZ5ICs9IHkgKiBxdWFkLnZhbHVlICogYWxwaGEgLyBsO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgLy8gT3RoZXJ3aXNlLCBwcm9jZXNzIHBvaW50cyBkaXJlY3RseS5cbiAgICBlbHNlIGlmIChxdWFkLmxlbmd0aCB8fCBsID49IGRpc3RhbmNlTWF4MikgcmV0dXJuO1xuXG4gICAgLy8gTGltaXQgZm9yY2VzIGZvciB2ZXJ5IGNsb3NlIG5vZGVzOyByYW5kb21pemUgZGlyZWN0aW9uIGlmIGNvaW5jaWRlbnQuXG4gICAgaWYgKHF1YWQuZGF0YSAhPT0gbm9kZSB8fCBxdWFkLm5leHQpIHtcbiAgICAgIGlmICh4ID09PSAwKSB4ID0gamlnZ2xlKHJhbmRvbSksIGwgKz0geCAqIHg7XG4gICAgICBpZiAoeSA9PT0gMCkgeSA9IGppZ2dsZShyYW5kb20pLCBsICs9IHkgKiB5O1xuICAgICAgaWYgKGwgPCBkaXN0YW5jZU1pbjIpIGwgPSBNYXRoLnNxcnQoZGlzdGFuY2VNaW4yICogbCk7XG4gICAgfVxuXG4gICAgZG8gaWYgKHF1YWQuZGF0YSAhPT0gbm9kZSkge1xuICAgICAgdyA9IHN0cmVuZ3Roc1txdWFkLmRhdGEuaW5kZXhdICogYWxwaGEgLyBsO1xuICAgICAgbm9kZS52eCArPSB4ICogdztcbiAgICAgIG5vZGUudnkgKz0geSAqIHc7XG4gICAgfSB3aGlsZSAocXVhZCA9IHF1YWQubmV4dCk7XG4gIH1cblxuICBmb3JjZS5pbml0aWFsaXplID0gZnVuY3Rpb24oX25vZGVzLCBfcmFuZG9tKSB7XG4gICAgbm9kZXMgPSBfbm9kZXM7XG4gICAgcmFuZG9tID0gX3JhbmRvbTtcbiAgICBpbml0aWFsaXplKCk7XG4gIH07XG5cbiAgZm9yY2Uuc3RyZW5ndGggPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoc3RyZW5ndGggPSB0eXBlb2YgXyA9PT0gXCJmdW5jdGlvblwiID8gXyA6IGNvbnN0YW50KCtfKSwgaW5pdGlhbGl6ZSgpLCBmb3JjZSkgOiBzdHJlbmd0aDtcbiAgfTtcblxuICBmb3JjZS5kaXN0YW5jZU1pbiA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChkaXN0YW5jZU1pbjIgPSBfICogXywgZm9yY2UpIDogTWF0aC5zcXJ0KGRpc3RhbmNlTWluMik7XG4gIH07XG5cbiAgZm9yY2UuZGlzdGFuY2VNYXggPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoZGlzdGFuY2VNYXgyID0gXyAqIF8sIGZvcmNlKSA6IE1hdGguc3FydChkaXN0YW5jZU1heDIpO1xuICB9O1xuXG4gIGZvcmNlLnRoZXRhID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHRoZXRhMiA9IF8gKiBfLCBmb3JjZSkgOiBNYXRoLnNxcnQodGhldGEyKTtcbiAgfTtcblxuICByZXR1cm4gZm9yY2U7XG59XG4iLCAiaW1wb3J0IGNvbnN0YW50IGZyb20gXCIuL2NvbnN0YW50LmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHgpIHtcbiAgdmFyIHN0cmVuZ3RoID0gY29uc3RhbnQoMC4xKSxcbiAgICAgIG5vZGVzLFxuICAgICAgc3RyZW5ndGhzLFxuICAgICAgeHo7XG5cbiAgaWYgKHR5cGVvZiB4ICE9PSBcImZ1bmN0aW9uXCIpIHggPSBjb25zdGFudCh4ID09IG51bGwgPyAwIDogK3gpO1xuXG4gIGZ1bmN0aW9uIGZvcmNlKGFscGhhKSB7XG4gICAgZm9yICh2YXIgaSA9IDAsIG4gPSBub2Rlcy5sZW5ndGgsIG5vZGU7IGkgPCBuOyArK2kpIHtcbiAgICAgIG5vZGUgPSBub2Rlc1tpXSwgbm9kZS52eCArPSAoeHpbaV0gLSBub2RlLngpICogc3RyZW5ndGhzW2ldICogYWxwaGE7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gaW5pdGlhbGl6ZSgpIHtcbiAgICBpZiAoIW5vZGVzKSByZXR1cm47XG4gICAgdmFyIGksIG4gPSBub2Rlcy5sZW5ndGg7XG4gICAgc3RyZW5ndGhzID0gbmV3IEFycmF5KG4pO1xuICAgIHh6ID0gbmV3IEFycmF5KG4pO1xuICAgIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIHN0cmVuZ3Roc1tpXSA9IGlzTmFOKHh6W2ldID0gK3gobm9kZXNbaV0sIGksIG5vZGVzKSkgPyAwIDogK3N0cmVuZ3RoKG5vZGVzW2ldLCBpLCBub2Rlcyk7XG4gICAgfVxuICB9XG5cbiAgZm9yY2UuaW5pdGlhbGl6ZSA9IGZ1bmN0aW9uKF8pIHtcbiAgICBub2RlcyA9IF87XG4gICAgaW5pdGlhbGl6ZSgpO1xuICB9O1xuXG4gIGZvcmNlLnN0cmVuZ3RoID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHN0cmVuZ3RoID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudCgrXyksIGluaXRpYWxpemUoKSwgZm9yY2UpIDogc3RyZW5ndGg7XG4gIH07XG5cbiAgZm9yY2UueCA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/ICh4ID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudCgrXyksIGluaXRpYWxpemUoKSwgZm9yY2UpIDogeDtcbiAgfTtcblxuICByZXR1cm4gZm9yY2U7XG59XG4iLCAiaW1wb3J0IGNvbnN0YW50IGZyb20gXCIuL2NvbnN0YW50LmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHkpIHtcbiAgdmFyIHN0cmVuZ3RoID0gY29uc3RhbnQoMC4xKSxcbiAgICAgIG5vZGVzLFxuICAgICAgc3RyZW5ndGhzLFxuICAgICAgeXo7XG5cbiAgaWYgKHR5cGVvZiB5ICE9PSBcImZ1bmN0aW9uXCIpIHkgPSBjb25zdGFudCh5ID09IG51bGwgPyAwIDogK3kpO1xuXG4gIGZ1bmN0aW9uIGZvcmNlKGFscGhhKSB7XG4gICAgZm9yICh2YXIgaSA9IDAsIG4gPSBub2Rlcy5sZW5ndGgsIG5vZGU7IGkgPCBuOyArK2kpIHtcbiAgICAgIG5vZGUgPSBub2Rlc1tpXSwgbm9kZS52eSArPSAoeXpbaV0gLSBub2RlLnkpICogc3RyZW5ndGhzW2ldICogYWxwaGE7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gaW5pdGlhbGl6ZSgpIHtcbiAgICBpZiAoIW5vZGVzKSByZXR1cm47XG4gICAgdmFyIGksIG4gPSBub2Rlcy5sZW5ndGg7XG4gICAgc3RyZW5ndGhzID0gbmV3IEFycmF5KG4pO1xuICAgIHl6ID0gbmV3IEFycmF5KG4pO1xuICAgIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIHN0cmVuZ3Roc1tpXSA9IGlzTmFOKHl6W2ldID0gK3kobm9kZXNbaV0sIGksIG5vZGVzKSkgPyAwIDogK3N0cmVuZ3RoKG5vZGVzW2ldLCBpLCBub2Rlcyk7XG4gICAgfVxuICB9XG5cbiAgZm9yY2UuaW5pdGlhbGl6ZSA9IGZ1bmN0aW9uKF8pIHtcbiAgICBub2RlcyA9IF87XG4gICAgaW5pdGlhbGl6ZSgpO1xuICB9O1xuXG4gIGZvcmNlLnN0cmVuZ3RoID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHN0cmVuZ3RoID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudCgrXyksIGluaXRpYWxpemUoKSwgZm9yY2UpIDogc3RyZW5ndGg7XG4gIH07XG5cbiAgZm9yY2UueSA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/ICh5ID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudCgrXyksIGluaXRpYWxpemUoKSwgZm9yY2UpIDogeTtcbiAgfTtcblxuICByZXR1cm4gZm9yY2U7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgeCA9PiAoKSA9PiB4O1xuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIFpvb21FdmVudCh0eXBlLCB7XG4gIHNvdXJjZUV2ZW50LFxuICB0YXJnZXQsXG4gIHRyYW5zZm9ybSxcbiAgZGlzcGF0Y2hcbn0pIHtcbiAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXModGhpcywge1xuICAgIHR5cGU6IHt2YWx1ZTogdHlwZSwgZW51bWVyYWJsZTogdHJ1ZSwgY29uZmlndXJhYmxlOiB0cnVlfSxcbiAgICBzb3VyY2VFdmVudDoge3ZhbHVlOiBzb3VyY2VFdmVudCwgZW51bWVyYWJsZTogdHJ1ZSwgY29uZmlndXJhYmxlOiB0cnVlfSxcbiAgICB0YXJnZXQ6IHt2YWx1ZTogdGFyZ2V0LCBlbnVtZXJhYmxlOiB0cnVlLCBjb25maWd1cmFibGU6IHRydWV9LFxuICAgIHRyYW5zZm9ybToge3ZhbHVlOiB0cmFuc2Zvcm0sIGVudW1lcmFibGU6IHRydWUsIGNvbmZpZ3VyYWJsZTogdHJ1ZX0sXG4gICAgXzoge3ZhbHVlOiBkaXNwYXRjaH1cbiAgfSk7XG59XG4iLCAiZXhwb3J0IGZ1bmN0aW9uIFRyYW5zZm9ybShrLCB4LCB5KSB7XG4gIHRoaXMuayA9IGs7XG4gIHRoaXMueCA9IHg7XG4gIHRoaXMueSA9IHk7XG59XG5cblRyYW5zZm9ybS5wcm90b3R5cGUgPSB7XG4gIGNvbnN0cnVjdG9yOiBUcmFuc2Zvcm0sXG4gIHNjYWxlOiBmdW5jdGlvbihrKSB7XG4gICAgcmV0dXJuIGsgPT09IDEgPyB0aGlzIDogbmV3IFRyYW5zZm9ybSh0aGlzLmsgKiBrLCB0aGlzLngsIHRoaXMueSk7XG4gIH0sXG4gIHRyYW5zbGF0ZTogZnVuY3Rpb24oeCwgeSkge1xuICAgIHJldHVybiB4ID09PSAwICYgeSA9PT0gMCA/IHRoaXMgOiBuZXcgVHJhbnNmb3JtKHRoaXMuaywgdGhpcy54ICsgdGhpcy5rICogeCwgdGhpcy55ICsgdGhpcy5rICogeSk7XG4gIH0sXG4gIGFwcGx5OiBmdW5jdGlvbihwb2ludCkge1xuICAgIHJldHVybiBbcG9pbnRbMF0gKiB0aGlzLmsgKyB0aGlzLngsIHBvaW50WzFdICogdGhpcy5rICsgdGhpcy55XTtcbiAgfSxcbiAgYXBwbHlYOiBmdW5jdGlvbih4KSB7XG4gICAgcmV0dXJuIHggKiB0aGlzLmsgKyB0aGlzLng7XG4gIH0sXG4gIGFwcGx5WTogZnVuY3Rpb24oeSkge1xuICAgIHJldHVybiB5ICogdGhpcy5rICsgdGhpcy55O1xuICB9LFxuICBpbnZlcnQ6IGZ1bmN0aW9uKGxvY2F0aW9uKSB7XG4gICAgcmV0dXJuIFsobG9jYXRpb25bMF0gLSB0aGlzLngpIC8gdGhpcy5rLCAobG9jYXRpb25bMV0gLSB0aGlzLnkpIC8gdGhpcy5rXTtcbiAgfSxcbiAgaW52ZXJ0WDogZnVuY3Rpb24oeCkge1xuICAgIHJldHVybiAoeCAtIHRoaXMueCkgLyB0aGlzLms7XG4gIH0sXG4gIGludmVydFk6IGZ1bmN0aW9uKHkpIHtcbiAgICByZXR1cm4gKHkgLSB0aGlzLnkpIC8gdGhpcy5rO1xuICB9LFxuICByZXNjYWxlWDogZnVuY3Rpb24oeCkge1xuICAgIHJldHVybiB4LmNvcHkoKS5kb21haW4oeC5yYW5nZSgpLm1hcCh0aGlzLmludmVydFgsIHRoaXMpLm1hcCh4LmludmVydCwgeCkpO1xuICB9LFxuICByZXNjYWxlWTogZnVuY3Rpb24oeSkge1xuICAgIHJldHVybiB5LmNvcHkoKS5kb21haW4oeS5yYW5nZSgpLm1hcCh0aGlzLmludmVydFksIHRoaXMpLm1hcCh5LmludmVydCwgeSkpO1xuICB9LFxuICB0b1N0cmluZzogZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIFwidHJhbnNsYXRlKFwiICsgdGhpcy54ICsgXCIsXCIgKyB0aGlzLnkgKyBcIikgc2NhbGUoXCIgKyB0aGlzLmsgKyBcIilcIjtcbiAgfVxufTtcblxuZXhwb3J0IHZhciBpZGVudGl0eSA9IG5ldyBUcmFuc2Zvcm0oMSwgMCwgMCk7XG5cbnRyYW5zZm9ybS5wcm90b3R5cGUgPSBUcmFuc2Zvcm0ucHJvdG90eXBlO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiB0cmFuc2Zvcm0obm9kZSkge1xuICB3aGlsZSAoIW5vZGUuX196b29tKSBpZiAoIShub2RlID0gbm9kZS5wYXJlbnROb2RlKSkgcmV0dXJuIGlkZW50aXR5O1xuICByZXR1cm4gbm9kZS5fX3pvb207XG59XG4iLCAiZXhwb3J0IGZ1bmN0aW9uIG5vcHJvcGFnYXRpb24oZXZlbnQpIHtcbiAgZXZlbnQuc3RvcEltbWVkaWF0ZVByb3BhZ2F0aW9uKCk7XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGV2ZW50KSB7XG4gIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gIGV2ZW50LnN0b3BJbW1lZGlhdGVQcm9wYWdhdGlvbigpO1xufVxuIiwgImltcG9ydCB7ZGlzcGF0Y2h9IGZyb20gXCJkMy1kaXNwYXRjaFwiO1xuaW1wb3J0IHtkcmFnRGlzYWJsZSwgZHJhZ0VuYWJsZX0gZnJvbSBcImQzLWRyYWdcIjtcbmltcG9ydCB7aW50ZXJwb2xhdGVab29tfSBmcm9tIFwiZDMtaW50ZXJwb2xhdGVcIjtcbmltcG9ydCB7c2VsZWN0LCBwb2ludGVyfSBmcm9tIFwiZDMtc2VsZWN0aW9uXCI7XG5pbXBvcnQge2ludGVycnVwdH0gZnJvbSBcImQzLXRyYW5zaXRpb25cIjtcbmltcG9ydCBjb25zdGFudCBmcm9tIFwiLi9jb25zdGFudC5qc1wiO1xuaW1wb3J0IFpvb21FdmVudCBmcm9tIFwiLi9ldmVudC5qc1wiO1xuaW1wb3J0IHtUcmFuc2Zvcm0sIGlkZW50aXR5fSBmcm9tIFwiLi90cmFuc2Zvcm0uanNcIjtcbmltcG9ydCBub2V2ZW50LCB7bm9wcm9wYWdhdGlvbn0gZnJvbSBcIi4vbm9ldmVudC5qc1wiO1xuXG4vLyBJZ25vcmUgcmlnaHQtY2xpY2ssIHNpbmNlIHRoYXQgc2hvdWxkIG9wZW4gdGhlIGNvbnRleHQgbWVudS5cbi8vIGV4Y2VwdCBmb3IgcGluY2gtdG8tem9vbSwgd2hpY2ggaXMgc2VudCBhcyBhIHdoZWVsK2N0cmxLZXkgZXZlbnRcbmZ1bmN0aW9uIGRlZmF1bHRGaWx0ZXIoZXZlbnQpIHtcbiAgcmV0dXJuICghZXZlbnQuY3RybEtleSB8fCBldmVudC50eXBlID09PSAnd2hlZWwnKSAmJiAhZXZlbnQuYnV0dG9uO1xufVxuXG5mdW5jdGlvbiBkZWZhdWx0RXh0ZW50KCkge1xuICB2YXIgZSA9IHRoaXM7XG4gIGlmIChlIGluc3RhbmNlb2YgU1ZHRWxlbWVudCkge1xuICAgIGUgPSBlLm93bmVyU1ZHRWxlbWVudCB8fCBlO1xuICAgIGlmIChlLmhhc0F0dHJpYnV0ZShcInZpZXdCb3hcIikpIHtcbiAgICAgIGUgPSBlLnZpZXdCb3guYmFzZVZhbDtcbiAgICAgIHJldHVybiBbW2UueCwgZS55XSwgW2UueCArIGUud2lkdGgsIGUueSArIGUuaGVpZ2h0XV07XG4gICAgfVxuICAgIHJldHVybiBbWzAsIDBdLCBbZS53aWR0aC5iYXNlVmFsLnZhbHVlLCBlLmhlaWdodC5iYXNlVmFsLnZhbHVlXV07XG4gIH1cbiAgcmV0dXJuIFtbMCwgMF0sIFtlLmNsaWVudFdpZHRoLCBlLmNsaWVudEhlaWdodF1dO1xufVxuXG5mdW5jdGlvbiBkZWZhdWx0VHJhbnNmb3JtKCkge1xuICByZXR1cm4gdGhpcy5fX3pvb20gfHwgaWRlbnRpdHk7XG59XG5cbmZ1bmN0aW9uIGRlZmF1bHRXaGVlbERlbHRhKGV2ZW50KSB7XG4gIHJldHVybiAtZXZlbnQuZGVsdGFZICogKGV2ZW50LmRlbHRhTW9kZSA9PT0gMSA/IDAuMDUgOiBldmVudC5kZWx0YU1vZGUgPyAxIDogMC4wMDIpICogKGV2ZW50LmN0cmxLZXkgPyAxMCA6IDEpO1xufVxuXG5mdW5jdGlvbiBkZWZhdWx0VG91Y2hhYmxlKCkge1xuICByZXR1cm4gbmF2aWdhdG9yLm1heFRvdWNoUG9pbnRzIHx8IChcIm9udG91Y2hzdGFydFwiIGluIHRoaXMpO1xufVxuXG5mdW5jdGlvbiBkZWZhdWx0Q29uc3RyYWluKHRyYW5zZm9ybSwgZXh0ZW50LCB0cmFuc2xhdGVFeHRlbnQpIHtcbiAgdmFyIGR4MCA9IHRyYW5zZm9ybS5pbnZlcnRYKGV4dGVudFswXVswXSkgLSB0cmFuc2xhdGVFeHRlbnRbMF1bMF0sXG4gICAgICBkeDEgPSB0cmFuc2Zvcm0uaW52ZXJ0WChleHRlbnRbMV1bMF0pIC0gdHJhbnNsYXRlRXh0ZW50WzFdWzBdLFxuICAgICAgZHkwID0gdHJhbnNmb3JtLmludmVydFkoZXh0ZW50WzBdWzFdKSAtIHRyYW5zbGF0ZUV4dGVudFswXVsxXSxcbiAgICAgIGR5MSA9IHRyYW5zZm9ybS5pbnZlcnRZKGV4dGVudFsxXVsxXSkgLSB0cmFuc2xhdGVFeHRlbnRbMV1bMV07XG4gIHJldHVybiB0cmFuc2Zvcm0udHJhbnNsYXRlKFxuICAgIGR4MSA+IGR4MCA/IChkeDAgKyBkeDEpIC8gMiA6IE1hdGgubWluKDAsIGR4MCkgfHwgTWF0aC5tYXgoMCwgZHgxKSxcbiAgICBkeTEgPiBkeTAgPyAoZHkwICsgZHkxKSAvIDIgOiBNYXRoLm1pbigwLCBkeTApIHx8IE1hdGgubWF4KDAsIGR5MSlcbiAgKTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIHZhciBmaWx0ZXIgPSBkZWZhdWx0RmlsdGVyLFxuICAgICAgZXh0ZW50ID0gZGVmYXVsdEV4dGVudCxcbiAgICAgIGNvbnN0cmFpbiA9IGRlZmF1bHRDb25zdHJhaW4sXG4gICAgICB3aGVlbERlbHRhID0gZGVmYXVsdFdoZWVsRGVsdGEsXG4gICAgICB0b3VjaGFibGUgPSBkZWZhdWx0VG91Y2hhYmxlLFxuICAgICAgc2NhbGVFeHRlbnQgPSBbMCwgSW5maW5pdHldLFxuICAgICAgdHJhbnNsYXRlRXh0ZW50ID0gW1stSW5maW5pdHksIC1JbmZpbml0eV0sIFtJbmZpbml0eSwgSW5maW5pdHldXSxcbiAgICAgIGR1cmF0aW9uID0gMjUwLFxuICAgICAgaW50ZXJwb2xhdGUgPSBpbnRlcnBvbGF0ZVpvb20sXG4gICAgICBsaXN0ZW5lcnMgPSBkaXNwYXRjaChcInN0YXJ0XCIsIFwiem9vbVwiLCBcImVuZFwiKSxcbiAgICAgIHRvdWNoc3RhcnRpbmcsXG4gICAgICB0b3VjaGZpcnN0LFxuICAgICAgdG91Y2hlbmRpbmcsXG4gICAgICB0b3VjaERlbGF5ID0gNTAwLFxuICAgICAgd2hlZWxEZWxheSA9IDE1MCxcbiAgICAgIGNsaWNrRGlzdGFuY2UyID0gMCxcbiAgICAgIHRhcERpc3RhbmNlID0gMTA7XG5cbiAgZnVuY3Rpb24gem9vbShzZWxlY3Rpb24pIHtcbiAgICBzZWxlY3Rpb25cbiAgICAgICAgLnByb3BlcnR5KFwiX196b29tXCIsIGRlZmF1bHRUcmFuc2Zvcm0pXG4gICAgICAgIC5vbihcIndoZWVsLnpvb21cIiwgd2hlZWxlZCwge3Bhc3NpdmU6IGZhbHNlfSlcbiAgICAgICAgLm9uKFwibW91c2Vkb3duLnpvb21cIiwgbW91c2Vkb3duZWQpXG4gICAgICAgIC5vbihcImRibGNsaWNrLnpvb21cIiwgZGJsY2xpY2tlZClcbiAgICAgIC5maWx0ZXIodG91Y2hhYmxlKVxuICAgICAgICAub24oXCJ0b3VjaHN0YXJ0Lnpvb21cIiwgdG91Y2hzdGFydGVkKVxuICAgICAgICAub24oXCJ0b3VjaG1vdmUuem9vbVwiLCB0b3VjaG1vdmVkKVxuICAgICAgICAub24oXCJ0b3VjaGVuZC56b29tIHRvdWNoY2FuY2VsLnpvb21cIiwgdG91Y2hlbmRlZClcbiAgICAgICAgLnN0eWxlKFwiLXdlYmtpdC10YXAtaGlnaGxpZ2h0LWNvbG9yXCIsIFwicmdiYSgwLDAsMCwwKVwiKTtcbiAgfVxuXG4gIHpvb20udHJhbnNmb3JtID0gZnVuY3Rpb24oY29sbGVjdGlvbiwgdHJhbnNmb3JtLCBwb2ludCwgZXZlbnQpIHtcbiAgICB2YXIgc2VsZWN0aW9uID0gY29sbGVjdGlvbi5zZWxlY3Rpb24gPyBjb2xsZWN0aW9uLnNlbGVjdGlvbigpIDogY29sbGVjdGlvbjtcbiAgICBzZWxlY3Rpb24ucHJvcGVydHkoXCJfX3pvb21cIiwgZGVmYXVsdFRyYW5zZm9ybSk7XG4gICAgaWYgKGNvbGxlY3Rpb24gIT09IHNlbGVjdGlvbikge1xuICAgICAgc2NoZWR1bGUoY29sbGVjdGlvbiwgdHJhbnNmb3JtLCBwb2ludCwgZXZlbnQpO1xuICAgIH0gZWxzZSB7XG4gICAgICBzZWxlY3Rpb24uaW50ZXJydXB0KCkuZWFjaChmdW5jdGlvbigpIHtcbiAgICAgICAgZ2VzdHVyZSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgLmV2ZW50KGV2ZW50KVxuICAgICAgICAgIC5zdGFydCgpXG4gICAgICAgICAgLnpvb20obnVsbCwgdHlwZW9mIHRyYW5zZm9ybSA9PT0gXCJmdW5jdGlvblwiID8gdHJhbnNmb3JtLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgOiB0cmFuc2Zvcm0pXG4gICAgICAgICAgLmVuZCgpO1xuICAgICAgfSk7XG4gICAgfVxuICB9O1xuXG4gIHpvb20uc2NhbGVCeSA9IGZ1bmN0aW9uKHNlbGVjdGlvbiwgaywgcCwgZXZlbnQpIHtcbiAgICB6b29tLnNjYWxlVG8oc2VsZWN0aW9uLCBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBrMCA9IHRoaXMuX196b29tLmssXG4gICAgICAgICAgazEgPSB0eXBlb2YgayA9PT0gXCJmdW5jdGlvblwiID8gay5hcHBseSh0aGlzLCBhcmd1bWVudHMpIDogaztcbiAgICAgIHJldHVybiBrMCAqIGsxO1xuICAgIH0sIHAsIGV2ZW50KTtcbiAgfTtcblxuICB6b29tLnNjYWxlVG8gPSBmdW5jdGlvbihzZWxlY3Rpb24sIGssIHAsIGV2ZW50KSB7XG4gICAgem9vbS50cmFuc2Zvcm0oc2VsZWN0aW9uLCBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBlID0gZXh0ZW50LmFwcGx5KHRoaXMsIGFyZ3VtZW50cyksXG4gICAgICAgICAgdDAgPSB0aGlzLl9fem9vbSxcbiAgICAgICAgICBwMCA9IHAgPT0gbnVsbCA/IGNlbnRyb2lkKGUpIDogdHlwZW9mIHAgPT09IFwiZnVuY3Rpb25cIiA/IHAuYXBwbHkodGhpcywgYXJndW1lbnRzKSA6IHAsXG4gICAgICAgICAgcDEgPSB0MC5pbnZlcnQocDApLFxuICAgICAgICAgIGsxID0gdHlwZW9mIGsgPT09IFwiZnVuY3Rpb25cIiA/IGsuYXBwbHkodGhpcywgYXJndW1lbnRzKSA6IGs7XG4gICAgICByZXR1cm4gY29uc3RyYWluKHRyYW5zbGF0ZShzY2FsZSh0MCwgazEpLCBwMCwgcDEpLCBlLCB0cmFuc2xhdGVFeHRlbnQpO1xuICAgIH0sIHAsIGV2ZW50KTtcbiAgfTtcblxuICB6b29tLnRyYW5zbGF0ZUJ5ID0gZnVuY3Rpb24oc2VsZWN0aW9uLCB4LCB5LCBldmVudCkge1xuICAgIHpvb20udHJhbnNmb3JtKHNlbGVjdGlvbiwgZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gY29uc3RyYWluKHRoaXMuX196b29tLnRyYW5zbGF0ZShcbiAgICAgICAgdHlwZW9mIHggPT09IFwiZnVuY3Rpb25cIiA/IHguYXBwbHkodGhpcywgYXJndW1lbnRzKSA6IHgsXG4gICAgICAgIHR5cGVvZiB5ID09PSBcImZ1bmN0aW9uXCIgPyB5LmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgOiB5XG4gICAgICApLCBleHRlbnQuYXBwbHkodGhpcywgYXJndW1lbnRzKSwgdHJhbnNsYXRlRXh0ZW50KTtcbiAgICB9LCBudWxsLCBldmVudCk7XG4gIH07XG5cbiAgem9vbS50cmFuc2xhdGVUbyA9IGZ1bmN0aW9uKHNlbGVjdGlvbiwgeCwgeSwgcCwgZXZlbnQpIHtcbiAgICB6b29tLnRyYW5zZm9ybShzZWxlY3Rpb24sIGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIGUgPSBleHRlbnQuYXBwbHkodGhpcywgYXJndW1lbnRzKSxcbiAgICAgICAgICB0ID0gdGhpcy5fX3pvb20sXG4gICAgICAgICAgcDAgPSBwID09IG51bGwgPyBjZW50cm9pZChlKSA6IHR5cGVvZiBwID09PSBcImZ1bmN0aW9uXCIgPyBwLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgOiBwO1xuICAgICAgcmV0dXJuIGNvbnN0cmFpbihpZGVudGl0eS50cmFuc2xhdGUocDBbMF0sIHAwWzFdKS5zY2FsZSh0LmspLnRyYW5zbGF0ZShcbiAgICAgICAgdHlwZW9mIHggPT09IFwiZnVuY3Rpb25cIiA/IC14LmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgOiAteCxcbiAgICAgICAgdHlwZW9mIHkgPT09IFwiZnVuY3Rpb25cIiA/IC15LmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgOiAteVxuICAgICAgKSwgZSwgdHJhbnNsYXRlRXh0ZW50KTtcbiAgICB9LCBwLCBldmVudCk7XG4gIH07XG5cbiAgZnVuY3Rpb24gc2NhbGUodHJhbnNmb3JtLCBrKSB7XG4gICAgayA9IE1hdGgubWF4KHNjYWxlRXh0ZW50WzBdLCBNYXRoLm1pbihzY2FsZUV4dGVudFsxXSwgaykpO1xuICAgIHJldHVybiBrID09PSB0cmFuc2Zvcm0uayA/IHRyYW5zZm9ybSA6IG5ldyBUcmFuc2Zvcm0oaywgdHJhbnNmb3JtLngsIHRyYW5zZm9ybS55KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHRyYW5zbGF0ZSh0cmFuc2Zvcm0sIHAwLCBwMSkge1xuICAgIHZhciB4ID0gcDBbMF0gLSBwMVswXSAqIHRyYW5zZm9ybS5rLCB5ID0gcDBbMV0gLSBwMVsxXSAqIHRyYW5zZm9ybS5rO1xuICAgIHJldHVybiB4ID09PSB0cmFuc2Zvcm0ueCAmJiB5ID09PSB0cmFuc2Zvcm0ueSA/IHRyYW5zZm9ybSA6IG5ldyBUcmFuc2Zvcm0odHJhbnNmb3JtLmssIHgsIHkpO1xuICB9XG5cbiAgZnVuY3Rpb24gY2VudHJvaWQoZXh0ZW50KSB7XG4gICAgcmV0dXJuIFsoK2V4dGVudFswXVswXSArICtleHRlbnRbMV1bMF0pIC8gMiwgKCtleHRlbnRbMF1bMV0gKyArZXh0ZW50WzFdWzFdKSAvIDJdO1xuICB9XG5cbiAgZnVuY3Rpb24gc2NoZWR1bGUodHJhbnNpdGlvbiwgdHJhbnNmb3JtLCBwb2ludCwgZXZlbnQpIHtcbiAgICB0cmFuc2l0aW9uXG4gICAgICAgIC5vbihcInN0YXJ0Lnpvb21cIiwgZnVuY3Rpb24oKSB7IGdlc3R1cmUodGhpcywgYXJndW1lbnRzKS5ldmVudChldmVudCkuc3RhcnQoKTsgfSlcbiAgICAgICAgLm9uKFwiaW50ZXJydXB0Lnpvb20gZW5kLnpvb21cIiwgZnVuY3Rpb24oKSB7IGdlc3R1cmUodGhpcywgYXJndW1lbnRzKS5ldmVudChldmVudCkuZW5kKCk7IH0pXG4gICAgICAgIC50d2VlbihcInpvb21cIiwgZnVuY3Rpb24oKSB7XG4gICAgICAgICAgdmFyIHRoYXQgPSB0aGlzLFxuICAgICAgICAgICAgICBhcmdzID0gYXJndW1lbnRzLFxuICAgICAgICAgICAgICBnID0gZ2VzdHVyZSh0aGF0LCBhcmdzKS5ldmVudChldmVudCksXG4gICAgICAgICAgICAgIGUgPSBleHRlbnQuYXBwbHkodGhhdCwgYXJncyksXG4gICAgICAgICAgICAgIHAgPSBwb2ludCA9PSBudWxsID8gY2VudHJvaWQoZSkgOiB0eXBlb2YgcG9pbnQgPT09IFwiZnVuY3Rpb25cIiA/IHBvaW50LmFwcGx5KHRoYXQsIGFyZ3MpIDogcG9pbnQsXG4gICAgICAgICAgICAgIHcgPSBNYXRoLm1heChlWzFdWzBdIC0gZVswXVswXSwgZVsxXVsxXSAtIGVbMF1bMV0pLFxuICAgICAgICAgICAgICBhID0gdGhhdC5fX3pvb20sXG4gICAgICAgICAgICAgIGIgPSB0eXBlb2YgdHJhbnNmb3JtID09PSBcImZ1bmN0aW9uXCIgPyB0cmFuc2Zvcm0uYXBwbHkodGhhdCwgYXJncykgOiB0cmFuc2Zvcm0sXG4gICAgICAgICAgICAgIGkgPSBpbnRlcnBvbGF0ZShhLmludmVydChwKS5jb25jYXQodyAvIGEuayksIGIuaW52ZXJ0KHApLmNvbmNhdCh3IC8gYi5rKSk7XG4gICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uKHQpIHtcbiAgICAgICAgICAgIGlmICh0ID09PSAxKSB0ID0gYjsgLy8gQXZvaWQgcm91bmRpbmcgZXJyb3Igb24gZW5kLlxuICAgICAgICAgICAgZWxzZSB7IHZhciBsID0gaSh0KSwgayA9IHcgLyBsWzJdOyB0ID0gbmV3IFRyYW5zZm9ybShrLCBwWzBdIC0gbFswXSAqIGssIHBbMV0gLSBsWzFdICogayk7IH1cbiAgICAgICAgICAgIGcuem9vbShudWxsLCB0KTtcbiAgICAgICAgICB9O1xuICAgICAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGdlc3R1cmUodGhhdCwgYXJncywgY2xlYW4pIHtcbiAgICByZXR1cm4gKCFjbGVhbiAmJiB0aGF0Ll9fem9vbWluZykgfHwgbmV3IEdlc3R1cmUodGhhdCwgYXJncyk7XG4gIH1cblxuICBmdW5jdGlvbiBHZXN0dXJlKHRoYXQsIGFyZ3MpIHtcbiAgICB0aGlzLnRoYXQgPSB0aGF0O1xuICAgIHRoaXMuYXJncyA9IGFyZ3M7XG4gICAgdGhpcy5hY3RpdmUgPSAwO1xuICAgIHRoaXMuc291cmNlRXZlbnQgPSBudWxsO1xuICAgIHRoaXMuZXh0ZW50ID0gZXh0ZW50LmFwcGx5KHRoYXQsIGFyZ3MpO1xuICAgIHRoaXMudGFwcyA9IDA7XG4gIH1cblxuICBHZXN0dXJlLnByb3RvdHlwZSA9IHtcbiAgICBldmVudDogZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgIGlmIChldmVudCkgdGhpcy5zb3VyY2VFdmVudCA9IGV2ZW50O1xuICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfSxcbiAgICBzdGFydDogZnVuY3Rpb24oKSB7XG4gICAgICBpZiAoKyt0aGlzLmFjdGl2ZSA9PT0gMSkge1xuICAgICAgICB0aGlzLnRoYXQuX196b29taW5nID0gdGhpcztcbiAgICAgICAgdGhpcy5lbWl0KFwic3RhcnRcIik7XG4gICAgICB9XG4gICAgICByZXR1cm4gdGhpcztcbiAgICB9LFxuICAgIHpvb206IGZ1bmN0aW9uKGtleSwgdHJhbnNmb3JtKSB7XG4gICAgICBpZiAodGhpcy5tb3VzZSAmJiBrZXkgIT09IFwibW91c2VcIikgdGhpcy5tb3VzZVsxXSA9IHRyYW5zZm9ybS5pbnZlcnQodGhpcy5tb3VzZVswXSk7XG4gICAgICBpZiAodGhpcy50b3VjaDAgJiYga2V5ICE9PSBcInRvdWNoXCIpIHRoaXMudG91Y2gwWzFdID0gdHJhbnNmb3JtLmludmVydCh0aGlzLnRvdWNoMFswXSk7XG4gICAgICBpZiAodGhpcy50b3VjaDEgJiYga2V5ICE9PSBcInRvdWNoXCIpIHRoaXMudG91Y2gxWzFdID0gdHJhbnNmb3JtLmludmVydCh0aGlzLnRvdWNoMVswXSk7XG4gICAgICB0aGlzLnRoYXQuX196b29tID0gdHJhbnNmb3JtO1xuICAgICAgdGhpcy5lbWl0KFwiem9vbVwiKTtcbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH0sXG4gICAgZW5kOiBmdW5jdGlvbigpIHtcbiAgICAgIGlmICgtLXRoaXMuYWN0aXZlID09PSAwKSB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLnRoYXQuX196b29taW5nO1xuICAgICAgICB0aGlzLmVtaXQoXCJlbmRcIik7XG4gICAgICB9XG4gICAgICByZXR1cm4gdGhpcztcbiAgICB9LFxuICAgIGVtaXQ6IGZ1bmN0aW9uKHR5cGUpIHtcbiAgICAgIHZhciBkID0gc2VsZWN0KHRoaXMudGhhdCkuZGF0dW0oKTtcbiAgICAgIGxpc3RlbmVycy5jYWxsKFxuICAgICAgICB0eXBlLFxuICAgICAgICB0aGlzLnRoYXQsXG4gICAgICAgIG5ldyBab29tRXZlbnQodHlwZSwge1xuICAgICAgICAgIHNvdXJjZUV2ZW50OiB0aGlzLnNvdXJjZUV2ZW50LFxuICAgICAgICAgIHRhcmdldDogem9vbSxcbiAgICAgICAgICB0eXBlLFxuICAgICAgICAgIHRyYW5zZm9ybTogdGhpcy50aGF0Ll9fem9vbSxcbiAgICAgICAgICBkaXNwYXRjaDogbGlzdGVuZXJzXG4gICAgICAgIH0pLFxuICAgICAgICBkXG4gICAgICApO1xuICAgIH1cbiAgfTtcblxuICBmdW5jdGlvbiB3aGVlbGVkKGV2ZW50LCAuLi5hcmdzKSB7XG4gICAgaWYgKCFmaWx0ZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKSkgcmV0dXJuO1xuICAgIHZhciBnID0gZ2VzdHVyZSh0aGlzLCBhcmdzKS5ldmVudChldmVudCksXG4gICAgICAgIHQgPSB0aGlzLl9fem9vbSxcbiAgICAgICAgayA9IE1hdGgubWF4KHNjYWxlRXh0ZW50WzBdLCBNYXRoLm1pbihzY2FsZUV4dGVudFsxXSwgdC5rICogTWF0aC5wb3coMiwgd2hlZWxEZWx0YS5hcHBseSh0aGlzLCBhcmd1bWVudHMpKSkpLFxuICAgICAgICBwID0gcG9pbnRlcihldmVudCk7XG5cbiAgICAvLyBJZiB0aGUgbW91c2UgaXMgaW4gdGhlIHNhbWUgbG9jYXRpb24gYXMgYmVmb3JlLCByZXVzZSBpdC5cbiAgICAvLyBJZiB0aGVyZSB3ZXJlIHJlY2VudCB3aGVlbCBldmVudHMsIHJlc2V0IHRoZSB3aGVlbCBpZGxlIHRpbWVvdXQuXG4gICAgaWYgKGcud2hlZWwpIHtcbiAgICAgIGlmIChnLm1vdXNlWzBdWzBdICE9PSBwWzBdIHx8IGcubW91c2VbMF1bMV0gIT09IHBbMV0pIHtcbiAgICAgICAgZy5tb3VzZVsxXSA9IHQuaW52ZXJ0KGcubW91c2VbMF0gPSBwKTtcbiAgICAgIH1cbiAgICAgIGNsZWFyVGltZW91dChnLndoZWVsKTtcbiAgICB9XG5cbiAgICAvLyBJZiB0aGlzIHdoZWVsIGV2ZW50IHdvblx1MjAxOXQgdHJpZ2dlciBhIHRyYW5zZm9ybSBjaGFuZ2UsIGlnbm9yZSBpdC5cbiAgICBlbHNlIGlmICh0LmsgPT09IGspIHJldHVybjtcblxuICAgIC8vIE90aGVyd2lzZSwgY2FwdHVyZSB0aGUgbW91c2UgcG9pbnQgYW5kIGxvY2F0aW9uIGF0IHRoZSBzdGFydC5cbiAgICBlbHNlIHtcbiAgICAgIGcubW91c2UgPSBbcCwgdC5pbnZlcnQocCldO1xuICAgICAgaW50ZXJydXB0KHRoaXMpO1xuICAgICAgZy5zdGFydCgpO1xuICAgIH1cblxuICAgIG5vZXZlbnQoZXZlbnQpO1xuICAgIGcud2hlZWwgPSBzZXRUaW1lb3V0KHdoZWVsaWRsZWQsIHdoZWVsRGVsYXkpO1xuICAgIGcuem9vbShcIm1vdXNlXCIsIGNvbnN0cmFpbih0cmFuc2xhdGUoc2NhbGUodCwgayksIGcubW91c2VbMF0sIGcubW91c2VbMV0pLCBnLmV4dGVudCwgdHJhbnNsYXRlRXh0ZW50KSk7XG5cbiAgICBmdW5jdGlvbiB3aGVlbGlkbGVkKCkge1xuICAgICAgZy53aGVlbCA9IG51bGw7XG4gICAgICBnLmVuZCgpO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIG1vdXNlZG93bmVkKGV2ZW50LCAuLi5hcmdzKSB7XG4gICAgaWYgKHRvdWNoZW5kaW5nIHx8ICFmaWx0ZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKSkgcmV0dXJuO1xuICAgIHZhciBjdXJyZW50VGFyZ2V0ID0gZXZlbnQuY3VycmVudFRhcmdldCxcbiAgICAgICAgZyA9IGdlc3R1cmUodGhpcywgYXJncywgdHJ1ZSkuZXZlbnQoZXZlbnQpLFxuICAgICAgICB2ID0gc2VsZWN0KGV2ZW50LnZpZXcpLm9uKFwibW91c2Vtb3ZlLnpvb21cIiwgbW91c2Vtb3ZlZCwgdHJ1ZSkub24oXCJtb3VzZXVwLnpvb21cIiwgbW91c2V1cHBlZCwgdHJ1ZSksXG4gICAgICAgIHAgPSBwb2ludGVyKGV2ZW50LCBjdXJyZW50VGFyZ2V0KSxcbiAgICAgICAgeDAgPSBldmVudC5jbGllbnRYLFxuICAgICAgICB5MCA9IGV2ZW50LmNsaWVudFk7XG5cbiAgICBkcmFnRGlzYWJsZShldmVudC52aWV3KTtcbiAgICBub3Byb3BhZ2F0aW9uKGV2ZW50KTtcbiAgICBnLm1vdXNlID0gW3AsIHRoaXMuX196b29tLmludmVydChwKV07XG4gICAgaW50ZXJydXB0KHRoaXMpO1xuICAgIGcuc3RhcnQoKTtcblxuICAgIGZ1bmN0aW9uIG1vdXNlbW92ZWQoZXZlbnQpIHtcbiAgICAgIG5vZXZlbnQoZXZlbnQpO1xuICAgICAgaWYgKCFnLm1vdmVkKSB7XG4gICAgICAgIHZhciBkeCA9IGV2ZW50LmNsaWVudFggLSB4MCwgZHkgPSBldmVudC5jbGllbnRZIC0geTA7XG4gICAgICAgIGcubW92ZWQgPSBkeCAqIGR4ICsgZHkgKiBkeSA+IGNsaWNrRGlzdGFuY2UyO1xuICAgICAgfVxuICAgICAgZy5ldmVudChldmVudClcbiAgICAgICAuem9vbShcIm1vdXNlXCIsIGNvbnN0cmFpbih0cmFuc2xhdGUoZy50aGF0Ll9fem9vbSwgZy5tb3VzZVswXSA9IHBvaW50ZXIoZXZlbnQsIGN1cnJlbnRUYXJnZXQpLCBnLm1vdXNlWzFdKSwgZy5leHRlbnQsIHRyYW5zbGF0ZUV4dGVudCkpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG1vdXNldXBwZWQoZXZlbnQpIHtcbiAgICAgIHYub24oXCJtb3VzZW1vdmUuem9vbSBtb3VzZXVwLnpvb21cIiwgbnVsbCk7XG4gICAgICBkcmFnRW5hYmxlKGV2ZW50LnZpZXcsIGcubW92ZWQpO1xuICAgICAgbm9ldmVudChldmVudCk7XG4gICAgICBnLmV2ZW50KGV2ZW50KS5lbmQoKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBkYmxjbGlja2VkKGV2ZW50LCAuLi5hcmdzKSB7XG4gICAgaWYgKCFmaWx0ZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKSkgcmV0dXJuO1xuICAgIHZhciB0MCA9IHRoaXMuX196b29tLFxuICAgICAgICBwMCA9IHBvaW50ZXIoZXZlbnQuY2hhbmdlZFRvdWNoZXMgPyBldmVudC5jaGFuZ2VkVG91Y2hlc1swXSA6IGV2ZW50LCB0aGlzKSxcbiAgICAgICAgcDEgPSB0MC5pbnZlcnQocDApLFxuICAgICAgICBrMSA9IHQwLmsgKiAoZXZlbnQuc2hpZnRLZXkgPyAwLjUgOiAyKSxcbiAgICAgICAgdDEgPSBjb25zdHJhaW4odHJhbnNsYXRlKHNjYWxlKHQwLCBrMSksIHAwLCBwMSksIGV4dGVudC5hcHBseSh0aGlzLCBhcmdzKSwgdHJhbnNsYXRlRXh0ZW50KTtcblxuICAgIG5vZXZlbnQoZXZlbnQpO1xuICAgIGlmIChkdXJhdGlvbiA+IDApIHNlbGVjdCh0aGlzKS50cmFuc2l0aW9uKCkuZHVyYXRpb24oZHVyYXRpb24pLmNhbGwoc2NoZWR1bGUsIHQxLCBwMCwgZXZlbnQpO1xuICAgIGVsc2Ugc2VsZWN0KHRoaXMpLmNhbGwoem9vbS50cmFuc2Zvcm0sIHQxLCBwMCwgZXZlbnQpO1xuICB9XG5cbiAgZnVuY3Rpb24gdG91Y2hzdGFydGVkKGV2ZW50LCAuLi5hcmdzKSB7XG4gICAgaWYgKCFmaWx0ZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKSkgcmV0dXJuO1xuICAgIHZhciB0b3VjaGVzID0gZXZlbnQudG91Y2hlcyxcbiAgICAgICAgbiA9IHRvdWNoZXMubGVuZ3RoLFxuICAgICAgICBnID0gZ2VzdHVyZSh0aGlzLCBhcmdzLCBldmVudC5jaGFuZ2VkVG91Y2hlcy5sZW5ndGggPT09IG4pLmV2ZW50KGV2ZW50KSxcbiAgICAgICAgc3RhcnRlZCwgaSwgdCwgcDtcblxuICAgIG5vcHJvcGFnYXRpb24oZXZlbnQpO1xuICAgIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIHQgPSB0b3VjaGVzW2ldLCBwID0gcG9pbnRlcih0LCB0aGlzKTtcbiAgICAgIHAgPSBbcCwgdGhpcy5fX3pvb20uaW52ZXJ0KHApLCB0LmlkZW50aWZpZXJdO1xuICAgICAgaWYgKCFnLnRvdWNoMCkgZy50b3VjaDAgPSBwLCBzdGFydGVkID0gdHJ1ZSwgZy50YXBzID0gMSArICEhdG91Y2hzdGFydGluZztcbiAgICAgIGVsc2UgaWYgKCFnLnRvdWNoMSAmJiBnLnRvdWNoMFsyXSAhPT0gcFsyXSkgZy50b3VjaDEgPSBwLCBnLnRhcHMgPSAwO1xuICAgIH1cblxuICAgIGlmICh0b3VjaHN0YXJ0aW5nKSB0b3VjaHN0YXJ0aW5nID0gY2xlYXJUaW1lb3V0KHRvdWNoc3RhcnRpbmcpO1xuXG4gICAgaWYgKHN0YXJ0ZWQpIHtcbiAgICAgIGlmIChnLnRhcHMgPCAyKSB0b3VjaGZpcnN0ID0gcFswXSwgdG91Y2hzdGFydGluZyA9IHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7IHRvdWNoc3RhcnRpbmcgPSBudWxsOyB9LCB0b3VjaERlbGF5KTtcbiAgICAgIGludGVycnVwdCh0aGlzKTtcbiAgICAgIGcuc3RhcnQoKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiB0b3VjaG1vdmVkKGV2ZW50LCAuLi5hcmdzKSB7XG4gICAgaWYgKCF0aGlzLl9fem9vbWluZykgcmV0dXJuO1xuICAgIHZhciBnID0gZ2VzdHVyZSh0aGlzLCBhcmdzKS5ldmVudChldmVudCksXG4gICAgICAgIHRvdWNoZXMgPSBldmVudC5jaGFuZ2VkVG91Y2hlcyxcbiAgICAgICAgbiA9IHRvdWNoZXMubGVuZ3RoLCBpLCB0LCBwLCBsO1xuXG4gICAgbm9ldmVudChldmVudCk7XG4gICAgZm9yIChpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgdCA9IHRvdWNoZXNbaV0sIHAgPSBwb2ludGVyKHQsIHRoaXMpO1xuICAgICAgaWYgKGcudG91Y2gwICYmIGcudG91Y2gwWzJdID09PSB0LmlkZW50aWZpZXIpIGcudG91Y2gwWzBdID0gcDtcbiAgICAgIGVsc2UgaWYgKGcudG91Y2gxICYmIGcudG91Y2gxWzJdID09PSB0LmlkZW50aWZpZXIpIGcudG91Y2gxWzBdID0gcDtcbiAgICB9XG4gICAgdCA9IGcudGhhdC5fX3pvb207XG4gICAgaWYgKGcudG91Y2gxKSB7XG4gICAgICB2YXIgcDAgPSBnLnRvdWNoMFswXSwgbDAgPSBnLnRvdWNoMFsxXSxcbiAgICAgICAgICBwMSA9IGcudG91Y2gxWzBdLCBsMSA9IGcudG91Y2gxWzFdLFxuICAgICAgICAgIGRwID0gKGRwID0gcDFbMF0gLSBwMFswXSkgKiBkcCArIChkcCA9IHAxWzFdIC0gcDBbMV0pICogZHAsXG4gICAgICAgICAgZGwgPSAoZGwgPSBsMVswXSAtIGwwWzBdKSAqIGRsICsgKGRsID0gbDFbMV0gLSBsMFsxXSkgKiBkbDtcbiAgICAgIHQgPSBzY2FsZSh0LCBNYXRoLnNxcnQoZHAgLyBkbCkpO1xuICAgICAgcCA9IFsocDBbMF0gKyBwMVswXSkgLyAyLCAocDBbMV0gKyBwMVsxXSkgLyAyXTtcbiAgICAgIGwgPSBbKGwwWzBdICsgbDFbMF0pIC8gMiwgKGwwWzFdICsgbDFbMV0pIC8gMl07XG4gICAgfVxuICAgIGVsc2UgaWYgKGcudG91Y2gwKSBwID0gZy50b3VjaDBbMF0sIGwgPSBnLnRvdWNoMFsxXTtcbiAgICBlbHNlIHJldHVybjtcblxuICAgIGcuem9vbShcInRvdWNoXCIsIGNvbnN0cmFpbih0cmFuc2xhdGUodCwgcCwgbCksIGcuZXh0ZW50LCB0cmFuc2xhdGVFeHRlbnQpKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHRvdWNoZW5kZWQoZXZlbnQsIC4uLmFyZ3MpIHtcbiAgICBpZiAoIXRoaXMuX196b29taW5nKSByZXR1cm47XG4gICAgdmFyIGcgPSBnZXN0dXJlKHRoaXMsIGFyZ3MpLmV2ZW50KGV2ZW50KSxcbiAgICAgICAgdG91Y2hlcyA9IGV2ZW50LmNoYW5nZWRUb3VjaGVzLFxuICAgICAgICBuID0gdG91Y2hlcy5sZW5ndGgsIGksIHQ7XG5cbiAgICBub3Byb3BhZ2F0aW9uKGV2ZW50KTtcbiAgICBpZiAodG91Y2hlbmRpbmcpIGNsZWFyVGltZW91dCh0b3VjaGVuZGluZyk7XG4gICAgdG91Y2hlbmRpbmcgPSBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkgeyB0b3VjaGVuZGluZyA9IG51bGw7IH0sIHRvdWNoRGVsYXkpO1xuICAgIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIHQgPSB0b3VjaGVzW2ldO1xuICAgICAgaWYgKGcudG91Y2gwICYmIGcudG91Y2gwWzJdID09PSB0LmlkZW50aWZpZXIpIGRlbGV0ZSBnLnRvdWNoMDtcbiAgICAgIGVsc2UgaWYgKGcudG91Y2gxICYmIGcudG91Y2gxWzJdID09PSB0LmlkZW50aWZpZXIpIGRlbGV0ZSBnLnRvdWNoMTtcbiAgICB9XG4gICAgaWYgKGcudG91Y2gxICYmICFnLnRvdWNoMCkgZy50b3VjaDAgPSBnLnRvdWNoMSwgZGVsZXRlIGcudG91Y2gxO1xuICAgIGlmIChnLnRvdWNoMCkgZy50b3VjaDBbMV0gPSB0aGlzLl9fem9vbS5pbnZlcnQoZy50b3VjaDBbMF0pO1xuICAgIGVsc2Uge1xuICAgICAgZy5lbmQoKTtcbiAgICAgIC8vIElmIHRoaXMgd2FzIGEgZGJsdGFwLCByZXJvdXRlIHRvIHRoZSAob3B0aW9uYWwpIGRibGNsaWNrLnpvb20gaGFuZGxlci5cbiAgICAgIGlmIChnLnRhcHMgPT09IDIpIHtcbiAgICAgICAgdCA9IHBvaW50ZXIodCwgdGhpcyk7XG4gICAgICAgIGlmIChNYXRoLmh5cG90KHRvdWNoZmlyc3RbMF0gLSB0WzBdLCB0b3VjaGZpcnN0WzFdIC0gdFsxXSkgPCB0YXBEaXN0YW5jZSkge1xuICAgICAgICAgIHZhciBwID0gc2VsZWN0KHRoaXMpLm9uKFwiZGJsY2xpY2suem9vbVwiKTtcbiAgICAgICAgICBpZiAocCkgcC5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgem9vbS53aGVlbERlbHRhID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHdoZWVsRGVsdGEgPSB0eXBlb2YgXyA9PT0gXCJmdW5jdGlvblwiID8gXyA6IGNvbnN0YW50KCtfKSwgem9vbSkgOiB3aGVlbERlbHRhO1xuICB9O1xuXG4gIHpvb20uZmlsdGVyID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGZpbHRlciA9IHR5cGVvZiBfID09PSBcImZ1bmN0aW9uXCIgPyBfIDogY29uc3RhbnQoISFfKSwgem9vbSkgOiBmaWx0ZXI7XG4gIH07XG5cbiAgem9vbS50b3VjaGFibGUgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAodG91Y2hhYmxlID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudCghIV8pLCB6b29tKSA6IHRvdWNoYWJsZTtcbiAgfTtcblxuICB6b29tLmV4dGVudCA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChleHRlbnQgPSB0eXBlb2YgXyA9PT0gXCJmdW5jdGlvblwiID8gXyA6IGNvbnN0YW50KFtbK19bMF1bMF0sICtfWzBdWzFdXSwgWytfWzFdWzBdLCArX1sxXVsxXV1dKSwgem9vbSkgOiBleHRlbnQ7XG4gIH07XG5cbiAgem9vbS5zY2FsZUV4dGVudCA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChzY2FsZUV4dGVudFswXSA9ICtfWzBdLCBzY2FsZUV4dGVudFsxXSA9ICtfWzFdLCB6b29tKSA6IFtzY2FsZUV4dGVudFswXSwgc2NhbGVFeHRlbnRbMV1dO1xuICB9O1xuXG4gIHpvb20udHJhbnNsYXRlRXh0ZW50ID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHRyYW5zbGF0ZUV4dGVudFswXVswXSA9ICtfWzBdWzBdLCB0cmFuc2xhdGVFeHRlbnRbMV1bMF0gPSArX1sxXVswXSwgdHJhbnNsYXRlRXh0ZW50WzBdWzFdID0gK19bMF1bMV0sIHRyYW5zbGF0ZUV4dGVudFsxXVsxXSA9ICtfWzFdWzFdLCB6b29tKSA6IFtbdHJhbnNsYXRlRXh0ZW50WzBdWzBdLCB0cmFuc2xhdGVFeHRlbnRbMF1bMV1dLCBbdHJhbnNsYXRlRXh0ZW50WzFdWzBdLCB0cmFuc2xhdGVFeHRlbnRbMV1bMV1dXTtcbiAgfTtcblxuICB6b29tLmNvbnN0cmFpbiA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChjb25zdHJhaW4gPSBfLCB6b29tKSA6IGNvbnN0cmFpbjtcbiAgfTtcblxuICB6b29tLmR1cmF0aW9uID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGR1cmF0aW9uID0gK18sIHpvb20pIDogZHVyYXRpb247XG4gIH07XG5cbiAgem9vbS5pbnRlcnBvbGF0ZSA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChpbnRlcnBvbGF0ZSA9IF8sIHpvb20pIDogaW50ZXJwb2xhdGU7XG4gIH07XG5cbiAgem9vbS5vbiA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciB2YWx1ZSA9IGxpc3RlbmVycy5vbi5hcHBseShsaXN0ZW5lcnMsIGFyZ3VtZW50cyk7XG4gICAgcmV0dXJuIHZhbHVlID09PSBsaXN0ZW5lcnMgPyB6b29tIDogdmFsdWU7XG4gIH07XG5cbiAgem9vbS5jbGlja0Rpc3RhbmNlID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGNsaWNrRGlzdGFuY2UyID0gKF8gPSArXykgKiBfLCB6b29tKSA6IE1hdGguc3FydChjbGlja0Rpc3RhbmNlMik7XG4gIH07XG5cbiAgem9vbS50YXBEaXN0YW5jZSA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/ICh0YXBEaXN0YW5jZSA9ICtfLCB6b29tKSA6IHRhcERpc3RhbmNlO1xuICB9O1xuXG4gIHJldHVybiB6b29tO1xufVxuIiwgImltcG9ydCB7XG4gIEVkaXRvcixcbiAgRWRpdG9yUG9zaXRpb24sXG4gIEVkaXRvclN1Z2dlc3QsXG4gIEVkaXRvclN1Z2dlc3RDb250ZXh0LFxuICBFZGl0b3JTdWdnZXN0VHJpZ2dlckluZm8sXG4gIFRGaWxlLFxufSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB7IFBhcnNlZE9iamVjdCB9IGZyb20gXCIuL3BhcnNlclwiO1xuXG5leHBvcnQgaW50ZXJmYWNlIE9iamVjdFN1Z2dlc3Rpb24ge1xuICAvKiogVGhlIGRpc2FtYmlndWF0ZWQga2V5IHVzZWQgZm9yIHt7fX0gbGlua3MgKi9cbiAgZGlzcGxheUtleTogc3RyaW5nO1xuICAvKiogVGhlIG9yaWdpbmFsIGtleSB2YWx1ZSAoZm9yIGRpc3BsYXkvc2VhcmNoKSAqL1xuICBrZXlWYWx1ZTogc3RyaW5nO1xuICBmaWxlTGFiZWw6IHN0cmluZztcbiAgZmlsZVBhdGg6IHN0cmluZztcbiAgcHJvcGVydGllczogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbn1cblxuZXhwb3J0IGNsYXNzIE9iamVjdExpbmtTdWdnZXN0IGV4dGVuZHMgRWRpdG9yU3VnZ2VzdDxPYmplY3RTdWdnZXN0aW9uPiB7XG4gIHByaXZhdGUgb2JqZWN0czogT2JqZWN0U3VnZ2VzdGlvbltdID0gW107XG5cbiAgY29uc3RydWN0b3IoYXBwOiBhbnkpIHtcbiAgICBzdXBlcihhcHApO1xuXG4gICAgLy8gTWFrZSBzdWdnZXN0aW9ucyBhY2NlcHQgd2l0aCBUYWIgKGluIGFkZGl0aW9uIHRvIEVudGVyKS5cbiAgICAvLyBPYnNpZGlhbidzIFBvcG92ZXJTdWdnZXN0IHVzZXMgYW4gaW50ZXJuYWwgXCJjaG9vc2VyXCI7IHdlIGNhbGwgaXQgYmVzdC1lZmZvcnQuXG4gICAgdGhpcy5zZXRJbnN0cnVjdGlvbnMoW1xuICAgICAgeyBjb21tYW5kOiBcIlx1MjE5MVx1MjE5M1wiLCBwdXJwb3NlOiBcInRvIG5hdmlnYXRlXCIgfSxcbiAgICAgIHsgY29tbWFuZDogXCJFbnRlclwiLCBwdXJwb3NlOiBcInRvIGluc2VydFwiIH0sXG4gICAgICB7IGNvbW1hbmQ6IFwiVGFiXCIsIHB1cnBvc2U6IFwidG8gaW5zZXJ0XCIgfSxcbiAgICAgIHsgY29tbWFuZDogXCJFc2NcIiwgcHVycG9zZTogXCJ0byBkaXNtaXNzXCIgfSxcbiAgICBdKTtcblxuICAgIHRoaXMuc2NvcGUucmVnaXN0ZXIoW10sIFwiVGFiXCIsIChldnQpID0+IHtcbiAgICAgIGNvbnN0IGUgPSBldnQgYXMgS2V5Ym9hcmRFdmVudDtcbiAgICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICBjb25zdCBjaG9vc2VyID0gKHRoaXMgYXMgYW55KS5jaG9vc2VyO1xuICAgICAgaWYgKGNob29zZXIgJiYgdHlwZW9mIGNob29zZXIudXNlU2VsZWN0ZWRJdGVtID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgY2hvb3Nlci51c2VTZWxlY3RlZEl0ZW0oZSk7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfVxuICAgICAgLy8gRmFsbGJhY2s6IHNpbXVsYXRlIEVudGVyXG4gICAgICBpZiAoY2hvb3NlciAmJiB0eXBlb2YgY2hvb3Nlci5vbkVudGVyID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgY2hvb3Nlci5vbkVudGVyKGUpO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0pO1xuICB9XG5cbiAgc2V0T2JqZWN0cyhvYmplY3RzOiBQYXJzZWRPYmplY3RbXSk6IHZvaWQge1xuICAgIHRoaXMub2JqZWN0cyA9IG9iamVjdHMubWFwKChvKSA9PiAoe1xuICAgICAgZGlzcGxheUtleTogby5kaXNwbGF5S2V5LFxuICAgICAga2V5VmFsdWU6IG8ua2V5VmFsdWUsXG4gICAgICBmaWxlTGFiZWw6IG8uZmlsZUxhYmVsLFxuICAgICAgZmlsZVBhdGg6IG8uZmlsZVBhdGgsXG4gICAgICBwcm9wZXJ0aWVzOiBvLnByb3BlcnRpZXMsXG4gICAgfSkpO1xuICB9XG5cbiAgb25UcmlnZ2VyKFxuICAgIGN1cnNvcjogRWRpdG9yUG9zaXRpb24sXG4gICAgZWRpdG9yOiBFZGl0b3IsXG4gICAgX2ZpbGU6IFRGaWxlIHwgbnVsbFxuICApOiBFZGl0b3JTdWdnZXN0VHJpZ2dlckluZm8gfCBudWxsIHtcbiAgICBjb25zdCBsaW5lID0gZWRpdG9yLmdldExpbmUoY3Vyc29yLmxpbmUpO1xuICAgIGNvbnN0IHN1YiA9IGxpbmUuc3Vic3RyaW5nKDAsIGN1cnNvci5jaCk7XG5cbiAgICAvLyBGaW5kIHRoZSBsYXN0IHt7IHRoYXQgaXNuJ3QgY2xvc2VkXG4gICAgY29uc3QgbGFzdE9wZW4gPSBzdWIubGFzdEluZGV4T2YoXCJ7e1wiKTtcbiAgICBpZiAobGFzdE9wZW4gPT09IC0xKSByZXR1cm4gbnVsbDtcblxuICAgIC8vIENoZWNrIGl0J3Mgbm90IGFscmVhZHkgY2xvc2VkXG4gICAgY29uc3QgYWZ0ZXJPcGVuID0gc3ViLnN1YnN0cmluZyhsYXN0T3BlbiArIDIpO1xuICAgIGlmIChhZnRlck9wZW4uaW5jbHVkZXMoXCJ9fVwiKSkgcmV0dXJuIG51bGw7XG5cbiAgICBjb25zdCBxdWVyeSA9IGFmdGVyT3BlbjtcblxuICAgIHJldHVybiB7XG4gICAgICBzdGFydDogeyBsaW5lOiBjdXJzb3IubGluZSwgY2g6IGxhc3RPcGVuICsgMiB9LFxuICAgICAgZW5kOiBjdXJzb3IsXG4gICAgICBxdWVyeSxcbiAgICB9O1xuICB9XG5cbiAgZ2V0U3VnZ2VzdGlvbnMoY29udGV4dDogRWRpdG9yU3VnZ2VzdENvbnRleHQpOiBPYmplY3RTdWdnZXN0aW9uW10ge1xuICAgIGNvbnN0IHF1ZXJ5ID0gY29udGV4dC5xdWVyeS50b0xvd2VyQ2FzZSgpO1xuICAgIGlmICghcXVlcnkpIHJldHVybiB0aGlzLm9iamVjdHMuc2xpY2UoMCwgMjApO1xuXG4gICAgcmV0dXJuIHRoaXMub2JqZWN0c1xuICAgICAgLmZpbHRlcihcbiAgICAgICAgKG8pID0+XG4gICAgICAgICAgby5kaXNwbGF5S2V5LnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMocXVlcnkpIHx8XG4gICAgICAgICAgby5rZXlWYWx1ZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHF1ZXJ5KVxuICAgICAgKVxuICAgICAgLnNsaWNlKDAsIDIwKTtcbiAgfVxuXG4gIHJlbmRlclN1Z2dlc3Rpb24oc3VnZ2VzdGlvbjogT2JqZWN0U3VnZ2VzdGlvbiwgZWw6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgY29uc3QgY29udGFpbmVyID0gZWwuY3JlYXRlRGl2KHsgY2xzOiBcIm9sLXN1Z2dlc3Rpb25cIiB9KTtcblxuICAgIGNvbnN0IHRpdGxlRWwgPSBjb250YWluZXIuY3JlYXRlRGl2KHsgY2xzOiBcIm9sLXN1Z2dlc3Rpb24tdGl0bGVcIiB9KTtcbiAgICB0aXRsZUVsLnRleHRDb250ZW50ID0gc3VnZ2VzdGlvbi5kaXNwbGF5S2V5O1xuXG4gICAgY29uc3QgZmlsZUVsID0gY29udGFpbmVyLmNyZWF0ZURpdih7IGNsczogXCJvbC1zdWdnZXN0aW9uLWZpbGVcIiB9KTtcbiAgICBmaWxlRWwudGV4dENvbnRlbnQgPSBzdWdnZXN0aW9uLmZpbGVMYWJlbDtcbiAgfVxuXG4gIHNlbGVjdFN1Z2dlc3Rpb24oXG4gICAgc3VnZ2VzdGlvbjogT2JqZWN0U3VnZ2VzdGlvbixcbiAgICBfZXZ0OiBNb3VzZUV2ZW50IHwgS2V5Ym9hcmRFdmVudFxuICApOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMuY29udGV4dCkgcmV0dXJuO1xuXG4gICAgY29uc3QgZWRpdG9yID0gdGhpcy5jb250ZXh0LmVkaXRvcjtcbiAgICBjb25zdCBzdGFydCA9IHRoaXMuY29udGV4dC5zdGFydDtcbiAgICBjb25zdCBlbmQgPSB0aGlzLmNvbnRleHQuZW5kO1xuXG4gICAgLy8gQ2hlY2sgaWYgfX0gYWxyZWFkeSBleGlzdHMgcmlnaHQgYWZ0ZXIgdGhlIGN1cnNvciAoYXV0by1jbG9zZWQgYnkgT2JzaWRpYW4pXG4gICAgY29uc3QgbGluZVRleHQgPSBlZGl0b3IuZ2V0TGluZShlbmQubGluZSk7XG4gICAgY29uc3QgYWZ0ZXJDdXJzb3IgPSBsaW5lVGV4dC5zdWJzdHJpbmcoZW5kLmNoKTtcbiAgICBjb25zdCBoYXNDbG9zaW5nID0gYWZ0ZXJDdXJzb3Iuc3RhcnRzV2l0aChcIn19XCIpO1xuXG4gICAgLy8gUmVwbGFjZSB0aGUgcXVlcnkgdGV4dCB3aXRoIHRoZSBkaXNwbGF5IGtleSwgY29uc3VtaW5nIGV4aXN0aW5nIH19IGlmIHByZXNlbnRcbiAgICBjb25zdCByZXBsYWNlVG8gPSBoYXNDbG9zaW5nXG4gICAgICA/IHsgbGluZTogZW5kLmxpbmUsIGNoOiBlbmQuY2ggKyAyIH1cbiAgICAgIDogZW5kO1xuICAgIGVkaXRvci5yZXBsYWNlUmFuZ2Uoc3VnZ2VzdGlvbi5kaXNwbGF5S2V5ICsgXCJ9fVwiLCBzdGFydCwgcmVwbGFjZVRvKTtcbiAgfVxufVxuIiwgIi8qKlxuICogQ29kZU1pcnJvciA2IGVkaXRvciBleHRlbnNpb24gdGhhdCBoaWdobGlnaHRzIHt7b2JqZWN0IGxpbmtzfX1cbiAqIGluIGxpdmUtcHJldmlldyBtb2RlIHRvIG1hdGNoIHRoZSBhcHBlYXJhbmNlIG9mIFtbd2lraWxpbmtzXV0uXG4gKlxuICogVXNlcyBPYnNpZGlhbidzIG93biBDU1MgdmFyaWFibGVzIGFuZCBjbGFzc2VzIHNvIHRoZSBzdHlsaW5nXG4gKiBpcyBjb25zaXN0ZW50IHdpdGggdGhlIG5hdGl2ZSBsaW5rIGFwcGVhcmFuY2UuXG4gKi9cblxuaW1wb3J0IHtcbiAgRGVjb3JhdGlvbixcbiAgRGVjb3JhdGlvblNldCxcbiAgRWRpdG9yVmlldyxcbiAgVmlld1BsdWdpbixcbiAgVmlld1VwZGF0ZSxcbiAga2V5bWFwLFxufSBmcm9tIFwiQGNvZGVtaXJyb3Ivdmlld1wiO1xuaW1wb3J0IHsgRWRpdG9yU2VsZWN0aW9uLCBSYW5nZVNldEJ1aWxkZXIgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivc3RhdGVcIjtcblxuLyogXHUyNTAwXHUyNTAwIERlY29yYXRpb24gc3BlY3MgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwICovXG5cbmNvbnN0IGxpbmtEZWNvID0gRGVjb3JhdGlvbi5tYXJrKHsgY2xhc3M6IFwib2wtY20tbGlua1wiIH0pO1xuY29uc3QgbGlua0VkaXRpbmdEZWNvID0gRGVjb3JhdGlvbi5tYXJrKHsgY2xhc3M6IFwib2wtY20tbGluay1lZGl0aW5nXCIgfSk7XG5cbi8qIFx1MjUwMFx1MjUwMCBCdWlsZCBkZWNvcmF0aW9ucyBmb3IgdmlzaWJsZSByYW5nZXMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwICovXG5cbmZ1bmN0aW9uIGJ1aWxkRGVjb3JhdGlvbnModmlldzogRWRpdG9yVmlldyk6IERlY29yYXRpb25TZXQge1xuICBjb25zdCBidWlsZGVyID0gbmV3IFJhbmdlU2V0QnVpbGRlcjxEZWNvcmF0aW9uPigpO1xuICBjb25zdCBjdXJzb3JIZWFkID0gdmlldy5zdGF0ZS5zZWxlY3Rpb24ubWFpbi5oZWFkO1xuICBjb25zdCByZWdleCA9IC9cXHtcXHsoW159XSspXFx9XFx9L2c7XG5cbiAgZm9yIChjb25zdCB7IGZyb20sIHRvIH0gb2Ygdmlldy52aXNpYmxlUmFuZ2VzKSB7XG4gICAgY29uc3QgdGV4dCA9IHZpZXcuc3RhdGUuc2xpY2VEb2MoZnJvbSwgdG8pO1xuICAgIGxldCBtYXRjaDogUmVnRXhwRXhlY0FycmF5IHwgbnVsbDtcblxuICAgIHdoaWxlICgobWF0Y2ggPSByZWdleC5leGVjKHRleHQpKSAhPT0gbnVsbCkge1xuICAgICAgY29uc3Qgc3RhcnQgPSBmcm9tICsgbWF0Y2guaW5kZXg7XG4gICAgICBjb25zdCBlbmQgPSBzdGFydCArIG1hdGNoWzBdLmxlbmd0aDtcblxuICAgICAgLy8gVXNlIGEgc3VidGxlciBzdHlsZSB3aGVuIHRoZSBjdXJzb3IgaXMgaW5zaWRlIHRoZSBtYXRjaFxuICAgICAgY29uc3QgY3Vyc29ySW5zaWRlID0gY3Vyc29ySGVhZCA+PSBzdGFydCAmJiBjdXJzb3JIZWFkIDw9IGVuZDtcbiAgICAgIGJ1aWxkZXIuYWRkKHN0YXJ0LCBlbmQsIGN1cnNvckluc2lkZSA/IGxpbmtFZGl0aW5nRGVjbyA6IGxpbmtEZWNvKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gYnVpbGRlci5maW5pc2goKTtcbn1cblxuLyogXHUyNTAwXHUyNTAwIFZpZXdQbHVnaW4gXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwICovXG5cbmV4cG9ydCBjb25zdCBvYmplY3RMaW5rSGlnaGxpZ2h0ZXIgPSBWaWV3UGx1Z2luLmZyb21DbGFzcyhcbiAgY2xhc3Mge1xuICAgIGRlY29yYXRpb25zOiBEZWNvcmF0aW9uU2V0O1xuXG4gICAgY29uc3RydWN0b3IodmlldzogRWRpdG9yVmlldykge1xuICAgICAgdGhpcy5kZWNvcmF0aW9ucyA9IGJ1aWxkRGVjb3JhdGlvbnModmlldyk7XG4gICAgfVxuXG4gICAgdXBkYXRlKHVwZGF0ZTogVmlld1VwZGF0ZSk6IHZvaWQge1xuICAgICAgaWYgKHVwZGF0ZS5kb2NDaGFuZ2VkIHx8IHVwZGF0ZS52aWV3cG9ydENoYW5nZWQgfHwgdXBkYXRlLnNlbGVjdGlvblNldCkge1xuICAgICAgICB0aGlzLmRlY29yYXRpb25zID0gYnVpbGREZWNvcmF0aW9ucyh1cGRhdGUudmlldyk7XG4gICAgICB9XG4gICAgfVxuICB9LFxuICB7XG4gICAgZGVjb3JhdGlvbnM6ICh2KSA9PiB2LmRlY29yYXRpb25zLFxuICB9XG4pO1xuXG4vKipcbiAqIEtleWJpbmRpbmc6IGlmIHlvdSBoYXZlIGEgc2VsZWN0aW9uIGFuZCBwcmVzcyBge2AsIHdyYXAgaXQgaW4gYHt7IC4uLiB9fWAuXG4gKiBJZiB0aGVyZSdzIG5vIHNlbGVjdGlvbiwgbGV0IENvZGVNaXJyb3IgaW5zZXJ0IGB7YCBub3JtYWxseS5cbiAqL1xuZXhwb3J0IGNvbnN0IG9iamVjdExpbmtXcmFwcGVyS2V5bWFwID0ga2V5bWFwLm9mKFtcbiAge1xuICAgIGtleTogXCJ7XCIsXG4gICAgcnVuOiAodmlldykgPT4ge1xuICAgICAgY29uc3Qgc2VsID0gdmlldy5zdGF0ZS5zZWxlY3Rpb247XG4gICAgICBpZiAoc2VsLnJhbmdlcy5ldmVyeSgocikgPT4gci5lbXB0eSkpIHJldHVybiBmYWxzZTtcblxuICAgICAgY29uc3QgY2hhbmdlczogeyBmcm9tOiBudW1iZXI7IHRvOiBudW1iZXI7IGluc2VydDogc3RyaW5nIH1bXSA9IFtdO1xuICAgICAgY29uc3QgbmV3UmFuZ2VzOiBhbnlbXSA9IFtdO1xuXG4gICAgICBmb3IgKGNvbnN0IHIgb2Ygc2VsLnJhbmdlcykge1xuICAgICAgICBjb25zdCB0ZXh0ID0gdmlldy5zdGF0ZS5kb2Muc2xpY2VTdHJpbmcoci5mcm9tLCByLnRvKTtcbiAgICAgICAgY29uc3QgaW5zZXJ0ID0gYHt7JHt0ZXh0fX19YDtcbiAgICAgICAgY2hhbmdlcy5wdXNoKHsgZnJvbTogci5mcm9tLCB0bzogci50bywgaW5zZXJ0IH0pO1xuXG4gICAgICAgIC8vIFBsYWNlIGN1cnNvciBpbnNpZGUgdGhlIGJyYWNlcywgc2VsZWN0aW5nIHRoZSBvcmlnaW5hbCB0ZXh0LlxuICAgICAgICBjb25zdCBzdGFydCA9IHIuZnJvbSArIDI7XG4gICAgICAgIGNvbnN0IGVuZCA9IHN0YXJ0ICsgdGV4dC5sZW5ndGg7XG4gICAgICAgIG5ld1Jhbmdlcy5wdXNoKEVkaXRvclNlbGVjdGlvbi5yYW5nZShzdGFydCwgZW5kKSk7XG4gICAgICB9XG5cbiAgICAgIHZpZXcuZGlzcGF0Y2goe1xuICAgICAgICBjaGFuZ2VzLFxuICAgICAgICBzZWxlY3Rpb246IEVkaXRvclNlbGVjdGlvbi5jcmVhdGUobmV3UmFuZ2VzLCBzZWwubWFpbkluZGV4KSxcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSxcbiAgfSxcbl0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxJQUFBQSxtQkFPTzs7O0FDbURBLFNBQVMscUJBQ2QsU0FDQSxVQUNtQjtBQUNuQixRQUFNLFFBQVEsUUFBUSxNQUFNLElBQUk7QUFHaEMsTUFBSSxXQUFXO0FBQ2YsTUFBSSxNQUFNLFNBQVMsS0FBSyxNQUFNLENBQUMsRUFBRSxLQUFLLE1BQU0sT0FBTztBQUNqRCxhQUFTLElBQUksR0FBRyxJQUFJLE1BQU0sUUFBUSxLQUFLO0FBQ3JDLFVBQUksTUFBTSxDQUFDLEVBQUUsS0FBSyxNQUFNLE9BQU87QUFDN0IsbUJBQVcsSUFBSTtBQUNmO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBSUEsTUFBSSxVQUFVO0FBQ2QsV0FBUyxJQUFJLFVBQVUsSUFBSSxNQUFNLFFBQVEsS0FBSztBQUM1QyxVQUFNLFVBQVUsTUFBTSxDQUFDLEVBQUUsS0FBSztBQUM5QixRQUFJLFFBQVEsV0FBVztBQUFHO0FBRTFCLFFBQUksUUFBUSxXQUFXLEdBQUcsS0FBSyxDQUFDLFFBQVEsU0FBUyxHQUFHO0FBQUc7QUFDdkQsY0FBVTtBQUNWO0FBQUEsRUFDRjtBQUVBLFFBQU0sV0FBVyxRQUFRLE1BQU0sZ0JBQWdCO0FBQy9DLE1BQUksQ0FBQztBQUFVLFdBQU87QUFFdEIsUUFBTSxjQUFjLFNBQVMsQ0FBQyxFQUFFLEtBQUs7QUFDckMsUUFBTSxZQUFZLFNBQVMsUUFBUSxTQUFTLEVBQUUsRUFBRSxRQUFRLFVBQVUsRUFBRTtBQUdwRSxRQUFNLFVBQTBCLENBQUM7QUFDakMsTUFBSSxlQUE4RDtBQUNsRSxNQUFJLHVCQUF1QjtB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QUNmLFVBQVU7QUFBQSxFQUNWLFdBQVc7QUFBQSxFQUNYLFVBQVU7QUFBQSxFQUNWLFdBQVc7QUFBQSxFQUNYLGFBQWE7QUFBQSxFQUNiLGdCQUFnQjtBQUFBLEVBQ2hCLFlBQVk7QUFBQSxFQUNaLFlBQVk7QUFBQSxFQUNaLFNBQVM7QUFBQSxFQUNULFlBQVk7QUFBQSxFQUNaLGNBQWM7QUFBQSxFQUNkLGVBQWU7QUFBQSxFQUNmLGVBQWU7QUFBQSxFQUNmLGVBQWU7QUFBQSxFQUNmLGVBQWU7QUFBQSxFQUNmLFlBQVk7QUFBQSxFQUNaLFVBQVU7QUFBQSxFQUNWLGFBQWE7QUFBQSxFQUNiLFNBQVM7QUFBQSxFQUNULFNBQVM7QUFBQSxFQUNULFlBQVk7QUFBQSxFQUNaLFdBQVc7QUFBQSxFQUNYLGFBQWE7QUFBQSxFQUNiLGFBQWE7QUFBQSxFQUNiLFNBQVM7QUFBQSxFQUNULFdBQVc7QUFBQSxFQUNYLFlBQVk7QUFBQSxFQUNaLE1BQU07QUFBQSxFQUNOLFdBQVc7QUFBQSxFQUNYLE1BQU07QUFBQSxFQUNOLE9BQU87QUFBQSxFQUNQLGFBQWE7QUFBQSxFQUNiLE1BQU07QUFBQSxFQUNOLFVBQVU7QUFBQSxFQUNWLFNBQVM7QUFBQSxFQUNULFdBQVc7QUFBQSxFQUNYLFFBQVE7QUFBQSxFQUNSLE9BQU87QUFBQSxFQUNQLE9BQU87QUFBQSxFQUNQLFVBQVU7QUFBQSxFQUNWLGVBQWU7QUFBQSxFQUNmLFdBQVc7QUFBQSxFQUNYLGNBQWM7QUFBQSxFQUNkLFdBQVc7QUFBQSxFQUNYLFlBQVk7QUFBQSxFQUNaLFdBQVc7QUFBQSxFQUNYLHNCQUFzQjtBQUFBLEVBQ3RCLFdBQVc7QUFBQSxFQUNYLFlBQVk7QUFBQSxFQUNaLFdBQVc7QUFBQSxFQUNYLFdBQVc7QUFBQSxFQUNYLGFBQWE7QUFBQSxFQUNiLGVBQWU7QUFBQSxFQUNmLGNBQWM7QUFBQSxFQUNkLGdCQUFnQjtBQUFBLEVBQ2hCLGdCQUFnQjtBQUFBLEVBQ2hCLGdCQUFnQjtBQUFBLEVBQ2hCLGFBQWE7QUFBQSxFQUNiLE1BQU07QUFBQSxFQUNOLFdBQVc7QUFBQSxFQUNYLE9BQU87QUFBQSxFQUNQLFNBQVM7QUFBQSxFQUNULFFBQVE7QUFBQSxFQUNSLGtCQUFrQjtBQUFBLEVBQ2xCLFlBQVk7QUFBQSxFQUNaLGNBQWM7QUFBQSxFQUNkLGNBQWM7QUFBQSxFQUNkLGdCQUFnQjtBQUFBLEVBQ2hCLGlCQUFpQjtBQUFBLEVBQ2pCLG1CQUFtQjtBQUFBLEVBQ25CLGlCQUFpQjtBQUFBLEVBQ2pCLGlCQUFpQjtBQUFBLEVBQ2pCLGNBQWM7QUFBQSxFQUNkLFdBQVc7QUFBQSxFQUNYLFdBQVc7QUFBQSxFQUNYLFVBQVU7QUFBQSxFQUNWLGFBQWE7QUFBQSxFQUNiLE1BQU07QUFBQSxFQUNOLFNBQVM7QUFBQSxFQUNULE9BQU87QUFBQSxFQUNQLFdBQVc7QUFBQSxFQUNYLFFBQVE7QUFBQSxFQUNSLFdBQVc7QUFBQSxFQUNYLFFBQVE7QUFBQSxFQUNSLGVBQWU7QUFBQSxFQUNmLFdBQVc7QUFBQSxFQUNYLGVBQWU7QUFBQSxFQUNmLGVBQWU7QUFBQSxFQUNmLFlBQVk7QUFBQSxFQUNaLFdBQVc7QUFBQSxFQUNYLE1BQU07QUFBQSxFQUNOLE1BQU07QUFBQSxFQUNOLE1BQU07QUFBQSxFQUNOLFlBQVk7QUFBQSxFQUNaLFFBQVE7QUFBQSxFQUNSLGVBQWU7QUFBQSxFQUNmLEtBQUs7QUFBQSxFQUNMLFdBQVc7QUFBQSxFQUNYLFdBQVc7QUFBQSxFQUNYLGFBQWE7QUFBQSxFQUNiLFFBQVE7QUFBQSxFQUNSLFlBQVk7QUFBQSxFQUNaLFVBQVU7QUFBQSxFQUNWLFVBQVU7QUFBQSxFQUNWLFFBQVE7QUFBQSxFQUNSLFFBQVE7QUFBQSxFQUNSLFNBQVM7QUFBQSxFQUNULFdBQVc7QUFBQSxFQUNYLFdBQVc7QUFBQSxFQUNYLFdBQVc7QUFBQSxFQUNYLE1BQU07QUFBQSxFQUNOLGFBQWE7QUFBQSxFQUNiLFdBQVc7QUFBQSxFQUNYLEtBQUs7QUFBQSxFQUNMLE1BQU07QUFBQSxFQUNOLFNBQVM7QUFBQSxFQUNULFFBQVE7QUFBQSxFQUNSLFdBQVc7QUFBQSxFQUNYLFFBQVE7QUFBQSxFQUNSLE9BQU87QUFBQSxFQUNQLE9BQU87QUFBQSxFQUNQLFlBQVk7QUFBQSxFQUNaLFFBQVE7QUFBQSxFQUNSLGFBQWE7QUFDZjtBQUVBLGVBQU8sT0FBTyxPQUFPO0FBQUEsRUFDbkIsS0FBSyxVQUFVO0FBQ2IsV0FBTyxPQUFPLE9BQU8sSUFBSSxLQUFLLGVBQWEsTUFBTSxRQUFRO0FBQUEsRUFDM0Q7QUFBQSxFQUNBLGNBQWM7QUFDWixXQUFPLEtBQUssSUFBSSxFQUFFLFlBQVk7QUFBQSxFQUNoQztBQUFBLEVBQ0EsS0FBSztBQUFBO0FBQUEsRUFDTCxXQUFXO0FBQUEsRUFDWCxZQUFZO0FBQUEsRUFDWixXQUFXO0FBQUEsRUFDWCxXQUFXO0FBQUEsRUFDWCxVQUFVO0FBQ1osQ0FBQztBQUVELFNBQVMsa0JBQWtCO0FBQ3pCLFNBQU8sS0FBSyxJQUFJLEVBQUUsVUFBVTtBQUM5QjtBQUVBLFNBQVMsbUJBQW1CO0FBQzFCLFNBQU8sS0FBSyxJQUFJLEVBQUUsV0FBVztBQUMvQjtBQUVBLFNBQVMsa0JBQWtCO0FBQ3pCLFNBQU8sV0FBVyxJQUFJLEVBQUUsVUFBVTtBQUNwQztBQUVBLFNBQVMsa0JBQWtCO0FBQ3pCLFNBQU8sS0FBSyxJQUFJLEVBQUUsVUFBVTtBQUM5QjtBQUVlLFNBQVIsTUFBdUIsUUFBUTtBQUNwQyxNQUFJRyxJQUFHO0FBQ1AsWUFBVSxTQUFTLElBQUksS0FBSyxFQUFFLFlBQVk7QUFDMUMsVUFBUUEsS0FBSSxNQUFNLEtBQUssTUFBTSxNQUFNLElBQUlBLEdBQUUsQ0FBQyxFQUFFLFFBQVFBLEtBQUksU0FBU0EsR0FBRSxDQUFDLEdBQUcsRUFBRSxHQUFHLE1BQU0sSUFBSSxLQUFLQSxFQUFDLElBQ3RGLE1BQU0sSUFBSSxJQUFJLElBQUtBLE1BQUssSUFBSSxLQUFRQSxNQUFLLElBQUksS0FBUUEsTUFBSyxJQUFJLEtBQVFBLEtBQUksTUFBU0EsS0FBSSxPQUFRLElBQU1BLEtBQUksSUFBTSxDQUFDLElBQ2hILE1BQU0sSUFBSSxLQUFLQSxNQUFLLEtBQUssS0FBTUEsTUFBSyxLQUFLLEtBQU1BLE1BQUssSUFBSSxNQUFPQSxLQUFJLE9BQVEsR0FBSSxJQUMvRSxNQUFNLElBQUksS0FBTUEsTUFBSyxLQUFLLEtBQVFBLE1BQUssSUFBSSxLQUFRQSxNQUFLLElBQUksS0FBUUEsTUFBSyxJQUFJLEtBQVFBLE1BQUssSUFBSSxLQUFRQSxLQUFJLE9BQVVBLEtBQUksT0FBUSxJQUFNQSxLQUFJLE1BQVEsR0FBSSxJQUN0SixTQUNDQSxLQUFJLGFBQWEsS0FBSyxNQUFNLEtBQUssSUFBSSxJQUFJQSxHQUFFLENBQUMsR0FBR0EsR0FBRSxDQUFDLEdBQUdBLEdBQUUsQ0FBQyxHQUFHLENBQUMsS0FDNURBLEtBQUksYUFBYSxLQUFLLE1BQU0sS0FBSyxJQUFJLElBQUlBLEdBQUUsQ0FBQyxJQUFJLE1BQU0sS0FBS0EsR0FBRSxDQUFDLElBQUksTUFBTSxLQUFLQSxHQUFFLENBQUMsSUFBSSxNQUFNLEtBQUssQ0FBQyxLQUNoR0EsS0FBSSxjQUFjLEtBQUssTUFBTSxLQUFLLEtBQUtBLEdBQUUsQ0FBQyxHQUFHQSxHQUFFLENBQUMsR0FBR0EsR0FBRSxDQUFDLEdBQUdBLEdBQUUsQ0FBQyxDQUFDLEtBQzdEQSxLQUFJLGNBQWMsS0FBSyxNQUFNLEtBQUssS0FBS0EsR0FBRSxDQUFDLElBQUksTUFBTSxLQUFLQSxHQUFFLENBQUMsSUFBSSxNQUFNLEtBQUtBLEdBQUUsQ0FBQyxJQUFJLE1BQU0sS0FBS0EsR0FBRSxDQUFDLENBQUMsS0FDakdBLEtBQUksYUFBYSxLQUFLLE1BQU0sS0FBSyxLQUFLQSxHQUFFLENBQUMsR0FBR0EsR0FBRSxDQUFDLElBQUksS0FBS0EsR0FBRSxDQUFDLElBQUksS0FBSyxDQUFDLEtBQ3JFQSxLQUFJLGNBQWMsS0FBSyxNQUFNLEtBQUssS0FBS0EsR0FBRSxDQUFDLEdBQUdBLEdBQUUsQ0FBQyxJQUFJLEtBQUtBLEdBQUUsQ0FBQyxJQUFJLEtBQUtBLEdBQUUsQ0FBQyxDQUFDLElBQzFFLE1BQU0sZUFBZSxNQUFNLElBQUks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SztBQUNQLFlBQU0sU0FBUyxJQUFJLE1BQU0sR0FBRyxFQUFFLENBQUMsRUFBRSxLQUFLO0FBQ3RDLFlBQU0sT0FBTyxLQUFLLElBQUksY0FBYyxxQkFBcUIsUUFBUSxNQUFNLE1BQU0sUUFBUSxFQUFFO0FBQ3ZGLFVBQUksTUFBTTtBQUNSLGNBQU0sS0FBSyxJQUFJLFVBQVUsUUFBUSxLQUFLLEVBQUUsU0FBUyxJQUFJO0FBQ3JEO0FBQUEsTUFDRjtBQUNBLFVBQUksd0JBQU8sbUJBQW1CLE1BQU0sRUFBRTtBQUN0QztBQUFBLElBQ0Y7QUFHQSxVQUFNLE1BQU0sT0FBTyxNQUFNLElBQUk7QUFDN0IsUUFBSSxLQUFLO0FBQ1AsWUFBTSxTQUFTLElBQUksTUFBTSxHQUFHLEVBQUUsQ0FBQyxFQUFFLEtBQUs7QUFDdEMsWUFBTSxRQUFRLEtBQUssWUFBWSxJQUFJLE9BQU8sWUFBWSxDQUFDO0FBQ3ZELFVBQUksT0FBTztBQUNULGNBQU0sS0FBSyxXQUFXLE1BQU0sVUFBVSxNQUFNLFNBQVM7QUFDckQ7QUFBQSxNQUNGO0FBQ0EsVUFBSSx3QkFBTyxXQUFXLE1BQU0sYUFBYTtBQUN6QztBQUFBLElBQ0Y7QUFFQSxRQUFJLHdCQUFPLHNCQUFzQjtBQUFBLEVBQ25DO0FBQ0Y7IiwKICAibmFtZXMiOiBbImltcG9ydF9vYnNpZGlhbiIsICJpZCIsICJ0eXBlIiwgImltcG9ydF9vYnNpZGlhbiIsICJtaW4iLCAibWF4IiwgInR5cGUiLCAiYyIsICJkb2N1bWVudCIsICJtIiwgIngiLCAibSIsICJtIiwgImRhdHVtIiwgIngiLCAibSIsICJzZWxlY3Rpb24iLCAibSIsICJtIiwgImEiLCAibSIsICJtIiwgIm0iLCAiY3JlYXRlIiwgImNyZWF0ZSIsICJwYXJzZVR5cGVuYW1lcyIsICJtIiwgInR5cGUiLCAid2luZG93IiwgImRpc3BhdGNoX2RlZmF1bHQiLCAibSIsICJkaXNwYXRjaF9kZWZhdWx0IiwgInNlbGVjdF9kZWZhdWx0IiwgInJvb3QiLCAic2VsZWN0aW9uIiwgInNlbGVjdF9kZWZhdWx0IiwgIm0iLCAiYSIsICJtaW4iLCAibWF4IiwgImNvbnN0YW50X2RlZmF1bHQiLCAieCIsICJhIiwgInkiLCAieSIsICJhIiwgImNvbnN0YW50X2RlZmF1bHQiLCAieSIsICJjb2xvciIsICJyZ2IiLCAic3RhcnQiLCAiYSIsICJhIiwgImkiLCAiYSIsICJjIiwgIm0iLCAiYSIsICJ4IiwgIm5vdyIsICJpZCIsICJpbmRleCIsICJnZXQiLCAic2V0IiwgInN0YXJ0IiwgImVtcHR5IiwgImludGVycnVwdF9kZWZhdWx0IiwgImlkIiwgInNldCIsICJnZXQiLCAidHJhbnNpdGlvbiIsICJhIiwgImMiLCAiYXR0clJlbW92ZSIsICJhdHRyUmVtb3ZlTlMiLCAiYXR0ckNvbnN0YW50IiwgImF0dHJDb25zdGFudE5TIiwgImF0dHJGdW5jdGlvbiIsICJhdHRyRnVuY3Rpb25OUyIsICJhdHRyX2RlZmF1bHQiLCAiaWQiLCAiZ2V0IiwgImlkIiwgInNldCIsICJnZXQiLCAiaWQiLCAic2V0IiwgImdldCIsICJpZCIsICJzZXQiLCAiZmlsdGVyX2RlZmF1bHQiLCAibSIsICJtZXJnZV9kZWZhdWx0IiwgInRyYW5zaXRpb24iLCAibSIsICJpZCIsICJzZXQiLCAib25fZGVmYXVsdCIsICJnZXQiLCAiaWQiLCAicmVtb3ZlX2RlZmF1bHQiLCAic2VsZWN0X2RlZmF1bHQiLCAiaWQiLCAibSIsICJnZXQiLCAic2VsZWN0QWxsX2RlZmF1bHQiLCAiaWQiLCAibSIsICJjaGlsZHJlbiIsICJpbmhlcml0IiwgImdldCIsICJTZWxlY3Rpb24iLCAic2VsZWN0aW9uX2RlZmF1bHQiLCAic3R5bGVSZW1vdmUiLCAic3R5bGVDb25zdGFudCIsICJzdHlsZUZ1bmN0aW9uIiwgImlkIiwgInJlbW92ZSIsICJzZXQiLCAic3R5bGVfZGVmYXVsdCIsICJ0ZXh0Q29uc3RhbnQiLCAidGV4dEZ1bmN0aW9uIiwgInRleHRfZGVmYXVsdCIsICJtIiwgImluaGVyaXQiLCAiZ2V0IiwgImlkIiwgInNldCIsICJpZCIsICJzZWxlY3RfZGVmYXVsdCIsICJzZWxlY3RBbGxfZGVmYXVsdCIsICJmaWx0ZXJfZGVmYXVsdCIsICJtZXJnZV9kZWZhdWx0IiwgInNlbGVjdGlvbl9kZWZhdWx0IiwgIm9uX2RlZmF1bHQiLCAiYXR0cl9kZWZhdWx0IiwgInN0eWxlX2RlZmF1bHQiLCAidGV4dF9kZWZhdWx0IiwgInJlbW92ZV9kZWZhdWx0IiwgImlkIiwgInRyYW5zaXRpb25fZGVmYXVsdCIsICJtIiwgImludGVycnVwdF9kZWZhdWx0IiwgInRyYW5zaXRpb25fZGVmYXVsdCIsICJ4IiwgInkiLCAieCIsICJ5IiwgIngiLCAieSIsICJkYXRhX2RlZmF1bHQiLCAieCIsICJ5IiwgIngyIiwgInkyIiwgIngzIiwgInkzIiwgInJlbW92ZV9kZWZhdWx0IiwgIngiLCAieSIsICJzaXplX2RlZmF1bHQiLCAieCIsICJ5IiwgImRhdGFfZGVmYXVsdCIsICJyZW1vdmVfZGVmYXVsdCIsICJzaXplX2RlZmF1bHQiLCAiY29uc3RhbnRfZGVmYXVsdCIsICJ4IiwgImNvbnN0YW50X2RlZmF1bHQiLCAieCIsICJ5IiwgImZpbmQiLCAiaWQiLCAiY29uc3RhbnRfZGVmYXVsdCIsICJ4IiwgInkiLCAibSIsICJpIiwgIngiLCAieSIsICJjb25zdGFudF9kZWZhdWx0IiwgIngiLCAieSIsICJub2RlIiwgInN0cmVuZ3RoIiwgImMiLCAieDIiLCAieF9kZWZhdWx0IiwgIngiLCAiY29uc3RhbnRfZGVmYXVsdCIsICJ5X2RlZmF1bHQiLCAieSIsICJjb25zdGFudF9kZWZhdWx0IiwgImNvbnN0YW50X2RlZmF1bHQiLCAieCIsICJ0eXBlIiwgInRyYW5zZm9ybSIsICJkaXNwYXRjaCIsICJ4IiwgInkiLCAiaWRlbnRpdHkiLCAibm9wcm9wYWdhdGlvbiIsICJub2V2ZW50X2RlZmF1bHQiLCAiaWRlbnRpdHkiLCAidHJhbnNmb3JtIiwgInpvb21fZGVmYXVsdCIsICJmaWx0ZXIiLCAic2VsZWN0aW9uIiwgIngiLCAieSIsICJleHRlbnQiLCAidHJhbnNpdGlvbiIsICJhIiwgInR5cGUiLCAic2VsZWN0X2RlZmF1bHQiLCAibm9ldmVudF9kZWZhdWx0IiwgIm5vcHJvcGFnYXRpb24iLCAiZXZlbnQiLCAiY29uc3RhbnRfZGVmYXVsdCIsICJoZXgiLCAibSIsICJjIiwgImEiLCAiaWRlbnRpdHkiLCAiZnJhbWUiLCAieF9kZWZhdWx0IiwgInlfZGVmYXVsdCIsICJ4IiwgInkiLCAiem9vbV9kZWZhdWx0IiwgInNlbGVjdF9kZWZhdWx0IiwgIm5vdyIsICJpbXBvcnRfb2JzaWRpYW4iLCAic3RhcnQiLCAic3RhcnQiXQp9Cg==
