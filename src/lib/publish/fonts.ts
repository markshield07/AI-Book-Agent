// Bundled book fonts. All are SIL Open Font License 1.1 (see assets/fonts/*/OFL.txt), which
// permits embedding in PDFs and EPUBs, including commercially sold books.
import path from "node:path";
import fs from "node:fs";
import * as fontkit from "fontkit";

export type FamilyId = "eb-garamond" | "crimson-pro" | "source-serif-4" | "lora" | "source-sans-3";
export type FontStyle = "regular" | "italic" | "bold" | "bolditalic";

export const FAMILIES: Record<FamilyId, { name: string; css: string; files: Record<FontStyle, string> }> = {
  "eb-garamond": {
    name: "EB Garamond",
    css: "'EB Garamond', Garamond, Georgia, serif",
    files: { regular: "EBGaramond_400Regular.ttf", italic: "EBGaramond_400Regular_Italic.ttf", bold: "EBGaramond_700Bold.ttf", bolditalic: "EBGaramond_700Bold_Italic.ttf" },
  },
  "crimson-pro": {
    name: "Crimson Pro",
    css: "'Crimson Pro', Georgia, serif",
    files: { regular: "CrimsonPro_400Regular.ttf", italic: "CrimsonPro_400Regular_Italic.ttf", bold: "CrimsonPro_700Bold.ttf", bolditalic: "CrimsonPro_700Bold_Italic.ttf" },
  },
  "source-serif-4": {
    name: "Source Serif 4",
    css: "'Source Serif 4', Georgia, serif",
    files: { regular: "SourceSerif4_400Regular.ttf", italic: "SourceSerif4_400Regular_Italic.ttf", bold: "SourceSerif4_700Bold.ttf", bolditalic: "SourceSerif4_700Bold_Italic.ttf" },
  },
  lora: {
    name: "Lora",
    css: "Lora, Georgia, serif",
    files: { regular: "Lora_400Regular.ttf", italic: "Lora_400Regular_Italic.ttf", bold: "Lora_700Bold.ttf", bolditalic: "Lora_700Bold_Italic.ttf" },
  },
  "source-sans-3": {
    name: "Source Sans 3",
    css: "'Source Sans 3', 'Helvetica Neue', Arial, sans-serif",
    files: { regular: "SourceSans3_400Regular.ttf", italic: "SourceSans3_400Regular_Italic.ttf", bold: "SourceSans3_700Bold.ttf", bolditalic: "SourceSans3_700Bold_Italic.ttf" },
  },
};

/** "family/style", e.g. "eb-garamond/italic". This is the only font reference stored in layouts. */
export type FontKey = `${FamilyId}/${FontStyle}`;

export const fontKey = (family: FamilyId, italic: boolean, bold: boolean): FontKey =>
  `${family}/${bold ? (italic ? "bolditalic" : "bold") : italic ? "italic" : "regular"}`;

export function fontsDir(): string {
  return path.resolve(process.env.FONTS_DIR || path.join(process.cwd(), "assets", "fonts"));
}

/** Absolute path for a font key, or null when the key is not one of ours (allowlist). */
export function fontPath(key: string): string | null {
  const [family, style] = key.split("/") as [FamilyId, FontStyle];
  const fam = FAMILIES[family];
  if (!fam || !Object.hasOwn(FAMILIES, family) || !Object.hasOwn(fam.files, style)) return null;
  return path.join(fontsDir(), family, fam.files[style]);
}

export function allFontKeys(): FontKey[] {
  return (Object.keys(FAMILIES) as FamilyId[]).flatMap((f) => (["regular", "italic", "bold", "bolditalic"] as FontStyle[]).map((s) => `${f}/${s}` as FontKey));
}

const cache = new Map<string, fontkit.Font>();
export function loadFont(key: FontKey): fontkit.Font {
  let f = cache.get(key);
  if (!f) {
    const p = fontPath(key);
    if (!p) throw new Error(`Unknown font ${key}`);
    f = fontkit.create(fs.readFileSync(p)) as fontkit.Font;
    cache.set(key, f);
  }
  return f;
}

export function fontBytes(key: FontKey): Buffer {
  const p = fontPath(key);
  if (!p) throw new Error(`Unknown font ${key}`);
  return fs.readFileSync(p);
}

/** Text measurement in points, cached per font+string (books repeat words a lot). */
export class Measurer {
  private widths = new Map<string, number>();
  readonly missing = new Map<FontKey, Set<string>>();

  width(key: FontKey, text: string, size: number): number {
    const k = key + "\u0000" + text;
    let w = this.widths.get(k);
    if (w === undefined) {
      const font = loadFont(key);
      const run = font.layout(text);
      w = run.advanceWidth / font.unitsPerEm;
      for (const ch of text) {
        const cp = ch.codePointAt(0)!;
        if (cp > 0x20 && cp !== 0xad && !font.hasGlyphForCodePoint(cp)) {
          const set = this.missing.get(key) ?? new Set<string>();
          set.add(ch);
          this.missing.set(key, set);
        }
      }
      this.widths.set(k, w);
    }
    return w * size;
  }

  metrics(key: FontKey) {
    const f = loadFont(key);
    return { ascent: f.ascent / f.unitsPerEm, descent: f.descent / f.unitsPerEm, capHeight: f.capHeight / f.unitsPerEm };
  }
}
