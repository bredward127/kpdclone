import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ImageIcon, Loader2, Sparkles, Wand2 } from "lucide-react";
import { estimateImageCostUsd, formatUsd } from "../../../shared/image-cost";
import { trpc } from "@/lib/trpc";

type CoverRole = "front_cover" | "back_cover";

const roleCopy: Record<CoverRole, { title: string; blurb: string }> = {
  front_cover: {
    title: "Front cover art",
    blurb: "One standalone illustration that has to work on a shelf and as a thumbnail. The title and author name are typeset over it at export — never drawn into it.",
  },
  back_cover: {
    title: "Back cover art (optional)",
    blurb: "A quieter companion image. Keep it open in the middle and low-contrast: your blurb and Amazon's barcode sit on top of it.",
  },
};

/**
 * Pick the aspect ratio the model supports that is closest to the book's trim,
 * so a square book gets square art and a 6x9 gets a portrait image instead of
 * whichever ratio happens to be first in the model's list.
 */
function closestRatio(supported: readonly string[], trimWidth: number, trimHeight: number): string | undefined {
  if (!supported.length || !trimWidth || !trimHeight) return undefined;
  const target = trimWidth / trimHeight;
  return [...supported].sort((left, right) => {
    const value = (ratio: string) => { const [w, h] = ratio.split(":").map(Number); return Math.abs((w / h) - target); };
    return value(left) - value(right);
  })[0];
}

function CoverSurface({ projectId, pageRole }: { projectId: string; pageRole: CoverRole }) {
  const utils = trpc.useUtils();
  const board = trpc.studio.pages.board.useQuery({ projectId, pageRole }, { refetchInterval: 10_000, placeholderData: (prev) => prev });
  const suggestion = trpc.studio.cover.suggestArtDirection.useQuery({ projectId, pageRole });
  const project = trpc.project.get.useQuery({ projectId });
  const models = trpc.studio.generationJobs.models.useQuery();

  const saveDirection = trpc.studio.cover.saveArtDirection.useMutation();
  const prepare = trpc.studio.prompts.prepareForGeneration.useMutation();
  const enqueue = trpc.studio.generationJobs.enqueue.useMutation();
  const syncActive = trpc.studio.generationJobs.syncActive.useMutation();

  const row = board.data?.[0] ?? null;
  const [direction, setDirection] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; kind: "info" | "error" } | null>(null);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Show what is saved, or the suggested starting point when nothing is saved
  // yet — but never overwrite what the author is in the middle of typing.
  useEffect(() => {
    if (dirtyRef.current) return;
    if (row?.sceneDirection) { setDirection(row.sceneDirection); return; }
    if (suggestion.data?.sceneDirection) setDirection(suggestion.data.sceneDirection);
  }, [row?.sceneDirection, suggestion.data?.sceneDirection]);

  // A new signed URL arrives on every poll, so cache it per asset to stop the
  // image reloading under the author every ten seconds.
  const stableUrlRef = useRef<{ id: string; url: string } | null>(null);
  const imageUrl = useMemo(() => {
    const asset = row?.latestAsset;
    if (!asset) return null;
    if (stableUrlRef.current?.id !== asset.id) stableUrlRef.current = { id: asset.id, url: asset.accessUrl };
    return stableUrlRef.current.url;
  }, [row?.latestAsset]);

  const activeModel = models.data?.[0] ?? null;
  const quality = project.data?.imageQuality ?? "low";
  const price = activeModel ? formatUsd(estimateImageCostUsd(activeModel.pricing, quality, 1)) : "unknown cost";

  // Collect the finished image: without a provider webhook nothing else marks
  // the job complete, so the art would sit at "generating" indefinitely.
  useEffect(() => {
    if (!row?.activeJob) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const result = await syncActive.mutateAsync({ projectId });
        if (!cancelled && result.advanced > 0) await utils.studio.pages.board.invalidate({ projectId, pageRole });
      } catch { /* retried on the next tick */ }
    };
    void tick();
    const timer = setInterval(() => { void tick(); }, 12_000);
    return () => { cancelled = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.activeJob, projectId, pageRole]);

  const generate = async () => {
    if (!direction.trim()) { setNotice({ text: "Describe the cover art first.", kind: "error" }); return; }
    if (!activeModel) { setNotice({ text: "No image model is active, so nothing can be generated yet.", kind: "error" }); return; }
    setNotice(null);
    try {
      setBusy("Saving the art direction…");
      const page = await saveDirection.mutateAsync({ projectId, pageRole, sceneDirection: direction.trim() });
      setDirty(false);

      setBusy("Composing the cover prompt…");
      const aspectRatio = closestRatio(activeModel.supportedAspectRatios, project.data?.trimWidthInches ?? 0, project.data?.trimHeightInches ?? 0);
      // Never reuse a frozen prompt here: the author just edited the
      // description, and reusing would generate the previous one at full price.
      const prepared = await prepare.mutateAsync({ projectId, pagePlanIds: [page.pagePlanId], reuseFrozen: false, ...(aspectRatio ? { aspectRatio } : {}) });
      if (!prepared.prepared.length) {
        setNotice({ text: prepared.skipped[0]?.reason ?? "The cover prompt could not be composed.", kind: "error" });
        return;
      }

      setBusy("Sending it to be drawn…");
      const queued = await enqueue.mutateAsync({ projectId, items: prepared.prepared.map((entry) => ({ pagePlanId: entry.pagePlanId, promptVersionId: entry.promptVersionId })) });
      await utils.studio.pages.board.invalidate({ projectId, pageRole });
      setNotice(queued.queued
        ? { text: `Queued — about ${formatUsd(queued.estimatedCostUsd)} at ${quality} quality. The art appears here when it is done; you can leave this page.`, kind: "info" }
        : { text: queued.skipped[0]?.reason ?? "Nothing was queued.", kind: "error" });
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "The cover art could not be generated.", kind: "error" });
    } finally { setBusy(null); }
  };

  const copy = roleCopy[pageRole];

  return (
    <article className="rounded-[24px] border border-[var(--line)] bg-[var(--paper-strong)] p-5 md:p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--coral)] text-white"><ImageIcon size={17} /></span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--ink)]">{copy.title}</p>
          <p className="mt-1 text-xs leading-5 text-[var(--muted-ink)]">{copy.blurb}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
        <div>
          <label className="block text-xs font-semibold text-[var(--ink)]">
            What should the art show?
            <textarea
              value={direction}
              onChange={(event) => { setDirection(event.target.value); setDirty(true); setNotice(null); }}
              placeholder="A small orange kitten on a rainy garden path, looking up at the reader…"
              className="field mt-1.5 min-h-28 font-normal"
            />
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={generate}
              disabled={Boolean(busy) || Boolean(row?.activeJob)}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--coral)] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#c95d4d] disabled:opacity-50"
            >
              {busy || row?.activeJob ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {row?.activeJob ? "Generating…" : imageUrl ? "Generate again" : "Generate this art"}
            </button>
            <span className="text-[11px] text-[var(--muted-ink)]">about {price} per image at {quality} quality</span>
            {suggestion.data?.sceneDirection && (
              <button
                type="button"
                onClick={() => { setDirection(suggestion.data!.sceneDirection); setDirty(true); }}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] px-3 py-1.5 text-[11px] font-semibold text-[var(--ink)] hover:border-[var(--coral)]"
              >
                <Wand2 size={12} />Suggest from my story
              </button>
            )}
          </div>
          {notice && (notice.kind === "error"
            ? <p className="mt-3 flex items-start gap-2 rounded-xl border border-[#e2b4a8] bg-[#fff0eb] p-3 text-xs leading-5 text-[#7f433a]" role="alert"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{notice.text}</p>
            : <p className="mt-3 text-xs leading-5 text-[#356b63]" role="status">{notice.text}</p>)}
          {busy && <p className="mt-2 inline-flex items-center gap-2 text-xs text-[var(--navy)]" role="status"><Loader2 size={13} className="animate-spin" />{busy}</p>}
        </div>

        <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[#fbfaf5]">
          {imageUrl && row?.latestAsset
            ? <img src={imageUrl} alt={`${copy.title} preview`} className="block h-full w-full object-cover" />
            : (
              <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 p-4 text-center">
                <ImageIcon size={20} className="text-[var(--muted-ink)]" />
                <p className="text-[11px] leading-4 text-[var(--muted-ink)]">
                  {row?.activeJob ? "Being drawn now…" : "No art yet. Describe it and press Generate."}
                </p>
              </div>
            )}
        </div>
      </div>
    </article>
  );
}

/**
 * Cover art generation. Before this the cover step could only place files the
 * author had uploaded themselves: "Generate whole book" produced interior
 * pages only, so a book could never have generated cover artwork at all.
 */
export default function CoverArtStudio({ projectId }: { projectId: string }) {
  return (
    <section className="space-y-5">
      <div>
        <p className="mono text-[10px] uppercase tracking-[0.22em] text-[var(--coral)]">Cover artwork</p>
        <h2 className="serif mt-1 text-2xl text-[var(--ink)]">Generate the cover, same as a page.</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted-ink)]">
          Cover art is drawn by the same model, from the same story bible and reference art as your interior pages, so it looks like the same book. Text is never drawn into it — the title and blurb are typeset at export.
        </p>
      </div>
      <CoverSurface projectId={projectId} pageRole="front_cover" />
      <CoverSurface projectId={projectId} pageRole="back_cover" />
    </section>
  );
}
