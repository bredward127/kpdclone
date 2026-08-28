import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Info, Loader2, Plus, Save, Sparkles, Trash2, Wand2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

type DraftPage = {
  id: string;
  pageNumber: number;
  spreadNumber: number | null;
  sceneDirection: string;
  pageText: string;
};

type StoryDraft = {
  storySummary: string;
  pages: Array<{ pageNumber: number; sceneDirection: string; pageText: string }>;
};

function Help({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex align-middle">
      <button type="button" aria-label={`Field information: ${text}`} title={text} className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-[#9aaab3] text-[#52636c] hover:bg-[#e6eef1]">
        <Info size={12} />
      </button>
      <span role="tooltip" className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 hidden w-64 rounded-xl bg-[#20384e] p-3 text-left text-xs font-normal leading-5 text-white shadow-xl group-hover:block group-focus-within:block">
        {text}
      </span>
    </span>
  );
}

export default function BlueprintPlanner({ projectId }: { projectId: string }) {
  const pagesQuery = trpc.studio.pages.list.useQuery({ projectId });
  const briefQuery = trpc.studio.brief.get.useQuery({ projectId });
  const create = trpc.studio.pages.create.useMutation();
  const update = trpc.studio.pages.update.useMutation();
  const draftWithAi = trpc.studio.brief.draftWithAi.useMutation();
  const saveBrief = trpc.studio.brief.save.useMutation();
  const removePage = trpc.studio.pages.delete.useMutation();
  const [pages, setPages] = useState<DraftPage[]>([]);
  const [pageCount, setPageCount] = useState("24");
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"info" | "error">("info");
  const [storyDraft, setStoryDraft] = useState<StoryDraft | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [applyProgress, setApplyProgress] = useState<{ done: number; total: number } | null>(null);
  // Which drafted pages the author has ticked, and which saved pages are selected
  // for a bulk action. Applying used to be all-or-nothing.
  const [draftSelection, setDraftSelection] = useState<number[]>([]);
  const [pageSelection, setPageSelection] = useState<string[]>([]);
  const draftInFlight = useRef(false);

  const report = (message: string, kind: "info" | "error" = "info") => { setNotice(message); setNoticeKind(kind); };

  // Drafting runs a real language model and takes roughly 20-30 seconds. Show a
  // live counter so the wait reads as progress rather than a frozen button.
  useEffect(() => {
    if (!draftWithAi.isPending) { setElapsedSeconds(0); return; }
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsedSeconds(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [draftWithAi.isPending]);

  useEffect(() => {
    if (pagesQuery.data) {
      setPages(pagesQuery.data.map((page) => ({
        id: page.id,
        pageNumber: page.pageNumber,
        spreadNumber: page.spreadNumber,
        sceneDirection: page.sceneDirection,
        pageText: page.pageText,
      })));
    }
  }, [pagesQuery.data]);

  const setField = (id: string, key: "sceneDirection" | "pageText", value: string) => {
    setPages((current) => current.map((page) => page.id === id ? { ...page, [key]: value } : page));
  };

  const addPage = async () => {
    const pageNumber = pages.length ? Math.max(...pages.map((page) => page.pageNumber)) + 1 : 1;
    report("");
    try {
      await create.mutateAsync({ projectId, pageNumber, spreadNumber: Math.ceil(pageNumber / 2), sceneDirection: "", pageText: "" });
      await pagesQuery.refetch();
      report(`Page ${pageNumber} added.`);
    } catch (error) {
      report(error instanceof Error ? error.message : "Page could not be added.", "error");
    }
  };

  const createSet = async () => {
    const target = Math.min(200, Math.max(1, Number(pageCount) || 24));
    const existing = new Set(pages.map((page) => page.pageNumber));
    report("");
    try {
      for (let pageNumber = 1; pageNumber <= target; pageNumber += 1) {
        if (!existing.has(pageNumber)) {
          await create.mutateAsync({ projectId, pageNumber, spreadNumber: Math.ceil(pageNumber / 2), sceneDirection: "", pageText: "" });
        }
      }
      await pagesQuery.refetch();
      report(`${target} page slots are ready to plan.`);
    } catch (error) {
      report(error instanceof Error ? error.message : "The page set could not be created.", "error");
    }
  };

  const savePage = async (page: DraftPage) => {
    report("");
    try {
      await update.mutateAsync({ pagePlanId: page.id, sceneDirection: page.sceneDirection, pageText: page.pageText, spreadNumber: page.spreadNumber ?? undefined });
      report(`Page ${page.pageNumber} saved.`);
    } catch (error) {
      report(error instanceof Error ? error.message : "Page could not be saved.", "error");
    }
  };

  const requestAiDraft = async () => {
    // Every submission runs a billable model call, so refuse to start a second
    // one while the first is still in flight.
    if (draftInFlight.current || draftWithAi.isPending) return;
    draftInFlight.current = true;
    report("");
    try {
      const result = await draftWithAi.mutateAsync({ projectId, pageCount: Math.min(200, Math.max(1, Number(pageCount) || 24)) });
      setStoryDraft({ storySummary: result.storySummary, pages: result.pages });
      setDraftSelection(result.pages.map((draftPage) => draftPage.pageNumber));
      report(`Draft ready: ${result.pages.length} page directions. Tick the ones you want, then apply. Nothing has been saved yet.`);
    } catch (error) {
      report(error instanceof Error ? error.message : "AI-assisted planning is not configured.", "error");
    } finally {
      draftInFlight.current = false;
    }
  };

  const deletePages = async (targets: DraftPage[]) => {
    if (!targets.length) return;
    report("");
    let done = 0;
    try {
      for (const page of targets) {
        await removePage.mutateAsync({ projectId, pagePlanId: page.id });
        done += 1;
      }
      await pagesQuery.refetch();
      setPageSelection([]);
      report(`${done} page${done === 1 ? "" : "s"} deleted. Prompt and image history for ${done === 1 ? "it" : "them"} is kept.`);
    } catch (error) {
      await pagesQuery.refetch();
      report(`Stopped after ${done} of ${targets.length}: ${error instanceof Error ? error.message : "a page could not be deleted."}`, "error");
    }
  };

  /**
   * Redraft one page only. Drafting the whole book again would discard every
   * other page the author has already reviewed and edited.
   */
  const redraftPage = async (page: DraftPage) => {
    if (draftInFlight.current || draftWithAi.isPending) return;
    draftInFlight.current = true;
    report("");
    try {
      const result = await draftWithAi.mutateAsync({ projectId, pageCount: pages.length || 24, pageNumbers: [page.pageNumber] });
      const only = result.pages.filter((entry) => entry.pageNumber === page.pageNumber);
      if (!only.length) { report(`The model returned nothing for page ${page.pageNumber}.`, "error"); return; }
      setStoryDraft({ storySummary: result.storySummary, pages: only });
      setDraftSelection(only.map((entry) => entry.pageNumber));
      report(`Page ${page.pageNumber} redrafted. Review it below, then apply. Only that page will change.`);
    } catch (error) {
      report(error instanceof Error ? error.message : "That page could not be redrafted.", "error");
    } finally {
      draftInFlight.current = false;
    }
  };

  const applyAiDraft = async () => {
    if (!storyDraft) return;
    report("");
    try {
      if (briefQuery.data) {
        await saveBrief.mutateAsync({ projectId, briefText: storyDraft.storySummary, bookType: briefQuery.data.bookType, audience: briefQuery.data.audience, visualStyleAnchors: briefQuery.data.visualStyleAnchors, characterBible: briefQuery.data.characterBible, negativePrompt: briefQuery.data.negativePrompt });
      }
      const currentByNumber = new Map(pages.map((page) => [page.pageNumber, page]));
      const chosen = storyDraft.pages.filter((draftPage) => draftSelection.includes(draftPage.pageNumber));
      if (!chosen.length) { report("Tick at least one drafted page to apply.", "error"); return; }
      const total = chosen.length;
      let done = 0;
      setApplyProgress({ done, total });
      for (const draftPage of chosen) {
        const current = currentByNumber.get(draftPage.pageNumber);
        if (current) {
          await update.mutateAsync({ pagePlanId: current.id, sceneDirection: draftPage.sceneDirection, pageText: draftPage.pageText, spreadNumber: current.spreadNumber ?? undefined });
        } else {
          await create.mutateAsync({ projectId, pageNumber: draftPage.pageNumber, spreadNumber: Math.ceil(draftPage.pageNumber / 2), sceneDirection: draftPage.sceneDirection, pageText: draftPage.pageText });
        }
        done += 1;
        setApplyProgress({ done, total });
      }
      await Promise.all([pagesQuery.refetch(), briefQuery.refetch()]);
      const remaining = storyDraft.pages.filter((draftPage) => !draftSelection.includes(draftPage.pageNumber));
      setStoryDraft(remaining.length ? { storySummary: storyDraft.storySummary, pages: remaining } : null);
      setDraftSelection(remaining.map((draftPage) => draftPage.pageNumber));
      setApplyProgress(null);
      report(`${total} page${total === 1 ? "" : "s"} filled in and saved.${remaining.length ? ` ${remaining.length} drafted page${remaining.length === 1 ? " is" : "s are"} still waiting.` : " Review and edit every page before composing prompts."}`);
    } catch (error) {
      setApplyProgress(null);
      report(error instanceof Error ? error.message : "The AI draft could not be applied.", "error");
    }
  };

  if (pagesQuery.isLoading) return <p className="rounded-2xl bg-[#fbfaf5] p-6 text-sm text-[var(--muted-ink)]">Loading your page plan…</p>;
  if (pagesQuery.isError) return <p className="rounded-2xl bg-[#fff0eb] p-6 text-sm text-[#7f433a]">Your page plan could not be loaded.</p>;

  return (
    <section className="space-y-6">
      <div className="rounded-[24px] border border-[var(--line)] bg-[var(--paper-strong)] p-5 shadow-[0_8px_30px_rgba(24,43,58,.06)] md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mono text-[10px] uppercase tracking-[0.22em] text-[var(--coral)]">Page planner</p>
            <h2 className="serif mt-2 text-3xl text-[var(--ink)]">Plan the book before making pictures.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted-ink)]">Create one row per page. Scene direction tells the image model what to show; page text is the words that belong on the finished page. Your saved brief and character bible will be inherited later when you compose a prompt.</p>
          </div>
          <span className="rounded-full bg-[#e9f2ed] px-3 py-1.5 text-xs font-semibold text-[#356b63]">{pages.length} planned pages</span>
        </div>
        <div className="mt-6 flex flex-wrap items-end gap-3 rounded-2xl bg-[#f2efe4] p-4">
          <label className="block text-sm font-semibold text-[var(--ink)]"><span className="inline-flex items-center">Number of pages<Help text="For a first test, use 24 pages. You can add individual pages later. Page numbers are kept in order for interior layout." /></span><input type="number" min="1" max="200" value={pageCount} onChange={(event) => setPageCount(event.target.value)} className="field mt-2 w-32" /></label>
          <button type="button" onClick={() => void createSet()} disabled={create.isPending} className="inline-flex items-center gap-2 rounded-full bg-[var(--navy)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Plus size={16} />{create.isPending ? "Creating pages…" : "Create page slots"}</button>
          <button type="button" onClick={() => void addPage()} disabled={create.isPending} className="inline-flex items-center gap-2 rounded-full border border-[var(--navy)] px-4 py-2.5 text-sm font-semibold text-[var(--navy)] disabled:opacity-50"><Plus size={16} />Add one page</button>
          <button type="button" onClick={() => void requestAiDraft()} disabled={draftWithAi.isPending} className="inline-flex items-center gap-2 rounded-full border border-[#9c6b45] px-4 py-2.5 text-sm font-semibold text-[#7d5538] disabled:opacity-50">{draftWithAi.isPending ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}{draftWithAi.isPending ? `Drafting story… ${elapsedSeconds}s` : "Draft story with AI"}</button>
        </div>
        {draftWithAi.isPending ? (
          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-[#c9d7e0] bg-[#eef5f9] p-4" role="status" aria-live="polite">
            <Loader2 size={18} className="mt-0.5 shrink-0 animate-spin text-[var(--navy)]" />
            <div>
              <p className="text-sm font-semibold text-[var(--ink)]">Writing your story — this usually takes 20–30 seconds.</p>
              <p className="mt-1 text-xs leading-5 text-[var(--muted-ink)]">One model call plans all {Math.min(200, Math.max(1, Number(pageCount) || 24))} pages together, so they share one storyline. Elapsed {elapsedSeconds}s. Leave this page open; nothing is saved until you apply the draft.</p>
            </div>
          </div>
        ) : null}
        {storyDraft ? (
          <div className="mt-5 rounded-2xl border border-[#d5c09a] bg-[#fff8e7] p-4">
            <p className="text-sm font-semibold text-[var(--ink)]">AI draft preview — review before applying</p>
            <p className="mt-2 text-sm leading-6 text-[var(--ink)]">{storyDraft.storySummary}</p>
            <p className="mt-2 text-xs text-[#7d5538]">{storyDraft.pages.length} page directions are ready. Applying the draft will create a new saved brief version and fill in every page below.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <label className="inline-flex items-center gap-2 font-semibold text-[var(--ink)]">
                <input type="checkbox" checked={draftSelection.length === storyDraft.pages.length} onChange={() => setDraftSelection(draftSelection.length === storyDraft.pages.length ? [] : storyDraft.pages.map((entry) => entry.pageNumber))} className="h-4 w-4 accent-[#203348]" />
                Select all ({draftSelection.length} of {storyDraft.pages.length})
              </label>
            </div>
            <ol className="mt-2 max-h-72 space-y-1 overflow-y-auto rounded-xl border border-[#e6d6b4] bg-[#fffdf6] p-2">
              {storyDraft.pages.map((draftPage) => (
                <li key={draftPage.pageNumber} className="flex items-start gap-2 rounded-lg p-1.5 text-xs leading-5 text-[var(--ink)] hover:bg-[#fdf7e8]">
                  <input type="checkbox" aria-label={`Include drafted page ${draftPage.pageNumber}`} checked={draftSelection.includes(draftPage.pageNumber)} onChange={() => setDraftSelection((current) => current.includes(draftPage.pageNumber) ? current.filter((entry) => entry !== draftPage.pageNumber) : [...current, draftPage.pageNumber])} className="mt-1 h-4 w-4 shrink-0 accent-[#203348]" />
                  <span className="mono mt-0.5 shrink-0 text-[10px] uppercase tracking-[0.14em] text-[var(--coral)]">P{String(draftPage.pageNumber).padStart(2, "0")}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{draftPage.pageText || "(no page text)"}</span>
                    <span className="block text-[var(--muted-ink)]">{draftPage.sceneDirection}</span>
                  </span>
                  <button type="button" aria-label={`Discard drafted page ${draftPage.pageNumber}`} title="Drop this page from the draft" disabled={Boolean(applyProgress)} onClick={() => { setStoryDraft((current) => current && current.pages.length > 1 ? { ...current, pages: current.pages.filter((entry) => entry.pageNumber !== draftPage.pageNumber) } : null); setDraftSelection((current) => current.filter((entry) => entry !== draftPage.pageNumber)); }} className="shrink-0 rounded-full p-1 text-[#a8503f] hover:bg-[#fff0eb] disabled:opacity-40"><Trash2 size={13} /></button>
                </li>
              ))}
            </ol>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void applyAiDraft()} disabled={!draftSelection.length || create.isPending || update.isPending || saveBrief.isPending} className="inline-flex items-center gap-2 rounded-full bg-[var(--navy)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{applyProgress ? <Loader2 size={14} className="animate-spin" /> : null}{applyProgress ? `Filling in page ${applyProgress.done} of ${applyProgress.total}…` : `Apply ${draftSelection.length} selected page${draftSelection.length === 1 ? "" : "s"}`}</button>
              <button type="button" onClick={() => { setStoryDraft(null); setApplyProgress(null); }} disabled={Boolean(applyProgress)} className="rounded-full border border-[var(--navy)] px-4 py-2 text-xs font-semibold text-[var(--navy)] disabled:opacity-50">Discard draft</button>
            </div>
          </div>
        ) : null}
      </div>
      {pages.length ? <div className="space-y-4"><div className="flex flex-wrap items-center gap-2 rounded-2xl bg-[#f2efe4] p-3 text-xs"><label className="inline-flex items-center gap-2 font-semibold text-[var(--ink)]"><input type="checkbox" checked={pages.length > 0 && pageSelection.length === pages.length} onChange={() => setPageSelection(pageSelection.length === pages.length ? [] : pages.map((page) => page.id))} className="h-4 w-4 accent-[#203348]" />Select all ({pageSelection.length} selected)</label><span className="mx-1 h-5 w-px bg-[#ddd6c6]" /><button type="button" disabled={!pageSelection.length || removePage.isPending} onClick={() => void deletePages(pages.filter((page) => pageSelection.includes(page.id)))} className="inline-flex items-center gap-2 rounded-full border border-[#e2b4a8] px-4 py-2 font-semibold text-[#a8503f] hover:bg-[#fff0eb] disabled:opacity-45"><Trash2 size={14} />Delete selected</button><button type="button" disabled={!pageSelection.length || update.isPending} onClick={() => void (async () => { const targets = pages.filter((page) => pageSelection.includes(page.id)); report(""); let done = 0; try { for (const page of targets) { await update.mutateAsync({ pagePlanId: page.id, sceneDirection: page.sceneDirection, pageText: page.pageText, spreadNumber: page.spreadNumber ?? undefined }); done += 1; } report(`${done} page${done === 1 ? "" : "s"} saved.`); } catch (error) { report(`Stopped after ${done} of ${targets.length}: ${error instanceof Error ? error.message : "a page could not be saved."}`, "error"); } })()} className="inline-flex items-center gap-2 rounded-full border border-[var(--navy)] px-4 py-2 font-semibold text-[var(--navy)] disabled:opacity-45"><Save size={14} />Save selected</button></div>{pages.map((page) => <article key={page.id} className="rounded-[24px] border border-[var(--line)] bg-[var(--paper-strong)] p-5 shadow-[0_8px_26px_rgba(24,43,58,.05)]"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><input type="checkbox" aria-label={`Select page ${page.pageNumber}`} checked={pageSelection.includes(page.id)} onChange={() => setPageSelection((current) => current.includes(page.id) ? current.filter((entry) => entry !== page.id) : [...current, page.id])} className="h-4 w-4 accent-[#203348]" /><div><span className="mono text-[10px] uppercase tracking-[0.18em] text-[var(--coral)]">Page {String(page.pageNumber).padStart(2, "0")}</span><span className="ml-3 text-xs text-[var(--muted-ink)]">Spread {page.spreadNumber ?? "—"}</span></div></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void redraftPage(page)} disabled={draftWithAi.isPending} title="Rewrite only this page with AI. Every other page is left alone." className="inline-flex items-center gap-2 rounded-full border border-[#9c6b45] px-3 py-2 text-xs font-semibold text-[#7d5538] disabled:opacity-50"><Wand2 size={14} />Redraft this page</button><button type="button" onClick={() => void savePage(page)} disabled={update.isPending} className="inline-flex items-center gap-2 rounded-full border border-[var(--navy)] px-3 py-2 text-xs font-semibold text-[var(--navy)] disabled:opacity-50"><Save size={14} />Save page</button><button type="button" onClick={() => void deletePages([page])} disabled={removePage.isPending} aria-label={`Delete page ${page.pageNumber}`} title="Delete this page" className="inline-flex items-center gap-2 rounded-full border border-[#e2b4a8] px-3 py-2 text-xs font-semibold text-[#a8503f] hover:bg-[#fff0eb] disabled:opacity-50"><Trash2 size={14} /></button></div></div><div className="mt-4 grid gap-4 md:grid-cols-2"><label className="block text-sm font-semibold text-[var(--ink)]"><span className="inline-flex items-center">Scene direction<Help text="Describe the visible action, setting, character pose, camera angle, mood, and important continuity details. Keep it specific and visual." /></span><textarea value={page.sceneDirection} onChange={(event) => setField(page.id, "sceneDirection", event.target.value)} placeholder="Milo the orange kitten stands beneath a leafy plant, looking up at three raindrops…" className="field mt-2 min-h-32" /></label><label className="block text-sm font-semibold text-[var(--ink)]"><span className="inline-flex items-center">Page text<Help text="Enter the words that will appear on this page, or leave blank for a full-page illustration or coloring page." /></span><textarea value={page.pageText} onChange={(event) => setField(page.id, "pageText", event.target.value)} placeholder="Milo looked up. Could he find a dry place?" className="field mt-2 min-h-32" /></label></div></article>)}</div> : <div className="rounded-[24px] border border-dashed border-[#c7d0d0] bg-[#fbfaf4] p-12 text-center"><p className="serif text-2xl text-[var(--ink)]">No page slots yet.</p><p className="mt-2 text-sm text-[var(--muted-ink)]">Choose a page count above, then create the slots. Nothing is sent to FAL until you explicitly create a prompt and submit a page.</p></div>}
      {notice ? (
        noticeKind === "error" ? (
          <div className="flex items-start gap-3 rounded-2xl border border-[#e2b4a8] bg-[#fff0eb] p-4" role="alert">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[#a8503f]" />
            <div>
              <p className="text-sm font-semibold text-[#7f433a]">That did not work</p>
              <p className="mt-1 text-sm leading-6 whitespace-pre-wrap text-[#7f433a]">{notice}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-[#356b63]" role="status">{notice}</p>
        )
      ) : null}
    </section>
  );
}
