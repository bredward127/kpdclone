import { useState } from "react";
import { ArrowRight, CheckCircle2, FileText, Image, Layers3, Ruler, ShieldCheck } from "lucide-react";
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
import PageBatchBoard from "@/components/PageBatchBoard";
import ContinuityHeader from "@/components/ContinuityHeader";
import BookPreview from "@/components/BookPreview";

const sectionCopy = {
  "book-brief": { eyebrow: "Step 01 / Story", title: "Tell me about your book.", description: "Describe your story, characters, setting, and art style. Use the AI button to fill everything in from a single sentence — then edit to make it yours.", icon: FileText, next: "blueprint", nextLabel: "Set up pages →" },
  blueprint: { eyebrow: "Step 02 / Pages", title: "Plan your pages.", description: "Choose how many pages your book has and write a short scene description and story text for each one. The AI can draft the whole page list from your story summary.", icon: Layers3, next: "page-studio", nextLabel: "Start creating →" },
  "page-studio": { eyebrow: "Step 03 / Create", title: "Generate your artwork.", description: "Generate images for each page. You can do them one at a time or queue up several at once. Review each image and approve the ones you like before moving on.", icon: Image, next: "cover-desk", nextLabel: "Design your cover →" },
  "cover-desk": { eyebrow: "Step 04 / Cover", title: "Design your cover.", description: "Build your front cover, back cover, and spine. Upload your artwork and place your title and author name within the KDP safe zones.", icon: Ruler, next: "exports", nextLabel: "Preview your book →" },
  validation: { eyebrow: "Preflight check", title: "Final check.", description: "Run a preflight pass to make sure all pages are approved, dimensions are correct, and the package is ready to export.", icon: ShieldCheck, next: "exports", nextLabel: "Export →" },
  preview: { eyebrow: "Step 05 / Preview", title: "See the finished book.", description: "Page through your book exactly as it will print, with your story text typeset over the artwork. Choose the font, size and position — for the whole book or one page — before you export.", icon: FileText, next: "exports", nextLabel: "Export your book →" },
  exports: { eyebrow: "Step 06 / Export", title: "Export your book.", description: "Package your approved interior pages and cover into print-ready files for Amazon KDP. Each export is a private, versioned snapshot.", icon: CheckCircle2, next: "book-brief", nextLabel: "← Back to story" },
} as const;

type SectionKey = keyof typeof sectionCopy;

export default function StudioSection({ projectId, section }: { projectId: string; section: SectionKey }) {
  const project = trpc.project.get.useQuery({ projectId });
  // Which page the board handed off to the composer and generation desk below.
  const [focusPagePlanId, setFocusPagePlanId] = useState("");
  // A character list row's "Add reference for X" sets this so the Reference
  // Library (a sibling below it) can prefill and scroll to its upload form.
  const [requestedReferenceLabel, setRequestedReferenceLabel] = useState("");
  const copy = sectionCopy[section];

  if (project.isLoading) return <LoadingState label="Loading project workspace" />;
  if (project.isError) return <ErrorState message="This project is unavailable or does not belong to your account." />;
  if (!project.data) return <ErrorState message="This project could not be found." />;

  function SectionShell({ maxWidth = "max-w-6xl", children }: { maxWidth?: string; children: React.ReactNode }) {
    return (
      <div className={`mx-auto ${maxWidth}`}>
        <div className="mb-8 flex items-start gap-4">
          <div>
            <p className="mono text-[10px] uppercase tracking-[0.24em] text-[var(--coral)]">{copy.eyebrow}</p>
            <h1 className="serif mt-1 text-4xl leading-tight text-[var(--ink)] md:text-5xl">{copy.title}</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--muted-ink)]">{copy.description}</p>
          </div>
        </div>
        {children}
      </div>
    );
  }

  if (section === "book-brief") {
    return (
      <SectionShell>
        {/* Reference art belongs above the AI fill button, not after it: the
            character bible and prop bible are inherited verbatim into every
            page prompt, so a reference's label has to exist before "Fill
            with AI" writes those fields, not be uploaded afterward to a brief
            that already invented a conflicting description. */}
        <VisualReferenceDesk
          projectId={projectId}
          requestedLabel={requestedReferenceLabel}
          onRequestedLabelHandled={() => setRequestedReferenceLabel("")}
        />
        <div className="mt-8">
          <BookBriefEditor projectId={projectId} onRequestReference={setRequestedReferenceLabel} />
        </div>
      </SectionShell>
    );
  }

  if (section === "blueprint") {
    return (
      <SectionShell>
        {/* Reference art has to be uploaded and labelled before scene
            directions are drafted, not after: the AI that writes each page's
            sceneDirection reads a reference's label and usage notes so it can
            write "the red Mustang" instead of inventing a car with no
            relationship to the art that will actually illustrate it. */}
        <VisualReferenceDesk projectId={projectId} />
        <div className="mt-8">
          <BlueprintPlanner projectId={projectId} />
        </div>
      </SectionShell>
    );
  }

  if (section === "page-studio") {
    return (
      <SectionShell maxWidth="max-w-5xl">
        {/* Continuity comes first: references and the story bible decide whether
            every page can be drawn as the same book, so they belong above the
            generate controls rather than buried below them. */}
        <ContinuityHeader projectId={projectId} />
        <div className="mt-8">
          <VisualReferenceDesk projectId={projectId} />
        </div>
        <div className="mt-8">
          <PageBatchBoard
            projectId={projectId}
            onOpenPage={(pagePlanId) => {
              setFocusPagePlanId(pagePlanId);
              document.getElementById("page-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          />
        </div>
        <div id="page-detail" className="mt-8 scroll-mt-6">
          <PromptStudio projectId={projectId} focusPagePlanId={focusPagePlanId} />
        </div>
        <div className="mt-8">
          <PageGenerationStudio projectId={projectId} focusPagePlanId={focusPagePlanId} />
        </div>
      </SectionShell>
    );
  }

  if (section === "cover-desk") {
    return (
      <SectionShell>
        <CoverDesk projectId={projectId} />
      </SectionShell>
    );
  }

  if (section === "validation") {
    return (
      <SectionShell>
        <ValidationDesk projectId={projectId} />
      </SectionShell>
    );
  }

  if (section === "preview") {
    return (
      <SectionShell>
        <BookPreview projectId={projectId} />
      </SectionShell>
    );
  }

  if (section === "exports") {
    return (
      <SectionShell>
        <ExportCenter projectId={projectId} />
      </SectionShell>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <p className="mono mb-3 text-[10px] uppercase tracking-[0.24em] text-[var(--coral)]">{copy.eyebrow}</p>
      <h1 className="serif text-4xl text-[var(--ink)]">{copy.title}</h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--muted-ink)]">{copy.description}</p>
      <section className="mt-9">
        <EmptyState title="Coming soon." description="This section is on its way." action={<Link href={`/projects/${projectId}/${copy.next}`} className="inline-flex items-center gap-2 rounded-full bg-[var(--navy)] px-5 py-3 text-sm font-semibold text-white hover:bg-[#2d465f]">{copy.nextLabel} <ArrowRight size={16} /></Link>} />
      </section>
    </div>
  );
}
