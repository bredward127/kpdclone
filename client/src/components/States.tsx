import { AlertTriangle, ArrowRight, CircleDashed, LockKeyhole, Sparkles } from "lucide-react";

export function LoadingState({ label = "Loading your studio" }: { label?: string }) {
  return (
    <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 rounded-[28px] border border-[var(--line)] bg-[var(--paper-strong)] p-10 text-center">
      <CircleDashed className="animate-spin text-[var(--coral)]" size={28} />
      <p className="mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted-ink)]">{label}</p>
    </div>
  );
}

export function UnauthorizedState() {
  return (
    <div className="flex min-h-[460px] flex-col items-center justify-center rounded-[28px] border border-[var(--line)] bg-[var(--paper-strong)] p-10 text-center shadow-[0_20px_60px_rgba(32,51,72,.06)]">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--navy)] text-white">
        <LockKeyhole size={24} />
      </div>
      <p className="mono mb-3 text-[11px] uppercase tracking-[0.22em] text-[var(--coral)]">Private studio</p>
      <h2 className="serif text-3xl text-[var(--ink)]">Sign in to enter the workshop.</h2>
      <p className="mt-3 max-w-md text-sm leading-6 text-[var(--muted-ink)]">Your book briefs, references, and project decisions belong to your creator account. Sign in to load your server-backed workspace.</p>
      <a className="mt-7 inline-flex items-center gap-2 rounded-full bg-[var(--coral)] px-5 py-3 text-sm font-semibold text-white hover:bg-[#c95d4d]" href="/auth/test-login">
        Continue to test sign in <ArrowRight size={16} />
      </a>
    </div>
  );
}

export function ErrorState({ message = "We could not load this part of the studio." }: { message?: string }) {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center rounded-[28px] border border-[#edc8c0] bg-[#fff8f5] p-8 text-center">
      <AlertTriangle className="mb-4 text-[var(--coral)]" size={25} />
      <h2 className="serif text-2xl text-[var(--ink)]">A page needs another pass.</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-[var(--muted-ink)]">{message}</p>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center rounded-[28px] border border-dashed border-[var(--line)] bg-[rgba(255,253,248,.7)] p-8 text-center">
      <Sparkles className="mb-4 text-[var(--gold)]" size={25} />
      <h2 className="serif text-2xl text-[var(--ink)]">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-[var(--muted-ink)]">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
