# Object Links (Obsidian plugin)

Define structured objects inside Markdown files, link to them with `{{ }}`, and explore relationships with a custom graph view.

This plugin is built for **fast navigation** between “objects” (entries defined inside Markdown files) and regular Obsidian notes.

---

## Features

### 1) Multi-object files (structured objects in Markdown)
You can define multiple objects inside a single Markdown file (example use-cases: Films, Books, People, Projects).

The plugin scans your vault and parses object files (see **Object file tag** below).

Objects:
- have a primary key (used for linking)
- expose properties (shown in tooltips/info panels)
- have stable navigation targets (jump to the object inside the source file)

### 2) Object links in text: `{{object}}`
Write object links using double braces:

- `{{Some Object}}`
- `{{Some Object|Custom label}}` (pipe syntax for display)

In **reading mode**, `{{...}}` is rendered as a clickable link:
- Click → navigates to the object definition
- Hover → shows a popover with object properties

In **live preview/editor**, `{{...}}` is highlighted to look like a link.

### 3) Autocomplete for `{{ }}`
When typing inside `{{ ...` the plugin suggests objects.

- Use **Arrow keys** to navigate
- Press **Enter** or **Tab** to insert the selected suggestion

### 4) Wrap selection with `{{ }}`
If you select text and press `{`, the plugin wraps the selection:

- `selected text` → `{{selected text}}`

(If there is no selection, `{` behaves normally.)

### 5) “Open link under cursor” command (default: Ctrl/Cmd + Enter)
A command to open what your cursor is currently inside:

- Inside `[[wikilink]]` → opens that note
- Inside `{{object}}` → opens the object definition

Default hotkey:
- **Mod + Enter** (Ctrl on Windows/Linux, Cmd on macOS)

You can change it in Obsidian:
- Settings → Hotkeys → search for **“Open link under cursor”**

### 6) Graph view (Canvas + d3-force)
Open a dedicated graph view to explore relationships between:

- **Objects** (from multi-object files)
- **Regular files** (vault notes)

Edges include:
- Object links (`{{ }}`)
- Wikilinks (`[[ ]]`)

The graph uses a force simulation with:
- strong non-overlap (nodes cannot touch)
- smooth pan/zoom
- hover highlight
- click selection
- double-click navigation

#### Graph controls (in-view config panel)
Filters:
- Search
- Path filter
- Source filter
- Show files / Show objects
- Show orphans
- Wiki links / Object links
- **Connect orphans to folders** (optional)

Display:
- Node size multiplier
- Node max size (on-screen)
- Label opacity
- Labels appear at zoom (threshold)
- Label max width (truncation)

Forces:
- Link distance
- Center force
- Repel force

#### Orphans
Orphans are nodes with 0 connections in the base graph.

- Orphans are shown in **grey**
- Non-orphans use the **theme accent color**

Optional behavior:
- **Connect orphans to folders** (clusters orphans by folder via helper nodes/edges)

#### Info panel
Click a node to show its details:
- type (Object/File)
- path
- properties (for objects)
- connection count

Click outside the panel to close it.

---

## Settings

### Object file tag
In Obsidian settings → plugin settings:

- **Object file tag**: only Markdown files containing this tag are parsed as multi-object files.

Supported tag detection:
- A bare tag anywhere: `#object-links`
- YAML frontmatter:
  - `tags: [object-links]`
  - `tags: object-links`
  - list form under `tags:`

---

## Commands

- **Open graph view**
- **Refresh graph**
- **Open link under cursor** (default hotkey: Mod+Enter)

---

## Installation (dev)

This repo is a standard Obsidian plugin project.

Build:
```bash
npm install
npm run build
```

Then copy these files into your vault:
- `manifest.json`
- `main.js`
- `styles.css`

Target folder:
- `<VAULT>/.obsidian/plugins/object-links/`

---

## Notes / Caveats

- If Obsidian is already open, you may need **Reload app** (Command Palette) after updating the plugin files.
- For very large graphs, Canvas rendering is used for performance.

---

## License

TBD
