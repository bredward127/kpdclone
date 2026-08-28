import { ArrowLeft, ArrowRight, CheckCircle2, CircleDashed, FileText, Image, Layers3, Ruler, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import VisualReferenceDesk from "@/components/VisualReferenceDesk";
import PromptStudio from "@/components/PromptStudio";
import PageGenerationStudio from "@/components/PageGenerationStudio";
import CoverDesk from "@/components/CoverDesk";
import { ValidationDesk } from "@/components/ValidationDesk";
import ExportCenter from "@/components/ExportCenter";
import PublishingDesk from "@/components/PublishingDesk";
import BookBriefEditor from "@/components/BookBriefEditor";
import BlueprintPlanner from "@/components/BlueprintPlanner";

const sectionCopy = {
  "book-brief": { eyebrow: "02 / Book brief", title: "Begin with the feeling.", description: "Capture the heart of the story, its reader, and the visual language you want to carry through every page.", icon: FileText, next: "blueprint", nextLabel: "Shape the blueprint" },
  blueprint: { eyebrow: "03 / Blueprint", title: "Give the story a spine.", description: "Map the arc, pacing, page beats, and illustration moments before any asset work begins.", icon: Layers3, next: "page-studio", nextLabel: "Open page studio" },
  "page-studio": { eyebrow: "04 / Page studio", title: "One page at a time.", description: "This is where approved page moments will become individual interior illustrations. Generation stays bounded and reviewable.", icon: Image, next: "cover-desk", nextLabel: "Plan the cover" },
  "cover-desk": { eyebrow: "05 / Cover desk", title: "Wrap the promise.", description: "Build a structured cover plan around separate artwork, imported KDP template bounds, and deterministic final typography.", icon: Ruler, next: "validation", nextLabel: "Review validation" },
  validation: { eyebrow: "06 / Validation", title: "Make it ready to leave.", description: "A versioned preflight pass checks the interior, full-wrap cover, dimensions, approvals, and package manifest before export.", icon: ShieldCheck, next: "exports", nextLabel: "View exports" },
  exports: { eyebrow: "07 / Exports", title: "Take it to the shelf.", description: "Create a private, immutable package from a confirmed version and a blocking-free validation run.", icon: CheckCircle2, next: "book-brief", nextLabel: "Return to brief" },
} as const;

type SectionKey = keyof typeof sectionCopy;

export default function StudioSection({ projectId, section }: { projectId: string; section: SectionKey }) {
  const project = trpc.project.get.useQuery({ projectId });
  const copy = sectionCopy[section];
  const Icon = copy.icon;

  if (project.isLoading) return <LoadingState label="Loading project workspace" />;
  if (project.isError) return <ErrorState message="This project is unavailable or does not belong to your account." />;
  if (!project.data) return <ErrorState message="This project could not be found." />;

  if (section === "cover-desk") {
    return (
      <div className="mx-auto max-w-6xl">
        <div className="mb-7 flex items-center justify-between gap-4"><Link href="/projects" className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--muted-ink)] hover:text-[var(--ink)]"><ArrowLeft size={15} /> All projects</Link><span className="mono rounded-full bg-[#e9f2ed] px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-[#517b68]">Draft workspace</span></div>
        <header className="mb-9 grid gap-7 border-b border-[var(--line)] pb-10 md:grid-cols-[1fr_280px] md:items-end"><div><p className="mono mb-3 text-[10px] uppercase tracking-[0.24em] text-[var(--coral)]">{copy.eyebrow}</p><h1 className="serif max-w-2xl text-5xl leading-[1.04] text-[var(--ink)] md:text-6xl">{copy.title}</h1><p className="mt-5 max-w-xl text-sm leading-6 text-[var(--muted-ink)]">{copy.description}</p></div><div className="rounded-[24px] border border-[var(--line)] bg-[var(--paper-strong)] p-5"><p className="mono text-[9px] uppercase tracking-[0.18em] text-[var(--muted-ink)]">Active book</p><p className="mt-2 truncate text-sm font-semibold text-[var(--ink)]">{project.data.name}</p></div></header>
        <CoverDesk projectId={projectId} />
      </div>
    );
  }

  if (section === "book-brief") {
    return (
      <div className="mx-auto max-w-6xl">
        <div className="mb-7 flex items-center justify-between gap-4"><Link href="/projects" className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--muted-ink)] hover:text-[var(--ink)]"><ArrowLeft size={15} /> All projects</Link><span className="mono rounded-full bg-[#e9f2ed] px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-[#517b68]">Book memory station</span></div>
        <BookBriefEditor projectId={projectId} />
      </div>
    );
  }

  if (section === "blueprint") {
    return (
      <div className="mx-auto max-w-6xl">
        <div className="mb-7 flex items-center justify-between gap-4"><Link href="/projects" className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--muted-ink)] hover:text-[var(--ink)]"><ArrowLeft size={15} /> All projects</Link><span className="mono rounded-full bg-[#e9f2ed] px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-[#517b68]">Page planning station</span></div>
        <BlueprintPlanner projectId={projectId} />
      </div>
    );
  }

  if (section === "validation") {
    return (
      <div className="mx-auto max-w-6xl">
        <div className="mb-7 flex items-center justify-between gap-4"><Link href="/projects" className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--muted-ink)] hover:text-[var(--ink)]"><ArrowLeft size={15} /> All projects</Link><span className="mono rounded-full bg-[#e9f2ed] px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-[#517b68]">Preflight station</span></div>
        <ValidationDesk projectId={projectId} />
      </div>
    );
  }

  if (section === "exports") {
    return (
      <div className="mx-auto max-w-6xl">
        <div className="mb-7 flex items-center justify-between gap-4"><Link href="/projects" className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--muted-ink)] hover:text-[var(--ink)]"><ArrowLeft size={15} /> All projects</Link><span className="mono rounded-full bg-[#e9f2ed] px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-[#517b68]">Private export station</span></div>
        <ExportCenter projectId={projectId} />
      </div>
    );
  }

  if (section === "page-studio") {
    return (
      <div className="mx-auto max-w-5xl">
        <div className="mb-7 flex items-center justify-between gap-4"><Link href="/projects" className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--muted-ink)] hover:text-[var(--ink)]"><ArrowLeft size={15} /> All projects</Link><span className="mono rounded-full bg-[#e9f2ed] px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-[#517b68]">Draft workspace</span></div>
        <header className="mb-9 grid gap-7 border-b border-[var(--line)] pb-10 md:grid-cols-[1fr_280px] md:items-end"><div><p className="mono mb-3 text-[10px] uppercase tracking-[0.24em] text-[var(--coral)]">{copy.eyebrow}</p><h1 className="serif max-w-2xl text-5xl leading-[1.04] text-[var(--ink)] md:text-6xl">{copy.title}</h1><p className="mt-5 max-w-xl text-sm leading-6 text-[var(--muted-ink)]">{copy.description}</p></div><div className="rounded-[24px] border border-[var(--line)] bg-[var(--paper-strong)] p-5"><p className="mono text-[9px] uppercase tracking-[0.18em] text-[var(--muted-ink)]">Active book</p><p className="mt-2 truncate text-sm font-semibold text-[var(--ink)]">{project.data.name}</p></div></header>
        <PageGenerationStudio projectId={projectId} />
        <VisualReferenceDesk projectId={projectId} />
        <PromptStudio projectId={projectId} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-7 flex items-center justify-between gap-4"><Link href="/projects" className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--muted-ink)] hover:text-[var(--ink)]"><ArrowLeft size={15} /> All projects</Link><span className="mono rounded-full bg-[#e9f2ed] px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-[#517b68]">Draft workspace</span></div>
      <header className="grid gap-7 border-b border-[var(--line)] pb-10 md:grid-cols-[1fr_280px] md:items-end">
        <div><p className="mono mb-3 text-[10px] uppercase tracking-[0.24em] text-[var(--coral)]">{copy.eyebrow}</p><h1 className="serif max-w-2xl text-5xl leading-[1.04] text-[var(--ink)] md:text-6xl">{copy.title}</h1><p className="mt-5 max-w-xl text-sm leading-6 text-[var(--muted-ink)]">{copy.description}</p></div>
        <div className="rounded-[24px] border border-[var(--line)] bg-[var(--paper-strong)] p-5"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--navy)] text-white"><Icon size={19} /></div><div className="min-w-0"><p className="mono text-[9px] uppercase tracking-[0.18em] text-[var(--muted-ink)]">Active book</p><p className="truncate text-sm font-semibold text-[var(--ink)]">{project.data.name}</p></div></div><div className="mt-5 flex items-center justify-between border-t border-[var(--line)] pt-4"><span className="text-xs text-[var(--muted-ink)]">Production status</span><span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#517b68]"><CircleDashed size={13} /> Planning</span></div></div>
      </header>
      <section className="mt-9"><EmptyState title="This station is ready for your notes." description="The route and project context are live. Feature-specific editor, generation, validation, and export actions will be added in their dedicated implementation steps." action={<Link href={`/projects/${projectId}/${copy.next}`} className="inline-flex items-center gap-2 rounded-full bg-[var(--navy)] px-5 py-3 text-sm font-semibold text-white hover:bg-[#2d465f]">{copy.nextLabel} <ArrowRight size={16} /></Link>} /></section>
    </div>
  );
}
