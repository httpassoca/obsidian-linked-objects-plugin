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
var import_obsidian5 = require("obsidian");

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
  objectFileTag: "object-links",
  openObjectFilesInTableView: false
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
    new import_obsidian.Setting(containerEl).setName("Open object files in table view").setDesc(
      "When enabled, files tagged as object files will open in a table view by default. You can always switch back to the normal editor via the view menu."
    ).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.openObjectFilesInTableView).onChange(async (value) => {
        this.plugin.settings.openObjectFilesInTableView = value;
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
  linkToParent: false,
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
      this.renderToggle(contentEl, "Link to parent", this.config.linkToParent, (v) => {
        this.config.linkToParent = v;
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
    const settingItem = document.createElement("div");
    settingItem.className = "setting-item mod-slider";
    const info = document.createElement("div");
    info.className = "setting-item-info";
    const name = document.createElement("div");
    name.className = "setting-item-name";
    name.textContent = label;
    info.appendChild(name);
    const desc = document.createElement("div");
    desc.className = "setting-item-description";
    info.appendChild(desc);
    settingItem.appendChild(info);
    const control = document.createElement("div");
    control.className = "setting-item-control";
    const slider = document.createElement("input");
    slider.className = "slider";
    slider.type = "range";
    slider.dataset.ignoreSwipe = "true";
    slider.min = String(min2);
    slider.max = String(max2);
    slider.step = String(step);
    slider.value = String(value);
    slider.addEventListener("input", () => {
      onChange(parseFloat(slider.value));
    });
    control.appendChild(slider);
    settingItem.appendChild(control);
    parent.appendChild(settingItem);
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
    const tooltip = document.body.querySelector(".ol-tooltip");
    if (tooltip)
      tooltip.remove();
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
    if (this.config.linkToParent || this.config.connectOrphansToFolders) {
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
        let parentId;
        if (this.config.linkToParent && n.type === "object") {
          const sourceFileId = `file::${n.filePath}`;
          parentId = sourceFileId;
          if (!existing.has(parentId)) {
            existing.add(parentId);
            const basename = n.filePath.split("/").pop()?.replace(/\.md$/i, "") || n.filePath;
            nodesPlus.push({
              id: parentId,
              label: basename,
              type: "file",
              filePath: n.filePath,
              fileLabel: basename,
              properties: {},
              startLine: 0,
              connections: 0
            });
          }
        } else {
          const path = n.filePath || "";
          const idx = path.lastIndexOf("/");
          const folder = idx > 0 ? path.slice(0, idx) : "/";
          parentId = folderNodeId(folder);
          if (!existing.has(parentId)) {
            existing.add(parentId);
            nodesPlus.push({
              id: parentId,
              label: folderLabel(folder),
              type: "file",
              filePath: folder + "/",
              fileLabel: folderLabel(folder),
              properties: {},
              startLine: 0,
              connections: 0
            });
          }
        }
        const edgeId = [n.id, parentId].sort().join("--");
        if (!edgeSet.has(edgeId)) {
          edgeSet.add(edgeId);
          edgesPlus.push({ source: n.id, target: parentId, edgeType: "wiki" });
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
    const filterChanged = old.showFiles !== newConfig.showFiles || old.showObjects !== newConfig.showObjects || old.showWikiEdges !== newConfig.showWikiEdges || old.showObjectEdges !== newConfig.showObjectEdges || old.showOrphans !== newConfig.showOrphans || old.connectOrphansToFolders !== newConfig.connectOrphansToFolders || old.linkToParent !== newConfig.linkToParent || old.search !== newConfig.search || old.pathFilter !== newConfig.pathFilter || old.sourceFilter !== newConfig.sourceFilter;
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
    let tooltip = document.body.querySelector(".ol-tooltip");
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.className = "ol-tooltip";
      document.body.appendChild(tooltip);
    }
    tooltip.textContent = node.label;
    tooltip.style.display = "block";
  }
  moveTooltip(e, container) {
    const tooltip = document.body.querySelector(".ol-tooltip");
    if (!tooltip)
      return;
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = e.clientX + 14;
    let top = e.clientY - 10;
    if (left + tw + pad > vw) {
      left = e.clientX - tw - 14;
    }
    left = Math.max(pad, Math.min(left, vw - tw - pad));
    top = Math.max(pad, Math.min(top, vh - th - pad));
    tooltip.style.left = left + "px";
    tooltip.style.top = top + "px";
  }
  hideTooltip(container) {
    const tooltip = document.body.querySelector(".ol-tooltip");
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

// src/table-view.ts
var import_obsidian3 = require("obsidian");
var TABLE_VIEW_TYPE = "object-links-table";
var FILTER_OPS = [
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "equals", label: "is" },
  { value: "not_equals", label: "is not" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" }
];
var ObjectTableView = class extends import_obsidian3.TextFileView {
  constructor(leaf) {
    super(leaf);
    this.objects = [];
    this.columns = [];
    this.sortCol = null;
    this.sortDir = "asc";
    this.filters = [];
    this.colWidths = /* @__PURE__ */ new Map();
    this.tbodyEl = null;
    this.countEl = null;
    this.filterPanelEl = null;
    this.addAction("edit", "Edit as markdown", () => {
      if (!this.file)
        return;
      this.leaf.setViewState({
        type: "markdown",
        state: { file: this.file.path }
      });
    });
  }
  getViewType() {
    return TABLE_VIEW_TYPE;
  }
  getDisplayText() {
    return this.file?.basename ?? "Object Table";
  }
  getIcon() {
    return "table";
  }
  setViewData(data, clear) {
    this.data = data;
    const parsed = parseMultiObjectFile(data, this.file?.path ?? "");
    if (parsed) {
      this.objects = parsed.objects;
      const colSet = /* @__PURE__ */ new Set();
      for (const obj of parsed.objects) {
        for (const prop of obj.propertyOrder) {
          colSet.add(prop);
        }
      }
      this.columns = Array.from(colSet);
    } else {
      this.objects = [];
      this.columns = [];
    }
    if (clear) {
      this.sortCol = null;
      this.sortDir = "asc";
      this.filters = [];
      this.colWidths = /* @__PURE__ */ new Map();
    }
    this.renderTable();
  }
  getViewData() {
    return this.data;
  }
  clear() {
    this.data = "";
    this.objects = [];
    this.columns = [];
    this.contentEl.empty();
  }
  /* ── Rendering ──────────────────────────────────────────────────── */
  renderTable() {
    this.contentEl.empty();
    this.contentEl.addClass("ol-table-view");
    if (this.objects.length === 0) {
      this.contentEl.createDiv({
        cls: "ol-table-empty",
        text: "No objects found in this file."
      });
      return;
    }
    const toolbar = this.contentEl.createDiv({ cls: "ol-table-toolbar" });
    const addFilterBtn = toolbar.createEl("button", {
      cls: "ol-table-add-filter clickable-icon"
    });
    (0, import_obsidian3.setIcon)(addFilterBtn, "filter");
    addFilterBtn.addEventListener("click", () => this.addFilter());
    this.countEl = toolbar.createDiv({ cls: "ol-table-count" });
    this.filterPanelEl = this.contentEl.createDiv({ cls: "ol-filter-panel" });
    this.renderFilterPanel();
    const wrapper = this.contentEl.createDiv({ cls: "ol-table-wrapper" });
    const table = wrapper.createEl("table", { cls: "ol-table" });
    table.style.tableLayout = "fixed";
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    for (const col of this.columns) {
      const th = headerRow.createEl("th");
      th.dataset.col = col;
      const storedWidth = this.colWidths.get(col);
      if (storedWidth)
        th.style.width = storedWidth + "px";
      const inner = th.createDiv({ cls: "ol-th-inner" });
      inner.createSpan({ cls: "ol-th-label", text: col });
      const arrow = inner.createSpan({ cls: "ol-th-arrow" });
      if (this.sortCol === col) {
        arrow.textContent = this.sortDir === "asc" ? " \u25B2" : " \u25BC";
        th.addClass("ol-th-sorted");
      }
      let didResize = false;
      inner.addEventListener("click", () => {
        if (didResize) {
          didResize = false;
          return;
        }
        if (this.sortCol === col) {
          this.sortDir = this.sortDir === "asc" ? "desc" : "asc";
        } else {
          this.sortCol = col;
          this.sortDir = "asc";
        }
        headerRow.querySelectorAll("th").forEach((el) => {
          el.removeClass("ol-th-sorted");
          const a2 = el.querySelector(".ol-th-arrow");
          if (a2)
            a2.textContent = "";
        });
        th.addClass("ol-th-sorted");
        arrow.textContent = this.sortDir === "asc" ? " \u25B2" : " \u25BC";
        this.renderRows();
      });
      const handle = th.createDiv({ cls: "ol-th-resize" });
      handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startW = th.offsetWidth;
        const onMove = (ev) => {
          const newW = Math.max(50, startW + ev.clientX - startX);
          th.style.width = newW + "px";
          didResize = true;
        };
        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          this.colWidths.set(col, th.offsetWidth);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
    }
    this.tbodyEl = table.createEl("tbody");
    this.renderRows();
  }
  renderRows() {
    if (!this.tbodyEl)
      return;
    this.tbodyEl.empty();
    let rows = [...this.objects];
    for (const f of this.filters) {
      rows = rows.filter((obj) => this.matchesFilter(obj, f));
    }
    if (this.sortCol) {
      const col = this.sortCol;
      const dir = this.sortDir === "asc" ? 1 : -1;
      rows.sort((a2, b) => {
        const va = a2.properties[col] || "";
        const vb = b.properties[col] || "";
        const na = Number(va);
        const nb = Number(vb);
        if (!isNaN(na) && !isNaN(nb))
          return (na - nb) * dir;
        return va.localeCompare(vb) * dir;
      });
    }
    for (const obj of rows) {
      const tr = this.tbodyEl.createEl("tr");
      for (const col of this.columns) {
        const td = tr.createEl("td");
        const span = td.createSpan({ cls: "ol-td-text" });
        span.textContent = obj.properties[col] || "";
        span.title = obj.properties[col] || "";
      }
    }
    if (this.countEl) {
      this.countEl.textContent = `${rows.length} of ${this.objects.length}`;
    }
  }
  /* ── Property Filters (Notion-style) ────────────────────────────── */
  addFilter() {
    if (this.columns.length === 0)
      return;
    this.filters.push({
      column: this.columns[0],
      op: "contains",
      value: ""
    });
    this.renderFilterPanel();
  }
  renderFilterPanel() {
    if (!this.filterPanelEl)
      return;
    this.filterPanelEl.empty();
    if (this.filters.length === 0) {
      this.filterPanelEl.style.display = "none";
      return;
    }
    this.filterPanelEl.style.display = "";
    for (let i = 0; i < this.filters.length; i++) {
      const f = this.filters[i];
      const row = this.filterPanelEl.createDiv({ cls: "ol-filter-row" });
      const colSelect = row.createEl("select", { cls: "ol-filter-select" });
      for (const col of this.columns) {
        const opt = colSelect.createEl("option", { text: col, value: col });
        if (col === f.column)
          opt.selected = true;
      }
      colSelect.addEventListener("change", () => {
        f.column = colSelect.value;
        this.renderRows();
      });
      const opSelect = row.createEl("select", { cls: "ol-filter-select" });
      for (const op of FILTER_OPS) {
        const opt = opSelect.createEl("option", { text: op.label, value: op.value });
        if (op.value === f.op)
          opt.selected = true;
      }
      opSelect.addEventListener("change", () => {
        f.op = opSelect.value;
        this.renderFilterPanel();
        this.renderRows();
      });
      if (f.op !== "is_empty" && f.op !== "is_not_empty") {
        const valInput = row.createEl("input", {
          cls: "ol-filter-input",
          type: "text",
          placeholder: "value\u2026"
        });
        valInput.value = f.value;
        valInput.addEventListener("input", () => {
          f.value = valInput.value;
          this.renderRows();
        });
      }
      const removeBtn = row.createEl("button", {
        cls: "ol-filter-remove clickable-icon"
      });
      (0, import_obsidian3.setIcon)(removeBtn, "x");
      const idx = i;
      removeBtn.addEventListener("click", () => {
        this.filters.splice(idx, 1);
        this.renderFilterPanel();
        this.renderRows();
      });
    }
  }
  matchesFilter(obj, f) {
    const val = (obj.properties[f.column] || "").toLowerCase();
    const fv = f.value.toLowerCase();
    switch (f.op) {
      case "contains":
        return val.includes(fv);
      case "not_contains":
        return !val.includes(fv);
      case "equals":
        return val === fv;
      case "not_equals":
        return val !== fv;
      case "is_empty":
        return val === "";
      case "is_not_empty":
        return val !== "";
    }
  }
};

// src/suggest.ts
var import_obsidian4 = require("obsidian");
var ObjectLinkSuggest = class extends import_obsidian4.EditorSuggest {
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
var ObjectLinksPlugin = class extends import_obsidian5.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.graphData = null;
    this.suggestProvider = null;
    this.allObjects = [];
    /** Map: lowercase key value -> ParsedObject (for quick lookups) */
    this.objectIndex = /* @__PURE__ */ new Map();
    // ── Inject table-view button ─────────────────────────────────────
    /** Set of leaf IDs where the file is known to be an object-links file */
    this.knownObjectLeaves = /* @__PURE__ */ new Set();
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
    this.registerView(TABLE_VIEW_TYPE, (leaf) => new ObjectTableView(leaf));
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
    this.addCommand({
      id: "open-as-table",
      name: "Open current file as table",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md")
          return false;
        const leaf = this.app.workspace.activeLeaf;
        if (!leaf)
          return false;
        if (leaf.view.getViewType() === TABLE_VIEW_TYPE)
          return false;
        if (checking)
          return true;
        leaf.setViewState({
          type: TABLE_VIEW_TYPE,
          state: { file: file.path }
        });
        return true;
      }
    });
    this.addCommand({
      id: "open-as-markdown",
      name: "Switch back to editor",
      checkCallback: (checking) => {
        const leaf = this.app.workspace.activeLeaf;
        if (!leaf || leaf.view.getViewType() !== TABLE_VIEW_TYPE)
          return false;
        if (checking)
          return true;
        const file = this.app.workspace.getActiveFile();
        if (!file)
          return false;
        leaf.setViewState({
          type: "markdown",
          state: { file: file.path }
        });
        return true;
      }
    });
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!file || !(file instanceof import_obsidian5.TFile) || file.extension !== "md")
          return;
        if (!this.settings.openObjectFilesInTableView)
          return;
        const leaf = this.app.workspace.getActiveViewOfType(import_obsidian5.TextFileView)?.leaf ?? this.app.workspace.activeLeaf;
        if (!leaf)
          return;
        if (leaf.view.getViewType() === TABLE_VIEW_TYPE)
          return;
        this.app.vault.read(file).then((content) => {
          const tag = this.settings.objectFileTag.trim();
          if (tag && !this.hasFileTag(content, tag))
            return;
          if (!parseMultiObjectFile(content, file.path))
            return;
          leaf.setViewState({
            type: TABLE_VIEW_TYPE,
            state: { file: file.path }
          });
        });
      })
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.injectTableViewButtons();
      })
    );
    this.app.workspace.onLayoutReady(() => {
      this.fullRefresh();
    });
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof import_obsidian5.TFile && file.extension === "md") {
          this.debounceRefresh();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof import_obsidian5.TFile && file.extension === "md") {
          this.debounceRefresh();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof import_obsidian5.TFile && file.extension === "md") {
          this.debounceRefresh();
        }
      })
    );
  }
  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(TABLE_VIEW_TYPE);
    document.querySelectorAll(".ol-table-view-btn").forEach((el) => el.remove());
  }
  injectTableViewButtons() {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const actions = leaf.view.containerEl?.querySelector(".view-actions");
      if (!actions || actions.querySelector(".ol-table-view-btn"))
        continue;
      const file = leaf.view.file;
      if (!file || file.extension !== "md")
        continue;
      const leafId = leaf.id ?? file.path;
      if (!this.knownObjectLeaves.has(leafId)) {
        this.app.vault.read(file).then((content) => {
          const tag = this.settings.objectFileTag.trim();
          if (tag && !this.hasFileTag(content, tag))
            return;
          if (!parseMultiObjectFile(content, file.path))
            return;
          this.knownObjectLeaves.add(leafId);
          this.injectTableViewButtons();
        });
        continue;
      }
      const btn = document.createElement("button");
      btn.className = "clickable-icon view-action ol-table-view-btn";
      btn.setAttribute("aria-label", "Open as table");
      (0, import_obsidian5.setIcon)(btn, "table");
      btn.addEventListener("click", () => {
        leaf.setViewState({
          type: TABLE_VIEW_TYPE,
          state: { file: file.path }
        });
      });
      actions.insertBefore(btn, actions.firstChild);
    }
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
      new import_obsidian5.Notice(
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
            new import_obsidian5.Notice(`Object "${target}" not found`);
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
    if (!(file instanceof import_obsidian5.TFile)) {
      new import_obsidian5.Notice(`File not found: ${filePath}`);
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
    if (!(file instanceof import_obsidian5.TFile)) {
      new import_obsidian5.Notice(`File not found: ${filePath}`);
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
    const view = this.app.workspace.getActiveViewOfType(import_obsidian5.MarkdownView);
    const editor = view?.editor;
    if (!editor) {
      new import_obsidian5.Notice("Object Links: No active editor");
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
      new import_obsidian5.Notice(`File not found: ${target}`);
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
      new import_obsidian5.Notice(`Object "${target}" not found`);
      return;
    }
    new import_obsidian5.Notice("No link under cursor");
  }
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL3BhcnNlci50cyIsICJzcmMvZ3JhcGgtZGF0YS50cyIsICJzcmMvZ3JhcGgtdmlldy50cyIsICJzcmMvc2V0dGluZ3MudHMiLCAibm9kZV9tb2R1bGVzL2QzLWRpc3BhdGNoL3NyYy9kaXNwYXRjaC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9uYW1lc3BhY2VzLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL25hbWVzcGFjZS5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9jcmVhdG9yLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdG9yLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9zZWxlY3QuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvYXJyYXkuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0b3JBbGwuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL3NlbGVjdEFsbC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9tYXRjaGVyLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9zZWxlY3RDaGlsZC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vc2VsZWN0Q2hpbGRyZW4uanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2ZpbHRlci5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vc3BhcnNlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9lbnRlci5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9jb25zdGFudC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vZGF0YS5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vZXhpdC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vam9pbi5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vbWVyZ2UuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL29yZGVyLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9zb3J0LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9jYWxsLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9ub2Rlcy5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vbm9kZS5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vc2l6ZS5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vZW1wdHkuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2VhY2guanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2F0dHIuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvd2luZG93LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9zdHlsZS5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vcHJvcGVydHkuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2NsYXNzZWQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL3RleHQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2h0bWwuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL3JhaXNlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9sb3dlci5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vYXBwZW5kLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9pbnNlcnQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL3JlbW92ZS5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vY2xvbmUuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2RhdHVtLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9vbi5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vZGlzcGF0Y2guanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2l0ZXJhdG9yLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9pbmRleC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3QuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc291cmNlRXZlbnQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvcG9pbnRlci5qcyIsICJub2RlX21vZHVsZXMvZDMtZHJhZy9zcmMvbm9ldmVudC5qcyIsICJub2RlX21vZHVsZXMvZDMtZHJhZy9zcmMvbm9kcmFnLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1jb2xvci9zcmMvZGVmaW5lLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1jb2xvci9zcmMvY29sb3IuanMiLCAibm9kZV9tb2R1bGVzL2QzLWludGVycG9sYXRlL3NyYy9iYXNpcy5qcyIsICJub2RlX21vZHVsZXMvZDMtaW50ZXJwb2xhdGUvc3JjL2Jhc2lzQ2xvc2VkLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1pbnRlcnBvbGF0ZS9zcmMvY29uc3RhbnQuanMiLCAibm9kZV9tb2R1bGVzL2QzLWludGVycG9sYXRlL3NyYy9jb2xvci5qcyIsICJub2RlX21vZHVsZXMvZDMtaW50ZXJwb2xhdGUvc3JjL3JnYi5qcyIsICJub2RlX21vZHVsZXMvZDMtaW50ZXJwb2xhdGUvc3JjL251bWJlci5qcyIsICJub2RlX21vZHVsZXMvZDMtaW50ZXJwb2xhdGUvc3JjL3N0cmluZy5qcyIsICJub2RlX21vZHVsZXMvZDMtaW50ZXJwb2xhdGUvc3JjL3RyYW5zZm9ybS9kZWNvbXBvc2UuanMiLCAibm9kZV9tb2R1bGVzL2QzLWludGVycG9sYXRlL3NyYy90cmFuc2Zvcm0vcGFyc2UuanMiLCAibm9kZV9tb2R1bGVzL2QzLWludGVycG9sYXRlL3NyYy90cmFuc2Zvcm0vaW5kZXguanMiLCAibm9kZV9tb2R1bGVzL2QzLWludGVycG9sYXRlL3NyYy96b29tLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10aW1lci9zcmMvdGltZXIuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRpbWVyL3NyYy90aW1lb3V0LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy90cmFuc2l0aW9uL3NjaGVkdWxlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy9pbnRlcnJ1cHQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3NlbGVjdGlvbi9pbnRlcnJ1cHQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vdHdlZW4uanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vaW50ZXJwb2xhdGUuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vYXR0ci5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvdHJhbnNpdGlvbi9hdHRyVHdlZW4uanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vZGVsYXkuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vZHVyYXRpb24uanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vZWFzZS5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvdHJhbnNpdGlvbi9lYXNlVmFyeWluZy5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvdHJhbnNpdGlvbi9maWx0ZXIuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vbWVyZ2UuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vb24uanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vcmVtb3ZlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy90cmFuc2l0aW9uL3NlbGVjdC5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvdHJhbnNpdGlvbi9zZWxlY3RBbGwuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vc2VsZWN0aW9uLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy90cmFuc2l0aW9uL3N0eWxlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy90cmFuc2l0aW9uL3N0eWxlVHdlZW4uanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vdGV4dC5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvdHJhbnNpdGlvbi90ZXh0VHdlZW4uanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vdHJhbnNpdGlvbi5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvdHJhbnNpdGlvbi9lbmQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vaW5kZXguanMiLCAibm9kZV9tb2R1bGVzL2QzLWVhc2Uvc3JjL2N1YmljLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy9zZWxlY3Rpb24vdHJhbnNpdGlvbi5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvc2VsZWN0aW9uL2luZGV4LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1icnVzaC9zcmMvYnJ1c2guanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9hZGQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9jb3Zlci5qcyIsICJub2RlX21vZHVsZXMvZDMtcXVhZHRyZWUvc3JjL2RhdGEuanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9leHRlbnQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9xdWFkLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1xdWFkdHJlZS9zcmMvZmluZC5qcyIsICJub2RlX21vZHVsZXMvZDMtcXVhZHRyZWUvc3JjL3JlbW92ZS5qcyIsICJub2RlX21vZHVsZXMvZDMtcXVhZHRyZWUvc3JjL3Jvb3QuanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9zaXplLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1xdWFkdHJlZS9zcmMvdmlzaXQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy92aXNpdEFmdGVyLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1xdWFkdHJlZS9zcmMveC5qcyIsICJub2RlX21vZHVsZXMvZDMtcXVhZHRyZWUvc3JjL3kuanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9xdWFkdHJlZS5qcyIsICJub2RlX21vZHVsZXMvZDMtZm9yY2Uvc3JjL2NvbnN0YW50LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1mb3JjZS9zcmMvamlnZ2xlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1mb3JjZS9zcmMvY29sbGlkZS5qcyIsICJub2RlX21vZHVsZXMvZDMtZm9yY2Uvc3JjL2xpbmsuanMiLCAibm9kZV9tb2R1bGVzL2QzLWZvcmNlL3NyYy9sY2cuanMiLCAibm9kZV9tb2R1bGVzL2QzLWZvcmNlL3NyYy9zaW11bGF0aW9uLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1mb3JjZS9zcmMvbWFueUJvZHkuanMiLCAibm9kZV9tb2R1bGVzL2QzLWZvcmNlL3NyYy94LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1mb3JjZS9zcmMveS5qcyIsICJub2RlX21vZHVsZXMvZDMtem9vbS9zcmMvY29uc3RhbnQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXpvb20vc3JjL2V2ZW50LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy16b29tL3NyYy90cmFuc2Zvcm0uanMiLCAibm9kZV9tb2R1bGVzL2QzLXpvb20vc3JjL25vZXZlbnQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXpvb20vc3JjL3pvb20uanMiLCAic3JjL3RhYmxlLXZpZXcudHMiLCAic3JjL3N1Z2dlc3QudHMiLCAic3JjL2VkaXRvci1leHRlbnNpb24udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7XG4gIE1hcmtkb3duUG9zdFByb2Nlc3NvckNvbnRleHQsXG4gIE1hcmtkb3duVmlldyxcbiAgTm90aWNlLFxuICBQbHVnaW4sXG4gIFRleHRGaWxlVmlldyxcbiAgVEZpbGUsXG4gIFdvcmtzcGFjZUxlYWYsXG4gIHNldEljb24sXG59IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0IHtcbiAgcGFyc2VNdWx0aU9iamVjdEZpbGUsXG4gIFBhcnNlZEZpbGUsXG4gIFBhcnNlZE9iamVjdCxcbiAgZ2V0U2Vjb25kUHJvcGVydHksXG59IGZyb20gXCIuL3BhcnNlclwiO1xuaW1wb3J0IHsgYnVpbGRHcmFwaCwgR3JhcGhEYXRhLCBWYXVsdEZpbGUgfSBmcm9tIFwiLi9ncmFwaC1kYXRhXCI7XG5pbXBvcnQgeyBHcmFwaFZpZXcsIFZJRVdfVFlQRSB9IGZyb20gXCIuL2dyYXBoLXZpZXdcIjtcbmltcG9ydCB7IE9iamVjdFRhYmxlVmlldywgVEFCTEVfVklFV19UWVBFIH0gZnJvbSBcIi4vdGFibGUtdmlld1wiO1xuaW1wb3J0IHsgT2JqZWN0TGlua1N1Z2dlc3QgfSBmcm9tIFwiLi9zdWdnZXN0XCI7XG5pbXBvcnQgeyBvYmplY3RMaW5rSGlnaGxpZ2h0ZXIsIG9iamVjdExpbmtXcmFwcGVyS2V5bWFwIH0gZnJvbSBcIi4vZWRpdG9yLWV4dGVuc2lvblwiO1xuaW1wb3J0IHtcbiAgT2JqZWN0TGlua3NTZXR0aW5ncyxcbiAgREVGQVVMVF9TRVRUSU5HUyxcbiAgT2JqZWN0TGlua3NTZXR0aW5nVGFiLFxufSBmcm9tIFwiLi9zZXR0aW5nc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBPYmplY3RMaW5rc1BsdWdpbiBleHRlbmRzIFBsdWdpbiB7XG4gIHNldHRpbmdzOiBPYmplY3RMaW5rc1NldHRpbmdzID0gREVGQVVMVF9TRVRUSU5HUztcbiAgcHJpdmF0ZSBncmFwaERhdGE6IEdyYXBoRGF0YSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHN1Z2dlc3RQcm92aWRlcjogT2JqZWN0TGlua1N1Z2dlc3QgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBhbGxPYmplY3RzOiBQYXJzZWRPYmplY3RbXSA9IFtdO1xuICAvKiogTWFwOiBsb3dlcmNhc2Uga2V5IHZhbHVlIC0+IFBhcnNlZE9iamVjdCAoZm9yIHF1aWNrIGxvb2t1cHMpICovXG4gIHByaXZhdGUgb2JqZWN0SW5kZXg6IE1hcDxzdHJpbmcsIFBhcnNlZE9iamVjdD4gPSBuZXcgTWFwKCk7XG5cbiAgYXN5bmMgb25sb2FkKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIFx1MjUwMFx1MjUwMCBMb2FkIHNldHRpbmdzIFx1MjUwMFx1MjUwMFxuICAgIGF3YWl0IHRoaXMubG9hZFNldHRpbmdzKCk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgU2V0dGluZ3MgdGFiIFx1MjUwMFx1MjUwMFxuICAgIHRoaXMuYWRkU2V0dGluZ1RhYihuZXcgT2JqZWN0TGlua3NTZXR0aW5nVGFiKHRoaXMuYXBwLCB0aGlzKSk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgUmVnaXN0ZXIgdmlldyBcdTI1MDBcdTI1MDBcbiAgICB0aGlzLnJlZ2lzdGVyVmlldyhWSUVXX1RZUEUsIChsZWFmKSA9PiB7XG4gICAgICBjb25zdCB2aWV3ID0gbmV3IEdyYXBoVmlldyhsZWFmKTtcbiAgICAgIHZpZXcubmF2aWdhdGVUb09iamVjdCA9IChmaWxlUGF0aCwgc3RhcnRMaW5lKSA9PlxuICAgICAgICB0aGlzLmdvVG9PYmplY3QoZmlsZVBhdGgsIHN0YXJ0TGluZSk7XG4gICAgICB2aWV3Lm5hdmlnYXRlVG9GaWxlID0gKGZpbGVQYXRoKSA9PiB0aGlzLmdvVG9GaWxlKGZpbGVQYXRoKTtcbiAgICAgIHJldHVybiB2aWV3O1xuICAgIH0pO1xuXG4gICAgLy8gXHUyNTAwXHUyNTAwIFJlZ2lzdGVyIHRhYmxlIHZpZXcgXHUyNTAwXHUyNTAwXG4gICAgdGhpcy5yZWdpc3RlclZpZXcoVEFCTEVfVklFV19UWVBFLCAobGVhZikgPT4gbmV3IE9iamVjdFRhYmxlVmlldyhsZWFmKSk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgUmVnaXN0ZXIgc3VnZ2VzdCBwcm92aWRlciBcdTI1MDBcdTI1MDBcbiAgICB0aGlzLnN1Z2dlc3RQcm92aWRlciA9IG5ldyBPYmplY3RMaW5rU3VnZ2VzdCh0aGlzLmFwcCk7XG4gICAgdGhpcy5yZWdpc3RlckVkaXRvclN1Z2dlc3QodGhpcy5zdWdnZXN0UHJvdmlkZXIpO1xuXG4gICAgLy8gXHUyNTAwXHUyNTAwIFJlZ2lzdGVyIENNNiBlZGl0b3IgZXh0ZW5zaW9uczogaGlnaGxpZ2h0aW5nICsgc2VsZWN0aW9uIHdyYXBwZXIgXHUyNTAwXHUyNTAwXG4gICAgdGhpcy5yZWdpc3RlckVkaXRvckV4dGVuc2lvbihbb2JqZWN0TGlua0hpZ2hsaWdodGVyLCBvYmplY3RMaW5rV3JhcHBlcktleW1hcF0pO1xuXG4gICAgLy8gXHUyNTAwXHUyNTAwIE1hcmtkb3duIHBvc3QtcHJvY2Vzc29yOiByZW5kZXIge3tvYmplY3R9fSBhcyBjbGlja2FibGUgbGlua3MgXHUyNTAwXHUyNTAwXG4gICAgdGhpcy5yZWdpc3Rlck1hcmtkb3duUG9zdFByb2Nlc3NvcihcbiAgICAgIChlbDogSFRNTEVsZW1lbnQsIGN0eDogTWFya2Rvd25Qb3N0UHJvY2Vzc29yQ29udGV4dCkgPT4ge1xuICAgICAgICB0aGlzLnByb2Nlc3NPYmplY3RMaW5rcyhlbCk7XG4gICAgICB9XG4gICAgKTtcblxuICAgIC8vIFx1MjUwMFx1MjUwMCBSaWJib24gaWNvbiBcdTI1MDBcdTI1MDBcbiAgICB0aGlzLmFkZFJpYmJvbkljb24oXCJnaXQtZm9ya1wiLCBcIk9wZW4gT2JqZWN0IExpbmtzXCIsICgpID0+IHtcbiAgICAgIHRoaXMuYWN0aXZhdGVWaWV3KCk7XG4gICAgfSk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgQ29tbWFuZHMgXHUyNTAwXHUyNTAwXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcIm9wZW4tb2wtZ3JhcGhcIixcbiAgICAgIG5hbWU6IFwiT3BlbiBncmFwaCB2aWV3XCIsXG4gICAgICBjYWxsYmFjazogKCkgPT4gdGhpcy5hY3RpdmF0ZVZpZXcoKSxcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJyZWZyZXNoLW9sLWdyYXBoXCIsXG4gICAgICBuYW1lOiBcIlJlZnJlc2ggZ3JhcGhcIixcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB0aGlzLmZ1bGxSZWZyZXNoKCksXG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwib3Blbi11bmRlci1jdXJzb3JcIixcbiAgICAgIG5hbWU6IFwiT3BlbiBsaW5rIHVuZGVyIGN1cnNvclwiLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHRoaXMub3BlblVuZGVyQ3Vyc29yKCksXG4gICAgICBob3RrZXlzOiBbeyBtb2RpZmllcnM6IFtcIk1vZFwiXSwga2V5OiBcIkVudGVyXCIgfV0sXG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwib3Blbi1hcy10YWJsZVwiLFxuICAgICAgbmFtZTogXCJPcGVuIGN1cnJlbnQgZmlsZSBhcyB0YWJsZVwiLFxuICAgICAgY2hlY2tDYWxsYmFjazogKGNoZWNraW5nKSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpO1xuICAgICAgICBpZiAoIWZpbGUgfHwgZmlsZS5leHRlbnNpb24gIT09IFwibWRcIikgcmV0dXJuIGZhbHNlO1xuICAgICAgICBjb25zdCBsZWFmID0gdGhpcy5hcHAud29ya3NwYWNlLmFjdGl2ZUxlYWY7XG4gICAgICAgIGlmICghbGVhZikgcmV0dXJuIGZhbHNlO1xuICAgICAgICBpZiAobGVhZi52aWV3LmdldFZpZXdUeXBlKCkgPT09IFRBQkxFX1ZJRVdfVFlQRSkgcmV0dXJuIGZhbHNlO1xuICAgICAgICBpZiAoY2hlY2tpbmcpIHJldHVybiB0cnVlO1xuICAgICAgICBsZWFmLnNldFZpZXdTdGF0ZSh7XG4gICAgICAgICAgdHlwZTogVEFCTEVfVklFV19UWVBFLFxuICAgICAgICAgIHN0YXRlOiB7IGZpbGU6IGZpbGUucGF0aCB9LFxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcIm9wZW4tYXMtbWFya2Rvd25cIixcbiAgICAgIG5hbWU6IFwiU3dpdGNoIGJhY2sgdG8gZWRpdG9yXCIsXG4gICAgICBjaGVja0NhbGxiYWNrOiAoY2hlY2tpbmcpID0+IHtcbiAgICAgICAgY29uc3QgbGVhZiA9IHRoaXMuYXBwLndvcmtzcGFjZS5hY3RpdmVMZWFmO1xuICAgICAgICBpZiAoIWxlYWYgfHwgbGVhZi52aWV3LmdldFZpZXdUeXBlKCkgIT09IFRBQkxFX1ZJRVdfVFlQRSkgcmV0dXJuIGZhbHNlO1xuICAgICAgICBpZiAoY2hlY2tpbmcpIHJldHVybiB0cnVlO1xuICAgICAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcbiAgICAgICAgaWYgKCFmaWxlKSByZXR1cm4gZmFsc2U7XG4gICAgICAgIGxlYWYuc2V0Vmlld1N0YXRlKHtcbiAgICAgICAgICB0eXBlOiBcIm1hcmtkb3duXCIsXG4gICAgICAgICAgc3RhdGU6IHsgZmlsZTogZmlsZS5wYXRoIH0sXG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgQXV0by1vcGVuIG9iamVjdCBmaWxlcyBpbiB0YWJsZSB2aWV3IFx1MjUwMFx1MjUwMFxuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbihcImZpbGUtb3BlblwiLCAoZmlsZSkgPT4ge1xuICAgICAgICBpZiAoIWZpbGUgfHwgIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpIHx8IGZpbGUuZXh0ZW5zaW9uICE9PSBcIm1kXCIpIHJldHVybjtcbiAgICAgICAgaWYgKCF0aGlzLnNldHRpbmdzLm9wZW5PYmplY3RGaWxlc0luVGFibGVWaWV3KSByZXR1cm47XG5cbiAgICAgICAgY29uc3QgbGVhZiA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKFRleHRGaWxlVmlldyBhcyBhbnkpPy5sZWFmXG4gICAgICAgICAgPz8gdGhpcy5hcHAud29ya3NwYWNlLmFjdGl2ZUxlYWY7XG4gICAgICAgIGlmICghbGVhZikgcmV0dXJuO1xuXG4gICAgICAgIC8vIERvbid0IHN3aXRjaCBpZiBhbHJlYWR5IGluIHRhYmxlIHZpZXdcbiAgICAgICAgaWYgKGxlYWYudmlldy5nZXRWaWV3VHlwZSgpID09PSBUQUJMRV9WSUVXX1RZUEUpIHJldHVybjtcblxuICAgICAgICAvLyBDaGVjayBpZiB0aGlzIGlzIGFuIG9iamVjdC1saW5rcyBmaWxlIChhc3luYylcbiAgICAgICAgdGhpcy5hcHAudmF1bHQucmVhZChmaWxlKS50aGVuKChjb250ZW50KSA9PiB7XG4gICAgICAgICAgY29uc3QgdGFnID0gdGhpcy5zZXR0aW5ncy5vYmplY3RGaWxlVGFnLnRyaW0oKTtcbiAgICAgICAgICBpZiAodGFnICYmICF0aGlzLmhhc0ZpbGVUYWcoY29udGVudCwgdGFnKSkgcmV0dXJuO1xuICAgICAgICAgIGlmICghcGFyc2VNdWx0aU9iamVjdEZpbGUoY29udGVudCwgZmlsZS5wYXRoKSkgcmV0dXJuO1xuXG4gICAgICAgICAgbGVhZi5zZXRWaWV3U3RhdGUoe1xuICAgICAgICAgICAgdHlwZTogVEFCTEVfVklFV19UWVBFLFxuICAgICAgICAgICAgc3RhdGU6IHsgZmlsZTogZmlsZS5wYXRoIH0sXG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gXHUyNTAwXHUyNTAwIEluamVjdCB0YWJsZS12aWV3IGJ1dHRvbiBpbnRvIG1hcmtkb3duIGxlYXZlcyBmb3Igb2JqZWN0LWxpbmtzIGZpbGVzIFx1MjUwMFx1MjUwMFxuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgKCkgPT4ge1xuICAgICAgICB0aGlzLmluamVjdFRhYmxlVmlld0J1dHRvbnMoKTtcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIFx1MjUwMFx1MjUwMCBJbml0aWFsIHNjYW4gb24gbGF5b3V0IHJlYWR5IFx1MjUwMFx1MjUwMFxuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcbiAgICAgIHRoaXMuZnVsbFJlZnJlc2goKTtcbiAgICB9KTtcblxuICAgIC8vIFx1MjUwMFx1MjUwMCBGaWxlIHdhdGNoZXJzIFx1MjUwMFx1MjUwMFxuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLnZhdWx0Lm9uKFwibW9kaWZ5XCIsIChmaWxlKSA9PiB7XG4gICAgICAgIGlmIChmaWxlIGluc3RhbmNlb2YgVEZpbGUgJiYgZmlsZS5leHRlbnNpb24gPT09IFwibWRcIikge1xuICAgICAgICAgIHRoaXMuZGVib3VuY2VSZWZyZXNoKCk7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgKTtcbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICB0aGlzLmFwcC52YXVsdC5vbihcImNyZWF0ZVwiLCAoZmlsZSkgPT4ge1xuICAgICAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGaWxlICYmIGZpbGUuZXh0ZW5zaW9uID09PSBcIm1kXCIpIHtcbiAgICAgICAgICB0aGlzLmRlYm91bmNlUmVmcmVzaCgpO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICk7XG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAudmF1bHQub24oXCJkZWxldGVcIiwgKGZpbGUpID0+IHtcbiAgICAgICAgaWYgKGZpbGUgaW5zdGFuY2VvZiBURmlsZSAmJiBmaWxlLmV4dGVuc2lvbiA9PT0gXCJtZFwiKSB7XG4gICAgICAgICAgdGhpcy5kZWJvdW5jZVJlZnJlc2goKTtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICApO1xuICB9XG5cbiAgb251bmxvYWQoKTogdm9pZCB7XG4gICAgdGhpcy5hcHAud29ya3NwYWNlLmRldGFjaExlYXZlc09mVHlwZShWSUVXX1RZUEUpO1xuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5kZXRhY2hMZWF2ZXNPZlR5cGUoVEFCTEVfVklFV19UWVBFKTtcbiAgICAvLyBSZW1vdmUgaW5qZWN0ZWQgYnV0dG9uc1xuICAgIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoXCIub2wtdGFibGUtdmlldy1idG5cIikuZm9yRWFjaCgoZWwpID0+IGVsLnJlbW92ZSgpKTtcbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCBJbmplY3QgdGFibGUtdmlldyBidXR0b24gXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbiAgLyoqIFNldCBvZiBsZWFmIElEcyB3aGVyZSB0aGUgZmlsZSBpcyBrbm93biB0byBiZSBhbiBvYmplY3QtbGlua3MgZmlsZSAqL1xuICBwcml2YXRlIGtub3duT2JqZWN0TGVhdmVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgcHJpdmF0ZSBpbmplY3RUYWJsZVZpZXdCdXR0b25zKCk6IHZvaWQge1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwibWFya2Rvd25cIikpIHtcbiAgICAgIGNvbnN0IGFjdGlvbnMgPSAobGVhZi52aWV3IGFzIGFueSkuY29udGFpbmVyRWw/LnF1ZXJ5U2VsZWN0b3IoXCIudmlldy1hY3Rpb25zXCIpIGFzIEhUTUxFbGVtZW50IHwgbnVsbDtcbiAgICAgIGlmICghYWN0aW9ucyB8fCBhY3Rpb25zLnF1ZXJ5U2VsZWN0b3IoXCIub2wtdGFibGUtdmlldy1idG5cIikpIGNvbnRpbnVlO1xuXG4gICAgICBjb25zdCBmaWxlID0gKGxlYWYudmlldyBhcyBhbnkpLmZpbGUgYXMgVEZpbGUgfCB1bmRlZmluZWQ7XG4gICAgICBpZiAoIWZpbGUgfHwgZmlsZS5leHRlbnNpb24gIT09IFwibWRcIikgY29udGludWU7XG5cbiAgICAgIC8vIENoZWNrIGlmIHRoaXMgZmlsZSBpcyBhIGtub3duIG9iamVjdC1saW5rcyBmaWxlXG4gICAgICBjb25zdCBsZWFmSWQgPSAobGVhZiBhcyBhbnkpLmlkID8/IGZpbGUucGF0aDtcbiAgICAgIGlmICghdGhpcy5rbm93bk9iamVjdExlYXZlcy5oYXMobGVhZklkKSkge1xuICAgICAgICAvLyBBc3luYyBjaGVjaywgaW5qZWN0IG9uIG5leHQgbGF5b3V0LWNoYW5nZSBpZiBpdCdzIGFuIG9iamVjdCBmaWxlXG4gICAgICAgIHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSkudGhlbigoY29udGVudCkgPT4ge1xuICAgICAgICAgIGNvbnN0IHRhZyA9IHRoaXMuc2V0dGluZ3Mub2JqZWN0RmlsZVRhZy50cmltKCk7XG4gICAgICAgICAgaWYgKHRhZyAmJiAhdGhpcy5oYXNGaWxlVGFnKGNvbnRlbnQsIHRhZykpIHJldHVybjtcbiAgICAgICAgICBpZiAoIXBhcnNlTXVsdGlPYmplY3RGaWxlKGNvbnRlbnQsIGZpbGUucGF0aCkpIHJldHVybjtcbiAgICAgICAgICB0aGlzLmtub3duT2JqZWN0TGVhdmVzLmFkZChsZWFmSWQpO1xuICAgICAgICAgIHRoaXMuaW5qZWN0VGFibGVWaWV3QnV0dG9ucygpO1xuICAgICAgICB9KTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGJ0biA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJidXR0b25cIik7XG4gICAgICBidG4uY2xhc3NOYW1lID0gXCJjbGlja2FibGUtaWNvbiB2aWV3LWFjdGlvbiBvbC10YWJsZS12aWV3LWJ0blwiO1xuICAgICAgYnRuLnNldEF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIiwgXCJPcGVuIGFzIHRhYmxlXCIpO1xuICAgICAgc2V0SWNvbihidG4sIFwidGFibGVcIik7XG4gICAgICBidG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgICAgbGVhZi5zZXRWaWV3U3RhdGUoe1xuICAgICAgICAgIHR5cGU6IFRBQkxFX1ZJRVdfVFlQRSxcbiAgICAgICAgICBzdGF0ZTogeyBmaWxlOiBmaWxlLnBhdGggfSxcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICAgIGFjdGlvbnMuaW5zZXJ0QmVmb3JlKGJ0biwgYWN0aW9ucy5maXJzdENoaWxkKTtcbiAgICB9XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgRGVib3VuY2UgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbiAgcHJpdmF0ZSBkZWJvdW5jZVRpbWVyOiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bGwgPSBudWxsO1xuXG4gIHByaXZhdGUgZGVib3VuY2VSZWZyZXNoKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLmRlYm91bmNlVGltZXIpIGNsZWFyVGltZW91dCh0aGlzLmRlYm91bmNlVGltZXIpO1xuICAgIHRoaXMuZGVib3VuY2VUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4gdGhpcy5mdWxsUmVmcmVzaCgpLCA4MDApO1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIEZ1bGwgcmVmcmVzaDogc2NhbiwgY2hlY2sgZHVwZXMsIHVwZGF0ZSB2aWV3cyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBwcml2YXRlIGFzeW5jIGZ1bGxSZWZyZXNoKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHBhcnNlZEZpbGVzID0gYXdhaXQgdGhpcy5zY2FuTXVsdGlPYmplY3RGaWxlcygpO1xuICAgIGNvbnN0IGFsbEZpbGVzID0gYXdhaXQgdGhpcy5nZXRBbGxWYXVsdEZpbGVzKCk7XG5cbiAgICAvLyBCdWlsZCBpbmRleCArIGRpc2FtYmlndWF0ZSBkdXBsaWNhdGUga2V5IHZhbHVlc1xuICAgIHRoaXMuYWxsT2JqZWN0cyA9IFtdO1xuICAgIHRoaXMub2JqZWN0SW5kZXggPSBuZXcgTWFwKCk7XG4gICAgY29uc3QgaWREdXBlczogc3RyaW5nW10gPSBbXTtcbiAgICAvKiogVHJhY2sgaWRzIHBlciBmaWxlIHRvIGRldGVjdCBkdXBsaWNhdGUgaWRzIHdpdGhpbiBhIGZpbGUgKi9cbiAgICBjb25zdCBmaWxlSWRTZXRzOiBNYXA8c3RyaW5nLCBNYXA8bnVtYmVyLCBzdHJpbmc+PiA9IG5ldyBNYXAoKTtcbiAgICAvKiogTWFwIGZyb20gcGFyc2VkIGZpbGUgcGF0aCB0byBpdHMga2V5UHJvcGVydHkgbmFtZSAqL1xuICAgIGNvbnN0IGZpbGVLZXlQcm9wczogTWFwPHN0cmluZywgc3RyaW5nPiA9IG5ldyBNYXAoKTtcblxuICAgIC8vIFx1MjUwMFx1MjUwMCBQaGFzZSAxOiBDb2xsZWN0IGFsbCBvYmplY3RzIGFuZCBjaGVjayBpZCBkdXBsaWNhdGVzIFx1MjUwMFx1MjUwMFxuICAgIGZvciAoY29uc3QgZmlsZSBvZiBwYXJzZWRGaWxlcykge1xuICAgICAgZmlsZUtleVByb3BzLnNldChmaWxlLmZpbGVQYXRoLCBmaWxlLmtleVByb3BlcnR5KTtcblxuICAgICAgaWYgKCFmaWxlSWRTZXRzLmhhcyhmaWxlLmZpbGVQYXRoKSkge1xuICAgICAgICBmaWxlSWRTZXRzLnNldChmaWxlLmZpbGVQYXRoLCBuZXcgTWFwKCkpO1xuICAgICAgfVxuICAgICAgY29uc3QgaWRTZXQgPSBmaWxlSWRTZXRzLmdldChmaWxlLmZpbGVQYXRoKSE7XG5cbiAgICAgIGZvciAoY29uc3Qgb2JqIG9mIGZpbGUub2JqZWN0cykge1xuICAgICAgICB0aGlzLmFsbE9iamVjdHMucHVzaChvYmopO1xuXG4gICAgICAgIC8vIENoZWNrIGR1cGxpY2F0ZSBpZHMgd2l0aGluIHRoZSBzYW1lIGZpbGVcbiAgICAgICAgaWYgKGlkU2V0LmhhcyhvYmouaWQpKSB7XG4gICAgICAgICAgaWREdXBlcy5wdXNoKFxuICAgICAgICAgICAgYGlkICR7b2JqLmlkfSBkdXBsaWNhdGVkIGluICR7b2JqLmZpbGVMYWJlbH06IFwiJHtpZFNldC5nZXQob2JqLmlkKX1cIiBhbmQgXCIke29iai5rZXlWYWx1ZX1cImBcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIGlkU2V0LnNldChvYmouaWQsIG9iai5rZXlWYWx1ZSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gXHUyNTAwXHUyNTAwIFBoYXNlIDI6IERpc2FtYmlndWF0ZSBkdXBsaWNhdGUga2V5VmFsdWVzIFx1MjUwMFx1MjUwMFxuICAgIC8vIEdyb3VwIG9iamVjdHMgYnkgbG93ZXJjYXNlIGtleVZhbHVlXG4gICAgY29uc3Qga2V5R3JvdXBzID0gbmV3IE1hcDxzdHJpbmcsIFBhcnNlZE9iamVjdFtdPigpO1xuICAgIGZvciAoY29uc3Qgb2JqIG9mIHRoaXMuYWxsT2JqZWN0cykge1xuICAgICAgY29uc3QgayA9IG9iai5rZXlWYWx1ZS50b0xvd2VyQ2FzZSgpO1xuICAgICAgaWYgKCFrZXlHcm91cHMuaGFzKGspKSBrZXlHcm91cHMuc2V0KGssIFtdKTtcbiAgICAgIGtleUdyb3Vwcy5nZXQoaykhLnB1c2gob2JqKTtcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IFssIGdyb3VwXSBvZiBrZXlHcm91cHMpIHtcbiAgICAgIGlmIChncm91cC5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgLy8gVW5pcXVlIGtleTogZGlzcGxheUtleSA9IGtleVZhbHVlIChhbHJlYWR5IHRoZSBkZWZhdWx0KVxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgLy8gTXVsdGlwbGUgb2JqZWN0cyBzaGFyZSB0aGUgc2FtZSBrZXlWYWx1ZSAtLSBkaXNhbWJpZ3VhdGVcbiAgICAgIC8vIFN0ZXAgMTogVHJ5IFwia2V5VmFsdWUgKGZpbGVMYWJlbClcIlxuICAgICAgY29uc3QgZmlsZUdyb3VwcyA9IG5ldyBNYXA8c3RyaW5nLCBQYXJzZWRPYmplY3RbXT4oKTtcbiAgICAgIGZvciAoY29uc3Qgb2JqIG9mIGdyb3VwKSB7XG4gICAgICAgIGNvbnN0IGZrID0gb2JqLmZpbGVMYWJlbC50b0xvd2VyQ2FzZSgpO1xuICAgICAgICBpZiAoIWZpbGVHcm91cHMuaGFzKGZrKSkgZmlsZUdyb3Vwcy5zZXQoZmssIFtdKTtcbiAgICAgICAgZmlsZUdyb3Vwcy5nZXQoZmspIS5wdXNoKG9iaik7XG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgWywgZkdyb3VwXSBvZiBmaWxlR3JvdXBzKSB7XG4gICAgICAgIGlmIChmR3JvdXAubGVuZ3RoID09PSAxKSB7XG4gICAgICAgICAgLy8ga2V5ICsgZmlsZW5hbWUgaXMgdW5pcXVlXG4gICAgICAgICAgZkdyb3VwWzBdLmRpc3BsYXlLZXkgPSBgJHtmR3JvdXBbMF0ua2V5VmFsdWV9ICgke2ZHcm91cFswXS5maWxlTGFiZWx9KWA7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8ga2V5ICsgZmlsZW5hbWUgc3RpbGwgY29sbGlkZXM6IHVzZSBzZWNvbmQgcHJvcGVydHlcbiAgICAgICAgICBmb3IgKGNvbnN0IG9iaiBvZiBmR3JvdXApIHtcbiAgICAgICAgICAgIGNvbnN0IGtleVByb3AgPSBmaWxlS2V5UHJvcHMuZ2V0KG9iai5maWxlUGF0aCkgfHwgXCJcIjtcbiAgICAgICAgICAgIGNvbnN0IHNlY29uZFZhbCA9IGdldFNlY29uZFByb3BlcnR5KG9iaiwga2V5UHJvcCk7XG4gICAgICAgICAgICBpZiAoc2Vjb25kVmFsKSB7XG4gICAgICAgICAgICAgIG9iai5kaXNwbGF5S2V5ID0gYCR7b2JqLmtleVZhbHVlfSAoJHtzZWNvbmRWYWx9KWA7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAvLyBGYWxsYmFjazogdXNlIGlkXG4gICAgICAgICAgICAgIG9iai5kaXNwbGF5S2V5ID0gYCR7b2JqLmtleVZhbHVlfSAoIyR7b2JqLmlkfSlgO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFx1MjUwMFx1MjUwMCBQaGFzZSAzOiBCdWlsZCBvYmplY3RJbmRleCB1c2luZyBkaXNwbGF5S2V5IFx1MjUwMFx1MjUwMFxuICAgIC8vIFJlZ2lzdGVyIGVhY2ggb2JqZWN0IGJ5IGl0cyBkaXNwbGF5S2V5IChwcmltYXJ5IGxvb2t1cClcbiAgICBmb3IgKGNvbnN0IG9iaiBvZiB0aGlzLmFsbE9iamVjdHMpIHtcbiAgICAgIHRoaXMub2JqZWN0SW5kZXguc2V0KG9iai5kaXNwbGF5S2V5LnRvTG93ZXJDYXNlKCksIG9iaik7XG4gICAgfVxuICAgIC8vIEFsc28gcmVnaXN0ZXIgYnkgcGxhaW4ga2V5VmFsdWUgZm9yIG5vbi1hbWJpZ3VvdXMga2V5c1xuICAgIC8vIChzbyBleGlzdGluZyB7e2tleVZhbHVlfX0gbGlua3Mgc3RpbGwgcmVzb2x2ZSB3aGVuIHRoZXJlJ3Mgbm8gY29sbGlzaW9uKVxuICAgIGZvciAoY29uc3QgW2ssIGdyb3VwXSBvZiBrZXlHcm91cHMpIHtcbiAgICAgIGlmIChncm91cC5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgdGhpcy5vYmplY3RJbmRleC5zZXQoaywgZ3JvdXBbMF0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFdhcm4gb24gZHVwbGljYXRlIGlkc1xuICAgIGlmIChpZER1cGVzLmxlbmd0aCA+IDApIHtcbiAgICAgIG5ldyBOb3RpY2UoXG4gICAgICAgIGBPYmplY3QgTGlua3M6IER1cGxpY2F0ZSBJRHMgZm91bmQ6XFxuJHtpZER1cGVzLmpvaW4oXCJcXG5cIil9YCxcbiAgICAgICAgODAwMFxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBVcGRhdGUgc3VnZ2VzdCBwcm92aWRlclxuICAgIGlmICh0aGlzLnN1Z2dlc3RQcm92aWRlcikge1xuICAgICAgdGhpcy5zdWdnZXN0UHJvdmlkZXIuc2V0T2JqZWN0cyh0aGlzLmFsbE9iamVjdHMpO1xuICAgIH1cblxuICAgIC8vIEJ1aWxkIGdyYXBoXG4gICAgdGhpcy5ncmFwaERhdGEgPSBidWlsZEdyYXBoKHBhcnNlZEZpbGVzLCBhbGxGaWxlcyk7XG5cbiAgICAvLyBVcGRhdGUgb3BlbiBncmFwaCB2aWV3c1xuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoVklFV19UWVBFKS5mb3JFYWNoKChsZWFmKSA9PiB7XG4gICAgICBpZiAobGVhZi52aWV3IGluc3RhbmNlb2YgR3JhcGhWaWV3KSB7XG4gICAgICAgIGxlYWYudmlldy5uYXZpZ2F0ZVRvT2JqZWN0ID0gKGZwLCBzbCkgPT4gdGhpcy5nb1RvT2JqZWN0KGZwLCBzbCk7XG4gICAgICAgIGxlYWYudmlldy5uYXZpZ2F0ZVRvRmlsZSA9IChmcCkgPT4gdGhpcy5nb1RvRmlsZShmcCk7XG4gICAgICAgIGxlYWYudmlldy5zZXRHcmFwaERhdGEodGhpcy5ncmFwaERhdGEhKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCBWYXVsdCBzY2FubmluZyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBwcml2YXRlIGFzeW5jIHNjYW5NdWx0aU9iamVjdEZpbGVzKCk6IFByb21pc2U8UGFyc2VkRmlsZVtdPiB7XG4gICAgY29uc3QgZmlsZXMgPSB0aGlzLmFwcC52YXVsdC5nZXRNYXJrZG93bkZpbGVzKCk7XG4gICAgY29uc3QgcGFyc2VkOiBQYXJzZWRGaWxlW10gPSBbXTtcbiAgICBjb25zdCB0YWcgPSB0aGlzLnNldHRpbmdzLm9iamVjdEZpbGVUYWcudHJpbSgpO1xuXG4gICAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQucmVhZChmaWxlKTtcblxuICAgICAgICAvLyBJZiBhIHRhZyBpcyBjb25maWd1cmVkLCBvbmx5IHBhcnNlIGZpbGVzIHdob3NlIGZyb250bWF0dGVyXG4gICAgICAgIC8vIGluY2x1ZGVzIHRoYXQgdGFnLlxuICAgICAgICBpZiAodGFnKSB7XG4gICAgICAgICAgaWYgKCF0aGlzLmhhc0ZpbGVUYWcoY29udGVudCwgdGFnKSkgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCByZXN1bHQgPSBwYXJzZU11bHRpT2JqZWN0RmlsZShjb250ZW50LCBmaWxlLnBhdGgpO1xuICAgICAgICBpZiAocmVzdWx0KSBwYXJzZWQucHVzaChyZXN1bHQpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8qIHNraXAgKi9cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHBhcnNlZDtcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVjayBpZiBhIG1hcmtkb3duIGZpbGUgY29udGFpbnMgdGhlIGdpdmVuIHRhZy5cbiAgICogU3VwcG9ydHM6XG4gICAqICAxLiBCYXJlIGAjdGFnYCBhbnl3aGVyZSBpbiB0aGUgZmlsZSAoZS5nLiBgI29iamVjdC1saW5rc2Agb24gbGluZSAxKVxuICAgKiAgMi4gWUFNTCBmcm9udG1hdHRlciBgdGFnczogW2EsIGJdYCwgYHRhZ3M6IGFgLCBvciBsaXN0IGZvcm1cbiAgICogIDMuIFRoZSBgdGFnOmAgYWxpYXMgdXNlZCBieSBzb21lIE9ic2lkaWFuIHNldHVwc1xuICAgKi9cbiAgcHJpdmF0ZSBoYXNGaWxlVGFnKGNvbnRlbnQ6IHN0cmluZywgdGFnOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBjb25zdCBsb3dlclRhZyA9IHRhZy50b0xvd2VyQ2FzZSgpO1xuXG4gICAgLy8gXHUyNTAwXHUyNTAwIDEuIEJhcmUgI3RhZyBhbnl3aGVyZSBpbiB0aGUgY29udGVudCBcdTI1MDBcdTI1MDBcbiAgICAvLyBNYXRjaCAjdGFnIGFzIGEgd2hvbGUgd29yZCAobm90IGluc2lkZSBhbm90aGVyIHdvcmQpXG4gICAgY29uc3QgYmFyZVRhZ1JlZ2V4ID0gbmV3IFJlZ0V4cChcbiAgICAgIGAoPzpefFxcXFxzKSMke3RhZy5yZXBsYWNlKC9bLiorP14ke30oKXxbXFxdXFxcXF0vZywgXCJcXFxcJCZcIil9KD86XFxcXHN8JClgLFxuICAgICAgXCJpbVwiXG4gICAgKTtcbiAgICBpZiAoYmFyZVRhZ1JlZ2V4LnRlc3QoY29udGVudCkpIHJldHVybiB0cnVlO1xuXG4gICAgLy8gXHUyNTAwXHUyNTAwIDIuIFlBTUwgZnJvbnRtYXR0ZXIgdGFncyBcdTI1MDBcdTI1MDBcbiAgICBpZiAoIWNvbnRlbnQuc3RhcnRzV2l0aChcIi0tLVwiKSkgcmV0dXJuIGZhbHNlO1xuICAgIGNvbnN0IGVuZElkeCA9IGNvbnRlbnQuaW5kZXhPZihcIlxcbi0tLVwiLCAzKTtcbiAgICBpZiAoZW5kSWR4ID09PSAtMSkgcmV0dXJuIGZhbHNlO1xuICAgIGNvbnN0IGZyb250bWF0dGVyID0gY29udGVudC5zdWJzdHJpbmcoMywgZW5kSWR4KTtcblxuICAgIC8vIE1hdGNoIFwidGFnczpcIiBvciBcInRhZzpcIiBsaW5lcyB3aXRoIGlubGluZSB2YWx1ZXNcbiAgICBmb3IgKGNvbnN0IGxpbmUgb2YgZnJvbnRtYXR0ZXIuc3BsaXQoXCJcXG5cIikpIHtcbiAgICAgIGNvbnN0IHRyaW1tZWQgPSBsaW5lLnRyaW0oKTtcbiAgICAgIGNvbnN0IG1hdGNoID0gdHJpbW1lZC5tYXRjaCgvXnRhZ3M/XFxzKjpcXHMqKC4rKSQvaSk7XG4gICAgICBpZiAoIW1hdGNoKSBjb250aW51ZTtcblxuICAgICAgbGV0IHZhbHVlID0gbWF0Y2hbMV0udHJpbSgpO1xuXG4gICAgICAvLyBBcnJheSBmb3JtOiBbYSwgYiwgY11cbiAgICAgIGlmICh2YWx1ZS5zdGFydHNXaXRoKFwiW1wiKSAmJiB2YWx1ZS5lbmRzV2l0aChcIl1cIikpIHtcbiAgICAgICAgdmFsdWUgPSB2YWx1ZS5zbGljZSgxLCAtMSk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHRhZ3MgPSB2YWx1ZS5zcGxpdChcIixcIikubWFwKCh0KSA9PiB0LnRyaW0oKS50b0xvd2VyQ2FzZSgpKTtcbiAgICAgIGlmICh0YWdzLmluY2x1ZGVzKGxvd2VyVGFnKSkgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgLy8gWUFNTCBsaXN0IGZvcm06XG4gICAgLy8gICB0YWdzOlxuICAgIC8vICAgICAtIHRhZzFcbiAgICAvLyAgICAgLSB0YWcyXG4gICAgY29uc3QgbGlzdFJlZ2V4ID0gL150YWdzP1xccyo6XFxzKiQvaW07XG4gICAgY29uc3QgbGlzdE1hdGNoID0gbGlzdFJlZ2V4LmV4ZWMoZnJvbnRtYXR0ZXIpO1xuICAgIGlmIChsaXN0TWF0Y2gpIHtcbiAgICAgIGNvbnN0IGFmdGVyVGFncyA9IGZyb250bWF0dGVyLnN1YnN0cmluZyhcbiAgICAgICAgbGlzdE1hdGNoLmluZGV4ICsgbGlzdE1hdGNoWzBdLmxlbmd0aFxuICAgICAgKTtcbiAgICAgIGZvciAoY29uc3QgbGluZSBvZiBhZnRlclRhZ3Muc3BsaXQoXCJcXG5cIikpIHtcbiAgICAgICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgICAgICBpZiAodHJpbW1lZC5zdGFydHNXaXRoKFwiLSBcIikpIHtcbiAgICAgICAgICBjb25zdCB0YWdWYWwgPSB0cmltbWVkLnN1YnN0cmluZygyKS50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgICBpZiAodGFnVmFsID09PSBsb3dlclRhZykgcmV0dXJuIHRydWU7XG4gICAgICAgIH0gZWxzZSBpZiAodHJpbW1lZC5sZW5ndGggPiAwICYmICF0cmltbWVkLnN0YXJ0c1dpdGgoXCIjXCIpKSB7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGdldEFsbFZhdWx0RmlsZXMoKTogUHJvbWlzZTxWYXVsdEZpbGVbXT4ge1xuICAgIGNvbnN0IGZpbGVzID0gdGhpcy5hcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpO1xuICAgIGNvbnN0IHJlc3VsdDogVmF1bHRGaWxlW10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5yZWFkKGZpbGUpO1xuICAgICAgICByZXN1bHQucHVzaCh7IHBhdGg6IGZpbGUucGF0aCwgYmFzZW5hbWU6IGZpbGUuYmFzZW5hbWUsIGNvbnRlbnQgfSk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLyogc2tpcCAqL1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIE1hcmtkb3duIHBvc3QtcHJvY2Vzc29yIGZvciB7e29iamVjdH19IGxpbmtzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG4gIHByaXZhdGUgcHJvY2Vzc09iamVjdExpbmtzKGVsOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIC8vIFdhbGsgYWxsIHRleHQgbm9kZXMgYW5kIHJlcGxhY2Uge3suLi59fSB3aXRoIGNsaWNrYWJsZSBzcGFuc1xuICAgIGNvbnN0IHdhbGtlciA9IGRvY3VtZW50LmNyZWF0ZVRyZWVXYWxrZXIoZWwsIE5vZGVGaWx0ZXIuU0hPV19URVhUKTtcbiAgICBjb25zdCBub2Rlc1RvUmVwbGFjZTogeyBub2RlOiBUZXh0OyBtYXRjaGVzOiBSZWdFeHBFeGVjQXJyYXlbXSB9W10gPSBbXTtcblxuICAgIGxldCB0ZXh0Tm9kZTogVGV4dCB8IG51bGw7XG4gICAgd2hpbGUgKCh0ZXh0Tm9kZSA9IHdhbGtlci5uZXh0Tm9kZSgpIGFzIFRleHQgfCBudWxsKSkge1xuICAgICAgY29uc3QgdGV4dCA9IHRleHROb2RlLnRleHRDb250ZW50IHx8IFwiXCI7XG4gICAgICBjb25zdCByZWdleCA9IC9cXHtcXHsoW159XSspXFx9XFx9L2c7XG4gICAgICBjb25zdCBtYXRjaGVzOiBSZWdFeHBFeGVjQXJyYXlbXSA9IFtdO1xuICAgICAgbGV0IG1hdGNoOiBSZWdFeHBFeGVjQXJyYXkgfCBudWxsO1xuICAgICAgd2hpbGUgKChtYXRjaCA9IHJlZ2V4LmV4ZWModGV4dCkpICE9PSBudWxsKSB7XG4gICAgICAgIG1hdGNoZXMucHVzaCh7IC4uLm1hdGNoLCBpbmRleDogbWF0Y2guaW5kZXggfSBhcyBSZWdFeHBFeGVjQXJyYXkpO1xuICAgICAgfVxuICAgICAgaWYgKG1hdGNoZXMubGVuZ3RoID4gMCkge1xuICAgICAgICBub2Rlc1RvUmVwbGFjZS5wdXNoKHsgbm9kZTogdGV4dE5vZGUsIG1hdGNoZXMgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCB7IG5vZGUsIG1hdGNoZXMgfSBvZiBub2Rlc1RvUmVwbGFjZSkge1xuICAgICAgY29uc3QgdGV4dCA9IG5vZGUudGV4dENvbnRlbnQgfHwgXCJcIjtcbiAgICAgIGNvbnN0IHBhcmVudCA9IG5vZGUucGFyZW50Tm9kZTtcbiAgICAgIGlmICghcGFyZW50KSBjb250aW51ZTtcblxuICAgICAgY29uc3QgZnJhZyA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgICAgIGxldCBsYXN0SW5kZXggPSAwO1xuXG4gICAgICBmb3IgKGNvbnN0IG1hdGNoIG9mIG1hdGNoZXMpIHtcbiAgICAgICAgLy8gVGV4dCBiZWZvcmUgdGhlIG1hdGNoXG4gICAgICAgIGlmIChtYXRjaC5pbmRleCA+IGxhc3RJbmRleCkge1xuICAgICAgICAgIGZyYWcuYXBwZW5kQ2hpbGQoXG4gICAgICAgICAgICBkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZSh0ZXh0LnN1YnN0cmluZyhsYXN0SW5kZXgsIG1hdGNoLmluZGV4KSlcbiAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVGhlIHt7bGlua319IGl0c2VsZlxuICAgICAgICBsZXQgbGlua1RhcmdldCA9IG1hdGNoWzFdO1xuICAgICAgICBsZXQgZGlzcGxheVRleHQgPSBsaW5rVGFyZ2V0O1xuICAgICAgICBjb25zdCBwaXBlSWR4ID0gbGlua1RhcmdldC5pbmRleE9mKFwifFwiKTtcbiAgICAgICAgaWYgKHBpcGVJZHggIT09IC0xKSB7XG4gICAgICAgICAgZGlzcGxheVRleHQgPSBsaW5rVGFyZ2V0LnN1YnN0cmluZyhwaXBlSWR4ICsgMSkudHJpbSgpO1xuICAgICAgICAgIGxpbmtUYXJnZXQgPSBsaW5rVGFyZ2V0LnN1YnN0cmluZygwLCBwaXBlSWR4KS50cmltKCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzcGFuID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XG4gICAgICAgIHNwYW4uY2xhc3NOYW1lID0gXCJvbC1pbmxpbmUtbGlua1wiO1xuICAgICAgICBzcGFuLnRleHRDb250ZW50ID0gZGlzcGxheVRleHQ7XG4gICAgICAgIHNwYW4uc2V0QXR0cmlidXRlKFwiZGF0YS1vbC10YXJnZXRcIiwgbGlua1RhcmdldCk7XG5cbiAgICAgICAgY29uc3Qgb2JqID0gdGhpcy5vYmplY3RJbmRleC5nZXQobGlua1RhcmdldC50b0xvd2VyQ2FzZSgpKTtcbiAgICAgICAgaWYgKCFvYmopIHtcbiAgICAgICAgICBzcGFuLmNsYXNzTGlzdC5hZGQoXCJvbC1pbmxpbmUtbGluay11bnJlc29sdmVkXCIpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ2xpY2sgLT4gbmF2aWdhdGUgdG8gdGhlIG9iamVjdFxuICAgICAgICBzcGFuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZSkgPT4ge1xuICAgICAgICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICBlLnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICAgIGNvbnN0IHRhcmdldCA9IHNwYW4uZ2V0QXR0cmlidXRlKFwiZGF0YS1vbC10YXJnZXRcIikgfHwgXCJcIjtcbiAgICAgICAgICBjb25zdCB0YXJnZXRPYmogPSB0aGlzLm9iamVjdEluZGV4LmdldCh0YXJnZXQudG9Mb3dlckNhc2UoKSk7XG4gICAgICAgICAgaWYgKHRhcmdldE9iaikge1xuICAgICAgICAgICAgdGhpcy5nb1RvT2JqZWN0KHRhcmdldE9iai5maWxlUGF0aCwgdGFyZ2V0T2JqLnN0YXJ0TGluZSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoYE9iamVjdCBcIiR7dGFyZ2V0fVwiIG5vdCBmb3VuZGApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gSG92ZXIgLT4gc2hvdyB0b29sdGlwIHdpdGggcHJvcGVydGllc1xuICAgICAgICBzcGFuLmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZWVudGVyXCIsIChlKSA9PiB7XG4gICAgICAgICAgY29uc3QgdGFyZ2V0ID0gc3Bhbi5nZXRBdHRyaWJ1dGUoXCJkYXRhLW9sLXRhcmdldFwiKSB8fCBcIlwiO1xuICAgICAgICAgIGNvbnN0IHRhcmdldE9iaiA9IHRoaXMub2JqZWN0SW5kZXguZ2V0KHRhcmdldC50b0xvd2VyQ2FzZSgpKTtcbiAgICAgICAgICBpZiAodGFyZ2V0T2JqKSB7XG4gICAgICAgICAgICB0aGlzLnNob3dPYmplY3RQb3BvdmVyKHNwYW4sIHRhcmdldE9iaik7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgc3Bhbi5hZGRFdmVudExpc3RlbmVyKFwibW91c2VsZWF2ZVwiLCAoKSA9PiB7XG4gICAgICAgICAgdGhpcy5oaWRlT2JqZWN0UG9wb3ZlcigpO1xuICAgICAgICB9KTtcblxuICAgICAgICBmcmFnLmFwcGVuZENoaWxkKHNwYW4pO1xuICAgICAgICBsYXN0SW5kZXggPSBtYXRjaC5pbmRleCArIG1hdGNoWzBdLmxlbmd0aDtcbiAgICAgIH1cblxuICAgICAgLy8gUmVtYWluaW5nIHRleHRcbiAgICAgIGlmIChsYXN0SW5kZXggPCB0ZXh0Lmxlbmd0aCkge1xuICAgICAgICBmcmFnLmFwcGVuZENoaWxkKGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKHRleHQuc3Vic3RyaW5nKGxhc3RJbmRleCkpKTtcbiAgICAgIH1cblxuICAgICAgcGFyZW50LnJlcGxhY2VDaGlsZChmcmFnLCBub2RlKTtcbiAgICB9XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgT2JqZWN0IHBvcG92ZXIgb24gaG92ZXIgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbiAgcHJpdmF0ZSBwb3BvdmVyRWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG5cbiAgcHJpdmF0ZSBzaG93T2JqZWN0UG9wb3ZlcihhbmNob3I6IEhUTUxFbGVtZW50LCBvYmo6IFBhcnNlZE9iamVjdCk6IHZvaWQge1xuICAgIHRoaXMuaGlkZU9iamVjdFBvcG92ZXIoKTtcblxuICAgIGNvbnN0IHBvcCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgcG9wLmNsYXNzTmFtZSA9IFwib2wtcG9wb3ZlclwiO1xuXG4gICAgY29uc3QgdGl0bGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHRpdGxlLmNsYXNzTmFtZSA9IFwib2wtcG9wb3Zlci10aXRsZVwiO1xuICAgIHRpdGxlLnRleHRDb250ZW50ID0gb2JqLmRpc3BsYXlLZXk7XG4gICAgcG9wLmFwcGVuZENoaWxkKHRpdGxlKTtcblxuICAgIGNvbnN0IGZpbGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIGZpbGUuY2xhc3NOYW1lID0gXCJvbC1wb3BvdmVyLWZpbGVcIjtcbiAgICBmaWxlLnRleHRDb250ZW50ID0gb2JqLmZpbGVMYWJlbDtcbiAgICBwb3AuYXBwZW5kQ2hpbGQoZmlsZSk7XG5cbiAgICBmb3IgKGNvbnN0IFtrLCB2XSBvZiBPYmplY3QuZW50cmllcyhvYmoucHJvcGVydGllcykpIHtcbiAgICAgIGNvbnN0IHJvdyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICByb3cuY2xhc3NOYW1lID0gXCJvbC1wb3BvdmVyLXJvd1wiO1xuICAgICAgcm93LmlubmVySFRNTCA9IGA8c3BhbiBjbGFzcz1cIm9sLXBvcG92ZXIta2V5XCI+JHtrfTwvc3Bhbj48c3BhbiBjbGFzcz1cIm9sLXBvcG92ZXItdmFsXCI+JHt2fTwvc3Bhbj5gO1xuICAgICAgcG9wLmFwcGVuZENoaWxkKHJvdyk7XG4gICAgfVxuXG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChwb3ApO1xuICAgIHRoaXMucG9wb3ZlckVsID0gcG9wO1xuXG4gICAgLy8gUG9zaXRpb24gYmVsb3cgdGhlIGFuY2hvclxuICAgIGNvbnN0IHJlY3QgPSBhbmNob3IuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgcG9wLnN0eWxlLnRvcCA9IHJlY3QuYm90dG9tICsgNCArIFwicHhcIjtcbiAgICBwb3Auc3R5bGUubGVmdCA9IHJlY3QubGVmdCArIFwicHhcIjtcbiAgfVxuXG4gIHByaXZhdGUgaGlkZU9iamVjdFBvcG92ZXIoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMucG9wb3ZlckVsKSB7XG4gICAgICB0aGlzLnBvcG92ZXJFbC5yZW1vdmUoKTtcbiAgICAgIHRoaXMucG9wb3ZlckVsID0gbnVsbDtcbiAgICB9XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgTmF2aWdhdGlvbiBoZWxwZXJzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG4gIHByaXZhdGUgYXN5bmMgZ29Ub09iamVjdChmaWxlUGF0aDogc3RyaW5nLCBzdGFydExpbmU6IG51bWJlcik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoZmlsZVBhdGgpO1xuICAgIGlmICghKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHtcbiAgICAgIG5ldyBOb3RpY2UoYEZpbGUgbm90IGZvdW5kOiAke2ZpbGVQYXRofWApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGxlYWYgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0TGVhZihcInRhYlwiKTtcbiAgICBhd2FpdCBsZWFmLm9wZW5GaWxlKGZpbGUpO1xuXG4gICAgLy8gU2Nyb2xsIHRvIHRoZSBsaW5lXG4gICAgY29uc3QgdmlldyA9IGxlYWYudmlldyBhcyBhbnk7XG4gICAgaWYgKHZpZXcgJiYgdmlldy5lZGl0b3IpIHtcbiAgICAgIC8vIEdpdmUgdGhlIGVkaXRvciBhIG1vbWVudCB0byBsb2FkXG4gICAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICB2aWV3LmVkaXRvci5zZXRDdXJzb3IoeyBsaW5lOiBzdGFydExpbmUsIGNoOiAwIH0pO1xuICAgICAgICAgIHZpZXcuZWRpdG9yLnNjcm9sbEludG9WaWV3KFxuICAgICAgICAgICAgeyBmcm9tOiB7IGxpbmU6IHN0YXJ0TGluZSwgY2g6IDAgfSwgdG86IHsgbGluZTogc3RhcnRMaW5lICsgNSwgY2g6IDAgfSB9LFxuICAgICAgICAgICAgdHJ1ZVxuICAgICAgICAgICk7XG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIC8qIGVkaXRvciBtaWdodCBub3Qgc3VwcG9ydCB0aGlzICovXG4gICAgICAgIH1cbiAgICAgIH0sIDEwMCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBnb1RvRmlsZShmaWxlUGF0aDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChmaWxlUGF0aCk7XG4gICAgaWYgKCEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkge1xuICAgICAgbmV3IE5vdGljZShgRmlsZSBub3QgZm91bmQ6ICR7ZmlsZVBhdGh9YCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGxlYWYgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0TGVhZihcInRhYlwiKTtcbiAgICBhd2FpdCBsZWFmLm9wZW5GaWxlKGZpbGUpO1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIEFjdGl2YXRlIHZpZXcgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbiAgYXN5bmMgYWN0aXZhdGVWaWV3KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHsgd29ya3NwYWNlIH0gPSB0aGlzLmFwcDtcblxuICAgIGxldCBsZWFmOiBXb3Jrc3BhY2VMZWFmIHwgbnVsbCA9IG51bGw7XG4gICAgY29uc3QgbGVhdmVzID0gd29ya3NwYWNlLmdldExlYXZlc09mVHlwZShWSUVXX1RZUEUpO1xuXG4gICAgaWYgKGxlYXZlcy5sZW5ndGggPiAwKSB7XG4gICAgICBsZWFmID0gbGVhdmVzWzBdO1xuICAgIH0gZWxzZSB7XG4gICAgICBsZWFmID0gd29ya3NwYWNlLmdldExlYWYoXCJ0YWJcIik7XG4gICAgICBhd2FpdCBsZWFmLnNldFZpZXdTdGF0ZSh7IHR5cGU6IFZJRVdfVFlQRSwgYWN0aXZlOiB0cnVlIH0pO1xuICAgIH1cblxuICAgIHdvcmtzcGFjZS5yZXZlYWxMZWFmKGxlYWYpO1xuXG4gICAgLy8gQnVpbGQvcmVmcmVzaCBncmFwaFxuICAgIGF3YWl0IHRoaXMuZnVsbFJlZnJlc2goKTtcbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCBTZXR0aW5ncyBwZXJzaXN0ZW5jZSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBhc3luYyBsb2FkU2V0dGluZ3MoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5zZXR0aW5ncyA9IE9iamVjdC5hc3NpZ24oe30sIERFRkFVTFRfU0VUVElOR1MsIGF3YWl0IHRoaXMubG9hZERhdGEoKSk7XG4gIH1cblxuICBhc3luYyBzYXZlU2V0dGluZ3MoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YSh0aGlzLnNldHRpbmdzKTtcbiAgICAvLyBSZS1zY2FuIGFmdGVyIHNldHRpbmdzIGNoYW5nZSAodGFnIG1heSBoYXZlIGNoYW5nZWQpXG4gICAgdGhpcy5mdWxsUmVmcmVzaCgpO1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIEVkaXRvciBoZWxwZXJzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG4gIC8qKlxuICAgKiBDb21tYW5kOiBvcGVuIHRoZSBmaWxlL29iamVjdCBcInVuZGVyIHRoZSBjdXJzb3JcIi5cbiAgICogLSBJZiBjdXJzb3IgaXMgaW5zaWRlIGEgd2lraWxpbmsgKFtbLi4uXV0pLCBvcGVucyB0aGF0IGZpbGUuXG4gICAqIC0gSWYgY3Vyc29yIGlzIGluc2lkZSBhbiBvYmplY3QgbGluayAoe3suLi59fSksIG9wZW5zIHRoZSBvYmplY3QncyBzb3VyY2UgZmlsZS5cbiAgICovXG4gIGFzeW5jIG9wZW5VbmRlckN1cnNvcigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB2aWV3ID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcbiAgICBjb25zdCBlZGl0b3IgPSB2aWV3Py5lZGl0b3I7XG4gICAgaWYgKCFlZGl0b3IpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJPYmplY3QgTGlua3M6IE5vIGFjdGl2ZSBlZGl0b3JcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgY3Vyc29yID0gZWRpdG9yLmdldEN1cnNvcigpO1xuICAgIGNvbnN0IGxpbmUgPSBlZGl0b3IuZ2V0TGluZShjdXJzb3IubGluZSkgYXMgc3RyaW5nO1xuICAgIGNvbnN0IGNoID0gY3Vyc29yLmNoIGFzIG51bWJlcjtcblxuICAgIGNvbnN0IHdpdGhpbiA9IChvcGVuOiBzdHJpbmcsIGNsb3NlOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsID0+IHtcbiAgICAgIGNvbnN0IGxlZnQgPSBsaW5lLmxhc3RJbmRleE9mKG9wZW4sIGNoKTtcbiAgICAgIGlmIChsZWZ0ID09PSAtMSkgcmV0dXJuIG51bGw7XG4gICAgICBjb25zdCByaWdodCA9IGxpbmUuaW5kZXhPZihjbG9zZSwgbGVmdCArIG9wZW4ubGVuZ3RoKTtcbiAgICAgIGlmIChyaWdodCA9PT0gLTEpIHJldHVybiBudWxsO1xuICAgICAgaWYgKGNoIDwgbGVmdCArIG9wZW4ubGVuZ3RoIHx8IGNoID4gcmlnaHQpIHJldHVybiBudWxsO1xuICAgICAgcmV0dXJuIGxpbmUuc3Vic3RyaW5nKGxlZnQgKyBvcGVuLmxlbmd0aCwgcmlnaHQpO1xuICAgIH07XG5cbiAgICAvLyAxKSBXaWtpbGluazogW1t0YXJnZXR8YWxpYXNdXVxuICAgIGNvbnN0IHdpayA9IHdpdGhpbihcIltbXCIsIFwiXV1cIik7XG4gICAgaWYgKHdpaykge1xuICAgICAgY29uc3QgdGFyZ2V0ID0gd2lrLnNwbGl0KFwifFwiKVswXS50cmltKCk7XG4gICAgICBjb25zdCBkZXN0ID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaXJzdExpbmtwYXRoRGVzdCh0YXJnZXQsIHZpZXc/LmZpbGU/LnBhdGggfHwgXCJcIik7XG4gICAgICBpZiAoZGVzdCkge1xuICAgICAgICBhd2FpdCB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0TGVhZihcInRhYlwiKS5vcGVuRmlsZShkZXN0KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgbmV3IE5vdGljZShgRmlsZSBub3QgZm91bmQ6ICR7dGFyZ2V0fWApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIDIpIE9iamVjdCBsaW5rOiB7e29iamVjdHxhbGlhc319XG4gICAgY29uc3Qgb2JqID0gd2l0aGluKFwie3tcIiwgXCJ9fVwiKTtcbiAgICBpZiAob2JqKSB7XG4gICAgICBjb25zdCB0YXJnZXQgPSBvYmouc3BsaXQoXCJ8XCIpWzBdLnRyaW0oKTtcbiAgICAgIGNvbnN0IGZvdW5kID0gdGhpcy5vYmplY3RJbmRleC5nZXQodGFyZ2V0LnRvTG93ZXJDYXNlKCkpO1xuICAgICAgaWYgKGZvdW5kKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuZ29Ub09iamVjdChmb3VuZC5maWxlUGF0aCwgZm91bmQuc3RhcnRMaW5lKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgbmV3IE5vdGljZShgT2JqZWN0IFwiJHt0YXJnZXR9XCIgbm90IGZvdW5kYCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgbmV3IE5vdGljZShcIk5vIGxpbmsgdW5kZXIgY3Vyc29yXCIpO1xuICB9XG59XG5cbiIsICIvKipcbiAqIFBhcnNlciBmb3IgbXVsdGktb2JqZWN0IG1hcmtkb3duIGZpbGVzLlxuICpcbiAqIEZvcm1hdDpcbiAqICAga2V5OiA8cHJvcGVydHlfbmFtZT5cbiAqXG4gKiAgIC0tLVxuICpcbiAqICAgcHJvcDE6IHZhbHVlMVxuICogICBwcm9wMjogdmFsdWUyXG4gKlxuICogICAtLS1cbiAqXG4gKiAgIHByb3AxOiB2YWx1ZTNcbiAqICAgcHJvcDI6IHZhbHVlNFxuICovXG5cbmV4cG9ydCBpbnRlcmZhY2UgUGFyc2VkT2JqZWN0IHtcbiAgLyoqIFRoZSB2YWx1ZSBvZiB0aGUga2V5IHByb3BlcnR5IC0tIHVzZWQgYXMgdGhlIGxpbmthYmxlIG5hbWUgKi9cbiAga2V5VmFsdWU6IHN0cmluZztcbiAgLyoqXG4gICAqIERpc2FtYmlndWF0ZWQgaWRlbnRpZmllciB1c2VkIGZvciB7e319IGxpbmtzLCBpbmRleCBsb29rdXBzLCBhbmQgZ3JhcGggbGFiZWxzLlxuICAgKiBEZWZhdWx0cyB0byBrZXlWYWx1ZS4gSWYgZHVwbGljYXRlcyBleGlzdDpcbiAgICogICAtIGRpZmZlcmVudCBmaWxlczogXCJrZXlWYWx1ZSAoZmlsZUxhYmVsKVwiXG4gICAqICAgLSBzYW1lIGZpbGU6IFwia2V5VmFsdWUgKHNlY29uZFByb3BlcnR5VmFsdWUpXCJcbiAgICogU2V0IGR1cmluZyBmdWxsUmVmcmVzaCgpIGluIG1haW4udHMuXG4gICAqL1xuICBkaXNwbGF5S2V5OiBzdHJpbmc7XG4gIC8qKiBNYW5kYXRvcnkgbnVtZXJpYyBpZCBmb3IgdGhpcyBvYmplY3QgKi9cbiAgaWQ6IG51bWJlcjtcbiAgLyoqIEFsbCBwcm9wZXJ0aWVzIG9mIHRoaXMgb2JqZWN0IChpbnNlcnRpb24tb3JkZXJlZCkgKi9cbiAgcHJvcGVydGllczogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgLyoqIE9yZGVyZWQgbGlzdCBvZiBwcm9wZXJ0eSBuYW1lcyBhcyB0aGV5IGFwcGVhciBpbiB0aGUgZmlsZSAqL1xuICBwcm9wZXJ0eU9yZGVyOiBzdHJpbmdbXTtcbiAgLyoqIFNvdXJjZSBmaWxlIHBhdGggKi9cbiAgZmlsZVBhdGg6IHN0cmluZztcbiAgLyoqIFNvdXJjZSBmaWxlIGJhc2VuYW1lICh3aXRob3V0IGV4dGVuc2lvbikgKi9cbiAgZmlsZUxhYmVsOiBzdHJpbmc7XG4gIC8qKiAwLWluZGV4ZWQgbGluZSBudW1iZXIgd2hlcmUgdGhpcyBvYmplY3QgYmxvY2sgc3RhcnRzIGluIHRoZSBmaWxlICovXG4gIHN0YXJ0TGluZTogbnVtYmVyO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFBhcnNlZEZpbGUge1xuICAvKiogVGhlIHByb3BlcnR5IG5hbWUgdXNlZCBhcyBrZXkgKi9cbiAga2V5UHJvcGVydHk6IHN0cmluZztcbiAgLyoqIEFsbCBwYXJzZWQgb2JqZWN0cyBpbiB0aGlzIGZpbGUgKi9cbiAgb2JqZWN0czogUGFyc2VkT2JqZWN0W107XG4gIC8qKiBTb3VyY2UgZmlsZSBwYXRoICovXG4gIGZpbGVQYXRoOiBzdHJpbmc7XG59XG5cbi8qKlxuICogUGFyc2UgYSBtdWx0aS1vYmplY3QgbWFya2Rvd24gZmlsZS5cbiAqIFJldHVybnMgbnVsbCBpZiB0aGUgZmlsZSBkb2Vzbid0IGZvbGxvdyB0aGUgZXhwZWN0ZWQgZm9ybWF0LlxuICpcbiAqIFNraXBzIFlBTUwgZnJvbnRtYXR0ZXIgKGlmIHByZXNlbnQpIGJlZm9yZSBsb29raW5nIGZvciB0aGVcbiAqIGBrZXk6IDxwcm9wZXJ0eT5gIGhlYWRlciBhbmQgYC0tLWAgc2VwYXJhdGVkIG9iamVjdCBibG9ja3MuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZU11bHRpT2JqZWN0RmlsZShcbiAgY29udGVudDogc3RyaW5nLFxuICBmaWxlUGF0aDogc3RyaW5nXG4pOiBQYXJzZWRGaWxlIHwgbnVsbCB7XG4gIGNvbnN0IGxpbmVzID0gY29udGVudC5zcGxpdChcIlxcblwiKTtcblxuICAvLyBTa2lwIFlBTUwgZnJvbnRtYXR0ZXIgKG9wZW5pbmcgLS0tIG9uIGZpcnN0IGxpbmUsIGNsb3NpbmcgLS0tIGxhdGVyKVxuICBsZXQgc3RhcnRJZHggPSAwO1xuICBpZiAobGluZXMubGVuZ3RoID4gMCAmJiBsaW5lc1swXS50cmltKCkgPT09IFwiLS0tXCIpIHtcbiAgICBmb3IgKGxldCBpID0gMTsgaSA8IGxpbmVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAobGluZXNbaV0udHJpbSgpID09PSBcIi0tLVwiKSB7XG4gICAgICAgIHN0YXJ0SWR4ID0gaSArIDE7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIEZpcnN0IG5vbi1lbXB0eSBsaW5lIChhZnRlciBmcm9udG1hdHRlcikgc2hvdWxkIGJlIFwia2V5OiA8cHJvcGVydHk+XCJcbiAgLy8gQnV0IHNraXAgYmFyZSAjdGFnIGxpbmVzIChlLmcuICNvYmplY3QtbGlua3MpIHRoYXQgcHJlY2VkZSBpdFxuICBsZXQga2V5TGluZSA9IFwiXCI7XG4gIGZvciAobGV0IGkgPSBzdGFydElkeDsgaSA8IGxpbmVzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmVzW2ldLnRyaW0oKTtcbiAgICBpZiAodHJpbW1lZC5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuICAgIC8vIFNraXAgYmFyZSB0YWcgbGluZXMgbGlrZSBcIiNvYmplY3QtbGlua3NcIlxuICAgIGlmICh0cmltbWVkLnN0YXJ0c1dpdGgoXCIjXCIpICYmICF0cmltbWVkLmluY2x1ZGVzKFwiOlwiKSkgY29udGludWU7XG4gICAga2V5TGluZSA9IHRyaW1tZWQ7XG4gICAgYnJlYWs7XG4gIH1cblxuICBjb25zdCBrZXlNYXRjaCA9IGtleUxpbmUubWF0Y2goL15rZXk6XFxzKiguKykkL2kpO1xuICBpZiAoIWtleU1hdGNoKSByZXR1cm4gbnVsbDtcblxuICBjb25zdCBrZXlQcm9wZXJ0eSA9IGtleU1hdGNoWzFdLnRyaW0oKTtcbiAgY29uc3QgZmlsZUxhYmVsID0gZmlsZVBhdGgucmVwbGFjZSgvXi4qXFwvLywgXCJcIikucmVwbGFjZSgvXFwubWQkL2ksIFwiXCIpO1xuXG4gIC8vIFdhbGsgbGluZXMgKGFmdGVyIGZyb250bWF0dGVyKSB0byBmaW5kIC0tLSBzZXBhcmF0b3JzIGFuZCBidWlsZCBvYmplY3RzXG4gIGNvbnN0IG9iamVjdHM6IFBhcnNlZE9iamVjdFtdID0gW107XG4gIGxldCBjdXJyZW50QmxvY2s6IHsgbGluZXM6IHN0cmluZ1tdOyBzdGFydExpbmU6IG51bWJlciB9IHwgbnVsbCA9IG51bGw7XG4gIGxldCBwYXNzZWRGaXJzdFNlcGFyYXRvciA9IGZhbHNlO1xuXG4gIGZvciAobGV0IGkgPSBzdGFydElkeDsgaSA8IGxpbmVzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmVzW2ldLnRyaW0oKTtcblxuICAgIGlmICh0cmltbWVkID09PSBcIi0tLVwiKSB7XG4gICAgICAvLyBGbHVzaCB0aGUgY3VycmVudCBibG9jayBpZiB3ZSBoYXZlIG9uZVxuICAgICAgaWYgKGN1cnJlbnRCbG9jayAmJiBwYXNzZWRGaXJzdFNlcGFyYXRvcikge1xuICAgICAgICBjb25zdCBvYmogPSBwYXJzZUJsb2NrKGN1cnJlbnRCbG9jaywga2V5UHJvcGVydHksIGZpbGVQYXRoLCBmaWxlTGFiZWwpO1xuICAgICAgICBpZiAob2JqKSBvYmplY3RzLnB1c2gob2JqKTtcbiAgICAgIH1cbiAgICAgIHBhc3NlZEZpcnN0U2VwYXJhdG9yID0gdHJ1ZTtcbiAgICAgIGN1cnJlbnRCbG9jayA9IHsgbGluZXM6IFtdLCBzdGFydExpbmU6IGkgKyAxIH07XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoY3VycmVudEJsb2NrICYmIHBhc3NlZEZpcnN0U2VwYXJhdG9yKSB7XG4gICAgICBjdXJyZW50QmxvY2subGluZXMucHVzaCh0cmltbWVkKTtcbiAgICB9XG4gIH1cblxuICAvLyBGbHVzaCB0aGUgbGFzdCBibG9ja1xuICBpZiAoY3VycmVudEJsb2NrICYmIHBhc3NlZEZpcnN0U2VwYXJhdG9yKSB7XG4gICAgY29uc3Qgb2JqID0gcGFyc2VCbG9jayhjdXJyZW50QmxvY2ssIGtleVByb3BlcnR5LCBmaWxlUGF0aCwgZmlsZUxhYmVsKTtcbiAgICBpZiAob2JqKSBvYmplY3RzLnB1c2gob2JqKTtcbiAgfVxuXG4gIGlmIChvYmplY3RzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgcmV0dXJuIHsga2V5UHJvcGVydHksIG9iamVjdHMsIGZpbGVQYXRoIH07XG59XG5cbmZ1bmN0aW9uIHBhcnNlQmxvY2soXG4gIGJsb2NrOiB7IGxpbmVzOiBzdHJpbmdbXTsgc3RhcnRMaW5lOiBudW1iZXIgfSxcbiAga2V5UHJvcGVydHk6IHN0cmluZyxcbiAgZmlsZVBhdGg6IHN0cmluZyxcbiAgZmlsZUxhYmVsOiBzdHJpbmdcbik6IFBhcnNlZE9iamVjdCB8IG51bGwge1xuICBjb25zdCBwcm9wZXJ0aWVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XG4gIGNvbnN0IHByb3BlcnR5T3JkZXI6IHN0cmluZ1tdID0gW107XG5cbiAgZm9yIChjb25zdCBsaW5lIG9mIGJsb2NrLmxpbmVzKSB7XG4gICAgaWYgKCFsaW5lKSBjb250aW51ZTtcbiAgICBjb25zdCBjb2xvbkluZGV4ID0gbGluZS5pbmRleE9mKFwiOlwiKTtcbiAgICBpZiAoY29sb25JbmRleCA9PT0gLTEpIGNvbnRpbnVlO1xuXG4gICAgY29uc3QgcHJvcCA9IGxpbmUuc3Vic3RyaW5nKDAsIGNvbG9uSW5kZXgpLnRyaW0oKTtcbiAgICBjb25zdCB2YWwgPSBsaW5lLnN1YnN0cmluZyhjb2xvbkluZGV4ICsgMSkudHJpbSgpO1xuICAgIGlmIChwcm9wICYmIHZhbCkge1xuICAgICAgcHJvcGVydGllc1twcm9wXSA9IHZhbDtcbiAgICAgIHByb3BlcnR5T3JkZXIucHVzaChwcm9wKTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBrZXlWYWx1ZSA9IHByb3BlcnRpZXNba2V5UHJvcGVydHldO1xuICBpZiAoIWtleVZhbHVlKSByZXR1cm4gbnVsbDtcblxuICAvLyBNYW5kYXRvcnkgaWQgcHJvcGVydHk6IG11c3QgYmUgcHJlc2VudCBhbmQgbnVtZXJpY1xuICBjb25zdCByYXdJZCA9IHByb3BlcnRpZXNbXCJpZFwiXTtcbiAgaWYgKCFyYXdJZCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGlkID0gTnVtYmVyKHJhd0lkKTtcbiAgaWYgKGlzTmFOKGlkKSkgcmV0dXJuIG51bGw7XG5cbiAgcmV0dXJuIHtcbiAgICBrZXlWYWx1ZSxcbiAgICBkaXNwbGF5S2V5OiBrZXlWYWx1ZSwgLy8gZGVmYXVsdDsgZGlzYW1iaWd1YXRlZCBsYXRlciBpbiBmdWxsUmVmcmVzaCgpXG4gICAgaWQsXG4gICAgcHJvcGVydGllcyxcbiAgICBwcm9wZXJ0eU9yZGVyLFxuICAgIGZpbGVQYXRoLFxuICAgIGZpbGVMYWJlbCxcbiAgICBzdGFydExpbmU6IGJsb2NrLnN0YXJ0TGluZSxcbiAgfTtcbn1cblxuLyoqXG4gKiBHZXQgdGhlIHZhbHVlIG9mIHRoZSBcInNlY29uZCBwcm9wZXJ0eVwiIG9mIGFuIG9iamVjdCBmb3IgZGlzYW1iaWd1YXRpb24uXG4gKiBUaGlzIGlzIHRoZSBmaXJzdCBwcm9wZXJ0eSB0aGF0IGlzIG5vdCB0aGUga2V5IHByb3BlcnR5IGFuZCBub3QgXCJpZFwiLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0U2Vjb25kUHJvcGVydHkoXG4gIG9iajogUGFyc2VkT2JqZWN0LFxuICBrZXlQcm9wZXJ0eTogc3RyaW5nXG4pOiBzdHJpbmcgfCBudWxsIHtcbiAgZm9yIChjb25zdCBwcm9wIG9mIG9iai5wcm9wZXJ0eU9yZGVyKSB7XG4gICAgaWYgKHByb3AgPT09IGtleVByb3BlcnR5IHx8IHByb3AgPT09IFwiaWRcIikgY29udGludWU7XG4gICAgY29uc3QgdmFsID0gb2JqLnByb3BlcnRpZXNbcHJvcF07XG4gICAgaWYgKHZhbCkgcmV0dXJuIHZhbDtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBFeHRyYWN0IGFsbCB7e29iamVjdCBsaW5rc319IGZyb20gY29udGVudC5cbiAqIFJldHVybnMgdGhlIGxpbmsgdGFyZ2V0IG5hbWVzICh3aXRob3V0IHt7IH19KS5cbiAqIEhhbmRsZXMgYWxpYXNlcyBsaWtlIHt7dGFyZ2V0fGFsaWFzfX0gYnkgcmV0dXJuaW5nIGp1c3QgXCJ0YXJnZXRcIi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RPYmplY3RMaW5rcyhjb250ZW50OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IGxpbmtzOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCByZWdleCA9IC9cXHtcXHsoW159XSspXFx9XFx9L2c7XG4gIGxldCBtYXRjaDtcblxuICB3aGlsZSAoKG1hdGNoID0gcmVnZXguZXhlYyhjb250ZW50KSkgIT09IG51bGwpIHtcbiAgICBsZXQgbGlua1RhcmdldCA9IG1hdGNoWzFdO1xuICAgIGNvbnN0IHBpcGVJbmRleCA9IGxpbmtUYXJnZXQuaW5kZXhPZihcInxcIik7XG4gICAgaWYgKHBpcGVJbmRleCAhPT0gLTEpIHtcbiAgICAgIGxpbmtUYXJnZXQgPSBsaW5rVGFyZ2V0LnN1YnN0cmluZygwLCBwaXBlSW5kZXgpO1xuICAgIH1cbiAgICBsaW5rcy5wdXNoKGxpbmtUYXJnZXQudHJpbSgpKTtcbiAgfVxuXG4gIHJldHVybiBsaW5rcztcbn1cblxuLyoqXG4gKiBFeHRyYWN0IGFsbCBbW3dpa2lsaW5rc11dIGZyb20gY29udGVudC5cbiAqIFJldHVybnMgdGhlIGxpbmsgdGFyZ2V0IG5hbWVzICh3aXRob3V0IFtbIF1dKS5cbiAqIEhhbmRsZXMgYWxpYXNlcyBsaWtlIFtbdGFyZ2V0fGFsaWFzXV0gYnkgcmV0dXJuaW5nIGp1c3QgXCJ0YXJnZXRcIi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RXaWtpbGlua3MoY29udGVudDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBsaW5rczogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgcmVnZXggPSAvXFxbXFxbKFteXFxdXSspXFxdXFxdL2c7XG4gIGxldCBtYXRjaDtcblxuICB3aGlsZSAoKG1hdGNoID0gcmVnZXguZXhlYyhjb250ZW50KSkgIT09IG51bGwpIHtcbiAgICBsZXQgbGlua1RhcmdldCA9IG1hdGNoWzFdO1xuICAgIGNvbnN0IHBpcGVJbmRleCA9IGxpbmtUYXJnZXQuaW5kZXhPZihcInxcIik7XG4gICAgaWYgKHBpcGVJbmRleCAhPT0gLTEpIHtcbiAgICAgIGxpbmtUYXJnZXQgPSBsaW5rVGFyZ2V0LnN1YnN0cmluZygwLCBwaXBlSW5kZXgpO1xuICAgIH1cbiAgICBsaW5rcy5wdXNoKGxpbmtUYXJnZXQudHJpbSgpKTtcbiAgfVxuXG4gIHJldHVybiBsaW5rcztcbn1cbiIsICJpbXBvcnQgeyBQYXJzZWRGaWxlLCBleHRyYWN0T2JqZWN0TGlua3MsIGV4dHJhY3RXaWtpbGlua3MgfSBmcm9tIFwiLi9wYXJzZXJcIjtcblxuZXhwb3J0IGludGVyZmFjZSBHcmFwaE5vZGUge1xuICBpZDogc3RyaW5nO1xuICBsYWJlbDogc3RyaW5nO1xuICAvKiogXCJvYmplY3RcIiBmb3IgbXVsdGktb2JqZWN0IGVudHJpZXMsIFwiZmlsZVwiIGZvciByZWd1bGFyIHZhdWx0IGZpbGVzICovXG4gIHR5cGU6IFwib2JqZWN0XCIgfCBcImZpbGVcIjtcbiAgZmlsZVBhdGg6IHN0cmluZztcbiAgZmlsZUxhYmVsOiBzdHJpbmc7XG4gIHByb3BlcnRpZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIC8qKiAwLWluZGV4ZWQgc3RhcnQgbGluZSBpbiB0aGUgc291cmNlIGZpbGUgKG9iamVjdHMgb25seSkgKi9cbiAgc3RhcnRMaW5lOiBudW1iZXI7XG4gIC8qKiBOdW1iZXIgb2YgY29ubmVjdGlvbnMgKi9cbiAgY29ubmVjdGlvbnM6IG51bWJlcjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBHcmFwaEVkZ2Uge1xuICBzb3VyY2U6IHN0cmluZztcbiAgdGFyZ2V0OiBzdHJpbmc7XG4gIC8qKiBcIm9iamVjdFwiIGlmIHRoaXMgZWRnZSBpbnZvbHZlcyBhIHt7fX0gbGluaywgXCJ3aWtpXCIgZm9yIG5hdGl2ZSBbW11dIGxpbmtzICovXG4gIGVkZ2VUeXBlOiBcIm9iamVjdFwiIHwgXCJ3aWtpXCI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgR3JhcGhEYXRhIHtcbiAgbm9kZXM6IEdyYXBoTm9kZVtdO1xuICBlZGdlczogR3JhcGhFZGdlW107XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgVmF1bHRGaWxlIHtcbiAgcGF0aDogc3RyaW5nO1xuICBiYXNlbmFtZTogc3RyaW5nO1xuICBjb250ZW50OiBzdHJpbmc7XG59XG5cbi8qKlxuICogQnVpbGQgdGhlIGZ1bGwgZ3JhcGggZnJvbSB0aGUgdmF1bHQuXG4gKlxuICogTm9kZXM6XG4gKiAgIC0gRWFjaCBvYmplY3QgaW4gYSBtdWx0aS1vYmplY3QgZmlsZSAtPiB0eXBlIFwib2JqZWN0XCJcbiAqICAgLSBFYWNoIHJlZ3VsYXIgdmF1bHQgZmlsZSB0aGF0IHBhcnRpY2lwYXRlcyBpbiBhbnkgbGluayAtPiB0eXBlIFwiZmlsZVwiXG4gKlxuICogRWRnZXM6XG4gKiAgIC0gZmlsZSAtPiBvYmplY3QgIHdoZW4gYSBmaWxlIGNvbnRhaW5zIHt7T2JqZWN0S2V5fX1cbiAqICAgLSBmaWxlIC0+IGZpbGUgICAgd2hlbiBhIGZpbGUgY29udGFpbnMgW1tPdGhlckZpbGVdXSAobmF0aXZlIHdpa2lsaW5rcylcbiAqICAgLSBvYmplY3QgLT4gb2JqZWN0IHdoZW4gYW4gb2JqZWN0J3MgcHJvcGVydHkgdmFsdWUgY29udGFpbnMge3tPdGhlck9iamVjdH19XG4gKlxuICogTXVsdGktb2JqZWN0IHNvdXJjZSBmaWxlcyAoZS5nLiwgRmlsbXMubWQpIGRvIE5PVCBhcHBlYXIgYXMgZmlsZSBub2RlcztcbiAqIG9ubHkgdGhlaXIgaW5kaXZpZHVhbCBvYmplY3RzIGRvLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRHcmFwaChcbiAgcGFyc2VkRmlsZXM6IFBhcnNlZEZpbGVbXSxcbiAgYWxsRmlsZXM6IFZhdWx0RmlsZVtdXG4pOiBHcmFwaERhdGEge1xuICBjb25zdCBub2RlczogR3JhcGhOb2RlW10gPSBbXTtcbiAgY29uc3QgZWRnZXM6IEdyYXBoRWRnZVtdID0gW107XG4gIGNvbnN0IGVkZ2VTZXQgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgY29uc3Qgbm9kZU1hcCA9IG5ldyBNYXA8c3RyaW5nLCBHcmFwaE5vZGU+KCk7XG5cbiAgLy8gUGF0aHMgb2YgbXVsdGktb2JqZWN0IHNvdXJjZSBmaWxlcyAtLSB0aGVzZSBhcmUgcmVwbGFjZWQgYnkgdGhlaXIgb2JqZWN0c1xuICBjb25zdCBtdWx0aU9iamVjdFBhdGhzID0gbmV3IFNldChwYXJzZWRGaWxlcy5tYXAoKGYpID0+IGYuZmlsZVBhdGgpKTtcblxuICAvLyBNYXA6IGxvd2VyY2FzZSBrZXkgdmFsdWUgLT4gb2JqZWN0IG5vZGUgaWRcbiAgY29uc3Qgb2JqS2V5VG9Ob2RlSWQgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpO1xuXG4gIC8vIE1hcDogbG93ZXJjYXNlIGZpbGUgYmFzZW5hbWUgLT4gZmlsZSBwYXRoIChmb3IgcmVzb2x2aW5nIFtbd2lraWxpbmtzXV0pXG4gIGNvbnN0IGJhc2VuYW1lVG9QYXRoID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKTtcbiAgZm9yIChjb25zdCBmIG9mIGFsbEZpbGVzKSB7XG4gICAgYmFzZW5hbWVUb1BhdGguc2V0KGYuYmFzZW5hbWUudG9Mb3dlckNhc2UoKSwgZi5wYXRoKTtcbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCAxLiBDcmVhdGUgb2JqZWN0IG5vZGVzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuICBmb3IgKGNvbnN0IGZpbGUgb2YgcGFyc2VkRmlsZXMpIHtcbiAgICBmb3IgKGNvbnN0IG9iaiBvZiBmaWxlLm9iamVjdHMpIHtcbiAgICAgIGNvbnN0IG5vZGVJZCA9IGBvYmo6OiR7ZmlsZS5maWxlUGF0aH06OiR7b2JqLmRpc3BsYXlLZXl9YDtcbiAgICAgIGNvbnN0IG5vZGU6IEdyYXBoTm9kZSA9IHtcbiAgICAgICAgaWQ6IG5vZGVJZCxcbiAgICAgICAgbGFiZWw6IG9iai5kaXNwbGF5S2V5LFxuICAgICAgICB0eXBlOiBcIm9iamVjdFwiLFxuICAgICAgICBmaWxlUGF0aDogb2JqLmZpbGVQYXRoLFxuICAgICAgICBmaWxlTGFiZWw6IG9iai5maWxlTGFiZWwsXG4gICAgICAgIHByb3BlcnRpZXM6IG9iai5wcm9wZXJ0aWVzLFxuICAgICAgICBzdGFydExpbmU6IG9iai5zdGFydExpbmUsXG4gICAgICAgIGNvbm5lY3Rpb25zOiAwLFxuICAgICAgfTtcbiAgICAgIG5vZGVzLnB1c2gobm9kZSk7XG4gICAgICBub2RlTWFwLnNldChub2RlSWQsIG5vZGUpO1xuICAgICAgLy8gUmVnaXN0ZXIgYnkgZGlzcGxheUtleSAocHJpbWFyeSBsb29rdXAgZm9yIGRpc2FtYmlndWF0ZWQgbmFtZXMpXG4gICAgICBvYmpLZXlUb05vZGVJZC5zZXQob2JqLmRpc3BsYXlLZXkudG9Mb3dlckNhc2UoKSwgbm9kZUlkKTtcbiAgICAgIC8vIEFsc28gcmVnaXN0ZXIgYnkgcGxhaW4ga2V5VmFsdWUgaWYgbm90IGFscmVhZHkgdGFrZW4gKGJhY2t3YXJkcyBjb21wYXQpXG4gICAgICBjb25zdCBwbGFpbiA9IG9iai5rZXlWYWx1ZS50b0xvd2VyQ2FzZSgpO1xuICAgICAgaWYgKCFvYmpLZXlUb05vZGVJZC5oYXMocGxhaW4pKSB7XG4gICAgICAgIG9iaktleVRvTm9kZUlkLnNldChwbGFpbiwgbm9kZUlkKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyBIZWxwZXI6IGdldCBvciBjcmVhdGUgYSBmaWxlIG5vZGVcbiAgZnVuY3Rpb24gZW5zdXJlRmlsZU5vZGUocGF0aDogc3RyaW5nLCBiYXNlbmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBub2RlSWQgPSBgZmlsZTo6JHtwYXRofWA7XG4gICAgaWYgKCFub2RlTWFwLmhhcyhub2RlSWQpKSB7XG4gICAgICBjb25zdCBub2RlOiBHcmFwaE5vZGUgPSB7XG4gICAgICAgIGlkOiBub2RlSWQsXG4gICAgICAgIGxhYmVsOiBiYXNlbmFtZSxcbiAgICAgICAgdHlwZTogXCJmaWxlXCIsXG4gICAgICAgIGZpbGVQYXRoOiBwYXRoLFxuICAgICAgICBmaWxlTGFiZWw6IGJhc2VuYW1lLFxuICAgICAgICBwcm9wZXJ0aWVzOiB7fSxcbiAgICAgICAgc3RhcnRMaW5lOiAwLFxuICAgICAgICBjb25uZWN0aW9uczogMCxcbiAgICAgIH07XG4gICAgICBub2Rlcy5wdXNoKG5vZGUpO1xuICAgICAgbm9kZU1hcC5zZXQobm9kZUlkLCBub2RlKTtcbiAgICB9XG4gICAgcmV0dXJuIG5vZGVJZDtcbiAgfVxuXG4gIC8vIEhlbHBlcjogYWRkIGFuIGVkZ2UgKGRlZHVwbGljYXRlZClcbiAgZnVuY3Rpb24gYWRkRWRnZShzcmM6IHN0cmluZywgdGd0OiBzdHJpbmcsIHR5cGU6IFwib2JqZWN0XCIgfCBcIndpa2lcIik6IHZvaWQge1xuICAgIGNvbnN0IGVkZ2VJZCA9IFtzcmMsIHRndF0uc29ydCgpLmpvaW4oXCItLVwiKTtcbiAgICBpZiAoZWRnZVNldC5oYXMoZWRnZUlkKSkgcmV0dXJuO1xuICAgIGVkZ2VTZXQuYWRkKGVkZ2VJZCk7XG4gICAgZWRnZXMucHVzaCh7IHNvdXJjZTogc3JjLCB0YXJnZXQ6IHRndCwgZWRnZVR5cGU6IHR5cGUgfSk7XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgMi4gU2NhbiBhbGwgZmlsZXMgZm9yIGxpbmtzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuICBmb3IgKGNvbnN0IGZpbGUgb2YgYWxsRmlsZXMpIHtcbiAgICAvLyBTa2lwIG11bHRpLW9iamVjdCBzb3VyY2UgZmlsZXMgKHRoZWlyIG9iamVjdHMgYXJlIGFscmVhZHkgbm9kZXMpXG4gICAgaWYgKG11bHRpT2JqZWN0UGF0aHMuaGFzKGZpbGUucGF0aCkpIGNvbnRpbnVlO1xuXG4gICAgY29uc3Qgb2JqZWN0TGlua3MgPSBleHRyYWN0T2JqZWN0TGlua3MoZmlsZS5jb250ZW50KTtcbiAgICBjb25zdCB3aWtpbGlua3MgPSBleHRyYWN0V2lraWxpbmtzKGZpbGUuY29udGVudCk7XG5cbiAgICBsZXQgZmlsZU5vZGVJZDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG5cbiAgICAvLyB7e29iamVjdCBsaW5rc319IC0+IGZpbGUtdG8tb2JqZWN0IGVkZ2VzXG4gICAgZm9yIChjb25zdCBsaW5rIG9mIG9iamVjdExpbmtzKSB7XG4gICAgICBjb25zdCB0YXJnZXRPYmpJZCA9IG9iaktleVRvTm9kZUlkLmdldChsaW5rLnRvTG93ZXJDYXNlKCkpO1xuICAgICAgaWYgKHRhcmdldE9iaklkKSB7XG4gICAgICAgIGlmICghZmlsZU5vZGVJZCkgZmlsZU5vZGVJZCA9IGVuc3VyZUZpbGVOb2RlKGZpbGUucGF0aCwgZmlsZS5iYXNlbmFtZSk7XG4gICAgICAgIGFkZEVkZ2UoZmlsZU5vZGVJZCwgdGFyZ2V0T2JqSWQsIFwib2JqZWN0XCIpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFtbd2lraWxpbmtzXV0gLT4gZmlsZS10by1maWxlIGVkZ2VzXG4gICAgZm9yIChjb25zdCBsaW5rIG9mIHdpa2lsaW5rcykge1xuICAgICAgY29uc3QgdGFyZ2V0UGF0aCA9IGJhc2VuYW1lVG9QYXRoLmdldChsaW5rLnRvTG93ZXJDYXNlKCkpO1xuICAgICAgaWYgKCF0YXJnZXRQYXRoKSBjb250aW51ZTtcbiAgICAgIC8vIERvbid0IGxpbmsgdG8gbXVsdGktb2JqZWN0IHNvdXJjZSBmaWxlcyBhcyBmaWxlIG5vZGVzXG4gICAgICBpZiAobXVsdGlPYmplY3RQYXRocy5oYXModGFyZ2V0UGF0aCkpIGNvbnRpbnVlO1xuXG4gICAgICAvLyBGaW5kIHRoZSB0YXJnZXQgZmlsZSB0byBnZXQgaXRzIGJhc2VuYW1lXG4gICAgICBjb25zdCB0YXJnZXRGaWxlID0gYWxsRmlsZXMuZmluZCgoZikgPT4gZi5wYXRoID09PSB0YXJnZXRQYXRoKTtcbiAgICAgIGlmICghdGFyZ2V0RmlsZSkgY29udGludWU7XG5cbiAgICAgIGlmICghZmlsZU5vZGVJZCkgZmlsZU5vZGVJZCA9IGVuc3VyZUZpbGVOb2RlKGZpbGUucGF0aCwgZmlsZS5iYXNlbmFtZSk7XG4gICAgICBjb25zdCB0YXJnZXRGaWxlSWQgPSBlbnN1cmVGaWxlTm9kZSh0YXJnZXRQYXRoLCB0YXJnZXRGaWxlLmJhc2VuYW1lKTtcblxuICAgICAgaWYgKGZpbGVOb2RlSWQgIT09IHRhcmdldEZpbGVJZCkge1xuICAgICAgICBhZGRFZGdlKGZpbGVOb2RlSWQsIHRhcmdldEZpbGVJZCwgXCJ3aWtpXCIpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCAzLiBPYmplY3QtdG8tb2JqZWN0IGxpbmtzIHZpYSB7e319IGluIHByb3BlcnR5IHZhbHVlcyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcbiAgZm9yIChjb25zdCBmaWxlIG9mIHBhcnNlZEZpbGVzKSB7XG4gICAgZm9yIChjb25zdCBvYmogb2YgZmlsZS5vYmplY3RzKSB7XG4gICAgICBjb25zdCBzcmNJZCA9IGBvYmo6OiR7ZmlsZS5maWxlUGF0aH06OiR7b2JqLmRpc3BsYXlLZXl9YDtcbiAgICAgIGZvciAoY29uc3QgdmFsIG9mIE9iamVjdC52YWx1ZXMob2JqLnByb3BlcnRpZXMpKSB7XG4gICAgICAgIGZvciAoY29uc3QgbGluayBvZiBleHRyYWN0T2JqZWN0TGlua3ModmFsKSkge1xuICAgICAgICAgIGNvbnN0IHRndElkID0gb2JqS2V5VG9Ob2RlSWQuZ2V0KGxpbmsudG9Mb3dlckNhc2UoKSk7XG4gICAgICAgICAgaWYgKHRndElkICYmIHRndElkICE9PSBzcmNJZCkge1xuICAgICAgICAgICAgYWRkRWRnZShzcmNJZCwgdGd0SWQsIFwib2JqZWN0XCIpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCA0LiBDb3VudCBjb25uZWN0aW9ucyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcbiAgZm9yIChjb25zdCBlZGdlIG9mIGVkZ2VzKSB7XG4gICAgY29uc3Qgc3JjID0gbm9kZU1hcC5nZXQoZWRnZS5zb3VyY2UpO1xuICAgIGNvbnN0IHRndCA9IG5vZGVNYXAuZ2V0KGVkZ2UudGFyZ2V0KTtcbiAgICBpZiAoc3JjKSBzcmMuY29ubmVjdGlvbnMrKztcbiAgICBpZiAodGd0KSB0Z3QuY29ubmVjdGlvbnMrKztcbiAgfVxuXG4gIHJldHVybiB7IG5vZGVzLCBlZGdlcyB9O1xufVxuIiwgImltcG9ydCB7IEl0ZW1WaWV3LCBXb3Jrc3BhY2VMZWFmIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgeyBHcmFwaERhdGEgfSBmcm9tIFwiLi9ncmFwaC1kYXRhXCI7XG5pbXBvcnQgeyBDb25maWdQYW5lbCwgR3JhcGhDb25maWcsIERFRkFVTFRfQ09ORklHIH0gZnJvbSBcIi4vc2V0dGluZ3NcIjtcbmltcG9ydCB7XG4gIHNlbGVjdCxcbiAgZm9yY2VTaW11bGF0aW9uLFxuICBmb3JjZUxpbmssXG4gIGZvcmNlTWFueUJvZHksXG4gIGZvcmNlQ29sbGlkZSxcbiAgZm9yY2VYLFxuICBmb3JjZVksXG4gIHpvb20sXG4gIHpvb21JZGVudGl0eSxcbiAgem9vbVRyYW5zZm9ybSxcbiAgWm9vbUJlaGF2aW9yLFxuICBab29tVHJhbnNmb3JtLFxuICBTaW11bGF0aW9uLFxuICBTaW11bGF0aW9uTm9kZURhdHVtLFxuICBTaW11bGF0aW9uTGlua0RhdHVtLFxufSBmcm9tIFwiZDNcIjtcblxuZXhwb3J0IGNvbnN0IFZJRVdfVFlQRSA9IFwib2JqZWN0LWxpbmtzLWdyYXBoXCI7XG5cbi8qIFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFxuICAgU2ltdWxhdGlvbiBOb2RlL0VkZ2UgVHlwZXNcbiAgIFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MCAqL1xuXG50eXBlIE5vZGVUeXBlID0gXCJvYmplY3RcIiB8IFwiZmlsZVwiO1xuXG50eXBlIFNpbU5vZGUgPSBTaW11bGF0aW9uTm9kZURhdHVtICYge1xuICBpZDogc3RyaW5nO1xuICBsYWJlbDogc3RyaW5nO1xuICB0eXBlOiBOb2RlVHlwZTtcbiAgZmlsZVBhdGg6IHN0cmluZztcbiAgZmlsZUxhYmVsOiBzdHJpbmc7XG4gIHByb3BlcnRpZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIHN0YXJ0TGluZTogbnVtYmVyO1xuICBjb25uZWN0aW9uczogbnVtYmVyO1xuICByYWRpdXM6IG51bWJlcjtcbiAgLyoqIFRydWUgd2hlbiBub2RlIGhhZCAwIGNvbm5lY3Rpb25zIGluIHRoZSAqYmFzZSogZ3JhcGggKGV4Y2x1ZGluZyBvcHRpb25hbCBmb2xkZXIgZWRnZXMpLiAqL1xuICBpc09ycGhhbjogYm9vbGVhbjtcbiAgLyoqIEN1cnJlbnQgdmlzdWFsIGFscGhhIChpbnRlcnBvbGF0ZWQgZm9yIHNtb290aCB0cmFuc2l0aW9ucykgKi9cbiAgYWxwaGE6IG51bWJlcjtcbiAgLyoqIFRhcmdldCBhbHBoYSBiYXNlZCBvbiBoaWdobGlnaHQgc3RhdGUgKi9cbiAgdGFyZ2V0QWxwaGE6IG51bWJlcjtcbiAgLyoqIGQzIGZpeGVkIHBvc2l0aW9uICovXG4gIGZ4OiBudW1iZXIgfCBudWxsO1xuICBmeTogbnVtYmVyIHwgbnVsbDtcbn07XG5cbnR5cGUgU2ltRWRnZSA9IFNpbXVsYXRpb25MaW5rRGF0dW08U2ltTm9kZT4gJiB7XG4gIGVkZ2VUeXBlOiBcIm9iamVjdFwiIHwgXCJ3aWtpXCI7XG4gIC8qKiBDdXJyZW50IHZpc3VhbCBhbHBoYSAqL1xuICBhbHBoYTogbnVtYmVyO1xuICAvKiogVGFyZ2V0IGFscGhhICovXG4gIHRhcmdldEFscGhhOiBudW1iZXI7XG59O1xuXG4vKiBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcbiAgIENvbG9yIEhlbHBlcnNcbiAgIFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MCAqL1xuXG5mdW5jdGlvbiBwYXJzZUNvbG9yKGNzczogc3RyaW5nKTogW251bWJlciwgbnVtYmVyLCBudW1iZXJdIHtcbiAgaWYgKGNzcy5zdGFydHNXaXRoKFwiI1wiKSkge1xuICAgIGNvbnN0IGhleCA9IGNzcy5zbGljZSgxKTtcbiAgICBpZiAoaGV4Lmxlbmd0aCA9PT0gMykge1xuICAgICAgcmV0dXJuIFtcbiAgICAgICAgcGFyc2VJbnQoaGV4WzBdICsgaGV4WzBdLCAxNikgLyAyNTUsXG4gICAgICAgIHBhcnNlSW50KGhleFsxXSArIGhleFsxXSwgMTYpIC8gMjU1LFxuICAgICAgICBwYXJzZUludChoZXhbMl0gKyBoZXhbMl0sIDE2KSAvIDI1NSxcbiAgICAgIF07XG4gICAgfVxuICAgIHJldHVybiBbXG4gICAgICBwYXJzZUludChoZXguc2xpY2UoMCwgMiksIDE2KSAvIDI1NSxcbiAgICAgIHBhcnNlSW50KGhleC5zbGljZSgyLCA0KSwgMTYpIC8gMjU1LFxuICAgICAgcGFyc2VJbnQoaGV4LnNsaWNlKDQsIDYpLCAxNikgLyAyNTUsXG4gICAgXTtcbiAgfVxuICBjb25zdCBtID0gY3NzLm1hdGNoKC9yZ2JhP1xcKFxccyooXFxkKyksXFxzKihcXGQrKSxcXHMqKFxcZCspLyk7XG4gIGlmIChtKSByZXR1cm4gW3BhcnNlSW50KG1bMV0pIC8gMjU1LCBwYXJzZUludChtWzJdKSAvIDI1NSwgcGFyc2VJbnQobVszXSkgLyAyNTVdO1xuICByZXR1cm4gWzAuNiwgMC42LCAwLjZdO1xufVxuXG5mdW5jdGlvbiBnZXRUaGVtZUNvbG9yKGVsOiBIVE1MRWxlbWVudCwgdmFyTmFtZTogc3RyaW5nLCBmYWxsYmFjazogc3RyaW5nKTogW251bWJlciwgbnVtYmVyLCBudW1iZXJdIHtcbiAgY29uc3Qgc3R5bGUgPSBnZXRDb21wdXRlZFN0eWxlKGVsKTtcbiAgY29uc3QgdmFsID0gc3R5bGUuZ2V0UHJvcGVydHlWYWx1ZSh2YXJOYW1lKS50cmltKCk7XG4gIHJldHVybiBwYXJzZUNvbG9yKHZhbCB8fCBmYWxsYmFjayk7XG59XG5cbmZ1bmN0aW9uIGNvbG9yVG9DU1MoYzogW251bWJlciwgbnVtYmVyLCBudW1iZXJdKTogc3RyaW5nIHtcbiAgcmV0dXJuIGByZ2IoJHtNYXRoLnJvdW5kKGNbMF0gKiAyNTUpfSwke01hdGgucm91bmQoY1sxXSAqIDI1NSl9LCR7TWF0aC5yb3VuZChjWzJdICogMjU1KX0pYDtcbn1cblxuLyogXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXG4gICBMZXJwIGhlbHBlclxuICAgXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwICovXG5cbmZ1bmN0aW9uIGxlcnAoYTogbnVtYmVyLCBiOiBudW1iZXIsIHQ6IG51bWJlcik6IG51bWJlciB7XG4gIHJldHVybiBhICsgKGIgLSBhKSAqIHQ7XG59XG5cbi8qIFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFxuICAgR3JhcGhWaWV3IFx1MjAxNCBDYW52YXMgKyBkMy1mb3JjZVxuICAgXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwICovXG5cbmV4cG9ydCBjbGFzcyBHcmFwaFZpZXcgZXh0ZW5kcyBJdGVtVmlldyB7XG4gIHByaXZhdGUgZ3JhcGhEYXRhOiBHcmFwaERhdGEgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzaW11bGF0aW9uOiBTaW11bGF0aW9uPFNpbU5vZGUsIFNpbUVkZ2U+IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgcmVzaXplT2JzZXJ2ZXI6IFJlc2l6ZU9ic2VydmVyIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgY29uZmlnUGFuZWw6IENvbmZpZ1BhbmVsIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgY29uZmlnOiBHcmFwaENvbmZpZyA9IHsgLi4uREVGQVVMVF9DT05GSUcgfTtcblxuICAvLyBDYW52YXMgc3RhdGVcbiAgcHJpdmF0ZSBjYW52YXNXcmFwcGVyOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGNhbnZhc0VsOiBIVE1MQ2FudmFzRWxlbWVudCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGN0eDogQ2FudmFzUmVuZGVyaW5nQ29udGV4dDJEIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgZHByID0gMTtcblxuICAvLyBkMy16b29tXG4gIHByaXZhdGUgem9vbUJlaGF2aW9yOiBab29tQmVoYXZpb3I8SFRNTENhbnZhc0VsZW1lbnQsIHVua25vd24+IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgem9vbVRyYW5zZm9ybTogWm9vbVRyYW5zZm9ybSA9IHpvb21JZGVudGl0eTtcbiAgcHJpdmF0ZSBpc1N5bmNpbmdab29tID0gZmFsc2U7XG5cbiAgLy8gU2ltIGRhdGFcbiAgcHJpdmF0ZSBzaW1Ob2RlczogU2ltTm9kZVtdID0gW107XG4gIHByaXZhdGUgc2ltRWRnZXM6IFNpbUVkZ2VbXSA9IFtdO1xuXG4gIC8vIENhbWVyYSAoY3VycmVudCA9IHNtb290aGVkLCB0YXJnZXQgPSB3aGVyZSB3ZSB3YW50IHRvIGJlKVxuICBwcml2YXRlIGNhbVggPSAwO1xuICBwcml2YXRlIGNhbVkgPSAwO1xuICBwcml2YXRlIGNhbVNjYWxlID0gMC43O1xuICBwcml2YXRlIHRhcmdldENhbVggPSAwO1xuICBwcml2YXRlIHRhcmdldENhbVkgPSAwO1xuICBwcml2YXRlIHRhcmdldENhbVNjYWxlID0gMC43O1xuXG4gIC8vIEludGVyYWN0aW9uIHN0YXRlXG4gIHByaXZhdGUgaG92ZXJlZE5vZGU6IFNpbU5vZGUgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzZWxlY3RlZE5vZGU6IFNpbU5vZGUgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBkcmFnTm9kZTogU2ltTm9kZSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGlzRHJhZ2dpbmcgPSBmYWxzZTtcbiAgcHJpdmF0ZSBsYXN0Q2xpY2tUaW1lID0gMDtcbiAgcHJpdmF0ZSBsYXN0Q2xpY2tJZCA9IFwiXCI7XG5cbiAgLy8gUmVuZGVyIGxvb3BcbiAgcHJpdmF0ZSByZW5kZXJMb29wSWQ6IG51bWJlciA9IDA7XG4gIHByaXZhdGUgbmVlZHNSZWRyYXcgPSB0cnVlO1xuXG4gIC8vIFRoZW1lIGNvbG9ycyAoY2FjaGVkKVxuICBwcml2YXRlIGNvbG9yTm9kZU9iamVjdDogW251bWJlciwgbnVtYmVyLCBudW1iZXJdID0gWzAuNSwgMC41LCAxLjBdO1xuICBwcml2YXRlIGNvbG9yTm9kZUZpbGU6IFtudW1iZXIsIG51bWJlciwgbnVtYmVyXSA9IFswLjYsIDAuNiwgMC42XTtcbiAgcHJpdmF0ZSBjb2xvckVkZ2VXaWtpOiBbbnVtYmVyLCBudW1iZXIsIG51bWJlcl0gPSBbMC41LCAwLjUsIDAuNV07XG4gIHByaXZhdGUgY29sb3JFZGdlT2JqOiBbbnVtYmVyLCBudW1iZXIsIG51bWJlcl0gPSBbMC41LCAwLjUsIDEuMF07XG4gIHByaXZhdGUgY29sb3JIaWdobGlnaHQ6IFtudW1iZXIsIG51bWJlciwgbnVtYmVyXSA9IFswLjUsIDAuNSwgMS4wXTtcbiAgcHJpdmF0ZSBjb2xvckJnOiBbbnVtYmVyLCBudW1iZXIsIG51bWJlcl0gPSBbMC4xLCAwLjEsIDAuMV07XG4gIHByaXZhdGUgY29sb3JUZXh0ID0gXCIjZGNkZGRlXCI7XG5cbiAgLy8gQ2FsbGJhY2tzXG4gIHB1YmxpYyBuYXZpZ2F0ZVRvT2JqZWN0OiAoKGZpbGVQYXRoOiBzdHJpbmcsIHN0YXJ0TGluZTogbnVtYmVyKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuICBwdWJsaWMgbmF2aWdhdGVUb0ZpbGU6ICgoZmlsZVBhdGg6IHN0cmluZykgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcblxuICAvLyBCb3VuZCBoYW5kbGVyc1xuICBwcml2YXRlIF9vbldoZWVsOiAoKGU6IFdoZWVsRXZlbnQpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgX29uTW91c2VEb3duOiAoKGU6IE1vdXNlRXZlbnQpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgX29uTW91c2VNb3ZlOiAoKGU6IE1vdXNlRXZlbnQpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgX29uTW91c2VVcDogKChlOiBNb3VzZUV2ZW50KSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIF9vbkRibENsaWNrOiAoKGU6IE1vdXNlRXZlbnQpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgX29uQ29udGFpbmVyTW91c2VEb3duOiAoKGU6IE1vdXNlRXZlbnQpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG5cbiAgY29uc3RydWN0b3IobGVhZjogV29ya3NwYWNlTGVhZikge1xuICAgIHN1cGVyKGxlYWYpO1xuICB9XG5cbiAgZ2V0Vmlld1R5cGUoKTogc3RyaW5nIHsgcmV0dXJuIFZJRVdfVFlQRTsgfVxuICBnZXREaXNwbGF5VGV4dCgpOiBzdHJpbmcgeyByZXR1cm4gXCJPYmplY3QgTGlua3NcIjsgfVxuICBnZXRJY29uKCk6IHN0cmluZyB7IHJldHVybiBcImdpdC1mb3JrXCI7IH1cblxuICBzZXRHcmFwaERhdGEoZGF0YTogR3JhcGhEYXRhKTogdm9pZCB7XG4gICAgdGhpcy5ncmFwaERhdGEgPSBkYXRhO1xuICAgIGlmICh0aGlzLmNvbnRhaW5lckVsKSB0aGlzLnJlbmRlckdyYXBoKCk7XG4gIH1cblxuICBhc3luYyBvbk9wZW4oKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgY29udGFpbmVyID0gdGhpcy5jb250ZW50RWw7XG4gICAgY29udGFpbmVyLmVtcHR5KCk7XG4gICAgY29udGFpbmVyLmFkZENsYXNzKFwib2wtZ3JhcGgtY29udGFpbmVyXCIpO1xuXG4gICAgaWYgKHRoaXMuZ3JhcGhEYXRhKSB7XG4gICAgICB0aGlzLnJlbmRlckdyYXBoKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnRhaW5lci5jcmVhdGVFbChcImRpdlwiLCB7XG4gICAgICAgIGNsczogXCJvbC1lbXB0eS1zdGF0ZVwiLFxuICAgICAgICB0ZXh0OiBcIk9wZW4gdGhlIGdyYXBoIHVzaW5nIHRoZSBjb21tYW5kIHBhbGV0dGUgb3IgcmliYm9uIGljb24uXCIsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBvbkNsb3NlKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuY2xlYW51cCgpO1xuICB9XG5cbiAgcHJpdmF0ZSBjbGVhbnVwKCk6IHZvaWQge1xuICAgIHRoaXMuc3RvcFJlbmRlckxvb3AoKTtcbiAgICBpZiAodGhpcy5zaW11bGF0aW9uKSB7XG4gICAgICB0aGlzLnNpbXVsYXRpb24uc3RvcCgpO1xuICAgICAgdGhpcy5zaW11bGF0aW9uLm9uKFwidGlja1wiLCBudWxsKTtcbiAgICAgIHRoaXMuc2ltdWxhdGlvbiA9IG51bGw7XG4gICAgfVxuICAgIGlmICh0aGlzLnJlc2l6ZU9ic2VydmVyKSB7IHRoaXMucmVzaXplT2JzZXJ2ZXIuZGlzY29ubmVjdCgpOyB0aGlzLnJlc2l6ZU9ic2VydmVyID0gbnVsbDsgfVxuICAgIGlmICh0aGlzLmNvbmZpZ1BhbmVsKSB7IHRoaXMuY29uZmlnUGFuZWwuZGVzdHJveSgpOyB0aGlzLmNvbmZpZ1BhbmVsID0gbnVsbDsgfVxuICAgIHRoaXMucmVtb3ZlQ2FudmFzTGlzdGVuZXJzKCk7XG4gICAgaWYgKHRoaXMuX29uQ29udGFpbmVyTW91c2VEb3duKSB7XG4gICAgICB0aGlzLmNvbnRlbnRFbC5yZW1vdmVFdmVudExpc3RlbmVyKFwibW91c2Vkb3duXCIsIHRoaXMuX29uQ29udGFpbmVyTW91c2VEb3duLCB0cnVlKTtcbiAgICAgIHRoaXMuX29uQ29udGFpbmVyTW91c2VEb3duID0gbnVsbDtcbiAgICB9XG5cbiAgICAvLyBSZW1vdmUgZml4ZWQgdG9vbHRpcCBmcm9tIGJvZHlcbiAgICBjb25zdCB0b29sdGlwID0gZG9jdW1lbnQuYm9keS5xdWVyeVNlbGVjdG9yKFwiLm9sLXRvb2x0aXBcIik7XG4gICAgaWYgKHRvb2x0aXApIHRvb2x0aXAucmVtb3ZlKCk7XG5cbiAgICB0aGlzLnNpbU5vZGVzID0gW107XG4gICAgdGhpcy5zaW1FZGdlcyA9IFtdO1xuXG4gICAgdGhpcy5jYW52YXNFbD8ucmVtb3ZlKCk7XG4gICAgdGhpcy5jYW52YXNFbCA9IG51bGw7XG4gICAgdGhpcy5jdHggPSBudWxsO1xuICAgIHRoaXMuY2FudmFzV3JhcHBlciA9IG51bGw7XG4gIH1cblxuICBwcml2YXRlIHJlbW92ZUNhbnZhc0xpc3RlbmVycygpOiB2b2lkIHtcbiAgICBjb25zdCBjID0gdGhpcy5jYW52YXNFbDtcbiAgICBpZiAoIWMpIHJldHVybjtcbiAgICBpZiAodGhpcy5fb25XaGVlbCkgYy5yZW1vdmVFdmVudExpc3RlbmVyKFwid2hlZWxcIiwgdGhpcy5fb25XaGVlbCk7XG4gICAgLy8gbW91c2Vkb3duIHdhcyByZWdpc3RlcmVkIHdpdGggY2FwdHVyZTp0cnVlIHRvIGludGVyY2VwdCBiZWZvcmUgZDMtem9vbVxuICAgIGlmICh0aGlzLl9vbk1vdXNlRG93bikgYy5yZW1vdmVFdmVudExpc3RlbmVyKFwibW91c2Vkb3duXCIsIHRoaXMuX29uTW91c2VEb3duLCB0cnVlKTtcbiAgICBpZiAodGhpcy5fb25Nb3VzZU1vdmUpIGMucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm1vdXNlbW92ZVwiLCB0aGlzLl9vbk1vdXNlTW92ZSk7XG4gICAgaWYgKHRoaXMuX29uTW91c2VVcCkgYy5yZW1vdmVFdmVudExpc3RlbmVyKFwibW91c2V1cFwiLCB0aGlzLl9vbk1vdXNlVXApO1xuICAgIGlmICh0aGlzLl9vbkRibENsaWNrKSBjLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJkYmxjbGlja1wiLCB0aGlzLl9vbkRibENsaWNrKTtcbiAgfVxuXG4gIC8qIFx1MjUwMFx1MjUwMCBSZW5kZXIgbG9vcCBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cblxuICBwcml2YXRlIHN0YXJ0UmVuZGVyTG9vcCgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5yZW5kZXJMb29wSWQpIHJldHVybjtcbiAgICBjb25zdCBmcmFtZSA9ICgpID0+IHtcbiAgICAgIHRoaXMucmVuZGVyTG9vcElkID0gcmVxdWVzdEFuaW1hdGlvbkZyYW1lKGZyYW1lKTtcbiAgICAgIHRoaXMudXBkYXRlQW5kRHJhdygpO1xuICAgIH07XG4gICAgdGhpcy5yZW5kZXJMb29wSWQgPSByZXF1ZXN0QW5pbWF0aW9uRnJhbWUoZnJhbWUpO1xuICB9XG5cbiAgcHJpdmF0ZSBzdG9wUmVuZGVyTG9vcCgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5yZW5kZXJMb29wSWQpIHtcbiAgICAgIGNhbmNlbEFuaW1hdGlvbkZyYW1lKHRoaXMucmVuZGVyTG9vcElkKTtcbiAgICAgIHRoaXMucmVuZGVyTG9vcElkID0gMDtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHVwZGF0ZUFuZERyYXcoKTogdm9pZCB7XG4gICAgbGV0IGFuaW1hdGluZyA9IGZhbHNlO1xuXG4gICAgLy8gU21vb3RoIGNhbWVyYSBpbnRlcnBvbGF0aW9uXG4gICAgY29uc3QgY2FtTGVycCA9IDAuMTU7XG4gICAgaWYgKE1hdGguYWJzKHRoaXMuY2FtWCAtIHRoaXMudGFyZ2V0Q2FtWCkgPiAwLjAxIHx8XG4gICAgICAgIE1hdGguYWJzKHRoaXMuY2FtWSAtIHRoaXMudGFyZ2V0Q2FtWSkgPiAwLjAxIHx8XG4gICAgICAgIE1hdGguYWJzKHRoaXMuY2FtU2NhbGUgLSB0aGlzLnRhcmdldENhbVNjYWxlKSA+IDAuMDAwMSkge1xuICAgICAgdGhpcy5jYW1YID0gbGVycCh0aGlzLmNhbVgsIHRoaXMudGFyZ2V0Q2FtWCwgY2FtTGVycCk7XG4gICAgICB0aGlzLmNhbVkgPSBsZXJwKHRoaXMuY2FtWSwgdGhpcy50YXJnZXRDYW1ZLCBjYW1MZXJwKTtcbiAgICAgIHRoaXMuY2FtU2NhbGUgPSBsZXJwKHRoaXMuY2FtU2NhbGUsIHRoaXMudGFyZ2V0Q2FtU2NhbGUsIGNhbUxlcnApO1xuICAgICAgaWYgKE1hdGguYWJzKHRoaXMuY2FtU2NhbGUgLSB0aGlzLnRhcmdldENhbVNjYWxlKSA8IDAuMDAwMSkge1xuICAgICAgICB0aGlzLmNhbVNjYWxlID0gdGhpcy50YXJnZXRDYW1TY2FsZTtcbiAgICAgICAgdGhpcy5jYW1YID0gdGhpcy50YXJnZXRDYW1YO1xuICAgICAgICB0aGlzLmNhbVkgPSB0aGlzLnRhcmdldENhbVk7XG4gICAgICB9XG4gICAgICBhbmltYXRpbmcgPSB0cnVlO1xuICAgIH1cblxuICAgIC8vIFNtb290aCBhbHBoYSBpbnRlcnBvbGF0aW9uIGZvciBub2Rlcy9lZGdlc1xuICAgIGNvbnN0IGFscGhhTGVycCA9IDAuMTI7XG4gICAgZm9yIChjb25zdCBuIG9mIHRoaXMuc2ltTm9kZXMpIHtcbiAgICAgIGlmIChNYXRoLmFicyhuLmFscGhhIC0gbi50YXJnZXRBbHBoYSkgPiAwLjAwNSkge1xuICAgICAgICBuLmFscGhhID0gbGVycChuLmFscGhhLCBuLnRhcmdldEFscGhhLCBhbHBoYUxlcnApO1xuICAgICAgICBhbmltYXRpbmcgPSB0cnVlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbi5hbHBoYSA9IG4udGFyZ2V0QWxwaGE7XG4gICAgICB9XG4gICAgfVxuICAgIGZvciAoY29uc3QgZSBvZiB0aGlzLnNpbUVkZ2VzKSB7XG4gICAgICBpZiAoTWF0aC5hYnMoZS5hbHBoYSAtIGUudGFyZ2V0QWxwaGEpID4gMC4wMDUpIHtcbiAgICAgICAgZS5hbHBoYSA9IGxlcnAoZS5hbHBoYSwgZS50YXJnZXRBbHBoYSwgYWxwaGFMZXJwKTtcbiAgICAgICAgYW5pbWF0aW5nID0gdHJ1ZTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGUuYWxwaGEgPSBlLnRhcmdldEFscGhhO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHNpbUFjdGl2ZSA9ICh0aGlzLnNpbXVsYXRpb24/LmFscGhhKCkgPz8gMCkgPiAwLjAwMTtcblxuICAgIGlmIChhbmltYXRpbmcgfHwgc2ltQWN0aXZlIHx8IHRoaXMubmVlZHNSZWRyYXcpIHtcbiAgICAgIHRoaXMubmVlZHNSZWRyYXcgPSBmYWxzZTtcbiAgICAgIHRoaXMuZHJhdygpO1xuICAgIH1cbiAgfVxuXG4gIC8qIFx1MjUwMFx1MjUwMCBGaWx0ZXJpbmcgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwICovXG5cbiAgcHJpdmF0ZSBhcHBseUZpbHRlcnMoZGF0YTogR3JhcGhEYXRhKTogR3JhcGhEYXRhIHtcbiAgICBjb25zdCBjID0gdGhpcy5jb25maWc7XG4gICAgbGV0IG5vZGVzID0gWy4uLmRhdGEubm9kZXNdO1xuICAgIGxldCBlZGdlcyA9IFsuLi5kYXRhLmVkZ2VzXTtcblxuICAgIGlmICghYy5zaG93RmlsZXMpIHtcbiAgICAgIGNvbnN0IGlkcyA9IG5ldyBTZXQobm9kZXMuZmlsdGVyKChuKSA9PiBuLnR5cGUgPT09IFwiZmlsZVwiKS5tYXAoKG4pID0+IG4uaWQpKTtcbiAgICAgIG5vZGVzID0gbm9kZXMuZmlsdGVyKChuKSA9PiBuLnR5cGUgIT09IFwiZmlsZVwiKTtcbiAgICAgIGVkZ2VzID0gZWRnZXMuZmlsdGVyKChlKSA9PiAhaWRzLmhhcyhlLnNvdXJjZSkgJiYgIWlkcy5oYXMoZS50YXJnZXQpKTtcbiAgICB9XG4gICAgaWYgKCFjLnNob3dPYmplY3RzKSB7XG4gICAgICBjb25zdCBpZHMgPSBuZXcgU2V0KG5vZGVzLmZpbHRlcigobikgPT4gbi50eXBlID09PSBcIm9iamVjdFwiKS5tYXAoKG4pID0+IG4uaWQpKTtcbiAgICAgIG5vZGVzID0gbm9kZXMuZmlsdGVyKChuKSA9PiBuLnR5cGUgIT09IFwib2JqZWN0XCIpO1xuICAgICAgZWRnZXMgPSBlZGdlcy5maWx0ZXIoKGUpID0+ICFpZHMuaGFzKGUuc291cmNlKSAmJiAhaWRzLmhhcyhlLnRhcmdldCkpO1xuICAgIH1cbiAgICBpZiAoIWMuc2hvd1dpa2lFZGdlcykgZWRnZXMgPSBlZGdlcy5maWx0ZXIoKGUpID0+IGUuZWRnZVR5cGUgIT09IFwid2lraVwiKTtcbiAgICBpZiAoIWMuc2hvd09iamVjdEVkZ2VzKSBlZGdlcyA9IGVkZ2VzLmZpbHRlcigoZSkgPT4gZS5lZGdlVHlwZSAhPT0gXCJvYmplY3RcIik7XG4gICAgaWYgKGMuc2VhcmNoKSB7XG4gICAgICBjb25zdCBxID0gYy5zZWFyY2gudG9Mb3dlckNhc2UoKTtcbiAgICAgIGNvbnN0IG1hdGNoZWQgPSBuZXcgU2V0KG5vZGVzLmZpbHRlcigobikgPT4gbi5sYWJlbC50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHEpKS5tYXAoKG4pID0+IG4uaWQpKTtcbiAgICAgIGZvciAoY29uc3QgZSBvZiBlZGdlcykge1xuICAgICAgICBpZiAobWF0Y2hlZC5oYXMoZS5zb3VyY2UpKSBtYXRjaGVkLmFkZChlLnRhcmdldCk7XG4gICAgICAgIGlmIChtYXRjaGVkLmhhcyhlLnRhcmdldCkpIG1hdGNoZWQuYWRkKGUuc291cmNlKTtcbiAgICAgIH1cbiAgICAgIG5vZGVzID0gbm9kZXMuZmlsdGVyKChuKSA9PiBtYXRjaGVkLmhhcyhuLmlkKSk7XG4gICAgICBjb25zdCBub2RlSWRzID0gbmV3IFNldChub2Rlcy5tYXAoKG4pID0+IG4uaWQpKTtcbiAgICAgIGVkZ2VzID0gZWRnZXMuZmlsdGVyKChlKSA9PiBub2RlSWRzLmhhcyhlLnNvdXJjZSkgJiYgbm9kZUlkcy5oYXMoZS50YXJnZXQpKTtcbiAgICB9XG4gICAgaWYgKGMucGF0aEZpbHRlcikge1xuICAgICAgY29uc3QgcGYgPSBjLnBhdGhGaWx0ZXIudG9Mb3dlckNhc2UoKTtcbiAgICAgIGNvbnN0IG1hdGNoZWQgPSBuZXcgU2V0KG5vZGVzLmZpbHRlcigobikgPT4gbi5maWxlUGF0aC50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHBmKSkubWFwKChuKSA9PiBuLmlkKSk7XG4gICAgICBmb3IgKGNvbnN0IGUgb2YgZWRnZXMpIHtcbiAgICAgICAgaWYgKG1hdGNoZWQuaGFzKGUuc291cmNlKSkgbWF0Y2hlZC5hZGQoZS50YXJnZXQpO1xuICAgICAgICBpZiAobWF0Y2hlZC5oYXMoZS50YXJnZXQpKSBtYXRjaGVkLmFkZChlLnNvdXJjZSk7XG4gICAgICB9XG4gICAgICBub2RlcyA9IG5vZGVzLmZpbHRlcigobikgPT4gbWF0Y2hlZC5oYXMobi5pZCkpO1xuICAgICAgY29uc3Qgbm9kZUlkcyA9IG5ldyBTZXQobm9kZXMubWFwKChuKSA9PiBuLmlkKSk7XG4gICAgICBlZGdlcyA9IGVkZ2VzLmZpbHRlcigoZSkgPT4gbm9kZUlkcy5oYXMoZS5zb3VyY2UpICYmIG5vZGVJZHMuaGFzKGUudGFyZ2V0KSk7XG4gICAgfVxuICAgIGlmIChjLnNvdXJjZUZpbHRlcikge1xuICAgICAgY29uc3Qgc2YgPSBjLnNvdXJjZUZpbHRlci50b0xvd2VyQ2FzZSgpO1xuICAgICAgY29uc3QgcmVtb3ZlZCA9IG5ldyBTZXQoXG4gICAgICAgIG5vZGVzLmZpbHRlcigobikgPT4gbi50eXBlID09PSBcIm9iamVjdFwiICYmICFuLmZpbGVMYWJlbC50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHNmKSkubWFwKChuKSA9PiBuLmlkKVxuICAgICAgKTtcbiAgICAgIG5vZGVzID0gbm9kZXMuZmlsdGVyKChuKSA9PiAhcmVtb3ZlZC5oYXMobi5pZCkpO1xuICAgICAgZWRnZXMgPSBlZGdlcy5maWx0ZXIoKGUpID0+ICFyZW1vdmVkLmhhcyhlLnNvdXJjZSkgJiYgIXJlbW92ZWQuaGFzKGUudGFyZ2V0KSk7XG4gICAgfVxuICAgIGlmICghYy5zaG93T3JwaGFucykge1xuICAgICAgY29uc3QgY29ubmVjdGVkID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgICBmb3IgKGNvbnN0IGUgb2YgZWRnZXMpIHsgY29ubmVjdGVkLmFkZChlLnNvdXJjZSk7IGNvbm5lY3RlZC5hZGQoZS50YXJnZXQpOyB9XG4gICAgICBub2RlcyA9IG5vZGVzLmZpbHRlcigobikgPT4gY29ubmVjdGVkLmhhcyhuLmlkKSk7XG4gICAgfVxuXG4gICAgY29uc3QgY2MgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xuICAgIGZvciAoY29uc3QgZSBvZiBlZGdlcykge1xuICAgICAgY2Muc2V0KGUuc291cmNlLCAoY2MuZ2V0KGUuc291cmNlKSB8fCAwKSArIDEpO1xuICAgICAgY2Muc2V0KGUudGFyZ2V0LCAoY2MuZ2V0KGUudGFyZ2V0KSB8fCAwKSArIDEpO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IG4gb2Ygbm9kZXMpIG4uY29ubmVjdGlvbnMgPSBjYy5nZXQobi5pZCkgfHwgMDtcblxuICAgIHJldHVybiB7IG5vZGVzLCBlZGdlcyB9O1xuICB9XG5cbiAgLyogXHUyNTAwXHUyNTAwIE5vZGUgcmFkaXVzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMCAqL1xuXG4gIHByaXZhdGUgZ2V0Tm9kZVJhZGl1cyhuOiB7IHR5cGU6IHN0cmluZzsgY29ubmVjdGlvbnM6IG51bWJlciB9KTogbnVtYmVyIHtcbiAgICBjb25zdCBtID0gdGhpcy5jb25maWcubm9kZVNpemVNdWx0aXBsaWVyO1xuICAgIGNvbnN0IGJhc2UgPSBuLnR5cGUgPT09IFwiZmlsZVwiID8gNC41IDogNS41O1xuICAgIGNvbnN0IGRlZyA9IE1hdGgubWF4KDAsIG4uY29ubmVjdGlvbnMpO1xuICAgIGNvbnN0IGJ1bXAgPSBNYXRoLm1pbigxMCwgTWF0aC5zcXJ0KGRlZykgKiAxLjYpO1xuICAgIHJldHVybiAoYmFzZSArIGJ1bXApICogbTtcbiAgfVxuXG4gIC8qIFx1MjUwMFx1MjUwMCBUaGVtZSBjb2xvcnMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwICovXG5cbiAgcHJpdmF0ZSByZWZyZXNoQ29sb3JzKCk6IHZvaWQge1xuICAgIGNvbnN0IGVsID0gdGhpcy5jb250ZW50RWw7XG4gICAgdGhpcy5jb2xvck5vZGVPYmplY3QgPSBnZXRUaGVtZUNvbG9yKGVsLCBcIi0taW50ZXJhY3RpdmUtYWNjZW50XCIsIFwiIzdmNmRmMlwiKTtcbiAgICB0aGlzLmNvbG9yTm9kZUZpbGUgPSBnZXRUaGVtZUNvbG9yKGVsLCBcIi0tdGV4dC1tdXRlZFwiLCBcIiM5OTk5OTlcIik7XG4gICAgdGhpcy5jb2xvckVkZ2VXaWtpID0gZ2V0VGhlbWVDb2xvcihlbCwgXCItLWJhY2tncm91bmQtbW9kaWZpZXItYm9yZGVyXCIsIFwiIzU1NTU1NVwiKTtcbiAgICB0aGlzLmNvbG9yRWRnZU9iaiA9IGdldFRoZW1lQ29sb3IoZWwsIFwiLS1pbnRlcmFjdGl2ZS1hY2NlbnRcIiwgXCIjN2Y2ZGYyXCIpO1xuICAgIHRoaXMuY29sb3JIaWdobGlnaHQgPSBnZXRUaGVtZUNvbG9yKGVsLCBcIi0taW50ZXJhY3RpdmUtYWNjZW50XCIsIFwiIzdmNmRmMlwiKTtcbiAgICB0aGlzLmNvbG9yQmcgPSBnZXRUaGVtZUNvbG9yKGVsLCBcIi0tYmFja2dyb3VuZC1wcmltYXJ5XCIsIFwiIzFlMWUxZVwiKTtcbiAgICBjb25zdCBzdHlsZSA9IGdldENvbXB1dGVkU3R5bGUoZWwpO1xuICAgIHRoaXMuY29sb3JUZXh0ID0gc3R5bGUuZ2V0UHJvcGVydHlWYWx1ZShcIi0tdGV4dC1ub3JtYWxcIikudHJpbSgpIHx8IFwiI2RjZGRkZVwiO1xuICB9XG5cbiAgLyogXHUyNTAwXHUyNTAwIENvb3JkaW5hdGUgdHJhbnNmb3JtcyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cblxuICBwcml2YXRlIGdldFNjcmVlblNpemUoKTogeyB3OiBudW1iZXI7IGg6IG51bWJlciB9IHtcbiAgICBjb25zdCBjID0gdGhpcy5jYW52YXNFbDtcbiAgICBpZiAoIWMpIHJldHVybiB7IHc6IDAsIGg6IDAgfTtcbiAgICAvLyBVc2UgQ1NTIHBpeGVsczsgZHJhd2luZyBjb2RlIHVzZXMgQ1NTIHB4IGNvb3JkaW5hdGVzLlxuICAgIHJldHVybiB7IHc6IGMuY2xpZW50V2lkdGgsIGg6IGMuY2xpZW50SGVpZ2h0IH07XG4gIH1cblxuICBwcml2YXRlIHdvcmxkVG9TY3JlZW4od3g6IG51bWJlciwgd3k6IG51bWJlcik6IFtudW1iZXIsIG51bWJlcl0ge1xuICAgIGNvbnN0IHsgdywgaCB9ID0gdGhpcy5nZXRTY3JlZW5TaXplKCk7XG4gICAgcmV0dXJuIFtcbiAgICAgICh3eCAtIHRoaXMuY2FtWCkgKiB0aGlzLmNhbVNjYWxlICsgdyAvIDIsXG4gICAgICAod3kgLSB0aGlzLmNhbVkpICogdGhpcy5jYW1TY2FsZSArIGggLyAyLFxuICAgIF07XG4gIH1cblxuICBwcml2YXRlIHNjcmVlblRvV29ybGQoc3g6IG51bWJlciwgc3k6IG51bWJlcik6IFtudW1iZXIsIG51bWJlcl0ge1xuICAgIGNvbnN0IHsgdywgaCB9ID0gdGhpcy5nZXRTY3JlZW5TaXplKCk7XG4gICAgcmV0dXJuIFtcbiAgICAgIChzeCAtIHcgLyAyKSAvIHRoaXMuY2FtU2NhbGUgKyB0aGlzLmNhbVgsXG4gICAgICAoc3kgLSBoIC8gMikgLyB0aGlzLmNhbVNjYWxlICsgdGhpcy5jYW1ZLFxuICAgIF07XG4gIH1cblxuICBwcml2YXRlIHNjcmVlblRvV29ybGRUYXJnZXQoc3g6IG51bWJlciwgc3k6IG51bWJlcik6IFtudW1iZXIsIG51bWJlcl0ge1xuICAgIGNvbnN0IHsgdywgaCB9ID0gdGhpcy5nZXRTY3JlZW5TaXplKCk7XG4gICAgcmV0dXJuIFtcbiAgICAgIChzeCAtIHcgLyAyKSAvIHRoaXMudGFyZ2V0Q2FtU2NhbGUgKyB0aGlzLnRhcmdldENhbVgsXG4gICAgICAoc3kgLSBoIC8gMikgLyB0aGlzLnRhcmdldENhbVNjYWxlICsgdGhpcy50YXJnZXRDYW1ZLFxuICAgIF07XG4gIH1cblxuICAvKiBcdTI1MDBcdTI1MDAgSGl0IHRlc3QgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwICovXG5cbiAgcHJpdmF0ZSBoaXRUZXN0Tm9kZShzeDogbnVtYmVyLCBzeTogbnVtYmVyKTogU2ltTm9kZSB8IG51bGwge1xuICAgIGNvbnN0IFt3eCwgd3ldID0gdGhpcy5zY3JlZW5Ub1dvcmxkKHN4LCBzeSk7XG4gICAgbGV0IGJlc3Q6IFNpbU5vZGUgfCBudWxsID0gbnVsbDtcbiAgICBsZXQgYmVzdERpc3QgPSBJbmZpbml0eTtcbiAgICBmb3IgKGNvbnN0IG4gb2YgdGhpcy5zaW1Ob2Rlcykge1xuICAgICAgY29uc3QgbnggPSBuLnggPz8gMDtcbiAgICAgIGNvbnN0IG55ID0gbi55ID8/IDA7XG4gICAgICBjb25zdCBkeCA9IG54IC0gd3g7XG4gICAgICBjb25zdCBkeSA9IG55IC0gd3k7XG4gICAgICBjb25zdCBkaXN0ID0gTWF0aC5zcXJ0KGR4ICogZHggKyBkeSAqIGR5KTtcbiAgICAgIGNvbnN0IGhpdFJhZGl1cyA9IE1hdGgubWF4KG4ucmFkaXVzICsgNCwgOCAvIHRoaXMuY2FtU2NhbGUpO1xuICAgICAgaWYgKGRpc3QgPCBoaXRSYWRpdXMgJiYgZGlzdCA8IGJlc3REaXN0KSB7XG4gICAgICAgIGJlc3QgPSBuO1xuICAgICAgICBiZXN0RGlzdCA9IGRpc3Q7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBiZXN0O1xuICB9XG5cbiAgLyogXHUyNTAwXHUyNTAwIFVwZGF0ZSBoaWdobGlnaHQgdGFyZ2V0cyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cblxuICBwcml2YXRlIHVwZGF0ZUhpZ2hsaWdodFRhcmdldHMoKTogdm9pZCB7XG4gICAgY29uc3QgZm9jdXMgPSB0aGlzLmhvdmVyZWROb2RlIHx8IHRoaXMuc2VsZWN0ZWROb2RlO1xuICAgIGlmICghZm9jdXMpIHtcbiAgICAgIGZvciAoY29uc3QgbiBvZiB0aGlzLnNpbU5vZGVzKSB7XG4gICAgICAgIG4udGFyZ2V0QWxwaGEgPSBuLnR5cGUgPT09IFwib2JqZWN0XCIgPyAwLjkgOiAwLjU7XG4gICAgICB9XG4gICAgICBmb3IgKGNvbnN0IGUgb2YgdGhpcy5zaW1FZGdlcykge1xuICAgICAgICBlLnRhcmdldEFscGhhID0gZS5lZGdlVHlwZSA9PT0gXCJ3aWtpXCIgPyAwLjM1IDogMC4yNTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBjb25uZWN0ZWQgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICBjb25uZWN0ZWQuYWRkKGZvY3VzLmlkKTtcbiAgICBmb3IgKGNvbnN0IGUgb2YgdGhpcy5zaW1FZGdlcykge1xuICAgICAgY29uc3QgcyA9IChlLnNvdXJjZSBhcyBTaW1Ob2RlKS5pZDtcbiAgICAgIGNvbnN0IHQgPSAoZS50YXJnZXQgYXMgU2ltTm9kZSkuaWQ7XG4gICAgICBpZiAocyA9PT0gZm9jdXMuaWQpIGNvbm5lY3RlZC5hZGQodCk7XG4gICAgICBpZiAodCA9PT0gZm9jdXMuaWQpIGNvbm5lY3RlZC5hZGQocyk7XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBuIG9mIHRoaXMuc2ltTm9kZXMpIHtcbiAgICAgIGlmIChuID09PSBmb2N1cykge1xuICAgICAgICBuLnRhcmdldEFscGhhID0gMS4wO1xuICAgICAgfSBlbHNlIGlmIChjb25uZWN0ZWQuaGFzKG4uaWQpKSB7XG4gICAgICAgIG4udGFyZ2V0QWxwaGEgPSBuLnR5cGUgPT09IFwib2JqZWN0XCIgPyAwLjkgOiAwLjc7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBuLnRhcmdldEFscGhhID0gMC4wNjtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGUgb2YgdGhpcy5zaW1FZGdlcykge1xuICAgICAgY29uc3QgcyA9IChlLnNvdXJjZSBhcyBTaW1Ob2RlKS5pZDtcbiAgICAgIGNvbnN0IHQgPSAoZS50YXJnZXQgYXMgU2ltTm9kZSkuaWQ7XG4gICAgICBpZiAocyA9PT0gZm9jdXMuaWQgfHwgdCA9PT0gZm9jdXMuaWQpIHtcbiAgICAgICAgZS50YXJnZXRBbHBoYSA9IDAuODtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGUudGFyZ2V0QWxwaGEgPSAwLjAzO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qIFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFxuICAgICBNYWluIFJlbmRlciBcdTIwMTQgY2FsbGVkIG9uY2Ugb24gaW5pdGlhbCBkYXRhLCBhbmQgb24gZmlsdGVyIGNoYW5nZXNcbiAgICAgXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwICovXG5cbiAgcHJpdmF0ZSByZW5kZXJHcmFwaCgpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMuZ3JhcGhEYXRhKSByZXR1cm47XG5cbiAgICBjb25zdCBjb250YWluZXIgPSB0aGlzLmNvbnRlbnRFbDtcbiAgICBjb25zdCBpc0ZpcnN0UmVuZGVyID0gIXRoaXMuY2FudmFzRWw7XG5cbiAgICBpZiAoaXNGaXJzdFJlbmRlcikge1xuICAgICAgY29udGFpbmVyLmVtcHR5KCk7XG4gICAgICBjb250YWluZXIuYWRkQ2xhc3MoXCJvbC1ncmFwaC1jb250YWluZXJcIik7XG5cbiAgICAgIC8vIENvbmZpZyBwYW5lbFxuICAgICAgdGhpcy5jb25maWdQYW5lbCA9IG5ldyBDb25maWdQYW5lbChjb250YWluZXIsIHRoaXMuY29uZmlnLCAobmV3Q29uZmlnKSA9PiB7XG4gICAgICAgIHRoaXMuaGFuZGxlQ29uZmlnQ2hhbmdlKG5ld0NvbmZpZyk7XG4gICAgICB9KTtcblxuICAgICAgLy8gQ2FudmFzIHdyYXBwZXJcbiAgICAgIHRoaXMuY2FudmFzV3JhcHBlciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICB0aGlzLmNhbnZhc1dyYXBwZXIuc3R5bGUuY3NzVGV4dCA9IFwicG9zaXRpb246YWJzb2x1dGU7aW5zZXQ6MDtcIjtcbiAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZCh0aGlzLmNhbnZhc1dyYXBwZXIpO1xuXG4gICAgICB0aGlzLnJlZnJlc2hDb2xvcnMoKTtcbiAgICAgIHRoaXMuaW5pdENhbnZhcygpO1xuICAgICAgdGhpcy5yZWJ1aWxkU2ltRGF0YSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMucmVidWlsZFNpbURhdGEoKTtcbiAgfVxuXG4gIHByaXZhdGUgaW5pdENhbnZhcygpOiB2b2lkIHtcbiAgICBjb25zdCB3cmFwcGVyID0gdGhpcy5jYW52YXNXcmFwcGVyITtcblxuICAgIGNvbnN0IGNhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJjYW52YXNcIik7XG4gICAgY2FudmFzLnN0eWxlLmNzc1RleHQgPSBcInBvc2l0aW9uOmFic29sdXRlO2luc2V0OjA7d2lkdGg6MTAwJTtoZWlnaHQ6MTAwJTtcIjtcbiAgICB3cmFwcGVyLmFwcGVuZENoaWxkKGNhbnZhcyk7XG5cbiAgICBjb25zdCBjdHggPSBjYW52YXMuZ2V0Q29udGV4dChcIjJkXCIsIHsgYWxwaGE6IGZhbHNlIH0pO1xuICAgIGlmICghY3R4KSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gaW5pdCAyRCBjYW52YXMgY29udGV4dFwiKTtcblxuICAgIHRoaXMuY2FudmFzRWwgPSBjYW52YXM7XG4gICAgdGhpcy5jdHggPSBjdHg7XG5cbiAgICB0aGlzLnJlc2l6ZU9ic2VydmVyID0gbmV3IFJlc2l6ZU9ic2VydmVyKCgpID0+IHtcbiAgICAgIHRoaXMucmVzaXplQ2FudmFzKCk7XG4gICAgICB0aGlzLm5lZWRzUmVkcmF3ID0gdHJ1ZTtcbiAgICB9KTtcbiAgICB0aGlzLnJlc2l6ZU9ic2VydmVyLm9ic2VydmUodGhpcy5jb250ZW50RWwpO1xuXG4gICAgdGhpcy5yZXNpemVDYW52YXMoKTtcbiAgICB0aGlzLnNldHVwSW5wdXRIYW5kbGVycygpO1xuXG4gICAgLy8gQ2xpY2tpbmcgb3V0c2lkZSB0aGUgaW5mbyBwYW5lbCBzaG91bGQgY2xvc2UgaXQuXG4gICAgaWYgKCF0aGlzLl9vbkNvbnRhaW5lck1vdXNlRG93bikge1xuICAgICAgdGhpcy5fb25Db250YWluZXJNb3VzZURvd24gPSAoZTogTW91c2VFdmVudCkgPT4ge1xuICAgICAgICBjb25zdCBwYW5lbCA9IHRoaXMuY29udGVudEVsLnF1ZXJ5U2VsZWN0b3IoXCIub2wtaW5mby1wYW5lbFwiKSBhcyBIVE1MRWxlbWVudCB8IG51bGw7XG4gICAgICAgIGlmICghcGFuZWwpIHJldHVybjtcbiAgICAgICAgY29uc3QgdGFyZ2V0ID0gZS50YXJnZXQgYXMgSFRNTEVsZW1lbnQgfCBudWxsO1xuICAgICAgICBpZiAodGFyZ2V0ICYmIHBhbmVsLmNvbnRhaW5zKHRhcmdldCkpIHJldHVybjtcblxuICAgICAgICAvLyBJZiB0aGUgY2xpY2sgd2FzIG9uIHRoZSBjYW52YXMsIHRoZSBjYW52YXMgaGFuZGxlcnMgd2lsbCBkZWNpZGVcbiAgICAgICAgLy8gd2hldGhlciB0byBrZWVwIHNlbGVjdGlvbiAobm9kZSBjbGljaykgb3IgY2xlYXIgKGVtcHR5IGNsaWNrKS5cbiAgICAgICAgaWYgKHRhcmdldCA9PT0gdGhpcy5jYW52YXNFbCkgcmV0dXJuO1xuXG4gICAgICAgIHRoaXMuc2VsZWN0ZWROb2RlID0gbnVsbDtcbiAgICAgICAgdGhpcy51cGRhdGVIaWdobGlnaHRUYXJnZXRzKCk7XG4gICAgICAgIHRoaXMucmVtb3ZlSW5mb1BhbmVsKHRoaXMuY29udGVudEVsKTtcbiAgICAgICAgdGhpcy5uZWVkc1JlZHJhdyA9IHRydWU7XG4gICAgICB9O1xuICAgICAgdGhpcy5jb250ZW50RWwuYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlZG93blwiLCB0aGlzLl9vbkNvbnRhaW5lck1vdXNlRG93biwgdHJ1ZSk7XG4gICAgfVxuXG4gICAgdGhpcy5zdGFydFJlbmRlckxvb3AoKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVzaXplQ2FudmFzKCk6IHZvaWQge1xuICAgIGNvbnN0IGNhbnZhcyA9IHRoaXMuY2FudmFzRWw7XG4gICAgY29uc3Qgd3JhcHBlciA9IHRoaXMuY2FudmFzV3JhcHBlcjtcbiAgICBpZiAoIWNhbnZhcyB8fCAhd3JhcHBlcikgcmV0dXJuO1xuXG4gICAgY29uc3QgdyA9IHdyYXBwZXIuY2xpZW50V2lkdGggfHwgdGhpcy5jb250ZW50RWwuY2xpZW50V2lkdGggfHwgODAwO1xuICAgIGNvbnN0IGggPSB3cmFwcGVyLmNsaWVudEhlaWdodCB8fCB0aGlzLmNvbnRlbnRFbC5jbGllbnRIZWlnaHQgfHwgNjAwO1xuXG4gICAgdGhpcy5kcHIgPSB3aW5kb3cuZGV2aWNlUGl4ZWxSYXRpbyB8fCAxO1xuICAgIGNhbnZhcy53aWR0aCA9IE1hdGgubWF4KDEsIE1hdGguZmxvb3IodyAqIHRoaXMuZHByKSk7XG4gICAgY2FudmFzLmhlaWdodCA9IE1hdGgubWF4KDEsIE1hdGguZmxvb3IoaCAqIHRoaXMuZHByKSk7XG5cbiAgICAvLyBNYWtlIGRyYXdpbmcgY29tbWFuZHMgaW4gQ1NTIHBpeGVsc1xuICAgIGNvbnN0IGN0eCA9IHRoaXMuY3R4ITtcbiAgICBjdHguc2V0VHJhbnNmb3JtKHRoaXMuZHByLCAwLCAwLCB0aGlzLmRwciwgMCwgMCk7XG4gIH1cblxuICAvKiogUmVidWlsZCBzaW11bGF0aW9uIG5vZGVzL2VkZ2VzIGZyb20gY3VycmVudCBncmFwaERhdGEgKyBmaWx0ZXJzICovXG4gIHByaXZhdGUgcmVidWlsZFNpbURhdGEoKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLmdyYXBoRGF0YSkgcmV0dXJuO1xuXG4gICAgY29uc3QgZmlsdGVyZWQgPSB0aGlzLmFwcGx5RmlsdGVycyh0aGlzLmdyYXBoRGF0YSk7XG4gICAgY29uc3QgY29udGFpbmVyID0gdGhpcy5jb250ZW50RWw7XG4gICAgY29uc3Qgd2lkdGggPSBjb250YWluZXIuY2xpZW50V2lkdGggfHwgODAwO1xuICAgIGNvbnN0IGhlaWdodCA9IGNvbnRhaW5lci5jbGllbnRIZWlnaHQgfHwgNjAwO1xuXG4gICAgLy8gU2hvdy9oaWRlIGVtcHR5IHN0YXRlXG4gICAgY29uc3QgZXhpc3RpbmdFbXB0eSA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKFwiLm9sLWVtcHR5LXN0YXRlXCIpO1xuICAgIGlmIChleGlzdGluZ0VtcHR5KSBleGlzdGluZ0VtcHR5LnJlbW92ZSgpO1xuXG4gICAgaWYgKGZpbHRlcmVkLm5vZGVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgaWYgKHRoaXMuY2FudmFzV3JhcHBlcikgdGhpcy5jYW52YXNXcmFwcGVyLnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcbiAgICAgIGNvbnRhaW5lci5jcmVhdGVFbChcImRpdlwiLCB7XG4gICAgICAgIGNsczogXCJvbC1lbXB0eS1zdGF0ZVwiLFxuICAgICAgICB0ZXh0OiBcIk5vIG5vZGVzIG1hdGNoIHRoZSBjdXJyZW50IGZpbHRlcnMuXCIsXG4gICAgICB9KTtcbiAgICAgIGlmICh0aGlzLnNpbXVsYXRpb24pIHsgdGhpcy5zaW11bGF0aW9uLnN0b3AoKTsgdGhpcy5zaW11bGF0aW9uID0gbnVsbDsgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAodGhpcy5jYW52YXNXcmFwcGVyKSB0aGlzLmNhbnZhc1dyYXBwZXIuc3R5bGUuZGlzcGxheSA9IFwiXCI7XG5cbiAgICAvLyBQcmVzZXJ2ZSBleGlzdGluZyBub2RlIHBvc2l0aW9ucyB3aGVyZSBwb3NzaWJsZVxuICAgIGNvbnN0IG9sZFBvc2l0aW9ucyA9IG5ldyBNYXA8c3RyaW5nLCB7IHg6IG51bWJlcjsgeTogbnVtYmVyIH0+KCk7XG4gICAgZm9yIChjb25zdCBuIG9mIHRoaXMuc2ltTm9kZXMpIHtcbiAgICAgIG9sZFBvc2l0aW9ucy5zZXQobi5pZCwgeyB4OiBuLnggPz8gMCwgeTogbi55ID8/IDAgfSk7XG4gICAgfVxuXG4gICAgLy8gT3JwaGFuIGRldGVjdGlvbiBCRUZPUkUgb3B0aW9uYWwgZm9sZGVyIGVkZ2VzLlxuICAgIGNvbnN0IGJhc2VPcnBoYW5zID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgZm9yIChjb25zdCBuIG9mIGZpbHRlcmVkLm5vZGVzKSB7XG4gICAgICBpZiAoKG4uY29ubmVjdGlvbnMgfHwgMCkgPT09IDApIGJhc2VPcnBoYW5zLmFkZChuLmlkKTtcbiAgICB9XG5cbiAgICAvLyBPcHRpb246IGNvbm5lY3Qgb3JwaGFucyB0byB0aGVpciBwYXJlbnQuXG4gICAgLy8gT2JqZWN0LXR5cGUgb3JwaGFucyBsaW5rIHRvIHRoZWlyIHNvdXJjZSBmaWxlOyBmaWxlLXR5cGUgb3JwaGFucyBsaW5rIHRvIHRoZWlyIGZvbGRlci5cbiAgICAvLyBJbXBsZW1lbnRlZCBoZXJlICh2aWV3LWxldmVsKSB0byBhdm9pZCBjaGFuZ2luZyB0aGUgYmFzZSBncmFwaCBtb2RlbC5cbiAgICBjb25zdCBub2Rlc1BsdXMgPSBbLi4uZmlsdGVyZWQubm9kZXNdIGFzIGFueVtdO1xuICAgIGNvbnN0IGVkZ2VzUGx1cyA9IFsuLi5maWx0ZXJlZC5lZGdlc10gYXMgYW55W107XG5cbiAgICBpZiAodGhpcy5jb25maWcubGlua1RvUGFyZW50IHx8IHRoaXMuY29uZmlnLmNvbm5lY3RPcnBoYW5zVG9Gb2xkZXJzKSB7XG4gICAgICBjb25zdCBmb2xkZXJOb2RlSWQgPSAoZm9sZGVyOiBzdHJpbmcpID0+IGBmb2xkZXI6OiR7Zm9sZGVyfWA7XG4gICAgICBjb25zdCBmb2xkZXJMYWJlbCA9IChmb2xkZXI6IHN0cmluZykgPT4ge1xuICAgICAgICBjb25zdCBjbGVhbmVkID0gZm9sZGVyLnJlcGxhY2UoL1xcLyskLywgXCJcIik7XG4gICAgICAgIGlmICghY2xlYW5lZCB8fCBjbGVhbmVkID09PSBcIi9cIikgcmV0dXJuIFwiL1wiO1xuICAgICAgICBjb25zdCBwYXJ0cyA9IGNsZWFuZWQuc3BsaXQoXCIvXCIpLmZpbHRlcihCb29sZWFuKTtcbiAgICAgICAgcmV0dXJuIHBhcnRzW3BhcnRzLmxlbmd0aCAtIDFdIHx8IGNsZWFuZWQ7XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBleGlzdGluZyA9IG5ldyBTZXQobm9kZXNQbHVzLm1hcCgobikgPT4gbi5pZCkpO1xuICAgICAgY29uc3QgZWRnZVNldCA9IG5ldyBTZXQoZWRnZXNQbHVzLm1hcCgoZSkgPT4gW2Uuc291cmNlLCBlLnRhcmdldF0uc29ydCgpLmpvaW4oXCItLVwiKSkpO1xuXG4gICAgICBmb3IgKGNvbnN0IG4gb2YgZmlsdGVyZWQubm9kZXMpIHtcbiAgICAgICAgaWYgKCFiYXNlT3JwaGFucy5oYXMobi5pZCkpIGNvbnRpbnVlO1xuXG4gICAgICAgIGxldCBwYXJlbnRJZDogc3RyaW5nO1xuXG4gICAgICAgIGlmICh0aGlzLmNvbmZpZy5saW5rVG9QYXJlbnQgJiYgbi50eXBlID09PSBcIm9iamVjdFwiKSB7XG4gICAgICAgICAgLy8gT2JqZWN0IG9ycGhhbiBcdTIxOTIgbGluayB0byBpdHMgc291cmNlIGZpbGVcbiAgICAgICAgICBjb25zdCBzb3VyY2VGaWxlSWQgPSBgZmlsZTo6JHtuLmZpbGVQYXRofWA7XG4gICAgICAgICAgcGFyZW50SWQgPSBzb3VyY2VGaWxlSWQ7XG5cbiAgICAgICAgICBpZiAoIWV4aXN0aW5nLmhhcyhwYXJlbnRJZCkpIHtcbiAgICAgICAgICAgIGV4aXN0aW5nLmFkZChwYXJlbnRJZCk7XG4gICAgICAgICAgICBjb25zdCBiYXNlbmFtZSA9IG4uZmlsZVBhdGguc3BsaXQoXCIvXCIpLnBvcCgpPy5yZXBsYWNlKC9cXC5tZCQvaSwgXCJcIikgfHwgbi5maWxlUGF0aDtcbiAgICAgICAgICAgIG5vZGVzUGx1cy5wdXNoKHtcbiAgICAgICAgICAgICAgaWQ6IHBhcmVudElkLFxuICAgICAgICAgICAgICBsYWJlbDogYmFzZW5hbWUsXG4gICAgICAgICAgICAgIHR5cGU6IFwiZmlsZVwiLFxuICAgICAgICAgICAgICBmaWxlUGF0aDogbi5maWxlUGF0aCxcbiAgICAgICAgICAgICAgZmlsZUxhYmVsOiBiYXNlbmFtZSxcbiAgICAgICAgICAgICAgcHJvcGVydGllczoge30sXG4gICAgICAgICAgICAgIHN0YXJ0TGluZTogMCxcbiAgICAgICAgICAgICAgY29ubmVjdGlvbnM6IDAsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gRmlsZSBvcnBoYW4gXHUyMTkyIGxpbmsgdG8gaXRzIGZvbGRlclxuICAgICAgICAgIGNvbnN0IHBhdGggPSBuLmZpbGVQYXRoIHx8IFwiXCI7XG4gICAgICAgICAgY29uc3QgaWR4ID0gcGF0aC5sYXN0SW5kZXhPZihcIi9cIik7XG4gICAgICAgICAgY29uc3QgZm9sZGVyID0gaWR4ID4gMCA/IHBhdGguc2xpY2UoMCwgaWR4KSA6IFwiL1wiO1xuICAgICAgICAgIHBhcmVudElkID0gZm9sZGVyTm9kZUlkKGZvbGRlcik7XG5cbiAgICAgICAgICBpZiAoIWV4aXN0aW5nLmhhcyhwYXJlbnRJZCkpIHtcbiAgICAgICAgICAgIGV4aXN0aW5nLmFkZChwYXJlbnRJZCk7XG4gICAgICAgICAgICBub2Rlc1BsdXMucHVzaCh7XG4gICAgICAgICAgICAgIGlkOiBwYXJlbnRJZCxcbiAgICAgICAgICAgICAgbGFiZWw6IGZvbGRlckxhYmVsKGZvbGRlciksXG4gICAgICAgICAgICAgIHR5cGU6IFwiZmlsZVwiLFxuICAgICAgICAgICAgICBmaWxlUGF0aDogZm9sZGVyICsgXCIvXCIsXG4gICAgICAgICAgICAgIGZpbGVMYWJlbDogZm9sZGVyTGFiZWwoZm9sZGVyKSxcbiAgICAgICAgICAgICAgcHJvcGVydGllczoge30sXG4gICAgICAgICAgICAgIHN0YXJ0TGluZTogMCxcbiAgICAgICAgICAgICAgY29ubmVjdGlvbnM6IDAsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBlZGdlSWQgPSBbbi5pZCwgcGFyZW50SWRdLnNvcnQoKS5qb2luKFwiLS1cIik7XG4gICAgICAgIGlmICghZWRnZVNldC5oYXMoZWRnZUlkKSkge1xuICAgICAgICAgIGVkZ2VTZXQuYWRkKGVkZ2VJZCk7XG4gICAgICAgICAgZWRnZXNQbHVzLnB1c2goeyBzb3VyY2U6IG4uaWQsIHRhcmdldDogcGFyZW50SWQsIGVkZ2VUeXBlOiBcIndpa2lcIiB9KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IG5vZGVCeUlkID0gbmV3IE1hcDxzdHJpbmcsIFNpbU5vZGU+KCk7XG5cbiAgICB0aGlzLnNpbU5vZGVzID0gbm9kZXNQbHVzLm1hcCgobikgPT4ge1xuICAgICAgY29uc3Qgb2xkID0gb2xkUG9zaXRpb25zLmdldChuLmlkKTtcbiAgICAgIGNvbnN0IGJhc2VBbHBoYSA9IG4udHlwZSA9PT0gXCJvYmplY3RcIiA/IDAuOSA6IDAuNTtcbiAgICAgIGNvbnN0IG5vZGU6IFNpbU5vZGUgPSB7XG4gICAgICAgIC4uLihuIGFzIGFueSksXG4gICAgICAgIGlzT3JwaGFuOiBiYXNlT3JwaGFucy5oYXMobi5pZCksXG4gICAgICAgIHg6IG9sZCA/IG9sZC54IDogKE1hdGgucmFuZG9tKCkgLSAwLjUpICogd2lkdGggKiAwLjQsXG4gICAgICAgIHk6IG9sZCA/IG9sZC55IDogKE1hdGgucmFuZG9tKCkgLSAwLjUpICogaGVpZ2h0ICogMC40LFxuICAgICAgICB2eDogMCxcbiAgICAgICAgdnk6IDAsXG4gICAgICAgIGZ4OiBudWxsLFxuICAgICAgICBmeTogbnVsbCxcbiAgICAgICAgcmFkaXVzOiB0aGlzLmdldE5vZGVSYWRpdXMobiksXG4gICAgICAgIGFscGhhOiBiYXNlQWxwaGEsXG4gICAgICAgIHRhcmdldEFscGhhOiBiYXNlQWxwaGEsXG4gICAgICB9O1xuICAgICAgbm9kZUJ5SWQuc2V0KG5vZGUuaWQsIG5vZGUpO1xuICAgICAgcmV0dXJuIG5vZGU7XG4gICAgfSk7XG5cbiAgICB0aGlzLnNpbUVkZ2VzID0gZWRnZXNQbHVzXG4gICAgICAubWFwKChlKSA9PiB7XG4gICAgICAgIGNvbnN0IHMgPSBub2RlQnlJZC5nZXQoZS5zb3VyY2UpO1xuICAgICAgICBjb25zdCB0ID0gbm9kZUJ5SWQuZ2V0KGUudGFyZ2V0KTtcbiAgICAgICAgaWYgKCFzIHx8ICF0KSByZXR1cm4gbnVsbDtcbiAgICAgICAgY29uc3QgYmFzZUFscGhhID0gZS5lZGdlVHlwZSA9PT0gXCJ3aWtpXCIgPyAwLjM1IDogMC4yNTtcbiAgICAgICAgY29uc3QgZWRnZTogU2ltRWRnZSA9IHtcbiAgICAgICAgICBzb3VyY2U6IHMsXG4gICAgICAgICAgdGFyZ2V0OiB0LFxuICAgICAgICAgIGVkZ2VUeXBlOiBlLmVkZ2VUeXBlLFxuICAgICAgICAgIGFscGhhOiBiYXNlQWxwaGEsXG4gICAgICAgICAgdGFyZ2V0QWxwaGE6IGJhc2VBbHBoYSxcbiAgICAgICAgfTtcbiAgICAgICAgcmV0dXJuIGVkZ2U7XG4gICAgICB9KVxuICAgICAgLmZpbHRlcigoZSk6IGUgaXMgU2ltRWRnZSA9PiBlICE9PSBudWxsKTtcblxuICAgIHRoaXMuaG92ZXJlZE5vZGUgPSBudWxsO1xuICAgIHRoaXMuc2VsZWN0ZWROb2RlID0gbnVsbDtcbiAgICB0aGlzLmRyYWdOb2RlID0gbnVsbDtcblxuICAgIHRoaXMuc3RhcnRTaW11bGF0aW9uKCk7XG4gICAgdGhpcy51cGRhdGVIaWdobGlnaHRUYXJnZXRzKCk7XG4gICAgdGhpcy5uZWVkc1JlZHJhdyA9IHRydWU7XG4gIH1cblxuICBwcml2YXRlIHN0YXJ0U2ltdWxhdGlvbigpOiB2b2lkIHtcbiAgICAvLyBTdG9wIG9sZCBzaW1cbiAgICBpZiAodGhpcy5zaW11bGF0aW9uKSB7XG4gICAgICB0aGlzLnNpbXVsYXRpb24uc3RvcCgpO1xuICAgICAgdGhpcy5zaW11bGF0aW9uLm9uKFwidGlja1wiLCBudWxsKTtcbiAgICAgIHRoaXMuc2ltdWxhdGlvbiA9IG51bGw7XG4gICAgfVxuXG4gICAgY29uc3Qgc2ltID0gZm9yY2VTaW11bGF0aW9uPFNpbU5vZGUsIFNpbUVkZ2U+KHRoaXMuc2ltTm9kZXMpXG4gICAgICAuYWxwaGEoMSlcbiAgICAgIC5hbHBoYVRhcmdldCgwKVxuICAgICAgLmFscGhhRGVjYXkoMC4wMjI4KVxuICAgICAgLmFscGhhTWluKDAuMDAxKVxuICAgICAgLnZlbG9jaXR5RGVjYXkoMC40KTtcblxuICAgIGNvbnN0IGxpbmtGb3JjZSA9IGZvcmNlTGluazxTaW1Ob2RlLCBTaW1FZGdlPih0aGlzLnNpbUVkZ2VzKVxuICAgICAgLmRpc3RhbmNlKHRoaXMuY29uZmlnLmxpbmtEaXN0YW5jZSlcbiAgICAgIC5zdHJlbmd0aCgwLjQpO1xuXG4gICAgLy8gUmVwZWwuIENvbmZpZyBpcyBwb3NpdGl2ZSwgZDMgZXhwZWN0cyBuZWdhdGl2ZSBmb3IgcmVwdWxzaW9uLlxuICAgIGNvbnN0IGNoYXJnZUZvcmNlID0gZm9yY2VNYW55Qm9keTxTaW1Ob2RlPigpXG4gICAgICAuc3RyZW5ndGgoLXRoaXMuY29uZmlnLnJlcGVsU3RyZW5ndGgpXG4gICAgICAuZGlzdGFuY2VNYXgoTWF0aC5tYXgodGhpcy5jb25maWcucmVwZWxTdHJlbmd0aCAqIDIsIDYwMCkpO1xuXG4gICAgLy8gQ2VudGVyaW5nOiB1c2UgZm9yY2VYL1kgd2l0aCBjb25maWd1cmFibGUgc3RyZW5ndGguXG4gICAgY29uc3QgY2VudGVyWCA9IGZvcmNlWDxTaW1Ob2RlPigwKS5zdHJlbmd0aCh0aGlzLmNvbmZpZy5jZW50ZXJTdHJlbmd0aCk7XG4gICAgY29uc3QgY2VudGVyWSA9IGZvcmNlWTxTaW1Ob2RlPigwKS5zdHJlbmd0aCh0aGlzLmNvbmZpZy5jZW50ZXJTdHJlbmd0aCk7XG5cbiAgICAvLyBDb2xsaXNpb246IGd1YXJhbnRlZSBub24tb3ZlcmxhcCArIGEgbGl0dGxlIHBhZGRpbmcuXG4gICAgY29uc3QgY29sbGlkZSA9IGZvcmNlQ29sbGlkZTxTaW1Ob2RlPigoZCkgPT4gZC5yYWRpdXMgKyAxNClcbiAgICAgIC5zdHJlbmd0aCgwLjk1KVxuICAgICAgLml0ZXJhdGlvbnMoMik7XG5cbiAgICBzaW1cbiAgICAgIC5mb3JjZShcImxpbmtcIiwgbGlua0ZvcmNlKVxuICAgICAgLmZvcmNlKFwiY2hhcmdlXCIsIGNoYXJnZUZvcmNlKVxuICAgICAgLmZvcmNlKFwiY2VudGVyWFwiLCBjZW50ZXJYKVxuICAgICAgLmZvcmNlKFwiY2VudGVyWVwiLCBjZW50ZXJZKVxuICAgICAgLmZvcmNlKFwiY29sbGlkZVwiLCBjb2xsaWRlKTtcblxuICAgIHNpbS5vbihcInRpY2tcIiwgKCkgPT4ge1xuICAgICAgdGhpcy5uZWVkc1JlZHJhdyA9IHRydWU7XG4gICAgfSk7XG5cbiAgICB0aGlzLnNpbXVsYXRpb24gPSBzaW07XG4gIH1cblxuICAvKiogSGFuZGxlIGNvbmZpZyBwYW5lbCBjaGFuZ2VzIHdpdGhvdXQgcmVidWlsZGluZyB0aGUgZW50aXJlIHZpZXcgKi9cbiAgcHJpdmF0ZSBoYW5kbGVDb25maWdDaGFuZ2UobmV3Q29uZmlnOiBHcmFwaENvbmZpZyk6IHZvaWQge1xuICAgIGNvbnN0IG9sZCA9IHRoaXMuY29uZmlnO1xuICAgIHRoaXMuY29uZmlnID0gbmV3Q29uZmlnO1xuXG4gICAgY29uc3QgZmlsdGVyQ2hhbmdlZCA9XG4gICAgICBvbGQuc2hvd0ZpbGVzICE9PSBuZXdDb25maWcuc2hvd0ZpbGVzIHx8XG4gICAgICBvbGQuc2hvd09iamVjdHMgIT09IG5ld0NvbmZpZy5zaG93T2JqZWN0cyB8fFxuICAgICAgb2xkLnNob3dXaWtpRWRnZXMgIT09IG5ld0NvbmZpZy5zaG93V2lraUVkZ2VzIHx8XG4gICAgICBvbGQuc2hvd09iamVjdEVkZ2VzICE9PSBuZXdDb25maWcuc2hvd09iamVjdEVkZ2VzIHx8XG4gICAgICBvbGQuc2hvd09ycGhhbnMgIT09IG5ld0NvbmZpZy5zaG93T3JwaGFucyB8fFxuICAgICAgb2xkLmNvbm5lY3RPcnBoYW5zVG9Gb2xkZXJzICE9PSBuZXdDb25maWcuY29ubmVjdE9ycGhhbnNUb0ZvbGRlcnMgfHxcbiAgICAgIG9sZC5saW5rVG9QYXJlbnQgIT09IG5ld0NvbmZpZy5saW5rVG9QYXJlbnQgfHxcbiAgICAgIG9sZC5zZWFyY2ggIT09IG5ld0NvbmZpZy5zZWFyY2ggfHxcbiAgICAgIG9sZC5wYXRoRmlsdGVyICE9PSBuZXdDb25maWcucGF0aEZpbHRlciB8fFxuICAgICAgb2xkLnNvdXJjZUZpbHRlciAhPT0gbmV3Q29uZmlnLnNvdXJjZUZpbHRlcjtcblxuICAgIGlmIChmaWx0ZXJDaGFuZ2VkKSB7XG4gICAgICB0aGlzLnJlYnVpbGRTaW1EYXRhKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gVXBkYXRlIHJhZGlpXG4gICAgZm9yIChjb25zdCBuIG9mIHRoaXMuc2ltTm9kZXMpIHtcbiAgICAgIG4ucmFkaXVzID0gdGhpcy5nZXROb2RlUmFkaXVzKG4pO1xuICAgIH1cblxuICAgIC8vIFVwZGF0ZSBmb3JjZXNcbiAgICBpZiAodGhpcy5zaW11bGF0aW9uKSB7XG4gICAgICBjb25zdCBsaW5rID0gdGhpcy5zaW11bGF0aW9uLmZvcmNlKFwibGlua1wiKSBhcyBhbnk7XG4gICAgICBsaW5rPy5kaXN0YW5jZT8uKG5ld0NvbmZpZy5saW5rRGlzdGFuY2UpO1xuXG4gICAgICBjb25zdCBjaGFyZ2UgPSB0aGlzLnNpbXVsYXRpb24uZm9yY2UoXCJjaGFyZ2VcIikgYXMgYW55O1xuICAgICAgY2hhcmdlPy5zdHJlbmd0aD8uKC1uZXdDb25maWcucmVwZWxTdHJlbmd0aCk7XG4gICAgICBjaGFyZ2U/LmRpc3RhbmNlTWF4Py4oTWF0aC5tYXgobmV3Q29uZmlnLnJlcGVsU3RyZW5ndGggKiAyLCA2MDApKTtcblxuICAgICAgY29uc3QgY3ggPSB0aGlzLnNpbXVsYXRpb24uZm9yY2UoXCJjZW50ZXJYXCIpIGFzIGFueTtcbiAgICAgIGN4Py5zdHJlbmd0aD8uKG5ld0NvbmZpZy5jZW50ZXJTdHJlbmd0aCk7XG4gICAgICBjb25zdCBjeSA9IHRoaXMuc2ltdWxhdGlvbi5mb3JjZShcImNlbnRlcllcIikgYXMgYW55O1xuICAgICAgY3k/LnN0cmVuZ3RoPy4obmV3Q29uZmlnLmNlbnRlclN0cmVuZ3RoKTtcblxuICAgICAgY29uc3QgY29sbGlkZSA9IHRoaXMuc2ltdWxhdGlvbi5mb3JjZShcImNvbGxpZGVcIikgYXMgYW55O1xuICAgICAgY29sbGlkZT8ucmFkaXVzPy4oKGQ6IFNpbU5vZGUpID0+IGQucmFkaXVzICsgMTQpO1xuXG4gICAgICB0aGlzLnNpbXVsYXRpb24uYWxwaGEoTWF0aC5tYXgodGhpcy5zaW11bGF0aW9uLmFscGhhKCksIDAuMykpLnJlc3RhcnQoKTtcbiAgICB9XG5cbiAgICB0aGlzLnVwZGF0ZUhpZ2hsaWdodFRhcmdldHMoKTtcbiAgICB0aGlzLm5lZWRzUmVkcmF3ID0gdHJ1ZTtcbiAgfVxuXG4gIC8qIFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFxuICAgICBDYW52YXMgRHJhd1xuICAgICBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTAgKi9cblxuICBwcml2YXRlIGNsZWFyKCk6IHZvaWQge1xuICAgIGNvbnN0IGN0eCA9IHRoaXMuY3R4O1xuICAgIGNvbnN0IGNhbnZhcyA9IHRoaXMuY2FudmFzRWw7XG4gICAgaWYgKCFjdHggfHwgIWNhbnZhcykgcmV0dXJuO1xuICAgIGNvbnN0IHcgPSBjYW52YXMuY2xpZW50V2lkdGg7XG4gICAgY29uc3QgaCA9IGNhbnZhcy5jbGllbnRIZWlnaHQ7XG4gICAgY3R4LnNhdmUoKTtcbiAgICBjdHguc2V0VHJhbnNmb3JtKHRoaXMuZHByLCAwLCAwLCB0aGlzLmRwciwgMCwgMCk7XG4gICAgY3R4LmZpbGxTdHlsZSA9IGNvbG9yVG9DU1ModGhpcy5jb2xvckJnKTtcbiAgICBjdHguZ2xvYmFsQWxwaGEgPSAxO1xuICAgIGN0eC5maWxsUmVjdCgwLCAwLCB3LCBoKTtcbiAgICBjdHgucmVzdG9yZSgpO1xuICB9XG5cbiAgcHJpdmF0ZSBkcmF3KCk6IHZvaWQge1xuICAgIGlmICghdGhpcy5jdHggfHwgIXRoaXMuY2FudmFzRWwpIHJldHVybjtcblxuICAgIC8vIFRoZW1lIG1pZ2h0IGNoYW5nZSBkdXJpbmcgcnVudGltZVxuICAgIHRoaXMucmVmcmVzaENvbG9ycygpO1xuXG4gICAgdGhpcy5jbGVhcigpO1xuXG4gICAgaWYgKHRoaXMuc2ltTm9kZXMubGVuZ3RoID09PSAwKSByZXR1cm47XG5cbiAgICB0aGlzLmRyYXdFZGdlcygpO1xuICAgIHRoaXMuZHJhd05vZGVzKCk7XG4gICAgdGhpcy5kcmF3TGFiZWxzKCk7XG4gIH1cblxuICBwcml2YXRlIGRyYXdFZGdlcygpOiB2b2lkIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCE7XG4gICAgY29uc3QgY2FudmFzID0gdGhpcy5jYW52YXNFbCE7XG4gICAgY29uc3QgdyA9IGNhbnZhcy5jbGllbnRXaWR0aDtcbiAgICBjb25zdCBoID0gY2FudmFzLmNsaWVudEhlaWdodDtcbiAgICBjb25zdCBoYWxmVyA9IHcgLyAyO1xuICAgIGNvbnN0IGhhbGZIID0gaCAvIDI7XG5cbiAgICBpZiAodGhpcy5zaW1FZGdlcy5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAgIGN0eC5zYXZlKCk7XG4gICAgY3R4LmxpbmVXaWR0aCA9IDE7XG4gICAgY3R4LmxpbmVDYXAgPSBcInJvdW5kXCI7XG5cbiAgICBmb3IgKGNvbnN0IGUgb2YgdGhpcy5zaW1FZGdlcykge1xuICAgICAgY29uc3QgcyA9IGUuc291cmNlIGFzIFNpbU5vZGU7XG4gICAgICBjb25zdCB0ID0gZS50YXJnZXQgYXMgU2ltTm9kZTtcblxuICAgICAgY29uc3Qgc3h3ID0gcy54ID8/IDA7XG4gICAgICBjb25zdCBzeXcgPSBzLnkgPz8gMDtcbiAgICAgIGNvbnN0IHR4dyA9IHQueCA/PyAwO1xuICAgICAgY29uc3QgdHl3ID0gdC55ID8/IDA7XG5cbiAgICAgIGNvbnN0IHN4ID0gKHN4dyAtIHRoaXMuY2FtWCkgKiB0aGlzLmNhbVNjYWxlICsgaGFsZlc7XG4gICAgICBjb25zdCBzeSA9IChzeXcgLSB0aGlzLmNhbVkpICogdGhpcy5jYW1TY2FsZSArIGhhbGZIO1xuICAgICAgY29uc3QgdHggPSAodHh3IC0gdGhpcy5jYW1YKSAqIHRoaXMuY2FtU2NhbGUgKyBoYWxmVztcbiAgICAgIGNvbnN0IHR5ID0gKHR5dyAtIHRoaXMuY2FtWSkgKiB0aGlzLmNhbVNjYWxlICsgaGFsZkg7XG5cbiAgICAgIGNvbnN0IGlzV2lraSA9IGUuZWRnZVR5cGUgPT09IFwid2lraVwiO1xuICAgICAgY29uc3QgY29sID0gaXNXaWtpID8gdGhpcy5jb2xvckVkZ2VXaWtpIDogdGhpcy5jb2xvckVkZ2VPYmo7XG5cbiAgICAgIGN0eC5zdHJva2VTdHlsZSA9IGNvbG9yVG9DU1MoY29sKTtcbiAgICAgIGN0eC5nbG9iYWxBbHBoYSA9IGUuYWxwaGE7XG4gICAgICBjdHguYmVnaW5QYXRoKCk7XG4gICAgICBjdHgubW92ZVRvKHN4LCBzeSk7XG4gICAgICBjdHgubGluZVRvKHR4LCB0eSk7XG4gICAgICBjdHguc3Ryb2tlKCk7XG4gICAgfVxuXG4gICAgY3R4LnJlc3RvcmUoKTtcbiAgfVxuXG4gIHByaXZhdGUgZHJhd05vZGVzKCk6IHZvaWQge1xuICAgIGNvbnN0IGN0eCA9IHRoaXMuY3R4ITtcbiAgICBjb25zdCBjYW52YXMgPSB0aGlzLmNhbnZhc0VsITtcbiAgICBjb25zdCB3ID0gY2FudmFzLmNsaWVudFdpZHRoO1xuICAgIGNvbnN0IGggPSBjYW52YXMuY2xpZW50SGVpZ2h0O1xuICAgIGNvbnN0IGhhbGZXID0gdyAvIDI7XG4gICAgY29uc3QgaGFsZkggPSBoIC8gMjtcbiAgICBjb25zdCBmb2N1cyA9IHRoaXMuaG92ZXJlZE5vZGUgfHwgdGhpcy5zZWxlY3RlZE5vZGU7XG5cbiAgICBjdHguc2F2ZSgpO1xuXG4gICAgZm9yIChjb25zdCBuIG9mIHRoaXMuc2ltTm9kZXMpIHtcbiAgICAgIGNvbnN0IG54dyA9IG4ueCA/PyAwO1xuICAgICAgY29uc3Qgbnl3ID0gbi55ID8/IDA7XG5cbiAgICAgIC8vIEFsbCBub2RlcyB1c2UgdGhlIHRoZW1lIGFjY2VudCBjb2xvciwgZXhjZXB0ICpiYXNlIGdyYXBoKiBvcnBoYW5zIHdoaWNoIGFyZSBncmV5LlxuICAgICAgY29uc3QgaXNPcnBoYW4gPSAhIW4uaXNPcnBoYW47XG5cbiAgICAgIGxldCBjb2w6IFtudW1iZXIsIG51bWJlciwgbnVtYmVyXTtcbiAgICAgIGlmIChmb2N1cyAmJiBuID09PSBmb2N1cykge1xuICAgICAgICBjb2wgPSBpc09ycGhhbiA/IHRoaXMuY29sb3JOb2RlRmlsZSA6IHRoaXMuY29sb3JIaWdobGlnaHQ7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb2wgPSBpc09ycGhhbiA/IHRoaXMuY29sb3JOb2RlRmlsZSA6IHRoaXMuY29sb3JOb2RlT2JqZWN0O1xuICAgICAgfVxuXG4gICAgICBjb25zdCBjeCA9IChueHcgLSB0aGlzLmNhbVgpICogdGhpcy5jYW1TY2FsZSArIGhhbGZXO1xuICAgICAgY29uc3QgY3kgPSAobnl3IC0gdGhpcy5jYW1ZKSAqIHRoaXMuY2FtU2NhbGUgKyBoYWxmSDtcblxuICAgICAgLy8gQ2xhbXAgbm9kZSBzaXplIG9uIHNjcmVlbiBzbyB6b29taW5nIGluIGRvZXNuJ3QgY3JlYXRlIGdpYW50IGJhbGxzLlxuICAgICAgY29uc3QgbWF4UiA9IE1hdGgubWF4KDIsIHRoaXMuY29uZmlnLm5vZGVNYXhTY3JlZW5SYWRpdXMpO1xuICAgICAgY29uc3QgciA9IE1hdGgubWluKG1heFIsIG4ucmFkaXVzICogdGhpcy5jYW1TY2FsZSk7XG5cbiAgICAgIGN0eC5maWxsU3R5bGUgPSBjb2xvclRvQ1NTKGNvbCk7XG4gICAgICBjdHguZ2xvYmFsQWxwaGEgPSBuLmFscGhhO1xuICAgICAgY3R4LmJlZ2luUGF0aCgpO1xuICAgICAgY3R4LmFyYyhjeCwgY3ksIHIsIDAsIE1hdGguUEkgKiAyKTtcbiAgICAgIGN0eC5maWxsKCk7XG4gICAgfVxuXG4gICAgY3R4LnJlc3RvcmUoKTtcbiAgfVxuXG4gIHByaXZhdGUgZHJhd0xhYmVscygpOiB2b2lkIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCE7XG4gICAgY29uc3QgY2FudmFzID0gdGhpcy5jYW52YXNFbCE7XG4gICAgY29uc3QgdyA9IGNhbnZhcy5jbGllbnRXaWR0aDtcbiAgICBjb25zdCBoID0gY2FudmFzLmNsaWVudEhlaWdodDtcbiAgICBjb25zdCBoYWxmVyA9IHcgLyAyO1xuICAgIGNvbnN0IGhhbGZIID0gaCAvIDI7XG5cbiAgICBjb25zdCBsYWJlbE9wYWNpdHkgPSB0aGlzLmNvbmZpZy5sYWJlbE9wYWNpdHk7XG4gICAgY29uc3Qgem9vbUZhY3RvciA9IHRoaXMuY2FtU2NhbGU7XG5cbiAgICAvLyBPbmx5IHNob3cgbGFiZWxzIGFmdGVyIGEgem9vbSB0aHJlc2hvbGQgKGNvbmZpZ3VyYWJsZSksIGFuZCBzY2FsZSBmb250IHNtb290aGx5LlxuICAgIGNvbnN0IGJhc2VGb250U2l6ZSA9IDExO1xuICAgIGNvbnN0IGZvbnRTaXplID0gTWF0aC5tYXgoOCwgTWF0aC5taW4oMTYsIGJhc2VGb250U2l6ZSAqIE1hdGguc3FydCh6b29tRmFjdG9yKSkpO1xuICAgIGNvbnN0IG1pblpvb20gPSBNYXRoLm1heCgwLCB0aGlzLmNvbmZpZy5sYWJlbE1pblpvb20pO1xuICAgIGNvbnN0IHpvb21HYXRlID0gem9vbUZhY3RvciA+PSBtaW5ab29tO1xuXG4gICAgaWYgKCF6b29tR2F0ZSkgcmV0dXJuO1xuXG4gICAgY3R4LnNhdmUoKTtcbiAgICBjdHguZm9udCA9IGAke2ZvbnRTaXplfXB4IC1hcHBsZS1zeXN0ZW0sIEJsaW5rTWFjU3lzdGVtRm9udCwgXCJTZWdvZSBVSVwiLCBSb2JvdG8sIHNhbnMtc2VyaWZgO1xuICAgIGN0eC50ZXh0QWxpZ24gPSBcImNlbnRlclwiO1xuICAgIGN0eC50ZXh0QmFzZWxpbmUgPSBcInRvcFwiO1xuICAgIGN0eC5maWxsU3R5bGUgPSB0aGlzLmNvbG9yVGV4dDtcblxuICAgIGNvbnN0IHBsYWNlZFJlY3RzOiBBcnJheTx7IHg6IG51bWJlcjsgeTogbnVtYmVyOyB3OiBudW1iZXI7IGg6IG51bWJlciB9PiA9IFtdO1xuICAgIGNvbnN0IGludGVyc2VjdHMgPSAocjE6IGFueSwgcjI6IGFueSkgPT5cbiAgICAgIHIxLnggPCByMi54ICsgcjIudyAmJiByMS54ICsgcjEudyA+IHIyLnggJiYgcjEueSA8IHIyLnkgKyByMi5oICYmIHIxLnkgKyByMS5oID4gcjIueTtcblxuICAgIC8vIEdyZWVkeSBsYWJlbCBwbGFjZW1lbnQgdG8gcmVkdWNlIG92ZXJsYXBwaW5nIGxhYmVscy5cbiAgICBjb25zdCBvcmRlcmVkTm9kZXMgPSBbLi4udGhpcy5zaW1Ob2Rlc10uc29ydCgoYSwgYikgPT4ge1xuICAgICAgaWYgKGIuYWxwaGEgIT09IGEuYWxwaGEpIHJldHVybiBiLmFscGhhIC0gYS5hbHBoYTtcbiAgICAgIHJldHVybiAoYi5jb25uZWN0aW9ucyB8fCAwKSAtIChhLmNvbm5lY3Rpb25zIHx8IDApO1xuICAgIH0pO1xuXG4gICAgY29uc3QgbWF4VyA9IE1hdGgubWF4KDQwLCB0aGlzLmNvbmZpZy5sYWJlbE1heFdpZHRoIHx8IDE2MCk7XG4gICAgY29uc3QgZWxsaXBzaXMgPSBcIlx1MjAyNlwiO1xuXG4gICAgZm9yIChjb25zdCBuIG9mIG9yZGVyZWROb2Rlcykge1xuICAgICAgY29uc3Qgbnh3ID0gbi54ID8/IDA7XG4gICAgICBjb25zdCBueXcgPSBuLnkgPz8gMDtcbiAgICAgIGNvbnN0IHN4ID0gKG54dyAtIHRoaXMuY2FtWCkgKiB0aGlzLmNhbVNjYWxlICsgaGFsZlc7XG4gICAgICBjb25zdCBzeSA9IChueXcgLSB0aGlzLmNhbVkpICogdGhpcy5jYW1TY2FsZSArIGhhbGZIO1xuICAgICAgY29uc3Qgc2NyZWVuWSA9IHN5ICsgbi5yYWRpdXMgKiB0aGlzLmNhbVNjYWxlICsgNjtcblxuICAgICAgLy8gQ3VsbCBvZmYtc2NyZWVuIGxhYmVsc1xuICAgICAgaWYgKHN4IDwgLTEwMCB8fCBzeCA+IHcgKyAxMDAgfHwgc3kgPCAtMTAwIHx8IHN5ID4gaCArIDEwMCkgY29udGludWU7XG5cbiAgICAgIGxldCBhbHBoYTogbnVtYmVyO1xuICAgICAgaWYgKG4udGFyZ2V0QWxwaGEgPCAwLjEpIHtcbiAgICAgICAgYWxwaGEgPSBNYXRoLm1pbihsYWJlbE9wYWNpdHksIG4uYWxwaGEpICogMC4zO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYWxwaGEgPSBsYWJlbE9wYWNpdHkgKiAobi5hbHBoYSAvIE1hdGgubWF4KDAuMDAwMSwgbi50YXJnZXRBbHBoYSkpO1xuICAgICAgICBpZiAobiA9PT0gKHRoaXMuaG92ZXJlZE5vZGUgfHwgdGhpcy5zZWxlY3RlZE5vZGUpKSBhbHBoYSA9IDEuMDtcbiAgICAgIH1cblxuICAgICAgaWYgKGFscGhhIDwgMC4wMSkgY29udGludWU7XG5cbiAgICAgIC8vIFRydW5jYXRlIGxhYmVsIHRvIGEgbWF4IHBpeGVsIHdpZHRoLlxuICAgICAgY29uc3QgZnVsbCA9IG4ubGFiZWw7XG4gICAgICBsZXQgc2hvd24gPSBmdWxsO1xuICAgICAgaWYgKGN0eC5tZWFzdXJlVGV4dChmdWxsKS53aWR0aCA+IG1heFcpIHtcbiAgICAgICAgbGV0IGxvID0gMCwgaGkgPSBmdWxsLmxlbmd0aDtcbiAgICAgICAgd2hpbGUgKGxvIDwgaGkpIHtcbiAgICAgICAgICBjb25zdCBtaWQgPSBNYXRoLmNlaWwoKGxvICsgaGkpIC8gMik7XG4gICAgICAgICAgY29uc3QgY2FuZGlkYXRlID0gZnVsbC5zbGljZSgwLCBtaWQpICsgZWxsaXBzaXM7XG4gICAgICAgICAgaWYgKGN0eC5tZWFzdXJlVGV4dChjYW5kaWRhdGUpLndpZHRoIDw9IG1heFcpIGxvID0gbWlkO1xuICAgICAgICAgIGVsc2UgaGkgPSBtaWQgLSAxO1xuICAgICAgICB9XG4gICAgICAgIHNob3duID0gZnVsbC5zbGljZSgwLCBNYXRoLm1heCgwLCBsbykpICsgZWxsaXBzaXM7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG1ldHJpY3MgPSBjdHgubWVhc3VyZVRleHQoc2hvd24pO1xuICAgICAgY29uc3QgdGV4dFcgPSBtZXRyaWNzLndpZHRoO1xuICAgICAgY29uc3QgdGV4dEggPSBmb250U2l6ZTsgLy8gZ29vZCBlbm91Z2ggZm9yIG92ZXJsYXAgY3VsbGluZ1xuXG4gICAgICBjb25zdCBwYWQgPSAzO1xuICAgICAgY29uc3QgcmVjdCA9IHtcbiAgICAgICAgeDogc3ggLSB0ZXh0VyAvIDIgLSBwYWQsXG4gICAgICAgIHk6IHNjcmVlblkgLSBwYWQsXG4gICAgICAgIHc6IHRleHRXICsgcGFkICogMixcbiAgICAgICAgaDogdGV4dEggKyBwYWQgKiAyLFxuICAgICAgfTtcblxuICAgICAgbGV0IGNvbGxpZGVzID0gZmFsc2U7XG4gICAgICBmb3IgKGNvbnN0IHIgb2YgcGxhY2VkUmVjdHMpIHtcbiAgICAgICAgaWYgKGludGVyc2VjdHMocmVjdCwgcikpIHsgY29sbGlkZXMgPSB0cnVlOyBicmVhazsgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBpc0ZvY3VzID0gbiA9PT0gKHRoaXMuaG92ZXJlZE5vZGUgfHwgdGhpcy5zZWxlY3RlZE5vZGUpO1xuICAgICAgaWYgKCFpc0ZvY3VzICYmIGNvbGxpZGVzKSBjb250aW51ZTtcblxuICAgICAgY3R4Lmdsb2JhbEFscGhhID0gYWxwaGE7XG4gICAgICBjdHguZmlsbFRleHQoc2hvd24sIHN4LCBzY3JlZW5ZKTtcbiAgICAgIHBsYWNlZFJlY3RzLnB1c2gocmVjdCk7XG4gICAgfVxuXG4gICAgY3R4LnJlc3RvcmUoKTtcbiAgfVxuXG4gIC8qIFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFxuICAgICBJbnB1dCBIYW5kbGVyc1xuICAgICBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTAgKi9cblxuICBwcml2YXRlIHNldHVwSW5wdXRIYW5kbGVycygpOiB2b2lkIHtcbiAgICBjb25zdCBjYW52YXMgPSB0aGlzLmNhbnZhc0VsITtcbiAgICBjb25zdCBjb250YWluZXIgPSB0aGlzLmNvbnRlbnRFbDtcblxuICAgIC8vIGQzLXpvb20gKHBhbiArIHdoZWVsIHpvb20pIG9uIGNhbnZhcy5cbiAgICAvLyBXZSBrZWVwIG91ciBvd24gKGNhbVgvY2FtWS9jYW1TY2FsZSkgY2FtZXJhLCBidXQgZHJpdmUgdGFyZ2V0Q2FtKiBmcm9tIHpvb20gdHJhbnNmb3JtLlxuICAgIGNvbnN0IHVwZGF0ZVRhcmdldEZyb21ab29tID0gKHQ6IGFueSwgc291cmNlRXZlbnQ/OiBFdmVudCB8IG51bGwpID0+IHtcbiAgICAgIGNvbnN0IHcgPSBjYW52YXMuY2xpZW50V2lkdGg7XG4gICAgICBjb25zdCBoID0gY2FudmFzLmNsaWVudEhlaWdodDtcbiAgICAgIGNvbnN0IGsgPSBNYXRoLm1heCgwLjAzLCBNYXRoLm1pbigxMiwgdC5rKSk7XG4gICAgICBjb25zdCB4ID0gdC54O1xuICAgICAgY29uc3QgeSA9IHQueTtcblxuICAgICAgLy8gc2NyZWVuID0gd29ybGQgKiBrICsgKHgsIHkpXG4gICAgICAvLyBvdXIgY2FtZXJhOiBzY3JlZW4gPSAod29ybGQgLSBjYW0pICogayArICh3LzIsaC8yKVxuICAgICAgLy8gPT4geCA9IC1jYW1YKmsgKyB3LzIgID0+IGNhbVggPSAody8yIC0geCkva1xuICAgICAgY29uc3QgY2FtWCA9ICh3IC8gMiAtIHgpIC8gaztcbiAgICAgIGNvbnN0IGNhbVkgPSAoaCAvIDIgLSB5KSAvIGs7XG5cbiAgICAgIHRoaXMuem9vbVRyYW5zZm9ybSA9IHQ7XG4gICAgICB0aGlzLnRhcmdldENhbVNjYWxlID0gaztcbiAgICAgIHRoaXMudGFyZ2V0Q2FtWCA9IGNhbVg7XG4gICAgICB0aGlzLnRhcmdldENhbVkgPSBjYW1ZO1xuXG4gICAgICAvLyBGb3IgZHJhZy1wYW5uaW5nLCBhdm9pZCBjYW1lcmEgbGFnIChrZWVwIGl0IDE6MSkuXG4gICAgICBjb25zdCBzZTogYW55ID0gc291cmNlRXZlbnQgYXMgYW55O1xuICAgICAgY29uc3QgaXNXaGVlbCA9IHNlPy50eXBlID09PSBcIndoZWVsXCI7XG4gICAgICBpZiAoIWlzV2hlZWwpIHtcbiAgICAgICAgdGhpcy5jYW1TY2FsZSA9IHRoaXMudGFyZ2V0Q2FtU2NhbGU7XG4gICAgICAgIHRoaXMuY2FtWCA9IHRoaXMudGFyZ2V0Q2FtWDtcbiAgICAgICAgdGhpcy5jYW1ZID0gdGhpcy50YXJnZXRDYW1ZO1xuICAgICAgfVxuXG4gICAgICB0aGlzLm5lZWRzUmVkcmF3ID0gdHJ1ZTtcbiAgICB9O1xuXG4gICAgLy8gQXR0YWNoIHpvb20gYmVoYXZpb3Igb25jZS5cbiAgICBpZiAoIXRoaXMuem9vbUJlaGF2aW9yKSB7XG4gICAgICB0aGlzLnpvb21CZWhhdmlvciA9IHpvb208SFRNTENhbnZhc0VsZW1lbnQsIHVua25vd24+KClcbiAgICAgICAgLnNjYWxlRXh0ZW50KFswLjAzLCAxMl0pXG4gICAgICAgIC5maWx0ZXIoKGV2ZW50OiBhbnkpID0+IHtcbiAgICAgICAgICAvLyBEaXNhYmxlIHBhbi96b29tIHdoaWxlIGRyYWdnaW5nIGEgbm9kZS5cbiAgICAgICAgICBpZiAodGhpcy5kcmFnTm9kZSkgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgIC8vIE9ubHkgbGVmdCBtb3VzZSBmb3IgZHJhZy1wYW4uXG4gICAgICAgICAgaWYgKGV2ZW50Py50eXBlPy5zdGFydHNXaXRoKFwibW91c2VcIikgJiYgZXZlbnQuYnV0dG9uICE9PSAwKSByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH0pXG4gICAgICAgIC5vbihcInpvb21cIiwgKGV2ZW50OiBhbnkpID0+IHtcbiAgICAgICAgICBpZiAodGhpcy5pc1N5bmNpbmdab29tKSByZXR1cm47XG4gICAgICAgICAgdXBkYXRlVGFyZ2V0RnJvbVpvb20oZXZlbnQudHJhbnNmb3JtLCBldmVudC5zb3VyY2VFdmVudCk7XG4gICAgICAgIH0pO1xuXG4gICAgICBjb25zdCBzZWwgPSBzZWxlY3QoY2FudmFzKTtcbiAgICAgIHNlbC5jYWxsKHRoaXMuem9vbUJlaGF2aW9yIGFzIGFueSk7XG4gICAgICAvLyBXZSBoYW5kbGUgZG91YmxlIGNsaWNrIG91cnNlbHZlcyAob3BlbiBub2RlKSwgc28gZGlzYWJsZSBkMydzIGRlZmF1bHQgem9vbS1vbi1kYmxjbGljay5cbiAgICAgIHNlbC5vbihcImRibGNsaWNrLnpvb21cIiwgbnVsbCk7XG5cbiAgICAgIC8vIEluaXRpYWxpemUgdHJhbnNmb3JtIHRvIG1hdGNoIG91ciBzdGFydGluZyBjYW1lcmEuXG4gICAgICBjb25zdCB3ID0gY2FudmFzLmNsaWVudFdpZHRoO1xuICAgICAgY29uc3QgaCA9IGNhbnZhcy5jbGllbnRIZWlnaHQ7XG4gICAgICBjb25zdCBrID0gdGhpcy50YXJnZXRDYW1TY2FsZTtcbiAgICAgIGNvbnN0IHggPSAtdGhpcy50YXJnZXRDYW1YICogayArIHcgLyAyO1xuICAgICAgY29uc3QgeSA9IC10aGlzLnRhcmdldENhbVkgKiBrICsgaCAvIDI7XG4gICAgICB0aGlzLmlzU3luY2luZ1pvb20gPSB0cnVlO1xuICAgICAgdHJ5IHtcbiAgICAgICAgc2VsLmNhbGwoKHRoaXMuem9vbUJlaGF2aW9yIGFzIGFueSkudHJhbnNmb3JtLCB6b29tSWRlbnRpdHkudHJhbnNsYXRlKHgsIHkpLnNjYWxlKGspKTtcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIHRoaXMuaXNTeW5jaW5nWm9vbSA9IGZhbHNlO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIE1vdXNlIGRvd246IG9ubHkgdXNlZCBmb3Igbm9kZSBkcmFnICsgY2xpY2sgc2VsZWN0aW9uIHRyYWNraW5nLlxuICAgIGxldCBkb3duWCA9IDA7XG4gICAgbGV0IGRvd25ZID0gMDtcbiAgICBsZXQgZG93bk5vZGU6IFNpbU5vZGUgfCBudWxsID0gbnVsbDtcblxuICAgIHRoaXMuX29uTW91c2VEb3duID0gKGU6IE1vdXNlRXZlbnQpID0+IHtcbiAgICAgIGlmIChlLmJ1dHRvbiAhPT0gMCkgcmV0dXJuO1xuICAgICAgY29uc3QgcmVjdCA9IGNhbnZhcy5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgIGNvbnN0IG14ID0gZS5jbGllbnRYIC0gcmVjdC5sZWZ0O1xuICAgICAgY29uc3QgbXkgPSBlLmNsaWVudFkgLSByZWN0LnRvcDtcbiAgICAgIGRvd25YID0gZS5jbGllbnRYO1xuICAgICAgZG93blkgPSBlLmNsaWVudFk7XG4gICAgICBkb3duTm9kZSA9IHRoaXMuaGl0VGVzdE5vZGUobXgsIG15KTtcblxuICAgICAgaWYgKGRvd25Ob2RlKSB7XG4gICAgICAgIC8vIFByZXZlbnQgZDMtem9vbSBmcm9tIHN0YXJ0aW5nIGEgcGFuIHdoZW4gd2UgaW50ZW5kIHRvIGRyYWcgYSBub2RlLlxuICAgICAgICBlLnN0b3BQcm9wYWdhdGlvbigpO1xuXG4gICAgICAgIHRoaXMuZHJhZ05vZGUgPSBkb3duTm9kZTtcbiAgICAgICAgdGhpcy5pc0RyYWdnaW5nID0gZmFsc2U7XG4gICAgICAgIGRvd25Ob2RlLmZ4ID0gZG93bk5vZGUueCA/PyAwO1xuICAgICAgICBkb3duTm9kZS5meSA9IGRvd25Ob2RlLnkgPz8gMDtcbiAgICAgICAgLy8gS2VlcCBkcmFnIHNtb290aCAobGVzcyBhZ2dyZXNzaXZlIHJlaGVhdGluZylcbiAgICAgICAgdGhpcy5zaW11bGF0aW9uPy5hbHBoYVRhcmdldCgwLjE1KS5yZXN0YXJ0KCk7XG4gICAgICB9XG4gICAgfTtcbiAgICBjYW52YXMuYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlZG93blwiLCB0aGlzLl9vbk1vdXNlRG93biwgeyBjYXB0dXJlOiB0cnVlIH0pO1xuXG4gICAgLy8gTW91c2UgbW92ZTogdXBkYXRlIG5vZGUgZHJhZyBPUiBob3Zlci90b29sdGlwLlxuICAgIHRoaXMuX29uTW91c2VNb3ZlID0gKGU6IE1vdXNlRXZlbnQpID0+IHtcbiAgICAgIGNvbnN0IHJlY3QgPSBjYW52YXMuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICBjb25zdCBteCA9IGUuY2xpZW50WCAtIHJlY3QubGVmdDtcbiAgICAgIGNvbnN0IG15ID0gZS5jbGllbnRZIC0gcmVjdC50b3A7XG5cbiAgICAgIGlmICh0aGlzLmRyYWdOb2RlKSB7XG4gICAgICAgIHRoaXMuaXNEcmFnZ2luZyA9IHRydWU7XG4gICAgICAgIGNvbnN0IFt3eCwgd3ldID0gdGhpcy5zY3JlZW5Ub1dvcmxkKG14LCBteSk7XG4gICAgICAgIC8vIFNtb290aCBkcmFnOiBsZXJwIHRvd2FyZHMgdGhlIGN1cnNvciBpbnN0ZWFkIG9mIHNuYXBwaW5nLlxuICAgICAgICBjb25zdCB0ID0gMC4zNTtcbiAgICAgICAgdGhpcy5kcmFnTm9kZS5meCA9IGxlcnAodGhpcy5kcmFnTm9kZS5meCA/PyB3eCwgd3gsIHQpO1xuICAgICAgICB0aGlzLmRyYWdOb2RlLmZ5ID0gbGVycCh0aGlzLmRyYWdOb2RlLmZ5ID8/IHd5LCB3eSwgdCk7XG4gICAgICAgIHRoaXMubmVlZHNSZWRyYXcgPSB0cnVlO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIC8vIEhvdmVyIGRldGVjdGlvblxuICAgICAgY29uc3Qgbm9kZSA9IHRoaXMuaGl0VGVzdE5vZGUobXgsIG15KTtcbiAgICAgIGlmIChub2RlICE9PSB0aGlzLmhvdmVyZWROb2RlKSB7XG4gICAgICAgIHRoaXMuaG92ZXJlZE5vZGUgPSBub2RlO1xuICAgICAgICBjYW52YXMuc3R5bGUuY3Vyc29yID0gbm9kZSA/IFwicG9pbnRlclwiIDogXCJkZWZhdWx0XCI7XG4gICAgICAgIHRoaXMudXBkYXRlSGlnaGxpZ2h0VGFyZ2V0cygpO1xuXG4gICAgICAgIGlmIChub2RlKSB7XG4gICAgICAgICAgdGhpcy5zaG93VG9vbHRpcChub2RlLCBjb250YWluZXIpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMuaGlkZVRvb2x0aXAoY29udGFpbmVyKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmIChub2RlKSB7XG4gICAgICAgIHRoaXMubW92ZVRvb2x0aXAoZSwgY29udGFpbmVyKTtcbiAgICAgIH1cbiAgICB9O1xuICAgIGNhbnZhcy5hZGRFdmVudExpc3RlbmVyKFwibW91c2Vtb3ZlXCIsIHRoaXMuX29uTW91c2VNb3ZlKTtcblxuICAgIC8vIE1vdXNlIHVwOiBkcm9wIGRyYWcgbm9kZSwgaGFuZGxlIGNsaWNrL3NlbGVjdC9kYmxjbGljayBsb2dpYy5cbiAgICB0aGlzLl9vbk1vdXNlVXAgPSAoZTogTW91c2VFdmVudCkgPT4ge1xuICAgICAgY29uc3QgdXBEeCA9IE1hdGguYWJzKGUuY2xpZW50WCAtIGRvd25YKTtcbiAgICAgIGNvbnN0IHVwRHkgPSBNYXRoLmFicyhlLmNsaWVudFkgLSBkb3duWSk7XG4gICAgICBjb25zdCBpc0NsaWNrID0gdXBEeCA8IDMgJiYgdXBEeSA8IDM7XG5cbiAgICAgIGlmICh0aGlzLmRyYWdOb2RlKSB7XG4gICAgICAgIGNvbnN0IHdhc0RyYWdnaW5nID0gdGhpcy5pc0RyYWdnaW5nO1xuICAgICAgICB0aGlzLmRyYWdOb2RlLmZ4ID0gbnVsbDtcbiAgICAgICAgdGhpcy5kcmFnTm9kZS5meSA9IG51bGw7XG5cbiAgICAgICAgaWYgKCF3YXNEcmFnZ2luZykge1xuICAgICAgICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XG4gICAgICAgICAgY29uc3Qgbm9kZSA9IHRoaXMuZHJhZ05vZGU7XG5cbiAgICAgICAgICBpZiAodGhpcy5sYXN0Q2xpY2tJZCA9PT0gbm9kZS5pZCAmJiBub3cgLSB0aGlzLmxhc3RDbGlja1RpbWUgPCAzMDApIHtcbiAgICAgICAgICAgIGlmIChub2RlLnR5cGUgPT09IFwib2JqZWN0XCIgJiYgdGhpcy5uYXZpZ2F0ZVRvT2JqZWN0KSB7XG4gICAgICAgICAgICAgIHRoaXMubmF2aWdhdGVUb09iamVjdChub2RlLmZpbGVQYXRoLCBub2RlLnN0YXJ0TGluZSk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKG5vZGUudHlwZSA9PT0gXCJmaWxlXCIgJiYgdGhpcy5uYXZpZ2F0ZVRvRmlsZSkge1xuICAgICAgICAgICAgICB0aGlzLm5hdmlnYXRlVG9GaWxlKG5vZGUuZmlsZVBhdGgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5sYXN0Q2xpY2tUaW1lID0gMDtcbiAgICAgICAgICAgIHRoaXMubGFzdENsaWNrSWQgPSBcIlwiO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmxhc3RDbGlja1RpbWUgPSBub3c7XG4gICAgICAgICAgICB0aGlzLmxhc3RDbGlja0lkID0gbm9kZS5pZDtcbiAgICAgICAgICAgIHRoaXMuc2VsZWN0ZWROb2RlID0gbm9kZTtcbiAgICAgICAgICAgIHRoaXMudXBkYXRlSGlnaGxpZ2h0VGFyZ2V0cygpO1xuICAgICAgICAgICAgdGhpcy5zaG93SW5mb1BhbmVsKG5vZGUsIGNvbnRhaW5lcik7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5kcmFnTm9kZSA9IG51bGw7XG4gICAgICAgIHRoaXMuaXNEcmFnZ2luZyA9IGZhbHNlO1xuICAgICAgICB0aGlzLnNpbXVsYXRpb24/LmFscGhhVGFyZ2V0KDApO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIC8vIENsaWNrIG9uIGVtcHR5IHNwYWNlIGNsZWFycyBzZWxlY3Rpb24uXG4gICAgICBpZiAoaXNDbGljayAmJiAhZG93bk5vZGUpIHtcbiAgICAgICAgdGhpcy5zZWxlY3RlZE5vZGUgPSBudWxsO1xuICAgICAgICB0aGlzLnVwZGF0ZUhpZ2hsaWdodFRhcmdldHMoKTtcbiAgICAgICAgdGhpcy5yZW1vdmVJbmZvUGFuZWwoY29udGFpbmVyKTtcbiAgICAgIH1cbiAgICB9O1xuICAgIGNhbnZhcy5hZGRFdmVudExpc3RlbmVyKFwibW91c2V1cFwiLCB0aGlzLl9vbk1vdXNlVXApO1xuXG4gICAgLy8gUHJldmVudCBicm93c2VyIGRlZmF1bHRzXG4gICAgdGhpcy5fb25EYmxDbGljayA9IChlOiBNb3VzZUV2ZW50KSA9PiB7IGUucHJldmVudERlZmF1bHQoKTsgfTtcbiAgICBjYW52YXMuYWRkRXZlbnRMaXN0ZW5lcihcImRibGNsaWNrXCIsIHRoaXMuX29uRGJsQ2xpY2spO1xuICB9XG5cbiAgLyogXHUyNTAwXHUyNTAwIFRvb2x0aXAgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwICovXG5cbiAgcHJpdmF0ZSBzaG93VG9vbHRpcChub2RlOiBTaW1Ob2RlLCBjb250YWluZXI6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgbGV0IHRvb2x0aXAgPSBkb2N1bWVudC5ib2R5LnF1ZXJ5U2VsZWN0b3IoXCIub2wtdG9vbHRpcFwiKSBhcyBIVE1MRWxlbWVudDtcbiAgICBpZiAoIXRvb2x0aXApIHtcbiAgICAgIHRvb2x0aXAgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgdG9vbHRpcC5jbGFzc05hbWUgPSBcIm9sLXRvb2x0aXBcIjtcbiAgICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQodG9vbHRpcCk7XG4gICAgfVxuICAgIHRvb2x0aXAudGV4dENvbnRlbnQgPSBub2RlLmxhYmVsO1xuICAgIHRvb2x0aXAuc3R5bGUuZGlzcGxheSA9IFwiYmxvY2tcIjtcbiAgfVxuXG4gIHByaXZhdGUgbW92ZVRvb2x0aXAoZTogTW91c2VFdmVudCwgY29udGFpbmVyOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIGNvbnN0IHRvb2x0aXAgPSBkb2N1bWVudC5ib2R5LnF1ZXJ5U2VsZWN0b3IoXCIub2wtdG9vbHRpcFwiKSBhcyBIVE1MRWxlbWVudDtcbiAgICBpZiAoIXRvb2x0aXApIHJldHVybjtcblxuICAgIGNvbnN0IHR3ID0gdG9vbHRpcC5vZmZzZXRXaWR0aDtcbiAgICBjb25zdCB0aCA9IHRvb2x0aXAub2Zmc2V0SGVpZ2h0O1xuICAgIGNvbnN0IHBhZCA9IDg7XG4gICAgY29uc3QgdncgPSB3aW5kb3cuaW5uZXJXaWR0aDtcbiAgICBjb25zdCB2aCA9IHdpbmRvdy5pbm5lckhlaWdodDtcblxuICAgIGxldCBsZWZ0ID0gZS5jbGllbnRYICsgMTQ7XG4gICAgbGV0IHRvcCA9IGUuY2xpZW50WSAtIDEwO1xuXG4gICAgLy8gRmxpcCBsZWZ0IGlmIG92ZXJmbG93aW5nIHJpZ2h0XG4gICAgaWYgKGxlZnQgKyB0dyArIHBhZCA+IHZ3KSB7XG4gICAgICBsZWZ0ID0gZS5jbGllbnRYIC0gdHcgLSAxNDtcbiAgICB9XG4gICAgbGVmdCA9IE1hdGgubWF4KHBhZCwgTWF0aC5taW4obGVmdCwgdncgLSB0dyAtIHBhZCkpO1xuICAgIHRvcCA9IE1hdGgubWF4KHBhZCwgTWF0aC5taW4odG9wLCB2aCAtIHRoIC0gcGFkKSk7XG5cbiAgICB0b29sdGlwLnN0eWxlLmxlZnQgPSBsZWZ0ICsgXCJweFwiO1xuICAgIHRvb2x0aXAuc3R5bGUudG9wID0gdG9wICsgXCJweFwiO1xuICB9XG5cbiAgcHJpdmF0ZSBoaWRlVG9vbHRpcChjb250YWluZXI6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgY29uc3QgdG9vbHRpcCA9IGRvY3VtZW50LmJvZHkucXVlcnlTZWxlY3RvcihcIi5vbC10b29sdGlwXCIpIGFzIEhUTUxFbGVtZW50O1xuICAgIGlmICh0b29sdGlwKSB0b29sdGlwLnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcbiAgfVxuXG4gIC8qIFx1MjUwMFx1MjUwMCBJbmZvIFBhbmVsIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMCAqL1xuXG4gIHByaXZhdGUgcmVtb3ZlSW5mb1BhbmVsKGNvbnRhaW5lcjogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICBjb25zdCBwYW5lbCA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKFwiLm9sLWluZm8tcGFuZWxcIik7XG4gICAgaWYgKHBhbmVsKSBwYW5lbC5yZW1vdmUoKTtcbiAgfVxuXG4gIHByaXZhdGUgc2hvd0luZm9QYW5lbChkOiBTaW1Ob2RlLCBjb250YWluZXI6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgdGhpcy5yZW1vdmVJbmZvUGFuZWwoY29udGFpbmVyKTtcblxuICAgIGNvbnN0IHBhbmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICBwYW5lbC5jbGFzc05hbWUgPSBcIm9sLWluZm8tcGFuZWxcIjtcblxuICAgIGNvbnN0IHRpdGxlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICB0aXRsZS5jbGFzc05hbWUgPSBcIm9sLWluZm8tdGl0bGVcIjtcbiAgICB0aXRsZS50ZXh0Q29udGVudCA9IGQubGFiZWw7XG4gICAgcGFuZWwuYXBwZW5kQ2hpbGQodGl0bGUpO1xuXG4gICAgY29uc3QgYmFkZ2UgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIGJhZGdlLmNsYXNzTmFtZSA9IGBvbC1pbmZvLXR5cGUgb2wtaW5mby10eXBlLSR7ZC50eXBlfWA7XG4gICAgYmFkZ2UudGV4dENvbnRlbnQgPSBkLnR5cGUgPT09IFwib2JqZWN0XCIgPyBcIk9iamVjdFwiIDogXCJGaWxlXCI7XG4gICAgcGFuZWwuYXBwZW5kQ2hpbGQoYmFkZ2UpO1xuXG4gICAgY29uc3QgZmlsZVBhdGggPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIGZpbGVQYXRoLmNsYXNzTmFtZSA9IFwib2wtaW5mby1maWxlXCI7XG4gICAgZmlsZVBhdGgudGV4dENvbnRlbnQgPSBkLmZpbGVQYXRoO1xuICAgIHBhbmVsLmFwcGVuZENoaWxkKGZpbGVQYXRoKTtcblxuICAgIGlmIChkLnR5cGUgPT09IFwib2JqZWN0XCIgJiYgT2JqZWN0LmtleXMoZC5wcm9wZXJ0aWVzKS5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBwcm9wcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICBwcm9wcy5jbGFzc05hbWUgPSBcIm9sLWluZm8tcHJvcHNcIjtcbiAgICAgIGZvciAoY29uc3QgW2ssIHZdIG9mIE9iamVjdC5lbnRyaWVzKGQucHJvcGVydGllcykpIHtcbiAgICAgICAgY29uc3Qgcm93ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgICAgcm93LmNsYXNzTmFtZSA9IFwib2wtaW5mby1wcm9wLXJvd1wiO1xuICAgICAgICBjb25zdCBrZXlFbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgICAgICBrZXlFbC5jbGFzc05hbWUgPSBcIm9sLWluZm8tcHJvcC1rZXlcIjtcbiAgICAgICAga2V5RWwudGV4dENvbnRlbnQgPSBrO1xuICAgICAgICBjb25zdCB2YWxFbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgICAgICB2YWxFbC5jbGFzc05hbWUgPSBcIm9sLWluZm8tcHJvcC12YWxcIjtcbiAgICAgICAgdmFsRWwudGV4dENvbnRlbnQgPSB2O1xuICAgICAgICByb3cuYXBwZW5kQ2hpbGQoa2V5RWwpO1xuICAgICAgICByb3cuYXBwZW5kQ2hpbGQodmFsRWwpO1xuICAgICAgICBwcm9wcy5hcHBlbmRDaGlsZChyb3cpO1xuICAgICAgfVxuICAgICAgcGFuZWwuYXBwZW5kQ2hpbGQocHJvcHMpO1xuICAgIH1cblxuICAgIGNvbnN0IGNvbm4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIGNvbm4uY2xhc3NOYW1lID0gXCJvbC1pbmZvLWNvbm5lY3Rpb25zXCI7XG4gICAgY29ubi50ZXh0Q29udGVudCA9IGAke2QuY29ubmVjdGlvbnN9IGNvbm5lY3Rpb24ke2QuY29ubmVjdGlvbnMgIT09IDEgPyBcInNcIiA6IFwiXCJ9YDtcbiAgICBwYW5lbC5hcHBlbmRDaGlsZChjb25uKTtcblxuICAgIGNvbnN0IGdvQnRuID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImJ1dHRvblwiKTtcbiAgICBnb0J0bi5jbGFzc05hbWUgPSBcIm9sLWluZm8tZ28tYnRuXCI7XG4gICAgZ29CdG4udGV4dENvbnRlbnQgPSBkLnR5cGUgPT09IFwib2JqZWN0XCIgPyBcIkdvIHRvIG9iamVjdFwiIDogXCJPcGVuIGZpbGVcIjtcbiAgICBnb0J0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgaWYgKGQudHlwZSA9PT0gXCJvYmplY3RcIiAmJiB0aGlzLm5hdmlnYXRlVG9PYmplY3QpIHtcbiAgICAgICAgdGhpcy5uYXZpZ2F0ZVRvT2JqZWN0KGQuZmlsZVBhdGgsIGQuc3RhcnRMaW5lKTtcbiAgICAgIH0gZWxzZSBpZiAodGhpcy5uYXZpZ2F0ZVRvRmlsZSkge1xuICAgICAgICB0aGlzLm5hdmlnYXRlVG9GaWxlKGQuZmlsZVBhdGgpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHBhbmVsLmFwcGVuZENoaWxkKGdvQnRuKTtcblxuICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChwYW5lbCk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBBcHAsIFBsdWdpblNldHRpbmdUYWIsIFNldHRpbmcgfSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB0eXBlIE9iamVjdExpbmtzUGx1Z2luIGZyb20gXCIuL21haW5cIjtcblxuLyoqXG4gKiBQZXJzaXN0ZW50IHBsdWdpbiBzZXR0aW5ncyAoc2F2ZWQgdG8gZGF0YS5qc29uKS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBPYmplY3RMaW5rc1NldHRpbmdzIHtcbiAgb2JqZWN0RmlsZVRhZzogc3RyaW5nO1xuICBvcGVuT2JqZWN0RmlsZXNJblRhYmxlVmlldzogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGNvbnN0IERFRkFVTFRfU0VUVElOR1M6IE9iamVjdExpbmtzU2V0dGluZ3MgPSB7XG4gIG9iamVjdEZpbGVUYWc6IFwib2JqZWN0LWxpbmtzXCIsXG4gIG9wZW5PYmplY3RGaWxlc0luVGFibGVWaWV3OiBmYWxzZSxcbn07XG5cbi8qKlxuICogUGx1Z2luIHNldHRpbmdzIHRhYiBzaG93biBpbiBPYnNpZGlhbidzIHNldHRpbmdzIHBhbmVsLlxuICovXG5leHBvcnQgY2xhc3MgT2JqZWN0TGlua3NTZXR0aW5nVGFiIGV4dGVuZHMgUGx1Z2luU2V0dGluZ1RhYiB7XG4gIHBsdWdpbjogT2JqZWN0TGlua3NQbHVnaW47XG5cbiAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHBsdWdpbjogT2JqZWN0TGlua3NQbHVnaW4pIHtcbiAgICBzdXBlcihhcHAsIHBsdWdpbik7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gIH1cblxuICBkaXNwbGF5KCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcblxuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiaDJcIiwgeyB0ZXh0OiBcIk9iamVjdCBMaW5rc1wiIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIk9iamVjdCBmaWxlIHRhZ1wiKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgIFwiVGFnIHVzZWQgdG8gaWRlbnRpZnkgb2JqZWN0IGZpbGVzLiBcIiArXG4gICAgICAgIFwiT25seSBtYXJrZG93biBmaWxlcyB0aGF0IGluY2x1ZGUgdGhpcyB0YWcgd2lsbCBiZSBwYXJzZWQuIFwiICtcbiAgICAgICAgXCJTdXBwb3J0cyBiYXJlICN0YWdzIChlLmcuICNvYmplY3QtbGlua3Mgb24gYW55IGxpbmUpIFwiICtcbiAgICAgICAgXCJhbmQgWUFNTCBmcm9udG1hdHRlciB0YWdzIChlLmcuIHRhZ3M6IFtvYmplY3QtbGlua3NdKS5cIlxuICAgICAgKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoXCJvYmplY3QtbGlua3NcIilcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3Mub2JqZWN0RmlsZVRhZylcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5vYmplY3RGaWxlVGFnID0gdmFsdWUudHJpbSgpO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiT3BlbiBvYmplY3QgZmlsZXMgaW4gdGFibGUgdmlld1wiKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgIFwiV2hlbiBlbmFibGVkLCBmaWxlcyB0YWdnZWQgYXMgb2JqZWN0IGZpbGVzIHdpbGwgb3BlbiBpbiBhIHRhYmxlIHZpZXcgYnkgZGVmYXVsdC4gXCIgK1xuICAgICAgICBcIllvdSBjYW4gYWx3YXlzIHN3aXRjaCBiYWNrIHRvIHRoZSBub3JtYWwgZWRpdG9yIHZpYSB0aGUgdmlldyBtZW51LlwiXG4gICAgICApXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5vcGVuT2JqZWN0RmlsZXNJblRhYmxlVmlldylcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5vcGVuT2JqZWN0RmlsZXNJblRhYmxlVmlldyA9IHZhbHVlO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG4gIH1cbn1cblxuLyoqXG4gKiBHcmFwaCBjb25maWd1cmF0aW9uIHBhbmVsIC0tIHJlbmRlcmVkIGluc2lkZSB0aGUgZ3JhcGggdmlldy5cbiAqL1xuXG5leHBvcnQgaW50ZXJmYWNlIEdyYXBoQ29uZmlnIHtcbiAgc2VhcmNoOiBzdHJpbmc7XG4gIHNob3dPcnBoYW5zOiBib29sZWFuO1xuICBzaG93RmlsZXM6IGJvb2xlYW47XG4gIHNob3dPYmplY3RzOiBib29sZWFuO1xuICBzaG93V2lraUVkZ2VzOiBib29sZWFuO1xuICBzaG93T2JqZWN0RWRnZXM6IGJvb2xlYW47XG4gIHBhdGhGaWx0ZXI6IHN0cmluZztcbiAgc291cmNlRmlsdGVyOiBzdHJpbmc7XG4gIGNvbm5lY3RPcnBoYW5zVG9Gb2xkZXJzOiBib29sZWFuO1xuICBsaW5rVG9QYXJlbnQ6IGJvb2xlYW47XG4gIC8vIERpc3BsYXlcbiAgbm9kZVNpemVNdWx0aXBsaWVyOiBudW1iZXI7XG4gIG5vZGVNYXhTY3JlZW5SYWRpdXM6IG51bWJlcjtcbiAgbGFiZWxPcGFjaXR5OiBudW1iZXI7XG4gIGxhYmVsTWluWm9vbTogbnVtYmVyO1xuICBsYWJlbE1heFdpZHRoOiBudW1iZXI7XG4gIC8vIEZvcmNlc1xuICBsaW5rRGlzdGFuY2U6IG51bWJlcjtcbiAgY2VudGVyU3RyZW5ndGg6IG51bWJlcjtcbiAgcmVwZWxTdHJlbmd0aDogbnVtYmVyO1xufVxuXG5leHBvcnQgY29uc3QgREVGQVVMVF9DT05GSUc6IEdyYXBoQ29uZmlnID0ge1xuICBzZWFyY2g6IFwiXCIsXG4gIHNob3dPcnBoYW5zOiBmYWxzZSxcbiAgc2hvd0ZpbGVzOiB0cnVlLFxuICBzaG93T2JqZWN0czogdHJ1ZSxcbiAgc2hvd1dpa2lFZGdlczogdHJ1ZSxcbiAgc2hvd09iamVjdEVkZ2VzOiB0cnVlLFxuICBwYXRoRmlsdGVyOiBcIlwiLFxuICBzb3VyY2VGaWx0ZXI6IFwiXCIsXG4gIGNvbm5lY3RPcnBoYW5zVG9Gb2xkZXJzOiBmYWxzZSxcbiAgbGlua1RvUGFyZW50OiBmYWxzZSxcbiAgLy8gRGlzcGxheVxuICBub2RlU2l6ZU11bHRpcGxpZXI6IDEsXG4gIG5vZGVNYXhTY3JlZW5SYWRpdXM6IDE2LFxuICBsYWJlbE9wYWNpdHk6IDAuNjUsXG4gIGxhYmVsTWluWm9vbTogMS4wNSxcbiAgbGFiZWxNYXhXaWR0aDogMTYwLFxuICAvLyBGb3JjZXNcbiAgbGlua0Rpc3RhbmNlOiAxMDAsXG4gIGNlbnRlclN0cmVuZ3RoOiAwLjAzLFxuICByZXBlbFN0cmVuZ3RoOiAzMDAsXG59O1xuXG5leHBvcnQgdHlwZSBDb25maWdDaGFuZ2VDYWxsYmFjayA9IChjb25maWc6IEdyYXBoQ29uZmlnKSA9PiB2b2lkO1xuXG5leHBvcnQgY2xhc3MgQ29uZmlnUGFuZWwge1xuICBwcml2YXRlIHBhbmVsRWw6IEhUTUxFbGVtZW50O1xuICBwcml2YXRlIGNvbmZpZzogR3JhcGhDb25maWc7XG4gIHByaXZhdGUgb25DaGFuZ2U6IENvbmZpZ0NoYW5nZUNhbGxiYWNrO1xuICBwcml2YXRlIGNvbGxhcHNlZDogUmVjb3JkPHN0cmluZywgYm9vbGVhbj4gPSB7XG4gICAgZmlsdGVyOiBmYWxzZSxcbiAgICBkaXNwbGF5OiB0cnVlLFxuICB9O1xuICBwcml2YXRlIGRlYm91bmNlVGltZXJzOiBNYXA8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0Pj4gPSBuZXcgTWFwKCk7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgcGFyZW50OiBIVE1MRWxlbWVudCxcbiAgICBjb25maWc6IEdyYXBoQ29uZmlnLFxuICAgIG9uQ2hhbmdlOiBDb25maWdDaGFuZ2VDYWxsYmFja1xuICApIHtcbiAgICB0aGlzLmNvbmZpZyA9IHsgLi4uY29uZmlnIH07XG4gICAgdGhpcy5vbkNoYW5nZSA9IG9uQ2hhbmdlO1xuXG4gICAgdGhpcy5wYW5lbEVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICB0aGlzLnBhbmVsRWwuY2xhc3NOYW1lID0gXCJvbC1jb25maWctcGFuZWxcIjtcbiAgICBwYXJlbnQuYXBwZW5kQ2hpbGQodGhpcy5wYW5lbEVsKTtcblxuICAgIHRoaXMucmVuZGVyKCk7XG4gIH1cblxuICBnZXRDb25maWcoKTogR3JhcGhDb25maWcge1xuICAgIHJldHVybiB7IC4uLnRoaXMuY29uZmlnIH07XG4gIH1cblxuICBkZXN0cm95KCk6IHZvaWQge1xuICAgIGZvciAoY29uc3QgdCBvZiB0aGlzLmRlYm91bmNlVGltZXJzLnZhbHVlcygpKSBjbGVhclRpbWVvdXQodCk7XG4gICAgdGhpcy5kZWJvdW5jZVRpbWVycy5jbGVhcigpO1xuICAgIHRoaXMucGFuZWxFbC5yZW1vdmUoKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyKCk6IHZvaWQge1xuICAgIHRoaXMucGFuZWxFbC5lbXB0eSgpO1xuXG4gICAgLy8gXHUyNTAwXHUyNTAwIEZpbHRlciBzZWN0aW9uIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuICAgIHRoaXMucmVuZGVyU2VjdGlvbihcImZpbHRlclwiLCBcIkZpbHRlcnNcIiwgKGNvbnRlbnRFbCkgPT4ge1xuICAgICAgLy8gU2VhcmNoXG4gICAgICB0aGlzLnJlbmRlclRleHRJbnB1dChjb250ZW50RWwsIFwiU2VhcmNoXCIsIHRoaXMuY29uZmlnLnNlYXJjaCwgKHYpID0+IHtcbiAgICAgICAgdGhpcy5jb25maWcuc2VhcmNoID0gdjtcbiAgICAgICAgdGhpcy5lbWl0RGVib3VuY2VkKFwic2VhcmNoXCIsIDI1MCk7XG4gICAgICB9KTtcblxuICAgICAgLy8gUGF0aCBmaWx0ZXJcbiAgICAgIHRoaXMucmVuZGVyVGV4dElucHV0KGNvbnRlbnRFbCwgXCJQYXRoIGZpbHRlclwiLCB0aGlzLmNvbmZpZy5wYXRoRmlsdGVyLCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5wYXRoRmlsdGVyID0gdjtcbiAgICAgICAgdGhpcy5lbWl0RGVib3VuY2VkKFwicGF0aEZpbHRlclwiLCAyNTApO1xuICAgICAgfSwgXCJlLmcuIDAwIERhaWx5XCIpO1xuXG4gICAgICAvLyBTb3VyY2UgZmlsdGVyXG4gICAgICB0aGlzLnJlbmRlclRleHRJbnB1dChjb250ZW50RWwsIFwiU291cmNlIGZpbHRlclwiLCB0aGlzLmNvbmZpZy5zb3VyY2VGaWx0ZXIsICh2KSA9PiB7XG4gICAgICAgIHRoaXMuY29uZmlnLnNvdXJjZUZpbHRlciA9IHY7XG4gICAgICAgIHRoaXMuZW1pdERlYm91bmNlZChcInNvdXJjZUZpbHRlclwiLCAyNTApO1xuICAgICAgfSwgXCJlLmcuIEZpbG1zXCIpO1xuXG4gICAgICAvLyBUb2dnbGVzXG4gICAgICB0aGlzLnJlbmRlclRvZ2dsZShjb250ZW50RWwsIFwiU2hvdyBmaWxlc1wiLCB0aGlzLmNvbmZpZy5zaG93RmlsZXMsICh2KSA9PiB7XG4gICAgICAgIHRoaXMuY29uZmlnLnNob3dGaWxlcyA9IHY7XG4gICAgICAgIHRoaXMuZW1pdCgpO1xuICAgICAgfSk7XG5cbiAgICAgIHRoaXMucmVuZGVyVG9nZ2xlKGNvbnRlbnRFbCwgXCJTaG93IG9iamVjdHNcIiwgdGhpcy5jb25maWcuc2hvd09iamVjdHMsICh2KSA9PiB7XG4gICAgICAgIHRoaXMuY29uZmlnLnNob3dPYmplY3RzID0gdjtcbiAgICAgICAgdGhpcy5lbWl0KCk7XG4gICAgICB9KTtcblxuICAgICAgdGhpcy5yZW5kZXJUb2dnbGUoY29udGVudEVsLCBcIlNob3cgb3JwaGFuc1wiLCB0aGlzLmNvbmZpZy5zaG93T3JwaGFucywgKHYpID0+IHtcbiAgICAgICAgdGhpcy5jb25maWcuc2hvd09ycGhhbnMgPSB2O1xuICAgICAgICB0aGlzLmVtaXQoKTtcbiAgICAgIH0pO1xuXG4gICAgICB0aGlzLnJlbmRlclRvZ2dsZShjb250ZW50RWwsIFwiTGluayB0byBwYXJlbnRcIiwgdGhpcy5jb25maWcubGlua1RvUGFyZW50LCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5saW5rVG9QYXJlbnQgPSB2O1xuICAgICAgICB0aGlzLmVtaXQoKTtcbiAgICAgIH0pO1xuXG4gICAgICB0aGlzLnJlbmRlclRvZ2dsZShjb250ZW50RWwsIFwiV2lraSBsaW5rc1wiLCB0aGlzLmNvbmZpZy5zaG93V2lraUVkZ2VzLCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5zaG93V2lraUVkZ2VzID0gdjtcbiAgICAgICAgdGhpcy5lbWl0KCk7XG4gICAgICB9KTtcblxuICAgICAgdGhpcy5yZW5kZXJUb2dnbGUoY29udGVudEVsLCBcIk9iamVjdCBsaW5rc1wiLCB0aGlzLmNvbmZpZy5zaG93T2JqZWN0RWRnZXMsICh2KSA9PiB7XG4gICAgICAgIHRoaXMuY29uZmlnLnNob3dPYmplY3RFZGdlcyA9IHY7XG4gICAgICAgIHRoaXMuZW1pdCgpO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgRGlzcGxheSBzZWN0aW9uIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuICAgIHRoaXMucmVuZGVyU2VjdGlvbihcImRpc3BsYXlcIiwgXCJEaXNwbGF5XCIsIChjb250ZW50RWwpID0+IHtcbiAgICAgIHRoaXMucmVuZGVyU2xpZGVyKGNvbnRlbnRFbCwgXCJOb2RlIHNpemVcIiwgdGhpcy5jb25maWcubm9kZVNpemVNdWx0aXBsaWVyLCAwLjIsIDMsIDAuMSwgKHYpID0+IHtcbiAgICAgICAgdGhpcy5jb25maWcubm9kZVNpemVNdWx0aXBsaWVyID0gdjtcbiAgICAgICAgdGhpcy5lbWl0KCk7XG4gICAgICB9KTtcblxuICAgICAgdGhpcy5yZW5kZXJTbGlkZXIoY29udGVudEVsLCBcIk5vZGUgbWF4IHNpemUgKG9uIHNjcmVlbilcIiwgdGhpcy5jb25maWcubm9kZU1heFNjcmVlblJhZGl1cywgNiwgNDAsIDEsICh2KSA9PiB7XG4gICAgICAgIHRoaXMuY29uZmlnLm5vZGVNYXhTY3JlZW5SYWRpdXMgPSB2O1xuICAgICAgICB0aGlzLmVtaXQoKTtcbiAgICAgIH0pO1xuXG4gICAgICB0aGlzLnJlbmRlclNsaWRlcihjb250ZW50RWwsIFwiTGFiZWxzIGFwcGVhciBhdCB6b29tXCIsIHRoaXMuY29uZmlnLmxhYmVsTWluWm9vbSwgMC4yLCAzLCAwLjA1LCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5sYWJlbE1pblpvb20gPSB2O1xuICAgICAgICB0aGlzLmVtaXQoKTtcbiAgICAgIH0pO1xuXG4gICAgICB0aGlzLnJlbmRlclNsaWRlcihjb250ZW50RWwsIFwiTGFiZWwgbWF4IHdpZHRoXCIsIHRoaXMuY29uZmlnLmxhYmVsTWF4V2lkdGgsIDYwLCAzNjAsIDEwLCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5sYWJlbE1heFdpZHRoID0gdjtcbiAgICAgICAgdGhpcy5lbWl0KCk7XG4gICAgICB9KTtcblxuICAgICAgdGhpcy5yZW5kZXJTbGlkZXIoY29udGVudEVsLCBcIkxhYmVsIG9wYWNpdHlcIiwgdGhpcy5jb25maWcubGFiZWxPcGFjaXR5LCAwLCAxLCAwLjA1LCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5sYWJlbE9wYWNpdHkgPSB2O1xuICAgICAgICB0aGlzLmVtaXQoKTtcbiAgICAgIH0pO1xuXG4gICAgICAvLyBGb3JjZXNcbiAgICAgIHRoaXMucmVuZGVyU2xpZGVyKGNvbnRlbnRFbCwgXCJMaW5rIGRpc3RhbmNlXCIsIHRoaXMuY29uZmlnLmxpbmtEaXN0YW5jZSwgMzAsIDUwMCwgMTAsICh2KSA9PiB7XG4gICAgICAgIHRoaXMuY29uZmlnLmxpbmtEaXN0YW5jZSA9IHY7XG4gICAgICAgIHRoaXMuZW1pdCgpO1xuICAgICAgfSk7XG5cbiAgICAgIHRoaXMucmVuZGVyU2xpZGVyKGNvbnRlbnRFbCwgXCJDZW50ZXIgZm9yY2VcIiwgdGhpcy5jb25maWcuY2VudGVyU3RyZW5ndGgsIDAsIDAuMiwgMC4wMDUsICh2KSA9PiB7XG4gICAgICAgIHRoaXMuY29uZmlnLmNlbnRlclN0cmVuZ3RoID0gdjtcbiAgICAgICAgdGhpcy5lbWl0KCk7XG4gICAgICB9KTtcblxuICAgICAgdGhpcy5yZW5kZXJTbGlkZXIoY29udGVudEVsLCBcIlJlcGVsIGZvcmNlXCIsIHRoaXMuY29uZmlnLnJlcGVsU3RyZW5ndGgsIDUwLCAxMDAwLCAyNSwgKHYpID0+IHtcbiAgICAgICAgdGhpcy5jb25maWcucmVwZWxTdHJlbmd0aCA9IHY7XG4gICAgICAgIHRoaXMuZW1pdCgpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlclNlY3Rpb24oXG4gICAga2V5OiBzdHJpbmcsXG4gICAgdGl0bGU6IHN0cmluZyxcbiAgICBjb250ZW50Rm46IChjb250ZW50RWw6IEhUTUxFbGVtZW50KSA9PiB2b2lkXG4gICk6IHZvaWQge1xuICAgIGNvbnN0IHNlY3Rpb24gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHNlY3Rpb24uY2xhc3NOYW1lID0gXCJvbC1jb25maWctc2VjdGlvblwiO1xuXG4gICAgY29uc3QgaGVhZGVyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICBoZWFkZXIuY2xhc3NOYW1lID0gXCJvbC1jb25maWctc2VjdGlvbi1oZWFkZXJcIjtcbiAgICBoZWFkZXIuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgIHRoaXMuY29sbGFwc2VkW2tleV0gPSAhdGhpcy5jb2xsYXBzZWRba2V5XTtcbiAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgfSk7XG5cbiAgICBjb25zdCBhcnJvdyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgIGFycm93LmNsYXNzTmFtZSA9IFwib2wtY29uZmlnLWFycm93XCI7XG4gICAgYXJyb3cudGV4dENvbnRlbnQgPSB0aGlzLmNvbGxhcHNlZFtrZXldID8gXCJcXHUyNUI2XCIgOiBcIlxcdTI1QkNcIjtcbiAgICBoZWFkZXIuYXBwZW5kQ2hpbGQoYXJyb3cpO1xuXG4gICAgY29uc3QgdGl0bGVFbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgIHRpdGxlRWwudGV4dENvbnRlbnQgPSB0aXRsZTtcbiAgICBoZWFkZXIuYXBwZW5kQ2hpbGQodGl0bGVFbCk7XG5cbiAgICBzZWN0aW9uLmFwcGVuZENoaWxkKGhlYWRlcik7XG5cbiAgICBpZiAoIXRoaXMuY29sbGFwc2VkW2tleV0pIHtcbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgY29udGVudC5jbGFzc05hbWUgPSBcIm9sLWNvbmZpZy1zZWN0aW9uLWNvbnRlbnRcIjtcbiAgICAgIHNlY3Rpb24uYXBwZW5kQ2hpbGQoY29udGVudCk7XG4gICAgICBjb250ZW50Rm4oY29udGVudCk7XG4gICAgfVxuXG4gICAgdGhpcy5wYW5lbEVsLmFwcGVuZENoaWxkKHNlY3Rpb24pO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJUZXh0SW5wdXQoXG4gICAgcGFyZW50OiBIVE1MRWxlbWVudCxcbiAgICBsYWJlbDogc3RyaW5nLFxuICAgIHZhbHVlOiBzdHJpbmcsXG4gICAgb25DaGFuZ2U6ICh2OiBzdHJpbmcpID0+IHZvaWQsXG4gICAgcGxhY2Vob2xkZXI/OiBzdHJpbmdcbiAgKTogdm9pZCB7XG4gICAgY29uc3Qgcm93ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICByb3cuY2xhc3NOYW1lID0gXCJvbC1jb25maWctcm93IG9sLWNvbmZpZy10ZXh0LXJvd1wiO1xuXG4gICAgY29uc3QgbGFiZWxFbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgIGxhYmVsRWwuY2xhc3NOYW1lID0gXCJvbC1jb25maWctbGFiZWxcIjtcbiAgICBsYWJlbEVsLnRleHRDb250ZW50ID0gbGFiZWw7XG4gICAgcm93LmFwcGVuZENoaWxkKGxhYmVsRWwpO1xuXG4gICAgY29uc3QgaW5wdXQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiaW5wdXRcIik7XG4gICAgaW5wdXQudHlwZSA9IFwidGV4dFwiO1xuICAgIGlucHV0LmNsYXNzTmFtZSA9IFwib2wtY29uZmlnLWlucHV0XCI7XG4gICAgaW5wdXQucGxhY2Vob2xkZXIgPSBwbGFjZWhvbGRlciB8fCBcIlwiO1xuICAgIGlucHV0LnZhbHVlID0gdmFsdWU7XG4gICAgaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImlucHV0XCIsICgpID0+IG9uQ2hhbmdlKGlucHV0LnZhbHVlKSk7XG5cbiAgICByb3cuYXBwZW5kQ2hpbGQoaW5wdXQpO1xuICAgIHBhcmVudC5hcHBlbmRDaGlsZChyb3cpO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJUb2dnbGUoXG4gICAgcGFyZW50OiBIVE1MRWxlbWVudCxcbiAgICBsYWJlbDogc3RyaW5nLFxuICAgIHZhbHVlOiBib29sZWFuLFxuICAgIG9uQ2hhbmdlOiAodjogYm9vbGVhbikgPT4gdm9pZFxuICApOiB2b2lkIHtcbiAgICBjb25zdCByb3cgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHJvdy5jbGFzc05hbWUgPSBcIm9sLWNvbmZpZy1yb3cgb2wtY29uZmlnLXRvZ2dsZS1yb3dcIjtcblxuICAgIGNvbnN0IGxhYmVsRWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcbiAgICBsYWJlbEVsLmNsYXNzTmFtZSA9IFwib2wtY29uZmlnLWxhYmVsXCI7XG4gICAgbGFiZWxFbC50ZXh0Q29udGVudCA9IGxhYmVsO1xuICAgIHJvdy5hcHBlbmRDaGlsZChsYWJlbEVsKTtcblxuICAgIGNvbnN0IHRvZ2dsZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgdG9nZ2xlLmNsYXNzTmFtZSA9IGBvbC1jb25maWctdG9nZ2xlICR7dmFsdWUgPyBcImlzLWVuYWJsZWRcIiA6IFwiXCJ9YDtcblxuICAgIGNvbnN0IGtub2IgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIGtub2IuY2xhc3NOYW1lID0gXCJvbC1jb25maWctdG9nZ2xlLWtub2JcIjtcbiAgICB0b2dnbGUuYXBwZW5kQ2hpbGQoa25vYik7XG5cbiAgICB0b2dnbGUuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IG5ld1ZhbCA9ICF0b2dnbGUuY2xhc3NMaXN0LmNvbnRhaW5zKFwiaXMtZW5hYmxlZFwiKTtcbiAgICAgIHRvZ2dsZS5jbGFzc0xpc3QudG9nZ2xlKFwiaXMtZW5hYmxlZFwiLCBuZXdWYWwpO1xuICAgICAgb25DaGFuZ2UobmV3VmFsKTtcbiAgICB9KTtcblxuICAgIHJvdy5hcHBlbmRDaGlsZCh0b2dnbGUpO1xuICAgIHBhcmVudC5hcHBlbmRDaGlsZChyb3cpO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJTbGlkZXIoXG4gICAgcGFyZW50OiBIVE1MRWxlbWVudCxcbiAgICBsYWJlbDogc3RyaW5nLFxuICAgIHZhbHVlOiBudW1iZXIsXG4gICAgbWluOiBudW1iZXIsXG4gICAgbWF4OiBudW1iZXIsXG4gICAgc3RlcDogbnVtYmVyLFxuICAgIG9uQ2hhbmdlOiAodjogbnVtYmVyKSA9PiB2b2lkXG4gICk6IHZvaWQge1xuICAgIGNvbnN0IHNldHRpbmdJdGVtID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICBzZXR0aW5nSXRlbS5jbGFzc05hbWUgPSBcInNldHRpbmctaXRlbSBtb2Qtc2xpZGVyXCI7XG5cbiAgICBjb25zdCBpbmZvID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICBpbmZvLmNsYXNzTmFtZSA9IFwic2V0dGluZy1pdGVtLWluZm9cIjtcblxuICAgIGNvbnN0IG5hbWUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIG5hbWUuY2xhc3NOYW1lID0gXCJzZXR0aW5nLWl0ZW0tbmFtZVwiO1xuICAgIG5hbWUudGV4dENvbnRlbnQgPSBsYWJlbDtcbiAgICBpbmZvLmFwcGVuZENoaWxkKG5hbWUpO1xuXG4gICAgY29uc3QgZGVzYyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgZGVzYy5jbGFzc05hbWUgPSBcInNldHRpbmctaXRlbS1kZXNjcmlwdGlvblwiO1xuICAgIGluZm8uYXBwZW5kQ2hpbGQoZGVzYyk7XG5cbiAgICBzZXR0aW5nSXRlbS5hcHBlbmRDaGlsZChpbmZvKTtcblxuICAgIGNvbnN0IGNvbnRyb2wgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIGNvbnRyb2wuY2xhc3NOYW1lID0gXCJzZXR0aW5nLWl0ZW0tY29udHJvbFwiO1xuXG4gICAgY29uc3Qgc2xpZGVyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImlucHV0XCIpO1xuICAgIHNsaWRlci5jbGFzc05hbWUgPSBcInNsaWRlclwiO1xuICAgIHNsaWRlci50eXBlID0gXCJyYW5nZVwiO1xuICAgIHNsaWRlci5kYXRhc2V0Lmlnbm9yZVN3aXBlID0gXCJ0cnVlXCI7XG4gICAgc2xpZGVyLm1pbiA9IFN0cmluZyhtaW4pO1xuICAgIHNsaWRlci5tYXggPSBTdHJpbmcobWF4KTtcbiAgICBzbGlkZXIuc3RlcCA9IFN0cmluZyhzdGVwKTtcbiAgICBzbGlkZXIudmFsdWUgPSBTdHJpbmcodmFsdWUpO1xuICAgIHNsaWRlci5hZGRFdmVudExpc3RlbmVyKFwiaW5wdXRcIiwgKCkgPT4ge1xuICAgICAgb25DaGFuZ2UocGFyc2VGbG9hdChzbGlkZXIudmFsdWUpKTtcbiAgICB9KTtcblxuICAgIGNvbnRyb2wuYXBwZW5kQ2hpbGQoc2xpZGVyKTtcbiAgICBzZXR0aW5nSXRlbS5hcHBlbmRDaGlsZChjb250cm9sKTtcbiAgICBwYXJlbnQuYXBwZW5kQ2hpbGQoc2V0dGluZ0l0ZW0pO1xuICB9XG5cbiAgcHJpdmF0ZSBlbWl0KCk6IHZvaWQge1xuICAgIHRoaXMub25DaGFuZ2UoeyAuLi50aGlzLmNvbmZpZyB9KTtcbiAgfVxuXG4gIHByaXZhdGUgZW1pdERlYm91bmNlZChrZXk6IHN0cmluZywgbXM6IG51bWJlcik6IHZvaWQge1xuICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5kZWJvdW5jZVRpbWVycy5nZXQoa2V5KTtcbiAgICBpZiAoZXhpc3RpbmcpIGNsZWFyVGltZW91dChleGlzdGluZyk7XG4gICAgdGhpcy5kZWJvdW5jZVRpbWVycy5zZXQoa2V5LCBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMuZGVib3VuY2VUaW1lcnMuZGVsZXRlKGtleSk7XG4gICAgICB0aGlzLmVtaXQoKTtcbiAgICB9LCBtcykpO1xuICB9XG59XG4iLCAidmFyIG5vb3AgPSB7dmFsdWU6ICgpID0+IHt9fTtcblxuZnVuY3Rpb24gZGlzcGF0Y2goKSB7XG4gIGZvciAodmFyIGkgPSAwLCBuID0gYXJndW1lbnRzLmxlbmd0aCwgXyA9IHt9LCB0OyBpIDwgbjsgKytpKSB7XG4gICAgaWYgKCEodCA9IGFyZ3VtZW50c1tpXSArIFwiXCIpIHx8ICh0IGluIF8pIHx8IC9bXFxzLl0vLnRlc3QodCkpIHRocm93IG5ldyBFcnJvcihcImlsbGVnYWwgdHlwZTogXCIgKyB0KTtcbiAgICBfW3RdID0gW107XG4gIH1cbiAgcmV0dXJuIG5ldyBEaXNwYXRjaChfKTtcbn1cblxuZnVuY3Rpb24gRGlzcGF0Y2goXykge1xuICB0aGlzLl8gPSBfO1xufVxuXG5mdW5jdGlvbiBwYXJzZVR5cGVuYW1lcyh0eXBlbmFtZXMsIHR5cGVzKSB7XG4gIHJldHVybiB0eXBlbmFtZXMudHJpbSgpLnNwbGl0KC9efFxccysvKS5tYXAoZnVuY3Rpb24odCkge1xuICAgIHZhciBuYW1lID0gXCJcIiwgaSA9IHQuaW5kZXhPZihcIi5cIik7XG4gICAgaWYgKGkgPj0gMCkgbmFtZSA9IHQuc2xpY2UoaSArIDEpLCB0ID0gdC5zbGljZSgwLCBpKTtcbiAgICBpZiAodCAmJiAhdHlwZXMuaGFzT3duUHJvcGVydHkodCkpIHRocm93IG5ldyBFcnJvcihcInVua25vd24gdHlwZTogXCIgKyB0KTtcbiAgICByZXR1cm4ge3R5cGU6IHQsIG5hbWU6IG5hbWV9O1xuICB9KTtcbn1cblxuRGlzcGF0Y2gucHJvdG90eXBlID0gZGlzcGF0Y2gucHJvdG90eXBlID0ge1xuICBjb25zdHJ1Y3RvcjogRGlzcGF0Y2gsXG4gIG9uOiBmdW5jdGlvbih0eXBlbmFtZSwgY2FsbGJhY2spIHtcbiAgICB2YXIgXyA9IHRoaXMuXyxcbiAgICAgICAgVCA9IHBhcnNlVHlwZW5hbWVzKHR5cGVuYW1lICsgXCJcIiwgXyksXG4gICAgICAgIHQsXG4gICAgICAgIGkgPSAtMSxcbiAgICAgICAgbiA9IFQubGVuZ3RoO1xuXG4gICAgLy8gSWYgbm8gY2FsbGJhY2sgd2FzIHNwZWNpZmllZCwgcmV0dXJuIHRoZSBjYWxsYmFjayBvZiB0aGUgZ2l2ZW4gdHlwZSBhbmQgbmFtZS5cbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA8IDIpIHtcbiAgICAgIHdoaWxlICgrK2kgPCBuKSBpZiAoKHQgPSAodHlwZW5hbWUgPSBUW2ldKS50eXBlKSAmJiAodCA9IGdldChfW3RdLCB0eXBlbmFtZS5uYW1lKSkpIHJldHVybiB0O1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIElmIGEgdHlwZSB3YXMgc3BlY2lmaWVkLCBzZXQgdGhlIGNhbGxiYWNrIGZvciB0aGUgZ2l2ZW4gdHlwZSBhbmQgbmFtZS5cbiAgICAvLyBPdGhlcndpc2UsIGlmIGEgbnVsbCBjYWxsYmFjayB3YXMgc3BlY2lmaWVkLCByZW1vdmUgY2FsbGJhY2tzIG9mIHRoZSBnaXZlbiBuYW1lLlxuICAgIGlmIChjYWxsYmFjayAhPSBudWxsICYmIHR5cGVvZiBjYWxsYmFjayAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoXCJpbnZhbGlkIGNhbGxiYWNrOiBcIiArIGNhbGxiYWNrKTtcbiAgICB3aGlsZSAoKytpIDwgbikge1xuICAgICAgaWYgKHQgPSAodHlwZW5hbWUgPSBUW2ldKS50eXBlKSBfW3RdID0gc2V0KF9bdF0sIHR5cGVuYW1lLm5hbWUsIGNhbGxiYWNrKTtcbiAgICAgIGVsc2UgaWYgKGNhbGxiYWNrID09IG51bGwpIGZvciAodCBpbiBfKSBfW3RdID0gc2V0KF9bdF0sIHR5cGVuYW1lLm5hbWUsIG51bGwpO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzO1xuICB9LFxuICBjb3B5OiBmdW5jdGlvbigpIHtcbiAgICB2YXIgY29weSA9IHt9LCBfID0gdGhpcy5fO1xuICAgIGZvciAodmFyIHQgaW4gXykgY29weVt0XSA9IF9bdF0uc2xpY2UoKTtcbiAgICByZXR1cm4gbmV3IERpc3BhdGNoKGNvcHkpO1xuICB9LFxuICBjYWxsOiBmdW5jdGlvbih0eXBlLCB0aGF0KSB7XG4gICAgaWYgKChuID0gYXJndW1lbnRzLmxlbmd0aCAtIDIpID4gMCkgZm9yICh2YXIgYXJncyA9IG5ldyBBcnJheShuKSwgaSA9IDAsIG4sIHQ7IGkgPCBuOyArK2kpIGFyZ3NbaV0gPSBhcmd1bWVudHNbaSArIDJdO1xuICAgIGlmICghdGhpcy5fLmhhc093blByb3BlcnR5KHR5cGUpKSB0aHJvdyBuZXcgRXJyb3IoXCJ1bmtub3duIHR5cGU6IFwiICsgdHlwZSk7XG4gICAgZm9yICh0ID0gdGhpcy5fW3R5cGVdLCBpID0gMCwgbiA9IHQubGVuZ3RoOyBpIDwgbjsgKytpKSB0W2ldLnZhbHVlLmFwcGx5KHRoYXQsIGFyZ3MpO1xuICB9LFxuICBhcHBseTogZnVuY3Rpb24odHlwZSwgdGhhdCwgYXJncykge1xuICAgIGlmICghdGhpcy5fLmhhc093blByb3BlcnR5KHR5cGUpKSB0aHJvdyBuZXcgRXJyb3IoXCJ1bmtub3duIHR5cGU6IFwiICsgdHlwZSk7XG4gICAgZm9yICh2YXIgdCA9IHRoaXMuX1t0eXBlXSwgaSA9IDAsIG4gPSB0Lmxlbmd0aDsgaSA8IG47ICsraSkgdFtpXS52YWx1ZS5hcHBseSh0aGF0LCBhcmdzKTtcbiAgfVxufTtcblxuZnVuY3Rpb24gZ2V0KHR5cGUsIG5hbWUpIHtcbiAgZm9yICh2YXIgaSA9IDAsIG4gPSB0eXBlLmxlbmd0aCwgYzsgaSA8IG47ICsraSkge1xuICAgIGlmICgoYyA9IHR5cGVbaV0pLm5hbWUgPT09IG5hbWUpIHtcbiAgICAgIHJldHVybiBjLnZhbHVlO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBzZXQodHlwZSwgbmFtZSwgY2FsbGJhY2spIHtcbiAgZm9yICh2YXIgaSA9IDAsIG4gPSB0eXBlLmxlbmd0aDsgaSA8IG47ICsraSkge1xuICAgIGlmICh0eXBlW2ldLm5hbWUgPT09IG5hbWUpIHtcbiAgICAgIHR5cGVbaV0gPSBub29wLCB0eXBlID0gdHlwZS5zbGljZSgwLCBpKS5jb25jYXQodHlwZS5zbGljZShpICsgMSkpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG4gIGlmIChjYWxsYmFjayAhPSBudWxsKSB0eXBlLnB1c2goe25hbWU6IG5hbWUsIHZhbHVlOiBjYWxsYmFja30pO1xuICByZXR1cm4gdHlwZTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZGlzcGF0Y2g7XG4iLCAiZXhwb3J0IHZhciB4aHRtbCA9IFwiaHR0cDovL3d3dy53My5vcmcvMTk5OS94aHRtbFwiO1xuXG5leHBvcnQgZGVmYXVsdCB7XG4gIHN2ZzogXCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiLFxuICB4aHRtbDogeGh0bWwsXG4gIHhsaW5rOiBcImh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmtcIixcbiAgeG1sOiBcImh0dHA6Ly93d3cudzMub3JnL1hNTC8xOTk4L25hbWVzcGFjZVwiLFxuICB4bWxuczogXCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3htbG5zL1wiXG59O1xuIiwgImltcG9ydCBuYW1lc3BhY2VzIGZyb20gXCIuL25hbWVzcGFjZXMuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSkge1xuICB2YXIgcHJlZml4ID0gbmFtZSArPSBcIlwiLCBpID0gcHJlZml4LmluZGV4T2YoXCI6XCIpO1xuICBpZiAoaSA+PSAwICYmIChwcmVmaXggPSBuYW1lLnNsaWNlKDAsIGkpKSAhPT0gXCJ4bWxuc1wiKSBuYW1lID0gbmFtZS5zbGljZShpICsgMSk7XG4gIHJldHVybiBuYW1lc3BhY2VzLmhhc093blByb3BlcnR5KHByZWZpeCkgPyB7c3BhY2U6IG5hbWVzcGFjZXNbcHJlZml4XSwgbG9jYWw6IG5hbWV9IDogbmFtZTsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1wcm90b3R5cGUtYnVpbHRpbnNcbn1cbiIsICJpbXBvcnQgbmFtZXNwYWNlIGZyb20gXCIuL25hbWVzcGFjZS5qc1wiO1xuaW1wb3J0IHt4aHRtbH0gZnJvbSBcIi4vbmFtZXNwYWNlcy5qc1wiO1xuXG5mdW5jdGlvbiBjcmVhdG9ySW5oZXJpdChuYW1lKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgZG9jdW1lbnQgPSB0aGlzLm93bmVyRG9jdW1lbnQsXG4gICAgICAgIHVyaSA9IHRoaXMubmFtZXNwYWNlVVJJO1xuICAgIHJldHVybiB1cmkgPT09IHhodG1sICYmIGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5uYW1lc3BhY2VVUkkgPT09IHhodG1sXG4gICAgICAgID8gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChuYW1lKVxuICAgICAgICA6IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnROUyh1cmksIG5hbWUpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBjcmVhdG9yRml4ZWQoZnVsbG5hbWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLm93bmVyRG9jdW1lbnQuY3JlYXRlRWxlbWVudE5TKGZ1bGxuYW1lLnNwYWNlLCBmdWxsbmFtZS5sb2NhbCk7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG5hbWUpIHtcbiAgdmFyIGZ1bGxuYW1lID0gbmFtZXNwYWNlKG5hbWUpO1xuICByZXR1cm4gKGZ1bGxuYW1lLmxvY2FsXG4gICAgICA/IGNyZWF0b3JGaXhlZFxuICAgICAgOiBjcmVhdG9ySW5oZXJpdCkoZnVsbG5hbWUpO1xufVxuIiwgImZ1bmN0aW9uIG5vbmUoKSB7fVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihzZWxlY3Rvcikge1xuICByZXR1cm4gc2VsZWN0b3IgPT0gbnVsbCA/IG5vbmUgOiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeVNlbGVjdG9yKHNlbGVjdG9yKTtcbiAgfTtcbn1cbiIsICJpbXBvcnQge1NlbGVjdGlvbn0gZnJvbSBcIi4vaW5kZXguanNcIjtcbmltcG9ydCBzZWxlY3RvciBmcm9tIFwiLi4vc2VsZWN0b3IuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oc2VsZWN0KSB7XG4gIGlmICh0eXBlb2Ygc2VsZWN0ICE9PSBcImZ1bmN0aW9uXCIpIHNlbGVjdCA9IHNlbGVjdG9yKHNlbGVjdCk7XG5cbiAgZm9yICh2YXIgZ3JvdXBzID0gdGhpcy5fZ3JvdXBzLCBtID0gZ3JvdXBzLmxlbmd0aCwgc3ViZ3JvdXBzID0gbmV3IEFycmF5KG0pLCBqID0gMDsgaiA8IG07ICsraikge1xuICAgIGZvciAodmFyIGdyb3VwID0gZ3JvdXBzW2pdLCBuID0gZ3JvdXAubGVuZ3RoLCBzdWJncm91cCA9IHN1Ymdyb3Vwc1tqXSA9IG5ldyBBcnJheShuKSwgbm9kZSwgc3Vibm9kZSwgaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIGlmICgobm9kZSA9IGdyb3VwW2ldKSAmJiAoc3Vibm9kZSA9IHNlbGVjdC5jYWxsKG5vZGUsIG5vZGUuX19kYXRhX18sIGksIGdyb3VwKSkpIHtcbiAgICAgICAgaWYgKFwiX19kYXRhX19cIiBpbiBub2RlKSBzdWJub2RlLl9fZGF0YV9fID0gbm9kZS5fX2RhdGFfXztcbiAgICAgICAgc3ViZ3JvdXBbaV0gPSBzdWJub2RlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBuZXcgU2VsZWN0aW9uKHN1Ymdyb3VwcywgdGhpcy5fcGFyZW50cyk7XG59XG4iLCAiLy8gR2l2ZW4gc29tZXRoaW5nIGFycmF5IGxpa2UgKG9yIG51bGwpLCByZXR1cm5zIHNvbWV0aGluZyB0aGF0IGlzIHN0cmljdGx5IGFuXG4vLyBhcnJheS4gVGhpcyBpcyB1c2VkIHRvIGVuc3VyZSB0aGF0IGFycmF5LWxpa2Ugb2JqZWN0cyBwYXNzZWQgdG8gZDMuc2VsZWN0QWxsXG4vLyBvciBzZWxlY3Rpb24uc2VsZWN0QWxsIGFyZSBjb252ZXJ0ZWQgaW50byBwcm9wZXIgYXJyYXlzIHdoZW4gY3JlYXRpbmcgYVxuLy8gc2VsZWN0aW9uOyB3ZSBkb25cdTIwMTl0IGV2ZXIgd2FudCB0byBjcmVhdGUgYSBzZWxlY3Rpb24gYmFja2VkIGJ5IGEgbGl2ZVxuLy8gSFRNTENvbGxlY3Rpb24gb3IgTm9kZUxpc3QuIEhvd2V2ZXIsIG5vdGUgdGhhdCBzZWxlY3Rpb24uc2VsZWN0QWxsIHdpbGwgdXNlIGFcbi8vIHN0YXRpYyBOb2RlTGlzdCBhcyBhIGdyb3VwLCBzaW5jZSBpdCBzYWZlbHkgZGVyaXZlZCBmcm9tIHF1ZXJ5U2VsZWN0b3JBbGwuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBhcnJheSh4KSB7XG4gIHJldHVybiB4ID09IG51bGwgPyBbXSA6IEFycmF5LmlzQXJyYXkoeCkgPyB4IDogQXJyYXkuZnJvbSh4KTtcbn1cbiIsICJmdW5jdGlvbiBlbXB0eSgpIHtcbiAgcmV0dXJuIFtdO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihzZWxlY3Rvcikge1xuICByZXR1cm4gc2VsZWN0b3IgPT0gbnVsbCA/IGVtcHR5IDogZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnlTZWxlY3RvckFsbChzZWxlY3Rvcik7XG4gIH07XG59XG4iLCAiaW1wb3J0IHtTZWxlY3Rpb259IGZyb20gXCIuL2luZGV4LmpzXCI7XG5pbXBvcnQgYXJyYXkgZnJvbSBcIi4uL2FycmF5LmpzXCI7XG5pbXBvcnQgc2VsZWN0b3JBbGwgZnJvbSBcIi4uL3NlbGVjdG9yQWxsLmpzXCI7XG5cbmZ1bmN0aW9uIGFycmF5QWxsKHNlbGVjdCkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGFycmF5KHNlbGVjdC5hcHBseSh0aGlzLCBhcmd1bWVudHMpKTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oc2VsZWN0KSB7XG4gIGlmICh0eXBlb2Ygc2VsZWN0ID09PSBcImZ1bmN0aW9uXCIpIHNlbGVjdCA9IGFycmF5QWxsKHNlbGVjdCk7XG4gIGVsc2Ugc2VsZWN0ID0gc2VsZWN0b3JBbGwoc2VsZWN0KTtcblxuICBmb3IgKHZhciBncm91cHMgPSB0aGlzLl9ncm91cHMsIG0gPSBncm91cHMubGVuZ3RoLCBzdWJncm91cHMgPSBbXSwgcGFyZW50cyA9IFtdLCBqID0gMDsgaiA8IG07ICsraikge1xuICAgIGZvciAodmFyIGdyb3VwID0gZ3JvdXBzW2pdLCBuID0gZ3JvdXAubGVuZ3RoLCBub2RlLCBpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgaWYgKG5vZGUgPSBncm91cFtpXSkge1xuICAgICAgICBzdWJncm91cHMucHVzaChzZWxlY3QuY2FsbChub2RlLCBub2RlLl9fZGF0YV9fLCBpLCBncm91cCkpO1xuICAgICAgICBwYXJlbnRzLnB1c2gobm9kZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG5ldyBTZWxlY3Rpb24oc3ViZ3JvdXBzLCBwYXJlbnRzKTtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbihzZWxlY3Rvcikge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMubWF0Y2hlcyhzZWxlY3Rvcik7XG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjaGlsZE1hdGNoZXIoc2VsZWN0b3IpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKG5vZGUpIHtcbiAgICByZXR1cm4gbm9kZS5tYXRjaGVzKHNlbGVjdG9yKTtcbiAgfTtcbn1cblxuIiwgImltcG9ydCB7Y2hpbGRNYXRjaGVyfSBmcm9tIFwiLi4vbWF0Y2hlci5qc1wiO1xuXG52YXIgZmluZCA9IEFycmF5LnByb3RvdHlwZS5maW5kO1xuXG5mdW5jdGlvbiBjaGlsZEZpbmQobWF0Y2gpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBmaW5kLmNhbGwodGhpcy5jaGlsZHJlbiwgbWF0Y2gpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBjaGlsZEZpcnN0KCkge1xuICByZXR1cm4gdGhpcy5maXJzdEVsZW1lbnRDaGlsZDtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obWF0Y2gpIHtcbiAgcmV0dXJuIHRoaXMuc2VsZWN0KG1hdGNoID09IG51bGwgPyBjaGlsZEZpcnN0XG4gICAgICA6IGNoaWxkRmluZCh0eXBlb2YgbWF0Y2ggPT09IFwiZnVuY3Rpb25cIiA/IG1hdGNoIDogY2hpbGRNYXRjaGVyKG1hdGNoKSkpO1xufVxuIiwgImltcG9ydCB7Y2hpbGRNYXRjaGVyfSBmcm9tIFwiLi4vbWF0Y2hlci5qc1wiO1xuXG52YXIgZmlsdGVyID0gQXJyYXkucHJvdG90eXBlLmZpbHRlcjtcblxuZnVuY3Rpb24gY2hpbGRyZW4oKSB7XG4gIHJldHVybiBBcnJheS5mcm9tKHRoaXMuY2hpbGRyZW4pO1xufVxuXG5mdW5jdGlvbiBjaGlsZHJlbkZpbHRlcihtYXRjaCkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGZpbHRlci5jYWxsKHRoaXMuY2hpbGRyZW4sIG1hdGNoKTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obWF0Y2gpIHtcbiAgcmV0dXJuIHRoaXMuc2VsZWN0QWxsKG1hdGNoID09IG51bGwgPyBjaGlsZHJlblxuICAgICAgOiBjaGlsZHJlbkZpbHRlcih0eXBlb2YgbWF0Y2ggPT09IFwiZnVuY3Rpb25cIiA/IG1hdGNoIDogY2hpbGRNYXRjaGVyKG1hdGNoKSkpO1xufVxuIiwgImltcG9ydCB7U2VsZWN0aW9ufSBmcm9tIFwiLi9pbmRleC5qc1wiO1xuaW1wb3J0IG1hdGNoZXIgZnJvbSBcIi4uL21hdGNoZXIuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obWF0Y2gpIHtcbiAgaWYgKHR5cGVvZiBtYXRjaCAhPT0gXCJmdW5jdGlvblwiKSBtYXRjaCA9IG1hdGNoZXIobWF0Y2gpO1xuXG4gIGZvciAodmFyIGdyb3VwcyA9IHRoaXMuX2dyb3VwcywgbSA9IGdyb3Vwcy5sZW5ndGgsIHN1Ymdyb3VwcyA9IG5ldyBBcnJheShtKSwgaiA9IDA7IGogPCBtOyArK2opIHtcbiAgICBmb3IgKHZhciBncm91cCA9IGdyb3Vwc1tqXSwgbiA9IGdyb3VwLmxlbmd0aCwgc3ViZ3JvdXAgPSBzdWJncm91cHNbal0gPSBbXSwgbm9kZSwgaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIGlmICgobm9kZSA9IGdyb3VwW2ldKSAmJiBtYXRjaC5jYWxsKG5vZGUsIG5vZGUuX19kYXRhX18sIGksIGdyb3VwKSkge1xuICAgICAgICBzdWJncm91cC5wdXNoKG5vZGUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBuZXcgU2VsZWN0aW9uKHN1Ymdyb3VwcywgdGhpcy5fcGFyZW50cyk7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24odXBkYXRlKSB7XG4gIHJldHVybiBuZXcgQXJyYXkodXBkYXRlLmxlbmd0aCk7XG59XG4iLCAiaW1wb3J0IHNwYXJzZSBmcm9tIFwiLi9zcGFyc2UuanNcIjtcbmltcG9ydCB7U2VsZWN0aW9ufSBmcm9tIFwiLi9pbmRleC5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIG5ldyBTZWxlY3Rpb24odGhpcy5fZW50ZXIgfHwgdGhpcy5fZ3JvdXBzLm1hcChzcGFyc2UpLCB0aGlzLl9wYXJlbnRzKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIEVudGVyTm9kZShwYXJlbnQsIGRhdHVtKSB7XG4gIHRoaXMub3duZXJEb2N1bWVudCA9IHBhcmVudC5vd25lckRvY3VtZW50O1xuICB0aGlzLm5hbWVzcGFjZVVSSSA9IHBhcmVudC5uYW1lc3BhY2VVUkk7XG4gIHRoaXMuX25leHQgPSBudWxsO1xuICB0aGlzLl9wYXJlbnQgPSBwYXJlbnQ7XG4gIHRoaXMuX19kYXRhX18gPSBkYXR1bTtcbn1cblxuRW50ZXJOb2RlLnByb3RvdHlwZSA9IHtcbiAgY29uc3RydWN0b3I6IEVudGVyTm9kZSxcbiAgYXBwZW5kQ2hpbGQ6IGZ1bmN0aW9uKGNoaWxkKSB7IHJldHVybiB0aGlzLl9wYXJlbnQuaW5zZXJ0QmVmb3JlKGNoaWxkLCB0aGlzLl9uZXh0KTsgfSxcbiAgaW5zZXJ0QmVmb3JlOiBmdW5jdGlvbihjaGlsZCwgbmV4dCkgeyByZXR1cm4gdGhpcy5fcGFyZW50Lmluc2VydEJlZm9yZShjaGlsZCwgbmV4dCk7IH0sXG4gIHF1ZXJ5U2VsZWN0b3I6IGZ1bmN0aW9uKHNlbGVjdG9yKSB7IHJldHVybiB0aGlzLl9wYXJlbnQucXVlcnlTZWxlY3RvcihzZWxlY3Rvcik7IH0sXG4gIHF1ZXJ5U2VsZWN0b3JBbGw6IGZ1bmN0aW9uKHNlbGVjdG9yKSB7IHJldHVybiB0aGlzLl9wYXJlbnQucXVlcnlTZWxlY3RvckFsbChzZWxlY3Rvcik7IH1cbn07XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oeCkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHg7XG4gIH07XG59XG4iLCAiaW1wb3J0IHtTZWxlY3Rpb259IGZyb20gXCIuL2luZGV4LmpzXCI7XG5pbXBvcnQge0VudGVyTm9kZX0gZnJvbSBcIi4vZW50ZXIuanNcIjtcbmltcG9ydCBjb25zdGFudCBmcm9tIFwiLi4vY29uc3RhbnQuanNcIjtcblxuZnVuY3Rpb24gYmluZEluZGV4KHBhcmVudCwgZ3JvdXAsIGVudGVyLCB1cGRhdGUsIGV4aXQsIGRhdGEpIHtcbiAgdmFyIGkgPSAwLFxuICAgICAgbm9kZSxcbiAgICAgIGdyb3VwTGVuZ3RoID0gZ3JvdXAubGVuZ3RoLFxuICAgICAgZGF0YUxlbmd0aCA9IGRhdGEubGVuZ3RoO1xuXG4gIC8vIFB1dCBhbnkgbm9uLW51bGwgbm9kZXMgdGhhdCBmaXQgaW50byB1cGRhdGUuXG4gIC8vIFB1dCBhbnkgbnVsbCBub2RlcyBpbnRvIGVudGVyLlxuICAvLyBQdXQgYW55IHJlbWFpbmluZyBkYXRhIGludG8gZW50ZXIuXG4gIGZvciAoOyBpIDwgZGF0YUxlbmd0aDsgKytpKSB7XG4gICAgaWYgKG5vZGUgPSBncm91cFtpXSkge1xuICAgICAgbm9kZS5fX2RhdGFfXyA9IGRhdGFbaV07XG4gICAgICB1cGRhdGVbaV0gPSBub2RlO1xuICAgIH0gZWxzZSB7XG4gICAgICBlbnRlcltpXSA9IG5ldyBFbnRlck5vZGUocGFyZW50LCBkYXRhW2ldKTtcbiAgICB9XG4gIH1cblxuICAvLyBQdXQgYW55IG5vbi1udWxsIG5vZGVzIHRoYXQgZG9uXHUyMDE5dCBmaXQgaW50byBleGl0LlxuICBmb3IgKDsgaSA8IGdyb3VwTGVuZ3RoOyArK2kpIHtcbiAgICBpZiAobm9kZSA9IGdyb3VwW2ldKSB7XG4gICAgICBleGl0W2ldID0gbm9kZTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gYmluZEtleShwYXJlbnQsIGdyb3VwLCBlbnRlciwgdXBkYXRlLCBleGl0LCBkYXRhLCBrZXkpIHtcbiAgdmFyIGksXG4gICAgICBub2RlLFxuICAgICAgbm9kZUJ5S2V5VmFsdWUgPSBuZXcgTWFwLFxuICAgICAgZ3JvdXBMZW5ndGggPSBncm91cC5sZW5ndGgsXG4gICAgICBkYXRhTGVuZ3RoID0gZGF0YS5sZW5ndGgsXG4gICAgICBrZXlWYWx1ZXMgPSBuZXcgQXJyYXkoZ3JvdXBMZW5ndGgpLFxuICAgICAga2V5VmFsdWU7XG5cbiAgLy8gQ29tcHV0ZSB0aGUga2V5IGZvciBlYWNoIG5vZGUuXG4gIC8vIElmIG11bHRpcGxlIG5vZGVzIGhhdmUgdGhlIHNhbWUga2V5LCB0aGUgZHVwbGljYXRlcyBhcmUgYWRkZWQgdG8gZXhpdC5cbiAgZm9yIChpID0gMDsgaSA8IGdyb3VwTGVuZ3RoOyArK2kpIHtcbiAgICBpZiAobm9kZSA9IGdyb3VwW2ldKSB7XG4gICAgICBrZXlWYWx1ZXNbaV0gPSBrZXlWYWx1ZSA9IGtleS5jYWxsKG5vZGUsIG5vZGUuX19kYXRhX18sIGksIGdyb3VwKSArIFwiXCI7XG4gICAgICBpZiAobm9kZUJ5S2V5VmFsdWUuaGFzKGtleVZhbHVlKSkge1xuICAgICAgICBleGl0W2ldID0gbm9kZTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG5vZGVCeUtleVZhbHVlLnNldChrZXlWYWx1ZSwgbm9kZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gQ29tcHV0ZSB0aGUga2V5IGZvciBlYWNoIGRhdHVtLlxuICAvLyBJZiB0aGVyZSBhIG5vZGUgYXNzb2NpYXRlZCB3aXRoIHRoaXMga2V5LCBqb2luIGFuZCBhZGQgaXQgdG8gdXBkYXRlLlxuICAvLyBJZiB0aGVyZSBpcyBub3QgKG9yIHRoZSBrZXkgaXMgYSBkdXBsaWNhdGUpLCBhZGQgaXQgdG8gZW50ZXIuXG4gIGZvciAoaSA9IDA7IGkgPCBkYXRhTGVuZ3RoOyArK2kpIHtcbiAgICBrZXlWYWx1ZSA9IGtleS5jYWxsKHBhcmVudCwgZGF0YVtpXSwgaSwgZGF0YSkgKyBcIlwiO1xuICAgIGlmIChub2RlID0gbm9kZUJ5S2V5VmFsdWUuZ2V0KGtleVZhbHVlKSkge1xuICAgICAgdXBkYXRlW2ldID0gbm9kZTtcbiAgICAgIG5vZGUuX19kYXRhX18gPSBkYXRhW2ldO1xuICAgICAgbm9kZUJ5S2V5VmFsdWUuZGVsZXRlKGtleVZhbHVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgZW50ZXJbaV0gPSBuZXcgRW50ZXJOb2RlKHBhcmVudCwgZGF0YVtpXSk7XG4gICAgfVxuICB9XG5cbiAgLy8gQWRkIGFueSByZW1haW5pbmcgbm9kZXMgdGhhdCB3ZXJlIG5vdCBib3VuZCB0byBkYXRhIHRvIGV4aXQuXG4gIGZvciAoaSA9IDA7IGkgPCBncm91cExlbmd0aDsgKytpKSB7XG4gICAgaWYgKChub2RlID0gZ3JvdXBbaV0pICYmIChub2RlQnlLZXlWYWx1ZS5nZXQoa2V5VmFsdWVzW2ldKSA9PT0gbm9kZSkpIHtcbiAgICAgIGV4aXRbaV0gPSBub2RlO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBkYXR1bShub2RlKSB7XG4gIHJldHVybiBub2RlLl9fZGF0YV9fO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih2YWx1ZSwga2V5KSB7XG4gIGlmICghYXJndW1lbnRzLmxlbmd0aCkgcmV0dXJuIEFycmF5LmZyb20odGhpcywgZGF0dW0pO1xuXG4gIHZhciBiaW5kID0ga2V5ID8gYmluZEtleSA6IGJpbmRJbmRleCxcbiAgICAgIHBhcmVudHMgPSB0aGlzLl9wYXJlbnRzLFxuICAgICAgZ3JvdXBzID0gdGhpcy5fZ3JvdXBzO1xuXG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwiZnVuY3Rpb25cIikgdmFsdWUgPSBjb25zdGFudCh2YWx1ZSk7XG5cbiAgZm9yICh2YXIgbSA9IGdyb3Vwcy5sZW5ndGgsIHVwZGF0ZSA9IG5ldyBBcnJheShtKSwgZW50ZXIgPSBuZXcgQXJyYXkobSksIGV4aXQgPSBuZXcgQXJyYXkobSksIGogPSAwOyBqIDwgbTsgKytqKSB7XG4gICAgdmFyIHBhcmVudCA9IHBhcmVudHNbal0sXG4gICAgICAgIGdyb3VwID0gZ3JvdXBzW2pdLFxuICAgICAgICBncm91cExlbmd0aCA9IGdyb3VwLmxlbmd0aCxcbiAgICAgICAgZGF0YSA9IGFycmF5bGlrZSh2YWx1ZS5jYWxsKHBhcmVudCwgcGFyZW50ICYmIHBhcmVudC5fX2RhdGFfXywgaiwgcGFyZW50cykpLFxuICAgICAgICBkYXRhTGVuZ3RoID0gZGF0YS5sZW5ndGgsXG4gICAgICAgIGVudGVyR3JvdXAgPSBlbnRlcltqXSA9IG5ldyBBcnJheShkYXRhTGVuZ3RoKSxcbiAgICAgICAgdXBkYXRlR3JvdXAgPSB1cGRhdGVbal0gPSBuZXcgQXJyYXkoZGF0YUxlbmd0aCksXG4gICAgICAgIGV4aXRHcm91cCA9IGV4aXRbal0gPSBuZXcgQXJyYXkoZ3JvdXBMZW5ndGgpO1xuXG4gICAgYmluZChwYXJlbnQsIGdyb3VwLCBlbnRlckdyb3VwLCB1cGRhdGVHcm91cCwgZXhpdEdyb3VwLCBkYXRhLCBrZXkpO1xuXG4gICAgLy8gTm93IGNvbm5lY3QgdGhlIGVudGVyIG5vZGVzIHRvIHRoZWlyIGZvbGxvd2luZyB1cGRhdGUgbm9kZSwgc3VjaCB0aGF0XG4gICAgLy8gYXBwZW5kQ2hpbGQgY2FuIGluc2VydCB0aGUgbWF0ZXJpYWxpemVkIGVudGVyIG5vZGUgYmVmb3JlIHRoaXMgbm9kZSxcbiAgICAvLyByYXRoZXIgdGhhbiBhdCB0aGUgZW5kIG9mIHRoZSBwYXJlbnQgbm9kZS5cbiAgICBmb3IgKHZhciBpMCA9IDAsIGkxID0gMCwgcHJldmlvdXMsIG5leHQ7IGkwIDwgZGF0YUxlbmd0aDsgKytpMCkge1xuICAgICAgaWYgKHByZXZpb3VzID0gZW50ZXJHcm91cFtpMF0pIHtcbiAgICAgICAgaWYgKGkwID49IGkxKSBpMSA9IGkwICsgMTtcbiAgICAgICAgd2hpbGUgKCEobmV4dCA9IHVwZGF0ZUdyb3VwW2kxXSkgJiYgKytpMSA8IGRhdGFMZW5ndGgpO1xuICAgICAgICBwcmV2aW91cy5fbmV4dCA9IG5leHQgfHwgbnVsbDtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICB1cGRhdGUgPSBuZXcgU2VsZWN0aW9uKHVwZGF0ZSwgcGFyZW50cyk7XG4gIHVwZGF0ZS5fZW50ZXIgPSBlbnRlcjtcbiAgdXBkYXRlLl9leGl0ID0gZXhpdDtcbiAgcmV0dXJuIHVwZGF0ZTtcbn1cblxuLy8gR2l2ZW4gc29tZSBkYXRhLCB0aGlzIHJldHVybnMgYW4gYXJyYXktbGlrZSB2aWV3IG9mIGl0OiBhbiBvYmplY3QgdGhhdFxuLy8gZXhwb3NlcyBhIGxlbmd0aCBwcm9wZXJ0eSBhbmQgYWxsb3dzIG51bWVyaWMgaW5kZXhpbmcuIE5vdGUgdGhhdCB1bmxpa2Vcbi8vIHNlbGVjdEFsbCwgdGhpcyBpc25cdTIwMTl0IHdvcnJpZWQgYWJvdXQgXHUyMDFDbGl2ZVx1MjAxRCBjb2xsZWN0aW9ucyBiZWNhdXNlIHRoZSByZXN1bHRpbmdcbi8vIGFycmF5IHdpbGwgb25seSBiZSB1c2VkIGJyaWVmbHkgd2hpbGUgZGF0YSBpcyBiZWluZyBib3VuZC4gKEl0IGlzIHBvc3NpYmxlIHRvXG4vLyBjYXVzZSB0aGUgZGF0YSB0byBjaGFuZ2Ugd2hpbGUgaXRlcmF0aW5nIGJ5IHVzaW5nIGEga2V5IGZ1bmN0aW9uLCBidXQgcGxlYXNlXG4vLyBkb25cdTIwMTl0OyB3ZVx1MjAxOWQgcmF0aGVyIGF2b2lkIGEgZ3JhdHVpdG91cyBjb3B5LilcbmZ1bmN0aW9uIGFycmF5bGlrZShkYXRhKSB7XG4gIHJldHVybiB0eXBlb2YgZGF0YSA9PT0gXCJvYmplY3RcIiAmJiBcImxlbmd0aFwiIGluIGRhdGFcbiAgICA/IGRhdGEgLy8gQXJyYXksIFR5cGVkQXJyYXksIE5vZGVMaXN0LCBhcnJheS1saWtlXG4gICAgOiBBcnJheS5mcm9tKGRhdGEpOyAvLyBNYXAsIFNldCwgaXRlcmFibGUsIHN0cmluZywgb3IgYW55dGhpbmcgZWxzZVxufVxuIiwgImltcG9ydCBzcGFyc2UgZnJvbSBcIi4vc3BhcnNlLmpzXCI7XG5pbXBvcnQge1NlbGVjdGlvbn0gZnJvbSBcIi4vaW5kZXguanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIHJldHVybiBuZXcgU2VsZWN0aW9uKHRoaXMuX2V4aXQgfHwgdGhpcy5fZ3JvdXBzLm1hcChzcGFyc2UpLCB0aGlzLl9wYXJlbnRzKTtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbihvbmVudGVyLCBvbnVwZGF0ZSwgb25leGl0KSB7XG4gIHZhciBlbnRlciA9IHRoaXMuZW50ZXIoKSwgdXBkYXRlID0gdGhpcywgZXhpdCA9IHRoaXMuZXhpdCgpO1xuICBpZiAodHlwZW9mIG9uZW50ZXIgPT09IFwiZnVuY3Rpb25cIikge1xuICAgIGVudGVyID0gb25lbnRlcihlbnRlcik7XG4gICAgaWYgKGVudGVyKSBlbnRlciA9IGVudGVyLnNlbGVjdGlvbigpO1xuICB9IGVsc2Uge1xuICAgIGVudGVyID0gZW50ZXIuYXBwZW5kKG9uZW50ZXIgKyBcIlwiKTtcbiAgfVxuICBpZiAob251cGRhdGUgIT0gbnVsbCkge1xuICAgIHVwZGF0ZSA9IG9udXBkYXRlKHVwZGF0ZSk7XG4gICAgaWYgKHVwZGF0ZSkgdXBkYXRlID0gdXBkYXRlLnNlbGVjdGlvbigpO1xuICB9XG4gIGlmIChvbmV4aXQgPT0gbnVsbCkgZXhpdC5yZW1vdmUoKTsgZWxzZSBvbmV4aXQoZXhpdCk7XG4gIHJldHVybiBlbnRlciAmJiB1cGRhdGUgPyBlbnRlci5tZXJnZSh1cGRhdGUpLm9yZGVyKCkgOiB1cGRhdGU7XG59XG4iLCAiaW1wb3J0IHtTZWxlY3Rpb259IGZyb20gXCIuL2luZGV4LmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGNvbnRleHQpIHtcbiAgdmFyIHNlbGVjdGlvbiA9IGNvbnRleHQuc2VsZWN0aW9uID8gY29udGV4dC5zZWxlY3Rpb24oKSA6IGNvbnRleHQ7XG5cbiAgZm9yICh2YXIgZ3JvdXBzMCA9IHRoaXMuX2dyb3VwcywgZ3JvdXBzMSA9IHNlbGVjdGlvbi5fZ3JvdXBzLCBtMCA9IGdyb3VwczAubGVuZ3RoLCBtMSA9IGdyb3VwczEubGVuZ3RoLCBtID0gTWF0aC5taW4obTAsIG0xKSwgbWVyZ2VzID0gbmV3IEFycmF5KG0wKSwgaiA9IDA7IGogPCBtOyArK2opIHtcbiAgICBmb3IgKHZhciBncm91cDAgPSBncm91cHMwW2pdLCBncm91cDEgPSBncm91cHMxW2pdLCBuID0gZ3JvdXAwLmxlbmd0aCwgbWVyZ2UgPSBtZXJnZXNbal0gPSBuZXcgQXJyYXkobiksIG5vZGUsIGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAobm9kZSA9IGdyb3VwMFtpXSB8fCBncm91cDFbaV0pIHtcbiAgICAgICAgbWVyZ2VbaV0gPSBub2RlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGZvciAoOyBqIDwgbTA7ICsraikge1xuICAgIG1lcmdlc1tqXSA9IGdyb3VwczBbal07XG4gIH1cblxuICByZXR1cm4gbmV3IFNlbGVjdGlvbihtZXJnZXMsIHRoaXMuX3BhcmVudHMpO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKCkge1xuXG4gIGZvciAodmFyIGdyb3VwcyA9IHRoaXMuX2dyb3VwcywgaiA9IC0xLCBtID0gZ3JvdXBzLmxlbmd0aDsgKytqIDwgbTspIHtcbiAgICBmb3IgKHZhciBncm91cCA9IGdyb3Vwc1tqXSwgaSA9IGdyb3VwLmxlbmd0aCAtIDEsIG5leHQgPSBncm91cFtpXSwgbm9kZTsgLS1pID49IDA7KSB7XG4gICAgICBpZiAobm9kZSA9IGdyb3VwW2ldKSB7XG4gICAgICAgIGlmIChuZXh0ICYmIG5vZGUuY29tcGFyZURvY3VtZW50UG9zaXRpb24obmV4dCkgXiA0KSBuZXh0LnBhcmVudE5vZGUuaW5zZXJ0QmVmb3JlKG5vZGUsIG5leHQpO1xuICAgICAgICBuZXh0ID0gbm9kZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn1cbiIsICJpbXBvcnQge1NlbGVjdGlvbn0gZnJvbSBcIi4vaW5kZXguanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oY29tcGFyZSkge1xuICBpZiAoIWNvbXBhcmUpIGNvbXBhcmUgPSBhc2NlbmRpbmc7XG5cbiAgZnVuY3Rpb24gY29tcGFyZU5vZGUoYSwgYikge1xuICAgIHJldHVybiBhICYmIGIgPyBjb21wYXJlKGEuX19kYXRhX18sIGIuX19kYXRhX18pIDogIWEgLSAhYjtcbiAgfVxuXG4gIGZvciAodmFyIGdyb3VwcyA9IHRoaXMuX2dyb3VwcywgbSA9IGdyb3Vwcy5sZW5ndGgsIHNvcnRncm91cHMgPSBuZXcgQXJyYXkobSksIGogPSAwOyBqIDwgbTsgKytqKSB7XG4gICAgZm9yICh2YXIgZ3JvdXAgPSBncm91cHNbal0sIG4gPSBncm91cC5sZW5ndGgsIHNvcnRncm91cCA9IHNvcnRncm91cHNbal0gPSBuZXcgQXJyYXkobiksIG5vZGUsIGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAobm9kZSA9IGdyb3VwW2ldKSB7XG4gICAgICAgIHNvcnRncm91cFtpXSA9IG5vZGU7XG4gICAgICB9XG4gICAgfVxuICAgIHNvcnRncm91cC5zb3J0KGNvbXBhcmVOb2RlKTtcbiAgfVxuXG4gIHJldHVybiBuZXcgU2VsZWN0aW9uKHNvcnRncm91cHMsIHRoaXMuX3BhcmVudHMpLm9yZGVyKCk7XG59XG5cbmZ1bmN0aW9uIGFzY2VuZGluZyhhLCBiKSB7XG4gIHJldHVybiBhIDwgYiA/IC0xIDogYSA+IGIgPyAxIDogYSA+PSBiID8gMCA6IE5hTjtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgdmFyIGNhbGxiYWNrID0gYXJndW1lbnRzWzBdO1xuICBhcmd1bWVudHNbMF0gPSB0aGlzO1xuICBjYWxsYmFjay5hcHBseShudWxsLCBhcmd1bWVudHMpO1xuICByZXR1cm4gdGhpcztcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIEFycmF5LmZyb20odGhpcyk7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG5cbiAgZm9yICh2YXIgZ3JvdXBzID0gdGhpcy5fZ3JvdXBzLCBqID0gMCwgbSA9IGdyb3Vwcy5sZW5ndGg7IGogPCBtOyArK2opIHtcbiAgICBmb3IgKHZhciBncm91cCA9IGdyb3Vwc1tqXSwgaSA9IDAsIG4gPSBncm91cC5sZW5ndGg7IGkgPCBuOyArK2kpIHtcbiAgICAgIHZhciBub2RlID0gZ3JvdXBbaV07XG4gICAgICBpZiAobm9kZSkgcmV0dXJuIG5vZGU7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG51bGw7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIGxldCBzaXplID0gMDtcbiAgZm9yIChjb25zdCBub2RlIG9mIHRoaXMpICsrc2l6ZTsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICByZXR1cm4gc2l6ZTtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgcmV0dXJuICF0aGlzLm5vZGUoKTtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbihjYWxsYmFjaykge1xuXG4gIGZvciAodmFyIGdyb3VwcyA9IHRoaXMuX2dyb3VwcywgaiA9IDAsIG0gPSBncm91cHMubGVuZ3RoOyBqIDwgbTsgKytqKSB7XG4gICAgZm9yICh2YXIgZ3JvdXAgPSBncm91cHNbal0sIGkgPSAwLCBuID0gZ3JvdXAubGVuZ3RoLCBub2RlOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAobm9kZSA9IGdyb3VwW2ldKSBjYWxsYmFjay5jYWxsKG5vZGUsIG5vZGUuX19kYXRhX18sIGksIGdyb3VwKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn1cbiIsICJpbXBvcnQgbmFtZXNwYWNlIGZyb20gXCIuLi9uYW1lc3BhY2UuanNcIjtcblxuZnVuY3Rpb24gYXR0clJlbW92ZShuYW1lKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnJlbW92ZUF0dHJpYnV0ZShuYW1lKTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gYXR0clJlbW92ZU5TKGZ1bGxuYW1lKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnJlbW92ZUF0dHJpYnV0ZU5TKGZ1bGxuYW1lLnNwYWNlLCBmdWxsbmFtZS5sb2NhbCk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGF0dHJDb25zdGFudChuYW1lLCB2YWx1ZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5zZXRBdHRyaWJ1dGUobmFtZSwgdmFsdWUpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBhdHRyQ29uc3RhbnROUyhmdWxsbmFtZSwgdmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuc2V0QXR0cmlidXRlTlMoZnVsbG5hbWUuc3BhY2UsIGZ1bGxuYW1lLmxvY2FsLCB2YWx1ZSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGF0dHJGdW5jdGlvbihuYW1lLCB2YWx1ZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHYgPSB2YWx1ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIGlmICh2ID09IG51bGwpIHRoaXMucmVtb3ZlQXR0cmlidXRlKG5hbWUpO1xuICAgIGVsc2UgdGhpcy5zZXRBdHRyaWJ1dGUobmFtZSwgdik7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGF0dHJGdW5jdGlvbk5TKGZ1bGxuYW1lLCB2YWx1ZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHYgPSB2YWx1ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIGlmICh2ID09IG51bGwpIHRoaXMucmVtb3ZlQXR0cmlidXRlTlMoZnVsbG5hbWUuc3BhY2UsIGZ1bGxuYW1lLmxvY2FsKTtcbiAgICBlbHNlIHRoaXMuc2V0QXR0cmlidXRlTlMoZnVsbG5hbWUuc3BhY2UsIGZ1bGxuYW1lLmxvY2FsLCB2KTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSwgdmFsdWUpIHtcbiAgdmFyIGZ1bGxuYW1lID0gbmFtZXNwYWNlKG5hbWUpO1xuXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoIDwgMikge1xuICAgIHZhciBub2RlID0gdGhpcy5ub2RlKCk7XG4gICAgcmV0dXJuIGZ1bGxuYW1lLmxvY2FsXG4gICAgICAgID8gbm9kZS5nZXRBdHRyaWJ1dGVOUyhmdWxsbmFtZS5zcGFjZSwgZnVsbG5hbWUubG9jYWwpXG4gICAgICAgIDogbm9kZS5nZXRBdHRyaWJ1dGUoZnVsbG5hbWUpO1xuICB9XG5cbiAgcmV0dXJuIHRoaXMuZWFjaCgodmFsdWUgPT0gbnVsbFxuICAgICAgPyAoZnVsbG5hbWUubG9jYWwgPyBhdHRyUmVtb3ZlTlMgOiBhdHRyUmVtb3ZlKSA6ICh0eXBlb2YgdmFsdWUgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgPyAoZnVsbG5hbWUubG9jYWwgPyBhdHRyRnVuY3Rpb25OUyA6IGF0dHJGdW5jdGlvbilcbiAgICAgIDogKGZ1bGxuYW1lLmxvY2FsID8gYXR0ckNvbnN0YW50TlMgOiBhdHRyQ29uc3RhbnQpKSkoZnVsbG5hbWUsIHZhbHVlKSk7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obm9kZSkge1xuICByZXR1cm4gKG5vZGUub3duZXJEb2N1bWVudCAmJiBub2RlLm93bmVyRG9jdW1lbnQuZGVmYXVsdFZpZXcpIC8vIG5vZGUgaXMgYSBOb2RlXG4gICAgICB8fCAobm9kZS5kb2N1bWVudCAmJiBub2RlKSAvLyBub2RlIGlzIGEgV2luZG93XG4gICAgICB8fCBub2RlLmRlZmF1bHRWaWV3OyAvLyBub2RlIGlzIGEgRG9jdW1lbnRcbn1cbiIsICJpbXBvcnQgZGVmYXVsdFZpZXcgZnJvbSBcIi4uL3dpbmRvdy5qc1wiO1xuXG5mdW5jdGlvbiBzdHlsZVJlbW92ZShuYW1lKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnN0eWxlLnJlbW92ZVByb3BlcnR5KG5hbWUpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBzdHlsZUNvbnN0YW50KG5hbWUsIHZhbHVlLCBwcmlvcml0eSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5zdHlsZS5zZXRQcm9wZXJ0eShuYW1lLCB2YWx1ZSwgcHJpb3JpdHkpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBzdHlsZUZ1bmN0aW9uKG5hbWUsIHZhbHVlLCBwcmlvcml0eSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHYgPSB2YWx1ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIGlmICh2ID09IG51bGwpIHRoaXMuc3R5bGUucmVtb3ZlUHJvcGVydHkobmFtZSk7XG4gICAgZWxzZSB0aGlzLnN0eWxlLnNldFByb3BlcnR5KG5hbWUsIHYsIHByaW9yaXR5KTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSwgdmFsdWUsIHByaW9yaXR5KSB7XG4gIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID4gMVxuICAgICAgPyB0aGlzLmVhY2goKHZhbHVlID09IG51bGxcbiAgICAgICAgICAgID8gc3R5bGVSZW1vdmUgOiB0eXBlb2YgdmFsdWUgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgICAgICAgPyBzdHlsZUZ1bmN0aW9uXG4gICAgICAgICAgICA6IHN0eWxlQ29uc3RhbnQpKG5hbWUsIHZhbHVlLCBwcmlvcml0eSA9PSBudWxsID8gXCJcIiA6IHByaW9yaXR5KSlcbiAgICAgIDogc3R5bGVWYWx1ZSh0aGlzLm5vZGUoKSwgbmFtZSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzdHlsZVZhbHVlKG5vZGUsIG5hbWUpIHtcbiAgcmV0dXJuIG5vZGUuc3R5bGUuZ2V0UHJvcGVydHlWYWx1ZShuYW1lKVxuICAgICAgfHwgZGVmYXVsdFZpZXcobm9kZSkuZ2V0Q29tcHV0ZWRTdHlsZShub2RlLCBudWxsKS5nZXRQcm9wZXJ0eVZhbHVlKG5hbWUpO1xufVxuIiwgImZ1bmN0aW9uIHByb3BlcnR5UmVtb3ZlKG5hbWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIGRlbGV0ZSB0aGlzW25hbWVdO1xuICB9O1xufVxuXG5mdW5jdGlvbiBwcm9wZXJ0eUNvbnN0YW50KG5hbWUsIHZhbHVlKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB0aGlzW25hbWVdID0gdmFsdWU7XG4gIH07XG59XG5cbmZ1bmN0aW9uIHByb3BlcnR5RnVuY3Rpb24obmFtZSwgdmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciB2ID0gdmFsdWUuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICBpZiAodiA9PSBudWxsKSBkZWxldGUgdGhpc1tuYW1lXTtcbiAgICBlbHNlIHRoaXNbbmFtZV0gPSB2O1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihuYW1lLCB2YWx1ZSkge1xuICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA+IDFcbiAgICAgID8gdGhpcy5lYWNoKCh2YWx1ZSA9PSBudWxsXG4gICAgICAgICAgPyBwcm9wZXJ0eVJlbW92ZSA6IHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgICAgICAgPyBwcm9wZXJ0eUZ1bmN0aW9uXG4gICAgICAgICAgOiBwcm9wZXJ0eUNvbnN0YW50KShuYW1lLCB2YWx1ZSkpXG4gICAgICA6IHRoaXMubm9kZSgpW25hbWVdO1xufVxuIiwgImZ1bmN0aW9uIGNsYXNzQXJyYXkoc3RyaW5nKSB7XG4gIHJldHVybiBzdHJpbmcudHJpbSgpLnNwbGl0KC9efFxccysvKTtcbn1cblxuZnVuY3Rpb24gY2xhc3NMaXN0KG5vZGUpIHtcbiAgcmV0dXJuIG5vZGUuY2xhc3NMaXN0IHx8IG5ldyBDbGFzc0xpc3Qobm9kZSk7XG59XG5cbmZ1bmN0aW9uIENsYXNzTGlzdChub2RlKSB7XG4gIHRoaXMuX25vZGUgPSBub2RlO1xuICB0aGlzLl9uYW1lcyA9IGNsYXNzQXJyYXkobm9kZS5nZXRBdHRyaWJ1dGUoXCJjbGFzc1wiKSB8fCBcIlwiKTtcbn1cblxuQ2xhc3NMaXN0LnByb3RvdHlwZSA9IHtcbiAgYWRkOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgdmFyIGkgPSB0aGlzLl9uYW1lcy5pbmRleE9mKG5hbWUpO1xuICAgIGlmIChpIDwgMCkge1xuICAgICAgdGhpcy5fbmFtZXMucHVzaChuYW1lKTtcbiAgICAgIHRoaXMuX25vZGUuc2V0QXR0cmlidXRlKFwiY2xhc3NcIiwgdGhpcy5fbmFtZXMuam9pbihcIiBcIikpO1xuICAgIH1cbiAgfSxcbiAgcmVtb3ZlOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgdmFyIGkgPSB0aGlzLl9uYW1lcy5pbmRleE9mKG5hbWUpO1xuICAgIGlmIChpID49IDApIHtcbiAgICAgIHRoaXMuX25hbWVzLnNwbGljZShpLCAxKTtcbiAgICAgIHRoaXMuX25vZGUuc2V0QXR0cmlidXRlKFwiY2xhc3NcIiwgdGhpcy5fbmFtZXMuam9pbihcIiBcIikpO1xuICAgIH1cbiAgfSxcbiAgY29udGFpbnM6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5fbmFtZXMuaW5kZXhPZihuYW1lKSA+PSAwO1xuICB9XG59O1xuXG5mdW5jdGlvbiBjbGFzc2VkQWRkKG5vZGUsIG5hbWVzKSB7XG4gIHZhciBsaXN0ID0gY2xhc3NMaXN0KG5vZGUpLCBpID0gLTEsIG4gPSBuYW1lcy5sZW5ndGg7XG4gIHdoaWxlICgrK2kgPCBuKSBsaXN0LmFkZChuYW1lc1tpXSk7XG59XG5cbmZ1bmN0aW9uIGNsYXNzZWRSZW1vdmUobm9kZSwgbmFtZXMpIHtcbiAgdmFyIGxpc3QgPSBjbGFzc0xpc3Qobm9kZSksIGkgPSAtMSwgbiA9IG5hbWVzLmxlbmd0aDtcbiAgd2hpbGUgKCsraSA8IG4pIGxpc3QucmVtb3ZlKG5hbWVzW2ldKTtcbn1cblxuZnVuY3Rpb24gY2xhc3NlZFRydWUobmFtZXMpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIGNsYXNzZWRBZGQodGhpcywgbmFtZXMpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBjbGFzc2VkRmFsc2UobmFtZXMpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIGNsYXNzZWRSZW1vdmUodGhpcywgbmFtZXMpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBjbGFzc2VkRnVuY3Rpb24obmFtZXMsIHZhbHVlKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAodmFsdWUuYXBwbHkodGhpcywgYXJndW1lbnRzKSA/IGNsYXNzZWRBZGQgOiBjbGFzc2VkUmVtb3ZlKSh0aGlzLCBuYW1lcyk7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG5hbWUsIHZhbHVlKSB7XG4gIHZhciBuYW1lcyA9IGNsYXNzQXJyYXkobmFtZSArIFwiXCIpO1xuXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoIDwgMikge1xuICAgIHZhciBsaXN0ID0gY2xhc3NMaXN0KHRoaXMubm9kZSgpKSwgaSA9IC0xLCBuID0gbmFtZXMubGVuZ3RoO1xuICAgIHdoaWxlICgrK2kgPCBuKSBpZiAoIWxpc3QuY29udGFpbnMobmFtZXNbaV0pKSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICByZXR1cm4gdGhpcy5lYWNoKCh0eXBlb2YgdmFsdWUgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgPyBjbGFzc2VkRnVuY3Rpb24gOiB2YWx1ZVxuICAgICAgPyBjbGFzc2VkVHJ1ZVxuICAgICAgOiBjbGFzc2VkRmFsc2UpKG5hbWVzLCB2YWx1ZSkpO1xufVxuIiwgImZ1bmN0aW9uIHRleHRSZW1vdmUoKSB7XG4gIHRoaXMudGV4dENvbnRlbnQgPSBcIlwiO1xufVxuXG5mdW5jdGlvbiB0ZXh0Q29uc3RhbnQodmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHRoaXMudGV4dENvbnRlbnQgPSB2YWx1ZTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gdGV4dEZ1bmN0aW9uKHZhbHVlKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgdiA9IHZhbHVlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgdGhpcy50ZXh0Q29udGVudCA9IHYgPT0gbnVsbCA/IFwiXCIgOiB2O1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih2YWx1ZSkge1xuICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aFxuICAgICAgPyB0aGlzLmVhY2godmFsdWUgPT0gbnVsbFxuICAgICAgICAgID8gdGV4dFJlbW92ZSA6ICh0eXBlb2YgdmFsdWUgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgICAgID8gdGV4dEZ1bmN0aW9uXG4gICAgICAgICAgOiB0ZXh0Q29uc3RhbnQpKHZhbHVlKSlcbiAgICAgIDogdGhpcy5ub2RlKCkudGV4dENvbnRlbnQ7XG59XG4iLCAiZnVuY3Rpb24gaHRtbFJlbW92ZSgpIHtcbiAgdGhpcy5pbm5lckhUTUwgPSBcIlwiO1xufVxuXG5mdW5jdGlvbiBodG1sQ29uc3RhbnQodmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuaW5uZXJIVE1MID0gdmFsdWU7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGh0bWxGdW5jdGlvbih2YWx1ZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHYgPSB2YWx1ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIHRoaXMuaW5uZXJIVE1MID0gdiA9PSBudWxsID8gXCJcIiA6IHY7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHZhbHVlKSB7XG4gIHJldHVybiBhcmd1bWVudHMubGVuZ3RoXG4gICAgICA/IHRoaXMuZWFjaCh2YWx1ZSA9PSBudWxsXG4gICAgICAgICAgPyBodG1sUmVtb3ZlIDogKHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgICAgICAgPyBodG1sRnVuY3Rpb25cbiAgICAgICAgICA6IGh0bWxDb25zdGFudCkodmFsdWUpKVxuICAgICAgOiB0aGlzLm5vZGUoKS5pbm5lckhUTUw7XG59XG4iLCAiZnVuY3Rpb24gcmFpc2UoKSB7XG4gIGlmICh0aGlzLm5leHRTaWJsaW5nKSB0aGlzLnBhcmVudE5vZGUuYXBwZW5kQ2hpbGQodGhpcyk7XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5lYWNoKHJhaXNlKTtcbn1cbiIsICJmdW5jdGlvbiBsb3dlcigpIHtcbiAgaWYgKHRoaXMucHJldmlvdXNTaWJsaW5nKSB0aGlzLnBhcmVudE5vZGUuaW5zZXJ0QmVmb3JlKHRoaXMsIHRoaXMucGFyZW50Tm9kZS5maXJzdENoaWxkKTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLmVhY2gobG93ZXIpO1xufVxuIiwgImltcG9ydCBjcmVhdG9yIGZyb20gXCIuLi9jcmVhdG9yLmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG5hbWUpIHtcbiAgdmFyIGNyZWF0ZSA9IHR5cGVvZiBuYW1lID09PSBcImZ1bmN0aW9uXCIgPyBuYW1lIDogY3JlYXRvcihuYW1lKTtcbiAgcmV0dXJuIHRoaXMuc2VsZWN0KGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLmFwcGVuZENoaWxkKGNyZWF0ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpKTtcbiAgfSk7XG59XG4iLCAiaW1wb3J0IGNyZWF0b3IgZnJvbSBcIi4uL2NyZWF0b3IuanNcIjtcbmltcG9ydCBzZWxlY3RvciBmcm9tIFwiLi4vc2VsZWN0b3IuanNcIjtcblxuZnVuY3Rpb24gY29uc3RhbnROdWxsKCkge1xuICByZXR1cm4gbnVsbDtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSwgYmVmb3JlKSB7XG4gIHZhciBjcmVhdGUgPSB0eXBlb2YgbmFtZSA9PT0gXCJmdW5jdGlvblwiID8gbmFtZSA6IGNyZWF0b3IobmFtZSksXG4gICAgICBzZWxlY3QgPSBiZWZvcmUgPT0gbnVsbCA/IGNvbnN0YW50TnVsbCA6IHR5cGVvZiBiZWZvcmUgPT09IFwiZnVuY3Rpb25cIiA/IGJlZm9yZSA6IHNlbGVjdG9yKGJlZm9yZSk7XG4gIHJldHVybiB0aGlzLnNlbGVjdChmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5pbnNlcnRCZWZvcmUoY3JlYXRlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyksIHNlbGVjdC5hcHBseSh0aGlzLCBhcmd1bWVudHMpIHx8IG51bGwpO1xuICB9KTtcbn1cbiIsICJmdW5jdGlvbiByZW1vdmUoKSB7XG4gIHZhciBwYXJlbnQgPSB0aGlzLnBhcmVudE5vZGU7XG4gIGlmIChwYXJlbnQpIHBhcmVudC5yZW1vdmVDaGlsZCh0aGlzKTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLmVhY2gocmVtb3ZlKTtcbn1cbiIsICJmdW5jdGlvbiBzZWxlY3Rpb25fY2xvbmVTaGFsbG93KCkge1xuICB2YXIgY2xvbmUgPSB0aGlzLmNsb25lTm9kZShmYWxzZSksIHBhcmVudCA9IHRoaXMucGFyZW50Tm9kZTtcbiAgcmV0dXJuIHBhcmVudCA/IHBhcmVudC5pbnNlcnRCZWZvcmUoY2xvbmUsIHRoaXMubmV4dFNpYmxpbmcpIDogY2xvbmU7XG59XG5cbmZ1bmN0aW9uIHNlbGVjdGlvbl9jbG9uZURlZXAoKSB7XG4gIHZhciBjbG9uZSA9IHRoaXMuY2xvbmVOb2RlKHRydWUpLCBwYXJlbnQgPSB0aGlzLnBhcmVudE5vZGU7XG4gIHJldHVybiBwYXJlbnQgPyBwYXJlbnQuaW5zZXJ0QmVmb3JlKGNsb25lLCB0aGlzLm5leHRTaWJsaW5nKSA6IGNsb25lO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihkZWVwKSB7XG4gIHJldHVybiB0aGlzLnNlbGVjdChkZWVwID8gc2VsZWN0aW9uX2Nsb25lRGVlcCA6IHNlbGVjdGlvbl9jbG9uZVNoYWxsb3cpO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHZhbHVlKSB7XG4gIHJldHVybiBhcmd1bWVudHMubGVuZ3RoXG4gICAgICA/IHRoaXMucHJvcGVydHkoXCJfX2RhdGFfX1wiLCB2YWx1ZSlcbiAgICAgIDogdGhpcy5ub2RlKCkuX19kYXRhX187XG59XG4iLCAiZnVuY3Rpb24gY29udGV4dExpc3RlbmVyKGxpc3RlbmVyKSB7XG4gIHJldHVybiBmdW5jdGlvbihldmVudCkge1xuICAgIGxpc3RlbmVyLmNhbGwodGhpcywgZXZlbnQsIHRoaXMuX19kYXRhX18pO1xuICB9O1xufVxuXG5mdW5jdGlvbiBwYXJzZVR5cGVuYW1lcyh0eXBlbmFtZXMpIHtcbiAgcmV0dXJuIHR5cGVuYW1lcy50cmltKCkuc3BsaXQoL158XFxzKy8pLm1hcChmdW5jdGlvbih0KSB7XG4gICAgdmFyIG5hbWUgPSBcIlwiLCBpID0gdC5pbmRleE9mKFwiLlwiKTtcbiAgICBpZiAoaSA+PSAwKSBuYW1lID0gdC5zbGljZShpICsgMSksIHQgPSB0LnNsaWNlKDAsIGkpO1xuICAgIHJldHVybiB7dHlwZTogdCwgbmFtZTogbmFtZX07XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBvblJlbW92ZSh0eXBlbmFtZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIG9uID0gdGhpcy5fX29uO1xuICAgIGlmICghb24pIHJldHVybjtcbiAgICBmb3IgKHZhciBqID0gMCwgaSA9IC0xLCBtID0gb24ubGVuZ3RoLCBvOyBqIDwgbTsgKytqKSB7XG4gICAgICBpZiAobyA9IG9uW2pdLCAoIXR5cGVuYW1lLnR5cGUgfHwgby50eXBlID09PSB0eXBlbmFtZS50eXBlKSAmJiBvLm5hbWUgPT09IHR5cGVuYW1lLm5hbWUpIHtcbiAgICAgICAgdGhpcy5yZW1vdmVFdmVudExpc3RlbmVyKG8udHlwZSwgby5saXN0ZW5lciwgby5vcHRpb25zKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG9uWysraV0gPSBvO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoKytpKSBvbi5sZW5ndGggPSBpO1xuICAgIGVsc2UgZGVsZXRlIHRoaXMuX19vbjtcbiAgfTtcbn1cblxuZnVuY3Rpb24gb25BZGQodHlwZW5hbWUsIHZhbHVlLCBvcHRpb25zKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgb24gPSB0aGlzLl9fb24sIG8sIGxpc3RlbmVyID0gY29udGV4dExpc3RlbmVyKHZhbHVlKTtcbiAgICBpZiAob24pIGZvciAodmFyIGogPSAwLCBtID0gb24ubGVuZ3RoOyBqIDwgbTsgKytqKSB7XG4gICAgICBpZiAoKG8gPSBvbltqXSkudHlwZSA9PT0gdHlwZW5hbWUudHlwZSAmJiBvLm5hbWUgPT09IHR5cGVuYW1lLm5hbWUpIHtcbiAgICAgICAgdGhpcy5yZW1vdmVFdmVudExpc3RlbmVyKG8udHlwZSwgby5saXN0ZW5lciwgby5vcHRpb25zKTtcbiAgICAgICAgdGhpcy5hZGRFdmVudExpc3RlbmVyKG8udHlwZSwgby5saXN0ZW5lciA9IGxpc3RlbmVyLCBvLm9wdGlvbnMgPSBvcHRpb25zKTtcbiAgICAgICAgby52YWx1ZSA9IHZhbHVlO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfVxuICAgIHRoaXMuYWRkRXZlbnRMaXN0ZW5lcih0eXBlbmFtZS50eXBlLCBsaXN0ZW5lciwgb3B0aW9ucyk7XG4gICAgbyA9IHt0eXBlOiB0eXBlbmFtZS50eXBlLCBuYW1lOiB0eXBlbmFtZS5uYW1lLCB2YWx1ZTogdmFsdWUsIGxpc3RlbmVyOiBsaXN0ZW5lciwgb3B0aW9uczogb3B0aW9uc307XG4gICAgaWYgKCFvbikgdGhpcy5fX29uID0gW29dO1xuICAgIGVsc2Ugb24ucHVzaChvKTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24odHlwZW5hbWUsIHZhbHVlLCBvcHRpb25zKSB7XG4gIHZhciB0eXBlbmFtZXMgPSBwYXJzZVR5cGVuYW1lcyh0eXBlbmFtZSArIFwiXCIpLCBpLCBuID0gdHlwZW5hbWVzLmxlbmd0aCwgdDtcblxuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA8IDIpIHtcbiAgICB2YXIgb24gPSB0aGlzLm5vZGUoKS5fX29uO1xuICAgIGlmIChvbikgZm9yICh2YXIgaiA9IDAsIG0gPSBvbi5sZW5ndGgsIG87IGogPCBtOyArK2opIHtcbiAgICAgIGZvciAoaSA9IDAsIG8gPSBvbltqXTsgaSA8IG47ICsraSkge1xuICAgICAgICBpZiAoKHQgPSB0eXBlbmFtZXNbaV0pLnR5cGUgPT09IG8udHlwZSAmJiB0Lm5hbWUgPT09IG8ubmFtZSkge1xuICAgICAgICAgIHJldHVybiBvLnZhbHVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybjtcbiAgfVxuXG4gIG9uID0gdmFsdWUgPyBvbkFkZCA6IG9uUmVtb3ZlO1xuICBmb3IgKGkgPSAwOyBpIDwgbjsgKytpKSB0aGlzLmVhY2gob24odHlwZW5hbWVzW2ldLCB2YWx1ZSwgb3B0aW9ucykpO1xuICByZXR1cm4gdGhpcztcbn1cbiIsICJpbXBvcnQgZGVmYXVsdFZpZXcgZnJvbSBcIi4uL3dpbmRvdy5qc1wiO1xuXG5mdW5jdGlvbiBkaXNwYXRjaEV2ZW50KG5vZGUsIHR5cGUsIHBhcmFtcykge1xuICB2YXIgd2luZG93ID0gZGVmYXVsdFZpZXcobm9kZSksXG4gICAgICBldmVudCA9IHdpbmRvdy5DdXN0b21FdmVudDtcblxuICBpZiAodHlwZW9mIGV2ZW50ID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICBldmVudCA9IG5ldyBldmVudCh0eXBlLCBwYXJhbXMpO1xuICB9IGVsc2Uge1xuICAgIGV2ZW50ID0gd2luZG93LmRvY3VtZW50LmNyZWF0ZUV2ZW50KFwiRXZlbnRcIik7XG4gICAgaWYgKHBhcmFtcykgZXZlbnQuaW5pdEV2ZW50KHR5cGUsIHBhcmFtcy5idWJibGVzLCBwYXJhbXMuY2FuY2VsYWJsZSksIGV2ZW50LmRldGFpbCA9IHBhcmFtcy5kZXRhaWw7XG4gICAgZWxzZSBldmVudC5pbml0RXZlbnQodHlwZSwgZmFsc2UsIGZhbHNlKTtcbiAgfVxuXG4gIG5vZGUuZGlzcGF0Y2hFdmVudChldmVudCk7XG59XG5cbmZ1bmN0aW9uIGRpc3BhdGNoQ29uc3RhbnQodHlwZSwgcGFyYW1zKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gZGlzcGF0Y2hFdmVudCh0aGlzLCB0eXBlLCBwYXJhbXMpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBkaXNwYXRjaEZ1bmN0aW9uKHR5cGUsIHBhcmFtcykge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGRpc3BhdGNoRXZlbnQodGhpcywgdHlwZSwgcGFyYW1zLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykpO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih0eXBlLCBwYXJhbXMpIHtcbiAgcmV0dXJuIHRoaXMuZWFjaCgodHlwZW9mIHBhcmFtcyA9PT0gXCJmdW5jdGlvblwiXG4gICAgICA/IGRpc3BhdGNoRnVuY3Rpb25cbiAgICAgIDogZGlzcGF0Y2hDb25zdGFudCkodHlwZSwgcGFyYW1zKSk7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24qKCkge1xuICBmb3IgKHZhciBncm91cHMgPSB0aGlzLl9ncm91cHMsIGogPSAwLCBtID0gZ3JvdXBzLmxlbmd0aDsgaiA8IG07ICsraikge1xuICAgIGZvciAodmFyIGdyb3VwID0gZ3JvdXBzW2pdLCBpID0gMCwgbiA9IGdyb3VwLmxlbmd0aCwgbm9kZTsgaSA8IG47ICsraSkge1xuICAgICAgaWYgKG5vZGUgPSBncm91cFtpXSkgeWllbGQgbm9kZTtcbiAgICB9XG4gIH1cbn1cbiIsICJpbXBvcnQgc2VsZWN0aW9uX3NlbGVjdCBmcm9tIFwiLi9zZWxlY3QuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fc2VsZWN0QWxsIGZyb20gXCIuL3NlbGVjdEFsbC5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9zZWxlY3RDaGlsZCBmcm9tIFwiLi9zZWxlY3RDaGlsZC5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9zZWxlY3RDaGlsZHJlbiBmcm9tIFwiLi9zZWxlY3RDaGlsZHJlbi5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9maWx0ZXIgZnJvbSBcIi4vZmlsdGVyLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2RhdGEgZnJvbSBcIi4vZGF0YS5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9lbnRlciBmcm9tIFwiLi9lbnRlci5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9leGl0IGZyb20gXCIuL2V4aXQuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fam9pbiBmcm9tIFwiLi9qb2luLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX21lcmdlIGZyb20gXCIuL21lcmdlLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX29yZGVyIGZyb20gXCIuL29yZGVyLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX3NvcnQgZnJvbSBcIi4vc29ydC5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9jYWxsIGZyb20gXCIuL2NhbGwuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fbm9kZXMgZnJvbSBcIi4vbm9kZXMuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fbm9kZSBmcm9tIFwiLi9ub2RlLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX3NpemUgZnJvbSBcIi4vc2l6ZS5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9lbXB0eSBmcm9tIFwiLi9lbXB0eS5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9lYWNoIGZyb20gXCIuL2VhY2guanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fYXR0ciBmcm9tIFwiLi9hdHRyLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX3N0eWxlIGZyb20gXCIuL3N0eWxlLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX3Byb3BlcnR5IGZyb20gXCIuL3Byb3BlcnR5LmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2NsYXNzZWQgZnJvbSBcIi4vY2xhc3NlZC5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl90ZXh0IGZyb20gXCIuL3RleHQuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25faHRtbCBmcm9tIFwiLi9odG1sLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX3JhaXNlIGZyb20gXCIuL3JhaXNlLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2xvd2VyIGZyb20gXCIuL2xvd2VyLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2FwcGVuZCBmcm9tIFwiLi9hcHBlbmQuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25faW5zZXJ0IGZyb20gXCIuL2luc2VydC5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9yZW1vdmUgZnJvbSBcIi4vcmVtb3ZlLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2Nsb25lIGZyb20gXCIuL2Nsb25lLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2RhdHVtIGZyb20gXCIuL2RhdHVtLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX29uIGZyb20gXCIuL29uLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2Rpc3BhdGNoIGZyb20gXCIuL2Rpc3BhdGNoLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2l0ZXJhdG9yIGZyb20gXCIuL2l0ZXJhdG9yLmpzXCI7XG5cbmV4cG9ydCB2YXIgcm9vdCA9IFtudWxsXTtcblxuZXhwb3J0IGZ1bmN0aW9uIFNlbGVjdGlvbihncm91cHMsIHBhcmVudHMpIHtcbiAgdGhpcy5fZ3JvdXBzID0gZ3JvdXBzO1xuICB0aGlzLl9wYXJlbnRzID0gcGFyZW50cztcbn1cblxuZnVuY3Rpb24gc2VsZWN0aW9uKCkge1xuICByZXR1cm4gbmV3IFNlbGVjdGlvbihbW2RvY3VtZW50LmRvY3VtZW50RWxlbWVudF1dLCByb290KTtcbn1cblxuZnVuY3Rpb24gc2VsZWN0aW9uX3NlbGVjdGlvbigpIHtcbiAgcmV0dXJuIHRoaXM7XG59XG5cblNlbGVjdGlvbi5wcm90b3R5cGUgPSBzZWxlY3Rpb24ucHJvdG90eXBlID0ge1xuICBjb25zdHJ1Y3RvcjogU2VsZWN0aW9uLFxuICBzZWxlY3Q6IHNlbGVjdGlvbl9zZWxlY3QsXG4gIHNlbGVjdEFsbDogc2VsZWN0aW9uX3NlbGVjdEFsbCxcbiAgc2VsZWN0Q2hpbGQ6IHNlbGVjdGlvbl9zZWxlY3RDaGlsZCxcbiAgc2VsZWN0Q2hpbGRyZW46IHNlbGVjdGlvbl9zZWxlY3RDaGlsZHJlbixcbiAgZmlsdGVyOiBzZWxlY3Rpb25fZmlsdGVyLFxuICBkYXRhOiBzZWxlY3Rpb25fZGF0YSxcbiAgZW50ZXI6IHNlbGVjdGlvbl9lbnRlcixcbiAgZXhpdDogc2VsZWN0aW9uX2V4aXQsXG4gIGpvaW46IHNlbGVjdGlvbl9qb2luLFxuICBtZXJnZTogc2VsZWN0aW9uX21lcmdlLFxuICBzZWxlY3Rpb246IHNlbGVjdGlvbl9zZWxlY3Rpb24sXG4gIG9yZGVyOiBzZWxlY3Rpb25fb3JkZXIsXG4gIHNvcnQ6IHNlbGVjdGlvbl9zb3J0LFxuICBjYWxsOiBzZWxlY3Rpb25fY2FsbCxcbiAgbm9kZXM6IHNlbGVjdGlvbl9ub2RlcyxcbiAgbm9kZTogc2VsZWN0aW9uX25vZGUsXG4gIHNpemU6IHNlbGVjdGlvbl9zaXplLFxuICBlbXB0eTogc2VsZWN0aW9uX2VtcHR5LFxuICBlYWNoOiBzZWxlY3Rpb25fZWFjaCxcbiAgYXR0cjogc2VsZWN0aW9uX2F0dHIsXG4gIHN0eWxlOiBzZWxlY3Rpb25fc3R5bGUsXG4gIHByb3BlcnR5OiBzZWxlY3Rpb25fcHJvcGVydHksXG4gIGNsYXNzZWQ6IHNlbGVjdGlvbl9jbGFzc2VkLFxuICB0ZXh0OiBzZWxlY3Rpb25fdGV4dCxcbiAgaHRtbDogc2VsZWN0aW9uX2h0bWwsXG4gIHJhaXNlOiBzZWxlY3Rpb25fcmFpc2UsXG4gIGxvd2VyOiBzZWxlY3Rpb25fbG93ZXIsXG4gIGFwcGVuZDogc2VsZWN0aW9uX2FwcGVuZCxcbiAgaW5zZXJ0OiBzZWxlY3Rpb25faW5zZXJ0LFxuICByZW1vdmU6IHNlbGVjdGlvbl9yZW1vdmUsXG4gIGNsb25lOiBzZWxlY3Rpb25fY2xvbmUsXG4gIGRhdHVtOiBzZWxlY3Rpb25fZGF0dW0sXG4gIG9uOiBzZWxlY3Rpb25fb24sXG4gIGRpc3BhdGNoOiBzZWxlY3Rpb25fZGlzcGF0Y2gsXG4gIFtTeW1ib2wuaXRlcmF0b3JdOiBzZWxlY3Rpb25faXRlcmF0b3Jcbn07XG5cbmV4cG9ydCBkZWZhdWx0IHNlbGVjdGlvbjtcbiIsICJpbXBvcnQge1NlbGVjdGlvbiwgcm9vdH0gZnJvbSBcIi4vc2VsZWN0aW9uL2luZGV4LmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHNlbGVjdG9yKSB7XG4gIHJldHVybiB0eXBlb2Ygc2VsZWN0b3IgPT09IFwic3RyaW5nXCJcbiAgICAgID8gbmV3IFNlbGVjdGlvbihbW2RvY3VtZW50LnF1ZXJ5U2VsZWN0b3Ioc2VsZWN0b3IpXV0sIFtkb2N1bWVudC5kb2N1bWVudEVsZW1lbnRdKVxuICAgICAgOiBuZXcgU2VsZWN0aW9uKFtbc2VsZWN0b3JdXSwgcm9vdCk7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oZXZlbnQpIHtcbiAgbGV0IHNvdXJjZUV2ZW50O1xuICB3aGlsZSAoc291cmNlRXZlbnQgPSBldmVudC5zb3VyY2VFdmVudCkgZXZlbnQgPSBzb3VyY2VFdmVudDtcbiAgcmV0dXJuIGV2ZW50O1xufVxuIiwgImltcG9ydCBzb3VyY2VFdmVudCBmcm9tIFwiLi9zb3VyY2VFdmVudC5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihldmVudCwgbm9kZSkge1xuICBldmVudCA9IHNvdXJjZUV2ZW50KGV2ZW50KTtcbiAgaWYgKG5vZGUgPT09IHVuZGVmaW5lZCkgbm9kZSA9IGV2ZW50LmN1cnJlbnRUYXJnZXQ7XG4gIGlmIChub2RlKSB7XG4gICAgdmFyIHN2ZyA9IG5vZGUub3duZXJTVkdFbGVtZW50IHx8IG5vZGU7XG4gICAgaWYgKHN2Zy5jcmVhdGVTVkdQb2ludCkge1xuICAgICAgdmFyIHBvaW50ID0gc3ZnLmNyZWF0ZVNWR1BvaW50KCk7XG4gICAgICBwb2ludC54ID0gZXZlbnQuY2xpZW50WCwgcG9pbnQueSA9IGV2ZW50LmNsaWVudFk7XG4gICAgICBwb2ludCA9IHBvaW50Lm1hdHJpeFRyYW5zZm9ybShub2RlLmdldFNjcmVlbkNUTSgpLmludmVyc2UoKSk7XG4gICAgICByZXR1cm4gW3BvaW50LngsIHBvaW50LnldO1xuICAgIH1cbiAgICBpZiAobm9kZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QpIHtcbiAgICAgIHZhciByZWN0ID0gbm9kZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgIHJldHVybiBbZXZlbnQuY2xpZW50WCAtIHJlY3QubGVmdCAtIG5vZGUuY2xpZW50TGVmdCwgZXZlbnQuY2xpZW50WSAtIHJlY3QudG9wIC0gbm9kZS5jbGllbnRUb3BdO1xuICAgIH1cbiAgfVxuICByZXR1cm4gW2V2ZW50LnBhZ2VYLCBldmVudC5wYWdlWV07XG59XG4iLCAiLy8gVGhlc2UgYXJlIHR5cGljYWxseSB1c2VkIGluIGNvbmp1bmN0aW9uIHdpdGggbm9ldmVudCB0byBlbnN1cmUgdGhhdCB3ZSBjYW5cbi8vIHByZXZlbnREZWZhdWx0IG9uIHRoZSBldmVudC5cbmV4cG9ydCBjb25zdCBub25wYXNzaXZlID0ge3Bhc3NpdmU6IGZhbHNlfTtcbmV4cG9ydCBjb25zdCBub25wYXNzaXZlY2FwdHVyZSA9IHtjYXB0dXJlOiB0cnVlLCBwYXNzaXZlOiBmYWxzZX07XG5cbmV4cG9ydCBmdW5jdGlvbiBub3Byb3BhZ2F0aW9uKGV2ZW50KSB7XG4gIGV2ZW50LnN0b3BJbW1lZGlhdGVQcm9wYWdhdGlvbigpO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihldmVudCkge1xuICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICBldmVudC5zdG9wSW1tZWRpYXRlUHJvcGFnYXRpb24oKTtcbn1cbiIsICJpbXBvcnQge3NlbGVjdH0gZnJvbSBcImQzLXNlbGVjdGlvblwiO1xuaW1wb3J0IG5vZXZlbnQsIHtub25wYXNzaXZlY2FwdHVyZX0gZnJvbSBcIi4vbm9ldmVudC5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih2aWV3KSB7XG4gIHZhciByb290ID0gdmlldy5kb2N1bWVudC5kb2N1bWVudEVsZW1lbnQsXG4gICAgICBzZWxlY3Rpb24gPSBzZWxlY3Qodmlldykub24oXCJkcmFnc3RhcnQuZHJhZ1wiLCBub2V2ZW50LCBub25wYXNzaXZlY2FwdHVyZSk7XG4gIGlmIChcIm9uc2VsZWN0c3RhcnRcIiBpbiByb290KSB7XG4gICAgc2VsZWN0aW9uLm9uKFwic2VsZWN0c3RhcnQuZHJhZ1wiLCBub2V2ZW50LCBub25wYXNzaXZlY2FwdHVyZSk7XG4gIH0gZWxzZSB7XG4gICAgcm9vdC5fX25vc2VsZWN0ID0gcm9vdC5zdHlsZS5Nb3pVc2VyU2VsZWN0O1xuICAgIHJvb3Quc3R5bGUuTW96VXNlclNlbGVjdCA9IFwibm9uZVwiO1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB5ZXNkcmFnKHZpZXcsIG5vY2xpY2spIHtcbiAgdmFyIHJvb3QgPSB2aWV3LmRvY3VtZW50LmRvY3VtZW50RWxlbWVudCxcbiAgICAgIHNlbGVjdGlvbiA9IHNlbGVjdCh2aWV3KS5vbihcImRyYWdzdGFydC5kcmFnXCIsIG51bGwpO1xuICBpZiAobm9jbGljaykge1xuICAgIHNlbGVjdGlvbi5vbihcImNsaWNrLmRyYWdcIiwgbm9ldmVudCwgbm9ucGFzc2l2ZWNhcHR1cmUpO1xuICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7IHNlbGVjdGlvbi5vbihcImNsaWNrLmRyYWdcIiwgbnVsbCk7IH0sIDApO1xuICB9XG4gIGlmIChcIm9uc2VsZWN0c3RhcnRcIiBpbiByb290KSB7XG4gICAgc2VsZWN0aW9uLm9uKFwic2VsZWN0c3RhcnQuZHJhZ1wiLCBudWxsKTtcbiAgfSBlbHNlIHtcbiAgICByb290LnN0eWxlLk1velVzZXJTZWxlY3QgPSByb290Ll9fbm9zZWxlY3Q7XG4gICAgZGVsZXRlIHJvb3QuX19ub3NlbGVjdDtcbiAgfVxufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGNvbnN0cnVjdG9yLCBmYWN0b3J5LCBwcm90b3R5cGUpIHtcbiAgY29uc3RydWN0b3IucHJvdG90eXBlID0gZmFjdG9yeS5wcm90b3R5cGUgPSBwcm90b3R5cGU7XG4gIHByb3RvdHlwZS5jb25zdHJ1Y3RvciA9IGNvbnN0cnVjdG9yO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZXh0ZW5kKHBhcmVudCwgZGVmaW5pdGlvbikge1xuICB2YXIgcHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShwYXJlbnQucHJvdG90eXBlKTtcbiAgZm9yICh2YXIga2V5IGluIGRlZmluaXRpb24pIHByb3RvdHlwZVtrZXldID0gZGVmaW5pdGlvbltrZXldO1xuICByZXR1cm4gcHJvdG90eXBlO1xufVxuIiwgImltcG9ydCBkZWZpbmUsIHtleHRlbmR9IGZyb20gXCIuL2RlZmluZS5qc1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gQ29sb3IoKSB7fVxuXG5leHBvcnQgdmFyIGRhcmtlciA9IDAuNztcbmV4cG9ydCB2YXIgYnJpZ2h0ZXIgPSAxIC8gZGFya2VyO1xuXG52YXIgcmVJID0gXCJcXFxccyooWystXT9cXFxcZCspXFxcXHMqXCIsXG4gICAgcmVOID0gXCJcXFxccyooWystXT8oPzpcXFxcZCpcXFxcLik/XFxcXGQrKD86W2VFXVsrLV0/XFxcXGQrKT8pXFxcXHMqXCIsXG4gICAgcmVQID0gXCJcXFxccyooWystXT8oPzpcXFxcZCpcXFxcLik/XFxcXGQrKD86W2VFXVsrLV0/XFxcXGQrKT8pJVxcXFxzKlwiLFxuICAgIHJlSGV4ID0gL14jKFswLTlhLWZdezMsOH0pJC8sXG4gICAgcmVSZ2JJbnRlZ2VyID0gbmV3IFJlZ0V4cChgXnJnYlxcXFwoJHtyZUl9LCR7cmVJfSwke3JlSX1cXFxcKSRgKSxcbiAgICByZVJnYlBlcmNlbnQgPSBuZXcgUmVnRXhwKGBecmdiXFxcXCgke3JlUH0sJHtyZVB9LCR7cmVQfVxcXFwpJGApLFxuICAgIHJlUmdiYUludGVnZXIgPSBuZXcgUmVnRXhwKGBecmdiYVxcXFwoJHtyZUl9LCR7cmVJfSwke3JlSX0sJHtyZU59XFxcXCkkYCksXG4gICAgcmVSZ2JhUGVyY2VudCA9IG5ldyBSZWdFeHAoYF5yZ2JhXFxcXCgke3JlUH0sJHtyZVB9LCR7cmVQfSwke3JlTn1cXFxcKSRgKSxcbiAgICByZUhzbFBlcmNlbnQgPSBuZXcgUmVnRXhwKGBeaHNsXFxcXCgke3JlTn0sJHtyZVB9LCR7cmVQfVxcXFwpJGApLFxuICAgIHJlSHNsYVBlcmNlbnQgPSBuZXcgUmVnRXhwKGBeaHNsYVxcXFwoJHtyZU59LCR7cmVQfSwke3JlUH0sJHtyZU59XFxcXCkkYCk7XG5cbnZhciBuYW1lZCA9IHtcbiAgYWxpY2VibHVlOiAweGYwZjhmZixcbiAgYW50aXF1ZXdoaXRlOiAweGZhZWJkNyxcbiAgYXF1YTogMHgwMGZmZmYsXG4gIGFxdWFtYXJpbmU6IDB4N2ZmZmQ0LFxuICBhenVyZTogMHhmMGZmZmYsXG4gIGJlaWdlOiAweGY1ZjVkYyxcbiAgYmlzcXVlOiAweGZmZTRjNCxcbiAgYmxhY2s6IDB4MDAwMDAwLFxuICBibGFuY2hlZGFsbW9uZDogMHhmZmViY2QsXG4gIGJsdWU6IDB4MDAwMGZmLFxuICBibHVldmlvbGV0OiAweDhhMmJlMixcbiAgYnJvd246IDB4YTUyYTJhLFxuICBidXJseXdvb2Q6IDB4ZGViODg3LFxuICBjYWRldGJsdWU6IDB4NWY5ZWEwLFxuICBjaGFydHJldXNlOiAweDdmZmYwMCxcbiAgY2hvY29sYXRlOiAweGQyNjkxZSxcbiAgY29yYWw6IDB4ZmY3ZjUwLFxuICBjb3JuZmxvd2VyYmx1ZTogMHg2NDk1ZWQsXG4gIGNvcm5zaWxrOiAweGZmZjhkYyxcbiAgY3JpbXNvbjogMHhkYzE0M2MsXG4gIGN5YW46IDB4MDBmZmZmLFxuICBkYXJrYmx1ZTogMHgwMDAwOGIsXG4gIGRhcmtjeWFuOiAweDAwOGI4YixcbiAgZGFya2dvbGRlbnJvZDogMHhiODg2MGIsXG4gIGRhcmtncmF5OiAweGE5YTlhOSxcbiAgZGFya2dyZWVuOiAweDAwNjQwMCxcbiAgZGFya2dyZXk6IDB4YTlhOWE5LFxuICBkYXJra2hha2k6IDB4YmRiNzZiLFxuICBkYXJrbWFnZW50YTogMHg4YjAwOGIsXG4gIGRhcmtvbGl2ZWdyZWVuOiAweDU1NmIyZixcbiAgZGFya29yYW5nZTogMHhmZjhjMDAsXG4gIGRhcmtvcmNoaWQ6IDB4OTkzMmNjLFxuICBkYXJrcmVkOiAweDhiMDAwMCxcbiAgZGFya3NhbG1vbjogMHhlOTk2N2EsXG4gIGRhcmtzZWFncmVlbjogMHg4ZmJjOGYsXG4gIGRhcmtzbGF0ZWJsdWU6IDB4NDgzZDhiLFxuICBkYXJrc2xhdGVncmF5OiAweDJmNGY0ZixcbiAgZGFya3NsYXRlZ3JleTogMHgyZjRmNGYsXG4gIGRhcmt0dXJxdW9pc2U6IDB4MDBjZWQxLFxuICBkYXJrdmlvbGV0OiAweDk0MDBkMyxcbiAgZGVlcHBpbms6IDB4ZmYxNDkzLFxuICBkZWVwc2t5Ymx1ZTogMHgwMGJmZmYsXG4gIGRpbWdyYXk6IDB4Njk2OTY5LFxuICBkaW1ncmV5OiAweDY5Njk2OSxcbiAgZG9kZ2VyYmx1ZTogMHgxZTkwZmYsXG4gIGZpcmVicmljazogMHhiMjIyMjIsXG4gIGZsb3JhbHdoaXRlOiAweGZmZmFmMCxcbiAgZm9yZXN0Z3JlZW46IDB4MjI4YjIyLFxuICBmdWNoc2lhOiAweGZmMDBmZixcbiAgZ2FpbnNib3JvOiAweGRjZGNkYyxcbiAgZ2hvc3R3aGl0ZTogMHhmOGY4ZmYsXG4gIGdvbGQ6IDB4ZmZkNzAwLFxuICBnb2xkZW5yb2Q6IDB4ZGFhNTIwLFxuICBncmF5OiAweDgwODA4MCxcbiAgZ3JlZW46IDB4MDA4MDAwLFxuICBncmVlbnllbGxvdzogMHhhZGZmMmYsXG4gIGdyZXk6IDB4ODA4MDgwLFxuICBob25leWRldzogMHhmMGZmZjAsXG4gIGhvdHBpbms6IDB4ZmY2OWI0LFxuICBpbmRpYW5yZWQ6IDB4Y2Q1YzVjLFxuICBpbmRpZ286IDB4NGIwMDgyLFxuICBpdm9yeTogMHhmZmZmZjAsXG4gIGtoYWtpOiAweGYwZTY4YyxcbiAgbGF2ZW5kZXI6IDB4ZTZlNmZhLFxuICBsYXZlbmRlcmJsdXNoOiAweGZmZjBmNSxcbiAgbGF3bmdyZWVuOiAweDdjZmMwMCxcbiAgbGVtb25jaGlmZm9uOiAweGZmZmFjZCxcbiAgbGlnaHRibHVlOiAweGFkZDhlNixcbiAgbGlnaHRjb3JhbDogMHhmMDgwODAsXG4gIGxpZ2h0Y3lhbjogMHhlMGZmZmYsXG4gIGxpZ2h0Z29sZGVucm9keWVsbG93OiAweGZhZmFkMixcbiAgbGlnaHRncmF5OiAweGQzZDNkMyxcbiAgbGlnaHRncmVlbjogMHg5MGVlOTAsXG4gIGxpZ2h0Z3JleTogMHhkM2QzZDMsXG4gIGxpZ2h0cGluazogMHhmZmI2YzEsXG4gIGxpZ2h0c2FsbW9uOiAweGZmYTA3YSxcbiAgbGlnaHRzZWFncmVlbjogMHgyMGIyYWEsXG4gIGxpZ2h0c2t5Ymx1ZTogMHg4N2NlZmEsXG4gIGxpZ2h0c2xhdGVncmF5OiAweDc3ODg5OSxcbiAgbGlnaHRzbGF0ZWdyZXk6IDB4Nzc4ODk5LFxuICBsaWdodHN0ZWVsYmx1ZTogMHhiMGM0ZGUsXG4gIGxpZ2h0eWVsbG93OiAweGZmZmZlMCxcbiAgbGltZTogMHgwMGZmMDAsXG4gIGxpbWVncmVlbjogMHgzMmNkMzIsXG4gIGxpbmVuOiAweGZhZjBlNixcbiAgbWFnZW50YTogMHhmZjAwZmYsXG4gIG1hcm9vbjogMHg4MDAwMDAsXG4gIG1lZGl1bWFxdWFtYXJpbmU6IDB4NjZjZGFhLFxuICBtZWRpdW1ibHVlOiAweDAwMDBjZCxcbiAgbWVkaXVtb3JjaGlkOiAweGJhNTVkMyxcbiAgbWVkaXVtcHVycGxlOiAweDkzNzBkYixcbiAgbWVkaXVtc2VhZ3JlZW46IDB4M2NiMzcxLFxuICBtZWRpdW1zbGF0ZWJsdWU6IDB4N2I2OGVlLFxuICBtZWRpdW1zcHJpbmdncmVlbjogMHgwMGZhOWEsXG4gIG1lZGl1bXR1cnF1b2lzZTogMHg0OGQxY2MsXG4gIG1lZGl1bXZpb2xldHJlZDogMHhjNzE1ODUsXG4gIG1pZG5pZ2h0Ymx1ZTogMHgxOTE5NzAsXG4gIG1pbnRjcmVhbTogMHhmNWZmZmEsXG4gIG1pc3R5cm9zZTogMHhmZmU0ZTEsXG4gIG1vY2Nhc2luOiAweGZmZTRiNSxcbiAgbmF2YWpvd2hpdGU6IDB4ZmZkZWFkLFxuICBuYXZ5OiAweDAwMDA4MCxcbiAgb2xkbGFjZTogMHhmZGY1ZTYsXG4gIG9saXZlOiAweDgwODAwMCxcbiAgb2xpdmVkcmFiOiAweDZiOGUyMyxcbiAgb3JhbmdlOiAweGZmYTUwMCxcbiAgb3JhbmdlcmVkOiAweGZmNDUwMCxcbiAgb3JjaGlkOiAweGRhNzBkNixcbiAgcGFsZWdvbGRlbnJvZDogMHhlZWU4YWEsXG4gIHBhbGVncmVlbjogMHg5OGZiOTgsXG4gIHBhbGV0dXJxdW9pc2U6IDB4YWZlZWVlLFxuICBwYWxldmlvbGV0cmVkOiAweGRiNzA5MyxcbiAgcGFwYXlhd2hpcDogMHhmZmVmZDUsXG4gIHBlYWNocHVmZjogMHhmZmRhYjksXG4gIHBlcnU6IDB4Y2Q4NTNmLFxuICBwaW5rOiAweGZmYzBjYixcbiAgcGx1bTogMHhkZGEwZGQsXG4gIHBvd2RlcmJsdWU6IDB4YjBlMGU2LFxuICBwdXJwbGU6IDB4ODAwMDgwLFxuICByZWJlY2NhcHVycGxlOiAweDY2MzM5OSxcbiAgcmVkOiAweGZmMDAwMCxcbiAgcm9zeWJyb3duOiAweGJjOGY4ZixcbiAgcm95YWxibHVlOiAweDQxNjllMSxcbiAgc2FkZGxlYnJvd246IDB4OGI0NTEzLFxuICBzYWxtb246IDB4ZmE4MDcyLFxuICBzYW5keWJyb3duOiAweGY0YTQ2MCxcbiAgc2VhZ3JlZW46IDB4MmU4YjU3LFxuICBzZWFzaGVsbDogMHhmZmY1ZWUsXG4gIHNpZW5uYTogMHhhMDUyMmQsXG4gIHNpbHZlcjogMHhjMGMwYzAsXG4gIHNreWJsdWU6IDB4ODdjZWViLFxuICBzbGF0ZWJsdWU6IDB4NmE1YWNkLFxuICBzbGF0ZWdyYXk6IDB4NzA4MDkwLFxuICBzbGF0ZWdyZXk6IDB4NzA4MDkwLFxuICBzbm93OiAweGZmZmFmYSxcbiAgc3ByaW5nZ3JlZW46IDB4MDBmZjdmLFxuICBzdGVlbGJsdWU6IDB4NDY4MmI0LFxuICB0YW46IDB4ZDJiNDhjLFxuICB0ZWFsOiAweDAwODA4MCxcbiAgdGhpc3RsZTogMHhkOGJmZDgsXG4gIHRvbWF0bzogMHhmZjYzNDcsXG4gIHR1cnF1b2lzZTogMHg0MGUwZDAsXG4gIHZpb2xldDogMHhlZTgyZWUsXG4gIHdoZWF0OiAweGY1ZGViMyxcbiAgd2hpdGU6IDB4ZmZmZmZmLFxuICB3aGl0ZXNtb2tlOiAweGY1ZjVmNSxcbiAgeWVsbG93OiAweGZmZmYwMCxcbiAgeWVsbG93Z3JlZW46IDB4OWFjZDMyXG59O1xuXG5kZWZpbmUoQ29sb3IsIGNvbG9yLCB7XG4gIGNvcHkoY2hhbm5lbHMpIHtcbiAgICByZXR1cm4gT2JqZWN0LmFzc2lnbihuZXcgdGhpcy5jb25zdHJ1Y3RvciwgdGhpcywgY2hhbm5lbHMpO1xuICB9LFxuICBkaXNwbGF5YWJsZSgpIHtcbiAgICByZXR1cm4gdGhpcy5yZ2IoKS5kaXNwbGF5YWJsZSgpO1xuICB9LFxuICBoZXg6IGNvbG9yX2Zvcm1hdEhleCwgLy8gRGVwcmVjYXRlZCEgVXNlIGNvbG9yLmZvcm1hdEhleC5cbiAgZm9ybWF0SGV4OiBjb2xvcl9mb3JtYXRIZXgsXG4gIGZvcm1hdEhleDg6IGNvbG9yX2Zvcm1hdEhleDgsXG4gIGZvcm1hdEhzbDogY29sb3JfZm9ybWF0SHNsLFxuICBmb3JtYXRSZ2I6IGNvbG9yX2Zvcm1hdFJnYixcbiAgdG9TdHJpbmc6IGNvbG9yX2Zvcm1hdFJnYlxufSk7XG5cbmZ1bmN0aW9uIGNvbG9yX2Zvcm1hdEhleCgpIHtcbiAgcmV0dXJuIHRoaXMucmdiKCkuZm9ybWF0SGV4KCk7XG59XG5cbmZ1bmN0aW9uIGNvbG9yX2Zvcm1hdEhleDgoKSB7XG4gIHJldHVybiB0aGlzLnJnYigpLmZvcm1hdEhleDgoKTtcbn1cblxuZnVuY3Rpb24gY29sb3JfZm9ybWF0SHNsKCkge1xuICByZXR1cm4gaHNsQ29udmVydCh0aGlzKS5mb3JtYXRIc2woKTtcbn1cblxuZnVuY3Rpb24gY29sb3JfZm9ybWF0UmdiKCkge1xuICByZXR1cm4gdGhpcy5yZ2IoKS5mb3JtYXRSZ2IoKTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gY29sb3IoZm9ybWF0KSB7XG4gIHZhciBtLCBsO1xuICBmb3JtYXQgPSAoZm9ybWF0ICsgXCJcIikudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gIHJldHVybiAobSA9IHJlSGV4LmV4ZWMoZm9ybWF0KSkgPyAobCA9IG1bMV0ubGVuZ3RoLCBtID0gcGFyc2VJbnQobVsxXSwgMTYpLCBsID09PSA2ID8gcmdibihtKSAvLyAjZmYwMDAwXG4gICAgICA6IGwgPT09IDMgPyBuZXcgUmdiKChtID4+IDggJiAweGYpIHwgKG0gPj4gNCAmIDB4ZjApLCAobSA+PiA0ICYgMHhmKSB8IChtICYgMHhmMCksICgobSAmIDB4ZikgPDwgNCkgfCAobSAmIDB4ZiksIDEpIC8vICNmMDBcbiAgICAgIDogbCA9PT0gOCA/IHJnYmEobSA+PiAyNCAmIDB4ZmYsIG0gPj4gMTYgJiAweGZmLCBtID4+IDggJiAweGZmLCAobSAmIDB4ZmYpIC8gMHhmZikgLy8gI2ZmMDAwMDAwXG4gICAgICA6IGwgPT09IDQgPyByZ2JhKChtID4+IDEyICYgMHhmKSB8IChtID4+IDggJiAweGYwKSwgKG0gPj4gOCAmIDB4ZikgfCAobSA+PiA0ICYgMHhmMCksIChtID4+IDQgJiAweGYpIHwgKG0gJiAweGYwKSwgKCgobSAmIDB4ZikgPDwgNCkgfCAobSAmIDB4ZikpIC8gMHhmZikgLy8gI2YwMDBcbiAgICAgIDogbnVsbCkgLy8gaW52YWxpZCBoZXhcbiAgICAgIDogKG0gPSByZVJnYkludGVnZXIuZXhlYyhmb3JtYXQpKSA/IG5ldyBSZ2IobVsxXSwgbVsyXSwgbVszXSwgMSkgLy8gcmdiKDI1NSwgMCwgMClcbiAgICAgIDogKG0gPSByZVJnYlBlcmNlbnQuZXhlYyhmb3JtYXQpKSA/IG5ldyBSZ2IobVsxXSAqIDI1NSAvIDEwMCwgbVsyXSAqIDI1NSAvIDEwMCwgbVszXSAqIDI1NSAvIDEwMCwgMSkgLy8gcmdiKDEwMCUsIDAlLCAwJSlcbiAgICAgIDogKG0gPSByZVJnYmFJbnRlZ2VyLmV4ZWMoZm9ybWF0KSkgPyByZ2JhKG1bMV0sIG1bMl0sIG1bM10sIG1bNF0pIC8vIHJnYmEoMjU1LCAwLCAwLCAxKVxuICAgICAgOiAobSA9IHJlUmdiYVBlcmNlbnQuZXhlYyhmb3JtYXQpKSA/IHJnYmEobVsxXSAqIDI1NSAvIDEwMCwgbVsyXSAqIDI1NSAvIDEwMCwgbVszXSAqIDI1NSAvIDEwMCwgbVs0XSkgLy8gcmdiKDEwMCUsIDAlLCAwJSwgMSlcbiAgICAgIDogKG0gPSByZUhzbFBlcmNlbnQuZXhlYyhmb3JtYXQpKSA/IGhzbGEobVsxXSwgbVsyXSAvIDEwMCwgbVszXSAvIDEwMCwgMSkgLy8gaHNsKDEyMCwgNTAlLCA1MCUpXG4gICAgICA6IChtID0gcmVIc2xhUGVyY2VudC5leGVjKGZvcm1hdCkpID8gaHNsYShtWzFdLCBtWzJdIC8gMTAwLCBtWzNdIC8gMTAwLCBtWzRdKSAvLyBoc2xhKDEyMCwgNTAlLCA1MCUsIDEpXG4gICAgICA6IG5hbWVkLmhhc093blByb3BlcnR5KGZvcm1hdCkgPyByZ2JuKG5hbWVkW2Zvcm1hdF0pIC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tcHJvdG90eXBlLWJ1aWx0aW5zXG4gICAgICA6IGZvcm1hdCA9PT0gXCJ0cmFuc3BhcmVudFwiID8gbmV3IFJnYihOYU4sIE5hTiwgTmFOLCAwKVxuICAgICAgOiBudWxsO1xufVxuXG5mdW5jdGlvbiByZ2JuKG4pIHtcbiAgcmV0dXJuIG5ldyBSZ2IobiA+PiAxNiAmIDB4ZmYsIG4gPj4gOCAmIDB4ZmYsIG4gJiAweGZmLCAxKTtcbn1cblxuZnVuY3Rpb24gcmdiYShyLCBnLCBiLCBhKSB7XG4gIGlmIChhIDw9IDApIHIgPSBnID0gYiA9IE5hTjtcbiAgcmV0dXJuIG5ldyBSZ2IociwgZywgYiwgYSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZ2JDb252ZXJ0KG8pIHtcbiAgaWYgKCEobyBpbnN0YW5jZW9mIENvbG9yKSkgbyA9IGNvbG9yKG8pO1xuICBpZiAoIW8pIHJldHVybiBuZXcgUmdiO1xuICBvID0gby5yZ2IoKTtcbiAgcmV0dXJuIG5ldyBSZ2Ioby5yLCBvLmcsIG8uYiwgby5vcGFjaXR5KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJnYihyLCBnLCBiLCBvcGFjaXR5KSB7XG4gIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID09PSAxID8gcmdiQ29udmVydChyKSA6IG5ldyBSZ2IociwgZywgYiwgb3BhY2l0eSA9PSBudWxsID8gMSA6IG9wYWNpdHkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gUmdiKHIsIGcsIGIsIG9wYWNpdHkpIHtcbiAgdGhpcy5yID0gK3I7XG4gIHRoaXMuZyA9ICtnO1xuICB0aGlzLmIgPSArYjtcbiAgdGhpcy5vcGFjaXR5ID0gK29wYWNpdHk7XG59XG5cbmRlZmluZShSZ2IsIHJnYiwgZXh0ZW5kKENvbG9yLCB7XG4gIGJyaWdodGVyKGspIHtcbiAgICBrID0gayA9PSBudWxsID8gYnJpZ2h0ZXIgOiBNYXRoLnBvdyhicmlnaHRlciwgayk7XG4gICAgcmV0dXJuIG5ldyBSZ2IodGhpcy5yICogaywgdGhpcy5nICogaywgdGhpcy5iICogaywgdGhpcy5vcGFjaXR5KTtcbiAgfSxcbiAgZGFya2VyKGspIHtcbiAgICBrID0gayA9PSBudWxsID8gZGFya2VyIDogTWF0aC5wb3coZGFya2VyLCBrKTtcbiAgICByZXR1cm4gbmV3IFJnYih0aGlzLnIgKiBrLCB0aGlzLmcgKiBrLCB0aGlzLmIgKiBrLCB0aGlzLm9wYWNpdHkpO1xuICB9LFxuICByZ2IoKSB7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH0sXG4gIGNsYW1wKCkge1xuICAgIHJldHVybiBuZXcgUmdiKGNsYW1waSh0aGlzLnIpLCBjbGFtcGkodGhpcy5nKSwgY2xhbXBpKHRoaXMuYiksIGNsYW1wYSh0aGlzLm9wYWNpdHkpKTtcbiAgfSxcbiAgZGlzcGxheWFibGUoKSB7XG4gICAgcmV0dXJuICgtMC41IDw9IHRoaXMuciAmJiB0aGlzLnIgPCAyNTUuNSlcbiAgICAgICAgJiYgKC0wLjUgPD0gdGhpcy5nICYmIHRoaXMuZyA8IDI1NS41KVxuICAgICAgICAmJiAoLTAuNSA8PSB0aGlzLmIgJiYgdGhpcy5iIDwgMjU1LjUpXG4gICAgICAgICYmICgwIDw9IHRoaXMub3BhY2l0eSAmJiB0aGlzLm9wYWNpdHkgPD0gMSk7XG4gIH0sXG4gIGhleDogcmdiX2Zvcm1hdEhleCwgLy8gRGVwcmVjYXRlZCEgVXNlIGNvbG9yLmZvcm1hdEhleC5cbiAgZm9ybWF0SGV4OiByZ2JfZm9ybWF0SGV4LFxuICBmb3JtYXRIZXg4OiByZ2JfZm9ybWF0SGV4OCxcbiAgZm9ybWF0UmdiOiByZ2JfZm9ybWF0UmdiLFxuICB0b1N0cmluZzogcmdiX2Zvcm1hdFJnYlxufSkpO1xuXG5mdW5jdGlvbiByZ2JfZm9ybWF0SGV4KCkge1xuICByZXR1cm4gYCMke2hleCh0aGlzLnIpfSR7aGV4KHRoaXMuZyl9JHtoZXgodGhpcy5iKX1gO1xufVxuXG5mdW5jdGlvbiByZ2JfZm9ybWF0SGV4OCgpIHtcbiAgcmV0dXJuIGAjJHtoZXgodGhpcy5yKX0ke2hleCh0aGlzLmcpfSR7aGV4KHRoaXMuYil9JHtoZXgoKGlzTmFOKHRoaXMub3BhY2l0eSkgPyAxIDogdGhpcy5vcGFjaXR5KSAqIDI1NSl9YDtcbn1cblxuZnVuY3Rpb24gcmdiX2Zvcm1hdFJnYigpIHtcbiAgY29uc3QgYSA9IGNsYW1wYSh0aGlzLm9wYWNpdHkpO1xuICByZXR1cm4gYCR7YSA9PT0gMSA/IFwicmdiKFwiIDogXCJyZ2JhKFwifSR7Y2xhbXBpKHRoaXMucil9LCAke2NsYW1waSh0aGlzLmcpfSwgJHtjbGFtcGkodGhpcy5iKX0ke2EgPT09IDEgPyBcIilcIiA6IGAsICR7YX0pYH1gO1xufVxuXG5mdW5jdGlvbiBjbGFtcGEob3BhY2l0eSkge1xuICByZXR1cm4gaXNOYU4ob3BhY2l0eSkgPyAxIDogTWF0aC5tYXgoMCwgTWF0aC5taW4oMSwgb3BhY2l0eSkpO1xufVxuXG5mdW5jdGlvbiBjbGFtcGkodmFsdWUpIHtcbiAgcmV0dXJuIE1hdGgubWF4KDAsIE1hdGgubWluKDI1NSwgTWF0aC5yb3VuZCh2YWx1ZSkgfHwgMCkpO1xufVxuXG5mdW5jdGlvbiBoZXgodmFsdWUpIHtcbiAgdmFsdWUgPSBjbGFtcGkodmFsdWUpO1xuICByZXR1cm4gKHZhbHVlIDwgMTYgPyBcIjBcIiA6IFwiXCIpICsgdmFsdWUudG9TdHJpbmcoMTYpO1xufVxuXG5mdW5jdGlvbiBoc2xhKGgsIHMsIGwsIGEpIHtcbiAgaWYgKGEgPD0gMCkgaCA9IHMgPSBsID0gTmFOO1xuICBlbHNlIGlmIChsIDw9IDAgfHwgbCA+PSAxKSBoID0gcyA9IE5hTjtcbiAgZWxzZSBpZiAocyA8PSAwKSBoID0gTmFOO1xuICByZXR1cm4gbmV3IEhzbChoLCBzLCBsLCBhKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGhzbENvbnZlcnQobykge1xuICBpZiAobyBpbnN0YW5jZW9mIEhzbCkgcmV0dXJuIG5ldyBIc2woby5oLCBvLnMsIG8ubCwgby5vcGFjaXR5KTtcbiAgaWYgKCEobyBpbnN0YW5jZW9mIENvbG9yKSkgbyA9IGNvbG9yKG8pO1xuICBpZiAoIW8pIHJldHVybiBuZXcgSHNsO1xuICBpZiAobyBpbnN0YW5jZW9mIEhzbCkgcmV0dXJuIG87XG4gIG8gPSBvLnJnYigpO1xuICB2YXIgciA9IG8uciAvIDI1NSxcbiAgICAgIGcgPSBvLmcgLyAyNTUsXG4gICAgICBiID0gby5iIC8gMjU1LFxuICAgICAgbWluID0gTWF0aC5taW4ociwgZywgYiksXG4gICAgICBtYXggPSBNYXRoLm1heChyLCBnLCBiKSxcbiAgICAgIGggPSBOYU4sXG4gICAgICBzID0gbWF4IC0gbWluLFxuICAgICAgbCA9IChtYXggKyBtaW4pIC8gMjtcbiAgaWYgKHMpIHtcbiAgICBpZiAociA9PT0gbWF4KSBoID0gKGcgLSBiKSAvIHMgKyAoZyA8IGIpICogNjtcbiAgICBlbHNlIGlmIChnID09PSBtYXgpIGggPSAoYiAtIHIpIC8gcyArIDI7XG4gICAgZWxzZSBoID0gKHIgLSBnKSAvIHMgKyA0O1xuICAgIHMgLz0gbCA8IDAuNSA/IG1heCArIG1pbiA6IDIgLSBtYXggLSBtaW47XG4gICAgaCAqPSA2MDtcbiAgfSBlbHNlIHtcbiAgICBzID0gbCA+IDAgJiYgbCA8IDEgPyAwIDogaDtcbiAgfVxuICByZXR1cm4gbmV3IEhzbChoLCBzLCBsLCBvLm9wYWNpdHkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaHNsKGgsIHMsIGwsIG9wYWNpdHkpIHtcbiAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPT09IDEgPyBoc2xDb252ZXJ0KGgpIDogbmV3IEhzbChoLCBzLCBsLCBvcGFjaXR5ID09IG51bGwgPyAxIDogb3BhY2l0eSk7XG59XG5cbmZ1bmN0aW9uIEhzbChoLCBzLCBsLCBvcGFjaXR5KSB7XG4gIHRoaXMuaCA9ICtoO1xuICB0aGlzLnMgPSArcztcbiAgdGhpcy5sID0gK2w7XG4gIHRoaXMub3BhY2l0eSA9ICtvcGFjaXR5O1xufVxuXG5kZWZpbmUoSHNsLCBoc2wsIGV4dGVuZChDb2xvciwge1xuICBicmlnaHRlcihrKSB7XG4gICAgayA9IGsgPT0gbnVsbCA/IGJyaWdodGVyIDogTWF0aC5wb3coYnJpZ2h0ZXIsIGspO1xuICAgIHJldHVybiBuZXcgSHNsKHRoaXMuaCwgdGhpcy5zLCB0aGlzLmwgKiBrLCB0aGlzLm9wYWNpdHkpO1xuICB9LFxuICBkYXJrZXIoaykge1xuICAgIGsgPSBrID09IG51bGwgPyBkYXJrZXIgOiBNYXRoLnBvdyhkYXJrZXIsIGspO1xuICAgIHJldHVybiBuZXcgSHNsKHRoaXMuaCwgdGhpcy5zLCB0aGlzLmwgKiBrLCB0aGlzLm9wYWNpdHkpO1xuICB9LFxuICByZ2IoKSB7XG4gICAgdmFyIGggPSB0aGlzLmggJSAzNjAgKyAodGhpcy5oIDwgMCkgKiAzNjAsXG4gICAgICAgIHMgPSBpc05hTihoKSB8fCBpc05hTih0aGlzLnMpID8gMCA6IHRoaXMucyxcbiAgICAgICAgbCA9IHRoaXMubCxcbiAgICAgICAgbTIgPSBsICsgKGwgPCAwLjUgPyBsIDogMSAtIGwpICogcyxcbiAgICAgICAgbTEgPSAyICogbCAtIG0yO1xuICAgIHJldHVybiBuZXcgUmdiKFxuICAgICAgaHNsMnJnYihoID49IDI0MCA/IGggLSAyNDAgOiBoICsgMTIwLCBtMSwgbTIpLFxuICAgICAgaHNsMnJnYihoLCBtMSwgbTIpLFxuICAgICAgaHNsMnJnYihoIDwgMTIwID8gaCArIDI0MCA6IGggLSAxMjAsIG0xLCBtMiksXG4gICAgICB0aGlzLm9wYWNpdHlcbiAgICApO1xuICB9LFxuICBjbGFtcCgpIHtcbiAgICByZXR1cm4gbmV3IEhzbChjbGFtcGgodGhpcy5oKSwgY2xhbXB0KHRoaXMucyksIGNsYW1wdCh0aGlzLmwpLCBjbGFtcGEodGhpcy5vcGFjaXR5KSk7XG4gIH0sXG4gIGRpc3BsYXlhYmxlKCkge1xuICAgIHJldHVybiAoMCA8PSB0aGlzLnMgJiYgdGhpcy5zIDw9IDEgfHwgaXNOYU4odGhpcy5zKSlcbiAgICAgICAgJiYgKDAgPD0gdGhpcy5sICYmIHRoaXMubCA8PSAxKVxuICAgICAgICAmJiAoMCA8PSB0aGlzLm9wYWNpdHkgJiYgdGhpcy5vcGFjaXR5IDw9IDEpO1xuICB9LFxuICBmb3JtYXRIc2woKSB7XG4gICAgY29uc3QgYSA9IGNsYW1wYSh0aGlzLm9wYWNpdHkpO1xuICAgIHJldHVybiBgJHthID09PSAxID8gXCJoc2woXCIgOiBcImhzbGEoXCJ9JHtjbGFtcGgodGhpcy5oKX0sICR7Y2xhbXB0KHRoaXMucykgKiAxMDB9JSwgJHtjbGFtcHQodGhpcy5sKSAqIDEwMH0lJHthID09PSAxID8gXCIpXCIgOiBgLCAke2F9KWB9YDtcbiAgfVxufSkpO1xuXG5mdW5jdGlvbiBjbGFtcGgodmFsdWUpIHtcbiAgdmFsdWUgPSAodmFsdWUgfHwgMCkgJSAzNjA7XG4gIHJldHVybiB2YWx1ZSA8IDAgPyB2YWx1ZSArIDM2MCA6IHZhbHVlO1xufVxuXG5mdW5jdGlvbiBjbGFtcHQodmFsdWUpIHtcbiAgcmV0dXJuIE1hdGgubWF4KDAsIE1hdGgubWluKDEsIHZhbHVlIHx8IDApKTtcbn1cblxuLyogRnJvbSBGdkQgMTMuMzcsIENTUyBDb2xvciBNb2R1bGUgTGV2ZWwgMyAqL1xuZnVuY3Rpb24gaHNsMnJnYihoLCBtMSwgbTIpIHtcbiAgcmV0dXJuIChoIDwgNjAgPyBtMSArIChtMiAtIG0xKSAqIGggLyA2MFxuICAgICAgOiBoIDwgMTgwID8gbTJcbiAgICAgIDogaCA8IDI0MCA/IG0xICsgKG0yIC0gbTEpICogKDI0MCAtIGgpIC8gNjBcbiAgICAgIDogbTEpICogMjU1O1xufVxuIiwgImV4cG9ydCBmdW5jdGlvbiBiYXNpcyh0MSwgdjAsIHYxLCB2MiwgdjMpIHtcbiAgdmFyIHQyID0gdDEgKiB0MSwgdDMgPSB0MiAqIHQxO1xuICByZXR1cm4gKCgxIC0gMyAqIHQxICsgMyAqIHQyIC0gdDMpICogdjBcbiAgICAgICsgKDQgLSA2ICogdDIgKyAzICogdDMpICogdjFcbiAgICAgICsgKDEgKyAzICogdDEgKyAzICogdDIgLSAzICogdDMpICogdjJcbiAgICAgICsgdDMgKiB2MykgLyA2O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih2YWx1ZXMpIHtcbiAgdmFyIG4gPSB2YWx1ZXMubGVuZ3RoIC0gMTtcbiAgcmV0dXJuIGZ1bmN0aW9uKHQpIHtcbiAgICB2YXIgaSA9IHQgPD0gMCA/ICh0ID0gMCkgOiB0ID49IDEgPyAodCA9IDEsIG4gLSAxKSA6IE1hdGguZmxvb3IodCAqIG4pLFxuICAgICAgICB2MSA9IHZhbHVlc1tpXSxcbiAgICAgICAgdjIgPSB2YWx1ZXNbaSArIDFdLFxuICAgICAgICB2MCA9IGkgPiAwID8gdmFsdWVzW2kgLSAxXSA6IDIgKiB2MSAtIHYyLFxuICAgICAgICB2MyA9IGkgPCBuIC0gMSA/IHZhbHVlc1tpICsgMl0gOiAyICogdjIgLSB2MTtcbiAgICByZXR1cm4gYmFzaXMoKHQgLSBpIC8gbikgKiBuLCB2MCwgdjEsIHYyLCB2Myk7XG4gIH07XG59XG4iLCAiaW1wb3J0IHtiYXNpc30gZnJvbSBcIi4vYmFzaXMuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24odmFsdWVzKSB7XG4gIHZhciBuID0gdmFsdWVzLmxlbmd0aDtcbiAgcmV0dXJuIGZ1bmN0aW9uKHQpIHtcbiAgICB2YXIgaSA9IE1hdGguZmxvb3IoKCh0ICU9IDEpIDwgMCA/ICsrdCA6IHQpICogbiksXG4gICAgICAgIHYwID0gdmFsdWVzWyhpICsgbiAtIDEpICUgbl0sXG4gICAgICAgIHYxID0gdmFsdWVzW2kgJSBuXSxcbiAgICAgICAgdjIgPSB2YWx1ZXNbKGkgKyAxKSAlIG5dLFxuICAgICAgICB2MyA9IHZhbHVlc1soaSArIDIpICUgbl07XG4gICAgcmV0dXJuIGJhc2lzKCh0IC0gaSAvIG4pICogbiwgdjAsIHYxLCB2MiwgdjMpO1xuICB9O1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IHggPT4gKCkgPT4geDtcbiIsICJpbXBvcnQgY29uc3RhbnQgZnJvbSBcIi4vY29uc3RhbnQuanNcIjtcblxuZnVuY3Rpb24gbGluZWFyKGEsIGQpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKHQpIHtcbiAgICByZXR1cm4gYSArIHQgKiBkO1xuICB9O1xufVxuXG5mdW5jdGlvbiBleHBvbmVudGlhbChhLCBiLCB5KSB7XG4gIHJldHVybiBhID0gTWF0aC5wb3coYSwgeSksIGIgPSBNYXRoLnBvdyhiLCB5KSAtIGEsIHkgPSAxIC8geSwgZnVuY3Rpb24odCkge1xuICAgIHJldHVybiBNYXRoLnBvdyhhICsgdCAqIGIsIHkpO1xuICB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaHVlKGEsIGIpIHtcbiAgdmFyIGQgPSBiIC0gYTtcbiAgcmV0dXJuIGQgPyBsaW5lYXIoYSwgZCA+IDE4MCB8fCBkIDwgLTE4MCA/IGQgLSAzNjAgKiBNYXRoLnJvdW5kKGQgLyAzNjApIDogZCkgOiBjb25zdGFudChpc05hTihhKSA/IGIgOiBhKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdhbW1hKHkpIHtcbiAgcmV0dXJuICh5ID0gK3kpID09PSAxID8gbm9nYW1tYSA6IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICByZXR1cm4gYiAtIGEgPyBleHBvbmVudGlhbChhLCBiLCB5KSA6IGNvbnN0YW50KGlzTmFOKGEpID8gYiA6IGEpO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBub2dhbW1hKGEsIGIpIHtcbiAgdmFyIGQgPSBiIC0gYTtcbiAgcmV0dXJuIGQgPyBsaW5lYXIoYSwgZCkgOiBjb25zdGFudChpc05hTihhKSA/IGIgOiBhKTtcbn1cbiIsICJpbXBvcnQge3JnYiBhcyBjb2xvclJnYn0gZnJvbSBcImQzLWNvbG9yXCI7XG5pbXBvcnQgYmFzaXMgZnJvbSBcIi4vYmFzaXMuanNcIjtcbmltcG9ydCBiYXNpc0Nsb3NlZCBmcm9tIFwiLi9iYXNpc0Nsb3NlZC5qc1wiO1xuaW1wb3J0IG5vZ2FtbWEsIHtnYW1tYX0gZnJvbSBcIi4vY29sb3IuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgKGZ1bmN0aW9uIHJnYkdhbW1hKHkpIHtcbiAgdmFyIGNvbG9yID0gZ2FtbWEoeSk7XG5cbiAgZnVuY3Rpb24gcmdiKHN0YXJ0LCBlbmQpIHtcbiAgICB2YXIgciA9IGNvbG9yKChzdGFydCA9IGNvbG9yUmdiKHN0YXJ0KSkuciwgKGVuZCA9IGNvbG9yUmdiKGVuZCkpLnIpLFxuICAgICAgICBnID0gY29sb3Ioc3RhcnQuZywgZW5kLmcpLFxuICAgICAgICBiID0gY29sb3Ioc3RhcnQuYiwgZW5kLmIpLFxuICAgICAgICBvcGFjaXR5ID0gbm9nYW1tYShzdGFydC5vcGFjaXR5LCBlbmQub3BhY2l0eSk7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKHQpIHtcbiAgICAgIHN0YXJ0LnIgPSByKHQpO1xuICAgICAgc3RhcnQuZyA9IGcodCk7XG4gICAgICBzdGFydC5iID0gYih0KTtcbiAgICAgIHN0YXJ0Lm9wYWNpdHkgPSBvcGFjaXR5KHQpO1xuICAgICAgcmV0dXJuIHN0YXJ0ICsgXCJcIjtcbiAgICB9O1xuICB9XG5cbiAgcmdiLmdhbW1hID0gcmdiR2FtbWE7XG5cbiAgcmV0dXJuIHJnYjtcbn0pKDEpO1xuXG5mdW5jdGlvbiByZ2JTcGxpbmUoc3BsaW5lKSB7XG4gIHJldHVybiBmdW5jdGlvbihjb2xvcnMpIHtcbiAgICB2YXIgbiA9IGNvbG9ycy5sZW5ndGgsXG4gICAgICAgIHIgPSBuZXcgQXJyYXkobiksXG4gICAgICAgIGcgPSBuZXcgQXJyYXkobiksXG4gICAgICAgIGIgPSBuZXcgQXJyYXkobiksXG4gICAgICAgIGksIGNvbG9yO1xuICAgIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIGNvbG9yID0gY29sb3JSZ2IoY29sb3JzW2ldKTtcbiAgICAgIHJbaV0gPSBjb2xvci5yIHx8IDA7XG4gICAgICBnW2ldID0gY29sb3IuZyB8fCAwO1xuICAgICAgYltpXSA9IGNvbG9yLmIgfHwgMDtcbiAgICB9XG4gICAgciA9IHNwbGluZShyKTtcbiAgICBnID0gc3BsaW5lKGcpO1xuICAgIGIgPSBzcGxpbmUoYik7XG4gICAgY29sb3Iub3BhY2l0eSA9IDE7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKHQpIHtcbiAgICAgIGNvbG9yLnIgPSByKHQpO1xuICAgICAgY29sb3IuZyA9IGcodCk7XG4gICAgICBjb2xvci5iID0gYih0KTtcbiAgICAgIHJldHVybiBjb2xvciArIFwiXCI7XG4gICAgfTtcbiAgfTtcbn1cblxuZXhwb3J0IHZhciByZ2JCYXNpcyA9IHJnYlNwbGluZShiYXNpcyk7XG5leHBvcnQgdmFyIHJnYkJhc2lzQ2xvc2VkID0gcmdiU3BsaW5lKGJhc2lzQ2xvc2VkKTtcbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhID0gK2EsIGIgPSArYiwgZnVuY3Rpb24odCkge1xuICAgIHJldHVybiBhICogKDEgLSB0KSArIGIgKiB0O1xuICB9O1xufVxuIiwgImltcG9ydCBudW1iZXIgZnJvbSBcIi4vbnVtYmVyLmpzXCI7XG5cbnZhciByZUEgPSAvWy0rXT8oPzpcXGQrXFwuP1xcZCp8XFwuP1xcZCspKD86W2VFXVstK10/XFxkKyk/L2csXG4gICAgcmVCID0gbmV3IFJlZ0V4cChyZUEuc291cmNlLCBcImdcIik7XG5cbmZ1bmN0aW9uIHplcm8oYikge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGI7XG4gIH07XG59XG5cbmZ1bmN0aW9uIG9uZShiKSB7XG4gIHJldHVybiBmdW5jdGlvbih0KSB7XG4gICAgcmV0dXJuIGIodCkgKyBcIlwiO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihhLCBiKSB7XG4gIHZhciBiaSA9IHJlQS5sYXN0SW5kZXggPSByZUIubGFzdEluZGV4ID0gMCwgLy8gc2NhbiBpbmRleCBmb3IgbmV4dCBudW1iZXIgaW4gYlxuICAgICAgYW0sIC8vIGN1cnJlbnQgbWF0Y2ggaW4gYVxuICAgICAgYm0sIC8vIGN1cnJlbnQgbWF0Y2ggaW4gYlxuICAgICAgYnMsIC8vIHN0cmluZyBwcmVjZWRpbmcgY3VycmVudCBudW1iZXIgaW4gYiwgaWYgYW55XG4gICAgICBpID0gLTEsIC8vIGluZGV4IGluIHNcbiAgICAgIHMgPSBbXSwgLy8gc3RyaW5nIGNvbnN0YW50cyBhbmQgcGxhY2Vob2xkZXJzXG4gICAgICBxID0gW107IC8vIG51bWJlciBpbnRlcnBvbGF0b3JzXG5cbiAgLy8gQ29lcmNlIGlucHV0cyB0byBzdHJpbmdzLlxuICBhID0gYSArIFwiXCIsIGIgPSBiICsgXCJcIjtcblxuICAvLyBJbnRlcnBvbGF0ZSBwYWlycyBvZiBudW1iZXJzIGluIGEgJiBiLlxuICB3aGlsZSAoKGFtID0gcmVBLmV4ZWMoYSkpXG4gICAgICAmJiAoYm0gPSByZUIuZXhlYyhiKSkpIHtcbiAgICBpZiAoKGJzID0gYm0uaW5kZXgpID4gYmkpIHsgLy8gYSBzdHJpbmcgcHJlY2VkZXMgdGhlIG5leHQgbnVtYmVyIGluIGJcbiAgICAgIGJzID0gYi5zbGljZShiaSwgYnMpO1xuICAgICAgaWYgKHNbaV0pIHNbaV0gKz0gYnM7IC8vIGNvYWxlc2NlIHdpdGggcHJldmlvdXMgc3RyaW5nXG4gICAgICBlbHNlIHNbKytpXSA9IGJzO1xuICAgIH1cbiAgICBpZiAoKGFtID0gYW1bMF0pID09PSAoYm0gPSBibVswXSkpIHsgLy8gbnVtYmVycyBpbiBhICYgYiBtYXRjaFxuICAgICAgaWYgKHNbaV0pIHNbaV0gKz0gYm07IC8vIGNvYWxlc2NlIHdpdGggcHJldmlvdXMgc3RyaW5nXG4gICAgICBlbHNlIHNbKytpXSA9IGJtO1xuICAgIH0gZWxzZSB7IC8vIGludGVycG9sYXRlIG5vbi1tYXRjaGluZyBudW1iZXJzXG4gICAgICBzWysraV0gPSBudWxsO1xuICAgICAgcS5wdXNoKHtpOiBpLCB4OiBudW1iZXIoYW0sIGJtKX0pO1xuICAgIH1cbiAgICBiaSA9IHJlQi5sYXN0SW5kZXg7XG4gIH1cblxuICAvLyBBZGQgcmVtYWlucyBvZiBiLlxuICBpZiAoYmkgPCBiLmxlbmd0aCkge1xuICAgIGJzID0gYi5zbGljZShiaSk7XG4gICAgaWYgKHNbaV0pIHNbaV0gKz0gYnM7IC8vIGNvYWxlc2NlIHdpdGggcHJldmlvdXMgc3RyaW5nXG4gICAgZWxzZSBzWysraV0gPSBicztcbiAgfVxuXG4gIC8vIFNwZWNpYWwgb3B0aW1pemF0aW9uIGZvciBvbmx5IGEgc2luZ2xlIG1hdGNoLlxuICAvLyBPdGhlcndpc2UsIGludGVycG9sYXRlIGVhY2ggb2YgdGhlIG51bWJlcnMgYW5kIHJlam9pbiB0aGUgc3RyaW5nLlxuICByZXR1cm4gcy5sZW5ndGggPCAyID8gKHFbMF1cbiAgICAgID8gb25lKHFbMF0ueClcbiAgICAgIDogemVybyhiKSlcbiAgICAgIDogKGIgPSBxLmxlbmd0aCwgZnVuY3Rpb24odCkge1xuICAgICAgICAgIGZvciAodmFyIGkgPSAwLCBvOyBpIDwgYjsgKytpKSBzWyhvID0gcVtpXSkuaV0gPSBvLngodCk7XG4gICAgICAgICAgcmV0dXJuIHMuam9pbihcIlwiKTtcbiAgICAgICAgfSk7XG59XG4iLCAidmFyIGRlZ3JlZXMgPSAxODAgLyBNYXRoLlBJO1xuXG5leHBvcnQgdmFyIGlkZW50aXR5ID0ge1xuICB0cmFuc2xhdGVYOiAwLFxuICB0cmFuc2xhdGVZOiAwLFxuICByb3RhdGU6IDAsXG4gIHNrZXdYOiAwLFxuICBzY2FsZVg6IDEsXG4gIHNjYWxlWTogMVxufTtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oYSwgYiwgYywgZCwgZSwgZikge1xuICB2YXIgc2NhbGVYLCBzY2FsZVksIHNrZXdYO1xuICBpZiAoc2NhbGVYID0gTWF0aC5zcXJ0KGEgKiBhICsgYiAqIGIpKSBhIC89IHNjYWxlWCwgYiAvPSBzY2FsZVg7XG4gIGlmIChza2V3WCA9IGEgKiBjICsgYiAqIGQpIGMgLT0gYSAqIHNrZXdYLCBkIC09IGIgKiBza2V3WDtcbiAgaWYgKHNjYWxlWSA9IE1hdGguc3FydChjICogYyArIGQgKiBkKSkgYyAvPSBzY2FsZVksIGQgLz0gc2NhbGVZLCBza2V3WCAvPSBzY2FsZVk7XG4gIGlmIChhICogZCA8IGIgKiBjKSBhID0gLWEsIGIgPSAtYiwgc2tld1ggPSAtc2tld1gsIHNjYWxlWCA9IC1zY2FsZVg7XG4gIHJldHVybiB7XG4gICAgdHJhbnNsYXRlWDogZSxcbiAgICB0cmFuc2xhdGVZOiBmLFxuICAgIHJvdGF0ZTogTWF0aC5hdGFuMihiLCBhKSAqIGRlZ3JlZXMsXG4gICAgc2tld1g6IE1hdGguYXRhbihza2V3WCkgKiBkZWdyZWVzLFxuICAgIHNjYWxlWDogc2NhbGVYLFxuICAgIHNjYWxlWTogc2NhbGVZXG4gIH07XG59XG4iLCAiaW1wb3J0IGRlY29tcG9zZSwge2lkZW50aXR5fSBmcm9tIFwiLi9kZWNvbXBvc2UuanNcIjtcblxudmFyIHN2Z05vZGU7XG5cbi8qIGVzbGludC1kaXNhYmxlIG5vLXVuZGVmICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDc3ModmFsdWUpIHtcbiAgY29uc3QgbSA9IG5ldyAodHlwZW9mIERPTU1hdHJpeCA9PT0gXCJmdW5jdGlvblwiID8gRE9NTWF0cml4IDogV2ViS2l0Q1NTTWF0cml4KSh2YWx1ZSArIFwiXCIpO1xuICByZXR1cm4gbS5pc0lkZW50aXR5ID8gaWRlbnRpdHkgOiBkZWNvbXBvc2UobS5hLCBtLmIsIG0uYywgbS5kLCBtLmUsIG0uZik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVN2Zyh2YWx1ZSkge1xuICBpZiAodmFsdWUgPT0gbnVsbCkgcmV0dXJuIGlkZW50aXR5O1xuICBpZiAoIXN2Z05vZGUpIHN2Z05vZGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50TlMoXCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiLCBcImdcIik7XG4gIHN2Z05vZGUuc2V0QXR0cmlidXRlKFwidHJhbnNmb3JtXCIsIHZhbHVlKTtcbiAgaWYgKCEodmFsdWUgPSBzdmdOb2RlLnRyYW5zZm9ybS5iYXNlVmFsLmNvbnNvbGlkYXRlKCkpKSByZXR1cm4gaWRlbnRpdHk7XG4gIHZhbHVlID0gdmFsdWUubWF0cml4O1xuICByZXR1cm4gZGVjb21wb3NlKHZhbHVlLmEsIHZhbHVlLmIsIHZhbHVlLmMsIHZhbHVlLmQsIHZhbHVlLmUsIHZhbHVlLmYpO1xufVxuIiwgImltcG9ydCBudW1iZXIgZnJvbSBcIi4uL251bWJlci5qc1wiO1xuaW1wb3J0IHtwYXJzZUNzcywgcGFyc2VTdmd9IGZyb20gXCIuL3BhcnNlLmpzXCI7XG5cbmZ1bmN0aW9uIGludGVycG9sYXRlVHJhbnNmb3JtKHBhcnNlLCBweENvbW1hLCBweFBhcmVuLCBkZWdQYXJlbikge1xuXG4gIGZ1bmN0aW9uIHBvcChzKSB7XG4gICAgcmV0dXJuIHMubGVuZ3RoID8gcy5wb3AoKSArIFwiIFwiIDogXCJcIjtcbiAgfVxuXG4gIGZ1bmN0aW9uIHRyYW5zbGF0ZSh4YSwgeWEsIHhiLCB5YiwgcywgcSkge1xuICAgIGlmICh4YSAhPT0geGIgfHwgeWEgIT09IHliKSB7XG4gICAgICB2YXIgaSA9IHMucHVzaChcInRyYW5zbGF0ZShcIiwgbnVsbCwgcHhDb21tYSwgbnVsbCwgcHhQYXJlbik7XG4gICAgICBxLnB1c2goe2k6IGkgLSA0LCB4OiBudW1iZXIoeGEsIHhiKX0sIHtpOiBpIC0gMiwgeDogbnVtYmVyKHlhLCB5Yil9KTtcbiAgICB9IGVsc2UgaWYgKHhiIHx8IHliKSB7XG4gICAgICBzLnB1c2goXCJ0cmFuc2xhdGUoXCIgKyB4YiArIHB4Q29tbWEgKyB5YiArIHB4UGFyZW4pO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHJvdGF0ZShhLCBiLCBzLCBxKSB7XG4gICAgaWYgKGEgIT09IGIpIHtcbiAgICAgIGlmIChhIC0gYiA+IDE4MCkgYiArPSAzNjA7IGVsc2UgaWYgKGIgLSBhID4gMTgwKSBhICs9IDM2MDsgLy8gc2hvcnRlc3QgcGF0aFxuICAgICAgcS5wdXNoKHtpOiBzLnB1c2gocG9wKHMpICsgXCJyb3RhdGUoXCIsIG51bGwsIGRlZ1BhcmVuKSAtIDIsIHg6IG51bWJlcihhLCBiKX0pO1xuICAgIH0gZWxzZSBpZiAoYikge1xuICAgICAgcy5wdXNoKHBvcChzKSArIFwicm90YXRlKFwiICsgYiArIGRlZ1BhcmVuKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBza2V3WChhLCBiLCBzLCBxKSB7XG4gICAgaWYgKGEgIT09IGIpIHtcbiAgICAgIHEucHVzaCh7aTogcy5wdXNoKHBvcChzKSArIFwic2tld1goXCIsIG51bGwsIGRlZ1BhcmVuKSAtIDIsIHg6IG51bWJlcihhLCBiKX0pO1xuICAgIH0gZWxzZSBpZiAoYikge1xuICAgICAgcy5wdXNoKHBvcChzKSArIFwic2tld1goXCIgKyBiICsgZGVnUGFyZW4pO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHNjYWxlKHhhLCB5YSwgeGIsIHliLCBzLCBxKSB7XG4gICAgaWYgKHhhICE9PSB4YiB8fCB5YSAhPT0geWIpIHtcbiAgICAgIHZhciBpID0gcy5wdXNoKHBvcChzKSArIFwic2NhbGUoXCIsIG51bGwsIFwiLFwiLCBudWxsLCBcIilcIik7XG4gICAgICBxLnB1c2goe2k6IGkgLSA0LCB4OiBudW1iZXIoeGEsIHhiKX0sIHtpOiBpIC0gMiwgeDogbnVtYmVyKHlhLCB5Yil9KTtcbiAgICB9IGVsc2UgaWYgKHhiICE9PSAxIHx8IHliICE9PSAxKSB7XG4gICAgICBzLnB1c2gocG9wKHMpICsgXCJzY2FsZShcIiArIHhiICsgXCIsXCIgKyB5YiArIFwiKVwiKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gZnVuY3Rpb24oYSwgYikge1xuICAgIHZhciBzID0gW10sIC8vIHN0cmluZyBjb25zdGFudHMgYW5kIHBsYWNlaG9sZGVyc1xuICAgICAgICBxID0gW107IC8vIG51bWJlciBpbnRlcnBvbGF0b3JzXG4gICAgYSA9IHBhcnNlKGEpLCBiID0gcGFyc2UoYik7XG4gICAgdHJhbnNsYXRlKGEudHJhbnNsYXRlWCwgYS50cmFuc2xhdGVZLCBiLnRyYW5zbGF0ZVgsIGIudHJhbnNsYXRlWSwgcywgcSk7XG4gICAgcm90YXRlKGEucm90YXRlLCBiLnJvdGF0ZSwgcywgcSk7XG4gICAgc2tld1goYS5za2V3WCwgYi5za2V3WCwgcywgcSk7XG4gICAgc2NhbGUoYS5zY2FsZVgsIGEuc2NhbGVZLCBiLnNjYWxlWCwgYi5zY2FsZVksIHMsIHEpO1xuICAgIGEgPSBiID0gbnVsbDsgLy8gZ2NcbiAgICByZXR1cm4gZnVuY3Rpb24odCkge1xuICAgICAgdmFyIGkgPSAtMSwgbiA9IHEubGVuZ3RoLCBvO1xuICAgICAgd2hpbGUgKCsraSA8IG4pIHNbKG8gPSBxW2ldKS5pXSA9IG8ueCh0KTtcbiAgICAgIHJldHVybiBzLmpvaW4oXCJcIik7XG4gICAgfTtcbiAgfTtcbn1cblxuZXhwb3J0IHZhciBpbnRlcnBvbGF0ZVRyYW5zZm9ybUNzcyA9IGludGVycG9sYXRlVHJhbnNmb3JtKHBhcnNlQ3NzLCBcInB4LCBcIiwgXCJweClcIiwgXCJkZWcpXCIpO1xuZXhwb3J0IHZhciBpbnRlcnBvbGF0ZVRyYW5zZm9ybVN2ZyA9IGludGVycG9sYXRlVHJhbnNmb3JtKHBhcnNlU3ZnLCBcIiwgXCIsIFwiKVwiLCBcIilcIik7XG4iLCAidmFyIGVwc2lsb24yID0gMWUtMTI7XG5cbmZ1bmN0aW9uIGNvc2goeCkge1xuICByZXR1cm4gKCh4ID0gTWF0aC5leHAoeCkpICsgMSAvIHgpIC8gMjtcbn1cblxuZnVuY3Rpb24gc2luaCh4KSB7XG4gIHJldHVybiAoKHggPSBNYXRoLmV4cCh4KSkgLSAxIC8geCkgLyAyO1xufVxuXG5mdW5jdGlvbiB0YW5oKHgpIHtcbiAgcmV0dXJuICgoeCA9IE1hdGguZXhwKDIgKiB4KSkgLSAxKSAvICh4ICsgMSk7XG59XG5cbmV4cG9ydCBkZWZhdWx0IChmdW5jdGlvbiB6b29tUmhvKHJobywgcmhvMiwgcmhvNCkge1xuXG4gIC8vIHAwID0gW3V4MCwgdXkwLCB3MF1cbiAgLy8gcDEgPSBbdXgxLCB1eTEsIHcxXVxuICBmdW5jdGlvbiB6b29tKHAwLCBwMSkge1xuICAgIHZhciB1eDAgPSBwMFswXSwgdXkwID0gcDBbMV0sIHcwID0gcDBbMl0sXG4gICAgICAgIHV4MSA9IHAxWzBdLCB1eTEgPSBwMVsxXSwgdzEgPSBwMVsyXSxcbiAgICAgICAgZHggPSB1eDEgLSB1eDAsXG4gICAgICAgIGR5ID0gdXkxIC0gdXkwLFxuICAgICAgICBkMiA9IGR4ICogZHggKyBkeSAqIGR5LFxuICAgICAgICBpLFxuICAgICAgICBTO1xuXG4gICAgLy8gU3BlY2lhbCBjYXNlIGZvciB1MCBcdTIyNDUgdTEuXG4gICAgaWYgKGQyIDwgZXBzaWxvbjIpIHtcbiAgICAgIFMgPSBNYXRoLmxvZyh3MSAvIHcwKSAvIHJobztcbiAgICAgIGkgPSBmdW5jdGlvbih0KSB7XG4gICAgICAgIHJldHVybiBbXG4gICAgICAgICAgdXgwICsgdCAqIGR4LFxuICAgICAgICAgIHV5MCArIHQgKiBkeSxcbiAgICAgICAgICB3MCAqIE1hdGguZXhwKHJobyAqIHQgKiBTKVxuICAgICAgICBdO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEdlbmVyYWwgY2FzZS5cbiAgICBlbHNlIHtcbiAgICAgIHZhciBkMSA9IE1hdGguc3FydChkMiksXG4gICAgICAgICAgYjAgPSAodzEgKiB3MSAtIHcwICogdzAgKyByaG80ICogZDIpIC8gKDIgKiB3MCAqIHJobzIgKiBkMSksXG4gICAgICAgICAgYjEgPSAodzEgKiB3MSAtIHcwICogdzAgLSByaG80ICogZDIpIC8gKDIgKiB3MSAqIHJobzIgKiBkMSksXG4gICAgICAgICAgcjAgPSBNYXRoLmxvZyhNYXRoLnNxcnQoYjAgKiBiMCArIDEpIC0gYjApLFxuICAgICAgICAgIHIxID0gTWF0aC5sb2coTWF0aC5zcXJ0KGIxICogYjEgKyAxKSAtIGIxKTtcbiAgICAgIFMgPSAocjEgLSByMCkgLyByaG87XG4gICAgICBpID0gZnVuY3Rpb24odCkge1xuICAgICAgICB2YXIgcyA9IHQgKiBTLFxuICAgICAgICAgICAgY29zaHIwID0gY29zaChyMCksXG4gICAgICAgICAgICB1ID0gdzAgLyAocmhvMiAqIGQxKSAqIChjb3NocjAgKiB0YW5oKHJobyAqIHMgKyByMCkgLSBzaW5oKHIwKSk7XG4gICAgICAgIHJldHVybiBbXG4gICAgICAgICAgdXgwICsgdSAqIGR4LFxuICAgICAgICAgIHV5MCArIHUgKiBkeSxcbiAgICAgICAgICB3MCAqIGNvc2hyMCAvIGNvc2gocmhvICogcyArIHIwKVxuICAgICAgICBdO1xuICAgICAgfVxuICAgIH1cblxuICAgIGkuZHVyYXRpb24gPSBTICogMTAwMCAqIHJobyAvIE1hdGguU1FSVDI7XG5cbiAgICByZXR1cm4gaTtcbiAgfVxuXG4gIHpvb20ucmhvID0gZnVuY3Rpb24oXykge1xuICAgIHZhciBfMSA9IE1hdGgubWF4KDFlLTMsICtfKSwgXzIgPSBfMSAqIF8xLCBfNCA9IF8yICogXzI7XG4gICAgcmV0dXJuIHpvb21SaG8oXzEsIF8yLCBfNCk7XG4gIH07XG5cbiAgcmV0dXJuIHpvb207XG59KShNYXRoLlNRUlQyLCAyLCA0KTtcbiIsICJ2YXIgZnJhbWUgPSAwLCAvLyBpcyBhbiBhbmltYXRpb24gZnJhbWUgcGVuZGluZz9cbiAgICB0aW1lb3V0ID0gMCwgLy8gaXMgYSB0aW1lb3V0IHBlbmRpbmc/XG4gICAgaW50ZXJ2YWwgPSAwLCAvLyBhcmUgYW55IHRpbWVycyBhY3RpdmU/XG4gICAgcG9rZURlbGF5ID0gMTAwMCwgLy8gaG93IGZyZXF1ZW50bHkgd2UgY2hlY2sgZm9yIGNsb2NrIHNrZXdcbiAgICB0YXNrSGVhZCxcbiAgICB0YXNrVGFpbCxcbiAgICBjbG9ja0xhc3QgPSAwLFxuICAgIGNsb2NrTm93ID0gMCxcbiAgICBjbG9ja1NrZXcgPSAwLFxuICAgIGNsb2NrID0gdHlwZW9mIHBlcmZvcm1hbmNlID09PSBcIm9iamVjdFwiICYmIHBlcmZvcm1hbmNlLm5vdyA/IHBlcmZvcm1hbmNlIDogRGF0ZSxcbiAgICBzZXRGcmFtZSA9IHR5cGVvZiB3aW5kb3cgPT09IFwib2JqZWN0XCIgJiYgd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSA/IHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUuYmluZCh3aW5kb3cpIDogZnVuY3Rpb24oZikgeyBzZXRUaW1lb3V0KGYsIDE3KTsgfTtcblxuZXhwb3J0IGZ1bmN0aW9uIG5vdygpIHtcbiAgcmV0dXJuIGNsb2NrTm93IHx8IChzZXRGcmFtZShjbGVhck5vdyksIGNsb2NrTm93ID0gY2xvY2subm93KCkgKyBjbG9ja1NrZXcpO1xufVxuXG5mdW5jdGlvbiBjbGVhck5vdygpIHtcbiAgY2xvY2tOb3cgPSAwO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gVGltZXIoKSB7XG4gIHRoaXMuX2NhbGwgPVxuICB0aGlzLl90aW1lID1cbiAgdGhpcy5fbmV4dCA9IG51bGw7XG59XG5cblRpbWVyLnByb3RvdHlwZSA9IHRpbWVyLnByb3RvdHlwZSA9IHtcbiAgY29uc3RydWN0b3I6IFRpbWVyLFxuICByZXN0YXJ0OiBmdW5jdGlvbihjYWxsYmFjaywgZGVsYXksIHRpbWUpIHtcbiAgICBpZiAodHlwZW9mIGNhbGxiYWNrICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJjYWxsYmFjayBpcyBub3QgYSBmdW5jdGlvblwiKTtcbiAgICB0aW1lID0gKHRpbWUgPT0gbnVsbCA/IG5vdygpIDogK3RpbWUpICsgKGRlbGF5ID09IG51bGwgPyAwIDogK2RlbGF5KTtcbiAgICBpZiAoIXRoaXMuX25leHQgJiYgdGFza1RhaWwgIT09IHRoaXMpIHtcbiAgICAgIGlmICh0YXNrVGFpbCkgdGFza1RhaWwuX25leHQgPSB0aGlzO1xuICAgICAgZWxzZSB0YXNrSGVhZCA9IHRoaXM7XG4gICAgICB0YXNrVGFpbCA9IHRoaXM7XG4gICAgfVxuICAgIHRoaXMuX2NhbGwgPSBjYWxsYmFjaztcbiAgICB0aGlzLl90aW1lID0gdGltZTtcbiAgICBzbGVlcCgpO1xuICB9LFxuICBzdG9wOiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5fY2FsbCkge1xuICAgICAgdGhpcy5fY2FsbCA9IG51bGw7XG4gICAgICB0aGlzLl90aW1lID0gSW5maW5pdHk7XG4gICAgICBzbGVlcCgpO1xuICAgIH1cbiAgfVxufTtcblxuZXhwb3J0IGZ1bmN0aW9uIHRpbWVyKGNhbGxiYWNrLCBkZWxheSwgdGltZSkge1xuICB2YXIgdCA9IG5ldyBUaW1lcjtcbiAgdC5yZXN0YXJ0KGNhbGxiYWNrLCBkZWxheSwgdGltZSk7XG4gIHJldHVybiB0O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gdGltZXJGbHVzaCgpIHtcbiAgbm93KCk7IC8vIEdldCB0aGUgY3VycmVudCB0aW1lLCBpZiBub3QgYWxyZWFkeSBzZXQuXG4gICsrZnJhbWU7IC8vIFByZXRlbmQgd2VcdTIwMTl2ZSBzZXQgYW4gYWxhcm0sIGlmIHdlIGhhdmVuXHUyMDE5dCBhbHJlYWR5LlxuICB2YXIgdCA9IHRhc2tIZWFkLCBlO1xuICB3aGlsZSAodCkge1xuICAgIGlmICgoZSA9IGNsb2NrTm93IC0gdC5fdGltZSkgPj0gMCkgdC5fY2FsbC5jYWxsKHVuZGVmaW5lZCwgZSk7XG4gICAgdCA9IHQuX25leHQ7XG4gIH1cbiAgLS1mcmFtZTtcbn1cblxuZnVuY3Rpb24gd2FrZSgpIHtcbiAgY2xvY2tOb3cgPSAoY2xvY2tMYXN0ID0gY2xvY2subm93KCkpICsgY2xvY2tTa2V3O1xuICBmcmFtZSA9IHRpbWVvdXQgPSAwO1xuICB0cnkge1xuICAgIHRpbWVyRmx1c2goKTtcbiAgfSBmaW5hbGx5IHtcbiAgICBmcmFtZSA9IDA7XG4gICAgbmFwKCk7XG4gICAgY2xvY2tOb3cgPSAwO1xuICB9XG59XG5cbmZ1bmN0aW9uIHBva2UoKSB7XG4gIHZhciBub3cgPSBjbG9jay5ub3coKSwgZGVsYXkgPSBub3cgLSBjbG9ja0xhc3Q7XG4gIGlmIChkZWxheSA+IHBva2VEZWxheSkgY2xvY2tTa2V3IC09IGRlbGF5LCBjbG9ja0xhc3QgPSBub3c7XG59XG5cbmZ1bmN0aW9uIG5hcCgpIHtcbiAgdmFyIHQwLCB0MSA9IHRhc2tIZWFkLCB0MiwgdGltZSA9IEluZmluaXR5O1xuICB3aGlsZSAodDEpIHtcbiAgICBpZiAodDEuX2NhbGwpIHtcbiAgICAgIGlmICh0aW1lID4gdDEuX3RpbWUpIHRpbWUgPSB0MS5fdGltZTtcbiAgICAgIHQwID0gdDEsIHQxID0gdDEuX25leHQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIHQyID0gdDEuX25leHQsIHQxLl9uZXh0ID0gbnVsbDtcbiAgICAgIHQxID0gdDAgPyB0MC5fbmV4dCA9IHQyIDogdGFza0hlYWQgPSB0MjtcbiAgICB9XG4gIH1cbiAgdGFza1RhaWwgPSB0MDtcbiAgc2xlZXAodGltZSk7XG59XG5cbmZ1bmN0aW9uIHNsZWVwKHRpbWUpIHtcbiAgaWYgKGZyYW1lKSByZXR1cm47IC8vIFNvb25lc3QgYWxhcm0gYWxyZWFkeSBzZXQsIG9yIHdpbGwgYmUuXG4gIGlmICh0aW1lb3V0KSB0aW1lb3V0ID0gY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuICB2YXIgZGVsYXkgPSB0aW1lIC0gY2xvY2tOb3c7IC8vIFN0cmljdGx5IGxlc3MgdGhhbiBpZiB3ZSByZWNvbXB1dGVkIGNsb2NrTm93LlxuICBpZiAoZGVsYXkgPiAyNCkge1xuICAgIGlmICh0aW1lIDwgSW5maW5pdHkpIHRpbWVvdXQgPSBzZXRUaW1lb3V0KHdha2UsIHRpbWUgLSBjbG9jay5ub3coKSAtIGNsb2NrU2tldyk7XG4gICAgaWYgKGludGVydmFsKSBpbnRlcnZhbCA9IGNsZWFySW50ZXJ2YWwoaW50ZXJ2YWwpO1xuICB9IGVsc2Uge1xuICAgIGlmICghaW50ZXJ2YWwpIGNsb2NrTGFzdCA9IGNsb2NrLm5vdygpLCBpbnRlcnZhbCA9IHNldEludGVydmFsKHBva2UsIHBva2VEZWxheSk7XG4gICAgZnJhbWUgPSAxLCBzZXRGcmFtZSh3YWtlKTtcbiAgfVxufVxuIiwgImltcG9ydCB7VGltZXJ9IGZyb20gXCIuL3RpbWVyLmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGNhbGxiYWNrLCBkZWxheSwgdGltZSkge1xuICB2YXIgdCA9IG5ldyBUaW1lcjtcbiAgZGVsYXkgPSBkZWxheSA9PSBudWxsID8gMCA6ICtkZWxheTtcbiAgdC5yZXN0YXJ0KGVsYXBzZWQgPT4ge1xuICAgIHQuc3RvcCgpO1xuICAgIGNhbGxiYWNrKGVsYXBzZWQgKyBkZWxheSk7XG4gIH0sIGRlbGF5LCB0aW1lKTtcbiAgcmV0dXJuIHQ7XG59XG4iLCAiaW1wb3J0IHtkaXNwYXRjaH0gZnJvbSBcImQzLWRpc3BhdGNoXCI7XG5pbXBvcnQge3RpbWVyLCB0aW1lb3V0fSBmcm9tIFwiZDMtdGltZXJcIjtcblxudmFyIGVtcHR5T24gPSBkaXNwYXRjaChcInN0YXJ0XCIsIFwiZW5kXCIsIFwiY2FuY2VsXCIsIFwiaW50ZXJydXB0XCIpO1xudmFyIGVtcHR5VHdlZW4gPSBbXTtcblxuZXhwb3J0IHZhciBDUkVBVEVEID0gMDtcbmV4cG9ydCB2YXIgU0NIRURVTEVEID0gMTtcbmV4cG9ydCB2YXIgU1RBUlRJTkcgPSAyO1xuZXhwb3J0IHZhciBTVEFSVEVEID0gMztcbmV4cG9ydCB2YXIgUlVOTklORyA9IDQ7XG5leHBvcnQgdmFyIEVORElORyA9IDU7XG5leHBvcnQgdmFyIEVOREVEID0gNjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obm9kZSwgbmFtZSwgaWQsIGluZGV4LCBncm91cCwgdGltaW5nKSB7XG4gIHZhciBzY2hlZHVsZXMgPSBub2RlLl9fdHJhbnNpdGlvbjtcbiAgaWYgKCFzY2hlZHVsZXMpIG5vZGUuX190cmFuc2l0aW9uID0ge307XG4gIGVsc2UgaWYgKGlkIGluIHNjaGVkdWxlcykgcmV0dXJuO1xuICBjcmVhdGUobm9kZSwgaWQsIHtcbiAgICBuYW1lOiBuYW1lLFxuICAgIGluZGV4OiBpbmRleCwgLy8gRm9yIGNvbnRleHQgZHVyaW5nIGNhbGxiYWNrLlxuICAgIGdyb3VwOiBncm91cCwgLy8gRm9yIGNvbnRleHQgZHVyaW5nIGNhbGxiYWNrLlxuICAgIG9uOiBlbXB0eU9uLFxuICAgIHR3ZWVuOiBlbXB0eVR3ZWVuLFxuICAgIHRpbWU6IHRpbWluZy50aW1lLFxuICAgIGRlbGF5OiB0aW1pbmcuZGVsYXksXG4gICAgZHVyYXRpb246IHRpbWluZy5kdXJhdGlvbixcbiAgICBlYXNlOiB0aW1pbmcuZWFzZSxcbiAgICB0aW1lcjogbnVsbCxcbiAgICBzdGF0ZTogQ1JFQVRFRFxuICB9KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGluaXQobm9kZSwgaWQpIHtcbiAgdmFyIHNjaGVkdWxlID0gZ2V0KG5vZGUsIGlkKTtcbiAgaWYgKHNjaGVkdWxlLnN0YXRlID4gQ1JFQVRFRCkgdGhyb3cgbmV3IEVycm9yKFwidG9vIGxhdGU7IGFscmVhZHkgc2NoZWR1bGVkXCIpO1xuICByZXR1cm4gc2NoZWR1bGU7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzZXQobm9kZSwgaWQpIHtcbiAgdmFyIHNjaGVkdWxlID0gZ2V0KG5vZGUsIGlkKTtcbiAgaWYgKHNjaGVkdWxlLnN0YXRlID4gU1RBUlRFRCkgdGhyb3cgbmV3IEVycm9yKFwidG9vIGxhdGU7IGFscmVhZHkgcnVubmluZ1wiKTtcbiAgcmV0dXJuIHNjaGVkdWxlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0KG5vZGUsIGlkKSB7XG4gIHZhciBzY2hlZHVsZSA9IG5vZGUuX190cmFuc2l0aW9uO1xuICBpZiAoIXNjaGVkdWxlIHx8ICEoc2NoZWR1bGUgPSBzY2hlZHVsZVtpZF0pKSB0aHJvdyBuZXcgRXJyb3IoXCJ0cmFuc2l0aW9uIG5vdCBmb3VuZFwiKTtcbiAgcmV0dXJuIHNjaGVkdWxlO1xufVxuXG5mdW5jdGlvbiBjcmVhdGUobm9kZSwgaWQsIHNlbGYpIHtcbiAgdmFyIHNjaGVkdWxlcyA9IG5vZGUuX190cmFuc2l0aW9uLFxuICAgICAgdHdlZW47XG5cbiAgLy8gSW5pdGlhbGl6ZSB0aGUgc2VsZiB0aW1lciB3aGVuIHRoZSB0cmFuc2l0aW9uIGlzIGNyZWF0ZWQuXG4gIC8vIE5vdGUgdGhlIGFjdHVhbCBkZWxheSBpcyBub3Qga25vd24gdW50aWwgdGhlIGZpcnN0IGNhbGxiYWNrIVxuICBzY2hlZHVsZXNbaWRdID0gc2VsZjtcbiAgc2VsZi50aW1lciA9IHRpbWVyKHNjaGVkdWxlLCAwLCBzZWxmLnRpbWUpO1xuXG4gIGZ1bmN0aW9uIHNjaGVkdWxlKGVsYXBzZWQpIHtcbiAgICBzZWxmLnN0YXRlID0gU0NIRURVTEVEO1xuICAgIHNlbGYudGltZXIucmVzdGFydChzdGFydCwgc2VsZi5kZWxheSwgc2VsZi50aW1lKTtcblxuICAgIC8vIElmIHRoZSBlbGFwc2VkIGRlbGF5IGlzIGxlc3MgdGhhbiBvdXIgZmlyc3Qgc2xlZXAsIHN0YXJ0IGltbWVkaWF0ZWx5LlxuICAgIGlmIChzZWxmLmRlbGF5IDw9IGVsYXBzZWQpIHN0YXJ0KGVsYXBzZWQgLSBzZWxmLmRlbGF5KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHN0YXJ0KGVsYXBzZWQpIHtcbiAgICB2YXIgaSwgaiwgbiwgbztcblxuICAgIC8vIElmIHRoZSBzdGF0ZSBpcyBub3QgU0NIRURVTEVELCB0aGVuIHdlIHByZXZpb3VzbHkgZXJyb3JlZCBvbiBzdGFydC5cbiAgICBpZiAoc2VsZi5zdGF0ZSAhPT0gU0NIRURVTEVEKSByZXR1cm4gc3RvcCgpO1xuXG4gICAgZm9yIChpIGluIHNjaGVkdWxlcykge1xuICAgICAgbyA9IHNjaGVkdWxlc1tpXTtcbiAgICAgIGlmIChvLm5hbWUgIT09IHNlbGYubmFtZSkgY29udGludWU7XG5cbiAgICAgIC8vIFdoaWxlIHRoaXMgZWxlbWVudCBhbHJlYWR5IGhhcyBhIHN0YXJ0aW5nIHRyYW5zaXRpb24gZHVyaW5nIHRoaXMgZnJhbWUsXG4gICAgICAvLyBkZWZlciBzdGFydGluZyBhbiBpbnRlcnJ1cHRpbmcgdHJhbnNpdGlvbiB1bnRpbCB0aGF0IHRyYW5zaXRpb24gaGFzIGFcbiAgICAgIC8vIGNoYW5jZSB0byB0aWNrIChhbmQgcG9zc2libHkgZW5kKTsgc2VlIGQzL2QzLXRyYW5zaXRpb24jNTQhXG4gICAgICBpZiAoby5zdGF0ZSA9PT0gU1RBUlRFRCkgcmV0dXJuIHRpbWVvdXQoc3RhcnQpO1xuXG4gICAgICAvLyBJbnRlcnJ1cHQgdGhlIGFjdGl2ZSB0cmFuc2l0aW9uLCBpZiBhbnkuXG4gICAgICBpZiAoby5zdGF0ZSA9PT0gUlVOTklORykge1xuICAgICAgICBvLnN0YXRlID0gRU5ERUQ7XG4gICAgICAgIG8udGltZXIuc3RvcCgpO1xuICAgICAgICBvLm9uLmNhbGwoXCJpbnRlcnJ1cHRcIiwgbm9kZSwgbm9kZS5fX2RhdGFfXywgby5pbmRleCwgby5ncm91cCk7XG4gICAgICAgIGRlbGV0ZSBzY2hlZHVsZXNbaV07XG4gICAgICB9XG5cbiAgICAgIC8vIENhbmNlbCBhbnkgcHJlLWVtcHRlZCB0cmFuc2l0aW9ucy5cbiAgICAgIGVsc2UgaWYgKCtpIDwgaWQpIHtcbiAgICAgICAgby5zdGF0ZSA9IEVOREVEO1xuICAgICAgICBvLnRpbWVyLnN0b3AoKTtcbiAgICAgICAgby5vbi5jYWxsKFwiY2FuY2VsXCIsIG5vZGUsIG5vZGUuX19kYXRhX18sIG8uaW5kZXgsIG8uZ3JvdXApO1xuICAgICAgICBkZWxldGUgc2NoZWR1bGVzW2ldO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIERlZmVyIHRoZSBmaXJzdCB0aWNrIHRvIGVuZCBvZiB0aGUgY3VycmVudCBmcmFtZTsgc2VlIGQzL2QzIzE1NzYuXG4gICAgLy8gTm90ZSB0aGUgdHJhbnNpdGlvbiBtYXkgYmUgY2FuY2VsZWQgYWZ0ZXIgc3RhcnQgYW5kIGJlZm9yZSB0aGUgZmlyc3QgdGljayFcbiAgICAvLyBOb3RlIHRoaXMgbXVzdCBiZSBzY2hlZHVsZWQgYmVmb3JlIHRoZSBzdGFydCBldmVudDsgc2VlIGQzL2QzLXRyYW5zaXRpb24jMTYhXG4gICAgLy8gQXNzdW1pbmcgdGhpcyBpcyBzdWNjZXNzZnVsLCBzdWJzZXF1ZW50IGNhbGxiYWNrcyBnbyBzdHJhaWdodCB0byB0aWNrLlxuICAgIHRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICBpZiAoc2VsZi5zdGF0ZSA9PT0gU1RBUlRFRCkge1xuICAgICAgICBzZWxmLnN0YXRlID0gUlVOTklORztcbiAgICAgICAgc2VsZi50aW1lci5yZXN0YXJ0KHRpY2ssIHNlbGYuZGVsYXksIHNlbGYudGltZSk7XG4gICAgICAgIHRpY2soZWxhcHNlZCk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBEaXNwYXRjaCB0aGUgc3RhcnQgZXZlbnQuXG4gICAgLy8gTm90ZSB0aGlzIG11c3QgYmUgZG9uZSBiZWZvcmUgdGhlIHR3ZWVuIGFyZSBpbml0aWFsaXplZC5cbiAgICBzZWxmLnN0YXRlID0gU1RBUlRJTkc7XG4gICAgc2VsZi5vbi5jYWxsKFwic3RhcnRcIiwgbm9kZSwgbm9kZS5fX2RhdGFfXywgc2VsZi5pbmRleCwgc2VsZi5ncm91cCk7XG4gICAgaWYgKHNlbGYuc3RhdGUgIT09IFNUQVJUSU5HKSByZXR1cm47IC8vIGludGVycnVwdGVkXG4gICAgc2VsZi5zdGF0ZSA9IFNUQVJURUQ7XG5cbiAgICAvLyBJbml0aWFsaXplIHRoZSB0d2VlbiwgZGVsZXRpbmcgbnVsbCB0d2Vlbi5cbiAgICB0d2VlbiA9IG5ldyBBcnJheShuID0gc2VsZi50d2Vlbi5sZW5ndGgpO1xuICAgIGZvciAoaSA9IDAsIGogPSAtMTsgaSA8IG47ICsraSkge1xuICAgICAgaWYgKG8gPSBzZWxmLnR3ZWVuW2ldLnZhbHVlLmNhbGwobm9kZSwgbm9kZS5fX2RhdGFfXywgc2VsZi5pbmRleCwgc2VsZi5ncm91cCkpIHtcbiAgICAgICAgdHdlZW5bKytqXSA9IG87XG4gICAgICB9XG4gICAgfVxuICAgIHR3ZWVuLmxlbmd0aCA9IGogKyAxO1xuICB9XG5cbiAgZnVuY3Rpb24gdGljayhlbGFwc2VkKSB7XG4gICAgdmFyIHQgPSBlbGFwc2VkIDwgc2VsZi5kdXJhdGlvbiA/IHNlbGYuZWFzZS5jYWxsKG51bGwsIGVsYXBzZWQgLyBzZWxmLmR1cmF0aW9uKSA6IChzZWxmLnRpbWVyLnJlc3RhcnQoc3RvcCksIHNlbGYuc3RhdGUgPSBFTkRJTkcsIDEpLFxuICAgICAgICBpID0gLTEsXG4gICAgICAgIG4gPSB0d2Vlbi5sZW5ndGg7XG5cbiAgICB3aGlsZSAoKytpIDwgbikge1xuICAgICAgdHdlZW5baV0uY2FsbChub2RlLCB0KTtcbiAgICB9XG5cbiAgICAvLyBEaXNwYXRjaCB0aGUgZW5kIGV2ZW50LlxuICAgIGlmIChzZWxmLnN0YXRlID09PSBFTkRJTkcpIHtcbiAgICAgIHNlbGYub24uY2FsbChcImVuZFwiLCBub2RlLCBub2RlLl9fZGF0YV9fLCBzZWxmLmluZGV4LCBzZWxmLmdyb3VwKTtcbiAgICAgIHN0b3AoKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBzdG9wKCkge1xuICAgIHNlbGYuc3RhdGUgPSBFTkRFRDtcbiAgICBzZWxmLnRpbWVyLnN0b3AoKTtcbiAgICBkZWxldGUgc2NoZWR1bGVzW2lkXTtcbiAgICBmb3IgKHZhciBpIGluIHNjaGVkdWxlcykgcmV0dXJuOyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgZGVsZXRlIG5vZGUuX190cmFuc2l0aW9uO1xuICB9XG59XG4iLCAiaW1wb3J0IHtTVEFSVElORywgRU5ESU5HLCBFTkRFRH0gZnJvbSBcIi4vdHJhbnNpdGlvbi9zY2hlZHVsZS5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihub2RlLCBuYW1lKSB7XG4gIHZhciBzY2hlZHVsZXMgPSBub2RlLl9fdHJhbnNpdGlvbixcbiAgICAgIHNjaGVkdWxlLFxuICAgICAgYWN0aXZlLFxuICAgICAgZW1wdHkgPSB0cnVlLFxuICAgICAgaTtcblxuICBpZiAoIXNjaGVkdWxlcykgcmV0dXJuO1xuXG4gIG5hbWUgPSBuYW1lID09IG51bGwgPyBudWxsIDogbmFtZSArIFwiXCI7XG5cbiAgZm9yIChpIGluIHNjaGVkdWxlcykge1xuICAgIGlmICgoc2NoZWR1bGUgPSBzY2hlZHVsZXNbaV0pLm5hbWUgIT09IG5hbWUpIHsgZW1wdHkgPSBmYWxzZTsgY29udGludWU7IH1cbiAgICBhY3RpdmUgPSBzY2hlZHVsZS5zdGF0ZSA+IFNUQVJUSU5HICYmIHNjaGVkdWxlLnN0YXRlIDwgRU5ESU5HO1xuICAgIHNjaGVkdWxlLnN0YXRlID0gRU5ERUQ7XG4gICAgc2NoZWR1bGUudGltZXIuc3RvcCgpO1xuICAgIHNjaGVkdWxlLm9uLmNhbGwoYWN0aXZlID8gXCJpbnRlcnJ1cHRcIiA6IFwiY2FuY2VsXCIsIG5vZGUsIG5vZGUuX19kYXRhX18sIHNjaGVkdWxlLmluZGV4LCBzY2hlZHVsZS5ncm91cCk7XG4gICAgZGVsZXRlIHNjaGVkdWxlc1tpXTtcbiAgfVxuXG4gIGlmIChlbXB0eSkgZGVsZXRlIG5vZGUuX190cmFuc2l0aW9uO1xufVxuIiwgImltcG9ydCBpbnRlcnJ1cHQgZnJvbSBcIi4uL2ludGVycnVwdC5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihuYW1lKSB7XG4gIHJldHVybiB0aGlzLmVhY2goZnVuY3Rpb24oKSB7XG4gICAgaW50ZXJydXB0KHRoaXMsIG5hbWUpO1xuICB9KTtcbn1cbiIsICJpbXBvcnQge2dldCwgc2V0fSBmcm9tIFwiLi9zY2hlZHVsZS5qc1wiO1xuXG5mdW5jdGlvbiB0d2VlblJlbW92ZShpZCwgbmFtZSkge1xuICB2YXIgdHdlZW4wLCB0d2VlbjE7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2NoZWR1bGUgPSBzZXQodGhpcywgaWQpLFxuICAgICAgICB0d2VlbiA9IHNjaGVkdWxlLnR3ZWVuO1xuXG4gICAgLy8gSWYgdGhpcyBub2RlIHNoYXJlZCB0d2VlbiB3aXRoIHRoZSBwcmV2aW91cyBub2RlLFxuICAgIC8vIGp1c3QgYXNzaWduIHRoZSB1cGRhdGVkIHNoYXJlZCB0d2VlbiBhbmQgd2VcdTIwMTlyZSBkb25lIVxuICAgIC8vIE90aGVyd2lzZSwgY29weS1vbi13cml0ZS5cbiAgICBpZiAodHdlZW4gIT09IHR3ZWVuMCkge1xuICAgICAgdHdlZW4xID0gdHdlZW4wID0gdHdlZW47XG4gICAgICBmb3IgKHZhciBpID0gMCwgbiA9IHR3ZWVuMS5sZW5ndGg7IGkgPCBuOyArK2kpIHtcbiAgICAgICAgaWYgKHR3ZWVuMVtpXS5uYW1lID09PSBuYW1lKSB7XG4gICAgICAgICAgdHdlZW4xID0gdHdlZW4xLnNsaWNlKCk7XG4gICAgICAgICAgdHdlZW4xLnNwbGljZShpLCAxKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHNjaGVkdWxlLnR3ZWVuID0gdHdlZW4xO1xuICB9O1xufVxuXG5mdW5jdGlvbiB0d2VlbkZ1bmN0aW9uKGlkLCBuYW1lLCB2YWx1ZSkge1xuICB2YXIgdHdlZW4wLCB0d2VlbjE7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yO1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNjaGVkdWxlID0gc2V0KHRoaXMsIGlkKSxcbiAgICAgICAgdHdlZW4gPSBzY2hlZHVsZS50d2VlbjtcblxuICAgIC8vIElmIHRoaXMgbm9kZSBzaGFyZWQgdHdlZW4gd2l0aCB0aGUgcHJldmlvdXMgbm9kZSxcbiAgICAvLyBqdXN0IGFzc2lnbiB0aGUgdXBkYXRlZCBzaGFyZWQgdHdlZW4gYW5kIHdlXHUyMDE5cmUgZG9uZSFcbiAgICAvLyBPdGhlcndpc2UsIGNvcHktb24td3JpdGUuXG4gICAgaWYgKHR3ZWVuICE9PSB0d2VlbjApIHtcbiAgICAgIHR3ZWVuMSA9ICh0d2VlbjAgPSB0d2Vlbikuc2xpY2UoKTtcbiAgICAgIGZvciAodmFyIHQgPSB7bmFtZTogbmFtZSwgdmFsdWU6IHZhbHVlfSwgaSA9IDAsIG4gPSB0d2VlbjEubGVuZ3RoOyBpIDwgbjsgKytpKSB7XG4gICAgICAgIGlmICh0d2VlbjFbaV0ubmFtZSA9PT0gbmFtZSkge1xuICAgICAgICAgIHR3ZWVuMVtpXSA9IHQ7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChpID09PSBuKSB0d2VlbjEucHVzaCh0KTtcbiAgICB9XG5cbiAgICBzY2hlZHVsZS50d2VlbiA9IHR3ZWVuMTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSwgdmFsdWUpIHtcbiAgdmFyIGlkID0gdGhpcy5faWQ7XG5cbiAgbmFtZSArPSBcIlwiO1xuXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoIDwgMikge1xuICAgIHZhciB0d2VlbiA9IGdldCh0aGlzLm5vZGUoKSwgaWQpLnR3ZWVuO1xuICAgIGZvciAodmFyIGkgPSAwLCBuID0gdHdlZW4ubGVuZ3RoLCB0OyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAoKHQgPSB0d2VlbltpXSkubmFtZSA9PT0gbmFtZSkge1xuICAgICAgICByZXR1cm4gdC52YWx1ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICByZXR1cm4gdGhpcy5lYWNoKCh2YWx1ZSA9PSBudWxsID8gdHdlZW5SZW1vdmUgOiB0d2VlbkZ1bmN0aW9uKShpZCwgbmFtZSwgdmFsdWUpKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHR3ZWVuVmFsdWUodHJhbnNpdGlvbiwgbmFtZSwgdmFsdWUpIHtcbiAgdmFyIGlkID0gdHJhbnNpdGlvbi5faWQ7XG5cbiAgdHJhbnNpdGlvbi5lYWNoKGZ1bmN0aW9uKCkge1xuICAgIHZhciBzY2hlZHVsZSA9IHNldCh0aGlzLCBpZCk7XG4gICAgKHNjaGVkdWxlLnZhbHVlIHx8IChzY2hlZHVsZS52YWx1ZSA9IHt9KSlbbmFtZV0gPSB2YWx1ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICB9KTtcblxuICByZXR1cm4gZnVuY3Rpb24obm9kZSkge1xuICAgIHJldHVybiBnZXQobm9kZSwgaWQpLnZhbHVlW25hbWVdO1xuICB9O1xufVxuIiwgImltcG9ydCB7Y29sb3J9IGZyb20gXCJkMy1jb2xvclwiO1xuaW1wb3J0IHtpbnRlcnBvbGF0ZU51bWJlciwgaW50ZXJwb2xhdGVSZ2IsIGludGVycG9sYXRlU3RyaW5nfSBmcm9tIFwiZDMtaW50ZXJwb2xhdGVcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oYSwgYikge1xuICB2YXIgYztcbiAgcmV0dXJuICh0eXBlb2YgYiA9PT0gXCJudW1iZXJcIiA/IGludGVycG9sYXRlTnVtYmVyXG4gICAgICA6IGIgaW5zdGFuY2VvZiBjb2xvciA/IGludGVycG9sYXRlUmdiXG4gICAgICA6IChjID0gY29sb3IoYikpID8gKGIgPSBjLCBpbnRlcnBvbGF0ZVJnYilcbiAgICAgIDogaW50ZXJwb2xhdGVTdHJpbmcpKGEsIGIpO1xufVxuIiwgImltcG9ydCB7aW50ZXJwb2xhdGVUcmFuc2Zvcm1TdmcgYXMgaW50ZXJwb2xhdGVUcmFuc2Zvcm19IGZyb20gXCJkMy1pbnRlcnBvbGF0ZVwiO1xuaW1wb3J0IHtuYW1lc3BhY2V9IGZyb20gXCJkMy1zZWxlY3Rpb25cIjtcbmltcG9ydCB7dHdlZW5WYWx1ZX0gZnJvbSBcIi4vdHdlZW4uanNcIjtcbmltcG9ydCBpbnRlcnBvbGF0ZSBmcm9tIFwiLi9pbnRlcnBvbGF0ZS5qc1wiO1xuXG5mdW5jdGlvbiBhdHRyUmVtb3ZlKG5hbWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHRoaXMucmVtb3ZlQXR0cmlidXRlKG5hbWUpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBhdHRyUmVtb3ZlTlMoZnVsbG5hbWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHRoaXMucmVtb3ZlQXR0cmlidXRlTlMoZnVsbG5hbWUuc3BhY2UsIGZ1bGxuYW1lLmxvY2FsKTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gYXR0ckNvbnN0YW50KG5hbWUsIGludGVycG9sYXRlLCB2YWx1ZTEpIHtcbiAgdmFyIHN0cmluZzAwLFxuICAgICAgc3RyaW5nMSA9IHZhbHVlMSArIFwiXCIsXG4gICAgICBpbnRlcnBvbGF0ZTA7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc3RyaW5nMCA9IHRoaXMuZ2V0QXR0cmlidXRlKG5hbWUpO1xuICAgIHJldHVybiBzdHJpbmcwID09PSBzdHJpbmcxID8gbnVsbFxuICAgICAgICA6IHN0cmluZzAgPT09IHN0cmluZzAwID8gaW50ZXJwb2xhdGUwXG4gICAgICAgIDogaW50ZXJwb2xhdGUwID0gaW50ZXJwb2xhdGUoc3RyaW5nMDAgPSBzdHJpbmcwLCB2YWx1ZTEpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBhdHRyQ29uc3RhbnROUyhmdWxsbmFtZSwgaW50ZXJwb2xhdGUsIHZhbHVlMSkge1xuICB2YXIgc3RyaW5nMDAsXG4gICAgICBzdHJpbmcxID0gdmFsdWUxICsgXCJcIixcbiAgICAgIGludGVycG9sYXRlMDtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBzdHJpbmcwID0gdGhpcy5nZXRBdHRyaWJ1dGVOUyhmdWxsbmFtZS5zcGFjZSwgZnVsbG5hbWUubG9jYWwpO1xuICAgIHJldHVybiBzdHJpbmcwID09PSBzdHJpbmcxID8gbnVsbFxuICAgICAgICA6IHN0cmluZzAgPT09IHN0cmluZzAwID8gaW50ZXJwb2xhdGUwXG4gICAgICAgIDogaW50ZXJwb2xhdGUwID0gaW50ZXJwb2xhdGUoc3RyaW5nMDAgPSBzdHJpbmcwLCB2YWx1ZTEpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBhdHRyRnVuY3Rpb24obmFtZSwgaW50ZXJwb2xhdGUsIHZhbHVlKSB7XG4gIHZhciBzdHJpbmcwMCxcbiAgICAgIHN0cmluZzEwLFxuICAgICAgaW50ZXJwb2xhdGUwO1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHN0cmluZzAsIHZhbHVlMSA9IHZhbHVlKHRoaXMpLCBzdHJpbmcxO1xuICAgIGlmICh2YWx1ZTEgPT0gbnVsbCkgcmV0dXJuIHZvaWQgdGhpcy5yZW1vdmVBdHRyaWJ1dGUobmFtZSk7XG4gICAgc3RyaW5nMCA9IHRoaXMuZ2V0QXR0cmlidXRlKG5hbWUpO1xuICAgIHN0cmluZzEgPSB2YWx1ZTEgKyBcIlwiO1xuICAgIHJldHVybiBzdHJpbmcwID09PSBzdHJpbmcxID8gbnVsbFxuICAgICAgICA6IHN0cmluZzAgPT09IHN0cmluZzAwICYmIHN0cmluZzEgPT09IHN0cmluZzEwID8gaW50ZXJwb2xhdGUwXG4gICAgICAgIDogKHN0cmluZzEwID0gc3RyaW5nMSwgaW50ZXJwb2xhdGUwID0gaW50ZXJwb2xhdGUoc3RyaW5nMDAgPSBzdHJpbmcwLCB2YWx1ZTEpKTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gYXR0ckZ1bmN0aW9uTlMoZnVsbG5hbWUsIGludGVycG9sYXRlLCB2YWx1ZSkge1xuICB2YXIgc3RyaW5nMDAsXG4gICAgICBzdHJpbmcxMCxcbiAgICAgIGludGVycG9sYXRlMDtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBzdHJpbmcwLCB2YWx1ZTEgPSB2YWx1ZSh0aGlzKSwgc3RyaW5nMTtcbiAgICBpZiAodmFsdWUxID09IG51bGwpIHJldHVybiB2b2lkIHRoaXMucmVtb3ZlQXR0cmlidXRlTlMoZnVsbG5hbWUuc3BhY2UsIGZ1bGxuYW1lLmxvY2FsKTtcbiAgICBzdHJpbmcwID0gdGhpcy5nZXRBdHRyaWJ1dGVOUyhmdWxsbmFtZS5zcGFjZSwgZnVsbG5hbWUubG9jYWwpO1xuICAgIHN0cmluZzEgPSB2YWx1ZTEgKyBcIlwiO1xuICAgIHJldHVybiBzdHJpbmcwID09PSBzdHJpbmcxID8gbnVsbFxuICAgICAgICA6IHN0cmluZzAgPT09IHN0cmluZzAwICYmIHN0cmluZzEgPT09IHN0cmluZzEwID8gaW50ZXJwb2xhdGUwXG4gICAgICAgIDogKHN0cmluZzEwID0gc3RyaW5nMSwgaW50ZXJwb2xhdGUwID0gaW50ZXJwb2xhdGUoc3RyaW5nMDAgPSBzdHJpbmcwLCB2YWx1ZTEpKTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSwgdmFsdWUpIHtcbiAgdmFyIGZ1bGxuYW1lID0gbmFtZXNwYWNlKG5hbWUpLCBpID0gZnVsbG5hbWUgPT09IFwidHJhbnNmb3JtXCIgPyBpbnRlcnBvbGF0ZVRyYW5zZm9ybSA6IGludGVycG9sYXRlO1xuICByZXR1cm4gdGhpcy5hdHRyVHdlZW4obmFtZSwgdHlwZW9mIHZhbHVlID09PSBcImZ1bmN0aW9uXCJcbiAgICAgID8gKGZ1bGxuYW1lLmxvY2FsID8gYXR0ckZ1bmN0aW9uTlMgOiBhdHRyRnVuY3Rpb24pKGZ1bGxuYW1lLCBpLCB0d2VlblZhbHVlKHRoaXMsIFwiYXR0ci5cIiArIG5hbWUsIHZhbHVlKSlcbiAgICAgIDogdmFsdWUgPT0gbnVsbCA/IChmdWxsbmFtZS5sb2NhbCA/IGF0dHJSZW1vdmVOUyA6IGF0dHJSZW1vdmUpKGZ1bGxuYW1lKVxuICAgICAgOiAoZnVsbG5hbWUubG9jYWwgPyBhdHRyQ29uc3RhbnROUyA6IGF0dHJDb25zdGFudCkoZnVsbG5hbWUsIGksIHZhbHVlKSk7XG59XG4iLCAiaW1wb3J0IHtuYW1lc3BhY2V9IGZyb20gXCJkMy1zZWxlY3Rpb25cIjtcblxuZnVuY3Rpb24gYXR0ckludGVycG9sYXRlKG5hbWUsIGkpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKHQpIHtcbiAgICB0aGlzLnNldEF0dHJpYnV0ZShuYW1lLCBpLmNhbGwodGhpcywgdCkpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBhdHRySW50ZXJwb2xhdGVOUyhmdWxsbmFtZSwgaSkge1xuICByZXR1cm4gZnVuY3Rpb24odCkge1xuICAgIHRoaXMuc2V0QXR0cmlidXRlTlMoZnVsbG5hbWUuc3BhY2UsIGZ1bGxuYW1lLmxvY2FsLCBpLmNhbGwodGhpcywgdCkpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBhdHRyVHdlZW5OUyhmdWxsbmFtZSwgdmFsdWUpIHtcbiAgdmFyIHQwLCBpMDtcbiAgZnVuY3Rpb24gdHdlZW4oKSB7XG4gICAgdmFyIGkgPSB2YWx1ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIGlmIChpICE9PSBpMCkgdDAgPSAoaTAgPSBpKSAmJiBhdHRySW50ZXJwb2xhdGVOUyhmdWxsbmFtZSwgaSk7XG4gICAgcmV0dXJuIHQwO1xuICB9XG4gIHR3ZWVuLl92YWx1ZSA9IHZhbHVlO1xuICByZXR1cm4gdHdlZW47XG59XG5cbmZ1bmN0aW9uIGF0dHJUd2VlbihuYW1lLCB2YWx1ZSkge1xuICB2YXIgdDAsIGkwO1xuICBmdW5jdGlvbiB0d2VlbigpIHtcbiAgICB2YXIgaSA9IHZhbHVlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgaWYgKGkgIT09IGkwKSB0MCA9IChpMCA9IGkpICYmIGF0dHJJbnRlcnBvbGF0ZShuYW1lLCBpKTtcbiAgICByZXR1cm4gdDA7XG4gIH1cbiAgdHdlZW4uX3ZhbHVlID0gdmFsdWU7XG4gIHJldHVybiB0d2Vlbjtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSwgdmFsdWUpIHtcbiAgdmFyIGtleSA9IFwiYXR0ci5cIiArIG5hbWU7XG4gIGlmIChhcmd1bWVudHMubGVuZ3RoIDwgMikgcmV0dXJuIChrZXkgPSB0aGlzLnR3ZWVuKGtleSkpICYmIGtleS5fdmFsdWU7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gdGhpcy50d2VlbihrZXksIG51bGwpO1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcjtcbiAgdmFyIGZ1bGxuYW1lID0gbmFtZXNwYWNlKG5hbWUpO1xuICByZXR1cm4gdGhpcy50d2VlbihrZXksIChmdWxsbmFtZS5sb2NhbCA/IGF0dHJUd2Vlbk5TIDogYXR0clR3ZWVuKShmdWxsbmFtZSwgdmFsdWUpKTtcbn1cbiIsICJpbXBvcnQge2dldCwgaW5pdH0gZnJvbSBcIi4vc2NoZWR1bGUuanNcIjtcblxuZnVuY3Rpb24gZGVsYXlGdW5jdGlvbihpZCwgdmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIGluaXQodGhpcywgaWQpLmRlbGF5ID0gK3ZhbHVlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGRlbGF5Q29uc3RhbnQoaWQsIHZhbHVlKSB7XG4gIHJldHVybiB2YWx1ZSA9ICt2YWx1ZSwgZnVuY3Rpb24oKSB7XG4gICAgaW5pdCh0aGlzLCBpZCkuZGVsYXkgPSB2YWx1ZTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24odmFsdWUpIHtcbiAgdmFyIGlkID0gdGhpcy5faWQ7XG5cbiAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGhcbiAgICAgID8gdGhpcy5lYWNoKCh0eXBlb2YgdmFsdWUgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgICAgID8gZGVsYXlGdW5jdGlvblxuICAgICAgICAgIDogZGVsYXlDb25zdGFudCkoaWQsIHZhbHVlKSlcbiAgICAgIDogZ2V0KHRoaXMubm9kZSgpLCBpZCkuZGVsYXk7XG59XG4iLCAiaW1wb3J0IHtnZXQsIHNldH0gZnJvbSBcIi4vc2NoZWR1bGUuanNcIjtcblxuZnVuY3Rpb24gZHVyYXRpb25GdW5jdGlvbihpZCwgdmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHNldCh0aGlzLCBpZCkuZHVyYXRpb24gPSArdmFsdWUuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gZHVyYXRpb25Db25zdGFudChpZCwgdmFsdWUpIHtcbiAgcmV0dXJuIHZhbHVlID0gK3ZhbHVlLCBmdW5jdGlvbigpIHtcbiAgICBzZXQodGhpcywgaWQpLmR1cmF0aW9uID0gdmFsdWU7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHZhbHVlKSB7XG4gIHZhciBpZCA9IHRoaXMuX2lkO1xuXG4gIHJldHVybiBhcmd1bWVudHMubGVuZ3RoXG4gICAgICA/IHRoaXMuZWFjaCgodHlwZW9mIHZhbHVlID09PSBcImZ1bmN0aW9uXCJcbiAgICAgICAgICA/IGR1cmF0aW9uRnVuY3Rpb25cbiAgICAgICAgICA6IGR1cmF0aW9uQ29uc3RhbnQpKGlkLCB2YWx1ZSkpXG4gICAgICA6IGdldCh0aGlzLm5vZGUoKSwgaWQpLmR1cmF0aW9uO1xufVxuIiwgImltcG9ydCB7Z2V0LCBzZXR9IGZyb20gXCIuL3NjaGVkdWxlLmpzXCI7XG5cbmZ1bmN0aW9uIGVhc2VDb25zdGFudChpZCwgdmFsdWUpIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3I7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICBzZXQodGhpcywgaWQpLmVhc2UgPSB2YWx1ZTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24odmFsdWUpIHtcbiAgdmFyIGlkID0gdGhpcy5faWQ7XG5cbiAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGhcbiAgICAgID8gdGhpcy5lYWNoKGVhc2VDb25zdGFudChpZCwgdmFsdWUpKVxuICAgICAgOiBnZXQodGhpcy5ub2RlKCksIGlkKS5lYXNlO1xufVxuIiwgImltcG9ydCB7c2V0fSBmcm9tIFwiLi9zY2hlZHVsZS5qc1wiO1xuXG5mdW5jdGlvbiBlYXNlVmFyeWluZyhpZCwgdmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciB2ID0gdmFsdWUuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICBpZiAodHlwZW9mIHYgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yO1xuICAgIHNldCh0aGlzLCBpZCkuZWFzZSA9IHY7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHZhbHVlKSB7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yO1xuICByZXR1cm4gdGhpcy5lYWNoKGVhc2VWYXJ5aW5nKHRoaXMuX2lkLCB2YWx1ZSkpO1xufVxuIiwgImltcG9ydCB7bWF0Y2hlcn0gZnJvbSBcImQzLXNlbGVjdGlvblwiO1xuaW1wb3J0IHtUcmFuc2l0aW9ufSBmcm9tIFwiLi9pbmRleC5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihtYXRjaCkge1xuICBpZiAodHlwZW9mIG1hdGNoICE9PSBcImZ1bmN0aW9uXCIpIG1hdGNoID0gbWF0Y2hlcihtYXRjaCk7XG5cbiAgZm9yICh2YXIgZ3JvdXBzID0gdGhpcy5fZ3JvdXBzLCBtID0gZ3JvdXBzLmxlbmd0aCwgc3ViZ3JvdXBzID0gbmV3IEFycmF5KG0pLCBqID0gMDsgaiA8IG07ICsraikge1xuICAgIGZvciAodmFyIGdyb3VwID0gZ3JvdXBzW2pdLCBuID0gZ3JvdXAubGVuZ3RoLCBzdWJncm91cCA9IHN1Ymdyb3Vwc1tqXSA9IFtdLCBub2RlLCBpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgaWYgKChub2RlID0gZ3JvdXBbaV0pICYmIG1hdGNoLmNhbGwobm9kZSwgbm9kZS5fX2RhdGFfXywgaSwgZ3JvdXApKSB7XG4gICAgICAgIHN1Ymdyb3VwLnB1c2gobm9kZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG5ldyBUcmFuc2l0aW9uKHN1Ymdyb3VwcywgdGhpcy5fcGFyZW50cywgdGhpcy5fbmFtZSwgdGhpcy5faWQpO1xufVxuIiwgImltcG9ydCB7VHJhbnNpdGlvbn0gZnJvbSBcIi4vaW5kZXguanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24odHJhbnNpdGlvbikge1xuICBpZiAodHJhbnNpdGlvbi5faWQgIT09IHRoaXMuX2lkKSB0aHJvdyBuZXcgRXJyb3I7XG5cbiAgZm9yICh2YXIgZ3JvdXBzMCA9IHRoaXMuX2dyb3VwcywgZ3JvdXBzMSA9IHRyYW5zaXRpb24uX2dyb3VwcywgbTAgPSBncm91cHMwLmxlbmd0aCwgbTEgPSBncm91cHMxLmxlbmd0aCwgbSA9IE1hdGgubWluKG0wLCBtMSksIG1lcmdlcyA9IG5ldyBBcnJheShtMCksIGogPSAwOyBqIDwgbTsgKytqKSB7XG4gICAgZm9yICh2YXIgZ3JvdXAwID0gZ3JvdXBzMFtqXSwgZ3JvdXAxID0gZ3JvdXBzMVtqXSwgbiA9IGdyb3VwMC5sZW5ndGgsIG1lcmdlID0gbWVyZ2VzW2pdID0gbmV3IEFycmF5KG4pLCBub2RlLCBpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgaWYgKG5vZGUgPSBncm91cDBbaV0gfHwgZ3JvdXAxW2ldKSB7XG4gICAgICAgIG1lcmdlW2ldID0gbm9kZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBmb3IgKDsgaiA8IG0wOyArK2opIHtcbiAgICBtZXJnZXNbal0gPSBncm91cHMwW2pdO1xuICB9XG5cbiAgcmV0dXJuIG5ldyBUcmFuc2l0aW9uKG1lcmdlcywgdGhpcy5fcGFyZW50cywgdGhpcy5fbmFtZSwgdGhpcy5faWQpO1xufVxuIiwgImltcG9ydCB7Z2V0LCBzZXQsIGluaXR9IGZyb20gXCIuL3NjaGVkdWxlLmpzXCI7XG5cbmZ1bmN0aW9uIHN0YXJ0KG5hbWUpIHtcbiAgcmV0dXJuIChuYW1lICsgXCJcIikudHJpbSgpLnNwbGl0KC9efFxccysvKS5ldmVyeShmdW5jdGlvbih0KSB7XG4gICAgdmFyIGkgPSB0LmluZGV4T2YoXCIuXCIpO1xuICAgIGlmIChpID49IDApIHQgPSB0LnNsaWNlKDAsIGkpO1xuICAgIHJldHVybiAhdCB8fCB0ID09PSBcInN0YXJ0XCI7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBvbkZ1bmN0aW9uKGlkLCBuYW1lLCBsaXN0ZW5lcikge1xuICB2YXIgb24wLCBvbjEsIHNpdCA9IHN0YXJ0KG5hbWUpID8gaW5pdCA6IHNldDtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBzY2hlZHVsZSA9IHNpdCh0aGlzLCBpZCksXG4gICAgICAgIG9uID0gc2NoZWR1bGUub247XG5cbiAgICAvLyBJZiB0aGlzIG5vZGUgc2hhcmVkIGEgZGlzcGF0Y2ggd2l0aCB0aGUgcHJldmlvdXMgbm9kZSxcbiAgICAvLyBqdXN0IGFzc2lnbiB0aGUgdXBkYXRlZCBzaGFyZWQgZGlzcGF0Y2ggYW5kIHdlXHUyMDE5cmUgZG9uZSFcbiAgICAvLyBPdGhlcndpc2UsIGNvcHktb24td3JpdGUuXG4gICAgaWYgKG9uICE9PSBvbjApIChvbjEgPSAob24wID0gb24pLmNvcHkoKSkub24obmFtZSwgbGlzdGVuZXIpO1xuXG4gICAgc2NoZWR1bGUub24gPSBvbjE7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG5hbWUsIGxpc3RlbmVyKSB7XG4gIHZhciBpZCA9IHRoaXMuX2lkO1xuXG4gIHJldHVybiBhcmd1bWVudHMubGVuZ3RoIDwgMlxuICAgICAgPyBnZXQodGhpcy5ub2RlKCksIGlkKS5vbi5vbihuYW1lKVxuICAgICAgOiB0aGlzLmVhY2gob25GdW5jdGlvbihpZCwgbmFtZSwgbGlzdGVuZXIpKTtcbn1cbiIsICJmdW5jdGlvbiByZW1vdmVGdW5jdGlvbihpZCkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHBhcmVudCA9IHRoaXMucGFyZW50Tm9kZTtcbiAgICBmb3IgKHZhciBpIGluIHRoaXMuX190cmFuc2l0aW9uKSBpZiAoK2kgIT09IGlkKSByZXR1cm47XG4gICAgaWYgKHBhcmVudCkgcGFyZW50LnJlbW92ZUNoaWxkKHRoaXMpO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMub24oXCJlbmQucmVtb3ZlXCIsIHJlbW92ZUZ1bmN0aW9uKHRoaXMuX2lkKSk7XG59XG4iLCAiaW1wb3J0IHtzZWxlY3Rvcn0gZnJvbSBcImQzLXNlbGVjdGlvblwiO1xuaW1wb3J0IHtUcmFuc2l0aW9ufSBmcm9tIFwiLi9pbmRleC5qc1wiO1xuaW1wb3J0IHNjaGVkdWxlLCB7Z2V0fSBmcm9tIFwiLi9zY2hlZHVsZS5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihzZWxlY3QpIHtcbiAgdmFyIG5hbWUgPSB0aGlzLl9uYW1lLFxuICAgICAgaWQgPSB0aGlzLl9pZDtcblxuICBpZiAodHlwZW9mIHNlbGVjdCAhPT0gXCJmdW5jdGlvblwiKSBzZWxlY3QgPSBzZWxlY3RvcihzZWxlY3QpO1xuXG4gIGZvciAodmFyIGdyb3VwcyA9IHRoaXMuX2dyb3VwcywgbSA9IGdyb3Vwcy5sZW5ndGgsIHN1Ymdyb3VwcyA9IG5ldyBBcnJheShtKSwgaiA9IDA7IGogPCBtOyArK2opIHtcbiAgICBmb3IgKHZhciBncm91cCA9IGdyb3Vwc1tqXSwgbiA9IGdyb3VwLmxlbmd0aCwgc3ViZ3JvdXAgPSBzdWJncm91cHNbal0gPSBuZXcgQXJyYXkobiksIG5vZGUsIHN1Ym5vZGUsIGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAoKG5vZGUgPSBncm91cFtpXSkgJiYgKHN1Ym5vZGUgPSBzZWxlY3QuY2FsbChub2RlLCBub2RlLl9fZGF0YV9fLCBpLCBncm91cCkpKSB7XG4gICAgICAgIGlmIChcIl9fZGF0YV9fXCIgaW4gbm9kZSkgc3Vibm9kZS5fX2RhdGFfXyA9IG5vZGUuX19kYXRhX187XG4gICAgICAgIHN1Ymdyb3VwW2ldID0gc3Vibm9kZTtcbiAgICAgICAgc2NoZWR1bGUoc3ViZ3JvdXBbaV0sIG5hbWUsIGlkLCBpLCBzdWJncm91cCwgZ2V0KG5vZGUsIGlkKSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG5ldyBUcmFuc2l0aW9uKHN1Ymdyb3VwcywgdGhpcy5fcGFyZW50cywgbmFtZSwgaWQpO1xufVxuIiwgImltcG9ydCB7c2VsZWN0b3JBbGx9IGZyb20gXCJkMy1zZWxlY3Rpb25cIjtcbmltcG9ydCB7VHJhbnNpdGlvbn0gZnJvbSBcIi4vaW5kZXguanNcIjtcbmltcG9ydCBzY2hlZHVsZSwge2dldH0gZnJvbSBcIi4vc2NoZWR1bGUuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oc2VsZWN0KSB7XG4gIHZhciBuYW1lID0gdGhpcy5fbmFtZSxcbiAgICAgIGlkID0gdGhpcy5faWQ7XG5cbiAgaWYgKHR5cGVvZiBzZWxlY3QgIT09IFwiZnVuY3Rpb25cIikgc2VsZWN0ID0gc2VsZWN0b3JBbGwoc2VsZWN0KTtcblxuICBmb3IgKHZhciBncm91cHMgPSB0aGlzLl9ncm91cHMsIG0gPSBncm91cHMubGVuZ3RoLCBzdWJncm91cHMgPSBbXSwgcGFyZW50cyA9IFtdLCBqID0gMDsgaiA8IG07ICsraikge1xuICAgIGZvciAodmFyIGdyb3VwID0gZ3JvdXBzW2pdLCBuID0gZ3JvdXAubGVuZ3RoLCBub2RlLCBpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgaWYgKG5vZGUgPSBncm91cFtpXSkge1xuICAgICAgICBmb3IgKHZhciBjaGlsZHJlbiA9IHNlbGVjdC5jYWxsKG5vZGUsIG5vZGUuX19kYXRhX18sIGksIGdyb3VwKSwgY2hpbGQsIGluaGVyaXQgPSBnZXQobm9kZSwgaWQpLCBrID0gMCwgbCA9IGNoaWxkcmVuLmxlbmd0aDsgayA8IGw7ICsraykge1xuICAgICAgICAgIGlmIChjaGlsZCA9IGNoaWxkcmVuW2tdKSB7XG4gICAgICAgICAgICBzY2hlZHVsZShjaGlsZCwgbmFtZSwgaWQsIGssIGNoaWxkcmVuLCBpbmhlcml0KTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgc3ViZ3JvdXBzLnB1c2goY2hpbGRyZW4pO1xuICAgICAgICBwYXJlbnRzLnB1c2gobm9kZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG5ldyBUcmFuc2l0aW9uKHN1Ymdyb3VwcywgcGFyZW50cywgbmFtZSwgaWQpO1xufVxuIiwgImltcG9ydCB7c2VsZWN0aW9ufSBmcm9tIFwiZDMtc2VsZWN0aW9uXCI7XG5cbnZhciBTZWxlY3Rpb24gPSBzZWxlY3Rpb24ucHJvdG90eXBlLmNvbnN0cnVjdG9yO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIG5ldyBTZWxlY3Rpb24odGhpcy5fZ3JvdXBzLCB0aGlzLl9wYXJlbnRzKTtcbn1cbiIsICJpbXBvcnQge2ludGVycG9sYXRlVHJhbnNmb3JtQ3NzIGFzIGludGVycG9sYXRlVHJhbnNmb3JtfSBmcm9tIFwiZDMtaW50ZXJwb2xhdGVcIjtcbmltcG9ydCB7c3R5bGV9IGZyb20gXCJkMy1zZWxlY3Rpb25cIjtcbmltcG9ydCB7c2V0fSBmcm9tIFwiLi9zY2hlZHVsZS5qc1wiO1xuaW1wb3J0IHt0d2VlblZhbHVlfSBmcm9tIFwiLi90d2Vlbi5qc1wiO1xuaW1wb3J0IGludGVycG9sYXRlIGZyb20gXCIuL2ludGVycG9sYXRlLmpzXCI7XG5cbmZ1bmN0aW9uIHN0eWxlTnVsbChuYW1lLCBpbnRlcnBvbGF0ZSkge1xuICB2YXIgc3RyaW5nMDAsXG4gICAgICBzdHJpbmcxMCxcbiAgICAgIGludGVycG9sYXRlMDtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBzdHJpbmcwID0gc3R5bGUodGhpcywgbmFtZSksXG4gICAgICAgIHN0cmluZzEgPSAodGhpcy5zdHlsZS5yZW1vdmVQcm9wZXJ0eShuYW1lKSwgc3R5bGUodGhpcywgbmFtZSkpO1xuICAgIHJldHVybiBzdHJpbmcwID09PSBzdHJpbmcxID8gbnVsbFxuICAgICAgICA6IHN0cmluZzAgPT09IHN0cmluZzAwICYmIHN0cmluZzEgPT09IHN0cmluZzEwID8gaW50ZXJwb2xhdGUwXG4gICAgICAgIDogaW50ZXJwb2xhdGUwID0gaW50ZXJwb2xhdGUoc3RyaW5nMDAgPSBzdHJpbmcwLCBzdHJpbmcxMCA9IHN0cmluZzEpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBzdHlsZVJlbW92ZShuYW1lKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnN0eWxlLnJlbW92ZVByb3BlcnR5KG5hbWUpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBzdHlsZUNvbnN0YW50KG5hbWUsIGludGVycG9sYXRlLCB2YWx1ZTEpIHtcbiAgdmFyIHN0cmluZzAwLFxuICAgICAgc3RyaW5nMSA9IHZhbHVlMSArIFwiXCIsXG4gICAgICBpbnRlcnBvbGF0ZTA7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc3RyaW5nMCA9IHN0eWxlKHRoaXMsIG5hbWUpO1xuICAgIHJldHVybiBzdHJpbmcwID09PSBzdHJpbmcxID8gbnVsbFxuICAgICAgICA6IHN0cmluZzAgPT09IHN0cmluZzAwID8gaW50ZXJwb2xhdGUwXG4gICAgICAgIDogaW50ZXJwb2xhdGUwID0gaW50ZXJwb2xhdGUoc3RyaW5nMDAgPSBzdHJpbmcwLCB2YWx1ZTEpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBzdHlsZUZ1bmN0aW9uKG5hbWUsIGludGVycG9sYXRlLCB2YWx1ZSkge1xuICB2YXIgc3RyaW5nMDAsXG4gICAgICBzdHJpbmcxMCxcbiAgICAgIGludGVycG9sYXRlMDtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBzdHJpbmcwID0gc3R5bGUodGhpcywgbmFtZSksXG4gICAgICAgIHZhbHVlMSA9IHZhbHVlKHRoaXMpLFxuICAgICAgICBzdHJpbmcxID0gdmFsdWUxICsgXCJcIjtcbiAgICBpZiAodmFsdWUxID09IG51bGwpIHN0cmluZzEgPSB2YWx1ZTEgPSAodGhpcy5zdHlsZS5yZW1vdmVQcm9wZXJ0eShuYW1lKSwgc3R5bGUodGhpcywgbmFtZSkpO1xuICAgIHJldHVybiBzdHJpbmcwID09PSBzdHJpbmcxID8gbnVsbFxuICAgICAgICA6IHN0cmluZzAgPT09IHN0cmluZzAwICYmIHN0cmluZzEgPT09IHN0cmluZzEwID8gaW50ZXJwb2xhdGUwXG4gICAgICAgIDogKHN0cmluZzEwID0gc3RyaW5nMSwgaW50ZXJwb2xhdGUwID0gaW50ZXJwb2xhdGUoc3RyaW5nMDAgPSBzdHJpbmcwLCB2YWx1ZTEpKTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gc3R5bGVNYXliZVJlbW92ZShpZCwgbmFtZSkge1xuICB2YXIgb24wLCBvbjEsIGxpc3RlbmVyMCwga2V5ID0gXCJzdHlsZS5cIiArIG5hbWUsIGV2ZW50ID0gXCJlbmQuXCIgKyBrZXksIHJlbW92ZTtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBzY2hlZHVsZSA9IHNldCh0aGlzLCBpZCksXG4gICAgICAgIG9uID0gc2NoZWR1bGUub24sXG4gICAgICAgIGxpc3RlbmVyID0gc2NoZWR1bGUudmFsdWVba2V5XSA9PSBudWxsID8gcmVtb3ZlIHx8IChyZW1vdmUgPSBzdHlsZVJlbW92ZShuYW1lKSkgOiB1bmRlZmluZWQ7XG5cbiAgICAvLyBJZiB0aGlzIG5vZGUgc2hhcmVkIGEgZGlzcGF0Y2ggd2l0aCB0aGUgcHJldmlvdXMgbm9kZSxcbiAgICAvLyBqdXN0IGFzc2lnbiB0aGUgdXBkYXRlZCBzaGFyZWQgZGlzcGF0Y2ggYW5kIHdlXHUyMDE5cmUgZG9uZSFcbiAgICAvLyBPdGhlcndpc2UsIGNvcHktb24td3JpdGUuXG4gICAgaWYgKG9uICE9PSBvbjAgfHwgbGlzdGVuZXIwICE9PSBsaXN0ZW5lcikgKG9uMSA9IChvbjAgPSBvbikuY29weSgpKS5vbihldmVudCwgbGlzdGVuZXIwID0gbGlzdGVuZXIpO1xuXG4gICAgc2NoZWR1bGUub24gPSBvbjE7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG5hbWUsIHZhbHVlLCBwcmlvcml0eSkge1xuICB2YXIgaSA9IChuYW1lICs9IFwiXCIpID09PSBcInRyYW5zZm9ybVwiID8gaW50ZXJwb2xhdGVUcmFuc2Zvcm0gOiBpbnRlcnBvbGF0ZTtcbiAgcmV0dXJuIHZhbHVlID09IG51bGwgPyB0aGlzXG4gICAgICAuc3R5bGVUd2VlbihuYW1lLCBzdHlsZU51bGwobmFtZSwgaSkpXG4gICAgICAub24oXCJlbmQuc3R5bGUuXCIgKyBuYW1lLCBzdHlsZVJlbW92ZShuYW1lKSlcbiAgICA6IHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiID8gdGhpc1xuICAgICAgLnN0eWxlVHdlZW4obmFtZSwgc3R5bGVGdW5jdGlvbihuYW1lLCBpLCB0d2VlblZhbHVlKHRoaXMsIFwic3R5bGUuXCIgKyBuYW1lLCB2YWx1ZSkpKVxuICAgICAgLmVhY2goc3R5bGVNYXliZVJlbW92ZSh0aGlzLl9pZCwgbmFtZSkpXG4gICAgOiB0aGlzXG4gICAgICAuc3R5bGVUd2VlbihuYW1lLCBzdHlsZUNvbnN0YW50KG5hbWUsIGksIHZhbHVlKSwgcHJpb3JpdHkpXG4gICAgICAub24oXCJlbmQuc3R5bGUuXCIgKyBuYW1lLCBudWxsKTtcbn1cbiIsICJmdW5jdGlvbiBzdHlsZUludGVycG9sYXRlKG5hbWUsIGksIHByaW9yaXR5KSB7XG4gIHJldHVybiBmdW5jdGlvbih0KSB7XG4gICAgdGhpcy5zdHlsZS5zZXRQcm9wZXJ0eShuYW1lLCBpLmNhbGwodGhpcywgdCksIHByaW9yaXR5KTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gc3R5bGVUd2VlbihuYW1lLCB2YWx1ZSwgcHJpb3JpdHkpIHtcbiAgdmFyIHQsIGkwO1xuICBmdW5jdGlvbiB0d2VlbigpIHtcbiAgICB2YXIgaSA9IHZhbHVlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgaWYgKGkgIT09IGkwKSB0ID0gKGkwID0gaSkgJiYgc3R5bGVJbnRlcnBvbGF0ZShuYW1lLCBpLCBwcmlvcml0eSk7XG4gICAgcmV0dXJuIHQ7XG4gIH1cbiAgdHdlZW4uX3ZhbHVlID0gdmFsdWU7XG4gIHJldHVybiB0d2Vlbjtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSwgdmFsdWUsIHByaW9yaXR5KSB7XG4gIHZhciBrZXkgPSBcInN0eWxlLlwiICsgKG5hbWUgKz0gXCJcIik7XG4gIGlmIChhcmd1bWVudHMubGVuZ3RoIDwgMikgcmV0dXJuIChrZXkgPSB0aGlzLnR3ZWVuKGtleSkpICYmIGtleS5fdmFsdWU7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gdGhpcy50d2VlbihrZXksIG51bGwpO1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcjtcbiAgcmV0dXJuIHRoaXMudHdlZW4oa2V5LCBzdHlsZVR3ZWVuKG5hbWUsIHZhbHVlLCBwcmlvcml0eSA9PSBudWxsID8gXCJcIiA6IHByaW9yaXR5KSk7XG59XG4iLCAiaW1wb3J0IHt0d2VlblZhbHVlfSBmcm9tIFwiLi90d2Vlbi5qc1wiO1xuXG5mdW5jdGlvbiB0ZXh0Q29uc3RhbnQodmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHRoaXMudGV4dENvbnRlbnQgPSB2YWx1ZTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gdGV4dEZ1bmN0aW9uKHZhbHVlKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgdmFsdWUxID0gdmFsdWUodGhpcyk7XG4gICAgdGhpcy50ZXh0Q29udGVudCA9IHZhbHVlMSA9PSBudWxsID8gXCJcIiA6IHZhbHVlMTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24odmFsdWUpIHtcbiAgcmV0dXJuIHRoaXMudHdlZW4oXCJ0ZXh0XCIsIHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgICA/IHRleHRGdW5jdGlvbih0d2VlblZhbHVlKHRoaXMsIFwidGV4dFwiLCB2YWx1ZSkpXG4gICAgICA6IHRleHRDb25zdGFudCh2YWx1ZSA9PSBudWxsID8gXCJcIiA6IHZhbHVlICsgXCJcIikpO1xufVxuIiwgImZ1bmN0aW9uIHRleHRJbnRlcnBvbGF0ZShpKSB7XG4gIHJldHVybiBmdW5jdGlvbih0KSB7XG4gICAgdGhpcy50ZXh0Q29udGVudCA9IGkuY2FsbCh0aGlzLCB0KTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gdGV4dFR3ZWVuKHZhbHVlKSB7XG4gIHZhciB0MCwgaTA7XG4gIGZ1bmN0aW9uIHR3ZWVuKCkge1xuICAgIHZhciBpID0gdmFsdWUuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICBpZiAoaSAhPT0gaTApIHQwID0gKGkwID0gaSkgJiYgdGV4dEludGVycG9sYXRlKGkpO1xuICAgIHJldHVybiB0MDtcbiAgfVxuICB0d2Vlbi5fdmFsdWUgPSB2YWx1ZTtcbiAgcmV0dXJuIHR3ZWVuO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih2YWx1ZSkge1xuICB2YXIga2V5ID0gXCJ0ZXh0XCI7XG4gIGlmIChhcmd1bWVudHMubGVuZ3RoIDwgMSkgcmV0dXJuIChrZXkgPSB0aGlzLnR3ZWVuKGtleSkpICYmIGtleS5fdmFsdWU7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gdGhpcy50d2VlbihrZXksIG51bGwpO1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcjtcbiAgcmV0dXJuIHRoaXMudHdlZW4oa2V5LCB0ZXh0VHdlZW4odmFsdWUpKTtcbn1cbiIsICJpbXBvcnQge1RyYW5zaXRpb24sIG5ld0lkfSBmcm9tIFwiLi9pbmRleC5qc1wiO1xuaW1wb3J0IHNjaGVkdWxlLCB7Z2V0fSBmcm9tIFwiLi9zY2hlZHVsZS5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgdmFyIG5hbWUgPSB0aGlzLl9uYW1lLFxuICAgICAgaWQwID0gdGhpcy5faWQsXG4gICAgICBpZDEgPSBuZXdJZCgpO1xuXG4gIGZvciAodmFyIGdyb3VwcyA9IHRoaXMuX2dyb3VwcywgbSA9IGdyb3Vwcy5sZW5ndGgsIGogPSAwOyBqIDwgbTsgKytqKSB7XG4gICAgZm9yICh2YXIgZ3JvdXAgPSBncm91cHNbal0sIG4gPSBncm91cC5sZW5ndGgsIG5vZGUsIGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAobm9kZSA9IGdyb3VwW2ldKSB7XG4gICAgICAgIHZhciBpbmhlcml0ID0gZ2V0KG5vZGUsIGlkMCk7XG4gICAgICAgIHNjaGVkdWxlKG5vZGUsIG5hbWUsIGlkMSwgaSwgZ3JvdXAsIHtcbiAgICAgICAgICB0aW1lOiBpbmhlcml0LnRpbWUgKyBpbmhlcml0LmRlbGF5ICsgaW5oZXJpdC5kdXJhdGlvbixcbiAgICAgICAgICBkZWxheTogMCxcbiAgICAgICAgICBkdXJhdGlvbjogaW5oZXJpdC5kdXJhdGlvbixcbiAgICAgICAgICBlYXNlOiBpbmhlcml0LmVhc2VcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG5ldyBUcmFuc2l0aW9uKGdyb3VwcywgdGhpcy5fcGFyZW50cywgbmFtZSwgaWQxKTtcbn1cbiIsICJpbXBvcnQge3NldH0gZnJvbSBcIi4vc2NoZWR1bGUuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIHZhciBvbjAsIG9uMSwgdGhhdCA9IHRoaXMsIGlkID0gdGhhdC5faWQsIHNpemUgPSB0aGF0LnNpemUoKTtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgIHZhciBjYW5jZWwgPSB7dmFsdWU6IHJlamVjdH0sXG4gICAgICAgIGVuZCA9IHt2YWx1ZTogZnVuY3Rpb24oKSB7IGlmICgtLXNpemUgPT09IDApIHJlc29sdmUoKTsgfX07XG5cbiAgICB0aGF0LmVhY2goZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgc2NoZWR1bGUgPSBzZXQodGhpcywgaWQpLFxuICAgICAgICAgIG9uID0gc2NoZWR1bGUub247XG5cbiAgICAgIC8vIElmIHRoaXMgbm9kZSBzaGFyZWQgYSBkaXNwYXRjaCB3aXRoIHRoZSBwcmV2aW91cyBub2RlLFxuICAgICAgLy8ganVzdCBhc3NpZ24gdGhlIHVwZGF0ZWQgc2hhcmVkIGRpc3BhdGNoIGFuZCB3ZVx1MjAxOXJlIGRvbmUhXG4gICAgICAvLyBPdGhlcndpc2UsIGNvcHktb24td3JpdGUuXG4gICAgICBpZiAob24gIT09IG9uMCkge1xuICAgICAgICBvbjEgPSAob24wID0gb24pLmNvcHkoKTtcbiAgICAgICAgb24xLl8uY2FuY2VsLnB1c2goY2FuY2VsKTtcbiAgICAgICAgb24xLl8uaW50ZXJydXB0LnB1c2goY2FuY2VsKTtcbiAgICAgICAgb24xLl8uZW5kLnB1c2goZW5kKTtcbiAgICAgIH1cblxuICAgICAgc2NoZWR1bGUub24gPSBvbjE7XG4gICAgfSk7XG5cbiAgICAvLyBUaGUgc2VsZWN0aW9uIHdhcyBlbXB0eSwgcmVzb2x2ZSBlbmQgaW1tZWRpYXRlbHlcbiAgICBpZiAoc2l6ZSA9PT0gMCkgcmVzb2x2ZSgpO1xuICB9KTtcbn1cbiIsICJpbXBvcnQge3NlbGVjdGlvbn0gZnJvbSBcImQzLXNlbGVjdGlvblwiO1xuaW1wb3J0IHRyYW5zaXRpb25fYXR0ciBmcm9tIFwiLi9hdHRyLmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl9hdHRyVHdlZW4gZnJvbSBcIi4vYXR0clR3ZWVuLmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl9kZWxheSBmcm9tIFwiLi9kZWxheS5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fZHVyYXRpb24gZnJvbSBcIi4vZHVyYXRpb24uanNcIjtcbmltcG9ydCB0cmFuc2l0aW9uX2Vhc2UgZnJvbSBcIi4vZWFzZS5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fZWFzZVZhcnlpbmcgZnJvbSBcIi4vZWFzZVZhcnlpbmcuanNcIjtcbmltcG9ydCB0cmFuc2l0aW9uX2ZpbHRlciBmcm9tIFwiLi9maWx0ZXIuanNcIjtcbmltcG9ydCB0cmFuc2l0aW9uX21lcmdlIGZyb20gXCIuL21lcmdlLmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl9vbiBmcm9tIFwiLi9vbi5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fcmVtb3ZlIGZyb20gXCIuL3JlbW92ZS5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fc2VsZWN0IGZyb20gXCIuL3NlbGVjdC5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fc2VsZWN0QWxsIGZyb20gXCIuL3NlbGVjdEFsbC5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fc2VsZWN0aW9uIGZyb20gXCIuL3NlbGVjdGlvbi5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fc3R5bGUgZnJvbSBcIi4vc3R5bGUuanNcIjtcbmltcG9ydCB0cmFuc2l0aW9uX3N0eWxlVHdlZW4gZnJvbSBcIi4vc3R5bGVUd2Vlbi5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fdGV4dCBmcm9tIFwiLi90ZXh0LmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl90ZXh0VHdlZW4gZnJvbSBcIi4vdGV4dFR3ZWVuLmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl90cmFuc2l0aW9uIGZyb20gXCIuL3RyYW5zaXRpb24uanNcIjtcbmltcG9ydCB0cmFuc2l0aW9uX3R3ZWVuIGZyb20gXCIuL3R3ZWVuLmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl9lbmQgZnJvbSBcIi4vZW5kLmpzXCI7XG5cbnZhciBpZCA9IDA7XG5cbmV4cG9ydCBmdW5jdGlvbiBUcmFuc2l0aW9uKGdyb3VwcywgcGFyZW50cywgbmFtZSwgaWQpIHtcbiAgdGhpcy5fZ3JvdXBzID0gZ3JvdXBzO1xuICB0aGlzLl9wYXJlbnRzID0gcGFyZW50cztcbiAgdGhpcy5fbmFtZSA9IG5hbWU7XG4gIHRoaXMuX2lkID0gaWQ7XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIHRyYW5zaXRpb24obmFtZSkge1xuICByZXR1cm4gc2VsZWN0aW9uKCkudHJhbnNpdGlvbihuYW1lKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG5ld0lkKCkge1xuICByZXR1cm4gKytpZDtcbn1cblxudmFyIHNlbGVjdGlvbl9wcm90b3R5cGUgPSBzZWxlY3Rpb24ucHJvdG90eXBlO1xuXG5UcmFuc2l0aW9uLnByb3RvdHlwZSA9IHRyYW5zaXRpb24ucHJvdG90eXBlID0ge1xuICBjb25zdHJ1Y3RvcjogVHJhbnNpdGlvbixcbiAgc2VsZWN0OiB0cmFuc2l0aW9uX3NlbGVjdCxcbiAgc2VsZWN0QWxsOiB0cmFuc2l0aW9uX3NlbGVjdEFsbCxcbiAgc2VsZWN0Q2hpbGQ6IHNlbGVjdGlvbl9wcm90b3R5cGUuc2VsZWN0Q2hpbGQsXG4gIHNlbGVjdENoaWxkcmVuOiBzZWxlY3Rpb25fcHJvdG90eXBlLnNlbGVjdENoaWxkcmVuLFxuICBmaWx0ZXI6IHRyYW5zaXRpb25fZmlsdGVyLFxuICBtZXJnZTogdHJhbnNpdGlvbl9tZXJnZSxcbiAgc2VsZWN0aW9uOiB0cmFuc2l0aW9uX3NlbGVjdGlvbixcbiAgdHJhbnNpdGlvbjogdHJhbnNpdGlvbl90cmFuc2l0aW9uLFxuICBjYWxsOiBzZWxlY3Rpb25fcHJvdG90eXBlLmNhbGwsXG4gIG5vZGVzOiBzZWxlY3Rpb25fcHJvdG90eXBlLm5vZGVzLFxuICBub2RlOiBzZWxlY3Rpb25fcHJvdG90eXBlLm5vZGUsXG4gIHNpemU6IHNlbGVjdGlvbl9wcm90b3R5cGUuc2l6ZSxcbiAgZW1wdHk6IHNlbGVjdGlvbl9wcm90b3R5cGUuZW1wdHksXG4gIGVhY2g6IHNlbGVjdGlvbl9wcm90b3R5cGUuZWFjaCxcbiAgb246IHRyYW5zaXRpb25fb24sXG4gIGF0dHI6IHRyYW5zaXRpb25fYXR0cixcbiAgYXR0clR3ZWVuOiB0cmFuc2l0aW9uX2F0dHJUd2VlbixcbiAgc3R5bGU6IHRyYW5zaXRpb25fc3R5bGUsXG4gIHN0eWxlVHdlZW46IHRyYW5zaXRpb25fc3R5bGVUd2VlbixcbiAgdGV4dDogdHJhbnNpdGlvbl90ZXh0LFxuICB0ZXh0VHdlZW46IHRyYW5zaXRpb25fdGV4dFR3ZWVuLFxuICByZW1vdmU6IHRyYW5zaXRpb25fcmVtb3ZlLFxuICB0d2VlbjogdHJhbnNpdGlvbl90d2VlbixcbiAgZGVsYXk6IHRyYW5zaXRpb25fZGVsYXksXG4gIGR1cmF0aW9uOiB0cmFuc2l0aW9uX2R1cmF0aW9uLFxuICBlYXNlOiB0cmFuc2l0aW9uX2Vhc2UsXG4gIGVhc2VWYXJ5aW5nOiB0cmFuc2l0aW9uX2Vhc2VWYXJ5aW5nLFxuICBlbmQ6IHRyYW5zaXRpb25fZW5kLFxuICBbU3ltYm9sLml0ZXJhdG9yXTogc2VsZWN0aW9uX3Byb3RvdHlwZVtTeW1ib2wuaXRlcmF0b3JdXG59O1xuIiwgImV4cG9ydCBmdW5jdGlvbiBjdWJpY0luKHQpIHtcbiAgcmV0dXJuIHQgKiB0ICogdDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGN1YmljT3V0KHQpIHtcbiAgcmV0dXJuIC0tdCAqIHQgKiB0ICsgMTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGN1YmljSW5PdXQodCkge1xuICByZXR1cm4gKCh0ICo9IDIpIDw9IDEgPyB0ICogdCAqIHQgOiAodCAtPSAyKSAqIHQgKiB0ICsgMikgLyAyO1xufVxuIiwgImltcG9ydCB7VHJhbnNpdGlvbiwgbmV3SWR9IGZyb20gXCIuLi90cmFuc2l0aW9uL2luZGV4LmpzXCI7XG5pbXBvcnQgc2NoZWR1bGUgZnJvbSBcIi4uL3RyYW5zaXRpb24vc2NoZWR1bGUuanNcIjtcbmltcG9ydCB7ZWFzZUN1YmljSW5PdXR9IGZyb20gXCJkMy1lYXNlXCI7XG5pbXBvcnQge25vd30gZnJvbSBcImQzLXRpbWVyXCI7XG5cbnZhciBkZWZhdWx0VGltaW5nID0ge1xuICB0aW1lOiBudWxsLCAvLyBTZXQgb24gdXNlLlxuICBkZWxheTogMCxcbiAgZHVyYXRpb246IDI1MCxcbiAgZWFzZTogZWFzZUN1YmljSW5PdXRcbn07XG5cbmZ1bmN0aW9uIGluaGVyaXQobm9kZSwgaWQpIHtcbiAgdmFyIHRpbWluZztcbiAgd2hpbGUgKCEodGltaW5nID0gbm9kZS5fX3RyYW5zaXRpb24pIHx8ICEodGltaW5nID0gdGltaW5nW2lkXSkpIHtcbiAgICBpZiAoIShub2RlID0gbm9kZS5wYXJlbnROb2RlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGB0cmFuc2l0aW9uICR7aWR9IG5vdCBmb3VuZGApO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdGltaW5nO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihuYW1lKSB7XG4gIHZhciBpZCxcbiAgICAgIHRpbWluZztcblxuICBpZiAobmFtZSBpbnN0YW5jZW9mIFRyYW5zaXRpb24pIHtcbiAgICBpZCA9IG5hbWUuX2lkLCBuYW1lID0gbmFtZS5fbmFtZTtcbiAgfSBlbHNlIHtcbiAgICBpZCA9IG5ld0lkKCksICh0aW1pbmcgPSBkZWZhdWx0VGltaW5nKS50aW1lID0gbm93KCksIG5hbWUgPSBuYW1lID09IG51bGwgPyBudWxsIDogbmFtZSArIFwiXCI7XG4gIH1cblxuICBmb3IgKHZhciBncm91cHMgPSB0aGlzLl9ncm91cHMsIG0gPSBncm91cHMubGVuZ3RoLCBqID0gMDsgaiA8IG07ICsraikge1xuICAgIGZvciAodmFyIGdyb3VwID0gZ3JvdXBzW2pdLCBuID0gZ3JvdXAubGVuZ3RoLCBub2RlLCBpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgaWYgKG5vZGUgPSBncm91cFtpXSkge1xuICAgICAgICBzY2hlZHVsZShub2RlLCBuYW1lLCBpZCwgaSwgZ3JvdXAsIHRpbWluZyB8fCBpbmhlcml0KG5vZGUsIGlkKSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG5ldyBUcmFuc2l0aW9uKGdyb3VwcywgdGhpcy5fcGFyZW50cywgbmFtZSwgaWQpO1xufVxuIiwgImltcG9ydCB7c2VsZWN0aW9ufSBmcm9tIFwiZDMtc2VsZWN0aW9uXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2ludGVycnVwdCBmcm9tIFwiLi9pbnRlcnJ1cHQuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fdHJhbnNpdGlvbiBmcm9tIFwiLi90cmFuc2l0aW9uLmpzXCI7XG5cbnNlbGVjdGlvbi5wcm90b3R5cGUuaW50ZXJydXB0ID0gc2VsZWN0aW9uX2ludGVycnVwdDtcbnNlbGVjdGlvbi5wcm90b3R5cGUudHJhbnNpdGlvbiA9IHNlbGVjdGlvbl90cmFuc2l0aW9uO1xuIiwgImltcG9ydCB7ZGlzcGF0Y2h9IGZyb20gXCJkMy1kaXNwYXRjaFwiO1xuaW1wb3J0IHtkcmFnRGlzYWJsZSwgZHJhZ0VuYWJsZX0gZnJvbSBcImQzLWRyYWdcIjtcbmltcG9ydCB7aW50ZXJwb2xhdGV9IGZyb20gXCJkMy1pbnRlcnBvbGF0ZVwiO1xuaW1wb3J0IHtwb2ludGVyLCBzZWxlY3R9IGZyb20gXCJkMy1zZWxlY3Rpb25cIjtcbmltcG9ydCB7aW50ZXJydXB0fSBmcm9tIFwiZDMtdHJhbnNpdGlvblwiO1xuaW1wb3J0IGNvbnN0YW50IGZyb20gXCIuL2NvbnN0YW50LmpzXCI7XG5pbXBvcnQgQnJ1c2hFdmVudCBmcm9tIFwiLi9ldmVudC5qc1wiO1xuaW1wb3J0IG5vZXZlbnQsIHtub3Byb3BhZ2F0aW9ufSBmcm9tIFwiLi9ub2V2ZW50LmpzXCI7XG5cbnZhciBNT0RFX0RSQUcgPSB7bmFtZTogXCJkcmFnXCJ9LFxuICAgIE1PREVfU1BBQ0UgPSB7bmFtZTogXCJzcGFjZVwifSxcbiAgICBNT0RFX0hBTkRMRSA9IHtuYW1lOiBcImhhbmRsZVwifSxcbiAgICBNT0RFX0NFTlRFUiA9IHtuYW1lOiBcImNlbnRlclwifTtcblxuY29uc3Qge2FicywgbWF4LCBtaW59ID0gTWF0aDtcblxuZnVuY3Rpb24gbnVtYmVyMShlKSB7XG4gIHJldHVybiBbK2VbMF0sICtlWzFdXTtcbn1cblxuZnVuY3Rpb24gbnVtYmVyMihlKSB7XG4gIHJldHVybiBbbnVtYmVyMShlWzBdKSwgbnVtYmVyMShlWzFdKV07XG59XG5cbnZhciBYID0ge1xuICBuYW1lOiBcInhcIixcbiAgaGFuZGxlczogW1wid1wiLCBcImVcIl0ubWFwKHR5cGUpLFxuICBpbnB1dDogZnVuY3Rpb24oeCwgZSkgeyByZXR1cm4geCA9PSBudWxsID8gbnVsbCA6IFtbK3hbMF0sIGVbMF1bMV1dLCBbK3hbMV0sIGVbMV1bMV1dXTsgfSxcbiAgb3V0cHV0OiBmdW5jdGlvbih4eSkgeyByZXR1cm4geHkgJiYgW3h5WzBdWzBdLCB4eVsxXVswXV07IH1cbn07XG5cbnZhciBZID0ge1xuICBuYW1lOiBcInlcIixcbiAgaGFuZGxlczogW1wiblwiLCBcInNcIl0ubWFwKHR5cGUpLFxuICBpbnB1dDogZnVuY3Rpb24oeSwgZSkgeyByZXR1cm4geSA9PSBudWxsID8gbnVsbCA6IFtbZVswXVswXSwgK3lbMF1dLCBbZVsxXVswXSwgK3lbMV1dXTsgfSxcbiAgb3V0cHV0OiBmdW5jdGlvbih4eSkgeyByZXR1cm4geHkgJiYgW3h5WzBdWzFdLCB4eVsxXVsxXV07IH1cbn07XG5cbnZhciBYWSA9IHtcbiAgbmFtZTogXCJ4eVwiLFxuICBoYW5kbGVzOiBbXCJuXCIsIFwid1wiLCBcImVcIiwgXCJzXCIsIFwibndcIiwgXCJuZVwiLCBcInN3XCIsIFwic2VcIl0ubWFwKHR5cGUpLFxuICBpbnB1dDogZnVuY3Rpb24oeHkpIHsgcmV0dXJuIHh5ID09IG51bGwgPyBudWxsIDogbnVtYmVyMih4eSk7IH0sXG4gIG91dHB1dDogZnVuY3Rpb24oeHkpIHsgcmV0dXJuIHh5OyB9XG59O1xuXG52YXIgY3Vyc29ycyA9IHtcbiAgb3ZlcmxheTogXCJjcm9zc2hhaXJcIixcbiAgc2VsZWN0aW9uOiBcIm1vdmVcIixcbiAgbjogXCJucy1yZXNpemVcIixcbiAgZTogXCJldy1yZXNpemVcIixcbiAgczogXCJucy1yZXNpemVcIixcbiAgdzogXCJldy1yZXNpemVcIixcbiAgbnc6IFwibndzZS1yZXNpemVcIixcbiAgbmU6IFwibmVzdy1yZXNpemVcIixcbiAgc2U6IFwibndzZS1yZXNpemVcIixcbiAgc3c6IFwibmVzdy1yZXNpemVcIlxufTtcblxudmFyIGZsaXBYID0ge1xuICBlOiBcIndcIixcbiAgdzogXCJlXCIsXG4gIG53OiBcIm5lXCIsXG4gIG5lOiBcIm53XCIsXG4gIHNlOiBcInN3XCIsXG4gIHN3OiBcInNlXCJcbn07XG5cbnZhciBmbGlwWSA9IHtcbiAgbjogXCJzXCIsXG4gIHM6IFwiblwiLFxuICBudzogXCJzd1wiLFxuICBuZTogXCJzZVwiLFxuICBzZTogXCJuZVwiLFxuICBzdzogXCJud1wiXG59O1xuXG52YXIgc2lnbnNYID0ge1xuICBvdmVybGF5OiArMSxcbiAgc2VsZWN0aW9uOiArMSxcbiAgbjogbnVsbCxcbiAgZTogKzEsXG4gIHM6IG51bGwsXG4gIHc6IC0xLFxuICBudzogLTEsXG4gIG5lOiArMSxcbiAgc2U6ICsxLFxuICBzdzogLTFcbn07XG5cbnZhciBzaWduc1kgPSB7XG4gIG92ZXJsYXk6ICsxLFxuICBzZWxlY3Rpb246ICsxLFxuICBuOiAtMSxcbiAgZTogbnVsbCxcbiAgczogKzEsXG4gIHc6IG51bGwsXG4gIG53OiAtMSxcbiAgbmU6IC0xLFxuICBzZTogKzEsXG4gIHN3OiArMVxufTtcblxuZnVuY3Rpb24gdHlwZSh0KSB7XG4gIHJldHVybiB7dHlwZTogdH07XG59XG5cbi8vIElnbm9yZSByaWdodC1jbGljaywgc2luY2UgdGhhdCBzaG91bGQgb3BlbiB0aGUgY29udGV4dCBtZW51LlxuZnVuY3Rpb24gZGVmYXVsdEZpbHRlcihldmVudCkge1xuICByZXR1cm4gIWV2ZW50LmN0cmxLZXkgJiYgIWV2ZW50LmJ1dHRvbjtcbn1cblxuZnVuY3Rpb24gZGVmYXVsdEV4dGVudCgpIHtcbiAgdmFyIHN2ZyA9IHRoaXMub3duZXJTVkdFbGVtZW50IHx8IHRoaXM7XG4gIGlmIChzdmcuaGFzQXR0cmlidXRlKFwidmlld0JveFwiKSkge1xuICAgIHN2ZyA9IHN2Zy52aWV3Qm94LmJhc2VWYWw7XG4gICAgcmV0dXJuIFtbc3ZnLngsIHN2Zy55XSwgW3N2Zy54ICsgc3ZnLndpZHRoLCBzdmcueSArIHN2Zy5oZWlnaHRdXTtcbiAgfVxuICByZXR1cm4gW1swLCAwXSwgW3N2Zy53aWR0aC5iYXNlVmFsLnZhbHVlLCBzdmcuaGVpZ2h0LmJhc2VWYWwudmFsdWVdXTtcbn1cblxuZnVuY3Rpb24gZGVmYXVsdFRvdWNoYWJsZSgpIHtcbiAgcmV0dXJuIG5hdmlnYXRvci5tYXhUb3VjaFBvaW50cyB8fCAoXCJvbnRvdWNoc3RhcnRcIiBpbiB0aGlzKTtcbn1cblxuLy8gTGlrZSBkMy5sb2NhbCwgYnV0IHdpdGggdGhlIG5hbWUgXHUyMDFDX19icnVzaFx1MjAxRCByYXRoZXIgdGhhbiBhdXRvLWdlbmVyYXRlZC5cbmZ1bmN0aW9uIGxvY2FsKG5vZGUpIHtcbiAgd2hpbGUgKCFub2RlLl9fYnJ1c2gpIGlmICghKG5vZGUgPSBub2RlLnBhcmVudE5vZGUpKSByZXR1cm47XG4gIHJldHVybiBub2RlLl9fYnJ1c2g7XG59XG5cbmZ1bmN0aW9uIGVtcHR5KGV4dGVudCkge1xuICByZXR1cm4gZXh0ZW50WzBdWzBdID09PSBleHRlbnRbMV1bMF1cbiAgICAgIHx8IGV4dGVudFswXVsxXSA9PT0gZXh0ZW50WzFdWzFdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYnJ1c2hTZWxlY3Rpb24obm9kZSkge1xuICB2YXIgc3RhdGUgPSBub2RlLl9fYnJ1c2g7XG4gIHJldHVybiBzdGF0ZSA/IHN0YXRlLmRpbS5vdXRwdXQoc3RhdGUuc2VsZWN0aW9uKSA6IG51bGw7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBicnVzaFgoKSB7XG4gIHJldHVybiBicnVzaChYKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJydXNoWSgpIHtcbiAgcmV0dXJuIGJydXNoKFkpO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIGJydXNoKFhZKTtcbn1cblxuZnVuY3Rpb24gYnJ1c2goZGltKSB7XG4gIHZhciBleHRlbnQgPSBkZWZhdWx0RXh0ZW50LFxuICAgICAgZmlsdGVyID0gZGVmYXVsdEZpbHRlcixcbiAgICAgIHRvdWNoYWJsZSA9IGRlZmF1bHRUb3VjaGFibGUsXG4gICAgICBrZXlzID0gdHJ1ZSxcbiAgICAgIGxpc3RlbmVycyA9IGRpc3BhdGNoKFwic3RhcnRcIiwgXCJicnVzaFwiLCBcImVuZFwiKSxcbiAgICAgIGhhbmRsZVNpemUgPSA2LFxuICAgICAgdG91Y2hlbmRpbmc7XG5cbiAgZnVuY3Rpb24gYnJ1c2goZ3JvdXApIHtcbiAgICB2YXIgb3ZlcmxheSA9IGdyb3VwXG4gICAgICAgIC5wcm9wZXJ0eShcIl9fYnJ1c2hcIiwgaW5pdGlhbGl6ZSlcbiAgICAgIC5zZWxlY3RBbGwoXCIub3ZlcmxheVwiKVxuICAgICAgLmRhdGEoW3R5cGUoXCJvdmVybGF5XCIpXSk7XG5cbiAgICBvdmVybGF5LmVudGVyKCkuYXBwZW5kKFwicmVjdFwiKVxuICAgICAgICAuYXR0cihcImNsYXNzXCIsIFwib3ZlcmxheVwiKVxuICAgICAgICAuYXR0cihcInBvaW50ZXItZXZlbnRzXCIsIFwiYWxsXCIpXG4gICAgICAgIC5hdHRyKFwiY3Vyc29yXCIsIGN1cnNvcnMub3ZlcmxheSlcbiAgICAgIC5tZXJnZShvdmVybGF5KVxuICAgICAgICAuZWFjaChmdW5jdGlvbigpIHtcbiAgICAgICAgICB2YXIgZXh0ZW50ID0gbG9jYWwodGhpcykuZXh0ZW50O1xuICAgICAgICAgIHNlbGVjdCh0aGlzKVxuICAgICAgICAgICAgICAuYXR0cihcInhcIiwgZXh0ZW50WzBdWzBdKVxuICAgICAgICAgICAgICAuYXR0cihcInlcIiwgZXh0ZW50WzBdWzFdKVxuICAgICAgICAgICAgICAuYXR0cihcIndpZHRoXCIsIGV4dGVudFsxXVswXSAtIGV4dGVudFswXVswXSlcbiAgICAgICAgICAgICAgLmF0dHIoXCJoZWlnaHRcIiwgZXh0ZW50WzFdWzFdIC0gZXh0ZW50WzBdWzFdKTtcbiAgICAgICAgfSk7XG5cbiAgICBncm91cC5zZWxlY3RBbGwoXCIuc2VsZWN0aW9uXCIpXG4gICAgICAuZGF0YShbdHlwZShcInNlbGVjdGlvblwiKV0pXG4gICAgICAuZW50ZXIoKS5hcHBlbmQoXCJyZWN0XCIpXG4gICAgICAgIC5hdHRyKFwiY2xhc3NcIiwgXCJzZWxlY3Rpb25cIilcbiAgICAgICAgLmF0dHIoXCJjdXJzb3JcIiwgY3Vyc29ycy5zZWxlY3Rpb24pXG4gICAgICAgIC5hdHRyKFwiZmlsbFwiLCBcIiM3NzdcIilcbiAgICAgICAgLmF0dHIoXCJmaWxsLW9wYWNpdHlcIiwgMC4zKVxuICAgICAgICAuYXR0cihcInN0cm9rZVwiLCBcIiNmZmZcIilcbiAgICAgICAgLmF0dHIoXCJzaGFwZS1yZW5kZXJpbmdcIiwgXCJjcmlzcEVkZ2VzXCIpO1xuXG4gICAgdmFyIGhhbmRsZSA9IGdyb3VwLnNlbGVjdEFsbChcIi5oYW5kbGVcIilcbiAgICAgIC5kYXRhKGRpbS5oYW5kbGVzLCBmdW5jdGlvbihkKSB7IHJldHVybiBkLnR5cGU7IH0pO1xuXG4gICAgaGFuZGxlLmV4aXQoKS5yZW1vdmUoKTtcblxuICAgIGhhbmRsZS5lbnRlcigpLmFwcGVuZChcInJlY3RcIilcbiAgICAgICAgLmF0dHIoXCJjbGFzc1wiLCBmdW5jdGlvbihkKSB7IHJldHVybiBcImhhbmRsZSBoYW5kbGUtLVwiICsgZC50eXBlOyB9KVxuICAgICAgICAuYXR0cihcImN1cnNvclwiLCBmdW5jdGlvbihkKSB7IHJldHVybiBjdXJzb3JzW2QudHlwZV07IH0pO1xuXG4gICAgZ3JvdXBcbiAgICAgICAgLmVhY2gocmVkcmF3KVxuICAgICAgICAuYXR0cihcImZpbGxcIiwgXCJub25lXCIpXG4gICAgICAgIC5hdHRyKFwicG9pbnRlci1ldmVudHNcIiwgXCJhbGxcIilcbiAgICAgICAgLm9uKFwibW91c2Vkb3duLmJydXNoXCIsIHN0YXJ0ZWQpXG4gICAgICAuZmlsdGVyKHRvdWNoYWJsZSlcbiAgICAgICAgLm9uKFwidG91Y2hzdGFydC5icnVzaFwiLCBzdGFydGVkKVxuICAgICAgICAub24oXCJ0b3VjaG1vdmUuYnJ1c2hcIiwgdG91Y2htb3ZlZClcbiAgICAgICAgLm9uKFwidG91Y2hlbmQuYnJ1c2ggdG91Y2hjYW5jZWwuYnJ1c2hcIiwgdG91Y2hlbmRlZClcbiAgICAgICAgLnN0eWxlKFwidG91Y2gtYWN0aW9uXCIsIFwibm9uZVwiKVxuICAgICAgICAuc3R5bGUoXCItd2Via2l0LXRhcC1oaWdobGlnaHQtY29sb3JcIiwgXCJyZ2JhKDAsMCwwLDApXCIpO1xuICB9XG5cbiAgYnJ1c2gubW92ZSA9IGZ1bmN0aW9uKGdyb3VwLCBzZWxlY3Rpb24sIGV2ZW50KSB7XG4gICAgaWYgKGdyb3VwLnR3ZWVuKSB7XG4gICAgICBncm91cFxuICAgICAgICAgIC5vbihcInN0YXJ0LmJydXNoXCIsIGZ1bmN0aW9uKGV2ZW50KSB7IGVtaXR0ZXIodGhpcywgYXJndW1lbnRzKS5iZWZvcmVzdGFydCgpLnN0YXJ0KGV2ZW50KTsgfSlcbiAgICAgICAgICAub24oXCJpbnRlcnJ1cHQuYnJ1c2ggZW5kLmJydXNoXCIsIGZ1bmN0aW9uKGV2ZW50KSB7IGVtaXR0ZXIodGhpcywgYXJndW1lbnRzKS5lbmQoZXZlbnQpOyB9KVxuICAgICAgICAgIC50d2VlbihcImJydXNoXCIsIGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdmFyIHRoYXQgPSB0aGlzLFxuICAgICAgICAgICAgICAgIHN0YXRlID0gdGhhdC5fX2JydXNoLFxuICAgICAgICAgICAgICAgIGVtaXQgPSBlbWl0dGVyKHRoYXQsIGFyZ3VtZW50cyksXG4gICAgICAgICAgICAgICAgc2VsZWN0aW9uMCA9IHN0YXRlLnNlbGVjdGlvbixcbiAgICAgICAgICAgICAgICBzZWxlY3Rpb24xID0gZGltLmlucHV0KHR5cGVvZiBzZWxlY3Rpb24gPT09IFwiZnVuY3Rpb25cIiA/IHNlbGVjdGlvbi5hcHBseSh0aGlzLCBhcmd1bWVudHMpIDogc2VsZWN0aW9uLCBzdGF0ZS5leHRlbnQpLFxuICAgICAgICAgICAgICAgIGkgPSBpbnRlcnBvbGF0ZShzZWxlY3Rpb24wLCBzZWxlY3Rpb24xKTtcblxuICAgICAgICAgICAgZnVuY3Rpb24gdHdlZW4odCkge1xuICAgICAgICAgICAgICBzdGF0ZS5zZWxlY3Rpb24gPSB0ID09PSAxICYmIHNlbGVjdGlvbjEgPT09IG51bGwgPyBudWxsIDogaSh0KTtcbiAgICAgICAgICAgICAgcmVkcmF3LmNhbGwodGhhdCk7XG4gICAgICAgICAgICAgIGVtaXQuYnJ1c2goKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHNlbGVjdGlvbjAgIT09IG51bGwgJiYgc2VsZWN0aW9uMSAhPT0gbnVsbCA/IHR3ZWVuIDogdHdlZW4oMSk7XG4gICAgICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGdyb3VwXG4gICAgICAgICAgLmVhY2goZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB2YXIgdGhhdCA9IHRoaXMsXG4gICAgICAgICAgICAgICAgYXJncyA9IGFyZ3VtZW50cyxcbiAgICAgICAgICAgICAgICBzdGF0ZSA9IHRoYXQuX19icnVzaCxcbiAgICAgICAgICAgICAgICBzZWxlY3Rpb24xID0gZGltLmlucHV0KHR5cGVvZiBzZWxlY3Rpb24gPT09IFwiZnVuY3Rpb25cIiA/IHNlbGVjdGlvbi5hcHBseSh0aGF0LCBhcmdzKSA6IHNlbGVjdGlvbiwgc3RhdGUuZXh0ZW50KSxcbiAgICAgICAgICAgICAgICBlbWl0ID0gZW1pdHRlcih0aGF0LCBhcmdzKS5iZWZvcmVzdGFydCgpO1xuXG4gICAgICAgICAgICBpbnRlcnJ1cHQodGhhdCk7XG4gICAgICAgICAgICBzdGF0ZS5zZWxlY3Rpb24gPSBzZWxlY3Rpb24xID09PSBudWxsID8gbnVsbCA6IHNlbGVjdGlvbjE7XG4gICAgICAgICAgICByZWRyYXcuY2FsbCh0aGF0KTtcbiAgICAgICAgICAgIGVtaXQuc3RhcnQoZXZlbnQpLmJydXNoKGV2ZW50KS5lbmQoZXZlbnQpO1xuICAgICAgICAgIH0pO1xuICAgIH1cbiAgfTtcblxuICBicnVzaC5jbGVhciA9IGZ1bmN0aW9uKGdyb3VwLCBldmVudCkge1xuICAgIGJydXNoLm1vdmUoZ3JvdXAsIG51bGwsIGV2ZW50KTtcbiAgfTtcblxuICBmdW5jdGlvbiByZWRyYXcoKSB7XG4gICAgdmFyIGdyb3VwID0gc2VsZWN0KHRoaXMpLFxuICAgICAgICBzZWxlY3Rpb24gPSBsb2NhbCh0aGlzKS5zZWxlY3Rpb247XG5cbiAgICBpZiAoc2VsZWN0aW9uKSB7XG4gICAgICBncm91cC5zZWxlY3RBbGwoXCIuc2VsZWN0aW9uXCIpXG4gICAgICAgICAgLnN0eWxlKFwiZGlzcGxheVwiLCBudWxsKVxuICAgICAgICAgIC5hdHRyKFwieFwiLCBzZWxlY3Rpb25bMF1bMF0pXG4gICAgICAgICAgLmF0dHIoXCJ5XCIsIHNlbGVjdGlvblswXVsxXSlcbiAgICAgICAgICAuYXR0cihcIndpZHRoXCIsIHNlbGVjdGlvblsxXVswXSAtIHNlbGVjdGlvblswXVswXSlcbiAgICAgICAgICAuYXR0cihcImhlaWdodFwiLCBzZWxlY3Rpb25bMV1bMV0gLSBzZWxlY3Rpb25bMF1bMV0pO1xuXG4gICAgICBncm91cC5zZWxlY3RBbGwoXCIuaGFuZGxlXCIpXG4gICAgICAgICAgLnN0eWxlKFwiZGlzcGxheVwiLCBudWxsKVxuICAgICAgICAgIC5hdHRyKFwieFwiLCBmdW5jdGlvbihkKSB7IHJldHVybiBkLnR5cGVbZC50eXBlLmxlbmd0aCAtIDFdID09PSBcImVcIiA/IHNlbGVjdGlvblsxXVswXSAtIGhhbmRsZVNpemUgLyAyIDogc2VsZWN0aW9uWzBdWzBdIC0gaGFuZGxlU2l6ZSAvIDI7IH0pXG4gICAgICAgICAgLmF0dHIoXCJ5XCIsIGZ1bmN0aW9uKGQpIHsgcmV0dXJuIGQudHlwZVswXSA9PT0gXCJzXCIgPyBzZWxlY3Rpb25bMV1bMV0gLSBoYW5kbGVTaXplIC8gMiA6IHNlbGVjdGlvblswXVsxXSAtIGhhbmRsZVNpemUgLyAyOyB9KVxuICAgICAgICAgIC5hdHRyKFwid2lkdGhcIiwgZnVuY3Rpb24oZCkgeyByZXR1cm4gZC50eXBlID09PSBcIm5cIiB8fCBkLnR5cGUgPT09IFwic1wiID8gc2VsZWN0aW9uWzFdWzBdIC0gc2VsZWN0aW9uWzBdWzBdICsgaGFuZGxlU2l6ZSA6IGhhbmRsZVNpemU7IH0pXG4gICAgICAgICAgLmF0dHIoXCJoZWlnaHRcIiwgZnVuY3Rpb24oZCkgeyByZXR1cm4gZC50eXBlID09PSBcImVcIiB8fCBkLnR5cGUgPT09IFwid1wiID8gc2VsZWN0aW9uWzFdWzFdIC0gc2VsZWN0aW9uWzBdWzFdICsgaGFuZGxlU2l6ZSA6IGhhbmRsZVNpemU7IH0pO1xuICAgIH1cblxuICAgIGVsc2Uge1xuICAgICAgZ3JvdXAuc2VsZWN0QWxsKFwiLnNlbGVjdGlvbiwuaGFuZGxlXCIpXG4gICAgICAgICAgLnN0eWxlKFwiZGlzcGxheVwiLCBcIm5vbmVcIilcbiAgICAgICAgICAuYXR0cihcInhcIiwgbnVsbClcbiAgICAgICAgICAuYXR0cihcInlcIiwgbnVsbClcbiAgICAgICAgICAuYXR0cihcIndpZHRoXCIsIG51bGwpXG4gICAgICAgICAgLmF0dHIoXCJoZWlnaHRcIiwgbnVsbCk7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gZW1pdHRlcih0aGF0LCBhcmdzLCBjbGVhbikge1xuICAgIHZhciBlbWl0ID0gdGhhdC5fX2JydXNoLmVtaXR0ZXI7XG4gICAgcmV0dXJuIGVtaXQgJiYgKCFjbGVhbiB8fCAhZW1pdC5jbGVhbikgPyBlbWl0IDogbmV3IEVtaXR0ZXIodGhhdCwgYXJncywgY2xlYW4pO1xuICB9XG5cbiAgZnVuY3Rpb24gRW1pdHRlcih0aGF0LCBhcmdzLCBjbGVhbikge1xuICAgIHRoaXMudGhhdCA9IHRoYXQ7XG4gICAgdGhpcy5hcmdzID0gYXJncztcbiAgICB0aGlzLnN0YXRlID0gdGhhdC5fX2JydXNoO1xuICAgIHRoaXMuYWN0aXZlID0gMDtcbiAgICB0aGlzLmNsZWFuID0gY2xlYW47XG4gIH1cblxuICBFbWl0dGVyLnByb3RvdHlwZSA9IHtcbiAgICBiZWZvcmVzdGFydDogZnVuY3Rpb24oKSB7XG4gICAgICBpZiAoKyt0aGlzLmFjdGl2ZSA9PT0gMSkgdGhpcy5zdGF0ZS5lbWl0dGVyID0gdGhpcywgdGhpcy5zdGFydGluZyA9IHRydWU7XG4gICAgICByZXR1cm4gdGhpcztcbiAgICB9LFxuICAgIHN0YXJ0OiBmdW5jdGlvbihldmVudCwgbW9kZSkge1xuICAgICAgaWYgKHRoaXMuc3RhcnRpbmcpIHRoaXMuc3RhcnRpbmcgPSBmYWxzZSwgdGhpcy5lbWl0KFwic3RhcnRcIiwgZXZlbnQsIG1vZGUpO1xuICAgICAgZWxzZSB0aGlzLmVtaXQoXCJicnVzaFwiLCBldmVudCk7XG4gICAgICByZXR1cm4gdGhpcztcbiAgICB9LFxuICAgIGJydXNoOiBmdW5jdGlvbihldmVudCwgbW9kZSkge1xuICAgICAgdGhpcy5lbWl0KFwiYnJ1c2hcIiwgZXZlbnQsIG1vZGUpO1xuICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfSxcbiAgICBlbmQ6IGZ1bmN0aW9uKGV2ZW50LCBtb2RlKSB7XG4gICAgICBpZiAoLS10aGlzLmFjdGl2ZSA9PT0gMCkgZGVsZXRlIHRoaXMuc3RhdGUuZW1pdHRlciwgdGhpcy5lbWl0KFwiZW5kXCIsIGV2ZW50LCBtb2RlKTtcbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH0sXG4gICAgZW1pdDogZnVuY3Rpb24odHlwZSwgZXZlbnQsIG1vZGUpIHtcbiAgICAgIHZhciBkID0gc2VsZWN0KHRoaXMudGhhdCkuZGF0dW0oKTtcbiAgICAgIGxpc3RlbmVycy5jYWxsKFxuICAgICAgICB0eXBlLFxuICAgICAgICB0aGlzLnRoYXQsXG4gICAgICAgIG5ldyBCcnVzaEV2ZW50KHR5cGUsIHtcbiAgICAgICAgICBzb3VyY2VFdmVudDogZXZlbnQsXG4gICAgICAgICAgdGFyZ2V0OiBicnVzaCxcbiAgICAgICAgICBzZWxlY3Rpb246IGRpbS5vdXRwdXQodGhpcy5zdGF0ZS5zZWxlY3Rpb24pLFxuICAgICAgICAgIG1vZGUsXG4gICAgICAgICAgZGlzcGF0Y2g6IGxpc3RlbmVyc1xuICAgICAgICB9KSxcbiAgICAgICAgZFxuICAgICAgKTtcbiAgICB9XG4gIH07XG5cbiAgZnVuY3Rpb24gc3RhcnRlZChldmVudCkge1xuICAgIGlmICh0b3VjaGVuZGluZyAmJiAhZXZlbnQudG91Y2hlcykgcmV0dXJuO1xuICAgIGlmICghZmlsdGVyLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykpIHJldHVybjtcblxuICAgIHZhciB0aGF0ID0gdGhpcyxcbiAgICAgICAgdHlwZSA9IGV2ZW50LnRhcmdldC5fX2RhdGFfXy50eXBlLFxuICAgICAgICBtb2RlID0gKGtleXMgJiYgZXZlbnQubWV0YUtleSA/IHR5cGUgPSBcIm92ZXJsYXlcIiA6IHR5cGUpID09PSBcInNlbGVjdGlvblwiID8gTU9ERV9EUkFHIDogKGtleXMgJiYgZXZlbnQuYWx0S2V5ID8gTU9ERV9DRU5URVIgOiBNT0RFX0hBTkRMRSksXG4gICAgICAgIHNpZ25YID0gZGltID09PSBZID8gbnVsbCA6IHNpZ25zWFt0eXBlXSxcbiAgICAgICAgc2lnblkgPSBkaW0gPT09IFggPyBudWxsIDogc2lnbnNZW3R5cGVdLFxuICAgICAgICBzdGF0ZSA9IGxvY2FsKHRoYXQpLFxuICAgICAgICBleHRlbnQgPSBzdGF0ZS5leHRlbnQsXG4gICAgICAgIHNlbGVjdGlvbiA9IHN0YXRlLnNlbGVjdGlvbixcbiAgICAgICAgVyA9IGV4dGVudFswXVswXSwgdzAsIHcxLFxuICAgICAgICBOID0gZXh0ZW50WzBdWzFdLCBuMCwgbjEsXG4gICAgICAgIEUgPSBleHRlbnRbMV1bMF0sIGUwLCBlMSxcbiAgICAgICAgUyA9IGV4dGVudFsxXVsxXSwgczAsIHMxLFxuICAgICAgICBkeCA9IDAsXG4gICAgICAgIGR5ID0gMCxcbiAgICAgICAgbW92aW5nLFxuICAgICAgICBzaGlmdGluZyA9IHNpZ25YICYmIHNpZ25ZICYmIGtleXMgJiYgZXZlbnQuc2hpZnRLZXksXG4gICAgICAgIGxvY2tYLFxuICAgICAgICBsb2NrWSxcbiAgICAgICAgcG9pbnRzID0gQXJyYXkuZnJvbShldmVudC50b3VjaGVzIHx8IFtldmVudF0sIHQgPT4ge1xuICAgICAgICAgIGNvbnN0IGkgPSB0LmlkZW50aWZpZXI7XG4gICAgICAgICAgdCA9IHBvaW50ZXIodCwgdGhhdCk7XG4gICAgICAgICAgdC5wb2ludDAgPSB0LnNsaWNlKCk7XG4gICAgICAgICAgdC5pZGVudGlmaWVyID0gaTtcbiAgICAgICAgICByZXR1cm4gdDtcbiAgICAgICAgfSk7XG5cbiAgICBpbnRlcnJ1cHQodGhhdCk7XG4gICAgdmFyIGVtaXQgPSBlbWl0dGVyKHRoYXQsIGFyZ3VtZW50cywgdHJ1ZSkuYmVmb3Jlc3RhcnQoKTtcblxuICAgIGlmICh0eXBlID09PSBcIm92ZXJsYXlcIikge1xuICAgICAgaWYgKHNlbGVjdGlvbikgbW92aW5nID0gdHJ1ZTtcbiAgICAgIGNvbnN0IHB0cyA9IFtwb2ludHNbMF0sIHBvaW50c1sxXSB8fCBwb2ludHNbMF1dO1xuICAgICAgc3RhdGUuc2VsZWN0aW9uID0gc2VsZWN0aW9uID0gW1tcbiAgICAgICAgICB3MCA9IGRpbSA9PT0gWSA/IFcgOiBtaW4ocHRzWzBdWzBdLCBwdHNbMV1bMF0pLFxuICAgICAgICAgIG4wID0gZGltID09PSBYID8gTiA6IG1pbihwdHNbMF1bMV0sIHB0c1sxXVsxXSlcbiAgICAgICAgXSwgW1xuICAgICAgICAgIGUwID0gZGltID09PSBZID8gRSA6IG1heChwdHNbMF1bMF0sIHB0c1sxXVswXSksXG4gICAgICAgICAgczAgPSBkaW0gPT09IFggPyBTIDogbWF4KHB0c1swXVsxXSwgcHRzWzFdWzFdKVxuICAgICAgICBdXTtcbiAgICAgIGlmIChwb2ludHMubGVuZ3RoID4gMSkgbW92ZShldmVudCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHcwID0gc2VsZWN0aW9uWzBdWzBdO1xuICAgICAgbjAgPSBzZWxlY3Rpb25bMF1bMV07XG4gICAgICBlMCA9IHNlbGVjdGlvblsxXVswXTtcbiAgICAgIHMwID0gc2VsZWN0aW9uWzFdWzFdO1xuICAgIH1cblxuICAgIHcxID0gdzA7XG4gICAgbjEgPSBuMDtcbiAgICBlMSA9IGUwO1xuICAgIHMxID0gczA7XG5cbiAgICB2YXIgZ3JvdXAgPSBzZWxlY3QodGhhdClcbiAgICAgICAgLmF0dHIoXCJwb2ludGVyLWV2ZW50c1wiLCBcIm5vbmVcIik7XG5cbiAgICB2YXIgb3ZlcmxheSA9IGdyb3VwLnNlbGVjdEFsbChcIi5vdmVybGF5XCIpXG4gICAgICAgIC5hdHRyKFwiY3Vyc29yXCIsIGN1cnNvcnNbdHlwZV0pO1xuXG4gICAgaWYgKGV2ZW50LnRvdWNoZXMpIHtcbiAgICAgIGVtaXQubW92ZWQgPSBtb3ZlZDtcbiAgICAgIGVtaXQuZW5kZWQgPSBlbmRlZDtcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIHZpZXcgPSBzZWxlY3QoZXZlbnQudmlldylcbiAgICAgICAgICAub24oXCJtb3VzZW1vdmUuYnJ1c2hcIiwgbW92ZWQsIHRydWUpXG4gICAgICAgICAgLm9uKFwibW91c2V1cC5icnVzaFwiLCBlbmRlZCwgdHJ1ZSk7XG4gICAgICBpZiAoa2V5cykgdmlld1xuICAgICAgICAgIC5vbihcImtleWRvd24uYnJ1c2hcIiwga2V5ZG93bmVkLCB0cnVlKVxuICAgICAgICAgIC5vbihcImtleXVwLmJydXNoXCIsIGtleXVwcGVkLCB0cnVlKVxuXG4gICAgICBkcmFnRGlzYWJsZShldmVudC52aWV3KTtcbiAgICB9XG5cbiAgICByZWRyYXcuY2FsbCh0aGF0KTtcbiAgICBlbWl0LnN0YXJ0KGV2ZW50LCBtb2RlLm5hbWUpO1xuXG4gICAgZnVuY3Rpb24gbW92ZWQoZXZlbnQpIHtcbiAgICAgIGZvciAoY29uc3QgcCBvZiBldmVudC5jaGFuZ2VkVG91Y2hlcyB8fCBbZXZlbnRdKSB7XG4gICAgICAgIGZvciAoY29uc3QgZCBvZiBwb2ludHMpXG4gICAgICAgICAgaWYgKGQuaWRlbnRpZmllciA9PT0gcC5pZGVudGlmaWVyKSBkLmN1ciA9IHBvaW50ZXIocCwgdGhhdCk7XG4gICAgICB9XG4gICAgICBpZiAoc2hpZnRpbmcgJiYgIWxvY2tYICYmICFsb2NrWSAmJiBwb2ludHMubGVuZ3RoID09PSAxKSB7XG4gICAgICAgIGNvbnN0IHBvaW50ID0gcG9pbnRzWzBdO1xuICAgICAgICBpZiAoYWJzKHBvaW50LmN1clswXSAtIHBvaW50WzBdKSA+IGFicyhwb2ludC5jdXJbMV0gLSBwb2ludFsxXSkpXG4gICAgICAgICAgbG9ja1kgPSB0cnVlO1xuICAgICAgICBlbHNlXG4gICAgICAgICAgbG9ja1ggPSB0cnVlO1xuICAgICAgfVxuICAgICAgZm9yIChjb25zdCBwb2ludCBvZiBwb2ludHMpXG4gICAgICAgIGlmIChwb2ludC5jdXIpIHBvaW50WzBdID0gcG9pbnQuY3VyWzBdLCBwb2ludFsxXSA9IHBvaW50LmN1clsxXTtcbiAgICAgIG1vdmluZyA9IHRydWU7XG4gICAgICBub2V2ZW50KGV2ZW50KTtcbiAgICAgIG1vdmUoZXZlbnQpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG1vdmUoZXZlbnQpIHtcbiAgICAgIGNvbnN0IHBvaW50ID0gcG9pbnRzWzBdLCBwb2ludDAgPSBwb2ludC5wb2ludDA7XG4gICAgICB2YXIgdDtcblxuICAgICAgZHggPSBwb2ludFswXSAtIHBvaW50MFswXTtcbiAgICAgIGR5ID0gcG9pbnRbMV0gLSBwb2ludDBbMV07XG5cbiAgICAgIHN3aXRjaCAobW9kZSkge1xuICAgICAgICBjYXNlIE1PREVfU1BBQ0U6XG4gICAgICAgIGNhc2UgTU9ERV9EUkFHOiB7XG4gICAgICAgICAgaWYgKHNpZ25YKSBkeCA9IG1heChXIC0gdzAsIG1pbihFIC0gZTAsIGR4KSksIHcxID0gdzAgKyBkeCwgZTEgPSBlMCArIGR4O1xuICAgICAgICAgIGlmIChzaWduWSkgZHkgPSBtYXgoTiAtIG4wLCBtaW4oUyAtIHMwLCBkeSkpLCBuMSA9IG4wICsgZHksIHMxID0gczAgKyBkeTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjYXNlIE1PREVfSEFORExFOiB7XG4gICAgICAgICAgaWYgKHBvaW50c1sxXSkge1xuICAgICAgICAgICAgaWYgKHNpZ25YKSB3MSA9IG1heChXLCBtaW4oRSwgcG9pbnRzWzBdWzBdKSksIGUxID0gbWF4KFcsIG1pbihFLCBwb2ludHNbMV1bMF0pKSwgc2lnblggPSAxO1xuICAgICAgICAgICAgaWYgKHNpZ25ZKSBuMSA9IG1heChOLCBtaW4oUywgcG9pbnRzWzBdWzFdKSksIHMxID0gbWF4KE4sIG1pbihTLCBwb2ludHNbMV1bMV0pKSwgc2lnblkgPSAxO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpZiAoc2lnblggPCAwKSBkeCA9IG1heChXIC0gdzAsIG1pbihFIC0gdzAsIGR4KSksIHcxID0gdzAgKyBkeCwgZTEgPSBlMDtcbiAgICAgICAgICAgIGVsc2UgaWYgKHNpZ25YID4gMCkgZHggPSBtYXgoVyAtIGUwLCBtaW4oRSAtIGUwLCBkeCkpLCB3MSA9IHcwLCBlMSA9IGUwICsgZHg7XG4gICAgICAgICAgICBpZiAoc2lnblkgPCAwKSBkeSA9IG1heChOIC0gbjAsIG1pbihTIC0gbjAsIGR5KSksIG4xID0gbjAgKyBkeSwgczEgPSBzMDtcbiAgICAgICAgICAgIGVsc2UgaWYgKHNpZ25ZID4gMCkgZHkgPSBtYXgoTiAtIHMwLCBtaW4oUyAtIHMwLCBkeSkpLCBuMSA9IG4wLCBzMSA9IHMwICsgZHk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGNhc2UgTU9ERV9DRU5URVI6IHtcbiAgICAgICAgICBpZiAoc2lnblgpIHcxID0gbWF4KFcsIG1pbihFLCB3MCAtIGR4ICogc2lnblgpKSwgZTEgPSBtYXgoVywgbWluKEUsIGUwICsgZHggKiBzaWduWCkpO1xuICAgICAgICAgIGlmIChzaWduWSkgbjEgPSBtYXgoTiwgbWluKFMsIG4wIC0gZHkgKiBzaWduWSkpLCBzMSA9IG1heChOLCBtaW4oUywgczAgKyBkeSAqIHNpZ25ZKSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKGUxIDwgdzEpIHtcbiAgICAgICAgc2lnblggKj0gLTE7XG4gICAgICAgIHQgPSB3MCwgdzAgPSBlMCwgZTAgPSB0O1xuICAgICAgICB0ID0gdzEsIHcxID0gZTEsIGUxID0gdDtcbiAgICAgICAgaWYgKHR5cGUgaW4gZmxpcFgpIG92ZXJsYXkuYXR0cihcImN1cnNvclwiLCBjdXJzb3JzW3R5cGUgPSBmbGlwWFt0eXBlXV0pO1xuICAgICAgfVxuXG4gICAgICBpZiAoczEgPCBuMSkge1xuICAgICAgICBzaWduWSAqPSAtMTtcbiAgICAgICAgdCA9IG4wLCBuMCA9IHMwLCBzMCA9IHQ7XG4gICAgICAgIHQgPSBuMSwgbjEgPSBzMSwgczEgPSB0O1xuICAgICAgICBpZiAodHlwZSBpbiBmbGlwWSkgb3ZlcmxheS5hdHRyKFwiY3Vyc29yXCIsIGN1cnNvcnNbdHlwZSA9IGZsaXBZW3R5cGVdXSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChzdGF0ZS5zZWxlY3Rpb24pIHNlbGVjdGlvbiA9IHN0YXRlLnNlbGVjdGlvbjsgLy8gTWF5IGJlIHNldCBieSBicnVzaC5tb3ZlIVxuICAgICAgaWYgKGxvY2tYKSB3MSA9IHNlbGVjdGlvblswXVswXSwgZTEgPSBzZWxlY3Rpb25bMV1bMF07XG4gICAgICBpZiAobG9ja1kpIG4xID0gc2VsZWN0aW9uWzBdWzFdLCBzMSA9IHNlbGVjdGlvblsxXVsxXTtcblxuICAgICAgaWYgKHNlbGVjdGlvblswXVswXSAhPT0gdzFcbiAgICAgICAgICB8fCBzZWxlY3Rpb25bMF1bMV0gIT09IG4xXG4gICAgICAgICAgfHwgc2VsZWN0aW9uWzFdWzBdICE9PSBlMVxuICAgICAgICAgIHx8IHNlbGVjdGlvblsxXVsxXSAhPT0gczEpIHtcbiAgICAgICAgc3RhdGUuc2VsZWN0aW9uID0gW1t3MSwgbjFdLCBbZTEsIHMxXV07XG4gICAgICAgIHJlZHJhdy5jYWxsKHRoYXQpO1xuICAgICAgICBlbWl0LmJydXNoKGV2ZW50LCBtb2RlLm5hbWUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGVuZGVkKGV2ZW50KSB7XG4gICAgICBub3Byb3BhZ2F0aW9uKGV2ZW50KTtcbiAgICAgIGlmIChldmVudC50b3VjaGVzKSB7XG4gICAgICAgIGlmIChldmVudC50b3VjaGVzLmxlbmd0aCkgcmV0dXJuO1xuICAgICAgICBpZiAodG91Y2hlbmRpbmcpIGNsZWFyVGltZW91dCh0b3VjaGVuZGluZyk7XG4gICAgICAgIHRvdWNoZW5kaW5nID0gc2V0VGltZW91dChmdW5jdGlvbigpIHsgdG91Y2hlbmRpbmcgPSBudWxsOyB9LCA1MDApOyAvLyBHaG9zdCBjbGlja3MgYXJlIGRlbGF5ZWQhXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkcmFnRW5hYmxlKGV2ZW50LnZpZXcsIG1vdmluZyk7XG4gICAgICAgIHZpZXcub24oXCJrZXlkb3duLmJydXNoIGtleXVwLmJydXNoIG1vdXNlbW92ZS5icnVzaCBtb3VzZXVwLmJydXNoXCIsIG51bGwpO1xuICAgICAgfVxuICAgICAgZ3JvdXAuYXR0cihcInBvaW50ZXItZXZlbnRzXCIsIFwiYWxsXCIpO1xuICAgICAgb3ZlcmxheS5hdHRyKFwiY3Vyc29yXCIsIGN1cnNvcnMub3ZlcmxheSk7XG4gICAgICBpZiAoc3RhdGUuc2VsZWN0aW9uKSBzZWxlY3Rpb24gPSBzdGF0ZS5zZWxlY3Rpb247IC8vIE1heSBiZSBzZXQgYnkgYnJ1c2gubW92ZSAob24gc3RhcnQpIVxuICAgICAgaWYgKGVtcHR5KHNlbGVjdGlvbikpIHN0YXRlLnNlbGVjdGlvbiA9IG51bGwsIHJlZHJhdy5jYWxsKHRoYXQpO1xuICAgICAgZW1pdC5lbmQoZXZlbnQsIG1vZGUubmFtZSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24ga2V5ZG93bmVkKGV2ZW50KSB7XG4gICAgICBzd2l0Y2ggKGV2ZW50LmtleUNvZGUpIHtcbiAgICAgICAgY2FzZSAxNjogeyAvLyBTSElGVFxuICAgICAgICAgIHNoaWZ0aW5nID0gc2lnblggJiYgc2lnblk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgY2FzZSAxODogeyAvLyBBTFRcbiAgICAgICAgICBpZiAobW9kZSA9PT0gTU9ERV9IQU5ETEUpIHtcbiAgICAgICAgICAgIGlmIChzaWduWCkgZTAgPSBlMSAtIGR4ICogc2lnblgsIHcwID0gdzEgKyBkeCAqIHNpZ25YO1xuICAgICAgICAgICAgaWYgKHNpZ25ZKSBzMCA9IHMxIC0gZHkgKiBzaWduWSwgbjAgPSBuMSArIGR5ICogc2lnblk7XG4gICAgICAgICAgICBtb2RlID0gTU9ERV9DRU5URVI7XG4gICAgICAgICAgICBtb3ZlKGV2ZW50KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgY2FzZSAzMjogeyAvLyBTUEFDRTsgdGFrZXMgcHJpb3JpdHkgb3ZlciBBTFRcbiAgICAgICAgICBpZiAobW9kZSA9PT0gTU9ERV9IQU5ETEUgfHwgbW9kZSA9PT0gTU9ERV9DRU5URVIpIHtcbiAgICAgICAgICAgIGlmIChzaWduWCA8IDApIGUwID0gZTEgLSBkeDsgZWxzZSBpZiAoc2lnblggPiAwKSB3MCA9IHcxIC0gZHg7XG4gICAgICAgICAgICBpZiAoc2lnblkgPCAwKSBzMCA9IHMxIC0gZHk7IGVsc2UgaWYgKHNpZ25ZID4gMCkgbjAgPSBuMSAtIGR5O1xuICAgICAgICAgICAgbW9kZSA9IE1PREVfU1BBQ0U7XG4gICAgICAgICAgICBvdmVybGF5LmF0dHIoXCJjdXJzb3JcIiwgY3Vyc29ycy5zZWxlY3Rpb24pO1xuICAgICAgICAgICAgbW92ZShldmVudCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGRlZmF1bHQ6IHJldHVybjtcbiAgICAgIH1cbiAgICAgIG5vZXZlbnQoZXZlbnQpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGtleXVwcGVkKGV2ZW50KSB7XG4gICAgICBzd2l0Y2ggKGV2ZW50LmtleUNvZGUpIHtcbiAgICAgICAgY2FzZSAxNjogeyAvLyBTSElGVFxuICAgICAgICAgIGlmIChzaGlmdGluZykge1xuICAgICAgICAgICAgbG9ja1ggPSBsb2NrWSA9IHNoaWZ0aW5nID0gZmFsc2U7XG4gICAgICAgICAgICBtb3ZlKGV2ZW50KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgY2FzZSAxODogeyAvLyBBTFRcbiAgICAgICAgICBpZiAobW9kZSA9PT0gTU9ERV9DRU5URVIpIHtcbiAgICAgICAgICAgIGlmIChzaWduWCA8IDApIGUwID0gZTE7IGVsc2UgaWYgKHNpZ25YID4gMCkgdzAgPSB3MTtcbiAgICAgICAgICAgIGlmIChzaWduWSA8IDApIHMwID0gczE7IGVsc2UgaWYgKHNpZ25ZID4gMCkgbjAgPSBuMTtcbiAgICAgICAgICAgIG1vZGUgPSBNT0RFX0hBTkRMRTtcbiAgICAgICAgICAgIG1vdmUoZXZlbnQpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjYXNlIDMyOiB7IC8vIFNQQUNFXG4gICAgICAgICAgaWYgKG1vZGUgPT09IE1PREVfU1BBQ0UpIHtcbiAgICAgICAgICAgIGlmIChldmVudC5hbHRLZXkpIHtcbiAgICAgICAgICAgICAgaWYgKHNpZ25YKSBlMCA9IGUxIC0gZHggKiBzaWduWCwgdzAgPSB3MSArIGR4ICogc2lnblg7XG4gICAgICAgICAgICAgIGlmIChzaWduWSkgczAgPSBzMSAtIGR5ICogc2lnblksIG4wID0gbjEgKyBkeSAqIHNpZ25ZO1xuICAgICAgICAgICAgICBtb2RlID0gTU9ERV9DRU5URVI7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBpZiAoc2lnblggPCAwKSBlMCA9IGUxOyBlbHNlIGlmIChzaWduWCA+IDApIHcwID0gdzE7XG4gICAgICAgICAgICAgIGlmIChzaWduWSA8IDApIHMwID0gczE7IGVsc2UgaWYgKHNpZ25ZID4gMCkgbjAgPSBuMTtcbiAgICAgICAgICAgICAgbW9kZSA9IE1PREVfSEFORExFO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgb3ZlcmxheS5hdHRyKFwiY3Vyc29yXCIsIGN1cnNvcnNbdHlwZV0pO1xuICAgICAgICAgICAgbW92ZShldmVudCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGRlZmF1bHQ6IHJldHVybjtcbiAgICAgIH1cbiAgICAgIG5vZXZlbnQoZXZlbnQpO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHRvdWNobW92ZWQoZXZlbnQpIHtcbiAgICBlbWl0dGVyKHRoaXMsIGFyZ3VtZW50cykubW92ZWQoZXZlbnQpO1xuICB9XG5cbiAgZnVuY3Rpb24gdG91Y2hlbmRlZChldmVudCkge1xuICAgIGVtaXR0ZXIodGhpcywgYXJndW1lbnRzKS5lbmRlZChldmVudCk7XG4gIH1cblxuICBmdW5jdGlvbiBpbml0aWFsaXplKCkge1xuICAgIHZhciBzdGF0ZSA9IHRoaXMuX19icnVzaCB8fCB7c2VsZWN0aW9uOiBudWxsfTtcbiAgICBzdGF0ZS5leHRlbnQgPSBudW1iZXIyKGV4dGVudC5hcHBseSh0aGlzLCBhcmd1bWVudHMpKTtcbiAgICBzdGF0ZS5kaW0gPSBkaW07XG4gICAgcmV0dXJuIHN0YXRlO1xuICB9XG5cbiAgYnJ1c2guZXh0ZW50ID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGV4dGVudCA9IHR5cGVvZiBfID09PSBcImZ1bmN0aW9uXCIgPyBfIDogY29uc3RhbnQobnVtYmVyMihfKSksIGJydXNoKSA6IGV4dGVudDtcbiAgfTtcblxuICBicnVzaC5maWx0ZXIgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoZmlsdGVyID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudCghIV8pLCBicnVzaCkgOiBmaWx0ZXI7XG4gIH07XG5cbiAgYnJ1c2gudG91Y2hhYmxlID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHRvdWNoYWJsZSA9IHR5cGVvZiBfID09PSBcImZ1bmN0aW9uXCIgPyBfIDogY29uc3RhbnQoISFfKSwgYnJ1c2gpIDogdG91Y2hhYmxlO1xuICB9O1xuXG4gIGJydXNoLmhhbmRsZVNpemUgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoaGFuZGxlU2l6ZSA9ICtfLCBicnVzaCkgOiBoYW5kbGVTaXplO1xuICB9O1xuXG4gIGJydXNoLmtleU1vZGlmaWVycyA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChrZXlzID0gISFfLCBicnVzaCkgOiBrZXlzO1xuICB9O1xuXG4gIGJydXNoLm9uID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHZhbHVlID0gbGlzdGVuZXJzLm9uLmFwcGx5KGxpc3RlbmVycywgYXJndW1lbnRzKTtcbiAgICByZXR1cm4gdmFsdWUgPT09IGxpc3RlbmVycyA/IGJydXNoIDogdmFsdWU7XG4gIH07XG5cbiAgcmV0dXJuIGJydXNoO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGQpIHtcbiAgY29uc3QgeCA9ICt0aGlzLl94LmNhbGwobnVsbCwgZCksXG4gICAgICB5ID0gK3RoaXMuX3kuY2FsbChudWxsLCBkKTtcbiAgcmV0dXJuIGFkZCh0aGlzLmNvdmVyKHgsIHkpLCB4LCB5LCBkKTtcbn1cblxuZnVuY3Rpb24gYWRkKHRyZWUsIHgsIHksIGQpIHtcbiAgaWYgKGlzTmFOKHgpIHx8IGlzTmFOKHkpKSByZXR1cm4gdHJlZTsgLy8gaWdub3JlIGludmFsaWQgcG9pbnRzXG5cbiAgdmFyIHBhcmVudCxcbiAgICAgIG5vZGUgPSB0cmVlLl9yb290LFxuICAgICAgbGVhZiA9IHtkYXRhOiBkfSxcbiAgICAgIHgwID0gdHJlZS5feDAsXG4gICAgICB5MCA9IHRyZWUuX3kwLFxuICAgICAgeDEgPSB0cmVlLl94MSxcbiAgICAgIHkxID0gdHJlZS5feTEsXG4gICAgICB4bSxcbiAgICAgIHltLFxuICAgICAgeHAsXG4gICAgICB5cCxcbiAgICAgIHJpZ2h0LFxuICAgICAgYm90dG9tLFxuICAgICAgaSxcbiAgICAgIGo7XG5cbiAgLy8gSWYgdGhlIHRyZWUgaXMgZW1wdHksIGluaXRpYWxpemUgdGhlIHJvb3QgYXMgYSBsZWFmLlxuICBpZiAoIW5vZGUpIHJldHVybiB0cmVlLl9yb290ID0gbGVhZiwgdHJlZTtcblxuICAvLyBGaW5kIHRoZSBleGlzdGluZyBsZWFmIGZvciB0aGUgbmV3IHBvaW50LCBvciBhZGQgaXQuXG4gIHdoaWxlIChub2RlLmxlbmd0aCkge1xuICAgIGlmIChyaWdodCA9IHggPj0gKHhtID0gKHgwICsgeDEpIC8gMikpIHgwID0geG07IGVsc2UgeDEgPSB4bTtcbiAgICBpZiAoYm90dG9tID0geSA+PSAoeW0gPSAoeTAgKyB5MSkgLyAyKSkgeTAgPSB5bTsgZWxzZSB5MSA9IHltO1xuICAgIGlmIChwYXJlbnQgPSBub2RlLCAhKG5vZGUgPSBub2RlW2kgPSBib3R0b20gPDwgMSB8IHJpZ2h0XSkpIHJldHVybiBwYXJlbnRbaV0gPSBsZWFmLCB0cmVlO1xuICB9XG5cbiAgLy8gSXMgdGhlIG5ldyBwb2ludCBpcyBleGFjdGx5IGNvaW5jaWRlbnQgd2l0aCB0aGUgZXhpc3RpbmcgcG9pbnQ/XG4gIHhwID0gK3RyZWUuX3guY2FsbChudWxsLCBub2RlLmRhdGEpO1xuICB5cCA9ICt0cmVlLl95LmNhbGwobnVsbCwgbm9kZS5kYXRhKTtcbiAgaWYgKHggPT09IHhwICYmIHkgPT09IHlwKSByZXR1cm4gbGVhZi5uZXh0ID0gbm9kZSwgcGFyZW50ID8gcGFyZW50W2ldID0gbGVhZiA6IHRyZWUuX3Jvb3QgPSBsZWFmLCB0cmVlO1xuXG4gIC8vIE90aGVyd2lzZSwgc3BsaXQgdGhlIGxlYWYgbm9kZSB1bnRpbCB0aGUgb2xkIGFuZCBuZXcgcG9pbnQgYXJlIHNlcGFyYXRlZC5cbiAgZG8ge1xuICAgIHBhcmVudCA9IHBhcmVudCA/IHBhcmVudFtpXSA9IG5ldyBBcnJheSg0KSA6IHRyZWUuX3Jvb3QgPSBuZXcgQXJyYXkoNCk7XG4gICAgaWYgKHJpZ2h0ID0geCA+PSAoeG0gPSAoeDAgKyB4MSkgLyAyKSkgeDAgPSB4bTsgZWxzZSB4MSA9IHhtO1xuICAgIGlmIChib3R0b20gPSB5ID49ICh5bSA9ICh5MCArIHkxKSAvIDIpKSB5MCA9IHltOyBlbHNlIHkxID0geW07XG4gIH0gd2hpbGUgKChpID0gYm90dG9tIDw8IDEgfCByaWdodCkgPT09IChqID0gKHlwID49IHltKSA8PCAxIHwgKHhwID49IHhtKSkpO1xuICByZXR1cm4gcGFyZW50W2pdID0gbm9kZSwgcGFyZW50W2ldID0gbGVhZiwgdHJlZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFkZEFsbChkYXRhKSB7XG4gIHZhciBkLCBpLCBuID0gZGF0YS5sZW5ndGgsXG4gICAgICB4LFxuICAgICAgeSxcbiAgICAgIHh6ID0gbmV3IEFycmF5KG4pLFxuICAgICAgeXogPSBuZXcgQXJyYXkobiksXG4gICAgICB4MCA9IEluZmluaXR5LFxuICAgICAgeTAgPSBJbmZpbml0eSxcbiAgICAgIHgxID0gLUluZmluaXR5LFxuICAgICAgeTEgPSAtSW5maW5pdHk7XG5cbiAgLy8gQ29tcHV0ZSB0aGUgcG9pbnRzIGFuZCB0aGVpciBleHRlbnQuXG4gIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICBpZiAoaXNOYU4oeCA9ICt0aGlzLl94LmNhbGwobnVsbCwgZCA9IGRhdGFbaV0pKSB8fCBpc05hTih5ID0gK3RoaXMuX3kuY2FsbChudWxsLCBkKSkpIGNvbnRpbnVlO1xuICAgIHh6W2ldID0geDtcbiAgICB5eltpXSA9IHk7XG4gICAgaWYgKHggPCB4MCkgeDAgPSB4O1xuICAgIGlmICh4ID4geDEpIHgxID0geDtcbiAgICBpZiAoeSA8IHkwKSB5MCA9IHk7XG4gICAgaWYgKHkgPiB5MSkgeTEgPSB5O1xuICB9XG5cbiAgLy8gSWYgdGhlcmUgd2VyZSBubyAodmFsaWQpIHBvaW50cywgYWJvcnQuXG4gIGlmICh4MCA+IHgxIHx8IHkwID4geTEpIHJldHVybiB0aGlzO1xuXG4gIC8vIEV4cGFuZCB0aGUgdHJlZSB0byBjb3ZlciB0aGUgbmV3IHBvaW50cy5cbiAgdGhpcy5jb3Zlcih4MCwgeTApLmNvdmVyKHgxLCB5MSk7XG5cbiAgLy8gQWRkIHRoZSBuZXcgcG9pbnRzLlxuICBmb3IgKGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgYWRkKHRoaXMsIHh6W2ldLCB5eltpXSwgZGF0YVtpXSk7XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbih4LCB5KSB7XG4gIGlmIChpc05hTih4ID0gK3gpIHx8IGlzTmFOKHkgPSAreSkpIHJldHVybiB0aGlzOyAvLyBpZ25vcmUgaW52YWxpZCBwb2ludHNcblxuICB2YXIgeDAgPSB0aGlzLl94MCxcbiAgICAgIHkwID0gdGhpcy5feTAsXG4gICAgICB4MSA9IHRoaXMuX3gxLFxuICAgICAgeTEgPSB0aGlzLl95MTtcblxuICAvLyBJZiB0aGUgcXVhZHRyZWUgaGFzIG5vIGV4dGVudCwgaW5pdGlhbGl6ZSB0aGVtLlxuICAvLyBJbnRlZ2VyIGV4dGVudCBhcmUgbmVjZXNzYXJ5IHNvIHRoYXQgaWYgd2UgbGF0ZXIgZG91YmxlIHRoZSBleHRlbnQsXG4gIC8vIHRoZSBleGlzdGluZyBxdWFkcmFudCBib3VuZGFyaWVzIGRvblx1MjAxOXQgY2hhbmdlIGR1ZSB0byBmbG9hdGluZyBwb2ludCBlcnJvciFcbiAgaWYgKGlzTmFOKHgwKSkge1xuICAgIHgxID0gKHgwID0gTWF0aC5mbG9vcih4KSkgKyAxO1xuICAgIHkxID0gKHkwID0gTWF0aC5mbG9vcih5KSkgKyAxO1xuICB9XG5cbiAgLy8gT3RoZXJ3aXNlLCBkb3VibGUgcmVwZWF0ZWRseSB0byBjb3Zlci5cbiAgZWxzZSB7XG4gICAgdmFyIHogPSB4MSAtIHgwIHx8IDEsXG4gICAgICAgIG5vZGUgPSB0aGlzLl9yb290LFxuICAgICAgICBwYXJlbnQsXG4gICAgICAgIGk7XG5cbiAgICB3aGlsZSAoeDAgPiB4IHx8IHggPj0geDEgfHwgeTAgPiB5IHx8IHkgPj0geTEpIHtcbiAgICAgIGkgPSAoeSA8IHkwKSA8PCAxIHwgKHggPCB4MCk7XG4gICAgICBwYXJlbnQgPSBuZXcgQXJyYXkoNCksIHBhcmVudFtpXSA9IG5vZGUsIG5vZGUgPSBwYXJlbnQsIHogKj0gMjtcbiAgICAgIHN3aXRjaCAoaSkge1xuICAgICAgICBjYXNlIDA6IHgxID0geDAgKyB6LCB5MSA9IHkwICsgejsgYnJlYWs7XG4gICAgICAgIGNhc2UgMTogeDAgPSB4MSAtIHosIHkxID0geTAgKyB6OyBicmVhaztcbiAgICAgICAgY2FzZSAyOiB4MSA9IHgwICsgeiwgeTAgPSB5MSAtIHo7IGJyZWFrO1xuICAgICAgICBjYXNlIDM6IHgwID0geDEgLSB6LCB5MCA9IHkxIC0gejsgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX3Jvb3QgJiYgdGhpcy5fcm9vdC5sZW5ndGgpIHRoaXMuX3Jvb3QgPSBub2RlO1xuICB9XG5cbiAgdGhpcy5feDAgPSB4MDtcbiAgdGhpcy5feTAgPSB5MDtcbiAgdGhpcy5feDEgPSB4MTtcbiAgdGhpcy5feTEgPSB5MTtcbiAgcmV0dXJuIHRoaXM7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIHZhciBkYXRhID0gW107XG4gIHRoaXMudmlzaXQoZnVuY3Rpb24obm9kZSkge1xuICAgIGlmICghbm9kZS5sZW5ndGgpIGRvIGRhdGEucHVzaChub2RlLmRhdGEpOyB3aGlsZSAobm9kZSA9IG5vZGUubmV4dClcbiAgfSk7XG4gIHJldHVybiBkYXRhO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKF8pIHtcbiAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGhcbiAgICAgID8gdGhpcy5jb3ZlcigrX1swXVswXSwgK19bMF1bMV0pLmNvdmVyKCtfWzFdWzBdLCArX1sxXVsxXSlcbiAgICAgIDogaXNOYU4odGhpcy5feDApID8gdW5kZWZpbmVkIDogW1t0aGlzLl94MCwgdGhpcy5feTBdLCBbdGhpcy5feDEsIHRoaXMuX3kxXV07XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obm9kZSwgeDAsIHkwLCB4MSwgeTEpIHtcbiAgdGhpcy5ub2RlID0gbm9kZTtcbiAgdGhpcy54MCA9IHgwO1xuICB0aGlzLnkwID0geTA7XG4gIHRoaXMueDEgPSB4MTtcbiAgdGhpcy55MSA9IHkxO1xufVxuIiwgImltcG9ydCBRdWFkIGZyb20gXCIuL3F1YWQuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oeCwgeSwgcmFkaXVzKSB7XG4gIHZhciBkYXRhLFxuICAgICAgeDAgPSB0aGlzLl94MCxcbiAgICAgIHkwID0gdGhpcy5feTAsXG4gICAgICB4MSxcbiAgICAgIHkxLFxuICAgICAgeDIsXG4gICAgICB5MixcbiAgICAgIHgzID0gdGhpcy5feDEsXG4gICAgICB5MyA9IHRoaXMuX3kxLFxuICAgICAgcXVhZHMgPSBbXSxcbiAgICAgIG5vZGUgPSB0aGlzLl9yb290LFxuICAgICAgcSxcbiAgICAgIGk7XG5cbiAgaWYgKG5vZGUpIHF1YWRzLnB1c2gobmV3IFF1YWQobm9kZSwgeDAsIHkwLCB4MywgeTMpKTtcbiAgaWYgKHJhZGl1cyA9PSBudWxsKSByYWRpdXMgPSBJbmZpbml0eTtcbiAgZWxzZSB7XG4gICAgeDAgPSB4IC0gcmFkaXVzLCB5MCA9IHkgLSByYWRpdXM7XG4gICAgeDMgPSB4ICsgcmFkaXVzLCB5MyA9IHkgKyByYWRpdXM7XG4gICAgcmFkaXVzICo9IHJhZGl1cztcbiAgfVxuXG4gIHdoaWxlIChxID0gcXVhZHMucG9wKCkpIHtcblxuICAgIC8vIFN0b3Agc2VhcmNoaW5nIGlmIHRoaXMgcXVhZHJhbnQgY2FuXHUyMDE5dCBjb250YWluIGEgY2xvc2VyIG5vZGUuXG4gICAgaWYgKCEobm9kZSA9IHEubm9kZSlcbiAgICAgICAgfHwgKHgxID0gcS54MCkgPiB4M1xuICAgICAgICB8fCAoeTEgPSBxLnkwKSA+IHkzXG4gICAgICAgIHx8ICh4MiA9IHEueDEpIDwgeDBcbiAgICAgICAgfHwgKHkyID0gcS55MSkgPCB5MCkgY29udGludWU7XG5cbiAgICAvLyBCaXNlY3QgdGhlIGN1cnJlbnQgcXVhZHJhbnQuXG4gICAgaWYgKG5vZGUubGVuZ3RoKSB7XG4gICAgICB2YXIgeG0gPSAoeDEgKyB4MikgLyAyLFxuICAgICAgICAgIHltID0gKHkxICsgeTIpIC8gMjtcblxuICAgICAgcXVhZHMucHVzaChcbiAgICAgICAgbmV3IFF1YWQobm9kZVszXSwgeG0sIHltLCB4MiwgeTIpLFxuICAgICAgICBuZXcgUXVhZChub2RlWzJdLCB4MSwgeW0sIHhtLCB5MiksXG4gICAgICAgIG5ldyBRdWFkKG5vZGVbMV0sIHhtLCB5MSwgeDIsIHltKSxcbiAgICAgICAgbmV3IFF1YWQobm9kZVswXSwgeDEsIHkxLCB4bSwgeW0pXG4gICAgICApO1xuXG4gICAgICAvLyBWaXNpdCB0aGUgY2xvc2VzdCBxdWFkcmFudCBmaXJzdC5cbiAgICAgIGlmIChpID0gKHkgPj0geW0pIDw8IDEgfCAoeCA+PSB4bSkpIHtcbiAgICAgICAgcSA9IHF1YWRzW3F1YWRzLmxlbmd0aCAtIDFdO1xuICAgICAgICBxdWFkc1txdWFkcy5sZW5ndGggLSAxXSA9IHF1YWRzW3F1YWRzLmxlbmd0aCAtIDEgLSBpXTtcbiAgICAgICAgcXVhZHNbcXVhZHMubGVuZ3RoIC0gMSAtIGldID0gcTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBWaXNpdCB0aGlzIHBvaW50LiAoVmlzaXRpbmcgY29pbmNpZGVudCBwb2ludHMgaXNuXHUyMDE5dCBuZWNlc3NhcnkhKVxuICAgIGVsc2Uge1xuICAgICAgdmFyIGR4ID0geCAtICt0aGlzLl94LmNhbGwobnVsbCwgbm9kZS5kYXRhKSxcbiAgICAgICAgICBkeSA9IHkgLSArdGhpcy5feS5jYWxsKG51bGwsIG5vZGUuZGF0YSksXG4gICAgICAgICAgZDIgPSBkeCAqIGR4ICsgZHkgKiBkeTtcbiAgICAgIGlmIChkMiA8IHJhZGl1cykge1xuICAgICAgICB2YXIgZCA9IE1hdGguc3FydChyYWRpdXMgPSBkMik7XG4gICAgICAgIHgwID0geCAtIGQsIHkwID0geSAtIGQ7XG4gICAgICAgIHgzID0geCArIGQsIHkzID0geSArIGQ7XG4gICAgICAgIGRhdGEgPSBub2RlLmRhdGE7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGRhdGE7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oZCkge1xuICBpZiAoaXNOYU4oeCA9ICt0aGlzLl94LmNhbGwobnVsbCwgZCkpIHx8IGlzTmFOKHkgPSArdGhpcy5feS5jYWxsKG51bGwsIGQpKSkgcmV0dXJuIHRoaXM7IC8vIGlnbm9yZSBpbnZhbGlkIHBvaW50c1xuXG4gIHZhciBwYXJlbnQsXG4gICAgICBub2RlID0gdGhpcy5fcm9vdCxcbiAgICAgIHJldGFpbmVyLFxuICAgICAgcHJldmlvdXMsXG4gICAgICBuZXh0LFxuICAgICAgeDAgPSB0aGlzLl94MCxcbiAgICAgIHkwID0gdGhpcy5feTAsXG4gICAgICB4MSA9IHRoaXMuX3gxLFxuICAgICAgeTEgPSB0aGlzLl95MSxcbiAgICAgIHgsXG4gICAgICB5LFxuICAgICAgeG0sXG4gICAgICB5bSxcbiAgICAgIHJpZ2h0LFxuICAgICAgYm90dG9tLFxuICAgICAgaSxcbiAgICAgIGo7XG5cbiAgLy8gSWYgdGhlIHRyZWUgaXMgZW1wdHksIGluaXRpYWxpemUgdGhlIHJvb3QgYXMgYSBsZWFmLlxuICBpZiAoIW5vZGUpIHJldHVybiB0aGlzO1xuXG4gIC8vIEZpbmQgdGhlIGxlYWYgbm9kZSBmb3IgdGhlIHBvaW50LlxuICAvLyBXaGlsZSBkZXNjZW5kaW5nLCBhbHNvIHJldGFpbiB0aGUgZGVlcGVzdCBwYXJlbnQgd2l0aCBhIG5vbi1yZW1vdmVkIHNpYmxpbmcuXG4gIGlmIChub2RlLmxlbmd0aCkgd2hpbGUgKHRydWUpIHtcbiAgICBpZiAocmlnaHQgPSB4ID49ICh4bSA9ICh4MCArIHgxKSAvIDIpKSB4MCA9IHhtOyBlbHNlIHgxID0geG07XG4gICAgaWYgKGJvdHRvbSA9IHkgPj0gKHltID0gKHkwICsgeTEpIC8gMikpIHkwID0geW07IGVsc2UgeTEgPSB5bTtcbiAgICBpZiAoIShwYXJlbnQgPSBub2RlLCBub2RlID0gbm9kZVtpID0gYm90dG9tIDw8IDEgfCByaWdodF0pKSByZXR1cm4gdGhpcztcbiAgICBpZiAoIW5vZGUubGVuZ3RoKSBicmVhaztcbiAgICBpZiAocGFyZW50WyhpICsgMSkgJiAzXSB8fCBwYXJlbnRbKGkgKyAyKSAmIDNdIHx8IHBhcmVudFsoaSArIDMpICYgM10pIHJldGFpbmVyID0gcGFyZW50LCBqID0gaTtcbiAgfVxuXG4gIC8vIEZpbmQgdGhlIHBvaW50IHRvIHJlbW92ZS5cbiAgd2hpbGUgKG5vZGUuZGF0YSAhPT0gZCkgaWYgKCEocHJldmlvdXMgPSBub2RlLCBub2RlID0gbm9kZS5uZXh0KSkgcmV0dXJuIHRoaXM7XG4gIGlmIChuZXh0ID0gbm9kZS5uZXh0KSBkZWxldGUgbm9kZS5uZXh0O1xuXG4gIC8vIElmIHRoZXJlIGFyZSBtdWx0aXBsZSBjb2luY2lkZW50IHBvaW50cywgcmVtb3ZlIGp1c3QgdGhlIHBvaW50LlxuICBpZiAocHJldmlvdXMpIHJldHVybiAobmV4dCA/IHByZXZpb3VzLm5leHQgPSBuZXh0IDogZGVsZXRlIHByZXZpb3VzLm5leHQpLCB0aGlzO1xuXG4gIC8vIElmIHRoaXMgaXMgdGhlIHJvb3QgcG9pbnQsIHJlbW92ZSBpdC5cbiAgaWYgKCFwYXJlbnQpIHJldHVybiB0aGlzLl9yb290ID0gbmV4dCwgdGhpcztcblxuICAvLyBSZW1vdmUgdGhpcyBsZWFmLlxuICBuZXh0ID8gcGFyZW50W2ldID0gbmV4dCA6IGRlbGV0ZSBwYXJlbnRbaV07XG5cbiAgLy8gSWYgdGhlIHBhcmVudCBub3cgY29udGFpbnMgZXhhY3RseSBvbmUgbGVhZiwgY29sbGFwc2Ugc3VwZXJmbHVvdXMgcGFyZW50cy5cbiAgaWYgKChub2RlID0gcGFyZW50WzBdIHx8IHBhcmVudFsxXSB8fCBwYXJlbnRbMl0gfHwgcGFyZW50WzNdKVxuICAgICAgJiYgbm9kZSA9PT0gKHBhcmVudFszXSB8fCBwYXJlbnRbMl0gfHwgcGFyZW50WzFdIHx8IHBhcmVudFswXSlcbiAgICAgICYmICFub2RlLmxlbmd0aCkge1xuICAgIGlmIChyZXRhaW5lcikgcmV0YWluZXJbal0gPSBub2RlO1xuICAgIGVsc2UgdGhpcy5fcm9vdCA9IG5vZGU7XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbW92ZUFsbChkYXRhKSB7XG4gIGZvciAodmFyIGkgPSAwLCBuID0gZGF0YS5sZW5ndGg7IGkgPCBuOyArK2kpIHRoaXMucmVtb3ZlKGRhdGFbaV0pO1xuICByZXR1cm4gdGhpcztcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuX3Jvb3Q7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIHZhciBzaXplID0gMDtcbiAgdGhpcy52aXNpdChmdW5jdGlvbihub2RlKSB7XG4gICAgaWYgKCFub2RlLmxlbmd0aCkgZG8gKytzaXplOyB3aGlsZSAobm9kZSA9IG5vZGUubmV4dClcbiAgfSk7XG4gIHJldHVybiBzaXplO1xufVxuIiwgImltcG9ydCBRdWFkIGZyb20gXCIuL3F1YWQuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oY2FsbGJhY2spIHtcbiAgdmFyIHF1YWRzID0gW10sIHEsIG5vZGUgPSB0aGlzLl9yb290LCBjaGlsZCwgeDAsIHkwLCB4MSwgeTE7XG4gIGlmIChub2RlKSBxdWFkcy5wdXNoKG5ldyBRdWFkKG5vZGUsIHRoaXMuX3gwLCB0aGlzLl95MCwgdGhpcy5feDEsIHRoaXMuX3kxKSk7XG4gIHdoaWxlIChxID0gcXVhZHMucG9wKCkpIHtcbiAgICBpZiAoIWNhbGxiYWNrKG5vZGUgPSBxLm5vZGUsIHgwID0gcS54MCwgeTAgPSBxLnkwLCB4MSA9IHEueDEsIHkxID0gcS55MSkgJiYgbm9kZS5sZW5ndGgpIHtcbiAgICAgIHZhciB4bSA9ICh4MCArIHgxKSAvIDIsIHltID0gKHkwICsgeTEpIC8gMjtcbiAgICAgIGlmIChjaGlsZCA9IG5vZGVbM10pIHF1YWRzLnB1c2gobmV3IFF1YWQoY2hpbGQsIHhtLCB5bSwgeDEsIHkxKSk7XG4gICAgICBpZiAoY2hpbGQgPSBub2RlWzJdKSBxdWFkcy5wdXNoKG5ldyBRdWFkKGNoaWxkLCB4MCwgeW0sIHhtLCB5MSkpO1xuICAgICAgaWYgKGNoaWxkID0gbm9kZVsxXSkgcXVhZHMucHVzaChuZXcgUXVhZChjaGlsZCwgeG0sIHkwLCB4MSwgeW0pKTtcbiAgICAgIGlmIChjaGlsZCA9IG5vZGVbMF0pIHF1YWRzLnB1c2gobmV3IFF1YWQoY2hpbGQsIHgwLCB5MCwgeG0sIHltKSk7XG4gICAgfVxuICB9XG4gIHJldHVybiB0aGlzO1xufVxuIiwgImltcG9ydCBRdWFkIGZyb20gXCIuL3F1YWQuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oY2FsbGJhY2spIHtcbiAgdmFyIHF1YWRzID0gW10sIG5leHQgPSBbXSwgcTtcbiAgaWYgKHRoaXMuX3Jvb3QpIHF1YWRzLnB1c2gobmV3IFF1YWQodGhpcy5fcm9vdCwgdGhpcy5feDAsIHRoaXMuX3kwLCB0aGlzLl94MSwgdGhpcy5feTEpKTtcbiAgd2hpbGUgKHEgPSBxdWFkcy5wb3AoKSkge1xuICAgIHZhciBub2RlID0gcS5ub2RlO1xuICAgIGlmIChub2RlLmxlbmd0aCkge1xuICAgICAgdmFyIGNoaWxkLCB4MCA9IHEueDAsIHkwID0gcS55MCwgeDEgPSBxLngxLCB5MSA9IHEueTEsIHhtID0gKHgwICsgeDEpIC8gMiwgeW0gPSAoeTAgKyB5MSkgLyAyO1xuICAgICAgaWYgKGNoaWxkID0gbm9kZVswXSkgcXVhZHMucHVzaChuZXcgUXVhZChjaGlsZCwgeDAsIHkwLCB4bSwgeW0pKTtcbiAgICAgIGlmIChjaGlsZCA9IG5vZGVbMV0pIHF1YWRzLnB1c2gobmV3IFF1YWQoY2hpbGQsIHhtLCB5MCwgeDEsIHltKSk7XG4gICAgICBpZiAoY2hpbGQgPSBub2RlWzJdKSBxdWFkcy5wdXNoKG5ldyBRdWFkKGNoaWxkLCB4MCwgeW0sIHhtLCB5MSkpO1xuICAgICAgaWYgKGNoaWxkID0gbm9kZVszXSkgcXVhZHMucHVzaChuZXcgUXVhZChjaGlsZCwgeG0sIHltLCB4MSwgeTEpKTtcbiAgICB9XG4gICAgbmV4dC5wdXNoKHEpO1xuICB9XG4gIHdoaWxlIChxID0gbmV4dC5wb3AoKSkge1xuICAgIGNhbGxiYWNrKHEubm9kZSwgcS54MCwgcS55MCwgcS54MSwgcS55MSk7XG4gIH1cbiAgcmV0dXJuIHRoaXM7XG59XG4iLCAiZXhwb3J0IGZ1bmN0aW9uIGRlZmF1bHRYKGQpIHtcbiAgcmV0dXJuIGRbMF07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKF8pIHtcbiAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAodGhpcy5feCA9IF8sIHRoaXMpIDogdGhpcy5feDtcbn1cbiIsICJleHBvcnQgZnVuY3Rpb24gZGVmYXVsdFkoZCkge1xuICByZXR1cm4gZFsxXTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oXykge1xuICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/ICh0aGlzLl95ID0gXywgdGhpcykgOiB0aGlzLl95O1xufVxuIiwgImltcG9ydCB0cmVlX2FkZCwge2FkZEFsbCBhcyB0cmVlX2FkZEFsbH0gZnJvbSBcIi4vYWRkLmpzXCI7XG5pbXBvcnQgdHJlZV9jb3ZlciBmcm9tIFwiLi9jb3Zlci5qc1wiO1xuaW1wb3J0IHRyZWVfZGF0YSBmcm9tIFwiLi9kYXRhLmpzXCI7XG5pbXBvcnQgdHJlZV9leHRlbnQgZnJvbSBcIi4vZXh0ZW50LmpzXCI7XG5pbXBvcnQgdHJlZV9maW5kIGZyb20gXCIuL2ZpbmQuanNcIjtcbmltcG9ydCB0cmVlX3JlbW92ZSwge3JlbW92ZUFsbCBhcyB0cmVlX3JlbW92ZUFsbH0gZnJvbSBcIi4vcmVtb3ZlLmpzXCI7XG5pbXBvcnQgdHJlZV9yb290IGZyb20gXCIuL3Jvb3QuanNcIjtcbmltcG9ydCB0cmVlX3NpemUgZnJvbSBcIi4vc2l6ZS5qc1wiO1xuaW1wb3J0IHRyZWVfdmlzaXQgZnJvbSBcIi4vdmlzaXQuanNcIjtcbmltcG9ydCB0cmVlX3Zpc2l0QWZ0ZXIgZnJvbSBcIi4vdmlzaXRBZnRlci5qc1wiO1xuaW1wb3J0IHRyZWVfeCwge2RlZmF1bHRYfSBmcm9tIFwiLi94LmpzXCI7XG5pbXBvcnQgdHJlZV95LCB7ZGVmYXVsdFl9IGZyb20gXCIuL3kuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gcXVhZHRyZWUobm9kZXMsIHgsIHkpIHtcbiAgdmFyIHRyZWUgPSBuZXcgUXVhZHRyZWUoeCA9PSBudWxsID8gZGVmYXVsdFggOiB4LCB5ID09IG51bGwgPyBkZWZhdWx0WSA6IHksIE5hTiwgTmFOLCBOYU4sIE5hTik7XG4gIHJldHVybiBub2RlcyA9PSBudWxsID8gdHJlZSA6IHRyZWUuYWRkQWxsKG5vZGVzKTtcbn1cblxuZnVuY3Rpb24gUXVhZHRyZWUoeCwgeSwgeDAsIHkwLCB4MSwgeTEpIHtcbiAgdGhpcy5feCA9IHg7XG4gIHRoaXMuX3kgPSB5O1xuICB0aGlzLl94MCA9IHgwO1xuICB0aGlzLl95MCA9IHkwO1xuICB0aGlzLl94MSA9IHgxO1xuICB0aGlzLl95MSA9IHkxO1xuICB0aGlzLl9yb290ID0gdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiBsZWFmX2NvcHkobGVhZikge1xuICB2YXIgY29weSA9IHtkYXRhOiBsZWFmLmRhdGF9LCBuZXh0ID0gY29weTtcbiAgd2hpbGUgKGxlYWYgPSBsZWFmLm5leHQpIG5leHQgPSBuZXh0Lm5leHQgPSB7ZGF0YTogbGVhZi5kYXRhfTtcbiAgcmV0dXJuIGNvcHk7XG59XG5cbnZhciB0cmVlUHJvdG8gPSBxdWFkdHJlZS5wcm90b3R5cGUgPSBRdWFkdHJlZS5wcm90b3R5cGU7XG5cbnRyZWVQcm90by5jb3B5ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBjb3B5ID0gbmV3IFF1YWR0cmVlKHRoaXMuX3gsIHRoaXMuX3ksIHRoaXMuX3gwLCB0aGlzLl95MCwgdGhpcy5feDEsIHRoaXMuX3kxKSxcbiAgICAgIG5vZGUgPSB0aGlzLl9yb290LFxuICAgICAgbm9kZXMsXG4gICAgICBjaGlsZDtcblxuICBpZiAoIW5vZGUpIHJldHVybiBjb3B5O1xuXG4gIGlmICghbm9kZS5sZW5ndGgpIHJldHVybiBjb3B5Ll9yb290ID0gbGVhZl9jb3B5KG5vZGUpLCBjb3B5O1xuXG4gIG5vZGVzID0gW3tzb3VyY2U6IG5vZGUsIHRhcmdldDogY29weS5fcm9vdCA9IG5ldyBBcnJheSg0KX1dO1xuICB3aGlsZSAobm9kZSA9IG5vZGVzLnBvcCgpKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCA0OyArK2kpIHtcbiAgICAgIGlmIChjaGlsZCA9IG5vZGUuc291cmNlW2ldKSB7XG4gICAgICAgIGlmIChjaGlsZC5sZW5ndGgpIG5vZGVzLnB1c2goe3NvdXJjZTogY2hpbGQsIHRhcmdldDogbm9kZS50YXJnZXRbaV0gPSBuZXcgQXJyYXkoNCl9KTtcbiAgICAgICAgZWxzZSBub2RlLnRhcmdldFtpXSA9IGxlYWZfY29weShjaGlsZCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGNvcHk7XG59O1xuXG50cmVlUHJvdG8uYWRkID0gdHJlZV9hZGQ7XG50cmVlUHJvdG8uYWRkQWxsID0gdHJlZV9hZGRBbGw7XG50cmVlUHJvdG8uY292ZXIgPSB0cmVlX2NvdmVyO1xudHJlZVByb3RvLmRhdGEgPSB0cmVlX2RhdGE7XG50cmVlUHJvdG8uZXh0ZW50ID0gdHJlZV9leHRlbnQ7XG50cmVlUHJvdG8uZmluZCA9IHRyZWVfZmluZDtcbnRyZWVQcm90by5yZW1vdmUgPSB0cmVlX3JlbW92ZTtcbnRyZWVQcm90by5yZW1vdmVBbGwgPSB0cmVlX3JlbW92ZUFsbDtcbnRyZWVQcm90by5yb290ID0gdHJlZV9yb290O1xudHJlZVByb3RvLnNpemUgPSB0cmVlX3NpemU7XG50cmVlUHJvdG8udmlzaXQgPSB0cmVlX3Zpc2l0O1xudHJlZVByb3RvLnZpc2l0QWZ0ZXIgPSB0cmVlX3Zpc2l0QWZ0ZXI7XG50cmVlUHJvdG8ueCA9IHRyZWVfeDtcbnRyZWVQcm90by55ID0gdHJlZV95O1xuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHgpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB4O1xuICB9O1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHJhbmRvbSkge1xuICByZXR1cm4gKHJhbmRvbSgpIC0gMC41KSAqIDFlLTY7XG59XG4iLCAiaW1wb3J0IHtxdWFkdHJlZX0gZnJvbSBcImQzLXF1YWR0cmVlXCI7XG5pbXBvcnQgY29uc3RhbnQgZnJvbSBcIi4vY29uc3RhbnQuanNcIjtcbmltcG9ydCBqaWdnbGUgZnJvbSBcIi4vamlnZ2xlLmpzXCI7XG5cbmZ1bmN0aW9uIHgoZCkge1xuICByZXR1cm4gZC54ICsgZC52eDtcbn1cblxuZnVuY3Rpb24geShkKSB7XG4gIHJldHVybiBkLnkgKyBkLnZ5O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihyYWRpdXMpIHtcbiAgdmFyIG5vZGVzLFxuICAgICAgcmFkaWksXG4gICAgICByYW5kb20sXG4gICAgICBzdHJlbmd0aCA9IDEsXG4gICAgICBpdGVyYXRpb25zID0gMTtcblxuICBpZiAodHlwZW9mIHJhZGl1cyAhPT0gXCJmdW5jdGlvblwiKSByYWRpdXMgPSBjb25zdGFudChyYWRpdXMgPT0gbnVsbCA/IDEgOiArcmFkaXVzKTtcblxuICBmdW5jdGlvbiBmb3JjZSgpIHtcbiAgICB2YXIgaSwgbiA9IG5vZGVzLmxlbmd0aCxcbiAgICAgICAgdHJlZSxcbiAgICAgICAgbm9kZSxcbiAgICAgICAgeGksXG4gICAgICAgIHlpLFxuICAgICAgICByaSxcbiAgICAgICAgcmkyO1xuXG4gICAgZm9yICh2YXIgayA9IDA7IGsgPCBpdGVyYXRpb25zOyArK2spIHtcbiAgICAgIHRyZWUgPSBxdWFkdHJlZShub2RlcywgeCwgeSkudmlzaXRBZnRlcihwcmVwYXJlKTtcbiAgICAgIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgICAgbm9kZSA9IG5vZGVzW2ldO1xuICAgICAgICByaSA9IHJhZGlpW25vZGUuaW5kZXhdLCByaTIgPSByaSAqIHJpO1xuICAgICAgICB4aSA9IG5vZGUueCArIG5vZGUudng7XG4gICAgICAgIHlpID0gbm9kZS55ICsgbm9kZS52eTtcbiAgICAgICAgdHJlZS52aXNpdChhcHBseSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYXBwbHkocXVhZCwgeDAsIHkwLCB4MSwgeTEpIHtcbiAgICAgIHZhciBkYXRhID0gcXVhZC5kYXRhLCByaiA9IHF1YWQuciwgciA9IHJpICsgcmo7XG4gICAgICBpZiAoZGF0YSkge1xuICAgICAgICBpZiAoZGF0YS5pbmRleCA+IG5vZGUuaW5kZXgpIHtcbiAgICAgICAgICB2YXIgeCA9IHhpIC0gZGF0YS54IC0gZGF0YS52eCxcbiAgICAgICAgICAgICAgeSA9IHlpIC0gZGF0YS55IC0gZGF0YS52eSxcbiAgICAgICAgICAgICAgbCA9IHggKiB4ICsgeSAqIHk7XG4gICAgICAgICAgaWYgKGwgPCByICogcikge1xuICAgICAgICAgICAgaWYgKHggPT09IDApIHggPSBqaWdnbGUocmFuZG9tKSwgbCArPSB4ICogeDtcbiAgICAgICAgICAgIGlmICh5ID09PSAwKSB5ID0gamlnZ2xlKHJhbmRvbSksIGwgKz0geSAqIHk7XG4gICAgICAgICAgICBsID0gKHIgLSAobCA9IE1hdGguc3FydChsKSkpIC8gbCAqIHN0cmVuZ3RoO1xuICAgICAgICAgICAgbm9kZS52eCArPSAoeCAqPSBsKSAqIChyID0gKHJqICo9IHJqKSAvIChyaTIgKyByaikpO1xuICAgICAgICAgICAgbm9kZS52eSArPSAoeSAqPSBsKSAqIHI7XG4gICAgICAgICAgICBkYXRhLnZ4IC09IHggKiAociA9IDEgLSByKTtcbiAgICAgICAgICAgIGRhdGEudnkgLT0geSAqIHI7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHJldHVybiB4MCA+IHhpICsgciB8fCB4MSA8IHhpIC0gciB8fCB5MCA+IHlpICsgciB8fCB5MSA8IHlpIC0gcjtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBwcmVwYXJlKHF1YWQpIHtcbiAgICBpZiAocXVhZC5kYXRhKSByZXR1cm4gcXVhZC5yID0gcmFkaWlbcXVhZC5kYXRhLmluZGV4XTtcbiAgICBmb3IgKHZhciBpID0gcXVhZC5yID0gMDsgaSA8IDQ7ICsraSkge1xuICAgICAgaWYgKHF1YWRbaV0gJiYgcXVhZFtpXS5yID4gcXVhZC5yKSB7XG4gICAgICAgIHF1YWQuciA9IHF1YWRbaV0ucjtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBpbml0aWFsaXplKCkge1xuICAgIGlmICghbm9kZXMpIHJldHVybjtcbiAgICB2YXIgaSwgbiA9IG5vZGVzLmxlbmd0aCwgbm9kZTtcbiAgICByYWRpaSA9IG5ldyBBcnJheShuKTtcbiAgICBmb3IgKGkgPSAwOyBpIDwgbjsgKytpKSBub2RlID0gbm9kZXNbaV0sIHJhZGlpW25vZGUuaW5kZXhdID0gK3JhZGl1cyhub2RlLCBpLCBub2Rlcyk7XG4gIH1cblxuICBmb3JjZS5pbml0aWFsaXplID0gZnVuY3Rpb24oX25vZGVzLCBfcmFuZG9tKSB7XG4gICAgbm9kZXMgPSBfbm9kZXM7XG4gICAgcmFuZG9tID0gX3JhbmRvbTtcbiAgICBpbml0aWFsaXplKCk7XG4gIH07XG5cbiAgZm9yY2UuaXRlcmF0aW9ucyA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChpdGVyYXRpb25zID0gK18sIGZvcmNlKSA6IGl0ZXJhdGlvbnM7XG4gIH07XG5cbiAgZm9yY2Uuc3RyZW5ndGggPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoc3RyZW5ndGggPSArXywgZm9yY2UpIDogc3RyZW5ndGg7XG4gIH07XG5cbiAgZm9yY2UucmFkaXVzID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHJhZGl1cyA9IHR5cGVvZiBfID09PSBcImZ1bmN0aW9uXCIgPyBfIDogY29uc3RhbnQoK18pLCBpbml0aWFsaXplKCksIGZvcmNlKSA6IHJhZGl1cztcbiAgfTtcblxuICByZXR1cm4gZm9yY2U7XG59XG4iLCAiaW1wb3J0IGNvbnN0YW50IGZyb20gXCIuL2NvbnN0YW50LmpzXCI7XG5pbXBvcnQgamlnZ2xlIGZyb20gXCIuL2ppZ2dsZS5qc1wiO1xuXG5mdW5jdGlvbiBpbmRleChkKSB7XG4gIHJldHVybiBkLmluZGV4O1xufVxuXG5mdW5jdGlvbiBmaW5kKG5vZGVCeUlkLCBub2RlSWQpIHtcbiAgdmFyIG5vZGUgPSBub2RlQnlJZC5nZXQobm9kZUlkKTtcbiAgaWYgKCFub2RlKSB0aHJvdyBuZXcgRXJyb3IoXCJub2RlIG5vdCBmb3VuZDogXCIgKyBub2RlSWQpO1xuICByZXR1cm4gbm9kZTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obGlua3MpIHtcbiAgdmFyIGlkID0gaW5kZXgsXG4gICAgICBzdHJlbmd0aCA9IGRlZmF1bHRTdHJlbmd0aCxcbiAgICAgIHN0cmVuZ3RocyxcbiAgICAgIGRpc3RhbmNlID0gY29uc3RhbnQoMzApLFxuICAgICAgZGlzdGFuY2VzLFxuICAgICAgbm9kZXMsXG4gICAgICBjb3VudCxcbiAgICAgIGJpYXMsXG4gICAgICByYW5kb20sXG4gICAgICBpdGVyYXRpb25zID0gMTtcblxuICBpZiAobGlua3MgPT0gbnVsbCkgbGlua3MgPSBbXTtcblxuICBmdW5jdGlvbiBkZWZhdWx0U3RyZW5ndGgobGluaykge1xuICAgIHJldHVybiAxIC8gTWF0aC5taW4oY291bnRbbGluay5zb3VyY2UuaW5kZXhdLCBjb3VudFtsaW5rLnRhcmdldC5pbmRleF0pO1xuICB9XG5cbiAgZnVuY3Rpb24gZm9yY2UoYWxwaGEpIHtcbiAgICBmb3IgKHZhciBrID0gMCwgbiA9IGxpbmtzLmxlbmd0aDsgayA8IGl0ZXJhdGlvbnM7ICsraykge1xuICAgICAgZm9yICh2YXIgaSA9IDAsIGxpbmssIHNvdXJjZSwgdGFyZ2V0LCB4LCB5LCBsLCBiOyBpIDwgbjsgKytpKSB7XG4gICAgICAgIGxpbmsgPSBsaW5rc1tpXSwgc291cmNlID0gbGluay5zb3VyY2UsIHRhcmdldCA9IGxpbmsudGFyZ2V0O1xuICAgICAgICB4ID0gdGFyZ2V0LnggKyB0YXJnZXQudnggLSBzb3VyY2UueCAtIHNvdXJjZS52eCB8fCBqaWdnbGUocmFuZG9tKTtcbiAgICAgICAgeSA9IHRhcmdldC55ICsgdGFyZ2V0LnZ5IC0gc291cmNlLnkgLSBzb3VyY2UudnkgfHwgamlnZ2xlKHJhbmRvbSk7XG4gICAgICAgIGwgPSBNYXRoLnNxcnQoeCAqIHggKyB5ICogeSk7XG4gICAgICAgIGwgPSAobCAtIGRpc3RhbmNlc1tpXSkgLyBsICogYWxwaGEgKiBzdHJlbmd0aHNbaV07XG4gICAgICAgIHggKj0gbCwgeSAqPSBsO1xuICAgICAgICB0YXJnZXQudnggLT0geCAqIChiID0gYmlhc1tpXSk7XG4gICAgICAgIHRhcmdldC52eSAtPSB5ICogYjtcbiAgICAgICAgc291cmNlLnZ4ICs9IHggKiAoYiA9IDEgLSBiKTtcbiAgICAgICAgc291cmNlLnZ5ICs9IHkgKiBiO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGluaXRpYWxpemUoKSB7XG4gICAgaWYgKCFub2RlcykgcmV0dXJuO1xuXG4gICAgdmFyIGksXG4gICAgICAgIG4gPSBub2Rlcy5sZW5ndGgsXG4gICAgICAgIG0gPSBsaW5rcy5sZW5ndGgsXG4gICAgICAgIG5vZGVCeUlkID0gbmV3IE1hcChub2Rlcy5tYXAoKGQsIGkpID0+IFtpZChkLCBpLCBub2RlcyksIGRdKSksXG4gICAgICAgIGxpbms7XG5cbiAgICBmb3IgKGkgPSAwLCBjb3VudCA9IG5ldyBBcnJheShuKTsgaSA8IG07ICsraSkge1xuICAgICAgbGluayA9IGxpbmtzW2ldLCBsaW5rLmluZGV4ID0gaTtcbiAgICAgIGlmICh0eXBlb2YgbGluay5zb3VyY2UgIT09IFwib2JqZWN0XCIpIGxpbmsuc291cmNlID0gZmluZChub2RlQnlJZCwgbGluay5zb3VyY2UpO1xuICAgICAgaWYgKHR5cGVvZiBsaW5rLnRhcmdldCAhPT0gXCJvYmplY3RcIikgbGluay50YXJnZXQgPSBmaW5kKG5vZGVCeUlkLCBsaW5rLnRhcmdldCk7XG4gICAgICBjb3VudFtsaW5rLnNvdXJjZS5pbmRleF0gPSAoY291bnRbbGluay5zb3VyY2UuaW5kZXhdIHx8IDApICsgMTtcbiAgICAgIGNvdW50W2xpbmsudGFyZ2V0LmluZGV4XSA9IChjb3VudFtsaW5rLnRhcmdldC5pbmRleF0gfHwgMCkgKyAxO1xuICAgIH1cblxuICAgIGZvciAoaSA9IDAsIGJpYXMgPSBuZXcgQXJyYXkobSk7IGkgPCBtOyArK2kpIHtcbiAgICAgIGxpbmsgPSBsaW5rc1tpXSwgYmlhc1tpXSA9IGNvdW50W2xpbmsuc291cmNlLmluZGV4XSAvIChjb3VudFtsaW5rLnNvdXJjZS5pbmRleF0gKyBjb3VudFtsaW5rLnRhcmdldC5pbmRleF0pO1xuICAgIH1cblxuICAgIHN0cmVuZ3RocyA9IG5ldyBBcnJheShtKSwgaW5pdGlhbGl6ZVN0cmVuZ3RoKCk7XG4gICAgZGlzdGFuY2VzID0gbmV3IEFycmF5KG0pLCBpbml0aWFsaXplRGlzdGFuY2UoKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGluaXRpYWxpemVTdHJlbmd0aCgpIHtcbiAgICBpZiAoIW5vZGVzKSByZXR1cm47XG5cbiAgICBmb3IgKHZhciBpID0gMCwgbiA9IGxpbmtzLmxlbmd0aDsgaSA8IG47ICsraSkge1xuICAgICAgc3RyZW5ndGhzW2ldID0gK3N0cmVuZ3RoKGxpbmtzW2ldLCBpLCBsaW5rcyk7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gaW5pdGlhbGl6ZURpc3RhbmNlKCkge1xuICAgIGlmICghbm9kZXMpIHJldHVybjtcblxuICAgIGZvciAodmFyIGkgPSAwLCBuID0gbGlua3MubGVuZ3RoOyBpIDwgbjsgKytpKSB7XG4gICAgICBkaXN0YW5jZXNbaV0gPSArZGlzdGFuY2UobGlua3NbaV0sIGksIGxpbmtzKTtcbiAgICB9XG4gIH1cblxuICBmb3JjZS5pbml0aWFsaXplID0gZnVuY3Rpb24oX25vZGVzLCBfcmFuZG9tKSB7XG4gICAgbm9kZXMgPSBfbm9kZXM7XG4gICAgcmFuZG9tID0gX3JhbmRvbTtcbiAgICBpbml0aWFsaXplKCk7XG4gIH07XG5cbiAgZm9yY2UubGlua3MgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAobGlua3MgPSBfLCBpbml0aWFsaXplKCksIGZvcmNlKSA6IGxpbmtzO1xuICB9O1xuXG4gIGZvcmNlLmlkID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGlkID0gXywgZm9yY2UpIDogaWQ7XG4gIH07XG5cbiAgZm9yY2UuaXRlcmF0aW9ucyA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChpdGVyYXRpb25zID0gK18sIGZvcmNlKSA6IGl0ZXJhdGlvbnM7XG4gIH07XG5cbiAgZm9yY2Uuc3RyZW5ndGggPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoc3RyZW5ndGggPSB0eXBlb2YgXyA9PT0gXCJmdW5jdGlvblwiID8gXyA6IGNvbnN0YW50KCtfKSwgaW5pdGlhbGl6ZVN0cmVuZ3RoKCksIGZvcmNlKSA6IHN0cmVuZ3RoO1xuICB9O1xuXG4gIGZvcmNlLmRpc3RhbmNlID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGRpc3RhbmNlID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudCgrXyksIGluaXRpYWxpemVEaXN0YW5jZSgpLCBmb3JjZSkgOiBkaXN0YW5jZTtcbiAgfTtcblxuICByZXR1cm4gZm9yY2U7XG59XG4iLCAiLy8gaHR0cHM6Ly9lbi53aWtpcGVkaWEub3JnL3dpa2kvTGluZWFyX2NvbmdydWVudGlhbF9nZW5lcmF0b3IjUGFyYW1ldGVyc19pbl9jb21tb25fdXNlXG5jb25zdCBhID0gMTY2NDUyNTtcbmNvbnN0IGMgPSAxMDEzOTA0MjIzO1xuY29uc3QgbSA9IDQyOTQ5NjcyOTY7IC8vIDJeMzJcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIGxldCBzID0gMTtcbiAgcmV0dXJuICgpID0+IChzID0gKGEgKiBzICsgYykgJSBtKSAvIG07XG59XG4iLCAiaW1wb3J0IHtkaXNwYXRjaH0gZnJvbSBcImQzLWRpc3BhdGNoXCI7XG5pbXBvcnQge3RpbWVyfSBmcm9tIFwiZDMtdGltZXJcIjtcbmltcG9ydCBsY2cgZnJvbSBcIi4vbGNnLmpzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiB4KGQpIHtcbiAgcmV0dXJuIGQueDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHkoZCkge1xuICByZXR1cm4gZC55O1xufVxuXG52YXIgaW5pdGlhbFJhZGl1cyA9IDEwLFxuICAgIGluaXRpYWxBbmdsZSA9IE1hdGguUEkgKiAoMyAtIE1hdGguc3FydCg1KSk7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG5vZGVzKSB7XG4gIHZhciBzaW11bGF0aW9uLFxuICAgICAgYWxwaGEgPSAxLFxuICAgICAgYWxwaGFNaW4gPSAwLjAwMSxcbiAgICAgIGFscGhhRGVjYXkgPSAxIC0gTWF0aC5wb3coYWxwaGFNaW4sIDEgLyAzMDApLFxuICAgICAgYWxwaGFUYXJnZXQgPSAwLFxuICAgICAgdmVsb2NpdHlEZWNheSA9IDAuNixcbiAgICAgIGZvcmNlcyA9IG5ldyBNYXAoKSxcbiAgICAgIHN0ZXBwZXIgPSB0aW1lcihzdGVwKSxcbiAgICAgIGV2ZW50ID0gZGlzcGF0Y2goXCJ0aWNrXCIsIFwiZW5kXCIpLFxuICAgICAgcmFuZG9tID0gbGNnKCk7XG5cbiAgaWYgKG5vZGVzID09IG51bGwpIG5vZGVzID0gW107XG5cbiAgZnVuY3Rpb24gc3RlcCgpIHtcbiAgICB0aWNrKCk7XG4gICAgZXZlbnQuY2FsbChcInRpY2tcIiwgc2ltdWxhdGlvbik7XG4gICAgaWYgKGFscGhhIDwgYWxwaGFNaW4pIHtcbiAgICAgIHN0ZXBwZXIuc3RvcCgpO1xuICAgICAgZXZlbnQuY2FsbChcImVuZFwiLCBzaW11bGF0aW9uKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiB0aWNrKGl0ZXJhdGlvbnMpIHtcbiAgICB2YXIgaSwgbiA9IG5vZGVzLmxlbmd0aCwgbm9kZTtcblxuICAgIGlmIChpdGVyYXRpb25zID09PSB1bmRlZmluZWQpIGl0ZXJhdGlvbnMgPSAxO1xuXG4gICAgZm9yICh2YXIgayA9IDA7IGsgPCBpdGVyYXRpb25zOyArK2spIHtcbiAgICAgIGFscGhhICs9IChhbHBoYVRhcmdldCAtIGFscGhhKSAqIGFscGhhRGVjYXk7XG5cbiAgICAgIGZvcmNlcy5mb3JFYWNoKGZ1bmN0aW9uKGZvcmNlKSB7XG4gICAgICAgIGZvcmNlKGFscGhhKTtcbiAgICAgIH0pO1xuXG4gICAgICBmb3IgKGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICAgIG5vZGUgPSBub2Rlc1tpXTtcbiAgICAgICAgaWYgKG5vZGUuZnggPT0gbnVsbCkgbm9kZS54ICs9IG5vZGUudnggKj0gdmVsb2NpdHlEZWNheTtcbiAgICAgICAgZWxzZSBub2RlLnggPSBub2RlLmZ4LCBub2RlLnZ4ID0gMDtcbiAgICAgICAgaWYgKG5vZGUuZnkgPT0gbnVsbCkgbm9kZS55ICs9IG5vZGUudnkgKj0gdmVsb2NpdHlEZWNheTtcbiAgICAgICAgZWxzZSBub2RlLnkgPSBub2RlLmZ5LCBub2RlLnZ5ID0gMDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gc2ltdWxhdGlvbjtcbiAgfVxuXG4gIGZ1bmN0aW9uIGluaXRpYWxpemVOb2RlcygpIHtcbiAgICBmb3IgKHZhciBpID0gMCwgbiA9IG5vZGVzLmxlbmd0aCwgbm9kZTsgaSA8IG47ICsraSkge1xuICAgICAgbm9kZSA9IG5vZGVzW2ldLCBub2RlLmluZGV4ID0gaTtcbiAgICAgIGlmIChub2RlLmZ4ICE9IG51bGwpIG5vZGUueCA9IG5vZGUuZng7XG4gICAgICBpZiAobm9kZS5meSAhPSBudWxsKSBub2RlLnkgPSBub2RlLmZ5O1xuICAgICAgaWYgKGlzTmFOKG5vZGUueCkgfHwgaXNOYU4obm9kZS55KSkge1xuICAgICAgICB2YXIgcmFkaXVzID0gaW5pdGlhbFJhZGl1cyAqIE1hdGguc3FydCgwLjUgKyBpKSwgYW5nbGUgPSBpICogaW5pdGlhbEFuZ2xlO1xuICAgICAgICBub2RlLnggPSByYWRpdXMgKiBNYXRoLmNvcyhhbmdsZSk7XG4gICAgICAgIG5vZGUueSA9IHJhZGl1cyAqIE1hdGguc2luKGFuZ2xlKTtcbiAgICAgIH1cbiAgICAgIGlmIChpc05hTihub2RlLnZ4KSB8fCBpc05hTihub2RlLnZ5KSkge1xuICAgICAgICBub2RlLnZ4ID0gbm9kZS52eSA9IDA7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gaW5pdGlhbGl6ZUZvcmNlKGZvcmNlKSB7XG4gICAgaWYgKGZvcmNlLmluaXRpYWxpemUpIGZvcmNlLmluaXRpYWxpemUobm9kZXMsIHJhbmRvbSk7XG4gICAgcmV0dXJuIGZvcmNlO1xuICB9XG5cbiAgaW5pdGlhbGl6ZU5vZGVzKCk7XG5cbiAgcmV0dXJuIHNpbXVsYXRpb24gPSB7XG4gICAgdGljazogdGljayxcblxuICAgIHJlc3RhcnQ6IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIHN0ZXBwZXIucmVzdGFydChzdGVwKSwgc2ltdWxhdGlvbjtcbiAgICB9LFxuXG4gICAgc3RvcDogZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gc3RlcHBlci5zdG9wKCksIHNpbXVsYXRpb247XG4gICAgfSxcblxuICAgIG5vZGVzOiBmdW5jdGlvbihfKSB7XG4gICAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChub2RlcyA9IF8sIGluaXRpYWxpemVOb2RlcygpLCBmb3JjZXMuZm9yRWFjaChpbml0aWFsaXplRm9yY2UpLCBzaW11bGF0aW9uKSA6IG5vZGVzO1xuICAgIH0sXG5cbiAgICBhbHBoYTogZnVuY3Rpb24oXykge1xuICAgICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoYWxwaGEgPSArXywgc2ltdWxhdGlvbikgOiBhbHBoYTtcbiAgICB9LFxuXG4gICAgYWxwaGFNaW46IGZ1bmN0aW9uKF8pIHtcbiAgICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGFscGhhTWluID0gK18sIHNpbXVsYXRpb24pIDogYWxwaGFNaW47XG4gICAgfSxcblxuICAgIGFscGhhRGVjYXk6IGZ1bmN0aW9uKF8pIHtcbiAgICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGFscGhhRGVjYXkgPSArXywgc2ltdWxhdGlvbikgOiArYWxwaGFEZWNheTtcbiAgICB9LFxuXG4gICAgYWxwaGFUYXJnZXQ6IGZ1bmN0aW9uKF8pIHtcbiAgICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGFscGhhVGFyZ2V0ID0gK18sIHNpbXVsYXRpb24pIDogYWxwaGFUYXJnZXQ7XG4gICAgfSxcblxuICAgIHZlbG9jaXR5RGVjYXk6IGZ1bmN0aW9uKF8pIHtcbiAgICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHZlbG9jaXR5RGVjYXkgPSAxIC0gXywgc2ltdWxhdGlvbikgOiAxIC0gdmVsb2NpdHlEZWNheTtcbiAgICB9LFxuXG4gICAgcmFuZG9tU291cmNlOiBmdW5jdGlvbihfKSB7XG4gICAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChyYW5kb20gPSBfLCBmb3JjZXMuZm9yRWFjaChpbml0aWFsaXplRm9yY2UpLCBzaW11bGF0aW9uKSA6IHJhbmRvbTtcbiAgICB9LFxuXG4gICAgZm9yY2U6IGZ1bmN0aW9uKG5hbWUsIF8pIHtcbiAgICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID4gMSA/ICgoXyA9PSBudWxsID8gZm9yY2VzLmRlbGV0ZShuYW1lKSA6IGZvcmNlcy5zZXQobmFtZSwgaW5pdGlhbGl6ZUZvcmNlKF8pKSksIHNpbXVsYXRpb24pIDogZm9yY2VzLmdldChuYW1lKTtcbiAgICB9LFxuXG4gICAgZmluZDogZnVuY3Rpb24oeCwgeSwgcmFkaXVzKSB7XG4gICAgICB2YXIgaSA9IDAsXG4gICAgICAgICAgbiA9IG5vZGVzLmxlbmd0aCxcbiAgICAgICAgICBkeCxcbiAgICAgICAgICBkeSxcbiAgICAgICAgICBkMixcbiAgICAgICAgICBub2RlLFxuICAgICAgICAgIGNsb3Nlc3Q7XG5cbiAgICAgIGlmIChyYWRpdXMgPT0gbnVsbCkgcmFkaXVzID0gSW5maW5pdHk7XG4gICAgICBlbHNlIHJhZGl1cyAqPSByYWRpdXM7XG5cbiAgICAgIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgICAgbm9kZSA9IG5vZGVzW2ldO1xuICAgICAgICBkeCA9IHggLSBub2RlLng7XG4gICAgICAgIGR5ID0geSAtIG5vZGUueTtcbiAgICAgICAgZDIgPSBkeCAqIGR4ICsgZHkgKiBkeTtcbiAgICAgICAgaWYgKGQyIDwgcmFkaXVzKSBjbG9zZXN0ID0gbm9kZSwgcmFkaXVzID0gZDI7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBjbG9zZXN0O1xuICAgIH0sXG5cbiAgICBvbjogZnVuY3Rpb24obmFtZSwgXykge1xuICAgICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPiAxID8gKGV2ZW50Lm9uKG5hbWUsIF8pLCBzaW11bGF0aW9uKSA6IGV2ZW50Lm9uKG5hbWUpO1xuICAgIH1cbiAgfTtcbn1cbiIsICJpbXBvcnQge3F1YWR0cmVlfSBmcm9tIFwiZDMtcXVhZHRyZWVcIjtcbmltcG9ydCBjb25zdGFudCBmcm9tIFwiLi9jb25zdGFudC5qc1wiO1xuaW1wb3J0IGppZ2dsZSBmcm9tIFwiLi9qaWdnbGUuanNcIjtcbmltcG9ydCB7eCwgeX0gZnJvbSBcIi4vc2ltdWxhdGlvbi5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgdmFyIG5vZGVzLFxuICAgICAgbm9kZSxcbiAgICAgIHJhbmRvbSxcbiAgICAgIGFscGhhLFxuICAgICAgc3RyZW5ndGggPSBjb25zdGFudCgtMzApLFxuICAgICAgc3RyZW5ndGhzLFxuICAgICAgZGlzdGFuY2VNaW4yID0gMSxcbiAgICAgIGRpc3RhbmNlTWF4MiA9IEluZmluaXR5LFxuICAgICAgdGhldGEyID0gMC44MTtcblxuICBmdW5jdGlvbiBmb3JjZShfKSB7XG4gICAgdmFyIGksIG4gPSBub2Rlcy5sZW5ndGgsIHRyZWUgPSBxdWFkdHJlZShub2RlcywgeCwgeSkudmlzaXRBZnRlcihhY2N1bXVsYXRlKTtcbiAgICBmb3IgKGFscGhhID0gXywgaSA9IDA7IGkgPCBuOyArK2kpIG5vZGUgPSBub2Rlc1tpXSwgdHJlZS52aXNpdChhcHBseSk7XG4gIH1cblxuICBmdW5jdGlvbiBpbml0aWFsaXplKCkge1xuICAgIGlmICghbm9kZXMpIHJldHVybjtcbiAgICB2YXIgaSwgbiA9IG5vZGVzLmxlbmd0aCwgbm9kZTtcbiAgICBzdHJlbmd0aHMgPSBuZXcgQXJyYXkobik7XG4gICAgZm9yIChpID0gMDsgaSA8IG47ICsraSkgbm9kZSA9IG5vZGVzW2ldLCBzdHJlbmd0aHNbbm9kZS5pbmRleF0gPSArc3RyZW5ndGgobm9kZSwgaSwgbm9kZXMpO1xuICB9XG5cbiAgZnVuY3Rpb24gYWNjdW11bGF0ZShxdWFkKSB7XG4gICAgdmFyIHN0cmVuZ3RoID0gMCwgcSwgYywgd2VpZ2h0ID0gMCwgeCwgeSwgaTtcblxuICAgIC8vIEZvciBpbnRlcm5hbCBub2RlcywgYWNjdW11bGF0ZSBmb3JjZXMgZnJvbSBjaGlsZCBxdWFkcmFudHMuXG4gICAgaWYgKHF1YWQubGVuZ3RoKSB7XG4gICAgICBmb3IgKHggPSB5ID0gaSA9IDA7IGkgPCA0OyArK2kpIHtcbiAgICAgICAgaWYgKChxID0gcXVhZFtpXSkgJiYgKGMgPSBNYXRoLmFicyhxLnZhbHVlKSkpIHtcbiAgICAgICAgICBzdHJlbmd0aCArPSBxLnZhbHVlLCB3ZWlnaHQgKz0gYywgeCArPSBjICogcS54LCB5ICs9IGMgKiBxLnk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHF1YWQueCA9IHggLyB3ZWlnaHQ7XG4gICAgICBxdWFkLnkgPSB5IC8gd2VpZ2h0O1xuICAgIH1cblxuICAgIC8vIEZvciBsZWFmIG5vZGVzLCBhY2N1bXVsYXRlIGZvcmNlcyBmcm9tIGNvaW5jaWRlbnQgcXVhZHJhbnRzLlxuICAgIGVsc2Uge1xuICAgICAgcSA9IHF1YWQ7XG4gICAgICBxLnggPSBxLmRhdGEueDtcbiAgICAgIHEueSA9IHEuZGF0YS55O1xuICAgICAgZG8gc3RyZW5ndGggKz0gc3RyZW5ndGhzW3EuZGF0YS5pbmRleF07XG4gICAgICB3aGlsZSAocSA9IHEubmV4dCk7XG4gICAgfVxuXG4gICAgcXVhZC52YWx1ZSA9IHN0cmVuZ3RoO1xuICB9XG5cbiAgZnVuY3Rpb24gYXBwbHkocXVhZCwgeDEsIF8sIHgyKSB7XG4gICAgaWYgKCFxdWFkLnZhbHVlKSByZXR1cm4gdHJ1ZTtcblxuICAgIHZhciB4ID0gcXVhZC54IC0gbm9kZS54LFxuICAgICAgICB5ID0gcXVhZC55IC0gbm9kZS55LFxuICAgICAgICB3ID0geDIgLSB4MSxcbiAgICAgICAgbCA9IHggKiB4ICsgeSAqIHk7XG5cbiAgICAvLyBBcHBseSB0aGUgQmFybmVzLUh1dCBhcHByb3hpbWF0aW9uIGlmIHBvc3NpYmxlLlxuICAgIC8vIExpbWl0IGZvcmNlcyBmb3IgdmVyeSBjbG9zZSBub2RlczsgcmFuZG9taXplIGRpcmVjdGlvbiBpZiBjb2luY2lkZW50LlxuICAgIGlmICh3ICogdyAvIHRoZXRhMiA8IGwpIHtcbiAgICAgIGlmIChsIDwgZGlzdGFuY2VNYXgyKSB7XG4gICAgICAgIGlmICh4ID09PSAwKSB4ID0gamlnZ2xlKHJhbmRvbSksIGwgKz0geCAqIHg7XG4gICAgICAgIGlmICh5ID09PSAwKSB5ID0gamlnZ2xlKHJhbmRvbSksIGwgKz0geSAqIHk7XG4gICAgICAgIGlmIChsIDwgZGlzdGFuY2VNaW4yKSBsID0gTWF0aC5zcXJ0KGRpc3RhbmNlTWluMiAqIGwpO1xuICAgICAgICBub2RlLnZ4ICs9IHggKiBxdWFkLnZhbHVlICogYWxwaGEgLyBsO1xuICAgICAgICBub2RlLnZ5ICs9IHkgKiBxdWFkLnZhbHVlICogYWxwaGEgLyBsO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgLy8gT3RoZXJ3aXNlLCBwcm9jZXNzIHBvaW50cyBkaXJlY3RseS5cbiAgICBlbHNlIGlmIChxdWFkLmxlbmd0aCB8fCBsID49IGRpc3RhbmNlTWF4MikgcmV0dXJuO1xuXG4gICAgLy8gTGltaXQgZm9yY2VzIGZvciB2ZXJ5IGNsb3NlIG5vZGVzOyByYW5kb21pemUgZGlyZWN0aW9uIGlmIGNvaW5jaWRlbnQuXG4gICAgaWYgKHF1YWQuZGF0YSAhPT0gbm9kZSB8fCBxdWFkLm5leHQpIHtcbiAgICAgIGlmICh4ID09PSAwKSB4ID0gamlnZ2xlKHJhbmRvbSksIGwgKz0geCAqIHg7XG4gICAgICBpZiAoeSA9PT0gMCkgeSA9IGppZ2dsZShyYW5kb20pLCBsICs9IHkgKiB5O1xuICAgICAgaWYgKGwgPCBkaXN0YW5jZU1pbjIpIGwgPSBNYXRoLnNxcnQoZGlzdGFuY2VNaW4yICogbCk7XG4gICAgfVxuXG4gICAgZG8gaWYgKHF1YWQuZGF0YSAhPT0gbm9kZSkge1xuICAgICAgdyA9IHN0cmVuZ3Roc1txdWFkLmRhdGEuaW5kZXhdICogYWxwaGEgLyBsO1xuICAgICAgbm9kZS52eCArPSB4ICogdztcbiAgICAgIG5vZGUudnkgKz0geSAqIHc7XG4gICAgfSB3aGlsZSAocXVhZCA9IHF1YWQubmV4dCk7XG4gIH1cblxuICBmb3JjZS5pbml0aWFsaXplID0gZnVuY3Rpb24oX25vZGVzLCBfcmFuZG9tKSB7XG4gICAgbm9kZXMgPSBfbm9kZXM7XG4gICAgcmFuZG9tID0gX3JhbmRvbTtcbiAgICBpbml0aWFsaXplKCk7XG4gIH07XG5cbiAgZm9yY2Uuc3RyZW5ndGggPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoc3RyZW5ndGggPSB0eXBlb2YgXyA9PT0gXCJmdW5jdGlvblwiID8gXyA6IGNvbnN0YW50KCtfKSwgaW5pdGlhbGl6ZSgpLCBmb3JjZSkgOiBzdHJlbmd0aDtcbiAgfTtcblxuICBmb3JjZS5kaXN0YW5jZU1pbiA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChkaXN0YW5jZU1pbjIgPSBfICogXywgZm9yY2UpIDogTWF0aC5zcXJ0KGRpc3RhbmNlTWluMik7XG4gIH07XG5cbiAgZm9yY2UuZGlzdGFuY2VNYXggPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoZGlzdGFuY2VNYXgyID0gXyAqIF8sIGZvcmNlKSA6IE1hdGguc3FydChkaXN0YW5jZU1heDIpO1xuICB9O1xuXG4gIGZvcmNlLnRoZXRhID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHRoZXRhMiA9IF8gKiBfLCBmb3JjZSkgOiBNYXRoLnNxcnQodGhldGEyKTtcbiAgfTtcblxuICByZXR1cm4gZm9yY2U7XG59XG4iLCAiaW1wb3J0IGNvbnN0YW50IGZyb20gXCIuL2NvbnN0YW50LmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHgpIHtcbiAgdmFyIHN0cmVuZ3RoID0gY29uc3RhbnQoMC4xKSxcbiAgICAgIG5vZGVzLFxuICAgICAgc3RyZW5ndGhzLFxuICAgICAgeHo7XG5cbiAgaWYgKHR5cGVvZiB4ICE9PSBcImZ1bmN0aW9uXCIpIHggPSBjb25zdGFudCh4ID09IG51bGwgPyAwIDogK3gpO1xuXG4gIGZ1bmN0aW9uIGZvcmNlKGFscGhhKSB7XG4gICAgZm9yICh2YXIgaSA9IDAsIG4gPSBub2Rlcy5sZW5ndGgsIG5vZGU7IGkgPCBuOyArK2kpIHtcbiAgICAgIG5vZGUgPSBub2Rlc1tpXSwgbm9kZS52eCArPSAoeHpbaV0gLSBub2RlLngpICogc3RyZW5ndGhzW2ldICogYWxwaGE7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gaW5pdGlhbGl6ZSgpIHtcbiAgICBpZiAoIW5vZGVzKSByZXR1cm47XG4gICAgdmFyIGksIG4gPSBub2Rlcy5sZW5ndGg7XG4gICAgc3RyZW5ndGhzID0gbmV3IEFycmF5KG4pO1xuICAgIHh6ID0gbmV3IEFycmF5KG4pO1xuICAgIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIHN0cmVuZ3Roc1tpXSA9IGlzTmFOKHh6W2ldID0gK3gobm9kZXNbaV0sIGksIG5vZGVzKSkgPyAwIDogK3N0cmVuZ3RoKG5vZGVzW2ldLCBpLCBub2Rlcyk7XG4gICAgfVxuICB9XG5cbiAgZm9yY2UuaW5pdGlhbGl6ZSA9IGZ1bmN0aW9uKF8pIHtcbiAgICBub2RlcyA9IF87XG4gICAgaW5pdGlhbGl6ZSgpO1xuICB9O1xuXG4gIGZvcmNlLnN0cmVuZ3RoID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHN0cmVuZ3RoID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudCgrXyksIGluaXRpYWxpemUoKSwgZm9yY2UpIDogc3RyZW5ndGg7XG4gIH07XG5cbiAgZm9yY2UueCA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/ICh4ID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudCgrXyksIGluaXRpYWxpemUoKSwgZm9yY2UpIDogeDtcbiAgfTtcblxuICByZXR1cm4gZm9yY2U7XG59XG4iLCAiaW1wb3J0IGNvbnN0YW50IGZyb20gXCIuL2NvbnN0YW50LmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHkpIHtcbiAgdmFyIHN0cmVuZ3RoID0gY29uc3RhbnQoMC4xKSxcbiAgICAgIG5vZGVzLFxuICAgICAgc3RyZW5ndGhzLFxuICAgICAgeXo7XG5cbiAgaWYgKHR5cGVvZiB5ICE9PSBcImZ1bmN0aW9uXCIpIHkgPSBjb25zdGFudCh5ID09IG51bGwgPyAwIDogK3kpO1xuXG4gIGZ1bmN0aW9uIGZvcmNlKGFscGhhKSB7XG4gICAgZm9yICh2YXIgaSA9IDAsIG4gPSBub2Rlcy5sZW5ndGgsIG5vZGU7IGkgPCBuOyArK2kpIHtcbiAgICAgIG5vZGUgPSBub2Rlc1tpXSwgbm9kZS52eSArPSAoeXpbaV0gLSBub2RlLnkpICogc3RyZW5ndGhzW2ldICogYWxwaGE7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gaW5pdGlhbGl6ZSgpIHtcbiAgICBpZiAoIW5vZGVzKSByZXR1cm47XG4gICAgdmFyIGksIG4gPSBub2Rlcy5sZW5ndGg7XG4gICAgc3RyZW5ndGhzID0gbmV3IEFycmF5KG4pO1xuICAgIHl6ID0gbmV3IEFycmF5KG4pO1xuICAgIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIHN0cmVuZ3Roc1tpXSA9IGlzTmFOKHl6W2ldID0gK3kobm9kZXNbaV0sIGksIG5vZGVzKSkgPyAwIDogK3N0cmVuZ3RoKG5vZGVzW2ldLCBpLCBub2Rlcyk7XG4gICAgfVxuICB9XG5cbiAgZm9yY2UuaW5pdGlhbGl6ZSA9IGZ1bmN0aW9uKF8pIHtcbiAgICBub2RlcyA9IF87XG4gICAgaW5pdGlhbGl6ZSgpO1xuICB9O1xuXG4gIGZvcmNlLnN0cmVuZ3RoID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHN0cmVuZ3RoID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudCgrXyksIGluaXRpYWxpemUoKSwgZm9yY2UpIDogc3RyZW5ndGg7XG4gIH07XG5cbiAgZm9yY2UueSA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/ICh5ID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudCgrXyksIGluaXRpYWxpemUoKSwgZm9yY2UpIDogeTtcbiAgfTtcblxuICByZXR1cm4gZm9yY2U7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgeCA9PiAoKSA9PiB4O1xuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIFpvb21FdmVudCh0eXBlLCB7XG4gIHNvdXJjZUV2ZW50LFxuICB0YXJnZXQsXG4gIHRyYW5zZm9ybSxcbiAgZGlzcGF0Y2hcbn0pIHtcbiAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXModGhpcywge1xuICAgIHR5cGU6IHt2YWx1ZTogdHlwZSwgZW51bWVyYWJsZTogdHJ1ZSwgY29uZmlndXJhYmxlOiB0cnVlfSxcbiAgICBzb3VyY2VFdmVudDoge3ZhbHVlOiBzb3VyY2VFdmVudCwgZW51bWVyYWJsZTogdHJ1ZSwgY29uZmlndXJhYmxlOiB0cnVlfSxcbiAgICB0YXJnZXQ6IHt2YWx1ZTogdGFyZ2V0LCBlbnVtZXJhYmxlOiB0cnVlLCBjb25maWd1cmFibGU6IHRydWV9LFxuICAgIHRyYW5zZm9ybToge3ZhbHVlOiB0cmFuc2Zvcm0sIGVudW1lcmFibGU6IHRydWUsIGNvbmZpZ3VyYWJsZTogdHJ1ZX0sXG4gICAgXzoge3ZhbHVlOiBkaXNwYXRjaH1cbiAgfSk7XG59XG4iLCAiZXhwb3J0IGZ1bmN0aW9uIFRyYW5zZm9ybShrLCB4LCB5KSB7XG4gIHRoaXMuayA9IGs7XG4gIHRoaXMueCA9IHg7XG4gIHRoaXMueSA9IHk7XG59XG5cblRyYW5zZm9ybS5wcm90b3R5cGUgPSB7XG4gIGNvbnN0cnVjdG9yOiBUcmFuc2Zvcm0sXG4gIHNjYWxlOiBmdW5jdGlvbihrKSB7XG4gICAgcmV0dXJuIGsgPT09IDEgPyB0aGlzIDogbmV3IFRyYW5zZm9ybSh0aGlzLmsgKiBrLCB0aGlzLngsIHRoaXMueSk7XG4gIH0sXG4gIHRyYW5zbGF0ZTogZnVuY3Rpb24oeCwgeSkge1xuICAgIHJldHVybiB4ID09PSAwICYgeSA9PT0gMCA/IHRoaXMgOiBuZXcgVHJhbnNmb3JtKHRoaXMuaywgdGhpcy54ICsgdGhpcy5rICogeCwgdGhpcy55ICsgdGhpcy5rICogeSk7XG4gIH0sXG4gIGFwcGx5OiBmdW5jdGlvbihwb2ludCkge1xuICAgIHJldHVybiBbcG9pbnRbMF0gKiB0aGlzLmsgKyB0aGlzLngsIHBvaW50WzFdICogdGhpcy5rICsgdGhpcy55XTtcbiAgfSxcbiAgYXBwbHlYOiBmdW5jdGlvbih4KSB7XG4gICAgcmV0dXJuIHggKiB0aGlzLmsgKyB0aGlzLng7XG4gIH0sXG4gIGFwcGx5WTogZnVuY3Rpb24oeSkge1xuICAgIHJldHVybiB5ICogdGhpcy5rICsgdGhpcy55O1xuICB9LFxuICBpbnZlcnQ6IGZ1bmN0aW9uKGxvY2F0aW9uKSB7XG4gICAgcmV0dXJuIFsobG9jYXRpb25bMF0gLSB0aGlzLngpIC8gdGhpcy5rLCAobG9jYXRpb25bMV0gLSB0aGlzLnkpIC8gdGhpcy5rXTtcbiAgfSxcbiAgaW52ZXJ0WDogZnVuY3Rpb24oeCkge1xuICAgIHJldHVybiAoeCAtIHRoaXMueCkgLyB0aGlzLms7XG4gIH0sXG4gIGludmVydFk6IGZ1bmN0aW9uKHkpIHtcbiAgICByZXR1cm4gKHkgLSB0aGlzLnkpIC8gdGhpcy5rO1xuICB9LFxuICByZXNjYWxlWDogZnVuY3Rpb24oeCkge1xuICAgIHJldHVybiB4LmNvcHkoKS5kb21haW4oeC5yYW5nZSgpLm1hcCh0aGlzLmludmVydFgsIHRoaXMpLm1hcCh4LmludmVydCwgeCkpO1xuICB9LFxuICByZXNjYWxlWTogZnVuY3Rpb24oeSkge1xuICAgIHJldHVybiB5LmNvcHkoKS5kb21haW4oeS5yYW5nZSgpLm1hcCh0aGlzLmludmVydFksIHRoaXMpLm1hcCh5LmludmVydCwgeSkpO1xuICB9LFxuICB0b1N0cmluZzogZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIFwidHJhbnNsYXRlKFwiICsgdGhpcy54ICsgXCIsXCIgKyB0aGlzLnkgKyBcIikgc2NhbGUoXCIgKyB0aGlzLmsgKyBcIilcIjtcbiAgfVxufTtcblxuZXhwb3J0IHZhciBpZGVudGl0eSA9IG5ldyBUcmFuc2Zvcm0oMSwgMCwgMCk7XG5cbnRyYW5zZm9ybS5wcm90b3R5cGUgPSBUcmFuc2Zvcm0ucHJvdG90eXBlO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiB0cmFuc2Zvcm0obm9kZSkge1xuICB3aGlsZSAoIW5vZGUuX196b29tKSBpZiAoIShub2RlID0gbm9kZS5wYXJlbnROb2RlKSkgcmV0dXJuIGlkZW50aXR5O1xuICByZXR1cm4gbm9kZS5fX3pvb207XG59XG4iLCAiZXhwb3J0IGZ1bmN0aW9uIG5vcHJvcGFnYXRpb24oZXZlbnQpIHtcbiAgZXZlbnQuc3RvcEltbWVkaWF0ZVByb3BhZ2F0aW9uKCk7XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGV2ZW50KSB7XG4gIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gIGV2ZW50LnN0b3BJbW1lZGlhdGVQcm9wYWdhdGlvbigpO1xufVxuIiwgImltcG9ydCB7ZGlzcGF0Y2h9IGZyb20gXCJkMy1kaXNwYXRjaFwiO1xuaW1wb3J0IHtkcmFnRGlzYWJsZSwgZHJhZ0VuYWJsZX0gZnJvbSBcImQzLWRyYWdcIjtcbmltcG9ydCB7aW50ZXJwb2xhdGVab29tfSBmcm9tIFwiZDMtaW50ZXJwb2xhdGVcIjtcbmltcG9ydCB7c2VsZWN0LCBwb2ludGVyfSBmcm9tIFwiZDMtc2VsZWN0aW9uXCI7XG5pbXBvcnQge2ludGVycnVwdH0gZnJvbSBcImQzLXRyYW5zaXRpb25cIjtcbmltcG9ydCBjb25zdGFudCBmcm9tIFwiLi9jb25zdGFudC5qc1wiO1xuaW1wb3J0IFpvb21FdmVudCBmcm9tIFwiLi9ldmVudC5qc1wiO1xuaW1wb3J0IHtUcmFuc2Zvcm0sIGlkZW50aXR5fSBmcm9tIFwiLi90cmFuc2Zvcm0uanNcIjtcbmltcG9ydCBub2V2ZW50LCB7bm9wcm9wYWdhdGlvbn0gZnJvbSBcIi4vbm9ldmVudC5qc1wiO1xuXG4vLyBJZ25vcmUgcmlnaHQtY2xpY2ssIHNpbmNlIHRoYXQgc2hvdWxkIG9wZW4gdGhlIGNvbnRleHQgbWVudS5cbi8vIGV4Y2VwdCBmb3IgcGluY2gtdG8tem9vbSwgd2hpY2ggaXMgc2VudCBhcyBhIHdoZWVsK2N0cmxLZXkgZXZlbnRcbmZ1bmN0aW9uIGRlZmF1bHRGaWx0ZXIoZXZlbnQpIHtcbiAgcmV0dXJuICghZXZlbnQuY3RybEtleSB8fCBldmVudC50eXBlID09PSAnd2hlZWwnKSAmJiAhZXZlbnQuYnV0dG9uO1xufVxuXG5mdW5jdGlvbiBkZWZhdWx0RXh0ZW50KCkge1xuICB2YXIgZSA9IHRoaXM7XG4gIGlmIChlIGluc3RhbmNlb2YgU1ZHRWxlbWVudCkge1xuICAgIGUgPSBlLm93bmVyU1ZHRWxlbWVudCB8fCBlO1xuICAgIGlmIChlLmhhc0F0dHJpYnV0ZShcInZpZXdCb3hcIikpIHtcbiAgICAgIGUgPSBlLnZpZXdCb3guYmFzZVZhbDtcbiAgICAgIHJldHVybiBbW2UueCwgZS55XSwgW2UueCArIGUud2lkdGgsIGUueSArIGUuaGVpZ2h0XV07XG4gICAgfVxuICAgIHJldHVybiBbWzAsIDBdLCBbZS53aWR0aC5iYXNlVmFsLnZhbHVlLCBlLmhlaWdodC5iYXNlVmFsLnZhbHVlXV07XG4gIH1cbiAgcmV0dXJuIFtbMCwgMF0sIFtlLmNsaWVudFdpZHRoLCBlLmNsaWVudEhlaWdodF1dO1xufVxuXG5mdW5jdGlvbiBkZWZhdWx0VHJhbnNmb3JtKCkge1xuICByZXR1cm4gdGhpcy5fX3pvb20gfHwgaWRlbnRpdHk7XG59XG5cbmZ1bmN0aW9uIGRlZmF1bHRXaGVlbERlbHRhKGV2ZW50KSB7XG4gIHJldHVybiAtZXZlbnQuZGVsdGFZICogKGV2ZW50LmRlbHRhTW9kZSA9PT0gMSA/IDAuMDUgOiBldmVudC5kZWx0YU1vZGUgPyAxIDogMC4wMDIpICogKGV2ZW50LmN0cmxLZXkgPyAxMCA6IDEpO1xufVxuXG5mdW5jdGlvbiBkZWZhdWx0VG91Y2hhYmxlKCkge1xuICByZXR1cm4gbmF2aWdhdG9yLm1heFRvdWNoUG9pbnRzIHx8IChcIm9udG91Y2hzdGFydFwiIGluIHRoaXMpO1xufVxuXG5mdW5jdGlvbiBkZWZhdWx0Q29uc3RyYWluKHRyYW5zZm9ybSwgZXh0ZW50LCB0cmFuc2xhdGVFeHRlbnQpIHtcbiAgdmFyIGR4MCA9IHRyYW5zZm9ybS5pbnZlcnRYKGV4dGVudFswXVswXSkgLSB0cmFuc2xhdGVFeHRlbnRbMF1bMF0sXG4gICAgICBkeDEgPSB0cmFuc2Zvcm0uaW52ZXJ0WChleHRlbnRbMV1bMF0pIC0gdHJhbnNsYXRlRXh0ZW50WzFdWzBdLFxuICAgICAgZHkwID0gdHJhbnNmb3JtLmludmVydFkoZXh0ZW50WzBdWzFdKSAtIHRyYW5zbGF0ZUV4dGVudFswXVsxXSxcbiAgICAgIGR5MSA9IHRyYW5zZm9ybS5pbnZlcnRZKGV4dGVudFsxXVsxXSkgLSB0cmFuc2xhdGVFeHRlbnRbMV1bMV07XG4gIHJldHVybiB0cmFuc2Zvcm0udHJhbnNsYXRlKFxuICAgIGR4MSA+IGR4MCA/IChkeDAgKyBkeDEpIC8gMiA6IE1hdGgubWluKDAsIGR4MCkgfHwgTWF0aC5tYXgoMCwgZHgxKSxcbiAgICBkeTEgPiBkeTAgPyAoZHkwICsgZHkxKSAvIDIgOiBNYXRoLm1pbigwLCBkeTApIHx8IE1hdGgubWF4KDAsIGR5MSlcbiAgKTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIHZhciBmaWx0ZXIgPSBkZWZhdWx0RmlsdGVyLFxuICAgICAgZXh0ZW50ID0gZGVmYXVsdEV4dGVudCxcbiAgICAgIGNvbnN0cmFpbiA9IGRlZmF1bHRDb25zdHJhaW4sXG4gICAgICB3aGVlbERlbHRhID0gZGVmYXVsdFdoZWVsRGVsdGEsXG4gICAgICB0b3VjaGFibGUgPSBkZWZhdWx0VG91Y2hhYmxlLFxuICAgICAgc2NhbGVFeHRlbnQgPSBbMCwgSW5maW5pdHldLFxuICAgICAgdHJhbnNsYXRlRXh0ZW50ID0gW1stSW5maW5pdHksIC1JbmZpbml0eV0sIFtJbmZpbml0eSwgSW5maW5pdHldXSxcbiAgICAgIGR1cmF0aW9uID0gMjUwLFxuICAgICAgaW50ZXJwb2xhdGUgPSBpbnRlcnBvbGF0ZVpvb20sXG4gICAgICBsaXN0ZW5lcnMgPSBkaXNwYXRjaChcInN0YXJ0XCIsIFwiem9vbVwiLCBcImVuZFwiKSxcbiAgICAgIHRvdWNoc3RhcnRpbmcsXG4gICAgICB0b3VjaGZpcnN0LFxuICAgICAgdG91Y2hlbmRpbmcsXG4gICAgICB0b3VjaERlbGF5ID0gNTAwLFxuICAgICAgd2hlZWxEZWxheSA9IDE1MCxcbiAgICAgIGNsaWNrRGlzdGFuY2UyID0gMCxcbiAgICAgIHRhcERpc3RhbmNlID0gMTA7XG5cbiAgZnVuY3Rpb24gem9vbShzZWxlY3Rpb24pIHtcbiAgICBzZWxlY3Rpb25cbiAgICAgICAgLnByb3BlcnR5KFwiX196b29tXCIsIGRlZmF1bHRUcmFuc2Zvcm0pXG4gICAgICAgIC5vbihcIndoZWVsLnpvb21cIiwgd2hlZWxlZCwge3Bhc3NpdmU6IGZhbHNlfSlcbiAgICAgICAgLm9uKFwibW91c2Vkb3duLnpvb21cIiwgbW91c2Vkb3duZWQpXG4gICAgICAgIC5vbihcImRibGNsaWNrLnpvb21cIiwgZGJsY2xpY2tlZClcbiAgICAgIC5maWx0ZXIodG91Y2hhYmxlKVxuICAgICAgICAub24oXCJ0b3VjaHN0YXJ0Lnpvb21cIiwgdG91Y2hzdGFydGVkKVxuICAgICAgICAub24oXCJ0b3VjaG1vdmUuem9vbVwiLCB0b3VjaG1vdmVkKVxuICAgICAgICAub24oXCJ0b3VjaGVuZC56b29tIHRvdWNoY2FuY2VsLnpvb21cIiwgdG91Y2hlbmRlZClcbiAgICAgICAgLnN0eWxlKFwiLXdlYmtpdC10YXAtaGlnaGxpZ2h0LWNvbG9yXCIsIFwicmdiYSgwLDAsMCwwKVwiKTtcbiAgfVxuXG4gIHpvb20udHJhbnNmb3JtID0gZnVuY3Rpb24oY29sbGVjdGlvbiwgdHJhbnNmb3JtLCBwb2ludCwgZXZlbnQpIHtcbiAgICB2YXIgc2VsZWN0aW9uID0gY29sbGVjdGlvbi5zZWxlY3Rpb24gPyBjb2xsZWN0aW9uLnNlbGVjdGlvbigpIDogY29sbGVjdGlvbjtcbiAgICBzZWxlY3Rpb24ucHJvcGVydHkoXCJfX3pvb21cIiwgZGVmYXVsdFRyYW5zZm9ybSk7XG4gICAgaWYgKGNvbGxlY3Rpb24gIT09IHNlbGVjdGlvbikge1xuICAgICAgc2NoZWR1bGUoY29sbGVjdGlvbiwgdHJhbnNmb3JtLCBwb2ludCwgZXZlbnQpO1xuICAgIH0gZWxzZSB7XG4gICAgICBzZWxlY3Rpb24uaW50ZXJydXB0KCkuZWFjaChmdW5jdGlvbigpIHtcbiAgICAgICAgZ2VzdHVyZSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgLmV2ZW50KGV2ZW50KVxuICAgICAgICAgIC5zdGFydCgpXG4gICAgICAgICAgLnpvb20obnVsbCwgdHlwZW9mIHRyYW5zZm9ybSA9PT0gXCJmdW5jdGlvblwiID8gdHJhbnNmb3JtLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgOiB0cmFuc2Zvcm0pXG4gICAgICAgICAgLmVuZCgpO1xuICAgICAgfSk7XG4gICAgfVxuICB9O1xuXG4gIHpvb20uc2NhbGVCeSA9IGZ1bmN0aW9uKHNlbGVjdGlvbiwgaywgcCwgZXZlbnQpIHtcbiAgICB6b29tLnNjYWxlVG8oc2VsZWN0aW9uLCBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBrMCA9IHRoaXMuX196b29tLmssXG4gICAgICAgICAgazEgPSB0eXBlb2YgayA9PT0gXCJmdW5jdGlvblwiID8gay5hcHBseSh0aGlzLCBhcmd1bWVudHMpIDogaztcbiAgICAgIHJldHVybiBrMCAqIGsxO1xuICAgIH0sIHAsIGV2ZW50KTtcbiAgfTtcblxuICB6b29tLnNjYWxlVG8gPSBmdW5jdGlvbihzZWxlY3Rpb24sIGssIHAsIGV2ZW50KSB7XG4gICAgem9vbS50cmFuc2Zvcm0oc2VsZWN0aW9uLCBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBlID0gZXh0ZW50LmFwcGx5KHRoaXMsIGFyZ3VtZW50cyksXG4gICAgICAgICAgdDAgPSB0aGlzLl9fem9vbSxcbiAgICAgICAgICBwMCA9IHAgPT0gbnVsbCA/IGNlbnRyb2lkKGUpIDogdHlwZW9mIHAgPT09IFwiZnVuY3Rpb25cIiA/IHAuYXBwbHkodGhpcywgYXJndW1lbnRzKSA6IHAsXG4gICAgICAgICAgcDEgPSB0MC5pbnZlcnQocDApLFxuICAgICAgICAgIGsxID0gdHlwZW9mIGsgPT09IFwiZnVuY3Rpb25cIiA/IGsuYXBwbHkodGhpcywgYXJndW1lbnRzKSA6IGs7XG4gICAgICByZXR1cm4gY29uc3RyYWluKHRyYW5zbGF0ZShzY2FsZSh0MCwgazEpLCBwMCwgcDEpLCBlLCB0cmFuc2xhdGVFeHRlbnQpO1xuICAgIH0sIHAsIGV2ZW50KTtcbiAgfTtcblxuICB6b29tLnRyYW5zbGF0ZUJ5ID0gZnVuY3Rpb24oc2VsZWN0aW9uLCB4LCB5LCBldmVudCkge1xuICAgIHpvb20udHJhbnNmb3JtKHNlbGVjdGlvbiwgZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gY29uc3RyYWluKHRoaXMuX196b29tLnRyYW5zbGF0ZShcbiAgICAgICAgdHlwZW9mIHggPT09IFwiZnVuY3Rpb25cIiA/IHguYXBwbHkodGhpcywgYXJndW1lbnRzKSA6IHgsXG4gICAgICAgIHR5cGVvZiB5ID09PSBcImZ1bmN0aW9uXCIgPyB5LmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgOiB5XG4gICAgICApLCBleHRlbnQuYXBwbHkodGhpcywgYXJndW1lbnRzKSwgdHJhbnNsYXRlRXh0ZW50KTtcbiAgICB9LCBudWxsLCBldmVudCk7XG4gIH07XG5cbiAgem9vbS50cmFuc2xhdGVUbyA9IGZ1bmN0aW9uKHNlbGVjdGlvbiwgeCwgeSwgcCwgZXZlbnQpIHtcbiAgICB6b29tLnRyYW5zZm9ybShzZWxlY3Rpb24sIGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIGUgPSBleHRlbnQuYXBwbHkodGhpcywgYXJndW1lbnRzKSxcbiAgICAgICAgICB0ID0gdGhpcy5fX3pvb20sXG4gICAgICAgICAgcDAgPSBwID09IG51bGwgPyBjZW50cm9pZChlKSA6IHR5cGVvZiBwID09PSBcImZ1bmN0aW9uXCIgPyBwLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgOiBwO1xuICAgICAgcmV0dXJuIGNvbnN0cmFpbihpZGVudGl0eS50cmFuc2xhdGUocDBbMF0sIHAwWzFdKS5zY2FsZSh0LmspLnRyYW5zbGF0ZShcbiAgICAgICAgdHlwZW9mIHggPT09IFwiZnVuY3Rpb25cIiA/IC14LmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgOiAteCxcbiAgICAgICAgdHlwZW9mIHkgPT09IFwiZnVuY3Rpb25cIiA/IC15LmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgOiAteVxuICAgICAgKSwgZSwgdHJhbnNsYXRlRXh0ZW50KTtcbiAgICB9LCBwLCBldmVudCk7XG4gIH07XG5cbiAgZnVuY3Rpb24gc2NhbGUodHJhbnNmb3JtLCBrKSB7XG4gICAgayA9IE1hdGgubWF4KHNjYWxlRXh0ZW50WzBdLCBNYXRoLm1pbihzY2FsZUV4dGVudFsxXSwgaykpO1xuICAgIHJldHVybiBrID09PSB0cmFuc2Zvcm0uayA/IHRyYW5zZm9ybSA6IG5ldyBUcmFuc2Zvcm0oaywgdHJhbnNmb3JtLngsIHRyYW5zZm9ybS55KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHRyYW5zbGF0ZSh0cmFuc2Zvcm0sIHAwLCBwMSkge1xuICAgIHZhciB4ID0gcDBbMF0gLSBwMVswXSAqIHRyYW5zZm9ybS5rLCB5ID0gcDBbMV0gLSBwMVsxXSAqIHRyYW5zZm9ybS5rO1xuICAgIHJldHVybiB4ID09PSB0cmFuc2Zvcm0ueCAmJiB5ID09PSB0cmFuc2Zvcm0ueSA/IHRyYW5zZm9ybSA6IG5ldyBUcmFuc2Zvcm0odHJhbnNmb3JtLmssIHgsIHkpO1xuICB9XG5cbiAgZnVuY3Rpb24gY2VudHJvaWQoZXh0ZW50KSB7XG4gICAgcmV0dXJuIFsoK2V4dGVudFswXVswXSArICtleHRlbnRbMV1bMF0pIC8gMiwgKCtleHRlbnRbMF1bMV0gKyArZXh0ZW50WzFdWzFdKSAvIDJdO1xuICB9XG5cbiAgZnVuY3Rpb24gc2NoZWR1bGUodHJhbnNpdGlvbiwgdHJhbnNmb3JtLCBwb2ludCwgZXZlbnQpIHtcbiAgICB0cmFuc2l0aW9uXG4gICAgICAgIC5vbihcInN0YXJ0Lnpvb21cIiwgZnVuY3Rpb24oKSB7IGdlc3R1cmUodGhpcywgYXJndW1lbnRzKS5ldmVudChldmVudCkuc3RhcnQoKTsgfSlcbiAgICAgICAgLm9uKFwiaW50ZXJydXB0Lnpvb20gZW5kLnpvb21cIiwgZnVuY3Rpb24oKSB7IGdlc3R1cmUodGhpcywgYXJndW1lbnRzKS5ldmVudChldmVudCkuZW5kKCk7IH0pXG4gICAgICAgIC50d2VlbihcInpvb21cIiwgZnVuY3Rpb24oKSB7XG4gICAgICAgICAgdmFyIHRoYXQgPSB0aGlzLFxuICAgICAgICAgICAgICBhcmdzID0gYXJndW1lbnRzLFxuICAgICAgICAgICAgICBnID0gZ2VzdHVyZSh0aGF0LCBhcmdzKS5ldmVudChldmVudCksXG4gICAgICAgICAgICAgIGUgPSBleHRlbnQuYXBwbHkodGhhdCwgYXJncyksXG4gICAgICAgICAgICAgIHAgPSBwb2ludCA9PSBudWxsID8gY2VudHJvaWQoZSkgOiB0eXBlb2YgcG9pbnQgPT09IFwiZnVuY3Rpb25cIiA/IHBvaW50LmFwcGx5KHRoYXQsIGFyZ3MpIDogcG9pbnQsXG4gICAgICAgICAgICAgIHcgPSBNYXRoLm1heChlWzFdWzBdIC0gZVswXVswXSwgZVsxXVsxXSAtIGVbMF1bMV0pLFxuICAgICAgICAgICAgICBhID0gdGhhdC5fX3pvb20sXG4gICAgICAgICAgICAgIGIgPSB0eXBlb2YgdHJhbnNmb3JtID09PSBcImZ1bmN0aW9uXCIgPyB0cmFuc2Zvcm0uYXBwbHkodGhhdCwgYXJncykgOiB0cmFuc2Zvcm0sXG4gICAgICAgICAgICAgIGkgPSBpbnRlcnBvbGF0ZShhLmludmVydChwKS5jb25jYXQodyAvIGEuayksIGIuaW52ZXJ0KHApLmNvbmNhdCh3IC8gYi5rKSk7XG4gICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uKHQpIHtcbiAgICAgICAgICAgIGlmICh0ID09PSAxKSB0ID0gYjsgLy8gQXZvaWQgcm91bmRpbmcgZXJyb3Igb24gZW5kLlxuICAgICAgICAgICAgZWxzZSB7IHZhciBsID0gaSh0KSwgayA9IHcgLyBsWzJdOyB0ID0gbmV3IFRyYW5zZm9ybShrLCBwWzBdIC0gbFswXSAqIGssIHBbMV0gLSBsWzFdICogayk7IH1cbiAgICAgICAgICAgIGcuem9vbShudWxsLCB0KTtcbiAgICAgICAgICB9O1xuICAgICAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGdlc3R1cmUodGhhdCwgYXJncywgY2xlYW4pIHtcbiAgICByZXR1cm4gKCFjbGVhbiAmJiB0aGF0Ll9fem9vbWluZykgfHwgbmV3IEdlc3R1cmUodGhhdCwgYXJncyk7XG4gIH1cblxuICBmdW5jdGlvbiBHZXN0dXJlKHRoYXQsIGFyZ3MpIHtcbiAgICB0aGlzLnRoYXQgPSB0aGF0O1xuICAgIHRoaXMuYXJncyA9IGFyZ3M7XG4gICAgdGhpcy5hY3RpdmUgPSAwO1xuICAgIHRoaXMuc291cmNlRXZlbnQgPSBudWxsO1xuICAgIHRoaXMuZXh0ZW50ID0gZXh0ZW50LmFwcGx5KHRoYXQsIGFyZ3MpO1xuICAgIHRoaXMudGFwcyA9IDA7XG4gIH1cblxuICBHZXN0dXJlLnByb3RvdHlwZSA9IHtcbiAgICBldmVudDogZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgIGlmIChldmVudCkgdGhpcy5zb3VyY2VFdmVudCA9IGV2ZW50O1xuICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfSxcbiAgICBzdGFydDogZnVuY3Rpb24oKSB7XG4gICAgICBpZiAoKyt0aGlzLmFjdGl2ZSA9PT0gMSkge1xuICAgICAgICB0aGlzLnRoYXQuX196b29taW5nID0gdGhpcztcbiAgICAgICAgdGhpcy5lbWl0KFwic3RhcnRcIik7XG4gICAgICB9XG4gICAgICByZXR1cm4gdGhpcztcbiAgICB9LFxuICAgIHpvb206IGZ1bmN0aW9uKGtleSwgdHJhbnNmb3JtKSB7XG4gICAgICBpZiAodGhpcy5tb3VzZSAmJiBrZXkgIT09IFwibW91c2VcIikgdGhpcy5tb3VzZVsxXSA9IHRyYW5zZm9ybS5pbnZlcnQodGhpcy5tb3VzZVswXSk7XG4gICAgICBpZiAodGhpcy50b3VjaDAgJiYga2V5ICE9PSBcInRvdWNoXCIpIHRoaXMudG91Y2gwWzFdID0gdHJhbnNmb3JtLmludmVydCh0aGlzLnRvdWNoMFswXSk7XG4gICAgICBpZiAodGhpcy50b3VjaDEgJiYga2V5ICE9PSBcInRvdWNoXCIpIHRoaXMudG91Y2gxWzFdID0gdHJhbnNmb3JtLmludmVydCh0aGlzLnRvdWNoMVswXSk7XG4gICAgICB0aGlzLnRoYXQuX196b29tID0gdHJhbnNmb3JtO1xuICAgICAgdGhpcy5lbWl0KFwiem9vbVwiKTtcbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH0sXG4gICAgZW5kOiBmdW5jdGlvbigpIHtcbiAgICAgIGlmICgtLXRoaXMuYWN0aXZlID09PSAwKSB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLnRoYXQuX196b29taW5nO1xuICAgICAgICB0aGlzLmVtaXQoXCJlbmRcIik7XG4gICAgICB9XG4gICAgICByZXR1cm4gdGhpcztcbiAgICB9LFxuICAgIGVtaXQ6IGZ1bmN0aW9uKHR5cGUpIHtcbiAgICAgIHZhciBkID0gc2VsZWN0KHRoaXMudGhhdCkuZGF0dW0oKTtcbiAgICAgIGxpc3RlbmVycy5jYWxsKFxuICAgICAgICB0eXBlLFxuICAgICAgICB0aGlzLnRoYXQsXG4gICAgICAgIG5ldyBab29tRXZlbnQodHlwZSwge1xuICAgICAgICAgIHNvdXJjZUV2ZW50OiB0aGlzLnNvdXJjZUV2ZW50LFxuICAgICAgICAgIHRhcmdldDogem9vbSxcbiAgICAgICAgICB0eXBlLFxuICAgICAgICAgIHRyYW5zZm9ybTogdGhpcy50aGF0Ll9fem9vbSxcbiAgICAgICAgICBkaXNwYXRjaDogbGlzdGVuZXJzXG4gICAgICAgIH0pLFxuICAgICAgICBkXG4gICAgICApO1xuICAgIH1cbiAgfTtcblxuICBmdW5jdGlvbiB3aGVlbGVkKGV2ZW50LCAuLi5hcmdzKSB7XG4gICAgaWYgKCFmaWx0ZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKSkgcmV0dXJuO1xuICAgIHZhciBnID0gZ2VzdHVyZSh0aGlzLCBhcmdzKS5ldmVudChldmVudCksXG4gICAgICAgIHQgPSB0aGlzLl9fem9vbSxcbiAgICAgICAgayA9IE1hdGgubWF4KHNjYWxlRXh0ZW50WzBdLCBNYXRoLm1pbihzY2FsZUV4dGVudFsxXSwgdC5rICogTWF0aC5wb3coMiwgd2hlZWxEZWx0YS5hcHBseSh0aGlzLCBhcmd1bWVudHMpKSkpLFxuICAgICAgICBwID0gcG9pbnRlcihldmVudCk7XG5cbiAgICAvLyBJZiB0aGUgbW91c2UgaXMgaW4gdGhlIHNhbWUgbG9jYXRpb24gYXMgYmVmb3JlLCByZXVzZSBpdC5cbiAgICAvLyBJZiB0aGVyZSB3ZXJlIHJlY2VudCB3aGVlbCBldmVudHMsIHJlc2V0IHRoZSB3aGVlbCBpZGxlIHRpbWVvdXQuXG4gICAgaWYgKGcud2hlZWwpIHtcbiAgICAgIGlmIChnLm1vdXNlWzBdWzBdICE9PSBwWzBdIHx8IGcubW91c2VbMF1bMV0gIT09IHBbMV0pIHtcbiAgICAgICAgZy5tb3VzZVsxXSA9IHQuaW52ZXJ0KGcubW91c2VbMF0gPSBwKTtcbiAgICAgIH1cbiAgICAgIGNsZWFyVGltZW91dChnLndoZWVsKTtcbiAgICB9XG5cbiAgICAvLyBJZiB0aGlzIHdoZWVsIGV2ZW50IHdvblx1MjAxOXQgdHJpZ2dlciBhIHRyYW5zZm9ybSBjaGFuZ2UsIGlnbm9yZSBpdC5cbiAgICBlbHNlIGlmICh0LmsgPT09IGspIHJldHVybjtcblxuICAgIC8vIE90aGVyd2lzZSwgY2FwdHVyZSB0aGUgbW91c2UgcG9pbnQgYW5kIGxvY2F0aW9uIGF0IHRoZSBzdGFydC5cbiAgICBlbHNlIHtcbiAgICAgIGcubW91c2UgPSBbcCwgdC5pbnZlcnQocCldO1xuICAgICAgaW50ZXJydXB0KHRoaXMpO1xuICAgICAgZy5zdGFydCgpO1xuICAgIH1cblxuICAgIG5vZXZlbnQoZXZlbnQpO1xuICAgIGcud2hlZWwgPSBzZXRUaW1lb3V0KHdoZWVsaWRsZWQsIHdoZWVsRGVsYXkpO1xuICAgIGcuem9vbShcIm1vdXNlXCIsIGNvbnN0cmFpbih0cmFuc2xhdGUoc2NhbGUodCwgayksIGcubW91c2VbMF0sIGcubW91c2VbMV0pLCBnLmV4dGVudCwgdHJhbnNsYXRlRXh0ZW50KSk7XG5cbiAgICBmdW5jdGlvbiB3aGVlbGlkbGVkKCkge1xuICAgICAgZy53aGVlbCA9IG51bGw7XG4gICAgICBnLmVuZCgpO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIG1vdXNlZG93bmVkKGV2ZW50LCAuLi5hcmdzKSB7XG4gICAgaWYgKHRvdWNoZW5kaW5nIHx8ICFmaWx0ZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKSkgcmV0dXJuO1xuICAgIHZhciBjdXJyZW50VGFyZ2V0ID0gZXZlbnQuY3VycmVudFRhcmdldCxcbiAgICAgICAgZyA9IGdlc3R1cmUodGhpcywgYXJncywgdHJ1ZSkuZXZlbnQoZXZlbnQpLFxuICAgICAgICB2ID0gc2VsZWN0KGV2ZW50LnZpZXcpLm9uKFwibW91c2Vtb3ZlLnpvb21cIiwgbW91c2Vtb3ZlZCwgdHJ1ZSkub24oXCJtb3VzZXVwLnpvb21cIiwgbW91c2V1cHBlZCwgdHJ1ZSksXG4gICAgICAgIHAgPSBwb2ludGVyKGV2ZW50LCBjdXJyZW50VGFyZ2V0KSxcbiAgICAgICAgeDAgPSBldmVudC5jbGllbnRYLFxuICAgICAgICB5MCA9IGV2ZW50LmNsaWVudFk7XG5cbiAgICBkcmFnRGlzYWJsZShldmVudC52aWV3KTtcbiAgICBub3Byb3BhZ2F0aW9uKGV2ZW50KTtcbiAgICBnLm1vdXNlID0gW3AsIHRoaXMuX196b29tLmludmVydChwKV07XG4gICAgaW50ZXJydXB0KHRoaXMpO1xuICAgIGcuc3RhcnQoKTtcblxuICAgIGZ1bmN0aW9uIG1vdXNlbW92ZWQoZXZlbnQpIHtcbiAgICAgIG5vZXZlbnQoZXZlbnQpO1xuICAgICAgaWYgKCFnLm1vdmVkKSB7XG4gICAgICAgIHZhciBkeCA9IGV2ZW50LmNsaWVudFggLSB4MCwgZHkgPSBldmVudC5jbGllbnRZIC0geTA7XG4gICAgICAgIGcubW92ZWQgPSBkeCAqIGR4ICsgZHkgKiBkeSA+IGNsaWNrRGlzdGFuY2UyO1xuICAgICAgfVxuICAgICAgZy5ldmVudChldmVudClcbiAgICAgICAuem9vbShcIm1vdXNlXCIsIGNvbnN0cmFpbih0cmFuc2xhdGUoZy50aGF0Ll9fem9vbSwgZy5tb3VzZVswXSA9IHBvaW50ZXIoZXZlbnQsIGN1cnJlbnRUYXJnZXQpLCBnLm1vdXNlWzFdKSwgZy5leHRlbnQsIHRyYW5zbGF0ZUV4dGVudCkpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG1vdXNldXBwZWQoZXZlbnQpIHtcbiAgICAgIHYub24oXCJtb3VzZW1vdmUuem9vbSBtb3VzZXVwLnpvb21cIiwgbnVsbCk7XG4gICAgICBkcmFnRW5hYmxlKGV2ZW50LnZpZXcsIGcubW92ZWQpO1xuICAgICAgbm9ldmVudChldmVudCk7XG4gICAgICBnLmV2ZW50KGV2ZW50KS5lbmQoKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBkYmxjbGlja2VkKGV2ZW50LCAuLi5hcmdzKSB7XG4gICAgaWYgKCFmaWx0ZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKSkgcmV0dXJuO1xuICAgIHZhciB0MCA9IHRoaXMuX196b29tLFxuICAgICAgICBwMCA9IHBvaW50ZXIoZXZlbnQuY2hhbmdlZFRvdWNoZXMgPyBldmVudC5jaGFuZ2VkVG91Y2hlc1swXSA6IGV2ZW50LCB0aGlzKSxcbiAgICAgICAgcDEgPSB0MC5pbnZlcnQocDApLFxuICAgICAgICBrMSA9IHQwLmsgKiAoZXZlbnQuc2hpZnRLZXkgPyAwLjUgOiAyKSxcbiAgICAgICAgdDEgPSBjb25zdHJhaW4odHJhbnNsYXRlKHNjYWxlKHQwLCBrMSksIHAwLCBwMSksIGV4dGVudC5hcHBseSh0aGlzLCBhcmdzKSwgdHJhbnNsYXRlRXh0ZW50KTtcblxuICAgIG5vZXZlbnQoZXZlbnQpO1xuICAgIGlmIChkdXJhdGlvbiA+IDApIHNlbGVjdCh0aGlzKS50cmFuc2l0aW9uKCkuZHVyYXRpb24oZHVyYXRpb24pLmNhbGwoc2NoZWR1bGUsIHQxLCBwMCwgZXZlbnQpO1xuICAgIGVsc2Ugc2VsZWN0KHRoaXMpLmNhbGwoem9vbS50cmFuc2Zvcm0sIHQxLCBwMCwgZXZlbnQpO1xuICB9XG5cbiAgZnVuY3Rpb24gdG91Y2hzdGFydGVkKGV2ZW50LCAuLi5hcmdzKSB7XG4gICAgaWYgKCFmaWx0ZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKSkgcmV0dXJuO1xuICAgIHZhciB0b3VjaGVzID0gZXZlbnQudG91Y2hlcyxcbiAgICAgICAgbiA9IHRvdWNoZXMubGVuZ3RoLFxuICAgICAgICBnID0gZ2VzdHVyZSh0aGlzLCBhcmdzLCBldmVudC5jaGFuZ2VkVG91Y2hlcy5sZW5ndGggPT09IG4pLmV2ZW50KGV2ZW50KSxcbiAgICAgICAgc3RhcnRlZCwgaSwgdCwgcDtcblxuICAgIG5vcHJvcGFnYXRpb24oZXZlbnQpO1xuICAgIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIHQgPSB0b3VjaGVzW2ldLCBwID0gcG9pbnRlcih0LCB0aGlzKTtcbiAgICAgIHAgPSBbcCwgdGhpcy5fX3pvb20uaW52ZXJ0KHApLCB0LmlkZW50aWZpZXJdO1xuICAgICAgaWYgKCFnLnRvdWNoMCkgZy50b3VjaDAgPSBwLCBzdGFydGVkID0gdHJ1ZSwgZy50YXBzID0gMSArICEhdG91Y2hzdGFydGluZztcbiAgICAgIGVsc2UgaWYgKCFnLnRvdWNoMSAmJiBnLnRvdWNoMFsyXSAhPT0gcFsyXSkgZy50b3VjaDEgPSBwLCBnLnRhcHMgPSAwO1xuICAgIH1cblxuICAgIGlmICh0b3VjaHN0YXJ0aW5nKSB0b3VjaHN0YXJ0aW5nID0gY2xlYXJUaW1lb3V0KHRvdWNoc3RhcnRpbmcpO1xuXG4gICAgaWYgKHN0YXJ0ZWQpIHtcbiAgICAgIGlmIChnLnRhcHMgPCAyKSB0b3VjaGZpcnN0ID0gcFswXSwgdG91Y2hzdGFydGluZyA9IHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7IHRvdWNoc3RhcnRpbmcgPSBudWxsOyB9LCB0b3VjaERlbGF5KTtcbiAgICAgIGludGVycnVwdCh0aGlzKTtcbiAgICAgIGcuc3RhcnQoKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiB0b3VjaG1vdmVkKGV2ZW50LCAuLi5hcmdzKSB7XG4gICAgaWYgKCF0aGlzLl9fem9vbWluZykgcmV0dXJuO1xuICAgIHZhciBnID0gZ2VzdHVyZSh0aGlzLCBhcmdzKS5ldmVudChldmVudCksXG4gICAgICAgIHRvdWNoZXMgPSBldmVudC5jaGFuZ2VkVG91Y2hlcyxcbiAgICAgICAgbiA9IHRvdWNoZXMubGVuZ3RoLCBpLCB0LCBwLCBsO1xuXG4gICAgbm9ldmVudChldmVudCk7XG4gICAgZm9yIChpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgdCA9IHRvdWNoZXNbaV0sIHAgPSBwb2ludGVyKHQsIHRoaXMpO1xuICAgICAgaWYgKGcudG91Y2gwICYmIGcudG91Y2gwWzJdID09PSB0LmlkZW50aWZpZXIpIGcudG91Y2gwWzBdID0gcDtcbiAgICAgIGVsc2UgaWYgKGcudG91Y2gxICYmIGcudG91Y2gxWzJdID09PSB0LmlkZW50aWZpZXIpIGcudG91Y2gxWzBdID0gcDtcbiAgICB9XG4gICAgdCA9IGcudGhhdC5fX3pvb207XG4gICAgaWYgKGcudG91Y2gxKSB7XG4gICAgICB2YXIgcDAgPSBnLnRvdWNoMFswXSwgbDAgPSBnLnRvdWNoMFsxXSxcbiAgICAgICAgICBwMSA9IGcudG91Y2gxWzBdLCBsMSA9IGcudG91Y2gxWzFdLFxuICAgICAgICAgIGRwID0gKGRwID0gcDFbMF0gLSBwMFswXSkgKiBkcCArIChkcCA9IHAxWzFdIC0gcDBbMV0pICogZHAsXG4gICAgICAgICAgZGwgPSAoZGwgPSBsMVswXSAtIGwwWzBdKSAqIGRsICsgKGRsID0gbDFbMV0gLSBsMFsxXSkgKiBkbDtcbiAgICAgIHQgPSBzY2FsZSh0LCBNYXRoLnNxcnQoZHAgLyBkbCkpO1xuICAgICAgcCA9IFsocDBbMF0gKyBwMVswXSkgLyAyLCAocDBbMV0gKyBwMVsxXSkgLyAyXTtcbiAgICAgIGwgPSBbKGwwWzBdICsgbDFbMF0pIC8gMiwgKGwwWzFdICsgbDFbMV0pIC8gMl07XG4gICAgfVxuICAgIGVsc2UgaWYgKGcudG91Y2gwKSBwID0gZy50b3VjaDBbMF0sIGwgPSBnLnRvdWNoMFsxXTtcbiAgICBlbHNlIHJldHVybjtcblxuICAgIGcuem9vbShcInRvdWNoXCIsIGNvbnN0cmFpbih0cmFuc2xhdGUodCwgcCwgbCksIGcuZXh0ZW50LCB0cmFuc2xhdGVFeHRlbnQpKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHRvdWNoZW5kZWQoZXZlbnQsIC4uLmFyZ3MpIHtcbiAgICBpZiAoIXRoaXMuX196b29taW5nKSByZXR1cm47XG4gICAgdmFyIGcgPSBnZXN0dXJlKHRoaXMsIGFyZ3MpLmV2ZW50KGV2ZW50KSxcbiAgICAgICAgdG91Y2hlcyA9IGV2ZW50LmNoYW5nZWRUb3VjaGVzLFxuICAgICAgICBuID0gdG91Y2hlcy5sZW5ndGgsIGksIHQ7XG5cbiAgICBub3Byb3BhZ2F0aW9uKGV2ZW50KTtcbiAgICBpZiAodG91Y2hlbmRpbmcpIGNsZWFyVGltZW91dCh0b3VjaGVuZGluZyk7XG4gICAgdG91Y2hlbmRpbmcgPSBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkgeyB0b3VjaGVuZGluZyA9IG51bGw7IH0sIHRvdWNoRGVsYXkpO1xuICAgIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIHQgPSB0b3VjaGVzW2ldO1xuICAgICAgaWYgKGcudG91Y2gwICYmIGcudG91Y2gwWzJdID09PSB0LmlkZW50aWZpZXIpIGRlbGV0ZSBnLnRvdWNoMDtcbiAgICAgIGVsc2UgaWYgKGcudG91Y2gxICYmIGcudG91Y2gxWzJdID09PSB0LmlkZW50aWZpZXIpIGRlbGV0ZSBnLnRvdWNoMTtcbiAgICB9XG4gICAgaWYgKGcudG91Y2gxICYmICFnLnRvdWNoMCkgZy50b3VjaDAgPSBnLnRvdWNoMSwgZGVsZXRlIGcudG91Y2gxO1xuICAgIGlmIChnLnRvdWNoMCkgZy50b3VjaDBbMV0gPSB0aGlzLl9fem9vbS5pbnZlcnQoZy50b3VjaDBbMF0pO1xuICAgIGVsc2Uge1xuICAgICAgZy5lbmQoKTtcbiAgICAgIC8vIElmIHRoaXMgd2FzIGEgZGJsdGFwLCByZXJvdXRlIHRvIHRoZSAob3B0aW9uYWwpIGRibGNsaWNrLnpvb20gaGFuZGxlci5cbiAgICAgIGlmIChnLnRhcHMgPT09IDIpIHtcbiAgICAgICAgdCA9IHBvaW50ZXIodCwgdGhpcyk7XG4gICAgICAgIGlmIChNYXRoLmh5cG90KHRvdWNoZmlyc3RbMF0gLSB0WzBdLCB0b3VjaGZpcnN0WzFdIC0gdFsxXSkgPCB0YXBEaXN0YW5jZSkge1xuICAgICAgICAgIHZhciBwID0gc2VsZWN0KHRoaXMpLm9uKFwiZGJsY2xpY2suem9vbVwiKTtcbiAgICAgICAgICBpZiAocCkgcC5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgem9vbS53aGVlbERlbHRhID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHdoZWVsRGVsdGEgPSB0eXBlb2YgXyA9PT0gXCJmdW5jdGlvblwiID8gXyA6IGNvbnN0YW50KCtfKSwgem9vbSkgOiB3aGVlbERlbHRhO1xuICB9O1xuXG4gIHpvb20uZmlsdGVyID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGZpbHRlciA9IHR5cGVvZiBfID09PSBcImZ1bmN0aW9uXCIgPyBfIDogY29uc3RhbnQoISFfKSwgem9vbSkgOiBmaWx0ZXI7XG4gIH07XG5cbiAgem9vbS50b3VjaGFibGUgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAodG91Y2hhYmxlID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudCghIV8pLCB6b29tKSA6IHRvdWNoYWJsZTtcbiAgfTtcblxuICB6b29tLmV4dGVudCA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChleHRlbnQgPSB0eXBlb2YgXyA9PT0gXCJmdW5jdGlvblwiID8gXyA6IGNvbnN0YW50KFtbK19bMF1bMF0sICtfWzBdWzFdXSwgWytfWzFdWzBdLCArX1sxXVsxXV1dKSwgem9vbSkgOiBleHRlbnQ7XG4gIH07XG5cbiAgem9vbS5zY2FsZUV4dGVudCA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChzY2FsZUV4dGVudFswXSA9ICtfWzBdLCBzY2FsZUV4dGVudFsxXSA9ICtfWzFdLCB6b29tKSA6IFtzY2FsZUV4dGVudFswXSwgc2NhbGVFeHRlbnRbMV1dO1xuICB9O1xuXG4gIHpvb20udHJhbnNsYXRlRXh0ZW50ID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHRyYW5zbGF0ZUV4dGVudFswXVswXSA9ICtfWzBdWzBdLCB0cmFuc2xhdGVFeHRlbnRbMV1bMF0gPSArX1sxXVswXSwgdHJhbnNsYXRlRXh0ZW50WzBdWzFdID0gK19bMF1bMV0sIHRyYW5zbGF0ZUV4dGVudFsxXVsxXSA9ICtfWzFdWzFdLCB6b29tKSA6IFtbdHJhbnNsYXRlRXh0ZW50WzBdWzBdLCB0cmFuc2xhdGVFeHRlbnRbMF1bMV1dLCBbdHJhbnNsYXRlRXh0ZW50WzFdWzBdLCB0cmFuc2xhdGVFeHRlbnRbMV1bMV1dXTtcbiAgfTtcblxuICB6b29tLmNvbnN0cmFpbiA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChjb25zdHJhaW4gPSBfLCB6b29tKSA6IGNvbnN0cmFpbjtcbiAgfTtcblxuICB6b29tLmR1cmF0aW9uID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGR1cmF0aW9uID0gK18sIHpvb20pIDogZHVyYXRpb247XG4gIH07XG5cbiAgem9vbS5pbnRlcnBvbGF0ZSA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChpbnRlcnBvbGF0ZSA9IF8sIHpvb20pIDogaW50ZXJwb2xhdGU7XG4gIH07XG5cbiAgem9vbS5vbiA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciB2YWx1ZSA9IGxpc3RlbmVycy5vbi5hcHBseShsaXN0ZW5lcnMsIGFyZ3VtZW50cyk7XG4gICAgcmV0dXJuIHZhbHVlID09PSBsaXN0ZW5lcnMgPyB6b29tIDogdmFsdWU7XG4gIH07XG5cbiAgem9vbS5jbGlja0Rpc3RhbmNlID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGNsaWNrRGlzdGFuY2UyID0gKF8gPSArXykgKiBfLCB6b29tKSA6IE1hdGguc3FydChjbGlja0Rpc3RhbmNlMik7XG4gIH07XG5cbiAgem9vbS50YXBEaXN0YW5jZSA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/ICh0YXBEaXN0YW5jZSA9ICtfLCB6b29tKSA6IHRhcERpc3RhbmNlO1xuICB9O1xuXG4gIHJldHVybiB6b29tO1xufVxuIiwgImltcG9ydCB7IFRleHRGaWxlVmlldywgV29ya3NwYWNlTGVhZiwgc2V0SWNvbiB9IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0IHsgcGFyc2VNdWx0aU9iamVjdEZpbGUsIFBhcnNlZE9iamVjdCB9IGZyb20gXCIuL3BhcnNlclwiO1xuXG5leHBvcnQgY29uc3QgVEFCTEVfVklFV19UWVBFID0gXCJvYmplY3QtbGlua3MtdGFibGVcIjtcblxudHlwZSBTb3J0RGlyID0gXCJhc2NcIiB8IFwiZGVzY1wiO1xudHlwZSBGaWx0ZXJPcCA9IFwiY29udGFpbnNcIiB8IFwibm90X2NvbnRhaW5zXCIgfCBcImVxdWFsc1wiIHwgXCJub3RfZXF1YWxzXCIgfCBcImlzX2VtcHR5XCIgfCBcImlzX25vdF9lbXB0eVwiO1xuXG5pbnRlcmZhY2UgUHJvcGVydHlGaWx0ZXIge1xuICBjb2x1bW46IHN0cmluZztcbiAgb3A6IEZpbHRlck9wO1xuICB2YWx1ZTogc3RyaW5nO1xufVxuXG5jb25zdCBGSUxURVJfT1BTOiB7IHZhbHVlOiBGaWx0ZXJPcDsgbGFiZWw6IHN0cmluZyB9W10gPSBbXG4gIHsgdmFsdWU6IFwiY29udGFpbnNcIiwgbGFiZWw6IFwiY29udGFpbnNcIiB9LFxuICB7IHZhbHVlOiBcIm5vdF9jb250YWluc1wiLCBsYWJlbDogXCJkb2VzIG5vdCBjb250YWluXCIgfSxcbiAgeyB2YWx1ZTogXCJlcXVhbHNcIiwgbGFiZWw6IFwiaXNcIiB9LFxuICB7IHZhbHVlOiBcIm5vdF9lcXVhbHNcIiwgbGFiZWw6IFwiaXMgbm90XCIgfSxcbiAgeyB2YWx1ZTogXCJpc19lbXB0eVwiLCBsYWJlbDogXCJpcyBlbXB0eVwiIH0sXG4gIHsgdmFsdWU6IFwiaXNfbm90X2VtcHR5XCIsIGxhYmVsOiBcImlzIG5vdCBlbXB0eVwiIH0sXG5dO1xuXG5leHBvcnQgY2xhc3MgT2JqZWN0VGFibGVWaWV3IGV4dGVuZHMgVGV4dEZpbGVWaWV3IHtcbiAgcHJpdmF0ZSBvYmplY3RzOiBQYXJzZWRPYmplY3RbXSA9IFtdO1xuICBwcml2YXRlIGNvbHVtbnM6IHN0cmluZ1tdID0gW107XG4gIHByaXZhdGUgc29ydENvbDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgc29ydERpcjogU29ydERpciA9IFwiYXNjXCI7XG4gIHByaXZhdGUgZmlsdGVyczogUHJvcGVydHlGaWx0ZXJbXSA9IFtdO1xuICBwcml2YXRlIGNvbFdpZHRoczogTWFwPHN0cmluZywgbnVtYmVyPiA9IG5ldyBNYXAoKTtcbiAgcHJpdmF0ZSB0Ym9keUVsOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGNvdW50RWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgZmlsdGVyUGFuZWxFbDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcblxuICBjb25zdHJ1Y3RvcihsZWFmOiBXb3Jrc3BhY2VMZWFmKSB7XG4gICAgc3VwZXIobGVhZik7XG4gICAgdGhpcy5hZGRBY3Rpb24oXCJlZGl0XCIsIFwiRWRpdCBhcyBtYXJrZG93blwiLCAoKSA9PiB7XG4gICAgICBpZiAoIXRoaXMuZmlsZSkgcmV0dXJuO1xuICAgICAgdGhpcy5sZWFmLnNldFZpZXdTdGF0ZSh7XG4gICAgICAgIHR5cGU6IFwibWFya2Rvd25cIixcbiAgICAgICAgc3RhdGU6IHsgZmlsZTogdGhpcy5maWxlLnBhdGggfSxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgZ2V0Vmlld1R5cGUoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gVEFCTEVfVklFV19UWVBFO1xuICB9XG5cbiAgZ2V0RGlzcGxheVRleHQoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gdGhpcy5maWxlPy5iYXNlbmFtZSA/PyBcIk9iamVjdCBUYWJsZVwiO1xuICB9XG5cbiAgZ2V0SWNvbigpOiBzdHJpbmcge1xuICAgIHJldHVybiBcInRhYmxlXCI7XG4gIH1cblxuICBzZXRWaWV3RGF0YShkYXRhOiBzdHJpbmcsIGNsZWFyOiBib29sZWFuKTogdm9pZCB7XG4gICAgdGhpcy5kYXRhID0gZGF0YTtcblxuICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlTXVsdGlPYmplY3RGaWxlKGRhdGEsIHRoaXMuZmlsZT8ucGF0aCA/PyBcIlwiKTtcbiAgICBpZiAocGFyc2VkKSB7XG4gICAgICB0aGlzLm9iamVjdHMgPSBwYXJzZWQub2JqZWN0cztcbiAgICAgIGNvbnN0IGNvbFNldCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgICAgZm9yIChjb25zdCBvYmogb2YgcGFyc2VkLm9iamVjdHMpIHtcbiAgICAgICAgZm9yIChjb25zdCBwcm9wIG9mIG9iai5wcm9wZXJ0eU9yZGVyKSB7XG4gICAgICAgICAgY29sU2V0LmFkZChwcm9wKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhpcy5jb2x1bW5zID0gQXJyYXkuZnJvbShjb2xTZXQpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLm9iamVjdHMgPSBbXTtcbiAgICAgIHRoaXMuY29sdW1ucyA9IFtdO1xuICAgIH1cblxuICAgIGlmIChjbGVhcikge1xuICAgICAgdGhpcy5zb3J0Q29sID0gbnVsbDtcbiAgICAgIHRoaXMuc29ydERpciA9IFwiYXNjXCI7XG4gICAgICB0aGlzLmZpbHRlcnMgPSBbXTtcbiAgICAgIHRoaXMuY29sV2lkdGhzID0gbmV3IE1hcCgpO1xuICAgIH1cblxuICAgIHRoaXMucmVuZGVyVGFibGUoKTtcbiAgfVxuXG4gIGdldFZpZXdEYXRhKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHRoaXMuZGF0YTtcbiAgfVxuXG4gIGNsZWFyKCk6IHZvaWQge1xuICAgIHRoaXMuZGF0YSA9IFwiXCI7XG4gICAgdGhpcy5vYmplY3RzID0gW107XG4gICAgdGhpcy5jb2x1bW5zID0gW107XG4gICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcbiAgfVxuXG4gIC8qIFx1MjUwMFx1MjUwMCBSZW5kZXJpbmcgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwICovXG5cbiAgcHJpdmF0ZSByZW5kZXJUYWJsZSgpOiB2b2lkIHtcbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIHRoaXMuY29udGVudEVsLmFkZENsYXNzKFwib2wtdGFibGUtdmlld1wiKTtcblxuICAgIGlmICh0aGlzLm9iamVjdHMubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aGlzLmNvbnRlbnRFbC5jcmVhdGVEaXYoe1xuICAgICAgICBjbHM6IFwib2wtdGFibGUtZW1wdHlcIixcbiAgICAgICAgdGV4dDogXCJObyBvYmplY3RzIGZvdW5kIGluIHRoaXMgZmlsZS5cIixcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIFx1MjUwMFx1MjUwMCBUb29sYmFyIFx1MjUwMFx1MjUwMFxuICAgIGNvbnN0IHRvb2xiYXIgPSB0aGlzLmNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwib2wtdGFibGUtdG9vbGJhclwiIH0pO1xuXG4gICAgY29uc3QgYWRkRmlsdGVyQnRuID0gdG9vbGJhci5jcmVhdGVFbChcImJ1dHRvblwiLCB7XG4gICAgICBjbHM6IFwib2wtdGFibGUtYWRkLWZpbHRlciBjbGlja2FibGUtaWNvblwiLFxuICAgIH0pO1xuICAgIHNldEljb24oYWRkRmlsdGVyQnRuLCBcImZpbHRlclwiKTtcbiAgICBhZGRGaWx0ZXJCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuYWRkRmlsdGVyKCkpO1xuXG4gICAgdGhpcy5jb3VudEVsID0gdG9vbGJhci5jcmVhdGVEaXYoeyBjbHM6IFwib2wtdGFibGUtY291bnRcIiB9KTtcblxuICAgIC8vIFx1MjUwMFx1MjUwMCBGaWx0ZXIgcGFuZWwgXHUyNTAwXHUyNTAwXG4gICAgdGhpcy5maWx0ZXJQYW5lbEVsID0gdGhpcy5jb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcIm9sLWZpbHRlci1wYW5lbFwiIH0pO1xuICAgIHRoaXMucmVuZGVyRmlsdGVyUGFuZWwoKTtcblxuICAgIC8vIFx1MjUwMFx1MjUwMCBUYWJsZSBcdTI1MDBcdTI1MDBcbiAgICBjb25zdCB3cmFwcGVyID0gdGhpcy5jb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcIm9sLXRhYmxlLXdyYXBwZXJcIiB9KTtcbiAgICBjb25zdCB0YWJsZSA9IHdyYXBwZXIuY3JlYXRlRWwoXCJ0YWJsZVwiLCB7IGNsczogXCJvbC10YWJsZVwiIH0pO1xuICAgIHRhYmxlLnN0eWxlLnRhYmxlTGF5b3V0ID0gXCJmaXhlZFwiO1xuXG4gICAgLy8gSGVhZGVyXG4gICAgY29uc3QgdGhlYWQgPSB0YWJsZS5jcmVhdGVFbChcInRoZWFkXCIpO1xuICAgIGNvbnN0IGhlYWRlclJvdyA9IHRoZWFkLmNyZWF0ZUVsKFwidHJcIik7XG5cbiAgICBmb3IgKGNvbnN0IGNvbCBvZiB0aGlzLmNvbHVtbnMpIHtcbiAgICAgIGNvbnN0IHRoID0gaGVhZGVyUm93LmNyZWF0ZUVsKFwidGhcIik7XG4gICAgICB0aC5kYXRhc2V0LmNvbCA9IGNvbDtcbiAgICAgIGNvbnN0IHN0b3JlZFdpZHRoID0gdGhpcy5jb2xXaWR0aHMuZ2V0KGNvbCk7XG4gICAgICBpZiAoc3RvcmVkV2lkdGgpIHRoLnN0eWxlLndpZHRoID0gc3RvcmVkV2lkdGggKyBcInB4XCI7XG5cbiAgICAgIGNvbnN0IGlubmVyID0gdGguY3JlYXRlRGl2KHsgY2xzOiBcIm9sLXRoLWlubmVyXCIgfSk7XG4gICAgICBpbm5lci5jcmVhdGVTcGFuKHsgY2xzOiBcIm9sLXRoLWxhYmVsXCIsIHRleHQ6IGNvbCB9KTtcblxuICAgICAgY29uc3QgYXJyb3cgPSBpbm5lci5jcmVhdGVTcGFuKHsgY2xzOiBcIm9sLXRoLWFycm93XCIgfSk7XG4gICAgICBpZiAodGhpcy5zb3J0Q29sID09PSBjb2wpIHtcbiAgICAgICAgYXJyb3cudGV4dENvbnRlbnQgPSB0aGlzLnNvcnREaXIgPT09IFwiYXNjXCIgPyBcIiBcdTI1QjJcIiA6IFwiIFx1MjVCQ1wiO1xuICAgICAgICB0aC5hZGRDbGFzcyhcIm9sLXRoLXNvcnRlZFwiKTtcbiAgICAgIH1cblxuICAgICAgLy8gU29ydCBvbiBjbGljayAoYnV0IG5vdCB3aGVuIGRyYWdnaW5nIHRoZSByZXNpemUgaGFuZGxlKVxuICAgICAgbGV0IGRpZFJlc2l6ZSA9IGZhbHNlO1xuICAgICAgaW5uZXIuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgICAgaWYgKGRpZFJlc2l6ZSkgeyBkaWRSZXNpemUgPSBmYWxzZTsgcmV0dXJuOyB9XG4gICAgICAgIGlmICh0aGlzLnNvcnRDb2wgPT09IGNvbCkge1xuICAgICAgICAgIHRoaXMuc29ydERpciA9IHRoaXMuc29ydERpciA9PT0gXCJhc2NcIiA/IFwiZGVzY1wiIDogXCJhc2NcIjtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLnNvcnRDb2wgPSBjb2w7XG4gICAgICAgICAgdGhpcy5zb3J0RGlyID0gXCJhc2NcIjtcbiAgICAgICAgfVxuICAgICAgICBoZWFkZXJSb3cucXVlcnlTZWxlY3RvckFsbChcInRoXCIpLmZvckVhY2goKGVsKSA9PiB7XG4gICAgICAgICAgZWwucmVtb3ZlQ2xhc3MoXCJvbC10aC1zb3J0ZWRcIik7XG4gICAgICAgICAgY29uc3QgYSA9IGVsLnF1ZXJ5U2VsZWN0b3IoXCIub2wtdGgtYXJyb3dcIikgYXMgSFRNTEVsZW1lbnQ7XG4gICAgICAgICAgaWYgKGEpIGEudGV4dENvbnRlbnQgPSBcIlwiO1xuICAgICAgICB9KTtcbiAgICAgICAgdGguYWRkQ2xhc3MoXCJvbC10aC1zb3J0ZWRcIik7XG4gICAgICAgIGFycm93LnRleHRDb250ZW50ID0gdGhpcy5zb3J0RGlyID09PSBcImFzY1wiID8gXCIgXHUyNUIyXCIgOiBcIiBcdTI1QkNcIjtcbiAgICAgICAgdGhpcy5yZW5kZXJSb3dzKCk7XG4gICAgICB9KTtcblxuICAgICAgLy8gUmVzaXplIGhhbmRsZVxuICAgICAgY29uc3QgaGFuZGxlID0gdGguY3JlYXRlRGl2KHsgY2xzOiBcIm9sLXRoLXJlc2l6ZVwiIH0pO1xuICAgICAgaGFuZGxlLmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZWRvd25cIiwgKGUpID0+IHtcbiAgICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBlLnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICBjb25zdCBzdGFydFggPSBlLmNsaWVudFg7XG4gICAgICAgIGNvbnN0IHN0YXJ0VyA9IHRoLm9mZnNldFdpZHRoO1xuXG4gICAgICAgIGNvbnN0IG9uTW92ZSA9IChldjogTW91c2VFdmVudCkgPT4ge1xuICAgICAgICAgIGNvbnN0IG5ld1cgPSBNYXRoLm1heCg1MCwgc3RhcnRXICsgZXYuY2xpZW50WCAtIHN0YXJ0WCk7XG4gICAgICAgICAgdGguc3R5bGUud2lkdGggPSBuZXdXICsgXCJweFwiO1xuICAgICAgICAgIGRpZFJlc2l6ZSA9IHRydWU7XG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3Qgb25VcCA9ICgpID0+IHtcbiAgICAgICAgICBkb2N1bWVudC5yZW1vdmVFdmVudExpc3RlbmVyKFwibW91c2Vtb3ZlXCIsIG9uTW92ZSk7XG4gICAgICAgICAgZG9jdW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm1vdXNldXBcIiwgb25VcCk7XG4gICAgICAgICAgdGhpcy5jb2xXaWR0aHMuc2V0KGNvbCwgdGgub2Zmc2V0V2lkdGgpO1xuICAgICAgICB9O1xuXG4gICAgICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZW1vdmVcIiwgb25Nb3ZlKTtcbiAgICAgICAgZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNldXBcIiwgb25VcCk7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBCb2R5XG4gICAgdGhpcy50Ym9keUVsID0gdGFibGUuY3JlYXRlRWwoXCJ0Ym9keVwiKTtcbiAgICB0aGlzLnJlbmRlclJvd3MoKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyUm93cygpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMudGJvZHlFbCkgcmV0dXJuO1xuICAgIHRoaXMudGJvZHlFbC5lbXB0eSgpO1xuXG4gICAgbGV0IHJvd3MgPSBbLi4udGhpcy5vYmplY3RzXTtcblxuICAgIC8vIEFwcGx5IHByb3BlcnR5IGZpbHRlcnNcbiAgICBmb3IgKGNvbnN0IGYgb2YgdGhpcy5maWx0ZXJzKSB7XG4gICAgICByb3dzID0gcm93cy5maWx0ZXIoKG9iaikgPT4gdGhpcy5tYXRjaGVzRmlsdGVyKG9iaiwgZikpO1xuICAgIH1cblxuICAgIC8vIFNvcnRcbiAgICBpZiAodGhpcy5zb3J0Q29sKSB7XG4gICAgICBjb25zdCBjb2wgPSB0aGlzLnNvcnRDb2w7XG4gICAgICBjb25zdCBkaXIgPSB0aGlzLnNvcnREaXIgPT09IFwiYXNjXCIgPyAxIDogLTE7XG4gICAgICByb3dzLnNvcnQoKGEsIGIpID0+IHtcbiAgICAgICAgY29uc3QgdmEgPSBhLnByb3BlcnRpZXNbY29sXSB8fCBcIlwiO1xuICAgICAgICBjb25zdCB2YiA9IGIucHJvcGVydGllc1tjb2xdIHx8IFwiXCI7XG4gICAgICAgIGNvbnN0IG5hID0gTnVtYmVyKHZhKTtcbiAgICAgICAgY29uc3QgbmIgPSBOdW1iZXIodmIpO1xuICAgICAgICBpZiAoIWlzTmFOKG5hKSAmJiAhaXNOYU4obmIpKSByZXR1cm4gKG5hIC0gbmIpICogZGlyO1xuICAgICAgICByZXR1cm4gdmEubG9jYWxlQ29tcGFyZSh2YikgKiBkaXI7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IG9iaiBvZiByb3dzKSB7XG4gICAgICBjb25zdCB0ciA9IHRoaXMudGJvZHlFbC5jcmVhdGVFbChcInRyXCIpO1xuICAgICAgZm9yIChjb25zdCBjb2wgb2YgdGhpcy5jb2x1bW5zKSB7XG4gICAgICAgIGNvbnN0IHRkID0gdHIuY3JlYXRlRWwoXCJ0ZFwiKTtcbiAgICAgICAgY29uc3Qgc3BhbiA9IHRkLmNyZWF0ZVNwYW4oeyBjbHM6IFwib2wtdGQtdGV4dFwiIH0pO1xuICAgICAgICBzcGFuLnRleHRDb250ZW50ID0gb2JqLnByb3BlcnRpZXNbY29sXSB8fCBcIlwiO1xuICAgICAgICBzcGFuLnRpdGxlID0gb2JqLnByb3BlcnRpZXNbY29sXSB8fCBcIlwiO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0aGlzLmNvdW50RWwpIHtcbiAgICAgIHRoaXMuY291bnRFbC50ZXh0Q29udGVudCA9IGAke3Jvd3MubGVuZ3RofSBvZiAke3RoaXMub2JqZWN0cy5sZW5ndGh9YDtcbiAgICB9XG4gIH1cblxuICAvKiBcdTI1MDBcdTI1MDAgUHJvcGVydHkgRmlsdGVycyAoTm90aW9uLXN0eWxlKSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cblxuICBwcml2YXRlIGFkZEZpbHRlcigpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5jb2x1bW5zLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICAgIHRoaXMuZmlsdGVycy5wdXNoKHtcbiAgICAgIGNvbHVtbjogdGhpcy5jb2x1bW5zWzBdLFxuICAgICAgb3A6IFwiY29udGFpbnNcIixcbiAgICAgIHZhbHVlOiBcIlwiLFxuICAgIH0pO1xuICAgIHRoaXMucmVuZGVyRmlsdGVyUGFuZWwoKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyRmlsdGVyUGFuZWwoKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLmZpbHRlclBhbmVsRWwpIHJldHVybjtcbiAgICB0aGlzLmZpbHRlclBhbmVsRWwuZW1wdHkoKTtcblxuICAgIGlmICh0aGlzLmZpbHRlcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aGlzLmZpbHRlclBhbmVsRWwuc3R5bGUuZGlzcGxheSA9IFwibm9uZVwiO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLmZpbHRlclBhbmVsRWwuc3R5bGUuZGlzcGxheSA9IFwiXCI7XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMuZmlsdGVycy5sZW5ndGg7IGkrKykge1xuICAgICAgY29uc3QgZiA9IHRoaXMuZmlsdGVyc1tpXTtcbiAgICAgIGNvbnN0IHJvdyA9IHRoaXMuZmlsdGVyUGFuZWxFbC5jcmVhdGVEaXYoeyBjbHM6IFwib2wtZmlsdGVyLXJvd1wiIH0pO1xuXG4gICAgICAvLyBDb2x1bW4gc2VsZWN0XG4gICAgICBjb25zdCBjb2xTZWxlY3QgPSByb3cuY3JlYXRlRWwoXCJzZWxlY3RcIiwgeyBjbHM6IFwib2wtZmlsdGVyLXNlbGVjdFwiIH0pO1xuICAgICAgZm9yIChjb25zdCBjb2wgb2YgdGhpcy5jb2x1bW5zKSB7XG4gICAgICAgIGNvbnN0IG9wdCA9IGNvbFNlbGVjdC5jcmVhdGVFbChcIm9wdGlvblwiLCB7IHRleHQ6IGNvbCwgdmFsdWU6IGNvbCB9KTtcbiAgICAgICAgaWYgKGNvbCA9PT0gZi5jb2x1bW4pIG9wdC5zZWxlY3RlZCA9IHRydWU7XG4gICAgICB9XG4gICAgICBjb2xTZWxlY3QuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICAgIGYuY29sdW1uID0gY29sU2VsZWN0LnZhbHVlO1xuICAgICAgICB0aGlzLnJlbmRlclJvd3MoKTtcbiAgICAgIH0pO1xuXG4gICAgICAvLyBPcGVyYXRvciBzZWxlY3RcbiAgICAgIGNvbnN0IG9wU2VsZWN0ID0gcm93LmNyZWF0ZUVsKFwic2VsZWN0XCIsIHsgY2xzOiBcIm9sLWZpbHRlci1zZWxlY3RcIiB9KTtcbiAgICAgIGZvciAoY29uc3Qgb3Agb2YgRklMVEVSX09QUykge1xuICAgICAgICBjb25zdCBvcHQgPSBvcFNlbGVjdC5jcmVhdGVFbChcIm9wdGlvblwiLCB7IHRleHQ6IG9wLmxhYmVsLCB2YWx1ZTogb3AudmFsdWUgfSk7XG4gICAgICAgIGlmIChvcC52YWx1ZSA9PT0gZi5vcCkgb3B0LnNlbGVjdGVkID0gdHJ1ZTtcbiAgICAgIH1cbiAgICAgIG9wU2VsZWN0LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgKCkgPT4ge1xuICAgICAgICBmLm9wID0gb3BTZWxlY3QudmFsdWUgYXMgRmlsdGVyT3A7XG4gICAgICAgIHRoaXMucmVuZGVyRmlsdGVyUGFuZWwoKTtcbiAgICAgICAgdGhpcy5yZW5kZXJSb3dzKCk7XG4gICAgICB9KTtcblxuICAgICAgLy8gVmFsdWUgaW5wdXQgKGhpZGRlbiBmb3IgaXNfZW1wdHkgLyBpc19ub3RfZW1wdHkpXG4gICAgICBpZiAoZi5vcCAhPT0gXCJpc19lbXB0eVwiICYmIGYub3AgIT09IFwiaXNfbm90X2VtcHR5XCIpIHtcbiAgICAgICAgY29uc3QgdmFsSW5wdXQgPSByb3cuY3JlYXRlRWwoXCJpbnB1dFwiLCB7XG4gICAgICAgICAgY2xzOiBcIm9sLWZpbHRlci1pbnB1dFwiLFxuICAgICAgICAgIHR5cGU6IFwidGV4dFwiLFxuICAgICAgICAgIHBsYWNlaG9sZGVyOiBcInZhbHVlXHUyMDI2XCIsXG4gICAgICAgIH0pO1xuICAgICAgICB2YWxJbnB1dC52YWx1ZSA9IGYudmFsdWU7XG4gICAgICAgIHZhbElucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJpbnB1dFwiLCAoKSA9PiB7XG4gICAgICAgICAgZi52YWx1ZSA9IHZhbElucHV0LnZhbHVlO1xuICAgICAgICAgIHRoaXMucmVuZGVyUm93cygpO1xuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgLy8gUmVtb3ZlIGJ1dHRvblxuICAgICAgY29uc3QgcmVtb3ZlQnRuID0gcm93LmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHtcbiAgICAgICAgY2xzOiBcIm9sLWZpbHRlci1yZW1vdmUgY2xpY2thYmxlLWljb25cIixcbiAgICAgIH0pO1xuICAgICAgc2V0SWNvbihyZW1vdmVCdG4sIFwieFwiKTtcbiAgICAgIGNvbnN0IGlkeCA9IGk7XG4gICAgICByZW1vdmVCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgICAgdGhpcy5maWx0ZXJzLnNwbGljZShpZHgsIDEpO1xuICAgICAgICB0aGlzLnJlbmRlckZpbHRlclBhbmVsKCk7XG4gICAgICAgIHRoaXMucmVuZGVyUm93cygpO1xuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBtYXRjaGVzRmlsdGVyKG9iajogUGFyc2VkT2JqZWN0LCBmOiBQcm9wZXJ0eUZpbHRlcik6IGJvb2xlYW4ge1xuICAgIGNvbnN0IHZhbCA9IChvYmoucHJvcGVydGllc1tmLmNvbHVtbl0gfHwgXCJcIikudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBmdiA9IGYudmFsdWUudG9Mb3dlckNhc2UoKTtcbiAgICBzd2l0Y2ggKGYub3ApIHtcbiAgICAgIGNhc2UgXCJjb250YWluc1wiOiByZXR1cm4gdmFsLmluY2x1ZGVzKGZ2KTtcbiAgICAgIGNhc2UgXCJub3RfY29udGFpbnNcIjogcmV0dXJuICF2YWwuaW5jbHVkZXMoZnYpO1xuICAgICAgY2FzZSBcImVxdWFsc1wiOiByZXR1cm4gdmFsID09PSBmdjtcbiAgICAgIGNhc2UgXCJub3RfZXF1YWxzXCI6IHJldHVybiB2YWwgIT09IGZ2O1xuICAgICAgY2FzZSBcImlzX2VtcHR5XCI6IHJldHVybiB2YWwgPT09IFwiXCI7XG4gICAgICBjYXNlIFwiaXNfbm90X2VtcHR5XCI6IHJldHVybiB2YWwgIT09IFwiXCI7XG4gICAgfVxuICB9XG59XG4iLCAiaW1wb3J0IHtcbiAgRWRpdG9yLFxuICBFZGl0b3JQb3NpdGlvbixcbiAgRWRpdG9yU3VnZ2VzdCxcbiAgRWRpdG9yU3VnZ2VzdENvbnRleHQsXG4gIEVkaXRvclN1Z2dlc3RUcmlnZ2VySW5mbyxcbiAgVEZpbGUsXG59IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0IHsgUGFyc2VkT2JqZWN0IH0gZnJvbSBcIi4vcGFyc2VyXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgT2JqZWN0U3VnZ2VzdGlvbiB7XG4gIC8qKiBUaGUgZGlzYW1iaWd1YXRlZCBrZXkgdXNlZCBmb3Ige3t9fSBsaW5rcyAqL1xuICBkaXNwbGF5S2V5OiBzdHJpbmc7XG4gIC8qKiBUaGUgb3JpZ2luYWwga2V5IHZhbHVlIChmb3IgZGlzcGxheS9zZWFyY2gpICovXG4gIGtleVZhbHVlOiBzdHJpbmc7XG4gIGZpbGVMYWJlbDogc3RyaW5nO1xuICBmaWxlUGF0aDogc3RyaW5nO1xuICBwcm9wZXJ0aWVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xufVxuXG5leHBvcnQgY2xhc3MgT2JqZWN0TGlua1N1Z2dlc3QgZXh0ZW5kcyBFZGl0b3JTdWdnZXN0PE9iamVjdFN1Z2dlc3Rpb24+IHtcbiAgcHJpdmF0ZSBvYmplY3RzOiBPYmplY3RTdWdnZXN0aW9uW10gPSBbXTtcblxuICBjb25zdHJ1Y3RvcihhcHA6IGFueSkge1xuICAgIHN1cGVyKGFwcCk7XG5cbiAgICAvLyBNYWtlIHN1Z2dlc3Rpb25zIGFjY2VwdCB3aXRoIFRhYiAoaW4gYWRkaXRpb24gdG8gRW50ZXIpLlxuICAgIC8vIE9ic2lkaWFuJ3MgUG9wb3ZlclN1Z2dlc3QgdXNlcyBhbiBpbnRlcm5hbCBcImNob29zZXJcIjsgd2UgY2FsbCBpdCBiZXN0LWVmZm9ydC5cbiAgICB0aGlzLnNldEluc3RydWN0aW9ucyhbXG4gICAgICB7IGNvbW1hbmQ6IFwiXHUyMTkxXHUyMTkzXCIsIHB1cnBvc2U6IFwidG8gbmF2aWdhdGVcIiB9LFxuICAgICAgeyBjb21tYW5kOiBcIkVudGVyXCIsIHB1cnBvc2U6IFwidG8gaW5zZXJ0XCIgfSxcbiAgICAgIHsgY29tbWFuZDogXCJUYWJcIiwgcHVycG9zZTogXCJ0byBpbnNlcnRcIiB9LFxuICAgICAgeyBjb21tYW5kOiBcIkVzY1wiLCBwdXJwb3NlOiBcInRvIGRpc21pc3NcIiB9LFxuICAgIF0pO1xuXG4gICAgdGhpcy5zY29wZS5yZWdpc3RlcihbXSwgXCJUYWJcIiwgKGV2dCkgPT4ge1xuICAgICAgY29uc3QgZSA9IGV2dCBhcyBLZXlib2FyZEV2ZW50O1xuICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIGNvbnN0IGNob29zZXIgPSAodGhpcyBhcyBhbnkpLmNob29zZXI7XG4gICAgICBpZiAoY2hvb3NlciAmJiB0eXBlb2YgY2hvb3Nlci51c2VTZWxlY3RlZEl0ZW0gPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICBjaG9vc2VyLnVzZVNlbGVjdGVkSXRlbShlKTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgICAvLyBGYWxsYmFjazogc2ltdWxhdGUgRW50ZXJcbiAgICAgIGlmIChjaG9vc2VyICYmIHR5cGVvZiBjaG9vc2VyLm9uRW50ZXIgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICBjaG9vc2VyLm9uRW50ZXIoZSk7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSk7XG4gIH1cblxuICBzZXRPYmplY3RzKG9iamVjdHM6IFBhcnNlZE9iamVjdFtdKTogdm9pZCB7XG4gICAgdGhpcy5vYmplY3RzID0gb2JqZWN0cy5tYXAoKG8pID0+ICh7XG4gICAgICBkaXNwbGF5S2V5OiBvLmRpc3BsYXlLZXksXG4gICAgICBrZXlWYWx1ZTogby5rZXlWYWx1ZSxcbiAgICAgIGZpbGVMYWJlbDogby5maWxlTGFiZWwsXG4gICAgICBmaWxlUGF0aDogby5maWxlUGF0aCxcbiAgICAgIHByb3BlcnRpZXM6IG8ucHJvcGVydGllcyxcbiAgICB9KSk7XG4gIH1cblxuICBvblRyaWdnZXIoXG4gICAgY3Vyc29yOiBFZGl0b3JQb3NpdGlvbixcbiAgICBlZGl0b3I6IEVkaXRvcixcbiAgICBfZmlsZTogVEZpbGUgfCBudWxsXG4gICk6IEVkaXRvclN1Z2dlc3RUcmlnZ2VySW5mbyB8IG51bGwge1xuICAgIGNvbnN0IGxpbmUgPSBlZGl0b3IuZ2V0TGluZShjdXJzb3IubGluZSk7XG4gICAgY29uc3Qgc3ViID0gbGluZS5zdWJzdHJpbmcoMCwgY3Vyc29yLmNoKTtcblxuICAgIC8vIEZpbmQgdGhlIGxhc3Qge3sgdGhhdCBpc24ndCBjbG9zZWRcbiAgICBjb25zdCBsYXN0T3BlbiA9IHN1Yi5sYXN0SW5kZXhPZihcInt7XCIpO1xuICAgIGlmIChsYXN0T3BlbiA9PT0gLTEpIHJldHVybiBudWxsO1xuXG4gICAgLy8gQ2hlY2sgaXQncyBub3QgYWxyZWFkeSBjbG9zZWRcbiAgICBjb25zdCBhZnRlck9wZW4gPSBzdWIuc3Vic3RyaW5nKGxhc3RPcGVuICsgMik7XG4gICAgaWYgKGFmdGVyT3Blbi5pbmNsdWRlcyhcIn19XCIpKSByZXR1cm4gbnVsbDtcblxuICAgIGNvbnN0IHF1ZXJ5ID0gYWZ0ZXJPcGVuO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXJ0OiB7IGxpbmU6IGN1cnNvci5saW5lLCBjaDogbGFzdE9wZW4gKyAyIH0sXG4gICAgICBlbmQ6IGN1cnNvcixcbiAgICAgIHF1ZXJ5LFxuICAgIH07XG4gIH1cblxuICBnZXRTdWdnZXN0aW9ucyhjb250ZXh0OiBFZGl0b3JTdWdnZXN0Q29udGV4dCk6IE9iamVjdFN1Z2dlc3Rpb25bXSB7XG4gICAgY29uc3QgcXVlcnkgPSBjb250ZXh0LnF1ZXJ5LnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKCFxdWVyeSkgcmV0dXJuIHRoaXMub2JqZWN0cy5zbGljZSgwLCAyMCk7XG5cbiAgICByZXR1cm4gdGhpcy5vYmplY3RzXG4gICAgICAuZmlsdGVyKFxuICAgICAgICAobykgPT5cbiAgICAgICAgICBvLmRpc3BsYXlLZXkudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhxdWVyeSkgfHxcbiAgICAgICAgICBvLmtleVZhbHVlLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMocXVlcnkpXG4gICAgICApXG4gICAgICAuc2xpY2UoMCwgMjApO1xuICB9XG5cbiAgcmVuZGVyU3VnZ2VzdGlvbihzdWdnZXN0aW9uOiBPYmplY3RTdWdnZXN0aW9uLCBlbDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICBjb25zdCBjb250YWluZXIgPSBlbC5jcmVhdGVEaXYoeyBjbHM6IFwib2wtc3VnZ2VzdGlvblwiIH0pO1xuXG4gICAgY29uc3QgdGl0bGVFbCA9IGNvbnRhaW5lci5jcmVhdGVEaXYoeyBjbHM6IFwib2wtc3VnZ2VzdGlvbi10aXRsZVwiIH0pO1xuICAgIHRpdGxlRWwudGV4dENvbnRlbnQgPSBzdWdnZXN0aW9uLmRpc3BsYXlLZXk7XG5cbiAgICBjb25zdCBmaWxlRWwgPSBjb250YWluZXIuY3JlYXRlRGl2KHsgY2xzOiBcIm9sLXN1Z2dlc3Rpb24tZmlsZVwiIH0pO1xuICAgIGZpbGVFbC50ZXh0Q29udGVudCA9IHN1Z2dlc3Rpb24uZmlsZUxhYmVsO1xuICB9XG5cbiAgc2VsZWN0U3VnZ2VzdGlvbihcbiAgICBzdWdnZXN0aW9uOiBPYmplY3RTdWdnZXN0aW9uLFxuICAgIF9ldnQ6IE1vdXNlRXZlbnQgfCBLZXlib2FyZEV2ZW50XG4gICk6IHZvaWQge1xuICAgIGlmICghdGhpcy5jb250ZXh0KSByZXR1cm47XG5cbiAgICBjb25zdCBlZGl0b3IgPSB0aGlzLmNvbnRleHQuZWRpdG9yO1xuICAgIGNvbnN0IHN0YXJ0ID0gdGhpcy5jb250ZXh0LnN0YXJ0O1xuICAgIGNvbnN0IGVuZCA9IHRoaXMuY29udGV4dC5lbmQ7XG5cbiAgICAvLyBDaGVjayBpZiB9fSBhbHJlYWR5IGV4aXN0cyByaWdodCBhZnRlciB0aGUgY3Vyc29yIChhdXRvLWNsb3NlZCBieSBPYnNpZGlhbilcbiAgICBjb25zdCBsaW5lVGV4dCA9IGVkaXRvci5nZXRMaW5lKGVuZC5saW5lKTtcbiAgICBjb25zdCBhZnRlckN1cnNvciA9IGxpbmVUZXh0LnN1YnN0cmluZyhlbmQuY2gpO1xuICAgIGNvbnN0IGhhc0Nsb3NpbmcgPSBhZnRlckN1cnNvci5zdGFydHNXaXRoKFwifX1cIik7XG5cbiAgICAvLyBSZXBsYWNlIHRoZSBxdWVyeSB0ZXh0IHdpdGggdGhlIGRpc3BsYXkga2V5LCBjb25zdW1pbmcgZXhpc3RpbmcgfX0gaWYgcHJlc2VudFxuICAgIGNvbnN0IHJlcGxhY2VUbyA9IGhhc0Nsb3NpbmdcbiAgICAgID8geyBsaW5lOiBlbmQubGluZSwgY2g6IGVuZC5jaCArIDIgfVxuICAgICAgOiBlbmQ7XG4gICAgZWRpdG9yLnJlcGxhY2VSYW5nZShzdWdnZXN0aW9uLmRpc3BsYXlLZXkgKyBcIn19XCIsIHN0YXJ0LCByZXBsYWNlVG8pO1xuICB9XG59XG4iLCAiLyoqXG4gKiBDb2RlTWlycm9yIDYgZWRpdG9yIGV4dGVuc2lvbiB0aGF0IGhpZ2hsaWdodHMge3tvYmplY3QgbGlua3N9fVxuICogaW4gbGl2ZS1wcmV2aWV3IG1vZGUgdG8gbWF0Y2ggdGhlIGFwcGVhcmFuY2Ugb2YgW1t3aWtpbGlua3NdXS5cbiAqXG4gKiBVc2VzIE9ic2lkaWFuJ3Mgb3duIENTUyB2YXJpYWJsZXMgYW5kIGNsYXNzZXMgc28gdGhlIHN0eWxpbmdcbiAqIGlzIGNvbnNpc3RlbnQgd2l0aCB0aGUgbmF0aXZlIGxpbmsgYXBwZWFyYW5jZS5cbiAqL1xuXG5pbXBvcnQge1xuICBEZWNvcmF0aW9uLFxuICBEZWNvcmF0aW9uU2V0LFxuICBFZGl0b3JWaWV3LFxuICBWaWV3UGx1Z2luLFxuICBWaWV3VXBkYXRlLFxuICBrZXltYXAsXG59IGZyb20gXCJAY29kZW1pcnJvci92aWV3XCI7XG5pbXBvcnQgeyBFZGl0b3JTZWxlY3Rpb24sIFJhbmdlU2V0QnVpbGRlciB9IGZyb20gXCJAY29kZW1pcnJvci9zdGF0ZVwiO1xuXG4vKiBcdTI1MDBcdTI1MDAgRGVjb3JhdGlvbiBzcGVjcyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cblxuY29uc3QgbGlua0RlY28gPSBEZWNvcmF0aW9uLm1hcmsoeyBjbGFzczogXCJvbC1jbS1saW5rXCIgfSk7XG5jb25zdCBsaW5rRWRpdGluZ0RlY28gPSBEZWNvcmF0aW9uLm1hcmsoeyBjbGFzczogXCJvbC1jbS1saW5rLWVkaXRpbmdcIiB9KTtcblxuLyogXHUyNTAwXHUyNTAwIEJ1aWxkIGRlY29yYXRpb25zIGZvciB2aXNpYmxlIHJhbmdlcyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cblxuZnVuY3Rpb24gYnVpbGREZWNvcmF0aW9ucyh2aWV3OiBFZGl0b3JWaWV3KTogRGVjb3JhdGlvblNldCB7XG4gIGNvbnN0IGJ1aWxkZXIgPSBuZXcgUmFuZ2VTZXRCdWlsZGVyPERlY29yYXRpb24+KCk7XG4gIGNvbnN0IGN1cnNvckhlYWQgPSB2aWV3LnN0YXRlLnNlbGVjdGlvbi5tYWluLmhlYWQ7XG4gIGNvbnN0IHJlZ2V4ID0gL1xce1xceyhbXn1dKylcXH1cXH0vZztcblxuICBmb3IgKGNvbnN0IHsgZnJvbSwgdG8gfSBvZiB2aWV3LnZpc2libGVSYW5nZXMpIHtcbiAgICBjb25zdCB0ZXh0ID0gdmlldy5zdGF0ZS5zbGljZURvYyhmcm9tLCB0byk7XG4gICAgbGV0IG1hdGNoOiBSZWdFeHBFeGVjQXJyYXkgfCBudWxsO1xuXG4gICAgd2hpbGUgKChtYXRjaCA9IHJlZ2V4LmV4ZWModGV4dCkpICE9PSBudWxsKSB7XG4gICAgICBjb25zdCBzdGFydCA9IGZyb20gKyBtYXRjaC5pbmRleDtcbiAgICAgIGNvbnN0IGVuZCA9IHN0YXJ0ICsgbWF0Y2hbMF0ubGVuZ3RoO1xuXG4gICAgICAvLyBVc2UgYSBzdWJ0bGVyIHN0eWxlIHdoZW4gdGhlIGN1cnNvciBpcyBpbnNpZGUgdGhlIG1hdGNoXG4gICAgICBjb25zdCBjdXJzb3JJbnNpZGUgPSBjdXJzb3JIZWFkID49IHN0YXJ0ICYmIGN1cnNvckhlYWQgPD0gZW5kO1xuICAgICAgYnVpbGRlci5hZGQoc3RhcnQsIGVuZCwgY3Vyc29ySW5zaWRlID8gbGlua0VkaXRpbmdEZWNvIDogbGlua0RlY28pO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBidWlsZGVyLmZpbmlzaCgpO1xufVxuXG4vKiBcdTI1MDBcdTI1MDAgVmlld1BsdWdpbiBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cblxuZXhwb3J0IGNvbnN0IG9iamVjdExpbmtIaWdobGlnaHRlciA9IFZpZXdQbHVnaW4uZnJvbUNsYXNzKFxuICBjbGFzcyB7XG4gICAgZGVjb3JhdGlvbnM6IERlY29yYXRpb25TZXQ7XG5cbiAgICBjb25zdHJ1Y3Rvcih2aWV3OiBFZGl0b3JWaWV3KSB7XG4gICAgICB0aGlzLmRlY29yYXRpb25zID0gYnVpbGREZWNvcmF0aW9ucyh2aWV3KTtcbiAgICB9XG5cbiAgICB1cGRhdGUodXBkYXRlOiBWaWV3VXBkYXRlKTogdm9pZCB7XG4gICAgICBpZiAodXBkYXRlLmRvY0NoYW5nZWQgfHwgdXBkYXRlLnZpZXdwb3J0Q2hhbmdlZCB8fCB1cGRhdGUuc2VsZWN0aW9uU2V0KSB7XG4gICAgICAgIHRoaXMuZGVjb3JhdGlvbnMgPSBidWlsZERlY29yYXRpb25zKHVwZGF0ZS52aWV3KTtcbiAgICAgIH1cbiAgICB9XG4gIH0sXG4gIHtcbiAgICBkZWNvcmF0aW9uczogKHYpID0+IHYuZGVjb3JhdGlvbnMsXG4gIH1cbik7XG5cbi8qKlxuICogS2V5YmluZGluZzogaWYgeW91IGhhdmUgYSBzZWxlY3Rpb24gYW5kIHByZXNzIGB7YCwgd3JhcCBpdCBpbiBge3sgLi4uIH19YC5cbiAqIElmIHRoZXJlJ3Mgbm8gc2VsZWN0aW9uLCBsZXQgQ29kZU1pcnJvciBpbnNlcnQgYHtgIG5vcm1hbGx5LlxuICovXG5leHBvcnQgY29uc3Qgb2JqZWN0TGlua1dyYXBwZXJLZXltYXAgPSBrZXltYXAub2YoW1xuICB7XG4gICAga2V5OiBcIntcIixcbiAgICBydW46ICh2aWV3KSA9PiB7XG4gICAgICBjb25zdCBzZWwgPSB2aWV3LnN0YXRlLnNlbGVjdGlvbjtcbiAgICAgIGlmIChzZWwucmFuZ2VzLmV2ZXJ5KChyKSA9PiByLmVtcHR5KSkgcmV0dXJuIGZhbHNlO1xuXG4gICAgICBjb25zdCBjaGFuZ2VzOiB7IGZyb206IG51bWJlcjsgdG86IG51bWJlcjsgaW5zZXJ0OiBzdHJpbmcgfVtdID0gW107XG4gICAgICBjb25zdCBuZXdSYW5nZXM6IGFueVtdID0gW107XG5cbiAgICAgIGZvciAoY29uc3QgciBvZiBzZWwucmFuZ2VzKSB7XG4gICAgICAgIGNvbnN0IHRleHQgPSB2aWV3LnN0YXRlLmRvYy5zbGljZVN0cmluZyhyLmZyb20sIHIudG8pO1xuICAgICAgICBjb25zdCBpbnNlcnQgPSBge3ske3RleHR9fX1gO1xuICAgICAgICBjaGFuZ2VzLnB1c2goeyBmcm9tOiByLmZyb20sIHRvOiByLnRvLCBpbnNlcnQgfSk7XG5cbiAgICAgICAgLy8gUGxhY2UgY3Vyc29yIGluc2lkZSB0aGUgYnJhY2VzLCBzZWxlY3RpbmcgdGhlIG9yaWdpbmFsIHRleHQuXG4gICAgICAgIGNvbnN0IHN0YXJ0ID0gci5mcm9tICsgMjtcbiAgICAgICAgY29uc3QgZW5kID0gc3RhcnQgKyB0ZXh0Lmxlbmd0aDtcbiAgICAgICAgbmV3UmFuZ2VzLnB1c2goRWRpdG9yU2VsZWN0aW9uLnJhbmdlKHN0YXJ0LCBlbmQpKTtcbiAgICAgIH1cblxuICAgICAgdmlldy5kaXNwYXRjaCh7XG4gICAgICAgIGNoYW5nZXMsXG4gICAgICAgIHNlbGVjdGlvbjogRWRpdG9yU2VsZWN0aW9uLmNyZWF0ZShuZXdSYW5nZXMsIHNlbC5tYWluSW5kZXgpLFxuICAgICAgfSk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9LFxuICB9LFxuXSk7XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLElBQUFBLG1CQVNPOzs7QUNpREEsU0FBUyxxQkFDZCxTQUNBLFVBQ21CO0FBQ25CLFFBQU0sUUFBUSxRQUFRLE1BQU0sSUFBSTtBQUdoQyxNQUFJLFdBQVc7QUFDZixNQUFJLE1BQU0sU0FBUyxLQUFLLE1BQU0sQ0FBQyxFQUFFLEtBQUssTUFBTSxPQUFPO0FBQ2pELGFBQVMsSUFBSSxHQUFHLElBQUksTUFBTSxRQUFRLEtBQUs7QUFDckMsVUFBSSxNQUFN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O0FBQUEsRUFDUCxXQUFXO0FBQUEsRUFDWCxXQUFXO0FBQUEsRUFDWCxZQUFZO0FBQUEsRUFDWixXQUFXO0FBQUEsRUFDWCxPQUFPO0FBQUEsRUFDUCxnQkFBZ0I7QUFBQSxFQUNoQixVQUFVO0FBQUEsRUFDVixTQUFTO0FBQUEsRUFDVCxNQUFNO0FBQUEsRUFDTixVQUFVO0FBQUEsRUFDVixVQUFVO0FBQUEsRUFDVixlQUFlO0FBQUEsRUFDZixVQUFVO0FBQUEsRUFDVixXQUFXO0FBQUEsRUFDWCxVQUFVO0FBQUEsRUFDVixXQUFXO0FBQUEsRUFDWCxhQUFhO0FBQUEsRUFDYixnQkFBZ0I7QUFBQSxFQUNoQixZQUFZO0FBQUEsRUFDWixZQUFZO0FBQUEsRUFDWixTQUFTO0FBQUEsRUFDVCxZQUFZO0FBQUEsRUFDWixjQUFjO0FBQUEsRUFDZCxlQUFlO0FBQUEsRUFDZixlQUFlO0FBQUEsRUFDZixlQUFlO0FBQUEsRUFDZixlQUFlO0FBQUEsRUFDZixZQUFZO0FBQUEsRUFDWixVQUFVO0FBQUEsRUFDVixhQUFhO0FBQUEsRUFDYixTQUFTO0FBQUEsRUFDVCxTQUFTO0FBQUEsRUFDVCxZQUFZO0FBQUEsRUFDWixXQUFXO0FBQUEsRUFDWCxhQUFhO0FBQUEsRUFDYixhQUFhO0FBQUEsRUFDYixTQUFTO0FBQUEsRUFDVCxXQUFXO0FBQUEsRUFDWCxZQUFZO0FBQUEsRUFDWixNQUFNO0FBQUEsRUFDTixXQUFXO0FBQUEsRUFDWCxNQUFNO0FBQUEsRUFDTixPQUFPO0FBQUEsRUFDUCxhQUFhO0FBQUEsRUFDYixNQUFNO0FBQUEsRUFDTixVQUFVO0FBQUEsRUFDVixTQUFTO0FBQUEsRUFDVCxXQUFXO0FBQUEsRUFDWCxRQUFRO0FBQUEsRUFDUixPQUFPO0FBQUEsRUFDUCxPQUFPO0FBQUEsRUFDUCxVQUFVO0FBQUEsRUFDVixlQUFlO0FBQUEsRUFDZixXQUFXO0FBQUEsRUFDWCxjQUFjO0FBQUEsRUFDZCxXQUFXO0FBQUEsRUFDWCxZQUFZO0FBQUEsRUFDWixXQUFXO0FBQUEsRUFDWCxzQkFBc0I7QUFBQSxFQUN0QixXQUFXO0FBQUEsRUFDWCxZQUFZO0FBQUEsRUFDWixXQUFXO0FBQUEsRUFDWCxXQUFXO0FBQUEsRUFDWCxhQUFhO0FBQUEsRUFDYixlQUFlO0FBQUEsRUFDZixjQUFjO0FBQUEsRUFDZCxnQkFBZ0I7QUFBQSxFQUNoQixnQkFBZ0I7QUFBQSxFQUNoQixnQkFBZ0I7QUFBQSxFQUNoQixhQUFhO0FBQUEsRUFDYixNQUFNO0FBQUEsRUFDTixXQUFXO0FBQUEsRUFDWCxPQUFPO0FBQUEsRUFDUCxTQUFTO0FBQUEsRUFDVCxRQUFRO0FBQUEsRUFDUixrQkFBa0I7QUFBQSxFQUNsQixZQUFZO0FBQUEsRUFDWixjQUFjO0FBQUEsRUFDZCxjQUFjO0FBQUEsRUFDZCxnQkFBZ0I7QUFBQSxFQUNoQixpQkFBaUI7QUFBQSxFQUNqQixtQkFBbUI7QUFBQSxFQUNuQixpQkFBaUI7QUFBQSxFQUNqQixpQkFBaUI7QUFBQSxFQUNqQixjQUFjO0FBQUEsRUFDZCxXQUFXO0FBQUEsRUFDWCxXQUFXO0FBQUEsRUFDWCxVQUFVO0FBQUEsRUFDVixhQUFhO0FBQUEsRUFDYixNQUFNO0FBQUEsRUFDTixTQUFTO0FBQUEsRUFDVCxPQUFPO0FBQUEsRUFDUCxXQUFXO0FBQUEsRUFDWCxRQUFRO0FBQUEsRUFDUixXQUFXO0FBQUEsRUFDWCxRQUFRO0FBQUEsRUFDUixlQUFlO0FBQUEsRUFDZixXQUFXO0FBQUEsRUFDWCxlQUFlO0FBQUEsRUFDZixlQUFlO0FBQUEsRUFDZixZQUFZO0FBQUEsRUFDWixXQUFXO0FBQUEsRUFDWCxNQUFNO0FBQUEsRUFDTixNQUFNO0FBQUEsRUFDTixNQUFNO0FBQUEsRUFDTixZQUFZO0FBQUEsRUFDWixRQUFRO0FBQUEsRUFDUixlQUFlO0FBQUEsRUFDZixLQUFLO0FBQUEsRUFDTCxXQUFXO0FBQUEsRUFDWCxXQUFXO0FBQUEsRUFDWCxhQUFhO0FBQUEsRUFDYixRQUFRO0FBQUEsRUFDUixZQUFZO0FBQUEsRUFDWixVQUFVO0FBQUEsRUFDVixVQUFVO0FBQUEsRUFDVixRQUFRO0FBQUEsRUFDUixRQUFRO0FBQUEsRUFDUixTQUFTO0FBQUEsRUFDVCxXQUFXO0FBQUEsRUFDWCxXQUFXO0FBQUEsRUFDWCxXQUFXO0FBQUEsRUFDWCxNQUFNO0FBQUEsRUFDTixhQUFhO0FBQUEsRUFDYixXQUFXO0FBQUEsRUFDWCxLQUFLO0FBQUEsRUFDTCxNQUFNO0FBQUEsRUFDTixTQUFTO0FBQUEsRUFDVCxRQUFRO0FBQUEsRUFDUixXQUFXO0FBQUEsRUFDWCxRQUFRO0FBQUEsRUFDUixPQUFPO0FBQUEsRUFDUCxPQUFPO0FBQUEsRUFDUCxZQUFZO0FBQUEsRUFDWixRQUFRO0FBQUEsRUFDUixhQUFhO0FBQ2Y7QUFFQSxlQUFPLE9BQU8sT0FBTztBQUFBLEVBQ25CLEtBQUssVUFBVTtBQUNiLFdBQU8sT0FBTyxPQUFPLElBQUksS0FBSyxlQUFhLE1BQU0sUUFBUTtBQUFBLEVBQzNEO0FBQUEsRUFDQSxjQUFjO0FBQ1osV0FBTyxLQUFLLElBQUksRUFBRSxZQUFZO0FBQUEsRUFDaEM7QUFBQSxFQUNBLEtBQUs7QUFBQTtBQUFBLEVBQ0wsV0FBVztBQUFBLEVBQ1gsWUFBWTtBQUFBLEVBQ1osV0FBVztBQUFBLEVBQ1gsV0FBVztBQUFBLEVBQ1gsVUFBVTtBQUNaLENBQUM7QUFFRCxTQUFTLGtCQUFrQjtBQUN6QixTQUFPLEtBQUssSUFBSSxFQUFFLFVBQVU7QUFDOUI7QUFFQSxTQUFTLG1CQUFtQjtBQUMxQixTQUFPLEtBQUssSUFBSSxFQUFFLFdBQVc7QUFDL0I7QUFFQSxTQUFTLGtCQUFrQjtBQUN6QixTQUFPLFdBQVcsSUFBSSxFQUFFLFVBQVU7QUFDcEM7QUFFQSxTQUFTLGtCQUFrQjtBQUN6QixTQUFPLEtBQUssSUFBSSxFQUFFLFVBQVU7QUFDOUI7QUFFZSxTQUFSLE1BQXVCLFFBQVE7QUFDcEMsTUFBSUcsSUFBRztBQUNQLFlBQVUsU0FBUyxJQUFJLEtBQUssRUFBRSxZQUFZO0FBQzFDLFVBQVFBLEtBQUksTUFBTSxLQUFLLE1BQU0sTUFBTSxJQUFJQSxHQUFFLENBQUMsRUFBRSxRQUFRQSxLQUFJLFNBQVNBLEdBQUUsQ0FBQyxHQUFHLEVBQUUsR0FBRyxNQUFNLElBQUksS0FBS0EsRUFBQyxJQUN0RixNQUFNLElBQUksSUFBSSxJQUFLQSxNQUFLLElBQUksS0FBUUEsTUFBSyxJQUFJLEtBQVFBLE1BQUssSUFBSSxLQUFRQSxLQUFJLE1BQVNBLEtBQUksT0FBUSxJQUFNQSxLQUFJLElBQU0sQ0FBQyxJQUNoSCxNQUFNLElBQUksS0FBS0EsTUFBSyxLQUFLLEtBQU1BLE1BQUssS0FBSyxLQUFNQSxNQUFLLElBQUksTUFBT0EsS0FBSSxPQUFRLEdBQUksSUFDL0UsTUFBTSxJQUFJLEtBQU1BLE1BQUssS0FBSyxLQUFRQSxNQUFLLElBQUksS0FBUUEsTUFBSyxJQUFJLEtBQVFBLE1BQUssSUFBSSxLQUFRQSxNQUFLLElBQUksS0FBUUEsS0FBSSxPQUFVQSxLQUFJLE9BQVEsSUFBTUEsS0FBSSxNQUFRLEdBQUksSUFDdEosU0FDQ0EsS0FBSSxhQUFhLEtBQUssTUFBTSxLQUFLLElBQUksSUFBSUEsR0FBRSxDQUFDLEdBQUdBLEdBQUUsQ0FBQyxHQUFHQSxHQUFFLENBQUMsR0FBRyxDQUFDLEtBQzVEQSxLQUFJLGFBQWEsS0FBSyxNQUFNLEtBQUssSUFBSSxJQUFJQSxHQUFFLENBQUMsSUFBSSxNQUFNLEtBQUtBLEdBQUUsQ0FBQyxJQUFJLE1BQU0sS0FBS0EsR0FBRSxDQUFDLElBQUksTUFBTSxLQUFLLENBQUMsS0FDaEdBLEtBQUksY0FBYyxLQUFLLE1BQU0sS0FBSyxLQUFLQSxHQUFFLENBQUMsR0FBR0EsR0FBRSxDQUFDLEdBQUdBLEdBQUUsQ0FBQyxHQUFHQSxHQUFFLENBQUMsQ0FBQyxLQUM3REEsS0FBSSxjQUFjLEtBQUssTUFBTSxLQUFLLEtBQUtBLEdBQUUsQ0FBQyxJQUFJLE1BQU0sS0FBS0EsR0FBRSxDQUFDLElBQUksTUFBTSxLQUFLQSxHQUFFLENBQUMsSUFBSSxNQUFNLEtBQUtBLEdBQUUsQ0FBQyxDQUFDLEtBQ2pHQSxLQUFJLGFBQWEsS0FBSyxNQUFNLEtBQUssS0FBS0EsR0FBRSxDQUFD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LFVBQVUsUUFBUSxLQUFLLEVBQUUsU0FBUyxJQUFJO0FBQ3JEO0FBQUEsTUFDRjtBQUNBLFVBQUksd0JBQU8sbUJBQW1CLE1BQU0sRUFBRTtBQUN0QztBQUFBLElBQ0Y7QUFHQSxVQUFNLE1BQU0sT0FBTyxNQUFNLElBQUk7QUFDN0IsUUFBSSxLQUFLO0FBQ1AsWUFBTSxTQUFTLElBQUksTUFBTSxHQUFHLEVBQUUsQ0FBQyxFQUFFLEtBQUs7QUFDdEMsWUFBTSxRQUFRLEtBQUssWUFBWSxJQUFJLE9BQU8sWUFBWSxDQUFDO0FBQ3ZELFVBQUksT0FBTztBQUNULGNBQU0sS0FBSyxXQUFXLE1BQU0sVUFBVSxNQUFNLFNBQVM7QUFDckQ7QUFBQSxNQUNGO0FBQ0EsVUFBSSx3QkFBTyxXQUFXLE1BQU0sYUFBYTtBQUN6QztBQUFBLElBQ0Y7QUFFQSxRQUFJLHdCQUFPLHNCQUFzQjtBQUFBLEVBQ25DO0FBQ0Y7IiwKICAibmFtZXMiOiBbImltcG9ydF9vYnNpZGlhbiIsICJpZCIsICJ0eXBlIiwgImltcG9ydF9vYnNpZGlhbiIsICJtaW4iLCAibWF4IiwgInR5cGUiLCAiYyIsICJkb2N1bWVudCIsICJtIiwgIngiLCAibSIsICJtIiwgImRhdHVtIiwgIngiLCAibSIsICJzZWxlY3Rpb24iLCAibSIsICJtIiwgImEiLCAibSIsICJtIiwgIm0iLCAiY3JlYXRlIiwgImNyZWF0ZSIsICJwYXJzZVR5cGVuYW1lcyIsICJtIiwgInR5cGUiLCAid2luZG93IiwgImRpc3BhdGNoX2RlZmF1bHQiLCAibSIsICJkaXNwYXRjaF9kZWZhdWx0IiwgInNlbGVjdF9kZWZhdWx0IiwgInJvb3QiLCAic2VsZWN0aW9uIiwgInNlbGVjdF9kZWZhdWx0IiwgIm0iLCAiYSIsICJtaW4iLCAibWF4IiwgImNvbnN0YW50X2RlZmF1bHQiLCAieCIsICJhIiwgInkiLCAieSIsICJhIiwgImNvbnN0YW50X2RlZmF1bHQiLCAieSIsICJjb2xvciIsICJyZ2IiLCAic3RhcnQiLCAiYSIsICJhIiwgImkiLCAiYSIsICJjIiwgIm0iLCAiYSIsICJ4IiwgIm5vdyIsICJpZCIsICJpbmRleCIsICJnZXQiLCAic2V0IiwgInN0YXJ0IiwgImVtcHR5IiwgImludGVycnVwdF9kZWZhdWx0IiwgImlkIiwgInNldCIsICJnZXQiLCAidHJhbnNpdGlvbiIsICJhIiwgImMiLCAiYXR0clJlbW92ZSIsICJhdHRyUmVtb3ZlTlMiLCAiYXR0ckNvbnN0YW50IiwgImF0dHJDb25zdGFudE5TIiwgImF0dHJGdW5jdGlvbiIsICJhdHRyRnVuY3Rpb25OUyIsICJhdHRyX2RlZmF1bHQiLCAiaWQiLCAiZ2V0IiwgImlkIiwgInNldCIsICJnZXQiLCAiaWQiLCAic2V0IiwgImdldCIsICJpZCIsICJzZXQiLCAiZmlsdGVyX2RlZmF1bHQiLCAibSIsICJtZXJnZV9kZWZhdWx0IiwgInRyYW5zaXRpb24iLCAibSIsICJpZCIsICJzZXQiLCAib25fZGVmYXVsdCIsICJnZXQiLCAiaWQiLCAicmVtb3ZlX2RlZmF1bHQiLCAic2VsZWN0X2RlZmF1bHQiLCAiaWQiLCAibSIsICJnZXQiLCAic2VsZWN0QWxsX2RlZmF1bHQiLCAiaWQiLCAibSIsICJjaGlsZHJlbiIsICJpbmhlcml0IiwgImdldCIsICJTZWxlY3Rpb24iLCAic2VsZWN0aW9uX2RlZmF1bHQiLCAic3R5bGVSZW1vdmUiLCAic3R5bGVDb25zdGFudCIsICJzdHlsZUZ1bmN0aW9uIiwgImlkIiwgInJlbW92ZSIsICJzZXQiLCAic3R5bGVfZGVmYXVsdCIsICJ0ZXh0Q29uc3RhbnQiLCAidGV4dEZ1bmN0aW9uIiwgInRleHRfZGVmYXVsdCIsICJtIiwgImluaGVyaXQiLCAiZ2V0IiwgImlkIiwgInNldCIsICJpZCIsICJzZWxlY3RfZGVmYXVsdCIsICJzZWxlY3RBbGxfZGVmYXVsdCIsICJmaWx0ZXJfZGVmYXVsdCIsICJtZXJnZV9kZWZhdWx0IiwgInNlbGVjdGlvbl9kZWZhdWx0IiwgIm9uX2RlZmF1bHQiLCAiYXR0cl9kZWZhdWx0IiwgInN0eWxlX2RlZmF1bHQiLCAidGV4dF9kZWZhdWx0IiwgInJlbW92ZV9kZWZhdWx0IiwgImlkIiwgInRyYW5zaXRpb25fZGVmYXVsdCIsICJtIiwgImludGVycnVwdF9kZWZhdWx0IiwgInRyYW5zaXRpb25fZGVmYXVsdCIsICJ4IiwgInkiLCAieCIsICJ5IiwgIngiLCAieSIsICJkYXRhX2RlZmF1bHQiLCAieCIsICJ5IiwgIngyIiwgInkyIiwgIngzIiwgInkzIiwgInJlbW92ZV9kZWZhdWx0IiwgIngiLCAieSIsICJzaXplX2RlZmF1bHQiLCAieCIsICJ5IiwgImRhdGFfZGVmYXVsdCIsICJyZW1vdmVfZGVmYXVsdCIsICJzaXplX2RlZmF1bHQiLCAiY29uc3RhbnRfZGVmYXVsdCIsICJ4IiwgImNvbnN0YW50X2RlZmF1bHQiLCAieCIsICJ5IiwgImZpbmQiLCAiaWQiLCAiY29uc3RhbnRfZGVmYXVsdCIsICJ4IiwgInkiLCAibSIsICJpIiwgIngiLCAieSIsICJjb25zdGFudF9kZWZhdWx0IiwgIngiLCAieSIsICJub2RlIiwgInN0cmVuZ3RoIiwgImMiLCAieDIiLCAieF9kZWZhdWx0IiwgIngiLCAiY29uc3RhbnRfZGVmYXVsdCIsICJ5X2RlZmF1bHQiLCAieSIsICJjb25zdGFudF9kZWZhdWx0IiwgImNvbnN0YW50X2RlZmF1bHQiLCAieCIsICJ0eXBlIiwgInRyYW5zZm9ybSIsICJkaXNwYXRjaCIsICJ4IiwgInkiLCAiaWRlbnRpdHkiLCAibm9wcm9wYWdhdGlvbiIsICJub2V2ZW50X2RlZmF1bHQiLCAiaWRlbnRpdHkiLCAidHJhbnNmb3JtIiwgInpvb21fZGVmYXVsdCIsICJmaWx0ZXIiLCAic2VsZWN0aW9uIiwgIngiLCAieSIsICJleHRlbnQiLCAidHJhbnNpdGlvbiIsICJhIiwgInR5cGUiLCAic2VsZWN0X2RlZmF1bHQiLCAibm9ldmVudF9kZWZhdWx0IiwgIm5vcHJvcGFnYXRpb24iLCAiZXZlbnQiLCAiY29uc3RhbnRfZGVmYXVsdCIsICJoZXgiLCAibSIsICJjIiwgImEiLCAiaWRlbnRpdHkiLCAiZnJhbWUiLCAieF9kZWZhdWx0IiwgInlfZGVmYXVsdCIsICJ4IiwgInkiLCAiem9vbV9kZWZhdWx0IiwgInNlbGVjdF9kZWZhdWx0IiwgIm5vdyIsICJpbXBvcnRfb2JzaWRpYW4iLCAiYSIsICJpbXBvcnRfb2JzaWRpYW4iLCAic3RhcnQiLCAic3RhcnQiXQp9Cg==
