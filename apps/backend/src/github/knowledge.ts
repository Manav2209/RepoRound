import { z } from "zod";
import { type Prisma, prisma } from "@repo/db";
import {
  safeRepositoryPath,
  type RepositoryContextMode,
} from "./github.scraper.js";
import type {
  IndexedFile,
  IndexedSymbol,
  ScrapedGithubRepo,
} from "./github.types.js";
import type { RepositoryReference } from "../interview/interview.types.js";

export const fileSchema = z.object({
  path: z.string(),
  content: z.string().max(24000),
});
const symbolSchema = z.object({
  name: z.string(),
  path: z.string(),
  line: z.number().int().positive(),
});
export function indexSymbols(files: IndexedFile[]): IndexedSymbol[] {
  const symbols: IndexedSymbol[] = [];
  for (const file of files)
    file.content.split("\n").forEach((line, i) => {
      const match = line.match(
        /\b(?:function|class|interface|def|func|fn|const|let|type)\s+([A-Za-z_$][\w$]*)/,
      );
      if (match)
        symbols.push({ name: match[1]!, path: file.path, line: i + 1 });
    });
  return symbols.slice(0, 1000);
}

export async function storeKnowledge(
  interviewId: string,
  scraped: ScrapedGithubRepo,
  facts: unknown,
): Promise<void> {
  const files = (scraped.sources ?? []).filter((f) =>
    safeRepositoryPath(f.path),
  );
  const data = {
    commitSha: scraped.repository.commitSha ?? "unknown",
    files,
    symbols: indexSymbols(files) as unknown as Prisma.InputJsonValue,
    facts: JSON.parse(JSON.stringify(facts)) as Prisma.InputJsonValue,
  };
  await prisma.repositoryKnowledge.upsert({
    where: { interviewId },
    create: { interviewId, ...data },
    update: data,
  });
}

export interface CodeExcerpt {
  content: string;
  reference: RepositoryReference;
}

const commonTerms = new Set(
  "about after before does explain from happen happens have how into repository should that their then there these they this through uses using what when where which with work would".split(
    " ",
  ),
);

function words(text: string): string[] {
  const split = text
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  const parts: string[] = split.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  if (split !== text)
    parts.push(...(text.toLowerCase().match(/[a-z0-9]+/g) ?? []));
  return parts;
}

function matches(terms: Set<string>, text: string): number {
  return [...new Set(words(text))].filter((word) => terms.has(word)).length;
}

export class RepositoryKnowledge {
  constructor(
    readonly commitSha: string,
    readonly files: IndexedFile[],
    readonly symbols: IndexedSymbol[],
    readonly facts: Record<string, unknown>,
  ) {}
  static async load(interviewId: string): Promise<RepositoryKnowledge> {
    const row = await prisma.repositoryKnowledge.findUnique({
      where: { interviewId },
    });
    if (!row) return new RepositoryKnowledge("unknown", [], [], {});
    return new RepositoryKnowledge(
      row.commitSha,
      z.array(fileSchema).parse(row.files),
      z.array(symbolSchema).parse(row.symbols),
      z.record(z.unknown()).parse(row.facts),
    );
  }
  getFile(path: string, startLine = 1, maxLines = 60): CodeExcerpt | null {
    if (!safeRepositoryPath(path)) throw new Error("Unsafe repository path");
    const file = this.files.find((f) => f.path === path);
    if (!file) return null;
    const lines = file.content.split("\n");
    const start = Math.max(1, Math.min(lines.length, Math.trunc(startLine)));
    const end = Math.min(
      lines.length,
      start + Math.min(80, Math.max(1, maxLines)) - 1,
    );
    return {
      content: lines
        .slice(start - 1, end)
        .map((l, i) => `${start + i}: ${l}`)
        .join("\n")
        .slice(0, 6000),
      reference: {
        path,
        commitSha: this.commitSha,
        startLine: start,
        endLine: end,
      },
    };
  }
  getSymbol(name: string): CodeExcerpt[] {
    return this.symbols
      .filter((s) => s.name.toLowerCase() === name.toLowerCase())
      .slice(0, 3)
      .map((s) => this.getFile(s.path, Math.max(1, s.line - 2), 40)!)
      .filter(Boolean);
  }
  search(
    query: string,
    mode: RepositoryContextMode = "current",
  ): CodeExcerpt[] {
    if (mode === "diverse") return this.searchByTopic(query);
    const terms = query
      .toLowerCase()
      .split(/[^a-z0-9_$]+/)
      .filter((t) => t.length > 2)
      .slice(0, 6);
    if (!terms.length) return [];
    const hits: { path: string; line: number; score: number }[] = [];
    for (const f of this.files)
      f.content.split("\n").forEach((line, index) => {
        const score = terms.filter((term) =>
          line.toLowerCase().includes(term),
        ).length;
        if (score) hits.push({ path: f.path, line: index + 1, score });
      });
    hits.sort((a, b) => b.score - a.score);
    const selected: CodeExcerpt[] = [];
    for (const hit of hits) {
      if (
        selected.some(
          (e) =>
            e.reference.path === hit.path &&
            Math.abs(e.reference.startLine - hit.line) < 30,
        )
      )
        continue;
      const excerpt = this.getFile(hit.path, Math.max(1, hit.line - 5), 30);
      if (excerpt) selected.push(excerpt);
      if (selected.length === 3) break;
    }
    return selected;
  }

  private searchByTopic(query: string): CodeExcerpt[] {
    const terms = new Set(
      words(query)
        .filter((word) => word.length > 2 && !commonTerms.has(word))
        .slice(0, 12),
    );
    if (!terms.size) return [];
    const symbols = new Map<string, Map<number, number>>();
    for (const symbol of this.symbols) {
      const score = matches(terms, symbol.name);
      if (!score) continue;
      const declarations =
        symbols.get(symbol.path) ?? new Map<number, number>();
      declarations.set(symbol.line, score);
      symbols.set(symbol.path, declarations);
    }
    const hits: { path: string; line: number; score: number }[] = [];
    for (const file of this.files) {
      const pathScore = matches(terms, file.path);
      const sourceWeight = /\.md$|(?:[._-](?:test|spec))\.[^/]+$/i.test(
        file.path,
      )
        ? 0.7
        : 1;
      const declarations = symbols.get(file.path);
      const lines = file.content.split("\n");
      const matchedTerms = lines.map((line) => [
        ...new Set(words(line).filter((word) => terms.has(word))),
      ]);
      let best: (typeof hits)[number] | undefined;
      for (let i = 0; i < lines.length; i++) {
        const declarationScore = declarations?.get(i + 1) ?? 0;
        const lineScore = matchedTerms[i]!.length;
        if (!lineScore && !declarationScore) continue;
        const nearbyScore = new Set(
          matchedTerms.slice(Math.max(0, i - 2), i + 3).flat(),
        ).size;
        const score =
          (3 * lineScore +
            2 * nearbyScore +
            2 * pathScore +
            2 * declarationScore) *
          sourceWeight;
        if (!best || score > best.score)
          best = { path: file.path, line: i + 1, score };
      }
      if (best) hits.push(best);
      else if (pathScore)
        hits.push({ path: file.path, line: 1, score: pathScore });
    }
    return hits
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .flatMap((hit) => {
        const excerpt = this.getFile(hit.path, Math.max(1, hit.line - 5), 30);
        return excerpt ? [excerpt] : [];
      });
  }
  getDependency(
    name: string,
  ): { name: string; version: string; path: string }[] {
    const found: { name: string; version: string; path: string }[] = [];
    for (const file of this.files.filter((f) =>
      f.path.endsWith("package.json"),
    )) {
      try {
        const json = JSON.parse(file.content) as Record<
          string,
          Record<string, unknown>
        >;
        const version =
          json.dependencies?.[name] ?? json.devDependencies?.[name];
        if (typeof version === "string")
          found.push({ name, version, path: file.path });
      } catch {
        /* truncated manifests are unavailable */
      }
    }
    return found.slice(0, 5);
  }
  validReference(ref: RepositoryReference): boolean {
    const file = this.files.find((f) => f.path === ref.path);
    return (
      !!file &&
      ref.commitSha === this.commitSha &&
      ref.startLine >= 1 &&
      ref.endLine >= ref.startLine &&
      ref.endLine <= file.content.split("\n").length
    );
  }
}
