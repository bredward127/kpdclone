import { FormEvent, useState } from "react";
import { ArrowUpRight, FolderPlus, Plus, Trash2 } from "lucide-react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";

export default function Projects() {
  const [, setLocation] = useLocation();
  const projects = trpc.project.list.useQuery();
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const createProject = trpc.project.create.useMutation({
    onSuccess: async (project) => {
      setName("");
      setBrief("");
      setIsCreating(false);
      await utils.project.list.invalidate();
      setLocation(`/projects/${project.id}/book-brief`);
    },
  });
  const removeProject = trpc.project.remove.useMutation({
    onSuccess: () => utils.project.list.invalidate(),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    createProject.mutate({ name: name.trim(), brief: brief.trim() });
  }

  if (projects.isLoading) return <LoadingState label="Loading your project shelf" />;
  if (projects.isError) return <ErrorState message="Your projects could not be loaded from the server." />;
  const projectList = projects.data ?? [];

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
        <div><p className="mono mb-3 text-[10px] uppercase tracking-[0.24em] text-[var(--coral)]">01 / Project shelf</p><h1 className="serif text-5xl leading-[1.05] text-[var(--ink)] md:text-6xl">Make room for<br /><em className="font-normal text-[var(--coral)]">good stories.</em></h1><p className="mt-5 max-w-xl text-sm leading-6 text-[var(--muted-ink)]">A quiet workspace for turning a spark of a story into a book that is ready for the shelf.</p></div>
        <button onClick={() => setIsCreating((value) => !value)} className="inline-flex h-fit items-center justify-center gap-2 rounded-full bg-[var(--coral)] px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(225,111,93,.2)] hover:bg-[#c95d4d]"><Plus size={17} /> Start a new book</button>
      </header>

      {isCreating ? <form onSubmit={submit} className="mb-8 grid gap-4 rounded-[28px] border border-[var(--line)] bg-[var(--paper-strong)] p-6 shadow-[0_18px_45px_rgba(32,51,72,.06)] md:grid-cols-[1fr_1.5fr_auto] md:items-end">
        <label className="block"><span className="mono mb-2 block text-[10px] uppercase tracking-[0.18em] text-[var(--muted-ink)]">Book title</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="The Little Lantern" className="w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4 py-3 text-sm text-[var(--ink)] outline-none placeholder:text-[#a3a8ad] focus:border-[var(--coral)]" /></label>
        <label className="block"><span className="mono mb-2 block text-[10px] uppercase tracking-[0.18em] text-[var(--muted-ink)]">Opening brief <span className="normal-case tracking-normal">(optional)</span></span><textarea value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="A gentle bedtime story about..." rows={1} className="w-full resize-none rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4 py-3 text-sm text-[var(--ink)] outline-none placeholder:text-[#a3a8ad] focus:border-[var(--coral)]" /></label>
        <button disabled={!name.trim() || createProject.isPending} className="rounded-xl bg-[var(--navy)] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{createProject.isPending ? "Creating…" : "Create project"}</button>
        {createProject.isError ? <p className="text-xs text-[var(--coral)] md:col-span-3">{createProject.error.message}</p> : null}
      </form> : null}

      {projectList.length === 0 ? <EmptyState title="Your shelf is waiting." description="Start with a title and a sentence. Your first book project will live here, safely tied to your creator account." action={<button onClick={() => setIsCreating(true)} className="inline-flex items-center gap-2 rounded-full border border-[var(--navy)] px-4 py-2.5 text-sm font-semibold text-[var(--navy)] hover:bg-[var(--navy)] hover:text-white"><FolderPlus size={16} /> Create your first project</button>} /> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {projectList.map((project, index) => <article key={project.id} className="group relative flex min-h-[230px] flex-col justify-between overflow-hidden rounded-[28px] border border-[var(--line)] bg-[var(--paper-strong)] p-6 shadow-[0_14px_40px_rgba(32,51,72,.045)] transition hover:-translate-y-1 hover:shadow-[0_20px_50px_rgba(32,51,72,.10)]">
          <div className="absolute -right-10 -top-14 h-36 w-36 rounded-full bg-[var(--mint)] opacity-55" /><div className="relative"><div className="mb-6 flex items-center justify-between"><span className="mono text-[10px] uppercase tracking-[0.2em] text-[var(--muted-ink)]">Book {String(index + 1).padStart(2, "0")}</span><span className="rounded-full bg-[#f0ece3] px-2.5 py-1 text-[10px] font-semibold text-[var(--muted-ink)]">Draft</span></div><h2 className="serif max-w-[15rem] text-3xl leading-tight text-[var(--ink)]">{project.name}</h2>{project.brief ? <p className="mt-3 line-clamp-2 text-sm leading-5 text-[var(--muted-ink)]">{project.brief}</p> : <p className="mt-3 text-sm italic text-[#9da4ad]">No brief yet. Begin with the story.</p>}</div>
          <div className="relative flex items-center justify-between pt-7"><Link href={`/projects/${project.id}/book-brief`} className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--coral)] hover:text-[#c95d4d]">Open studio <ArrowUpRight size={16} /></Link><button aria-label={`Delete ${project.name}`} onClick={() => removeProject.mutate({ projectId: project.id })} className="rounded-lg p-2 text-[#b1b2af] hover:bg-[#fff0ec] hover:text-[var(--coral)]"><Trash2 size={15} /></button></div>
        </article>)}
      </div>}
    </div>
  );
}
