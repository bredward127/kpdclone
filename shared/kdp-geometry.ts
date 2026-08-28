/**
 * Single source of truth for KDP paperback print geometry.
 *
 * Both the interior builder (server/interior-pdf.ts) and the preflight engine
 * (server/kdp-preflight.ts) must derive every dimension from this module. Neither
 * may keep a private copy of these numbers — that divergence is exactly what
 * caused every bleed project to fail preflight with an impossible expected size.
 *
 * KDP rule, restated: bleed is added to the OUTSIDE, TOP and BOTTOM edges only.
 * The inside (spine/gutter) edge is never trimmed, so it gets no bleed. Width
 * therefore grows by one bleed allowance and height by two.
 *
 *   8.5 x 11 in trim, bleed on  -> 8.625 x 11.25 in page
 *   6   x  9 in trim, bleed on  -> 6.125 x  9.25 in page
 *
 * Source: KDP "Set Trim Size, Bleed, and Margins" and "Paperback Submission
 * Guidelines". Reverify before every ruleset version bump; KDP can change these.
 */

export const KDP_GEOMETRY_VERSION = "kdp-paperback-2026-02";

/** Per-edge bleed allowance in inches. Inside edge is intentionally zero. */
export type BleedAllowanceInches = {
  outsideInches: number;
  topInches: number;
  bottomInches: number;
  insideInches: number;
};

export const KDP_BLEED_ALLOWANCE: BleedAllowanceInches = {
  outsideInches: 0.125,
  topInches: 0.125,
  bottomInches: 0.125,
  insideInches: 0,
};

/** Minimum outside/top/bottom margin, measured from the trim edge. */
export const OUTSIDE_MARGIN_NO_BLEED_INCHES = 0.25;
export const OUTSIDE_MARGIN_WITH_BLEED_INCHES = 0.375;

/**
 * Minimum inside (gutter) margin by total interior page count. Thicker books
 * curve further into the binding, so the gutter steps up.
 */
export type GutterTier = { min: number; max: number; inches: number };

export const GUTTER_TIERS: readonly GutterTier[] = [
  { min: 24, max: 150, inches: 0.375 },
  { min: 151, max: 300, inches: 0.5 },
  { min: 301, max: 500, inches: 0.625 },
  { min: 501, max: 700, inches: 0.75 },
  { min: 701, max: 828, inches: 0.875 },
];

export const MIN_PAGE_COUNT = 24;
export const MAX_PAGE_COUNT = 828;

/**
 * KDP prints spine text on books with MORE THAN 79 pages, so a 79-page book is
 * not eligible. Compare with `pageCount > SPINE_TEXT_EXCLUSIVE_MIN_PAGES`.
 */
export const SPINE_TEXT_EXCLUSIVE_MIN_PAGES = 79;

export function isSpineTextEligible(pageCount: number): boolean {
  return pageCount > SPINE_TEXT_EXCLUSIVE_MIN_PAGES;
}

/** Total inches added to the page width by bleed (outside edge only). */
export function bleedWidthAllowanceInches(
  bleed: boolean,
  allowance: BleedAllowanceInches = KDP_BLEED_ALLOWANCE,
): number {
  return bleed ? allowance.outsideInches + allowance.insideInches : 0;
}

/** Total inches added to the page height by bleed (top and bottom edges). */
export function bleedHeightAllowanceInches(
  bleed: boolean,
  allowance: BleedAllowanceInches = KDP_BLEED_ALLOWANCE,
): number {
  return bleed ? allowance.topInches + allowance.bottomInches : 0;
}

/**
 * The physical PDF page size to build and to expect at preflight.
 * With bleed off this is exactly the trim size.
 */
export function interiorPageSizeInches(
  trimWidthInches: number,
  trimHeightInches: number,
  bleed: boolean,
  allowance: BleedAllowanceInches = KDP_BLEED_ALLOWANCE,
): { width: number; height: number } {
  return {
    width: trimWidthInches + bleedWidthAllowanceInches(bleed, allowance),
    height: trimHeightInches + bleedHeightAllowanceInches(bleed, allowance),
  };
}

export function outsideMarginInches(bleed: boolean): number {
  return bleed ? OUTSIDE_MARGIN_WITH_BLEED_INCHES : OUTSIDE_MARGIN_NO_BLEED_INCHES;
}

/** Top and bottom follow the same minimum as the outside edge. */
export function topBottomMarginInches(bleed: boolean): number {
  return outsideMarginInches(bleed);
}

/**
 * Inside (gutter) margin for a page count. Counts below the minimum clamp to the
 * first tier and counts above the maximum clamp to the last, so this never
 * returns undefined; range validity is enforced separately by preflight.
 */
export function gutterMarginInches(
  pageCount: number,
  tiers: readonly GutterTier[] = GUTTER_TIERS,
): number {
  const tier = tiers.find((candidate) => pageCount >= candidate.min && pageCount <= candidate.max);
  if (tier) return tier.inches;
  return pageCount < tiers[0].min ? tiers[0].inches : tiers[tiers.length - 1].inches;
}
