import { useMemo, useState } from "react";
import { AlertTriangle, Check, GitCompareArrows, Lock, RotateCcw, WandSparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { EmptyState, ErrorState, LoadingState } from "./States";

export default function PromptStudio({ projectId, focusPagePlanId = "" }: { projectId: string; focusPagePlanId?: string }) {
  const utils = trpc.useUtils();
  const pages = trpc.studio.pages.list.useQuery({ projectId });
  const models = trpc.studio.generationJobs.models.useQuery();
  const references = trpc.references.list.useQuery({ projectId });
  const [pagePlanId, setPagePlanId] = useState("");
  // Chosen from the active, administrator-approved list rather than typed. A
  // prompt frozen against an endpoint that is not active can be composed but
  // never submitted, which surfaced far later as a model-approval refusal.
  const [generationEndpoint, setGenerationEndpoint] = useState("");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [seed, setSeed] = useState("");
  const [selectedReferenceIds, setSelectedReferenceIds] = useState<string[]>([]);
  const [promptAddition, setPromptAddition] = useState("");
  const [negativePromptAddition, setNegativePromptAddition] = useState("");
  const [compositionNotes, setCompositionNotes] = useState("");
  const [leftVersionId, setLeftVersionId] = useState("");
  const [rightVersionId, setRightVersionId] = useState("");
  const [feedback, setFeedback] = useState("");

  const activePagePlanId = pagePlanId || focusPagePlanId || pages.data?.[0]?.id || "";
  const versions = trpc.studio.prompts.list.useQuery({ projectId, pagePlanId: activePagePlanId }, { enabled: Boolean(activePagePlanId) });
  const compose = trpc.studio.prompts.composeAndSave.useMutation({
    onSuccess: async (version) => {
      await utils.studio.prompts.list.invalidate({ projectId, pagePlanId: activePagePlanId });
      setFeedback(`Saved immutable prompt version ${version.version}.`);
      setLeftVersionId(version.id);
      setRightVersionId("");
    },
    onError: (error) => setFeedback(error.message),
  });
  const freeze = trpc.studio.prompts.freeze.useMutation({
    onSuccess: async (version) => {
      await utils.studio.prompts.list.invalidate({ projectId, pagePlanId: activePagePlanId });
      setFeedback(`Version ${version.version} is frozen and approved. This page can now be generated in the page studio.`);
    },
    onError: (error) => setFeedback(error.message),
  });
  const restore = trpc.studio.prompts.restore.useMutation({
    onSuccess: async (version) => {
      await utils.studio.prompts.list.invalidate({ projectId, pagePlanId: version.pagePlanId ?? activePagePlanId });
      setFeedback(`Restored version ${version.version} as a new immutable version.`);
      setRightVersionId(version.id);
    },
    onError: (error) => setFeedback(error.message),
  });

  const leftVersion = useMemo(() => versions.data?.find((version) => version.id === leftVersionId) ?? versions.data?.[0], [versions.data, leftVersionId]);
  const rightVersion = useMemo(() => versions.data?.find((version) => version.id === rightVersionId) ?? versions.data?.[1], [versions.data, rightVersionId]);
  const currentPage = pages.data?.find((page) => page.id === activePagePlanId);
  const activeModels = models.data ?? [];
  const selectedModel = activeModels.find((model) => model.endpointId === generationEndpoint) ?? activeModels[0] ?? null;
  const supportedRatios = selectedModel?.supportedAspectRatios ?? ["1:1", "3:2", "2:3"];
  const latestVersion = versions.data?.[0] ?? null;
  const approvedVersion = versions.data?.find((version) => version.status === "approved") ?? null;
  const referenceData = references.data ?? [];

  function toggleReference(id: string) {
    setSelectedReferenceIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function submit() {
    if (!activePagePlanId) return;
    if (!selectedModel) { setFeedback("No reviewed model configuration is active, so a prompt cannot be composed against one. An administrator must activate one."); return; }
    compose.mutate({
      projectId,
      pagePlanId: activePagePlanId,
      generationModel: selectedModel.displayName,
      generationEndpoint: selectedModel.endpointId,
      aspectRatio: supportedRatios.includes(aspectRatio as (typeof supportedRatios)[number]) ? aspectRatio : supportedRatios[0],
      seed: seed ? Number(seed) : undefined,
      referenceAssetIds: selectedReferenceIds,
      userEdits: { promptAddition, negativePromptAddition, compositionNotes },
    });
  }

  if (pages.isLoading || references.isLoading) return <LoadingState label="Loading saved story context" />;
  if (pages.isError || references.isError) return <ErrorState message="Saved pages or private references could not be loaded." />;
  if (!pages.data?.length) return <EmptyState title="Plan a page before composing." description="Prompt versions are tied to an individual page plan so every decision stays continuous and reviewable." />;

  return (
    <div className="mt-8 space-y-6">
      <div className="rounded-[24px] border border-[var(--line)] bg-[var(--paper-strong)] p-5 shadow-[0_12px_38px_rgba(32,51,72,.05)] md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="mono text-[10px] uppercase tracking-[0.22em] text-[var(--coral)]">Prompt composer</p><h2 className="serif mt-2 text-3xl text-[var(--ink)]">Carry the story forward.</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted-ink)]">The brief, character bible, visual rules, page plan, and approved references are composed automatically. You only add the small page-specific direction that is new.</p></div><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#fff0ed] text-[var(--coral)]"><WandSparkles size={20} /></div></div>
        <div className="mt-6 grid gap-4 md:grid-cols-3"><label className="block"><span className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted-ink)]">Page plan</span><select value={activePagePlanId} onChange={(event) => { setPagePlanId(event.target.value); setLeftVersionId(""); setRightVersionId(""); }} className="mt-2 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-3 text-sm text-[var(--ink)]">{pages.data.map((page) => <option key={page.id} value={page.id}>Page {page.pageNumber} — {page.sceneDirection || "Untitled scene"}</option>)}</select></label><label className="block"><span className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted-ink)]">Model</span><select value={selectedModel?.endpointId ?? ""} onChange={(event) => setGenerationEndpoint(event.target.value)} disabled={!activeModels.length} className="mt-2 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-3 text-sm text-[var(--ink)] disabled:opacity-60">{activeModels.length ? activeModels.map((model) => <option key={model.endpointId} value={model.endpointId}>{model.displayName}</option>) : <option value="">No active model configuration</option>}</select></label><div className="rounded-xl border border-[var(--line)] bg-[#f8f5ec] px-3 py-3"><p className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted-ink)]">Endpoint identifier</p><p className="mt-2 truncate text-sm font-semibold text-[var(--ink)]" title={selectedModel?.endpointId ?? ""}>{selectedModel?.endpointId ?? "None active"}</p></div></div>
        <div className="mt-4 grid gap-4 md:grid-cols-3"><label className="block"><span className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted-ink)]">Aspect ratio</span><select value={supportedRatios.includes(aspectRatio as (typeof supportedRatios)[number]) ? aspectRatio : supportedRatios[0]} onChange={(event) => setAspectRatio(event.target.value)} className="mt-2 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-3 text-sm text-[var(--ink)]">{supportedRatios.map((ratio) => <option key={ratio} value={ratio}>{ratio}{ratio === "1:1" ? " square" : ratio === "3:2" ? " landscape" : ratio === "2:3" ? " portrait" : ""}</option>)}</select></label><label className="block"><span className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted-ink)]">Seed (optional)</span><input value={seed} onChange={(event) => setSeed(event.target.value.replace(/[^0-9-]/g, ""))} placeholder="Provider default" className="mt-2 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-3 text-sm text-[var(--ink)]" /></label><div className="rounded-xl border border-[var(--line)] bg-[#f8f5ec] px-3 py-3"><p className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted-ink)]">Current scene</p><p className="mt-2 text-sm font-semibold text-[var(--ink)]">{currentPage?.sceneDirection || "No scene direction yet"}</p></div></div>

        <div className="mt-6 grid gap-4 md:grid-cols-3"><label className="block"><span className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted-ink)]">New prompt direction</span><textarea value={promptAddition} onChange={(event) => setPromptAddition(event.target.value)} rows={4} placeholder="Only what is unique to this page…" className="mt-2 w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-3 text-sm leading-5 text-[var(--ink)]" /></label><label className="block"><span className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted-ink)]">Composition notes</span><textarea value={compositionNotes} onChange={(event) => setCompositionNotes(event.target.value)} rows={4} placeholder="Focal point, negative space, spread balance…" className="mt-2 w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-3 text-sm leading-5 text-[var(--ink)]" /></label><label className="block"><span className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted-ink)]">Additional negative constraints</span><textarea value={negativePromptAddition} onChange={(event) => setNegativePromptAddition(event.target.value)} rows={4} placeholder="Specific things to avoid on this page…" className="mt-2 w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-3 text-sm leading-5 text-[var(--ink)]" /></label></div>

        <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[#fbfaf5] p-4"><div className="flex items-center justify-between gap-3"><div><p className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted-ink)]">Approved visual references</p><p className="mt-1 text-xs text-[var(--muted-ink)]">Only active references with a rights attestation can be sent as generation inputs.</p></div><span className="rounded-full bg-[#e9f2ed] px-3 py-1 text-xs font-semibold text-[#517b68]">{selectedReferenceIds.length} selected</span></div>{referenceData.length ? <div className="mt-3 grid gap-2 md:grid-cols-2">{referenceData.map((reference) => <label key={reference.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-3"><input type="checkbox" checked={selectedReferenceIds.includes(reference.id)} onChange={() => toggleReference(reference.id)} className="h-4 w-4 accent-[#203348]" /><img src={reference.accessUrl} alt="" className="h-10 w-10 rounded-lg bg-[#ece8dd] object-cover" /><span className="min-w-0"><span className="block truncate text-xs font-semibold text-[var(--ink)]">{reference.originalFilename}</span><span className="block text-[10px] text-[#517b68]">Rights attested · {reference.referenceKind.replaceAll("_", " ")}</span></span></label>)}</div> : <p className="mt-3 text-sm text-[var(--muted-ink)]">No references have been added to this project.</p>}</div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button type="button" disabled={compose.isPending} onClick={submit} className="inline-flex items-center gap-2 rounded-full bg-[var(--navy)] px-5 py-3 text-sm font-semibold text-white hover:bg-[#2d465f] disabled:cursor-not-allowed disabled:opacity-45"><WandSparkles size={16} />{compose.isPending ? "Composing…" : "Compose & save version"}</button>
          <button type="button" disabled={!latestVersion || Boolean(approvedVersion) || freeze.isPending} onClick={() => latestVersion && freeze.mutate({ projectId, promptVersionId: latestVersion.id })} title={approvedVersion ? "This page already has a frozen, approved version." : "Freezing approves this version so the page can be generated."} className="inline-flex items-center gap-2 rounded-full border border-[var(--navy)] px-5 py-3 text-sm font-semibold text-[var(--navy)] hover:bg-[#eef3f7] disabled:cursor-not-allowed disabled:opacity-45"><Lock size={16} />{freeze.isPending ? "Freezing…" : approvedVersion ? "Frozen & approved" : "Freeze & approve for generation"}</button>
          {feedback && <span className="text-sm text-[var(--muted-ink)]">{feedback}</span>}
        </div>
        <div className={`mt-4 rounded-2xl border p-4 text-sm leading-6 ${approvedVersion ? "border-[#bcd9c9] bg-[#eef7f1] text-[#316b52]" : "border-[#e3d3ab] bg-[#fffaef] text-[#7d5538]"}`} role="status">
          {approvedVersion
            ? <>Step 2 of 2 complete — version {approvedVersion.version} is frozen. Open <strong>Page studio</strong> and press Generate for this page.</>
            : latestVersion
              ? <>Step 1 of 2 done — version {latestVersion.version} is saved as a <strong>draft</strong>. A draft cannot be generated. Press <strong>Freeze &amp; approve for generation</strong> above to finish.</>
              : <>Compose a version first, then freeze it. Generation only ever runs from a frozen, approved prompt.</>}
        </div>
      </div>

      <div className="rounded-[24px] border border-[var(--line)] bg-[var(--paper-strong)] p-5 md:p-7"><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="mono text-[10px] uppercase tracking-[0.22em] text-[var(--coral)]">Prompt history</p><h2 className="serif mt-2 text-3xl text-[var(--ink)]">Compare before you commit.</h2></div><div className="flex items-center gap-2 text-xs text-[var(--muted-ink)]"><GitCompareArrows size={16} /> Immutable snapshots</div></div>{versions.isLoading && <div className="mt-6"><LoadingState label="Loading prompt versions" /></div>}{versions.isError && <div className="mt-6"><ErrorState message="Prompt versions could not be loaded." /></div>}{versions.data && versions.data.length === 0 && <p className="mt-6 rounded-xl bg-[#f8f5ec] p-4 text-sm text-[var(--muted-ink)]">No prompt versions yet. Compose the first one from the saved story context.</p>}{versions.data && versions.data.length > 0 && <><div className="mt-6 grid gap-4 md:grid-cols-2"><label className="block"><span className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted-ink)]">Compare version</span><select value={leftVersion?.id ?? ""} onChange={(event) => setLeftVersionId(event.target.value)} className="mt-2 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-3 text-sm text-[var(--ink)]">{versions.data.map((version) => <option key={version.id} value={version.id}>Version {version.version} · {version.contentHashSha256.slice(0, 10)}</option>)}</select></label><label className="block"><span className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted-ink)]">Against version</span><select value={rightVersion?.id ?? ""} onChange={(event) => setRightVersionId(event.target.value)} className="mt-2 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-3 text-sm text-[var(--ink)]"><option value="">Select another version</option>{versions.data.map((version) => <option key={version.id} value={version.id}>Version {version.version} · {version.contentHashSha256.slice(0, 10)}</option>)}</select></label></div><div className="mt-5 grid gap-4 md:grid-cols-2">{[leftVersion, rightVersion].map((version, index) => <article key={version?.id ?? `empty-${index}`} className="min-h-[260px] rounded-2xl border border-[var(--line)] bg-[#fbfaf5] p-4"><div className="flex items-center justify-between gap-3"><p className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted-ink)]">{version ? `Version ${version.version}` : "Choose a version"}</p>{version && <button type="button" disabled={restore.isPending} onClick={() => restore.mutate({ projectId, promptVersionId: version.id })} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--paper)]"><RotateCcw size={13} />Restore</button>}</div>{version ? <><pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap text-xs leading-5 text-[var(--ink)]">{version.prompt}</pre><div className="mt-4 border-t border-[var(--line)] pt-3 text-[10px] text-[var(--muted-ink)]">Hash {version.contentHashSha256.slice(0, 16)} · {version.lintWarnings.length} warning{version.lintWarnings.length === 1 ? "" : "s"}</div></> : <p className="mt-6 text-sm text-[var(--muted-ink)]">Select a second snapshot to compare the full composed request side by side.</p>}</article>)}</div>{leftVersion?.lintWarnings?.length ? <div className="mt-5 space-y-2 rounded-2xl border border-[#f0d5cf] bg-[#fff8f5] p-4"><div className="flex items-center gap-2 text-sm font-semibold text-[#a54a3b]"><AlertTriangle size={16} /> Explainable lint warnings</div>{leftVersion.lintWarnings.map((warning) => <div key={`${warning.code}-${warning.evidence}`} className="border-l-2 border-[#e16f5d] pl-3 text-xs leading-5 text-[#7f433a]"><strong>{warning.code.replaceAll("_", " ")}</strong>: {warning.message} <span className="block text-[#a36a61]">Evidence: {warning.evidence}</span></div>)}</div> : <div className="mt-5 flex items-center gap-2 rounded-xl bg-[#e9f2ed] p-4 text-sm text-[#517b68]"><Check size={16} /> No lint warnings were recorded for the selected version.</div>}</>}
      </div>
    </div>
  );
}
