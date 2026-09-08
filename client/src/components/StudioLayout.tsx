import { BookOpen, ChevronDown, LogOut, Plus } from "lucide-react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { ErrorState, LoadingState, UnauthorizedState } from "./States";

const steps = [
  { label: "Story", suffix: "book-brief", step: "01" },
  { label: "Pages", suffix: "blueprint", step: "02" },
  { label: "Create", suffix: "page-studio", step: "03" },
  { label: "Cover", suffix: "cover-desk", step: "04" },
  { label: "Export", suffix: "exports", step: "05" },
];

export function StudioLayout({ children, projectId }: { children: React.ReactNode; projectId?: string }) {
  const [, navigate] = useLocation();
  const auth = trpc.auth.me.useQuery();
  const projects = trpc.project.list.useQuery(undefined, { enabled: Boolean(auth.data) });
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => {
      void auth.refetch();
      navigate("/");
    },
  });

  if (auth.isLoading) return <div className="page-frame p-5 md:p-8"><LoadingState label="Opening your studio" /></div>;
  if (auth.isError) return <div className="page-frame p-5 md:p-8"><ErrorState message="The authentication service is unavailable. Please try again." /></div>;
  if (!auth.data) return <div className="page-frame p-5 md:p-8"><UnauthorizedState /></div>;
  if (projects.isLoading) return <div className="page-frame p-5 md:p-8"><LoadingState label="Loading your books" /></div>;
  if (projects.isError) return <div className="page-frame p-5 md:p-8"><ErrorState message="Your books could not be loaded." /></div>;

  const projectList = projects.data ?? [];
  const activeProject = projectList.find((project) => project.id === projectId) ?? projectList[0];
  const projectHref = (suffix: string) => activeProject ? `/projects/${activeProject.id}/${suffix}` : "/projects";
  const currentPath = typeof window !== "undefined" ? window.location.pathname : "";

  return (
    <div className="page-frame flex min-h-screen flex-col md:flex-row">
      <aside className="flex w-full shrink-0 flex-col border-b border-[var(--line)] bg-[rgba(255,253,248,.90)] px-5 py-5 md:min-h-screen md:w-[240px] md:border-b-0 md:border-r md:px-5 md:py-7">

        {/* Brand */}
        <Link href="/projects" className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-[var(--navy)] text-white shadow-[0_6px_14px_rgba(32,51,72,.18)]"><BookOpen size={17} /></span>
          <span>
            <span className="serif block text-[16px] font-semibold leading-tight text-[var(--ink)]">KDP Book Studio</span>
            <span className="mono block pt-0.5 text-[8px] uppercase tracking-[0.18em] text-[var(--muted-ink)]">Children’s Books</span>
          </span>
        </Link>

        {/* Project switcher */}
        <div className="mt-7 rounded-2xl border border-[var(--line)] bg-[#f1eee6] p-3">
          <p className="mono px-1 text-[9px] uppercase tracking-[0.18em] text-[var(--muted-ink)]">Active book</p>
          <div className="relative mt-2">
            <select
              aria-label="Switch book"
              value={activeProject?.id ?? ""}
              onChange={(event) => navigate(`/projects/${event.target.value}/book-brief`)}
              className="w-full appearance-none rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-3 py-2 pr-8 text-sm font-semibold text-[var(--ink)] outline-none hover:border-[#cfc8ba]"
            >
              {projectList.length ? projectList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>) : <option value="">No books yet</option>}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 text-[var(--muted-ink)]" size={14} />
          </div>
          <Link href="/projects" className="mt-2.5 flex items-center gap-1.5 px-1 text-xs font-semibold text-[var(--coral)] hover:text-[#c95d4d]"><Plus size={13} /> New book</Link>
        </div>

        {/* Step nav */}
        {projectId ? (
          <nav className="mt-6 flex-1" aria-label="Book creation steps">
            <p className="mono mb-3 px-2 text-[8px] uppercase tracking-[0.2em] text-[var(--muted-ink)]">Steps</p>
            <div className="space-y-0.5">
              {steps.map((item) => {
                const href = projectHref(item.suffix);
                const isActive = Boolean(projectId && currentPath === href);
                return (
                  <Link
                    key={item.suffix}
                    href={href}
                    aria-current={isActive ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${isActive ? "bg-[var(--navy)] text-white shadow-[0_4px_14px_rgba(32,51,72,.15)]" : "text-[var(--muted-ink)] hover:bg-[#eeeae0] hover:text-[var(--ink)]"}`}
                  >
                    <span className={`mono shrink-0 text-[10px] ${isActive ? "text-[#b7d2c5]" : "text-[#c0c8d0]"}`}>{item.step}</span>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </nav>
        ) : (
          <div className="mt-6 flex-1">
            <Link
              href="/projects"
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium ${!projectId ? "bg-[var(--navy)] text-white shadow-[0_4px_14px_rgba(32,51,72,.15)]" : "text-[var(--muted-ink)]"}`}
            >
              <span className="mono shrink-0 text-[10px] text-[#b7d2c5]">00</span>
              My Books
            </Link>
          </div>
        )}

        {/* User */}
        <div className="mt-6 border-t border-[var(--line)] pt-5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--mint)] text-xs font-bold text-[var(--navy)]">{auth.data.name.slice(0, 1).toUpperCase()}</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-[var(--ink)]">{auth.data.name}</p>
              <p className="truncate text-[11px] text-[var(--muted-ink)]">{auth.data.email ?? "Creator"}</p>
            </div>
            <button aria-label="Sign out" onClick={() => logout.mutate()} disabled={logout.isPending} className="rounded-lg p-1.5 text-[var(--muted-ink)] hover:bg-[#eeeae0] hover:text-[var(--coral)]"><LogOut size={15} /></button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-5 py-6 md:px-10 md:py-9 lg:px-14">{children}</main>
    </div>
  );
}
