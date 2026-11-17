import { z } from "zod";
import type { GithubFile, ScrapedGithubRepo } from "./github.types.js";

const API = "https://api.github.com";
const manifestPattern =
  /(?:^|\/)(?:package\.json|requirements[^/]*\.txt|pyproject\.toml|go\.mod|Cargo\.toml|Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|composer\.json|Gemfile|pom\.xml|build\.gradle(?:\.kts)?)$/i;
const readmePattern = /(?:^|\/)readme\.md$/i;
const eligiblePattern =
  /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|rb|php|json|prisma|ya?ml|toml|md)$/i;
const configPattern = /(?:\.json|\.ya?ml|\.toml|\.md)$/i;
const testPattern =
  /(?:^|\/)(?:__tests__|test|tests|fixtures|examples|mocks|docs|spec|specs)(?:\/|$)|(?:[._-](?:test|spec)|\.d)\.[^/]+$/i;
const fileLimit = 24;
const downloadByteLimit = 24_000;
const sourceCharacterLimit = 120_000;

function currentRank(path: string): number {
  if (manifestPattern.test(path)) return 0;
  if (readmePattern.test(path)) return 1;
  return /(?:route|server|main|index|schema|consumer|queue|socket|auth|service|controller)/i.test(
    path,
  )
    ? 2
    : 3;
}

function sourceRank(path: string): number {
  const filename = path.split("/").at(-1)!;
  if (testPattern.test(path)) return 4;
  if (configPattern.test(path)) return 3;
  if (/^(?:index|main|server|app)\./i.test(filename)) return 0;
  if (
    /engine|orchestrat|worker|queue|job|route|handler|controller|service|store|stream|client|session|schema|replay|outbox|health|resource/i.test(
      filename,
    )
  )
    return 1;
  return 2;
}

function sourceGroup(path: string): string {
  const parts = path.split("/");
  if (
    /^(?:apps|services|packages|internal|cmd|pkg|src|lib)$/i.test(parts[0]!) &&
    parts.length > 2
  )
    return parts.slice(0, 2).join("/");
  return parts.length > 1 ? parts[0]! : ".";
}

export type RepositoryContextMode = "current" | "diverse";

export function isRepositorySource(path: string): boolean {
  return (
    safeRepositoryPath(path) &&
    (manifestPattern.test(path) || eligiblePattern.test(path))
  );
}

export function selectRepositoryFiles(
  tree: GithubFile[],
  mode: RepositoryContextMode,
): GithubFile[] {
  const candidates = tree.filter(
    (file) => file.size <= downloadByteLimit && isRepositorySource(file.path),
  );
  if (mode === "current")
    return candidates
      .sort(
        (a, b) =>
          currentRank(a.path) - currentRank(b.path) ||
          a.path.localeCompare(b.path),
      )
      .slice(0, fileLimit);

  const byDepth = (a: GithubFile, b: GithubFile) =>
    a.path.split("/").length - b.path.split("/").length ||
    a.path.localeCompare(b.path);
  const manifests = candidates
    .filter((file) => manifestPattern.test(file.path))
    .sort(byDepth);
  const readmes = candidates
    .filter((file) => readmePattern.test(file.path))
    .sort(byDepth);
  const selected = [...manifests.slice(0, 4), ...readmes.slice(0, 2)];
  const groups = new Map<string, GithubFile[]>();
  for (const file of candidates) {
    if (manifestPattern.test(file.path) || readmePattern.test(file.path))
      continue;
    const key = sourceGroup(file.path);
    const group = groups.get(key) ?? [];
    group.push(file);
    groups.set(key, group);
  }
  const ranked = [...groups.values()].map((group) =>
    group.sort(
      (a, b) => sourceRank(a.path) - sourceRank(b.path) || byDepth(a, b),
    ),
  );
  const codeGroups = ranked.map((group) =>
    group.filter((file) => sourceRank(file.path) < 3),
  );
  for (let round = 0; selected.length < fileLimit; round++) {
    const next = codeGroups.flatMap((group) => group[round] ?? []);
    if (!next.length) break;
    next.sort(
      (a, b) => sourceRank(a.path) - sourceRank(b.path) || byDepth(a, b),
    );
    selected.push(...next.slice(0, fileLimit - selected.length));
  }
  return [
    ...selected,
    ...ranked.flat().filter((file) => sourceRank(file.path) >= 3),
    ...manifests.slice(4),
    ...readmes.slice(2),
  ].slice(0, fileLimit);
}
export function safeRepositoryPath(path: string): boolean {
  return (
    path.length <= 500 &&
    !path.includes("\\") &&
    !path.split("/").some((p) => p === ".." || p === "." || !p) &&
    !/(?:^|\/)(?:\.git|node_modules|vendor|dist|build|\.next|\.env[^/]*|credentials[^/]*|secrets?[^/]*)(?:\/|$)/i.test(
      path,
    ) &&
    !/\.(?:pem|key|p12|pfx|sqlite|db|png|jpe?g|gif|webp|woff2?|mp[34]|zip|pdf|lock)$/i.test(
      path,
    )
  );
}

async function boundedText(res: Response, limit: number): Promise<string> {
  if (Number(res.headers.get("content-length") ?? 0) > limit)
    throw new Error("Repository response exceeds size limit");
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > limit)
        throw new Error("Repository response exceeds size limit");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks).toString("utf8");
}

export class GithubScraperError extends Error {}
export class GithubScraper {
  private readonly headers: Record<string, string>;
  constructor(
    headers: Record<string, string> = {},
    private readonly contextMode: RepositoryContextMode = "current",
    private readonly fetcher: (
      url: string,
      init?: RequestInit,
    ) => Promise<Response> = fetch,
  ) {
    this.headers = {
      Accept: "application/vnd.github+json",
      "User-Agent": "ai-interviewer",
      ...(process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {}),
      ...headers,
    };
  }

  static parseGithubUrl(raw: string): {
    owner: string;
    name: string;
    url: string;
  } {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new GithubScraperError("Provide a valid GitHub repository URL");
    }
    const parts = url.pathname.replace(/\/$/, "").split("/").filter(Boolean);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.port ||
      url.username ||
      url.password ||
      parts.length !== 2 ||
      url.search ||
      url.hash
    )
      throw new GithubScraperError("Use https://github.com/owner/repository");
    const owner = parts[0]!;
    const name = parts[1]!.replace(/\.git$/, "");
    if (
      !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner) ||
      !/^[A-Za-z0-9_.-]{1,100}$/.test(name) ||
      [".", ".."].includes(name)
    )
      throw new GithubScraperError("Invalid GitHub repository identifier");
    return { owner, name, url: `https://github.com/${owner}/${name}` };
  }

  private async json(path: string): Promise<unknown> {
    const res = await this.fetcher(`${API}${path}`, {
      headers: this.headers,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok)
      throw new GithubScraperError(`GitHub request failed (${res.status})`);
    return JSON.parse(await boundedText(res, 2_000_000));
  }

  private async file(
    owner: string,
    name: string,
    sha: string,
    path: string,
  ): Promise<string | undefined> {
    if (!safeRepositoryPath(path)) return undefined;
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const res = await this.fetcher(
      `https://raw.githubusercontent.com/${owner}/${name}/${sha}/${encoded}`,
      {
        headers: { "User-Agent": "ai-interviewer" },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return undefined;
    return boundedText(res, downloadByteLimit).catch(() => undefined);
  }

  async scrape(owner: string, name: string): Promise<ScrapedGithubRepo> {
    const info = z
      .object({
        default_branch: z.string(),
        description: z.string().nullable(),
        language: z.string().nullable(),
        size: z.number(),
      })
      .parse(await this.json(`/repos/${owner}/${name}`));
    if (info.size > 100_000)
      throw new GithubScraperError("Repository exceeds the 100 MB limit");
    const commit = z
      .object({ sha: z.string().regex(/^[a-f0-9]{40}$/) })
      .parse(
        await this.json(
          `/repos/${owner}/${name}/commits/${encodeURIComponent(info.default_branch)}`,
        ),
      );
    const treeData = z
      .object({
        tree: z.array(
          z.object({
            path: z.string(),
            type: z.string(),
            size: z.number().optional(),
          }),
        ),
      })
      .parse(
        await this.json(
          `/repos/${owner}/${name}/git/trees/${commit.sha}?recursive=1`,
        ),
      );
    const tree = treeData.tree
      .filter((f) => f.type === "blob" && safeRepositoryPath(f.path))
      .slice(0, 1500)
      .map((f) => ({ path: f.path, size: f.size ?? 0 }));
    const languages = z
      .record(z.number())
      .parse(await this.json(`/repos/${owner}/${name}/languages`));
    const sources: { path: string; content: string }[] = [];
    const fileTails: { source: { content: string }; tail: string }[] = [];
    let remaining = sourceCharacterLimit;
    const selected = selectRepositoryFiles(tree, this.contextMode);
    for (
      let offset = 0;
      offset < selected.length && remaining > 0;
      offset += 4
    ) {
      const files = await Promise.all(
        selected.slice(offset, offset + 4).map(async (file) => ({
          path: file.path,
          content: await this.file(owner, name, commit.sha, file.path).catch(
            () => undefined,
          ),
        })),
      );
      for (const file of files)
        if (file.content && remaining > 0) {
          const bounded = file.content.slice(0, Math.min(10000, remaining));
          const source = { path: file.path, content: bounded };
          sources.push(source);
          remaining -= bounded.length;
          if (
            this.contextMode === "diverse" &&
            bounded.length < file.content.length
          )
            fileTails.push({
              source,
              tail: file.content.slice(bounded.length),
            });
        }
    }
    for (const { source, tail } of fileTails) {
      if (remaining <= 0) break;
      const additional = tail.slice(0, remaining);
      source.content += additional;
      remaining -= additional.length;
    }
    return {
      repository: {
        owner,
        name,
        url: `https://github.com/${owner}/${name}`,
        description: info.description ?? undefined,
        defaultBranch: info.default_branch,
        primaryLanguage: info.language ?? undefined,
        commitSha: commit.sha,
      },
      languages: Object.keys(languages),
      tree,
      sources,
      manifests: sources.filter((f) => manifestPattern.test(f.path)),
      readme: sources.find((f) => readmePattern.test(f.path))?.content,
      recentCommits: [],
    };
  }
}
