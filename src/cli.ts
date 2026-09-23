#!/usr/bin/env bun
import { search, searchAll, searchRepos, fileView } from "./api";
import type { SearchParams, FileParams } from "./api";
import {
  formatSearchHuman,
  formatSearchJSON,
  formatSearchCompact,
  formatSearchAgent,
  formatSearchNDJSON,
  formatReposHuman,
  formatReposJSON,
  formatFileHuman,
  formatFileJSON,
  normalizeHits,
} from "./format";
import {
  AGENT_HELP,
  JSON_SCHEMA,
  RESEARCH_DEFAULTS,
  isAgentEnvironment,
  looksLikeSymbol,
  printLangsHelp,
  resolveOutput,
  suggestFlag,
  type OutputFormat,
} from "./agent";
import { resolveLangs } from "./lang";

interface Opts {
  help?: boolean;
  schema?: boolean;
  output?: string;
  langs: string[];
  pages?: number;
  page?: number;
  repo?: string;
  path?: string;
  langPattern?: string;
  pathPattern?: string;
  repoPattern?: string;
  regexp?: boolean;
  words?: boolean;
  noWords?: boolean;
  case?: boolean;
  noColor?: boolean;
  stdin?: boolean;
  query?: string;
  limit?: number;
  agent?: boolean;
  human?: boolean;
  strict?: boolean;
  /** undefined = default research ON; false = --general */
  research?: boolean;
  excludeTbd?: boolean;
  excludeNoise?: boolean;
  includeTbd?: boolean;
  includeNoise?: boolean;
  context?: number;
  facets?: boolean;
  positional: string[];
  warnings: string[];
}

function fail(msg: string, code = 1): never {
  console.error(msg);
  process.exit(code);
}

function parseArgs(argv: string[]): Opts {
  const args = argv.slice(2);
  const opts: Opts = {
    langs: [],
    positional: [],
    warnings: [],
  };

  const need = (flag: string): string => {
    const v = args[++i];
    if (v === undefined || v.startsWith("-")) {
      fail(`Missing value for ${flag}`);
    }
    return v;
  };

  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case "-h":
      case "--help":
        opts.help = true;
        break;
      case "--schema":
        opts.schema = true;
        break;
      case "-l":
      case "--lang":
        opts.langs.push(need(a));
        break;
      case "-r":
      case "--repo":
        opts.repo = need(a);
        break;
      case "-p":
      case "--path":
        opts.path = need(a);
        break;
      case "--lang-pattern":
        opts.langPattern = need(a);
        break;
      case "--path-pattern":
        opts.pathPattern = need(a);
        break;
      case "--repo-pattern":
        opts.repoPattern = need(a);
        break;
      case "-e":
      case "--regexp":
        opts.regexp = true;
        break;
      case "-w":
      case "--words":
        opts.words = true;
        break;
      case "--no-words":
        opts.noWords = true;
        break;
      case "-s":
      case "--case":
        opts.case = true;
        break;
      case "-n":
      case "--page":
        opts.page = parseInt(need(a), 10);
        break;
      case "--pages":
        opts.pages = parseInt(need(a), 10);
        break;
      case "--limit":
        opts.limit = parseInt(need(a), 10);
        break;
      case "-o":
      case "--output":
        opts.output = need(a);
        break;
      case "--no-color":
        opts.noColor = true;
        break;
      case "--color":
        opts.noColor = false;
        break;
      case "--stdin":
        opts.stdin = true;
        break;
      case "-q":
      case "--query":
        opts.query = need(a);
        break;
      case "--agent":
        opts.agent = true;
        break;
      case "--human":
        opts.human = true;
        break;
      case "--strict":
        opts.strict = true;
        break;
      case "--internals":
      case "--vuln":
      case "--research":
        opts.research = true;
        break;
      case "--general":
      case "--web":
      case "--all":
        opts.research = false;
        break;
      case "--exclude-tbd":
        opts.excludeTbd = true;
        break;
      case "--exclude-noise":
        opts.excludeNoise = true;
        break;
      case "--include-tbd":
        opts.includeTbd = true;
        break;
      case "--include-noise":
        opts.includeNoise = true;
        break;
      case "--context":
      case "-C":
        opts.context = parseInt(need(a), 10);
        break;
      case "--facets":
        opts.facets = true;
        break;
      case "--full":
        opts.output = "full";
        opts.warnings.push(
          '"--full" is not a flag; use -o human (or -o json for agents)'
        );
        break;
      case "--format":
        opts.output = need(a);
        opts.warnings.push('"--format" alias accepted; prefer -o / --output');
        break;
      default:
        if (a.startsWith("-")) {
          const suggestions = suggestFlag(a);
          const hint = suggestions.length
            ? `\n  Did you mean: ${suggestions.join(", ")}?`
            : "\n  Run: grep-app --help";
          fail(`Unknown option: ${a}${hint}`);
        }
        opts.positional.push(a);
    }
  }

  return opts;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8").trim();
}

function applyDefaults(opts: Opts): {
  agent: boolean;
  research: boolean;
  format: OutputFormat;
  color: boolean;
  strict: boolean;
  limit: number | undefined;
  pages: number;
  context: number;
  words: boolean | undefined;
} {
  const research = opts.research !== false; // default ON
  const agent = isAgentEnvironment(opts.human ? false : opts.agent);
  const { format, warning } = resolveOutput(opts.output, agent);
  if (warning) opts.warnings.push(warning);

  const color =
    opts.noColor === true
      ? false
      : opts.noColor === false
        ? true
        : !agent && !!process.stdout.isTTY;

  const strict = opts.strict ?? agent;

  const limit =
    opts.limit !== undefined
      ? opts.limit
      : research
        ? RESEARCH_DEFAULTS.limit
        : agent
          ? 15
          : undefined;

  // pages: explicit > research default > 1
  let pages = opts.pages;
  if (pages === undefined) {
    pages = research ? RESEARCH_DEFAULTS.pages : 1;
  }

  const context =
    opts.context !== undefined
      ? opts.context
      : research || agent
        ? RESEARCH_DEFAULTS.context
        : -1;

  return {
    agent,
    research,
    format,
    color,
    strict,
    limit,
    pages,
    context,
    words: opts.words,
  };
}

function emitWarnings(warnings: string[]) {
  for (const w of warnings) {
    console.error(`grep-app: ${w}`);
  }
}

function printSearch(
  format: OutputFormat,
  result: Awaited<ReturnType<typeof search>>,
  fmtOpts: Parameters<typeof formatSearchJSON>[1]
) {
  switch (format) {
    case "json":
      return formatSearchJSON(result, fmtOpts);
    case "agent":
      return formatSearchAgent(result, fmtOpts);
    case "ndjson":
      return formatSearchNDJSON(result, fmtOpts);
    case "compact":
      return formatSearchCompact(result, fmtOpts);
    case "human":
    case "full":
    default:
      return formatSearchHuman(result, fmtOpts);
  }
}

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.schema || opts.positional[0] === "schema") {
    console.log(JSON.stringify(JSON_SCHEMA, null, 2));
    process.exit(0);
  }
  if (opts.positional[0] === "langs") {
    console.log(printLangsHelp());
    process.exit(0);
  }
  if (opts.help) {
    console.log(AGENT_HELP);
    process.exit(0);
  }

  if (opts.stdin) {
    const input = await readStdin();
    try {
      const parsed = JSON.parse(input);
      if (parsed.query) opts.positional = [parsed.query];
      if (parsed.lang)
        opts.langs = Array.isArray(parsed.lang) ? parsed.lang : [parsed.lang];
      if (parsed.repo) opts.repo = parsed.repo;
      if (parsed.path) opts.path = parsed.path;
      if (parsed.regexp) opts.regexp = parsed.regexp;
      if (parsed.case) opts.case = parsed.case;
      if (parsed.words) opts.words = parsed.words;
      if (parsed.page) opts.page = parsed.page;
      if (parsed.pages) opts.pages = parsed.pages;
      if (parsed.limit) opts.limit = parsed.limit;
      if (parsed.output) opts.output = parsed.output;
      if (parsed.internals || parsed.research) opts.research = true;
      if (parsed.general) opts.research = false;
      if (parsed.command) opts.positional.unshift(parsed.command);
    } catch {
      opts.positional = [input];
    }
  }

  const defaults = applyDefaults(opts);
  const { langs, warnings: langWarnings } = resolveLangs(opts.langs);
  opts.warnings.push(...langWarnings);
  emitWarnings(opts.warnings);

  const excludeTbd = opts.includeTbd
    ? false
    : (opts.excludeTbd ?? (defaults.research && RESEARCH_DEFAULTS.excludeTbd));
  const excludeNoise = opts.includeNoise
    ? false
    : (opts.excludeNoise ??
      (defaults.research && RESEARCH_DEFAULTS.excludeNoise));

  const fmtOpts = {
    color: defaults.color,
    limit: defaults.limit,
    internals: defaults.research,
    excludeTbd,
    excludeNoise,
    query: undefined as string | undefined,
    facets: opts.facets || defaults.agent || defaults.research,
    context: defaults.context,
  };

  const pos = opts.positional;
  const command = pos[0];

  if (command === "repos") {
    const query = pos.slice(1).join(" ");
    if (!query) fail("Usage: grep-app repos <query>");
    const params: SearchParams = {
      q: query,
      lang: langs.length ? langs : undefined,
      repo: opts.repo,
      regexp: opts.regexp,
      case: opts.case,
      words: opts.words,
    };
    const result = await searchRepos(params);
    if (result.error) fail(`Error: ${result.error}`);
    const empty = !result.hits.hits.length;
    const out =
      defaults.format === "json" ||
      defaults.format === "agent" ||
      defaults.format === "ndjson"
        ? formatReposJSON(result, fmtOpts)
        : formatReposHuman(result, fmtOpts);
    console.log(out);
    if (empty && defaults.strict) process.exit(1);
    return;
  }

  if (command === "file") {
    const repo = pos[1];
    const branch = pos[2];
    const path = pos[3];
    if (!repo || !branch || !path) {
      fail(
        "Usage: grep-app file <repo> <branch> <path> [-q query] [--context N]"
      );
    }
    const params: FileParams = {
      repo,
      branch,
      path,
      q: opts.query || undefined,
      case: opts.case,
      words: opts.words,
      regexp: opts.regexp,
    };
    const result = await fileView(params);
    if (result.error) fail(`Error: ${result.error}`);
    const out =
      defaults.format === "json" ||
      defaults.format === "agent" ||
      defaults.format === "ndjson"
        ? formatFileJSON(result, fmtOpts)
        : formatFileHuman(result, fmtOpts);
    console.log(out);
    const empty =
      !result.hits.hits.length ||
      result.hits.hits.every((h) => !(h.content?.snippet || "").trim());
    if (empty && defaults.strict) process.exit(1);
    return;
  }

  const query = pos.join(" ");
  if (!query) {
    console.log(AGENT_HELP);
    process.exit(0);
  }

  fmtOpts.query = query;

  // Auto whole-word for pasted single-token symbols (device log / RE workflow)
  let words = opts.words;
  if (
    defaults.research &&
    !opts.noWords &&
    !opts.regexp &&
    words === undefined &&
    looksLikeSymbol(query)
  ) {
    words = true;
  }

  const params: SearchParams = {
    q: query,
    lang: langs.length ? langs : undefined,
    langPattern: opts.langPattern,
    path: opts.path,
    pathPattern: opts.pathPattern,
    repo: opts.repo,
    repoPattern: opts.repoPattern,
    regexp: opts.regexp,
    case: opts.case,
    words,
    page: opts.page,
  };

  let pages = defaults.pages;
  if (defaults.limit && defaults.limit > 10) {
    pages = Math.max(pages, Math.ceil(defaults.limit / 10));
  }

  const result =
    pages > 1 ? await searchAll(params, pages) : await search(params);

  if (result.error) fail(`Error: ${result.error}`);

  const out = printSearch(defaults.format, result, fmtOpts);
  console.log(out);

  const returned = normalizeHits(result, fmtOpts).length;
  if (returned === 0 && defaults.strict) {
    console.error("grep-app: 0 hits (strict exit 1)");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
