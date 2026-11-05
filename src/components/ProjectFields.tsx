import type { StyleSheet } from "@/lib/ai/types";

export interface ProjectDefaults {
  title?: string;
  authorName?: string;
  genre?: string;
  isFiction?: boolean;
  language?: string;
  manuscriptState?: string;
  targetFormats?: string[];
  editingMode?: string;
  intensity?: string;
}

export function BookFields({ d }: { d: ProjectDefaults }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <label className="label" htmlFor="title">Book title</label>
        <input id="title" name="title" className="input" defaultValue={d.title} required />
      </div>
      <div>
        <label className="label" htmlFor="authorName">Author or pen name</label>
        <input id="authorName" name="authorName" className="input" defaultValue={d.authorName} required />
      </div>
      <div>
        <label className="label" htmlFor="genre">Genre</label>
        <input id="genre" name="genre" className="input" defaultValue={d.genre} placeholder="e.g. Urban fiction, Fantasy, Memoir" />
      </div>
      <div>
        <label className="label" htmlFor="isFiction">Fiction or nonfiction</label>
        <select id="isFiction" name="isFiction" className="input" defaultValue={d.isFiction === false ? "nonfiction" : "fiction"}>
          <option value="fiction">Fiction</option>
          <option value="nonfiction">Nonfiction</option>
        </select>
      </div>
      <div>
        <label className="label" htmlFor="language">Language</label>
        <select id="language" name="language" className="input" defaultValue={d.language ?? "en-US"}>
          <option value="en-US">English (US)</option>
          <option value="en-GB">English (UK)</option>
          <option value="en">English (other)</option>
        </select>
      </div>
      <div>
        <label className="label" htmlFor="manuscriptState">Manuscript status</label>
        <select id="manuscriptState" name="manuscriptState" className="input" defaultValue={d.manuscriptState ?? "complete"}>
          <option value="complete">Complete draft</option>
          <option value="partial">Work in progress (partial)</option>
          <option value="revision">Revised manuscript</option>
          <option value="republish">Previously published, updating</option>
        </select>
      </div>
      <fieldset>
        <legend className="label">Planned formats</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {[["kindle", "Kindle ebook"], ["paperback", "Paperback"], ["hardcover", "Hardcover"]].map(([v, l]) => (
            <label key={v} className="flex items-center gap-2">
              <input type="checkbox" name="targetFormats" value={v} defaultChecked={(d.targetFormats ?? ["kindle", "paperback"]).includes(v)} /> {l}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

export function EditingFields({ d, stacked = false }: { d: ProjectDefaults; stacked?: boolean }) {
  return (
    <div className={stacked ? "grid gap-4" : "grid gap-4 md:grid-cols-2"}>
      <div>
        <label className="label" htmlFor="editingMode">Editing level</label>
        <select id="editingMode" name="editingMode" className="input" defaultValue={d.editingMode ?? "COPYEDIT"}>
          <option value="PROOFREAD">Proofreading: spelling, grammar, punctuation</option>
          <option value="COPYEDIT">Copyediting: plus clarity, consistency, word choice</option>
          <option value="LINE_EDIT">Line editing: rhythm, flow, impact</option>
          <option value="DEVELOPMENTAL">Developmental review: story-level notes</option>
        </select>
      </div>
      <div>
        <label className="label" htmlFor="intensity">Intensity</label>
        <select id="intensity" name="intensity" className="input" defaultValue={d.intensity ?? "STANDARD"}>
          <option value="LIGHT">Light: obvious issues only</option>
          <option value="STANDARD">Standard: professional, conservative</option>
          <option value="INTENSIVE">Intensive: more detailed suggestions</option>
        </select>
      </div>
    </div>
  );
}

export function StyleFields({ s }: { s: StyleSheet }) {
  const text = (name: keyof StyleSheet, label: string, placeholder = "") => (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input id={name} name={name} className="input" defaultValue={(s[name] as string) ?? ""} placeholder={placeholder} />
    </div>
  );
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="preserveVoice" defaultChecked={s.preserveVoice !== false} /> Preserve my original voice</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="preserveDialect" defaultChecked={s.preserveDialect !== false} /> Preserve dialect and slang</label>
      <div>
        <label className="label" htmlFor="englishVariant">Spelling</label>
        <select id="englishVariant" name="englishVariant" className="input" defaultValue={s.englishVariant ?? "american"}>
          <option value="american">American English</option>
          <option value="british">British English</option>
        </select>
      </div>
      <div>
        <label className="label" htmlFor="serialComma">Serial (Oxford) comma</label>
        <select id="serialComma" name="serialComma" className="input" defaultValue={s.serialComma ?? "author"}>
          <option value="author">Follow what I already do</option>
          <option value="always">Always use it</option>
          <option value="never">Never use it</option>
        </select>
      </div>
      {text("dialogueStyle", "Dialogue style", "e.g. double curly quotes, em dash for interruptions")}
      {text("pov", "Point of view", "e.g. first person, Dre")}
      {text("tense", "Tense", "e.g. past tense")}
      {text("flashbackFormatting", "Flashbacks", "e.g. italicised, past perfect entry")}
      {text("sceneBreakStyle", "Scene breaks", "e.g. * * *")}
      {text("chapterHeadingStyle", "Chapter headings", "e.g. Chapter One")}
      {text("emphasisPreference", "Italics and emphasis", "e.g. italics for thoughts and texts")}
      <div className="md:col-span-2">
        <label className="label" htmlFor="protectedTerms">Words and phrases that must never change</label>
        <textarea id="protectedTerms" name="protectedTerms" rows={3} className="input" defaultValue={(s.protectedTerms ?? []).join("\n")} placeholder="One per line: character names, invented words, slang you use on purpose" />
      </div>
      <div className="md:col-span-2">
        <label className="label" htmlFor="notes">Anything else your editor should know</label>
        <textarea id="notes" name="notes" rows={3} className="input" defaultValue={s.notes ?? ""} />
      </div>
    </div>
  );
}
