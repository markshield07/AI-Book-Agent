// Stage 5: validate model suggestions against the source text before anything is stored.
import { rangesOverlap } from "../doc/assemble";
import type { EditingMode, RawSuggestion } from "../ai/types";

export interface ParagraphRef {
  ref: string;
  paragraphId: string;
  text: string;
  style: string;
  acceptedRanges: { start: number; end: number }[];
  pendingRanges: { start: number; end: number }[];
}

export interface ValidSuggestion {
  paragraphId: string;
  start: number;
  end: number;
  originalText: string;
  suggestedText: string;
  category: string;
  explanation: string;
  severity: string;
  confidence: number;
  contribution: "edit" | "addition";
}

export interface Discarded {
  raw: RawSuggestion;
  reason: string;
}

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}'’]/u.test(c);

/** Narrow a suggestion to the span that actually changes, expanded to whole words. */
export function minimize(original: string, replacement: string): { offset: number; original: string; replacement: string } {
  let pre = 0;
  const max = Math.min(original.length, replacement.length);
  while (pre < max && original[pre] === replacement[pre]) pre++;
  let suf = 0;
  while (
    suf < max - pre &&
    original[original.length - 1 - suf] === replacement[replacement.length - 1 - suf]
  )
    suf++;
  let a = pre;
  let b = original.length - suf;
  while (a > 0 && (isWordChar(original[a - 1]) && (isWordChar(original[a]) || a === b))) a--;
  while (b < original.length && isWordChar(original[b]) && (isWordChar(original[b - 1]) || a === b)) b++;
  // Pure spacing/punctuation changes read better with the neighbouring word attached.
  const coreRep = replacement.slice(a, replacement.length - (original.length - b));
  const hasWord = (s: string) => /[\p{L}\p{N}]/u.test(s);
  if (!hasWord(original.slice(a, b)) || !hasWord(coreRep)) {
    const isPunct = (c: string | undefined) => !!c && !/\s/.test(c) && !isWordChar(c);
    while (a > 0 && isPunct(original[a - 1])) a--;
    while (a > 0 && isWordChar(original[a - 1])) a--;
    while (b < original.length && isPunct(original[b])) b++;
  }
  const repEnd = replacement.length - (original.length - b);
  return { offset: a, original: original.slice(a, b), replacement: replacement.slice(a, repEnd) };
}

function countOccurrences(hay: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    n++;
    i = hay.indexOf(needle, i + 1);
  }
  return n;
}

export function validateSuggestions(
  raw: RawSuggestion[],
  paragraphs: ParagraphRef[],
  opts: {
    mode: EditingMode;
    protectedTerms: string[];
    rejected: { paragraphId: string; original: string; replacement: string }[];
  }
): { valid: ValidSuggestion[]; discarded: Discarded[] } {
  const byRef = new Map(paragraphs.map((p) => [p.ref.toUpperCase(), p]));
  const valid: ValidSuggestion[] = [];
  const discarded: Discarded[] = [];
  const claimed = new Map<string, { start: number; end: number }[]>();
  const drop = (r: RawSuggestion, reason: string) => discarded.push({ raw: r, reason });

  for (const r of raw) {
    const p = byRef.get(r.paragraph.trim().replace(/^\[|\]$/g, "").toUpperCase());
    if (!p) {
      drop(r, "unknown paragraph reference");
      continue;
    }
    if (p.style === "scene_break") {
      drop(r, "scene breaks are formatting, not text");
      continue;
    }
    if (!r.original) {
      drop(r, "empty anchor");
      continue;
    }
    const occurrences = countOccurrences(p.text, r.original);
    if (occurrences === 0) {
      drop(r, "original text not found in paragraph");
      continue;
    }
    if (occurrences > 1) {
      drop(r, "original text is ambiguous within paragraph");
      continue;
    }
    if (r.original === r.replacement) {
      drop(r, "no change");
      continue;
    }
    const anchorStart = p.text.indexOf(r.original);
    // Minimise against the whole paragraph so word expansion can use real context.
    const edited = p.text.slice(0, anchorStart) + r.replacement + p.text.slice(anchorStart + r.original.length);
    const min = minimize(p.text, edited);
    const start = min.offset;
    const end = start + min.original.length;
    const orig = min.original;
    const rep = min.replacement;

    // Protected terms must survive untouched.
    const brokenTerm = opts.protectedTerms.find(
      (t) => t && countOccurrences(r.original, t) !== countOccurrences(r.replacement, t)
    );
    if (brokenTerm) {
      drop(r, `changes protected term "${brokenTerm}"`);
      continue;
    }
    // Scope limits per mode: proofreading and copyediting must not rewrite passages.
    const limit = opts.mode === "PROOFREAD" ? 80 : opts.mode === "COPYEDIT" ? 300 : 1200;
    if (orig.length > limit || rep.length > limit * 1.5) {
      drop(r, "change is larger than this editing mode allows");
      continue;
    }
    if (opts.mode === "DEVELOPMENTAL" && !["typo", "spelling"].includes(r.category)) {
      drop(r, "developmental review gives notes, not text edits");
      continue;
    }
    if (rep === "" && orig.length > 200) {
      drop(r, "would delete a long passage");
      continue;
    }
    // Paragraph duplication guard: replacement must not contain another paragraph's text.
    if (
      rep.length > 60 &&
      paragraphs.some((q) => q.paragraphId !== p.paragraphId && q.text.length > 40 && rep.includes(q.text.slice(0, 60)))
    ) {
      drop(r, "would duplicate text from another paragraph");
      continue;
    }
    if (rep.length > 60 && countOccurrences(p.text.slice(0, start) + rep + p.text.slice(end), rep) > 1) {
      drop(r, "would duplicate text within the paragraph");
      continue;
    }
    const range = { start, end };
    if (p.acceptedRanges.some((a) => rangesOverlap(a, range))) {
      drop(r, "conflicts with an edit the author already accepted");
      continue;
    }
    if (p.pendingRanges.some((a) => rangesOverlap(a, range))) {
      drop(r, "overlaps an existing pending suggestion");
      continue;
    }
    const mine = claimed.get(p.paragraphId) ?? [];
    if (mine.some((a) => rangesOverlap(a, range))) {
      drop(r, "overlaps another suggestion in this batch");
      continue;
    }
    if (
      opts.rejected.some(
        (x) => x.paragraphId === p.paragraphId && x.original === orig && x.replacement === rep
      )
    ) {
      drop(r, "author already rejected this change");
      continue;
    }
    mine.push(range);
    claimed.set(p.paragraphId, mine);
    valid.push({
      paragraphId: p.paragraphId,
      start,
      end,
      originalText: orig,
      suggestedText: rep,
      category: r.category.toLowerCase().replace(/\s+/g, "_").slice(0, 40),
      explanation: r.explanation.slice(0, 2000),
      severity: r.severity,
      confidence: r.confidence,
      contribution: r.adds_new_material ? "addition" : "edit",
    });
  }
  return { valid, discarded };
}
