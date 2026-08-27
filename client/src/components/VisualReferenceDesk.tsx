import { useRef, useState } from "react";
import { FileImage, RefreshCw, ShieldCheck, Trash2, UploadCloud, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { EmptyState, ErrorState, LoadingState } from "./States";
import ConfirmDialog from "./ConfirmDialog";

const kindLabels = {
  character_sheet: "Character sheet",
  sketch_reference: "Sketch reference",
  moodboard: "Moodboard",
  cover_reference: "Cover reference",
} as const;

const provenanceLabels = {
  user_owned: "I own this reference",
  licensed: "I have a license to use it",
  permission_granted: "I have permission to use it",
} as const;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export default function VisualReferenceDesk({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<keyof typeof kindLabels>("character_sheet");
  const [provenance, setProvenance] = useState<keyof typeof provenanceLabels>("user_owned");
  const [rightsAttestation, setRightsAttestation] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState<string | undefined>();
  const [selectedName, setSelectedName] = useState("");
  const [referenceToDelete, setReferenceToDelete] = useState<{ id: string; name: string } | null>(null);
  const references = trpc.references.list.useQuery({ projectId });
  const upload = trpc.references.upload.useMutation({
    onSuccess: async () => {
      await utils.references.list.invalidate({ projectId });
      resetForm();
    },
  });
  const remove = trpc.references.delete.useMutation({
    onSuccess: () => utils.references.list.invalidate({ projectId }),
  });

  function resetForm() {
    setRightsAttestation(false);
    setReplaceTarget(undefined);
    setSelectedName("");
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleFile(file: File) {
    if (!rightsAttestation) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await upload.mutateAsync({
      projectId,
      referenceKind: kind,
      originalFilename: file.name,
      declaredMimeType: file.type as "image/png" | "image/jpeg" | "image/webp",
      provenanceDeclaration: provenance,
      rightsAttestation: true,
      bytesBase64: toBase64(bytes),
      replacesId: replaceTarget,
    });
  }

  function chooseFile() {
    inputRef.current?.click();
  }

  return (
    <>
    <div className="space-y-7">
      <div className="rounded-[24px] border border-[var(--line)] bg-[var(--paper-strong)] p-5 shadow-[0_12px_38px_rgba(32,51,72,.05)] md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="mono text-[10px] uppercase tracking-[0.22em] text-[var(--coral)]">Reference library</p>
            <h2 className="serif mt-2 text-3xl text-[var(--ink)]">Bring the feeling, not the file.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted-ink)]">Add character sheets, sketches, moodboards, or cover references to keep the book’s visual language coherent. References guide original work; they do not authorize copying.</p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#e9f2ed] text-[#517b68]"><ShieldCheck size={22} /></div>
        </div>

        <div className="mt-7 grid gap-4 md:grid-cols-3">
          <label className="block"><span className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted-ink)]">Reference kind</span><select value={kind} onChange={(event) => setKind(event.target.value as keyof typeof kindLabels)} className="mt-2 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-3 text-sm text-[var(--ink)]">{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="block"><span className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted-ink)]">Provenance</span><select value={provenance} onChange={(event) => setProvenance(event.target.value as keyof typeof provenanceLabels)} className="mt-2 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-3 text-sm text-[var(--ink)]">{Object.entries(provenanceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <div className="rounded-xl border border-[var(--line)] bg-[#f8f5ec] px-3 py-3"><p className="mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted-ink)]">Accepted files</p><p className="mt-2 text-sm font-semibold text-[var(--ink)]">PNG, JPEG, WebP</p><p className="mt-1 text-xs text-[var(--muted-ink)]">Validated before private storage</p></div>
        </div>

        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--line)] bg-[#fbfaf5] p-4"><input type="checkbox" checked={rightsAttestation} onChange={(event) => setRightsAttestation(event.target.checked)} className="mt-1 h-4 w-4 accent-[#203348]" /><span className="text-sm leading-5 text-[var(--ink)]"><strong>I own this reference or have permission to use it.</strong><span className="mt-1 block text-xs text-[var(--muted-ink)]">This rights declaration is required before the reference can be sent as an input to image generation.</span></span></label>

        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) { setSelectedName(file.name); void handleFile(file); } }} />
        <div className="mt-5 flex flex-wrap items-center gap-3"><button type="button" disabled={!rightsAttestation || upload.isPending} onClick={chooseFile} className="inline-flex items-center gap-2 rounded-full bg-[var(--navy)] px-5 py-3 text-sm font-semibold text-white hover:bg-[#2d465f] disabled:cursor-not-allowed disabled:opacity-45"><UploadCloud size={16} />{upload.isPending ? "Validating & storing…" : replaceTarget ? "Choose replacement" : "Upload reference"}</button>{replaceTarget && <button type="button" onClick={resetForm} className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-4 py-3 text-sm font-semibold text-[var(--muted-ink)] hover:bg-[#f4f1e8]"><X size={15} />Cancel replacement</button>}{selectedName && !upload.isPending && <span className="text-xs text-[var(--muted-ink)]">Selected: {selectedName}</span>}</div>
        {upload.isError && <p className="mt-4 rounded-xl bg-[#fff0ed] px-4 py-3 text-sm text-[#a54a3b]">{upload.error.message}</p>}
      </div>

      {references.isLoading && <LoadingState label="Loading private references" />}
      {references.isError && <ErrorState message="Your visual references could not be loaded." />}
      {references.data && references.data.length === 0 && <EmptyState title="No references on the shelf yet." description="Upload a visual anchor when you are ready. The studio will keep the original bytes private and attach only the declared rights metadata to this project." action={<button type="button" disabled={!rightsAttestation} onClick={chooseFile} className="inline-flex items-center gap-2 rounded-full bg-[var(--navy)] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"><UploadCloud size={16} />Add the first reference</button>} />}
      {references.data && references.data.length > 0 && <div className="grid gap-4 md:grid-cols-2">{references.data.map((reference) => <article key={reference.id} className="overflow-hidden rounded-[22px] border border-[var(--line)] bg-[var(--paper-strong)]"><div className="grid min-h-[190px] place-items-center bg-[#ece8dd] p-3"><img src={reference.accessUrl} alt={`${kindLabels[reference.referenceKind]} — ${reference.originalFilename}`} className="max-h-52 w-full rounded-xl object-contain" /></div><div className="p-5"><div className="flex items-start justify-between gap-4"><div><p className="mono text-[9px] uppercase tracking-[0.16em] text-[var(--coral)]">{kindLabels[reference.referenceKind]}</p><h3 className="mt-1 truncate text-sm font-semibold text-[var(--ink)]">{reference.originalFilename}</h3></div><FileImage size={18} className="shrink-0 text-[var(--muted-ink)]" /></div><div className="mt-4 grid grid-cols-2 gap-2 text-xs text-[var(--muted-ink)]"><span>{reference.widthPx} × {reference.heightPx}px</span><span>{(reference.byteSize / 1024 / 1024).toFixed(2)} MB</span><span className="col-span-2">{provenanceLabels[reference.provenanceDeclaration]} · rights attested</span></div><div className="mt-5 flex gap-2 border-t border-[var(--line)] pt-4"><button type="button" onClick={() => { setReplaceTarget(reference.id); setKind(reference.referenceKind); setProvenance(reference.provenanceDeclaration); setRightsAttestation(reference.rightsAttestation); chooseFile(); }} className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-3 py-2 text-xs font-semibold text-[var(--ink)] hover:bg-[#f4f1e8]"><RefreshCw size={13} />Replace</button><button type="button" disabled={remove.isPending} onClick={() => setReferenceToDelete({ id: reference.id, name: reference.originalFilename })} className="inline-flex items-center gap-2 rounded-full border border-[#f0d5cf] px-3 py-2 text-xs font-semibold text-[#a54a3b] hover:bg-[#fff0ed]"><Trash2 size={13} />{remove.isPending ? "Deleting…" : "Delete"}</button></div></div></article>)}</div>}
      {remove.isError && <p className="rounded-xl bg-[#fff0ed] px-4 py-3 text-sm text-[#a54a3b]">The private reference could not be deleted safely.</p>}
    </div>
      <ConfirmDialog open={Boolean(referenceToDelete)} title={`Delete ${referenceToDelete?.name ?? "this reference"}?`} description="This permanently removes the private source reference and its quality record. It cannot be recovered from the studio." confirmLabel="Delete reference" onCancel={() => setReferenceToDelete(null)} onConfirm={() => { if (referenceToDelete) void remove.mutateAsync({ referenceId: referenceToDelete.id }); setReferenceToDelete(null); }} />
    </>
  );
}
