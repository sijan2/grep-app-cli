# grep-app-cli

Search all of public GitHub code from your terminal, using [grep.app](https://grep.app).

Paste a symbol (for example, a function name from device logs or a disassembler) and get the GitHub files that use it, ranked by relevance.

## Install

Requires [Bun](https://bun.sh).

```bash
git clone https://github.com/sijan2/grep-app-cli && cd grep-app-cli
bun link          # puts `grep-app` on your PATH
```

## Use

```bash
grep-app sandbox_extension_issue_file_to_process      # search
grep-app xpc_connection_create -l objc -l c           # filter by language
grep-app file owner/repo main path/File.c -q SYMBOL   # open one file around the match
grep-app repos "keychain"                             # find repos
grep-app foo -o json                                  # JSON output (also: agent, ndjson, compact, human)
grep-app --general "some text"                        # raw grep.app results, no ranking
```

Run `grep-app --help` for all flags.

## How it works

1. Sends your query to grep.app's search API, fetching 2 pages by default and retrying on rate limits.
2. For a single-token query that looks like a symbol, it matches whole words only.
3. It drops noise such as `*.tbd` symbol dumps and vendored code, then ranks real source and call sites first.
4. It prints the top 12 hits with GitHub links and context lines.

`--general` turns off steps 2 and 3.

## Scripts and agents

- `-o json` returns `{ ok, total, hits: [{ repo, branch, path, url, line, snippet, score }], facets }`. Run `grep-app schema` for the full schema.
- The CLI exits with code `1` when there are no hits and output is piped (or `--strict` is set).
- `--stdin` accepts a JSON query object.
