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
  connectOrphansToFolders: false,
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
      this.renderToggle(contentEl, "Connect orphans to folders", this.config.connectOrphansToFolders, (v) => {
        this.config.connectOrphansToFolders = v;
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
    this._onContainerMouseDown = null;
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
    if (this._onContainerMouseDown) {
      this.contentEl.removeEventListener("mousedown", this._onContainerMouseDown, true);
      this._onContainerMouseDown = null;
    }
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
    if (!this._onContainerMouseDown) {
      this._onContainerMouseDown = (e) => {
        const panel = this.contentEl.querySelector(".ol-info-panel");
        if (!panel)
          return;
        const target = e.target;
        if (target && panel.contains(target))
          return;
        if (target === this.canvasEl)
          return;
        this.selectedNode = null;
        this.updateHighlightTargets();
        this.removeInfoPanel(this.contentEl);
        this.needsRedraw = true;
      };
      this.contentEl.addEventListener("mousedown", this._onContainerMouseDown, true);
    }
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
    const baseOrphans = /* @__PURE__ */ new Set();
    for (const n of filtered.nodes) {
      if ((n.connections || 0) === 0)
        baseOrphans.add(n.id);
    }
    const nodesPlus = [...filtered.nodes];
    const edgesPlus = [...filtered.edges];
    if (this.config.connectOrphansToFolders) {
      const folderNodeId = (folder) => `folder::${folder}`;
      const folderLabel = (folder) => {
        const cleaned = folder.replace(/\/+$/, "");
        if (!cleaned || cleaned === "/")
          return "/";
        const parts = cleaned.split("/").filter(Boolean);
        return parts[parts.length - 1] || cleaned;
      };
      const existing = new Set(nodesPlus.map((n) => n.id));
      const edgeSet = new Set(edgesPlus.map((e) => [e.source, e.target].sort().join("--")));
      for (const n of filtered.nodes) {
        if (!baseOrphans.has(n.id))
          continue;
        const path = n.filePath || "";
        const idx = path.lastIndexOf("/");
        const folder = idx > 0 ? path.slice(0, idx) : "/";
        const fid = folderNodeId(folder);
        if (!existing.has(fid)) {
          existing.add(fid);
          nodesPlus.push({
            id: fid,
            label: folderLabel(folder),
            type: "file",
            filePath: folder + "/",
            fileLabel: folderLabel(folder),
            properties: {},
            startLine: 0,
            connections: 0
          });
        }
        const edgeId = [n.id, fid].sort().join("--");
        if (!edgeSet.has(edgeId)) {
          edgeSet.add(edgeId);
          edgesPlus.push({ source: n.id, target: fid, edgeType: "wiki" });
        }
      }
    }
    const nodeById = /* @__PURE__ */ new Map();
    this.simNodes = nodesPlus.map((n) => {
      const old = oldPositions.get(n.id);
      const baseAlpha = n.type === "object" ? 0.9 : 0.5;
      const node = {
        ...n,
        isOrphan: baseOrphans.has(n.id),
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
    this.simEdges = edgesPlus.map((e) => {
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
    const filterChanged = old.showFiles !== newConfig.showFiles || old.showObjects !== newConfig.showObjects || old.showWikiEdges !== newConfig.showWikiEdges || old.showObjectEdges !== newConfig.showObjectEdges || old.showOrphans !== newConfig.showOrphans || old.connectOrphansToFolders !== newConfig.connectOrphansToFolders || old.search !== newConfig.search || old.pathFilter !== newConfig.pathFilter || old.sourceFilter !== newConfig.sourceFilter;
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
      const isOrphan = !!n.isOrphan;
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
        this.simulation?.alphaTarget(0.15).restart();
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
        const t = 0.35;
        this.dragNode.fx = lerp(this.dragNode.fx ?? wx, wx, t);
        this.dragNode.fy = lerp(this.dragNode.fy ?? wy, wy, t);
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL3BhcnNlci50cyIsICJzcmMvZ3JhcGgtZGF0YS50cyIsICJzcmMvZ3JhcGgtdmlldy50cyIsICJzcmMvc2V0dGluZ3MudHMiLCAibm9kZV9tb2R1bGVzL2QzLWRpc3BhdGNoL3NyYy9kaXNwYXRjaC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9uYW1lc3BhY2VzLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL25hbWVzcGFjZS5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9jcmVhdG9yLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdG9yLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9zZWxlY3QuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvYXJyYXkuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0b3JBbGwuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL3NlbGVjdEFsbC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9tYXRjaGVyLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9zZWxlY3RDaGlsZC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vc2VsZWN0Q2hpbGRyZW4uanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2ZpbHRlci5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vc3BhcnNlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9lbnRlci5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9jb25zdGFudC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vZGF0YS5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vZXhpdC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vam9pbi5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vbWVyZ2UuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL29yZGVyLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9zb3J0LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9jYWxsLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9ub2Rlcy5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vbm9kZS5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vc2l6ZS5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vZW1wdHkuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2VhY2guanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2F0dHIuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvd2luZG93LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9zdHlsZS5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vcHJvcGVydHkuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2NsYXNzZWQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL3RleHQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2h0bWwuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL3JhaXNlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9sb3dlci5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vYXBwZW5kLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9pbnNlcnQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL3JlbW92ZS5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vY2xvbmUuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2RhdHVtLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9vbi5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vZGlzcGF0Y2guanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2l0ZXJhdG9yLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9pbmRleC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3QuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc291cmNlRXZlbnQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvcG9pbnRlci5qcyIsICJub2RlX21vZHVsZXMvZDMtZHJhZy9zcmMvbm9ldmVudC5qcyIsICJub2RlX21vZHVsZXMvZDMtZHJhZy9zcmMvbm9kcmFnLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1jb2xvci9zcmMvZGVmaW5lLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1jb2xvci9zcmMvY29sb3IuanMiLCAibm9kZV9tb2R1bGVzL2QzLWludGVycG9sYXRlL3NyYy9iYXNpcy5qcyIsICJub2RlX21vZHVsZXMvZDMtaW50ZXJwb2xhdGUvc3JjL2Jhc2lzQ2xvc2VkLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1pbnRlcnBvbGF0ZS9zcmMvY29uc3RhbnQuanMiLCAibm9kZV9tb2R1bGVzL2QzLWludGVycG9sYXRlL3NyYy9jb2xvci5qcyIsICJub2RlX21vZHVsZXMvZDMtaW50ZXJwb2xhdGUvc3JjL3JnYi5qcyIsICJub2RlX21vZHVsZXMvZDMtaW50ZXJwb2xhdGUvc3JjL251bWJlci5qcyIsICJub2RlX21vZHVsZXMvZDMtaW50ZXJwb2xhdGUvc3JjL3N0cmluZy5qcyIsICJub2RlX21vZHVsZXMvZDMtaW50ZXJwb2xhdGUvc3JjL3RyYW5zZm9ybS9kZWNvbXBvc2UuanMiLCAibm9kZV9tb2R1bGVzL2QzLWludGVycG9sYXRlL3NyYy90cmFuc2Zvcm0vcGFyc2UuanMiLCAibm9kZV9tb2R1bGVzL2QzLWludGVycG9sYXRlL3NyYy90cmFuc2Zvcm0vaW5kZXguanMiLCAibm9kZV9tb2R1bGVzL2QzLWludGVycG9sYXRlL3NyYy96b29tLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10aW1lci9zcmMvdGltZXIuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRpbWVyL3NyYy90aW1lb3V0LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy90cmFuc2l0aW9uL3NjaGVkdWxlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy9pbnRlcnJ1cHQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3NlbGVjdGlvbi9pbnRlcnJ1cHQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vdHdlZW4uanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vaW50ZXJwb2xhdGUuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vYXR0ci5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvdHJhbnNpdGlvbi9hdHRyVHdlZW4uanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vZGVsYXkuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vZHVyYXRpb24uanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vZWFzZS5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvdHJhbnNpdGlvbi9lYXNlVmFyeWluZy5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvdHJhbnNpdGlvbi9maWx0ZXIuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vbWVyZ2UuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vb24uanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vcmVtb3ZlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy90cmFuc2l0aW9uL3NlbGVjdC5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvdHJhbnNpdGlvbi9zZWxlY3RBbGwuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vc2VsZWN0aW9uLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy90cmFuc2l0aW9uL3N0eWxlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy90cmFuc2l0aW9uL3N0eWxlVHdlZW4uanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vdGV4dC5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvdHJhbnNpdGlvbi90ZXh0VHdlZW4uanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vdHJhbnNpdGlvbi5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvdHJhbnNpdGlvbi9lbmQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vaW5kZXguanMiLCAibm9kZV9tb2R1bGVzL2QzLWVhc2Uvc3JjL2N1YmljLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy9zZWxlY3Rpb24vdHJhbnNpdGlvbi5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvc2VsZWN0aW9uL2luZGV4LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1icnVzaC9zcmMvYnJ1c2guanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9hZGQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9jb3Zlci5qcyIsICJub2RlX21vZHVsZXMvZDMtcXVhZHRyZWUvc3JjL2RhdGEuanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9leHRlbnQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9xdWFkLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1xdWFkdHJlZS9zcmMvZmluZC5qcyIsICJub2RlX21vZHVsZXMvZDMtcXVhZHRyZWUvc3JjL3JlbW92ZS5qcyIsICJub2RlX21vZHVsZXMvZDMtcXVhZHRyZWUvc3JjL3Jvb3QuanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9zaXplLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1xdWFkdHJlZS9zcmMvdmlzaXQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy92aXNpdEFmdGVyLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1xdWFkdHJlZS9zcmMveC5qcyIsICJub2RlX21vZHVsZXMvZDMtcXVhZHRyZWUvc3JjL3kuanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9xdWFkdHJlZS5qcyIsICJub2RlX21vZHVsZXMvZDMtZm9yY2Uvc3JjL2NvbnN0YW50LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1mb3JjZS9zcmMvamlnZ2xlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1mb3JjZS9zcmMvY29sbGlkZS5qcyIsICJub2RlX21vZHVsZXMvZDMtZm9yY2Uvc3JjL2xpbmsuanMiLCAibm9kZV9tb2R1bGVzL2QzLWZvcmNlL3NyYy9sY2cuanMiLCAibm9kZV9tb2R1bGVzL2QzLWZvcmNlL3NyYy9zaW11bGF0aW9uLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1mb3JjZS9zcmMvbWFueUJvZHkuanMiLCAibm9kZV9tb2R1bGVzL2QzLWZvcmNlL3NyYy94LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1mb3JjZS9zcmMveS5qcyIsICJub2RlX21vZHVsZXMvZDMtem9vbS9zcmMvY29uc3RhbnQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXpvb20vc3JjL2V2ZW50LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy16b29tL3NyYy90cmFuc2Zvcm0uanMiLCAibm9kZV9tb2R1bGVzL2QzLXpvb20vc3JjL25vZXZlbnQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXpvb20vc3JjL3pvb20uanMiLCAic3JjL3N1Z2dlc3QudHMiLCAic3JjL2VkaXRvci1leHRlbnNpb24udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7XG4gIE1hcmtkb3duUG9zdFByb2Nlc3NvckNvbnRleHQsXG4gIE1hcmtkb3duVmlldyxcbiAgTm90aWNlLFxuICBQbHVnaW4sXG4gIFRGaWxlLFxuICBXb3Jrc3BhY2VMZWFmLFxufSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB7XG4gIHBhcnNlTXVsdGlPYmplY3RGaWxlLFxuICBQYXJzZWRGaWxlLFxuICBQYXJzZWRPYmplY3QsXG4gIGdldFNlY29uZFByb3BlcnR5LFxufSBmcm9tIFwiLi9wYXJzZXJcIjtcbmltcG9ydCB7IGJ1aWxkR3JhcGgsIEdyYXBoRGF0YSwgVmF1bHRGaWxlIH0gZnJvbSBcIi4vZ3JhcGgtZGF0YVwiO1xuaW1wb3J0IHsgR3JhcGhWaWV3LCBWSUVXX1RZUEUgfSBmcm9tIFwiLi9ncmFwaC12aWV3XCI7XG5pbXBvcnQgeyBPYmplY3RMaW5rU3VnZ2VzdCB9IGZyb20gXCIuL3N1Z2dlc3RcIjtcbmltcG9ydCB7IG9iamVjdExpbmtIaWdobGlnaHRlciwgb2JqZWN0TGlua1dyYXBwZXJLZXltYXAgfSBmcm9tIFwiLi9lZGl0b3ItZXh0ZW5zaW9uXCI7XG5pbXBvcnQge1xuICBPYmplY3RMaW5rc1NldHRpbmdzLFxuICBERUZBVUxUX1NFVFRJTkdTLFxuICBPYmplY3RMaW5rc1NldHRpbmdUYWIsXG59IGZyb20gXCIuL3NldHRpbmdzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIE9iamVjdExpbmtzUGx1Z2luIGV4dGVuZHMgUGx1Z2luIHtcbiAgc2V0dGluZ3M6IE9iamVjdExpbmtzU2V0dGluZ3MgPSBERUZBVUxUX1NFVFRJTkdTO1xuICBwcml2YXRlIGdyYXBoRGF0YTogR3JhcGhEYXRhIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgc3VnZ2VzdFByb3ZpZGVyOiBPYmplY3RMaW5rU3VnZ2VzdCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGFsbE9iamVjdHM6IFBhcnNlZE9iamVjdFtdID0gW107XG4gIC8qKiBNYXA6IGxvd2VyY2FzZSBrZXkgdmFsdWUgLT4gUGFyc2VkT2JqZWN0IChmb3IgcXVpY2sgbG9va3VwcykgKi9cbiAgcHJpdmF0ZSBvYmplY3RJbmRleDogTWFwPHN0cmluZywgUGFyc2VkT2JqZWN0PiA9IG5ldyBNYXAoKTtcblxuICBhc3luYyBvbmxvYWQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gXHUyNTAwXHUyNTAwIExvYWQgc2V0dGluZ3MgXHUyNTAwXHUyNTAwXG4gICAgYXdhaXQgdGhpcy5sb2FkU2V0dGluZ3MoKTtcblxuICAgIC8vIFx1MjUwMFx1MjUwMCBTZXR0aW5ncyB0YWIgXHUyNTAwXHUyNTAwXG4gICAgdGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBPYmplY3RMaW5rc1NldHRpbmdUYWIodGhpcy5hcHAsIHRoaXMpKTtcblxuICAgIC8vIFx1MjUwMFx1MjUwMCBSZWdpc3RlciB2aWV3IFx1MjUwMFx1MjUwMFxuICAgIHRoaXMucmVnaXN0ZXJWaWV3KFZJRVdfVFlQRSwgKGxlYWYpID0+IHtcbiAgICAgIGNvbnN0IHZpZXcgPSBuZXcgR3JhcGhWaWV3KGxlYWYpO1xuICAgICAgdmlldy5uYXZpZ2F0ZVRvT2JqZWN0ID0gKGZpbGVQYXRoLCBzdGFydExpbmUpID0+XG4gICAgICAgIHRoaXMuZ29Ub09iamVjdChmaWxlUGF0aCwgc3RhcnRMaW5lKTtcbiAgICAgIHZpZXcubmF2aWdhdGVUb0ZpbGUgPSAoZmlsZVBhdGgpID0+IHRoaXMuZ29Ub0ZpbGUoZmlsZVBhdGgpO1xuICAgICAgcmV0dXJuIHZpZXc7XG4gICAgfSk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgUmVnaXN0ZXIgc3VnZ2VzdCBwcm92aWRlciBcdTI1MDBcdTI1MDBcbiAgICB0aGlzLnN1Z2dlc3RQcm92aWRlciA9IG5ldyBPYmplY3RMaW5rU3VnZ2VzdCh0aGlzLmFwcCk7XG4gICAgdGhpcy5yZWdpc3RlckVkaXRvclN1Z2dlc3QodGhpcy5zdWdnZXN0UHJvdmlkZXIpO1xuXG4gICAgLy8gXHUyNTAwXHUyNTAwIFJlZ2lzdGVyIENNNiBlZGl0b3IgZXh0ZW5zaW9uczogaGlnaGxpZ2h0aW5nICsgc2VsZWN0aW9uIHdyYXBwZXIgXHUyNTAwXHUyNTAwXG4gICAgdGhpcy5yZWdpc3RlckVkaXRvckV4dGVuc2lvbihbb2JqZWN0TGlua0hpZ2hsaWdodGVyLCBvYmplY3RMaW5rV3JhcHBlcktleW1hcF0pO1xuXG4gICAgLy8gXHUyNTAwXHUyNTAwIE1hcmtkb3duIHBvc3QtcHJvY2Vzc29yOiByZW5kZXIge3tvYmplY3R9fSBhcyBjbGlja2FibGUgbGlua3MgXHUyNTAwXHUyNTAwXG4gICAgdGhpcy5yZWdpc3Rlck1hcmtkb3duUG9zdFByb2Nlc3NvcihcbiAgICAgIChlbDogSFRNTEVsZW1lbnQsIGN0eDogTWFya2Rvd25Qb3N0UHJvY2Vzc29yQ29udGV4dCkgPT4ge1xuICAgICAgICB0aGlzLnByb2Nlc3NPYmplY3RMaW5rcyhlbCk7XG4gICAgICB9XG4gICAgKTtcblxuICAgIC8vIFx1MjUwMFx1MjUwMCBSaWJib24gaWNvbiBcdTI1MDBcdTI1MDBcbiAgICB0aGlzLmFkZFJpYmJvbkljb24oXCJnaXQtZm9ya1wiLCBcIk9wZW4gT2JqZWN0IExpbmtzXCIsICgpID0+IHtcbiAgICAgIHRoaXMuYWN0aXZhdGVWaWV3KCk7XG4gICAgfSk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgQ29tbWFuZHMgXHUyNTAwXHUyNTAwXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcIm9wZW4tb2wtZ3JhcGhcIixcbiAgICAgIG5hbWU6IFwiT3BlbiBncmFwaCB2aWV3XCIsXG4gICAgICBjYWxsYmFjazogKCkgPT4gdGhpcy5hY3RpdmF0ZVZpZXcoKSxcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJyZWZyZXNoLW9sLWdyYXBoXCIsXG4gICAgICBuYW1lOiBcIlJlZnJlc2ggZ3JhcGhcIixcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB0aGlzLmZ1bGxSZWZyZXNoKCksXG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwib3Blbi11bmRlci1jdXJzb3JcIixcbiAgICAgIG5hbWU6IFwiT3BlbiBsaW5rIHVuZGVyIGN1cnNvclwiLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHRoaXMub3BlblVuZGVyQ3Vyc29yKCksXG4gICAgICBob3RrZXlzOiBbeyBtb2RpZmllcnM6IFtcIk1vZFwiXSwga2V5OiBcIkVudGVyXCIgfV0sXG4gICAgfSk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgSW5pdGlhbCBzY2FuIG9uIGxheW91dCByZWFkeSBcdTI1MDBcdTI1MDBcbiAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiB7XG4gICAgICB0aGlzLmZ1bGxSZWZyZXNoKCk7XG4gICAgfSk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgRmlsZSB3YXRjaGVycyBcdTI1MDBcdTI1MDBcbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICB0aGlzLmFwcC52YXVsdC5vbihcIm1vZGlmeVwiLCAoZmlsZSkgPT4ge1xuICAgICAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGaWxlICYmIGZpbGUuZXh0ZW5zaW9uID09PSBcIm1kXCIpIHtcbiAgICAgICAgICB0aGlzLmRlYm91bmNlUmVmcmVzaCgpO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICk7XG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAudmF1bHQub24oXCJjcmVhdGVcIiwgKGZpbGUpID0+IHtcbiAgICAgICAgaWYgKGZpbGUgaW5zdGFuY2VvZiBURmlsZSAmJiBmaWxlLmV4dGVuc2lvbiA9PT0gXCJtZFwiKSB7XG4gICAgICAgICAgdGhpcy5kZWJvdW5jZVJlZnJlc2goKTtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICApO1xuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLnZhdWx0Lm9uKFwiZGVsZXRlXCIsIChmaWxlKSA9PiB7XG4gICAgICAgIGlmIChmaWxlIGluc3RhbmNlb2YgVEZpbGUgJiYgZmlsZS5leHRlbnNpb24gPT09IFwibWRcIikge1xuICAgICAgICAgIHRoaXMuZGVib3VuY2VSZWZyZXNoKCk7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgKTtcbiAgfVxuXG4gIG9udW5sb2FkKCk6IHZvaWQge1xuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5kZXRhY2hMZWF2ZXNPZlR5cGUoVklFV19UWVBFKTtcbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCBEZWJvdW5jZSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBwcml2YXRlIGRlYm91bmNlVGltZXI6IFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbCA9IG51bGw7XG5cbiAgcHJpdmF0ZSBkZWJvdW5jZVJlZnJlc2goKTogdm9pZCB7XG4gICAgaWYgKHRoaXMuZGVib3VuY2VUaW1lcikgY2xlYXJUaW1lb3V0KHRoaXMuZGVib3VuY2VUaW1lcik7XG4gICAgdGhpcy5kZWJvdW5jZVRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB0aGlzLmZ1bGxSZWZyZXNoKCksIDgwMCk7XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgRnVsbCByZWZyZXNoOiBzY2FuLCBjaGVjayBkdXBlcywgdXBkYXRlIHZpZXdzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG4gIHByaXZhdGUgYXN5bmMgZnVsbFJlZnJlc2goKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgcGFyc2VkRmlsZXMgPSBhd2FpdCB0aGlzLnNjYW5NdWx0aU9iamVjdEZpbGVzKCk7XG4gICAgY29uc3QgYWxsRmlsZXMgPSBhd2FpdCB0aGlzLmdldEFsbFZhdWx0RmlsZXMoKTtcblxuICAgIC8vIEJ1aWxkIGluZGV4ICsgZGlzYW1iaWd1YXRlIGR1cGxpY2F0ZSBrZXkgdmFsdWVzXG4gICAgdGhpcy5hbGxPYmplY3RzID0gW107XG4gICAgdGhpcy5vYmplY3RJbmRleCA9IG5ldyBNYXAoKTtcbiAgICBjb25zdCBpZER1cGVzOiBzdHJpbmdbXSA9IFtdO1xuICAgIC8qKiBUcmFjayBpZHMgcGVyIGZpbGUgdG8gZGV0ZWN0IGR1cGxpY2F0ZSBpZHMgd2l0aGluIGEgZmlsZSAqL1xuICAgIGNvbnN0IGZpbGVJZFNldHM6IE1hcDxzdHJpbmcsIE1hcDxudW1iZXIsIHN0cmluZz4+ID0gbmV3IE1hcCgpO1xuICAgIC8qKiBNYXAgZnJvbSBwYXJzZWQgZmlsZSBwYXRoIHRvIGl0cyBrZXlQcm9wZXJ0eSBuYW1lICovXG4gICAgY29uc3QgZmlsZUtleVByb3BzOiBNYXA8c3RyaW5nLCBzdHJpbmc+ID0gbmV3IE1hcCgpO1xuXG4gICAgLy8gXHUyNTAwXHUyNTAwIFBoYXNlIDE6IENvbGxlY3QgYWxsIG9iamVjdHMgYW5kIGNoZWNrIGlkIGR1cGxpY2F0ZXMgXHUyNTAwXHUyNTAwXG4gICAgZm9yIChjb25zdCBmaWxlIG9mIHBhcnNlZEZpbGVzKSB7XG4gICAgICBmaWxlS2V5UHJvcHMuc2V0KGZpbGUuZmlsZVBhdGgsIGZpbGUua2V5UHJvcGVydHkpO1xuXG4gICAgICBpZiAoIWZpbGVJZFNldHMuaGFzKGZpbGUuZmlsZVBhdGgpKSB7XG4gICAgICAgIGZpbGVJZFNldHMuc2V0KGZpbGUuZmlsZVBhdGgsIG5ldyBNYXAoKSk7XG4gICAgICB9XG4gICAgICBjb25zdCBpZFNldCA9IGZpbGVJZFNldHMuZ2V0KGZpbGUuZmlsZVBhdGgpITtcblxuICAgICAgZm9yIChjb25zdCBvYmogb2YgZmlsZS5vYmplY3RzKSB7XG4gICAgICAgIHRoaXMuYWxsT2JqZWN0cy5wdXNoKG9iaik7XG5cbiAgICAgICAgLy8gQ2hlY2sgZHVwbGljYXRlIGlkcyB3aXRoaW4gdGhlIHNhbWUgZmlsZVxuICAgICAgICBpZiAoaWRTZXQuaGFzKG9iai5pZCkpIHtcbiAgICAgICAgICBpZER1cGVzLnB1c2goXG4gICAgICAgICAgICBgaWQgJHtvYmouaWR9IGR1cGxpY2F0ZWQgaW4gJHtvYmouZmlsZUxhYmVsfTogXCIke2lkU2V0LmdldChvYmouaWQpfVwiIGFuZCBcIiR7b2JqLmtleVZhbHVlfVwiYFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgaWRTZXQuc2V0KG9iai5pZCwgb2JqLmtleVZhbHVlKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgUGhhc2UgMjogRGlzYW1iaWd1YXRlIGR1cGxpY2F0ZSBrZXlWYWx1ZXMgXHUyNTAwXHUyNTAwXG4gICAgLy8gR3JvdXAgb2JqZWN0cyBieSBsb3dlcmNhc2Uga2V5VmFsdWVcbiAgICBjb25zdCBrZXlHcm91cHMgPSBuZXcgTWFwPHN0cmluZywgUGFyc2VkT2JqZWN0W10+KCk7XG4gICAgZm9yIChjb25zdCBvYmogb2YgdGhpcy5hbGxPYmplY3RzKSB7XG4gICAgICBjb25zdCBrID0gb2JqLmtleVZhbHVlLnRvTG93ZXJDYXNlKCk7XG4gICAgICBpZiAoIWtleUdyb3Vwcy5oYXMoaykpIGtleUdyb3Vwcy5zZXQoaywgW10pO1xuICAgICAga2V5R3JvdXBzLmdldChrKSEucHVzaChvYmopO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgWywgZ3JvdXBdIG9mIGtleUdyb3Vwcykge1xuICAgICAgaWYgKGdyb3VwLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICAvLyBVbmlxdWUga2V5OiBkaXNwbGF5S2V5ID0ga2V5VmFsdWUgKGFscmVhZHkgdGhlIGRlZmF1bHQpXG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICAvLyBNdWx0aXBsZSBvYmplY3RzIHNoYXJlIHRoZSBzYW1lIGtleVZhbHVlIC0tIGRpc2FtYmlndWF0ZVxuICAgICAgLy8gU3RlcCAxOiBUcnkgXCJrZXlWYWx1ZSAoZmlsZUxhYmVsKVwiXG4gICAgICBjb25zdCBmaWxlR3JvdXBzID0gbmV3IE1hcDxzdHJpbmcsIFBhcnNlZE9iamVjdFtdPigpO1xuICAgICAgZm9yIChjb25zdCBvYmogb2YgZ3JvdXApIHtcbiAgICAgICAgY29uc3QgZmsgPSBvYmouZmlsZUxhYmVsLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIGlmICghZmlsZUdyb3Vwcy5oYXMoZmspKSBmaWxlR3JvdXBzLnNldChmaywgW10pO1xuICAgICAgICBmaWxlR3JvdXBzLmdldChmaykhLnB1c2gob2JqKTtcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBbLCBmR3JvdXBdIG9mIGZpbGVHcm91cHMpIHtcbiAgICAgICAgaWYgKGZHcm91cC5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgICAvLyBrZXkgKyBmaWxlbmFtZSBpcyB1bmlxdWVcbiAgICAgICAgICBmR3JvdXBbMF0uZGlzcGxheUtleSA9IGAke2ZHcm91cFswXS5rZXlWYWx1ZX0gKCR7Zkdyb3VwWzBdLmZpbGVMYWJlbH0pYDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBrZXkgKyBmaWxlbmFtZSBzdGlsbCBjb2xsaWRlczogdXNlIHNlY29uZCBwcm9wZXJ0eVxuICAgICAgICAgIGZvciAoY29uc3Qgb2JqIG9mIGZHcm91cCkge1xuICAgICAgICAgICAgY29uc3Qga2V5UHJvcCA9IGZpbGVLZXlQcm9wcy5nZXQob2JqLmZpbGVQYXRoKSB8fCBcIlwiO1xuICAgICAgICAgICAgY29uc3Qgc2Vjb25kVmFsID0gZ2V0U2Vjb25kUHJvcGVydHkob2JqLCBrZXlQcm9wKTtcbiAgICAgICAgICAgIGlmIChzZWNvbmRWYWwpIHtcbiAgICAgICAgICAgICAgb2JqLmRpc3BsYXlLZXkgPSBgJHtvYmoua2V5VmFsdWV9ICgke3NlY29uZFZhbH0pYDtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIC8vIEZhbGxiYWNrOiB1c2UgaWRcbiAgICAgICAgICAgICAgb2JqLmRpc3BsYXlLZXkgPSBgJHtvYmoua2V5VmFsdWV9ICgjJHtvYmouaWR9KWA7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gXHUyNTAwXHUyNTAwIFBoYXNlIDM6IEJ1aWxkIG9iamVjdEluZGV4IHVzaW5nIGRpc3BsYXlLZXkgXHUyNTAwXHUyNTAwXG4gICAgLy8gUmVnaXN0ZXIgZWFjaCBvYmplY3QgYnkgaXRzIGRpc3BsYXlLZXkgKHByaW1hcnkgbG9va3VwKVxuICAgIGZvciAoY29uc3Qgb2JqIG9mIHRoaXMuYWxsT2JqZWN0cykge1xuICAgICAgdGhpcy5vYmplY3RJbmRleC5zZXQob2JqLmRpc3BsYXlLZXkudG9Mb3dlckNhc2UoKSwgb2JqKTtcbiAgICB9XG4gICAgLy8gQWxzbyByZWdpc3RlciBieSBwbGFpbiBrZXlWYWx1ZSBmb3Igbm9uLWFtYmlndW91cyBrZXlzXG4gICAgLy8gKHNvIGV4aXN0aW5nIHt7a2V5VmFsdWV9fSBsaW5rcyBzdGlsbCByZXNvbHZlIHdoZW4gdGhlcmUncyBubyBjb2xsaXNpb24pXG4gICAgZm9yIChjb25zdCBbaywgZ3JvdXBdIG9mIGtleUdyb3Vwcykge1xuICAgICAgaWYgKGdyb3VwLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICB0aGlzLm9iamVjdEluZGV4LnNldChrLCBncm91cFswXSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gV2FybiBvbiBkdXBsaWNhdGUgaWRzXG4gICAgaWYgKGlkRHVwZXMubGVuZ3RoID4gMCkge1xuICAgICAgbmV3IE5vdGljZShcbiAgICAgICAgYE9iamVjdCBMaW5rczogRHVwbGljYXRlIElEcyBmb3VuZDpcXG4ke2lkRHVwZXMuam9pbihcIlxcblwiKX1gLFxuICAgICAgICA4MDAwXG4gICAgICApO1xuICAgIH1cblxuICAgIC8vIFVwZGF0ZSBzdWdnZXN0IHByb3ZpZGVyXG4gICAgaWYgKHRoaXMuc3VnZ2VzdFByb3ZpZGVyKSB7XG4gICAgICB0aGlzLnN1Z2dlc3RQcm92aWRlci5zZXRPYmplY3RzKHRoaXMuYWxsT2JqZWN0cyk7XG4gICAgfVxuXG4gICAgLy8gQnVpbGQgZ3JhcGhcbiAgICB0aGlzLmdyYXBoRGF0YSA9IGJ1aWxkR3JhcGgocGFyc2VkRmlsZXMsIGFsbEZpbGVzKTtcblxuICAgIC8vIFVwZGF0ZSBvcGVuIGdyYXBoIHZpZXdzXG4gICAgdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShWSUVXX1RZUEUpLmZvckVhY2goKGxlYWYpID0+IHtcbiAgICAgIGlmIChsZWFmLnZpZXcgaW5zdGFuY2VvZiBHcmFwaFZpZXcpIHtcbiAgICAgICAgbGVhZi52aWV3Lm5hdmlnYXRlVG9PYmplY3QgPSAoZnAsIHNsKSA9PiB0aGlzLmdvVG9PYmplY3QoZnAsIHNsKTtcbiAgICAgICAgbGVhZi52aWV3Lm5hdmlnYXRlVG9GaWxlID0gKGZwKSA9PiB0aGlzLmdvVG9GaWxlKGZwKTtcbiAgICAgICAgbGVhZi52aWV3LnNldEdyYXBoRGF0YSh0aGlzLmdyYXBoRGF0YSEpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIFZhdWx0IHNjYW5uaW5nIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG4gIHByaXZhdGUgYXN5bmMgc2Nhbk11bHRpT2JqZWN0RmlsZXMoKTogUHJvbWlzZTxQYXJzZWRGaWxlW10+IHtcbiAgICBjb25zdCBmaWxlcyA9IHRoaXMuYXBwLnZhdWx0LmdldE1hcmtkb3duRmlsZXMoKTtcbiAgICBjb25zdCBwYXJzZWQ6IFBhcnNlZEZpbGVbXSA9IFtdO1xuICAgIGNvbnN0IHRhZyA9IHRoaXMuc2V0dGluZ3Mub2JqZWN0RmlsZVRhZy50cmltKCk7XG5cbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5yZWFkKGZpbGUpO1xuXG4gICAgICAgIC8vIElmIGEgdGFnIGlzIGNvbmZpZ3VyZWQsIG9ubHkgcGFyc2UgZmlsZXMgd2hvc2UgZnJvbnRtYXR0ZXJcbiAgICAgICAgLy8gaW5jbHVkZXMgdGhhdCB0YWcuXG4gICAgICAgIGlmICh0YWcpIHtcbiAgICAgICAgICBpZiAoIXRoaXMuaGFzRmlsZVRhZyhjb250ZW50LCB0YWcpKSBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHBhcnNlTXVsdGlPYmplY3RGaWxlKGNvbnRlbnQsIGZpbGUucGF0aCk7XG4gICAgICAgIGlmIChyZXN1bHQpIHBhcnNlZC5wdXNoKHJlc3VsdCk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLyogc2tpcCAqL1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcGFyc2VkO1xuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrIGlmIGEgbWFya2Rvd24gZmlsZSBjb250YWlucyB0aGUgZ2l2ZW4gdGFnLlxuICAgKiBTdXBwb3J0czpcbiAgICogIDEuIEJhcmUgYCN0YWdgIGFueXdoZXJlIGluIHRoZSBmaWxlIChlLmcuIGAjb2JqZWN0LWxpbmtzYCBvbiBsaW5lIDEpXG4gICAqICAyLiBZQU1MIGZyb250bWF0dGVyIGB0YWdzOiBbYSwgYl1gLCBgdGFnczogYWAsIG9yIGxpc3QgZm9ybVxuICAgKiAgMy4gVGhlIGB0YWc6YCBhbGlhcyB1c2VkIGJ5IHNvbWUgT2JzaWRpYW4gc2V0dXBzXG4gICAqL1xuICBwcml2YXRlIGhhc0ZpbGVUYWcoY29udGVudDogc3RyaW5nLCB0YWc6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IGxvd2VyVGFnID0gdGFnLnRvTG93ZXJDYXNlKCk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgMS4gQmFyZSAjdGFnIGFueXdoZXJlIGluIHRoZSBjb250ZW50IFx1MjUwMFx1MjUwMFxuICAgIC8vIE1hdGNoICN0YWcgYXMgYSB3aG9sZSB3b3JkIChub3QgaW5zaWRlIGFub3RoZXIgd29yZClcbiAgICBjb25zdCBiYXJlVGFnUmVnZXggPSBuZXcgUmVnRXhwKFxuICAgICAgYCg/Ol58XFxcXHMpIyR7dGFnLnJlcGxhY2UoL1suKis/XiR7fSgpfFtcXF1cXFxcXS9nLCBcIlxcXFwkJlwiKX0oPzpcXFxcc3wkKWAsXG4gICAgICBcImltXCJcbiAgICApO1xuICAgIGlmIChiYXJlVGFnUmVnZXgudGVzdChjb250ZW50KSkgcmV0dXJuIHRydWU7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgMi4gWUFNTCBmcm9udG1hdHRlciB0YWdzIFx1MjUwMFx1MjUwMFxuICAgIGlmICghY29udGVudC5zdGFydHNXaXRoKFwiLS0tXCIpKSByZXR1cm4gZmFsc2U7XG4gICAgY29uc3QgZW5kSWR4ID0gY29udGVudC5pbmRleE9mKFwiXFxuLS0tXCIsIDMpO1xuICAgIGlmIChlbmRJZHggPT09IC0xKSByZXR1cm4gZmFsc2U7XG4gICAgY29uc3QgZnJvbnRtYXR0ZXIgPSBjb250ZW50LnN1YnN0cmluZygzLCBlbmRJZHgpO1xuXG4gICAgLy8gTWF0Y2ggXCJ0YWdzOlwiIG9yIFwidGFnOlwiIGxpbmVzIHdpdGggaW5saW5lIHZhbHVlc1xuICAgIGZvciAoY29uc3QgbGluZSBvZiBmcm9udG1hdHRlci5zcGxpdChcIlxcblwiKSkge1xuICAgICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgICAgY29uc3QgbWF0Y2ggPSB0cmltbWVkLm1hdGNoKC9edGFncz9cXHMqOlxccyooLispJC9pKTtcbiAgICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlO1xuXG4gICAgICBsZXQgdmFsdWUgPSBtYXRjaFsxXS50cmltKCk7XG5cbiAgICAgIC8vIEFycmF5IGZvcm06IFthLCBiLCBjXVxuICAgICAgaWYgKHZhbHVlLnN0YXJ0c1dpdGgoXCJbXCIpICYmIHZhbHVlLmVuZHNXaXRoKFwiXVwiKSkge1xuICAgICAgICB2YWx1ZSA9IHZhbHVlLnNsaWNlKDEsIC0xKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgdGFncyA9IHZhbHVlLnNwbGl0KFwiLFwiKS5tYXAoKHQpID0+IHQudHJpbSgpLnRvTG93ZXJDYXNlKCkpO1xuICAgICAgaWYgKHRhZ3MuaW5jbHVkZXMobG93ZXJUYWcpKSByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBZQU1MIGxpc3QgZm9ybTpcbiAgICAvLyAgIHRhZ3M6XG4gICAgLy8gICAgIC0gdGFnMVxuICAgIC8vICAgICAtIHRhZzJcbiAgICBjb25zdCBsaXN0UmVnZXggPSAvXnRhZ3M/XFxzKjpcXHMqJC9pbTtcbiAgICBjb25zdCBsaXN0TWF0Y2ggPSBsaXN0UmVnZXguZXhlYyhmcm9udG1hdHRlcik7XG4gICAgaWYgKGxpc3RNYXRjaCkge1xuICAgICAgY29uc3QgYWZ0ZXJUYWdzID0gZnJvbnRtYXR0ZXIuc3Vic3RyaW5nKFxuICAgICAgICBsaXN0TWF0Y2guaW5kZXggKyBsaXN0TWF0Y2hbMF0ubGVuZ3RoXG4gICAgICApO1xuICAgICAgZm9yIChjb25zdCBsaW5lIG9mIGFmdGVyVGFncy5zcGxpdChcIlxcblwiKSkge1xuICAgICAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gICAgICAgIGlmICh0cmltbWVkLnN0YXJ0c1dpdGgoXCItIFwiKSkge1xuICAgICAgICAgIGNvbnN0IHRhZ1ZhbCA9IHRyaW1tZWQuc3Vic3RyaW5nKDIpLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICAgIGlmICh0YWdWYWwgPT09IGxvd2VyVGFnKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIGlmICh0cmltbWVkLmxlbmd0aCA+IDAgJiYgIXRyaW1tZWQuc3RhcnRzV2l0aChcIiNcIikpIHtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZ2V0QWxsVmF1bHRGaWxlcygpOiBQcm9taXNlPFZhdWx0RmlsZVtdPiB7XG4gICAgY29uc3QgZmlsZXMgPSB0aGlzLmFwcC52YXVsdC5nZXRNYXJrZG93bkZpbGVzKCk7XG4gICAgY29uc3QgcmVzdWx0OiBWYXVsdEZpbGVbXSA9IFtdO1xuICAgIGZvciAoY29uc3QgZmlsZSBvZiBmaWxlcykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSk7XG4gICAgICAgIHJlc3VsdC5wdXNoKHsgcGF0aDogZmlsZS5wYXRoLCBiYXNlbmFtZTogZmlsZS5iYXNlbmFtZSwgY29udGVudCB9KTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvKiBza2lwICovXG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgTWFya2Rvd24gcG9zdC1wcm9jZXNzb3IgZm9yIHt7b2JqZWN0fX0gbGlua3MgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbiAgcHJpdmF0ZSBwcm9jZXNzT2JqZWN0TGlua3MoZWw6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgLy8gV2FsayBhbGwgdGV4dCBub2RlcyBhbmQgcmVwbGFjZSB7ey4uLn19IHdpdGggY2xpY2thYmxlIHNwYW5zXG4gICAgY29uc3Qgd2Fsa2VyID0gZG9jdW1lbnQuY3JlYXRlVHJlZVdhbGtlcihlbCwgTm9kZUZpbHRlci5TSE9XX1RFWFQpO1xuICAgIGNvbnN0IG5vZGVzVG9SZXBsYWNlOiB7IG5vZGU6IFRleHQ7IG1hdGNoZXM6IFJlZ0V4cEV4ZWNBcnJheVtdIH1bXSA9IFtdO1xuXG4gICAgbGV0IHRleHROb2RlOiBUZXh0IHwgbnVsbDtcbiAgICB3aGlsZSAoKHRleHROb2RlID0gd2Fsa2VyLm5leHROb2RlKCkgYXMgVGV4dCB8IG51bGwpKSB7XG4gICAgICBjb25zdCB0ZXh0ID0gdGV4dE5vZGUudGV4dENvbnRlbnQgfHwgXCJcIjtcbiAgICAgIGNvbnN0IHJlZ2V4ID0gL1xce1xceyhbXn1dKylcXH1cXH0vZztcbiAgICAgIGNvbnN0IG1hdGNoZXM6IFJlZ0V4cEV4ZWNBcnJheVtdID0gW107XG4gICAgICBsZXQgbWF0Y2g6IFJlZ0V4cEV4ZWNBcnJheSB8IG51bGw7XG4gICAgICB3aGlsZSAoKG1hdGNoID0gcmVnZXguZXhlYyh0ZXh0KSkgIT09IG51bGwpIHtcbiAgICAgICAgbWF0Y2hlcy5wdXNoKHsgLi4ubWF0Y2gsIGluZGV4OiBtYXRjaC5pbmRleCB9IGFzIFJlZ0V4cEV4ZWNBcnJheSk7XG4gICAgICB9XG4gICAgICBpZiAobWF0Y2hlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIG5vZGVzVG9SZXBsYWNlLnB1c2goeyBub2RlOiB0ZXh0Tm9kZSwgbWF0Y2hlcyB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHsgbm9kZSwgbWF0Y2hlcyB9IG9mIG5vZGVzVG9SZXBsYWNlKSB7XG4gICAgICBjb25zdCB0ZXh0ID0gbm9kZS50ZXh0Q29udGVudCB8fCBcIlwiO1xuICAgICAgY29uc3QgcGFyZW50ID0gbm9kZS5wYXJlbnROb2RlO1xuICAgICAgaWYgKCFwYXJlbnQpIGNvbnRpbnVlO1xuXG4gICAgICBjb25zdCBmcmFnID0gZG9jdW1lbnQuY3JlYXRlRG9jdW1lbnRGcmFnbWVudCgpO1xuICAgICAgbGV0IGxhc3RJbmRleCA9IDA7XG5cbiAgICAgIGZvciAoY29uc3QgbWF0Y2ggb2YgbWF0Y2hlcykge1xuICAgICAgICAvLyBUZXh0IGJlZm9yZSB0aGUgbWF0Y2hcbiAgICAgICAgaWYgKG1hdGNoLmluZGV4ID4gbGFzdEluZGV4KSB7XG4gICAgICAgICAgZnJhZy5hcHBlbmRDaGlsZChcbiAgICAgICAgICAgIGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKHRleHQuc3Vic3RyaW5nKGxhc3RJbmRleCwgbWF0Y2guaW5kZXgpKVxuICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBUaGUge3tsaW5rfX0gaXRzZWxmXG4gICAgICAgIGxldCBsaW5rVGFyZ2V0ID0gbWF0Y2hbMV07XG4gICAgICAgIGxldCBkaXNwbGF5VGV4dCA9IGxpbmtUYXJnZXQ7XG4gICAgICAgIGNvbnN0IHBpcGVJZHggPSBsaW5rVGFyZ2V0LmluZGV4T2YoXCJ8XCIpO1xuICAgICAgICBpZiAocGlwZUlkeCAhPT0gLTEpIHtcbiAgICAgICAgICBkaXNwbGF5VGV4dCA9IGxpbmtUYXJnZXQuc3Vic3RyaW5nKHBpcGVJZHggKyAxKS50cmltKCk7XG4gICAgICAgICAgbGlua1RhcmdldCA9IGxpbmtUYXJnZXQuc3Vic3RyaW5nKDAsIHBpcGVJZHgpLnRyaW0oKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNwYW4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcbiAgICAgICAgc3Bhbi5jbGFzc05hbWUgPSBcIm9sLWlubGluZS1saW5rXCI7XG4gICAgICAgIHNwYW4udGV4dENvbnRlbnQgPSBkaXNwbGF5VGV4dDtcbiAgICAgICAgc3Bhbi5zZXRBdHRyaWJ1dGUoXCJkYXRhLW9sLXRhcmdldFwiLCBsaW5rVGFyZ2V0KTtcblxuICAgICAgICBjb25zdCBvYmogPSB0aGlzLm9iamVjdEluZGV4LmdldChsaW5rVGFyZ2V0LnRvTG93ZXJDYXNlKCkpO1xuICAgICAgICBpZiAoIW9iaikge1xuICAgICAgICAgIHNwYW4uY2xhc3NMaXN0LmFkZChcIm9sLWlubGluZS1saW5rLXVucmVzb2x2ZWRcIik7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDbGljayAtPiBuYXZpZ2F0ZSB0byB0aGUgb2JqZWN0XG4gICAgICAgIHNwYW4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIChlKSA9PiB7XG4gICAgICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgICAgY29uc3QgdGFyZ2V0ID0gc3Bhbi5nZXRBdHRyaWJ1dGUoXCJkYXRhLW9sLXRhcmdldFwiKSB8fCBcIlwiO1xuICAgICAgICAgIGNvbnN0IHRhcmdldE9iaiA9IHRoaXMub2JqZWN0SW5kZXguZ2V0KHRhcmdldC50b0xvd2VyQ2FzZSgpKTtcbiAgICAgICAgICBpZiAodGFyZ2V0T2JqKSB7XG4gICAgICAgICAgICB0aGlzLmdvVG9PYmplY3QodGFyZ2V0T2JqLmZpbGVQYXRoLCB0YXJnZXRPYmouc3RhcnRMaW5lKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbmV3IE5vdGljZShgT2JqZWN0IFwiJHt0YXJnZXR9XCIgbm90IGZvdW5kYCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBIb3ZlciAtPiBzaG93IHRvb2x0aXAgd2l0aCBwcm9wZXJ0aWVzXG4gICAgICAgIHNwYW4uYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlZW50ZXJcIiwgKGUpID0+IHtcbiAgICAgICAgICBjb25zdCB0YXJnZXQgPSBzcGFuLmdldEF0dHJpYnV0ZShcImRhdGEtb2wtdGFyZ2V0XCIpIHx8IFwiXCI7XG4gICAgICAgICAgY29uc3QgdGFyZ2V0T2JqID0gdGhpcy5vYmplY3RJbmRleC5nZXQodGFyZ2V0LnRvTG93ZXJDYXNlKCkpO1xuICAgICAgICAgIGlmICh0YXJnZXRPYmopIHtcbiAgICAgICAgICAgIHRoaXMuc2hvd09iamVjdFBvcG92ZXIoc3BhbiwgdGFyZ2V0T2JqKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBzcGFuLmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZWxlYXZlXCIsICgpID0+IHtcbiAgICAgICAgICB0aGlzLmhpZGVPYmplY3RQb3BvdmVyKCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGZyYWcuYXBwZW5kQ2hpbGQoc3Bhbik7XG4gICAgICAgIGxhc3RJbmRleCA9IG1hdGNoLmluZGV4ICsgbWF0Y2hbMF0ubGVuZ3RoO1xuICAgICAgfVxuXG4gICAgICAvLyBSZW1haW5pbmcgdGV4dFxuICAgICAgaWYgKGxhc3RJbmRleCA8IHRleHQubGVuZ3RoKSB7XG4gICAgICAgIGZyYWcuYXBwZW5kQ2hpbGQoZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUodGV4dC5zdWJzdHJpbmcobGFzdEluZGV4KSkpO1xuICAgICAgfVxuXG4gICAgICBwYXJlbnQucmVwbGFjZUNoaWxkKGZyYWcsIG5vZGUpO1xuICAgIH1cbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCBPYmplY3QgcG9wb3ZlciBvbiBob3ZlciBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBwcml2YXRlIHBvcG92ZXJFbDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcblxuICBwcml2YXRlIHNob3dPYmplY3RQb3BvdmVyKGFuY2hvcjogSFRNTEVsZW1lbnQsIG9iajogUGFyc2VkT2JqZWN0KTogdm9pZCB7XG4gICAgdGhpcy5oaWRlT2JqZWN0UG9wb3ZlcigpO1xuXG4gICAgY29uc3QgcG9wID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICBwb3AuY2xhc3NOYW1lID0gXCJvbC1wb3BvdmVyXCI7XG5cbiAgICBjb25zdCB0aXRsZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgdGl0bGUuY2xhc3NOYW1lID0gXCJvbC1wb3BvdmVyLXRpdGxlXCI7XG4gICAgdGl0bGUudGV4dENvbnRlbnQgPSBvYmouZGlzcGxheUtleTtcbiAgICBwb3AuYXBwZW5kQ2hpbGQodGl0bGUpO1xuXG4gICAgY29uc3QgZmlsZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgZmlsZS5jbGFzc05hbWUgPSBcIm9sLXBvcG92ZXItZmlsZVwiO1xuICAgIGZpbGUudGV4dENvbnRlbnQgPSBvYmouZmlsZUxhYmVsO1xuICAgIHBvcC5hcHBlbmRDaGlsZChmaWxlKTtcblxuICAgIGZvciAoY29uc3QgW2ssIHZdIG9mIE9iamVjdC5lbnRyaWVzKG9iai5wcm9wZXJ0aWVzKSkge1xuICAgICAgY29uc3Qgcm93ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgIHJvdy5jbGFzc05hbWUgPSBcIm9sLXBvcG92ZXItcm93XCI7XG4gICAgICByb3cuaW5uZXJIVE1MID0gYDxzcGFuIGNsYXNzPVwib2wtcG9wb3Zlci1rZXlcIj4ke2t9PC9zcGFuPjxzcGFuIGNsYXNzPVwib2wtcG9wb3Zlci12YWxcIj4ke3Z9PC9zcGFuPmA7XG4gICAgICBwb3AuYXBwZW5kQ2hpbGQocm93KTtcbiAgICB9XG5cbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKHBvcCk7XG4gICAgdGhpcy5wb3BvdmVyRWwgPSBwb3A7XG5cbiAgICAvLyBQb3NpdGlvbiBiZWxvdyB0aGUgYW5jaG9yXG4gICAgY29uc3QgcmVjdCA9IGFuY2hvci5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICBwb3Auc3R5bGUudG9wID0gcmVjdC5ib3R0b20gKyA0ICsgXCJweFwiO1xuICAgIHBvcC5zdHlsZS5sZWZ0ID0gcmVjdC5sZWZ0ICsgXCJweFwiO1xuICB9XG5cbiAgcHJpdmF0ZSBoaWRlT2JqZWN0UG9wb3ZlcigpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5wb3BvdmVyRWwpIHtcbiAgICAgIHRoaXMucG9wb3ZlckVsLnJlbW92ZSgpO1xuICAgICAgdGhpcy5wb3BvdmVyRWwgPSBudWxsO1xuICAgIH1cbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCBOYXZpZ2F0aW9uIGhlbHBlcnMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbiAgcHJpdmF0ZSBhc3luYyBnb1RvT2JqZWN0KGZpbGVQYXRoOiBzdHJpbmcsIHN0YXJ0TGluZTogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChmaWxlUGF0aCk7XG4gICAgaWYgKCEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkge1xuICAgICAgbmV3IE5vdGljZShgRmlsZSBub3QgZm91bmQ6ICR7ZmlsZVBhdGh9YCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgbGVhZiA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRMZWFmKFwidGFiXCIpO1xuICAgIGF3YWl0IGxlYWYub3BlbkZpbGUoZmlsZSk7XG5cbiAgICAvLyBTY3JvbGwgdG8gdGhlIGxpbmVcbiAgICBjb25zdCB2aWV3ID0gbGVhZi52aWV3IGFzIGFueTtcbiAgICBpZiAodmlldyAmJiB2aWV3LmVkaXRvcikge1xuICAgICAgLy8gR2l2ZSB0aGUgZWRpdG9yIGEgbW9tZW50IHRvIGxvYWRcbiAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHZpZXcuZWRpdG9yLnNldEN1cnNvcih7IGxpbmU6IHN0YXJ0TGluZSwgY2g6IDAgfSk7XG4gICAgICAgICAgdmlldy5lZGl0b3Iuc2Nyb2xsSW50b1ZpZXcoXG4gICAgICAgICAgICB7IGZyb206IHsgbGluZTogc3RhcnRMaW5lLCBjaDogMCB9LCB0bzogeyBsaW5lOiBzdGFydExpbmUgKyA1LCBjaDogMCB9IH0sXG4gICAgICAgICAgICB0cnVlXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgLyogZWRpdG9yIG1pZ2h0IG5vdCBzdXBwb3J0IHRoaXMgKi9cbiAgICAgICAgfVxuICAgICAgfSwgMTAwKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGdvVG9GaWxlKGZpbGVQYXRoOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGZpbGVQYXRoKTtcbiAgICBpZiAoIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpKSB7XG4gICAgICBuZXcgTm90aWNlKGBGaWxlIG5vdCBmb3VuZDogJHtmaWxlUGF0aH1gKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgbGVhZiA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRMZWFmKFwidGFiXCIpO1xuICAgIGF3YWl0IGxlYWYub3BlbkZpbGUoZmlsZSk7XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgQWN0aXZhdGUgdmlldyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBhc3luYyBhY3RpdmF0ZVZpZXcoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgeyB3b3Jrc3BhY2UgfSA9IHRoaXMuYXBwO1xuXG4gICAgbGV0IGxlYWY6IFdvcmtzcGFjZUxlYWYgfCBudWxsID0gbnVsbDtcbiAgICBjb25zdCBsZWF2ZXMgPSB3b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFZJRVdfVFlQRSk7XG5cbiAgICBpZiAobGVhdmVzLmxlbmd0aCA+IDApIHtcbiAgICAgIGxlYWYgPSBsZWF2ZXNbMF07XG4gICAgfSBlbHNlIHtcbiAgICAgIGxlYWYgPSB3b3Jrc3BhY2UuZ2V0TGVhZihcInRhYlwiKTtcbiAgICAgIGF3YWl0IGxlYWYuc2V0Vmlld1N0YXRlKHsgdHlwZTogVklFV19UWVBFLCBhY3RpdmU6IHRydWUgfSk7XG4gICAgfVxuXG4gICAgd29ya3NwYWNlLnJldmVhbExlYWYobGVhZik7XG5cbiAgICAvLyBCdWlsZC9yZWZyZXNoIGdyYXBoXG4gICAgYXdhaXQgdGhpcy5mdWxsUmVmcmVzaCgpO1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIFNldHRpbmdzIHBlcnNpc3RlbmNlIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG4gIGFzeW5jIGxvYWRTZXR0aW5ncygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLnNldHRpbmdzID0gT2JqZWN0LmFzc2lnbih7fSwgREVGQVVMVF9TRVRUSU5HUywgYXdhaXQgdGhpcy5sb2FkRGF0YSgpKTtcbiAgfVxuXG4gIGFzeW5jIHNhdmVTZXR0aW5ncygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLnNhdmVEYXRhKHRoaXMuc2V0dGluZ3MpO1xuICAgIC8vIFJlLXNjYW4gYWZ0ZXIgc2V0dGluZ3MgY2hhbmdlICh0YWcgbWF5IGhhdmUgY2hhbmdlZClcbiAgICB0aGlzLmZ1bGxSZWZyZXNoKCk7XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgRWRpdG9yIGhlbHBlcnMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbiAgLyoqXG4gICAqIENvbW1hbmQ6IG9wZW4gdGhlIGZpbGUvb2JqZWN0IFwidW5kZXIgdGhlIGN1cnNvclwiLlxuICAgKiAtIElmIGN1cnNvciBpcyBpbnNpZGUgYSB3aWtpbGluayAoW1suLi5dXSksIG9wZW5zIHRoYXQgZmlsZS5cbiAgICogLSBJZiBjdXJzb3IgaXMgaW5zaWRlIGFuIG9iamVjdCBsaW5rICh7ey4uLn19KSwgb3BlbnMgdGhlIG9iamVjdCdzIHNvdXJjZSBmaWxlLlxuICAgKi9cbiAgYXN5bmMgb3BlblVuZGVyQ3Vyc29yKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHZpZXcgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShNYXJrZG93blZpZXcpO1xuICAgIGNvbnN0IGVkaXRvciA9IHZpZXc/LmVkaXRvcjtcbiAgICBpZiAoIWVkaXRvcikge1xuICAgICAgbmV3IE5vdGljZShcIk9iamVjdCBMaW5rczogTm8gYWN0aXZlIGVkaXRvclwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBjdXJzb3IgPSBlZGl0b3IuZ2V0Q3Vyc29yKCk7XG4gICAgY29uc3QgbGluZSA9IGVkaXRvci5nZXRMaW5lKGN1cnNvci5saW5lKSBhcyBzdHJpbmc7XG4gICAgY29uc3QgY2ggPSBjdXJzb3IuY2ggYXMgbnVtYmVyO1xuXG4gICAgY29uc3Qgd2l0aGluID0gKG9wZW46IHN0cmluZywgY2xvc2U6IHN0cmluZyk6IHN0cmluZyB8IG51bGwgPT4ge1xuICAgICAgY29uc3QgbGVmdCA9IGxpbmUubGFzdEluZGV4T2Yob3BlbiwgY2gpO1xuICAgICAgaWYgKGxlZnQgPT09IC0xKSByZXR1cm4gbnVsbDtcbiAgICAgIGNvbnN0IHJpZ2h0ID0gbGluZS5pbmRleE9mKGNsb3NlLCBsZWZ0ICsgb3Blbi5sZW5ndGgpO1xuICAgICAgaWYgKHJpZ2h0ID09PSAtMSkgcmV0dXJuIG51bGw7XG4gICAgICBpZiAoY2ggPCBsZWZ0ICsgb3Blbi5sZW5ndGggfHwgY2ggPiByaWdodCkgcmV0dXJuIG51bGw7XG4gICAgICByZXR1cm4gbGluZS5zdWJzdHJpbmcobGVmdCArIG9wZW4ubGVuZ3RoLCByaWdodCk7XG4gICAgfTtcblxuICAgIC8vIDEpIFdpa2lsaW5rOiBbW3RhcmdldHxhbGlhc11dXG4gICAgY29uc3Qgd2lrID0gd2l0aGluKFwiW1tcIiwgXCJdXVwiKTtcbiAgICBpZiAod2lrKSB7XG4gICAgICBjb25zdCB0YXJnZXQgPSB3aWsuc3BsaXQoXCJ8XCIpWzBdLnRyaW0oKTtcbiAgICAgIGNvbnN0IGRlc3QgPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpcnN0TGlua3BhdGhEZXN0KHRhcmdldCwgdmlldz8uZmlsZT8ucGF0aCB8fCBcIlwiKTtcbiAgICAgIGlmIChkZXN0KSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRMZWFmKFwidGFiXCIpLm9wZW5GaWxlKGRlc3QpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBuZXcgTm90aWNlKGBGaWxlIG5vdCBmb3VuZDogJHt0YXJnZXR9YCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gMikgT2JqZWN0IGxpbms6IHt7b2JqZWN0fGFsaWFzfX1cbiAgICBjb25zdCBvYmogPSB3aXRoaW4oXCJ7e1wiLCBcIn19XCIpO1xuICAgIGlmIChvYmopIHtcbiAgICAgIGNvbnN0IHRhcmdldCA9IG9iai5zcGxpdChcInxcIilbMF0udHJpbSgpO1xuICAgICAgY29uc3QgZm91bmQgPSB0aGlzLm9iamVjdEluZGV4LmdldCh0YXJnZXQudG9Mb3dlckNhc2UoKSk7XG4gICAgICBpZiAoZm91bmQpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5nb1RvT2JqZWN0KGZvdW5kLmZpbGVQYXRoLCBmb3VuZC5zdGFydExpbmUpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBuZXcgTm90aWNlKGBPYmplY3QgXCIke3RhcmdldH1cIiBub3QgZm91bmRgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBuZXcgTm90aWNlKFwiTm8gbGluayB1bmRlciBjdXJzb3JcIik7XG4gIH1cbn1cblxuIiwgIi8qKlxuICogUGFyc2VyIGZvciBtdWx0aS1vYmplY3QgbWFya2Rvd24gZmlsZXMuXG4gKlxuICogRm9ybWF0OlxuICogICBrZXk6IDxwcm9wZXJ0eV9uYW1lPlxuICpcbiAqICAgLS0tXG4gKlxuICogICBwcm9wMTogdmFsdWUxXG4gKiAgIHByb3AyOiB2YWx1ZTJcbiAqXG4gKiAgIC0tLVxuICpcbiAqICAgcHJvcDE6IHZhbHVlM1xuICogICBwcm9wMjogdmFsdWU0XG4gKi9cblxuZXhwb3J0IGludGVyZmFjZSBQYXJzZWRPYmplY3Qge1xuICAvKiogVGhlIHZhbHVlIG9mIHRoZSBrZXkgcHJvcGVydHkgLS0gdXNlZCBhcyB0aGUgbGlua2FibGUgbmFtZSAqL1xuICBrZXlWYWx1ZTogc3RyaW5nO1xuICAvKipcbiAgICogRGlzYW1iaWd1YXRlZCBpZGVudGlmaWVyIHVzZWQgZm9yIHt7fX0gbGlua3MsIGluZGV4IGxvb2t1cHMsIGFuZCBncmFwaCBsYWJlbHMuXG4gICAqIERlZmF1bHRzIHRvIGtleVZhbHVlLiBJZiBkdXBsaWNhdGVzIGV4aXN0OlxuICAgKiAgIC0gZGlmZmVyZW50IGZpbGVzOiBcImtleVZhbHVlIChmaWxlTGFiZWwpXCJcbiAgICogICAtIHNhbWUgZmlsZTogXCJrZXlWYWx1ZSAoc2Vjb25kUHJvcGVydHlWYWx1ZSlcIlxuICAgKiBTZXQgZHVyaW5nIGZ1bGxSZWZyZXNoKCkgaW4gbWFpbi50cy5cbiAgICovXG4gIGRpc3BsYXlLZXk6IHN0cmluZztcbiAgLyoqIE1hbmRhdG9yeSBudW1lcmljIGlkIGZvciB0aGlzIG9iamVjdCAqL1xuICBpZDogbnVtYmVyO1xuICAvKiogQWxsIHByb3BlcnRpZXMgb2YgdGhpcyBvYmplY3QgKGluc2VydGlvbi1vcmRlcmVkKSAqL1xuICBwcm9wZXJ0aWVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICAvKiogT3JkZXJlZCBsaXN0IG9mIHByb3BlcnR5IG5hbWVzIGFzIHRoZXkgYXBwZWFyIGluIHRoZSBmaWxlICovXG4gIHByb3BlcnR5T3JkZXI6IHN0cmluZ1tdO1xuICAvKiogU291cmNlIGZpbGUgcGF0aCAqL1xuICBmaWxlUGF0aDogc3RyaW5nO1xuICAvKiogU291cmNlIGZpbGUgYmFzZW5hbWUgKHdpdGhvdXQgZXh0ZW5zaW9uKSAqL1xuICBmaWxlTGFiZWw6IHN0cmluZztcbiAgLyoqIDAtaW5kZXhlZCBsaW5lIG51bWJlciB3aGVyZSB0aGlzIG9iamVjdCBibG9jayBzdGFydHMgaW4gdGhlIGZpbGUgKi9cbiAgc3RhcnRMaW5lOiBudW1iZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUGFyc2VkRmlsZSB7XG4gIC8qKiBUaGUgcHJvcGVydHkgbmFtZSB1c2VkIGFzIGtleSAqL1xuICBrZXlQcm9wZXJ0eTogc3RyaW5nO1xuICAvKiogQWxsIHBhcnNlZCBvYmplY3RzIGluIHRoaXMgZmlsZSAqL1xuICBvYmplY3RzOiBQYXJzZWRPYmplY3RbXTtcbiAgLyoqIFNvdXJjZSBmaWxlIHBhdGggKi9cbiAgZmlsZVBhdGg6IHN0cmluZztcbn1cblxuLyoqXG4gKiBQYXJzZSBhIG11bHRpLW9iamVjdCBtYXJrZG93biBmaWxlLlxuICogUmV0dXJucyBudWxsIGlmIHRoZSBmaWxlIGRvZXNuJ3QgZm9sbG93IHRoZSBleHBlY3RlZCBmb3JtYXQuXG4gKlxuICogU2tpcHMgWUFNTCBmcm9udG1hdHRlciAoaWYgcHJlc2VudCkgYmVmb3JlIGxvb2tpbmcgZm9yIHRoZVxuICogYGtleTogPHByb3BlcnR5PmAgaGVhZGVyIGFuZCBgLS0tYCBzZXBhcmF0ZWQgb2JqZWN0IGJsb2Nrcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTXVsdGlPYmplY3RGaWxlKFxuICBjb250ZW50OiBzdHJpbmcsXG4gIGZpbGVQYXRoOiBzdHJpbmdcbik6IFBhcnNlZEZpbGUgfCBudWxsIHtcbiAgY29uc3QgbGluZXMgPSBjb250ZW50LnNwbGl0KFwiXFxuXCIpO1xuXG4gIC8vIFNraXAgWUFNTCBmcm9udG1hdHRlciAob3BlbmluZyAtLS0gb24gZmlyc3QgbGluZSwgY2xvc2luZyAtLS0gbGF0ZXIpXG4gIGxldCBzdGFydElkeCA9IDA7XG4gIGlmIChsaW5lcy5sZW5ndGggPiAwICYmIGxpbmVzWzBdLnRyaW0oKSA9PT0gXCItLS1cIikge1xuICAgIGZvciAobGV0IGkgPSAxOyBpIDwgbGluZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGlmIChsaW5lc1tpXS50cmltKCkgPT09IFwiLS0tXCIpIHtcbiAgICAgICAgc3RhcnRJZHggPSBpICsgMTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gRmlyc3Qgbm9uLWVtcHR5IGxpbmUgKGFmdGVyIGZyb250bWF0dGVyKSBzaG91bGQgYmUgXCJrZXk6IDxwcm9wZXJ0eT5cIlxuICAvLyBCdXQgc2tpcCBiYXJlICN0YWcgbGluZXMgKGUuZy4gI29iamVjdC1saW5rcykgdGhhdCBwcmVjZWRlIGl0XG4gIGxldCBrZXlMaW5lID0gXCJcIjtcbiAgZm9yIChsZXQgaSA9IHN0YXJ0SWR4OyBpIDwgbGluZXMubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZXNbaV0udHJpbSgpO1xuICAgIGlmICh0cmltbWVkLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgLy8gU2tpcCBiYXJlIHRhZyBsaW5lcyBsaWtlIFwiI29iamVjdC1saW5rc1wiXG4gICAgaWYgKHRyaW1tZWQuc3RhcnRzV2l0aChcIiNcIikgJiYgIXRyaW1tZWQuaW5jbHVkZXMoXCI6XCIpKSBjb250aW51ZTtcbiAgICBrZXlMaW5lID0gdHJpbW1lZDtcbiAgICBicmVhaztcbiAgfVxuXG4gIGNvbnN0IGtleU1hdGNoID0ga2V5TGluZS5tYXRjaCgvXmtleTpcXHMqKC4rKSQvaSk7XG4gIGlmICgha2V5TWF0Y2gpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGtleVByb3BlcnR5ID0ga2V5TWF0Y2hbMV0udHJpbSgpO1xuICBjb25zdCBmaWxlTGFiZWwgPSBmaWxlUGF0aC5yZXBsYWNlKC9eLipcXC8vLCBcIlwiKS5yZXBsYWNlKC9cXC5tZCQvaSwgXCJcIik7XG5cbiAgLy8gV2FsayBsaW5lcyAoYWZ0ZXIgZnJvbnRtYXR0ZXIpIHRvIGZpbmQgLS0tIHNlcGFyYXRvcnMgYW5kIGJ1aWxkIG9iamVjdHNcbiAgY29uc3Qgb2JqZWN0czogUGFyc2VkT2JqZWN0W10gPSBbXTtcbiAgbGV0IGN1cnJlbnRCbG9jazogeyBsaW5lczogc3RyaW5nW107IHN0YXJ0TGluZTogbnVtYmVyIH0gfCBudWxsID0gbnVsbDtcbiAgbGV0IHBhc3NlZEZpcnN0U2VwYXJhdG9yID0gZmFsc2U7XG5cbiAgZm9yIChsZXQgaSA9IHN0YXJ0SWR4OyBpIDwgbGluZXMubGVuZ3RoOyBpKyspIHtcbiAgICBjb25zdCB0cmltbWVkID0gbGluZXNbaV0udHJpbSgpO1xuXG4gICAgaWYgKHRyaW1tZWQgPT09IFwiLS0tXCIpIHtcbiAgICAgIC8vIEZsdXNoIHRoZSBjdXJyZW50IGJsb2NrIGlmIHdlIGhhdmUgb25lXG4gICAgICBpZiAoY3VycmVudEJsb2NrICYmIHBhc3NlZEZpcnN0U2VwYXJhdG9yKSB7XG4gICAgICAgIGNvbnN0IG9iaiA9IHBhcnNlQmxvY2soY3VycmVudEJsb2NrLCBrZXlQcm9wZXJ0eSwgZmlsZVBhdGgsIGZpbGVMYWJlbCk7XG4gICAgICAgIGlmIChvYmopIG9iamVjdHMucHVzaChvYmopO1xuICAgICAgfVxuICAgICAgcGFzc2VkRmlyc3RTZXBhcmF0b3IgPSB0cnVlO1xuICAgICAgY3VycmVudEJsb2NrID0geyBsaW5lczogW10sIHN0YXJ0TGluZTogaSArIDEgfTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChjdXJyZW50QmxvY2sgJiYgcGFzc2VkRmlyc3RTZXBhcmF0b3IpIHtcbiAgICAgIGN1cnJlbnRCbG9jay5saW5lcy5wdXNoKHRyaW1tZWQpO1xuICAgIH1cbiAgfVxuXG4gIC8vIEZsdXNoIHRoZSBsYXN0IGJsb2NrXG4gIGlmIChjdXJyZW50QmxvY2sgJiYgcGFzc2VkRmlyc3RTZXBhcmF0b3IpIHtcbiAgICBjb25zdCBvYmogPSBwYXJzZUJsb2NrKGN1cnJlbnRCbG9jaywga2V5UHJvcGVydHksIGZpbGVQYXRoLCBmaWxlTGFiZWwpO1xuICAgIGlmIChvYmopIG9iamVjdHMucHVzaChvYmopO1xuICB9XG5cbiAgaWYgKG9iamVjdHMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcblxuICByZXR1cm4geyBrZXlQcm9wZXJ0eSwgb2JqZWN0cywgZmlsZVBhdGggfTtcbn1cblxuZnVuY3Rpb24gcGFyc2VCbG9jayhcbiAgYmxvY2s6IHsgbGluZXM6IHN0cmluZ1tdOyBzdGFydExpbmU6IG51bWJlciB9LFxuICBrZXlQcm9wZXJ0eTogc3RyaW5nLFxuICBmaWxlUGF0aDogc3RyaW5nLFxuICBmaWxlTGFiZWw6IHN0cmluZ1xuKTogUGFyc2VkT2JqZWN0IHwgbnVsbCB7XG4gIGNvbnN0IHByb3BlcnRpZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcbiAgY29uc3QgcHJvcGVydHlPcmRlcjogc3RyaW5nW10gPSBbXTtcblxuICBmb3IgKGNvbnN0IGxpbmUgb2YgYmxvY2subGluZXMpIHtcbiAgICBpZiAoIWxpbmUpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGNvbG9uSW5kZXggPSBsaW5lLmluZGV4T2YoXCI6XCIpO1xuICAgIGlmIChjb2xvbkluZGV4ID09PSAtMSkgY29udGludWU7XG5cbiAgICBjb25zdCBwcm9wID0gbGluZS5zdWJzdHJpbmcoMCwgY29sb25JbmRleCkudHJpbSgpO1xuICAgIGNvbnN0IHZhbCA9IGxpbmUuc3Vic3RyaW5nKGNvbG9uSW5kZXggKyAxKS50cmltKCk7XG4gICAgaWYgKHByb3AgJiYgdmFsKSB7XG4gICAgICBwcm9wZXJ0aWVzW3Byb3BdID0gdmFsO1xuICAgICAgcHJvcGVydHlPcmRlci5wdXNoKHByb3ApO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGtleVZhbHVlID0gcHJvcGVydGllc1trZXlQcm9wZXJ0eV07XG4gIGlmICgha2V5VmFsdWUpIHJldHVybiBudWxsO1xuXG4gIC8vIE1hbmRhdG9yeSBpZCBwcm9wZXJ0eTogbXVzdCBiZSBwcmVzZW50IGFuZCBudW1lcmljXG4gIGNvbnN0IHJhd0lkID0gcHJvcGVydGllc1tcImlkXCJdO1xuICBpZiAoIXJhd0lkKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgaWQgPSBOdW1iZXIocmF3SWQpO1xuICBpZiAoaXNOYU4oaWQpKSByZXR1cm4gbnVsbDtcblxuICByZXR1cm4ge1xuICAgIGtleVZhbHVlLFxuICAgIGRpc3BsYXlLZXk6IGtleVZhbHVlLCAvLyBkZWZhdWx0OyBkaXNhbWJpZ3VhdGVkIGxhdGVyIGluIGZ1bGxSZWZyZXNoKClcbiAgICBpZCxcbiAgICBwcm9wZXJ0aWVzLFxuICAgIHByb3BlcnR5T3JkZXIsXG4gICAgZmlsZVBhdGgsXG4gICAgZmlsZUxhYmVsLFxuICAgIHN0YXJ0TGluZTogYmxvY2suc3RhcnRMaW5lLFxuICB9O1xufVxuXG4vKipcbiAqIEdldCB0aGUgdmFsdWUgb2YgdGhlIFwic2Vjb25kIHByb3BlcnR5XCIgb2YgYW4gb2JqZWN0IGZvciBkaXNhbWJpZ3VhdGlvbi5cbiAqIFRoaXMgaXMgdGhlIGZpcnN0IHByb3BlcnR5IHRoYXQgaXMgbm90IHRoZSBrZXkgcHJvcGVydHkgYW5kIG5vdCBcImlkXCIuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRTZWNvbmRQcm9wZXJ0eShcbiAgb2JqOiBQYXJzZWRPYmplY3QsXG4gIGtleVByb3BlcnR5OiBzdHJpbmdcbik6IHN0cmluZyB8IG51bGwge1xuICBmb3IgKGNvbnN0IHByb3Agb2Ygb2JqLnByb3BlcnR5T3JkZXIpIHtcbiAgICBpZiAocHJvcCA9PT0ga2V5UHJvcGVydHkgfHwgcHJvcCA9PT0gXCJpZFwiKSBjb250aW51ZTtcbiAgICBjb25zdCB2YWwgPSBvYmoucHJvcGVydGllc1twcm9wXTtcbiAgICBpZiAodmFsKSByZXR1cm4gdmFsO1xuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIEV4dHJhY3QgYWxsIHt7b2JqZWN0IGxpbmtzfX0gZnJvbSBjb250ZW50LlxuICogUmV0dXJucyB0aGUgbGluayB0YXJnZXQgbmFtZXMgKHdpdGhvdXQge3sgfX0pLlxuICogSGFuZGxlcyBhbGlhc2VzIGxpa2Uge3t0YXJnZXR8YWxpYXN9fSBieSByZXR1cm5pbmcganVzdCBcInRhcmdldFwiLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdE9iamVjdExpbmtzKGNvbnRlbnQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgbGlua3M6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IHJlZ2V4ID0gL1xce1xceyhbXn1dKylcXH1cXH0vZztcbiAgbGV0IG1hdGNoO1xuXG4gIHdoaWxlICgobWF0Y2ggPSByZWdleC5leGVjKGNvbnRlbnQpKSAhPT0gbnVsbCkge1xuICAgIGxldCBsaW5rVGFyZ2V0ID0gbWF0Y2hbMV07XG4gICAgY29uc3QgcGlwZUluZGV4ID0gbGlua1RhcmdldC5pbmRleE9mKFwifFwiKTtcbiAgICBpZiAocGlwZUluZGV4ICE9PSAtMSkge1xuICAgICAgbGlua1RhcmdldCA9IGxpbmtUYXJnZXQuc3Vic3RyaW5nKDAsIHBpcGVJbmRleCk7XG4gICAgfVxuICAgIGxpbmtzLnB1c2gobGlua1RhcmdldC50cmltKCkpO1xuICB9XG5cbiAgcmV0dXJuIGxpbmtzO1xufVxuXG4vKipcbiAqIEV4dHJhY3QgYWxsIFtbd2lraWxpbmtzXV0gZnJvbSBjb250ZW50LlxuICogUmV0dXJucyB0aGUgbGluayB0YXJnZXQgbmFtZXMgKHdpdGhvdXQgW1sgXV0pLlxuICogSGFuZGxlcyBhbGlhc2VzIGxpa2UgW1t0YXJnZXR8YWxpYXNdXSBieSByZXR1cm5pbmcganVzdCBcInRhcmdldFwiLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdFdpa2lsaW5rcyhjb250ZW50OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IGxpbmtzOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCByZWdleCA9IC9cXFtcXFsoW15cXF1dKylcXF1cXF0vZztcbiAgbGV0IG1hdGNoO1xuXG4gIHdoaWxlICgobWF0Y2ggPSByZWdleC5leGVjKGNvbnRlbnQpKSAhPT0gbnVsbCkge1xuICAgIGxldCBsaW5rVGFyZ2V0ID0gbWF0Y2hbMV07XG4gICAgY29uc3QgcGlwZUluZGV4ID0gbGlua1RhcmdldC5pbmRleE9mKFwifFwiKTtcbiAgICBpZiAocGlwZUluZGV4ICE9PSAtMSkge1xuICAgICAgbGlua1RhcmdldCA9IGxpbmtUYXJnZXQuc3Vic3RyaW5nKDAsIHBpcGVJbmRleCk7XG4gICAgfVxuICAgIGxpbmtzLnB1c2gobGlua1RhcmdldC50cmltKCkpO1xuICB9XG5cbiAgcmV0dXJuIGxpbmtzO1xufVxuIiwgImltcG9ydCB7IFBhcnNlZEZpbGUsIGV4dHJhY3RPYmplY3RMaW5rcywgZXh0cmFjdFdpa2lsaW5rcyB9IGZyb20gXCIuL3BhcnNlclwiO1xuXG5leHBvcnQgaW50ZXJmYWNlIEdyYXBoTm9kZSB7XG4gIGlkOiBzdHJpbmc7XG4gIGxhYmVsOiBzdHJpbmc7XG4gIC8qKiBcIm9iamVjdFwiIGZvciBtdWx0aS1vYmplY3QgZW50cmllcywgXCJmaWxlXCIgZm9yIHJlZ3VsYXIgdmF1bHQgZmlsZXMgKi9cbiAgdHlwZTogXCJvYmplY3RcIiB8IFwiZmlsZVwiO1xuICBmaWxlUGF0aDogc3RyaW5nO1xuICBmaWxlTGFiZWw6IHN0cmluZztcbiAgcHJvcGVydGllczogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgLyoqIDAtaW5kZXhlZCBzdGFydCBsaW5lIGluIHRoZSBzb3VyY2UgZmlsZSAob2JqZWN0cyBvbmx5KSAqL1xuICBzdGFydExpbmU6IG51bWJlcjtcbiAgLyoqIE51bWJlciBvZiBjb25uZWN0aW9ucyAqL1xuICBjb25uZWN0aW9uczogbnVtYmVyO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEdyYXBoRWRnZSB7XG4gIHNvdXJjZTogc3RyaW5nO1xuICB0YXJnZXQ6IHN0cmluZztcbiAgLyoqIFwib2JqZWN0XCIgaWYgdGhpcyBlZGdlIGludm9sdmVzIGEge3t9fSBsaW5rLCBcIndpa2lcIiBmb3IgbmF0aXZlIFtbXV0gbGlua3MgKi9cbiAgZWRnZVR5cGU6IFwib2JqZWN0XCIgfCBcIndpa2lcIjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBHcmFwaERhdGEge1xuICBub2RlczogR3JhcGhOb2RlW107XG4gIGVkZ2VzOiBHcmFwaEVkZ2VbXTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBWYXVsdEZpbGUge1xuICBwYXRoOiBzdHJpbmc7XG4gIGJhc2VuYW1lOiBzdHJpbmc7XG4gIGNvbnRlbnQ6IHN0cmluZztcbn1cblxuLyoqXG4gKiBCdWlsZCB0aGUgZnVsbCBncmFwaCBmcm9tIHRoZSB2YXVsdC5cbiAqXG4gKiBOb2RlczpcbiAqICAgLSBFYWNoIG9iamVjdCBpbiBhIG11bHRpLW9iamVjdCBmaWxlIC0+IHR5cGUgXCJvYmplY3RcIlxuICogICAtIEVhY2ggcmVndWxhciB2YXVsdCBmaWxlIHRoYXQgcGFydGljaXBhdGVzIGluIGFueSBsaW5rIC0+IHR5cGUgXCJmaWxlXCJcbiAqXG4gKiBFZGdlczpcbiAqICAgLSBmaWxlIC0+IG9iamVjdCAgd2hlbiBhIGZpbGUgY29udGFpbnMge3tPYmplY3RLZXl9fVxuICogICAtIGZpbGUgLT4gZmlsZSAgICB3aGVuIGEgZmlsZSBjb250YWlucyBbW090aGVyRmlsZV1dIChuYXRpdmUgd2lraWxpbmtzKVxuICogICAtIG9iamVjdCAtPiBvYmplY3Qgd2hlbiBhbiBvYmplY3QncyBwcm9wZXJ0eSB2YWx1ZSBjb250YWlucyB7e090aGVyT2JqZWN0fX1cbiAqXG4gKiBNdWx0aS1vYmplY3Qgc291cmNlIGZpbGVzIChlLmcuLCBGaWxtcy5tZCkgZG8gTk9UIGFwcGVhciBhcyBmaWxlIG5vZGVzO1xuICogb25seSB0aGVpciBpbmRpdmlkdWFsIG9iamVjdHMgZG8uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZEdyYXBoKFxuICBwYXJzZWRGaWxlczogUGFyc2VkRmlsZVtdLFxuICBhbGxGaWxlczogVmF1bHRGaWxlW11cbik6IEdyYXBoRGF0YSB7XG4gIGNvbnN0IG5vZGVzOiBHcmFwaE5vZGVbXSA9IFtdO1xuICBjb25zdCBlZGdlczogR3JhcGhFZGdlW10gPSBbXTtcbiAgY29uc3QgZWRnZVNldCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBjb25zdCBub2RlTWFwID0gbmV3IE1hcDxzdHJpbmcsIEdyYXBoTm9kZT4oKTtcblxuICAvLyBQYXRocyBvZiBtdWx0aS1vYmplY3Qgc291cmNlIGZpbGVzIC0tIHRoZXNlIGFyZSByZXBsYWNlZCBieSB0aGVpciBvYmplY3RzXG4gIGNvbnN0IG11bHRpT2JqZWN0UGF0aHMgPSBuZXcgU2V0KHBhcnNlZEZpbGVzLm1hcCgoZikgPT4gZi5maWxlUGF0aCkpO1xuXG4gIC8vIE1hcDogbG93ZXJjYXNlIGtleSB2YWx1ZSAtPiBvYmplY3Qgbm9kZSBpZFxuICBjb25zdCBvYmpLZXlUb05vZGVJZCA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCk7XG5cbiAgLy8gTWFwOiBsb3dlcmNhc2UgZmlsZSBiYXNlbmFtZSAtPiBmaWxlIHBhdGggKGZvciByZXNvbHZpbmcgW1t3aWtpbGlua3NdXSlcbiAgY29uc3QgYmFzZW5hbWVUb1BhdGggPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpO1xuICBmb3IgKGNvbnN0IGYgb2YgYWxsRmlsZXMpIHtcbiAgICBiYXNlbmFtZVRvUGF0aC5zZXQoZi5iYXNlbmFtZS50b0xvd2VyQ2FzZSgpLCBmLnBhdGgpO1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIDEuIENyZWF0ZSBvYmplY3Qgbm9kZXMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG4gIGZvciAoY29uc3QgZmlsZSBvZiBwYXJzZWRGaWxlcykge1xuICAgIGZvciAoY29uc3Qgb2JqIG9mIGZpbGUub2JqZWN0cykge1xuICAgICAgY29uc3Qgbm9kZUlkID0gYG9iajo6JHtmaWxlLmZpbGVQYXRofTo6JHtvYmouZGlzcGxheUtleX1gO1xuICAgICAgY29uc3Qgbm9kZTogR3JhcGhOb2RlID0ge1xuICAgICAgICBpZDogbm9kZUlkLFxuICAgICAgICBsYWJlbDogb2JqLmRpc3BsYXlLZXksXG4gICAgICAgIHR5cGU6IFwib2JqZWN0XCIsXG4gICAgICAgIGZpbGVQYXRoOiBvYmouZmlsZVBhdGgsXG4gICAgICAgIGZpbGVMYWJlbDogb2JqLmZpbGVMYWJlbCxcbiAgICAgICAgcHJvcGVydGllczogb2JqLnByb3BlcnRpZXMsXG4gICAgICAgIHN0YXJ0TGluZTogb2JqLnN0YXJ0TGluZSxcbiAgICAgICAgY29ubmVjdGlvbnM6IDAsXG4gICAgICB9O1xuICAgICAgbm9kZXMucHVzaChub2RlKTtcbiAgICAgIG5vZGVNYXAuc2V0KG5vZGVJZCwgbm9kZSk7XG4gICAgICAvLyBSZWdpc3RlciBieSBkaXNwbGF5S2V5IChwcmltYXJ5IGxvb2t1cCBmb3IgZGlzYW1iaWd1YXRlZCBuYW1lcylcbiAgICAgIG9iaktleVRvTm9kZUlkLnNldChvYmouZGlzcGxheUtleS50b0xvd2VyQ2FzZSgpLCBub2RlSWQpO1xuICAgICAgLy8gQWxzbyByZWdpc3RlciBieSBwbGFpbiBrZXlWYWx1ZSBpZiBub3QgYWxyZWFkeSB0YWtlbiAoYmFja3dhcmRzIGNvbXBhdClcbiAgICAgIGNvbnN0IHBsYWluID0gb2JqLmtleVZhbHVlLnRvTG93ZXJDYXNlKCk7XG4gICAgICBpZiAoIW9iaktleVRvTm9kZUlkLmhhcyhwbGFpbikpIHtcbiAgICAgICAgb2JqS2V5VG9Ob2RlSWQuc2V0KHBsYWluLCBub2RlSWQpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIEhlbHBlcjogZ2V0IG9yIGNyZWF0ZSBhIGZpbGUgbm9kZVxuICBmdW5jdGlvbiBlbnN1cmVGaWxlTm9kZShwYXRoOiBzdHJpbmcsIGJhc2VuYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IG5vZGVJZCA9IGBmaWxlOjoke3BhdGh9YDtcbiAgICBpZiAoIW5vZGVNYXAuaGFzKG5vZGVJZCkpIHtcbiAgICAgIGNvbnN0IG5vZGU6IEdyYXBoTm9kZSA9IHtcbiAgICAgICAgaWQ6IG5vZGVJZCxcbiAgICAgICAgbGFiZWw6IGJhc2VuYW1lLFxuICAgICAgICB0eXBlOiBcImZpbGVcIixcbiAgICAgICAgZmlsZVBhdGg6IHBhdGgsXG4gICAgICAgIGZpbGVMYWJlbDogYmFzZW5hbWUsXG4gICAgICAgIHByb3BlcnRpZXM6IHt9LFxuICAgICAgICBzdGFydExpbmU6IDAsXG4gICAgICAgIGNvbm5lY3Rpb25zOiAwLFxuICAgICAgfTtcbiAgICAgIG5vZGVzLnB1c2gobm9kZSk7XG4gICAgICBub2RlTWFwLnNldChub2RlSWQsIG5vZGUpO1xuICAgIH1cbiAgICByZXR1cm4gbm9kZUlkO1xuICB9XG5cbiAgLy8gSGVscGVyOiBhZGQgYW4gZWRnZSAoZGVkdXBsaWNhdGVkKVxuICBmdW5jdGlvbiBhZGRFZGdlKHNyYzogc3RyaW5nLCB0Z3Q6IHN0cmluZywgdHlwZTogXCJvYmplY3RcIiB8IFwid2lraVwiKTogdm9pZCB7XG4gICAgY29uc3QgZWRnZUlkID0gW3NyYywgdGd0XS5zb3J0KCkuam9pbihcIi0tXCIpO1xuICAgIGlmIChlZGdlU2V0LmhhcyhlZGdlSWQpKSByZXR1cm47XG4gICAgZWRnZVNldC5hZGQoZWRnZUlkKTtcbiAgICBlZGdlcy5wdXNoKHsgc291cmNlOiBzcmMsIHRhcmdldDogdGd0LCBlZGdlVHlwZTogdHlwZSB9KTtcbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCAyLiBTY2FuIGFsbCBmaWxlcyBmb3IgbGlua3MgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG4gIGZvciAoY29uc3QgZmlsZSBvZiBhbGxGaWxlcykge1xuICAgIC8vIFNraXAgbXVsdGktb2JqZWN0IHNvdXJjZSBmaWxlcyAodGhlaXIgb2JqZWN0cyBhcmUgYWxyZWFkeSBub2RlcylcbiAgICBpZiAobXVsdGlPYmplY3RQYXRocy5oYXMoZmlsZS5wYXRoKSkgY29udGludWU7XG5cbiAgICBjb25zdCBvYmplY3RMaW5rcyA9IGV4dHJhY3RPYmplY3RMaW5rcyhmaWxlLmNvbnRlbnQpO1xuICAgIGNvbnN0IHdpa2lsaW5rcyA9IGV4dHJhY3RXaWtpbGlua3MoZmlsZS5jb250ZW50KTtcblxuICAgIGxldCBmaWxlTm9kZUlkOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcblxuICAgIC8vIHt7b2JqZWN0IGxpbmtzfX0gLT4gZmlsZS10by1vYmplY3QgZWRnZXNcbiAgICBmb3IgKGNvbnN0IGxpbmsgb2Ygb2JqZWN0TGlua3MpIHtcbiAgICAgIGNvbnN0IHRhcmdldE9iaklkID0gb2JqS2V5VG9Ob2RlSWQuZ2V0KGxpbmsudG9Mb3dlckNhc2UoKSk7XG4gICAgICBpZiAodGFyZ2V0T2JqSWQpIHtcbiAgICAgICAgaWYgKCFmaWxlTm9kZUlkKSBmaWxlTm9kZUlkID0gZW5zdXJlRmlsZU5vZGUoZmlsZS5wYXRoLCBmaWxlLmJhc2VuYW1lKTtcbiAgICAgICAgYWRkRWRnZShmaWxlTm9kZUlkLCB0YXJnZXRPYmpJZCwgXCJvYmplY3RcIik7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gW1t3aWtpbGlua3NdXSAtPiBmaWxlLXRvLWZpbGUgZWRnZXNcbiAgICBmb3IgKGNvbnN0IGxpbmsgb2Ygd2lraWxpbmtzKSB7XG4gICAgICBjb25zdCB0YXJnZXRQYXRoID0gYmFzZW5hbWVUb1BhdGguZ2V0KGxpbmsudG9Mb3dlckNhc2UoKSk7XG4gICAgICBpZiAoIXRhcmdldFBhdGgpIGNvbnRpbnVlO1xuICAgICAgLy8gRG9uJ3QgbGluayB0byBtdWx0aS1vYmplY3Qgc291cmNlIGZpbGVzIGFzIGZpbGUgbm9kZXNcbiAgICAgIGlmIChtdWx0aU9iamVjdFBhdGhzLmhhcyh0YXJnZXRQYXRoKSkgY29udGludWU7XG5cbiAgICAgIC8vIEZpbmQgdGhlIHRhcmdldCBmaWxlIHRvIGdldCBpdHMgYmFzZW5hbWVcbiAgICAgIGNvbnN0IHRhcmdldEZpbGUgPSBhbGxGaWxlcy5maW5kKChmKSA9PiBmLnBhdGggPT09IHRhcmdldFBhdGgpO1xuICAgICAgaWYgKCF0YXJnZXRGaWxlKSBjb250aW51ZTtcblxuICAgICAgaWYgKCFmaWxlTm9kZUlkKSBmaWxlTm9kZUlkID0gZW5zdXJlRmlsZU5vZGUoZmlsZS5wYXRoLCBmaWxlLmJhc2VuYW1lKTtcbiAgICAgIGNvbnN0IHRhcmdldEZpbGVJZCA9IGVuc3VyZUZpbGVOb2RlKHRhcmdldFBhdGgsIHRhcmdldEZpbGUuYmFzZW5hbWUpO1xuXG4gICAgICBpZiAoZmlsZU5vZGVJZCAhPT0gdGFyZ2V0RmlsZUlkKSB7XG4gICAgICAgIGFkZEVkZ2UoZmlsZU5vZGVJZCwgdGFyZ2V0RmlsZUlkLCBcIndpa2lcIik7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIDMuIE9iamVjdC10by1vYmplY3QgbGlua3MgdmlhIHt7fX0gaW4gcHJvcGVydHkgdmFsdWVzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuICBmb3IgKGNvbnN0IGZpbGUgb2YgcGFyc2VkRmlsZXMpIHtcbiAgICBmb3IgKGNvbnN0IG9iaiBvZiBmaWxlLm9iamVjdHMpIHtcbiAgICAgIGNvbnN0IHNyY0lkID0gYG9iajo6JHtmaWxlLmZpbGVQYXRofTo6JHtvYmouZGlzcGxheUtleX1gO1xuICAgICAgZm9yIChjb25zdCB2YWwgb2YgT2JqZWN0LnZhbHVlcyhvYmoucHJvcGVydGllcykpIHtcbiAgICAgICAgZm9yIChjb25zdCBsaW5rIG9mIGV4dHJhY3RPYmplY3RMaW5rcyh2YWwpKSB7XG4gICAgICAgICAgY29uc3QgdGd0SWQgPSBvYmpLZXlUb05vZGVJZC5nZXQobGluay50b0xvd2VyQ2FzZSgpKTtcbiAgICAgICAgICBpZiAodGd0SWQgJiYgdGd0SWQgIT09IHNyY0lkKSB7XG4gICAgICAgICAgICBhZGRFZGdlKHNyY0lkLCB0Z3RJZCwgXCJvYmplY3RcIik7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIDQuIENvdW50IGNvbm5lY3Rpb25zIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuICBmb3IgKGNvbnN0IGVkZ2Ugb2YgZWRnZXMpIHtcbiAgICBjb25zdCBzcmMgPSBub2RlTWFwLmdldChlZGdlLnNvdXJjZSk7XG4gICAgY29uc3QgdGd0ID0gbm9kZU1hcC5nZXQoZWRnZS50YXJnZXQpO1xuICAgIGlmIChzcmMpIHNyYy5jb25uZWN0aW9ucysrO1xuICAgIGlmICh0Z3QpIHRndC5jb25uZWN0aW9ucysrO1xuICB9XG5cbiAgcmV0dXJuIHsgbm9kZXMsIGVkZ2VzIH07XG59XG4iLCAiaW1wb3J0IHsgSXRlbVZpZXcsIFdvcmtzcGFjZUxlYWYgfSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB7IEdyYXBoRGF0YSB9IGZyb20gXCIuL2dyYXBoLWRhdGFcIjtcbmltcG9ydCB7IENvbmZpZ1BhbmVsLCBHcmFwaENvbmZpZywgREVGQVVMVF9DT05GSUcgfSBmcm9tIFwiLi9zZXR0aW5nc1wiO1xuaW1wb3J0IHtcbiAgc2VsZWN0LFxuICBmb3JjZVNpbXVsYXRpb24sXG4gIGZvcmNlTGluayxcbiAgZm9yY2VNYW55Qm9keSxcbiAgZm9yY2VDb2xsaWRlLFxuICBmb3JjZVgsXG4gIGZvcmNlWSxcbiAgem9vbSxcbiAgem9vbUlkZW50aXR5LFxuICB6b29tVHJhbnNmb3JtLFxuICBab29tQmVoYXZpb3IsXG4gIFpvb21UcmFuc2Zvcm0sXG4gIFNpbXVsYXRpb24sXG4gIFNpbXVsYXRpb25Ob2RlRGF0dW0sXG4gIFNpbXVsYXRpb25MaW5rRGF0dW0sXG59IGZyb20gXCJkM1wiO1xuXG5leHBvcnQgY29uc3QgVklFV19UWVBFID0gXCJvYmplY3QtbGlua3MtZ3JhcGhcIjtcblxuLyogXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXG4gICBTaW11bGF0aW9uIE5vZGUvRWRnZSBUeXBlc1xuICAgXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwICovXG5cbnR5cGUgTm9kZVR5cGUgPSBcIm9iamVjdFwiIHwgXCJmaWxlXCI7XG5cbnR5cGUgU2ltTm9kZSA9IFNpbXVsYXRpb25Ob2RlRGF0dW0gJiB7XG4gIGlkOiBzdHJpbmc7XG4gIGxhYmVsOiBzdHJpbmc7XG4gIHR5cGU6IE5vZGVUeXBlO1xuICBmaWxlUGF0aDogc3RyaW5nO1xuICBmaWxlTGFiZWw6IHN0cmluZztcbiAgcHJvcGVydGllczogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgc3RhcnRMaW5lOiBudW1iZXI7XG4gIGNvbm5lY3Rpb25zOiBudW1iZXI7XG4gIHJhZGl1czogbnVtYmVyO1xuICAvKiogVHJ1ZSB3aGVuIG5vZGUgaGFkIDAgY29ubmVjdGlvbnMgaW4gdGhlICpiYXNlKiBncmFwaCAoZXhjbHVkaW5nIG9wdGlvbmFsIGZvbGRlciBlZGdlcykuICovXG4gIGlzT3JwaGFuOiBib29sZWFuO1xuICAvKiogQ3VycmVudCB2aXN1YWwgYWxwaGEgKGludGVycG9sYXRlZCBmb3Igc21vb3RoIHRyYW5zaXRpb25zKSAqL1xuICBhbHBoYTogbnVtYmVyO1xuICAvKiogVGFyZ2V0IGFscGhhIGJhc2VkIG9uIGhpZ2hsaWdodCBzdGF0ZSAqL1xuICB0YXJnZXRBbHBoYTogbnVtYmVyO1xuICAvKiogZDMgZml4ZWQgcG9zaXRpb24gKi9cbiAgZng6IG51bWJlciB8IG51bGw7XG4gIGZ5OiBudW1iZXIgfCBudWxsO1xufTtcblxudHlwZSBTaW1FZGdlID0gU2ltdWxhdGlvbkxpbmtEYXR1bTxTaW1Ob2RlPiAmIHtcbiAgZWRnZVR5cGU6IFwib2JqZWN0XCIgfCBcIndpa2lcIjtcbiAgLyoqIEN1cnJlbnQgdmlzdWFsIGFscGhhICovXG4gIGFscGhhOiBudW1iZXI7XG4gIC8qKiBUYXJnZXQgYWxwaGEgKi9cbiAgdGFyZ2V0QWxwaGE6IG51bWJlcjtcbn07XG5cbi8qIFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFxuICAgQ29sb3IgSGVscGVyc1xuICAgXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwICovXG5cbmZ1bmN0aW9uIHBhcnNlQ29sb3IoY3NzOiBzdHJpbmcpOiBbbnVtYmVyLCBudW1iZXIsIG51bWJlcl0ge1xuICBpZiAoY3NzLnN0YXJ0c1dpdGgoXCIjXCIpKSB7XG4gICAgY29uc3QgaGV4ID0gY3NzLnNsaWNlKDEpO1xuICAgIGlmIChoZXgubGVuZ3RoID09PSAzKSB7XG4gICAgICByZXR1cm4gW1xuICAgICAgICBwYXJzZUludChoZXhbMF0gKyBoZXhbMF0sIDE2KSAvIDI1NSxcbiAgICAgICAgcGFyc2VJbnQoaGV4WzFdICsgaGV4WzFdLCAxNikgLyAyNTUsXG4gICAgICAgIHBhcnNlSW50KGhleFsyXSArIGhleFsyXSwgMTYpIC8gMjU1LFxuICAgICAgXTtcbiAgICB9XG4gICAgcmV0dXJuIFtcbiAgICAgIHBhcnNlSW50KGhleC5zbGljZSgwLCAyKSwgMTYpIC8gMjU1LFxuICAgICAgcGFyc2VJbnQoaGV4LnNsaWNlKDIsIDQpLCAxNikgLyAyNTUsXG4gICAgICBwYXJzZUludChoZXguc2xpY2UoNCwgNiksIDE2KSAvIDI1NSxcbiAgICBdO1xuICB9XG4gIGNvbnN0IG0gPSBjc3MubWF0Y2goL3JnYmE/XFwoXFxzKihcXGQrKSxcXHMqKFxcZCspLFxccyooXFxkKykvKTtcbiAgaWYgKG0pIHJldHVybiBbcGFyc2VJbnQobVsxXSkgLyAyNTUsIHBhcnNlSW50KG1bMl0pIC8gMjU1LCBwYXJzZUludChtWzNdKSAvIDI1NV07XG4gIHJldHVybiBbMC42LCAwLjYsIDAuNl07XG59XG5cbmZ1bmN0aW9uIGdldFRoZW1lQ29sb3IoZWw6IEhUTUxFbGVtZW50LCB2YXJOYW1lOiBzdHJpbmcsIGZhbGxiYWNrOiBzdHJpbmcpOiBbbnVtYmVyLCBudW1iZXIsIG51bWJlcl0ge1xuICBjb25zdCBzdHlsZSA9IGdldENvbXB1dGVkU3R5bGUoZWwpO1xuICBjb25zdCB2YWwgPSBzdHlsZS5nZXRQcm9wZXJ0eVZhbHVlKHZhck5hbWUpLnRyaW0oKTtcbiAgcmV0dXJuIHBhcnNlQ29sb3IodmFsIHx8IGZhbGxiYWNrKTtcbn1cblxuZnVuY3Rpb24gY29sb3JUb0NTUyhjOiBbbnVtYmVyLCBudW1iZXIsIG51bWJlcl0pOiBzdHJpbmcge1xuICByZXR1cm4gYHJnYigke01hdGgucm91bmQoY1swXSAqIDI1NSl9LCR7TWF0aC5yb3VuZChjWzFdICogMjU1KX0sJHtNYXRoLnJvdW5kKGNbMl0gKiAyNTUpfSlgO1xufVxuXG4vKiBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcbiAgIExlcnAgaGVscGVyXG4gICBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTAgKi9cblxuZnVuY3Rpb24gbGVycChhOiBudW1iZXIsIGI6IG51bWJlciwgdDogbnVtYmVyKTogbnVtYmVyIHtcbiAgcmV0dXJuIGEgKyAoYiAtIGEpICogdDtcbn1cblxuLyogXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXG4gICBHcmFwaFZpZXcgXHUyMDE0IENhbnZhcyArIGQzLWZvcmNlXG4gICBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTAgKi9cblxuZXhwb3J0IGNsYXNzIEdyYXBoVmlldyBleHRlbmRzIEl0ZW1WaWV3IHtcbiAgcHJpdmF0ZSBncmFwaERhdGE6IEdyYXBoRGF0YSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHNpbXVsYXRpb246IFNpbXVsYXRpb248U2ltTm9kZSwgU2ltRWRnZT4gfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSByZXNpemVPYnNlcnZlcjogUmVzaXplT2JzZXJ2ZXIgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBjb25maWdQYW5lbDogQ29uZmlnUGFuZWwgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBjb25maWc6IEdyYXBoQ29uZmlnID0geyAuLi5ERUZBVUxUX0NPTkZJRyB9O1xuXG4gIC8vIENhbnZhcyBzdGF0ZVxuICBwcml2YXRlIGNhbnZhc1dyYXBwZXI6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgY2FudmFzRWw6IEhUTUxDYW52YXNFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgY3R4OiBDYW52YXNSZW5kZXJpbmdDb250ZXh0MkQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBkcHIgPSAxO1xuXG4gIC8vIGQzLXpvb21cbiAgcHJpdmF0ZSB6b29tQmVoYXZpb3I6IFpvb21CZWhhdmlvcjxIVE1MQ2FudmFzRWxlbWVudCwgdW5rbm93bj4gfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSB6b29tVHJhbnNmb3JtOiBab29tVHJhbnNmb3JtID0gem9vbUlkZW50aXR5O1xuICBwcml2YXRlIGlzU3luY2luZ1pvb20gPSBmYWxzZTtcblxuICAvLyBTaW0gZGF0YVxuICBwcml2YXRlIHNpbU5vZGVzOiBTaW1Ob2RlW10gPSBbXTtcbiAgcHJpdmF0ZSBzaW1FZGdlczogU2ltRWRnZVtdID0gW107XG5cbiAgLy8gQ2FtZXJhIChjdXJyZW50ID0gc21vb3RoZWQsIHRhcmdldCA9IHdoZXJlIHdlIHdhbnQgdG8gYmUpXG4gIHByaXZhdGUgY2FtWCA9IDA7XG4gIHByaXZhdGUgY2FtWSA9IDA7XG4gIHByaXZhdGUgY2FtU2NhbGUgPSAwLjc7XG4gIHByaXZhdGUgdGFyZ2V0Q2FtWCA9IDA7XG4gIHByaXZhdGUgdGFyZ2V0Q2FtWSA9IDA7XG4gIHByaXZhdGUgdGFyZ2V0Q2FtU2NhbGUgPSAwLjc7XG5cbiAgLy8gSW50ZXJhY3Rpb24gc3RhdGVcbiAgcHJpdmF0ZSBob3ZlcmVkTm9kZTogU2ltTm9kZSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHNlbGVjdGVkTm9kZTogU2ltTm9kZSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGRyYWdOb2RlOiBTaW1Ob2RlIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgaXNEcmFnZ2luZyA9IGZhbHNlO1xuICBwcml2YXRlIGxhc3RDbGlja1RpbWUgPSAwO1xuICBwcml2YXRlIGxhc3RDbGlja0lkID0gXCJcIjtcblxuICAvLyBSZW5kZXIgbG9vcFxuICBwcml2YXRlIHJlbmRlckxvb3BJZDogbnVtYmVyID0gMDtcbiAgcHJpdmF0ZSBuZWVkc1JlZHJhdyA9IHRydWU7XG5cbiAgLy8gVGhlbWUgY29sb3JzIChjYWNoZWQpXG4gIHByaXZhdGUgY29sb3JOb2RlT2JqZWN0OiBbbnVtYmVyLCBudW1iZXIsIG51bWJlcl0gPSBbMC41LCAwLjUsIDEuMF07XG4gIHByaXZhdGUgY29sb3JOb2RlRmlsZTogW251bWJlciwgbnVtYmVyLCBudW1iZXJdID0gWzAuNiwgMC42LCAwLjZdO1xuICBwcml2YXRlIGNvbG9yRWRnZVdpa2k6IFtudW1iZXIsIG51bWJlciwgbnVtYmVyXSA9IFswLjUsIDAuNSwgMC41XTtcbiAgcHJpdmF0ZSBjb2xvckVkZ2VPYmo6IFtudW1iZXIsIG51bWJlciwgbnVtYmVyXSA9IFswLjUsIDAuNSwgMS4wXTtcbiAgcHJpdmF0ZSBjb2xvckhpZ2hsaWdodDogW251bWJlciwgbnVtYmVyLCBudW1iZXJdID0gWzAuNSwgMC41LCAxLjBdO1xuICBwcml2YXRlIGNvbG9yQmc6IFtudW1iZXIsIG51bWJlciwgbnVtYmVyXSA9IFswLjEsIDAuMSwgMC4xXTtcbiAgcHJpdmF0ZSBjb2xvclRleHQgPSBcIiNkY2RkZGVcIjtcblxuICAvLyBDYWxsYmFja3NcbiAgcHVibGljIG5hdmlnYXRlVG9PYmplY3Q6ICgoZmlsZVBhdGg6IHN0cmluZywgc3RhcnRMaW5lOiBudW1iZXIpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG4gIHB1YmxpYyBuYXZpZ2F0ZVRvRmlsZTogKChmaWxlUGF0aDogc3RyaW5nKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuXG4gIC8vIEJvdW5kIGhhbmRsZXJzXG4gIHByaXZhdGUgX29uV2hlZWw6ICgoZTogV2hlZWxFdmVudCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBfb25Nb3VzZURvd246ICgoZTogTW91c2VFdmVudCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBfb25Nb3VzZU1vdmU6ICgoZTogTW91c2VFdmVudCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBfb25Nb3VzZVVwOiAoKGU6IE1vdXNlRXZlbnQpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgX29uRGJsQ2xpY2s6ICgoZTogTW91c2VFdmVudCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBfb25Db250YWluZXJNb3VzZURvd246ICgoZTogTW91c2VFdmVudCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcblxuICBjb25zdHJ1Y3RvcihsZWFmOiBXb3Jrc3BhY2VMZWFmKSB7XG4gICAgc3VwZXIobGVhZik7XG4gIH1cblxuICBnZXRWaWV3VHlwZSgpOiBzdHJpbmcgeyByZXR1cm4gVklFV19UWVBFOyB9XG4gIGdldERpc3BsYXlUZXh0KCk6IHN0cmluZyB7IHJldHVybiBcIk9iamVjdCBMaW5rc1wiOyB9XG4gIGdldEljb24oKTogc3RyaW5nIHsgcmV0dXJuIFwiZ2l0LWZvcmtcIjsgfVxuXG4gIHNldEdyYXBoRGF0YShkYXRhOiBHcmFwaERhdGEpOiB2b2lkIHtcbiAgICB0aGlzLmdyYXBoRGF0YSA9IGRhdGE7XG4gICAgaWYgKHRoaXMuY29udGFpbmVyRWwpIHRoaXMucmVuZGVyR3JhcGgoKTtcbiAgfVxuXG4gIGFzeW5jIG9uT3BlbigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBjb250YWluZXIgPSB0aGlzLmNvbnRlbnRFbDtcbiAgICBjb250YWluZXIuZW1wdHkoKTtcbiAgICBjb250YWluZXIuYWRkQ2xhc3MoXCJvbC1ncmFwaC1jb250YWluZXJcIik7XG5cbiAgICBpZiAodGhpcy5ncmFwaERhdGEpIHtcbiAgICAgIHRoaXMucmVuZGVyR3JhcGgoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29udGFpbmVyLmNyZWF0ZUVsKFwiZGl2XCIsIHtcbiAgICAgICAgY2xzOiBcIm9sLWVtcHR5LXN0YXRlXCIsXG4gICAgICAgIHRleHQ6IFwiT3BlbiB0aGUgZ3JhcGggdXNpbmcgdGhlIGNvbW1hbmQgcGFsZXR0ZSBvciByaWJib24gaWNvbi5cIixcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIG9uQ2xvc2UoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5jbGVhbnVwKCk7XG4gIH1cblxuICBwcml2YXRlIGNsZWFudXAoKTogdm9pZCB7XG4gICAgdGhpcy5zdG9wUmVuZGVyTG9vcCgpO1xuICAgIGlmICh0aGlzLnNpbXVsYXRpb24pIHtcbiAgICAgIHRoaXMuc2ltdWxhdGlvbi5zdG9wKCk7XG4gICAgICB0aGlzLnNpbXVsYXRpb24ub24oXCJ0aWNrXCIsIG51bGwpO1xuICAgICAgdGhpcy5zaW11bGF0aW9uID0gbnVsbDtcbiAgICB9XG4gICAgaWYgKHRoaXMucmVzaXplT2JzZXJ2ZXIpIHsgdGhpcy5yZXNpemVPYnNlcnZlci5kaXNjb25uZWN0KCk7IHRoaXMucmVzaXplT2JzZXJ2ZXIgPSBudWxsOyB9XG4gICAgaWYgKHRoaXMuY29uZmlnUGFuZWwpIHsgdGhpcy5jb25maWdQYW5lbC5kZXN0cm95KCk7IHRoaXMuY29uZmlnUGFuZWwgPSBudWxsOyB9XG4gICAgdGhpcy5yZW1vdmVDYW52YXNMaXN0ZW5lcnMoKTtcbiAgICBpZiAodGhpcy5fb25Db250YWluZXJNb3VzZURvd24pIHtcbiAgICAgIHRoaXMuY29udGVudEVsLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJtb3VzZWRvd25cIiwgdGhpcy5fb25Db250YWluZXJNb3VzZURvd24sIHRydWUpO1xuICAgICAgdGhpcy5fb25Db250YWluZXJNb3VzZURvd24gPSBudWxsO1xuICAgIH1cblxuICAgIHRoaXMuc2ltTm9kZXMgPSBbXTtcbiAgICB0aGlzLnNpbUVkZ2VzID0gW107XG5cbiAgICB0aGlzLmNhbnZhc0VsPy5yZW1vdmUoKTtcbiAgICB0aGlzLmNhbnZhc0VsID0gbnVsbDtcbiAgICB0aGlzLmN0eCA9IG51bGw7XG4gICAgdGhpcy5jYW52YXNXcmFwcGVyID0gbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgcmVtb3ZlQ2FudmFzTGlzdGVuZXJzKCk6IHZvaWQge1xuICAgIGNvbnN0IGMgPSB0aGlzLmNhbnZhc0VsO1xuICAgIGlmICghYykgcmV0dXJuO1xuICAgIGlmICh0aGlzLl9vbldoZWVsKSBjLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJ3aGVlbFwiLCB0aGlzLl9vbldoZWVsKTtcbiAgICAvLyBtb3VzZWRvd24gd2FzIHJlZ2lzdGVyZWQgd2l0aCBjYXB0dXJlOnRydWUgdG8gaW50ZXJjZXB0IGJlZm9yZSBkMy16b29tXG4gICAgaWYgKHRoaXMuX29uTW91c2VEb3duKSBjLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJtb3VzZWRvd25cIiwgdGhpcy5fb25Nb3VzZURvd24sIHRydWUpO1xuICAgIGlmICh0aGlzLl9vbk1vdXNlTW92ZSkgYy5yZW1vdmVFdmVudExpc3RlbmVyKFwibW91c2Vtb3ZlXCIsIHRoaXMuX29uTW91c2VNb3ZlKTtcbiAgICBpZiAodGhpcy5fb25Nb3VzZVVwKSBjLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJtb3VzZXVwXCIsIHRoaXMuX29uTW91c2VVcCk7XG4gICAgaWYgKHRoaXMuX29uRGJsQ2xpY2spIGMucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImRibGNsaWNrXCIsIHRoaXMuX29uRGJsQ2xpY2spO1xuICB9XG5cbiAgLyogXHUyNTAwXHUyNTAwIFJlbmRlciBsb29wIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMCAqL1xuXG4gIHByaXZhdGUgc3RhcnRSZW5kZXJMb29wKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLnJlbmRlckxvb3BJZCkgcmV0dXJuO1xuICAgIGNvbnN0IGZyYW1lID0gKCkgPT4ge1xuICAgICAgdGhpcy5yZW5kZXJMb29wSWQgPSByZXF1ZXN0QW5pbWF0aW9uRnJhbWUoZnJhbWUpO1xuICAgICAgdGhpcy51cGRhdGVBbmREcmF3KCk7XG4gICAgfTtcbiAgICB0aGlzLnJlbmRlckxvb3BJZCA9IHJlcXVlc3RBbmltYXRpb25GcmFtZShmcmFtZSk7XG4gIH1cblxuICBwcml2YXRlIHN0b3BSZW5kZXJMb29wKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLnJlbmRlckxvb3BJZCkge1xuICAgICAgY2FuY2VsQW5pbWF0aW9uRnJhbWUodGhpcy5yZW5kZXJMb29wSWQpO1xuICAgICAgdGhpcy5yZW5kZXJMb29wSWQgPSAwO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgdXBkYXRlQW5kRHJhdygpOiB2b2lkIHtcbiAgICBsZXQgYW5pbWF0aW5nID0gZmFsc2U7XG5cbiAgICAvLyBTbW9vdGggY2FtZXJhIGludGVycG9sYXRpb25cbiAgICBjb25zdCBjYW1MZXJwID0gMC4xNTtcbiAgICBpZiAoTWF0aC5hYnModGhpcy5jYW1YIC0gdGhpcy50YXJnZXRDYW1YKSA+IDAuMDEgfHxcbiAgICAgICAgTWF0aC5hYnModGhpcy5jYW1ZIC0gdGhpcy50YXJnZXRDYW1ZKSA+IDAuMDEgfHxcbiAgICAgICAgTWF0aC5hYnModGhpcy5jYW1TY2FsZSAtIHRoaXMudGFyZ2V0Q2FtU2NhbGUpID4gMC4wMDAxKSB7XG4gICAgICB0aGlzLmNhbVggPSBsZXJwKHRoaXMuY2FtWCwgdGhpcy50YXJnZXRDYW1YLCBjYW1MZXJwKTtcbiAgICAgIHRoaXMuY2FtWSA9IGxlcnAodGhpcy5jYW1ZLCB0aGlzLnRhcmdldENhbVksIGNhbUxlcnApO1xuICAgICAgdGhpcy5jYW1TY2FsZSA9IGxlcnAodGhpcy5jYW1TY2FsZSwgdGhpcy50YXJnZXRDYW1TY2FsZSwgY2FtTGVycCk7XG4gICAgICBpZiAoTWF0aC5hYnModGhpcy5jYW1TY2FsZSAtIHRoaXMudGFyZ2V0Q2FtU2NhbGUpIDwgMC4wMDAxKSB7XG4gICAgICAgIHRoaXMuY2FtU2NhbGUgPSB0aGlzLnRhcmdldENhbVNjYWxlO1xuICAgICAgICB0aGlzLmNhbVggPSB0aGlzLnRhcmdldENhbVg7XG4gICAgICAgIHRoaXMuY2FtWSA9IHRoaXMudGFyZ2V0Q2FtWTtcbiAgICAgIH1cbiAgICAgIGFuaW1hdGluZyA9IHRydWU7XG4gICAgfVxuXG4gICAgLy8gU21vb3RoIGFscGhhIGludGVycG9sYXRpb24gZm9yIG5vZGVzL2VkZ2VzXG4gICAgY29uc3QgYWxwaGFMZXJwID0gMC4xMjtcbiAgICBmb3IgKGNvbnN0IG4gb2YgdGhpcy5zaW1Ob2Rlcykge1xuICAgICAgaWYgKE1hdGguYWJzKG4uYWxwaGEgLSBuLnRhcmdldEFscGhhKSA+IDAuMDA1KSB7XG4gICAgICAgIG4uYWxwaGEgPSBsZXJwKG4uYWxwaGEsIG4udGFyZ2V0QWxwaGEsIGFscGhhTGVycCk7XG4gICAgICAgIGFuaW1hdGluZyA9IHRydWU7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBuLmFscGhhID0gbi50YXJnZXRBbHBoYTtcbiAgICAgIH1cbiAgICB9XG4gICAgZm9yIChjb25zdCBlIG9mIHRoaXMuc2ltRWRnZXMpIHtcbiAgICAgIGlmIChNYXRoLmFicyhlLmFscGhhIC0gZS50YXJnZXRBbHBoYSkgPiAwLjAwNSkge1xuICAgICAgICBlLmFscGhhID0gbGVycChlLmFscGhhLCBlLnRhcmdldEFscGhhLCBhbHBoYUxlcnApO1xuICAgICAgICBhbmltYXRpbmcgPSB0cnVlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZS5hbHBoYSA9IGUudGFyZ2V0QWxwaGE7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3Qgc2ltQWN0aXZlID0gKHRoaXMuc2ltdWxhdGlvbj8uYWxwaGEoKSA/PyAwKSA+IDAuMDAxO1xuXG4gICAgaWYgKGFuaW1hdGluZyB8fCBzaW1BY3RpdmUgfHwgdGhpcy5uZWVkc1JlZHJhdykge1xuICAgICAgdGhpcy5uZWVkc1JlZHJhdyA9IGZhbHNlO1xuICAgICAgdGhpcy5kcmF3KCk7XG4gICAgfVxuICB9XG5cbiAgLyogXHUyNTAwXHUyNTAwIEZpbHRlcmluZyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cblxuICBwcml2YXRlIGFwcGx5RmlsdGVycyhkYXRhOiBHcmFwaERhdGEpOiBHcmFwaERhdGEge1xuICAgIGNvbnN0IGMgPSB0aGlzLmNvbmZpZztcbiAgICBsZXQgbm9kZXMgPSBbLi4uZGF0YS5ub2Rlc107XG4gICAgbGV0IGVkZ2VzID0gWy4uLmRhdGEuZWRnZXNdO1xuXG4gICAgaWYgKCFjLnNob3dGaWxlcykge1xuICAgICAgY29uc3QgaWRzID0gbmV3IFNldChub2Rlcy5maWx0ZXIoKG4pID0+IG4udHlwZSA9PT0gXCJmaWxlXCIpLm1hcCgobikgPT4gbi5pZCkpO1xuICAgICAgbm9kZXMgPSBub2Rlcy5maWx0ZXIoKG4pID0+IG4udHlwZSAhPT0gXCJmaWxlXCIpO1xuICAgICAgZWRnZXMgPSBlZGdlcy5maWx0ZXIoKGUpID0+ICFpZHMuaGFzKGUuc291cmNlKSAmJiAhaWRzLmhhcyhlLnRhcmdldCkpO1xuICAgIH1cbiAgICBpZiAoIWMuc2hvd09iamVjdHMpIHtcbiAgICAgIGNvbnN0IGlkcyA9IG5ldyBTZXQobm9kZXMuZmlsdGVyKChuKSA9PiBuLnR5cGUgPT09IFwib2JqZWN0XCIpLm1hcCgobikgPT4gbi5pZCkpO1xuICAgICAgbm9kZXMgPSBub2Rlcy5maWx0ZXIoKG4pID0+IG4udHlwZSAhPT0gXCJvYmplY3RcIik7XG4gICAgICBlZGdlcyA9IGVkZ2VzLmZpbHRlcigoZSkgPT4gIWlkcy5oYXMoZS5zb3VyY2UpICYmICFpZHMuaGFzKGUudGFyZ2V0KSk7XG4gICAgfVxuICAgIGlmICghYy5zaG93V2lraUVkZ2VzKSBlZGdlcyA9IGVkZ2VzLmZpbHRlcigoZSkgPT4gZS5lZGdlVHlwZSAhPT0gXCJ3aWtpXCIpO1xuICAgIGlmICghYy5zaG93T2JqZWN0RWRnZXMpIGVkZ2VzID0gZWRnZXMuZmlsdGVyKChlKSA9PiBlLmVkZ2VUeXBlICE9PSBcIm9iamVjdFwiKTtcbiAgICBpZiAoYy5zZWFyY2gpIHtcbiAgICAgIGNvbnN0IHEgPSBjLnNlYXJjaC50b0xvd2VyQ2FzZSgpO1xuICAgICAgY29uc3QgbWF0Y2hlZCA9IG5ldyBTZXQobm9kZXMuZmlsdGVyKChuKSA9PiBuLmxhYmVsLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMocSkpLm1hcCgobikgPT4gbi5pZCkpO1xuICAgICAgZm9yIChjb25zdCBlIG9mIGVkZ2VzKSB7XG4gICAgICAgIGlmIChtYXRjaGVkLmhhcyhlLnNvdXJjZSkpIG1hdGNoZWQuYWRkKGUudGFyZ2V0KTtcbiAgICAgICAgaWYgKG1hdGNoZWQuaGFzKGUudGFyZ2V0KSkgbWF0Y2hlZC5hZGQoZS5zb3VyY2UpO1xuICAgICAgfVxuICAgICAgbm9kZXMgPSBub2Rlcy5maWx0ZXIoKG4pID0+IG1hdGNoZWQuaGFzKG4uaWQpKTtcbiAgICAgIGNvbnN0IG5vZGVJZHMgPSBuZXcgU2V0KG5vZGVzLm1hcCgobikgPT4gbi5pZCkpO1xuICAgICAgZWRnZXMgPSBlZGdlcy5maWx0ZXIoKGUpID0+IG5vZGVJZHMuaGFzKGUuc291cmNlKSAmJiBub2RlSWRzLmhhcyhlLnRhcmdldCkpO1xuICAgIH1cbiAgICBpZiAoYy5wYXRoRmlsdGVyKSB7XG4gICAgICBjb25zdCBwZiA9IGMucGF0aEZpbHRlci50b0xvd2VyQ2FzZSgpO1xuICAgICAgY29uc3QgbWF0Y2hlZCA9IG5ldyBTZXQobm9kZXMuZmlsdGVyKChuKSA9PiBuLmZpbGVQYXRoLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMocGYpKS5tYXAoKG4pID0+IG4uaWQpKTtcbiAgICAgIGZvciAoY29uc3QgZSBvZiBlZGdlcykge1xuICAgICAgICBpZiAobWF0Y2hlZC5oYXMoZS5zb3VyY2UpKSBtYXRjaGVkLmFkZChlLnRhcmdldCk7XG4gICAgICAgIGlmIChtYXRjaGVkLmhhcyhlLnRhcmdldCkpIG1hdGNoZWQuYWRkKGUuc291cmNlKTtcbiAgICAgIH1cbiAgICAgIG5vZGVzID0gbm9kZXMuZmlsdGVyKChuKSA9PiBtYXRjaGVkLmhhcyhuLmlkKSk7XG4gICAgICBjb25zdCBub2RlSWRzID0gbmV3IFNldChub2Rlcy5tYXAoKG4pID0+IG4uaWQpKTtcbiAgICAgIGVkZ2VzID0gZWRnZXMuZmlsdGVyKChlKSA9PiBub2RlSWRzLmhhcyhlLnNvdXJjZSkgJiYgbm9kZUlkcy5oYXMoZS50YXJnZXQpKTtcbiAgICB9XG4gICAgaWYgKGMuc291cmNlRmlsdGVyKSB7XG4gICAgICBjb25zdCBzZiA9IGMuc291cmNlRmlsdGVyLnRvTG93ZXJDYXNlKCk7XG4gICAgICBjb25zdCByZW1vdmVkID0gbmV3IFNldChcbiAgICAgICAgbm9kZXMuZmlsdGVyKChuKSA9PiBuLnR5cGUgPT09IFwib2JqZWN0XCIgJiYgIW4uZmlsZUxhYmVsLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoc2YpKS5tYXAoKG4pID0+IG4uaWQpXG4gICAgICApO1xuICAgICAgbm9kZXMgPSBub2Rlcy5maWx0ZXIoKG4pID0+ICFyZW1vdmVkLmhhcyhuLmlkKSk7XG4gICAgICBlZGdlcyA9IGVkZ2VzLmZpbHRlcigoZSkgPT4gIXJlbW92ZWQuaGFzKGUuc291cmNlKSAmJiAhcmVtb3ZlZC5oYXMoZS50YXJnZXQpKTtcbiAgICB9XG4gICAgaWYgKCFjLnNob3dPcnBoYW5zKSB7XG4gICAgICBjb25zdCBjb25uZWN0ZWQgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICAgIGZvciAoY29uc3QgZSBvZiBlZGdlcykgeyBjb25uZWN0ZWQuYWRkKGUuc291cmNlKTsgY29ubmVjdGVkLmFkZChlLnRhcmdldCk7IH1cbiAgICAgIG5vZGVzID0gbm9kZXMuZmlsdGVyKChuKSA9PiBjb25uZWN0ZWQuaGFzKG4uaWQpKTtcbiAgICB9XG5cbiAgICBjb25zdCBjYyA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXI+KCk7XG4gICAgZm9yIChjb25zdCBlIG9mIGVkZ2VzKSB7XG4gICAgICBjYy5zZXQoZS5zb3VyY2UsIChjYy5nZXQoZS5zb3VyY2UpIHx8IDApICsgMSk7XG4gICAgICBjYy5zZXQoZS50YXJnZXQsIChjYy5nZXQoZS50YXJnZXQpIHx8IDApICsgMSk7XG4gICAgfVxuICAgIGZvciAoY29uc3QgbiBvZiBub2Rlcykgbi5jb25uZWN0aW9ucyA9IGNjLmdldChuLmlkKSB8fCAwO1xuXG4gICAgcmV0dXJuIHsgbm9kZXMsIGVkZ2VzIH07XG4gIH1cblxuICAvKiBcdTI1MDBcdTI1MDAgTm9kZSByYWRpdXMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwICovXG5cbiAgcHJpdmF0ZSBnZXROb2RlUmFkaXVzKG46IHsgdHlwZTogc3RyaW5nOyBjb25uZWN0aW9uczogbnVtYmVyIH0pOiBudW1iZXIge1xuICAgIGNvbnN0IG0gPSB0aGlzLmNvbmZpZy5ub2RlU2l6ZU11bHRpcGxpZXI7XG4gICAgY29uc3QgYmFzZSA9IG4udHlwZSA9PT0gXCJmaWxlXCIgPyA0LjUgOiA1LjU7XG4gICAgY29uc3QgZGVnID0gTWF0aC5tYXgoMCwgbi5jb25uZWN0aW9ucyk7XG4gICAgY29uc3QgYnVtcCA9IE1hdGgubWluKDEwLCBNYXRoLnNxcnQoZGVnKSAqIDEuNik7XG4gICAgcmV0dXJuIChiYXNlICsgYnVtcCkgKiBtO1xuICB9XG5cbiAgLyogXHUyNTAwXHUyNTAwIFRoZW1lIGNvbG9ycyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cblxuICBwcml2YXRlIHJlZnJlc2hDb2xvcnMoKTogdm9pZCB7XG4gICAgY29uc3QgZWwgPSB0aGlzLmNvbnRlbnRFbDtcbiAgICB0aGlzLmNvbG9yTm9kZU9iamVjdCA9IGdldFRoZW1lQ29sb3IoZWwsIFwiLS1pbnRlcmFjdGl2ZS1hY2NlbnRcIiwgXCIjN2Y2ZGYyXCIpO1xuICAgIHRoaXMuY29sb3JOb2RlRmlsZSA9IGdldFRoZW1lQ29sb3IoZWwsIFwiLS10ZXh0LW11dGVkXCIsIFwiIzk5OTk5OVwiKTtcbiAgICB0aGlzLmNvbG9yRWRnZVdpa2kgPSBnZXRUaGVtZUNvbG9yKGVsLCBcIi0tYmFja2dyb3VuZC1tb2RpZmllci1ib3JkZXJcIiwgXCIjNTU1NTU1XCIpO1xuICAgIHRoaXMuY29sb3JFZGdlT2JqID0gZ2V0VGhlbWVDb2xvcihlbCwgXCItLWludGVyYWN0aXZlLWFjY2VudFwiLCBcIiM3ZjZkZjJcIik7XG4gICAgdGhpcy5jb2xvckhpZ2hsaWdodCA9IGdldFRoZW1lQ29sb3IoZWwsIFwiLS1pbnRlcmFjdGl2ZS1hY2NlbnRcIiwgXCIjN2Y2ZGYyXCIpO1xuICAgIHRoaXMuY29sb3JCZyA9IGdldFRoZW1lQ29sb3IoZWwsIFwiLS1iYWNrZ3JvdW5kLXByaW1hcnlcIiwgXCIjMWUxZTFlXCIpO1xuICAgIGNvbnN0IHN0eWxlID0gZ2V0Q29tcHV0ZWRTdHlsZShlbCk7XG4gICAgdGhpcy5jb2xvclRleHQgPSBzdHlsZS5nZXRQcm9wZXJ0eVZhbHVlKFwiLS10ZXh0LW5vcm1hbFwiKS50cmltKCkgfHwgXCIjZGNkZGRlXCI7XG4gIH1cblxuICAvKiBcdTI1MDBcdTI1MDAgQ29vcmRpbmF0ZSB0cmFuc2Zvcm1zIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMCAqL1xuXG4gIHByaXZhdGUgZ2V0U2NyZWVuU2l6ZSgpOiB7IHc6IG51bWJlcjsgaDogbnVtYmVyIH0ge1xuICAgIGNvbnN0IGMgPSB0aGlzLmNhbnZhc0VsO1xuICAgIGlmICghYykgcmV0dXJuIHsgdzogMCwgaDogMCB9O1xuICAgIC8vIFVzZSBDU1MgcGl4ZWxzOyBkcmF3aW5nIGNvZGUgdXNlcyBDU1MgcHggY29vcmRpbmF0ZXMuXG4gICAgcmV0dXJuIHsgdzogYy5jbGllbnRXaWR0aCwgaDogYy5jbGllbnRIZWlnaHQgfTtcbiAgfVxuXG4gIHByaXZhdGUgd29ybGRUb1NjcmVlbih3eDogbnVtYmVyLCB3eTogbnVtYmVyKTogW251bWJlciwgbnVtYmVyXSB7XG4gICAgY29uc3QgeyB3LCBoIH0gPSB0aGlzLmdldFNjcmVlblNpemUoKTtcbiAgICByZXR1cm4gW1xuICAgICAgKHd4IC0gdGhpcy5jYW1YKSAqIHRoaXMuY2FtU2NhbGUgKyB3IC8gMixcbiAgICAgICh3eSAtIHRoaXMuY2FtWSkgKiB0aGlzLmNhbVNjYWxlICsgaCAvIDIsXG4gICAgXTtcbiAgfVxuXG4gIHByaXZhdGUgc2NyZWVuVG9Xb3JsZChzeDogbnVtYmVyLCBzeTogbnVtYmVyKTogW251bWJlciwgbnVtYmVyXSB7XG4gICAgY29uc3QgeyB3LCBoIH0gPSB0aGlzLmdldFNjcmVlblNpemUoKTtcbiAgICByZXR1cm4gW1xuICAgICAgKHN4IC0gdyAvIDIpIC8gdGhpcy5jYW1TY2FsZSArIHRoaXMuY2FtWCxcbiAgICAgIChzeSAtIGggLyAyKSAvIHRoaXMuY2FtU2NhbGUgKyB0aGlzLmNhbVksXG4gICAgXTtcbiAgfVxuXG4gIHByaXZhdGUgc2NyZWVuVG9Xb3JsZFRhcmdldChzeDogbnVtYmVyLCBzeTogbnVtYmVyKTogW251bWJlciwgbnVtYmVyXSB7XG4gICAgY29uc3QgeyB3LCBoIH0gPSB0aGlzLmdldFNjcmVlblNpemUoKTtcbiAgICByZXR1cm4gW1xuICAgICAgKHN4IC0gdyAvIDIpIC8gdGhpcy50YXJnZXRDYW1TY2FsZSArIHRoaXMudGFyZ2V0Q2FtWCxcbiAgICAgIChzeSAtIGggLyAyKSAvIHRoaXMudGFyZ2V0Q2FtU2NhbGUgKyB0aGlzLnRhcmdldENhbVksXG4gICAgXTtcbiAgfVxuXG4gIC8qIFx1MjUwMFx1MjUwMCBIaXQgdGVzdCBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cblxuICBwcml2YXRlIGhpdFRlc3ROb2RlKHN4OiBudW1iZXIsIHN5OiBudW1iZXIpOiBTaW1Ob2RlIHwgbnVsbCB7XG4gICAgY29uc3QgW3d4LCB3eV0gPSB0aGlzLnNjcmVlblRvV29ybGQoc3gsIHN5KTtcbiAgICBsZXQgYmVzdDogU2ltTm9kZSB8IG51bGwgPSBudWxsO1xuICAgIGxldCBiZXN0RGlzdCA9IEluZmluaXR5O1xuICAgIGZvciAoY29uc3QgbiBvZiB0aGlzLnNpbU5vZGVzKSB7XG4gICAgICBjb25zdCBueCA9IG4ueCA/PyAwO1xuICAgICAgY29uc3QgbnkgPSBuLnkgPz8gMDtcbiAgICAgIGNvbnN0IGR4ID0gbnggLSB3eDtcbiAgICAgIGNvbnN0IGR5ID0gbnkgLSB3eTtcbiAgICAgIGNvbnN0IGRpc3QgPSBNYXRoLnNxcnQoZHggKiBkeCArIGR5ICogZHkpO1xuICAgICAgY29uc3QgaGl0UmFkaXVzID0gTWF0aC5tYXgobi5yYWRpdXMgKyA0LCA4IC8gdGhpcy5jYW1TY2FsZSk7XG4gICAgICBpZiAoZGlzdCA8IGhpdFJhZGl1cyAmJiBkaXN0IDwgYmVzdERpc3QpIHtcbiAgICAgICAgYmVzdCA9IG47XG4gICAgICAgIGJlc3REaXN0ID0gZGlzdDtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGJlc3Q7XG4gIH1cblxuICAvKiBcdTI1MDBcdTI1MDAgVXBkYXRlIGhpZ2hsaWdodCB0YXJnZXRzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMCAqL1xuXG4gIHByaXZhdGUgdXBkYXRlSGlnaGxpZ2h0VGFyZ2V0cygpOiB2b2lkIHtcbiAgICBjb25zdCBmb2N1cyA9IHRoaXMuaG92ZXJlZE5vZGUgfHwgdGhpcy5zZWxlY3RlZE5vZGU7XG4gICAgaWYgKCFmb2N1cykge1xuICAgICAgZm9yIChjb25zdCBuIG9mIHRoaXMuc2ltTm9kZXMpIHtcbiAgICAgICAgbi50YXJnZXRBbHBoYSA9IG4udHlwZSA9PT0gXCJvYmplY3RcIiA/IDAuOSA6IDAuNTtcbiAgICAgIH1cbiAgICAgIGZvciAoY29uc3QgZSBvZiB0aGlzLnNpbUVkZ2VzKSB7XG4gICAgICAgIGUudGFyZ2V0QWxwaGEgPSBlLmVkZ2VUeXBlID09PSBcIndpa2lcIiA/IDAuMzUgOiAwLjI1O1xuICAgICAgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGNvbm5lY3RlZCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgIGNvbm5lY3RlZC5hZGQoZm9jdXMuaWQpO1xuICAgIGZvciAoY29uc3QgZSBvZiB0aGlzLnNpbUVkZ2VzKSB7XG4gICAgICBjb25zdCBzID0gKGUuc291cmNlIGFzIFNpbU5vZGUpLmlkO1xuICAgICAgY29uc3QgdCA9IChlLnRhcmdldCBhcyBTaW1Ob2RlKS5pZDtcbiAgICAgIGlmIChzID09PSBmb2N1cy5pZCkgY29ubmVjdGVkLmFkZCh0KTtcbiAgICAgIGlmICh0ID09PSBmb2N1cy5pZCkgY29ubmVjdGVkLmFkZChzKTtcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IG4gb2YgdGhpcy5zaW1Ob2Rlcykge1xuICAgICAgaWYgKG4gPT09IGZvY3VzKSB7XG4gICAgICAgIG4udGFyZ2V0QWxwaGEgPSAxLjA7XG4gICAgICB9IGVsc2UgaWYgKGNvbm5lY3RlZC5oYXMobi5pZCkpIHtcbiAgICAgICAgbi50YXJnZXRBbHBoYSA9IG4udHlwZSA9PT0gXCJvYmplY3RcIiA/IDAuOSA6IDAuNztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG4udGFyZ2V0QWxwaGEgPSAwLjA2O1xuICAgICAgfVxuICAgIH1cblxuICAgIGZvciAoY29uc3QgZSBvZiB0aGlzLnNpbUVkZ2VzKSB7XG4gICAgICBjb25zdCBzID0gKGUuc291cmNlIGFzIFNpbU5vZGUpLmlkO1xuICAgICAgY29uc3QgdCA9IChlLnRhcmdldCBhcyBTaW1Ob2RlKS5pZDtcbiAgICAgIGlmIChzID09PSBmb2N1cy5pZCB8fCB0ID09PSBmb2N1cy5pZCkge1xuICAgICAgICBlLnRhcmdldEFscGhhID0gMC44O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZS50YXJnZXRBbHBoYSA9IDAuMDM7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyogXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXG4gICAgIE1haW4gUmVuZGVyIFx1MjAxNCBjYWxsZWQgb25jZSBvbiBpbml0aWFsIGRhdGEsIGFuZCBvbiBmaWx0ZXIgY2hhbmdlc1xuICAgICBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTAgKi9cblxuICBwcml2YXRlIHJlbmRlckdyYXBoKCk6IHZvaWQge1xuICAgIGlmICghdGhpcy5ncmFwaERhdGEpIHJldHVybjtcblxuICAgIGNvbnN0IGNvbnRhaW5lciA9IHRoaXMuY29udGVudEVsO1xuICAgIGNvbnN0IGlzRmlyc3RSZW5kZXIgPSAhdGhpcy5jYW52YXNFbDtcblxuICAgIGlmIChpc0ZpcnN0UmVuZGVyKSB7XG4gICAgICBjb250YWluZXIuZW1wdHkoKTtcbiAgICAgIGNvbnRhaW5lci5hZGRDbGFzcyhcIm9sLWdyYXBoLWNvbnRhaW5lclwiKTtcblxuICAgICAgLy8gQ29uZmlnIHBhbmVsXG4gICAgICB0aGlzLmNvbmZpZ1BhbmVsID0gbmV3IENvbmZpZ1BhbmVsKGNvbnRhaW5lciwgdGhpcy5jb25maWcsIChuZXdDb25maWcpID0+IHtcbiAgICAgICAgdGhpcy5oYW5kbGVDb25maWdDaGFuZ2UobmV3Q29uZmlnKTtcbiAgICAgIH0pO1xuXG4gICAgICAvLyBDYW52YXMgd3JhcHBlclxuICAgICAgdGhpcy5jYW52YXNXcmFwcGVyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgIHRoaXMuY2FudmFzV3JhcHBlci5zdHlsZS5jc3NUZXh0ID0gXCJwb3NpdGlvbjphYnNvbHV0ZTtpbnNldDowO1wiO1xuICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKHRoaXMuY2FudmFzV3JhcHBlcik7XG5cbiAgICAgIHRoaXMucmVmcmVzaENvbG9ycygpO1xuICAgICAgdGhpcy5pbml0Q2FudmFzKCk7XG4gICAgICB0aGlzLnJlYnVpbGRTaW1EYXRhKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5yZWJ1aWxkU2ltRGF0YSgpO1xuICB9XG5cbiAgcHJpdmF0ZSBpbml0Q2FudmFzKCk6IHZvaWQge1xuICAgIGNvbnN0IHdyYXBwZXIgPSB0aGlzLmNhbnZhc1dyYXBwZXIhO1xuXG4gICAgY29uc3QgY2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImNhbnZhc1wiKTtcbiAgICBjYW52YXMuc3R5bGUuY3NzVGV4dCA9IFwicG9zaXRpb246YWJzb2x1dGU7aW5zZXQ6MDt3aWR0aDoxMDAlO2hlaWdodDoxMDAlO1wiO1xuICAgIHdyYXBwZXIuYXBwZW5kQ2hpbGQoY2FudmFzKTtcblxuICAgIGNvbnN0IGN0eCA9IGNhbnZhcy5nZXRDb250ZXh0KFwiMmRcIiwgeyBhbHBoYTogZmFsc2UgfSk7XG4gICAgaWYgKCFjdHgpIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBpbml0IDJEIGNhbnZhcyBjb250ZXh0XCIpO1xuXG4gICAgdGhpcy5jYW52YXNFbCA9IGNhbnZhcztcbiAgICB0aGlzLmN0eCA9IGN0eDtcblxuICAgIHRoaXMucmVzaXplT2JzZXJ2ZXIgPSBuZXcgUmVzaXplT2JzZXJ2ZXIoKCkgPT4ge1xuICAgICAgdGhpcy5yZXNpemVDYW52YXMoKTtcbiAgICAgIHRoaXMubmVlZHNSZWRyYXcgPSB0cnVlO1xuICAgIH0pO1xuICAgIHRoaXMucmVzaXplT2JzZXJ2ZXIub2JzZXJ2ZSh0aGlzLmNvbnRlbnRFbCk7XG5cbiAgICB0aGlzLnJlc2l6ZUNhbnZhcygpO1xuICAgIHRoaXMuc2V0dXBJbnB1dEhhbmRsZXJzKCk7XG5cbiAgICAvLyBDbGlja2luZyBvdXRzaWRlIHRoZSBpbmZvIHBhbmVsIHNob3VsZCBjbG9zZSBpdC5cbiAgICBpZiAoIXRoaXMuX29uQ29udGFpbmVyTW91c2VEb3duKSB7XG4gICAgICB0aGlzLl9vbkNvbnRhaW5lck1vdXNlRG93biA9IChlOiBNb3VzZUV2ZW50KSA9PiB7XG4gICAgICAgIGNvbnN0IHBhbmVsID0gdGhpcy5jb250ZW50RWwucXVlcnlTZWxlY3RvcihcIi5vbC1pbmZvLXBhbmVsXCIpIGFzIEhUTUxFbGVtZW50IHwgbnVsbDtcbiAgICAgICAgaWYgKCFwYW5lbCkgcmV0dXJuO1xuICAgICAgICBjb25zdCB0YXJnZXQgPSBlLnRhcmdldCBhcyBIVE1MRWxlbWVudCB8IG51bGw7XG4gICAgICAgIGlmICh0YXJnZXQgJiYgcGFuZWwuY29udGFpbnModGFyZ2V0KSkgcmV0dXJuO1xuXG4gICAgICAgIC8vIElmIHRoZSBjbGljayB3YXMgb24gdGhlIGNhbnZhcywgdGhlIGNhbnZhcyBoYW5kbGVycyB3aWxsIGRlY2lkZVxuICAgICAgICAvLyB3aGV0aGVyIHRvIGtlZXAgc2VsZWN0aW9uIChub2RlIGNsaWNrKSBvciBjbGVhciAoZW1wdHkgY2xpY2spLlxuICAgICAgICBpZiAodGFyZ2V0ID09PSB0aGlzLmNhbnZhc0VsKSByZXR1cm47XG5cbiAgICAgICAgdGhpcy5zZWxlY3RlZE5vZGUgPSBudWxsO1xuICAgICAgICB0aGlzLnVwZGF0ZUhpZ2hsaWdodFRhcmdldHMoKTtcbiAgICAgICAgdGhpcy5yZW1vdmVJbmZvUGFuZWwodGhpcy5jb250ZW50RWwpO1xuICAgICAgICB0aGlzLm5lZWRzUmVkcmF3ID0gdHJ1ZTtcbiAgICAgIH07XG4gICAgICB0aGlzLmNvbnRlbnRFbC5hZGRFdmVudExpc3RlbmVyKFwibW91c2Vkb3duXCIsIHRoaXMuX29uQ29udGFpbmVyTW91c2VEb3duLCB0cnVlKTtcbiAgICB9XG5cbiAgICB0aGlzLnN0YXJ0UmVuZGVyTG9vcCgpO1xuICB9XG5cbiAgcHJpdmF0ZSByZXNpemVDYW52YXMoKTogdm9pZCB7XG4gICAgY29uc3QgY2FudmFzID0gdGhpcy5jYW52YXNFbDtcbiAgICBjb25zdCB3cmFwcGVyID0gdGhpcy5jYW52YXNXcmFwcGVyO1xuICAgIGlmICghY2FudmFzIHx8ICF3cmFwcGVyKSByZXR1cm47XG5cbiAgICBjb25zdCB3ID0gd3JhcHBlci5jbGllbnRXaWR0aCB8fCB0aGlzLmNvbnRlbnRFbC5jbGllbnRXaWR0aCB8fCA4MDA7XG4gICAgY29uc3QgaCA9IHdyYXBwZXIuY2xpZW50SGVpZ2h0IHx8IHRoaXMuY29udGVudEVsLmNsaWVudEhlaWdodCB8fCA2MDA7XG5cbiAgICB0aGlzLmRwciA9IHdpbmRvdy5kZXZpY2VQaXhlbFJhdGlvIHx8IDE7XG4gICAgY2FudmFzLndpZHRoID0gTWF0aC5tYXgoMSwgTWF0aC5mbG9vcih3ICogdGhpcy5kcHIpKTtcbiAgICBjYW52YXMuaGVpZ2h0ID0gTWF0aC5tYXgoMSwgTWF0aC5mbG9vcihoICogdGhpcy5kcHIpKTtcblxuICAgIC8vIE1ha2UgZHJhd2luZyBjb21tYW5kcyBpbiBDU1MgcGl4ZWxzXG4gICAgY29uc3QgY3R4ID0gdGhpcy5jdHghO1xuICAgIGN0eC5zZXRUcmFuc2Zvcm0odGhpcy5kcHIsIDAsIDAsIHRoaXMuZHByLCAwLCAwKTtcbiAgfVxuXG4gIC8qKiBSZWJ1aWxkIHNpbXVsYXRpb24gbm9kZXMvZWRnZXMgZnJvbSBjdXJyZW50IGdyYXBoRGF0YSArIGZpbHRlcnMgKi9cbiAgcHJpdmF0ZSByZWJ1aWxkU2ltRGF0YSgpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMuZ3JhcGhEYXRhKSByZXR1cm47XG5cbiAgICBjb25zdCBmaWx0ZXJlZCA9IHRoaXMuYXBwbHlGaWx0ZXJzKHRoaXMuZ3JhcGhEYXRhKTtcbiAgICBjb25zdCBjb250YWluZXIgPSB0aGlzLmNvbnRlbnRFbDtcbiAgICBjb25zdCB3aWR0aCA9IGNvbnRhaW5lci5jbGllbnRXaWR0aCB8fCA4MDA7XG4gICAgY29uc3QgaGVpZ2h0ID0gY29udGFpbmVyLmNsaWVudEhlaWdodCB8fCA2MDA7XG5cbiAgICAvLyBTaG93L2hpZGUgZW1wdHkgc3RhdGVcbiAgICBjb25zdCBleGlzdGluZ0VtcHR5ID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoXCIub2wtZW1wdHktc3RhdGVcIik7XG4gICAgaWYgKGV4aXN0aW5nRW1wdHkpIGV4aXN0aW5nRW1wdHkucmVtb3ZlKCk7XG5cbiAgICBpZiAoZmlsdGVyZWQubm9kZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICBpZiAodGhpcy5jYW52YXNXcmFwcGVyKSB0aGlzLmNhbnZhc1dyYXBwZXIuc3R5bGUuZGlzcGxheSA9IFwibm9uZVwiO1xuICAgICAgY29udGFpbmVyLmNyZWF0ZUVsKFwiZGl2XCIsIHtcbiAgICAgICAgY2xzOiBcIm9sLWVtcHR5LXN0YXRlXCIsXG4gICAgICAgIHRleHQ6IFwiTm8gbm9kZXMgbWF0Y2ggdGhlIGN1cnJlbnQgZmlsdGVycy5cIixcbiAgICAgIH0pO1xuICAgICAgaWYgKHRoaXMuc2ltdWxhdGlvbikgeyB0aGlzLnNpbXVsYXRpb24uc3RvcCgpOyB0aGlzLnNpbXVsYXRpb24gPSBudWxsOyB9XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICh0aGlzLmNhbnZhc1dyYXBwZXIpIHRoaXMuY2FudmFzV3JhcHBlci5zdHlsZS5kaXNwbGF5ID0gXCJcIjtcblxuICAgIC8vIFByZXNlcnZlIGV4aXN0aW5nIG5vZGUgcG9zaXRpb25zIHdoZXJlIHBvc3NpYmxlXG4gICAgY29uc3Qgb2xkUG9zaXRpb25zID0gbmV3IE1hcDxzdHJpbmcsIHsgeDogbnVtYmVyOyB5OiBudW1iZXIgfT4oKTtcbiAgICBmb3IgKGNvbnN0IG4gb2YgdGhpcy5zaW1Ob2Rlcykge1xuICAgICAgb2xkUG9zaXRpb25zLnNldChuLmlkLCB7IHg6IG4ueCA/PyAwLCB5OiBuLnkgPz8gMCB9KTtcbiAgICB9XG5cbiAgICAvLyBPcnBoYW4gZGV0ZWN0aW9uIEJFRk9SRSBvcHRpb25hbCBmb2xkZXIgZWRnZXMuXG4gICAgY29uc3QgYmFzZU9ycGhhbnMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICBmb3IgKGNvbnN0IG4gb2YgZmlsdGVyZWQubm9kZXMpIHtcbiAgICAgIGlmICgobi5jb25uZWN0aW9ucyB8fCAwKSA9PT0gMCkgYmFzZU9ycGhhbnMuYWRkKG4uaWQpO1xuICAgIH1cblxuICAgIC8vIE9wdGlvbjogY29ubmVjdCBvcnBoYW5zIHRvIHRoZWlyIGZvbGRlciAoc28gdGhleSBjbHVzdGVyIGJ5IGxvY2F0aW9uKS5cbiAgICAvLyBJbXBsZW1lbnRlZCBoZXJlICh2aWV3LWxldmVsKSB0byBhdm9pZCBjaGFuZ2luZyB0aGUgYmFzZSBncmFwaCBtb2RlbC5cbiAgICBjb25zdCBub2Rlc1BsdXMgPSBbLi4uZmlsdGVyZWQubm9kZXNdIGFzIGFueVtdO1xuICAgIGNvbnN0IGVkZ2VzUGx1cyA9IFsuLi5maWx0ZXJlZC5lZGdlc10gYXMgYW55W107XG5cbiAgICBpZiAodGhpcy5jb25maWcuY29ubmVjdE9ycGhhbnNUb0ZvbGRlcnMpIHtcbiAgICAgIGNvbnN0IGZvbGRlck5vZGVJZCA9IChmb2xkZXI6IHN0cmluZykgPT4gYGZvbGRlcjo6JHtmb2xkZXJ9YDtcbiAgICAgIGNvbnN0IGZvbGRlckxhYmVsID0gKGZvbGRlcjogc3RyaW5nKSA9PiB7XG4gICAgICAgIGNvbnN0IGNsZWFuZWQgPSBmb2xkZXIucmVwbGFjZSgvXFwvKyQvLCBcIlwiKTtcbiAgICAgICAgaWYgKCFjbGVhbmVkIHx8IGNsZWFuZWQgPT09IFwiL1wiKSByZXR1cm4gXCIvXCI7XG4gICAgICAgIGNvbnN0IHBhcnRzID0gY2xlYW5lZC5zcGxpdChcIi9cIikuZmlsdGVyKEJvb2xlYW4pO1xuICAgICAgICByZXR1cm4gcGFydHNbcGFydHMubGVuZ3RoIC0gMV0gfHwgY2xlYW5lZDtcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gbmV3IFNldChub2Rlc1BsdXMubWFwKChuKSA9PiBuLmlkKSk7XG4gICAgICBjb25zdCBlZGdlU2V0ID0gbmV3IFNldChlZGdlc1BsdXMubWFwKChlKSA9PiBbZS5zb3VyY2UsIGUudGFyZ2V0XS5zb3J0KCkuam9pbihcIi0tXCIpKSk7XG5cbiAgICAgIGZvciAoY29uc3QgbiBvZiBmaWx0ZXJlZC5ub2Rlcykge1xuICAgICAgICBpZiAoIWJhc2VPcnBoYW5zLmhhcyhuLmlkKSkgY29udGludWU7XG5cbiAgICAgICAgY29uc3QgcGF0aCA9IG4uZmlsZVBhdGggfHwgXCJcIjtcbiAgICAgICAgY29uc3QgaWR4ID0gcGF0aC5sYXN0SW5kZXhPZihcIi9cIik7XG4gICAgICAgIGNvbnN0IGZvbGRlciA9IGlkeCA+IDAgPyBwYXRoLnNsaWNlKDAsIGlkeCkgOiBcIi9cIjtcbiAgICAgICAgY29uc3QgZmlkID0gZm9sZGVyTm9kZUlkKGZvbGRlcik7XG5cbiAgICAgICAgaWYgKCFleGlzdGluZy5oYXMoZmlkKSkge1xuICAgICAgICAgIGV4aXN0aW5nLmFkZChmaWQpO1xuICAgICAgICAgIG5vZGVzUGx1cy5wdXNoKHtcbiAgICAgICAgICAgIGlkOiBmaWQsXG4gICAgICAgICAgICBsYWJlbDogZm9sZGVyTGFiZWwoZm9sZGVyKSxcbiAgICAgICAgICAgIHR5cGU6IFwiZmlsZVwiLFxuICAgICAgICAgICAgZmlsZVBhdGg6IGZvbGRlciArIFwiL1wiLFxuICAgICAgICAgICAgZmlsZUxhYmVsOiBmb2xkZXJMYWJlbChmb2xkZXIpLFxuICAgICAgICAgICAgcHJvcGVydGllczoge30sXG4gICAgICAgICAgICBzdGFydExpbmU6IDAsXG4gICAgICAgICAgICBjb25uZWN0aW9uczogMCxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGVkZ2VJZCA9IFtuLmlkLCBmaWRdLnNvcnQoKS5qb2luKFwiLS1cIik7XG4gICAgICAgIGlmICghZWRnZVNldC5oYXMoZWRnZUlkKSkge1xuICAgICAgICAgIGVkZ2VTZXQuYWRkKGVkZ2VJZCk7XG4gICAgICAgICAgZWRnZXNQbHVzLnB1c2goeyBzb3VyY2U6IG4uaWQsIHRhcmdldDogZmlkLCBlZGdlVHlwZTogXCJ3aWtpXCIgfSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBub2RlQnlJZCA9IG5ldyBNYXA8c3RyaW5nLCBTaW1Ob2RlPigpO1xuXG4gICAgdGhpcy5zaW1Ob2RlcyA9IG5vZGVzUGx1cy5tYXAoKG4pID0+IHtcbiAgICAgIGNvbnN0IG9sZCA9IG9sZFBvc2l0aW9ucy5nZXQobi5pZCk7XG4gICAgICBjb25zdCBiYXNlQWxwaGEgPSBuLnR5cGUgPT09IFwib2JqZWN0XCIgPyAwLjkgOiAwLjU7XG4gICAgICBjb25zdCBub2RlOiBTaW1Ob2RlID0ge1xuICAgICAgICAuLi4obiBhcyBhbnkpLFxuICAgICAgICBpc09ycGhhbjogYmFzZU9ycGhhbnMuaGFzKG4uaWQpLFxuICAgICAgICB4OiBvbGQgPyBvbGQueCA6IChNYXRoLnJhbmRvbSgpIC0gMC41KSAqIHdpZHRoICogMC40LFxuICAgICAgICB5OiBvbGQgPyBvbGQueSA6IChNYXRoLnJhbmRvbSgpIC0gMC41KSAqIGhlaWdodCAqIDAuNCxcbiAgICAgICAgdng6IDAsXG4gICAgICAgIHZ5OiAwLFxuICAgICAgICBmeDogbnVsbCxcbiAgICAgICAgZnk6IG51bGwsXG4gICAgICAgIHJhZGl1czogdGhpcy5nZXROb2RlUmFkaXVzKG4pLFxuICAgICAgICBhbHBoYTogYmFzZUFscGhhLFxuICAgICAgICB0YXJnZXRBbHBoYTogYmFzZUFscGhhLFxuICAgICAgfTtcbiAgICAgIG5vZGVCeUlkLnNldChub2RlLmlkLCBub2RlKTtcbiAgICAgIHJldHVybiBub2RlO1xuICAgIH0pO1xuXG4gICAgdGhpcy5zaW1FZGdlcyA9IGVkZ2VzUGx1c1xuICAgICAgLm1hcCgoZSkgPT4ge1xuICAgICAgICBjb25zdCBzID0gbm9kZUJ5SWQuZ2V0KGUuc291cmNlKTtcbiAgICAgICAgY29uc3QgdCA9IG5vZGVCeUlkLmdldChlLnRhcmdldCk7XG4gICAgICAgIGlmICghcyB8fCAhdCkgcmV0dXJuIG51bGw7XG4gICAgICAgIGNvbnN0IGJhc2VBbHBoYSA9IGUuZWRnZVR5cGUgPT09IFwid2lraVwiID8gMC4zNSA6IDAuMjU7XG4gICAgICAgIGNvbnN0IGVkZ2U6IFNpbUVkZ2UgPSB7XG4gICAgICAgICAgc291cmNlOiBzLFxuICAgICAgICAgIHRhcmdldDogdCxcbiAgICAgICAgICBlZGdlVHlwZTogZS5lZGdlVHlwZSxcbiAgICAgICAgICBhbHBoYTogYmFzZUFscGhhLFxuICAgICAgICAgIHRhcmdldEFscGhhOiBiYXNlQWxwaGEsXG4gICAgICAgIH07XG4gICAgICAgIHJldHVybiBlZGdlO1xuICAgICAgfSlcbiAgICAgIC5maWx0ZXIoKGUpOiBlIGlzIFNpbUVkZ2UgPT4gZSAhPT0gbnVsbCk7XG5cbiAgICB0aGlzLmhvdmVyZWROb2RlID0gbnVsbDtcbiAgICB0aGlzLnNlbGVjdGVkTm9kZSA9IG51bGw7XG4gICAgdGhpcy5kcmFnTm9kZSA9IG51bGw7XG5cbiAgICB0aGlzLnN0YXJ0U2ltdWxhdGlvbigpO1xuICAgIHRoaXMudXBkYXRlSGlnaGxpZ2h0VGFyZ2V0cygpO1xuICAgIHRoaXMubmVlZHNSZWRyYXcgPSB0cnVlO1xuICB9XG5cbiAgcHJpdmF0ZSBzdGFydFNpbXVsYXRpb24oKTogdm9pZCB7XG4gICAgLy8gU3RvcCBvbGQgc2ltXG4gICAgaWYgKHRoaXMuc2ltdWxhdGlvbikge1xuICAgICAgdGhpcy5zaW11bGF0aW9uLnN0b3AoKTtcbiAgICAgIHRoaXMuc2ltdWxhdGlvbi5vbihcInRpY2tcIiwgbnVsbCk7XG4gICAgICB0aGlzLnNpbXVsYXRpb24gPSBudWxsO1xuICAgIH1cblxuICAgIGNvbnN0IHNpbSA9IGZvcmNlU2ltdWxhdGlvbjxTaW1Ob2RlLCBTaW1FZGdlPih0aGlzLnNpbU5vZGVzKVxuICAgICAgLmFscGhhKDEpXG4gICAgICAuYWxwaGFUYXJnZXQoMClcbiAgICAgIC5hbHBoYURlY2F5KDAuMDIyOClcbiAgICAgIC5hbHBoYU1pbigwLjAwMSlcbiAgICAgIC52ZWxvY2l0eURlY2F5KDAuNCk7XG5cbiAgICBjb25zdCBsaW5rRm9yY2UgPSBmb3JjZUxpbms8U2ltTm9kZSwgU2ltRWRnZT4odGhpcy5zaW1FZGdlcylcbiAgICAgIC5kaXN0YW5jZSh0aGlzLmNvbmZpZy5saW5rRGlzdGFuY2UpXG4gICAgICAuc3RyZW5ndGgoMC40KTtcblxuICAgIC8vIFJlcGVsLiBDb25maWcgaXMgcG9zaXRpdmUsIGQzIGV4cGVjdHMgbmVnYXRpdmUgZm9yIHJlcHVsc2lvbi5cbiAgICBjb25zdCBjaGFyZ2VGb3JjZSA9IGZvcmNlTWFueUJvZHk8U2ltTm9kZT4oKVxuICAgICAgLnN0cmVuZ3RoKC10aGlzLmNvbmZpZy5yZXBlbFN0cmVuZ3RoKVxuICAgICAgLmRpc3RhbmNlTWF4KE1hdGgubWF4KHRoaXMuY29uZmlnLnJlcGVsU3RyZW5ndGggKiAyLCA2MDApKTtcblxuICAgIC8vIENlbnRlcmluZzogdXNlIGZvcmNlWC9ZIHdpdGggY29uZmlndXJhYmxlIHN0cmVuZ3RoLlxuICAgIGNvbnN0IGNlbnRlclggPSBmb3JjZVg8U2ltTm9kZT4oMCkuc3RyZW5ndGgodGhpcy5jb25maWcuY2VudGVyU3RyZW5ndGgpO1xuICAgIGNvbnN0IGNlbnRlclkgPSBmb3JjZVk8U2ltTm9kZT4oMCkuc3RyZW5ndGgodGhpcy5jb25maWcuY2VudGVyU3RyZW5ndGgpO1xuXG4gICAgLy8gQ29sbGlzaW9uOiBndWFyYW50ZWUgbm9uLW92ZXJsYXAgKyBhIGxpdHRsZSBwYWRkaW5nLlxuICAgIGNvbnN0IGNvbGxpZGUgPSBmb3JjZUNvbGxpZGU8U2ltTm9kZT4oKGQpID0+IGQucmFkaXVzICsgMTQpXG4gICAgICAuc3RyZW5ndGgoMC45NSlcbiAgICAgIC5pdGVyYXRpb25zKDIpO1xuXG4gICAgc2ltXG4gICAgICAuZm9yY2UoXCJsaW5rXCIsIGxpbmtGb3JjZSlcbiAgICAgIC5mb3JjZShcImNoYXJnZVwiLCBjaGFyZ2VGb3JjZSlcbiAgICAgIC5mb3JjZShcImNlbnRlclhcIiwgY2VudGVyWClcbiAgICAgIC5mb3JjZShcImNlbnRlcllcIiwgY2VudGVyWSlcbiAgICAgIC5mb3JjZShcImNvbGxpZGVcIiwgY29sbGlkZSk7XG5cbiAgICBzaW0ub24oXCJ0aWNrXCIsICgpID0+IHtcbiAgICAgIHRoaXMubmVlZHNSZWRyYXcgPSB0cnVlO1xuICAgIH0pO1xuXG4gICAgdGhpcy5zaW11bGF0aW9uID0gc2ltO1xuICB9XG5cbiAgLyoqIEhhbmRsZSBjb25maWcgcGFuZWwgY2hhbmdlcyB3aXRob3V0IHJlYnVpbGRpbmcgdGhlIGVudGlyZSB2aWV3ICovXG4gIHByaXZhdGUgaGFuZGxlQ29uZmlnQ2hhbmdlKG5ld0NvbmZpZzogR3JhcGhDb25maWcpOiB2b2lkIHtcbiAgICBjb25zdCBvbGQgPSB0aGlzLmNvbmZpZztcbiAgICB0aGlzLmNvbmZpZyA9IG5ld0NvbmZpZztcblxuICAgIGNvbnN0IGZpbHRlckNoYW5nZWQgPVxuICAgICAgb2xkLnNob3dGaWxlcyAhPT0gbmV3Q29uZmlnLnNob3dGaWxlcyB8fFxuICAgICAgb2xkLnNob3dPYmplY3RzICE9PSBuZXdDb25maWcuc2hvd09iamVjdHMgfHxcbiAgICAgIG9sZC5zaG93V2lraUVkZ2VzICE9PSBuZXdDb25maWcuc2hvd1dpa2lFZGdlcyB8fFxuICAgICAgb2xkLnNob3dPYmplY3RFZGdlcyAhPT0gbmV3Q29uZmlnLnNob3dPYmplY3RFZGdlcyB8fFxuICAgICAgb2xkLnNob3dPcnBoYW5zICE9PSBuZXdDb25maWcuc2hvd09ycGhhbnMgfHxcbiAgICAgIG9sZC5jb25uZWN0T3JwaGFuc1RvRm9sZGVycyAhPT0gbmV3Q29uZmlnLmNvbm5lY3RPcnBoYW5zVG9Gb2xkZXJzIHx8XG4gICAgICBvbGQuc2VhcmNoICE9PSBuZXdDb25maWcuc2VhcmNoIHx8XG4gICAgICBvbGQucGF0aEZpbHRlciAhPT0gbmV3Q29uZmlnLnBhdGhGaWx0ZXIgfHxcbiAgICAgIG9sZC5zb3VyY2VGaWx0ZXIgIT09IG5ld0NvbmZpZy5zb3VyY2VGaWx0ZXI7XG5cbiAgICBpZiAoZmlsdGVyQ2hhbmdlZCkge1xuICAgICAgdGhpcy5yZWJ1aWxkU2ltRGF0YSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIFVwZGF0ZSByYWRpaVxuICAgIGZvciAoY29uc3QgbiBvZiB0aGlzLnNpbU5vZGVzKSB7XG4gICAgICBuLnJhZGl1cyA9IHRoaXMuZ2V0Tm9kZVJhZGl1cyhuKTtcbiAgICB9XG5cbiAgICAvLyBVcGRhdGUgZm9yY2VzXG4gICAgaWYgKHRoaXMuc2ltdWxhdGlvbikge1xuICAgICAgY29uc3QgbGluayA9IHRoaXMuc2ltdWxhdGlvbi5mb3JjZShcImxpbmtcIikgYXMgYW55O1xuICAgICAgbGluaz8uZGlzdGFuY2U/LihuZXdDb25maWcubGlua0Rpc3RhbmNlKTtcblxuICAgICAgY29uc3QgY2hhcmdlID0gdGhpcy5zaW11bGF0aW9uLmZvcmNlKFwiY2hhcmdlXCIpIGFzIGFueTtcbiAgICAgIGNoYXJnZT8uc3RyZW5ndGg/LigtbmV3Q29uZmlnLnJlcGVsU3RyZW5ndGgpO1xuICAgICAgY2hhcmdlPy5kaXN0YW5jZU1heD8uKE1hdGgubWF4KG5ld0NvbmZpZy5yZXBlbFN0cmVuZ3RoICogMiwgNjAwKSk7XG5cbiAgICAgIGNvbnN0IGN4ID0gdGhpcy5zaW11bGF0aW9uLmZvcmNlKFwiY2VudGVyWFwiKSBhcyBhbnk7XG4gICAgICBjeD8uc3RyZW5ndGg/LihuZXdDb25maWcuY2VudGVyU3RyZW5ndGgpO1xuICAgICAgY29uc3QgY3kgPSB0aGlzLnNpbXVsYXRpb24uZm9yY2UoXCJjZW50ZXJZXCIpIGFzIGFueTtcbiAgICAgIGN5Py5zdHJlbmd0aD8uKG5ld0NvbmZpZy5jZW50ZXJTdHJlbmd0aCk7XG5cbiAgICAgIGNvbnN0IGNvbGxpZGUgPSB0aGlzLnNpbXVsYXRpb24uZm9yY2UoXCJjb2xsaWRlXCIpIGFzIGFueTtcbiAgICAgIGNvbGxpZGU/LnJhZGl1cz8uKChkOiBTaW1Ob2RlKSA9PiBkLnJhZGl1cyArIDE0KTtcblxuICAgICAgdGhpcy5zaW11bGF0aW9uLmFscGhhKE1hdGgubWF4KHRoaXMuc2ltdWxhdGlvbi5hbHBoYSgpLCAwLjMpKS5yZXN0YXJ0KCk7XG4gICAgfVxuXG4gICAgdGhpcy51cGRhdGVIaWdobGlnaHRUYXJnZXRzKCk7XG4gICAgdGhpcy5uZWVkc1JlZHJhdyA9IHRydWU7XG4gIH1cblxuICAvKiBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcbiAgICAgQ2FudmFzIERyYXdcbiAgICAgXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwICovXG5cbiAgcHJpdmF0ZSBjbGVhcigpOiB2b2lkIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eDtcbiAgICBjb25zdCBjYW52YXMgPSB0aGlzLmNhbnZhc0VsO1xuICAgIGlmICghY3R4IHx8ICFjYW52YXMpIHJldHVybjtcbiAgICBjb25zdCB3ID0gY2FudmFzLmNsaWVudFdpZHRoO1xuICAgIGNvbnN0IGggPSBjYW52YXMuY2xpZW50SGVpZ2h0O1xuICAgIGN0eC5zYXZlKCk7XG4gICAgY3R4LnNldFRyYW5zZm9ybSh0aGlzLmRwciwgMCwgMCwgdGhpcy5kcHIsIDAsIDApO1xuICAgIGN0eC5maWxsU3R5bGUgPSBjb2xvclRvQ1NTKHRoaXMuY29sb3JCZyk7XG4gICAgY3R4Lmdsb2JhbEFscGhhID0gMTtcbiAgICBjdHguZmlsbFJlY3QoMCwgMCwgdywgaCk7XG4gICAgY3R4LnJlc3RvcmUoKTtcbiAgfVxuXG4gIHByaXZhdGUgZHJhdygpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMuY3R4IHx8ICF0aGlzLmNhbnZhc0VsKSByZXR1cm47XG5cbiAgICAvLyBUaGVtZSBtaWdodCBjaGFuZ2UgZHVyaW5nIHJ1bnRpbWVcbiAgICB0aGlzLnJlZnJlc2hDb2xvcnMoKTtcblxuICAgIHRoaXMuY2xlYXIoKTtcblxuICAgIGlmICh0aGlzLnNpbU5vZGVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gICAgdGhpcy5kcmF3RWRnZXMoKTtcbiAgICB0aGlzLmRyYXdOb2RlcygpO1xuICAgIHRoaXMuZHJhd0xhYmVscygpO1xuICB9XG5cbiAgcHJpdmF0ZSBkcmF3RWRnZXMoKTogdm9pZCB7XG4gICAgY29uc3QgY3R4ID0gdGhpcy5jdHghO1xuICAgIGNvbnN0IGNhbnZhcyA9IHRoaXMuY2FudmFzRWwhO1xuICAgIGNvbnN0IHcgPSBjYW52YXMuY2xpZW50V2lkdGg7XG4gICAgY29uc3QgaCA9IGNhbnZhcy5jbGllbnRIZWlnaHQ7XG4gICAgY29uc3QgaGFsZlcgPSB3IC8gMjtcbiAgICBjb25zdCBoYWxmSCA9IGggLyAyO1xuXG4gICAgaWYgKHRoaXMuc2ltRWRnZXMubGVuZ3RoID09PSAwKSByZXR1cm47XG5cbiAgICBjdHguc2F2ZSgpO1xuICAgIGN0eC5saW5lV2lkdGggPSAxO1xuICAgIGN0eC5saW5lQ2FwID0gXCJyb3VuZFwiO1xuXG4gICAgZm9yIChjb25zdCBlIG9mIHRoaXMuc2ltRWRnZXMpIHtcbiAgICAgIGNvbnN0IHMgPSBlLnNvdXJjZSBhcyBTaW1Ob2RlO1xuICAgICAgY29uc3QgdCA9IGUudGFyZ2V0IGFzIFNpbU5vZGU7XG5cbiAgICAgIGNvbnN0IHN4dyA9IHMueCA/PyAwO1xuICAgICAgY29uc3Qgc3l3ID0gcy55ID8/IDA7XG4gICAgICBjb25zdCB0eHcgPSB0LnggPz8gMDtcbiAgICAgIGNvbnN0IHR5dyA9IHQueSA/PyAwO1xuXG4gICAgICBjb25zdCBzeCA9IChzeHcgLSB0aGlzLmNhbVgpICogdGhpcy5jYW1TY2FsZSArIGhhbGZXO1xuICAgICAgY29uc3Qgc3kgPSAoc3l3IC0gdGhpcy5jYW1ZKSAqIHRoaXMuY2FtU2NhbGUgKyBoYWxmSDtcbiAgICAgIGNvbnN0IHR4ID0gKHR4dyAtIHRoaXMuY2FtWCkgKiB0aGlzLmNhbVNjYWxlICsgaGFsZlc7XG4gICAgICBjb25zdCB0eSA9ICh0eXcgLSB0aGlzLmNhbVkpICogdGhpcy5jYW1TY2FsZSArIGhhbGZIO1xuXG4gICAgICBjb25zdCBpc1dpa2kgPSBlLmVkZ2VUeXBlID09PSBcIndpa2lcIjtcbiAgICAgIGNvbnN0IGNvbCA9IGlzV2lraSA/IHRoaXMuY29sb3JFZGdlV2lraSA6IHRoaXMuY29sb3JFZGdlT2JqO1xuXG4gICAgICBjdHguc3Ryb2tlU3R5bGUgPSBjb2xvclRvQ1NTKGNvbCk7XG4gICAgICBjdHguZ2xvYmFsQWxwaGEgPSBlLmFscGhhO1xuICAgICAgY3R4LmJlZ2luUGF0aCgpO1xuICAgICAgY3R4Lm1vdmVUbyhzeCwgc3kpO1xuICAgICAgY3R4LmxpbmVUbyh0eCwgdHkpO1xuICAgICAgY3R4LnN0cm9rZSgpO1xuICAgIH1cblxuICAgIGN0eC5yZXN0b3JlKCk7XG4gIH1cblxuICBwcml2YXRlIGRyYXdOb2RlcygpOiB2b2lkIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCE7XG4gICAgY29uc3QgY2FudmFzID0gdGhpcy5jYW52YXNFbCE7XG4gICAgY29uc3QgdyA9IGNhbnZhcy5jbGllbnRXaWR0aDtcbiAgICBjb25zdCBoID0gY2FudmFzLmNsaWVudEhlaWdodDtcbiAgICBjb25zdCBoYWxmVyA9IHcgLyAyO1xuICAgIGNvbnN0IGhhbGZIID0gaCAvIDI7XG4gICAgY29uc3QgZm9jdXMgPSB0aGlzLmhvdmVyZWROb2RlIHx8IHRoaXMuc2VsZWN0ZWROb2RlO1xuXG4gICAgY3R4LnNhdmUoKTtcblxuICAgIGZvciAoY29uc3QgbiBvZiB0aGlzLnNpbU5vZGVzKSB7XG4gICAgICBjb25zdCBueHcgPSBuLnggPz8gMDtcbiAgICAgIGNvbnN0IG55dyA9IG4ueSA/PyAwO1xuXG4gICAgICAvLyBBbGwgbm9kZXMgdXNlIHRoZSB0aGVtZSBhY2NlbnQgY29sb3IsIGV4Y2VwdCAqYmFzZSBncmFwaCogb3JwaGFucyB3aGljaCBhcmUgZ3JleS5cbiAgICAgIGNvbnN0IGlzT3JwaGFuID0gISFuLmlzT3JwaGFuO1xuXG4gICAgICBsZXQgY29sOiBbbnVtYmVyLCBudW1iZXIsIG51bWJlcl07XG4gICAgICBpZiAoZm9jdXMgJiYgbiA9PT0gZm9jdXMpIHtcbiAgICAgICAgY29sID0gaXNPcnBoYW4gPyB0aGlzLmNvbG9yTm9kZUZpbGUgOiB0aGlzLmNvbG9ySGlnaGxpZ2h0O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29sID0gaXNPcnBoYW4gPyB0aGlzLmNvbG9yTm9kZUZpbGUgOiB0aGlzLmNvbG9yTm9kZU9iamVjdDtcbiAgICAgIH1cblxuICAgICAgY29uc3QgY3ggPSAobnh3IC0gdGhpcy5jYW1YKSAqIHRoaXMuY2FtU2NhbGUgKyBoYWxmVztcbiAgICAgIGNvbnN0IGN5ID0gKG55dyAtIHRoaXMuY2FtWSkgKiB0aGlzLmNhbVNjYWxlICsgaGFsZkg7XG5cbiAgICAgIC8vIENsYW1wIG5vZGUgc2l6ZSBvbiBzY3JlZW4gc28gem9vbWluZyBpbiBkb2Vzbid0IGNyZWF0ZSBnaWFudCBiYWxscy5cbiAgICAgIGNvbnN0IG1heFIgPSBNYXRoLm1heCgyLCB0aGlzLmNvbmZpZy5ub2RlTWF4U2NyZWVuUmFkaXVzKTtcbiAgICAgIGNvbnN0IHIgPSBNYXRoLm1pbihtYXhSLCBuLnJhZGl1cyAqIHRoaXMuY2FtU2NhbGUpO1xuXG4gICAgICBjdHguZmlsbFN0eWxlID0gY29sb3JUb0NTUyhjb2wpO1xuICAgICAgY3R4Lmdsb2JhbEFscGhhID0gbi5hbHBoYTtcbiAgICAgIGN0eC5iZWdpblBhdGgoKTtcbiAgICAgIGN0eC5hcmMoY3gsIGN5LCByLCAwLCBNYXRoLlBJICogMik7XG4gICAgICBjdHguZmlsbCgpO1xuICAgIH1cblxuICAgIGN0eC5yZXN0b3JlKCk7XG4gIH1cblxuICBwcml2YXRlIGRyYXdMYWJlbHMoKTogdm9pZCB7XG4gICAgY29uc3QgY3R4ID0gdGhpcy5jdHghO1xuICAgIGNvbnN0IGNhbnZhcyA9IHRoaXMuY2FudmFzRWwhO1xuICAgIGNvbnN0IHcgPSBjYW52YXMuY2xpZW50V2lkdGg7XG4gICAgY29uc3QgaCA9IGNhbnZhcy5jbGllbnRIZWlnaHQ7XG4gICAgY29uc3QgaGFsZlcgPSB3IC8gMjtcbiAgICBjb25zdCBoYWxmSCA9IGggLyAyO1xuXG4gICAgY29uc3QgbGFiZWxPcGFjaXR5ID0gdGhpcy5jb25maWcubGFiZWxPcGFjaXR5O1xuICAgIGNvbnN0IHpvb21GYWN0b3IgPSB0aGlzLmNhbVNjYWxlO1xuXG4gICAgLy8gT25seSBzaG93IGxhYmVscyBhZnRlciBhIHpvb20gdGhyZXNob2xkIChjb25maWd1cmFibGUpLCBhbmQgc2NhbGUgZm9udCBzbW9vdGhseS5cbiAgICBjb25zdCBiYXNlRm9udFNpemUgPSAxMTtcbiAgICBjb25zdCBmb250U2l6ZSA9IE1hdGgubWF4KDgsIE1hdGgubWluKDE2LCBiYXNlRm9udFNpemUgKiBNYXRoLnNxcnQoem9vbUZhY3RvcikpKTtcbiAgICBjb25zdCBtaW5ab29tID0gTWF0aC5tYXgoMCwgdGhpcy5jb25maWcubGFiZWxNaW5ab29tKTtcbiAgICBjb25zdCB6b29tR2F0ZSA9IHpvb21GYWN0b3IgPj0gbWluWm9vbTtcblxuICAgIGlmICghem9vbUdhdGUpIHJldHVybjtcblxuICAgIGN0eC5zYXZlKCk7XG4gICAgY3R4LmZvbnQgPSBgJHtmb250U2l6ZX1weCAtYXBwbGUtc3lzdGVtLCBCbGlua01hY1N5c3RlbUZvbnQsIFwiU2Vnb2UgVUlcIiwgUm9ib3RvLCBzYW5zLXNlcmlmYDtcbiAgICBjdHgudGV4dEFsaWduID0gXCJjZW50ZXJcIjtcbiAgICBjdHgudGV4dEJhc2VsaW5lID0gXCJ0b3BcIjtcbiAgICBjdHguZmlsbFN0eWxlID0gdGhpcy5jb2xvclRleHQ7XG5cbiAgICBjb25zdCBwbGFjZWRSZWN0czogQXJyYXk8eyB4OiBudW1iZXI7IHk6IG51bWJlcjsgdzogbnVtYmVyOyBoOiBudW1iZXIgfT4gPSBbXTtcbiAgICBjb25zdCBpbnRlcnNlY3RzID0gKHIxOiBhbnksIHIyOiBhbnkpID0+XG4gICAgICByMS54IDwgcjIueCArIHIyLncgJiYgcjEueCArIHIxLncgPiByMi54ICYmIHIxLnkgPCByMi55ICsgcjIuaCAmJiByMS55ICsgcjEuaCA+IHIyLnk7XG5cbiAgICAvLyBHcmVlZHkgbGFiZWwgcGxhY2VtZW50IHRvIHJlZHVjZSBvdmVybGFwcGluZyBsYWJlbHMuXG4gICAgY29uc3Qgb3JkZXJlZE5vZGVzID0gWy4uLnRoaXMuc2ltTm9kZXNdLnNvcnQoKGEsIGIpID0+IHtcbiAgICAgIGlmIChiLmFscGhhICE9PSBhLmFscGhhKSByZXR1cm4gYi5hbHBoYSAtIGEuYWxwaGE7XG4gICAgICByZXR1cm4gKGIuY29ubmVjdGlvbnMgfHwgMCkgLSAoYS5jb25uZWN0aW9ucyB8fCAwKTtcbiAgICB9KTtcblxuICAgIGNvbnN0IG1heFcgPSBNYXRoLm1heCg0MCwgdGhpcy5jb25maWcubGFiZWxNYXhXaWR0aCB8fCAxNjApO1xuICAgIGNvbnN0IGVsbGlwc2lzID0gXCJcdTIwMjZcIjtcblxuICAgIGZvciAoY29uc3QgbiBvZiBvcmRlcmVkTm9kZXMpIHtcbiAgICAgIGNvbnN0IG54dyA9IG4ueCA/PyAwO1xuICAgICAgY29uc3Qgbnl3ID0gbi55ID8/IDA7XG4gICAgICBjb25zdCBzeCA9IChueHcgLSB0aGlzLmNhbVgpICogdGhpcy5jYW1TY2FsZSArIGhhbGZXO1xuICAgICAgY29uc3Qgc3kgPSAobnl3IC0gdGhpcy5jYW1ZKSAqIHRoaXMuY2FtU2NhbGUgKyBoYWxmSDtcbiAgICAgIGNvbnN0IHNjcmVlblkgPSBzeSArIG4ucmFkaXVzICogdGhpcy5jYW1TY2FsZSArIDY7XG5cbiAgICAgIC8vIEN1bGwgb2ZmLXNjcmVlbiBsYWJlbHNcbiAgICAgIGlmIChzeCA8IC0xMDAgfHwgc3ggPiB3ICsgMTAwIHx8IHN5IDwgLTEwMCB8fCBzeSA+IGggKyAxMDApIGNvbnRpbnVlO1xuXG4gICAgICBsZXQgYWxwaGE6IG51bWJlcjtcbiAgICAgIGlmIChuLnRhcmdldEFscGhhIDwgMC4xKSB7XG4gICAgICAgIGFscGhhID0gTWF0aC5taW4obGFiZWxPcGFjaXR5LCBuLmFscGhhKSAqIDAuMztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGFscGhhID0gbGFiZWxPcGFjaXR5ICogKG4uYWxwaGEgLyBNYXRoLm1heCgwLjAwMDEsIG4udGFyZ2V0QWxwaGEpKTtcbiAgICAgICAgaWYgKG4gPT09ICh0aGlzLmhvdmVyZWROb2RlIHx8IHRoaXMuc2VsZWN0ZWROb2RlKSkgYWxwaGEgPSAxLjA7XG4gICAgICB9XG5cbiAgICAgIGlmIChhbHBoYSA8IDAuMDEpIGNvbnRpbnVlO1xuXG4gICAgICAvLyBUcnVuY2F0ZSBsYWJlbCB0byBhIG1heCBwaXhlbCB3aWR0aC5cbiAgICAgIGNvbnN0IGZ1bGwgPSBuLmxhYmVsO1xuICAgICAgbGV0IHNob3duID0gZnVsbDtcbiAgICAgIGlmIChjdHgubWVhc3VyZVRleHQoZnVsbCkud2lkdGggPiBtYXhXKSB7XG4gICAgICAgIGxldCBsbyA9IDAsIGhpID0gZnVsbC5sZW5ndGg7XG4gICAgICAgIHdoaWxlIChsbyA8IGhpKSB7XG4gICAgICAgICAgY29uc3QgbWlkID0gTWF0aC5jZWlsKChsbyArIGhpKSAvIDIpO1xuICAgICAgICAgIGNvbnN0IGNhbmRpZGF0ZSA9IGZ1bGwuc2xpY2UoMCwgbWlkKSArIGVsbGlwc2lzO1xuICAgICAgICAgIGlmIChjdHgubWVhc3VyZVRleHQoY2FuZGlkYXRlKS53aWR0aCA8PSBtYXhXKSBsbyA9IG1pZDtcbiAgICAgICAgICBlbHNlIGhpID0gbWlkIC0gMTtcbiAgICAgICAgfVxuICAgICAgICBzaG93biA9IGZ1bGwuc2xpY2UoMCwgTWF0aC5tYXgoMCwgbG8pKSArIGVsbGlwc2lzO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBtZXRyaWNzID0gY3R4Lm1lYXN1cmVUZXh0KHNob3duKTtcbiAgICAgIGNvbnN0IHRleHRXID0gbWV0cmljcy53aWR0aDtcbiAgICAgIGNvbnN0IHRleHRIID0gZm9udFNpemU7IC8vIGdvb2QgZW5vdWdoIGZvciBvdmVybGFwIGN1bGxpbmdcblxuICAgICAgY29uc3QgcGFkID0gMztcbiAgICAgIGNvbnN0IHJlY3QgPSB7XG4gICAgICAgIHg6IHN4IC0gdGV4dFcgLyAyIC0gcGFkLFxuICAgICAgICB5OiBzY3JlZW5ZIC0gcGFkLFxuICAgICAgICB3OiB0ZXh0VyArIHBhZCAqIDIsXG4gICAgICAgIGg6IHRleHRIICsgcGFkICogMixcbiAgICAgIH07XG5cbiAgICAgIGxldCBjb2xsaWRlcyA9IGZhbHNlO1xuICAgICAgZm9yIChjb25zdCByIG9mIHBsYWNlZFJlY3RzKSB7XG4gICAgICAgIGlmIChpbnRlcnNlY3RzKHJlY3QsIHIpKSB7IGNvbGxpZGVzID0gdHJ1ZTsgYnJlYWs7IH1cbiAgICAgIH1cblxuICAgICAgY29uc3QgaXNGb2N1cyA9IG4gPT09ICh0aGlzLmhvdmVyZWROb2RlIHx8IHRoaXMuc2VsZWN0ZWROb2RlKTtcbiAgICAgIGlmICghaXNGb2N1cyAmJiBjb2xsaWRlcykgY29udGludWU7XG5cbiAgICAgIGN0eC5nbG9iYWxBbHBoYSA9IGFscGhhO1xuICAgICAgY3R4LmZpbGxUZXh0KHNob3duLCBzeCwgc2NyZWVuWSk7XG4gICAgICBwbGFjZWRSZWN0cy5wdXNoKHJlY3QpO1xuICAgIH1cblxuICAgIGN0eC5yZXN0b3JlKCk7XG4gIH1cblxuICAvKiBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcbiAgICAgSW5wdXQgSGFuZGxlcnNcbiAgICAgXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwICovXG5cbiAgcHJpdmF0ZSBzZXR1cElucHV0SGFuZGxlcnMoKTogdm9pZCB7XG4gICAgY29uc3QgY2FudmFzID0gdGhpcy5jYW52YXNFbCE7XG4gICAgY29uc3QgY29udGFpbmVyID0gdGhpcy5jb250ZW50RWw7XG5cbiAgICAvLyBkMy16b29tIChwYW4gKyB3aGVlbCB6b29tKSBvbiBjYW52YXMuXG4gICAgLy8gV2Uga2VlcCBvdXIgb3duIChjYW1YL2NhbVkvY2FtU2NhbGUpIGNhbWVyYSwgYnV0IGRyaXZlIHRhcmdldENhbSogZnJvbSB6b29tIHRyYW5zZm9ybS5cbiAgICBjb25zdCB1cGRhdGVUYXJnZXRGcm9tWm9vbSA9ICh0OiBhbnksIHNvdXJjZUV2ZW50PzogRXZlbnQgfCBudWxsKSA9PiB7XG4gICAgICBjb25zdCB3ID0gY2FudmFzLmNsaWVudFdpZHRoO1xuICAgICAgY29uc3QgaCA9IGNhbnZhcy5jbGllbnRIZWlnaHQ7XG4gICAgICBjb25zdCBrID0gTWF0aC5tYXgoMC4wMywgTWF0aC5taW4oMTIsIHQuaykpO1xuICAgICAgY29uc3QgeCA9IHQueDtcbiAgICAgIGNvbnN0IHkgPSB0Lnk7XG5cbiAgICAgIC8vIHNjcmVlbiA9IHdvcmxkICogayArICh4LCB5KVxuICAgICAgLy8gb3VyIGNhbWVyYTogc2NyZWVuID0gKHdvcmxkIC0gY2FtKSAqIGsgKyAody8yLGgvMilcbiAgICAgIC8vID0+IHggPSAtY2FtWCprICsgdy8yICA9PiBjYW1YID0gKHcvMiAtIHgpL2tcbiAgICAgIGNvbnN0IGNhbVggPSAodyAvIDIgLSB4KSAvIGs7XG4gICAgICBjb25zdCBjYW1ZID0gKGggLyAyIC0geSkgLyBrO1xuXG4gICAgICB0aGlzLnpvb21UcmFuc2Zvcm0gPSB0O1xuICAgICAgdGhpcy50YXJnZXRDYW1TY2FsZSA9IGs7XG4gICAgICB0aGlzLnRhcmdldENhbVggPSBjYW1YO1xuICAgICAgdGhpcy50YXJnZXRDYW1ZID0gY2FtWTtcblxuICAgICAgLy8gRm9yIGRyYWctcGFubmluZywgYXZvaWQgY2FtZXJhIGxhZyAoa2VlcCBpdCAxOjEpLlxuICAgICAgY29uc3Qgc2U6IGFueSA9IHNvdXJjZUV2ZW50IGFzIGFueTtcbiAgICAgIGNvbnN0IGlzV2hlZWwgPSBzZT8udHlwZSA9PT0gXCJ3aGVlbFwiO1xuICAgICAgaWYgKCFpc1doZWVsKSB7XG4gICAgICAgIHRoaXMuY2FtU2NhbGUgPSB0aGlzLnRhcmdldENhbVNjYWxlO1xuICAgICAgICB0aGlzLmNhbVggPSB0aGlzLnRhcmdldENhbVg7XG4gICAgICAgIHRoaXMuY2FtWSA9IHRoaXMudGFyZ2V0Q2FtWTtcbiAgICAgIH1cblxuICAgICAgdGhpcy5uZWVkc1JlZHJhdyA9IHRydWU7XG4gICAgfTtcblxuICAgIC8vIEF0dGFjaCB6b29tIGJlaGF2aW9yIG9uY2UuXG4gICAgaWYgKCF0aGlzLnpvb21CZWhhdmlvcikge1xuICAgICAgdGhpcy56b29tQmVoYXZpb3IgPSB6b29tPEhUTUxDYW52YXNFbGVtZW50LCB1bmtub3duPigpXG4gICAgICAgIC5zY2FsZUV4dGVudChbMC4wMywgMTJdKVxuICAgICAgICAuZmlsdGVyKChldmVudDogYW55KSA9PiB7XG4gICAgICAgICAgLy8gRGlzYWJsZSBwYW4vem9vbSB3aGlsZSBkcmFnZ2luZyBhIG5vZGUuXG4gICAgICAgICAgaWYgKHRoaXMuZHJhZ05vZGUpIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAvLyBPbmx5IGxlZnQgbW91c2UgZm9yIGRyYWctcGFuLlxuICAgICAgICAgIGlmIChldmVudD8udHlwZT8uc3RhcnRzV2l0aChcIm1vdXNlXCIpICYmIGV2ZW50LmJ1dHRvbiAhPT0gMCkgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9KVxuICAgICAgICAub24oXCJ6b29tXCIsIChldmVudDogYW55KSA9PiB7XG4gICAgICAgICAgaWYgKHRoaXMuaXNTeW5jaW5nWm9vbSkgcmV0dXJuO1xuICAgICAgICAgIHVwZGF0ZVRhcmdldEZyb21ab29tKGV2ZW50LnRyYW5zZm9ybSwgZXZlbnQuc291cmNlRXZlbnQpO1xuICAgICAgICB9KTtcblxuICAgICAgY29uc3Qgc2VsID0gc2VsZWN0KGNhbnZhcyk7XG4gICAgICBzZWwuY2FsbCh0aGlzLnpvb21CZWhhdmlvciBhcyBhbnkpO1xuICAgICAgLy8gV2UgaGFuZGxlIGRvdWJsZSBjbGljayBvdXJzZWx2ZXMgKG9wZW4gbm9kZSksIHNvIGRpc2FibGUgZDMncyBkZWZhdWx0IHpvb20tb24tZGJsY2xpY2suXG4gICAgICBzZWwub24oXCJkYmxjbGljay56b29tXCIsIG51bGwpO1xuXG4gICAgICAvLyBJbml0aWFsaXplIHRyYW5zZm9ybSB0byBtYXRjaCBvdXIgc3RhcnRpbmcgY2FtZXJhLlxuICAgICAgY29uc3QgdyA9IGNhbnZhcy5jbGllbnRXaWR0aDtcbiAgICAgIGNvbnN0IGggPSBjYW52YXMuY2xpZW50SGVpZ2h0O1xuICAgICAgY29uc3QgayA9IHRoaXMudGFyZ2V0Q2FtU2NhbGU7XG4gICAgICBjb25zdCB4ID0gLXRoaXMudGFyZ2V0Q2FtWCAqIGsgKyB3IC8gMjtcbiAgICAgIGNvbnN0IHkgPSAtdGhpcy50YXJnZXRDYW1ZICogayArIGggLyAyO1xuICAgICAgdGhpcy5pc1N5bmNpbmdab29tID0gdHJ1ZTtcbiAgICAgIHRyeSB7XG4gICAgICAgIHNlbC5jYWxsKCh0aGlzLnpvb21CZWhhdmlvciBhcyBhbnkpLnRyYW5zZm9ybSwgem9vbUlkZW50aXR5LnRyYW5zbGF0ZSh4LCB5KS5zY2FsZShrKSk7XG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICB0aGlzLmlzU3luY2luZ1pvb20gPSBmYWxzZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBNb3VzZSBkb3duOiBvbmx5IHVzZWQgZm9yIG5vZGUgZHJhZyArIGNsaWNrIHNlbGVjdGlvbiB0cmFja2luZy5cbiAgICBsZXQgZG93blggPSAwO1xuICAgIGxldCBkb3duWSA9IDA7XG4gICAgbGV0IGRvd25Ob2RlOiBTaW1Ob2RlIHwgbnVsbCA9IG51bGw7XG5cbiAgICB0aGlzLl9vbk1vdXNlRG93biA9IChlOiBNb3VzZUV2ZW50KSA9PiB7XG4gICAgICBpZiAoZS5idXR0b24gIT09IDApIHJldHVybjtcbiAgICAgIGNvbnN0IHJlY3QgPSBjYW52YXMuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICBjb25zdCBteCA9IGUuY2xpZW50WCAtIHJlY3QubGVmdDtcbiAgICAgIGNvbnN0IG15ID0gZS5jbGllbnRZIC0gcmVjdC50b3A7XG4gICAgICBkb3duWCA9IGUuY2xpZW50WDtcbiAgICAgIGRvd25ZID0gZS5jbGllbnRZO1xuICAgICAgZG93bk5vZGUgPSB0aGlzLmhpdFRlc3ROb2RlKG14LCBteSk7XG5cbiAgICAgIGlmIChkb3duTm9kZSkge1xuICAgICAgICAvLyBQcmV2ZW50IGQzLXpvb20gZnJvbSBzdGFydGluZyBhIHBhbiB3aGVuIHdlIGludGVuZCB0byBkcmFnIGEgbm9kZS5cbiAgICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcblxuICAgICAgICB0aGlzLmRyYWdOb2RlID0gZG93bk5vZGU7XG4gICAgICAgIHRoaXMuaXNEcmFnZ2luZyA9IGZhbHNlO1xuICAgICAgICBkb3duTm9kZS5meCA9IGRvd25Ob2RlLnggPz8gMDtcbiAgICAgICAgZG93bk5vZGUuZnkgPSBkb3duTm9kZS55ID8/IDA7XG4gICAgICAgIC8vIEtlZXAgZHJhZyBzbW9vdGggKGxlc3MgYWdncmVzc2l2ZSByZWhlYXRpbmcpXG4gICAgICAgIHRoaXMuc2ltdWxhdGlvbj8uYWxwaGFUYXJnZXQoMC4xNSkucmVzdGFydCgpO1xuICAgICAgfVxuICAgIH07XG4gICAgY2FudmFzLmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZWRvd25cIiwgdGhpcy5fb25Nb3VzZURvd24sIHsgY2FwdHVyZTogdHJ1ZSB9KTtcblxuICAgIC8vIE1vdXNlIG1vdmU6IHVwZGF0ZSBub2RlIGRyYWcgT1IgaG92ZXIvdG9vbHRpcC5cbiAgICB0aGlzLl9vbk1vdXNlTW92ZSA9IChlOiBNb3VzZUV2ZW50KSA9PiB7XG4gICAgICBjb25zdCByZWN0ID0gY2FudmFzLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgY29uc3QgbXggPSBlLmNsaWVudFggLSByZWN0LmxlZnQ7XG4gICAgICBjb25zdCBteSA9IGUuY2xpZW50WSAtIHJlY3QudG9wO1xuXG4gICAgICBpZiAodGhpcy5kcmFnTm9kZSkge1xuICAgICAgICB0aGlzLmlzRHJhZ2dpbmcgPSB0cnVlO1xuICAgICAgICBjb25zdCBbd3gsIHd5XSA9IHRoaXMuc2NyZWVuVG9Xb3JsZChteCwgbXkpO1xuICAgICAgICAvLyBTbW9vdGggZHJhZzogbGVycCB0b3dhcmRzIHRoZSBjdXJzb3IgaW5zdGVhZCBvZiBzbmFwcGluZy5cbiAgICAgICAgY29uc3QgdCA9IDAuMzU7XG4gICAgICAgIHRoaXMuZHJhZ05vZGUuZnggPSBsZXJwKHRoaXMuZHJhZ05vZGUuZnggPz8gd3gsIHd4LCB0KTtcbiAgICAgICAgdGhpcy5kcmFnTm9kZS5meSA9IGxlcnAodGhpcy5kcmFnTm9kZS5meSA/PyB3eSwgd3ksIHQpO1xuICAgICAgICB0aGlzLm5lZWRzUmVkcmF3ID0gdHJ1ZTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICAvLyBIb3ZlciBkZXRlY3Rpb25cbiAgICAgIGNvbnN0IG5vZGUgPSB0aGlzLmhpdFRlc3ROb2RlKG14LCBteSk7XG4gICAgICBpZiAobm9kZSAhPT0gdGhpcy5ob3ZlcmVkTm9kZSkge1xuICAgICAgICB0aGlzLmhvdmVyZWROb2RlID0gbm9kZTtcbiAgICAgICAgY2FudmFzLnN0eWxlLmN1cnNvciA9IG5vZGUgPyBcInBvaW50ZXJcIiA6IFwiZGVmYXVsdFwiO1xuICAgICAgICB0aGlzLnVwZGF0ZUhpZ2hsaWdodFRhcmdldHMoKTtcblxuICAgICAgICBpZiAobm9kZSkge1xuICAgICAgICAgIHRoaXMuc2hvd1Rvb2x0aXAobm9kZSwgY29udGFpbmVyKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLmhpZGVUb29sdGlwKGNvbnRhaW5lcik7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAobm9kZSkge1xuICAgICAgICB0aGlzLm1vdmVUb29sdGlwKGUsIGNvbnRhaW5lcik7XG4gICAgICB9XG4gICAgfTtcbiAgICBjYW52YXMuYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlbW92ZVwiLCB0aGlzLl9vbk1vdXNlTW92ZSk7XG5cbiAgICAvLyBNb3VzZSB1cDogZHJvcCBkcmFnIG5vZGUsIGhhbmRsZSBjbGljay9zZWxlY3QvZGJsY2xpY2sgbG9naWMuXG4gICAgdGhpcy5fb25Nb3VzZVVwID0gKGU6IE1vdXNlRXZlbnQpID0+IHtcbiAgICAgIGNvbnN0IHVwRHggPSBNYXRoLmFicyhlLmNsaWVudFggLSBkb3duWCk7XG4gICAgICBjb25zdCB1cER5ID0gTWF0aC5hYnMoZS5jbGllbnRZIC0gZG93blkpO1xuICAgICAgY29uc3QgaXNDbGljayA9IHVwRHggPCAzICYmIHVwRHkgPCAzO1xuXG4gICAgICBpZiAodGhpcy5kcmFnTm9kZSkge1xuICAgICAgICBjb25zdCB3YXNEcmFnZ2luZyA9IHRoaXMuaXNEcmFnZ2luZztcbiAgICAgICAgdGhpcy5kcmFnTm9kZS5meCA9IG51bGw7XG4gICAgICAgIHRoaXMuZHJhZ05vZGUuZnkgPSBudWxsO1xuXG4gICAgICAgIGlmICghd2FzRHJhZ2dpbmcpIHtcbiAgICAgICAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpO1xuICAgICAgICAgIGNvbnN0IG5vZGUgPSB0aGlzLmRyYWdOb2RlO1xuXG4gICAgICAgICAgaWYgKHRoaXMubGFzdENsaWNrSWQgPT09IG5vZGUuaWQgJiYgbm93IC0gdGhpcy5sYXN0Q2xpY2tUaW1lIDwgMzAwKSB7XG4gICAgICAgICAgICBpZiAobm9kZS50eXBlID09PSBcIm9iamVjdFwiICYmIHRoaXMubmF2aWdhdGVUb09iamVjdCkge1xuICAgICAgICAgICAgICB0aGlzLm5hdmlnYXRlVG9PYmplY3Qobm9kZS5maWxlUGF0aCwgbm9kZS5zdGFydExpbmUpO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChub2RlLnR5cGUgPT09IFwiZmlsZVwiICYmIHRoaXMubmF2aWdhdGVUb0ZpbGUpIHtcbiAgICAgICAgICAgICAgdGhpcy5uYXZpZ2F0ZVRvRmlsZShub2RlLmZpbGVQYXRoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMubGFzdENsaWNrVGltZSA9IDA7XG4gICAgICAgICAgICB0aGlzLmxhc3RDbGlja0lkID0gXCJcIjtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5sYXN0Q2xpY2tUaW1lID0gbm93O1xuICAgICAgICAgICAgdGhpcy5sYXN0Q2xpY2tJZCA9IG5vZGUuaWQ7XG4gICAgICAgICAgICB0aGlzLnNlbGVjdGVkTm9kZSA9IG5vZGU7XG4gICAgICAgICAgICB0aGlzLnVwZGF0ZUhpZ2hsaWdodFRhcmdldHMoKTtcbiAgICAgICAgICAgIHRoaXMuc2hvd0luZm9QYW5lbChub2RlLCBjb250YWluZXIpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuZHJhZ05vZGUgPSBudWxsO1xuICAgICAgICB0aGlzLmlzRHJhZ2dpbmcgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5zaW11bGF0aW9uPy5hbHBoYVRhcmdldCgwKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICAvLyBDbGljayBvbiBlbXB0eSBzcGFjZSBjbGVhcnMgc2VsZWN0aW9uLlxuICAgICAgaWYgKGlzQ2xpY2sgJiYgIWRvd25Ob2RlKSB7XG4gICAgICAgIHRoaXMuc2VsZWN0ZWROb2RlID0gbnVsbDtcbiAgICAgICAgdGhpcy51cGRhdGVIaWdobGlnaHRUYXJnZXRzKCk7XG4gICAgICAgIHRoaXMucmVtb3ZlSW5mb1BhbmVsKGNvbnRhaW5lcik7XG4gICAgICB9XG4gICAgfTtcbiAgICBjYW52YXMuYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNldXBcIiwgdGhpcy5fb25Nb3VzZVVwKTtcblxuICAgIC8vIFByZXZlbnQgYnJvd3NlciBkZWZhdWx0c1xuICAgIHRoaXMuX29uRGJsQ2xpY2sgPSAoZTogTW91c2VFdmVudCkgPT4geyBlLnByZXZlbnREZWZhdWx0KCk7IH07XG4gICAgY2FudmFzLmFkZEV2ZW50TGlzdGVuZXIoXCJkYmxjbGlja1wiLCB0aGlzLl9vbkRibENsaWNrKTtcbiAgfVxuXG4gIC8qIFx1MjUwMFx1MjUwMCBUb29sdGlwIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMCAqL1xuXG4gIHByaXZhdGUgc2hvd1Rvb2x0aXAobm9kZTogU2ltTm9kZSwgY29udGFpbmVyOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIGxldCB0b29sdGlwID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoXCIub2wtdG9vbHRpcFwiKSBhcyBIVE1MRWxlbWVudDtcbiAgICBpZiAoIXRvb2x0aXApIHtcbiAgICAgIHRvb2x0aXAgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgdG9vbHRpcC5jbGFzc05hbWUgPSBcIm9sLXRvb2x0aXBcIjtcbiAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZCh0b29sdGlwKTtcbiAgICB9XG4gICAgdG9vbHRpcC50ZXh0Q29udGVudCA9IG5vZGUubGFiZWw7XG4gICAgdG9vbHRpcC5zdHlsZS5kaXNwbGF5ID0gXCJibG9ja1wiO1xuICB9XG5cbiAgcHJpdmF0ZSBtb3ZlVG9vbHRpcChlOiBNb3VzZUV2ZW50LCBjb250YWluZXI6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgY29uc3QgdG9vbHRpcCA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKFwiLm9sLXRvb2x0aXBcIikgYXMgSFRNTEVsZW1lbnQ7XG4gICAgaWYgKCF0b29sdGlwKSByZXR1cm47XG4gICAgY29uc3QgcmVjdCA9IGNvbnRhaW5lci5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICB0b29sdGlwLnN0eWxlLmxlZnQgPSBlLmNsaWVudFggLSByZWN0LmxlZnQgKyAxNCArIFwicHhcIjtcbiAgICB0b29sdGlwLnN0eWxlLnRvcCA9IGUuY2xpZW50WSAtIHJlY3QudG9wIC0gMTAgKyBcInB4XCI7XG4gIH1cblxuICBwcml2YXRlIGhpZGVUb29sdGlwKGNvbnRhaW5lcjogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICBjb25zdCB0b29sdGlwID0gY29udGFpbmVyLnF1ZXJ5U2VsZWN0b3IoXCIub2wtdG9vbHRpcFwiKSBhcyBIVE1MRWxlbWVudDtcbiAgICBpZiAodG9vbHRpcCkgdG9vbHRpcC5zdHlsZS5kaXNwbGF5ID0gXCJub25lXCI7XG4gIH1cblxuICAvKiBcdTI1MDBcdTI1MDAgSW5mbyBQYW5lbCBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cblxuICBwcml2YXRlIHJlbW92ZUluZm9QYW5lbChjb250YWluZXI6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgY29uc3QgcGFuZWwgPSBjb250YWluZXIucXVlcnlTZWxlY3RvcihcIi5vbC1pbmZvLXBhbmVsXCIpO1xuICAgIGlmIChwYW5lbCkgcGFuZWwucmVtb3ZlKCk7XG4gIH1cblxuICBwcml2YXRlIHNob3dJbmZvUGFuZWwoZDogU2ltTm9kZSwgY29udGFpbmVyOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIHRoaXMucmVtb3ZlSW5mb1BhbmVsKGNvbnRhaW5lcik7XG5cbiAgICBjb25zdCBwYW5lbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgcGFuZWwuY2xhc3NOYW1lID0gXCJvbC1pbmZvLXBhbmVsXCI7XG5cbiAgICBjb25zdCB0aXRsZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgdGl0bGUuY2xhc3NOYW1lID0gXCJvbC1pbmZvLXRpdGxlXCI7XG4gICAgdGl0bGUudGV4dENvbnRlbnQgPSBkLmxhYmVsO1xuICAgIHBhbmVsLmFwcGVuZENoaWxkKHRpdGxlKTtcblxuICAgIGNvbnN0IGJhZGdlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICBiYWRnZS5jbGFzc05hbWUgPSBgb2wtaW5mby10eXBlIG9sLWluZm8tdHlwZS0ke2QudHlwZX1gO1xuICAgIGJhZGdlLnRleHRDb250ZW50ID0gZC50eXBlID09PSBcIm9iamVjdFwiID8gXCJPYmplY3RcIiA6IFwiRmlsZVwiO1xuICAgIHBhbmVsLmFwcGVuZENoaWxkKGJhZGdlKTtcblxuICAgIGNvbnN0IGZpbGVQYXRoID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICBmaWxlUGF0aC5jbGFzc05hbWUgPSBcIm9sLWluZm8tZmlsZVwiO1xuICAgIGZpbGVQYXRoLnRleHRDb250ZW50ID0gZC5maWxlUGF0aDtcbiAgICBwYW5lbC5hcHBlbmRDaGlsZChmaWxlUGF0aCk7XG5cbiAgICBpZiAoZC50eXBlID09PSBcIm9iamVjdFwiICYmIE9iamVjdC5rZXlzKGQucHJvcGVydGllcykubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgcHJvcHMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgcHJvcHMuY2xhc3NOYW1lID0gXCJvbC1pbmZvLXByb3BzXCI7XG4gICAgICBmb3IgKGNvbnN0IFtrLCB2XSBvZiBPYmplY3QuZW50cmllcyhkLnByb3BlcnRpZXMpKSB7XG4gICAgICAgIGNvbnN0IHJvdyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICAgIHJvdy5jbGFzc05hbWUgPSBcIm9sLWluZm8tcHJvcC1yb3dcIjtcbiAgICAgICAgY29uc3Qga2V5RWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcbiAgICAgICAga2V5RWwuY2xhc3NOYW1lID0gXCJvbC1pbmZvLXByb3Ata2V5XCI7XG4gICAgICAgIGtleUVsLnRleHRDb250ZW50ID0gaztcbiAgICAgICAgY29uc3QgdmFsRWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcbiAgICAgICAgdmFsRWwuY2xhc3NOYW1lID0gXCJvbC1pbmZvLXByb3AtdmFsXCI7XG4gICAgICAgIHZhbEVsLnRleHRDb250ZW50ID0gdjtcbiAgICAgICAgcm93LmFwcGVuZENoaWxkKGtleUVsKTtcbiAgICAgICAgcm93LmFwcGVuZENoaWxkKHZhbEVsKTtcbiAgICAgICAgcHJvcHMuYXBwZW5kQ2hpbGQocm93KTtcbiAgICAgIH1cbiAgICAgIHBhbmVsLmFwcGVuZENoaWxkKHByb3BzKTtcbiAgICB9XG5cbiAgICBjb25zdCBjb25uID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICBjb25uLmNsYXNzTmFtZSA9IFwib2wtaW5mby1jb25uZWN0aW9uc1wiO1xuICAgIGNvbm4udGV4dENvbnRlbnQgPSBgJHtkLmNvbm5lY3Rpb25zfSBjb25uZWN0aW9uJHtkLmNvbm5lY3Rpb25zICE9PSAxID8gXCJzXCIgOiBcIlwifWA7XG4gICAgcGFuZWwuYXBwZW5kQ2hpbGQoY29ubik7XG5cbiAgICBjb25zdCBnb0J0biA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJidXR0b25cIik7XG4gICAgZ29CdG4uY2xhc3NOYW1lID0gXCJvbC1pbmZvLWdvLWJ0blwiO1xuICAgIGdvQnRuLnRleHRDb250ZW50ID0gZC50eXBlID09PSBcIm9iamVjdFwiID8gXCJHbyB0byBvYmplY3RcIiA6IFwiT3BlbiBmaWxlXCI7XG4gICAgZ29CdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgIGlmIChkLnR5cGUgPT09IFwib2JqZWN0XCIgJiYgdGhpcy5uYXZpZ2F0ZVRvT2JqZWN0KSB7XG4gICAgICAgIHRoaXMubmF2aWdhdGVUb09iamVjdChkLmZpbGVQYXRoLCBkLnN0YXJ0TGluZSk7XG4gICAgICB9IGVsc2UgaWYgKHRoaXMubmF2aWdhdGVUb0ZpbGUpIHtcbiAgICAgICAgdGhpcy5uYXZpZ2F0ZVRvRmlsZShkLmZpbGVQYXRoKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBwYW5lbC5hcHBlbmRDaGlsZChnb0J0bik7XG5cbiAgICBjb250YWluZXIuYXBwZW5kQ2hpbGQocGFuZWwpO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgQXBwLCBQbHVnaW5TZXR0aW5nVGFiLCBTZXR0aW5nIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgdHlwZSBPYmplY3RMaW5rc1BsdWdpbiBmcm9tIFwiLi9tYWluXCI7XG5cbi8qKlxuICogUGVyc2lzdGVudCBwbHVnaW4gc2V0dGluZ3MgKHNhdmVkIHRvIGRhdGEuanNvbikuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgT2JqZWN0TGlua3NTZXR0aW5ncyB7XG4gIG9iamVjdEZpbGVUYWc6IHN0cmluZztcbn1cblxuZXhwb3J0IGNvbnN0IERFRkFVTFRfU0VUVElOR1M6IE9iamVjdExpbmtzU2V0dGluZ3MgPSB7XG4gIG9iamVjdEZpbGVUYWc6IFwib2JqZWN0LWxpbmtzXCIsXG59O1xuXG4vKipcbiAqIFBsdWdpbiBzZXR0aW5ncyB0YWIgc2hvd24gaW4gT2JzaWRpYW4ncyBzZXR0aW5ncyBwYW5lbC5cbiAqL1xuZXhwb3J0IGNsYXNzIE9iamVjdExpbmtzU2V0dGluZ1RhYiBleHRlbmRzIFBsdWdpblNldHRpbmdUYWIge1xuICBwbHVnaW46IE9iamVjdExpbmtzUGx1Z2luO1xuXG4gIGNvbnN0cnVjdG9yKGFwcDogQXBwLCBwbHVnaW46IE9iamVjdExpbmtzUGx1Z2luKSB7XG4gICAgc3VwZXIoYXBwLCBwbHVnaW4pO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICB9XG5cbiAgZGlzcGxheSgpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XG5cbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogXCJPYmplY3QgTGlua3NcIiB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJPYmplY3QgZmlsZSB0YWdcIilcbiAgICAgIC5zZXREZXNjKFxuICAgICAgICBcIlRhZyB1c2VkIHRvIGlkZW50aWZ5IG9iamVjdCBmaWxlcy4gXCIgK1xuICAgICAgICBcIk9ubHkgbWFya2Rvd24gZmlsZXMgdGhhdCBpbmNsdWRlIHRoaXMgdGFnIHdpbGwgYmUgcGFyc2VkLiBcIiArXG4gICAgICAgIFwiU3VwcG9ydHMgYmFyZSAjdGFncyAoZS5nLiAjb2JqZWN0LWxpbmtzIG9uIGFueSBsaW5lKSBcIiArXG4gICAgICAgIFwiYW5kIFlBTUwgZnJvbnRtYXR0ZXIgdGFncyAoZS5nLiB0YWdzOiBbb2JqZWN0LWxpbmtzXSkuXCJcbiAgICAgIClcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0XG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKFwib2JqZWN0LWxpbmtzXCIpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLm9iamVjdEZpbGVUYWcpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Mub2JqZWN0RmlsZVRhZyA9IHZhbHVlLnRyaW0oKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pXG4gICAgICApO1xuICB9XG59XG5cbi8qKlxuICogR3JhcGggY29uZmlndXJhdGlvbiBwYW5lbCAtLSByZW5kZXJlZCBpbnNpZGUgdGhlIGdyYXBoIHZpZXcuXG4gKi9cblxuZXhwb3J0IGludGVyZmFjZSBHcmFwaENvbmZpZyB7XG4gIHNlYXJjaDogc3RyaW5nO1xuICBzaG93T3JwaGFuczogYm9vbGVhbjtcbiAgc2hvd0ZpbGVzOiBib29sZWFuO1xuICBzaG93T2JqZWN0czogYm9vbGVhbjtcbiAgc2hvd1dpa2lFZGdlczogYm9vbGVhbjtcbiAgc2hvd09iamVjdEVkZ2VzOiBib29sZWFuO1xuICBwYXRoRmlsdGVyOiBzdHJpbmc7XG4gIHNvdXJjZUZpbHRlcjogc3RyaW5nO1xuICBjb25uZWN0T3JwaGFuc1RvRm9sZGVyczogYm9vbGVhbjtcbiAgLy8gRGlzcGxheVxuICBub2RlU2l6ZU11bHRpcGxpZXI6IG51bWJlcjtcbiAgbm9kZU1heFNjcmVlblJhZGl1czogbnVtYmVyO1xuICBsYWJlbE9wYWNpdHk6IG51bWJlcjtcbiAgbGFiZWxNaW5ab29tOiBudW1iZXI7XG4gIGxhYmVsTWF4V2lkdGg6IG51bWJlcjtcbiAgLy8gRm9yY2VzXG4gIGxpbmtEaXN0YW5jZTogbnVtYmVyO1xuICBjZW50ZXJTdHJlbmd0aDogbnVtYmVyO1xuICByZXBlbFN0cmVuZ3RoOiBudW1iZXI7XG59XG5cbmV4cG9ydCBjb25zdCBERUZBVUxUX0NPTkZJRzogR3JhcGhDb25maWcgPSB7XG4gIHNlYXJjaDogXCJcIixcbiAgc2hvd09ycGhhbnM6IGZhbHNlLFxuICBzaG93RmlsZXM6IHRydWUsXG4gIHNob3dPYmplY3RzOiB0cnVlLFxuICBzaG93V2lraUVkZ2VzOiB0cnVlLFxuICBzaG93T2JqZWN0RWRnZXM6IHRydWUsXG4gIHBhdGhGaWx0ZXI6IFwiXCIsXG4gIHNvdXJjZUZpbHRlcjogXCJcIixcbiAgY29ubmVjdE9ycGhhbnNUb0ZvbGRlcnM6IGZhbHNlLFxuICAvLyBEaXNwbGF5XG4gIG5vZGVTaXplTXVsdGlwbGllcjogMSxcbiAgbm9kZU1heFNjcmVlblJhZGl1czogMTYsXG4gIGxhYmVsT3BhY2l0eTogMC42NSxcbiAgbGFiZWxNaW5ab29tOiAxLjA1LFxuICBsYWJlbE1heFdpZHRoOiAxNjAsXG4gIC8vIEZvcmNlc1xuICBsaW5rRGlzdGFuY2U6IDEwMCxcbiAgY2VudGVyU3RyZW5ndGg6IDAuMDMsXG4gIHJlcGVsU3RyZW5ndGg6IDMwMCxcbn07XG5cbmV4cG9ydCB0eXBlIENvbmZpZ0NoYW5nZUNhbGxiYWNrID0gKGNvbmZpZzogR3JhcGhDb25maWcpID0+IHZvaWQ7XG5cbmV4cG9ydCBjbGFzcyBDb25maWdQYW5lbCB7XG4gIHByaXZhdGUgcGFuZWxFbDogSFRNTEVsZW1lbnQ7XG4gIHByaXZhdGUgY29uZmlnOiBHcmFwaENvbmZpZztcbiAgcHJpdmF0ZSBvbkNoYW5nZTogQ29uZmlnQ2hhbmdlQ2FsbGJhY2s7XG4gIHByaXZhdGUgY29sbGFwc2VkOiBSZWNvcmQ8c3RyaW5nLCBib29sZWFuPiA9IHtcbiAgICBmaWx0ZXI6IGZhbHNlLFxuICAgIGRpc3BsYXk6IHRydWUsXG4gIH07XG4gIHByaXZhdGUgZGVib3VuY2VUaW1lcnM6IE1hcDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+PiA9IG5ldyBNYXAoKTtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBwYXJlbnQ6IEhUTUxFbGVtZW50LFxuICAgIGNvbmZpZzogR3JhcGhDb25maWcsXG4gICAgb25DaGFuZ2U6IENvbmZpZ0NoYW5nZUNhbGxiYWNrXG4gICkge1xuICAgIHRoaXMuY29uZmlnID0geyAuLi5jb25maWcgfTtcbiAgICB0aGlzLm9uQ2hhbmdlID0gb25DaGFuZ2U7XG5cbiAgICB0aGlzLnBhbmVsRWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHRoaXMucGFuZWxFbC5jbGFzc05hbWUgPSBcIm9sLWNvbmZpZy1wYW5lbFwiO1xuICAgIHBhcmVudC5hcHBlbmRDaGlsZCh0aGlzLnBhbmVsRWwpO1xuXG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgfVxuXG4gIGdldENvbmZpZygpOiBHcmFwaENvbmZpZyB7XG4gICAgcmV0dXJuIHsgLi4udGhpcy5jb25maWcgfTtcbiAgfVxuXG4gIGRlc3Ryb3koKTogdm9pZCB7XG4gICAgZm9yIChjb25zdCB0IG9mIHRoaXMuZGVib3VuY2VUaW1lcnMudmFsdWVzKCkpIGNsZWFyVGltZW91dCh0KTtcbiAgICB0aGlzLmRlYm91bmNlVGltZXJzLmNsZWFyKCk7XG4gICAgdGhpcy5wYW5lbEVsLnJlbW92ZSgpO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXIoKTogdm9pZCB7XG4gICAgdGhpcy5wYW5lbEVsLmVtcHR5KCk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgRmlsdGVyIHNlY3Rpb24gXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG4gICAgdGhpcy5yZW5kZXJTZWN0aW9uKFwiZmlsdGVyXCIsIFwiRmlsdGVyc1wiLCAoY29udGVudEVsKSA9PiB7XG4gICAgICAvLyBTZWFyY2hcbiAgICAgIHRoaXMucmVuZGVyVGV4dElucHV0KGNvbnRlbnRFbCwgXCJTZWFyY2hcIiwgdGhpcy5jb25maWcuc2VhcmNoLCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5zZWFyY2ggPSB2O1xuICAgICAgICB0aGlzLmVtaXREZWJvdW5jZWQoXCJzZWFyY2hcIiwgMjUwKTtcbiAgICAgIH0pO1xuXG4gICAgICAvLyBQYXRoIGZpbHRlclxuICAgICAgdGhpcy5yZW5kZXJUZXh0SW5wdXQoY29udGVudEVsLCBcIlBhdGggZmlsdGVyXCIsIHRoaXMuY29uZmlnLnBhdGhGaWx0ZXIsICh2KSA9PiB7XG4gICAgICAgIHRoaXMuY29uZmlnLnBhdGhGaWx0ZXIgPSB2O1xuICAgICAgICB0aGlzLmVtaXREZWJvdW5jZWQoXCJwYXRoRmlsdGVyXCIsIDI1MCk7XG4gICAgICB9LCBcImUuZy4gMDAgRGFpbHlcIik7XG5cbiAgICAgIC8vIFNvdXJjZSBmaWx0ZXJcbiAgICAgIHRoaXMucmVuZGVyVGV4dElucHV0KGNvbnRlbnRFbCwgXCJTb3VyY2UgZmlsdGVyXCIsIHRoaXMuY29uZmlnLnNvdXJjZUZpbHRlciwgKHYpID0+IHtcbiAgICAgICAgdGhpcy5jb25maWcuc291cmNlRmlsdGVyID0gdjtcbiAgICAgICAgdGhpcy5lbWl0RGVib3VuY2VkKFwic291cmNlRmlsdGVyXCIsIDI1MCk7XG4gICAgICB9LCBcImUuZy4gRmlsbXNcIik7XG5cbiAgICAgIC8vIFRvZ2dsZXNcbiAgICAgIHRoaXMucmVuZGVyVG9nZ2xlKGNvbnRlbnRFbCwgXCJTaG93IGZpbGVzXCIsIHRoaXMuY29uZmlnLnNob3dGaWxlcywgKHYpID0+IHtcbiAgICAgICAgdGhpcy5jb25maWcuc2hvd0ZpbGVzID0gdjtcbiAgICAgICAgdGhpcy5lbWl0KCk7XG4gICAgICB9KTtcblxuICAgICAgdGhpcy5yZW5kZXJUb2dnbGUoY29udGVudEVsLCBcIlNob3cgb2JqZWN0c1wiLCB0aGlzLmNvbmZpZy5zaG93T2JqZWN0cywgKHYpID0+IHtcbiAgICAgICAgdGhpcy5jb25maWcuc2hvd09iamVjdHMgPSB2O1xuICAgICAgICB0aGlzLmVtaXQoKTtcbiAgICAgIH0pO1xuXG4gICAgICB0aGlzLnJlbmRlclRvZ2dsZShjb250ZW50RWwsIFwiU2hvdyBvcnBoYW5zXCIsIHRoaXMuY29uZmlnLnNob3dPcnBoYW5zLCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5zaG93T3JwaGFucyA9IHY7XG4gICAgICAgIHRoaXMuZW1pdCgpO1xuICAgICAgfSk7XG5cbiAgICAgIHRoaXMucmVuZGVyVG9nZ2xlKGNvbnRlbnRFbCwgXCJDb25uZWN0IG9ycGhhbnMgdG8gZm9sZGVyc1wiLCB0aGlzLmNvbmZpZy5jb25uZWN0T3JwaGFuc1RvRm9sZGVycywgKHYpID0+IHtcbiAgICAgICAgdGhpcy5jb25maWcuY29ubmVjdE9ycGhhbnNUb0ZvbGRlcnMgPSB2O1xuICAgICAgICB0aGlzLmVtaXQoKTtcbiAgICAgIH0pO1xuXG4gICAgICB0aGlzLnJlbmRlclRvZ2dsZShjb250ZW50RWwsIFwiV2lraSBsaW5rc1wiLCB0aGlzLmNvbmZpZy5zaG93V2lraUVkZ2VzLCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5zaG93V2lraUVkZ2VzID0gdjtcbiAgICAgICAgdGhpcy5lbWl0KCk7XG4gICAgICB9KTtcblxuICAgICAgdGhpcy5yZW5kZXJUb2dnbGUoY29udGVudEVsLCBcIk9iamVjdCBsaW5rc1wiLCB0aGlzLmNvbmZpZy5zaG93T2JqZWN0RWRnZXMsICh2KSA9PiB7XG4gICAgICAgIHRoaXMuY29uZmlnLnNob3dPYmplY3RFZGdlcyA9IHY7XG4gICAgICAgIHRoaXMuZW1pdCgpO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgRGlzcGxheSBzZWN0aW9uIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuICAgIHRoaXMucmVuZGVyU2VjdGlvbihcImRpc3BsYXlcIiwgXCJEaXNwbGF5XCIsIChjb250ZW50RWwpID0+IHtcbiAgICAgIHRoaXMucmVuZGVyU2xpZGVyKGNvbnRlbnRFbCwgXCJOb2RlIHNpemVcIiwgdGhpcy5jb25maWcubm9kZVNpemVNdWx0aXBsaWVyLCAwLjIsIDMsIDAuMSwgKHYpID0+IHtcbiAgICAgICAgdGhpcy5jb25maWcubm9kZVNpemVNdWx0aXBsaWVyID0gdjtcbiAgICAgICAgdGhpcy5lbWl0KCk7XG4gICAgICB9KTtcblxuICAgICAgdGhpcy5yZW5kZXJTbGlkZXIoY29udGVudEVsLCBcIk5vZGUgbWF4IHNpemUgKG9uIHNjcmVlbilcIiwgdGhpcy5jb25maWcubm9kZU1heFNjcmVlblJhZGl1cywgNiwgNDAsIDEsICh2KSA9PiB7XG4gICAgICAgIHRoaXMuY29uZmlnLm5vZGVNYXhTY3JlZW5SYWRpdXMgPSB2O1xuICAgICAgICB0aGlzLmVtaXQoKTtcbiAgICAgIH0pO1xuXG4gICAgICB0aGlzLnJlbmRlclNsaWRlcihjb250ZW50RWwsIFwiTGFiZWxzIGFwcGVhciBhdCB6b29tXCIsIHRoaXMuY29uZmlnLmxhYmVsTWluWm9vbSwgMC4yLCAzLCAwLjA1LCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5sYWJlbE1pblpvb20gPSB2O1xuICAgICAgICB0aGlzLmVtaXQoKTtcbiAgICAgIH0pO1xuXG4gICAgICB0aGlzLnJlbmRlclNsaWRlcihjb250ZW50RWwsIFwiTGFiZWwgbWF4IHdpZHRoXCIsIHRoaXMuY29uZmlnLmxhYmVsTWF4V2lkdGgsIDYwLCAzNjAsIDEwLCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5sYWJlbE1heFdpZHRoID0gdjtcbiAgICAgICAgdGhpcy5lbWl0KCk7XG4gICAgICB9KTtcblxuICAgICAgdGhpcy5yZW5kZXJTbGlkZXIoY29udGVudEVsLCBcIkxhYmVsIG9wYWNpdHlcIiwgdGhpcy5jb25maWcubGFiZWxPcGFjaXR5LCAwLCAxLCAwLjA1LCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5sYWJlbE9wYWNpdHkgPSB2O1xuICAgICAgICB0aGlzLmVtaXQoKTtcbiAgICAgIH0pO1xuXG4gICAgICAvLyBGb3JjZXNcbiAgICAgIHRoaXMucmVuZGVyU2xpZGVyKGNvbnRlbnRFbCwgXCJMaW5rIGRpc3RhbmNlXCIsIHRoaXMuY29uZmlnLmxpbmtEaXN0YW5jZSwgMzAsIDUwMCwgMTAsICh2KSA9PiB7XG4gICAgICAgIHRoaXMuY29uZmlnLmxpbmtEaXN0YW5jZSA9IHY7XG4gICAgICAgIHRoaXMuZW1pdCgpO1xuICAgICAgfSk7XG5cbiAgICAgIHRoaXMucmVuZGVyU2xpZGVyKGNvbnRlbnRFbCwgXCJDZW50ZXIgZm9yY2VcIiwgdGhpcy5jb25maWcuY2VudGVyU3RyZW5ndGgsIDAsIDAuMiwgMC4wMDUsICh2KSA9PiB7XG4gICAgICAgIHRoaXMuY29uZmlnLmNlbnRlclN0cmVuZ3RoID0gdjtcbiAgICAgICAgdGhpcy5lbWl0KCk7XG4gICAgICB9KTtcblxuICAgICAgdGhpcy5yZW5kZXJTbGlkZXIoY29udGVudEVsLCBcIlJlcGVsIGZvcmNlXCIsIHRoaXMuY29uZmlnLnJlcGVsU3RyZW5ndGgsIDUwLCAxMDAwLCAyNSwgKHYpID0+IHtcbiAgICAgICAgdGhpcy5jb25maWcucmVwZWxTdHJlbmd0aCA9IHY7XG4gICAgICAgIHRoaXMuZW1pdCgpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlclNlY3Rpb24oXG4gICAga2V5OiBzdHJpbmcsXG4gICAgdGl0bGU6IHN0cmluZyxcbiAgICBjb250ZW50Rm46IChjb250ZW50RWw6IEhUTUxFbGVtZW50KSA9PiB2b2lkXG4gICk6IHZvaWQge1xuICAgIGNvbnN0IHNlY3Rpb24gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHNlY3Rpb24uY2xhc3NOYW1lID0gXCJvbC1jb25maWctc2VjdGlvblwiO1xuXG4gICAgY29uc3QgaGVhZGVyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICBoZWFkZXIuY2xhc3NOYW1lID0gXCJvbC1jb25maWctc2VjdGlvbi1oZWFkZXJcIjtcbiAgICBoZWFkZXIuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgIHRoaXMuY29sbGFwc2VkW2tleV0gPSAhdGhpcy5jb2xsYXBzZWRba2V5XTtcbiAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgfSk7XG5cbiAgICBjb25zdCBhcnJvdyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgIGFycm93LmNsYXNzTmFtZSA9IFwib2wtY29uZmlnLWFycm93XCI7XG4gICAgYXJyb3cudGV4dENvbnRlbnQgPSB0aGlzLmNvbGxhcHNlZFtrZXldID8gXCJcXHUyNUI2XCIgOiBcIlxcdTI1QkNcIjtcbiAgICBoZWFkZXIuYXBwZW5kQ2hpbGQoYXJyb3cpO1xuXG4gICAgY29uc3QgdGl0bGVFbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgIHRpdGxlRWwudGV4dENvbnRlbnQgPSB0aXRsZTtcbiAgICBoZWFkZXIuYXBwZW5kQ2hpbGQodGl0bGVFbCk7XG5cbiAgICBzZWN0aW9uLmFwcGVuZENoaWxkKGhlYWRlcik7XG5cbiAgICBpZiAoIXRoaXMuY29sbGFwc2VkW2tleV0pIHtcbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgY29udGVudC5jbGFzc05hbWUgPSBcIm9sLWNvbmZpZy1zZWN0aW9uLWNvbnRlbnRcIjtcbiAgICAgIHNlY3Rpb24uYXBwZW5kQ2hpbGQoY29udGVudCk7XG4gICAgICBjb250ZW50Rm4oY29udGVudCk7XG4gICAgfVxuXG4gICAgdGhpcy5wYW5lbEVsLmFwcGVuZENoaWxkKHNlY3Rpb24pO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJUZXh0SW5wdXQoXG4gICAgcGFyZW50OiBIVE1MRWxlbWVudCxcbiAgICBsYWJlbDogc3RyaW5nLFxuICAgIHZhbHVlOiBzdHJpbmcsXG4gICAgb25DaGFuZ2U6ICh2OiBzdHJpbmcpID0+IHZvaWQsXG4gICAgcGxhY2Vob2xkZXI/OiBzdHJpbmdcbiAgKTogdm9pZCB7XG4gICAgY29uc3Qgcm93ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICByb3cuY2xhc3NOYW1lID0gXCJvbC1jb25maWctcm93IG9sLWNvbmZpZy10ZXh0LXJvd1wiO1xuXG4gICAgY29uc3QgbGFiZWxFbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgIGxhYmVsRWwuY2xhc3NOYW1lID0gXCJvbC1jb25maWctbGFiZWxcIjtcbiAgICBsYWJlbEVsLnRleHRDb250ZW50ID0gbGFiZWw7XG4gICAgcm93LmFwcGVuZENoaWxkKGxhYmVsRWwpO1xuXG4gICAgY29uc3QgaW5wdXQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiaW5wdXRcIik7XG4gICAgaW5wdXQudHlwZSA9IFwidGV4dFwiO1xuICAgIGlucHV0LmNsYXNzTmFtZSA9IFwib2wtY29uZmlnLWlucHV0XCI7XG4gICAgaW5wdXQucGxhY2Vob2xkZXIgPSBwbGFjZWhvbGRlciB8fCBcIlwiO1xuICAgIGlucHV0LnZhbHVlID0gdmFsdWU7XG4gICAgaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImlucHV0XCIsICgpID0+IG9uQ2hhbmdlKGlucHV0LnZhbHVlKSk7XG5cbiAgICByb3cuYXBwZW5kQ2hpbGQoaW5wdXQpO1xuICAgIHBhcmVudC5hcHBlbmRDaGlsZChyb3cpO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJUb2dnbGUoXG4gICAgcGFyZW50OiBIVE1MRWxlbWVudCxcbiAgICBsYWJlbDogc3RyaW5nLFxuICAgIHZhbHVlOiBib29sZWFuLFxuICAgIG9uQ2hhbmdlOiAodjogYm9vbGVhbikgPT4gdm9pZFxuICApOiB2b2lkIHtcbiAgICBjb25zdCByb3cgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHJvdy5jbGFzc05hbWUgPSBcIm9sLWNvbmZpZy1yb3cgb2wtY29uZmlnLXRvZ2dsZS1yb3dcIjtcblxuICAgIGNvbnN0IGxhYmVsRWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcbiAgICBsYWJlbEVsLmNsYXNzTmFtZSA9IFwib2wtY29uZmlnLWxhYmVsXCI7XG4gICAgbGFiZWxFbC50ZXh0Q29udGVudCA9IGxhYmVsO1xuICAgIHJvdy5hcHBlbmRDaGlsZChsYWJlbEVsKTtcblxuICAgIGNvbnN0IHRvZ2dsZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgdG9nZ2xlLmNsYXNzTmFtZSA9IGBvbC1jb25maWctdG9nZ2xlICR7dmFsdWUgPyBcImlzLWVuYWJsZWRcIiA6IFwiXCJ9YDtcblxuICAgIGNvbnN0IGtub2IgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIGtub2IuY2xhc3NOYW1lID0gXCJvbC1jb25maWctdG9nZ2xlLWtub2JcIjtcbiAgICB0b2dnbGUuYXBwZW5kQ2hpbGQoa25vYik7XG5cbiAgICB0b2dnbGUuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IG5ld1ZhbCA9ICF0b2dnbGUuY2xhc3NMaXN0LmNvbnRhaW5zKFwiaXMtZW5hYmxlZFwiKTtcbiAgICAgIHRvZ2dsZS5jbGFzc0xpc3QudG9nZ2xlKFwiaXMtZW5hYmxlZFwiLCBuZXdWYWwpO1xuICAgICAgb25DaGFuZ2UobmV3VmFsKTtcbiAgICB9KTtcblxuICAgIHJvdy5hcHBlbmRDaGlsZCh0b2dnbGUpO1xuICAgIHBhcmVudC5hcHBlbmRDaGlsZChyb3cpO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJTbGlkZXIoXG4gICAgcGFyZW50OiBIVE1MRWxlbWVudCxcbiAgICBsYWJlbDogc3RyaW5nLFxuICAgIHZhbHVlOiBudW1iZXIsXG4gICAgbWluOiBudW1iZXIsXG4gICAgbWF4OiBudW1iZXIsXG4gICAgc3RlcDogbnVtYmVyLFxuICAgIG9uQ2hhbmdlOiAodjogbnVtYmVyKSA9PiB2b2lkXG4gICk6IHZvaWQge1xuICAgIGNvbnN0IHJvdyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgcm93LmNsYXNzTmFtZSA9IFwib2wtY29uZmlnLXJvdyBvbC1jb25maWctc2xpZGVyLXJvd1wiO1xuXG4gICAgY29uc3QgbGFiZWxFbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgIGxhYmVsRWwuY2xhc3NOYW1lID0gXCJvbC1jb25maWctbGFiZWxcIjtcbiAgICBsYWJlbEVsLnRleHRDb250ZW50ID0gbGFiZWw7XG4gICAgcm93LmFwcGVuZENoaWxkKGxhYmVsRWwpO1xuXG4gICAgY29uc3Qgc2xpZGVyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImlucHV0XCIpO1xuICAgIHNsaWRlci50eXBlID0gXCJyYW5nZVwiO1xuICAgIHNsaWRlci5jbGFzc05hbWUgPSBcIm9sLWNvbmZpZy1zbGlkZXJcIjtcbiAgICBzbGlkZXIubWluID0gU3RyaW5nKG1pbik7XG4gICAgc2xpZGVyLm1heCA9IFN0cmluZyhtYXgpO1xuICAgIHNsaWRlci5zdGVwID0gU3RyaW5nKHN0ZXApO1xuICAgIHNsaWRlci52YWx1ZSA9IFN0cmluZyh2YWx1ZSk7XG4gICAgc2xpZGVyLmFkZEV2ZW50TGlzdGVuZXIoXCJpbnB1dFwiLCAoKSA9PiB7XG4gICAgICBvbkNoYW5nZShwYXJzZUZsb2F0KHNsaWRlci52YWx1ZSkpO1xuICAgIH0pO1xuXG4gICAgcm93LmFwcGVuZENoaWxkKHNsaWRlcik7XG4gICAgcGFyZW50LmFwcGVuZENoaWxkKHJvdyk7XG4gIH1cblxuICBwcml2YXRlIGVtaXQoKTogdm9pZCB7XG4gICAgdGhpcy5vbkNoYW5nZSh7IC4uLnRoaXMuY29uZmlnIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBlbWl0RGVib3VuY2VkKGtleTogc3RyaW5nLCBtczogbnVtYmVyKTogdm9pZCB7XG4gICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLmRlYm91bmNlVGltZXJzLmdldChrZXkpO1xuICAgIGlmIChleGlzdGluZykgY2xlYXJUaW1lb3V0KGV4aXN0aW5nKTtcbiAgICB0aGlzLmRlYm91bmNlVGltZXJzLnNldChrZXksIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5kZWJvdW5jZVRpbWVycy5kZWxldGUoa2V5KTtcbiAgICAgIHRoaXMuZW1pdCgpO1xuICAgIH0sIG1zKSk7XG4gIH1cbn1cbiIsICJ2YXIgbm9vcCA9IHt2YWx1ZTogKCkgPT4ge319O1xuXG5mdW5jdGlvbiBkaXNwYXRjaCgpIHtcbiAgZm9yICh2YXIgaSA9IDAsIG4gPSBhcmd1bWVudHMubGVuZ3RoLCBfID0ge30sIHQ7IGkgPCBuOyArK2kpIHtcbiAgICBpZiAoISh0ID0gYXJndW1lbnRzW2ldICsgXCJcIikgfHwgKHQgaW4gXykgfHwgL1tcXHMuXS8udGVzdCh0KSkgdGhyb3cgbmV3IEVycm9yKFwiaWxsZWdhbCB0eXBlOiBcIiArIHQpO1xuICAgIF9bdF0gPSBbXTtcbiAgfVxuICByZXR1cm4gbmV3IERpc3BhdGNoKF8pO1xufVxuXG5mdW5jdGlvbiBEaXNwYXRjaChfKSB7XG4gIHRoaXMuXyA9IF87XG59XG5cbmZ1bmN0aW9uIHBhcnNlVHlwZW5hbWVzKHR5cGVuYW1lcywgdHlwZXMpIHtcbiAgcmV0dXJuIHR5cGVuYW1lcy50cmltKCkuc3BsaXQoL158XFxzKy8pLm1hcChmdW5jdGlvbih0KSB7XG4gICAgdmFyIG5hbWUgPSBcIlwiLCBpID0gdC5pbmRleE9mKFwiLlwiKTtcbiAgICBpZiAoaSA+PSAwKSBuYW1lID0gdC5zbGljZShpICsgMSksIHQgPSB0LnNsaWNlKDAsIGkpO1xuICAgIGlmICh0ICYmICF0eXBlcy5oYXNPd25Qcm9wZXJ0eSh0KSkgdGhyb3cgbmV3IEVycm9yKFwidW5rbm93biB0eXBlOiBcIiArIHQpO1xuICAgIHJldHVybiB7dHlwZTogdCwgbmFtZTogbmFtZX07XG4gIH0pO1xufVxuXG5EaXNwYXRjaC5wcm90b3R5cGUgPSBkaXNwYXRjaC5wcm90b3R5cGUgPSB7XG4gIGNvbnN0cnVjdG9yOiBEaXNwYXRjaCxcbiAgb246IGZ1bmN0aW9uKHR5cGVuYW1lLCBjYWxsYmFjaykge1xuICAgIHZhciBfID0gdGhpcy5fLFxuICAgICAgICBUID0gcGFyc2VUeXBlbmFtZXModHlwZW5hbWUgKyBcIlwiLCBfKSxcbiAgICAgICAgdCxcbiAgICAgICAgaSA9IC0xLFxuICAgICAgICBuID0gVC5sZW5ndGg7XG5cbiAgICAvLyBJZiBubyBjYWxsYmFjayB3YXMgc3BlY2lmaWVkLCByZXR1cm4gdGhlIGNhbGxiYWNrIG9mIHRoZSBnaXZlbiB0eXBlIGFuZCBuYW1lLlxuICAgIGlmIChhcmd1bWVudHMubGVuZ3RoIDwgMikge1xuICAgICAgd2hpbGUgKCsraSA8IG4pIGlmICgodCA9ICh0eXBlbmFtZSA9IFRbaV0pLnR5cGUpICYmICh0ID0gZ2V0KF9bdF0sIHR5cGVuYW1lLm5hbWUpKSkgcmV0dXJuIHQ7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gSWYgYSB0eXBlIHdhcyBzcGVjaWZpZWQsIHNldCB0aGUgY2FsbGJhY2sgZm9yIHRoZSBnaXZlbiB0eXBlIGFuZCBuYW1lLlxuICAgIC8vIE90aGVyd2lzZSwgaWYgYSBudWxsIGNhbGxiYWNrIHdhcyBzcGVjaWZpZWQsIHJlbW92ZSBjYWxsYmFja3Mgb2YgdGhlIGdpdmVuIG5hbWUuXG4gICAgaWYgKGNhbGxiYWNrICE9IG51bGwgJiYgdHlwZW9mIGNhbGxiYWNrICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcihcImludmFsaWQgY2FsbGJhY2s6IFwiICsgY2FsbGJhY2spO1xuICAgIHdoaWxlICgrK2kgPCBuKSB7XG4gICAgICBpZiAodCA9ICh0eXBlbmFtZSA9IFRbaV0pLnR5cGUpIF9bdF0gPSBzZXQoX1t0XSwgdHlwZW5hbWUubmFtZSwgY2FsbGJhY2spO1xuICAgICAgZWxzZSBpZiAoY2FsbGJhY2sgPT0gbnVsbCkgZm9yICh0IGluIF8pIF9bdF0gPSBzZXQoX1t0XSwgdHlwZW5hbWUubmFtZSwgbnVsbCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXM7XG4gIH0sXG4gIGNvcHk6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBjb3B5ID0ge30sIF8gPSB0aGlzLl87XG4gICAgZm9yICh2YXIgdCBpbiBfKSBjb3B5W3RdID0gX1t0XS5zbGljZSgpO1xuICAgIHJldHVybiBuZXcgRGlzcGF0Y2goY29weSk7XG4gIH0sXG4gIGNhbGw6IGZ1bmN0aW9uKHR5cGUsIHRoYXQpIHtcbiAgICBpZiAoKG4gPSBhcmd1bWVudHMubGVuZ3RoIC0gMikgPiAwKSBmb3IgKHZhciBhcmdzID0gbmV3IEFycmF5KG4pLCBpID0gMCwgbiwgdDsgaSA8IG47ICsraSkgYXJnc1tpXSA9IGFyZ3VtZW50c1tpICsgMl07XG4gICAgaWYgKCF0aGlzLl8uaGFzT3duUHJvcGVydHkodHlwZSkpIHRocm93IG5ldyBFcnJvcihcInVua25vd24gdHlwZTogXCIgKyB0eXBlKTtcbiAgICBmb3IgKHQgPSB0aGlzLl9bdHlwZV0sIGkgPSAwLCBuID0gdC5sZW5ndGg7IGkgPCBuOyArK2kpIHRbaV0udmFsdWUuYXBwbHkodGhhdCwgYXJncyk7XG4gIH0sXG4gIGFwcGx5OiBmdW5jdGlvbih0eXBlLCB0aGF0LCBhcmdzKSB7XG4gICAgaWYgKCF0aGlzLl8uaGFzT3duUHJvcGVydHkodHlwZSkpIHRocm93IG5ldyBFcnJvcihcInVua25vd24gdHlwZTogXCIgKyB0eXBlKTtcbiAgICBmb3IgKHZhciB0ID0gdGhpcy5fW3R5cGVdLCBpID0gMCwgbiA9IHQubGVuZ3RoOyBpIDwgbjsgKytpKSB0W2ldLnZhbHVlLmFwcGx5KHRoYXQsIGFyZ3MpO1xuICB9XG59O1xuXG5mdW5jdGlvbiBnZXQodHlwZSwgbmFtZSkge1xuICBmb3IgKHZhciBpID0gMCwgbiA9IHR5cGUubGVuZ3RoLCBjOyBpIDwgbjsgKytpKSB7XG4gICAgaWYgKChjID0gdHlwZVtpXSkubmFtZSA9PT0gbmFtZSkge1xuICAgICAgcmV0dXJuIGMudmFsdWU7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIHNldCh0eXBlLCBuYW1lLCBjYWxsYmFjaykge1xuICBmb3IgKHZhciBpID0gMCwgbiA9IHR5cGUubGVuZ3RoOyBpIDwgbjsgKytpKSB7XG4gICAgaWYgKHR5cGVbaV0ubmFtZSA9PT0gbmFtZSkge1xuICAgICAgdHlwZVtpXSA9IG5vb3AsIHR5cGUgPSB0eXBlLnNsaWNlKDAsIGkpLmNvbmNhdCh0eXBlLnNsaWNlKGkgKyAxKSk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgaWYgKGNhbGxiYWNrICE9IG51bGwpIHR5cGUucHVzaCh7bmFtZTogbmFtZSwgdmFsdWU6IGNhbGxiYWNrfSk7XG4gIHJldHVybiB0eXBlO1xufVxuXG5leHBvcnQgZGVmYXVsdCBkaXNwYXRjaDtcbiIsICJleHBvcnQgdmFyIHhodG1sID0gXCJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hodG1sXCI7XG5cbmV4cG9ydCBkZWZhdWx0IHtcbiAgc3ZnOiBcImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCIsXG4gIHhodG1sOiB4aHRtbCxcbiAgeGxpbms6IFwiaHR0cDovL3d3dy53My5vcmcvMTk5OS94bGlua1wiLFxuICB4bWw6IFwiaHR0cDovL3d3dy53My5vcmcvWE1MLzE5OTgvbmFtZXNwYWNlXCIsXG4gIHhtbG5zOiBcImh0dHA6Ly93d3cudzMub3JnLzIwMDAveG1sbnMvXCJcbn07XG4iLCAiaW1wb3J0IG5hbWVzcGFjZXMgZnJvbSBcIi4vbmFtZXNwYWNlcy5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihuYW1lKSB7XG4gIHZhciBwcmVmaXggPSBuYW1lICs9IFwiXCIsIGkgPSBwcmVmaXguaW5kZXhPZihcIjpcIik7XG4gIGlmIChpID49IDAgJiYgKHByZWZpeCA9IG5hbWUuc2xpY2UoMCwgaSkpICE9PSBcInhtbG5zXCIpIG5hbWUgPSBuYW1lLnNsaWNlKGkgKyAxKTtcbiAgcmV0dXJuIG5hbWVzcGFjZXMuaGFzT3duUHJvcGVydHkocHJlZml4KSA/IHtzcGFjZTogbmFtZXNwYWNlc1twcmVmaXhdLCBsb2NhbDogbmFtZX0gOiBuYW1lOyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXByb3RvdHlwZS1idWlsdGluc1xufVxuIiwgImltcG9ydCBuYW1lc3BhY2UgZnJvbSBcIi4vbmFtZXNwYWNlLmpzXCI7XG5pbXBvcnQge3hodG1sfSBmcm9tIFwiLi9uYW1lc3BhY2VzLmpzXCI7XG5cbmZ1bmN0aW9uIGNyZWF0b3JJbmhlcml0KG5hbWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBkb2N1bWVudCA9IHRoaXMub3duZXJEb2N1bWVudCxcbiAgICAgICAgdXJpID0gdGhpcy5uYW1lc3BhY2VVUkk7XG4gICAgcmV0dXJuIHVyaSA9PT0geGh0bWwgJiYgZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50Lm5hbWVzcGFjZVVSSSA9PT0geGh0bWxcbiAgICAgICAgPyBkb2N1bWVudC5jcmVhdGVFbGVtZW50KG5hbWUpXG4gICAgICAgIDogZG9jdW1lbnQuY3JlYXRlRWxlbWVudE5TKHVyaSwgbmFtZSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGNyZWF0b3JGaXhlZChmdWxsbmFtZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMub3duZXJEb2N1bWVudC5jcmVhdGVFbGVtZW50TlMoZnVsbG5hbWUuc3BhY2UsIGZ1bGxuYW1lLmxvY2FsKTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSkge1xuICB2YXIgZnVsbG5hbWUgPSBuYW1lc3BhY2UobmFtZSk7XG4gIHJldHVybiAoZnVsbG5hbWUubG9jYWxcbiAgICAgID8gY3JlYXRvckZpeGVkXG4gICAgICA6IGNyZWF0b3JJbmhlcml0KShmdWxsbmFtZSk7XG59XG4iLCAiZnVuY3Rpb24gbm9uZSgpIHt9XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHNlbGVjdG9yKSB7XG4gIHJldHVybiBzZWxlY3RvciA9PSBudWxsID8gbm9uZSA6IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLnF1ZXJ5U2VsZWN0b3Ioc2VsZWN0b3IpO1xuICB9O1xufVxuIiwgImltcG9ydCB7U2VsZWN0aW9ufSBmcm9tIFwiLi9pbmRleC5qc1wiO1xuaW1wb3J0IHNlbGVjdG9yIGZyb20gXCIuLi9zZWxlY3Rvci5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihzZWxlY3QpIHtcbiAgaWYgKHR5cGVvZiBzZWxlY3QgIT09IFwiZnVuY3Rpb25cIikgc2VsZWN0ID0gc2VsZWN0b3Ioc2VsZWN0KTtcblxuICBmb3IgKHZhciBncm91cHMgPSB0aGlzLl9ncm91cHMsIG0gPSBncm91cHMubGVuZ3RoLCBzdWJncm91cHMgPSBuZXcgQXJyYXkobSksIGogPSAwOyBqIDwgbTsgKytqKSB7XG4gICAgZm9yICh2YXIgZ3JvdXAgPSBncm91cHNbal0sIG4gPSBncm91cC5sZW5ndGgsIHN1Ymdyb3VwID0gc3ViZ3JvdXBzW2pdID0gbmV3IEFycmF5KG4pLCBub2RlLCBzdWJub2RlLCBpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgaWYgKChub2RlID0gZ3JvdXBbaV0pICYmIChzdWJub2RlID0gc2VsZWN0LmNhbGwobm9kZSwgbm9kZS5fX2RhdGFfXywgaSwgZ3JvdXApKSkge1xuICAgICAgICBpZiAoXCJfX2RhdGFfX1wiIGluIG5vZGUpIHN1Ym5vZGUuX19kYXRhX18gPSBub2RlLl9fZGF0YV9fO1xuICAgICAgICBzdWJncm91cFtpXSA9IHN1Ym5vZGU7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG5ldyBTZWxlY3Rpb24oc3ViZ3JvdXBzLCB0aGlzLl9wYXJlbnRzKTtcbn1cbiIsICIvLyBHaXZlbiBzb21ldGhpbmcgYXJyYXkgbGlrZSAob3IgbnVsbCksIHJldHVybnMgc29tZXRoaW5nIHRoYXQgaXMgc3RyaWN0bHkgYW5cbi8vIGFycmF5LiBUaGlzIGlzIHVzZWQgdG8gZW5zdXJlIHRoYXQgYXJyYXktbGlrZSBvYmplY3RzIHBhc3NlZCB0byBkMy5zZWxlY3RBbGxcbi8vIG9yIHNlbGVjdGlvbi5zZWxlY3RBbGwgYXJlIGNvbnZlcnRlZCBpbnRvIHByb3BlciBhcnJheXMgd2hlbiBjcmVhdGluZyBhXG4vLyBzZWxlY3Rpb247IHdlIGRvblx1MjAxOXQgZXZlciB3YW50IHRvIGNyZWF0ZSBhIHNlbGVjdGlvbiBiYWNrZWQgYnkgYSBsaXZlXG4vLyBIVE1MQ29sbGVjdGlvbiBvciBOb2RlTGlzdC4gSG93ZXZlciwgbm90ZSB0aGF0IHNlbGVjdGlvbi5zZWxlY3RBbGwgd2lsbCB1c2UgYVxuLy8gc3RhdGljIE5vZGVMaXN0IGFzIGEgZ3JvdXAsIHNpbmNlIGl0IHNhZmVseSBkZXJpdmVkIGZyb20gcXVlcnlTZWxlY3RvckFsbC5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIGFycmF5KHgpIHtcbiAgcmV0dXJuIHggPT0gbnVsbCA/IFtdIDogQXJyYXkuaXNBcnJheSh4KSA/IHggOiBBcnJheS5mcm9tKHgpO1xufVxuIiwgImZ1bmN0aW9uIGVtcHR5KCkge1xuICByZXR1cm4gW107XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHNlbGVjdG9yKSB7XG4gIHJldHVybiBzZWxlY3RvciA9PSBudWxsID8gZW1wdHkgOiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeVNlbGVjdG9yQWxsKHNlbGVjdG9yKTtcbiAgfTtcbn1cbiIsICJpbXBvcnQge1NlbGVjdGlvbn0gZnJvbSBcIi4vaW5kZXguanNcIjtcbmltcG9ydCBhcnJheSBmcm9tIFwiLi4vYXJyYXkuanNcIjtcbmltcG9ydCBzZWxlY3RvckFsbCBmcm9tIFwiLi4vc2VsZWN0b3JBbGwuanNcIjtcblxuZnVuY3Rpb24gYXJyYXlBbGwoc2VsZWN0KSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gYXJyYXkoc2VsZWN0LmFwcGx5KHRoaXMsIGFyZ3VtZW50cykpO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihzZWxlY3QpIHtcbiAgaWYgKHR5cGVvZiBzZWxlY3QgPT09IFwiZnVuY3Rpb25cIikgc2VsZWN0ID0gYXJyYXlBbGwoc2VsZWN0KTtcbiAgZWxzZSBzZWxlY3QgPSBzZWxlY3RvckFsbChzZWxlY3QpO1xuXG4gIGZvciAodmFyIGdyb3VwcyA9IHRoaXMuX2dyb3VwcywgbSA9IGdyb3Vwcy5sZW5ndGgsIHN1Ymdyb3VwcyA9IFtdLCBwYXJlbnRzID0gW10sIGogPSAwOyBqIDwgbTsgKytqKSB7XG4gICAgZm9yICh2YXIgZ3JvdXAgPSBncm91cHNbal0sIG4gPSBncm91cC5sZW5ndGgsIG5vZGUsIGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAobm9kZSA9IGdyb3VwW2ldKSB7XG4gICAgICAgIHN1Ymdyb3Vwcy5wdXNoKHNlbGVjdC5jYWxsKG5vZGUsIG5vZGUuX19kYXRhX18sIGksIGdyb3VwKSk7XG4gICAgICAgIHBhcmVudHMucHVzaChub2RlKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gbmV3IFNlbGVjdGlvbihzdWJncm91cHMsIHBhcmVudHMpO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHNlbGVjdG9yKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5tYXRjaGVzKHNlbGVjdG9yKTtcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNoaWxkTWF0Y2hlcihzZWxlY3Rvcikge1xuICByZXR1cm4gZnVuY3Rpb24obm9kZSkge1xuICAgIHJldHVybiBub2RlLm1hdGNoZXMoc2VsZWN0b3IpO1xuICB9O1xufVxuXG4iLCAiaW1wb3J0IHtjaGlsZE1hdGNoZXJ9IGZyb20gXCIuLi9tYXRjaGVyLmpzXCI7XG5cbnZhciBmaW5kID0gQXJyYXkucHJvdG90eXBlLmZpbmQ7XG5cbmZ1bmN0aW9uIGNoaWxkRmluZChtYXRjaCkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGZpbmQuY2FsbCh0aGlzLmNoaWxkcmVuLCBtYXRjaCk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGNoaWxkRmlyc3QoKSB7XG4gIHJldHVybiB0aGlzLmZpcnN0RWxlbWVudENoaWxkO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihtYXRjaCkge1xuICByZXR1cm4gdGhpcy5zZWxlY3QobWF0Y2ggPT0gbnVsbCA/IGNoaWxkRmlyc3RcbiAgICAgIDogY2hpbGRGaW5kKHR5cGVvZiBtYXRjaCA9PT0gXCJmdW5jdGlvblwiID8gbWF0Y2ggOiBjaGlsZE1hdGNoZXIobWF0Y2gpKSk7XG59XG4iLCAiaW1wb3J0IHtjaGlsZE1hdGNoZXJ9IGZyb20gXCIuLi9tYXRjaGVyLmpzXCI7XG5cbnZhciBmaWx0ZXIgPSBBcnJheS5wcm90b3R5cGUuZmlsdGVyO1xuXG5mdW5jdGlvbiBjaGlsZHJlbigpIHtcbiAgcmV0dXJuIEFycmF5LmZyb20odGhpcy5jaGlsZHJlbik7XG59XG5cbmZ1bmN0aW9uIGNoaWxkcmVuRmlsdGVyKG1hdGNoKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gZmlsdGVyLmNhbGwodGhpcy5jaGlsZHJlbiwgbWF0Y2gpO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihtYXRjaCkge1xuICByZXR1cm4gdGhpcy5zZWxlY3RBbGwobWF0Y2ggPT0gbnVsbCA/IGNoaWxkcmVuXG4gICAgICA6IGNoaWxkcmVuRmlsdGVyKHR5cGVvZiBtYXRjaCA9PT0gXCJmdW5jdGlvblwiID8gbWF0Y2ggOiBjaGlsZE1hdGNoZXIobWF0Y2gpKSk7XG59XG4iLCAiaW1wb3J0IHtTZWxlY3Rpb259IGZyb20gXCIuL2luZGV4LmpzXCI7XG5pbXBvcnQgbWF0Y2hlciBmcm9tIFwiLi4vbWF0Y2hlci5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihtYXRjaCkge1xuICBpZiAodHlwZW9mIG1hdGNoICE9PSBcImZ1bmN0aW9uXCIpIG1hdGNoID0gbWF0Y2hlcihtYXRjaCk7XG5cbiAgZm9yICh2YXIgZ3JvdXBzID0gdGhpcy5fZ3JvdXBzLCBtID0gZ3JvdXBzLmxlbmd0aCwgc3ViZ3JvdXBzID0gbmV3IEFycmF5KG0pLCBqID0gMDsgaiA8IG07ICsraikge1xuICAgIGZvciAodmFyIGdyb3VwID0gZ3JvdXBzW2pdLCBuID0gZ3JvdXAubGVuZ3RoLCBzdWJncm91cCA9IHN1Ymdyb3Vwc1tqXSA9IFtdLCBub2RlLCBpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgaWYgKChub2RlID0gZ3JvdXBbaV0pICYmIG1hdGNoLmNhbGwobm9kZSwgbm9kZS5fX2RhdGFfXywgaSwgZ3JvdXApKSB7XG4gICAgICAgIHN1Ymdyb3VwLnB1c2gobm9kZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG5ldyBTZWxlY3Rpb24oc3ViZ3JvdXBzLCB0aGlzLl9wYXJlbnRzKTtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbih1cGRhdGUpIHtcbiAgcmV0dXJuIG5ldyBBcnJheSh1cGRhdGUubGVuZ3RoKTtcbn1cbiIsICJpbXBvcnQgc3BhcnNlIGZyb20gXCIuL3NwYXJzZS5qc1wiO1xuaW1wb3J0IHtTZWxlY3Rpb259IGZyb20gXCIuL2luZGV4LmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gbmV3IFNlbGVjdGlvbih0aGlzLl9lbnRlciB8fCB0aGlzLl9ncm91cHMubWFwKHNwYXJzZSksIHRoaXMuX3BhcmVudHMpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gRW50ZXJOb2RlKHBhcmVudCwgZGF0dW0pIHtcbiAgdGhpcy5vd25lckRvY3VtZW50ID0gcGFyZW50Lm93bmVyRG9jdW1lbnQ7XG4gIHRoaXMubmFtZXNwYWNlVVJJID0gcGFyZW50Lm5hbWVzcGFjZVVSSTtcbiAgdGhpcy5fbmV4dCA9IG51bGw7XG4gIHRoaXMuX3BhcmVudCA9IHBhcmVudDtcbiAgdGhpcy5fX2RhdGFfXyA9IGRhdHVtO1xufVxuXG5FbnRlck5vZGUucHJvdG90eXBlID0ge1xuICBjb25zdHJ1Y3RvcjogRW50ZXJOb2RlLFxuICBhcHBlbmRDaGlsZDogZnVuY3Rpb24oY2hpbGQpIHsgcmV0dXJuIHRoaXMuX3BhcmVudC5pbnNlcnRCZWZvcmUoY2hpbGQsIHRoaXMuX25leHQpOyB9LFxuICBpbnNlcnRCZWZvcmU6IGZ1bmN0aW9uKGNoaWxkLCBuZXh0KSB7IHJldHVybiB0aGlzLl9wYXJlbnQuaW5zZXJ0QmVmb3JlKGNoaWxkLCBuZXh0KTsgfSxcbiAgcXVlcnlTZWxlY3RvcjogZnVuY3Rpb24oc2VsZWN0b3IpIHsgcmV0dXJuIHRoaXMuX3BhcmVudC5xdWVyeVNlbGVjdG9yKHNlbGVjdG9yKTsgfSxcbiAgcXVlcnlTZWxlY3RvckFsbDogZnVuY3Rpb24oc2VsZWN0b3IpIHsgcmV0dXJuIHRoaXMuX3BhcmVudC5xdWVyeVNlbGVjdG9yQWxsKHNlbGVjdG9yKTsgfVxufTtcbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbih4KSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4geDtcbiAgfTtcbn1cbiIsICJpbXBvcnQge1NlbGVjdGlvbn0gZnJvbSBcIi4vaW5kZXguanNcIjtcbmltcG9ydCB7RW50ZXJOb2RlfSBmcm9tIFwiLi9lbnRlci5qc1wiO1xuaW1wb3J0IGNvbnN0YW50IGZyb20gXCIuLi9jb25zdGFudC5qc1wiO1xuXG5mdW5jdGlvbiBiaW5kSW5kZXgocGFyZW50LCBncm91cCwgZW50ZXIsIHVwZGF0ZSwgZXhpdCwgZGF0YSkge1xuICB2YXIgaSA9IDAsXG4gICAgICBub2RlLFxuICAgICAgZ3JvdXBMZW5ndGggPSBncm91cC5sZW5ndGgsXG4gICAgICBkYXRhTGVuZ3RoID0gZGF0YS5sZW5ndGg7XG5cbiAgLy8gUHV0IGFueSBub24tbnVsbCBub2RlcyB0aGF0IGZpdCBpbnRvIHVwZGF0ZS5cbiAgLy8gUHV0IGFueSBudWxsIG5vZGVzIGludG8gZW50ZXIuXG4gIC8vIFB1dCBhbnkgcmVtYWluaW5nIGRhdGEgaW50byBlbnRlci5cbiAgZm9yICg7IGkgPCBkYXRhTGVuZ3RoOyArK2kpIHtcbiAgICBpZiAobm9kZSA9IGdyb3VwW2ldKSB7XG4gICAgICBub2RlLl9fZGF0YV9fID0gZGF0YVtpXTtcbiAgICAgIHVwZGF0ZVtpXSA9IG5vZGU7XG4gICAgfSBlbHNlIHtcbiAgICAgIGVudGVyW2ldID0gbmV3IEVudGVyTm9kZShwYXJlbnQsIGRhdGFbaV0pO1xuICAgIH1cbiAgfVxuXG4gIC8vIFB1dCBhbnkgbm9uLW51bGwgbm9kZXMgdGhhdCBkb25cdTIwMTl0IGZpdCBpbnRvIGV4aXQuXG4gIGZvciAoOyBpIDwgZ3JvdXBMZW5ndGg7ICsraSkge1xuICAgIGlmIChub2RlID0gZ3JvdXBbaV0pIHtcbiAgICAgIGV4aXRbaV0gPSBub2RlO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBiaW5kS2V5KHBhcmVudCwgZ3JvdXAsIGVudGVyLCB1cGRhdGUsIGV4aXQsIGRhdGEsIGtleSkge1xuICB2YXIgaSxcbiAgICAgIG5vZGUsXG4gICAgICBub2RlQnlLZXlWYWx1ZSA9IG5ldyBNYXAsXG4gICAgICBncm91cExlbmd0aCA9IGdyb3VwLmxlbmd0aCxcbiAgICAgIGRhdGFMZW5ndGggPSBkYXRhLmxlbmd0aCxcbiAgICAgIGtleVZhbHVlcyA9IG5ldyBBcnJheShncm91cExlbmd0aCksXG4gICAgICBrZXlWYWx1ZTtcblxuICAvLyBDb21wdXRlIHRoZSBrZXkgZm9yIGVhY2ggbm9kZS5cbiAgLy8gSWYgbXVsdGlwbGUgbm9kZXMgaGF2ZSB0aGUgc2FtZSBrZXksIHRoZSBkdXBsaWNhdGVzIGFyZSBhZGRlZCB0byBleGl0LlxuICBmb3IgKGkgPSAwOyBpIDwgZ3JvdXBMZW5ndGg7ICsraSkge1xuICAgIGlmIChub2RlID0gZ3JvdXBbaV0pIHtcbiAgICAgIGtleVZhbHVlc1tpXSA9IGtleVZhbHVlID0ga2V5LmNhbGwobm9kZSwgbm9kZS5fX2RhdGFfXywgaSwgZ3JvdXApICsgXCJcIjtcbiAgICAgIGlmIChub2RlQnlLZXlWYWx1ZS5oYXMoa2V5VmFsdWUpKSB7XG4gICAgICAgIGV4aXRbaV0gPSBub2RlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbm9kZUJ5S2V5VmFsdWUuc2V0KGtleVZhbHVlLCBub2RlKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyBDb21wdXRlIHRoZSBrZXkgZm9yIGVhY2ggZGF0dW0uXG4gIC8vIElmIHRoZXJlIGEgbm9kZSBhc3NvY2lhdGVkIHdpdGggdGhpcyBrZXksIGpvaW4gYW5kIGFkZCBpdCB0byB1cGRhdGUuXG4gIC8vIElmIHRoZXJlIGlzIG5vdCAob3IgdGhlIGtleSBpcyBhIGR1cGxpY2F0ZSksIGFkZCBpdCB0byBlbnRlci5cbiAgZm9yIChpID0gMDsgaSA8IGRhdGFMZW5ndGg7ICsraSkge1xuICAgIGtleVZhbHVlID0ga2V5LmNhbGwocGFyZW50LCBkYXRhW2ldLCBpLCBkYXRhKSArIFwiXCI7XG4gICAgaWYgKG5vZGUgPSBub2RlQnlLZXlWYWx1ZS5nZXQoa2V5VmFsdWUpKSB7XG4gICAgICB1cGRhdGVbaV0gPSBub2RlO1xuICAgICAgbm9kZS5fX2RhdGFfXyA9IGRhdGFbaV07XG4gICAgICBub2RlQnlLZXlWYWx1ZS5kZWxldGUoa2V5VmFsdWUpO1xuICAgIH0gZWxzZSB7XG4gICAgICBlbnRlcltpXSA9IG5ldyBFbnRlck5vZGUocGFyZW50LCBkYXRhW2ldKTtcbiAgICB9XG4gIH1cblxuICAvLyBBZGQgYW55IHJlbWFpbmluZyBub2RlcyB0aGF0IHdlcmUgbm90IGJvdW5kIHRvIGRhdGEgdG8gZXhpdC5cbiAgZm9yIChpID0gMDsgaSA8IGdyb3VwTGVuZ3RoOyArK2kpIHtcbiAgICBpZiAoKG5vZGUgPSBncm91cFtpXSkgJiYgKG5vZGVCeUtleVZhbHVlLmdldChrZXlWYWx1ZXNbaV0pID09PSBub2RlKSkge1xuICAgICAgZXhpdFtpXSA9IG5vZGU7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGRhdHVtKG5vZGUpIHtcbiAgcmV0dXJuIG5vZGUuX19kYXRhX187XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHZhbHVlLCBrZXkpIHtcbiAgaWYgKCFhcmd1bWVudHMubGVuZ3RoKSByZXR1cm4gQXJyYXkuZnJvbSh0aGlzLCBkYXR1bSk7XG5cbiAgdmFyIGJpbmQgPSBrZXkgPyBiaW5kS2V5IDogYmluZEluZGV4LFxuICAgICAgcGFyZW50cyA9IHRoaXMuX3BhcmVudHMsXG4gICAgICBncm91cHMgPSB0aGlzLl9ncm91cHM7XG5cbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJmdW5jdGlvblwiKSB2YWx1ZSA9IGNvbnN0YW50KHZhbHVlKTtcblxuICBmb3IgKHZhciBtID0gZ3JvdXBzLmxlbmd0aCwgdXBkYXRlID0gbmV3IEFycmF5KG0pLCBlbnRlciA9IG5ldyBBcnJheShtKSwgZXhpdCA9IG5ldyBBcnJheShtKSwgaiA9IDA7IGogPCBtOyArK2opIHtcbiAgICB2YXIgcGFyZW50ID0gcGFyZW50c1tqXSxcbiAgICAgICAgZ3JvdXAgPSBncm91cHNbal0sXG4gICAgICAgIGdyb3VwTGVuZ3RoID0gZ3JvdXAubGVuZ3RoLFxuICAgICAgICBkYXRhID0gYXJyYXlsaWtlKHZhbHVlLmNhbGwocGFyZW50LCBwYXJlbnQgJiYgcGFyZW50Ll9fZGF0YV9fLCBqLCBwYXJlbnRzKSksXG4gICAgICAgIGRhdGFMZW5ndGggPSBkYXRhLmxlbmd0aCxcbiAgICAgICAgZW50ZXJHcm91cCA9IGVudGVyW2pdID0gbmV3IEFycmF5KGRhdGFMZW5ndGgpLFxuICAgICAgICB1cGRhdGVHcm91cCA9IHVwZGF0ZVtqXSA9IG5ldyBBcnJheShkYXRhTGVuZ3RoKSxcbiAgICAgICAgZXhpdEdyb3VwID0gZXhpdFtqXSA9IG5ldyBBcnJheShncm91cExlbmd0aCk7XG5cbiAgICBiaW5kKHBhcmVudCwgZ3JvdXAsIGVudGVyR3JvdXAsIHVwZGF0ZUdyb3VwLCBleGl0R3JvdXAsIGRhdGEsIGtleSk7XG5cbiAgICAvLyBOb3cgY29ubmVjdCB0aGUgZW50ZXIgbm9kZXMgdG8gdGhlaXIgZm9sbG93aW5nIHVwZGF0ZSBub2RlLCBzdWNoIHRoYXRcbiAgICAvLyBhcHBlbmRDaGlsZCBjYW4gaW5zZXJ0IHRoZSBtYXRlcmlhbGl6ZWQgZW50ZXIgbm9kZSBiZWZvcmUgdGhpcyBub2RlLFxuICAgIC8vIHJhdGhlciB0aGFuIGF0IHRoZSBlbmQgb2YgdGhlIHBhcmVudCBub2RlLlxuICAgIGZvciAodmFyIGkwID0gMCwgaTEgPSAwLCBwcmV2aW91cywgbmV4dDsgaTAgPCBkYXRhTGVuZ3RoOyArK2kwKSB7XG4gICAgICBpZiAocHJldmlvdXMgPSBlbnRlckdyb3VwW2kwXSkge1xuICAgICAgICBpZiAoaTAgPj0gaTEpIGkxID0gaTAgKyAxO1xuICAgICAgICB3aGlsZSAoIShuZXh0ID0gdXBkYXRlR3JvdXBbaTFdKSAmJiArK2kxIDwgZGF0YUxlbmd0aCk7XG4gICAgICAgIHByZXZpb3VzLl9uZXh0ID0gbmV4dCB8fCBudWxsO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHVwZGF0ZSA9IG5ldyBTZWxlY3Rpb24odXBkYXRlLCBwYXJlbnRzKTtcbiAgdXBkYXRlLl9lbnRlciA9IGVudGVyO1xuICB1cGRhdGUuX2V4aXQgPSBleGl0O1xuICByZXR1cm4gdXBkYXRlO1xufVxuXG4vLyBHaXZlbiBzb21lIGRhdGEsIHRoaXMgcmV0dXJucyBhbiBhcnJheS1saWtlIHZpZXcgb2YgaXQ6IGFuIG9iamVjdCB0aGF0XG4vLyBleHBvc2VzIGEgbGVuZ3RoIHByb3BlcnR5IGFuZCBhbGxvd3MgbnVtZXJpYyBpbmRleGluZy4gTm90ZSB0aGF0IHVubGlrZVxuLy8gc2VsZWN0QWxsLCB0aGlzIGlzblx1MjAxOXQgd29ycmllZCBhYm91dCBcdTIwMUNsaXZlXHUyMDFEIGNvbGxlY3Rpb25zIGJlY2F1c2UgdGhlIHJlc3VsdGluZ1xuLy8gYXJyYXkgd2lsbCBvbmx5IGJlIHVzZWQgYnJpZWZseSB3aGlsZSBkYXRhIGlzIGJlaW5nIGJvdW5kLiAoSXQgaXMgcG9zc2libGUgdG9cbi8vIGNhdXNlIHRoZSBkYXRhIHRvIGNoYW5nZSB3aGlsZSBpdGVyYXRpbmcgYnkgdXNpbmcgYSBrZXkgZnVuY3Rpb24sIGJ1dCBwbGVhc2Vcbi8vIGRvblx1MjAxOXQ7IHdlXHUyMDE5ZCByYXRoZXIgYXZvaWQgYSBncmF0dWl0b3VzIGNvcHkuKVxuZnVuY3Rpb24gYXJyYXlsaWtlKGRhdGEpIHtcbiAgcmV0dXJuIHR5cGVvZiBkYXRhID09PSBcIm9iamVjdFwiICYmIFwibGVuZ3RoXCIgaW4gZGF0YVxuICAgID8gZGF0YSAvLyBBcnJheSwgVHlwZWRBcnJheSwgTm9kZUxpc3QsIGFycmF5LWxpa2VcbiAgICA6IEFycmF5LmZyb20oZGF0YSk7IC8vIE1hcCwgU2V0LCBpdGVyYWJsZSwgc3RyaW5nLCBvciBhbnl0aGluZyBlbHNlXG59XG4iLCAiaW1wb3J0IHNwYXJzZSBmcm9tIFwiLi9zcGFyc2UuanNcIjtcbmltcG9ydCB7U2VsZWN0aW9ufSBmcm9tIFwiLi9pbmRleC5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIG5ldyBTZWxlY3Rpb24odGhpcy5fZXhpdCB8fCB0aGlzLl9ncm91cHMubWFwKHNwYXJzZSksIHRoaXMuX3BhcmVudHMpO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG9uZW50ZXIsIG9udXBkYXRlLCBvbmV4aXQpIHtcbiAgdmFyIGVudGVyID0gdGhpcy5lbnRlcigpLCB1cGRhdGUgPSB0aGlzLCBleGl0ID0gdGhpcy5leGl0KCk7XG4gIGlmICh0eXBlb2Ygb25lbnRlciA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgZW50ZXIgPSBvbmVudGVyKGVudGVyKTtcbiAgICBpZiAoZW50ZXIpIGVudGVyID0gZW50ZXIuc2VsZWN0aW9uKCk7XG4gIH0gZWxzZSB7XG4gICAgZW50ZXIgPSBlbnRlci5hcHBlbmQob25lbnRlciArIFwiXCIpO1xuICB9XG4gIGlmIChvbnVwZGF0ZSAhPSBudWxsKSB7XG4gICAgdXBkYXRlID0gb251cGRhdGUodXBkYXRlKTtcbiAgICBpZiAodXBkYXRlKSB1cGRhdGUgPSB1cGRhdGUuc2VsZWN0aW9uKCk7XG4gIH1cbiAgaWYgKG9uZXhpdCA9PSBudWxsKSBleGl0LnJlbW92ZSgpOyBlbHNlIG9uZXhpdChleGl0KTtcbiAgcmV0dXJuIGVudGVyICYmIHVwZGF0ZSA/IGVudGVyLm1lcmdlKHVwZGF0ZSkub3JkZXIoKSA6IHVwZGF0ZTtcbn1cbiIsICJpbXBvcnQge1NlbGVjdGlvbn0gZnJvbSBcIi4vaW5kZXguanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oY29udGV4dCkge1xuICB2YXIgc2VsZWN0aW9uID0gY29udGV4dC5zZWxlY3Rpb24gPyBjb250ZXh0LnNlbGVjdGlvbigpIDogY29udGV4dDtcblxuICBmb3IgKHZhciBncm91cHMwID0gdGhpcy5fZ3JvdXBzLCBncm91cHMxID0gc2VsZWN0aW9uLl9ncm91cHMsIG0wID0gZ3JvdXBzMC5sZW5ndGgsIG0xID0gZ3JvdXBzMS5sZW5ndGgsIG0gPSBNYXRoLm1pbihtMCwgbTEpLCBtZXJnZXMgPSBuZXcgQXJyYXkobTApLCBqID0gMDsgaiA8IG07ICsraikge1xuICAgIGZvciAodmFyIGdyb3VwMCA9IGdyb3VwczBbal0sIGdyb3VwMSA9IGdyb3VwczFbal0sIG4gPSBncm91cDAubGVuZ3RoLCBtZXJnZSA9IG1lcmdlc1tqXSA9IG5ldyBBcnJheShuKSwgbm9kZSwgaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIGlmIChub2RlID0gZ3JvdXAwW2ldIHx8IGdyb3VwMVtpXSkge1xuICAgICAgICBtZXJnZVtpXSA9IG5vZGU7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZm9yICg7IGogPCBtMDsgKytqKSB7XG4gICAgbWVyZ2VzW2pdID0gZ3JvdXBzMFtqXTtcbiAgfVxuXG4gIHJldHVybiBuZXcgU2VsZWN0aW9uKG1lcmdlcywgdGhpcy5fcGFyZW50cyk7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG5cbiAgZm9yICh2YXIgZ3JvdXBzID0gdGhpcy5fZ3JvdXBzLCBqID0gLTEsIG0gPSBncm91cHMubGVuZ3RoOyArK2ogPCBtOykge1xuICAgIGZvciAodmFyIGdyb3VwID0gZ3JvdXBzW2pdLCBpID0gZ3JvdXAubGVuZ3RoIC0gMSwgbmV4dCA9IGdyb3VwW2ldLCBub2RlOyAtLWkgPj0gMDspIHtcbiAgICAgIGlmIChub2RlID0gZ3JvdXBbaV0pIHtcbiAgICAgICAgaWYgKG5leHQgJiYgbm9kZS5jb21wYXJlRG9jdW1lbnRQb3NpdGlvbihuZXh0KSBeIDQpIG5leHQucGFyZW50Tm9kZS5pbnNlcnRCZWZvcmUobm9kZSwgbmV4dCk7XG4gICAgICAgIG5leHQgPSBub2RlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0aGlzO1xufVxuIiwgImltcG9ydCB7U2VsZWN0aW9ufSBmcm9tIFwiLi9pbmRleC5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihjb21wYXJlKSB7XG4gIGlmICghY29tcGFyZSkgY29tcGFyZSA9IGFzY2VuZGluZztcblxuICBmdW5jdGlvbiBjb21wYXJlTm9kZShhLCBiKSB7XG4gICAgcmV0dXJuIGEgJiYgYiA/IGNvbXBhcmUoYS5fX2RhdGFfXywgYi5fX2RhdGFfXykgOiAhYSAtICFiO1xuICB9XG5cbiAgZm9yICh2YXIgZ3JvdXBzID0gdGhpcy5fZ3JvdXBzLCBtID0gZ3JvdXBzLmxlbmd0aCwgc29ydGdyb3VwcyA9IG5ldyBBcnJheShtKSwgaiA9IDA7IGogPCBtOyArK2opIHtcbiAgICBmb3IgKHZhciBncm91cCA9IGdyb3Vwc1tqXSwgbiA9IGdyb3VwLmxlbmd0aCwgc29ydGdyb3VwID0gc29ydGdyb3Vwc1tqXSA9IG5ldyBBcnJheShuKSwgbm9kZSwgaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIGlmIChub2RlID0gZ3JvdXBbaV0pIHtcbiAgICAgICAgc29ydGdyb3VwW2ldID0gbm9kZTtcbiAgICAgIH1cbiAgICB9XG4gICAgc29ydGdyb3VwLnNvcnQoY29tcGFyZU5vZGUpO1xuICB9XG5cbiAgcmV0dXJuIG5ldyBTZWxlY3Rpb24oc29ydGdyb3VwcywgdGhpcy5fcGFyZW50cykub3JkZXIoKTtcbn1cblxuZnVuY3Rpb24gYXNjZW5kaW5nKGEsIGIpIHtcbiAgcmV0dXJuIGEgPCBiID8gLTEgOiBhID4gYiA/IDEgOiBhID49IGIgPyAwIDogTmFOO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKCkge1xuICB2YXIgY2FsbGJhY2sgPSBhcmd1bWVudHNbMF07XG4gIGFyZ3VtZW50c1swXSA9IHRoaXM7XG4gIGNhbGxiYWNrLmFwcGx5KG51bGwsIGFyZ3VtZW50cyk7XG4gIHJldHVybiB0aGlzO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gQXJyYXkuZnJvbSh0aGlzKTtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcblxuICBmb3IgKHZhciBncm91cHMgPSB0aGlzLl9ncm91cHMsIGogPSAwLCBtID0gZ3JvdXBzLmxlbmd0aDsgaiA8IG07ICsraikge1xuICAgIGZvciAodmFyIGdyb3VwID0gZ3JvdXBzW2pdLCBpID0gMCwgbiA9IGdyb3VwLmxlbmd0aDsgaSA8IG47ICsraSkge1xuICAgICAgdmFyIG5vZGUgPSBncm91cFtpXTtcbiAgICAgIGlmIChub2RlKSByZXR1cm4gbm9kZTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gbnVsbDtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgbGV0IHNpemUgPSAwO1xuICBmb3IgKGNvbnN0IG5vZGUgb2YgdGhpcykgKytzaXplOyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gIHJldHVybiBzaXplO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gIXRoaXMubm9kZSgpO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGNhbGxiYWNrKSB7XG5cbiAgZm9yICh2YXIgZ3JvdXBzID0gdGhpcy5fZ3JvdXBzLCBqID0gMCwgbSA9IGdyb3Vwcy5sZW5ndGg7IGogPCBtOyArK2opIHtcbiAgICBmb3IgKHZhciBncm91cCA9IGdyb3Vwc1tqXSwgaSA9IDAsIG4gPSBncm91cC5sZW5ndGgsIG5vZGU7IGkgPCBuOyArK2kpIHtcbiAgICAgIGlmIChub2RlID0gZ3JvdXBbaV0pIGNhbGxiYWNrLmNhbGwobm9kZSwgbm9kZS5fX2RhdGFfXywgaSwgZ3JvdXApO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0aGlzO1xufVxuIiwgImltcG9ydCBuYW1lc3BhY2UgZnJvbSBcIi4uL25hbWVzcGFjZS5qc1wiO1xuXG5mdW5jdGlvbiBhdHRyUmVtb3ZlKG5hbWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHRoaXMucmVtb3ZlQXR0cmlidXRlKG5hbWUpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBhdHRyUmVtb3ZlTlMoZnVsbG5hbWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHRoaXMucmVtb3ZlQXR0cmlidXRlTlMoZnVsbG5hbWUuc3BhY2UsIGZ1bGxuYW1lLmxvY2FsKTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gYXR0ckNvbnN0YW50KG5hbWUsIHZhbHVlKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnNldEF0dHJpYnV0ZShuYW1lLCB2YWx1ZSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGF0dHJDb25zdGFudE5TKGZ1bGxuYW1lLCB2YWx1ZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5zZXRBdHRyaWJ1dGVOUyhmdWxsbmFtZS5zcGFjZSwgZnVsbG5hbWUubG9jYWwsIHZhbHVlKTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gYXR0ckZ1bmN0aW9uKG5hbWUsIHZhbHVlKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgdiA9IHZhbHVlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgaWYgKHYgPT0gbnVsbCkgdGhpcy5yZW1vdmVBdHRyaWJ1dGUobmFtZSk7XG4gICAgZWxzZSB0aGlzLnNldEF0dHJpYnV0ZShuYW1lLCB2KTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gYXR0ckZ1bmN0aW9uTlMoZnVsbG5hbWUsIHZhbHVlKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgdiA9IHZhbHVlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgaWYgKHYgPT0gbnVsbCkgdGhpcy5yZW1vdmVBdHRyaWJ1dGVOUyhmdWxsbmFtZS5zcGFjZSwgZnVsbG5hbWUubG9jYWwpO1xuICAgIGVsc2UgdGhpcy5zZXRBdHRyaWJ1dGVOUyhmdWxsbmFtZS5zcGFjZSwgZnVsbG5hbWUubG9jYWwsIHYpO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihuYW1lLCB2YWx1ZSkge1xuICB2YXIgZnVsbG5hbWUgPSBuYW1lc3BhY2UobmFtZSk7XG5cbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPCAyKSB7XG4gICAgdmFyIG5vZGUgPSB0aGlzLm5vZGUoKTtcbiAgICByZXR1cm4gZnVsbG5hbWUubG9jYWxcbiAgICAgICAgPyBub2RlLmdldEF0dHJpYnV0ZU5TKGZ1bGxuYW1lLnNwYWNlLCBmdWxsbmFtZS5sb2NhbClcbiAgICAgICAgOiBub2RlLmdldEF0dHJpYnV0ZShmdWxsbmFtZSk7XG4gIH1cblxuICByZXR1cm4gdGhpcy5lYWNoKCh2YWx1ZSA9PSBudWxsXG4gICAgICA/IChmdWxsbmFtZS5sb2NhbCA/IGF0dHJSZW1vdmVOUyA6IGF0dHJSZW1vdmUpIDogKHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgICA/IChmdWxsbmFtZS5sb2NhbCA/IGF0dHJGdW5jdGlvbk5TIDogYXR0ckZ1bmN0aW9uKVxuICAgICAgOiAoZnVsbG5hbWUubG9jYWwgPyBhdHRyQ29uc3RhbnROUyA6IGF0dHJDb25zdGFudCkpKShmdWxsbmFtZSwgdmFsdWUpKTtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbihub2RlKSB7XG4gIHJldHVybiAobm9kZS5vd25lckRvY3VtZW50ICYmIG5vZGUub3duZXJEb2N1bWVudC5kZWZhdWx0VmlldykgLy8gbm9kZSBpcyBhIE5vZGVcbiAgICAgIHx8IChub2RlLmRvY3VtZW50ICYmIG5vZGUpIC8vIG5vZGUgaXMgYSBXaW5kb3dcbiAgICAgIHx8IG5vZGUuZGVmYXVsdFZpZXc7IC8vIG5vZGUgaXMgYSBEb2N1bWVudFxufVxuIiwgImltcG9ydCBkZWZhdWx0VmlldyBmcm9tIFwiLi4vd2luZG93LmpzXCI7XG5cbmZ1bmN0aW9uIHN0eWxlUmVtb3ZlKG5hbWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuc3R5bGUucmVtb3ZlUHJvcGVydHkobmFtZSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIHN0eWxlQ29uc3RhbnQobmFtZSwgdmFsdWUsIHByaW9yaXR5KSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnN0eWxlLnNldFByb3BlcnR5KG5hbWUsIHZhbHVlLCBwcmlvcml0eSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIHN0eWxlRnVuY3Rpb24obmFtZSwgdmFsdWUsIHByaW9yaXR5KSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgdiA9IHZhbHVlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgaWYgKHYgPT0gbnVsbCkgdGhpcy5zdHlsZS5yZW1vdmVQcm9wZXJ0eShuYW1lKTtcbiAgICBlbHNlIHRoaXMuc3R5bGUuc2V0UHJvcGVydHkobmFtZSwgdiwgcHJpb3JpdHkpO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihuYW1lLCB2YWx1ZSwgcHJpb3JpdHkpIHtcbiAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPiAxXG4gICAgICA/IHRoaXMuZWFjaCgodmFsdWUgPT0gbnVsbFxuICAgICAgICAgICAgPyBzdHlsZVJlbW92ZSA6IHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgICAgICAgICA/IHN0eWxlRnVuY3Rpb25cbiAgICAgICAgICAgIDogc3R5bGVDb25zdGFudCkobmFtZSwgdmFsdWUsIHByaW9yaXR5ID09IG51bGwgPyBcIlwiIDogcHJpb3JpdHkpKVxuICAgICAgOiBzdHlsZVZhbHVlKHRoaXMubm9kZSgpLCBuYW1lKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHN0eWxlVmFsdWUobm9kZSwgbmFtZSkge1xuICByZXR1cm4gbm9kZS5zdHlsZS5nZXRQcm9wZXJ0eVZhbHVlKG5hbWUpXG4gICAgICB8fCBkZWZhdWx0Vmlldyhub2RlKS5nZXRDb21wdXRlZFN0eWxlKG5vZGUsIG51bGwpLmdldFByb3BlcnR5VmFsdWUobmFtZSk7XG59XG4iLCAiZnVuY3Rpb24gcHJvcGVydHlSZW1vdmUobmFtZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgZGVsZXRlIHRoaXNbbmFtZV07XG4gIH07XG59XG5cbmZ1bmN0aW9uIHByb3BlcnR5Q29uc3RhbnQobmFtZSwgdmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHRoaXNbbmFtZV0gPSB2YWx1ZTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gcHJvcGVydHlGdW5jdGlvbihuYW1lLCB2YWx1ZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHYgPSB2YWx1ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIGlmICh2ID09IG51bGwpIGRlbGV0ZSB0aGlzW25hbWVdO1xuICAgIGVsc2UgdGhpc1tuYW1lXSA9IHY7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG5hbWUsIHZhbHVlKSB7XG4gIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID4gMVxuICAgICAgPyB0aGlzLmVhY2goKHZhbHVlID09IG51bGxcbiAgICAgICAgICA/IHByb3BlcnR5UmVtb3ZlIDogdHlwZW9mIHZhbHVlID09PSBcImZ1bmN0aW9uXCJcbiAgICAgICAgICA/IHByb3BlcnR5RnVuY3Rpb25cbiAgICAgICAgICA6IHByb3BlcnR5Q29uc3RhbnQpKG5hbWUsIHZhbHVlKSlcbiAgICAgIDogdGhpcy5ub2RlKClbbmFtZV07XG59XG4iLCAiZnVuY3Rpb24gY2xhc3NBcnJheShzdHJpbmcpIHtcbiAgcmV0dXJuIHN0cmluZy50cmltKCkuc3BsaXQoL158XFxzKy8pO1xufVxuXG5mdW5jdGlvbiBjbGFzc0xpc3Qobm9kZSkge1xuICByZXR1cm4gbm9kZS5jbGFzc0xpc3QgfHwgbmV3IENsYXNzTGlzdChub2RlKTtcbn1cblxuZnVuY3Rpb24gQ2xhc3NMaXN0KG5vZGUpIHtcbiAgdGhpcy5fbm9kZSA9IG5vZGU7XG4gIHRoaXMuX25hbWVzID0gY2xhc3NBcnJheShub2RlLmdldEF0dHJpYnV0ZShcImNsYXNzXCIpIHx8IFwiXCIpO1xufVxuXG5DbGFzc0xpc3QucHJvdG90eXBlID0ge1xuICBhZGQ6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICB2YXIgaSA9IHRoaXMuX25hbWVzLmluZGV4T2YobmFtZSk7XG4gICAgaWYgKGkgPCAwKSB7XG4gICAgICB0aGlzLl9uYW1lcy5wdXNoKG5hbWUpO1xuICAgICAgdGhpcy5fbm9kZS5zZXRBdHRyaWJ1dGUoXCJjbGFzc1wiLCB0aGlzLl9uYW1lcy5qb2luKFwiIFwiKSk7XG4gICAgfVxuICB9LFxuICByZW1vdmU6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICB2YXIgaSA9IHRoaXMuX25hbWVzLmluZGV4T2YobmFtZSk7XG4gICAgaWYgKGkgPj0gMCkge1xuICAgICAgdGhpcy5fbmFtZXMuc3BsaWNlKGksIDEpO1xuICAgICAgdGhpcy5fbm9kZS5zZXRBdHRyaWJ1dGUoXCJjbGFzc1wiLCB0aGlzLl9uYW1lcy5qb2luKFwiIFwiKSk7XG4gICAgfVxuICB9LFxuICBjb250YWluczogZnVuY3Rpb24obmFtZSkge1xuICAgIHJldHVybiB0aGlzLl9uYW1lcy5pbmRleE9mKG5hbWUpID49IDA7XG4gIH1cbn07XG5cbmZ1bmN0aW9uIGNsYXNzZWRBZGQobm9kZSwgbmFtZXMpIHtcbiAgdmFyIGxpc3QgPSBjbGFzc0xpc3Qobm9kZSksIGkgPSAtMSwgbiA9IG5hbWVzLmxlbmd0aDtcbiAgd2hpbGUgKCsraSA8IG4pIGxpc3QuYWRkKG5hbWVzW2ldKTtcbn1cblxuZnVuY3Rpb24gY2xhc3NlZFJlbW92ZShub2RlLCBuYW1lcykge1xuICB2YXIgbGlzdCA9IGNsYXNzTGlzdChub2RlKSwgaSA9IC0xLCBuID0gbmFtZXMubGVuZ3RoO1xuICB3aGlsZSAoKytpIDwgbikgbGlzdC5yZW1vdmUobmFtZXNbaV0pO1xufVxuXG5mdW5jdGlvbiBjbGFzc2VkVHJ1ZShuYW1lcykge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgY2xhc3NlZEFkZCh0aGlzLCBuYW1lcyk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGNsYXNzZWRGYWxzZShuYW1lcykge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgY2xhc3NlZFJlbW92ZSh0aGlzLCBuYW1lcyk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGNsYXNzZWRGdW5jdGlvbihuYW1lcywgdmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgICh2YWx1ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpID8gY2xhc3NlZEFkZCA6IGNsYXNzZWRSZW1vdmUpKHRoaXMsIG5hbWVzKTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSwgdmFsdWUpIHtcbiAgdmFyIG5hbWVzID0gY2xhc3NBcnJheShuYW1lICsgXCJcIik7XG5cbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPCAyKSB7XG4gICAgdmFyIGxpc3QgPSBjbGFzc0xpc3QodGhpcy5ub2RlKCkpLCBpID0gLTEsIG4gPSBuYW1lcy5sZW5ndGg7XG4gICAgd2hpbGUgKCsraSA8IG4pIGlmICghbGlzdC5jb250YWlucyhuYW1lc1tpXSkpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIHJldHVybiB0aGlzLmVhY2goKHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgICA/IGNsYXNzZWRGdW5jdGlvbiA6IHZhbHVlXG4gICAgICA/IGNsYXNzZWRUcnVlXG4gICAgICA6IGNsYXNzZWRGYWxzZSkobmFtZXMsIHZhbHVlKSk7XG59XG4iLCAiZnVuY3Rpb24gdGV4dFJlbW92ZSgpIHtcbiAgdGhpcy50ZXh0Q29udGVudCA9IFwiXCI7XG59XG5cbmZ1bmN0aW9uIHRleHRDb25zdGFudCh2YWx1ZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy50ZXh0Q29udGVudCA9IHZhbHVlO1xuICB9O1xufVxuXG5mdW5jdGlvbiB0ZXh0RnVuY3Rpb24odmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciB2ID0gdmFsdWUuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICB0aGlzLnRleHRDb250ZW50ID0gdiA9PSBudWxsID8gXCJcIiA6IHY7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHZhbHVlKSB7XG4gIHJldHVybiBhcmd1bWVudHMubGVuZ3RoXG4gICAgICA/IHRoaXMuZWFjaCh2YWx1ZSA9PSBudWxsXG4gICAgICAgICAgPyB0ZXh0UmVtb3ZlIDogKHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgICAgICAgPyB0ZXh0RnVuY3Rpb25cbiAgICAgICAgICA6IHRleHRDb25zdGFudCkodmFsdWUpKVxuICAgICAgOiB0aGlzLm5vZGUoKS50ZXh0Q29udGVudDtcbn1cbiIsICJmdW5jdGlvbiBodG1sUmVtb3ZlKCkge1xuICB0aGlzLmlubmVySFRNTCA9IFwiXCI7XG59XG5cbmZ1bmN0aW9uIGh0bWxDb25zdGFudCh2YWx1ZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5pbm5lckhUTUwgPSB2YWx1ZTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gaHRtbEZ1bmN0aW9uKHZhbHVlKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgdiA9IHZhbHVlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgdGhpcy5pbm5lckhUTUwgPSB2ID09IG51bGwgPyBcIlwiIDogdjtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24odmFsdWUpIHtcbiAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGhcbiAgICAgID8gdGhpcy5lYWNoKHZhbHVlID09IG51bGxcbiAgICAgICAgICA/IGh0bWxSZW1vdmUgOiAodHlwZW9mIHZhbHVlID09PSBcImZ1bmN0aW9uXCJcbiAgICAgICAgICA/IGh0bWxGdW5jdGlvblxuICAgICAgICAgIDogaHRtbENvbnN0YW50KSh2YWx1ZSkpXG4gICAgICA6IHRoaXMubm9kZSgpLmlubmVySFRNTDtcbn1cbiIsICJmdW5jdGlvbiByYWlzZSgpIHtcbiAgaWYgKHRoaXMubmV4dFNpYmxpbmcpIHRoaXMucGFyZW50Tm9kZS5hcHBlbmRDaGlsZCh0aGlzKTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLmVhY2gocmFpc2UpO1xufVxuIiwgImZ1bmN0aW9uIGxvd2VyKCkge1xuICBpZiAodGhpcy5wcmV2aW91c1NpYmxpbmcpIHRoaXMucGFyZW50Tm9kZS5pbnNlcnRCZWZvcmUodGhpcywgdGhpcy5wYXJlbnROb2RlLmZpcnN0Q2hpbGQpO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuZWFjaChsb3dlcik7XG59XG4iLCAiaW1wb3J0IGNyZWF0b3IgZnJvbSBcIi4uL2NyZWF0b3IuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSkge1xuICB2YXIgY3JlYXRlID0gdHlwZW9mIG5hbWUgPT09IFwiZnVuY3Rpb25cIiA/IG5hbWUgOiBjcmVhdG9yKG5hbWUpO1xuICByZXR1cm4gdGhpcy5zZWxlY3QoZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuYXBwZW5kQ2hpbGQoY3JlYXRlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykpO1xuICB9KTtcbn1cbiIsICJpbXBvcnQgY3JlYXRvciBmcm9tIFwiLi4vY3JlYXRvci5qc1wiO1xuaW1wb3J0IHNlbGVjdG9yIGZyb20gXCIuLi9zZWxlY3Rvci5qc1wiO1xuXG5mdW5jdGlvbiBjb25zdGFudE51bGwoKSB7XG4gIHJldHVybiBudWxsO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihuYW1lLCBiZWZvcmUpIHtcbiAgdmFyIGNyZWF0ZSA9IHR5cGVvZiBuYW1lID09PSBcImZ1bmN0aW9uXCIgPyBuYW1lIDogY3JlYXRvcihuYW1lKSxcbiAgICAgIHNlbGVjdCA9IGJlZm9yZSA9PSBudWxsID8gY29uc3RhbnROdWxsIDogdHlwZW9mIGJlZm9yZSA9PT0gXCJmdW5jdGlvblwiID8gYmVmb3JlIDogc2VsZWN0b3IoYmVmb3JlKTtcbiAgcmV0dXJuIHRoaXMuc2VsZWN0KGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLmluc2VydEJlZm9yZShjcmVhdGUuYXBwbHkodGhpcywgYXJndW1lbnRzKSwgc2VsZWN0LmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgfHwgbnVsbCk7XG4gIH0pO1xufVxuIiwgImZ1bmN0aW9uIHJlbW92ZSgpIHtcbiAgdmFyIHBhcmVudCA9IHRoaXMucGFyZW50Tm9kZTtcbiAgaWYgKHBhcmVudCkgcGFyZW50LnJlbW92ZUNoaWxkKHRoaXMpO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuZWFjaChyZW1vdmUpO1xufVxuIiwgImZ1bmN0aW9uIHNlbGVjdGlvbl9jbG9uZVNoYWxsb3coKSB7XG4gIHZhciBjbG9uZSA9IHRoaXMuY2xvbmVOb2RlKGZhbHNlKSwgcGFyZW50ID0gdGhpcy5wYXJlbnROb2RlO1xuICByZXR1cm4gcGFyZW50ID8gcGFyZW50Lmluc2VydEJlZm9yZShjbG9uZSwgdGhpcy5uZXh0U2libGluZykgOiBjbG9uZTtcbn1cblxuZnVuY3Rpb24gc2VsZWN0aW9uX2Nsb25lRGVlcCgpIHtcbiAgdmFyIGNsb25lID0gdGhpcy5jbG9uZU5vZGUodHJ1ZSksIHBhcmVudCA9IHRoaXMucGFyZW50Tm9kZTtcbiAgcmV0dXJuIHBhcmVudCA/IHBhcmVudC5pbnNlcnRCZWZvcmUoY2xvbmUsIHRoaXMubmV4dFNpYmxpbmcpIDogY2xvbmU7XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGRlZXApIHtcbiAgcmV0dXJuIHRoaXMuc2VsZWN0KGRlZXAgPyBzZWxlY3Rpb25fY2xvbmVEZWVwIDogc2VsZWN0aW9uX2Nsb25lU2hhbGxvdyk7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24odmFsdWUpIHtcbiAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGhcbiAgICAgID8gdGhpcy5wcm9wZXJ0eShcIl9fZGF0YV9fXCIsIHZhbHVlKVxuICAgICAgOiB0aGlzLm5vZGUoKS5fX2RhdGFfXztcbn1cbiIsICJmdW5jdGlvbiBjb250ZXh0TGlzdGVuZXIobGlzdGVuZXIpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgbGlzdGVuZXIuY2FsbCh0aGlzLCBldmVudCwgdGhpcy5fX2RhdGFfXyk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIHBhcnNlVHlwZW5hbWVzKHR5cGVuYW1lcykge1xuICByZXR1cm4gdHlwZW5hbWVzLnRyaW0oKS5zcGxpdCgvXnxcXHMrLykubWFwKGZ1bmN0aW9uKHQpIHtcbiAgICB2YXIgbmFtZSA9IFwiXCIsIGkgPSB0LmluZGV4T2YoXCIuXCIpO1xuICAgIGlmIChpID49IDApIG5hbWUgPSB0LnNsaWNlKGkgKyAxKSwgdCA9IHQuc2xpY2UoMCwgaSk7XG4gICAgcmV0dXJuIHt0eXBlOiB0LCBuYW1lOiBuYW1lfTtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIG9uUmVtb3ZlKHR5cGVuYW1lKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgb24gPSB0aGlzLl9fb247XG4gICAgaWYgKCFvbikgcmV0dXJuO1xuICAgIGZvciAodmFyIGogPSAwLCBpID0gLTEsIG0gPSBvbi5sZW5ndGgsIG87IGogPCBtOyArK2opIHtcbiAgICAgIGlmIChvID0gb25bal0sICghdHlwZW5hbWUudHlwZSB8fCBvLnR5cGUgPT09IHR5cGVuYW1lLnR5cGUpICYmIG8ubmFtZSA9PT0gdHlwZW5hbWUubmFtZSkge1xuICAgICAgICB0aGlzLnJlbW92ZUV2ZW50TGlzdGVuZXIoby50eXBlLCBvLmxpc3RlbmVyLCBvLm9wdGlvbnMpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgb25bKytpXSA9IG87XG4gICAgICB9XG4gICAgfVxuICAgIGlmICgrK2kpIG9uLmxlbmd0aCA9IGk7XG4gICAgZWxzZSBkZWxldGUgdGhpcy5fX29uO1xuICB9O1xufVxuXG5mdW5jdGlvbiBvbkFkZCh0eXBlbmFtZSwgdmFsdWUsIG9wdGlvbnMpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBvbiA9IHRoaXMuX19vbiwgbywgbGlzdGVuZXIgPSBjb250ZXh0TGlzdGVuZXIodmFsdWUpO1xuICAgIGlmIChvbikgZm9yICh2YXIgaiA9IDAsIG0gPSBvbi5sZW5ndGg7IGogPCBtOyArK2opIHtcbiAgICAgIGlmICgobyA9IG9uW2pdKS50eXBlID09PSB0eXBlbmFtZS50eXBlICYmIG8ubmFtZSA9PT0gdHlwZW5hbWUubmFtZSkge1xuICAgICAgICB0aGlzLnJlbW92ZUV2ZW50TGlzdGVuZXIoby50eXBlLCBvLmxpc3RlbmVyLCBvLm9wdGlvbnMpO1xuICAgICAgICB0aGlzLmFkZEV2ZW50TGlzdGVuZXIoby50eXBlLCBvLmxpc3RlbmVyID0gbGlzdGVuZXIsIG8ub3B0aW9ucyA9IG9wdGlvbnMpO1xuICAgICAgICBvLnZhbHVlID0gdmFsdWU7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5hZGRFdmVudExpc3RlbmVyKHR5cGVuYW1lLnR5cGUsIGxpc3RlbmVyLCBvcHRpb25zKTtcbiAgICBvID0ge3R5cGU6IHR5cGVuYW1lLnR5cGUsIG5hbWU6IHR5cGVuYW1lLm5hbWUsIHZhbHVlOiB2YWx1ZSwgbGlzdGVuZXI6IGxpc3RlbmVyLCBvcHRpb25zOiBvcHRpb25zfTtcbiAgICBpZiAoIW9uKSB0aGlzLl9fb24gPSBbb107XG4gICAgZWxzZSBvbi5wdXNoKG8pO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih0eXBlbmFtZSwgdmFsdWUsIG9wdGlvbnMpIHtcbiAgdmFyIHR5cGVuYW1lcyA9IHBhcnNlVHlwZW5hbWVzKHR5cGVuYW1lICsgXCJcIiksIGksIG4gPSB0eXBlbmFtZXMubGVuZ3RoLCB0O1xuXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoIDwgMikge1xuICAgIHZhciBvbiA9IHRoaXMubm9kZSgpLl9fb247XG4gICAgaWYgKG9uKSBmb3IgKHZhciBqID0gMCwgbSA9IG9uLmxlbmd0aCwgbzsgaiA8IG07ICsraikge1xuICAgICAgZm9yIChpID0gMCwgbyA9IG9uW2pdOyBpIDwgbjsgKytpKSB7XG4gICAgICAgIGlmICgodCA9IHR5cGVuYW1lc1tpXSkudHlwZSA9PT0gby50eXBlICYmIHQubmFtZSA9PT0gby5uYW1lKSB7XG4gICAgICAgICAgcmV0dXJuIG8udmFsdWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgb24gPSB2YWx1ZSA/IG9uQWRkIDogb25SZW1vdmU7XG4gIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHRoaXMuZWFjaChvbih0eXBlbmFtZXNbaV0sIHZhbHVlLCBvcHRpb25zKSk7XG4gIHJldHVybiB0aGlzO1xufVxuIiwgImltcG9ydCBkZWZhdWx0VmlldyBmcm9tIFwiLi4vd2luZG93LmpzXCI7XG5cbmZ1bmN0aW9uIGRpc3BhdGNoRXZlbnQobm9kZSwgdHlwZSwgcGFyYW1zKSB7XG4gIHZhciB3aW5kb3cgPSBkZWZhdWx0Vmlldyhub2RlKSxcbiAgICAgIGV2ZW50ID0gd2luZG93LkN1c3RvbUV2ZW50O1xuXG4gIGlmICh0eXBlb2YgZXZlbnQgPT09IFwiZnVuY3Rpb25cIikge1xuICAgIGV2ZW50ID0gbmV3IGV2ZW50KHR5cGUsIHBhcmFtcyk7XG4gIH0gZWxzZSB7XG4gICAgZXZlbnQgPSB3aW5kb3cuZG9jdW1lbnQuY3JlYXRlRXZlbnQoXCJFdmVudFwiKTtcbiAgICBpZiAocGFyYW1zKSBldmVudC5pbml0RXZlbnQodHlwZSwgcGFyYW1zLmJ1YmJsZXMsIHBhcmFtcy5jYW5jZWxhYmxlKSwgZXZlbnQuZGV0YWlsID0gcGFyYW1zLmRldGFpbDtcbiAgICBlbHNlIGV2ZW50LmluaXRFdmVudCh0eXBlLCBmYWxzZSwgZmFsc2UpO1xuICB9XG5cbiAgbm9kZS5kaXNwYXRjaEV2ZW50KGV2ZW50KTtcbn1cblxuZnVuY3Rpb24gZGlzcGF0Y2hDb25zdGFudCh0eXBlLCBwYXJhbXMpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBkaXNwYXRjaEV2ZW50KHRoaXMsIHR5cGUsIHBhcmFtcyk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGRpc3BhdGNoRnVuY3Rpb24odHlwZSwgcGFyYW1zKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gZGlzcGF0Y2hFdmVudCh0aGlzLCB0eXBlLCBwYXJhbXMuYXBwbHkodGhpcywgYXJndW1lbnRzKSk7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHR5cGUsIHBhcmFtcykge1xuICByZXR1cm4gdGhpcy5lYWNoKCh0eXBlb2YgcGFyYW1zID09PSBcImZ1bmN0aW9uXCJcbiAgICAgID8gZGlzcGF0Y2hGdW5jdGlvblxuICAgICAgOiBkaXNwYXRjaENvbnN0YW50KSh0eXBlLCBwYXJhbXMpKTtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbiooKSB7XG4gIGZvciAodmFyIGdyb3VwcyA9IHRoaXMuX2dyb3VwcywgaiA9IDAsIG0gPSBncm91cHMubGVuZ3RoOyBqIDwgbTsgKytqKSB7XG4gICAgZm9yICh2YXIgZ3JvdXAgPSBncm91cHNbal0sIGkgPSAwLCBuID0gZ3JvdXAubGVuZ3RoLCBub2RlOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAobm9kZSA9IGdyb3VwW2ldKSB5aWVsZCBub2RlO1xuICAgIH1cbiAgfVxufVxuIiwgImltcG9ydCBzZWxlY3Rpb25fc2VsZWN0IGZyb20gXCIuL3NlbGVjdC5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9zZWxlY3RBbGwgZnJvbSBcIi4vc2VsZWN0QWxsLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX3NlbGVjdENoaWxkIGZyb20gXCIuL3NlbGVjdENoaWxkLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX3NlbGVjdENoaWxkcmVuIGZyb20gXCIuL3NlbGVjdENoaWxkcmVuLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2ZpbHRlciBmcm9tIFwiLi9maWx0ZXIuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fZGF0YSBmcm9tIFwiLi9kYXRhLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2VudGVyIGZyb20gXCIuL2VudGVyLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2V4aXQgZnJvbSBcIi4vZXhpdC5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9qb2luIGZyb20gXCIuL2pvaW4uanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fbWVyZ2UgZnJvbSBcIi4vbWVyZ2UuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fb3JkZXIgZnJvbSBcIi4vb3JkZXIuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fc29ydCBmcm9tIFwiLi9zb3J0LmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2NhbGwgZnJvbSBcIi4vY2FsbC5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9ub2RlcyBmcm9tIFwiLi9ub2Rlcy5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9ub2RlIGZyb20gXCIuL25vZGUuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fc2l6ZSBmcm9tIFwiLi9zaXplLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2VtcHR5IGZyb20gXCIuL2VtcHR5LmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2VhY2ggZnJvbSBcIi4vZWFjaC5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9hdHRyIGZyb20gXCIuL2F0dHIuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fc3R5bGUgZnJvbSBcIi4vc3R5bGUuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fcHJvcGVydHkgZnJvbSBcIi4vcHJvcGVydHkuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fY2xhc3NlZCBmcm9tIFwiLi9jbGFzc2VkLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX3RleHQgZnJvbSBcIi4vdGV4dC5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9odG1sIGZyb20gXCIuL2h0bWwuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fcmFpc2UgZnJvbSBcIi4vcmFpc2UuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fbG93ZXIgZnJvbSBcIi4vbG93ZXIuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fYXBwZW5kIGZyb20gXCIuL2FwcGVuZC5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9pbnNlcnQgZnJvbSBcIi4vaW5zZXJ0LmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX3JlbW92ZSBmcm9tIFwiLi9yZW1vdmUuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fY2xvbmUgZnJvbSBcIi4vY2xvbmUuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fZGF0dW0gZnJvbSBcIi4vZGF0dW0uanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fb24gZnJvbSBcIi4vb24uanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fZGlzcGF0Y2ggZnJvbSBcIi4vZGlzcGF0Y2guanNcIjtcbmltcG9ydCBzZWxlY3Rpb25faXRlcmF0b3IgZnJvbSBcIi4vaXRlcmF0b3IuanNcIjtcblxuZXhwb3J0IHZhciByb290ID0gW251bGxdO1xuXG5leHBvcnQgZnVuY3Rpb24gU2VsZWN0aW9uKGdyb3VwcywgcGFyZW50cykge1xuICB0aGlzLl9ncm91cHMgPSBncm91cHM7XG4gIHRoaXMuX3BhcmVudHMgPSBwYXJlbnRzO1xufVxuXG5mdW5jdGlvbiBzZWxlY3Rpb24oKSB7XG4gIHJldHVybiBuZXcgU2VsZWN0aW9uKFtbZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50XV0sIHJvb3QpO1xufVxuXG5mdW5jdGlvbiBzZWxlY3Rpb25fc2VsZWN0aW9uKCkge1xuICByZXR1cm4gdGhpcztcbn1cblxuU2VsZWN0aW9uLnByb3RvdHlwZSA9IHNlbGVjdGlvbi5wcm90b3R5cGUgPSB7XG4gIGNvbnN0cnVjdG9yOiBTZWxlY3Rpb24sXG4gIHNlbGVjdDogc2VsZWN0aW9uX3NlbGVjdCxcbiAgc2VsZWN0QWxsOiBzZWxlY3Rpb25fc2VsZWN0QWxsLFxuICBzZWxlY3RDaGlsZDogc2VsZWN0aW9uX3NlbGVjdENoaWxkLFxuICBzZWxlY3RDaGlsZHJlbjogc2VsZWN0aW9uX3NlbGVjdENoaWxkcmVuLFxuICBmaWx0ZXI6IHNlbGVjdGlvbl9maWx0ZXIsXG4gIGRhdGE6IHNlbGVjdGlvbl9kYXRhLFxuICBlbnRlcjogc2VsZWN0aW9uX2VudGVyLFxuICBleGl0OiBzZWxlY3Rpb25fZXhpdCxcbiAgam9pbjogc2VsZWN0aW9uX2pvaW4sXG4gIG1lcmdlOiBzZWxlY3Rpb25fbWVyZ2UsXG4gIHNlbGVjdGlvbjogc2VsZWN0aW9uX3NlbGVjdGlvbixcbiAgb3JkZXI6IHNlbGVjdGlvbl9vcmRlcixcbiAgc29ydDogc2VsZWN0aW9uX3NvcnQsXG4gIGNhbGw6IHNlbGVjdGlvbl9jYWxsLFxuICBub2Rlczogc2VsZWN0aW9uX25vZGVzLFxuICBub2RlOiBzZWxlY3Rpb25fbm9kZSxcbiAgc2l6ZTogc2VsZWN0aW9uX3NpemUsXG4gIGVtcHR5OiBzZWxlY3Rpb25fZW1wdHksXG4gIGVhY2g6IHNlbGVjdGlvbl9lYWNoLFxuICBhdHRyOiBzZWxlY3Rpb25fYXR0cixcbiAgc3R5bGU6IHNlbGVjdGlvbl9zdHlsZSxcbiAgcHJvcGVydHk6IHNlbGVjdGlvbl9wcm9wZXJ0eSxcbiAgY2xhc3NlZDogc2VsZWN0aW9uX2NsYXNzZWQsXG4gIHRleHQ6IHNlbGVjdGlvbl90ZXh0LFxuICBodG1sOiBzZWxlY3Rpb25faHRtbCxcbiAgcmFpc2U6IHNlbGVjdGlvbl9yYWlzZSxcbiAgbG93ZXI6IHNlbGVjdGlvbl9sb3dlcixcbiAgYXBwZW5kOiBzZWxlY3Rpb25fYXBwZW5kLFxuICBpbnNlcnQ6IHNlbGVjdGlvbl9pbnNlcnQsXG4gIHJlbW92ZTogc2VsZWN0aW9uX3JlbW92ZSxcbiAgY2xvbmU6IHNlbGVjdGlvbl9jbG9uZSxcbiAgZGF0dW06IHNlbGVjdGlvbl9kYXR1bSxcbiAgb246IHNlbGVjdGlvbl9vbixcbiAgZGlzcGF0Y2g6IHNlbGVjdGlvbl9kaXNwYXRjaCxcbiAgW1N5bWJvbC5pdGVyYXRvcl06IHNlbGVjdGlvbl9pdGVyYXRvclxufTtcblxuZXhwb3J0IGRlZmF1bHQgc2VsZWN0aW9uO1xuIiwgImltcG9ydCB7U2VsZWN0aW9uLCByb290fSBmcm9tIFwiLi9zZWxlY3Rpb24vaW5kZXguanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oc2VsZWN0b3IpIHtcbiAgcmV0dXJuIHR5cGVvZiBzZWxlY3RvciA9PT0gXCJzdHJpbmdcIlxuICAgICAgPyBuZXcgU2VsZWN0aW9uKFtbZG9jdW1lbnQucXVlcnlTZWxlY3RvcihzZWxlY3RvcildXSwgW2RvY3VtZW50LmRvY3VtZW50RWxlbWVudF0pXG4gICAgICA6IG5ldyBTZWxlY3Rpb24oW1tzZWxlY3Rvcl1dLCByb290KTtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbihldmVudCkge1xuICBsZXQgc291cmNlRXZlbnQ7XG4gIHdoaWxlIChzb3VyY2VFdmVudCA9IGV2ZW50LnNvdXJjZUV2ZW50KSBldmVudCA9IHNvdXJjZUV2ZW50O1xuICByZXR1cm4gZXZlbnQ7XG59XG4iLCAiaW1wb3J0IHNvdXJjZUV2ZW50IGZyb20gXCIuL3NvdXJjZUV2ZW50LmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGV2ZW50LCBub2RlKSB7XG4gIGV2ZW50ID0gc291cmNlRXZlbnQoZXZlbnQpO1xuICBpZiAobm9kZSA9PT0gdW5kZWZpbmVkKSBub2RlID0gZXZlbnQuY3VycmVudFRhcmdldDtcbiAgaWYgKG5vZGUpIHtcbiAgICB2YXIgc3ZnID0gbm9kZS5vd25lclNWR0VsZW1lbnQgfHwgbm9kZTtcbiAgICBpZiAoc3ZnLmNyZWF0ZVNWR1BvaW50KSB7XG4gICAgICB2YXIgcG9pbnQgPSBzdmcuY3JlYXRlU1ZHUG9pbnQoKTtcbiAgICAgIHBvaW50LnggPSBldmVudC5jbGllbnRYLCBwb2ludC55ID0gZXZlbnQuY2xpZW50WTtcbiAgICAgIHBvaW50ID0gcG9pbnQubWF0cml4VHJhbnNmb3JtKG5vZGUuZ2V0U2NyZWVuQ1RNKCkuaW52ZXJzZSgpKTtcbiAgICAgIHJldHVybiBbcG9pbnQueCwgcG9pbnQueV07XG4gICAgfVxuICAgIGlmIChub2RlLmdldEJvdW5kaW5nQ2xpZW50UmVjdCkge1xuICAgICAgdmFyIHJlY3QgPSBub2RlLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgcmV0dXJuIFtldmVudC5jbGllbnRYIC0gcmVjdC5sZWZ0IC0gbm9kZS5jbGllbnRMZWZ0LCBldmVudC5jbGllbnRZIC0gcmVjdC50b3AgLSBub2RlLmNsaWVudFRvcF07XG4gICAgfVxuICB9XG4gIHJldHVybiBbZXZlbnQucGFnZVgsIGV2ZW50LnBhZ2VZXTtcbn1cbiIsICIvLyBUaGVzZSBhcmUgdHlwaWNhbGx5IHVzZWQgaW4gY29uanVuY3Rpb24gd2l0aCBub2V2ZW50IHRvIGVuc3VyZSB0aGF0IHdlIGNhblxuLy8gcHJldmVudERlZmF1bHQgb24gdGhlIGV2ZW50LlxuZXhwb3J0IGNvbnN0IG5vbnBhc3NpdmUgPSB7cGFzc2l2ZTogZmFsc2V9O1xuZXhwb3J0IGNvbnN0IG5vbnBhc3NpdmVjYXB0dXJlID0ge2NhcHR1cmU6IHRydWUsIHBhc3NpdmU6IGZhbHNlfTtcblxuZXhwb3J0IGZ1bmN0aW9uIG5vcHJvcGFnYXRpb24oZXZlbnQpIHtcbiAgZXZlbnQuc3RvcEltbWVkaWF0ZVByb3BhZ2F0aW9uKCk7XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGV2ZW50KSB7XG4gIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gIGV2ZW50LnN0b3BJbW1lZGlhdGVQcm9wYWdhdGlvbigpO1xufVxuIiwgImltcG9ydCB7c2VsZWN0fSBmcm9tIFwiZDMtc2VsZWN0aW9uXCI7XG5pbXBvcnQgbm9ldmVudCwge25vbnBhc3NpdmVjYXB0dXJlfSBmcm9tIFwiLi9ub2V2ZW50LmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHZpZXcpIHtcbiAgdmFyIHJvb3QgPSB2aWV3LmRvY3VtZW50LmRvY3VtZW50RWxlbWVudCxcbiAgICAgIHNlbGVjdGlvbiA9IHNlbGVjdCh2aWV3KS5vbihcImRyYWdzdGFydC5kcmFnXCIsIG5vZXZlbnQsIG5vbnBhc3NpdmVjYXB0dXJlKTtcbiAgaWYgKFwib25zZWxlY3RzdGFydFwiIGluIHJvb3QpIHtcbiAgICBzZWxlY3Rpb24ub24oXCJzZWxlY3RzdGFydC5kcmFnXCIsIG5vZXZlbnQsIG5vbnBhc3NpdmVjYXB0dXJlKTtcbiAgfSBlbHNlIHtcbiAgICByb290Ll9fbm9zZWxlY3QgPSByb290LnN0eWxlLk1velVzZXJTZWxlY3Q7XG4gICAgcm9vdC5zdHlsZS5Nb3pVc2VyU2VsZWN0ID0gXCJub25lXCI7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHllc2RyYWcodmlldywgbm9jbGljaykge1xuICB2YXIgcm9vdCA9IHZpZXcuZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LFxuICAgICAgc2VsZWN0aW9uID0gc2VsZWN0KHZpZXcpLm9uKFwiZHJhZ3N0YXJ0LmRyYWdcIiwgbnVsbCk7XG4gIGlmIChub2NsaWNrKSB7XG4gICAgc2VsZWN0aW9uLm9uKFwiY2xpY2suZHJhZ1wiLCBub2V2ZW50LCBub25wYXNzaXZlY2FwdHVyZSk7XG4gICAgc2V0VGltZW91dChmdW5jdGlvbigpIHsgc2VsZWN0aW9uLm9uKFwiY2xpY2suZHJhZ1wiLCBudWxsKTsgfSwgMCk7XG4gIH1cbiAgaWYgKFwib25zZWxlY3RzdGFydFwiIGluIHJvb3QpIHtcbiAgICBzZWxlY3Rpb24ub24oXCJzZWxlY3RzdGFydC5kcmFnXCIsIG51bGwpO1xuICB9IGVsc2Uge1xuICAgIHJvb3Quc3R5bGUuTW96VXNlclNlbGVjdCA9IHJvb3QuX19ub3NlbGVjdDtcbiAgICBkZWxldGUgcm9vdC5fX25vc2VsZWN0O1xuICB9XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oY29uc3RydWN0b3IsIGZhY3RvcnksIHByb3RvdHlwZSkge1xuICBjb25zdHJ1Y3Rvci5wcm90b3R5cGUgPSBmYWN0b3J5LnByb3RvdHlwZSA9IHByb3RvdHlwZTtcbiAgcHJvdG90eXBlLmNvbnN0cnVjdG9yID0gY29uc3RydWN0b3I7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBleHRlbmQocGFyZW50LCBkZWZpbml0aW9uKSB7XG4gIHZhciBwcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKHBhcmVudC5wcm90b3R5cGUpO1xuICBmb3IgKHZhciBrZXkgaW4gZGVmaW5pdGlvbikgcHJvdG90eXBlW2tleV0gPSBkZWZpbml0aW9uW2tleV07XG4gIHJldHVybiBwcm90b3R5cGU7XG59XG4iLCAiaW1wb3J0IGRlZmluZSwge2V4dGVuZH0gZnJvbSBcIi4vZGVmaW5lLmpzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiBDb2xvcigpIHt9XG5cbmV4cG9ydCB2YXIgZGFya2VyID0gMC43O1xuZXhwb3J0IHZhciBicmlnaHRlciA9IDEgLyBkYXJrZXI7XG5cbnZhciByZUkgPSBcIlxcXFxzKihbKy1dP1xcXFxkKylcXFxccypcIixcbiAgICByZU4gPSBcIlxcXFxzKihbKy1dPyg/OlxcXFxkKlxcXFwuKT9cXFxcZCsoPzpbZUVdWystXT9cXFxcZCspPylcXFxccypcIixcbiAgICByZVAgPSBcIlxcXFxzKihbKy1dPyg/OlxcXFxkKlxcXFwuKT9cXFxcZCsoPzpbZUVdWystXT9cXFxcZCspPyklXFxcXHMqXCIsXG4gICAgcmVIZXggPSAvXiMoWzAtOWEtZl17Myw4fSkkLyxcbiAgICByZVJnYkludGVnZXIgPSBuZXcgUmVnRXhwKGBecmdiXFxcXCgke3JlSX0sJHtyZUl9LCR7cmVJfVxcXFwpJGApLFxuICAgIHJlUmdiUGVyY2VudCA9IG5ldyBSZWdFeHAoYF5yZ2JcXFxcKCR7cmVQfSwke3JlUH0sJHtyZVB9XFxcXCkkYCksXG4gICAgcmVSZ2JhSW50ZWdlciA9IG5ldyBSZWdFeHAoYF5yZ2JhXFxcXCgke3JlSX0sJHtyZUl9LCR7cmVJfSwke3JlTn1cXFxcKSRgKSxcbiAgICByZVJnYmFQZXJjZW50ID0gbmV3IFJlZ0V4cChgXnJnYmFcXFxcKCR7cmVQfSwke3JlUH0sJHtyZVB9LCR7cmVOfVxcXFwpJGApLFxuICAgIHJlSHNsUGVyY2VudCA9IG5ldyBSZWdFeHAoYF5oc2xcXFxcKCR7cmVOfSwke3JlUH0sJHtyZVB9XFxcXCkkYCksXG4gICAgcmVIc2xhUGVyY2VudCA9IG5ldyBSZWdFeHAoYF5oc2xhXFxcXCgke3JlTn0sJHtyZVB9LCR7cmVQfSwke3JlTn1cXFxcKSRgKTtcblxudmFyIG5hbWVkID0ge1xuICBhbGljZWJsdWU6IDB4ZjBmOGZmLFxuICBhbnRpcXVld2hpdGU6IDB4ZmFlYmQ3LFxuICBhcXVhOiAweDAwZmZmZixcbiAgYXF1YW1hcmluZTogMHg3ZmZmZDQsXG4gIGF6dXJlOiAweGYwZmZmZixcbiAgYmVpZ2U6IDB4ZjVmNWRjLFxuICBiaXNxdWU6IDB4ZmZlNGM0LFxuICBibGFjazogMHgwMDAwMDAsXG4gIGJsYW5jaGVkYWxtb25kOiAweGZmZWJjZCxcbiAgYmx1ZTogMHgwMDAwZmYsXG4gIGJsdWV2aW9sZXQ6IDB4OGEyYmUyLFxuICBicm93bjogMHhhNTJhMmEsXG4gIGJ1cmx5d29vZDogMHhkZWI4ODcsXG4gIGNhZGV0Ymx1ZTogMHg1ZjllYTAsXG4gIGNoYXJ0cmV1c2U6IDB4N2ZmZjAwLFxuICBjaG9jb2xhdGU6IDB4ZDI2OTFlLFxuICBjb3JhbDogMHhmZjdmNTAsXG4gIGNvcm5mbG93ZXJibHVlOiAweDY0OTVlZCxcbiAgY29ybnNpbGs6IDB4ZmZmOGRjLFxuICBjcmltc29uOiAweGRjMTQzYyxcbiAgY3lhbjogMHgwMGZmZmYsXG4gIGRhcmtibHVlOiAweDAwMDA4YixcbiAgZGFya2N5YW46IDB4MDA4YjhiLFxuICBkYXJrZ29sZGVucm9kOiAweGI4ODYwYixcbiAgZGFya2dyYXk6IDB4YTlhOWE5LFxuICBkYXJrZ3JlZW46IDB4MDA2NDAwLFxuICBkYXJrZ3JleTogMHhhOWE5YTksXG4gIGRhcmtraGFraTogMHhiZGI3NmIsXG4gIGRhcmttYWdlbnRhOiAweDhiMDA4YixcbiAgZGFya29saXZlZ3JlZW46IDB4NTU2YjJmLFxuICBkYXJrb3JhbmdlOiAweGZmOGMwMCxcbiAgZGFya29yY2hpZDogMHg5OTMyY2MsXG4gIGRhcmtyZWQ6IDB4OGIwMDAwLFxuICBkYXJrc2FsbW9uOiAweGU5OTY3YSxcbiAgZGFya3NlYWdyZWVuOiAweDhmYmM4ZixcbiAgZGFya3NsYXRlYmx1ZTogMHg0ODNkOGIsXG4gIGRhcmtzbGF0ZWdyYXk6IDB4MmY0ZjRmLFxuICBkYXJrc2xhdGVncmV5OiAweDJmNGY0ZixcbiAgZGFya3R1cnF1b2lzZTogMHgwMGNlZDEsXG4gIGRhcmt2aW9sZXQ6IDB4OTQwMGQzLFxuICBkZWVwcGluazogMHhmZjE0OTMsXG4gIGRlZXBza3libHVlOiAweDAwYmZmZixcbiAgZGltZ3JheTogMHg2OTY5NjksXG4gIGRpbWdyZXk6IDB4Njk2OTY5LFxuICBkb2RnZXJibHVlOiAweDFlOTBmZixcbiAgZmlyZWJyaWNrOiAweGIyMjIyMixcbiAgZmxvcmFsd2hpdGU6IDB4ZmZmYWYwLFxuICBmb3Jlc3RncmVlbjogMHgyMjhiMjIsXG4gIGZ1Y2hzaWE6IDB4ZmYwMGZmLFxuICBnYWluc2Jvcm86IDB4ZGNkY2RjLFxuICBnaG9zdHdoaXRlOiAweGY4ZjhmZixcbiAgZ29sZDogMHhmZmQ3MDAsXG4gIGdvbGRlbnJvZDogMHhkYWE1MjAsXG4gIGdyYXk6IDB4ODA4MDgwLFxuICBncmVlbjogMHgwMDgwMDAsXG4gIGdyZWVueWVsbG93OiAweGFkZmYyZixcbiAgZ3JleTogMHg4MDgwODAsXG4gIGhvbmV5ZGV3OiAweGYwZmZmMCxcbiAgaG90cGluazogMHhmZjY5YjQsXG4gIGluZGlhbnJlZDogMHhjZDVjNWMsXG4gIGluZGlnbzogMHg0YjAwODIsXG4gIGl2b3J5OiAweGZmZmZmMCxcbiAga2hha2k6IDB4ZjBlNjhjLFxuICBsYXZlbmRlcjogMHhlNmU2ZmEsXG4gIGxhdmVuZGVyYmx1c2g6IDB4ZmZmMGY1LFxuICBsYXduZ3JlZW46IDB4N2NmYzAwLFxuICBsZW1vbmNoaWZmb246IDB4ZmZmYWNkLFxuICBsaWdodGJsdWU6IDB4YWRkOGU2LFxuICBsaWdodGNvcmFsOiAweGYwODA4MCxcbiAgbGlnaHRjeWFuOiAweGUwZmZmZixcbiAgbGlnaHRnb2xkZW5yb2R5ZWxsb3c6IDB4ZmFmYWQyLFxuICBsaWdodGdyYXk6IDB4ZDNkM2QzLFxuICBsaWdodGdyZWVuOiAweDkwZWU5MCxcbiAgbGlnaHRncmV5OiAweGQzZDNkMyxcbiAgbGlnaHRwaW5rOiAweGZmYjZjMSxcbiAgbGlnaHRzYWxtb246IDB4ZmZhMDdhLFxuICBsaWdodHNlYWdyZWVuOiAweDIwYjJhYSxcbiAgbGlnaHRza3libHVlOiAweDg3Y2VmYSxcbiAgbGlnaHRzbGF0ZWdyYXk6IDB4Nzc4ODk5LFxuICBsaWdodHNsYXRlZ3JleTogMHg3Nzg4OTksXG4gIGxpZ2h0c3RlZWxibHVlOiAweGIwYzRkZSxcbiAgbGlnaHR5ZWxsb3c6IDB4ZmZmZmUwLFxuICBsaW1lOiAweDAwZmYwMCxcbiAgbGltZWdyZWVuOiAweDMyY2QzMixcbiAgbGluZW46IDB4ZmFmMGU2LFxuICBtYWdlbnRhOiAweGZmMDBmZixcbiAgbWFyb29uOiAweDgwMDAwMCxcbiAgbWVkaXVtYXF1YW1hcmluZTogMHg2NmNkYWEsXG4gIG1lZGl1bWJsdWU6IDB4MDAwMGNkLFxuICBtZWRpdW1vcmNoaWQ6IDB4YmE1NWQzLFxuICBtZWRpdW1wdXJwbGU6IDB4OTM3MGRiLFxuICBtZWRpdW1zZWFncmVlbjogMHgzY2IzNzEsXG4gIG1lZGl1bXNsYXRlYmx1ZTogMHg3YjY4ZWUsXG4gIG1lZGl1bXNwcmluZ2dyZWVuOiAweDAwZmE5YSxcbiAgbWVkaXVtdHVycXVvaXNlOiAweDQ4ZDFjYyxcbiAgbWVkaXVtdmlvbGV0cmVkOiAweGM3MTU4NSxcbiAgbWlkbmlnaHRibHVlOiAweDE5MTk3MCxcbiAgbWludGNyZWFtOiAweGY1ZmZmYSxcbiAgbWlzdHlyb3NlOiAweGZmZTRlMSxcbiAgbW9jY2FzaW46IDB4ZmZlNGI1LFxuICBuYXZham93aGl0ZTogMHhmZmRlYWQsXG4gIG5hdnk6IDB4MDAwMDgwLFxuICBvbGRsYWNlOiAweGZkZjVlNixcbiAgb2xpdmU6IDB4ODA4MDAwLFxuICBvbGl2ZWRyYWI6IDB4NmI4ZTIzLFxuICBvcmFuZ2U6IDB4ZmZhNTAwLFxuICBvcmFuZ2VyZWQ6IDB4ZmY0NTAwLFxuICBvcmNoaWQ6IDB4ZGE3MGQ2LFxuICBwYWxlZ29sZGVucm9kOiAweGVlZThhYSxcbiAgcGFsZWdyZWVuOiAweDk4ZmI5OCxcbiAgcGFsZXR1cnF1b2lzZTogMHhhZmVlZWUsXG4gIHBhbGV2aW9sZXRyZWQ6IDB4ZGI3MDkzLFxuICBwYXBheWF3aGlwOiAweGZmZWZkNSxcbiAgcGVhY2hwdWZmOiAweGZmZGFiOSxcbiAgcGVydTogMHhjZDg1M2YsXG4gIHBpbms6IDB4ZmZjMGNiLFxuICBwbHVtOiAweGRkYTBkZCxcbiAgcG93ZGVyYmx1ZTogMHhiMGUwZTYsXG4gIHB1cnBsZTogMHg4MDAwODAsXG4gIHJlYmVjY2FwdXJwbGU6IDB4NjYzMzk5LFxuICByZWQ6IDB4ZmYwMDAwLFxuICByb3N5YnJvd246IDB4YmM4ZjhmLFxuICByb3lhbGJsdWU6IDB4NDE2OWUxLFxuICBzYWRkbGVicm93bjogMHg4YjQ1MTMsXG4gIHNhbG1vbjogMHhmYTgwNzIsXG4gIHNhbmR5YnJvd246IDB4ZjRhNDYwLFxuICBzZWFncmVlbjogMHgyZThiNTcsXG4gIHNlYXNoZWxsOiAweGZmZjVlZSxcbiAgc2llbm5hOiAweGEwNTIyZCxcbiAgc2lsdmVyOiAweGMwYzBjMCxcbiAgc2t5Ymx1ZTogMHg4N2NlZWIsXG4gIHNsYXRlYmx1ZTogMHg2YTVhY2QsXG4gIHNsYXRlZ3JheTogMHg3MDgwOTAsXG4gIHNsYXRlZ3JleTogMHg3MDgwOTAsXG4gIHNub3c6IDB4ZmZmYWZhLFxuICBzcHJpbmdncmVlbjogMHgwMGZmN2YsXG4gIHN0ZWVsYmx1ZTogMHg0NjgyYjQsXG4gIHRhbjogMHhkMmI0OGMsXG4gIHRlYWw6IDB4MDA4MDgwLFxuICB0aGlzdGxlOiAweGQ4YmZkOCxcbiAgdG9tYXRvOiAweGZmNjM0NyxcbiAgdHVycXVvaXNlOiAweDQwZTBkMCxcbiAgdmlvbGV0OiAweGVlODJlZSxcbiAgd2hlYXQ6IDB4ZjVkZWIzLFxuICB3aGl0ZTogMHhmZmZmZmYsXG4gIHdoaXRlc21va2U6IDB4ZjVmNWY1LFxuICB5ZWxsb3c6IDB4ZmZmZjAwLFxuICB5ZWxsb3dncmVlbjogMHg5YWNkMzJcbn07XG5cbmRlZmluZShDb2xvciwgY29sb3IsIHtcbiAgY29weShjaGFubmVscykge1xuICAgIHJldHVybiBPYmplY3QuYXNzaWduKG5ldyB0aGlzLmNvbnN0cnVjdG9yLCB0aGlzLCBjaGFubmVscyk7XG4gIH0sXG4gIGRpc3BsYXlhYmxlKCkge1xuICAgIHJldHVybiB0aGlzLnJnYigpLmRpc3BsYXlhYmxlKCk7XG4gIH0sXG4gIGhleDogY29sb3JfZm9ybWF0SGV4LCAvLyBEZXByZWNhdGVkISBVc2UgY29sb3IuZm9ybWF0SGV4LlxuICBmb3JtYXRIZXg6IGNvbG9yX2Zvcm1hdEhleCxcbiAgZm9ybWF0SGV4ODogY29sb3JfZm9ybWF0SGV4OCxcbiAgZm9ybWF0SHNsOiBjb2xvcl9mb3JtYXRIc2wsXG4gIGZvcm1hdFJnYjogY29sb3JfZm9ybWF0UmdiLFxuICB0b1N0cmluZzogY29sb3JfZm9ybWF0UmdiXG59KTtcblxuZnVuY3Rpb24gY29sb3JfZm9ybWF0SGV4KCkge1xuICByZXR1cm4gdGhpcy5yZ2IoKS5mb3JtYXRIZXgoKTtcbn1cblxuZnVuY3Rpb24gY29sb3JfZm9ybWF0SGV4OCgpIHtcbiAgcmV0dXJuIHRoaXMucmdiKCkuZm9ybWF0SGV4OCgpO1xufVxuXG5mdW5jdGlvbiBjb2xvcl9mb3JtYXRIc2woKSB7XG4gIHJldHVybiBoc2xDb252ZXJ0KHRoaXMpLmZvcm1hdEhzbCgpO1xufVxuXG5mdW5jdGlvbiBjb2xvcl9mb3JtYXRSZ2IoKSB7XG4gIHJldHVybiB0aGlzLnJnYigpLmZvcm1hdFJnYigpO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBjb2xvcihmb3JtYXQpIHtcbiAgdmFyIG0sIGw7XG4gIGZvcm1hdCA9IChmb3JtYXQgKyBcIlwiKS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgcmV0dXJuIChtID0gcmVIZXguZXhlYyhmb3JtYXQpKSA/IChsID0gbVsxXS5sZW5ndGgsIG0gPSBwYXJzZUludChtWzFdLCAxNiksIGwgPT09IDYgPyByZ2JuKG0pIC8vICNmZjAwMDBcbiAgICAgIDogbCA9PT0gMyA/IG5ldyBSZ2IoKG0gPj4gOCAmIDB4ZikgfCAobSA+PiA0ICYgMHhmMCksIChtID4+IDQgJiAweGYpIHwgKG0gJiAweGYwKSwgKChtICYgMHhmKSA8PCA0KSB8IChtICYgMHhmKSwgMSkgLy8gI2YwMFxuICAgICAgOiBsID09PSA4ID8gcmdiYShtID4+IDI0ICYgMHhmZiwgbSA+PiAxNiAmIDB4ZmYsIG0gPj4gOCAmIDB4ZmYsIChtICYgMHhmZikgLyAweGZmKSAvLyAjZmYwMDAwMDBcbiAgICAgIDogbCA9PT0gNCA/IHJnYmEoKG0gPj4gMTIgJiAweGYpIHwgKG0gPj4gOCAmIDB4ZjApLCAobSA+PiA4ICYgMHhmKSB8IChtID4+IDQgJiAweGYwKSwgKG0gPj4gNCAmIDB4ZikgfCAobSAmIDB4ZjApLCAoKChtICYgMHhmKSA8PCA0KSB8IChtICYgMHhmKSkgLyAweGZmKSAvLyAjZjAwMFxuICAgICAgOiBudWxsKSAvLyBpbnZhbGlkIGhleFxuICAgICAgOiAobSA9IHJlUmdiSW50ZWdlci5leGVjKGZvcm1hdCkpID8gbmV3IFJnYihtWzFdLCBtWzJdLCBtWzNdLCAxKSAvLyByZ2IoMjU1LCAwLCAwKVxuICAgICAgOiAobSA9IHJlUmdiUGVyY2VudC5leGVjKGZvcm1hdCkpID8gbmV3IFJnYihtWzFdICogMjU1IC8gMTAwLCBtWzJdICogMjU1IC8gMTAwLCBtWzNdICogMjU1IC8gMTAwLCAxKSAvLyByZ2IoMTAwJSwgMCUsIDAlKVxuICAgICAgOiAobSA9IHJlUmdiYUludGVnZXIuZXhlYyhmb3JtYXQpKSA/IHJnYmEobVsxXSwgbVsyXSwgbVszXSwgbVs0XSkgLy8gcmdiYSgyNTUsIDAsIDAsIDEpXG4gICAgICA6IChtID0gcmVSZ2JhUGVyY2VudC5leGVjKGZvcm1hdCkpID8gcmdiYShtWzFdICogMjU1IC8gMTAwLCBtWzJdICogMjU1IC8gMTAwLCBtWzNdICogMjU1IC8gMTAwLCBtWzRdKSAvLyByZ2IoMTAwJSwgMCUsIDAlLCAxKVxuICAgICAgOiAobSA9IHJlSHNsUGVyY2VudC5leGVjKGZvcm1hdCkpID8gaHNsYShtWzFdLCBtWzJdIC8gMTAwLCBtWzNdIC8gMTAwLCAxKSAvLyBoc2woMTIwLCA1MCUsIDUwJSlcbiAgICAgIDogKG0gPSByZUhzbGFQZXJjZW50LmV4ZWMoZm9ybWF0KSkgPyBoc2xhKG1bMV0sIG1bMl0gLyAxMDAsIG1bM10gLyAxMDAsIG1bNF0pIC8vIGhzbGEoMTIwLCA1MCUsIDUwJSwgMSlcbiAgICAgIDogbmFtZWQuaGFzT3duUHJvcGVydHkoZm9ybWF0KSA/IHJnYm4obmFtZWRbZm9ybWF0XSkgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1wcm90b3R5cGUtYnVpbHRpbnNcbiAgICAgIDogZm9ybWF0ID09PSBcInRyYW5zcGFyZW50XCIgPyBuZXcgUmdiKE5hTiwgTmFOLCBOYU4sIDApXG4gICAgICA6IG51bGw7XG59XG5cbmZ1bmN0aW9uIHJnYm4obikge1xuICByZXR1cm4gbmV3IFJnYihuID4+IDE2ICYgMHhmZiwgbiA+PiA4ICYgMHhmZiwgbiAmIDB4ZmYsIDEpO1xufVxuXG5mdW5jdGlvbiByZ2JhKHIsIGcsIGIsIGEpIHtcbiAgaWYgKGEgPD0gMCkgciA9IGcgPSBiID0gTmFOO1xuICByZXR1cm4gbmV3IFJnYihyLCBnLCBiLCBhKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJnYkNvbnZlcnQobykge1xuICBpZiAoIShvIGluc3RhbmNlb2YgQ29sb3IpKSBvID0gY29sb3Iobyk7XG4gIGlmICghbykgcmV0dXJuIG5ldyBSZ2I7XG4gIG8gPSBvLnJnYigpO1xuICByZXR1cm4gbmV3IFJnYihvLnIsIG8uZywgby5iLCBvLm9wYWNpdHkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmdiKHIsIGcsIGIsIG9wYWNpdHkpIHtcbiAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPT09IDEgPyByZ2JDb252ZXJ0KHIpIDogbmV3IFJnYihyLCBnLCBiLCBvcGFjaXR5ID09IG51bGwgPyAxIDogb3BhY2l0eSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBSZ2IociwgZywgYiwgb3BhY2l0eSkge1xuICB0aGlzLnIgPSArcjtcbiAgdGhpcy5nID0gK2c7XG4gIHRoaXMuYiA9ICtiO1xuICB0aGlzLm9wYWNpdHkgPSArb3BhY2l0eTtcbn1cblxuZGVmaW5lKFJnYiwgcmdiLCBleHRlbmQoQ29sb3IsIHtcbiAgYnJpZ2h0ZXIoaykge1xuICAgIGsgPSBrID09IG51bGwgPyBicmlnaHRlciA6IE1hdGgucG93KGJyaWdodGVyLCBrKTtcbiAgICByZXR1cm4gbmV3IFJnYih0aGlzLnIgKiBrLCB0aGlzLmcgKiBrLCB0aGlzLmIgKiBrLCB0aGlzLm9wYWNpdHkpO1xuICB9LFxuICBkYXJrZXIoaykge1xuICAgIGsgPSBrID09IG51bGwgPyBkYXJrZXIgOiBNYXRoLnBvdyhkYXJrZXIsIGspO1xuICAgIHJldHVybiBuZXcgUmdiKHRoaXMuciAqIGssIHRoaXMuZyAqIGssIHRoaXMuYiAqIGssIHRoaXMub3BhY2l0eSk7XG4gIH0sXG4gIHJnYigpIHtcbiAgICByZXR1cm4gdGhpcztcbiAgfSxcbiAgY2xhbXAoKSB7XG4gICAgcmV0dXJuIG5ldyBSZ2IoY2xhbXBpKHRoaXMuciksIGNsYW1waSh0aGlzLmcpLCBjbGFtcGkodGhpcy5iKSwgY2xhbXBhKHRoaXMub3BhY2l0eSkpO1xuICB9LFxuICBkaXNwbGF5YWJsZSgpIHtcbiAgICByZXR1cm4gKC0wLjUgPD0gdGhpcy5yICYmIHRoaXMuciA8IDI1NS41KVxuICAgICAgICAmJiAoLTAuNSA8PSB0aGlzLmcgJiYgdGhpcy5nIDwgMjU1LjUpXG4gICAgICAgICYmICgtMC41IDw9IHRoaXMuYiAmJiB0aGlzLmIgPCAyNTUuNSlcbiAgICAgICAgJiYgKDAgPD0gdGhpcy5vcGFjaXR5ICYmIHRoaXMub3BhY2l0eSA8PSAxKTtcbiAgfSxcbiAgaGV4OiByZ2JfZm9ybWF0SGV4LCAvLyBEZXByZWNhdGVkISBVc2UgY29sb3IuZm9ybWF0SGV4LlxuICBmb3JtYXRIZXg6IHJnYl9mb3JtYXRIZXgsXG4gIGZvcm1hdEhleDg6IHJnYl9mb3JtYXRIZXg4LFxuICBmb3JtYXRSZ2I6IHJnYl9mb3JtYXRSZ2IsXG4gIHRvU3RyaW5nOiByZ2JfZm9ybWF0UmdiXG59KSk7XG5cbmZ1bmN0aW9uIHJnYl9mb3JtYXRIZXgoKSB7XG4gIHJldHVybiBgIyR7aGV4KHRoaXMucil9JHtoZXgodGhpcy5nKX0ke2hleCh0aGlzLmIpfWA7XG59XG5cbmZ1bmN0aW9uIHJnYl9mb3JtYXRIZXg4KCkge1xuICByZXR1cm4gYCMke2hleCh0aGlzLnIpfSR7aGV4KHRoaXMuZyl9JHtoZXgodGhpcy5iKX0ke2hleCgoaXNOYU4odGhpcy5vcGFjaXR5KSA/IDEgOiB0aGlzLm9wYWNpdHkpICogMjU1KX1gO1xufVxuXG5mdW5jdGlvbiByZ2JfZm9ybWF0UmdiKCkge1xuICBjb25zdCBhID0gY2xhbXBhKHRoaXMub3BhY2l0eSk7XG4gIHJldHVybiBgJHthID09PSAxID8gXCJyZ2IoXCIgOiBcInJnYmEoXCJ9JHtjbGFtcGkodGhpcy5yKX0sICR7Y2xhbXBpKHRoaXMuZyl9LCAke2NsYW1waSh0aGlzLmIpfSR7YSA9PT0gMSA/IFwiKVwiIDogYCwgJHthfSlgfWA7XG59XG5cbmZ1bmN0aW9uIGNsYW1wYShvcGFjaXR5KSB7XG4gIHJldHVybiBpc05hTihvcGFjaXR5KSA/IDEgOiBNYXRoLm1heCgwLCBNYXRoLm1pbigxLCBvcGFjaXR5KSk7XG59XG5cbmZ1bmN0aW9uIGNsYW1waSh2YWx1ZSkge1xuICByZXR1cm4gTWF0aC5tYXgoMCwgTWF0aC5taW4oMjU1LCBNYXRoLnJvdW5kKHZhbHVlKSB8fCAwKSk7XG59XG5cbmZ1bmN0aW9uIGhleCh2YWx1ZSkge1xuICB2YWx1ZSA9IGNsYW1waSh2YWx1ZSk7XG4gIHJldHVybiAodmFsdWUgPCAxNiA/IFwiMFwiIDogXCJcIikgKyB2YWx1ZS50b1N0cmluZygxNik7XG59XG5cbmZ1bmN0aW9uIGhzbGEoaCwgcywgbCwgYSkge1xuICBpZiAoYSA8PSAwKSBoID0gcyA9IGwgPSBOYU47XG4gIGVsc2UgaWYgKGwgPD0gMCB8fCBsID49IDEpIGggPSBzID0gTmFOO1xuICBlbHNlIGlmIChzIDw9IDApIGggPSBOYU47XG4gIHJldHVybiBuZXcgSHNsKGgsIHMsIGwsIGEpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaHNsQ29udmVydChvKSB7XG4gIGlmIChvIGluc3RhbmNlb2YgSHNsKSByZXR1cm4gbmV3IEhzbChvLmgsIG8ucywgby5sLCBvLm9wYWNpdHkpO1xuICBpZiAoIShvIGluc3RhbmNlb2YgQ29sb3IpKSBvID0gY29sb3Iobyk7XG4gIGlmICghbykgcmV0dXJuIG5ldyBIc2w7XG4gIGlmIChvIGluc3RhbmNlb2YgSHNsKSByZXR1cm4gbztcbiAgbyA9IG8ucmdiKCk7XG4gIHZhciByID0gby5yIC8gMjU1LFxuICAgICAgZyA9IG8uZyAvIDI1NSxcbiAgICAgIGIgPSBvLmIgLyAyNTUsXG4gICAgICBtaW4gPSBNYXRoLm1pbihyLCBnLCBiKSxcbiAgICAgIG1heCA9IE1hdGgubWF4KHIsIGcsIGIpLFxuICAgICAgaCA9IE5hTixcbiAgICAgIHMgPSBtYXggLSBtaW4sXG4gICAgICBsID0gKG1heCArIG1pbikgLyAyO1xuICBpZiAocykge1xuICAgIGlmIChyID09PSBtYXgpIGggPSAoZyAtIGIpIC8gcyArIChnIDwgYikgKiA2O1xuICAgIGVsc2UgaWYgKGcgPT09IG1heCkgaCA9IChiIC0gcikgLyBzICsgMjtcbiAgICBlbHNlIGggPSAociAtIGcpIC8gcyArIDQ7XG4gICAgcyAvPSBsIDwgMC41ID8gbWF4ICsgbWluIDogMiAtIG1heCAtIG1pbjtcbiAgICBoICo9IDYwO1xuICB9IGVsc2Uge1xuICAgIHMgPSBsID4gMCAmJiBsIDwgMSA/IDAgOiBoO1xuICB9XG4gIHJldHVybiBuZXcgSHNsKGgsIHMsIGwsIG8ub3BhY2l0eSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBoc2woaCwgcywgbCwgb3BhY2l0eSkge1xuICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA9PT0gMSA/IGhzbENvbnZlcnQoaCkgOiBuZXcgSHNsKGgsIHMsIGwsIG9wYWNpdHkgPT0gbnVsbCA/IDEgOiBvcGFjaXR5KTtcbn1cblxuZnVuY3Rpb24gSHNsKGgsIHMsIGwsIG9wYWNpdHkpIHtcbiAgdGhpcy5oID0gK2g7XG4gIHRoaXMucyA9ICtzO1xuICB0aGlzLmwgPSArbDtcbiAgdGhpcy5vcGFjaXR5ID0gK29wYWNpdHk7XG59XG5cbmRlZmluZShIc2wsIGhzbCwgZXh0ZW5kKENvbG9yLCB7XG4gIGJyaWdodGVyKGspIHtcbiAgICBrID0gayA9PSBudWxsID8gYnJpZ2h0ZXIgOiBNYXRoLnBvdyhicmlnaHRlciwgayk7XG4gICAgcmV0dXJuIG5ldyBIc2wodGhpcy5oLCB0aGlzLnMsIHRoaXMubCAqIGssIHRoaXMub3BhY2l0eSk7XG4gIH0sXG4gIGRhcmtlcihrKSB7XG4gICAgayA9IGsgPT0gbnVsbCA/IGRhcmtlciA6IE1hdGgucG93KGRhcmtlciwgayk7XG4gICAgcmV0dXJuIG5ldyBIc2wodGhpcy5oLCB0aGlzLnMsIHRoaXMubCAqIGssIHRoaXMub3BhY2l0eSk7XG4gIH0sXG4gIHJnYigpIHtcbiAgICB2YXIgaCA9IHRoaXMuaCAlIDM2MCArICh0aGlzLmggPCAwKSAqIDM2MCxcbiAgICAgICAgcyA9IGlzTmFOKGgpIHx8IGlzTmFOKHRoaXMucykgPyAwIDogdGhpcy5zLFxuICAgICAgICBsID0gdGhpcy5sLFxuICAgICAgICBtMiA9IGwgKyAobCA8IDAuNSA/IGwgOiAxIC0gbCkgKiBzLFxuICAgICAgICBtMSA9IDIgKiBsIC0gbTI7XG4gICAgcmV0dXJuIG5ldyBSZ2IoXG4gICAgICBoc2wycmdiKGggPj0gMjQwID8gaCAtIDI0MCA6IGggKyAxMjAsIG0xLCBtMiksXG4gICAgICBoc2wycmdiKGgsIG0xLCBtMiksXG4gICAgICBoc2wycmdiKGggPCAxMjAgPyBoICsgMjQwIDogaCAtIDEyMCwgbTEsIG0yKSxcbiAgICAgIHRoaXMub3BhY2l0eVxuICAgICk7XG4gIH0sXG4gIGNsYW1wKCkge1xuICAgIHJldHVybiBuZXcgSHNsKGNsYW1waCh0aGlzLmgpLCBjbGFtcHQodGhpcy5zKSwgY2xhbXB0KHRoaXMubCksIGNsYW1wYSh0aGlzLm9wYWNpdHkpKTtcbiAgfSxcbiAgZGlzcGxheWFibGUoKSB7XG4gICAgcmV0dXJuICgwIDw9IHRoaXMucyAmJiB0aGlzLnMgPD0gMSB8fCBpc05hTih0aGlzLnMpKVxuICAgICAgICAmJiAoMCA8PSB0aGlzLmwgJiYgdGhpcy5sIDw9IDEpXG4gICAgICAgICYmICgwIDw9IHRoaXMub3BhY2l0eSAmJiB0aGlzLm9wYWNpdHkgPD0gMSk7XG4gIH0sXG4gIGZvcm1hdEhzbCgpIHtcbiAgICBjb25zdCBhID0gY2xhbXBhKHRoaXMub3BhY2l0eSk7XG4gICAgcmV0dXJuIGAke2EgPT09IDEgPyBcImhzbChcIiA6IFwiaHNsYShcIn0ke2NsYW1waCh0aGlzLmgpfSwgJHtjbGFtcHQodGhpcy5zKSAqIDEwMH0lLCAke2NsYW1wdCh0aGlzLmwpICogMTAwfSUke2EgPT09IDEgPyBcIilcIiA6IGAsICR7YX0pYH1gO1xuICB9XG59KSk7XG5cbmZ1bmN0aW9uIGNsYW1waCh2YWx1ZSkge1xuICB2YWx1ZSA9ICh2YWx1ZSB8fCAwKSAlIDM2MDtcbiAgcmV0dXJuIHZhbHVlIDwgMCA/IHZhbHVlICsgMzYwIDogdmFsdWU7XG59XG5cbmZ1bmN0aW9uIGNsYW1wdCh2YWx1ZSkge1xuICByZXR1cm4gTWF0aC5tYXgoMCwgTWF0aC5taW4oMSwgdmFsdWUgfHwgMCkpO1xufVxuXG4vKiBGcm9tIEZ2RCAxMy4zNywgQ1NTIENvbG9yIE1vZHVsZSBMZXZlbCAzICovXG5mdW5jdGlvbiBoc2wycmdiKGgsIG0xLCBtMikge1xuICByZXR1cm4gKGggPCA2MCA/IG0xICsgKG0yIC0gbTEpICogaCAvIDYwXG4gICAgICA6IGggPCAxODAgPyBtMlxuICAgICAgOiBoIDwgMjQwID8gbTEgKyAobTIgLSBtMSkgKiAoMjQwIC0gaCkgLyA2MFxuICAgICAgOiBtMSkgKiAyNTU7XG59XG4iLCAiZXhwb3J0IGZ1bmN0aW9uIGJhc2lzKHQxLCB2MCwgdjEsIHYyLCB2Mykge1xuICB2YXIgdDIgPSB0MSAqIHQxLCB0MyA9IHQyICogdDE7XG4gIHJldHVybiAoKDEgLSAzICogdDEgKyAzICogdDIgLSB0MykgKiB2MFxuICAgICAgKyAoNCAtIDYgKiB0MiArIDMgKiB0MykgKiB2MVxuICAgICAgKyAoMSArIDMgKiB0MSArIDMgKiB0MiAtIDMgKiB0MykgKiB2MlxuICAgICAgKyB0MyAqIHYzKSAvIDY7XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHZhbHVlcykge1xuICB2YXIgbiA9IHZhbHVlcy5sZW5ndGggLSAxO1xuICByZXR1cm4gZnVuY3Rpb24odCkge1xuICAgIHZhciBpID0gdCA8PSAwID8gKHQgPSAwKSA6IHQgPj0gMSA/ICh0ID0gMSwgbiAtIDEpIDogTWF0aC5mbG9vcih0ICogbiksXG4gICAgICAgIHYxID0gdmFsdWVzW2ldLFxuICAgICAgICB2MiA9IHZhbHVlc1tpICsgMV0sXG4gICAgICAgIHYwID0gaSA+IDAgPyB2YWx1ZXNbaSAtIDFdIDogMiAqIHYxIC0gdjIsXG4gICAgICAgIHYzID0gaSA8IG4gLSAxID8gdmFsdWVzW2kgKyAyXSA6IDIgKiB2MiAtIHYxO1xuICAgIHJldHVybiBiYXNpcygodCAtIGkgLyBuKSAqIG4sIHYwLCB2MSwgdjIsIHYzKTtcbiAgfTtcbn1cbiIsICJpbXBvcnQge2Jhc2lzfSBmcm9tIFwiLi9iYXNpcy5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih2YWx1ZXMpIHtcbiAgdmFyIG4gPSB2YWx1ZXMubGVuZ3RoO1xuICByZXR1cm4gZnVuY3Rpb24odCkge1xuICAgIHZhciBpID0gTWF0aC5mbG9vcigoKHQgJT0gMSkgPCAwID8gKyt0IDogdCkgKiBuKSxcbiAgICAgICAgdjAgPSB2YWx1ZXNbKGkgKyBuIC0gMSkgJSBuXSxcbiAgICAgICAgdjEgPSB2YWx1ZXNbaSAlIG5dLFxuICAgICAgICB2MiA9IHZhbHVlc1soaSArIDEpICUgbl0sXG4gICAgICAgIHYzID0gdmFsdWVzWyhpICsgMikgJSBuXTtcbiAgICByZXR1cm4gYmFzaXMoKHQgLSBpIC8gbikgKiBuLCB2MCwgdjEsIHYyLCB2Myk7XG4gIH07XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgeCA9PiAoKSA9PiB4O1xuIiwgImltcG9ydCBjb25zdGFudCBmcm9tIFwiLi9jb25zdGFudC5qc1wiO1xuXG5mdW5jdGlvbiBsaW5lYXIoYSwgZCkge1xuICByZXR1cm4gZnVuY3Rpb24odCkge1xuICAgIHJldHVybiBhICsgdCAqIGQ7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGV4cG9uZW50aWFsKGEsIGIsIHkpIHtcbiAgcmV0dXJuIGEgPSBNYXRoLnBvdyhhLCB5KSwgYiA9IE1hdGgucG93KGIsIHkpIC0gYSwgeSA9IDEgLyB5LCBmdW5jdGlvbih0KSB7XG4gICAgcmV0dXJuIE1hdGgucG93KGEgKyB0ICogYiwgeSk7XG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBodWUoYSwgYikge1xuICB2YXIgZCA9IGIgLSBhO1xuICByZXR1cm4gZCA/IGxpbmVhcihhLCBkID4gMTgwIHx8IGQgPCAtMTgwID8gZCAtIDM2MCAqIE1hdGgucm91bmQoZCAvIDM2MCkgOiBkKSA6IGNvbnN0YW50KGlzTmFOKGEpID8gYiA6IGEpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2FtbWEoeSkge1xuICByZXR1cm4gKHkgPSAreSkgPT09IDEgPyBub2dhbW1hIDogZnVuY3Rpb24oYSwgYikge1xuICAgIHJldHVybiBiIC0gYSA/IGV4cG9uZW50aWFsKGEsIGIsIHkpIDogY29uc3RhbnQoaXNOYU4oYSkgPyBiIDogYSk7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIG5vZ2FtbWEoYSwgYikge1xuICB2YXIgZCA9IGIgLSBhO1xuICByZXR1cm4gZCA/IGxpbmVhcihhLCBkKSA6IGNvbnN0YW50KGlzTmFOKGEpID8gYiA6IGEpO1xufVxuIiwgImltcG9ydCB7cmdiIGFzIGNvbG9yUmdifSBmcm9tIFwiZDMtY29sb3JcIjtcbmltcG9ydCBiYXNpcyBmcm9tIFwiLi9iYXNpcy5qc1wiO1xuaW1wb3J0IGJhc2lzQ2xvc2VkIGZyb20gXCIuL2Jhc2lzQ2xvc2VkLmpzXCI7XG5pbXBvcnQgbm9nYW1tYSwge2dhbW1hfSBmcm9tIFwiLi9jb2xvci5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCAoZnVuY3Rpb24gcmdiR2FtbWEoeSkge1xuICB2YXIgY29sb3IgPSBnYW1tYSh5KTtcblxuICBmdW5jdGlvbiByZ2Ioc3RhcnQsIGVuZCkge1xuICAgIHZhciByID0gY29sb3IoKHN0YXJ0ID0gY29sb3JSZ2Ioc3RhcnQpKS5yLCAoZW5kID0gY29sb3JSZ2IoZW5kKSkuciksXG4gICAgICAgIGcgPSBjb2xvcihzdGFydC5nLCBlbmQuZyksXG4gICAgICAgIGIgPSBjb2xvcihzdGFydC5iLCBlbmQuYiksXG4gICAgICAgIG9wYWNpdHkgPSBub2dhbW1hKHN0YXJ0Lm9wYWNpdHksIGVuZC5vcGFjaXR5KTtcbiAgICByZXR1cm4gZnVuY3Rpb24odCkge1xuICAgICAgc3RhcnQuciA9IHIodCk7XG4gICAgICBzdGFydC5nID0gZyh0KTtcbiAgICAgIHN0YXJ0LmIgPSBiKHQpO1xuICAgICAgc3RhcnQub3BhY2l0eSA9IG9wYWNpdHkodCk7XG4gICAgICByZXR1cm4gc3RhcnQgKyBcIlwiO1xuICAgIH07XG4gIH1cblxuICByZ2IuZ2FtbWEgPSByZ2JHYW1tYTtcblxuICByZXR1cm4gcmdiO1xufSkoMSk7XG5cbmZ1bmN0aW9uIHJnYlNwbGluZShzcGxpbmUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKGNvbG9ycykge1xuICAgIHZhciBuID0gY29sb3JzLmxlbmd0aCxcbiAgICAgICAgciA9IG5ldyBBcnJheShuKSxcbiAgICAgICAgZyA9IG5ldyBBcnJheShuKSxcbiAgICAgICAgYiA9IG5ldyBBcnJheShuKSxcbiAgICAgICAgaSwgY29sb3I7XG4gICAgZm9yIChpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgY29sb3IgPSBjb2xvclJnYihjb2xvcnNbaV0pO1xuICAgICAgcltpXSA9IGNvbG9yLnIgfHwgMDtcbiAgICAgIGdbaV0gPSBjb2xvci5nIHx8IDA7XG4gICAgICBiW2ldID0gY29sb3IuYiB8fCAwO1xuICAgIH1cbiAgICByID0gc3BsaW5lKHIpO1xuICAgIGcgPSBzcGxpbmUoZyk7XG4gICAgYiA9IHNwbGluZShiKTtcbiAgICBjb2xvci5vcGFjaXR5ID0gMTtcbiAgICByZXR1cm4gZnVuY3Rpb24odCkge1xuICAgICAgY29sb3IuciA9IHIodCk7XG4gICAgICBjb2xvci5nID0gZyh0KTtcbiAgICAgIGNvbG9yLmIgPSBiKHQpO1xuICAgICAgcmV0dXJuIGNvbG9yICsgXCJcIjtcbiAgICB9O1xuICB9O1xufVxuXG5leHBvcnQgdmFyIHJnYkJhc2lzID0gcmdiU3BsaW5lKGJhc2lzKTtcbmV4cG9ydCB2YXIgcmdiQmFzaXNDbG9zZWQgPSByZ2JTcGxpbmUoYmFzaXNDbG9zZWQpO1xuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGEsIGIpIHtcbiAgcmV0dXJuIGEgPSArYSwgYiA9ICtiLCBmdW5jdGlvbih0KSB7XG4gICAgcmV0dXJuIGEgKiAoMSAtIHQpICsgYiAqIHQ7XG4gIH07XG59XG4iLCAiaW1wb3J0IG51bWJlciBmcm9tIFwiLi9udW1iZXIuanNcIjtcblxudmFyIHJlQSA9IC9bLStdPyg/OlxcZCtcXC4/XFxkKnxcXC4/XFxkKykoPzpbZUVdWy0rXT9cXGQrKT8vZyxcbiAgICByZUIgPSBuZXcgUmVnRXhwKHJlQS5zb3VyY2UsIFwiZ1wiKTtcblxuZnVuY3Rpb24gemVybyhiKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gYjtcbiAgfTtcbn1cblxuZnVuY3Rpb24gb25lKGIpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKHQpIHtcbiAgICByZXR1cm4gYih0KSArIFwiXCI7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGEsIGIpIHtcbiAgdmFyIGJpID0gcmVBLmxhc3RJbmRleCA9IHJlQi5sYXN0SW5kZXggPSAwLCAvLyBzY2FuIGluZGV4IGZvciBuZXh0IG51bWJlciBpbiBiXG4gICAgICBhbSwgLy8gY3VycmVudCBtYXRjaCBpbiBhXG4gICAgICBibSwgLy8gY3VycmVudCBtYXRjaCBpbiBiXG4gICAgICBicywgLy8gc3RyaW5nIHByZWNlZGluZyBjdXJyZW50IG51bWJlciBpbiBiLCBpZiBhbnlcbiAgICAgIGkgPSAtMSwgLy8gaW5kZXggaW4gc1xuICAgICAgcyA9IFtdLCAvLyBzdHJpbmcgY29uc3RhbnRzIGFuZCBwbGFjZWhvbGRlcnNcbiAgICAgIHEgPSBbXTsgLy8gbnVtYmVyIGludGVycG9sYXRvcnNcblxuICAvLyBDb2VyY2UgaW5wdXRzIHRvIHN0cmluZ3MuXG4gIGEgPSBhICsgXCJcIiwgYiA9IGIgKyBcIlwiO1xuXG4gIC8vIEludGVycG9sYXRlIHBhaXJzIG9mIG51bWJlcnMgaW4gYSAmIGIuXG4gIHdoaWxlICgoYW0gPSByZUEuZXhlYyhhKSlcbiAgICAgICYmIChibSA9IHJlQi5leGVjKGIpKSkge1xuICAgIGlmICgoYnMgPSBibS5pbmRleCkgPiBiaSkgeyAvLyBhIHN0cmluZyBwcmVjZWRlcyB0aGUgbmV4dCBudW1iZXIgaW4gYlxuICAgICAgYnMgPSBiLnNsaWNlKGJpLCBicyk7XG4gICAgICBpZiAoc1tpXSkgc1tpXSArPSBiczsgLy8gY29hbGVzY2Ugd2l0aCBwcmV2aW91cyBzdHJpbmdcbiAgICAgIGVsc2Ugc1srK2ldID0gYnM7XG4gICAgfVxuICAgIGlmICgoYW0gPSBhbVswXSkgPT09IChibSA9IGJtWzBdKSkgeyAvLyBudW1iZXJzIGluIGEgJiBiIG1hdGNoXG4gICAgICBpZiAoc1tpXSkgc1tpXSArPSBibTsgLy8gY29hbGVzY2Ugd2l0aCBwcmV2aW91cyBzdHJpbmdcbiAgICAgIGVsc2Ugc1srK2ldID0gYm07XG4gICAgfSBlbHNlIHsgLy8gaW50ZXJwb2xhdGUgbm9uLW1hdGNoaW5nIG51bWJlcnNcbiAgICAgIHNbKytpXSA9IG51bGw7XG4gICAgICBxLnB1c2goe2k6IGksIHg6IG51bWJlcihhbSwgYm0pfSk7XG4gICAgfVxuICAgIGJpID0gcmVCLmxhc3RJbmRleDtcbiAgfVxuXG4gIC8vIEFkZCByZW1haW5zIG9mIGIuXG4gIGlmIChiaSA8IGIubGVuZ3RoKSB7XG4gICAgYnMgPSBiLnNsaWNlKGJpKTtcbiAgICBpZiAoc1tpXSkgc1tpXSArPSBiczsgLy8gY29hbGVzY2Ugd2l0aCBwcmV2aW91cyBzdHJpbmdcbiAgICBlbHNlIHNbKytpXSA9IGJzO1xuICB9XG5cbiAgLy8gU3BlY2lhbCBvcHRpbWl6YXRpb24gZm9yIG9ubHkgYSBzaW5nbGUgbWF0Y2guXG4gIC8vIE90aGVyd2lzZSwgaW50ZXJwb2xhdGUgZWFjaCBvZiB0aGUgbnVtYmVycyBhbmQgcmVqb2luIHRoZSBzdHJpbmcuXG4gIHJldHVybiBzLmxlbmd0aCA8IDIgPyAocVswXVxuICAgICAgPyBvbmUocVswXS54KVxuICAgICAgOiB6ZXJvKGIpKVxuICAgICAgOiAoYiA9IHEubGVuZ3RoLCBmdW5jdGlvbih0KSB7XG4gICAgICAgICAgZm9yICh2YXIgaSA9IDAsIG87IGkgPCBiOyArK2kpIHNbKG8gPSBxW2ldKS5pXSA9IG8ueCh0KTtcbiAgICAgICAgICByZXR1cm4gcy5qb2luKFwiXCIpO1xuICAgICAgICB9KTtcbn1cbiIsICJ2YXIgZGVncmVlcyA9IDE4MCAvIE1hdGguUEk7XG5cbmV4cG9ydCB2YXIgaWRlbnRpdHkgPSB7XG4gIHRyYW5zbGF0ZVg6IDAsXG4gIHRyYW5zbGF0ZVk6IDAsXG4gIHJvdGF0ZTogMCxcbiAgc2tld1g6IDAsXG4gIHNjYWxlWDogMSxcbiAgc2NhbGVZOiAxXG59O1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihhLCBiLCBjLCBkLCBlLCBmKSB7XG4gIHZhciBzY2FsZVgsIHNjYWxlWSwgc2tld1g7XG4gIGlmIChzY2FsZVggPSBNYXRoLnNxcnQoYSAqIGEgKyBiICogYikpIGEgLz0gc2NhbGVYLCBiIC89IHNjYWxlWDtcbiAgaWYgKHNrZXdYID0gYSAqIGMgKyBiICogZCkgYyAtPSBhICogc2tld1gsIGQgLT0gYiAqIHNrZXdYO1xuICBpZiAoc2NhbGVZID0gTWF0aC5zcXJ0KGMgKiBjICsgZCAqIGQpKSBjIC89IHNjYWxlWSwgZCAvPSBzY2FsZVksIHNrZXdYIC89IHNjYWxlWTtcbiAgaWYgKGEgKiBkIDwgYiAqIGMpIGEgPSAtYSwgYiA9IC1iLCBza2V3WCA9IC1za2V3WCwgc2NhbGVYID0gLXNjYWxlWDtcbiAgcmV0dXJuIHtcbiAgICB0cmFuc2xhdGVYOiBlLFxuICAgIHRyYW5zbGF0ZVk6IGYsXG4gICAgcm90YXRlOiBNYXRoLmF0YW4yKGIsIGEpICogZGVncmVlcyxcbiAgICBza2V3WDogTWF0aC5hdGFuKHNrZXdYKSAqIGRlZ3JlZXMsXG4gICAgc2NhbGVYOiBzY2FsZVgsXG4gICAgc2NhbGVZOiBzY2FsZVlcbiAgfTtcbn1cbiIsICJpbXBvcnQgZGVjb21wb3NlLCB7aWRlbnRpdHl9IGZyb20gXCIuL2RlY29tcG9zZS5qc1wiO1xuXG52YXIgc3ZnTm9kZTtcblxuLyogZXNsaW50LWRpc2FibGUgbm8tdW5kZWYgKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUNzcyh2YWx1ZSkge1xuICBjb25zdCBtID0gbmV3ICh0eXBlb2YgRE9NTWF0cml4ID09PSBcImZ1bmN0aW9uXCIgPyBET01NYXRyaXggOiBXZWJLaXRDU1NNYXRyaXgpKHZhbHVlICsgXCJcIik7XG4gIHJldHVybiBtLmlzSWRlbnRpdHkgPyBpZGVudGl0eSA6IGRlY29tcG9zZShtLmEsIG0uYiwgbS5jLCBtLmQsIG0uZSwgbS5mKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlU3ZnKHZhbHVlKSB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gaWRlbnRpdHk7XG4gIGlmICghc3ZnTm9kZSkgc3ZnTm9kZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnROUyhcImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCIsIFwiZ1wiKTtcbiAgc3ZnTm9kZS5zZXRBdHRyaWJ1dGUoXCJ0cmFuc2Zvcm1cIiwgdmFsdWUpO1xuICBpZiAoISh2YWx1ZSA9IHN2Z05vZGUudHJhbnNmb3JtLmJhc2VWYWwuY29uc29saWRhdGUoKSkpIHJldHVybiBpZGVudGl0eTtcbiAgdmFsdWUgPSB2YWx1ZS5tYXRyaXg7XG4gIHJldHVybiBkZWNvbXBvc2UodmFsdWUuYSwgdmFsdWUuYiwgdmFsdWUuYywgdmFsdWUuZCwgdmFsdWUuZSwgdmFsdWUuZik7XG59XG4iLCAiaW1wb3J0IG51bWJlciBmcm9tIFwiLi4vbnVtYmVyLmpzXCI7XG5pbXBvcnQge3BhcnNlQ3NzLCBwYXJzZVN2Z30gZnJvbSBcIi4vcGFyc2UuanNcIjtcblxuZnVuY3Rpb24gaW50ZXJwb2xhdGVUcmFuc2Zvcm0ocGFyc2UsIHB4Q29tbWEsIHB4UGFyZW4sIGRlZ1BhcmVuKSB7XG5cbiAgZnVuY3Rpb24gcG9wKHMpIHtcbiAgICByZXR1cm4gcy5sZW5ndGggPyBzLnBvcCgpICsgXCIgXCIgOiBcIlwiO1xuICB9XG5cbiAgZnVuY3Rpb24gdHJhbnNsYXRlKHhhLCB5YSwgeGIsIHliLCBzLCBxKSB7XG4gICAgaWYgKHhhICE9PSB4YiB8fCB5YSAhPT0geWIpIHtcbiAgICAgIHZhciBpID0gcy5wdXNoKFwidHJhbnNsYXRlKFwiLCBudWxsLCBweENvbW1hLCBudWxsLCBweFBhcmVuKTtcbiAgICAgIHEucHVzaCh7aTogaSAtIDQsIHg6IG51bWJlcih4YSwgeGIpfSwge2k6IGkgLSAyLCB4OiBudW1iZXIoeWEsIHliKX0pO1xuICAgIH0gZWxzZSBpZiAoeGIgfHwgeWIpIHtcbiAgICAgIHMucHVzaChcInRyYW5zbGF0ZShcIiArIHhiICsgcHhDb21tYSArIHliICsgcHhQYXJlbik7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gcm90YXRlKGEsIGIsIHMsIHEpIHtcbiAgICBpZiAoYSAhPT0gYikge1xuICAgICAgaWYgKGEgLSBiID4gMTgwKSBiICs9IDM2MDsgZWxzZSBpZiAoYiAtIGEgPiAxODApIGEgKz0gMzYwOyAvLyBzaG9ydGVzdCBwYXRoXG4gICAgICBxLnB1c2goe2k6IHMucHVzaChwb3AocykgKyBcInJvdGF0ZShcIiwgbnVsbCwgZGVnUGFyZW4pIC0gMiwgeDogbnVtYmVyKGEsIGIpfSk7XG4gICAgfSBlbHNlIGlmIChiKSB7XG4gICAgICBzLnB1c2gocG9wKHMpICsgXCJyb3RhdGUoXCIgKyBiICsgZGVnUGFyZW4pO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHNrZXdYKGEsIGIsIHMsIHEpIHtcbiAgICBpZiAoYSAhPT0gYikge1xuICAgICAgcS5wdXNoKHtpOiBzLnB1c2gocG9wKHMpICsgXCJza2V3WChcIiwgbnVsbCwgZGVnUGFyZW4pIC0gMiwgeDogbnVtYmVyKGEsIGIpfSk7XG4gICAgfSBlbHNlIGlmIChiKSB7XG4gICAgICBzLnB1c2gocG9wKHMpICsgXCJza2V3WChcIiArIGIgKyBkZWdQYXJlbik7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gc2NhbGUoeGEsIHlhLCB4YiwgeWIsIHMsIHEpIHtcbiAgICBpZiAoeGEgIT09IHhiIHx8IHlhICE9PSB5Yikge1xuICAgICAgdmFyIGkgPSBzLnB1c2gocG9wKHMpICsgXCJzY2FsZShcIiwgbnVsbCwgXCIsXCIsIG51bGwsIFwiKVwiKTtcbiAgICAgIHEucHVzaCh7aTogaSAtIDQsIHg6IG51bWJlcih4YSwgeGIpfSwge2k6IGkgLSAyLCB4OiBudW1iZXIoeWEsIHliKX0pO1xuICAgIH0gZWxzZSBpZiAoeGIgIT09IDEgfHwgeWIgIT09IDEpIHtcbiAgICAgIHMucHVzaChwb3AocykgKyBcInNjYWxlKFwiICsgeGIgKyBcIixcIiArIHliICsgXCIpXCIpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBmdW5jdGlvbihhLCBiKSB7XG4gICAgdmFyIHMgPSBbXSwgLy8gc3RyaW5nIGNvbnN0YW50cyBhbmQgcGxhY2Vob2xkZXJzXG4gICAgICAgIHEgPSBbXTsgLy8gbnVtYmVyIGludGVycG9sYXRvcnNcbiAgICBhID0gcGFyc2UoYSksIGIgPSBwYXJzZShiKTtcbiAgICB0cmFuc2xhdGUoYS50cmFuc2xhdGVYLCBhLnRyYW5zbGF0ZVksIGIudHJhbnNsYXRlWCwgYi50cmFuc2xhdGVZLCBzLCBxKTtcbiAgICByb3RhdGUoYS5yb3RhdGUsIGIucm90YXRlLCBzLCBxKTtcbiAgICBza2V3WChhLnNrZXdYLCBiLnNrZXdYLCBzLCBxKTtcbiAgICBzY2FsZShhLnNjYWxlWCwgYS5zY2FsZVksIGIuc2NhbGVYLCBiLnNjYWxlWSwgcywgcSk7XG4gICAgYSA9IGIgPSBudWxsOyAvLyBnY1xuICAgIHJldHVybiBmdW5jdGlvbih0KSB7XG4gICAgICB2YXIgaSA9IC0xLCBuID0gcS5sZW5ndGgsIG87XG4gICAgICB3aGlsZSAoKytpIDwgbikgc1sobyA9IHFbaV0pLmldID0gby54KHQpO1xuICAgICAgcmV0dXJuIHMuam9pbihcIlwiKTtcbiAgICB9O1xuICB9O1xufVxuXG5leHBvcnQgdmFyIGludGVycG9sYXRlVHJhbnNmb3JtQ3NzID0gaW50ZXJwb2xhdGVUcmFuc2Zvcm0ocGFyc2VDc3MsIFwicHgsIFwiLCBcInB4KVwiLCBcImRlZylcIik7XG5leHBvcnQgdmFyIGludGVycG9sYXRlVHJhbnNmb3JtU3ZnID0gaW50ZXJwb2xhdGVUcmFuc2Zvcm0ocGFyc2VTdmcsIFwiLCBcIiwgXCIpXCIsIFwiKVwiKTtcbiIsICJ2YXIgZXBzaWxvbjIgPSAxZS0xMjtcblxuZnVuY3Rpb24gY29zaCh4KSB7XG4gIHJldHVybiAoKHggPSBNYXRoLmV4cCh4KSkgKyAxIC8geCkgLyAyO1xufVxuXG5mdW5jdGlvbiBzaW5oKHgpIHtcbiAgcmV0dXJuICgoeCA9IE1hdGguZXhwKHgpKSAtIDEgLyB4KSAvIDI7XG59XG5cbmZ1bmN0aW9uIHRhbmgoeCkge1xuICByZXR1cm4gKCh4ID0gTWF0aC5leHAoMiAqIHgpKSAtIDEpIC8gKHggKyAxKTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgKGZ1bmN0aW9uIHpvb21SaG8ocmhvLCByaG8yLCByaG80KSB7XG5cbiAgLy8gcDAgPSBbdXgwLCB1eTAsIHcwXVxuICAvLyBwMSA9IFt1eDEsIHV5MSwgdzFdXG4gIGZ1bmN0aW9uIHpvb20ocDAsIHAxKSB7XG4gICAgdmFyIHV4MCA9IHAwWzBdLCB1eTAgPSBwMFsxXSwgdzAgPSBwMFsyXSxcbiAgICAgICAgdXgxID0gcDFbMF0sIHV5MSA9IHAxWzFdLCB3MSA9IHAxWzJdLFxuICAgICAgICBkeCA9IHV4MSAtIHV4MCxcbiAgICAgICAgZHkgPSB1eTEgLSB1eTAsXG4gICAgICAgIGQyID0gZHggKiBkeCArIGR5ICogZHksXG4gICAgICAgIGksXG4gICAgICAgIFM7XG5cbiAgICAvLyBTcGVjaWFsIGNhc2UgZm9yIHUwIFx1MjI0NSB1MS5cbiAgICBpZiAoZDIgPCBlcHNpbG9uMikge1xuICAgICAgUyA9IE1hdGgubG9nKHcxIC8gdzApIC8gcmhvO1xuICAgICAgaSA9IGZ1bmN0aW9uKHQpIHtcbiAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICB1eDAgKyB0ICogZHgsXG4gICAgICAgICAgdXkwICsgdCAqIGR5LFxuICAgICAgICAgIHcwICogTWF0aC5leHAocmhvICogdCAqIFMpXG4gICAgICAgIF07XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gR2VuZXJhbCBjYXNlLlxuICAgIGVsc2Uge1xuICAgICAgdmFyIGQxID0gTWF0aC5zcXJ0KGQyKSxcbiAgICAgICAgICBiMCA9ICh3MSAqIHcxIC0gdzAgKiB3MCArIHJobzQgKiBkMikgLyAoMiAqIHcwICogcmhvMiAqIGQxKSxcbiAgICAgICAgICBiMSA9ICh3MSAqIHcxIC0gdzAgKiB3MCAtIHJobzQgKiBkMikgLyAoMiAqIHcxICogcmhvMiAqIGQxKSxcbiAgICAgICAgICByMCA9IE1hdGgubG9nKE1hdGguc3FydChiMCAqIGIwICsgMSkgLSBiMCksXG4gICAgICAgICAgcjEgPSBNYXRoLmxvZyhNYXRoLnNxcnQoYjEgKiBiMSArIDEpIC0gYjEpO1xuICAgICAgUyA9IChyMSAtIHIwKSAvIHJobztcbiAgICAgIGkgPSBmdW5jdGlvbih0KSB7XG4gICAgICAgIHZhciBzID0gdCAqIFMsXG4gICAgICAgICAgICBjb3NocjAgPSBjb3NoKHIwKSxcbiAgICAgICAgICAgIHUgPSB3MCAvIChyaG8yICogZDEpICogKGNvc2hyMCAqIHRhbmgocmhvICogcyArIHIwKSAtIHNpbmgocjApKTtcbiAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICB1eDAgKyB1ICogZHgsXG4gICAgICAgICAgdXkwICsgdSAqIGR5LFxuICAgICAgICAgIHcwICogY29zaHIwIC8gY29zaChyaG8gKiBzICsgcjApXG4gICAgICAgIF07XG4gICAgICB9XG4gICAgfVxuXG4gICAgaS5kdXJhdGlvbiA9IFMgKiAxMDAwICogcmhvIC8gTWF0aC5TUVJUMjtcblxuICAgIHJldHVybiBpO1xuICB9XG5cbiAgem9vbS5yaG8gPSBmdW5jdGlvbihfKSB7XG4gICAgdmFyIF8xID0gTWF0aC5tYXgoMWUtMywgK18pLCBfMiA9IF8xICogXzEsIF80ID0gXzIgKiBfMjtcbiAgICByZXR1cm4gem9vbVJobyhfMSwgXzIsIF80KTtcbiAgfTtcblxuICByZXR1cm4gem9vbTtcbn0pKE1hdGguU1FSVDIsIDIsIDQpO1xuIiwgInZhciBmcmFtZSA9IDAsIC8vIGlzIGFuIGFuaW1hdGlvbiBmcmFtZSBwZW5kaW5nP1xuICAgIHRpbWVvdXQgPSAwLCAvLyBpcyBhIHRpbWVvdXQgcGVuZGluZz9cbiAgICBpbnRlcnZhbCA9IDAsIC8vIGFyZSBhbnkgdGltZXJzIGFjdGl2ZT9cbiAgICBwb2tlRGVsYXkgPSAxMDAwLCAvLyBob3cgZnJlcXVlbnRseSB3ZSBjaGVjayBmb3IgY2xvY2sgc2tld1xuICAgIHRhc2tIZWFkLFxuICAgIHRhc2tUYWlsLFxuICAgIGNsb2NrTGFzdCA9IDAsXG4gICAgY2xvY2tOb3cgPSAwLFxuICAgIGNsb2NrU2tldyA9IDAsXG4gICAgY2xvY2sgPSB0eXBlb2YgcGVyZm9ybWFuY2UgPT09IFwib2JqZWN0XCIgJiYgcGVyZm9ybWFuY2Uubm93ID8gcGVyZm9ybWFuY2UgOiBEYXRlLFxuICAgIHNldEZyYW1lID0gdHlwZW9mIHdpbmRvdyA9PT0gXCJvYmplY3RcIiAmJiB3aW5kb3cucmVxdWVzdEFuaW1hdGlvbkZyYW1lID8gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZS5iaW5kKHdpbmRvdykgOiBmdW5jdGlvbihmKSB7IHNldFRpbWVvdXQoZiwgMTcpOyB9O1xuXG5leHBvcnQgZnVuY3Rpb24gbm93KCkge1xuICByZXR1cm4gY2xvY2tOb3cgfHwgKHNldEZyYW1lKGNsZWFyTm93KSwgY2xvY2tOb3cgPSBjbG9jay5ub3coKSArIGNsb2NrU2tldyk7XG59XG5cbmZ1bmN0aW9uIGNsZWFyTm93KCkge1xuICBjbG9ja05vdyA9IDA7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBUaW1lcigpIHtcbiAgdGhpcy5fY2FsbCA9XG4gIHRoaXMuX3RpbWUgPVxuICB0aGlzLl9uZXh0ID0gbnVsbDtcbn1cblxuVGltZXIucHJvdG90eXBlID0gdGltZXIucHJvdG90eXBlID0ge1xuICBjb25zdHJ1Y3RvcjogVGltZXIsXG4gIHJlc3RhcnQ6IGZ1bmN0aW9uKGNhbGxiYWNrLCBkZWxheSwgdGltZSkge1xuICAgIGlmICh0eXBlb2YgY2FsbGJhY2sgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IFR5cGVFcnJvcihcImNhbGxiYWNrIGlzIG5vdCBhIGZ1bmN0aW9uXCIpO1xuICAgIHRpbWUgPSAodGltZSA9PSBudWxsID8gbm93KCkgOiArdGltZSkgKyAoZGVsYXkgPT0gbnVsbCA/IDAgOiArZGVsYXkpO1xuICAgIGlmICghdGhpcy5fbmV4dCAmJiB0YXNrVGFpbCAhPT0gdGhpcykge1xuICAgICAgaWYgKHRhc2tUYWlsKSB0YXNrVGFpbC5fbmV4dCA9IHRoaXM7XG4gICAgICBlbHNlIHRhc2tIZWFkID0gdGhpcztcbiAgICAgIHRhc2tUYWlsID0gdGhpcztcbiAgICB9XG4gICAgdGhpcy5fY2FsbCA9IGNhbGxiYWNrO1xuICAgIHRoaXMuX3RpbWUgPSB0aW1lO1xuICAgIHNsZWVwKCk7XG4gIH0sXG4gIHN0b3A6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLl9jYWxsKSB7XG4gICAgICB0aGlzLl9jYWxsID0gbnVsbDtcbiAgICAgIHRoaXMuX3RpbWUgPSBJbmZpbml0eTtcbiAgICAgIHNsZWVwKCk7XG4gICAgfVxuICB9XG59O1xuXG5leHBvcnQgZnVuY3Rpb24gdGltZXIoY2FsbGJhY2ssIGRlbGF5LCB0aW1lKSB7XG4gIHZhciB0ID0gbmV3IFRpbWVyO1xuICB0LnJlc3RhcnQoY2FsbGJhY2ssIGRlbGF5LCB0aW1lKTtcbiAgcmV0dXJuIHQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB0aW1lckZsdXNoKCkge1xuICBub3coKTsgLy8gR2V0IHRoZSBjdXJyZW50IHRpbWUsIGlmIG5vdCBhbHJlYWR5IHNldC5cbiAgKytmcmFtZTsgLy8gUHJldGVuZCB3ZVx1MjAxOXZlIHNldCBhbiBhbGFybSwgaWYgd2UgaGF2ZW5cdTIwMTl0IGFscmVhZHkuXG4gIHZhciB0ID0gdGFza0hlYWQsIGU7XG4gIHdoaWxlICh0KSB7XG4gICAgaWYgKChlID0gY2xvY2tOb3cgLSB0Ll90aW1lKSA+PSAwKSB0Ll9jYWxsLmNhbGwodW5kZWZpbmVkLCBlKTtcbiAgICB0ID0gdC5fbmV4dDtcbiAgfVxuICAtLWZyYW1lO1xufVxuXG5mdW5jdGlvbiB3YWtlKCkge1xuICBjbG9ja05vdyA9IChjbG9ja0xhc3QgPSBjbG9jay5ub3coKSkgKyBjbG9ja1NrZXc7XG4gIGZyYW1lID0gdGltZW91dCA9IDA7XG4gIHRyeSB7XG4gICAgdGltZXJGbHVzaCgpO1xuICB9IGZpbmFsbHkge1xuICAgIGZyYW1lID0gMDtcbiAgICBuYXAoKTtcbiAgICBjbG9ja05vdyA9IDA7XG4gIH1cbn1cblxuZnVuY3Rpb24gcG9rZSgpIHtcbiAgdmFyIG5vdyA9IGNsb2NrLm5vdygpLCBkZWxheSA9IG5vdyAtIGNsb2NrTGFzdDtcbiAgaWYgKGRlbGF5ID4gcG9rZURlbGF5KSBjbG9ja1NrZXcgLT0gZGVsYXksIGNsb2NrTGFzdCA9IG5vdztcbn1cblxuZnVuY3Rpb24gbmFwKCkge1xuICB2YXIgdDAsIHQxID0gdGFza0hlYWQsIHQyLCB0aW1lID0gSW5maW5pdHk7XG4gIHdoaWxlICh0MSkge1xuICAgIGlmICh0MS5fY2FsbCkge1xuICAgICAgaWYgKHRpbWUgPiB0MS5fdGltZSkgdGltZSA9IHQxLl90aW1lO1xuICAgICAgdDAgPSB0MSwgdDEgPSB0MS5fbmV4dDtcbiAgICB9IGVsc2Uge1xuICAgICAgdDIgPSB0MS5fbmV4dCwgdDEuX25leHQgPSBudWxsO1xuICAgICAgdDEgPSB0MCA/IHQwLl9uZXh0ID0gdDIgOiB0YXNrSGVhZCA9IHQyO1xuICAgIH1cbiAgfVxuICB0YXNrVGFpbCA9IHQwO1xuICBzbGVlcCh0aW1lKTtcbn1cblxuZnVuY3Rpb24gc2xlZXAodGltZSkge1xuICBpZiAoZnJhbWUpIHJldHVybjsgLy8gU29vbmVzdCBhbGFybSBhbHJlYWR5IHNldCwgb3Igd2lsbCBiZS5cbiAgaWYgKHRpbWVvdXQpIHRpbWVvdXQgPSBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gIHZhciBkZWxheSA9IHRpbWUgLSBjbG9ja05vdzsgLy8gU3RyaWN0bHkgbGVzcyB0aGFuIGlmIHdlIHJlY29tcHV0ZWQgY2xvY2tOb3cuXG4gIGlmIChkZWxheSA+IDI0KSB7XG4gICAgaWYgKHRpbWUgPCBJbmZpbml0eSkgdGltZW91dCA9IHNldFRpbWVvdXQod2FrZSwgdGltZSAtIGNsb2NrLm5vdygpIC0gY2xvY2tTa2V3KTtcbiAgICBpZiAoaW50ZXJ2YWwpIGludGVydmFsID0gY2xlYXJJbnRlcnZhbChpbnRlcnZhbCk7XG4gIH0gZWxzZSB7XG4gICAgaWYgKCFpbnRlcnZhbCkgY2xvY2tMYXN0ID0gY2xvY2subm93KCksIGludGVydmFsID0gc2V0SW50ZXJ2YWwocG9rZSwgcG9rZURlbGF5KTtcbiAgICBmcmFtZSA9IDEsIHNldEZyYW1lKHdha2UpO1xuICB9XG59XG4iLCAiaW1wb3J0IHtUaW1lcn0gZnJvbSBcIi4vdGltZXIuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oY2FsbGJhY2ssIGRlbGF5LCB0aW1lKSB7XG4gIHZhciB0ID0gbmV3IFRpbWVyO1xuICBkZWxheSA9IGRlbGF5ID09IG51bGwgPyAwIDogK2RlbGF5O1xuICB0LnJlc3RhcnQoZWxhcHNlZCA9PiB7XG4gICAgdC5zdG9wKCk7XG4gICAgY2FsbGJhY2soZWxhcHNlZCArIGRlbGF5KTtcbiAgfSwgZGVsYXksIHRpbWUpO1xuICByZXR1cm4gdDtcbn1cbiIsICJpbXBvcnQge2Rpc3BhdGNofSBmcm9tIFwiZDMtZGlzcGF0Y2hcIjtcbmltcG9ydCB7dGltZXIsIHRpbWVvdXR9IGZyb20gXCJkMy10aW1lclwiO1xuXG52YXIgZW1wdHlPbiA9IGRpc3BhdGNoKFwic3RhcnRcIiwgXCJlbmRcIiwgXCJjYW5jZWxcIiwgXCJpbnRlcnJ1cHRcIik7XG52YXIgZW1wdHlUd2VlbiA9IFtdO1xuXG5leHBvcnQgdmFyIENSRUFURUQgPSAwO1xuZXhwb3J0IHZhciBTQ0hFRFVMRUQgPSAxO1xuZXhwb3J0IHZhciBTVEFSVElORyA9IDI7XG5leHBvcnQgdmFyIFNUQVJURUQgPSAzO1xuZXhwb3J0IHZhciBSVU5OSU5HID0gNDtcbmV4cG9ydCB2YXIgRU5ESU5HID0gNTtcbmV4cG9ydCB2YXIgRU5ERUQgPSA2O1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihub2RlLCBuYW1lLCBpZCwgaW5kZXgsIGdyb3VwLCB0aW1pbmcpIHtcbiAgdmFyIHNjaGVkdWxlcyA9IG5vZGUuX190cmFuc2l0aW9uO1xuICBpZiAoIXNjaGVkdWxlcykgbm9kZS5fX3RyYW5zaXRpb24gPSB7fTtcbiAgZWxzZSBpZiAoaWQgaW4gc2NoZWR1bGVzKSByZXR1cm47XG4gIGNyZWF0ZShub2RlLCBpZCwge1xuICAgIG5hbWU6IG5hbWUsXG4gICAgaW5kZXg6IGluZGV4LCAvLyBGb3IgY29udGV4dCBkdXJpbmcgY2FsbGJhY2suXG4gICAgZ3JvdXA6IGdyb3VwLCAvLyBGb3IgY29udGV4dCBkdXJpbmcgY2FsbGJhY2suXG4gICAgb246IGVtcHR5T24sXG4gICAgdHdlZW46IGVtcHR5VHdlZW4sXG4gICAgdGltZTogdGltaW5nLnRpbWUsXG4gICAgZGVsYXk6IHRpbWluZy5kZWxheSxcbiAgICBkdXJhdGlvbjogdGltaW5nLmR1cmF0aW9uLFxuICAgIGVhc2U6IHRpbWluZy5lYXNlLFxuICAgIHRpbWVyOiBudWxsLFxuICAgIHN0YXRlOiBDUkVBVEVEXG4gIH0pO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaW5pdChub2RlLCBpZCkge1xuICB2YXIgc2NoZWR1bGUgPSBnZXQobm9kZSwgaWQpO1xuICBpZiAoc2NoZWR1bGUuc3RhdGUgPiBDUkVBVEVEKSB0aHJvdyBuZXcgRXJyb3IoXCJ0b28gbGF0ZTsgYWxyZWFkeSBzY2hlZHVsZWRcIik7XG4gIHJldHVybiBzY2hlZHVsZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNldChub2RlLCBpZCkge1xuICB2YXIgc2NoZWR1bGUgPSBnZXQobm9kZSwgaWQpO1xuICBpZiAoc2NoZWR1bGUuc3RhdGUgPiBTVEFSVEVEKSB0aHJvdyBuZXcgRXJyb3IoXCJ0b28gbGF0ZTsgYWxyZWFkeSBydW5uaW5nXCIpO1xuICByZXR1cm4gc2NoZWR1bGU7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXQobm9kZSwgaWQpIHtcbiAgdmFyIHNjaGVkdWxlID0gbm9kZS5fX3RyYW5zaXRpb247XG4gIGlmICghc2NoZWR1bGUgfHwgIShzY2hlZHVsZSA9IHNjaGVkdWxlW2lkXSkpIHRocm93IG5ldyBFcnJvcihcInRyYW5zaXRpb24gbm90IGZvdW5kXCIpO1xuICByZXR1cm4gc2NoZWR1bGU7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZShub2RlLCBpZCwgc2VsZikge1xuICB2YXIgc2NoZWR1bGVzID0gbm9kZS5fX3RyYW5zaXRpb24sXG4gICAgICB0d2VlbjtcblxuICAvLyBJbml0aWFsaXplIHRoZSBzZWxmIHRpbWVyIHdoZW4gdGhlIHRyYW5zaXRpb24gaXMgY3JlYXRlZC5cbiAgLy8gTm90ZSB0aGUgYWN0dWFsIGRlbGF5IGlzIG5vdCBrbm93biB1bnRpbCB0aGUgZmlyc3QgY2FsbGJhY2shXG4gIHNjaGVkdWxlc1tpZF0gPSBzZWxmO1xuICBzZWxmLnRpbWVyID0gdGltZXIoc2NoZWR1bGUsIDAsIHNlbGYudGltZSk7XG5cbiAgZnVuY3Rpb24gc2NoZWR1bGUoZWxhcHNlZCkge1xuICAgIHNlbGYuc3RhdGUgPSBTQ0hFRFVMRUQ7XG4gICAgc2VsZi50aW1lci5yZXN0YXJ0KHN0YXJ0LCBzZWxmLmRlbGF5LCBzZWxmLnRpbWUpO1xuXG4gICAgLy8gSWYgdGhlIGVsYXBzZWQgZGVsYXkgaXMgbGVzcyB0aGFuIG91ciBmaXJzdCBzbGVlcCwgc3RhcnQgaW1tZWRpYXRlbHkuXG4gICAgaWYgKHNlbGYuZGVsYXkgPD0gZWxhcHNlZCkgc3RhcnQoZWxhcHNlZCAtIHNlbGYuZGVsYXkpO1xuICB9XG5cbiAgZnVuY3Rpb24gc3RhcnQoZWxhcHNlZCkge1xuICAgIHZhciBpLCBqLCBuLCBvO1xuXG4gICAgLy8gSWYgdGhlIHN0YXRlIGlzIG5vdCBTQ0hFRFVMRUQsIHRoZW4gd2UgcHJldmlvdXNseSBlcnJvcmVkIG9uIHN0YXJ0LlxuICAgIGlmIChzZWxmLnN0YXRlICE9PSBTQ0hFRFVMRUQpIHJldHVybiBzdG9wKCk7XG5cbiAgICBmb3IgKGkgaW4gc2NoZWR1bGVzKSB7XG4gICAgICBvID0gc2NoZWR1bGVzW2ldO1xuICAgICAgaWYgKG8ubmFtZSAhPT0gc2VsZi5uYW1lKSBjb250aW51ZTtcblxuICAgICAgLy8gV2hpbGUgdGhpcyBlbGVtZW50IGFscmVhZHkgaGFzIGEgc3RhcnRpbmcgdHJhbnNpdGlvbiBkdXJpbmcgdGhpcyBmcmFtZSxcbiAgICAgIC8vIGRlZmVyIHN0YXJ0aW5nIGFuIGludGVycnVwdGluZyB0cmFuc2l0aW9uIHVudGlsIHRoYXQgdHJhbnNpdGlvbiBoYXMgYVxuICAgICAgLy8gY2hhbmNlIHRvIHRpY2sgKGFuZCBwb3NzaWJseSBlbmQpOyBzZWUgZDMvZDMtdHJhbnNpdGlvbiM1NCFcbiAgICAgIGlmIChvLnN0YXRlID09PSBTVEFSVEVEKSByZXR1cm4gdGltZW91dChzdGFydCk7XG5cbiAgICAgIC8vIEludGVycnVwdCB0aGUgYWN0aXZlIHRyYW5zaXRpb24sIGlmIGFueS5cbiAgICAgIGlmIChvLnN0YXRlID09PSBSVU5OSU5HKSB7XG4gICAgICAgIG8uc3RhdGUgPSBFTkRFRDtcbiAgICAgICAgby50aW1lci5zdG9wKCk7XG4gICAgICAgIG8ub24uY2FsbChcImludGVycnVwdFwiLCBub2RlLCBub2RlLl9fZGF0YV9fLCBvLmluZGV4LCBvLmdyb3VwKTtcbiAgICAgICAgZGVsZXRlIHNjaGVkdWxlc1tpXTtcbiAgICAgIH1cblxuICAgICAgLy8gQ2FuY2VsIGFueSBwcmUtZW1wdGVkIHRyYW5zaXRpb25zLlxuICAgICAgZWxzZSBpZiAoK2kgPCBpZCkge1xuICAgICAgICBvLnN0YXRlID0gRU5ERUQ7XG4gICAgICAgIG8udGltZXIuc3RvcCgpO1xuICAgICAgICBvLm9uLmNhbGwoXCJjYW5jZWxcIiwgbm9kZSwgbm9kZS5fX2RhdGFfXywgby5pbmRleCwgby5ncm91cCk7XG4gICAgICAgIGRlbGV0ZSBzY2hlZHVsZXNbaV07XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gRGVmZXIgdGhlIGZpcnN0IHRpY2sgdG8gZW5kIG9mIHRoZSBjdXJyZW50IGZyYW1lOyBzZWUgZDMvZDMjMTU3Ni5cbiAgICAvLyBOb3RlIHRoZSB0cmFuc2l0aW9uIG1heSBiZSBjYW5jZWxlZCBhZnRlciBzdGFydCBhbmQgYmVmb3JlIHRoZSBmaXJzdCB0aWNrIVxuICAgIC8vIE5vdGUgdGhpcyBtdXN0IGJlIHNjaGVkdWxlZCBiZWZvcmUgdGhlIHN0YXJ0IGV2ZW50OyBzZWUgZDMvZDMtdHJhbnNpdGlvbiMxNiFcbiAgICAvLyBBc3N1bWluZyB0aGlzIGlzIHN1Y2Nlc3NmdWwsIHN1YnNlcXVlbnQgY2FsbGJhY2tzIGdvIHN0cmFpZ2h0IHRvIHRpY2suXG4gICAgdGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgIGlmIChzZWxmLnN0YXRlID09PSBTVEFSVEVEKSB7XG4gICAgICAgIHNlbGYuc3RhdGUgPSBSVU5OSU5HO1xuICAgICAgICBzZWxmLnRpbWVyLnJlc3RhcnQodGljaywgc2VsZi5kZWxheSwgc2VsZi50aW1lKTtcbiAgICAgICAgdGljayhlbGFwc2VkKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIERpc3BhdGNoIHRoZSBzdGFydCBldmVudC5cbiAgICAvLyBOb3RlIHRoaXMgbXVzdCBiZSBkb25lIGJlZm9yZSB0aGUgdHdlZW4gYXJlIGluaXRpYWxpemVkLlxuICAgIHNlbGYuc3RhdGUgPSBTVEFSVElORztcbiAgICBzZWxmLm9uLmNhbGwoXCJzdGFydFwiLCBub2RlLCBub2RlLl9fZGF0YV9fLCBzZWxmLmluZGV4LCBzZWxmLmdyb3VwKTtcbiAgICBpZiAoc2VsZi5zdGF0ZSAhPT0gU1RBUlRJTkcpIHJldHVybjsgLy8gaW50ZXJydXB0ZWRcbiAgICBzZWxmLnN0YXRlID0gU1RBUlRFRDtcblxuICAgIC8vIEluaXRpYWxpemUgdGhlIHR3ZWVuLCBkZWxldGluZyBudWxsIHR3ZWVuLlxuICAgIHR3ZWVuID0gbmV3IEFycmF5KG4gPSBzZWxmLnR3ZWVuLmxlbmd0aCk7XG4gICAgZm9yIChpID0gMCwgaiA9IC0xOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAobyA9IHNlbGYudHdlZW5baV0udmFsdWUuY2FsbChub2RlLCBub2RlLl9fZGF0YV9fLCBzZWxmLmluZGV4LCBzZWxmLmdyb3VwKSkge1xuICAgICAgICB0d2VlblsrK2pdID0gbztcbiAgICAgIH1cbiAgICB9XG4gICAgdHdlZW4ubGVuZ3RoID0gaiArIDE7XG4gIH1cblxuICBmdW5jdGlvbiB0aWNrKGVsYXBzZWQpIHtcbiAgICB2YXIgdCA9IGVsYXBzZWQgPCBzZWxmLmR1cmF0aW9uID8gc2VsZi5lYXNlLmNhbGwobnVsbCwgZWxhcHNlZCAvIHNlbGYuZHVyYXRpb24pIDogKHNlbGYudGltZXIucmVzdGFydChzdG9wKSwgc2VsZi5zdGF0ZSA9IEVORElORywgMSksXG4gICAgICAgIGkgPSAtMSxcbiAgICAgICAgbiA9IHR3ZWVuLmxlbmd0aDtcblxuICAgIHdoaWxlICgrK2kgPCBuKSB7XG4gICAgICB0d2VlbltpXS5jYWxsKG5vZGUsIHQpO1xuICAgIH1cblxuICAgIC8vIERpc3BhdGNoIHRoZSBlbmQgZXZlbnQuXG4gICAgaWYgKHNlbGYuc3RhdGUgPT09IEVORElORykge1xuICAgICAgc2VsZi5vbi5jYWxsKFwiZW5kXCIsIG5vZGUsIG5vZGUuX19kYXRhX18sIHNlbGYuaW5kZXgsIHNlbGYuZ3JvdXApO1xuICAgICAgc3RvcCgpO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHN0b3AoKSB7XG4gICAgc2VsZi5zdGF0ZSA9IEVOREVEO1xuICAgIHNlbGYudGltZXIuc3RvcCgpO1xuICAgIGRlbGV0ZSBzY2hlZHVsZXNbaWRdO1xuICAgIGZvciAodmFyIGkgaW4gc2NoZWR1bGVzKSByZXR1cm47IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tdW51c2VkLXZhcnNcbiAgICBkZWxldGUgbm9kZS5fX3RyYW5zaXRpb247XG4gIH1cbn1cbiIsICJpbXBvcnQge1NUQVJUSU5HLCBFTkRJTkcsIEVOREVEfSBmcm9tIFwiLi90cmFuc2l0aW9uL3NjaGVkdWxlLmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG5vZGUsIG5hbWUpIHtcbiAgdmFyIHNjaGVkdWxlcyA9IG5vZGUuX190cmFuc2l0aW9uLFxuICAgICAgc2NoZWR1bGUsXG4gICAgICBhY3RpdmUsXG4gICAgICBlbXB0eSA9IHRydWUsXG4gICAgICBpO1xuXG4gIGlmICghc2NoZWR1bGVzKSByZXR1cm47XG5cbiAgbmFtZSA9IG5hbWUgPT0gbnVsbCA/IG51bGwgOiBuYW1lICsgXCJcIjtcblxuICBmb3IgKGkgaW4gc2NoZWR1bGVzKSB7XG4gICAgaWYgKChzY2hlZHVsZSA9IHNjaGVkdWxlc1tpXSkubmFtZSAhPT0gbmFtZSkgeyBlbXB0eSA9IGZhbHNlOyBjb250aW51ZTsgfVxuICAgIGFjdGl2ZSA9IHNjaGVkdWxlLnN0YXRlID4gU1RBUlRJTkcgJiYgc2NoZWR1bGUuc3RhdGUgPCBFTkRJTkc7XG4gICAgc2NoZWR1bGUuc3RhdGUgPSBFTkRFRDtcbiAgICBzY2hlZHVsZS50aW1lci5zdG9wKCk7XG4gICAgc2NoZWR1bGUub24uY2FsbChhY3RpdmUgPyBcImludGVycnVwdFwiIDogXCJjYW5jZWxcIiwgbm9kZSwgbm9kZS5fX2RhdGFfXywgc2NoZWR1bGUuaW5kZXgsIHNjaGVkdWxlLmdyb3VwKTtcbiAgICBkZWxldGUgc2NoZWR1bGVzW2ldO1xuICB9XG5cbiAgaWYgKGVtcHR5KSBkZWxldGUgbm9kZS5fX3RyYW5zaXRpb247XG59XG4iLCAiaW1wb3J0IGludGVycnVwdCBmcm9tIFwiLi4vaW50ZXJydXB0LmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG5hbWUpIHtcbiAgcmV0dXJuIHRoaXMuZWFjaChmdW5jdGlvbigpIHtcbiAgICBpbnRlcnJ1cHQodGhpcywgbmFtZSk7XG4gIH0pO1xufVxuIiwgImltcG9ydCB7Z2V0LCBzZXR9IGZyb20gXCIuL3NjaGVkdWxlLmpzXCI7XG5cbmZ1bmN0aW9uIHR3ZWVuUmVtb3ZlKGlkLCBuYW1lKSB7XG4gIHZhciB0d2VlbjAsIHR3ZWVuMTtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBzY2hlZHVsZSA9IHNldCh0aGlzLCBpZCksXG4gICAgICAgIHR3ZWVuID0gc2NoZWR1bGUudHdlZW47XG5cbiAgICAvLyBJZiB0aGlzIG5vZGUgc2hhcmVkIHR3ZWVuIHdpdGggdGhlIHByZXZpb3VzIG5vZGUsXG4gICAgLy8ganVzdCBhc3NpZ24gdGhlIHVwZGF0ZWQgc2hhcmVkIHR3ZWVuIGFuZCB3ZVx1MjAxOXJlIGRvbmUhXG4gICAgLy8gT3RoZXJ3aXNlLCBjb3B5LW9uLXdyaXRlLlxuICAgIGlmICh0d2VlbiAhPT0gdHdlZW4wKSB7XG4gICAgICB0d2VlbjEgPSB0d2VlbjAgPSB0d2VlbjtcbiAgICAgIGZvciAodmFyIGkgPSAwLCBuID0gdHdlZW4xLmxlbmd0aDsgaSA8IG47ICsraSkge1xuICAgICAgICBpZiAodHdlZW4xW2ldLm5hbWUgPT09IG5hbWUpIHtcbiAgICAgICAgICB0d2VlbjEgPSB0d2VlbjEuc2xpY2UoKTtcbiAgICAgICAgICB0d2VlbjEuc3BsaWNlKGksIDEpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgc2NoZWR1bGUudHdlZW4gPSB0d2VlbjE7XG4gIH07XG59XG5cbmZ1bmN0aW9uIHR3ZWVuRnVuY3Rpb24oaWQsIG5hbWUsIHZhbHVlKSB7XG4gIHZhciB0d2VlbjAsIHR3ZWVuMTtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3I7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2NoZWR1bGUgPSBzZXQodGhpcywgaWQpLFxuICAgICAgICB0d2VlbiA9IHNjaGVkdWxlLnR3ZWVuO1xuXG4gICAgLy8gSWYgdGhpcyBub2RlIHNoYXJlZCB0d2VlbiB3aXRoIHRoZSBwcmV2aW91cyBub2RlLFxuICAgIC8vIGp1c3QgYXNzaWduIHRoZSB1cGRhdGVkIHNoYXJlZCB0d2VlbiBhbmQgd2VcdTIwMTlyZSBkb25lIVxuICAgIC8vIE90aGVyd2lzZSwgY29weS1vbi13cml0ZS5cbiAgICBpZiAodHdlZW4gIT09IHR3ZWVuMCkge1xuICAgICAgdHdlZW4xID0gKHR3ZWVuMCA9IHR3ZWVuKS5zbGljZSgpO1xuICAgICAgZm9yICh2YXIgdCA9IHtuYW1lOiBuYW1lLCB2YWx1ZTogdmFsdWV9LCBpID0gMCwgbiA9IHR3ZWVuMS5sZW5ndGg7IGkgPCBuOyArK2kpIHtcbiAgICAgICAgaWYgKHR3ZWVuMVtpXS5uYW1lID09PSBuYW1lKSB7XG4gICAgICAgICAgdHdlZW4xW2ldID0gdDtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKGkgPT09IG4pIHR3ZWVuMS5wdXNoKHQpO1xuICAgIH1cblxuICAgIHNjaGVkdWxlLnR3ZWVuID0gdHdlZW4xO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihuYW1lLCB2YWx1ZSkge1xuICB2YXIgaWQgPSB0aGlzLl9pZDtcblxuICBuYW1lICs9IFwiXCI7XG5cbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPCAyKSB7XG4gICAgdmFyIHR3ZWVuID0gZ2V0KHRoaXMubm9kZSgpLCBpZCkudHdlZW47XG4gICAgZm9yICh2YXIgaSA9IDAsIG4gPSB0d2Vlbi5sZW5ndGgsIHQ7IGkgPCBuOyArK2kpIHtcbiAgICAgIGlmICgodCA9IHR3ZWVuW2ldKS5uYW1lID09PSBuYW1lKSB7XG4gICAgICAgIHJldHVybiB0LnZhbHVlO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHJldHVybiB0aGlzLmVhY2goKHZhbHVlID09IG51bGwgPyB0d2VlblJlbW92ZSA6IHR3ZWVuRnVuY3Rpb24pKGlkLCBuYW1lLCB2YWx1ZSkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gdHdlZW5WYWx1ZSh0cmFuc2l0aW9uLCBuYW1lLCB2YWx1ZSkge1xuICB2YXIgaWQgPSB0cmFuc2l0aW9uLl9pZDtcblxuICB0cmFuc2l0aW9uLmVhY2goZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNjaGVkdWxlID0gc2V0KHRoaXMsIGlkKTtcbiAgICAoc2NoZWR1bGUudmFsdWUgfHwgKHNjaGVkdWxlLnZhbHVlID0ge30pKVtuYW1lXSA9IHZhbHVlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gIH0pO1xuXG4gIHJldHVybiBmdW5jdGlvbihub2RlKSB7XG4gICAgcmV0dXJuIGdldChub2RlLCBpZCkudmFsdWVbbmFtZV07XG4gIH07XG59XG4iLCAiaW1wb3J0IHtjb2xvcn0gZnJvbSBcImQzLWNvbG9yXCI7XG5pbXBvcnQge2ludGVycG9sYXRlTnVtYmVyLCBpbnRlcnBvbGF0ZVJnYiwgaW50ZXJwb2xhdGVTdHJpbmd9IGZyb20gXCJkMy1pbnRlcnBvbGF0ZVwiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihhLCBiKSB7XG4gIHZhciBjO1xuICByZXR1cm4gKHR5cGVvZiBiID09PSBcIm51bWJlclwiID8gaW50ZXJwb2xhdGVOdW1iZXJcbiAgICAgIDogYiBpbnN0YW5jZW9mIGNvbG9yID8gaW50ZXJwb2xhdGVSZ2JcbiAgICAgIDogKGMgPSBjb2xvcihiKSkgPyAoYiA9IGMsIGludGVycG9sYXRlUmdiKVxuICAgICAgOiBpbnRlcnBvbGF0ZVN0cmluZykoYSwgYik7XG59XG4iLCAiaW1wb3J0IHtpbnRlcnBvbGF0ZVRyYW5zZm9ybVN2ZyBhcyBpbnRlcnBvbGF0ZVRyYW5zZm9ybX0gZnJvbSBcImQzLWludGVycG9sYXRlXCI7XG5pbXBvcnQge25hbWVzcGFjZX0gZnJvbSBcImQzLXNlbGVjdGlvblwiO1xuaW1wb3J0IHt0d2VlblZhbHVlfSBmcm9tIFwiLi90d2Vlbi5qc1wiO1xuaW1wb3J0IGludGVycG9sYXRlIGZyb20gXCIuL2ludGVycG9sYXRlLmpzXCI7XG5cbmZ1bmN0aW9uIGF0dHJSZW1vdmUobmFtZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5yZW1vdmVBdHRyaWJ1dGUobmFtZSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGF0dHJSZW1vdmVOUyhmdWxsbmFtZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5yZW1vdmVBdHRyaWJ1dGVOUyhmdWxsbmFtZS5zcGFjZSwgZnVsbG5hbWUubG9jYWwpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBhdHRyQ29uc3RhbnQobmFtZSwgaW50ZXJwb2xhdGUsIHZhbHVlMSkge1xuICB2YXIgc3RyaW5nMDAsXG4gICAgICBzdHJpbmcxID0gdmFsdWUxICsgXCJcIixcbiAgICAgIGludGVycG9sYXRlMDtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBzdHJpbmcwID0gdGhpcy5nZXRBdHRyaWJ1dGUobmFtZSk7XG4gICAgcmV0dXJuIHN0cmluZzAgPT09IHN0cmluZzEgPyBudWxsXG4gICAgICAgIDogc3RyaW5nMCA9PT0gc3RyaW5nMDAgPyBpbnRlcnBvbGF0ZTBcbiAgICAgICAgOiBpbnRlcnBvbGF0ZTAgPSBpbnRlcnBvbGF0ZShzdHJpbmcwMCA9IHN0cmluZzAsIHZhbHVlMSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGF0dHJDb25zdGFudE5TKGZ1bGxuYW1lLCBpbnRlcnBvbGF0ZSwgdmFsdWUxKSB7XG4gIHZhciBzdHJpbmcwMCxcbiAgICAgIHN0cmluZzEgPSB2YWx1ZTEgKyBcIlwiLFxuICAgICAgaW50ZXJwb2xhdGUwO1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHN0cmluZzAgPSB0aGlzLmdldEF0dHJpYnV0ZU5TKGZ1bGxuYW1lLnNwYWNlLCBmdWxsbmFtZS5sb2NhbCk7XG4gICAgcmV0dXJuIHN0cmluZzAgPT09IHN0cmluZzEgPyBudWxsXG4gICAgICAgIDogc3RyaW5nMCA9PT0gc3RyaW5nMDAgPyBpbnRlcnBvbGF0ZTBcbiAgICAgICAgOiBpbnRlcnBvbGF0ZTAgPSBpbnRlcnBvbGF0ZShzdHJpbmcwMCA9IHN0cmluZzAsIHZhbHVlMSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGF0dHJGdW5jdGlvbihuYW1lLCBpbnRlcnBvbGF0ZSwgdmFsdWUpIHtcbiAgdmFyIHN0cmluZzAwLFxuICAgICAgc3RyaW5nMTAsXG4gICAgICBpbnRlcnBvbGF0ZTA7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc3RyaW5nMCwgdmFsdWUxID0gdmFsdWUodGhpcyksIHN0cmluZzE7XG4gICAgaWYgKHZhbHVlMSA9PSBudWxsKSByZXR1cm4gdm9pZCB0aGlzLnJlbW92ZUF0dHJpYnV0ZShuYW1lKTtcbiAgICBzdHJpbmcwID0gdGhpcy5nZXRBdHRyaWJ1dGUobmFtZSk7XG4gICAgc3RyaW5nMSA9IHZhbHVlMSArIFwiXCI7XG4gICAgcmV0dXJuIHN0cmluZzAgPT09IHN0cmluZzEgPyBudWxsXG4gICAgICAgIDogc3RyaW5nMCA9PT0gc3RyaW5nMDAgJiYgc3RyaW5nMSA9PT0gc3RyaW5nMTAgPyBpbnRlcnBvbGF0ZTBcbiAgICAgICAgOiAoc3RyaW5nMTAgPSBzdHJpbmcxLCBpbnRlcnBvbGF0ZTAgPSBpbnRlcnBvbGF0ZShzdHJpbmcwMCA9IHN0cmluZzAsIHZhbHVlMSkpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBhdHRyRnVuY3Rpb25OUyhmdWxsbmFtZSwgaW50ZXJwb2xhdGUsIHZhbHVlKSB7XG4gIHZhciBzdHJpbmcwMCxcbiAgICAgIHN0cmluZzEwLFxuICAgICAgaW50ZXJwb2xhdGUwO1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHN0cmluZzAsIHZhbHVlMSA9IHZhbHVlKHRoaXMpLCBzdHJpbmcxO1xuICAgIGlmICh2YWx1ZTEgPT0gbnVsbCkgcmV0dXJuIHZvaWQgdGhpcy5yZW1vdmVBdHRyaWJ1dGVOUyhmdWxsbmFtZS5zcGFjZSwgZnVsbG5hbWUubG9jYWwpO1xuICAgIHN0cmluZzAgPSB0aGlzLmdldEF0dHJpYnV0ZU5TKGZ1bGxuYW1lLnNwYWNlLCBmdWxsbmFtZS5sb2NhbCk7XG4gICAgc3RyaW5nMSA9IHZhbHVlMSArIFwiXCI7XG4gICAgcmV0dXJuIHN0cmluZzAgPT09IHN0cmluZzEgPyBudWxsXG4gICAgICAgIDogc3RyaW5nMCA9PT0gc3RyaW5nMDAgJiYgc3RyaW5nMSA9PT0gc3RyaW5nMTAgPyBpbnRlcnBvbGF0ZTBcbiAgICAgICAgOiAoc3RyaW5nMTAgPSBzdHJpbmcxLCBpbnRlcnBvbGF0ZTAgPSBpbnRlcnBvbGF0ZShzdHJpbmcwMCA9IHN0cmluZzAsIHZhbHVlMSkpO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihuYW1lLCB2YWx1ZSkge1xuICB2YXIgZnVsbG5hbWUgPSBuYW1lc3BhY2UobmFtZSksIGkgPSBmdWxsbmFtZSA9PT0gXCJ0cmFuc2Zvcm1cIiA/IGludGVycG9sYXRlVHJhbnNmb3JtIDogaW50ZXJwb2xhdGU7XG4gIHJldHVybiB0aGlzLmF0dHJUd2VlbihuYW1lLCB0eXBlb2YgdmFsdWUgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgPyAoZnVsbG5hbWUubG9jYWwgPyBhdHRyRnVuY3Rpb25OUyA6IGF0dHJGdW5jdGlvbikoZnVsbG5hbWUsIGksIHR3ZWVuVmFsdWUodGhpcywgXCJhdHRyLlwiICsgbmFtZSwgdmFsdWUpKVxuICAgICAgOiB2YWx1ZSA9PSBudWxsID8gKGZ1bGxuYW1lLmxvY2FsID8gYXR0clJlbW92ZU5TIDogYXR0clJlbW92ZSkoZnVsbG5hbWUpXG4gICAgICA6IChmdWxsbmFtZS5sb2NhbCA/IGF0dHJDb25zdGFudE5TIDogYXR0ckNvbnN0YW50KShmdWxsbmFtZSwgaSwgdmFsdWUpKTtcbn1cbiIsICJpbXBvcnQge25hbWVzcGFjZX0gZnJvbSBcImQzLXNlbGVjdGlvblwiO1xuXG5mdW5jdGlvbiBhdHRySW50ZXJwb2xhdGUobmFtZSwgaSkge1xuICByZXR1cm4gZnVuY3Rpb24odCkge1xuICAgIHRoaXMuc2V0QXR0cmlidXRlKG5hbWUsIGkuY2FsbCh0aGlzLCB0KSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGF0dHJJbnRlcnBvbGF0ZU5TKGZ1bGxuYW1lLCBpKSB7XG4gIHJldHVybiBmdW5jdGlvbih0KSB7XG4gICAgdGhpcy5zZXRBdHRyaWJ1dGVOUyhmdWxsbmFtZS5zcGFjZSwgZnVsbG5hbWUubG9jYWwsIGkuY2FsbCh0aGlzLCB0KSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGF0dHJUd2Vlbk5TKGZ1bGxuYW1lLCB2YWx1ZSkge1xuICB2YXIgdDAsIGkwO1xuICBmdW5jdGlvbiB0d2VlbigpIHtcbiAgICB2YXIgaSA9IHZhbHVlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgaWYgKGkgIT09IGkwKSB0MCA9IChpMCA9IGkpICYmIGF0dHJJbnRlcnBvbGF0ZU5TKGZ1bGxuYW1lLCBpKTtcbiAgICByZXR1cm4gdDA7XG4gIH1cbiAgdHdlZW4uX3ZhbHVlID0gdmFsdWU7XG4gIHJldHVybiB0d2Vlbjtcbn1cblxuZnVuY3Rpb24gYXR0clR3ZWVuKG5hbWUsIHZhbHVlKSB7XG4gIHZhciB0MCwgaTA7XG4gIGZ1bmN0aW9uIHR3ZWVuKCkge1xuICAgIHZhciBpID0gdmFsdWUuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICBpZiAoaSAhPT0gaTApIHQwID0gKGkwID0gaSkgJiYgYXR0ckludGVycG9sYXRlKG5hbWUsIGkpO1xuICAgIHJldHVybiB0MDtcbiAgfVxuICB0d2Vlbi5fdmFsdWUgPSB2YWx1ZTtcbiAgcmV0dXJuIHR3ZWVuO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihuYW1lLCB2YWx1ZSkge1xuICB2YXIga2V5ID0gXCJhdHRyLlwiICsgbmFtZTtcbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPCAyKSByZXR1cm4gKGtleSA9IHRoaXMudHdlZW4oa2V5KSkgJiYga2V5Ll92YWx1ZTtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiB0aGlzLnR3ZWVuKGtleSwgbnVsbCk7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yO1xuICB2YXIgZnVsbG5hbWUgPSBuYW1lc3BhY2UobmFtZSk7XG4gIHJldHVybiB0aGlzLnR3ZWVuKGtleSwgKGZ1bGxuYW1lLmxvY2FsID8gYXR0clR3ZWVuTlMgOiBhdHRyVHdlZW4pKGZ1bGxuYW1lLCB2YWx1ZSkpO1xufVxuIiwgImltcG9ydCB7Z2V0LCBpbml0fSBmcm9tIFwiLi9zY2hlZHVsZS5qc1wiO1xuXG5mdW5jdGlvbiBkZWxheUZ1bmN0aW9uKGlkLCB2YWx1ZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgaW5pdCh0aGlzLCBpZCkuZGVsYXkgPSArdmFsdWUuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gZGVsYXlDb25zdGFudChpZCwgdmFsdWUpIHtcbiAgcmV0dXJuIHZhbHVlID0gK3ZhbHVlLCBmdW5jdGlvbigpIHtcbiAgICBpbml0KHRoaXMsIGlkKS5kZWxheSA9IHZhbHVlO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih2YWx1ZSkge1xuICB2YXIgaWQgPSB0aGlzLl9pZDtcblxuICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aFxuICAgICAgPyB0aGlzLmVhY2goKHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgICAgICAgPyBkZWxheUZ1bmN0aW9uXG4gICAgICAgICAgOiBkZWxheUNvbnN0YW50KShpZCwgdmFsdWUpKVxuICAgICAgOiBnZXQodGhpcy5ub2RlKCksIGlkKS5kZWxheTtcbn1cbiIsICJpbXBvcnQge2dldCwgc2V0fSBmcm9tIFwiLi9zY2hlZHVsZS5qc1wiO1xuXG5mdW5jdGlvbiBkdXJhdGlvbkZ1bmN0aW9uKGlkLCB2YWx1ZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgc2V0KHRoaXMsIGlkKS5kdXJhdGlvbiA9ICt2YWx1ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBkdXJhdGlvbkNvbnN0YW50KGlkLCB2YWx1ZSkge1xuICByZXR1cm4gdmFsdWUgPSArdmFsdWUsIGZ1bmN0aW9uKCkge1xuICAgIHNldCh0aGlzLCBpZCkuZHVyYXRpb24gPSB2YWx1ZTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24odmFsdWUpIHtcbiAgdmFyIGlkID0gdGhpcy5faWQ7XG5cbiAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGhcbiAgICAgID8gdGhpcy5lYWNoKCh0eXBlb2YgdmFsdWUgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgICAgID8gZHVyYXRpb25GdW5jdGlvblxuICAgICAgICAgIDogZHVyYXRpb25Db25zdGFudCkoaWQsIHZhbHVlKSlcbiAgICAgIDogZ2V0KHRoaXMubm9kZSgpLCBpZCkuZHVyYXRpb247XG59XG4iLCAiaW1wb3J0IHtnZXQsIHNldH0gZnJvbSBcIi4vc2NoZWR1bGUuanNcIjtcblxuZnVuY3Rpb24gZWFzZUNvbnN0YW50KGlkLCB2YWx1ZSkge1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcjtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHNldCh0aGlzLCBpZCkuZWFzZSA9IHZhbHVlO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih2YWx1ZSkge1xuICB2YXIgaWQgPSB0aGlzLl9pZDtcblxuICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aFxuICAgICAgPyB0aGlzLmVhY2goZWFzZUNvbnN0YW50KGlkLCB2YWx1ZSkpXG4gICAgICA6IGdldCh0aGlzLm5vZGUoKSwgaWQpLmVhc2U7XG59XG4iLCAiaW1wb3J0IHtzZXR9IGZyb20gXCIuL3NjaGVkdWxlLmpzXCI7XG5cbmZ1bmN0aW9uIGVhc2VWYXJ5aW5nKGlkLCB2YWx1ZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHYgPSB2YWx1ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIGlmICh0eXBlb2YgdiAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3I7XG4gICAgc2V0KHRoaXMsIGlkKS5lYXNlID0gdjtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24odmFsdWUpIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3I7XG4gIHJldHVybiB0aGlzLmVhY2goZWFzZVZhcnlpbmcodGhpcy5faWQsIHZhbHVlKSk7XG59XG4iLCAiaW1wb3J0IHttYXRjaGVyfSBmcm9tIFwiZDMtc2VsZWN0aW9uXCI7XG5pbXBvcnQge1RyYW5zaXRpb259IGZyb20gXCIuL2luZGV4LmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG1hdGNoKSB7XG4gIGlmICh0eXBlb2YgbWF0Y2ggIT09IFwiZnVuY3Rpb25cIikgbWF0Y2ggPSBtYXRjaGVyKG1hdGNoKTtcblxuICBmb3IgKHZhciBncm91cHMgPSB0aGlzLl9ncm91cHMsIG0gPSBncm91cHMubGVuZ3RoLCBzdWJncm91cHMgPSBuZXcgQXJyYXkobSksIGogPSAwOyBqIDwgbTsgKytqKSB7XG4gICAgZm9yICh2YXIgZ3JvdXAgPSBncm91cHNbal0sIG4gPSBncm91cC5sZW5ndGgsIHN1Ymdyb3VwID0gc3ViZ3JvdXBzW2pdID0gW10sIG5vZGUsIGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAoKG5vZGUgPSBncm91cFtpXSkgJiYgbWF0Y2guY2FsbChub2RlLCBub2RlLl9fZGF0YV9fLCBpLCBncm91cCkpIHtcbiAgICAgICAgc3ViZ3JvdXAucHVzaChub2RlKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gbmV3IFRyYW5zaXRpb24oc3ViZ3JvdXBzLCB0aGlzLl9wYXJlbnRzLCB0aGlzLl9uYW1lLCB0aGlzLl9pZCk7XG59XG4iLCAiaW1wb3J0IHtUcmFuc2l0aW9ufSBmcm9tIFwiLi9pbmRleC5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih0cmFuc2l0aW9uKSB7XG4gIGlmICh0cmFuc2l0aW9uLl9pZCAhPT0gdGhpcy5faWQpIHRocm93IG5ldyBFcnJvcjtcblxuICBmb3IgKHZhciBncm91cHMwID0gdGhpcy5fZ3JvdXBzLCBncm91cHMxID0gdHJhbnNpdGlvbi5fZ3JvdXBzLCBtMCA9IGdyb3VwczAubGVuZ3RoLCBtMSA9IGdyb3VwczEubGVuZ3RoLCBtID0gTWF0aC5taW4obTAsIG0xKSwgbWVyZ2VzID0gbmV3IEFycmF5KG0wKSwgaiA9IDA7IGogPCBtOyArK2opIHtcbiAgICBmb3IgKHZhciBncm91cDAgPSBncm91cHMwW2pdLCBncm91cDEgPSBncm91cHMxW2pdLCBuID0gZ3JvdXAwLmxlbmd0aCwgbWVyZ2UgPSBtZXJnZXNbal0gPSBuZXcgQXJyYXkobiksIG5vZGUsIGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAobm9kZSA9IGdyb3VwMFtpXSB8fCBncm91cDFbaV0pIHtcbiAgICAgICAgbWVyZ2VbaV0gPSBub2RlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGZvciAoOyBqIDwgbTA7ICsraikge1xuICAgIG1lcmdlc1tqXSA9IGdyb3VwczBbal07XG4gIH1cblxuICByZXR1cm4gbmV3IFRyYW5zaXRpb24obWVyZ2VzLCB0aGlzLl9wYXJlbnRzLCB0aGlzLl9uYW1lLCB0aGlzLl9pZCk7XG59XG4iLCAiaW1wb3J0IHtnZXQsIHNldCwgaW5pdH0gZnJvbSBcIi4vc2NoZWR1bGUuanNcIjtcblxuZnVuY3Rpb24gc3RhcnQobmFtZSkge1xuICByZXR1cm4gKG5hbWUgKyBcIlwiKS50cmltKCkuc3BsaXQoL158XFxzKy8pLmV2ZXJ5KGZ1bmN0aW9uKHQpIHtcbiAgICB2YXIgaSA9IHQuaW5kZXhPZihcIi5cIik7XG4gICAgaWYgKGkgPj0gMCkgdCA9IHQuc2xpY2UoMCwgaSk7XG4gICAgcmV0dXJuICF0IHx8IHQgPT09IFwic3RhcnRcIjtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIG9uRnVuY3Rpb24oaWQsIG5hbWUsIGxpc3RlbmVyKSB7XG4gIHZhciBvbjAsIG9uMSwgc2l0ID0gc3RhcnQobmFtZSkgPyBpbml0IDogc2V0O1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNjaGVkdWxlID0gc2l0KHRoaXMsIGlkKSxcbiAgICAgICAgb24gPSBzY2hlZHVsZS5vbjtcblxuICAgIC8vIElmIHRoaXMgbm9kZSBzaGFyZWQgYSBkaXNwYXRjaCB3aXRoIHRoZSBwcmV2aW91cyBub2RlLFxuICAgIC8vIGp1c3QgYXNzaWduIHRoZSB1cGRhdGVkIHNoYXJlZCBkaXNwYXRjaCBhbmQgd2VcdTIwMTlyZSBkb25lIVxuICAgIC8vIE90aGVyd2lzZSwgY29weS1vbi13cml0ZS5cbiAgICBpZiAob24gIT09IG9uMCkgKG9uMSA9IChvbjAgPSBvbikuY29weSgpKS5vbihuYW1lLCBsaXN0ZW5lcik7XG5cbiAgICBzY2hlZHVsZS5vbiA9IG9uMTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSwgbGlzdGVuZXIpIHtcbiAgdmFyIGlkID0gdGhpcy5faWQ7XG5cbiAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPCAyXG4gICAgICA/IGdldCh0aGlzLm5vZGUoKSwgaWQpLm9uLm9uKG5hbWUpXG4gICAgICA6IHRoaXMuZWFjaChvbkZ1bmN0aW9uKGlkLCBuYW1lLCBsaXN0ZW5lcikpO1xufVxuIiwgImZ1bmN0aW9uIHJlbW92ZUZ1bmN0aW9uKGlkKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgcGFyZW50ID0gdGhpcy5wYXJlbnROb2RlO1xuICAgIGZvciAodmFyIGkgaW4gdGhpcy5fX3RyYW5zaXRpb24pIGlmICgraSAhPT0gaWQpIHJldHVybjtcbiAgICBpZiAocGFyZW50KSBwYXJlbnQucmVtb3ZlQ2hpbGQodGhpcyk7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5vbihcImVuZC5yZW1vdmVcIiwgcmVtb3ZlRnVuY3Rpb24odGhpcy5faWQpKTtcbn1cbiIsICJpbXBvcnQge3NlbGVjdG9yfSBmcm9tIFwiZDMtc2VsZWN0aW9uXCI7XG5pbXBvcnQge1RyYW5zaXRpb259IGZyb20gXCIuL2luZGV4LmpzXCI7XG5pbXBvcnQgc2NoZWR1bGUsIHtnZXR9IGZyb20gXCIuL3NjaGVkdWxlLmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHNlbGVjdCkge1xuICB2YXIgbmFtZSA9IHRoaXMuX25hbWUsXG4gICAgICBpZCA9IHRoaXMuX2lkO1xuXG4gIGlmICh0eXBlb2Ygc2VsZWN0ICE9PSBcImZ1bmN0aW9uXCIpIHNlbGVjdCA9IHNlbGVjdG9yKHNlbGVjdCk7XG5cbiAgZm9yICh2YXIgZ3JvdXBzID0gdGhpcy5fZ3JvdXBzLCBtID0gZ3JvdXBzLmxlbmd0aCwgc3ViZ3JvdXBzID0gbmV3IEFycmF5KG0pLCBqID0gMDsgaiA8IG07ICsraikge1xuICAgIGZvciAodmFyIGdyb3VwID0gZ3JvdXBzW2pdLCBuID0gZ3JvdXAubGVuZ3RoLCBzdWJncm91cCA9IHN1Ymdyb3Vwc1tqXSA9IG5ldyBBcnJheShuKSwgbm9kZSwgc3Vibm9kZSwgaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIGlmICgobm9kZSA9IGdyb3VwW2ldKSAmJiAoc3Vibm9kZSA9IHNlbGVjdC5jYWxsKG5vZGUsIG5vZGUuX19kYXRhX18sIGksIGdyb3VwKSkpIHtcbiAgICAgICAgaWYgKFwiX19kYXRhX19cIiBpbiBub2RlKSBzdWJub2RlLl9fZGF0YV9fID0gbm9kZS5fX2RhdGFfXztcbiAgICAgICAgc3ViZ3JvdXBbaV0gPSBzdWJub2RlO1xuICAgICAgICBzY2hlZHVsZShzdWJncm91cFtpXSwgbmFtZSwgaWQsIGksIHN1Ymdyb3VwLCBnZXQobm9kZSwgaWQpKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gbmV3IFRyYW5zaXRpb24oc3ViZ3JvdXBzLCB0aGlzLl9wYXJlbnRzLCBuYW1lLCBpZCk7XG59XG4iLCAiaW1wb3J0IHtzZWxlY3RvckFsbH0gZnJvbSBcImQzLXNlbGVjdGlvblwiO1xuaW1wb3J0IHtUcmFuc2l0aW9ufSBmcm9tIFwiLi9pbmRleC5qc1wiO1xuaW1wb3J0IHNjaGVkdWxlLCB7Z2V0fSBmcm9tIFwiLi9zY2hlZHVsZS5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihzZWxlY3QpIHtcbiAgdmFyIG5hbWUgPSB0aGlzLl9uYW1lLFxuICAgICAgaWQgPSB0aGlzLl9pZDtcblxuICBpZiAodHlwZW9mIHNlbGVjdCAhPT0gXCJmdW5jdGlvblwiKSBzZWxlY3QgPSBzZWxlY3RvckFsbChzZWxlY3QpO1xuXG4gIGZvciAodmFyIGdyb3VwcyA9IHRoaXMuX2dyb3VwcywgbSA9IGdyb3Vwcy5sZW5ndGgsIHN1Ymdyb3VwcyA9IFtdLCBwYXJlbnRzID0gW10sIGogPSAwOyBqIDwgbTsgKytqKSB7XG4gICAgZm9yICh2YXIgZ3JvdXAgPSBncm91cHNbal0sIG4gPSBncm91cC5sZW5ndGgsIG5vZGUsIGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAobm9kZSA9IGdyb3VwW2ldKSB7XG4gICAgICAgIGZvciAodmFyIGNoaWxkcmVuID0gc2VsZWN0LmNhbGwobm9kZSwgbm9kZS5fX2RhdGFfXywgaSwgZ3JvdXApLCBjaGlsZCwgaW5oZXJpdCA9IGdldChub2RlLCBpZCksIGsgPSAwLCBsID0gY2hpbGRyZW4ubGVuZ3RoOyBrIDwgbDsgKytrKSB7XG4gICAgICAgICAgaWYgKGNoaWxkID0gY2hpbGRyZW5ba10pIHtcbiAgICAgICAgICAgIHNjaGVkdWxlKGNoaWxkLCBuYW1lLCBpZCwgaywgY2hpbGRyZW4sIGluaGVyaXQpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBzdWJncm91cHMucHVzaChjaGlsZHJlbik7XG4gICAgICAgIHBhcmVudHMucHVzaChub2RlKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gbmV3IFRyYW5zaXRpb24oc3ViZ3JvdXBzLCBwYXJlbnRzLCBuYW1lLCBpZCk7XG59XG4iLCAiaW1wb3J0IHtzZWxlY3Rpb259IGZyb20gXCJkMy1zZWxlY3Rpb25cIjtcblxudmFyIFNlbGVjdGlvbiA9IHNlbGVjdGlvbi5wcm90b3R5cGUuY29uc3RydWN0b3I7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gbmV3IFNlbGVjdGlvbih0aGlzLl9ncm91cHMsIHRoaXMuX3BhcmVudHMpO1xufVxuIiwgImltcG9ydCB7aW50ZXJwb2xhdGVUcmFuc2Zvcm1Dc3MgYXMgaW50ZXJwb2xhdGVUcmFuc2Zvcm19IGZyb20gXCJkMy1pbnRlcnBvbGF0ZVwiO1xuaW1wb3J0IHtzdHlsZX0gZnJvbSBcImQzLXNlbGVjdGlvblwiO1xuaW1wb3J0IHtzZXR9IGZyb20gXCIuL3NjaGVkdWxlLmpzXCI7XG5pbXBvcnQge3R3ZWVuVmFsdWV9IGZyb20gXCIuL3R3ZWVuLmpzXCI7XG5pbXBvcnQgaW50ZXJwb2xhdGUgZnJvbSBcIi4vaW50ZXJwb2xhdGUuanNcIjtcblxuZnVuY3Rpb24gc3R5bGVOdWxsKG5hbWUsIGludGVycG9sYXRlKSB7XG4gIHZhciBzdHJpbmcwMCxcbiAgICAgIHN0cmluZzEwLFxuICAgICAgaW50ZXJwb2xhdGUwO1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHN0cmluZzAgPSBzdHlsZSh0aGlzLCBuYW1lKSxcbiAgICAgICAgc3RyaW5nMSA9ICh0aGlzLnN0eWxlLnJlbW92ZVByb3BlcnR5KG5hbWUpLCBzdHlsZSh0aGlzLCBuYW1lKSk7XG4gICAgcmV0dXJuIHN0cmluZzAgPT09IHN0cmluZzEgPyBudWxsXG4gICAgICAgIDogc3RyaW5nMCA9PT0gc3RyaW5nMDAgJiYgc3RyaW5nMSA9PT0gc3RyaW5nMTAgPyBpbnRlcnBvbGF0ZTBcbiAgICAgICAgOiBpbnRlcnBvbGF0ZTAgPSBpbnRlcnBvbGF0ZShzdHJpbmcwMCA9IHN0cmluZzAsIHN0cmluZzEwID0gc3RyaW5nMSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIHN0eWxlUmVtb3ZlKG5hbWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuc3R5bGUucmVtb3ZlUHJvcGVydHkobmFtZSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIHN0eWxlQ29uc3RhbnQobmFtZSwgaW50ZXJwb2xhdGUsIHZhbHVlMSkge1xuICB2YXIgc3RyaW5nMDAsXG4gICAgICBzdHJpbmcxID0gdmFsdWUxICsgXCJcIixcbiAgICAgIGludGVycG9sYXRlMDtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBzdHJpbmcwID0gc3R5bGUodGhpcywgbmFtZSk7XG4gICAgcmV0dXJuIHN0cmluZzAgPT09IHN0cmluZzEgPyBudWxsXG4gICAgICAgIDogc3RyaW5nMCA9PT0gc3RyaW5nMDAgPyBpbnRlcnBvbGF0ZTBcbiAgICAgICAgOiBpbnRlcnBvbGF0ZTAgPSBpbnRlcnBvbGF0ZShzdHJpbmcwMCA9IHN0cmluZzAsIHZhbHVlMSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIHN0eWxlRnVuY3Rpb24obmFtZSwgaW50ZXJwb2xhdGUsIHZhbHVlKSB7XG4gIHZhciBzdHJpbmcwMCxcbiAgICAgIHN0cmluZzEwLFxuICAgICAgaW50ZXJwb2xhdGUwO1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHN0cmluZzAgPSBzdHlsZSh0aGlzLCBuYW1lKSxcbiAgICAgICAgdmFsdWUxID0gdmFsdWUodGhpcyksXG4gICAgICAgIHN0cmluZzEgPSB2YWx1ZTEgKyBcIlwiO1xuICAgIGlmICh2YWx1ZTEgPT0gbnVsbCkgc3RyaW5nMSA9IHZhbHVlMSA9ICh0aGlzLnN0eWxlLnJlbW92ZVByb3BlcnR5KG5hbWUpLCBzdHlsZSh0aGlzLCBuYW1lKSk7XG4gICAgcmV0dXJuIHN0cmluZzAgPT09IHN0cmluZzEgPyBudWxsXG4gICAgICAgIDogc3RyaW5nMCA9PT0gc3RyaW5nMDAgJiYgc3RyaW5nMSA9PT0gc3RyaW5nMTAgPyBpbnRlcnBvbGF0ZTBcbiAgICAgICAgOiAoc3RyaW5nMTAgPSBzdHJpbmcxLCBpbnRlcnBvbGF0ZTAgPSBpbnRlcnBvbGF0ZShzdHJpbmcwMCA9IHN0cmluZzAsIHZhbHVlMSkpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBzdHlsZU1heWJlUmVtb3ZlKGlkLCBuYW1lKSB7XG4gIHZhciBvbjAsIG9uMSwgbGlzdGVuZXIwLCBrZXkgPSBcInN0eWxlLlwiICsgbmFtZSwgZXZlbnQgPSBcImVuZC5cIiArIGtleSwgcmVtb3ZlO1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNjaGVkdWxlID0gc2V0KHRoaXMsIGlkKSxcbiAgICAgICAgb24gPSBzY2hlZHVsZS5vbixcbiAgICAgICAgbGlzdGVuZXIgPSBzY2hlZHVsZS52YWx1ZVtrZXldID09IG51bGwgPyByZW1vdmUgfHwgKHJlbW92ZSA9IHN0eWxlUmVtb3ZlKG5hbWUpKSA6IHVuZGVmaW5lZDtcblxuICAgIC8vIElmIHRoaXMgbm9kZSBzaGFyZWQgYSBkaXNwYXRjaCB3aXRoIHRoZSBwcmV2aW91cyBub2RlLFxuICAgIC8vIGp1c3QgYXNzaWduIHRoZSB1cGRhdGVkIHNoYXJlZCBkaXNwYXRjaCBhbmQgd2VcdTIwMTlyZSBkb25lIVxuICAgIC8vIE90aGVyd2lzZSwgY29weS1vbi13cml0ZS5cbiAgICBpZiAob24gIT09IG9uMCB8fCBsaXN0ZW5lcjAgIT09IGxpc3RlbmVyKSAob24xID0gKG9uMCA9IG9uKS5jb3B5KCkpLm9uKGV2ZW50LCBsaXN0ZW5lcjAgPSBsaXN0ZW5lcik7XG5cbiAgICBzY2hlZHVsZS5vbiA9IG9uMTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSwgdmFsdWUsIHByaW9yaXR5KSB7XG4gIHZhciBpID0gKG5hbWUgKz0gXCJcIikgPT09IFwidHJhbnNmb3JtXCIgPyBpbnRlcnBvbGF0ZVRyYW5zZm9ybSA6IGludGVycG9sYXRlO1xuICByZXR1cm4gdmFsdWUgPT0gbnVsbCA/IHRoaXNcbiAgICAgIC5zdHlsZVR3ZWVuKG5hbWUsIHN0eWxlTnVsbChuYW1lLCBpKSlcbiAgICAgIC5vbihcImVuZC5zdHlsZS5cIiArIG5hbWUsIHN0eWxlUmVtb3ZlKG5hbWUpKVxuICAgIDogdHlwZW9mIHZhbHVlID09PSBcImZ1bmN0aW9uXCIgPyB0aGlzXG4gICAgICAuc3R5bGVUd2VlbihuYW1lLCBzdHlsZUZ1bmN0aW9uKG5hbWUsIGksIHR3ZWVuVmFsdWUodGhpcywgXCJzdHlsZS5cIiArIG5hbWUsIHZhbHVlKSkpXG4gICAgICAuZWFjaChzdHlsZU1heWJlUmVtb3ZlKHRoaXMuX2lkLCBuYW1lKSlcbiAgICA6IHRoaXNcbiAgICAgIC5zdHlsZVR3ZWVuKG5hbWUsIHN0eWxlQ29uc3RhbnQobmFtZSwgaSwgdmFsdWUpLCBwcmlvcml0eSlcbiAgICAgIC5vbihcImVuZC5zdHlsZS5cIiArIG5hbWUsIG51bGwpO1xufVxuIiwgImZ1bmN0aW9uIHN0eWxlSW50ZXJwb2xhdGUobmFtZSwgaSwgcHJpb3JpdHkpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKHQpIHtcbiAgICB0aGlzLnN0eWxlLnNldFByb3BlcnR5KG5hbWUsIGkuY2FsbCh0aGlzLCB0KSwgcHJpb3JpdHkpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBzdHlsZVR3ZWVuKG5hbWUsIHZhbHVlLCBwcmlvcml0eSkge1xuICB2YXIgdCwgaTA7XG4gIGZ1bmN0aW9uIHR3ZWVuKCkge1xuICAgIHZhciBpID0gdmFsdWUuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICBpZiAoaSAhPT0gaTApIHQgPSAoaTAgPSBpKSAmJiBzdHlsZUludGVycG9sYXRlKG5hbWUsIGksIHByaW9yaXR5KTtcbiAgICByZXR1cm4gdDtcbiAgfVxuICB0d2Vlbi5fdmFsdWUgPSB2YWx1ZTtcbiAgcmV0dXJuIHR3ZWVuO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihuYW1lLCB2YWx1ZSwgcHJpb3JpdHkpIHtcbiAgdmFyIGtleSA9IFwic3R5bGUuXCIgKyAobmFtZSArPSBcIlwiKTtcbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPCAyKSByZXR1cm4gKGtleSA9IHRoaXMudHdlZW4oa2V5KSkgJiYga2V5Ll92YWx1ZTtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiB0aGlzLnR3ZWVuKGtleSwgbnVsbCk7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yO1xuICByZXR1cm4gdGhpcy50d2VlbihrZXksIHN0eWxlVHdlZW4obmFtZSwgdmFsdWUsIHByaW9yaXR5ID09IG51bGwgPyBcIlwiIDogcHJpb3JpdHkpKTtcbn1cbiIsICJpbXBvcnQge3R3ZWVuVmFsdWV9IGZyb20gXCIuL3R3ZWVuLmpzXCI7XG5cbmZ1bmN0aW9uIHRleHRDb25zdGFudCh2YWx1ZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy50ZXh0Q29udGVudCA9IHZhbHVlO1xuICB9O1xufVxuXG5mdW5jdGlvbiB0ZXh0RnVuY3Rpb24odmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciB2YWx1ZTEgPSB2YWx1ZSh0aGlzKTtcbiAgICB0aGlzLnRleHRDb250ZW50ID0gdmFsdWUxID09IG51bGwgPyBcIlwiIDogdmFsdWUxO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih2YWx1ZSkge1xuICByZXR1cm4gdGhpcy50d2VlbihcInRleHRcIiwgdHlwZW9mIHZhbHVlID09PSBcImZ1bmN0aW9uXCJcbiAgICAgID8gdGV4dEZ1bmN0aW9uKHR3ZWVuVmFsdWUodGhpcywgXCJ0ZXh0XCIsIHZhbHVlKSlcbiAgICAgIDogdGV4dENvbnN0YW50KHZhbHVlID09IG51bGwgPyBcIlwiIDogdmFsdWUgKyBcIlwiKSk7XG59XG4iLCAiZnVuY3Rpb24gdGV4dEludGVycG9sYXRlKGkpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKHQpIHtcbiAgICB0aGlzLnRleHRDb250ZW50ID0gaS5jYWxsKHRoaXMsIHQpO1xuICB9O1xufVxuXG5mdW5jdGlvbiB0ZXh0VHdlZW4odmFsdWUpIHtcbiAgdmFyIHQwLCBpMDtcbiAgZnVuY3Rpb24gdHdlZW4oKSB7XG4gICAgdmFyIGkgPSB2YWx1ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIGlmIChpICE9PSBpMCkgdDAgPSAoaTAgPSBpKSAmJiB0ZXh0SW50ZXJwb2xhdGUoaSk7XG4gICAgcmV0dXJuIHQwO1xuICB9XG4gIHR3ZWVuLl92YWx1ZSA9IHZhbHVlO1xuICByZXR1cm4gdHdlZW47XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHZhbHVlKSB7XG4gIHZhciBrZXkgPSBcInRleHRcIjtcbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPCAxKSByZXR1cm4gKGtleSA9IHRoaXMudHdlZW4oa2V5KSkgJiYga2V5Ll92YWx1ZTtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiB0aGlzLnR3ZWVuKGtleSwgbnVsbCk7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yO1xuICByZXR1cm4gdGhpcy50d2VlbihrZXksIHRleHRUd2Vlbih2YWx1ZSkpO1xufVxuIiwgImltcG9ydCB7VHJhbnNpdGlvbiwgbmV3SWR9IGZyb20gXCIuL2luZGV4LmpzXCI7XG5pbXBvcnQgc2NoZWR1bGUsIHtnZXR9IGZyb20gXCIuL3NjaGVkdWxlLmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKCkge1xuICB2YXIgbmFtZSA9IHRoaXMuX25hbWUsXG4gICAgICBpZDAgPSB0aGlzLl9pZCxcbiAgICAgIGlkMSA9IG5ld0lkKCk7XG5cbiAgZm9yICh2YXIgZ3JvdXBzID0gdGhpcy5fZ3JvdXBzLCBtID0gZ3JvdXBzLmxlbmd0aCwgaiA9IDA7IGogPCBtOyArK2opIHtcbiAgICBmb3IgKHZhciBncm91cCA9IGdyb3Vwc1tqXSwgbiA9IGdyb3VwLmxlbmd0aCwgbm9kZSwgaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIGlmIChub2RlID0gZ3JvdXBbaV0pIHtcbiAgICAgICAgdmFyIGluaGVyaXQgPSBnZXQobm9kZSwgaWQwKTtcbiAgICAgICAgc2NoZWR1bGUobm9kZSwgbmFtZSwgaWQxLCBpLCBncm91cCwge1xuICAgICAgICAgIHRpbWU6IGluaGVyaXQudGltZSArIGluaGVyaXQuZGVsYXkgKyBpbmhlcml0LmR1cmF0aW9uLFxuICAgICAgICAgIGRlbGF5OiAwLFxuICAgICAgICAgIGR1cmF0aW9uOiBpbmhlcml0LmR1cmF0aW9uLFxuICAgICAgICAgIGVhc2U6IGluaGVyaXQuZWFzZVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gbmV3IFRyYW5zaXRpb24oZ3JvdXBzLCB0aGlzLl9wYXJlbnRzLCBuYW1lLCBpZDEpO1xufVxuIiwgImltcG9ydCB7c2V0fSBmcm9tIFwiLi9zY2hlZHVsZS5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgdmFyIG9uMCwgb24xLCB0aGF0ID0gdGhpcywgaWQgPSB0aGF0Ll9pZCwgc2l6ZSA9IHRoYXQuc2l6ZSgpO1xuICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgdmFyIGNhbmNlbCA9IHt2YWx1ZTogcmVqZWN0fSxcbiAgICAgICAgZW5kID0ge3ZhbHVlOiBmdW5jdGlvbigpIHsgaWYgKC0tc2l6ZSA9PT0gMCkgcmVzb2x2ZSgpOyB9fTtcblxuICAgIHRoYXQuZWFjaChmdW5jdGlvbigpIHtcbiAgICAgIHZhciBzY2hlZHVsZSA9IHNldCh0aGlzLCBpZCksXG4gICAgICAgICAgb24gPSBzY2hlZHVsZS5vbjtcblxuICAgICAgLy8gSWYgdGhpcyBub2RlIHNoYXJlZCBhIGRpc3BhdGNoIHdpdGggdGhlIHByZXZpb3VzIG5vZGUsXG4gICAgICAvLyBqdXN0IGFzc2lnbiB0aGUgdXBkYXRlZCBzaGFyZWQgZGlzcGF0Y2ggYW5kIHdlXHUyMDE5cmUgZG9uZSFcbiAgICAgIC8vIE90aGVyd2lzZSwgY29weS1vbi13cml0ZS5cbiAgICAgIGlmIChvbiAhPT0gb24wKSB7XG4gICAgICAgIG9uMSA9IChvbjAgPSBvbikuY29weSgpO1xuICAgICAgICBvbjEuXy5jYW5jZWwucHVzaChjYW5jZWwpO1xuICAgICAgICBvbjEuXy5pbnRlcnJ1cHQucHVzaChjYW5jZWwpO1xuICAgICAgICBvbjEuXy5lbmQucHVzaChlbmQpO1xuICAgICAgfVxuXG4gICAgICBzY2hlZHVsZS5vbiA9IG9uMTtcbiAgICB9KTtcblxuICAgIC8vIFRoZSBzZWxlY3Rpb24gd2FzIGVtcHR5LCByZXNvbHZlIGVuZCBpbW1lZGlhdGVseVxuICAgIGlmIChzaXplID09PSAwKSByZXNvbHZlKCk7XG4gIH0pO1xufVxuIiwgImltcG9ydCB7c2VsZWN0aW9ufSBmcm9tIFwiZDMtc2VsZWN0aW9uXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl9hdHRyIGZyb20gXCIuL2F0dHIuanNcIjtcbmltcG9ydCB0cmFuc2l0aW9uX2F0dHJUd2VlbiBmcm9tIFwiLi9hdHRyVHdlZW4uanNcIjtcbmltcG9ydCB0cmFuc2l0aW9uX2RlbGF5IGZyb20gXCIuL2RlbGF5LmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl9kdXJhdGlvbiBmcm9tIFwiLi9kdXJhdGlvbi5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fZWFzZSBmcm9tIFwiLi9lYXNlLmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl9lYXNlVmFyeWluZyBmcm9tIFwiLi9lYXNlVmFyeWluZy5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fZmlsdGVyIGZyb20gXCIuL2ZpbHRlci5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fbWVyZ2UgZnJvbSBcIi4vbWVyZ2UuanNcIjtcbmltcG9ydCB0cmFuc2l0aW9uX29uIGZyb20gXCIuL29uLmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl9yZW1vdmUgZnJvbSBcIi4vcmVtb3ZlLmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl9zZWxlY3QgZnJvbSBcIi4vc2VsZWN0LmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl9zZWxlY3RBbGwgZnJvbSBcIi4vc2VsZWN0QWxsLmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl9zZWxlY3Rpb24gZnJvbSBcIi4vc2VsZWN0aW9uLmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl9zdHlsZSBmcm9tIFwiLi9zdHlsZS5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fc3R5bGVUd2VlbiBmcm9tIFwiLi9zdHlsZVR3ZWVuLmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl90ZXh0IGZyb20gXCIuL3RleHQuanNcIjtcbmltcG9ydCB0cmFuc2l0aW9uX3RleHRUd2VlbiBmcm9tIFwiLi90ZXh0VHdlZW4uanNcIjtcbmltcG9ydCB0cmFuc2l0aW9uX3RyYW5zaXRpb24gZnJvbSBcIi4vdHJhbnNpdGlvbi5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fdHdlZW4gZnJvbSBcIi4vdHdlZW4uanNcIjtcbmltcG9ydCB0cmFuc2l0aW9uX2VuZCBmcm9tIFwiLi9lbmQuanNcIjtcblxudmFyIGlkID0gMDtcblxuZXhwb3J0IGZ1bmN0aW9uIFRyYW5zaXRpb24oZ3JvdXBzLCBwYXJlbnRzLCBuYW1lLCBpZCkge1xuICB0aGlzLl9ncm91cHMgPSBncm91cHM7XG4gIHRoaXMuX3BhcmVudHMgPSBwYXJlbnRzO1xuICB0aGlzLl9uYW1lID0gbmFtZTtcbiAgdGhpcy5faWQgPSBpZDtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gdHJhbnNpdGlvbihuYW1lKSB7XG4gIHJldHVybiBzZWxlY3Rpb24oKS50cmFuc2l0aW9uKG5hbWUpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbmV3SWQoKSB7XG4gIHJldHVybiArK2lkO1xufVxuXG52YXIgc2VsZWN0aW9uX3Byb3RvdHlwZSA9IHNlbGVjdGlvbi5wcm90b3R5cGU7XG5cblRyYW5zaXRpb24ucHJvdG90eXBlID0gdHJhbnNpdGlvbi5wcm90b3R5cGUgPSB7XG4gIGNvbnN0cnVjdG9yOiBUcmFuc2l0aW9uLFxuICBzZWxlY3Q6IHRyYW5zaXRpb25fc2VsZWN0LFxuICBzZWxlY3RBbGw6IHRyYW5zaXRpb25fc2VsZWN0QWxsLFxuICBzZWxlY3RDaGlsZDogc2VsZWN0aW9uX3Byb3RvdHlwZS5zZWxlY3RDaGlsZCxcbiAgc2VsZWN0Q2hpbGRyZW46IHNlbGVjdGlvbl9wcm90b3R5cGUuc2VsZWN0Q2hpbGRyZW4sXG4gIGZpbHRlcjogdHJhbnNpdGlvbl9maWx0ZXIsXG4gIG1lcmdlOiB0cmFuc2l0aW9uX21lcmdlLFxuICBzZWxlY3Rpb246IHRyYW5zaXRpb25fc2VsZWN0aW9uLFxuICB0cmFuc2l0aW9uOiB0cmFuc2l0aW9uX3RyYW5zaXRpb24sXG4gIGNhbGw6IHNlbGVjdGlvbl9wcm90b3R5cGUuY2FsbCxcbiAgbm9kZXM6IHNlbGVjdGlvbl9wcm90b3R5cGUubm9kZXMsXG4gIG5vZGU6IHNlbGVjdGlvbl9wcm90b3R5cGUubm9kZSxcbiAgc2l6ZTogc2VsZWN0aW9uX3Byb3RvdHlwZS5zaXplLFxuICBlbXB0eTogc2VsZWN0aW9uX3Byb3RvdHlwZS5lbXB0eSxcbiAgZWFjaDogc2VsZWN0aW9uX3Byb3RvdHlwZS5lYWNoLFxuICBvbjogdHJhbnNpdGlvbl9vbixcbiAgYXR0cjogdHJhbnNpdGlvbl9hdHRyLFxuICBhdHRyVHdlZW46IHRyYW5zaXRpb25fYXR0clR3ZWVuLFxuICBzdHlsZTogdHJhbnNpdGlvbl9zdHlsZSxcbiAgc3R5bGVUd2VlbjogdHJhbnNpdGlvbl9zdHlsZVR3ZWVuLFxuICB0ZXh0OiB0cmFuc2l0aW9uX3RleHQsXG4gIHRleHRUd2VlbjogdHJhbnNpdGlvbl90ZXh0VHdlZW4sXG4gIHJlbW92ZTogdHJhbnNpdGlvbl9yZW1vdmUsXG4gIHR3ZWVuOiB0cmFuc2l0aW9uX3R3ZWVuLFxuICBkZWxheTogdHJhbnNpdGlvbl9kZWxheSxcbiAgZHVyYXRpb246IHRyYW5zaXRpb25fZHVyYXRpb24sXG4gIGVhc2U6IHRyYW5zaXRpb25fZWFzZSxcbiAgZWFzZVZhcnlpbmc6IHRyYW5zaXRpb25fZWFzZVZhcnlpbmcsXG4gIGVuZDogdHJhbnNpdGlvbl9lbmQsXG4gIFtTeW1ib2wuaXRlcmF0b3JdOiBzZWxlY3Rpb25fcHJvdG90eXBlW1N5bWJvbC5pdGVyYXRvcl1cbn07XG4iLCAiZXhwb3J0IGZ1bmN0aW9uIGN1YmljSW4odCkge1xuICByZXR1cm4gdCAqIHQgKiB0O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3ViaWNPdXQodCkge1xuICByZXR1cm4gLS10ICogdCAqIHQgKyAxO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3ViaWNJbk91dCh0KSB7XG4gIHJldHVybiAoKHQgKj0gMikgPD0gMSA/IHQgKiB0ICogdCA6ICh0IC09IDIpICogdCAqIHQgKyAyKSAvIDI7XG59XG4iLCAiaW1wb3J0IHtUcmFuc2l0aW9uLCBuZXdJZH0gZnJvbSBcIi4uL3RyYW5zaXRpb24vaW5kZXguanNcIjtcbmltcG9ydCBzY2hlZHVsZSBmcm9tIFwiLi4vdHJhbnNpdGlvbi9zY2hlZHVsZS5qc1wiO1xuaW1wb3J0IHtlYXNlQ3ViaWNJbk91dH0gZnJvbSBcImQzLWVhc2VcIjtcbmltcG9ydCB7bm93fSBmcm9tIFwiZDMtdGltZXJcIjtcblxudmFyIGRlZmF1bHRUaW1pbmcgPSB7XG4gIHRpbWU6IG51bGwsIC8vIFNldCBvbiB1c2UuXG4gIGRlbGF5OiAwLFxuICBkdXJhdGlvbjogMjUwLFxuICBlYXNlOiBlYXNlQ3ViaWNJbk91dFxufTtcblxuZnVuY3Rpb24gaW5oZXJpdChub2RlLCBpZCkge1xuICB2YXIgdGltaW5nO1xuICB3aGlsZSAoISh0aW1pbmcgPSBub2RlLl9fdHJhbnNpdGlvbikgfHwgISh0aW1pbmcgPSB0aW1pbmdbaWRdKSkge1xuICAgIGlmICghKG5vZGUgPSBub2RlLnBhcmVudE5vZGUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHRyYW5zaXRpb24gJHtpZH0gbm90IGZvdW5kYCk7XG4gICAgfVxuICB9XG4gIHJldHVybiB0aW1pbmc7XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG5hbWUpIHtcbiAgdmFyIGlkLFxuICAgICAgdGltaW5nO1xuXG4gIGlmIChuYW1lIGluc3RhbmNlb2YgVHJhbnNpdGlvbikge1xuICAgIGlkID0gbmFtZS5faWQsIG5hbWUgPSBuYW1lLl9uYW1lO1xuICB9IGVsc2Uge1xuICAgIGlkID0gbmV3SWQoKSwgKHRpbWluZyA9IGRlZmF1bHRUaW1pbmcpLnRpbWUgPSBub3coKSwgbmFtZSA9IG5hbWUgPT0gbnVsbCA/IG51bGwgOiBuYW1lICsgXCJcIjtcbiAgfVxuXG4gIGZvciAodmFyIGdyb3VwcyA9IHRoaXMuX2dyb3VwcywgbSA9IGdyb3Vwcy5sZW5ndGgsIGogPSAwOyBqIDwgbTsgKytqKSB7XG4gICAgZm9yICh2YXIgZ3JvdXAgPSBncm91cHNbal0sIG4gPSBncm91cC5sZW5ndGgsIG5vZGUsIGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAobm9kZSA9IGdyb3VwW2ldKSB7XG4gICAgICAgIHNjaGVkdWxlKG5vZGUsIG5hbWUsIGlkLCBpLCBncm91cCwgdGltaW5nIHx8IGluaGVyaXQobm9kZSwgaWQpKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gbmV3IFRyYW5zaXRpb24oZ3JvdXBzLCB0aGlzLl9wYXJlbnRzLCBuYW1lLCBpZCk7XG59XG4iLCAiaW1wb3J0IHtzZWxlY3Rpb259IGZyb20gXCJkMy1zZWxlY3Rpb25cIjtcbmltcG9ydCBzZWxlY3Rpb25faW50ZXJydXB0IGZyb20gXCIuL2ludGVycnVwdC5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl90cmFuc2l0aW9uIGZyb20gXCIuL3RyYW5zaXRpb24uanNcIjtcblxuc2VsZWN0aW9uLnByb3RvdHlwZS5pbnRlcnJ1cHQgPSBzZWxlY3Rpb25faW50ZXJydXB0O1xuc2VsZWN0aW9uLnByb3RvdHlwZS50cmFuc2l0aW9uID0gc2VsZWN0aW9uX3RyYW5zaXRpb247XG4iLCAiaW1wb3J0IHtkaXNwYXRjaH0gZnJvbSBcImQzLWRpc3BhdGNoXCI7XG5pbXBvcnQge2RyYWdEaXNhYmxlLCBkcmFnRW5hYmxlfSBmcm9tIFwiZDMtZHJhZ1wiO1xuaW1wb3J0IHtpbnRlcnBvbGF0ZX0gZnJvbSBcImQzLWludGVycG9sYXRlXCI7XG5pbXBvcnQge3BvaW50ZXIsIHNlbGVjdH0gZnJvbSBcImQzLXNlbGVjdGlvblwiO1xuaW1wb3J0IHtpbnRlcnJ1cHR9IGZyb20gXCJkMy10cmFuc2l0aW9uXCI7XG5pbXBvcnQgY29uc3RhbnQgZnJvbSBcIi4vY29uc3RhbnQuanNcIjtcbmltcG9ydCBCcnVzaEV2ZW50IGZyb20gXCIuL2V2ZW50LmpzXCI7XG5pbXBvcnQgbm9ldmVudCwge25vcHJvcGFnYXRpb259IGZyb20gXCIuL25vZXZlbnQuanNcIjtcblxudmFyIE1PREVfRFJBRyA9IHtuYW1lOiBcImRyYWdcIn0sXG4gICAgTU9ERV9TUEFDRSA9IHtuYW1lOiBcInNwYWNlXCJ9LFxuICAgIE1PREVfSEFORExFID0ge25hbWU6IFwiaGFuZGxlXCJ9LFxuICAgIE1PREVfQ0VOVEVSID0ge25hbWU6IFwiY2VudGVyXCJ9O1xuXG5jb25zdCB7YWJzLCBtYXgsIG1pbn0gPSBNYXRoO1xuXG5mdW5jdGlvbiBudW1iZXIxKGUpIHtcbiAgcmV0dXJuIFsrZVswXSwgK2VbMV1dO1xufVxuXG5mdW5jdGlvbiBudW1iZXIyKGUpIHtcbiAgcmV0dXJuIFtudW1iZXIxKGVbMF0pLCBudW1iZXIxKGVbMV0pXTtcbn1cblxudmFyIFggPSB7XG4gIG5hbWU6IFwieFwiLFxuICBoYW5kbGVzOiBbXCJ3XCIsIFwiZVwiXS5tYXAodHlwZSksXG4gIGlucHV0OiBmdW5jdGlvbih4LCBlKSB7IHJldHVybiB4ID09IG51bGwgPyBudWxsIDogW1sreFswXSwgZVswXVsxXV0sIFsreFsxXSwgZVsxXVsxXV1dOyB9LFxuICBvdXRwdXQ6IGZ1bmN0aW9uKHh5KSB7IHJldHVybiB4eSAmJiBbeHlbMF1bMF0sIHh5WzFdWzBdXTsgfVxufTtcblxudmFyIFkgPSB7XG4gIG5hbWU6IFwieVwiLFxuICBoYW5kbGVzOiBbXCJuXCIsIFwic1wiXS5tYXAodHlwZSksXG4gIGlucHV0OiBmdW5jdGlvbih5LCBlKSB7IHJldHVybiB5ID09IG51bGwgPyBudWxsIDogW1tlWzBdWzBdLCAreVswXV0sIFtlWzFdWzBdLCAreVsxXV1dOyB9LFxuICBvdXRwdXQ6IGZ1bmN0aW9uKHh5KSB7IHJldHVybiB4eSAmJiBbeHlbMF1bMV0sIHh5WzFdWzFdXTsgfVxufTtcblxudmFyIFhZID0ge1xuICBuYW1lOiBcInh5XCIsXG4gIGhhbmRsZXM6IFtcIm5cIiwgXCJ3XCIsIFwiZVwiLCBcInNcIiwgXCJud1wiLCBcIm5lXCIsIFwic3dcIiwgXCJzZVwiXS5tYXAodHlwZSksXG4gIGlucHV0OiBmdW5jdGlvbih4eSkgeyByZXR1cm4geHkgPT0gbnVsbCA/IG51bGwgOiBudW1iZXIyKHh5KTsgfSxcbiAgb3V0cHV0OiBmdW5jdGlvbih4eSkgeyByZXR1cm4geHk7IH1cbn07XG5cbnZhciBjdXJzb3JzID0ge1xuICBvdmVybGF5OiBcImNyb3NzaGFpclwiLFxuICBzZWxlY3Rpb246IFwibW92ZVwiLFxuICBuOiBcIm5zLXJlc2l6ZVwiLFxuICBlOiBcImV3LXJlc2l6ZVwiLFxuICBzOiBcIm5zLXJlc2l6ZVwiLFxuICB3OiBcImV3LXJlc2l6ZVwiLFxuICBudzogXCJud3NlLXJlc2l6ZVwiLFxuICBuZTogXCJuZXN3LXJlc2l6ZVwiLFxuICBzZTogXCJud3NlLXJlc2l6ZVwiLFxuICBzdzogXCJuZXN3LXJlc2l6ZVwiXG59O1xuXG52YXIgZmxpcFggPSB7XG4gIGU6IFwid1wiLFxuICB3OiBcImVcIixcbiAgbnc6IFwibmVcIixcbiAgbmU6IFwibndcIixcbiAgc2U6IFwic3dcIixcbiAgc3c6IFwic2VcIlxufTtcblxudmFyIGZsaXBZID0ge1xuICBuOiBcInNcIixcbiAgczogXCJuXCIsXG4gIG53OiBcInN3XCIsXG4gIG5lOiBcInNlXCIsXG4gIHNlOiBcIm5lXCIsXG4gIHN3OiBcIm53XCJcbn07XG5cbnZhciBzaWduc1ggPSB7XG4gIG92ZXJsYXk6ICsxLFxuICBzZWxlY3Rpb246ICsxLFxuICBuOiBudWxsLFxuICBlOiArMSxcbiAgczogbnVsbCxcbiAgdzogLTEsXG4gIG53OiAtMSxcbiAgbmU6ICsxLFxuICBzZTogKzEsXG4gIHN3OiAtMVxufTtcblxudmFyIHNpZ25zWSA9IHtcbiAgb3ZlcmxheTogKzEsXG4gIHNlbGVjdGlvbjogKzEsXG4gIG46IC0xLFxuICBlOiBudWxsLFxuICBzOiArMSxcbiAgdzogbnVsbCxcbiAgbnc6IC0xLFxuICBuZTogLTEsXG4gIHNlOiArMSxcbiAgc3c6ICsxXG59O1xuXG5mdW5jdGlvbiB0eXBlKHQpIHtcbiAgcmV0dXJuIHt0eXBlOiB0fTtcbn1cblxuLy8gSWdub3JlIHJpZ2h0LWNsaWNrLCBzaW5jZSB0aGF0IHNob3VsZCBvcGVuIHRoZSBjb250ZXh0IG1lbnUuXG5mdW5jdGlvbiBkZWZhdWx0RmlsdGVyKGV2ZW50KSB7XG4gIHJldHVybiAhZXZlbnQuY3RybEtleSAmJiAhZXZlbnQuYnV0dG9uO1xufVxuXG5mdW5jdGlvbiBkZWZhdWx0RXh0ZW50KCkge1xuICB2YXIgc3ZnID0gdGhpcy5vd25lclNWR0VsZW1lbnQgfHwgdGhpcztcbiAgaWYgKHN2Zy5oYXNBdHRyaWJ1dGUoXCJ2aWV3Qm94XCIpKSB7XG4gICAgc3ZnID0gc3ZnLnZpZXdCb3guYmFzZVZhbDtcbiAgICByZXR1cm4gW1tzdmcueCwgc3ZnLnldLCBbc3ZnLnggKyBzdmcud2lkdGgsIHN2Zy55ICsgc3ZnLmhlaWdodF1dO1xuICB9XG4gIHJldHVybiBbWzAsIDBdLCBbc3ZnLndpZHRoLmJhc2VWYWwudmFsdWUsIHN2Zy5oZWlnaHQuYmFzZVZhbC52YWx1ZV1dO1xufVxuXG5mdW5jdGlvbiBkZWZhdWx0VG91Y2hhYmxlKCkge1xuICByZXR1cm4gbmF2aWdhdG9yLm1heFRvdWNoUG9pbnRzIHx8IChcIm9udG91Y2hzdGFydFwiIGluIHRoaXMpO1xufVxuXG4vLyBMaWtlIGQzLmxvY2FsLCBidXQgd2l0aCB0aGUgbmFtZSBcdTIwMUNfX2JydXNoXHUyMDFEIHJhdGhlciB0aGFuIGF1dG8tZ2VuZXJhdGVkLlxuZnVuY3Rpb24gbG9jYWwobm9kZSkge1xuICB3aGlsZSAoIW5vZGUuX19icnVzaCkgaWYgKCEobm9kZSA9IG5vZGUucGFyZW50Tm9kZSkpIHJldHVybjtcbiAgcmV0dXJuIG5vZGUuX19icnVzaDtcbn1cblxuZnVuY3Rpb24gZW1wdHkoZXh0ZW50KSB7XG4gIHJldHVybiBleHRlbnRbMF1bMF0gPT09IGV4dGVudFsxXVswXVxuICAgICAgfHwgZXh0ZW50WzBdWzFdID09PSBleHRlbnRbMV1bMV07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBicnVzaFNlbGVjdGlvbihub2RlKSB7XG4gIHZhciBzdGF0ZSA9IG5vZGUuX19icnVzaDtcbiAgcmV0dXJuIHN0YXRlID8gc3RhdGUuZGltLm91dHB1dChzdGF0ZS5zZWxlY3Rpb24pIDogbnVsbDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJydXNoWCgpIHtcbiAgcmV0dXJuIGJydXNoKFgpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYnJ1c2hZKCkge1xuICByZXR1cm4gYnJ1c2goWSk7XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gYnJ1c2goWFkpO1xufVxuXG5mdW5jdGlvbiBicnVzaChkaW0pIHtcbiAgdmFyIGV4dGVudCA9IGRlZmF1bHRFeHRlbnQsXG4gICAgICBmaWx0ZXIgPSBkZWZhdWx0RmlsdGVyLFxuICAgICAgdG91Y2hhYmxlID0gZGVmYXVsdFRvdWNoYWJsZSxcbiAgICAgIGtleXMgPSB0cnVlLFxuICAgICAgbGlzdGVuZXJzID0gZGlzcGF0Y2goXCJzdGFydFwiLCBcImJydXNoXCIsIFwiZW5kXCIpLFxuICAgICAgaGFuZGxlU2l6ZSA9IDYsXG4gICAgICB0b3VjaGVuZGluZztcblxuICBmdW5jdGlvbiBicnVzaChncm91cCkge1xuICAgIHZhciBvdmVybGF5ID0gZ3JvdXBcbiAgICAgICAgLnByb3BlcnR5KFwiX19icnVzaFwiLCBpbml0aWFsaXplKVxuICAgICAgLnNlbGVjdEFsbChcIi5vdmVybGF5XCIpXG4gICAgICAuZGF0YShbdHlwZShcIm92ZXJsYXlcIildKTtcblxuICAgIG92ZXJsYXkuZW50ZXIoKS5hcHBlbmQoXCJyZWN0XCIpXG4gICAgICAgIC5hdHRyKFwiY2xhc3NcIiwgXCJvdmVybGF5XCIpXG4gICAgICAgIC5hdHRyKFwicG9pbnRlci1ldmVudHNcIiwgXCJhbGxcIilcbiAgICAgICAgLmF0dHIoXCJjdXJzb3JcIiwgY3Vyc29ycy5vdmVybGF5KVxuICAgICAgLm1lcmdlKG92ZXJsYXkpXG4gICAgICAgIC5lYWNoKGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHZhciBleHRlbnQgPSBsb2NhbCh0aGlzKS5leHRlbnQ7XG4gICAgICAgICAgc2VsZWN0KHRoaXMpXG4gICAgICAgICAgICAgIC5hdHRyKFwieFwiLCBleHRlbnRbMF1bMF0pXG4gICAgICAgICAgICAgIC5hdHRyKFwieVwiLCBleHRlbnRbMF1bMV0pXG4gICAgICAgICAgICAgIC5hdHRyKFwid2lkdGhcIiwgZXh0ZW50WzFdWzBdIC0gZXh0ZW50WzBdWzBdKVxuICAgICAgICAgICAgICAuYXR0cihcImhlaWdodFwiLCBleHRlbnRbMV1bMV0gLSBleHRlbnRbMF1bMV0pO1xuICAgICAgICB9KTtcblxuICAgIGdyb3VwLnNlbGVjdEFsbChcIi5zZWxlY3Rpb25cIilcbiAgICAgIC5kYXRhKFt0eXBlKFwic2VsZWN0aW9uXCIpXSlcbiAgICAgIC5lbnRlcigpLmFwcGVuZChcInJlY3RcIilcbiAgICAgICAgLmF0dHIoXCJjbGFzc1wiLCBcInNlbGVjdGlvblwiKVxuICAgICAgICAuYXR0cihcImN1cnNvclwiLCBjdXJzb3JzLnNlbGVjdGlvbilcbiAgICAgICAgLmF0dHIoXCJmaWxsXCIsIFwiIzc3N1wiKVxuICAgICAgICAuYXR0cihcImZpbGwtb3BhY2l0eVwiLCAwLjMpXG4gICAgICAgIC5hdHRyKFwic3Ryb2tlXCIsIFwiI2ZmZlwiKVxuICAgICAgICAuYXR0cihcInNoYXBlLXJlbmRlcmluZ1wiLCBcImNyaXNwRWRnZXNcIik7XG5cbiAgICB2YXIgaGFuZGxlID0gZ3JvdXAuc2VsZWN0QWxsKFwiLmhhbmRsZVwiKVxuICAgICAgLmRhdGEoZGltLmhhbmRsZXMsIGZ1bmN0aW9uKGQpIHsgcmV0dXJuIGQudHlwZTsgfSk7XG5cbiAgICBoYW5kbGUuZXhpdCgpLnJlbW92ZSgpO1xuXG4gICAgaGFuZGxlLmVudGVyKCkuYXBwZW5kKFwicmVjdFwiKVxuICAgICAgICAuYXR0cihcImNsYXNzXCIsIGZ1bmN0aW9uKGQpIHsgcmV0dXJuIFwiaGFuZGxlIGhhbmRsZS0tXCIgKyBkLnR5cGU7IH0pXG4gICAgICAgIC5hdHRyKFwiY3Vyc29yXCIsIGZ1bmN0aW9uKGQpIHsgcmV0dXJuIGN1cnNvcnNbZC50eXBlXTsgfSk7XG5cbiAgICBncm91cFxuICAgICAgICAuZWFjaChyZWRyYXcpXG4gICAgICAgIC5hdHRyKFwiZmlsbFwiLCBcIm5vbmVcIilcbiAgICAgICAgLmF0dHIoXCJwb2ludGVyLWV2ZW50c1wiLCBcImFsbFwiKVxuICAgICAgICAub24oXCJtb3VzZWRvd24uYnJ1c2hcIiwgc3RhcnRlZClcbiAgICAgIC5maWx0ZXIodG91Y2hhYmxlKVxuICAgICAgICAub24oXCJ0b3VjaHN0YXJ0LmJydXNoXCIsIHN0YXJ0ZWQpXG4gICAgICAgIC5vbihcInRvdWNobW92ZS5icnVzaFwiLCB0b3VjaG1vdmVkKVxuICAgICAgICAub24oXCJ0b3VjaGVuZC5icnVzaCB0b3VjaGNhbmNlbC5icnVzaFwiLCB0b3VjaGVuZGVkKVxuICAgICAgICAuc3R5bGUoXCJ0b3VjaC1hY3Rpb25cIiwgXCJub25lXCIpXG4gICAgICAgIC5zdHlsZShcIi13ZWJraXQtdGFwLWhpZ2hsaWdodC1jb2xvclwiLCBcInJnYmEoMCwwLDAsMClcIik7XG4gIH1cblxuICBicnVzaC5tb3ZlID0gZnVuY3Rpb24oZ3JvdXAsIHNlbGVjdGlvbiwgZXZlbnQpIHtcbiAgICBpZiAoZ3JvdXAudHdlZW4pIHtcbiAgICAgIGdyb3VwXG4gICAgICAgICAgLm9uKFwic3RhcnQuYnJ1c2hcIiwgZnVuY3Rpb24oZXZlbnQpIHsgZW1pdHRlcih0aGlzLCBhcmd1bWVudHMpLmJlZm9yZXN0YXJ0KCkuc3RhcnQoZXZlbnQpOyB9KVxuICAgICAgICAgIC5vbihcImludGVycnVwdC5icnVzaCBlbmQuYnJ1c2hcIiwgZnVuY3Rpb24oZXZlbnQpIHsgZW1pdHRlcih0aGlzLCBhcmd1bWVudHMpLmVuZChldmVudCk7IH0pXG4gICAgICAgICAgLnR3ZWVuKFwiYnJ1c2hcIiwgZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB2YXIgdGhhdCA9IHRoaXMsXG4gICAgICAgICAgICAgICAgc3RhdGUgPSB0aGF0Ll9fYnJ1c2gsXG4gICAgICAgICAgICAgICAgZW1pdCA9IGVtaXR0ZXIodGhhdCwgYXJndW1lbnRzKSxcbiAgICAgICAgICAgICAgICBzZWxlY3Rpb24wID0gc3RhdGUuc2VsZWN0aW9uLFxuICAgICAgICAgICAgICAgIHNlbGVjdGlvbjEgPSBkaW0uaW5wdXQodHlwZW9mIHNlbGVjdGlvbiA9PT0gXCJmdW5jdGlvblwiID8gc2VsZWN0aW9uLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgOiBzZWxlY3Rpb24sIHN0YXRlLmV4dGVudCksXG4gICAgICAgICAgICAgICAgaSA9IGludGVycG9sYXRlKHNlbGVjdGlvbjAsIHNlbGVjdGlvbjEpO1xuXG4gICAgICAgICAgICBmdW5jdGlvbiB0d2Vlbih0KSB7XG4gICAgICAgICAgICAgIHN0YXRlLnNlbGVjdGlvbiA9IHQgPT09IDEgJiYgc2VsZWN0aW9uMSA9PT0gbnVsbCA/IG51bGwgOiBpKHQpO1xuICAgICAgICAgICAgICByZWRyYXcuY2FsbCh0aGF0KTtcbiAgICAgICAgICAgICAgZW1pdC5icnVzaCgpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gc2VsZWN0aW9uMCAhPT0gbnVsbCAmJiBzZWxlY3Rpb24xICE9PSBudWxsID8gdHdlZW4gOiB0d2VlbigxKTtcbiAgICAgICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgZ3JvdXBcbiAgICAgICAgICAuZWFjaChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHZhciB0aGF0ID0gdGhpcyxcbiAgICAgICAgICAgICAgICBhcmdzID0gYXJndW1lbnRzLFxuICAgICAgICAgICAgICAgIHN0YXRlID0gdGhhdC5fX2JydXNoLFxuICAgICAgICAgICAgICAgIHNlbGVjdGlvbjEgPSBkaW0uaW5wdXQodHlwZW9mIHNlbGVjdGlvbiA9PT0gXCJmdW5jdGlvblwiID8gc2VsZWN0aW9uLmFwcGx5KHRoYXQsIGFyZ3MpIDogc2VsZWN0aW9uLCBzdGF0ZS5leHRlbnQpLFxuICAgICAgICAgICAgICAgIGVtaXQgPSBlbWl0dGVyKHRoYXQsIGFyZ3MpLmJlZm9yZXN0YXJ0KCk7XG5cbiAgICAgICAgICAgIGludGVycnVwdCh0aGF0KTtcbiAgICAgICAgICAgIHN0YXRlLnNlbGVjdGlvbiA9IHNlbGVjdGlvbjEgPT09IG51bGwgPyBudWxsIDogc2VsZWN0aW9uMTtcbiAgICAgICAgICAgIHJlZHJhdy5jYWxsKHRoYXQpO1xuICAgICAgICAgICAgZW1pdC5zdGFydChldmVudCkuYnJ1c2goZXZlbnQpLmVuZChldmVudCk7XG4gICAgICAgICAgfSk7XG4gICAgfVxuICB9O1xuXG4gIGJydXNoLmNsZWFyID0gZnVuY3Rpb24oZ3JvdXAsIGV2ZW50KSB7XG4gICAgYnJ1c2gubW92ZShncm91cCwgbnVsbCwgZXZlbnQpO1xuICB9O1xuXG4gIGZ1bmN0aW9uIHJlZHJhdygpIHtcbiAgICB2YXIgZ3JvdXAgPSBzZWxlY3QodGhpcyksXG4gICAgICAgIHNlbGVjdGlvbiA9IGxvY2FsKHRoaXMpLnNlbGVjdGlvbjtcblxuICAgIGlmIChzZWxlY3Rpb24pIHtcbiAgICAgIGdyb3VwLnNlbGVjdEFsbChcIi5zZWxlY3Rpb25cIilcbiAgICAgICAgICAuc3R5bGUoXCJkaXNwbGF5XCIsIG51bGwpXG4gICAgICAgICAgLmF0dHIoXCJ4XCIsIHNlbGVjdGlvblswXVswXSlcbiAgICAgICAgICAuYXR0cihcInlcIiwgc2VsZWN0aW9uWzBdWzFdKVxuICAgICAgICAgIC5hdHRyKFwid2lkdGhcIiwgc2VsZWN0aW9uWzFdWzBdIC0gc2VsZWN0aW9uWzBdWzBdKVxuICAgICAgICAgIC5hdHRyKFwiaGVpZ2h0XCIsIHNlbGVjdGlvblsxXVsxXSAtIHNlbGVjdGlvblswXVsxXSk7XG5cbiAgICAgIGdyb3VwLnNlbGVjdEFsbChcIi5oYW5kbGVcIilcbiAgICAgICAgICAuc3R5bGUoXCJkaXNwbGF5XCIsIG51bGwpXG4gICAgICAgICAgLmF0dHIoXCJ4XCIsIGZ1bmN0aW9uKGQpIHsgcmV0dXJuIGQudHlwZVtkLnR5cGUubGVuZ3RoIC0gMV0gPT09IFwiZVwiID8gc2VsZWN0aW9uWzFdWzBdIC0gaGFuZGxlU2l6ZSAvIDIgOiBzZWxlY3Rpb25bMF1bMF0gLSBoYW5kbGVTaXplIC8gMjsgfSlcbiAgICAgICAgICAuYXR0cihcInlcIiwgZnVuY3Rpb24oZCkgeyByZXR1cm4gZC50eXBlWzBdID09PSBcInNcIiA/IHNlbGVjdGlvblsxXVsxXSAtIGhhbmRsZVNpemUgLyAyIDogc2VsZWN0aW9uWzBdWzFdIC0gaGFuZGxlU2l6ZSAvIDI7IH0pXG4gICAgICAgICAgLmF0dHIoXCJ3aWR0aFwiLCBmdW5jdGlvbihkKSB7IHJldHVybiBkLnR5cGUgPT09IFwiblwiIHx8IGQudHlwZSA9PT0gXCJzXCIgPyBzZWxlY3Rpb25bMV1bMF0gLSBzZWxlY3Rpb25bMF1bMF0gKyBoYW5kbGVTaXplIDogaGFuZGxlU2l6ZTsgfSlcbiAgICAgICAgICAuYXR0cihcImhlaWdodFwiLCBmdW5jdGlvbihkKSB7IHJldHVybiBkLnR5cGUgPT09IFwiZVwiIHx8IGQudHlwZSA9PT0gXCJ3XCIgPyBzZWxlY3Rpb25bMV1bMV0gLSBzZWxlY3Rpb25bMF1bMV0gKyBoYW5kbGVTaXplIDogaGFuZGxlU2l6ZTsgfSk7XG4gICAgfVxuXG4gICAgZWxzZSB7XG4gICAgICBncm91cC5zZWxlY3RBbGwoXCIuc2VsZWN0aW9uLC5oYW5kbGVcIilcbiAgICAgICAgICAuc3R5bGUoXCJkaXNwbGF5XCIsIFwibm9uZVwiKVxuICAgICAgICAgIC5hdHRyKFwieFwiLCBudWxsKVxuICAgICAgICAgIC5hdHRyKFwieVwiLCBudWxsKVxuICAgICAgICAgIC5hdHRyKFwid2lkdGhcIiwgbnVsbClcbiAgICAgICAgICAuYXR0cihcImhlaWdodFwiLCBudWxsKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBlbWl0dGVyKHRoYXQsIGFyZ3MsIGNsZWFuKSB7XG4gICAgdmFyIGVtaXQgPSB0aGF0Ll9fYnJ1c2guZW1pdHRlcjtcbiAgICByZXR1cm4gZW1pdCAmJiAoIWNsZWFuIHx8ICFlbWl0LmNsZWFuKSA/IGVtaXQgOiBuZXcgRW1pdHRlcih0aGF0LCBhcmdzLCBjbGVhbik7XG4gIH1cblxuICBmdW5jdGlvbiBFbWl0dGVyKHRoYXQsIGFyZ3MsIGNsZWFuKSB7XG4gICAgdGhpcy50aGF0ID0gdGhhdDtcbiAgICB0aGlzLmFyZ3MgPSBhcmdzO1xuICAgIHRoaXMuc3RhdGUgPSB0aGF0Ll9fYnJ1c2g7XG4gICAgdGhpcy5hY3RpdmUgPSAwO1xuICAgIHRoaXMuY2xlYW4gPSBjbGVhbjtcbiAgfVxuXG4gIEVtaXR0ZXIucHJvdG90eXBlID0ge1xuICAgIGJlZm9yZXN0YXJ0OiBmdW5jdGlvbigpIHtcbiAgICAgIGlmICgrK3RoaXMuYWN0aXZlID09PSAxKSB0aGlzLnN0YXRlLmVtaXR0ZXIgPSB0aGlzLCB0aGlzLnN0YXJ0aW5nID0gdHJ1ZTtcbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH0sXG4gICAgc3RhcnQ6IGZ1bmN0aW9uKGV2ZW50LCBtb2RlKSB7XG4gICAgICBpZiAodGhpcy5zdGFydGluZykgdGhpcy5zdGFydGluZyA9IGZhbHNlLCB0aGlzLmVtaXQoXCJzdGFydFwiLCBldmVudCwgbW9kZSk7XG4gICAgICBlbHNlIHRoaXMuZW1pdChcImJydXNoXCIsIGV2ZW50KTtcbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH0sXG4gICAgYnJ1c2g6IGZ1bmN0aW9uKGV2ZW50LCBtb2RlKSB7XG4gICAgICB0aGlzLmVtaXQoXCJicnVzaFwiLCBldmVudCwgbW9kZSk7XG4gICAgICByZXR1cm4gdGhpcztcbiAgICB9LFxuICAgIGVuZDogZnVuY3Rpb24oZXZlbnQsIG1vZGUpIHtcbiAgICAgIGlmICgtLXRoaXMuYWN0aXZlID09PSAwKSBkZWxldGUgdGhpcy5zdGF0ZS5lbWl0dGVyLCB0aGlzLmVtaXQoXCJlbmRcIiwgZXZlbnQsIG1vZGUpO1xuICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfSxcbiAgICBlbWl0OiBmdW5jdGlvbih0eXBlLCBldmVudCwgbW9kZSkge1xuICAgICAgdmFyIGQgPSBzZWxlY3QodGhpcy50aGF0KS5kYXR1bSgpO1xuICAgICAgbGlzdGVuZXJzLmNhbGwoXG4gICAgICAgIHR5cGUsXG4gICAgICAgIHRoaXMudGhhdCxcbiAgICAgICAgbmV3IEJydXNoRXZlbnQodHlwZSwge1xuICAgICAgICAgIHNvdXJjZUV2ZW50OiBldmVudCxcbiAgICAgICAgICB0YXJnZXQ6IGJydXNoLFxuICAgICAgICAgIHNlbGVjdGlvbjogZGltLm91dHB1dCh0aGlzLnN0YXRlLnNlbGVjdGlvbiksXG4gICAgICAgICAgbW9kZSxcbiAgICAgICAgICBkaXNwYXRjaDogbGlzdGVuZXJzXG4gICAgICAgIH0pLFxuICAgICAgICBkXG4gICAgICApO1xuICAgIH1cbiAgfTtcblxuICBmdW5jdGlvbiBzdGFydGVkKGV2ZW50KSB7XG4gICAgaWYgKHRvdWNoZW5kaW5nICYmICFldmVudC50b3VjaGVzKSByZXR1cm47XG4gICAgaWYgKCFmaWx0ZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKSkgcmV0dXJuO1xuXG4gICAgdmFyIHRoYXQgPSB0aGlzLFxuICAgICAgICB0eXBlID0gZXZlbnQudGFyZ2V0Ll9fZGF0YV9fLnR5cGUsXG4gICAgICAgIG1vZGUgPSAoa2V5cyAmJiBldmVudC5tZXRhS2V5ID8gdHlwZSA9IFwib3ZlcmxheVwiIDogdHlwZSkgPT09IFwic2VsZWN0aW9uXCIgPyBNT0RFX0RSQUcgOiAoa2V5cyAmJiBldmVudC5hbHRLZXkgPyBNT0RFX0NFTlRFUiA6IE1PREVfSEFORExFKSxcbiAgICAgICAgc2lnblggPSBkaW0gPT09IFkgPyBudWxsIDogc2lnbnNYW3R5cGVdLFxuICAgICAgICBzaWduWSA9IGRpbSA9PT0gWCA/IG51bGwgOiBzaWduc1lbdHlwZV0sXG4gICAgICAgIHN0YXRlID0gbG9jYWwodGhhdCksXG4gICAgICAgIGV4dGVudCA9IHN0YXRlLmV4dGVudCxcbiAgICAgICAgc2VsZWN0aW9uID0gc3RhdGUuc2VsZWN0aW9uLFxuICAgICAgICBXID0gZXh0ZW50WzBdWzBdLCB3MCwgdzEsXG4gICAgICAgIE4gPSBleHRlbnRbMF1bMV0sIG4wLCBuMSxcbiAgICAgICAgRSA9IGV4dGVudFsxXVswXSwgZTAsIGUxLFxuICAgICAgICBTID0gZXh0ZW50WzFdWzFdLCBzMCwgczEsXG4gICAgICAgIGR4ID0gMCxcbiAgICAgICAgZHkgPSAwLFxuICAgICAgICBtb3ZpbmcsXG4gICAgICAgIHNoaWZ0aW5nID0gc2lnblggJiYgc2lnblkgJiYga2V5cyAmJiBldmVudC5zaGlmdEtleSxcbiAgICAgICAgbG9ja1gsXG4gICAgICAgIGxvY2tZLFxuICAgICAgICBwb2ludHMgPSBBcnJheS5mcm9tKGV2ZW50LnRvdWNoZXMgfHwgW2V2ZW50XSwgdCA9PiB7XG4gICAgICAgICAgY29uc3QgaSA9IHQuaWRlbnRpZmllcjtcbiAgICAgICAgICB0ID0gcG9pbnRlcih0LCB0aGF0KTtcbiAgICAgICAgICB0LnBvaW50MCA9IHQuc2xpY2UoKTtcbiAgICAgICAgICB0LmlkZW50aWZpZXIgPSBpO1xuICAgICAgICAgIHJldHVybiB0O1xuICAgICAgICB9KTtcblxuICAgIGludGVycnVwdCh0aGF0KTtcbiAgICB2YXIgZW1pdCA9IGVtaXR0ZXIodGhhdCwgYXJndW1lbnRzLCB0cnVlKS5iZWZvcmVzdGFydCgpO1xuXG4gICAgaWYgKHR5cGUgPT09IFwib3ZlcmxheVwiKSB7XG4gICAgICBpZiAoc2VsZWN0aW9uKSBtb3ZpbmcgPSB0cnVlO1xuICAgICAgY29uc3QgcHRzID0gW3BvaW50c1swXSwgcG9pbnRzWzFdIHx8IHBvaW50c1swXV07XG4gICAgICBzdGF0ZS5zZWxlY3Rpb24gPSBzZWxlY3Rpb24gPSBbW1xuICAgICAgICAgIHcwID0gZGltID09PSBZID8gVyA6IG1pbihwdHNbMF1bMF0sIHB0c1sxXVswXSksXG4gICAgICAgICAgbjAgPSBkaW0gPT09IFggPyBOIDogbWluKHB0c1swXVsxXSwgcHRzWzFdWzFdKVxuICAgICAgICBdLCBbXG4gICAgICAgICAgZTAgPSBkaW0gPT09IFkgPyBFIDogbWF4KHB0c1swXVswXSwgcHRzWzFdWzBdKSxcbiAgICAgICAgICBzMCA9IGRpbSA9PT0gWCA/IFMgOiBtYXgocHRzWzBdWzFdLCBwdHNbMV1bMV0pXG4gICAgICAgIF1dO1xuICAgICAgaWYgKHBvaW50cy5sZW5ndGggPiAxKSBtb3ZlKGV2ZW50KTtcbiAgICB9IGVsc2Uge1xuICAgICAgdzAgPSBzZWxlY3Rpb25bMF1bMF07XG4gICAgICBuMCA9IHNlbGVjdGlvblswXVsxXTtcbiAgICAgIGUwID0gc2VsZWN0aW9uWzFdWzBdO1xuICAgICAgczAgPSBzZWxlY3Rpb25bMV1bMV07XG4gICAgfVxuXG4gICAgdzEgPSB3MDtcbiAgICBuMSA9IG4wO1xuICAgIGUxID0gZTA7XG4gICAgczEgPSBzMDtcblxuICAgIHZhciBncm91cCA9IHNlbGVjdCh0aGF0KVxuICAgICAgICAuYXR0cihcInBvaW50ZXItZXZlbnRzXCIsIFwibm9uZVwiKTtcblxuICAgIHZhciBvdmVybGF5ID0gZ3JvdXAuc2VsZWN0QWxsKFwiLm92ZXJsYXlcIilcbiAgICAgICAgLmF0dHIoXCJjdXJzb3JcIiwgY3Vyc29yc1t0eXBlXSk7XG5cbiAgICBpZiAoZXZlbnQudG91Y2hlcykge1xuICAgICAgZW1pdC5tb3ZlZCA9IG1vdmVkO1xuICAgICAgZW1pdC5lbmRlZCA9IGVuZGVkO1xuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgdmlldyA9IHNlbGVjdChldmVudC52aWV3KVxuICAgICAgICAgIC5vbihcIm1vdXNlbW92ZS5icnVzaFwiLCBtb3ZlZCwgdHJ1ZSlcbiAgICAgICAgICAub24oXCJtb3VzZXVwLmJydXNoXCIsIGVuZGVkLCB0cnVlKTtcbiAgICAgIGlmIChrZXlzKSB2aWV3XG4gICAgICAgICAgLm9uKFwia2V5ZG93bi5icnVzaFwiLCBrZXlkb3duZWQsIHRydWUpXG4gICAgICAgICAgLm9uKFwia2V5dXAuYnJ1c2hcIiwga2V5dXBwZWQsIHRydWUpXG5cbiAgICAgIGRyYWdEaXNhYmxlKGV2ZW50LnZpZXcpO1xuICAgIH1cblxuICAgIHJlZHJhdy5jYWxsKHRoYXQpO1xuICAgIGVtaXQuc3RhcnQoZXZlbnQsIG1vZGUubmFtZSk7XG5cbiAgICBmdW5jdGlvbiBtb3ZlZChldmVudCkge1xuICAgICAgZm9yIChjb25zdCBwIG9mIGV2ZW50LmNoYW5nZWRUb3VjaGVzIHx8IFtldmVudF0pIHtcbiAgICAgICAgZm9yIChjb25zdCBkIG9mIHBvaW50cylcbiAgICAgICAgICBpZiAoZC5pZGVudGlmaWVyID09PSBwLmlkZW50aWZpZXIpIGQuY3VyID0gcG9pbnRlcihwLCB0aGF0KTtcbiAgICAgIH1cbiAgICAgIGlmIChzaGlmdGluZyAmJiAhbG9ja1ggJiYgIWxvY2tZICYmIHBvaW50cy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgY29uc3QgcG9pbnQgPSBwb2ludHNbMF07XG4gICAgICAgIGlmIChhYnMocG9pbnQuY3VyWzBdIC0gcG9pbnRbMF0pID4gYWJzKHBvaW50LmN1clsxXSAtIHBvaW50WzFdKSlcbiAgICAgICAgICBsb2NrWSA9IHRydWU7XG4gICAgICAgIGVsc2VcbiAgICAgICAgICBsb2NrWCA9IHRydWU7XG4gICAgICB9XG4gICAgICBmb3IgKGNvbnN0IHBvaW50IG9mIHBvaW50cylcbiAgICAgICAgaWYgKHBvaW50LmN1cikgcG9pbnRbMF0gPSBwb2ludC5jdXJbMF0sIHBvaW50WzFdID0gcG9pbnQuY3VyWzFdO1xuICAgICAgbW92aW5nID0gdHJ1ZTtcbiAgICAgIG5vZXZlbnQoZXZlbnQpO1xuICAgICAgbW92ZShldmVudCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbW92ZShldmVudCkge1xuICAgICAgY29uc3QgcG9pbnQgPSBwb2ludHNbMF0sIHBvaW50MCA9IHBvaW50LnBvaW50MDtcbiAgICAgIHZhciB0O1xuXG4gICAgICBkeCA9IHBvaW50WzBdIC0gcG9pbnQwWzBdO1xuICAgICAgZHkgPSBwb2ludFsxXSAtIHBvaW50MFsxXTtcblxuICAgICAgc3dpdGNoIChtb2RlKSB7XG4gICAgICAgIGNhc2UgTU9ERV9TUEFDRTpcbiAgICAgICAgY2FzZSBNT0RFX0RSQUc6IHtcbiAgICAgICAgICBpZiAoc2lnblgpIGR4ID0gbWF4KFcgLSB3MCwgbWluKEUgLSBlMCwgZHgpKSwgdzEgPSB3MCArIGR4LCBlMSA9IGUwICsgZHg7XG4gICAgICAgICAgaWYgKHNpZ25ZKSBkeSA9IG1heChOIC0gbjAsIG1pbihTIC0gczAsIGR5KSksIG4xID0gbjAgKyBkeSwgczEgPSBzMCArIGR5O1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGNhc2UgTU9ERV9IQU5ETEU6IHtcbiAgICAgICAgICBpZiAocG9pbnRzWzFdKSB7XG4gICAgICAgICAgICBpZiAoc2lnblgpIHcxID0gbWF4KFcsIG1pbihFLCBwb2ludHNbMF1bMF0pKSwgZTEgPSBtYXgoVywgbWluKEUsIHBvaW50c1sxXVswXSkpLCBzaWduWCA9IDE7XG4gICAgICAgICAgICBpZiAoc2lnblkpIG4xID0gbWF4KE4sIG1pbihTLCBwb2ludHNbMF1bMV0pKSwgczEgPSBtYXgoTiwgbWluKFMsIHBvaW50c1sxXVsxXSkpLCBzaWduWSA9IDE7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGlmIChzaWduWCA8IDApIGR4ID0gbWF4KFcgLSB3MCwgbWluKEUgLSB3MCwgZHgpKSwgdzEgPSB3MCArIGR4LCBlMSA9IGUwO1xuICAgICAgICAgICAgZWxzZSBpZiAoc2lnblggPiAwKSBkeCA9IG1heChXIC0gZTAsIG1pbihFIC0gZTAsIGR4KSksIHcxID0gdzAsIGUxID0gZTAgKyBkeDtcbiAgICAgICAgICAgIGlmIChzaWduWSA8IDApIGR5ID0gbWF4KE4gLSBuMCwgbWluKFMgLSBuMCwgZHkpKSwgbjEgPSBuMCArIGR5LCBzMSA9IHMwO1xuICAgICAgICAgICAgZWxzZSBpZiAoc2lnblkgPiAwKSBkeSA9IG1heChOIC0gczAsIG1pbihTIC0gczAsIGR5KSksIG4xID0gbjAsIHMxID0gczAgKyBkeTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgY2FzZSBNT0RFX0NFTlRFUjoge1xuICAgICAgICAgIGlmIChzaWduWCkgdzEgPSBtYXgoVywgbWluKEUsIHcwIC0gZHggKiBzaWduWCkpLCBlMSA9IG1heChXLCBtaW4oRSwgZTAgKyBkeCAqIHNpZ25YKSk7XG4gICAgICAgICAgaWYgKHNpZ25ZKSBuMSA9IG1heChOLCBtaW4oUywgbjAgLSBkeSAqIHNpZ25ZKSksIHMxID0gbWF4KE4sIG1pbihTLCBzMCArIGR5ICogc2lnblkpKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoZTEgPCB3MSkge1xuICAgICAgICBzaWduWCAqPSAtMTtcbiAgICAgICAgdCA9IHcwLCB3MCA9IGUwLCBlMCA9IHQ7XG4gICAgICAgIHQgPSB3MSwgdzEgPSBlMSwgZTEgPSB0O1xuICAgICAgICBpZiAodHlwZSBpbiBmbGlwWCkgb3ZlcmxheS5hdHRyKFwiY3Vyc29yXCIsIGN1cnNvcnNbdHlwZSA9IGZsaXBYW3R5cGVdXSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChzMSA8IG4xKSB7XG4gICAgICAgIHNpZ25ZICo9IC0xO1xuICAgICAgICB0ID0gbjAsIG4wID0gczAsIHMwID0gdDtcbiAgICAgICAgdCA9IG4xLCBuMSA9IHMxLCBzMSA9IHQ7XG4gICAgICAgIGlmICh0eXBlIGluIGZsaXBZKSBvdmVybGF5LmF0dHIoXCJjdXJzb3JcIiwgY3Vyc29yc1t0eXBlID0gZmxpcFlbdHlwZV1dKTtcbiAgICAgIH1cblxuICAgICAgaWYgKHN0YXRlLnNlbGVjdGlvbikgc2VsZWN0aW9uID0gc3RhdGUuc2VsZWN0aW9uOyAvLyBNYXkgYmUgc2V0IGJ5IGJydXNoLm1vdmUhXG4gICAgICBpZiAobG9ja1gpIHcxID0gc2VsZWN0aW9uWzBdWzBdLCBlMSA9IHNlbGVjdGlvblsxXVswXTtcbiAgICAgIGlmIChsb2NrWSkgbjEgPSBzZWxlY3Rpb25bMF1bMV0sIHMxID0gc2VsZWN0aW9uWzFdWzFdO1xuXG4gICAgICBpZiAoc2VsZWN0aW9uWzBdWzBdICE9PSB3MVxuICAgICAgICAgIHx8IHNlbGVjdGlvblswXVsxXSAhPT0gbjFcbiAgICAgICAgICB8fCBzZWxlY3Rpb25bMV1bMF0gIT09IGUxXG4gICAgICAgICAgfHwgc2VsZWN0aW9uWzFdWzFdICE9PSBzMSkge1xuICAgICAgICBzdGF0ZS5zZWxlY3Rpb24gPSBbW3cxLCBuMV0sIFtlMSwgczFdXTtcbiAgICAgICAgcmVkcmF3LmNhbGwodGhhdCk7XG4gICAgICAgIGVtaXQuYnJ1c2goZXZlbnQsIG1vZGUubmFtZSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZW5kZWQoZXZlbnQpIHtcbiAgICAgIG5vcHJvcGFnYXRpb24oZXZlbnQpO1xuICAgICAgaWYgKGV2ZW50LnRvdWNoZXMpIHtcbiAgICAgICAgaWYgKGV2ZW50LnRvdWNoZXMubGVuZ3RoKSByZXR1cm47XG4gICAgICAgIGlmICh0b3VjaGVuZGluZykgY2xlYXJUaW1lb3V0KHRvdWNoZW5kaW5nKTtcbiAgICAgICAgdG91Y2hlbmRpbmcgPSBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkgeyB0b3VjaGVuZGluZyA9IG51bGw7IH0sIDUwMCk7IC8vIEdob3N0IGNsaWNrcyBhcmUgZGVsYXllZCFcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRyYWdFbmFibGUoZXZlbnQudmlldywgbW92aW5nKTtcbiAgICAgICAgdmlldy5vbihcImtleWRvd24uYnJ1c2gga2V5dXAuYnJ1c2ggbW91c2Vtb3ZlLmJydXNoIG1vdXNldXAuYnJ1c2hcIiwgbnVsbCk7XG4gICAgICB9XG4gICAgICBncm91cC5hdHRyKFwicG9pbnRlci1ldmVudHNcIiwgXCJhbGxcIik7XG4gICAgICBvdmVybGF5LmF0dHIoXCJjdXJzb3JcIiwgY3Vyc29ycy5vdmVybGF5KTtcbiAgICAgIGlmIChzdGF0ZS5zZWxlY3Rpb24pIHNlbGVjdGlvbiA9IHN0YXRlLnNlbGVjdGlvbjsgLy8gTWF5IGJlIHNldCBieSBicnVzaC5tb3ZlIChvbiBzdGFydCkhXG4gICAgICBpZiAoZW1wdHkoc2VsZWN0aW9uKSkgc3RhdGUuc2VsZWN0aW9uID0gbnVsbCwgcmVkcmF3LmNhbGwodGhhdCk7XG4gICAgICBlbWl0LmVuZChldmVudCwgbW9kZS5uYW1lKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBrZXlkb3duZWQoZXZlbnQpIHtcbiAgICAgIHN3aXRjaCAoZXZlbnQua2V5Q29kZSkge1xuICAgICAgICBjYXNlIDE2OiB7IC8vIFNISUZUXG4gICAgICAgICAgc2hpZnRpbmcgPSBzaWduWCAmJiBzaWduWTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjYXNlIDE4OiB7IC8vIEFMVFxuICAgICAgICAgIGlmIChtb2RlID09PSBNT0RFX0hBTkRMRSkge1xuICAgICAgICAgICAgaWYgKHNpZ25YKSBlMCA9IGUxIC0gZHggKiBzaWduWCwgdzAgPSB3MSArIGR4ICogc2lnblg7XG4gICAgICAgICAgICBpZiAoc2lnblkpIHMwID0gczEgLSBkeSAqIHNpZ25ZLCBuMCA9IG4xICsgZHkgKiBzaWduWTtcbiAgICAgICAgICAgIG1vZGUgPSBNT0RFX0NFTlRFUjtcbiAgICAgICAgICAgIG1vdmUoZXZlbnQpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjYXNlIDMyOiB7IC8vIFNQQUNFOyB0YWtlcyBwcmlvcml0eSBvdmVyIEFMVFxuICAgICAgICAgIGlmIChtb2RlID09PSBNT0RFX0hBTkRMRSB8fCBtb2RlID09PSBNT0RFX0NFTlRFUikge1xuICAgICAgICAgICAgaWYgKHNpZ25YIDwgMCkgZTAgPSBlMSAtIGR4OyBlbHNlIGlmIChzaWduWCA+IDApIHcwID0gdzEgLSBkeDtcbiAgICAgICAgICAgIGlmIChzaWduWSA8IDApIHMwID0gczEgLSBkeTsgZWxzZSBpZiAoc2lnblkgPiAwKSBuMCA9IG4xIC0gZHk7XG4gICAgICAgICAgICBtb2RlID0gTU9ERV9TUEFDRTtcbiAgICAgICAgICAgIG92ZXJsYXkuYXR0cihcImN1cnNvclwiLCBjdXJzb3JzLnNlbGVjdGlvbik7XG4gICAgICAgICAgICBtb3ZlKGV2ZW50KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgZGVmYXVsdDogcmV0dXJuO1xuICAgICAgfVxuICAgICAgbm9ldmVudChldmVudCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24ga2V5dXBwZWQoZXZlbnQpIHtcbiAgICAgIHN3aXRjaCAoZXZlbnQua2V5Q29kZSkge1xuICAgICAgICBjYXNlIDE2OiB7IC8vIFNISUZUXG4gICAgICAgICAgaWYgKHNoaWZ0aW5nKSB7XG4gICAgICAgICAgICBsb2NrWCA9IGxvY2tZID0gc2hpZnRpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgIG1vdmUoZXZlbnQpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjYXNlIDE4OiB7IC8vIEFMVFxuICAgICAgICAgIGlmIChtb2RlID09PSBNT0RFX0NFTlRFUikge1xuICAgICAgICAgICAgaWYgKHNpZ25YIDwgMCkgZTAgPSBlMTsgZWxzZSBpZiAoc2lnblggPiAwKSB3MCA9IHcxO1xuICAgICAgICAgICAgaWYgKHNpZ25ZIDwgMCkgczAgPSBzMTsgZWxzZSBpZiAoc2lnblkgPiAwKSBuMCA9IG4xO1xuICAgICAgICAgICAgbW9kZSA9IE1PREVfSEFORExFO1xuICAgICAgICAgICAgbW92ZShldmVudCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGNhc2UgMzI6IHsgLy8gU1BBQ0VcbiAgICAgICAgICBpZiAobW9kZSA9PT0gTU9ERV9TUEFDRSkge1xuICAgICAgICAgICAgaWYgKGV2ZW50LmFsdEtleSkge1xuICAgICAgICAgICAgICBpZiAoc2lnblgpIGUwID0gZTEgLSBkeCAqIHNpZ25YLCB3MCA9IHcxICsgZHggKiBzaWduWDtcbiAgICAgICAgICAgICAgaWYgKHNpZ25ZKSBzMCA9IHMxIC0gZHkgKiBzaWduWSwgbjAgPSBuMSArIGR5ICogc2lnblk7XG4gICAgICAgICAgICAgIG1vZGUgPSBNT0RFX0NFTlRFUjtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGlmIChzaWduWCA8IDApIGUwID0gZTE7IGVsc2UgaWYgKHNpZ25YID4gMCkgdzAgPSB3MTtcbiAgICAgICAgICAgICAgaWYgKHNpZ25ZIDwgMCkgczAgPSBzMTsgZWxzZSBpZiAoc2lnblkgPiAwKSBuMCA9IG4xO1xuICAgICAgICAgICAgICBtb2RlID0gTU9ERV9IQU5ETEU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBvdmVybGF5LmF0dHIoXCJjdXJzb3JcIiwgY3Vyc29yc1t0eXBlXSk7XG4gICAgICAgICAgICBtb3ZlKGV2ZW50KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgZGVmYXVsdDogcmV0dXJuO1xuICAgICAgfVxuICAgICAgbm9ldmVudChldmVudCk7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gdG91Y2htb3ZlZChldmVudCkge1xuICAgIGVtaXR0ZXIodGhpcywgYXJndW1lbnRzKS5tb3ZlZChldmVudCk7XG4gIH1cblxuICBmdW5jdGlvbiB0b3VjaGVuZGVkKGV2ZW50KSB7XG4gICAgZW1pdHRlcih0aGlzLCBhcmd1bWVudHMpLmVuZGVkKGV2ZW50KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGluaXRpYWxpemUoKSB7XG4gICAgdmFyIHN0YXRlID0gdGhpcy5fX2JydXNoIHx8IHtzZWxlY3Rpb246IG51bGx9O1xuICAgIHN0YXRlLmV4dGVudCA9IG51bWJlcjIoZXh0ZW50LmFwcGx5KHRoaXMsIGFyZ3VtZW50cykpO1xuICAgIHN0YXRlLmRpbSA9IGRpbTtcbiAgICByZXR1cm4gc3RhdGU7XG4gIH1cblxuICBicnVzaC5leHRlbnQgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoZXh0ZW50ID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudChudW1iZXIyKF8pKSwgYnJ1c2gpIDogZXh0ZW50O1xuICB9O1xuXG4gIGJydXNoLmZpbHRlciA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChmaWx0ZXIgPSB0eXBlb2YgXyA9PT0gXCJmdW5jdGlvblwiID8gXyA6IGNvbnN0YW50KCEhXyksIGJydXNoKSA6IGZpbHRlcjtcbiAgfTtcblxuICBicnVzaC50b3VjaGFibGUgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAodG91Y2hhYmxlID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudCghIV8pLCBicnVzaCkgOiB0b3VjaGFibGU7XG4gIH07XG5cbiAgYnJ1c2guaGFuZGxlU2l6ZSA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChoYW5kbGVTaXplID0gK18sIGJydXNoKSA6IGhhbmRsZVNpemU7XG4gIH07XG5cbiAgYnJ1c2gua2V5TW9kaWZpZXJzID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGtleXMgPSAhIV8sIGJydXNoKSA6IGtleXM7XG4gIH07XG5cbiAgYnJ1c2gub24gPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgdmFsdWUgPSBsaXN0ZW5lcnMub24uYXBwbHkobGlzdGVuZXJzLCBhcmd1bWVudHMpO1xuICAgIHJldHVybiB2YWx1ZSA9PT0gbGlzdGVuZXJzID8gYnJ1c2ggOiB2YWx1ZTtcbiAgfTtcblxuICByZXR1cm4gYnJ1c2g7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oZCkge1xuICBjb25zdCB4ID0gK3RoaXMuX3guY2FsbChudWxsLCBkKSxcbiAgICAgIHkgPSArdGhpcy5feS5jYWxsKG51bGwsIGQpO1xuICByZXR1cm4gYWRkKHRoaXMuY292ZXIoeCwgeSksIHgsIHksIGQpO1xufVxuXG5mdW5jdGlvbiBhZGQodHJlZSwgeCwgeSwgZCkge1xuICBpZiAoaXNOYU4oeCkgfHwgaXNOYU4oeSkpIHJldHVybiB0cmVlOyAvLyBpZ25vcmUgaW52YWxpZCBwb2ludHNcblxuICB2YXIgcGFyZW50LFxuICAgICAgbm9kZSA9IHRyZWUuX3Jvb3QsXG4gICAgICBsZWFmID0ge2RhdGE6IGR9LFxuICAgICAgeDAgPSB0cmVlLl94MCxcbiAgICAgIHkwID0gdHJlZS5feTAsXG4gICAgICB4MSA9IHRyZWUuX3gxLFxuICAgICAgeTEgPSB0cmVlLl95MSxcbiAgICAgIHhtLFxuICAgICAgeW0sXG4gICAgICB4cCxcbiAgICAgIHlwLFxuICAgICAgcmlnaHQsXG4gICAgICBib3R0b20sXG4gICAgICBpLFxuICAgICAgajtcblxuICAvLyBJZiB0aGUgdHJlZSBpcyBlbXB0eSwgaW5pdGlhbGl6ZSB0aGUgcm9vdCBhcyBhIGxlYWYuXG4gIGlmICghbm9kZSkgcmV0dXJuIHRyZWUuX3Jvb3QgPSBsZWFmLCB0cmVlO1xuXG4gIC8vIEZpbmQgdGhlIGV4aXN0aW5nIGxlYWYgZm9yIHRoZSBuZXcgcG9pbnQsIG9yIGFkZCBpdC5cbiAgd2hpbGUgKG5vZGUubGVuZ3RoKSB7XG4gICAgaWYgKHJpZ2h0ID0geCA+PSAoeG0gPSAoeDAgKyB4MSkgLyAyKSkgeDAgPSB4bTsgZWxzZSB4MSA9IHhtO1xuICAgIGlmIChib3R0b20gPSB5ID49ICh5bSA9ICh5MCArIHkxKSAvIDIpKSB5MCA9IHltOyBlbHNlIHkxID0geW07XG4gICAgaWYgKHBhcmVudCA9IG5vZGUsICEobm9kZSA9IG5vZGVbaSA9IGJvdHRvbSA8PCAxIHwgcmlnaHRdKSkgcmV0dXJuIHBhcmVudFtpXSA9IGxlYWYsIHRyZWU7XG4gIH1cblxuICAvLyBJcyB0aGUgbmV3IHBvaW50IGlzIGV4YWN0bHkgY29pbmNpZGVudCB3aXRoIHRoZSBleGlzdGluZyBwb2ludD9cbiAgeHAgPSArdHJlZS5feC5jYWxsKG51bGwsIG5vZGUuZGF0YSk7XG4gIHlwID0gK3RyZWUuX3kuY2FsbChudWxsLCBub2RlLmRhdGEpO1xuICBpZiAoeCA9PT0geHAgJiYgeSA9PT0geXApIHJldHVybiBsZWFmLm5leHQgPSBub2RlLCBwYXJlbnQgPyBwYXJlbnRbaV0gPSBsZWFmIDogdHJlZS5fcm9vdCA9IGxlYWYsIHRyZWU7XG5cbiAgLy8gT3RoZXJ3aXNlLCBzcGxpdCB0aGUgbGVhZiBub2RlIHVudGlsIHRoZSBvbGQgYW5kIG5ldyBwb2ludCBhcmUgc2VwYXJhdGVkLlxuICBkbyB7XG4gICAgcGFyZW50ID0gcGFyZW50ID8gcGFyZW50W2ldID0gbmV3IEFycmF5KDQpIDogdHJlZS5fcm9vdCA9IG5ldyBBcnJheSg0KTtcbiAgICBpZiAocmlnaHQgPSB4ID49ICh4bSA9ICh4MCArIHgxKSAvIDIpKSB4MCA9IHhtOyBlbHNlIHgxID0geG07XG4gICAgaWYgKGJvdHRvbSA9IHkgPj0gKHltID0gKHkwICsgeTEpIC8gMikpIHkwID0geW07IGVsc2UgeTEgPSB5bTtcbiAgfSB3aGlsZSAoKGkgPSBib3R0b20gPDwgMSB8IHJpZ2h0KSA9PT0gKGogPSAoeXAgPj0geW0pIDw8IDEgfCAoeHAgPj0geG0pKSk7XG4gIHJldHVybiBwYXJlbnRbal0gPSBub2RlLCBwYXJlbnRbaV0gPSBsZWFmLCB0cmVlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYWRkQWxsKGRhdGEpIHtcbiAgdmFyIGQsIGksIG4gPSBkYXRhLmxlbmd0aCxcbiAgICAgIHgsXG4gICAgICB5LFxuICAgICAgeHogPSBuZXcgQXJyYXkobiksXG4gICAgICB5eiA9IG5ldyBBcnJheShuKSxcbiAgICAgIHgwID0gSW5maW5pdHksXG4gICAgICB5MCA9IEluZmluaXR5LFxuICAgICAgeDEgPSAtSW5maW5pdHksXG4gICAgICB5MSA9IC1JbmZpbml0eTtcblxuICAvLyBDb21wdXRlIHRoZSBwb2ludHMgYW5kIHRoZWlyIGV4dGVudC5cbiAgZm9yIChpID0gMDsgaSA8IG47ICsraSkge1xuICAgIGlmIChpc05hTih4ID0gK3RoaXMuX3guY2FsbChudWxsLCBkID0gZGF0YVtpXSkpIHx8IGlzTmFOKHkgPSArdGhpcy5feS5jYWxsKG51bGwsIGQpKSkgY29udGludWU7XG4gICAgeHpbaV0gPSB4O1xuICAgIHl6W2ldID0geTtcbiAgICBpZiAoeCA8IHgwKSB4MCA9IHg7XG4gICAgaWYgKHggPiB4MSkgeDEgPSB4O1xuICAgIGlmICh5IDwgeTApIHkwID0geTtcbiAgICBpZiAoeSA+IHkxKSB5MSA9IHk7XG4gIH1cblxuICAvLyBJZiB0aGVyZSB3ZXJlIG5vICh2YWxpZCkgcG9pbnRzLCBhYm9ydC5cbiAgaWYgKHgwID4geDEgfHwgeTAgPiB5MSkgcmV0dXJuIHRoaXM7XG5cbiAgLy8gRXhwYW5kIHRoZSB0cmVlIHRvIGNvdmVyIHRoZSBuZXcgcG9pbnRzLlxuICB0aGlzLmNvdmVyKHgwLCB5MCkuY292ZXIoeDEsIHkxKTtcblxuICAvLyBBZGQgdGhlIG5ldyBwb2ludHMuXG4gIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICBhZGQodGhpcywgeHpbaV0sIHl6W2ldLCBkYXRhW2ldKTtcbiAgfVxuXG4gIHJldHVybiB0aGlzO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHgsIHkpIHtcbiAgaWYgKGlzTmFOKHggPSAreCkgfHwgaXNOYU4oeSA9ICt5KSkgcmV0dXJuIHRoaXM7IC8vIGlnbm9yZSBpbnZhbGlkIHBvaW50c1xuXG4gIHZhciB4MCA9IHRoaXMuX3gwLFxuICAgICAgeTAgPSB0aGlzLl95MCxcbiAgICAgIHgxID0gdGhpcy5feDEsXG4gICAgICB5MSA9IHRoaXMuX3kxO1xuXG4gIC8vIElmIHRoZSBxdWFkdHJlZSBoYXMgbm8gZXh0ZW50LCBpbml0aWFsaXplIHRoZW0uXG4gIC8vIEludGVnZXIgZXh0ZW50IGFyZSBuZWNlc3Nhcnkgc28gdGhhdCBpZiB3ZSBsYXRlciBkb3VibGUgdGhlIGV4dGVudCxcbiAgLy8gdGhlIGV4aXN0aW5nIHF1YWRyYW50IGJvdW5kYXJpZXMgZG9uXHUyMDE5dCBjaGFuZ2UgZHVlIHRvIGZsb2F0aW5nIHBvaW50IGVycm9yIVxuICBpZiAoaXNOYU4oeDApKSB7XG4gICAgeDEgPSAoeDAgPSBNYXRoLmZsb29yKHgpKSArIDE7XG4gICAgeTEgPSAoeTAgPSBNYXRoLmZsb29yKHkpKSArIDE7XG4gIH1cblxuICAvLyBPdGhlcndpc2UsIGRvdWJsZSByZXBlYXRlZGx5IHRvIGNvdmVyLlxuICBlbHNlIHtcbiAgICB2YXIgeiA9IHgxIC0geDAgfHwgMSxcbiAgICAgICAgbm9kZSA9IHRoaXMuX3Jvb3QsXG4gICAgICAgIHBhcmVudCxcbiAgICAgICAgaTtcblxuICAgIHdoaWxlICh4MCA+IHggfHwgeCA+PSB4MSB8fCB5MCA+IHkgfHwgeSA+PSB5MSkge1xuICAgICAgaSA9ICh5IDwgeTApIDw8IDEgfCAoeCA8IHgwKTtcbiAgICAgIHBhcmVudCA9IG5ldyBBcnJheSg0KSwgcGFyZW50W2ldID0gbm9kZSwgbm9kZSA9IHBhcmVudCwgeiAqPSAyO1xuICAgICAgc3dpdGNoIChpKSB7XG4gICAgICAgIGNhc2UgMDogeDEgPSB4MCArIHosIHkxID0geTAgKyB6OyBicmVhaztcbiAgICAgICAgY2FzZSAxOiB4MCA9IHgxIC0geiwgeTEgPSB5MCArIHo7IGJyZWFrO1xuICAgICAgICBjYXNlIDI6IHgxID0geDAgKyB6LCB5MCA9IHkxIC0gejsgYnJlYWs7XG4gICAgICAgIGNhc2UgMzogeDAgPSB4MSAtIHosIHkwID0geTEgLSB6OyBicmVhaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodGhpcy5fcm9vdCAmJiB0aGlzLl9yb290Lmxlbmd0aCkgdGhpcy5fcm9vdCA9IG5vZGU7XG4gIH1cblxuICB0aGlzLl94MCA9IHgwO1xuICB0aGlzLl95MCA9IHkwO1xuICB0aGlzLl94MSA9IHgxO1xuICB0aGlzLl95MSA9IHkxO1xuICByZXR1cm4gdGhpcztcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgdmFyIGRhdGEgPSBbXTtcbiAgdGhpcy52aXNpdChmdW5jdGlvbihub2RlKSB7XG4gICAgaWYgKCFub2RlLmxlbmd0aCkgZG8gZGF0YS5wdXNoKG5vZGUuZGF0YSk7IHdoaWxlIChub2RlID0gbm9kZS5uZXh0KVxuICB9KTtcbiAgcmV0dXJuIGRhdGE7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oXykge1xuICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aFxuICAgICAgPyB0aGlzLmNvdmVyKCtfWzBdWzBdLCArX1swXVsxXSkuY292ZXIoK19bMV1bMF0sICtfWzFdWzFdKVxuICAgICAgOiBpc05hTih0aGlzLl94MCkgPyB1bmRlZmluZWQgOiBbW3RoaXMuX3gwLCB0aGlzLl95MF0sIFt0aGlzLl94MSwgdGhpcy5feTFdXTtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbihub2RlLCB4MCwgeTAsIHgxLCB5MSkge1xuICB0aGlzLm5vZGUgPSBub2RlO1xuICB0aGlzLngwID0geDA7XG4gIHRoaXMueTAgPSB5MDtcbiAgdGhpcy54MSA9IHgxO1xuICB0aGlzLnkxID0geTE7XG59XG4iLCAiaW1wb3J0IFF1YWQgZnJvbSBcIi4vcXVhZC5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih4LCB5LCByYWRpdXMpIHtcbiAgdmFyIGRhdGEsXG4gICAgICB4MCA9IHRoaXMuX3gwLFxuICAgICAgeTAgPSB0aGlzLl95MCxcbiAgICAgIHgxLFxuICAgICAgeTEsXG4gICAgICB4MixcbiAgICAgIHkyLFxuICAgICAgeDMgPSB0aGlzLl94MSxcbiAgICAgIHkzID0gdGhpcy5feTEsXG4gICAgICBxdWFkcyA9IFtdLFxuICAgICAgbm9kZSA9IHRoaXMuX3Jvb3QsXG4gICAgICBxLFxuICAgICAgaTtcblxuICBpZiAobm9kZSkgcXVhZHMucHVzaChuZXcgUXVhZChub2RlLCB4MCwgeTAsIHgzLCB5MykpO1xuICBpZiAocmFkaXVzID09IG51bGwpIHJhZGl1cyA9IEluZmluaXR5O1xuICBlbHNlIHtcbiAgICB4MCA9IHggLSByYWRpdXMsIHkwID0geSAtIHJhZGl1cztcbiAgICB4MyA9IHggKyByYWRpdXMsIHkzID0geSArIHJhZGl1cztcbiAgICByYWRpdXMgKj0gcmFkaXVzO1xuICB9XG5cbiAgd2hpbGUgKHEgPSBxdWFkcy5wb3AoKSkge1xuXG4gICAgLy8gU3RvcCBzZWFyY2hpbmcgaWYgdGhpcyBxdWFkcmFudCBjYW5cdTIwMTl0IGNvbnRhaW4gYSBjbG9zZXIgbm9kZS5cbiAgICBpZiAoIShub2RlID0gcS5ub2RlKVxuICAgICAgICB8fCAoeDEgPSBxLngwKSA+IHgzXG4gICAgICAgIHx8ICh5MSA9IHEueTApID4geTNcbiAgICAgICAgfHwgKHgyID0gcS54MSkgPCB4MFxuICAgICAgICB8fCAoeTIgPSBxLnkxKSA8IHkwKSBjb250aW51ZTtcblxuICAgIC8vIEJpc2VjdCB0aGUgY3VycmVudCBxdWFkcmFudC5cbiAgICBpZiAobm9kZS5sZW5ndGgpIHtcbiAgICAgIHZhciB4bSA9ICh4MSArIHgyKSAvIDIsXG4gICAgICAgICAgeW0gPSAoeTEgKyB5MikgLyAyO1xuXG4gICAgICBxdWFkcy5wdXNoKFxuICAgICAgICBuZXcgUXVhZChub2RlWzNdLCB4bSwgeW0sIHgyLCB5MiksXG4gICAgICAgIG5ldyBRdWFkKG5vZGVbMl0sIHgxLCB5bSwgeG0sIHkyKSxcbiAgICAgICAgbmV3IFF1YWQobm9kZVsxXSwgeG0sIHkxLCB4MiwgeW0pLFxuICAgICAgICBuZXcgUXVhZChub2RlWzBdLCB4MSwgeTEsIHhtLCB5bSlcbiAgICAgICk7XG5cbiAgICAgIC8vIFZpc2l0IHRoZSBjbG9zZXN0IHF1YWRyYW50IGZpcnN0LlxuICAgICAgaWYgKGkgPSAoeSA+PSB5bSkgPDwgMSB8ICh4ID49IHhtKSkge1xuICAgICAgICBxID0gcXVhZHNbcXVhZHMubGVuZ3RoIC0gMV07XG4gICAgICAgIHF1YWRzW3F1YWRzLmxlbmd0aCAtIDFdID0gcXVhZHNbcXVhZHMubGVuZ3RoIC0gMSAtIGldO1xuICAgICAgICBxdWFkc1txdWFkcy5sZW5ndGggLSAxIC0gaV0gPSBxO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFZpc2l0IHRoaXMgcG9pbnQuIChWaXNpdGluZyBjb2luY2lkZW50IHBvaW50cyBpc25cdTIwMTl0IG5lY2Vzc2FyeSEpXG4gICAgZWxzZSB7XG4gICAgICB2YXIgZHggPSB4IC0gK3RoaXMuX3guY2FsbChudWxsLCBub2RlLmRhdGEpLFxuICAgICAgICAgIGR5ID0geSAtICt0aGlzLl95LmNhbGwobnVsbCwgbm9kZS5kYXRhKSxcbiAgICAgICAgICBkMiA9IGR4ICogZHggKyBkeSAqIGR5O1xuICAgICAgaWYgKGQyIDwgcmFkaXVzKSB7XG4gICAgICAgIHZhciBkID0gTWF0aC5zcXJ0KHJhZGl1cyA9IGQyKTtcbiAgICAgICAgeDAgPSB4IC0gZCwgeTAgPSB5IC0gZDtcbiAgICAgICAgeDMgPSB4ICsgZCwgeTMgPSB5ICsgZDtcbiAgICAgICAgZGF0YSA9IG5vZGUuZGF0YTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gZGF0YTtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbihkKSB7XG4gIGlmIChpc05hTih4ID0gK3RoaXMuX3guY2FsbChudWxsLCBkKSkgfHwgaXNOYU4oeSA9ICt0aGlzLl95LmNhbGwobnVsbCwgZCkpKSByZXR1cm4gdGhpczsgLy8gaWdub3JlIGludmFsaWQgcG9pbnRzXG5cbiAgdmFyIHBhcmVudCxcbiAgICAgIG5vZGUgPSB0aGlzLl9yb290LFxuICAgICAgcmV0YWluZXIsXG4gICAgICBwcmV2aW91cyxcbiAgICAgIG5leHQsXG4gICAgICB4MCA9IHRoaXMuX3gwLFxuICAgICAgeTAgPSB0aGlzLl95MCxcbiAgICAgIHgxID0gdGhpcy5feDEsXG4gICAgICB5MSA9IHRoaXMuX3kxLFxuICAgICAgeCxcbiAgICAgIHksXG4gICAgICB4bSxcbiAgICAgIHltLFxuICAgICAgcmlnaHQsXG4gICAgICBib3R0b20sXG4gICAgICBpLFxuICAgICAgajtcblxuICAvLyBJZiB0aGUgdHJlZSBpcyBlbXB0eSwgaW5pdGlhbGl6ZSB0aGUgcm9vdCBhcyBhIGxlYWYuXG4gIGlmICghbm9kZSkgcmV0dXJuIHRoaXM7XG5cbiAgLy8gRmluZCB0aGUgbGVhZiBub2RlIGZvciB0aGUgcG9pbnQuXG4gIC8vIFdoaWxlIGRlc2NlbmRpbmcsIGFsc28gcmV0YWluIHRoZSBkZWVwZXN0IHBhcmVudCB3aXRoIGEgbm9uLXJlbW92ZWQgc2libGluZy5cbiAgaWYgKG5vZGUubGVuZ3RoKSB3aGlsZSAodHJ1ZSkge1xuICAgIGlmIChyaWdodCA9IHggPj0gKHhtID0gKHgwICsgeDEpIC8gMikpIHgwID0geG07IGVsc2UgeDEgPSB4bTtcbiAgICBpZiAoYm90dG9tID0geSA+PSAoeW0gPSAoeTAgKyB5MSkgLyAyKSkgeTAgPSB5bTsgZWxzZSB5MSA9IHltO1xuICAgIGlmICghKHBhcmVudCA9IG5vZGUsIG5vZGUgPSBub2RlW2kgPSBib3R0b20gPDwgMSB8IHJpZ2h0XSkpIHJldHVybiB0aGlzO1xuICAgIGlmICghbm9kZS5sZW5ndGgpIGJyZWFrO1xuICAgIGlmIChwYXJlbnRbKGkgKyAxKSAmIDNdIHx8IHBhcmVudFsoaSArIDIpICYgM10gfHwgcGFyZW50WyhpICsgMykgJiAzXSkgcmV0YWluZXIgPSBwYXJlbnQsIGogPSBpO1xuICB9XG5cbiAgLy8gRmluZCB0aGUgcG9pbnQgdG8gcmVtb3ZlLlxuICB3aGlsZSAobm9kZS5kYXRhICE9PSBkKSBpZiAoIShwcmV2aW91cyA9IG5vZGUsIG5vZGUgPSBub2RlLm5leHQpKSByZXR1cm4gdGhpcztcbiAgaWYgKG5leHQgPSBub2RlLm5leHQpIGRlbGV0ZSBub2RlLm5leHQ7XG5cbiAgLy8gSWYgdGhlcmUgYXJlIG11bHRpcGxlIGNvaW5jaWRlbnQgcG9pbnRzLCByZW1vdmUganVzdCB0aGUgcG9pbnQuXG4gIGlmIChwcmV2aW91cykgcmV0dXJuIChuZXh0ID8gcHJldmlvdXMubmV4dCA9IG5leHQgOiBkZWxldGUgcHJldmlvdXMubmV4dCksIHRoaXM7XG5cbiAgLy8gSWYgdGhpcyBpcyB0aGUgcm9vdCBwb2ludCwgcmVtb3ZlIGl0LlxuICBpZiAoIXBhcmVudCkgcmV0dXJuIHRoaXMuX3Jvb3QgPSBuZXh0LCB0aGlzO1xuXG4gIC8vIFJlbW92ZSB0aGlzIGxlYWYuXG4gIG5leHQgPyBwYXJlbnRbaV0gPSBuZXh0IDogZGVsZXRlIHBhcmVudFtpXTtcblxuICAvLyBJZiB0aGUgcGFyZW50IG5vdyBjb250YWlucyBleGFjdGx5IG9uZSBsZWFmLCBjb2xsYXBzZSBzdXBlcmZsdW91cyBwYXJlbnRzLlxuICBpZiAoKG5vZGUgPSBwYXJlbnRbMF0gfHwgcGFyZW50WzFdIHx8IHBhcmVudFsyXSB8fCBwYXJlbnRbM10pXG4gICAgICAmJiBub2RlID09PSAocGFyZW50WzNdIHx8IHBhcmVudFsyXSB8fCBwYXJlbnRbMV0gfHwgcGFyZW50WzBdKVxuICAgICAgJiYgIW5vZGUubGVuZ3RoKSB7XG4gICAgaWYgKHJldGFpbmVyKSByZXRhaW5lcltqXSA9IG5vZGU7XG4gICAgZWxzZSB0aGlzLl9yb290ID0gbm9kZTtcbiAgfVxuXG4gIHJldHVybiB0aGlzO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVtb3ZlQWxsKGRhdGEpIHtcbiAgZm9yICh2YXIgaSA9IDAsIG4gPSBkYXRhLmxlbmd0aDsgaSA8IG47ICsraSkgdGhpcy5yZW1vdmUoZGF0YVtpXSk7XG4gIHJldHVybiB0aGlzO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5fcm9vdDtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgdmFyIHNpemUgPSAwO1xuICB0aGlzLnZpc2l0KGZ1bmN0aW9uKG5vZGUpIHtcbiAgICBpZiAoIW5vZGUubGVuZ3RoKSBkbyArK3NpemU7IHdoaWxlIChub2RlID0gbm9kZS5uZXh0KVxuICB9KTtcbiAgcmV0dXJuIHNpemU7XG59XG4iLCAiaW1wb3J0IFF1YWQgZnJvbSBcIi4vcXVhZC5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihjYWxsYmFjaykge1xuICB2YXIgcXVhZHMgPSBbXSwgcSwgbm9kZSA9IHRoaXMuX3Jvb3QsIGNoaWxkLCB4MCwgeTAsIHgxLCB5MTtcbiAgaWYgKG5vZGUpIHF1YWRzLnB1c2gobmV3IFF1YWQobm9kZSwgdGhpcy5feDAsIHRoaXMuX3kwLCB0aGlzLl94MSwgdGhpcy5feTEpKTtcbiAgd2hpbGUgKHEgPSBxdWFkcy5wb3AoKSkge1xuICAgIGlmICghY2FsbGJhY2sobm9kZSA9IHEubm9kZSwgeDAgPSBxLngwLCB5MCA9IHEueTAsIHgxID0gcS54MSwgeTEgPSBxLnkxKSAmJiBub2RlLmxlbmd0aCkge1xuICAgICAgdmFyIHhtID0gKHgwICsgeDEpIC8gMiwgeW0gPSAoeTAgKyB5MSkgLyAyO1xuICAgICAgaWYgKGNoaWxkID0gbm9kZVszXSkgcXVhZHMucHVzaChuZXcgUXVhZChjaGlsZCwgeG0sIHltLCB4MSwgeTEpKTtcbiAgICAgIGlmIChjaGlsZCA9IG5vZGVbMl0pIHF1YWRzLnB1c2gobmV3IFF1YWQoY2hpbGQsIHgwLCB5bSwgeG0sIHkxKSk7XG4gICAgICBpZiAoY2hpbGQgPSBub2RlWzFdKSBxdWFkcy5wdXNoKG5ldyBRdWFkKGNoaWxkLCB4bSwgeTAsIHgxLCB5bSkpO1xuICAgICAgaWYgKGNoaWxkID0gbm9kZVswXSkgcXVhZHMucHVzaChuZXcgUXVhZChjaGlsZCwgeDAsIHkwLCB4bSwgeW0pKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHRoaXM7XG59XG4iLCAiaW1wb3J0IFF1YWQgZnJvbSBcIi4vcXVhZC5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihjYWxsYmFjaykge1xuICB2YXIgcXVhZHMgPSBbXSwgbmV4dCA9IFtdLCBxO1xuICBpZiAodGhpcy5fcm9vdCkgcXVhZHMucHVzaChuZXcgUXVhZCh0aGlzLl9yb290LCB0aGlzLl94MCwgdGhpcy5feTAsIHRoaXMuX3gxLCB0aGlzLl95MSkpO1xuICB3aGlsZSAocSA9IHF1YWRzLnBvcCgpKSB7XG4gICAgdmFyIG5vZGUgPSBxLm5vZGU7XG4gICAgaWYgKG5vZGUubGVuZ3RoKSB7XG4gICAgICB2YXIgY2hpbGQsIHgwID0gcS54MCwgeTAgPSBxLnkwLCB4MSA9IHEueDEsIHkxID0gcS55MSwgeG0gPSAoeDAgKyB4MSkgLyAyLCB5bSA9ICh5MCArIHkxKSAvIDI7XG4gICAgICBpZiAoY2hpbGQgPSBub2RlWzBdKSBxdWFkcy5wdXNoKG5ldyBRdWFkKGNoaWxkLCB4MCwgeTAsIHhtLCB5bSkpO1xuICAgICAgaWYgKGNoaWxkID0gbm9kZVsxXSkgcXVhZHMucHVzaChuZXcgUXVhZChjaGlsZCwgeG0sIHkwLCB4MSwgeW0pKTtcbiAgICAgIGlmIChjaGlsZCA9IG5vZGVbMl0pIHF1YWRzLnB1c2gobmV3IFF1YWQoY2hpbGQsIHgwLCB5bSwgeG0sIHkxKSk7XG4gICAgICBpZiAoY2hpbGQgPSBub2RlWzNdKSBxdWFkcy5wdXNoKG5ldyBRdWFkKGNoaWxkLCB4bSwgeW0sIHgxLCB5MSkpO1xuICAgIH1cbiAgICBuZXh0LnB1c2gocSk7XG4gIH1cbiAgd2hpbGUgKHEgPSBuZXh0LnBvcCgpKSB7XG4gICAgY2FsbGJhY2socS5ub2RlLCBxLngwLCBxLnkwLCBxLngxLCBxLnkxKTtcbiAgfVxuICByZXR1cm4gdGhpcztcbn1cbiIsICJleHBvcnQgZnVuY3Rpb24gZGVmYXVsdFgoZCkge1xuICByZXR1cm4gZFswXTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oXykge1xuICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/ICh0aGlzLl94ID0gXywgdGhpcykgOiB0aGlzLl94O1xufVxuIiwgImV4cG9ydCBmdW5jdGlvbiBkZWZhdWx0WShkKSB7XG4gIHJldHVybiBkWzFdO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihfKSB7XG4gIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHRoaXMuX3kgPSBfLCB0aGlzKSA6IHRoaXMuX3k7XG59XG4iLCAiaW1wb3J0IHRyZWVfYWRkLCB7YWRkQWxsIGFzIHRyZWVfYWRkQWxsfSBmcm9tIFwiLi9hZGQuanNcIjtcbmltcG9ydCB0cmVlX2NvdmVyIGZyb20gXCIuL2NvdmVyLmpzXCI7XG5pbXBvcnQgdHJlZV9kYXRhIGZyb20gXCIuL2RhdGEuanNcIjtcbmltcG9ydCB0cmVlX2V4dGVudCBmcm9tIFwiLi9leHRlbnQuanNcIjtcbmltcG9ydCB0cmVlX2ZpbmQgZnJvbSBcIi4vZmluZC5qc1wiO1xuaW1wb3J0IHRyZWVfcmVtb3ZlLCB7cmVtb3ZlQWxsIGFzIHRyZWVfcmVtb3ZlQWxsfSBmcm9tIFwiLi9yZW1vdmUuanNcIjtcbmltcG9ydCB0cmVlX3Jvb3QgZnJvbSBcIi4vcm9vdC5qc1wiO1xuaW1wb3J0IHRyZWVfc2l6ZSBmcm9tIFwiLi9zaXplLmpzXCI7XG5pbXBvcnQgdHJlZV92aXNpdCBmcm9tIFwiLi92aXNpdC5qc1wiO1xuaW1wb3J0IHRyZWVfdmlzaXRBZnRlciBmcm9tIFwiLi92aXNpdEFmdGVyLmpzXCI7XG5pbXBvcnQgdHJlZV94LCB7ZGVmYXVsdFh9IGZyb20gXCIuL3guanNcIjtcbmltcG9ydCB0cmVlX3ksIHtkZWZhdWx0WX0gZnJvbSBcIi4veS5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBxdWFkdHJlZShub2RlcywgeCwgeSkge1xuICB2YXIgdHJlZSA9IG5ldyBRdWFkdHJlZSh4ID09IG51bGwgPyBkZWZhdWx0WCA6IHgsIHkgPT0gbnVsbCA/IGRlZmF1bHRZIDogeSwgTmFOLCBOYU4sIE5hTiwgTmFOKTtcbiAgcmV0dXJuIG5vZGVzID09IG51bGwgPyB0cmVlIDogdHJlZS5hZGRBbGwobm9kZXMpO1xufVxuXG5mdW5jdGlvbiBRdWFkdHJlZSh4LCB5LCB4MCwgeTAsIHgxLCB5MSkge1xuICB0aGlzLl94ID0geDtcbiAgdGhpcy5feSA9IHk7XG4gIHRoaXMuX3gwID0geDA7XG4gIHRoaXMuX3kwID0geTA7XG4gIHRoaXMuX3gxID0geDE7XG4gIHRoaXMuX3kxID0geTE7XG4gIHRoaXMuX3Jvb3QgPSB1bmRlZmluZWQ7XG59XG5cbmZ1bmN0aW9uIGxlYWZfY29weShsZWFmKSB7XG4gIHZhciBjb3B5ID0ge2RhdGE6IGxlYWYuZGF0YX0sIG5leHQgPSBjb3B5O1xuICB3aGlsZSAobGVhZiA9IGxlYWYubmV4dCkgbmV4dCA9IG5leHQubmV4dCA9IHtkYXRhOiBsZWFmLmRhdGF9O1xuICByZXR1cm4gY29weTtcbn1cblxudmFyIHRyZWVQcm90byA9IHF1YWR0cmVlLnByb3RvdHlwZSA9IFF1YWR0cmVlLnByb3RvdHlwZTtcblxudHJlZVByb3RvLmNvcHkgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGNvcHkgPSBuZXcgUXVhZHRyZWUodGhpcy5feCwgdGhpcy5feSwgdGhpcy5feDAsIHRoaXMuX3kwLCB0aGlzLl94MSwgdGhpcy5feTEpLFxuICAgICAgbm9kZSA9IHRoaXMuX3Jvb3QsXG4gICAgICBub2RlcyxcbiAgICAgIGNoaWxkO1xuXG4gIGlmICghbm9kZSkgcmV0dXJuIGNvcHk7XG5cbiAgaWYgKCFub2RlLmxlbmd0aCkgcmV0dXJuIGNvcHkuX3Jvb3QgPSBsZWFmX2NvcHkobm9kZSksIGNvcHk7XG5cbiAgbm9kZXMgPSBbe3NvdXJjZTogbm9kZSwgdGFyZ2V0OiBjb3B5Ll9yb290ID0gbmV3IEFycmF5KDQpfV07XG4gIHdoaWxlIChub2RlID0gbm9kZXMucG9wKCkpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IDQ7ICsraSkge1xuICAgICAgaWYgKGNoaWxkID0gbm9kZS5zb3VyY2VbaV0pIHtcbiAgICAgICAgaWYgKGNoaWxkLmxlbmd0aCkgbm9kZXMucHVzaCh7c291cmNlOiBjaGlsZCwgdGFyZ2V0OiBub2RlLnRhcmdldFtpXSA9IG5ldyBBcnJheSg0KX0pO1xuICAgICAgICBlbHNlIG5vZGUudGFyZ2V0W2ldID0gbGVhZl9jb3B5KGNoaWxkKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gY29weTtcbn07XG5cbnRyZWVQcm90by5hZGQgPSB0cmVlX2FkZDtcbnRyZWVQcm90by5hZGRBbGwgPSB0cmVlX2FkZEFsbDtcbnRyZWVQcm90by5jb3ZlciA9IHRyZWVfY292ZXI7XG50cmVlUHJvdG8uZGF0YSA9IHRyZWVfZGF0YTtcbnRyZWVQcm90by5leHRlbnQgPSB0cmVlX2V4dGVudDtcbnRyZWVQcm90by5maW5kID0gdHJlZV9maW5kO1xudHJlZVByb3RvLnJlbW92ZSA9IHRyZWVfcmVtb3ZlO1xudHJlZVByb3RvLnJlbW92ZUFsbCA9IHRyZWVfcmVtb3ZlQWxsO1xudHJlZVByb3RvLnJvb3QgPSB0cmVlX3Jvb3Q7XG50cmVlUHJvdG8uc2l6ZSA9IHRyZWVfc2l6ZTtcbnRyZWVQcm90by52aXNpdCA9IHRyZWVfdmlzaXQ7XG50cmVlUHJvdG8udmlzaXRBZnRlciA9IHRyZWVfdmlzaXRBZnRlcjtcbnRyZWVQcm90by54ID0gdHJlZV94O1xudHJlZVByb3RvLnkgPSB0cmVlX3k7XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oeCkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHg7XG4gIH07XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24ocmFuZG9tKSB7XG4gIHJldHVybiAocmFuZG9tKCkgLSAwLjUpICogMWUtNjtcbn1cbiIsICJpbXBvcnQge3F1YWR0cmVlfSBmcm9tIFwiZDMtcXVhZHRyZWVcIjtcbmltcG9ydCBjb25zdGFudCBmcm9tIFwiLi9jb25zdGFudC5qc1wiO1xuaW1wb3J0IGppZ2dsZSBmcm9tIFwiLi9qaWdnbGUuanNcIjtcblxuZnVuY3Rpb24geChkKSB7XG4gIHJldHVybiBkLnggKyBkLnZ4O1xufVxuXG5mdW5jdGlvbiB5KGQpIHtcbiAgcmV0dXJuIGQueSArIGQudnk7XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHJhZGl1cykge1xuICB2YXIgbm9kZXMsXG4gICAgICByYWRpaSxcbiAgICAgIHJhbmRvbSxcbiAgICAgIHN0cmVuZ3RoID0gMSxcbiAgICAgIGl0ZXJhdGlvbnMgPSAxO1xuXG4gIGlmICh0eXBlb2YgcmFkaXVzICE9PSBcImZ1bmN0aW9uXCIpIHJhZGl1cyA9IGNvbnN0YW50KHJhZGl1cyA9PSBudWxsID8gMSA6ICtyYWRpdXMpO1xuXG4gIGZ1bmN0aW9uIGZvcmNlKCkge1xuICAgIHZhciBpLCBuID0gbm9kZXMubGVuZ3RoLFxuICAgICAgICB0cmVlLFxuICAgICAgICBub2RlLFxuICAgICAgICB4aSxcbiAgICAgICAgeWksXG4gICAgICAgIHJpLFxuICAgICAgICByaTI7XG5cbiAgICBmb3IgKHZhciBrID0gMDsgayA8IGl0ZXJhdGlvbnM7ICsraykge1xuICAgICAgdHJlZSA9IHF1YWR0cmVlKG5vZGVzLCB4LCB5KS52aXNpdEFmdGVyKHByZXBhcmUpO1xuICAgICAgZm9yIChpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgICBub2RlID0gbm9kZXNbaV07XG4gICAgICAgIHJpID0gcmFkaWlbbm9kZS5pbmRleF0sIHJpMiA9IHJpICogcmk7XG4gICAgICAgIHhpID0gbm9kZS54ICsgbm9kZS52eDtcbiAgICAgICAgeWkgPSBub2RlLnkgKyBub2RlLnZ5O1xuICAgICAgICB0cmVlLnZpc2l0KGFwcGx5KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiBhcHBseShxdWFkLCB4MCwgeTAsIHgxLCB5MSkge1xuICAgICAgdmFyIGRhdGEgPSBxdWFkLmRhdGEsIHJqID0gcXVhZC5yLCByID0gcmkgKyByajtcbiAgICAgIGlmIChkYXRhKSB7XG4gICAgICAgIGlmIChkYXRhLmluZGV4ID4gbm9kZS5pbmRleCkge1xuICAgICAgICAgIHZhciB4ID0geGkgLSBkYXRhLnggLSBkYXRhLnZ4LFxuICAgICAgICAgICAgICB5ID0geWkgLSBkYXRhLnkgLSBkYXRhLnZ5LFxuICAgICAgICAgICAgICBsID0geCAqIHggKyB5ICogeTtcbiAgICAgICAgICBpZiAobCA8IHIgKiByKSB7XG4gICAgICAgICAgICBpZiAoeCA9PT0gMCkgeCA9IGppZ2dsZShyYW5kb20pLCBsICs9IHggKiB4O1xuICAgICAgICAgICAgaWYgKHkgPT09IDApIHkgPSBqaWdnbGUocmFuZG9tKSwgbCArPSB5ICogeTtcbiAgICAgICAgICAgIGwgPSAociAtIChsID0gTWF0aC5zcXJ0KGwpKSkgLyBsICogc3RyZW5ndGg7XG4gICAgICAgICAgICBub2RlLnZ4ICs9ICh4ICo9IGwpICogKHIgPSAocmogKj0gcmopIC8gKHJpMiArIHJqKSk7XG4gICAgICAgICAgICBub2RlLnZ5ICs9ICh5ICo9IGwpICogcjtcbiAgICAgICAgICAgIGRhdGEudnggLT0geCAqIChyID0gMSAtIHIpO1xuICAgICAgICAgICAgZGF0YS52eSAtPSB5ICogcjtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHgwID4geGkgKyByIHx8IHgxIDwgeGkgLSByIHx8IHkwID4geWkgKyByIHx8IHkxIDwgeWkgLSByO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHByZXBhcmUocXVhZCkge1xuICAgIGlmIChxdWFkLmRhdGEpIHJldHVybiBxdWFkLnIgPSByYWRpaVtxdWFkLmRhdGEuaW5kZXhdO1xuICAgIGZvciAodmFyIGkgPSBxdWFkLnIgPSAwOyBpIDwgNDsgKytpKSB7XG4gICAgICBpZiAocXVhZFtpXSAmJiBxdWFkW2ldLnIgPiBxdWFkLnIpIHtcbiAgICAgICAgcXVhZC5yID0gcXVhZFtpXS5yO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGluaXRpYWxpemUoKSB7XG4gICAgaWYgKCFub2RlcykgcmV0dXJuO1xuICAgIHZhciBpLCBuID0gbm9kZXMubGVuZ3RoLCBub2RlO1xuICAgIHJhZGlpID0gbmV3IEFycmF5KG4pO1xuICAgIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIG5vZGUgPSBub2Rlc1tpXSwgcmFkaWlbbm9kZS5pbmRleF0gPSArcmFkaXVzKG5vZGUsIGksIG5vZGVzKTtcbiAgfVxuXG4gIGZvcmNlLmluaXRpYWxpemUgPSBmdW5jdGlvbihfbm9kZXMsIF9yYW5kb20pIHtcbiAgICBub2RlcyA9IF9ub2RlcztcbiAgICByYW5kb20gPSBfcmFuZG9tO1xuICAgIGluaXRpYWxpemUoKTtcbiAgfTtcblxuICBmb3JjZS5pdGVyYXRpb25zID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGl0ZXJhdGlvbnMgPSArXywgZm9yY2UpIDogaXRlcmF0aW9ucztcbiAgfTtcblxuICBmb3JjZS5zdHJlbmd0aCA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChzdHJlbmd0aCA9ICtfLCBmb3JjZSkgOiBzdHJlbmd0aDtcbiAgfTtcblxuICBmb3JjZS5yYWRpdXMgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAocmFkaXVzID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudCgrXyksIGluaXRpYWxpemUoKSwgZm9yY2UpIDogcmFkaXVzO1xuICB9O1xuXG4gIHJldHVybiBmb3JjZTtcbn1cbiIsICJpbXBvcnQgY29uc3RhbnQgZnJvbSBcIi4vY29uc3RhbnQuanNcIjtcbmltcG9ydCBqaWdnbGUgZnJvbSBcIi4vamlnZ2xlLmpzXCI7XG5cbmZ1bmN0aW9uIGluZGV4KGQpIHtcbiAgcmV0dXJuIGQuaW5kZXg7XG59XG5cbmZ1bmN0aW9uIGZpbmQobm9kZUJ5SWQsIG5vZGVJZCkge1xuICB2YXIgbm9kZSA9IG5vZGVCeUlkLmdldChub2RlSWQpO1xuICBpZiAoIW5vZGUpIHRocm93IG5ldyBFcnJvcihcIm5vZGUgbm90IGZvdW5kOiBcIiArIG5vZGVJZCk7XG4gIHJldHVybiBub2RlO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihsaW5rcykge1xuICB2YXIgaWQgPSBpbmRleCxcbiAgICAgIHN0cmVuZ3RoID0gZGVmYXVsdFN0cmVuZ3RoLFxuICAgICAgc3RyZW5ndGhzLFxuICAgICAgZGlzdGFuY2UgPSBjb25zdGFudCgzMCksXG4gICAgICBkaXN0YW5jZXMsXG4gICAgICBub2RlcyxcbiAgICAgIGNvdW50LFxuICAgICAgYmlhcyxcbiAgICAgIHJhbmRvbSxcbiAgICAgIGl0ZXJhdGlvbnMgPSAxO1xuXG4gIGlmIChsaW5rcyA9PSBudWxsKSBsaW5rcyA9IFtdO1xuXG4gIGZ1bmN0aW9uIGRlZmF1bHRTdHJlbmd0aChsaW5rKSB7XG4gICAgcmV0dXJuIDEgLyBNYXRoLm1pbihjb3VudFtsaW5rLnNvdXJjZS5pbmRleF0sIGNvdW50W2xpbmsudGFyZ2V0LmluZGV4XSk7XG4gIH1cblxuICBmdW5jdGlvbiBmb3JjZShhbHBoYSkge1xuICAgIGZvciAodmFyIGsgPSAwLCBuID0gbGlua3MubGVuZ3RoOyBrIDwgaXRlcmF0aW9uczsgKytrKSB7XG4gICAgICBmb3IgKHZhciBpID0gMCwgbGluaywgc291cmNlLCB0YXJnZXQsIHgsIHksIGwsIGI7IGkgPCBuOyArK2kpIHtcbiAgICAgICAgbGluayA9IGxpbmtzW2ldLCBzb3VyY2UgPSBsaW5rLnNvdXJjZSwgdGFyZ2V0ID0gbGluay50YXJnZXQ7XG4gICAgICAgIHggPSB0YXJnZXQueCArIHRhcmdldC52eCAtIHNvdXJjZS54IC0gc291cmNlLnZ4IHx8IGppZ2dsZShyYW5kb20pO1xuICAgICAgICB5ID0gdGFyZ2V0LnkgKyB0YXJnZXQudnkgLSBzb3VyY2UueSAtIHNvdXJjZS52eSB8fCBqaWdnbGUocmFuZG9tKTtcbiAgICAgICAgbCA9IE1hdGguc3FydCh4ICogeCArIHkgKiB5KTtcbiAgICAgICAgbCA9IChsIC0gZGlzdGFuY2VzW2ldKSAvIGwgKiBhbHBoYSAqIHN0cmVuZ3Roc1tpXTtcbiAgICAgICAgeCAqPSBsLCB5ICo9IGw7XG4gICAgICAgIHRhcmdldC52eCAtPSB4ICogKGIgPSBiaWFzW2ldKTtcbiAgICAgICAgdGFyZ2V0LnZ5IC09IHkgKiBiO1xuICAgICAgICBzb3VyY2UudnggKz0geCAqIChiID0gMSAtIGIpO1xuICAgICAgICBzb3VyY2UudnkgKz0geSAqIGI7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gaW5pdGlhbGl6ZSgpIHtcbiAgICBpZiAoIW5vZGVzKSByZXR1cm47XG5cbiAgICB2YXIgaSxcbiAgICAgICAgbiA9IG5vZGVzLmxlbmd0aCxcbiAgICAgICAgbSA9IGxpbmtzLmxlbmd0aCxcbiAgICAgICAgbm9kZUJ5SWQgPSBuZXcgTWFwKG5vZGVzLm1hcCgoZCwgaSkgPT4gW2lkKGQsIGksIG5vZGVzKSwgZF0pKSxcbiAgICAgICAgbGluaztcblxuICAgIGZvciAoaSA9IDAsIGNvdW50ID0gbmV3IEFycmF5KG4pOyBpIDwgbTsgKytpKSB7XG4gICAgICBsaW5rID0gbGlua3NbaV0sIGxpbmsuaW5kZXggPSBpO1xuICAgICAgaWYgKHR5cGVvZiBsaW5rLnNvdXJjZSAhPT0gXCJvYmplY3RcIikgbGluay5zb3VyY2UgPSBmaW5kKG5vZGVCeUlkLCBsaW5rLnNvdXJjZSk7XG4gICAgICBpZiAodHlwZW9mIGxpbmsudGFyZ2V0ICE9PSBcIm9iamVjdFwiKSBsaW5rLnRhcmdldCA9IGZpbmQobm9kZUJ5SWQsIGxpbmsudGFyZ2V0KTtcbiAgICAgIGNvdW50W2xpbmsuc291cmNlLmluZGV4XSA9IChjb3VudFtsaW5rLnNvdXJjZS5pbmRleF0gfHwgMCkgKyAxO1xuICAgICAgY291bnRbbGluay50YXJnZXQuaW5kZXhdID0gKGNvdW50W2xpbmsudGFyZ2V0LmluZGV4XSB8fCAwKSArIDE7XG4gICAgfVxuXG4gICAgZm9yIChpID0gMCwgYmlhcyA9IG5ldyBBcnJheShtKTsgaSA8IG07ICsraSkge1xuICAgICAgbGluayA9IGxpbmtzW2ldLCBiaWFzW2ldID0gY291bnRbbGluay5zb3VyY2UuaW5kZXhdIC8gKGNvdW50W2xpbmsuc291cmNlLmluZGV4XSArIGNvdW50W2xpbmsudGFyZ2V0LmluZGV4XSk7XG4gICAgfVxuXG4gICAgc3RyZW5ndGhzID0gbmV3IEFycmF5KG0pLCBpbml0aWFsaXplU3RyZW5ndGgoKTtcbiAgICBkaXN0YW5jZXMgPSBuZXcgQXJyYXkobSksIGluaXRpYWxpemVEaXN0YW5jZSgpO1xuICB9XG5cbiAgZnVuY3Rpb24gaW5pdGlhbGl6ZVN0cmVuZ3RoKCkge1xuICAgIGlmICghbm9kZXMpIHJldHVybjtcblxuICAgIGZvciAodmFyIGkgPSAwLCBuID0gbGlua3MubGVuZ3RoOyBpIDwgbjsgKytpKSB7XG4gICAgICBzdHJlbmd0aHNbaV0gPSArc3RyZW5ndGgobGlua3NbaV0sIGksIGxpbmtzKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBpbml0aWFsaXplRGlzdGFuY2UoKSB7XG4gICAgaWYgKCFub2RlcykgcmV0dXJuO1xuXG4gICAgZm9yICh2YXIgaSA9IDAsIG4gPSBsaW5rcy5sZW5ndGg7IGkgPCBuOyArK2kpIHtcbiAgICAgIGRpc3RhbmNlc1tpXSA9ICtkaXN0YW5jZShsaW5rc1tpXSwgaSwgbGlua3MpO1xuICAgIH1cbiAgfVxuXG4gIGZvcmNlLmluaXRpYWxpemUgPSBmdW5jdGlvbihfbm9kZXMsIF9yYW5kb20pIHtcbiAgICBub2RlcyA9IF9ub2RlcztcbiAgICByYW5kb20gPSBfcmFuZG9tO1xuICAgIGluaXRpYWxpemUoKTtcbiAgfTtcblxuICBmb3JjZS5saW5rcyA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChsaW5rcyA9IF8sIGluaXRpYWxpemUoKSwgZm9yY2UpIDogbGlua3M7XG4gIH07XG5cbiAgZm9yY2UuaWQgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoaWQgPSBfLCBmb3JjZSkgOiBpZDtcbiAgfTtcblxuICBmb3JjZS5pdGVyYXRpb25zID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGl0ZXJhdGlvbnMgPSArXywgZm9yY2UpIDogaXRlcmF0aW9ucztcbiAgfTtcblxuICBmb3JjZS5zdHJlbmd0aCA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChzdHJlbmd0aCA9IHR5cGVvZiBfID09PSBcImZ1bmN0aW9uXCIgPyBfIDogY29uc3RhbnQoK18pLCBpbml0aWFsaXplU3RyZW5ndGgoKSwgZm9yY2UpIDogc3RyZW5ndGg7XG4gIH07XG5cbiAgZm9yY2UuZGlzdGFuY2UgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoZGlzdGFuY2UgPSB0eXBlb2YgXyA9PT0gXCJmdW5jdGlvblwiID8gXyA6IGNvbnN0YW50KCtfKSwgaW5pdGlhbGl6ZURpc3RhbmNlKCksIGZvcmNlKSA6IGRpc3RhbmNlO1xuICB9O1xuXG4gIHJldHVybiBmb3JjZTtcbn1cbiIsICIvLyBodHRwczovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9MaW5lYXJfY29uZ3J1ZW50aWFsX2dlbmVyYXRvciNQYXJhbWV0ZXJzX2luX2NvbW1vbl91c2VcbmNvbnN0IGEgPSAxNjY0NTI1O1xuY29uc3QgYyA9IDEwMTM5MDQyMjM7XG5jb25zdCBtID0gNDI5NDk2NzI5NjsgLy8gMl4zMlxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgbGV0IHMgPSAxO1xuICByZXR1cm4gKCkgPT4gKHMgPSAoYSAqIHMgKyBjKSAlIG0pIC8gbTtcbn1cbiIsICJpbXBvcnQge2Rpc3BhdGNofSBmcm9tIFwiZDMtZGlzcGF0Y2hcIjtcbmltcG9ydCB7dGltZXJ9IGZyb20gXCJkMy10aW1lclwiO1xuaW1wb3J0IGxjZyBmcm9tIFwiLi9sY2cuanNcIjtcblxuZXhwb3J0IGZ1bmN0aW9uIHgoZCkge1xuICByZXR1cm4gZC54O1xufVxuXG5leHBvcnQgZnVuY3Rpb24geShkKSB7XG4gIHJldHVybiBkLnk7XG59XG5cbnZhciBpbml0aWFsUmFkaXVzID0gMTAsXG4gICAgaW5pdGlhbEFuZ2xlID0gTWF0aC5QSSAqICgzIC0gTWF0aC5zcXJ0KDUpKTtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obm9kZXMpIHtcbiAgdmFyIHNpbXVsYXRpb24sXG4gICAgICBhbHBoYSA9IDEsXG4gICAgICBhbHBoYU1pbiA9IDAuMDAxLFxuICAgICAgYWxwaGFEZWNheSA9IDEgLSBNYXRoLnBvdyhhbHBoYU1pbiwgMSAvIDMwMCksXG4gICAgICBhbHBoYVRhcmdldCA9IDAsXG4gICAgICB2ZWxvY2l0eURlY2F5ID0gMC42LFxuICAgICAgZm9yY2VzID0gbmV3IE1hcCgpLFxuICAgICAgc3RlcHBlciA9IHRpbWVyKHN0ZXApLFxuICAgICAgZXZlbnQgPSBkaXNwYXRjaChcInRpY2tcIiwgXCJlbmRcIiksXG4gICAgICByYW5kb20gPSBsY2coKTtcblxuICBpZiAobm9kZXMgPT0gbnVsbCkgbm9kZXMgPSBbXTtcblxuICBmdW5jdGlvbiBzdGVwKCkge1xuICAgIHRpY2soKTtcbiAgICBldmVudC5jYWxsKFwidGlja1wiLCBzaW11bGF0aW9uKTtcbiAgICBpZiAoYWxwaGEgPCBhbHBoYU1pbikge1xuICAgICAgc3RlcHBlci5zdG9wKCk7XG4gICAgICBldmVudC5jYWxsKFwiZW5kXCIsIHNpbXVsYXRpb24pO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHRpY2soaXRlcmF0aW9ucykge1xuICAgIHZhciBpLCBuID0gbm9kZXMubGVuZ3RoLCBub2RlO1xuXG4gICAgaWYgKGl0ZXJhdGlvbnMgPT09IHVuZGVmaW5lZCkgaXRlcmF0aW9ucyA9IDE7XG5cbiAgICBmb3IgKHZhciBrID0gMDsgayA8IGl0ZXJhdGlvbnM7ICsraykge1xuICAgICAgYWxwaGEgKz0gKGFscGhhVGFyZ2V0IC0gYWxwaGEpICogYWxwaGFEZWNheTtcblxuICAgICAgZm9yY2VzLmZvckVhY2goZnVuY3Rpb24oZm9yY2UpIHtcbiAgICAgICAgZm9yY2UoYWxwaGEpO1xuICAgICAgfSk7XG5cbiAgICAgIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgICAgbm9kZSA9IG5vZGVzW2ldO1xuICAgICAgICBpZiAobm9kZS5meCA9PSBudWxsKSBub2RlLnggKz0gbm9kZS52eCAqPSB2ZWxvY2l0eURlY2F5O1xuICAgICAgICBlbHNlIG5vZGUueCA9IG5vZGUuZngsIG5vZGUudnggPSAwO1xuICAgICAgICBpZiAobm9kZS5meSA9PSBudWxsKSBub2RlLnkgKz0gbm9kZS52eSAqPSB2ZWxvY2l0eURlY2F5O1xuICAgICAgICBlbHNlIG5vZGUueSA9IG5vZGUuZnksIG5vZGUudnkgPSAwO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBzaW11bGF0aW9uO1xuICB9XG5cbiAgZnVuY3Rpb24gaW5pdGlhbGl6ZU5vZGVzKCkge1xuICAgIGZvciAodmFyIGkgPSAwLCBuID0gbm9kZXMubGVuZ3RoLCBub2RlOyBpIDwgbjsgKytpKSB7XG4gICAgICBub2RlID0gbm9kZXNbaV0sIG5vZGUuaW5kZXggPSBpO1xuICAgICAgaWYgKG5vZGUuZnggIT0gbnVsbCkgbm9kZS54ID0gbm9kZS5meDtcbiAgICAgIGlmIChub2RlLmZ5ICE9IG51bGwpIG5vZGUueSA9IG5vZGUuZnk7XG4gICAgICBpZiAoaXNOYU4obm9kZS54KSB8fCBpc05hTihub2RlLnkpKSB7XG4gICAgICAgIHZhciByYWRpdXMgPSBpbml0aWFsUmFkaXVzICogTWF0aC5zcXJ0KDAuNSArIGkpLCBhbmdsZSA9IGkgKiBpbml0aWFsQW5nbGU7XG4gICAgICAgIG5vZGUueCA9IHJhZGl1cyAqIE1hdGguY29zKGFuZ2xlKTtcbiAgICAgICAgbm9kZS55ID0gcmFkaXVzICogTWF0aC5zaW4oYW5nbGUpO1xuICAgICAgfVxuICAgICAgaWYgKGlzTmFOKG5vZGUudngpIHx8IGlzTmFOKG5vZGUudnkpKSB7XG4gICAgICAgIG5vZGUudnggPSBub2RlLnZ5ID0gMDtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBpbml0aWFsaXplRm9yY2UoZm9yY2UpIHtcbiAgICBpZiAoZm9yY2UuaW5pdGlhbGl6ZSkgZm9yY2UuaW5pdGlhbGl6ZShub2RlcywgcmFuZG9tKTtcbiAgICByZXR1cm4gZm9yY2U7XG4gIH1cblxuICBpbml0aWFsaXplTm9kZXMoKTtcblxuICByZXR1cm4gc2ltdWxhdGlvbiA9IHtcbiAgICB0aWNrOiB0aWNrLFxuXG4gICAgcmVzdGFydDogZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gc3RlcHBlci5yZXN0YXJ0KHN0ZXApLCBzaW11bGF0aW9uO1xuICAgIH0sXG5cbiAgICBzdG9wOiBmdW5jdGlvbigpIHtcbiAgICAgIHJldHVybiBzdGVwcGVyLnN0b3AoKSwgc2ltdWxhdGlvbjtcbiAgICB9LFxuXG4gICAgbm9kZXM6IGZ1bmN0aW9uKF8pIHtcbiAgICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKG5vZGVzID0gXywgaW5pdGlhbGl6ZU5vZGVzKCksIGZvcmNlcy5mb3JFYWNoKGluaXRpYWxpemVGb3JjZSksIHNpbXVsYXRpb24pIDogbm9kZXM7XG4gICAgfSxcblxuICAgIGFscGhhOiBmdW5jdGlvbihfKSB7XG4gICAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChhbHBoYSA9ICtfLCBzaW11bGF0aW9uKSA6IGFscGhhO1xuICAgIH0sXG5cbiAgICBhbHBoYU1pbjogZnVuY3Rpb24oXykge1xuICAgICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoYWxwaGFNaW4gPSArXywgc2ltdWxhdGlvbikgOiBhbHBoYU1pbjtcbiAgICB9LFxuXG4gICAgYWxwaGFEZWNheTogZnVuY3Rpb24oXykge1xuICAgICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoYWxwaGFEZWNheSA9ICtfLCBzaW11bGF0aW9uKSA6ICthbHBoYURlY2F5O1xuICAgIH0sXG5cbiAgICBhbHBoYVRhcmdldDogZnVuY3Rpb24oXykge1xuICAgICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoYWxwaGFUYXJnZXQgPSArXywgc2ltdWxhdGlvbikgOiBhbHBoYVRhcmdldDtcbiAgICB9LFxuXG4gICAgdmVsb2NpdHlEZWNheTogZnVuY3Rpb24oXykge1xuICAgICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAodmVsb2NpdHlEZWNheSA9IDEgLSBfLCBzaW11bGF0aW9uKSA6IDEgLSB2ZWxvY2l0eURlY2F5O1xuICAgIH0sXG5cbiAgICByYW5kb21Tb3VyY2U6IGZ1bmN0aW9uKF8pIHtcbiAgICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHJhbmRvbSA9IF8sIGZvcmNlcy5mb3JFYWNoKGluaXRpYWxpemVGb3JjZSksIHNpbXVsYXRpb24pIDogcmFuZG9tO1xuICAgIH0sXG5cbiAgICBmb3JjZTogZnVuY3Rpb24obmFtZSwgXykge1xuICAgICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPiAxID8gKChfID09IG51bGwgPyBmb3JjZXMuZGVsZXRlKG5hbWUpIDogZm9yY2VzLnNldChuYW1lLCBpbml0aWFsaXplRm9yY2UoXykpKSwgc2ltdWxhdGlvbikgOiBmb3JjZXMuZ2V0KG5hbWUpO1xuICAgIH0sXG5cbiAgICBmaW5kOiBmdW5jdGlvbih4LCB5LCByYWRpdXMpIHtcbiAgICAgIHZhciBpID0gMCxcbiAgICAgICAgICBuID0gbm9kZXMubGVuZ3RoLFxuICAgICAgICAgIGR4LFxuICAgICAgICAgIGR5LFxuICAgICAgICAgIGQyLFxuICAgICAgICAgIG5vZGUsXG4gICAgICAgICAgY2xvc2VzdDtcblxuICAgICAgaWYgKHJhZGl1cyA9PSBudWxsKSByYWRpdXMgPSBJbmZpbml0eTtcbiAgICAgIGVsc2UgcmFkaXVzICo9IHJhZGl1cztcblxuICAgICAgZm9yIChpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgICBub2RlID0gbm9kZXNbaV07XG4gICAgICAgIGR4ID0geCAtIG5vZGUueDtcbiAgICAgICAgZHkgPSB5IC0gbm9kZS55O1xuICAgICAgICBkMiA9IGR4ICogZHggKyBkeSAqIGR5O1xuICAgICAgICBpZiAoZDIgPCByYWRpdXMpIGNsb3Nlc3QgPSBub2RlLCByYWRpdXMgPSBkMjtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGNsb3Nlc3Q7XG4gICAgfSxcblxuICAgIG9uOiBmdW5jdGlvbihuYW1lLCBfKSB7XG4gICAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA+IDEgPyAoZXZlbnQub24obmFtZSwgXyksIHNpbXVsYXRpb24pIDogZXZlbnQub24obmFtZSk7XG4gICAgfVxuICB9O1xufVxuIiwgImltcG9ydCB7cXVhZHRyZWV9IGZyb20gXCJkMy1xdWFkdHJlZVwiO1xuaW1wb3J0IGNvbnN0YW50IGZyb20gXCIuL2NvbnN0YW50LmpzXCI7XG5pbXBvcnQgamlnZ2xlIGZyb20gXCIuL2ppZ2dsZS5qc1wiO1xuaW1wb3J0IHt4LCB5fSBmcm9tIFwiLi9zaW11bGF0aW9uLmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKCkge1xuICB2YXIgbm9kZXMsXG4gICAgICBub2RlLFxuICAgICAgcmFuZG9tLFxuICAgICAgYWxwaGEsXG4gICAgICBzdHJlbmd0aCA9IGNvbnN0YW50KC0zMCksXG4gICAgICBzdHJlbmd0aHMsXG4gICAgICBkaXN0YW5jZU1pbjIgPSAxLFxuICAgICAgZGlzdGFuY2VNYXgyID0gSW5maW5pdHksXG4gICAgICB0aGV0YTIgPSAwLjgxO1xuXG4gIGZ1bmN0aW9uIGZvcmNlKF8pIHtcbiAgICB2YXIgaSwgbiA9IG5vZGVzLmxlbmd0aCwgdHJlZSA9IHF1YWR0cmVlKG5vZGVzLCB4LCB5KS52aXNpdEFmdGVyKGFjY3VtdWxhdGUpO1xuICAgIGZvciAoYWxwaGEgPSBfLCBpID0gMDsgaSA8IG47ICsraSkgbm9kZSA9IG5vZGVzW2ldLCB0cmVlLnZpc2l0KGFwcGx5KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGluaXRpYWxpemUoKSB7XG4gICAgaWYgKCFub2RlcykgcmV0dXJuO1xuICAgIHZhciBpLCBuID0gbm9kZXMubGVuZ3RoLCBub2RlO1xuICAgIHN0cmVuZ3RocyA9IG5ldyBBcnJheShuKTtcbiAgICBmb3IgKGkgPSAwOyBpIDwgbjsgKytpKSBub2RlID0gbm9kZXNbaV0sIHN0cmVuZ3Roc1tub2RlLmluZGV4XSA9ICtzdHJlbmd0aChub2RlLCBpLCBub2Rlcyk7XG4gIH1cblxuICBmdW5jdGlvbiBhY2N1bXVsYXRlKHF1YWQpIHtcbiAgICB2YXIgc3RyZW5ndGggPSAwLCBxLCBjLCB3ZWlnaHQgPSAwLCB4LCB5LCBpO1xuXG4gICAgLy8gRm9yIGludGVybmFsIG5vZGVzLCBhY2N1bXVsYXRlIGZvcmNlcyBmcm9tIGNoaWxkIHF1YWRyYW50cy5cbiAgICBpZiAocXVhZC5sZW5ndGgpIHtcbiAgICAgIGZvciAoeCA9IHkgPSBpID0gMDsgaSA8IDQ7ICsraSkge1xuICAgICAgICBpZiAoKHEgPSBxdWFkW2ldKSAmJiAoYyA9IE1hdGguYWJzKHEudmFsdWUpKSkge1xuICAgICAgICAgIHN0cmVuZ3RoICs9IHEudmFsdWUsIHdlaWdodCArPSBjLCB4ICs9IGMgKiBxLngsIHkgKz0gYyAqIHEueTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcXVhZC54ID0geCAvIHdlaWdodDtcbiAgICAgIHF1YWQueSA9IHkgLyB3ZWlnaHQ7XG4gICAgfVxuXG4gICAgLy8gRm9yIGxlYWYgbm9kZXMsIGFjY3VtdWxhdGUgZm9yY2VzIGZyb20gY29pbmNpZGVudCBxdWFkcmFudHMuXG4gICAgZWxzZSB7XG4gICAgICBxID0gcXVhZDtcbiAgICAgIHEueCA9IHEuZGF0YS54O1xuICAgICAgcS55ID0gcS5kYXRhLnk7XG4gICAgICBkbyBzdHJlbmd0aCArPSBzdHJlbmd0aHNbcS5kYXRhLmluZGV4XTtcbiAgICAgIHdoaWxlIChxID0gcS5uZXh0KTtcbiAgICB9XG5cbiAgICBxdWFkLnZhbHVlID0gc3RyZW5ndGg7XG4gIH1cblxuICBmdW5jdGlvbiBhcHBseShxdWFkLCB4MSwgXywgeDIpIHtcbiAgICBpZiAoIXF1YWQudmFsdWUpIHJldHVybiB0cnVlO1xuXG4gICAgdmFyIHggPSBxdWFkLnggLSBub2RlLngsXG4gICAgICAgIHkgPSBxdWFkLnkgLSBub2RlLnksXG4gICAgICAgIHcgPSB4MiAtIHgxLFxuICAgICAgICBsID0geCAqIHggKyB5ICogeTtcblxuICAgIC8vIEFwcGx5IHRoZSBCYXJuZXMtSHV0IGFwcHJveGltYXRpb24gaWYgcG9zc2libGUuXG4gICAgLy8gTGltaXQgZm9yY2VzIGZvciB2ZXJ5IGNsb3NlIG5vZGVzOyByYW5kb21pemUgZGlyZWN0aW9uIGlmIGNvaW5jaWRlbnQuXG4gICAgaWYgKHcgKiB3IC8gdGhldGEyIDwgbCkge1xuICAgICAgaWYgKGwgPCBkaXN0YW5jZU1heDIpIHtcbiAgICAgICAgaWYgKHggPT09IDApIHggPSBqaWdnbGUocmFuZG9tKSwgbCArPSB4ICogeDtcbiAgICAgICAgaWYgKHkgPT09IDApIHkgPSBqaWdnbGUocmFuZG9tKSwgbCArPSB5ICogeTtcbiAgICAgICAgaWYgKGwgPCBkaXN0YW5jZU1pbjIpIGwgPSBNYXRoLnNxcnQoZGlzdGFuY2VNaW4yICogbCk7XG4gICAgICAgIG5vZGUudnggKz0geCAqIHF1YWQudmFsdWUgKiBhbHBoYSAvIGw7XG4gICAgICAgIG5vZGUudnkgKz0geSAqIHF1YWQudmFsdWUgKiBhbHBoYSAvIGw7XG4gICAgICB9XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBPdGhlcndpc2UsIHByb2Nlc3MgcG9pbnRzIGRpcmVjdGx5LlxuICAgIGVsc2UgaWYgKHF1YWQubGVuZ3RoIHx8IGwgPj0gZGlzdGFuY2VNYXgyKSByZXR1cm47XG5cbiAgICAvLyBMaW1pdCBmb3JjZXMgZm9yIHZlcnkgY2xvc2Ugbm9kZXM7IHJhbmRvbWl6ZSBkaXJlY3Rpb24gaWYgY29pbmNpZGVudC5cbiAgICBpZiAocXVhZC5kYXRhICE9PSBub2RlIHx8IHF1YWQubmV4dCkge1xuICAgICAgaWYgKHggPT09IDApIHggPSBqaWdnbGUocmFuZG9tKSwgbCArPSB4ICogeDtcbiAgICAgIGlmICh5ID09PSAwKSB5ID0gamlnZ2xlKHJhbmRvbSksIGwgKz0geSAqIHk7XG4gICAgICBpZiAobCA8IGRpc3RhbmNlTWluMikgbCA9IE1hdGguc3FydChkaXN0YW5jZU1pbjIgKiBsKTtcbiAgICB9XG5cbiAgICBkbyBpZiAocXVhZC5kYXRhICE9PSBub2RlKSB7XG4gICAgICB3ID0gc3RyZW5ndGhzW3F1YWQuZGF0YS5pbmRleF0gKiBhbHBoYSAvIGw7XG4gICAgICBub2RlLnZ4ICs9IHggKiB3O1xuICAgICAgbm9kZS52eSArPSB5ICogdztcbiAgICB9IHdoaWxlIChxdWFkID0gcXVhZC5uZXh0KTtcbiAgfVxuXG4gIGZvcmNlLmluaXRpYWxpemUgPSBmdW5jdGlvbihfbm9kZXMsIF9yYW5kb20pIHtcbiAgICBub2RlcyA9IF9ub2RlcztcbiAgICByYW5kb20gPSBfcmFuZG9tO1xuICAgIGluaXRpYWxpemUoKTtcbiAgfTtcblxuICBmb3JjZS5zdHJlbmd0aCA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChzdHJlbmd0aCA9IHR5cGVvZiBfID09PSBcImZ1bmN0aW9uXCIgPyBfIDogY29uc3RhbnQoK18pLCBpbml0aWFsaXplKCksIGZvcmNlKSA6IHN0cmVuZ3RoO1xuICB9O1xuXG4gIGZvcmNlLmRpc3RhbmNlTWluID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGRpc3RhbmNlTWluMiA9IF8gKiBfLCBmb3JjZSkgOiBNYXRoLnNxcnQoZGlzdGFuY2VNaW4yKTtcbiAgfTtcblxuICBmb3JjZS5kaXN0YW5jZU1heCA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChkaXN0YW5jZU1heDIgPSBfICogXywgZm9yY2UpIDogTWF0aC5zcXJ0KGRpc3RhbmNlTWF4Mik7XG4gIH07XG5cbiAgZm9yY2UudGhldGEgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAodGhldGEyID0gXyAqIF8sIGZvcmNlKSA6IE1hdGguc3FydCh0aGV0YTIpO1xuICB9O1xuXG4gIHJldHVybiBmb3JjZTtcbn1cbiIsICJpbXBvcnQgY29uc3RhbnQgZnJvbSBcIi4vY29uc3RhbnQuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oeCkge1xuICB2YXIgc3RyZW5ndGggPSBjb25zdGFudCgwLjEpLFxuICAgICAgbm9kZXMsXG4gICAgICBzdHJlbmd0aHMsXG4gICAgICB4ejtcblxuICBpZiAodHlwZW9mIHggIT09IFwiZnVuY3Rpb25cIikgeCA9IGNvbnN0YW50KHggPT0gbnVsbCA/IDAgOiAreCk7XG5cbiAgZnVuY3Rpb24gZm9yY2UoYWxwaGEpIHtcbiAgICBmb3IgKHZhciBpID0gMCwgbiA9IG5vZGVzLmxlbmd0aCwgbm9kZTsgaSA8IG47ICsraSkge1xuICAgICAgbm9kZSA9IG5vZGVzW2ldLCBub2RlLnZ4ICs9ICh4eltpXSAtIG5vZGUueCkgKiBzdHJlbmd0aHNbaV0gKiBhbHBoYTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBpbml0aWFsaXplKCkge1xuICAgIGlmICghbm9kZXMpIHJldHVybjtcbiAgICB2YXIgaSwgbiA9IG5vZGVzLmxlbmd0aDtcbiAgICBzdHJlbmd0aHMgPSBuZXcgQXJyYXkobik7XG4gICAgeHogPSBuZXcgQXJyYXkobik7XG4gICAgZm9yIChpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgc3RyZW5ndGhzW2ldID0gaXNOYU4oeHpbaV0gPSAreChub2Rlc1tpXSwgaSwgbm9kZXMpKSA/IDAgOiArc3RyZW5ndGgobm9kZXNbaV0sIGksIG5vZGVzKTtcbiAgICB9XG4gIH1cblxuICBmb3JjZS5pbml0aWFsaXplID0gZnVuY3Rpb24oXykge1xuICAgIG5vZGVzID0gXztcbiAgICBpbml0aWFsaXplKCk7XG4gIH07XG5cbiAgZm9yY2Uuc3RyZW5ndGggPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoc3RyZW5ndGggPSB0eXBlb2YgXyA9PT0gXCJmdW5jdGlvblwiID8gXyA6IGNvbnN0YW50KCtfKSwgaW5pdGlhbGl6ZSgpLCBmb3JjZSkgOiBzdHJlbmd0aDtcbiAgfTtcblxuICBmb3JjZS54ID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHggPSB0eXBlb2YgXyA9PT0gXCJmdW5jdGlvblwiID8gXyA6IGNvbnN0YW50KCtfKSwgaW5pdGlhbGl6ZSgpLCBmb3JjZSkgOiB4O1xuICB9O1xuXG4gIHJldHVybiBmb3JjZTtcbn1cbiIsICJpbXBvcnQgY29uc3RhbnQgZnJvbSBcIi4vY29uc3RhbnQuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oeSkge1xuICB2YXIgc3RyZW5ndGggPSBjb25zdGFudCgwLjEpLFxuICAgICAgbm9kZXMsXG4gICAgICBzdHJlbmd0aHMsXG4gICAgICB5ejtcblxuICBpZiAodHlwZW9mIHkgIT09IFwiZnVuY3Rpb25cIikgeSA9IGNvbnN0YW50KHkgPT0gbnVsbCA/IDAgOiAreSk7XG5cbiAgZnVuY3Rpb24gZm9yY2UoYWxwaGEpIHtcbiAgICBmb3IgKHZhciBpID0gMCwgbiA9IG5vZGVzLmxlbmd0aCwgbm9kZTsgaSA8IG47ICsraSkge1xuICAgICAgbm9kZSA9IG5vZGVzW2ldLCBub2RlLnZ5ICs9ICh5eltpXSAtIG5vZGUueSkgKiBzdHJlbmd0aHNbaV0gKiBhbHBoYTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBpbml0aWFsaXplKCkge1xuICAgIGlmICghbm9kZXMpIHJldHVybjtcbiAgICB2YXIgaSwgbiA9IG5vZGVzLmxlbmd0aDtcbiAgICBzdHJlbmd0aHMgPSBuZXcgQXJyYXkobik7XG4gICAgeXogPSBuZXcgQXJyYXkobik7XG4gICAgZm9yIChpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgc3RyZW5ndGhzW2ldID0gaXNOYU4oeXpbaV0gPSAreShub2Rlc1tpXSwgaSwgbm9kZXMpKSA/IDAgOiArc3RyZW5ndGgobm9kZXNbaV0sIGksIG5vZGVzKTtcbiAgICB9XG4gIH1cblxuICBmb3JjZS5pbml0aWFsaXplID0gZnVuY3Rpb24oXykge1xuICAgIG5vZGVzID0gXztcbiAgICBpbml0aWFsaXplKCk7XG4gIH07XG5cbiAgZm9yY2Uuc3RyZW5ndGggPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoc3RyZW5ndGggPSB0eXBlb2YgXyA9PT0gXCJmdW5jdGlvblwiID8gXyA6IGNvbnN0YW50KCtfKSwgaW5pdGlhbGl6ZSgpLCBmb3JjZSkgOiBzdHJlbmd0aDtcbiAgfTtcblxuICBmb3JjZS55ID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHkgPSB0eXBlb2YgXyA9PT0gXCJmdW5jdGlvblwiID8gXyA6IGNvbnN0YW50KCtfKSwgaW5pdGlhbGl6ZSgpLCBmb3JjZSkgOiB5O1xuICB9O1xuXG4gIHJldHVybiBmb3JjZTtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCB4ID0+ICgpID0+IHg7XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gWm9vbUV2ZW50KHR5cGUsIHtcbiAgc291cmNlRXZlbnQsXG4gIHRhcmdldCxcbiAgdHJhbnNmb3JtLFxuICBkaXNwYXRjaFxufSkge1xuICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyh0aGlzLCB7XG4gICAgdHlwZToge3ZhbHVlOiB0eXBlLCBlbnVtZXJhYmxlOiB0cnVlLCBjb25maWd1cmFibGU6IHRydWV9LFxuICAgIHNvdXJjZUV2ZW50OiB7dmFsdWU6IHNvdXJjZUV2ZW50LCBlbnVtZXJhYmxlOiB0cnVlLCBjb25maWd1cmFibGU6IHRydWV9LFxuICAgIHRhcmdldDoge3ZhbHVlOiB0YXJnZXQsIGVudW1lcmFibGU6IHRydWUsIGNvbmZpZ3VyYWJsZTogdHJ1ZX0sXG4gICAgdHJhbnNmb3JtOiB7dmFsdWU6IHRyYW5zZm9ybSwgZW51bWVyYWJsZTogdHJ1ZSwgY29uZmlndXJhYmxlOiB0cnVlfSxcbiAgICBfOiB7dmFsdWU6IGRpc3BhdGNofVxuICB9KTtcbn1cbiIsICJleHBvcnQgZnVuY3Rpb24gVHJhbnNmb3JtKGssIHgsIHkpIHtcbiAgdGhpcy5rID0gaztcbiAgdGhpcy54ID0geDtcbiAgdGhpcy55ID0geTtcbn1cblxuVHJhbnNmb3JtLnByb3RvdHlwZSA9IHtcbiAgY29uc3RydWN0b3I6IFRyYW5zZm9ybSxcbiAgc2NhbGU6IGZ1bmN0aW9uKGspIHtcbiAgICByZXR1cm4gayA9PT0gMSA/IHRoaXMgOiBuZXcgVHJhbnNmb3JtKHRoaXMuayAqIGssIHRoaXMueCwgdGhpcy55KTtcbiAgfSxcbiAgdHJhbnNsYXRlOiBmdW5jdGlvbih4LCB5KSB7XG4gICAgcmV0dXJuIHggPT09IDAgJiB5ID09PSAwID8gdGhpcyA6IG5ldyBUcmFuc2Zvcm0odGhpcy5rLCB0aGlzLnggKyB0aGlzLmsgKiB4LCB0aGlzLnkgKyB0aGlzLmsgKiB5KTtcbiAgfSxcbiAgYXBwbHk6IGZ1bmN0aW9uKHBvaW50KSB7XG4gICAgcmV0dXJuIFtwb2ludFswXSAqIHRoaXMuayArIHRoaXMueCwgcG9pbnRbMV0gKiB0aGlzLmsgKyB0aGlzLnldO1xuICB9LFxuICBhcHBseVg6IGZ1bmN0aW9uKHgpIHtcbiAgICByZXR1cm4geCAqIHRoaXMuayArIHRoaXMueDtcbiAgfSxcbiAgYXBwbHlZOiBmdW5jdGlvbih5KSB7XG4gICAgcmV0dXJuIHkgKiB0aGlzLmsgKyB0aGlzLnk7XG4gIH0sXG4gIGludmVydDogZnVuY3Rpb24obG9jYXRpb24pIHtcbiAgICByZXR1cm4gWyhsb2NhdGlvblswXSAtIHRoaXMueCkgLyB0aGlzLmssIChsb2NhdGlvblsxXSAtIHRoaXMueSkgLyB0aGlzLmtdO1xuICB9LFxuICBpbnZlcnRYOiBmdW5jdGlvbih4KSB7XG4gICAgcmV0dXJuICh4IC0gdGhpcy54KSAvIHRoaXMuaztcbiAgfSxcbiAgaW52ZXJ0WTogZnVuY3Rpb24oeSkge1xuICAgIHJldHVybiAoeSAtIHRoaXMueSkgLyB0aGlzLms7XG4gIH0sXG4gIHJlc2NhbGVYOiBmdW5jdGlvbih4KSB7XG4gICAgcmV0dXJuIHguY29weSgpLmRvbWFpbih4LnJhbmdlKCkubWFwKHRoaXMuaW52ZXJ0WCwgdGhpcykubWFwKHguaW52ZXJ0LCB4KSk7XG4gIH0sXG4gIHJlc2NhbGVZOiBmdW5jdGlvbih5KSB7XG4gICAgcmV0dXJuIHkuY29weSgpLmRvbWFpbih5LnJhbmdlKCkubWFwKHRoaXMuaW52ZXJ0WSwgdGhpcykubWFwKHkuaW52ZXJ0LCB5KSk7XG4gIH0sXG4gIHRvU3RyaW5nOiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gXCJ0cmFuc2xhdGUoXCIgKyB0aGlzLnggKyBcIixcIiArIHRoaXMueSArIFwiKSBzY2FsZShcIiArIHRoaXMuayArIFwiKVwiO1xuICB9XG59O1xuXG5leHBvcnQgdmFyIGlkZW50aXR5ID0gbmV3IFRyYW5zZm9ybSgxLCAwLCAwKTtcblxudHJhbnNmb3JtLnByb3RvdHlwZSA9IFRyYW5zZm9ybS5wcm90b3R5cGU7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIHRyYW5zZm9ybShub2RlKSB7XG4gIHdoaWxlICghbm9kZS5fX3pvb20pIGlmICghKG5vZGUgPSBub2RlLnBhcmVudE5vZGUpKSByZXR1cm4gaWRlbnRpdHk7XG4gIHJldHVybiBub2RlLl9fem9vbTtcbn1cbiIsICJleHBvcnQgZnVuY3Rpb24gbm9wcm9wYWdhdGlvbihldmVudCkge1xuICBldmVudC5zdG9wSW1tZWRpYXRlUHJvcGFnYXRpb24oKTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oZXZlbnQpIHtcbiAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgZXZlbnQuc3RvcEltbWVkaWF0ZVByb3BhZ2F0aW9uKCk7XG59XG4iLCAiaW1wb3J0IHtkaXNwYXRjaH0gZnJvbSBcImQzLWRpc3BhdGNoXCI7XG5pbXBvcnQge2RyYWdEaXNhYmxlLCBkcmFnRW5hYmxlfSBmcm9tIFwiZDMtZHJhZ1wiO1xuaW1wb3J0IHtpbnRlcnBvbGF0ZVpvb219IGZyb20gXCJkMy1pbnRlcnBvbGF0ZVwiO1xuaW1wb3J0IHtzZWxlY3QsIHBvaW50ZXJ9IGZyb20gXCJkMy1zZWxlY3Rpb25cIjtcbmltcG9ydCB7aW50ZXJydXB0fSBmcm9tIFwiZDMtdHJhbnNpdGlvblwiO1xuaW1wb3J0IGNvbnN0YW50IGZyb20gXCIuL2NvbnN0YW50LmpzXCI7XG5pbXBvcnQgWm9vbUV2ZW50IGZyb20gXCIuL2V2ZW50LmpzXCI7XG5pbXBvcnQge1RyYW5zZm9ybSwgaWRlbnRpdHl9IGZyb20gXCIuL3RyYW5zZm9ybS5qc1wiO1xuaW1wb3J0IG5vZXZlbnQsIHtub3Byb3BhZ2F0aW9ufSBmcm9tIFwiLi9ub2V2ZW50LmpzXCI7XG5cbi8vIElnbm9yZSByaWdodC1jbGljaywgc2luY2UgdGhhdCBzaG91bGQgb3BlbiB0aGUgY29udGV4dCBtZW51LlxuLy8gZXhjZXB0IGZvciBwaW5jaC10by16b29tLCB3aGljaCBpcyBzZW50IGFzIGEgd2hlZWwrY3RybEtleSBldmVudFxuZnVuY3Rpb24gZGVmYXVsdEZpbHRlcihldmVudCkge1xuICByZXR1cm4gKCFldmVudC5jdHJsS2V5IHx8IGV2ZW50LnR5cGUgPT09ICd3aGVlbCcpICYmICFldmVudC5idXR0b247XG59XG5cbmZ1bmN0aW9uIGRlZmF1bHRFeHRlbnQoKSB7XG4gIHZhciBlID0gdGhpcztcbiAgaWYgKGUgaW5zdGFuY2VvZiBTVkdFbGVtZW50KSB7XG4gICAgZSA9IGUub3duZXJTVkdFbGVtZW50IHx8IGU7XG4gICAgaWYgKGUuaGFzQXR0cmlidXRlKFwidmlld0JveFwiKSkge1xuICAgICAgZSA9IGUudmlld0JveC5iYXNlVmFsO1xuICAgICAgcmV0dXJuIFtbZS54LCBlLnldLCBbZS54ICsgZS53aWR0aCwgZS55ICsgZS5oZWlnaHRdXTtcbiAgICB9XG4gICAgcmV0dXJuIFtbMCwgMF0sIFtlLndpZHRoLmJhc2VWYWwudmFsdWUsIGUuaGVpZ2h0LmJhc2VWYWwudmFsdWVdXTtcbiAgfVxuICByZXR1cm4gW1swLCAwXSwgW2UuY2xpZW50V2lkdGgsIGUuY2xpZW50SGVpZ2h0XV07XG59XG5cbmZ1bmN0aW9uIGRlZmF1bHRUcmFuc2Zvcm0oKSB7XG4gIHJldHVybiB0aGlzLl9fem9vbSB8fCBpZGVudGl0eTtcbn1cblxuZnVuY3Rpb24gZGVmYXVsdFdoZWVsRGVsdGEoZXZlbnQpIHtcbiAgcmV0dXJuIC1ldmVudC5kZWx0YVkgKiAoZXZlbnQuZGVsdGFNb2RlID09PSAxID8gMC4wNSA6IGV2ZW50LmRlbHRhTW9kZSA/IDEgOiAwLjAwMikgKiAoZXZlbnQuY3RybEtleSA/IDEwIDogMSk7XG59XG5cbmZ1bmN0aW9uIGRlZmF1bHRUb3VjaGFibGUoKSB7XG4gIHJldHVybiBuYXZpZ2F0b3IubWF4VG91Y2hQb2ludHMgfHwgKFwib250b3VjaHN0YXJ0XCIgaW4gdGhpcyk7XG59XG5cbmZ1bmN0aW9uIGRlZmF1bHRDb25zdHJhaW4odHJhbnNmb3JtLCBleHRlbnQsIHRyYW5zbGF0ZUV4dGVudCkge1xuICB2YXIgZHgwID0gdHJhbnNmb3JtLmludmVydFgoZXh0ZW50WzBdWzBdKSAtIHRyYW5zbGF0ZUV4dGVudFswXVswXSxcbiAgICAgIGR4MSA9IHRyYW5zZm9ybS5pbnZlcnRYKGV4dGVudFsxXVswXSkgLSB0cmFuc2xhdGVFeHRlbnRbMV1bMF0sXG4gICAgICBkeTAgPSB0cmFuc2Zvcm0uaW52ZXJ0WShleHRlbnRbMF1bMV0pIC0gdHJhbnNsYXRlRXh0ZW50WzBdWzFdLFxuICAgICAgZHkxID0gdHJhbnNmb3JtLmludmVydFkoZXh0ZW50WzFdWzFdKSAtIHRyYW5zbGF0ZUV4dGVudFsxXVsxXTtcbiAgcmV0dXJuIHRyYW5zZm9ybS50cmFuc2xhdGUoXG4gICAgZHgxID4gZHgwID8gKGR4MCArIGR4MSkgLyAyIDogTWF0aC5taW4oMCwgZHgwKSB8fCBNYXRoLm1heCgwLCBkeDEpLFxuICAgIGR5MSA+IGR5MCA/IChkeTAgKyBkeTEpIC8gMiA6IE1hdGgubWluKDAsIGR5MCkgfHwgTWF0aC5tYXgoMCwgZHkxKVxuICApO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgdmFyIGZpbHRlciA9IGRlZmF1bHRGaWx0ZXIsXG4gICAgICBleHRlbnQgPSBkZWZhdWx0RXh0ZW50LFxuICAgICAgY29uc3RyYWluID0gZGVmYXVsdENvbnN0cmFpbixcbiAgICAgIHdoZWVsRGVsdGEgPSBkZWZhdWx0V2hlZWxEZWx0YSxcbiAgICAgIHRvdWNoYWJsZSA9IGRlZmF1bHRUb3VjaGFibGUsXG4gICAgICBzY2FsZUV4dGVudCA9IFswLCBJbmZpbml0eV0sXG4gICAgICB0cmFuc2xhdGVFeHRlbnQgPSBbWy1JbmZpbml0eSwgLUluZmluaXR5XSwgW0luZmluaXR5LCBJbmZpbml0eV1dLFxuICAgICAgZHVyYXRpb24gPSAyNTAsXG4gICAgICBpbnRlcnBvbGF0ZSA9IGludGVycG9sYXRlWm9vbSxcbiAgICAgIGxpc3RlbmVycyA9IGRpc3BhdGNoKFwic3RhcnRcIiwgXCJ6b29tXCIsIFwiZW5kXCIpLFxuICAgICAgdG91Y2hzdGFydGluZyxcbiAgICAgIHRvdWNoZmlyc3QsXG4gICAgICB0b3VjaGVuZGluZyxcbiAgICAgIHRvdWNoRGVsYXkgPSA1MDAsXG4gICAgICB3aGVlbERlbGF5ID0gMTUwLFxuICAgICAgY2xpY2tEaXN0YW5jZTIgPSAwLFxuICAgICAgdGFwRGlzdGFuY2UgPSAxMDtcblxuICBmdW5jdGlvbiB6b29tKHNlbGVjdGlvbikge1xuICAgIHNlbGVjdGlvblxuICAgICAgICAucHJvcGVydHkoXCJfX3pvb21cIiwgZGVmYXVsdFRyYW5zZm9ybSlcbiAgICAgICAgLm9uKFwid2hlZWwuem9vbVwiLCB3aGVlbGVkLCB7cGFzc2l2ZTogZmFsc2V9KVxuICAgICAgICAub24oXCJtb3VzZWRvd24uem9vbVwiLCBtb3VzZWRvd25lZClcbiAgICAgICAgLm9uKFwiZGJsY2xpY2suem9vbVwiLCBkYmxjbGlja2VkKVxuICAgICAgLmZpbHRlcih0b3VjaGFibGUpXG4gICAgICAgIC5vbihcInRvdWNoc3RhcnQuem9vbVwiLCB0b3VjaHN0YXJ0ZWQpXG4gICAgICAgIC5vbihcInRvdWNobW92ZS56b29tXCIsIHRvdWNobW92ZWQpXG4gICAgICAgIC5vbihcInRvdWNoZW5kLnpvb20gdG91Y2hjYW5jZWwuem9vbVwiLCB0b3VjaGVuZGVkKVxuICAgICAgICAuc3R5bGUoXCItd2Via2l0LXRhcC1oaWdobGlnaHQtY29sb3JcIiwgXCJyZ2JhKDAsMCwwLDApXCIpO1xuICB9XG5cbiAgem9vbS50cmFuc2Zvcm0gPSBmdW5jdGlvbihjb2xsZWN0aW9uLCB0cmFuc2Zvcm0sIHBvaW50LCBldmVudCkge1xuICAgIHZhciBzZWxlY3Rpb24gPSBjb2xsZWN0aW9uLnNlbGVjdGlvbiA/IGNvbGxlY3Rpb24uc2VsZWN0aW9uKCkgOiBjb2xsZWN0aW9uO1xuICAgIHNlbGVjdGlvbi5wcm9wZXJ0eShcIl9fem9vbVwiLCBkZWZhdWx0VHJhbnNmb3JtKTtcbiAgICBpZiAoY29sbGVjdGlvbiAhPT0gc2VsZWN0aW9uKSB7XG4gICAgICBzY2hlZHVsZShjb2xsZWN0aW9uLCB0cmFuc2Zvcm0sIHBvaW50LCBldmVudCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHNlbGVjdGlvbi5pbnRlcnJ1cHQoKS5lYWNoKGZ1bmN0aW9uKCkge1xuICAgICAgICBnZXN0dXJlKHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgICAuZXZlbnQoZXZlbnQpXG4gICAgICAgICAgLnN0YXJ0KClcbiAgICAgICAgICAuem9vbShudWxsLCB0eXBlb2YgdHJhbnNmb3JtID09PSBcImZ1bmN0aW9uXCIgPyB0cmFuc2Zvcm0uYXBwbHkodGhpcywgYXJndW1lbnRzKSA6IHRyYW5zZm9ybSlcbiAgICAgICAgICAuZW5kKCk7XG4gICAgICB9KTtcbiAgICB9XG4gIH07XG5cbiAgem9vbS5zY2FsZUJ5ID0gZnVuY3Rpb24oc2VsZWN0aW9uLCBrLCBwLCBldmVudCkge1xuICAgIHpvb20uc2NhbGVUbyhzZWxlY3Rpb24sIGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIGswID0gdGhpcy5fX3pvb20uayxcbiAgICAgICAgICBrMSA9IHR5cGVvZiBrID09PSBcImZ1bmN0aW9uXCIgPyBrLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgOiBrO1xuICAgICAgcmV0dXJuIGswICogazE7XG4gICAgfSwgcCwgZXZlbnQpO1xuICB9O1xuXG4gIHpvb20uc2NhbGVUbyA9IGZ1bmN0aW9uKHNlbGVjdGlvbiwgaywgcCwgZXZlbnQpIHtcbiAgICB6b29tLnRyYW5zZm9ybShzZWxlY3Rpb24sIGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIGUgPSBleHRlbnQuYXBwbHkodGhpcywgYXJndW1lbnRzKSxcbiAgICAgICAgICB0MCA9IHRoaXMuX196b29tLFxuICAgICAgICAgIHAwID0gcCA9PSBudWxsID8gY2VudHJvaWQoZSkgOiB0eXBlb2YgcCA9PT0gXCJmdW5jdGlvblwiID8gcC5hcHBseSh0aGlzLCBhcmd1bWVudHMpIDogcCxcbiAgICAgICAgICBwMSA9IHQwLmludmVydChwMCksXG4gICAgICAgICAgazEgPSB0eXBlb2YgayA9PT0gXCJmdW5jdGlvblwiID8gay5hcHBseSh0aGlzLCBhcmd1bWVudHMpIDogaztcbiAgICAgIHJldHVybiBjb25zdHJhaW4odHJhbnNsYXRlKHNjYWxlKHQwLCBrMSksIHAwLCBwMSksIGUsIHRyYW5zbGF0ZUV4dGVudCk7XG4gICAgfSwgcCwgZXZlbnQpO1xuICB9O1xuXG4gIHpvb20udHJhbnNsYXRlQnkgPSBmdW5jdGlvbihzZWxlY3Rpb24sIHgsIHksIGV2ZW50KSB7XG4gICAgem9vbS50cmFuc2Zvcm0oc2VsZWN0aW9uLCBmdW5jdGlvbigpIHtcbiAgICAgIHJldHVybiBjb25zdHJhaW4odGhpcy5fX3pvb20udHJhbnNsYXRlKFxuICAgICAgICB0eXBlb2YgeCA9PT0gXCJmdW5jdGlvblwiID8geC5hcHBseSh0aGlzLCBhcmd1bWVudHMpIDogeCxcbiAgICAgICAgdHlwZW9mIHkgPT09IFwiZnVuY3Rpb25cIiA/IHkuYXBwbHkodGhpcywgYXJndW1lbnRzKSA6IHlcbiAgICAgICksIGV4dGVudC5hcHBseSh0aGlzLCBhcmd1bWVudHMpLCB0cmFuc2xhdGVFeHRlbnQpO1xuICAgIH0sIG51bGwsIGV2ZW50KTtcbiAgfTtcblxuICB6b29tLnRyYW5zbGF0ZVRvID0gZnVuY3Rpb24oc2VsZWN0aW9uLCB4LCB5LCBwLCBldmVudCkge1xuICAgIHpvb20udHJhbnNmb3JtKHNlbGVjdGlvbiwgZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgZSA9IGV4dGVudC5hcHBseSh0aGlzLCBhcmd1bWVudHMpLFxuICAgICAgICAgIHQgPSB0aGlzLl9fem9vbSxcbiAgICAgICAgICBwMCA9IHAgPT0gbnVsbCA/IGNlbnRyb2lkKGUpIDogdHlwZW9mIHAgPT09IFwiZnVuY3Rpb25cIiA/IHAuYXBwbHkodGhpcywgYXJndW1lbnRzKSA6IHA7XG4gICAgICByZXR1cm4gY29uc3RyYWluKGlkZW50aXR5LnRyYW5zbGF0ZShwMFswXSwgcDBbMV0pLnNjYWxlKHQuaykudHJhbnNsYXRlKFxuICAgICAgICB0eXBlb2YgeCA9PT0gXCJmdW5jdGlvblwiID8gLXguYXBwbHkodGhpcywgYXJndW1lbnRzKSA6IC14LFxuICAgICAgICB0eXBlb2YgeSA9PT0gXCJmdW5jdGlvblwiID8gLXkuYXBwbHkodGhpcywgYXJndW1lbnRzKSA6IC15XG4gICAgICApLCBlLCB0cmFuc2xhdGVFeHRlbnQpO1xuICAgIH0sIHAsIGV2ZW50KTtcbiAgfTtcblxuICBmdW5jdGlvbiBzY2FsZSh0cmFuc2Zvcm0sIGspIHtcbiAgICBrID0gTWF0aC5tYXgoc2NhbGVFeHRlbnRbMF0sIE1hdGgubWluKHNjYWxlRXh0ZW50WzFdLCBrKSk7XG4gICAgcmV0dXJuIGsgPT09IHRyYW5zZm9ybS5rID8gdHJhbnNmb3JtIDogbmV3IFRyYW5zZm9ybShrLCB0cmFuc2Zvcm0ueCwgdHJhbnNmb3JtLnkpO1xuICB9XG5cbiAgZnVuY3Rpb24gdHJhbnNsYXRlKHRyYW5zZm9ybSwgcDAsIHAxKSB7XG4gICAgdmFyIHggPSBwMFswXSAtIHAxWzBdICogdHJhbnNmb3JtLmssIHkgPSBwMFsxXSAtIHAxWzFdICogdHJhbnNmb3JtLms7XG4gICAgcmV0dXJuIHggPT09IHRyYW5zZm9ybS54ICYmIHkgPT09IHRyYW5zZm9ybS55ID8gdHJhbnNmb3JtIDogbmV3IFRyYW5zZm9ybSh0cmFuc2Zvcm0uaywgeCwgeSk7XG4gIH1cblxuICBmdW5jdGlvbiBjZW50cm9pZChleHRlbnQpIHtcbiAgICByZXR1cm4gWygrZXh0ZW50WzBdWzBdICsgK2V4dGVudFsxXVswXSkgLyAyLCAoK2V4dGVudFswXVsxXSArICtleHRlbnRbMV1bMV0pIC8gMl07XG4gIH1cblxuICBmdW5jdGlvbiBzY2hlZHVsZSh0cmFuc2l0aW9uLCB0cmFuc2Zvcm0sIHBvaW50LCBldmVudCkge1xuICAgIHRyYW5zaXRpb25cbiAgICAgICAgLm9uKFwic3RhcnQuem9vbVwiLCBmdW5jdGlvbigpIHsgZ2VzdHVyZSh0aGlzLCBhcmd1bWVudHMpLmV2ZW50KGV2ZW50KS5zdGFydCgpOyB9KVxuICAgICAgICAub24oXCJpbnRlcnJ1cHQuem9vbSBlbmQuem9vbVwiLCBmdW5jdGlvbigpIHsgZ2VzdHVyZSh0aGlzLCBhcmd1bWVudHMpLmV2ZW50KGV2ZW50KS5lbmQoKTsgfSlcbiAgICAgICAgLnR3ZWVuKFwiem9vbVwiLCBmdW5jdGlvbigpIHtcbiAgICAgICAgICB2YXIgdGhhdCA9IHRoaXMsXG4gICAgICAgICAgICAgIGFyZ3MgPSBhcmd1bWVudHMsXG4gICAgICAgICAgICAgIGcgPSBnZXN0dXJlKHRoYXQsIGFyZ3MpLmV2ZW50KGV2ZW50KSxcbiAgICAgICAgICAgICAgZSA9IGV4dGVudC5hcHBseSh0aGF0LCBhcmdzKSxcbiAgICAgICAgICAgICAgcCA9IHBvaW50ID09IG51bGwgPyBjZW50cm9pZChlKSA6IHR5cGVvZiBwb2ludCA9PT0gXCJmdW5jdGlvblwiID8gcG9pbnQuYXBwbHkodGhhdCwgYXJncykgOiBwb2ludCxcbiAgICAgICAgICAgICAgdyA9IE1hdGgubWF4KGVbMV1bMF0gLSBlWzBdWzBdLCBlWzFdWzFdIC0gZVswXVsxXSksXG4gICAgICAgICAgICAgIGEgPSB0aGF0Ll9fem9vbSxcbiAgICAgICAgICAgICAgYiA9IHR5cGVvZiB0cmFuc2Zvcm0gPT09IFwiZnVuY3Rpb25cIiA/IHRyYW5zZm9ybS5hcHBseSh0aGF0LCBhcmdzKSA6IHRyYW5zZm9ybSxcbiAgICAgICAgICAgICAgaSA9IGludGVycG9sYXRlKGEuaW52ZXJ0KHApLmNvbmNhdCh3IC8gYS5rKSwgYi5pbnZlcnQocCkuY29uY2F0KHcgLyBiLmspKTtcbiAgICAgICAgICByZXR1cm4gZnVuY3Rpb24odCkge1xuICAgICAgICAgICAgaWYgKHQgPT09IDEpIHQgPSBiOyAvLyBBdm9pZCByb3VuZGluZyBlcnJvciBvbiBlbmQuXG4gICAgICAgICAgICBlbHNlIHsgdmFyIGwgPSBpKHQpLCBrID0gdyAvIGxbMl07IHQgPSBuZXcgVHJhbnNmb3JtKGssIHBbMF0gLSBsWzBdICogaywgcFsxXSAtIGxbMV0gKiBrKTsgfVxuICAgICAgICAgICAgZy56b29tKG51bGwsIHQpO1xuICAgICAgICAgIH07XG4gICAgICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gZ2VzdHVyZSh0aGF0LCBhcmdzLCBjbGVhbikge1xuICAgIHJldHVybiAoIWNsZWFuICYmIHRoYXQuX196b29taW5nKSB8fCBuZXcgR2VzdHVyZSh0aGF0LCBhcmdzKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIEdlc3R1cmUodGhhdCwgYXJncykge1xuICAgIHRoaXMudGhhdCA9IHRoYXQ7XG4gICAgdGhpcy5hcmdzID0gYXJncztcbiAgICB0aGlzLmFjdGl2ZSA9IDA7XG4gICAgdGhpcy5zb3VyY2VFdmVudCA9IG51bGw7XG4gICAgdGhpcy5leHRlbnQgPSBleHRlbnQuYXBwbHkodGhhdCwgYXJncyk7XG4gICAgdGhpcy50YXBzID0gMDtcbiAgfVxuXG4gIEdlc3R1cmUucHJvdG90eXBlID0ge1xuICAgIGV2ZW50OiBmdW5jdGlvbihldmVudCkge1xuICAgICAgaWYgKGV2ZW50KSB0aGlzLnNvdXJjZUV2ZW50ID0gZXZlbnQ7XG4gICAgICByZXR1cm4gdGhpcztcbiAgICB9LFxuICAgIHN0YXJ0OiBmdW5jdGlvbigpIHtcbiAgICAgIGlmICgrK3RoaXMuYWN0aXZlID09PSAxKSB7XG4gICAgICAgIHRoaXMudGhhdC5fX3pvb21pbmcgPSB0aGlzO1xuICAgICAgICB0aGlzLmVtaXQoXCJzdGFydFwiKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH0sXG4gICAgem9vbTogZnVuY3Rpb24oa2V5LCB0cmFuc2Zvcm0pIHtcbiAgICAgIGlmICh0aGlzLm1vdXNlICYmIGtleSAhPT0gXCJtb3VzZVwiKSB0aGlzLm1vdXNlWzFdID0gdHJhbnNmb3JtLmludmVydCh0aGlzLm1vdXNlWzBdKTtcbiAgICAgIGlmICh0aGlzLnRvdWNoMCAmJiBrZXkgIT09IFwidG91Y2hcIikgdGhpcy50b3VjaDBbMV0gPSB0cmFuc2Zvcm0uaW52ZXJ0KHRoaXMudG91Y2gwWzBdKTtcbiAgICAgIGlmICh0aGlzLnRvdWNoMSAmJiBrZXkgIT09IFwidG91Y2hcIikgdGhpcy50b3VjaDFbMV0gPSB0cmFuc2Zvcm0uaW52ZXJ0KHRoaXMudG91Y2gxWzBdKTtcbiAgICAgIHRoaXMudGhhdC5fX3pvb20gPSB0cmFuc2Zvcm07XG4gICAgICB0aGlzLmVtaXQoXCJ6b29tXCIpO1xuICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfSxcbiAgICBlbmQ6IGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKC0tdGhpcy5hY3RpdmUgPT09IDApIHtcbiAgICAgICAgZGVsZXRlIHRoaXMudGhhdC5fX3pvb21pbmc7XG4gICAgICAgIHRoaXMuZW1pdChcImVuZFwiKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH0sXG4gICAgZW1pdDogZnVuY3Rpb24odHlwZSkge1xuICAgICAgdmFyIGQgPSBzZWxlY3QodGhpcy50aGF0KS5kYXR1bSgpO1xuICAgICAgbGlzdGVuZXJzLmNhbGwoXG4gICAgICAgIHR5cGUsXG4gICAgICAgIHRoaXMudGhhdCxcbiAgICAgICAgbmV3IFpvb21FdmVudCh0eXBlLCB7XG4gICAgICAgICAgc291cmNlRXZlbnQ6IHRoaXMuc291cmNlRXZlbnQsXG4gICAgICAgICAgdGFyZ2V0OiB6b29tLFxuICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgdHJhbnNmb3JtOiB0aGlzLnRoYXQuX196b29tLFxuICAgICAgICAgIGRpc3BhdGNoOiBsaXN0ZW5lcnNcbiAgICAgICAgfSksXG4gICAgICAgIGRcbiAgICAgICk7XG4gICAgfVxuICB9O1xuXG4gIGZ1bmN0aW9uIHdoZWVsZWQoZXZlbnQsIC4uLmFyZ3MpIHtcbiAgICBpZiAoIWZpbHRlci5hcHBseSh0aGlzLCBhcmd1bWVudHMpKSByZXR1cm47XG4gICAgdmFyIGcgPSBnZXN0dXJlKHRoaXMsIGFyZ3MpLmV2ZW50KGV2ZW50KSxcbiAgICAgICAgdCA9IHRoaXMuX196b29tLFxuICAgICAgICBrID0gTWF0aC5tYXgoc2NhbGVFeHRlbnRbMF0sIE1hdGgubWluKHNjYWxlRXh0ZW50WzFdLCB0LmsgKiBNYXRoLnBvdygyLCB3aGVlbERlbHRhLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykpKSksXG4gICAgICAgIHAgPSBwb2ludGVyKGV2ZW50KTtcblxuICAgIC8vIElmIHRoZSBtb3VzZSBpcyBpbiB0aGUgc2FtZSBsb2NhdGlvbiBhcyBiZWZvcmUsIHJldXNlIGl0LlxuICAgIC8vIElmIHRoZXJlIHdlcmUgcmVjZW50IHdoZWVsIGV2ZW50cywgcmVzZXQgdGhlIHdoZWVsIGlkbGUgdGltZW91dC5cbiAgICBpZiAoZy53aGVlbCkge1xuICAgICAgaWYgKGcubW91c2VbMF1bMF0gIT09IHBbMF0gfHwgZy5tb3VzZVswXVsxXSAhPT0gcFsxXSkge1xuICAgICAgICBnLm1vdXNlWzFdID0gdC5pbnZlcnQoZy5tb3VzZVswXSA9IHApO1xuICAgICAgfVxuICAgICAgY2xlYXJUaW1lb3V0KGcud2hlZWwpO1xuICAgIH1cblxuICAgIC8vIElmIHRoaXMgd2hlZWwgZXZlbnQgd29uXHUyMDE5dCB0cmlnZ2VyIGEgdHJhbnNmb3JtIGNoYW5nZSwgaWdub3JlIGl0LlxuICAgIGVsc2UgaWYgKHQuayA9PT0gaykgcmV0dXJuO1xuXG4gICAgLy8gT3RoZXJ3aXNlLCBjYXB0dXJlIHRoZSBtb3VzZSBwb2ludCBhbmQgbG9jYXRpb24gYXQgdGhlIHN0YXJ0LlxuICAgIGVsc2Uge1xuICAgICAgZy5tb3VzZSA9IFtwLCB0LmludmVydChwKV07XG4gICAgICBpbnRlcnJ1cHQodGhpcyk7XG4gICAgICBnLnN0YXJ0KCk7XG4gICAgfVxuXG4gICAgbm9ldmVudChldmVudCk7XG4gICAgZy53aGVlbCA9IHNldFRpbWVvdXQod2hlZWxpZGxlZCwgd2hlZWxEZWxheSk7XG4gICAgZy56b29tKFwibW91c2VcIiwgY29uc3RyYWluKHRyYW5zbGF0ZShzY2FsZSh0LCBrKSwgZy5tb3VzZVswXSwgZy5tb3VzZVsxXSksIGcuZXh0ZW50LCB0cmFuc2xhdGVFeHRlbnQpKTtcblxuICAgIGZ1bmN0aW9uIHdoZWVsaWRsZWQoKSB7XG4gICAgICBnLndoZWVsID0gbnVsbDtcbiAgICAgIGcuZW5kKCk7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gbW91c2Vkb3duZWQoZXZlbnQsIC4uLmFyZ3MpIHtcbiAgICBpZiAodG91Y2hlbmRpbmcgfHwgIWZpbHRlci5hcHBseSh0aGlzLCBhcmd1bWVudHMpKSByZXR1cm47XG4gICAgdmFyIGN1cnJlbnRUYXJnZXQgPSBldmVudC5jdXJyZW50VGFyZ2V0LFxuICAgICAgICBnID0gZ2VzdHVyZSh0aGlzLCBhcmdzLCB0cnVlKS5ldmVudChldmVudCksXG4gICAgICAgIHYgPSBzZWxlY3QoZXZlbnQudmlldykub24oXCJtb3VzZW1vdmUuem9vbVwiLCBtb3VzZW1vdmVkLCB0cnVlKS5vbihcIm1vdXNldXAuem9vbVwiLCBtb3VzZXVwcGVkLCB0cnVlKSxcbiAgICAgICAgcCA9IHBvaW50ZXIoZXZlbnQsIGN1cnJlbnRUYXJnZXQpLFxuICAgICAgICB4MCA9IGV2ZW50LmNsaWVudFgsXG4gICAgICAgIHkwID0gZXZlbnQuY2xpZW50WTtcblxuICAgIGRyYWdEaXNhYmxlKGV2ZW50LnZpZXcpO1xuICAgIG5vcHJvcGFnYXRpb24oZXZlbnQpO1xuICAgIGcubW91c2UgPSBbcCwgdGhpcy5fX3pvb20uaW52ZXJ0KHApXTtcbiAgICBpbnRlcnJ1cHQodGhpcyk7XG4gICAgZy5zdGFydCgpO1xuXG4gICAgZnVuY3Rpb24gbW91c2Vtb3ZlZChldmVudCkge1xuICAgICAgbm9ldmVudChldmVudCk7XG4gICAgICBpZiAoIWcubW92ZWQpIHtcbiAgICAgICAgdmFyIGR4ID0gZXZlbnQuY2xpZW50WCAtIHgwLCBkeSA9IGV2ZW50LmNsaWVudFkgLSB5MDtcbiAgICAgICAgZy5tb3ZlZCA9IGR4ICogZHggKyBkeSAqIGR5ID4gY2xpY2tEaXN0YW5jZTI7XG4gICAgICB9XG4gICAgICBnLmV2ZW50KGV2ZW50KVxuICAgICAgIC56b29tKFwibW91c2VcIiwgY29uc3RyYWluKHRyYW5zbGF0ZShnLnRoYXQuX196b29tLCBnLm1vdXNlWzBdID0gcG9pbnRlcihldmVudCwgY3VycmVudFRhcmdldCksIGcubW91c2VbMV0pLCBnLmV4dGVudCwgdHJhbnNsYXRlRXh0ZW50KSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbW91c2V1cHBlZChldmVudCkge1xuICAgICAgdi5vbihcIm1vdXNlbW92ZS56b29tIG1vdXNldXAuem9vbVwiLCBudWxsKTtcbiAgICAgIGRyYWdFbmFibGUoZXZlbnQudmlldywgZy5tb3ZlZCk7XG4gICAgICBub2V2ZW50KGV2ZW50KTtcbiAgICAgIGcuZXZlbnQoZXZlbnQpLmVuZCgpO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGRibGNsaWNrZWQoZXZlbnQsIC4uLmFyZ3MpIHtcbiAgICBpZiAoIWZpbHRlci5hcHBseSh0aGlzLCBhcmd1bWVudHMpKSByZXR1cm47XG4gICAgdmFyIHQwID0gdGhpcy5fX3pvb20sXG4gICAgICAgIHAwID0gcG9pbnRlcihldmVudC5jaGFuZ2VkVG91Y2hlcyA/IGV2ZW50LmNoYW5nZWRUb3VjaGVzWzBdIDogZXZlbnQsIHRoaXMpLFxuICAgICAgICBwMSA9IHQwLmludmVydChwMCksXG4gICAgICAgIGsxID0gdDAuayAqIChldmVudC5zaGlmdEtleSA/IDAuNSA6IDIpLFxuICAgICAgICB0MSA9IGNvbnN0cmFpbih0cmFuc2xhdGUoc2NhbGUodDAsIGsxKSwgcDAsIHAxKSwgZXh0ZW50LmFwcGx5KHRoaXMsIGFyZ3MpLCB0cmFuc2xhdGVFeHRlbnQpO1xuXG4gICAgbm9ldmVudChldmVudCk7XG4gICAgaWYgKGR1cmF0aW9uID4gMCkgc2VsZWN0KHRoaXMpLnRyYW5zaXRpb24oKS5kdXJhdGlvbihkdXJhdGlvbikuY2FsbChzY2hlZHVsZSwgdDEsIHAwLCBldmVudCk7XG4gICAgZWxzZSBzZWxlY3QodGhpcykuY2FsbCh6b29tLnRyYW5zZm9ybSwgdDEsIHAwLCBldmVudCk7XG4gIH1cblxuICBmdW5jdGlvbiB0b3VjaHN0YXJ0ZWQoZXZlbnQsIC4uLmFyZ3MpIHtcbiAgICBpZiAoIWZpbHRlci5hcHBseSh0aGlzLCBhcmd1bWVudHMpKSByZXR1cm47XG4gICAgdmFyIHRvdWNoZXMgPSBldmVudC50b3VjaGVzLFxuICAgICAgICBuID0gdG91Y2hlcy5sZW5ndGgsXG4gICAgICAgIGcgPSBnZXN0dXJlKHRoaXMsIGFyZ3MsIGV2ZW50LmNoYW5nZWRUb3VjaGVzLmxlbmd0aCA9PT0gbikuZXZlbnQoZXZlbnQpLFxuICAgICAgICBzdGFydGVkLCBpLCB0LCBwO1xuXG4gICAgbm9wcm9wYWdhdGlvbihldmVudCk7XG4gICAgZm9yIChpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgdCA9IHRvdWNoZXNbaV0sIHAgPSBwb2ludGVyKHQsIHRoaXMpO1xuICAgICAgcCA9IFtwLCB0aGlzLl9fem9vbS5pbnZlcnQocCksIHQuaWRlbnRpZmllcl07XG4gICAgICBpZiAoIWcudG91Y2gwKSBnLnRvdWNoMCA9IHAsIHN0YXJ0ZWQgPSB0cnVlLCBnLnRhcHMgPSAxICsgISF0b3VjaHN0YXJ0aW5nO1xuICAgICAgZWxzZSBpZiAoIWcudG91Y2gxICYmIGcudG91Y2gwWzJdICE9PSBwWzJdKSBnLnRvdWNoMSA9IHAsIGcudGFwcyA9IDA7XG4gICAgfVxuXG4gICAgaWYgKHRvdWNoc3RhcnRpbmcpIHRvdWNoc3RhcnRpbmcgPSBjbGVhclRpbWVvdXQodG91Y2hzdGFydGluZyk7XG5cbiAgICBpZiAoc3RhcnRlZCkge1xuICAgICAgaWYgKGcudGFwcyA8IDIpIHRvdWNoZmlyc3QgPSBwWzBdLCB0b3VjaHN0YXJ0aW5nID0gc2V0VGltZW91dChmdW5jdGlvbigpIHsgdG91Y2hzdGFydGluZyA9IG51bGw7IH0sIHRvdWNoRGVsYXkpO1xuICAgICAgaW50ZXJydXB0KHRoaXMpO1xuICAgICAgZy5zdGFydCgpO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHRvdWNobW92ZWQoZXZlbnQsIC4uLmFyZ3MpIHtcbiAgICBpZiAoIXRoaXMuX196b29taW5nKSByZXR1cm47XG4gICAgdmFyIGcgPSBnZXN0dXJlKHRoaXMsIGFyZ3MpLmV2ZW50KGV2ZW50KSxcbiAgICAgICAgdG91Y2hlcyA9IGV2ZW50LmNoYW5nZWRUb3VjaGVzLFxuICAgICAgICBuID0gdG91Y2hlcy5sZW5ndGgsIGksIHQsIHAsIGw7XG5cbiAgICBub2V2ZW50KGV2ZW50KTtcbiAgICBmb3IgKGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICB0ID0gdG91Y2hlc1tpXSwgcCA9IHBvaW50ZXIodCwgdGhpcyk7XG4gICAgICBpZiAoZy50b3VjaDAgJiYgZy50b3VjaDBbMl0gPT09IHQuaWRlbnRpZmllcikgZy50b3VjaDBbMF0gPSBwO1xuICAgICAgZWxzZSBpZiAoZy50b3VjaDEgJiYgZy50b3VjaDFbMl0gPT09IHQuaWRlbnRpZmllcikgZy50b3VjaDFbMF0gPSBwO1xuICAgIH1cbiAgICB0ID0gZy50aGF0Ll9fem9vbTtcbiAgICBpZiAoZy50b3VjaDEpIHtcbiAgICAgIHZhciBwMCA9IGcudG91Y2gwWzBdLCBsMCA9IGcudG91Y2gwWzFdLFxuICAgICAgICAgIHAxID0gZy50b3VjaDFbMF0sIGwxID0gZy50b3VjaDFbMV0sXG4gICAgICAgICAgZHAgPSAoZHAgPSBwMVswXSAtIHAwWzBdKSAqIGRwICsgKGRwID0gcDFbMV0gLSBwMFsxXSkgKiBkcCxcbiAgICAgICAgICBkbCA9IChkbCA9IGwxWzBdIC0gbDBbMF0pICogZGwgKyAoZGwgPSBsMVsxXSAtIGwwWzFdKSAqIGRsO1xuICAgICAgdCA9IHNjYWxlKHQsIE1hdGguc3FydChkcCAvIGRsKSk7XG4gICAgICBwID0gWyhwMFswXSArIHAxWzBdKSAvIDIsIChwMFsxXSArIHAxWzFdKSAvIDJdO1xuICAgICAgbCA9IFsobDBbMF0gKyBsMVswXSkgLyAyLCAobDBbMV0gKyBsMVsxXSkgLyAyXTtcbiAgICB9XG4gICAgZWxzZSBpZiAoZy50b3VjaDApIHAgPSBnLnRvdWNoMFswXSwgbCA9IGcudG91Y2gwWzFdO1xuICAgIGVsc2UgcmV0dXJuO1xuXG4gICAgZy56b29tKFwidG91Y2hcIiwgY29uc3RyYWluKHRyYW5zbGF0ZSh0LCBwLCBsKSwgZy5leHRlbnQsIHRyYW5zbGF0ZUV4dGVudCkpO1xuICB9XG5cbiAgZnVuY3Rpb24gdG91Y2hlbmRlZChldmVudCwgLi4uYXJncykge1xuICAgIGlmICghdGhpcy5fX3pvb21pbmcpIHJldHVybjtcbiAgICB2YXIgZyA9IGdlc3R1cmUodGhpcywgYXJncykuZXZlbnQoZXZlbnQpLFxuICAgICAgICB0b3VjaGVzID0gZXZlbnQuY2hhbmdlZFRvdWNoZXMsXG4gICAgICAgIG4gPSB0b3VjaGVzLmxlbmd0aCwgaSwgdDtcblxuICAgIG5vcHJvcGFnYXRpb24oZXZlbnQpO1xuICAgIGlmICh0b3VjaGVuZGluZykgY2xlYXJUaW1lb3V0KHRvdWNoZW5kaW5nKTtcbiAgICB0b3VjaGVuZGluZyA9IHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7IHRvdWNoZW5kaW5nID0gbnVsbDsgfSwgdG91Y2hEZWxheSk7XG4gICAgZm9yIChpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgdCA9IHRvdWNoZXNbaV07XG4gICAgICBpZiAoZy50b3VjaDAgJiYgZy50b3VjaDBbMl0gPT09IHQuaWRlbnRpZmllcikgZGVsZXRlIGcudG91Y2gwO1xuICAgICAgZWxzZSBpZiAoZy50b3VjaDEgJiYgZy50b3VjaDFbMl0gPT09IHQuaWRlbnRpZmllcikgZGVsZXRlIGcudG91Y2gxO1xuICAgIH1cbiAgICBpZiAoZy50b3VjaDEgJiYgIWcudG91Y2gwKSBnLnRvdWNoMCA9IGcudG91Y2gxLCBkZWxldGUgZy50b3VjaDE7XG4gICAgaWYgKGcudG91Y2gwKSBnLnRvdWNoMFsxXSA9IHRoaXMuX196b29tLmludmVydChnLnRvdWNoMFswXSk7XG4gICAgZWxzZSB7XG4gICAgICBnLmVuZCgpO1xuICAgICAgLy8gSWYgdGhpcyB3YXMgYSBkYmx0YXAsIHJlcm91dGUgdG8gdGhlIChvcHRpb25hbCkgZGJsY2xpY2suem9vbSBoYW5kbGVyLlxuICAgICAgaWYgKGcudGFwcyA9PT0gMikge1xuICAgICAgICB0ID0gcG9pbnRlcih0LCB0aGlzKTtcbiAgICAgICAgaWYgKE1hdGguaHlwb3QodG91Y2hmaXJzdFswXSAtIHRbMF0sIHRvdWNoZmlyc3RbMV0gLSB0WzFdKSA8IHRhcERpc3RhbmNlKSB7XG4gICAgICAgICAgdmFyIHAgPSBzZWxlY3QodGhpcykub24oXCJkYmxjbGljay56b29tXCIpO1xuICAgICAgICAgIGlmIChwKSBwLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICB6b29tLndoZWVsRGVsdGEgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAod2hlZWxEZWx0YSA9IHR5cGVvZiBfID09PSBcImZ1bmN0aW9uXCIgPyBfIDogY29uc3RhbnQoK18pLCB6b29tKSA6IHdoZWVsRGVsdGE7XG4gIH07XG5cbiAgem9vbS5maWx0ZXIgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoZmlsdGVyID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudCghIV8pLCB6b29tKSA6IGZpbHRlcjtcbiAgfTtcblxuICB6b29tLnRvdWNoYWJsZSA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/ICh0b3VjaGFibGUgPSB0eXBlb2YgXyA9PT0gXCJmdW5jdGlvblwiID8gXyA6IGNvbnN0YW50KCEhXyksIHpvb20pIDogdG91Y2hhYmxlO1xuICB9O1xuXG4gIHpvb20uZXh0ZW50ID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGV4dGVudCA9IHR5cGVvZiBfID09PSBcImZ1bmN0aW9uXCIgPyBfIDogY29uc3RhbnQoW1srX1swXVswXSwgK19bMF1bMV1dLCBbK19bMV1bMF0sICtfWzFdWzFdXV0pLCB6b29tKSA6IGV4dGVudDtcbiAgfTtcblxuICB6b29tLnNjYWxlRXh0ZW50ID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHNjYWxlRXh0ZW50WzBdID0gK19bMF0sIHNjYWxlRXh0ZW50WzFdID0gK19bMV0sIHpvb20pIDogW3NjYWxlRXh0ZW50WzBdLCBzY2FsZUV4dGVudFsxXV07XG4gIH07XG5cbiAgem9vbS50cmFuc2xhdGVFeHRlbnQgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAodHJhbnNsYXRlRXh0ZW50WzBdWzBdID0gK19bMF1bMF0sIHRyYW5zbGF0ZUV4dGVudFsxXVswXSA9ICtfWzFdWzBdLCB0cmFuc2xhdGVFeHRlbnRbMF1bMV0gPSArX1swXVsxXSwgdHJhbnNsYXRlRXh0ZW50WzFdWzFdID0gK19bMV1bMV0sIHpvb20pIDogW1t0cmFuc2xhdGVFeHRlbnRbMF1bMF0sIHRyYW5zbGF0ZUV4dGVudFswXVsxXV0sIFt0cmFuc2xhdGVFeHRlbnRbMV1bMF0sIHRyYW5zbGF0ZUV4dGVudFsxXVsxXV1dO1xuICB9O1xuXG4gIHpvb20uY29uc3RyYWluID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGNvbnN0cmFpbiA9IF8sIHpvb20pIDogY29uc3RyYWluO1xuICB9O1xuXG4gIHpvb20uZHVyYXRpb24gPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoZHVyYXRpb24gPSArXywgem9vbSkgOiBkdXJhdGlvbjtcbiAgfTtcblxuICB6b29tLmludGVycG9sYXRlID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGludGVycG9sYXRlID0gXywgem9vbSkgOiBpbnRlcnBvbGF0ZTtcbiAgfTtcblxuICB6b29tLm9uID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHZhbHVlID0gbGlzdGVuZXJzLm9uLmFwcGx5KGxpc3RlbmVycywgYXJndW1lbnRzKTtcbiAgICByZXR1cm4gdmFsdWUgPT09IGxpc3RlbmVycyA/IHpvb20gOiB2YWx1ZTtcbiAgfTtcblxuICB6b29tLmNsaWNrRGlzdGFuY2UgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoY2xpY2tEaXN0YW5jZTIgPSAoXyA9ICtfKSAqIF8sIHpvb20pIDogTWF0aC5zcXJ0KGNsaWNrRGlzdGFuY2UyKTtcbiAgfTtcblxuICB6b29tLnRhcERpc3RhbmNlID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHRhcERpc3RhbmNlID0gK18sIHpvb20pIDogdGFwRGlzdGFuY2U7XG4gIH07XG5cbiAgcmV0dXJuIHpvb207XG59XG4iLCAiaW1wb3J0IHtcbiAgRWRpdG9yLFxuICBFZGl0b3JQb3NpdGlvbixcbiAgRWRpdG9yU3VnZ2VzdCxcbiAgRWRpdG9yU3VnZ2VzdENvbnRleHQsXG4gIEVkaXRvclN1Z2dlc3RUcmlnZ2VySW5mbyxcbiAgVEZpbGUsXG59IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0IHsgUGFyc2VkT2JqZWN0IH0gZnJvbSBcIi4vcGFyc2VyXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgT2JqZWN0U3VnZ2VzdGlvbiB7XG4gIC8qKiBUaGUgZGlzYW1iaWd1YXRlZCBrZXkgdXNlZCBmb3Ige3t9fSBsaW5rcyAqL1xuICBkaXNwbGF5S2V5OiBzdHJpbmc7XG4gIC8qKiBUaGUgb3JpZ2luYWwga2V5IHZhbHVlIChmb3IgZGlzcGxheS9zZWFyY2gpICovXG4gIGtleVZhbHVlOiBzdHJpbmc7XG4gIGZpbGVMYWJlbDogc3RyaW5nO1xuICBmaWxlUGF0aDogc3RyaW5nO1xuICBwcm9wZXJ0aWVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xufVxuXG5leHBvcnQgY2xhc3MgT2JqZWN0TGlua1N1Z2dlc3QgZXh0ZW5kcyBFZGl0b3JTdWdnZXN0PE9iamVjdFN1Z2dlc3Rpb24+IHtcbiAgcHJpdmF0ZSBvYmplY3RzOiBPYmplY3RTdWdnZXN0aW9uW10gPSBbXTtcblxuICBjb25zdHJ1Y3RvcihhcHA6IGFueSkge1xuICAgIHN1cGVyKGFwcCk7XG5cbiAgICAvLyBNYWtlIHN1Z2dlc3Rpb25zIGFjY2VwdCB3aXRoIFRhYiAoaW4gYWRkaXRpb24gdG8gRW50ZXIpLlxuICAgIC8vIE9ic2lkaWFuJ3MgUG9wb3ZlclN1Z2dlc3QgdXNlcyBhbiBpbnRlcm5hbCBcImNob29zZXJcIjsgd2UgY2FsbCBpdCBiZXN0LWVmZm9ydC5cbiAgICB0aGlzLnNldEluc3RydWN0aW9ucyhbXG4gICAgICB7IGNvbW1hbmQ6IFwiXHUyMTkxXHUyMTkzXCIsIHB1cnBvc2U6IFwidG8gbmF2aWdhdGVcIiB9LFxuICAgICAgeyBjb21tYW5kOiBcIkVudGVyXCIsIHB1cnBvc2U6IFwidG8gaW5zZXJ0XCIgfSxcbiAgICAgIHsgY29tbWFuZDogXCJUYWJcIiwgcHVycG9zZTogXCJ0byBpbnNlcnRcIiB9LFxuICAgICAgeyBjb21tYW5kOiBcIkVzY1wiLCBwdXJwb3NlOiBcInRvIGRpc21pc3NcIiB9LFxuICAgIF0pO1xuXG4gICAgdGhpcy5zY29wZS5yZWdpc3RlcihbXSwgXCJUYWJcIiwgKGV2dCkgPT4ge1xuICAgICAgY29uc3QgZSA9IGV2dCBhcyBLZXlib2FyZEV2ZW50O1xuICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIGNvbnN0IGNob29zZXIgPSAodGhpcyBhcyBhbnkpLmNob29zZXI7XG4gICAgICBpZiAoY2hvb3NlciAmJiB0eXBlb2YgY2hvb3Nlci51c2VTZWxlY3RlZEl0ZW0gPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICBjaG9vc2VyLnVzZVNlbGVjdGVkSXRlbShlKTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgICAvLyBGYWxsYmFjazogc2ltdWxhdGUgRW50ZXJcbiAgICAgIGlmIChjaG9vc2VyICYmIHR5cGVvZiBjaG9vc2VyLm9uRW50ZXIgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICBjaG9vc2VyLm9uRW50ZXIoZSk7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSk7XG4gIH1cblxuICBzZXRPYmplY3RzKG9iamVjdHM6IFBhcnNlZE9iamVjdFtdKTogdm9pZCB7XG4gICAgdGhpcy5vYmplY3RzID0gb2JqZWN0cy5tYXAoKG8pID0+ICh7XG4gICAgICBkaXNwbGF5S2V5OiBvLmRpc3BsYXlLZXksXG4gICAgICBrZXlWYWx1ZTogby5rZXlWYWx1ZSxcbiAgICAgIGZpbGVMYWJlbDogby5maWxlTGFiZWwsXG4gICAgICBmaWxlUGF0aDogby5maWxlUGF0aCxcbiAgICAgIHByb3BlcnRpZXM6IG8ucHJvcGVydGllcyxcbiAgICB9KSk7XG4gIH1cblxuICBvblRyaWdnZXIoXG4gICAgY3Vyc29yOiBFZGl0b3JQb3NpdGlvbixcbiAgICBlZGl0b3I6IEVkaXRvcixcbiAgICBfZmlsZTogVEZpbGUgfCBudWxsXG4gICk6IEVkaXRvclN1Z2dlc3RUcmlnZ2VySW5mbyB8IG51bGwge1xuICAgIGNvbnN0IGxpbmUgPSBlZGl0b3IuZ2V0TGluZShjdXJzb3IubGluZSk7XG4gICAgY29uc3Qgc3ViID0gbGluZS5zdWJzdHJpbmcoMCwgY3Vyc29yLmNoKTtcblxuICAgIC8vIEZpbmQgdGhlIGxhc3Qge3sgdGhhdCBpc24ndCBjbG9zZWRcbiAgICBjb25zdCBsYXN0T3BlbiA9IHN1Yi5sYXN0SW5kZXhPZihcInt7XCIpO1xuICAgIGlmIChsYXN0T3BlbiA9PT0gLTEpIHJldHVybiBudWxsO1xuXG4gICAgLy8gQ2hlY2sgaXQncyBub3QgYWxyZWFkeSBjbG9zZWRcbiAgICBjb25zdCBhZnRlck9wZW4gPSBzdWIuc3Vic3RyaW5nKGxhc3RPcGVuICsgMik7XG4gICAgaWYgKGFmdGVyT3Blbi5pbmNsdWRlcyhcIn19XCIpKSByZXR1cm4gbnVsbDtcblxuICAgIGNvbnN0IHF1ZXJ5ID0gYWZ0ZXJPcGVuO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXJ0OiB7IGxpbmU6IGN1cnNvci5saW5lLCBjaDogbGFzdE9wZW4gKyAyIH0sXG4gICAgICBlbmQ6IGN1cnNvcixcbiAgICAgIHF1ZXJ5LFxuICAgIH07XG4gIH1cblxuICBnZXRTdWdnZXN0aW9ucyhjb250ZXh0OiBFZGl0b3JTdWdnZXN0Q29udGV4dCk6IE9iamVjdFN1Z2dlc3Rpb25bXSB7XG4gICAgY29uc3QgcXVlcnkgPSBjb250ZXh0LnF1ZXJ5LnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKCFxdWVyeSkgcmV0dXJuIHRoaXMub2JqZWN0cy5zbGljZSgwLCAyMCk7XG5cbiAgICByZXR1cm4gdGhpcy5vYmplY3RzXG4gICAgICAuZmlsdGVyKFxuICAgICAgICAobykgPT5cbiAgICAgICAgICBvLmRpc3BsYXlLZXkudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhxdWVyeSkgfHxcbiAgICAgICAgICBvLmtleVZhbHVlLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMocXVlcnkpXG4gICAgICApXG4gICAgICAuc2xpY2UoMCwgMjApO1xuICB9XG5cbiAgcmVuZGVyU3VnZ2VzdGlvbihzdWdnZXN0aW9uOiBPYmplY3RTdWdnZXN0aW9uLCBlbDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICBjb25zdCBjb250YWluZXIgPSBlbC5jcmVhdGVEaXYoeyBjbHM6IFwib2wtc3VnZ2VzdGlvblwiIH0pO1xuXG4gICAgY29uc3QgdGl0bGVFbCA9IGNvbnRhaW5lci5jcmVhdGVEaXYoeyBjbHM6IFwib2wtc3VnZ2VzdGlvbi10aXRsZVwiIH0pO1xuICAgIHRpdGxlRWwudGV4dENvbnRlbnQgPSBzdWdnZXN0aW9uLmRpc3BsYXlLZXk7XG5cbiAgICBjb25zdCBmaWxlRWwgPSBjb250YWluZXIuY3JlYXRlRGl2KHsgY2xzOiBcIm9sLXN1Z2dlc3Rpb24tZmlsZVwiIH0pO1xuICAgIGZpbGVFbC50ZXh0Q29udGVudCA9IHN1Z2dlc3Rpb24uZmlsZUxhYmVsO1xuICB9XG5cbiAgc2VsZWN0U3VnZ2VzdGlvbihcbiAgICBzdWdnZXN0aW9uOiBPYmplY3RTdWdnZXN0aW9uLFxuICAgIF9ldnQ6IE1vdXNlRXZlbnQgfCBLZXlib2FyZEV2ZW50XG4gICk6IHZvaWQge1xuICAgIGlmICghdGhpcy5jb250ZXh0KSByZXR1cm47XG5cbiAgICBjb25zdCBlZGl0b3IgPSB0aGlzLmNvbnRleHQuZWRpdG9yO1xuICAgIGNvbnN0IHN0YXJ0ID0gdGhpcy5jb250ZXh0LnN0YXJ0O1xuICAgIGNvbnN0IGVuZCA9IHRoaXMuY29udGV4dC5lbmQ7XG5cbiAgICAvLyBDaGVjayBpZiB9fSBhbHJlYWR5IGV4aXN0cyByaWdodCBhZnRlciB0aGUgY3Vyc29yIChhdXRvLWNsb3NlZCBieSBPYnNpZGlhbilcbiAgICBjb25zdCBsaW5lVGV4dCA9IGVkaXRvci5nZXRMaW5lKGVuZC5saW5lKTtcbiAgICBjb25zdCBhZnRlckN1cnNvciA9IGxpbmVUZXh0LnN1YnN0cmluZyhlbmQuY2gpO1xuICAgIGNvbnN0IGhhc0Nsb3NpbmcgPSBhZnRlckN1cnNvci5zdGFydHNXaXRoKFwifX1cIik7XG5cbiAgICAvLyBSZXBsYWNlIHRoZSBxdWVyeSB0ZXh0IHdpdGggdGhlIGRpc3BsYXkga2V5LCBjb25zdW1pbmcgZXhpc3RpbmcgfX0gaWYgcHJlc2VudFxuICAgIGNvbnN0IHJlcGxhY2VUbyA9IGhhc0Nsb3NpbmdcbiAgICAgID8geyBsaW5lOiBlbmQubGluZSwgY2g6IGVuZC5jaCArIDIgfVxuICAgICAgOiBlbmQ7XG4gICAgZWRpdG9yLnJlcGxhY2VSYW5nZShzdWdnZXN0aW9uLmRpc3BsYXlLZXkgKyBcIn19XCIsIHN0YXJ0LCByZXBsYWNlVG8pO1xuICB9XG59XG4iLCAiLyoqXG4gKiBDb2RlTWlycm9yIDYgZWRpdG9yIGV4dGVuc2lvbiB0aGF0IGhpZ2hsaWdodHMge3tvYmplY3QgbGlua3N9fVxuICogaW4gbGl2ZS1wcmV2aWV3IG1vZGUgdG8gbWF0Y2ggdGhlIGFwcGVhcmFuY2Ugb2YgW1t3aWtpbGlua3NdXS5cbiAqXG4gKiBVc2VzIE9ic2lkaWFuJ3Mgb3duIENTUyB2YXJpYWJsZXMgYW5kIGNsYXNzZXMgc28gdGhlIHN0eWxpbmdcbiAqIGlzIGNvbnNpc3RlbnQgd2l0aCB0aGUgbmF0aXZlIGxpbmsgYXBwZWFyYW5jZS5cbiAqL1xuXG5pbXBvcnQge1xuICBEZWNvcmF0aW9uLFxuICBEZWNvcmF0aW9uU2V0LFxuICBFZGl0b3JWaWV3LFxuICBWaWV3UGx1Z2luLFxuICBWaWV3VXBkYXRlLFxuICBrZXltYXAsXG59IGZyb20gXCJAY29kZW1pcnJvci92aWV3XCI7XG5pbXBvcnQgeyBFZGl0b3JTZWxlY3Rpb24sIFJhbmdlU2V0QnVpbGRlciB9IGZyb20gXCJAY29kZW1pcnJvci9zdGF0ZVwiO1xuXG4vKiBcdTI1MDBcdTI1MDAgRGVjb3JhdGlvbiBzcGVjcyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cblxuY29uc3QgbGlua0RlY28gPSBEZWNvcmF0aW9uLm1hcmsoeyBjbGFzczogXCJvbC1jbS1saW5rXCIgfSk7XG5jb25zdCBsaW5rRWRpdGluZ0RlY28gPSBEZWNvcmF0aW9uLm1hcmsoeyBjbGFzczogXCJvbC1jbS1saW5rLWVkaXRpbmdcIiB9KTtcblxuLyogXHUyNTAwXHUyNTAwIEJ1aWxkIGRlY29yYXRpb25zIGZvciB2aXNpYmxlIHJhbmdlcyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cblxuZnVuY3Rpb24gYnVpbGREZWNvcmF0aW9ucyh2aWV3OiBFZGl0b3JWaWV3KTogRGVjb3JhdGlvblNldCB7XG4gIGNvbnN0IGJ1aWxkZXIgPSBuZXcgUmFuZ2VTZXRCdWlsZGVyPERlY29yYXRpb24+KCk7XG4gIGNvbnN0IGN1cnNvckhlYWQgPSB2aWV3LnN0YXRlLnNlbGVjdGlvbi5tYWluLmhlYWQ7XG4gIGNvbnN0IHJlZ2V4ID0gL1xce1xceyhbXn1dKylcXH1cXH0vZztcblxuICBmb3IgKGNvbnN0IHsgZnJvbSwgdG8gfSBvZiB2aWV3LnZpc2libGVSYW5nZXMpIHtcbiAgICBjb25zdCB0ZXh0ID0gdmlldy5zdGF0ZS5zbGljZURvYyhmcm9tLCB0byk7XG4gICAgbGV0IG1hdGNoOiBSZWdFeHBFeGVjQXJyYXkgfCBudWxsO1xuXG4gICAgd2hpbGUgKChtYXRjaCA9IHJlZ2V4LmV4ZWModGV4dCkpICE9PSBudWxsKSB7XG4gICAgICBjb25zdCBzdGFydCA9IGZyb20gKyBtYXRjaC5pbmRleDtcbiAgICAgIGNvbnN0IGVuZCA9IHN0YXJ0ICsgbWF0Y2hbMF0ubGVuZ3RoO1xuXG4gICAgICAvLyBVc2UgYSBzdWJ0bGVyIHN0eWxlIHdoZW4gdGhlIGN1cnNvciBpcyBpbnNpZGUgdGhlIG1hdGNoXG4gICAgICBjb25zdCBjdXJzb3JJbnNpZGUgPSBjdXJzb3JIZWFkID49IHN0YXJ0ICYmIGN1cnNvckhlYWQgPD0gZW5kO1xuICAgICAgYnVpbGRlci5hZGQoc3RhcnQsIGVuZCwgY3Vyc29ySW5zaWRlID8gbGlua0VkaXRpbmdEZWNvIDogbGlua0RlY28pO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBidWlsZGVyLmZpbmlzaCgpO1xufVxuXG4vKiBcdTI1MDBcdTI1MDAgVmlld1BsdWdpbiBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cblxuZXhwb3J0IGNvbnN0IG9iamVjdExpbmtIaWdobGlnaHRlciA9IFZpZXdQbHVnaW4uZnJvbUNsYXNzKFxuICBjbGFzcyB7XG4gICAgZGVjb3JhdGlvbnM6IERlY29yYXRpb25TZXQ7XG5cbiAgICBjb25zdHJ1Y3Rvcih2aWV3OiBFZGl0b3JWaWV3KSB7XG4gICAgICB0aGlzLmRlY29yYXRpb25zID0gYnVpbGREZWNvcmF0aW9ucyh2aWV3KTtcbiAgICB9XG5cbiAgICB1cGRhdGUodXBkYXRlOiBWaWV3VXBkYXRlKTogdm9pZCB7XG4gICAgICBpZiAodXBkYXRlLmRvY0NoYW5nZWQgfHwgdXBkYXRlLnZpZXdwb3J0Q2hhbmdlZCB8fCB1cGRhdGUuc2VsZWN0aW9uU2V0KSB7XG4gICAgICAgIHRoaXMuZGVjb3JhdGlvbnMgPSBidWlsZERlY29yYXRpb25zKHVwZGF0ZS52aWV3KTtcbiAgICAgIH1cbiAgICB9XG4gIH0sXG4gIHtcbiAgICBkZWNvcmF0aW9uczogKHYpID0+IHYuZGVjb3JhdGlvbnMsXG4gIH1cbik7XG5cbi8qKlxuICogS2V5YmluZGluZzogaWYgeW91IGhhdmUgYSBzZWxlY3Rpb24gYW5kIHByZXNzIGB7YCwgd3JhcCBpdCBpbiBge3sgLi4uIH19YC5cbiAqIElmIHRoZXJlJ3Mgbm8gc2VsZWN0aW9uLCBsZXQgQ29kZU1pcnJvciBpbnNlcnQgYHtgIG5vcm1hbGx5LlxuICovXG5leHBvcnQgY29uc3Qgb2JqZWN0TGlua1dyYXBwZXJLZXltYXAgPSBrZXltYXAub2YoW1xuICB7XG4gICAga2V5OiBcIntcIixcbiAgICBydW46ICh2aWV3KSA9PiB7XG4gICAgICBjb25zdCBzZWwgPSB2aWV3LnN0YXRlLnNlbGVjdGlvbjtcbiAgICAgIGlmIChzZWwucmFuZ2VzLmV2ZXJ5KChyKSA9PiByLmVtcHR5KSkgcmV0dXJuIGZhbHNlO1xuXG4gICAgICBjb25zdCBjaGFuZ2VzOiB7IGZyb206IG51bWJlcjsgdG86IG51bWJlcjsgaW5zZXJ0OiBzdHJpbmcgfVtdID0gW107XG4gICAgICBjb25zdCBuZXdSYW5nZXM6IGFueVtdID0gW107XG5cbiAgICAgIGZvciAoY29uc3QgciBvZiBzZWwucmFuZ2VzKSB7XG4gICAgICAgIGNvbnN0IHRleHQgPSB2aWV3LnN0YXRlLmRvYy5zbGljZVN0cmluZyhyLmZyb20sIHIudG8pO1xuICAgICAgICBjb25zdCBpbnNlcnQgPSBge3ske3RleHR9fX1gO1xuICAgICAgICBjaGFuZ2VzLnB1c2goeyBmcm9tOiByLmZyb20sIHRvOiByLnRvLCBpbnNlcnQgfSk7XG5cbiAgICAgICAgLy8gUGxhY2UgY3Vyc29yIGluc2lkZSB0aGUgYnJhY2VzLCBzZWxlY3RpbmcgdGhlIG9yaWdpbmFsIHRleHQuXG4gICAgICAgIGNvbnN0IHN0YXJ0ID0gci5mcm9tICsgMjtcbiAgICAgICAgY29uc3QgZW5kID0gc3RhcnQgKyB0ZXh0Lmxlbmd0aDtcbiAgICAgICAgbmV3UmFuZ2VzLnB1c2goRWRpdG9yU2VsZWN0aW9uLnJhbmdlKHN0YXJ0LCBlbmQpKTtcbiAgICAgIH1cblxuICAgICAgdmlldy5kaXNwYXRjaCh7XG4gICAgICAgIGNoYW5nZXMsXG4gICAgICAgIHNlbGVjdGlvbjogRWRpdG9yU2VsZWN0aW9uLmNyZWF0ZShuZXdSYW5nZXMsIHNlbC5tYWluSW5kZXgpLFxuICAgICAgfSk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9LFxuICB9LFxuXSk7XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLElBQUFBLG1CQU9POzs7QUNtREEsU0FBUyxxQkFDZCxTQUNBLFVBQ21CO0FBQ25CLFFBQU0sUUFBUSxRQUFRLE1BQU0sSUFBSTtBQUdoQyxNQUFJLFdBQVc7QUFDZixNQUFJLE1BQU0sU0FBUyxLQUFLLE1BQU0sQ0FBQyxFQUFFLEtBQUssTUFBTSxPQUFPO0FBQ2pELGFBQVMsSUFBSSxHQUFHLElBQUksTUFBTSxRQUFRLEtBQUs7QUFDckMsVUFBSSxNQUFNLENBQUMsRUFBRSxLQUFLLE1BQU0sT0FBTztBQUM3QixtQkFBVyxJQUFJO0FBQ2Y7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFJQSxNQUFJLFVBQVU7QUFDZCxXQUFTLElBQUksVUFBVSxJQUFJLE1BQU0sUUFBUSxLQUFLO0FBQzVDLFVBQU0sVUFBVSxNQUFNLENBQUMsRUFBRSxLQUFLO0FBQzlCLFFBQUksUUFBUSxXQUFXO0FBQUc7QUFFMUIsUUFBSSxRQUFRLFdBQVcsR0FBRyxLQUFLLENBQUMsUUFBUSxTQUFTLEdBQUc7QUFBRztBQUN2RCxjQUFVO0FBQ1Y7QUFBQSxFQUNGO0FBRUEsUUFBTSxXQUFXLFFBQVEsTUFBTSxnQkFBZ0I7QUFDL0MsTUFB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LEVBQ1AsT0FBTztBQUFBLEVBQ1AsUUFBUTtBQUFBLEVBQ1IsT0FBTztBQUFBLEVBQ1AsZ0JBQWdCO0FBQUEsRUFDaEIsTUFBTTtBQUFBLEVBQ04sWUFBWTtBQUFBLEVBQ1osT0FBTztBQUFBLEVBQ1AsV0FBVztBQUFBLEVBQ1gsV0FBVztBQUFBLEVBQ1gsWUFBWTtBQUFBLEVBQ1osV0FBVztBQUFBLEVBQ1gsT0FBTztBQUFBLEVBQ1AsZ0JBQWdCO0FBQUEsRUFDaEIsVUFBVTtBQUFBLEVBQ1YsU0FBUztBQUFBLEVBQ1QsTUFBTTtBQUFBLEVBQ04sVUFBVTtBQUFBLEVBQ1YsVUFBVTtBQUFBLEVBQ1YsZUFBZTtBQUFBLEVBQ2YsVUFBVTtBQUFBLEVBQ1YsV0FBVztBQUFBLEVBQ1gsVUFBVTtBQUFBLEVBQ1YsV0FBVztBQUFBLEVBQ1gsYUFBYTtBQUFBLEVBQ2IsZ0JBQWdCO0FBQUEsRUFDaEIsWUFBWTtBQUFBLEVBQ1osWUFBWTtBQUFBLEVBQ1osU0FBUztBQUFBLEVBQ1QsWUFBWTtBQUFBLEVBQ1osY0FBYztBQUFBLEVBQ2QsZUFBZTtBQUFBLEVBQ2YsZUFBZTtBQUFBLEVBQ2YsZUFBZTtBQUFBLEVBQ2YsZUFBZTtBQUFBLEVBQ2YsWUFBWTtBQUFBLEVBQ1osVUFBVTtBQUFBLEVBQ1YsYUFBYTtBQUFBLEVBQ2IsU0FBUztBQUFBLEVBQ1QsU0FBUztBQUFBLEVBQ1QsWUFBWTtBQUFBLEVBQ1osV0FBVztBQUFBLEVBQ1gsYUFBYTtBQUFBLEVBQ2IsYUFBYTtBQUFBLEVBQ2IsU0FBUztBQUFBLEVBQ1QsV0FBVztBQUFBLEVBQ1gsWUFBWTtBQUFBLEVBQ1osTUFBTTtBQUFBLEVBQ04sV0FBVztBQUFBLEVBQ1gsTUFBTTtBQUFBLEVBQ04sT0FBTztBQUFBLEVBQ1AsYUFBYTtBQUFBLEVBQ2IsTUFBTTtBQUFBLEVBQ04sVUFBVTtBQUFBLEVBQ1YsU0FBUztBQUFBLEVBQ1QsV0FBVztBQUFBLEVBQ1gsUUFBUTtBQUFBLEVBQ1IsT0FBTztBQUFBLEVBQ1AsT0FBTztBQUFBLEVBQ1AsVUFBVTtBQUFBLEVBQ1YsZUFBZTtBQUFBLEVBQ2YsV0FBVztBQUFBLEVBQ1gsY0FBYztBQUFBLEVBQ2QsV0FBVztBQUFBLEVBQ1gsWUFBWTtBQUFBLEVBQ1osV0FBVztBQUFBLEVBQ1gsc0JBQXNCO0FBQUEsRUFDdEIsV0FBVztBQUFBLEVBQ1gsWUFBWTtBQUFBLEVBQ1osV0FBVztBQUFBLEVBQ1gsV0FBVztBQUFBLEVBQ1gsYUFBYTtBQUFBLEVBQ2IsZUFBZTtBQUFBLEVBQ2YsY0FBYztBQUFBLEVBQ2QsZ0JBQWdCO0FBQUEsRUFDaEIsZ0JBQWdCO0FBQUEsRUFDaEIsZ0JBQWdCO0FBQUEsRUFDaEIsYUFBYTtBQUFBLEVBQ2IsTUFBTTtBQUFBLEVBQ04sV0FBVztBQUFBLEVBQ1gsT0FBTztBQUFBLEVBQ1AsU0FBUztBQUFBLEVBQ1QsUUFBUTtBQUFBLEVBQ1Isa0JBQWtCO0FBQUEsRUFDbEIsWUFBWTtBQUFBLEVBQ1osY0FBYztBQUFBLEVBQ2QsY0FBYztBQUFBLEVBQ2QsZ0JBQWdCO0FBQUEsRUFDaEIsaUJBQWlCO0FBQUEsRUFDakIsbUJBQW1CO0FBQUEsRUFDbkIsaUJBQWlCO0FBQUEsRUFDakIsaUJBQWlCO0FBQUEsRUFDakIsY0FBYztBQUFBLEVBQ2QsV0FBVztBQUFBLEVBQ1gsV0FBVztBQUFBLEVBQ1gsVUFBVTtBQUFBLEVBQ1YsYUFBYTtBQUFBLEVBQ2IsTUFBTTtBQUFBLEVBQ04sU0FBUztBQUFBLEVBQ1QsT0FBTztBQUFBLEVBQ1AsV0FBVztBQUFBLEVBQ1gsUUFBUTtBQUFBLEVBQ1IsV0FBVztBQUFBLEVBQ1gsUUFBUTtBQUFBLEVBQ1IsZUFBZTtBQUFBLEVBQ2YsV0FBVztBQUFBLEVBQ1gsZUFBZTtBQUFBLEVBQ2YsZUFBZTtBQUFBLEVBQ2YsWUFBWTtBQUFBLEVBQ1osV0FBVztBQUFBLEVBQ1gsTUFBTTtBQUFBLEVBQ04sTUFBTTtBQUFBLEVBQ04sTUFBTTtBQUFBLEVBQ04sWUFBWTtBQUFBLEVBQ1osUUFBUTtBQUFBLEVBQ1IsZUFBZTtBQUFBLEVBQ2YsS0FBSztBQUFBLEVBQ0wsV0FBVztBQUFBLEVBQ1gsV0FBVztBQUFBLEVBQ1gsYUFBYTtBQUFBLEVBQ2IsUUFBUTtBQUFBLEVBQ1IsWUFBWTtBQUFBLEVBQ1osVUFBVTtBQUFBLEVBQ1YsVUFBVTtBQUFBLEVBQ1YsUUFBUTtBQUFBLEVBQ1IsUUFBUTtBQUFBLEVBQ1IsU0FBUztBQUFBLEVBQ1QsV0FBVztBQUFBLEVBQ1gsV0FBVztBQUFBLEVBQ1gsV0FBVztBQUFBLEVBQ1gsTUFBTTtBQUFBLEVBQ04sYUFBYTtBQUFBLEVBQ2IsV0FBVztBQUFBLEVBQ1gsS0FBSztBQUFBLEVBQ0wsTUFBTTtBQUFBLEVBQ04sU0FBUztBQUFBLEVBQ1QsUUFBUTtBQUFBLEVBQ1IsV0FBVztBQUFBLEVBQ1gsUUFBUTtBQUFBLEVBQ1IsT0FBTztBQUFBLEVBQ1AsT0FBTztBQUFBLEVBQ1AsWUFBWTtBQUFBLEVBQ1osUUFBUTtBQUFBLEVBQ1IsYUFBYTtBQUNmO0FBRUEsZUFBTyxPQUFPLE9BQU87QUFBQSxFQUNuQixLQUFLLFVBQVU7QUFDYixXQUFPLE9BQU8sT0FBTyxJQUFJLEtBQUssZUFBYSxNQUFNLFFBQVE7QUFBQSxFQUMzRDtBQUFBLEVBQ0EsY0FBYztBQUNaLFdBQU8sS0FBSyxJQUFJLEVBQUUsWUFBWTtBQUFBLEVBQ2hDO0FBQUEsRUFDQSxLQUFLO0FBQUE7QUFBQSxFQUNMLFdBQVc7QUFBQSxFQUNYLFlBQVk7QUFBQSxFQUNaLFdBQVc7QUFBQSxFQUNYLFdBQVc7QUFBQSxFQUNYLFVBQVU7QUFDWixDQUFDO0FBRUQsU0FBUyxrQkFBa0I7QUFDekIsU0FBTyxLQUFLLElBQUksRUFBRSxVQUFVO0FBQzlCO0FBRUEsU0FBUyxtQkFBbUI7QUFDMUIsU0FBTyxLQUFLLElBQUksRUFBRSxXQUFXO0FBQy9CO0FBRUEsU0FBUyxrQkFBa0I7QUFDekIsU0FBTyxXQUFXLElBQUksRUFBRSxVQUFVO0FBQ3BDO0FBRUEsU0FBUyxrQkFBa0I7QUFDekIsU0FBTyxLQUFLLElBQUksRUFBRSxVQUFVO0FBQzlCO0FBRWUsU0FBUixNQUF1QixRQUFRO0FBQ3BDLE1BQUlHLElBQUc7QUFDUCxZQUFVLFNBQVMsSUFBSSxLQUFLLEVBQUUsWUFBWTtBQUMxQyxVQUFRQSxLQUFJLE1BQU0sS0FBSyxNQUFNLE1BQU0sSUFBSUEsR0FBRSxDQUFDLEVBQUUsUUFBUUEsS0FBSSxTQUFTQSxHQUFFLENBQUMsR0FBRyxFQUFFLEdBQUcsTUFBTSxJQUFJLEtBQUtBLEVBQUMsSUFDdEYsTUFBTSxJQUFJLElBQUksSUFBS0EsTUFBSyxJQUFJLEtBQVFBLE1BQUssSUFBSSxLQUFRQSxNQUFLLElBQUksS0FBUUEsS0FBSSxNQUFTQSxLQUFJLE9BQVEsSUFBTUEsS0FBSSxJQUFNLENBQUMsSUFDaEgsTUFBTSxJQUFJLEtBQUtBLE1BQUssS0FBSyxLQUFNQSxNQUFLLEtBQUssS0FBTUEsTUFBSyxJQUFJLE1BQU9BLEtBQUksT0FBUSxHQUFJLElBQy9FLE1BQU0sSUFBSSxLQUFNQSxNQUFLLEtBQUssS0FBUUEsTUFBSyxJQUFJLEtBQVFBLE1BQUssSUFBSSxLQUFRQSxNQUFLLElBQUksS0FBUUEsTUFBSyxJQUFJLEtBQVFBLEtBQUksT0FBVUEsS0FBSSxPQUFRLElBQU1BLEtBQUksTUFBUSxHQUFJLElBQ3RKLFNBQ0NBLEtBQUksYUFBYSxLQUFLLE1BQU0sS0FBSyxJQUFJLElBQUlBLEdBQUUsQ0FBQyxHQUFHQSxHQUFFLENBQUMsR0FBR0EsR0FBRSxDQUFDLEdBQUcsQ0FBQyxLQUM1REEsS0FBSSxhQUFhLEtBQUssTUFBTSxLQUFLLElBQUksSUFBSUEsR0FBRSxDQUFDLElBQUksTUFBTSxLQUFLQSxHQUFFLENBQUMsSUFBSSxNQUFNLEtBQUtBLEdBQUUsQ0FBQyxJQUFJLE1BQU0sS0FBSyxDQUFDLEtBQ2hHQSxLQUFJLGNBQWMsS0FBSyxNQUFNLEtBQUssS0FBS0EsR0FBRSxDQUFDLEdBQUdBLEdBQUUsQ0FBQyxHQUFHQSxHQUFFLENBQUMsR0FBR0EsR0FBRSxDQUFDLENBQUMsS0FDN0RBLEtBQUksY0FBYyxLQUFLLE1BQU0sS0FBSyxLQUFLQSxHQUFFLENBQUMsSUFBSSxNQUFNLEtBQUtBLEdBQUUsQ0FBQyxJ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QUNGOyIsCiAgIm5hbWVzIjogWyJpbXBvcnRfb2JzaWRpYW4iLCAiaWQiLCAidHlwZSIsICJpbXBvcnRfb2JzaWRpYW4iLCAibWluIiwgIm1heCIsICJ0eXBlIiwgImMiLCAiZG9jdW1lbnQiLCAibSIsICJ4IiwgIm0iLCAibSIsICJkYXR1bSIsICJ4IiwgIm0iLCAic2VsZWN0aW9uIiwgIm0iLCAibSIsICJhIiwgIm0iLCAibSIsICJtIiwgImNyZWF0ZSIsICJjcmVhdGUiLCAicGFyc2VUeXBlbmFtZXMiLCAibSIsICJ0eXBlIiwgIndpbmRvdyIsICJkaXNwYXRjaF9kZWZhdWx0IiwgIm0iLCAiZGlzcGF0Y2hfZGVmYXVsdCIsICJzZWxlY3RfZGVmYXVsdCIsICJyb290IiwgInNlbGVjdGlvbiIsICJzZWxlY3RfZGVmYXVsdCIsICJtIiwgImEiLCAibWluIiwgIm1heCIsICJjb25zdGFudF9kZWZhdWx0IiwgIngiLCAiYSIsICJ5IiwgInkiLCAiYSIsICJjb25zdGFudF9kZWZhdWx0IiwgInkiLCAiY29sb3IiLCAicmdiIiwgInN0YXJ0IiwgImEiLCAiYSIsICJpIiwgImEiLCAiYyIsICJtIiwgImEiLCAieCIsICJub3ciLCAiaWQiLCAiaW5kZXgiLCAiZ2V0IiwgInNldCIsICJzdGFydCIsICJlbXB0eSIsICJpbnRlcnJ1cHRfZGVmYXVsdCIsICJpZCIsICJzZXQiLCAiZ2V0IiwgInRyYW5zaXRpb24iLCAiYSIsICJjIiwgImF0dHJSZW1vdmUiLCAiYXR0clJlbW92ZU5TIiwgImF0dHJDb25zdGFudCIsICJhdHRyQ29uc3RhbnROUyIsICJhdHRyRnVuY3Rpb24iLCAiYXR0ckZ1bmN0aW9uTlMiLCAiYXR0cl9kZWZhdWx0IiwgImlkIiwgImdldCIsICJpZCIsICJzZXQiLCAiZ2V0IiwgImlkIiwgInNldCIsICJnZXQiLCAiaWQiLCAic2V0IiwgImZpbHRlcl9kZWZhdWx0IiwgIm0iLCAibWVyZ2VfZGVmYXVsdCIsICJ0cmFuc2l0aW9uIiwgIm0iLCAiaWQiLCAic2V0IiwgIm9uX2RlZmF1bHQiLCAiZ2V0IiwgImlkIiwgInJlbW92ZV9kZWZhdWx0IiwgInNlbGVjdF9kZWZhdWx0IiwgImlkIiwgIm0iLCAiZ2V0IiwgInNlbGVjdEFsbF9kZWZhdWx0IiwgImlkIiwgIm0iLCAiY2hpbGRyZW4iLCAiaW5oZXJpdCIsICJnZXQiLCAiU2VsZWN0aW9uIiwgInNlbGVjdGlvbl9kZWZhdWx0IiwgInN0eWxlUmVtb3ZlIiwgInN0eWxlQ29uc3RhbnQiLCAic3R5bGVGdW5jdGlvbiIsICJpZCIsICJyZW1vdmUiLCAic2V0IiwgInN0eWxlX2RlZmF1bHQiLCAidGV4dENvbnN0YW50IiwgInRleHRGdW5jdGlvbiIsICJ0ZXh0X2RlZmF1bHQiLCAibSIsICJpbmhlcml0IiwgImdldCIsICJpZCIsICJzZXQiLCAiaWQiLCAic2VsZWN0X2RlZmF1bHQiLCAic2VsZWN0QWxsX2RlZmF1bHQiLCAiZmlsdGVyX2RlZmF1bHQiLCAibWVyZ2VfZGVmYXVsdCIsICJzZWxlY3Rpb25fZGVmYXVsdCIsICJvbl9kZWZhdWx0IiwgImF0dHJfZGVmYXVsdCIsICJzdHlsZV9kZWZhdWx0IiwgInRleHRfZGVmYXVsdCIsICJyZW1vdmVfZGVmYXVsdCIsICJpZCIsICJ0cmFuc2l0aW9uX2RlZmF1bHQiLCAibSIsICJpbnRlcnJ1cHRfZGVmYXVsdCIsICJ0cmFuc2l0aW9uX2RlZmF1bHQiLCAieCIsICJ5IiwgIngiLCAieSIsICJ4IiwgInkiLCAiZGF0YV9kZWZhdWx0IiwgIngiLCAieSIsICJ4MiIsICJ5MiIsICJ4MyIsICJ5MyIsICJyZW1vdmVfZGVmYXVsdCIsICJ4IiwgInkiLCAic2l6ZV9kZWZhdWx0IiwgIngiLCAieSIsICJkYXRhX2RlZmF1bHQiLCAicmVtb3ZlX2RlZmF1bHQiLCAic2l6ZV9kZWZhdWx0IiwgImNvbnN0YW50X2RlZmF1bHQiLCAieCIsICJjb25zdGFudF9kZWZhdWx0IiwgIngiLCAieSIsICJmaW5kIiwgImlkIiwgImNvbnN0YW50X2RlZmF1bHQiLCAieCIsICJ5IiwgIm0iLCAiaSIsICJ4IiwgInkiLCAiY29uc3RhbnRfZGVmYXVsdCIsICJ4IiwgInkiLCAibm9kZSIsICJzdHJlbmd0aCIsICJjIiwgIngyIiwgInhfZGVmYXVsdCIsICJ4IiwgImNvbnN0YW50X2RlZmF1bHQiLCAieV9kZWZhdWx0IiwgInkiLCAiY29uc3RhbnRfZGVmYXVsdCIsICJjb25zdGFudF9kZWZhdWx0IiwgIngiLCAidHlwZSIsICJ0cmFuc2Zvcm0iLCAiZGlzcGF0Y2giLCAieCIsICJ5IiwgImlkZW50aXR5IiwgIm5vcHJvcGFnYXRpb24iLCAibm9ldmVudF9kZWZhdWx0IiwgImlkZW50aXR5IiwgInRyYW5zZm9ybSIsICJ6b29tX2RlZmF1bHQiLCAiZmlsdGVyIiwgInNlbGVjdGlvbiIsICJ4IiwgInkiLCAiZXh0ZW50IiwgInRyYW5zaXRpb24iLCAiYSIsICJ0eXBlIiwgInNlbGVjdF9kZWZhdWx0IiwgIm5vZXZlbnRfZGVmYXVsdCIsICJub3Byb3BhZ2F0aW9uIiwgImV2ZW50IiwgImNvbnN0YW50X2RlZmF1bHQiLCAiaGV4IiwgIm0iLCAiYyIsICJhIiwgImlkZW50aXR5IiwgImZyYW1lIiwgInhfZGVmYXVsdCIsICJ5X2RlZmF1bHQiLCAieCIsICJ5IiwgInpvb21fZGVmYXVsdCIsICJzZWxlY3RfZGVmYXVsdCIsICJub3ciLCAiaW1wb3J0X29ic2lkaWFuIiwgInN0YXJ0IiwgInN0YXJ0Il0KfQo=
