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
var import_obsidian6 = require("obsidian");

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
    /** Callback to add a new object row — set by the plugin */
    this.onAddRow = null;
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
    const addRowBtn = toolbar.createEl("button", {
      cls: "ol-table-add-row clickable-icon",
      attr: { "aria-label": "Add object" }
    });
    (0, import_obsidian3.setIcon)(addRowBtn, "plus");
    addRowBtn.addEventListener("click", () => {
      if (this.onAddRow)
        this.onAddRow();
    });
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
    /** Callback invoked when user selects "Create new..." */
    this.onCreateNew = null;
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
    const query = context.query.toLowerCase().trim();
    if (!query)
      return this.objects.slice(0, 20);
    const matches = this.objects.filter(
      (o) => o.displayKey.toLowerCase().includes(query) || o.keyValue.toLowerCase().includes(query)
    ).slice(0, 20);
    const hasExact = matches.some(
      (o) => o.displayKey.toLowerCase() === query || o.keyValue.toLowerCase() === query
    );
    if (!hasExact && query.length > 0) {
      matches.push({
        displayKey: context.query.trim(),
        keyValue: context.query.trim(),
        fileLabel: "Create new\u2026",
        filePath: "",
        properties: {},
        isCreateAction: true
      });
    }
    return matches;
  }
  renderSuggestion(suggestion, el) {
    const container = el.createDiv({ cls: "ol-suggestion" });
    if (suggestion.isCreateAction) {
      container.addClass("ol-suggestion-create");
      const titleEl2 = container.createDiv({ cls: "ol-suggestion-title" });
      titleEl2.textContent = `Create "${suggestion.displayKey}"`;
      const fileEl2 = container.createDiv({ cls: "ol-suggestion-file" });
      fileEl2.textContent = "New object\u2026";
      return;
    }
    const titleEl = container.createDiv({ cls: "ol-suggestion-title" });
    titleEl.textContent = suggestion.displayKey;
    const fileEl = container.createDiv({ cls: "ol-suggestion-file" });
    fileEl.textContent = suggestion.fileLabel;
  }
  selectSuggestion(suggestion, _evt) {
    if (!this.context)
      return;
    if (suggestion.isCreateAction) {
      const query = suggestion.displayKey;
      this.close();
      if (this.onCreateNew)
        this.onCreateNew(query);
      return;
    }
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

// src/create-modal.ts
var import_obsidian5 = require("obsidian");
function getObjectTypes(parsedFiles) {
  return parsedFiles.map((pf) => {
    const propSet = /* @__PURE__ */ new Set();
    let maxId = 0;
    for (const obj of pf.objects) {
      for (const prop of obj.propertyOrder) {
        propSet.add(prop);
      }
      if (obj.id > maxId)
        maxId = obj.id;
    }
    const props = [];
    propSet.delete(pf.keyProperty);
    propSet.delete("id");
    props.push(pf.keyProperty, "id", ...propSet);
    const fileLabel = pf.objects[0]?.fileLabel ?? pf.filePath.replace(/^.*\//, "").replace(/\.md$/i, "");
    return {
      filePath: pf.filePath,
      fileLabel,
      keyProperty: pf.keyProperty,
      properties: props,
      nextId: maxId + 1
    };
  });
}
var CreateObjectModal = class extends import_obsidian5.Modal {
  constructor(app, types, options) {
    super(app);
    this.fieldValues = /* @__PURE__ */ new Map();
    this.types = types;
    this.selectedType = options?.selectedType ?? null;
    this.prefillKey = options?.prefillKey ?? "";
    this.onCreated = options?.onCreated ?? (() => {
    });
  }
  onOpen() {
    this.modalEl.addClass("ol-create-modal");
    this.titleEl.textContent = "Create Object";
    if (this.selectedType) {
      this.renderForm(this.selectedType);
    } else {
      this.renderTypePicker();
    }
  }
  onClose() {
    this.contentEl.empty();
  }
  /* ── Type Picker ────────────────────────────────────────────────── */
  renderTypePicker() {
    this.contentEl.empty();
    if (this.types.length === 0) {
      this.contentEl.createDiv({
        text: "No object-links files found. Create a file with the object-links tag first.",
        cls: "ol-create-empty"
      });
      return;
    }
    new import_obsidian5.Setting(this.contentEl).setName("Object type").setDesc("Choose which file to add the object to").addDropdown((dd) => {
      for (const t of this.types) {
        dd.addOption(t.filePath, t.fileLabel);
      }
      dd.onChange((val) => {
        this.selectedType = this.types.find((t) => t.filePath === val) ?? null;
      });
      this.selectedType = this.types[0];
    });
    new import_obsidian5.Setting(this.contentEl).addButton(
      (btn) => btn.setButtonText("Next").setCta().onClick(() => {
        if (this.selectedType)
          this.renderForm(this.selectedType);
      })
    );
  }
  /* ── Object Form ────────────────────────────────────────────────── */
  renderForm(type2) {
    this.contentEl.empty();
    this.fieldValues.clear();
    this.titleEl.textContent = `New ${type2.fileLabel}`;
    const form = this.contentEl.createDiv({ cls: "ol-create-form" });
    for (const prop of type2.properties) {
      const isKey = prop === type2.keyProperty;
      const isId = prop === "id";
      const setting = new import_obsidian5.Setting(form).setName(prop);
      if (isId) {
        setting.setDesc(`Auto: ${type2.nextId}`);
        this.fieldValues.set("id", String(type2.nextId));
        setting.addText(
          (text) => text.setValue(String(type2.nextId)).setDisabled(true)
        );
      } else {
        setting.addText((text) => {
          if (isKey && this.prefillKey) {
            text.setValue(this.prefillKey);
            this.fieldValues.set(prop, this.prefillKey);
          }
          text.setPlaceholder(prop).onChange((val) => {
            this.fieldValues.set(prop, val);
          });
          if (isKey) {
            setTimeout(() => text.inputEl.focus(), 50);
          }
        });
      }
    }
    new import_obsidian5.Setting(form).addButton(
      (btn) => btn.setButtonText("Create").setCta().onClick(() => {
        this.handleCreate(type2);
      })
    );
    form.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.handleCreate(type2);
      }
    });
  }
  /* ── Create Logic ───────────────────────────────────────────────── */
  async handleCreate(type2) {
    const keyVal = this.fieldValues.get(type2.keyProperty)?.trim();
    if (!keyVal) {
      new import_obsidian5.Notice(`"${type2.keyProperty}" is required.`);
      return;
    }
    const lines = [];
    for (const prop of type2.properties) {
      const val = this.fieldValues.get(prop)?.trim() ?? "";
      if (val) {
        lines.push(`${prop}: ${val}`);
      }
    }
    if (!lines.some((l) => l.startsWith(`${type2.keyProperty}:`))) {
      lines.unshift(`${type2.keyProperty}: ${keyVal}`);
    }
    if (!lines.some((l) => l.startsWith("id:"))) {
      lines.splice(1, 0, `id: ${type2.nextId}`);
    }
    const block = "\n---\n\n" + lines.join("\n");
    const file = this.app.vault.getAbstractFileByPath(type2.filePath);
    if (!(file instanceof import_obsidian5.TFile)) {
      new import_obsidian5.Notice(`File not found: ${type2.filePath}`);
      return;
    }
    try {
      const content = await this.app.vault.read(file);
      const sep = content.endsWith("\n") ? "" : "\n";
      await this.app.vault.modify(file, content + sep + block + "\n");
      new import_obsidian5.Notice(`Created "${keyVal}" in ${type2.fileLabel}`);
      this.close();
      this.onCreated(type2.filePath);
    } catch (err) {
      new import_obsidian5.Notice(`Failed to create object: ${err}`);
    }
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
var ObjectLinksPlugin = class extends import_obsidian6.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.graphData = null;
    this.suggestProvider = null;
    this.allObjects = [];
    /** Map: lowercase key value -> ParsedObject (for quick lookups) */
    this.objectIndex = /* @__PURE__ */ new Map();
    /** Cached parsed files from last scan (for object type enumeration) */
    this.parsedFiles = [];
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
    this.registerView(TABLE_VIEW_TYPE, (leaf) => {
      const view = new ObjectTableView(leaf);
      view.onAddRow = () => {
        if (!view.file)
          return;
        const types = getObjectTypes(this.parsedFiles);
        const selectedType = types.find((t) => t.filePath === view.file.path);
        new CreateObjectModal(this.app, types, {
          selectedType,
          onCreated: async () => {
            await this.fullRefresh();
          }
        }).open();
      };
      return view;
    });
    this.suggestProvider = new ObjectLinkSuggest(this.app);
    this.suggestProvider.onCreateNew = (query) => this.openCreateModal(query);
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
      id: "create-object",
      name: "Create new object",
      callback: () => this.openCreateModal()
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
        if (!file || !(file instanceof import_obsidian6.TFile) || file.extension !== "md")
          return;
        if (!this.settings.openObjectFilesInTableView)
          return;
        const leaf = this.app.workspace.getActiveViewOfType(import_obsidian6.TextFileView)?.leaf ?? this.app.workspace.activeLeaf;
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
        if (file instanceof import_obsidian6.TFile && file.extension === "md") {
          this.debounceRefresh();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof import_obsidian6.TFile && file.extension === "md") {
          this.debounceRefresh();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof import_obsidian6.TFile && file.extension === "md") {
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
      (0, import_obsidian6.setIcon)(btn, "table");
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
    this.parsedFiles = parsedFiles;
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
      new import_obsidian6.Notice(
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
            new import_obsidian6.Notice(`Object "${target}" not found`);
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
  // ── Object creation ──────────────────────────────────────────────
  /**
   * Open the object-creation modal.
   * @param prefillKey  Optional key to pre-fill (e.g. from suggest provider).
   */
  openCreateModal(prefillKey) {
    const types = getObjectTypes(this.parsedFiles);
    if (types.length === 0) {
      new import_obsidian6.Notice("No object-links files found. Create one first.");
      return;
    }
    const activeFile = this.app.workspace.getActiveFile();
    let selectedType;
    if (activeFile) {
      selectedType = types.find((t) => t.filePath === activeFile.path);
    }
    new CreateObjectModal(this.app, types, {
      selectedType,
      prefillKey: prefillKey ?? void 0,
      onCreated: async (filePath) => {
        await this.fullRefresh();
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof import_obsidian6.TFile) {
          const content = await this.app.vault.read(file);
          const lastSepIdx = content.lastIndexOf("\n---\n");
          const targetLine = lastSepIdx >= 0 ? content.substring(0, lastSepIdx).split("\n").length + 1 : content.split("\n").length - 1;
          await this.goToObject(filePath, targetLine);
        }
      }
    }).open();
  }
  // ── Navigation helpers ─────────────────────────────────────────────
  async goToObject(filePath, startLine) {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof import_obsidian6.TFile)) {
      new import_obsidian6.Notice(`File not found: ${filePath}`);
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
    if (!(file instanceof import_obsidian6.TFile)) {
      new import_obsidian6.Notice(`File not found: ${filePath}`);
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
    const view = this.app.workspace.getActiveViewOfType(import_obsidian6.MarkdownView);
    const editor = view?.editor;
    if (!editor) {
      new import_obsidian6.Notice("Object Links: No active editor");
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
      new import_obsidian6.Notice(`File not found: ${target}`);
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
      new import_obsidian6.Notice(`Object "${target}" not found`);
      return;
    }
    new import_obsidian6.Notice("No link under cursor");
  }
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL3BhcnNlci50cyIsICJzcmMvZ3JhcGgtZGF0YS50cyIsICJzcmMvZ3JhcGgtdmlldy50cyIsICJzcmMvc2V0dGluZ3MudHMiLCAibm9kZV9tb2R1bGVzL2QzLWRpc3BhdGNoL3NyYy9kaXNwYXRjaC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9uYW1lc3BhY2VzLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL25hbWVzcGFjZS5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9jcmVhdG9yLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdG9yLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9zZWxlY3QuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvYXJyYXkuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0b3JBbGwuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL3NlbGVjdEFsbC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9tYXRjaGVyLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9zZWxlY3RDaGlsZC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vc2VsZWN0Q2hpbGRyZW4uanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2ZpbHRlci5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vc3BhcnNlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9lbnRlci5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9jb25zdGFudC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vZGF0YS5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vZXhpdC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vam9pbi5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vbWVyZ2UuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL29yZGVyLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9zb3J0LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9jYWxsLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9ub2Rlcy5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vbm9kZS5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vc2l6ZS5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vZW1wdHkuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2VhY2guanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2F0dHIuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvd2luZG93LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9zdHlsZS5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vcHJvcGVydHkuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2NsYXNzZWQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL3RleHQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2h0bWwuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL3JhaXNlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9sb3dlci5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vYXBwZW5kLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9pbnNlcnQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL3JlbW92ZS5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vY2xvbmUuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2RhdHVtLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9vbi5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3Rpb24vZGlzcGF0Y2guanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc2VsZWN0aW9uL2l0ZXJhdG9yLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1zZWxlY3Rpb24vc3JjL3NlbGVjdGlvbi9pbmRleC5qcyIsICJub2RlX21vZHVsZXMvZDMtc2VsZWN0aW9uL3NyYy9zZWxlY3QuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvc291cmNlRXZlbnQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXNlbGVjdGlvbi9zcmMvcG9pbnRlci5qcyIsICJub2RlX21vZHVsZXMvZDMtZHJhZy9zcmMvbm9ldmVudC5qcyIsICJub2RlX21vZHVsZXMvZDMtZHJhZy9zcmMvbm9kcmFnLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1jb2xvci9zcmMvZGVmaW5lLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1jb2xvci9zcmMvY29sb3IuanMiLCAibm9kZV9tb2R1bGVzL2QzLWludGVycG9sYXRlL3NyYy9iYXNpcy5qcyIsICJub2RlX21vZHVsZXMvZDMtaW50ZXJwb2xhdGUvc3JjL2Jhc2lzQ2xvc2VkLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1pbnRlcnBvbGF0ZS9zcmMvY29uc3RhbnQuanMiLCAibm9kZV9tb2R1bGVzL2QzLWludGVycG9sYXRlL3NyYy9jb2xvci5qcyIsICJub2RlX21vZHVsZXMvZDMtaW50ZXJwb2xhdGUvc3JjL3JnYi5qcyIsICJub2RlX21vZHVsZXMvZDMtaW50ZXJwb2xhdGUvc3JjL251bWJlci5qcyIsICJub2RlX21vZHVsZXMvZDMtaW50ZXJwb2xhdGUvc3JjL3N0cmluZy5qcyIsICJub2RlX21vZHVsZXMvZDMtaW50ZXJwb2xhdGUvc3JjL3RyYW5zZm9ybS9kZWNvbXBvc2UuanMiLCAibm9kZV9tb2R1bGVzL2QzLWludGVycG9sYXRlL3NyYy90cmFuc2Zvcm0vcGFyc2UuanMiLCAibm9kZV9tb2R1bGVzL2QzLWludGVycG9sYXRlL3NyYy90cmFuc2Zvcm0vaW5kZXguanMiLCAibm9kZV9tb2R1bGVzL2QzLWludGVycG9sYXRlL3NyYy96b29tLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10aW1lci9zcmMvdGltZXIuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRpbWVyL3NyYy90aW1lb3V0LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy90cmFuc2l0aW9uL3NjaGVkdWxlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy9pbnRlcnJ1cHQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3NlbGVjdGlvbi9pbnRlcnJ1cHQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vdHdlZW4uanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vaW50ZXJwb2xhdGUuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vYXR0ci5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvdHJhbnNpdGlvbi9hdHRyVHdlZW4uanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vZGVsYXkuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vZHVyYXRpb24uanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vZWFzZS5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvdHJhbnNpdGlvbi9lYXNlVmFyeWluZy5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvdHJhbnNpdGlvbi9maWx0ZXIuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vbWVyZ2UuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vb24uanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vcmVtb3ZlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy90cmFuc2l0aW9uL3NlbGVjdC5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvdHJhbnNpdGlvbi9zZWxlY3RBbGwuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vc2VsZWN0aW9uLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy90cmFuc2l0aW9uL3N0eWxlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy90cmFuc2l0aW9uL3N0eWxlVHdlZW4uanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vdGV4dC5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvdHJhbnNpdGlvbi90ZXh0VHdlZW4uanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vdHJhbnNpdGlvbi5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvdHJhbnNpdGlvbi9lbmQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXRyYW5zaXRpb24vc3JjL3RyYW5zaXRpb24vaW5kZXguanMiLCAibm9kZV9tb2R1bGVzL2QzLWVhc2Uvc3JjL2N1YmljLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy10cmFuc2l0aW9uL3NyYy9zZWxlY3Rpb24vdHJhbnNpdGlvbi5qcyIsICJub2RlX21vZHVsZXMvZDMtdHJhbnNpdGlvbi9zcmMvc2VsZWN0aW9uL2luZGV4LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1icnVzaC9zcmMvYnJ1c2guanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9hZGQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9jb3Zlci5qcyIsICJub2RlX21vZHVsZXMvZDMtcXVhZHRyZWUvc3JjL2RhdGEuanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9leHRlbnQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9xdWFkLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1xdWFkdHJlZS9zcmMvZmluZC5qcyIsICJub2RlX21vZHVsZXMvZDMtcXVhZHRyZWUvc3JjL3JlbW92ZS5qcyIsICJub2RlX21vZHVsZXMvZDMtcXVhZHRyZWUvc3JjL3Jvb3QuanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9zaXplLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1xdWFkdHJlZS9zcmMvdmlzaXQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy92aXNpdEFmdGVyLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1xdWFkdHJlZS9zcmMveC5qcyIsICJub2RlX21vZHVsZXMvZDMtcXVhZHRyZWUvc3JjL3kuanMiLCAibm9kZV9tb2R1bGVzL2QzLXF1YWR0cmVlL3NyYy9xdWFkdHJlZS5qcyIsICJub2RlX21vZHVsZXMvZDMtZm9yY2Uvc3JjL2NvbnN0YW50LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1mb3JjZS9zcmMvamlnZ2xlLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1mb3JjZS9zcmMvY29sbGlkZS5qcyIsICJub2RlX21vZHVsZXMvZDMtZm9yY2Uvc3JjL2xpbmsuanMiLCAibm9kZV9tb2R1bGVzL2QzLWZvcmNlL3NyYy9sY2cuanMiLCAibm9kZV9tb2R1bGVzL2QzLWZvcmNlL3NyYy9zaW11bGF0aW9uLmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1mb3JjZS9zcmMvbWFueUJvZHkuanMiLCAibm9kZV9tb2R1bGVzL2QzLWZvcmNlL3NyYy94LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy1mb3JjZS9zcmMveS5qcyIsICJub2RlX21vZHVsZXMvZDMtem9vbS9zcmMvY29uc3RhbnQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXpvb20vc3JjL2V2ZW50LmpzIiwgIm5vZGVfbW9kdWxlcy9kMy16b29tL3NyYy90cmFuc2Zvcm0uanMiLCAibm9kZV9tb2R1bGVzL2QzLXpvb20vc3JjL25vZXZlbnQuanMiLCAibm9kZV9tb2R1bGVzL2QzLXpvb20vc3JjL3pvb20uanMiLCAic3JjL3RhYmxlLXZpZXcudHMiLCAic3JjL3N1Z2dlc3QudHMiLCAic3JjL2NyZWF0ZS1tb2RhbC50cyIsICJzcmMvZWRpdG9yLWV4dGVuc2lvbi50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHtcbiAgTWFya2Rvd25Qb3N0UHJvY2Vzc29yQ29udGV4dCxcbiAgTWFya2Rvd25WaWV3LFxuICBOb3RpY2UsXG4gIFBsdWdpbixcbiAgVGV4dEZpbGVWaWV3LFxuICBURmlsZSxcbiAgV29ya3NwYWNlTGVhZixcbiAgc2V0SWNvbixcbn0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQge1xuICBwYXJzZU11bHRpT2JqZWN0RmlsZSxcbiAgUGFyc2VkRmlsZSxcbiAgUGFyc2VkT2JqZWN0LFxuICBnZXRTZWNvbmRQcm9wZXJ0eSxcbn0gZnJvbSBcIi4vcGFyc2VyXCI7XG5pbXBvcnQgeyBidWlsZEdyYXBoLCBHcmFwaERhdGEsIFZhdWx0RmlsZSB9IGZyb20gXCIuL2dyYXBoLWRhdGFcIjtcbmltcG9ydCB7IEdyYXBoVmlldywgVklFV19UWVBFIH0gZnJvbSBcIi4vZ3JhcGgtdmlld1wiO1xuaW1wb3J0IHsgT2JqZWN0VGFibGVWaWV3LCBUQUJMRV9WSUVXX1RZUEUgfSBmcm9tIFwiLi90YWJsZS12aWV3XCI7XG5pbXBvcnQgeyBPYmplY3RMaW5rU3VnZ2VzdCB9IGZyb20gXCIuL3N1Z2dlc3RcIjtcbmltcG9ydCB7IENyZWF0ZU9iamVjdE1vZGFsLCBnZXRPYmplY3RUeXBlcyB9IGZyb20gXCIuL2NyZWF0ZS1tb2RhbFwiO1xuaW1wb3J0IHsgb2JqZWN0TGlua0hpZ2hsaWdodGVyLCBvYmplY3RMaW5rV3JhcHBlcktleW1hcCB9IGZyb20gXCIuL2VkaXRvci1leHRlbnNpb25cIjtcbmltcG9ydCB7XG4gIE9iamVjdExpbmtzU2V0dGluZ3MsXG4gIERFRkFVTFRfU0VUVElOR1MsXG4gIE9iamVjdExpbmtzU2V0dGluZ1RhYixcbn0gZnJvbSBcIi4vc2V0dGluZ3NcIjtcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgT2JqZWN0TGlua3NQbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xuICBzZXR0aW5nczogT2JqZWN0TGlua3NTZXR0aW5ncyA9IERFRkFVTFRfU0VUVElOR1M7XG4gIHByaXZhdGUgZ3JhcGhEYXRhOiBHcmFwaERhdGEgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzdWdnZXN0UHJvdmlkZXI6IE9iamVjdExpbmtTdWdnZXN0IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgYWxsT2JqZWN0czogUGFyc2VkT2JqZWN0W10gPSBbXTtcbiAgLyoqIE1hcDogbG93ZXJjYXNlIGtleSB2YWx1ZSAtPiBQYXJzZWRPYmplY3QgKGZvciBxdWljayBsb29rdXBzKSAqL1xuICBwcml2YXRlIG9iamVjdEluZGV4OiBNYXA8c3RyaW5nLCBQYXJzZWRPYmplY3Q+ID0gbmV3IE1hcCgpO1xuICAvKiogQ2FjaGVkIHBhcnNlZCBmaWxlcyBmcm9tIGxhc3Qgc2NhbiAoZm9yIG9iamVjdCB0eXBlIGVudW1lcmF0aW9uKSAqL1xuICBwYXJzZWRGaWxlczogUGFyc2VkRmlsZVtdID0gW107XG5cbiAgYXN5bmMgb25sb2FkKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIFx1MjUwMFx1MjUwMCBMb2FkIHNldHRpbmdzIFx1MjUwMFx1MjUwMFxuICAgIGF3YWl0IHRoaXMubG9hZFNldHRpbmdzKCk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgU2V0dGluZ3MgdGFiIFx1MjUwMFx1MjUwMFxuICAgIHRoaXMuYWRkU2V0dGluZ1RhYihuZXcgT2JqZWN0TGlua3NTZXR0aW5nVGFiKHRoaXMuYXBwLCB0aGlzKSk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgUmVnaXN0ZXIgdmlldyBcdTI1MDBcdTI1MDBcbiAgICB0aGlzLnJlZ2lzdGVyVmlldyhWSUVXX1RZUEUsIChsZWFmKSA9PiB7XG4gICAgICBjb25zdCB2aWV3ID0gbmV3IEdyYXBoVmlldyhsZWFmKTtcbiAgICAgIHZpZXcubmF2aWdhdGVUb09iamVjdCA9IChmaWxlUGF0aCwgc3RhcnRMaW5lKSA9PlxuICAgICAgICB0aGlzLmdvVG9PYmplY3QoZmlsZVBhdGgsIHN0YXJ0TGluZSk7XG4gICAgICB2aWV3Lm5hdmlnYXRlVG9GaWxlID0gKGZpbGVQYXRoKSA9PiB0aGlzLmdvVG9GaWxlKGZpbGVQYXRoKTtcbiAgICAgIHJldHVybiB2aWV3O1xuICAgIH0pO1xuXG4gICAgLy8gXHUyNTAwXHUyNTAwIFJlZ2lzdGVyIHRhYmxlIHZpZXcgXHUyNTAwXHUyNTAwXG4gICAgdGhpcy5yZWdpc3RlclZpZXcoVEFCTEVfVklFV19UWVBFLCAobGVhZikgPT4ge1xuICAgICAgY29uc3QgdmlldyA9IG5ldyBPYmplY3RUYWJsZVZpZXcobGVhZik7XG4gICAgICB2aWV3Lm9uQWRkUm93ID0gKCkgPT4ge1xuICAgICAgICBpZiAoIXZpZXcuZmlsZSkgcmV0dXJuO1xuICAgICAgICBjb25zdCB0eXBlcyA9IGdldE9iamVjdFR5cGVzKHRoaXMucGFyc2VkRmlsZXMpO1xuICAgICAgICBjb25zdCBzZWxlY3RlZFR5cGUgPSB0eXBlcy5maW5kKCh0KSA9PiB0LmZpbGVQYXRoID09PSB2aWV3LmZpbGUhLnBhdGgpO1xuICAgICAgICBuZXcgQ3JlYXRlT2JqZWN0TW9kYWwodGhpcy5hcHAsIHR5cGVzLCB7XG4gICAgICAgICAgc2VsZWN0ZWRUeXBlLFxuICAgICAgICAgIG9uQ3JlYXRlZDogYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5mdWxsUmVmcmVzaCgpO1xuICAgICAgICAgIH0sXG4gICAgICAgIH0pLm9wZW4oKTtcbiAgICAgIH07XG4gICAgICByZXR1cm4gdmlldztcbiAgICB9KTtcblxuICAgIC8vIFx1MjUwMFx1MjUwMCBSZWdpc3RlciBzdWdnZXN0IHByb3ZpZGVyIFx1MjUwMFx1MjUwMFxuICAgIHRoaXMuc3VnZ2VzdFByb3ZpZGVyID0gbmV3IE9iamVjdExpbmtTdWdnZXN0KHRoaXMuYXBwKTtcbiAgICB0aGlzLnN1Z2dlc3RQcm92aWRlci5vbkNyZWF0ZU5ldyA9IChxdWVyeSkgPT4gdGhpcy5vcGVuQ3JlYXRlTW9kYWwocXVlcnkpO1xuICAgIHRoaXMucmVnaXN0ZXJFZGl0b3JTdWdnZXN0KHRoaXMuc3VnZ2VzdFByb3ZpZGVyKTtcblxuICAgIC8vIFx1MjUwMFx1MjUwMCBSZWdpc3RlciBDTTYgZWRpdG9yIGV4dGVuc2lvbnM6IGhpZ2hsaWdodGluZyArIHNlbGVjdGlvbiB3cmFwcGVyIFx1MjUwMFx1MjUwMFxuICAgIHRoaXMucmVnaXN0ZXJFZGl0b3JFeHRlbnNpb24oW29iamVjdExpbmtIaWdobGlnaHRlciwgb2JqZWN0TGlua1dyYXBwZXJLZXltYXBdKTtcblxuICAgIC8vIFx1MjUwMFx1MjUwMCBNYXJrZG93biBwb3N0LXByb2Nlc3NvcjogcmVuZGVyIHt7b2JqZWN0fX0gYXMgY2xpY2thYmxlIGxpbmtzIFx1MjUwMFx1MjUwMFxuICAgIHRoaXMucmVnaXN0ZXJNYXJrZG93blBvc3RQcm9jZXNzb3IoXG4gICAgICAoZWw6IEhUTUxFbGVtZW50LCBjdHg6IE1hcmtkb3duUG9zdFByb2Nlc3NvckNvbnRleHQpID0+IHtcbiAgICAgICAgdGhpcy5wcm9jZXNzT2JqZWN0TGlua3MoZWwpO1xuICAgICAgfVxuICAgICk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgUmliYm9uIGljb24gXHUyNTAwXHUyNTAwXG4gICAgdGhpcy5hZGRSaWJib25JY29uKFwiZ2l0LWZvcmtcIiwgXCJPcGVuIE9iamVjdCBMaW5rc1wiLCAoKSA9PiB7XG4gICAgICB0aGlzLmFjdGl2YXRlVmlldygpO1xuICAgIH0pO1xuXG4gICAgLy8gXHUyNTAwXHUyNTAwIENvbW1hbmRzIFx1MjUwMFx1MjUwMFxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJvcGVuLW9sLWdyYXBoXCIsXG4gICAgICBuYW1lOiBcIk9wZW4gZ3JhcGggdmlld1wiLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHRoaXMuYWN0aXZhdGVWaWV3KCksXG4gICAgfSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwicmVmcmVzaC1vbC1ncmFwaFwiLFxuICAgICAgbmFtZTogXCJSZWZyZXNoIGdyYXBoXCIsXG4gICAgICBjYWxsYmFjazogKCkgPT4gdGhpcy5mdWxsUmVmcmVzaCgpLFxuICAgIH0pO1xuXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcIm9wZW4tdW5kZXItY3Vyc29yXCIsXG4gICAgICBuYW1lOiBcIk9wZW4gbGluayB1bmRlciBjdXJzb3JcIixcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB0aGlzLm9wZW5VbmRlckN1cnNvcigpLFxuICAgICAgaG90a2V5czogW3sgbW9kaWZpZXJzOiBbXCJNb2RcIl0sIGtleTogXCJFbnRlclwiIH1dLFxuICAgIH0pO1xuXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcImNyZWF0ZS1vYmplY3RcIixcbiAgICAgIG5hbWU6IFwiQ3JlYXRlIG5ldyBvYmplY3RcIixcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB0aGlzLm9wZW5DcmVhdGVNb2RhbCgpLFxuICAgIH0pO1xuXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcIm9wZW4tYXMtdGFibGVcIixcbiAgICAgIG5hbWU6IFwiT3BlbiBjdXJyZW50IGZpbGUgYXMgdGFibGVcIixcbiAgICAgIGNoZWNrQ2FsbGJhY2s6IChjaGVja2luZykgPT4ge1xuICAgICAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcbiAgICAgICAgaWYgKCFmaWxlIHx8IGZpbGUuZXh0ZW5zaW9uICE9PSBcIm1kXCIpIHJldHVybiBmYWxzZTtcbiAgICAgICAgY29uc3QgbGVhZiA9IHRoaXMuYXBwLndvcmtzcGFjZS5hY3RpdmVMZWFmO1xuICAgICAgICBpZiAoIWxlYWYpIHJldHVybiBmYWxzZTtcbiAgICAgICAgaWYgKGxlYWYudmlldy5nZXRWaWV3VHlwZSgpID09PSBUQUJMRV9WSUVXX1RZUEUpIHJldHVybiBmYWxzZTtcbiAgICAgICAgaWYgKGNoZWNraW5nKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgbGVhZi5zZXRWaWV3U3RhdGUoe1xuICAgICAgICAgIHR5cGU6IFRBQkxFX1ZJRVdfVFlQRSxcbiAgICAgICAgICBzdGF0ZTogeyBmaWxlOiBmaWxlLnBhdGggfSxcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJvcGVuLWFzLW1hcmtkb3duXCIsXG4gICAgICBuYW1lOiBcIlN3aXRjaCBiYWNrIHRvIGVkaXRvclwiLFxuICAgICAgY2hlY2tDYWxsYmFjazogKGNoZWNraW5nKSA9PiB7XG4gICAgICAgIGNvbnN0IGxlYWYgPSB0aGlzLmFwcC53b3Jrc3BhY2UuYWN0aXZlTGVhZjtcbiAgICAgICAgaWYgKCFsZWFmIHx8IGxlYWYudmlldy5nZXRWaWV3VHlwZSgpICE9PSBUQUJMRV9WSUVXX1RZUEUpIHJldHVybiBmYWxzZTtcbiAgICAgICAgaWYgKGNoZWNraW5nKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XG4gICAgICAgIGlmICghZmlsZSkgcmV0dXJuIGZhbHNlO1xuICAgICAgICBsZWFmLnNldFZpZXdTdGF0ZSh7XG4gICAgICAgICAgdHlwZTogXCJtYXJrZG93blwiLFxuICAgICAgICAgIHN0YXRlOiB7IGZpbGU6IGZpbGUucGF0aCB9LFxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gXHUyNTAwXHUyNTAwIEF1dG8tb3BlbiBvYmplY3QgZmlsZXMgaW4gdGFibGUgdmlldyBcdTI1MDBcdTI1MDBcbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub24oXCJmaWxlLW9wZW5cIiwgKGZpbGUpID0+IHtcbiAgICAgICAgaWYgKCFmaWxlIHx8ICEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSB8fCBmaWxlLmV4dGVuc2lvbiAhPT0gXCJtZFwiKSByZXR1cm47XG4gICAgICAgIGlmICghdGhpcy5zZXR0aW5ncy5vcGVuT2JqZWN0RmlsZXNJblRhYmxlVmlldykgcmV0dXJuO1xuXG4gICAgICAgIGNvbnN0IGxlYWYgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShUZXh0RmlsZVZpZXcgYXMgYW55KT8ubGVhZlxuICAgICAgICAgID8/IHRoaXMuYXBwLndvcmtzcGFjZS5hY3RpdmVMZWFmO1xuICAgICAgICBpZiAoIWxlYWYpIHJldHVybjtcblxuICAgICAgICAvLyBEb24ndCBzd2l0Y2ggaWYgYWxyZWFkeSBpbiB0YWJsZSB2aWV3XG4gICAgICAgIGlmIChsZWFmLnZpZXcuZ2V0Vmlld1R5cGUoKSA9PT0gVEFCTEVfVklFV19UWVBFKSByZXR1cm47XG5cbiAgICAgICAgLy8gQ2hlY2sgaWYgdGhpcyBpcyBhbiBvYmplY3QtbGlua3MgZmlsZSAoYXN5bmMpXG4gICAgICAgIHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSkudGhlbigoY29udGVudCkgPT4ge1xuICAgICAgICAgIGNvbnN0IHRhZyA9IHRoaXMuc2V0dGluZ3Mub2JqZWN0RmlsZVRhZy50cmltKCk7XG4gICAgICAgICAgaWYgKHRhZyAmJiAhdGhpcy5oYXNGaWxlVGFnKGNvbnRlbnQsIHRhZykpIHJldHVybjtcbiAgICAgICAgICBpZiAoIXBhcnNlTXVsdGlPYmplY3RGaWxlKGNvbnRlbnQsIGZpbGUucGF0aCkpIHJldHVybjtcblxuICAgICAgICAgIGxlYWYuc2V0Vmlld1N0YXRlKHtcbiAgICAgICAgICAgIHR5cGU6IFRBQkxFX1ZJRVdfVFlQRSxcbiAgICAgICAgICAgIHN0YXRlOiB7IGZpbGU6IGZpbGUucGF0aCB9LFxuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIFx1MjUwMFx1MjUwMCBJbmplY3QgdGFibGUtdmlldyBidXR0b24gaW50byBtYXJrZG93biBsZWF2ZXMgZm9yIG9iamVjdC1saW5rcyBmaWxlcyBcdTI1MDBcdTI1MDBcbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsICgpID0+IHtcbiAgICAgICAgdGhpcy5pbmplY3RUYWJsZVZpZXdCdXR0b25zKCk7XG4gICAgICB9KVxuICAgICk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgSW5pdGlhbCBzY2FuIG9uIGxheW91dCByZWFkeSBcdTI1MDBcdTI1MDBcbiAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiB7XG4gICAgICB0aGlzLmZ1bGxSZWZyZXNoKCk7XG4gICAgfSk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgRmlsZSB3YXRjaGVycyBcdTI1MDBcdTI1MDBcbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICB0aGlzLmFwcC52YXVsdC5vbihcIm1vZGlmeVwiLCAoZmlsZSkgPT4ge1xuICAgICAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGaWxlICYmIGZpbGUuZXh0ZW5zaW9uID09PSBcIm1kXCIpIHtcbiAgICAgICAgICB0aGlzLmRlYm91bmNlUmVmcmVzaCgpO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICk7XG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAudmF1bHQub24oXCJjcmVhdGVcIiwgKGZpbGUpID0+IHtcbiAgICAgICAgaWYgKGZpbGUgaW5zdGFuY2VvZiBURmlsZSAmJiBmaWxlLmV4dGVuc2lvbiA9PT0gXCJtZFwiKSB7XG4gICAgICAgICAgdGhpcy5kZWJvdW5jZVJlZnJlc2goKTtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICApO1xuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLnZhdWx0Lm9uKFwiZGVsZXRlXCIsIChmaWxlKSA9PiB7XG4gICAgICAgIGlmIChmaWxlIGluc3RhbmNlb2YgVEZpbGUgJiYgZmlsZS5leHRlbnNpb24gPT09IFwibWRcIikge1xuICAgICAgICAgIHRoaXMuZGVib3VuY2VSZWZyZXNoKCk7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgKTtcbiAgfVxuXG4gIG9udW5sb2FkKCk6IHZvaWQge1xuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5kZXRhY2hMZWF2ZXNPZlR5cGUoVklFV19UWVBFKTtcbiAgICB0aGlzLmFwcC53b3Jrc3BhY2UuZGV0YWNoTGVhdmVzT2ZUeXBlKFRBQkxFX1ZJRVdfVFlQRSk7XG4gICAgLy8gUmVtb3ZlIGluamVjdGVkIGJ1dHRvbnNcbiAgICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKFwiLm9sLXRhYmxlLXZpZXctYnRuXCIpLmZvckVhY2goKGVsKSA9PiBlbC5yZW1vdmUoKSk7XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgSW5qZWN0IHRhYmxlLXZpZXcgYnV0dG9uIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG4gIC8qKiBTZXQgb2YgbGVhZiBJRHMgd2hlcmUgdGhlIGZpbGUgaXMga25vd24gdG8gYmUgYW4gb2JqZWN0LWxpbmtzIGZpbGUgKi9cbiAgcHJpdmF0ZSBrbm93bk9iamVjdExlYXZlcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gIHByaXZhdGUgaW5qZWN0VGFibGVWaWV3QnV0dG9ucygpOiB2b2lkIHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcIm1hcmtkb3duXCIpKSB7XG4gICAgICBjb25zdCBhY3Rpb25zID0gKGxlYWYudmlldyBhcyBhbnkpLmNvbnRhaW5lckVsPy5xdWVyeVNlbGVjdG9yKFwiLnZpZXctYWN0aW9uc1wiKSBhcyBIVE1MRWxlbWVudCB8IG51bGw7XG4gICAgICBpZiAoIWFjdGlvbnMgfHwgYWN0aW9ucy5xdWVyeVNlbGVjdG9yKFwiLm9sLXRhYmxlLXZpZXctYnRuXCIpKSBjb250aW51ZTtcblxuICAgICAgY29uc3QgZmlsZSA9IChsZWFmLnZpZXcgYXMgYW55KS5maWxlIGFzIFRGaWxlIHwgdW5kZWZpbmVkO1xuICAgICAgaWYgKCFmaWxlIHx8IGZpbGUuZXh0ZW5zaW9uICE9PSBcIm1kXCIpIGNvbnRpbnVlO1xuXG4gICAgICAvLyBDaGVjayBpZiB0aGlzIGZpbGUgaXMgYSBrbm93biBvYmplY3QtbGlua3MgZmlsZVxuICAgICAgY29uc3QgbGVhZklkID0gKGxlYWYgYXMgYW55KS5pZCA/PyBmaWxlLnBhdGg7XG4gICAgICBpZiAoIXRoaXMua25vd25PYmplY3RMZWF2ZXMuaGFzKGxlYWZJZCkpIHtcbiAgICAgICAgLy8gQXN5bmMgY2hlY2ssIGluamVjdCBvbiBuZXh0IGxheW91dC1jaGFuZ2UgaWYgaXQncyBhbiBvYmplY3QgZmlsZVxuICAgICAgICB0aGlzLmFwcC52YXVsdC5yZWFkKGZpbGUpLnRoZW4oKGNvbnRlbnQpID0+IHtcbiAgICAgICAgICBjb25zdCB0YWcgPSB0aGlzLnNldHRpbmdzLm9iamVjdEZpbGVUYWcudHJpbSgpO1xuICAgICAgICAgIGlmICh0YWcgJiYgIXRoaXMuaGFzRmlsZVRhZyhjb250ZW50LCB0YWcpKSByZXR1cm47XG4gICAgICAgICAgaWYgKCFwYXJzZU11bHRpT2JqZWN0RmlsZShjb250ZW50LCBmaWxlLnBhdGgpKSByZXR1cm47XG4gICAgICAgICAgdGhpcy5rbm93bk9iamVjdExlYXZlcy5hZGQobGVhZklkKTtcbiAgICAgICAgICB0aGlzLmluamVjdFRhYmxlVmlld0J1dHRvbnMoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBidG4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiYnV0dG9uXCIpO1xuICAgICAgYnRuLmNsYXNzTmFtZSA9IFwiY2xpY2thYmxlLWljb24gdmlldy1hY3Rpb24gb2wtdGFibGUtdmlldy1idG5cIjtcbiAgICAgIGJ0bi5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIFwiT3BlbiBhcyB0YWJsZVwiKTtcbiAgICAgIHNldEljb24oYnRuLCBcInRhYmxlXCIpO1xuICAgICAgYnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgICAgIGxlYWYuc2V0Vmlld1N0YXRlKHtcbiAgICAgICAgICB0eXBlOiBUQUJMRV9WSUVXX1RZUEUsXG4gICAgICAgICAgc3RhdGU6IHsgZmlsZTogZmlsZS5wYXRoIH0sXG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgICBhY3Rpb25zLmluc2VydEJlZm9yZShidG4sIGFjdGlvbnMuZmlyc3RDaGlsZCk7XG4gICAgfVxuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIERlYm91bmNlIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG4gIHByaXZhdGUgZGVib3VuY2VUaW1lcjogUmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCBudWxsID0gbnVsbDtcblxuICBwcml2YXRlIGRlYm91bmNlUmVmcmVzaCgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5kZWJvdW5jZVRpbWVyKSBjbGVhclRpbWVvdXQodGhpcy5kZWJvdW5jZVRpbWVyKTtcbiAgICB0aGlzLmRlYm91bmNlVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHRoaXMuZnVsbFJlZnJlc2goKSwgODAwKTtcbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCBGdWxsIHJlZnJlc2g6IHNjYW4sIGNoZWNrIGR1cGVzLCB1cGRhdGUgdmlld3MgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbiAgcHJpdmF0ZSBhc3luYyBmdWxsUmVmcmVzaCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBwYXJzZWRGaWxlcyA9IGF3YWl0IHRoaXMuc2Nhbk11bHRpT2JqZWN0RmlsZXMoKTtcbiAgICB0aGlzLnBhcnNlZEZpbGVzID0gcGFyc2VkRmlsZXM7XG4gICAgY29uc3QgYWxsRmlsZXMgPSBhd2FpdCB0aGlzLmdldEFsbFZhdWx0RmlsZXMoKTtcblxuICAgIC8vIEJ1aWxkIGluZGV4ICsgZGlzYW1iaWd1YXRlIGR1cGxpY2F0ZSBrZXkgdmFsdWVzXG4gICAgdGhpcy5hbGxPYmplY3RzID0gW107XG4gICAgdGhpcy5vYmplY3RJbmRleCA9IG5ldyBNYXAoKTtcbiAgICBjb25zdCBpZER1cGVzOiBzdHJpbmdbXSA9IFtdO1xuICAgIC8qKiBUcmFjayBpZHMgcGVyIGZpbGUgdG8gZGV0ZWN0IGR1cGxpY2F0ZSBpZHMgd2l0aGluIGEgZmlsZSAqL1xuICAgIGNvbnN0IGZpbGVJZFNldHM6IE1hcDxzdHJpbmcsIE1hcDxudW1iZXIsIHN0cmluZz4+ID0gbmV3IE1hcCgpO1xuICAgIC8qKiBNYXAgZnJvbSBwYXJzZWQgZmlsZSBwYXRoIHRvIGl0cyBrZXlQcm9wZXJ0eSBuYW1lICovXG4gICAgY29uc3QgZmlsZUtleVByb3BzOiBNYXA8c3RyaW5nLCBzdHJpbmc+ID0gbmV3IE1hcCgpO1xuXG4gICAgLy8gXHUyNTAwXHUyNTAwIFBoYXNlIDE6IENvbGxlY3QgYWxsIG9iamVjdHMgYW5kIGNoZWNrIGlkIGR1cGxpY2F0ZXMgXHUyNTAwXHUyNTAwXG4gICAgZm9yIChjb25zdCBmaWxlIG9mIHBhcnNlZEZpbGVzKSB7XG4gICAgICBmaWxlS2V5UHJvcHMuc2V0KGZpbGUuZmlsZVBhdGgsIGZpbGUua2V5UHJvcGVydHkpO1xuXG4gICAgICBpZiAoIWZpbGVJZFNldHMuaGFzKGZpbGUuZmlsZVBhdGgpKSB7XG4gICAgICAgIGZpbGVJZFNldHMuc2V0KGZpbGUuZmlsZVBhdGgsIG5ldyBNYXAoKSk7XG4gICAgICB9XG4gICAgICBjb25zdCBpZFNldCA9IGZpbGVJZFNldHMuZ2V0KGZpbGUuZmlsZVBhdGgpITtcblxuICAgICAgZm9yIChjb25zdCBvYmogb2YgZmlsZS5vYmplY3RzKSB7XG4gICAgICAgIHRoaXMuYWxsT2JqZWN0cy5wdXNoKG9iaik7XG5cbiAgICAgICAgLy8gQ2hlY2sgZHVwbGljYXRlIGlkcyB3aXRoaW4gdGhlIHNhbWUgZmlsZVxuICAgICAgICBpZiAoaWRTZXQuaGFzKG9iai5pZCkpIHtcbiAgICAgICAgICBpZER1cGVzLnB1c2goXG4gICAgICAgICAgICBgaWQgJHtvYmouaWR9IGR1cGxpY2F0ZWQgaW4gJHtvYmouZmlsZUxhYmVsfTogXCIke2lkU2V0LmdldChvYmouaWQpfVwiIGFuZCBcIiR7b2JqLmtleVZhbHVlfVwiYFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgaWRTZXQuc2V0KG9iai5pZCwgb2JqLmtleVZhbHVlKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgUGhhc2UgMjogRGlzYW1iaWd1YXRlIGR1cGxpY2F0ZSBrZXlWYWx1ZXMgXHUyNTAwXHUyNTAwXG4gICAgLy8gR3JvdXAgb2JqZWN0cyBieSBsb3dlcmNhc2Uga2V5VmFsdWVcbiAgICBjb25zdCBrZXlHcm91cHMgPSBuZXcgTWFwPHN0cmluZywgUGFyc2VkT2JqZWN0W10+KCk7XG4gICAgZm9yIChjb25zdCBvYmogb2YgdGhpcy5hbGxPYmplY3RzKSB7XG4gICAgICBjb25zdCBrID0gb2JqLmtleVZhbHVlLnRvTG93ZXJDYXNlKCk7XG4gICAgICBpZiAoIWtleUdyb3Vwcy5oYXMoaykpIGtleUdyb3Vwcy5zZXQoaywgW10pO1xuICAgICAga2V5R3JvdXBzLmdldChrKSEucHVzaChvYmopO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgWywgZ3JvdXBdIG9mIGtleUdyb3Vwcykge1xuICAgICAgaWYgKGdyb3VwLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICAvLyBVbmlxdWUga2V5OiBkaXNwbGF5S2V5ID0ga2V5VmFsdWUgKGFscmVhZHkgdGhlIGRlZmF1bHQpXG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICAvLyBNdWx0aXBsZSBvYmplY3RzIHNoYXJlIHRoZSBzYW1lIGtleVZhbHVlIC0tIGRpc2FtYmlndWF0ZVxuICAgICAgLy8gU3RlcCAxOiBUcnkgXCJrZXlWYWx1ZSAoZmlsZUxhYmVsKVwiXG4gICAgICBjb25zdCBmaWxlR3JvdXBzID0gbmV3IE1hcDxzdHJpbmcsIFBhcnNlZE9iamVjdFtdPigpO1xuICAgICAgZm9yIChjb25zdCBvYmogb2YgZ3JvdXApIHtcbiAgICAgICAgY29uc3QgZmsgPSBvYmouZmlsZUxhYmVsLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIGlmICghZmlsZUdyb3Vwcy5oYXMoZmspKSBmaWxlR3JvdXBzLnNldChmaywgW10pO1xuICAgICAgICBmaWxlR3JvdXBzLmdldChmaykhLnB1c2gob2JqKTtcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCBbLCBmR3JvdXBdIG9mIGZpbGVHcm91cHMpIHtcbiAgICAgICAgaWYgKGZHcm91cC5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgICAvLyBrZXkgKyBmaWxlbmFtZSBpcyB1bmlxdWVcbiAgICAgICAgICBmR3JvdXBbMF0uZGlzcGxheUtleSA9IGAke2ZHcm91cFswXS5rZXlWYWx1ZX0gKCR7Zkdyb3VwWzBdLmZpbGVMYWJlbH0pYDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBrZXkgKyBmaWxlbmFtZSBzdGlsbCBjb2xsaWRlczogdXNlIHNlY29uZCBwcm9wZXJ0eVxuICAgICAgICAgIGZvciAoY29uc3Qgb2JqIG9mIGZHcm91cCkge1xuICAgICAgICAgICAgY29uc3Qga2V5UHJvcCA9IGZpbGVLZXlQcm9wcy5nZXQob2JqLmZpbGVQYXRoKSB8fCBcIlwiO1xuICAgICAgICAgICAgY29uc3Qgc2Vjb25kVmFsID0gZ2V0U2Vjb25kUHJvcGVydHkob2JqLCBrZXlQcm9wKTtcbiAgICAgICAgICAgIGlmIChzZWNvbmRWYWwpIHtcbiAgICAgICAgICAgICAgb2JqLmRpc3BsYXlLZXkgPSBgJHtvYmoua2V5VmFsdWV9ICgke3NlY29uZFZhbH0pYDtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIC8vIEZhbGxiYWNrOiB1c2UgaWRcbiAgICAgICAgICAgICAgb2JqLmRpc3BsYXlLZXkgPSBgJHtvYmoua2V5VmFsdWV9ICgjJHtvYmouaWR9KWA7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gXHUyNTAwXHUyNTAwIFBoYXNlIDM6IEJ1aWxkIG9iamVjdEluZGV4IHVzaW5nIGRpc3BsYXlLZXkgXHUyNTAwXHUyNTAwXG4gICAgLy8gUmVnaXN0ZXIgZWFjaCBvYmplY3QgYnkgaXRzIGRpc3BsYXlLZXkgKHByaW1hcnkgbG9va3VwKVxuICAgIGZvciAoY29uc3Qgb2JqIG9mIHRoaXMuYWxsT2JqZWN0cykge1xuICAgICAgdGhpcy5vYmplY3RJbmRleC5zZXQob2JqLmRpc3BsYXlLZXkudG9Mb3dlckNhc2UoKSwgb2JqKTtcbiAgICB9XG4gICAgLy8gQWxzbyByZWdpc3RlciBieSBwbGFpbiBrZXlWYWx1ZSBmb3Igbm9uLWFtYmlndW91cyBrZXlzXG4gICAgLy8gKHNvIGV4aXN0aW5nIHt7a2V5VmFsdWV9fSBsaW5rcyBzdGlsbCByZXNvbHZlIHdoZW4gdGhlcmUncyBubyBjb2xsaXNpb24pXG4gICAgZm9yIChjb25zdCBbaywgZ3JvdXBdIG9mIGtleUdyb3Vwcykge1xuICAgICAgaWYgKGdyb3VwLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICB0aGlzLm9iamVjdEluZGV4LnNldChrLCBncm91cFswXSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gV2FybiBvbiBkdXBsaWNhdGUgaWRzXG4gICAgaWYgKGlkRHVwZXMubGVuZ3RoID4gMCkge1xuICAgICAgbmV3IE5vdGljZShcbiAgICAgICAgYE9iamVjdCBMaW5rczogRHVwbGljYXRlIElEcyBmb3VuZDpcXG4ke2lkRHVwZXMuam9pbihcIlxcblwiKX1gLFxuICAgICAgICA4MDAwXG4gICAgICApO1xuICAgIH1cblxuICAgIC8vIFVwZGF0ZSBzdWdnZXN0IHByb3ZpZGVyXG4gICAgaWYgKHRoaXMuc3VnZ2VzdFByb3ZpZGVyKSB7XG4gICAgICB0aGlzLnN1Z2dlc3RQcm92aWRlci5zZXRPYmplY3RzKHRoaXMuYWxsT2JqZWN0cyk7XG4gICAgfVxuXG4gICAgLy8gQnVpbGQgZ3JhcGhcbiAgICB0aGlzLmdyYXBoRGF0YSA9IGJ1aWxkR3JhcGgocGFyc2VkRmlsZXMsIGFsbEZpbGVzKTtcblxuICAgIC8vIFVwZGF0ZSBvcGVuIGdyYXBoIHZpZXdzXG4gICAgdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShWSUVXX1RZUEUpLmZvckVhY2goKGxlYWYpID0+IHtcbiAgICAgIGlmIChsZWFmLnZpZXcgaW5zdGFuY2VvZiBHcmFwaFZpZXcpIHtcbiAgICAgICAgbGVhZi52aWV3Lm5hdmlnYXRlVG9PYmplY3QgPSAoZnAsIHNsKSA9PiB0aGlzLmdvVG9PYmplY3QoZnAsIHNsKTtcbiAgICAgICAgbGVhZi52aWV3Lm5hdmlnYXRlVG9GaWxlID0gKGZwKSA9PiB0aGlzLmdvVG9GaWxlKGZwKTtcbiAgICAgICAgbGVhZi52aWV3LnNldEdyYXBoRGF0YSh0aGlzLmdyYXBoRGF0YSEpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIFZhdWx0IHNjYW5uaW5nIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG4gIHByaXZhdGUgYXN5bmMgc2Nhbk11bHRpT2JqZWN0RmlsZXMoKTogUHJvbWlzZTxQYXJzZWRGaWxlW10+IHtcbiAgICBjb25zdCBmaWxlcyA9IHRoaXMuYXBwLnZhdWx0LmdldE1hcmtkb3duRmlsZXMoKTtcbiAgICBjb25zdCBwYXJzZWQ6IFBhcnNlZEZpbGVbXSA9IFtdO1xuICAgIGNvbnN0IHRhZyA9IHRoaXMuc2V0dGluZ3Mub2JqZWN0RmlsZVRhZy50cmltKCk7XG5cbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5yZWFkKGZpbGUpO1xuXG4gICAgICAgIC8vIElmIGEgdGFnIGlzIGNvbmZpZ3VyZWQsIG9ubHkgcGFyc2UgZmlsZXMgd2hvc2UgZnJvbnRtYXR0ZXJcbiAgICAgICAgLy8gaW5jbHVkZXMgdGhhdCB0YWcuXG4gICAgICAgIGlmICh0YWcpIHtcbiAgICAgICAgICBpZiAoIXRoaXMuaGFzRmlsZVRhZyhjb250ZW50LCB0YWcpKSBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHBhcnNlTXVsdGlPYmplY3RGaWxlKGNvbnRlbnQsIGZpbGUucGF0aCk7XG4gICAgICAgIGlmIChyZXN1bHQpIHBhcnNlZC5wdXNoKHJlc3VsdCk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLyogc2tpcCAqL1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcGFyc2VkO1xuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrIGlmIGEgbWFya2Rvd24gZmlsZSBjb250YWlucyB0aGUgZ2l2ZW4gdGFnLlxuICAgKiBTdXBwb3J0czpcbiAgICogIDEuIEJhcmUgYCN0YWdgIGFueXdoZXJlIGluIHRoZSBmaWxlIChlLmcuIGAjb2JqZWN0LWxpbmtzYCBvbiBsaW5lIDEpXG4gICAqICAyLiBZQU1MIGZyb250bWF0dGVyIGB0YWdzOiBbYSwgYl1gLCBgdGFnczogYWAsIG9yIGxpc3QgZm9ybVxuICAgKiAgMy4gVGhlIGB0YWc6YCBhbGlhcyB1c2VkIGJ5IHNvbWUgT2JzaWRpYW4gc2V0dXBzXG4gICAqL1xuICBwcml2YXRlIGhhc0ZpbGVUYWcoY29udGVudDogc3RyaW5nLCB0YWc6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IGxvd2VyVGFnID0gdGFnLnRvTG93ZXJDYXNlKCk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgMS4gQmFyZSAjdGFnIGFueXdoZXJlIGluIHRoZSBjb250ZW50IFx1MjUwMFx1MjUwMFxuICAgIC8vIE1hdGNoICN0YWcgYXMgYSB3aG9sZSB3b3JkIChub3QgaW5zaWRlIGFub3RoZXIgd29yZClcbiAgICBjb25zdCBiYXJlVGFnUmVnZXggPSBuZXcgUmVnRXhwKFxuICAgICAgYCg/Ol58XFxcXHMpIyR7dGFnLnJlcGxhY2UoL1suKis/XiR7fSgpfFtcXF1cXFxcXS9nLCBcIlxcXFwkJlwiKX0oPzpcXFxcc3wkKWAsXG4gICAgICBcImltXCJcbiAgICApO1xuICAgIGlmIChiYXJlVGFnUmVnZXgudGVzdChjb250ZW50KSkgcmV0dXJuIHRydWU7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgMi4gWUFNTCBmcm9udG1hdHRlciB0YWdzIFx1MjUwMFx1MjUwMFxuICAgIGlmICghY29udGVudC5zdGFydHNXaXRoKFwiLS0tXCIpKSByZXR1cm4gZmFsc2U7XG4gICAgY29uc3QgZW5kSWR4ID0gY29udGVudC5pbmRleE9mKFwiXFxuLS0tXCIsIDMpO1xuICAgIGlmIChlbmRJZHggPT09IC0xKSByZXR1cm4gZmFsc2U7XG4gICAgY29uc3QgZnJvbnRtYXR0ZXIgPSBjb250ZW50LnN1YnN0cmluZygzLCBlbmRJZHgpO1xuXG4gICAgLy8gTWF0Y2ggXCJ0YWdzOlwiIG9yIFwidGFnOlwiIGxpbmVzIHdpdGggaW5saW5lIHZhbHVlc1xuICAgIGZvciAoY29uc3QgbGluZSBvZiBmcm9udG1hdHRlci5zcGxpdChcIlxcblwiKSkge1xuICAgICAgY29uc3QgdHJpbW1lZCA9IGxpbmUudHJpbSgpO1xuICAgICAgY29uc3QgbWF0Y2ggPSB0cmltbWVkLm1hdGNoKC9edGFncz9cXHMqOlxccyooLispJC9pKTtcbiAgICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlO1xuXG4gICAgICBsZXQgdmFsdWUgPSBtYXRjaFsxXS50cmltKCk7XG5cbiAgICAgIC8vIEFycmF5IGZvcm06IFthLCBiLCBjXVxuICAgICAgaWYgKHZhbHVlLnN0YXJ0c1dpdGgoXCJbXCIpICYmIHZhbHVlLmVuZHNXaXRoKFwiXVwiKSkge1xuICAgICAgICB2YWx1ZSA9IHZhbHVlLnNsaWNlKDEsIC0xKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgdGFncyA9IHZhbHVlLnNwbGl0KFwiLFwiKS5tYXAoKHQpID0+IHQudHJpbSgpLnRvTG93ZXJDYXNlKCkpO1xuICAgICAgaWYgKHRhZ3MuaW5jbHVkZXMobG93ZXJUYWcpKSByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICAvLyBZQU1MIGxpc3QgZm9ybTpcbiAgICAvLyAgIHRhZ3M6XG4gICAgLy8gICAgIC0gdGFnMVxuICAgIC8vICAgICAtIHRhZzJcbiAgICBjb25zdCBsaXN0UmVnZXggPSAvXnRhZ3M/XFxzKjpcXHMqJC9pbTtcbiAgICBjb25zdCBsaXN0TWF0Y2ggPSBsaXN0UmVnZXguZXhlYyhmcm9udG1hdHRlcik7XG4gICAgaWYgKGxpc3RNYXRjaCkge1xuICAgICAgY29uc3QgYWZ0ZXJUYWdzID0gZnJvbnRtYXR0ZXIuc3Vic3RyaW5nKFxuICAgICAgICBsaXN0TWF0Y2guaW5kZXggKyBsaXN0TWF0Y2hbMF0ubGVuZ3RoXG4gICAgICApO1xuICAgICAgZm9yIChjb25zdCBsaW5lIG9mIGFmdGVyVGFncy5zcGxpdChcIlxcblwiKSkge1xuICAgICAgICBjb25zdCB0cmltbWVkID0gbGluZS50cmltKCk7XG4gICAgICAgIGlmICh0cmltbWVkLnN0YXJ0c1dpdGgoXCItIFwiKSkge1xuICAgICAgICAgIGNvbnN0IHRhZ1ZhbCA9IHRyaW1tZWQuc3Vic3RyaW5nKDIpLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICAgIGlmICh0YWdWYWwgPT09IGxvd2VyVGFnKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIGlmICh0cmltbWVkLmxlbmd0aCA+IDAgJiYgIXRyaW1tZWQuc3RhcnRzV2l0aChcIiNcIikpIHtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZ2V0QWxsVmF1bHRGaWxlcygpOiBQcm9taXNlPFZhdWx0RmlsZVtdPiB7XG4gICAgY29uc3QgZmlsZXMgPSB0aGlzLmFwcC52YXVsdC5nZXRNYXJrZG93bkZpbGVzKCk7XG4gICAgY29uc3QgcmVzdWx0OiBWYXVsdEZpbGVbXSA9IFtdO1xuICAgIGZvciAoY29uc3QgZmlsZSBvZiBmaWxlcykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSk7XG4gICAgICAgIHJlc3VsdC5wdXNoKHsgcGF0aDogZmlsZS5wYXRoLCBiYXNlbmFtZTogZmlsZS5iYXNlbmFtZSwgY29udGVudCB9KTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvKiBza2lwICovXG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgTWFya2Rvd24gcG9zdC1wcm9jZXNzb3IgZm9yIHt7b2JqZWN0fX0gbGlua3MgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbiAgcHJpdmF0ZSBwcm9jZXNzT2JqZWN0TGlua3MoZWw6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgLy8gV2FsayBhbGwgdGV4dCBub2RlcyBhbmQgcmVwbGFjZSB7ey4uLn19IHdpdGggY2xpY2thYmxlIHNwYW5zXG4gICAgY29uc3Qgd2Fsa2VyID0gZG9jdW1lbnQuY3JlYXRlVHJlZVdhbGtlcihlbCwgTm9kZUZpbHRlci5TSE9XX1RFWFQpO1xuICAgIGNvbnN0IG5vZGVzVG9SZXBsYWNlOiB7IG5vZGU6IFRleHQ7IG1hdGNoZXM6IFJlZ0V4cEV4ZWNBcnJheVtdIH1bXSA9IFtdO1xuXG4gICAgbGV0IHRleHROb2RlOiBUZXh0IHwgbnVsbDtcbiAgICB3aGlsZSAoKHRleHROb2RlID0gd2Fsa2VyLm5leHROb2RlKCkgYXMgVGV4dCB8IG51bGwpKSB7XG4gICAgICBjb25zdCB0ZXh0ID0gdGV4dE5vZGUudGV4dENvbnRlbnQgfHwgXCJcIjtcbiAgICAgIGNvbnN0IHJlZ2V4ID0gL1xce1xceyhbXn1dKylcXH1cXH0vZztcbiAgICAgIGNvbnN0IG1hdGNoZXM6IFJlZ0V4cEV4ZWNBcnJheVtdID0gW107XG4gICAgICBsZXQgbWF0Y2g6IFJlZ0V4cEV4ZWNBcnJheSB8IG51bGw7XG4gICAgICB3aGlsZSAoKG1hdGNoID0gcmVnZXguZXhlYyh0ZXh0KSkgIT09IG51bGwpIHtcbiAgICAgICAgbWF0Y2hlcy5wdXNoKHsgLi4ubWF0Y2gsIGluZGV4OiBtYXRjaC5pbmRleCB9IGFzIFJlZ0V4cEV4ZWNBcnJheSk7XG4gICAgICB9XG4gICAgICBpZiAobWF0Y2hlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIG5vZGVzVG9SZXBsYWNlLnB1c2goeyBub2RlOiB0ZXh0Tm9kZSwgbWF0Y2hlcyB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHsgbm9kZSwgbWF0Y2hlcyB9IG9mIG5vZGVzVG9SZXBsYWNlKSB7XG4gICAgICBjb25zdCB0ZXh0ID0gbm9kZS50ZXh0Q29udGVudCB8fCBcIlwiO1xuICAgICAgY29uc3QgcGFyZW50ID0gbm9kZS5wYXJlbnROb2RlO1xuICAgICAgaWYgKCFwYXJlbnQpIGNvbnRpbnVlO1xuXG4gICAgICBjb25zdCBmcmFnID0gZG9jdW1lbnQuY3JlYXRlRG9jdW1lbnRGcmFnbWVudCgpO1xuICAgICAgbGV0IGxhc3RJbmRleCA9IDA7XG5cbiAgICAgIGZvciAoY29uc3QgbWF0Y2ggb2YgbWF0Y2hlcykge1xuICAgICAgICAvLyBUZXh0IGJlZm9yZSB0aGUgbWF0Y2hcbiAgICAgICAgaWYgKG1hdGNoLmluZGV4ID4gbGFzdEluZGV4KSB7XG4gICAgICAgICAgZnJhZy5hcHBlbmRDaGlsZChcbiAgICAgICAgICAgIGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKHRleHQuc3Vic3RyaW5nKGxhc3RJbmRleCwgbWF0Y2guaW5kZXgpKVxuICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBUaGUge3tsaW5rfX0gaXRzZWxmXG4gICAgICAgIGxldCBsaW5rVGFyZ2V0ID0gbWF0Y2hbMV07XG4gICAgICAgIGxldCBkaXNwbGF5VGV4dCA9IGxpbmtUYXJnZXQ7XG4gICAgICAgIGNvbnN0IHBpcGVJZHggPSBsaW5rVGFyZ2V0LmluZGV4T2YoXCJ8XCIpO1xuICAgICAgICBpZiAocGlwZUlkeCAhPT0gLTEpIHtcbiAgICAgICAgICBkaXNwbGF5VGV4dCA9IGxpbmtUYXJnZXQuc3Vic3RyaW5nKHBpcGVJZHggKyAxKS50cmltKCk7XG4gICAgICAgICAgbGlua1RhcmdldCA9IGxpbmtUYXJnZXQuc3Vic3RyaW5nKDAsIHBpcGVJZHgpLnRyaW0oKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHNwYW4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcbiAgICAgICAgc3Bhbi5jbGFzc05hbWUgPSBcIm9sLWlubGluZS1saW5rXCI7XG4gICAgICAgIHNwYW4udGV4dENvbnRlbnQgPSBkaXNwbGF5VGV4dDtcbiAgICAgICAgc3Bhbi5zZXRBdHRyaWJ1dGUoXCJkYXRhLW9sLXRhcmdldFwiLCBsaW5rVGFyZ2V0KTtcblxuICAgICAgICBjb25zdCBvYmogPSB0aGlzLm9iamVjdEluZGV4LmdldChsaW5rVGFyZ2V0LnRvTG93ZXJDYXNlKCkpO1xuICAgICAgICBpZiAoIW9iaikge1xuICAgICAgICAgIHNwYW4uY2xhc3NMaXN0LmFkZChcIm9sLWlubGluZS1saW5rLXVucmVzb2x2ZWRcIik7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDbGljayAtPiBuYXZpZ2F0ZSB0byB0aGUgb2JqZWN0XG4gICAgICAgIHNwYW4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIChlKSA9PiB7XG4gICAgICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgICAgY29uc3QgdGFyZ2V0ID0gc3Bhbi5nZXRBdHRyaWJ1dGUoXCJkYXRhLW9sLXRhcmdldFwiKSB8fCBcIlwiO1xuICAgICAgICAgIGNvbnN0IHRhcmdldE9iaiA9IHRoaXMub2JqZWN0SW5kZXguZ2V0KHRhcmdldC50b0xvd2VyQ2FzZSgpKTtcbiAgICAgICAgICBpZiAodGFyZ2V0T2JqKSB7XG4gICAgICAgICAgICB0aGlzLmdvVG9PYmplY3QodGFyZ2V0T2JqLmZpbGVQYXRoLCB0YXJnZXRPYmouc3RhcnRMaW5lKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbmV3IE5vdGljZShgT2JqZWN0IFwiJHt0YXJnZXR9XCIgbm90IGZvdW5kYCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBIb3ZlciAtPiBzaG93IHRvb2x0aXAgd2l0aCBwcm9wZXJ0aWVzXG4gICAgICAgIHNwYW4uYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlZW50ZXJcIiwgKGUpID0+IHtcbiAgICAgICAgICBjb25zdCB0YXJnZXQgPSBzcGFuLmdldEF0dHJpYnV0ZShcImRhdGEtb2wtdGFyZ2V0XCIpIHx8IFwiXCI7XG4gICAgICAgICAgY29uc3QgdGFyZ2V0T2JqID0gdGhpcy5vYmplY3RJbmRleC5nZXQodGFyZ2V0LnRvTG93ZXJDYXNlKCkpO1xuICAgICAgICAgIGlmICh0YXJnZXRPYmopIHtcbiAgICAgICAgICAgIHRoaXMuc2hvd09iamVjdFBvcG92ZXIoc3BhbiwgdGFyZ2V0T2JqKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBzcGFuLmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZWxlYXZlXCIsICgpID0+IHtcbiAgICAgICAgICB0aGlzLmhpZGVPYmplY3RQb3BvdmVyKCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGZyYWcuYXBwZW5kQ2hpbGQoc3Bhbik7XG4gICAgICAgIGxhc3RJbmRleCA9IG1hdGNoLmluZGV4ICsgbWF0Y2hbMF0ubGVuZ3RoO1xuICAgICAgfVxuXG4gICAgICAvLyBSZW1haW5pbmcgdGV4dFxuICAgICAgaWYgKGxhc3RJbmRleCA8IHRleHQubGVuZ3RoKSB7XG4gICAgICAgIGZyYWcuYXBwZW5kQ2hpbGQoZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUodGV4dC5zdWJzdHJpbmcobGFzdEluZGV4KSkpO1xuICAgICAgfVxuXG4gICAgICBwYXJlbnQucmVwbGFjZUNoaWxkKGZyYWcsIG5vZGUpO1xuICAgIH1cbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCBPYmplY3QgcG9wb3ZlciBvbiBob3ZlciBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBwcml2YXRlIHBvcG92ZXJFbDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcblxuICBwcml2YXRlIHNob3dPYmplY3RQb3BvdmVyKGFuY2hvcjogSFRNTEVsZW1lbnQsIG9iajogUGFyc2VkT2JqZWN0KTogdm9pZCB7XG4gICAgdGhpcy5oaWRlT2JqZWN0UG9wb3ZlcigpO1xuXG4gICAgY29uc3QgcG9wID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICBwb3AuY2xhc3NOYW1lID0gXCJvbC1wb3BvdmVyXCI7XG5cbiAgICBjb25zdCB0aXRsZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgdGl0bGUuY2xhc3NOYW1lID0gXCJvbC1wb3BvdmVyLXRpdGxlXCI7XG4gICAgdGl0bGUudGV4dENvbnRlbnQgPSBvYmouZGlzcGxheUtleTtcbiAgICBwb3AuYXBwZW5kQ2hpbGQodGl0bGUpO1xuXG4gICAgY29uc3QgZmlsZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgZmlsZS5jbGFzc05hbWUgPSBcIm9sLXBvcG92ZXItZmlsZVwiO1xuICAgIGZpbGUudGV4dENvbnRlbnQgPSBvYmouZmlsZUxhYmVsO1xuICAgIHBvcC5hcHBlbmRDaGlsZChmaWxlKTtcblxuICAgIGZvciAoY29uc3QgW2ssIHZdIG9mIE9iamVjdC5lbnRyaWVzKG9iai5wcm9wZXJ0aWVzKSkge1xuICAgICAgY29uc3Qgcm93ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgIHJvdy5jbGFzc05hbWUgPSBcIm9sLXBvcG92ZXItcm93XCI7XG4gICAgICByb3cuaW5uZXJIVE1MID0gYDxzcGFuIGNsYXNzPVwib2wtcG9wb3Zlci1rZXlcIj4ke2t9PC9zcGFuPjxzcGFuIGNsYXNzPVwib2wtcG9wb3Zlci12YWxcIj4ke3Z9PC9zcGFuPmA7XG4gICAgICBwb3AuYXBwZW5kQ2hpbGQocm93KTtcbiAgICB9XG5cbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKHBvcCk7XG4gICAgdGhpcy5wb3BvdmVyRWwgPSBwb3A7XG5cbiAgICAvLyBQb3NpdGlvbiBiZWxvdyB0aGUgYW5jaG9yXG4gICAgY29uc3QgcmVjdCA9IGFuY2hvci5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICBwb3Auc3R5bGUudG9wID0gcmVjdC5ib3R0b20gKyA0ICsgXCJweFwiO1xuICAgIHBvcC5zdHlsZS5sZWZ0ID0gcmVjdC5sZWZ0ICsgXCJweFwiO1xuICB9XG5cbiAgcHJpdmF0ZSBoaWRlT2JqZWN0UG9wb3ZlcigpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5wb3BvdmVyRWwpIHtcbiAgICAgIHRoaXMucG9wb3ZlckVsLnJlbW92ZSgpO1xuICAgICAgdGhpcy5wb3BvdmVyRWwgPSBudWxsO1xuICAgIH1cbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCBPYmplY3QgY3JlYXRpb24gXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbiAgLyoqXG4gICAqIE9wZW4gdGhlIG9iamVjdC1jcmVhdGlvbiBtb2RhbC5cbiAgICogQHBhcmFtIHByZWZpbGxLZXkgIE9wdGlvbmFsIGtleSB0byBwcmUtZmlsbCAoZS5nLiBmcm9tIHN1Z2dlc3QgcHJvdmlkZXIpLlxuICAgKi9cbiAgcHJpdmF0ZSBvcGVuQ3JlYXRlTW9kYWwocHJlZmlsbEtleT86IHN0cmluZyk6IHZvaWQge1xuICAgIGNvbnN0IHR5cGVzID0gZ2V0T2JqZWN0VHlwZXModGhpcy5wYXJzZWRGaWxlcyk7XG4gICAgaWYgKHR5cGVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgbmV3IE5vdGljZShcIk5vIG9iamVjdC1saW5rcyBmaWxlcyBmb3VuZC4gQ3JlYXRlIG9uZSBmaXJzdC5cIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gSWYgdGhlIGN1cnJlbnQgZmlsZSBpcyBhbiBvYmplY3QtbGlua3MgZmlsZSwgcHJlLXNlbGVjdCB0aGF0IHR5cGVcbiAgICBjb25zdCBhY3RpdmVGaWxlID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcbiAgICBsZXQgc2VsZWN0ZWRUeXBlOiBSZXR1cm5UeXBlPHR5cGVvZiBnZXRPYmplY3RUeXBlcz5bbnVtYmVyXSB8IHVuZGVmaW5lZDtcbiAgICBpZiAoYWN0aXZlRmlsZSkge1xuICAgICAgc2VsZWN0ZWRUeXBlID0gdHlwZXMuZmluZCgodCkgPT4gdC5maWxlUGF0aCA9PT0gYWN0aXZlRmlsZS5wYXRoKTtcbiAgICB9XG5cbiAgICBuZXcgQ3JlYXRlT2JqZWN0TW9kYWwodGhpcy5hcHAsIHR5cGVzLCB7XG4gICAgICBzZWxlY3RlZFR5cGUsXG4gICAgICBwcmVmaWxsS2V5OiBwcmVmaWxsS2V5ID8/IHVuZGVmaW5lZCxcbiAgICAgIG9uQ3JlYXRlZDogYXN5bmMgKGZpbGVQYXRoKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuZnVsbFJlZnJlc2goKTtcbiAgICAgICAgLy8gT3BlbiB0aGUgZmlsZSBzbyB0aGUgdXNlciBjYW4gc2VlIHRoZSByZXN1bHRcbiAgICAgICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChmaWxlUGF0aCk7XG4gICAgICAgIGlmIChmaWxlIGluc3RhbmNlb2YgVEZpbGUpIHtcbiAgICAgICAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQucmVhZChmaWxlKTtcbiAgICAgICAgICAvLyBHbyB0byB0aGUgbGFzdCBvYmplY3QgKHRoZSBvbmUgd2UganVzdCBjcmVhdGVkKVxuICAgICAgICAgIGNvbnN0IGxhc3RTZXBJZHggPSBjb250ZW50Lmxhc3RJbmRleE9mKFwiXFxuLS0tXFxuXCIpO1xuICAgICAgICAgIGNvbnN0IHRhcmdldExpbmUgPSBsYXN0U2VwSWR4ID49IDBcbiAgICAgICAgICAgID8gY29udGVudC5zdWJzdHJpbmcoMCwgbGFzdFNlcElkeCkuc3BsaXQoXCJcXG5cIikubGVuZ3RoICsgMVxuICAgICAgICAgICAgOiBjb250ZW50LnNwbGl0KFwiXFxuXCIpLmxlbmd0aCAtIDE7XG4gICAgICAgICAgYXdhaXQgdGhpcy5nb1RvT2JqZWN0KGZpbGVQYXRoLCB0YXJnZXRMaW5lKTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICB9KS5vcGVuKCk7XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgTmF2aWdhdGlvbiBoZWxwZXJzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG4gIHByaXZhdGUgYXN5bmMgZ29Ub09iamVjdChmaWxlUGF0aDogc3RyaW5nLCBzdGFydExpbmU6IG51bWJlcik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoZmlsZVBhdGgpO1xuICAgIGlmICghKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHtcbiAgICAgIG5ldyBOb3RpY2UoYEZpbGUgbm90IGZvdW5kOiAke2ZpbGVQYXRofWApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGxlYWYgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0TGVhZihcInRhYlwiKTtcbiAgICBhd2FpdCBsZWFmLm9wZW5GaWxlKGZpbGUpO1xuXG4gICAgLy8gU2Nyb2xsIHRvIHRoZSBsaW5lXG4gICAgY29uc3QgdmlldyA9IGxlYWYudmlldyBhcyBhbnk7XG4gICAgaWYgKHZpZXcgJiYgdmlldy5lZGl0b3IpIHtcbiAgICAgIC8vIEdpdmUgdGhlIGVkaXRvciBhIG1vbWVudCB0byBsb2FkXG4gICAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICB2aWV3LmVkaXRvci5zZXRDdXJzb3IoeyBsaW5lOiBzdGFydExpbmUsIGNoOiAwIH0pO1xuICAgICAgICAgIHZpZXcuZWRpdG9yLnNjcm9sbEludG9WaWV3KFxuICAgICAgICAgICAgeyBmcm9tOiB7IGxpbmU6IHN0YXJ0TGluZSwgY2g6IDAgfSwgdG86IHsgbGluZTogc3RhcnRMaW5lICsgNSwgY2g6IDAgfSB9LFxuICAgICAgICAgICAgdHJ1ZVxuICAgICAgICAgICk7XG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIC8qIGVkaXRvciBtaWdodCBub3Qgc3VwcG9ydCB0aGlzICovXG4gICAgICAgIH1cbiAgICAgIH0sIDEwMCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBnb1RvRmlsZShmaWxlUGF0aDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChmaWxlUGF0aCk7XG4gICAgaWYgKCEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkge1xuICAgICAgbmV3IE5vdGljZShgRmlsZSBub3QgZm91bmQ6ICR7ZmlsZVBhdGh9YCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGxlYWYgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0TGVhZihcInRhYlwiKTtcbiAgICBhd2FpdCBsZWFmLm9wZW5GaWxlKGZpbGUpO1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIEFjdGl2YXRlIHZpZXcgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbiAgYXN5bmMgYWN0aXZhdGVWaWV3KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHsgd29ya3NwYWNlIH0gPSB0aGlzLmFwcDtcblxuICAgIGxldCBsZWFmOiBXb3Jrc3BhY2VMZWFmIHwgbnVsbCA9IG51bGw7XG4gICAgY29uc3QgbGVhdmVzID0gd29ya3NwYWNlLmdldExlYXZlc09mVHlwZShWSUVXX1RZUEUpO1xuXG4gICAgaWYgKGxlYXZlcy5sZW5ndGggPiAwKSB7XG4gICAgICBsZWFmID0gbGVhdmVzWzBdO1xuICAgIH0gZWxzZSB7XG4gICAgICBsZWFmID0gd29ya3NwYWNlLmdldExlYWYoXCJ0YWJcIik7XG4gICAgICBhd2FpdCBsZWFmLnNldFZpZXdTdGF0ZSh7IHR5cGU6IFZJRVdfVFlQRSwgYWN0aXZlOiB0cnVlIH0pO1xuICAgIH1cblxuICAgIHdvcmtzcGFjZS5yZXZlYWxMZWFmKGxlYWYpO1xuXG4gICAgLy8gQnVpbGQvcmVmcmVzaCBncmFwaFxuICAgIGF3YWl0IHRoaXMuZnVsbFJlZnJlc2goKTtcbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCBTZXR0aW5ncyBwZXJzaXN0ZW5jZSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBhc3luYyBsb2FkU2V0dGluZ3MoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5zZXR0aW5ncyA9IE9iamVjdC5hc3NpZ24oe30sIERFRkFVTFRfU0VUVElOR1MsIGF3YWl0IHRoaXMubG9hZERhdGEoKSk7XG4gIH1cblxuICBhc3luYyBzYXZlU2V0dGluZ3MoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YSh0aGlzLnNldHRpbmdzKTtcbiAgICAvLyBSZS1zY2FuIGFmdGVyIHNldHRpbmdzIGNoYW5nZSAodGFnIG1heSBoYXZlIGNoYW5nZWQpXG4gICAgdGhpcy5mdWxsUmVmcmVzaCgpO1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIEVkaXRvciBoZWxwZXJzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG4gIC8qKlxuICAgKiBDb21tYW5kOiBvcGVuIHRoZSBmaWxlL29iamVjdCBcInVuZGVyIHRoZSBjdXJzb3JcIi5cbiAgICogLSBJZiBjdXJzb3IgaXMgaW5zaWRlIGEgd2lraWxpbmsgKFtbLi4uXV0pLCBvcGVucyB0aGF0IGZpbGUuXG4gICAqIC0gSWYgY3Vyc29yIGlzIGluc2lkZSBhbiBvYmplY3QgbGluayAoe3suLi59fSksIG9wZW5zIHRoZSBvYmplY3QncyBzb3VyY2UgZmlsZS5cbiAgICovXG4gIGFzeW5jIG9wZW5VbmRlckN1cnNvcigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB2aWV3ID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcbiAgICBjb25zdCBlZGl0b3IgPSB2aWV3Py5lZGl0b3I7XG4gICAgaWYgKCFlZGl0b3IpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJPYmplY3QgTGlua3M6IE5vIGFjdGl2ZSBlZGl0b3JcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgY3Vyc29yID0gZWRpdG9yLmdldEN1cnNvcigpO1xuICAgIGNvbnN0IGxpbmUgPSBlZGl0b3IuZ2V0TGluZShjdXJzb3IubGluZSkgYXMgc3RyaW5nO1xuICAgIGNvbnN0IGNoID0gY3Vyc29yLmNoIGFzIG51bWJlcjtcblxuICAgIGNvbnN0IHdpdGhpbiA9IChvcGVuOiBzdHJpbmcsIGNsb3NlOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsID0+IHtcbiAgICAgIGNvbnN0IGxlZnQgPSBsaW5lLmxhc3RJbmRleE9mKG9wZW4sIGNoKTtcbiAgICAgIGlmIChsZWZ0ID09PSAtMSkgcmV0dXJuIG51bGw7XG4gICAgICBjb25zdCByaWdodCA9IGxpbmUuaW5kZXhPZihjbG9zZSwgbGVmdCArIG9wZW4ubGVuZ3RoKTtcbiAgICAgIGlmIChyaWdodCA9PT0gLTEpIHJldHVybiBudWxsO1xuICAgICAgaWYgKGNoIDwgbGVmdCArIG9wZW4ubGVuZ3RoIHx8IGNoID4gcmlnaHQpIHJldHVybiBudWxsO1xuICAgICAgcmV0dXJuIGxpbmUuc3Vic3RyaW5nKGxlZnQgKyBvcGVuLmxlbmd0aCwgcmlnaHQpO1xuICAgIH07XG5cbiAgICAvLyAxKSBXaWtpbGluazogW1t0YXJnZXR8YWxpYXNdXVxuICAgIGNvbnN0IHdpayA9IHdpdGhpbihcIltbXCIsIFwiXV1cIik7XG4gICAgaWYgKHdpaykge1xuICAgICAgY29uc3QgdGFyZ2V0ID0gd2lrLnNwbGl0KFwifFwiKVswXS50cmltKCk7XG4gICAgICBjb25zdCBkZXN0ID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaXJzdExpbmtwYXRoRGVzdCh0YXJnZXQsIHZpZXc/LmZpbGU/LnBhdGggfHwgXCJcIik7XG4gICAgICBpZiAoZGVzdCkge1xuICAgICAgICBhd2FpdCB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0TGVhZihcInRhYlwiKS5vcGVuRmlsZShkZXN0KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgbmV3IE5vdGljZShgRmlsZSBub3QgZm91bmQ6ICR7dGFyZ2V0fWApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIDIpIE9iamVjdCBsaW5rOiB7e29iamVjdHxhbGlhc319XG4gICAgY29uc3Qgb2JqID0gd2l0aGluKFwie3tcIiwgXCJ9fVwiKTtcbiAgICBpZiAob2JqKSB7XG4gICAgICBjb25zdCB0YXJnZXQgPSBvYmouc3BsaXQoXCJ8XCIpWzBdLnRyaW0oKTtcbiAgICAgIGNvbnN0IGZvdW5kID0gdGhpcy5vYmplY3RJbmRleC5nZXQodGFyZ2V0LnRvTG93ZXJDYXNlKCkpO1xuICAgICAgaWYgKGZvdW5kKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuZ29Ub09iamVjdChmb3VuZC5maWxlUGF0aCwgZm91bmQuc3RhcnRMaW5lKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgbmV3IE5vdGljZShgT2JqZWN0IFwiJHt0YXJnZXR9XCIgbm90IGZvdW5kYCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgbmV3IE5vdGljZShcIk5vIGxpbmsgdW5kZXIgY3Vyc29yXCIpO1xuICB9XG59XG5cbiIsICIvKipcbiAqIFBhcnNlciBmb3IgbXVsdGktb2JqZWN0IG1hcmtkb3duIGZpbGVzLlxuICpcbiAqIEZvcm1hdDpcbiAqICAga2V5OiA8cHJvcGVydHlfbmFtZT5cbiAqXG4gKiAgIC0tLVxuICpcbiAqICAgcHJvcDE6IHZhbHVlMVxuICogICBwcm9wMjogdmFsdWUyXG4gKlxuICogICAtLS1cbiAqXG4gKiAgIHByb3AxOiB2YWx1ZTNcbiAqICAgcHJvcDI6IHZhbHVlNFxuICovXG5cbmV4cG9ydCBpbnRlcmZhY2UgUGFyc2VkT2JqZWN0IHtcbiAgLyoqIFRoZSB2YWx1ZSBvZiB0aGUga2V5IHByb3BlcnR5IC0tIHVzZWQgYXMgdGhlIGxpbmthYmxlIG5hbWUgKi9cbiAga2V5VmFsdWU6IHN0cmluZztcbiAgLyoqXG4gICAqIERpc2FtYmlndWF0ZWQgaWRlbnRpZmllciB1c2VkIGZvciB7e319IGxpbmtzLCBpbmRleCBsb29rdXBzLCBhbmQgZ3JhcGggbGFiZWxzLlxuICAgKiBEZWZhdWx0cyB0byBrZXlWYWx1ZS4gSWYgZHVwbGljYXRlcyBleGlzdDpcbiAgICogICAtIGRpZmZlcmVudCBmaWxlczogXCJrZXlWYWx1ZSAoZmlsZUxhYmVsKVwiXG4gICAqICAgLSBzYW1lIGZpbGU6IFwia2V5VmFsdWUgKHNlY29uZFByb3BlcnR5VmFsdWUpXCJcbiAgICogU2V0IGR1cmluZyBmdWxsUmVmcmVzaCgpIGluIG1haW4udHMuXG4gICAqL1xuICBkaXNwbGF5S2V5OiBzdHJpbmc7XG4gIC8qKiBNYW5kYXRvcnkgbnVtZXJpYyBpZCBmb3IgdGhpcyBvYmplY3QgKi9cbiAgaWQ6IG51bWJlcjtcbiAgLyoqIEFsbCBwcm9wZXJ0aWVzIG9mIHRoaXMgb2JqZWN0IChpbnNlcnRpb24tb3JkZXJlZCkgKi9cbiAgcHJvcGVydGllczogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgLyoqIE9yZGVyZWQgbGlzdCBvZiBwcm9wZXJ0eSBuYW1lcyBhcyB0aGV5IGFwcGVhciBpbiB0aGUgZmlsZSAqL1xuICBwcm9wZXJ0eU9yZGVyOiBzdHJpbmdbXTtcbiAgLyoqIFNvdXJjZSBmaWxlIHBhdGggKi9cbiAgZmlsZVBhdGg6IHN0cmluZztcbiAgLyoqIFNvdXJjZSBmaWxlIGJhc2VuYW1lICh3aXRob3V0IGV4dGVuc2lvbikgKi9cbiAgZmlsZUxhYmVsOiBzdHJpbmc7XG4gIC8qKiAwLWluZGV4ZWQgbGluZSBudW1iZXIgd2hlcmUgdGhpcyBvYmplY3QgYmxvY2sgc3RhcnRzIGluIHRoZSBmaWxlICovXG4gIHN0YXJ0TGluZTogbnVtYmVyO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFBhcnNlZEZpbGUge1xuICAvKiogVGhlIHByb3BlcnR5IG5hbWUgdXNlZCBhcyBrZXkgKi9cbiAga2V5UHJvcGVydHk6IHN0cmluZztcbiAgLyoqIEFsbCBwYXJzZWQgb2JqZWN0cyBpbiB0aGlzIGZpbGUgKi9cbiAgb2JqZWN0czogUGFyc2VkT2JqZWN0W107XG4gIC8qKiBTb3VyY2UgZmlsZSBwYXRoICovXG4gIGZpbGVQYXRoOiBzdHJpbmc7XG59XG5cbi8qKlxuICogUGFyc2UgYSBtdWx0aS1vYmplY3QgbWFya2Rvd24gZmlsZS5cbiAqIFJldHVybnMgbnVsbCBpZiB0aGUgZmlsZSBkb2Vzbid0IGZvbGxvdyB0aGUgZXhwZWN0ZWQgZm9ybWF0LlxuICpcbiAqIFNraXBzIFlBTUwgZnJvbnRtYXR0ZXIgKGlmIHByZXNlbnQpIGJlZm9yZSBsb29raW5nIGZvciB0aGVcbiAqIGBrZXk6IDxwcm9wZXJ0eT5gIGhlYWRlciBhbmQgYC0tLWAgc2VwYXJhdGVkIG9iamVjdCBibG9ja3MuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZU11bHRpT2JqZWN0RmlsZShcbiAgY29udGVudDogc3RyaW5nLFxuICBmaWxlUGF0aDogc3RyaW5nXG4pOiBQYXJzZWRGaWxlIHwgbnVsbCB7XG4gIGNvbnN0IGxpbmVzID0gY29udGVudC5zcGxpdChcIlxcblwiKTtcblxuICAvLyBTa2lwIFlBTUwgZnJvbnRtYXR0ZXIgKG9wZW5pbmcgLS0tIG9uIGZpcnN0IGxpbmUsIGNsb3NpbmcgLS0tIGxhdGVyKVxuICBsZXQgc3RhcnRJZHggPSAwO1xuICBpZiAobGluZXMubGVuZ3RoID4gMCAmJiBsaW5lc1swXS50cmltKCkgPT09IFwiLS0tXCIpIHtcbiAgICBmb3IgKGxldCBpID0gMTsgaSA8IGxpbmVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAobGluZXNbaV0udHJpbSgpID09PSBcIi0tLVwiKSB7XG4gICAgICAgIHN0YXJ0SWR4ID0gaSArIDE7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIEZpcnN0IG5vbi1lbXB0eSBsaW5lIChhZnRlciBmcm9udG1hdHRlcikgc2hvdWxkIGJlIFwia2V5OiA8cHJvcGVydHk+XCJcbiAgLy8gQnV0IHNraXAgYmFyZSAjdGFnIGxpbmVzIChlLmcuICNvYmplY3QtbGlua3MpIHRoYXQgcHJlY2VkZSBpdFxuICBsZXQga2V5TGluZSA9IFwiXCI7XG4gIGZvciAobGV0IGkgPSBzdGFydElkeDsgaSA8IGxpbmVzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmVzW2ldLnRyaW0oKTtcbiAgICBpZiAodHJpbW1lZC5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuICAgIC8vIFNraXAgYmFyZSB0YWcgbGluZXMgbGlrZSBcIiNvYmplY3QtbGlua3NcIlxuICAgIGlmICh0cmltbWVkLnN0YXJ0c1dpdGgoXCIjXCIpICYmICF0cmltbWVkLmluY2x1ZGVzKFwiOlwiKSkgY29udGludWU7XG4gICAga2V5TGluZSA9IHRyaW1tZWQ7XG4gICAgYnJlYWs7XG4gIH1cblxuICBjb25zdCBrZXlNYXRjaCA9IGtleUxpbmUubWF0Y2goL15rZXk6XFxzKiguKykkL2kpO1xuICBpZiAoIWtleU1hdGNoKSByZXR1cm4gbnVsbDtcblxuICBjb25zdCBrZXlQcm9wZXJ0eSA9IGtleU1hdGNoWzFdLnRyaW0oKTtcbiAgY29uc3QgZmlsZUxhYmVsID0gZmlsZVBhdGgucmVwbGFjZSgvXi4qXFwvLywgXCJcIikucmVwbGFjZSgvXFwubWQkL2ksIFwiXCIpO1xuXG4gIC8vIFdhbGsgbGluZXMgKGFmdGVyIGZyb250bWF0dGVyKSB0byBmaW5kIC0tLSBzZXBhcmF0b3JzIGFuZCBidWlsZCBvYmplY3RzXG4gIGNvbnN0IG9iamVjdHM6IFBhcnNlZE9iamVjdFtdID0gW107XG4gIGxldCBjdXJyZW50QmxvY2s6IHsgbGluZXM6IHN0cmluZ1tdOyBzdGFydExpbmU6IG51bWJlciB9IHwgbnVsbCA9IG51bGw7XG4gIGxldCBwYXNzZWRGaXJzdFNlcGFyYXRvciA9IGZhbHNlO1xuXG4gIGZvciAobGV0IGkgPSBzdGFydElkeDsgaSA8IGxpbmVzLmxlbmd0aDsgaSsrKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IGxpbmVzW2ldLnRyaW0oKTtcblxuICAgIGlmICh0cmltbWVkID09PSBcIi0tLVwiKSB7XG4gICAgICAvLyBGbHVzaCB0aGUgY3VycmVudCBibG9jayBpZiB3ZSBoYXZlIG9uZVxuICAgICAgaWYgKGN1cnJlbnRCbG9jayAmJiBwYXNzZWRGaXJzdFNlcGFyYXRvcikge1xuICAgICAgICBjb25zdCBvYmogPSBwYXJzZUJsb2NrKGN1cnJlbnRCbG9jaywga2V5UHJvcGVydHksIGZpbGVQYXRoLCBmaWxlTGFiZWwpO1xuICAgICAgICBpZiAob2JqKSBvYmplY3RzLnB1c2gob2JqKTtcbiAgICAgIH1cbiAgICAgIHBhc3NlZEZpcnN0U2VwYXJhdG9yID0gdHJ1ZTtcbiAgICAgIGN1cnJlbnRCbG9jayA9IHsgbGluZXM6IFtdLCBzdGFydExpbmU6IGkgKyAxIH07XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoY3VycmVudEJsb2NrICYmIHBhc3NlZEZpcnN0U2VwYXJhdG9yKSB7XG4gICAgICBjdXJyZW50QmxvY2subGluZXMucHVzaCh0cmltbWVkKTtcbiAgICB9XG4gIH1cblxuICAvLyBGbHVzaCB0aGUgbGFzdCBibG9ja1xuICBpZiAoY3VycmVudEJsb2NrICYmIHBhc3NlZEZpcnN0U2VwYXJhdG9yKSB7XG4gICAgY29uc3Qgb2JqID0gcGFyc2VCbG9jayhjdXJyZW50QmxvY2ssIGtleVByb3BlcnR5LCBmaWxlUGF0aCwgZmlsZUxhYmVsKTtcbiAgICBpZiAob2JqKSBvYmplY3RzLnB1c2gob2JqKTtcbiAgfVxuXG4gIGlmIChvYmplY3RzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgcmV0dXJuIHsga2V5UHJvcGVydHksIG9iamVjdHMsIGZpbGVQYXRoIH07XG59XG5cbmZ1bmN0aW9uIHBhcnNlQmxvY2soXG4gIGJsb2NrOiB7IGxpbmVzOiBzdHJpbmdbXTsgc3RhcnRMaW5lOiBudW1iZXIgfSxcbiAga2V5UHJvcGVydHk6IHN0cmluZyxcbiAgZmlsZVBhdGg6IHN0cmluZyxcbiAgZmlsZUxhYmVsOiBzdHJpbmdcbik6IFBhcnNlZE9iamVjdCB8IG51bGwge1xuICBjb25zdCBwcm9wZXJ0aWVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XG4gIGNvbnN0IHByb3BlcnR5T3JkZXI6IHN0cmluZ1tdID0gW107XG5cbiAgZm9yIChjb25zdCBsaW5lIG9mIGJsb2NrLmxpbmVzKSB7XG4gICAgaWYgKCFsaW5lKSBjb250aW51ZTtcbiAgICBjb25zdCBjb2xvbkluZGV4ID0gbGluZS5pbmRleE9mKFwiOlwiKTtcbiAgICBpZiAoY29sb25JbmRleCA9PT0gLTEpIGNvbnRpbnVlO1xuXG4gICAgY29uc3QgcHJvcCA9IGxpbmUuc3Vic3RyaW5nKDAsIGNvbG9uSW5kZXgpLnRyaW0oKTtcbiAgICBjb25zdCB2YWwgPSBsaW5lLnN1YnN0cmluZyhjb2xvbkluZGV4ICsgMSkudHJpbSgpO1xuICAgIGlmIChwcm9wICYmIHZhbCkge1xuICAgICAgcHJvcGVydGllc1twcm9wXSA9IHZhbDtcbiAgICAgIHByb3BlcnR5T3JkZXIucHVzaChwcm9wKTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBrZXlWYWx1ZSA9IHByb3BlcnRpZXNba2V5UHJvcGVydHldO1xuICBpZiAoIWtleVZhbHVlKSByZXR1cm4gbnVsbDtcblxuICAvLyBNYW5kYXRvcnkgaWQgcHJvcGVydHk6IG11c3QgYmUgcHJlc2VudCBhbmQgbnVtZXJpY1xuICBjb25zdCByYXdJZCA9IHByb3BlcnRpZXNbXCJpZFwiXTtcbiAgaWYgKCFyYXdJZCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGlkID0gTnVtYmVyKHJhd0lkKTtcbiAgaWYgKGlzTmFOKGlkKSkgcmV0dXJuIG51bGw7XG5cbiAgcmV0dXJuIHtcbiAgICBrZXlWYWx1ZSxcbiAgICBkaXNwbGF5S2V5OiBrZXlWYWx1ZSwgLy8gZGVmYXVsdDsgZGlzYW1iaWd1YXRlZCBsYXRlciBpbiBmdWxsUmVmcmVzaCgpXG4gICAgaWQsXG4gICAgcHJvcGVydGllcyxcbiAgICBwcm9wZXJ0eU9yZGVyLFxuICAgIGZpbGVQYXRoLFxuICAgIGZpbGVMYWJlbCxcbiAgICBzdGFydExpbmU6IGJsb2NrLnN0YXJ0TGluZSxcbiAgfTtcbn1cblxuLyoqXG4gKiBHZXQgdGhlIHZhbHVlIG9mIHRoZSBcInNlY29uZCBwcm9wZXJ0eVwiIG9mIGFuIG9iamVjdCBmb3IgZGlzYW1iaWd1YXRpb24uXG4gKiBUaGlzIGlzIHRoZSBmaXJzdCBwcm9wZXJ0eSB0aGF0IGlzIG5vdCB0aGUga2V5IHByb3BlcnR5IGFuZCBub3QgXCJpZFwiLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0U2Vjb25kUHJvcGVydHkoXG4gIG9iajogUGFyc2VkT2JqZWN0LFxuICBrZXlQcm9wZXJ0eTogc3RyaW5nXG4pOiBzdHJpbmcgfCBudWxsIHtcbiAgZm9yIChjb25zdCBwcm9wIG9mIG9iai5wcm9wZXJ0eU9yZGVyKSB7XG4gICAgaWYgKHByb3AgPT09IGtleVByb3BlcnR5IHx8IHByb3AgPT09IFwiaWRcIikgY29udGludWU7XG4gICAgY29uc3QgdmFsID0gb2JqLnByb3BlcnRpZXNbcHJvcF07XG4gICAgaWYgKHZhbCkgcmV0dXJuIHZhbDtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBFeHRyYWN0IGFsbCB7e29iamVjdCBsaW5rc319IGZyb20gY29udGVudC5cbiAqIFJldHVybnMgdGhlIGxpbmsgdGFyZ2V0IG5hbWVzICh3aXRob3V0IHt7IH19KS5cbiAqIEhhbmRsZXMgYWxpYXNlcyBsaWtlIHt7dGFyZ2V0fGFsaWFzfX0gYnkgcmV0dXJuaW5nIGp1c3QgXCJ0YXJnZXRcIi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RPYmplY3RMaW5rcyhjb250ZW50OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IGxpbmtzOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCByZWdleCA9IC9cXHtcXHsoW159XSspXFx9XFx9L2c7XG4gIGxldCBtYXRjaDtcblxuICB3aGlsZSAoKG1hdGNoID0gcmVnZXguZXhlYyhjb250ZW50KSkgIT09IG51bGwpIHtcbiAgICBsZXQgbGlua1RhcmdldCA9IG1hdGNoWzFdO1xuICAgIGNvbnN0IHBpcGVJbmRleCA9IGxpbmtUYXJnZXQuaW5kZXhPZihcInxcIik7XG4gICAgaWYgKHBpcGVJbmRleCAhPT0gLTEpIHtcbiAgICAgIGxpbmtUYXJnZXQgPSBsaW5rVGFyZ2V0LnN1YnN0cmluZygwLCBwaXBlSW5kZXgpO1xuICAgIH1cbiAgICBsaW5rcy5wdXNoKGxpbmtUYXJnZXQudHJpbSgpKTtcbiAgfVxuXG4gIHJldHVybiBsaW5rcztcbn1cblxuLyoqXG4gKiBFeHRyYWN0IGFsbCBbW3dpa2lsaW5rc11dIGZyb20gY29udGVudC5cbiAqIFJldHVybnMgdGhlIGxpbmsgdGFyZ2V0IG5hbWVzICh3aXRob3V0IFtbIF1dKS5cbiAqIEhhbmRsZXMgYWxpYXNlcyBsaWtlIFtbdGFyZ2V0fGFsaWFzXV0gYnkgcmV0dXJuaW5nIGp1c3QgXCJ0YXJnZXRcIi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RXaWtpbGlua3MoY29udGVudDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBsaW5rczogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgcmVnZXggPSAvXFxbXFxbKFteXFxdXSspXFxdXFxdL2c7XG4gIGxldCBtYXRjaDtcblxuICB3aGlsZSAoKG1hdGNoID0gcmVnZXguZXhlYyhjb250ZW50KSkgIT09IG51bGwpIHtcbiAgICBsZXQgbGlua1RhcmdldCA9IG1hdGNoWzFdO1xuICAgIGNvbnN0IHBpcGVJbmRleCA9IGxpbmtUYXJnZXQuaW5kZXhPZihcInxcIik7XG4gICAgaWYgKHBpcGVJbmRleCAhPT0gLTEpIHtcbiAgICAgIGxpbmtUYXJnZXQgPSBsaW5rVGFyZ2V0LnN1YnN0cmluZygwLCBwaXBlSW5kZXgpO1xuICAgIH1cbiAgICBsaW5rcy5wdXNoKGxpbmtUYXJnZXQudHJpbSgpKTtcbiAgfVxuXG4gIHJldHVybiBsaW5rcztcbn1cbiIsICJpbXBvcnQgeyBQYXJzZWRGaWxlLCBleHRyYWN0T2JqZWN0TGlua3MsIGV4dHJhY3RXaWtpbGlua3MgfSBmcm9tIFwiLi9wYXJzZXJcIjtcblxuZXhwb3J0IGludGVyZmFjZSBHcmFwaE5vZGUge1xuICBpZDogc3RyaW5nO1xuICBsYWJlbDogc3RyaW5nO1xuICAvKiogXCJvYmplY3RcIiBmb3IgbXVsdGktb2JqZWN0IGVudHJpZXMsIFwiZmlsZVwiIGZvciByZWd1bGFyIHZhdWx0IGZpbGVzICovXG4gIHR5cGU6IFwib2JqZWN0XCIgfCBcImZpbGVcIjtcbiAgZmlsZVBhdGg6IHN0cmluZztcbiAgZmlsZUxhYmVsOiBzdHJpbmc7XG4gIHByb3BlcnRpZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIC8qKiAwLWluZGV4ZWQgc3RhcnQgbGluZSBpbiB0aGUgc291cmNlIGZpbGUgKG9iamVjdHMgb25seSkgKi9cbiAgc3RhcnRMaW5lOiBudW1iZXI7XG4gIC8qKiBOdW1iZXIgb2YgY29ubmVjdGlvbnMgKi9cbiAgY29ubmVjdGlvbnM6IG51bWJlcjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBHcmFwaEVkZ2Uge1xuICBzb3VyY2U6IHN0cmluZztcbiAgdGFyZ2V0OiBzdHJpbmc7XG4gIC8qKiBcIm9iamVjdFwiIGlmIHRoaXMgZWRnZSBpbnZvbHZlcyBhIHt7fX0gbGluaywgXCJ3aWtpXCIgZm9yIG5hdGl2ZSBbW11dIGxpbmtzICovXG4gIGVkZ2VUeXBlOiBcIm9iamVjdFwiIHwgXCJ3aWtpXCI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgR3JhcGhEYXRhIHtcbiAgbm9kZXM6IEdyYXBoTm9kZVtdO1xuICBlZGdlczogR3JhcGhFZGdlW107XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgVmF1bHRGaWxlIHtcbiAgcGF0aDogc3RyaW5nO1xuICBiYXNlbmFtZTogc3RyaW5nO1xuICBjb250ZW50OiBzdHJpbmc7XG59XG5cbi8qKlxuICogQnVpbGQgdGhlIGZ1bGwgZ3JhcGggZnJvbSB0aGUgdmF1bHQuXG4gKlxuICogTm9kZXM6XG4gKiAgIC0gRWFjaCBvYmplY3QgaW4gYSBtdWx0aS1vYmplY3QgZmlsZSAtPiB0eXBlIFwib2JqZWN0XCJcbiAqICAgLSBFYWNoIHJlZ3VsYXIgdmF1bHQgZmlsZSB0aGF0IHBhcnRpY2lwYXRlcyBpbiBhbnkgbGluayAtPiB0eXBlIFwiZmlsZVwiXG4gKlxuICogRWRnZXM6XG4gKiAgIC0gZmlsZSAtPiBvYmplY3QgIHdoZW4gYSBmaWxlIGNvbnRhaW5zIHt7T2JqZWN0S2V5fX1cbiAqICAgLSBmaWxlIC0+IGZpbGUgICAgd2hlbiBhIGZpbGUgY29udGFpbnMgW1tPdGhlckZpbGVdXSAobmF0aXZlIHdpa2lsaW5rcylcbiAqICAgLSBvYmplY3QgLT4gb2JqZWN0IHdoZW4gYW4gb2JqZWN0J3MgcHJvcGVydHkgdmFsdWUgY29udGFpbnMge3tPdGhlck9iamVjdH19XG4gKlxuICogTXVsdGktb2JqZWN0IHNvdXJjZSBmaWxlcyAoZS5nLiwgRmlsbXMubWQpIGRvIE5PVCBhcHBlYXIgYXMgZmlsZSBub2RlcztcbiAqIG9ubHkgdGhlaXIgaW5kaXZpZHVhbCBvYmplY3RzIGRvLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRHcmFwaChcbiAgcGFyc2VkRmlsZXM6IFBhcnNlZEZpbGVbXSxcbiAgYWxsRmlsZXM6IFZhdWx0RmlsZVtdXG4pOiBHcmFwaERhdGEge1xuICBjb25zdCBub2RlczogR3JhcGhOb2RlW10gPSBbXTtcbiAgY29uc3QgZWRnZXM6IEdyYXBoRWRnZVtdID0gW107XG4gIGNvbnN0IGVkZ2VTZXQgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgY29uc3Qgbm9kZU1hcCA9IG5ldyBNYXA8c3RyaW5nLCBHcmFwaE5vZGU+KCk7XG5cbiAgLy8gUGF0aHMgb2YgbXVsdGktb2JqZWN0IHNvdXJjZSBmaWxlcyAtLSB0aGVzZSBhcmUgcmVwbGFjZWQgYnkgdGhlaXIgb2JqZWN0c1xuICBjb25zdCBtdWx0aU9iamVjdFBhdGhzID0gbmV3IFNldChwYXJzZWRGaWxlcy5tYXAoKGYpID0+IGYuZmlsZVBhdGgpKTtcblxuICAvLyBNYXA6IGxvd2VyY2FzZSBrZXkgdmFsdWUgLT4gb2JqZWN0IG5vZGUgaWRcbiAgY29uc3Qgb2JqS2V5VG9Ob2RlSWQgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpO1xuXG4gIC8vIE1hcDogbG93ZXJjYXNlIGZpbGUgYmFzZW5hbWUgLT4gZmlsZSBwYXRoIChmb3IgcmVzb2x2aW5nIFtbd2lraWxpbmtzXV0pXG4gIGNvbnN0IGJhc2VuYW1lVG9QYXRoID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKTtcbiAgZm9yIChjb25zdCBmIG9mIGFsbEZpbGVzKSB7XG4gICAgYmFzZW5hbWVUb1BhdGguc2V0KGYuYmFzZW5hbWUudG9Mb3dlckNhc2UoKSwgZi5wYXRoKTtcbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCAxLiBDcmVhdGUgb2JqZWN0IG5vZGVzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuICBmb3IgKGNvbnN0IGZpbGUgb2YgcGFyc2VkRmlsZXMpIHtcbiAgICBmb3IgKGNvbnN0IG9iaiBvZiBmaWxlLm9iamVjdHMpIHtcbiAgICAgIGNvbnN0IG5vZGVJZCA9IGBvYmo6OiR7ZmlsZS5maWxlUGF0aH06OiR7b2JqLmRpc3BsYXlLZXl9YDtcbiAgICAgIGNvbnN0IG5vZGU6IEdyYXBoTm9kZSA9IHtcbiAgICAgICAgaWQ6IG5vZGVJZCxcbiAgICAgICAgbGFiZWw6IG9iai5kaXNwbGF5S2V5LFxuICAgICAgICB0eXBlOiBcIm9iamVjdFwiLFxuICAgICAgICBmaWxlUGF0aDogb2JqLmZpbGVQYXRoLFxuICAgICAgICBmaWxlTGFiZWw6IG9iai5maWxlTGFiZWwsXG4gICAgICAgIHByb3BlcnRpZXM6IG9iai5wcm9wZXJ0aWVzLFxuICAgICAgICBzdGFydExpbmU6IG9iai5zdGFydExpbmUsXG4gICAgICAgIGNvbm5lY3Rpb25zOiAwLFxuICAgICAgfTtcbiAgICAgIG5vZGVzLnB1c2gobm9kZSk7XG4gICAgICBub2RlTWFwLnNldChub2RlSWQsIG5vZGUpO1xuICAgICAgLy8gUmVnaXN0ZXIgYnkgZGlzcGxheUtleSAocHJpbWFyeSBsb29rdXAgZm9yIGRpc2FtYmlndWF0ZWQgbmFtZXMpXG4gICAgICBvYmpLZXlUb05vZGVJZC5zZXQob2JqLmRpc3BsYXlLZXkudG9Mb3dlckNhc2UoKSwgbm9kZUlkKTtcbiAgICAgIC8vIEFsc28gcmVnaXN0ZXIgYnkgcGxhaW4ga2V5VmFsdWUgaWYgbm90IGFscmVhZHkgdGFrZW4gKGJhY2t3YXJkcyBjb21wYXQpXG4gICAgICBjb25zdCBwbGFpbiA9IG9iai5rZXlWYWx1ZS50b0xvd2VyQ2FzZSgpO1xuICAgICAgaWYgKCFvYmpLZXlUb05vZGVJZC5oYXMocGxhaW4pKSB7XG4gICAgICAgIG9iaktleVRvTm9kZUlkLnNldChwbGFpbiwgbm9kZUlkKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyBIZWxwZXI6IGdldCBvciBjcmVhdGUgYSBmaWxlIG5vZGVcbiAgZnVuY3Rpb24gZW5zdXJlRmlsZU5vZGUocGF0aDogc3RyaW5nLCBiYXNlbmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBub2RlSWQgPSBgZmlsZTo6JHtwYXRofWA7XG4gICAgaWYgKCFub2RlTWFwLmhhcyhub2RlSWQpKSB7XG4gICAgICBjb25zdCBub2RlOiBHcmFwaE5vZGUgPSB7XG4gICAgICAgIGlkOiBub2RlSWQsXG4gICAgICAgIGxhYmVsOiBiYXNlbmFtZSxcbiAgICAgICAgdHlwZTogXCJmaWxlXCIsXG4gICAgICAgIGZpbGVQYXRoOiBwYXRoLFxuICAgICAgICBmaWxlTGFiZWw6IGJhc2VuYW1lLFxuICAgICAgICBwcm9wZXJ0aWVzOiB7fSxcbiAgICAgICAgc3RhcnRMaW5lOiAwLFxuICAgICAgICBjb25uZWN0aW9uczogMCxcbiAgICAgIH07XG4gICAgICBub2Rlcy5wdXNoKG5vZGUpO1xuICAgICAgbm9kZU1hcC5zZXQobm9kZUlkLCBub2RlKTtcbiAgICB9XG4gICAgcmV0dXJuIG5vZGVJZDtcbiAgfVxuXG4gIC8vIEhlbHBlcjogYWRkIGFuIGVkZ2UgKGRlZHVwbGljYXRlZClcbiAgZnVuY3Rpb24gYWRkRWRnZShzcmM6IHN0cmluZywgdGd0OiBzdHJpbmcsIHR5cGU6IFwib2JqZWN0XCIgfCBcIndpa2lcIik6IHZvaWQge1xuICAgIGNvbnN0IGVkZ2VJZCA9IFtzcmMsIHRndF0uc29ydCgpLmpvaW4oXCItLVwiKTtcbiAgICBpZiAoZWRnZVNldC5oYXMoZWRnZUlkKSkgcmV0dXJuO1xuICAgIGVkZ2VTZXQuYWRkKGVkZ2VJZCk7XG4gICAgZWRnZXMucHVzaCh7IHNvdXJjZTogc3JjLCB0YXJnZXQ6IHRndCwgZWRnZVR5cGU6IHR5cGUgfSk7XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgMi4gU2NhbiBhbGwgZmlsZXMgZm9yIGxpbmtzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuICBmb3IgKGNvbnN0IGZpbGUgb2YgYWxsRmlsZXMpIHtcbiAgICAvLyBTa2lwIG11bHRpLW9iamVjdCBzb3VyY2UgZmlsZXMgKHRoZWlyIG9iamVjdHMgYXJlIGFscmVhZHkgbm9kZXMpXG4gICAgaWYgKG11bHRpT2JqZWN0UGF0aHMuaGFzKGZpbGUucGF0aCkpIGNvbnRpbnVlO1xuXG4gICAgY29uc3Qgb2JqZWN0TGlua3MgPSBleHRyYWN0T2JqZWN0TGlua3MoZmlsZS5jb250ZW50KTtcbiAgICBjb25zdCB3aWtpbGlua3MgPSBleHRyYWN0V2lraWxpbmtzKGZpbGUuY29udGVudCk7XG5cbiAgICBsZXQgZmlsZU5vZGVJZDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG5cbiAgICAvLyB7e29iamVjdCBsaW5rc319IC0+IGZpbGUtdG8tb2JqZWN0IGVkZ2VzXG4gICAgZm9yIChjb25zdCBsaW5rIG9mIG9iamVjdExpbmtzKSB7XG4gICAgICBjb25zdCB0YXJnZXRPYmpJZCA9IG9iaktleVRvTm9kZUlkLmdldChsaW5rLnRvTG93ZXJDYXNlKCkpO1xuICAgICAgaWYgKHRhcmdldE9iaklkKSB7XG4gICAgICAgIGlmICghZmlsZU5vZGVJZCkgZmlsZU5vZGVJZCA9IGVuc3VyZUZpbGVOb2RlKGZpbGUucGF0aCwgZmlsZS5iYXNlbmFtZSk7XG4gICAgICAgIGFkZEVkZ2UoZmlsZU5vZGVJZCwgdGFyZ2V0T2JqSWQsIFwib2JqZWN0XCIpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFtbd2lraWxpbmtzXV0gLT4gZmlsZS10by1maWxlIGVkZ2VzXG4gICAgZm9yIChjb25zdCBsaW5rIG9mIHdpa2lsaW5rcykge1xuICAgICAgY29uc3QgdGFyZ2V0UGF0aCA9IGJhc2VuYW1lVG9QYXRoLmdldChsaW5rLnRvTG93ZXJDYXNlKCkpO1xuICAgICAgaWYgKCF0YXJnZXRQYXRoKSBjb250aW51ZTtcbiAgICAgIC8vIERvbid0IGxpbmsgdG8gbXVsdGktb2JqZWN0IHNvdXJjZSBmaWxlcyBhcyBmaWxlIG5vZGVzXG4gICAgICBpZiAobXVsdGlPYmplY3RQYXRocy5oYXModGFyZ2V0UGF0aCkpIGNvbnRpbnVlO1xuXG4gICAgICAvLyBGaW5kIHRoZSB0YXJnZXQgZmlsZSB0byBnZXQgaXRzIGJhc2VuYW1lXG4gICAgICBjb25zdCB0YXJnZXRGaWxlID0gYWxsRmlsZXMuZmluZCgoZikgPT4gZi5wYXRoID09PSB0YXJnZXRQYXRoKTtcbiAgICAgIGlmICghdGFyZ2V0RmlsZSkgY29udGludWU7XG5cbiAgICAgIGlmICghZmlsZU5vZGVJZCkgZmlsZU5vZGVJZCA9IGVuc3VyZUZpbGVOb2RlKGZpbGUucGF0aCwgZmlsZS5iYXNlbmFtZSk7XG4gICAgICBjb25zdCB0YXJnZXRGaWxlSWQgPSBlbnN1cmVGaWxlTm9kZSh0YXJnZXRQYXRoLCB0YXJnZXRGaWxlLmJhc2VuYW1lKTtcblxuICAgICAgaWYgKGZpbGVOb2RlSWQgIT09IHRhcmdldEZpbGVJZCkge1xuICAgICAgICBhZGRFZGdlKGZpbGVOb2RlSWQsIHRhcmdldEZpbGVJZCwgXCJ3aWtpXCIpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCAzLiBPYmplY3QtdG8tb2JqZWN0IGxpbmtzIHZpYSB7e319IGluIHByb3BlcnR5IHZhbHVlcyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcbiAgZm9yIChjb25zdCBmaWxlIG9mIHBhcnNlZEZpbGVzKSB7XG4gICAgZm9yIChjb25zdCBvYmogb2YgZmlsZS5vYmplY3RzKSB7XG4gICAgICBjb25zdCBzcmNJZCA9IGBvYmo6OiR7ZmlsZS5maWxlUGF0aH06OiR7b2JqLmRpc3BsYXlLZXl9YDtcbiAgICAgIGZvciAoY29uc3QgdmFsIG9mIE9iamVjdC52YWx1ZXMob2JqLnByb3BlcnRpZXMpKSB7XG4gICAgICAgIGZvciAoY29uc3QgbGluayBvZiBleHRyYWN0T2JqZWN0TGlua3ModmFsKSkge1xuICAgICAgICAgIGNvbnN0IHRndElkID0gb2JqS2V5VG9Ob2RlSWQuZ2V0KGxpbmsudG9Mb3dlckNhc2UoKSk7XG4gICAgICAgICAgaWYgKHRndElkICYmIHRndElkICE9PSBzcmNJZCkge1xuICAgICAgICAgICAgYWRkRWRnZShzcmNJZCwgdGd0SWQsIFwib2JqZWN0XCIpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCA0LiBDb3VudCBjb25uZWN0aW9ucyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcbiAgZm9yIChjb25zdCBlZGdlIG9mIGVkZ2VzKSB7XG4gICAgY29uc3Qgc3JjID0gbm9kZU1hcC5nZXQoZWRnZS5zb3VyY2UpO1xuICAgIGNvbnN0IHRndCA9IG5vZGVNYXAuZ2V0KGVkZ2UudGFyZ2V0KTtcbiAgICBpZiAoc3JjKSBzcmMuY29ubmVjdGlvbnMrKztcbiAgICBpZiAodGd0KSB0Z3QuY29ubmVjdGlvbnMrKztcbiAgfVxuXG4gIHJldHVybiB7IG5vZGVzLCBlZGdlcyB9O1xufVxuIiwgImltcG9ydCB7IEl0ZW1WaWV3LCBXb3Jrc3BhY2VMZWFmIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgeyBHcmFwaERhdGEgfSBmcm9tIFwiLi9ncmFwaC1kYXRhXCI7XG5pbXBvcnQgeyBDb25maWdQYW5lbCwgR3JhcGhDb25maWcsIERFRkFVTFRfQ09ORklHIH0gZnJvbSBcIi4vc2V0dGluZ3NcIjtcbmltcG9ydCB7XG4gIHNlbGVjdCxcbiAgZm9yY2VTaW11bGF0aW9uLFxuICBmb3JjZUxpbmssXG4gIGZvcmNlTWFueUJvZHksXG4gIGZvcmNlQ29sbGlkZSxcbiAgZm9yY2VYLFxuICBmb3JjZVksXG4gIHpvb20sXG4gIHpvb21JZGVudGl0eSxcbiAgem9vbVRyYW5zZm9ybSxcbiAgWm9vbUJlaGF2aW9yLFxuICBab29tVHJhbnNmb3JtLFxuICBTaW11bGF0aW9uLFxuICBTaW11bGF0aW9uTm9kZURhdHVtLFxuICBTaW11bGF0aW9uTGlua0RhdHVtLFxufSBmcm9tIFwiZDNcIjtcblxuZXhwb3J0IGNvbnN0IFZJRVdfVFlQRSA9IFwib2JqZWN0LWxpbmtzLWdyYXBoXCI7XG5cbi8qIFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFxuICAgU2ltdWxhdGlvbiBOb2RlL0VkZ2UgVHlwZXNcbiAgIFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MCAqL1xuXG50eXBlIE5vZGVUeXBlID0gXCJvYmplY3RcIiB8IFwiZmlsZVwiO1xuXG50eXBlIFNpbU5vZGUgPSBTaW11bGF0aW9uTm9kZURhdHVtICYge1xuICBpZDogc3RyaW5nO1xuICBsYWJlbDogc3RyaW5nO1xuICB0eXBlOiBOb2RlVHlwZTtcbiAgZmlsZVBhdGg6IHN0cmluZztcbiAgZmlsZUxhYmVsOiBzdHJpbmc7XG4gIHByb3BlcnRpZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIHN0YXJ0TGluZTogbnVtYmVyO1xuICBjb25uZWN0aW9uczogbnVtYmVyO1xuICByYWRpdXM6IG51bWJlcjtcbiAgLyoqIFRydWUgd2hlbiBub2RlIGhhZCAwIGNvbm5lY3Rpb25zIGluIHRoZSAqYmFzZSogZ3JhcGggKGV4Y2x1ZGluZyBvcHRpb25hbCBmb2xkZXIgZWRnZXMpLiAqL1xuICBpc09ycGhhbjogYm9vbGVhbjtcbiAgLyoqIEN1cnJlbnQgdmlzdWFsIGFscGhhIChpbnRlcnBvbGF0ZWQgZm9yIHNtb290aCB0cmFuc2l0aW9ucykgKi9cbiAgYWxwaGE6IG51bWJlcjtcbiAgLyoqIFRhcmdldCBhbHBoYSBiYXNlZCBvbiBoaWdobGlnaHQgc3RhdGUgKi9cbiAgdGFyZ2V0QWxwaGE6IG51bWJlcjtcbiAgLyoqIGQzIGZpeGVkIHBvc2l0aW9uICovXG4gIGZ4OiBudW1iZXIgfCBudWxsO1xuICBmeTogbnVtYmVyIHwgbnVsbDtcbn07XG5cbnR5cGUgU2ltRWRnZSA9IFNpbXVsYXRpb25MaW5rRGF0dW08U2ltTm9kZT4gJiB7XG4gIGVkZ2VUeXBlOiBcIm9iamVjdFwiIHwgXCJ3aWtpXCI7XG4gIC8qKiBDdXJyZW50IHZpc3VhbCBhbHBoYSAqL1xuICBhbHBoYTogbnVtYmVyO1xuICAvKiogVGFyZ2V0IGFscGhhICovXG4gIHRhcmdldEFscGhhOiBudW1iZXI7XG59O1xuXG4vKiBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcbiAgIENvbG9yIEhlbHBlcnNcbiAgIFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MCAqL1xuXG5mdW5jdGlvbiBwYXJzZUNvbG9yKGNzczogc3RyaW5nKTogW251bWJlciwgbnVtYmVyLCBudW1iZXJdIHtcbiAgaWYgKGNzcy5zdGFydHNXaXRoKFwiI1wiKSkge1xuICAgIGNvbnN0IGhleCA9IGNzcy5zbGljZSgxKTtcbiAgICBpZiAoaGV4Lmxlbmd0aCA9PT0gMykge1xuICAgICAgcmV0dXJuIFtcbiAgICAgICAgcGFyc2VJbnQoaGV4WzBdICsgaGV4WzBdLCAxNikgLyAyNTUsXG4gICAgICAgIHBhcnNlSW50KGhleFsxXSArIGhleFsxXSwgMTYpIC8gMjU1LFxuICAgICAgICBwYXJzZUludChoZXhbMl0gKyBoZXhbMl0sIDE2KSAvIDI1NSxcbiAgICAgIF07XG4gICAgfVxuICAgIHJldHVybiBbXG4gICAgICBwYXJzZUludChoZXguc2xpY2UoMCwgMiksIDE2KSAvIDI1NSxcbiAgICAgIHBhcnNlSW50KGhleC5zbGljZSgyLCA0KSwgMTYpIC8gMjU1LFxuICAgICAgcGFyc2VJbnQoaGV4LnNsaWNlKDQsIDYpLCAxNikgLyAyNTUsXG4gICAgXTtcbiAgfVxuICBjb25zdCBtID0gY3NzLm1hdGNoKC9yZ2JhP1xcKFxccyooXFxkKyksXFxzKihcXGQrKSxcXHMqKFxcZCspLyk7XG4gIGlmIChtKSByZXR1cm4gW3BhcnNlSW50KG1bMV0pIC8gMjU1LCBwYXJzZUludChtWzJdKSAvIDI1NSwgcGFyc2VJbnQobVszXSkgLyAyNTVdO1xuICByZXR1cm4gWzAuNiwgMC42LCAwLjZdO1xufVxuXG5mdW5jdGlvbiBnZXRUaGVtZUNvbG9yKGVsOiBIVE1MRWxlbWVudCwgdmFyTmFtZTogc3RyaW5nLCBmYWxsYmFjazogc3RyaW5nKTogW251bWJlciwgbnVtYmVyLCBudW1iZXJdIHtcbiAgY29uc3Qgc3R5bGUgPSBnZXRDb21wdXRlZFN0eWxlKGVsKTtcbiAgY29uc3QgdmFsID0gc3R5bGUuZ2V0UHJvcGVydHlWYWx1ZSh2YXJOYW1lKS50cmltKCk7XG4gIHJldHVybiBwYXJzZUNvbG9yKHZhbCB8fCBmYWxsYmFjayk7XG59XG5cbmZ1bmN0aW9uIGNvbG9yVG9DU1MoYzogW251bWJlciwgbnVtYmVyLCBudW1iZXJdKTogc3RyaW5nIHtcbiAgcmV0dXJuIGByZ2IoJHtNYXRoLnJvdW5kKGNbMF0gKiAyNTUpfSwke01hdGgucm91bmQoY1sxXSAqIDI1NSl9LCR7TWF0aC5yb3VuZChjWzJdICogMjU1KX0pYDtcbn1cblxuLyogXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXG4gICBMZXJwIGhlbHBlclxuICAgXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwICovXG5cbmZ1bmN0aW9uIGxlcnAoYTogbnVtYmVyLCBiOiBudW1iZXIsIHQ6IG51bWJlcik6IG51bWJlciB7XG4gIHJldHVybiBhICsgKGIgLSBhKSAqIHQ7XG59XG5cbi8qIFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFxuICAgR3JhcGhWaWV3IFx1MjAxNCBDYW52YXMgKyBkMy1mb3JjZVxuICAgXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwICovXG5cbmV4cG9ydCBjbGFzcyBHcmFwaFZpZXcgZXh0ZW5kcyBJdGVtVmlldyB7XG4gIHByaXZhdGUgZ3JhcGhEYXRhOiBHcmFwaERhdGEgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzaW11bGF0aW9uOiBTaW11bGF0aW9uPFNpbU5vZGUsIFNpbUVkZ2U+IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgcmVzaXplT2JzZXJ2ZXI6IFJlc2l6ZU9ic2VydmVyIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgY29uZmlnUGFuZWw6IENvbmZpZ1BhbmVsIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgY29uZmlnOiBHcmFwaENvbmZpZyA9IHsgLi4uREVGQVVMVF9DT05GSUcgfTtcblxuICAvLyBDYW52YXMgc3RhdGVcbiAgcHJpdmF0ZSBjYW52YXNXcmFwcGVyOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGNhbnZhc0VsOiBIVE1MQ2FudmFzRWxlbWVudCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGN0eDogQ2FudmFzUmVuZGVyaW5nQ29udGV4dDJEIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgZHByID0gMTtcblxuICAvLyBkMy16b29tXG4gIHByaXZhdGUgem9vbUJlaGF2aW9yOiBab29tQmVoYXZpb3I8SFRNTENhbnZhc0VsZW1lbnQsIHVua25vd24+IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgem9vbVRyYW5zZm9ybTogWm9vbVRyYW5zZm9ybSA9IHpvb21JZGVudGl0eTtcbiAgcHJpdmF0ZSBpc1N5bmNpbmdab29tID0gZmFsc2U7XG5cbiAgLy8gU2ltIGRhdGFcbiAgcHJpdmF0ZSBzaW1Ob2RlczogU2ltTm9kZVtdID0gW107XG4gIHByaXZhdGUgc2ltRWRnZXM6IFNpbUVkZ2VbXSA9IFtdO1xuXG4gIC8vIENhbWVyYSAoY3VycmVudCA9IHNtb290aGVkLCB0YXJnZXQgPSB3aGVyZSB3ZSB3YW50IHRvIGJlKVxuICBwcml2YXRlIGNhbVggPSAwO1xuICBwcml2YXRlIGNhbVkgPSAwO1xuICBwcml2YXRlIGNhbVNjYWxlID0gMC43O1xuICBwcml2YXRlIHRhcmdldENhbVggPSAwO1xuICBwcml2YXRlIHRhcmdldENhbVkgPSAwO1xuICBwcml2YXRlIHRhcmdldENhbVNjYWxlID0gMC43O1xuXG4gIC8vIEludGVyYWN0aW9uIHN0YXRlXG4gIHByaXZhdGUgaG92ZXJlZE5vZGU6IFNpbU5vZGUgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzZWxlY3RlZE5vZGU6IFNpbU5vZGUgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBkcmFnTm9kZTogU2ltTm9kZSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGlzRHJhZ2dpbmcgPSBmYWxzZTtcbiAgcHJpdmF0ZSBsYXN0Q2xpY2tUaW1lID0gMDtcbiAgcHJpdmF0ZSBsYXN0Q2xpY2tJZCA9IFwiXCI7XG5cbiAgLy8gUmVuZGVyIGxvb3BcbiAgcHJpdmF0ZSByZW5kZXJMb29wSWQ6IG51bWJlciA9IDA7XG4gIHByaXZhdGUgbmVlZHNSZWRyYXcgPSB0cnVlO1xuXG4gIC8vIFRoZW1lIGNvbG9ycyAoY2FjaGVkKVxuICBwcml2YXRlIGNvbG9yTm9kZU9iamVjdDogW251bWJlciwgbnVtYmVyLCBudW1iZXJdID0gWzAuNSwgMC41LCAxLjBdO1xuICBwcml2YXRlIGNvbG9yTm9kZUZpbGU6IFtudW1iZXIsIG51bWJlciwgbnVtYmVyXSA9IFswLjYsIDAuNiwgMC42XTtcbiAgcHJpdmF0ZSBjb2xvckVkZ2VXaWtpOiBbbnVtYmVyLCBudW1iZXIsIG51bWJlcl0gPSBbMC41LCAwLjUsIDAuNV07XG4gIHByaXZhdGUgY29sb3JFZGdlT2JqOiBbbnVtYmVyLCBudW1iZXIsIG51bWJlcl0gPSBbMC41LCAwLjUsIDEuMF07XG4gIHByaXZhdGUgY29sb3JIaWdobGlnaHQ6IFtudW1iZXIsIG51bWJlciwgbnVtYmVyXSA9IFswLjUsIDAuNSwgMS4wXTtcbiAgcHJpdmF0ZSBjb2xvckJnOiBbbnVtYmVyLCBudW1iZXIsIG51bWJlcl0gPSBbMC4xLCAwLjEsIDAuMV07XG4gIHByaXZhdGUgY29sb3JUZXh0ID0gXCIjZGNkZGRlXCI7XG5cbiAgLy8gQ2FsbGJhY2tzXG4gIHB1YmxpYyBuYXZpZ2F0ZVRvT2JqZWN0OiAoKGZpbGVQYXRoOiBzdHJpbmcsIHN0YXJ0TGluZTogbnVtYmVyKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuICBwdWJsaWMgbmF2aWdhdGVUb0ZpbGU6ICgoZmlsZVBhdGg6IHN0cmluZykgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcblxuICAvLyBCb3VuZCBoYW5kbGVyc1xuICBwcml2YXRlIF9vbldoZWVsOiAoKGU6IFdoZWVsRXZlbnQpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgX29uTW91c2VEb3duOiAoKGU6IE1vdXNlRXZlbnQpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgX29uTW91c2VNb3ZlOiAoKGU6IE1vdXNlRXZlbnQpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgX29uTW91c2VVcDogKChlOiBNb3VzZUV2ZW50KSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIF9vbkRibENsaWNrOiAoKGU6IE1vdXNlRXZlbnQpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgX29uQ29udGFpbmVyTW91c2VEb3duOiAoKGU6IE1vdXNlRXZlbnQpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG5cbiAgY29uc3RydWN0b3IobGVhZjogV29ya3NwYWNlTGVhZikge1xuICAgIHN1cGVyKGxlYWYpO1xuICB9XG5cbiAgZ2V0Vmlld1R5cGUoKTogc3RyaW5nIHsgcmV0dXJuIFZJRVdfVFlQRTsgfVxuICBnZXREaXNwbGF5VGV4dCgpOiBzdHJpbmcgeyByZXR1cm4gXCJPYmplY3QgTGlua3NcIjsgfVxuICBnZXRJY29uKCk6IHN0cmluZyB7IHJldHVybiBcImdpdC1mb3JrXCI7IH1cblxuICBzZXRHcmFwaERhdGEoZGF0YTogR3JhcGhEYXRhKTogdm9pZCB7XG4gICAgdGhpcy5ncmFwaERhdGEgPSBkYXRhO1xuICAgIGlmICh0aGlzLmNvbnRhaW5lckVsKSB0aGlzLnJlbmRlckdyYXBoKCk7XG4gIH1cblxuICBhc3luYyBvbk9wZW4oKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgY29udGFpbmVyID0gdGhpcy5jb250ZW50RWw7XG4gICAgY29udGFpbmVyLmVtcHR5KCk7XG4gICAgY29udGFpbmVyLmFkZENsYXNzKFwib2wtZ3JhcGgtY29udGFpbmVyXCIpO1xuXG4gICAgaWYgKHRoaXMuZ3JhcGhEYXRhKSB7XG4gICAgICB0aGlzLnJlbmRlckdyYXBoKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnRhaW5lci5jcmVhdGVFbChcImRpdlwiLCB7XG4gICAgICAgIGNsczogXCJvbC1lbXB0eS1zdGF0ZVwiLFxuICAgICAgICB0ZXh0OiBcIk9wZW4gdGhlIGdyYXBoIHVzaW5nIHRoZSBjb21tYW5kIHBhbGV0dGUgb3IgcmliYm9uIGljb24uXCIsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBvbkNsb3NlKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuY2xlYW51cCgpO1xuICB9XG5cbiAgcHJpdmF0ZSBjbGVhbnVwKCk6IHZvaWQge1xuICAgIHRoaXMuc3RvcFJlbmRlckxvb3AoKTtcbiAgICBpZiAodGhpcy5zaW11bGF0aW9uKSB7XG4gICAgICB0aGlzLnNpbXVsYXRpb24uc3RvcCgpO1xuICAgICAgdGhpcy5zaW11bGF0aW9uLm9uKFwidGlja1wiLCBudWxsKTtcbiAgICAgIHRoaXMuc2ltdWxhdGlvbiA9IG51bGw7XG4gICAgfVxuICAgIGlmICh0aGlzLnJlc2l6ZU9ic2VydmVyKSB7IHRoaXMucmVzaXplT2JzZXJ2ZXIuZGlzY29ubmVjdCgpOyB0aGlzLnJlc2l6ZU9ic2VydmVyID0gbnVsbDsgfVxuICAgIGlmICh0aGlzLmNvbmZpZ1BhbmVsKSB7IHRoaXMuY29uZmlnUGFuZWwuZGVzdHJveSgpOyB0aGlzLmNvbmZpZ1BhbmVsID0gbnVsbDsgfVxuICAgIHRoaXMucmVtb3ZlQ2FudmFzTGlzdGVuZXJzKCk7XG4gICAgaWYgKHRoaXMuX29uQ29udGFpbmVyTW91c2VEb3duKSB7XG4gICAgICB0aGlzLmNvbnRlbnRFbC5yZW1vdmVFdmVudExpc3RlbmVyKFwibW91c2Vkb3duXCIsIHRoaXMuX29uQ29udGFpbmVyTW91c2VEb3duLCB0cnVlKTtcbiAgICAgIHRoaXMuX29uQ29udGFpbmVyTW91c2VEb3duID0gbnVsbDtcbiAgICB9XG5cbiAgICAvLyBSZW1vdmUgZml4ZWQgdG9vbHRpcCBmcm9tIGJvZHlcbiAgICBjb25zdCB0b29sdGlwID0gZG9jdW1lbnQuYm9keS5xdWVyeVNlbGVjdG9yKFwiLm9sLXRvb2x0aXBcIik7XG4gICAgaWYgKHRvb2x0aXApIHRvb2x0aXAucmVtb3ZlKCk7XG5cbiAgICB0aGlzLnNpbU5vZGVzID0gW107XG4gICAgdGhpcy5zaW1FZGdlcyA9IFtdO1xuXG4gICAgdGhpcy5jYW52YXNFbD8ucmVtb3ZlKCk7XG4gICAgdGhpcy5jYW52YXNFbCA9IG51bGw7XG4gICAgdGhpcy5jdHggPSBudWxsO1xuICAgIHRoaXMuY2FudmFzV3JhcHBlciA9IG51bGw7XG4gIH1cblxuICBwcml2YXRlIHJlbW92ZUNhbnZhc0xpc3RlbmVycygpOiB2b2lkIHtcbiAgICBjb25zdCBjID0gdGhpcy5jYW52YXNFbDtcbiAgICBpZiAoIWMpIHJldHVybjtcbiAgICBpZiAodGhpcy5fb25XaGVlbCkgYy5yZW1vdmVFdmVudExpc3RlbmVyKFwid2hlZWxcIiwgdGhpcy5fb25XaGVlbCk7XG4gICAgLy8gbW91c2Vkb3duIHdhcyByZWdpc3RlcmVkIHdpdGggY2FwdHVyZTp0cnVlIHRvIGludGVyY2VwdCBiZWZvcmUgZDMtem9vbVxuICAgIGlmICh0aGlzLl9vbk1vdXNlRG93bikgYy5yZW1vdmVFdmVudExpc3RlbmVyKFwibW91c2Vkb3duXCIsIHRoaXMuX29uTW91c2VEb3duLCB0cnVlKTtcbiAgICBpZiAodGhpcy5fb25Nb3VzZU1vdmUpIGMucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm1vdXNlbW92ZVwiLCB0aGlzLl9vbk1vdXNlTW92ZSk7XG4gICAgaWYgKHRoaXMuX29uTW91c2VVcCkgYy5yZW1vdmVFdmVudExpc3RlbmVyKFwibW91c2V1cFwiLCB0aGlzLl9vbk1vdXNlVXApO1xuICAgIGlmICh0aGlzLl9vbkRibENsaWNrKSBjLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJkYmxjbGlja1wiLCB0aGlzLl9vbkRibENsaWNrKTtcbiAgfVxuXG4gIC8qIFx1MjUwMFx1MjUwMCBSZW5kZXIgbG9vcCBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cblxuICBwcml2YXRlIHN0YXJ0UmVuZGVyTG9vcCgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5yZW5kZXJMb29wSWQpIHJldHVybjtcbiAgICBjb25zdCBmcmFtZSA9ICgpID0+IHtcbiAgICAgIHRoaXMucmVuZGVyTG9vcElkID0gcmVxdWVzdEFuaW1hdGlvbkZyYW1lKGZyYW1lKTtcbiAgICAgIHRoaXMudXBkYXRlQW5kRHJhdygpO1xuICAgIH07XG4gICAgdGhpcy5yZW5kZXJMb29wSWQgPSByZXF1ZXN0QW5pbWF0aW9uRnJhbWUoZnJhbWUpO1xuICB9XG5cbiAgcHJpdmF0ZSBzdG9wUmVuZGVyTG9vcCgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5yZW5kZXJMb29wSWQpIHtcbiAgICAgIGNhbmNlbEFuaW1hdGlvbkZyYW1lKHRoaXMucmVuZGVyTG9vcElkKTtcbiAgICAgIHRoaXMucmVuZGVyTG9vcElkID0gMDtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHVwZGF0ZUFuZERyYXcoKTogdm9pZCB7XG4gICAgbGV0IGFuaW1hdGluZyA9IGZhbHNlO1xuXG4gICAgLy8gU21vb3RoIGNhbWVyYSBpbnRlcnBvbGF0aW9uXG4gICAgY29uc3QgY2FtTGVycCA9IDAuMTU7XG4gICAgaWYgKE1hdGguYWJzKHRoaXMuY2FtWCAtIHRoaXMudGFyZ2V0Q2FtWCkgPiAwLjAxIHx8XG4gICAgICAgIE1hdGguYWJzKHRoaXMuY2FtWSAtIHRoaXMudGFyZ2V0Q2FtWSkgPiAwLjAxIHx8XG4gICAgICAgIE1hdGguYWJzKHRoaXMuY2FtU2NhbGUgLSB0aGlzLnRhcmdldENhbVNjYWxlKSA+IDAuMDAwMSkge1xuICAgICAgdGhpcy5jYW1YID0gbGVycCh0aGlzLmNhbVgsIHRoaXMudGFyZ2V0Q2FtWCwgY2FtTGVycCk7XG4gICAgICB0aGlzLmNhbVkgPSBsZXJwKHRoaXMuY2FtWSwgdGhpcy50YXJnZXRDYW1ZLCBjYW1MZXJwKTtcbiAgICAgIHRoaXMuY2FtU2NhbGUgPSBsZXJwKHRoaXMuY2FtU2NhbGUsIHRoaXMudGFyZ2V0Q2FtU2NhbGUsIGNhbUxlcnApO1xuICAgICAgaWYgKE1hdGguYWJzKHRoaXMuY2FtU2NhbGUgLSB0aGlzLnRhcmdldENhbVNjYWxlKSA8IDAuMDAwMSkge1xuICAgICAgICB0aGlzLmNhbVNjYWxlID0gdGhpcy50YXJnZXRDYW1TY2FsZTtcbiAgICAgICAgdGhpcy5jYW1YID0gdGhpcy50YXJnZXRDYW1YO1xuICAgICAgICB0aGlzLmNhbVkgPSB0aGlzLnRhcmdldENhbVk7XG4gICAgICB9XG4gICAgICBhbmltYXRpbmcgPSB0cnVlO1xuICAgIH1cblxuICAgIC8vIFNtb290aCBhbHBoYSBpbnRlcnBvbGF0aW9uIGZvciBub2Rlcy9lZGdlc1xuICAgIGNvbnN0IGFscGhhTGVycCA9IDAuMTI7XG4gICAgZm9yIChjb25zdCBuIG9mIHRoaXMuc2ltTm9kZXMpIHtcbiAgICAgIGlmIChNYXRoLmFicyhuLmFscGhhIC0gbi50YXJnZXRBbHBoYSkgPiAwLjAwNSkge1xuICAgICAgICBuLmFscGhhID0gbGVycChuLmFscGhhLCBuLnRhcmdldEFscGhhLCBhbHBoYUxlcnApO1xuICAgICAgICBhbmltYXRpbmcgPSB0cnVlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbi5hbHBoYSA9IG4udGFyZ2V0QWxwaGE7XG4gICAgICB9XG4gICAgfVxuICAgIGZvciAoY29uc3QgZSBvZiB0aGlzLnNpbUVkZ2VzKSB7XG4gICAgICBpZiAoTWF0aC5hYnMoZS5hbHBoYSAtIGUudGFyZ2V0QWxwaGEpID4gMC4wMDUpIHtcbiAgICAgICAgZS5hbHBoYSA9IGxlcnAoZS5hbHBoYSwgZS50YXJnZXRBbHBoYSwgYWxwaGFMZXJwKTtcbiAgICAgICAgYW5pbWF0aW5nID0gdHJ1ZTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGUuYWxwaGEgPSBlLnRhcmdldEFscGhhO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHNpbUFjdGl2ZSA9ICh0aGlzLnNpbXVsYXRpb24/LmFscGhhKCkgPz8gMCkgPiAwLjAwMTtcblxuICAgIGlmIChhbmltYXRpbmcgfHwgc2ltQWN0aXZlIHx8IHRoaXMubmVlZHNSZWRyYXcpIHtcbiAgICAgIHRoaXMubmVlZHNSZWRyYXcgPSBmYWxzZTtcbiAgICAgIHRoaXMuZHJhdygpO1xuICAgIH1cbiAgfVxuXG4gIC8qIFx1MjUwMFx1MjUwMCBGaWx0ZXJpbmcgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwICovXG5cbiAgcHJpdmF0ZSBhcHBseUZpbHRlcnMoZGF0YTogR3JhcGhEYXRhKTogR3JhcGhEYXRhIHtcbiAgICBjb25zdCBjID0gdGhpcy5jb25maWc7XG4gICAgbGV0IG5vZGVzID0gWy4uLmRhdGEubm9kZXNdO1xuICAgIGxldCBlZGdlcyA9IFsuLi5kYXRhLmVkZ2VzXTtcblxuICAgIGlmICghYy5zaG93RmlsZXMpIHtcbiAgICAgIGNvbnN0IGlkcyA9IG5ldyBTZXQobm9kZXMuZmlsdGVyKChuKSA9PiBuLnR5cGUgPT09IFwiZmlsZVwiKS5tYXAoKG4pID0+IG4uaWQpKTtcbiAgICAgIG5vZGVzID0gbm9kZXMuZmlsdGVyKChuKSA9PiBuLnR5cGUgIT09IFwiZmlsZVwiKTtcbiAgICAgIGVkZ2VzID0gZWRnZXMuZmlsdGVyKChlKSA9PiAhaWRzLmhhcyhlLnNvdXJjZSkgJiYgIWlkcy5oYXMoZS50YXJnZXQpKTtcbiAgICB9XG4gICAgaWYgKCFjLnNob3dPYmplY3RzKSB7XG4gICAgICBjb25zdCBpZHMgPSBuZXcgU2V0KG5vZGVzLmZpbHRlcigobikgPT4gbi50eXBlID09PSBcIm9iamVjdFwiKS5tYXAoKG4pID0+IG4uaWQpKTtcbiAgICAgIG5vZGVzID0gbm9kZXMuZmlsdGVyKChuKSA9PiBuLnR5cGUgIT09IFwib2JqZWN0XCIpO1xuICAgICAgZWRnZXMgPSBlZGdlcy5maWx0ZXIoKGUpID0+ICFpZHMuaGFzKGUuc291cmNlKSAmJiAhaWRzLmhhcyhlLnRhcmdldCkpO1xuICAgIH1cbiAgICBpZiAoIWMuc2hvd1dpa2lFZGdlcykgZWRnZXMgPSBlZGdlcy5maWx0ZXIoKGUpID0+IGUuZWRnZVR5cGUgIT09IFwid2lraVwiKTtcbiAgICBpZiAoIWMuc2hvd09iamVjdEVkZ2VzKSBlZGdlcyA9IGVkZ2VzLmZpbHRlcigoZSkgPT4gZS5lZGdlVHlwZSAhPT0gXCJvYmplY3RcIik7XG4gICAgaWYgKGMuc2VhcmNoKSB7XG4gICAgICBjb25zdCBxID0gYy5zZWFyY2gudG9Mb3dlckNhc2UoKTtcbiAgICAgIGNvbnN0IG1hdGNoZWQgPSBuZXcgU2V0KG5vZGVzLmZpbHRlcigobikgPT4gbi5sYWJlbC50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHEpKS5tYXAoKG4pID0+IG4uaWQpKTtcbiAgICAgIGZvciAoY29uc3QgZSBvZiBlZGdlcykge1xuICAgICAgICBpZiAobWF0Y2hlZC5oYXMoZS5zb3VyY2UpKSBtYXRjaGVkLmFkZChlLnRhcmdldCk7XG4gICAgICAgIGlmIChtYXRjaGVkLmhhcyhlLnRhcmdldCkpIG1hdGNoZWQuYWRkKGUuc291cmNlKTtcbiAgICAgIH1cbiAgICAgIG5vZGVzID0gbm9kZXMuZmlsdGVyKChuKSA9PiBtYXRjaGVkLmhhcyhuLmlkKSk7XG4gICAgICBjb25zdCBub2RlSWRzID0gbmV3IFNldChub2Rlcy5tYXAoKG4pID0+IG4uaWQpKTtcbiAgICAgIGVkZ2VzID0gZWRnZXMuZmlsdGVyKChlKSA9PiBub2RlSWRzLmhhcyhlLnNvdXJjZSkgJiYgbm9kZUlkcy5oYXMoZS50YXJnZXQpKTtcbiAgICB9XG4gICAgaWYgKGMucGF0aEZpbHRlcikge1xuICAgICAgY29uc3QgcGYgPSBjLnBhdGhGaWx0ZXIudG9Mb3dlckNhc2UoKTtcbiAgICAgIGNvbnN0IG1hdGNoZWQgPSBuZXcgU2V0KG5vZGVzLmZpbHRlcigobikgPT4gbi5maWxlUGF0aC50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHBmKSkubWFwKChuKSA9PiBuLmlkKSk7XG4gICAgICBmb3IgKGNvbnN0IGUgb2YgZWRnZXMpIHtcbiAgICAgICAgaWYgKG1hdGNoZWQuaGFzKGUuc291cmNlKSkgbWF0Y2hlZC5hZGQoZS50YXJnZXQpO1xuICAgICAgICBpZiAobWF0Y2hlZC5oYXMoZS50YXJnZXQpKSBtYXRjaGVkLmFkZChlLnNvdXJjZSk7XG4gICAgICB9XG4gICAgICBub2RlcyA9IG5vZGVzLmZpbHRlcigobikgPT4gbWF0Y2hlZC5oYXMobi5pZCkpO1xuICAgICAgY29uc3Qgbm9kZUlkcyA9IG5ldyBTZXQobm9kZXMubWFwKChuKSA9PiBuLmlkKSk7XG4gICAgICBlZGdlcyA9IGVkZ2VzLmZpbHRlcigoZSkgPT4gbm9kZUlkcy5oYXMoZS5zb3VyY2UpICYmIG5vZGVJZHMuaGFzKGUudGFyZ2V0KSk7XG4gICAgfVxuICAgIGlmIChjLnNvdXJjZUZpbHRlcikge1xuICAgICAgY29uc3Qgc2YgPSBjLnNvdXJjZUZpbHRlci50b0xvd2VyQ2FzZSgpO1xuICAgICAgY29uc3QgcmVtb3ZlZCA9IG5ldyBTZXQoXG4gICAgICAgIG5vZGVzLmZpbHRlcigobikgPT4gbi50eXBlID09PSBcIm9iamVjdFwiICYmICFuLmZpbGVMYWJlbC50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHNmKSkubWFwKChuKSA9PiBuLmlkKVxuICAgICAgKTtcbiAgICAgIG5vZGVzID0gbm9kZXMuZmlsdGVyKChuKSA9PiAhcmVtb3ZlZC5oYXMobi5pZCkpO1xuICAgICAgZWRnZXMgPSBlZGdlcy5maWx0ZXIoKGUpID0+ICFyZW1vdmVkLmhhcyhlLnNvdXJjZSkgJiYgIXJlbW92ZWQuaGFzKGUudGFyZ2V0KSk7XG4gICAgfVxuICAgIGlmICghYy5zaG93T3JwaGFucykge1xuICAgICAgY29uc3QgY29ubmVjdGVkID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgICBmb3IgKGNvbnN0IGUgb2YgZWRnZXMpIHsgY29ubmVjdGVkLmFkZChlLnNvdXJjZSk7IGNvbm5lY3RlZC5hZGQoZS50YXJnZXQpOyB9XG4gICAgICBub2RlcyA9IG5vZGVzLmZpbHRlcigobikgPT4gY29ubmVjdGVkLmhhcyhuLmlkKSk7XG4gICAgfVxuXG4gICAgY29uc3QgY2MgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xuICAgIGZvciAoY29uc3QgZSBvZiBlZGdlcykge1xuICAgICAgY2Muc2V0KGUuc291cmNlLCAoY2MuZ2V0KGUuc291cmNlKSB8fCAwKSArIDEpO1xuICAgICAgY2Muc2V0KGUudGFyZ2V0LCAoY2MuZ2V0KGUudGFyZ2V0KSB8fCAwKSArIDEpO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IG4gb2Ygbm9kZXMpIG4uY29ubmVjdGlvbnMgPSBjYy5nZXQobi5pZCkgfHwgMDtcblxuICAgIHJldHVybiB7IG5vZGVzLCBlZGdlcyB9O1xuICB9XG5cbiAgLyogXHUyNTAwXHUyNTAwIE5vZGUgcmFkaXVzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMCAqL1xuXG4gIHByaXZhdGUgZ2V0Tm9kZVJhZGl1cyhuOiB7IHR5cGU6IHN0cmluZzsgY29ubmVjdGlvbnM6IG51bWJlciB9KTogbnVtYmVyIHtcbiAgICBjb25zdCBtID0gdGhpcy5jb25maWcubm9kZVNpemVNdWx0aXBsaWVyO1xuICAgIGNvbnN0IGJhc2UgPSBuLnR5cGUgPT09IFwiZmlsZVwiID8gNC41IDogNS41O1xuICAgIGNvbnN0IGRlZyA9IE1hdGgubWF4KDAsIG4uY29ubmVjdGlvbnMpO1xuICAgIGNvbnN0IGJ1bXAgPSBNYXRoLm1pbigxMCwgTWF0aC5zcXJ0KGRlZykgKiAxLjYpO1xuICAgIHJldHVybiAoYmFzZSArIGJ1bXApICogbTtcbiAgfVxuXG4gIC8qIFx1MjUwMFx1MjUwMCBUaGVtZSBjb2xvcnMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwICovXG5cbiAgcHJpdmF0ZSByZWZyZXNoQ29sb3JzKCk6IHZvaWQge1xuICAgIGNvbnN0IGVsID0gdGhpcy5jb250ZW50RWw7XG4gICAgdGhpcy5jb2xvck5vZGVPYmplY3QgPSBnZXRUaGVtZUNvbG9yKGVsLCBcIi0taW50ZXJhY3RpdmUtYWNjZW50XCIsIFwiIzdmNmRmMlwiKTtcbiAgICB0aGlzLmNvbG9yTm9kZUZpbGUgPSBnZXRUaGVtZUNvbG9yKGVsLCBcIi0tdGV4dC1tdXRlZFwiLCBcIiM5OTk5OTlcIik7XG4gICAgdGhpcy5jb2xvckVkZ2VXaWtpID0gZ2V0VGhlbWVDb2xvcihlbCwgXCItLWJhY2tncm91bmQtbW9kaWZpZXItYm9yZGVyXCIsIFwiIzU1NTU1NVwiKTtcbiAgICB0aGlzLmNvbG9yRWRnZU9iaiA9IGdldFRoZW1lQ29sb3IoZWwsIFwiLS1pbnRlcmFjdGl2ZS1hY2NlbnRcIiwgXCIjN2Y2ZGYyXCIpO1xuICAgIHRoaXMuY29sb3JIaWdobGlnaHQgPSBnZXRUaGVtZUNvbG9yKGVsLCBcIi0taW50ZXJhY3RpdmUtYWNjZW50XCIsIFwiIzdmNmRmMlwiKTtcbiAgICB0aGlzLmNvbG9yQmcgPSBnZXRUaGVtZUNvbG9yKGVsLCBcIi0tYmFja2dyb3VuZC1wcmltYXJ5XCIsIFwiIzFlMWUxZVwiKTtcbiAgICBjb25zdCBzdHlsZSA9IGdldENvbXB1dGVkU3R5bGUoZWwpO1xuICAgIHRoaXMuY29sb3JUZXh0ID0gc3R5bGUuZ2V0UHJvcGVydHlWYWx1ZShcIi0tdGV4dC1ub3JtYWxcIikudHJpbSgpIHx8IFwiI2RjZGRkZVwiO1xuICB9XG5cbiAgLyogXHUyNTAwXHUyNTAwIENvb3JkaW5hdGUgdHJhbnNmb3JtcyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cblxuICBwcml2YXRlIGdldFNjcmVlblNpemUoKTogeyB3OiBudW1iZXI7IGg6IG51bWJlciB9IHtcbiAgICBjb25zdCBjID0gdGhpcy5jYW52YXNFbDtcbiAgICBpZiAoIWMpIHJldHVybiB7IHc6IDAsIGg6IDAgfTtcbiAgICAvLyBVc2UgQ1NTIHBpeGVsczsgZHJhd2luZyBjb2RlIHVzZXMgQ1NTIHB4IGNvb3JkaW5hdGVzLlxuICAgIHJldHVybiB7IHc6IGMuY2xpZW50V2lkdGgsIGg6IGMuY2xpZW50SGVpZ2h0IH07XG4gIH1cblxuICBwcml2YXRlIHdvcmxkVG9TY3JlZW4od3g6IG51bWJlciwgd3k6IG51bWJlcik6IFtudW1iZXIsIG51bWJlcl0ge1xuICAgIGNvbnN0IHsgdywgaCB9ID0gdGhpcy5nZXRTY3JlZW5TaXplKCk7XG4gICAgcmV0dXJuIFtcbiAgICAgICh3eCAtIHRoaXMuY2FtWCkgKiB0aGlzLmNhbVNjYWxlICsgdyAvIDIsXG4gICAgICAod3kgLSB0aGlzLmNhbVkpICogdGhpcy5jYW1TY2FsZSArIGggLyAyLFxuICAgIF07XG4gIH1cblxuICBwcml2YXRlIHNjcmVlblRvV29ybGQoc3g6IG51bWJlciwgc3k6IG51bWJlcik6IFtudW1iZXIsIG51bWJlcl0ge1xuICAgIGNvbnN0IHsgdywgaCB9ID0gdGhpcy5nZXRTY3JlZW5TaXplKCk7XG4gICAgcmV0dXJuIFtcbiAgICAgIChzeCAtIHcgLyAyKSAvIHRoaXMuY2FtU2NhbGUgKyB0aGlzLmNhbVgsXG4gICAgICAoc3kgLSBoIC8gMikgLyB0aGlzLmNhbVNjYWxlICsgdGhpcy5jYW1ZLFxuICAgIF07XG4gIH1cblxuICBwcml2YXRlIHNjcmVlblRvV29ybGRUYXJnZXQoc3g6IG51bWJlciwgc3k6IG51bWJlcik6IFtudW1iZXIsIG51bWJlcl0ge1xuICAgIGNvbnN0IHsgdywgaCB9ID0gdGhpcy5nZXRTY3JlZW5TaXplKCk7XG4gICAgcmV0dXJuIFtcbiAgICAgIChzeCAtIHcgLyAyKSAvIHRoaXMudGFyZ2V0Q2FtU2NhbGUgKyB0aGlzLnRhcmdldENhbVgsXG4gICAgICAoc3kgLSBoIC8gMikgLyB0aGlzLnRhcmdldENhbVNjYWxlICsgdGhpcy50YXJnZXRDYW1ZLFxuICAgIF07XG4gIH1cblxuICAvKiBcdTI1MDBcdTI1MDAgSGl0IHRlc3QgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwICovXG5cbiAgcHJpdmF0ZSBoaXRUZXN0Tm9kZShzeDogbnVtYmVyLCBzeTogbnVtYmVyKTogU2ltTm9kZSB8IG51bGwge1xuICAgIGNvbnN0IFt3eCwgd3ldID0gdGhpcy5zY3JlZW5Ub1dvcmxkKHN4LCBzeSk7XG4gICAgbGV0IGJlc3Q6IFNpbU5vZGUgfCBudWxsID0gbnVsbDtcbiAgICBsZXQgYmVzdERpc3QgPSBJbmZpbml0eTtcbiAgICBmb3IgKGNvbnN0IG4gb2YgdGhpcy5zaW1Ob2Rlcykge1xuICAgICAgY29uc3QgbnggPSBuLnggPz8gMDtcbiAgICAgIGNvbnN0IG55ID0gbi55ID8/IDA7XG4gICAgICBjb25zdCBkeCA9IG54IC0gd3g7XG4gICAgICBjb25zdCBkeSA9IG55IC0gd3k7XG4gICAgICBjb25zdCBkaXN0ID0gTWF0aC5zcXJ0KGR4ICogZHggKyBkeSAqIGR5KTtcbiAgICAgIGNvbnN0IGhpdFJhZGl1cyA9IE1hdGgubWF4KG4ucmFkaXVzICsgNCwgOCAvIHRoaXMuY2FtU2NhbGUpO1xuICAgICAgaWYgKGRpc3QgPCBoaXRSYWRpdXMgJiYgZGlzdCA8IGJlc3REaXN0KSB7XG4gICAgICAgIGJlc3QgPSBuO1xuICAgICAgICBiZXN0RGlzdCA9IGRpc3Q7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBiZXN0O1xuICB9XG5cbiAgLyogXHUyNTAwXHUyNTAwIFVwZGF0ZSBoaWdobGlnaHQgdGFyZ2V0cyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cblxuICBwcml2YXRlIHVwZGF0ZUhpZ2hsaWdodFRhcmdldHMoKTogdm9pZCB7XG4gICAgY29uc3QgZm9jdXMgPSB0aGlzLmhvdmVyZWROb2RlIHx8IHRoaXMuc2VsZWN0ZWROb2RlO1xuICAgIGlmICghZm9jdXMpIHtcbiAgICAgIGZvciAoY29uc3QgbiBvZiB0aGlzLnNpbU5vZGVzKSB7XG4gICAgICAgIG4udGFyZ2V0QWxwaGEgPSBuLnR5cGUgPT09IFwib2JqZWN0XCIgPyAwLjkgOiAwLjU7XG4gICAgICB9XG4gICAgICBmb3IgKGNvbnN0IGUgb2YgdGhpcy5zaW1FZGdlcykge1xuICAgICAgICBlLnRhcmdldEFscGhhID0gZS5lZGdlVHlwZSA9PT0gXCJ3aWtpXCIgPyAwLjM1IDogMC4yNTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBjb25uZWN0ZWQgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICBjb25uZWN0ZWQuYWRkKGZvY3VzLmlkKTtcbiAgICBmb3IgKGNvbnN0IGUgb2YgdGhpcy5zaW1FZGdlcykge1xuICAgICAgY29uc3QgcyA9IChlLnNvdXJjZSBhcyBTaW1Ob2RlKS5pZDtcbiAgICAgIGNvbnN0IHQgPSAoZS50YXJnZXQgYXMgU2ltTm9kZSkuaWQ7XG4gICAgICBpZiAocyA9PT0gZm9jdXMuaWQpIGNvbm5lY3RlZC5hZGQodCk7XG4gICAgICBpZiAodCA9PT0gZm9jdXMuaWQpIGNvbm5lY3RlZC5hZGQocyk7XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBuIG9mIHRoaXMuc2ltTm9kZXMpIHtcbiAgICAgIGlmIChuID09PSBmb2N1cykge1xuICAgICAgICBuLnRhcmdldEFscGhhID0gMS4wO1xuICAgICAgfSBlbHNlIGlmIChjb25uZWN0ZWQuaGFzKG4uaWQpKSB7XG4gICAgICAgIG4udGFyZ2V0QWxwaGEgPSBuLnR5cGUgPT09IFwib2JqZWN0XCIgPyAwLjkgOiAwLjc7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBuLnRhcmdldEFscGhhID0gMC4wNjtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGUgb2YgdGhpcy5zaW1FZGdlcykge1xuICAgICAgY29uc3QgcyA9IChlLnNvdXJjZSBhcyBTaW1Ob2RlKS5pZDtcbiAgICAgIGNvbnN0IHQgPSAoZS50YXJnZXQgYXMgU2ltTm9kZSkuaWQ7XG4gICAgICBpZiAocyA9PT0gZm9jdXMuaWQgfHwgdCA9PT0gZm9jdXMuaWQpIHtcbiAgICAgICAgZS50YXJnZXRBbHBoYSA9IDAuODtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGUudGFyZ2V0QWxwaGEgPSAwLjAzO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qIFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFxuICAgICBNYWluIFJlbmRlciBcdTIwMTQgY2FsbGVkIG9uY2Ugb24gaW5pdGlhbCBkYXRhLCBhbmQgb24gZmlsdGVyIGNoYW5nZXNcbiAgICAgXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwXHUyNTUwICovXG5cbiAgcHJpdmF0ZSByZW5kZXJHcmFwaCgpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMuZ3JhcGhEYXRhKSByZXR1cm47XG5cbiAgICBjb25zdCBjb250YWluZXIgPSB0aGlzLmNvbnRlbnRFbDtcbiAgICBjb25zdCBpc0ZpcnN0UmVuZGVyID0gIXRoaXMuY2FudmFzRWw7XG5cbiAgICBpZiAoaXNGaXJzdFJlbmRlcikge1xuICAgICAgY29udGFpbmVyLmVtcHR5KCk7XG4gICAgICBjb250YWluZXIuYWRkQ2xhc3MoXCJvbC1ncmFwaC1jb250YWluZXJcIik7XG5cbiAgICAgIC8vIENvbmZpZyBwYW5lbFxuICAgICAgdGhpcy5jb25maWdQYW5lbCA9IG5ldyBDb25maWdQYW5lbChjb250YWluZXIsIHRoaXMuY29uZmlnLCAobmV3Q29uZmlnKSA9PiB7XG4gICAgICAgIHRoaXMuaGFuZGxlQ29uZmlnQ2hhbmdlKG5ld0NvbmZpZyk7XG4gICAgICB9KTtcblxuICAgICAgLy8gQ2FudmFzIHdyYXBwZXJcbiAgICAgIHRoaXMuY2FudmFzV3JhcHBlciA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICB0aGlzLmNhbnZhc1dyYXBwZXIuc3R5bGUuY3NzVGV4dCA9IFwicG9zaXRpb246YWJzb2x1dGU7aW5zZXQ6MDtcIjtcbiAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZCh0aGlzLmNhbnZhc1dyYXBwZXIpO1xuXG4gICAgICB0aGlzLnJlZnJlc2hDb2xvcnMoKTtcbiAgICAgIHRoaXMuaW5pdENhbnZhcygpO1xuICAgICAgdGhpcy5yZWJ1aWxkU2ltRGF0YSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMucmVidWlsZFNpbURhdGEoKTtcbiAgfVxuXG4gIHByaXZhdGUgaW5pdENhbnZhcygpOiB2b2lkIHtcbiAgICBjb25zdCB3cmFwcGVyID0gdGhpcy5jYW52YXNXcmFwcGVyITtcblxuICAgIGNvbnN0IGNhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJjYW52YXNcIik7XG4gICAgY2FudmFzLnN0eWxlLmNzc1RleHQgPSBcInBvc2l0aW9uOmFic29sdXRlO2luc2V0OjA7d2lkdGg6MTAwJTtoZWlnaHQ6MTAwJTtcIjtcbiAgICB3cmFwcGVyLmFwcGVuZENoaWxkKGNhbnZhcyk7XG5cbiAgICBjb25zdCBjdHggPSBjYW52YXMuZ2V0Q29udGV4dChcIjJkXCIsIHsgYWxwaGE6IGZhbHNlIH0pO1xuICAgIGlmICghY3R4KSB0aHJvdyBuZXcgRXJyb3IoXCJGYWlsZWQgdG8gaW5pdCAyRCBjYW52YXMgY29udGV4dFwiKTtcblxuICAgIHRoaXMuY2FudmFzRWwgPSBjYW52YXM7XG4gICAgdGhpcy5jdHggPSBjdHg7XG5cbiAgICB0aGlzLnJlc2l6ZU9ic2VydmVyID0gbmV3IFJlc2l6ZU9ic2VydmVyKCgpID0+IHtcbiAgICAgIHRoaXMucmVzaXplQ2FudmFzKCk7XG4gICAgICB0aGlzLm5lZWRzUmVkcmF3ID0gdHJ1ZTtcbiAgICB9KTtcbiAgICB0aGlzLnJlc2l6ZU9ic2VydmVyLm9ic2VydmUodGhpcy5jb250ZW50RWwpO1xuXG4gICAgdGhpcy5yZXNpemVDYW52YXMoKTtcbiAgICB0aGlzLnNldHVwSW5wdXRIYW5kbGVycygpO1xuXG4gICAgLy8gQ2xpY2tpbmcgb3V0c2lkZSB0aGUgaW5mbyBwYW5lbCBzaG91bGQgY2xvc2UgaXQuXG4gICAgaWYgKCF0aGlzLl9vbkNvbnRhaW5lck1vdXNlRG93bikge1xuICAgICAgdGhpcy5fb25Db250YWluZXJNb3VzZURvd24gPSAoZTogTW91c2VFdmVudCkgPT4ge1xuICAgICAgICBjb25zdCBwYW5lbCA9IHRoaXMuY29udGVudEVsLnF1ZXJ5U2VsZWN0b3IoXCIub2wtaW5mby1wYW5lbFwiKSBhcyBIVE1MRWxlbWVudCB8IG51bGw7XG4gICAgICAgIGlmICghcGFuZWwpIHJldHVybjtcbiAgICAgICAgY29uc3QgdGFyZ2V0ID0gZS50YXJnZXQgYXMgSFRNTEVsZW1lbnQgfCBudWxsO1xuICAgICAgICBpZiAodGFyZ2V0ICYmIHBhbmVsLmNvbnRhaW5zKHRhcmdldCkpIHJldHVybjtcblxuICAgICAgICAvLyBJZiB0aGUgY2xpY2sgd2FzIG9uIHRoZSBjYW52YXMsIHRoZSBjYW52YXMgaGFuZGxlcnMgd2lsbCBkZWNpZGVcbiAgICAgICAgLy8gd2hldGhlciB0byBrZWVwIHNlbGVjdGlvbiAobm9kZSBjbGljaykgb3IgY2xlYXIgKGVtcHR5IGNsaWNrKS5cbiAgICAgICAgaWYgKHRhcmdldCA9PT0gdGhpcy5jYW52YXNFbCkgcmV0dXJuO1xuXG4gICAgICAgIHRoaXMuc2VsZWN0ZWROb2RlID0gbnVsbDtcbiAgICAgICAgdGhpcy51cGRhdGVIaWdobGlnaHRUYXJnZXRzKCk7XG4gICAgICAgIHRoaXMucmVtb3ZlSW5mb1BhbmVsKHRoaXMuY29udGVudEVsKTtcbiAgICAgICAgdGhpcy5uZWVkc1JlZHJhdyA9IHRydWU7XG4gICAgICB9O1xuICAgICAgdGhpcy5jb250ZW50RWwuYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlZG93blwiLCB0aGlzLl9vbkNvbnRhaW5lck1vdXNlRG93biwgdHJ1ZSk7XG4gICAgfVxuXG4gICAgdGhpcy5zdGFydFJlbmRlckxvb3AoKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVzaXplQ2FudmFzKCk6IHZvaWQge1xuICAgIGNvbnN0IGNhbnZhcyA9IHRoaXMuY2FudmFzRWw7XG4gICAgY29uc3Qgd3JhcHBlciA9IHRoaXMuY2FudmFzV3JhcHBlcjtcbiAgICBpZiAoIWNhbnZhcyB8fCAhd3JhcHBlcikgcmV0dXJuO1xuXG4gICAgY29uc3QgdyA9IHdyYXBwZXIuY2xpZW50V2lkdGggfHwgdGhpcy5jb250ZW50RWwuY2xpZW50V2lkdGggfHwgODAwO1xuICAgIGNvbnN0IGggPSB3cmFwcGVyLmNsaWVudEhlaWdodCB8fCB0aGlzLmNvbnRlbnRFbC5jbGllbnRIZWlnaHQgfHwgNjAwO1xuXG4gICAgdGhpcy5kcHIgPSB3aW5kb3cuZGV2aWNlUGl4ZWxSYXRpbyB8fCAxO1xuICAgIGNhbnZhcy53aWR0aCA9IE1hdGgubWF4KDEsIE1hdGguZmxvb3IodyAqIHRoaXMuZHByKSk7XG4gICAgY2FudmFzLmhlaWdodCA9IE1hdGgubWF4KDEsIE1hdGguZmxvb3IoaCAqIHRoaXMuZHByKSk7XG5cbiAgICAvLyBNYWtlIGRyYXdpbmcgY29tbWFuZHMgaW4gQ1NTIHBpeGVsc1xuICAgIGNvbnN0IGN0eCA9IHRoaXMuY3R4ITtcbiAgICBjdHguc2V0VHJhbnNmb3JtKHRoaXMuZHByLCAwLCAwLCB0aGlzLmRwciwgMCwgMCk7XG4gIH1cblxuICAvKiogUmVidWlsZCBzaW11bGF0aW9uIG5vZGVzL2VkZ2VzIGZyb20gY3VycmVudCBncmFwaERhdGEgKyBmaWx0ZXJzICovXG4gIHByaXZhdGUgcmVidWlsZFNpbURhdGEoKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLmdyYXBoRGF0YSkgcmV0dXJuO1xuXG4gICAgY29uc3QgZmlsdGVyZWQgPSB0aGlzLmFwcGx5RmlsdGVycyh0aGlzLmdyYXBoRGF0YSk7XG4gICAgY29uc3QgY29udGFpbmVyID0gdGhpcy5jb250ZW50RWw7XG4gICAgY29uc3Qgd2lkdGggPSBjb250YWluZXIuY2xpZW50V2lkdGggfHwgODAwO1xuICAgIGNvbnN0IGhlaWdodCA9IGNvbnRhaW5lci5jbGllbnRIZWlnaHQgfHwgNjAwO1xuXG4gICAgLy8gU2hvdy9oaWRlIGVtcHR5IHN0YXRlXG4gICAgY29uc3QgZXhpc3RpbmdFbXB0eSA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKFwiLm9sLWVtcHR5LXN0YXRlXCIpO1xuICAgIGlmIChleGlzdGluZ0VtcHR5KSBleGlzdGluZ0VtcHR5LnJlbW92ZSgpO1xuXG4gICAgaWYgKGZpbHRlcmVkLm5vZGVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgaWYgKHRoaXMuY2FudmFzV3JhcHBlcikgdGhpcy5jYW52YXNXcmFwcGVyLnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcbiAgICAgIGNvbnRhaW5lci5jcmVhdGVFbChcImRpdlwiLCB7XG4gICAgICAgIGNsczogXCJvbC1lbXB0eS1zdGF0ZVwiLFxuICAgICAgICB0ZXh0OiBcIk5vIG5vZGVzIG1hdGNoIHRoZSBjdXJyZW50IGZpbHRlcnMuXCIsXG4gICAgICB9KTtcbiAgICAgIGlmICh0aGlzLnNpbXVsYXRpb24pIHsgdGhpcy5zaW11bGF0aW9uLnN0b3AoKTsgdGhpcy5zaW11bGF0aW9uID0gbnVsbDsgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAodGhpcy5jYW52YXNXcmFwcGVyKSB0aGlzLmNhbnZhc1dyYXBwZXIuc3R5bGUuZGlzcGxheSA9IFwiXCI7XG5cbiAgICAvLyBQcmVzZXJ2ZSBleGlzdGluZyBub2RlIHBvc2l0aW9ucyB3aGVyZSBwb3NzaWJsZVxuICAgIGNvbnN0IG9sZFBvc2l0aW9ucyA9IG5ldyBNYXA8c3RyaW5nLCB7IHg6IG51bWJlcjsgeTogbnVtYmVyIH0+KCk7XG4gICAgZm9yIChjb25zdCBuIG9mIHRoaXMuc2ltTm9kZXMpIHtcbiAgICAgIG9sZFBvc2l0aW9ucy5zZXQobi5pZCwgeyB4OiBuLnggPz8gMCwgeTogbi55ID8/IDAgfSk7XG4gICAgfVxuXG4gICAgLy8gT3JwaGFuIGRldGVjdGlvbiBCRUZPUkUgb3B0aW9uYWwgZm9sZGVyIGVkZ2VzLlxuICAgIGNvbnN0IGJhc2VPcnBoYW5zID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgZm9yIChjb25zdCBuIG9mIGZpbHRlcmVkLm5vZGVzKSB7XG4gICAgICBpZiAoKG4uY29ubmVjdGlvbnMgfHwgMCkgPT09IDApIGJhc2VPcnBoYW5zLmFkZChuLmlkKTtcbiAgICB9XG5cbiAgICAvLyBPcHRpb246IGNvbm5lY3Qgb3JwaGFucyB0byB0aGVpciBwYXJlbnQuXG4gICAgLy8gT2JqZWN0LXR5cGUgb3JwaGFucyBsaW5rIHRvIHRoZWlyIHNvdXJjZSBmaWxlOyBmaWxlLXR5cGUgb3JwaGFucyBsaW5rIHRvIHRoZWlyIGZvbGRlci5cbiAgICAvLyBJbXBsZW1lbnRlZCBoZXJlICh2aWV3LWxldmVsKSB0byBhdm9pZCBjaGFuZ2luZyB0aGUgYmFzZSBncmFwaCBtb2RlbC5cbiAgICBjb25zdCBub2Rlc1BsdXMgPSBbLi4uZmlsdGVyZWQubm9kZXNdIGFzIGFueVtdO1xuICAgIGNvbnN0IGVkZ2VzUGx1cyA9IFsuLi5maWx0ZXJlZC5lZGdlc10gYXMgYW55W107XG5cbiAgICBpZiAodGhpcy5jb25maWcubGlua1RvUGFyZW50IHx8IHRoaXMuY29uZmlnLmNvbm5lY3RPcnBoYW5zVG9Gb2xkZXJzKSB7XG4gICAgICBjb25zdCBmb2xkZXJOb2RlSWQgPSAoZm9sZGVyOiBzdHJpbmcpID0+IGBmb2xkZXI6OiR7Zm9sZGVyfWA7XG4gICAgICBjb25zdCBmb2xkZXJMYWJlbCA9IChmb2xkZXI6IHN0cmluZykgPT4ge1xuICAgICAgICBjb25zdCBjbGVhbmVkID0gZm9sZGVyLnJlcGxhY2UoL1xcLyskLywgXCJcIik7XG4gICAgICAgIGlmICghY2xlYW5lZCB8fCBjbGVhbmVkID09PSBcIi9cIikgcmV0dXJuIFwiL1wiO1xuICAgICAgICBjb25zdCBwYXJ0cyA9IGNsZWFuZWQuc3BsaXQoXCIvXCIpLmZpbHRlcihCb29sZWFuKTtcbiAgICAgICAgcmV0dXJuIHBhcnRzW3BhcnRzLmxlbmd0aCAtIDFdIHx8IGNsZWFuZWQ7XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBleGlzdGluZyA9IG5ldyBTZXQobm9kZXNQbHVzLm1hcCgobikgPT4gbi5pZCkpO1xuICAgICAgY29uc3QgZWRnZVNldCA9IG5ldyBTZXQoZWRnZXNQbHVzLm1hcCgoZSkgPT4gW2Uuc291cmNlLCBlLnRhcmdldF0uc29ydCgpLmpvaW4oXCItLVwiKSkpO1xuXG4gICAgICBmb3IgKGNvbnN0IG4gb2YgZmlsdGVyZWQubm9kZXMpIHtcbiAgICAgICAgaWYgKCFiYXNlT3JwaGFucy5oYXMobi5pZCkpIGNvbnRpbnVlO1xuXG4gICAgICAgIGxldCBwYXJlbnRJZDogc3RyaW5nO1xuXG4gICAgICAgIGlmICh0aGlzLmNvbmZpZy5saW5rVG9QYXJlbnQgJiYgbi50eXBlID09PSBcIm9iamVjdFwiKSB7XG4gICAgICAgICAgLy8gT2JqZWN0IG9ycGhhbiBcdTIxOTIgbGluayB0byBpdHMgc291cmNlIGZpbGVcbiAgICAgICAgICBjb25zdCBzb3VyY2VGaWxlSWQgPSBgZmlsZTo6JHtuLmZpbGVQYXRofWA7XG4gICAgICAgICAgcGFyZW50SWQgPSBzb3VyY2VGaWxlSWQ7XG5cbiAgICAgICAgICBpZiAoIWV4aXN0aW5nLmhhcyhwYXJlbnRJZCkpIHtcbiAgICAgICAgICAgIGV4aXN0aW5nLmFkZChwYXJlbnRJZCk7XG4gICAgICAgICAgICBjb25zdCBiYXNlbmFtZSA9IG4uZmlsZVBhdGguc3BsaXQoXCIvXCIpLnBvcCgpPy5yZXBsYWNlKC9cXC5tZCQvaSwgXCJcIikgfHwgbi5maWxlUGF0aDtcbiAgICAgICAgICAgIG5vZGVzUGx1cy5wdXNoKHtcbiAgICAgICAgICAgICAgaWQ6IHBhcmVudElkLFxuICAgICAgICAgICAgICBsYWJlbDogYmFzZW5hbWUsXG4gICAgICAgICAgICAgIHR5cGU6IFwiZmlsZVwiLFxuICAgICAgICAgICAgICBmaWxlUGF0aDogbi5maWxlUGF0aCxcbiAgICAgICAgICAgICAgZmlsZUxhYmVsOiBiYXNlbmFtZSxcbiAgICAgICAgICAgICAgcHJvcGVydGllczoge30sXG4gICAgICAgICAgICAgIHN0YXJ0TGluZTogMCxcbiAgICAgICAgICAgICAgY29ubmVjdGlvbnM6IDAsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gRmlsZSBvcnBoYW4gXHUyMTkyIGxpbmsgdG8gaXRzIGZvbGRlclxuICAgICAgICAgIGNvbnN0IHBhdGggPSBuLmZpbGVQYXRoIHx8IFwiXCI7XG4gICAgICAgICAgY29uc3QgaWR4ID0gcGF0aC5sYXN0SW5kZXhPZihcIi9cIik7XG4gICAgICAgICAgY29uc3QgZm9sZGVyID0gaWR4ID4gMCA/IHBhdGguc2xpY2UoMCwgaWR4KSA6IFwiL1wiO1xuICAgICAgICAgIHBhcmVudElkID0gZm9sZGVyTm9kZUlkKGZvbGRlcik7XG5cbiAgICAgICAgICBpZiAoIWV4aXN0aW5nLmhhcyhwYXJlbnRJZCkpIHtcbiAgICAgICAgICAgIGV4aXN0aW5nLmFkZChwYXJlbnRJZCk7XG4gICAgICAgICAgICBub2Rlc1BsdXMucHVzaCh7XG4gICAgICAgICAgICAgIGlkOiBwYXJlbnRJZCxcbiAgICAgICAgICAgICAgbGFiZWw6IGZvbGRlckxhYmVsKGZvbGRlciksXG4gICAgICAgICAgICAgIHR5cGU6IFwiZmlsZVwiLFxuICAgICAgICAgICAgICBmaWxlUGF0aDogZm9sZGVyICsgXCIvXCIsXG4gICAgICAgICAgICAgIGZpbGVMYWJlbDogZm9sZGVyTGFiZWwoZm9sZGVyKSxcbiAgICAgICAgICAgICAgcHJvcGVydGllczoge30sXG4gICAgICAgICAgICAgIHN0YXJ0TGluZTogMCxcbiAgICAgICAgICAgICAgY29ubmVjdGlvbnM6IDAsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBlZGdlSWQgPSBbbi5pZCwgcGFyZW50SWRdLnNvcnQoKS5qb2luKFwiLS1cIik7XG4gICAgICAgIGlmICghZWRnZVNldC5oYXMoZWRnZUlkKSkge1xuICAgICAgICAgIGVkZ2VTZXQuYWRkKGVkZ2VJZCk7XG4gICAgICAgICAgZWRnZXNQbHVzLnB1c2goeyBzb3VyY2U6IG4uaWQsIHRhcmdldDogcGFyZW50SWQsIGVkZ2VUeXBlOiBcIndpa2lcIiB9KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IG5vZGVCeUlkID0gbmV3IE1hcDxzdHJpbmcsIFNpbU5vZGU+KCk7XG5cbiAgICB0aGlzLnNpbU5vZGVzID0gbm9kZXNQbHVzLm1hcCgobikgPT4ge1xuICAgICAgY29uc3Qgb2xkID0gb2xkUG9zaXRpb25zLmdldChuLmlkKTtcbiAgICAgIGNvbnN0IGJhc2VBbHBoYSA9IG4udHlwZSA9PT0gXCJvYmplY3RcIiA/IDAuOSA6IDAuNTtcbiAgICAgIGNvbnN0IG5vZGU6IFNpbU5vZGUgPSB7XG4gICAgICAgIC4uLihuIGFzIGFueSksXG4gICAgICAgIGlzT3JwaGFuOiBiYXNlT3JwaGFucy5oYXMobi5pZCksXG4gICAgICAgIHg6IG9sZCA/IG9sZC54IDogKE1hdGgucmFuZG9tKCkgLSAwLjUpICogd2lkdGggKiAwLjQsXG4gICAgICAgIHk6IG9sZCA/IG9sZC55IDogKE1hdGgucmFuZG9tKCkgLSAwLjUpICogaGVpZ2h0ICogMC40LFxuICAgICAgICB2eDogMCxcbiAgICAgICAgdnk6IDAsXG4gICAgICAgIGZ4OiBudWxsLFxuICAgICAgICBmeTogbnVsbCxcbiAgICAgICAgcmFkaXVzOiB0aGlzLmdldE5vZGVSYWRpdXMobiksXG4gICAgICAgIGFscGhhOiBiYXNlQWxwaGEsXG4gICAgICAgIHRhcmdldEFscGhhOiBiYXNlQWxwaGEsXG4gICAgICB9O1xuICAgICAgbm9kZUJ5SWQuc2V0KG5vZGUuaWQsIG5vZGUpO1xuICAgICAgcmV0dXJuIG5vZGU7XG4gICAgfSk7XG5cbiAgICB0aGlzLnNpbUVkZ2VzID0gZWRnZXNQbHVzXG4gICAgICAubWFwKChlKSA9PiB7XG4gICAgICAgIGNvbnN0IHMgPSBub2RlQnlJZC5nZXQoZS5zb3VyY2UpO1xuICAgICAgICBjb25zdCB0ID0gbm9kZUJ5SWQuZ2V0KGUudGFyZ2V0KTtcbiAgICAgICAgaWYgKCFzIHx8ICF0KSByZXR1cm4gbnVsbDtcbiAgICAgICAgY29uc3QgYmFzZUFscGhhID0gZS5lZGdlVHlwZSA9PT0gXCJ3aWtpXCIgPyAwLjM1IDogMC4yNTtcbiAgICAgICAgY29uc3QgZWRnZTogU2ltRWRnZSA9IHtcbiAgICAgICAgICBzb3VyY2U6IHMsXG4gICAgICAgICAgdGFyZ2V0OiB0LFxuICAgICAgICAgIGVkZ2VUeXBlOiBlLmVkZ2VUeXBlLFxuICAgICAgICAgIGFscGhhOiBiYXNlQWxwaGEsXG4gICAgICAgICAgdGFyZ2V0QWxwaGE6IGJhc2VBbHBoYSxcbiAgICAgICAgfTtcbiAgICAgICAgcmV0dXJuIGVkZ2U7XG4gICAgICB9KVxuICAgICAgLmZpbHRlcigoZSk6IGUgaXMgU2ltRWRnZSA9PiBlICE9PSBudWxsKTtcblxuICAgIHRoaXMuaG92ZXJlZE5vZGUgPSBudWxsO1xuICAgIHRoaXMuc2VsZWN0ZWROb2RlID0gbnVsbDtcbiAgICB0aGlzLmRyYWdOb2RlID0gbnVsbDtcblxuICAgIHRoaXMuc3RhcnRTaW11bGF0aW9uKCk7XG4gICAgdGhpcy51cGRhdGVIaWdobGlnaHRUYXJnZXRzKCk7XG4gICAgdGhpcy5uZWVkc1JlZHJhdyA9IHRydWU7XG4gIH1cblxuICBwcml2YXRlIHN0YXJ0U2ltdWxhdGlvbigpOiB2b2lkIHtcbiAgICAvLyBTdG9wIG9sZCBzaW1cbiAgICBpZiAodGhpcy5zaW11bGF0aW9uKSB7XG4gICAgICB0aGlzLnNpbXVsYXRpb24uc3RvcCgpO1xuICAgICAgdGhpcy5zaW11bGF0aW9uLm9uKFwidGlja1wiLCBudWxsKTtcbiAgICAgIHRoaXMuc2ltdWxhdGlvbiA9IG51bGw7XG4gICAgfVxuXG4gICAgY29uc3Qgc2ltID0gZm9yY2VTaW11bGF0aW9uPFNpbU5vZGUsIFNpbUVkZ2U+KHRoaXMuc2ltTm9kZXMpXG4gICAgICAuYWxwaGEoMSlcbiAgICAgIC5hbHBoYVRhcmdldCgwKVxuICAgICAgLmFscGhhRGVjYXkoMC4wMjI4KVxuICAgICAgLmFscGhhTWluKDAuMDAxKVxuICAgICAgLnZlbG9jaXR5RGVjYXkoMC40KTtcblxuICAgIGNvbnN0IGxpbmtGb3JjZSA9IGZvcmNlTGluazxTaW1Ob2RlLCBTaW1FZGdlPih0aGlzLnNpbUVkZ2VzKVxuICAgICAgLmRpc3RhbmNlKHRoaXMuY29uZmlnLmxpbmtEaXN0YW5jZSlcbiAgICAgIC5zdHJlbmd0aCgwLjQpO1xuXG4gICAgLy8gUmVwZWwuIENvbmZpZyBpcyBwb3NpdGl2ZSwgZDMgZXhwZWN0cyBuZWdhdGl2ZSBmb3IgcmVwdWxzaW9uLlxuICAgIGNvbnN0IGNoYXJnZUZvcmNlID0gZm9yY2VNYW55Qm9keTxTaW1Ob2RlPigpXG4gICAgICAuc3RyZW5ndGgoLXRoaXMuY29uZmlnLnJlcGVsU3RyZW5ndGgpXG4gICAgICAuZGlzdGFuY2VNYXgoTWF0aC5tYXgodGhpcy5jb25maWcucmVwZWxTdHJlbmd0aCAqIDIsIDYwMCkpO1xuXG4gICAgLy8gQ2VudGVyaW5nOiB1c2UgZm9yY2VYL1kgd2l0aCBjb25maWd1cmFibGUgc3RyZW5ndGguXG4gICAgY29uc3QgY2VudGVyWCA9IGZvcmNlWDxTaW1Ob2RlPigwKS5zdHJlbmd0aCh0aGlzLmNvbmZpZy5jZW50ZXJTdHJlbmd0aCk7XG4gICAgY29uc3QgY2VudGVyWSA9IGZvcmNlWTxTaW1Ob2RlPigwKS5zdHJlbmd0aCh0aGlzLmNvbmZpZy5jZW50ZXJTdHJlbmd0aCk7XG5cbiAgICAvLyBDb2xsaXNpb246IGd1YXJhbnRlZSBub24tb3ZlcmxhcCArIGEgbGl0dGxlIHBhZGRpbmcuXG4gICAgY29uc3QgY29sbGlkZSA9IGZvcmNlQ29sbGlkZTxTaW1Ob2RlPigoZCkgPT4gZC5yYWRpdXMgKyAxNClcbiAgICAgIC5zdHJlbmd0aCgwLjk1KVxuICAgICAgLml0ZXJhdGlvbnMoMik7XG5cbiAgICBzaW1cbiAgICAgIC5mb3JjZShcImxpbmtcIiwgbGlua0ZvcmNlKVxuICAgICAgLmZvcmNlKFwiY2hhcmdlXCIsIGNoYXJnZUZvcmNlKVxuICAgICAgLmZvcmNlKFwiY2VudGVyWFwiLCBjZW50ZXJYKVxuICAgICAgLmZvcmNlKFwiY2VudGVyWVwiLCBjZW50ZXJZKVxuICAgICAgLmZvcmNlKFwiY29sbGlkZVwiLCBjb2xsaWRlKTtcblxuICAgIHNpbS5vbihcInRpY2tcIiwgKCkgPT4ge1xuICAgICAgdGhpcy5uZWVkc1JlZHJhdyA9IHRydWU7XG4gICAgfSk7XG5cbiAgICB0aGlzLnNpbXVsYXRpb24gPSBzaW07XG4gIH1cblxuICAvKiogSGFuZGxlIGNvbmZpZyBwYW5lbCBjaGFuZ2VzIHdpdGhvdXQgcmVidWlsZGluZyB0aGUgZW50aXJlIHZpZXcgKi9cbiAgcHJpdmF0ZSBoYW5kbGVDb25maWdDaGFuZ2UobmV3Q29uZmlnOiBHcmFwaENvbmZpZyk6IHZvaWQge1xuICAgIGNvbnN0IG9sZCA9IHRoaXMuY29uZmlnO1xuICAgIHRoaXMuY29uZmlnID0gbmV3Q29uZmlnO1xuXG4gICAgY29uc3QgZmlsdGVyQ2hhbmdlZCA9XG4gICAgICBvbGQuc2hvd0ZpbGVzICE9PSBuZXdDb25maWcuc2hvd0ZpbGVzIHx8XG4gICAgICBvbGQuc2hvd09iamVjdHMgIT09IG5ld0NvbmZpZy5zaG93T2JqZWN0cyB8fFxuICAgICAgb2xkLnNob3dXaWtpRWRnZXMgIT09IG5ld0NvbmZpZy5zaG93V2lraUVkZ2VzIHx8XG4gICAgICBvbGQuc2hvd09iamVjdEVkZ2VzICE9PSBuZXdDb25maWcuc2hvd09iamVjdEVkZ2VzIHx8XG4gICAgICBvbGQuc2hvd09ycGhhbnMgIT09IG5ld0NvbmZpZy5zaG93T3JwaGFucyB8fFxuICAgICAgb2xkLmNvbm5lY3RPcnBoYW5zVG9Gb2xkZXJzICE9PSBuZXdDb25maWcuY29ubmVjdE9ycGhhbnNUb0ZvbGRlcnMgfHxcbiAgICAgIG9sZC5saW5rVG9QYXJlbnQgIT09IG5ld0NvbmZpZy5saW5rVG9QYXJlbnQgfHxcbiAgICAgIG9sZC5zZWFyY2ggIT09IG5ld0NvbmZpZy5zZWFyY2ggfHxcbiAgICAgIG9sZC5wYXRoRmlsdGVyICE9PSBuZXdDb25maWcucGF0aEZpbHRlciB8fFxuICAgICAgb2xkLnNvdXJjZUZpbHRlciAhPT0gbmV3Q29uZmlnLnNvdXJjZUZpbHRlcjtcblxuICAgIGlmIChmaWx0ZXJDaGFuZ2VkKSB7XG4gICAgICB0aGlzLnJlYnVpbGRTaW1EYXRhKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gVXBkYXRlIHJhZGlpXG4gICAgZm9yIChjb25zdCBuIG9mIHRoaXMuc2ltTm9kZXMpIHtcbiAgICAgIG4ucmFkaXVzID0gdGhpcy5nZXROb2RlUmFkaXVzKG4pO1xuICAgIH1cblxuICAgIC8vIFVwZGF0ZSBmb3JjZXNcbiAgICBpZiAodGhpcy5zaW11bGF0aW9uKSB7XG4gICAgICBjb25zdCBsaW5rID0gdGhpcy5zaW11bGF0aW9uLmZvcmNlKFwibGlua1wiKSBhcyBhbnk7XG4gICAgICBsaW5rPy5kaXN0YW5jZT8uKG5ld0NvbmZpZy5saW5rRGlzdGFuY2UpO1xuXG4gICAgICBjb25zdCBjaGFyZ2UgPSB0aGlzLnNpbXVsYXRpb24uZm9yY2UoXCJjaGFyZ2VcIikgYXMgYW55O1xuICAgICAgY2hhcmdlPy5zdHJlbmd0aD8uKC1uZXdDb25maWcucmVwZWxTdHJlbmd0aCk7XG4gICAgICBjaGFyZ2U/LmRpc3RhbmNlTWF4Py4oTWF0aC5tYXgobmV3Q29uZmlnLnJlcGVsU3RyZW5ndGggKiAyLCA2MDApKTtcblxuICAgICAgY29uc3QgY3ggPSB0aGlzLnNpbXVsYXRpb24uZm9yY2UoXCJjZW50ZXJYXCIpIGFzIGFueTtcbiAgICAgIGN4Py5zdHJlbmd0aD8uKG5ld0NvbmZpZy5jZW50ZXJTdHJlbmd0aCk7XG4gICAgICBjb25zdCBjeSA9IHRoaXMuc2ltdWxhdGlvbi5mb3JjZShcImNlbnRlcllcIikgYXMgYW55O1xuICAgICAgY3k/LnN0cmVuZ3RoPy4obmV3Q29uZmlnLmNlbnRlclN0cmVuZ3RoKTtcblxuICAgICAgY29uc3QgY29sbGlkZSA9IHRoaXMuc2ltdWxhdGlvbi5mb3JjZShcImNvbGxpZGVcIikgYXMgYW55O1xuICAgICAgY29sbGlkZT8ucmFkaXVzPy4oKGQ6IFNpbU5vZGUpID0+IGQucmFkaXVzICsgMTQpO1xuXG4gICAgICB0aGlzLnNpbXVsYXRpb24uYWxwaGEoTWF0aC5tYXgodGhpcy5zaW11bGF0aW9uLmFscGhhKCksIDAuMykpLnJlc3RhcnQoKTtcbiAgICB9XG5cbiAgICB0aGlzLnVwZGF0ZUhpZ2hsaWdodFRhcmdldHMoKTtcbiAgICB0aGlzLm5lZWRzUmVkcmF3ID0gdHJ1ZTtcbiAgfVxuXG4gIC8qIFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFxuICAgICBDYW52YXMgRHJhd1xuICAgICBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTAgKi9cblxuICBwcml2YXRlIGNsZWFyKCk6IHZvaWQge1xuICAgIGNvbnN0IGN0eCA9IHRoaXMuY3R4O1xuICAgIGNvbnN0IGNhbnZhcyA9IHRoaXMuY2FudmFzRWw7XG4gICAgaWYgKCFjdHggfHwgIWNhbnZhcykgcmV0dXJuO1xuICAgIGNvbnN0IHcgPSBjYW52YXMuY2xpZW50V2lkdGg7XG4gICAgY29uc3QgaCA9IGNhbnZhcy5jbGllbnRIZWlnaHQ7XG4gICAgY3R4LnNhdmUoKTtcbiAgICBjdHguc2V0VHJhbnNmb3JtKHRoaXMuZHByLCAwLCAwLCB0aGlzLmRwciwgMCwgMCk7XG4gICAgY3R4LmZpbGxTdHlsZSA9IGNvbG9yVG9DU1ModGhpcy5jb2xvckJnKTtcbiAgICBjdHguZ2xvYmFsQWxwaGEgPSAxO1xuICAgIGN0eC5maWxsUmVjdCgwLCAwLCB3LCBoKTtcbiAgICBjdHgucmVzdG9yZSgpO1xuICB9XG5cbiAgcHJpdmF0ZSBkcmF3KCk6IHZvaWQge1xuICAgIGlmICghdGhpcy5jdHggfHwgIXRoaXMuY2FudmFzRWwpIHJldHVybjtcblxuICAgIC8vIFRoZW1lIG1pZ2h0IGNoYW5nZSBkdXJpbmcgcnVudGltZVxuICAgIHRoaXMucmVmcmVzaENvbG9ycygpO1xuXG4gICAgdGhpcy5jbGVhcigpO1xuXG4gICAgaWYgKHRoaXMuc2ltTm9kZXMubGVuZ3RoID09PSAwKSByZXR1cm47XG5cbiAgICB0aGlzLmRyYXdFZGdlcygpO1xuICAgIHRoaXMuZHJhd05vZGVzKCk7XG4gICAgdGhpcy5kcmF3TGFiZWxzKCk7XG4gIH1cblxuICBwcml2YXRlIGRyYXdFZGdlcygpOiB2b2lkIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCE7XG4gICAgY29uc3QgY2FudmFzID0gdGhpcy5jYW52YXNFbCE7XG4gICAgY29uc3QgdyA9IGNhbnZhcy5jbGllbnRXaWR0aDtcbiAgICBjb25zdCBoID0gY2FudmFzLmNsaWVudEhlaWdodDtcbiAgICBjb25zdCBoYWxmVyA9IHcgLyAyO1xuICAgIGNvbnN0IGhhbGZIID0gaCAvIDI7XG5cbiAgICBpZiAodGhpcy5zaW1FZGdlcy5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAgIGN0eC5zYXZlKCk7XG4gICAgY3R4LmxpbmVXaWR0aCA9IDE7XG4gICAgY3R4LmxpbmVDYXAgPSBcInJvdW5kXCI7XG5cbiAgICBmb3IgKGNvbnN0IGUgb2YgdGhpcy5zaW1FZGdlcykge1xuICAgICAgY29uc3QgcyA9IGUuc291cmNlIGFzIFNpbU5vZGU7XG4gICAgICBjb25zdCB0ID0gZS50YXJnZXQgYXMgU2ltTm9kZTtcblxuICAgICAgY29uc3Qgc3h3ID0gcy54ID8/IDA7XG4gICAgICBjb25zdCBzeXcgPSBzLnkgPz8gMDtcbiAgICAgIGNvbnN0IHR4dyA9IHQueCA/PyAwO1xuICAgICAgY29uc3QgdHl3ID0gdC55ID8/IDA7XG5cbiAgICAgIGNvbnN0IHN4ID0gKHN4dyAtIHRoaXMuY2FtWCkgKiB0aGlzLmNhbVNjYWxlICsgaGFsZlc7XG4gICAgICBjb25zdCBzeSA9IChzeXcgLSB0aGlzLmNhbVkpICogdGhpcy5jYW1TY2FsZSArIGhhbGZIO1xuICAgICAgY29uc3QgdHggPSAodHh3IC0gdGhpcy5jYW1YKSAqIHRoaXMuY2FtU2NhbGUgKyBoYWxmVztcbiAgICAgIGNvbnN0IHR5ID0gKHR5dyAtIHRoaXMuY2FtWSkgKiB0aGlzLmNhbVNjYWxlICsgaGFsZkg7XG5cbiAgICAgIGNvbnN0IGlzV2lraSA9IGUuZWRnZVR5cGUgPT09IFwid2lraVwiO1xuICAgICAgY29uc3QgY29sID0gaXNXaWtpID8gdGhpcy5jb2xvckVkZ2VXaWtpIDogdGhpcy5jb2xvckVkZ2VPYmo7XG5cbiAgICAgIGN0eC5zdHJva2VTdHlsZSA9IGNvbG9yVG9DU1MoY29sKTtcbiAgICAgIGN0eC5nbG9iYWxBbHBoYSA9IGUuYWxwaGE7XG4gICAgICBjdHguYmVnaW5QYXRoKCk7XG4gICAgICBjdHgubW92ZVRvKHN4LCBzeSk7XG4gICAgICBjdHgubGluZVRvKHR4LCB0eSk7XG4gICAgICBjdHguc3Ryb2tlKCk7XG4gICAgfVxuXG4gICAgY3R4LnJlc3RvcmUoKTtcbiAgfVxuXG4gIHByaXZhdGUgZHJhd05vZGVzKCk6IHZvaWQge1xuICAgIGNvbnN0IGN0eCA9IHRoaXMuY3R4ITtcbiAgICBjb25zdCBjYW52YXMgPSB0aGlzLmNhbnZhc0VsITtcbiAgICBjb25zdCB3ID0gY2FudmFzLmNsaWVudFdpZHRoO1xuICAgIGNvbnN0IGggPSBjYW52YXMuY2xpZW50SGVpZ2h0O1xuICAgIGNvbnN0IGhhbGZXID0gdyAvIDI7XG4gICAgY29uc3QgaGFsZkggPSBoIC8gMjtcbiAgICBjb25zdCBmb2N1cyA9IHRoaXMuaG92ZXJlZE5vZGUgfHwgdGhpcy5zZWxlY3RlZE5vZGU7XG5cbiAgICBjdHguc2F2ZSgpO1xuXG4gICAgZm9yIChjb25zdCBuIG9mIHRoaXMuc2ltTm9kZXMpIHtcbiAgICAgIGNvbnN0IG54dyA9IG4ueCA/PyAwO1xuICAgICAgY29uc3Qgbnl3ID0gbi55ID8/IDA7XG5cbiAgICAgIC8vIEFsbCBub2RlcyB1c2UgdGhlIHRoZW1lIGFjY2VudCBjb2xvciwgZXhjZXB0ICpiYXNlIGdyYXBoKiBvcnBoYW5zIHdoaWNoIGFyZSBncmV5LlxuICAgICAgY29uc3QgaXNPcnBoYW4gPSAhIW4uaXNPcnBoYW47XG5cbiAgICAgIGxldCBjb2w6IFtudW1iZXIsIG51bWJlciwgbnVtYmVyXTtcbiAgICAgIGlmIChmb2N1cyAmJiBuID09PSBmb2N1cykge1xuICAgICAgICBjb2wgPSBpc09ycGhhbiA/IHRoaXMuY29sb3JOb2RlRmlsZSA6IHRoaXMuY29sb3JIaWdobGlnaHQ7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb2wgPSBpc09ycGhhbiA/IHRoaXMuY29sb3JOb2RlRmlsZSA6IHRoaXMuY29sb3JOb2RlT2JqZWN0O1xuICAgICAgfVxuXG4gICAgICBjb25zdCBjeCA9IChueHcgLSB0aGlzLmNhbVgpICogdGhpcy5jYW1TY2FsZSArIGhhbGZXO1xuICAgICAgY29uc3QgY3kgPSAobnl3IC0gdGhpcy5jYW1ZKSAqIHRoaXMuY2FtU2NhbGUgKyBoYWxmSDtcblxuICAgICAgLy8gQ2xhbXAgbm9kZSBzaXplIG9uIHNjcmVlbiBzbyB6b29taW5nIGluIGRvZXNuJ3QgY3JlYXRlIGdpYW50IGJhbGxzLlxuICAgICAgY29uc3QgbWF4UiA9IE1hdGgubWF4KDIsIHRoaXMuY29uZmlnLm5vZGVNYXhTY3JlZW5SYWRpdXMpO1xuICAgICAgY29uc3QgciA9IE1hdGgubWluKG1heFIsIG4ucmFkaXVzICogdGhpcy5jYW1TY2FsZSk7XG5cbiAgICAgIGN0eC5maWxsU3R5bGUgPSBjb2xvclRvQ1NTKGNvbCk7XG4gICAgICBjdHguZ2xvYmFsQWxwaGEgPSBuLmFscGhhO1xuICAgICAgY3R4LmJlZ2luUGF0aCgpO1xuICAgICAgY3R4LmFyYyhjeCwgY3ksIHIsIDAsIE1hdGguUEkgKiAyKTtcbiAgICAgIGN0eC5maWxsKCk7XG4gICAgfVxuXG4gICAgY3R4LnJlc3RvcmUoKTtcbiAgfVxuXG4gIHByaXZhdGUgZHJhd0xhYmVscygpOiB2b2lkIHtcbiAgICBjb25zdCBjdHggPSB0aGlzLmN0eCE7XG4gICAgY29uc3QgY2FudmFzID0gdGhpcy5jYW52YXNFbCE7XG4gICAgY29uc3QgdyA9IGNhbnZhcy5jbGllbnRXaWR0aDtcbiAgICBjb25zdCBoID0gY2FudmFzLmNsaWVudEhlaWdodDtcbiAgICBjb25zdCBoYWxmVyA9IHcgLyAyO1xuICAgIGNvbnN0IGhhbGZIID0gaCAvIDI7XG5cbiAgICBjb25zdCBsYWJlbE9wYWNpdHkgPSB0aGlzLmNvbmZpZy5sYWJlbE9wYWNpdHk7XG4gICAgY29uc3Qgem9vbUZhY3RvciA9IHRoaXMuY2FtU2NhbGU7XG5cbiAgICAvLyBPbmx5IHNob3cgbGFiZWxzIGFmdGVyIGEgem9vbSB0aHJlc2hvbGQgKGNvbmZpZ3VyYWJsZSksIGFuZCBzY2FsZSBmb250IHNtb290aGx5LlxuICAgIGNvbnN0IGJhc2VGb250U2l6ZSA9IDExO1xuICAgIGNvbnN0IGZvbnRTaXplID0gTWF0aC5tYXgoOCwgTWF0aC5taW4oMTYsIGJhc2VGb250U2l6ZSAqIE1hdGguc3FydCh6b29tRmFjdG9yKSkpO1xuICAgIGNvbnN0IG1pblpvb20gPSBNYXRoLm1heCgwLCB0aGlzLmNvbmZpZy5sYWJlbE1pblpvb20pO1xuICAgIGNvbnN0IHpvb21HYXRlID0gem9vbUZhY3RvciA+PSBtaW5ab29tO1xuXG4gICAgaWYgKCF6b29tR2F0ZSkgcmV0dXJuO1xuXG4gICAgY3R4LnNhdmUoKTtcbiAgICBjdHguZm9udCA9IGAke2ZvbnRTaXplfXB4IC1hcHBsZS1zeXN0ZW0sIEJsaW5rTWFjU3lzdGVtRm9udCwgXCJTZWdvZSBVSVwiLCBSb2JvdG8sIHNhbnMtc2VyaWZgO1xuICAgIGN0eC50ZXh0QWxpZ24gPSBcImNlbnRlclwiO1xuICAgIGN0eC50ZXh0QmFzZWxpbmUgPSBcInRvcFwiO1xuICAgIGN0eC5maWxsU3R5bGUgPSB0aGlzLmNvbG9yVGV4dDtcblxuICAgIGNvbnN0IHBsYWNlZFJlY3RzOiBBcnJheTx7IHg6IG51bWJlcjsgeTogbnVtYmVyOyB3OiBudW1iZXI7IGg6IG51bWJlciB9PiA9IFtdO1xuICAgIGNvbnN0IGludGVyc2VjdHMgPSAocjE6IGFueSwgcjI6IGFueSkgPT5cbiAgICAgIHIxLnggPCByMi54ICsgcjIudyAmJiByMS54ICsgcjEudyA+IHIyLnggJiYgcjEueSA8IHIyLnkgKyByMi5oICYmIHIxLnkgKyByMS5oID4gcjIueTtcblxuICAgIC8vIEdyZWVkeSBsYWJlbCBwbGFjZW1lbnQgdG8gcmVkdWNlIG92ZXJsYXBwaW5nIGxhYmVscy5cbiAgICBjb25zdCBvcmRlcmVkTm9kZXMgPSBbLi4udGhpcy5zaW1Ob2Rlc10uc29ydCgoYSwgYikgPT4ge1xuICAgICAgaWYgKGIuYWxwaGEgIT09IGEuYWxwaGEpIHJldHVybiBiLmFscGhhIC0gYS5hbHBoYTtcbiAgICAgIHJldHVybiAoYi5jb25uZWN0aW9ucyB8fCAwKSAtIChhLmNvbm5lY3Rpb25zIHx8IDApO1xuICAgIH0pO1xuXG4gICAgY29uc3QgbWF4VyA9IE1hdGgubWF4KDQwLCB0aGlzLmNvbmZpZy5sYWJlbE1heFdpZHRoIHx8IDE2MCk7XG4gICAgY29uc3QgZWxsaXBzaXMgPSBcIlx1MjAyNlwiO1xuXG4gICAgZm9yIChjb25zdCBuIG9mIG9yZGVyZWROb2Rlcykge1xuICAgICAgY29uc3Qgbnh3ID0gbi54ID8/IDA7XG4gICAgICBjb25zdCBueXcgPSBuLnkgPz8gMDtcbiAgICAgIGNvbnN0IHN4ID0gKG54dyAtIHRoaXMuY2FtWCkgKiB0aGlzLmNhbVNjYWxlICsgaGFsZlc7XG4gICAgICBjb25zdCBzeSA9IChueXcgLSB0aGlzLmNhbVkpICogdGhpcy5jYW1TY2FsZSArIGhhbGZIO1xuICAgICAgY29uc3Qgc2NyZWVuWSA9IHN5ICsgbi5yYWRpdXMgKiB0aGlzLmNhbVNjYWxlICsgNjtcblxuICAgICAgLy8gQ3VsbCBvZmYtc2NyZWVuIGxhYmVsc1xuICAgICAgaWYgKHN4IDwgLTEwMCB8fCBzeCA+IHcgKyAxMDAgfHwgc3kgPCAtMTAwIHx8IHN5ID4gaCArIDEwMCkgY29udGludWU7XG5cbiAgICAgIGxldCBhbHBoYTogbnVtYmVyO1xuICAgICAgaWYgKG4udGFyZ2V0QWxwaGEgPCAwLjEpIHtcbiAgICAgICAgYWxwaGEgPSBNYXRoLm1pbihsYWJlbE9wYWNpdHksIG4uYWxwaGEpICogMC4zO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYWxwaGEgPSBsYWJlbE9wYWNpdHkgKiAobi5hbHBoYSAvIE1hdGgubWF4KDAuMDAwMSwgbi50YXJnZXRBbHBoYSkpO1xuICAgICAgICBpZiAobiA9PT0gKHRoaXMuaG92ZXJlZE5vZGUgfHwgdGhpcy5zZWxlY3RlZE5vZGUpKSBhbHBoYSA9IDEuMDtcbiAgICAgIH1cblxuICAgICAgaWYgKGFscGhhIDwgMC4wMSkgY29udGludWU7XG5cbiAgICAgIC8vIFRydW5jYXRlIGxhYmVsIHRvIGEgbWF4IHBpeGVsIHdpZHRoLlxuICAgICAgY29uc3QgZnVsbCA9IG4ubGFiZWw7XG4gICAgICBsZXQgc2hvd24gPSBmdWxsO1xuICAgICAgaWYgKGN0eC5tZWFzdXJlVGV4dChmdWxsKS53aWR0aCA+IG1heFcpIHtcbiAgICAgICAgbGV0IGxvID0gMCwgaGkgPSBmdWxsLmxlbmd0aDtcbiAgICAgICAgd2hpbGUgKGxvIDwgaGkpIHtcbiAgICAgICAgICBjb25zdCBtaWQgPSBNYXRoLmNlaWwoKGxvICsgaGkpIC8gMik7XG4gICAgICAgICAgY29uc3QgY2FuZGlkYXRlID0gZnVsbC5zbGljZSgwLCBtaWQpICsgZWxsaXBzaXM7XG4gICAgICAgICAgaWYgKGN0eC5tZWFzdXJlVGV4dChjYW5kaWRhdGUpLndpZHRoIDw9IG1heFcpIGxvID0gbWlkO1xuICAgICAgICAgIGVsc2UgaGkgPSBtaWQgLSAxO1xuICAgICAgICB9XG4gICAgICAgIHNob3duID0gZnVsbC5zbGljZSgwLCBNYXRoLm1heCgwLCBsbykpICsgZWxsaXBzaXM7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG1ldHJpY3MgPSBjdHgubWVhc3VyZVRleHQoc2hvd24pO1xuICAgICAgY29uc3QgdGV4dFcgPSBtZXRyaWNzLndpZHRoO1xuICAgICAgY29uc3QgdGV4dEggPSBmb250U2l6ZTsgLy8gZ29vZCBlbm91Z2ggZm9yIG92ZXJsYXAgY3VsbGluZ1xuXG4gICAgICBjb25zdCBwYWQgPSAzO1xuICAgICAgY29uc3QgcmVjdCA9IHtcbiAgICAgICAgeDogc3ggLSB0ZXh0VyAvIDIgLSBwYWQsXG4gICAgICAgIHk6IHNjcmVlblkgLSBwYWQsXG4gICAgICAgIHc6IHRleHRXICsgcGFkICogMixcbiAgICAgICAgaDogdGV4dEggKyBwYWQgKiAyLFxuICAgICAgfTtcblxuICAgICAgbGV0IGNvbGxpZGVzID0gZmFsc2U7XG4gICAgICBmb3IgKGNvbnN0IHIgb2YgcGxhY2VkUmVjdHMpIHtcbiAgICAgICAgaWYgKGludGVyc2VjdHMocmVjdCwgcikpIHsgY29sbGlkZXMgPSB0cnVlOyBicmVhazsgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBpc0ZvY3VzID0gbiA9PT0gKHRoaXMuaG92ZXJlZE5vZGUgfHwgdGhpcy5zZWxlY3RlZE5vZGUpO1xuICAgICAgaWYgKCFpc0ZvY3VzICYmIGNvbGxpZGVzKSBjb250aW51ZTtcblxuICAgICAgY3R4Lmdsb2JhbEFscGhhID0gYWxwaGE7XG4gICAgICBjdHguZmlsbFRleHQoc2hvd24sIHN4LCBzY3JlZW5ZKTtcbiAgICAgIHBsYWNlZFJlY3RzLnB1c2gocmVjdCk7XG4gICAgfVxuXG4gICAgY3R4LnJlc3RvcmUoKTtcbiAgfVxuXG4gIC8qIFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFx1MjU1MFxuICAgICBJbnB1dCBIYW5kbGVyc1xuICAgICBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTBcdTI1NTAgKi9cblxuICBwcml2YXRlIHNldHVwSW5wdXRIYW5kbGVycygpOiB2b2lkIHtcbiAgICBjb25zdCBjYW52YXMgPSB0aGlzLmNhbnZhc0VsITtcbiAgICBjb25zdCBjb250YWluZXIgPSB0aGlzLmNvbnRlbnRFbDtcblxuICAgIC8vIGQzLXpvb20gKHBhbiArIHdoZWVsIHpvb20pIG9uIGNhbnZhcy5cbiAgICAvLyBXZSBrZWVwIG91ciBvd24gKGNhbVgvY2FtWS9jYW1TY2FsZSkgY2FtZXJhLCBidXQgZHJpdmUgdGFyZ2V0Q2FtKiBmcm9tIHpvb20gdHJhbnNmb3JtLlxuICAgIGNvbnN0IHVwZGF0ZVRhcmdldEZyb21ab29tID0gKHQ6IGFueSwgc291cmNlRXZlbnQ/OiBFdmVudCB8IG51bGwpID0+IHtcbiAgICAgIGNvbnN0IHcgPSBjYW52YXMuY2xpZW50V2lkdGg7XG4gICAgICBjb25zdCBoID0gY2FudmFzLmNsaWVudEhlaWdodDtcbiAgICAgIGNvbnN0IGsgPSBNYXRoLm1heCgwLjAzLCBNYXRoLm1pbigxMiwgdC5rKSk7XG4gICAgICBjb25zdCB4ID0gdC54O1xuICAgICAgY29uc3QgeSA9IHQueTtcblxuICAgICAgLy8gc2NyZWVuID0gd29ybGQgKiBrICsgKHgsIHkpXG4gICAgICAvLyBvdXIgY2FtZXJhOiBzY3JlZW4gPSAod29ybGQgLSBjYW0pICogayArICh3LzIsaC8yKVxuICAgICAgLy8gPT4geCA9IC1jYW1YKmsgKyB3LzIgID0+IGNhbVggPSAody8yIC0geCkva1xuICAgICAgY29uc3QgY2FtWCA9ICh3IC8gMiAtIHgpIC8gaztcbiAgICAgIGNvbnN0IGNhbVkgPSAoaCAvIDIgLSB5KSAvIGs7XG5cbiAgICAgIHRoaXMuem9vbVRyYW5zZm9ybSA9IHQ7XG4gICAgICB0aGlzLnRhcmdldENhbVNjYWxlID0gaztcbiAgICAgIHRoaXMudGFyZ2V0Q2FtWCA9IGNhbVg7XG4gICAgICB0aGlzLnRhcmdldENhbVkgPSBjYW1ZO1xuXG4gICAgICAvLyBGb3IgZHJhZy1wYW5uaW5nLCBhdm9pZCBjYW1lcmEgbGFnIChrZWVwIGl0IDE6MSkuXG4gICAgICBjb25zdCBzZTogYW55ID0gc291cmNlRXZlbnQgYXMgYW55O1xuICAgICAgY29uc3QgaXNXaGVlbCA9IHNlPy50eXBlID09PSBcIndoZWVsXCI7XG4gICAgICBpZiAoIWlzV2hlZWwpIHtcbiAgICAgICAgdGhpcy5jYW1TY2FsZSA9IHRoaXMudGFyZ2V0Q2FtU2NhbGU7XG4gICAgICAgIHRoaXMuY2FtWCA9IHRoaXMudGFyZ2V0Q2FtWDtcbiAgICAgICAgdGhpcy5jYW1ZID0gdGhpcy50YXJnZXRDYW1ZO1xuICAgICAgfVxuXG4gICAgICB0aGlzLm5lZWRzUmVkcmF3ID0gdHJ1ZTtcbiAgICB9O1xuXG4gICAgLy8gQXR0YWNoIHpvb20gYmVoYXZpb3Igb25jZS5cbiAgICBpZiAoIXRoaXMuem9vbUJlaGF2aW9yKSB7XG4gICAgICB0aGlzLnpvb21CZWhhdmlvciA9IHpvb208SFRNTENhbnZhc0VsZW1lbnQsIHVua25vd24+KClcbiAgICAgICAgLnNjYWxlRXh0ZW50KFswLjAzLCAxMl0pXG4gICAgICAgIC5maWx0ZXIoKGV2ZW50OiBhbnkpID0+IHtcbiAgICAgICAgICAvLyBEaXNhYmxlIHBhbi96b29tIHdoaWxlIGRyYWdnaW5nIGEgbm9kZS5cbiAgICAgICAgICBpZiAodGhpcy5kcmFnTm9kZSkgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgIC8vIE9ubHkgbGVmdCBtb3VzZSBmb3IgZHJhZy1wYW4uXG4gICAgICAgICAgaWYgKGV2ZW50Py50eXBlPy5zdGFydHNXaXRoKFwibW91c2VcIikgJiYgZXZlbnQuYnV0dG9uICE9PSAwKSByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH0pXG4gICAgICAgIC5vbihcInpvb21cIiwgKGV2ZW50OiBhbnkpID0+IHtcbiAgICAgICAgICBpZiAodGhpcy5pc1N5bmNpbmdab29tKSByZXR1cm47XG4gICAgICAgICAgdXBkYXRlVGFyZ2V0RnJvbVpvb20oZXZlbnQudHJhbnNmb3JtLCBldmVudC5zb3VyY2VFdmVudCk7XG4gICAgICAgIH0pO1xuXG4gICAgICBjb25zdCBzZWwgPSBzZWxlY3QoY2FudmFzKTtcbiAgICAgIHNlbC5jYWxsKHRoaXMuem9vbUJlaGF2aW9yIGFzIGFueSk7XG4gICAgICAvLyBXZSBoYW5kbGUgZG91YmxlIGNsaWNrIG91cnNlbHZlcyAob3BlbiBub2RlKSwgc28gZGlzYWJsZSBkMydzIGRlZmF1bHQgem9vbS1vbi1kYmxjbGljay5cbiAgICAgIHNlbC5vbihcImRibGNsaWNrLnpvb21cIiwgbnVsbCk7XG5cbiAgICAgIC8vIEluaXRpYWxpemUgdHJhbnNmb3JtIHRvIG1hdGNoIG91ciBzdGFydGluZyBjYW1lcmEuXG4gICAgICBjb25zdCB3ID0gY2FudmFzLmNsaWVudFdpZHRoO1xuICAgICAgY29uc3QgaCA9IGNhbnZhcy5jbGllbnRIZWlnaHQ7XG4gICAgICBjb25zdCBrID0gdGhpcy50YXJnZXRDYW1TY2FsZTtcbiAgICAgIGNvbnN0IHggPSAtdGhpcy50YXJnZXRDYW1YICogayArIHcgLyAyO1xuICAgICAgY29uc3QgeSA9IC10aGlzLnRhcmdldENhbVkgKiBrICsgaCAvIDI7XG4gICAgICB0aGlzLmlzU3luY2luZ1pvb20gPSB0cnVlO1xuICAgICAgdHJ5IHtcbiAgICAgICAgc2VsLmNhbGwoKHRoaXMuem9vbUJlaGF2aW9yIGFzIGFueSkudHJhbnNmb3JtLCB6b29tSWRlbnRpdHkudHJhbnNsYXRlKHgsIHkpLnNjYWxlKGspKTtcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIHRoaXMuaXNTeW5jaW5nWm9vbSA9IGZhbHNlO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIE1vdXNlIGRvd246IG9ubHkgdXNlZCBmb3Igbm9kZSBkcmFnICsgY2xpY2sgc2VsZWN0aW9uIHRyYWNraW5nLlxuICAgIGxldCBkb3duWCA9IDA7XG4gICAgbGV0IGRvd25ZID0gMDtcbiAgICBsZXQgZG93bk5vZGU6IFNpbU5vZGUgfCBudWxsID0gbnVsbDtcblxuICAgIHRoaXMuX29uTW91c2VEb3duID0gKGU6IE1vdXNlRXZlbnQpID0+IHtcbiAgICAgIGlmIChlLmJ1dHRvbiAhPT0gMCkgcmV0dXJuO1xuICAgICAgY29uc3QgcmVjdCA9IGNhbnZhcy5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgIGNvbnN0IG14ID0gZS5jbGllbnRYIC0gcmVjdC5sZWZ0O1xuICAgICAgY29uc3QgbXkgPSBlLmNsaWVudFkgLSByZWN0LnRvcDtcbiAgICAgIGRvd25YID0gZS5jbGllbnRYO1xuICAgICAgZG93blkgPSBlLmNsaWVudFk7XG4gICAgICBkb3duTm9kZSA9IHRoaXMuaGl0VGVzdE5vZGUobXgsIG15KTtcblxuICAgICAgaWYgKGRvd25Ob2RlKSB7XG4gICAgICAgIC8vIFByZXZlbnQgZDMtem9vbSBmcm9tIHN0YXJ0aW5nIGEgcGFuIHdoZW4gd2UgaW50ZW5kIHRvIGRyYWcgYSBub2RlLlxuICAgICAgICBlLnN0b3BQcm9wYWdhdGlvbigpO1xuXG4gICAgICAgIHRoaXMuZHJhZ05vZGUgPSBkb3duTm9kZTtcbiAgICAgICAgdGhpcy5pc0RyYWdnaW5nID0gZmFsc2U7XG4gICAgICAgIGRvd25Ob2RlLmZ4ID0gZG93bk5vZGUueCA/PyAwO1xuICAgICAgICBkb3duTm9kZS5meSA9IGRvd25Ob2RlLnkgPz8gMDtcbiAgICAgICAgLy8gS2VlcCBkcmFnIHNtb290aCAobGVzcyBhZ2dyZXNzaXZlIHJlaGVhdGluZylcbiAgICAgICAgdGhpcy5zaW11bGF0aW9uPy5hbHBoYVRhcmdldCgwLjE1KS5yZXN0YXJ0KCk7XG4gICAgICB9XG4gICAgfTtcbiAgICBjYW52YXMuYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlZG93blwiLCB0aGlzLl9vbk1vdXNlRG93biwgeyBjYXB0dXJlOiB0cnVlIH0pO1xuXG4gICAgLy8gTW91c2UgbW92ZTogdXBkYXRlIG5vZGUgZHJhZyBPUiBob3Zlci90b29sdGlwLlxuICAgIHRoaXMuX29uTW91c2VNb3ZlID0gKGU6IE1vdXNlRXZlbnQpID0+IHtcbiAgICAgIGNvbnN0IHJlY3QgPSBjYW52YXMuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICBjb25zdCBteCA9IGUuY2xpZW50WCAtIHJlY3QubGVmdDtcbiAgICAgIGNvbnN0IG15ID0gZS5jbGllbnRZIC0gcmVjdC50b3A7XG5cbiAgICAgIGlmICh0aGlzLmRyYWdOb2RlKSB7XG4gICAgICAgIHRoaXMuaXNEcmFnZ2luZyA9IHRydWU7XG4gICAgICAgIGNvbnN0IFt3eCwgd3ldID0gdGhpcy5zY3JlZW5Ub1dvcmxkKG14LCBteSk7XG4gICAgICAgIC8vIFNtb290aCBkcmFnOiBsZXJwIHRvd2FyZHMgdGhlIGN1cnNvciBpbnN0ZWFkIG9mIHNuYXBwaW5nLlxuICAgICAgICBjb25zdCB0ID0gMC4zNTtcbiAgICAgICAgdGhpcy5kcmFnTm9kZS5meCA9IGxlcnAodGhpcy5kcmFnTm9kZS5meCA/PyB3eCwgd3gsIHQpO1xuICAgICAgICB0aGlzLmRyYWdOb2RlLmZ5ID0gbGVycCh0aGlzLmRyYWdOb2RlLmZ5ID8/IHd5LCB3eSwgdCk7XG4gICAgICAgIHRoaXMubmVlZHNSZWRyYXcgPSB0cnVlO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIC8vIEhvdmVyIGRldGVjdGlvblxuICAgICAgY29uc3Qgbm9kZSA9IHRoaXMuaGl0VGVzdE5vZGUobXgsIG15KTtcbiAgICAgIGlmIChub2RlICE9PSB0aGlzLmhvdmVyZWROb2RlKSB7XG4gICAgICAgIHRoaXMuaG92ZXJlZE5vZGUgPSBub2RlO1xuICAgICAgICBjYW52YXMuc3R5bGUuY3Vyc29yID0gbm9kZSA/IFwicG9pbnRlclwiIDogXCJkZWZhdWx0XCI7XG4gICAgICAgIHRoaXMudXBkYXRlSGlnaGxpZ2h0VGFyZ2V0cygpO1xuXG4gICAgICAgIGlmIChub2RlKSB7XG4gICAgICAgICAgdGhpcy5zaG93VG9vbHRpcChub2RlLCBjb250YWluZXIpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMuaGlkZVRvb2x0aXAoY29udGFpbmVyKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmIChub2RlKSB7XG4gICAgICAgIHRoaXMubW92ZVRvb2x0aXAoZSwgY29udGFpbmVyKTtcbiAgICAgIH1cbiAgICB9O1xuICAgIGNhbnZhcy5hZGRFdmVudExpc3RlbmVyKFwibW91c2Vtb3ZlXCIsIHRoaXMuX29uTW91c2VNb3ZlKTtcblxuICAgIC8vIE1vdXNlIHVwOiBkcm9wIGRyYWcgbm9kZSwgaGFuZGxlIGNsaWNrL3NlbGVjdC9kYmxjbGljayBsb2dpYy5cbiAgICB0aGlzLl9vbk1vdXNlVXAgPSAoZTogTW91c2VFdmVudCkgPT4ge1xuICAgICAgY29uc3QgdXBEeCA9IE1hdGguYWJzKGUuY2xpZW50WCAtIGRvd25YKTtcbiAgICAgIGNvbnN0IHVwRHkgPSBNYXRoLmFicyhlLmNsaWVudFkgLSBkb3duWSk7XG4gICAgICBjb25zdCBpc0NsaWNrID0gdXBEeCA8IDMgJiYgdXBEeSA8IDM7XG5cbiAgICAgIGlmICh0aGlzLmRyYWdOb2RlKSB7XG4gICAgICAgIGNvbnN0IHdhc0RyYWdnaW5nID0gdGhpcy5pc0RyYWdnaW5nO1xuICAgICAgICB0aGlzLmRyYWdOb2RlLmZ4ID0gbnVsbDtcbiAgICAgICAgdGhpcy5kcmFnTm9kZS5meSA9IG51bGw7XG5cbiAgICAgICAgaWYgKCF3YXNEcmFnZ2luZykge1xuICAgICAgICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XG4gICAgICAgICAgY29uc3Qgbm9kZSA9IHRoaXMuZHJhZ05vZGU7XG5cbiAgICAgICAgICBpZiAodGhpcy5sYXN0Q2xpY2tJZCA9PT0gbm9kZS5pZCAmJiBub3cgLSB0aGlzLmxhc3RDbGlja1RpbWUgPCAzMDApIHtcbiAgICAgICAgICAgIGlmIChub2RlLnR5cGUgPT09IFwib2JqZWN0XCIgJiYgdGhpcy5uYXZpZ2F0ZVRvT2JqZWN0KSB7XG4gICAgICAgICAgICAgIHRoaXMubmF2aWdhdGVUb09iamVjdChub2RlLmZpbGVQYXRoLCBub2RlLnN0YXJ0TGluZSk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKG5vZGUudHlwZSA9PT0gXCJmaWxlXCIgJiYgdGhpcy5uYXZpZ2F0ZVRvRmlsZSkge1xuICAgICAgICAgICAgICB0aGlzLm5hdmlnYXRlVG9GaWxlKG5vZGUuZmlsZVBhdGgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5sYXN0Q2xpY2tUaW1lID0gMDtcbiAgICAgICAgICAgIHRoaXMubGFzdENsaWNrSWQgPSBcIlwiO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmxhc3RDbGlja1RpbWUgPSBub3c7XG4gICAgICAgICAgICB0aGlzLmxhc3RDbGlja0lkID0gbm9kZS5pZDtcbiAgICAgICAgICAgIHRoaXMuc2VsZWN0ZWROb2RlID0gbm9kZTtcbiAgICAgICAgICAgIHRoaXMudXBkYXRlSGlnaGxpZ2h0VGFyZ2V0cygpO1xuICAgICAgICAgICAgdGhpcy5zaG93SW5mb1BhbmVsKG5vZGUsIGNvbnRhaW5lcik7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5kcmFnTm9kZSA9IG51bGw7XG4gICAgICAgIHRoaXMuaXNEcmFnZ2luZyA9IGZhbHNlO1xuICAgICAgICB0aGlzLnNpbXVsYXRpb24/LmFscGhhVGFyZ2V0KDApO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIC8vIENsaWNrIG9uIGVtcHR5IHNwYWNlIGNsZWFycyBzZWxlY3Rpb24uXG4gICAgICBpZiAoaXNDbGljayAmJiAhZG93bk5vZGUpIHtcbiAgICAgICAgdGhpcy5zZWxlY3RlZE5vZGUgPSBudWxsO1xuICAgICAgICB0aGlzLnVwZGF0ZUhpZ2hsaWdodFRhcmdldHMoKTtcbiAgICAgICAgdGhpcy5yZW1vdmVJbmZvUGFuZWwoY29udGFpbmVyKTtcbiAgICAgIH1cbiAgICB9O1xuICAgIGNhbnZhcy5hZGRFdmVudExpc3RlbmVyKFwibW91c2V1cFwiLCB0aGlzLl9vbk1vdXNlVXApO1xuXG4gICAgLy8gUHJldmVudCBicm93c2VyIGRlZmF1bHRzXG4gICAgdGhpcy5fb25EYmxDbGljayA9IChlOiBNb3VzZUV2ZW50KSA9PiB7IGUucHJldmVudERlZmF1bHQoKTsgfTtcbiAgICBjYW52YXMuYWRkRXZlbnRMaXN0ZW5lcihcImRibGNsaWNrXCIsIHRoaXMuX29uRGJsQ2xpY2spO1xuICB9XG5cbiAgLyogXHUyNTAwXHUyNTAwIFRvb2x0aXAgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwICovXG5cbiAgcHJpdmF0ZSBzaG93VG9vbHRpcChub2RlOiBTaW1Ob2RlLCBjb250YWluZXI6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgbGV0IHRvb2x0aXAgPSBkb2N1bWVudC5ib2R5LnF1ZXJ5U2VsZWN0b3IoXCIub2wtdG9vbHRpcFwiKSBhcyBIVE1MRWxlbWVudDtcbiAgICBpZiAoIXRvb2x0aXApIHtcbiAgICAgIHRvb2x0aXAgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgdG9vbHRpcC5jbGFzc05hbWUgPSBcIm9sLXRvb2x0aXBcIjtcbiAgICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQodG9vbHRpcCk7XG4gICAgfVxuICAgIHRvb2x0aXAudGV4dENvbnRlbnQgPSBub2RlLmxhYmVsO1xuICAgIHRvb2x0aXAuc3R5bGUuZGlzcGxheSA9IFwiYmxvY2tcIjtcbiAgfVxuXG4gIHByaXZhdGUgbW92ZVRvb2x0aXAoZTogTW91c2VFdmVudCwgY29udGFpbmVyOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIGNvbnN0IHRvb2x0aXAgPSBkb2N1bWVudC5ib2R5LnF1ZXJ5U2VsZWN0b3IoXCIub2wtdG9vbHRpcFwiKSBhcyBIVE1MRWxlbWVudDtcbiAgICBpZiAoIXRvb2x0aXApIHJldHVybjtcblxuICAgIGNvbnN0IHR3ID0gdG9vbHRpcC5vZmZzZXRXaWR0aDtcbiAgICBjb25zdCB0aCA9IHRvb2x0aXAub2Zmc2V0SGVpZ2h0O1xuICAgIGNvbnN0IHBhZCA9IDg7XG4gICAgY29uc3QgdncgPSB3aW5kb3cuaW5uZXJXaWR0aDtcbiAgICBjb25zdCB2aCA9IHdpbmRvdy5pbm5lckhlaWdodDtcblxuICAgIGxldCBsZWZ0ID0gZS5jbGllbnRYICsgMTQ7XG4gICAgbGV0IHRvcCA9IGUuY2xpZW50WSAtIDEwO1xuXG4gICAgLy8gRmxpcCBsZWZ0IGlmIG92ZXJmbG93aW5nIHJpZ2h0XG4gICAgaWYgKGxlZnQgKyB0dyArIHBhZCA+IHZ3KSB7XG4gICAgICBsZWZ0ID0gZS5jbGllbnRYIC0gdHcgLSAxNDtcbiAgICB9XG4gICAgbGVmdCA9IE1hdGgubWF4KHBhZCwgTWF0aC5taW4obGVmdCwgdncgLSB0dyAtIHBhZCkpO1xuICAgIHRvcCA9IE1hdGgubWF4KHBhZCwgTWF0aC5taW4odG9wLCB2aCAtIHRoIC0gcGFkKSk7XG5cbiAgICB0b29sdGlwLnN0eWxlLmxlZnQgPSBsZWZ0ICsgXCJweFwiO1xuICAgIHRvb2x0aXAuc3R5bGUudG9wID0gdG9wICsgXCJweFwiO1xuICB9XG5cbiAgcHJpdmF0ZSBoaWRlVG9vbHRpcChjb250YWluZXI6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgY29uc3QgdG9vbHRpcCA9IGRvY3VtZW50LmJvZHkucXVlcnlTZWxlY3RvcihcIi5vbC10b29sdGlwXCIpIGFzIEhUTUxFbGVtZW50O1xuICAgIGlmICh0b29sdGlwKSB0b29sdGlwLnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcbiAgfVxuXG4gIC8qIFx1MjUwMFx1MjUwMCBJbmZvIFBhbmVsIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMCAqL1xuXG4gIHByaXZhdGUgcmVtb3ZlSW5mb1BhbmVsKGNvbnRhaW5lcjogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICBjb25zdCBwYW5lbCA9IGNvbnRhaW5lci5xdWVyeVNlbGVjdG9yKFwiLm9sLWluZm8tcGFuZWxcIik7XG4gICAgaWYgKHBhbmVsKSBwYW5lbC5yZW1vdmUoKTtcbiAgfVxuXG4gIHByaXZhdGUgc2hvd0luZm9QYW5lbChkOiBTaW1Ob2RlLCBjb250YWluZXI6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgdGhpcy5yZW1vdmVJbmZvUGFuZWwoY29udGFpbmVyKTtcblxuICAgIGNvbnN0IHBhbmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICBwYW5lbC5jbGFzc05hbWUgPSBcIm9sLWluZm8tcGFuZWxcIjtcblxuICAgIGNvbnN0IHRpdGxlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICB0aXRsZS5jbGFzc05hbWUgPSBcIm9sLWluZm8tdGl0bGVcIjtcbiAgICB0aXRsZS50ZXh0Q29udGVudCA9IGQubGFiZWw7XG4gICAgcGFuZWwuYXBwZW5kQ2hpbGQodGl0bGUpO1xuXG4gICAgY29uc3QgYmFkZ2UgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIGJhZGdlLmNsYXNzTmFtZSA9IGBvbC1pbmZvLXR5cGUgb2wtaW5mby10eXBlLSR7ZC50eXBlfWA7XG4gICAgYmFkZ2UudGV4dENvbnRlbnQgPSBkLnR5cGUgPT09IFwib2JqZWN0XCIgPyBcIk9iamVjdFwiIDogXCJGaWxlXCI7XG4gICAgcGFuZWwuYXBwZW5kQ2hpbGQoYmFkZ2UpO1xuXG4gICAgY29uc3QgZmlsZVBhdGggPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIGZpbGVQYXRoLmNsYXNzTmFtZSA9IFwib2wtaW5mby1maWxlXCI7XG4gICAgZmlsZVBhdGgudGV4dENvbnRlbnQgPSBkLmZpbGVQYXRoO1xuICAgIHBhbmVsLmFwcGVuZENoaWxkKGZpbGVQYXRoKTtcblxuICAgIGlmIChkLnR5cGUgPT09IFwib2JqZWN0XCIgJiYgT2JqZWN0LmtleXMoZC5wcm9wZXJ0aWVzKS5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBwcm9wcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICBwcm9wcy5jbGFzc05hbWUgPSBcIm9sLWluZm8tcHJvcHNcIjtcbiAgICAgIGZvciAoY29uc3QgW2ssIHZdIG9mIE9iamVjdC5lbnRyaWVzKGQucHJvcGVydGllcykpIHtcbiAgICAgICAgY29uc3Qgcm93ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgICAgcm93LmNsYXNzTmFtZSA9IFwib2wtaW5mby1wcm9wLXJvd1wiO1xuICAgICAgICBjb25zdCBrZXlFbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgICAgICBrZXlFbC5jbGFzc05hbWUgPSBcIm9sLWluZm8tcHJvcC1rZXlcIjtcbiAgICAgICAga2V5RWwudGV4dENvbnRlbnQgPSBrO1xuICAgICAgICBjb25zdCB2YWxFbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgICAgICB2YWxFbC5jbGFzc05hbWUgPSBcIm9sLWluZm8tcHJvcC12YWxcIjtcbiAgICAgICAgdmFsRWwudGV4dENvbnRlbnQgPSB2O1xuICAgICAgICByb3cuYXBwZW5kQ2hpbGQoa2V5RWwpO1xuICAgICAgICByb3cuYXBwZW5kQ2hpbGQodmFsRWwpO1xuICAgICAgICBwcm9wcy5hcHBlbmRDaGlsZChyb3cpO1xuICAgICAgfVxuICAgICAgcGFuZWwuYXBwZW5kQ2hpbGQocHJvcHMpO1xuICAgIH1cblxuICAgIGNvbnN0IGNvbm4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIGNvbm4uY2xhc3NOYW1lID0gXCJvbC1pbmZvLWNvbm5lY3Rpb25zXCI7XG4gICAgY29ubi50ZXh0Q29udGVudCA9IGAke2QuY29ubmVjdGlvbnN9IGNvbm5lY3Rpb24ke2QuY29ubmVjdGlvbnMgIT09IDEgPyBcInNcIiA6IFwiXCJ9YDtcbiAgICBwYW5lbC5hcHBlbmRDaGlsZChjb25uKTtcblxuICAgIGNvbnN0IGdvQnRuID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImJ1dHRvblwiKTtcbiAgICBnb0J0bi5jbGFzc05hbWUgPSBcIm9sLWluZm8tZ28tYnRuXCI7XG4gICAgZ29CdG4udGV4dENvbnRlbnQgPSBkLnR5cGUgPT09IFwib2JqZWN0XCIgPyBcIkdvIHRvIG9iamVjdFwiIDogXCJPcGVuIGZpbGVcIjtcbiAgICBnb0J0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgaWYgKGQudHlwZSA9PT0gXCJvYmplY3RcIiAmJiB0aGlzLm5hdmlnYXRlVG9PYmplY3QpIHtcbiAgICAgICAgdGhpcy5uYXZpZ2F0ZVRvT2JqZWN0KGQuZmlsZVBhdGgsIGQuc3RhcnRMaW5lKTtcbiAgICAgIH0gZWxzZSBpZiAodGhpcy5uYXZpZ2F0ZVRvRmlsZSkge1xuICAgICAgICB0aGlzLm5hdmlnYXRlVG9GaWxlKGQuZmlsZVBhdGgpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHBhbmVsLmFwcGVuZENoaWxkKGdvQnRuKTtcblxuICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChwYW5lbCk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBBcHAsIFBsdWdpblNldHRpbmdUYWIsIFNldHRpbmcgfSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB0eXBlIE9iamVjdExpbmtzUGx1Z2luIGZyb20gXCIuL21haW5cIjtcblxuLyoqXG4gKiBQZXJzaXN0ZW50IHBsdWdpbiBzZXR0aW5ncyAoc2F2ZWQgdG8gZGF0YS5qc29uKS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBPYmplY3RMaW5rc1NldHRpbmdzIHtcbiAgb2JqZWN0RmlsZVRhZzogc3RyaW5nO1xuICBvcGVuT2JqZWN0RmlsZXNJblRhYmxlVmlldzogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGNvbnN0IERFRkFVTFRfU0VUVElOR1M6IE9iamVjdExpbmtzU2V0dGluZ3MgPSB7XG4gIG9iamVjdEZpbGVUYWc6IFwib2JqZWN0LWxpbmtzXCIsXG4gIG9wZW5PYmplY3RGaWxlc0luVGFibGVWaWV3OiBmYWxzZSxcbn07XG5cbi8qKlxuICogUGx1Z2luIHNldHRpbmdzIHRhYiBzaG93biBpbiBPYnNpZGlhbidzIHNldHRpbmdzIHBhbmVsLlxuICovXG5leHBvcnQgY2xhc3MgT2JqZWN0TGlua3NTZXR0aW5nVGFiIGV4dGVuZHMgUGx1Z2luU2V0dGluZ1RhYiB7XG4gIHBsdWdpbjogT2JqZWN0TGlua3NQbHVnaW47XG5cbiAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHBsdWdpbjogT2JqZWN0TGlua3NQbHVnaW4pIHtcbiAgICBzdXBlcihhcHAsIHBsdWdpbik7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gIH1cblxuICBkaXNwbGF5KCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcblxuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwiaDJcIiwgeyB0ZXh0OiBcIk9iamVjdCBMaW5rc1wiIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIk9iamVjdCBmaWxlIHRhZ1wiKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgIFwiVGFnIHVzZWQgdG8gaWRlbnRpZnkgb2JqZWN0IGZpbGVzLiBcIiArXG4gICAgICAgIFwiT25seSBtYXJrZG93biBmaWxlcyB0aGF0IGluY2x1ZGUgdGhpcyB0YWcgd2lsbCBiZSBwYXJzZWQuIFwiICtcbiAgICAgICAgXCJTdXBwb3J0cyBiYXJlICN0YWdzIChlLmcuICNvYmplY3QtbGlua3Mgb24gYW55IGxpbmUpIFwiICtcbiAgICAgICAgXCJhbmQgWUFNTCBmcm9udG1hdHRlciB0YWdzIChlLmcuIHRhZ3M6IFtvYmplY3QtbGlua3NdKS5cIlxuICAgICAgKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoXCJvYmplY3QtbGlua3NcIilcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3Mub2JqZWN0RmlsZVRhZylcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5vYmplY3RGaWxlVGFnID0gdmFsdWUudHJpbSgpO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiT3BlbiBvYmplY3QgZmlsZXMgaW4gdGFibGUgdmlld1wiKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgIFwiV2hlbiBlbmFibGVkLCBmaWxlcyB0YWdnZWQgYXMgb2JqZWN0IGZpbGVzIHdpbGwgb3BlbiBpbiBhIHRhYmxlIHZpZXcgYnkgZGVmYXVsdC4gXCIgK1xuICAgICAgICBcIllvdSBjYW4gYWx3YXlzIHN3aXRjaCBiYWNrIHRvIHRoZSBub3JtYWwgZWRpdG9yIHZpYSB0aGUgdmlldyBtZW51LlwiXG4gICAgICApXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5vcGVuT2JqZWN0RmlsZXNJblRhYmxlVmlldylcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5vcGVuT2JqZWN0RmlsZXNJblRhYmxlVmlldyA9IHZhbHVlO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSlcbiAgICAgICk7XG4gIH1cbn1cblxuLyoqXG4gKiBHcmFwaCBjb25maWd1cmF0aW9uIHBhbmVsIC0tIHJlbmRlcmVkIGluc2lkZSB0aGUgZ3JhcGggdmlldy5cbiAqL1xuXG5leHBvcnQgaW50ZXJmYWNlIEdyYXBoQ29uZmlnIHtcbiAgc2VhcmNoOiBzdHJpbmc7XG4gIHNob3dPcnBoYW5zOiBib29sZWFuO1xuICBzaG93RmlsZXM6IGJvb2xlYW47XG4gIHNob3dPYmplY3RzOiBib29sZWFuO1xuICBzaG93V2lraUVkZ2VzOiBib29sZWFuO1xuICBzaG93T2JqZWN0RWRnZXM6IGJvb2xlYW47XG4gIHBhdGhGaWx0ZXI6IHN0cmluZztcbiAgc291cmNlRmlsdGVyOiBzdHJpbmc7XG4gIGNvbm5lY3RPcnBoYW5zVG9Gb2xkZXJzOiBib29sZWFuO1xuICBsaW5rVG9QYXJlbnQ6IGJvb2xlYW47XG4gIC8vIERpc3BsYXlcbiAgbm9kZVNpemVNdWx0aXBsaWVyOiBudW1iZXI7XG4gIG5vZGVNYXhTY3JlZW5SYWRpdXM6IG51bWJlcjtcbiAgbGFiZWxPcGFjaXR5OiBudW1iZXI7XG4gIGxhYmVsTWluWm9vbTogbnVtYmVyO1xuICBsYWJlbE1heFdpZHRoOiBudW1iZXI7XG4gIC8vIEZvcmNlc1xuICBsaW5rRGlzdGFuY2U6IG51bWJlcjtcbiAgY2VudGVyU3RyZW5ndGg6IG51bWJlcjtcbiAgcmVwZWxTdHJlbmd0aDogbnVtYmVyO1xufVxuXG5leHBvcnQgY29uc3QgREVGQVVMVF9DT05GSUc6IEdyYXBoQ29uZmlnID0ge1xuICBzZWFyY2g6IFwiXCIsXG4gIHNob3dPcnBoYW5zOiBmYWxzZSxcbiAgc2hvd0ZpbGVzOiB0cnVlLFxuICBzaG93T2JqZWN0czogdHJ1ZSxcbiAgc2hvd1dpa2lFZGdlczogdHJ1ZSxcbiAgc2hvd09iamVjdEVkZ2VzOiB0cnVlLFxuICBwYXRoRmlsdGVyOiBcIlwiLFxuICBzb3VyY2VGaWx0ZXI6IFwiXCIsXG4gIGNvbm5lY3RPcnBoYW5zVG9Gb2xkZXJzOiBmYWxzZSxcbiAgbGlua1RvUGFyZW50OiBmYWxzZSxcbiAgLy8gRGlzcGxheVxuICBub2RlU2l6ZU11bHRpcGxpZXI6IDEsXG4gIG5vZGVNYXhTY3JlZW5SYWRpdXM6IDE2LFxuICBsYWJlbE9wYWNpdHk6IDAuNjUsXG4gIGxhYmVsTWluWm9vbTogMS4wNSxcbiAgbGFiZWxNYXhXaWR0aDogMTYwLFxuICAvLyBGb3JjZXNcbiAgbGlua0Rpc3RhbmNlOiAxMDAsXG4gIGNlbnRlclN0cmVuZ3RoOiAwLjAzLFxuICByZXBlbFN0cmVuZ3RoOiAzMDAsXG59O1xuXG5leHBvcnQgdHlwZSBDb25maWdDaGFuZ2VDYWxsYmFjayA9IChjb25maWc6IEdyYXBoQ29uZmlnKSA9PiB2b2lkO1xuXG5leHBvcnQgY2xhc3MgQ29uZmlnUGFuZWwge1xuICBwcml2YXRlIHBhbmVsRWw6IEhUTUxFbGVtZW50O1xuICBwcml2YXRlIGNvbmZpZzogR3JhcGhDb25maWc7XG4gIHByaXZhdGUgb25DaGFuZ2U6IENvbmZpZ0NoYW5nZUNhbGxiYWNrO1xuICBwcml2YXRlIGNvbGxhcHNlZDogUmVjb3JkPHN0cmluZywgYm9vbGVhbj4gPSB7XG4gICAgZmlsdGVyOiBmYWxzZSxcbiAgICBkaXNwbGF5OiB0cnVlLFxuICB9O1xuICBwcml2YXRlIGRlYm91bmNlVGltZXJzOiBNYXA8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0Pj4gPSBuZXcgTWFwKCk7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgcGFyZW50OiBIVE1MRWxlbWVudCxcbiAgICBjb25maWc6IEdyYXBoQ29uZmlnLFxuICAgIG9uQ2hhbmdlOiBDb25maWdDaGFuZ2VDYWxsYmFja1xuICApIHtcbiAgICB0aGlzLmNvbmZpZyA9IHsgLi4uY29uZmlnIH07XG4gICAgdGhpcy5vbkNoYW5nZSA9IG9uQ2hhbmdlO1xuXG4gICAgdGhpcy5wYW5lbEVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICB0aGlzLnBhbmVsRWwuY2xhc3NOYW1lID0gXCJvbC1jb25maWctcGFuZWxcIjtcbiAgICBwYXJlbnQuYXBwZW5kQ2hpbGQodGhpcy5wYW5lbEVsKTtcblxuICAgIHRoaXMucmVuZGVyKCk7XG4gIH1cblxuICBnZXRDb25maWcoKTogR3JhcGhDb25maWcge1xuICAgIHJldHVybiB7IC4uLnRoaXMuY29uZmlnIH07XG4gIH1cblxuICBkZXN0cm95KCk6IHZvaWQge1xuICAgIGZvciAoY29uc3QgdCBvZiB0aGlzLmRlYm91bmNlVGltZXJzLnZhbHVlcygpKSBjbGVhclRpbWVvdXQodCk7XG4gICAgdGhpcy5kZWJvdW5jZVRpbWVycy5jbGVhcigpO1xuICAgIHRoaXMucGFuZWxFbC5yZW1vdmUoKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyKCk6IHZvaWQge1xuICAgIHRoaXMucGFuZWxFbC5lbXB0eSgpO1xuXG4gICAgLy8gXHUyNTAwXHUyNTAwIEZpbHRlciBzZWN0aW9uIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuICAgIHRoaXMucmVuZGVyU2VjdGlvbihcImZpbHRlclwiLCBcIkZpbHRlcnNcIiwgKGNvbnRlbnRFbCkgPT4ge1xuICAgICAgLy8gU2VhcmNoXG4gICAgICB0aGlzLnJlbmRlclRleHRJbnB1dChjb250ZW50RWwsIFwiU2VhcmNoXCIsIHRoaXMuY29uZmlnLnNlYXJjaCwgKHYpID0+IHtcbiAgICAgICAgdGhpcy5jb25maWcuc2VhcmNoID0gdjtcbiAgICAgICAgdGhpcy5lbWl0RGVib3VuY2VkKFwic2VhcmNoXCIsIDI1MCk7XG4gICAgICB9KTtcblxuICAgICAgLy8gUGF0aCBmaWx0ZXJcbiAgICAgIHRoaXMucmVuZGVyVGV4dElucHV0KGNvbnRlbnRFbCwgXCJQYXRoIGZpbHRlclwiLCB0aGlzLmNvbmZpZy5wYXRoRmlsdGVyLCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5wYXRoRmlsdGVyID0gdjtcbiAgICAgICAgdGhpcy5lbWl0RGVib3VuY2VkKFwicGF0aEZpbHRlclwiLCAyNTApO1xuICAgICAgfSwgXCJlLmcuIDAwIERhaWx5XCIpO1xuXG4gICAgICAvLyBTb3VyY2UgZmlsdGVyXG4gICAgICB0aGlzLnJlbmRlclRleHRJbnB1dChjb250ZW50RWwsIFwiU291cmNlIGZpbHRlclwiLCB0aGlzLmNvbmZpZy5zb3VyY2VGaWx0ZXIsICh2KSA9PiB7XG4gICAgICAgIHRoaXMuY29uZmlnLnNvdXJjZUZpbHRlciA9IHY7XG4gICAgICAgIHRoaXMuZW1pdERlYm91bmNlZChcInNvdXJjZUZpbHRlclwiLCAyNTApO1xuICAgICAgfSwgXCJlLmcuIEZpbG1zXCIpO1xuXG4gICAgICAvLyBUb2dnbGVzXG4gICAgICB0aGlzLnJlbmRlclRvZ2dsZShjb250ZW50RWwsIFwiU2hvdyBmaWxlc1wiLCB0aGlzLmNvbmZpZy5zaG93RmlsZXMsICh2KSA9PiB7XG4gICAgICAgIHRoaXMuY29uZmlnLnNob3dGaWxlcyA9IHY7XG4gICAgICAgIHRoaXMuZW1pdCgpO1xuICAgICAgfSk7XG5cbiAgICAgIHRoaXMucmVuZGVyVG9nZ2xlKGNvbnRlbnRFbCwgXCJTaG93IG9iamVjdHNcIiwgdGhpcy5jb25maWcuc2hvd09iamVjdHMsICh2KSA9PiB7XG4gICAgICAgIHRoaXMuY29uZmlnLnNob3dPYmplY3RzID0gdjtcbiAgICAgICAgdGhpcy5lbWl0KCk7XG4gICAgICB9KTtcblxuICAgICAgdGhpcy5yZW5kZXJUb2dnbGUoY29udGVudEVsLCBcIlNob3cgb3JwaGFuc1wiLCB0aGlzLmNvbmZpZy5zaG93T3JwaGFucywgKHYpID0+IHtcbiAgICAgICAgdGhpcy5jb25maWcuc2hvd09ycGhhbnMgPSB2O1xuICAgICAgICB0aGlzLmVtaXQoKTtcbiAgICAgIH0pO1xuXG4gICAgICB0aGlzLnJlbmRlclRvZ2dsZShjb250ZW50RWwsIFwiTGluayB0byBwYXJlbnRcIiwgdGhpcy5jb25maWcubGlua1RvUGFyZW50LCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5saW5rVG9QYXJlbnQgPSB2O1xuICAgICAgICB0aGlzLmVtaXQoKTtcbiAgICAgIH0pO1xuXG4gICAgICB0aGlzLnJlbmRlclRvZ2dsZShjb250ZW50RWwsIFwiV2lraSBsaW5rc1wiLCB0aGlzLmNvbmZpZy5zaG93V2lraUVkZ2VzLCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5zaG93V2lraUVkZ2VzID0gdjtcbiAgICAgICAgdGhpcy5lbWl0KCk7XG4gICAgICB9KTtcblxuICAgICAgdGhpcy5yZW5kZXJUb2dnbGUoY29udGVudEVsLCBcIk9iamVjdCBsaW5rc1wiLCB0aGlzLmNvbmZpZy5zaG93T2JqZWN0RWRnZXMsICh2KSA9PiB7XG4gICAgICAgIHRoaXMuY29uZmlnLnNob3dPYmplY3RFZGdlcyA9IHY7XG4gICAgICAgIHRoaXMuZW1pdCgpO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgRGlzcGxheSBzZWN0aW9uIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuICAgIHRoaXMucmVuZGVyU2VjdGlvbihcImRpc3BsYXlcIiwgXCJEaXNwbGF5XCIsIChjb250ZW50RWwpID0+IHtcbiAgICAgIHRoaXMucmVuZGVyU2xpZGVyKGNvbnRlbnRFbCwgXCJOb2RlIHNpemVcIiwgdGhpcy5jb25maWcubm9kZVNpemVNdWx0aXBsaWVyLCAwLjIsIDMsIDAuMSwgKHYpID0+IHtcbiAgICAgICAgdGhpcy5jb25maWcubm9kZVNpemVNdWx0aXBsaWVyID0gdjtcbiAgICAgICAgdGhpcy5lbWl0KCk7XG4gICAgICB9KTtcblxuICAgICAgdGhpcy5yZW5kZXJTbGlkZXIoY29udGVudEVsLCBcIk5vZGUgbWF4IHNpemUgKG9uIHNjcmVlbilcIiwgdGhpcy5jb25maWcubm9kZU1heFNjcmVlblJhZGl1cywgNiwgNDAsIDEsICh2KSA9PiB7XG4gICAgICAgIHRoaXMuY29uZmlnLm5vZGVNYXhTY3JlZW5SYWRpdXMgPSB2O1xuICAgICAgICB0aGlzLmVtaXQoKTtcbiAgICAgIH0pO1xuXG4gICAgICB0aGlzLnJlbmRlclNsaWRlcihjb250ZW50RWwsIFwiTGFiZWxzIGFwcGVhciBhdCB6b29tXCIsIHRoaXMuY29uZmlnLmxhYmVsTWluWm9vbSwgMC4yLCAzLCAwLjA1LCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5sYWJlbE1pblpvb20gPSB2O1xuICAgICAgICB0aGlzLmVtaXQoKTtcbiAgICAgIH0pO1xuXG4gICAgICB0aGlzLnJlbmRlclNsaWRlcihjb250ZW50RWwsIFwiTGFiZWwgbWF4IHdpZHRoXCIsIHRoaXMuY29uZmlnLmxhYmVsTWF4V2lkdGgsIDYwLCAzNjAsIDEwLCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5sYWJlbE1heFdpZHRoID0gdjtcbiAgICAgICAgdGhpcy5lbWl0KCk7XG4gICAgICB9KTtcblxuICAgICAgdGhpcy5yZW5kZXJTbGlkZXIoY29udGVudEVsLCBcIkxhYmVsIG9wYWNpdHlcIiwgdGhpcy5jb25maWcubGFiZWxPcGFjaXR5LCAwLCAxLCAwLjA1LCAodikgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpZy5sYWJlbE9wYWNpdHkgPSB2O1xuICAgICAgICB0aGlzLmVtaXQoKTtcbiAgICAgIH0pO1xuXG4gICAgICAvLyBGb3JjZXNcbiAgICAgIHRoaXMucmVuZGVyU2xpZGVyKGNvbnRlbnRFbCwgXCJMaW5rIGRpc3RhbmNlXCIsIHRoaXMuY29uZmlnLmxpbmtEaXN0YW5jZSwgMzAsIDUwMCwgMTAsICh2KSA9PiB7XG4gICAgICAgIHRoaXMuY29uZmlnLmxpbmtEaXN0YW5jZSA9IHY7XG4gICAgICAgIHRoaXMuZW1pdCgpO1xuICAgICAgfSk7XG5cbiAgICAgIHRoaXMucmVuZGVyU2xpZGVyKGNvbnRlbnRFbCwgXCJDZW50ZXIgZm9yY2VcIiwgdGhpcy5jb25maWcuY2VudGVyU3RyZW5ndGgsIDAsIDAuMiwgMC4wMDUsICh2KSA9PiB7XG4gICAgICAgIHRoaXMuY29uZmlnLmNlbnRlclN0cmVuZ3RoID0gdjtcbiAgICAgICAgdGhpcy5lbWl0KCk7XG4gICAgICB9KTtcblxuICAgICAgdGhpcy5yZW5kZXJTbGlkZXIoY29udGVudEVsLCBcIlJlcGVsIGZvcmNlXCIsIHRoaXMuY29uZmlnLnJlcGVsU3RyZW5ndGgsIDUwLCAxMDAwLCAyNSwgKHYpID0+IHtcbiAgICAgICAgdGhpcy5jb25maWcucmVwZWxTdHJlbmd0aCA9IHY7XG4gICAgICAgIHRoaXMuZW1pdCgpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlclNlY3Rpb24oXG4gICAga2V5OiBzdHJpbmcsXG4gICAgdGl0bGU6IHN0cmluZyxcbiAgICBjb250ZW50Rm46IChjb250ZW50RWw6IEhUTUxFbGVtZW50KSA9PiB2b2lkXG4gICk6IHZvaWQge1xuICAgIGNvbnN0IHNlY3Rpb24gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHNlY3Rpb24uY2xhc3NOYW1lID0gXCJvbC1jb25maWctc2VjdGlvblwiO1xuXG4gICAgY29uc3QgaGVhZGVyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICBoZWFkZXIuY2xhc3NOYW1lID0gXCJvbC1jb25maWctc2VjdGlvbi1oZWFkZXJcIjtcbiAgICBoZWFkZXIuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgIHRoaXMuY29sbGFwc2VkW2tleV0gPSAhdGhpcy5jb2xsYXBzZWRba2V5XTtcbiAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgfSk7XG5cbiAgICBjb25zdCBhcnJvdyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgIGFycm93LmNsYXNzTmFtZSA9IFwib2wtY29uZmlnLWFycm93XCI7XG4gICAgYXJyb3cudGV4dENvbnRlbnQgPSB0aGlzLmNvbGxhcHNlZFtrZXldID8gXCJcXHUyNUI2XCIgOiBcIlxcdTI1QkNcIjtcbiAgICBoZWFkZXIuYXBwZW5kQ2hpbGQoYXJyb3cpO1xuXG4gICAgY29uc3QgdGl0bGVFbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgIHRpdGxlRWwudGV4dENvbnRlbnQgPSB0aXRsZTtcbiAgICBoZWFkZXIuYXBwZW5kQ2hpbGQodGl0bGVFbCk7XG5cbiAgICBzZWN0aW9uLmFwcGVuZENoaWxkKGhlYWRlcik7XG5cbiAgICBpZiAoIXRoaXMuY29sbGFwc2VkW2tleV0pIHtcbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgY29udGVudC5jbGFzc05hbWUgPSBcIm9sLWNvbmZpZy1zZWN0aW9uLWNvbnRlbnRcIjtcbiAgICAgIHNlY3Rpb24uYXBwZW5kQ2hpbGQoY29udGVudCk7XG4gICAgICBjb250ZW50Rm4oY29udGVudCk7XG4gICAgfVxuXG4gICAgdGhpcy5wYW5lbEVsLmFwcGVuZENoaWxkKHNlY3Rpb24pO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJUZXh0SW5wdXQoXG4gICAgcGFyZW50OiBIVE1MRWxlbWVudCxcbiAgICBsYWJlbDogc3RyaW5nLFxuICAgIHZhbHVlOiBzdHJpbmcsXG4gICAgb25DaGFuZ2U6ICh2OiBzdHJpbmcpID0+IHZvaWQsXG4gICAgcGxhY2Vob2xkZXI/OiBzdHJpbmdcbiAgKTogdm9pZCB7XG4gICAgY29uc3Qgcm93ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICByb3cuY2xhc3NOYW1lID0gXCJvbC1jb25maWctcm93IG9sLWNvbmZpZy10ZXh0LXJvd1wiO1xuXG4gICAgY29uc3QgbGFiZWxFbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgIGxhYmVsRWwuY2xhc3NOYW1lID0gXCJvbC1jb25maWctbGFiZWxcIjtcbiAgICBsYWJlbEVsLnRleHRDb250ZW50ID0gbGFiZWw7XG4gICAgcm93LmFwcGVuZENoaWxkKGxhYmVsRWwpO1xuXG4gICAgY29uc3QgaW5wdXQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiaW5wdXRcIik7XG4gICAgaW5wdXQudHlwZSA9IFwidGV4dFwiO1xuICAgIGlucHV0LmNsYXNzTmFtZSA9IFwib2wtY29uZmlnLWlucHV0XCI7XG4gICAgaW5wdXQucGxhY2Vob2xkZXIgPSBwbGFjZWhvbGRlciB8fCBcIlwiO1xuICAgIGlucHV0LnZhbHVlID0gdmFsdWU7XG4gICAgaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImlucHV0XCIsICgpID0+IG9uQ2hhbmdlKGlucHV0LnZhbHVlKSk7XG5cbiAgICByb3cuYXBwZW5kQ2hpbGQoaW5wdXQpO1xuICAgIHBhcmVudC5hcHBlbmRDaGlsZChyb3cpO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJUb2dnbGUoXG4gICAgcGFyZW50OiBIVE1MRWxlbWVudCxcbiAgICBsYWJlbDogc3RyaW5nLFxuICAgIHZhbHVlOiBib29sZWFuLFxuICAgIG9uQ2hhbmdlOiAodjogYm9vbGVhbikgPT4gdm9pZFxuICApOiB2b2lkIHtcbiAgICBjb25zdCByb3cgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHJvdy5jbGFzc05hbWUgPSBcIm9sLWNvbmZpZy1yb3cgb2wtY29uZmlnLXRvZ2dsZS1yb3dcIjtcblxuICAgIGNvbnN0IGxhYmVsRWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcbiAgICBsYWJlbEVsLmNsYXNzTmFtZSA9IFwib2wtY29uZmlnLWxhYmVsXCI7XG4gICAgbGFiZWxFbC50ZXh0Q29udGVudCA9IGxhYmVsO1xuICAgIHJvdy5hcHBlbmRDaGlsZChsYWJlbEVsKTtcblxuICAgIGNvbnN0IHRvZ2dsZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgdG9nZ2xlLmNsYXNzTmFtZSA9IGBvbC1jb25maWctdG9nZ2xlICR7dmFsdWUgPyBcImlzLWVuYWJsZWRcIiA6IFwiXCJ9YDtcblxuICAgIGNvbnN0IGtub2IgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIGtub2IuY2xhc3NOYW1lID0gXCJvbC1jb25maWctdG9nZ2xlLWtub2JcIjtcbiAgICB0b2dnbGUuYXBwZW5kQ2hpbGQoa25vYik7XG5cbiAgICB0b2dnbGUuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IG5ld1ZhbCA9ICF0b2dnbGUuY2xhc3NMaXN0LmNvbnRhaW5zKFwiaXMtZW5hYmxlZFwiKTtcbiAgICAgIHRvZ2dsZS5jbGFzc0xpc3QudG9nZ2xlKFwiaXMtZW5hYmxlZFwiLCBuZXdWYWwpO1xuICAgICAgb25DaGFuZ2UobmV3VmFsKTtcbiAgICB9KTtcblxuICAgIHJvdy5hcHBlbmRDaGlsZCh0b2dnbGUpO1xuICAgIHBhcmVudC5hcHBlbmRDaGlsZChyb3cpO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJTbGlkZXIoXG4gICAgcGFyZW50OiBIVE1MRWxlbWVudCxcbiAgICBsYWJlbDogc3RyaW5nLFxuICAgIHZhbHVlOiBudW1iZXIsXG4gICAgbWluOiBudW1iZXIsXG4gICAgbWF4OiBudW1iZXIsXG4gICAgc3RlcDogbnVtYmVyLFxuICAgIG9uQ2hhbmdlOiAodjogbnVtYmVyKSA9PiB2b2lkXG4gICk6IHZvaWQge1xuICAgIGNvbnN0IHNldHRpbmdJdGVtID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICBzZXR0aW5nSXRlbS5jbGFzc05hbWUgPSBcInNldHRpbmctaXRlbSBtb2Qtc2xpZGVyXCI7XG5cbiAgICBjb25zdCBpbmZvID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICBpbmZvLmNsYXNzTmFtZSA9IFwic2V0dGluZy1pdGVtLWluZm9cIjtcblxuICAgIGNvbnN0IG5hbWUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIG5hbWUuY2xhc3NOYW1lID0gXCJzZXR0aW5nLWl0ZW0tbmFtZVwiO1xuICAgIG5hbWUudGV4dENvbnRlbnQgPSBsYWJlbDtcbiAgICBpbmZvLmFwcGVuZENoaWxkKG5hbWUpO1xuXG4gICAgY29uc3QgZGVzYyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgZGVzYy5jbGFzc05hbWUgPSBcInNldHRpbmctaXRlbS1kZXNjcmlwdGlvblwiO1xuICAgIGluZm8uYXBwZW5kQ2hpbGQoZGVzYyk7XG5cbiAgICBzZXR0aW5nSXRlbS5hcHBlbmRDaGlsZChpbmZvKTtcblxuICAgIGNvbnN0IGNvbnRyb2wgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIGNvbnRyb2wuY2xhc3NOYW1lID0gXCJzZXR0aW5nLWl0ZW0tY29udHJvbFwiO1xuXG4gICAgY29uc3Qgc2xpZGVyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImlucHV0XCIpO1xuICAgIHNsaWRlci5jbGFzc05hbWUgPSBcInNsaWRlclwiO1xuICAgIHNsaWRlci50eXBlID0gXCJyYW5nZVwiO1xuICAgIHNsaWRlci5kYXRhc2V0Lmlnbm9yZVN3aXBlID0gXCJ0cnVlXCI7XG4gICAgc2xpZGVyLm1pbiA9IFN0cmluZyhtaW4pO1xuICAgIHNsaWRlci5tYXggPSBTdHJpbmcobWF4KTtcbiAgICBzbGlkZXIuc3RlcCA9IFN0cmluZyhzdGVwKTtcbiAgICBzbGlkZXIudmFsdWUgPSBTdHJpbmcodmFsdWUpO1xuICAgIHNsaWRlci5hZGRFdmVudExpc3RlbmVyKFwiaW5wdXRcIiwgKCkgPT4ge1xuICAgICAgb25DaGFuZ2UocGFyc2VGbG9hdChzbGlkZXIudmFsdWUpKTtcbiAgICB9KTtcblxuICAgIGNvbnRyb2wuYXBwZW5kQ2hpbGQoc2xpZGVyKTtcbiAgICBzZXR0aW5nSXRlbS5hcHBlbmRDaGlsZChjb250cm9sKTtcbiAgICBwYXJlbnQuYXBwZW5kQ2hpbGQoc2V0dGluZ0l0ZW0pO1xuICB9XG5cbiAgcHJpdmF0ZSBlbWl0KCk6IHZvaWQge1xuICAgIHRoaXMub25DaGFuZ2UoeyAuLi50aGlzLmNvbmZpZyB9KTtcbiAgfVxuXG4gIHByaXZhdGUgZW1pdERlYm91bmNlZChrZXk6IHN0cmluZywgbXM6IG51bWJlcik6IHZvaWQge1xuICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5kZWJvdW5jZVRpbWVycy5nZXQoa2V5KTtcbiAgICBpZiAoZXhpc3RpbmcpIGNsZWFyVGltZW91dChleGlzdGluZyk7XG4gICAgdGhpcy5kZWJvdW5jZVRpbWVycy5zZXQoa2V5LCBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMuZGVib3VuY2VUaW1lcnMuZGVsZXRlKGtleSk7XG4gICAgICB0aGlzLmVtaXQoKTtcbiAgICB9LCBtcykpO1xuICB9XG59XG4iLCAidmFyIG5vb3AgPSB7dmFsdWU6ICgpID0+IHt9fTtcblxuZnVuY3Rpb24gZGlzcGF0Y2goKSB7XG4gIGZvciAodmFyIGkgPSAwLCBuID0gYXJndW1lbnRzLmxlbmd0aCwgXyA9IHt9LCB0OyBpIDwgbjsgKytpKSB7XG4gICAgaWYgKCEodCA9IGFyZ3VtZW50c1tpXSArIFwiXCIpIHx8ICh0IGluIF8pIHx8IC9bXFxzLl0vLnRlc3QodCkpIHRocm93IG5ldyBFcnJvcihcImlsbGVnYWwgdHlwZTogXCIgKyB0KTtcbiAgICBfW3RdID0gW107XG4gIH1cbiAgcmV0dXJuIG5ldyBEaXNwYXRjaChfKTtcbn1cblxuZnVuY3Rpb24gRGlzcGF0Y2goXykge1xuICB0aGlzLl8gPSBfO1xufVxuXG5mdW5jdGlvbiBwYXJzZVR5cGVuYW1lcyh0eXBlbmFtZXMsIHR5cGVzKSB7XG4gIHJldHVybiB0eXBlbmFtZXMudHJpbSgpLnNwbGl0KC9efFxccysvKS5tYXAoZnVuY3Rpb24odCkge1xuICAgIHZhciBuYW1lID0gXCJcIiwgaSA9IHQuaW5kZXhPZihcIi5cIik7XG4gICAgaWYgKGkgPj0gMCkgbmFtZSA9IHQuc2xpY2UoaSArIDEpLCB0ID0gdC5zbGljZSgwLCBpKTtcbiAgICBpZiAodCAmJiAhdHlwZXMuaGFzT3duUHJvcGVydHkodCkpIHRocm93IG5ldyBFcnJvcihcInVua25vd24gdHlwZTogXCIgKyB0KTtcbiAgICByZXR1cm4ge3R5cGU6IHQsIG5hbWU6IG5hbWV9O1xuICB9KTtcbn1cblxuRGlzcGF0Y2gucHJvdG90eXBlID0gZGlzcGF0Y2gucHJvdG90eXBlID0ge1xuICBjb25zdHJ1Y3RvcjogRGlzcGF0Y2gsXG4gIG9uOiBmdW5jdGlvbih0eXBlbmFtZSwgY2FsbGJhY2spIHtcbiAgICB2YXIgXyA9IHRoaXMuXyxcbiAgICAgICAgVCA9IHBhcnNlVHlwZW5hbWVzKHR5cGVuYW1lICsgXCJcIiwgXyksXG4gICAgICAgIHQsXG4gICAgICAgIGkgPSAtMSxcbiAgICAgICAgbiA9IFQubGVuZ3RoO1xuXG4gICAgLy8gSWYgbm8gY2FsbGJhY2sgd2FzIHNwZWNpZmllZCwgcmV0dXJuIHRoZSBjYWxsYmFjayBvZiB0aGUgZ2l2ZW4gdHlwZSBhbmQgbmFtZS5cbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA8IDIpIHtcbiAgICAgIHdoaWxlICgrK2kgPCBuKSBpZiAoKHQgPSAodHlwZW5hbWUgPSBUW2ldKS50eXBlKSAmJiAodCA9IGdldChfW3RdLCB0eXBlbmFtZS5uYW1lKSkpIHJldHVybiB0O1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIElmIGEgdHlwZSB3YXMgc3BlY2lmaWVkLCBzZXQgdGhlIGNhbGxiYWNrIGZvciB0aGUgZ2l2ZW4gdHlwZSBhbmQgbmFtZS5cbiAgICAvLyBPdGhlcndpc2UsIGlmIGEgbnVsbCBjYWxsYmFjayB3YXMgc3BlY2lmaWVkLCByZW1vdmUgY2FsbGJhY2tzIG9mIHRoZSBnaXZlbiBuYW1lLlxuICAgIGlmIChjYWxsYmFjayAhPSBudWxsICYmIHR5cGVvZiBjYWxsYmFjayAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3IoXCJpbnZhbGlkIGNhbGxiYWNrOiBcIiArIGNhbGxiYWNrKTtcbiAgICB3aGlsZSAoKytpIDwgbikge1xuICAgICAgaWYgKHQgPSAodHlwZW5hbWUgPSBUW2ldKS50eXBlKSBfW3RdID0gc2V0KF9bdF0sIHR5cGVuYW1lLm5hbWUsIGNhbGxiYWNrKTtcbiAgICAgIGVsc2UgaWYgKGNhbGxiYWNrID09IG51bGwpIGZvciAodCBpbiBfKSBfW3RdID0gc2V0KF9bdF0sIHR5cGVuYW1lLm5hbWUsIG51bGwpO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzO1xuICB9LFxuICBjb3B5OiBmdW5jdGlvbigpIHtcbiAgICB2YXIgY29weSA9IHt9LCBfID0gdGhpcy5fO1xuICAgIGZvciAodmFyIHQgaW4gXykgY29weVt0XSA9IF9bdF0uc2xpY2UoKTtcbiAgICByZXR1cm4gbmV3IERpc3BhdGNoKGNvcHkpO1xuICB9LFxuICBjYWxsOiBmdW5jdGlvbih0eXBlLCB0aGF0KSB7XG4gICAgaWYgKChuID0gYXJndW1lbnRzLmxlbmd0aCAtIDIpID4gMCkgZm9yICh2YXIgYXJncyA9IG5ldyBBcnJheShuKSwgaSA9IDAsIG4sIHQ7IGkgPCBuOyArK2kpIGFyZ3NbaV0gPSBhcmd1bWVudHNbaSArIDJdO1xuICAgIGlmICghdGhpcy5fLmhhc093blByb3BlcnR5KHR5cGUpKSB0aHJvdyBuZXcgRXJyb3IoXCJ1bmtub3duIHR5cGU6IFwiICsgdHlwZSk7XG4gICAgZm9yICh0ID0gdGhpcy5fW3R5cGVdLCBpID0gMCwgbiA9IHQubGVuZ3RoOyBpIDwgbjsgKytpKSB0W2ldLnZhbHVlLmFwcGx5KHRoYXQsIGFyZ3MpO1xuICB9LFxuICBhcHBseTogZnVuY3Rpb24odHlwZSwgdGhhdCwgYXJncykge1xuICAgIGlmICghdGhpcy5fLmhhc093blByb3BlcnR5KHR5cGUpKSB0aHJvdyBuZXcgRXJyb3IoXCJ1bmtub3duIHR5cGU6IFwiICsgdHlwZSk7XG4gICAgZm9yICh2YXIgdCA9IHRoaXMuX1t0eXBlXSwgaSA9IDAsIG4gPSB0Lmxlbmd0aDsgaSA8IG47ICsraSkgdFtpXS52YWx1ZS5hcHBseSh0aGF0LCBhcmdzKTtcbiAgfVxufTtcblxuZnVuY3Rpb24gZ2V0KHR5cGUsIG5hbWUpIHtcbiAgZm9yICh2YXIgaSA9IDAsIG4gPSB0eXBlLmxlbmd0aCwgYzsgaSA8IG47ICsraSkge1xuICAgIGlmICgoYyA9IHR5cGVbaV0pLm5hbWUgPT09IG5hbWUpIHtcbiAgICAgIHJldHVybiBjLnZhbHVlO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBzZXQodHlwZSwgbmFtZSwgY2FsbGJhY2spIHtcbiAgZm9yICh2YXIgaSA9IDAsIG4gPSB0eXBlLmxlbmd0aDsgaSA8IG47ICsraSkge1xuICAgIGlmICh0eXBlW2ldLm5hbWUgPT09IG5hbWUpIHtcbiAgICAgIHR5cGVbaV0gPSBub29wLCB0eXBlID0gdHlwZS5zbGljZSgwLCBpKS5jb25jYXQodHlwZS5zbGljZShpICsgMSkpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG4gIGlmIChjYWxsYmFjayAhPSBudWxsKSB0eXBlLnB1c2goe25hbWU6IG5hbWUsIHZhbHVlOiBjYWxsYmFja30pO1xuICByZXR1cm4gdHlwZTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZGlzcGF0Y2g7XG4iLCAiZXhwb3J0IHZhciB4aHRtbCA9IFwiaHR0cDovL3d3dy53My5vcmcvMTk5OS94aHRtbFwiO1xuXG5leHBvcnQgZGVmYXVsdCB7XG4gIHN2ZzogXCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiLFxuICB4aHRtbDogeGh0bWwsXG4gIHhsaW5rOiBcImh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmtcIixcbiAgeG1sOiBcImh0dHA6Ly93d3cudzMub3JnL1hNTC8xOTk4L25hbWVzcGFjZVwiLFxuICB4bWxuczogXCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3htbG5zL1wiXG59O1xuIiwgImltcG9ydCBuYW1lc3BhY2VzIGZyb20gXCIuL25hbWVzcGFjZXMuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSkge1xuICB2YXIgcHJlZml4ID0gbmFtZSArPSBcIlwiLCBpID0gcHJlZml4LmluZGV4T2YoXCI6XCIpO1xuICBpZiAoaSA+PSAwICYmIChwcmVmaXggPSBuYW1lLnNsaWNlKDAsIGkpKSAhPT0gXCJ4bWxuc1wiKSBuYW1lID0gbmFtZS5zbGljZShpICsgMSk7XG4gIHJldHVybiBuYW1lc3BhY2VzLmhhc093blByb3BlcnR5KHByZWZpeCkgPyB7c3BhY2U6IG5hbWVzcGFjZXNbcHJlZml4XSwgbG9jYWw6IG5hbWV9IDogbmFtZTsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby1wcm90b3R5cGUtYnVpbHRpbnNcbn1cbiIsICJpbXBvcnQgbmFtZXNwYWNlIGZyb20gXCIuL25hbWVzcGFjZS5qc1wiO1xuaW1wb3J0IHt4aHRtbH0gZnJvbSBcIi4vbmFtZXNwYWNlcy5qc1wiO1xuXG5mdW5jdGlvbiBjcmVhdG9ySW5oZXJpdChuYW1lKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgZG9jdW1lbnQgPSB0aGlzLm93bmVyRG9jdW1lbnQsXG4gICAgICAgIHVyaSA9IHRoaXMubmFtZXNwYWNlVVJJO1xuICAgIHJldHVybiB1cmkgPT09IHhodG1sICYmIGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5uYW1lc3BhY2VVUkkgPT09IHhodG1sXG4gICAgICAgID8gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChuYW1lKVxuICAgICAgICA6IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnROUyh1cmksIG5hbWUpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBjcmVhdG9yRml4ZWQoZnVsbG5hbWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLm93bmVyRG9jdW1lbnQuY3JlYXRlRWxlbWVudE5TKGZ1bGxuYW1lLnNwYWNlLCBmdWxsbmFtZS5sb2NhbCk7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG5hbWUpIHtcbiAgdmFyIGZ1bGxuYW1lID0gbmFtZXNwYWNlKG5hbWUpO1xuICByZXR1cm4gKGZ1bGxuYW1lLmxvY2FsXG4gICAgICA/IGNyZWF0b3JGaXhlZFxuICAgICAgOiBjcmVhdG9ySW5oZXJpdCkoZnVsbG5hbWUpO1xufVxuIiwgImZ1bmN0aW9uIG5vbmUoKSB7fVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihzZWxlY3Rvcikge1xuICByZXR1cm4gc2VsZWN0b3IgPT0gbnVsbCA/IG5vbmUgOiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5xdWVyeVNlbGVjdG9yKHNlbGVjdG9yKTtcbiAgfTtcbn1cbiIsICJpbXBvcnQge1NlbGVjdGlvbn0gZnJvbSBcIi4vaW5kZXguanNcIjtcbmltcG9ydCBzZWxlY3RvciBmcm9tIFwiLi4vc2VsZWN0b3IuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oc2VsZWN0KSB7XG4gIGlmICh0eXBlb2Ygc2VsZWN0ICE9PSBcImZ1bmN0aW9uXCIpIHNlbGVjdCA9IHNlbGVjdG9yKHNlbGVjdCk7XG5cbiAgZm9yICh2YXIgZ3JvdXBzID0gdGhpcy5fZ3JvdXBzLCBtID0gZ3JvdXBzLmxlbmd0aCwgc3ViZ3JvdXBzID0gbmV3IEFycmF5KG0pLCBqID0gMDsgaiA8IG07ICsraikge1xuICAgIGZvciAodmFyIGdyb3VwID0gZ3JvdXBzW2pdLCBuID0gZ3JvdXAubGVuZ3RoLCBzdWJncm91cCA9IHN1Ymdyb3Vwc1tqXSA9IG5ldyBBcnJheShuKSwgbm9kZSwgc3Vibm9kZSwgaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIGlmICgobm9kZSA9IGdyb3VwW2ldKSAmJiAoc3Vibm9kZSA9IHNlbGVjdC5jYWxsKG5vZGUsIG5vZGUuX19kYXRhX18sIGksIGdyb3VwKSkpIHtcbiAgICAgICAgaWYgKFwiX19kYXRhX19cIiBpbiBub2RlKSBzdWJub2RlLl9fZGF0YV9fID0gbm9kZS5fX2RhdGFfXztcbiAgICAgICAgc3ViZ3JvdXBbaV0gPSBzdWJub2RlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBuZXcgU2VsZWN0aW9uKHN1Ymdyb3VwcywgdGhpcy5fcGFyZW50cyk7XG59XG4iLCAiLy8gR2l2ZW4gc29tZXRoaW5nIGFycmF5IGxpa2UgKG9yIG51bGwpLCByZXR1cm5zIHNvbWV0aGluZyB0aGF0IGlzIHN0cmljdGx5IGFuXG4vLyBhcnJheS4gVGhpcyBpcyB1c2VkIHRvIGVuc3VyZSB0aGF0IGFycmF5LWxpa2Ugb2JqZWN0cyBwYXNzZWQgdG8gZDMuc2VsZWN0QWxsXG4vLyBvciBzZWxlY3Rpb24uc2VsZWN0QWxsIGFyZSBjb252ZXJ0ZWQgaW50byBwcm9wZXIgYXJyYXlzIHdoZW4gY3JlYXRpbmcgYVxuLy8gc2VsZWN0aW9uOyB3ZSBkb25cdTIwMTl0IGV2ZXIgd2FudCB0byBjcmVhdGUgYSBzZWxlY3Rpb24gYmFja2VkIGJ5IGEgbGl2ZVxuLy8gSFRNTENvbGxlY3Rpb24gb3IgTm9kZUxpc3QuIEhvd2V2ZXIsIG5vdGUgdGhhdCBzZWxlY3Rpb24uc2VsZWN0QWxsIHdpbGwgdXNlIGFcbi8vIHN0YXRpYyBOb2RlTGlzdCBhcyBhIGdyb3VwLCBzaW5jZSBpdCBzYWZlbHkgZGVyaXZlZCBmcm9tIHF1ZXJ5U2VsZWN0b3JBbGwuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBhcnJheSh4KSB7XG4gIHJldHVybiB4ID09IG51bGwgPyBbXSA6IEFycmF5LmlzQXJyYXkoeCkgPyB4IDogQXJyYXkuZnJvbSh4KTtcbn1cbiIsICJmdW5jdGlvbiBlbXB0eSgpIHtcbiAgcmV0dXJuIFtdO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihzZWxlY3Rvcikge1xuICByZXR1cm4gc2VsZWN0b3IgPT0gbnVsbCA/IGVtcHR5IDogZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMucXVlcnlTZWxlY3RvckFsbChzZWxlY3Rvcik7XG4gIH07XG59XG4iLCAiaW1wb3J0IHtTZWxlY3Rpb259IGZyb20gXCIuL2luZGV4LmpzXCI7XG5pbXBvcnQgYXJyYXkgZnJvbSBcIi4uL2FycmF5LmpzXCI7XG5pbXBvcnQgc2VsZWN0b3JBbGwgZnJvbSBcIi4uL3NlbGVjdG9yQWxsLmpzXCI7XG5cbmZ1bmN0aW9uIGFycmF5QWxsKHNlbGVjdCkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGFycmF5KHNlbGVjdC5hcHBseSh0aGlzLCBhcmd1bWVudHMpKTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oc2VsZWN0KSB7XG4gIGlmICh0eXBlb2Ygc2VsZWN0ID09PSBcImZ1bmN0aW9uXCIpIHNlbGVjdCA9IGFycmF5QWxsKHNlbGVjdCk7XG4gIGVsc2Ugc2VsZWN0ID0gc2VsZWN0b3JBbGwoc2VsZWN0KTtcblxuICBmb3IgKHZhciBncm91cHMgPSB0aGlzLl9ncm91cHMsIG0gPSBncm91cHMubGVuZ3RoLCBzdWJncm91cHMgPSBbXSwgcGFyZW50cyA9IFtdLCBqID0gMDsgaiA8IG07ICsraikge1xuICAgIGZvciAodmFyIGdyb3VwID0gZ3JvdXBzW2pdLCBuID0gZ3JvdXAubGVuZ3RoLCBub2RlLCBpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgaWYgKG5vZGUgPSBncm91cFtpXSkge1xuICAgICAgICBzdWJncm91cHMucHVzaChzZWxlY3QuY2FsbChub2RlLCBub2RlLl9fZGF0YV9fLCBpLCBncm91cCkpO1xuICAgICAgICBwYXJlbnRzLnB1c2gobm9kZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG5ldyBTZWxlY3Rpb24oc3ViZ3JvdXBzLCBwYXJlbnRzKTtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbihzZWxlY3Rvcikge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMubWF0Y2hlcyhzZWxlY3Rvcik7XG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjaGlsZE1hdGNoZXIoc2VsZWN0b3IpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKG5vZGUpIHtcbiAgICByZXR1cm4gbm9kZS5tYXRjaGVzKHNlbGVjdG9yKTtcbiAgfTtcbn1cblxuIiwgImltcG9ydCB7Y2hpbGRNYXRjaGVyfSBmcm9tIFwiLi4vbWF0Y2hlci5qc1wiO1xuXG52YXIgZmluZCA9IEFycmF5LnByb3RvdHlwZS5maW5kO1xuXG5mdW5jdGlvbiBjaGlsZEZpbmQobWF0Y2gpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBmaW5kLmNhbGwodGhpcy5jaGlsZHJlbiwgbWF0Y2gpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBjaGlsZEZpcnN0KCkge1xuICByZXR1cm4gdGhpcy5maXJzdEVsZW1lbnRDaGlsZDtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obWF0Y2gpIHtcbiAgcmV0dXJuIHRoaXMuc2VsZWN0KG1hdGNoID09IG51bGwgPyBjaGlsZEZpcnN0XG4gICAgICA6IGNoaWxkRmluZCh0eXBlb2YgbWF0Y2ggPT09IFwiZnVuY3Rpb25cIiA/IG1hdGNoIDogY2hpbGRNYXRjaGVyKG1hdGNoKSkpO1xufVxuIiwgImltcG9ydCB7Y2hpbGRNYXRjaGVyfSBmcm9tIFwiLi4vbWF0Y2hlci5qc1wiO1xuXG52YXIgZmlsdGVyID0gQXJyYXkucHJvdG90eXBlLmZpbHRlcjtcblxuZnVuY3Rpb24gY2hpbGRyZW4oKSB7XG4gIHJldHVybiBBcnJheS5mcm9tKHRoaXMuY2hpbGRyZW4pO1xufVxuXG5mdW5jdGlvbiBjaGlsZHJlbkZpbHRlcihtYXRjaCkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGZpbHRlci5jYWxsKHRoaXMuY2hpbGRyZW4sIG1hdGNoKTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obWF0Y2gpIHtcbiAgcmV0dXJuIHRoaXMuc2VsZWN0QWxsKG1hdGNoID09IG51bGwgPyBjaGlsZHJlblxuICAgICAgOiBjaGlsZHJlbkZpbHRlcih0eXBlb2YgbWF0Y2ggPT09IFwiZnVuY3Rpb25cIiA/IG1hdGNoIDogY2hpbGRNYXRjaGVyKG1hdGNoKSkpO1xufVxuIiwgImltcG9ydCB7U2VsZWN0aW9ufSBmcm9tIFwiLi9pbmRleC5qc1wiO1xuaW1wb3J0IG1hdGNoZXIgZnJvbSBcIi4uL21hdGNoZXIuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obWF0Y2gpIHtcbiAgaWYgKHR5cGVvZiBtYXRjaCAhPT0gXCJmdW5jdGlvblwiKSBtYXRjaCA9IG1hdGNoZXIobWF0Y2gpO1xuXG4gIGZvciAodmFyIGdyb3VwcyA9IHRoaXMuX2dyb3VwcywgbSA9IGdyb3Vwcy5sZW5ndGgsIHN1Ymdyb3VwcyA9IG5ldyBBcnJheShtKSwgaiA9IDA7IGogPCBtOyArK2opIHtcbiAgICBmb3IgKHZhciBncm91cCA9IGdyb3Vwc1tqXSwgbiA9IGdyb3VwLmxlbmd0aCwgc3ViZ3JvdXAgPSBzdWJncm91cHNbal0gPSBbXSwgbm9kZSwgaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIGlmICgobm9kZSA9IGdyb3VwW2ldKSAmJiBtYXRjaC5jYWxsKG5vZGUsIG5vZGUuX19kYXRhX18sIGksIGdyb3VwKSkge1xuICAgICAgICBzdWJncm91cC5wdXNoKG5vZGUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBuZXcgU2VsZWN0aW9uKHN1Ymdyb3VwcywgdGhpcy5fcGFyZW50cyk7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24odXBkYXRlKSB7XG4gIHJldHVybiBuZXcgQXJyYXkodXBkYXRlLmxlbmd0aCk7XG59XG4iLCAiaW1wb3J0IHNwYXJzZSBmcm9tIFwiLi9zcGFyc2UuanNcIjtcbmltcG9ydCB7U2VsZWN0aW9ufSBmcm9tIFwiLi9pbmRleC5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIG5ldyBTZWxlY3Rpb24odGhpcy5fZW50ZXIgfHwgdGhpcy5fZ3JvdXBzLm1hcChzcGFyc2UpLCB0aGlzLl9wYXJlbnRzKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIEVudGVyTm9kZShwYXJlbnQsIGRhdHVtKSB7XG4gIHRoaXMub3duZXJEb2N1bWVudCA9IHBhcmVudC5vd25lckRvY3VtZW50O1xuICB0aGlzLm5hbWVzcGFjZVVSSSA9IHBhcmVudC5uYW1lc3BhY2VVUkk7XG4gIHRoaXMuX25leHQgPSBudWxsO1xuICB0aGlzLl9wYXJlbnQgPSBwYXJlbnQ7XG4gIHRoaXMuX19kYXRhX18gPSBkYXR1bTtcbn1cblxuRW50ZXJOb2RlLnByb3RvdHlwZSA9IHtcbiAgY29uc3RydWN0b3I6IEVudGVyTm9kZSxcbiAgYXBwZW5kQ2hpbGQ6IGZ1bmN0aW9uKGNoaWxkKSB7IHJldHVybiB0aGlzLl9wYXJlbnQuaW5zZXJ0QmVmb3JlKGNoaWxkLCB0aGlzLl9uZXh0KTsgfSxcbiAgaW5zZXJ0QmVmb3JlOiBmdW5jdGlvbihjaGlsZCwgbmV4dCkgeyByZXR1cm4gdGhpcy5fcGFyZW50Lmluc2VydEJlZm9yZShjaGlsZCwgbmV4dCk7IH0sXG4gIHF1ZXJ5U2VsZWN0b3I6IGZ1bmN0aW9uKHNlbGVjdG9yKSB7IHJldHVybiB0aGlzLl9wYXJlbnQucXVlcnlTZWxlY3RvcihzZWxlY3Rvcik7IH0sXG4gIHF1ZXJ5U2VsZWN0b3JBbGw6IGZ1bmN0aW9uKHNlbGVjdG9yKSB7IHJldHVybiB0aGlzLl9wYXJlbnQucXVlcnlTZWxlY3RvckFsbChzZWxlY3Rvcik7IH1cbn07XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oeCkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHg7XG4gIH07XG59XG4iLCAiaW1wb3J0IHtTZWxlY3Rpb259IGZyb20gXCIuL2luZGV4LmpzXCI7XG5pbXBvcnQge0VudGVyTm9kZX0gZnJvbSBcIi4vZW50ZXIuanNcIjtcbmltcG9ydCBjb25zdGFudCBmcm9tIFwiLi4vY29uc3RhbnQuanNcIjtcblxuZnVuY3Rpb24gYmluZEluZGV4KHBhcmVudCwgZ3JvdXAsIGVudGVyLCB1cGRhdGUsIGV4aXQsIGRhdGEpIHtcbiAgdmFyIGkgPSAwLFxuICAgICAgbm9kZSxcbiAgICAgIGdyb3VwTGVuZ3RoID0gZ3JvdXAubGVuZ3RoLFxuICAgICAgZGF0YUxlbmd0aCA9IGRhdGEubGVuZ3RoO1xuXG4gIC8vIFB1dCBhbnkgbm9uLW51bGwgbm9kZXMgdGhhdCBmaXQgaW50byB1cGRhdGUuXG4gIC8vIFB1dCBhbnkgbnVsbCBub2RlcyBpbnRvIGVudGVyLlxuICAvLyBQdXQgYW55IHJlbWFpbmluZyBkYXRhIGludG8gZW50ZXIuXG4gIGZvciAoOyBpIDwgZGF0YUxlbmd0aDsgKytpKSB7XG4gICAgaWYgKG5vZGUgPSBncm91cFtpXSkge1xuICAgICAgbm9kZS5fX2RhdGFfXyA9IGRhdGFbaV07XG4gICAgICB1cGRhdGVbaV0gPSBub2RlO1xuICAgIH0gZWxzZSB7XG4gICAgICBlbnRlcltpXSA9IG5ldyBFbnRlck5vZGUocGFyZW50LCBkYXRhW2ldKTtcbiAgICB9XG4gIH1cblxuICAvLyBQdXQgYW55IG5vbi1udWxsIG5vZGVzIHRoYXQgZG9uXHUyMDE5dCBmaXQgaW50byBleGl0LlxuICBmb3IgKDsgaSA8IGdyb3VwTGVuZ3RoOyArK2kpIHtcbiAgICBpZiAobm9kZSA9IGdyb3VwW2ldKSB7XG4gICAgICBleGl0W2ldID0gbm9kZTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gYmluZEtleShwYXJlbnQsIGdyb3VwLCBlbnRlciwgdXBkYXRlLCBleGl0LCBkYXRhLCBrZXkpIHtcbiAgdmFyIGksXG4gICAgICBub2RlLFxuICAgICAgbm9kZUJ5S2V5VmFsdWUgPSBuZXcgTWFwLFxuICAgICAgZ3JvdXBMZW5ndGggPSBncm91cC5sZW5ndGgsXG4gICAgICBkYXRhTGVuZ3RoID0gZGF0YS5sZW5ndGgsXG4gICAgICBrZXlWYWx1ZXMgPSBuZXcgQXJyYXkoZ3JvdXBMZW5ndGgpLFxuICAgICAga2V5VmFsdWU7XG5cbiAgLy8gQ29tcHV0ZSB0aGUga2V5IGZvciBlYWNoIG5vZGUuXG4gIC8vIElmIG11bHRpcGxlIG5vZGVzIGhhdmUgdGhlIHNhbWUga2V5LCB0aGUgZHVwbGljYXRlcyBhcmUgYWRkZWQgdG8gZXhpdC5cbiAgZm9yIChpID0gMDsgaSA8IGdyb3VwTGVuZ3RoOyArK2kpIHtcbiAgICBpZiAobm9kZSA9IGdyb3VwW2ldKSB7XG4gICAgICBrZXlWYWx1ZXNbaV0gPSBrZXlWYWx1ZSA9IGtleS5jYWxsKG5vZGUsIG5vZGUuX19kYXRhX18sIGksIGdyb3VwKSArIFwiXCI7XG4gICAgICBpZiAobm9kZUJ5S2V5VmFsdWUuaGFzKGtleVZhbHVlKSkge1xuICAgICAgICBleGl0W2ldID0gbm9kZTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG5vZGVCeUtleVZhbHVlLnNldChrZXlWYWx1ZSwgbm9kZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gQ29tcHV0ZSB0aGUga2V5IGZvciBlYWNoIGRhdHVtLlxuICAvLyBJZiB0aGVyZSBhIG5vZGUgYXNzb2NpYXRlZCB3aXRoIHRoaXMga2V5LCBqb2luIGFuZCBhZGQgaXQgdG8gdXBkYXRlLlxuICAvLyBJZiB0aGVyZSBpcyBub3QgKG9yIHRoZSBrZXkgaXMgYSBkdXBsaWNhdGUpLCBhZGQgaXQgdG8gZW50ZXIuXG4gIGZvciAoaSA9IDA7IGkgPCBkYXRhTGVuZ3RoOyArK2kpIHtcbiAgICBrZXlWYWx1ZSA9IGtleS5jYWxsKHBhcmVudCwgZGF0YVtpXSwgaSwgZGF0YSkgKyBcIlwiO1xuICAgIGlmIChub2RlID0gbm9kZUJ5S2V5VmFsdWUuZ2V0KGtleVZhbHVlKSkge1xuICAgICAgdXBkYXRlW2ldID0gbm9kZTtcbiAgICAgIG5vZGUuX19kYXRhX18gPSBkYXRhW2ldO1xuICAgICAgbm9kZUJ5S2V5VmFsdWUuZGVsZXRlKGtleVZhbHVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgZW50ZXJbaV0gPSBuZXcgRW50ZXJOb2RlKHBhcmVudCwgZGF0YVtpXSk7XG4gICAgfVxuICB9XG5cbiAgLy8gQWRkIGFueSByZW1haW5pbmcgbm9kZXMgdGhhdCB3ZXJlIG5vdCBib3VuZCB0byBkYXRhIHRvIGV4aXQuXG4gIGZvciAoaSA9IDA7IGkgPCBncm91cExlbmd0aDsgKytpKSB7XG4gICAgaWYgKChub2RlID0gZ3JvdXBbaV0pICYmIChub2RlQnlLZXlWYWx1ZS5nZXQoa2V5VmFsdWVzW2ldKSA9PT0gbm9kZSkpIHtcbiAgICAgIGV4aXRbaV0gPSBub2RlO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBkYXR1bShub2RlKSB7XG4gIHJldHVybiBub2RlLl9fZGF0YV9fO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih2YWx1ZSwga2V5KSB7XG4gIGlmICghYXJndW1lbnRzLmxlbmd0aCkgcmV0dXJuIEFycmF5LmZyb20odGhpcywgZGF0dW0pO1xuXG4gIHZhciBiaW5kID0ga2V5ID8gYmluZEtleSA6IGJpbmRJbmRleCxcbiAgICAgIHBhcmVudHMgPSB0aGlzLl9wYXJlbnRzLFxuICAgICAgZ3JvdXBzID0gdGhpcy5fZ3JvdXBzO1xuXG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwiZnVuY3Rpb25cIikgdmFsdWUgPSBjb25zdGFudCh2YWx1ZSk7XG5cbiAgZm9yICh2YXIgbSA9IGdyb3Vwcy5sZW5ndGgsIHVwZGF0ZSA9IG5ldyBBcnJheShtKSwgZW50ZXIgPSBuZXcgQXJyYXkobSksIGV4aXQgPSBuZXcgQXJyYXkobSksIGogPSAwOyBqIDwgbTsgKytqKSB7XG4gICAgdmFyIHBhcmVudCA9IHBhcmVudHNbal0sXG4gICAgICAgIGdyb3VwID0gZ3JvdXBzW2pdLFxuICAgICAgICBncm91cExlbmd0aCA9IGdyb3VwLmxlbmd0aCxcbiAgICAgICAgZGF0YSA9IGFycmF5bGlrZSh2YWx1ZS5jYWxsKHBhcmVudCwgcGFyZW50ICYmIHBhcmVudC5fX2RhdGFfXywgaiwgcGFyZW50cykpLFxuICAgICAgICBkYXRhTGVuZ3RoID0gZGF0YS5sZW5ndGgsXG4gICAgICAgIGVudGVyR3JvdXAgPSBlbnRlcltqXSA9IG5ldyBBcnJheShkYXRhTGVuZ3RoKSxcbiAgICAgICAgdXBkYXRlR3JvdXAgPSB1cGRhdGVbal0gPSBuZXcgQXJyYXkoZGF0YUxlbmd0aCksXG4gICAgICAgIGV4aXRHcm91cCA9IGV4aXRbal0gPSBuZXcgQXJyYXkoZ3JvdXBMZW5ndGgpO1xuXG4gICAgYmluZChwYXJlbnQsIGdyb3VwLCBlbnRlckdyb3VwLCB1cGRhdGVHcm91cCwgZXhpdEdyb3VwLCBkYXRhLCBrZXkpO1xuXG4gICAgLy8gTm93IGNvbm5lY3QgdGhlIGVudGVyIG5vZGVzIHRvIHRoZWlyIGZvbGxvd2luZyB1cGRhdGUgbm9kZSwgc3VjaCB0aGF0XG4gICAgLy8gYXBwZW5kQ2hpbGQgY2FuIGluc2VydCB0aGUgbWF0ZXJpYWxpemVkIGVudGVyIG5vZGUgYmVmb3JlIHRoaXMgbm9kZSxcbiAgICAvLyByYXRoZXIgdGhhbiBhdCB0aGUgZW5kIG9mIHRoZSBwYXJlbnQgbm9kZS5cbiAgICBmb3IgKHZhciBpMCA9IDAsIGkxID0gMCwgcHJldmlvdXMsIG5leHQ7IGkwIDwgZGF0YUxlbmd0aDsgKytpMCkge1xuICAgICAgaWYgKHByZXZpb3VzID0gZW50ZXJHcm91cFtpMF0pIHtcbiAgICAgICAgaWYgKGkwID49IGkxKSBpMSA9IGkwICsgMTtcbiAgICAgICAgd2hpbGUgKCEobmV4dCA9IHVwZGF0ZUdyb3VwW2kxXSkgJiYgKytpMSA8IGRhdGFMZW5ndGgpO1xuICAgICAgICBwcmV2aW91cy5fbmV4dCA9IG5leHQgfHwgbnVsbDtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICB1cGRhdGUgPSBuZXcgU2VsZWN0aW9uKHVwZGF0ZSwgcGFyZW50cyk7XG4gIHVwZGF0ZS5fZW50ZXIgPSBlbnRlcjtcbiAgdXBkYXRlLl9leGl0ID0gZXhpdDtcbiAgcmV0dXJuIHVwZGF0ZTtcbn1cblxuLy8gR2l2ZW4gc29tZSBkYXRhLCB0aGlzIHJldHVybnMgYW4gYXJyYXktbGlrZSB2aWV3IG9mIGl0OiBhbiBvYmplY3QgdGhhdFxuLy8gZXhwb3NlcyBhIGxlbmd0aCBwcm9wZXJ0eSBhbmQgYWxsb3dzIG51bWVyaWMgaW5kZXhpbmcuIE5vdGUgdGhhdCB1bmxpa2Vcbi8vIHNlbGVjdEFsbCwgdGhpcyBpc25cdTIwMTl0IHdvcnJpZWQgYWJvdXQgXHUyMDFDbGl2ZVx1MjAxRCBjb2xsZWN0aW9ucyBiZWNhdXNlIHRoZSByZXN1bHRpbmdcbi8vIGFycmF5IHdpbGwgb25seSBiZSB1c2VkIGJyaWVmbHkgd2hpbGUgZGF0YSBpcyBiZWluZyBib3VuZC4gKEl0IGlzIHBvc3NpYmxlIHRvXG4vLyBjYXVzZSB0aGUgZGF0YSB0byBjaGFuZ2Ugd2hpbGUgaXRlcmF0aW5nIGJ5IHVzaW5nIGEga2V5IGZ1bmN0aW9uLCBidXQgcGxlYXNlXG4vLyBkb25cdTIwMTl0OyB3ZVx1MjAxOWQgcmF0aGVyIGF2b2lkIGEgZ3JhdHVpdG91cyBjb3B5LilcbmZ1bmN0aW9uIGFycmF5bGlrZShkYXRhKSB7XG4gIHJldHVybiB0eXBlb2YgZGF0YSA9PT0gXCJvYmplY3RcIiAmJiBcImxlbmd0aFwiIGluIGRhdGFcbiAgICA/IGRhdGEgLy8gQXJyYXksIFR5cGVkQXJyYXksIE5vZGVMaXN0LCBhcnJheS1saWtlXG4gICAgOiBBcnJheS5mcm9tKGRhdGEpOyAvLyBNYXAsIFNldCwgaXRlcmFibGUsIHN0cmluZywgb3IgYW55dGhpbmcgZWxzZVxufVxuIiwgImltcG9ydCBzcGFyc2UgZnJvbSBcIi4vc3BhcnNlLmpzXCI7XG5pbXBvcnQge1NlbGVjdGlvbn0gZnJvbSBcIi4vaW5kZXguanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIHJldHVybiBuZXcgU2VsZWN0aW9uKHRoaXMuX2V4aXQgfHwgdGhpcy5fZ3JvdXBzLm1hcChzcGFyc2UpLCB0aGlzLl9wYXJlbnRzKTtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbihvbmVudGVyLCBvbnVwZGF0ZSwgb25leGl0KSB7XG4gIHZhciBlbnRlciA9IHRoaXMuZW50ZXIoKSwgdXBkYXRlID0gdGhpcywgZXhpdCA9IHRoaXMuZXhpdCgpO1xuICBpZiAodHlwZW9mIG9uZW50ZXIgPT09IFwiZnVuY3Rpb25cIikge1xuICAgIGVudGVyID0gb25lbnRlcihlbnRlcik7XG4gICAgaWYgKGVudGVyKSBlbnRlciA9IGVudGVyLnNlbGVjdGlvbigpO1xuICB9IGVsc2Uge1xuICAgIGVudGVyID0gZW50ZXIuYXBwZW5kKG9uZW50ZXIgKyBcIlwiKTtcbiAgfVxuICBpZiAob251cGRhdGUgIT0gbnVsbCkge1xuICAgIHVwZGF0ZSA9IG9udXBkYXRlKHVwZGF0ZSk7XG4gICAgaWYgKHVwZGF0ZSkgdXBkYXRlID0gdXBkYXRlLnNlbGVjdGlvbigpO1xuICB9XG4gIGlmIChvbmV4aXQgPT0gbnVsbCkgZXhpdC5yZW1vdmUoKTsgZWxzZSBvbmV4aXQoZXhpdCk7XG4gIHJldHVybiBlbnRlciAmJiB1cGRhdGUgPyBlbnRlci5tZXJnZSh1cGRhdGUpLm9yZGVyKCkgOiB1cGRhdGU7XG59XG4iLCAiaW1wb3J0IHtTZWxlY3Rpb259IGZyb20gXCIuL2luZGV4LmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGNvbnRleHQpIHtcbiAgdmFyIHNlbGVjdGlvbiA9IGNvbnRleHQuc2VsZWN0aW9uID8gY29udGV4dC5zZWxlY3Rpb24oKSA6IGNvbnRleHQ7XG5cbiAgZm9yICh2YXIgZ3JvdXBzMCA9IHRoaXMuX2dyb3VwcywgZ3JvdXBzMSA9IHNlbGVjdGlvbi5fZ3JvdXBzLCBtMCA9IGdyb3VwczAubGVuZ3RoLCBtMSA9IGdyb3VwczEubGVuZ3RoLCBtID0gTWF0aC5taW4obTAsIG0xKSwgbWVyZ2VzID0gbmV3IEFycmF5KG0wKSwgaiA9IDA7IGogPCBtOyArK2opIHtcbiAgICBmb3IgKHZhciBncm91cDAgPSBncm91cHMwW2pdLCBncm91cDEgPSBncm91cHMxW2pdLCBuID0gZ3JvdXAwLmxlbmd0aCwgbWVyZ2UgPSBtZXJnZXNbal0gPSBuZXcgQXJyYXkobiksIG5vZGUsIGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAobm9kZSA9IGdyb3VwMFtpXSB8fCBncm91cDFbaV0pIHtcbiAgICAgICAgbWVyZ2VbaV0gPSBub2RlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGZvciAoOyBqIDwgbTA7ICsraikge1xuICAgIG1lcmdlc1tqXSA9IGdyb3VwczBbal07XG4gIH1cblxuICByZXR1cm4gbmV3IFNlbGVjdGlvbihtZXJnZXMsIHRoaXMuX3BhcmVudHMpO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKCkge1xuXG4gIGZvciAodmFyIGdyb3VwcyA9IHRoaXMuX2dyb3VwcywgaiA9IC0xLCBtID0gZ3JvdXBzLmxlbmd0aDsgKytqIDwgbTspIHtcbiAgICBmb3IgKHZhciBncm91cCA9IGdyb3Vwc1tqXSwgaSA9IGdyb3VwLmxlbmd0aCAtIDEsIG5leHQgPSBncm91cFtpXSwgbm9kZTsgLS1pID49IDA7KSB7XG4gICAgICBpZiAobm9kZSA9IGdyb3VwW2ldKSB7XG4gICAgICAgIGlmIChuZXh0ICYmIG5vZGUuY29tcGFyZURvY3VtZW50UG9zaXRpb24obmV4dCkgXiA0KSBuZXh0LnBhcmVudE5vZGUuaW5zZXJ0QmVmb3JlKG5vZGUsIG5leHQpO1xuICAgICAgICBuZXh0ID0gbm9kZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn1cbiIsICJpbXBvcnQge1NlbGVjdGlvbn0gZnJvbSBcIi4vaW5kZXguanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oY29tcGFyZSkge1xuICBpZiAoIWNvbXBhcmUpIGNvbXBhcmUgPSBhc2NlbmRpbmc7XG5cbiAgZnVuY3Rpb24gY29tcGFyZU5vZGUoYSwgYikge1xuICAgIHJldHVybiBhICYmIGIgPyBjb21wYXJlKGEuX19kYXRhX18sIGIuX19kYXRhX18pIDogIWEgLSAhYjtcbiAgfVxuXG4gIGZvciAodmFyIGdyb3VwcyA9IHRoaXMuX2dyb3VwcywgbSA9IGdyb3Vwcy5sZW5ndGgsIHNvcnRncm91cHMgPSBuZXcgQXJyYXkobSksIGogPSAwOyBqIDwgbTsgKytqKSB7XG4gICAgZm9yICh2YXIgZ3JvdXAgPSBncm91cHNbal0sIG4gPSBncm91cC5sZW5ndGgsIHNvcnRncm91cCA9IHNvcnRncm91cHNbal0gPSBuZXcgQXJyYXkobiksIG5vZGUsIGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAobm9kZSA9IGdyb3VwW2ldKSB7XG4gICAgICAgIHNvcnRncm91cFtpXSA9IG5vZGU7XG4gICAgICB9XG4gICAgfVxuICAgIHNvcnRncm91cC5zb3J0KGNvbXBhcmVOb2RlKTtcbiAgfVxuXG4gIHJldHVybiBuZXcgU2VsZWN0aW9uKHNvcnRncm91cHMsIHRoaXMuX3BhcmVudHMpLm9yZGVyKCk7XG59XG5cbmZ1bmN0aW9uIGFzY2VuZGluZyhhLCBiKSB7XG4gIHJldHVybiBhIDwgYiA/IC0xIDogYSA+IGIgPyAxIDogYSA+PSBiID8gMCA6IE5hTjtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgdmFyIGNhbGxiYWNrID0gYXJndW1lbnRzWzBdO1xuICBhcmd1bWVudHNbMF0gPSB0aGlzO1xuICBjYWxsYmFjay5hcHBseShudWxsLCBhcmd1bWVudHMpO1xuICByZXR1cm4gdGhpcztcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIEFycmF5LmZyb20odGhpcyk7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG5cbiAgZm9yICh2YXIgZ3JvdXBzID0gdGhpcy5fZ3JvdXBzLCBqID0gMCwgbSA9IGdyb3Vwcy5sZW5ndGg7IGogPCBtOyArK2opIHtcbiAgICBmb3IgKHZhciBncm91cCA9IGdyb3Vwc1tqXSwgaSA9IDAsIG4gPSBncm91cC5sZW5ndGg7IGkgPCBuOyArK2kpIHtcbiAgICAgIHZhciBub2RlID0gZ3JvdXBbaV07XG4gICAgICBpZiAobm9kZSkgcmV0dXJuIG5vZGU7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG51bGw7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIGxldCBzaXplID0gMDtcbiAgZm9yIChjb25zdCBub2RlIG9mIHRoaXMpICsrc2l6ZTsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBuby11bnVzZWQtdmFyc1xuICByZXR1cm4gc2l6ZTtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgcmV0dXJuICF0aGlzLm5vZGUoKTtcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbihjYWxsYmFjaykge1xuXG4gIGZvciAodmFyIGdyb3VwcyA9IHRoaXMuX2dyb3VwcywgaiA9IDAsIG0gPSBncm91cHMubGVuZ3RoOyBqIDwgbTsgKytqKSB7XG4gICAgZm9yICh2YXIgZ3JvdXAgPSBncm91cHNbal0sIGkgPSAwLCBuID0gZ3JvdXAubGVuZ3RoLCBub2RlOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAobm9kZSA9IGdyb3VwW2ldKSBjYWxsYmFjay5jYWxsKG5vZGUsIG5vZGUuX19kYXRhX18sIGksIGdyb3VwKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn1cbiIsICJpbXBvcnQgbmFtZXNwYWNlIGZyb20gXCIuLi9uYW1lc3BhY2UuanNcIjtcblxuZnVuY3Rpb24gYXR0clJlbW92ZShuYW1lKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnJlbW92ZUF0dHJpYnV0ZShuYW1lKTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gYXR0clJlbW92ZU5TKGZ1bGxuYW1lKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnJlbW92ZUF0dHJpYnV0ZU5TKGZ1bGxuYW1lLnNwYWNlLCBmdWxsbmFtZS5sb2NhbCk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGF0dHJDb25zdGFudChuYW1lLCB2YWx1ZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5zZXRBdHRyaWJ1dGUobmFtZSwgdmFsdWUpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBhdHRyQ29uc3RhbnROUyhmdWxsbmFtZSwgdmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuc2V0QXR0cmlidXRlTlMoZnVsbG5hbWUuc3BhY2UsIGZ1bGxuYW1lLmxvY2FsLCB2YWx1ZSk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGF0dHJGdW5jdGlvbihuYW1lLCB2YWx1ZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHYgPSB2YWx1ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIGlmICh2ID09IG51bGwpIHRoaXMucmVtb3ZlQXR0cmlidXRlKG5hbWUpO1xuICAgIGVsc2UgdGhpcy5zZXRBdHRyaWJ1dGUobmFtZSwgdik7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGF0dHJGdW5jdGlvbk5TKGZ1bGxuYW1lLCB2YWx1ZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHYgPSB2YWx1ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIGlmICh2ID09IG51bGwpIHRoaXMucmVtb3ZlQXR0cmlidXRlTlMoZnVsbG5hbWUuc3BhY2UsIGZ1bGxuYW1lLmxvY2FsKTtcbiAgICBlbHNlIHRoaXMuc2V0QXR0cmlidXRlTlMoZnVsbG5hbWUuc3BhY2UsIGZ1bGxuYW1lLmxvY2FsLCB2KTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSwgdmFsdWUpIHtcbiAgdmFyIGZ1bGxuYW1lID0gbmFtZXNwYWNlKG5hbWUpO1xuXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoIDwgMikge1xuICAgIHZhciBub2RlID0gdGhpcy5ub2RlKCk7XG4gICAgcmV0dXJuIGZ1bGxuYW1lLmxvY2FsXG4gICAgICAgID8gbm9kZS5nZXRBdHRyaWJ1dGVOUyhmdWxsbmFtZS5zcGFjZSwgZnVsbG5hbWUubG9jYWwpXG4gICAgICAgIDogbm9kZS5nZXRBdHRyaWJ1dGUoZnVsbG5hbWUpO1xuICB9XG5cbiAgcmV0dXJuIHRoaXMuZWFjaCgodmFsdWUgPT0gbnVsbFxuICAgICAgPyAoZnVsbG5hbWUubG9jYWwgPyBhdHRyUmVtb3ZlTlMgOiBhdHRyUmVtb3ZlKSA6ICh0eXBlb2YgdmFsdWUgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgPyAoZnVsbG5hbWUubG9jYWwgPyBhdHRyRnVuY3Rpb25OUyA6IGF0dHJGdW5jdGlvbilcbiAgICAgIDogKGZ1bGxuYW1lLmxvY2FsID8gYXR0ckNvbnN0YW50TlMgOiBhdHRyQ29uc3RhbnQpKSkoZnVsbG5hbWUsIHZhbHVlKSk7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obm9kZSkge1xuICByZXR1cm4gKG5vZGUub3duZXJEb2N1bWVudCAmJiBub2RlLm93bmVyRG9jdW1lbnQuZGVmYXVsdFZpZXcpIC8vIG5vZGUgaXMgYSBOb2RlXG4gICAgICB8fCAobm9kZS5kb2N1bWVudCAmJiBub2RlKSAvLyBub2RlIGlzIGEgV2luZG93XG4gICAgICB8fCBub2RlLmRlZmF1bHRWaWV3OyAvLyBub2RlIGlzIGEgRG9jdW1lbnRcbn1cbiIsICJpbXBvcnQgZGVmYXVsdFZpZXcgZnJvbSBcIi4uL3dpbmRvdy5qc1wiO1xuXG5mdW5jdGlvbiBzdHlsZVJlbW92ZShuYW1lKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnN0eWxlLnJlbW92ZVByb3BlcnR5KG5hbWUpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBzdHlsZUNvbnN0YW50KG5hbWUsIHZhbHVlLCBwcmlvcml0eSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5zdHlsZS5zZXRQcm9wZXJ0eShuYW1lLCB2YWx1ZSwgcHJpb3JpdHkpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBzdHlsZUZ1bmN0aW9uKG5hbWUsIHZhbHVlLCBwcmlvcml0eSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHYgPSB2YWx1ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIGlmICh2ID09IG51bGwpIHRoaXMuc3R5bGUucmVtb3ZlUHJvcGVydHkobmFtZSk7XG4gICAgZWxzZSB0aGlzLnN0eWxlLnNldFByb3BlcnR5KG5hbWUsIHYsIHByaW9yaXR5KTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSwgdmFsdWUsIHByaW9yaXR5KSB7XG4gIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID4gMVxuICAgICAgPyB0aGlzLmVhY2goKHZhbHVlID09IG51bGxcbiAgICAgICAgICAgID8gc3R5bGVSZW1vdmUgOiB0eXBlb2YgdmFsdWUgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgICAgICAgPyBzdHlsZUZ1bmN0aW9uXG4gICAgICAgICAgICA6IHN0eWxlQ29uc3RhbnQpKG5hbWUsIHZhbHVlLCBwcmlvcml0eSA9PSBudWxsID8gXCJcIiA6IHByaW9yaXR5KSlcbiAgICAgIDogc3R5bGVWYWx1ZSh0aGlzLm5vZGUoKSwgbmFtZSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzdHlsZVZhbHVlKG5vZGUsIG5hbWUpIHtcbiAgcmV0dXJuIG5vZGUuc3R5bGUuZ2V0UHJvcGVydHlWYWx1ZShuYW1lKVxuICAgICAgfHwgZGVmYXVsdFZpZXcobm9kZSkuZ2V0Q29tcHV0ZWRTdHlsZShub2RlLCBudWxsKS5nZXRQcm9wZXJ0eVZhbHVlKG5hbWUpO1xufVxuIiwgImZ1bmN0aW9uIHByb3BlcnR5UmVtb3ZlKG5hbWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIGRlbGV0ZSB0aGlzW25hbWVdO1xuICB9O1xufVxuXG5mdW5jdGlvbiBwcm9wZXJ0eUNvbnN0YW50KG5hbWUsIHZhbHVlKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB0aGlzW25hbWVdID0gdmFsdWU7XG4gIH07XG59XG5cbmZ1bmN0aW9uIHByb3BlcnR5RnVuY3Rpb24obmFtZSwgdmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciB2ID0gdmFsdWUuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICBpZiAodiA9PSBudWxsKSBkZWxldGUgdGhpc1tuYW1lXTtcbiAgICBlbHNlIHRoaXNbbmFtZV0gPSB2O1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihuYW1lLCB2YWx1ZSkge1xuICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA+IDFcbiAgICAgID8gdGhpcy5lYWNoKCh2YWx1ZSA9PSBudWxsXG4gICAgICAgICAgPyBwcm9wZXJ0eVJlbW92ZSA6IHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgICAgICAgPyBwcm9wZXJ0eUZ1bmN0aW9uXG4gICAgICAgICAgOiBwcm9wZXJ0eUNvbnN0YW50KShuYW1lLCB2YWx1ZSkpXG4gICAgICA6IHRoaXMubm9kZSgpW25hbWVdO1xufVxuIiwgImZ1bmN0aW9uIGNsYXNzQXJyYXkoc3RyaW5nKSB7XG4gIHJldHVybiBzdHJpbmcudHJpbSgpLnNwbGl0KC9efFxccysvKTtcbn1cblxuZnVuY3Rpb24gY2xhc3NMaXN0KG5vZGUpIHtcbiAgcmV0dXJuIG5vZGUuY2xhc3NMaXN0IHx8IG5ldyBDbGFzc0xpc3Qobm9kZSk7XG59XG5cbmZ1bmN0aW9uIENsYXNzTGlzdChub2RlKSB7XG4gIHRoaXMuX25vZGUgPSBub2RlO1xuICB0aGlzLl9uYW1lcyA9IGNsYXNzQXJyYXkobm9kZS5nZXRBdHRyaWJ1dGUoXCJjbGFzc1wiKSB8fCBcIlwiKTtcbn1cblxuQ2xhc3NMaXN0LnByb3RvdHlwZSA9IHtcbiAgYWRkOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgdmFyIGkgPSB0aGlzLl9uYW1lcy5pbmRleE9mKG5hbWUpO1xuICAgIGlmIChpIDwgMCkge1xuICAgICAgdGhpcy5fbmFtZXMucHVzaChuYW1lKTtcbiAgICAgIHRoaXMuX25vZGUuc2V0QXR0cmlidXRlKFwiY2xhc3NcIiwgdGhpcy5fbmFtZXMuam9pbihcIiBcIikpO1xuICAgIH1cbiAgfSxcbiAgcmVtb3ZlOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgdmFyIGkgPSB0aGlzLl9uYW1lcy5pbmRleE9mKG5hbWUpO1xuICAgIGlmIChpID49IDApIHtcbiAgICAgIHRoaXMuX25hbWVzLnNwbGljZShpLCAxKTtcbiAgICAgIHRoaXMuX25vZGUuc2V0QXR0cmlidXRlKFwiY2xhc3NcIiwgdGhpcy5fbmFtZXMuam9pbihcIiBcIikpO1xuICAgIH1cbiAgfSxcbiAgY29udGFpbnM6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5fbmFtZXMuaW5kZXhPZihuYW1lKSA+PSAwO1xuICB9XG59O1xuXG5mdW5jdGlvbiBjbGFzc2VkQWRkKG5vZGUsIG5hbWVzKSB7XG4gIHZhciBsaXN0ID0gY2xhc3NMaXN0KG5vZGUpLCBpID0gLTEsIG4gPSBuYW1lcy5sZW5ndGg7XG4gIHdoaWxlICgrK2kgPCBuKSBsaXN0LmFkZChuYW1lc1tpXSk7XG59XG5cbmZ1bmN0aW9uIGNsYXNzZWRSZW1vdmUobm9kZSwgbmFtZXMpIHtcbiAgdmFyIGxpc3QgPSBjbGFzc0xpc3Qobm9kZSksIGkgPSAtMSwgbiA9IG5hbWVzLmxlbmd0aDtcbiAgd2hpbGUgKCsraSA8IG4pIGxpc3QucmVtb3ZlKG5hbWVzW2ldKTtcbn1cblxuZnVuY3Rpb24gY2xhc3NlZFRydWUobmFtZXMpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIGNsYXNzZWRBZGQodGhpcywgbmFtZXMpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBjbGFzc2VkRmFsc2UobmFtZXMpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIGNsYXNzZWRSZW1vdmUodGhpcywgbmFtZXMpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBjbGFzc2VkRnVuY3Rpb24obmFtZXMsIHZhbHVlKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAodmFsdWUuYXBwbHkodGhpcywgYXJndW1lbnRzKSA/IGNsYXNzZWRBZGQgOiBjbGFzc2VkUmVtb3ZlKSh0aGlzLCBuYW1lcyk7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG5hbWUsIHZhbHVlKSB7XG4gIHZhciBuYW1lcyA9IGNsYXNzQXJyYXkobmFtZSArIFwiXCIpO1xuXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoIDwgMikge1xuICAgIHZhciBsaXN0ID0gY2xhc3NMaXN0KHRoaXMubm9kZSgpKSwgaSA9IC0xLCBuID0gbmFtZXMubGVuZ3RoO1xuICAgIHdoaWxlICgrK2kgPCBuKSBpZiAoIWxpc3QuY29udGFpbnMobmFtZXNbaV0pKSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICByZXR1cm4gdGhpcy5lYWNoKCh0eXBlb2YgdmFsdWUgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgPyBjbGFzc2VkRnVuY3Rpb24gOiB2YWx1ZVxuICAgICAgPyBjbGFzc2VkVHJ1ZVxuICAgICAgOiBjbGFzc2VkRmFsc2UpKG5hbWVzLCB2YWx1ZSkpO1xufVxuIiwgImZ1bmN0aW9uIHRleHRSZW1vdmUoKSB7XG4gIHRoaXMudGV4dENvbnRlbnQgPSBcIlwiO1xufVxuXG5mdW5jdGlvbiB0ZXh0Q29uc3RhbnQodmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHRoaXMudGV4dENvbnRlbnQgPSB2YWx1ZTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gdGV4dEZ1bmN0aW9uKHZhbHVlKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgdiA9IHZhbHVlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgdGhpcy50ZXh0Q29udGVudCA9IHYgPT0gbnVsbCA/IFwiXCIgOiB2O1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih2YWx1ZSkge1xuICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aFxuICAgICAgPyB0aGlzLmVhY2godmFsdWUgPT0gbnVsbFxuICAgICAgICAgID8gdGV4dFJlbW92ZSA6ICh0eXBlb2YgdmFsdWUgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgICAgID8gdGV4dEZ1bmN0aW9uXG4gICAgICAgICAgOiB0ZXh0Q29uc3RhbnQpKHZhbHVlKSlcbiAgICAgIDogdGhpcy5ub2RlKCkudGV4dENvbnRlbnQ7XG59XG4iLCAiZnVuY3Rpb24gaHRtbFJlbW92ZSgpIHtcbiAgdGhpcy5pbm5lckhUTUwgPSBcIlwiO1xufVxuXG5mdW5jdGlvbiBodG1sQ29uc3RhbnQodmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuaW5uZXJIVE1MID0gdmFsdWU7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGh0bWxGdW5jdGlvbih2YWx1ZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHYgPSB2YWx1ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIHRoaXMuaW5uZXJIVE1MID0gdiA9PSBudWxsID8gXCJcIiA6IHY7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHZhbHVlKSB7XG4gIHJldHVybiBhcmd1bWVudHMubGVuZ3RoXG4gICAgICA/IHRoaXMuZWFjaCh2YWx1ZSA9PSBudWxsXG4gICAgICAgICAgPyBodG1sUmVtb3ZlIDogKHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgICAgICAgPyBodG1sRnVuY3Rpb25cbiAgICAgICAgICA6IGh0bWxDb25zdGFudCkodmFsdWUpKVxuICAgICAgOiB0aGlzLm5vZGUoKS5pbm5lckhUTUw7XG59XG4iLCAiZnVuY3Rpb24gcmFpc2UoKSB7XG4gIGlmICh0aGlzLm5leHRTaWJsaW5nKSB0aGlzLnBhcmVudE5vZGUuYXBwZW5kQ2hpbGQodGhpcyk7XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdGhpcy5lYWNoKHJhaXNlKTtcbn1cbiIsICJmdW5jdGlvbiBsb3dlcigpIHtcbiAgaWYgKHRoaXMucHJldmlvdXNTaWJsaW5nKSB0aGlzLnBhcmVudE5vZGUuaW5zZXJ0QmVmb3JlKHRoaXMsIHRoaXMucGFyZW50Tm9kZS5maXJzdENoaWxkKTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLmVhY2gobG93ZXIpO1xufVxuIiwgImltcG9ydCBjcmVhdG9yIGZyb20gXCIuLi9jcmVhdG9yLmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG5hbWUpIHtcbiAgdmFyIGNyZWF0ZSA9IHR5cGVvZiBuYW1lID09PSBcImZ1bmN0aW9uXCIgPyBuYW1lIDogY3JlYXRvcihuYW1lKTtcbiAgcmV0dXJuIHRoaXMuc2VsZWN0KGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLmFwcGVuZENoaWxkKGNyZWF0ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpKTtcbiAgfSk7XG59XG4iLCAiaW1wb3J0IGNyZWF0b3IgZnJvbSBcIi4uL2NyZWF0b3IuanNcIjtcbmltcG9ydCBzZWxlY3RvciBmcm9tIFwiLi4vc2VsZWN0b3IuanNcIjtcblxuZnVuY3Rpb24gY29uc3RhbnROdWxsKCkge1xuICByZXR1cm4gbnVsbDtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSwgYmVmb3JlKSB7XG4gIHZhciBjcmVhdGUgPSB0eXBlb2YgbmFtZSA9PT0gXCJmdW5jdGlvblwiID8gbmFtZSA6IGNyZWF0b3IobmFtZSksXG4gICAgICBzZWxlY3QgPSBiZWZvcmUgPT0gbnVsbCA/IGNvbnN0YW50TnVsbCA6IHR5cGVvZiBiZWZvcmUgPT09IFwiZnVuY3Rpb25cIiA/IGJlZm9yZSA6IHNlbGVjdG9yKGJlZm9yZSk7XG4gIHJldHVybiB0aGlzLnNlbGVjdChmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5pbnNlcnRCZWZvcmUoY3JlYXRlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyksIHNlbGVjdC5hcHBseSh0aGlzLCBhcmd1bWVudHMpIHx8IG51bGwpO1xuICB9KTtcbn1cbiIsICJmdW5jdGlvbiByZW1vdmUoKSB7XG4gIHZhciBwYXJlbnQgPSB0aGlzLnBhcmVudE5vZGU7XG4gIGlmIChwYXJlbnQpIHBhcmVudC5yZW1vdmVDaGlsZCh0aGlzKTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLmVhY2gocmVtb3ZlKTtcbn1cbiIsICJmdW5jdGlvbiBzZWxlY3Rpb25fY2xvbmVTaGFsbG93KCkge1xuICB2YXIgY2xvbmUgPSB0aGlzLmNsb25lTm9kZShmYWxzZSksIHBhcmVudCA9IHRoaXMucGFyZW50Tm9kZTtcbiAgcmV0dXJuIHBhcmVudCA/IHBhcmVudC5pbnNlcnRCZWZvcmUoY2xvbmUsIHRoaXMubmV4dFNpYmxpbmcpIDogY2xvbmU7XG59XG5cbmZ1bmN0aW9uIHNlbGVjdGlvbl9jbG9uZURlZXAoKSB7XG4gIHZhciBjbG9uZSA9IHRoaXMuY2xvbmVOb2RlKHRydWUpLCBwYXJlbnQgPSB0aGlzLnBhcmVudE5vZGU7XG4gIHJldHVybiBwYXJlbnQgPyBwYXJlbnQuaW5zZXJ0QmVmb3JlKGNsb25lLCB0aGlzLm5leHRTaWJsaW5nKSA6IGNsb25lO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihkZWVwKSB7XG4gIHJldHVybiB0aGlzLnNlbGVjdChkZWVwID8gc2VsZWN0aW9uX2Nsb25lRGVlcCA6IHNlbGVjdGlvbl9jbG9uZVNoYWxsb3cpO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHZhbHVlKSB7XG4gIHJldHVybiBhcmd1bWVudHMubGVuZ3RoXG4gICAgICA/IHRoaXMucHJvcGVydHkoXCJfX2RhdGFfX1wiLCB2YWx1ZSlcbiAgICAgIDogdGhpcy5ub2RlKCkuX19kYXRhX187XG59XG4iLCAiZnVuY3Rpb24gY29udGV4dExpc3RlbmVyKGxpc3RlbmVyKSB7XG4gIHJldHVybiBmdW5jdGlvbihldmVudCkge1xuICAgIGxpc3RlbmVyLmNhbGwodGhpcywgZXZlbnQsIHRoaXMuX19kYXRhX18pO1xuICB9O1xufVxuXG5mdW5jdGlvbiBwYXJzZVR5cGVuYW1lcyh0eXBlbmFtZXMpIHtcbiAgcmV0dXJuIHR5cGVuYW1lcy50cmltKCkuc3BsaXQoL158XFxzKy8pLm1hcChmdW5jdGlvbih0KSB7XG4gICAgdmFyIG5hbWUgPSBcIlwiLCBpID0gdC5pbmRleE9mKFwiLlwiKTtcbiAgICBpZiAoaSA+PSAwKSBuYW1lID0gdC5zbGljZShpICsgMSksIHQgPSB0LnNsaWNlKDAsIGkpO1xuICAgIHJldHVybiB7dHlwZTogdCwgbmFtZTogbmFtZX07XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBvblJlbW92ZSh0eXBlbmFtZSkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIG9uID0gdGhpcy5fX29uO1xuICAgIGlmICghb24pIHJldHVybjtcbiAgICBmb3IgKHZhciBqID0gMCwgaSA9IC0xLCBtID0gb24ubGVuZ3RoLCBvOyBqIDwgbTsgKytqKSB7XG4gICAgICBpZiAobyA9IG9uW2pdLCAoIXR5cGVuYW1lLnR5cGUgfHwgby50eXBlID09PSB0eXBlbmFtZS50eXBlKSAmJiBvLm5hbWUgPT09IHR5cGVuYW1lLm5hbWUpIHtcbiAgICAgICAgdGhpcy5yZW1vdmVFdmVudExpc3RlbmVyKG8udHlwZSwgby5saXN0ZW5lciwgby5vcHRpb25zKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG9uWysraV0gPSBvO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoKytpKSBvbi5sZW5ndGggPSBpO1xuICAgIGVsc2UgZGVsZXRlIHRoaXMuX19vbjtcbiAgfTtcbn1cblxuZnVuY3Rpb24gb25BZGQodHlwZW5hbWUsIHZhbHVlLCBvcHRpb25zKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgb24gPSB0aGlzLl9fb24sIG8sIGxpc3RlbmVyID0gY29udGV4dExpc3RlbmVyKHZhbHVlKTtcbiAgICBpZiAob24pIGZvciAodmFyIGogPSAwLCBtID0gb24ubGVuZ3RoOyBqIDwgbTsgKytqKSB7XG4gICAgICBpZiAoKG8gPSBvbltqXSkudHlwZSA9PT0gdHlwZW5hbWUudHlwZSAmJiBvLm5hbWUgPT09IHR5cGVuYW1lLm5hbWUpIHtcbiAgICAgICAgdGhpcy5yZW1vdmVFdmVudExpc3RlbmVyKG8udHlwZSwgby5saXN0ZW5lciwgby5vcHRpb25zKTtcbiAgICAgICAgdGhpcy5hZGRFdmVudExpc3RlbmVyKG8udHlwZSwgby5saXN0ZW5lciA9IGxpc3RlbmVyLCBvLm9wdGlvbnMgPSBvcHRpb25zKTtcbiAgICAgICAgby52YWx1ZSA9IHZhbHVlO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfVxuICAgIHRoaXMuYWRkRXZlbnRMaXN0ZW5lcih0eXBlbmFtZS50eXBlLCBsaXN0ZW5lciwgb3B0aW9ucyk7XG4gICAgbyA9IHt0eXBlOiB0eXBlbmFtZS50eXBlLCBuYW1lOiB0eXBlbmFtZS5uYW1lLCB2YWx1ZTogdmFsdWUsIGxpc3RlbmVyOiBsaXN0ZW5lciwgb3B0aW9uczogb3B0aW9uc307XG4gICAgaWYgKCFvbikgdGhpcy5fX29uID0gW29dO1xuICAgIGVsc2Ugb24ucHVzaChvKTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24odHlwZW5hbWUsIHZhbHVlLCBvcHRpb25zKSB7XG4gIHZhciB0eXBlbmFtZXMgPSBwYXJzZVR5cGVuYW1lcyh0eXBlbmFtZSArIFwiXCIpLCBpLCBuID0gdHlwZW5hbWVzLmxlbmd0aCwgdDtcblxuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA8IDIpIHtcbiAgICB2YXIgb24gPSB0aGlzLm5vZGUoKS5fX29uO1xuICAgIGlmIChvbikgZm9yICh2YXIgaiA9IDAsIG0gPSBvbi5sZW5ndGgsIG87IGogPCBtOyArK2opIHtcbiAgICAgIGZvciAoaSA9IDAsIG8gPSBvbltqXTsgaSA8IG47ICsraSkge1xuICAgICAgICBpZiAoKHQgPSB0eXBlbmFtZXNbaV0pLnR5cGUgPT09IG8udHlwZSAmJiB0Lm5hbWUgPT09IG8ubmFtZSkge1xuICAgICAgICAgIHJldHVybiBvLnZhbHVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybjtcbiAgfVxuXG4gIG9uID0gdmFsdWUgPyBvbkFkZCA6IG9uUmVtb3ZlO1xuICBmb3IgKGkgPSAwOyBpIDwgbjsgKytpKSB0aGlzLmVhY2gob24odHlwZW5hbWVzW2ldLCB2YWx1ZSwgb3B0aW9ucykpO1xuICByZXR1cm4gdGhpcztcbn1cbiIsICJpbXBvcnQgZGVmYXVsdFZpZXcgZnJvbSBcIi4uL3dpbmRvdy5qc1wiO1xuXG5mdW5jdGlvbiBkaXNwYXRjaEV2ZW50KG5vZGUsIHR5cGUsIHBhcmFtcykge1xuICB2YXIgd2luZG93ID0gZGVmYXVsdFZpZXcobm9kZSksXG4gICAgICBldmVudCA9IHdpbmRvdy5DdXN0b21FdmVudDtcblxuICBpZiAodHlwZW9mIGV2ZW50ID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICBldmVudCA9IG5ldyBldmVudCh0eXBlLCBwYXJhbXMpO1xuICB9IGVsc2Uge1xuICAgIGV2ZW50ID0gd2luZG93LmRvY3VtZW50LmNyZWF0ZUV2ZW50KFwiRXZlbnRcIik7XG4gICAgaWYgKHBhcmFtcykgZXZlbnQuaW5pdEV2ZW50KHR5cGUsIHBhcmFtcy5idWJibGVzLCBwYXJhbXMuY2FuY2VsYWJsZSksIGV2ZW50LmRldGFpbCA9IHBhcmFtcy5kZXRhaWw7XG4gICAgZWxzZSBldmVudC5pbml0RXZlbnQodHlwZSwgZmFsc2UsIGZhbHNlKTtcbiAgfVxuXG4gIG5vZGUuZGlzcGF0Y2hFdmVudChldmVudCk7XG59XG5cbmZ1bmN0aW9uIGRpc3BhdGNoQ29uc3RhbnQodHlwZSwgcGFyYW1zKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gZGlzcGF0Y2hFdmVudCh0aGlzLCB0eXBlLCBwYXJhbXMpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBkaXNwYXRjaEZ1bmN0aW9uKHR5cGUsIHBhcmFtcykge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGRpc3BhdGNoRXZlbnQodGhpcywgdHlwZSwgcGFyYW1zLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykpO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih0eXBlLCBwYXJhbXMpIHtcbiAgcmV0dXJuIHRoaXMuZWFjaCgodHlwZW9mIHBhcmFtcyA9PT0gXCJmdW5jdGlvblwiXG4gICAgICA/IGRpc3BhdGNoRnVuY3Rpb25cbiAgICAgIDogZGlzcGF0Y2hDb25zdGFudCkodHlwZSwgcGFyYW1zKSk7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24qKCkge1xuICBmb3IgKHZhciBncm91cHMgPSB0aGlzLl9ncm91cHMsIGogPSAwLCBtID0gZ3JvdXBzLmxlbmd0aDsgaiA8IG07ICsraikge1xuICAgIGZvciAodmFyIGdyb3VwID0gZ3JvdXBzW2pdLCBpID0gMCwgbiA9IGdyb3VwLmxlbmd0aCwgbm9kZTsgaSA8IG47ICsraSkge1xuICAgICAgaWYgKG5vZGUgPSBncm91cFtpXSkgeWllbGQgbm9kZTtcbiAgICB9XG4gIH1cbn1cbiIsICJpbXBvcnQgc2VsZWN0aW9uX3NlbGVjdCBmcm9tIFwiLi9zZWxlY3QuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fc2VsZWN0QWxsIGZyb20gXCIuL3NlbGVjdEFsbC5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9zZWxlY3RDaGlsZCBmcm9tIFwiLi9zZWxlY3RDaGlsZC5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9zZWxlY3RDaGlsZHJlbiBmcm9tIFwiLi9zZWxlY3RDaGlsZHJlbi5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9maWx0ZXIgZnJvbSBcIi4vZmlsdGVyLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2RhdGEgZnJvbSBcIi4vZGF0YS5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9lbnRlciBmcm9tIFwiLi9lbnRlci5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9leGl0IGZyb20gXCIuL2V4aXQuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fam9pbiBmcm9tIFwiLi9qb2luLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX21lcmdlIGZyb20gXCIuL21lcmdlLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX29yZGVyIGZyb20gXCIuL29yZGVyLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX3NvcnQgZnJvbSBcIi4vc29ydC5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9jYWxsIGZyb20gXCIuL2NhbGwuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fbm9kZXMgZnJvbSBcIi4vbm9kZXMuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fbm9kZSBmcm9tIFwiLi9ub2RlLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX3NpemUgZnJvbSBcIi4vc2l6ZS5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9lbXB0eSBmcm9tIFwiLi9lbXB0eS5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9lYWNoIGZyb20gXCIuL2VhY2guanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fYXR0ciBmcm9tIFwiLi9hdHRyLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX3N0eWxlIGZyb20gXCIuL3N0eWxlLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX3Byb3BlcnR5IGZyb20gXCIuL3Byb3BlcnR5LmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2NsYXNzZWQgZnJvbSBcIi4vY2xhc3NlZC5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl90ZXh0IGZyb20gXCIuL3RleHQuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25faHRtbCBmcm9tIFwiLi9odG1sLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX3JhaXNlIGZyb20gXCIuL3JhaXNlLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2xvd2VyIGZyb20gXCIuL2xvd2VyLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2FwcGVuZCBmcm9tIFwiLi9hcHBlbmQuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25faW5zZXJ0IGZyb20gXCIuL2luc2VydC5qc1wiO1xuaW1wb3J0IHNlbGVjdGlvbl9yZW1vdmUgZnJvbSBcIi4vcmVtb3ZlLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2Nsb25lIGZyb20gXCIuL2Nsb25lLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2RhdHVtIGZyb20gXCIuL2RhdHVtLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX29uIGZyb20gXCIuL29uLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2Rpc3BhdGNoIGZyb20gXCIuL2Rpc3BhdGNoLmpzXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2l0ZXJhdG9yIGZyb20gXCIuL2l0ZXJhdG9yLmpzXCI7XG5cbmV4cG9ydCB2YXIgcm9vdCA9IFtudWxsXTtcblxuZXhwb3J0IGZ1bmN0aW9uIFNlbGVjdGlvbihncm91cHMsIHBhcmVudHMpIHtcbiAgdGhpcy5fZ3JvdXBzID0gZ3JvdXBzO1xuICB0aGlzLl9wYXJlbnRzID0gcGFyZW50cztcbn1cblxuZnVuY3Rpb24gc2VsZWN0aW9uKCkge1xuICByZXR1cm4gbmV3IFNlbGVjdGlvbihbW2RvY3VtZW50LmRvY3VtZW50RWxlbWVudF1dLCByb290KTtcbn1cblxuZnVuY3Rpb24gc2VsZWN0aW9uX3NlbGVjdGlvbigpIHtcbiAgcmV0dXJuIHRoaXM7XG59XG5cblNlbGVjdGlvbi5wcm90b3R5cGUgPSBzZWxlY3Rpb24ucHJvdG90eXBlID0ge1xuICBjb25zdHJ1Y3RvcjogU2VsZWN0aW9uLFxuICBzZWxlY3Q6IHNlbGVjdGlvbl9zZWxlY3QsXG4gIHNlbGVjdEFsbDogc2VsZWN0aW9uX3NlbGVjdEFsbCxcbiAgc2VsZWN0Q2hpbGQ6IHNlbGVjdGlvbl9zZWxlY3RDaGlsZCxcbiAgc2VsZWN0Q2hpbGRyZW46IHNlbGVjdGlvbl9zZWxlY3RDaGlsZHJlbixcbiAgZmlsdGVyOiBzZWxlY3Rpb25fZmlsdGVyLFxuICBkYXRhOiBzZWxlY3Rpb25fZGF0YSxcbiAgZW50ZXI6IHNlbGVjdGlvbl9lbnRlcixcbiAgZXhpdDogc2VsZWN0aW9uX2V4aXQsXG4gIGpvaW46IHNlbGVjdGlvbl9qb2luLFxuICBtZXJnZTogc2VsZWN0aW9uX21lcmdlLFxuICBzZWxlY3Rpb246IHNlbGVjdGlvbl9zZWxlY3Rpb24sXG4gIG9yZGVyOiBzZWxlY3Rpb25fb3JkZXIsXG4gIHNvcnQ6IHNlbGVjdGlvbl9zb3J0LFxuICBjYWxsOiBzZWxlY3Rpb25fY2FsbCxcbiAgbm9kZXM6IHNlbGVjdGlvbl9ub2RlcyxcbiAgbm9kZTogc2VsZWN0aW9uX25vZGUsXG4gIHNpemU6IHNlbGVjdGlvbl9zaXplLFxuICBlbXB0eTogc2VsZWN0aW9uX2VtcHR5LFxuICBlYWNoOiBzZWxlY3Rpb25fZWFjaCxcbiAgYXR0cjogc2VsZWN0aW9uX2F0dHIsXG4gIHN0eWxlOiBzZWxlY3Rpb25fc3R5bGUsXG4gIHByb3BlcnR5OiBzZWxlY3Rpb25fcHJvcGVydHksXG4gIGNsYXNzZWQ6IHNlbGVjdGlvbl9jbGFzc2VkLFxuICB0ZXh0OiBzZWxlY3Rpb25fdGV4dCxcbiAgaHRtbDogc2VsZWN0aW9uX2h0bWwsXG4gIHJhaXNlOiBzZWxlY3Rpb25fcmFpc2UsXG4gIGxvd2VyOiBzZWxlY3Rpb25fbG93ZXIsXG4gIGFwcGVuZDogc2VsZWN0aW9uX2FwcGVuZCxcbiAgaW5zZXJ0OiBzZWxlY3Rpb25faW5zZXJ0LFxuICByZW1vdmU6IHNlbGVjdGlvbl9yZW1vdmUsXG4gIGNsb25lOiBzZWxlY3Rpb25fY2xvbmUsXG4gIGRhdHVtOiBzZWxlY3Rpb25fZGF0dW0sXG4gIG9uOiBzZWxlY3Rpb25fb24sXG4gIGRpc3BhdGNoOiBzZWxlY3Rpb25fZGlzcGF0Y2gsXG4gIFtTeW1ib2wuaXRlcmF0b3JdOiBzZWxlY3Rpb25faXRlcmF0b3Jcbn07XG5cbmV4cG9ydCBkZWZhdWx0IHNlbGVjdGlvbjtcbiIsICJpbXBvcnQge1NlbGVjdGlvbiwgcm9vdH0gZnJvbSBcIi4vc2VsZWN0aW9uL2luZGV4LmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHNlbGVjdG9yKSB7XG4gIHJldHVybiB0eXBlb2Ygc2VsZWN0b3IgPT09IFwic3RyaW5nXCJcbiAgICAgID8gbmV3IFNlbGVjdGlvbihbW2RvY3VtZW50LnF1ZXJ5U2VsZWN0b3Ioc2VsZWN0b3IpXV0sIFtkb2N1bWVudC5kb2N1bWVudEVsZW1lbnRdKVxuICAgICAgOiBuZXcgU2VsZWN0aW9uKFtbc2VsZWN0b3JdXSwgcm9vdCk7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oZXZlbnQpIHtcbiAgbGV0IHNvdXJjZUV2ZW50O1xuICB3aGlsZSAoc291cmNlRXZlbnQgPSBldmVudC5zb3VyY2VFdmVudCkgZXZlbnQgPSBzb3VyY2VFdmVudDtcbiAgcmV0dXJuIGV2ZW50O1xufVxuIiwgImltcG9ydCBzb3VyY2VFdmVudCBmcm9tIFwiLi9zb3VyY2VFdmVudC5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihldmVudCwgbm9kZSkge1xuICBldmVudCA9IHNvdXJjZUV2ZW50KGV2ZW50KTtcbiAgaWYgKG5vZGUgPT09IHVuZGVmaW5lZCkgbm9kZSA9IGV2ZW50LmN1cnJlbnRUYXJnZXQ7XG4gIGlmIChub2RlKSB7XG4gICAgdmFyIHN2ZyA9IG5vZGUub3duZXJTVkdFbGVtZW50IHx8IG5vZGU7XG4gICAgaWYgKHN2Zy5jcmVhdGVTVkdQb2ludCkge1xuICAgICAgdmFyIHBvaW50ID0gc3ZnLmNyZWF0ZVNWR1BvaW50KCk7XG4gICAgICBwb2ludC54ID0gZXZlbnQuY2xpZW50WCwgcG9pbnQueSA9IGV2ZW50LmNsaWVudFk7XG4gICAgICBwb2ludCA9IHBvaW50Lm1hdHJpeFRyYW5zZm9ybShub2RlLmdldFNjcmVlbkNUTSgpLmludmVyc2UoKSk7XG4gICAgICByZXR1cm4gW3BvaW50LngsIHBvaW50LnldO1xuICAgIH1cbiAgICBpZiAobm9kZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QpIHtcbiAgICAgIHZhciByZWN0ID0gbm9kZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgIHJldHVybiBbZXZlbnQuY2xpZW50WCAtIHJlY3QubGVmdCAtIG5vZGUuY2xpZW50TGVmdCwgZXZlbnQuY2xpZW50WSAtIHJlY3QudG9wIC0gbm9kZS5jbGllbnRUb3BdO1xuICAgIH1cbiAgfVxuICByZXR1cm4gW2V2ZW50LnBhZ2VYLCBldmVudC5wYWdlWV07XG59XG4iLCAiLy8gVGhlc2UgYXJlIHR5cGljYWxseSB1c2VkIGluIGNvbmp1bmN0aW9uIHdpdGggbm9ldmVudCB0byBlbnN1cmUgdGhhdCB3ZSBjYW5cbi8vIHByZXZlbnREZWZhdWx0IG9uIHRoZSBldmVudC5cbmV4cG9ydCBjb25zdCBub25wYXNzaXZlID0ge3Bhc3NpdmU6IGZhbHNlfTtcbmV4cG9ydCBjb25zdCBub25wYXNzaXZlY2FwdHVyZSA9IHtjYXB0dXJlOiB0cnVlLCBwYXNzaXZlOiBmYWxzZX07XG5cbmV4cG9ydCBmdW5jdGlvbiBub3Byb3BhZ2F0aW9uKGV2ZW50KSB7XG4gIGV2ZW50LnN0b3BJbW1lZGlhdGVQcm9wYWdhdGlvbigpO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihldmVudCkge1xuICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICBldmVudC5zdG9wSW1tZWRpYXRlUHJvcGFnYXRpb24oKTtcbn1cbiIsICJpbXBvcnQge3NlbGVjdH0gZnJvbSBcImQzLXNlbGVjdGlvblwiO1xuaW1wb3J0IG5vZXZlbnQsIHtub25wYXNzaXZlY2FwdHVyZX0gZnJvbSBcIi4vbm9ldmVudC5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih2aWV3KSB7XG4gIHZhciByb290ID0gdmlldy5kb2N1bWVudC5kb2N1bWVudEVsZW1lbnQsXG4gICAgICBzZWxlY3Rpb24gPSBzZWxlY3Qodmlldykub24oXCJkcmFnc3RhcnQuZHJhZ1wiLCBub2V2ZW50LCBub25wYXNzaXZlY2FwdHVyZSk7XG4gIGlmIChcIm9uc2VsZWN0c3RhcnRcIiBpbiByb290KSB7XG4gICAgc2VsZWN0aW9uLm9uKFwic2VsZWN0c3RhcnQuZHJhZ1wiLCBub2V2ZW50LCBub25wYXNzaXZlY2FwdHVyZSk7XG4gIH0gZWxzZSB7XG4gICAgcm9vdC5fX25vc2VsZWN0ID0gcm9vdC5zdHlsZS5Nb3pVc2VyU2VsZWN0O1xuICAgIHJvb3Quc3R5bGUuTW96VXNlclNlbGVjdCA9IFwibm9uZVwiO1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB5ZXNkcmFnKHZpZXcsIG5vY2xpY2spIHtcbiAgdmFyIHJvb3QgPSB2aWV3LmRvY3VtZW50LmRvY3VtZW50RWxlbWVudCxcbiAgICAgIHNlbGVjdGlvbiA9IHNlbGVjdCh2aWV3KS5vbihcImRyYWdzdGFydC5kcmFnXCIsIG51bGwpO1xuICBpZiAobm9jbGljaykge1xuICAgIHNlbGVjdGlvbi5vbihcImNsaWNrLmRyYWdcIiwgbm9ldmVudCwgbm9ucGFzc2l2ZWNhcHR1cmUpO1xuICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7IHNlbGVjdGlvbi5vbihcImNsaWNrLmRyYWdcIiwgbnVsbCk7IH0sIDApO1xuICB9XG4gIGlmIChcIm9uc2VsZWN0c3RhcnRcIiBpbiByb290KSB7XG4gICAgc2VsZWN0aW9uLm9uKFwic2VsZWN0c3RhcnQuZHJhZ1wiLCBudWxsKTtcbiAgfSBlbHNlIHtcbiAgICByb290LnN0eWxlLk1velVzZXJTZWxlY3QgPSByb290Ll9fbm9zZWxlY3Q7XG4gICAgZGVsZXRlIHJvb3QuX19ub3NlbGVjdDtcbiAgfVxufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGNvbnN0cnVjdG9yLCBmYWN0b3J5LCBwcm90b3R5cGUpIHtcbiAgY29uc3RydWN0b3IucHJvdG90eXBlID0gZmFjdG9yeS5wcm90b3R5cGUgPSBwcm90b3R5cGU7XG4gIHByb3RvdHlwZS5jb25zdHJ1Y3RvciA9IGNvbnN0cnVjdG9yO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZXh0ZW5kKHBhcmVudCwgZGVmaW5pdGlvbikge1xuICB2YXIgcHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShwYXJlbnQucHJvdG90eXBlKTtcbiAgZm9yICh2YXIga2V5IGluIGRlZmluaXRpb24pIHByb3RvdHlwZVtrZXldID0gZGVmaW5pdGlvbltrZXldO1xuICByZXR1cm4gcHJvdG90eXBlO1xufVxuIiwgImltcG9ydCBkZWZpbmUsIHtleHRlbmR9IGZyb20gXCIuL2RlZmluZS5qc1wiO1xuXG5leHBvcnQgZnVuY3Rpb24gQ29sb3IoKSB7fVxuXG5leHBvcnQgdmFyIGRhcmtlciA9IDAuNztcbmV4cG9ydCB2YXIgYnJpZ2h0ZXIgPSAxIC8gZGFya2VyO1xuXG52YXIgcmVJID0gXCJcXFxccyooWystXT9cXFxcZCspXFxcXHMqXCIsXG4gICAgcmVOID0gXCJcXFxccyooWystXT8oPzpcXFxcZCpcXFxcLik/XFxcXGQrKD86W2VFXVsrLV0/XFxcXGQrKT8pXFxcXHMqXCIsXG4gICAgcmVQID0gXCJcXFxccyooWystXT8oPzpcXFxcZCpcXFxcLik/XFxcXGQrKD86W2VFXVsrLV0/XFxcXGQrKT8pJVxcXFxzKlwiLFxuICAgIHJlSGV4ID0gL14jKFswLTlhLWZdezMsOH0pJC8sXG4gICAgcmVSZ2JJbnRlZ2VyID0gbmV3IFJlZ0V4cChgXnJnYlxcXFwoJHtyZUl9LCR7cmVJfSwke3JlSX1cXFxcKSRgKSxcbiAgICByZVJnYlBlcmNlbnQgPSBuZXcgUmVnRXhwKGBecmdiXFxcXCgke3JlUH0sJHtyZVB9LCR7cmVQfVxcXFwpJGApLFxuICAgIHJlUmdiYUludGVnZXIgPSBuZXcgUmVnRXhwKGBecmdiYVxcXFwoJHtyZUl9LCR7cmVJfSwke3JlSX0sJHtyZU59XFxcXCkkYCksXG4gICAgcmVSZ2JhUGVyY2VudCA9IG5ldyBSZWdFeHAoYF5yZ2JhXFxcXCgke3JlUH0sJHtyZVB9LCR7cmVQfSwke3JlTn1cXFxcKSRgKSxcbiAgICByZUhzbFBlcmNlbnQgPSBuZXcgUmVnRXhwKGBeaHNsXFxcXCgke3JlTn0sJHtyZVB9LCR7cmVQfVxcXFwpJGApLFxuICAgIHJlSHNsYVBlcmNlbnQgPSBuZXcgUmVnRXhwKGBeaHNsYVxcXFwoJHtyZU59LCR7cmVQfSwke3JlUH0sJHtyZU59XFxcXCkkYCk7XG5cbnZhciBuYW1lZCA9IHtcbiAgYWxpY2VibHVlOiAweGYwZjhmZixcbiAgYW50aXF1ZXdoaXRlOiAweGZhZWJkNyxcbiAgYXF1YTogMHgwMGZmZmYsXG4gIGFxdWFtYXJpbmU6IDB4N2ZmZmQ0LFxuICBhenVyZTogMHhmMGZmZmYsXG4gIGJlaWdlOiAweGY1ZjVkYyxcbiAgYmlzcXVlOiAweGZmZTRjNCxcbiAgYmxhY2s6IDB4MDAwMDAwLFxuICBibGFuY2hlZGFsbW9uZDogMHhmZmViY2QsXG4gIGJsdWU6IDB4MDAwMGZmLFxuICBibHVldmlvbGV0OiAweDhhMmJlMixcbiAgYnJvd246IDB4YTUyYTJhLFxuICBidXJseXdvb2Q6IDB4ZGViODg3LFxuICBjYWRldGJsdWU6IDB4NWY5ZWEwLFxuICBjaGFydHJldXNlOiAweDdmZmYwMCxcbiAgY2hvY29sYXRlOiAweGQyNjkxZSxcbiAgY29yYWw6IDB4ZmY3ZjUwLFxuICBjb3JuZmxvd2VyYmx1ZTogMHg2NDk1ZWQsXG4gIGNvcm5zaWxrOiAweGZmZjhkYyxcbiAgY3JpbXNvbjogMHhkYzE0M2MsXG4gIGN5YW46IDB4MDBmZmZmLFxuICBkYXJrYmx1ZTogMHgwMDAwOGIsXG4gIGRhcmtjeWFuOiAweDAwOGI4YixcbiAgZGFya2dvbGRlbnJvZDogMHhiODg2MGIsXG4gIGRhcmtncmF5OiAweGE5YTlhOSxcbiAgZGFya2dyZWVuOiAweDAwNjQwMCxcbiAgZGFya2dyZXk6IDB4YTlhOWE5LFxuICBkYXJra2hha2k6IDB4YmRiNzZiLFxuICBkYXJrbWFnZW50YTogMHg4YjAwOGIsXG4gIGRhcmtvbGl2ZWdyZWVuOiAweDU1NmIyZixcbiAgZGFya29yYW5nZTogMHhmZjhjMDAsXG4gIGRhcmtvcmNoaWQ6IDB4OTkzMmNjLFxuICBkYXJrcmVkOiAweDhiMDAwMCxcbiAgZGFya3NhbG1vbjogMHhlOTk2N2EsXG4gIGRhcmtzZWFncmVlbjogMHg4ZmJjOGYsXG4gIGRhcmtzbGF0ZWJsdWU6IDB4NDgzZDhiLFxuICBkYXJrc2xhdGVncmF5OiAweDJmNGY0ZixcbiAgZGFya3NsYXRlZ3JleTogMHgyZjRmNGYsXG4gIGRhcmt0dXJxdW9pc2U6IDB4MDBjZWQxLFxuICBkYXJrdmlvbGV0OiAweDk0MDBkMyxcbiAgZGVlcHBpbms6IDB4ZmYxNDkzLFxuICBkZWVwc2t5Ymx1ZTogMHgwMGJmZmYsXG4gIGRpbWdyYXk6IDB4Njk2OTY5LFxuICBkaW1ncmV5OiAweDY5Njk2OSxcbiAgZG9kZ2VyYmx1ZTogMHgxZTkwZmYsXG4gIGZpcmVicmljazogMHhiMjIyMjIsXG4gIGZsb3JhbHdoaXRlOiAweGZmZmFmMCxcbiAgZm9yZXN0Z3JlZW46IDB4MjI4YjIyLFxuICBmdWNoc2lhOiAweGZmMDBmZixcbiAgZ2FpbnNib3JvOiAweGRjZGNkYyxcbiAgZ2hvc3R3aGl0ZTogMHhmOGY4ZmYsXG4gIGdvbGQ6IDB4ZmZkNzAwLFxuICBnb2xkZW5yb2Q6IDB4ZGFhNTIwLFxuICBncmF5OiAweDgwODA4MCxcbiAgZ3JlZW46IDB4MDA4MDAwLFxuICBncmVlbnllbGxvdzogMHhhZGZmMmYsXG4gIGdyZXk6IDB4ODA4MDgwLFxuICBob25leWRldzogMHhmMGZmZjAsXG4gIGhvdHBpbms6IDB4ZmY2OWI0LFxuICBpbmRpYW5yZWQ6IDB4Y2Q1YzVjLFxuICBpbmRpZ286IDB4NGIwMDgyLFxuICBpdm9yeTogMHhmZmZmZjAsXG4gIGtoYWtpOiAweGYwZTY4YyxcbiAgbGF2ZW5kZXI6IDB4ZTZlNmZhLFxuICBsYXZlbmRlcmJsdXNoOiAweGZmZjBmNSxcbiAgbGF3bmdyZWVuOiAweDdjZmMwMCxcbiAgbGVtb25jaGlmZm9uOiAweGZmZmFjZCxcbiAgbGlnaHRibHVlOiAweGFkZDhlNixcbiAgbGlnaHRjb3JhbDogMHhmMDgwODAsXG4gIGxpZ2h0Y3lhbjogMHhlMGZmZmYsXG4gIGxpZ2h0Z29sZGVucm9keWVsbG93OiAweGZhZmFkMixcbiAgbGlnaHRncmF5OiAweGQzZDNkMyxcbiAgbGlnaHRncmVlbjogMHg5MGVlOTAsXG4gIGxpZ2h0Z3JleTogMHhkM2QzZDMsXG4gIGxpZ2h0cGluazogMHhmZmI2YzEsXG4gIGxpZ2h0c2FsbW9uOiAweGZmYTA3YSxcbiAgbGlnaHRzZWFncmVlbjogMHgyMGIyYWEsXG4gIGxpZ2h0c2t5Ymx1ZTogMHg4N2NlZmEsXG4gIGxpZ2h0c2xhdGVncmF5OiAweDc3ODg5OSxcbiAgbGlnaHRzbGF0ZWdyZXk6IDB4Nzc4ODk5LFxuICBsaWdodHN0ZWVsYmx1ZTogMHhiMGM0ZGUsXG4gIGxpZ2h0eWVsbG93OiAweGZmZmZlMCxcbiAgbGltZTogMHgwMGZmMDAsXG4gIGxpbWVncmVlbjogMHgzMmNkMzIsXG4gIGxpbmVuOiAweGZhZjBlNixcbiAgbWFnZW50YTogMHhmZjAwZmYsXG4gIG1hcm9vbjogMHg4MDAwMDAsXG4gIG1lZGl1bWFxdWFtYXJpbmU6IDB4NjZjZGFhLFxuICBtZWRpdW1ibHVlOiAweDAwMDBjZCxcbiAgbWVkaXVtb3JjaGlkOiAweGJhNTVkMyxcbiAgbWVkaXVtcHVycGxlOiAweDkzNzBkYixcbiAgbWVkaXVtc2VhZ3JlZW46IDB4M2NiMzcxLFxuICBtZWRpdW1zbGF0ZWJsdWU6IDB4N2I2OGVlLFxuICBtZWRpdW1zcHJpbmdncmVlbjogMHgwMGZhOWEsXG4gIG1lZGl1bXR1cnF1b2lzZTogMHg0OGQxY2MsXG4gIG1lZGl1bXZpb2xldHJlZDogMHhjNzE1ODUsXG4gIG1pZG5pZ2h0Ymx1ZTogMHgxOTE5NzAsXG4gIG1pbnRjcmVhbTogMHhmNWZmZmEsXG4gIG1pc3R5cm9zZTogMHhmZmU0ZTEsXG4gIG1vY2Nhc2luOiAweGZmZTRiNSxcbiAgbmF2YWpvd2hpdGU6IDB4ZmZkZWFkLFxuICBuYXZ5OiAweDAwMDA4MCxcbiAgb2xkbGFjZTogMHhmZGY1ZTYsXG4gIG9saXZlOiAweDgwODAwMCxcbiAgb2xpdmVkcmFiOiAweDZiOGUyMyxcbiAgb3JhbmdlOiAweGZmYTUwMCxcbiAgb3JhbmdlcmVkOiAweGZmNDUwMCxcbiAgb3JjaGlkOiAweGRhNzBkNixcbiAgcGFsZWdvbGRlbnJvZDogMHhlZWU4YWEsXG4gIHBhbGVncmVlbjogMHg5OGZiOTgsXG4gIHBhbGV0dXJxdW9pc2U6IDB4YWZlZWVlLFxuICBwYWxldmlvbGV0cmVkOiAweGRiNzA5MyxcbiAgcGFwYXlhd2hpcDogMHhmZmVmZDUsXG4gIHBlYWNocHVmZjogMHhmZmRhYjksXG4gIHBlcnU6IDB4Y2Q4NTNmLFxuICBwaW5rOiAweGZmYzBjYixcbiAgcGx1bTogMHhkZGEwZGQsXG4gIHBvd2RlcmJsdWU6IDB4YjBlMGU2LFxuICBwdXJwbGU6IDB4ODAwMDgwLFxuICByZWJlY2NhcHVycGxlOiAweDY2MzM5OSxcbiAgcmVkOiAweGZmMDAwMCxcbiAgcm9zeWJyb3duOiAweGJjOGY4ZixcbiAgcm95YWxibHVlOiAweDQxNjllMSxcbiAgc2FkZGxlYnJvd246IDB4OGI0NTEzLFxuICBzYWxtb246IDB4ZmE4MDcyLFxuICBzYW5keWJyb3duOiAweGY0YTQ2MCxcbiAgc2VhZ3JlZW46IDB4MmU4YjU3LFxuICBzZWFzaGVsbDogMHhmZmY1ZWUsXG4gIHNpZW5uYTogMHhhMDUyMmQsXG4gIHNpbHZlcjogMHhjMGMwYzAsXG4gIHNreWJsdWU6IDB4ODdjZWViLFxuICBzbGF0ZWJsdWU6IDB4NmE1YWNkLFxuICBzbGF0ZWdyYXk6IDB4NzA4MDkwLFxuICBzbGF0ZWdyZXk6IDB4NzA4MDkwLFxuICBzbm93OiAweGZmZmFmYSxcbiAgc3ByaW5nZ3JlZW46IDB4MDBmZjdmLFxuICBzdGVlbGJsdWU6IDB4NDY4MmI0LFxuICB0YW46IDB4ZDJiNDhjLFxuICB0ZWFsOiAweDAwODA4MCxcbiAgdGhpc3RsZTogMHhkOGJmZDgsXG4gIHRvbWF0bzogMHhmZjYzNDcsXG4gIHR1cnF1b2lzZTogMHg0MGUwZDAsXG4gIHZpb2xldDogMHhlZTgyZWUsXG4gIHdoZWF0OiAweGY1ZGViMyxcbiAgd2hpdGU6IDB4ZmZmZmZmLFxuICB3aGl0ZXNtb2tlOiAweGY1ZjVmNSxcbiAgeWVsbG93OiAweGZmZmYwMCxcbiAgeWVsbG93Z3JlZW46IDB4OWFjZDMyXG59O1xuXG5kZWZpbmUoQ29sb3IsIGNvbG9yLCB7XG4gIGNvcHkoY2hhbm5lbHMpIHtcbiAgICByZXR1cm4gT2JqZWN0LmFzc2lnbihuZXcgdGhpcy5jb25zdHJ1Y3RvciwgdGhpcywgY2hhbm5lbHMpO1xuICB9LFxuICBkaXNwbGF5YWJsZSgpIHtcbiAgICByZXR1cm4gdGhpcy5yZ2IoKS5kaXNwbGF5YWJsZSgpO1xuICB9LFxuICBoZXg6IGNvbG9yX2Zvcm1hdEhleCwgLy8gRGVwcmVjYXRlZCEgVXNlIGNvbG9yLmZvcm1hdEhleC5cbiAgZm9ybWF0SGV4OiBjb2xvcl9mb3JtYXRIZXgsXG4gIGZvcm1hdEhleDg6IGNvbG9yX2Zvcm1hdEhleDgsXG4gIGZvcm1hdEhzbDogY29sb3JfZm9ybWF0SHNsLFxuICBmb3JtYXRSZ2I6IGNvbG9yX2Zvcm1hdFJnYixcbiAgdG9TdHJpbmc6IGNvbG9yX2Zvcm1hdFJnYlxufSk7XG5cbmZ1bmN0aW9uIGNvbG9yX2Zvcm1hdEhleCgpIHtcbiAgcmV0dXJuIHRoaXMucmdiKCkuZm9ybWF0SGV4KCk7XG59XG5cbmZ1bmN0aW9uIGNvbG9yX2Zvcm1hdEhleDgoKSB7XG4gIHJldHVybiB0aGlzLnJnYigpLmZvcm1hdEhleDgoKTtcbn1cblxuZnVuY3Rpb24gY29sb3JfZm9ybWF0SHNsKCkge1xuICByZXR1cm4gaHNsQ29udmVydCh0aGlzKS5mb3JtYXRIc2woKTtcbn1cblxuZnVuY3Rpb24gY29sb3JfZm9ybWF0UmdiKCkge1xuICByZXR1cm4gdGhpcy5yZ2IoKS5mb3JtYXRSZ2IoKTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gY29sb3IoZm9ybWF0KSB7XG4gIHZhciBtLCBsO1xuICBmb3JtYXQgPSAoZm9ybWF0ICsgXCJcIikudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gIHJldHVybiAobSA9IHJlSGV4LmV4ZWMoZm9ybWF0KSkgPyAobCA9IG1bMV0ubGVuZ3RoLCBtID0gcGFyc2VJbnQobVsxXSwgMTYpLCBsID09PSA2ID8gcmdibihtKSAvLyAjZmYwMDAwXG4gICAgICA6IGwgPT09IDMgPyBuZXcgUmdiKChtID4+IDggJiAweGYpIHwgKG0gPj4gNCAmIDB4ZjApLCAobSA+PiA0ICYgMHhmKSB8IChtICYgMHhmMCksICgobSAmIDB4ZikgPDwgNCkgfCAobSAmIDB4ZiksIDEpIC8vICNmMDBcbiAgICAgIDogbCA9PT0gOCA/IHJnYmEobSA+PiAyNCAmIDB4ZmYsIG0gPj4gMTYgJiAweGZmLCBtID4+IDggJiAweGZmLCAobSAmIDB4ZmYpIC8gMHhmZikgLy8gI2ZmMDAwMDAwXG4gICAgICA6IGwgPT09IDQgPyByZ2JhKChtID4+IDEyICYgMHhmKSB8IChtID4+IDggJiAweGYwKSwgKG0gPj4gOCAmIDB4ZikgfCAobSA+PiA0ICYgMHhmMCksIChtID4+IDQgJiAweGYpIHwgKG0gJiAweGYwKSwgKCgobSAmIDB4ZikgPDwgNCkgfCAobSAmIDB4ZikpIC8gMHhmZikgLy8gI2YwMDBcbiAgICAgIDogbnVsbCkgLy8gaW52YWxpZCBoZXhcbiAgICAgIDogKG0gPSByZVJnYkludGVnZXIuZXhlYyhmb3JtYXQpKSA/IG5ldyBSZ2IobVsxXSwgbVsyXSwgbVszXSwgMSkgLy8gcmdiKDI1NSwgMCwgMClcbiAgICAgIDogKG0gPSByZVJnYlBlcmNlbnQuZXhlYyhmb3JtYXQpKSA/IG5ldyBSZ2IobVsxXSAqIDI1NSAvIDEwMCwgbVsyXSAqIDI1NSAvIDEwMCwgbVszXSAqIDI1NSAvIDEwMCwgMSkgLy8gcmdiKDEwMCUsIDAlLCAwJSlcbiAgICAgIDogKG0gPSByZVJnYmFJbnRlZ2VyLmV4ZWMoZm9ybWF0KSkgPyByZ2JhKG1bMV0sIG1bMl0sIG1bM10sIG1bNF0pIC8vIHJnYmEoMjU1LCAwLCAwLCAxKVxuICAgICAgOiAobSA9IHJlUmdiYVBlcmNlbnQuZXhlYyhmb3JtYXQpKSA/IHJnYmEobVsxXSAqIDI1NSAvIDEwMCwgbVsyXSAqIDI1NSAvIDEwMCwgbVszXSAqIDI1NSAvIDEwMCwgbVs0XSkgLy8gcmdiKDEwMCUsIDAlLCAwJSwgMSlcbiAgICAgIDogKG0gPSByZUhzbFBlcmNlbnQuZXhlYyhmb3JtYXQpKSA/IGhzbGEobVsxXSwgbVsyXSAvIDEwMCwgbVszXSAvIDEwMCwgMSkgLy8gaHNsKDEyMCwgNTAlLCA1MCUpXG4gICAgICA6IChtID0gcmVIc2xhUGVyY2VudC5leGVjKGZvcm1hdCkpID8gaHNsYShtWzFdLCBtWzJdIC8gMTAwLCBtWzNdIC8gMTAwLCBtWzRdKSAvLyBoc2xhKDEyMCwgNTAlLCA1MCUsIDEpXG4gICAgICA6IG5hbWVkLmhhc093blByb3BlcnR5KGZvcm1hdCkgPyByZ2JuKG5hbWVkW2Zvcm1hdF0pIC8vIGVzbGludC1kaXNhYmxlLWxpbmUgbm8tcHJvdG90eXBlLWJ1aWx0aW5zXG4gICAgICA6IGZvcm1hdCA9PT0gXCJ0cmFuc3BhcmVudFwiID8gbmV3IFJnYihOYU4sIE5hTiwgTmFOLCAwKVxuICAgICAgOiBudWxsO1xufVxuXG5mdW5jdGlvbiByZ2JuKG4pIHtcbiAgcmV0dXJuIG5ldyBSZ2IobiA+PiAxNiAmIDB4ZmYsIG4gPj4gOCAmIDB4ZmYsIG4gJiAweGZmLCAxKTtcbn1cblxuZnVuY3Rpb24gcmdiYShyLCBnLCBiLCBhKSB7XG4gIGlmIChhIDw9IDApIHIgPSBnID0gYiA9IE5hTjtcbiAgcmV0dXJuIG5ldyBSZ2IociwgZywgYiwgYSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZ2JDb252ZXJ0KG8pIHtcbiAgaWYgKCEobyBpbnN0YW5jZW9mIENvbG9yKSkgbyA9IGNvbG9yKG8pO1xuICBpZiAoIW8pIHJldHVybiBuZXcgUmdiO1xuICBvID0gby5yZ2IoKTtcbiAgcmV0dXJuIG5ldyBSZ2Ioby5yLCBvLmcsIG8uYiwgby5vcGFjaXR5KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJnYihyLCBnLCBiLCBvcGFjaXR5KSB7XG4gIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID09PSAxID8gcmdiQ29udmVydChyKSA6IG5ldyBSZ2IociwgZywgYiwgb3BhY2l0eSA9PSBudWxsID8gMSA6IG9wYWNpdHkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gUmdiKHIsIGcsIGIsIG9wYWNpdHkpIHtcbiAgdGhpcy5yID0gK3I7XG4gIHRoaXMuZyA9ICtnO1xuICB0aGlzLmIgPSArYjtcbiAgdGhpcy5vcGFjaXR5ID0gK29wYWNpdHk7XG59XG5cbmRlZmluZShSZ2IsIHJnYiwgZXh0ZW5kKENvbG9yLCB7XG4gIGJyaWdodGVyKGspIHtcbiAgICBrID0gayA9PSBudWxsID8gYnJpZ2h0ZXIgOiBNYXRoLnBvdyhicmlnaHRlciwgayk7XG4gICAgcmV0dXJuIG5ldyBSZ2IodGhpcy5yICogaywgdGhpcy5nICogaywgdGhpcy5iICogaywgdGhpcy5vcGFjaXR5KTtcbiAgfSxcbiAgZGFya2VyKGspIHtcbiAgICBrID0gayA9PSBudWxsID8gZGFya2VyIDogTWF0aC5wb3coZGFya2VyLCBrKTtcbiAgICByZXR1cm4gbmV3IFJnYih0aGlzLnIgKiBrLCB0aGlzLmcgKiBrLCB0aGlzLmIgKiBrLCB0aGlzLm9wYWNpdHkpO1xuICB9LFxuICByZ2IoKSB7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH0sXG4gIGNsYW1wKCkge1xuICAgIHJldHVybiBuZXcgUmdiKGNsYW1waSh0aGlzLnIpLCBjbGFtcGkodGhpcy5nKSwgY2xhbXBpKHRoaXMuYiksIGNsYW1wYSh0aGlzLm9wYWNpdHkpKTtcbiAgfSxcbiAgZGlzcGxheWFibGUoKSB7XG4gICAgcmV0dXJuICgtMC41IDw9IHRoaXMuciAmJiB0aGlzLnIgPCAyNTUuNSlcbiAgICAgICAgJiYgKC0wLjUgPD0gdGhpcy5nICYmIHRoaXMuZyA8IDI1NS41KVxuICAgICAgICAmJiAoLTAuNSA8PSB0aGlzLmIgJiYgdGhpcy5iIDwgMjU1LjUpXG4gICAgICAgICYmICgwIDw9IHRoaXMub3BhY2l0eSAmJiB0aGlzLm9wYWNpdHkgPD0gMSk7XG4gIH0sXG4gIGhleDogcmdiX2Zvcm1hdEhleCwgLy8gRGVwcmVjYXRlZCEgVXNlIGNvbG9yLmZvcm1hdEhleC5cbiAgZm9ybWF0SGV4OiByZ2JfZm9ybWF0SGV4LFxuICBmb3JtYXRIZXg4OiByZ2JfZm9ybWF0SGV4OCxcbiAgZm9ybWF0UmdiOiByZ2JfZm9ybWF0UmdiLFxuICB0b1N0cmluZzogcmdiX2Zvcm1hdFJnYlxufSkpO1xuXG5mdW5jdGlvbiByZ2JfZm9ybWF0SGV4KCkge1xuICByZXR1cm4gYCMke2hleCh0aGlzLnIpfSR7aGV4KHRoaXMuZyl9JHtoZXgodGhpcy5iKX1gO1xufVxuXG5mdW5jdGlvbiByZ2JfZm9ybWF0SGV4OCgpIHtcbiAgcmV0dXJuIGAjJHtoZXgodGhpcy5yKX0ke2hleCh0aGlzLmcpfSR7aGV4KHRoaXMuYil9JHtoZXgoKGlzTmFOKHRoaXMub3BhY2l0eSkgPyAxIDogdGhpcy5vcGFjaXR5KSAqIDI1NSl9YDtcbn1cblxuZnVuY3Rpb24gcmdiX2Zvcm1hdFJnYigpIHtcbiAgY29uc3QgYSA9IGNsYW1wYSh0aGlzLm9wYWNpdHkpO1xuICByZXR1cm4gYCR7YSA9PT0gMSA/IFwicmdiKFwiIDogXCJyZ2JhKFwifSR7Y2xhbXBpKHRoaXMucil9LCAke2NsYW1waSh0aGlzLmcpfSwgJHtjbGFtcGkodGhpcy5iKX0ke2EgPT09IDEgPyBcIilcIiA6IGAsICR7YX0pYH1gO1xufVxuXG5mdW5jdGlvbiBjbGFtcGEob3BhY2l0eSkge1xuICByZXR1cm4gaXNOYU4ob3BhY2l0eSkgPyAxIDogTWF0aC5tYXgoMCwgTWF0aC5taW4oMSwgb3BhY2l0eSkpO1xufVxuXG5mdW5jdGlvbiBjbGFtcGkodmFsdWUpIHtcbiAgcmV0dXJuIE1hdGgubWF4KDAsIE1hdGgubWluKDI1NSwgTWF0aC5yb3VuZCh2YWx1ZSkgfHwgMCkpO1xufVxuXG5mdW5jdGlvbiBoZXgodmFsdWUpIHtcbiAgdmFsdWUgPSBjbGFtcGkodmFsdWUpO1xuICByZXR1cm4gKHZhbHVlIDwgMTYgPyBcIjBcIiA6IFwiXCIpICsgdmFsdWUudG9TdHJpbmcoMTYpO1xufVxuXG5mdW5jdGlvbiBoc2xhKGgsIHMsIGwsIGEpIHtcbiAgaWYgKGEgPD0gMCkgaCA9IHMgPSBsID0gTmFOO1xuICBlbHNlIGlmIChsIDw9IDAgfHwgbCA+PSAxKSBoID0gcyA9IE5hTjtcbiAgZWxzZSBpZiAocyA8PSAwKSBoID0gTmFOO1xuICByZXR1cm4gbmV3IEhzbChoLCBzLCBsLCBhKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGhzbENvbnZlcnQobykge1xuICBpZiAobyBpbnN0YW5jZW9mIEhzbCkgcmV0dXJuIG5ldyBIc2woby5oLCBvLnMsIG8ubCwgby5vcGFjaXR5KTtcbiAgaWYgKCEobyBpbnN0YW5jZW9mIENvbG9yKSkgbyA9IGNvbG9yKG8pO1xuICBpZiAoIW8pIHJldHVybiBuZXcgSHNsO1xuICBpZiAobyBpbnN0YW5jZW9mIEhzbCkgcmV0dXJuIG87XG4gIG8gPSBvLnJnYigpO1xuICB2YXIgciA9IG8uciAvIDI1NSxcbiAgICAgIGcgPSBvLmcgLyAyNTUsXG4gICAgICBiID0gby5iIC8gMjU1LFxuICAgICAgbWluID0gTWF0aC5taW4ociwgZywgYiksXG4gICAgICBtYXggPSBNYXRoLm1heChyLCBnLCBiKSxcbiAgICAgIGggPSBOYU4sXG4gICAgICBzID0gbWF4IC0gbWluLFxuICAgICAgbCA9IChtYXggKyBtaW4pIC8gMjtcbiAgaWYgKHMpIHtcbiAgICBpZiAociA9PT0gbWF4KSBoID0gKGcgLSBiKSAvIHMgKyAoZyA8IGIpICogNjtcbiAgICBlbHNlIGlmIChnID09PSBtYXgpIGggPSAoYiAtIHIpIC8gcyArIDI7XG4gICAgZWxzZSBoID0gKHIgLSBnKSAvIHMgKyA0O1xuICAgIHMgLz0gbCA8IDAuNSA/IG1heCArIG1pbiA6IDIgLSBtYXggLSBtaW47XG4gICAgaCAqPSA2MDtcbiAgfSBlbHNlIHtcbiAgICBzID0gbCA+IDAgJiYgbCA8IDEgPyAwIDogaDtcbiAgfVxuICByZXR1cm4gbmV3IEhzbChoLCBzLCBsLCBvLm9wYWNpdHkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaHNsKGgsIHMsIGwsIG9wYWNpdHkpIHtcbiAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPT09IDEgPyBoc2xDb252ZXJ0KGgpIDogbmV3IEhzbChoLCBzLCBsLCBvcGFjaXR5ID09IG51bGwgPyAxIDogb3BhY2l0eSk7XG59XG5cbmZ1bmN0aW9uIEhzbChoLCBzLCBsLCBvcGFjaXR5KSB7XG4gIHRoaXMuaCA9ICtoO1xuICB0aGlzLnMgPSArcztcbiAgdGhpcy5sID0gK2w7XG4gIHRoaXMub3BhY2l0eSA9ICtvcGFjaXR5O1xufVxuXG5kZWZpbmUoSHNsLCBoc2wsIGV4dGVuZChDb2xvciwge1xuICBicmlnaHRlcihrKSB7XG4gICAgayA9IGsgPT0gbnVsbCA/IGJyaWdodGVyIDogTWF0aC5wb3coYnJpZ2h0ZXIsIGspO1xuICAgIHJldHVybiBuZXcgSHNsKHRoaXMuaCwgdGhpcy5zLCB0aGlzLmwgKiBrLCB0aGlzLm9wYWNpdHkpO1xuICB9LFxuICBkYXJrZXIoaykge1xuICAgIGsgPSBrID09IG51bGwgPyBkYXJrZXIgOiBNYXRoLnBvdyhkYXJrZXIsIGspO1xuICAgIHJldHVybiBuZXcgSHNsKHRoaXMuaCwgdGhpcy5zLCB0aGlzLmwgKiBrLCB0aGlzLm9wYWNpdHkpO1xuICB9LFxuICByZ2IoKSB7XG4gICAgdmFyIGggPSB0aGlzLmggJSAzNjAgKyAodGhpcy5oIDwgMCkgKiAzNjAsXG4gICAgICAgIHMgPSBpc05hTihoKSB8fCBpc05hTih0aGlzLnMpID8gMCA6IHRoaXMucyxcbiAgICAgICAgbCA9IHRoaXMubCxcbiAgICAgICAgbTIgPSBsICsgKGwgPCAwLjUgPyBsIDogMSAtIGwpICogcyxcbiAgICAgICAgbTEgPSAyICogbCAtIG0yO1xuICAgIHJldHVybiBuZXcgUmdiKFxuICAgICAgaHNsMnJnYihoID49IDI0MCA/IGggLSAyNDAgOiBoICsgMTIwLCBtMSwgbTIpLFxuICAgICAgaHNsMnJnYihoLCBtMSwgbTIpLFxuICAgICAgaHNsMnJnYihoIDwgMTIwID8gaCArIDI0MCA6IGggLSAxMjAsIG0xLCBtMiksXG4gICAgICB0aGlzLm9wYWNpdHlcbiAgICApO1xuICB9LFxuICBjbGFtcCgpIHtcbiAgICByZXR1cm4gbmV3IEhzbChjbGFtcGgodGhpcy5oKSwgY2xhbXB0KHRoaXMucyksIGNsYW1wdCh0aGlzLmwpLCBjbGFtcGEodGhpcy5vcGFjaXR5KSk7XG4gIH0sXG4gIGRpc3BsYXlhYmxlKCkge1xuICAgIHJldHVybiAoMCA8PSB0aGlzLnMgJiYgdGhpcy5zIDw9IDEgfHwgaXNOYU4odGhpcy5zKSlcbiAgICAgICAgJiYgKDAgPD0gdGhpcy5sICYmIHRoaXMubCA8PSAxKVxuICAgICAgICAmJiAoMCA8PSB0aGlzLm9wYWNpdHkgJiYgdGhpcy5vcGFjaXR5IDw9IDEpO1xuICB9LFxuICBmb3JtYXRIc2woKSB7XG4gICAgY29uc3QgYSA9IGNsYW1wYSh0aGlzLm9wYWNpdHkpO1xuICAgIHJldHVybiBgJHthID09PSAxID8gXCJoc2woXCIgOiBcImhzbGEoXCJ9JHtjbGFtcGgodGhpcy5oKX0sICR7Y2xhbXB0KHRoaXMucykgKiAxMDB9JSwgJHtjbGFtcHQodGhpcy5sKSAqIDEwMH0lJHthID09PSAxID8gXCIpXCIgOiBgLCAke2F9KWB9YDtcbiAgfVxufSkpO1xuXG5mdW5jdGlvbiBjbGFtcGgodmFsdWUpIHtcbiAgdmFsdWUgPSAodmFsdWUgfHwgMCkgJSAzNjA7XG4gIHJldHVybiB2YWx1ZSA8IDAgPyB2YWx1ZSArIDM2MCA6IHZhbHVlO1xufVxuXG5mdW5jdGlvbiBjbGFtcHQodmFsdWUpIHtcbiAgcmV0dXJuIE1hdGgubWF4KDAsIE1hdGgubWluKDEsIHZhbHVlIHx8IDApKTtcbn1cblxuLyogRnJvbSBGdkQgMTMuMzcsIENTUyBDb2xvciBNb2R1bGUgTGV2ZWwgMyAqL1xuZnVuY3Rpb24gaHNsMnJnYihoLCBtMSwgbTIpIHtcbiAgcmV0dXJuIChoIDwgNjAgPyBtMSArIChtMiAtIG0xKSAqIGggLyA2MFxuICAgICAgOiBoIDwgMTgwID8gbTJcbiAgICAgIDogaCA8IDI0MCA/IG0xICsgKG0yIC0gbTEpICogKDI0MCAtIGgpIC8gNjBcbiAgICAgIDogbTEpICogMjU1O1xufVxuIiwgImV4cG9ydCBmdW5jdGlvbiBiYXNpcyh0MSwgdjAsIHYxLCB2MiwgdjMpIHtcbiAgdmFyIHQyID0gdDEgKiB0MSwgdDMgPSB0MiAqIHQxO1xuICByZXR1cm4gKCgxIC0gMyAqIHQxICsgMyAqIHQyIC0gdDMpICogdjBcbiAgICAgICsgKDQgLSA2ICogdDIgKyAzICogdDMpICogdjFcbiAgICAgICsgKDEgKyAzICogdDEgKyAzICogdDIgLSAzICogdDMpICogdjJcbiAgICAgICsgdDMgKiB2MykgLyA2O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih2YWx1ZXMpIHtcbiAgdmFyIG4gPSB2YWx1ZXMubGVuZ3RoIC0gMTtcbiAgcmV0dXJuIGZ1bmN0aW9uKHQpIHtcbiAgICB2YXIgaSA9IHQgPD0gMCA/ICh0ID0gMCkgOiB0ID49IDEgPyAodCA9IDEsIG4gLSAxKSA6IE1hdGguZmxvb3IodCAqIG4pLFxuICAgICAgICB2MSA9IHZhbHVlc1tpXSxcbiAgICAgICAgdjIgPSB2YWx1ZXNbaSArIDFdLFxuICAgICAgICB2MCA9IGkgPiAwID8gdmFsdWVzW2kgLSAxXSA6IDIgKiB2MSAtIHYyLFxuICAgICAgICB2MyA9IGkgPCBuIC0gMSA/IHZhbHVlc1tpICsgMl0gOiAyICogdjIgLSB2MTtcbiAgICByZXR1cm4gYmFzaXMoKHQgLSBpIC8gbikgKiBuLCB2MCwgdjEsIHYyLCB2Myk7XG4gIH07XG59XG4iLCAiaW1wb3J0IHtiYXNpc30gZnJvbSBcIi4vYmFzaXMuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24odmFsdWVzKSB7XG4gIHZhciBuID0gdmFsdWVzLmxlbmd0aDtcbiAgcmV0dXJuIGZ1bmN0aW9uKHQpIHtcbiAgICB2YXIgaSA9IE1hdGguZmxvb3IoKCh0ICU9IDEpIDwgMCA/ICsrdCA6IHQpICogbiksXG4gICAgICAgIHYwID0gdmFsdWVzWyhpICsgbiAtIDEpICUgbl0sXG4gICAgICAgIHYxID0gdmFsdWVzW2kgJSBuXSxcbiAgICAgICAgdjIgPSB2YWx1ZXNbKGkgKyAxKSAlIG5dLFxuICAgICAgICB2MyA9IHZhbHVlc1soaSArIDIpICUgbl07XG4gICAgcmV0dXJuIGJhc2lzKCh0IC0gaSAvIG4pICogbiwgdjAsIHYxLCB2MiwgdjMpO1xuICB9O1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IHggPT4gKCkgPT4geDtcbiIsICJpbXBvcnQgY29uc3RhbnQgZnJvbSBcIi4vY29uc3RhbnQuanNcIjtcblxuZnVuY3Rpb24gbGluZWFyKGEsIGQpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKHQpIHtcbiAgICByZXR1cm4gYSArIHQgKiBkO1xuICB9O1xufVxuXG5mdW5jdGlvbiBleHBvbmVudGlhbChhLCBiLCB5KSB7XG4gIHJldHVybiBhID0gTWF0aC5wb3coYSwgeSksIGIgPSBNYXRoLnBvdyhiLCB5KSAtIGEsIHkgPSAxIC8geSwgZnVuY3Rpb24odCkge1xuICAgIHJldHVybiBNYXRoLnBvdyhhICsgdCAqIGIsIHkpO1xuICB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaHVlKGEsIGIpIHtcbiAgdmFyIGQgPSBiIC0gYTtcbiAgcmV0dXJuIGQgPyBsaW5lYXIoYSwgZCA+IDE4MCB8fCBkIDwgLTE4MCA/IGQgLSAzNjAgKiBNYXRoLnJvdW5kKGQgLyAzNjApIDogZCkgOiBjb25zdGFudChpc05hTihhKSA/IGIgOiBhKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdhbW1hKHkpIHtcbiAgcmV0dXJuICh5ID0gK3kpID09PSAxID8gbm9nYW1tYSA6IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICByZXR1cm4gYiAtIGEgPyBleHBvbmVudGlhbChhLCBiLCB5KSA6IGNvbnN0YW50KGlzTmFOKGEpID8gYiA6IGEpO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBub2dhbW1hKGEsIGIpIHtcbiAgdmFyIGQgPSBiIC0gYTtcbiAgcmV0dXJuIGQgPyBsaW5lYXIoYSwgZCkgOiBjb25zdGFudChpc05hTihhKSA/IGIgOiBhKTtcbn1cbiIsICJpbXBvcnQge3JnYiBhcyBjb2xvclJnYn0gZnJvbSBcImQzLWNvbG9yXCI7XG5pbXBvcnQgYmFzaXMgZnJvbSBcIi4vYmFzaXMuanNcIjtcbmltcG9ydCBiYXNpc0Nsb3NlZCBmcm9tIFwiLi9iYXNpc0Nsb3NlZC5qc1wiO1xuaW1wb3J0IG5vZ2FtbWEsIHtnYW1tYX0gZnJvbSBcIi4vY29sb3IuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgKGZ1bmN0aW9uIHJnYkdhbW1hKHkpIHtcbiAgdmFyIGNvbG9yID0gZ2FtbWEoeSk7XG5cbiAgZnVuY3Rpb24gcmdiKHN0YXJ0LCBlbmQpIHtcbiAgICB2YXIgciA9IGNvbG9yKChzdGFydCA9IGNvbG9yUmdiKHN0YXJ0KSkuciwgKGVuZCA9IGNvbG9yUmdiKGVuZCkpLnIpLFxuICAgICAgICBnID0gY29sb3Ioc3RhcnQuZywgZW5kLmcpLFxuICAgICAgICBiID0gY29sb3Ioc3RhcnQuYiwgZW5kLmIpLFxuICAgICAgICBvcGFjaXR5ID0gbm9nYW1tYShzdGFydC5vcGFjaXR5LCBlbmQub3BhY2l0eSk7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKHQpIHtcbiAgICAgIHN0YXJ0LnIgPSByKHQpO1xuICAgICAgc3RhcnQuZyA9IGcodCk7XG4gICAgICBzdGFydC5iID0gYih0KTtcbiAgICAgIHN0YXJ0Lm9wYWNpdHkgPSBvcGFjaXR5KHQpO1xuICAgICAgcmV0dXJuIHN0YXJ0ICsgXCJcIjtcbiAgICB9O1xuICB9XG5cbiAgcmdiLmdhbW1hID0gcmdiR2FtbWE7XG5cbiAgcmV0dXJuIHJnYjtcbn0pKDEpO1xuXG5mdW5jdGlvbiByZ2JTcGxpbmUoc3BsaW5lKSB7XG4gIHJldHVybiBmdW5jdGlvbihjb2xvcnMpIHtcbiAgICB2YXIgbiA9IGNvbG9ycy5sZW5ndGgsXG4gICAgICAgIHIgPSBuZXcgQXJyYXkobiksXG4gICAgICAgIGcgPSBuZXcgQXJyYXkobiksXG4gICAgICAgIGIgPSBuZXcgQXJyYXkobiksXG4gICAgICAgIGksIGNvbG9yO1xuICAgIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIGNvbG9yID0gY29sb3JSZ2IoY29sb3JzW2ldKTtcbiAgICAgIHJbaV0gPSBjb2xvci5yIHx8IDA7XG4gICAgICBnW2ldID0gY29sb3IuZyB8fCAwO1xuICAgICAgYltpXSA9IGNvbG9yLmIgfHwgMDtcbiAgICB9XG4gICAgciA9IHNwbGluZShyKTtcbiAgICBnID0gc3BsaW5lKGcpO1xuICAgIGIgPSBzcGxpbmUoYik7XG4gICAgY29sb3Iub3BhY2l0eSA9IDE7XG4gICAgcmV0dXJuIGZ1bmN0aW9uKHQpIHtcbiAgICAgIGNvbG9yLnIgPSByKHQpO1xuICAgICAgY29sb3IuZyA9IGcodCk7XG4gICAgICBjb2xvci5iID0gYih0KTtcbiAgICAgIHJldHVybiBjb2xvciArIFwiXCI7XG4gICAgfTtcbiAgfTtcbn1cblxuZXhwb3J0IHZhciByZ2JCYXNpcyA9IHJnYlNwbGluZShiYXNpcyk7XG5leHBvcnQgdmFyIHJnYkJhc2lzQ2xvc2VkID0gcmdiU3BsaW5lKGJhc2lzQ2xvc2VkKTtcbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbihhLCBiKSB7XG4gIHJldHVybiBhID0gK2EsIGIgPSArYiwgZnVuY3Rpb24odCkge1xuICAgIHJldHVybiBhICogKDEgLSB0KSArIGIgKiB0O1xuICB9O1xufVxuIiwgImltcG9ydCBudW1iZXIgZnJvbSBcIi4vbnVtYmVyLmpzXCI7XG5cbnZhciByZUEgPSAvWy0rXT8oPzpcXGQrXFwuP1xcZCp8XFwuP1xcZCspKD86W2VFXVstK10/XFxkKyk/L2csXG4gICAgcmVCID0gbmV3IFJlZ0V4cChyZUEuc291cmNlLCBcImdcIik7XG5cbmZ1bmN0aW9uIHplcm8oYikge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGI7XG4gIH07XG59XG5cbmZ1bmN0aW9uIG9uZShiKSB7XG4gIHJldHVybiBmdW5jdGlvbih0KSB7XG4gICAgcmV0dXJuIGIodCkgKyBcIlwiO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihhLCBiKSB7XG4gIHZhciBiaSA9IHJlQS5sYXN0SW5kZXggPSByZUIubGFzdEluZGV4ID0gMCwgLy8gc2NhbiBpbmRleCBmb3IgbmV4dCBudW1iZXIgaW4gYlxuICAgICAgYW0sIC8vIGN1cnJlbnQgbWF0Y2ggaW4gYVxuICAgICAgYm0sIC8vIGN1cnJlbnQgbWF0Y2ggaW4gYlxuICAgICAgYnMsIC8vIHN0cmluZyBwcmVjZWRpbmcgY3VycmVudCBudW1iZXIgaW4gYiwgaWYgYW55XG4gICAgICBpID0gLTEsIC8vIGluZGV4IGluIHNcbiAgICAgIHMgPSBbXSwgLy8gc3RyaW5nIGNvbnN0YW50cyBhbmQgcGxhY2Vob2xkZXJzXG4gICAgICBxID0gW107IC8vIG51bWJlciBpbnRlcnBvbGF0b3JzXG5cbiAgLy8gQ29lcmNlIGlucHV0cyB0byBzdHJpbmdzLlxuICBhID0gYSArIFwiXCIsIGIgPSBiICsgXCJcIjtcblxuICAvLyBJbnRlcnBvbGF0ZSBwYWlycyBvZiBudW1iZXJzIGluIGEgJiBiLlxuICB3aGlsZSAoKGFtID0gcmVBLmV4ZWMoYSkpXG4gICAgICAmJiAoYm0gPSByZUIuZXhlYyhiKSkpIHtcbiAgICBpZiAoKGJzID0gYm0uaW5kZXgpID4gYmkpIHsgLy8gYSBzdHJpbmcgcHJlY2VkZXMgdGhlIG5leHQgbnVtYmVyIGluIGJcbiAgICAgIGJzID0gYi5zbGljZShiaSwgYnMpO1xuICAgICAgaWYgKHNbaV0pIHNbaV0gKz0gYnM7IC8vIGNvYWxlc2NlIHdpdGggcHJldmlvdXMgc3RyaW5nXG4gICAgICBlbHNlIHNbKytpXSA9IGJzO1xuICAgIH1cbiAgICBpZiAoKGFtID0gYW1bMF0pID09PSAoYm0gPSBibVswXSkpIHsgLy8gbnVtYmVycyBpbiBhICYgYiBtYXRjaFxuICAgICAgaWYgKHNbaV0pIHNbaV0gKz0gYm07IC8vIGNvYWxlc2NlIHdpdGggcHJldmlvdXMgc3RyaW5nXG4gICAgICBlbHNlIHNbKytpXSA9IGJtO1xuICAgIH0gZWxzZSB7IC8vIGludGVycG9sYXRlIG5vbi1tYXRjaGluZyBudW1iZXJzXG4gICAgICBzWysraV0gPSBudWxsO1xuICAgICAgcS5wdXNoKHtpOiBpLCB4OiBudW1iZXIoYW0sIGJtKX0pO1xuICAgIH1cbiAgICBiaSA9IHJlQi5sYXN0SW5kZXg7XG4gIH1cblxuICAvLyBBZGQgcmVtYWlucyBvZiBiLlxuICBpZiAoYmkgPCBiLmxlbmd0aCkge1xuICAgIGJzID0gYi5zbGljZShiaSk7XG4gICAgaWYgKHNbaV0pIHNbaV0gKz0gYnM7IC8vIGNvYWxlc2NlIHdpdGggcHJldmlvdXMgc3RyaW5nXG4gICAgZWxzZSBzWysraV0gPSBicztcbiAgfVxuXG4gIC8vIFNwZWNpYWwgb3B0aW1pemF0aW9uIGZvciBvbmx5IGEgc2luZ2xlIG1hdGNoLlxuICAvLyBPdGhlcndpc2UsIGludGVycG9sYXRlIGVhY2ggb2YgdGhlIG51bWJlcnMgYW5kIHJlam9pbiB0aGUgc3RyaW5nLlxuICByZXR1cm4gcy5sZW5ndGggPCAyID8gKHFbMF1cbiAgICAgID8gb25lKHFbMF0ueClcbiAgICAgIDogemVybyhiKSlcbiAgICAgIDogKGIgPSBxLmxlbmd0aCwgZnVuY3Rpb24odCkge1xuICAgICAgICAgIGZvciAodmFyIGkgPSAwLCBvOyBpIDwgYjsgKytpKSBzWyhvID0gcVtpXSkuaV0gPSBvLngodCk7XG4gICAgICAgICAgcmV0dXJuIHMuam9pbihcIlwiKTtcbiAgICAgICAgfSk7XG59XG4iLCAidmFyIGRlZ3JlZXMgPSAxODAgLyBNYXRoLlBJO1xuXG5leHBvcnQgdmFyIGlkZW50aXR5ID0ge1xuICB0cmFuc2xhdGVYOiAwLFxuICB0cmFuc2xhdGVZOiAwLFxuICByb3RhdGU6IDAsXG4gIHNrZXdYOiAwLFxuICBzY2FsZVg6IDEsXG4gIHNjYWxlWTogMVxufTtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oYSwgYiwgYywgZCwgZSwgZikge1xuICB2YXIgc2NhbGVYLCBzY2FsZVksIHNrZXdYO1xuICBpZiAoc2NhbGVYID0gTWF0aC5zcXJ0KGEgKiBhICsgYiAqIGIpKSBhIC89IHNjYWxlWCwgYiAvPSBzY2FsZVg7XG4gIGlmIChza2V3WCA9IGEgKiBjICsgYiAqIGQpIGMgLT0gYSAqIHNrZXdYLCBkIC09IGIgKiBza2V3WDtcbiAgaWYgKHNjYWxlWSA9IE1hdGguc3FydChjICogYyArIGQgKiBkKSkgYyAvPSBzY2FsZVksIGQgLz0gc2NhbGVZLCBza2V3WCAvPSBzY2FsZVk7XG4gIGlmIChhICogZCA8IGIgKiBjKSBhID0gLWEsIGIgPSAtYiwgc2tld1ggPSAtc2tld1gsIHNjYWxlWCA9IC1zY2FsZVg7XG4gIHJldHVybiB7XG4gICAgdHJhbnNsYXRlWDogZSxcbiAgICB0cmFuc2xhdGVZOiBmLFxuICAgIHJvdGF0ZTogTWF0aC5hdGFuMihiLCBhKSAqIGRlZ3JlZXMsXG4gICAgc2tld1g6IE1hdGguYXRhbihza2V3WCkgKiBkZWdyZWVzLFxuICAgIHNjYWxlWDogc2NhbGVYLFxuICAgIHNjYWxlWTogc2NhbGVZXG4gIH07XG59XG4iLCAiaW1wb3J0IGRlY29tcG9zZSwge2lkZW50aXR5fSBmcm9tIFwiLi9kZWNvbXBvc2UuanNcIjtcblxudmFyIHN2Z05vZGU7XG5cbi8qIGVzbGludC1kaXNhYmxlIG5vLXVuZGVmICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDc3ModmFsdWUpIHtcbiAgY29uc3QgbSA9IG5ldyAodHlwZW9mIERPTU1hdHJpeCA9PT0gXCJmdW5jdGlvblwiID8gRE9NTWF0cml4IDogV2ViS2l0Q1NTTWF0cml4KSh2YWx1ZSArIFwiXCIpO1xuICByZXR1cm4gbS5pc0lkZW50aXR5ID8gaWRlbnRpdHkgOiBkZWNvbXBvc2UobS5hLCBtLmIsIG0uYywgbS5kLCBtLmUsIG0uZik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVN2Zyh2YWx1ZSkge1xuICBpZiAodmFsdWUgPT0gbnVsbCkgcmV0dXJuIGlkZW50aXR5O1xuICBpZiAoIXN2Z05vZGUpIHN2Z05vZGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50TlMoXCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiLCBcImdcIik7XG4gIHN2Z05vZGUuc2V0QXR0cmlidXRlKFwidHJhbnNmb3JtXCIsIHZhbHVlKTtcbiAgaWYgKCEodmFsdWUgPSBzdmdOb2RlLnRyYW5zZm9ybS5iYXNlVmFsLmNvbnNvbGlkYXRlKCkpKSByZXR1cm4gaWRlbnRpdHk7XG4gIHZhbHVlID0gdmFsdWUubWF0cml4O1xuICByZXR1cm4gZGVjb21wb3NlKHZhbHVlLmEsIHZhbHVlLmIsIHZhbHVlLmMsIHZhbHVlLmQsIHZhbHVlLmUsIHZhbHVlLmYpO1xufVxuIiwgImltcG9ydCBudW1iZXIgZnJvbSBcIi4uL251bWJlci5qc1wiO1xuaW1wb3J0IHtwYXJzZUNzcywgcGFyc2VTdmd9IGZyb20gXCIuL3BhcnNlLmpzXCI7XG5cbmZ1bmN0aW9uIGludGVycG9sYXRlVHJhbnNmb3JtKHBhcnNlLCBweENvbW1hLCBweFBhcmVuLCBkZWdQYXJlbikge1xuXG4gIGZ1bmN0aW9uIHBvcChzKSB7XG4gICAgcmV0dXJuIHMubGVuZ3RoID8gcy5wb3AoKSArIFwiIFwiIDogXCJcIjtcbiAgfVxuXG4gIGZ1bmN0aW9uIHRyYW5zbGF0ZSh4YSwgeWEsIHhiLCB5YiwgcywgcSkge1xuICAgIGlmICh4YSAhPT0geGIgfHwgeWEgIT09IHliKSB7XG4gICAgICB2YXIgaSA9IHMucHVzaChcInRyYW5zbGF0ZShcIiwgbnVsbCwgcHhDb21tYSwgbnVsbCwgcHhQYXJlbik7XG4gICAgICBxLnB1c2goe2k6IGkgLSA0LCB4OiBudW1iZXIoeGEsIHhiKX0sIHtpOiBpIC0gMiwgeDogbnVtYmVyKHlhLCB5Yil9KTtcbiAgICB9IGVsc2UgaWYgKHhiIHx8IHliKSB7XG4gICAgICBzLnB1c2goXCJ0cmFuc2xhdGUoXCIgKyB4YiArIHB4Q29tbWEgKyB5YiArIHB4UGFyZW4pO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHJvdGF0ZShhLCBiLCBzLCBxKSB7XG4gICAgaWYgKGEgIT09IGIpIHtcbiAgICAgIGlmIChhIC0gYiA+IDE4MCkgYiArPSAzNjA7IGVsc2UgaWYgKGIgLSBhID4gMTgwKSBhICs9IDM2MDsgLy8gc2hvcnRlc3QgcGF0aFxuICAgICAgcS5wdXNoKHtpOiBzLnB1c2gocG9wKHMpICsgXCJyb3RhdGUoXCIsIG51bGwsIGRlZ1BhcmVuKSAtIDIsIHg6IG51bWJlcihhLCBiKX0pO1xuICAgIH0gZWxzZSBpZiAoYikge1xuICAgICAgcy5wdXNoKHBvcChzKSArIFwicm90YXRlKFwiICsgYiArIGRlZ1BhcmVuKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBza2V3WChhLCBiLCBzLCBxKSB7XG4gICAgaWYgKGEgIT09IGIpIHtcbiAgICAgIHEucHVzaCh7aTogcy5wdXNoKHBvcChzKSArIFwic2tld1goXCIsIG51bGwsIGRlZ1BhcmVuKSAtIDIsIHg6IG51bWJlcihhLCBiKX0pO1xuICAgIH0gZWxzZSBpZiAoYikge1xuICAgICAgcy5wdXNoKHBvcChzKSArIFwic2tld1goXCIgKyBiICsgZGVnUGFyZW4pO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHNjYWxlKHhhLCB5YSwgeGIsIHliLCBzLCBxKSB7XG4gICAgaWYgKHhhICE9PSB4YiB8fCB5YSAhPT0geWIpIHtcbiAgICAgIHZhciBpID0gcy5wdXNoKHBvcChzKSArIFwic2NhbGUoXCIsIG51bGwsIFwiLFwiLCBudWxsLCBcIilcIik7XG4gICAgICBxLnB1c2goe2k6IGkgLSA0LCB4OiBudW1iZXIoeGEsIHhiKX0sIHtpOiBpIC0gMiwgeDogbnVtYmVyKHlhLCB5Yil9KTtcbiAgICB9IGVsc2UgaWYgKHhiICE9PSAxIHx8IHliICE9PSAxKSB7XG4gICAgICBzLnB1c2gocG9wKHMpICsgXCJzY2FsZShcIiArIHhiICsgXCIsXCIgKyB5YiArIFwiKVwiKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gZnVuY3Rpb24oYSwgYikge1xuICAgIHZhciBzID0gW10sIC8vIHN0cmluZyBjb25zdGFudHMgYW5kIHBsYWNlaG9sZGVyc1xuICAgICAgICBxID0gW107IC8vIG51bWJlciBpbnRlcnBvbGF0b3JzXG4gICAgYSA9IHBhcnNlKGEpLCBiID0gcGFyc2UoYik7XG4gICAgdHJhbnNsYXRlKGEudHJhbnNsYXRlWCwgYS50cmFuc2xhdGVZLCBiLnRyYW5zbGF0ZVgsIGIudHJhbnNsYXRlWSwgcywgcSk7XG4gICAgcm90YXRlKGEucm90YXRlLCBiLnJvdGF0ZSwgcywgcSk7XG4gICAgc2tld1goYS5za2V3WCwgYi5za2V3WCwgcywgcSk7XG4gICAgc2NhbGUoYS5zY2FsZVgsIGEuc2NhbGVZLCBiLnNjYWxlWCwgYi5zY2FsZVksIHMsIHEpO1xuICAgIGEgPSBiID0gbnVsbDsgLy8gZ2NcbiAgICByZXR1cm4gZnVuY3Rpb24odCkge1xuICAgICAgdmFyIGkgPSAtMSwgbiA9IHEubGVuZ3RoLCBvO1xuICAgICAgd2hpbGUgKCsraSA8IG4pIHNbKG8gPSBxW2ldKS5pXSA9IG8ueCh0KTtcbiAgICAgIHJldHVybiBzLmpvaW4oXCJcIik7XG4gICAgfTtcbiAgfTtcbn1cblxuZXhwb3J0IHZhciBpbnRlcnBvbGF0ZVRyYW5zZm9ybUNzcyA9IGludGVycG9sYXRlVHJhbnNmb3JtKHBhcnNlQ3NzLCBcInB4LCBcIiwgXCJweClcIiwgXCJkZWcpXCIpO1xuZXhwb3J0IHZhciBpbnRlcnBvbGF0ZVRyYW5zZm9ybVN2ZyA9IGludGVycG9sYXRlVHJhbnNmb3JtKHBhcnNlU3ZnLCBcIiwgXCIsIFwiKVwiLCBcIilcIik7XG4iLCAidmFyIGVwc2lsb24yID0gMWUtMTI7XG5cbmZ1bmN0aW9uIGNvc2goeCkge1xuICByZXR1cm4gKCh4ID0gTWF0aC5leHAoeCkpICsgMSAvIHgpIC8gMjtcbn1cblxuZnVuY3Rpb24gc2luaCh4KSB7XG4gIHJldHVybiAoKHggPSBNYXRoLmV4cCh4KSkgLSAxIC8geCkgLyAyO1xufVxuXG5mdW5jdGlvbiB0YW5oKHgpIHtcbiAgcmV0dXJuICgoeCA9IE1hdGguZXhwKDIgKiB4KSkgLSAxKSAvICh4ICsgMSk7XG59XG5cbmV4cG9ydCBkZWZhdWx0IChmdW5jdGlvbiB6b29tUmhvKHJobywgcmhvMiwgcmhvNCkge1xuXG4gIC8vIHAwID0gW3V4MCwgdXkwLCB3MF1cbiAgLy8gcDEgPSBbdXgxLCB1eTEsIHcxXVxuICBmdW5jdGlvbiB6b29tKHAwLCBwMSkge1xuICAgIHZhciB1eDAgPSBwMFswXSwgdXkwID0gcDBbMV0sIHcwID0gcDBbMl0sXG4gICAgICAgIHV4MSA9IHAxWzBdLCB1eTEgPSBwMVsxXSwgdzEgPSBwMVsyXSxcbiAgICAgICAgZHggPSB1eDEgLSB1eDAsXG4gICAgICAgIGR5ID0gdXkxIC0gdXkwLFxuICAgICAgICBkMiA9IGR4ICogZHggKyBkeSAqIGR5LFxuICAgICAgICBpLFxuICAgICAgICBTO1xuXG4gICAgLy8gU3BlY2lhbCBjYXNlIGZvciB1MCBcdTIyNDUgdTEuXG4gICAgaWYgKGQyIDwgZXBzaWxvbjIpIHtcbiAgICAgIFMgPSBNYXRoLmxvZyh3MSAvIHcwKSAvIHJobztcbiAgICAgIGkgPSBmdW5jdGlvbih0KSB7XG4gICAgICAgIHJldHVybiBbXG4gICAgICAgICAgdXgwICsgdCAqIGR4LFxuICAgICAgICAgIHV5MCArIHQgKiBkeSxcbiAgICAgICAgICB3MCAqIE1hdGguZXhwKHJobyAqIHQgKiBTKVxuICAgICAgICBdO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEdlbmVyYWwgY2FzZS5cbiAgICBlbHNlIHtcbiAgICAgIHZhciBkMSA9IE1hdGguc3FydChkMiksXG4gICAgICAgICAgYjAgPSAodzEgKiB3MSAtIHcwICogdzAgKyByaG80ICogZDIpIC8gKDIgKiB3MCAqIHJobzIgKiBkMSksXG4gICAgICAgICAgYjEgPSAodzEgKiB3MSAtIHcwICogdzAgLSByaG80ICogZDIpIC8gKDIgKiB3MSAqIHJobzIgKiBkMSksXG4gICAgICAgICAgcjAgPSBNYXRoLmxvZyhNYXRoLnNxcnQoYjAgKiBiMCArIDEpIC0gYjApLFxuICAgICAgICAgIHIxID0gTWF0aC5sb2coTWF0aC5zcXJ0KGIxICogYjEgKyAxKSAtIGIxKTtcbiAgICAgIFMgPSAocjEgLSByMCkgLyByaG87XG4gICAgICBpID0gZnVuY3Rpb24odCkge1xuICAgICAgICB2YXIgcyA9IHQgKiBTLFxuICAgICAgICAgICAgY29zaHIwID0gY29zaChyMCksXG4gICAgICAgICAgICB1ID0gdzAgLyAocmhvMiAqIGQxKSAqIChjb3NocjAgKiB0YW5oKHJobyAqIHMgKyByMCkgLSBzaW5oKHIwKSk7XG4gICAgICAgIHJldHVybiBbXG4gICAgICAgICAgdXgwICsgdSAqIGR4LFxuICAgICAgICAgIHV5MCArIHUgKiBkeSxcbiAgICAgICAgICB3MCAqIGNvc2hyMCAvIGNvc2gocmhvICogcyArIHIwKVxuICAgICAgICBdO1xuICAgICAgfVxuICAgIH1cblxuICAgIGkuZHVyYXRpb24gPSBTICogMTAwMCAqIHJobyAvIE1hdGguU1FSVDI7XG5cbiAgICByZXR1cm4gaTtcbiAgfVxuXG4gIHpvb20ucmhvID0gZnVuY3Rpb24oXykge1xuICAgIHZhciBfMSA9IE1hdGgubWF4KDFlLTMsICtfKSwgXzIgPSBfMSAqIF8xLCBfNCA9IF8yICogXzI7XG4gICAgcmV0dXJuIHpvb21SaG8oXzEsIF8yLCBfNCk7XG4gIH07XG5cbiAgcmV0dXJuIHpvb207XG59KShNYXRoLlNRUlQyLCAyLCA0KTtcbiIsICJ2YXIgZnJhbWUgPSAwLCAvLyBpcyBhbiBhbmltYXRpb24gZnJhbWUgcGVuZGluZz9cbiAgICB0aW1lb3V0ID0gMCwgLy8gaXMgYSB0aW1lb3V0IHBlbmRpbmc/XG4gICAgaW50ZXJ2YWwgPSAwLCAvLyBhcmUgYW55IHRpbWVycyBhY3RpdmU/XG4gICAgcG9rZURlbGF5ID0gMTAwMCwgLy8gaG93IGZyZXF1ZW50bHkgd2UgY2hlY2sgZm9yIGNsb2NrIHNrZXdcbiAgICB0YXNrSGVhZCxcbiAgICB0YXNrVGFpbCxcbiAgICBjbG9ja0xhc3QgPSAwLFxuICAgIGNsb2NrTm93ID0gMCxcbiAgICBjbG9ja1NrZXcgPSAwLFxuICAgIGNsb2NrID0gdHlwZW9mIHBlcmZvcm1hbmNlID09PSBcIm9iamVjdFwiICYmIHBlcmZvcm1hbmNlLm5vdyA/IHBlcmZvcm1hbmNlIDogRGF0ZSxcbiAgICBzZXRGcmFtZSA9IHR5cGVvZiB3aW5kb3cgPT09IFwib2JqZWN0XCIgJiYgd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSA/IHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUuYmluZCh3aW5kb3cpIDogZnVuY3Rpb24oZikgeyBzZXRUaW1lb3V0KGYsIDE3KTsgfTtcblxuZXhwb3J0IGZ1bmN0aW9uIG5vdygpIHtcbiAgcmV0dXJuIGNsb2NrTm93IHx8IChzZXRGcmFtZShjbGVhck5vdyksIGNsb2NrTm93ID0gY2xvY2subm93KCkgKyBjbG9ja1NrZXcpO1xufVxuXG5mdW5jdGlvbiBjbGVhck5vdygpIHtcbiAgY2xvY2tOb3cgPSAwO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gVGltZXIoKSB7XG4gIHRoaXMuX2NhbGwgPVxuICB0aGlzLl90aW1lID1cbiAgdGhpcy5fbmV4dCA9IG51bGw7XG59XG5cblRpbWVyLnByb3RvdHlwZSA9IHRpbWVyLnByb3RvdHlwZSA9IHtcbiAgY29uc3RydWN0b3I6IFRpbWVyLFxuICByZXN0YXJ0OiBmdW5jdGlvbihjYWxsYmFjaywgZGVsYXksIHRpbWUpIHtcbiAgICBpZiAodHlwZW9mIGNhbGxiYWNrICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJjYWxsYmFjayBpcyBub3QgYSBmdW5jdGlvblwiKTtcbiAgICB0aW1lID0gKHRpbWUgPT0gbnVsbCA/IG5vdygpIDogK3RpbWUpICsgKGRlbGF5ID09IG51bGwgPyAwIDogK2RlbGF5KTtcbiAgICBpZiAoIXRoaXMuX25leHQgJiYgdGFza1RhaWwgIT09IHRoaXMpIHtcbiAgICAgIGlmICh0YXNrVGFpbCkgdGFza1RhaWwuX25leHQgPSB0aGlzO1xuICAgICAgZWxzZSB0YXNrSGVhZCA9IHRoaXM7XG4gICAgICB0YXNrVGFpbCA9IHRoaXM7XG4gICAgfVxuICAgIHRoaXMuX2NhbGwgPSBjYWxsYmFjaztcbiAgICB0aGlzLl90aW1lID0gdGltZTtcbiAgICBzbGVlcCgpO1xuICB9LFxuICBzdG9wOiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5fY2FsbCkge1xuICAgICAgdGhpcy5fY2FsbCA9IG51bGw7XG4gICAgICB0aGlzLl90aW1lID0gSW5maW5pdHk7XG4gICAgICBzbGVlcCgpO1xuICAgIH1cbiAgfVxufTtcblxuZXhwb3J0IGZ1bmN0aW9uIHRpbWVyKGNhbGxiYWNrLCBkZWxheSwgdGltZSkge1xuICB2YXIgdCA9IG5ldyBUaW1lcjtcbiAgdC5yZXN0YXJ0KGNhbGxiYWNrLCBkZWxheSwgdGltZSk7XG4gIHJldHVybiB0O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gdGltZXJGbHVzaCgpIHtcbiAgbm93KCk7IC8vIEdldCB0aGUgY3VycmVudCB0aW1lLCBpZiBub3QgYWxyZWFkeSBzZXQuXG4gICsrZnJhbWU7IC8vIFByZXRlbmQgd2VcdTIwMTl2ZSBzZXQgYW4gYWxhcm0sIGlmIHdlIGhhdmVuXHUyMDE5dCBhbHJlYWR5LlxuICB2YXIgdCA9IHRhc2tIZWFkLCBlO1xuICB3aGlsZSAodCkge1xuICAgIGlmICgoZSA9IGNsb2NrTm93IC0gdC5fdGltZSkgPj0gMCkgdC5fY2FsbC5jYWxsKHVuZGVmaW5lZCwgZSk7XG4gICAgdCA9IHQuX25leHQ7XG4gIH1cbiAgLS1mcmFtZTtcbn1cblxuZnVuY3Rpb24gd2FrZSgpIHtcbiAgY2xvY2tOb3cgPSAoY2xvY2tMYXN0ID0gY2xvY2subm93KCkpICsgY2xvY2tTa2V3O1xuICBmcmFtZSA9IHRpbWVvdXQgPSAwO1xuICB0cnkge1xuICAgIHRpbWVyRmx1c2goKTtcbiAgfSBmaW5hbGx5IHtcbiAgICBmcmFtZSA9IDA7XG4gICAgbmFwKCk7XG4gICAgY2xvY2tOb3cgPSAwO1xuICB9XG59XG5cbmZ1bmN0aW9uIHBva2UoKSB7XG4gIHZhciBub3cgPSBjbG9jay5ub3coKSwgZGVsYXkgPSBub3cgLSBjbG9ja0xhc3Q7XG4gIGlmIChkZWxheSA+IHBva2VEZWxheSkgY2xvY2tTa2V3IC09IGRlbGF5LCBjbG9ja0xhc3QgPSBub3c7XG59XG5cbmZ1bmN0aW9uIG5hcCgpIHtcbiAgdmFyIHQwLCB0MSA9IHRhc2tIZWFkLCB0MiwgdGltZSA9IEluZmluaXR5O1xuICB3aGlsZSAodDEpIHtcbiAgICBpZiAodDEuX2NhbGwpIHtcbiAgICAgIGlmICh0aW1lID4gdDEuX3RpbWUpIHRpbWUgPSB0MS5fdGltZTtcbiAgICAgIHQwID0gdDEsIHQxID0gdDEuX25leHQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIHQyID0gdDEuX25leHQsIHQxLl9uZXh0ID0gbnVsbDtcbiAgICAgIHQxID0gdDAgPyB0MC5fbmV4dCA9IHQyIDogdGFza0hlYWQgPSB0MjtcbiAgICB9XG4gIH1cbiAgdGFza1RhaWwgPSB0MDtcbiAgc2xlZXAodGltZSk7XG59XG5cbmZ1bmN0aW9uIHNsZWVwKHRpbWUpIHtcbiAgaWYgKGZyYW1lKSByZXR1cm47IC8vIFNvb25lc3QgYWxhcm0gYWxyZWFkeSBzZXQsIG9yIHdpbGwgYmUuXG4gIGlmICh0aW1lb3V0KSB0aW1lb3V0ID0gY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuICB2YXIgZGVsYXkgPSB0aW1lIC0gY2xvY2tOb3c7IC8vIFN0cmljdGx5IGxlc3MgdGhhbiBpZiB3ZSByZWNvbXB1dGVkIGNsb2NrTm93LlxuICBpZiAoZGVsYXkgPiAyNCkge1xuICAgIGlmICh0aW1lIDwgSW5maW5pdHkpIHRpbWVvdXQgPSBzZXRUaW1lb3V0KHdha2UsIHRpbWUgLSBjbG9jay5ub3coKSAtIGNsb2NrU2tldyk7XG4gICAgaWYgKGludGVydmFsKSBpbnRlcnZhbCA9IGNsZWFySW50ZXJ2YWwoaW50ZXJ2YWwpO1xuICB9IGVsc2Uge1xuICAgIGlmICghaW50ZXJ2YWwpIGNsb2NrTGFzdCA9IGNsb2NrLm5vdygpLCBpbnRlcnZhbCA9IHNldEludGVydmFsKHBva2UsIHBva2VEZWxheSk7XG4gICAgZnJhbWUgPSAxLCBzZXRGcmFtZSh3YWtlKTtcbiAgfVxufVxuIiwgImltcG9ydCB7VGltZXJ9IGZyb20gXCIuL3RpbWVyLmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGNhbGxiYWNrLCBkZWxheSwgdGltZSkge1xuICB2YXIgdCA9IG5ldyBUaW1lcjtcbiAgZGVsYXkgPSBkZWxheSA9PSBudWxsID8gMCA6ICtkZWxheTtcbiAgdC5yZXN0YXJ0KGVsYXBzZWQgPT4ge1xuICAgIHQuc3RvcCgpO1xuICAgIGNhbGxiYWNrKGVsYXBzZWQgKyBkZWxheSk7XG4gIH0sIGRlbGF5LCB0aW1lKTtcbiAgcmV0dXJuIHQ7XG59XG4iLCAiaW1wb3J0IHtkaXNwYXRjaH0gZnJvbSBcImQzLWRpc3BhdGNoXCI7XG5pbXBvcnQge3RpbWVyLCB0aW1lb3V0fSBmcm9tIFwiZDMtdGltZXJcIjtcblxudmFyIGVtcHR5T24gPSBkaXNwYXRjaChcInN0YXJ0XCIsIFwiZW5kXCIsIFwiY2FuY2VsXCIsIFwiaW50ZXJydXB0XCIpO1xudmFyIGVtcHR5VHdlZW4gPSBbXTtcblxuZXhwb3J0IHZhciBDUkVBVEVEID0gMDtcbmV4cG9ydCB2YXIgU0NIRURVTEVEID0gMTtcbmV4cG9ydCB2YXIgU1RBUlRJTkcgPSAyO1xuZXhwb3J0IHZhciBTVEFSVEVEID0gMztcbmV4cG9ydCB2YXIgUlVOTklORyA9IDQ7XG5leHBvcnQgdmFyIEVORElORyA9IDU7XG5leHBvcnQgdmFyIEVOREVEID0gNjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obm9kZSwgbmFtZSwgaWQsIGluZGV4LCBncm91cCwgdGltaW5nKSB7XG4gIHZhciBzY2hlZHVsZXMgPSBub2RlLl9fdHJhbnNpdGlvbjtcbiAgaWYgKCFzY2hlZHVsZXMpIG5vZGUuX190cmFuc2l0aW9uID0ge307XG4gIGVsc2UgaWYgKGlkIGluIHNjaGVkdWxlcykgcmV0dXJuO1xuICBjcmVhdGUobm9kZSwgaWQsIHtcbiAgICBuYW1lOiBuYW1lLFxuICAgIGluZGV4OiBpbmRleCwgLy8gRm9yIGNvbnRleHQgZHVyaW5nIGNhbGxiYWNrLlxuICAgIGdyb3VwOiBncm91cCwgLy8gRm9yIGNvbnRleHQgZHVyaW5nIGNhbGxiYWNrLlxuICAgIG9uOiBlbXB0eU9uLFxuICAgIHR3ZWVuOiBlbXB0eVR3ZWVuLFxuICAgIHRpbWU6IHRpbWluZy50aW1lLFxuICAgIGRlbGF5OiB0aW1pbmcuZGVsYXksXG4gICAgZHVyYXRpb246IHRpbWluZy5kdXJhdGlvbixcbiAgICBlYXNlOiB0aW1pbmcuZWFzZSxcbiAgICB0aW1lcjogbnVsbCxcbiAgICBzdGF0ZTogQ1JFQVRFRFxuICB9KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGluaXQobm9kZSwgaWQpIHtcbiAgdmFyIHNjaGVkdWxlID0gZ2V0KG5vZGUsIGlkKTtcbiAgaWYgKHNjaGVkdWxlLnN0YXRlID4gQ1JFQVRFRCkgdGhyb3cgbmV3IEVycm9yKFwidG9vIGxhdGU7IGFscmVhZHkgc2NoZWR1bGVkXCIpO1xuICByZXR1cm4gc2NoZWR1bGU7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzZXQobm9kZSwgaWQpIHtcbiAgdmFyIHNjaGVkdWxlID0gZ2V0KG5vZGUsIGlkKTtcbiAgaWYgKHNjaGVkdWxlLnN0YXRlID4gU1RBUlRFRCkgdGhyb3cgbmV3IEVycm9yKFwidG9vIGxhdGU7IGFscmVhZHkgcnVubmluZ1wiKTtcbiAgcmV0dXJuIHNjaGVkdWxlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0KG5vZGUsIGlkKSB7XG4gIHZhciBzY2hlZHVsZSA9IG5vZGUuX190cmFuc2l0aW9uO1xuICBpZiAoIXNjaGVkdWxlIHx8ICEoc2NoZWR1bGUgPSBzY2hlZHVsZVtpZF0pKSB0aHJvdyBuZXcgRXJyb3IoXCJ0cmFuc2l0aW9uIG5vdCBmb3VuZFwiKTtcbiAgcmV0dXJuIHNjaGVkdWxlO1xufVxuXG5mdW5jdGlvbiBjcmVhdGUobm9kZSwgaWQsIHNlbGYpIHtcbiAgdmFyIHNjaGVkdWxlcyA9IG5vZGUuX190cmFuc2l0aW9uLFxuICAgICAgdHdlZW47XG5cbiAgLy8gSW5pdGlhbGl6ZSB0aGUgc2VsZiB0aW1lciB3aGVuIHRoZSB0cmFuc2l0aW9uIGlzIGNyZWF0ZWQuXG4gIC8vIE5vdGUgdGhlIGFjdHVhbCBkZWxheSBpcyBub3Qga25vd24gdW50aWwgdGhlIGZpcnN0IGNhbGxiYWNrIVxuICBzY2hlZHVsZXNbaWRdID0gc2VsZjtcbiAgc2VsZi50aW1lciA9IHRpbWVyKHNjaGVkdWxlLCAwLCBzZWxmLnRpbWUpO1xuXG4gIGZ1bmN0aW9uIHNjaGVkdWxlKGVsYXBzZWQpIHtcbiAgICBzZWxmLnN0YXRlID0gU0NIRURVTEVEO1xuICAgIHNlbGYudGltZXIucmVzdGFydChzdGFydCwgc2VsZi5kZWxheSwgc2VsZi50aW1lKTtcblxuICAgIC8vIElmIHRoZSBlbGFwc2VkIGRlbGF5IGlzIGxlc3MgdGhhbiBvdXIgZmlyc3Qgc2xlZXAsIHN0YXJ0IGltbWVkaWF0ZWx5LlxuICAgIGlmIChzZWxmLmRlbGF5IDw9IGVsYXBzZWQpIHN0YXJ0KGVsYXBzZWQgLSBzZWxmLmRlbGF5KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHN0YXJ0KGVsYXBzZWQpIHtcbiAgICB2YXIgaSwgaiwgbiwgbztcblxuICAgIC8vIElmIHRoZSBzdGF0ZSBpcyBub3QgU0NIRURVTEVELCB0aGVuIHdlIHByZXZpb3VzbHkgZXJyb3JlZCBvbiBzdGFydC5cbiAgICBpZiAoc2VsZi5zdGF0ZSAhPT0gU0NIRURVTEVEKSByZXR1cm4gc3RvcCgpO1xuXG4gICAgZm9yIChpIGluIHNjaGVkdWxlcykge1xuICAgICAgbyA9IHNjaGVkdWxlc1tpXTtcbiAgICAgIGlmIChvLm5hbWUgIT09IHNlbGYubmFtZSkgY29udGludWU7XG5cbiAgICAgIC8vIFdoaWxlIHRoaXMgZWxlbWVudCBhbHJlYWR5IGhhcyBhIHN0YXJ0aW5nIHRyYW5zaXRpb24gZHVyaW5nIHRoaXMgZnJhbWUsXG4gICAgICAvLyBkZWZlciBzdGFydGluZyBhbiBpbnRlcnJ1cHRpbmcgdHJhbnNpdGlvbiB1bnRpbCB0aGF0IHRyYW5zaXRpb24gaGFzIGFcbiAgICAgIC8vIGNoYW5jZSB0byB0aWNrIChhbmQgcG9zc2libHkgZW5kKTsgc2VlIGQzL2QzLXRyYW5zaXRpb24jNTQhXG4gICAgICBpZiAoby5zdGF0ZSA9PT0gU1RBUlRFRCkgcmV0dXJuIHRpbWVvdXQoc3RhcnQpO1xuXG4gICAgICAvLyBJbnRlcnJ1cHQgdGhlIGFjdGl2ZSB0cmFuc2l0aW9uLCBpZiBhbnkuXG4gICAgICBpZiAoby5zdGF0ZSA9PT0gUlVOTklORykge1xuICAgICAgICBvLnN0YXRlID0gRU5ERUQ7XG4gICAgICAgIG8udGltZXIuc3RvcCgpO1xuICAgICAgICBvLm9uLmNhbGwoXCJpbnRlcnJ1cHRcIiwgbm9kZSwgbm9kZS5fX2RhdGFfXywgby5pbmRleCwgby5ncm91cCk7XG4gICAgICAgIGRlbGV0ZSBzY2hlZHVsZXNbaV07XG4gICAgICB9XG5cbiAgICAgIC8vIENhbmNlbCBhbnkgcHJlLWVtcHRlZCB0cmFuc2l0aW9ucy5cbiAgICAgIGVsc2UgaWYgKCtpIDwgaWQpIHtcbiAgICAgICAgby5zdGF0ZSA9IEVOREVEO1xuICAgICAgICBvLnRpbWVyLnN0b3AoKTtcbiAgICAgICAgby5vbi5jYWxsKFwiY2FuY2VsXCIsIG5vZGUsIG5vZGUuX19kYXRhX18sIG8uaW5kZXgsIG8uZ3JvdXApO1xuICAgICAgICBkZWxldGUgc2NoZWR1bGVzW2ldO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIERlZmVyIHRoZSBmaXJzdCB0aWNrIHRvIGVuZCBvZiB0aGUgY3VycmVudCBmcmFtZTsgc2VlIGQzL2QzIzE1NzYuXG4gICAgLy8gTm90ZSB0aGUgdHJhbnNpdGlvbiBtYXkgYmUgY2FuY2VsZWQgYWZ0ZXIgc3RhcnQgYW5kIGJlZm9yZSB0aGUgZmlyc3QgdGljayFcbiAgICAvLyBOb3RlIHRoaXMgbXVzdCBiZSBzY2hlZHVsZWQgYmVmb3JlIHRoZSBzdGFydCBldmVudDsgc2VlIGQzL2QzLXRyYW5zaXRpb24jMTYhXG4gICAgLy8gQXNzdW1pbmcgdGhpcyBpcyBzdWNjZXNzZnVsLCBzdWJzZXF1ZW50IGNhbGxiYWNrcyBnbyBzdHJhaWdodCB0byB0aWNrLlxuICAgIHRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICBpZiAoc2VsZi5zdGF0ZSA9PT0gU1RBUlRFRCkge1xuICAgICAgICBzZWxmLnN0YXRlID0gUlVOTklORztcbiAgICAgICAgc2VsZi50aW1lci5yZXN0YXJ0KHRpY2ssIHNlbGYuZGVsYXksIHNlbGYudGltZSk7XG4gICAgICAgIHRpY2soZWxhcHNlZCk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBEaXNwYXRjaCB0aGUgc3RhcnQgZXZlbnQuXG4gICAgLy8gTm90ZSB0aGlzIG11c3QgYmUgZG9uZSBiZWZvcmUgdGhlIHR3ZWVuIGFyZSBpbml0aWFsaXplZC5cbiAgICBzZWxmLnN0YXRlID0gU1RBUlRJTkc7XG4gICAgc2VsZi5vbi5jYWxsKFwic3RhcnRcIiwgbm9kZSwgbm9kZS5fX2RhdGFfXywgc2VsZi5pbmRleCwgc2VsZi5ncm91cCk7XG4gICAgaWYgKHNlbGYuc3RhdGUgIT09IFNUQVJUSU5HKSByZXR1cm47IC8vIGludGVycnVwdGVkXG4gICAgc2VsZi5zdGF0ZSA9IFNUQVJURUQ7XG5cbiAgICAvLyBJbml0aWFsaXplIHRoZSB0d2VlbiwgZGVsZXRpbmcgbnVsbCB0d2Vlbi5cbiAgICB0d2VlbiA9IG5ldyBBcnJheShuID0gc2VsZi50d2Vlbi5sZW5ndGgpO1xuICAgIGZvciAoaSA9IDAsIGogPSAtMTsgaSA8IG47ICsraSkge1xuICAgICAgaWYgKG8gPSBzZWxmLnR3ZWVuW2ldLnZhbHVlLmNhbGwobm9kZSwgbm9kZS5fX2RhdGFfXywgc2VsZi5pbmRleCwgc2VsZi5ncm91cCkpIHtcbiAgICAgICAgdHdlZW5bKytqXSA9IG87XG4gICAgICB9XG4gICAgfVxuICAgIHR3ZWVuLmxlbmd0aCA9IGogKyAxO1xuICB9XG5cbiAgZnVuY3Rpb24gdGljayhlbGFwc2VkKSB7XG4gICAgdmFyIHQgPSBlbGFwc2VkIDwgc2VsZi5kdXJhdGlvbiA/IHNlbGYuZWFzZS5jYWxsKG51bGwsIGVsYXBzZWQgLyBzZWxmLmR1cmF0aW9uKSA6IChzZWxmLnRpbWVyLnJlc3RhcnQoc3RvcCksIHNlbGYuc3RhdGUgPSBFTkRJTkcsIDEpLFxuICAgICAgICBpID0gLTEsXG4gICAgICAgIG4gPSB0d2Vlbi5sZW5ndGg7XG5cbiAgICB3aGlsZSAoKytpIDwgbikge1xuICAgICAgdHdlZW5baV0uY2FsbChub2RlLCB0KTtcbiAgICB9XG5cbiAgICAvLyBEaXNwYXRjaCB0aGUgZW5kIGV2ZW50LlxuICAgIGlmIChzZWxmLnN0YXRlID09PSBFTkRJTkcpIHtcbiAgICAgIHNlbGYub24uY2FsbChcImVuZFwiLCBub2RlLCBub2RlLl9fZGF0YV9fLCBzZWxmLmluZGV4LCBzZWxmLmdyb3VwKTtcbiAgICAgIHN0b3AoKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBzdG9wKCkge1xuICAgIHNlbGYuc3RhdGUgPSBFTkRFRDtcbiAgICBzZWxmLnRpbWVyLnN0b3AoKTtcbiAgICBkZWxldGUgc2NoZWR1bGVzW2lkXTtcbiAgICBmb3IgKHZhciBpIGluIHNjaGVkdWxlcykgcmV0dXJuOyAvLyBlc2xpbnQtZGlzYWJsZS1saW5lIG5vLXVudXNlZC12YXJzXG4gICAgZGVsZXRlIG5vZGUuX190cmFuc2l0aW9uO1xuICB9XG59XG4iLCAiaW1wb3J0IHtTVEFSVElORywgRU5ESU5HLCBFTkRFRH0gZnJvbSBcIi4vdHJhbnNpdGlvbi9zY2hlZHVsZS5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihub2RlLCBuYW1lKSB7XG4gIHZhciBzY2hlZHVsZXMgPSBub2RlLl9fdHJhbnNpdGlvbixcbiAgICAgIHNjaGVkdWxlLFxuICAgICAgYWN0aXZlLFxuICAgICAgZW1wdHkgPSB0cnVlLFxuICAgICAgaTtcblxuICBpZiAoIXNjaGVkdWxlcykgcmV0dXJuO1xuXG4gIG5hbWUgPSBuYW1lID09IG51bGwgPyBudWxsIDogbmFtZSArIFwiXCI7XG5cbiAgZm9yIChpIGluIHNjaGVkdWxlcykge1xuICAgIGlmICgoc2NoZWR1bGUgPSBzY2hlZHVsZXNbaV0pLm5hbWUgIT09IG5hbWUpIHsgZW1wdHkgPSBmYWxzZTsgY29udGludWU7IH1cbiAgICBhY3RpdmUgPSBzY2hlZHVsZS5zdGF0ZSA+IFNUQVJUSU5HICYmIHNjaGVkdWxlLnN0YXRlIDwgRU5ESU5HO1xuICAgIHNjaGVkdWxlLnN0YXRlID0gRU5ERUQ7XG4gICAgc2NoZWR1bGUudGltZXIuc3RvcCgpO1xuICAgIHNjaGVkdWxlLm9uLmNhbGwoYWN0aXZlID8gXCJpbnRlcnJ1cHRcIiA6IFwiY2FuY2VsXCIsIG5vZGUsIG5vZGUuX19kYXRhX18sIHNjaGVkdWxlLmluZGV4LCBzY2hlZHVsZS5ncm91cCk7XG4gICAgZGVsZXRlIHNjaGVkdWxlc1tpXTtcbiAgfVxuXG4gIGlmIChlbXB0eSkgZGVsZXRlIG5vZGUuX190cmFuc2l0aW9uO1xufVxuIiwgImltcG9ydCBpbnRlcnJ1cHQgZnJvbSBcIi4uL2ludGVycnVwdC5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihuYW1lKSB7XG4gIHJldHVybiB0aGlzLmVhY2goZnVuY3Rpb24oKSB7XG4gICAgaW50ZXJydXB0KHRoaXMsIG5hbWUpO1xuICB9KTtcbn1cbiIsICJpbXBvcnQge2dldCwgc2V0fSBmcm9tIFwiLi9zY2hlZHVsZS5qc1wiO1xuXG5mdW5jdGlvbiB0d2VlblJlbW92ZShpZCwgbmFtZSkge1xuICB2YXIgdHdlZW4wLCB0d2VlbjE7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc2NoZWR1bGUgPSBzZXQodGhpcywgaWQpLFxuICAgICAgICB0d2VlbiA9IHNjaGVkdWxlLnR3ZWVuO1xuXG4gICAgLy8gSWYgdGhpcyBub2RlIHNoYXJlZCB0d2VlbiB3aXRoIHRoZSBwcmV2aW91cyBub2RlLFxuICAgIC8vIGp1c3QgYXNzaWduIHRoZSB1cGRhdGVkIHNoYXJlZCB0d2VlbiBhbmQgd2VcdTIwMTlyZSBkb25lIVxuICAgIC8vIE90aGVyd2lzZSwgY29weS1vbi13cml0ZS5cbiAgICBpZiAodHdlZW4gIT09IHR3ZWVuMCkge1xuICAgICAgdHdlZW4xID0gdHdlZW4wID0gdHdlZW47XG4gICAgICBmb3IgKHZhciBpID0gMCwgbiA9IHR3ZWVuMS5sZW5ndGg7IGkgPCBuOyArK2kpIHtcbiAgICAgICAgaWYgKHR3ZWVuMVtpXS5uYW1lID09PSBuYW1lKSB7XG4gICAgICAgICAgdHdlZW4xID0gdHdlZW4xLnNsaWNlKCk7XG4gICAgICAgICAgdHdlZW4xLnNwbGljZShpLCAxKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHNjaGVkdWxlLnR3ZWVuID0gdHdlZW4xO1xuICB9O1xufVxuXG5mdW5jdGlvbiB0d2VlbkZ1bmN0aW9uKGlkLCBuYW1lLCB2YWx1ZSkge1xuICB2YXIgdHdlZW4wLCB0d2VlbjE7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yO1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNjaGVkdWxlID0gc2V0KHRoaXMsIGlkKSxcbiAgICAgICAgdHdlZW4gPSBzY2hlZHVsZS50d2VlbjtcblxuICAgIC8vIElmIHRoaXMgbm9kZSBzaGFyZWQgdHdlZW4gd2l0aCB0aGUgcHJldmlvdXMgbm9kZSxcbiAgICAvLyBqdXN0IGFzc2lnbiB0aGUgdXBkYXRlZCBzaGFyZWQgdHdlZW4gYW5kIHdlXHUyMDE5cmUgZG9uZSFcbiAgICAvLyBPdGhlcndpc2UsIGNvcHktb24td3JpdGUuXG4gICAgaWYgKHR3ZWVuICE9PSB0d2VlbjApIHtcbiAgICAgIHR3ZWVuMSA9ICh0d2VlbjAgPSB0d2Vlbikuc2xpY2UoKTtcbiAgICAgIGZvciAodmFyIHQgPSB7bmFtZTogbmFtZSwgdmFsdWU6IHZhbHVlfSwgaSA9IDAsIG4gPSB0d2VlbjEubGVuZ3RoOyBpIDwgbjsgKytpKSB7XG4gICAgICAgIGlmICh0d2VlbjFbaV0ubmFtZSA9PT0gbmFtZSkge1xuICAgICAgICAgIHR3ZWVuMVtpXSA9IHQ7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChpID09PSBuKSB0d2VlbjEucHVzaCh0KTtcbiAgICB9XG5cbiAgICBzY2hlZHVsZS50d2VlbiA9IHR3ZWVuMTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSwgdmFsdWUpIHtcbiAgdmFyIGlkID0gdGhpcy5faWQ7XG5cbiAgbmFtZSArPSBcIlwiO1xuXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoIDwgMikge1xuICAgIHZhciB0d2VlbiA9IGdldCh0aGlzLm5vZGUoKSwgaWQpLnR3ZWVuO1xuICAgIGZvciAodmFyIGkgPSAwLCBuID0gdHdlZW4ubGVuZ3RoLCB0OyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAoKHQgPSB0d2VlbltpXSkubmFtZSA9PT0gbmFtZSkge1xuICAgICAgICByZXR1cm4gdC52YWx1ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICByZXR1cm4gdGhpcy5lYWNoKCh2YWx1ZSA9PSBudWxsID8gdHdlZW5SZW1vdmUgOiB0d2VlbkZ1bmN0aW9uKShpZCwgbmFtZSwgdmFsdWUpKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHR3ZWVuVmFsdWUodHJhbnNpdGlvbiwgbmFtZSwgdmFsdWUpIHtcbiAgdmFyIGlkID0gdHJhbnNpdGlvbi5faWQ7XG5cbiAgdHJhbnNpdGlvbi5lYWNoKGZ1bmN0aW9uKCkge1xuICAgIHZhciBzY2hlZHVsZSA9IHNldCh0aGlzLCBpZCk7XG4gICAgKHNjaGVkdWxlLnZhbHVlIHx8IChzY2hlZHVsZS52YWx1ZSA9IHt9KSlbbmFtZV0gPSB2YWx1ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICB9KTtcblxuICByZXR1cm4gZnVuY3Rpb24obm9kZSkge1xuICAgIHJldHVybiBnZXQobm9kZSwgaWQpLnZhbHVlW25hbWVdO1xuICB9O1xufVxuIiwgImltcG9ydCB7Y29sb3J9IGZyb20gXCJkMy1jb2xvclwiO1xuaW1wb3J0IHtpbnRlcnBvbGF0ZU51bWJlciwgaW50ZXJwb2xhdGVSZ2IsIGludGVycG9sYXRlU3RyaW5nfSBmcm9tIFwiZDMtaW50ZXJwb2xhdGVcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oYSwgYikge1xuICB2YXIgYztcbiAgcmV0dXJuICh0eXBlb2YgYiA9PT0gXCJudW1iZXJcIiA/IGludGVycG9sYXRlTnVtYmVyXG4gICAgICA6IGIgaW5zdGFuY2VvZiBjb2xvciA/IGludGVycG9sYXRlUmdiXG4gICAgICA6IChjID0gY29sb3IoYikpID8gKGIgPSBjLCBpbnRlcnBvbGF0ZVJnYilcbiAgICAgIDogaW50ZXJwb2xhdGVTdHJpbmcpKGEsIGIpO1xufVxuIiwgImltcG9ydCB7aW50ZXJwb2xhdGVUcmFuc2Zvcm1TdmcgYXMgaW50ZXJwb2xhdGVUcmFuc2Zvcm19IGZyb20gXCJkMy1pbnRlcnBvbGF0ZVwiO1xuaW1wb3J0IHtuYW1lc3BhY2V9IGZyb20gXCJkMy1zZWxlY3Rpb25cIjtcbmltcG9ydCB7dHdlZW5WYWx1ZX0gZnJvbSBcIi4vdHdlZW4uanNcIjtcbmltcG9ydCBpbnRlcnBvbGF0ZSBmcm9tIFwiLi9pbnRlcnBvbGF0ZS5qc1wiO1xuXG5mdW5jdGlvbiBhdHRyUmVtb3ZlKG5hbWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHRoaXMucmVtb3ZlQXR0cmlidXRlKG5hbWUpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBhdHRyUmVtb3ZlTlMoZnVsbG5hbWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHRoaXMucmVtb3ZlQXR0cmlidXRlTlMoZnVsbG5hbWUuc3BhY2UsIGZ1bGxuYW1lLmxvY2FsKTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gYXR0ckNvbnN0YW50KG5hbWUsIGludGVycG9sYXRlLCB2YWx1ZTEpIHtcbiAgdmFyIHN0cmluZzAwLFxuICAgICAgc3RyaW5nMSA9IHZhbHVlMSArIFwiXCIsXG4gICAgICBpbnRlcnBvbGF0ZTA7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc3RyaW5nMCA9IHRoaXMuZ2V0QXR0cmlidXRlKG5hbWUpO1xuICAgIHJldHVybiBzdHJpbmcwID09PSBzdHJpbmcxID8gbnVsbFxuICAgICAgICA6IHN0cmluZzAgPT09IHN0cmluZzAwID8gaW50ZXJwb2xhdGUwXG4gICAgICAgIDogaW50ZXJwb2xhdGUwID0gaW50ZXJwb2xhdGUoc3RyaW5nMDAgPSBzdHJpbmcwLCB2YWx1ZTEpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBhdHRyQ29uc3RhbnROUyhmdWxsbmFtZSwgaW50ZXJwb2xhdGUsIHZhbHVlMSkge1xuICB2YXIgc3RyaW5nMDAsXG4gICAgICBzdHJpbmcxID0gdmFsdWUxICsgXCJcIixcbiAgICAgIGludGVycG9sYXRlMDtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBzdHJpbmcwID0gdGhpcy5nZXRBdHRyaWJ1dGVOUyhmdWxsbmFtZS5zcGFjZSwgZnVsbG5hbWUubG9jYWwpO1xuICAgIHJldHVybiBzdHJpbmcwID09PSBzdHJpbmcxID8gbnVsbFxuICAgICAgICA6IHN0cmluZzAgPT09IHN0cmluZzAwID8gaW50ZXJwb2xhdGUwXG4gICAgICAgIDogaW50ZXJwb2xhdGUwID0gaW50ZXJwb2xhdGUoc3RyaW5nMDAgPSBzdHJpbmcwLCB2YWx1ZTEpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBhdHRyRnVuY3Rpb24obmFtZSwgaW50ZXJwb2xhdGUsIHZhbHVlKSB7XG4gIHZhciBzdHJpbmcwMCxcbiAgICAgIHN0cmluZzEwLFxuICAgICAgaW50ZXJwb2xhdGUwO1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHN0cmluZzAsIHZhbHVlMSA9IHZhbHVlKHRoaXMpLCBzdHJpbmcxO1xuICAgIGlmICh2YWx1ZTEgPT0gbnVsbCkgcmV0dXJuIHZvaWQgdGhpcy5yZW1vdmVBdHRyaWJ1dGUobmFtZSk7XG4gICAgc3RyaW5nMCA9IHRoaXMuZ2V0QXR0cmlidXRlKG5hbWUpO1xuICAgIHN0cmluZzEgPSB2YWx1ZTEgKyBcIlwiO1xuICAgIHJldHVybiBzdHJpbmcwID09PSBzdHJpbmcxID8gbnVsbFxuICAgICAgICA6IHN0cmluZzAgPT09IHN0cmluZzAwICYmIHN0cmluZzEgPT09IHN0cmluZzEwID8gaW50ZXJwb2xhdGUwXG4gICAgICAgIDogKHN0cmluZzEwID0gc3RyaW5nMSwgaW50ZXJwb2xhdGUwID0gaW50ZXJwb2xhdGUoc3RyaW5nMDAgPSBzdHJpbmcwLCB2YWx1ZTEpKTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gYXR0ckZ1bmN0aW9uTlMoZnVsbG5hbWUsIGludGVycG9sYXRlLCB2YWx1ZSkge1xuICB2YXIgc3RyaW5nMDAsXG4gICAgICBzdHJpbmcxMCxcbiAgICAgIGludGVycG9sYXRlMDtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBzdHJpbmcwLCB2YWx1ZTEgPSB2YWx1ZSh0aGlzKSwgc3RyaW5nMTtcbiAgICBpZiAodmFsdWUxID09IG51bGwpIHJldHVybiB2b2lkIHRoaXMucmVtb3ZlQXR0cmlidXRlTlMoZnVsbG5hbWUuc3BhY2UsIGZ1bGxuYW1lLmxvY2FsKTtcbiAgICBzdHJpbmcwID0gdGhpcy5nZXRBdHRyaWJ1dGVOUyhmdWxsbmFtZS5zcGFjZSwgZnVsbG5hbWUubG9jYWwpO1xuICAgIHN0cmluZzEgPSB2YWx1ZTEgKyBcIlwiO1xuICAgIHJldHVybiBzdHJpbmcwID09PSBzdHJpbmcxID8gbnVsbFxuICAgICAgICA6IHN0cmluZzAgPT09IHN0cmluZzAwICYmIHN0cmluZzEgPT09IHN0cmluZzEwID8gaW50ZXJwb2xhdGUwXG4gICAgICAgIDogKHN0cmluZzEwID0gc3RyaW5nMSwgaW50ZXJwb2xhdGUwID0gaW50ZXJwb2xhdGUoc3RyaW5nMDAgPSBzdHJpbmcwLCB2YWx1ZTEpKTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSwgdmFsdWUpIHtcbiAgdmFyIGZ1bGxuYW1lID0gbmFtZXNwYWNlKG5hbWUpLCBpID0gZnVsbG5hbWUgPT09IFwidHJhbnNmb3JtXCIgPyBpbnRlcnBvbGF0ZVRyYW5zZm9ybSA6IGludGVycG9sYXRlO1xuICByZXR1cm4gdGhpcy5hdHRyVHdlZW4obmFtZSwgdHlwZW9mIHZhbHVlID09PSBcImZ1bmN0aW9uXCJcbiAgICAgID8gKGZ1bGxuYW1lLmxvY2FsID8gYXR0ckZ1bmN0aW9uTlMgOiBhdHRyRnVuY3Rpb24pKGZ1bGxuYW1lLCBpLCB0d2VlblZhbHVlKHRoaXMsIFwiYXR0ci5cIiArIG5hbWUsIHZhbHVlKSlcbiAgICAgIDogdmFsdWUgPT0gbnVsbCA/IChmdWxsbmFtZS5sb2NhbCA/IGF0dHJSZW1vdmVOUyA6IGF0dHJSZW1vdmUpKGZ1bGxuYW1lKVxuICAgICAgOiAoZnVsbG5hbWUubG9jYWwgPyBhdHRyQ29uc3RhbnROUyA6IGF0dHJDb25zdGFudCkoZnVsbG5hbWUsIGksIHZhbHVlKSk7XG59XG4iLCAiaW1wb3J0IHtuYW1lc3BhY2V9IGZyb20gXCJkMy1zZWxlY3Rpb25cIjtcblxuZnVuY3Rpb24gYXR0ckludGVycG9sYXRlKG5hbWUsIGkpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKHQpIHtcbiAgICB0aGlzLnNldEF0dHJpYnV0ZShuYW1lLCBpLmNhbGwodGhpcywgdCkpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBhdHRySW50ZXJwb2xhdGVOUyhmdWxsbmFtZSwgaSkge1xuICByZXR1cm4gZnVuY3Rpb24odCkge1xuICAgIHRoaXMuc2V0QXR0cmlidXRlTlMoZnVsbG5hbWUuc3BhY2UsIGZ1bGxuYW1lLmxvY2FsLCBpLmNhbGwodGhpcywgdCkpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBhdHRyVHdlZW5OUyhmdWxsbmFtZSwgdmFsdWUpIHtcbiAgdmFyIHQwLCBpMDtcbiAgZnVuY3Rpb24gdHdlZW4oKSB7XG4gICAgdmFyIGkgPSB2YWx1ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIGlmIChpICE9PSBpMCkgdDAgPSAoaTAgPSBpKSAmJiBhdHRySW50ZXJwb2xhdGVOUyhmdWxsbmFtZSwgaSk7XG4gICAgcmV0dXJuIHQwO1xuICB9XG4gIHR3ZWVuLl92YWx1ZSA9IHZhbHVlO1xuICByZXR1cm4gdHdlZW47XG59XG5cbmZ1bmN0aW9uIGF0dHJUd2VlbihuYW1lLCB2YWx1ZSkge1xuICB2YXIgdDAsIGkwO1xuICBmdW5jdGlvbiB0d2VlbigpIHtcbiAgICB2YXIgaSA9IHZhbHVlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgaWYgKGkgIT09IGkwKSB0MCA9IChpMCA9IGkpICYmIGF0dHJJbnRlcnBvbGF0ZShuYW1lLCBpKTtcbiAgICByZXR1cm4gdDA7XG4gIH1cbiAgdHdlZW4uX3ZhbHVlID0gdmFsdWU7XG4gIHJldHVybiB0d2Vlbjtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSwgdmFsdWUpIHtcbiAgdmFyIGtleSA9IFwiYXR0ci5cIiArIG5hbWU7XG4gIGlmIChhcmd1bWVudHMubGVuZ3RoIDwgMikgcmV0dXJuIChrZXkgPSB0aGlzLnR3ZWVuKGtleSkpICYmIGtleS5fdmFsdWU7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gdGhpcy50d2VlbihrZXksIG51bGwpO1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcjtcbiAgdmFyIGZ1bGxuYW1lID0gbmFtZXNwYWNlKG5hbWUpO1xuICByZXR1cm4gdGhpcy50d2VlbihrZXksIChmdWxsbmFtZS5sb2NhbCA/IGF0dHJUd2Vlbk5TIDogYXR0clR3ZWVuKShmdWxsbmFtZSwgdmFsdWUpKTtcbn1cbiIsICJpbXBvcnQge2dldCwgaW5pdH0gZnJvbSBcIi4vc2NoZWR1bGUuanNcIjtcblxuZnVuY3Rpb24gZGVsYXlGdW5jdGlvbihpZCwgdmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIGluaXQodGhpcywgaWQpLmRlbGF5ID0gK3ZhbHVlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIGRlbGF5Q29uc3RhbnQoaWQsIHZhbHVlKSB7XG4gIHJldHVybiB2YWx1ZSA9ICt2YWx1ZSwgZnVuY3Rpb24oKSB7XG4gICAgaW5pdCh0aGlzLCBpZCkuZGVsYXkgPSB2YWx1ZTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24odmFsdWUpIHtcbiAgdmFyIGlkID0gdGhpcy5faWQ7XG5cbiAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGhcbiAgICAgID8gdGhpcy5lYWNoKCh0eXBlb2YgdmFsdWUgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgICAgID8gZGVsYXlGdW5jdGlvblxuICAgICAgICAgIDogZGVsYXlDb25zdGFudCkoaWQsIHZhbHVlKSlcbiAgICAgIDogZ2V0KHRoaXMubm9kZSgpLCBpZCkuZGVsYXk7XG59XG4iLCAiaW1wb3J0IHtnZXQsIHNldH0gZnJvbSBcIi4vc2NoZWR1bGUuanNcIjtcblxuZnVuY3Rpb24gZHVyYXRpb25GdW5jdGlvbihpZCwgdmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHNldCh0aGlzLCBpZCkuZHVyYXRpb24gPSArdmFsdWUuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gZHVyYXRpb25Db25zdGFudChpZCwgdmFsdWUpIHtcbiAgcmV0dXJuIHZhbHVlID0gK3ZhbHVlLCBmdW5jdGlvbigpIHtcbiAgICBzZXQodGhpcywgaWQpLmR1cmF0aW9uID0gdmFsdWU7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHZhbHVlKSB7XG4gIHZhciBpZCA9IHRoaXMuX2lkO1xuXG4gIHJldHVybiBhcmd1bWVudHMubGVuZ3RoXG4gICAgICA/IHRoaXMuZWFjaCgodHlwZW9mIHZhbHVlID09PSBcImZ1bmN0aW9uXCJcbiAgICAgICAgICA/IGR1cmF0aW9uRnVuY3Rpb25cbiAgICAgICAgICA6IGR1cmF0aW9uQ29uc3RhbnQpKGlkLCB2YWx1ZSkpXG4gICAgICA6IGdldCh0aGlzLm5vZGUoKSwgaWQpLmR1cmF0aW9uO1xufVxuIiwgImltcG9ydCB7Z2V0LCBzZXR9IGZyb20gXCIuL3NjaGVkdWxlLmpzXCI7XG5cbmZ1bmN0aW9uIGVhc2VDb25zdGFudChpZCwgdmFsdWUpIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgRXJyb3I7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICBzZXQodGhpcywgaWQpLmVhc2UgPSB2YWx1ZTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24odmFsdWUpIHtcbiAgdmFyIGlkID0gdGhpcy5faWQ7XG5cbiAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGhcbiAgICAgID8gdGhpcy5lYWNoKGVhc2VDb25zdGFudChpZCwgdmFsdWUpKVxuICAgICAgOiBnZXQodGhpcy5ub2RlKCksIGlkKS5lYXNlO1xufVxuIiwgImltcG9ydCB7c2V0fSBmcm9tIFwiLi9zY2hlZHVsZS5qc1wiO1xuXG5mdW5jdGlvbiBlYXNlVmFyeWluZyhpZCwgdmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciB2ID0gdmFsdWUuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICBpZiAodHlwZW9mIHYgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yO1xuICAgIHNldCh0aGlzLCBpZCkuZWFzZSA9IHY7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHZhbHVlKSB7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwiZnVuY3Rpb25cIikgdGhyb3cgbmV3IEVycm9yO1xuICByZXR1cm4gdGhpcy5lYWNoKGVhc2VWYXJ5aW5nKHRoaXMuX2lkLCB2YWx1ZSkpO1xufVxuIiwgImltcG9ydCB7bWF0Y2hlcn0gZnJvbSBcImQzLXNlbGVjdGlvblwiO1xuaW1wb3J0IHtUcmFuc2l0aW9ufSBmcm9tIFwiLi9pbmRleC5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihtYXRjaCkge1xuICBpZiAodHlwZW9mIG1hdGNoICE9PSBcImZ1bmN0aW9uXCIpIG1hdGNoID0gbWF0Y2hlcihtYXRjaCk7XG5cbiAgZm9yICh2YXIgZ3JvdXBzID0gdGhpcy5fZ3JvdXBzLCBtID0gZ3JvdXBzLmxlbmd0aCwgc3ViZ3JvdXBzID0gbmV3IEFycmF5KG0pLCBqID0gMDsgaiA8IG07ICsraikge1xuICAgIGZvciAodmFyIGdyb3VwID0gZ3JvdXBzW2pdLCBuID0gZ3JvdXAubGVuZ3RoLCBzdWJncm91cCA9IHN1Ymdyb3Vwc1tqXSA9IFtdLCBub2RlLCBpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgaWYgKChub2RlID0gZ3JvdXBbaV0pICYmIG1hdGNoLmNhbGwobm9kZSwgbm9kZS5fX2RhdGFfXywgaSwgZ3JvdXApKSB7XG4gICAgICAgIHN1Ymdyb3VwLnB1c2gobm9kZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG5ldyBUcmFuc2l0aW9uKHN1Ymdyb3VwcywgdGhpcy5fcGFyZW50cywgdGhpcy5fbmFtZSwgdGhpcy5faWQpO1xufVxuIiwgImltcG9ydCB7VHJhbnNpdGlvbn0gZnJvbSBcIi4vaW5kZXguanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24odHJhbnNpdGlvbikge1xuICBpZiAodHJhbnNpdGlvbi5faWQgIT09IHRoaXMuX2lkKSB0aHJvdyBuZXcgRXJyb3I7XG5cbiAgZm9yICh2YXIgZ3JvdXBzMCA9IHRoaXMuX2dyb3VwcywgZ3JvdXBzMSA9IHRyYW5zaXRpb24uX2dyb3VwcywgbTAgPSBncm91cHMwLmxlbmd0aCwgbTEgPSBncm91cHMxLmxlbmd0aCwgbSA9IE1hdGgubWluKG0wLCBtMSksIG1lcmdlcyA9IG5ldyBBcnJheShtMCksIGogPSAwOyBqIDwgbTsgKytqKSB7XG4gICAgZm9yICh2YXIgZ3JvdXAwID0gZ3JvdXBzMFtqXSwgZ3JvdXAxID0gZ3JvdXBzMVtqXSwgbiA9IGdyb3VwMC5sZW5ndGgsIG1lcmdlID0gbWVyZ2VzW2pdID0gbmV3IEFycmF5KG4pLCBub2RlLCBpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgaWYgKG5vZGUgPSBncm91cDBbaV0gfHwgZ3JvdXAxW2ldKSB7XG4gICAgICAgIG1lcmdlW2ldID0gbm9kZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBmb3IgKDsgaiA8IG0wOyArK2opIHtcbiAgICBtZXJnZXNbal0gPSBncm91cHMwW2pdO1xuICB9XG5cbiAgcmV0dXJuIG5ldyBUcmFuc2l0aW9uKG1lcmdlcywgdGhpcy5fcGFyZW50cywgdGhpcy5fbmFtZSwgdGhpcy5faWQpO1xufVxuIiwgImltcG9ydCB7Z2V0LCBzZXQsIGluaXR9IGZyb20gXCIuL3NjaGVkdWxlLmpzXCI7XG5cbmZ1bmN0aW9uIHN0YXJ0KG5hbWUpIHtcbiAgcmV0dXJuIChuYW1lICsgXCJcIikudHJpbSgpLnNwbGl0KC9efFxccysvKS5ldmVyeShmdW5jdGlvbih0KSB7XG4gICAgdmFyIGkgPSB0LmluZGV4T2YoXCIuXCIpO1xuICAgIGlmIChpID49IDApIHQgPSB0LnNsaWNlKDAsIGkpO1xuICAgIHJldHVybiAhdCB8fCB0ID09PSBcInN0YXJ0XCI7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBvbkZ1bmN0aW9uKGlkLCBuYW1lLCBsaXN0ZW5lcikge1xuICB2YXIgb24wLCBvbjEsIHNpdCA9IHN0YXJ0KG5hbWUpID8gaW5pdCA6IHNldDtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBzY2hlZHVsZSA9IHNpdCh0aGlzLCBpZCksXG4gICAgICAgIG9uID0gc2NoZWR1bGUub247XG5cbiAgICAvLyBJZiB0aGlzIG5vZGUgc2hhcmVkIGEgZGlzcGF0Y2ggd2l0aCB0aGUgcHJldmlvdXMgbm9kZSxcbiAgICAvLyBqdXN0IGFzc2lnbiB0aGUgdXBkYXRlZCBzaGFyZWQgZGlzcGF0Y2ggYW5kIHdlXHUyMDE5cmUgZG9uZSFcbiAgICAvLyBPdGhlcndpc2UsIGNvcHktb24td3JpdGUuXG4gICAgaWYgKG9uICE9PSBvbjApIChvbjEgPSAob24wID0gb24pLmNvcHkoKSkub24obmFtZSwgbGlzdGVuZXIpO1xuXG4gICAgc2NoZWR1bGUub24gPSBvbjE7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG5hbWUsIGxpc3RlbmVyKSB7XG4gIHZhciBpZCA9IHRoaXMuX2lkO1xuXG4gIHJldHVybiBhcmd1bWVudHMubGVuZ3RoIDwgMlxuICAgICAgPyBnZXQodGhpcy5ub2RlKCksIGlkKS5vbi5vbihuYW1lKVxuICAgICAgOiB0aGlzLmVhY2gob25GdW5jdGlvbihpZCwgbmFtZSwgbGlzdGVuZXIpKTtcbn1cbiIsICJmdW5jdGlvbiByZW1vdmVGdW5jdGlvbihpZCkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHBhcmVudCA9IHRoaXMucGFyZW50Tm9kZTtcbiAgICBmb3IgKHZhciBpIGluIHRoaXMuX190cmFuc2l0aW9uKSBpZiAoK2kgIT09IGlkKSByZXR1cm47XG4gICAgaWYgKHBhcmVudCkgcGFyZW50LnJlbW92ZUNoaWxkKHRoaXMpO1xuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMub24oXCJlbmQucmVtb3ZlXCIsIHJlbW92ZUZ1bmN0aW9uKHRoaXMuX2lkKSk7XG59XG4iLCAiaW1wb3J0IHtzZWxlY3Rvcn0gZnJvbSBcImQzLXNlbGVjdGlvblwiO1xuaW1wb3J0IHtUcmFuc2l0aW9ufSBmcm9tIFwiLi9pbmRleC5qc1wiO1xuaW1wb3J0IHNjaGVkdWxlLCB7Z2V0fSBmcm9tIFwiLi9zY2hlZHVsZS5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihzZWxlY3QpIHtcbiAgdmFyIG5hbWUgPSB0aGlzLl9uYW1lLFxuICAgICAgaWQgPSB0aGlzLl9pZDtcblxuICBpZiAodHlwZW9mIHNlbGVjdCAhPT0gXCJmdW5jdGlvblwiKSBzZWxlY3QgPSBzZWxlY3RvcihzZWxlY3QpO1xuXG4gIGZvciAodmFyIGdyb3VwcyA9IHRoaXMuX2dyb3VwcywgbSA9IGdyb3Vwcy5sZW5ndGgsIHN1Ymdyb3VwcyA9IG5ldyBBcnJheShtKSwgaiA9IDA7IGogPCBtOyArK2opIHtcbiAgICBmb3IgKHZhciBncm91cCA9IGdyb3Vwc1tqXSwgbiA9IGdyb3VwLmxlbmd0aCwgc3ViZ3JvdXAgPSBzdWJncm91cHNbal0gPSBuZXcgQXJyYXkobiksIG5vZGUsIHN1Ym5vZGUsIGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAoKG5vZGUgPSBncm91cFtpXSkgJiYgKHN1Ym5vZGUgPSBzZWxlY3QuY2FsbChub2RlLCBub2RlLl9fZGF0YV9fLCBpLCBncm91cCkpKSB7XG4gICAgICAgIGlmIChcIl9fZGF0YV9fXCIgaW4gbm9kZSkgc3Vibm9kZS5fX2RhdGFfXyA9IG5vZGUuX19kYXRhX187XG4gICAgICAgIHN1Ymdyb3VwW2ldID0gc3Vibm9kZTtcbiAgICAgICAgc2NoZWR1bGUoc3ViZ3JvdXBbaV0sIG5hbWUsIGlkLCBpLCBzdWJncm91cCwgZ2V0KG5vZGUsIGlkKSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG5ldyBUcmFuc2l0aW9uKHN1Ymdyb3VwcywgdGhpcy5fcGFyZW50cywgbmFtZSwgaWQpO1xufVxuIiwgImltcG9ydCB7c2VsZWN0b3JBbGx9IGZyb20gXCJkMy1zZWxlY3Rpb25cIjtcbmltcG9ydCB7VHJhbnNpdGlvbn0gZnJvbSBcIi4vaW5kZXguanNcIjtcbmltcG9ydCBzY2hlZHVsZSwge2dldH0gZnJvbSBcIi4vc2NoZWR1bGUuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oc2VsZWN0KSB7XG4gIHZhciBuYW1lID0gdGhpcy5fbmFtZSxcbiAgICAgIGlkID0gdGhpcy5faWQ7XG5cbiAgaWYgKHR5cGVvZiBzZWxlY3QgIT09IFwiZnVuY3Rpb25cIikgc2VsZWN0ID0gc2VsZWN0b3JBbGwoc2VsZWN0KTtcblxuICBmb3IgKHZhciBncm91cHMgPSB0aGlzLl9ncm91cHMsIG0gPSBncm91cHMubGVuZ3RoLCBzdWJncm91cHMgPSBbXSwgcGFyZW50cyA9IFtdLCBqID0gMDsgaiA8IG07ICsraikge1xuICAgIGZvciAodmFyIGdyb3VwID0gZ3JvdXBzW2pdLCBuID0gZ3JvdXAubGVuZ3RoLCBub2RlLCBpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgaWYgKG5vZGUgPSBncm91cFtpXSkge1xuICAgICAgICBmb3IgKHZhciBjaGlsZHJlbiA9IHNlbGVjdC5jYWxsKG5vZGUsIG5vZGUuX19kYXRhX18sIGksIGdyb3VwKSwgY2hpbGQsIGluaGVyaXQgPSBnZXQobm9kZSwgaWQpLCBrID0gMCwgbCA9IGNoaWxkcmVuLmxlbmd0aDsgayA8IGw7ICsraykge1xuICAgICAgICAgIGlmIChjaGlsZCA9IGNoaWxkcmVuW2tdKSB7XG4gICAgICAgICAgICBzY2hlZHVsZShjaGlsZCwgbmFtZSwgaWQsIGssIGNoaWxkcmVuLCBpbmhlcml0KTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgc3ViZ3JvdXBzLnB1c2goY2hpbGRyZW4pO1xuICAgICAgICBwYXJlbnRzLnB1c2gobm9kZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG5ldyBUcmFuc2l0aW9uKHN1Ymdyb3VwcywgcGFyZW50cywgbmFtZSwgaWQpO1xufVxuIiwgImltcG9ydCB7c2VsZWN0aW9ufSBmcm9tIFwiZDMtc2VsZWN0aW9uXCI7XG5cbnZhciBTZWxlY3Rpb24gPSBzZWxlY3Rpb24ucHJvdG90eXBlLmNvbnN0cnVjdG9yO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIG5ldyBTZWxlY3Rpb24odGhpcy5fZ3JvdXBzLCB0aGlzLl9wYXJlbnRzKTtcbn1cbiIsICJpbXBvcnQge2ludGVycG9sYXRlVHJhbnNmb3JtQ3NzIGFzIGludGVycG9sYXRlVHJhbnNmb3JtfSBmcm9tIFwiZDMtaW50ZXJwb2xhdGVcIjtcbmltcG9ydCB7c3R5bGV9IGZyb20gXCJkMy1zZWxlY3Rpb25cIjtcbmltcG9ydCB7c2V0fSBmcm9tIFwiLi9zY2hlZHVsZS5qc1wiO1xuaW1wb3J0IHt0d2VlblZhbHVlfSBmcm9tIFwiLi90d2Vlbi5qc1wiO1xuaW1wb3J0IGludGVycG9sYXRlIGZyb20gXCIuL2ludGVycG9sYXRlLmpzXCI7XG5cbmZ1bmN0aW9uIHN0eWxlTnVsbChuYW1lLCBpbnRlcnBvbGF0ZSkge1xuICB2YXIgc3RyaW5nMDAsXG4gICAgICBzdHJpbmcxMCxcbiAgICAgIGludGVycG9sYXRlMDtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBzdHJpbmcwID0gc3R5bGUodGhpcywgbmFtZSksXG4gICAgICAgIHN0cmluZzEgPSAodGhpcy5zdHlsZS5yZW1vdmVQcm9wZXJ0eShuYW1lKSwgc3R5bGUodGhpcywgbmFtZSkpO1xuICAgIHJldHVybiBzdHJpbmcwID09PSBzdHJpbmcxID8gbnVsbFxuICAgICAgICA6IHN0cmluZzAgPT09IHN0cmluZzAwICYmIHN0cmluZzEgPT09IHN0cmluZzEwID8gaW50ZXJwb2xhdGUwXG4gICAgICAgIDogaW50ZXJwb2xhdGUwID0gaW50ZXJwb2xhdGUoc3RyaW5nMDAgPSBzdHJpbmcwLCBzdHJpbmcxMCA9IHN0cmluZzEpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBzdHlsZVJlbW92ZShuYW1lKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnN0eWxlLnJlbW92ZVByb3BlcnR5KG5hbWUpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBzdHlsZUNvbnN0YW50KG5hbWUsIGludGVycG9sYXRlLCB2YWx1ZTEpIHtcbiAgdmFyIHN0cmluZzAwLFxuICAgICAgc3RyaW5nMSA9IHZhbHVlMSArIFwiXCIsXG4gICAgICBpbnRlcnBvbGF0ZTA7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc3RyaW5nMCA9IHN0eWxlKHRoaXMsIG5hbWUpO1xuICAgIHJldHVybiBzdHJpbmcwID09PSBzdHJpbmcxID8gbnVsbFxuICAgICAgICA6IHN0cmluZzAgPT09IHN0cmluZzAwID8gaW50ZXJwb2xhdGUwXG4gICAgICAgIDogaW50ZXJwb2xhdGUwID0gaW50ZXJwb2xhdGUoc3RyaW5nMDAgPSBzdHJpbmcwLCB2YWx1ZTEpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBzdHlsZUZ1bmN0aW9uKG5hbWUsIGludGVycG9sYXRlLCB2YWx1ZSkge1xuICB2YXIgc3RyaW5nMDAsXG4gICAgICBzdHJpbmcxMCxcbiAgICAgIGludGVycG9sYXRlMDtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBzdHJpbmcwID0gc3R5bGUodGhpcywgbmFtZSksXG4gICAgICAgIHZhbHVlMSA9IHZhbHVlKHRoaXMpLFxuICAgICAgICBzdHJpbmcxID0gdmFsdWUxICsgXCJcIjtcbiAgICBpZiAodmFsdWUxID09IG51bGwpIHN0cmluZzEgPSB2YWx1ZTEgPSAodGhpcy5zdHlsZS5yZW1vdmVQcm9wZXJ0eShuYW1lKSwgc3R5bGUodGhpcywgbmFtZSkpO1xuICAgIHJldHVybiBzdHJpbmcwID09PSBzdHJpbmcxID8gbnVsbFxuICAgICAgICA6IHN0cmluZzAgPT09IHN0cmluZzAwICYmIHN0cmluZzEgPT09IHN0cmluZzEwID8gaW50ZXJwb2xhdGUwXG4gICAgICAgIDogKHN0cmluZzEwID0gc3RyaW5nMSwgaW50ZXJwb2xhdGUwID0gaW50ZXJwb2xhdGUoc3RyaW5nMDAgPSBzdHJpbmcwLCB2YWx1ZTEpKTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gc3R5bGVNYXliZVJlbW92ZShpZCwgbmFtZSkge1xuICB2YXIgb24wLCBvbjEsIGxpc3RlbmVyMCwga2V5ID0gXCJzdHlsZS5cIiArIG5hbWUsIGV2ZW50ID0gXCJlbmQuXCIgKyBrZXksIHJlbW92ZTtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBzY2hlZHVsZSA9IHNldCh0aGlzLCBpZCksXG4gICAgICAgIG9uID0gc2NoZWR1bGUub24sXG4gICAgICAgIGxpc3RlbmVyID0gc2NoZWR1bGUudmFsdWVba2V5XSA9PSBudWxsID8gcmVtb3ZlIHx8IChyZW1vdmUgPSBzdHlsZVJlbW92ZShuYW1lKSkgOiB1bmRlZmluZWQ7XG5cbiAgICAvLyBJZiB0aGlzIG5vZGUgc2hhcmVkIGEgZGlzcGF0Y2ggd2l0aCB0aGUgcHJldmlvdXMgbm9kZSxcbiAgICAvLyBqdXN0IGFzc2lnbiB0aGUgdXBkYXRlZCBzaGFyZWQgZGlzcGF0Y2ggYW5kIHdlXHUyMDE5cmUgZG9uZSFcbiAgICAvLyBPdGhlcndpc2UsIGNvcHktb24td3JpdGUuXG4gICAgaWYgKG9uICE9PSBvbjAgfHwgbGlzdGVuZXIwICE9PSBsaXN0ZW5lcikgKG9uMSA9IChvbjAgPSBvbikuY29weSgpKS5vbihldmVudCwgbGlzdGVuZXIwID0gbGlzdGVuZXIpO1xuXG4gICAgc2NoZWR1bGUub24gPSBvbjE7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG5hbWUsIHZhbHVlLCBwcmlvcml0eSkge1xuICB2YXIgaSA9IChuYW1lICs9IFwiXCIpID09PSBcInRyYW5zZm9ybVwiID8gaW50ZXJwb2xhdGVUcmFuc2Zvcm0gOiBpbnRlcnBvbGF0ZTtcbiAgcmV0dXJuIHZhbHVlID09IG51bGwgPyB0aGlzXG4gICAgICAuc3R5bGVUd2VlbihuYW1lLCBzdHlsZU51bGwobmFtZSwgaSkpXG4gICAgICAub24oXCJlbmQuc3R5bGUuXCIgKyBuYW1lLCBzdHlsZVJlbW92ZShuYW1lKSlcbiAgICA6IHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiID8gdGhpc1xuICAgICAgLnN0eWxlVHdlZW4obmFtZSwgc3R5bGVGdW5jdGlvbihuYW1lLCBpLCB0d2VlblZhbHVlKHRoaXMsIFwic3R5bGUuXCIgKyBuYW1lLCB2YWx1ZSkpKVxuICAgICAgLmVhY2goc3R5bGVNYXliZVJlbW92ZSh0aGlzLl9pZCwgbmFtZSkpXG4gICAgOiB0aGlzXG4gICAgICAuc3R5bGVUd2VlbihuYW1lLCBzdHlsZUNvbnN0YW50KG5hbWUsIGksIHZhbHVlKSwgcHJpb3JpdHkpXG4gICAgICAub24oXCJlbmQuc3R5bGUuXCIgKyBuYW1lLCBudWxsKTtcbn1cbiIsICJmdW5jdGlvbiBzdHlsZUludGVycG9sYXRlKG5hbWUsIGksIHByaW9yaXR5KSB7XG4gIHJldHVybiBmdW5jdGlvbih0KSB7XG4gICAgdGhpcy5zdHlsZS5zZXRQcm9wZXJ0eShuYW1lLCBpLmNhbGwodGhpcywgdCksIHByaW9yaXR5KTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gc3R5bGVUd2VlbihuYW1lLCB2YWx1ZSwgcHJpb3JpdHkpIHtcbiAgdmFyIHQsIGkwO1xuICBmdW5jdGlvbiB0d2VlbigpIHtcbiAgICB2YXIgaSA9IHZhbHVlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgaWYgKGkgIT09IGkwKSB0ID0gKGkwID0gaSkgJiYgc3R5bGVJbnRlcnBvbGF0ZShuYW1lLCBpLCBwcmlvcml0eSk7XG4gICAgcmV0dXJuIHQ7XG4gIH1cbiAgdHdlZW4uX3ZhbHVlID0gdmFsdWU7XG4gIHJldHVybiB0d2Vlbjtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obmFtZSwgdmFsdWUsIHByaW9yaXR5KSB7XG4gIHZhciBrZXkgPSBcInN0eWxlLlwiICsgKG5hbWUgKz0gXCJcIik7XG4gIGlmIChhcmd1bWVudHMubGVuZ3RoIDwgMikgcmV0dXJuIChrZXkgPSB0aGlzLnR3ZWVuKGtleSkpICYmIGtleS5fdmFsdWU7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gdGhpcy50d2VlbihrZXksIG51bGwpO1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcjtcbiAgcmV0dXJuIHRoaXMudHdlZW4oa2V5LCBzdHlsZVR3ZWVuKG5hbWUsIHZhbHVlLCBwcmlvcml0eSA9PSBudWxsID8gXCJcIiA6IHByaW9yaXR5KSk7XG59XG4iLCAiaW1wb3J0IHt0d2VlblZhbHVlfSBmcm9tIFwiLi90d2Vlbi5qc1wiO1xuXG5mdW5jdGlvbiB0ZXh0Q29uc3RhbnQodmFsdWUpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHRoaXMudGV4dENvbnRlbnQgPSB2YWx1ZTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gdGV4dEZ1bmN0aW9uKHZhbHVlKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgdmFsdWUxID0gdmFsdWUodGhpcyk7XG4gICAgdGhpcy50ZXh0Q29udGVudCA9IHZhbHVlMSA9PSBudWxsID8gXCJcIiA6IHZhbHVlMTtcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24odmFsdWUpIHtcbiAgcmV0dXJuIHRoaXMudHdlZW4oXCJ0ZXh0XCIsIHR5cGVvZiB2YWx1ZSA9PT0gXCJmdW5jdGlvblwiXG4gICAgICA/IHRleHRGdW5jdGlvbih0d2VlblZhbHVlKHRoaXMsIFwidGV4dFwiLCB2YWx1ZSkpXG4gICAgICA6IHRleHRDb25zdGFudCh2YWx1ZSA9PSBudWxsID8gXCJcIiA6IHZhbHVlICsgXCJcIikpO1xufVxuIiwgImZ1bmN0aW9uIHRleHRJbnRlcnBvbGF0ZShpKSB7XG4gIHJldHVybiBmdW5jdGlvbih0KSB7XG4gICAgdGhpcy50ZXh0Q29udGVudCA9IGkuY2FsbCh0aGlzLCB0KTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gdGV4dFR3ZWVuKHZhbHVlKSB7XG4gIHZhciB0MCwgaTA7XG4gIGZ1bmN0aW9uIHR3ZWVuKCkge1xuICAgIHZhciBpID0gdmFsdWUuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICBpZiAoaSAhPT0gaTApIHQwID0gKGkwID0gaSkgJiYgdGV4dEludGVycG9sYXRlKGkpO1xuICAgIHJldHVybiB0MDtcbiAgfVxuICB0d2Vlbi5fdmFsdWUgPSB2YWx1ZTtcbiAgcmV0dXJuIHR3ZWVuO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih2YWx1ZSkge1xuICB2YXIga2V5ID0gXCJ0ZXh0XCI7XG4gIGlmIChhcmd1bWVudHMubGVuZ3RoIDwgMSkgcmV0dXJuIChrZXkgPSB0aGlzLnR3ZWVuKGtleSkpICYmIGtleS5fdmFsdWU7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gdGhpcy50d2VlbihrZXksIG51bGwpO1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcImZ1bmN0aW9uXCIpIHRocm93IG5ldyBFcnJvcjtcbiAgcmV0dXJuIHRoaXMudHdlZW4oa2V5LCB0ZXh0VHdlZW4odmFsdWUpKTtcbn1cbiIsICJpbXBvcnQge1RyYW5zaXRpb24sIG5ld0lkfSBmcm9tIFwiLi9pbmRleC5qc1wiO1xuaW1wb3J0IHNjaGVkdWxlLCB7Z2V0fSBmcm9tIFwiLi9zY2hlZHVsZS5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgdmFyIG5hbWUgPSB0aGlzLl9uYW1lLFxuICAgICAgaWQwID0gdGhpcy5faWQsXG4gICAgICBpZDEgPSBuZXdJZCgpO1xuXG4gIGZvciAodmFyIGdyb3VwcyA9IHRoaXMuX2dyb3VwcywgbSA9IGdyb3Vwcy5sZW5ndGgsIGogPSAwOyBqIDwgbTsgKytqKSB7XG4gICAgZm9yICh2YXIgZ3JvdXAgPSBncm91cHNbal0sIG4gPSBncm91cC5sZW5ndGgsIG5vZGUsIGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICBpZiAobm9kZSA9IGdyb3VwW2ldKSB7XG4gICAgICAgIHZhciBpbmhlcml0ID0gZ2V0KG5vZGUsIGlkMCk7XG4gICAgICAgIHNjaGVkdWxlKG5vZGUsIG5hbWUsIGlkMSwgaSwgZ3JvdXAsIHtcbiAgICAgICAgICB0aW1lOiBpbmhlcml0LnRpbWUgKyBpbmhlcml0LmRlbGF5ICsgaW5oZXJpdC5kdXJhdGlvbixcbiAgICAgICAgICBkZWxheTogMCxcbiAgICAgICAgICBkdXJhdGlvbjogaW5oZXJpdC5kdXJhdGlvbixcbiAgICAgICAgICBlYXNlOiBpbmhlcml0LmVhc2VcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG5ldyBUcmFuc2l0aW9uKGdyb3VwcywgdGhpcy5fcGFyZW50cywgbmFtZSwgaWQxKTtcbn1cbiIsICJpbXBvcnQge3NldH0gZnJvbSBcIi4vc2NoZWR1bGUuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIHZhciBvbjAsIG9uMSwgdGhhdCA9IHRoaXMsIGlkID0gdGhhdC5faWQsIHNpemUgPSB0aGF0LnNpemUoKTtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgIHZhciBjYW5jZWwgPSB7dmFsdWU6IHJlamVjdH0sXG4gICAgICAgIGVuZCA9IHt2YWx1ZTogZnVuY3Rpb24oKSB7IGlmICgtLXNpemUgPT09IDApIHJlc29sdmUoKTsgfX07XG5cbiAgICB0aGF0LmVhY2goZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgc2NoZWR1bGUgPSBzZXQodGhpcywgaWQpLFxuICAgICAgICAgIG9uID0gc2NoZWR1bGUub247XG5cbiAgICAgIC8vIElmIHRoaXMgbm9kZSBzaGFyZWQgYSBkaXNwYXRjaCB3aXRoIHRoZSBwcmV2aW91cyBub2RlLFxuICAgICAgLy8ganVzdCBhc3NpZ24gdGhlIHVwZGF0ZWQgc2hhcmVkIGRpc3BhdGNoIGFuZCB3ZVx1MjAxOXJlIGRvbmUhXG4gICAgICAvLyBPdGhlcndpc2UsIGNvcHktb24td3JpdGUuXG4gICAgICBpZiAob24gIT09IG9uMCkge1xuICAgICAgICBvbjEgPSAob24wID0gb24pLmNvcHkoKTtcbiAgICAgICAgb24xLl8uY2FuY2VsLnB1c2goY2FuY2VsKTtcbiAgICAgICAgb24xLl8uaW50ZXJydXB0LnB1c2goY2FuY2VsKTtcbiAgICAgICAgb24xLl8uZW5kLnB1c2goZW5kKTtcbiAgICAgIH1cblxuICAgICAgc2NoZWR1bGUub24gPSBvbjE7XG4gICAgfSk7XG5cbiAgICAvLyBUaGUgc2VsZWN0aW9uIHdhcyBlbXB0eSwgcmVzb2x2ZSBlbmQgaW1tZWRpYXRlbHlcbiAgICBpZiAoc2l6ZSA9PT0gMCkgcmVzb2x2ZSgpO1xuICB9KTtcbn1cbiIsICJpbXBvcnQge3NlbGVjdGlvbn0gZnJvbSBcImQzLXNlbGVjdGlvblwiO1xuaW1wb3J0IHRyYW5zaXRpb25fYXR0ciBmcm9tIFwiLi9hdHRyLmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl9hdHRyVHdlZW4gZnJvbSBcIi4vYXR0clR3ZWVuLmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl9kZWxheSBmcm9tIFwiLi9kZWxheS5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fZHVyYXRpb24gZnJvbSBcIi4vZHVyYXRpb24uanNcIjtcbmltcG9ydCB0cmFuc2l0aW9uX2Vhc2UgZnJvbSBcIi4vZWFzZS5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fZWFzZVZhcnlpbmcgZnJvbSBcIi4vZWFzZVZhcnlpbmcuanNcIjtcbmltcG9ydCB0cmFuc2l0aW9uX2ZpbHRlciBmcm9tIFwiLi9maWx0ZXIuanNcIjtcbmltcG9ydCB0cmFuc2l0aW9uX21lcmdlIGZyb20gXCIuL21lcmdlLmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl9vbiBmcm9tIFwiLi9vbi5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fcmVtb3ZlIGZyb20gXCIuL3JlbW92ZS5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fc2VsZWN0IGZyb20gXCIuL3NlbGVjdC5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fc2VsZWN0QWxsIGZyb20gXCIuL3NlbGVjdEFsbC5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fc2VsZWN0aW9uIGZyb20gXCIuL3NlbGVjdGlvbi5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fc3R5bGUgZnJvbSBcIi4vc3R5bGUuanNcIjtcbmltcG9ydCB0cmFuc2l0aW9uX3N0eWxlVHdlZW4gZnJvbSBcIi4vc3R5bGVUd2Vlbi5qc1wiO1xuaW1wb3J0IHRyYW5zaXRpb25fdGV4dCBmcm9tIFwiLi90ZXh0LmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl90ZXh0VHdlZW4gZnJvbSBcIi4vdGV4dFR3ZWVuLmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl90cmFuc2l0aW9uIGZyb20gXCIuL3RyYW5zaXRpb24uanNcIjtcbmltcG9ydCB0cmFuc2l0aW9uX3R3ZWVuIGZyb20gXCIuL3R3ZWVuLmpzXCI7XG5pbXBvcnQgdHJhbnNpdGlvbl9lbmQgZnJvbSBcIi4vZW5kLmpzXCI7XG5cbnZhciBpZCA9IDA7XG5cbmV4cG9ydCBmdW5jdGlvbiBUcmFuc2l0aW9uKGdyb3VwcywgcGFyZW50cywgbmFtZSwgaWQpIHtcbiAgdGhpcy5fZ3JvdXBzID0gZ3JvdXBzO1xuICB0aGlzLl9wYXJlbnRzID0gcGFyZW50cztcbiAgdGhpcy5fbmFtZSA9IG5hbWU7XG4gIHRoaXMuX2lkID0gaWQ7XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIHRyYW5zaXRpb24obmFtZSkge1xuICByZXR1cm4gc2VsZWN0aW9uKCkudHJhbnNpdGlvbihuYW1lKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG5ld0lkKCkge1xuICByZXR1cm4gKytpZDtcbn1cblxudmFyIHNlbGVjdGlvbl9wcm90b3R5cGUgPSBzZWxlY3Rpb24ucHJvdG90eXBlO1xuXG5UcmFuc2l0aW9uLnByb3RvdHlwZSA9IHRyYW5zaXRpb24ucHJvdG90eXBlID0ge1xuICBjb25zdHJ1Y3RvcjogVHJhbnNpdGlvbixcbiAgc2VsZWN0OiB0cmFuc2l0aW9uX3NlbGVjdCxcbiAgc2VsZWN0QWxsOiB0cmFuc2l0aW9uX3NlbGVjdEFsbCxcbiAgc2VsZWN0Q2hpbGQ6IHNlbGVjdGlvbl9wcm90b3R5cGUuc2VsZWN0Q2hpbGQsXG4gIHNlbGVjdENoaWxkcmVuOiBzZWxlY3Rpb25fcHJvdG90eXBlLnNlbGVjdENoaWxkcmVuLFxuICBmaWx0ZXI6IHRyYW5zaXRpb25fZmlsdGVyLFxuICBtZXJnZTogdHJhbnNpdGlvbl9tZXJnZSxcbiAgc2VsZWN0aW9uOiB0cmFuc2l0aW9uX3NlbGVjdGlvbixcbiAgdHJhbnNpdGlvbjogdHJhbnNpdGlvbl90cmFuc2l0aW9uLFxuICBjYWxsOiBzZWxlY3Rpb25fcHJvdG90eXBlLmNhbGwsXG4gIG5vZGVzOiBzZWxlY3Rpb25fcHJvdG90eXBlLm5vZGVzLFxuICBub2RlOiBzZWxlY3Rpb25fcHJvdG90eXBlLm5vZGUsXG4gIHNpemU6IHNlbGVjdGlvbl9wcm90b3R5cGUuc2l6ZSxcbiAgZW1wdHk6IHNlbGVjdGlvbl9wcm90b3R5cGUuZW1wdHksXG4gIGVhY2g6IHNlbGVjdGlvbl9wcm90b3R5cGUuZWFjaCxcbiAgb246IHRyYW5zaXRpb25fb24sXG4gIGF0dHI6IHRyYW5zaXRpb25fYXR0cixcbiAgYXR0clR3ZWVuOiB0cmFuc2l0aW9uX2F0dHJUd2VlbixcbiAgc3R5bGU6IHRyYW5zaXRpb25fc3R5bGUsXG4gIHN0eWxlVHdlZW46IHRyYW5zaXRpb25fc3R5bGVUd2VlbixcbiAgdGV4dDogdHJhbnNpdGlvbl90ZXh0LFxuICB0ZXh0VHdlZW46IHRyYW5zaXRpb25fdGV4dFR3ZWVuLFxuICByZW1vdmU6IHRyYW5zaXRpb25fcmVtb3ZlLFxuICB0d2VlbjogdHJhbnNpdGlvbl90d2VlbixcbiAgZGVsYXk6IHRyYW5zaXRpb25fZGVsYXksXG4gIGR1cmF0aW9uOiB0cmFuc2l0aW9uX2R1cmF0aW9uLFxuICBlYXNlOiB0cmFuc2l0aW9uX2Vhc2UsXG4gIGVhc2VWYXJ5aW5nOiB0cmFuc2l0aW9uX2Vhc2VWYXJ5aW5nLFxuICBlbmQ6IHRyYW5zaXRpb25fZW5kLFxuICBbU3ltYm9sLml0ZXJhdG9yXTogc2VsZWN0aW9uX3Byb3RvdHlwZVtTeW1ib2wuaXRlcmF0b3JdXG59O1xuIiwgImV4cG9ydCBmdW5jdGlvbiBjdWJpY0luKHQpIHtcbiAgcmV0dXJuIHQgKiB0ICogdDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGN1YmljT3V0KHQpIHtcbiAgcmV0dXJuIC0tdCAqIHQgKiB0ICsgMTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGN1YmljSW5PdXQodCkge1xuICByZXR1cm4gKCh0ICo9IDIpIDw9IDEgPyB0ICogdCAqIHQgOiAodCAtPSAyKSAqIHQgKiB0ICsgMikgLyAyO1xufVxuIiwgImltcG9ydCB7VHJhbnNpdGlvbiwgbmV3SWR9IGZyb20gXCIuLi90cmFuc2l0aW9uL2luZGV4LmpzXCI7XG5pbXBvcnQgc2NoZWR1bGUgZnJvbSBcIi4uL3RyYW5zaXRpb24vc2NoZWR1bGUuanNcIjtcbmltcG9ydCB7ZWFzZUN1YmljSW5PdXR9IGZyb20gXCJkMy1lYXNlXCI7XG5pbXBvcnQge25vd30gZnJvbSBcImQzLXRpbWVyXCI7XG5cbnZhciBkZWZhdWx0VGltaW5nID0ge1xuICB0aW1lOiBudWxsLCAvLyBTZXQgb24gdXNlLlxuICBkZWxheTogMCxcbiAgZHVyYXRpb246IDI1MCxcbiAgZWFzZTogZWFzZUN1YmljSW5PdXRcbn07XG5cbmZ1bmN0aW9uIGluaGVyaXQobm9kZSwgaWQpIHtcbiAgdmFyIHRpbWluZztcbiAgd2hpbGUgKCEodGltaW5nID0gbm9kZS5fX3RyYW5zaXRpb24pIHx8ICEodGltaW5nID0gdGltaW5nW2lkXSkpIHtcbiAgICBpZiAoIShub2RlID0gbm9kZS5wYXJlbnROb2RlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGB0cmFuc2l0aW9uICR7aWR9IG5vdCBmb3VuZGApO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdGltaW5nO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihuYW1lKSB7XG4gIHZhciBpZCxcbiAgICAgIHRpbWluZztcblxuICBpZiAobmFtZSBpbnN0YW5jZW9mIFRyYW5zaXRpb24pIHtcbiAgICBpZCA9IG5hbWUuX2lkLCBuYW1lID0gbmFtZS5fbmFtZTtcbiAgfSBlbHNlIHtcbiAgICBpZCA9IG5ld0lkKCksICh0aW1pbmcgPSBkZWZhdWx0VGltaW5nKS50aW1lID0gbm93KCksIG5hbWUgPSBuYW1lID09IG51bGwgPyBudWxsIDogbmFtZSArIFwiXCI7XG4gIH1cblxuICBmb3IgKHZhciBncm91cHMgPSB0aGlzLl9ncm91cHMsIG0gPSBncm91cHMubGVuZ3RoLCBqID0gMDsgaiA8IG07ICsraikge1xuICAgIGZvciAodmFyIGdyb3VwID0gZ3JvdXBzW2pdLCBuID0gZ3JvdXAubGVuZ3RoLCBub2RlLCBpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgaWYgKG5vZGUgPSBncm91cFtpXSkge1xuICAgICAgICBzY2hlZHVsZShub2RlLCBuYW1lLCBpZCwgaSwgZ3JvdXAsIHRpbWluZyB8fCBpbmhlcml0KG5vZGUsIGlkKSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG5ldyBUcmFuc2l0aW9uKGdyb3VwcywgdGhpcy5fcGFyZW50cywgbmFtZSwgaWQpO1xufVxuIiwgImltcG9ydCB7c2VsZWN0aW9ufSBmcm9tIFwiZDMtc2VsZWN0aW9uXCI7XG5pbXBvcnQgc2VsZWN0aW9uX2ludGVycnVwdCBmcm9tIFwiLi9pbnRlcnJ1cHQuanNcIjtcbmltcG9ydCBzZWxlY3Rpb25fdHJhbnNpdGlvbiBmcm9tIFwiLi90cmFuc2l0aW9uLmpzXCI7XG5cbnNlbGVjdGlvbi5wcm90b3R5cGUuaW50ZXJydXB0ID0gc2VsZWN0aW9uX2ludGVycnVwdDtcbnNlbGVjdGlvbi5wcm90b3R5cGUudHJhbnNpdGlvbiA9IHNlbGVjdGlvbl90cmFuc2l0aW9uO1xuIiwgImltcG9ydCB7ZGlzcGF0Y2h9IGZyb20gXCJkMy1kaXNwYXRjaFwiO1xuaW1wb3J0IHtkcmFnRGlzYWJsZSwgZHJhZ0VuYWJsZX0gZnJvbSBcImQzLWRyYWdcIjtcbmltcG9ydCB7aW50ZXJwb2xhdGV9IGZyb20gXCJkMy1pbnRlcnBvbGF0ZVwiO1xuaW1wb3J0IHtwb2ludGVyLCBzZWxlY3R9IGZyb20gXCJkMy1zZWxlY3Rpb25cIjtcbmltcG9ydCB7aW50ZXJydXB0fSBmcm9tIFwiZDMtdHJhbnNpdGlvblwiO1xuaW1wb3J0IGNvbnN0YW50IGZyb20gXCIuL2NvbnN0YW50LmpzXCI7XG5pbXBvcnQgQnJ1c2hFdmVudCBmcm9tIFwiLi9ldmVudC5qc1wiO1xuaW1wb3J0IG5vZXZlbnQsIHtub3Byb3BhZ2F0aW9ufSBmcm9tIFwiLi9ub2V2ZW50LmpzXCI7XG5cbnZhciBNT0RFX0RSQUcgPSB7bmFtZTogXCJkcmFnXCJ9LFxuICAgIE1PREVfU1BBQ0UgPSB7bmFtZTogXCJzcGFjZVwifSxcbiAgICBNT0RFX0hBTkRMRSA9IHtuYW1lOiBcImhhbmRsZVwifSxcbiAgICBNT0RFX0NFTlRFUiA9IHtuYW1lOiBcImNlbnRlclwifTtcblxuY29uc3Qge2FicywgbWF4LCBtaW59ID0gTWF0aDtcblxuZnVuY3Rpb24gbnVtYmVyMShlKSB7XG4gIHJldHVybiBbK2VbMF0sICtlWzFdXTtcbn1cblxuZnVuY3Rpb24gbnVtYmVyMihlKSB7XG4gIHJldHVybiBbbnVtYmVyMShlWzBdKSwgbnVtYmVyMShlWzFdKV07XG59XG5cbnZhciBYID0ge1xuICBuYW1lOiBcInhcIixcbiAgaGFuZGxlczogW1wid1wiLCBcImVcIl0ubWFwKHR5cGUpLFxuICBpbnB1dDogZnVuY3Rpb24oeCwgZSkgeyByZXR1cm4geCA9PSBudWxsID8gbnVsbCA6IFtbK3hbMF0sIGVbMF1bMV1dLCBbK3hbMV0sIGVbMV1bMV1dXTsgfSxcbiAgb3V0cHV0OiBmdW5jdGlvbih4eSkgeyByZXR1cm4geHkgJiYgW3h5WzBdWzBdLCB4eVsxXVswXV07IH1cbn07XG5cbnZhciBZID0ge1xuICBuYW1lOiBcInlcIixcbiAgaGFuZGxlczogW1wiblwiLCBcInNcIl0ubWFwKHR5cGUpLFxuICBpbnB1dDogZnVuY3Rpb24oeSwgZSkgeyByZXR1cm4geSA9PSBudWxsID8gbnVsbCA6IFtbZVswXVswXSwgK3lbMF1dLCBbZVsxXVswXSwgK3lbMV1dXTsgfSxcbiAgb3V0cHV0OiBmdW5jdGlvbih4eSkgeyByZXR1cm4geHkgJiYgW3h5WzBdWzFdLCB4eVsxXVsxXV07IH1cbn07XG5cbnZhciBYWSA9IHtcbiAgbmFtZTogXCJ4eVwiLFxuICBoYW5kbGVzOiBbXCJuXCIsIFwid1wiLCBcImVcIiwgXCJzXCIsIFwibndcIiwgXCJuZVwiLCBcInN3XCIsIFwic2VcIl0ubWFwKHR5cGUpLFxuICBpbnB1dDogZnVuY3Rpb24oeHkpIHsgcmV0dXJuIHh5ID09IG51bGwgPyBudWxsIDogbnVtYmVyMih4eSk7IH0sXG4gIG91dHB1dDogZnVuY3Rpb24oeHkpIHsgcmV0dXJuIHh5OyB9XG59O1xuXG52YXIgY3Vyc29ycyA9IHtcbiAgb3ZlcmxheTogXCJjcm9zc2hhaXJcIixcbiAgc2VsZWN0aW9uOiBcIm1vdmVcIixcbiAgbjogXCJucy1yZXNpemVcIixcbiAgZTogXCJldy1yZXNpemVcIixcbiAgczogXCJucy1yZXNpemVcIixcbiAgdzogXCJldy1yZXNpemVcIixcbiAgbnc6IFwibndzZS1yZXNpemVcIixcbiAgbmU6IFwibmVzdy1yZXNpemVcIixcbiAgc2U6IFwibndzZS1yZXNpemVcIixcbiAgc3c6IFwibmVzdy1yZXNpemVcIlxufTtcblxudmFyIGZsaXBYID0ge1xuICBlOiBcIndcIixcbiAgdzogXCJlXCIsXG4gIG53OiBcIm5lXCIsXG4gIG5lOiBcIm53XCIsXG4gIHNlOiBcInN3XCIsXG4gIHN3OiBcInNlXCJcbn07XG5cbnZhciBmbGlwWSA9IHtcbiAgbjogXCJzXCIsXG4gIHM6IFwiblwiLFxuICBudzogXCJzd1wiLFxuICBuZTogXCJzZVwiLFxuICBzZTogXCJuZVwiLFxuICBzdzogXCJud1wiXG59O1xuXG52YXIgc2lnbnNYID0ge1xuICBvdmVybGF5OiArMSxcbiAgc2VsZWN0aW9uOiArMSxcbiAgbjogbnVsbCxcbiAgZTogKzEsXG4gIHM6IG51bGwsXG4gIHc6IC0xLFxuICBudzogLTEsXG4gIG5lOiArMSxcbiAgc2U6ICsxLFxuICBzdzogLTFcbn07XG5cbnZhciBzaWduc1kgPSB7XG4gIG92ZXJsYXk6ICsxLFxuICBzZWxlY3Rpb246ICsxLFxuICBuOiAtMSxcbiAgZTogbnVsbCxcbiAgczogKzEsXG4gIHc6IG51bGwsXG4gIG53OiAtMSxcbiAgbmU6IC0xLFxuICBzZTogKzEsXG4gIHN3OiArMVxufTtcblxuZnVuY3Rpb24gdHlwZSh0KSB7XG4gIHJldHVybiB7dHlwZTogdH07XG59XG5cbi8vIElnbm9yZSByaWdodC1jbGljaywgc2luY2UgdGhhdCBzaG91bGQgb3BlbiB0aGUgY29udGV4dCBtZW51LlxuZnVuY3Rpb24gZGVmYXVsdEZpbHRlcihldmVudCkge1xuICByZXR1cm4gIWV2ZW50LmN0cmxLZXkgJiYgIWV2ZW50LmJ1dHRvbjtcbn1cblxuZnVuY3Rpb24gZGVmYXVsdEV4dGVudCgpIHtcbiAgdmFyIHN2ZyA9IHRoaXMub3duZXJTVkdFbGVtZW50IHx8IHRoaXM7XG4gIGlmIChzdmcuaGFzQXR0cmlidXRlKFwidmlld0JveFwiKSkge1xuICAgIHN2ZyA9IHN2Zy52aWV3Qm94LmJhc2VWYWw7XG4gICAgcmV0dXJuIFtbc3ZnLngsIHN2Zy55XSwgW3N2Zy54ICsgc3ZnLndpZHRoLCBzdmcueSArIHN2Zy5oZWlnaHRdXTtcbiAgfVxuICByZXR1cm4gW1swLCAwXSwgW3N2Zy53aWR0aC5iYXNlVmFsLnZhbHVlLCBzdmcuaGVpZ2h0LmJhc2VWYWwudmFsdWVdXTtcbn1cblxuZnVuY3Rpb24gZGVmYXVsdFRvdWNoYWJsZSgpIHtcbiAgcmV0dXJuIG5hdmlnYXRvci5tYXhUb3VjaFBvaW50cyB8fCAoXCJvbnRvdWNoc3RhcnRcIiBpbiB0aGlzKTtcbn1cblxuLy8gTGlrZSBkMy5sb2NhbCwgYnV0IHdpdGggdGhlIG5hbWUgXHUyMDFDX19icnVzaFx1MjAxRCByYXRoZXIgdGhhbiBhdXRvLWdlbmVyYXRlZC5cbmZ1bmN0aW9uIGxvY2FsKG5vZGUpIHtcbiAgd2hpbGUgKCFub2RlLl9fYnJ1c2gpIGlmICghKG5vZGUgPSBub2RlLnBhcmVudE5vZGUpKSByZXR1cm47XG4gIHJldHVybiBub2RlLl9fYnJ1c2g7XG59XG5cbmZ1bmN0aW9uIGVtcHR5KGV4dGVudCkge1xuICByZXR1cm4gZXh0ZW50WzBdWzBdID09PSBleHRlbnRbMV1bMF1cbiAgICAgIHx8IGV4dGVudFswXVsxXSA9PT0gZXh0ZW50WzFdWzFdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYnJ1c2hTZWxlY3Rpb24obm9kZSkge1xuICB2YXIgc3RhdGUgPSBub2RlLl9fYnJ1c2g7XG4gIHJldHVybiBzdGF0ZSA/IHN0YXRlLmRpbS5vdXRwdXQoc3RhdGUuc2VsZWN0aW9uKSA6IG51bGw7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBicnVzaFgoKSB7XG4gIHJldHVybiBicnVzaChYKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJydXNoWSgpIHtcbiAgcmV0dXJuIGJydXNoKFkpO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIGJydXNoKFhZKTtcbn1cblxuZnVuY3Rpb24gYnJ1c2goZGltKSB7XG4gIHZhciBleHRlbnQgPSBkZWZhdWx0RXh0ZW50LFxuICAgICAgZmlsdGVyID0gZGVmYXVsdEZpbHRlcixcbiAgICAgIHRvdWNoYWJsZSA9IGRlZmF1bHRUb3VjaGFibGUsXG4gICAgICBrZXlzID0gdHJ1ZSxcbiAgICAgIGxpc3RlbmVycyA9IGRpc3BhdGNoKFwic3RhcnRcIiwgXCJicnVzaFwiLCBcImVuZFwiKSxcbiAgICAgIGhhbmRsZVNpemUgPSA2LFxuICAgICAgdG91Y2hlbmRpbmc7XG5cbiAgZnVuY3Rpb24gYnJ1c2goZ3JvdXApIHtcbiAgICB2YXIgb3ZlcmxheSA9IGdyb3VwXG4gICAgICAgIC5wcm9wZXJ0eShcIl9fYnJ1c2hcIiwgaW5pdGlhbGl6ZSlcbiAgICAgIC5zZWxlY3RBbGwoXCIub3ZlcmxheVwiKVxuICAgICAgLmRhdGEoW3R5cGUoXCJvdmVybGF5XCIpXSk7XG5cbiAgICBvdmVybGF5LmVudGVyKCkuYXBwZW5kKFwicmVjdFwiKVxuICAgICAgICAuYXR0cihcImNsYXNzXCIsIFwib3ZlcmxheVwiKVxuICAgICAgICAuYXR0cihcInBvaW50ZXItZXZlbnRzXCIsIFwiYWxsXCIpXG4gICAgICAgIC5hdHRyKFwiY3Vyc29yXCIsIGN1cnNvcnMub3ZlcmxheSlcbiAgICAgIC5tZXJnZShvdmVybGF5KVxuICAgICAgICAuZWFjaChmdW5jdGlvbigpIHtcbiAgICAgICAgICB2YXIgZXh0ZW50ID0gbG9jYWwodGhpcykuZXh0ZW50O1xuICAgICAgICAgIHNlbGVjdCh0aGlzKVxuICAgICAgICAgICAgICAuYXR0cihcInhcIiwgZXh0ZW50WzBdWzBdKVxuICAgICAgICAgICAgICAuYXR0cihcInlcIiwgZXh0ZW50WzBdWzFdKVxuICAgICAgICAgICAgICAuYXR0cihcIndpZHRoXCIsIGV4dGVudFsxXVswXSAtIGV4dGVudFswXVswXSlcbiAgICAgICAgICAgICAgLmF0dHIoXCJoZWlnaHRcIiwgZXh0ZW50WzFdWzFdIC0gZXh0ZW50WzBdWzFdKTtcbiAgICAgICAgfSk7XG5cbiAgICBncm91cC5zZWxlY3RBbGwoXCIuc2VsZWN0aW9uXCIpXG4gICAgICAuZGF0YShbdHlwZShcInNlbGVjdGlvblwiKV0pXG4gICAgICAuZW50ZXIoKS5hcHBlbmQoXCJyZWN0XCIpXG4gICAgICAgIC5hdHRyKFwiY2xhc3NcIiwgXCJzZWxlY3Rpb25cIilcbiAgICAgICAgLmF0dHIoXCJjdXJzb3JcIiwgY3Vyc29ycy5zZWxlY3Rpb24pXG4gICAgICAgIC5hdHRyKFwiZmlsbFwiLCBcIiM3NzdcIilcbiAgICAgICAgLmF0dHIoXCJmaWxsLW9wYWNpdHlcIiwgMC4zKVxuICAgICAgICAuYXR0cihcInN0cm9rZVwiLCBcIiNmZmZcIilcbiAgICAgICAgLmF0dHIoXCJzaGFwZS1yZW5kZXJpbmdcIiwgXCJjcmlzcEVkZ2VzXCIpO1xuXG4gICAgdmFyIGhhbmRsZSA9IGdyb3VwLnNlbGVjdEFsbChcIi5oYW5kbGVcIilcbiAgICAgIC5kYXRhKGRpbS5oYW5kbGVzLCBmdW5jdGlvbihkKSB7IHJldHVybiBkLnR5cGU7IH0pO1xuXG4gICAgaGFuZGxlLmV4aXQoKS5yZW1vdmUoKTtcblxuICAgIGhhbmRsZS5lbnRlcigpLmFwcGVuZChcInJlY3RcIilcbiAgICAgICAgLmF0dHIoXCJjbGFzc1wiLCBmdW5jdGlvbihkKSB7IHJldHVybiBcImhhbmRsZSBoYW5kbGUtLVwiICsgZC50eXBlOyB9KVxuICAgICAgICAuYXR0cihcImN1cnNvclwiLCBmdW5jdGlvbihkKSB7IHJldHVybiBjdXJzb3JzW2QudHlwZV07IH0pO1xuXG4gICAgZ3JvdXBcbiAgICAgICAgLmVhY2gocmVkcmF3KVxuICAgICAgICAuYXR0cihcImZpbGxcIiwgXCJub25lXCIpXG4gICAgICAgIC5hdHRyKFwicG9pbnRlci1ldmVudHNcIiwgXCJhbGxcIilcbiAgICAgICAgLm9uKFwibW91c2Vkb3duLmJydXNoXCIsIHN0YXJ0ZWQpXG4gICAgICAuZmlsdGVyKHRvdWNoYWJsZSlcbiAgICAgICAgLm9uKFwidG91Y2hzdGFydC5icnVzaFwiLCBzdGFydGVkKVxuICAgICAgICAub24oXCJ0b3VjaG1vdmUuYnJ1c2hcIiwgdG91Y2htb3ZlZClcbiAgICAgICAgLm9uKFwidG91Y2hlbmQuYnJ1c2ggdG91Y2hjYW5jZWwuYnJ1c2hcIiwgdG91Y2hlbmRlZClcbiAgICAgICAgLnN0eWxlKFwidG91Y2gtYWN0aW9uXCIsIFwibm9uZVwiKVxuICAgICAgICAuc3R5bGUoXCItd2Via2l0LXRhcC1oaWdobGlnaHQtY29sb3JcIiwgXCJyZ2JhKDAsMCwwLDApXCIpO1xuICB9XG5cbiAgYnJ1c2gubW92ZSA9IGZ1bmN0aW9uKGdyb3VwLCBzZWxlY3Rpb24sIGV2ZW50KSB7XG4gICAgaWYgKGdyb3VwLnR3ZWVuKSB7XG4gICAgICBncm91cFxuICAgICAgICAgIC5vbihcInN0YXJ0LmJydXNoXCIsIGZ1bmN0aW9uKGV2ZW50KSB7IGVtaXR0ZXIodGhpcywgYXJndW1lbnRzKS5iZWZvcmVzdGFydCgpLnN0YXJ0KGV2ZW50KTsgfSlcbiAgICAgICAgICAub24oXCJpbnRlcnJ1cHQuYnJ1c2ggZW5kLmJydXNoXCIsIGZ1bmN0aW9uKGV2ZW50KSB7IGVtaXR0ZXIodGhpcywgYXJndW1lbnRzKS5lbmQoZXZlbnQpOyB9KVxuICAgICAgICAgIC50d2VlbihcImJydXNoXCIsIGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdmFyIHRoYXQgPSB0aGlzLFxuICAgICAgICAgICAgICAgIHN0YXRlID0gdGhhdC5fX2JydXNoLFxuICAgICAgICAgICAgICAgIGVtaXQgPSBlbWl0dGVyKHRoYXQsIGFyZ3VtZW50cyksXG4gICAgICAgICAgICAgICAgc2VsZWN0aW9uMCA9IHN0YXRlLnNlbGVjdGlvbixcbiAgICAgICAgICAgICAgICBzZWxlY3Rpb24xID0gZGltLmlucHV0KHR5cGVvZiBzZWxlY3Rpb24gPT09IFwiZnVuY3Rpb25cIiA/IHNlbGVjdGlvbi5hcHBseSh0aGlzLCBhcmd1bWVudHMpIDogc2VsZWN0aW9uLCBzdGF0ZS5leHRlbnQpLFxuICAgICAgICAgICAgICAgIGkgPSBpbnRlcnBvbGF0ZShzZWxlY3Rpb24wLCBzZWxlY3Rpb24xKTtcblxuICAgICAgICAgICAgZnVuY3Rpb24gdHdlZW4odCkge1xuICAgICAgICAgICAgICBzdGF0ZS5zZWxlY3Rpb24gPSB0ID09PSAxICYmIHNlbGVjdGlvbjEgPT09IG51bGwgPyBudWxsIDogaSh0KTtcbiAgICAgICAgICAgICAgcmVkcmF3LmNhbGwodGhhdCk7XG4gICAgICAgICAgICAgIGVtaXQuYnJ1c2goKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHNlbGVjdGlvbjAgIT09IG51bGwgJiYgc2VsZWN0aW9uMSAhPT0gbnVsbCA/IHR3ZWVuIDogdHdlZW4oMSk7XG4gICAgICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGdyb3VwXG4gICAgICAgICAgLmVhY2goZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICB2YXIgdGhhdCA9IHRoaXMsXG4gICAgICAgICAgICAgICAgYXJncyA9IGFyZ3VtZW50cyxcbiAgICAgICAgICAgICAgICBzdGF0ZSA9IHRoYXQuX19icnVzaCxcbiAgICAgICAgICAgICAgICBzZWxlY3Rpb24xID0gZGltLmlucHV0KHR5cGVvZiBzZWxlY3Rpb24gPT09IFwiZnVuY3Rpb25cIiA/IHNlbGVjdGlvbi5hcHBseSh0aGF0LCBhcmdzKSA6IHNlbGVjdGlvbiwgc3RhdGUuZXh0ZW50KSxcbiAgICAgICAgICAgICAgICBlbWl0ID0gZW1pdHRlcih0aGF0LCBhcmdzKS5iZWZvcmVzdGFydCgpO1xuXG4gICAgICAgICAgICBpbnRlcnJ1cHQodGhhdCk7XG4gICAgICAgICAgICBzdGF0ZS5zZWxlY3Rpb24gPSBzZWxlY3Rpb24xID09PSBudWxsID8gbnVsbCA6IHNlbGVjdGlvbjE7XG4gICAgICAgICAgICByZWRyYXcuY2FsbCh0aGF0KTtcbiAgICAgICAgICAgIGVtaXQuc3RhcnQoZXZlbnQpLmJydXNoKGV2ZW50KS5lbmQoZXZlbnQpO1xuICAgICAgICAgIH0pO1xuICAgIH1cbiAgfTtcblxuICBicnVzaC5jbGVhciA9IGZ1bmN0aW9uKGdyb3VwLCBldmVudCkge1xuICAgIGJydXNoLm1vdmUoZ3JvdXAsIG51bGwsIGV2ZW50KTtcbiAgfTtcblxuICBmdW5jdGlvbiByZWRyYXcoKSB7XG4gICAgdmFyIGdyb3VwID0gc2VsZWN0KHRoaXMpLFxuICAgICAgICBzZWxlY3Rpb24gPSBsb2NhbCh0aGlzKS5zZWxlY3Rpb247XG5cbiAgICBpZiAoc2VsZWN0aW9uKSB7XG4gICAgICBncm91cC5zZWxlY3RBbGwoXCIuc2VsZWN0aW9uXCIpXG4gICAgICAgICAgLnN0eWxlKFwiZGlzcGxheVwiLCBudWxsKVxuICAgICAgICAgIC5hdHRyKFwieFwiLCBzZWxlY3Rpb25bMF1bMF0pXG4gICAgICAgICAgLmF0dHIoXCJ5XCIsIHNlbGVjdGlvblswXVsxXSlcbiAgICAgICAgICAuYXR0cihcIndpZHRoXCIsIHNlbGVjdGlvblsxXVswXSAtIHNlbGVjdGlvblswXVswXSlcbiAgICAgICAgICAuYXR0cihcImhlaWdodFwiLCBzZWxlY3Rpb25bMV1bMV0gLSBzZWxlY3Rpb25bMF1bMV0pO1xuXG4gICAgICBncm91cC5zZWxlY3RBbGwoXCIuaGFuZGxlXCIpXG4gICAgICAgICAgLnN0eWxlKFwiZGlzcGxheVwiLCBudWxsKVxuICAgICAgICAgIC5hdHRyKFwieFwiLCBmdW5jdGlvbihkKSB7IHJldHVybiBkLnR5cGVbZC50eXBlLmxlbmd0aCAtIDFdID09PSBcImVcIiA/IHNlbGVjdGlvblsxXVswXSAtIGhhbmRsZVNpemUgLyAyIDogc2VsZWN0aW9uWzBdWzBdIC0gaGFuZGxlU2l6ZSAvIDI7IH0pXG4gICAgICAgICAgLmF0dHIoXCJ5XCIsIGZ1bmN0aW9uKGQpIHsgcmV0dXJuIGQudHlwZVswXSA9PT0gXCJzXCIgPyBzZWxlY3Rpb25bMV1bMV0gLSBoYW5kbGVTaXplIC8gMiA6IHNlbGVjdGlvblswXVsxXSAtIGhhbmRsZVNpemUgLyAyOyB9KVxuICAgICAgICAgIC5hdHRyKFwid2lkdGhcIiwgZnVuY3Rpb24oZCkgeyByZXR1cm4gZC50eXBlID09PSBcIm5cIiB8fCBkLnR5cGUgPT09IFwic1wiID8gc2VsZWN0aW9uWzFdWzBdIC0gc2VsZWN0aW9uWzBdWzBdICsgaGFuZGxlU2l6ZSA6IGhhbmRsZVNpemU7IH0pXG4gICAgICAgICAgLmF0dHIoXCJoZWlnaHRcIiwgZnVuY3Rpb24oZCkgeyByZXR1cm4gZC50eXBlID09PSBcImVcIiB8fCBkLnR5cGUgPT09IFwid1wiID8gc2VsZWN0aW9uWzFdWzFdIC0gc2VsZWN0aW9uWzBdWzFdICsgaGFuZGxlU2l6ZSA6IGhhbmRsZVNpemU7IH0pO1xuICAgIH1cblxuICAgIGVsc2Uge1xuICAgICAgZ3JvdXAuc2VsZWN0QWxsKFwiLnNlbGVjdGlvbiwuaGFuZGxlXCIpXG4gICAgICAgICAgLnN0eWxlKFwiZGlzcGxheVwiLCBcIm5vbmVcIilcbiAgICAgICAgICAuYXR0cihcInhcIiwgbnVsbClcbiAgICAgICAgICAuYXR0cihcInlcIiwgbnVsbClcbiAgICAgICAgICAuYXR0cihcIndpZHRoXCIsIG51bGwpXG4gICAgICAgICAgLmF0dHIoXCJoZWlnaHRcIiwgbnVsbCk7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gZW1pdHRlcih0aGF0LCBhcmdzLCBjbGVhbikge1xuICAgIHZhciBlbWl0ID0gdGhhdC5fX2JydXNoLmVtaXR0ZXI7XG4gICAgcmV0dXJuIGVtaXQgJiYgKCFjbGVhbiB8fCAhZW1pdC5jbGVhbikgPyBlbWl0IDogbmV3IEVtaXR0ZXIodGhhdCwgYXJncywgY2xlYW4pO1xuICB9XG5cbiAgZnVuY3Rpb24gRW1pdHRlcih0aGF0LCBhcmdzLCBjbGVhbikge1xuICAgIHRoaXMudGhhdCA9IHRoYXQ7XG4gICAgdGhpcy5hcmdzID0gYXJncztcbiAgICB0aGlzLnN0YXRlID0gdGhhdC5fX2JydXNoO1xuICAgIHRoaXMuYWN0aXZlID0gMDtcbiAgICB0aGlzLmNsZWFuID0gY2xlYW47XG4gIH1cblxuICBFbWl0dGVyLnByb3RvdHlwZSA9IHtcbiAgICBiZWZvcmVzdGFydDogZnVuY3Rpb24oKSB7XG4gICAgICBpZiAoKyt0aGlzLmFjdGl2ZSA9PT0gMSkgdGhpcy5zdGF0ZS5lbWl0dGVyID0gdGhpcywgdGhpcy5zdGFydGluZyA9IHRydWU7XG4gICAgICByZXR1cm4gdGhpcztcbiAgICB9LFxuICAgIHN0YXJ0OiBmdW5jdGlvbihldmVudCwgbW9kZSkge1xuICAgICAgaWYgKHRoaXMuc3RhcnRpbmcpIHRoaXMuc3RhcnRpbmcgPSBmYWxzZSwgdGhpcy5lbWl0KFwic3RhcnRcIiwgZXZlbnQsIG1vZGUpO1xuICAgICAgZWxzZSB0aGlzLmVtaXQoXCJicnVzaFwiLCBldmVudCk7XG4gICAgICByZXR1cm4gdGhpcztcbiAgICB9LFxuICAgIGJydXNoOiBmdW5jdGlvbihldmVudCwgbW9kZSkge1xuICAgICAgdGhpcy5lbWl0KFwiYnJ1c2hcIiwgZXZlbnQsIG1vZGUpO1xuICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfSxcbiAgICBlbmQ6IGZ1bmN0aW9uKGV2ZW50LCBtb2RlKSB7XG4gICAgICBpZiAoLS10aGlzLmFjdGl2ZSA9PT0gMCkgZGVsZXRlIHRoaXMuc3RhdGUuZW1pdHRlciwgdGhpcy5lbWl0KFwiZW5kXCIsIGV2ZW50LCBtb2RlKTtcbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH0sXG4gICAgZW1pdDogZnVuY3Rpb24odHlwZSwgZXZlbnQsIG1vZGUpIHtcbiAgICAgIHZhciBkID0gc2VsZWN0KHRoaXMudGhhdCkuZGF0dW0oKTtcbiAgICAgIGxpc3RlbmVycy5jYWxsKFxuICAgICAgICB0eXBlLFxuICAgICAgICB0aGlzLnRoYXQsXG4gICAgICAgIG5ldyBCcnVzaEV2ZW50KHR5cGUsIHtcbiAgICAgICAgICBzb3VyY2VFdmVudDogZXZlbnQsXG4gICAgICAgICAgdGFyZ2V0OiBicnVzaCxcbiAgICAgICAgICBzZWxlY3Rpb246IGRpbS5vdXRwdXQodGhpcy5zdGF0ZS5zZWxlY3Rpb24pLFxuICAgICAgICAgIG1vZGUsXG4gICAgICAgICAgZGlzcGF0Y2g6IGxpc3RlbmVyc1xuICAgICAgICB9KSxcbiAgICAgICAgZFxuICAgICAgKTtcbiAgICB9XG4gIH07XG5cbiAgZnVuY3Rpb24gc3RhcnRlZChldmVudCkge1xuICAgIGlmICh0b3VjaGVuZGluZyAmJiAhZXZlbnQudG91Y2hlcykgcmV0dXJuO1xuICAgIGlmICghZmlsdGVyLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykpIHJldHVybjtcblxuICAgIHZhciB0aGF0ID0gdGhpcyxcbiAgICAgICAgdHlwZSA9IGV2ZW50LnRhcmdldC5fX2RhdGFfXy50eXBlLFxuICAgICAgICBtb2RlID0gKGtleXMgJiYgZXZlbnQubWV0YUtleSA/IHR5cGUgPSBcIm92ZXJsYXlcIiA6IHR5cGUpID09PSBcInNlbGVjdGlvblwiID8gTU9ERV9EUkFHIDogKGtleXMgJiYgZXZlbnQuYWx0S2V5ID8gTU9ERV9DRU5URVIgOiBNT0RFX0hBTkRMRSksXG4gICAgICAgIHNpZ25YID0gZGltID09PSBZID8gbnVsbCA6IHNpZ25zWFt0eXBlXSxcbiAgICAgICAgc2lnblkgPSBkaW0gPT09IFggPyBudWxsIDogc2lnbnNZW3R5cGVdLFxuICAgICAgICBzdGF0ZSA9IGxvY2FsKHRoYXQpLFxuICAgICAgICBleHRlbnQgPSBzdGF0ZS5leHRlbnQsXG4gICAgICAgIHNlbGVjdGlvbiA9IHN0YXRlLnNlbGVjdGlvbixcbiAgICAgICAgVyA9IGV4dGVudFswXVswXSwgdzAsIHcxLFxuICAgICAgICBOID0gZXh0ZW50WzBdWzFdLCBuMCwgbjEsXG4gICAgICAgIEUgPSBleHRlbnRbMV1bMF0sIGUwLCBlMSxcbiAgICAgICAgUyA9IGV4dGVudFsxXVsxXSwgczAsIHMxLFxuICAgICAgICBkeCA9IDAsXG4gICAgICAgIGR5ID0gMCxcbiAgICAgICAgbW92aW5nLFxuICAgICAgICBzaGlmdGluZyA9IHNpZ25YICYmIHNpZ25ZICYmIGtleXMgJiYgZXZlbnQuc2hpZnRLZXksXG4gICAgICAgIGxvY2tYLFxuICAgICAgICBsb2NrWSxcbiAgICAgICAgcG9pbnRzID0gQXJyYXkuZnJvbShldmVudC50b3VjaGVzIHx8IFtldmVudF0sIHQgPT4ge1xuICAgICAgICAgIGNvbnN0IGkgPSB0LmlkZW50aWZpZXI7XG4gICAgICAgICAgdCA9IHBvaW50ZXIodCwgdGhhdCk7XG4gICAgICAgICAgdC5wb2ludDAgPSB0LnNsaWNlKCk7XG4gICAgICAgICAgdC5pZGVudGlmaWVyID0gaTtcbiAgICAgICAgICByZXR1cm4gdDtcbiAgICAgICAgfSk7XG5cbiAgICBpbnRlcnJ1cHQodGhhdCk7XG4gICAgdmFyIGVtaXQgPSBlbWl0dGVyKHRoYXQsIGFyZ3VtZW50cywgdHJ1ZSkuYmVmb3Jlc3RhcnQoKTtcblxuICAgIGlmICh0eXBlID09PSBcIm92ZXJsYXlcIikge1xuICAgICAgaWYgKHNlbGVjdGlvbikgbW92aW5nID0gdHJ1ZTtcbiAgICAgIGNvbnN0IHB0cyA9IFtwb2ludHNbMF0sIHBvaW50c1sxXSB8fCBwb2ludHNbMF1dO1xuICAgICAgc3RhdGUuc2VsZWN0aW9uID0gc2VsZWN0aW9uID0gW1tcbiAgICAgICAgICB3MCA9IGRpbSA9PT0gWSA/IFcgOiBtaW4ocHRzWzBdWzBdLCBwdHNbMV1bMF0pLFxuICAgICAgICAgIG4wID0gZGltID09PSBYID8gTiA6IG1pbihwdHNbMF1bMV0sIHB0c1sxXVsxXSlcbiAgICAgICAgXSwgW1xuICAgICAgICAgIGUwID0gZGltID09PSBZID8gRSA6IG1heChwdHNbMF1bMF0sIHB0c1sxXVswXSksXG4gICAgICAgICAgczAgPSBkaW0gPT09IFggPyBTIDogbWF4KHB0c1swXVsxXSwgcHRzWzFdWzFdKVxuICAgICAgICBdXTtcbiAgICAgIGlmIChwb2ludHMubGVuZ3RoID4gMSkgbW92ZShldmVudCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHcwID0gc2VsZWN0aW9uWzBdWzBdO1xuICAgICAgbjAgPSBzZWxlY3Rpb25bMF1bMV07XG4gICAgICBlMCA9IHNlbGVjdGlvblsxXVswXTtcbiAgICAgIHMwID0gc2VsZWN0aW9uWzFdWzFdO1xuICAgIH1cblxuICAgIHcxID0gdzA7XG4gICAgbjEgPSBuMDtcbiAgICBlMSA9IGUwO1xuICAgIHMxID0gczA7XG5cbiAgICB2YXIgZ3JvdXAgPSBzZWxlY3QodGhhdClcbiAgICAgICAgLmF0dHIoXCJwb2ludGVyLWV2ZW50c1wiLCBcIm5vbmVcIik7XG5cbiAgICB2YXIgb3ZlcmxheSA9IGdyb3VwLnNlbGVjdEFsbChcIi5vdmVybGF5XCIpXG4gICAgICAgIC5hdHRyKFwiY3Vyc29yXCIsIGN1cnNvcnNbdHlwZV0pO1xuXG4gICAgaWYgKGV2ZW50LnRvdWNoZXMpIHtcbiAgICAgIGVtaXQubW92ZWQgPSBtb3ZlZDtcbiAgICAgIGVtaXQuZW5kZWQgPSBlbmRlZDtcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIHZpZXcgPSBzZWxlY3QoZXZlbnQudmlldylcbiAgICAgICAgICAub24oXCJtb3VzZW1vdmUuYnJ1c2hcIiwgbW92ZWQsIHRydWUpXG4gICAgICAgICAgLm9uKFwibW91c2V1cC5icnVzaFwiLCBlbmRlZCwgdHJ1ZSk7XG4gICAgICBpZiAoa2V5cykgdmlld1xuICAgICAgICAgIC5vbihcImtleWRvd24uYnJ1c2hcIiwga2V5ZG93bmVkLCB0cnVlKVxuICAgICAgICAgIC5vbihcImtleXVwLmJydXNoXCIsIGtleXVwcGVkLCB0cnVlKVxuXG4gICAgICBkcmFnRGlzYWJsZShldmVudC52aWV3KTtcbiAgICB9XG5cbiAgICByZWRyYXcuY2FsbCh0aGF0KTtcbiAgICBlbWl0LnN0YXJ0KGV2ZW50LCBtb2RlLm5hbWUpO1xuXG4gICAgZnVuY3Rpb24gbW92ZWQoZXZlbnQpIHtcbiAgICAgIGZvciAoY29uc3QgcCBvZiBldmVudC5jaGFuZ2VkVG91Y2hlcyB8fCBbZXZlbnRdKSB7XG4gICAgICAgIGZvciAoY29uc3QgZCBvZiBwb2ludHMpXG4gICAgICAgICAgaWYgKGQuaWRlbnRpZmllciA9PT0gcC5pZGVudGlmaWVyKSBkLmN1ciA9IHBvaW50ZXIocCwgdGhhdCk7XG4gICAgICB9XG4gICAgICBpZiAoc2hpZnRpbmcgJiYgIWxvY2tYICYmICFsb2NrWSAmJiBwb2ludHMubGVuZ3RoID09PSAxKSB7XG4gICAgICAgIGNvbnN0IHBvaW50ID0gcG9pbnRzWzBdO1xuICAgICAgICBpZiAoYWJzKHBvaW50LmN1clswXSAtIHBvaW50WzBdKSA+IGFicyhwb2ludC5jdXJbMV0gLSBwb2ludFsxXSkpXG4gICAgICAgICAgbG9ja1kgPSB0cnVlO1xuICAgICAgICBlbHNlXG4gICAgICAgICAgbG9ja1ggPSB0cnVlO1xuICAgICAgfVxuICAgICAgZm9yIChjb25zdCBwb2ludCBvZiBwb2ludHMpXG4gICAgICAgIGlmIChwb2ludC5jdXIpIHBvaW50WzBdID0gcG9pbnQuY3VyWzBdLCBwb2ludFsxXSA9IHBvaW50LmN1clsxXTtcbiAgICAgIG1vdmluZyA9IHRydWU7XG4gICAgICBub2V2ZW50KGV2ZW50KTtcbiAgICAgIG1vdmUoZXZlbnQpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG1vdmUoZXZlbnQpIHtcbiAgICAgIGNvbnN0IHBvaW50ID0gcG9pbnRzWzBdLCBwb2ludDAgPSBwb2ludC5wb2ludDA7XG4gICAgICB2YXIgdDtcblxuICAgICAgZHggPSBwb2ludFswXSAtIHBvaW50MFswXTtcbiAgICAgIGR5ID0gcG9pbnRbMV0gLSBwb2ludDBbMV07XG5cbiAgICAgIHN3aXRjaCAobW9kZSkge1xuICAgICAgICBjYXNlIE1PREVfU1BBQ0U6XG4gICAgICAgIGNhc2UgTU9ERV9EUkFHOiB7XG4gICAgICAgICAgaWYgKHNpZ25YKSBkeCA9IG1heChXIC0gdzAsIG1pbihFIC0gZTAsIGR4KSksIHcxID0gdzAgKyBkeCwgZTEgPSBlMCArIGR4O1xuICAgICAgICAgIGlmIChzaWduWSkgZHkgPSBtYXgoTiAtIG4wLCBtaW4oUyAtIHMwLCBkeSkpLCBuMSA9IG4wICsgZHksIHMxID0gczAgKyBkeTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjYXNlIE1PREVfSEFORExFOiB7XG4gICAgICAgICAgaWYgKHBvaW50c1sxXSkge1xuICAgICAgICAgICAgaWYgKHNpZ25YKSB3MSA9IG1heChXLCBtaW4oRSwgcG9pbnRzWzBdWzBdKSksIGUxID0gbWF4KFcsIG1pbihFLCBwb2ludHNbMV1bMF0pKSwgc2lnblggPSAxO1xuICAgICAgICAgICAgaWYgKHNpZ25ZKSBuMSA9IG1heChOLCBtaW4oUywgcG9pbnRzWzBdWzFdKSksIHMxID0gbWF4KE4sIG1pbihTLCBwb2ludHNbMV1bMV0pKSwgc2lnblkgPSAxO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpZiAoc2lnblggPCAwKSBkeCA9IG1heChXIC0gdzAsIG1pbihFIC0gdzAsIGR4KSksIHcxID0gdzAgKyBkeCwgZTEgPSBlMDtcbiAgICAgICAgICAgIGVsc2UgaWYgKHNpZ25YID4gMCkgZHggPSBtYXgoVyAtIGUwLCBtaW4oRSAtIGUwLCBkeCkpLCB3MSA9IHcwLCBlMSA9IGUwICsgZHg7XG4gICAgICAgICAgICBpZiAoc2lnblkgPCAwKSBkeSA9IG1heChOIC0gbjAsIG1pbihTIC0gbjAsIGR5KSksIG4xID0gbjAgKyBkeSwgczEgPSBzMDtcbiAgICAgICAgICAgIGVsc2UgaWYgKHNpZ25ZID4gMCkgZHkgPSBtYXgoTiAtIHMwLCBtaW4oUyAtIHMwLCBkeSkpLCBuMSA9IG4wLCBzMSA9IHMwICsgZHk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGNhc2UgTU9ERV9DRU5URVI6IHtcbiAgICAgICAgICBpZiAoc2lnblgpIHcxID0gbWF4KFcsIG1pbihFLCB3MCAtIGR4ICogc2lnblgpKSwgZTEgPSBtYXgoVywgbWluKEUsIGUwICsgZHggKiBzaWduWCkpO1xuICAgICAgICAgIGlmIChzaWduWSkgbjEgPSBtYXgoTiwgbWluKFMsIG4wIC0gZHkgKiBzaWduWSkpLCBzMSA9IG1heChOLCBtaW4oUywgczAgKyBkeSAqIHNpZ25ZKSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKGUxIDwgdzEpIHtcbiAgICAgICAgc2lnblggKj0gLTE7XG4gICAgICAgIHQgPSB3MCwgdzAgPSBlMCwgZTAgPSB0O1xuICAgICAgICB0ID0gdzEsIHcxID0gZTEsIGUxID0gdDtcbiAgICAgICAgaWYgKHR5cGUgaW4gZmxpcFgpIG92ZXJsYXkuYXR0cihcImN1cnNvclwiLCBjdXJzb3JzW3R5cGUgPSBmbGlwWFt0eXBlXV0pO1xuICAgICAgfVxuXG4gICAgICBpZiAoczEgPCBuMSkge1xuICAgICAgICBzaWduWSAqPSAtMTtcbiAgICAgICAgdCA9IG4wLCBuMCA9IHMwLCBzMCA9IHQ7XG4gICAgICAgIHQgPSBuMSwgbjEgPSBzMSwgczEgPSB0O1xuICAgICAgICBpZiAodHlwZSBpbiBmbGlwWSkgb3ZlcmxheS5hdHRyKFwiY3Vyc29yXCIsIGN1cnNvcnNbdHlwZSA9IGZsaXBZW3R5cGVdXSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChzdGF0ZS5zZWxlY3Rpb24pIHNlbGVjdGlvbiA9IHN0YXRlLnNlbGVjdGlvbjsgLy8gTWF5IGJlIHNldCBieSBicnVzaC5tb3ZlIVxuICAgICAgaWYgKGxvY2tYKSB3MSA9IHNlbGVjdGlvblswXVswXSwgZTEgPSBzZWxlY3Rpb25bMV1bMF07XG4gICAgICBpZiAobG9ja1kpIG4xID0gc2VsZWN0aW9uWzBdWzFdLCBzMSA9IHNlbGVjdGlvblsxXVsxXTtcblxuICAgICAgaWYgKHNlbGVjdGlvblswXVswXSAhPT0gdzFcbiAgICAgICAgICB8fCBzZWxlY3Rpb25bMF1bMV0gIT09IG4xXG4gICAgICAgICAgfHwgc2VsZWN0aW9uWzFdWzBdICE9PSBlMVxuICAgICAgICAgIHx8IHNlbGVjdGlvblsxXVsxXSAhPT0gczEpIHtcbiAgICAgICAgc3RhdGUuc2VsZWN0aW9uID0gW1t3MSwgbjFdLCBbZTEsIHMxXV07XG4gICAgICAgIHJlZHJhdy5jYWxsKHRoYXQpO1xuICAgICAgICBlbWl0LmJydXNoKGV2ZW50LCBtb2RlLm5hbWUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGVuZGVkKGV2ZW50KSB7XG4gICAgICBub3Byb3BhZ2F0aW9uKGV2ZW50KTtcbiAgICAgIGlmIChldmVudC50b3VjaGVzKSB7XG4gICAgICAgIGlmIChldmVudC50b3VjaGVzLmxlbmd0aCkgcmV0dXJuO1xuICAgICAgICBpZiAodG91Y2hlbmRpbmcpIGNsZWFyVGltZW91dCh0b3VjaGVuZGluZyk7XG4gICAgICAgIHRvdWNoZW5kaW5nID0gc2V0VGltZW91dChmdW5jdGlvbigpIHsgdG91Y2hlbmRpbmcgPSBudWxsOyB9LCA1MDApOyAvLyBHaG9zdCBjbGlja3MgYXJlIGRlbGF5ZWQhXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkcmFnRW5hYmxlKGV2ZW50LnZpZXcsIG1vdmluZyk7XG4gICAgICAgIHZpZXcub24oXCJrZXlkb3duLmJydXNoIGtleXVwLmJydXNoIG1vdXNlbW92ZS5icnVzaCBtb3VzZXVwLmJydXNoXCIsIG51bGwpO1xuICAgICAgfVxuICAgICAgZ3JvdXAuYXR0cihcInBvaW50ZXItZXZlbnRzXCIsIFwiYWxsXCIpO1xuICAgICAgb3ZlcmxheS5hdHRyKFwiY3Vyc29yXCIsIGN1cnNvcnMub3ZlcmxheSk7XG4gICAgICBpZiAoc3RhdGUuc2VsZWN0aW9uKSBzZWxlY3Rpb24gPSBzdGF0ZS5zZWxlY3Rpb247IC8vIE1heSBiZSBzZXQgYnkgYnJ1c2gubW92ZSAob24gc3RhcnQpIVxuICAgICAgaWYgKGVtcHR5KHNlbGVjdGlvbikpIHN0YXRlLnNlbGVjdGlvbiA9IG51bGwsIHJlZHJhdy5jYWxsKHRoYXQpO1xuICAgICAgZW1pdC5lbmQoZXZlbnQsIG1vZGUubmFtZSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24ga2V5ZG93bmVkKGV2ZW50KSB7XG4gICAgICBzd2l0Y2ggKGV2ZW50LmtleUNvZGUpIHtcbiAgICAgICAgY2FzZSAxNjogeyAvLyBTSElGVFxuICAgICAgICAgIHNoaWZ0aW5nID0gc2lnblggJiYgc2lnblk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgY2FzZSAxODogeyAvLyBBTFRcbiAgICAgICAgICBpZiAobW9kZSA9PT0gTU9ERV9IQU5ETEUpIHtcbiAgICAgICAgICAgIGlmIChzaWduWCkgZTAgPSBlMSAtIGR4ICogc2lnblgsIHcwID0gdzEgKyBkeCAqIHNpZ25YO1xuICAgICAgICAgICAgaWYgKHNpZ25ZKSBzMCA9IHMxIC0gZHkgKiBzaWduWSwgbjAgPSBuMSArIGR5ICogc2lnblk7XG4gICAgICAgICAgICBtb2RlID0gTU9ERV9DRU5URVI7XG4gICAgICAgICAgICBtb3ZlKGV2ZW50KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgY2FzZSAzMjogeyAvLyBTUEFDRTsgdGFrZXMgcHJpb3JpdHkgb3ZlciBBTFRcbiAgICAgICAgICBpZiAobW9kZSA9PT0gTU9ERV9IQU5ETEUgfHwgbW9kZSA9PT0gTU9ERV9DRU5URVIpIHtcbiAgICAgICAgICAgIGlmIChzaWduWCA8IDApIGUwID0gZTEgLSBkeDsgZWxzZSBpZiAoc2lnblggPiAwKSB3MCA9IHcxIC0gZHg7XG4gICAgICAgICAgICBpZiAoc2lnblkgPCAwKSBzMCA9IHMxIC0gZHk7IGVsc2UgaWYgKHNpZ25ZID4gMCkgbjAgPSBuMSAtIGR5O1xuICAgICAgICAgICAgbW9kZSA9IE1PREVfU1BBQ0U7XG4gICAgICAgICAgICBvdmVybGF5LmF0dHIoXCJjdXJzb3JcIiwgY3Vyc29ycy5zZWxlY3Rpb24pO1xuICAgICAgICAgICAgbW92ZShldmVudCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGRlZmF1bHQ6IHJldHVybjtcbiAgICAgIH1cbiAgICAgIG5vZXZlbnQoZXZlbnQpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGtleXVwcGVkKGV2ZW50KSB7XG4gICAgICBzd2l0Y2ggKGV2ZW50LmtleUNvZGUpIHtcbiAgICAgICAgY2FzZSAxNjogeyAvLyBTSElGVFxuICAgICAgICAgIGlmIChzaGlmdGluZykge1xuICAgICAgICAgICAgbG9ja1ggPSBsb2NrWSA9IHNoaWZ0aW5nID0gZmFsc2U7XG4gICAgICAgICAgICBtb3ZlKGV2ZW50KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgY2FzZSAxODogeyAvLyBBTFRcbiAgICAgICAgICBpZiAobW9kZSA9PT0gTU9ERV9DRU5URVIpIHtcbiAgICAgICAgICAgIGlmIChzaWduWCA8IDApIGUwID0gZTE7IGVsc2UgaWYgKHNpZ25YID4gMCkgdzAgPSB3MTtcbiAgICAgICAgICAgIGlmIChzaWduWSA8IDApIHMwID0gczE7IGVsc2UgaWYgKHNpZ25ZID4gMCkgbjAgPSBuMTtcbiAgICAgICAgICAgIG1vZGUgPSBNT0RFX0hBTkRMRTtcbiAgICAgICAgICAgIG1vdmUoZXZlbnQpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjYXNlIDMyOiB7IC8vIFNQQUNFXG4gICAgICAgICAgaWYgKG1vZGUgPT09IE1PREVfU1BBQ0UpIHtcbiAgICAgICAgICAgIGlmIChldmVudC5hbHRLZXkpIHtcbiAgICAgICAgICAgICAgaWYgKHNpZ25YKSBlMCA9IGUxIC0gZHggKiBzaWduWCwgdzAgPSB3MSArIGR4ICogc2lnblg7XG4gICAgICAgICAgICAgIGlmIChzaWduWSkgczAgPSBzMSAtIGR5ICogc2lnblksIG4wID0gbjEgKyBkeSAqIHNpZ25ZO1xuICAgICAgICAgICAgICBtb2RlID0gTU9ERV9DRU5URVI7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBpZiAoc2lnblggPCAwKSBlMCA9IGUxOyBlbHNlIGlmIChzaWduWCA+IDApIHcwID0gdzE7XG4gICAgICAgICAgICAgIGlmIChzaWduWSA8IDApIHMwID0gczE7IGVsc2UgaWYgKHNpZ25ZID4gMCkgbjAgPSBuMTtcbiAgICAgICAgICAgICAgbW9kZSA9IE1PREVfSEFORExFO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgb3ZlcmxheS5hdHRyKFwiY3Vyc29yXCIsIGN1cnNvcnNbdHlwZV0pO1xuICAgICAgICAgICAgbW92ZShldmVudCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGRlZmF1bHQ6IHJldHVybjtcbiAgICAgIH1cbiAgICAgIG5vZXZlbnQoZXZlbnQpO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHRvdWNobW92ZWQoZXZlbnQpIHtcbiAgICBlbWl0dGVyKHRoaXMsIGFyZ3VtZW50cykubW92ZWQoZXZlbnQpO1xuICB9XG5cbiAgZnVuY3Rpb24gdG91Y2hlbmRlZChldmVudCkge1xuICAgIGVtaXR0ZXIodGhpcywgYXJndW1lbnRzKS5lbmRlZChldmVudCk7XG4gIH1cblxuICBmdW5jdGlvbiBpbml0aWFsaXplKCkge1xuICAgIHZhciBzdGF0ZSA9IHRoaXMuX19icnVzaCB8fCB7c2VsZWN0aW9uOiBudWxsfTtcbiAgICBzdGF0ZS5leHRlbnQgPSBudW1iZXIyKGV4dGVudC5hcHBseSh0aGlzLCBhcmd1bWVudHMpKTtcbiAgICBzdGF0ZS5kaW0gPSBkaW07XG4gICAgcmV0dXJuIHN0YXRlO1xuICB9XG5cbiAgYnJ1c2guZXh0ZW50ID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGV4dGVudCA9IHR5cGVvZiBfID09PSBcImZ1bmN0aW9uXCIgPyBfIDogY29uc3RhbnQobnVtYmVyMihfKSksIGJydXNoKSA6IGV4dGVudDtcbiAgfTtcblxuICBicnVzaC5maWx0ZXIgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoZmlsdGVyID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudCghIV8pLCBicnVzaCkgOiBmaWx0ZXI7XG4gIH07XG5cbiAgYnJ1c2gudG91Y2hhYmxlID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHRvdWNoYWJsZSA9IHR5cGVvZiBfID09PSBcImZ1bmN0aW9uXCIgPyBfIDogY29uc3RhbnQoISFfKSwgYnJ1c2gpIDogdG91Y2hhYmxlO1xuICB9O1xuXG4gIGJydXNoLmhhbmRsZVNpemUgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoaGFuZGxlU2l6ZSA9ICtfLCBicnVzaCkgOiBoYW5kbGVTaXplO1xuICB9O1xuXG4gIGJydXNoLmtleU1vZGlmaWVycyA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChrZXlzID0gISFfLCBicnVzaCkgOiBrZXlzO1xuICB9O1xuXG4gIGJydXNoLm9uID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHZhbHVlID0gbGlzdGVuZXJzLm9uLmFwcGx5KGxpc3RlbmVycywgYXJndW1lbnRzKTtcbiAgICByZXR1cm4gdmFsdWUgPT09IGxpc3RlbmVycyA/IGJydXNoIDogdmFsdWU7XG4gIH07XG5cbiAgcmV0dXJuIGJydXNoO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGQpIHtcbiAgY29uc3QgeCA9ICt0aGlzLl94LmNhbGwobnVsbCwgZCksXG4gICAgICB5ID0gK3RoaXMuX3kuY2FsbChudWxsLCBkKTtcbiAgcmV0dXJuIGFkZCh0aGlzLmNvdmVyKHgsIHkpLCB4LCB5LCBkKTtcbn1cblxuZnVuY3Rpb24gYWRkKHRyZWUsIHgsIHksIGQpIHtcbiAgaWYgKGlzTmFOKHgpIHx8IGlzTmFOKHkpKSByZXR1cm4gdHJlZTsgLy8gaWdub3JlIGludmFsaWQgcG9pbnRzXG5cbiAgdmFyIHBhcmVudCxcbiAgICAgIG5vZGUgPSB0cmVlLl9yb290LFxuICAgICAgbGVhZiA9IHtkYXRhOiBkfSxcbiAgICAgIHgwID0gdHJlZS5feDAsXG4gICAgICB5MCA9IHRyZWUuX3kwLFxuICAgICAgeDEgPSB0cmVlLl94MSxcbiAgICAgIHkxID0gdHJlZS5feTEsXG4gICAgICB4bSxcbiAgICAgIHltLFxuICAgICAgeHAsXG4gICAgICB5cCxcbiAgICAgIHJpZ2h0LFxuICAgICAgYm90dG9tLFxuICAgICAgaSxcbiAgICAgIGo7XG5cbiAgLy8gSWYgdGhlIHRyZWUgaXMgZW1wdHksIGluaXRpYWxpemUgdGhlIHJvb3QgYXMgYSBsZWFmLlxuICBpZiAoIW5vZGUpIHJldHVybiB0cmVlLl9yb290ID0gbGVhZiwgdHJlZTtcblxuICAvLyBGaW5kIHRoZSBleGlzdGluZyBsZWFmIGZvciB0aGUgbmV3IHBvaW50LCBvciBhZGQgaXQuXG4gIHdoaWxlIChub2RlLmxlbmd0aCkge1xuICAgIGlmIChyaWdodCA9IHggPj0gKHhtID0gKHgwICsgeDEpIC8gMikpIHgwID0geG07IGVsc2UgeDEgPSB4bTtcbiAgICBpZiAoYm90dG9tID0geSA+PSAoeW0gPSAoeTAgKyB5MSkgLyAyKSkgeTAgPSB5bTsgZWxzZSB5MSA9IHltO1xuICAgIGlmIChwYXJlbnQgPSBub2RlLCAhKG5vZGUgPSBub2RlW2kgPSBib3R0b20gPDwgMSB8IHJpZ2h0XSkpIHJldHVybiBwYXJlbnRbaV0gPSBsZWFmLCB0cmVlO1xuICB9XG5cbiAgLy8gSXMgdGhlIG5ldyBwb2ludCBpcyBleGFjdGx5IGNvaW5jaWRlbnQgd2l0aCB0aGUgZXhpc3RpbmcgcG9pbnQ/XG4gIHhwID0gK3RyZWUuX3guY2FsbChudWxsLCBub2RlLmRhdGEpO1xuICB5cCA9ICt0cmVlLl95LmNhbGwobnVsbCwgbm9kZS5kYXRhKTtcbiAgaWYgKHggPT09IHhwICYmIHkgPT09IHlwKSByZXR1cm4gbGVhZi5uZXh0ID0gbm9kZSwgcGFyZW50ID8gcGFyZW50W2ldID0gbGVhZiA6IHRyZWUuX3Jvb3QgPSBsZWFmLCB0cmVlO1xuXG4gIC8vIE90aGVyd2lzZSwgc3BsaXQgdGhlIGxlYWYgbm9kZSB1bnRpbCB0aGUgb2xkIGFuZCBuZXcgcG9pbnQgYXJlIHNlcGFyYXRlZC5cbiAgZG8ge1xuICAgIHBhcmVudCA9IHBhcmVudCA/IHBhcmVudFtpXSA9IG5ldyBBcnJheSg0KSA6IHRyZWUuX3Jvb3QgPSBuZXcgQXJyYXkoNCk7XG4gICAgaWYgKHJpZ2h0ID0geCA+PSAoeG0gPSAoeDAgKyB4MSkgLyAyKSkgeDAgPSB4bTsgZWxzZSB4MSA9IHhtO1xuICAgIGlmIChib3R0b20gPSB5ID49ICh5bSA9ICh5MCArIHkxKSAvIDIpKSB5MCA9IHltOyBlbHNlIHkxID0geW07XG4gIH0gd2hpbGUgKChpID0gYm90dG9tIDw8IDEgfCByaWdodCkgPT09IChqID0gKHlwID49IHltKSA8PCAxIHwgKHhwID49IHhtKSkpO1xuICByZXR1cm4gcGFyZW50W2pdID0gbm9kZSwgcGFyZW50W2ldID0gbGVhZiwgdHJlZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFkZEFsbChkYXRhKSB7XG4gIHZhciBkLCBpLCBuID0gZGF0YS5sZW5ndGgsXG4gICAgICB4LFxuICAgICAgeSxcbiAgICAgIHh6ID0gbmV3IEFycmF5KG4pLFxuICAgICAgeXogPSBuZXcgQXJyYXkobiksXG4gICAgICB4MCA9IEluZmluaXR5LFxuICAgICAgeTAgPSBJbmZpbml0eSxcbiAgICAgIHgxID0gLUluZmluaXR5LFxuICAgICAgeTEgPSAtSW5maW5pdHk7XG5cbiAgLy8gQ29tcHV0ZSB0aGUgcG9pbnRzIGFuZCB0aGVpciBleHRlbnQuXG4gIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICBpZiAoaXNOYU4oeCA9ICt0aGlzLl94LmNhbGwobnVsbCwgZCA9IGRhdGFbaV0pKSB8fCBpc05hTih5ID0gK3RoaXMuX3kuY2FsbChudWxsLCBkKSkpIGNvbnRpbnVlO1xuICAgIHh6W2ldID0geDtcbiAgICB5eltpXSA9IHk7XG4gICAgaWYgKHggPCB4MCkgeDAgPSB4O1xuICAgIGlmICh4ID4geDEpIHgxID0geDtcbiAgICBpZiAoeSA8IHkwKSB5MCA9IHk7XG4gICAgaWYgKHkgPiB5MSkgeTEgPSB5O1xuICB9XG5cbiAgLy8gSWYgdGhlcmUgd2VyZSBubyAodmFsaWQpIHBvaW50cywgYWJvcnQuXG4gIGlmICh4MCA+IHgxIHx8IHkwID4geTEpIHJldHVybiB0aGlzO1xuXG4gIC8vIEV4cGFuZCB0aGUgdHJlZSB0byBjb3ZlciB0aGUgbmV3IHBvaW50cy5cbiAgdGhpcy5jb3Zlcih4MCwgeTApLmNvdmVyKHgxLCB5MSk7XG5cbiAgLy8gQWRkIHRoZSBuZXcgcG9pbnRzLlxuICBmb3IgKGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgYWRkKHRoaXMsIHh6W2ldLCB5eltpXSwgZGF0YVtpXSk7XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbih4LCB5KSB7XG4gIGlmIChpc05hTih4ID0gK3gpIHx8IGlzTmFOKHkgPSAreSkpIHJldHVybiB0aGlzOyAvLyBpZ25vcmUgaW52YWxpZCBwb2ludHNcblxuICB2YXIgeDAgPSB0aGlzLl94MCxcbiAgICAgIHkwID0gdGhpcy5feTAsXG4gICAgICB4MSA9IHRoaXMuX3gxLFxuICAgICAgeTEgPSB0aGlzLl95MTtcblxuICAvLyBJZiB0aGUgcXVhZHRyZWUgaGFzIG5vIGV4dGVudCwgaW5pdGlhbGl6ZSB0aGVtLlxuICAvLyBJbnRlZ2VyIGV4dGVudCBhcmUgbmVjZXNzYXJ5IHNvIHRoYXQgaWYgd2UgbGF0ZXIgZG91YmxlIHRoZSBleHRlbnQsXG4gIC8vIHRoZSBleGlzdGluZyBxdWFkcmFudCBib3VuZGFyaWVzIGRvblx1MjAxOXQgY2hhbmdlIGR1ZSB0byBmbG9hdGluZyBwb2ludCBlcnJvciFcbiAgaWYgKGlzTmFOKHgwKSkge1xuICAgIHgxID0gKHgwID0gTWF0aC5mbG9vcih4KSkgKyAxO1xuICAgIHkxID0gKHkwID0gTWF0aC5mbG9vcih5KSkgKyAxO1xuICB9XG5cbiAgLy8gT3RoZXJ3aXNlLCBkb3VibGUgcmVwZWF0ZWRseSB0byBjb3Zlci5cbiAgZWxzZSB7XG4gICAgdmFyIHogPSB4MSAtIHgwIHx8IDEsXG4gICAgICAgIG5vZGUgPSB0aGlzLl9yb290LFxuICAgICAgICBwYXJlbnQsXG4gICAgICAgIGk7XG5cbiAgICB3aGlsZSAoeDAgPiB4IHx8IHggPj0geDEgfHwgeTAgPiB5IHx8IHkgPj0geTEpIHtcbiAgICAgIGkgPSAoeSA8IHkwKSA8PCAxIHwgKHggPCB4MCk7XG4gICAgICBwYXJlbnQgPSBuZXcgQXJyYXkoNCksIHBhcmVudFtpXSA9IG5vZGUsIG5vZGUgPSBwYXJlbnQsIHogKj0gMjtcbiAgICAgIHN3aXRjaCAoaSkge1xuICAgICAgICBjYXNlIDA6IHgxID0geDAgKyB6LCB5MSA9IHkwICsgejsgYnJlYWs7XG4gICAgICAgIGNhc2UgMTogeDAgPSB4MSAtIHosIHkxID0geTAgKyB6OyBicmVhaztcbiAgICAgICAgY2FzZSAyOiB4MSA9IHgwICsgeiwgeTAgPSB5MSAtIHo7IGJyZWFrO1xuICAgICAgICBjYXNlIDM6IHgwID0geDEgLSB6LCB5MCA9IHkxIC0gejsgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX3Jvb3QgJiYgdGhpcy5fcm9vdC5sZW5ndGgpIHRoaXMuX3Jvb3QgPSBub2RlO1xuICB9XG5cbiAgdGhpcy5feDAgPSB4MDtcbiAgdGhpcy5feTAgPSB5MDtcbiAgdGhpcy5feDEgPSB4MTtcbiAgdGhpcy5feTEgPSB5MTtcbiAgcmV0dXJuIHRoaXM7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIHZhciBkYXRhID0gW107XG4gIHRoaXMudmlzaXQoZnVuY3Rpb24obm9kZSkge1xuICAgIGlmICghbm9kZS5sZW5ndGgpIGRvIGRhdGEucHVzaChub2RlLmRhdGEpOyB3aGlsZSAobm9kZSA9IG5vZGUubmV4dClcbiAgfSk7XG4gIHJldHVybiBkYXRhO1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKF8pIHtcbiAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGhcbiAgICAgID8gdGhpcy5jb3ZlcigrX1swXVswXSwgK19bMF1bMV0pLmNvdmVyKCtfWzFdWzBdLCArX1sxXVsxXSlcbiAgICAgIDogaXNOYU4odGhpcy5feDApID8gdW5kZWZpbmVkIDogW1t0aGlzLl94MCwgdGhpcy5feTBdLCBbdGhpcy5feDEsIHRoaXMuX3kxXV07XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obm9kZSwgeDAsIHkwLCB4MSwgeTEpIHtcbiAgdGhpcy5ub2RlID0gbm9kZTtcbiAgdGhpcy54MCA9IHgwO1xuICB0aGlzLnkwID0geTA7XG4gIHRoaXMueDEgPSB4MTtcbiAgdGhpcy55MSA9IHkxO1xufVxuIiwgImltcG9ydCBRdWFkIGZyb20gXCIuL3F1YWQuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oeCwgeSwgcmFkaXVzKSB7XG4gIHZhciBkYXRhLFxuICAgICAgeDAgPSB0aGlzLl94MCxcbiAgICAgIHkwID0gdGhpcy5feTAsXG4gICAgICB4MSxcbiAgICAgIHkxLFxuICAgICAgeDIsXG4gICAgICB5MixcbiAgICAgIHgzID0gdGhpcy5feDEsXG4gICAgICB5MyA9IHRoaXMuX3kxLFxuICAgICAgcXVhZHMgPSBbXSxcbiAgICAgIG5vZGUgPSB0aGlzLl9yb290LFxuICAgICAgcSxcbiAgICAgIGk7XG5cbiAgaWYgKG5vZGUpIHF1YWRzLnB1c2gobmV3IFF1YWQobm9kZSwgeDAsIHkwLCB4MywgeTMpKTtcbiAgaWYgKHJhZGl1cyA9PSBudWxsKSByYWRpdXMgPSBJbmZpbml0eTtcbiAgZWxzZSB7XG4gICAgeDAgPSB4IC0gcmFkaXVzLCB5MCA9IHkgLSByYWRpdXM7XG4gICAgeDMgPSB4ICsgcmFkaXVzLCB5MyA9IHkgKyByYWRpdXM7XG4gICAgcmFkaXVzICo9IHJhZGl1cztcbiAgfVxuXG4gIHdoaWxlIChxID0gcXVhZHMucG9wKCkpIHtcblxuICAgIC8vIFN0b3Agc2VhcmNoaW5nIGlmIHRoaXMgcXVhZHJhbnQgY2FuXHUyMDE5dCBjb250YWluIGEgY2xvc2VyIG5vZGUuXG4gICAgaWYgKCEobm9kZSA9IHEubm9kZSlcbiAgICAgICAgfHwgKHgxID0gcS54MCkgPiB4M1xuICAgICAgICB8fCAoeTEgPSBxLnkwKSA+IHkzXG4gICAgICAgIHx8ICh4MiA9IHEueDEpIDwgeDBcbiAgICAgICAgfHwgKHkyID0gcS55MSkgPCB5MCkgY29udGludWU7XG5cbiAgICAvLyBCaXNlY3QgdGhlIGN1cnJlbnQgcXVhZHJhbnQuXG4gICAgaWYgKG5vZGUubGVuZ3RoKSB7XG4gICAgICB2YXIgeG0gPSAoeDEgKyB4MikgLyAyLFxuICAgICAgICAgIHltID0gKHkxICsgeTIpIC8gMjtcblxuICAgICAgcXVhZHMucHVzaChcbiAgICAgICAgbmV3IFF1YWQobm9kZVszXSwgeG0sIHltLCB4MiwgeTIpLFxuICAgICAgICBuZXcgUXVhZChub2RlWzJdLCB4MSwgeW0sIHhtLCB5MiksXG4gICAgICAgIG5ldyBRdWFkKG5vZGVbMV0sIHhtLCB5MSwgeDIsIHltKSxcbiAgICAgICAgbmV3IFF1YWQobm9kZVswXSwgeDEsIHkxLCB4bSwgeW0pXG4gICAgICApO1xuXG4gICAgICAvLyBWaXNpdCB0aGUgY2xvc2VzdCBxdWFkcmFudCBmaXJzdC5cbiAgICAgIGlmIChpID0gKHkgPj0geW0pIDw8IDEgfCAoeCA+PSB4bSkpIHtcbiAgICAgICAgcSA9IHF1YWRzW3F1YWRzLmxlbmd0aCAtIDFdO1xuICAgICAgICBxdWFkc1txdWFkcy5sZW5ndGggLSAxXSA9IHF1YWRzW3F1YWRzLmxlbmd0aCAtIDEgLSBpXTtcbiAgICAgICAgcXVhZHNbcXVhZHMubGVuZ3RoIC0gMSAtIGldID0gcTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBWaXNpdCB0aGlzIHBvaW50LiAoVmlzaXRpbmcgY29pbmNpZGVudCBwb2ludHMgaXNuXHUyMDE5dCBuZWNlc3NhcnkhKVxuICAgIGVsc2Uge1xuICAgICAgdmFyIGR4ID0geCAtICt0aGlzLl94LmNhbGwobnVsbCwgbm9kZS5kYXRhKSxcbiAgICAgICAgICBkeSA9IHkgLSArdGhpcy5feS5jYWxsKG51bGwsIG5vZGUuZGF0YSksXG4gICAgICAgICAgZDIgPSBkeCAqIGR4ICsgZHkgKiBkeTtcbiAgICAgIGlmIChkMiA8IHJhZGl1cykge1xuICAgICAgICB2YXIgZCA9IE1hdGguc3FydChyYWRpdXMgPSBkMik7XG4gICAgICAgIHgwID0geCAtIGQsIHkwID0geSAtIGQ7XG4gICAgICAgIHgzID0geCArIGQsIHkzID0geSArIGQ7XG4gICAgICAgIGRhdGEgPSBub2RlLmRhdGE7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGRhdGE7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oZCkge1xuICBpZiAoaXNOYU4oeCA9ICt0aGlzLl94LmNhbGwobnVsbCwgZCkpIHx8IGlzTmFOKHkgPSArdGhpcy5feS5jYWxsKG51bGwsIGQpKSkgcmV0dXJuIHRoaXM7IC8vIGlnbm9yZSBpbnZhbGlkIHBvaW50c1xuXG4gIHZhciBwYXJlbnQsXG4gICAgICBub2RlID0gdGhpcy5fcm9vdCxcbiAgICAgIHJldGFpbmVyLFxuICAgICAgcHJldmlvdXMsXG4gICAgICBuZXh0LFxuICAgICAgeDAgPSB0aGlzLl94MCxcbiAgICAgIHkwID0gdGhpcy5feTAsXG4gICAgICB4MSA9IHRoaXMuX3gxLFxuICAgICAgeTEgPSB0aGlzLl95MSxcbiAgICAgIHgsXG4gICAgICB5LFxuICAgICAgeG0sXG4gICAgICB5bSxcbiAgICAgIHJpZ2h0LFxuICAgICAgYm90dG9tLFxuICAgICAgaSxcbiAgICAgIGo7XG5cbiAgLy8gSWYgdGhlIHRyZWUgaXMgZW1wdHksIGluaXRpYWxpemUgdGhlIHJvb3QgYXMgYSBsZWFmLlxuICBpZiAoIW5vZGUpIHJldHVybiB0aGlzO1xuXG4gIC8vIEZpbmQgdGhlIGxlYWYgbm9kZSBmb3IgdGhlIHBvaW50LlxuICAvLyBXaGlsZSBkZXNjZW5kaW5nLCBhbHNvIHJldGFpbiB0aGUgZGVlcGVzdCBwYXJlbnQgd2l0aCBhIG5vbi1yZW1vdmVkIHNpYmxpbmcuXG4gIGlmIChub2RlLmxlbmd0aCkgd2hpbGUgKHRydWUpIHtcbiAgICBpZiAocmlnaHQgPSB4ID49ICh4bSA9ICh4MCArIHgxKSAvIDIpKSB4MCA9IHhtOyBlbHNlIHgxID0geG07XG4gICAgaWYgKGJvdHRvbSA9IHkgPj0gKHltID0gKHkwICsgeTEpIC8gMikpIHkwID0geW07IGVsc2UgeTEgPSB5bTtcbiAgICBpZiAoIShwYXJlbnQgPSBub2RlLCBub2RlID0gbm9kZVtpID0gYm90dG9tIDw8IDEgfCByaWdodF0pKSByZXR1cm4gdGhpcztcbiAgICBpZiAoIW5vZGUubGVuZ3RoKSBicmVhaztcbiAgICBpZiAocGFyZW50WyhpICsgMSkgJiAzXSB8fCBwYXJlbnRbKGkgKyAyKSAmIDNdIHx8IHBhcmVudFsoaSArIDMpICYgM10pIHJldGFpbmVyID0gcGFyZW50LCBqID0gaTtcbiAgfVxuXG4gIC8vIEZpbmQgdGhlIHBvaW50IHRvIHJlbW92ZS5cbiAgd2hpbGUgKG5vZGUuZGF0YSAhPT0gZCkgaWYgKCEocHJldmlvdXMgPSBub2RlLCBub2RlID0gbm9kZS5uZXh0KSkgcmV0dXJuIHRoaXM7XG4gIGlmIChuZXh0ID0gbm9kZS5uZXh0KSBkZWxldGUgbm9kZS5uZXh0O1xuXG4gIC8vIElmIHRoZXJlIGFyZSBtdWx0aXBsZSBjb2luY2lkZW50IHBvaW50cywgcmVtb3ZlIGp1c3QgdGhlIHBvaW50LlxuICBpZiAocHJldmlvdXMpIHJldHVybiAobmV4dCA/IHByZXZpb3VzLm5leHQgPSBuZXh0IDogZGVsZXRlIHByZXZpb3VzLm5leHQpLCB0aGlzO1xuXG4gIC8vIElmIHRoaXMgaXMgdGhlIHJvb3QgcG9pbnQsIHJlbW92ZSBpdC5cbiAgaWYgKCFwYXJlbnQpIHJldHVybiB0aGlzLl9yb290ID0gbmV4dCwgdGhpcztcblxuICAvLyBSZW1vdmUgdGhpcyBsZWFmLlxuICBuZXh0ID8gcGFyZW50W2ldID0gbmV4dCA6IGRlbGV0ZSBwYXJlbnRbaV07XG5cbiAgLy8gSWYgdGhlIHBhcmVudCBub3cgY29udGFpbnMgZXhhY3RseSBvbmUgbGVhZiwgY29sbGFwc2Ugc3VwZXJmbHVvdXMgcGFyZW50cy5cbiAgaWYgKChub2RlID0gcGFyZW50WzBdIHx8IHBhcmVudFsxXSB8fCBwYXJlbnRbMl0gfHwgcGFyZW50WzNdKVxuICAgICAgJiYgbm9kZSA9PT0gKHBhcmVudFszXSB8fCBwYXJlbnRbMl0gfHwgcGFyZW50WzFdIHx8IHBhcmVudFswXSlcbiAgICAgICYmICFub2RlLmxlbmd0aCkge1xuICAgIGlmIChyZXRhaW5lcikgcmV0YWluZXJbal0gPSBub2RlO1xuICAgIGVsc2UgdGhpcy5fcm9vdCA9IG5vZGU7XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbW92ZUFsbChkYXRhKSB7XG4gIGZvciAodmFyIGkgPSAwLCBuID0gZGF0YS5sZW5ndGg7IGkgPCBuOyArK2kpIHRoaXMucmVtb3ZlKGRhdGFbaV0pO1xuICByZXR1cm4gdGhpcztcbn1cbiIsICJleHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuX3Jvb3Q7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIHZhciBzaXplID0gMDtcbiAgdGhpcy52aXNpdChmdW5jdGlvbihub2RlKSB7XG4gICAgaWYgKCFub2RlLmxlbmd0aCkgZG8gKytzaXplOyB3aGlsZSAobm9kZSA9IG5vZGUubmV4dClcbiAgfSk7XG4gIHJldHVybiBzaXplO1xufVxuIiwgImltcG9ydCBRdWFkIGZyb20gXCIuL3F1YWQuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oY2FsbGJhY2spIHtcbiAgdmFyIHF1YWRzID0gW10sIHEsIG5vZGUgPSB0aGlzLl9yb290LCBjaGlsZCwgeDAsIHkwLCB4MSwgeTE7XG4gIGlmIChub2RlKSBxdWFkcy5wdXNoKG5ldyBRdWFkKG5vZGUsIHRoaXMuX3gwLCB0aGlzLl95MCwgdGhpcy5feDEsIHRoaXMuX3kxKSk7XG4gIHdoaWxlIChxID0gcXVhZHMucG9wKCkpIHtcbiAgICBpZiAoIWNhbGxiYWNrKG5vZGUgPSBxLm5vZGUsIHgwID0gcS54MCwgeTAgPSBxLnkwLCB4MSA9IHEueDEsIHkxID0gcS55MSkgJiYgbm9kZS5sZW5ndGgpIHtcbiAgICAgIHZhciB4bSA9ICh4MCArIHgxKSAvIDIsIHltID0gKHkwICsgeTEpIC8gMjtcbiAgICAgIGlmIChjaGlsZCA9IG5vZGVbM10pIHF1YWRzLnB1c2gobmV3IFF1YWQoY2hpbGQsIHhtLCB5bSwgeDEsIHkxKSk7XG4gICAgICBpZiAoY2hpbGQgPSBub2RlWzJdKSBxdWFkcy5wdXNoKG5ldyBRdWFkKGNoaWxkLCB4MCwgeW0sIHhtLCB5MSkpO1xuICAgICAgaWYgKGNoaWxkID0gbm9kZVsxXSkgcXVhZHMucHVzaChuZXcgUXVhZChjaGlsZCwgeG0sIHkwLCB4MSwgeW0pKTtcbiAgICAgIGlmIChjaGlsZCA9IG5vZGVbMF0pIHF1YWRzLnB1c2gobmV3IFF1YWQoY2hpbGQsIHgwLCB5MCwgeG0sIHltKSk7XG4gICAgfVxuICB9XG4gIHJldHVybiB0aGlzO1xufVxuIiwgImltcG9ydCBRdWFkIGZyb20gXCIuL3F1YWQuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oY2FsbGJhY2spIHtcbiAgdmFyIHF1YWRzID0gW10sIG5leHQgPSBbXSwgcTtcbiAgaWYgKHRoaXMuX3Jvb3QpIHF1YWRzLnB1c2gobmV3IFF1YWQodGhpcy5fcm9vdCwgdGhpcy5feDAsIHRoaXMuX3kwLCB0aGlzLl94MSwgdGhpcy5feTEpKTtcbiAgd2hpbGUgKHEgPSBxdWFkcy5wb3AoKSkge1xuICAgIHZhciBub2RlID0gcS5ub2RlO1xuICAgIGlmIChub2RlLmxlbmd0aCkge1xuICAgICAgdmFyIGNoaWxkLCB4MCA9IHEueDAsIHkwID0gcS55MCwgeDEgPSBxLngxLCB5MSA9IHEueTEsIHhtID0gKHgwICsgeDEpIC8gMiwgeW0gPSAoeTAgKyB5MSkgLyAyO1xuICAgICAgaWYgKGNoaWxkID0gbm9kZVswXSkgcXVhZHMucHVzaChuZXcgUXVhZChjaGlsZCwgeDAsIHkwLCB4bSwgeW0pKTtcbiAgICAgIGlmIChjaGlsZCA9IG5vZGVbMV0pIHF1YWRzLnB1c2gobmV3IFF1YWQoY2hpbGQsIHhtLCB5MCwgeDEsIHltKSk7XG4gICAgICBpZiAoY2hpbGQgPSBub2RlWzJdKSBxdWFkcy5wdXNoKG5ldyBRdWFkKGNoaWxkLCB4MCwgeW0sIHhtLCB5MSkpO1xuICAgICAgaWYgKGNoaWxkID0gbm9kZVszXSkgcXVhZHMucHVzaChuZXcgUXVhZChjaGlsZCwgeG0sIHltLCB4MSwgeTEpKTtcbiAgICB9XG4gICAgbmV4dC5wdXNoKHEpO1xuICB9XG4gIHdoaWxlIChxID0gbmV4dC5wb3AoKSkge1xuICAgIGNhbGxiYWNrKHEubm9kZSwgcS54MCwgcS55MCwgcS54MSwgcS55MSk7XG4gIH1cbiAgcmV0dXJuIHRoaXM7XG59XG4iLCAiZXhwb3J0IGZ1bmN0aW9uIGRlZmF1bHRYKGQpIHtcbiAgcmV0dXJuIGRbMF07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKF8pIHtcbiAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAodGhpcy5feCA9IF8sIHRoaXMpIDogdGhpcy5feDtcbn1cbiIsICJleHBvcnQgZnVuY3Rpb24gZGVmYXVsdFkoZCkge1xuICByZXR1cm4gZFsxXTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oXykge1xuICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/ICh0aGlzLl95ID0gXywgdGhpcykgOiB0aGlzLl95O1xufVxuIiwgImltcG9ydCB0cmVlX2FkZCwge2FkZEFsbCBhcyB0cmVlX2FkZEFsbH0gZnJvbSBcIi4vYWRkLmpzXCI7XG5pbXBvcnQgdHJlZV9jb3ZlciBmcm9tIFwiLi9jb3Zlci5qc1wiO1xuaW1wb3J0IHRyZWVfZGF0YSBmcm9tIFwiLi9kYXRhLmpzXCI7XG5pbXBvcnQgdHJlZV9leHRlbnQgZnJvbSBcIi4vZXh0ZW50LmpzXCI7XG5pbXBvcnQgdHJlZV9maW5kIGZyb20gXCIuL2ZpbmQuanNcIjtcbmltcG9ydCB0cmVlX3JlbW92ZSwge3JlbW92ZUFsbCBhcyB0cmVlX3JlbW92ZUFsbH0gZnJvbSBcIi4vcmVtb3ZlLmpzXCI7XG5pbXBvcnQgdHJlZV9yb290IGZyb20gXCIuL3Jvb3QuanNcIjtcbmltcG9ydCB0cmVlX3NpemUgZnJvbSBcIi4vc2l6ZS5qc1wiO1xuaW1wb3J0IHRyZWVfdmlzaXQgZnJvbSBcIi4vdmlzaXQuanNcIjtcbmltcG9ydCB0cmVlX3Zpc2l0QWZ0ZXIgZnJvbSBcIi4vdmlzaXRBZnRlci5qc1wiO1xuaW1wb3J0IHRyZWVfeCwge2RlZmF1bHRYfSBmcm9tIFwiLi94LmpzXCI7XG5pbXBvcnQgdHJlZV95LCB7ZGVmYXVsdFl9IGZyb20gXCIuL3kuanNcIjtcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gcXVhZHRyZWUobm9kZXMsIHgsIHkpIHtcbiAgdmFyIHRyZWUgPSBuZXcgUXVhZHRyZWUoeCA9PSBudWxsID8gZGVmYXVsdFggOiB4LCB5ID09IG51bGwgPyBkZWZhdWx0WSA6IHksIE5hTiwgTmFOLCBOYU4sIE5hTik7XG4gIHJldHVybiBub2RlcyA9PSBudWxsID8gdHJlZSA6IHRyZWUuYWRkQWxsKG5vZGVzKTtcbn1cblxuZnVuY3Rpb24gUXVhZHRyZWUoeCwgeSwgeDAsIHkwLCB4MSwgeTEpIHtcbiAgdGhpcy5feCA9IHg7XG4gIHRoaXMuX3kgPSB5O1xuICB0aGlzLl94MCA9IHgwO1xuICB0aGlzLl95MCA9IHkwO1xuICB0aGlzLl94MSA9IHgxO1xuICB0aGlzLl95MSA9IHkxO1xuICB0aGlzLl9yb290ID0gdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiBsZWFmX2NvcHkobGVhZikge1xuICB2YXIgY29weSA9IHtkYXRhOiBsZWFmLmRhdGF9LCBuZXh0ID0gY29weTtcbiAgd2hpbGUgKGxlYWYgPSBsZWFmLm5leHQpIG5leHQgPSBuZXh0Lm5leHQgPSB7ZGF0YTogbGVhZi5kYXRhfTtcbiAgcmV0dXJuIGNvcHk7XG59XG5cbnZhciB0cmVlUHJvdG8gPSBxdWFkdHJlZS5wcm90b3R5cGUgPSBRdWFkdHJlZS5wcm90b3R5cGU7XG5cbnRyZWVQcm90by5jb3B5ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBjb3B5ID0gbmV3IFF1YWR0cmVlKHRoaXMuX3gsIHRoaXMuX3ksIHRoaXMuX3gwLCB0aGlzLl95MCwgdGhpcy5feDEsIHRoaXMuX3kxKSxcbiAgICAgIG5vZGUgPSB0aGlzLl9yb290LFxuICAgICAgbm9kZXMsXG4gICAgICBjaGlsZDtcblxuICBpZiAoIW5vZGUpIHJldHVybiBjb3B5O1xuXG4gIGlmICghbm9kZS5sZW5ndGgpIHJldHVybiBjb3B5Ll9yb290ID0gbGVhZl9jb3B5KG5vZGUpLCBjb3B5O1xuXG4gIG5vZGVzID0gW3tzb3VyY2U6IG5vZGUsIHRhcmdldDogY29weS5fcm9vdCA9IG5ldyBBcnJheSg0KX1dO1xuICB3aGlsZSAobm9kZSA9IG5vZGVzLnBvcCgpKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCA0OyArK2kpIHtcbiAgICAgIGlmIChjaGlsZCA9IG5vZGUuc291cmNlW2ldKSB7XG4gICAgICAgIGlmIChjaGlsZC5sZW5ndGgpIG5vZGVzLnB1c2goe3NvdXJjZTogY2hpbGQsIHRhcmdldDogbm9kZS50YXJnZXRbaV0gPSBuZXcgQXJyYXkoNCl9KTtcbiAgICAgICAgZWxzZSBub2RlLnRhcmdldFtpXSA9IGxlYWZfY29weShjaGlsZCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGNvcHk7XG59O1xuXG50cmVlUHJvdG8uYWRkID0gdHJlZV9hZGQ7XG50cmVlUHJvdG8uYWRkQWxsID0gdHJlZV9hZGRBbGw7XG50cmVlUHJvdG8uY292ZXIgPSB0cmVlX2NvdmVyO1xudHJlZVByb3RvLmRhdGEgPSB0cmVlX2RhdGE7XG50cmVlUHJvdG8uZXh0ZW50ID0gdHJlZV9leHRlbnQ7XG50cmVlUHJvdG8uZmluZCA9IHRyZWVfZmluZDtcbnRyZWVQcm90by5yZW1vdmUgPSB0cmVlX3JlbW92ZTtcbnRyZWVQcm90by5yZW1vdmVBbGwgPSB0cmVlX3JlbW92ZUFsbDtcbnRyZWVQcm90by5yb290ID0gdHJlZV9yb290O1xudHJlZVByb3RvLnNpemUgPSB0cmVlX3NpemU7XG50cmVlUHJvdG8udmlzaXQgPSB0cmVlX3Zpc2l0O1xudHJlZVByb3RvLnZpc2l0QWZ0ZXIgPSB0cmVlX3Zpc2l0QWZ0ZXI7XG50cmVlUHJvdG8ueCA9IHRyZWVfeDtcbnRyZWVQcm90by55ID0gdHJlZV95O1xuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHgpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB4O1xuICB9O1xufVxuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHJhbmRvbSkge1xuICByZXR1cm4gKHJhbmRvbSgpIC0gMC41KSAqIDFlLTY7XG59XG4iLCAiaW1wb3J0IHtxdWFkdHJlZX0gZnJvbSBcImQzLXF1YWR0cmVlXCI7XG5pbXBvcnQgY29uc3RhbnQgZnJvbSBcIi4vY29uc3RhbnQuanNcIjtcbmltcG9ydCBqaWdnbGUgZnJvbSBcIi4vamlnZ2xlLmpzXCI7XG5cbmZ1bmN0aW9uIHgoZCkge1xuICByZXR1cm4gZC54ICsgZC52eDtcbn1cblxuZnVuY3Rpb24geShkKSB7XG4gIHJldHVybiBkLnkgKyBkLnZ5O1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbihyYWRpdXMpIHtcbiAgdmFyIG5vZGVzLFxuICAgICAgcmFkaWksXG4gICAgICByYW5kb20sXG4gICAgICBzdHJlbmd0aCA9IDEsXG4gICAgICBpdGVyYXRpb25zID0gMTtcblxuICBpZiAodHlwZW9mIHJhZGl1cyAhPT0gXCJmdW5jdGlvblwiKSByYWRpdXMgPSBjb25zdGFudChyYWRpdXMgPT0gbnVsbCA/IDEgOiArcmFkaXVzKTtcblxuICBmdW5jdGlvbiBmb3JjZSgpIHtcbiAgICB2YXIgaSwgbiA9IG5vZGVzLmxlbmd0aCxcbiAgICAgICAgdHJlZSxcbiAgICAgICAgbm9kZSxcbiAgICAgICAgeGksXG4gICAgICAgIHlpLFxuICAgICAgICByaSxcbiAgICAgICAgcmkyO1xuXG4gICAgZm9yICh2YXIgayA9IDA7IGsgPCBpdGVyYXRpb25zOyArK2spIHtcbiAgICAgIHRyZWUgPSBxdWFkdHJlZShub2RlcywgeCwgeSkudmlzaXRBZnRlcihwcmVwYXJlKTtcbiAgICAgIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgICAgbm9kZSA9IG5vZGVzW2ldO1xuICAgICAgICByaSA9IHJhZGlpW25vZGUuaW5kZXhdLCByaTIgPSByaSAqIHJpO1xuICAgICAgICB4aSA9IG5vZGUueCArIG5vZGUudng7XG4gICAgICAgIHlpID0gbm9kZS55ICsgbm9kZS52eTtcbiAgICAgICAgdHJlZS52aXNpdChhcHBseSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYXBwbHkocXVhZCwgeDAsIHkwLCB4MSwgeTEpIHtcbiAgICAgIHZhciBkYXRhID0gcXVhZC5kYXRhLCByaiA9IHF1YWQuciwgciA9IHJpICsgcmo7XG4gICAgICBpZiAoZGF0YSkge1xuICAgICAgICBpZiAoZGF0YS5pbmRleCA+IG5vZGUuaW5kZXgpIHtcbiAgICAgICAgICB2YXIgeCA9IHhpIC0gZGF0YS54IC0gZGF0YS52eCxcbiAgICAgICAgICAgICAgeSA9IHlpIC0gZGF0YS55IC0gZGF0YS52eSxcbiAgICAgICAgICAgICAgbCA9IHggKiB4ICsgeSAqIHk7XG4gICAgICAgICAgaWYgKGwgPCByICogcikge1xuICAgICAgICAgICAgaWYgKHggPT09IDApIHggPSBqaWdnbGUocmFuZG9tKSwgbCArPSB4ICogeDtcbiAgICAgICAgICAgIGlmICh5ID09PSAwKSB5ID0gamlnZ2xlKHJhbmRvbSksIGwgKz0geSAqIHk7XG4gICAgICAgICAgICBsID0gKHIgLSAobCA9IE1hdGguc3FydChsKSkpIC8gbCAqIHN0cmVuZ3RoO1xuICAgICAgICAgICAgbm9kZS52eCArPSAoeCAqPSBsKSAqIChyID0gKHJqICo9IHJqKSAvIChyaTIgKyByaikpO1xuICAgICAgICAgICAgbm9kZS52eSArPSAoeSAqPSBsKSAqIHI7XG4gICAgICAgICAgICBkYXRhLnZ4IC09IHggKiAociA9IDEgLSByKTtcbiAgICAgICAgICAgIGRhdGEudnkgLT0geSAqIHI7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHJldHVybiB4MCA+IHhpICsgciB8fCB4MSA8IHhpIC0gciB8fCB5MCA+IHlpICsgciB8fCB5MSA8IHlpIC0gcjtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBwcmVwYXJlKHF1YWQpIHtcbiAgICBpZiAocXVhZC5kYXRhKSByZXR1cm4gcXVhZC5yID0gcmFkaWlbcXVhZC5kYXRhLmluZGV4XTtcbiAgICBmb3IgKHZhciBpID0gcXVhZC5yID0gMDsgaSA8IDQ7ICsraSkge1xuICAgICAgaWYgKHF1YWRbaV0gJiYgcXVhZFtpXS5yID4gcXVhZC5yKSB7XG4gICAgICAgIHF1YWQuciA9IHF1YWRbaV0ucjtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBpbml0aWFsaXplKCkge1xuICAgIGlmICghbm9kZXMpIHJldHVybjtcbiAgICB2YXIgaSwgbiA9IG5vZGVzLmxlbmd0aCwgbm9kZTtcbiAgICByYWRpaSA9IG5ldyBBcnJheShuKTtcbiAgICBmb3IgKGkgPSAwOyBpIDwgbjsgKytpKSBub2RlID0gbm9kZXNbaV0sIHJhZGlpW25vZGUuaW5kZXhdID0gK3JhZGl1cyhub2RlLCBpLCBub2Rlcyk7XG4gIH1cblxuICBmb3JjZS5pbml0aWFsaXplID0gZnVuY3Rpb24oX25vZGVzLCBfcmFuZG9tKSB7XG4gICAgbm9kZXMgPSBfbm9kZXM7XG4gICAgcmFuZG9tID0gX3JhbmRvbTtcbiAgICBpbml0aWFsaXplKCk7XG4gIH07XG5cbiAgZm9yY2UuaXRlcmF0aW9ucyA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChpdGVyYXRpb25zID0gK18sIGZvcmNlKSA6IGl0ZXJhdGlvbnM7XG4gIH07XG5cbiAgZm9yY2Uuc3RyZW5ndGggPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoc3RyZW5ndGggPSArXywgZm9yY2UpIDogc3RyZW5ndGg7XG4gIH07XG5cbiAgZm9yY2UucmFkaXVzID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHJhZGl1cyA9IHR5cGVvZiBfID09PSBcImZ1bmN0aW9uXCIgPyBfIDogY29uc3RhbnQoK18pLCBpbml0aWFsaXplKCksIGZvcmNlKSA6IHJhZGl1cztcbiAgfTtcblxuICByZXR1cm4gZm9yY2U7XG59XG4iLCAiaW1wb3J0IGNvbnN0YW50IGZyb20gXCIuL2NvbnN0YW50LmpzXCI7XG5pbXBvcnQgamlnZ2xlIGZyb20gXCIuL2ppZ2dsZS5qc1wiO1xuXG5mdW5jdGlvbiBpbmRleChkKSB7XG4gIHJldHVybiBkLmluZGV4O1xufVxuXG5mdW5jdGlvbiBmaW5kKG5vZGVCeUlkLCBub2RlSWQpIHtcbiAgdmFyIG5vZGUgPSBub2RlQnlJZC5nZXQobm9kZUlkKTtcbiAgaWYgKCFub2RlKSB0aHJvdyBuZXcgRXJyb3IoXCJub2RlIG5vdCBmb3VuZDogXCIgKyBub2RlSWQpO1xuICByZXR1cm4gbm9kZTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24obGlua3MpIHtcbiAgdmFyIGlkID0gaW5kZXgsXG4gICAgICBzdHJlbmd0aCA9IGRlZmF1bHRTdHJlbmd0aCxcbiAgICAgIHN0cmVuZ3RocyxcbiAgICAgIGRpc3RhbmNlID0gY29uc3RhbnQoMzApLFxuICAgICAgZGlzdGFuY2VzLFxuICAgICAgbm9kZXMsXG4gICAgICBjb3VudCxcbiAgICAgIGJpYXMsXG4gICAgICByYW5kb20sXG4gICAgICBpdGVyYXRpb25zID0gMTtcblxuICBpZiAobGlua3MgPT0gbnVsbCkgbGlua3MgPSBbXTtcblxuICBmdW5jdGlvbiBkZWZhdWx0U3RyZW5ndGgobGluaykge1xuICAgIHJldHVybiAxIC8gTWF0aC5taW4oY291bnRbbGluay5zb3VyY2UuaW5kZXhdLCBjb3VudFtsaW5rLnRhcmdldC5pbmRleF0pO1xuICB9XG5cbiAgZnVuY3Rpb24gZm9yY2UoYWxwaGEpIHtcbiAgICBmb3IgKHZhciBrID0gMCwgbiA9IGxpbmtzLmxlbmd0aDsgayA8IGl0ZXJhdGlvbnM7ICsraykge1xuICAgICAgZm9yICh2YXIgaSA9IDAsIGxpbmssIHNvdXJjZSwgdGFyZ2V0LCB4LCB5LCBsLCBiOyBpIDwgbjsgKytpKSB7XG4gICAgICAgIGxpbmsgPSBsaW5rc1tpXSwgc291cmNlID0gbGluay5zb3VyY2UsIHRhcmdldCA9IGxpbmsudGFyZ2V0O1xuICAgICAgICB4ID0gdGFyZ2V0LnggKyB0YXJnZXQudnggLSBzb3VyY2UueCAtIHNvdXJjZS52eCB8fCBqaWdnbGUocmFuZG9tKTtcbiAgICAgICAgeSA9IHRhcmdldC55ICsgdGFyZ2V0LnZ5IC0gc291cmNlLnkgLSBzb3VyY2UudnkgfHwgamlnZ2xlKHJhbmRvbSk7XG4gICAgICAgIGwgPSBNYXRoLnNxcnQoeCAqIHggKyB5ICogeSk7XG4gICAgICAgIGwgPSAobCAtIGRpc3RhbmNlc1tpXSkgLyBsICogYWxwaGEgKiBzdHJlbmd0aHNbaV07XG4gICAgICAgIHggKj0gbCwgeSAqPSBsO1xuICAgICAgICB0YXJnZXQudnggLT0geCAqIChiID0gYmlhc1tpXSk7XG4gICAgICAgIHRhcmdldC52eSAtPSB5ICogYjtcbiAgICAgICAgc291cmNlLnZ4ICs9IHggKiAoYiA9IDEgLSBiKTtcbiAgICAgICAgc291cmNlLnZ5ICs9IHkgKiBiO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGluaXRpYWxpemUoKSB7XG4gICAgaWYgKCFub2RlcykgcmV0dXJuO1xuXG4gICAgdmFyIGksXG4gICAgICAgIG4gPSBub2Rlcy5sZW5ndGgsXG4gICAgICAgIG0gPSBsaW5rcy5sZW5ndGgsXG4gICAgICAgIG5vZGVCeUlkID0gbmV3IE1hcChub2Rlcy5tYXAoKGQsIGkpID0+IFtpZChkLCBpLCBub2RlcyksIGRdKSksXG4gICAgICAgIGxpbms7XG5cbiAgICBmb3IgKGkgPSAwLCBjb3VudCA9IG5ldyBBcnJheShuKTsgaSA8IG07ICsraSkge1xuICAgICAgbGluayA9IGxpbmtzW2ldLCBsaW5rLmluZGV4ID0gaTtcbiAgICAgIGlmICh0eXBlb2YgbGluay5zb3VyY2UgIT09IFwib2JqZWN0XCIpIGxpbmsuc291cmNlID0gZmluZChub2RlQnlJZCwgbGluay5zb3VyY2UpO1xuICAgICAgaWYgKHR5cGVvZiBsaW5rLnRhcmdldCAhPT0gXCJvYmplY3RcIikgbGluay50YXJnZXQgPSBmaW5kKG5vZGVCeUlkLCBsaW5rLnRhcmdldCk7XG4gICAgICBjb3VudFtsaW5rLnNvdXJjZS5pbmRleF0gPSAoY291bnRbbGluay5zb3VyY2UuaW5kZXhdIHx8IDApICsgMTtcbiAgICAgIGNvdW50W2xpbmsudGFyZ2V0LmluZGV4XSA9IChjb3VudFtsaW5rLnRhcmdldC5pbmRleF0gfHwgMCkgKyAxO1xuICAgIH1cblxuICAgIGZvciAoaSA9IDAsIGJpYXMgPSBuZXcgQXJyYXkobSk7IGkgPCBtOyArK2kpIHtcbiAgICAgIGxpbmsgPSBsaW5rc1tpXSwgYmlhc1tpXSA9IGNvdW50W2xpbmsuc291cmNlLmluZGV4XSAvIChjb3VudFtsaW5rLnNvdXJjZS5pbmRleF0gKyBjb3VudFtsaW5rLnRhcmdldC5pbmRleF0pO1xuICAgIH1cblxuICAgIHN0cmVuZ3RocyA9IG5ldyBBcnJheShtKSwgaW5pdGlhbGl6ZVN0cmVuZ3RoKCk7XG4gICAgZGlzdGFuY2VzID0gbmV3IEFycmF5KG0pLCBpbml0aWFsaXplRGlzdGFuY2UoKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGluaXRpYWxpemVTdHJlbmd0aCgpIHtcbiAgICBpZiAoIW5vZGVzKSByZXR1cm47XG5cbiAgICBmb3IgKHZhciBpID0gMCwgbiA9IGxpbmtzLmxlbmd0aDsgaSA8IG47ICsraSkge1xuICAgICAgc3RyZW5ndGhzW2ldID0gK3N0cmVuZ3RoKGxpbmtzW2ldLCBpLCBsaW5rcyk7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gaW5pdGlhbGl6ZURpc3RhbmNlKCkge1xuICAgIGlmICghbm9kZXMpIHJldHVybjtcblxuICAgIGZvciAodmFyIGkgPSAwLCBuID0gbGlua3MubGVuZ3RoOyBpIDwgbjsgKytpKSB7XG4gICAgICBkaXN0YW5jZXNbaV0gPSArZGlzdGFuY2UobGlua3NbaV0sIGksIGxpbmtzKTtcbiAgICB9XG4gIH1cblxuICBmb3JjZS5pbml0aWFsaXplID0gZnVuY3Rpb24oX25vZGVzLCBfcmFuZG9tKSB7XG4gICAgbm9kZXMgPSBfbm9kZXM7XG4gICAgcmFuZG9tID0gX3JhbmRvbTtcbiAgICBpbml0aWFsaXplKCk7XG4gIH07XG5cbiAgZm9yY2UubGlua3MgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAobGlua3MgPSBfLCBpbml0aWFsaXplKCksIGZvcmNlKSA6IGxpbmtzO1xuICB9O1xuXG4gIGZvcmNlLmlkID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGlkID0gXywgZm9yY2UpIDogaWQ7XG4gIH07XG5cbiAgZm9yY2UuaXRlcmF0aW9ucyA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChpdGVyYXRpb25zID0gK18sIGZvcmNlKSA6IGl0ZXJhdGlvbnM7XG4gIH07XG5cbiAgZm9yY2Uuc3RyZW5ndGggPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoc3RyZW5ndGggPSB0eXBlb2YgXyA9PT0gXCJmdW5jdGlvblwiID8gXyA6IGNvbnN0YW50KCtfKSwgaW5pdGlhbGl6ZVN0cmVuZ3RoKCksIGZvcmNlKSA6IHN0cmVuZ3RoO1xuICB9O1xuXG4gIGZvcmNlLmRpc3RhbmNlID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGRpc3RhbmNlID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudCgrXyksIGluaXRpYWxpemVEaXN0YW5jZSgpLCBmb3JjZSkgOiBkaXN0YW5jZTtcbiAgfTtcblxuICByZXR1cm4gZm9yY2U7XG59XG4iLCAiLy8gaHR0cHM6Ly9lbi53aWtpcGVkaWEub3JnL3dpa2kvTGluZWFyX2NvbmdydWVudGlhbF9nZW5lcmF0b3IjUGFyYW1ldGVyc19pbl9jb21tb25fdXNlXG5jb25zdCBhID0gMTY2NDUyNTtcbmNvbnN0IGMgPSAxMDEzOTA0MjIzO1xuY29uc3QgbSA9IDQyOTQ5NjcyOTY7IC8vIDJeMzJcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIGxldCBzID0gMTtcbiAgcmV0dXJuICgpID0+IChzID0gKGEgKiBzICsgYykgJSBtKSAvIG07XG59XG4iLCAiaW1wb3J0IHtkaXNwYXRjaH0gZnJvbSBcImQzLWRpc3BhdGNoXCI7XG5pbXBvcnQge3RpbWVyfSBmcm9tIFwiZDMtdGltZXJcIjtcbmltcG9ydCBsY2cgZnJvbSBcIi4vbGNnLmpzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiB4KGQpIHtcbiAgcmV0dXJuIGQueDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHkoZCkge1xuICByZXR1cm4gZC55O1xufVxuXG52YXIgaW5pdGlhbFJhZGl1cyA9IDEwLFxuICAgIGluaXRpYWxBbmdsZSA9IE1hdGguUEkgKiAoMyAtIE1hdGguc3FydCg1KSk7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKG5vZGVzKSB7XG4gIHZhciBzaW11bGF0aW9uLFxuICAgICAgYWxwaGEgPSAxLFxuICAgICAgYWxwaGFNaW4gPSAwLjAwMSxcbiAgICAgIGFscGhhRGVjYXkgPSAxIC0gTWF0aC5wb3coYWxwaGFNaW4sIDEgLyAzMDApLFxuICAgICAgYWxwaGFUYXJnZXQgPSAwLFxuICAgICAgdmVsb2NpdHlEZWNheSA9IDAuNixcbiAgICAgIGZvcmNlcyA9IG5ldyBNYXAoKSxcbiAgICAgIHN0ZXBwZXIgPSB0aW1lcihzdGVwKSxcbiAgICAgIGV2ZW50ID0gZGlzcGF0Y2goXCJ0aWNrXCIsIFwiZW5kXCIpLFxuICAgICAgcmFuZG9tID0gbGNnKCk7XG5cbiAgaWYgKG5vZGVzID09IG51bGwpIG5vZGVzID0gW107XG5cbiAgZnVuY3Rpb24gc3RlcCgpIHtcbiAgICB0aWNrKCk7XG4gICAgZXZlbnQuY2FsbChcInRpY2tcIiwgc2ltdWxhdGlvbik7XG4gICAgaWYgKGFscGhhIDwgYWxwaGFNaW4pIHtcbiAgICAgIHN0ZXBwZXIuc3RvcCgpO1xuICAgICAgZXZlbnQuY2FsbChcImVuZFwiLCBzaW11bGF0aW9uKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiB0aWNrKGl0ZXJhdGlvbnMpIHtcbiAgICB2YXIgaSwgbiA9IG5vZGVzLmxlbmd0aCwgbm9kZTtcblxuICAgIGlmIChpdGVyYXRpb25zID09PSB1bmRlZmluZWQpIGl0ZXJhdGlvbnMgPSAxO1xuXG4gICAgZm9yICh2YXIgayA9IDA7IGsgPCBpdGVyYXRpb25zOyArK2spIHtcbiAgICAgIGFscGhhICs9IChhbHBoYVRhcmdldCAtIGFscGhhKSAqIGFscGhhRGVjYXk7XG5cbiAgICAgIGZvcmNlcy5mb3JFYWNoKGZ1bmN0aW9uKGZvcmNlKSB7XG4gICAgICAgIGZvcmNlKGFscGhhKTtcbiAgICAgIH0pO1xuXG4gICAgICBmb3IgKGkgPSAwOyBpIDwgbjsgKytpKSB7XG4gICAgICAgIG5vZGUgPSBub2Rlc1tpXTtcbiAgICAgICAgaWYgKG5vZGUuZnggPT0gbnVsbCkgbm9kZS54ICs9IG5vZGUudnggKj0gdmVsb2NpdHlEZWNheTtcbiAgICAgICAgZWxzZSBub2RlLnggPSBub2RlLmZ4LCBub2RlLnZ4ID0gMDtcbiAgICAgICAgaWYgKG5vZGUuZnkgPT0gbnVsbCkgbm9kZS55ICs9IG5vZGUudnkgKj0gdmVsb2NpdHlEZWNheTtcbiAgICAgICAgZWxzZSBub2RlLnkgPSBub2RlLmZ5LCBub2RlLnZ5ID0gMDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gc2ltdWxhdGlvbjtcbiAgfVxuXG4gIGZ1bmN0aW9uIGluaXRpYWxpemVOb2RlcygpIHtcbiAgICBmb3IgKHZhciBpID0gMCwgbiA9IG5vZGVzLmxlbmd0aCwgbm9kZTsgaSA8IG47ICsraSkge1xuICAgICAgbm9kZSA9IG5vZGVzW2ldLCBub2RlLmluZGV4ID0gaTtcbiAgICAgIGlmIChub2RlLmZ4ICE9IG51bGwpIG5vZGUueCA9IG5vZGUuZng7XG4gICAgICBpZiAobm9kZS5meSAhPSBudWxsKSBub2RlLnkgPSBub2RlLmZ5O1xuICAgICAgaWYgKGlzTmFOKG5vZGUueCkgfHwgaXNOYU4obm9kZS55KSkge1xuICAgICAgICB2YXIgcmFkaXVzID0gaW5pdGlhbFJhZGl1cyAqIE1hdGguc3FydCgwLjUgKyBpKSwgYW5nbGUgPSBpICogaW5pdGlhbEFuZ2xlO1xuICAgICAgICBub2RlLnggPSByYWRpdXMgKiBNYXRoLmNvcyhhbmdsZSk7XG4gICAgICAgIG5vZGUueSA9IHJhZGl1cyAqIE1hdGguc2luKGFuZ2xlKTtcbiAgICAgIH1cbiAgICAgIGlmIChpc05hTihub2RlLnZ4KSB8fCBpc05hTihub2RlLnZ5KSkge1xuICAgICAgICBub2RlLnZ4ID0gbm9kZS52eSA9IDA7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gaW5pdGlhbGl6ZUZvcmNlKGZvcmNlKSB7XG4gICAgaWYgKGZvcmNlLmluaXRpYWxpemUpIGZvcmNlLmluaXRpYWxpemUobm9kZXMsIHJhbmRvbSk7XG4gICAgcmV0dXJuIGZvcmNlO1xuICB9XG5cbiAgaW5pdGlhbGl6ZU5vZGVzKCk7XG5cbiAgcmV0dXJuIHNpbXVsYXRpb24gPSB7XG4gICAgdGljazogdGljayxcblxuICAgIHJlc3RhcnQ6IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIHN0ZXBwZXIucmVzdGFydChzdGVwKSwgc2ltdWxhdGlvbjtcbiAgICB9LFxuXG4gICAgc3RvcDogZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gc3RlcHBlci5zdG9wKCksIHNpbXVsYXRpb247XG4gICAgfSxcblxuICAgIG5vZGVzOiBmdW5jdGlvbihfKSB7XG4gICAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChub2RlcyA9IF8sIGluaXRpYWxpemVOb2RlcygpLCBmb3JjZXMuZm9yRWFjaChpbml0aWFsaXplRm9yY2UpLCBzaW11bGF0aW9uKSA6IG5vZGVzO1xuICAgIH0sXG5cbiAgICBhbHBoYTogZnVuY3Rpb24oXykge1xuICAgICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoYWxwaGEgPSArXywgc2ltdWxhdGlvbikgOiBhbHBoYTtcbiAgICB9LFxuXG4gICAgYWxwaGFNaW46IGZ1bmN0aW9uKF8pIHtcbiAgICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGFscGhhTWluID0gK18sIHNpbXVsYXRpb24pIDogYWxwaGFNaW47XG4gICAgfSxcblxuICAgIGFscGhhRGVjYXk6IGZ1bmN0aW9uKF8pIHtcbiAgICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGFscGhhRGVjYXkgPSArXywgc2ltdWxhdGlvbikgOiArYWxwaGFEZWNheTtcbiAgICB9LFxuXG4gICAgYWxwaGFUYXJnZXQ6IGZ1bmN0aW9uKF8pIHtcbiAgICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGFscGhhVGFyZ2V0ID0gK18sIHNpbXVsYXRpb24pIDogYWxwaGFUYXJnZXQ7XG4gICAgfSxcblxuICAgIHZlbG9jaXR5RGVjYXk6IGZ1bmN0aW9uKF8pIHtcbiAgICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHZlbG9jaXR5RGVjYXkgPSAxIC0gXywgc2ltdWxhdGlvbikgOiAxIC0gdmVsb2NpdHlEZWNheTtcbiAgICB9LFxuXG4gICAgcmFuZG9tU291cmNlOiBmdW5jdGlvbihfKSB7XG4gICAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChyYW5kb20gPSBfLCBmb3JjZXMuZm9yRWFjaChpbml0aWFsaXplRm9yY2UpLCBzaW11bGF0aW9uKSA6IHJhbmRvbTtcbiAgICB9LFxuXG4gICAgZm9yY2U6IGZ1bmN0aW9uKG5hbWUsIF8pIHtcbiAgICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID4gMSA/ICgoXyA9PSBudWxsID8gZm9yY2VzLmRlbGV0ZShuYW1lKSA6IGZvcmNlcy5zZXQobmFtZSwgaW5pdGlhbGl6ZUZvcmNlKF8pKSksIHNpbXVsYXRpb24pIDogZm9yY2VzLmdldChuYW1lKTtcbiAgICB9LFxuXG4gICAgZmluZDogZnVuY3Rpb24oeCwgeSwgcmFkaXVzKSB7XG4gICAgICB2YXIgaSA9IDAsXG4gICAgICAgICAgbiA9IG5vZGVzLmxlbmd0aCxcbiAgICAgICAgICBkeCxcbiAgICAgICAgICBkeSxcbiAgICAgICAgICBkMixcbiAgICAgICAgICBub2RlLFxuICAgICAgICAgIGNsb3Nlc3Q7XG5cbiAgICAgIGlmIChyYWRpdXMgPT0gbnVsbCkgcmFkaXVzID0gSW5maW5pdHk7XG4gICAgICBlbHNlIHJhZGl1cyAqPSByYWRpdXM7XG5cbiAgICAgIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgICAgbm9kZSA9IG5vZGVzW2ldO1xuICAgICAgICBkeCA9IHggLSBub2RlLng7XG4gICAgICAgIGR5ID0geSAtIG5vZGUueTtcbiAgICAgICAgZDIgPSBkeCAqIGR4ICsgZHkgKiBkeTtcbiAgICAgICAgaWYgKGQyIDwgcmFkaXVzKSBjbG9zZXN0ID0gbm9kZSwgcmFkaXVzID0gZDI7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBjbG9zZXN0O1xuICAgIH0sXG5cbiAgICBvbjogZnVuY3Rpb24obmFtZSwgXykge1xuICAgICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPiAxID8gKGV2ZW50Lm9uKG5hbWUsIF8pLCBzaW11bGF0aW9uKSA6IGV2ZW50Lm9uKG5hbWUpO1xuICAgIH1cbiAgfTtcbn1cbiIsICJpbXBvcnQge3F1YWR0cmVlfSBmcm9tIFwiZDMtcXVhZHRyZWVcIjtcbmltcG9ydCBjb25zdGFudCBmcm9tIFwiLi9jb25zdGFudC5qc1wiO1xuaW1wb3J0IGppZ2dsZSBmcm9tIFwiLi9qaWdnbGUuanNcIjtcbmltcG9ydCB7eCwgeX0gZnJvbSBcIi4vc2ltdWxhdGlvbi5qc1wiO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbigpIHtcbiAgdmFyIG5vZGVzLFxuICAgICAgbm9kZSxcbiAgICAgIHJhbmRvbSxcbiAgICAgIGFscGhhLFxuICAgICAgc3RyZW5ndGggPSBjb25zdGFudCgtMzApLFxuICAgICAgc3RyZW5ndGhzLFxuICAgICAgZGlzdGFuY2VNaW4yID0gMSxcbiAgICAgIGRpc3RhbmNlTWF4MiA9IEluZmluaXR5LFxuICAgICAgdGhldGEyID0gMC44MTtcblxuICBmdW5jdGlvbiBmb3JjZShfKSB7XG4gICAgdmFyIGksIG4gPSBub2Rlcy5sZW5ndGgsIHRyZWUgPSBxdWFkdHJlZShub2RlcywgeCwgeSkudmlzaXRBZnRlcihhY2N1bXVsYXRlKTtcbiAgICBmb3IgKGFscGhhID0gXywgaSA9IDA7IGkgPCBuOyArK2kpIG5vZGUgPSBub2Rlc1tpXSwgdHJlZS52aXNpdChhcHBseSk7XG4gIH1cblxuICBmdW5jdGlvbiBpbml0aWFsaXplKCkge1xuICAgIGlmICghbm9kZXMpIHJldHVybjtcbiAgICB2YXIgaSwgbiA9IG5vZGVzLmxlbmd0aCwgbm9kZTtcbiAgICBzdHJlbmd0aHMgPSBuZXcgQXJyYXkobik7XG4gICAgZm9yIChpID0gMDsgaSA8IG47ICsraSkgbm9kZSA9IG5vZGVzW2ldLCBzdHJlbmd0aHNbbm9kZS5pbmRleF0gPSArc3RyZW5ndGgobm9kZSwgaSwgbm9kZXMpO1xuICB9XG5cbiAgZnVuY3Rpb24gYWNjdW11bGF0ZShxdWFkKSB7XG4gICAgdmFyIHN0cmVuZ3RoID0gMCwgcSwgYywgd2VpZ2h0ID0gMCwgeCwgeSwgaTtcblxuICAgIC8vIEZvciBpbnRlcm5hbCBub2RlcywgYWNjdW11bGF0ZSBmb3JjZXMgZnJvbSBjaGlsZCBxdWFkcmFudHMuXG4gICAgaWYgKHF1YWQubGVuZ3RoKSB7XG4gICAgICBmb3IgKHggPSB5ID0gaSA9IDA7IGkgPCA0OyArK2kpIHtcbiAgICAgICAgaWYgKChxID0gcXVhZFtpXSkgJiYgKGMgPSBNYXRoLmFicyhxLnZhbHVlKSkpIHtcbiAgICAgICAgICBzdHJlbmd0aCArPSBxLnZhbHVlLCB3ZWlnaHQgKz0gYywgeCArPSBjICogcS54LCB5ICs9IGMgKiBxLnk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHF1YWQueCA9IHggLyB3ZWlnaHQ7XG4gICAgICBxdWFkLnkgPSB5IC8gd2VpZ2h0O1xuICAgIH1cblxuICAgIC8vIEZvciBsZWFmIG5vZGVzLCBhY2N1bXVsYXRlIGZvcmNlcyBmcm9tIGNvaW5jaWRlbnQgcXVhZHJhbnRzLlxuICAgIGVsc2Uge1xuICAgICAgcSA9IHF1YWQ7XG4gICAgICBxLnggPSBxLmRhdGEueDtcbiAgICAgIHEueSA9IHEuZGF0YS55O1xuICAgICAgZG8gc3RyZW5ndGggKz0gc3RyZW5ndGhzW3EuZGF0YS5pbmRleF07XG4gICAgICB3aGlsZSAocSA9IHEubmV4dCk7XG4gICAgfVxuXG4gICAgcXVhZC52YWx1ZSA9IHN0cmVuZ3RoO1xuICB9XG5cbiAgZnVuY3Rpb24gYXBwbHkocXVhZCwgeDEsIF8sIHgyKSB7XG4gICAgaWYgKCFxdWFkLnZhbHVlKSByZXR1cm4gdHJ1ZTtcblxuICAgIHZhciB4ID0gcXVhZC54IC0gbm9kZS54LFxuICAgICAgICB5ID0gcXVhZC55IC0gbm9kZS55LFxuICAgICAgICB3ID0geDIgLSB4MSxcbiAgICAgICAgbCA9IHggKiB4ICsgeSAqIHk7XG5cbiAgICAvLyBBcHBseSB0aGUgQmFybmVzLUh1dCBhcHByb3hpbWF0aW9uIGlmIHBvc3NpYmxlLlxuICAgIC8vIExpbWl0IGZvcmNlcyBmb3IgdmVyeSBjbG9zZSBub2RlczsgcmFuZG9taXplIGRpcmVjdGlvbiBpZiBjb2luY2lkZW50LlxuICAgIGlmICh3ICogdyAvIHRoZXRhMiA8IGwpIHtcbiAgICAgIGlmIChsIDwgZGlzdGFuY2VNYXgyKSB7XG4gICAgICAgIGlmICh4ID09PSAwKSB4ID0gamlnZ2xlKHJhbmRvbSksIGwgKz0geCAqIHg7XG4gICAgICAgIGlmICh5ID09PSAwKSB5ID0gamlnZ2xlKHJhbmRvbSksIGwgKz0geSAqIHk7XG4gICAgICAgIGlmIChsIDwgZGlzdGFuY2VNaW4yKSBsID0gTWF0aC5zcXJ0KGRpc3RhbmNlTWluMiAqIGwpO1xuICAgICAgICBub2RlLnZ4ICs9IHggKiBxdWFkLnZhbHVlICogYWxwaGEgLyBsO1xuICAgICAgICBub2RlLnZ5ICs9IHkgKiBxdWFkLnZhbHVlICogYWxwaGEgLyBsO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgLy8gT3RoZXJ3aXNlLCBwcm9jZXNzIHBvaW50cyBkaXJlY3RseS5cbiAgICBlbHNlIGlmIChxdWFkLmxlbmd0aCB8fCBsID49IGRpc3RhbmNlTWF4MikgcmV0dXJuO1xuXG4gICAgLy8gTGltaXQgZm9yY2VzIGZvciB2ZXJ5IGNsb3NlIG5vZGVzOyByYW5kb21pemUgZGlyZWN0aW9uIGlmIGNvaW5jaWRlbnQuXG4gICAgaWYgKHF1YWQuZGF0YSAhPT0gbm9kZSB8fCBxdWFkLm5leHQpIHtcbiAgICAgIGlmICh4ID09PSAwKSB4ID0gamlnZ2xlKHJhbmRvbSksIGwgKz0geCAqIHg7XG4gICAgICBpZiAoeSA9PT0gMCkgeSA9IGppZ2dsZShyYW5kb20pLCBsICs9IHkgKiB5O1xuICAgICAgaWYgKGwgPCBkaXN0YW5jZU1pbjIpIGwgPSBNYXRoLnNxcnQoZGlzdGFuY2VNaW4yICogbCk7XG4gICAgfVxuXG4gICAgZG8gaWYgKHF1YWQuZGF0YSAhPT0gbm9kZSkge1xuICAgICAgdyA9IHN0cmVuZ3Roc1txdWFkLmRhdGEuaW5kZXhdICogYWxwaGEgLyBsO1xuICAgICAgbm9kZS52eCArPSB4ICogdztcbiAgICAgIG5vZGUudnkgKz0geSAqIHc7XG4gICAgfSB3aGlsZSAocXVhZCA9IHF1YWQubmV4dCk7XG4gIH1cblxuICBmb3JjZS5pbml0aWFsaXplID0gZnVuY3Rpb24oX25vZGVzLCBfcmFuZG9tKSB7XG4gICAgbm9kZXMgPSBfbm9kZXM7XG4gICAgcmFuZG9tID0gX3JhbmRvbTtcbiAgICBpbml0aWFsaXplKCk7XG4gIH07XG5cbiAgZm9yY2Uuc3RyZW5ndGggPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoc3RyZW5ndGggPSB0eXBlb2YgXyA9PT0gXCJmdW5jdGlvblwiID8gXyA6IGNvbnN0YW50KCtfKSwgaW5pdGlhbGl6ZSgpLCBmb3JjZSkgOiBzdHJlbmd0aDtcbiAgfTtcblxuICBmb3JjZS5kaXN0YW5jZU1pbiA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChkaXN0YW5jZU1pbjIgPSBfICogXywgZm9yY2UpIDogTWF0aC5zcXJ0KGRpc3RhbmNlTWluMik7XG4gIH07XG5cbiAgZm9yY2UuZGlzdGFuY2VNYXggPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAoZGlzdGFuY2VNYXgyID0gXyAqIF8sIGZvcmNlKSA6IE1hdGguc3FydChkaXN0YW5jZU1heDIpO1xuICB9O1xuXG4gIGZvcmNlLnRoZXRhID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHRoZXRhMiA9IF8gKiBfLCBmb3JjZSkgOiBNYXRoLnNxcnQodGhldGEyKTtcbiAgfTtcblxuICByZXR1cm4gZm9yY2U7XG59XG4iLCAiaW1wb3J0IGNvbnN0YW50IGZyb20gXCIuL2NvbnN0YW50LmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHgpIHtcbiAgdmFyIHN0cmVuZ3RoID0gY29uc3RhbnQoMC4xKSxcbiAgICAgIG5vZGVzLFxuICAgICAgc3RyZW5ndGhzLFxuICAgICAgeHo7XG5cbiAgaWYgKHR5cGVvZiB4ICE9PSBcImZ1bmN0aW9uXCIpIHggPSBjb25zdGFudCh4ID09IG51bGwgPyAwIDogK3gpO1xuXG4gIGZ1bmN0aW9uIGZvcmNlKGFscGhhKSB7XG4gICAgZm9yICh2YXIgaSA9IDAsIG4gPSBub2Rlcy5sZW5ndGgsIG5vZGU7IGkgPCBuOyArK2kpIHtcbiAgICAgIG5vZGUgPSBub2Rlc1tpXSwgbm9kZS52eCArPSAoeHpbaV0gLSBub2RlLngpICogc3RyZW5ndGhzW2ldICogYWxwaGE7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gaW5pdGlhbGl6ZSgpIHtcbiAgICBpZiAoIW5vZGVzKSByZXR1cm47XG4gICAgdmFyIGksIG4gPSBub2Rlcy5sZW5ndGg7XG4gICAgc3RyZW5ndGhzID0gbmV3IEFycmF5KG4pO1xuICAgIHh6ID0gbmV3IEFycmF5KG4pO1xuICAgIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIHN0cmVuZ3Roc1tpXSA9IGlzTmFOKHh6W2ldID0gK3gobm9kZXNbaV0sIGksIG5vZGVzKSkgPyAwIDogK3N0cmVuZ3RoKG5vZGVzW2ldLCBpLCBub2Rlcyk7XG4gICAgfVxuICB9XG5cbiAgZm9yY2UuaW5pdGlhbGl6ZSA9IGZ1bmN0aW9uKF8pIHtcbiAgICBub2RlcyA9IF87XG4gICAgaW5pdGlhbGl6ZSgpO1xuICB9O1xuXG4gIGZvcmNlLnN0cmVuZ3RoID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHN0cmVuZ3RoID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudCgrXyksIGluaXRpYWxpemUoKSwgZm9yY2UpIDogc3RyZW5ndGg7XG4gIH07XG5cbiAgZm9yY2UueCA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/ICh4ID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudCgrXyksIGluaXRpYWxpemUoKSwgZm9yY2UpIDogeDtcbiAgfTtcblxuICByZXR1cm4gZm9yY2U7XG59XG4iLCAiaW1wb3J0IGNvbnN0YW50IGZyb20gXCIuL2NvbnN0YW50LmpzXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHkpIHtcbiAgdmFyIHN0cmVuZ3RoID0gY29uc3RhbnQoMC4xKSxcbiAgICAgIG5vZGVzLFxuICAgICAgc3RyZW5ndGhzLFxuICAgICAgeXo7XG5cbiAgaWYgKHR5cGVvZiB5ICE9PSBcImZ1bmN0aW9uXCIpIHkgPSBjb25zdGFudCh5ID09IG51bGwgPyAwIDogK3kpO1xuXG4gIGZ1bmN0aW9uIGZvcmNlKGFscGhhKSB7XG4gICAgZm9yICh2YXIgaSA9IDAsIG4gPSBub2Rlcy5sZW5ndGgsIG5vZGU7IGkgPCBuOyArK2kpIHtcbiAgICAgIG5vZGUgPSBub2Rlc1tpXSwgbm9kZS52eSArPSAoeXpbaV0gLSBub2RlLnkpICogc3RyZW5ndGhzW2ldICogYWxwaGE7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gaW5pdGlhbGl6ZSgpIHtcbiAgICBpZiAoIW5vZGVzKSByZXR1cm47XG4gICAgdmFyIGksIG4gPSBub2Rlcy5sZW5ndGg7XG4gICAgc3RyZW5ndGhzID0gbmV3IEFycmF5KG4pO1xuICAgIHl6ID0gbmV3IEFycmF5KG4pO1xuICAgIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIHN0cmVuZ3Roc1tpXSA9IGlzTmFOKHl6W2ldID0gK3kobm9kZXNbaV0sIGksIG5vZGVzKSkgPyAwIDogK3N0cmVuZ3RoKG5vZGVzW2ldLCBpLCBub2Rlcyk7XG4gICAgfVxuICB9XG5cbiAgZm9yY2UuaW5pdGlhbGl6ZSA9IGZ1bmN0aW9uKF8pIHtcbiAgICBub2RlcyA9IF87XG4gICAgaW5pdGlhbGl6ZSgpO1xuICB9O1xuXG4gIGZvcmNlLnN0cmVuZ3RoID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHN0cmVuZ3RoID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudCgrXyksIGluaXRpYWxpemUoKSwgZm9yY2UpIDogc3RyZW5ndGg7XG4gIH07XG5cbiAgZm9yY2UueSA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/ICh5ID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudCgrXyksIGluaXRpYWxpemUoKSwgZm9yY2UpIDogeTtcbiAgfTtcblxuICByZXR1cm4gZm9yY2U7XG59XG4iLCAiZXhwb3J0IGRlZmF1bHQgeCA9PiAoKSA9PiB4O1xuIiwgImV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIFpvb21FdmVudCh0eXBlLCB7XG4gIHNvdXJjZUV2ZW50LFxuICB0YXJnZXQsXG4gIHRyYW5zZm9ybSxcbiAgZGlzcGF0Y2hcbn0pIHtcbiAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXModGhpcywge1xuICAgIHR5cGU6IHt2YWx1ZTogdHlwZSwgZW51bWVyYWJsZTogdHJ1ZSwgY29uZmlndXJhYmxlOiB0cnVlfSxcbiAgICBzb3VyY2VFdmVudDoge3ZhbHVlOiBzb3VyY2VFdmVudCwgZW51bWVyYWJsZTogdHJ1ZSwgY29uZmlndXJhYmxlOiB0cnVlfSxcbiAgICB0YXJnZXQ6IHt2YWx1ZTogdGFyZ2V0LCBlbnVtZXJhYmxlOiB0cnVlLCBjb25maWd1cmFibGU6IHRydWV9LFxuICAgIHRyYW5zZm9ybToge3ZhbHVlOiB0cmFuc2Zvcm0sIGVudW1lcmFibGU6IHRydWUsIGNvbmZpZ3VyYWJsZTogdHJ1ZX0sXG4gICAgXzoge3ZhbHVlOiBkaXNwYXRjaH1cbiAgfSk7XG59XG4iLCAiZXhwb3J0IGZ1bmN0aW9uIFRyYW5zZm9ybShrLCB4LCB5KSB7XG4gIHRoaXMuayA9IGs7XG4gIHRoaXMueCA9IHg7XG4gIHRoaXMueSA9IHk7XG59XG5cblRyYW5zZm9ybS5wcm90b3R5cGUgPSB7XG4gIGNvbnN0cnVjdG9yOiBUcmFuc2Zvcm0sXG4gIHNjYWxlOiBmdW5jdGlvbihrKSB7XG4gICAgcmV0dXJuIGsgPT09IDEgPyB0aGlzIDogbmV3IFRyYW5zZm9ybSh0aGlzLmsgKiBrLCB0aGlzLngsIHRoaXMueSk7XG4gIH0sXG4gIHRyYW5zbGF0ZTogZnVuY3Rpb24oeCwgeSkge1xuICAgIHJldHVybiB4ID09PSAwICYgeSA9PT0gMCA/IHRoaXMgOiBuZXcgVHJhbnNmb3JtKHRoaXMuaywgdGhpcy54ICsgdGhpcy5rICogeCwgdGhpcy55ICsgdGhpcy5rICogeSk7XG4gIH0sXG4gIGFwcGx5OiBmdW5jdGlvbihwb2ludCkge1xuICAgIHJldHVybiBbcG9pbnRbMF0gKiB0aGlzLmsgKyB0aGlzLngsIHBvaW50WzFdICogdGhpcy5rICsgdGhpcy55XTtcbiAgfSxcbiAgYXBwbHlYOiBmdW5jdGlvbih4KSB7XG4gICAgcmV0dXJuIHggKiB0aGlzLmsgKyB0aGlzLng7XG4gIH0sXG4gIGFwcGx5WTogZnVuY3Rpb24oeSkge1xuICAgIHJldHVybiB5ICogdGhpcy5rICsgdGhpcy55O1xuICB9LFxuICBpbnZlcnQ6IGZ1bmN0aW9uKGxvY2F0aW9uKSB7XG4gICAgcmV0dXJuIFsobG9jYXRpb25bMF0gLSB0aGlzLngpIC8gdGhpcy5rLCAobG9jYXRpb25bMV0gLSB0aGlzLnkpIC8gdGhpcy5rXTtcbiAgfSxcbiAgaW52ZXJ0WDogZnVuY3Rpb24oeCkge1xuICAgIHJldHVybiAoeCAtIHRoaXMueCkgLyB0aGlzLms7XG4gIH0sXG4gIGludmVydFk6IGZ1bmN0aW9uKHkpIHtcbiAgICByZXR1cm4gKHkgLSB0aGlzLnkpIC8gdGhpcy5rO1xuICB9LFxuICByZXNjYWxlWDogZnVuY3Rpb24oeCkge1xuICAgIHJldHVybiB4LmNvcHkoKS5kb21haW4oeC5yYW5nZSgpLm1hcCh0aGlzLmludmVydFgsIHRoaXMpLm1hcCh4LmludmVydCwgeCkpO1xuICB9LFxuICByZXNjYWxlWTogZnVuY3Rpb24oeSkge1xuICAgIHJldHVybiB5LmNvcHkoKS5kb21haW4oeS5yYW5nZSgpLm1hcCh0aGlzLmludmVydFksIHRoaXMpLm1hcCh5LmludmVydCwgeSkpO1xuICB9LFxuICB0b1N0cmluZzogZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIFwidHJhbnNsYXRlKFwiICsgdGhpcy54ICsgXCIsXCIgKyB0aGlzLnkgKyBcIikgc2NhbGUoXCIgKyB0aGlzLmsgKyBcIilcIjtcbiAgfVxufTtcblxuZXhwb3J0IHZhciBpZGVudGl0eSA9IG5ldyBUcmFuc2Zvcm0oMSwgMCwgMCk7XG5cbnRyYW5zZm9ybS5wcm90b3R5cGUgPSBUcmFuc2Zvcm0ucHJvdG90eXBlO1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiB0cmFuc2Zvcm0obm9kZSkge1xuICB3aGlsZSAoIW5vZGUuX196b29tKSBpZiAoIShub2RlID0gbm9kZS5wYXJlbnROb2RlKSkgcmV0dXJuIGlkZW50aXR5O1xuICByZXR1cm4gbm9kZS5fX3pvb207XG59XG4iLCAiZXhwb3J0IGZ1bmN0aW9uIG5vcHJvcGFnYXRpb24oZXZlbnQpIHtcbiAgZXZlbnQuc3RvcEltbWVkaWF0ZVByb3BhZ2F0aW9uKCk7XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKGV2ZW50KSB7XG4gIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gIGV2ZW50LnN0b3BJbW1lZGlhdGVQcm9wYWdhdGlvbigpO1xufVxuIiwgImltcG9ydCB7ZGlzcGF0Y2h9IGZyb20gXCJkMy1kaXNwYXRjaFwiO1xuaW1wb3J0IHtkcmFnRGlzYWJsZSwgZHJhZ0VuYWJsZX0gZnJvbSBcImQzLWRyYWdcIjtcbmltcG9ydCB7aW50ZXJwb2xhdGVab29tfSBmcm9tIFwiZDMtaW50ZXJwb2xhdGVcIjtcbmltcG9ydCB7c2VsZWN0LCBwb2ludGVyfSBmcm9tIFwiZDMtc2VsZWN0aW9uXCI7XG5pbXBvcnQge2ludGVycnVwdH0gZnJvbSBcImQzLXRyYW5zaXRpb25cIjtcbmltcG9ydCBjb25zdGFudCBmcm9tIFwiLi9jb25zdGFudC5qc1wiO1xuaW1wb3J0IFpvb21FdmVudCBmcm9tIFwiLi9ldmVudC5qc1wiO1xuaW1wb3J0IHtUcmFuc2Zvcm0sIGlkZW50aXR5fSBmcm9tIFwiLi90cmFuc2Zvcm0uanNcIjtcbmltcG9ydCBub2V2ZW50LCB7bm9wcm9wYWdhdGlvbn0gZnJvbSBcIi4vbm9ldmVudC5qc1wiO1xuXG4vLyBJZ25vcmUgcmlnaHQtY2xpY2ssIHNpbmNlIHRoYXQgc2hvdWxkIG9wZW4gdGhlIGNvbnRleHQgbWVudS5cbi8vIGV4Y2VwdCBmb3IgcGluY2gtdG8tem9vbSwgd2hpY2ggaXMgc2VudCBhcyBhIHdoZWVsK2N0cmxLZXkgZXZlbnRcbmZ1bmN0aW9uIGRlZmF1bHRGaWx0ZXIoZXZlbnQpIHtcbiAgcmV0dXJuICghZXZlbnQuY3RybEtleSB8fCBldmVudC50eXBlID09PSAnd2hlZWwnKSAmJiAhZXZlbnQuYnV0dG9uO1xufVxuXG5mdW5jdGlvbiBkZWZhdWx0RXh0ZW50KCkge1xuICB2YXIgZSA9IHRoaXM7XG4gIGlmIChlIGluc3RhbmNlb2YgU1ZHRWxlbWVudCkge1xuICAgIGUgPSBlLm93bmVyU1ZHRWxlbWVudCB8fCBlO1xuICAgIGlmIChlLmhhc0F0dHJpYnV0ZShcInZpZXdCb3hcIikpIHtcbiAgICAgIGUgPSBlLnZpZXdCb3guYmFzZVZhbDtcbiAgICAgIHJldHVybiBbW2UueCwgZS55XSwgW2UueCArIGUud2lkdGgsIGUueSArIGUuaGVpZ2h0XV07XG4gICAgfVxuICAgIHJldHVybiBbWzAsIDBdLCBbZS53aWR0aC5iYXNlVmFsLnZhbHVlLCBlLmhlaWdodC5iYXNlVmFsLnZhbHVlXV07XG4gIH1cbiAgcmV0dXJuIFtbMCwgMF0sIFtlLmNsaWVudFdpZHRoLCBlLmNsaWVudEhlaWdodF1dO1xufVxuXG5mdW5jdGlvbiBkZWZhdWx0VHJhbnNmb3JtKCkge1xuICByZXR1cm4gdGhpcy5fX3pvb20gfHwgaWRlbnRpdHk7XG59XG5cbmZ1bmN0aW9uIGRlZmF1bHRXaGVlbERlbHRhKGV2ZW50KSB7XG4gIHJldHVybiAtZXZlbnQuZGVsdGFZICogKGV2ZW50LmRlbHRhTW9kZSA9PT0gMSA/IDAuMDUgOiBldmVudC5kZWx0YU1vZGUgPyAxIDogMC4wMDIpICogKGV2ZW50LmN0cmxLZXkgPyAxMCA6IDEpO1xufVxuXG5mdW5jdGlvbiBkZWZhdWx0VG91Y2hhYmxlKCkge1xuICByZXR1cm4gbmF2aWdhdG9yLm1heFRvdWNoUG9pbnRzIHx8IChcIm9udG91Y2hzdGFydFwiIGluIHRoaXMpO1xufVxuXG5mdW5jdGlvbiBkZWZhdWx0Q29uc3RyYWluKHRyYW5zZm9ybSwgZXh0ZW50LCB0cmFuc2xhdGVFeHRlbnQpIHtcbiAgdmFyIGR4MCA9IHRyYW5zZm9ybS5pbnZlcnRYKGV4dGVudFswXVswXSkgLSB0cmFuc2xhdGVFeHRlbnRbMF1bMF0sXG4gICAgICBkeDEgPSB0cmFuc2Zvcm0uaW52ZXJ0WChleHRlbnRbMV1bMF0pIC0gdHJhbnNsYXRlRXh0ZW50WzFdWzBdLFxuICAgICAgZHkwID0gdHJhbnNmb3JtLmludmVydFkoZXh0ZW50WzBdWzFdKSAtIHRyYW5zbGF0ZUV4dGVudFswXVsxXSxcbiAgICAgIGR5MSA9IHRyYW5zZm9ybS5pbnZlcnRZKGV4dGVudFsxXVsxXSkgLSB0cmFuc2xhdGVFeHRlbnRbMV1bMV07XG4gIHJldHVybiB0cmFuc2Zvcm0udHJhbnNsYXRlKFxuICAgIGR4MSA+IGR4MCA/IChkeDAgKyBkeDEpIC8gMiA6IE1hdGgubWluKDAsIGR4MCkgfHwgTWF0aC5tYXgoMCwgZHgxKSxcbiAgICBkeTEgPiBkeTAgPyAoZHkwICsgZHkxKSAvIDIgOiBNYXRoLm1pbigwLCBkeTApIHx8IE1hdGgubWF4KDAsIGR5MSlcbiAgKTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24oKSB7XG4gIHZhciBmaWx0ZXIgPSBkZWZhdWx0RmlsdGVyLFxuICAgICAgZXh0ZW50ID0gZGVmYXVsdEV4dGVudCxcbiAgICAgIGNvbnN0cmFpbiA9IGRlZmF1bHRDb25zdHJhaW4sXG4gICAgICB3aGVlbERlbHRhID0gZGVmYXVsdFdoZWVsRGVsdGEsXG4gICAgICB0b3VjaGFibGUgPSBkZWZhdWx0VG91Y2hhYmxlLFxuICAgICAgc2NhbGVFeHRlbnQgPSBbMCwgSW5maW5pdHldLFxuICAgICAgdHJhbnNsYXRlRXh0ZW50ID0gW1stSW5maW5pdHksIC1JbmZpbml0eV0sIFtJbmZpbml0eSwgSW5maW5pdHldXSxcbiAgICAgIGR1cmF0aW9uID0gMjUwLFxuICAgICAgaW50ZXJwb2xhdGUgPSBpbnRlcnBvbGF0ZVpvb20sXG4gICAgICBsaXN0ZW5lcnMgPSBkaXNwYXRjaChcInN0YXJ0XCIsIFwiem9vbVwiLCBcImVuZFwiKSxcbiAgICAgIHRvdWNoc3RhcnRpbmcsXG4gICAgICB0b3VjaGZpcnN0LFxuICAgICAgdG91Y2hlbmRpbmcsXG4gICAgICB0b3VjaERlbGF5ID0gNTAwLFxuICAgICAgd2hlZWxEZWxheSA9IDE1MCxcbiAgICAgIGNsaWNrRGlzdGFuY2UyID0gMCxcbiAgICAgIHRhcERpc3RhbmNlID0gMTA7XG5cbiAgZnVuY3Rpb24gem9vbShzZWxlY3Rpb24pIHtcbiAgICBzZWxlY3Rpb25cbiAgICAgICAgLnByb3BlcnR5KFwiX196b29tXCIsIGRlZmF1bHRUcmFuc2Zvcm0pXG4gICAgICAgIC5vbihcIndoZWVsLnpvb21cIiwgd2hlZWxlZCwge3Bhc3NpdmU6IGZhbHNlfSlcbiAgICAgICAgLm9uKFwibW91c2Vkb3duLnpvb21cIiwgbW91c2Vkb3duZWQpXG4gICAgICAgIC5vbihcImRibGNsaWNrLnpvb21cIiwgZGJsY2xpY2tlZClcbiAgICAgIC5maWx0ZXIodG91Y2hhYmxlKVxuICAgICAgICAub24oXCJ0b3VjaHN0YXJ0Lnpvb21cIiwgdG91Y2hzdGFydGVkKVxuICAgICAgICAub24oXCJ0b3VjaG1vdmUuem9vbVwiLCB0b3VjaG1vdmVkKVxuICAgICAgICAub24oXCJ0b3VjaGVuZC56b29tIHRvdWNoY2FuY2VsLnpvb21cIiwgdG91Y2hlbmRlZClcbiAgICAgICAgLnN0eWxlKFwiLXdlYmtpdC10YXAtaGlnaGxpZ2h0LWNvbG9yXCIsIFwicmdiYSgwLDAsMCwwKVwiKTtcbiAgfVxuXG4gIHpvb20udHJhbnNmb3JtID0gZnVuY3Rpb24oY29sbGVjdGlvbiwgdHJhbnNmb3JtLCBwb2ludCwgZXZlbnQpIHtcbiAgICB2YXIgc2VsZWN0aW9uID0gY29sbGVjdGlvbi5zZWxlY3Rpb24gPyBjb2xsZWN0aW9uLnNlbGVjdGlvbigpIDogY29sbGVjdGlvbjtcbiAgICBzZWxlY3Rpb24ucHJvcGVydHkoXCJfX3pvb21cIiwgZGVmYXVsdFRyYW5zZm9ybSk7XG4gICAgaWYgKGNvbGxlY3Rpb24gIT09IHNlbGVjdGlvbikge1xuICAgICAgc2NoZWR1bGUoY29sbGVjdGlvbiwgdHJhbnNmb3JtLCBwb2ludCwgZXZlbnQpO1xuICAgIH0gZWxzZSB7XG4gICAgICBzZWxlY3Rpb24uaW50ZXJydXB0KCkuZWFjaChmdW5jdGlvbigpIHtcbiAgICAgICAgZ2VzdHVyZSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgICAgLmV2ZW50KGV2ZW50KVxuICAgICAgICAgIC5zdGFydCgpXG4gICAgICAgICAgLnpvb20obnVsbCwgdHlwZW9mIHRyYW5zZm9ybSA9PT0gXCJmdW5jdGlvblwiID8gdHJhbnNmb3JtLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgOiB0cmFuc2Zvcm0pXG4gICAgICAgICAgLmVuZCgpO1xuICAgICAgfSk7XG4gICAgfVxuICB9O1xuXG4gIHpvb20uc2NhbGVCeSA9IGZ1bmN0aW9uKHNlbGVjdGlvbiwgaywgcCwgZXZlbnQpIHtcbiAgICB6b29tLnNjYWxlVG8oc2VsZWN0aW9uLCBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBrMCA9IHRoaXMuX196b29tLmssXG4gICAgICAgICAgazEgPSB0eXBlb2YgayA9PT0gXCJmdW5jdGlvblwiID8gay5hcHBseSh0aGlzLCBhcmd1bWVudHMpIDogaztcbiAgICAgIHJldHVybiBrMCAqIGsxO1xuICAgIH0sIHAsIGV2ZW50KTtcbiAgfTtcblxuICB6b29tLnNjYWxlVG8gPSBmdW5jdGlvbihzZWxlY3Rpb24sIGssIHAsIGV2ZW50KSB7XG4gICAgem9vbS50cmFuc2Zvcm0oc2VsZWN0aW9uLCBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBlID0gZXh0ZW50LmFwcGx5KHRoaXMsIGFyZ3VtZW50cyksXG4gICAgICAgICAgdDAgPSB0aGlzLl9fem9vbSxcbiAgICAgICAgICBwMCA9IHAgPT0gbnVsbCA/IGNlbnRyb2lkKGUpIDogdHlwZW9mIHAgPT09IFwiZnVuY3Rpb25cIiA/IHAuYXBwbHkodGhpcywgYXJndW1lbnRzKSA6IHAsXG4gICAgICAgICAgcDEgPSB0MC5pbnZlcnQocDApLFxuICAgICAgICAgIGsxID0gdHlwZW9mIGsgPT09IFwiZnVuY3Rpb25cIiA/IGsuYXBwbHkodGhpcywgYXJndW1lbnRzKSA6IGs7XG4gICAgICByZXR1cm4gY29uc3RyYWluKHRyYW5zbGF0ZShzY2FsZSh0MCwgazEpLCBwMCwgcDEpLCBlLCB0cmFuc2xhdGVFeHRlbnQpO1xuICAgIH0sIHAsIGV2ZW50KTtcbiAgfTtcblxuICB6b29tLnRyYW5zbGF0ZUJ5ID0gZnVuY3Rpb24oc2VsZWN0aW9uLCB4LCB5LCBldmVudCkge1xuICAgIHpvb20udHJhbnNmb3JtKHNlbGVjdGlvbiwgZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gY29uc3RyYWluKHRoaXMuX196b29tLnRyYW5zbGF0ZShcbiAgICAgICAgdHlwZW9mIHggPT09IFwiZnVuY3Rpb25cIiA/IHguYXBwbHkodGhpcywgYXJndW1lbnRzKSA6IHgsXG4gICAgICAgIHR5cGVvZiB5ID09PSBcImZ1bmN0aW9uXCIgPyB5LmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgOiB5XG4gICAgICApLCBleHRlbnQuYXBwbHkodGhpcywgYXJndW1lbnRzKSwgdHJhbnNsYXRlRXh0ZW50KTtcbiAgICB9LCBudWxsLCBldmVudCk7XG4gIH07XG5cbiAgem9vbS50cmFuc2xhdGVUbyA9IGZ1bmN0aW9uKHNlbGVjdGlvbiwgeCwgeSwgcCwgZXZlbnQpIHtcbiAgICB6b29tLnRyYW5zZm9ybShzZWxlY3Rpb24sIGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIGUgPSBleHRlbnQuYXBwbHkodGhpcywgYXJndW1lbnRzKSxcbiAgICAgICAgICB0ID0gdGhpcy5fX3pvb20sXG4gICAgICAgICAgcDAgPSBwID09IG51bGwgPyBjZW50cm9pZChlKSA6IHR5cGVvZiBwID09PSBcImZ1bmN0aW9uXCIgPyBwLmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgOiBwO1xuICAgICAgcmV0dXJuIGNvbnN0cmFpbihpZGVudGl0eS50cmFuc2xhdGUocDBbMF0sIHAwWzFdKS5zY2FsZSh0LmspLnRyYW5zbGF0ZShcbiAgICAgICAgdHlwZW9mIHggPT09IFwiZnVuY3Rpb25cIiA/IC14LmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgOiAteCxcbiAgICAgICAgdHlwZW9mIHkgPT09IFwiZnVuY3Rpb25cIiA/IC15LmFwcGx5KHRoaXMsIGFyZ3VtZW50cykgOiAteVxuICAgICAgKSwgZSwgdHJhbnNsYXRlRXh0ZW50KTtcbiAgICB9LCBwLCBldmVudCk7XG4gIH07XG5cbiAgZnVuY3Rpb24gc2NhbGUodHJhbnNmb3JtLCBrKSB7XG4gICAgayA9IE1hdGgubWF4KHNjYWxlRXh0ZW50WzBdLCBNYXRoLm1pbihzY2FsZUV4dGVudFsxXSwgaykpO1xuICAgIHJldHVybiBrID09PSB0cmFuc2Zvcm0uayA/IHRyYW5zZm9ybSA6IG5ldyBUcmFuc2Zvcm0oaywgdHJhbnNmb3JtLngsIHRyYW5zZm9ybS55KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHRyYW5zbGF0ZSh0cmFuc2Zvcm0sIHAwLCBwMSkge1xuICAgIHZhciB4ID0gcDBbMF0gLSBwMVswXSAqIHRyYW5zZm9ybS5rLCB5ID0gcDBbMV0gLSBwMVsxXSAqIHRyYW5zZm9ybS5rO1xuICAgIHJldHVybiB4ID09PSB0cmFuc2Zvcm0ueCAmJiB5ID09PSB0cmFuc2Zvcm0ueSA/IHRyYW5zZm9ybSA6IG5ldyBUcmFuc2Zvcm0odHJhbnNmb3JtLmssIHgsIHkpO1xuICB9XG5cbiAgZnVuY3Rpb24gY2VudHJvaWQoZXh0ZW50KSB7XG4gICAgcmV0dXJuIFsoK2V4dGVudFswXVswXSArICtleHRlbnRbMV1bMF0pIC8gMiwgKCtleHRlbnRbMF1bMV0gKyArZXh0ZW50WzFdWzFdKSAvIDJdO1xuICB9XG5cbiAgZnVuY3Rpb24gc2NoZWR1bGUodHJhbnNpdGlvbiwgdHJhbnNmb3JtLCBwb2ludCwgZXZlbnQpIHtcbiAgICB0cmFuc2l0aW9uXG4gICAgICAgIC5vbihcInN0YXJ0Lnpvb21cIiwgZnVuY3Rpb24oKSB7IGdlc3R1cmUodGhpcywgYXJndW1lbnRzKS5ldmVudChldmVudCkuc3RhcnQoKTsgfSlcbiAgICAgICAgLm9uKFwiaW50ZXJydXB0Lnpvb20gZW5kLnpvb21cIiwgZnVuY3Rpb24oKSB7IGdlc3R1cmUodGhpcywgYXJndW1lbnRzKS5ldmVudChldmVudCkuZW5kKCk7IH0pXG4gICAgICAgIC50d2VlbihcInpvb21cIiwgZnVuY3Rpb24oKSB7XG4gICAgICAgICAgdmFyIHRoYXQgPSB0aGlzLFxuICAgICAgICAgICAgICBhcmdzID0gYXJndW1lbnRzLFxuICAgICAgICAgICAgICBnID0gZ2VzdHVyZSh0aGF0LCBhcmdzKS5ldmVudChldmVudCksXG4gICAgICAgICAgICAgIGUgPSBleHRlbnQuYXBwbHkodGhhdCwgYXJncyksXG4gICAgICAgICAgICAgIHAgPSBwb2ludCA9PSBudWxsID8gY2VudHJvaWQoZSkgOiB0eXBlb2YgcG9pbnQgPT09IFwiZnVuY3Rpb25cIiA/IHBvaW50LmFwcGx5KHRoYXQsIGFyZ3MpIDogcG9pbnQsXG4gICAgICAgICAgICAgIHcgPSBNYXRoLm1heChlWzFdWzBdIC0gZVswXVswXSwgZVsxXVsxXSAtIGVbMF1bMV0pLFxuICAgICAgICAgICAgICBhID0gdGhhdC5fX3pvb20sXG4gICAgICAgICAgICAgIGIgPSB0eXBlb2YgdHJhbnNmb3JtID09PSBcImZ1bmN0aW9uXCIgPyB0cmFuc2Zvcm0uYXBwbHkodGhhdCwgYXJncykgOiB0cmFuc2Zvcm0sXG4gICAgICAgICAgICAgIGkgPSBpbnRlcnBvbGF0ZShhLmludmVydChwKS5jb25jYXQodyAvIGEuayksIGIuaW52ZXJ0KHApLmNvbmNhdCh3IC8gYi5rKSk7XG4gICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uKHQpIHtcbiAgICAgICAgICAgIGlmICh0ID09PSAxKSB0ID0gYjsgLy8gQXZvaWQgcm91bmRpbmcgZXJyb3Igb24gZW5kLlxuICAgICAgICAgICAgZWxzZSB7IHZhciBsID0gaSh0KSwgayA9IHcgLyBsWzJdOyB0ID0gbmV3IFRyYW5zZm9ybShrLCBwWzBdIC0gbFswXSAqIGssIHBbMV0gLSBsWzFdICogayk7IH1cbiAgICAgICAgICAgIGcuem9vbShudWxsLCB0KTtcbiAgICAgICAgICB9O1xuICAgICAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGdlc3R1cmUodGhhdCwgYXJncywgY2xlYW4pIHtcbiAgICByZXR1cm4gKCFjbGVhbiAmJiB0aGF0Ll9fem9vbWluZykgfHwgbmV3IEdlc3R1cmUodGhhdCwgYXJncyk7XG4gIH1cblxuICBmdW5jdGlvbiBHZXN0dXJlKHRoYXQsIGFyZ3MpIHtcbiAgICB0aGlzLnRoYXQgPSB0aGF0O1xuICAgIHRoaXMuYXJncyA9IGFyZ3M7XG4gICAgdGhpcy5hY3RpdmUgPSAwO1xuICAgIHRoaXMuc291cmNlRXZlbnQgPSBudWxsO1xuICAgIHRoaXMuZXh0ZW50ID0gZXh0ZW50LmFwcGx5KHRoYXQsIGFyZ3MpO1xuICAgIHRoaXMudGFwcyA9IDA7XG4gIH1cblxuICBHZXN0dXJlLnByb3RvdHlwZSA9IHtcbiAgICBldmVudDogZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgIGlmIChldmVudCkgdGhpcy5zb3VyY2VFdmVudCA9IGV2ZW50O1xuICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfSxcbiAgICBzdGFydDogZnVuY3Rpb24oKSB7XG4gICAgICBpZiAoKyt0aGlzLmFjdGl2ZSA9PT0gMSkge1xuICAgICAgICB0aGlzLnRoYXQuX196b29taW5nID0gdGhpcztcbiAgICAgICAgdGhpcy5lbWl0KFwic3RhcnRcIik7XG4gICAgICB9XG4gICAgICByZXR1cm4gdGhpcztcbiAgICB9LFxuICAgIHpvb206IGZ1bmN0aW9uKGtleSwgdHJhbnNmb3JtKSB7XG4gICAgICBpZiAodGhpcy5tb3VzZSAmJiBrZXkgIT09IFwibW91c2VcIikgdGhpcy5tb3VzZVsxXSA9IHRyYW5zZm9ybS5pbnZlcnQodGhpcy5tb3VzZVswXSk7XG4gICAgICBpZiAodGhpcy50b3VjaDAgJiYga2V5ICE9PSBcInRvdWNoXCIpIHRoaXMudG91Y2gwWzFdID0gdHJhbnNmb3JtLmludmVydCh0aGlzLnRvdWNoMFswXSk7XG4gICAgICBpZiAodGhpcy50b3VjaDEgJiYga2V5ICE9PSBcInRvdWNoXCIpIHRoaXMudG91Y2gxWzFdID0gdHJhbnNmb3JtLmludmVydCh0aGlzLnRvdWNoMVswXSk7XG4gICAgICB0aGlzLnRoYXQuX196b29tID0gdHJhbnNmb3JtO1xuICAgICAgdGhpcy5lbWl0KFwiem9vbVwiKTtcbiAgICAgIHJldHVybiB0aGlzO1xuICAgIH0sXG4gICAgZW5kOiBmdW5jdGlvbigpIHtcbiAgICAgIGlmICgtLXRoaXMuYWN0aXZlID09PSAwKSB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLnRoYXQuX196b29taW5nO1xuICAgICAgICB0aGlzLmVtaXQoXCJlbmRcIik7XG4gICAgICB9XG4gICAgICByZXR1cm4gdGhpcztcbiAgICB9LFxuICAgIGVtaXQ6IGZ1bmN0aW9uKHR5cGUpIHtcbiAgICAgIHZhciBkID0gc2VsZWN0KHRoaXMudGhhdCkuZGF0dW0oKTtcbiAgICAgIGxpc3RlbmVycy5jYWxsKFxuICAgICAgICB0eXBlLFxuICAgICAgICB0aGlzLnRoYXQsXG4gICAgICAgIG5ldyBab29tRXZlbnQodHlwZSwge1xuICAgICAgICAgIHNvdXJjZUV2ZW50OiB0aGlzLnNvdXJjZUV2ZW50LFxuICAgICAgICAgIHRhcmdldDogem9vbSxcbiAgICAgICAgICB0eXBlLFxuICAgICAgICAgIHRyYW5zZm9ybTogdGhpcy50aGF0Ll9fem9vbSxcbiAgICAgICAgICBkaXNwYXRjaDogbGlzdGVuZXJzXG4gICAgICAgIH0pLFxuICAgICAgICBkXG4gICAgICApO1xuICAgIH1cbiAgfTtcblxuICBmdW5jdGlvbiB3aGVlbGVkKGV2ZW50LCAuLi5hcmdzKSB7XG4gICAgaWYgKCFmaWx0ZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKSkgcmV0dXJuO1xuICAgIHZhciBnID0gZ2VzdHVyZSh0aGlzLCBhcmdzKS5ldmVudChldmVudCksXG4gICAgICAgIHQgPSB0aGlzLl9fem9vbSxcbiAgICAgICAgayA9IE1hdGgubWF4KHNjYWxlRXh0ZW50WzBdLCBNYXRoLm1pbihzY2FsZUV4dGVudFsxXSwgdC5rICogTWF0aC5wb3coMiwgd2hlZWxEZWx0YS5hcHBseSh0aGlzLCBhcmd1bWVudHMpKSkpLFxuICAgICAgICBwID0gcG9pbnRlcihldmVudCk7XG5cbiAgICAvLyBJZiB0aGUgbW91c2UgaXMgaW4gdGhlIHNhbWUgbG9jYXRpb24gYXMgYmVmb3JlLCByZXVzZSBpdC5cbiAgICAvLyBJZiB0aGVyZSB3ZXJlIHJlY2VudCB3aGVlbCBldmVudHMsIHJlc2V0IHRoZSB3aGVlbCBpZGxlIHRpbWVvdXQuXG4gICAgaWYgKGcud2hlZWwpIHtcbiAgICAgIGlmIChnLm1vdXNlWzBdWzBdICE9PSBwWzBdIHx8IGcubW91c2VbMF1bMV0gIT09IHBbMV0pIHtcbiAgICAgICAgZy5tb3VzZVsxXSA9IHQuaW52ZXJ0KGcubW91c2VbMF0gPSBwKTtcbiAgICAgIH1cbiAgICAgIGNsZWFyVGltZW91dChnLndoZWVsKTtcbiAgICB9XG5cbiAgICAvLyBJZiB0aGlzIHdoZWVsIGV2ZW50IHdvblx1MjAxOXQgdHJpZ2dlciBhIHRyYW5zZm9ybSBjaGFuZ2UsIGlnbm9yZSBpdC5cbiAgICBlbHNlIGlmICh0LmsgPT09IGspIHJldHVybjtcblxuICAgIC8vIE90aGVyd2lzZSwgY2FwdHVyZSB0aGUgbW91c2UgcG9pbnQgYW5kIGxvY2F0aW9uIGF0IHRoZSBzdGFydC5cbiAgICBlbHNlIHtcbiAgICAgIGcubW91c2UgPSBbcCwgdC5pbnZlcnQocCldO1xuICAgICAgaW50ZXJydXB0KHRoaXMpO1xuICAgICAgZy5zdGFydCgpO1xuICAgIH1cblxuICAgIG5vZXZlbnQoZXZlbnQpO1xuICAgIGcud2hlZWwgPSBzZXRUaW1lb3V0KHdoZWVsaWRsZWQsIHdoZWVsRGVsYXkpO1xuICAgIGcuem9vbShcIm1vdXNlXCIsIGNvbnN0cmFpbih0cmFuc2xhdGUoc2NhbGUodCwgayksIGcubW91c2VbMF0sIGcubW91c2VbMV0pLCBnLmV4dGVudCwgdHJhbnNsYXRlRXh0ZW50KSk7XG5cbiAgICBmdW5jdGlvbiB3aGVlbGlkbGVkKCkge1xuICAgICAgZy53aGVlbCA9IG51bGw7XG4gICAgICBnLmVuZCgpO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIG1vdXNlZG93bmVkKGV2ZW50LCAuLi5hcmdzKSB7XG4gICAgaWYgKHRvdWNoZW5kaW5nIHx8ICFmaWx0ZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKSkgcmV0dXJuO1xuICAgIHZhciBjdXJyZW50VGFyZ2V0ID0gZXZlbnQuY3VycmVudFRhcmdldCxcbiAgICAgICAgZyA9IGdlc3R1cmUodGhpcywgYXJncywgdHJ1ZSkuZXZlbnQoZXZlbnQpLFxuICAgICAgICB2ID0gc2VsZWN0KGV2ZW50LnZpZXcpLm9uKFwibW91c2Vtb3ZlLnpvb21cIiwgbW91c2Vtb3ZlZCwgdHJ1ZSkub24oXCJtb3VzZXVwLnpvb21cIiwgbW91c2V1cHBlZCwgdHJ1ZSksXG4gICAgICAgIHAgPSBwb2ludGVyKGV2ZW50LCBjdXJyZW50VGFyZ2V0KSxcbiAgICAgICAgeDAgPSBldmVudC5jbGllbnRYLFxuICAgICAgICB5MCA9IGV2ZW50LmNsaWVudFk7XG5cbiAgICBkcmFnRGlzYWJsZShldmVudC52aWV3KTtcbiAgICBub3Byb3BhZ2F0aW9uKGV2ZW50KTtcbiAgICBnLm1vdXNlID0gW3AsIHRoaXMuX196b29tLmludmVydChwKV07XG4gICAgaW50ZXJydXB0KHRoaXMpO1xuICAgIGcuc3RhcnQoKTtcblxuICAgIGZ1bmN0aW9uIG1vdXNlbW92ZWQoZXZlbnQpIHtcbiAgICAgIG5vZXZlbnQoZXZlbnQpO1xuICAgICAgaWYgKCFnLm1vdmVkKSB7XG4gICAgICAgIHZhciBkeCA9IGV2ZW50LmNsaWVudFggLSB4MCwgZHkgPSBldmVudC5jbGllbnRZIC0geTA7XG4gICAgICAgIGcubW92ZWQgPSBkeCAqIGR4ICsgZHkgKiBkeSA+IGNsaWNrRGlzdGFuY2UyO1xuICAgICAgfVxuICAgICAgZy5ldmVudChldmVudClcbiAgICAgICAuem9vbShcIm1vdXNlXCIsIGNvbnN0cmFpbih0cmFuc2xhdGUoZy50aGF0Ll9fem9vbSwgZy5tb3VzZVswXSA9IHBvaW50ZXIoZXZlbnQsIGN1cnJlbnRUYXJnZXQpLCBnLm1vdXNlWzFdKSwgZy5leHRlbnQsIHRyYW5zbGF0ZUV4dGVudCkpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG1vdXNldXBwZWQoZXZlbnQpIHtcbiAgICAgIHYub24oXCJtb3VzZW1vdmUuem9vbSBtb3VzZXVwLnpvb21cIiwgbnVsbCk7XG4gICAgICBkcmFnRW5hYmxlKGV2ZW50LnZpZXcsIGcubW92ZWQpO1xuICAgICAgbm9ldmVudChldmVudCk7XG4gICAgICBnLmV2ZW50KGV2ZW50KS5lbmQoKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBkYmxjbGlja2VkKGV2ZW50LCAuLi5hcmdzKSB7XG4gICAgaWYgKCFmaWx0ZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKSkgcmV0dXJuO1xuICAgIHZhciB0MCA9IHRoaXMuX196b29tLFxuICAgICAgICBwMCA9IHBvaW50ZXIoZXZlbnQuY2hhbmdlZFRvdWNoZXMgPyBldmVudC5jaGFuZ2VkVG91Y2hlc1swXSA6IGV2ZW50LCB0aGlzKSxcbiAgICAgICAgcDEgPSB0MC5pbnZlcnQocDApLFxuICAgICAgICBrMSA9IHQwLmsgKiAoZXZlbnQuc2hpZnRLZXkgPyAwLjUgOiAyKSxcbiAgICAgICAgdDEgPSBjb25zdHJhaW4odHJhbnNsYXRlKHNjYWxlKHQwLCBrMSksIHAwLCBwMSksIGV4dGVudC5hcHBseSh0aGlzLCBhcmdzKSwgdHJhbnNsYXRlRXh0ZW50KTtcblxuICAgIG5vZXZlbnQoZXZlbnQpO1xuICAgIGlmIChkdXJhdGlvbiA+IDApIHNlbGVjdCh0aGlzKS50cmFuc2l0aW9uKCkuZHVyYXRpb24oZHVyYXRpb24pLmNhbGwoc2NoZWR1bGUsIHQxLCBwMCwgZXZlbnQpO1xuICAgIGVsc2Ugc2VsZWN0KHRoaXMpLmNhbGwoem9vbS50cmFuc2Zvcm0sIHQxLCBwMCwgZXZlbnQpO1xuICB9XG5cbiAgZnVuY3Rpb24gdG91Y2hzdGFydGVkKGV2ZW50LCAuLi5hcmdzKSB7XG4gICAgaWYgKCFmaWx0ZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKSkgcmV0dXJuO1xuICAgIHZhciB0b3VjaGVzID0gZXZlbnQudG91Y2hlcyxcbiAgICAgICAgbiA9IHRvdWNoZXMubGVuZ3RoLFxuICAgICAgICBnID0gZ2VzdHVyZSh0aGlzLCBhcmdzLCBldmVudC5jaGFuZ2VkVG91Y2hlcy5sZW5ndGggPT09IG4pLmV2ZW50KGV2ZW50KSxcbiAgICAgICAgc3RhcnRlZCwgaSwgdCwgcDtcblxuICAgIG5vcHJvcGFnYXRpb24oZXZlbnQpO1xuICAgIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIHQgPSB0b3VjaGVzW2ldLCBwID0gcG9pbnRlcih0LCB0aGlzKTtcbiAgICAgIHAgPSBbcCwgdGhpcy5fX3pvb20uaW52ZXJ0KHApLCB0LmlkZW50aWZpZXJdO1xuICAgICAgaWYgKCFnLnRvdWNoMCkgZy50b3VjaDAgPSBwLCBzdGFydGVkID0gdHJ1ZSwgZy50YXBzID0gMSArICEhdG91Y2hzdGFydGluZztcbiAgICAgIGVsc2UgaWYgKCFnLnRvdWNoMSAmJiBnLnRvdWNoMFsyXSAhPT0gcFsyXSkgZy50b3VjaDEgPSBwLCBnLnRhcHMgPSAwO1xuICAgIH1cblxuICAgIGlmICh0b3VjaHN0YXJ0aW5nKSB0b3VjaHN0YXJ0aW5nID0gY2xlYXJUaW1lb3V0KHRvdWNoc3RhcnRpbmcpO1xuXG4gICAgaWYgKHN0YXJ0ZWQpIHtcbiAgICAgIGlmIChnLnRhcHMgPCAyKSB0b3VjaGZpcnN0ID0gcFswXSwgdG91Y2hzdGFydGluZyA9IHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7IHRvdWNoc3RhcnRpbmcgPSBudWxsOyB9LCB0b3VjaERlbGF5KTtcbiAgICAgIGludGVycnVwdCh0aGlzKTtcbiAgICAgIGcuc3RhcnQoKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiB0b3VjaG1vdmVkKGV2ZW50LCAuLi5hcmdzKSB7XG4gICAgaWYgKCF0aGlzLl9fem9vbWluZykgcmV0dXJuO1xuICAgIHZhciBnID0gZ2VzdHVyZSh0aGlzLCBhcmdzKS5ldmVudChldmVudCksXG4gICAgICAgIHRvdWNoZXMgPSBldmVudC5jaGFuZ2VkVG91Y2hlcyxcbiAgICAgICAgbiA9IHRvdWNoZXMubGVuZ3RoLCBpLCB0LCBwLCBsO1xuXG4gICAgbm9ldmVudChldmVudCk7XG4gICAgZm9yIChpID0gMDsgaSA8IG47ICsraSkge1xuICAgICAgdCA9IHRvdWNoZXNbaV0sIHAgPSBwb2ludGVyKHQsIHRoaXMpO1xuICAgICAgaWYgKGcudG91Y2gwICYmIGcudG91Y2gwWzJdID09PSB0LmlkZW50aWZpZXIpIGcudG91Y2gwWzBdID0gcDtcbiAgICAgIGVsc2UgaWYgKGcudG91Y2gxICYmIGcudG91Y2gxWzJdID09PSB0LmlkZW50aWZpZXIpIGcudG91Y2gxWzBdID0gcDtcbiAgICB9XG4gICAgdCA9IGcudGhhdC5fX3pvb207XG4gICAgaWYgKGcudG91Y2gxKSB7XG4gICAgICB2YXIgcDAgPSBnLnRvdWNoMFswXSwgbDAgPSBnLnRvdWNoMFsxXSxcbiAgICAgICAgICBwMSA9IGcudG91Y2gxWzBdLCBsMSA9IGcudG91Y2gxWzFdLFxuICAgICAgICAgIGRwID0gKGRwID0gcDFbMF0gLSBwMFswXSkgKiBkcCArIChkcCA9IHAxWzFdIC0gcDBbMV0pICogZHAsXG4gICAgICAgICAgZGwgPSAoZGwgPSBsMVswXSAtIGwwWzBdKSAqIGRsICsgKGRsID0gbDFbMV0gLSBsMFsxXSkgKiBkbDtcbiAgICAgIHQgPSBzY2FsZSh0LCBNYXRoLnNxcnQoZHAgLyBkbCkpO1xuICAgICAgcCA9IFsocDBbMF0gKyBwMVswXSkgLyAyLCAocDBbMV0gKyBwMVsxXSkgLyAyXTtcbiAgICAgIGwgPSBbKGwwWzBdICsgbDFbMF0pIC8gMiwgKGwwWzFdICsgbDFbMV0pIC8gMl07XG4gICAgfVxuICAgIGVsc2UgaWYgKGcudG91Y2gwKSBwID0gZy50b3VjaDBbMF0sIGwgPSBnLnRvdWNoMFsxXTtcbiAgICBlbHNlIHJldHVybjtcblxuICAgIGcuem9vbShcInRvdWNoXCIsIGNvbnN0cmFpbih0cmFuc2xhdGUodCwgcCwgbCksIGcuZXh0ZW50LCB0cmFuc2xhdGVFeHRlbnQpKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHRvdWNoZW5kZWQoZXZlbnQsIC4uLmFyZ3MpIHtcbiAgICBpZiAoIXRoaXMuX196b29taW5nKSByZXR1cm47XG4gICAgdmFyIGcgPSBnZXN0dXJlKHRoaXMsIGFyZ3MpLmV2ZW50KGV2ZW50KSxcbiAgICAgICAgdG91Y2hlcyA9IGV2ZW50LmNoYW5nZWRUb3VjaGVzLFxuICAgICAgICBuID0gdG91Y2hlcy5sZW5ndGgsIGksIHQ7XG5cbiAgICBub3Byb3BhZ2F0aW9uKGV2ZW50KTtcbiAgICBpZiAodG91Y2hlbmRpbmcpIGNsZWFyVGltZW91dCh0b3VjaGVuZGluZyk7XG4gICAgdG91Y2hlbmRpbmcgPSBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkgeyB0b3VjaGVuZGluZyA9IG51bGw7IH0sIHRvdWNoRGVsYXkpO1xuICAgIGZvciAoaSA9IDA7IGkgPCBuOyArK2kpIHtcbiAgICAgIHQgPSB0b3VjaGVzW2ldO1xuICAgICAgaWYgKGcudG91Y2gwICYmIGcudG91Y2gwWzJdID09PSB0LmlkZW50aWZpZXIpIGRlbGV0ZSBnLnRvdWNoMDtcbiAgICAgIGVsc2UgaWYgKGcudG91Y2gxICYmIGcudG91Y2gxWzJdID09PSB0LmlkZW50aWZpZXIpIGRlbGV0ZSBnLnRvdWNoMTtcbiAgICB9XG4gICAgaWYgKGcudG91Y2gxICYmICFnLnRvdWNoMCkgZy50b3VjaDAgPSBnLnRvdWNoMSwgZGVsZXRlIGcudG91Y2gxO1xuICAgIGlmIChnLnRvdWNoMCkgZy50b3VjaDBbMV0gPSB0aGlzLl9fem9vbS5pbnZlcnQoZy50b3VjaDBbMF0pO1xuICAgIGVsc2Uge1xuICAgICAgZy5lbmQoKTtcbiAgICAgIC8vIElmIHRoaXMgd2FzIGEgZGJsdGFwLCByZXJvdXRlIHRvIHRoZSAob3B0aW9uYWwpIGRibGNsaWNrLnpvb20gaGFuZGxlci5cbiAgICAgIGlmIChnLnRhcHMgPT09IDIpIHtcbiAgICAgICAgdCA9IHBvaW50ZXIodCwgdGhpcyk7XG4gICAgICAgIGlmIChNYXRoLmh5cG90KHRvdWNoZmlyc3RbMF0gLSB0WzBdLCB0b3VjaGZpcnN0WzFdIC0gdFsxXSkgPCB0YXBEaXN0YW5jZSkge1xuICAgICAgICAgIHZhciBwID0gc2VsZWN0KHRoaXMpLm9uKFwiZGJsY2xpY2suem9vbVwiKTtcbiAgICAgICAgICBpZiAocCkgcC5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgem9vbS53aGVlbERlbHRhID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHdoZWVsRGVsdGEgPSB0eXBlb2YgXyA9PT0gXCJmdW5jdGlvblwiID8gXyA6IGNvbnN0YW50KCtfKSwgem9vbSkgOiB3aGVlbERlbHRhO1xuICB9O1xuXG4gIHpvb20uZmlsdGVyID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGZpbHRlciA9IHR5cGVvZiBfID09PSBcImZ1bmN0aW9uXCIgPyBfIDogY29uc3RhbnQoISFfKSwgem9vbSkgOiBmaWx0ZXI7XG4gIH07XG5cbiAgem9vbS50b3VjaGFibGUgPSBmdW5jdGlvbihfKSB7XG4gICAgcmV0dXJuIGFyZ3VtZW50cy5sZW5ndGggPyAodG91Y2hhYmxlID0gdHlwZW9mIF8gPT09IFwiZnVuY3Rpb25cIiA/IF8gOiBjb25zdGFudCghIV8pLCB6b29tKSA6IHRvdWNoYWJsZTtcbiAgfTtcblxuICB6b29tLmV4dGVudCA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChleHRlbnQgPSB0eXBlb2YgXyA9PT0gXCJmdW5jdGlvblwiID8gXyA6IGNvbnN0YW50KFtbK19bMF1bMF0sICtfWzBdWzFdXSwgWytfWzFdWzBdLCArX1sxXVsxXV1dKSwgem9vbSkgOiBleHRlbnQ7XG4gIH07XG5cbiAgem9vbS5zY2FsZUV4dGVudCA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChzY2FsZUV4dGVudFswXSA9ICtfWzBdLCBzY2FsZUV4dGVudFsxXSA9ICtfWzFdLCB6b29tKSA6IFtzY2FsZUV4dGVudFswXSwgc2NhbGVFeHRlbnRbMV1dO1xuICB9O1xuXG4gIHpvb20udHJhbnNsYXRlRXh0ZW50ID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKHRyYW5zbGF0ZUV4dGVudFswXVswXSA9ICtfWzBdWzBdLCB0cmFuc2xhdGVFeHRlbnRbMV1bMF0gPSArX1sxXVswXSwgdHJhbnNsYXRlRXh0ZW50WzBdWzFdID0gK19bMF1bMV0sIHRyYW5zbGF0ZUV4dGVudFsxXVsxXSA9ICtfWzFdWzFdLCB6b29tKSA6IFtbdHJhbnNsYXRlRXh0ZW50WzBdWzBdLCB0cmFuc2xhdGVFeHRlbnRbMF1bMV1dLCBbdHJhbnNsYXRlRXh0ZW50WzFdWzBdLCB0cmFuc2xhdGVFeHRlbnRbMV1bMV1dXTtcbiAgfTtcblxuICB6b29tLmNvbnN0cmFpbiA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChjb25zdHJhaW4gPSBfLCB6b29tKSA6IGNvbnN0cmFpbjtcbiAgfTtcblxuICB6b29tLmR1cmF0aW9uID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGR1cmF0aW9uID0gK18sIHpvb20pIDogZHVyYXRpb247XG4gIH07XG5cbiAgem9vbS5pbnRlcnBvbGF0ZSA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/IChpbnRlcnBvbGF0ZSA9IF8sIHpvb20pIDogaW50ZXJwb2xhdGU7XG4gIH07XG5cbiAgem9vbS5vbiA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciB2YWx1ZSA9IGxpc3RlbmVycy5vbi5hcHBseShsaXN0ZW5lcnMsIGFyZ3VtZW50cyk7XG4gICAgcmV0dXJuIHZhbHVlID09PSBsaXN0ZW5lcnMgPyB6b29tIDogdmFsdWU7XG4gIH07XG5cbiAgem9vbS5jbGlja0Rpc3RhbmNlID0gZnVuY3Rpb24oXykge1xuICAgIHJldHVybiBhcmd1bWVudHMubGVuZ3RoID8gKGNsaWNrRGlzdGFuY2UyID0gKF8gPSArXykgKiBfLCB6b29tKSA6IE1hdGguc3FydChjbGlja0Rpc3RhbmNlMik7XG4gIH07XG5cbiAgem9vbS50YXBEaXN0YW5jZSA9IGZ1bmN0aW9uKF8pIHtcbiAgICByZXR1cm4gYXJndW1lbnRzLmxlbmd0aCA/ICh0YXBEaXN0YW5jZSA9ICtfLCB6b29tKSA6IHRhcERpc3RhbmNlO1xuICB9O1xuXG4gIHJldHVybiB6b29tO1xufVxuIiwgImltcG9ydCB7IFRleHRGaWxlVmlldywgV29ya3NwYWNlTGVhZiwgc2V0SWNvbiB9IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0IHsgcGFyc2VNdWx0aU9iamVjdEZpbGUsIFBhcnNlZE9iamVjdCB9IGZyb20gXCIuL3BhcnNlclwiO1xuXG5leHBvcnQgY29uc3QgVEFCTEVfVklFV19UWVBFID0gXCJvYmplY3QtbGlua3MtdGFibGVcIjtcblxudHlwZSBTb3J0RGlyID0gXCJhc2NcIiB8IFwiZGVzY1wiO1xudHlwZSBGaWx0ZXJPcCA9IFwiY29udGFpbnNcIiB8IFwibm90X2NvbnRhaW5zXCIgfCBcImVxdWFsc1wiIHwgXCJub3RfZXF1YWxzXCIgfCBcImlzX2VtcHR5XCIgfCBcImlzX25vdF9lbXB0eVwiO1xuXG5pbnRlcmZhY2UgUHJvcGVydHlGaWx0ZXIge1xuICBjb2x1bW46IHN0cmluZztcbiAgb3A6IEZpbHRlck9wO1xuICB2YWx1ZTogc3RyaW5nO1xufVxuXG5jb25zdCBGSUxURVJfT1BTOiB7IHZhbHVlOiBGaWx0ZXJPcDsgbGFiZWw6IHN0cmluZyB9W10gPSBbXG4gIHsgdmFsdWU6IFwiY29udGFpbnNcIiwgbGFiZWw6IFwiY29udGFpbnNcIiB9LFxuICB7IHZhbHVlOiBcIm5vdF9jb250YWluc1wiLCBsYWJlbDogXCJkb2VzIG5vdCBjb250YWluXCIgfSxcbiAgeyB2YWx1ZTogXCJlcXVhbHNcIiwgbGFiZWw6IFwiaXNcIiB9LFxuICB7IHZhbHVlOiBcIm5vdF9lcXVhbHNcIiwgbGFiZWw6IFwiaXMgbm90XCIgfSxcbiAgeyB2YWx1ZTogXCJpc19lbXB0eVwiLCBsYWJlbDogXCJpcyBlbXB0eVwiIH0sXG4gIHsgdmFsdWU6IFwiaXNfbm90X2VtcHR5XCIsIGxhYmVsOiBcImlzIG5vdCBlbXB0eVwiIH0sXG5dO1xuXG5leHBvcnQgY2xhc3MgT2JqZWN0VGFibGVWaWV3IGV4dGVuZHMgVGV4dEZpbGVWaWV3IHtcbiAgcHJpdmF0ZSBvYmplY3RzOiBQYXJzZWRPYmplY3RbXSA9IFtdO1xuICBwcml2YXRlIGNvbHVtbnM6IHN0cmluZ1tdID0gW107XG4gIHByaXZhdGUgc29ydENvbDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgc29ydERpcjogU29ydERpciA9IFwiYXNjXCI7XG4gIHByaXZhdGUgZmlsdGVyczogUHJvcGVydHlGaWx0ZXJbXSA9IFtdO1xuICBwcml2YXRlIGNvbFdpZHRoczogTWFwPHN0cmluZywgbnVtYmVyPiA9IG5ldyBNYXAoKTtcbiAgcHJpdmF0ZSB0Ym9keUVsOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGNvdW50RWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgZmlsdGVyUGFuZWxFbDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcblxuICAvKiogQ2FsbGJhY2sgdG8gYWRkIGEgbmV3IG9iamVjdCByb3cgXHUyMDE0IHNldCBieSB0aGUgcGx1Z2luICovXG4gIG9uQWRkUm93OiAoKCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcblxuICBjb25zdHJ1Y3RvcihsZWFmOiBXb3Jrc3BhY2VMZWFmKSB7XG4gICAgc3VwZXIobGVhZik7XG4gICAgdGhpcy5hZGRBY3Rpb24oXCJlZGl0XCIsIFwiRWRpdCBhcyBtYXJrZG93blwiLCAoKSA9PiB7XG4gICAgICBpZiAoIXRoaXMuZmlsZSkgcmV0dXJuO1xuICAgICAgdGhpcy5sZWFmLnNldFZpZXdTdGF0ZSh7XG4gICAgICAgIHR5cGU6IFwibWFya2Rvd25cIixcbiAgICAgICAgc3RhdGU6IHsgZmlsZTogdGhpcy5maWxlLnBhdGggfSxcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgZ2V0Vmlld1R5cGUoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gVEFCTEVfVklFV19UWVBFO1xuICB9XG5cbiAgZ2V0RGlzcGxheVRleHQoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gdGhpcy5maWxlPy5iYXNlbmFtZSA/PyBcIk9iamVjdCBUYWJsZVwiO1xuICB9XG5cbiAgZ2V0SWNvbigpOiBzdHJpbmcge1xuICAgIHJldHVybiBcInRhYmxlXCI7XG4gIH1cblxuICBzZXRWaWV3RGF0YShkYXRhOiBzdHJpbmcsIGNsZWFyOiBib29sZWFuKTogdm9pZCB7XG4gICAgdGhpcy5kYXRhID0gZGF0YTtcblxuICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlTXVsdGlPYmplY3RGaWxlKGRhdGEsIHRoaXMuZmlsZT8ucGF0aCA/PyBcIlwiKTtcbiAgICBpZiAocGFyc2VkKSB7XG4gICAgICB0aGlzLm9iamVjdHMgPSBwYXJzZWQub2JqZWN0cztcbiAgICAgIGNvbnN0IGNvbFNldCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgICAgZm9yIChjb25zdCBvYmogb2YgcGFyc2VkLm9iamVjdHMpIHtcbiAgICAgICAgZm9yIChjb25zdCBwcm9wIG9mIG9iai5wcm9wZXJ0eU9yZGVyKSB7XG4gICAgICAgICAgY29sU2V0LmFkZChwcm9wKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhpcy5jb2x1bW5zID0gQXJyYXkuZnJvbShjb2xTZXQpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLm9iamVjdHMgPSBbXTtcbiAgICAgIHRoaXMuY29sdW1ucyA9IFtdO1xuICAgIH1cblxuICAgIGlmIChjbGVhcikge1xuICAgICAgdGhpcy5zb3J0Q29sID0gbnVsbDtcbiAgICAgIHRoaXMuc29ydERpciA9IFwiYXNjXCI7XG4gICAgICB0aGlzLmZpbHRlcnMgPSBbXTtcbiAgICAgIHRoaXMuY29sV2lkdGhzID0gbmV3IE1hcCgpO1xuICAgIH1cblxuICAgIHRoaXMucmVuZGVyVGFibGUoKTtcbiAgfVxuXG4gIGdldFZpZXdEYXRhKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHRoaXMuZGF0YTtcbiAgfVxuXG4gIGNsZWFyKCk6IHZvaWQge1xuICAgIHRoaXMuZGF0YSA9IFwiXCI7XG4gICAgdGhpcy5vYmplY3RzID0gW107XG4gICAgdGhpcy5jb2x1bW5zID0gW107XG4gICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcbiAgfVxuXG4gIC8qIFx1MjUwMFx1MjUwMCBSZW5kZXJpbmcgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwICovXG5cbiAgcHJpdmF0ZSByZW5kZXJUYWJsZSgpOiB2b2lkIHtcbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIHRoaXMuY29udGVudEVsLmFkZENsYXNzKFwib2wtdGFibGUtdmlld1wiKTtcblxuICAgIGlmICh0aGlzLm9iamVjdHMubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aGlzLmNvbnRlbnRFbC5jcmVhdGVEaXYoe1xuICAgICAgICBjbHM6IFwib2wtdGFibGUtZW1wdHlcIixcbiAgICAgICAgdGV4dDogXCJObyBvYmplY3RzIGZvdW5kIGluIHRoaXMgZmlsZS5cIixcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIFx1MjUwMFx1MjUwMCBUb29sYmFyIFx1MjUwMFx1MjUwMFxuICAgIGNvbnN0IHRvb2xiYXIgPSB0aGlzLmNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwib2wtdGFibGUtdG9vbGJhclwiIH0pO1xuXG4gICAgY29uc3QgYWRkRmlsdGVyQnRuID0gdG9vbGJhci5jcmVhdGVFbChcImJ1dHRvblwiLCB7XG4gICAgICBjbHM6IFwib2wtdGFibGUtYWRkLWZpbHRlciBjbGlja2FibGUtaWNvblwiLFxuICAgIH0pO1xuICAgIHNldEljb24oYWRkRmlsdGVyQnRuLCBcImZpbHRlclwiKTtcbiAgICBhZGRGaWx0ZXJCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuYWRkRmlsdGVyKCkpO1xuXG4gICAgY29uc3QgYWRkUm93QnRuID0gdG9vbGJhci5jcmVhdGVFbChcImJ1dHRvblwiLCB7XG4gICAgICBjbHM6IFwib2wtdGFibGUtYWRkLXJvdyBjbGlja2FibGUtaWNvblwiLFxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJBZGQgb2JqZWN0XCIgfSxcbiAgICB9KTtcbiAgICBzZXRJY29uKGFkZFJvd0J0biwgXCJwbHVzXCIpO1xuICAgIGFkZFJvd0J0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgaWYgKHRoaXMub25BZGRSb3cpIHRoaXMub25BZGRSb3coKTtcbiAgICB9KTtcblxuICAgIHRoaXMuY291bnRFbCA9IHRvb2xiYXIuY3JlYXRlRGl2KHsgY2xzOiBcIm9sLXRhYmxlLWNvdW50XCIgfSk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgRmlsdGVyIHBhbmVsIFx1MjUwMFx1MjUwMFxuICAgIHRoaXMuZmlsdGVyUGFuZWxFbCA9IHRoaXMuY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJvbC1maWx0ZXItcGFuZWxcIiB9KTtcbiAgICB0aGlzLnJlbmRlckZpbHRlclBhbmVsKCk7XG5cbiAgICAvLyBcdTI1MDBcdTI1MDAgVGFibGUgXHUyNTAwXHUyNTAwXG4gICAgY29uc3Qgd3JhcHBlciA9IHRoaXMuY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJvbC10YWJsZS13cmFwcGVyXCIgfSk7XG4gICAgY29uc3QgdGFibGUgPSB3cmFwcGVyLmNyZWF0ZUVsKFwidGFibGVcIiwgeyBjbHM6IFwib2wtdGFibGVcIiB9KTtcbiAgICB0YWJsZS5zdHlsZS50YWJsZUxheW91dCA9IFwiZml4ZWRcIjtcblxuICAgIC8vIEhlYWRlclxuICAgIGNvbnN0IHRoZWFkID0gdGFibGUuY3JlYXRlRWwoXCJ0aGVhZFwiKTtcbiAgICBjb25zdCBoZWFkZXJSb3cgPSB0aGVhZC5jcmVhdGVFbChcInRyXCIpO1xuXG4gICAgZm9yIChjb25zdCBjb2wgb2YgdGhpcy5jb2x1bW5zKSB7XG4gICAgICBjb25zdCB0aCA9IGhlYWRlclJvdy5jcmVhdGVFbChcInRoXCIpO1xuICAgICAgdGguZGF0YXNldC5jb2wgPSBjb2w7XG4gICAgICBjb25zdCBzdG9yZWRXaWR0aCA9IHRoaXMuY29sV2lkdGhzLmdldChjb2wpO1xuICAgICAgaWYgKHN0b3JlZFdpZHRoKSB0aC5zdHlsZS53aWR0aCA9IHN0b3JlZFdpZHRoICsgXCJweFwiO1xuXG4gICAgICBjb25zdCBpbm5lciA9IHRoLmNyZWF0ZURpdih7IGNsczogXCJvbC10aC1pbm5lclwiIH0pO1xuICAgICAgaW5uZXIuY3JlYXRlU3Bhbih7IGNsczogXCJvbC10aC1sYWJlbFwiLCB0ZXh0OiBjb2wgfSk7XG5cbiAgICAgIGNvbnN0IGFycm93ID0gaW5uZXIuY3JlYXRlU3Bhbih7IGNsczogXCJvbC10aC1hcnJvd1wiIH0pO1xuICAgICAgaWYgKHRoaXMuc29ydENvbCA9PT0gY29sKSB7XG4gICAgICAgIGFycm93LnRleHRDb250ZW50ID0gdGhpcy5zb3J0RGlyID09PSBcImFzY1wiID8gXCIgXHUyNUIyXCIgOiBcIiBcdTI1QkNcIjtcbiAgICAgICAgdGguYWRkQ2xhc3MoXCJvbC10aC1zb3J0ZWRcIik7XG4gICAgICB9XG5cbiAgICAgIC8vIFNvcnQgb24gY2xpY2sgKGJ1dCBub3Qgd2hlbiBkcmFnZ2luZyB0aGUgcmVzaXplIGhhbmRsZSlcbiAgICAgIGxldCBkaWRSZXNpemUgPSBmYWxzZTtcbiAgICAgIGlubmVyLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgICAgIGlmIChkaWRSZXNpemUpIHsgZGlkUmVzaXplID0gZmFsc2U7IHJldHVybjsgfVxuICAgICAgICBpZiAodGhpcy5zb3J0Q29sID09PSBjb2wpIHtcbiAgICAgICAgICB0aGlzLnNvcnREaXIgPSB0aGlzLnNvcnREaXIgPT09IFwiYXNjXCIgPyBcImRlc2NcIiA6IFwiYXNjXCI7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhpcy5zb3J0Q29sID0gY29sO1xuICAgICAgICAgIHRoaXMuc29ydERpciA9IFwiYXNjXCI7XG4gICAgICAgIH1cbiAgICAgICAgaGVhZGVyUm93LnF1ZXJ5U2VsZWN0b3JBbGwoXCJ0aFwiKS5mb3JFYWNoKChlbCkgPT4ge1xuICAgICAgICAgIGVsLnJlbW92ZUNsYXNzKFwib2wtdGgtc29ydGVkXCIpO1xuICAgICAgICAgIGNvbnN0IGEgPSBlbC5xdWVyeVNlbGVjdG9yKFwiLm9sLXRoLWFycm93XCIpIGFzIEhUTUxFbGVtZW50O1xuICAgICAgICAgIGlmIChhKSBhLnRleHRDb250ZW50ID0gXCJcIjtcbiAgICAgICAgfSk7XG4gICAgICAgIHRoLmFkZENsYXNzKFwib2wtdGgtc29ydGVkXCIpO1xuICAgICAgICBhcnJvdy50ZXh0Q29udGVudCA9IHRoaXMuc29ydERpciA9PT0gXCJhc2NcIiA/IFwiIFx1MjVCMlwiIDogXCIgXHUyNUJDXCI7XG4gICAgICAgIHRoaXMucmVuZGVyUm93cygpO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIFJlc2l6ZSBoYW5kbGVcbiAgICAgIGNvbnN0IGhhbmRsZSA9IHRoLmNyZWF0ZURpdih7IGNsczogXCJvbC10aC1yZXNpemVcIiB9KTtcbiAgICAgIGhhbmRsZS5hZGRFdmVudExpc3RlbmVyKFwibW91c2Vkb3duXCIsIChlKSA9PiB7XG4gICAgICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgY29uc3Qgc3RhcnRYID0gZS5jbGllbnRYO1xuICAgICAgICBjb25zdCBzdGFydFcgPSB0aC5vZmZzZXRXaWR0aDtcblxuICAgICAgICBjb25zdCBvbk1vdmUgPSAoZXY6IE1vdXNlRXZlbnQpID0+IHtcbiAgICAgICAgICBjb25zdCBuZXdXID0gTWF0aC5tYXgoNTAsIHN0YXJ0VyArIGV2LmNsaWVudFggLSBzdGFydFgpO1xuICAgICAgICAgIHRoLnN0eWxlLndpZHRoID0gbmV3VyArIFwicHhcIjtcbiAgICAgICAgICBkaWRSZXNpemUgPSB0cnVlO1xuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IG9uVXAgPSAoKSA9PiB7XG4gICAgICAgICAgZG9jdW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm1vdXNlbW92ZVwiLCBvbk1vdmUpO1xuICAgICAgICAgIGRvY3VtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJtb3VzZXVwXCIsIG9uVXApO1xuICAgICAgICAgIHRoaXMuY29sV2lkdGhzLnNldChjb2wsIHRoLm9mZnNldFdpZHRoKTtcbiAgICAgICAgfTtcblxuICAgICAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKFwibW91c2Vtb3ZlXCIsIG9uTW92ZSk7XG4gICAgICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZXVwXCIsIG9uVXApO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gQm9keVxuICAgIHRoaXMudGJvZHlFbCA9IHRhYmxlLmNyZWF0ZUVsKFwidGJvZHlcIik7XG4gICAgdGhpcy5yZW5kZXJSb3dzKCk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlclJvd3MoKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLnRib2R5RWwpIHJldHVybjtcbiAgICB0aGlzLnRib2R5RWwuZW1wdHkoKTtcblxuICAgIGxldCByb3dzID0gWy4uLnRoaXMub2JqZWN0c107XG5cbiAgICAvLyBBcHBseSBwcm9wZXJ0eSBmaWx0ZXJzXG4gICAgZm9yIChjb25zdCBmIG9mIHRoaXMuZmlsdGVycykge1xuICAgICAgcm93cyA9IHJvd3MuZmlsdGVyKChvYmopID0+IHRoaXMubWF0Y2hlc0ZpbHRlcihvYmosIGYpKTtcbiAgICB9XG5cbiAgICAvLyBTb3J0XG4gICAgaWYgKHRoaXMuc29ydENvbCkge1xuICAgICAgY29uc3QgY29sID0gdGhpcy5zb3J0Q29sO1xuICAgICAgY29uc3QgZGlyID0gdGhpcy5zb3J0RGlyID09PSBcImFzY1wiID8gMSA6IC0xO1xuICAgICAgcm93cy5zb3J0KChhLCBiKSA9PiB7XG4gICAgICAgIGNvbnN0IHZhID0gYS5wcm9wZXJ0aWVzW2NvbF0gfHwgXCJcIjtcbiAgICAgICAgY29uc3QgdmIgPSBiLnByb3BlcnRpZXNbY29sXSB8fCBcIlwiO1xuICAgICAgICBjb25zdCBuYSA9IE51bWJlcih2YSk7XG4gICAgICAgIGNvbnN0IG5iID0gTnVtYmVyKHZiKTtcbiAgICAgICAgaWYgKCFpc05hTihuYSkgJiYgIWlzTmFOKG5iKSkgcmV0dXJuIChuYSAtIG5iKSAqIGRpcjtcbiAgICAgICAgcmV0dXJuIHZhLmxvY2FsZUNvbXBhcmUodmIpICogZGlyO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBvYmogb2Ygcm93cykge1xuICAgICAgY29uc3QgdHIgPSB0aGlzLnRib2R5RWwuY3JlYXRlRWwoXCJ0clwiKTtcbiAgICAgIGZvciAoY29uc3QgY29sIG9mIHRoaXMuY29sdW1ucykge1xuICAgICAgICBjb25zdCB0ZCA9IHRyLmNyZWF0ZUVsKFwidGRcIik7XG4gICAgICAgIGNvbnN0IHNwYW4gPSB0ZC5jcmVhdGVTcGFuKHsgY2xzOiBcIm9sLXRkLXRleHRcIiB9KTtcbiAgICAgICAgc3Bhbi50ZXh0Q29udGVudCA9IG9iai5wcm9wZXJ0aWVzW2NvbF0gfHwgXCJcIjtcbiAgICAgICAgc3Bhbi50aXRsZSA9IG9iai5wcm9wZXJ0aWVzW2NvbF0gfHwgXCJcIjtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodGhpcy5jb3VudEVsKSB7XG4gICAgICB0aGlzLmNvdW50RWwudGV4dENvbnRlbnQgPSBgJHtyb3dzLmxlbmd0aH0gb2YgJHt0aGlzLm9iamVjdHMubGVuZ3RofWA7XG4gICAgfVxuICB9XG5cbiAgLyogXHUyNTAwXHUyNTAwIFByb3BlcnR5IEZpbHRlcnMgKE5vdGlvbi1zdHlsZSkgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwICovXG5cbiAgcHJpdmF0ZSBhZGRGaWx0ZXIoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMuY29sdW1ucy5sZW5ndGggPT09IDApIHJldHVybjtcbiAgICB0aGlzLmZpbHRlcnMucHVzaCh7XG4gICAgICBjb2x1bW46IHRoaXMuY29sdW1uc1swXSxcbiAgICAgIG9wOiBcImNvbnRhaW5zXCIsXG4gICAgICB2YWx1ZTogXCJcIixcbiAgICB9KTtcbiAgICB0aGlzLnJlbmRlckZpbHRlclBhbmVsKCk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckZpbHRlclBhbmVsKCk6IHZvaWQge1xuICAgIGlmICghdGhpcy5maWx0ZXJQYW5lbEVsKSByZXR1cm47XG4gICAgdGhpcy5maWx0ZXJQYW5lbEVsLmVtcHR5KCk7XG5cbiAgICBpZiAodGhpcy5maWx0ZXJzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhpcy5maWx0ZXJQYW5lbEVsLnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5maWx0ZXJQYW5lbEVsLnN0eWxlLmRpc3BsYXkgPSBcIlwiO1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aGlzLmZpbHRlcnMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGNvbnN0IGYgPSB0aGlzLmZpbHRlcnNbaV07XG4gICAgICBjb25zdCByb3cgPSB0aGlzLmZpbHRlclBhbmVsRWwuY3JlYXRlRGl2KHsgY2xzOiBcIm9sLWZpbHRlci1yb3dcIiB9KTtcblxuICAgICAgLy8gQ29sdW1uIHNlbGVjdFxuICAgICAgY29uc3QgY29sU2VsZWN0ID0gcm93LmNyZWF0ZUVsKFwic2VsZWN0XCIsIHsgY2xzOiBcIm9sLWZpbHRlci1zZWxlY3RcIiB9KTtcbiAgICAgIGZvciAoY29uc3QgY29sIG9mIHRoaXMuY29sdW1ucykge1xuICAgICAgICBjb25zdCBvcHQgPSBjb2xTZWxlY3QuY3JlYXRlRWwoXCJvcHRpb25cIiwgeyB0ZXh0OiBjb2wsIHZhbHVlOiBjb2wgfSk7XG4gICAgICAgIGlmIChjb2wgPT09IGYuY29sdW1uKSBvcHQuc2VsZWN0ZWQgPSB0cnVlO1xuICAgICAgfVxuICAgICAgY29sU2VsZWN0LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgKCkgPT4ge1xuICAgICAgICBmLmNvbHVtbiA9IGNvbFNlbGVjdC52YWx1ZTtcbiAgICAgICAgdGhpcy5yZW5kZXJSb3dzKCk7XG4gICAgICB9KTtcblxuICAgICAgLy8gT3BlcmF0b3Igc2VsZWN0XG4gICAgICBjb25zdCBvcFNlbGVjdCA9IHJvdy5jcmVhdGVFbChcInNlbGVjdFwiLCB7IGNsczogXCJvbC1maWx0ZXItc2VsZWN0XCIgfSk7XG4gICAgICBmb3IgKGNvbnN0IG9wIG9mIEZJTFRFUl9PUFMpIHtcbiAgICAgICAgY29uc3Qgb3B0ID0gb3BTZWxlY3QuY3JlYXRlRWwoXCJvcHRpb25cIiwgeyB0ZXh0OiBvcC5sYWJlbCwgdmFsdWU6IG9wLnZhbHVlIH0pO1xuICAgICAgICBpZiAob3AudmFsdWUgPT09IGYub3ApIG9wdC5zZWxlY3RlZCA9IHRydWU7XG4gICAgICB9XG4gICAgICBvcFNlbGVjdC5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsICgpID0+IHtcbiAgICAgICAgZi5vcCA9IG9wU2VsZWN0LnZhbHVlIGFzIEZpbHRlck9wO1xuICAgICAgICB0aGlzLnJlbmRlckZpbHRlclBhbmVsKCk7XG4gICAgICAgIHRoaXMucmVuZGVyUm93cygpO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIFZhbHVlIGlucHV0IChoaWRkZW4gZm9yIGlzX2VtcHR5IC8gaXNfbm90X2VtcHR5KVxuICAgICAgaWYgKGYub3AgIT09IFwiaXNfZW1wdHlcIiAmJiBmLm9wICE9PSBcImlzX25vdF9lbXB0eVwiKSB7XG4gICAgICAgIGNvbnN0IHZhbElucHV0ID0gcm93LmNyZWF0ZUVsKFwiaW5wdXRcIiwge1xuICAgICAgICAgIGNsczogXCJvbC1maWx0ZXItaW5wdXRcIixcbiAgICAgICAgICB0eXBlOiBcInRleHRcIixcbiAgICAgICAgICBwbGFjZWhvbGRlcjogXCJ2YWx1ZVx1MjAyNlwiLFxuICAgICAgICB9KTtcbiAgICAgICAgdmFsSW5wdXQudmFsdWUgPSBmLnZhbHVlO1xuICAgICAgICB2YWxJbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiaW5wdXRcIiwgKCkgPT4ge1xuICAgICAgICAgIGYudmFsdWUgPSB2YWxJbnB1dC52YWx1ZTtcbiAgICAgICAgICB0aGlzLnJlbmRlclJvd3MoKTtcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIC8vIFJlbW92ZSBidXR0b25cbiAgICAgIGNvbnN0IHJlbW92ZUJ0biA9IHJvdy5jcmVhdGVFbChcImJ1dHRvblwiLCB7XG4gICAgICAgIGNsczogXCJvbC1maWx0ZXItcmVtb3ZlIGNsaWNrYWJsZS1pY29uXCIsXG4gICAgICB9KTtcbiAgICAgIHNldEljb24ocmVtb3ZlQnRuLCBcInhcIik7XG4gICAgICBjb25zdCBpZHggPSBpO1xuICAgICAgcmVtb3ZlQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgICAgIHRoaXMuZmlsdGVycy5zcGxpY2UoaWR4LCAxKTtcbiAgICAgICAgdGhpcy5yZW5kZXJGaWx0ZXJQYW5lbCgpO1xuICAgICAgICB0aGlzLnJlbmRlclJvd3MoKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgbWF0Y2hlc0ZpbHRlcihvYmo6IFBhcnNlZE9iamVjdCwgZjogUHJvcGVydHlGaWx0ZXIpOiBib29sZWFuIHtcbiAgICBjb25zdCB2YWwgPSAob2JqLnByb3BlcnRpZXNbZi5jb2x1bW5dIHx8IFwiXCIpLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgZnYgPSBmLnZhbHVlLnRvTG93ZXJDYXNlKCk7XG4gICAgc3dpdGNoIChmLm9wKSB7XG4gICAgICBjYXNlIFwiY29udGFpbnNcIjogcmV0dXJuIHZhbC5pbmNsdWRlcyhmdik7XG4gICAgICBjYXNlIFwibm90X2NvbnRhaW5zXCI6IHJldHVybiAhdmFsLmluY2x1ZGVzKGZ2KTtcbiAgICAgIGNhc2UgXCJlcXVhbHNcIjogcmV0dXJuIHZhbCA9PT0gZnY7XG4gICAgICBjYXNlIFwibm90X2VxdWFsc1wiOiByZXR1cm4gdmFsICE9PSBmdjtcbiAgICAgIGNhc2UgXCJpc19lbXB0eVwiOiByZXR1cm4gdmFsID09PSBcIlwiO1xuICAgICAgY2FzZSBcImlzX25vdF9lbXB0eVwiOiByZXR1cm4gdmFsICE9PSBcIlwiO1xuICAgIH1cbiAgfVxufVxuIiwgImltcG9ydCB7XG4gIEVkaXRvcixcbiAgRWRpdG9yUG9zaXRpb24sXG4gIEVkaXRvclN1Z2dlc3QsXG4gIEVkaXRvclN1Z2dlc3RDb250ZXh0LFxuICBFZGl0b3JTdWdnZXN0VHJpZ2dlckluZm8sXG4gIFRGaWxlLFxufSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB7IFBhcnNlZE9iamVjdCB9IGZyb20gXCIuL3BhcnNlclwiO1xuXG5leHBvcnQgaW50ZXJmYWNlIE9iamVjdFN1Z2dlc3Rpb24ge1xuICAvKiogVGhlIGRpc2FtYmlndWF0ZWQga2V5IHVzZWQgZm9yIHt7fX0gbGlua3MgKi9cbiAgZGlzcGxheUtleTogc3RyaW5nO1xuICAvKiogVGhlIG9yaWdpbmFsIGtleSB2YWx1ZSAoZm9yIGRpc3BsYXkvc2VhcmNoKSAqL1xuICBrZXlWYWx1ZTogc3RyaW5nO1xuICBmaWxlTGFiZWw6IHN0cmluZztcbiAgZmlsZVBhdGg6IHN0cmluZztcbiAgcHJvcGVydGllczogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgLyoqIFRydWUgaWYgdGhpcyBpcyBhIFwiQ3JlYXRlIG5ldy4uLlwiIGFjdGlvbiBpdGVtICovXG4gIGlzQ3JlYXRlQWN0aW9uPzogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGNsYXNzIE9iamVjdExpbmtTdWdnZXN0IGV4dGVuZHMgRWRpdG9yU3VnZ2VzdDxPYmplY3RTdWdnZXN0aW9uPiB7XG4gIHByaXZhdGUgb2JqZWN0czogT2JqZWN0U3VnZ2VzdGlvbltdID0gW107XG4gIC8qKiBDYWxsYmFjayBpbnZva2VkIHdoZW4gdXNlciBzZWxlY3RzIFwiQ3JlYXRlIG5ldy4uLlwiICovXG4gIG9uQ3JlYXRlTmV3OiAoKHF1ZXJ5OiBzdHJpbmcpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG5cbiAgY29uc3RydWN0b3IoYXBwOiBhbnkpIHtcbiAgICBzdXBlcihhcHApO1xuXG4gICAgLy8gTWFrZSBzdWdnZXN0aW9ucyBhY2NlcHQgd2l0aCBUYWIgKGluIGFkZGl0aW9uIHRvIEVudGVyKS5cbiAgICAvLyBPYnNpZGlhbidzIFBvcG92ZXJTdWdnZXN0IHVzZXMgYW4gaW50ZXJuYWwgXCJjaG9vc2VyXCI7IHdlIGNhbGwgaXQgYmVzdC1lZmZvcnQuXG4gICAgdGhpcy5zZXRJbnN0cnVjdGlvbnMoW1xuICAgICAgeyBjb21tYW5kOiBcIlx1MjE5MVx1MjE5M1wiLCBwdXJwb3NlOiBcInRvIG5hdmlnYXRlXCIgfSxcbiAgICAgIHsgY29tbWFuZDogXCJFbnRlclwiLCBwdXJwb3NlOiBcInRvIGluc2VydFwiIH0sXG4gICAgICB7IGNvbW1hbmQ6IFwiVGFiXCIsIHB1cnBvc2U6IFwidG8gaW5zZXJ0XCIgfSxcbiAgICAgIHsgY29tbWFuZDogXCJFc2NcIiwgcHVycG9zZTogXCJ0byBkaXNtaXNzXCIgfSxcbiAgICBdKTtcblxuICAgIHRoaXMuc2NvcGUucmVnaXN0ZXIoW10sIFwiVGFiXCIsIChldnQpID0+IHtcbiAgICAgIGNvbnN0IGUgPSBldnQgYXMgS2V5Ym9hcmRFdmVudDtcbiAgICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICBjb25zdCBjaG9vc2VyID0gKHRoaXMgYXMgYW55KS5jaG9vc2VyO1xuICAgICAgaWYgKGNob29zZXIgJiYgdHlwZW9mIGNob29zZXIudXNlU2VsZWN0ZWRJdGVtID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgY2hvb3Nlci51c2VTZWxlY3RlZEl0ZW0oZSk7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfVxuICAgICAgLy8gRmFsbGJhY2s6IHNpbXVsYXRlIEVudGVyXG4gICAgICBpZiAoY2hvb3NlciAmJiB0eXBlb2YgY2hvb3Nlci5vbkVudGVyID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgY2hvb3Nlci5vbkVudGVyKGUpO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0pO1xuICB9XG5cbiAgc2V0T2JqZWN0cyhvYmplY3RzOiBQYXJzZWRPYmplY3RbXSk6IHZvaWQge1xuICAgIHRoaXMub2JqZWN0cyA9IG9iamVjdHMubWFwKChvKSA9PiAoe1xuICAgICAgZGlzcGxheUtleTogby5kaXNwbGF5S2V5LFxuICAgICAga2V5VmFsdWU6IG8ua2V5VmFsdWUsXG4gICAgICBmaWxlTGFiZWw6IG8uZmlsZUxhYmVsLFxuICAgICAgZmlsZVBhdGg6IG8uZmlsZVBhdGgsXG4gICAgICBwcm9wZXJ0aWVzOiBvLnByb3BlcnRpZXMsXG4gICAgfSkpO1xuICB9XG5cbiAgb25UcmlnZ2VyKFxuICAgIGN1cnNvcjogRWRpdG9yUG9zaXRpb24sXG4gICAgZWRpdG9yOiBFZGl0b3IsXG4gICAgX2ZpbGU6IFRGaWxlIHwgbnVsbFxuICApOiBFZGl0b3JTdWdnZXN0VHJpZ2dlckluZm8gfCBudWxsIHtcbiAgICBjb25zdCBsaW5lID0gZWRpdG9yLmdldExpbmUoY3Vyc29yLmxpbmUpO1xuICAgIGNvbnN0IHN1YiA9IGxpbmUuc3Vic3RyaW5nKDAsIGN1cnNvci5jaCk7XG5cbiAgICAvLyBGaW5kIHRoZSBsYXN0IHt7IHRoYXQgaXNuJ3QgY2xvc2VkXG4gICAgY29uc3QgbGFzdE9wZW4gPSBzdWIubGFzdEluZGV4T2YoXCJ7e1wiKTtcbiAgICBpZiAobGFzdE9wZW4gPT09IC0xKSByZXR1cm4gbnVsbDtcblxuICAgIC8vIENoZWNrIGl0J3Mgbm90IGFscmVhZHkgY2xvc2VkXG4gICAgY29uc3QgYWZ0ZXJPcGVuID0gc3ViLnN1YnN0cmluZyhsYXN0T3BlbiArIDIpO1xuICAgIGlmIChhZnRlck9wZW4uaW5jbHVkZXMoXCJ9fVwiKSkgcmV0dXJuIG51bGw7XG5cbiAgICBjb25zdCBxdWVyeSA9IGFmdGVyT3BlbjtcblxuICAgIHJldHVybiB7XG4gICAgICBzdGFydDogeyBsaW5lOiBjdXJzb3IubGluZSwgY2g6IGxhc3RPcGVuICsgMiB9LFxuICAgICAgZW5kOiBjdXJzb3IsXG4gICAgICBxdWVyeSxcbiAgICB9O1xuICB9XG5cbiAgZ2V0U3VnZ2VzdGlvbnMoY29udGV4dDogRWRpdG9yU3VnZ2VzdENvbnRleHQpOiBPYmplY3RTdWdnZXN0aW9uW10ge1xuICAgIGNvbnN0IHF1ZXJ5ID0gY29udGV4dC5xdWVyeS50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcbiAgICBpZiAoIXF1ZXJ5KSByZXR1cm4gdGhpcy5vYmplY3RzLnNsaWNlKDAsIDIwKTtcblxuICAgIGNvbnN0IG1hdGNoZXMgPSB0aGlzLm9iamVjdHNcbiAgICAgIC5maWx0ZXIoXG4gICAgICAgIChvKSA9PlxuICAgICAgICAgIG8uZGlzcGxheUtleS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKHF1ZXJ5KSB8fFxuICAgICAgICAgIG8ua2V5VmFsdWUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhxdWVyeSlcbiAgICAgIClcbiAgICAgIC5zbGljZSgwLCAyMCk7XG5cbiAgICAvLyBJZiBubyBleGFjdCBtYXRjaCBmb3VuZCwgb2ZmZXIgXCJDcmVhdGUgbmV3Li4uXCJcbiAgICBjb25zdCBoYXNFeGFjdCA9IG1hdGNoZXMuc29tZShcbiAgICAgIChvKSA9PiBvLmRpc3BsYXlLZXkudG9Mb3dlckNhc2UoKSA9PT0gcXVlcnkgfHwgby5rZXlWYWx1ZS50b0xvd2VyQ2FzZSgpID09PSBxdWVyeVxuICAgICk7XG4gICAgaWYgKCFoYXNFeGFjdCAmJiBxdWVyeS5sZW5ndGggPiAwKSB7XG4gICAgICBtYXRjaGVzLnB1c2goe1xuICAgICAgICBkaXNwbGF5S2V5OiBjb250ZXh0LnF1ZXJ5LnRyaW0oKSxcbiAgICAgICAga2V5VmFsdWU6IGNvbnRleHQucXVlcnkudHJpbSgpLFxuICAgICAgICBmaWxlTGFiZWw6IFwiQ3JlYXRlIG5ld1x1MjAyNlwiLFxuICAgICAgICBmaWxlUGF0aDogXCJcIixcbiAgICAgICAgcHJvcGVydGllczoge30sXG4gICAgICAgIGlzQ3JlYXRlQWN0aW9uOiB0cnVlLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIG1hdGNoZXM7XG4gIH1cblxuICByZW5kZXJTdWdnZXN0aW9uKHN1Z2dlc3Rpb246IE9iamVjdFN1Z2dlc3Rpb24sIGVsOiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIGNvbnN0IGNvbnRhaW5lciA9IGVsLmNyZWF0ZURpdih7IGNsczogXCJvbC1zdWdnZXN0aW9uXCIgfSk7XG5cbiAgICBpZiAoc3VnZ2VzdGlvbi5pc0NyZWF0ZUFjdGlvbikge1xuICAgICAgY29udGFpbmVyLmFkZENsYXNzKFwib2wtc3VnZ2VzdGlvbi1jcmVhdGVcIik7XG4gICAgICBjb25zdCB0aXRsZUVsID0gY29udGFpbmVyLmNyZWF0ZURpdih7IGNsczogXCJvbC1zdWdnZXN0aW9uLXRpdGxlXCIgfSk7XG4gICAgICB0aXRsZUVsLnRleHRDb250ZW50ID0gYENyZWF0ZSBcIiR7c3VnZ2VzdGlvbi5kaXNwbGF5S2V5fVwiYDtcbiAgICAgIGNvbnN0IGZpbGVFbCA9IGNvbnRhaW5lci5jcmVhdGVEaXYoeyBjbHM6IFwib2wtc3VnZ2VzdGlvbi1maWxlXCIgfSk7XG4gICAgICBmaWxlRWwudGV4dENvbnRlbnQgPSBcIk5ldyBvYmplY3RcdTIwMjZcIjtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCB0aXRsZUVsID0gY29udGFpbmVyLmNyZWF0ZURpdih7IGNsczogXCJvbC1zdWdnZXN0aW9uLXRpdGxlXCIgfSk7XG4gICAgdGl0bGVFbC50ZXh0Q29udGVudCA9IHN1Z2dlc3Rpb24uZGlzcGxheUtleTtcblxuICAgIGNvbnN0IGZpbGVFbCA9IGNvbnRhaW5lci5jcmVhdGVEaXYoeyBjbHM6IFwib2wtc3VnZ2VzdGlvbi1maWxlXCIgfSk7XG4gICAgZmlsZUVsLnRleHRDb250ZW50ID0gc3VnZ2VzdGlvbi5maWxlTGFiZWw7XG4gIH1cblxuICBzZWxlY3RTdWdnZXN0aW9uKFxuICAgIHN1Z2dlc3Rpb246IE9iamVjdFN1Z2dlc3Rpb24sXG4gICAgX2V2dDogTW91c2VFdmVudCB8IEtleWJvYXJkRXZlbnRcbiAgKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLmNvbnRleHQpIHJldHVybjtcblxuICAgIGlmIChzdWdnZXN0aW9uLmlzQ3JlYXRlQWN0aW9uKSB7XG4gICAgICAvLyBDbG9zZSB0aGUgc3VnZ2VzdCBwb3B1cCBhbmQgb3BlbiBjcmVhdGlvbiBtb2RhbFxuICAgICAgY29uc3QgcXVlcnkgPSBzdWdnZXN0aW9uLmRpc3BsYXlLZXk7XG4gICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICBpZiAodGhpcy5vbkNyZWF0ZU5ldykgdGhpcy5vbkNyZWF0ZU5ldyhxdWVyeSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgZWRpdG9yID0gdGhpcy5jb250ZXh0LmVkaXRvcjtcbiAgICBjb25zdCBzdGFydCA9IHRoaXMuY29udGV4dC5zdGFydDtcbiAgICBjb25zdCBlbmQgPSB0aGlzLmNvbnRleHQuZW5kO1xuXG4gICAgLy8gQ2hlY2sgaWYgfX0gYWxyZWFkeSBleGlzdHMgcmlnaHQgYWZ0ZXIgdGhlIGN1cnNvciAoYXV0by1jbG9zZWQgYnkgT2JzaWRpYW4pXG4gICAgY29uc3QgbGluZVRleHQgPSBlZGl0b3IuZ2V0TGluZShlbmQubGluZSk7XG4gICAgY29uc3QgYWZ0ZXJDdXJzb3IgPSBsaW5lVGV4dC5zdWJzdHJpbmcoZW5kLmNoKTtcbiAgICBjb25zdCBoYXNDbG9zaW5nID0gYWZ0ZXJDdXJzb3Iuc3RhcnRzV2l0aChcIn19XCIpO1xuXG4gICAgLy8gUmVwbGFjZSB0aGUgcXVlcnkgdGV4dCB3aXRoIHRoZSBkaXNwbGF5IGtleSwgY29uc3VtaW5nIGV4aXN0aW5nIH19IGlmIHByZXNlbnRcbiAgICBjb25zdCByZXBsYWNlVG8gPSBoYXNDbG9zaW5nXG4gICAgICA/IHsgbGluZTogZW5kLmxpbmUsIGNoOiBlbmQuY2ggKyAyIH1cbiAgICAgIDogZW5kO1xuICAgIGVkaXRvci5yZXBsYWNlUmFuZ2Uoc3VnZ2VzdGlvbi5kaXNwbGF5S2V5ICsgXCJ9fVwiLCBzdGFydCwgcmVwbGFjZVRvKTtcbiAgfVxufVxuIiwgImltcG9ydCB7IEFwcCwgTW9kYWwsIFNldHRpbmcsIFRGaWxlLCBOb3RpY2UgfSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB7IFBhcnNlZEZpbGUgfSBmcm9tIFwiLi9wYXJzZXJcIjtcblxuZXhwb3J0IGludGVyZmFjZSBPYmplY3RUeXBlSW5mbyB7XG4gIGZpbGVQYXRoOiBzdHJpbmc7XG4gIGZpbGVMYWJlbDogc3RyaW5nO1xuICBrZXlQcm9wZXJ0eTogc3RyaW5nO1xuICAvKiogVW5pb24gb2YgYWxsIHByb3BlcnR5IG5hbWVzIGFjcm9zcyBhbGwgb2JqZWN0cyBpbiB0aGlzIGZpbGUgKi9cbiAgcHJvcGVydGllczogc3RyaW5nW107XG4gIC8qKiBOZXh0IGF1dG8taW5jcmVtZW50IGlkICovXG4gIG5leHRJZDogbnVtYmVyO1xufVxuXG4vKipcbiAqIERlcml2ZSBvYmplY3QgdHlwZSBpbmZvIGZyb20gcGFyc2VkIGZpbGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0T2JqZWN0VHlwZXMocGFyc2VkRmlsZXM6IFBhcnNlZEZpbGVbXSk6IE9iamVjdFR5cGVJbmZvW10ge1xuICByZXR1cm4gcGFyc2VkRmlsZXMubWFwKChwZikgPT4ge1xuICAgIGNvbnN0IHByb3BTZXQgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICBsZXQgbWF4SWQgPSAwO1xuICAgIGZvciAoY29uc3Qgb2JqIG9mIHBmLm9iamVjdHMpIHtcbiAgICAgIGZvciAoY29uc3QgcHJvcCBvZiBvYmoucHJvcGVydHlPcmRlcikge1xuICAgICAgICBwcm9wU2V0LmFkZChwcm9wKTtcbiAgICAgIH1cbiAgICAgIGlmIChvYmouaWQgPiBtYXhJZCkgbWF4SWQgPSBvYmouaWQ7XG4gICAgfVxuICAgIC8vIEVuc3VyZSBrZXkgcHJvcGVydHkgaXMgZmlyc3QsIGlkIGlzIHNlY29uZCwgcmVzdCBpbiBvcmRlclxuICAgIGNvbnN0IHByb3BzOiBzdHJpbmdbXSA9IFtdO1xuICAgIHByb3BTZXQuZGVsZXRlKHBmLmtleVByb3BlcnR5KTtcbiAgICBwcm9wU2V0LmRlbGV0ZShcImlkXCIpO1xuICAgIHByb3BzLnB1c2gocGYua2V5UHJvcGVydHksIFwiaWRcIiwgLi4ucHJvcFNldCk7XG5cbiAgICBjb25zdCBmaWxlTGFiZWwgPSBwZi5vYmplY3RzWzBdPy5maWxlTGFiZWxcbiAgICAgID8/IHBmLmZpbGVQYXRoLnJlcGxhY2UoL14uKlxcLy8sIFwiXCIpLnJlcGxhY2UoL1xcLm1kJC9pLCBcIlwiKTtcblxuICAgIHJldHVybiB7XG4gICAgICBmaWxlUGF0aDogcGYuZmlsZVBhdGgsXG4gICAgICBmaWxlTGFiZWwsXG4gICAgICBrZXlQcm9wZXJ0eTogcGYua2V5UHJvcGVydHksXG4gICAgICBwcm9wZXJ0aWVzOiBwcm9wcyxcbiAgICAgIG5leHRJZDogbWF4SWQgKyAxLFxuICAgIH07XG4gIH0pO1xufVxuXG4vKipcbiAqIE1vZGFsIHRvIGNyZWF0ZSBhIG5ldyBvYmplY3QuXG4gKiBJZiBvYmplY3RUeXBlIGlzIHByb3ZpZGVkLCBza2lwcyB0aGUgdHlwZSBzZWxlY3Rpb24gc3RlcC5cbiAqIElmIHByZWZpbGxLZXkgaXMgcHJvdmlkZWQsIHByZS1maWxscyB0aGUga2V5IHByb3BlcnR5IHZhbHVlLlxuICovXG5leHBvcnQgY2xhc3MgQ3JlYXRlT2JqZWN0TW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIHByaXZhdGUgdHlwZXM6IE9iamVjdFR5cGVJbmZvW107XG4gIHByaXZhdGUgc2VsZWN0ZWRUeXBlOiBPYmplY3RUeXBlSW5mbyB8IG51bGw7XG4gIHByaXZhdGUgcHJlZmlsbEtleTogc3RyaW5nO1xuICBwcml2YXRlIG9uQ3JlYXRlZDogKGZpbGVQYXRoOiBzdHJpbmcpID0+IHZvaWQ7XG4gIHByaXZhdGUgZmllbGRWYWx1ZXM6IE1hcDxzdHJpbmcsIHN0cmluZz4gPSBuZXcgTWFwKCk7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgYXBwOiBBcHAsXG4gICAgdHlwZXM6IE9iamVjdFR5cGVJbmZvW10sXG4gICAgb3B0aW9ucz86IHtcbiAgICAgIHNlbGVjdGVkVHlwZT86IE9iamVjdFR5cGVJbmZvO1xuICAgICAgcHJlZmlsbEtleT86IHN0cmluZztcbiAgICAgIG9uQ3JlYXRlZD86IChmaWxlUGF0aDogc3RyaW5nKSA9PiB2b2lkO1xuICAgIH1cbiAgKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgICB0aGlzLnR5cGVzID0gdHlwZXM7XG4gICAgdGhpcy5zZWxlY3RlZFR5cGUgPSBvcHRpb25zPy5zZWxlY3RlZFR5cGUgPz8gbnVsbDtcbiAgICB0aGlzLnByZWZpbGxLZXkgPSBvcHRpb25zPy5wcmVmaWxsS2V5ID8/IFwiXCI7XG4gICAgdGhpcy5vbkNyZWF0ZWQgPSBvcHRpb25zPy5vbkNyZWF0ZWQgPz8gKCgpID0+IHt9KTtcbiAgfVxuXG4gIG9uT3BlbigpOiB2b2lkIHtcbiAgICB0aGlzLm1vZGFsRWwuYWRkQ2xhc3MoXCJvbC1jcmVhdGUtbW9kYWxcIik7XG4gICAgdGhpcy50aXRsZUVsLnRleHRDb250ZW50ID0gXCJDcmVhdGUgT2JqZWN0XCI7XG5cbiAgICBpZiAodGhpcy5zZWxlY3RlZFR5cGUpIHtcbiAgICAgIHRoaXMucmVuZGVyRm9ybSh0aGlzLnNlbGVjdGVkVHlwZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMucmVuZGVyVHlwZVBpY2tlcigpO1xuICAgIH1cbiAgfVxuXG4gIG9uQ2xvc2UoKTogdm9pZCB7XG4gICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcbiAgfVxuXG4gIC8qIFx1MjUwMFx1MjUwMCBUeXBlIFBpY2tlciBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cblxuICBwcml2YXRlIHJlbmRlclR5cGVQaWNrZXIoKTogdm9pZCB7XG4gICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcblxuICAgIGlmICh0aGlzLnR5cGVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhpcy5jb250ZW50RWwuY3JlYXRlRGl2KHtcbiAgICAgICAgdGV4dDogXCJObyBvYmplY3QtbGlua3MgZmlsZXMgZm91bmQuIENyZWF0ZSBhIGZpbGUgd2l0aCB0aGUgb2JqZWN0LWxpbmtzIHRhZyBmaXJzdC5cIixcbiAgICAgICAgY2xzOiBcIm9sLWNyZWF0ZS1lbXB0eVwiLFxuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgbmV3IFNldHRpbmcodGhpcy5jb250ZW50RWwpXG4gICAgICAuc2V0TmFtZShcIk9iamVjdCB0eXBlXCIpXG4gICAgICAuc2V0RGVzYyhcIkNob29zZSB3aGljaCBmaWxlIHRvIGFkZCB0aGUgb2JqZWN0IHRvXCIpXG4gICAgICAuYWRkRHJvcGRvd24oKGRkKSA9PiB7XG4gICAgICAgIGZvciAoY29uc3QgdCBvZiB0aGlzLnR5cGVzKSB7XG4gICAgICAgICAgZGQuYWRkT3B0aW9uKHQuZmlsZVBhdGgsIHQuZmlsZUxhYmVsKTtcbiAgICAgICAgfVxuICAgICAgICBkZC5vbkNoYW5nZSgodmFsKSA9PiB7XG4gICAgICAgICAgdGhpcy5zZWxlY3RlZFR5cGUgPSB0aGlzLnR5cGVzLmZpbmQoKHQpID0+IHQuZmlsZVBhdGggPT09IHZhbCkgPz8gbnVsbDtcbiAgICAgICAgfSk7XG4gICAgICAgIC8vIFNlbGVjdCBmaXJzdCBieSBkZWZhdWx0XG4gICAgICAgIHRoaXMuc2VsZWN0ZWRUeXBlID0gdGhpcy50eXBlc1swXTtcbiAgICAgIH0pO1xuXG4gICAgbmV3IFNldHRpbmcodGhpcy5jb250ZW50RWwpXG4gICAgICAuYWRkQnV0dG9uKChidG4pID0+XG4gICAgICAgIGJ0bi5zZXRCdXR0b25UZXh0KFwiTmV4dFwiKS5zZXRDdGEoKS5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICBpZiAodGhpcy5zZWxlY3RlZFR5cGUpIHRoaXMucmVuZGVyRm9ybSh0aGlzLnNlbGVjdGVkVHlwZSk7XG4gICAgICAgIH0pXG4gICAgICApO1xuICB9XG5cbiAgLyogXHUyNTAwXHUyNTAwIE9iamVjdCBGb3JtIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMCAqL1xuXG4gIHByaXZhdGUgcmVuZGVyRm9ybSh0eXBlOiBPYmplY3RUeXBlSW5mbyk6IHZvaWQge1xuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XG4gICAgdGhpcy5maWVsZFZhbHVlcy5jbGVhcigpO1xuICAgIHRoaXMudGl0bGVFbC50ZXh0Q29udGVudCA9IGBOZXcgJHt0eXBlLmZpbGVMYWJlbH1gO1xuXG4gICAgY29uc3QgZm9ybSA9IHRoaXMuY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJvbC1jcmVhdGUtZm9ybVwiIH0pO1xuXG4gICAgZm9yIChjb25zdCBwcm9wIG9mIHR5cGUucHJvcGVydGllcykge1xuICAgICAgY29uc3QgaXNLZXkgPSBwcm9wID09PSB0eXBlLmtleVByb3BlcnR5O1xuICAgICAgY29uc3QgaXNJZCA9IHByb3AgPT09IFwiaWRcIjtcblxuICAgICAgY29uc3Qgc2V0dGluZyA9IG5ldyBTZXR0aW5nKGZvcm0pLnNldE5hbWUocHJvcCk7XG5cbiAgICAgIGlmIChpc0lkKSB7XG4gICAgICAgIC8vIEF1dG8tZmlsbGVkLCByZWFkLW9ubHlcbiAgICAgICAgc2V0dGluZy5zZXREZXNjKGBBdXRvOiAke3R5cGUubmV4dElkfWApO1xuICAgICAgICB0aGlzLmZpZWxkVmFsdWVzLnNldChcImlkXCIsIFN0cmluZyh0eXBlLm5leHRJZCkpO1xuICAgICAgICBzZXR0aW5nLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgICAgdGV4dFxuICAgICAgICAgICAgLnNldFZhbHVlKFN0cmluZyh0eXBlLm5leHRJZCkpXG4gICAgICAgICAgICAuc2V0RGlzYWJsZWQodHJ1ZSlcbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNldHRpbmcuYWRkVGV4dCgodGV4dCkgPT4ge1xuICAgICAgICAgIGlmIChpc0tleSAmJiB0aGlzLnByZWZpbGxLZXkpIHtcbiAgICAgICAgICAgIHRleHQuc2V0VmFsdWUodGhpcy5wcmVmaWxsS2V5KTtcbiAgICAgICAgICAgIHRoaXMuZmllbGRWYWx1ZXMuc2V0KHByb3AsIHRoaXMucHJlZmlsbEtleSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHRleHQuc2V0UGxhY2Vob2xkZXIocHJvcCkub25DaGFuZ2UoKHZhbCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5maWVsZFZhbHVlcy5zZXQocHJvcCwgdmFsKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgICAvLyBBdXRvLWZvY3VzIGtleSBmaWVsZFxuICAgICAgICAgIGlmIChpc0tleSkge1xuICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB0ZXh0LmlucHV0RWwuZm9jdXMoKSwgNTApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gU3VibWl0XG4gICAgbmV3IFNldHRpbmcoZm9ybSlcbiAgICAgIC5hZGRCdXR0b24oKGJ0bikgPT5cbiAgICAgICAgYnRuLnNldEJ1dHRvblRleHQoXCJDcmVhdGVcIikuc2V0Q3RhKCkub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgdGhpcy5oYW5kbGVDcmVhdGUodHlwZSk7XG4gICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgLy8gSGFuZGxlIEVudGVyIGtleSB0byBzdWJtaXRcbiAgICBmb3JtLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIChlKSA9PiB7XG4gICAgICBpZiAoZS5rZXkgPT09IFwiRW50ZXJcIiAmJiAhZS5zaGlmdEtleSkge1xuICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIHRoaXMuaGFuZGxlQ3JlYXRlKHR5cGUpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgLyogXHUyNTAwXHUyNTAwIENyZWF0ZSBMb2dpYyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cblxuICBwcml2YXRlIGFzeW5jIGhhbmRsZUNyZWF0ZSh0eXBlOiBPYmplY3RUeXBlSW5mbyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGtleVZhbCA9IHRoaXMuZmllbGRWYWx1ZXMuZ2V0KHR5cGUua2V5UHJvcGVydHkpPy50cmltKCk7XG4gICAgaWYgKCFrZXlWYWwpIHtcbiAgICAgIG5ldyBOb3RpY2UoYFwiJHt0eXBlLmtleVByb3BlcnR5fVwiIGlzIHJlcXVpcmVkLmApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIEJ1aWxkIHRoZSBvYmplY3QgYmxvY2tcbiAgICBjb25zdCBsaW5lczogc3RyaW5nW10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IHByb3Agb2YgdHlwZS5wcm9wZXJ0aWVzKSB7XG4gICAgICBjb25zdCB2YWwgPSB0aGlzLmZpZWxkVmFsdWVzLmdldChwcm9wKT8udHJpbSgpID8/IFwiXCI7XG4gICAgICBpZiAodmFsKSB7XG4gICAgICAgIGxpbmVzLnB1c2goYCR7cHJvcH06ICR7dmFsfWApO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEVuc3VyZSBrZXkgYW5kIGlkIGFyZSBhbHdheXMgcHJlc2VudFxuICAgIGlmICghbGluZXMuc29tZSgobCkgPT4gbC5zdGFydHNXaXRoKGAke3R5cGUua2V5UHJvcGVydHl9OmApKSkge1xuICAgICAgbGluZXMudW5zaGlmdChgJHt0eXBlLmtleVByb3BlcnR5fTogJHtrZXlWYWx9YCk7XG4gICAgfVxuICAgIGlmICghbGluZXMuc29tZSgobCkgPT4gbC5zdGFydHNXaXRoKFwiaWQ6XCIpKSkge1xuICAgICAgbGluZXMuc3BsaWNlKDEsIDAsIGBpZDogJHt0eXBlLm5leHRJZH1gKTtcbiAgICB9XG5cbiAgICBjb25zdCBibG9jayA9IFwiXFxuLS0tXFxuXFxuXCIgKyBsaW5lcy5qb2luKFwiXFxuXCIpO1xuXG4gICAgLy8gQXBwZW5kIHRvIGZpbGVcbiAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHR5cGUuZmlsZVBhdGgpO1xuICAgIGlmICghKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHtcbiAgICAgIG5ldyBOb3RpY2UoYEZpbGUgbm90IGZvdW5kOiAke3R5cGUuZmlsZVBhdGh9YCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5yZWFkKGZpbGUpO1xuICAgICAgLy8gRW5zdXJlIGZpbGUgZW5kcyB3aXRoIGEgbmV3bGluZSBiZWZvcmUgYXBwZW5kaW5nXG4gICAgICBjb25zdCBzZXAgPSBjb250ZW50LmVuZHNXaXRoKFwiXFxuXCIpID8gXCJcIiA6IFwiXFxuXCI7XG4gICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5tb2RpZnkoZmlsZSwgY29udGVudCArIHNlcCArIGJsb2NrICsgXCJcXG5cIik7XG4gICAgICBuZXcgTm90aWNlKGBDcmVhdGVkIFwiJHtrZXlWYWx9XCIgaW4gJHt0eXBlLmZpbGVMYWJlbH1gKTtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgIHRoaXMub25DcmVhdGVkKHR5cGUuZmlsZVBhdGgpO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgbmV3IE5vdGljZShgRmFpbGVkIHRvIGNyZWF0ZSBvYmplY3Q6ICR7ZXJyfWApO1xuICAgIH1cbiAgfVxufVxuIiwgIi8qKlxuICogQ29kZU1pcnJvciA2IGVkaXRvciBleHRlbnNpb24gdGhhdCBoaWdobGlnaHRzIHt7b2JqZWN0IGxpbmtzfX1cbiAqIGluIGxpdmUtcHJldmlldyBtb2RlIHRvIG1hdGNoIHRoZSBhcHBlYXJhbmNlIG9mIFtbd2lraWxpbmtzXV0uXG4gKlxuICogVXNlcyBPYnNpZGlhbidzIG93biBDU1MgdmFyaWFibGVzIGFuZCBjbGFzc2VzIHNvIHRoZSBzdHlsaW5nXG4gKiBpcyBjb25zaXN0ZW50IHdpdGggdGhlIG5hdGl2ZSBsaW5rIGFwcGVhcmFuY2UuXG4gKi9cblxuaW1wb3J0IHtcbiAgRGVjb3JhdGlvbixcbiAgRGVjb3JhdGlvblNldCxcbiAgRWRpdG9yVmlldyxcbiAgVmlld1BsdWdpbixcbiAgVmlld1VwZGF0ZSxcbiAga2V5bWFwLFxufSBmcm9tIFwiQGNvZGVtaXJyb3Ivdmlld1wiO1xuaW1wb3J0IHsgRWRpdG9yU2VsZWN0aW9uLCBSYW5nZVNldEJ1aWxkZXIgfSBmcm9tIFwiQGNvZGVtaXJyb3Ivc3RhdGVcIjtcblxuLyogXHUyNTAwXHUyNTAwIERlY29yYXRpb24gc3BlY3MgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwICovXG5cbmNvbnN0IGxpbmtEZWNvID0gRGVjb3JhdGlvbi5tYXJrKHsgY2xhc3M6IFwib2wtY20tbGlua1wiIH0pO1xuY29uc3QgbGlua0VkaXRpbmdEZWNvID0gRGVjb3JhdGlvbi5tYXJrKHsgY2xhc3M6IFwib2wtY20tbGluay1lZGl0aW5nXCIgfSk7XG5cbi8qIFx1MjUwMFx1MjUwMCBCdWlsZCBkZWNvcmF0aW9ucyBmb3IgdmlzaWJsZSByYW5nZXMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwICovXG5cbmZ1bmN0aW9uIGJ1aWxkRGVjb3JhdGlvbnModmlldzogRWRpdG9yVmlldyk6IERlY29yYXRpb25TZXQge1xuICBjb25zdCBidWlsZGVyID0gbmV3IFJhbmdlU2V0QnVpbGRlcjxEZWNvcmF0aW9uPigpO1xuICBjb25zdCBjdXJzb3JIZWFkID0gdmlldy5zdGF0ZS5zZWxlY3Rpb24ubWFpbi5oZWFkO1xuICBjb25zdCByZWdleCA9IC9cXHtcXHsoW159XSspXFx9XFx9L2c7XG5cbiAgZm9yIChjb25zdCB7IGZyb20sIHRvIH0gb2Ygdmlldy52aXNpYmxlUmFuZ2VzKSB7XG4gICAgY29uc3QgdGV4dCA9IHZpZXcuc3RhdGUuc2xpY2VEb2MoZnJvbSwgdG8pO1xuICAgIGxldCBtYXRjaDogUmVnRXhwRXhlY0FycmF5IHwgbnVsbDtcblxuICAgIHdoaWxlICgobWF0Y2ggPSByZWdleC5leGVjKHRleHQpKSAhPT0gbnVsbCkge1xuICAgICAgY29uc3Qgc3RhcnQgPSBmcm9tICsgbWF0Y2guaW5kZXg7XG4gICAgICBjb25zdCBlbmQgPSBzdGFydCArIG1hdGNoWzBdLmxlbmd0aDtcblxuICAgICAgLy8gVXNlIGEgc3VidGxlciBzdHlsZSB3aGVuIHRoZSBjdXJzb3IgaXMgaW5zaWRlIHRoZSBtYXRjaFxuICAgICAgY29uc3QgY3Vyc29ySW5zaWRlID0gY3Vyc29ySGVhZCA+PSBzdGFydCAmJiBjdXJzb3JIZWFkIDw9IGVuZDtcbiAgICAgIGJ1aWxkZXIuYWRkKHN0YXJ0LCBlbmQsIGN1cnNvckluc2lkZSA/IGxpbmtFZGl0aW5nRGVjbyA6IGxpbmtEZWNvKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gYnVpbGRlci5maW5pc2goKTtcbn1cblxuLyogXHUyNTAwXHUyNTAwIFZpZXdQbHVnaW4gXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwICovXG5cbmV4cG9ydCBjb25zdCBvYmplY3RMaW5rSGlnaGxpZ2h0ZXIgPSBWaWV3UGx1Z2luLmZyb21DbGFzcyhcbiAgY2xhc3Mge1xuICAgIGRlY29yYXRpb25zOiBEZWNvcmF0aW9uU2V0O1xuXG4gICAgY29uc3RydWN0b3IodmlldzogRWRpdG9yVmlldykge1xuICAgICAgdGhpcy5kZWNvcmF0aW9ucyA9IGJ1aWxkRGVjb3JhdGlvbnModmlldyk7XG4gICAgfVxuXG4gICAgdXBkYXRlKHVwZGF0ZTogVmlld1VwZGF0ZSk6IHZvaWQge1xuICAgICAgaWYgKHVwZGF0ZS5kb2NDaGFuZ2VkIHx8IHVwZGF0ZS52aWV3cG9ydENoYW5nZWQgfHwgdXBkYXRlLnNlbGVjdGlvblNldCkge1xuICAgICAgICB0aGlzLmRlY29yYXRpb25zID0gYnVpbGREZWNvcmF0aW9ucyh1cGRhdGUudmlldyk7XG4gICAgICB9XG4gICAgfVxuICB9LFxuICB7XG4gICAgZGVjb3JhdGlvbnM6ICh2KSA9PiB2LmRlY29yYXRpb25zLFxuICB9XG4pO1xuXG4vKipcbiAqIEtleWJpbmRpbmc6IGlmIHlvdSBoYXZlIGEgc2VsZWN0aW9uIGFuZCBwcmVzcyBge2AsIHdyYXAgaXQgaW4gYHt7IC4uLiB9fWAuXG4gKiBJZiB0aGVyZSdzIG5vIHNlbGVjdGlvbiwgbGV0IENvZGVNaXJyb3IgaW5zZXJ0IGB7YCBub3JtYWxseS5cbiAqL1xuZXhwb3J0IGNvbnN0IG9iamVjdExpbmtXcmFwcGVyS2V5bWFwID0ga2V5bWFwLm9mKFtcbiAge1xuICAgIGtleTogXCJ7XCIsXG4gICAgcnVuOiAodmlldykgPT4ge1xuICAgICAgY29uc3Qgc2VsID0gdmlldy5zdGF0ZS5zZWxlY3Rpb247XG4gICAgICBpZiAoc2VsLnJhbmdlcy5ldmVyeSgocikgPT4gci5lbXB0eSkpIHJldHVybiBmYWxzZTtcblxuICAgICAgY29uc3QgY2hhbmdlczogeyBmcm9tOiBudW1iZXI7IHRvOiBudW1iZXI7IGluc2VydDogc3RyaW5nIH1bXSA9IFtdO1xuICAgICAgY29uc3QgbmV3UmFuZ2VzOiBhbnlbXSA9IFtdO1xuXG4gICAgICBmb3IgKGNvbnN0IHIgb2Ygc2VsLnJhbmdlcykge1xuICAgICAgICBjb25zdCB0ZXh0ID0gdmlldy5zdGF0ZS5kb2Muc2xpY2VTdHJpbmcoci5mcm9tLCByLnRvKTtcbiAgICAgICAgY29uc3QgaW5zZXJ0ID0gYHt7JHt0ZXh0fX19YDtcbiAgICAgICAgY2hhbmdlcy5wdXNoKHsgZnJvbTogci5mcm9tLCB0bzogci50bywgaW5zZXJ0IH0pO1xuXG4gICAgICAgIC8vIFBsYWNlIGN1cnNvciBpbnNpZGUgdGhlIGJyYWNlcywgc2VsZWN0aW5nIHRoZSBvcmlnaW5hbCB0ZXh0LlxuICAgICAgICBjb25zdCBzdGFydCA9IHIuZnJvbSArIDI7XG4gICAgICAgIGNvbnN0IGVuZCA9IHN0YXJ0ICsgdGV4dC5sZW5ndGg7XG4gICAgICAgIG5ld1Jhbmdlcy5wdXNoKEVkaXRvclNlbGVjdGlvbi5yYW5nZShzdGFydCwgZW5kKSk7XG4gICAgICB9XG5cbiAgICAgIHZpZXcuZGlzcGF0Y2goe1xuICAgICAgICBjaGFuZ2VzLFxuICAgICAgICBzZWxlY3Rpb246IEVkaXRvclNlbGVjdGlvbi5jcmVhdGUobmV3UmFuZ2VzLCBzZWwubWFpbkluZGV4KSxcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSxcbiAgfSxcbl0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxJQUFBQSxtQkFTTzs7O0FDaURBLFNBQVMscUJBQ2QsU0FDQSxVQUNtQjtBQUNuQixRQUFNLFFBQVEsUUFBUSxNQUFNLElBQUk7QUFHaEMsTUFBSSxXQUFXO0FBQ2YsTUFBSSxNQUFNLFNBQVMsS0FBSyxNQUFNLENBQUMsRUFBRSxLQUFLLE1BQU0sT0FBTztBQUNqRCxhQUFTLElBQUksR0FBRyxJQUFJLE1BQU0sUUFBUSxLQUFLO0FBQ3JDLFVBQUksTUFBTSxDQUFDLEVBQUUsS0FBSyxNQUFNLE9BQU87QUFDN0IsbUJBQVcsSUFBSTtBQUNmO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBSUEsTUFBSSxVQUFVO0FBQ2QsV0FBUyxJQUFJLFVBQVUsSUFBSSxNQUFNLFFBQVEsS0FBSztBQUM1QyxVQUFNLFVBQVUsTUFBTSxDQUFDLEVBQUUsS0FBSztBQUM5QixRQUFJLFFBQVEsV0FBVztBQUFHO0FBRTFCLFFBQUksUUFBUSxXQUFXLEdBQUcsS0FBSyxDQUFDLFFBQVEsU0FBUyxHQUFHO0FBQUc7QUFDdkQsY0FBVTtBQUNWO0FBQUEsRUFDRjtBQUVBLFFBQU0sV0FBVyxRQUFRLE1BQU0sZ0JBQWdCO0FBQy9DLE1BQUksQ0FBQztBQUFVLFdBQU87QUFFdEIsUUFBTSxjQUFjLFNBQVMsQ0FBQyxFQUFFLEtBQUs7QUFDckMsUUFBTSxZQUFZLFNBQVMsUUFBUSxTQUFTLEVBQUUsRUFBRSxRQUFRLFVBQVUsRUFBRTtBQUdwRSxRQUFNLFVBQTBCLENBQUM7QUFDakMsTUFBSSxlQUE4RDtBQUNsRSxNQUFJLHVCQUF1QjtBQUUz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QUFBLEVBQ1QsWUFBWTtBQUFBLEVBQ1osV0FBVztBQUFBLEVBQ1gsYUFBYTtBQUFBLEVBQ2IsYUFBYTtBQUFBLEVBQ2IsU0FBUztBQUFBLEVBQ1QsV0FBVztBQUFBLEVBQ1gsWUFBWTtBQUFBLEVBQ1osTUFBTTtBQUFBLEVBQ04sV0FBVztBQUFBLEVBQ1gsTUFBTTtBQUFBLEVBQ04sT0FBTztBQUFBLEVBQ1AsYUFBYTtBQUFBLEVBQ2IsTUFBTTtBQUFBLEVBQ04sVUFBVTtBQUFBLEVBQ1YsU0FBUztBQUFBLEVBQ1QsV0FBVztBQUFBLEVBQ1gsUUFBUTtBQUFBLEVBQ1IsT0FBTztBQUFBLEVBQ1AsT0FBTztBQUFBLEVBQ1AsVUFBVTtBQUFBLEVBQ1YsZUFBZTtBQUFBLEVBQ2YsV0FBVztBQUFBLEVBQ1gsY0FBYztBQUFBLEVBQ2QsV0FBVztBQUFBLEVBQ1gsWUFBWTtBQUFBLEVBQ1osV0FBVztBQUFBLEVBQ1gsc0JBQXNCO0FBQUEsRUFDdEIsV0FBVztBQUFBLEVBQ1gsWUFBWTtBQUFBLEVBQ1osV0FBVztBQUFBLEVBQ1gsV0FBVztBQUFBLEVBQ1gsYUFBYTtBQUFBLEVBQ2IsZUFBZTtBQUFBLEVBQ2YsY0FBYztBQUFBLEVBQ2QsZ0JBQWdCO0FBQUEsRUFDaEIsZ0JBQWdCO0FBQUEsRUFDaEIsZ0JBQWdCO0FBQUEsRUFDaEIsYUFBYTtBQUFBLEVBQ2IsTUFBTTtBQUFBLEVBQ04sV0FBVztBQUFBLEVBQ1gsT0FBTztBQUFBLEVBQ1AsU0FBUztBQUFBLEVBQ1QsUUFBUTtBQUFBLEVBQ1Isa0JBQWtCO0FBQUEsRUFDbEIsWUFBWTtBQUFBLEVBQ1osY0FBYztBQUFBLEVBQ2QsY0FBYztBQUFBLEVBQ2QsZ0JBQWdCO0FBQUEsRUFDaEIsaUJBQWlCO0FBQUEsRUFDakIsbUJBQW1CO0FBQUEsRUFDbkIsaUJBQWlCO0FBQUEsRUFDakIsaUJBQWlCO0FBQUEsRUFDakIsY0FBYztBQUFBLEVBQ2QsV0FBVztBQUFBLEVBQ1gsV0FBVztBQUFBLEVBQ1gsVUFBVTtBQUFBLEVBQ1YsYUFBYTtBQUFBLEVBQ2IsTUFBTTtB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QVNDLElBQUcsR0FBRztBQUFFLFdBQU9BLE1BQUssT0FBTyxPQUFPLENBQUMsQ0FBQyxDQUFDQSxHQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsRUFBRSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUNBLEdBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDO0FBQUEsRUFBRztBQUFBLEVBQ3hGLFFBQVEsU0FBUyxJQUFJO0FBQUUsV0FBTyxNQUFNLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQztBQUFBLEVBQUc7QUFDNUQ7QUFFQSxJQUFJLElBQUk7QUFBQSxFQUNOLE1BQU07QUFBQSxFQUNOLFNBQVMsQ0FBQyxLQUFLLEdBQUcsRUFBRSxJQUFJLElBQUk7QUFBQSxFQUM1QixPQUFPLFNBQVNDLElBQUcsR0FBRztBQUFFLFdBQU9BLE1BQUssT0FBTyxPQUFPLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQ0EsR0FBRSxDQUFDLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDQSxHQUFFLENBQUMsQ0FBQyxDQUFDO0FBQUEsRUFBRztBQUFBLEVBQ3hGLFFBQVEsU0FBUyxJQUFJO0FBQUUsV0FBTyxNQUFNLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQztBQUFBLEVBQUc7QUFDNUQ7QUFFQSxJQUFJLEtBQUs7QUFBQSxFQUNQLE1BQU07QUFBQSxFQUNOLFNBQVMsQ0FBQyxLQUFLLEtBQUssS0FBSyxLQUFLLE1BQU0sTUFBTSxNQUFNLElBQUksRUFBRSxJQUFJLElBQUk7QUFBQSxFQUM5RCxPQUFPLFNBQVMsSUFBSTtBQUFFLFdBQU8sTUFBTSxPQUFPLE9BQU8sUUFBUSxFQUFFO0FBQUEsRUFBRztBQUFBLEVBQzlELFFBQVEsU0FBUyxJQUFJO0FBQUUsV0FBTztBQUFBLEVBQUk7QUFDcEM7QUEyREEsU0FBUyxLQUFLLEdBQUc7QUFDZixTQUFPLEVBQUMsTUFBTSxFQUFDO0FBQ2pCOzs7QUN4R2UsU0FBUixZQUFpQixHQUFHO0FBQ3pCLFFBQU1DLEtBQUksQ0FBQyxLQUFLLEdBQUcsS0FBSyxNQUFNLENBQUMsR0FDM0JDLEtBQUksQ0FBQyxLQUFLLEdBQUcsS0FBSyxNQUFNLENBQUM7QUFDN0IsU0FBTyxJQUFJLEtBQUssTUFBTUQsSUFBR0MsRUFBQyxHQUFHRCxJQUFHQyxJQUFHLENBQUM7QUFDdEM7QUFFQSxTQUFTLElBQUksTUFBTUQsSUFBR0MsSUFBRyxHQUFHO0FBQzFCLE1BQUksTUFBTUQsRUFBQyxLQUFLLE1BQU1DLEVBQUM7QUFBRyxXQUFPO0FBRWpDLE1BQUksUUFDQSxPQUFPLEtBQUssT0FDWixPQUFPLEVBQUMsTUFBTSxFQUFDLEdBQ2YsS0FBSyxLQUFLLEtBQ1YsS0FBSyxLQUFLLEtBQ1YsS0FBSyxLQUFLLEtBQ1YsS0FBSyxLQUFLLEtBQ1YsSUFDQSxJQUNBLElBQ0EsSUFDQSxPQUNBLFFBQ0EsR0FDQTtBQUdKLE1BQUksQ0FBQztBQUFNLFdBQU8sS0FBSyxRQUFRLE1BQU07QUFHckMsU0FBTyxLQUFLLFFBQVE7QUFDbEIsUUFBSSxRQUFRRCxPQUFNLE1BQU0sS0FBSyxNQUFNO0FBQUksV0FBSztBQUFBO0FBQVMsV0FBSztBQUMxRCxRQUFJLFNBQVNDLE9BQU0sTUFBTSxLQUFLLE1BQU07QUFBSSxXQUFLO0FBQUE7QUFBUyxXQUFLO0FBQzNELFFBQUksU0FBUyxNQUFNLEVBQUUsT0FBTyxLQUFLLElBQUksVUFBVSxJQUFJLEtBQUs7QUFBSSxhQUFPLE9BQU8sQ0FBQyxJQUFJLE1BQU07QUFBQSxFQUN2RjtBQUdBLE9BQUssQ0FBQyxLQUFLLEdBQUcsS0FBSyxNQUFNLEtBQUssSUFBSTtBQUNsQyxPQUFLLENBQUMsS0FBSyxHQUFHLEtBQUssTUFBTSxLQUFLLElBQUk7QUFDbEMsTUFBSUQsT0FBTSxNQUFNQyxPQUFNO0FBQUksV0FBTyxLQUFLLE9BQU8sTUFBTSxTQUFTLE9BQU8sQ0FBQyxJQUFJLE9BQU8sS0FBSyxRQUFRLE1BQU07QUFHbEcsS0FBRztBQUNELGFBQVMsU0FBUyxPQUFPLENBQUMsSUFBSSxJQUFJLE1BQU0sQ0FBQyxJQUFJLEtBQUssUUFBUSxJQUFJLE1BQU0sQ0FBQztBQUNyRSxRQUFJLFFBQVFELE9BQU0sTUFBTSxLQUFLLE1BQU07QUFBSSxXQUFLO0FBQUE7QUFBUyxXQUFLO0FBQzFELFFBQUksU0FBU0MsT0FBTSxNQUFNLEtBQUssTUFBTTtBQUFJLFdBQUs7QUFBQTtBQUFTLFdBQUs7QUFBQSxFQUM3RCxVQUFVLElBQUksVUFBVSxJQUFJLFlBQVksS0FBSyxNQUFNLE9BQU8sSUFBSyxNQUFNO0FBQ3JFLFNBQU8sT0FBTyxDQUFDLElBQUksTUFBTSxPQUFPLENBQUMsSUFBSSxNQUFNO0FBQzdDO0FBRU8sU0FBUyxPQUFPLE1BQU07QUFDM0IsTUFBSSxHQUFHLEdBQUcsSUFBSSxLQUFLLFFBQ2ZELElBQ0FDLElBQ0EsS0FBSyxJQUFJLE1BQU0sQ0FBQyxHQUNoQixLQUFLLElBQUksTUFBTSxDQUFDLEdBQ2hCLEtBQUssVUFDTCxLQUFLLFVBQ0wsS0FBSyxXQUNMLEtBQUs7QUFHVCxPQUFLLElBQUksR0FBRyxJQUFJLEdBQUcsRUFBRSxHQUFHO0FBQ3RCLFFBQUksTUFBTUQsS0FBSSxDQUFDLEtBQUssR0FBRyxLQUFLLE1BQU0sSUFBSSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssTUFBTUMsS0FBSSxDQUFDLEtBQUssR0FBRyxLQUFLLE1BQU0sQ0FBQyxDQUFDO0FBQUc7QUFDdEYsT0FBRyxDQUFDLElBQUlEO0FBQ1IsT0FBRyxDQUFDLElBQUlDO0FBQ1IsUUFBSUQsS0FBSTtBQUFJLFdBQUtBO0FBQ2pCLFFBQUlBLEtBQUk7QUFBSSxXQUFLQTtBQUNqQixRQUFJQyxLQUFJO0FBQUksV0FBS0E7QUFDakIsUUFBSUEsS0FBSTtBQUFJLFdBQUtBO0FBQUEsRUFDbkI7QUFHQSxNQUFJLEtBQUssTUFBTSxLQUFLO0FBQUksV0FBTztBQUcvQixPQUFLLE1BQU0sSUFBSSxFQUFFLEVBQUUsTUFBTSxJQUFJLEVBQUU7QUFHL0IsT0FBSyxJQUFJLEdBQUcsSUFBSSxHQUFHLEVBQUUsR0FBRztBQUN0QixRQUFJLE1BQU0sR0FBRyxDQUFDLEdBQUcsR0FBRyxDQUFDLEdBQUcsS0FBSyxDQUFDLENBQUM7QUFBQSxFQUNqQztBQUVBLFNBQU87QUFDVDs7O0FDbkZlLFNBQVIsY0FBaUJDLElBQUdDLElBQUc7QUFDNUIsTUFBSSxNQUFNRCxLQUFJLENBQUNBLEVBQUMsS0FBSyxNQUFNQyxLQUFJLENBQUNBLEVBQUM7QUFBRyxXQUFPO0FBRTNDLE1BQUksS0FBSyxLQUFLLEtBQ1YsS0FBSyxLQUFLLEtBQ1YsS0FBSyxLQUFLLEtBQ1YsS0FBSyxLQUFLO0FBS2QsTUFBSSxNQUFNLEVBQUUsR0FBRztBQUNiLFVBQU0sS0FBSyxLQUFLLE1BQU1ELEVBQUMsS0FBSztBQUM1QixVQUFNLEtBQUssS0FBSyxNQUFNQyxFQUFDLEtBQUs7QUFBQSxFQUM5QixPQUdLO0FBQ0gsUUFBSSxJQUFJLEtBQUssTUFBTSxHQUNmLE9BQU8sS0FBSyxPQUNaLFFBQ0E7QUFFSixXQUFPLEtBQUtELE1BQUtBLE1BQUssTUFBTSxLQUFLQyxNQUFLQSxNQUFLLElBQUk7QUFDN0MsV0FBS0EsS0FBSSxPQUFPLElBQUtELEtBQUk7QUFDekIsZUFBUyxJQUFJLE1BQU0sQ0FBQyxHQUFHLE9BQU8sQ0FBQyxJQUFJLE1BQU0sT0FBTyxRQUFRLEtBQUs7QUFDN0QsY0FBUSxHQUFHO0FBQUEsUUFDVCxLQUFLO0FBQUcsZUFBSyxLQUFLLEdBQUcsS0FBSyxLQUFLO0FBQUc7QUFBQSxRQUNsQyxLQUFLO0FBQUcsZUFBSyxLQUFLLEdBQUcsS0FBSyxLQUFLO0FBQUc7QUFBQSxRQUNsQyxLQUFLO0FBQUcsZUFBSyxLQUFLLEdBQUcsS0FBSyxLQUFLO0FBQUc7QUFBQSxRQUNsQyxLQUFLO0FBQUcsZUFBSyxLQUFLLEdBQUcsS0FBSyxLQUFLO0FBQUc7QUFBQSxNQUNwQztBQUFBLElBQ0Y7QUFFQSxRQUFJLEtBQUssU0FBUyxLQUFLLE1BQU07QUFBUSxXQUFLLFFBQVE7QUFBQSxFQUNwRDtBQUVBLE9BQUssTUFBTTtBQUNYLE9BQUssTUFBTTtBQUNYLE9BQUssTUFBTTtBQUNYLE9BQUssTUFBTTtBQUNYLFNBQU87QUFDVDs7O0FDMUNlLFNBQVJFLGdCQUFtQjtBQUN4QixNQUFJLE9BQU8sQ0FBQztBQUNaLE9BQUssTUFBTSxTQUFTLE1BQU07QUFDeEIsUUFBSSxDQUFDLEtBQUs7QUFBUTtBQUFHLGFBQUssS0FBSyxLQUFLLElBQUk7QUFBQSxhQUFVLE9BQU8sS0FBSztBQUFBLEVBQ2hFLENBQUM7QUFDRCxTQUFPO0FBQ1Q7OztBQ05lLFNBQVIsZUFBaUIsR0FBRztBQUN6QixTQUFPLFVBQVUsU0FDWCxLQUFLLE1BQU0sQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLENBQUMsRUFBRSxNQUFNLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxDQUFDLElBQ3ZELE1BQU0sS0FBSyxHQUFHLElBQUksU0FBWSxDQUFDLENBQUMsS0FBSyxLQUFLLEtBQUssR0FBRyxHQUFHLENBQUMsS0FBSyxLQUFLLEtBQUssR0FBRyxDQUFDO0FBQ2pGOzs7QUNKZSxTQUFSLGFBQWlCLE1BQU0sSUFBSSxJQUFJLElBQUksSUFBSTtBQUM1QyxPQUFLLE9BQU87QUFDWixPQUFLLEtBQUs7QUFDVixPQUFLLEtBQUs7QUFDVixPQUFLLEtBQUs7QUFDVixPQUFLLEtBQUs7QUFDWjs7O0FDSmUsU0FBUixhQUFpQkMsSUFBR0MsSUFBRyxRQUFRO0FBQ3BDLE1BQUksTUFDQSxLQUFLLEtBQUssS0FDVixLQUFLLEtBQUssS0FDVixJQUNBLElBQ0FDLEtBQ0FDLEtBQ0FDLE1BQUssS0FBSyxLQUNWQyxNQUFLLEtBQUssS0FDVixRQUFRLENBQUMsR0FDVCxPQUFPLEtBQUssT0FDWixHQUNBO0FBRUosTUFBSTtBQUFNLFVBQU0sS0FBSyxJQUFJLGFBQUssTUFBTSxJQUFJLElBQUlELEtBQUlDLEdBQUUsQ0FBQztBQUNuRCxNQUFJLFVBQVU7QUFBTSxhQUFTO0FBQUEsT0FDeEI7QUFDSCxTQUFLTCxLQUFJLFFBQVEsS0FBS0MsS0FBSTtBQUMxQixJQUFBRyxNQUFLSixLQUFJLFFBQVFLLE1BQUtKLEtBQUk7QUFDMUIsY0FBVTtBQUFBLEVBQ1o7QUFFQSxTQUFPLElBQUksTUFBTSxJQUFJLEdBQUc7QUFHdEIsUUFBSSxFQUFFLE9BQU8sRUFBRSxVQUNQLEtBQUssRUFBRSxNQUFNRyxRQUNiLEtBQUssRUFBRSxNQUFNQyxRQUNiSCxNQUFLLEVBQUUsTUFBTSxPQUNiQyxNQUFLLEVBQUUsTUFBTTtBQUFJO0FBR3pCLFFBQUksS0FBSyxRQUFRO0FBQ2YsVUFBSSxNQUFNLEtBQUtELE9BQU0sR0FDakIsTUFBTSxLQUFLQyxPQUFNO0FBRXJCLFlBQU07QUFBQSxRQUNKLElBQUksYUFBSyxLQUFLLENBQUMsR0FBRyxJQUFJLElBQUlELEtBQUlDLEdBQUU7QUFBQSxRQUNoQyxJQUFJLGFBQUssS0FBSyxDQUFDLEdBQUcsSUFBSSxJQUFJLElBQUlBLEdBQUU7QUFBQSxRQUNoQyxJQUFJLGFBQUssS0FBSyxDQUFDLEdBQUcsSUFBSSxJQUFJRCxLQUFJLEVBQUU7QUFBQSxRQUNoQyxJQUFJLGFBQUssS0FBSyxDQUFDLEdBQUcsSUFBSSxJQUFJLElBQUksRUFBRTtBQUFBLE1BQ2xDO0FBR0EsVUFBSSxLQUFLRCxNQUFLLE9BQU8sSUFBS0QsTUFBSyxJQUFLO0FBQ2xDLFlBQUksTUFBTSxNQUFNLFNBQVMsQ0FBQztBQUMxQixjQUFNLE1BQU0sU0FBUyxDQUFDLElBQUksTUFBTSxNQUFNLFNBQVMsSUFBSSxDQUFDO0FBQ3BELGNBQU0sTUFBTSxTQUFTLElBQUksQ0FBQyxJQUFJO0FBQUEsTUFDaEM7QUFBQSxJQUNGLE9BR0s7QUFDSCxVQUFJLEtBQUtBLEtBQUksQ0FBQyxLQUFLLEdBQUcsS0FBSyxNQUFNLEtBQUssSUFBSSxHQUN0QyxLQUFLQyxLQUFJLENBQUMsS0FBSyxHQUFHLEtBQUssTUFBTSxLQUFLLElBQUksR0FDdEMsS0FBSyxLQUFLLEtBQUssS0FBSztBQUN4QixVQUFJLEtBQUssUUFBUTtBQUNmLFlBQUksSUFBSSxLQUFLLEtBQUssU0FBUyxFQUFFO0FBQzdCLGFBQUtELEtBQUksR0FBRyxLQUFLQyxLQUFJO0FBQ3JCLFFBQUFHLE1BQUtKLEtBQUksR0FBR0ssTUFBS0osS0FBSTtBQUNyQixlQUFPLEtBQUs7QUFBQSxNQUNkO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFFQSxTQUFPO0FBQ1Q7OztBQ3JFZSxTQUFSSyxnQkFBaUIsR0FBRztBQUN6QixNQUFJLE1BQU1DLEtBQUksQ0FBQyxLQUFLLEdBQUcsS0FBSyxNQUFNLENBQUMsQ0FBQyxLQUFLLE1BQU1DLEtBQUksQ0FBQyxLQUFLLEdBQUcsS0FBSyxNQUFNLENBQUMsQ0FBQztBQUFHLFdBQU87QUFFbkYsTUFBSSxRQUNBLE9BQU8sS0FBSyxPQUNaLFVBQ0EsVUFDQSxNQUNBLEtBQUssS0FBSyxLQUNWLEtBQUssS0FBSyxLQUNWLEtBQUssS0FBSyxLQUNWLEtBQUssS0FBSyxLQUNWRCxJQUNBQyxJQUNBLElBQ0EsSUFDQSxPQUNBLFFBQ0EsR0FDQTtBQUdKLE1BQUksQ0FBQztBQUFNLFdBQU87QUFJbEIsTUFBSSxLQUFLO0FBQVEsV0FBTyxNQUFNO0FBQzVCLFVBQUksUUFBUUQsT0FBTSxNQUFNLEtBQUssTUFBTTtBQUFJLGFBQUs7QUFBQTtBQUFTLGFBQUs7QUFDMUQsVUFBSSxTQUFTQyxPQUFNLE1BQU0sS0FBSyxNQUFNO0FBQUksYUFBSztBQUFBO0FBQVMsYUFBSztBQUMzRCxVQUFJLEVBQUUsU0FBUyxNQUFNLE9BQU8sS0FBSyxJQUFJLFVBQVUsSUFBSSxLQUFLO0FBQUksZUFBTztBQUNuRSxVQUFJLENBQUMsS0FBSztBQUFRO0FBQ2xCLFVBQUksT0FBUSxJQUFJLElBQUssQ0FBQyxLQUFLLE9BQVEsSUFBSSxJQUFLLENBQUMsS0FBSyxPQUFRLElBQUksSUFBSyxDQUFDO0FBQUcsbUJBQVcsUUFBUSxJQUFJO0FBQUEsSUFDaEc7QUFHQSxTQUFPLEtBQUssU0FBUztBQUFHLFFBQUksRUFBRSxXQUFXLE1BQU0sT0FBTyxLQUFLO0FBQU8sYUFBTztBQUN6RSxNQUFJLE9BQU8sS0FBSztBQUFNLFdBQU8sS0FBSztBQUdsQyxNQUFJO0FBQVUsV0FBUSxPQUFPLFNBQVMsT0FBTyxPQUFPLE9BQU8sU0FBUyxNQUFPO0FBRzNFLE1BQUksQ0FBQztBQUFRLFdBQU8sS0FBSyxRQUFRLE1BQU07QUFHdkMsU0FBTyxPQUFPLENBQUMsSUFBSSxPQUFPLE9BQU8sT0FBTyxDQUFDO0FBR3pDLE9BQUssT0FBTyxPQUFPLENBQUMsS0FBSyxPQUFPLENBQUMsS0FBSyxPQUFPLENBQUMsS0FBSyxPQUFPLENBQUMsTUFDcEQsVUFBVSxPQUFPLENBQUMsS0FBSyxPQUFPLENBQUMsS0FBSyxPQUFPLENBQUMsS0FBSyxPQUFPLENBQUMsTUFDekQsQ0FBQyxLQUFLLFFBQVE7QUFDbkIsUUFBSTtBQUFVLGVBQVMsQ0FBQyxJQUFJO0FBQUE7QUFDdkIsV0FBSyxRQUFRO0FBQUEsRUFDcEI7QUFFQSxTQUFPO0FBQ1Q7QUFFTyxTQUFTLFVBQVUsTUFBTTtBQUM5QixXQUFTLElBQUksR0FBRyxJQUFJLEtBQUssUUFBUSxJQUFJLEdBQUcsRUFBRTtBQUFHLFNBQUssT0FBTyxLQUFLLENBQUMsQ0FBQztBQUNoRSxTQUFPO0FBQ1Q7OztBQzdEZSxTQUFSLGVBQW1CO0FBQ3hCLFNBQU8sS0FBSztBQUNkOzs7QUNGZSxTQUFSQyxnQkFBbUI7QUFDeEIsTUFBSSxPQUFPO0FBQ1gsT0FBSyxNQUFNLFNBQVMsTUFBTTtBQUN4QixRQUFJLENBQUMsS0FBSztBQUFRO0FBQUcsVUFBRTtBQUFBLGFBQWEsT0FBTyxLQUFLO0FBQUEsRUFDbEQsQ0FBQztBQUNELFNBQU87QUFDVDs7O0FDSmUsU0FBUixjQUFpQixVQUFVO0FBQ2hDLE1BQUksUUFBUSxDQUFDLEdBQUcsR0FBRyxPQUFPLEtBQUssT0FBTyxPQUFPLElBQUksSUFBSSxJQUFJO0FBQ3pELE1BQUk7QUFBTSxVQUFNLEtBQUssSUFBSSxhQUFLLE1BQU0sS0FBSyxLQUFLLEtBQUssS0FBSyxLQUFLLEtBQUssS0FBSyxHQUFHLENBQUM7QUFDM0UsU0FBTyxJQUFJLE1BQU0sSUFBSSxHQUFHO0FBQ3RCLFFBQUksQ0FBQyxTQUFTLE9BQU8sRUFBRSxNQUFNLEtBQUssRUFBRSxJQUFJLEtBQUssRUFBRSxJQUFJLEtBQUssRUFBRSxJQUFJLEtBQUssRUFBRSxFQUFFLEtBQUssS0FBSyxRQUFRO0FBQ3ZGLFVBQUksTUFBTSxLQUFLLE1BQU0sR0FBRyxNQUFNLEtBQUssTUFBTTtBQUN6QyxVQUFJLFFBQVEsS0FBSyxDQUFDO0FBQUcsY0FBTSxLQUFLLElBQUksYUFBSyxPQUFPLElBQUksSUFBSSxJQUFJLEVBQUUsQ0FBQztBQUMvRCxVQUFJLFFBQVEsS0FBSyxDQUFDO0FBQUcsY0FBTSxLQUFLLElBQUksYUFBSyxPQUFPLElBQUksSUFBSSxJQUFJLEVBQUUsQ0FBQztBQUMvRCxVQUFJLFFBQVEsS0FBSyxDQUFDO0FBQUcsY0FBTSxLQUFLLElBQUksYUFBSyxPQUFPLElBQUksSUFBSSxJQUFJLEVBQUUsQ0FBQztBQUMvRCxVQUFJLFFBQVEsS0FBSyxDQUFDO0FBQUcsY0FBTSxLQUFLLElBQUksYUFBSyxPQUFPLElBQUksSUFBSSxJQUFJLEVBQUUsQ0FBQztBQUFBLElBQ2pFO0FBQUEsRUFDRjtBQUNBLFNBQU87QUFDVDs7O0FDYmUsU0FBUixtQkFBaUIsVUFBVTtBQUNoQyxNQUFJLFFBQVEsQ0FBQyxHQUFHLE9BQU8sQ0FBQyxHQUFHO0FBQzNCLE1BQUksS0FBSztBQUFPLFVBQU0sS0FBSyxJQUFJLGFBQUssS0FBSyxPQUFPLEtBQUssS0FBSyxLQUFLLEtBQUssS0FBSyxLQUFLLEtBQUssR0FBRyxDQUFDO0FBQ3ZGLFNBQU8sSUFBSSxNQUFNLElBQUksR0FBRztBQUN0QixRQUFJLE9BQU8sRUFBRTtBQUNiLFFBQUksS0FBSyxRQUFRO0FBQ2YsVUFBSSxPQUFPLEtBQUssRUFBRSxJQUFJLEtBQUssRUFBRSxJQUFJLEtBQUssRUFBRSxJQUFJLEtBQUssRUFBRSxJQUFJLE1BQU0sS0FBSyxNQUFNLEdBQUcsTUFBTSxLQUFLLE1BQU07QUFDNUYsVUFBSSxRQUFRLEtBQUssQ0FBQztBQUFHLGNBQU0sS0FBSyxJQUFJLGFBQUssT0FBTyxJQUFJLElBQUksSUFBSSxFQUFFLENBQUM7QUFDL0QsVUFBSSxRQUFRLEtBQUssQ0FBQztBQUFHLGNBQU0sS0FBSyxJQUFJLGFBQUssT0FBTyxJQUFJLElBQUksSUFBSSxFQUFFLENBQUM7QUFDL0QsVUFBSSxRQUFRLEtBQUssQ0FBQztBQUFHLGNBQU0sS0FBSyxJQUFJLGFBQUssT0FBTyxJQUFJLElBQUksSUFBSSxFQUFFLENBQUM7QUFDL0QsVUFBSSxRQUFRLEtBQUssQ0FBQztBQUFHLGNBQU0sS0FBSyxJQUFJLGFBQUssT0FBTyxJQUFJLElBQUksSUFBSSxFQUFFLENBQUM7QUFBQSxJQUNqRTtBQUNBLFNBQUssS0FBSyxDQUFDO0FBQUEsRUFDYjtBQUNBLFNBQU8sSUFBSSxLQUFLLElBQUksR0FBRztBQUNyQixhQUFTLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLEVBQUU7QUFBQSxFQUN6QztBQUNBLFNBQU87QUFDVDs7O0FDcEJPLFNBQVMsU0FBUyxHQUFHO0FBQzFCLFNBQU8sRUFBRSxDQUFDO0FBQ1o7QUFFZSxTQUFSLFVBQWlCLEdBQUc7QUFDekIsU0FBTyxVQUFVLFVBQVUsS0FBSyxLQUFLLEdBQUcsUUFBUSxLQUFLO0FBQ3ZEOzs7QUNOTyxTQUFTLFNBQVMsR0FBRztBQUMxQixTQUFPLEVBQUUsQ0FBQztBQUNaO0FBRWUsU0FBUixVQUFpQixHQUFHO0FBQ3pCLFNBQU8sVUFBVSxVQUFVLEtBQUssS0FBSyxHQUFHLFFBQVEsS0FBSztBQUN2RDs7O0FDT2UsU0FBUixTQUEwQixPQUFPQyxJQUFHQyxJQUFHO0FBQzVDLE1BQUksT0FBTyxJQUFJLFNBQVNELE1BQUssT0FBTyxXQUFXQSxJQUFHQyxNQUFLLE9BQU8sV0FBV0EsSUFBRyxLQUFLLEtBQUssS0FBSyxHQUFHO0FBQzlGLFNBQU8sU0FBUyxPQUFPLE9BQU8sS0FBSyxPQUFPLEtBQUs7QUFDakQ7QUFFQSxTQUFTLFNBQVNELElBQUdDLElBQUcsSUFBSSxJQUFJLElBQUksSUFBSTtBQUN0QyxPQUFLLEtBQUtEO0FBQ1YsT0FBSyxLQUFLQztBQUNWLE9BQUssTUFBTTtBQUNYLE9BQUssTUFBTTtBQUNYLE9BQUssTUFBTTtBQUNYLE9BQUssTUFBTTtBQUNYLE9BQUssUUFBUTtBQUNmO0FBRUEsU0FBUyxVQUFVLE1BQU07QUFDdkIsTUFBSSxPQUFPLEVBQUMsTUFBTSxLQUFLLEtBQUksR0FBRyxPQUFPO0FBQ3JDLFNBQU8sT0FBTyxLQUFLO0FBQU0sV0FBTyxLQUFLLE9BQU8sRUFBQyxNQUFNLEtBQUssS0FBSTtBQUM1RCxTQUFPO0FBQ1Q7QUFFQSxJQUFJLFlBQVksU0FBUyxZQUFZLFNBQVM7QUFFOUMsVUFBVSxPQUFPLFdBQVc7QUFDMUIsTUFBSSxPQUFPLElBQUksU0FBUyxLQUFLLElBQUksS0FBSyxJQUFJLEtBQUssS0FBSyxLQUFLLEtBQUssS0FBSyxLQUFLLEtBQUssR0FBRyxHQUM1RSxPQUFPLEtBQUssT0FDWixPQUNBO0FBRUosTUFBSSxDQUFDO0FBQU0sV0FBTztBQUVsQixNQUFJLENBQUMsS0FBSztBQUFRLFdBQU8sS0FBSyxRQUFRLFVBQVUsSUFBSSxHQUFHO0FBRXZELFVBQVEsQ0FBQyxFQUFDLFFBQVEsTUFBTSxRQUFRLEtBQUssUUFBUSxJQUFJLE1BQU0sQ0FBQyxFQUFDLENBQUM7QUFDMUQsU0FBTyxPQUFPLE1BQU0sSUFBSSxHQUFHO0FBQ3pCLGFBQVMsSUFBSSxHQUFHLElBQUksR0FBRyxFQUFFLEdBQUc7QUFDMUIsVUFBSSxRQUFRLEtBQUssT0FBTyxDQUFDLEdBQUc7QUFDMUIsWUFBSSxNQUFNO0FBQVEsZ0JBQU0sS0FBSyxFQUFDLFFBQVEsT0FBTyxRQUFRLEtBQUssT0FBTyxDQUFDLElBQUksSUFBSSxNQUFNLENBQUMsRUFBQyxDQUFDO0FBQUE7QUFDOUUsZUFBSyxPQUFPLENBQUMsSUFBSSxVQUFVLEtBQUs7QUFBQSxNQUN2QztBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBRUEsU0FBTztBQUNUO0FBRUEsVUFBVSxNQUFNO0FBQ2hCLFVBQVUsU0FBUztBQUNuQixVQUFVLFFBQVE7QUFDbEIsVUFBVSxPQUFPQztBQUNqQixVQUFVLFNBQVM7QUFDbkIsVUFBVSxPQUFPO0FBQ2pCLFVBQVUsU0FBU0M7QUFDbkIsVUFBVSxZQUFZO0FBQ3RCLFVBQVUsT0FBTztBQUNqQixVQUFVLE9BQU9DO0FBQ2pCLFVBQVUsUUFBUTtBQUNsQixVQUFVLGFBQWE7QUFDdkIsVUFBVSxJQUFJO0FBQ2QsVUFBVSxJQUFJOzs7QUN4RUMsU0FBUkMsa0JBQWlCQyxJQUFHO0FBQ3pCLFNBQU8sV0FBVztBQUNoQixXQUFPQTtBQUFBLEVBQ1Q7QUFDRjs7O0FDSmUsU0FBUixlQUFpQixRQUFRO0FBQzlCLFVBQVEsT0FBTyxJQUFJLE9BQU87QUFDNUI7OztBQ0VBLFNBQVMsRUFBRSxHQUFHO0FBQ1osU0FBTyxFQUFFLElBQUksRUFBRTtBQUNqQjtBQUVBLFNBQVMsRUFBRSxHQUFHO0FBQ1osU0FBTyxFQUFFLElBQUksRUFBRTtBQUNqQjtBQUVlLFNBQVIsZ0JBQWlCLFFBQVE7QUFDOUIsTUFBSSxPQUNBLE9BQ0EsUUFDQSxXQUFXLEdBQ1gsYUFBYTtBQUVqQixNQUFJLE9BQU8sV0FBVztBQUFZLGFBQVNDLGtCQUFTLFVBQVUsT0FBTyxJQUFJLENBQUMsTUFBTTtBQUVoRixXQUFTLFFBQVE7QUFDZixRQUFJLEdBQUcsSUFBSSxNQUFNLFFBQ2IsTUFDQSxNQUNBLElBQ0EsSUFDQSxJQUNBO0FBRUosYUFBUyxJQUFJLEdBQUcsSUFBSSxZQUFZLEVBQUUsR0FBRztBQUNuQyxhQUFPLFNBQVMsT0FBTyxHQUFHLENBQUMsRUFBRSxXQUFXLE9BQU87QUFDL0MsV0FBSyxJQUFJLEdBQUcsSUFBSSxHQUFHLEVBQUUsR0FBRztBQUN0QixlQUFPLE1BQU0sQ0FBQztBQUNkLGFBQUssTUFBTSxLQUFLLEtBQUssR0FBRyxNQUFNLEtBQUs7QUFDbkMsYUFBSyxLQUFLLElBQUksS0FBSztBQUNuQixhQUFLLEtBQUssSUFBSSxLQUFLO0FBQ25CLGFBQUssTUFBTSxLQUFLO0FBQUEsTUFDbEI7QUFBQSxJQUNGO0FBRUEsYUFBUyxNQUFNLE1BQU0sSUFBSSxJQUFJLElBQUksSUFBSTtBQUNuQyxVQUFJLE9BQU8sS0FBSyxNQUFNLEtBQUssS0FBSyxHQUFHLElBQUksS0FBSztBQUM1QyxVQUFJLE1BQU07QUFDUixZQUFJLEtBQUssUUFBUSxLQUFLLE9BQU87QUFDM0IsY0FBSUMsS0FBSSxLQUFLLEtBQUssSUFBSSxLQUFLLElBQ3ZCQyxLQUFJLEtBQUssS0FBSyxJQUFJLEtBQUssSUFDdkIsSUFBSUQsS0FBSUEsS0FBSUMsS0FBSUE7QUFDcEIsY0FBSSxJQUFJLElBQUksR0FBRztBQUNiLGdCQUFJRCxPQUFNO0FBQUcsY0FBQUEsS0FBSSxlQUFPLE1BQU0sR0FBRyxLQUFLQSxLQUFJQTtBQUMxQyxnQkFBSUMsT0FBTTtBQUFHLGNBQUFBLEtBQUksZUFBTyxNQUFNLEdBQUcsS0FBS0EsS0FBSUE7QUFDMUMsaUJBQUssS0FBSyxJQUFJLEtBQUssS0FBSyxDQUFDLE1BQU0sSUFBSTtBQUNuQyxpQkFBSyxPQUFPRCxNQUFLLE1BQU0sS0FBSyxNQUFNLE9BQU8sTUFBTTtBQUMvQyxpQkFBSyxPQUFPQyxNQUFLLEtBQUs7QUFDdEIsaUJBQUssTUFBTUQsTUFBSyxJQUFJLElBQUk7QUFDeEIsaUJBQUssTUFBTUMsS0FBSTtBQUFBLFVBQ2pCO0FBQUEsUUFDRjtBQUNBO0FBQUEsTUFDRjtBQUNBLGFBQU8sS0FBSyxLQUFLLEtBQUssS0FBSyxLQUFLLEtBQUssS0FBSyxLQUFLLEtBQUssS0FBSyxLQUFLO0FBQUEsSUFDaEU7QUFBQSxFQUNGO0FBRUEsV0FBUyxRQUFRLE1BQU07QUFDckIsUUFBSSxLQUFLO0FBQU0sYUFBTyxLQUFLLElBQUksTUFBTSxLQUFLLEtBQUssS0FBSztBQUNwRCxhQUFTLElBQUksS0FBSyxJQUFJLEdBQUcsSUFBSSxHQUFHLEVBQUUsR0FBRztBQUNuQyxVQUFJLEtBQUssQ0FBQyxLQUFLLEtBQUssQ0FBQyxFQUFFLElBQUksS0FBSyxHQUFHO0FBQ2pDLGFBQUssSUFBSSxLQUFLLENBQUMsRUFBRTtBQUFBLE1BQ25CO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFFQSxXQUFTLGFBQWE7QUFDcEIsUUFBSSxDQUFDO0FBQU87QUFDWixRQUFJLEdBQUcsSUFBSSxNQUFNLFFBQVE7QUFDekIsWUFBUSxJQUFJLE1BQU0sQ0FBQztBQUNuQixTQUFLLElBQUksR0FBRyxJQUFJLEdBQUcsRUFBRTtBQUFHLGFBQU8sTUFBTSxDQUFDLEdBQUcsTUFBTSxLQUFLLEtBQUssSUFBSSxDQUFDLE9BQU8sTUFBTSxHQUFHLEtBQUs7QUFBQSxFQUNyRjtBQUVBLFFBQU0sYUFBYSxTQUFTLFFBQVEsU0FBUztBQUMzQyxZQUFRO0FBQ1IsYUFBUztBQUNULGVBQVc7QUFBQSxFQUNiO0FBRUEsUUFBTSxhQUFhLFNBQVMsR0FBRztBQUM3QixXQUFPLFVBQVUsVUFBVSxhQUFhLENBQUMsR0FBRyxTQUFTO0FBQUEsRUFDdkQ7QUFFQSxRQUFNLFdBQVcsU0FBUyxHQUFHO0FBQzNCLFdBQU8sVUFBVSxVQUFVLFdBQVcsQ0FBQyxHQUFHLFNBQVM7QUFBQSxFQUNyRDtBQUVBLFFBQU0sU0FBUyxTQUFTLEdBQUc7QUFDekIsV0FBTyxVQUFVLFVBQVUsU0FBUyxPQUFPLE1BQU0sYUFBYSxJQUFJRixrQkFBUyxDQUFDLENBQUMsR0FBRyxXQUFXLEdBQUcsU0FBUztBQUFBLEVBQ3pHO0FBRUEsU0FBTztBQUNUOzs7QUNoR0EsU0FBUyxNQUFNLEdBQUc7QUFDaEIsU0FBTyxFQUFFO0FBQ1g7QUFFQSxTQUFTRyxNQUFLLFVBQVUsUUFBUTtBQUM5QixNQUFJLE9BQU8sU0FBUyxJQUFJLE1BQU07QUFDOUIsTUFBSSxDQUFDO0FBQU0sVUFBTSxJQUFJLE1BQU0scUJBQXFCLE1BQU07QUFDdEQsU0FBTztBQUNUO0FBRWUsU0FBUixhQUFpQixPQUFPO0FBQzdCLE1BQUlDLE1BQUssT0FDTCxXQUFXLGlCQUNYLFdBQ0EsV0FBV0Msa0JBQVMsRUFBRSxHQUN0QixXQUNBLE9BQ0EsT0FDQSxNQUNBLFFBQ0EsYUFBYTtBQUVqQixNQUFJLFNBQVM7QUFBTSxZQUFRLENBQUM7QUFFNUIsV0FBUyxnQkFBZ0IsTUFBTTtBQUM3QixXQUFPLElBQUksS0FBSyxJQUFJLE1BQU0sS0FBSyxPQUFPLEtBQUssR0FBRyxNQUFNLEtBQUssT0FBTyxLQUFLLENBQUM7QUFBQSxFQUN4RTtBQUVBLFdBQVMsTUFBTSxPQUFPO0FBQ3BCLGFBQVMsSUFBSSxHQUFHLElBQUksTUFBTSxRQUFRLElBQUksWUFBWSxFQUFFLEdBQUc7QUFDckQsZUFBUyxJQUFJLEdBQUcsTUFBTSxRQUFRLFFBQVFDLElBQUdDLElBQUcsR0FBRyxHQUFHLElBQUksR0FBRyxFQUFFLEdBQUc7QUFDNUQsZUFBTyxNQUFNLENBQUMsR0FBRyxTQUFTLEtBQUssUUFBUSxTQUFTLEtBQUs7QUFDckQsUUFBQUQsS0FBSSxPQUFPLElBQUksT0FBTyxLQUFLLE9BQU8sSUFBSSxPQUFPLE1BQU0sZUFBTyxNQUFNO0FBQ2hFLFFBQUFDLEtBQUksT0FBTyxJQUFJLE9BQU8sS0FBSyxPQUFPLElBQUksT0FBTyxNQUFNLGVBQU8sTUFBTTtBQUNoRSxZQUFJLEtBQUssS0FBS0QsS0FBSUEsS0FBSUMsS0FBSUEsRUFBQztBQUMzQixhQUFLLElBQUksVUFBVSxDQUFDLEtBQUssSUFBSSxRQUFRLFVBQVUsQ0FBQztBQUNoRCxRQUFBRCxNQUFLLEdBQUdDLE1BQUs7QUFDYixlQUFPLE1BQU1ELE1BQUssSUFBSSxLQUFLLENBQUM7QUFDNUIsZUFBTyxNQUFNQyxLQUFJO0FBQ2pCLGVBQU8sTUFBTUQsTUFBSyxJQUFJLElBQUk7QUFDMUIsZUFBTyxNQUFNQyxLQUFJO0FBQUEsTUFDbkI7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUVBLFdBQVMsYUFBYTtBQUNwQixRQUFJLENBQUM7QUFBTztBQUVaLFFBQUksR0FDQSxJQUFJLE1BQU0sUUFDVkMsS0FBSSxNQUFNLFFBQ1YsV0FBVyxJQUFJLElBQUksTUFBTSxJQUFJLENBQUMsR0FBR0MsT0FBTSxDQUFDTCxJQUFHLEdBQUdLLElBQUcsS0FBSyxHQUFHLENBQUMsQ0FBQyxDQUFDLEdBQzVEO0FBRUosU0FBSyxJQUFJLEdBQUcsUUFBUSxJQUFJLE1BQU0sQ0FBQyxHQUFHLElBQUlELElBQUcsRUFBRSxHQUFHO0FBQzVDLGFBQU8sTUFBTSxDQUFDLEdBQUcsS0FBSyxRQUFRO0FBQzlCLFVBQUksT0FBTyxLQUFLLFdBQVc7QUFBVSxhQUFLLFNBQVNMLE1BQUssVUFBVSxLQUFLLE1BQU07QUFDN0UsVUFBSSxPQUFPLEtBQUssV0FBVztBQUFVLGFBQUssU0FBU0EsTUFBSyxVQUFVLEtBQUssTUFBTTtBQUM3RSxZQUFNLEtBQUssT0FBTyxLQUFLLEtBQUssTUFBTSxLQUFLLE9BQU8sS0FBSyxLQUFLLEtBQUs7QUFDN0QsWUFBTSxLQUFLLE9BQU8sS0FBSyxLQUFLLE1BQU0sS0FBSyxPQUFPLEtBQUssS0FBSyxLQUFLO0FBQUEsSUFDL0Q7QUFFQSxTQUFLLElBQUksR0FBRyxPQUFPLElBQUksTUFBTUssRUFBQyxHQUFHLElBQUlBLElBQUcsRUFBRSxHQUFHO0FBQzNDLGFBQU8sTUFBTSxDQUFDLEdBQUcsS0FBSyxDQUFDLElBQUksTUFBTSxLQUFLLE9BQU8sS0FBSyxLQUFLLE1BQU0sS0FBSyxPQUFPLEtBQUssSUFBSSxNQUFNLEtBQUssT0FBTyxLQUFLO0FBQUEsSUFDM0c7QUFFQSxnQkFBWSxJQUFJLE1BQU1BLEVBQUMsR0FBRyxtQkFBbUI7QUFDN0MsZ0JBQVksSUFBSSxNQUFNQSxFQUFDLEdBQUcsbUJBQW1CO0FBQUEsRUFDL0M7QUFFQSxXQUFTLHFCQUFxQjtBQUM1QixRQUFJLENBQUM7QUFBTztBQUVaLGFBQVMsSUFBSSxHQUFHLElBQUksTUFBTSxRQUFRLElBQUksR0FBRyxFQUFFLEdBQUc7QUFDNUMsZ0JBQVUsQ0FBQyxJQUFJLENBQUMsU0FBUyxNQUFNLENBQUMsR0FBRyxHQUFHLEtBQUs7QUFBQSxJQUM3QztBQUFBLEVBQ0Y7QUFFQSxXQUFTLHFCQUFxQjtBQUM1QixRQUFJLENBQUM7QUFBTztBQUVaLGFBQVMsSUFBSSxHQUFHLElBQUksTUFBTSxRQUFRLElBQUksR0FBRyxFQUFFLEdBQUc7QUFDNUMsZ0JBQVUsQ0FBQyxJQUFJLENBQUMsU0FBUyxNQUFNLENBQUMsR0FBRyxHQUFHLEtBQUs7QUFBQSxJQUM3QztBQUFBLEVBQ0Y7QUFFQSxRQUFNLGFBQWEsU0FBUyxRQUFRLFNBQVM7QUFDM0MsWUFBUTtBQUNSLGFBQVM7QUFDVCxlQUFXO0FBQUEsRUFDYjtBQUVBLFFBQU0sUUFBUSxTQUFTLEdBQUc7QUFDeEIsV0FBTyxVQUFVLFVBQVUsUUFBUSxHQUFHLFdBQVcsR0FBRyxTQUFTO0FBQUEsRUFDL0Q7QUFFQSxRQUFNLEtBQUssU0FBUyxHQUFHO0FBQ3JCLFdBQU8sVUFBVSxVQUFVSixNQUFLLEdBQUcsU0FBU0E7QUFBQSxFQUM5QztBQUVBLFFBQU0sYUFBYSxTQUFTLEdBQUc7QUFDN0IsV0FBTyxVQUFVLFVBQVUsYUFBYSxDQUFDLEdBQUcsU0FBUztBQUFBLEVBQ3ZEO0FBRUEsUUFBTSxXQUFXLFNBQVMsR0FBRztBQUMzQixXQUFPLFVBQVUsVUFBVSxXQUFXLE9BQU8sTUFBTSxhQUFhLElBQUlDLGtCQUFTLENBQUMsQ0FBQyxHQUFHLG1CQUFtQixHQUFHLFNBQVM7QUFBQSxFQUNuSDtBQUVBLFFBQU0sV0FBVyxTQUFTLEdBQUc7QUFDM0IsV0FBTyxVQUFVLFVBQVUsV0FBVyxPQUFPLE1BQU0sYUFBYSxJQUFJQSxrQkFBUyxDQUFDLENBQUMsR0FBRyxtQkFBbUIsR0FBRyxTQUFTO0FBQUEsRUFDbkg7QUFFQSxTQUFPO0FBQ1Q7OztBQ25IQSxJQUFNLElBQUk7QUFDVixJQUFNLElBQUk7QUFDVixJQUFNLElBQUk7QUFFSyxTQUFSLGNBQW1CO0FBQ3hCLE1BQUksSUFBSTtBQUNSLFNBQU8sT0FBTyxLQUFLLElBQUksSUFBSSxLQUFLLEtBQUs7QUFDdkM7OztBQ0pPLFNBQVNLLEdBQUUsR0FBRztBQUNuQixTQUFPLEVBQUU7QUFDWDtBQUVPLFNBQVNDLEdBQUUsR0FBRztBQUNuQixTQUFPLEVBQUU7QUFDWDtBQUVBLElBQUksZ0JBQWdCO0FBQXBCLElBQ0ksZUFBZSxLQUFLLE1BQU0sSUFBSSxLQUFLLEtBQUssQ0FBQztBQUU5QixTQUFSLG1CQUFpQixPQUFPO0FBQzdCLE1BQUksWUFDQSxRQUFRLEdBQ1IsV0FBVyxNQUNYLGFBQWEsSUFBSSxLQUFLLElBQUksVUFBVSxJQUFJLEdBQUcsR0FDM0MsY0FBYyxHQUNkLGdCQUFnQixLQUNoQixTQUFTLG9CQUFJLElBQUksR0FDakIsVUFBVSxNQUFNLElBQUksR0FDcEIsUUFBUSxpQkFBUyxRQUFRLEtBQUssR0FDOUIsU0FBUyxZQUFJO0FBRWpCLE1BQUksU0FBUztBQUFNLFlBQVEsQ0FBQztBQUU1QixXQUFTLE9BQU87QUFDZCxTQUFLO0FBQ0wsVUFBTSxLQUFLLFFBQVEsVUFBVTtBQUM3QixRQUFJLFFBQVEsVUFBVTtBQUNwQixjQUFRLEtBQUs7QUFDYixZQUFNLEtBQUssT0FBTyxVQUFVO0FBQUEsSUFDOUI7QUFBQSxFQUNGO0FBRUEsV0FBUyxLQUFLLFlBQVk7QUFDeEIsUUFBSSxHQUFHLElBQUksTUFBTSxRQUFRO0FBRXpCLFFBQUksZUFBZTtBQUFXLG1CQUFhO0FBRTNDLGFBQVMsSUFBSSxHQUFHLElBQUksWUFBWSxFQUFFLEdBQUc7QUFDbkMsZ0JBQVUsY0FBYyxTQUFTO0FBRWpDLGFBQU8sUUFBUSxTQUFTLE9BQU87QUFDN0IsY0FBTSxLQUFLO0FBQUEsTUFDYixDQUFDO0FBRUQsV0FBSyxJQUFJLEdBQUcsSUFBSSxHQUFHLEVBQUUsR0FBRztBQUN0QixlQUFPLE1BQU0sQ0FBQztBQUNkLFlBQUksS0FBSyxNQUFNO0FBQU0sZUFBSyxLQUFLLEtBQUssTUFBTTtBQUFBO0FBQ3JDLGVBQUssSUFBSSxLQUFLLElBQUksS0FBSyxLQUFLO0FBQ2pDLFlBQUksS0FBSyxNQUFNO0FBQU0sZUFBSyxLQUFLLEtBQUssTUFBTTtBQUFBO0FBQ3JDLGVBQUssSUFBSSxLQUFLLElBQUksS0FBSyxLQUFLO0FBQUEsTUFDbkM7QUFBQSxJQUNGO0FBRUEsV0FBTztBQUFBLEVBQ1Q7QUFFQSxXQUFTLGtCQUFrQjtBQUN6QixhQUFTLElBQUksR0FBRyxJQUFJLE1BQU0sUUFBUSxNQUFNLElBQUksR0FBRyxFQUFFLEdBQUc7QUFDbEQsYUFBTyxNQUFNLENBQUMsR0FBRyxLQUFLLFFBQVE7QUFDOUIsVUFBSSxLQUFLLE1BQU07QUFBTSxhQUFLLElBQUksS0FBSztBQUNuQyxVQUFJLEtBQUssTUFBTTtBQUFNLGFBQUssSUFBSSxLQUFLO0FBQ25DLFVBQUksTUFBTSxLQUFLLENBQUMsS0FBSyxNQUFNLEtBQUssQ0FBQyxHQUFHO0FBQ2xDLFlBQUksU0FBUyxnQkFBZ0IsS0FBSyxLQUFLLE1BQU0sQ0FBQyxHQUFHLFFBQVEsSUFBSTtBQUM3RCxhQUFLLElBQUksU0FBUyxLQUFLLElBQUksS0FBSztBQUNoQyxhQUFLLElBQUksU0FBUyxLQUFLLElBQUksS0FBSztBQUFBLE1BQ2xDO0FBQ0EsVUFBSSxNQUFNLEtBQUssRUFBRSxLQUFLLE1BQU0sS0FBSyxFQUFFLEdBQUc7QUFDcEMsYUFBSyxLQUFLLEtBQUssS0FBSztBQUFBLE1BQ3RCO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFFQSxXQUFTLGdCQUFnQixPQUFPO0FBQzlCLFFBQUksTUFBTTtBQUFZLFlBQU0sV0FBVyxPQUFPLE1BQU07QUFDcEQsV0FBTztBQUFBLEVBQ1Q7QUFFQSxrQkFBZ0I7QUFFaEIsU0FBTyxhQUFhO0FBQUEsSUFDbEI7QUFBQSxJQUVBLFNBQVMsV0FBVztBQUNsQixhQUFPLFFBQVEsUUFBUSxJQUFJLEdBQUc7QUFBQSxJQUNoQztBQUFBLElBRUEsTUFBTSxXQUFXO0FBQ2YsYUFBTyxRQUFRLEtBQUssR0FBRztBQUFBLElBQ3pCO0FBQUEsSUFFQSxPQUFPLFNBQVMsR0FBRztBQUNqQixhQUFPLFVBQVUsVUFBVSxRQUFRLEdBQUcsZ0JBQWdCLEdBQUcsT0FBTyxRQUFRLGVBQWUsR0FBRyxjQUFjO0FBQUEsSUFDMUc7QUFBQSxJQUVBLE9BQU8sU0FBUyxHQUFHO0FBQ2pCLGFBQU8sVUFBVSxVQUFVLFFBQVEsQ0FBQyxHQUFHLGNBQWM7QUFBQSxJQUN2RDtBQUFBLElBRUEsVUFBVSxTQUFTLEdBQUc7QUFDcEIsYUFBTyxVQUFVLFVBQVUsV0FBVyxDQUFDLEdBQUcsY0FBYztBQUFBLElBQzFEO0FBQUEsSUFFQSxZQUFZLFNBQVMsR0FBRztBQUN0QixhQUFPLFVBQVUsVUFBVSxhQUFhLENBQUMsR0FBRyxjQUFjLENBQUM7QUFBQSxJQUM3RDtBQUFBLElBRUEsYUFBYSxTQUFTLEdBQUc7QUFDdkIsYUFBTyxVQUFVLFVBQVUsY0FBYyxDQUFDLEdBQUcsY0FBYztBQUFBLElBQzdEO0FBQUEsSUFFQSxlQUFlLFNBQVMsR0FBRztBQUN6QixhQUFPLFVBQVUsVUFBVSxnQkFBZ0IsSUFBSSxHQUFHLGNBQWMsSUFBSTtBQUFBLElBQ3RFO0FBQUEsSUFFQSxjQUFjLFNBQVMsR0FBRztBQUN4QixhQUFPLFVBQVUsVUFBVSxTQUFTLEdBQUcsT0FBTyxRQUFRLGVBQWUsR0FBRyxjQUFjO0FBQUEsSUFDeEY7QUFBQSxJQUVBLE9BQU8sU0FBUyxNQUFNLEdBQUc7QUFDdkIsYUFBTyxVQUFVLFNBQVMsS0FBTSxLQUFLLE9BQU8sT0FBTyxPQUFPLElBQUksSUFBSSxPQUFPLElBQUksTUFBTSxnQkFBZ0IsQ0FBQyxDQUFDLEdBQUksY0FBYyxPQUFPLElBQUksSUFBSTtBQUFBLElBQ3hJO0FBQUEsSUFFQSxNQUFNLFNBQVNELElBQUdDLElBQUcsUUFBUTtBQUMzQixVQUFJLElBQUksR0FDSixJQUFJLE1BQU0sUUFDVixJQUNBLElBQ0EsSUFDQSxNQUNBO0FBRUosVUFBSSxVQUFVO0FBQU0saUJBQVM7QUFBQTtBQUN4QixrQkFBVTtBQUVmLFdBQUssSUFBSSxHQUFHLElBQUksR0FBRyxFQUFFLEdBQUc7QUFDdEIsZUFBTyxNQUFNLENBQUM7QUFDZCxhQUFLRCxLQUFJLEtBQUs7QUFDZCxhQUFLQyxLQUFJLEtBQUs7QUFDZCxhQUFLLEtBQUssS0FBSyxLQUFLO0FBQ3BCLFlBQUksS0FBSztBQUFRLG9CQUFVLE1BQU0sU0FBUztBQUFBLE1BQzVDO0FBRUEsYUFBTztBQUFBLElBQ1Q7QUFBQSxJQUVBLElBQUksU0FBUyxNQUFNLEdBQUc7QUFDcEIsYUFBTyxVQUFVLFNBQVMsS0FBSyxNQUFNLEdBQUcsTUFBTSxDQUFDLEdBQUcsY0FBYyxNQUFNLEdBQUcsSUFBSTtBQUFBLElBQy9FO0FBQUEsRUFDRjtBQUNGOzs7QUN0SmUsU0FBUixtQkFBbUI7QUFDeEIsTUFBSSxPQUNBLE1BQ0EsUUFDQSxPQUNBLFdBQVdDLGtCQUFTLEdBQUcsR0FDdkIsV0FDQSxlQUFlLEdBQ2YsZUFBZSxVQUNmLFNBQVM7QUFFYixXQUFTLE1BQU0sR0FBRztBQUNoQixRQUFJLEdBQUcsSUFBSSxNQUFNLFFBQVEsT0FBTyxTQUFTLE9BQU9DLElBQUdDLEVBQUMsRUFBRSxXQUFXLFVBQVU7QUFDM0UsU0FBSyxRQUFRLEdBQUcsSUFBSSxHQUFHLElBQUksR0FBRyxFQUFFO0FBQUcsYUFBTyxNQUFNLENBQUMsR0FBRyxLQUFLLE1BQU0sS0FBSztBQUFBLEVBQ3RFO0FBRUEsV0FBUyxhQUFhO0FBQ3BCLFFBQUksQ0FBQztBQUFPO0FBQ1osUUFBSSxHQUFHLElBQUksTUFBTSxRQUFRQztBQUN6QixnQkFBWSxJQUFJLE1BQU0sQ0FBQztBQUN2QixTQUFLLElBQUksR0FBRyxJQUFJLEdBQUcsRUFBRTtBQUFHLE1BQUFBLFFBQU8sTUFBTSxDQUFDLEdBQUcsVUFBVUEsTUFBSyxLQUFLLElBQUksQ0FBQyxTQUFTQSxPQUFNLEdBQUcsS0FBSztBQUFBLEVBQzNGO0FBRUEsV0FBUyxXQUFXLE1BQU07QUFDeEIsUUFBSUMsWUFBVyxHQUFHLEdBQUdDLElBQUcsU0FBUyxHQUFHSixJQUFHQyxJQUFHO0FBRzFDLFFBQUksS0FBSyxRQUFRO0FBQ2YsV0FBS0QsS0FBSUMsS0FBSSxJQUFJLEdBQUcsSUFBSSxHQUFHLEVBQUUsR0FBRztBQUM5QixhQUFLLElBQUksS0FBSyxDQUFDLE9BQU9HLEtBQUksS0FBSyxJQUFJLEVBQUUsS0FBSyxJQUFJO0FBQzVDLFVBQUFELGFBQVksRUFBRSxPQUFPLFVBQVVDLElBQUdKLE1BQUtJLEtBQUksRUFBRSxHQUFHSCxNQUFLRyxLQUFJLEVBQUU7QUFBQSxRQUM3RDtBQUFBLE1BQ0Y7QUFDQSxXQUFLLElBQUlKLEtBQUk7QUFDYixXQUFLLElBQUlDLEtBQUk7QUFBQSxJQUNmLE9BR0s7QUFDSCxVQUFJO0FBQ0osUUFBRSxJQUFJLEVBQUUsS0FBSztBQUNiLFFBQUUsSUFBSSxFQUFFLEtBQUs7QUFDYjtBQUFHLFFBQUFFLGFBQVksVUFBVSxFQUFFLEtBQUssS0FBSztBQUFBLGFBQzlCLElBQUksRUFBRTtBQUFBLElBQ2Y7QUFFQSxTQUFLLFFBQVFBO0FBQUEsRUFDZjtBQUVBLFdBQVMsTUFBTSxNQUFNLElBQUksR0FBR0UsS0FBSTtBQUM5QixRQUFJLENBQUMsS0FBSztBQUFPLGFBQU87QUFFeEIsUUFBSUwsS0FBSSxLQUFLLElBQUksS0FBSyxHQUNsQkMsS0FBSSxLQUFLLElBQUksS0FBSyxHQUNsQixJQUFJSSxNQUFLLElBQ1QsSUFBSUwsS0FBSUEsS0FBSUMsS0FBSUE7QUFJcEIsUUFBSSxJQUFJLElBQUksU0FBUyxHQUFHO0FBQ3RCLFVBQUksSUFBSSxjQUFjO0FBQ3BCLFlBQUlELE9BQU07QUFBRyxVQUFBQSxLQUFJLGVBQU8sTUFBTSxHQUFHLEtBQUtBLEtBQUlBO0FBQzFDLFlBQUlDLE9BQU07QUFBRyxVQUFBQSxLQUFJLGVBQU8sTUFBTSxHQUFHLEtBQUtBLEtBQUlBO0FBQzFDLFlBQUksSUFBSTtBQUFjLGNBQUksS0FBSyxLQUFLLGVBQWUsQ0FBQztBQUNwRCxhQUFLLE1BQU1ELEtBQUksS0FBSyxRQUFRLFFBQVE7QUFDcEMsYUFBSyxNQUFNQyxLQUFJLEtBQUssUUFBUSxRQUFRO0FBQUEsTUFDdEM7QUFDQSxhQUFPO0FBQUEsSUFDVCxXQUdTLEtBQUssVUFBVSxLQUFLO0FBQWM7QUFHM0MsUUFBSSxLQUFLLFNBQVMsUUFBUSxLQUFLLE1BQU07QUFDbkMsVUFBSUQsT0FBTTtBQUFHLFFBQUFBLEtBQUksZUFBTyxNQUFNLEdBQUcsS0FBS0EsS0FBSUE7QUFDMUMsVUFBSUMsT0FBTTtBQUFHLFFBQUFBLEtBQUksZUFBTyxNQUFNLEdBQUcsS0FBS0EsS0FBSUE7QUFDMUMsVUFBSSxJQUFJO0FBQWMsWUFBSSxLQUFLLEtBQUssZUFBZSxDQUFDO0FBQUEsSUFDdEQ7QUFFQTtBQUFHLFVBQUksS0FBSyxTQUFTLE1BQU07QUFDekIsWUFBSSxVQUFVLEtBQUssS0FBSyxLQUFLLElBQUksUUFBUTtBQUN6QyxhQUFLLE1BQU1ELEtBQUk7QUFDZixhQUFLLE1BQU1DLEtBQUk7QUFBQSxNQUNqQjtBQUFBLFdBQVMsT0FBTyxLQUFLO0FBQUEsRUFDdkI7QUFFQSxRQUFNLGFBQWEsU0FBUyxRQUFRLFNBQVM7QUFDM0MsWUFBUTtBQUNSLGFBQVM7QUFDVCxlQUFXO0FBQUEsRUFDYjtBQUVBLFFBQU0sV0FBVyxTQUFTLEdBQUc7QUFDM0IsV0FBTyxVQUFVLFVBQVUsV0FBVyxPQUFPLE1BQU0sYUFBYSxJQUFJRixrQkFBUyxDQUFDLENBQUMsR0FBRyxXQUFXLEdBQUcsU0FBUztBQUFBLEVBQzNHO0FBRUEsUUFBTSxjQUFjLFNBQVMsR0FBRztBQUM5QixXQUFPLFVBQVUsVUFBVSxlQUFlLElBQUksR0FBRyxTQUFTLEtBQUssS0FBSyxZQUFZO0FBQUEsRUFDbEY7QUFFQSxRQUFNLGNBQWMsU0FBUyxHQUFHO0FBQzlCLFdBQU8sVUFBVSxVQUFVLGVBQWUsSUFBSSxHQUFHLFNBQVMsS0FBSyxLQUFLLFlBQVk7QUFBQSxFQUNsRjtBQUVBLFFBQU0sUUFBUSxTQUFTLEdBQUc7QUFDeEIsV0FBTyxVQUFVLFVBQVUsU0FBUyxJQUFJLEdBQUcsU0FBUyxLQUFLLEtBQUssTUFBTTtBQUFBLEVBQ3RFO0FBRUEsU0FBTztBQUNUOzs7QUNqSGUsU0FBUk8sV0FBaUJDLElBQUc7QUFDekIsTUFBSSxXQUFXQyxrQkFBUyxHQUFHLEdBQ3ZCLE9BQ0EsV0FDQTtBQUVKLE1BQUksT0FBT0QsT0FBTTtBQUFZLElBQUFBLEtBQUlDLGtCQUFTRCxNQUFLLE9BQU8sSUFBSSxDQUFDQSxFQUFDO0FBRTVELFdBQVMsTUFBTSxPQUFPO0FBQ3BCLGFBQVMsSUFBSSxHQUFHLElBQUksTUFBTSxRQUFRLE1BQU0sSUFBSSxHQUFHLEVBQUUsR0FBRztBQUNsRCxhQUFPLE1BQU0sQ0FBQyxHQUFHLEtBQUssT0FBTyxHQUFHLENBQUMsSUFBSSxLQUFLLEtBQUssVUFBVSxDQUFDLElBQUk7QUFBQSxJQUNoRTtBQUFBLEVBQ0Y7QUFFQSxXQUFTLGFBQWE7QUFDcEIsUUFBSSxDQUFDO0FBQU87QUFDWixRQUFJLEdBQUcsSUFBSSxNQUFNO0FBQ2pCLGdCQUFZLElBQUksTUFBTSxDQUFDO0FBQ3ZCLFNBQUssSUFBSSxNQUFNLENBQUM7QUFDaEIsU0FBSyxJQUFJLEdBQUcsSUFBSSxHQUFHLEVBQUUsR0FBRztBQUN0QixnQkFBVSxDQUFDLElBQUksTUFBTSxHQUFHLENBQUMsSUFBSSxDQUFDQSxHQUFFLE1BQU0sQ0FBQyxHQUFHLEdBQUcsS0FBSyxDQUFDLElBQUksSUFBSSxDQUFDLFNBQVMsTUFBTSxDQUFDLEdBQUcsR0FBRyxLQUFLO0FBQUEsSUFDekY7QUFBQSxFQUNGO0FBRUEsUUFBTSxhQUFhLFNBQVMsR0FBRztBQUM3QixZQUFRO0FBQ1IsZUFBVztBQUFBLEVBQ2I7QUFFQSxRQUFNLFdBQVcsU0FBUyxHQUFHO0FBQzNCLFdBQU8sVUFBVSxVQUFVLFdBQVcsT0FBTyxNQUFNLGFBQWEsSUFBSUMsa0JBQVMsQ0FBQyxDQUFDLEdBQUcsV0FBVyxHQUFHLFNBQVM7QUFBQSxFQUMzRztBQUVBLFFBQU0sSUFBSSxTQUFTLEdBQUc7QUFDcEIsV0FBTyxVQUFVLFVBQVVELEtBQUksT0FBTyxNQUFNLGFBQWEsSUFBSUMsa0JBQVMsQ0FBQyxDQUFDLEdBQUcsV0FBVyxHQUFHLFNBQVNEO0FBQUEsRUFDcEc7QUFFQSxTQUFPO0FBQ1Q7OztBQ3RDZSxTQUFSRSxXQUFpQkMsSUFBRztBQUN6QixNQUFJLFdBQVdDLGtCQUFTLEdBQUcsR0FDdkIsT0FDQSxXQUNBO0FBRUosTUFBSSxPQUFPRCxPQUFNO0FBQVksSUFBQUEsS0FBSUMsa0JBQVNELE1BQUssT0FBTyxJQUFJLENBQUNBLEVBQUM7QUFFNUQsV0FBUyxNQUFNLE9BQU87QUFDcEIsYUFBUyxJQUFJLEdBQUcsSUFBSSxNQUFNLFFBQVEsTUFBTSxJQUFJLEdBQUcsRUFBRSxHQUFHO0FBQ2xELGFBQU8sTUFBTSxDQUFDLEdBQUcsS0FBSyxPQUFPLEdBQUcsQ0FBQyxJQUFJLEtBQUssS0FBSyxVQUFVLENBQUMsSUFBSTtBQUFBLElBQ2hFO0FBQUEsRUFDRjtBQUVBLFdBQVMsYUFBYTtBQUNwQixRQUFJLENBQUM7QUFBTztBQUNaLFFBQUksR0FBRyxJQUFJLE1BQU07QUFDakIsZ0JBQVksSUFBSSxNQUFNLENBQUM7QUFDdkIsU0FBSyxJQUFJLE1BQU0sQ0FBQztBQUNoQixTQUFLLElBQUksR0FBRyxJQUFJLEdBQUcsRUFBRSxHQUFHO0FBQ3RCLGdCQUFVLENBQUMsSUFBSSxNQUFNLEdBQUcsQ0FBQyxJQUFJLENBQUNBLEdBQUUsTUFBTSxDQUFDLEdBQUcsR0FBRyxLQUFLLENBQUMsSUFBSSxJQUFJLENBQUMsU0FBUyxNQUFNLENBQUMsR0FBRyxHQUFHLEtBQUs7QUFBQSxJQUN6RjtBQUFBLEVBQ0Y7QUFFQSxRQUFNLGFBQWEsU0FBUyxHQUFHO0FBQzdCLFlBQVE7QUFDUixlQUFXO0FBQUEsRUFDYjtBQUVBLFFBQU0sV0FBVyxTQUFTLEdBQUc7QUFDM0IsV0FBTyxVQUFVLFVBQVUsV0FBVyxPQUFPLE1BQU0sYUFBYSxJQUFJQyxrQkFBUyxDQUFDLENBQUMsR0FBRyxXQUFXLEdBQUcsU0FBUztBQUFBLEVBQzNHO0FBRUEsUUFBTSxJQUFJLFNBQVMsR0FBRztBQUNwQixXQUFPLFVBQVUsVUFBVUQsS0FBSSxPQUFPLE1BQU0sYUFBYSxJQUFJQyxrQkFBUyxDQUFDLENBQUMsR0FBRyxXQUFXLEdBQUcsU0FBU0Q7QUFBQSxFQUNwRztBQUVBLFNBQU87QUFDVDs7O0FDeENBLElBQU9FLG9CQUFRLENBQUFDLE9BQUssTUFBTUE7OztBQ0FYLFNBQVIsVUFBMkJDLE9BQU07QUFBQSxFQUN0QztBQUFBLEVBQ0E7QUFBQSxFQUNBLFdBQUFDO0FBQUEsRUFDQSxVQUFBQztBQUNGLEdBQUc7QUFDRCxTQUFPLGlCQUFpQixNQUFNO0FBQUEsSUFDNUIsTUFBTSxFQUFDLE9BQU9GLE9BQU0sWUFBWSxNQUFNLGNBQWMsS0FBSTtBQUFBLElBQ3hELGFBQWEsRUFBQyxPQUFPLGFBQWEsWUFBWSxNQUFNLGNBQWMsS0FBSTtBQUFBLElBQ3RFLFFBQVEsRUFBQyxPQUFPLFFBQVEsWUFBWSxNQUFNLGNBQWMsS0FBSTtBQUFBLElBQzVELFdBQVcsRUFBQyxPQUFPQyxZQUFXLFlBQVksTUFBTSxjQUFjLEtBQUk7QUFBQSxJQUNsRSxHQUFHLEVBQUMsT0FBT0MsVUFBUTtBQUFBLEVBQ3JCLENBQUM7QUFDSDs7O0FDYk8sU0FBUyxVQUFVLEdBQUdDLElBQUdDLElBQUc7QUFDakMsT0FBSyxJQUFJO0FBQ1QsT0FBSyxJQUFJRDtBQUNULE9BQUssSUFBSUM7QUFDWDtBQUVBLFVBQVUsWUFBWTtBQUFBLEVBQ3BCLGFBQWE7QUFBQSxFQUNiLE9BQU8sU0FBUyxHQUFHO0FBQ2pCLFdBQU8sTUFBTSxJQUFJLE9BQU8sSUFBSSxVQUFVLEtBQUssSUFBSSxHQUFHLEtBQUssR0FBRyxLQUFLLENBQUM7QUFBQSxFQUNsRTtBQUFBLEVBQ0EsV0FBVyxTQUFTRCxJQUFHQyxJQUFHO0FBQ3hCLFdBQU9ELE9BQU0sSUFBSUMsT0FBTSxJQUFJLE9BQU8sSUFBSSxVQUFVLEtBQUssR0FBRyxLQUFLLElBQUksS0FBSyxJQUFJRCxJQUFHLEtBQUssSUFBSSxLQUFLLElBQUlDLEVBQUM7QUFBQSxFQUNsRztBQUFBLEVBQ0EsT0FBTyxTQUFTLE9BQU87QUFDckIsV0FBTyxDQUFDLE1BQU0sQ0FBQyxJQUFJLEtBQUssSUFBSSxLQUFLLEdBQUcsTUFBTSxDQUFDLElBQUksS0FBSyxJQUFJLEtBQUssQ0FBQztBQUFBLEVBQ2hFO0FBQUEsRUFDQSxRQUFRLFNBQVNELElBQUc7QUFDbEIsV0FBT0EsS0FBSSxLQUFLLElBQUksS0FBSztBQUFBLEVBQzNCO0FBQUEsRUFDQSxRQUFRLFNBQVNDLElBQUc7QUFDbEIsV0FBT0EsS0FBSSxLQUFLLElBQUksS0FBSztBQUFBLEVBQzNCO0FBQUEsRUFDQSxRQUFRLFNBQVMsVUFBVTtBQUN6QixXQUFPLEVBQUUsU0FBUyxDQUFDLElBQUksS0FBSyxLQUFLLEtBQUssSUFBSSxTQUFTLENBQUMsSUFBSSxLQUFLLEtBQUssS0FBSyxDQUFDO0FBQUEsRUFDMUU7QUFBQSxFQUNBLFNBQVMsU0FBU0QsSUFBRztBQUNuQixZQUFRQSxLQUFJLEtBQUssS0FBSyxLQUFLO0FBQUEsRUFDN0I7QUFBQSxFQUNBLFNBQVMsU0FBU0MsSUFBRztBQUNuQixZQUFRQSxLQUFJLEtBQUssS0FBSyxLQUFLO0FBQUEsRUFDN0I7QUFBQSxFQUNBLFVBQVUsU0FBU0QsSUFBRztBQUNwQixXQUFPQSxHQUFFLEtBQUssRUFBRSxPQUFPQSxHQUFFLE1BQU0sRUFBRSxJQUFJLEtBQUssU0FBUyxJQUFJLEVBQUUsSUFBSUEsR0FBRSxRQUFRQSxFQUFDLENBQUM7QUFBQSxFQUMzRTtBQUFBLEVBQ0EsVUFBVSxTQUFTQyxJQUFHO0FBQ3BCLFdBQU9BLEdBQUUsS0FBSyxFQUFFLE9BQU9BLEdBQUUsTUFBTSxFQUFFLElBQUksS0FBSyxTQUFTLElBQUksRUFBRSxJQUFJQSxHQUFFLFFBQVFBLEVBQUMsQ0FBQztBQUFBLEVBQzNFO0FBQUEsRUFDQSxVQUFVLFdBQVc7QUFDbkIsV0FBTyxlQUFlLEtBQUssSUFBSSxNQUFNLEtBQUssSUFBSSxhQUFhLEtBQUssSUFBSTtBQUFBLEVBQ3RFO0FBQ0Y7QUFFTyxJQUFJQyxZQUFXLElBQUksVUFBVSxHQUFHLEdBQUcsQ0FBQztBQUUzQyxVQUFVLFlBQVksVUFBVTtBQUVqQixTQUFSLFVBQTJCLE1BQU07QUFDdEMsU0FBTyxDQUFDLEtBQUs7QUFBUSxRQUFJLEVBQUUsT0FBTyxLQUFLO0FBQWEsYUFBT0E7QUFDM0QsU0FBTyxLQUFLO0FBQ2Q7OztBQ2xETyxTQUFTQyxlQUFjLE9BQU87QUFDbkMsUUFBTSx5QkFBeUI7QUFDakM7QUFFZSxTQUFSQyxpQkFBaUIsT0FBTztBQUM3QixRQUFNLGVBQWU7QUFDckIsUUFBTSx5QkFBeUI7QUFDakM7OztBQ0tBLFNBQVMsY0FBYyxPQUFPO0FBQzVCLFVBQVEsQ0FBQyxNQUFNLFdBQVcsTUFBTSxTQUFTLFlBQVksQ0FBQyxNQUFNO0FBQzlEO0FBRUEsU0FBUyxnQkFBZ0I7QUFDdkIsTUFBSSxJQUFJO0FBQ1IsTUFBSSxhQUFhLFlBQVk7QUFDM0IsUUFBSSxFQUFFLG1CQUFtQjtBQUN6QixRQUFJLEVBQUUsYUFBYSxTQUFTLEdBQUc7QUFDN0IsVUFBSSxFQUFFLFFBQVE7QUFDZCxhQUFPLENBQUMsQ0FBQyxFQUFFLEdBQUcsRUFBRSxDQUFDLEdBQUcsQ0FBQyxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLE1BQU0sQ0FBQztBQUFBLElBQ3JEO0FBQ0EsV0FBTyxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxFQUFFLE1BQU0sUUFBUSxPQUFPLEVBQUUsT0FBTyxRQUFRLEtBQUssQ0FBQztBQUFBLEVBQ2pFO0FBQ0EsU0FBTyxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxFQUFFLGFBQWEsRUFBRSxZQUFZLENBQUM7QUFDakQ7QUFFQSxTQUFTLG1CQUFtQjtBQUMxQixTQUFPLEtBQUssVUFBVUM7QUFDeEI7QUFFQSxTQUFTLGtCQUFrQixPQUFPO0FBQ2hDLFNBQU8sQ0FBQyxNQUFNLFVBQVUsTUFBTSxjQUFjLElBQUksT0FBTyxNQUFNLFlBQVksSUFBSSxTQUFVLE1BQU0sVUFBVSxLQUFLO0FBQzlHO0FBRUEsU0FBUyxtQkFBbUI7QUFDMUIsU0FBTyxVQUFVLGtCQUFtQixrQkFBa0I7QUFDeEQ7QUFFQSxTQUFTLGlCQUFpQkMsWUFBVyxRQUFRLGlCQUFpQjtBQUM1RCxNQUFJLE1BQU1BLFdBQVUsUUFBUSxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSSxnQkFBZ0IsQ0FBQyxFQUFFLENBQUMsR0FDNUQsTUFBTUEsV0FBVSxRQUFRLE9BQU8sQ0FBQyxFQUFFLENBQUMsQ0FBQyxJQUFJLGdCQUFnQixDQUFDLEVBQUUsQ0FBQyxHQUM1RCxNQUFNQSxXQUFVLFFBQVEsT0FBTyxDQUFDLEVBQUUsQ0FBQyxDQUFDLElBQUksZ0JBQWdCLENBQUMsRUFBRSxDQUFDLEdBQzVELE1BQU1BLFdBQVUsUUFBUSxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSSxnQkFBZ0IsQ0FBQyxFQUFFLENBQUM7QUFDaEUsU0FBT0EsV0FBVTtBQUFBLElBQ2YsTUFBTSxPQUFPLE1BQU0sT0FBTyxJQUFJLEtBQUssSUFBSSxHQUFHLEdBQUcsS0FBSyxLQUFLLElBQUksR0FBRyxHQUFHO0FBQUEsSUFDakUsTUFBTSxPQUFPLE1BQU0sT0FBTyxJQUFJLEtBQUssSUFBSSxHQUFHLEdBQUcsS0FBSyxLQUFLLElBQUksR0FBRyxHQUFHO0FBQUEsRUFDbkU7QUFDRjtBQUVlLFNBQVJDLGdCQUFtQjtBQUN4QixNQUFJQyxVQUFTLGVBQ1QsU0FBUyxlQUNULFlBQVksa0JBQ1osYUFBYSxtQkFDYixZQUFZLGtCQUNaLGNBQWMsQ0FBQyxHQUFHLFFBQVEsR0FDMUIsa0JBQWtCLENBQUMsQ0FBQyxXQUFXLFNBQVMsR0FBRyxDQUFDLFVBQVUsUUFBUSxDQUFDLEdBQy9ELFdBQVcsS0FDWCxjQUFjLGNBQ2QsWUFBWSxpQkFBUyxTQUFTLFFBQVEsS0FBSyxHQUMzQyxlQUNBLFlBQ0EsYUFDQSxhQUFhLEtBQ2IsYUFBYSxLQUNiLGlCQUFpQixHQUNqQixjQUFjO0FBRWxCLFdBQVMsS0FBS0MsWUFBVztBQUN2QixJQUFBQSxXQUNLLFNBQVMsVUFBVSxnQkFBZ0IsRUFDbkMsR0FBRyxjQUFjLFNBQVMsRUFBQyxTQUFTLE1BQUssQ0FBQyxFQUMxQyxHQUFHLGtCQUFrQixXQUFXLEVBQ2hDLEdBQUcsaUJBQWlCLFVBQVUsRUFDaEMsT0FBTyxTQUFTLEVBQ2QsR0FBRyxtQkFBbUIsWUFBWSxFQUNsQyxHQUFHLGtCQUFrQixVQUFVLEVBQy9CLEdBQUcsa0NBQWtDLFVBQVUsRUFDL0MsTUFBTSwrQkFBK0IsZUFBZTtBQUFBLEVBQzNEO0FBRUEsT0FBSyxZQUFZLFNBQVMsWUFBWUgsWUFBVyxPQUFPLE9BQU87QUFDN0QsUUFBSUcsYUFBWSxXQUFXLFlBQVksV0FBVyxVQUFVLElBQUk7QUFDaEUsSUFBQUEsV0FBVSxTQUFTLFVBQVUsZ0JBQWdCO0FBQzdDLFFBQUksZUFBZUEsWUFBVztBQUM1QixlQUFTLFlBQVlILFlBQVcsT0FBTyxLQUFLO0FBQUEsSUFDOUMsT0FBTztBQUNMLE1BQUFHLFdBQVUsVUFBVSxFQUFFLEtBQUssV0FBVztBQUNwQyxnQkFBUSxNQUFNLFNBQVMsRUFDcEIsTUFBTSxLQUFLLEVBQ1gsTUFBTSxFQUNOLEtBQUssTUFBTSxPQUFPSCxlQUFjLGFBQWFBLFdBQVUsTUFBTSxNQUFNLFNBQVMsSUFBSUEsVUFBUyxFQUN6RixJQUFJO0FBQUEsTUFDVCxDQUFDO0FBQUEsSUFDSDtBQUFBLEVBQ0Y7QUFFQSxPQUFLLFVBQVUsU0FBU0csWUFBVyxHQUFHLEdBQUcsT0FBTztBQUM5QyxTQUFLLFFBQVFBLFlBQVcsV0FBVztBQUNqQyxVQUFJLEtBQUssS0FBSyxPQUFPLEdBQ2pCLEtBQUssT0FBTyxNQUFNLGFBQWEsRUFBRSxNQUFNLE1BQU0sU0FBUyxJQUFJO0FBQzlELGFBQU8sS0FBSztBQUFBLElBQ2QsR0FBRyxHQUFHLEtBQUs7QUFBQSxFQUNiO0FBRUEsT0FBSyxVQUFVLFNBQVNBLFlBQVcsR0FBRyxHQUFHLE9BQU87QUFDOUMsU0FBSyxVQUFVQSxZQUFXLFdBQVc7QUFDbkMsVUFBSSxJQUFJLE9BQU8sTUFBTSxNQUFNLFNBQVMsR0FDaEMsS0FBSyxLQUFLLFFBQ1YsS0FBSyxLQUFLLE9BQU8sU0FBUyxDQUFDLElBQUksT0FBTyxNQUFNLGFBQWEsRUFBRSxNQUFNLE1BQU0sU0FBUyxJQUFJLEdBQ3BGLEtBQUssR0FBRyxPQUFPLEVBQUUsR0FDakIsS0FBSyxPQUFPLE1BQU0sYUFBYSxFQUFFLE1BQU0sTUFBTSxTQUFTLElBQUk7QUFDOUQsYUFBTyxVQUFVLFVBQVUsTUFBTSxJQUFJLEVBQUUsR0FBRyxJQUFJLEVBQUUsR0FBRyxHQUFHLGVBQWU7QUFBQSxJQUN2RSxHQUFHLEdBQUcsS0FBSztBQUFBLEVBQ2I7QUFFQSxPQUFLLGNBQWMsU0FBU0EsWUFBV0MsSUFBR0MsSUFBRyxPQUFPO0FBQ2xELFNBQUssVUFBVUYsWUFBVyxXQUFXO0FBQ25DLGFBQU8sVUFBVSxLQUFLLE9BQU87QUFBQSxRQUMzQixPQUFPQyxPQUFNLGFBQWFBLEdBQUUsTUFBTSxNQUFNLFNBQVMsSUFBSUE7QUFBQSxRQUNyRCxPQUFPQyxPQUFNLGFBQWFBLEdBQUUsTUFBTSxNQUFNLFNBQVMsSUFBSUE7QUFBQSxNQUN2RCxHQUFHLE9BQU8sTUFBTSxNQUFNLFNBQVMsR0FBRyxlQUFlO0FBQUEsSUFDbkQsR0FBRyxNQUFNLEtBQUs7QUFBQSxFQUNoQjtBQUVBLE9BQUssY0FBYyxTQUFTRixZQUFXQyxJQUFHQyxJQUFHLEdBQUcsT0FBTztBQUNyRCxTQUFLLFVBQVVGLFlBQVcsV0FBVztBQUNuQyxVQUFJLElBQUksT0FBTyxNQUFNLE1BQU0sU0FBUyxHQUNoQyxJQUFJLEtBQUssUUFDVCxLQUFLLEtBQUssT0FBTyxTQUFTLENBQUMsSUFBSSxPQUFPLE1BQU0sYUFBYSxFQUFFLE1BQU0sTUFBTSxTQUFTLElBQUk7QUFDeEYsYUFBTyxVQUFVSixVQUFTLFVBQVUsR0FBRyxDQUFDLEdBQUcsR0FBRyxDQUFDLENBQUMsRUFBRSxNQUFNLEVBQUUsQ0FBQyxFQUFFO0FBQUEsUUFDM0QsT0FBT0ssT0FBTSxhQUFhLENBQUNBLEdBQUUsTUFBTSxNQUFNLFNBQVMsSUFBSSxDQUFDQTtBQUFBLFFBQ3ZELE9BQU9DLE9BQU0sYUFBYSxDQUFDQSxHQUFFLE1BQU0sTUFBTSxTQUFTLElBQUksQ0FBQ0E7QUFBQSxNQUN6RCxHQUFHLEdBQUcsZUFBZTtBQUFBLElBQ3ZCLEdBQUcsR0FBRyxLQUFLO0FBQUEsRUFDYjtBQUVBLFdBQVMsTUFBTUwsWUFBVyxHQUFHO0FBQzNCLFFBQUksS0FBSyxJQUFJLFlBQVksQ0FBQyxHQUFHLEtBQUssSUFBSSxZQUFZLENBQUMsR0FBRyxDQUFDLENBQUM7QUFDeEQsV0FBTyxNQUFNQSxXQUFVLElBQUlBLGFBQVksSUFBSSxVQUFVLEdBQUdBLFdBQVUsR0FBR0EsV0FBVSxDQUFDO0FBQUEsRUFDbEY7QUFFQSxXQUFTLFVBQVVBLFlBQVcsSUFBSSxJQUFJO0FBQ3BDLFFBQUlJLEtBQUksR0FBRyxDQUFDLElBQUksR0FBRyxDQUFDLElBQUlKLFdBQVUsR0FBR0ssS0FBSSxHQUFHLENBQUMsSUFBSSxHQUFHLENBQUMsSUFBSUwsV0FBVTtBQUNuRSxXQUFPSSxPQUFNSixXQUFVLEtBQUtLLE9BQU1MLFdBQVUsSUFBSUEsYUFBWSxJQUFJLFVBQVVBLFdBQVUsR0FBR0ksSUFBR0MsRUFBQztBQUFBLEVBQzdGO0FBRUEsV0FBUyxTQUFTQyxTQUFRO0FBQ3hCLFdBQU8sRUFBRSxDQUFDQSxRQUFPLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQ0EsUUFBTyxDQUFDLEVBQUUsQ0FBQyxLQUFLLElBQUksQ0FBQ0EsUUFBTyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUNBLFFBQU8sQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDO0FBQUEsRUFDbEY7QUFFQSxXQUFTLFNBQVNDLGFBQVlQLFlBQVcsT0FBTyxPQUFPO0FBQ3JELElBQUFPLFlBQ0ssR0FBRyxjQUFjLFdBQVc7QUFBRSxjQUFRLE1BQU0sU0FBUyxFQUFFLE1BQU0sS0FBSyxFQUFFLE1BQU07QUFBQSxJQUFHLENBQUMsRUFDOUUsR0FBRywyQkFBMkIsV0FBVztBQUFFLGNBQVEsTUFBTSxTQUFTLEVBQUUsTUFBTSxLQUFLLEVBQUUsSUFBSTtBQUFBLElBQUcsQ0FBQyxFQUN6RixNQUFNLFFBQVEsV0FBVztBQUN4QixVQUFJLE9BQU8sTUFDUCxPQUFPLFdBQ1AsSUFBSSxRQUFRLE1BQU0sSUFBSSxFQUFFLE1BQU0sS0FBSyxHQUNuQyxJQUFJLE9BQU8sTUFBTSxNQUFNLElBQUksR0FDM0IsSUFBSSxTQUFTLE9BQU8sU0FBUyxDQUFDLElBQUksT0FBTyxVQUFVLGFBQWEsTUFBTSxNQUFNLE1BQU0sSUFBSSxJQUFJLE9BQzFGLElBQUksS0FBSyxJQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUMsSUFBSSxFQUFFLENBQUMsRUFBRSxDQUFDLEdBQUcsRUFBRSxDQUFDLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUMsQ0FBQyxHQUNqREMsS0FBSSxLQUFLLFFBQ1QsSUFBSSxPQUFPUixlQUFjLGFBQWFBLFdBQVUsTUFBTSxNQUFNLElBQUksSUFBSUEsWUFDcEUsSUFBSSxZQUFZUSxHQUFFLE9BQU8sQ0FBQyxFQUFFLE9BQU8sSUFBSUEsR0FBRSxDQUFDLEdBQUcsRUFBRSxPQUFPLENBQUMsRUFBRSxPQUFPLElBQUksRUFBRSxDQUFDLENBQUM7QUFDNUUsYUFBTyxTQUFTLEdBQUc7QUFDakIsWUFBSSxNQUFNO0FBQUcsY0FBSTtBQUFBLGFBQ1o7QUFBRSxjQUFJLElBQUksRUFBRSxDQUFDLEdBQUcsSUFBSSxJQUFJLEVBQUUsQ0FBQztBQUFHLGNBQUksSUFBSSxVQUFVLEdBQUcsRUFBRSxDQUFDLElBQUksRUFBRSxDQUFDLElBQUksR0FBRyxFQUFFLENBQUMsSUFBSSxFQUFFLENBQUMsSUFBSSxDQUFDO0FBQUEsUUFBRztBQUMzRixVQUFFLEtBQUssTUFBTSxDQUFDO0FBQUEsTUFDaEI7QUFBQSxJQUNGLENBQUM7QUFBQSxFQUNQO0FBRUEsV0FBUyxRQUFRLE1BQU0sTUFBTSxPQUFPO0FBQ2xDLFdBQVEsQ0FBQyxTQUFTLEtBQUssYUFBYyxJQUFJLFFBQVEsTUFBTSxJQUFJO0FBQUEsRUFDN0Q7QUFFQSxXQUFTLFFBQVEsTUFBTSxNQUFNO0FBQzNCLFNBQUssT0FBTztBQUNaLFNBQUssT0FBTztBQUNaLFNBQUssU0FBUztBQUNkLFNBQUssY0FBYztBQUNuQixTQUFLLFNBQVMsT0FBTyxNQUFNLE1BQU0sSUFBSTtBQUNyQyxTQUFLLE9BQU87QUFBQSxFQUNkO0FBRUEsVUFBUSxZQUFZO0FBQUEsSUFDbEIsT0FBTyxTQUFTLE9BQU87QUFDckIsVUFBSTtBQUFPLGFBQUssY0FBYztBQUM5QixhQUFPO0FBQUEsSUFDVDtBQUFBLElBQ0EsT0FBTyxXQUFXO0FBQ2hCLFVBQUksRUFBRSxLQUFLLFdBQVcsR0FBRztBQUN2QixhQUFLLEtBQUssWUFBWTtBQUN0QixhQUFLLEtBQUssT0FBTztBQUFBLE1BQ25CO0FBQ0EsYUFBTztBQUFBLElBQ1Q7QUFBQSxJQUNBLE1BQU0sU0FBUyxLQUFLUixZQUFXO0FBQzdCLFVBQUksS0FBSyxTQUFTLFFBQVE7QUFBUyxhQUFLLE1BQU0sQ0FBQyxJQUFJQSxXQUFVLE9BQU8sS0FBSyxNQUFNLENBQUMsQ0FBQztBQUNqRixVQUFJLEtBQUssVUFBVSxRQUFRO0FBQVMsYUFBSyxPQUFPLENBQUMsSUFBSUEsV0FBVSxPQUFPLEtBQUssT0FBTyxDQUFDLENBQUM7QUFDcEYsVUFBSSxLQUFLLFVBQVUsUUFBUTtBQUFTLGFBQUssT0FBTyxDQUFDLElBQUlBLFdBQVUsT0FBTyxLQUFLLE9BQU8sQ0FBQyxDQUFDO0FBQ3BGLFdBQUssS0FBSyxTQUFTQTtBQUNuQixXQUFLLEtBQUssTUFBTTtBQUNoQixhQUFPO0FBQUEsSUFDVDtBQUFBLElBQ0EsS0FBSyxXQUFXO0FBQ2QsVUFBSSxFQUFFLEtBQUssV0FBVyxHQUFHO0FBQ3ZCLGVBQU8sS0FBSyxLQUFLO0FBQ2pCLGFBQUssS0FBSyxLQUFLO0FBQUEsTUFDakI7QUFDQSxhQUFPO0FBQUEsSUFDVDtBQUFBLElBQ0EsTUFBTSxTQUFTUyxPQUFNO0FBQ25CLFVBQUksSUFBSUMsZ0JBQU8sS0FBSyxJQUFJLEVBQUUsTUFBTTtBQUNoQyxnQkFBVTtBQUFBLFFBQ1JEO0FBQUEsUUFDQSxLQUFLO0FBQUEsUUFDTCxJQUFJLFVBQVVBLE9BQU07QUFBQSxVQUNsQixhQUFhLEtBQUs7QUFBQSxVQUNsQixRQUFRO0FBQUEsVUFDUixNQUFBQTtBQUFBLFVBQ0EsV0FBVyxLQUFLLEtBQUs7QUFBQSxVQUNyQixVQUFVO0FBQUEsUUFDWixDQUFDO0FBQUEsUUFDRDtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUVBLFdBQVMsUUFBUSxVQUFVLE1BQU07QUFDL0IsUUFBSSxDQUFDUCxRQUFPLE1BQU0sTUFBTSxTQUFTO0FBQUc7QUFDcEMsUUFBSSxJQUFJLFFBQVEsTUFBTSxJQUFJLEVBQUUsTUFBTSxLQUFLLEdBQ25DLElBQUksS0FBSyxRQUNULElBQUksS0FBSyxJQUFJLFlBQVksQ0FBQyxHQUFHLEtBQUssSUFBSSxZQUFZLENBQUMsR0FBRyxFQUFFLElBQUksS0FBSyxJQUFJLEdBQUcsV0FBVyxNQUFNLE1BQU0sU0FBUyxDQUFDLENBQUMsQ0FBQyxHQUMzRyxJQUFJLGdCQUFRLEtBQUs7QUFJckIsUUFBSSxFQUFFLE9BQU87QUFDWCxVQUFJLEVBQUUsTUFBTSxDQUFDLEVBQUUsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxLQUFLLEVBQUUsTUFBTSxDQUFDLEVBQUUsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxHQUFHO0FBQ3BELFVBQUUsTUFBTSxDQUFDLElBQUksRUFBRSxPQUFPLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQztBQUFBLE1BQ3RDO0FBQ0EsbUJBQWEsRUFBRSxLQUFLO0FBQUEsSUFDdEIsV0FHUyxFQUFFLE1BQU07QUFBRztBQUFBLFNBR2Y7QUFDSCxRQUFFLFFBQVEsQ0FBQyxHQUFHLEVBQUUsT0FBTyxDQUFDLENBQUM7QUFDekIsd0JBQVUsSUFBSTtBQUNkLFFBQUUsTUFBTTtBQUFBLElBQ1Y7QUFFQSxJQUFBUyxpQkFBUSxLQUFLO0FBQ2IsTUFBRSxRQUFRLFdBQVcsWUFBWSxVQUFVO0FBQzNDLE1BQUUsS0FBSyxTQUFTLFVBQVUsVUFBVSxNQUFNLEdBQUcsQ0FBQyxHQUFHLEVBQUUsTUFBTSxDQUFDLEdBQUcsRUFBRSxNQUFNLENBQUMsQ0FBQyxHQUFHLEVBQUUsUUFBUSxlQUFlLENBQUM7QUFFcEcsYUFBUyxhQUFhO0FBQ3BCLFFBQUUsUUFBUTtBQUNWLFFBQUUsSUFBSTtBQUFBLElBQ1I7QUFBQSxFQUNGO0FBRUEsV0FBUyxZQUFZLFVBQVUsTUFBTTtBQUNuQyxRQUFJLGVBQWUsQ0FBQ1QsUUFBTyxNQUFNLE1BQU0sU0FBUztBQUFHO0FBQ25ELFFBQUksZ0JBQWdCLE1BQU0sZUFDdEIsSUFBSSxRQUFRLE1BQU0sTUFBTSxJQUFJLEVBQUUsTUFBTSxLQUFLLEdBQ3pDLElBQUlRLGdCQUFPLE1BQU0sSUFBSSxFQUFFLEdBQUcsa0JBQWtCLFlBQVksSUFBSSxFQUFFLEdBQUcsZ0JBQWdCLFlBQVksSUFBSSxHQUNqRyxJQUFJLGdCQUFRLE9BQU8sYUFBYSxHQUNoQyxLQUFLLE1BQU0sU0FDWCxLQUFLLE1BQU07QUFFZixtQkFBWSxNQUFNLElBQUk7QUFDdEIsSUFBQUUsZUFBYyxLQUFLO0FBQ25CLE1BQUUsUUFBUSxDQUFDLEdBQUcsS0FBSyxPQUFPLE9BQU8sQ0FBQyxDQUFDO0FBQ25DLHNCQUFVLElBQUk7QUFDZCxNQUFFLE1BQU07QUFFUixhQUFTLFdBQVdDLFFBQU87QUFDekIsTUFBQUYsaUJBQVFFLE1BQUs7QUFDYixVQUFJLENBQUMsRUFBRSxPQUFPO0FBQ1osWUFBSSxLQUFLQSxPQUFNLFVBQVUsSUFBSSxLQUFLQSxPQUFNLFVBQVU7QUFDbEQsVUFBRSxRQUFRLEtBQUssS0FBSyxLQUFLLEtBQUs7QUFBQSxNQUNoQztBQUNBLFFBQUUsTUFBTUEsTUFBSyxFQUNYLEtBQUssU0FBUyxVQUFVLFVBQVUsRUFBRSxLQUFLLFFBQVEsRUFBRSxNQUFNLENBQUMsSUFBSSxnQkFBUUEsUUFBTyxhQUFhLEdBQUcsRUFBRSxNQUFNLENBQUMsQ0FBQyxHQUFHLEVBQUUsUUFBUSxlQUFlLENBQUM7QUFBQSxJQUN4STtBQUVBLGFBQVMsV0FBV0EsUUFBTztBQUN6QixRQUFFLEdBQUcsK0JBQStCLElBQUk7QUFDeEMsY0FBV0EsT0FBTSxNQUFNLEVBQUUsS0FBSztBQUM5QixNQUFBRixpQkFBUUUsTUFBSztBQUNiLFFBQUUsTUFBTUEsTUFBSyxFQUFFLElBQUk7QUFBQSxJQUNyQjtBQUFBLEVBQ0Y7QUFFQSxXQUFTLFdBQVcsVUFBVSxNQUFNO0FBQ2xDLFFBQUksQ0FBQ1gsUUFBTyxNQUFNLE1BQU0sU0FBUztBQUFHO0FBQ3BDLFFBQUksS0FBSyxLQUFLLFFBQ1YsS0FBSyxnQkFBUSxNQUFNLGlCQUFpQixNQUFNLGVBQWUsQ0FBQyxJQUFJLE9BQU8sSUFBSSxHQUN6RSxLQUFLLEdBQUcsT0FBTyxFQUFFLEdBQ2pCLEtBQUssR0FBRyxLQUFLLE1BQU0sV0FBVyxNQUFNLElBQ3BDLEtBQUssVUFBVSxVQUFVLE1BQU0sSUFBSSxFQUFFLEdBQUcsSUFBSSxFQUFFLEdBQUcsT0FBTyxNQUFNLE1BQU0sSUFBSSxHQUFHLGVBQWU7QUFFOUYsSUFBQVMsaUJBQVEsS0FBSztBQUNiLFFBQUksV0FBVztBQUFHLE1BQUFELGdCQUFPLElBQUksRUFBRSxXQUFXLEVBQUUsU0FBUyxRQUFRLEVBQUUsS0FBSyxVQUFVLElBQUksSUFBSSxLQUFLO0FBQUE7QUFDdEYsTUFBQUEsZ0JBQU8sSUFBSSxFQUFFLEtBQUssS0FBSyxXQUFXLElBQUksSUFBSSxLQUFLO0FBQUEsRUFDdEQ7QUFFQSxXQUFTLGFBQWEsVUFBVSxNQUFNO0FBQ3BDLFFBQUksQ0FBQ1IsUUFBTyxNQUFNLE1BQU0sU0FBUztBQUFHO0FBQ3BDLFFBQUksVUFBVSxNQUFNLFNBQ2hCLElBQUksUUFBUSxRQUNaLElBQUksUUFBUSxNQUFNLE1BQU0sTUFBTSxlQUFlLFdBQVcsQ0FBQyxFQUFFLE1BQU0sS0FBSyxHQUN0RSxTQUFTLEdBQUcsR0FBRztBQUVuQixJQUFBVSxlQUFjLEtBQUs7QUFDbkIsU0FBSyxJQUFJLEdBQUcsSUFBSSxHQUFHLEVBQUUsR0FBRztBQUN0QixVQUFJLFFBQVEsQ0FBQyxHQUFHLElBQUksZ0JBQVEsR0FBRyxJQUFJO0FBQ25DLFVBQUksQ0FBQyxHQUFHLEtBQUssT0FBTyxPQUFPLENBQUMsR0FBRyxFQUFFLFVBQVU7QUFDM0MsVUFBSSxDQUFDLEVBQUU7QUFBUSxVQUFFLFNBQVMsR0FBRyxVQUFVLE1BQU0sRUFBRSxPQUFPLElBQUksQ0FBQyxDQUFDO0FBQUEsZUFDbkQsQ0FBQyxFQUFFLFVBQVUsRUFBRSxPQUFPLENBQUMsTUFBTSxFQUFFLENBQUM7QUFBRyxVQUFFLFNBQVMsR0FBRyxFQUFFLE9BQU87QUFBQSxJQUNyRTtBQUVBLFFBQUk7QUFBZSxzQkFBZ0IsYUFBYSxhQUFhO0FBRTdELFFBQUksU0FBUztBQUNYLFVBQUksRUFBRSxPQUFPO0FBQUcscUJBQWEsRUFBRSxDQUFDLEdBQUcsZ0JBQWdCLFdBQVcsV0FBVztBQUFFLDBCQUFnQjtBQUFBLFFBQU0sR0FBRyxVQUFVO0FBQzlHLHdCQUFVLElBQUk7QUFDZCxRQUFFLE1BQU07QUFBQSxJQUNWO0FBQUEsRUFDRjtBQUVBLFdBQVMsV0FBVyxVQUFVLE1BQU07QUFDbEMsUUFBSSxDQUFDLEtBQUs7QUFBVztBQUNyQixRQUFJLElBQUksUUFBUSxNQUFNLElBQUksRUFBRSxNQUFNLEtBQUssR0FDbkMsVUFBVSxNQUFNLGdCQUNoQixJQUFJLFFBQVEsUUFBUSxHQUFHLEdBQUcsR0FBRztBQUVqQyxJQUFBRCxpQkFBUSxLQUFLO0FBQ2IsU0FBSyxJQUFJLEdBQUcsSUFBSSxHQUFHLEVBQUUsR0FBRztBQUN0QixVQUFJLFFBQVEsQ0FBQyxHQUFHLElBQUksZ0JBQVEsR0FBRyxJQUFJO0FBQ25DLFVBQUksRUFBRSxVQUFVLEVBQUUsT0FBTyxDQUFDLE1BQU0sRUFBRTtBQUFZLFVBQUUsT0FBTyxDQUFDLElBQUk7QUFBQSxlQUNuRCxFQUFFLFVBQVUsRUFBRSxPQUFPLENBQUMsTUFBTSxFQUFFO0FBQVksVUFBRSxPQUFPLENBQUMsSUFBSTtBQUFBLElBQ25FO0FBQ0EsUUFBSSxFQUFFLEtBQUs7QUFDWCxRQUFJLEVBQUUsUUFBUTtBQUNaLFVBQUksS0FBSyxFQUFFLE9BQU8sQ0FBQyxHQUFHLEtBQUssRUFBRSxPQUFPLENBQUMsR0FDakMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxHQUFHLEtBQUssRUFBRSxPQUFPLENBQUMsR0FDakMsTUFBTSxLQUFLLEdBQUcsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxLQUFLLE1BQU0sS0FBSyxHQUFHLENBQUMsSUFBSSxHQUFHLENBQUMsS0FBSyxJQUN4RCxNQUFNLEtBQUssR0FBRyxDQUFDLElBQUksR0FBRyxDQUFDLEtBQUssTUFBTSxLQUFLLEdBQUcsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxLQUFLO0FBQzVELFVBQUksTUFBTSxHQUFHLEtBQUssS0FBSyxLQUFLLEVBQUUsQ0FBQztBQUMvQixVQUFJLEVBQUUsR0FBRyxDQUFDLElBQUksR0FBRyxDQUFDLEtBQUssSUFBSSxHQUFHLENBQUMsSUFBSSxHQUFHLENBQUMsS0FBSyxDQUFDO0FBQzdDLFVBQUksRUFBRSxHQUFHLENBQUMsSUFBSSxHQUFHLENBQUMsS0FBSyxJQUFJLEdBQUcsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxLQUFLLENBQUM7QUFBQSxJQUMvQyxXQUNTLEVBQUU7QUFBUSxVQUFJLEVBQUUsT0FBTyxDQUFDLEdBQUcsSUFBSSxFQUFFLE9BQU8sQ0FBQztBQUFBO0FBQzdDO0FBRUwsTUFBRSxLQUFLLFNBQVMsVUFBVSxVQUFVLEdBQUcsR0FBRyxDQUFDLEdBQUcsRUFBRSxRQUFRLGVBQWUsQ0FBQztBQUFBLEVBQzFFO0FBRUEsV0FBUyxXQUFXLFVBQVUsTUFBTTtBQUNsQyxRQUFJLENBQUMsS0FBSztBQUFXO0FBQ3JCLFFBQUksSUFBSSxRQUFRLE1BQU0sSUFBSSxFQUFFLE1BQU0sS0FBSyxHQUNuQyxVQUFVLE1BQU0sZ0JBQ2hCLElBQUksUUFBUSxRQUFRLEdBQUc7QUFFM0IsSUFBQUMsZUFBYyxLQUFLO0FBQ25CLFFBQUk7QUFBYSxtQkFBYSxXQUFXO0FBQ3pDLGtCQUFjLFdBQVcsV0FBVztBQUFFLG9CQUFjO0FBQUEsSUFBTSxHQUFHLFVBQVU7QUFDdkUsU0FBSyxJQUFJLEdBQUcsSUFBSSxHQUFHLEVBQUUsR0FBRztBQUN0QixVQUFJLFFBQVEsQ0FBQztBQUNiLFVBQUksRUFBRSxVQUFVLEVBQUUsT0FBTyxDQUFDLE1BQU0sRUFBRTtBQUFZLGVBQU8sRUFBRTtBQUFBLGVBQzlDLEVBQUUsVUFBVSxFQUFFLE9BQU8sQ0FBQyxNQUFNLEVBQUU7QUFBWSxlQUFPLEVBQUU7QUFBQSxJQUM5RDtBQUNBLFFBQUksRUFBRSxVQUFVLENBQUMsRUFBRTtBQUFRLFFBQUUsU0FBUyxFQUFFLFFBQVEsT0FBTyxFQUFFO0FBQ3pELFFBQUksRUFBRTtBQUFRLFFBQUUsT0FBTyxDQUFDLElBQUksS0FBSyxPQUFPLE9BQU8sRUFBRSxPQUFPLENBQUMsQ0FBQztBQUFBLFNBQ3JEO0FBQ0gsUUFBRSxJQUFJO0FBRU4sVUFBSSxFQUFFLFNBQVMsR0FBRztBQUNoQixZQUFJLGdCQUFRLEdBQUcsSUFBSTtBQUNuQixZQUFJLEtBQUssTUFBTSxXQUFXLENBQUMsSUFBSSxFQUFFLENBQUMsR0FBRyxXQUFXLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxJQUFJLGFBQWE7QUFDeEUsY0FBSSxJQUFJRixnQkFBTyxJQUFJLEVBQUUsR0FBRyxlQUFlO0FBQ3ZDLGNBQUk7QUFBRyxjQUFFLE1BQU0sTUFBTSxTQUFTO0FBQUEsUUFDaEM7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFFQSxPQUFLLGFBQWEsU0FBUyxHQUFHO0FBQzVCLFdBQU8sVUFBVSxVQUFVLGFBQWEsT0FBTyxNQUFNLGFBQWEsSUFBSUksa0JBQVMsQ0FBQyxDQUFDLEdBQUcsUUFBUTtBQUFBLEVBQzlGO0FBRUEsT0FBSyxTQUFTLFNBQVMsR0FBRztBQUN4QixXQUFPLFVBQVUsVUFBVVosVUFBUyxPQUFPLE1BQU0sYUFBYSxJQUFJWSxrQkFBUyxDQUFDLENBQUMsQ0FBQyxHQUFHLFFBQVFaO0FBQUEsRUFDM0Y7QUFFQSxPQUFLLFlBQVksU0FBUyxHQUFHO0FBQzNCLFdBQU8sVUFBVSxVQUFVLFlBQVksT0FBTyxNQUFNLGFBQWEsSUFBSVksa0JBQVMsQ0FBQyxDQUFDLENBQUMsR0FBRyxRQUFRO0FBQUEsRUFDOUY7QUFFQSxPQUFLLFNBQVMsU0FBUyxHQUFHO0FBQ3hCLFdBQU8sVUFBVSxVQUFVLFNBQVMsT0FBTyxNQUFNLGFBQWEsSUFBSUEsa0JBQVMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxRQUFRO0FBQUEsRUFDcEk7QUFFQSxPQUFLLGNBQWMsU0FBUyxHQUFHO0FBQzdCLFdBQU8sVUFBVSxVQUFVLFlBQVksQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLEdBQUcsWUFBWSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsR0FBRyxRQUFRLENBQUMsWUFBWSxDQUFDLEdBQUcsWUFBWSxDQUFDLENBQUM7QUFBQSxFQUNwSDtBQUVBLE9BQUssa0JBQWtCLFNBQVMsR0FBRztBQUNqQyxXQUFPLFVBQVUsVUFBVSxnQkFBZ0IsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsR0FBRyxnQkFBZ0IsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsR0FBRyxnQkFBZ0IsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsR0FBRyxnQkFBZ0IsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsR0FBRyxRQUFRLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFLENBQUMsR0FBRyxnQkFBZ0IsQ0FBQyxFQUFFLENBQUMsQ0FBQyxHQUFHLENBQUMsZ0JBQWdCLENBQUMsRUFBRSxDQUFDLEdBQUcsZ0JBQWdCLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztBQUFBLEVBQzVRO0FBRUEsT0FBSyxZQUFZLFNBQVMsR0FBRztBQUMzQixXQUFPLFVBQVUsVUFBVSxZQUFZLEdBQUcsUUFBUTtBQUFBLEVBQ3BEO0FBRUEsT0FBSyxXQUFXLFNBQVMsR0FBRztBQUMxQixXQUFPLFVBQVUsVUFBVSxXQUFXLENBQUMsR0FBRyxRQUFRO0FBQUEsRUFDcEQ7QUFFQSxPQUFLLGNBQWMsU0FBUyxHQUFHO0FBQzdCLFdBQU8sVUFBVSxVQUFVLGNBQWMsR0FBRyxRQUFRO0FBQUEsRUFDdEQ7QUFFQSxPQUFLLEtBQUssV0FBVztBQUNuQixRQUFJLFFBQVEsVUFBVSxHQUFHLE1BQU0sV0FBVyxTQUFTO0FBQ25ELFdBQU8sVUFBVSxZQUFZLE9BQU87QUFBQSxFQUN0QztBQUVBLE9BQUssZ0JBQWdCLFNBQVMsR0FBRztBQUMvQixXQUFPLFVBQVUsVUFBVSxrQkFBa0IsSUFBSSxDQUFDLEtBQUssR0FBRyxRQUFRLEtBQUssS0FBSyxjQUFjO0FBQUEsRUFDNUY7QUFFQSxPQUFLLGNBQWMsU0FBUyxHQUFHO0FBQzdCLFdBQU8sVUFBVSxVQUFVLGNBQWMsQ0FBQyxHQUFHLFFBQVE7QUFBQSxFQUN2RDtBQUVBLFNBQU87QUFDVDs7O0E1SHphTyxJQUFNLFlBQVk7QUF5Q3pCLFNBQVMsV0FBVyxLQUF1QztBQUN6RCxNQUFJLElBQUksV0FBVyxHQUFHLEdBQUc7QUFDdkIsVUFBTUMsT0FBTSxJQUFJLE1BQU0sQ0FBQztBQUN2QixRQUFJQSxLQUFJLFdBQVcsR0FBRztBQUNwQixhQUFPO0FBQUEsUUFDTCxTQUFTQSxLQUFJLENBQUMsSUFBSUEsS0FBSSxDQUFDLEdBQUcsRUFBRSxJQUFJO0FBQUEsUUFDaEMsU0FBU0EsS0FBSSxDQUFDLElBQUlBLEtBQUksQ0FBQyxHQUFHLEVBQUUsSUFBSTtBQUFBLFFBQ2hDLFNBQVNBLEtBQUksQ0FBQyxJQUFJQSxLQUFJLENBQUMsR0FBRyxFQUFFLElBQUk7QUFBQSxNQUNsQztBQUFBLElBQ0Y7QUFDQSxXQUFPO0FBQUEsTUFDTCxTQUFTQSxLQUFJLE1BQU0sR0FBRyxDQUFDLEdBQUcsRUFBRSxJQUFJO0FBQUEsTUFDaEMsU0FBU0EsS0FBSSxNQUFNLEdBQUcsQ0FBQyxHQUFHLEVBQUUsSUFBSTtBQUFBLE1BQ2hDLFNBQVNBLEtBQUksTUFBTSxHQUFHLENBQUMsR0FBRyxFQUFFLElBQUk7QUFBQSxJQUNsQztBQUFBLEVBQ0Y7QUFDQSxRQUFNQyxLQUFJLElBQUksTUFBTSxtQ0FBbUM7QUFDdkQsTUFBSUE7QUFBRyxXQUFPLENBQUMsU0FBU0EsR0FBRSxDQUFDLENBQUMsSUFBSSxLQUFLLFNBQVNBLEdBQUUsQ0FBQyxDQUFDLElBQUksS0FBSyxTQUFTQSxHQUFFLENBQUMsQ0FBQyxJQUFJLEdBQUc7QUFDL0UsU0FBTyxDQUFDLEtBQUssS0FBSyxHQUFHO0FBQ3ZCO0FBRUEsU0FBUyxjQUFjLElBQWlCLFNBQWlCLFVBQTRDO0FBQ25HLFFBQU0sUUFBUSxpQkFBaUIsRUFBRTtBQUNqQyxRQUFNLE1BQU0sTUFBTSxpQkFBaUIsT0FBTyxFQUFFLEtBQUs7QUFDakQsU0FBTyxXQUFXLE9BQU8sUUFBUTtBQUNuQztBQUVBLFNBQVMsV0FBV0MsSUFBcUM7QUFDdkQsU0FBTyxPQUFPLEtBQUssTUFBTUEsR0FBRSxDQUFDLElBQUksR0FBRyxDQUFDLElBQUksS0FBSyxNQUFNQSxHQUFFLENBQUMsSUFBSSxHQUFHLENBQUMsSUFBSSxLQUFLLE1BQU1BLEdBQUUsQ0FBQyxJQUFJLEdBQUcsQ0FBQztBQUMxRjtBQU1BLFNBQVMsS0FBS0MsSUFBVyxHQUFXLEdBQW1CO0FBQ3JELFNBQU9BLE1BQUssSUFBSUEsTUFBSztBQUN2QjtBQU1PLElBQU0sWUFBTixjQUF3QiwwQkFBUztBQUFBLEVBK0R0QyxZQUFZLE1BQXFCO0FBQy9CLFVBQU0sSUFBSTtBQS9EWixTQUFRLFlBQThCO0FBQ3RDLFNBQVEsYUFBa0Q7QUFDMUQsU0FBUSxpQkFBd0M7QUFDaEQsU0FBUSxjQUFrQztBQUMxQyxTQUFRLFNBQXNCLEVBQUUsR0FBRyxlQUFlO0FBR2xEO0FBQUEsU0FBUSxnQkFBb0M7QUFDNUMsU0FBUSxXQUFxQztBQUM3QyxTQUFRLE1BQXVDO0FBQy9DLFNBQVEsTUFBTTtBQUdkO0FBQUEsU0FBUSxlQUFnRTtBQUN4RSxTQUFRLGdCQUErQkM7QUFDdkMsU0FBUSxnQkFBZ0I7QUFHeEI7QUFBQSxTQUFRLFdBQXNCLENBQUM7QUFDL0IsU0FBUSxXQUFzQixDQUFDO0FBRy9CO0FBQUEsU0FBUSxPQUFPO0FBQ2YsU0FBUSxPQUFPO0FBQ2YsU0FBUSxXQUFXO0FBQ25CLFNBQVEsYUFBYTtBQUNyQixTQUFRLGFBQWE7QUFDckIsU0FBUSxpQkFBaUI7QUFHekI7QUFBQSxTQUFRLGNBQThCO0FBQ3RDLFNBQVEsZUFBK0I7QUFDdkMsU0FBUSxXQUEyQjtBQUNuQyxTQUFRLGFBQWE7QUFDckIsU0FBUSxnQkFBZ0I7QUFDeEIsU0FBUSxjQUFjO0FBR3RCO0FBQUEsU0FBUSxlQUF1QjtBQUMvQixTQUFRLGNBQWM7QUFHdEI7QUFBQSxTQUFRLGtCQUE0QyxDQUFDLEtBQUssS0FBSyxDQUFHO0FBQ2xFLFNBQVEsZ0JBQTBDLENBQUMsS0FBSyxLQUFLLEdBQUc7QUFDaEUsU0FBUSxnQkFBMEMsQ0FBQyxLQUFLLEtBQUssR0FBRztBQUNoRSxTQUFRLGVBQXlDLENBQUMsS0FBSyxLQUFLLENBQUc7QUFDL0QsU0FBUSxpQkFBMkMsQ0FBQyxLQUFLLEtBQUssQ0FBRztBQUNqRSxTQUFRLFVBQW9DLENBQUMsS0FBSyxLQUFLLEdBQUc7QUFDMUQsU0FBUSxZQUFZO0FBR3BCO0FBQUEsU0FBTyxtQkFBMkU7QUFDbEYsU0FBTyxpQkFBc0Q7QUFHN0Q7QUFBQSxTQUFRLFdBQTZDO0FBQ3JELFNBQVEsZUFBaUQ7QUFDekQsU0FBUSxlQUFpRDtBQUN6RCxTQUFRLGFBQStDO0FBQ3ZELFNBQVEsY0FBZ0Q7QUFDeEQsU0FBUSx3QkFBMEQ7QUFBQSxFQUlsRTtBQUFBLEVBRUEsY0FBc0I7QUFBRSxXQUFPO0FBQUEsRUFBVztBQUFBLEVBQzFDLGlCQUF5QjtBQUFFLFdBQU87QUFBQSxFQUFnQjtBQUFBLEVBQ2xELFVBQWtCO0FBQUUsV0FBTztBQUFBLEVBQVk7QUFBQSxFQUV2QyxhQUFhLE1BQXVCO0FBQ2xDLFNBQUssWUFBWTtBQUNqQixRQUFJLEtBQUs7QUFBYSxXQUFLLFlBQVk7QUFBQSxFQUN6QztBQUFBLEVBRUEsTUFBTSxTQUF3QjtBQUM1QixVQUFNLFlBQVksS0FBSztBQUN2QixjQUFVLE1BQU07QUFDaEIsY0FBVSxTQUFTLG9CQUFvQjtBQUV2QyxRQUFJLEtBQUssV0FBVztBQUNsQixXQUFLLFlBQVk7QUFBQSxJQUNuQixPQUFPO0FBQ0wsZ0JBQVUsU0FBUyxPQUFPO0FBQUEsUUFDeEIsS0FBSztBQUFBLFFBQ0wsTUFBTTtBQUFBLE1BQ1IsQ0FBQztBQUFBLElBQ0g7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFNLFVBQXlCO0FBQzdCLFNBQUssUUFBUTtBQUFBLEVBQ2Y7QUFBQSxFQUVRLFVBQWdCO0FBQ3RCLFNBQUssZUFBZTtBQUNwQixRQUFJLEtBQUssWUFBWTtBQUNuQixXQUFLLFdBQVcsS0FBSztBQUNyQixXQUFLLFdBQVcsR0FBRyxRQUFRLElBQUk7QUFDL0IsV0FBSyxhQUFhO0FBQUEsSUFDcEI7QUFDQSxRQUFJLEtBQUssZ0JBQWdCO0FBQUUsV0FBSyxlQUFlLFdBQVc7QUFBRyxXQUFLLGlCQUFpQjtBQUFBLElBQU07QUFDekYsUUFBSSxLQUFLLGFBQWE7QUFBRSxXQUFLLFlBQVksUUFBUTtBQUFHLFdBQUssY0FBYztBQUFBLElBQU07QUFDN0UsU0FBSyxzQkFBc0I7QUFDM0IsUUFBSSxLQUFLLHVCQUF1QjtBQUM5QixXQUFLLFVBQVUsb0JBQW9CLGFBQWEsS0FBSyx1QkFBdUIsSUFBSTtBQUNoRixXQUFLLHdCQUF3QjtBQUFBLElBQy9CO0FBR0EsVUFBTSxVQUFVLFNBQVMsS0FBSyxjQUFjLGFBQWE7QUFDekQsUUFBSTtBQUFTLGNBQVEsT0FBTztBQUU1QixTQUFLLFdBQVcsQ0FBQztBQUNqQixTQUFLLFdBQVcsQ0FBQztBQUVqQixTQUFLLFVBQVUsT0FBTztBQUN0QixTQUFLLFdBQVc7QUFDaEIsU0FBSyxNQUFNO0FBQ1gsU0FBSyxnQkFBZ0I7QUFBQSxFQUN2QjtBQUFBLEVBRVEsd0JBQThCO0FBQ3BDLFVBQU1GLEtBQUksS0FBSztBQUNmLFFBQUksQ0FBQ0E7QUFBRztBQUNSLFFBQUksS0FBSztBQUFVLE1BQUFBLEdBQUUsb0JBQW9CLFNBQVMsS0FBSyxRQUFRO0FBRS9ELFFBQUksS0FBSztBQUFjLE1BQUFBLEdBQUUsb0JBQW9CLGFBQWEsS0FBSyxjQUFjLElBQUk7QUFDakYsUUFBSSxLQUFLO0FBQWMsTUFBQUEsR0FBRSxvQkFBb0IsYUFBYSxLQUFLLFlBQVk7QUFDM0UsUUFBSSxLQUFLO0FBQVksTUFBQUEsR0FBRSxvQkFBb0IsV0FBVyxLQUFLLFVBQVU7QUFDckUsUUFBSSxLQUFLO0FBQWEsTUFBQUEsR0FBRSxvQkFBb0IsWUFBWSxLQUFLLFdBQVc7QUFBQSxFQUMxRTtBQUFBO0FBQUEsRUFJUSxrQkFBd0I7QUFDOUIsUUFBSSxLQUFLO0FBQWM7QUFDdkIsVUFBTUcsU0FBUSxNQUFNO0FBQ2xCLFdBQUssZUFBZSxzQkFBc0JBLE1BQUs7QUFDL0MsV0FBSyxjQUFjO0FBQUEsSUFDckI7QUFDQSxTQUFLLGVBQWUsc0JBQXNCQSxNQUFLO0FBQUEsRUFDakQ7QUFBQSxFQUVRLGlCQUF1QjtBQUM3QixRQUFJLEtBQUssY0FBYztBQUNyQiwyQkFBcUIsS0FBSyxZQUFZO0FBQ3RDLFdBQUssZUFBZTtBQUFBLElBQ3RCO0FBQUEsRUFDRjtBQUFBLEVBRVEsZ0JBQXNCO0FBQzVCLFFBQUksWUFBWTtBQUdoQixVQUFNLFVBQVU7QUFDaEIsUUFBSSxLQUFLLElBQUksS0FBSyxPQUFPLEtBQUssVUFBVSxJQUFJLFFBQ3hDLEtBQUssSUFBSSxLQUFLLE9BQU8sS0FBSyxVQUFVLElBQUksUUFDeEMsS0FBSyxJQUFJLEtBQUssV0FBVyxLQUFLLGNBQWMsSUFBSSxNQUFRO0FBQzFELFdBQUssT0FBTyxLQUFLLEtBQUssTUFBTSxLQUFLLFlBQVksT0FBTztBQUNwRCxXQUFLLE9BQU8sS0FBSyxLQUFLLE1BQU0sS0FBSyxZQUFZLE9BQU87QUFDcEQsV0FBSyxXQUFXLEtBQUssS0FBSyxVQUFVLEtBQUssZ0JBQWdCLE9BQU87QUFDaEUsVUFBSSxLQUFLLElBQUksS0FBSyxXQUFXLEtBQUssY0FBYyxJQUFJLE1BQVE7QUFDMUQsYUFBSyxXQUFXLEtBQUs7QUFDckIsYUFBSyxPQUFPLEtBQUs7QUFDakIsYUFBSyxPQUFPLEtBQUs7QUFBQSxNQUNuQjtBQUNBLGtCQUFZO0FBQUEsSUFDZDtBQUdBLFVBQU0sWUFBWTtBQUNsQixlQUFXLEtBQUssS0FBSyxVQUFVO0FBQzdCLFVBQUksS0FBSyxJQUFJLEVBQUUsUUFBUSxFQUFFLFdBQVcsSUFBSSxNQUFPO0FBQzdDLFVBQUUsUUFBUSxLQUFLLEVBQUUsT0FBTyxFQUFFLGFBQWEsU0FBUztBQUNoRCxvQkFBWTtBQUFBLE1BQ2QsT0FBTztBQUNMLFVBQUUsUUFBUSxFQUFFO0FBQUEsTUFDZDtBQUFBLElBQ0Y7QUFDQSxlQUFXLEtBQUssS0FBSyxVQUFVO0FBQzdCLFVBQUksS0FBSyxJQUFJLEVBQUUsUUFBUSxFQUFFLFdBQVcsSUFBSSxNQUFPO0FBQzdDLFVBQUUsUUFBUSxLQUFLLEVBQUUsT0FBTyxFQUFFLGFBQWEsU0FBUztBQUNoRCxvQkFBWTtBQUFBLE1BQ2QsT0FBTztBQUNMLFVBQUUsUUFBUSxFQUFFO0FBQUEsTUFDZDtBQUFBLElBQ0Y7QUFFQSxVQUFNLGFBQWEsS0FBSyxZQUFZLE1BQU0sS0FBSyxLQUFLO0FBRXBELFFBQUksYUFBYSxhQUFhLEtBQUssYUFBYTtBQUM5QyxXQUFLLGNBQWM7QUFDbkIsV0FBSyxLQUFLO0FBQUEsSUFDWjtBQUFBLEVBQ0Y7QUFBQTtBQUFBLEVBSVEsYUFBYSxNQUE0QjtBQUMvQyxVQUFNSCxLQUFJLEtBQUs7QUFDZixRQUFJLFFBQVEsQ0FBQyxHQUFHLEtBQUssS0FBSztBQUMxQixRQUFJLFFBQVEsQ0FBQyxHQUFHLEtBQUssS0FBSztBQUUxQixRQUFJLENBQUNBLEdBQUUsV0FBVztBQUNoQixZQUFNLE1BQU0sSUFBSSxJQUFJLE1BQU0sT0FBTyxDQUFDLE1BQU0sRUFBRSxTQUFTLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFFLEVBQUUsQ0FBQztBQUMzRSxjQUFRLE1BQU0sT0FBTyxDQUFDLE1BQU0sRUFBRSxTQUFTLE1BQU07QUFDN0MsY0FBUSxNQUFNLE9BQU8sQ0FBQyxNQUFNLENBQUMsSUFBSSxJQUFJLEVBQUUsTUFBTSxLQUFLLENBQUMsSUFBSSxJQUFJLEVBQUUsTUFBTSxDQUFDO0FBQUEsSUFDdEU7QUFDQSxRQUFJLENBQUNBLEdBQUUsYUFBYTtBQUNsQixZQUFNLE1BQU0sSUFBSSxJQUFJLE1BQU0sT0FBTyxDQUFDLE1BQU0sRUFBRSxTQUFTLFFBQVEsRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFFLEVBQUUsQ0FBQztBQUM3RSxjQUFRLE1BQU0sT0FBTyxDQUFDLE1BQU0sRUFBRSxTQUFTLFFBQVE7QUFDL0MsY0FBUSxNQUFNLE9BQU8sQ0FBQyxNQUFNLENBQUMsSUFBSSxJQUFJLEVBQUUsTUFBTSxLQUFLLENBQUMsSUFBSSxJQUFJLEVBQUUsTUFBTSxDQUFDO0FBQUEsSUFDdEU7QUFDQSxRQUFJLENBQUNBLEdBQUU7QUFBZSxjQUFRLE1BQU0sT0FBTyxDQUFDLE1BQU0sRUFBRSxhQUFhLE1BQU07QUFDdkUsUUFBSSxDQUFDQSxHQUFFO0FBQWlCLGNBQVEsTUFBTSxPQUFPLENBQUMsTUFBTSxFQUFFLGFBQWEsUUFBUTtBQUMzRSxRQUFJQSxHQUFFLFFBQVE7QUFDWixZQUFNLElBQUlBLEdBQUUsT0FBTyxZQUFZO0FBQy9CLFlBQU0sVUFBVSxJQUFJLElBQUksTUFBTSxPQUFPLENBQUMsTUFBTSxFQUFFLE1BQU0sWUFBWSxFQUFFLFNBQVMsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUM7QUFDL0YsaUJBQVcsS0FBSyxPQUFPO0FBQ3JCLFlBQUksUUFBUSxJQUFJLEVBQUUsTUFBTTtBQUFHLGtCQUFRLElBQUksRUFBRSxNQUFNO0FBQy9DLFlBQUksUUFBUSxJQUFJLEVBQUUsTUFBTTtBQUFHLGtCQUFRLElBQUksRUFBRSxNQUFNO0FBQUEsTUFDakQ7QUFDQSxjQUFRLE1BQU0sT0FBTyxDQUFDLE1BQU0sUUFBUSxJQUFJLEVBQUUsRUFBRSxDQUFDO0FBQzdDLFlBQU0sVUFBVSxJQUFJLElBQUksTUFBTSxJQUFJLENBQUMsTUFBTSxFQUFFLEVBQUUsQ0FBQztBQUM5QyxjQUFRLE1BQU0sT0FBTyxDQUFDLE1BQU0sUUFBUSxJQUFJLEVBQUUsTUFBTSxLQUFLLFFBQVEsSUFBSSxFQUFFLE1BQU0sQ0FBQztBQUFBLElBQzVFO0FBQ0EsUUFBSUEsR0FBRSxZQUFZO0FBQ2hCLFlBQU0sS0FBS0EsR0FBRSxXQUFXLFlBQVk7QUFDcEMsWUFBTSxVQUFVLElBQUksSUFBSSxNQUFNLE9BQU8sQ0FBQyxNQUFNLEVBQUUsU0FBUyxZQUFZLEVBQUUsU0FBUyxFQUFFLENBQUMsRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFFLEVBQUUsQ0FBQztBQUNuRyxpQkFBVyxLQUFLLE9BQU87QUFDckIsWUFBSSxRQUFRLElBQUksRUFBRSxNQUFNO0FBQUcsa0JBQVEsSUFBSSxFQUFFLE1BQU07QUFDL0MsWUFBSSxRQUFRLElBQUksRUFBRSxNQUFNO0FBQUcsa0JBQVEsSUFBSSxFQUFFLE1BQU07QUFBQSxNQUNqRDtBQUNBLGNBQVEsTUFBTSxPQUFPLENBQUMsTUFBTSxRQUFRLElBQUksRUFBRSxFQUFFLENBQUM7QUFDN0MsWUFBTSxVQUFVLElBQUksSUFBSSxNQUFNLElBQUksQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDO0FBQzlDLGNBQVEsTUFBTSxPQUFPLENBQUMsTUFBTSxRQUFRLElBQUksRUFBRSxNQUFNLEtBQUssUUFBUSxJQUFJLEVBQUUsTUFBTSxDQUFDO0FBQUEsSUFDNUU7QUFDQSxRQUFJQSxHQUFFLGNBQWM7QUFDbEIsWUFBTSxLQUFLQSxHQUFFLGFBQWEsWUFBWTtBQUN0QyxZQUFNLFVBQVUsSUFBSTtBQUFBLFFBQ2xCLE1BQU0sT0FBTyxDQUFDLE1BQU0sRUFBRSxTQUFTLFlBQVksQ0FBQyxFQUFFLFVBQVUsWUFBWSxFQUFFLFNBQVMsRUFBRSxDQUFDLEVBQUUsSUFBSSxDQUFDLE1BQU0sRUFBRSxFQUFFO0FBQUEsTUFDckc7QUFDQSxjQUFRLE1BQU0sT0FBTyxDQUFDLE1BQU0sQ0FBQyxRQUFRLElBQUksRUFBRSxFQUFFLENBQUM7QUFDOUMsY0FBUSxNQUFNLE9BQU8sQ0FBQyxNQUFNLENBQUMsUUFBUSxJQUFJLEVBQUUsTUFBTSxLQUFLLENBQUMsUUFBUSxJQUFJLEVBQUUsTUFBTSxDQUFDO0FBQUEsSUFDOUU7QUFDQSxRQUFJLENBQUNBLEdBQUUsYUFBYTtBQUNsQixZQUFNLFlBQVksb0JBQUksSUFBWTtBQUNsQyxpQkFBVyxLQUFLLE9BQU87QUFBRSxrQkFBVSxJQUFJLEVBQUUsTUFBTTtBQUFHLGtCQUFVLElBQUksRUFBRSxNQUFNO0FBQUEsTUFBRztBQUMzRSxjQUFRLE1BQU0sT0FBTyxDQUFDLE1BQU0sVUFBVSxJQUFJLEVBQUUsRUFBRSxDQUFDO0FBQUEsSUFDakQ7QUFFQSxVQUFNLEtBQUssb0JBQUksSUFBb0I7QUFDbkMsZUFBVyxLQUFLLE9BQU87QUFDckIsU0FBRyxJQUFJLEVBQUUsU0FBUyxHQUFHLElBQUksRUFBRSxNQUFNLEtBQUssS0FBSyxDQUFDO0FBQzVDLFNBQUcsSUFBSSxFQUFFLFNBQVMsR0FBRyxJQUFJLEVBQUUsTUFBTSxLQUFLLEtBQUssQ0FBQztBQUFBLElBQzlDO0FBQ0EsZUFBVyxLQUFLO0FBQU8sUUFBRSxjQUFjLEdBQUcsSUFBSSxFQUFFLEVBQUUsS0FBSztBQUV2RCxXQUFPLEVBQUUsT0FBTyxNQUFNO0FBQUEsRUFDeEI7QUFBQTtBQUFBLEVBSVEsY0FBYyxHQUFrRDtBQUN0RSxVQUFNRCxLQUFJLEtBQUssT0FBTztBQUN0QixVQUFNLE9BQU8sRUFBRSxTQUFTLFNBQVMsTUFBTTtBQUN2QyxVQUFNLE1BQU0sS0FBSyxJQUFJLEdBQUcsRUFBRSxXQUFXO0FBQ3JDLFVBQU0sT0FBTyxLQUFLLElBQUksSUFBSSxLQUFLLEtBQUssR0FBRyxJQUFJLEdBQUc7QUFDOUMsWUFBUSxPQUFPLFFBQVFBO0FBQUEsRUFDekI7QUFBQTtBQUFBLEVBSVEsZ0JBQXNCO0FBQzVCLFVBQU0sS0FBSyxLQUFLO0FBQ2hCLFNBQUssa0JBQWtCLGNBQWMsSUFBSSx3QkFBd0IsU0FBUztBQUMxRSxTQUFLLGdCQUFnQixjQUFjLElBQUksZ0JBQWdCLFNBQVM7QUFDaEUsU0FBSyxnQkFBZ0IsY0FBYyxJQUFJLGdDQUFnQyxTQUFTO0FBQ2hGLFNBQUssZUFBZSxjQUFjLElBQUksd0JBQXdCLFNBQVM7QUFDdkUsU0FBSyxpQkFBaUIsY0FBYyxJQUFJLHdCQUF3QixTQUFTO0FBQ3pFLFNBQUssVUFBVSxjQUFjLElBQUksd0JBQXdCLFNBQVM7QUFDbEUsVUFBTSxRQUFRLGlCQUFpQixFQUFFO0FBQ2pDLFNBQUssWUFBWSxNQUFNLGlCQUFpQixlQUFlLEVBQUUsS0FBSyxLQUFLO0FBQUEsRUFDckU7QUFBQTtBQUFBLEVBSVEsZ0JBQTBDO0FBQ2hELFVBQU1DLEtBQUksS0FBSztBQUNmLFFBQUksQ0FBQ0E7QUFBRyxhQUFPLEVBQUUsR0FBRyxHQUFHLEdBQUcsRUFBRTtBQUU1QixXQUFPLEVBQUUsR0FBR0EsR0FBRSxhQUFhLEdBQUdBLEdBQUUsYUFBYTtBQUFBLEVBQy9DO0FBQUEsRUFFUSxjQUFjLElBQVksSUFBOEI7QUFDOUQsVUFBTSxFQUFFLEdBQUcsRUFBRSxJQUFJLEtBQUssY0FBYztBQUNwQyxXQUFPO0FBQUEsT0FDSixLQUFLLEtBQUssUUFBUSxLQUFLLFdBQVcsSUFBSTtBQUFBLE9BQ3RDLEtBQUssS0FBSyxRQUFRLEtBQUssV0FBVyxJQUFJO0FBQUEsSUFDekM7QUFBQSxFQUNGO0FBQUEsRUFFUSxjQUFjLElBQVksSUFBOEI7QUFDOUQsVUFBTSxFQUFFLEdBQUcsRUFBRSxJQUFJLEtBQUssY0FBYztBQUNwQyxXQUFPO0FBQUEsT0FDSixLQUFLLElBQUksS0FBSyxLQUFLLFdBQVcsS0FBSztBQUFBLE9BQ25DLEtBQUssSUFBSSxLQUFLLEtBQUssV0FBVyxLQUFLO0FBQUEsSUFDdEM7QUFBQSxFQUNGO0FBQUEsRUFFUSxvQkFBb0IsSUFBWSxJQUE4QjtBQUNwRSxVQUFNLEVBQUUsR0FBRyxFQUFFLElBQUksS0FBSyxjQUFjO0FBQ3BDLFdBQU87QUFBQSxPQUNKLEtBQUssSUFBSSxLQUFLLEtBQUssaUJBQWlCLEtBQUs7QUFBQSxPQUN6QyxLQUFLLElBQUksS0FBSyxLQUFLLGlCQUFpQixLQUFLO0FBQUEsSUFDNUM7QUFBQSxFQUNGO0FBQUE7QUFBQSxFQUlRLFlBQVksSUFBWSxJQUE0QjtBQUMxRCxVQUFNLENBQUMsSUFBSSxFQUFFLElBQUksS0FBSyxjQUFjLElBQUksRUFBRTtBQUMxQyxRQUFJLE9BQXVCO0FBQzNCLFFBQUksV0FBVztBQUNmLGVBQVcsS0FBSyxLQUFLLFVBQVU7QUFDN0IsWUFBTSxLQUFLLEVBQUUsS0FBSztBQUNsQixZQUFNLEtBQUssRUFBRSxLQUFLO0FBQ2xCLFlBQU0sS0FBSyxLQUFLO0FBQ2hCLFlBQU0sS0FBSyxLQUFLO0FBQ2hCLFlBQU0sT0FBTyxLQUFLLEtBQUssS0FBSyxLQUFLLEtBQUssRUFBRTtBQUN4QyxZQUFNLFlBQVksS0FBSyxJQUFJLEVBQUUsU0FBUyxHQUFHLElBQUksS0FBSyxRQUFRO0FBQzFELFVBQUksT0FBTyxhQUFhLE9BQU8sVUFBVTtBQUN2QyxlQUFPO0FBQ1AsbUJBQVc7QUFBQSxNQUNiO0FBQUEsSUFDRjtBQUNBLFdBQU87QUFBQSxFQUNUO0FBQUE7QUFBQSxFQUlRLHlCQUErQjtBQUNyQyxVQUFNLFFBQVEsS0FBSyxlQUFlLEtBQUs7QUFDdkMsUUFBSSxDQUFDLE9BQU87QUFDVixpQkFBVyxLQUFLLEtBQUssVUFBVTtBQUM3QixVQUFFLGNBQWMsRUFBRSxTQUFTLFdBQVcsTUFBTTtBQUFBLE1BQzlDO0FBQ0EsaUJBQVcsS0FBSyxLQUFLLFVBQVU7QUFDN0IsVUFBRSxjQUFjLEVBQUUsYUFBYSxTQUFTLE9BQU87QUFBQSxNQUNqRDtBQUNBO0FBQUEsSUFDRjtBQUVBLFVBQU0sWUFBWSxvQkFBSSxJQUFZO0FBQ2xDLGNBQVUsSUFBSSxNQUFNLEVBQUU7QUFDdEIsZUFBVyxLQUFLLEtBQUssVUFBVTtBQUM3QixZQUFNLElBQUssRUFBRSxPQUFtQjtBQUNoQyxZQUFNLElBQUssRUFBRSxPQUFtQjtBQUNoQyxVQUFJLE1BQU0sTUFBTTtBQUFJLGtCQUFVLElBQUksQ0FBQztBQUNuQyxVQUFJLE1BQU0sTUFBTTtBQUFJLGtCQUFVLElBQUksQ0FBQztBQUFBLElBQ3JDO0FBRUEsZUFBVyxLQUFLLEtBQUssVUFBVTtBQUM3QixVQUFJLE1BQU0sT0FBTztBQUNmLFVBQUUsY0FBYztBQUFBLE1BQ2xCLFdBQVcsVUFBVSxJQUFJLEVBQUUsRUFBRSxHQUFHO0FBQzlCLFVBQUUsY0FBYyxFQUFFLFNBQVMsV0FBVyxNQUFNO0FBQUEsTUFDOUMsT0FBTztBQUNMLFVBQUUsY0FBYztBQUFBLE1BQ2xCO0FBQUEsSUFDRjtBQUVBLGVBQVcsS0FBSyxLQUFLLFVBQVU7QUFDN0IsWUFBTSxJQUFLLEVBQUUsT0FBbUI7QUFDaEMsWUFBTSxJQUFLLEVBQUUsT0FBbUI7QUFDaEMsVUFBSSxNQUFNLE1BQU0sTUFBTSxNQUFNLE1BQU0sSUFBSTtBQUNwQyxVQUFFLGNBQWM7QUFBQSxNQUNsQixPQUFPO0FBQ0wsVUFBRSxjQUFjO0FBQUEsTUFDbEI7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBTVEsY0FBb0I7QUFDMUIsUUFBSSxDQUFDLEtBQUs7QUFBVztBQUVyQixVQUFNLFlBQVksS0FBSztBQUN2QixVQUFNLGdCQUFnQixDQUFDLEtBQUs7QUFFNUIsUUFBSSxlQUFlO0FBQ2pCLGdCQUFVLE1BQU07QUFDaEIsZ0JBQVUsU0FBUyxvQkFBb0I7QUFHdkMsV0FBSyxjQUFjLElBQUksWUFBWSxXQUFXLEtBQUssUUFBUSxDQUFDLGNBQWM7QUFDeEUsYUFBSyxtQkFBbUIsU0FBUztBQUFBLE1BQ25DLENBQUM7QUFHRCxXQUFLLGdCQUFnQixTQUFTLGNBQWMsS0FBSztBQUNqRCxXQUFLLGNBQWMsTUFBTSxVQUFVO0FBQ25DLGdCQUFVLFlBQVksS0FBSyxhQUFhO0FBRXhDLFdBQUssY0FBYztBQUNuQixXQUFLLFdBQVc7QUFDaEIsV0FBSyxlQUFlO0FBQ3BCO0FBQUEsSUFDRjtBQUVBLFNBQUssZUFBZTtBQUFBLEVBQ3RCO0FBQUEsRUFFUSxhQUFtQjtBQUN6QixVQUFNLFVBQVUsS0FBSztBQUVyQixVQUFNLFNBQVMsU0FBUyxjQUFjLFFBQVE7QUFDOUMsV0FBTyxNQUFNLFVBQVU7QUFDdkIsWUFBUSxZQUFZLE1BQU07QUFFMUIsVUFBTSxNQUFNLE9BQU8sV0FBVyxNQUFNLEVBQUUsT0FBTyxNQUFNLENBQUM7QUFDcEQsUUFBSSxDQUFDO0FBQUssWUFBTSxJQUFJLE1BQU0sa0NBQWtDO0FBRTVELFNBQUssV0FBVztBQUNoQixTQUFLLE1BQU07QUFFWCxTQUFLLGlCQUFpQixJQUFJLGVBQWUsTUFBTTtBQUM3QyxXQUFLLGFBQWE7QUFDbEIsV0FBSyxjQUFjO0FBQUEsSUFDckIsQ0FBQztBQUNELFNBQUssZUFBZSxRQUFRLEtBQUssU0FBUztBQUUxQyxTQUFLLGFBQWE7QUFDbEIsU0FBSyxtQkFBbUI7QUFHeEIsUUFBSSxDQUFDLEtBQUssdUJBQXVCO0FBQy9CLFdBQUssd0JBQXdCLENBQUMsTUFBa0I7QUFDOUMsY0FBTSxRQUFRLEtBQUssVUFBVSxjQUFjLGdCQUFnQjtBQUMzRCxZQUFJLENBQUM7QUFBTztBQUNaLGNBQU0sU0FBUyxFQUFFO0FBQ2pCLFlBQUksVUFBVSxNQUFNLFNBQVMsTUFBTTtBQUFHO0FBSXRDLFlBQUksV0FBVyxLQUFLO0FBQVU7QUFFOUIsYUFBSyxlQUFlO0FBQ3BCLGFBQUssdUJBQXVCO0FBQzVCLGFBQUssZ0JBQWdCLEtBQUssU0FBUztBQUNuQyxhQUFLLGNBQWM7QUFBQSxNQUNyQjtBQUNBLFdBQUssVUFBVSxpQkFBaUIsYUFBYSxLQUFLLHVCQUF1QixJQUFJO0FBQUEsSUFDL0U7QUFFQSxTQUFLLGdCQUFnQjtBQUFBLEVBQ3ZCO0FBQUEsRUFFUSxlQUFxQjtBQUMzQixVQUFNLFNBQVMsS0FBSztBQUNwQixVQUFNLFVBQVUsS0FBSztBQUNyQixRQUFJLENBQUMsVUFBVSxDQUFDO0FBQVM7QUFFekIsVUFBTSxJQUFJLFFBQVEsZUFBZSxLQUFLLFVBQVUsZUFBZTtBQUMvRCxVQUFNLElBQUksUUFBUSxnQkFBZ0IsS0FBSyxVQUFVLGdCQUFnQjtBQUVqRSxTQUFLLE1BQU0sT0FBTyxvQkFBb0I7QUFDdEMsV0FBTyxRQUFRLEtBQUssSUFBSSxHQUFHLEtBQUssTUFBTSxJQUFJLEtBQUssR0FBRyxDQUFDO0FBQ25ELFdBQU8sU0FBUyxLQUFLLElBQUksR0FBRyxLQUFLLE1BQU0sSUFBSSxLQUFLLEdBQUcsQ0FBQztBQUdwRCxVQUFNLE1BQU0sS0FBSztBQUNqQixRQUFJLGFBQWEsS0FBSyxLQUFLLEdBQUcsR0FBRyxLQUFLLEtBQUssR0FBRyxDQUFDO0FBQUEsRUFDakQ7QUFBQTtBQUFBLEVBR1EsaUJBQXVCO0FBQzdCLFFBQUksQ0FBQyxLQUFLO0FBQVc7QUFFckIsVUFBTSxXQUFXLEtBQUssYUFBYSxLQUFLLFNBQVM7QUFDakQsVUFBTSxZQUFZLEtBQUs7QUFDdkIsVUFBTSxRQUFRLFVBQVUsZUFBZTtBQUN2QyxVQUFNLFNBQVMsVUFBVSxnQkFBZ0I7QUFHekMsVUFBTSxnQkFBZ0IsVUFBVSxjQUFjLGlCQUFpQjtBQUMvRCxRQUFJO0FBQWUsb0JBQWMsT0FBTztBQUV4QyxRQUFJLFNBQVMsTUFBTSxXQUFXLEdBQUc7QUFDL0IsVUFBSSxLQUFLO0FBQWUsYUFBSyxjQUFjLE1BQU0sVUFBVTtBQUMzRCxnQkFBVSxTQUFTLE9BQU87QUFBQSxRQUN4QixLQUFLO0FBQUEsUUFDTCxNQUFNO0FBQUEsTUFDUixDQUFDO0FBQ0QsVUFBSSxLQUFLLFlBQVk7QUFBRSxhQUFLLFdBQVcsS0FBSztBQUFHLGFBQUssYUFBYTtBQUFBLE1BQU07QUFDdkU7QUFBQSxJQUNGO0FBQ0EsUUFBSSxLQUFLO0FBQWUsV0FBSyxjQUFjLE1BQU0sVUFBVTtBQUczRCxVQUFNLGVBQWUsb0JBQUksSUFBc0M7QUFDL0QsZUFBVyxLQUFLLEtBQUssVUFBVTtBQUM3QixtQkFBYSxJQUFJLEVBQUUsSUFBSSxFQUFFLEdBQUcsRUFBRSxLQUFLLEdBQUcsR0FBRyxFQUFFLEtBQUssRUFBRSxDQUFDO0FBQUEsSUFDckQ7QUFHQSxVQUFNLGNBQWMsb0JBQUksSUFBWTtBQUNwQyxlQUFXLEtBQUssU0FBUyxPQUFPO0FBQzlCLFdBQUssRUFBRSxlQUFlLE9BQU87QUFBRyxvQkFBWSxJQUFJLEVBQUUsRUFBRTtBQUFBLElBQ3REO0FBS0EsVUFBTSxZQUFZLENBQUMsR0FBRyxTQUFTLEtBQUs7QUFDcEMsVUFBTSxZQUFZLENBQUMsR0FBRyxTQUFTLEtBQUs7QUFFcEMsUUFBSSxLQUFLLE9BQU8sZ0JBQWdCLEtBQUssT0FBTyx5QkFBeUI7QUFDbkUsWUFBTSxlQUFlLENBQUMsV0FBbUIsV0FBVyxNQUFNO0FBQzFELFlBQU0sY0FBYyxDQUFDLFdBQW1CO0FBQ3RDLGNBQU0sVUFBVSxPQUFPLFFBQVEsUUFBUSxFQUFFO0FBQ3pDLFlBQUksQ0FBQyxXQUFXLFlBQVk7QUFBSyxpQkFBTztBQUN4QyxjQUFNLFFBQVEsUUFBUSxNQUFNLEdBQUcsRUFBRSxPQUFPLE9BQU87QUFDL0MsZUFBTyxNQUFNLE1BQU0sU0FBUyxDQUFDLEtBQUs7QUFBQSxNQUNwQztBQUVBLFlBQU0sV0FBVyxJQUFJLElBQUksVUFBVSxJQUFJLENBQUMsTUFBTSxFQUFFLEVBQUUsQ0FBQztBQUNuRCxZQUFNLFVBQVUsSUFBSSxJQUFJLFVBQVUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLEtBQUssSUFBSSxDQUFDLENBQUM7QUFFcEYsaUJBQVcsS0FBSyxTQUFTLE9BQU87QUFDOUIsWUFBSSxDQUFDLFlBQVksSUFBSSxFQUFFLEVBQUU7QUFBRztBQUU1QixZQUFJO0FBRUosWUFBSSxLQUFLLE9BQU8sZ0JBQWdCLEVBQUUsU0FBUyxVQUFVO0FBRW5ELGdCQUFNLGVBQWUsU0FBUyxFQUFFLFFBQVE7QUFDeEMscUJBQVc7QUFFWCxjQUFJLENBQUMsU0FBUyxJQUFJLFFBQVEsR0FBRztBQUMzQixxQkFBUyxJQUFJLFFBQVE7QUFDckIsa0JBQU0sV0FBVyxFQUFFLFNBQVMsTUFBTSxHQUFHLEVBQUUsSUFBSSxHQUFHLFFBQVEsVUFBVSxFQUFFLEtBQUssRUFBRTtBQUN6RSxzQkFBVSxLQUFLO0FBQUEsY0FDYixJQUFJO0FBQUEsY0FDSixPQUFPO0FBQUEsY0FDUCxNQUFNO0FBQUEsY0FDTixVQUFVLEVBQUU7QUFBQSxjQUNaLFdBQVc7QUFBQSxjQUNYLFlBQVksQ0FBQztBQUFBLGNBQ2IsV0FBVztBQUFBLGNBQ1gsYUFBYTtBQUFBLFlBQ2YsQ0FBQztBQUFBLFVBQ0g7QUFBQSxRQUNGLE9BQU87QUFFTCxnQkFBTSxPQUFPLEVBQUUsWUFBWTtBQUMzQixnQkFBTSxNQUFNLEtBQUssWUFBWSxHQUFHO0FBQ2hDLGdCQUFNLFNBQVMsTUFBTSxJQUFJLEtBQUssTUFBTSxHQUFHLEdBQUcsSUFBSTtBQUM5QyxxQkFBVyxhQUFhLE1BQU07QUFFOUIsY0FBSSxDQUFDLFNBQVMsSUFBSSxRQUFRLEdBQUc7QUFDM0IscUJBQVMsSUFBSSxRQUFRO0FBQ3JCLHNCQUFVLEtBQUs7QUFBQSxjQUNiLElBQUk7QUFBQSxjQUNKLE9BQU8sWUFBWSxNQUFNO0FBQUEsY0FDekIsTUFBTTtBQUFBLGNBQ04sVUFBVSxTQUFTO0FBQUEsY0FDbkIsV0FBVyxZQUFZLE1BQU07QUFBQSxjQUM3QixZQUFZLENBQUM7QUFBQSxjQUNiLFdBQVc7QUFBQSxjQUNYLGFBQWE7QUFBQSxZQUNmLENBQUM7QUFBQSxVQUNIO0FBQUEsUUFDRjtBQUVBLGNBQU0sU0FBUyxDQUFDLEVBQUUsSUFBSSxRQUFRLEVBQUUsS0FBSyxFQUFFLEtBQUssSUFBSTtBQUNoRCxZQUFJLENBQUMsUUFBUSxJQUFJLE1BQU0sR0FBRztBQUN4QixrQkFBUSxJQUFJLE1BQU07QUFDbEIsb0JBQVUsS0FBSyxFQUFFLFFBQVEsRUFBRSxJQUFJLFFBQVEsVUFBVSxVQUFVLE9BQU8sQ0FBQztBQUFBLFFBQ3JFO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFFQSxVQUFNLFdBQVcsb0JBQUksSUFBcUI7QUFFMUMsU0FBSyxXQUFXLFVBQVUsSUFBSSxDQUFDLE1BQU07QUFDbkMsWUFBTSxNQUFNLGFBQWEsSUFBSSxFQUFFLEVBQUU7QUFDakMsWUFBTSxZQUFZLEVBQUUsU0FBUyxXQUFXLE1BQU07QUFDOUMsWUFBTSxPQUFnQjtBQUFBLFFBQ3BCLEdBQUk7QUFBQSxRQUNKLFVBQVUsWUFBWSxJQUFJLEVBQUUsRUFBRTtBQUFBLFFBQzlCLEdBQUcsTUFBTSxJQUFJLEtBQUssS0FBSyxPQUFPLElBQUksT0FBTyxRQUFRO0FBQUEsUUFDakQsR0FBRyxNQUFNLElBQUksS0FBSyxLQUFLLE9BQU8sSUFBSSxPQUFPLFNBQVM7QUFBQSxRQUNsRCxJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixJQUFJO0FBQUEsUUFDSixRQUFRLEtBQUssY0FBYyxDQUFDO0FBQUEsUUFDNUIsT0FBTztBQUFBLFFBQ1AsYUFBYTtBQUFBLE1BQ2Y7QUFDQSxlQUFTLElBQUksS0FBSyxJQUFJLElBQUk7QUFDMUIsYUFBTztBQUFBLElBQ1QsQ0FBQztBQUVELFNBQUssV0FBVyxVQUNiLElBQUksQ0FBQyxNQUFNO0FBQ1YsWUFBTSxJQUFJLFNBQVMsSUFBSSxFQUFFLE1BQU07QUFDL0IsWUFBTSxJQUFJLFNBQVMsSUFBSSxFQUFFLE1BQU07QUFDL0IsVUFBSSxDQUFDLEtBQUssQ0FBQztBQUFHLGVBQU87QUFDckIsWUFBTSxZQUFZLEVBQUUsYUFBYSxTQUFTLE9BQU87QUFDakQsWUFBTSxPQUFnQjtBQUFBLFFBQ3BCLFFBQVE7QUFBQSxRQUNSLFFBQVE7QUFBQSxRQUNSLFVBQVUsRUFBRTtBQUFBLFFBQ1osT0FBTztBQUFBLFFBQ1AsYUFBYTtBQUFBLE1BQ2Y7QUFDQSxhQUFPO0FBQUEsSUFDVCxDQUFDLEVBQ0EsT0FBTyxDQUFDLE1BQW9CLE1BQU0sSUFBSTtBQUV6QyxTQUFLLGNBQWM7QUFDbkIsU0FBSyxlQUFlO0FBQ3BCLFNBQUssV0FBVztBQUVoQixTQUFLLGdCQUFnQjtBQUNyQixTQUFLLHVCQUF1QjtBQUM1QixTQUFLLGNBQWM7QUFBQSxFQUNyQjtBQUFBLEVBRVEsa0JBQXdCO0FBRTlCLFFBQUksS0FBSyxZQUFZO0FBQ25CLFdBQUssV0FBVyxLQUFLO0FBQ3JCLFdBQUssV0FBVyxHQUFHLFFBQVEsSUFBSTtBQUMvQixXQUFLLGFBQWE7QUFBQSxJQUNwQjtBQUVBLFVBQU0sTUFBTSxtQkFBa0MsS0FBSyxRQUFRLEVBQ3hELE1BQU0sQ0FBQyxFQUNQLFlBQVksQ0FBQyxFQUNiLFdBQVcsTUFBTSxFQUNqQixTQUFTLElBQUssRUFDZCxjQUFjLEdBQUc7QUFFcEIsVUFBTSxZQUFZLGFBQTRCLEtBQUssUUFBUSxFQUN4RCxTQUFTLEtBQUssT0FBTyxZQUFZLEVBQ2pDLFNBQVMsR0FBRztBQUdmLFVBQU0sY0FBYyxpQkFBdUIsRUFDeEMsU0FBUyxDQUFDLEtBQUssT0FBTyxhQUFhLEVBQ25DLFlBQVksS0FBSyxJQUFJLEtBQUssT0FBTyxnQkFBZ0IsR0FBRyxHQUFHLENBQUM7QUFHM0QsVUFBTSxVQUFVSSxXQUFnQixDQUFDLEVBQUUsU0FBUyxLQUFLLE9BQU8sY0FBYztBQUN0RSxVQUFNLFVBQVVDLFdBQWdCLENBQUMsRUFBRSxTQUFTLEtBQUssT0FBTyxjQUFjO0FBR3RFLFVBQU0sVUFBVSxnQkFBc0IsQ0FBQyxNQUFNLEVBQUUsU0FBUyxFQUFFLEVBQ3ZELFNBQVMsSUFBSSxFQUNiLFdBQVcsQ0FBQztBQUVmLFFBQ0csTUFBTSxRQUFRLFNBQVMsRUFDdkIsTUFBTSxVQUFVLFdBQVcsRUFDM0IsTUFBTSxXQUFXLE9BQU8sRUFDeEIsTUFBTSxXQUFXLE9BQU8sRUFDeEIsTUFBTSxXQUFXLE9BQU87QUFFM0IsUUFBSSxHQUFHLFFBQVEsTUFBTTtBQUNuQixXQUFLLGNBQWM7QUFBQSxJQUNyQixDQUFDO0FBRUQsU0FBSyxhQUFhO0FBQUEsRUFDcEI7QUFBQTtBQUFBLEVBR1EsbUJBQW1CLFdBQThCO0FBQ3ZELFVBQU0sTUFBTSxLQUFLO0FBQ2pCLFNBQUssU0FBUztBQUVkLFVBQU0sZ0JBQ0osSUFBSSxjQUFjLFVBQVUsYUFDNUIsSUFBSSxnQkFBZ0IsVUFBVSxlQUM5QixJQUFJLGtCQUFrQixVQUFVLGlCQUNoQyxJQUFJLG9CQUFvQixVQUFVLG1CQUNsQyxJQUFJLGdCQUFnQixVQUFVLGVBQzlCLElBQUksNEJBQTRCLFVBQVUsMkJBQzFDLElBQUksaUJBQWlCLFVBQVUsZ0JBQy9CLElBQUksV0FBVyxVQUFVLFVBQ3pCLElBQUksZUFBZSxVQUFVLGNBQzdCLElBQUksaUJBQWlCLFVBQVU7QUFFakMsUUFBSSxlQUFlO0FBQ2pCLFdBQUssZUFBZTtBQUNwQjtBQUFBLElBQ0Y7QUFHQSxlQUFXLEtBQUssS0FBSyxVQUFVO0FBQzdCLFFBQUUsU0FBUyxLQUFLLGNBQWMsQ0FBQztBQUFBLElBQ2pDO0FBR0EsUUFBSSxLQUFLLFlBQVk7QUFDbkIsWUFBTSxPQUFPLEtBQUssV0FBVyxNQUFNLE1BQU07QUFDekMsWUFBTSxXQUFXLFVBQVUsWUFBWTtBQUV2QyxZQUFNLFNBQVMsS0FBSyxXQUFXLE1BQU0sUUFBUTtBQUM3QyxjQUFRLFdBQVcsQ0FBQyxVQUFVLGFBQWE7QUFDM0MsY0FBUSxjQUFjLEtBQUssSUFBSSxVQUFVLGdCQUFnQixHQUFHLEdBQUcsQ0FBQztBQUVoRSxZQUFNLEtBQUssS0FBSyxXQUFXLE1BQU0sU0FBUztBQUMxQyxVQUFJLFdBQVcsVUFBVSxjQUFjO0FBQ3ZDLFlBQU0sS0FBSyxLQUFLLFdBQVcsTUFBTSxTQUFTO0FBQzFDLFVBQUksV0FBVyxVQUFVLGNBQWM7QUFFdkMsWUFBTSxVQUFVLEtBQUssV0FBVyxNQUFNLFNBQVM7QUFDL0MsZUFBUyxTQUFTLENBQUMsTUFBZSxFQUFFLFNBQVMsRUFBRTtBQUUvQyxXQUFLLFdBQVcsTUFBTSxLQUFLLElBQUksS0FBSyxXQUFXLE1BQU0sR0FBRyxHQUFHLENBQUMsRUFBRSxRQUFRO0FBQUEsSUFDeEU7QUFFQSxTQUFLLHVCQUF1QjtBQUM1QixTQUFLLGNBQWM7QUFBQSxFQUNyQjtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBTVEsUUFBYztBQUNwQixVQUFNLE1BQU0sS0FBSztBQUNqQixVQUFNLFNBQVMsS0FBSztBQUNwQixRQUFJLENBQUMsT0FBTyxDQUFDO0FBQVE7QUFDckIsVUFBTSxJQUFJLE9BQU87QUFDakIsVUFBTSxJQUFJLE9BQU87QUFDakIsUUFBSSxLQUFLO0FBQ1QsUUFBSSxhQUFhLEtBQUssS0FBSyxHQUFHLEdBQUcsS0FBSyxLQUFLLEdBQUcsQ0FBQztBQUMvQyxRQUFJLFlBQVksV0FBVyxLQUFLLE9BQU87QUFDdkMsUUFBSSxjQUFjO0FBQ2xCLFFBQUksU0FBUyxHQUFHLEdBQUcsR0FBRyxDQUFDO0FBQ3ZCLFFBQUksUUFBUTtBQUFBLEVBQ2Q7QUFBQSxFQUVRLE9BQWE7QUFDbkIsUUFBSSxDQUFDLEtBQUssT0FBTyxDQUFDLEtBQUs7QUFBVTtBQUdqQyxTQUFLLGNBQWM7QUFFbkIsU0FBSyxNQUFNO0FBRVgsUUFBSSxLQUFLLFNBQVMsV0FBVztBQUFHO0FBRWhDLFNBQUssVUFBVTtBQUNmLFNBQUssVUFBVTtBQUNmLFNBQUssV0FBVztBQUFBLEVBQ2xCO0FBQUEsRUFFUSxZQUFrQjtBQUN4QixVQUFNLE1BQU0sS0FBSztBQUNqQixVQUFNLFNBQVMsS0FBSztBQUNwQixVQUFNLElBQUksT0FBTztBQUNqQixVQUFNLElBQUksT0FBTztBQUNqQixVQUFNLFFBQVEsSUFBSTtBQUNsQixVQUFNLFFBQVEsSUFBSTtBQUVsQixRQUFJLEtBQUssU0FBUyxXQUFXO0FBQUc7QUFFaEMsUUFBSSxLQUFLO0FBQ1QsUUFBSSxZQUFZO0FBQ2hCLFFBQUksVUFBVTtBQUVkLGVBQVcsS0FBSyxLQUFLLFVBQVU7QUFDN0IsWUFBTSxJQUFJLEVBQUU7QUFDWixZQUFNLElBQUksRUFBRTtBQUVaLFlBQU0sTUFBTSxFQUFFLEtBQUs7QUFDbkIsWUFBTSxNQUFNLEVBQUUsS0FBSztBQUNuQixZQUFNLE1BQU0sRUFBRSxLQUFLO0FBQ25CLFlBQU0sTUFBTSxFQUFFLEtBQUs7QUFFbkIsWUFBTSxNQUFNLE1BQU0sS0FBSyxRQUFRLEtBQUssV0FBVztBQUMvQyxZQUFNLE1BQU0sTUFBTSxLQUFLLFFBQVEsS0FBSyxXQUFXO0FBQy9DLFlBQU0sTUFBTSxNQUFNLEtBQUssUUFBUSxLQUFLLFdBQVc7QUFDL0MsWUFBTSxNQUFNLE1BQU0sS0FBSyxRQUFRLEtBQUssV0FBVztBQUUvQyxZQUFNLFNBQVMsRUFBRSxhQUFhO0FBQzlCLFlBQU0sTUFBTSxTQUFTLEtBQUssZ0JBQWdCLEtBQUs7QUFFL0MsVUFBSSxjQUFjLFdBQVcsR0FBRztBQUNoQyxVQUFJLGNBQWMsRUFBRTtBQUNwQixVQUFJLFVBQVU7QUFDZCxVQUFJLE9BQU8sSUFBSSxFQUFFO0FBQ2pCLFVBQUksT0FBTyxJQUFJLEVBQUU7QUFDakIsVUFBSSxPQUFPO0FBQUEsSUFDYjtBQUVBLFFBQUksUUFBUTtBQUFBLEVBQ2Q7QUFBQSxFQUVRLFlBQWtCO0FBQ3hCLFVBQU0sTUFBTSxLQUFLO0FBQ2pCLFVBQU0sU0FBUyxLQUFLO0FBQ3BCLFVBQU0sSUFBSSxPQUFPO0FBQ2pCLFVBQU0sSUFBSSxPQUFPO0FBQ2pCLFVBQU0sUUFBUSxJQUFJO0FBQ2xCLFVBQU0sUUFBUSxJQUFJO0FBQ2xCLFVBQU0sUUFBUSxLQUFLLGVBQWUsS0FBSztBQUV2QyxRQUFJLEtBQUs7QUFFVCxlQUFXLEtBQUssS0FBSyxVQUFVO0FBQzdCLFlBQU0sTUFBTSxFQUFFLEtBQUs7QUFDbkIsWUFBTSxNQUFNLEVBQUUsS0FBSztBQUduQixZQUFNLFdBQVcsQ0FBQyxDQUFDLEVBQUU7QUFFckIsVUFBSTtBQUNKLFVBQUksU0FBUyxNQUFNLE9BQU87QUFDeEIsY0FBTSxXQUFXLEtBQUssZ0JBQWdCLEtBQUs7QUFBQSxNQUM3QyxPQUFPO0FBQ0wsY0FBTSxXQUFXLEtBQUssZ0JBQWdCLEtBQUs7QUFBQSxNQUM3QztBQUVBLFlBQU0sTUFBTSxNQUFNLEtBQUssUUFBUSxLQUFLLFdBQVc7QUFDL0MsWUFBTSxNQUFNLE1BQU0sS0FBSyxRQUFRLEtBQUssV0FBVztBQUcvQyxZQUFNLE9BQU8sS0FBSyxJQUFJLEdBQUcsS0FBSyxPQUFPLG1CQUFtQjtBQUN4RCxZQUFNLElBQUksS0FBSyxJQUFJLE1BQU0sRUFBRSxTQUFTLEtBQUssUUFBUTtBQUVqRCxVQUFJLFlBQVksV0FBVyxHQUFHO0FBQzlCLFVBQUksY0FBYyxFQUFFO0FBQ3BCLFVBQUksVUFBVTtBQUNkLFVBQUksSUFBSSxJQUFJLElBQUksR0FBRyxHQUFHLEtBQUssS0FBSyxDQUFDO0FBQ2pDLFVBQUksS0FBSztBQUFBLElBQ1g7QUFFQSxRQUFJLFFBQVE7QUFBQSxFQUNkO0FBQUEsRUFFUSxhQUFtQjtBQUN6QixVQUFNLE1BQU0sS0FBSztBQUNqQixVQUFNLFNBQVMsS0FBSztBQUNwQixVQUFNLElBQUksT0FBTztBQUNqQixVQUFNLElBQUksT0FBTztBQUNqQixVQUFNLFFBQVEsSUFBSTtBQUNsQixVQUFNLFFBQVEsSUFBSTtBQUVsQixVQUFNLGVBQWUsS0FBSyxPQUFPO0FBQ2pDLFVBQU0sYUFBYSxLQUFLO0FBR3hCLFVBQU0sZUFBZTtBQUNyQixVQUFNLFdBQVcsS0FBSyxJQUFJLEdBQUcsS0FBSyxJQUFJLElBQUksZUFBZSxLQUFLLEtBQUssVUFBVSxDQUFDLENBQUM7QUFDL0UsVUFBTSxVQUFVLEtBQUssSUFBSSxHQUFHLEtBQUssT0FBTyxZQUFZO0FBQ3BELFVBQU0sV0FBVyxjQUFjO0FBRS9CLFFBQUksQ0FBQztBQUFVO0FBRWYsUUFBSSxLQUFLO0FBQ1QsUUFBSSxPQUFPLEdBQUcsUUFBUTtBQUN0QixRQUFJLFlBQVk7QUFDaEIsUUFBSSxlQUFlO0FBQ25CLFFBQUksWUFBWSxLQUFLO0FBRXJCLFVBQU0sY0FBcUUsQ0FBQztBQUM1RSxVQUFNLGFBQWEsQ0FBQyxJQUFTLE9BQzNCLEdBQUcsSUFBSSxHQUFHLElBQUksR0FBRyxLQUFLLEdBQUcsSUFBSSxHQUFHLElBQUksR0FBRyxLQUFLLEdBQUcsSUFBSSxHQUFHLElBQUksR0FBRyxLQUFLLEdBQUcsSUFBSSxHQUFHLElBQUksR0FBRztBQUdyRixVQUFNLGVBQWUsQ0FBQyxHQUFHLEtBQUssUUFBUSxFQUFFLEtBQUssQ0FBQ0osSUFBRyxNQUFNO0FBQ3JELFVBQUksRUFBRSxVQUFVQSxHQUFFO0FBQU8sZUFBTyxFQUFFLFFBQVFBLEdBQUU7QUFDNUMsY0FBUSxFQUFFLGVBQWUsTUFBTUEsR0FBRSxlQUFlO0FBQUEsSUFDbEQsQ0FBQztBQUVELFVBQU0sT0FBTyxLQUFLLElBQUksSUFBSSxLQUFLLE9BQU8saUJBQWlCLEdBQUc7QUFDMUQsVUFBTSxXQUFXO0FBRWpCLGVBQVcsS0FBSyxjQUFjO0FBQzVCLFlBQU0sTUFBTSxFQUFFLEtBQUs7QUFDbkIsWUFBTSxNQUFNLEVBQUUsS0FBSztBQUNuQixZQUFNLE1BQU0sTUFBTSxLQUFLLFFBQVEsS0FBSyxXQUFXO0FBQy9DLFlBQU0sTUFBTSxNQUFNLEtBQUssUUFBUSxLQUFLLFdBQVc7QUFDL0MsWUFBTSxVQUFVLEtBQUssRUFBRSxTQUFTLEtBQUssV0FBVztBQUdoRCxVQUFJLEtBQUssUUFBUSxLQUFLLElBQUksT0FBTyxLQUFLLFFBQVEsS0FBSyxJQUFJO0FBQUs7QUFFNUQsVUFBSTtBQUNKLFVBQUksRUFBRSxjQUFjLEtBQUs7QUFDdkIsZ0JBQVEsS0FBSyxJQUFJLGNBQWMsRUFBRSxLQUFLLElBQUk7QUFBQSxNQUM1QyxPQUFPO0FBQ0wsZ0JBQVEsZ0JBQWdCLEVBQUUsUUFBUSxLQUFLLElBQUksTUFBUSxFQUFFLFdBQVc7QUFDaEUsWUFBSSxPQUFPLEtBQUssZUFBZSxLQUFLO0FBQWUsa0JBQVE7QUFBQSxNQUM3RDtBQUVBLFVBQUksUUFBUTtBQUFNO0FBR2xCLFlBQU0sT0FBTyxFQUFFO0FBQ2YsVUFBSSxRQUFRO0FBQ1osVUFBSSxJQUFJLFlBQVksSUFBSSxFQUFFLFFBQVEsTUFBTTtBQUN0QyxZQUFJLEtBQUssR0FBRyxLQUFLLEtBQUs7QUFDdEIsZUFBTyxLQUFLLElBQUk7QUFDZCxnQkFBTSxNQUFNLEtBQUssTUFBTSxLQUFLLE1BQU0sQ0FBQztBQUNuQyxnQkFBTSxZQUFZLEtBQUssTUFBTSxHQUFHLEdBQUcsSUFBSTtBQUN2QyxjQUFJLElBQUksWUFBWSxTQUFTLEVBQUUsU0FBUztBQUFNLGlCQUFLO0FBQUE7QUFDOUMsaUJBQUssTUFBTTtBQUFBLFFBQ2xCO0FBQ0EsZ0JBQVEsS0FBSyxNQUFNLEdBQUcsS0FBSyxJQUFJLEdBQUcsRUFBRSxDQUFDLElBQUk7QUFBQSxNQUMzQztBQUVBLFlBQU0sVUFBVSxJQUFJLFlBQVksS0FBSztBQUNyQyxZQUFNLFFBQVEsUUFBUTtBQUN0QixZQUFNLFFBQVE7QUFFZCxZQUFNLE1BQU07QUFDWixZQUFNLE9BQU87QUFBQSxRQUNYLEdBQUcsS0FBSyxRQUFRLElBQUk7QUFBQSxRQUNwQixHQUFHLFVBQVU7QUFBQSxRQUNiLEdBQUcsUUFBUSxNQUFNO0FBQUEsUUFDakIsR0FBRyxRQUFRLE1BQU07QUFBQSxNQUNuQjtBQUVBLFVBQUksV0FBVztBQUNmLGlCQUFXLEtBQUssYUFBYTtBQUMzQixZQUFJLFdBQVcsTUFBTSxDQUFDLEdBQUc7QUFBRSxxQkFBVztBQUFNO0FBQUEsUUFBTztBQUFBLE1BQ3JEO0FBRUEsWUFBTSxVQUFVLE9BQU8sS0FBSyxlQUFlLEtBQUs7QUFDaEQsVUFBSSxDQUFDLFdBQVc7QUFBVTtBQUUxQixVQUFJLGNBQWM7QUFDbEIsVUFBSSxTQUFTLE9BQU8sSUFBSSxPQUFPO0FBQy9CLGtCQUFZLEtBQUssSUFBSTtBQUFBLElBQ3ZCO0FBRUEsUUFBSSxRQUFRO0FBQUEsRUFDZDtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBTVEscUJBQTJCO0FBQ2pDLFVBQU0sU0FBUyxLQUFLO0FBQ3BCLFVBQU0sWUFBWSxLQUFLO0FBSXZCLFVBQU0sdUJBQXVCLENBQUMsR0FBUSxnQkFBK0I7QUFDbkUsWUFBTSxJQUFJLE9BQU87QUFDakIsWUFBTSxJQUFJLE9BQU87QUFDakIsWUFBTSxJQUFJLEtBQUssSUFBSSxNQUFNLEtBQUssSUFBSSxJQUFJLEVBQUUsQ0FBQyxDQUFDO0FBQzFDLFlBQU1LLEtBQUksRUFBRTtBQUNaLFlBQU1DLEtBQUksRUFBRTtBQUtaLFlBQU0sUUFBUSxJQUFJLElBQUlELE1BQUs7QUFDM0IsWUFBTSxRQUFRLElBQUksSUFBSUMsTUFBSztBQUUzQixXQUFLLGdCQUFnQjtBQUNyQixXQUFLLGlCQUFpQjtBQUN0QixXQUFLLGFBQWE7QUFDbEIsV0FBSyxhQUFhO0FBR2xCLFlBQU0sS0FBVTtBQUNoQixZQUFNLFVBQVUsSUFBSSxTQUFTO0FBQzdCLFVBQUksQ0FBQyxTQUFTO0FBQ1osYUFBSyxXQUFXLEtBQUs7QUFDckIsYUFBSyxPQUFPLEtBQUs7QUFDakIsYUFBSyxPQUFPLEtBQUs7QUFBQSxNQUNuQjtBQUVBLFdBQUssY0FBYztBQUFBLElBQ3JCO0FBR0EsUUFBSSxDQUFDLEtBQUssY0FBYztBQUN0QixXQUFLLGVBQWVDLGNBQWlDLEVBQ2xELFlBQVksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUN0QixPQUFPLENBQUMsVUFBZTtBQUV0QixZQUFJLEtBQUs7QUFBVSxpQkFBTztBQUUxQixZQUFJLE9BQU8sTUFBTSxXQUFXLE9BQU8sS0FBSyxNQUFNLFdBQVc7QUFBRyxpQkFBTztBQUNuRSxlQUFPO0FBQUEsTUFDVCxDQUFDLEVBQ0EsR0FBRyxRQUFRLENBQUMsVUFBZTtBQUMxQixZQUFJLEtBQUs7QUFBZTtBQUN4Qiw2QkFBcUIsTUFBTSxXQUFXLE1BQU0sV0FBVztBQUFBLE1BQ3pELENBQUM7QUFFSCxZQUFNLE1BQU1DLGdCQUFPLE1BQU07QUFDekIsVUFBSSxLQUFLLEtBQUssWUFBbUI7QUFFakMsVUFBSSxHQUFHLGlCQUFpQixJQUFJO0FBRzVCLFlBQU0sSUFBSSxPQUFPO0FBQ2pCLFlBQU0sSUFBSSxPQUFPO0FBQ2pCLFlBQU0sSUFBSSxLQUFLO0FBQ2YsWUFBTUgsS0FBSSxDQUFDLEtBQUssYUFBYSxJQUFJLElBQUk7QUFDckMsWUFBTUMsS0FBSSxDQUFDLEtBQUssYUFBYSxJQUFJLElBQUk7QUFDckMsV0FBSyxnQkFBZ0I7QUFDckIsVUFBSTtBQUNGLFlBQUksS0FBTSxLQUFLLGFBQXFCLFdBQVdMLFVBQWEsVUFBVUksSUFBR0MsRUFBQyxFQUFFLE1BQU0sQ0FBQyxDQUFDO0FBQUEsTUFDdEYsVUFBRTtBQUNBLGFBQUssZ0JBQWdCO0FBQUEsTUFDdkI7QUFBQSxJQUNGO0FBR0EsUUFBSSxRQUFRO0FBQ1osUUFBSSxRQUFRO0FBQ1osUUFBSSxXQUEyQjtBQUUvQixTQUFLLGVBQWUsQ0FBQyxNQUFrQjtBQUNyQyxVQUFJLEVBQUUsV0FBVztBQUFHO0FBQ3BCLFlBQU0sT0FBTyxPQUFPLHNCQUFzQjtBQUMxQyxZQUFNLEtBQUssRUFBRSxVQUFVLEtBQUs7QUFDNUIsWUFBTSxLQUFLLEVBQUUsVUFBVSxLQUFLO0FBQzVCLGNBQVEsRUFBRTtBQUNWLGNBQVEsRUFBRTtBQUNWLGlCQUFXLEtBQUssWUFBWSxJQUFJLEVBQUU7QUFFbEMsVUFBSSxVQUFVO0FBRVosVUFBRSxnQkFBZ0I7QUFFbEIsYUFBSyxXQUFXO0FBQ2hCLGFBQUssYUFBYTtBQUNsQixpQkFBUyxLQUFLLFNBQVMsS0FBSztBQUM1QixpQkFBUyxLQUFLLFNBQVMsS0FBSztBQUU1QixhQUFLLFlBQVksWUFBWSxJQUFJLEVBQUUsUUFBUTtBQUFBLE1BQzdDO0FBQUEsSUFDRjtBQUNBLFdBQU8saUJBQWlCLGFBQWEsS0FBSyxjQUFjLEVBQUUsU0FBUyxLQUFLLENBQUM7QUFHekUsU0FBSyxlQUFlLENBQUMsTUFBa0I7QUFDckMsWUFBTSxPQUFPLE9BQU8sc0JBQXNCO0FBQzFDLFlBQU0sS0FBSyxFQUFFLFVBQVUsS0FBSztBQUM1QixZQUFNLEtBQUssRUFBRSxVQUFVLEtBQUs7QUFFNUIsVUFBSSxLQUFLLFVBQVU7QUFDakIsYUFBSyxhQUFhO0FBQ2xCLGNBQU0sQ0FBQyxJQUFJLEVBQUUsSUFBSSxLQUFLLGNBQWMsSUFBSSxFQUFFO0FBRTFDLGNBQU0sSUFBSTtBQUNWLGFBQUssU0FBUyxLQUFLLEtBQUssS0FBSyxTQUFTLE1BQU0sSUFBSSxJQUFJLENBQUM7QUFDckQsYUFBSyxTQUFTLEtBQUssS0FBSyxLQUFLLFNBQVMsTUFBTSxJQUFJLElBQUksQ0FBQztBQUNyRCxhQUFLLGNBQWM7QUFDbkI7QUFBQSxNQUNGO0FBR0EsWUFBTSxPQUFPLEtBQUssWUFBWSxJQUFJLEVBQUU7QUFDcEMsVUFBSSxTQUFTLEtBQUssYUFBYTtBQUM3QixhQUFLLGNBQWM7QUFDbkIsZUFBTyxNQUFNLFNBQVMsT0FBTyxZQUFZO0FBQ3pDLGFBQUssdUJBQXVCO0FBRTVCLFlBQUksTUFBTTtBQUNSLGVBQUssWUFBWSxNQUFNLFNBQVM7QUFBQSxRQUNsQyxPQUFPO0FBQ0wsZUFBSyxZQUFZLFNBQVM7QUFBQSxRQUM1QjtBQUFBLE1BQ0YsV0FBVyxNQUFNO0FBQ2YsYUFBSyxZQUFZLEdBQUcsU0FBUztBQUFBLE1BQy9CO0FBQUEsSUFDRjtBQUNBLFdBQU8saUJBQWlCLGFBQWEsS0FBSyxZQUFZO0FBR3RELFNBQUssYUFBYSxDQUFDLE1BQWtCO0FBQ25DLFlBQU0sT0FBTyxLQUFLLElBQUksRUFBRSxVQUFVLEtBQUs7QUFDdkMsWUFBTSxPQUFPLEtBQUssSUFBSSxFQUFFLFVBQVUsS0FBSztBQUN2QyxZQUFNLFVBQVUsT0FBTyxLQUFLLE9BQU87QUFFbkMsVUFBSSxLQUFLLFVBQVU7QUFDakIsY0FBTSxjQUFjLEtBQUs7QUFDekIsYUFBSyxTQUFTLEtBQUs7QUFDbkIsYUFBSyxTQUFTLEtBQUs7QUFFbkIsWUFBSSxDQUFDLGFBQWE7QUFDaEIsZ0JBQU1HLE9BQU0sS0FBSyxJQUFJO0FBQ3JCLGdCQUFNLE9BQU8sS0FBSztBQUVsQixjQUFJLEtBQUssZ0JBQWdCLEtBQUssTUFBTUEsT0FBTSxLQUFLLGdCQUFnQixLQUFLO0FBQ2xFLGdCQUFJLEtBQUssU0FBUyxZQUFZLEtBQUssa0JBQWtCO0FBQ25ELG1CQUFLLGlCQUFpQixLQUFLLFVBQVUsS0FBSyxTQUFTO0FBQUEsWUFDckQsV0FBVyxLQUFLLFNBQVMsVUFBVSxLQUFLLGdCQUFnQjtBQUN0RCxtQkFBSyxlQUFlLEtBQUssUUFBUTtBQUFBLFlBQ25DO0FBQ0EsaUJBQUssZ0JBQWdCO0FBQ3JCLGlCQUFLLGNBQWM7QUFBQSxVQUNyQixPQUFPO0FBQ0wsaUJBQUssZ0JBQWdCQTtBQUNyQixpQkFBSyxjQUFjLEtBQUs7QUFDeEIsaUJBQUssZUFBZTtBQUNwQixpQkFBSyx1QkFBdUI7QUFDNUIsaUJBQUssY0FBYyxNQUFNLFNBQVM7QUFBQSxVQUNwQztBQUFBLFFBQ0Y7QUFFQSxhQUFLLFdBQVc7QUFDaEIsYUFBSyxhQUFhO0FBQ2xCLGFBQUssWUFBWSxZQUFZLENBQUM7QUFDOUI7QUFBQSxNQUNGO0FBR0EsVUFBSSxXQUFXLENBQUMsVUFBVTtBQUN4QixhQUFLLGVBQWU7QUFDcEIsYUFBSyx1QkFBdUI7QUFDNUIsYUFBSyxnQkFBZ0IsU0FBUztBQUFBLE1BQ2hDO0FBQUEsSUFDRjtBQUNBLFdBQU8saUJBQWlCLFdBQVcsS0FBSyxVQUFVO0FBR2xELFNBQUssY0FBYyxDQUFDLE1BQWtCO0FBQUUsUUFBRSxlQUFlO0FBQUEsSUFBRztBQUM1RCxXQUFPLGlCQUFpQixZQUFZLEtBQUssV0FBVztBQUFBLEVBQ3REO0FBQUE7QUFBQSxFQUlRLFlBQVksTUFBZSxXQUE4QjtBQUMvRCxRQUFJLFVBQVUsU0FBUyxLQUFLLGNBQWMsYUFBYTtBQUN2RCxRQUFJLENBQUMsU0FBUztBQUNaLGdCQUFVLFNBQVMsY0FBYyxLQUFLO0FBQ3RDLGNBQVEsWUFBWTtBQUNwQixlQUFTLEtBQUssWUFBWSxPQUFPO0FBQUEsSUFDbkM7QUFDQSxZQUFRLGNBQWMsS0FBSztBQUMzQixZQUFRLE1BQU0sVUFBVTtBQUFBLEVBQzFCO0FBQUEsRUFFUSxZQUFZLEdBQWUsV0FBOEI7QUFDL0QsVUFBTSxVQUFVLFNBQVMsS0FBSyxjQUFjLGFBQWE7QUFDekQsUUFBSSxDQUFDO0FBQVM7QUFFZCxVQUFNLEtBQUssUUFBUTtBQUNuQixVQUFNLEtBQUssUUFBUTtBQUNuQixVQUFNLE1BQU07QUFDWixVQUFNLEtBQUssT0FBTztBQUNsQixVQUFNLEtBQUssT0FBTztBQUVsQixRQUFJLE9BQU8sRUFBRSxVQUFVO0FBQ3ZCLFFBQUksTUFBTSxFQUFFLFVBQVU7QUFHdEIsUUFBSSxPQUFPLEtBQUssTUFBTSxJQUFJO0FBQ3hCLGFBQU8sRUFBRSxVQUFVLEtBQUs7QUFBQSxJQUMxQjtBQUNBLFdBQU8sS0FBSyxJQUFJLEtBQUssS0FBSyxJQUFJLE1BQU0sS0FBSyxLQUFLLEdBQUcsQ0FBQztBQUNsRCxVQUFNLEtBQUssSUFBSSxLQUFLLEtBQUssSUFBSSxLQUFLLEtBQUssS0FBSyxHQUFHLENBQUM7QUFFaEQsWUFBUSxNQUFNLE9BQU8sT0FBTztBQUM1QixZQUFRLE1BQU0sTUFBTSxNQUFNO0FBQUEsRUFDNUI7QUFBQSxFQUVRLFlBQVksV0FBOEI7QUFDaEQsVUFBTSxVQUFVLFNBQVMsS0FBSyxjQUFjLGFBQWE7QUFDekQsUUFBSTtBQUFTLGNBQVEsTUFBTSxVQUFVO0FBQUEsRUFDdkM7QUFBQTtBQUFBLEVBSVEsZ0JBQWdCLFdBQThCO0FBQ3BELFVBQU0sUUFBUSxVQUFVLGNBQWMsZ0JBQWdCO0FBQ3RELFFBQUk7QUFBTyxZQUFNLE9BQU87QUFBQSxFQUMxQjtBQUFBLEVBRVEsY0FBYyxHQUFZLFdBQThCO0FBQzlELFNBQUssZ0JBQWdCLFNBQVM7QUFFOUIsVUFBTSxRQUFRLFNBQVMsY0FBYyxLQUFLO0FBQzFDLFVBQU0sWUFBWTtBQUVsQixVQUFNLFFBQVEsU0FBUyxjQUFjLEtBQUs7QUFDMUMsVUFBTSxZQUFZO0FBQ2xCLFVBQU0sY0FBYyxFQUFFO0FBQ3RCLFVBQU0sWUFBWSxLQUFLO0FBRXZCLFVBQU0sUUFBUSxTQUFTLGNBQWMsS0FBSztBQUMxQyxVQUFNLFlBQVksNkJBQTZCLEVBQUUsSUFBSTtBQUNyRCxVQUFNLGNBQWMsRUFBRSxTQUFTLFdBQVcsV0FBVztBQUNyRCxVQUFNLFlBQVksS0FBSztBQUV2QixVQUFNLFdBQVcsU0FBUyxjQUFjLEtBQUs7QUFDN0MsYUFBUyxZQUFZO0FBQ3JCLGFBQVMsY0FBYyxFQUFFO0FBQ3pCLFVBQU0sWUFBWSxRQUFRO0FBRTFCLFFBQUksRUFBRSxTQUFTLFlBQVksT0FBTyxLQUFLLEVBQUUsVUFBVSxFQUFFLFNBQVMsR0FBRztBQUMvRCxZQUFNLFFBQVEsU0FBUyxjQUFjLEtBQUs7QUFDMUMsWUFBTSxZQUFZO0FBQ2xCLGlCQUFXLENBQUMsR0FBRyxDQUFDLEtBQUssT0FBTyxRQUFRLEVBQUUsVUFBVSxHQUFHO0FBQ2pELGNBQU0sTUFBTSxTQUFTLGNBQWMsS0FBSztBQUN4QyxZQUFJLFlBQVk7QUFDaEIsY0FBTSxRQUFRLFNBQVMsY0FBYyxNQUFNO0FBQzNDLGNBQU0sWUFBWTtBQUNsQixjQUFNLGNBQWM7QUFDcEIsY0FBTSxRQUFRLFNBQVMsY0FBYyxNQUFNO0FBQzNDLGNBQU0sWUFBWTtBQUNsQixjQUFNLGNBQWM7QUFDcEIsWUFBSSxZQUFZLEtBQUs7QUFDckIsWUFBSSxZQUFZLEtBQUs7QUFDckIsY0FBTSxZQUFZLEdBQUc7QUFBQSxNQUN2QjtBQUNBLFlBQU0sWUFBWSxLQUFLO0FBQUEsSUFDekI7QUFFQSxVQUFNLE9BQU8sU0FBUyxjQUFjLEtBQUs7QUFDekMsU0FBSyxZQUFZO0FBQ2pCLFNBQUssY0FBYyxHQUFHLEVBQUUsV0FBVyxjQUFjLEVBQUUsZ0JBQWdCLElBQUksTUFBTSxFQUFFO0FBQy9FLFVBQU0sWUFBWSxJQUFJO0FBRXRCLFVBQU0sUUFBUSxTQUFTLGNBQWMsUUFBUTtBQUM3QyxVQUFNLFlBQVk7QUFDbEIsVUFBTSxjQUFjLEVBQUUsU0FBUyxXQUFXLGlCQUFpQjtBQUMzRCxVQUFNLGlCQUFpQixTQUFTLE1BQU07QUFDcEMsVUFBSSxFQUFFLFNBQVMsWUFBWSxLQUFLLGtCQUFrQjtBQUNoRCxhQUFLLGlCQUFpQixFQUFFLFVBQVUsRUFBRSxTQUFTO0FBQUEsTUFDL0MsV0FBVyxLQUFLLGdCQUFnQjtBQUM5QixhQUFLLGVBQWUsRUFBRSxRQUFRO0FBQUEsTUFDaEM7QUFBQSxJQUNGLENBQUM7QUFDRCxVQUFNLFlBQVksS0FBSztBQUV2QixjQUFVLFlBQVksS0FBSztBQUFBLEVBQzdCO0FBQ0Y7OztBNkgxMENBLElBQUFDLG1CQUFxRDtBQUc5QyxJQUFNLGtCQUFrQjtBQVcvQixJQUFNLGFBQW1EO0FBQUEsRUFDdkQsRUFBRSxPQUFPLFlBQVksT0FBTyxXQUFXO0FBQUEsRUFDdkMsRUFBRSxPQUFPLGdCQUFnQixPQUFPLG1CQUFtQjtBQUFBLEVBQ25ELEVBQUUsT0FBTyxVQUFVLE9BQU8sS0FBSztBQUFBLEVBQy9CLEVBQUUsT0FBTyxjQUFjLE9BQU8sU0FBUztBQUFBLEVBQ3ZDLEVBQUUsT0FBTyxZQUFZLE9BQU8sV0FBVztBQUFBLEVBQ3ZDLEVBQUUsT0FBTyxnQkFBZ0IsT0FBTyxlQUFlO0FBQ2pEO0FBRU8sSUFBTSxrQkFBTixjQUE4Qiw4QkFBYTtBQUFBLEVBY2hELFlBQVksTUFBcUI7QUFDL0IsVUFBTSxJQUFJO0FBZFosU0FBUSxVQUEwQixDQUFDO0FBQ25DLFNBQVEsVUFBb0IsQ0FBQztBQUM3QixTQUFRLFVBQXlCO0FBQ2pDLFNBQVEsVUFBbUI7QUFDM0IsU0FBUSxVQUE0QixDQUFDO0FBQ3JDLFNBQVEsWUFBaUMsb0JBQUksSUFBSTtBQUNqRCxTQUFRLFVBQThCO0FBQ3RDLFNBQVEsVUFBOEI7QUFDdEMsU0FBUSxnQkFBb0M7QUFHNUM7QUFBQSxvQkFBZ0M7QUFJOUIsU0FBSyxVQUFVLFFBQVEsb0JBQW9CLE1BQU07QUFDL0MsVUFBSSxDQUFDLEtBQUs7QUFBTTtBQUNoQixXQUFLLEtBQUssYUFBYTtBQUFBLFFBQ3JCLE1BQU07QUFBQSxRQUNOLE9BQU8sRUFBRSxNQUFNLEtBQUssS0FBSyxLQUFLO0FBQUEsTUFDaEMsQ0FBQztBQUFBLElBQ0gsQ0FBQztBQUFBLEVBQ0g7QUFBQSxFQUVBLGNBQXNCO0FBQ3BCLFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFQSxpQkFBeUI7QUFDdkIsV0FBTyxLQUFLLE1BQU0sWUFBWTtBQUFBLEVBQ2hDO0FBQUEsRUFFQSxVQUFrQjtBQUNoQixXQUFPO0FBQUEsRUFDVDtBQUFBLEVBRUEsWUFBWSxNQUFjLE9BQXNCO0FBQzlDLFNBQUssT0FBTztBQUVaLFVBQU0sU0FBUyxxQkFBcUIsTUFBTSxLQUFLLE1BQU0sUUFBUSxFQUFFO0FBQy9ELFFBQUksUUFBUTtBQUNWLFdBQUssVUFBVSxPQUFPO0FBQ3RCLFlBQU0sU0FBUyxvQkFBSSxJQUFZO0FBQy9CLGlCQUFXLE9BQU8sT0FBTyxTQUFTO0FBQ2hDLG1CQUFXLFFBQVEsSUFBSSxlQUFlO0FBQ3BDLGlCQUFPLElBQUksSUFBSTtBQUFBLFFBQ2pCO0FBQUEsTUFDRjtBQUNBLFdBQUssVUFBVSxNQUFNLEtBQUssTUFBTTtBQUFBLElBQ2xDLE9BQU87QUFDTCxXQUFLLFVBQVUsQ0FBQztBQUNoQixXQUFLLFVBQVUsQ0FBQztBQUFBLElBQ2xCO0FBRUEsUUFBSSxPQUFPO0FBQ1QsV0FBSyxVQUFVO0FBQ2YsV0FBSyxVQUFVO0FBQ2YsV0FBSyxVQUFVLENBQUM7QUFDaEIsV0FBSyxZQUFZLG9CQUFJLElBQUk7QUFBQSxJQUMzQjtBQUVBLFNBQUssWUFBWTtBQUFBLEVBQ25CO0FBQUEsRUFFQSxjQUFzQjtBQUNwQixXQUFPLEtBQUs7QUFBQSxFQUNkO0FBQUEsRUFFQSxRQUFjO0FBQ1osU0FBSyxPQUFPO0FBQ1osU0FBSyxVQUFVLENBQUM7QUFDaEIsU0FBSyxVQUFVLENBQUM7QUFDaEIsU0FBSyxVQUFVLE1BQU07QUFBQSxFQUN2QjtBQUFBO0FBQUEsRUFJUSxjQUFvQjtBQUMxQixTQUFLLFVBQVUsTUFBTTtBQUNyQixTQUFLLFVBQVUsU0FBUyxlQUFlO0FBRXZDLFFBQUksS0FBSyxRQUFRLFdBQVcsR0FBRztBQUM3QixXQUFLLFVBQVUsVUFBVTtBQUFBLFFBQ3ZCLEtBQUs7QUFBQSxRQUNMLE1BQU07QUFBQSxNQUNSLENBQUM7QUFDRDtBQUFBLElBQ0Y7QUFHQSxVQUFNLFVBQVUsS0FBSyxVQUFVLFVBQVUsRUFBRSxLQUFLLG1CQUFtQixDQUFDO0FBRXBFLFVBQU0sZUFBZSxRQUFRLFNBQVMsVUFBVTtBQUFBLE1BQzlDLEtBQUs7QUFBQSxJQUNQLENBQUM7QUFDRCxrQ0FBUSxjQUFjLFFBQVE7QUFDOUIsaUJBQWEsaUJBQWlCLFNBQVMsTUFBTSxLQUFLLFVBQVUsQ0FBQztBQUU3RCxVQUFNLFlBQVksUUFBUSxTQUFTLFVBQVU7QUFBQSxNQUMzQyxLQUFLO0FBQUEsTUFDTCxNQUFNLEVBQUUsY0FBYyxhQUFhO0FBQUEsSUFDckMsQ0FBQztBQUNELGtDQUFRLFdBQVcsTUFBTTtBQUN6QixjQUFVLGlCQUFpQixTQUFTLE1BQU07QUFDeEMsVUFBSSxLQUFLO0FBQVUsYUFBSyxTQUFTO0FBQUEsSUFDbkMsQ0FBQztBQUVELFNBQUssVUFBVSxRQUFRLFVBQVUsRUFBRSxLQUFLLGlCQUFpQixDQUFDO0FBRzFELFNBQUssZ0JBQWdCLEtBQUssVUFBVSxVQUFVLEVBQUUsS0FBSyxrQkFBa0IsQ0FBQztBQUN4RSxTQUFLLGtCQUFrQjtBQUd2QixVQUFNLFVBQVUsS0FBSyxVQUFVLFVBQVUsRUFBRSxLQUFLLG1CQUFtQixDQUFDO0FBQ3BFLFVBQU0sUUFBUSxRQUFRLFNBQVMsU0FBUyxFQUFFLEtBQUssV0FBVyxDQUFDO0FBQzNELFVBQU0sTUFBTSxjQUFjO0FBRzFCLFVBQU0sUUFBUSxNQUFNLFNBQVMsT0FBTztBQUNwQyxVQUFNLFlBQVksTUFBTSxTQUFTLElBQUk7QUFFckMsZUFBVyxPQUFPLEtBQUssU0FBUztBQUM5QixZQUFNLEtBQUssVUFBVSxTQUFTLElBQUk7QUFDbEMsU0FBRyxRQUFRLE1BQU07QUFDakIsWUFBTSxjQUFjLEtBQUssVUFBVSxJQUFJLEdBQUc7QUFDMUMsVUFBSTtBQUFhLFdBQUcsTUFBTSxRQUFRLGNBQWM7QUFFaEQsWUFBTSxRQUFRLEdBQUcsVUFBVSxFQUFFLEtBQUssY0FBYyxDQUFDO0FBQ2pELFlBQU0sV0FBVyxFQUFFLEtBQUssZUFBZSxNQUFNLElBQUksQ0FBQztBQUVsRCxZQUFNLFFBQVEsTUFBTSxXQUFXLEVBQUUsS0FBSyxjQUFjLENBQUM7QUFDckQsVUFBSSxLQUFLLFlBQVksS0FBSztBQUN4QixjQUFNLGNBQWMsS0FBSyxZQUFZLFFBQVEsWUFBTztBQUNwRCxXQUFHLFNBQVMsY0FBYztBQUFBLE1BQzVCO0FBR0EsVUFBSSxZQUFZO0FBQ2hCLFlBQU0saUJBQWlCLFNBQVMsTUFBTTtBQUNwQyxZQUFJLFdBQVc7QUFBRSxzQkFBWTtBQUFPO0FBQUEsUUFBUTtBQUM1QyxZQUFJLEtBQUssWUFBWSxLQUFLO0FBQ3hCLGVBQUssVUFBVSxLQUFLLFlBQVksUUFBUSxTQUFTO0FBQUEsUUFDbkQsT0FBTztBQUNMLGVBQUssVUFBVTtBQUNmLGVBQUssVUFBVTtBQUFBLFFBQ2pCO0FBQ0Esa0JBQVUsaUJBQWlCLElBQUksRUFBRSxRQUFRLENBQUMsT0FBTztBQUMvQyxhQUFHLFlBQVksY0FBYztBQUM3QixnQkFBTUMsS0FBSSxHQUFHLGNBQWMsY0FBYztBQUN6QyxjQUFJQTtBQUFHLFlBQUFBLEdBQUUsY0FBYztBQUFBLFFBQ3pCLENBQUM7QUFDRCxXQUFHLFNBQVMsY0FBYztBQUMxQixjQUFNLGNBQWMsS0FBSyxZQUFZLFFBQVEsWUFBTztBQUNwRCxhQUFLLFdBQVc7QUFBQSxNQUNsQixDQUFDO0FBR0QsWUFBTSxTQUFTLEdBQUcsVUFBVSxFQUFFLEtBQUssZUFBZSxDQUFDO0FBQ25ELGFBQU8saUJBQWlCLGFBQWEsQ0FBQyxNQUFNO0FBQzFDLFVBQUUsZUFBZTtBQUNqQixVQUFFLGdCQUFnQjtBQUNsQixjQUFNLFNBQVMsRUFBRTtBQUNqQixjQUFNLFNBQVMsR0FBRztBQUVsQixjQUFNLFNBQVMsQ0FBQyxPQUFtQjtBQUNqQyxnQkFBTSxPQUFPLEtBQUssSUFBSSxJQUFJLFNBQVMsR0FBRyxVQUFVLE1BQU07QUFDdEQsYUFBRyxNQUFNLFFBQVEsT0FBTztBQUN4QixzQkFBWTtBQUFBLFFBQ2Q7QUFFQSxjQUFNLE9BQU8sTUFBTTtBQUNqQixtQkFBUyxvQkFBb0IsYUFBYSxNQUFNO0FBQ2hELG1CQUFTLG9CQUFvQixXQUFXLElBQUk7QUFDNUMsZUFBSyxVQUFVLElBQUksS0FBSyxHQUFHLFdBQVc7QUFBQSxRQUN4QztBQUVBLGlCQUFTLGlCQUFpQixhQUFhLE1BQU07QUFDN0MsaUJBQVMsaUJBQWlCLFdBQVcsSUFBSTtBQUFBLE1BQzNDLENBQUM7QUFBQSxJQUNIO0FBR0EsU0FBSyxVQUFVLE1BQU0sU0FBUyxPQUFPO0FBQ3JDLFNBQUssV0FBVztBQUFBLEVBQ2xCO0FBQUEsRUFFUSxhQUFtQjtBQUN6QixRQUFJLENBQUMsS0FBSztBQUFTO0FBQ25CLFNBQUssUUFBUSxNQUFNO0FBRW5CLFFBQUksT0FBTyxDQUFDLEdBQUcsS0FBSyxPQUFPO0FBRzNCLGVBQVcsS0FBSyxLQUFLLFNBQVM7QUFDNUIsYUFBTyxLQUFLLE9BQU8sQ0FBQyxRQUFRLEtBQUssY0FBYyxLQUFLLENBQUMsQ0FBQztBQUFBLElBQ3hEO0FBR0EsUUFBSSxLQUFLLFNBQVM7QUFDaEIsWUFBTSxNQUFNLEtBQUs7QUFDakIsWUFBTSxNQUFNLEtBQUssWUFBWSxRQUFRLElBQUk7QUFDekMsV0FBSyxLQUFLLENBQUNBLElBQUcsTUFBTTtBQUNsQixjQUFNLEtBQUtBLEdBQUUsV0FBVyxHQUFHLEtBQUs7QUFDaEMsY0FBTSxLQUFLLEVBQUUsV0FBVyxHQUFHLEtBQUs7QUFDaEMsY0FBTSxLQUFLLE9BQU8sRUFBRTtBQUNwQixjQUFNLEtBQUssT0FBTyxFQUFFO0FBQ3BCLFlBQUksQ0FBQyxNQUFNLEVBQUUsS0FBSyxDQUFDLE1BQU0sRUFBRTtBQUFHLGtCQUFRLEtBQUssTUFBTTtBQUNqRCxlQUFPLEdBQUcsY0FBYyxFQUFFLElBQUk7QUFBQSxNQUNoQyxDQUFDO0FBQUEsSUFDSDtBQUVBLGVBQVcsT0FBTyxNQUFNO0FBQ3RCLFlBQU0sS0FBSyxLQUFLLFFBQVEsU0FBUyxJQUFJO0FBQ3JDLGlCQUFXLE9BQU8sS0FBSyxTQUFTO0FBQzlCLGNBQU0sS0FBSyxHQUFHLFNBQVMsSUFBSTtBQUMzQixjQUFNLE9BQU8sR0FBRyxXQUFXLEVBQUUsS0FBSyxhQUFhLENBQUM7QUFDaEQsYUFBSyxjQUFjLElBQUksV0FBVyxHQUFHLEtBQUs7QUFDMUMsYUFBSyxRQUFRLElBQUksV0FBVyxHQUFHLEtBQUs7QUFBQSxNQUN0QztBQUFBLElBQ0Y7QUFFQSxRQUFJLEtBQUssU0FBUztBQUNoQixXQUFLLFFBQVEsY0FBYyxHQUFHLEtBQUssTUFBTSxPQUFPLEtBQUssUUFBUSxNQUFNO0FBQUEsSUFDckU7QUFBQSxFQUNGO0FBQUE7QUFBQSxFQUlRLFlBQWtCO0FBQ3hCLFFBQUksS0FBSyxRQUFRLFdBQVc7QUFBRztBQUMvQixTQUFLLFFBQVEsS0FBSztBQUFBLE1BQ2hCLFFBQVEsS0FBSyxRQUFRLENBQUM7QUFBQSxNQUN0QixJQUFJO0FBQUEsTUFDSixPQUFPO0FBQUEsSUFDVCxDQUFDO0FBQ0QsU0FBSyxrQkFBa0I7QUFBQSxFQUN6QjtBQUFBLEVBRVEsb0JBQTBCO0FBQ2hDLFFBQUksQ0FBQyxLQUFLO0FBQWU7QUFDekIsU0FBSyxjQUFjLE1BQU07QUFFekIsUUFBSSxLQUFLLFFBQVEsV0FBVyxHQUFHO0FBQzdCLFdBQUssY0FBYyxNQUFNLFVBQVU7QUFDbkM7QUFBQSxJQUNGO0FBQ0EsU0FBSyxjQUFjLE1BQU0sVUFBVTtBQUVuQyxhQUFTLElBQUksR0FBRyxJQUFJLEtBQUssUUFBUSxRQUFRLEtBQUs7QUFDNUMsWUFBTSxJQUFJLEtBQUssUUFBUSxDQUFDO0FBQ3hCLFlBQU0sTUFBTSxLQUFLLGNBQWMsVUFBVSxFQUFFLEtBQUssZ0JBQWdCLENBQUM7QUFHakUsWUFBTSxZQUFZLElBQUksU0FBUyxVQUFVLEVBQUUsS0FBSyxtQkFBbUIsQ0FBQztBQUNwRSxpQkFBVyxPQUFPLEtBQUssU0FBUztBQUM5QixjQUFNLE1BQU0sVUFBVSxTQUFTLFVBQVUsRUFBRSxNQUFNLEtBQUssT0FBTyxJQUFJLENBQUM7QUFDbEUsWUFBSSxRQUFRLEVBQUU7QUFBUSxjQUFJLFdBQVc7QUFBQSxNQUN2QztBQUNBLGdCQUFVLGlCQUFpQixVQUFVLE1BQU07QUFDekMsVUFBRSxTQUFTLFVBQVU7QUFDckIsYUFBSyxXQUFXO0FBQUEsTUFDbEIsQ0FBQztBQUdELFlBQU0sV0FBVyxJQUFJLFNBQVMsVUFBVSxFQUFFLEtBQUssbUJBQW1CLENBQUM7QUFDbkUsaUJBQVcsTUFBTSxZQUFZO0FBQzNCLGNBQU0sTUFBTSxTQUFTLFNBQVMsVUFBVSxFQUFFLE1BQU0sR0FBRyxPQUFPLE9BQU8sR0FBRyxNQUFNLENBQUM7QUFDM0UsWUFBSSxHQUFHLFVBQVUsRUFBRTtBQUFJLGNBQUksV0FBVztBQUFBLE1BQ3hDO0FBQ0EsZUFBUyxpQkFBaUIsVUFBVSxNQUFNO0FBQ3hDLFVBQUUsS0FBSyxTQUFTO0FBQ2hCLGFBQUssa0JBQWtCO0FBQ3ZCLGFBQUssV0FBVztBQUFBLE1BQ2xCLENBQUM7QUFHRCxVQUFJLEVBQUUsT0FBTyxjQUFjLEVBQUUsT0FBTyxnQkFBZ0I7QUFDbEQsY0FBTSxXQUFXLElBQUksU0FBUyxTQUFTO0FBQUEsVUFDckMsS0FBSztBQUFBLFVBQ0wsTUFBTTtBQUFBLFVBQ04sYUFBYTtBQUFBLFFBQ2YsQ0FBQztBQUNELGlCQUFTLFFBQVEsRUFBRTtBQUNuQixpQkFBUyxpQkFBaUIsU0FBUyxNQUFNO0FBQ3ZDLFlBQUUsUUFBUSxTQUFTO0FBQ25CLGVBQUssV0FBVztBQUFBLFFBQ2xCLENBQUM7QUFBQSxNQUNIO0FBR0EsWUFBTSxZQUFZLElBQUksU0FBUyxVQUFVO0FBQUEsUUFDdkMsS0FBSztBQUFBLE1BQ1AsQ0FBQztBQUNELG9DQUFRLFdBQVcsR0FBRztBQUN0QixZQUFNLE1BQU07QUFDWixnQkFBVSxpQkFBaUIsU0FBUyxNQUFNO0FBQ3hDLGFBQUssUUFBUSxPQUFPLEtBQUssQ0FBQztBQUMxQixhQUFLLGtCQUFrQjtBQUN2QixhQUFLLFdBQVc7QUFBQSxNQUNsQixDQUFDO0FBQUEsSUFDSDtBQUFBLEVBQ0Y7QUFBQSxFQUVRLGNBQWMsS0FBbUIsR0FBNEI7QUFDbkUsVUFBTSxPQUFPLElBQUksV0FBVyxFQUFFLE1BQU0sS0FBSyxJQUFJLFlBQVk7QUFDekQsVUFBTSxLQUFLLEVBQUUsTUFBTSxZQUFZO0FBQy9CLFlBQVEsRUFBRSxJQUFJO0FBQUEsTUFDWixLQUFLO0FBQVksZUFBTyxJQUFJLFNBQVMsRUFBRTtBQUFBLE1BQ3ZDLEtBQUs7QUFBZ0IsZUFBTyxDQUFDLElBQUksU0FBUyxFQUFFO0FBQUEsTUFDNUMsS0FBSztBQUFVLGVBQU8sUUFBUTtBQUFBLE1BQzlCLEtBQUs7QUFBYyxlQUFPLFFBQVE7QUFBQSxNQUNsQyxLQUFLO0FBQVksZUFBTyxRQUFRO0FBQUEsTUFDaEMsS0FBSztBQUFnQixlQUFPLFFBQVE7QUFBQSxJQUN0QztBQUFBLEVBQ0Y7QUFDRjs7O0FDcFZBLElBQUFDLG1CQU9PO0FBZUEsSUFBTSxvQkFBTixjQUFnQywrQkFBZ0M7QUFBQSxFQUtyRSxZQUFZLEtBQVU7QUFDcEIsVUFBTSxHQUFHO0FBTFgsU0FBUSxVQUE4QixDQUFDO0FBRXZDO0FBQUEsdUJBQWdEO0FBTzlDLFNBQUssZ0JBQWdCO0FBQUEsTUFDbkIsRUFBRSxTQUFTLGdCQUFNLFNBQVMsY0FBYztBQUFBLE1BQ3hDLEVBQUUsU0FBUyxTQUFTLFNBQVMsWUFBWTtBQUFBLE1BQ3pDLEVBQUUsU0FBUyxPQUFPLFNBQVMsWUFBWTtBQUFBLE1BQ3ZDLEVBQUUsU0FBUyxPQUFPLFNBQVMsYUFBYTtBQUFBLElBQzFDLENBQUM7QUFFRCxTQUFLLE1BQU0sU0FBUyxDQUFDLEdBQUcsT0FBTyxDQUFDLFFBQVE7QUFDdEMsWUFBTSxJQUFJO0FBQ1YsUUFBRSxlQUFlO0FBQ2pCLFFBQUUsZ0JBQWdCO0FBQ2xCLFlBQU0sVUFBVyxLQUFhO0FBQzlCLFVBQUksV0FBVyxPQUFPLFFBQVEsb0JBQW9CLFlBQVk7QUFDNUQsZ0JBQVEsZ0JBQWdCLENBQUM7QUFDekIsZUFBTztBQUFBLE1BQ1Q7QUFFQSxVQUFJLFdBQVcsT0FBTyxRQUFRLFlBQVksWUFBWTtBQUNwRCxnQkFBUSxRQUFRLENBQUM7QUFDakIsZUFBTztBQUFBLE1BQ1Q7QUFDQSxhQUFPO0FBQUEsSUFDVCxDQUFDO0FBQUEsRUFDSDtBQUFBLEVBRUEsV0FBVyxTQUErQjtBQUN4QyxTQUFLLFVBQVUsUUFBUSxJQUFJLENBQUMsT0FBTztBQUFBLE1BQ2pDLFlBQVksRUFBRTtBQUFBLE1BQ2QsVUFBVSxFQUFFO0FBQUEsTUFDWixXQUFXLEVBQUU7QUFBQSxNQUNiLFVBQVUsRUFBRTtBQUFBLE1BQ1osWUFBWSxFQUFFO0FBQUEsSUFDaEIsRUFBRTtBQUFBLEVBQ0o7QUFBQSxFQUVBLFVBQ0UsUUFDQSxRQUNBLE9BQ2lDO0FBQ2pDLFVBQU0sT0FBTyxPQUFPLFFBQVEsT0FBTyxJQUFJO0FBQ3ZDLFVBQU0sTUFBTSxLQUFLLFVBQVUsR0FBRyxPQUFPLEVBQUU7QUFHdkMsVUFBTSxXQUFXLElBQUksWUFBWSxJQUFJO0FBQ3JDLFFBQUksYUFBYTtBQUFJLGFBQU87QUFHNUIsVUFBTSxZQUFZLElBQUksVUFBVSxXQUFXLENBQUM7QUFDNUMsUUFBSSxVQUFVLFNBQVMsSUFBSTtBQUFHLGFBQU87QUFFckMsVUFBTSxRQUFRO0FBRWQsV0FBTztBQUFBLE1BQ0wsT0FBTyxFQUFFLE1BQU0sT0FBTyxNQUFNLElBQUksV0FBVyxFQUFFO0FBQUEsTUFDN0MsS0FBSztBQUFBLE1BQ0w7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUFBLEVBRUEsZUFBZSxTQUFtRDtBQUNoRSxVQUFNLFFBQVEsUUFBUSxNQUFNLFlBQVksRUFBRSxLQUFLO0FBQy9DLFFBQUksQ0FBQztBQUFPLGFBQU8sS0FBSyxRQUFRLE1BQU0sR0FBRyxFQUFFO0FBRTNDLFVBQU0sVUFBVSxLQUFLLFFBQ2xCO0FBQUEsTUFDQyxDQUFDLE1BQ0MsRUFBRSxXQUFXLFlBQVksRUFBRSxTQUFTLEtBQUssS0FDekMsRUFBRSxTQUFTLFlBQVksRUFBRSxTQUFTLEtBQUs7QUFBQSxJQUMzQyxFQUNDLE1BQU0sR0FBRyxFQUFFO0FBR2QsVUFBTSxXQUFXLFFBQVE7QUFBQSxNQUN2QixDQUFDLE1BQU0sRUFBRSxXQUFXLFlBQVksTUFBTSxTQUFTLEVBQUUsU0FBUyxZQUFZLE1BQU07QUFBQSxJQUM5RTtBQUNBLFFBQUksQ0FBQyxZQUFZLE1BQU0sU0FBUyxHQUFHO0FBQ2pDLGNBQVEsS0FBSztBQUFBLFFBQ1gsWUFBWSxRQUFRLE1BQU0sS0FBSztBQUFBLFFBQy9CLFVBQVUsUUFBUSxNQUFNLEtBQUs7QUFBQSxRQUM3QixXQUFXO0FBQUEsUUFDWCxVQUFVO0FBQUEsUUFDVixZQUFZLENBQUM7QUFBQSxRQUNiLGdCQUFnQjtBQUFBLE1BQ2xCLENBQUM7QUFBQSxJQUNIO0FBRUEsV0FBTztBQUFBLEVBQ1Q7QUFBQSxFQUVBLGlCQUFpQixZQUE4QixJQUF1QjtBQUNwRSxVQUFNLFlBQVksR0FBRyxVQUFVLEVBQUUsS0FBSyxnQkFBZ0IsQ0FBQztBQUV2RCxRQUFJLFdBQVcsZ0JBQWdCO0FBQzdCLGdCQUFVLFNBQVMsc0JBQXNCO0FBQ3pDLFlBQU1DLFdBQVUsVUFBVSxVQUFVLEVBQUUsS0FBSyxzQkFBc0IsQ0FBQztBQUNsRSxNQUFBQSxTQUFRLGNBQWMsV0FBVyxXQUFXLFVBQVU7QUFDdEQsWUFBTUMsVUFBUyxVQUFVLFVBQVUsRUFBRSxLQUFLLHFCQUFxQixDQUFDO0FBQ2hFLE1BQUFBLFFBQU8sY0FBYztBQUNyQjtBQUFBLElBQ0Y7QUFFQSxVQUFNLFVBQVUsVUFBVSxVQUFVLEVBQUUsS0FBSyxzQkFBc0IsQ0FBQztBQUNsRSxZQUFRLGNBQWMsV0FBVztBQUVqQyxVQUFNLFNBQVMsVUFBVSxVQUFVLEVBQUUsS0FBSyxxQkFBcUIsQ0FBQztBQUNoRSxXQUFPLGNBQWMsV0FBVztBQUFBLEVBQ2xDO0FBQUEsRUFFQSxpQkFDRSxZQUNBLE1BQ007QUFDTixRQUFJLENBQUMsS0FBSztBQUFTO0FBRW5CLFFBQUksV0FBVyxnQkFBZ0I7QUFFN0IsWUFBTSxRQUFRLFdBQVc7QUFDekIsV0FBSyxNQUFNO0FBQ1gsVUFBSSxLQUFLO0FBQWEsYUFBSyxZQUFZLEtBQUs7QUFDNUM7QUFBQSxJQUNGO0FBRUEsVUFBTSxTQUFTLEtBQUssUUFBUTtBQUM1QixVQUFNQyxTQUFRLEtBQUssUUFBUTtBQUMzQixVQUFNLE1BQU0sS0FBSyxRQUFRO0FBR3pCLFVBQU0sV0FBVyxPQUFPLFFBQVEsSUFBSSxJQUFJO0FBQ3hDLFVBQU0sY0FBYyxTQUFTLFVBQVUsSUFBSSxFQUFFO0FBQzdDLFVBQU0sYUFBYSxZQUFZLFdBQVcsSUFBSTtBQUc5QyxVQUFNLFlBQVksYUFDZCxFQUFFLE1BQU0sSUFBSSxNQUFNLElBQUksSUFBSSxLQUFLLEVBQUUsSUFDakM7QUFDSixXQUFPLGFBQWEsV0FBVyxhQUFhLE1BQU1BLFFBQU8sU0FBUztBQUFBLEVBQ3BFO0FBQ0Y7OztBQzFLQSxJQUFBQyxtQkFBbUQ7QUFnQjVDLFNBQVMsZUFBZSxhQUE2QztBQUMxRSxTQUFPLFlBQVksSUFBSSxDQUFDLE9BQU87QUFDN0IsVUFBTSxVQUFVLG9CQUFJLElBQVk7QUFDaEMsUUFBSSxRQUFRO0FBQ1osZUFBVyxPQUFPLEdBQUcsU0FBUztBQUM1QixpQkFBVyxRQUFRLElBQUksZUFBZTtBQUNwQyxnQkFBUSxJQUFJLElBQUk7QUFBQSxNQUNsQjtBQUNBLFVBQUksSUFBSSxLQUFLO0FBQU8sZ0JBQVEsSUFBSTtBQUFBLElBQ2xDO0FBRUEsVUFBTSxRQUFrQixDQUFDO0FBQ3pCLFlBQVEsT0FBTyxHQUFHLFdBQVc7QUFDN0IsWUFBUSxPQUFPLElBQUk7QUFDbkIsVUFBTSxLQUFLLEdBQUcsYUFBYSxNQUFNLEdBQUcsT0FBTztBQUUzQyxVQUFNLFlBQVksR0FBRyxRQUFRLENBQUMsR0FBRyxhQUM1QixHQUFHLFNBQVMsUUFBUSxTQUFTLEVBQUUsRUFBRSxRQUFRLFVBQVUsRUFBRTtBQUUxRCxXQUFPO0FBQUEsTUFDTCxVQUFVLEdBQUc7QUFBQSxNQUNiO0FBQUEsTUFDQSxhQUFhLEdBQUc7QUFBQSxNQUNoQixZQUFZO0FBQUEsTUFDWixRQUFRLFFBQVE7QUFBQSxJQUNsQjtBQUFBLEVBQ0YsQ0FBQztBQUNIO0FBT08sSUFBTSxvQkFBTixjQUFnQyx1QkFBTTtBQUFBLEVBTzNDLFlBQ0UsS0FDQSxPQUNBLFNBS0E7QUFDQSxVQUFNLEdBQUc7QUFYWCxTQUFRLGNBQW1DLG9CQUFJLElBQUk7QUFZakQsU0FBSyxRQUFRO0FBQ2IsU0FBSyxlQUFlLFNBQVMsZ0JBQWdCO0FBQzdDLFNBQUssYUFBYSxTQUFTLGNBQWM7QUFDekMsU0FBSyxZQUFZLFNBQVMsY0FBYyxNQUFNO0FBQUEsSUFBQztBQUFBLEVBQ2pEO0FBQUEsRUFFQSxTQUFlO0FBQ2IsU0FBSyxRQUFRLFNBQVMsaUJBQWlCO0FBQ3ZDLFNBQUssUUFBUSxjQUFjO0FBRTNCLFFBQUksS0FBSyxjQUFjO0FBQ3JCLFdBQUssV0FBVyxLQUFLLFlBQVk7QUFBQSxJQUNuQyxPQUFPO0FBQ0wsV0FBSyxpQkFBaUI7QUFBQSxJQUN4QjtBQUFBLEVBQ0Y7QUFBQSxFQUVBLFVBQWdCO0FBQ2QsU0FBSyxVQUFVLE1BQU07QUFBQSxFQUN2QjtBQUFBO0FBQUEsRUFJUSxtQkFBeUI7QUFDL0IsU0FBSyxVQUFVLE1BQU07QUFFckIsUUFBSSxLQUFLLE1BQU0sV0FBVyxHQUFHO0FBQzNCLFdBQUssVUFBVSxVQUFVO0FBQUEsUUFDdkIsTUFBTTtBQUFBLFFBQ04sS0FBSztBQUFBLE1BQ1AsQ0FBQztBQUNEO0FBQUEsSUFDRjtBQUVBLFFBQUkseUJBQVEsS0FBSyxTQUFTLEVBQ3ZCLFFBQVEsYUFBYSxFQUNyQixRQUFRLHdDQUF3QyxFQUNoRCxZQUFZLENBQUMsT0FBTztBQUNuQixpQkFBVyxLQUFLLEtBQUssT0FBTztBQUMxQixXQUFHLFVBQVUsRUFBRSxVQUFVLEVBQUUsU0FBUztBQUFBLE1BQ3RDO0FBQ0EsU0FBRyxTQUFTLENBQUMsUUFBUTtBQUNuQixhQUFLLGVBQWUsS0FBSyxNQUFNLEtBQUssQ0FBQyxNQUFNLEVBQUUsYUFBYSxHQUFHLEtBQUs7QUFBQSxNQUNwRSxDQUFDO0FBRUQsV0FBSyxlQUFlLEtBQUssTUFBTSxDQUFDO0FBQUEsSUFDbEMsQ0FBQztBQUVILFFBQUkseUJBQVEsS0FBSyxTQUFTLEVBQ3ZCO0FBQUEsTUFBVSxDQUFDLFFBQ1YsSUFBSSxjQUFjLE1BQU0sRUFBRSxPQUFPLEVBQUUsUUFBUSxNQUFNO0FBQy9DLFlBQUksS0FBSztBQUFjLGVBQUssV0FBVyxLQUFLLFlBQVk7QUFBQSxNQUMxRCxDQUFDO0FBQUEsSUFDSDtBQUFBLEVBQ0o7QUFBQTtBQUFBLEVBSVEsV0FBV0MsT0FBNEI7QUFDN0MsU0FBSyxVQUFVLE1BQU07QUFDckIsU0FBSyxZQUFZLE1BQU07QUFDdkIsU0FBSyxRQUFRLGNBQWMsT0FBT0EsTUFBSyxTQUFTO0FBRWhELFVBQU0sT0FBTyxLQUFLLFVBQVUsVUFBVSxFQUFFLEtBQUssaUJBQWlCLENBQUM7QUFFL0QsZUFBVyxRQUFRQSxNQUFLLFlBQVk7QUFDbEMsWUFBTSxRQUFRLFNBQVNBLE1BQUs7QUFDNUIsWUFBTSxPQUFPLFNBQVM7QUFFdEIsWUFBTSxVQUFVLElBQUkseUJBQVEsSUFBSSxFQUFFLFFBQVEsSUFBSTtBQUU5QyxVQUFJLE1BQU07QUFFUixnQkFBUSxRQUFRLFNBQVNBLE1BQUssTUFBTSxFQUFFO0FBQ3RDLGFBQUssWUFBWSxJQUFJLE1BQU0sT0FBT0EsTUFBSyxNQUFNLENBQUM7QUFDOUMsZ0JBQVE7QUFBQSxVQUFRLENBQUMsU0FDZixLQUNHLFNBQVMsT0FBT0EsTUFBSyxNQUFNLENBQUMsRUFDNUIsWUFBWSxJQUFJO0FBQUEsUUFDckI7QUFBQSxNQUNGLE9BQU87QUFDTCxnQkFBUSxRQUFRLENBQUMsU0FBUztBQUN4QixjQUFJLFNBQVMsS0FBSyxZQUFZO0FBQzVCLGlCQUFLLFNBQVMsS0FBSyxVQUFVO0FBQzdCLGlCQUFLLFlBQVksSUFBSSxNQUFNLEtBQUssVUFBVTtBQUFBLFVBQzVDO0FBQ0EsZUFBSyxlQUFlLElBQUksRUFBRSxTQUFTLENBQUMsUUFBUTtBQUMxQyxpQkFBSyxZQUFZLElBQUksTUFBTSxHQUFHO0FBQUEsVUFDaEMsQ0FBQztBQUVELGNBQUksT0FBTztBQUNULHVCQUFXLE1BQU0sS0FBSyxRQUFRLE1BQU0sR0FBRyxFQUFFO0FBQUEsVUFDM0M7QUFBQSxRQUNGLENBQUM7QUFBQSxNQUNIO0FBQUEsSUFDRjtBQUdBLFFBQUkseUJBQVEsSUFBSSxFQUNiO0FBQUEsTUFBVSxDQUFDLFFBQ1YsSUFBSSxjQUFjLFFBQVEsRUFBRSxPQUFPLEVBQUUsUUFBUSxNQUFNO0FBQ2pELGFBQUssYUFBYUEsS0FBSTtBQUFBLE1BQ3hCLENBQUM7QUFBQSxJQUNIO0FBR0YsU0FBSyxpQkFBaUIsV0FBVyxDQUFDLE1BQU07QUFDdEMsVUFBSSxFQUFFLFFBQVEsV0FBVyxDQUFDLEVBQUUsVUFBVTtBQUNwQyxVQUFFLGVBQWU7QUFDakIsYUFBSyxhQUFhQSxLQUFJO0FBQUEsTUFDeEI7QUFBQSxJQUNGLENBQUM7QUFBQSxFQUNIO0FBQUE7QUFBQSxFQUlBLE1BQWMsYUFBYUEsT0FBcUM7QUFDOUQsVUFBTSxTQUFTLEtBQUssWUFBWSxJQUFJQSxNQUFLLFdBQVcsR0FBRyxLQUFLO0FBQzVELFFBQUksQ0FBQyxRQUFRO0FBQ1gsVUFBSSx3QkFBTyxJQUFJQSxNQUFLLFdBQVcsZ0JBQWdCO0FBQy9DO0FBQUEsSUFDRjtBQUdBLFVBQU0sUUFBa0IsQ0FBQztBQUN6QixlQUFXLFFBQVFBLE1BQUssWUFBWTtBQUNsQyxZQUFNLE1BQU0sS0FBSyxZQUFZLElBQUksSUFBSSxHQUFHLEtBQUssS0FBSztBQUNsRCxVQUFJLEtBQUs7QUFDUCxjQUFNLEtBQUssR0FBRyxJQUFJLEtBQUssR0FBRyxFQUFFO0FBQUEsTUFDOUI7QUFBQSxJQUNGO0FBR0EsUUFBSSxDQUFDLE1BQU0sS0FBSyxDQUFDLE1BQU0sRUFBRSxXQUFXLEdBQUdBLE1BQUssV0FBVyxHQUFHLENBQUMsR0FBRztBQUM1RCxZQUFNLFFBQVEsR0FBR0EsTUFBSyxXQUFXLEtBQUssTUFBTSxFQUFFO0FBQUEsSUFDaEQ7QUFDQSxRQUFJLENBQUMsTUFBTSxLQUFLLENBQUMsTUFBTSxFQUFFLFdBQVcsS0FBSyxDQUFDLEdBQUc7QUFDM0MsWUFBTSxPQUFPLEdBQUcsR0FBRyxPQUFPQSxNQUFLLE1BQU0sRUFBRTtBQUFBLElBQ3pDO0FBRUEsVUFBTSxRQUFRLGNBQWMsTUFBTSxLQUFLLElBQUk7QUFHM0MsVUFBTSxPQUFPLEtBQUssSUFBSSxNQUFNLHNCQUFzQkEsTUFBSyxRQUFRO0FBQy9ELFFBQUksRUFBRSxnQkFBZ0IseUJBQVE7QUFDNUIsVUFBSSx3QkFBTyxtQkFBbUJBLE1BQUssUUFBUSxFQUFFO0FBQzdDO0FBQUEsSUFDRjtBQUVBLFFBQUk7QUFDRixZQUFNLFVBQVUsTUFBTSxLQUFLLElBQUksTUFBTSxLQUFLLElBQUk7QUFFOUMsWUFBTSxNQUFNLFFBQVEsU0FBUyxJQUFJLElBQUksS0FBSztBQUMxQyxZQUFNLEtBQUssSUFBSSxNQUFNLE9BQU8sTUFBTSxVQUFVLE1BQU0sUUFBUSxJQUFJO0FBQzlELFVBQUksd0JBQU8sWUFBWSxNQUFNLFFBQVFBLE1BQUssU0FBUyxFQUFFO0FBQ3JELFdBQUssTUFBTTtBQUNYLFdBQUssVUFBVUEsTUFBSyxRQUFRO0FBQUEsSUFDOUIsU0FBUyxLQUFLO0FBQ1osVUFBSSx3QkFBTyw0QkFBNEIsR0FBRyxFQUFFO0FBQUEsSUFDOUM7QUFBQSxFQUNGO0FBQ0Y7OztBQzVOQSxrQkFPTztBQUNQLG1CQUFpRDtBQUlqRCxJQUFNLFdBQVcsdUJBQVcsS0FBSyxFQUFFLE9BQU8sYUFBYSxDQUFDO0FBQ3hELElBQU0sa0JBQWtCLHVCQUFXLEtBQUssRUFBRSxPQUFPLHFCQUFxQixDQUFDO0FBSXZFLFNBQVMsaUJBQWlCLE1BQWlDO0FBQ3pELFFBQU0sVUFBVSxJQUFJLDZCQUE0QjtBQUNoRCxRQUFNLGFBQWEsS0FBSyxNQUFNLFVBQVUsS0FBSztBQUM3QyxRQUFNLFFBQVE7QUFFZCxhQUFXLEVBQUUsTUFBTSxHQUFHLEtBQUssS0FBSyxlQUFlO0FBQzdDLFVBQU0sT0FBTyxLQUFLLE1BQU0sU0FBUyxNQUFNLEVBQUU7QUFDekMsUUFBSTtBQUVKLFlBQVEsUUFBUSxNQUFNLEtBQUssSUFBSSxPQUFPLE1BQU07QUFDMUMsWUFBTUMsU0FBUSxPQUFPLE1BQU07QUFDM0IsWUFBTSxNQUFNQSxTQUFRLE1BQU0sQ0FBQyxFQUFFO0FBRzdCLFlBQU0sZUFBZSxjQUFjQSxVQUFTLGNBQWM7QUFDMUQsY0FBUSxJQUFJQSxRQUFPLEtBQUssZUFBZSxrQkFBa0IsUUFBUTtBQUFBLElBQ25FO0FBQUEsRUFDRjtBQUVBLFNBQU8sUUFBUSxPQUFPO0FBQ3hCO0FBSU8sSUFBTSx3QkFBd0IsdUJBQVc7QUFBQSxFQUM5QyxNQUFNO0FBQUEsSUFHSixZQUFZLE1BQWtCO0FBQzVCLFdBQUssY0FBYyxpQkFBaUIsSUFBSTtBQUFBLElBQzFDO0FBQUEsSUFFQSxPQUFPLFFBQTBCO0FBQy9CLFVBQUksT0FBTyxjQUFjLE9BQU8sbUJBQW1CLE9BQU8sY0FBYztBQUN0RSxhQUFLLGNBQWMsaUJBQWlCLE9BQU8sSUFBSTtBQUFBLE1BQ2pEO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQSxFQUNBO0FBQUEsSUFDRSxhQUFhLENBQUMsTUFBTSxFQUFFO0FBQUEsRUFDeEI7QUFDRjtBQU1PLElBQU0sMEJBQTBCLG1CQUFPLEdBQUc7QUFBQSxFQUMvQztBQUFBLElBQ0UsS0FBSztBQUFBLElBQ0wsS0FBSyxDQUFDLFNBQVM7QUFDYixZQUFNLE1BQU0sS0FBSyxNQUFNO0FBQ3ZCLFVBQUksSUFBSSxPQUFPLE1BQU0sQ0FBQyxNQUFNLEVBQUUsS0FBSztBQUFHLGVBQU87QUFFN0MsWUFBTSxVQUEwRCxDQUFDO0FBQ2pFLFlBQU0sWUFBbUIsQ0FBQztBQUUxQixpQkFBVyxLQUFLLElBQUksUUFBUTtBQUMxQixjQUFNLE9BQU8sS0FBSyxNQUFNLElBQUksWUFBWSxFQUFFLE1BQU0sRUFBRSxFQUFFO0FBQ3BELGNBQU0sU0FBUyxLQUFLLElBQUk7QUFDeEIsZ0JBQVEsS0FBSyxFQUFFLE1BQU0sRUFBRSxNQUFNLElBQUksRUFBRSxJQUFJLE9BQU8sQ0FBQztBQUcvQyxjQUFNQSxTQUFRLEVBQUUsT0FBTztBQUN2QixjQUFNLE1BQU1BLFNBQVEsS0FBSztBQUN6QixrQkFBVSxLQUFLLDZCQUFnQixNQUFNQSxRQUFPLEdBQUcsQ0FBQztBQUFBLE1BQ2xEO0FBRUEsV0FBSyxTQUFTO0FBQUEsUUFDWjtBQUFBLFFBQ0EsV0FBVyw2QkFBZ0IsT0FBTyxXQUFXLElBQUksU0FBUztBQUFBLE1BQzVELENBQUM7QUFDRCxhQUFPO0FBQUEsSUFDVDtBQUFBLEVBQ0Y7QUFDRixDQUFDOzs7QW5JeEVELElBQXFCLG9CQUFyQixjQUErQyx3QkFBTztBQUFBLEVBQXREO0FBQUE7QUFDRSxvQkFBZ0M7QUFDaEMsU0FBUSxZQUE4QjtBQUN0QyxTQUFRLGtCQUE0QztBQUNwRCxTQUFRLGFBQTZCLENBQUM7QUFFdEM7QUFBQSxTQUFRLGNBQXlDLG9CQUFJLElBQUk7QUFFekQ7QUFBQSx1QkFBNEIsQ0FBQztBQTZMN0I7QUFBQTtBQUFBLFNBQVEsb0JBQW9CLG9CQUFJLElBQVk7QUF3QzVDO0FBQUEsU0FBUSxnQkFBc0Q7QUF5VTlEO0FBQUEsU0FBUSxZQUFnQztBQUFBO0FBQUEsRUE1aUJ4QyxNQUFNLFNBQXdCO0FBRTVCLFVBQU0sS0FBSyxhQUFhO0FBR3hCLFNBQUssY0FBYyxJQUFJLHNCQUFzQixLQUFLLEtBQUssSUFBSSxDQUFDO0FBRzVELFNBQUssYUFBYSxXQUFXLENBQUMsU0FBUztBQUNyQyxZQUFNLE9BQU8sSUFBSSxVQUFVLElBQUk7QUFDL0IsV0FBSyxtQkFBbUIsQ0FBQyxVQUFVLGNBQ2pDLEtBQUssV0FBVyxVQUFVLFNBQVM7QUFDckMsV0FBSyxpQkFBaUIsQ0FBQyxhQUFhLEtBQUssU0FBUyxRQUFRO0FBQzFELGFBQU87QUFBQSxJQUNULENBQUM7QUFHRCxTQUFLLGFBQWEsaUJBQWlCLENBQUMsU0FBUztBQUMzQyxZQUFNLE9BQU8sSUFBSSxnQkFBZ0IsSUFBSTtBQUNyQyxXQUFLLFdBQVcsTUFBTTtBQUNwQixZQUFJLENBQUMsS0FBSztBQUFNO0FBQ2hCLGNBQU0sUUFBUSxlQUFlLEtBQUssV0FBVztBQUM3QyxjQUFNLGVBQWUsTUFBTSxLQUFLLENBQUMsTUFBTSxFQUFFLGFBQWEsS0FBSyxLQUFNLElBQUk7QUFDckUsWUFBSSxrQkFBa0IsS0FBSyxLQUFLLE9BQU87QUFBQSxVQUNyQztBQUFBLFVBQ0EsV0FBVyxZQUFZO0FBQ3JCLGtCQUFNLEtBQUssWUFBWTtBQUFBLFVBQ3pCO0FBQUEsUUFDRixDQUFDLEVBQUUsS0FBSztBQUFBLE1BQ1Y7QUFDQSxhQUFPO0FBQUEsSUFDVCxDQUFDO0FBR0QsU0FBSyxrQkFBa0IsSUFBSSxrQkFBa0IsS0FBSyxHQUFHO0FBQ3JELFNBQUssZ0JBQWdCLGNBQWMsQ0FBQyxVQUFVLEtBQUssZ0JBQWdCLEtBQUs7QUFDeEUsU0FBSyxzQkFBc0IsS0FBSyxlQUFlO0FBRy9DLFNBQUssd0JBQXdCLENBQUMsdUJBQXVCLHVCQUF1QixDQUFDO0FBRzdFLFNBQUs7QUFBQSxNQUNILENBQUMsSUFBaUIsUUFBc0M7QUFDdEQsYUFBSyxtQkFBbUIsRUFBRTtBQUFBLE1BQzVCO0FBQUEsSUFDRjtBQUdBLFNBQUssY0FBYyxZQUFZLHFCQUFxQixNQUFNO0FBQ3hELFdBQUssYUFBYTtBQUFBLElBQ3BCLENBQUM7QUFHRCxTQUFLLFdBQVc7QUFBQSxNQUNkLElBQUk7QUFBQSxNQUNKLE1BQU07QUFBQSxNQUNOLFVBQVUsTUFBTSxLQUFLLGFBQWE7QUFBQSxJQUNwQyxDQUFDO0FBRUQsU0FBSyxXQUFXO0FBQUEsTUFDZCxJQUFJO0FBQUEsTUFDSixNQUFNO0FBQUEsTUFDTixVQUFVLE1BQU0sS0FBSyxZQUFZO0FBQUEsSUFDbkMsQ0FBQztBQUVELFNBQUssV0FBVztBQUFBLE1BQ2QsSUFBSTtBQUFBLE1BQ0osTUFBTTtBQUFBLE1BQ04sVUFBVSxNQUFNLEtBQUssZ0JBQWdCO0FBQUEsTUFDckMsU0FBUyxDQUFDLEVBQUUsV0FBVyxDQUFDLEtBQUssR0FBRyxLQUFLLFFBQVEsQ0FBQztBQUFBLElBQ2hELENBQUM7QUFFRCxTQUFLLFdBQVc7QUFBQSxNQUNkLElBQUk7QUFBQSxNQUNKLE1BQU07QUFBQSxNQUNOLFVBQVUsTUFBTSxLQUFLLGdCQUFnQjtBQUFBLElBQ3ZDLENBQUM7QUFFRCxTQUFLLFdBQVc7QUFBQSxNQUNkLElBQUk7QUFBQSxNQUNKLE1BQU07QUFBQSxNQUNOLGVBQWUsQ0FBQyxhQUFhO0FBQzNCLGNBQU0sT0FBTyxLQUFLLElBQUksVUFBVSxjQUFjO0FBQzlDLFlBQUksQ0FBQyxRQUFRLEtBQUssY0FBYztBQUFNLGlCQUFPO0FBQzdDLGNBQU0sT0FBTyxLQUFLLElBQUksVUFBVTtBQUNoQyxZQUFJLENBQUM7QUFBTSxpQkFBTztBQUNsQixZQUFJLEtBQUssS0FBSyxZQUFZLE1BQU07QUFBaUIsaUJBQU87QUFDeEQsWUFBSTtBQUFVLGlCQUFPO0FBQ3JCLGFBQUssYUFBYTtBQUFBLFVBQ2hCLE1BQU07QUFBQSxVQUNOLE9BQU8sRUFBRSxNQUFNLEtBQUssS0FBSztBQUFBLFFBQzNCLENBQUM7QUFDRCxlQUFPO0FBQUEsTUFDVDtBQUFBLElBQ0YsQ0FBQztBQUVELFNBQUssV0FBVztBQUFBLE1BQ2QsSUFBSTtBQUFBLE1BQ0osTUFBTTtBQUFBLE1BQ04sZUFBZSxDQUFDLGFBQWE7QUFDM0IsY0FBTSxPQUFPLEtBQUssSUFBSSxVQUFVO0FBQ2hDLFlBQUksQ0FBQyxRQUFRLEtBQUssS0FBSyxZQUFZLE1BQU07QUFBaUIsaUJBQU87QUFDakUsWUFBSTtBQUFVLGlCQUFPO0FBQ3JCLGNBQU0sT0FBTyxLQUFLLElBQUksVUFBVSxjQUFjO0FBQzlDLFlBQUksQ0FBQztBQUFNLGlCQUFPO0FBQ2xCLGFBQUssYUFBYTtBQUFBLFVBQ2hCLE1BQU07QUFBQSxVQUNOLE9BQU8sRUFBRSxNQUFNLEtBQUssS0FBSztBQUFBLFFBQzNCLENBQUM7QUFDRCxlQUFPO0FBQUEsTUFDVDtBQUFBLElBQ0YsQ0FBQztBQUdELFNBQUs7QUFBQSxNQUNILEtBQUssSUFBSSxVQUFVLEdBQUcsYUFBYSxDQUFDLFNBQVM7QUFDM0MsWUFBSSxDQUFDLFFBQVEsRUFBRSxnQkFBZ0IsMkJBQVUsS0FBSyxjQUFjO0FBQU07QUFDbEUsWUFBSSxDQUFDLEtBQUssU0FBUztBQUE0QjtBQUUvQyxjQUFNLE9BQU8sS0FBSyxJQUFJLFVBQVUsb0JBQW9CLDZCQUFtQixHQUFHLFFBQ3JFLEtBQUssSUFBSSxVQUFVO0FBQ3hCLFlBQUksQ0FBQztBQUFNO0FBR1gsWUFBSSxLQUFLLEtBQUssWUFBWSxNQUFNO0FBQWlCO0FBR2pELGFBQUssSUFBSSxNQUFNLEtBQUssSUFBSSxFQUFFLEtBQUssQ0FBQyxZQUFZO0FBQzFDLGdCQUFNLE1BQU0sS0FBSyxTQUFTLGNBQWMsS0FBSztBQUM3QyxjQUFJLE9BQU8sQ0FBQyxLQUFLLFdBQVcsU0FBUyxHQUFHO0FBQUc7QUFDM0MsY0FBSSxDQUFDLHFCQUFxQixTQUFTLEtBQUssSUFBSTtBQUFHO0FBRS9DLGVBQUssYUFBYTtBQUFBLFlBQ2hCLE1BQU07QUFBQSxZQUNOLE9BQU8sRUFBRSxNQUFNLEtBQUssS0FBSztBQUFBLFVBQzNCLENBQUM7QUFBQSxRQUNILENBQUM7QUFBQSxNQUNILENBQUM7QUFBQSxJQUNIO0FBR0EsU0FBSztBQUFBLE1BQ0gsS0FBSyxJQUFJLFVBQVUsR0FBRyxpQkFBaUIsTUFBTTtBQUMzQyxhQUFLLHVCQUF1QjtBQUFBLE1BQzlCLENBQUM7QUFBQSxJQUNIO0FBR0EsU0FBSyxJQUFJLFVBQVUsY0FBYyxNQUFNO0FBQ3JDLFdBQUssWUFBWTtBQUFBLElBQ25CLENBQUM7QUFHRCxTQUFLO0FBQUEsTUFDSCxLQUFLLElBQUksTUFBTSxHQUFHLFVBQVUsQ0FBQyxTQUFTO0FBQ3BDLFlBQUksZ0JBQWdCLDBCQUFTLEtBQUssY0FBYyxNQUFNO0FBQ3BELGVBQUssZ0JBQWdCO0FBQUEsUUFDdkI7QUFBQSxNQUNGLENBQUM7QUFBQSxJQUNIO0FBQ0EsU0FBSztBQUFBLE1BQ0gsS0FBSyxJQUFJLE1BQU0sR0FBRyxVQUFVLENBQUMsU0FBUztBQUNwQyxZQUFJLGdCQUFnQiwwQkFBUyxLQUFLLGNBQWMsTUFBTTtBQUNwRCxlQUFLLGdCQUFnQjtBQUFBLFFBQ3ZCO0FBQUEsTUFDRixDQUFDO0FBQUEsSUFDSDtBQUNBLFNBQUs7QUFBQSxNQUNILEtBQUssSUFBSSxNQUFNLEdBQUcsVUFBVSxDQUFDLFNBQVM7QUFDcEMsWUFBSSxnQkFBZ0IsMEJBQVMsS0FBSyxjQUFjLE1BQU07QUFDcEQsZUFBSyxnQkFBZ0I7QUFBQSxRQUN2QjtBQUFBLE1BQ0YsQ0FBQztBQUFBLElBQ0g7QUFBQSxFQUNGO0FBQUEsRUFFQSxXQUFpQjtBQUNmLFNBQUssSUFBSSxVQUFVLG1CQUFtQixTQUFTO0FBQy9DLFNBQUssSUFBSSxVQUFVLG1CQUFtQixlQUFlO0FBRXJELGFBQVMsaUJBQWlCLG9CQUFvQixFQUFFLFFBQVEsQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDO0FBQUEsRUFDN0U7QUFBQSxFQU9RLHlCQUErQjtBQUNyQyxlQUFXLFFBQVEsS0FBSyxJQUFJLFVBQVUsZ0JBQWdCLFVBQVUsR0FBRztBQUNqRSxZQUFNLFVBQVcsS0FBSyxLQUFhLGFBQWEsY0FBYyxlQUFlO0FBQzdFLFVBQUksQ0FBQyxXQUFXLFFBQVEsY0FBYyxvQkFBb0I7QUFBRztBQUU3RCxZQUFNLE9BQVEsS0FBSyxLQUFhO0FBQ2hDLFVBQUksQ0FBQyxRQUFRLEtBQUssY0FBYztBQUFNO0FBR3RDLFlBQU0sU0FBVSxLQUFhLE1BQU0sS0FBSztBQUN4QyxVQUFJLENBQUMsS0FBSyxrQkFBa0IsSUFBSSxNQUFNLEdBQUc7QUFFdkMsYUFBSyxJQUFJLE1BQU0sS0FBSyxJQUFJLEVBQUUsS0FBSyxDQUFDLFlBQVk7QUFDMUMsZ0JBQU0sTUFBTSxLQUFLLFNBQVMsY0FBYyxLQUFLO0FBQzdDLGNBQUksT0FBTyxDQUFDLEtBQUssV0FBVyxTQUFTLEdBQUc7QUFBRztBQUMzQyxjQUFJLENBQUMscUJBQXFCLFNBQVMsS0FBSyxJQUFJO0FBQUc7QUFDL0MsZUFBSyxrQkFBa0IsSUFBSSxNQUFNO0FBQ2pDLGVBQUssdUJBQXVCO0FBQUEsUUFDOUIsQ0FBQztBQUNEO0FBQUEsTUFDRjtBQUVBLFlBQU0sTUFBTSxTQUFTLGNBQWMsUUFBUTtBQUMzQyxVQUFJLFlBQVk7QUFDaEIsVUFBSSxhQUFhLGNBQWMsZUFBZTtBQUM5QyxvQ0FBUSxLQUFLLE9BQU87QUFDcEIsVUFBSSxpQkFBaUIsU0FBUyxNQUFNO0FBQ2xDLGFBQUssYUFBYTtBQUFBLFVBQ2hCLE1BQU07QUFBQSxVQUNOLE9BQU8sRUFBRSxNQUFNLEtBQUssS0FBSztBQUFBLFFBQzNCLENBQUM7QUFBQSxNQUNILENBQUM7QUFDRCxjQUFRLGFBQWEsS0FBSyxRQUFRLFVBQVU7QUFBQSxJQUM5QztBQUFBLEVBQ0Y7QUFBQSxFQU1RLGtCQUF3QjtBQUM5QixRQUFJLEtBQUs7QUFBZSxtQkFBYSxLQUFLLGFBQWE7QUFDdkQsU0FBSyxnQkFBZ0IsV0FBVyxNQUFNLEtBQUssWUFBWSxHQUFHLEdBQUc7QUFBQSxFQUMvRDtBQUFBO0FBQUEsRUFJQSxNQUFjLGNBQTZCO0FBQ3pDLFVBQU0sY0FBYyxNQUFNLEtBQUsscUJBQXFCO0FBQ3BELFNBQUssY0FBYztBQUNuQixVQUFNLFdBQVcsTUFBTSxLQUFLLGlCQUFpQjtBQUc3QyxTQUFLLGFBQWEsQ0FBQztBQUNuQixTQUFLLGNBQWMsb0JBQUksSUFBSTtBQUMzQixVQUFNLFVBQW9CLENBQUM7QUFFM0IsVUFBTSxhQUErQyxvQkFBSSxJQUFJO0FBRTdELFVBQU0sZUFBb0Msb0JBQUksSUFBSTtBQUdsRCxlQUFXLFFBQVEsYUFBYTtBQUM5QixtQkFBYSxJQUFJLEtBQUssVUFBVSxLQUFLLFdBQVc7QUFFaEQsVUFBSSxDQUFDLFdBQVcsSUFBSSxLQUFLLFFBQVEsR0FBRztBQUNsQyxtQkFBVyxJQUFJLEtBQUssVUFBVSxvQkFBSSxJQUFJLENBQUM7QUFBQSxNQUN6QztBQUNBLFlBQU0sUUFBUSxXQUFXLElBQUksS0FBSyxRQUFRO0FBRTFDLGlCQUFXLE9BQU8sS0FBSyxTQUFTO0FBQzlCLGFBQUssV0FBVyxLQUFLLEdBQUc7QUFHeEIsWUFBSSxNQUFNLElBQUksSUFBSSxFQUFFLEdBQUc7QUFDckIsa0JBQVE7QUFBQSxZQUNOLE1BQU0sSUFBSSxFQUFFLGtCQUFrQixJQUFJLFNBQVMsTUFBTSxNQUFNLElBQUksSUFBSSxFQUFFLENBQUMsVUFBVSxJQUFJLFFBQVE7QUFBQSxVQUMxRjtBQUFBLFFBQ0Y7QUFDQSxjQUFNLElBQUksSUFBSSxJQUFJLElBQUksUUFBUTtBQUFBLE1BQ2hDO0FBQUEsSUFDRjtBQUlBLFVBQU0sWUFBWSxvQkFBSSxJQUE0QjtBQUNsRCxlQUFXLE9BQU8sS0FBSyxZQUFZO0FBQ2pDLFlBQU0sSUFBSSxJQUFJLFNBQVMsWUFBWTtBQUNuQyxVQUFJLENBQUMsVUFBVSxJQUFJLENBQUM7QUFBRyxrQkFBVSxJQUFJLEdBQUcsQ0FBQyxDQUFDO0FBQzFDLGdCQUFVLElBQUksQ0FBQyxFQUFHLEtBQUssR0FBRztBQUFBLElBQzVCO0FBRUEsZUFBVyxDQUFDLEVBQUUsS0FBSyxLQUFLLFdBQVc7QUFDakMsVUFBSSxNQUFNLFdBQVcsR0FBRztBQUV0QjtBQUFBLE1BQ0Y7QUFJQSxZQUFNLGFBQWEsb0JBQUksSUFBNEI7QUFDbkQsaUJBQVcsT0FBTyxPQUFPO0FBQ3ZCLGNBQU0sS0FBSyxJQUFJLFVBQVUsWUFBWTtBQUNyQyxZQUFJLENBQUMsV0FBVyxJQUFJLEVBQUU7QUFBRyxxQkFBVyxJQUFJLElBQUksQ0FBQyxDQUFDO0FBQzlDLG1CQUFXLElBQUksRUFBRSxFQUFHLEtBQUssR0FBRztBQUFBLE1BQzlCO0FBRUEsaUJBQVcsQ0FBQyxFQUFFLE1BQU0sS0FBSyxZQUFZO0FBQ25DLFlBQUksT0FBTyxXQUFXLEdBQUc7QUFFdkIsaUJBQU8sQ0FBQyxFQUFFLGFBQWEsR0FBRyxPQUFPLENBQUMsRUFBRSxRQUFRLEtBQUssT0FBTyxDQUFDLEVBQUUsU0FBUztBQUFBLFFBQ3RFLE9BQU87QUFFTCxxQkFBVyxPQUFPLFFBQVE7QUFDeEIsa0JBQU0sVUFBVSxhQUFhLElBQUksSUFBSSxRQUFRLEtBQUs7QUFDbEQsa0JBQU0sWUFBWSxrQkFBa0IsS0FBSyxPQUFPO0FBQ2hELGdCQUFJLFdBQVc7QUFDYixrQkFBSSxhQUFhLEdBQUcsSUFBSSxRQUFRLEtBQUssU0FBUztBQUFBLFlBQ2hELE9BQU87QUFFTCxrQkFBSSxhQUFhLEdBQUcsSUFBSSxRQUFRLE1BQU0sSUFBSSxFQUFFO0FBQUEsWUFDOUM7QUFBQSxVQUNGO0FBQUEsUUFDRjtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBSUEsZUFBVyxPQUFPLEtBQUssWUFBWTtBQUNqQyxXQUFLLFlBQVksSUFBSSxJQUFJLFdBQVcsWUFBWSxHQUFHLEdBQUc7QUFBQSxJQUN4RDtBQUdBLGVBQVcsQ0FBQyxHQUFHLEtBQUssS0FBSyxXQUFXO0FBQ2xDLFVBQUksTUFBTSxXQUFXLEdBQUc7QUFDdEIsYUFBSyxZQUFZLElBQUksR0FBRyxNQUFNLENBQUMsQ0FBQztBQUFBLE1BQ2xDO0FBQUEsSUFDRjtBQUdBLFFBQUksUUFBUSxTQUFTLEdBQUc7QUFDdEIsVUFBSTtBQUFBLFFBQ0Y7QUFBQSxFQUF1QyxRQUFRLEtBQUssSUFBSSxDQUFDO0FBQUEsUUFDekQ7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUdBLFFBQUksS0FBSyxpQkFBaUI7QUFDeEIsV0FBSyxnQkFBZ0IsV0FBVyxLQUFLLFVBQVU7QUFBQSxJQUNqRDtBQUdBLFNBQUssWUFBWSxXQUFXLGFBQWEsUUFBUTtBQUdqRCxTQUFLLElBQUksVUFBVSxnQkFBZ0IsU0FBUyxFQUFFLFFBQVEsQ0FBQyxTQUFTO0FBQzlELFVBQUksS0FBSyxnQkFBZ0IsV0FBVztBQUNsQyxhQUFLLEtBQUssbUJBQW1CLENBQUMsSUFBSSxPQUFPLEtBQUssV0FBVyxJQUFJLEVBQUU7QUFDL0QsYUFBSyxLQUFLLGlCQUFpQixDQUFDLE9BQU8sS0FBSyxTQUFTLEVBQUU7QUFDbkQsYUFBSyxLQUFLLGFBQWEsS0FBSyxTQUFVO0FBQUEsTUFDeEM7QUFBQSxJQUNGLENBQUM7QUFBQSxFQUNIO0FBQUE7QUFBQSxFQUlBLE1BQWMsdUJBQThDO0FBQzFELFVBQU0sUUFBUSxLQUFLLElBQUksTUFBTSxpQkFBaUI7QUFDOUMsVUFBTSxTQUF1QixDQUFDO0FBQzlCLFVBQU0sTUFBTSxLQUFLLFNBQVMsY0FBYyxLQUFLO0FBRTdDLGVBQVcsUUFBUSxPQUFPO0FBQ3hCLFVBQUk7QUFDRixjQUFNLFVBQVUsTUFBTSxLQUFLLElBQUksTUFBTSxLQUFLLElBQUk7QUFJOUMsWUFBSSxLQUFLO0FBQ1AsY0FBSSxDQUFDLEtBQUssV0FBVyxTQUFTLEdBQUc7QUFBRztBQUFBLFFBQ3RDO0FBRUEsY0FBTSxTQUFTLHFCQUFxQixTQUFTLEtBQUssSUFBSTtBQUN0RCxZQUFJO0FBQVEsaUJBQU8sS0FBSyxNQUFNO0FBQUEsTUFDaEMsUUFBUTtBQUFBLE1BRVI7QUFBQSxJQUNGO0FBQ0EsV0FBTztBQUFBLEVBQ1Q7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBU1EsV0FBVyxTQUFpQixLQUFzQjtBQUN4RCxVQUFNLFdBQVcsSUFBSSxZQUFZO0FBSWpDLFVBQU0sZUFBZSxJQUFJO0FBQUEsTUFDdkIsYUFBYSxJQUFJLFFBQVEsdUJBQXVCLE1BQU0sQ0FBQztBQUFBLE1BQ3ZEO0FBQUEsSUFDRjtBQUNBLFFBQUksYUFBYSxLQUFLLE9BQU87QUFBRyxhQUFPO0FBR3ZDLFFBQUksQ0FBQyxRQUFRLFdBQVcsS0FBSztBQUFHLGFBQU87QUFDdkMsVUFBTSxTQUFTLFFBQVEsUUFBUSxTQUFTLENBQUM7QUFDekMsUUFBSSxXQUFXO0FBQUksYUFBTztBQUMxQixVQUFNLGNBQWMsUUFBUSxVQUFVLEdBQUcsTUFBTTtBQUcvQyxlQUFXLFFBQVEsWUFBWSxNQUFNLElBQUksR0FBRztBQUMxQyxZQUFNLFVBQVUsS0FBSyxLQUFLO0FBQzFCLFlBQU0sUUFBUSxRQUFRLE1BQU0scUJBQXFCO0FBQ2pELFVBQUksQ0FBQztBQUFPO0FBRVosVUFBSSxRQUFRLE1BQU0sQ0FBQyxFQUFFLEtBQUs7QUFHMUIsVUFBSSxNQUFNLFdBQVcsR0FBRyxLQUFLLE1BQU0sU0FBUyxHQUFHLEdBQUc7QUFDaEQsZ0JBQVEsTUFBTSxNQUFNLEdBQUcsRUFBRTtBQUFBLE1BQzNCO0FBRUEsWUFBTSxPQUFPLE1BQU0sTUFBTSxHQUFHLEVBQUUsSUFBSSxDQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUUsWUFBWSxDQUFDO0FBQy9ELFVBQUksS0FBSyxTQUFTLFFBQVE7QUFBRyxlQUFPO0FBQUEsSUFDdEM7QUFNQSxVQUFNLFlBQVk7QUFDbEIsVUFBTSxZQUFZLFVBQVUsS0FBSyxXQUFXO0FBQzVDLFFBQUksV0FBVztBQUNiLFlBQU0sWUFBWSxZQUFZO0FBQUEsUUFDNUIsVUFBVSxRQUFRLFVBQVUsQ0FBQyxFQUFFO0FBQUEsTUFDakM7QUFDQSxpQkFBVyxRQUFRLFVBQVUsTUFBTSxJQUFJLEdBQUc7QUFDeEMsY0FBTSxVQUFVLEtBQUssS0FBSztBQUMxQixZQUFJLFFBQVEsV0FBVyxJQUFJLEdBQUc7QUFDNUIsZ0JBQU0sU0FBUyxRQUFRLFVBQVUsQ0FBQyxFQUFFLEtBQUssRUFBRSxZQUFZO0FBQ3ZELGNBQUksV0FBVztBQUFVLG1CQUFPO0FBQUEsUUFDbEMsV0FBVyxRQUFRLFNBQVMsS0FBSyxDQUFDLFFBQVEsV0FBVyxHQUFHLEdBQUc7QUFDekQ7QUFBQSxRQUNGO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFFQSxXQUFPO0FBQUEsRUFDVDtBQUFBLEVBRUEsTUFBYyxtQkFBeUM7QUFDckQsVUFBTSxRQUFRLEtBQUssSUFBSSxNQUFNLGlCQUFpQjtBQUM5QyxVQUFNLFNBQXNCLENBQUM7QUFDN0IsZUFBVyxRQUFRLE9BQU87QUFDeEIsVUFBSTtBQUNGLGNBQU0sVUFBVSxNQUFNLEtBQUssSUFBSSxNQUFNLEtBQUssSUFBSTtBQUM5QyxlQUFPLEtBQUssRUFBRSxNQUFNLEtBQUssTUFBTSxVQUFVLEtBQUssVUFBVSxRQUFRLENBQUM7QUFBQSxNQUNuRSxRQUFRO0FBQUEsTUFFUjtBQUFBLElBQ0Y7QUFDQSxXQUFPO0FBQUEsRUFDVDtBQUFBO0FBQUEsRUFJUSxtQkFBbUIsSUFBdUI7QUFFaEQsVUFBTSxTQUFTLFNBQVMsaUJBQWlCLElBQUksV0FBVyxTQUFTO0FBQ2pFLFVBQU0saUJBQStELENBQUM7QUFFdEUsUUFBSTtBQUNKLFdBQVEsV0FBVyxPQUFPLFNBQVMsR0FBbUI7QUFDcEQsWUFBTSxPQUFPLFNBQVMsZUFBZTtBQUNyQyxZQUFNLFFBQVE7QUFDZCxZQUFNLFVBQTZCLENBQUM7QUFDcEMsVUFBSTtBQUNKLGNBQVEsUUFBUSxNQUFNLEtBQUssSUFBSSxPQUFPLE1BQU07QUFDMUMsZ0JBQVEsS0FBSyxFQUFFLEdBQUcsT0FBTyxPQUFPLE1BQU0sTUFBTSxDQUFvQjtBQUFBLE1BQ2xFO0FBQ0EsVUFBSSxRQUFRLFNBQVMsR0FBRztBQUN0Qix1QkFBZSxLQUFLLEVBQUUsTUFBTSxVQUFVLFFBQVEsQ0FBQztBQUFBLE1BQ2pEO0FBQUEsSUFDRjtBQUVBLGVBQVcsRUFBRSxNQUFNLFFBQVEsS0FBSyxnQkFBZ0I7QUFDOUMsWUFBTSxPQUFPLEtBQUssZUFBZTtBQUNqQyxZQUFNLFNBQVMsS0FBSztBQUNwQixVQUFJLENBQUM7QUFBUTtBQUViLFlBQU0sT0FBTyxTQUFTLHVCQUF1QjtBQUM3QyxVQUFJLFlBQVk7QUFFaEIsaUJBQVcsU0FBUyxTQUFTO0FBRTNCLFlBQUksTUFBTSxRQUFRLFdBQVc7QUFDM0IsZUFBSztBQUFBLFlBQ0gsU0FBUyxlQUFlLEtBQUssVUFBVSxXQUFXLE1BQU0sS0FBSyxDQUFDO0FBQUEsVUFDaEU7QUFBQSxRQUNGO0FBR0EsWUFBSSxhQUFhLE1BQU0sQ0FBQztBQUN4QixZQUFJLGNBQWM7QUFDbEIsY0FBTSxVQUFVLFdBQVcsUUFBUSxHQUFHO0FBQ3RDLFlBQUksWUFBWSxJQUFJO0FBQ2xCLHdCQUFjLFdBQVcsVUFBVSxVQUFVLENBQUMsRUFBRSxLQUFLO0FBQ3JELHVCQUFhLFdBQVcsVUFBVSxHQUFHLE9BQU8sRUFBRSxLQUFLO0FBQUEsUUFDckQ7QUFFQSxjQUFNLE9BQU8sU0FBUyxjQUFjLE1BQU07QUFDMUMsYUFBSyxZQUFZO0FBQ2pCLGFBQUssY0FBYztBQUNuQixhQUFLLGFBQWEsa0JBQWtCLFVBQVU7QUFFOUMsY0FBTSxNQUFNLEtBQUssWUFBWSxJQUFJLFdBQVcsWUFBWSxDQUFDO0FBQ3pELFlBQUksQ0FBQyxLQUFLO0FBQ1IsZUFBSyxVQUFVLElBQUksMkJBQTJCO0FBQUEsUUFDaEQ7QUFHQSxhQUFLLGlCQUFpQixTQUFTLENBQUMsTUFBTTtBQUNwQyxZQUFFLGVBQWU7QUFDakIsWUFBRSxnQkFBZ0I7QUFDbEIsZ0JBQU0sU0FBUyxLQUFLLGFBQWEsZ0JBQWdCLEtBQUs7QUFDdEQsZ0JBQU0sWUFBWSxLQUFLLFlBQVksSUFBSSxPQUFPLFlBQVksQ0FBQztBQUMzRCxjQUFJLFdBQVc7QUFDYixpQkFBSyxXQUFXLFVBQVUsVUFBVSxVQUFVLFNBQVM7QUFBQSxVQUN6RCxPQUFPO0FBQ0wsZ0JBQUksd0JBQU8sV0FBVyxNQUFNLGFBQWE7QUFBQSxVQUMzQztBQUFBLFFBQ0YsQ0FBQztBQUdELGFBQUssaUJBQWlCLGNBQWMsQ0FBQyxNQUFNO0FBQ3pDLGdCQUFNLFNBQVMsS0FBSyxhQUFhLGdCQUFnQixLQUFLO0FBQ3RELGdCQUFNLFlBQVksS0FBSyxZQUFZLElBQUksT0FBTyxZQUFZLENBQUM7QUFDM0QsY0FBSSxXQUFXO0FBQ2IsaUJBQUssa0JBQWtCLE1BQU0sU0FBUztBQUFBLFVBQ3hDO0FBQUEsUUFDRixDQUFDO0FBQ0QsYUFBSyxpQkFBaUIsY0FBYyxNQUFNO0FBQ3hDLGVBQUssa0JBQWtCO0FBQUEsUUFDekIsQ0FBQztBQUVELGFBQUssWUFBWSxJQUFJO0FBQ3JCLG9CQUFZLE1BQU0sUUFBUSxNQUFNLENBQUMsRUFBRTtBQUFBLE1BQ3JDO0FBR0EsVUFBSSxZQUFZLEtBQUssUUFBUTtBQUMzQixhQUFLLFlBQVksU0FBUyxlQUFlLEtBQUssVUFBVSxTQUFTLENBQUMsQ0FBQztBQUFBLE1BQ3JFO0FBRUEsYUFBTyxhQUFhLE1BQU0sSUFBSTtBQUFBLElBQ2hDO0FBQUEsRUFDRjtBQUFBLEVBTVEsa0JBQWtCLFFBQXFCLEtBQXlCO0FBQ3RFLFNBQUssa0JBQWtCO0FBRXZCLFVBQU0sTUFBTSxTQUFTLGNBQWMsS0FBSztBQUN4QyxRQUFJLFlBQVk7QUFFaEIsVUFBTSxRQUFRLFNBQVMsY0FBYyxLQUFLO0FBQzFDLFVBQU0sWUFBWTtBQUNsQixVQUFNLGNBQWMsSUFBSTtBQUN4QixRQUFJLFlBQVksS0FBSztBQUVyQixVQUFNLE9BQU8sU0FBUyxjQUFjLEtBQUs7QUFDekMsU0FBSyxZQUFZO0FBQ2pCLFNBQUssY0FBYyxJQUFJO0FBQ3ZCLFFBQUksWUFBWSxJQUFJO0FBRXBCLGVBQVcsQ0FBQyxHQUFHLENBQUMsS0FBSyxPQUFPLFFBQVEsSUFBSSxVQUFVLEdBQUc7QUFDbkQsWUFBTSxNQUFNLFNBQVMsY0FBYyxLQUFLO0FBQ3hDLFVBQUksWUFBWTtBQUNoQixVQUFJLFlBQVksZ0NBQWdDLENBQUMsdUNBQXVDLENBQUM7QUFDekYsVUFBSSxZQUFZLEdBQUc7QUFBQSxJQUNyQjtBQUVBLGFBQVMsS0FBSyxZQUFZLEdBQUc7QUFDN0IsU0FBSyxZQUFZO0FBR2pCLFVBQU0sT0FBTyxPQUFPLHNCQUFzQjtBQUMxQyxRQUFJLE1BQU0sTUFBTSxLQUFLLFNBQVMsSUFBSTtBQUNsQyxRQUFJLE1BQU0sT0FBTyxLQUFLLE9BQU87QUFBQSxFQUMvQjtBQUFBLEVBRVEsb0JBQTBCO0FBQ2hDLFFBQUksS0FBSyxXQUFXO0FBQ2xCLFdBQUssVUFBVSxPQUFPO0FBQ3RCLFdBQUssWUFBWTtBQUFBLElBQ25CO0FBQUEsRUFDRjtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQVFRLGdCQUFnQixZQUEyQjtBQUNqRCxVQUFNLFFBQVEsZUFBZSxLQUFLLFdBQVc7QUFDN0MsUUFBSSxNQUFNLFdBQVcsR0FBRztBQUN0QixVQUFJLHdCQUFPLGdEQUFnRDtBQUMzRDtBQUFBLElBQ0Y7QUFHQSxVQUFNLGFBQWEsS0FBSyxJQUFJLFVBQVUsY0FBYztBQUNwRCxRQUFJO0FBQ0osUUFBSSxZQUFZO0FBQ2QscUJBQWUsTUFBTSxLQUFLLENBQUMsTUFBTSxFQUFFLGFBQWEsV0FBVyxJQUFJO0FBQUEsSUFDakU7QUFFQSxRQUFJLGtCQUFrQixLQUFLLEtBQUssT0FBTztBQUFBLE1BQ3JDO0FBQUEsTUFDQSxZQUFZLGNBQWM7QUFBQSxNQUMxQixXQUFXLE9BQU8sYUFBYTtBQUM3QixjQUFNLEtBQUssWUFBWTtBQUV2QixjQUFNLE9BQU8sS0FBSyxJQUFJLE1BQU0sc0JBQXNCLFFBQVE7QUFDMUQsWUFBSSxnQkFBZ0Isd0JBQU87QUFDekIsZ0JBQU0sVUFBVSxNQUFNLEtBQUssSUFBSSxNQUFNLEtBQUssSUFBSTtBQUU5QyxnQkFBTSxhQUFhLFFBQVEsWUFBWSxTQUFTO0FBQ2hELGdCQUFNLGFBQWEsY0FBYyxJQUM3QixRQUFRLFVBQVUsR0FBRyxVQUFVLEVBQUUsTUFBTSxJQUFJLEVBQUUsU0FBUyxJQUN0RCxRQUFRLE1BQU0sSUFBSSxFQUFFLFNBQVM7QUFDakMsZ0JBQU0sS0FBSyxXQUFXLFVBQVUsVUFBVTtBQUFBLFFBQzVDO0FBQUEsTUFDRjtBQUFBLElBQ0YsQ0FBQyxFQUFFLEtBQUs7QUFBQSxFQUNWO0FBQUE7QUFBQSxFQUlBLE1BQWMsV0FBVyxVQUFrQixXQUFrQztBQUMzRSxVQUFNLE9BQU8sS0FBSyxJQUFJLE1BQU0sc0JBQXNCLFFBQVE7QUFDMUQsUUFBSSxFQUFFLGdCQUFnQix5QkFBUTtBQUM1QixVQUFJLHdCQUFPLG1CQUFtQixRQUFRLEVBQUU7QUFDeEM7QUFBQSxJQUNGO0FBRUEsVUFBTSxPQUFPLEtBQUssSUFBSSxVQUFVLFFBQVEsS0FBSztBQUM3QyxVQUFNLEtBQUssU0FBUyxJQUFJO0FBR3hCLFVBQU0sT0FBTyxLQUFLO0FBQ2xCLFFBQUksUUFBUSxLQUFLLFFBQVE7QUFFdkIsaUJBQVcsTUFBTTtBQUNmLFlBQUk7QUFDRixlQUFLLE9BQU8sVUFBVSxFQUFFLE1BQU0sV0FBVyxJQUFJLEVBQUUsQ0FBQztBQUNoRCxlQUFLLE9BQU87QUFBQSxZQUNWLEVBQUUsTUFBTSxFQUFFLE1BQU0sV0FBVyxJQUFJLEVBQUUsR0FBRyxJQUFJLEVBQUUsTUFBTSxZQUFZLEdBQUcsSUFBSSxFQUFFLEVBQUU7QUFBQSxZQUN2RTtBQUFBLFVBQ0Y7QUFBQSxRQUNGLFFBQVE7QUFBQSxRQUVSO0FBQUEsTUFDRixHQUFHLEdBQUc7QUFBQSxJQUNSO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBYyxTQUFTLFVBQWlDO0FBQ3RELFVBQU0sT0FBTyxLQUFLLElBQUksTUFBTSxzQkFBc0IsUUFBUTtBQUMxRCxRQUFJLEVBQUUsZ0JBQWdCLHlCQUFRO0FBQzVCLFVBQUksd0JBQU8sbUJBQW1CLFFBQVEsRUFBRTtBQUN4QztBQUFBLElBQ0Y7QUFDQSxVQUFNLE9BQU8sS0FBSyxJQUFJLFVBQVUsUUFBUSxLQUFLO0FBQzdDLFVBQU0sS0FBSyxTQUFTLElBQUk7QUFBQSxFQUMxQjtBQUFBO0FBQUEsRUFJQSxNQUFNLGVBQThCO0FBQ2xDLFVBQU0sRUFBRSxVQUFVLElBQUksS0FBSztBQUUzQixRQUFJLE9BQTZCO0FBQ2pDLFVBQU0sU0FBUyxVQUFVLGdCQUFnQixTQUFTO0FBRWxELFFBQUksT0FBTyxTQUFTLEdBQUc7QUFDckIsYUFBTyxPQUFPLENBQUM7QUFBQSxJQUNqQixPQUFPO0FBQ0wsYUFBTyxVQUFVLFFBQVEsS0FBSztBQUM5QixZQUFNLEtBQUssYUFBYSxFQUFFLE1BQU0sV0FBVyxRQUFRLEtBQUssQ0FBQztBQUFBLElBQzNEO0FBRUEsY0FBVSxXQUFXLElBQUk7QUFHekIsVUFBTSxLQUFLLFlBQVk7QUFBQSxFQUN6QjtBQUFBO0FBQUEsRUFJQSxNQUFNLGVBQThCO0FBQ2xDLFNBQUssV0FBVyxPQUFPLE9BQU8sQ0FBQyxHQUFHLGtCQUFrQixNQUFNLEtBQUssU0FBUyxDQUFDO0FBQUEsRUFDM0U7QUFBQSxFQUVBLE1BQU0sZUFBOEI7QUFDbEMsVUFBTSxLQUFLLFNBQVMsS0FBSyxRQUFRO0FBRWpDLFNBQUssWUFBWTtBQUFBLEVBQ25CO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFTQSxNQUFNLGtCQUFpQztBQUNyQyxVQUFNLE9BQU8sS0FBSyxJQUFJLFVBQVUsb0JBQW9CLDZCQUFZO0FBQ2hFLFVBQU0sU0FBUyxNQUFNO0FBQ3JCLFFBQUksQ0FBQyxRQUFRO0FBQ1gsVUFBSSx3QkFBTyxnQ0FBZ0M7QUFDM0M7QUFBQSxJQUNGO0FBRUEsVUFBTSxTQUFTLE9BQU8sVUFBVTtBQUNoQyxVQUFNLE9BQU8sT0FBTyxRQUFRLE9BQU8sSUFBSTtBQUN2QyxVQUFNLEtBQUssT0FBTztBQUVsQixVQUFNLFNBQVMsQ0FBQyxNQUFjLFVBQWlDO0FBQzdELFlBQU0sT0FBTyxLQUFLLFlBQVksTUFBTSxFQUFFO0FBQ3RDLFVBQUksU0FBUztBQUFJLGVBQU87QUFDeEIsWUFBTSxRQUFRLEtBQUssUUFBUSxPQUFPLE9BQU8sS0FBSyxNQUFNO0FBQ3BELFVBQUksVUFBVTtBQUFJLGVBQU87QUFDekIsVUFBSSxLQUFLLE9BQU8sS0FBSyxVQUFVLEtBQUs7QUFBTyxlQUFPO0FBQ2xELGFBQU8sS0FBSyxVQUFVLE9BQU8sS0FBSyxRQUFRLEtBQUs7QUFBQSxJQUNqRDtBQUdBLFVBQU0sTUFBTSxPQUFPLE1BQU0sSUFBSTtBQUM3QixRQUFJLEtBQUs7QUFDUCxZQUFNLFNBQVMsSUFBSSxNQUFNLEdBQUcsRUFBRSxDQUFDLEVBQUUsS0FBSztBQUN0QyxZQUFNLE9BQU8sS0FBSyxJQUFJLGNBQWMscUJBQXFCLFFBQVEsTUFBTSxNQUFNLFFBQVEsRUFBRTtBQUN2RixVQUFJLE1BQU07QUFDUixjQUFNLEtBQUssSUFBSSxVQUFVLFFBQVEsS0FBSyxFQUFFLFNBQVMsSUFBSTtBQUNyRDtBQUFBLE1BQ0Y7QUFDQSxVQUFJLHdCQUFPLG1CQUFtQixNQUFNLEVBQUU7QUFDdEM7QUFBQSxJQUNGO0FBR0EsVUFBTSxNQUFNLE9BQU8sTUFBTSxJQUFJO0FBQzdCLFFBQUksS0FBSztBQUNQLFlBQU0sU0FBUyxJQUFJLE1BQU0sR0FBRyxFQUFFLENBQUMsRUFBRSxLQUFLO0FBQ3RDLFlBQU0sUUFBUSxLQUFLLFlBQVksSUFBSSxPQUFPLFlBQVksQ0FBQztBQUN2RCxVQUFJLE9BQU87QUFDVCxjQUFNLEtBQUssV0FBVyxNQUFNLFVBQVUsTUFBTSxTQUFTO0FBQ3JEO0FBQUEsTUFDRjtBQUNBLFVBQUksd0JBQU8sV0FBVyxNQUFNLGFBQWE7QUFDekM7QUFBQSxJQUNGO0FBRUEsUUFBSSx3QkFBTyxzQkFBc0I7QUFBQSxFQUNuQztBQUNGOyIsCiAgIm5hbWVzIjogWyJpbXBvcnRfb2JzaWRpYW4iLCAiaWQiLCAidHlwZSIsICJpbXBvcnRfb2JzaWRpYW4iLCAibWluIiwgIm1heCIsICJ0eXBlIiwgImMiLCAiZG9jdW1lbnQiLCAibSIsICJ4IiwgIm0iLCAibSIsICJkYXR1bSIsICJ4IiwgIm0iLCAic2VsZWN0aW9uIiwgIm0iLCAibSIsICJhIiwgIm0iLCAibSIsICJtIiwgImNyZWF0ZSIsICJjcmVhdGUiLCAicGFyc2VUeXBlbmFtZXMiLCAibSIsICJ0eXBlIiwgIndpbmRvdyIsICJkaXNwYXRjaF9kZWZhdWx0IiwgIm0iLCAiZGlzcGF0Y2hfZGVmYXVsdCIsICJzZWxlY3RfZGVmYXVsdCIsICJyb290IiwgInNlbGVjdGlvbiIsICJzZWxlY3RfZGVmYXVsdCIsICJtIiwgImEiLCAibWluIiwgIm1heCIsICJjb25zdGFudF9kZWZhdWx0IiwgIngiLCAiYSIsICJ5IiwgInkiLCAiYSIsICJjb25zdGFudF9kZWZhdWx0IiwgInkiLCAiY29sb3IiLCAicmdiIiwgInN0YXJ0IiwgImEiLCAiYSIsICJpIiwgImEiLCAiYyIsICJtIiwgImEiLCAieCIsICJub3ciLCAiaWQiLCAiaW5kZXgiLCAiZ2V0IiwgInNldCIsICJzdGFydCIsICJlbXB0eSIsICJpbnRlcnJ1cHRfZGVmYXVsdCIsICJpZCIsICJzZXQiLCAiZ2V0IiwgInRyYW5zaXRpb24iLCAiYSIsICJjIiwgImF0dHJSZW1vdmUiLCAiYXR0clJlbW92ZU5TIiwgImF0dHJDb25zdGFudCIsICJhdHRyQ29uc3RhbnROUyIsICJhdHRyRnVuY3Rpb24iLCAiYXR0ckZ1bmN0aW9uTlMiLCAiYXR0cl9kZWZhdWx0IiwgImlkIiwgImdldCIsICJpZCIsICJzZXQiLCAiZ2V0IiwgImlkIiwgInNldCIsICJnZXQiLCAiaWQiLCAic2V0IiwgImZpbHRlcl9kZWZhdWx0IiwgIm0iLCAibWVyZ2VfZGVmYXVsdCIsICJ0cmFuc2l0aW9uIiwgIm0iLCAiaWQiLCAic2V0IiwgIm9uX2RlZmF1bHQiLCAiZ2V0IiwgImlkIiwgInJlbW92ZV9kZWZhdWx0IiwgInNlbGVjdF9kZWZhdWx0IiwgImlkIiwgIm0iLCAiZ2V0IiwgInNlbGVjdEFsbF9kZWZhdWx0IiwgImlkIiwgIm0iLCAiY2hpbGRyZW4iLCAiaW5oZXJpdCIsICJnZXQiLCAiU2VsZWN0aW9uIiwgInNlbGVjdGlvbl9kZWZhdWx0IiwgInN0eWxlUmVtb3ZlIiwgInN0eWxlQ29uc3RhbnQiLCAic3R5bGVGdW5jdGlvbiIsICJpZCIsICJyZW1vdmUiLCAic2V0IiwgInN0eWxlX2RlZmF1bHQiLCAidGV4dENvbnN0YW50IiwgInRleHRGdW5jdGlvbiIsICJ0ZXh0X2RlZmF1bHQiLCAibSIsICJpbmhlcml0IiwgImdldCIsICJpZCIsICJzZXQiLCAiaWQiLCAic2VsZWN0X2RlZmF1bHQiLCAic2VsZWN0QWxsX2RlZmF1bHQiLCAiZmlsdGVyX2RlZmF1bHQiLCAibWVyZ2VfZGVmYXVsdCIsICJzZWxlY3Rpb25fZGVmYXVsdCIsICJvbl9kZWZhdWx0IiwgImF0dHJfZGVmYXVsdCIsICJzdHlsZV9kZWZhdWx0IiwgInRleHRfZGVmYXVsdCIsICJyZW1vdmVfZGVmYXVsdCIsICJpZCIsICJ0cmFuc2l0aW9uX2RlZmF1bHQiLCAibSIsICJpbnRlcnJ1cHRfZGVmYXVsdCIsICJ0cmFuc2l0aW9uX2RlZmF1bHQiLCAieCIsICJ5IiwgIngiLCAieSIsICJ4IiwgInkiLCAiZGF0YV9kZWZhdWx0IiwgIngiLCAieSIsICJ4MiIsICJ5MiIsICJ4MyIsICJ5MyIsICJyZW1vdmVfZGVmYXVsdCIsICJ4IiwgInkiLCAic2l6ZV9kZWZhdWx0IiwgIngiLCAieSIsICJkYXRhX2RlZmF1bHQiLCAicmVtb3ZlX2RlZmF1bHQiLCAic2l6ZV9kZWZhdWx0IiwgImNvbnN0YW50X2RlZmF1bHQiLCAieCIsICJjb25zdGFudF9kZWZhdWx0IiwgIngiLCAieSIsICJmaW5kIiwgImlkIiwgImNvbnN0YW50X2RlZmF1bHQiLCAieCIsICJ5IiwgIm0iLCAiaSIsICJ4IiwgInkiLCAiY29uc3RhbnRfZGVmYXVsdCIsICJ4IiwgInkiLCAibm9kZSIsICJzdHJlbmd0aCIsICJjIiwgIngyIiwgInhfZGVmYXVsdCIsICJ4IiwgImNvbnN0YW50X2RlZmF1bHQiLCAieV9kZWZhdWx0IiwgInkiLCAiY29uc3RhbnRfZGVmYXVsdCIsICJjb25zdGFudF9kZWZhdWx0IiwgIngiLCAidHlwZSIsICJ0cmFuc2Zvcm0iLCAiZGlzcGF0Y2giLCAieCIsICJ5IiwgImlkZW50aXR5IiwgIm5vcHJvcGFnYXRpb24iLCAibm9ldmVudF9kZWZhdWx0IiwgImlkZW50aXR5IiwgInRyYW5zZm9ybSIsICJ6b29tX2RlZmF1bHQiLCAiZmlsdGVyIiwgInNlbGVjdGlvbiIsICJ4IiwgInkiLCAiZXh0ZW50IiwgInRyYW5zaXRpb24iLCAiYSIsICJ0eXBlIiwgInNlbGVjdF9kZWZhdWx0IiwgIm5vZXZlbnRfZGVmYXVsdCIsICJub3Byb3BhZ2F0aW9uIiwgImV2ZW50IiwgImNvbnN0YW50X2RlZmF1bHQiLCAiaGV4IiwgIm0iLCAiYyIsICJhIiwgImlkZW50aXR5IiwgImZyYW1lIiwgInhfZGVmYXVsdCIsICJ5X2RlZmF1bHQiLCAieCIsICJ5IiwgInpvb21fZGVmYXVsdCIsICJzZWxlY3RfZGVmYXVsdCIsICJub3ciLCAiaW1wb3J0X29ic2lkaWFuIiwgImEiLCAiaW1wb3J0X29ic2lkaWFuIiwgInRpdGxlRWwiLCAiZmlsZUVsIiwgInN0YXJ0IiwgImltcG9ydF9vYnNpZGlhbiIsICJ0eXBlIiwgInN0YXJ0Il0KfQo=
