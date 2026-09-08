/**
 * The typesetting contract shared by the browser preview and the PDF writer.
 *
 * The preview is only worth having if what it shows is what prints, so both
 * sides read the same font catalogue and the same geometry rules from here.
 * Every font is one of the PDF standard 14, which means no font file has to be
 * embedded or licensed, and each has a browser stack with close enough metrics
 * that the preview's line breaks match the export.
 */

export type TextAlign = "left" | "center" | "right";
export type TextPlacement = "below_image" | "above_image" | "overlay_bottom" | "overlay_top";

export type TextLayout = {
  fontId: string;
  fontSize: number;
  lineHeight: number;
  align: TextAlign;
  placement: TextPlacement;
  colorHex: string;
  marginInches: number;
  textBandInches: number;
  showPageNumbers: boolean;
};

export type PageTextOverride = Partial<Pick<TextLayout, "fontId" | "fontSize" | "align" | "placement" | "colorHex">>;

export const DEFAULT_TEXT_LAYOUT: TextLayout = {
  fontId: "times_roman",
  fontSize: 18,
  lineHeight: 1.35,
  align: "center",
  placement: "below_image",
  colorHex: "#14202b",
  marginInches: 0.5,
  textBandInches: 1.6,
  showPageNumbers: false,
};

export type FontChoice = {
  id: string;
  /** Label shown in the interface. */
  label: string;
  /** pdf-lib StandardFonts key, resolved server-side. */
  standardFont: string;
  /** Browser stack with metrics close to the PDF font. */
  cssStack: string;
  /** Which kinds of book this suits, for the recommendation. */
  note: string;
};

export const FONT_CHOICES: readonly FontChoice[] = [
  { id: "times_roman", label: "Times Roman", standardFont: "TimesRoman", cssStack: '"Times New Roman", Times, serif', note: "Classic storybook serif. Easiest to read aloud at length." },
  { id: "times_bold", label: "Times Roman Bold", standardFont: "TimesRomanBold", cssStack: '"Times New Roman", Times, serif', note: "Heavier serif for very young readers or text over busy art." },
  { id: "times_italic", label: "Times Roman Italic", standardFont: "TimesRomanItalic", cssStack: '"Times New Roman", Times, serif', note: "For asides, dream sequences and quoted song." },
  { id: "helvetica", label: "Helvetica", standardFont: "Helvetica", cssStack: "Helvetica, Arial, sans-serif", note: "Clean sans. Good for activity and coloring books." },
  { id: "helvetica_bold", label: "Helvetica Bold", standardFont: "HelveticaBold", cssStack: "Helvetica, Arial, sans-serif", note: "Highest contrast. Best for early readers and large type." },
  { id: "courier", label: "Courier", standardFont: "Courier", cssStack: '"Courier New", Courier, monospace' , note: "Typewriter look. Niche; hard to read in long passages." },
] as const;

export function fontChoice(fontId: string): FontChoice {
  return FONT_CHOICES.find((choice) => choice.id === fontId) ?? FONT_CHOICES[0];
}

/** Italic and bold are separate standard fonts, so weight/style come from the id. */
export function cssFontStyle(fontId: string): { fontWeight: number; fontStyle: "normal" | "italic" } {
  return { fontWeight: fontId.includes("bold") ? 700 : 400, fontStyle: fontId.includes("italic") ? "italic" : "normal" };
}

export function resolveLayout(base: TextLayout, override?: PageTextOverride): TextLayout {
  return override ? { ...base, ...override } : base;
}

/**
 * Where the text block sits on the page, in inches from the bottom-left origin
 * the PDF uses. Returned in the same shape as a TextBlock so the writer can use
 * it directly and the preview can convert it to percentages.
 */
export function textBlockRect(
  layout: TextLayout,
  trimWidthInches: number,
  trimHeightInches: number,
): { x: number; y: number; width: number; height: number } {
  const margin = Math.min(layout.marginInches, Math.min(trimWidthInches, trimHeightInches) / 3);
  const width = Math.max(0.5, trimWidthInches - margin * 2);
  const band = Math.min(layout.textBandInches, trimHeightInches - margin * 2);
  const atTop = layout.placement === "above_image" || layout.placement === "overlay_top";
  return { x: margin, y: atTop ? trimHeightInches - margin - band : margin, width, height: band };
}

/** True when the text sits on top of the artwork rather than in its own band. */
export function isOverlay(placement: TextPlacement): boolean {
  return placement === "overlay_bottom" || placement === "overlay_top";
}

/**
 * How much vertical room the artwork gets once the text band is reserved.
 * Overlay placements leave the image full-bleed and sit on top of it.
 */
export function imageHeightInches(layout: TextLayout, trimHeightInches: number): number {
  if (isOverlay(layout.placement)) return trimHeightInches;
  const margin = Math.min(layout.marginInches, trimHeightInches / 3);
  return Math.max(1, trimHeightInches - layout.textBandInches - margin * 1.5);
}

export type LayoutRecommendation = { fontId: string; fontSize: number; placement: TextPlacement; align: TextAlign; textBandInches: number; reason: string };

/**
 * Suggest a starting point from what the book already declares. Trim size caps
 * how large type can be before it stops fitting, and the reader age decides how
 * large it needs to be; a coloring interior wants nothing sitting over the art.
 */
export function recommendLayout(input: {
  trimWidthInches: number;
  trimHeightInches: number;
  audience?: string | null;
  coloringBook?: boolean;
  longestPageTextLength?: number;
}): LayoutRecommendation {
  const age = ageFromAudience(input.audience);
  const coloring = Boolean(input.coloringBook);
  const reasons: string[] = [];

  if (coloring) {
    reasons.push("A coloring interior keeps the art clear, so text sits in its own band rather than over the line work.");
    return { fontId: "helvetica_bold", fontSize: 20, placement: "below_image", align: "center", textBandInches: 1.2, reason: `${reasons.join(" ")} Bold sans stays legible next to black line art.` };
  }

  let fontSize = 18;
  let fontId = "times_roman";
  if (age !== null && age <= 5) { fontSize = 24; fontId = "helvetica_bold"; reasons.push(`For readers around age ${age}, large bold type is easier for an adult to read aloud and for a child to follow.`); }
  else if (age !== null && age <= 8) { fontSize = 20; fontId = "times_roman"; reasons.push(`Ages ${age} and up read comfortably at 20pt serif.`); }
  else { reasons.push("Without a stated reader age this uses 18pt serif, a safe picture-book default."); }

  // Long passages need a taller band or they overflow the reserved space.
  const length = input.longestPageTextLength ?? 0;
  let textBandInches = 1.6;
  if (length > 240) { textBandInches = 2.4; reasons.push("Your longest page runs long, so the text band is taller to fit it without shrinking the type."); }
  else if (length > 120) { textBandInches = 2.0; }

  // Very small trims cannot carry large type across a full line.
  if (input.trimWidthInches <= 6 && fontSize > 20) { fontSize = 20; reasons.push(`On a ${input.trimWidthInches}in wide trim, type above 20pt gives too few words per line.`); }
  if (textBandInches > input.trimHeightInches / 2) { textBandInches = Number((input.trimHeightInches / 2).toFixed(2)); reasons.push("The band is capped at half the page so the artwork keeps the larger share."); }

  return { fontId, fontSize, placement: "below_image", align: "center", textBandInches, reason: reasons.join(" ") };
}

function ageFromAudience(audience?: string | null): number | null {
  if (!audience) return null;
  const match = audience.match(/(\d{1,2})\s*(?:[-–—to]+\s*(\d{1,2}))?/);
  if (!match) return null;
  const low = Number(match[1]);
  return Number.isFinite(low) && low >= 0 && low <= 18 ? low : null;
}
