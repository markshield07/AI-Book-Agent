// Sample manuscripts for manual audits: a short novel with deliberate typos, grammar slips,
// continuity errors (eye colour, name spelling, timeline), dialect, italics and scene breaks.
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

type Run = string | { t: string; i?: boolean; b?: boolean };
const book: { title: string; author: string; front: string[]; chapters: { title: string; paras: Run[][] }[] } = {
  title: "The Lighthouse at Gull's End",
  author: "M. Shield",
  front: ["For everyone who ever waited for a light to come back on."],
  chapters: [
    {
      title: "Chapter One: The Keeper's Daughter",
      paras: [
        ["Nora Kettering had lived at Gull's End for all twelve years of her life, and in all that time the lighthouse had never once gone dark. Not during the storm of '89, when the waves came over the sea wall and took the Pruitts' boathouse clean off its pilings. Not the winter her mother left. Not ever."],
        ["So when she woke at two in the morning and the beam wasn't sweeping across her ceiling, she knew something was wrong before she even opened her eyes."],
        ["She lay still and listened. The wind was doing it's usual business against the shutters. The clock in the hall ticked. Down below, the sea breathed in and out against the rocks like a sleeping animal. But the light — the steady, patient light that had crossed her ceiling every eleven seconds for as long as she could remember — was gone."],
        ["“Dad?” she whispered. Nobody answered."],
        ["She pulled on her boots and her fathers old wool coat, the one with the brass buttons, and went down the stairs two at a time. The kitchen was cold. His mug sat on the table, half full, a skin of milk on the coffee. His chair was pushed back like he’d stood up in a hurry."],
        ["Outside, the night was so black she could barely see her own hands. She had grown up on this rock and she knew every step of the path to the tower, but without the beam it felt like walking into the sea itself. She counted the steps out loud, the way he’d taught her when she was small. ", { t: "Forty-one to the gate. Sixty to the tower door.", i: true }],
        ["The tower door was standing open."],
        ["Nora stood at the bottom of the spiral stair and looked up into the dark. A hundred and twelve steps. She had climbed them a thousand times, but never alone, and never at night, and never with the feeling that something at the top was waiting for her."],
        ["“Dad, if this is a joke its not funny,” she called. Her voice went up the stairwell and didn’t come back."],
        ["She started climbing."],
        ["* * *"],
        ["At the top, the lamp room was empty. The great lens sat motionless in its brass cradle, cold to the touch. The log book lay open on the desk where her father, Thomas Kettering, wrote the weather every night in his small, careful hand. The last entry read:"],
        [{ t: "02:00. Wind NW, moderate. Visibility poor. Something on the water. Going down to look.", i: true }],
        ["Below it, in handwriting she didn't recognise, someone had written a single word: ", { t: "Don't.", i: true }],
        ["Nora read it three times. Then she looked out through the salt-streaked glass at the black water, where far out past the reef, something was glowing a soft and impossible green."],
      ],
    },
    {
      title: "Chapter Two: Old Bill",
      paras: [
        ["By morning the coast guard had come and gone. They walked the rocks and the beach with their yellow jackets and their radios, and a woman with kind tired eyes asked Nora the same questions four different ways. Did her father drink. Did he have money troubles. Had he been acting strange."],
        ["“He wasn't acting strange,” Nora said. “He was acting like him. He doesn’t leave. He’s never left.”"],
        ["The woman wrote something down and didn't look up. Nora hated her a little for that."],
        ["They couldn't leave a twelve-year-old alone on a rock in the middle of the sea, so they called the only person on the island who was listed as family, which was how Nora ended up sitting in Old Bill Pruitt's kitchen at noon eating soup she didn’t want."],
        ["Bill wasn't really family. He was her father's godfather, or her grandfather's friend, or something in between that nobody had ever explained proper. He was older than anyone she knew, with hands like driftwood and eyes the colour of a winter sky — pale, pale grey. He smelled of pipe smoke and engine oil, and he had not said one word since the coast guard boat pulled away."],
        ["“Ain't no use in looking at me like that,” he said finally. “I don't know where he's gone no more'n you do.”"],
        ["“You know something,” Nora said. “You keep looking at the window.”"],
        ["Bill set his spoon down. Outside the window the sea was flat and silver and ordinary, as if nothing in the world had ever gone wrong on it."],
        ["“Your great-grandmother saw a green light once,” he said. “Out past the reef. Nineteen and twenty-six. She told my mother about it, and my mother told me, and I'm telling you, cause somebody ought to.”"],
        ["“What happened to her?”"],
        ["Bill was quiet for a long time. “She went to look,” he said."],
        ["* * *"],
        ["That night Nora couldn't sleep in Bill's spare room, which smelled of mothballs and had a picture of a sad-looking horse on the wall. She lay on top of the covers in her clothes and watched the dark window. At half past one she got up, and went to the window, and looked out towards Gull's End."],
        ["The lighthouse was still dark. Somebody was supposed to come from the mainland tomorrow to fix it. But out past the reef, faint and steady, the green light was burning again, and between her and it, cutting across the black water, was a small white wake, like a boat was moving out toward it with no lights on."],
        ["Nora grabbed her coat. She was halfway down the stairs before she realized Bill was sitting in the dark kitchen, fully dressed, with his boots on and a lantern on the table in front of him."],
        ["“Figured,” he said. His eyes, in the lantern light, were a deep and steady brown. “Well. Come on, then. If we're going we'd best go now, before I think better of it.”"],
      ],
    },
    {
      title: "Chapter Three: Past the Reef",
      paras: [
        ["Bill's boat was called the ", { t: "Margaret Ann", i: true }, " and it was older than he was, which Nora hadn't thought possible. It coughed twice and then caught, and the engine settled into a low uneven grumble that she could feel in her teeth."],
        ["They went out without lights. Bill said that whoever was out there had gone dark, and he didn't intend to announce himself to nobody. Nora sat in the bow with her hands jammed in her pockets and her eyes on the green glow, which got bigger, and brighter, and stranger the closer they came."],
        ["It wasn't a boat light. It wasn't any kind of light Nora had ever seen. It was coming from under the water, a wide pale circle of green that pulsed slowly, like breathing, and in the middle of it the sea was perfectly smooth, even though everywhere else the swell was running and slapping at the hull."],
        ["Floating at the edge of the circle, tied up to nothing at all, was her fathers dinghy."],
        ["“Dad!” Nora was half over the side before Bill caught the back of her coat and hauled her down."],
        ["“Hold on,” he said. “Hold on. Look first. Always look first.”"],
        ["The dinghy was empty. The oars were shipped neatly, the way Tom Kettering always left them. On the seat was his torch, still switched on, its beam pointing straight down into the green."],
        ["Bill brought the ", { t: "Margaret Ann", i: true }, " alongside and Nora leaned over, and looked down, and for a long moment neither of them said anything at all."],
        ["There were stairs under the water. Stone stairs, white and smooth and old, going down and down into the green light, further than she could see. And on the third step, just under the surface, sat a pair of boots she would have known anywhere — brown leather, the left heel worn crooked, the laces tied in a double knot because that was the only way her father ever tied anything."],
        ["“Bill,” she said. “Bill, what is this place?”"],
        ["The old man took off his cap and held it in both hands, the way people do at funerals. “Your great-grandmother called it the Undertow,” he said quietly. “And she said whatever goes down them stairs don't come back up the same.”"],
        ["Nora looked at the boots. She looked at the stairs. She thought of the log book, and the strange handwriting, and the single word. ", { t: "Don't.", i: true }],
        ["Then she started unlacing her own boots."],
      ],
    },
  ],
};

const plain = (r: Run) => (typeof r === "string" ? r : r.t);
const md = (r: Run) => (typeof r === "string" ? r : r.i ? `*${r.t}*` : r.b ? `**${r.t}**` : r.t);

export async function writeSamples(dir: string) {
  mkdirSync(dir, { recursive: true });
  const children: Paragraph[] = [
    new Paragraph({ style: "Title", children: [new TextRun(book.title)] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun(`by ${book.author}`)] }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Dedication")] }),
    ...book.front.map((t) => new Paragraph({ children: [new TextRun({ text: t, italics: true })] })),
  ];
  for (const ch of book.chapters) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(ch.title)] }));
    for (const p of ch.paras) children.push(new Paragraph({ children: p.map((r) => (typeof r === "string" ? new TextRun(r) : new TextRun({ text: r.t, italics: r.i, bold: r.b }))) }));
  }
  writeFileSync(path.join(dir, "lighthouse.docx"), await Packer.toBuffer(new Document({ sections: [{ children }] })));
  writeFileSync(path.join(dir, "lighthouse.txt"), [book.title, "", ...book.chapters.flatMap((c) => [c.title, "", ...c.paras.map((p) => p.map(plain).join("")).flatMap((x) => [x, ""])])].join("\n"));
  writeFileSync(path.join(dir, "lighthouse.md"), [`# ${book.title}`, "", ...book.chapters.flatMap((c) => [`## ${c.title}`, "", ...c.paras.map((p) => p.map(md).join("")).flatMap((x) => [x, ""])])].join("\n"));
}

if (process.argv[1]?.endsWith("make-samples.ts")) writeSamples(process.argv[2] || "tests/samples/out").then(() => console.log("samples written"));
