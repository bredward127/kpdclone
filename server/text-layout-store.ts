import crypto from "node:crypto";
import type { AppDatabase } from "./db";
import { DEFAULT_TEXT_LAYOUT, type PageTextOverride, type TextLayout } from "../shared/text-layout";

export type StoredTextLayout = TextLayout & { pageOverrides: Record<string, PageTextOverride> };

type Row = {
  fontId: string; fontSize: number; lineHeight: number; align: string; placement: string;
  colorHex: string; marginInches: number; textBandInches: number; showPageNumbers: number;
  pageOverridesJson: string;
};

function parseOverrides(raw: string): Record<string, PageTextOverride> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, PageTextOverride> : {};
  } catch {
    return {};
  }
}

/** Falls back to the shared defaults so a book with no saved layout still renders. */
export function getTextLayout(db: AppDatabase, userId: string, projectId: string): StoredTextLayout {
  const row = db.prepare(
    `SELECT font_id AS fontId, font_size AS fontSize, line_height AS lineHeight, align, placement,
            color_hex AS colorHex, margin_inches AS marginInches, text_band_inches AS textBandInches,
            show_page_numbers AS showPageNumbers, page_overrides_json AS pageOverridesJson
     FROM interior_text_layouts WHERE user_id = ? AND project_id = ?`,
  ).get(userId, projectId) as Row | undefined;

  if (!row) return { ...DEFAULT_TEXT_LAYOUT, pageOverrides: {} };
  return {
    fontId: row.fontId,
    fontSize: Number(row.fontSize),
    lineHeight: Number(row.lineHeight),
    align: row.align as TextLayout["align"],
    placement: row.placement as TextLayout["placement"],
    colorHex: row.colorHex,
    marginInches: Number(row.marginInches),
    textBandInches: Number(row.textBandInches),
    showPageNumbers: row.showPageNumbers === 1,
    pageOverrides: parseOverrides(row.pageOverridesJson),
  };
}

export function saveTextLayout(db: AppDatabase, userId: string, projectId: string, layout: StoredTextLayout): StoredTextLayout {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO interior_text_layouts
       (id, user_id, project_id, font_id, font_size, line_height, align, placement, color_hex,
        margin_inches, text_band_inches, show_page_numbers, page_overrides_json, created_at, updated_at)
     VALUES (@id, @userId, @projectId, @fontId, @fontSize, @lineHeight, @align, @placement, @colorHex,
             @marginInches, @textBandInches, @showPageNumbers, @pageOverridesJson, @now, @now)
     ON CONFLICT(user_id, project_id) DO UPDATE SET
       font_id = excluded.font_id, font_size = excluded.font_size, line_height = excluded.line_height,
       align = excluded.align, placement = excluded.placement, color_hex = excluded.color_hex,
       margin_inches = excluded.margin_inches, text_band_inches = excluded.text_band_inches,
       show_page_numbers = excluded.show_page_numbers, page_overrides_json = excluded.page_overrides_json,
       updated_at = excluded.updated_at`,
  ).run({
    id: crypto.randomUUID(), userId, projectId,
    fontId: layout.fontId, fontSize: layout.fontSize, lineHeight: layout.lineHeight,
    align: layout.align, placement: layout.placement, colorHex: layout.colorHex,
    marginInches: layout.marginInches, textBandInches: layout.textBandInches,
    showPageNumbers: layout.showPageNumbers ? 1 : 0,
    pageOverridesJson: JSON.stringify(layout.pageOverrides ?? {}),
    now,
  });
  return getTextLayout(db, userId, projectId);
}
