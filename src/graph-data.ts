import { ParsedFile, extractObjectLinks, extractWikilinks } from "./parser";

export interface GraphNode {
  id: string;
  label: string;
  /** "object" for multi-object entries, "file" for regular vault files */
  type: "object" | "file";
  filePath: string;
  fileLabel: string;
  properties: Record<string, string>;
  /** 0-indexed start line in the source file (objects only) */
  startLine: number;
  /** Number of connections */
  connections: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  /** "object" if this edge involves a {{}} link, "wiki" for native [[]] links */
  edgeType: "object" | "wiki";
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface VaultFile {
  path: string;
  basename: string;
  content: string;
}

/**
 * Build the full graph from the vault.
 *
 * Nodes:
 *   - Each object in a multi-object file -> type "object"
 *   - Each regular vault file that participates in any link -> type "file"
 *
 * Edges:
 *   - file -> object  when a file contains {{ObjectKey}}
 *   - file -> file    when a file contains [[OtherFile]] (native wikilinks)
 *   - object -> object when an object's property value contains {{OtherObject}}
 *
 * Multi-object source files (e.g., Films.md) do NOT appear as file nodes;
 * only their individual objects do.
 */
export function buildGraph(
  parsedFiles: ParsedFile[],
  allFiles: VaultFile[]
): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const edgeSet = new Set<string>();
  const nodeMap = new Map<string, GraphNode>();

  // Paths of multi-object source files -- these are replaced by their objects
  const multiObjectPaths = new Set(parsedFiles.map((f) => f.filePath));

  // Map: lowercase key value -> object node id
  const objKeyToNodeId = new Map<string, string>();

  // Map: lowercase file basename -> file path (for resolving [[wikilinks]])
  const basenameToPath = new Map<string, string>();
  for (const f of allFiles) {
    basenameToPath.set(f.basename.toLowerCase(), f.path);
  }

  // ── 1. Create object nodes ──────────────────────────────────────────
  for (const file of parsedFiles) {
    for (const obj of file.objects) {
      const nodeId = `obj::${file.filePath}::${obj.displayKey}`;
      const node: GraphNode = {
        id: nodeId,
        label: obj.displayKey,
        type: "object",
        filePath: obj.filePath,
        fileLabel: obj.fileLabel,
        properties: obj.properties,
        startLine: obj.startLine,
        connections: 0,
      };
      nodes.push(node);
      nodeMap.set(nodeId, node);
      // Register by displayKey (primary lookup for disambiguated names)
      objKeyToNodeId.set(obj.displayKey.toLowerCase(), nodeId);
      // Also register by plain keyValue if not already taken (backwards compat)
      const plain = obj.keyValue.toLowerCase();
      if (!objKeyToNodeId.has(plain)) {
        objKeyToNodeId.set(plain, nodeId);
      }
    }
  }

  // Helper: get or create a file node
  function ensureFileNode(path: string, basename: string): string {
    const nodeId = `file::${path}`;
    if (!nodeMap.has(nodeId)) {
      const node: GraphNode = {
        id: nodeId,
        label: basename,
        type: "file",
        filePath: path,
        fileLabel: basename,
        properties: {},
        startLine: 0,
        connections: 0,
      };
      nodes.push(node);
      nodeMap.set(nodeId, node);
    }
    return nodeId;
  }

  // Helper: add an edge (deduplicated)
  function addEdge(src: string, tgt: string, type: "object" | "wiki"): void {
    const edgeId = [src, tgt].sort().join("--");
    if (edgeSet.has(edgeId)) return;
    edgeSet.add(edgeId);
    edges.push({ source: src, target: tgt, edgeType: type });
  }

  // ── 2. Scan all files for links ────────────────────────────────────
  for (const file of allFiles) {
    // Skip multi-object source files (their objects are already nodes)
    if (multiObjectPaths.has(file.path)) continue;

    const objectLinks = extractObjectLinks(file.content);
    const wikilinks = extractWikilinks(file.content);

    let fileNodeId: string | null = null;

    // {{object links}} -> file-to-object edges
    for (const link of objectLinks) {
      const targetObjId = objKeyToNodeId.get(link.toLowerCase());
      if (targetObjId) {
        if (!fileNodeId) fileNodeId = ensureFileNode(file.path, file.basename);
        addEdge(fileNodeId, targetObjId, "object");
      }
    }

    // [[wikilinks]] -> file-to-file edges
    for (const link of wikilinks) {
      const targetPath = basenameToPath.get(link.toLowerCase());
      if (!targetPath) continue;
      // Don't link to multi-object source files as file nodes
      if (multiObjectPaths.has(targetPath)) continue;

      // Find the target file to get its basename
      const targetFile = allFiles.find((f) => f.path === targetPath);
      if (!targetFile) continue;

      if (!fileNodeId) fileNodeId = ensureFileNode(file.path, file.basename);
      const targetFileId = ensureFileNode(targetPath, targetFile.basename);

      if (fileNodeId !== targetFileId) {
        addEdge(fileNodeId, targetFileId, "wiki");
      }
    }
  }

  // ── 3. Object-to-object links via {{}} in property values ──────────
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

  // ── 4. Count connections ───────────────────────────────────────────
  for (const edge of edges) {
    const src = nodeMap.get(edge.source);
    const tgt = nodeMap.get(edge.target);
    if (src) src.connections++;
    if (tgt) tgt.connections++;
  }

  return { nodes, edges };
}
