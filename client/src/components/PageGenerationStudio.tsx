import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Archive, Check, ChevronDown, CircleDashed, Image as ImageIcon, LoaderCircle, RefreshCw, RotateCcw, Send, Square, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { getPageStudioDisplayStatus } from "@/lib/page-studio-status";

const statusCopy = {
  draft: { label: "Draft", tone: "bg-[#f3eee1] text-[#756d5a]" },
  queued: { label: "Queued", tone: "bg-[#eef3f6] text-[#4f6b7b]" },
  in_progress: { label: "Generating", tone: "bg-[#fff4dc] text-[#996d25]" },
  needs_review: { label: "Needs Review", tone: "bg-[#fff0eb] text-[#a54a3b]" },
  approved: { label: "Approved", tone: "bg-[#e9f2ed] text-[#517b68]" },
  failed: { label: "Failed", tone: "bg-[#fff0eb] text-[#a54a3b]" },
  cancelled: { label: "Cancelled", tone: "bg-[#f3eee1] text-[#756d5a]" },
  cancellation_requested: { label: "Stopping", tone: "bg-[#fff4dc] text-[#996d25]" },
  superseded: { label: "Superseded", tone: "bg-[#f0eef4] text-[#6d637d]" },
} as const;

type StudioStatus = keyof typeof statusCopy;

function StatusBadge({ status }: { status: string }) {
  const copy = statusCopy[status as StudioStatus] ?? statusCopy.draft;
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${copy.tone}`}><CircleDashed size={12} />{copy.label}</span>;
}

function idempotencyKey(prefix: string, pagePlanId: string) {
  return `${prefix}-${pagePlanId}-${crypto.randomUUID()}`;
}

export default function PageGenerationStudio({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const pages = trpc.studio.pages.list.useQuery({ projectId });
  const models = trpc.studio.generationJobs.models.useQuery();
  const [selectedPageId, setSelectedPageId] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [seed, setSeed] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [promptEdit, setPromptEdit] = useState("");
  const [feedback, setFeedback] = useState("");
  const [queueCount, setQueueCount] = useState<2 | 3>(2);
  const [queueConfirmOpen, setQueueConfirmOpen] = useState(false);

  useEffect(() => {
    if (!selectedPageId && pages.data?.[0]) setSelectedPageId(pages.data[0].id);
  }, [pages.data, selectedPageId]);

  const selectedPage = pages.data?.find((page) => page.id === selectedPageId) ?? null;
  const prompts = trpc.studio.prompts.list.useQuery({ projectId, pagePlanId: selectedPageId }, { enabled: Boolean(selectedPageId) });
  const selectedPrompt = prompts.data?.[0] ?? null;
  const approvedPrompt = prompts.data?.find((prompt) => prompt.status === "approved") ?? null;
  const generation = trpc.studio.generationJobs.list.useQuery({ projectId, pagePlanId: selectedPageId }, { enabled: Boolean(selectedPageId), refetchInterval: 5_000 });
  const activeModel = models.data?.find((model) => model.endpointId === selectedModelId) ?? models.data?.[0] ?? null;
  const latestAsset = generation.data?.assets?.[0] ?? null;
  const approvedAsset = generation.data?.assets?.find((asset) => asset.status === "approved") ?? null;
  const latestJob = generation.data?.jobs?.[0] ?? null;
  const activeJob = generation.data?.jobs?.find((job) => ["queued", "in_progress", "cancellation_requested"].includes(job.localStatus));
  const pendingPages = pages.data?.filter((page) => !generation.data || page.id !== selectedPageId || !activeJob) ?? [];

  const submit = trpc.studio.generationJobs.submit.useMutation({ onSuccess: async () => { setFeedback("Page submitted to the queue."); await generation.refetch(); } });
  const cancel = trpc.studio.generationJobs.cancel.useMutation({ onSuccess: async () => { setFeedback("Stop request sent for this page."); await generation.refetch(); } });
  const review = trpc.studio.generationJobs.reviewAsset.useMutation({ onSuccess: async () => { setFeedback("Asset review saved."); setRejectionReason(""); await generation.refetch(); } });
  const compose = trpc.studio.prompts.composeAndSave.useMutation();
  const freeze = trpc.studio.prompts.freeze.useMutation();
  const queueNext = trpc.studio.generationJobs.queueNext.useMutation({ onSuccess: async () => { setFeedback(`Generate next ${queueCount} submitted.`); setQueueConfirmOpen(false); await generation.refetch(); } });

  const submitPage = async (kind: "initial" | "variation" | "prompt_edit", sourceAssetId?: string, useEdit = false) => {
    if (!selectedPage || !activeModel || !approvedPrompt) {
      setFeedback("Choose an approved model and freeze a prompt version before generating.");
      return;
    }
    try {
      let promptVersionId = approvedPrompt.id;
      if (useEdit) {
        const edited = await compose.mutateAsync({ projectId, pagePlanId: selectedPage.id, generationModel: activeModel.displayName, generationEndpoint: activeModel.endpointId, aspectRatio, seed: seed ? Number(seed) : undefined, referenceAssetIds: approvedPrompt.referenceAssetIds, userEdits: { promptAddition: promptEdit } });
        const frozen = await freeze.mutateAsync({ projectId, promptVersionId: edited.id });
        promptVersionId = frozen.id;
      }
      await submit.mutateAsync({ projectId, pagePlanId: selectedPage.id, promptVersionId, generationModel: activeModel.displayName, generationEndpoint: activeModel.endpointId, aspectRatio, seed: seed ? Number(seed) : undefined, referenceAssetIds: approvedPrompt.referenceAssetIds, expectedOutputConstraints: { mimeTypes: ["image/png", "image/jpeg", "image/webp"], maxPixels: 25_000_000 }, idempotencyKey: idempotencyKey(kind, selectedPage.id), requestKind: kind, sourceAssetId });
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "The page generation request could not be submitted.");
    }
  };

  const queueNextPages = async () => {
    if (!activeModel || !approvedPrompt || !pages.data) return;
    const chosen = pages.data.filter((page) => page.id !== selectedPageId).slice(0, queueCount);
    if (chosen.length !== queueCount) { setFeedback(`There are not ${queueCount} additional page plans available.`); return; }
    const requests = await Promise.all(chosen.map(async (page) => {
      const promptList = await utils.studio.prompts.list.fetch({ projectId, pagePlanId: page.id });
      const prompt = promptList.find((version) => version.status === "approved");
      if (!prompt) throw new Error(`Page ${page.pageNumber} needs an approved prompt version first.`);
      return { pagePlanId: page.id, promptVersionId: prompt.id, generationModel: activeModel.displayName, generationEndpoint: activeModel.endpointId, aspectRatio, seed: seed ? Number(seed) : undefined, referenceAssetIds: prompt.referenceAssetIds, expectedOutputConstraints: { mimeTypes: ["image/png", "image/jpeg", "image/webp"], maxPixels: 25_000_000 }, idempotencyKey: idempotencyKey("queue", page.id) };
    }));
    queueNext.mutate({ projectId, count: queueCount, confirmed: true, requests });
  };

  const currentStatus = getPageStudioDisplayStatus(latestJob?.localStatus, latestAsset?.status);
  const printSize = latestAsset?.widthPx && latestAsset.heightPx ? `${latestAsset.widthPx} × ${latestAsset.heightPx}px · approx. ${(latestAsset.widthPx / 300).toFixed(2)} × ${(latestAsset.heightPx / 300).toFixed(2)}in at 300 DPI` : "Waiting for a completed asset";
  const modelReferenceIds = latestJob?.modelInputs?.reference_asset_ids;
  const referenceCount = Array.isArray(modelReferenceIds) ? modelReferenceIds.length : (approvedPrompt?.referenceAssetIds.length ?? 0);
  const canStop = Boolean(activeJob && ["queued", "in_progress", "cancellation_requested"].includes(activeJob.localStatus));

  if (pages.isLoading) return <LoadingState label="Loading page plans" />;
  if (pages.isError) return <ErrorState message="Page plans could not be loaded." />;
  if (!pages.data?.length) return <EmptyState title="No page plans yet." description="Create a page plan in Blueprint before opening the one-page generation desk." />;

  return <div className="space-y-7">
    <section className="rounded-[24px] border border-[var(--line)] bg-[var(--paper-strong)] p-5 md:p-7" aria-labelledby="page-studio-heading">
      <div className="flex flex-wrap items-start justify-between gap-5"><div><p className="mono text-[10px] uppercase tracking-[0.22em] text-[var(--coral)]">One page at a time</p><h2 id="page-studio-heading" className="serif mt-2 text-3xl text-[var(--ink)]">Make one page earn its place.</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted-ink)]">Inherited story decisions stay attached to each page. Review the scene, frozen prompt, model, and reference rights before sending one bounded request.</p></div><StatusBadge status={currentStatus} /></div>
      <div className="mt-6 grid gap-4 md:grid-cols-[minmax(0,1fr)_180px_160px_140px]">
        <label className="block"><span className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted-ink)]">Page plan</span><select aria-label="Select one page plan" value={selectedPageId} onChange={(event) => { setSelectedPageId(event.target.value); setFeedback(""); }} className="mt-2 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-3 text-sm text-[var(--ink)]">{pages.data.map((page) => <option key={page.id} value={page.id}>Page {page.pageNumber}{page.sceneDirection ? ` · ${page.sceneDirection.slice(0, 42)}` : ""}</option>)}</select></label>
        <label className="block"><span className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted-ink)]">Model configuration</span><select aria-label="Select approved model configuration" value={activeModel?.endpointId ?? ""} onChange={(event) => setSelectedModelId(event.target.value)} disabled={!models.data?.length} className="mt-2 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-3 text-sm text-[var(--ink)]"><option value="">{models.data?.length ? "Choose model" : "No approved model"}</option>{models.data?.map((model) => <option key={model.endpointId} value={model.endpointId}>{model.displayName}</option>)}</select></label>
        <label className="block"><span className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted-ink)]">Aspect ratio</span><select aria-label="Select aspect ratio" value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)} disabled={!activeModel} className="mt-2 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-3 text-sm text-[var(--ink)]">{(activeModel?.supportedAspectRatios ?? ["1:1"]).map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}</select></label>
        <label className="block"><span className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted-ink)]">Seed <span className="normal-case tracking-normal">(optional)</span></span><input aria-label="Optional seed" inputMode="numeric" value={seed} onChange={(event) => setSeed(event.target.value.replace(/[^0-9]/g, ""))} className="mt-2 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-3 text-sm text-[var(--ink)]" placeholder="Auto" /></label>
      </div>
      {!models.data?.length && <p className="mt-4 rounded-xl bg-[#fff8f5] p-4 text-sm text-[#7f433a]" role="alert"><AlertTriangle className="mr-2 inline" size={16} />An administrator must activate a documentation-reviewed model configuration before generation can be submitted.</p>}
      {feedback && <p className="mt-4 text-sm text-[var(--muted-ink)]" role="status" aria-live="polite">{feedback}</p>}
    </section>

    <section className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-7">
        <article className="rounded-[24px] border border-[var(--line)] bg-[var(--paper-strong)] p-5 md:p-7"><div className="flex items-center justify-between gap-4"><div><p className="mono text-[10px] uppercase tracking-[0.18em] text-[var(--coral)]">Inherited context</p><h3 className="serif mt-2 text-2xl text-[var(--ink)]">The story stays in the room.</h3></div><ImageIcon size={20} className="text-[var(--coral)]" /></div><div className="mt-5 grid gap-4 md:grid-cols-2"><div className="rounded-xl bg-[#fbfaf5] p-4"><p className="mono text-[9px] uppercase tracking-[0.16em] text-[var(--muted-ink)]">Scene direction</p><p className="mt-2 text-sm leading-6 text-[var(--ink)]">{selectedPage?.sceneDirection || "No scene direction recorded."}</p><p className="mt-4 mono text-[9px] uppercase tracking-[0.16em] text-[var(--muted-ink)]">Page text</p><p className="mt-2 text-sm leading-6 text-[var(--ink)]">{selectedPage?.pageText || "No page text recorded."}</p></div><div className="rounded-xl bg-[#fbfaf5] p-4"><p className="mono text-[9px] uppercase tracking-[0.16em] text-[var(--muted-ink)]">Frozen prompt version</p>{selectedPrompt ? <><div className="mt-2 flex items-center gap-2"><StatusBadge status={selectedPrompt.status} /><span className="text-xs text-[var(--muted-ink)]">v{selectedPrompt.version} · {selectedPrompt.contentHashSha256.slice(0, 12)}</span></div><pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap text-xs leading-5 text-[var(--ink)]">{selectedPrompt.prompt}</pre></> : <p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">Compose and freeze a prompt version in the prompt studio before submitting this page.</p>}</div></div></article>

        <article className="rounded-[24px] border border-[var(--line)] bg-[var(--paper-strong)] p-5 md:p-7" aria-live="polite"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="mono text-[10px] uppercase tracking-[0.18em] text-[var(--coral)]">Generation desk</p><h3 className="serif mt-2 text-2xl text-[var(--ink)]">Review the evidence, not just the image.</h3></div><div className="flex gap-2"><button type="button" className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-3 py-2 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--paper)]" onClick={() => generation.refetch()}><RefreshCw size={14} />Refresh</button>{canStop && <button type="button" className="inline-flex items-center gap-2 rounded-full border border-[#e16f5d] px-3 py-2 text-xs font-semibold text-[#a54a3b] hover:bg-[#fff8f5]" onClick={() => cancel.mutate({ jobId: activeJob!.id })} disabled={cancel.isPending}><Square size={14} />Stop queued work</button>}</div></div>{generation.isLoading ? <div className="mt-6"><LoadingState label="Loading this page’s generation history" /></div> : generation.isError ? <div className="mt-6"><ErrorState message="This page’s generation history could not be loaded." /></div> : <>{latestAsset ? <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_260px]"><div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[#fbfaf5]"><img src={latestAsset.accessUrl} alt={`Generated illustration for page ${selectedPage?.pageNumber ?? ""}`} className="max-h-[560px] w-full object-contain" /></div><div className="space-y-4"><div><p className="mono text-[9px] uppercase tracking-[0.16em] text-[var(--muted-ink)]">Print-size pixel calculation</p><p className="mt-2 text-sm leading-5 text-[var(--ink)]">{printSize}</p></div><div><p className="mono text-[9px] uppercase tracking-[0.16em] text-[var(--muted-ink)]">Prompt version</p><p className="mt-2 text-sm text-[var(--ink)]">{latestAsset.promptVersionId ?? "Not recorded"}</p></div><div><p className="mono text-[9px] uppercase tracking-[0.16em] text-[var(--muted-ink)]">Provenance</p><p className="mt-2 text-sm text-[var(--ink)]">{latestAsset.aiProvenanceClassification.replaceAll("_", " ")}</p></div><div className="flex flex-wrap gap-2">{latestAsset.status === "completed" || latestAsset.status === "needs_review" ? <button type="button" className="inline-flex items-center gap-2 rounded-full bg-[var(--navy)] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#2d465f]" onClick={() => review.mutate({ assetId: latestAsset.id, decision: "approved" })} disabled={review.isPending}><Check size={14} />Approve</button> : null}<button type="button" className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-4 py-2.5 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--paper)]" onClick={() => review.mutate({ assetId: latestAsset.id, decision: "archived" })} disabled={review.isPending}><Archive size={14} />Archive</button></div><label className="block"><span className="text-xs font-semibold text-[var(--ink)]">Reject with reason</span><textarea aria-label="Rejection reason" value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} className="mt-2 min-h-20 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] p-3 text-xs text-[var(--ink)]" placeholder="What needs to change?" />{latestAsset.status === "completed" || latestAsset.status === "needs_review" ? <button type="button" className="mt-2 inline-flex items-center gap-2 rounded-full border border-[#e16f5d] px-4 py-2 text-xs font-semibold text-[#a54a3b]" disabled={!rejectionReason.trim() || review.isPending} onClick={() => review.mutate({ assetId: latestAsset.id, decision: "rejected", rejectionReason })}><X size={14} />Reject</button> : null}</label></div></div> : <div className="mt-6 rounded-2xl bg-[#fbfaf5] p-6 text-sm text-[var(--muted-ink)]"><StatusBadge status={currentStatus} /><p className="mt-3">{latestJob?.errorMessage ?? "No generated asset yet. Submit this page when the approved prompt and model configuration are ready."}</p></div>}</>}</article>

        <article className="rounded-[24px] border border-[var(--line)] bg-[var(--paper-strong)] p-5 md:p-7"><div className="flex items-center gap-3"><RefreshCw size={18} className="text-[var(--coral)]" /><div><p className="mono text-[10px] uppercase tracking-[0.18em] text-[var(--coral)]">Regenerate without erasing history</p><h3 className="serif mt-2 text-2xl text-[var(--ink)]">Make the next variation explicit.</h3></div></div><div className="mt-5 grid gap-4 md:grid-cols-2"><button type="button" disabled={!approvedAsset || submit.isPending} onClick={() => submitPage("variation", approvedAsset?.id)} className="rounded-2xl border border-[var(--line)] bg-[#fbfaf5] p-4 text-left hover:border-[var(--coral)] disabled:cursor-not-allowed disabled:opacity-50"><span className="text-sm font-semibold text-[var(--ink)]">Regenerate variation</span><span className="mt-2 block text-xs leading-5 text-[var(--muted-ink)]">Requires an approved source asset. Creates a new asset and alternate lineage record.</span></button><div className="rounded-2xl border border-[var(--line)] bg-[#fbfaf5] p-4"><label className="block"><span className="text-sm font-semibold text-[var(--ink)]">Edit prompt and regenerate</span><textarea aria-label="Prompt edit before regeneration" value={promptEdit} onChange={(event) => setPromptEdit(event.target.value)} className="mt-3 min-h-20 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] p-3 text-xs text-[var(--ink)]" placeholder="Add a precise change; saved context remains inherited." /></label><button type="button" disabled={!promptEdit.trim() || !activeModel || !approvedPrompt || compose.isPending || submit.isPending} onClick={() => submitPage("prompt_edit", approvedAsset?.id, true)} className="mt-3 inline-flex items-center gap-2 rounded-full bg-[var(--navy)] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#2d465f] disabled:cursor-not-allowed disabled:opacity-50"><Send size={14} />Save version & regenerate</button></div></div></article>
      </div>

      <aside className="space-y-5"><div className="rounded-[24px] border border-[var(--line)] bg-[var(--paper-strong)] p-5"><p className="mono text-[10px] uppercase tracking-[0.18em] text-[var(--coral)]">Bounded queue</p><h3 className="serif mt-2 text-2xl text-[var(--ink)]">Only the next 2 or 3.</h3><p className="mt-3 text-xs leading-5 text-[var(--muted-ink)]">Pending pages are shown before submission. The server re-checks ownership, frozen prompts, idempotency, and concurrency limits.</p><div className="mt-4 flex gap-2"><button type="button" onClick={() => { setQueueCount(2); setQueueConfirmOpen(true); }} disabled={!activeModel || pages.data.length < 3} className="flex-1 rounded-xl border border-[var(--line)] px-3 py-2 text-xs font-semibold text-[var(--ink)] disabled:opacity-45">Generate next 2</button><button type="button" onClick={() => { setQueueCount(3); setQueueConfirmOpen(true); }} disabled={!activeModel || pages.data.length < 4} className="flex-1 rounded-xl border border-[var(--line)] px-3 py-2 text-xs font-semibold text-[var(--ink)] disabled:opacity-45">Generate next 3</button></div>{queueConfirmOpen && <div className="mt-4 rounded-2xl bg-[#fbfaf5] p-4" role="dialog" aria-labelledby="queue-confirm-heading"><h4 id="queue-confirm-heading" className="text-sm font-semibold text-[var(--ink)]">Confirm {queueCount} pending pages</h4><ul className="mt-3 space-y-2 text-xs text-[var(--muted-ink)]">{pendingPages.slice(0, queueCount).map((page) => <li key={page.id}>Page {page.pageNumber} · {page.sceneDirection || "No scene direction"}</li>)}</ul><div className="mt-4 flex gap-2"><button type="button" className="flex-1 rounded-full bg-[var(--navy)] px-3 py-2 text-xs font-semibold text-white" onClick={queueNextPages} disabled={queueNext.isPending}><Send size={13} className="mr-1 inline" />Confirm</button><button type="button" className="rounded-full border border-[var(--line)] px-3 py-2 text-xs font-semibold text-[var(--ink)]" onClick={() => setQueueConfirmOpen(false)}>Cancel</button></div></div>}</div><div className="rounded-[24px] border border-[var(--line)] bg-[#fbfaf5] p-5"><p className="mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted-ink)]">Review facts</p><dl className="mt-4 space-y-3 text-xs"><div className="flex justify-between gap-3"><dt className="text-[var(--muted-ink)]">Model</dt><dd className="text-right font-semibold text-[var(--ink)]">{latestJob?.generationModel ?? activeModel?.displayName ?? "Not selected"}</dd></div><div className="flex justify-between gap-3"><dt className="text-[var(--muted-ink)]">Seed</dt><dd className="text-right font-semibold text-[var(--ink)]">{latestJob?.seed ?? (seed || "Auto")}</dd></div><div className="flex justify-between gap-3"><dt className="text-[var(--muted-ink)]">References</dt><dd className="text-right font-semibold text-[var(--ink)]">{referenceCount}</dd></div><div className="flex justify-between gap-3"><dt className="text-[var(--muted-ink)]">Version lineage</dt><dd className="text-right font-semibold text-[var(--ink)]">{generation.data?.variants?.length ?? 0} variants</dd></div></dl></div></aside>
    </section>
  </div>;
}
