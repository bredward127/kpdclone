import { useEffect, useState } from "react";
import { Info, Plus, Save, Sparkles } from "lucide-react";
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
  const [pages, setPages] = useState<DraftPage[]>([]);
  const [pageCount, setPageCount] = useState("24");
  const [notice, setNotice] = useState("");
  const [storyDraft, setStoryDraft] = useState<StoryDraft | null>(null);

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
    setNotice("");
    try {
      await create.mutateAsync({ projectId, pageNumber, spreadNumber: Math.ceil(pageNumber / 2), sceneDirection: "", pageText: "" });
      await pagesQuery.refetch();
      setNotice(`Page ${pageNumber} added.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Page could not be added.");
    }
  };

  const createSet = async () => {
    const target = Math.min(200, Math.max(1, Number(pageCount) || 24));
    const existing = new Set(pages.map((page) => page.pageNumber));
    setNotice("");
    try {
      for (let pageNumber = 1; pageNumber <= target; pageNumber += 1) {
        if (!existing.has(pageNumber)) {
          await create.mutateAsync({ projectId, pageNumber, spreadNumber: Math.ceil(pageNumber / 2), sceneDirection: "", pageText: "" });
        }
      }
      await pagesQuery.refetch();
      setNotice(`${target} page slots are ready to plan.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The page set could not be created.");
    }
  };

  const savePage = async (page: DraftPage) => {
    setNotice("");
    try {
      await update.mutateAsync({ pagePlanId: page.id, sceneDirection: page.sceneDirection, pageText: page.pageText, spreadNumber: page.spreadNumber ?? undefined });
      setNotice(`Page ${page.pageNumber} saved.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Page could not be saved.");
    }
  };

  const requestAiDraft = async () => {
    setNotice("");
    try {
      const result = await draftWithAi.mutateAsync({ projectId, pageCount: Math.min(200, Math.max(1, Number(pageCount) || 24)) });
      setStoryDraft({ storySummary: result.storySummary, pages: result.pages });
      setNotice("AI draft ready for review. Nothing has been saved yet.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "AI-assisted planning is not configured.");
    }
  };

  const applyAiDraft = async () => {
    if (!storyDraft) return;
    setNotice("");
    try {
      if (briefQuery.data) {
        await saveBrief.mutateAsync({ projectId, briefText: storyDraft.storySummary, bookType: briefQuery.data.bookType, audience: briefQuery.data.audience, visualStyleAnchors: briefQuery.data.visualStyleAnchors, characterBible: briefQuery.data.characterBible, negativePrompt: briefQuery.data.negativePrompt });
      }
      const currentByNumber = new Map(pages.map((page) => [page.pageNumber, page]));
      for (const draftPage of storyDraft.pages) {
        const current = currentByNumber.get(draftPage.pageNumber);
        if (current) {
          await update.mutateAsync({ pagePlanId: current.id, sceneDirection: draftPage.sceneDirection, pageText: draftPage.pageText, spreadNumber: current.spreadNumber ?? undefined });
        } else {
          await create.mutateAsync({ projectId, pageNumber: draftPage.pageNumber, spreadNumber: Math.ceil(draftPage.pageNumber / 2), sceneDirection: draftPage.sceneDirection, pageText: draftPage.pageText });
        }
      }
      await Promise.all([pagesQuery.refetch(), briefQuery.refetch()]);
      setStoryDraft(null);
      setNotice("AI draft applied. Review and edit every page before composing prompts.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The AI draft could not be applied.");
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
          <label className="text-xs font-semibold text-[var(--ink)]">Number of pages<Help text="For a first test, use 24 pages. You can add individual pages later. Page numbers are kept in order for interior layout." /><input type="number" min="1" max="200" value={pageCount} onChange={(event) => setPageCount(event.target.value)} className="field mt-2 w-32" /></label>
          <button type="button" onClick={() => void createSet()} disabled={create.isPending} className="inline-flex items-center gap-2 rounded-full bg-[var(--navy)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Plus size={16} />{create.isPending ? "Creating pages…" : "Create page slots"}</button>
          <button type="button" onClick={() => void addPage()} disabled={create.isPending} className="inline-flex items-center gap-2 rounded-full border border-[var(--navy)] px-4 py-2.5 text-sm font-semibold text-[var(--navy)] disabled:opacity-50"><Plus size={16} />Add one page</button>
          <button type="button" onClick={() => void requestAiDraft()} disabled={draftWithAi.isPending} className="inline-flex items-center gap-2 rounded-full border border-[#9c6b45] px-4 py-2.5 text-sm font-semibold text-[#7d5538] disabled:opacity-50"><Sparkles size={16} />{draftWithAi.isPending ? "Drafting story…" : "Draft story with AI"}</button>
        </div>
        {storyDraft ? <div className="mt-5 rounded-2xl border border-[#d5c09a] bg-[#fff8e7] p-4"><p className="text-sm font-semibold text-[var(--ink)]">AI draft preview — review before applying</p><p className="mt-2 text-sm leading-6 text-[var(--ink)]">{storyDraft.storySummary}</p><p className="mt-2 text-xs text-[#7d5538]">{storyDraft.pages.length} page directions are ready. Applying the draft will create a new saved brief version and save page plans.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void applyAiDraft()} disabled={create.isPending || update.isPending || saveBrief.isPending} className="rounded-full bg-[var(--navy)] px-4 py-2 text-xs font-semibold text-white">Apply draft to page plan</button><button type="button" onClick={() => setStoryDraft(null)} className="rounded-full border border-[var(--navy)] px-4 py-2 text-xs font-semibold text-[var(--navy)]">Discard draft</button></div></div> : null}
      </div>
      {pages.length ? <div className="space-y-4">{pages.map((page) => <article key={page.id} className="rounded-[24px] border border-[var(--line)] bg-[var(--paper-strong)] p-5 shadow-[0_8px_26px_rgba(24,43,58,.05)]"><div className="flex flex-wrap items-center justify-between gap-3"><div><span className="mono text-[10px] uppercase tracking-[0.18em] text-[var(--coral)]">Page {String(page.pageNumber).padStart(2, "0")}</span><span className="ml-3 text-xs text-[var(--muted-ink)]">Spread {page.spreadNumber ?? "—"}</span></div><button type="button" onClick={() => void savePage(page)} disabled={update.isPending} className="inline-flex items-center gap-2 rounded-full border border-[var(--navy)] px-3 py-2 text-xs font-semibold text-[var(--navy)] disabled:opacity-50"><Save size={14} />Save page</button></div><div className="mt-4 grid gap-4 md:grid-cols-2"><label className="block text-sm font-semibold text-[var(--ink)]"><span className="inline-flex items-center">Scene direction<Help text="Describe the visible action, setting, character pose, camera angle, mood, and important continuity details. Keep it specific and visual." /></span><textarea value={page.sceneDirection} onChange={(event) => setField(page.id, "sceneDirection", event.target.value)} placeholder="Milo the orange kitten stands beneath a leafy plant, looking up at three raindrops…" className="field mt-2 min-h-32" /></label><label className="block text-sm font-semibold text-[var(--ink)]"><span className="inline-flex items-center">Page text<Help text="Enter the words that will appear on this page, or leave blank for a full-page illustration or coloring page." /></span><textarea value={page.pageText} onChange={(event) => setField(page.id, "pageText", event.target.value)} placeholder="Milo looked up. Could he find a dry place?" className="field mt-2 min-h-32" /></label></div></article>)}</div> : <div className="rounded-[24px] border border-dashed border-[#c7d0d0] bg-[#fbfaf4] p-12 text-center"><p className="serif text-2xl text-[var(--ink)]">No page slots yet.</p><p className="mt-2 text-sm text-[var(--muted-ink)]">Choose a page count above, then create the slots. Nothing is sent to FAL until you explicitly create a prompt and submit a page.</p></div>}
      {notice ? <p className="text-sm text-[#356b63]" role="status">{notice}</p> : null}
    </section>
  );
}
