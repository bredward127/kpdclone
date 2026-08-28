/**
 * Coloring-page rules, in one place so the prompt composer, the story drafter
 * and the tests cannot drift apart on what a coloring page is.
 *
 * A coloring page is not "a picture with the colour removed". It is line art
 * built to be coloured in: closed shapes, even stroke weight, no rendered
 * value, and enough open interior area for a crayon. Stating that positively
 * matters more than listing what to avoid, but both are needed because image
 * models default to shaded, full-colour illustration.
 */

export type InteriorArtStyle = "full_color" | "coloring_line_art";

export const INTERIOR_ART_STYLES: readonly InteriorArtStyle[] = ["full_color", "coloring_line_art"];

export function isColoringLineArt(style: string | null | undefined): boolean {
  return style === "coloring_line_art";
}

/** Positive rules. Every one is a property a colourable page must have. */
export const COLORING_PAGE_RULES: readonly string[] = [
  "Pure black-and-white line art intended to be coloured in by hand.",
  "Every shape is fully enclosed by an unbroken outline so colour cannot leak between regions.",
  "Uniform, confident stroke weight throughout; no tapering sketch lines and no double or sketchy contours.",
  "Interiors are left empty white. No fills, no greys, no gradients, no shading, no hatching, no cross-hatching, no stippling, no textures.",
  "Large, open, uncluttered areas sized for a child's crayon or marker; avoid fine detail that cannot be coloured.",
  "Pure white background. No background wash, no vignette, no frame or decorative border unless the scene direction asks for one.",
  "Flat, straightforward viewpoint with the subject clearly readable as a silhouette.",
  "No lettering, captions, page numbers, signatures or watermarks anywhere in the image.",
];

/** Things the model must not do. Kept separate so it can feed negative_prompt. */
export const COLORING_PAGE_NEGATIVE_CONSTRAINTS: readonly string[] = [
  "colour", "coloured", "colored", "full colour", "greyscale", "grayscale",
  "shading", "shadows", "gradients", "painted", "watercolour", "watercolor",
  "photorealistic", "3d render", "textured background", "busy background",
  "cross-hatching", "stippling", "sketchy lines", "broken outlines",
  "text", "lettering", "watermark", "signature",
];

export function coloringPageNegativePrompt(): string {
  return `No ${COLORING_PAGE_NEGATIVE_CONSTRAINTS.join(", no ")}.`;
}

/**
 * Language that contradicts a coloring page. Used to warn an author who has
 * carried colour or lighting direction over from a full-colour brief, which
 * pulls the model back toward shaded illustration.
 */
export const COLORING_CONFLICT_PATTERN = /\b(watercolou?r|full[- ]colou?r|colou?r palette|palette of|soft (?:daylight|light|lighting)|warm light|rim light|golden hour|shading|shadows?|gradients?|painterly|painted|gouache|pastel colou?rs?|photoreal(?:istic)?)\b/i;
