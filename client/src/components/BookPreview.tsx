import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, ImageIcon, Loader2, RotateCcw, Save, Sparkles, Type } from "lucide-react";
import { trpc } from "@/lib/trpc";
import {
  cssFontStyle, fontChoice, imageHeightInches, isOverlay, resolveLayout, textBlockRect,
  type PageTextOverride, type TextAlign, type TextLayout, type TextPlacement,
} from "../../../shared/text-layout";
import { ErrorState, LoadingState } from "./States";

const placements: Array<{ value: TextPlacement; label: string; hint: string }> = [
  { value: "below_image", label: "Below the picture", hint: "Art on top, text underneath. The usual picture-book layout." },
  { value: "above_image", label: "Above the picture", hint: "Text first, then the art." },
  { value: "overlay_bottom", label: "Over the picture, bottom", hint: "Full-bleed art with text sitting on it." },
  { value: "overlay_top", label: "Over the picture, top", hint: "Full-bleed art with text across the top." },
];

/**
 * Page-through mock-up of the finished book with the story text typeset over
 * the artwork, so typesetting is approved page by page before anything is
 * exported. The geometry and font catalogue come from shared/text-layout, the
 * same source the PDF writer uses, so this shows what will actually print.
 */
export default function BookPreview({ projectId }: { projectId: string }) {
  const preview = trpc.studio.textLayout.preview.useQuery({ projectId });
  const recommendation = trpc.studio.textLayout.recommend.useQuery({ projectId });
  const fonts = trpc.studio.textLayout.fonts.useQuery();
  const save = trpc.studio.textLayout.save.useMutation();
  const utils = trpc.useUtils();

  const [index, setIndex] = useState(0);
  const [layout, setLayout] = useState<TextLayout | null>(null);
  const [overrides, setOverrides] = useState<Record<string, PageTextOverride>>({});
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState("");
  const [scope, setScope] = useState<"book" | "page">("book");

  useEffect(() => {
    if (!preview.data || dirty) return;
    const { pageOverrides, ...base } = preview.data.layout;
    setLayout(base);
    setOverrides(pageOverrides);
  }, [preview.data, dirty]);

  const pages = preview.data?.pages ?? [];
  const page = pages[Math.min(index, Math.max(0, pages.length - 1))];

  // Arrow keys page through the book the way a reader would.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
      if (event.key === "ArrowRight") setIndex((current) => Math.min(current + 1, pages.length - 1));
      if (event.key === "ArrowLeft") setIndex((current) => Math.max(current - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pages.length]);

  if (preview.isLoading) return <LoadingState label="Building your book preview" />;
  if (preview.isError) return <ErrorState message="The preview could not be loaded." />;
  if (!preview.data || !layout) return <ErrorState message="This book could not be previewed." />;
  if (!pages.length) return <div className="rounded-[24px] border border-dashed border-[#c7d0d0] bg-[#fbfaf4] p-12 text-center"><p className="serif text-2xl text-[var(--ink)]">No pages to preview yet.</p><p className="mt-2 text-sm text-[var(--muted-ink)]">Plan your pages and generate artwork first.</p></div>;

  const { trim } = preview.data;
  const effective = resolveLayout(layout, scope === "page" && page ? overrides[page.pagePlanId] : undefined);
  const choice = fontChoice(effective.fontId);
  const { fontWeight, fontStyle } = cssFontStyle(effective.fontId);

  /** Apply an edit to the book default, or to just this page. */
  const change = (patch: Partial<TextLayout>) => {
    setDirty(true);
    setNotice("");
    if (scope === "page" && page) {
      setOverrides((current) => ({ ...current, [page.pagePlanId]: { ...current[page.pagePlanId], ...patch } }));
    } else {
      setLayout((current) => current ? { ...current, ...patch } : current);
    }
  };

  const clearPageOverride = () => {
    if (!page) return;
    setDirty(true);
    setOverrides((current) => { const next = { ...current }; delete next[page.pagePlanId]; return next; });
    setNotice(`Page ${page.pageNumber} now follows the whole-book settings.`);
  };

  const applyRecommendation = () => {
    if (!recommendation.data) return;
    const { reason: _reason, ...values } = recommendation.data;
    setScope("book");
    setDirty(true);
    setLayout((current) => current ? { ...current, ...values } : current);
    setNotice("Recommended settings applied to the whole book. Page through to check the longest pages, then save.");
  };

  const persist = () => {
    if (!layout) return;
    setNotice("");
    save.mutate({ projectId, ...layout, pageOverrides: overrides }, {
      onSuccess: async () => {
        setDirty(false);
        await utils.studio.textLayout.preview.invalidate({ projectId });
        setNotice("Typesetting saved. The export will use exactly this.");
      },
      onError: (error) => setNotice(error.message),
    });
  };

  // Percentages so the mock-up scales with its container while keeping the
  // real page proportions and the real text position.
  const rect = textBlockRect(effective, trim.widthInches, trim.heightInches);
  const overlay = isOverlay(effective.placement);
  const artHeightPct = (imageHeightInches(effective, trim.heightInches) / trim.heightInches) * 100;
  const textPct = {
    left: (rect.x / trim.widthInches) * 100,
    width: (rect.width / trim.widthInches) * 100,
    height: (rect.height / trim.heightInches) * 100,
    bottom: (rect.y / trim.heightInches) * 100,
  };
  // 1 inch of page maps to this many CSS pixels at the rendered width, so
  // point sizes shown here are proportional to the printed size.
  const pageWidthPx = 460;
  const pxPerInch = pageWidthPx / trim.widthInches;
  const previewFontPx = (effective.fontSize / 72) * pxPerInch;

  const overflowRisk = useMemo(() => {
    if (!page?.pageText) return false;
    // Rough check: characters that fit the band at this size and measure.
    const charsPerLine = Math.max(8, (rect.width * 72) / (effective.fontSize * 0.5));
    const lines = Math.ceil(page.pageText.length / charsPerLine);
    return lines * effective.fontSize * effective.lineHeight > rect.height * 72;
  }, [page?.pageText, rect.width, rect.height, effective.fontSize, effective.lineHeight]);

  const overridden = Boolean(page && overrides[page.pagePlanId]);

  return (
    <section className="space-y-5">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">

        {/* The page */}
        <div>
          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={() => setIndex((c) => Math.max(c - 1, 0))} disabled={index === 0} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--ink)] disabled:opacity-40"><ChevronLeft size={15} />Previous</button>
            <p className="mono text-xs text-[var(--muted-ink)]">Page {page?.pageNumber} of {pages.length}{overridden ? " · custom" : ""}</p>
            <button type="button" onClick={() => setIndex((c) => Math.min(c + 1, pages.length - 1))} disabled={index >= pages.length - 1} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--ink)] disabled:opacity-40">Next<ChevronRight size={15} /></button>
          </div>

          <div className="mt-4 flex justify-center">
            <div
              className="relative overflow-hidden bg-white shadow-[0_10px_40px_rgba(24,43,58,.16)]"
              style={{ width: pageWidthPx, height: pageWidthPx * (trim.heightInches / trim.widthInches) }}
            >
              {/* Artwork */}
              <div className={`absolute left-0 w-full ${effective.placement === "above_image" ? "bottom-0" : "top-0"}`} style={{ height: `${artHeightPct}%` }}>
                {page?.imageUrl
                  ? <img src={page.imageUrl} alt={`Page ${page.pageNumber} artwork`} className="h-full w-full object-cover" />
                  : <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[#f2efe4] text-[var(--muted-ink)]"><ImageIcon size={26} /><span className="text-xs">No approved image yet</span></div>}
              </div>

              {/* Story text, positioned exactly where the PDF will place it */}
              <div
                className="absolute flex flex-col justify-start"
                style={{
                  left: `${textPct.left}%`, width: `${textPct.width}%`,
                  bottom: `${textPct.bottom}%`, height: `${textPct.height}%`,
                  textAlign: effective.align,
                  fontFamily: choice.cssStack, fontWeight, fontStyle,
                  fontSize: `${previewFontPx}px`, lineHeight: effective.lineHeight,
                  color: effective.colorHex,
                  textShadow: overlay ? "0 1px 3px rgba(255,255,255,.85), 0 0 10px rgba(255,255,255,.7)" : undefined,
                }}
              >
                <span style={{ whiteSpace: "pre-wrap" }}>{page?.pageText || ""}</span>
              </div>

              {effective.showPageNumbers && (
                <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 text-[9px] text-[var(--muted-ink)]" style={{ fontFamily: choice.cssStack }}>{page?.pageNumber}</span>
              )}
            </div>
          </div>

          <p className="mt-3 text-center text-[11px] text-[var(--muted-ink)]">
            {trim.widthInches}in × {trim.heightInches}in trim · {choice.label} at {effective.fontSize}pt · use ← and → to page through
          </p>

          {!page?.pageText && (
            <p className="mt-3 rounded-xl bg-[#fff4e0] p-3 text-xs text-[#8a6524]">This page has no story text. Add it on the Pages step if it should carry words.</p>
          )}
          {overflowRisk && (
            <p className="mt-3 flex items-start gap-2 rounded-xl border border-[#e2b4a8] bg-[#fff0eb] p-3 text-xs text-[#7f433a]"><AlertTriangle size={14} className="mt-0.5 shrink-0" />This page's text may not fit the band at {effective.fontSize}pt. Reduce the size or make the text band taller.</p>
          )}
        </div>

        {/* Controls */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-4">
            <div className="flex items-center gap-2"><Type size={15} className="text-[var(--coral)]" /><p className="text-sm font-semibold text-[var(--ink)]">Typesetting</p></div>

            <div className="mt-3 inline-flex w-full overflow-hidden rounded-full border border-[var(--line)] text-[11px] font-semibold">
              <button type="button" onClick={() => setScope("book")} className={`flex-1 px-3 py-1.5 ${scope === "book" ? "bg-[var(--navy)] text-white" : "text-[var(--ink)]"}`}>Whole book</button>
              <button type="button" onClick={() => setScope("page")} className={`flex-1 px-3 py-1.5 ${scope === "page" ? "bg-[var(--navy)] text-white" : "text-[var(--ink)]"}`}>This page only</button>
            </div>

            <label className="mt-4 block text-xs font-semibold text-[var(--ink)]">Font
              <select value={effective.fontId} onChange={(e) => change({ fontId: e.target.value })} className="field mt-1.5">
                {(fonts.data ?? []).map((font) => <option key={font.id} value={font.id}>{font.label}</option>)}
              </select>
            </label>
            <p className="mt-1 text-[11px] leading-4 text-[var(--muted-ink)]">{choice.note}</p>

            <label className="mt-4 block text-xs font-semibold text-[var(--ink)]">Size — {effective.fontSize}pt
              <input type="range" min={8} max={48} step={1} value={effective.fontSize} onChange={(e) => change({ fontSize: Number(e.target.value) })} className="mt-1.5 w-full accent-[#203348]" />
            </label>

            <label className="mt-3 block text-xs font-semibold text-[var(--ink)]">Line spacing — {effective.lineHeight.toFixed(2)}
              <input type="range" min={1} max={2.2} step={0.05} value={effective.lineHeight} onChange={(e) => change({ lineHeight: Number(e.target.value) })} disabled={scope === "page"} className="mt-1.5 w-full accent-[#203348] disabled:opacity-40" />
            </label>

            <p className="mt-4 text-xs font-semibold text-[var(--ink)]">Alignment</p>
            <div className="mt-1.5 inline-flex overflow-hidden rounded-full border border-[var(--line)] text-[11px] font-semibold">
              {(["left", "center", "right"] as TextAlign[]).map((value) => (
                <button key={value} type="button" onClick={() => change({ align: value })} className={`px-3 py-1.5 capitalize ${effective.align === value ? "bg-[var(--navy)] text-white" : "text-[var(--ink)]"}`}>{value}</button>
              ))}
            </div>

            <label className="mt-4 block text-xs font-semibold text-[var(--ink)]">Where the text sits
              <select value={effective.placement} onChange={(e) => change({ placement: e.target.value as TextPlacement })} className="field mt-1.5">
                {placements.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <p className="mt-1 text-[11px] leading-4 text-[var(--muted-ink)]">{placements.find((option) => option.value === effective.placement)?.hint}</p>

            <label className="mt-4 flex items-center gap-2 text-xs font-semibold text-[var(--ink)]">Text colour
              <input type="color" value={effective.colorHex} onChange={(e) => change({ colorHex: e.target.value })} className="h-7 w-12 cursor-pointer rounded border border-[var(--line)]" />
              <span className="mono text-[10px] text-[var(--muted-ink)]">{effective.colorHex}</span>
            </label>

            <label className="mt-4 block text-xs font-semibold text-[var(--ink)]">Text band height — {effective.textBandInches.toFixed(2)}in
              <input type="range" min={0.4} max={Math.max(1, trim.heightInches - 1)} step={0.1} value={effective.textBandInches} onChange={(e) => change({ textBandInches: Number(e.target.value) })} disabled={scope === "page"} className="mt-1.5 w-full accent-[#203348] disabled:opacity-40" />
            </label>

            <label className="mt-3 block text-xs font-semibold text-[var(--ink)]">Margin — {effective.marginInches.toFixed(2)}in
              <input type="range" min={0.125} max={1.5} step={0.0625} value={effective.marginInches} onChange={(e) => change({ marginInches: Number(e.target.value) })} disabled={scope === "page"} className="mt-1.5 w-full accent-[#203348] disabled:opacity-40" />
            </label>

            <label className="mt-4 flex items-center gap-2 text-xs font-semibold text-[var(--ink)]">
              <input type="checkbox" checked={effective.showPageNumbers} onChange={(e) => change({ showPageNumbers: e.target.checked })} disabled={scope === "page"} className="h-4 w-4 accent-[#203348] disabled:opacity-40" />
              Show page numbers
            </label>

            {scope === "page" && (
              <button type="button" onClick={clearPageOverride} disabled={!overridden} className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--coral)] disabled:opacity-40"><RotateCcw size={12} />Reset this page to the book settings</button>
            )}
          </div>

          {recommendation.data && (
            <div className="rounded-2xl border border-[var(--line)] bg-[#f7f5ee] p-4">
              <div className="flex items-center gap-2"><Sparkles size={14} className="text-[var(--coral)]" /><p className="text-sm font-semibold text-[var(--ink)]">Recommended for this book</p></div>
              <p className="mt-1.5 text-[11px] leading-5 text-[var(--muted-ink)]">{recommendation.data.reason}</p>
              <p className="mt-2 text-[11px] text-[var(--ink)]">{fontChoice(recommendation.data.fontId).label} · {recommendation.data.fontSize}pt · {placements.find((option) => option.value === recommendation.data.placement)?.label.toLowerCase()}</p>
              <button type="button" onClick={applyRecommendation} className="mt-3 w-full rounded-full bg-[var(--navy)] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2d465f]">Use these settings</button>
            </div>
          )}

          <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-4">
            <button type="button" onClick={persist} disabled={save.isPending || !dirty} className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--coral)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#c95d4d] disabled:opacity-45">
              {save.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}{save.isPending ? "Saving…" : dirty ? "Save typesetting" : "Saved"}
            </button>
            {notice ? <p className="mt-2 text-[11px] leading-4 text-[#356b63]" role="status">{notice}</p> : <p className="mt-2 text-[11px] leading-4 text-[var(--muted-ink)]">Your story text is typeset over the artwork at export, never drawn into the image.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
