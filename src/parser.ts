/**
 * Parser for multi-object markdown files.
 *
 * Format:
 *   key: <property_name>
 *
 *   ---
 *
 *   prop1: value1
 *   prop2: value2
 *
 *   ---
 *
 *   prop1: value3
 *   prop2: value4
 */

export interface ParsedObject {
  /** The value of the key property -- used as the linkable name */
  keyValue: string;
  /**
   * Disambiguated identifier used for {{}} links, index lookups, and graph labels.
   * Defaults to keyValue. If duplicates exist:
   *   - different files: "keyValue (fileLabel)"
   *   - same file: "keyValue (secondPropertyValue)"
   * Set during fullRefresh() in main.ts.
   */
  displayKey: string;
  /** Mandatory numeric id for this object */
  id: number;
  /** All properties of this object (insertion-ordered) */
  properties: Record<string, string>;
  /** Ordered list of property names as they appear in the file */
  propertyOrder: string[];
  /** Source file path */
  filePath: string;
  /** Source file basename (without extension) */
  fileLabel: string;
  /** 0-indexed line number where this object block starts in the file */
  startLine: number;
}

export interface ParsedFile {
  /** The property name used as key */
  keyProperty: string;
  /** All parsed objects in this file */
  objects: ParsedObject[];
  /** Source file path */
  filePath: string;
}

/**
 * Parse a multi-object markdown file.
 * Returns null if the file doesn't follow the expected format.
 *
 * Skips YAML frontmatter (if present) before looking for the
 * `key: <property>` header and `---` separated object blocks.
 */
export function parseMultiObjectFile(
  content: string,
  filePath: string
): ParsedFile | null {
  const lines = content.split("\n");

  // Skip YAML frontmatter (opening --- on first line, closing --- later)
  let startIdx = 0;
  if (lines.length > 0 && lines[0].trim() === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        startIdx = i + 1;
        break;
      }
    }
  }

  // First non-empty line (after frontmatter) should be "key: <property>"
  // But skip bare #tag lines (e.g. #object-links) that precede it
  let keyLine = "";
  for (let i = startIdx; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0) continue;
    // Skip bare tag lines like "#object-links"
    if (trimmed.startsWith("#") && !trimmed.includes(":")) continue;
    keyLine = trimmed;
    break;
  }

  const keyMatch = keyLine.match(/^key:\s*(.+)$/i);
  if (!keyMatch) return null;

  const keyProperty = keyMatch[1].trim();
  const fileLabel = filePath.replace(/^.*\//, "").replace(/\.md$/i, "");

  // Walk lines (after frontmatter) to find --- separators and build objects
  const objects: ParsedObject[] = [];
  let currentBlock: { lines: string[]; startLine: number } | null = null;
  let passedFirstSeparator = false;

  for (let i = startIdx; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (trimmed === "---") {
      // Flush the current block if we have one
      if (currentBlock && passedFirstSeparator) {
        const obj = parseBlock(currentBlock, keyProperty, filePath, fileLabel);
        if (obj) objects.push(obj);
      }
      passedFirstSeparator = true;
      currentBlock = { lines: [], startLine: i + 1 };
      continue;
    }

    if (currentBlock && passedFirstSeparator) {
      currentBlock.lines.push(trimmed);
    }
  }

  // Flush the last block
  if (currentBlock && passedFirstSeparator) {
    const obj = parseBlock(currentBlock, keyProperty, filePath, fileLabel);
    if (obj) objects.push(obj);
  }

  if (objects.length === 0) return null;

  return { keyProperty, objects, filePath };
}

function parseBlock(
  block: { lines: string[]; startLine: number },
  keyProperty: string,
  filePath: string,
  fileLabel: string
): ParsedObject | null {
  const properties: Record<string, string> = {};
  const propertyOrder: string[] = [];

  for (const line of block.lines) {
    if (!line) continue;
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const prop = line.substring(0, colonIndex).trim();
    const val = line.substring(colonIndex + 1).trim();
    if (prop && val) {
      properties[prop] = val;
      propertyOrder.push(prop);
    }
  }

  const keyValue = properties[keyProperty];
  if (!keyValue) return null;

  // Mandatory id property: must be present and numeric
  const rawId = properties["id"];
  if (!rawId) return null;
  const id = Number(rawId);
  if (isNaN(id)) return null;

  return {
    keyValue,
    displayKey: keyValue, // default; disambiguated later in fullRefresh()
    id,
    properties,
    propertyOrder,
    filePath,
    fileLabel,
    startLine: block.startLine,
  };
}

/**
 * Get the value of the "second property" of an object for disambiguation.
 * This is the first property that is not the key property and not "id".
 */
export function getSecondProperty(
  obj: ParsedObject,
  keyProperty: string
): string | null {
  for (const prop of obj.propertyOrder) {
    if (prop === keyProperty || prop === "id") continue;
    const val = obj.properties[prop];
    if (val) return val;
  }
  return null;
}

/**
 * Extract all {{object links}} from content.
 * Returns the link target names (without {{ }}).
 * Handles aliases like {{target|alias}} by returning just "target".
 */
export function extractObjectLinks(content: string): string[] {
  const links: string[] = [];
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

/**
 * Extract all [[wikilinks]] from content.
 * Returns the link target names (without [[ ]]).
 * Handles aliases like [[target|alias]] by returning just "target".
 */
export function extractWikilinks(content: string): string[] {
  const links: string[] = [];
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
