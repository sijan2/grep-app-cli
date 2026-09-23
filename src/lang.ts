/** Canonical grep.app language names → common agent aliases. */
const CANONICAL: Record<string, string[]> = {
  "Objective-C": [
    "objc",
    "obj-c",
    "objectivec",
    "objective-c",
    "objective_c",
    "m",
    "mm",
  ],
  Swift: ["swift", "swiftui"],
  C: ["c", "clang"],
  "C++": ["c++", "cpp", "cxx", "cc"],
  Logos: ["logos", "xposed", "tweak"],
  Python: ["python", "py", "python3"],
  TypeScript: ["typescript", "ts", "tsx"],
  JavaScript: ["javascript", "js", "jsx", "node"],
  Go: ["go", "golang"],
  Rust: ["rust", "rs"],
  Java: ["java"],
  Kotlin: ["kotlin", "kt"],
  Ruby: ["ruby", "rb"],
  Shell: ["shell", "bash", "zsh", "sh"],
  Markdown: ["markdown", "md"],
  JSON: ["json"],
  XML: ["xml", "plist"],
  Makefile: ["makefile", "make"],
  Assembly: ["assembly", "asm", "nasm"],
  HTML: ["html", "htm"],
  CSS: ["css"],
  PHP: ["php"],
  Perl: ["perl"],
  Lua: ["lua"],
  Dart: ["dart"],
  Scala: ["scala"],
  Haskell: ["haskell", "hs"],
  Elixir: ["elixir", "ex"],
  Zig: ["zig"],
};

const ALIAS_TO_CANON = new Map<string, string>();
for (const [canon, aliases] of Object.entries(CANONICAL)) {
  ALIAS_TO_CANON.set(canon.toLowerCase(), canon);
  for (const a of aliases) ALIAS_TO_CANON.set(a.toLowerCase(), canon);
}

/** Languages most useful for Apple / mobile vuln & internals research. */
export const INTERNALS_LANGS = [
  "Objective-C",
  "Swift",
  "C",
  "C++",
  "Logos",
  "Assembly",
];

export function resolveLang(input: string): {
  canonical: string | null;
  warning?: string;
} {
  const raw = input.trim();
  if (!raw) return { canonical: null, warning: "empty language" };

  // Comma-separated agent mistakes: "Swift,Objective-C"
  if (raw.includes(",")) {
    return {
      canonical: null,
      warning: `pass multiple -l flags, not commas (got "${raw}")`,
    };
  }

  const hit = ALIAS_TO_CANON.get(raw.toLowerCase());
  if (hit) {
    if (hit.toLowerCase() !== raw.toLowerCase()) {
      return {
        canonical: hit,
        warning: `normalized language "${raw}" → "${hit}"`,
      };
    }
    return { canonical: hit };
  }

  // Unknown: keep as-is but warn with suggestions
  const suggestions = suggestLang(raw);
  return {
    canonical: raw,
    warning: suggestions.length
      ? `unknown language "${raw}"; did you mean: ${suggestions.join(", ")}?`
      : `unknown language "${raw}" (grep.app may return 0 hits)`,
  };
}

export function resolveLangs(inputs: string[]): {
  langs: string[];
  warnings: string[];
} {
  const langs: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const input of inputs) {
    // Expand accidental comma lists into separate langs
    const parts = input.includes(",")
      ? input.split(",").map((s) => s.trim()).filter(Boolean)
      : [input];
    for (const part of parts) {
      const { canonical, warning } = resolveLang(part);
      if (warning) warnings.push(warning);
      if (canonical && !seen.has(canonical)) {
        seen.add(canonical);
        langs.push(canonical);
      }
    }
  }
  return { langs, warnings };
}

function suggestLang(input: string, n = 3): string[] {
  const q = input.toLowerCase();
  const scored: { name: string; score: number }[] = [];
  for (const canon of Object.keys(CANONICAL)) {
    const keys = [canon, ...CANONICAL[canon]].map((k) => k.toLowerCase());
    let best = 0;
    for (const k of keys) {
      if (k === q) return [canon];
      if (k.startsWith(q) || q.startsWith(k)) best = Math.max(best, 80);
      else if (k.includes(q) || q.includes(k)) best = Math.max(best, 50);
      else best = Math.max(best, similarity(q, k) * 40);
    }
    if (best > 20) scored.push({ name: canon, score: best });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((s) => s.name);
}

function similarity(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) matches++;
  }
  return matches / longer.length;
}

export function listKnownLangs(): string[] {
  return Object.keys(CANONICAL).sort();
}
