import { INTERNALS_LANGS, listKnownLangs } from "./lang";

export const JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "grep-app search result",
  description:
    "Stable machine schema for agentic consumers. hits is ALWAYS an array of objects (never .hits.hits).",
  type: "object",
  required: ["ok", "total", "hits", "facets"],
  properties: {
    ok: { type: "boolean", description: "false when zero hits" },
    total: { type: "integer" },
    time_ms: { type: "integer" },
    partial: { type: "boolean" },
    query: { type: "string" },
    hits: {
      type: "array",
      items: {
        type: "object",
        required: ["repo", "branch", "path", "url"],
        properties: {
          repo: { type: "string", description: "owner/name" },
          branch: { type: "string" },
          path: { type: "string" },
          url: {
            type: "string",
            description: "https://github.com/{repo}/blob/{branch}/{path}",
          },
          matches: { type: "integer" },
          line: {
            type: ["integer", "null"],
            description: "first matched line number when available",
          },
          snippet: {
            type: "string",
            description: "plain one-line preview",
          },
          lines: {
            type: "array",
            items: {
              type: "object",
              properties: {
                line: { type: ["integer", "null"] },
                text: { type: "string" },
                matched: { type: "boolean" },
              },
            },
          },
          score: {
            type: "number",
            description: "research relevance 0–1 (default mode)",
          },
        },
      },
    },
    facets: {
      type: "object",
      properties: {
        languages: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, count: { type: "integer" } },
          },
        },
        repos: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, count: { type: "integer" } },
          },
        },
        paths: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, count: { type: "integer" } },
          },
        },
      },
    },
    next: {
      type: "object",
      description: "suggested follow-ups for agents",
      properties: {
        refine_langs: { type: "array", items: { type: "string" } },
        refine_repos: { type: "array", items: { type: "string" } },
        file_commands: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;

export const OUTPUT_FORMATS = [
  "json",
  "compact",
  "human",
  "full",
  "ndjson",
  "agent",
] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/** Default mode: paste a symbol from device logs / RE → ranked GitHub call sites. */
export const RESEARCH_DEFAULTS = {
  pages: 2,
  limit: 12,
  context: 8,
  excludeTbd: true,
  excludeNoise: true,
  internals: true,
} as const;

/** Single-token identifiers from logs/RE (func names, MG keys, tokens). */
export function looksLikeSymbol(query: string): boolean {
  const q = query.trim();
  if (!q || /\s/.test(q)) return false;
  return /^[A-Za-z_$.][\w.$:\-]*$/.test(q) && q.length >= 3 && q.length <= 128;
}

/** Map agent typos / aliases → canonical format. */
export function resolveOutput(raw: string | undefined, agent: boolean): {
  format: OutputFormat;
  warning?: string;
} {
  if (!raw) return { format: agent ? "agent" : "human" };
  const k = raw.toLowerCase().trim();
  const aliases: Record<string, OutputFormat> = {
    json: "json",
    js: "json",
    machine: "json",
    compact: "compact",
    short: "compact",
    tsv: "compact",
    human: "human",
    pretty: "human",
    text: "human",
    full: "human",
    verbose: "human",
    ndjson: "ndjson",
    jsonl: "ndjson",
    agent: "agent",
    research: "agent",
  };
  if (aliases[k]) {
    const warning =
      k === "full"
        ? `"-o full" accepted as alias of "human" (valid: ${OUTPUT_FORMATS.join(", ")})`
        : undefined;
    return { format: aliases[k], warning };
  }
  return {
    format: agent ? "agent" : "human",
    warning: `unknown -o "${raw}"; using "${agent ? "agent" : "human"}". valid: ${OUTPUT_FORMATS.join(", ")}`,
  };
}

export function isAgentEnvironment(explicit?: boolean): boolean {
  if (explicit === true) return true;
  if (explicit === false) return false;
  if (process.env.GREP_APP_AGENT === "1" || process.env.GREP_APP_AGENT === "true")
    return true;
  if (process.env.CI === "true") return true;
  if (!process.stdout.isTTY) return true;
  return false;
}

const NOISE_PATH =
  /(^|\/)(node_modules|Pods|\.yarn|vendor\/bundle|third_party\/|third-party\/|__tests__\/|testdata\/|fixtures\/)/i;
const TBD_PATH = /\.tbd$/i;
const LOCK_PATH = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock)$/i;

export function hitNoiseScore(path: string): number {
  let n = 0;
  if (NOISE_PATH.test(path)) n += 0.5;
  if (TBD_PATH.test(path)) n += 0.35;
  if (LOCK_PATH.test(path)) n += 0.8;
  if (/\.(md|txt|rst)$/i.test(path)) n += 0.15;
  return Math.min(1, n);
}

export function internalsRelevance(path: string, repo: string): number {
  let score = 1 - hitNoiseScore(path);
  if (/\.(h|m|mm|swift|c|cc|cpp|S|s)$/i.test(path)) score += 0.15;
  if (/(PrivateFrameworks|SPI|spi\/|sandbox|MobileGestalt|containermanager)/i.test(path))
    score += 0.2;
  if (/^(apple|XFrameworks|palera1n|ProcursusTeam|theos)\//i.test(repo))
    score += 0.1;
  if (/\.tbd$/i.test(path)) score -= 0.25;
  return Math.max(0, Math.min(1, score));
}

export function githubBlobURL(
  repo: string,
  branch: string,
  path: string,
  line?: number | null
): string {
  const base = `https://github.com/${repo}/blob/${branch}/${path}`;
  return line ? `${base}#L${line}` : base;
}

export const AGENT_HELP = `\x1b[1mgrep-app\x1b[0m — paste a symbol from device logs / RE → ranked GitHub call sites

\x1b[1mDEFAULT = VULN RESEARCH MODE\x1b[0m
  Pull a live-device log or reverse a binary, spot a function / token / key,
  then cross-reference how open-source code uses it on GitHub.

  Just run:
    grep-app should_hactivate
    grep-app container_query_set_class
    grep-app EqrsVvjcYDdxHBiQmGhAWw

  Defaults ON:
    • rank SPI/source hits (headers & real call sites first)
    • drop *.tbd + node_modules/Pods noise
    • whole-word match for single-token symbols
    • fetch 2 pages, return top 12
    • agents / pipes → JSON (-o agent), --strict, --no-color
  Opt out:  --general

\x1b[1mAGENT RULES (do not invent flags)\x1b[0m
  Valid -o:     json | agent | compact | human | ndjson  ("full" ≈ human)
  Valid -l:     Objective-C | Swift | C | C++ | Logos | … (objc → Objective-C)
  Pass langs as separate -l flags, NEVER "Swift,Objective-C"
  JSON shape:   { ok, total, hits:[{repo,branch,path,url,line,snippet,lines}], facets, next }
                NEVER .hits.hits
  Empty:        exits 1 in agent/strict mode

\x1b[1mUSAGE\x1b[0m
  grep-app <symbol> [options]
  grep-app file <repo> <branch> <path> [-q symbol] [--context N]
  grep-app repos <query>
  grep-app schema | langs

\x1b[1mSEARCH\x1b[0m
  -l, --lang <lang>        Language filter (repeatable)
  -r, --repo <owner/name>  Repo filter
  -p, --path <path>        Path filter
  --path-pattern <pat>     Path pattern
  --repo-pattern <pat>     Repo pattern
  -e, --regexp             Regex (disables auto whole-word)
  -w, --words              Whole words (auto-on for single-token symbols)
  --no-words               Disable auto whole-word
  -s, --case               Case-sensitive
  --pages <n>              Pages to fetch (default: 2 research / 1 general)
  --limit <n>              Cap hits (default: 12 research)
  --general                Raw grep.app (no research ranking/filters)
  --internals/--vuln       Research mode (already default)
  --include-tbd            Keep *.tbd symbol dumps
  --include-noise          Keep vendor/test path noise

\x1b[1mOUTPUT\x1b[0m
  -o, --output <fmt>       json | agent | compact | human | ndjson
  --agent                  Force agent JSON defaults
  --human                  Force interactive human view
  --strict                 Exit 1 when zero hits
  --no-color               Disable ANSI

\x1b[1mFILE\x1b[0m
  -q, --query <q>          Highlight / window around query
  --context <n>            ±N lines around matches (default: 8)

\x1b[1mLIVE DEVICE / RE WORKFLOW\x1b[0m
  grep-app sandbox_extension_issue_file_to_process
  grep-app should_hactivate -o json
  grep-app file apple/security-pcc main path/File.swift -q container_query --context 12
  grep-app medusaCapabilities -l objc -l swift -l c

\x1b[1mRESEARCH LANGS\x1b[0m
  ${INTERNALS_LANGS.join(", ")}
`;

export function printLangsHelp(): string {
  const lines = [
    "Known languages (pass with -l):",
    ...listKnownLangs().map((l) => `  ${l}`),
  ];
  lines.push(
    "",
    "Aliases: objc→Objective-C, objectivec→Objective-C, cpp→C++, ts→TypeScript, …"
  );
  return lines.join("\n");
}

export function suggestFlag(unknown: string): string[] {
  const known = [
    "--help",
    "--lang",
    "--repo",
    "--path",
    "--lang-pattern",
    "--path-pattern",
    "--repo-pattern",
    "--regexp",
    "--words",
    "--no-words",
    "--case",
    "--page",
    "--pages",
    "--limit",
    "--output",
    "--no-color",
    "--stdin",
    "--query",
    "--agent",
    "--human",
    "--strict",
    "--internals",
    "--vuln",
    "--research",
    "--general",
    "--exclude-tbd",
    "--exclude-noise",
    "--include-tbd",
    "--include-noise",
    "--context",
    "--schema",
    "--facets",
    "-l",
    "-r",
    "-p",
    "-e",
    "-w",
    "-s",
    "-n",
    "-o",
    "-q",
    "-h",
  ];
  const q = unknown.toLowerCase();
  return known
    .map((k) => ({ k, s: flagScore(q, k.toLowerCase()) }))
    .filter((x) => x.s > 0.35)
    .sort((a, b) => b.s - a.s)
    .slice(0, 4)
    .map((x) => x.k);
}

function flagScore(a: string, b: string): number {
  if (a === b) return 1;
  if (b.includes(a) || a.includes(b)) return 0.8;
  let m = 0;
  for (const ch of a) if (b.includes(ch)) m++;
  return m / Math.max(a.length, b.length);
}
