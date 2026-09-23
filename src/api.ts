const BASE = "https://grep.app";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = 3
): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url, init);
    if (res.status === 429) {
      const wait = Math.pow(2, i) * 1000 + Math.random() * 500;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    return res;
  }
  return fetch(url, init);
}

export interface SearchParams {
  q: string;
  lang?: string[];
  langPattern?: string;
  path?: string;
  pathPattern?: string;
  repo?: string;
  repoPattern?: string;
  case?: boolean;
  words?: boolean;
  regexp?: boolean;
  page?: number;
  format?: "e";
  type?: "repo";
  scope?: string;
}

export interface SearchHit {
  owner_id: string;
  repo: string;
  branch: string;
  path: string;
  content: { snippet: string };
  total_matches: string;
}

export interface RepoHit {
  owner_id: string;
  repo: string;
  branch: string;
  description?: string;
  stars: number;
  forks: number;
}

export interface FacetBucket {
  count: number;
  val: string;
  owner_id?: string;
}

export interface SearchResult {
  facets: {
    lang?: { buckets: FacetBucket[] };
    path?: { buckets: FacetBucket[] };
    repo?: { buckets: FacetBucket[] };
  };
  hits: {
    hits: SearchHit[];
    total: number;
  };
  time: number;
  partial?: boolean;
  error?: string;
}

export interface RepoSearchResult {
  hits: {
    hits: RepoHit[];
    total: number;
  };
  time: number;
  error?: string;
}

export interface FileParams {
  repo: string;
  branch: string;
  path: string;
  q?: string;
  case?: boolean;
  words?: boolean;
  regexp?: boolean;
}

export interface FileHit {
  branch: string;
  content: { snippet: string };
  license_id?: string;
  owner_id: string;
  path: string;
  repo: string;
  total_matches: string;
}

export interface FileResult {
  hits: {
    hits: FileHit[];
    total: number;
  };
  time: number;
  partial?: boolean;
  error?: string;
}

function buildSearchURL(params: SearchParams): string {
  const u = new URLSearchParams();
  u.set("q", params.q);
  if (params.lang) params.lang.forEach((l) => u.append("f.lang", l));
  if (params.langPattern) u.set("f.lang.pattern", params.langPattern);
  if (params.path) u.set("f.path", params.path);
  if (params.pathPattern) u.set("f.path.pattern", params.pathPattern);
  if (params.repo) u.set("f.repo", params.repo);
  if (params.repoPattern) u.set("f.repo.pattern", params.repoPattern);
  if (params.case) u.set("case", "true");
  if (params.words) u.set("words", "true");
  if (params.regexp) u.set("regexp", "true");
  if (params.page && params.page > 1) u.set("page", String(params.page));
  if (params.format) u.set("format", params.format);
  if (params.type) u.set("type", params.type);
  if (params.scope) u.set("scope", params.scope);
  return `${BASE}/api/search?${u.toString()}`;
}

export async function search(params: SearchParams): Promise<SearchResult> {
  const url = buildSearchURL(params);
  const res = await fetchWithRetry(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Search failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function searchRepos(
  params: SearchParams
): Promise<RepoSearchResult> {
  const url = buildSearchURL({ ...params, type: "repo" });
  const res = await fetchWithRetry(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Repo search failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function fileView(params: FileParams): Promise<FileResult> {
  const u = new URLSearchParams();
  u.set("repo", params.repo);
  u.set("branch", params.branch);
  u.set("path", params.path);
  if (params.q) u.set("q", params.q);
  if (params.case) u.set("case", "true");
  if (params.words) u.set("words", "true");
  if (params.regexp) u.set("regexp", "true");
  const url = `${BASE}/api/file?${u.toString()}`;
  const res = await fetchWithRetry(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`File fetch failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function searchAll(
  params: SearchParams,
  maxPages: number = 1
): Promise<SearchResult> {
  const first = await search(params);
  if (maxPages <= 1 || first.hits.total <= first.hits.hits.length) return first;

  const totalPages = Math.min(maxPages, Math.ceil(first.hits.total / 10));
  const allHits = [...first.hits.hits];

  for (let p = 2; p <= totalPages; p++) {
    const page = await search({ ...params, page: p });
    allHits.push(...page.hits.hits);
  }

  return { ...first, hits: { ...first.hits, hits: allHits } };
}
