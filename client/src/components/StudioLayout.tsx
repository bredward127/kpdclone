import { BookOpen, ChevronDown, LogOut, Plus, Settings2 } from "lucide-react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { ErrorState, LoadingState, UnauthorizedState } from "./States";

const navItems = [
  { label: "Projects", href: "/projects", icon: "01" },
  { label: "Book Brief", suffix: "book-brief", icon: "02" },
  { label: "Blueprint", suffix: "blueprint", icon: "03" },
  { label: "Page Studio", suffix: "page-studio", icon: "04" },
  { label: "Cover Desk", suffix: "cover-desk", icon: "05" },
  { label: "Validation", suffix: "validation", icon: "06" },
  { label: "Exports", suffix: "exports", icon: "07" },
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

  if (auth.isLoading) return <div className="page-frame p-5 md:p-8"><LoadingState label="Opening your private studio" /></div>;
  if (auth.isError) return <div className="page-frame p-5 md:p-8"><ErrorState message="The authentication service is unavailable. Please try again." /></div>;
  if (!auth.data) return <div className="page-frame p-5 md:p-8"><UnauthorizedState /></div>;
  if (projects.isLoading) return <div className="page-frame p-5 md:p-8"><LoadingState label="Loading your project shelf" /></div>;
  if (projects.isError) return <div className="page-frame p-5 md:p-8"><ErrorState message="Your project shelf could not be loaded." /></div>;

  const projectList = projects.data ?? [];
  const activeProject = projectList.find((project) => project.id === projectId) ?? projectList[0];
  const projectHref = (suffix: string) => activeProject ? `/projects/${activeProject.id}/${suffix}` : "/projects";

  return (
    <div className="page-frame flex min-h-screen flex-col md:flex-row">
      <aside className="flex w-full shrink-0 flex-col border-b border-[var(--line)] bg-[rgba(255,253,248,.78)] px-5 py-5 md:min-h-screen md:w-[270px] md:border-b-0 md:border-r md:px-6 md:py-7">
        <div className="flex items-center justify-between gap-4 md:block">
          <Link href="/projects" className="group flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[var(--navy)] text-white shadow-[0_8px_18px_rgba(32,51,72,.15)]"><BookOpen size={19} /></span>
            <span>
              <span className="serif block text-[18px] font-semibold leading-tight text-[var(--ink)]">Maker’s Ledger</span>
              <span className="mono block pt-1 text-[9px] uppercase tracking-[0.17em] text-[var(--muted-ink)]">KDP Kids Book Studio</span>
            </span>
          </Link>
          <button aria-label="Studio settings" className="rounded-full p-2 text-[var(--muted-ink)] hover:bg-[#eeeae0] md:absolute md:ml-[196px] md:mt-[-42px]"><Settings2 size={17} /></button>
        </div>

        <div className="mt-8 rounded-2xl border border-[var(--line)] bg-[#f1eee6] p-3">
          <p className="mono px-1 text-[9px] uppercase tracking-[0.18em] text-[var(--muted-ink)]">Current project</p>
          <div className="relative mt-2">
            <select
              aria-label="Switch project"
              value={activeProject?.id ?? ""}
              onChange={(event) => navigate(`/projects/${event.target.value}/book-brief`)}
              className="w-full appearance-none rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-3 py-2.5 pr-8 text-sm font-semibold text-[var(--ink)] outline-none hover:border-[#cfc8ba]"
            >
              {projectList.length ? projectList.map((project) => <option key={project.id} value={project.id}>{project.name}</option>) : <option value="">No projects yet</option>}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-3 text-[var(--muted-ink)]" size={15} />
          </div>
          <Link href="/projects" className="mt-3 flex items-center gap-2 px-1 text-xs font-semibold text-[var(--coral)] hover:text-[#c95d4d]"><Plus size={14} /> New project</Link>
        </div>

        <nav className="mt-7 grid grid-cols-2 gap-1 md:block md:flex-1" aria-label="Studio sections">
          {navItems.map((item) => {
            const href = item.href ?? projectHref(item.suffix!);
            const isActive = href === "/projects" ? !projectId : Boolean(projectId && window.location.pathname === href);
            return <Link key={item.label} href={href} aria-current={isActive ? "page" : undefined} className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${isActive ? "bg-[var(--navy)] font-semibold text-white shadow-[0_8px_22px_rgba(32,51,72,.12)]" : "text-[var(--muted-ink)] hover:bg-[#eeeae0] hover:text-[var(--ink)]"}`}><span className={`mono text-[10px] ${isActive ? "text-[#b7d2c5]" : "text-[#adb5bf]"}`} aria-hidden="true">{item.icon}</span>{item.label}{isActive ? <span className="sr-only">, current stage</span> : null}</Link>;
          })}
        </nav>

        <div className="mt-6 border-t border-[var(--line)] pt-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--mint)] text-sm font-bold text-[var(--navy)]">{auth.data.name.slice(0, 1).toUpperCase()}</div>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-[var(--ink)]">{auth.data.name}</p><p className="truncate text-xs text-[var(--muted-ink)]">{auth.data.email ?? "Creator account"}</p></div>
            <button aria-label="Sign out" onClick={() => logout.mutate()} disabled={logout.isPending} className="rounded-lg p-2 text-[var(--muted-ink)] hover:bg-[#eeeae0] hover:text-[var(--coral)]"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-5 py-6 md:px-10 md:py-9 lg:px-14">{children}</main>
    </div>
  );
}
