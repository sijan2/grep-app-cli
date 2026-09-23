export interface SnippetLine {
  line: number | null;
  text: string;
  matched: boolean;
}

const ENTITY: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
  "&quot;": '"',
  "&#x27;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
};

function decodeEntities(s: string): string {
  return s.replace(
    /&(?:lt|gt|amp|quot|nbsp|#x27|#39);/g,
    (m) => ENTITY[m] ?? m
  );
}

function stripTagsKeepMark(html: string): { text: string; matched: boolean } {
  const matched = /<mark[\s>]/i.test(html);
  const text = decodeEntities(
    html
      .replace(/<mark[^>]*>/gi, "")
      .replace(/<\/mark>/gi, "")
      .replace(/<[^>]+>/g, "")
  );
  return { text, matched };
}

/**
 * grep.app snippets are usually:
 *   <table class="highlight-table"><tr data-line="48">...<div class="lineno">48</div>...code...</tr>...
 * Fallback: concatenated "48    code49    code" text.
 */
export function parseSnippet(html: string): SnippetLine[] {
  if (!html) return [];

  // Preferred: structured highlight-table rows
  if (/highlight-table|data-line=/i.test(html)) {
    const rows: SnippetLine[] = [];
    const rowRe =
      /<tr[^>]*data-line="(\d+)"[^>]*>([\s\S]*?)<\/tr>/gi;
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(html))) {
      const line = parseInt(m[1], 10);
      const inner = m[2];
      // Prefer the highlight/pre cell; drop lineno cell content
      const codeHtml =
        inner.match(
          /<div class="highlight"[\s\S]*?<pre[^>]*>([\s\S]*?)<\/pre>/i
        )?.[1] ??
        inner
          .replace(/<div class="lineno">[\s\S]*?<\/div>/gi, "")
          .replace(/<td[^>]*>\s*<div class="lineno">[\s\S]*?<\/div>\s*<\/td>/gi, "");
      const { text, matched } = stripTagsKeepMark(codeHtml);
      const cleaned = text.replace(/\u00a0/g, " ").replace(/\s+$/g, "");
      // Keep indentation meaningful but drop pure empty
      if (cleaned.trim().length === 0 && !matched) continue;
      rows.push({ line, text: cleaned, matched });
    }
    if (rows.length) return rows;
  }

  // Fallback: br / newline / glued linenos
  let s = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?div[^>]*>/gi, "\n")
    .replace(/<\/?p[^>]*>/gi, "\n")
    .replace(/<\/tr>/gi, "\n");

  s = s.replace(/([^\n\d>])(\d{1,6})( {2,}|\t)/g, "$1\n$2$3");

  const rawLines = s
    .split(/\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length);

  const out: SnippetLine[] = [];
  for (const raw of rawLines) {
    const { text: plain, matched } = stripTagsKeepMark(raw);
    const mm = plain.match(/^(\d{1,6})([ \t]+)(.*)$/);
    if (mm) {
      out.push({ line: parseInt(mm[1], 10), text: mm[3], matched });
    } else if (plain.trim()) {
      out.push({ line: null, text: plain.trimStart(), matched });
    }
  }
  return out.filter((l) => l.text.length > 0 || l.line !== null);
}

export function snippetPlain(html: string): string {
  const lines = parseSnippet(html);
  if (!lines.length) return "";
  return lines
    .map((l) => {
      const prefix =
        l.line !== null ? String(l.line).padStart(5, " ") + " | " : "      | ";
      return prefix + l.text;
    })
    .join("\n");
}

export function snippetOneLine(html: string, max = 160): string {
  const lines = parseSnippet(html);
  const hit = lines.find((l) => l.matched) || lines[0];
  if (!hit) return "";
  const prefix = hit.line !== null ? `L${hit.line}: ` : "";
  return (prefix + hit.text.trim()).slice(0, max);
}

/** Keep only lines near matches (±context), for file views. */
export function windowAroundMatches(
  lines: SnippetLine[],
  context: number
): SnippetLine[] {
  if (context < 0 || !lines.some((l) => l.matched)) return lines;
  const keep = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].matched) continue;
    for (
      let j = Math.max(0, i - context);
      j <= Math.min(lines.length - 1, i + context);
      j++
    ) {
      keep.add(j);
    }
  }
  if (!keep.size) return lines;
  const sorted = [...keep].sort((a, b) => a - b);
  const out: SnippetLine[] = [];
  let prev = -2;
  for (const idx of sorted) {
    if (prev >= 0 && idx > prev + 1) {
      out.push({ line: null, text: "…", matched: false });
    }
    out.push(lines[idx]);
    prev = idx;
  }
  return out;
}
