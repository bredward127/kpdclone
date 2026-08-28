import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, ImageIcon, Loader2, Lock, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { ErrorState, LoadingState } from "./States";

/**
 * The page studio's entry point: every page in one list, with the two things
 * that decide whether it can be generated (a frozen prompt, an active model)
 * shown per row. Generation previously started from a composer buried below the
 * fold, which gave no way to see which pages were ready or to act on several.
 */
export default function PageBatchBoard({ projectId, onOpenPage }: { projectId: string; onOpenPage: (pagePlanId: string) => void }) {
  const utils = trpc.useUtils();
  const board = trpc.studio.pages.board.useQuery({ projectId }, { refetchInterval: 8_000 });
  const models = trpc.studio.generationJobs.models.useQuery();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; kind: "info" | "error" } | null>(null);

  const freeze = trpc.studio.prompts.freeze.useMutation();
  const submit = trpc.studio.generationJobs.submit.useMutation();

  const rows = board.data ?? [];
  const activeModel = models.data?.[0] ?? null;
  const readyToGenerate = useMemo(() => rows.filter((row) => row.approvedPromptVersion && !row.activeJob), [rows]);
  const freezable = useMemo(() => rows.filter((row) => row.latestPromptVersion && !row.approvedPromptVersion && !row.latestPromptVersion.blockingLintCount), [rows]);
  const selectedRows = useMemo(() => rows.filter((row) => selected.includes(row.pagePlanId)), [rows, selected]);

  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
  const allSelected = rows.length > 0 && selected.length === rows.length;

  const refresh = async () => { await Promise.all([utils.studio.pages.board.invalidate({ projectId }), board.refetch()]); };

  const freezePages = async (targets: typeof rows) => {
    const eligible = targets.filter((row) => row.latestPromptVersion && !row.approvedPromptVersion);
    if (!eligible.length) { setNotice({ text: "Nothing to freeze: those pages have no draft prompt version, or are already frozen.", kind: "error" }); return; }
    setNotice(null);
    let done = 0;
    try {
      for (const row of eligible) {
        setBusy(`Freezing page ${row.pageNumber} (${done + 1} of ${eligible.length})…`);
        await freeze.mutateAsync({ projectId, promptVersionId: row.latestPromptVersion!.id });
        done += 1;
      }
      await refresh();
      setNotice({ text: `${done} page${done === 1 ? "" : "s"} frozen and ready to generate.`, kind: "info" });
    } catch (error) {
      await refresh();
      setNotice({ text: `Stopped after ${done} of ${eligible.length}: ${error instanceof Error ? error.message : "a page could not be frozen."}`, kind: "error" });
    } finally { setBusy(null); }
  };

  const generatePages = async (targets: typeof rows) => {
    if (!activeModel) { setNotice({ text: "An administrator must activate a reviewed model configuration before any image can be generated.", kind: "error" }); return; }
    const eligible = targets.filter((row) => row.approvedPromptVersion && !row.activeJob);
    if (!eligible.length) { setNotice({ text: "Nothing to generate: those pages need a frozen prompt first, or already have work in flight.", kind: "error" }); return; }
    setNotice(null);
    let done = 0;
    try {
      for (const row of eligible) {
        setBusy(`Submitting page ${row.pageNumber} (${done + 1} of ${eligible.length})…`);
        const frozen = row.approvedPromptVersion!;
        await submit.mutateAsync({
          projectId,
          pagePlanId: row.pagePlanId,
          promptVersionId: frozen.id,
          // These four must equal the frozen version's own values; the server
          // rejects a submission whose parameters differ from the prompt it
          // claims to run.
          generationModel: frozen.generationModel,
          generationEndpoint: frozen.generationEndpoint,
          aspectRatio: frozen.aspectRatio,
          seed: frozen.seed ?? undefined,
          referenceAssetIds: frozen.referenceAssetIds,
          expectedOutputConstraints: { mimeTypes: ["image/png", "image/jpeg", "image/webp"], maxPixels: 25_000_000 },
          idempotencyKey: `board-${row.pagePlanId}-${frozen.id}`,
          requestKind: "initial",
        });
        done += 1;
      }
      await refresh();
      setNotice({ text: `${done} page${done === 1 ? "" : "s"} submitted. Each one is a billable image; watch status below.`, kind: "info" });
    } catch (error) {
      await refresh();
      setNotice({ text: `Stopped after ${done} of ${eligible.length}: ${error instanceof Error ? error.message : "a page could not be submitted."}`, kind: "error" });
    } finally { setBusy(null); }
  };

  if (board.isLoading) return <LoadingState label="Loading every page and its prompt state" />;
  if (board.isError) return <ErrorState message="The page board could not be loaded." />;
  if (!rows.length) return <div className="rounded-[24px] border border-dashed border-[#c7d0d0] bg-[#fbfaf4] p-12 text-center"><p className="serif text-2xl text-[var(--ink)]">No pages yet.</p><p className="mt-2 text-sm text-[var(--muted-ink)]">Create page slots in the blueprint first. Nothing is sent to FAL until you press Generate here.</p></div>;

  return (
    <section className="rounded-[24px] border border-[var(--line)] bg-[var(--paper-strong)] p-5 shadow-[0_8px_30px_rgba(24,43,58,.06)] md:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mono text-[10px] uppercase tracking-[0.22em] text-[var(--coral)]">Page board</p>
          <h2 className="serif mt-2 text-3xl text-[var(--ink)]">Every page, and what it still needs.</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted-ink)]">A page can only be generated from a <strong>frozen</strong> prompt. Compose a prompt for a page, freeze it, then generate — one page or many. Each generated image is billable.</p>
        </div>
        <div className="rounded-2xl border border-[var(--line)] bg-[#fbfaf5] px-4 py-3 text-right">
          <p className="mono text-[9px] uppercase tracking-[0.16em] text-[var(--muted-ink)]">Ready to generate</p>
          <p className="serif text-2xl text-[var(--ink)]">{readyToGenerate.length}<span className="text-sm text-[var(--muted-ink)]"> / {rows.length}</span></p>
        </div>
      </div>

      {!activeModel && <p className="mt-4 flex items-start gap-2 rounded-xl border border-[#e2b4a8] bg-[#fff0eb] p-4 text-sm text-[#7f433a]" role="alert"><AlertTriangle size={16} className="mt-0.5 shrink-0" />No reviewed model configuration is active, so nothing can be generated yet. An administrator must activate one.</p>}

      <div className="mt-5 flex flex-wrap items-center gap-2 rounded-2xl bg-[#f2efe4] p-3">
        <label className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--ink)]">
          <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? [] : rows.map((row) => row.pagePlanId))} className="h-4 w-4 accent-[#203348]" />
          Select all ({selected.length} selected)
        </label>
        <span className="mx-1 h-5 w-px bg-[#ddd6c6]" />
        <button type="button" disabled={Boolean(busy) || !selectedRows.length} onClick={() => void freezePages(selectedRows)} className="inline-flex items-center gap-2 rounded-full border border-[var(--navy)] px-4 py-2 text-xs font-semibold text-[var(--navy)] disabled:opacity-45"><Lock size={14} />Freeze selected</button>
        <button type="button" disabled={Boolean(busy) || !selectedRows.length} onClick={() => void generatePages(selectedRows)} className="inline-flex items-center gap-2 rounded-full bg-[var(--navy)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-45"><Sparkles size={14} />Generate selected</button>
        <span className="mx-1 h-5 w-px bg-[#ddd6c6]" />
        <button type="button" disabled={Boolean(busy) || !freezable.length} onClick={() => void freezePages(freezable)} className="rounded-full border border-[var(--line)] px-4 py-2 text-xs font-semibold text-[var(--ink)] disabled:opacity-45">Freeze all drafts ({freezable.length})</button>
        <button type="button" disabled={Boolean(busy) || !readyToGenerate.length} onClick={() => void generatePages(readyToGenerate)} className="rounded-full border border-[var(--line)] px-4 py-2 text-xs font-semibold text-[var(--ink)] disabled:opacity-45">Generate all ready ({readyToGenerate.length})</button>
      </div>

      {busy && <p className="mt-3 inline-flex items-center gap-2 text-sm text-[var(--navy)]" role="status"><Loader2 size={15} className="animate-spin" />{busy}</p>}
      {notice && (notice.kind === "error"
        ? <p className="mt-3 flex items-start gap-2 rounded-xl border border-[#e2b4a8] bg-[#fff0eb] p-3 text-sm text-[#7f433a]" role="alert"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{notice.text}</p>
        : <p className="mt-3 text-sm text-[#356b63]" role="status">{notice.text}</p>)}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[var(--line)] text-[10px] uppercase tracking-[0.14em] text-[var(--muted-ink)]">
              <th className="w-10 py-2"><span className="sr-only">Select</span></th>
              <th className="py-2 font-semibold">Page</th>
              <th className="py-2 font-semibold">Scene</th>
              <th className="py-2 font-semibold">Prompt</th>
              <th className="py-2 font-semibold">Image</th>
              <th className="py-2 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.pagePlanId} className="border-b border-[#efeade] align-top">
                <td className="py-3"><input type="checkbox" aria-label={`Select page ${row.pageNumber}`} checked={selected.includes(row.pagePlanId)} onChange={() => toggle(row.pagePlanId)} className="h-4 w-4 accent-[#203348]" /></td>
                <td className="py-3 pr-3"><span className="mono text-xs font-semibold text-[var(--ink)]">{String(row.pageNumber).padStart(2, "0")}</span></td>
                <td className="max-w-[280px] py-3 pr-3"><p className="truncate text-xs text-[var(--ink)]">{row.sceneDirection || <span className="text-[var(--muted-ink)]">No scene direction</span>}</p></td>
                <td className="py-3 pr-3">
                  {row.approvedPromptVersion
                    ? <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e9f2ed] px-2.5 py-1 text-[11px] font-semibold text-[#356b63]"><Lock size={11} />Frozen v{row.approvedPromptVersion.version}</span>
                    : row.latestPromptVersion
                      ? <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fff4e0] px-2.5 py-1 text-[11px] font-semibold text-[#8a6524]"><CircleDashed size={11} />Draft v{row.latestPromptVersion.version}</span>
                      : <span className="text-[11px] text-[var(--muted-ink)]">No prompt yet</span>}
                  {row.latestPromptVersion?.blockingLintCount ? <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-[#fff0eb] px-2 py-1 text-[11px] font-semibold text-[#a8503f]"><AlertTriangle size={11} />Blocked</span> : null}
                </td>
                <td className="py-3 pr-3">
                  {row.activeJob
                    ? <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--navy)]"><Loader2 size={11} className="animate-spin" />In flight</span>
                    : row.latestAsset
                      ? <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--ink)]">{row.latestAsset.status === "approved" ? <CheckCircle2 size={11} className="text-[#356b63]" /> : <ImageIcon size={11} />}{row.latestAsset.status.replaceAll("_", " ")}</span>
                      : <span className="text-[11px] text-[var(--muted-ink)]">None</span>}
                </td>
                <td className="py-3">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <button type="button" onClick={() => onOpenPage(row.pagePlanId)} className="rounded-full border border-[var(--line)] px-3 py-1.5 text-[11px] font-semibold text-[var(--ink)] hover:bg-[var(--paper)]">Open</button>
                    {row.latestPromptVersion && !row.approvedPromptVersion
                      ? <button type="button" disabled={Boolean(busy)} onClick={() => void freezePages([row])} className="rounded-full border border-[var(--navy)] px-3 py-1.5 text-[11px] font-semibold text-[var(--navy)] disabled:opacity-45">Freeze</button>
                      : null}
                    <button type="button" disabled={Boolean(busy) || !row.approvedPromptVersion || row.activeJob} title={!row.approvedPromptVersion ? "Freeze a prompt version for this page first." : row.activeJob ? "This page already has work in flight." : "Generate this page's image."} onClick={() => void generatePages([row])} className="rounded-full bg-[var(--navy)] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-45">Generate</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
