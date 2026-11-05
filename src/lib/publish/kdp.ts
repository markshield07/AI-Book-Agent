// Amazon KDP paperback rules, as a registry rather than hardcoded guesses.
// Source (checked 2026-11-05):
//   Trim, bleed and margins: https://kdp.amazon.com/en_US/help/topic/GVBQ3CMEQW3W2VL6
//   Page count limits:       https://kdp.amazon.com/en_US/help/topic/G201857950
// If Amazon changes a number, change it here; every check and layout reads from this file.

export type Ink = "bw" | "standard_color" | "premium_color";
export type Paper = "white" | "cream" | "groundwood";

export interface TrimSize {
  id: string; // "6x9"
  label: string;
  width: number; // inches, without bleed
  height: number;
  large: boolean; // KDP "large trim": wider than 6.12" or taller than 9"
}

const t = (w: number, h: number, label?: string): TrimSize => ({
  id: `${w}x${h}`,
  label: label ?? `${w} × ${h} in`,
  width: w,
  height: h,
  large: w > 6.12 || h > 9,
});

export const TRIM_SIZES: TrimSize[] = [
  t(5, 8),
  t(5.06, 7.81),
  t(5.25, 8),
  t(5.5, 8.5),
  t(6, 9),
  t(6.14, 9.21),
  t(6.69, 9.61),
  t(7, 10),
  t(7.44, 9.69),
  t(7.5, 9.25),
  t(8, 10),
  t(8.25, 6),
  t(8.25, 8.25),
  t(8.5, 8.5),
  t(8.5, 11),
  t(8.27, 11.69, "8.27 × 11.69 in (A4)"),
];

export const DEFAULT_TRIM = "6x9";
export const COMMON_TRIMS = ["5x8", "5.5x8.5", "6x9"];

export function trimById(id: string): TrimSize | undefined {
  return TRIM_SIZES.find((s) => s.id === id);
}

/** Bleed adds 0.125" to the width and 0.25" to the height (top, bottom and the outside edge). */
export const BLEED_WIDTH = 0.125;
export const BLEED_HEIGHT = 0.25;

export function pageSize(trim: TrimSize, bleed: boolean): { width: number; height: number } {
  return bleed ? { width: trim.width + BLEED_WIDTH, height: trim.height + BLEED_HEIGHT } : { width: trim.width, height: trim.height };
}

/** Minimum inside (gutter) margin for a page count. */
export const GUTTER_TABLE: { maxPages: number; inside: number }[] = [
  { maxPages: 150, inside: 0.375 },
  { maxPages: 300, inside: 0.5 },
  { maxPages: 500, inside: 0.625 },
  { maxPages: 700, inside: 0.75 },
  { maxPages: 828, inside: 0.875 },
];

export function minInsideMargin(pages: number): number {
  for (const row of GUTTER_TABLE) if (pages <= row.maxPages) return row.inside;
  return GUTTER_TABLE[GUTTER_TABLE.length - 1].inside;
}

/** Minimum outside, top and bottom margins. */
export function minOutsideMargin(bleed: boolean): number {
  return bleed ? 0.375 : 0.25;
}

type Limits = Record<Ink | "bw_cream" | "bw_groundwood", [number, number] | null>;
// Rows from the KDP page-count table. "bw" is black ink on white paper.
const LIMITS_REGULAR: Limits = { bw: [24, 828], bw_cream: [24, 776], bw_groundwood: [24, 812], standard_color: [72, 600], premium_color: [24, 828] };
const LIMITS_825: Limits = { bw: [24, 800], bw_cream: [24, 750], bw_groundwood: [24, 784], standard_color: [72, 600], premium_color: [24, 800] };
const LIMITS_85: Limits = { bw: [24, 590], bw_cream: [24, 550], bw_groundwood: [24, 578], standard_color: [72, 600], premium_color: [24, 590] };
const LIMITS_A4: Limits = { bw: [24, 780], bw_cream: [24, 730], bw_groundwood: [24, 764], standard_color: null, premium_color: [24, 590] };

function limitsFor(trim: TrimSize): Limits {
  if (trim.id === "8.27x11.69") return LIMITS_A4;
  if (trim.id === "8.5x8.5" || trim.id === "8.5x11") return LIMITS_85;
  if (trim.id === "8.25x6" || trim.id === "8.25x8.25") return LIMITS_825;
  return LIMITS_REGULAR;
}

/** Paper only applies to black-and-white ink; color prints on white. */
export function paperOptions(ink: Ink): Paper[] {
  return ink === "bw" ? ["white", "cream", "groundwood"] : ["white"];
}

/** Min/max page count for a configuration, or null when KDP does not offer it. */
export function pageLimits(trim: TrimSize, ink: Ink, paper: Paper): { min: number; max: number } | null {
  const l = limitsFor(trim);
  const key = ink !== "bw" ? ink : paper === "cream" ? "bw_cream" : paper === "groundwood" ? "bw_groundwood" : "bw";
  const row = l[key];
  return row ? { min: row[0], max: row[1] } : null;
}

export const KDP_MIN_FONT_PT = 7;

export const KDP_LINKS = {
  paperbackFormatting: "https://kdp.amazon.com/en_US/help/topic/GVBQ3CMEQW3W2VL6",
  pageLimits: "https://kdp.amazon.com/en_US/help/topic/G201857950",
  formatPaperback: "https://kdp.amazon.com/en_US/help/topic/G201834190",
  ebookFormatting: "https://kdp.amazon.com/en_US/help/topic/G200645680",
  kindlePreviewer: "https://kdp.amazon.com/en_US/help/topic/G202131170",
  kindleCreate: "https://kdp.amazon.com/en_US/help/topic/GUGQ4WDZ92F733GC",
  uploadPreview: "https://kdp.amazon.com/en_US/help/topic/G200641240",
};
