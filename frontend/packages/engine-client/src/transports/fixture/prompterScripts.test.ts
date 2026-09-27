import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JsonObject } from "../../generated/protocol";
import { readHtml } from "./prompterHtml";
import {
  ImportRefused,
  MAX_SCRIPT_TEXT_BYTES,
  importFile,
  importPaste,
  importSentence,
  refusalSentence,
} from "./prompterImport";
import { MAX_IMPORT_BYTES, finishedParagraph, makeRun, paragraphText } from "./prompterModel";
import { fileParams, openPrompterDouble } from "./prompterTestSupport";

// The fixture double's Teleprompter scripts, end to end through the transport (new pages
// program, Slice 4), held to the hardware link's `prompter/tests_scripts.rs` and its
// import's sentences (`prompter/import/mod.rs`): made, renamed, edited, removed,
// restored, deleted for good, their versions, and a script from a paste or a `.txt`.

const NOW = Date.parse("2026-09-27T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

const names = (rows: unknown) => (rows as JsonObject[]).map((row) => row.name);
const texts = (script: JsonObject) =>
  (script.paragraphs as Array<{ runs: Array<{ text: string }> }>).map((paragraph) =>
    paragraph.runs.map((run) => run.text).join("")
  );

describe("the fixture double's prompter scripts", () => {
  // §3.3: sorted by name with numbers in their natural order; New script takes a free name.
  it("sorts the list by name and gives a new script a free name", async () => {
    const { call, refused, snapshot, reasons } = openPrompterDouble();
    for (const name of ["10 Outro", "2 Guest", "01 Intro"]) await call("prompter.script.create", { name });
    expect((await call("prompter.script.create")).name).toBe("New script");
    expect((await call("prompter.script.create", { name: null })).name).toBe("New script 2");
    expect(names((await snapshot()).scripts)).toEqual([
      "01 Intro",
      "2 Guest",
      "10 Outro",
      "New script",
      "New script 2",
    ]);
    expect(reasons()).toEqual(Array(5).fill("script-created"));

    const id = ((await snapshot()).scripts as JsonObject[])[0]!.id as string;
    expect(await call("prompter.script.rename", { scriptId: id, name: "  00   Cold\nopen  " })).toEqual({
      scriptId: id,
      name: "00 Cold open",
    });
    expect(await refused("prompter.script.rename", { scriptId: id, name: "   " })).toEqual({
      code: "INVALID_PARAMS",
      sentence: "name must be a string that is not empty.",
    });
    expect((await refused("prompter.script.create", { name: "\u0007" })).sentence).toBe("name must hold a word.");
    expect(await refused("prompter.script.rename", { scriptId: "script-none", name: "X" })).toEqual({
      code: "PROMPTER_SCRIPT_UNKNOWN",
      sentence: "There is no such script; it may have been deleted for good.",
    });
    expect((await refused("prompter.script.snapshot", {})).sentence).toBe(
      "scriptId must be a string that is not empty."
    );
  });

  // §3.3: saved as you type, with its emphasis and its counts; over 30,000 words is refused.
  it("saves an edit with its emphasis and its counts", async () => {
    const { call, refused, script } = openPrompterDouble();
    const id = await script("Talk", ["placeholder"]);
    const result = await call("prompter.script.edit", {
      scriptId: id,
      paragraphs: [
        { runs: [{ text: "Hello " }, { text: "there", bold: true }, { text: "\uFEFF friend\r\nagain" }] },
        { runs: [{ text: "[PAUSE]" }] },
        { runs: [] },
      ],
    });
    expect(result).toEqual({ scriptId: id, changedAt: "2026-09-27T12:00:00.000Z" });
    const saved = await call("prompter.script.snapshot", { scriptId: id });
    expect((saved.paragraphs as JsonObject[])[0]!.runs).toEqual([
      { text: "Hello ", bold: false, italic: false, underline: false },
      { text: "there", bold: true, italic: false, underline: false },
      { text: " friend\nagain", bold: false, italic: false, underline: false },
    ]);
    expect((saved.paragraphs as JsonObject[])[2]).toEqual({ runs: [] });
    expect(saved.script).toMatchObject({ readWords: 4, paragraphCount: 3, lengthSeconds: (4 * 60) / 140 });
    expect(saved.cues).toEqual([{ paragraph: 1, word: 0, text: "PAUSE" }]);
    expect(saved.versions).toEqual([]);

    const tooLong = [{ runs: [{ text: "word ".repeat(30_001) }] }];
    expect(await refused("prompter.script.edit", { scriptId: id, paragraphs: tooLong })).toEqual({
      code: "PROMPTER_SCRIPT_TOO_LONG",
      sentence: "The script would have 30,001 words; a script can have up to 30,000. Split it into shorter scripts.",
    });
    // Slice 6b's review: the text is capped as an import's is, so pastes into the editor build no more.
    const half = { runs: [{ text: "a".repeat(MAX_SCRIPT_TEXT_BYTES / 2 + 1) }] };
    expect(await refused("prompter.script.edit", { scriptId: id, paragraphs: [half, half] })).toEqual({
      code: "PROMPTER_SCRIPT_TOO_LONG",
      sentence: "The script would hold more text than a script can hold (2 MB). Split it into shorter scripts.",
    });
    expect((await refused("prompter.script.edit", { scriptId: id })).sentence).toBe(
      "paragraphs must be the script's text."
    );
    expect(
      (await refused("prompter.script.edit", { scriptId: id, paragraphs: [{ runs: [{ bold: true }] }] })).code
    ).toBe("INVALID_PARAMS");
    await call("prompter.script.edit", { scriptId: id, paragraphs: [] });
    expect((await call("prompter.script.snapshot", { scriptId: id })).paragraphs).toEqual([{ runs: [] }]);
  });

  // §5.2: the place is words, so an edit elsewhere leaves the words at its place; the
  // script on the prompter keeps the glass's place until Update (§6.3).
  it("moves a place with its words when the text changes", async () => {
    const { call, script, edit, snapshot, glass } = openPrompterDouble();
    const away = await script("Away", ["a b", "c d", "e f"]);
    await call("prompter.putOn", { scriptId: away });
    await call("prompter.jump", { to: "place", paragraph: 2, word: 1 });
    await call("prompter.clear");
    await edit(away, ["new", "a b", "c d", "e f"]);
    expect(((await snapshot()).scripts as JsonObject[])[0]!.place).toEqual({ paragraph: 3, word: 1 });

    await call("prompter.putOn", { scriptId: away });
    await edit(away, ["newer", "new", "a b", "c d", "e f"]);
    expect((await glass()).place).toEqual({ paragraph: 3, word: 1 });
  });

  // §3.3: Remove moves a script to Removed; the one on the prompter cannot be removed;
  // Restore brings it back; only Delete for good in Removed ends it.
  it("keeps removed scripts, and deletes only a removed one", async () => {
    const { call, refused, script, snapshot } = openPrompterDouble();
    const on = await script("On air", ["words"]);
    const off = await script("Spare", ["words"]);
    await call("prompter.putOn", { scriptId: on });
    expect(await refused("prompter.script.remove", { scriptId: on })).toEqual({
      code: "PROMPTER_SCRIPT_ON_PROMPTER",
      sentence: "On air is on the prompter. Clear the prompter first.",
    });
    expect(await refused("prompter.script.delete", { scriptId: off })).toEqual({
      code: "PROMPTER_SCRIPT_NOT_REMOVED",
      sentence: "Spare is not in Removed. Remove it first; only a removed script can be deleted for good.",
    });

    await call("prompter.script.remove", { scriptId: off });
    const removed = await snapshot();
    expect(names(removed.scripts)).toEqual(["On air"]);
    expect(names(removed.removed)).toEqual(["Spare"]);
    expect((removed.removed as JsonObject[])[0]!.removedAt).toBe("2026-09-27T12:00:00.000Z");
    expect(await refused("prompter.putOn", { scriptId: off, replace: true })).toEqual({
      code: "PROMPTER_SCRIPT_REMOVED",
      sentence: "Spare is in Removed. Restore it first.",
    });
    expect((await refused("prompter.script.edit", { scriptId: off, paragraphs: [] })).code).toBe(
      "PROMPTER_SCRIPT_REMOVED"
    );

    await call("prompter.script.restore", { scriptId: off });
    expect(names((await snapshot()).scripts)).toEqual(["On air", "Spare"]);
    await call("prompter.script.remove", { scriptId: off });
    await call("prompter.script.delete", { scriptId: off });
    expect((await snapshot()).removed).toEqual([]);
    expect((await refused("prompter.script.snapshot", { scriptId: off })).code).toBe("PROMPTER_SCRIPT_UNKNOWN");
  });

  it("lists Removed with the most recently removed first", async () => {
    const { call, script, snapshot } = openPrompterDouble();
    const first = await script("First", ["a"]);
    const second = await script("Second", ["b"]);
    await call("prompter.script.remove", { scriptId: second });
    vi.setSystemTime(NOW + 1_000);
    await call("prompter.script.remove", { scriptId: first });
    expect(names((await snapshot()).removed)).toEqual(["First", "Second"]);
  });

  // §3.3: every time a script's text goes on the prompter it is kept as a version, the
  // last 20 are kept, and bringing one back keeps the text it replaces first.
  it("keeps the last 20 versions and brings one back", async () => {
    const { call, refused, script, edit, glass } = openPrompterDouble();
    const id = await script("Talk", ["first text"]);
    await call("prompter.putOn", { scriptId: id });
    let versions = (await call("prompter.script.snapshot", { scriptId: id })).versions as JsonObject[];
    expect(versions).toEqual([{ id: 1, readWords: 2, keptAt: "2026-09-27T12:00:00.000Z", reason: "put-on" }]);

    for (let round = 0; round < 23; round += 1) {
      await edit(id, [`text number ${round}`]);
      await call("prompter.update");
    }
    versions = (await call("prompter.script.snapshot", { scriptId: id })).versions as JsonObject[];
    expect(versions).toHaveLength(20);
    expect(versions[0]!.reason).toBe("updated");
    const oldestKept = versions[19]!.id;

    await edit(id, ["unsaved thought"]);
    await call("prompter.script.version.bringBack", { scriptId: id, versionId: oldestKept });
    const brought = await call("prompter.script.snapshot", { scriptId: id });
    expect(texts(brought)).toEqual(["text number 3"]);
    expect((brought.versions as JsonObject[])[0]!.reason).toBe("before-bringing-back");
    expect((await glass()).notUpdated).toBe(true);
    expect(await refused("prompter.script.version.bringBack", { scriptId: id, versionId: 1 })).toEqual({
      code: "PROMPTER_VERSION_UNKNOWN",
      sentence: "Talk has no such version; it may have been let go.",
    });
    expect((await refused("prompter.script.version.bringBack", { scriptId: id })).sentence).toBe(
      "versionId must be a whole number."
    );
  });

  it("keeps nothing more when the text a version replaces is already kept", async () => {
    const { call } = openPrompterDouble();
    const first = await call("prompter.script.import", fileParams("Talk.txt", "Version A."));
    const id = first.scriptId as string;
    await call("prompter.script.import", { ...fileParams("Talk.txt", "Version B."), updateScriptId: id });
    const before = (await call("prompter.script.snapshot", { scriptId: id })).versions as JsonObject[];
    // The earlier text was the newest version already, so "before-file-update" kept nothing.
    expect(before.map((version) => version.reason)).toEqual(["imported", "imported"]);

    await call("prompter.script.version.bringBack", { scriptId: id, versionId: before[1]!.id as number });
    const after = await call("prompter.script.snapshot", { scriptId: id });
    expect(texts(after)).toEqual(["Version A."]);
    expect(after.versions).toEqual(before);
  });
});

describe("the fixture double's prompter import", () => {
  // §3.1 and §3.2: a paste is plain text by the .txt rules, named after its first words.
  it("makes a script of pasted text, named after its first words", async () => {
    const { call, reasons } = openPrompterDouble();
    const pasted = await call("prompter.script.paste", {
      text: "Good evening and welcome to the studio tonight\r\nwith us.\r\n\r\n[PAUSE]\r\n\r\n  \r\nThe end.",
    });
    expect(pasted).toMatchObject({
      name: "Good evening and welcome to the",
      sentence: "Imported the pasted text: 3 paragraphs, 13 words, 1 cue.",
    });
    const script = await call("prompter.script.snapshot", { scriptId: pasted.scriptId as string });
    expect(texts(script)).toEqual(["Good evening and welcome to the studio tonight\nwith us.", "[PAUSE]", "The end."]);
    expect(script.script).toMatchObject({ sourceFileName: null, readWords: 12, speedWpm: 140 });
    expect((script.versions as JsonObject[]).map((version) => version.reason)).toEqual(["pasted"]);
    expect(reasons()).toEqual(["script-pasted"]);

    expect(
      (await call("prompter.script.paste", { text: "Supercalifragilisticexpialidocious-and-more words" })).name
    ).toBe("Supercalifragilisticexpialidocious-and-more");
  });

  it("reads the clipboard's HTML: paragraphs, emphasis, lists, headings as cues", async () => {
    const { call } = openPrompterDouble();
    const html = [
      "<html><head><style>p { color: red }</style></head><body><!--StartFragment-->",
      "<h2>Opening &amp; welcome</h2>",
      "<p>Hello <b>bold</b> and <i>italic</i>, <u>underlined</u>&nbsp;and <span style='font-weight:700'>heavy</span>.</p>",
      '<b style="font-weight:normal" id="docs-internal-guid"><p>Not bold &lt;here&gt; &#8211; &#x41;&quot;&#39;</p></b>',
      "<ul><li>First</li><li><em>Second</em></li><li></li></ul>",
      "<ol start=3><li>Third</li><li>Fourth</li></ol>",
      "<div>One line<br>next line<br><br>new paragraph</div>",
      "<table><tr><td>Cell A</td><td>Cell B</td></tr></table>",
      "<!--EndFragment--></body></html>",
    ].join("\n");
    const pasted = await call("prompter.script.paste", { html, text: "ignored" });
    expect(pasted.sentence).toBe("Imported the pasted text: 11 paragraphs, 33 words, 1 cue.");
    expect(pasted.name).toBe("[Opening & welcome]");
    const script = await call("prompter.script.snapshot", { scriptId: pasted.scriptId as string });
    expect(texts(script)).toEqual([
      "[Opening & welcome]",
      // A lone no-break space stays one, as the hardware link keeps it (`finished_paragraph`).
      "Hello bold and italic, underlined\u00A0and heavy.",
      "Not bold <here> – A\"'",
      "– First",
      "– Second",
      "3. Third",
      "4. Fourth",
      "One line\nnext line",
      "new paragraph",
      "Cell A",
      "Cell B",
    ]);
  });

  it("keeps the emphasis a paste's HTML carries", () => {
    expect(
      readHtml("<p>Hello <b>bold <i>both</i></b> <span style='text-decoration: underline'>under</span></p>")
    ).toEqual([
      {
        runs: [
          { text: "Hello ", bold: false, italic: false, underline: false },
          { text: "bold ", bold: true, italic: false, underline: false },
          { text: "both", bold: true, italic: true, underline: false },
          { text: " ", bold: false, italic: false, underline: false },
          { text: "under", bold: false, italic: false, underline: true },
        ],
      },
    ]);
    expect(readHtml("<p style='font-style:italic'>Tilted <span style='font-style:normal'>upright</span></p>")).toEqual([
      {
        runs: [
          { text: "Tilted ", bold: false, italic: true, underline: false },
          { text: "upright", bold: false, italic: false, underline: false },
        ],
      },
    ]);
    expect(readHtml("<script>alert(1)</script><p>&nbsp;</p><h1>[Already]</h1><h3>  </h3>")).toEqual([
      { runs: [{ text: "[Already]", bold: false, italic: false, underline: false }] },
    ]);
    // A `<` that opens no tag is text.
    expect(readHtml("Loose text <with a stray < sign")).toEqual([
      { runs: [{ text: "Loose text <with a stray < sign", bold: false, italic: false, underline: false }] },
    ]);
  });

  it("falls back to the plain text when the HTML holds no word, and refuses an empty paste", async () => {
    const { call, refused } = openPrompterDouble();
    const pasted = await call("prompter.script.paste", { html: "<p>&nbsp;</p>", text: "Plain words" });
    expect(pasted.sentence).toBe("Imported the pasted text: 1 paragraph, 2 words, 0 cues.");
    expect(await refused("prompter.script.paste", { text: "   \n  " })).toEqual({
      code: "PROMPTER_IMPORT_REFUSED",
      sentence: "The pasted text has no text in it.",
    });
    expect(await refused("prompter.script.paste", { html: 7, text: "x" })).toEqual({
      code: "INVALID_PARAMS",
      sentence: "html must be a string.",
    });
  });

  // §3.2: a .txt is UTF-8 (or UTF-16 with its byte-order mark), else Windows-1252, and the
  // sentence names which, so å, ä and ö never arrive broken.
  it("reads a .txt in its encoding and names it", async () => {
    const { call } = openPrompterDouble();
    const utf8 = await call(
      "prompter.script.import",
      fileParams("C:\\Scripts\\Intro å.txt", "Hej på er.\n\nVälkomna.")
    );
    expect(utf8).toMatchObject({
      name: "Intro å",
      sentence: "Imported Intro å.txt: 2 paragraphs, 4 words, 0 cues. Read as UTF-8.",
    });
    const script = await call("prompter.script.snapshot", { scriptId: utf8.scriptId as string });
    expect(script.script).toMatchObject({ sourceFileName: "Intro å.txt" });
    expect(texts(script)).toEqual(["Hej på er.", "Välkomna."]);
    expect((script.versions as JsonObject[])[0]!.reason).toBe("imported");

    const text = "Åsa – [CAM 2]";
    const littleEndian = [
      0xff,
      0xfe,
      ...Array.from(text).flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8]),
    ];
    const utf16 = await call("prompter.script.import", fileParams("wide.TXT", Uint8Array.from(littleEndian)));
    expect(utf16.sentence).toBe("Imported wide.TXT: 1 paragraph, 4 words, 0 cues. Read as UTF-16.");
    expect(texts(await call("prompter.script.snapshot", { scriptId: utf16.scriptId as string }))).toEqual([text]);

    const bigEndian = [0xfe, 0xff, ...Array.from("Hi").flatMap((c) => [0, c.charCodeAt(0)])];
    expect((await call("prompter.script.import", fileParams("be.txt", Uint8Array.from(bigEndian)))).sentence).toMatch(
      /Read as UTF-16\.$/
    );

    const windows = Uint8Array.from([0x48, 0xe5, 0x6c, 0x6c, 0xe5, 0x20, 0x96, 0x20, 0x93, 0x6f, 0x6b, 0x94]);
    const legacy = await call("prompter.script.import", fileParams("old.txt", windows));
    expect(legacy.sentence).toBe("Imported old.txt: 1 paragraph, 3 words, 0 cues. Read as Windows-1252.");
    expect(texts(await call("prompter.script.snapshot", { scriptId: legacy.scriptId as string }))).toEqual([
      "Hållå – “ok”",
    ]);

    const marked = await call("prompter.script.import", fileParams("marked.txt", "\uFEFFBOM first"));
    expect(marked.sentence).toBe("Imported marked.txt: 1 paragraph, 2 words, 0 cues. Read as UTF-8.");
    expect(texts(await call("prompter.script.snapshot", { scriptId: marked.scriptId as string }))).toEqual([
      "BOM first",
    ]);
  });

  it("counts with thousands commas, and updates a script from its file on request", async () => {
    const { call, script } = openPrompterDouble();
    const words = Array.from({ length: 1240 }, (_, index) => `w${index}`).join(" ");
    const imported = await call("prompter.script.import", fileParams("Long.txt", `[Intro]\n\n${words}`));
    expect(imported.sentence).toBe("Imported Long.txt: 2 paragraphs, 1,241 words, 1 cue. Read as UTF-8.");

    const talk = await script("Talk", ["Old words."]);
    const updated = await call("prompter.script.import", {
      ...fileParams("Talk.txt", "New words."),
      updateScriptId: talk,
    });
    expect(updated).toEqual({
      scriptId: talk,
      name: "Talk",
      sentence:
        "Imported Talk.txt: 1 paragraph, 2 words, 0 cues. Read as UTF-8. It is now the text of Talk; the earlier text is kept among its versions.",
    });
    const kept = await call("prompter.script.snapshot", { scriptId: talk });
    expect(texts(kept)).toEqual(["New words."]);
    expect((kept.versions as JsonObject[]).map((version) => version.reason)).toEqual([
      "imported",
      "before-file-update",
    ]);
  });

  it("refuses what it does not read, in the hardware link's words", async () => {
    const { refused } = openPrompterDouble();
    const refusal = async (fileName: string, bytes: Uint8Array | string = "words") =>
      (await refused("prompter.script.import", fileParams(fileName, bytes))).sentence;
    expect(await refusal("Script.doc")).toBe(
      "Script.doc is in Word's old format (.doc), which Studio Control does not read. Save it as .docx in Word, then open that."
    );
    expect(await refusal("Script.pdf")).toBe(
      "Studio Control does not open .pdf files. Save the script as .docx or .txt, then open that."
    );
    expect(await refusal("Script")).toBe(
      "Script has no .docx or .txt at the end of its name. Studio Control opens Word documents (.docx) and plain text (.txt)."
    );
    expect(await refusal("Interview.docx")).toBe(
      "Interview.docx could not be read: the fixture double reads .txt files and pasted text; a Word document is read by the hardware link."
    );
    expect(await refusal("zip.txt", Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))).toBe(
      "zip.txt is not a .txt file, whatever its name says. Save it again as .txt, then open that."
    );
    expect(await refusal("empty.txt", "\n \n")).toBe("empty.txt has no text in it.");
    expect(await refusal("long.txt", "word ".repeat(30_001))).toBe(
      "long.txt has 30,001 words; a script can have up to 30,000. Split it into shorter scripts."
    );
    expect(await refused("prompter.script.import", { fileName: "a.txt", contentBase64: "not base64!" })).toEqual({
      code: "INVALID_PARAMS",
      sentence: "contentBase64 must be the file's bytes in base64.",
    });
    expect(
      (await refused("prompter.script.import", { fileName: "big.txt", contentBase64: "A".repeat(27_962_036) })).sentence
    ).toBe("big.txt is 21 MB; Studio Control opens files up to 20 MB.");
    expect((await refused("prompter.script.import", { ...fileParams("a.txt", "x"), updateScriptId: 4 })).sentence).toBe(
      "updateScriptId must be a string."
    );
  });
});

// The hardware link's import review of 2026-09-27 (`prompter/import/mod.rs`, 718dcb9d): a
// paste over 20 MB has its own sentence, a script's text is capped at 2 MB after its
// words, and white space collapses as each paragraph is built.
describe("the double's import holds to the hardware link's limits and white space", () => {
  // `a_paste_over_the_size_limit_is_refused_as_a_paste`.
  it("refuses a paste over 20 MB in its own words", async () => {
    const { refused } = openPrompterDouble();
    const half = "a".repeat(MAX_IMPORT_BYTES / 2 + 1);
    expect(await refused("prompter.script.paste", { html: half, text: half })).toEqual({
      code: "PROMPTER_IMPORT_REFUSED",
      sentence: "The pasted text is 21 MB; Studio Control takes pastes up to 20 MB.",
    });
    // A file keeps its own sentence.
    expect(refusalSentence({ kind: "too-large", bytes: MAX_IMPORT_BYTES + 1 }, "Big.txt")).toBe(
      "Big.txt is 21 MB; Studio Control opens files up to 20 MB."
    );
  });

  // `more_text_than_a_script_holds_is_refused_however_few_its_words`.
  it("refuses more text than a script holds, however few its words, after the word limit", async () => {
    const { call, refused } = openPrompterDouble();
    const bytes = 3 * 1024 * 1024;
    const word = "a".repeat(bytes);
    const refusal = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        if (error instanceof ImportRefused) return error.refusal;
        throw error;
      }
      throw new Error("the import should be refused");
    };
    expect(refusal(() => importPaste(null, word))).toEqual({ kind: "too-much-text", bytes });
    expect(refusal(() => importFile("One word.txt", new TextEncoder().encode(word)))).toEqual({
      kind: "too-much-text",
      bytes,
    });
    expect(await refused("prompter.script.paste", { text: word })).toEqual({
      code: "PROMPTER_IMPORT_REFUSED",
      sentence: "The pasted text holds more text than a script can hold (2 MB). Split it into shorter scripts.",
    });
    expect(refusalSentence({ kind: "too-much-text", bytes }, "One word.txt")).toBe(
      "One word.txt holds more text than a script can hold (2 MB). Split it into shorter scripts."
    );
    // Just at the limit is a script; over both limits, the words are what it says.
    expect((await call("prompter.script.paste", { text: "a".repeat(MAX_SCRIPT_TEXT_BYTES) })).name).toBe(
      "a".repeat(MAX_SCRIPT_TEXT_BYTES).slice(0, 80)
    );
    expect(refusal(() => importPaste(null, `${"a".repeat(70)} `.repeat(30_001)))).toEqual({
      kind: "too-long",
      words: 30_001,
    });
  });

  // `white_space_collapses_as_a_paragraph_is_built`.
  it("collapses white space as a paragraph is built", () => {
    const paragraph = finishedParagraph([makeRun("one  \t two \u00A0 three\u00A0four\n\n\n\n  five \n \n\n six")]);
    expect(paragraph && paragraphText(paragraph)).toBe("one two three\u00A0four\n\nfive\n\nsix");
    // The space stays in the run it began in.
    expect(
      finishedParagraph([makeRun("under  ", { bold: false, italic: false, underline: true }), makeRun("  plain")])
    ).toEqual({
      runs: [makeRun("under ", { bold: false, italic: false, underline: true }), makeRun("plain")],
    });
    // A long run of spaces between two words is one space; nothing but white space is no paragraph.
    expect(finishedParagraph([makeRun(`a${" ".repeat(1_000_000)}b`)])?.runs).toEqual([makeRun("a b")]);
    expect(finishedParagraph([makeRun(" \n\u00A0\n ")])).toBeNull();
  });

  it("collapses white space in a .txt, a plain paste and an HTML paste", async () => {
    const { call } = openPrompterDouble();
    const text = async (params: JsonObject, method: "prompter.script.import" | "prompter.script.paste") => {
      const id = (await call(method, params)).scriptId as string;
      return texts(await call("prompter.script.snapshot", { scriptId: id }));
    };
    expect(
      await text(
        fileParams("Spaces.txt", "Hello   there,\u00A0friend.  Two \t spaces.\n  Next   line.  "),
        "prompter.script.import"
      )
    ).toEqual(["Hello there,\u00A0friend. Two spaces.\nNext line."]);
    expect(await text({ text: "One   two\u00A0\u00A0three" }, "prompter.script.paste")).toEqual(["One two three"]);
    expect(
      await text(
        { html: "<p>Lone&nbsp;one, two&nbsp;&nbsp;here</p><p>&nbsp;</p><p>a<br><br>b</p>", text: "x" },
        "prompter.script.paste"
      )
    ).toEqual(["Lone\u00A0one, two here", "a", "b"]);
  });
});

// The hardware link's `cue_paragraph` and `LeftOut::pictures` (`prompter/import/mod.rs`,
// `html.rs`): a heading that already is one cue stays as it is, square brackets inside any
// other become round ones, and a paste counts the pictures it leaves out.
describe("the double's paste reads as the hardware link's", () => {
  it("keeps a heading one cue", () => {
    expect(readHtml("<h2>Guest [Anna]</h2><h3>[As is]</h3>")).toEqual([
      { runs: [{ text: "[Guest (Anna)]", bold: false, italic: false, underline: false }] },
      { runs: [{ text: "[As is]", bold: false, italic: false, underline: false }] },
    ]);
  });

  it("counts the pictures a paste leaves out", () => {
    const imported = importPaste("<p>Hello there</p><img src='a.png'><img src='b.png'>", "Hello there");
    expect(importSentence("the pasted text", imported)).toBe(
      "Imported the pasted text: 1 paragraph, 2 words, 0 cues. Left out: 2 pictures."
    );
  });
});

// Slice 6b (the operator's answer of 2026-09-27: keep the formatting): the editor's Paste,
// `prompter.paste.convert`, held to the hardware link's `prompter/tests_scripts.rs`
// (`the_editors_paste_*`): the paste's reader, limits and refusals, answered as paragraphs
// the editor inserts at its cursor; it keeps nothing and raises nothing.
describe("the double's editor paste", () => {
  const plain = (text: string) => ({ text, bold: false, italic: false, underline: false });

  // `the_editors_paste_keeps_the_emphasis_and_headings_as_cues`.
  it("keeps the emphasis and headings as cues, in the shape an edit takes", async () => {
    const { call, script } = openPrompterDouble();
    const converted = await call("prompter.paste.convert", {
      html: "<h2>Guest</h2><p>Good evening and <b>welcome</b>, <i>dear</i> <u>viewers</u></p><img src='a.png'>",
      text: "Guest\n\nGood evening and welcome, dear viewers",
    });
    expect(converted).toEqual({
      paragraphs: [
        { runs: [plain("[Guest]")] },
        {
          runs: [
            plain("Good evening and "),
            { text: "welcome", bold: true, italic: false, underline: false },
            plain(", "),
            { text: "dear", bold: false, italic: true, underline: false },
            plain(" "),
            { text: "viewers", bold: false, italic: false, underline: true },
          ],
        },
      ],
      sentence: "Imported the pasted text: 2 paragraphs, 7 words, 1 cue. Left out: 1 picture.",
    });

    // The editor splices them into its text and sends the whole script back.
    const id = await script("Talk", ["Before."]);
    const paragraphs = [{ runs: [plain("Before.")] }, ...(converted.paragraphs as JsonObject[])];
    await call("prompter.script.edit", { scriptId: id, paragraphs });
    const saved = await call("prompter.script.snapshot", { scriptId: id });
    expect(saved.paragraphs).toEqual(paragraphs);
    expect(saved.cues).toEqual([{ paragraph: 1, word: 0, text: "Guest" }]);
  });

  // `the_editors_paste_falls_back_to_the_plain_text`.
  it("falls back to the plain text when the HTML holds no word", async () => {
    const { call } = openPrompterDouble();
    const text = "Plain  words\r\n\r\n[PAUSE]";
    const pastes: JsonObject[] = [{ html: "<p>&nbsp;</p><img src='a.png'>", text }, { text }, { html: null, text }];
    for (const params of pastes) {
      expect(await call("prompter.paste.convert", params), JSON.stringify(params)).toEqual({
        paragraphs: [{ runs: [plain("Plain words")] }, { runs: [plain("[PAUSE]")] }],
        sentence: "Imported the pasted text: 2 paragraphs, 3 words, 1 cue.",
      });
    }
  });

  // `the_editors_paste_refuses_what_the_paste_refuses`.
  it("refuses what the paste refuses, in the same words", async () => {
    const { refused, snapshot } = openPrompterDouble();
    const half = "a".repeat(MAX_IMPORT_BYTES / 2 + 1);
    const cases: Array<[JsonObject, string]> = [
      [{ html: "<p> </p>", text: "  \n " }, "The pasted text has no text in it."],
      [{}, "The pasted text has no text in it."],
      [{ html: half, text: half }, "The pasted text is 21 MB; Studio Control takes pastes up to 20 MB."],
      [
        { text: "word ".repeat(30_001) },
        "The pasted text has 30,001 words; a script can have up to 30,000. Split it into shorter scripts.",
      ],
      [
        { text: "a".repeat(MAX_SCRIPT_TEXT_BYTES + 1) },
        "The pasted text holds more text than a script can hold (2 MB). Split it into shorter scripts.",
      ],
    ];
    for (const [params, sentence] of cases) {
      const refusal = await refused("prompter.paste.convert", params);
      expect(refusal).toEqual({ code: "PROMPTER_IMPORT_REFUSED", sentence });
      expect(await refused("prompter.script.paste", params), "the paste refuses it alike").toEqual(refusal);
    }
    expect(await refused("prompter.paste.convert", { html: 7, text: "x" })).toEqual({
      code: "INVALID_PARAMS",
      sentence: "html must be a string.",
    });
    expect((await snapshot()).scripts).toEqual([]);
  });

  // `the_editors_paste_keeps_nothing_and_raises_nothing` and
  // `the_editors_paste_raises_no_event_and_is_not_a_recent_action`.
  it("keeps nothing, raises nothing and is not a Recent action", async () => {
    const { transport, call, script, edit, snapshot, events } = openPrompterDouble();
    const id = await script("On air", ["Words on the glass."]);
    await call("prompter.putOn", { scriptId: id });
    await edit(id, ["Edited, not updated."]);
    const state = async () => {
      const glass = await call("prompter.glass.snapshot");
      const { ageMs: _age, ...anchor } = glass.anchor as JsonObject;
      const support = (await transport.request("support.snapshot", {})) as JsonObject;
      return {
        scripts: (await snapshot()).scripts,
        script: await call("prompter.script.snapshot", { scriptId: id }),
        glass: { ...glass, anchor },
        rows: support.recentEvents,
      };
    };
    const before = await state();
    expect((before.script.versions as JsonObject[]).map((version) => version.reason)).toEqual(["put-on"]);
    expect((before.rows as JsonObject[])[0], "the newest row is the put-on").toMatchObject({
      domain: "prompter",
      action: "put-on",
    });
    const seen = events.length;

    expect(await call("prompter.paste.convert", { html: "<p><b>New</b> words</p>", text: "New words" })).toEqual({
      paragraphs: [{ runs: [{ text: "New", bold: true, italic: false, underline: false }, plain(" words")] }],
      sentence: "Imported the pasted text: 1 paragraph, 2 words, 0 cues.",
    });
    await expect(call("prompter.paste.convert", { text: " " })).rejects.toThrow("The pasted text has no text in it.");
    expect(events.slice(seen), "no prompter.changed, no app.changed").toEqual([]);
    expect(await state()).toEqual(before);
  });

  // The hardware link's `a_style_attribute_overrides_the_elements_own_emphasis`: the same
  // markup, the same runs (an insertion is a tracked change, not an underline).
  it("reads emphasis as the hardware link's reader does", () => {
    const markup =
      '<p><b>bold <span style="font-weight: normal !important">normal</span></b> <span style="FONT-WEIGHT:600">six</span> <span style="font-weight:lighter">light</span> <i style="font-style:normal">upright</i> <u style="text-decoration-line:none">plain</u> <strong>strong</strong> <em>em</em> <cite>cite</cite> <ins>ins</ins></p>';
    const run = (text: string, bold: boolean, italic: boolean, underline: boolean) => ({
      text,
      bold,
      italic,
      underline,
    });
    expect(readHtml(markup)[0]!.runs).toEqual([
      run("bold ", true, false, false),
      run("normal ", false, false, false),
      run("six", true, false, false),
      run(" light upright plain ", false, false, false),
      run("strong", true, false, false),
      run(" ", false, false, false),
      run("em", false, true, false),
      run(" ", false, false, false),
      run("cite", false, true, false),
      run(" ins", false, false, false),
    ]);
  });
});
