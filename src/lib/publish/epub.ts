// Kindle ebook: a reflowable EPUB 3 built from the publication model. Semantic headings,
// em-based CSS, a navigable table of contents (nav.xhtml plus toc.ncx for older readers),
// italics as <em>, line breaks as <br/>, and no print page numbers anywhere.
import JSZip from "jszip";
import crypto from "node:crypto";
import { XMLValidator } from "fast-xml-parser";
import type { Book, Block, Run, Section } from "./book";
import { templateFor, splitChapterTitle, type BookTemplate } from "./templates";
import { isValidIsbn } from "./settings";
import type { ReadinessCheck } from "./checks";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function runsHtml(runs: Run[]): string {
  return runs
    .map((r) => {
      let h = r.text.split("\n").map(esc).join("<br/>");
      if (r.italic) h = `<em>${h}</em>`;
      if (r.bold) h = `<strong>${h}</strong>`;
      return h;
    })
    .join("");
}

export const EBOOK_SCENE_BREAK = "* * *";

function blockHtml(b: Block): string {
  switch (b.type) {
    case "scene":
      return `<p class="scene" role="separator" aria-label="Scene break">${EBOOK_SCENE_BREAK}</p>`;
    case "subhead":
      return `<h2>${runsHtml(b.runs)}</h2>`;
    case "quote":
      return `<blockquote><p>${runsHtml(b.runs)}</p></blockquote>`;
    case "display":
      return `<p class="d-${b.size ?? "normal"}${b.align === "left" ? " left" : ""}">${runsHtml(b.runs)}</p>`;
    default:
      return `<p class="${b.first ? "first" : "indent"}${b.align === "center" ? " center" : ""}">${runsHtml(b.runs)}</p>`;
  }
}

function headingHtml(sec: Section, t: BookTemplate): string {
  const { label, name } = splitChapterTitle(sec.title);
  const cls = sec.role === "part" ? "part" : "chapter";
  if (label) return `<h1 class="${cls}"><span class="label">${esc(label)}</span> <span class="name">${esc(name)}</span></h1>`;
  return `<h1 class="${cls}">${esc(sec.title)}</h1>`;
}

function page(title: string, lang: string, body: string, type?: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${esc(lang)}" lang="${esc(lang)}">
<head>
<meta charset="UTF-8"/>
<title>${esc(title)}</title>
<link rel="stylesheet" type="text/css" href="../styles/book.css"/>
</head>
<body${type ? ` epub:type="${type}"` : ""}>
${body}
</body>
</html>
`;
}

export function ebookCss(t: BookTemplate): string {
  const heading = t.ebook.headingFamily;
  return `/* Reflowable: sizes in em so the reader's text-size setting works. */
body { margin: 0; padding: 0; }
p { margin: 0; text-align: justify; line-height: 1.4; }
p.indent { text-indent: ${t.ebook.indent}em; }
p.first { text-indent: 0; }
p.center { text-align: center; text-indent: 0; }
h1 { font-family: ${heading}; font-weight: normal; text-align: ${t.chapter.align}; font-size: 1.6em; margin: 2em 0 1.5em 0; page-break-before: always;${t.chapter.uppercase ? " text-transform: uppercase; letter-spacing: 0.1em;" : ""}${t.chapter.italic ? " font-style: italic;" : ""} }
h1 .label { display: block; font-size: 0.55em; text-transform: uppercase; letter-spacing: 0.15em; margin-bottom: 0.5em; font-style: normal; }
h1.part { margin-top: 30%; text-align: center; }
h2 { font-family: ${heading}; font-size: 1.15em; margin: 1.5em 0 0.5em 0; text-align: left;${t.subheading.italic ? " font-style: italic; font-weight: normal;" : ""} }
p.scene { text-align: center; text-indent: 0; margin: 1em 0; }
blockquote { margin: 1em 1.5em; }
blockquote p { text-indent: 0;${t.blockquote.italic ? " font-style: italic;" : ""} }
.titlepage { text-align: center; margin-top: 20%; }
p.d-title { font-family: ${heading}; font-size: 2em; text-align: center; text-indent: 0; margin-bottom: 0.5em; }
p.d-subtitle { font-size: 1.2em; text-align: center; text-indent: 0; margin-bottom: 2em; }
p.d-author { font-size: 1.2em; text-align: center; text-indent: 0; margin-top: 2em; }
p.d-small { font-size: 0.8em; text-align: center; text-indent: 0; margin-bottom: 0.6em; }
p.d-small.left { text-align: left; }
p.d-normal { text-align: center; text-indent: 0; margin: 0.5em 0; }
p.d-heading { text-align: center; text-indent: 0; }
.dedication, .epigraph { margin-top: 25%; }
nav ol { list-style-type: none; padding-left: 0; }
nav ol ol { padding-left: 1.5em; }
nav li { margin: 0.4em 0; }
nav a { text-decoration: none; }
`;
}

function uuidFrom(seed: string): string {
  const h = crypto.createHash("sha1").update(`editorial-studio:${seed}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export interface EbookFile {
  id: string;
  href: string; // relative to OEBPS/
  title: string;
  sectionId: string;
  inToc: boolean;
  role: Section["role"];
}

export async function buildEpub(book: Book, opts: { projectId: string; template?: string; isFiction: boolean; modified?: Date }): Promise<{ buf: Buffer; files: EbookFile[] }> {
  const t = templateFor(opts.template, opts.isFiction);
  const lang = book.meta.language;
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`
  );
  const files: EbookFile[] = [];
  let n = 0;
  for (const sec of book.sections) {
    if (sec.role === "half-title") continue; // print convention only
    n++;
    const id = `s${String(n).padStart(3, "0")}`;
    const href = `text/${id}.xhtml`;
    files.push({ id, href, title: sec.title, sectionId: sec.id, inToc: sec.inToc, role: sec.role });
  }

  const tocBody = (): string => {
    let html = "<ol>\n";
    let inPart = false;
    const entries = files.filter((f) => f.inToc);
    entries.forEach((f, i) => {
      if (f.role === "part") {
        if (inPart) html += "</ol></li>\n";
        html += `<li><a href="${f.href.replace(/^text\//, "")}">${esc(f.title)}</a>`;
        const hasChildren = entries[i + 1] && entries[i + 1].role === "chapter";
        if (hasChildren) {
          html += "<ol>\n";
          inPart = true;
        } else html += "</li>\n";
      } else {
        if (inPart && f.role !== "chapter") {
          html += "</ol></li>\n";
          inPart = false;
        }
        html += `<li><a href="${f.href.replace(/^text\//, "")}">${esc(f.title)}</a></li>\n`;
      }
    });
    if (inPart) html += "</ol></li>\n";
    return html + "</ol>";
  };

  for (const f of files) {
    const sec = book.sections.find((s) => s.id === f.sectionId)!;
    let body = "";
    switch (sec.role) {
      case "title":
        body = `<section class="titlepage" epub:type="titlepage">\n${sec.blocks.map(blockHtml).join("\n")}\n</section>`;
        break;
      case "copyright":
        body = `<section epub:type="copyright-page">\n${sec.blocks.map(blockHtml).join("\n")}\n</section>`;
        break;
      case "dedication":
      case "epigraph":
        body = `<section class="${sec.role}" epub:type="${sec.role}">\n${sec.blocks.map(blockHtml).join("\n")}\n</section>`;
        break;
      case "toc":
        body = `<nav id="contents" aria-label="Contents">\n<h1 class="chapter">Contents</h1>\n${tocBody()}\n</nav>`;
        break;
      case "part":
        body = `<section epub:type="part">\n${headingHtml(sec, t)}\n</section>`;
        break;
      default: {
        const type = sec.role === "chapter" ? "chapter" : sec.role === "front" ? "preface" : sec.role === "about-author" ? "backmatter" : "backmatter";
        body = `<section epub:type="${type}">\n${headingHtml(sec, t)}\n${sec.blocks.map(blockHtml).join("\n")}\n</section>`;
      }
    }
    zip.file(`OEBPS/${f.href}`, page(sec.title, lang, body, sec.role === "chapter" ? "bodymatter" : undefined));
  }

  const firstBody = files.find((f) => f.role === "chapter" || f.role === "part") ?? files[0];
  const tocFile = files.find((f) => f.role === "toc");
  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${esc(lang)}" lang="${esc(lang)}">
<head><meta charset="UTF-8"/><title>Contents</title><link rel="stylesheet" type="text/css" href="styles/book.css"/></head>
<body>
<nav epub:type="toc" id="toc" role="doc-toc">
<h1>Contents</h1>
${tocBody().replace(/href="/g, 'href="text/')}
</nav>
<nav epub:type="landmarks" id="landmarks" hidden="hidden">
<h2>Landmarks</h2>
<ol>
${tocFile ? `<li><a epub:type="toc" href="${tocFile.href}">Contents</a></li>\n` : ""}<li><a epub:type="bodymatter" href="${firstBody.href}">Start of book</a></li>
</ol>
</nav>
</body>
</html>
`;
  zip.file("OEBPS/nav.xhtml", nav);
  zip.file("OEBPS/styles/book.css", ebookCss(t));

  const isbn = book.meta.isbnEbook && isValidIsbn(book.meta.isbnEbook) ? book.meta.isbnEbook : "";
  const identifier = isbn ? `urn:isbn:${isbn}` : `urn:uuid:${uuidFrom(opts.projectId)}`;
  const modified = (opts.modified ?? new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
  const ncxPoints = files
    .filter((f) => f.inToc)
    .map((f, i) => `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(f.title)}</text></navLabel><content src="${f.href}"/></navPoint>`)
    .join("\n");
  zip.file(
    "OEBPS/toc.ncx",
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${esc(lang)}">
<head><meta name="dtb:uid" content="${esc(identifier)}"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>
<docTitle><text>${esc(book.meta.title)}</text></docTitle>
<navMap>
${ncxPoints}
</navMap>
</ncx>
`
  );
  const manifest = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `<item id="css" href="styles/book.css" media-type="text/css"/>`,
    ...files.map((f) => `<item id="${f.id}" href="${f.href}" media-type="application/xhtml+xml"/>`),
  ].join("\n    ");
  const spine = files.map((f) => `<itemref idref="${f.id}"/>`).join("\n    ");
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${esc(lang)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${esc(identifier)}</dc:identifier>
    <dc:title>${esc(book.meta.title)}</dc:title>
    <dc:creator id="author">${esc(book.meta.author)}</dc:creator>
    <dc:language>${esc(lang)}</dc:language>
    ${book.meta.publisher ? `<dc:publisher>${esc(book.meta.publisher)}</dc:publisher>\n    ` : ""}<meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    ${manifest}
  </manifest>
  <spine toc="ncx">
    ${spine}
  </spine>
</package>
`
  );
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", mimeType: "application/epub+zip" });
  return { buf, files };
}

// ---------------------------------------------------------------- built-in validation

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

/**
 * Structural checks we can run without Java: package layout, XML well-formedness, manifest
 * and spine, navigation, internal links, metadata, empty chapters and leftover artifacts.
 * Official EPUBCheck runs separately when available (see epubcheck.ts).
 */
export async function validateEpub(buf: Buffer, expectedWords?: number): Promise<ReadinessCheck[]> {
  const out: ReadinessCheck[] = [];
  const push = (id: string, label: string, status: ReadinessCheck["status"], detail: string) => out.push({ id, label, status, detail });
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch (e) {
    push("epub.package", "Valid EPUB package", "failed", `The file is not a readable ZIP: ${(e as Error).message}`);
    return out;
  }
  // mimetype must be the first entry, stored uncompressed, with the exact content.
  const raw = buf.subarray(30, 30 + buf.readUInt16LE(26));
  const firstName = raw.toString("latin1");
  const method = buf.readUInt16LE(8);
  const mt = await zip.file("mimetype")?.async("string");
  const pkgProblems: string[] = [];
  if (firstName !== "mimetype") pkgProblems.push("mimetype is not the first file");
  if (method !== 0) pkgProblems.push("mimetype is compressed");
  if (mt !== "application/epub+zip") pkgProblems.push("mimetype content is wrong");
  const container = await zip.file("META-INF/container.xml")?.async("string");
  const opfPath = container?.match(/full-path="([^"]+)"/)?.[1];
  const opf = opfPath ? await zip.file(opfPath)?.async("string") : undefined;
  if (!container) pkgProblems.push("META-INF/container.xml is missing");
  if (!opf) pkgProblems.push("the package document (content.opf) is missing");
  push("epub.package", "Valid EPUB package", pkgProblems.length ? "failed" : "passed", pkgProblems.length ? pkgProblems.join("; ") : "EPUB 3 container, mimetype and package document are in place.");
  if (!opf || !opfPath) return out;
  const base = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

  // XML well-formedness of every XML file
  const bad: string[] = [];
  const xmlFiles = Object.keys(zip.files).filter((n) => /\.(xhtml|opf|ncx|xml)$/.test(n));
  const texts = new Map<string, string>();
  for (const name of xmlFiles) {
    const s = await zip.file(name)!.async("string");
    texts.set(name, s);
    const r = XMLValidator.validate(s);
    if (r !== true) bad.push(`${name}: ${r.err.msg} (line ${r.err.line})`);
  }
  push("epub.xml", "Well-formed HTML and XML", bad.length ? "failed" : "passed", bad.length ? bad.slice(0, 5).join("; ") : `${xmlFiles.length} files checked.`);

  // metadata
  const missingMeta = ["dc:identifier", "dc:title", "dc:language", "dc:creator"].filter((t) => !new RegExp(`<${t}[^>]*>[^<]+</${t}>`).test(opf));
  if (!/property="dcterms:modified">\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ</.test(opf)) missingMeta.push("dcterms:modified");
  push("epub.metadata", "Required metadata", missingMeta.length ? "failed" : "passed", missingMeta.length ? `Missing: ${missingMeta.join(", ")}` : "Title, author, language, identifier and modification date are present.");

  // manifest + spine
  const items = [...opf.matchAll(/<item\s[^>]*>/g)].map((m) => ({ id: attr(m[0], "id")!, href: attr(m[0], "href")!, type: attr(m[0], "media-type")!, props: attr(m[0], "properties") ?? "" }));
  const manifestProblems: string[] = [];
  for (const it of items) if (!zip.file(base + it.href)) manifestProblems.push(`${it.href} is listed but missing`);
  const listed = new Set(items.map((i) => base + i.href));
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name].dir || name === "mimetype" || name.startsWith("META-INF/") || name === opfPath) continue;
    if (!listed.has(name)) manifestProblems.push(`${name} is not in the manifest`);
  }
  const spine = [...opf.matchAll(/<itemref\s[^>]*idref="([^"]+)"/g)].map((m) => m[1]);
  for (const id of spine) if (!items.some((i) => i.id === id)) manifestProblems.push(`spine refers to unknown item ${id}`);
  if (!spine.length) manifestProblems.push("the reading order (spine) is empty");
  push("epub.manifest", "Manifest and reading order", manifestProblems.length ? "failed" : "passed", manifestProblems.length ? manifestProblems.slice(0, 5).join("; ") : `${spine.length} documents in reading order.`);

  // navigation
  const navItem = items.find((i) => i.props.split(/\s+/).includes("nav"));
  const navPath = navItem ? base + navItem.href : "";
  const navDoc = navPath ? texts.get(navPath) : undefined;
  const tocLinks = navDoc?.match(/<nav[^>]*epub:type="toc"[\s\S]*?<\/nav>/)?.[0].match(/href="[^"]+"/g)?.length ?? 0;
  push(
    "epub.nav",
    "Navigable table of contents",
    !navDoc ? "failed" : tocLinks === 0 ? "failed" : "passed",
    !navDoc ? "No navigation document (nav.xhtml) is declared." : tocLinks === 0 ? "The table of contents has no entries." : `${tocLinks} entries in the Kindle "Go to" menu.`
  );

  // links: every href/src inside content documents resolves, including #fragments
  const broken: string[] = [];
  const ids = new Map<string, Set<string>>();
  for (const [name, s] of texts) ids.set(name, new Set([...s.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  for (const [name, s] of texts) {
    if (!name.endsWith(".xhtml") && !name.endsWith(".ncx")) continue;
    const dir = name.slice(0, name.lastIndexOf("/") + 1);
    for (const m of s.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
      const href = m[1];
      if (/^(https?:|mailto:)/.test(href)) continue;
      const [file, frag] = href.split("#");
      const target = file ? normalizePath(dir + decodeURIComponent(file)) : name;
      if (!zip.file(target)) broken.push(`${name} → ${href}`);
      else if (frag && !ids.get(target)?.has(frag)) broken.push(`${name} → ${href} (no such anchor)`);
    }
  }
  push("epub.links", "Internal links and chapter references", broken.length ? "failed" : "passed", broken.length ? broken.slice(0, 5).join("; ") : "Every link points at a file and anchor that exists.");

  // content checks
  const contentDocs = items.filter((i) => i.type === "application/xhtml+xml" && !i.props.includes("nav")).map((i) => texts.get(base + i.href) ?? "");
  const empty = contentDocs.filter((s) => /epub:type="(chapter|preface|backmatter)"/.test(s) && !/<p[\s>]/.test(s.replace(/<h1[\s\S]*?<\/h1>/g, ""))).length;
  push("epub.empty", "Empty chapters", empty ? "warning" : "passed", empty ? `${empty} section${empty === 1 ? " has" : "s have"} a heading but no text.` : "Every chapter has text.");

  const artifacts: string[] = [];
  for (const s of contentDocs) {
    const textOnly = s.replace(/<[^>]+>/g, " ");
    if (/\{already italic|\[\[|\]\]|<<|>>|\bTODO\b|\bTK\b/.test(textOnly)) artifacts.push("editing markers");
    if (/(^|\s)\*[A-Za-z][^*\n]{0,80}\*(\s|[.,;:!?]|$)/.test(textOnly) || /(^|\s)_[A-Za-z][^_\n]{0,80}_(\s|$)/.test(textOnly)) artifacts.push("Markdown-style *emphasis* left as plain text");
    if ([...s.matchAll(/>([^<]+)</g)].some((m) => /\S(?: {3,}|\u00A0{2,})\S|^\u00A0{2,}/.test(m[1]))) artifacts.push("runs of spaces used for layout");
    if (/<style|style="/.test(s)) artifacts.push("inline styles");
    if (/<img(?![^>]*\salt=)/.test(s)) artifacts.push("images without alternative text");
  }
  const uniq = [...new Set(artifacts)];
  push("epub.artifacts", "Formatting artifacts", uniq.length ? "warning" : "passed", uniq.length ? `Found ${uniq.join(", ")}. Check these spots in the preview.` : "No leftover editing marks, fake spacing or inline styles.");

  const images = items.filter((i) => i.type.startsWith("image/")).length;
  push("epub.images", "Image alternative text", images ? "passed" : "not_checked", images ? "All images have alternative text." : "This book has no images.");

  if (expectedWords !== undefined) {
    const words = contentDocs
      .map((s) => s.replace(/<head>[\s\S]*?<\/head>|<h1[\s\S]*?<\/h1>|<nav[\s\S]*?<\/nav>/g, " ").replace(/<\/?(?:em|strong|span|a|b|i)(?:\s[^>]*)?>/g, "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " "))
      .join(" ")
      .match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu)?.length ?? 0;
    push("epub.words", "Every word of the approved text is present", Math.abs(words - expectedWords) === 0 ? "passed" : "failed", `${words.toLocaleString()} words in the ebook; ${expectedWords.toLocaleString()} expected.`);
  }
  return out;
}

function normalizePath(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}
