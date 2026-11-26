import { locate, type Location, type SourceDoc } from "./load.ts";

// Characters that differ between a Markdown/PDF source and a model's quote but carry no meaning.
const DROP = new Set([..."*`|#>_\"'«»„“”‘’•◦▪·"]);
const DASHES = /[‐‑‒–—―−]/;
const ELLIPSIS = /\s*(?:\.\.\.|…)\s*/;
const MIN_FRAGMENT = 12;

interface Normalized {
  norm: string;
  /** map[i] is the offset in the original string of norm[i]. */
  map: number[];
}

/**
 * Lowercase and drop whitespace, markup and quote marks. Whitespace is dropped entirely, not collapsed,
 * because PDF text breaks lines inside words ("пере\nводы"). A hyphen between a letter and a line break is a word
 * break and is dropped too; a standalone dash at the end of a line ("Prod: —") is kept. List bullets from DOCX are dropped.
 */
export function normalize(s: string): Normalized {
  let norm = "";
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let ch = s[i]!.toLowerCase();
    if (DROP.has(ch) || /\s/.test(ch) || ch === "\u00ad") continue;
    if (ch === "ё") ch = "е";
    if (ch === "-" || DASHES.test(ch)) {
      if (/\p{L}/u.test(s[i - 1] ?? "") && /^[ \t]*\r?\n/.test(s.slice(i + 1, i + 8))) continue;
      ch = "-";
    }
    norm += ch;
    map.push(i);
  }
  return { norm, map };
}

export interface Grounded {
  quote: string;
  start: number;
  end: number;
  location: Location;
}

/** Index of the document, built once, used to check that quotes exist verbatim. */
export class Grounder {
  private readonly n: Normalized;

  constructor(private readonly doc: SourceDoc) {
    this.n = normalize(doc.text);
  }

  /**
   * Find the quote in the document, ignoring case, whitespace, Markdown markup and quote styles.
   * A quote with an ellipsis matches when every fragment is found in order.
   * Returns null when the quote is not in the document.
   */
  find(quote: string): Grounded | null {
    const fragments = quote
      .split(ELLIPSIS)
      .map((f) => normalize(f).norm)
      .filter((f) => f.length > 0);
    if (fragments.length === 0) return null;
    if (fragments.length > 1 && fragments.some((f) => f.length < MIN_FRAGMENT)) return null;
    if (fragments[0]!.length < 3) return null;

    let from = 0;
    let first = -1;
    let last = -1;
    for (const f of fragments) {
      const at = this.n.norm.indexOf(f, from);
      if (at < 0) return null;
      if (first < 0) first = at;
      last = at + f.length - 1;
      from = at + f.length;
    }
    const start = this.n.map[first]!;
    const end = this.n.map[last]! + 1;
    return { quote, start, end, location: locate(this.doc, start, end) };
  }
}
