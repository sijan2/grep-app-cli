# grep-app — agent instructions

Paste a symbol from **device logs / RE** → ranked GitHub call sites.

**Default = vuln research mode.** No `--internals` needed.

## Quick xref (this is the product)

```bash
grep-app should_hactivate
grep-app container_query_set_class
grep-app sandbox_extension_issue_file_to_process
```

Defaults ON: SPI/source ranking, drop `*.tbd` + vendor noise, whole-word for single-token symbols, 2 pages, top 12 hits.  
Opt out: `--general`

## Do not invent flags

Valid `-o`: `json` | `agent` | `compact` | `human` | `ndjson`  
Lang aliases: `objc` → `Objective-C`. Separate `-l` flags only.

## Stable JSON

```
{ ok, total, returned, hits: [{ repo, branch, path, url, line, snippet, lines, score }], facets, next }
```

`hits` is already an array — never `.hits.hits`.  
`grep-app schema` · empty → exit `1` when piped/`--agent`/`--strict`.

## Deepen one hit

```bash
grep-app file owner/repo branch path/File.swift -q SYMBOL --context 12 -o json
```

## Useful flags

| Flag | Purpose |
|------|---------|
| *(default)* | Research xref mode |
| `--general` | Raw grep.app, no ranking/filters |
| `--limit N` | Cap hits |
| `-l objc -l swift -l c` | Tighten Apple SPI |
| `--include-tbd` | Keep symbol dumps |
| `--no-words` | Disable auto whole-word |
