import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, Clock, Info, Loader2, PenLine, Save, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";

const fields = [
  ["briefText", "Story summary", "Describe what happens from beginning to end. Include the emotional journey, the lesson or purpose, and anything the reader must understand.", "A gentle story about a kitten who learns to ask for help while exploring a rainy garden."],
  ["bookType", "Book type", "Choose the kind of book you are making. This affects planning and print expectations.", "Children's picture book"],
  ["audience", "Intended reader", "Enter the reader's age range, reading level, interests, and any accessibility considerations.", "Ages 4–8; read-aloud friendly; short sentences."],
  ["visualStyleAnchors", "Visual style anchors", "Describe the look that should stay consistent on every page: line quality, color, lighting, texture, composition, and mood.", "Warm watercolor, rounded shapes, soft daylight, uncluttered backgrounds, gentle expressions."],
  ["characterBible", "Character bible", "Describe each recurring character so the same character can be recreated consistently. Include colors, clothing, proportions, personality, and important distinguishing features.", "Milo is a small orange kitten with a blue collar, white paws, and a curious but cautious personality."],
  ["propAndSettingBible", "Recurring props & settings", "Describe every object and location that appears on more than one page: shape, size, material, color, and where it sits. This text is repeated into every page prompt, so anything pinned here is drawn the same way each time. Leave it blank and each page will invent its own version.", "The nightstand is a short two-drawer pine box with round wooden knobs. On it sits a round brass alarm clock with two bells on top and black hands."],
  ["negativePrompt", "Things to avoid", "List constraints that should never appear, such as logos, readable text inside art, extra limbs, unsafe content, or visual styles you do not want.", "No logos, no readable text in illustrations, no extra characters, no scary faces, no imitation of a living artist."],
] as const;

type FormState = Record<(typeof fields)[number][0], string>;
const emptyForm: FormState = { briefText: "", bookType: "Children's picture book", audience: "", visualStyleAnchors: "", characterBible: "", propAndSettingBible: "", negativePrompt: "" };

function briefFromData(data: { briefText: string; bookType: string; audience: string; visualStyleAnchors: string; characterBible: string; propAndSettingBible: string | null; negativePrompt: string }): FormState {
  return { briefText: data.briefText, bookType: data.bookType, audience: data.audience, visualStyleAnchors: data.visualStyleAnchors, characterBible: data.characterBible, propAndSettingBible: data.propAndSettingBible ?? "", negativePrompt: data.negativePrompt };
}

function Help({ text }: { text: string }) { return <span className="group relative inline-flex align-middle"><button type="button" aria-label={`Field information: ${text}`} title={text} className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-[#9aaab3] text-[#52636c] hover:bg-[#e6eef1] focus-visible:bg-[#e6eef1]"><Info size={12} /></button><span role="tooltip" className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 hidden w-64 rounded-xl bg-[#20384e] p-3 text-left text-xs font-normal leading-5 text-white shadow-xl group-hover:block group-focus-within:block">{text}</span></span>; }

export default function BookBriefEditor({ projectId }: { projectId: string }) {
  const brief = trpc.studio.brief.get.useQuery({ projectId });
  const generations = trpc.studio.brief.listGenerations.useQuery({ projectId });
  const project = trpc.project.get.useQuery({ projectId });
  const updateProject = trpc.project.update.useMutation();
  const utils = trpc.useUtils();
  const coloringBook = project.data?.interiorArtStyle === "coloring_line_art";
  const [idea, setIdea] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState("");
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Only reset the form from the server when the form is NOT dirty.
  // This prevents a background refetch from wiping unsaved AI-generated content.
  useEffect(() => {
    if (brief.data && !dirtyRef.current) {
      setForm(briefFromData(brief.data));
      setDirty(false);
    }
  }, [brief.data]);

  const draftBrief = trpc.studio.brief.draftBriefWithAi.useMutation();
  const fillWithAi = () => {
    if (!idea.trim()) { setNotice("Describe the book in a sentence first, then let the AI fill the fields."); return; }
    setNotice("");
    draftBrief.mutate({ projectId, idea: idea.trim() }, {
      onSuccess: (draft) => {
        setForm((current) => ({ ...current, ...draft }));
        setDirty(true);
        setNotice("All six fields filled from your idea. Edit anything you want, then save — nothing is saved until you do.");
        void generations.refetch();
      },
      onError: (error) => setNotice(error.message),
    });
  };

  const applyGeneration = (gen: NonNullable<typeof generations.data>[number]) => {
    setForm((current) => ({
      ...current,
      briefText: gen.briefText,
      audience: gen.audience,
      visualStyleAnchors: gen.visualStyleAnchors,
      characterBible: gen.characterBible,
      propAndSettingBible: gen.propAndSettingBible,
      negativePrompt: gen.negativePrompt,
    }));
    setDirty(true);
    setNotice(`Restored generation from ${new Date(gen.createdAt).toLocaleString()}. Review the fields and save when ready.`);
  };

  const setInteriorArtStyle = (style: "full_color" | "coloring_line_art") => {
    updateProject.mutate({ projectId, interiorArtStyle: style }, {
      onSuccess: async () => { await Promise.all([utils.project.get.invalidate({ projectId }), project.refetch()]); setNotice(style === "coloring_line_art" ? "Interior set to coloring pages. Every page prompt now asks for black line art to be coloured in." : "Interior set to full colour illustration."); },
      onError: (error) => setNotice(error.message),
    });
  };
  const save = trpc.studio.brief.save.useMutation();
  const update = (key: keyof FormState, value: string) => { setForm((current) => ({ ...current, [key]: value })); setDirty(true); setNotice(""); };
  const saveDraft = () => { setNotice(""); save.mutate({ projectId, ...form }, { onSuccess: (result) => { setDirty(false); setNotice(`Draft version ${result.version} saved securely at ${new Date(result.updatedAt).toLocaleTimeString()}.`); }, onError: (error) => setNotice(error.message) }); };

  if (brief.isLoading) return <p className="rounded-2xl bg-[#fbfaf5] p-6 text-sm text-[var(--muted-ink)]">Loading your story details…</p>;
  if (brief.isError) return <p className="rounded-2xl bg-[#fff0eb] p-6 text-sm text-[#7f433a]">Your story details could not be loaded. Try refreshing the page.</p>;

  const genList = generations.data ?? [];

  return (
    <section className="space-y-5">

      {/* AI Quick Fill — hero action */}
      <div className="rounded-[24px] border-2 border-[var(--coral)] bg-[#fff8f5] p-5 md:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--coral)] text-white"><Sparkles size={17} /></span>
          <div className="flex-1">
            <p className="font-semibold text-[var(--ink)]">Let AI write your story details</p>
            <p className="mt-1 text-sm text-[var(--muted-ink)]">Describe your book idea in one sentence. The AI fills in the characters, setting, art style, and everything else. You can edit anything after.</p>
          </div>
          <span className="shrink-0 rounded-full bg-[#e9f2ed] px-2.5 py-1 text-[10px] font-semibold text-[#356b63]">{dirty ? "Unsaved" : brief.data ? `v${brief.data.version} saved` : "New"}</span>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="min-w-[220px] flex-1 text-sm font-semibold text-[var(--ink)]">
            <span className="sr-only">Your idea</span>
            <input
              value={idea}
              onChange={(event) => setIdea(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); fillWithAi(); } }}
              placeholder="A shy raccoon who learns to ask for help, in a moonlit forest…"
              className="field mt-1"
            />
          </label>
          <button
            type="button"
            onClick={fillWithAi}
            disabled={draftBrief.isPending}
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[var(--coral)] px-5 py-3 text-sm font-semibold text-white hover:bg-[#c95d4d] disabled:opacity-50"
          >
            {draftBrief.isPending ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {draftBrief.isPending ? "Writing…" : "Fill with AI"}
          </button>
        </div>

        {/* Past generations recall */}
        {genList.length > 0 && (
          <div className="mt-4 border-t border-[#f0d9d2] pt-4">
            <div className="flex items-center gap-2">
              <Clock size={13} className="shrink-0 text-[var(--coral)]" />
              <p className="text-xs font-semibold text-[var(--ink)]">Recall a past AI generation</p>
            </div>
            <p className="mt-0.5 text-xs text-[var(--muted-ink)]">Each time you click "Fill with AI" the result is saved here. Pick one to restore those fields — you can still edit before saving.</p>
            <div className="relative mt-2">
              <select
                defaultValue=""
                onChange={(event) => {
                  const gen = genList.find((g) => g.id === event.target.value);
                  if (gen) { applyGeneration(gen); event.target.value = ""; }
                }}
                className="w-full appearance-none rounded-xl border border-[#f0d9d2] bg-white py-2 pl-3 pr-8 text-sm text-[var(--ink)] outline-none hover:border-[var(--coral)] focus:border-[var(--coral)]"
              >
                <option value="" disabled>Choose a past generation to restore…</option>
                {genList.map((gen) => (
                  <option key={gen.id} value={gen.id}>
                    {new Date(gen.createdAt).toLocaleString()} — {gen.idea.length > 60 ? gen.idea.slice(0, 60) + "…" : gen.idea}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 text-[var(--coral)]" size={14} />
            </div>
          </div>
        )}
      </div>

      {/* Book type */}
      <div className="rounded-[24px] border border-[var(--line)] bg-[var(--paper-strong)] p-5 md:p-6">
        <p className="text-sm font-semibold text-[var(--ink)]">What kind of book is this?</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {([["full_color", "Story book", "Full-colour illustrated pages — great for picture books and bedtime stories."], ["coloring_line_art", "Coloring book", "Black line art on every page, ready to be coloured in."]] as const).map(([value, label, description]) => (
            <label key={value} className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${(value === "coloring_line_art") === coloringBook ? "border-[var(--navy)] bg-[#eef4f7]" : "border-[var(--line)] bg-transparent hover:border-[#ccc5b3]"}`}>
              <input type="radio" name="interiorArtStyle" checked={(value === "coloring_line_art") === coloringBook} onChange={() => setInteriorArtStyle(value)} disabled={updateProject.isPending || project.isLoading} className="mt-1 h-4 w-4 accent-[#203348]" />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-[var(--ink)]">{value === "coloring_line_art" ? <PenLine size={14} /> : null}{label}</span>
                <span className="mt-0.5 block text-xs leading-5 text-[var(--muted-ink)]">{description}</span>
              </span>
            </label>
          ))}
        </div>

        <p className="mt-5 text-sm font-semibold text-[var(--ink)]">Image quality</p>
        <p className="mt-0.5 text-xs text-[var(--muted-ink)]">Higher quality = better-looking images but costs more per page. Coloring books look great on Low.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {([["low", "Low — ~$0.009/image", "Best for coloring books."], ["medium", "Medium — ~$0.034/image", "Good for picture books."], ["high", "High — ~$0.133/image", "For detailed illustration."]] as const).map(([value, label, description]) => (
            <label key={value} className={`flex cursor-pointer gap-2 rounded-xl border p-3 ${(project.data?.imageQuality ?? "low") === value ? "border-[var(--navy)] bg-[#eef4f7]" : "border-[var(--line)] hover:border-[#ccc5b3]"}`}>
              <input type="radio" name="imageQuality" checked={(project.data?.imageQuality ?? "low") === value} onChange={() => updateProject.mutate({ projectId, imageQuality: value }, { onSuccess: async () => { await Promise.all([utils.project.get.invalidate({ projectId }), project.refetch()]); setNotice(`Quality set to ${label.split("—")[0].trim().toLowerCase()}.`); }, onError: (error) => setNotice(error.message) })} disabled={updateProject.isPending || project.isLoading} className="mt-0.5 h-4 w-4 accent-[#203348]" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-[var(--ink)]">{label}</span>
                <span className="mt-0.5 block text-[11px] leading-4 text-[var(--muted-ink)]">{description}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Story fields */}
      <div className="rounded-[24px] border border-[var(--line)] bg-[var(--paper-strong)] p-5 md:p-6">
        <p className="text-sm font-semibold text-[var(--ink)]">Story details</p>
        <p className="mt-1 text-xs text-[var(--muted-ink)]">These details are remembered across every page so your images stay consistent. Use AI to fill them all at once, or write them yourself.</p>
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          {fields.map(([key, label, help, placeholder]) => (
            <label
              key={key}
              className={`${key === "briefText" || key === "visualStyleAnchors" || key === "characterBible" || key === "propAndSettingBible" || key === "negativePrompt" ? "md:col-span-2" : ""} block text-sm font-semibold text-[var(--ink)]`}
            >
              <span className="inline-flex items-center">{label}<Help text={help} /></span>
              {key === "bookType" || key === "audience"
                ? <input value={form[key]} placeholder={placeholder} onChange={(event) => update(key, event.target.value)} className="field mt-2" />
                : <textarea value={form[key]} placeholder={placeholder} onChange={(event) => update(key, event.target.value)} className="field mt-2 min-h-28" rows={key === "briefText" ? 5 : 4} />
              }
            </label>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={saveDraft}
            disabled={save.isPending || !dirty}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--navy)] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save size={16} />{save.isPending ? "Saving…" : "Save"}
          </button>
          {!dirty && brief.data
            ? <span className="inline-flex items-center gap-2 text-sm text-[#356b63]"><CheckCircle2 size={15} />Saved</span>
            : <span className="text-xs text-[var(--muted-ink)]">Changes are not saved until you press Save.</span>
          }
          {notice ? <p className="w-full text-sm text-[#356b63]" role="status">{notice}</p> : null}
        </div>
      </div>
    </section>
  );
}
