import { posix } from "node:path";
import type { CodeExcerpt, RepositoryKnowledge } from "./knowledge.js";

/**
 * Evidence-only repository graph derived from `RepositoryKnowledge`.
 *
 * Every edge is provable from indexed file content (a literal import specifier
 * with its line, or a manifest dependency key) pinned to the analyzed commit
 * SHA. Nothing is inferred: a relative import whose target is not in the index
 * yields no edge, and a bare import that no manifest declares still records
 * only the code fact that the file imports it. Missing data never becomes an
 * asserted relationship.
 */

export type RepoEdgeKind = "IMPORTS" | "IMPORTS_MODULE" | "DEPENDS";

export interface RepoEdge {
  kind: RepoEdgeKind;
  /** Importing file path, or the manifest path for `DEPENDS`. */
  from: string;
  /** Indexed target path for `IMPORTS`, otherwise a module name. */
  to: string;
  specifier: string;
  line?: number;
  version?: string;
  commitSha: string;
}

export interface RepoGraph {
  commitSha: string;
  nodes: string[];
  edges: RepoEdge[];
  unresolvedImports: { from: string; specifier: string; line: number }[];
  importsOf(path: string): RepoEdge[];
  importedBy(path: string): RepoEdge[];
  dependentsOf(moduleName: string): RepoEdge[];
  dependenciesOf(manifestPath: string): RepoEdge[];
  shortestImportPath(from: string, to: string, maxHops: number): string[] | null;
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const RESOLUTION_SUFFIXES = [
  "",
  ...SOURCE_EXTENSIONS,
  ...SOURCE_EXTENSIONS.map((ext) => `/index${ext}`),
];

const STATIC_IMPORT = /(?:^|[\s;{}])(?:import|export)\b[^'"\n]*?\bfrom\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT = /^[ \t]*import[ \t]*['"]([^'"]+)['"]/gm;
const DYNAMIC_IMPORT = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function isManifest(path: string): boolean {
  return path === "package.json" || path.endsWith("/package.json");
}

function isSource(path: string): boolean {
  return SOURCE_EXTENSIONS.some((ext) => path.endsWith(ext));
}

function lineOf(content: string, index: number): number {
  // The match may include one leading delimiter (newline or space); counting it
  // keeps the reported line aligned with the import statement itself.
  let line = 1;
  const end = Math.min(index, content.length - 1);
  for (let i = 0; i <= end; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

/** Package root of a bare specifier: `@scope/pkg/sub` -> `@scope/pkg`. */
export function moduleRoot(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

function resolveRelative(
  importer: string,
  specifier: string,
  nodeSet: Set<string>,
): string | null {
  const base = posix.normalize(posix.join(posix.dirname(importer), specifier));
  for (const suffix of RESOLUTION_SUFFIXES) {
    const candidate = `${base}${suffix}`;
    if (nodeSet.has(candidate)) return candidate;
  }
  return null;
}

function collectSpecifiers(content: string): { specifier: string; line: number }[] {
  const found: { specifier: string; line: number }[] = [];
  for (const pattern of [STATIC_IMPORT, SIDE_EFFECT_IMPORT, DYNAMIC_IMPORT]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content))) {
      found.push({ specifier: match[1]!, line: lineOf(content, match.index) });
    }
  }
  return found;
}

export function deriveRepoGraph(
  knowledge: Pick<RepositoryKnowledge, "commitSha" | "files">,
): RepoGraph {
  const { commitSha } = knowledge;
  const nodes = knowledge.files.map((f) => f.path);
  const nodeSet = new Set(nodes);
  const edges: RepoEdge[] = [];
  const unresolvedImports: RepoGraph["unresolvedImports"] = [];

  for (const file of knowledge.files) {
    if (isManifest(file.path)) {
      try {
        const manifest = JSON.parse(file.content) as Record<
          string,
          Record<string, unknown>
        >;
        for (const key of [
          "dependencies",
          "devDependencies",
          "peerDependencies",
          "optionalDependencies",
        ]) {
          const group = manifest[key];
          if (!group || typeof group !== "object") continue;
          for (const [name, version] of Object.entries(group)) {
            if (typeof version !== "string") continue;
            edges.push({
              kind: "DEPENDS",
              from: file.path,
              to: name,
              specifier: name,
              version,
              commitSha,
            });
          }
        }
      } catch {
        /* truncated or invalid manifest contributes no dependency edges */
      }
      continue;
    }
    if (!isSource(file.path)) continue;
    for (const { specifier, line } of collectSpecifiers(file.content)) {
      if (specifier.startsWith(".")) {
        const resolved = resolveRelative(file.path, specifier, nodeSet);
        if (resolved) {
          edges.push({
            kind: "IMPORTS",
            from: file.path,
            to: resolved,
            specifier,
            line,
            commitSha,
          });
        } else {
          unresolvedImports.push({ from: file.path, specifier, line });
        }
      } else if (!specifier.startsWith("node:")) {
        edges.push({
          kind: "IMPORTS_MODULE",
          from: file.path,
          to: specifier,
          specifier,
          line,
          commitSha,
        });
      }
    }
  }

  const importsOf = (path: string) =>
    edges.filter((e) => e.kind === "IMPORTS" && e.from === path);
  const importedBy = (path: string) =>
    edges.filter((e) => e.kind === "IMPORTS" && e.to === path);

  const graph: RepoGraph = {
    commitSha,
    nodes,
    edges,
    unresolvedImports,
    importsOf,
    importedBy,
    dependentsOf: (moduleName) =>
      edges.filter(
        (e) =>
          e.kind === "IMPORTS_MODULE" && moduleRoot(e.to) === moduleName,
      ),
    dependenciesOf: (manifestPath) =>
      edges.filter((e) => e.kind === "DEPENDS" && e.from === manifestPath),
    shortestImportPath: (from, to, maxHops) => {
      if (from === to) return [from];
      const hops = Math.max(1, Math.min(8, Math.trunc(maxHops)));
      const adjacency = new Map<string, string[]>();
      for (const edge of edges) {
        if (edge.kind !== "IMPORTS") continue;
        if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
        adjacency.get(edge.from)!.push(edge.to);
      }
      const queue: { path: string; depth: number; trail: string[] }[] = [
        { path: from, depth: 0, trail: [from] },
      ];
      const seen = new Set<string>([from]);
      while (queue.length) {
        const current = queue.shift()!;
        if (current.depth >= hops) continue;
        for (const next of adjacency.get(current.path) ?? []) {
          if (seen.has(next)) continue;
          if (next === to) return [...current.trail, next];
          seen.add(next);
          queue.push({ path: next, depth: current.depth + 1, trail: [...current.trail, next] });
        }
      }
      return null;
    },
  };
  return graph;
}

export interface RepoGraphProbe {
  probeId: string;
  fact: string;
  excerpts: CodeExcerpt[];
}

function keywords(objective: { topic: string; description: string }): string[] {
  return `${objective.topic} ${objective.description}`
    .toLowerCase()
    .split(/[^a-z0-9$]+/)
    .filter((t) => t.length > 3)
    .slice(0, 8);
}

/**
 * Deterministic, graph-grounded probe for GitHub mode. Returns null when no
 * indexed file supports an objective fact: the caller then has no graph
 * evidence and must not assert one.
 */
export function repoGraphProbe(
  knowledge: RepositoryKnowledge,
  objective: { topic: string; description: string },
): RepoGraphProbe | null {
  const graph = deriveRepoGraph(knowledge);
  const terms = keywords(objective);
  if (!terms.length) return null;
  const candidates = knowledge.files.filter((f) =>
    terms.some((term) => f.path.toLowerCase().includes(term)),
  );
  if (!candidates.length) return null;
  const ranked = candidates
    .map((file) => ({ file, importers: graph.importedBy(file.path).length }))
    .sort((a, b) => b.importers - a.importers || a.file.path.localeCompare(b.file.path));
  const target = ranked[0]!;
  const excerpt = knowledge.getFile(target.file.path, 1, 5);
  if (!excerpt) return null;

  const importers = graph.importedBy(target.file.path);
  if (importers.length) {
    const paths = importers.map((e) => e.from).sort();
    return {
      probeId: "repo.module-hub",
      fact:
        `Indexed module ${target.file.path} is imported by ${importers.length} ` +
        `indexed module(s): ${paths.slice(0, 3).join(", ")}.`,
      excerpts: [excerpt],
    };
  }

  const imported = graph.importsOf(target.file.path);
  if (imported.length) {
    const edge = imported[0]!;
    return {
      probeId: "repo.module-dependency",
      fact:
        `Indexed module ${target.file.path} imports ${edge.to}` +
        (edge.line ? ` (line ${edge.line})` : "") +
        ` at commit ${knowledge.commitSha}.`,
      excerpts: [excerpt],
    };
  }

  const modules = graph.edges.filter(
    (e) => e.kind === "IMPORTS_MODULE" && e.from === target.file.path,
  );
  if (modules.length) {
    return {
      probeId: "repo.module-external",
      fact: `Indexed module ${target.file.path} depends on external module(s): ${modules
        .map((e) => e.to)
        .slice(0, 3)
        .join(", ")}.`,
      excerpts: [excerpt],
    };
  }
  return null;
}
