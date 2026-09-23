import type { SearchResult, RepoSearchResult, FileResult } from "./api";
import {
  githubBlobURL,
  internalsRelevance,
  hitNoiseScore,
} from "./agent";
import {
  parseSnippet,
  snippetOneLine,
  snippetPlain,
  windowAroundMatches,
  type SnippetLine,
} from "./snippet";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BG_YELLOW = "\x1b[43m";
const BLACK = "\x1b[30m";

export interface FormatOpts {
  color?: boolean;
  limit?: number;
  internals?: boolean;
  excludeTbd?: boolean;
  excludeNoise?: boolean;
  query?: string;
  facets?: boolean;
  context?: number;
}

function useColor(opts?: FormatOpts): boolean {
  return opts?.color !== false && !!process.stdout.isTTY;
}

function formatCount(n: number): string {
  if (n >= 1e6) return Math.floor(n / 1e6) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(".0", "") + "k";
  return n.toString();
}

export interface NormalizedHit {
  repo: string;
  branch: string;
  path: string;
  url: string;
  matches: number;
  line: number | null;
  snippet: string;
  lines: SnippetLine[];
  score: number;
}

function normalizeHits(
  result: SearchResult,
  opts: FormatOpts = {}
): NormalizedHit[] {
  let hits = result.hits.hits.map((h) => {
    const lines = parseSnippet(h.content?.snippet || "");
    const firstMatch = lines.find((l) => l.matched) || lines[0];
    const line = firstMatch?.line ?? null;
    const score = opts.internals
      ? internalsRelevance(h.path, h.repo)
      : 1 - hitNoiseScore(h.path) * 0.3;
    return {
      repo: h.repo,
      branch: h.branch,
      path: h.path,
      url: githubBlobURL(h.repo, h.branch, h.path, line),
      matches: parseInt(String(h.total_matches), 10) || 0,
      line,
      snippet: snippetOneLine(h.content?.snippet || ""),
      lines,
      score,
    } satisfies NormalizedHit;
  });

  if (opts.excludeTbd) hits = hits.filter((h) => !/\.tbd$/i.test(h.path));
  if (opts.excludeNoise)
    hits = hits.filter((h) => hitNoiseScore(h.path) < 0.4);
  if (opts.internals) hits = [...hits].sort((a, b) => b.score - a.score);
  if (opts.limit && opts.limit > 0) hits = hits.slice(0, opts.limit);
  return hits;
}

function facetsOf(result: SearchResult) {
  return {
    languages:
      result.facets.lang?.buckets.map((b) => ({
        name: b.val,
        count: b.count,
      })) || [],
    repos:
      result.facets.repo?.buckets.map((b) => ({
        name: b.val,
        count: b.count,
      })) || [],
    paths:
      result.facets.path?.buckets.map((b) => ({
        name: b.val,
        count: b.count,
      })) || [],
  };
}

function nextHints(
  hits: NormalizedHit[],
  facets: ReturnType<typeof facetsOf>,
  query?: string
) {
  const qFlag =
    query && query.length > 1 && query.length < 64 && !/\s/.test(query)
      ? ` -q '${query.replace(/'/g, "")}'`
      : "";
  const file_commands = hits
    .slice(0, 5)
    .map(
      (h) =>
        `grep-app file ${h.repo} ${h.branch} ${h.path}${qFlag} --context 12 -o json`
    );
  return {
    refine_langs: facets.languages.slice(0, 5).map((l) => l.name),
    refine_repos: facets.repos.slice(0, 5).map((r) => r.name),
    file_commands,
  };
}

export function formatSearchJSON(
  result: SearchResult,
  opts: FormatOpts = {}
): string {
  const hits = normalizeHits(result, opts);
  const facets = facetsOf(result);
  const out = {
    ok: hits.length > 0,
    total: result.hits.total,
    returned: hits.length,
    time_ms: result.time,
    partial: result.partial || false,
    query: opts.query,
    hits: hits.map((h) => ({
      repo: h.repo,
      branch: h.branch,
      path: h.path,
      url: h.url,
      matches: h.matches,
      line: h.line,
      snippet: h.snippet,
      lines: h.lines,
      ...(opts.internals ? { score: Number(h.score.toFixed(3)) } : {}),
    })),
    facets,
    next: nextHints(hits, facets, opts.query),
  };
  return JSON.stringify(out, null, 2);
}

/** Dense agent format: same schema as JSON but omit empty next noise when huge. */
export function formatSearchAgent(
  result: SearchResult,
  opts: FormatOpts = {}
): string {
  return formatSearchJSON(result, { ...opts, internals: opts.internals ?? true });
}

export function formatSearchNDJSON(
  result: SearchResult,
  opts: FormatOpts = {}
): string {
  const hits = normalizeHits(result, opts);
  return hits
    .map((h) =>
      JSON.stringify({
        repo: h.repo,
        branch: h.branch,
        path: h.path,
        url: h.url,
        line: h.line,
        matches: h.matches,
        snippet: h.snippet,
        score: opts.internals ? Number(h.score.toFixed(3)) : undefined,
      })
    )
    .join("\n");
}

export function formatSearchCompact(
  result: SearchResult,
  opts: FormatOpts = {}
): string {
  const hits = normalizeHits(result, opts);
  const lines = hits.map((h) => {
    const loc = h.line !== null ? `:L${h.line}` : "";
    return `${h.repo}:${h.path}${loc}\t${h.snippet}`;
  });
  if (opts.facets) {
    const f = facetsOf(result);
    if (f.languages.length) {
      lines.push(
        `# langs: ${f.languages
          .slice(0, 8)
          .map((l) => `${l.name}(${l.count})`)
          .join(", ")}`
      );
    }
    if (f.repos.length) {
      lines.push(
        `# repos: ${f.repos
          .slice(0, 6)
          .map((r) => `${r.name}(${r.count})`)
          .join(", ")}`
      );
    }
  }
  return lines.join("\n");
}

export function formatSearchHuman(
  result: SearchResult,
  opts: FormatOpts = {}
): string {
  const color = useColor(opts);
  const dim = (s: string) => (color ? `${DIM}${s}${RESET}` : s);
  const boldCyan = (s: string) =>
    color ? `${BOLD}${CYAN}${s}${RESET}` : s;
  const hits = normalizeHits(result, opts);
  const lines: string[] = [];

  lines.push(
    dim(
      `${formatCount(result.hits.total)} results${result.partial ? " (partial)" : ""} · showing ${hits.length} · ${result.time}ms`
    )
  );
  lines.push("");

  for (const hit of hits) {
    const score =
      opts.internals && hit.score < 1
        ? dim(` score=${hit.score.toFixed(2)}`)
        : "";
    lines.push(
      `${boldCyan(hit.repo)} ${dim(hit.path)}${hit.line !== null ? dim(`:${hit.line}`) : ""} ${dim(`(${hit.matches} matches)`)}${score}`
    );
    lines.push(dim(`  ${hit.url}`));
    for (const sl of hit.lines) {
      const prefix =
        sl.line !== null
          ? String(sl.line).padStart(6, " ") + " | "
          : "       | ";
      let text = sl.text;
      if (color && sl.matched) {
        text = `${BG_YELLOW}${BLACK}${text}${RESET}`;
      }
      lines.push(`  ${prefix}${text}`);
    }
    lines.push("");
  }

  const f = facetsOf(result);
  if (f.languages.length) {
    lines.push(
      dim(
        `Languages: ${f.languages
          .slice(0, 10)
          .map((b) => `${b.name}(${formatCount(b.count)})`)
          .join(", ")}`
      )
    );
  }
  return lines.join("\n");
}

export function formatReposHuman(
  result: RepoSearchResult,
  opts: FormatOpts = {}
): string {
  const color = useColor(opts);
  const dim = (s: string) => (color ? `${DIM}${s}${RESET}` : s);
  const boldCyan = (s: string) =>
    color ? `${BOLD}${CYAN}${s}${RESET}` : s;
  const yellow = (s: string) => (color ? `${YELLOW}${s}${RESET}` : s);
  const lines: string[] = [];
  let hits = result.hits.hits;
  if (opts.limit && opts.limit > 0) hits = hits.slice(0, opts.limit);
  lines.push(dim(`${formatCount(result.hits.total)} repositories found`));
  lines.push("");
  for (const hit of hits) {
    lines.push(
      `${boldCyan(hit.repo)} ${yellow("★" + formatCount(hit.stars))} ${dim("⑂" + formatCount(hit.forks))}`
    );
    if (hit.description) lines.push(`  ${dim(hit.description)}`);
  }
  return lines.join("\n");
}

export function formatReposJSON(
  result: RepoSearchResult,
  opts: FormatOpts = {}
): string {
  let hits = result.hits.hits;
  if (opts.limit && opts.limit > 0) hits = hits.slice(0, opts.limit);
  return JSON.stringify(
    {
      ok: hits.length > 0,
      total: result.hits.total,
      returned: hits.length,
      repos: hits.map((h) => ({
        repo: h.repo,
        branch: h.branch,
        description: h.description || "",
        stars: h.stars,
        forks: h.forks,
        url: `https://github.com/${h.repo}`,
      })),
    },
    null,
    2
  );
}

export function formatFileHuman(
  result: FileResult,
  opts: FormatOpts = {}
): string {
  const color = useColor(opts);
  const dim = (s: string) => (color ? `${DIM}${s}${RESET}` : s);
  const boldCyan = (s: string) =>
    color ? `${BOLD}${CYAN}${s}${RESET}` : s;
  const lines: string[] = [];
  const ctx = opts.context ?? -1;

  for (const hit of result.hits.hits) {
    let parsed = parseSnippet(hit.content?.snippet || "");
    if (ctx >= 0) parsed = windowAroundMatches(parsed, ctx);
    if (opts.limit && opts.limit > 0) parsed = parsed.slice(0, opts.limit);

    lines.push(
      `${boldCyan(hit.repo)}${dim("/" + hit.path)} ${dim(`(${hit.total_matches} matches)`)}`
    );
    lines.push(
      dim(
        `  ${githubBlobURL(hit.repo, hit.branch, hit.path, parsed.find((l) => l.matched)?.line)}`
      )
    );
    for (const sl of parsed) {
      const prefix =
        sl.line !== null
          ? String(sl.line).padStart(6, " ") + " | "
          : "       | ";
      lines.push(prefix + sl.text);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function formatFileJSON(
  result: FileResult,
  opts: FormatOpts = {}
): string {
  const ctx = opts.context ?? -1;
  const hits = result.hits.hits.map((h) => {
    let lines = parseSnippet(h.content?.snippet || "");
    if (ctx >= 0) lines = windowAroundMatches(lines, ctx);
    if (opts.limit && opts.limit > 0) lines = lines.slice(0, opts.limit);
    const line = lines.find((l) => l.matched)?.line ?? lines[0]?.line ?? null;
    return {
      repo: h.repo,
      branch: h.branch,
      path: h.path,
      url: githubBlobURL(h.repo, h.branch, h.path, line),
      matches: parseInt(String(h.total_matches), 10) || 0,
      line,
      lines,
      content: snippetPlain(h.content?.snippet || ""),
    };
  });
  return JSON.stringify(
    {
      ok: hits.length > 0 && hits.some((h) => h.lines.length > 0),
      total: result.hits.total,
      partial: result.partial || false,
      hits,
    },
    null,
    2
  );
}

export { normalizeHits };
