import { AlertTriangle, CheckCircle2, Eye } from "lucide-react";

type QualityIssue = { code: string; severity: "blocking" | "warning"; message: string; details: Record<string, unknown> };
type QualityResult = {
  overallStatus: "blocked" | "warnings" | "pass" | "needs_human_review";
  effectiveDpi: number;
  requiredWidthPx: number;
  requiredHeightPx: number;
  placedWidthInches: number;
  placedHeightInches: number;
  bleedInches: number;
  safeAreaInsetInches: number;
  blockingIssueCount: number;
  warningCount: number;
  issues: QualityIssue[];
  analysisVersion: string;
};

type AssetLike = {
  accessUrl: string;
  widthPx: number | null;
  heightPx: number | null;
  mimeType: string;
  aiProvenanceClassification: string;
  promptVersionId: string | null;
  quality: QualityResult | null;
};

function statusLabel(status: QualityResult["overallStatus"]): string {
  return status === "blocked" ? "Blocking issues" : status === "warnings" ? "Warnings to review" : "Human review required";
}

export default function AssetInspector({ asset, pageNumber }: { asset: AssetLike; pageNumber?: number }) {
  const quality = asset.quality;
  const totalWidth = quality ? quality.placedWidthInches + quality.bleedInches * 2 : 1;
  const totalHeight = quality ? quality.placedHeightInches + quality.bleedInches * 2 : 1;
  const bleedX = quality ? (quality.bleedInches / totalWidth) * 100 : 0;
  const bleedY = quality ? (quality.bleedInches / totalHeight) * 100 : 0;
  const safeX = quality ? ((quality.bleedInches + quality.safeAreaInsetInches) / totalWidth) * 100 : 8;
  const safeY = quality ? ((quality.bleedInches + quality.safeAreaInsetInches) / totalHeight) * 100 : 8;
  return <div className="space-y-4">
    <div className="relative overflow-hidden rounded-2xl border border-[var(--line)] bg-[#fbfaf5] p-3">
      <div className="relative overflow-hidden rounded-xl bg-white">
        <img src={asset.accessUrl} alt={`Generated illustration${pageNumber ? ` for page ${pageNumber}` : ""}`} className="block max-h-[560px] w-full object-contain" />
        {quality && <><div className="pointer-events-none absolute border-2 border-dashed border-[#d98b77]" style={{ inset: `${bleedY}% ${bleedX}%` }}><span className="absolute left-2 top-1 rounded bg-[#fff8f5]/90 px-1.5 py-1 text-[9px] font-semibold text-[#a54a3b]">Trim</span></div><div className="pointer-events-none absolute border border-[#517b68]" style={{ inset: `${safeY}% ${safeX}%` }}><span className="absolute bottom-1 right-1 rounded bg-[#e9f2ed]/90 px-1.5 py-1 text-[9px] font-semibold text-[#517b68]">Safe area</span></div></>}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-[10px] text-[var(--muted-ink)]"><span><Eye className="mr-1 inline" size={13} />Trim and safe-area overlay</span><span>{asset.mimeType}</span></div>
    </div>
    <div className="rounded-2xl border border-[var(--line)] bg-[#fbfaf5] p-4">
      <div className="flex items-start justify-between gap-3"><div><p className="mono text-[9px] uppercase tracking-[0.16em] text-[var(--muted-ink)]">Asset quality</p><p className="mt-2 text-sm font-semibold text-[var(--ink)]">{quality ? statusLabel(quality.overallStatus) : "Analysis pending"}</p></div>{quality?.overallStatus === "blocked" ? <AlertTriangle className="text-[#a54a3b]" size={19} /> : <CheckCircle2 className="text-[#517b68]" size={19} />}</div>
      {quality ? <><div className="mt-4 grid grid-cols-2 gap-3 text-xs"><div><span className="text-[var(--muted-ink)]">Pixels</span><p className="mt-1 font-semibold text-[var(--ink)]">{asset.widthPx ?? "—"} × {asset.heightPx ?? "—"}</p></div><div><span className="text-[var(--muted-ink)]">Effective DPI</span><p className={`mt-1 font-semibold ${quality.effectiveDpi < 300 ? "text-[#a54a3b]" : "text-[var(--ink)]"}`}>{quality.effectiveDpi.toFixed(1)} / 300</p></div><div><span className="text-[var(--muted-ink)]">Required pixels</span><p className="mt-1 font-semibold text-[var(--ink)]">{quality.requiredWidthPx} × {quality.requiredHeightPx}</p></div><div><span className="text-[var(--muted-ink)]">Placed size</span><p className="mt-1 font-semibold text-[var(--ink)]">{quality.placedWidthInches} × {quality.placedHeightInches} in</p></div></div><p className="mt-4 text-xs leading-5 text-[var(--muted-ink)]">Effective DPI is calculated from image pixels divided by intended placed print size; embedded DPI metadata is not used as proof of print resolution. Automated checks never approve an asset.</p><div className="mt-4 space-y-2">{quality.issues.map((issue) => <div key={issue.code} className={`rounded-xl p-3 text-xs leading-5 ${issue.severity === "blocking" ? "bg-[#fff0eb] text-[#7f433a]" : "bg-[#fff8e8] text-[#806126]"}`}><strong>{issue.severity === "blocking" ? "Blocking: " : "Warning: "}</strong>{issue.message}</div>)}</div><p className="mt-4 mono text-[9px] uppercase tracking-[0.14em] text-[var(--muted-ink)]">Analysis {quality.analysisVersion} · {quality.blockingIssueCount} blocking · {quality.warningCount} warnings · human approval required</p></> : <p className="mt-4 text-xs text-[var(--muted-ink)]">The quality record is not available yet. Do not approve until the analysis has completed.</p>}
    </div>
    <div className="grid gap-3 rounded-2xl border border-[var(--line)] bg-[#fbfaf5] p-4 text-xs"><div><span className="text-[var(--muted-ink)]">AI provenance</span><p className="mt-1 font-semibold capitalize text-[var(--ink)]">{asset.aiProvenanceClassification.replaceAll("_", " ")}</p></div><div><span className="text-[var(--muted-ink)]">Prompt lineage</span><p className="mt-1 break-all font-semibold text-[var(--ink)]">{asset.promptVersionId ?? "Not linked"}</p></div></div>
  </div>;
}
