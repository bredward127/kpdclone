import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";

/**
 * Every page prompt carries the story bible into the model verbatim; that text
 * is the only thing making page 7 look like the same book as page 2. When a
 * field is empty the composer still builds a prompt, writing "Not supplied"
 * into the continuity section, and the pages come back inconsistent with no
 * indication why. Show that state before anything is generated, not after.
 */
export default function ContinuityHeader({ projectId }: { projectId: string }) {
  const brief = trpc.studio.brief.get.useQuery({ projectId });
  const references = trpc.references.list.useQuery({ projectId });

  if (brief.isLoading) return null;

  const data = brief.data;
  const usableReferences = (references.data ?? []).filter((asset) => asset.rightsAttestation);
  const checks = [
    { label: "Characters", ok: Boolean(data?.characterBible?.trim()), hint: "Describe each recurring character so they can be redrawn identically." },
    { label: "Props & settings", ok: Boolean(data?.propAndSettingBible?.trim()), hint: "Pin recurring objects and locations so they don't change between pages." },
    { label: "Art style", ok: Boolean(data?.visualStyleAnchors?.trim()), hint: "Describe the look that stays the same on every page." },
    { label: "Reference art", ok: usableReferences.length > 0, hint: "Upload character art below and attest rights so every page matches it." },
  ];
  const missing = checks.filter((check) => !check.ok);

  if (!missing.length) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-[#bcd8cb] bg-[#f0f7f3] px-4 py-3 text-sm text-[#356b63]">
        <CheckCircle2 size={16} className="shrink-0" />
        <span className="font-semibold">Continuity is set.</span>
        <span className="text-[var(--muted-ink)]">Characters, props, art style and {usableReferences.length} reference image{usableReferences.length === 1 ? "" : "s"} are carried into every page prompt.</span>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#e2b4a8] bg-[#fff0eb] p-4" role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle size={17} className="mt-0.5 shrink-0 text-[#7f433a]" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#7f433a]">Your pages will not match each other yet.</p>
          <p className="mt-1 text-sm leading-6 text-[#7f433a]">
            Each page prompt carries these details to keep the book consistent. What is missing gets sent to the model as
            <span className="mono"> “Not supplied”</span>, and every page invents its own version instead.
          </p>
          <ul className="mt-3 space-y-1.5">
            {checks.map((check) => (
              <li key={check.label} className="flex items-start gap-2 text-xs leading-5">
                {check.ok
                  ? <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-[#356b63]" />
                  : <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#c0705f]" />}
                <span className={check.ok ? "text-[#356b63]" : "text-[#7f433a]"}>
                  <strong>{check.label}</strong>
                  {check.ok ? " — set" : ` — missing. ${check.hint}`}
                </span>
              </li>
            ))}
          </ul>
          <Link href={`/projects/${projectId}/book-brief`} className="mt-3 inline-flex items-center gap-2 rounded-full bg-[var(--navy)] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2d465f]">
            Fix this on the Story step
          </Link>
        </div>
      </div>
    </div>
  );
}
