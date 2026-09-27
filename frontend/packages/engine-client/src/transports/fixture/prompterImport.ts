// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { PrompterParagraph } from "../../generated/snapshots/PrompterParagraph";
import { readHtmlCounted } from "./prompterHtml";
import {
  MAX_IMPORT_BYTES,
  MAX_SCRIPT_WORDS,
  counted,
  cueTargets,
  formatCount,
  plainParagraph,
  sanitizeText,
  wordCount,
} from "./prompterModel";

// The Teleprompter's import (`native/rust-engine/src/prompter/import/mod.rs`, new pages
// program, Slice 4; the proposal §3.1 and §3.2): a `.txt` from the page's file picker,
// or what the page read from the clipboard. The refusals and the import sentence are
// the hardware link's. A `.txt` is UTF-8, UTF-16 with its byte-order mark, else
// Windows-1252, and the sentence names which; its paragraphs are the text between empty
// lines, and a single line break stays one. The double does not unzip a Word document:
// a `.docx` is refused with its own sentence, below, and the hardware link reads it.

export type TextEncodingName = "UTF-8" | "UTF-16" | "Windows-1252";

/** What a file or a paste held, ready to become a script. */
export interface ImportedText {
  paragraphs: PrompterParagraph[];
  /** Which encoding a `.txt` was read as; none for a paste. */
  encoding: TextEncodingName | null;
  /** Pictures a paste left out (`LeftOut::pictures`); the double reads no Word document. */
  pictures?: number;
}

/** Why a file or a paste was refused (`ImportRefusal`); each has the sentence the operator reads. */
export type ImportRefusal =
  | { kind: "old-word-format" }
  | { kind: "not-what-its-name-says"; expected: ".docx" | ".txt" }
  | { kind: "unsupported-kind"; extension: string }
  | { kind: "too-long"; words: number }
  | { kind: "too-large"; bytes: number }
  | { kind: "empty" }
  | { kind: "unreadable"; reason: string };

/** Thrown by the import; the request answers it as `PROMPTER_IMPORT_REFUSED` with `refusalSentence`. */
export class ImportRefused extends Error {
  constructor(readonly refusal: ImportRefusal) {
    super(refusal.kind);
  }
}

/** The sentence the operator reads. `source` is the file's name, or "The pasted text". */
export function refusalSentence(refusal: ImportRefusal, source: string): string {
  switch (refusal.kind) {
    case "old-word-format":
      return `${source} is in Word's old format (.doc), which Studio Control does not read. Save it as .docx in Word, then open that.`;
    case "not-what-its-name-says":
      return `${source} is not a ${refusal.expected} file, whatever its name says. Save it again as ${refusal.expected}, then open that.`;
    case "unsupported-kind":
      return refusal.extension === ""
        ? `${source} has no .docx or .txt at the end of its name. Studio Control opens Word documents (.docx) and plain text (.txt).`
        : `Studio Control does not open .${refusal.extension} files. Save the script as .docx or .txt, then open that.`;
    case "too-long":
      return `${source} has ${formatCount(refusal.words)} words; a script can have up to ${formatCount(MAX_SCRIPT_WORDS)}. Split it into shorter scripts.`;
    case "too-large":
      return `${source} is ${Math.ceil(refusal.bytes / (1024 * 1024))} MB; Studio Control opens files up to ${MAX_IMPORT_BYTES / (1024 * 1024)} MB.`;
    case "empty":
      return `${source} has no text in it.`;
    case "unreadable":
      return `${source} could not be read: ${refusal.reason}.`;
  }
}

/** The bytes Windows-1252 puts at 0x80–0x9F; the five it leaves open stay C1 controls, as the WHATWG decoder has them. */
const WINDOWS_1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

function fromCodes(codes: ArrayLike<number>): string {
  let out = "";
  for (let start = 0; start < codes.length; start += 8192) {
    out += String.fromCharCode(
      ...Array.from({ length: Math.min(8192, codes.length - start) }, (_, i) => codes[start + i]!)
    );
  }
  return out;
}

/** A `.txt`'s text and the encoding it was read as. */
export function decodeText(bytes: Uint8Array): { text: string; encoding: TextEncodingName } {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    const units = Array.from(
      { length: (bytes.length - 2) >> 1 },
      (_, i) => bytes[2 + 2 * i]! | (bytes[3 + 2 * i]! << 8)
    );
    return { text: fromCodes(units), encoding: "UTF-16" };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const units = Array.from(
      { length: (bytes.length - 2) >> 1 },
      (_, i) => (bytes[2 + 2 * i]! << 8) | bytes[3 + 2 * i]!
    );
    return { text: fromCodes(units), encoding: "UTF-16" };
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "UTF-8" };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "UTF-8" };
  } catch {
    const codes = Array.from(bytes, (byte) => (byte >= 0x80 && byte <= 0x9f ? WINDOWS_1252_HIGH[byte - 0x80]! : byte));
    return { text: fromCodes(codes), encoding: "Windows-1252" };
  }
}

/** Plain text as paragraphs: the text between empty lines; a single line break stays a line break. */
export function readPlain(text: string): PrompterParagraph[] {
  const paragraphs: PrompterParagraph[] = [];
  let lines: string[] = [];
  const end = () => {
    if (lines.length > 0) paragraphs.push(plainParagraph(lines.join("\n")));
    lines = [];
  };
  for (const line of sanitizeText(text).split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") end();
    else lines.push(trimmed);
  }
  end();
  return paragraphs;
}

function checked(imported: ImportedText): ImportedText {
  if (imported.paragraphs.length === 0) throw new ImportRefused({ kind: "empty" });
  const words = wordCount(imported.paragraphs);
  if (words > MAX_SCRIPT_WORDS) throw new ImportRefused({ kind: "too-long", words });
  return imported;
}

/** The text after a name's last dot, as written; empty when there is none. */
function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot + 1);
}

/**
 * Reads a file the page's file picker sent, by the end of its name (`import_file`).
 * `.doc` and every kind but `.docx` and `.txt` are refused by name before a byte is read.
 */
export function importFile(fileName: string, bytes: Uint8Array): ImportedText {
  if (bytes.length > MAX_IMPORT_BYTES) throw new ImportRefused({ kind: "too-large", bytes: bytes.length });
  const extension = extensionOf(fileName);
  switch (extension.toLowerCase()) {
    case "docx":
      // The double reads no zip: a Word document is the hardware link's to read.
      throw new ImportRefused({
        kind: "unreadable",
        reason: "the fixture double reads .txt files and pasted text; a Word document is read by the hardware link",
      });
    case "txt": {
      // Bytes a text file never holds (a zip, a picture) mean the name is wrong; UTF-16 has them in every other byte.
      if (bytes.includes(0) && !(bytes[0] === 0xff && bytes[1] === 0xfe) && !(bytes[0] === 0xfe && bytes[1] === 0xff)) {
        throw new ImportRefused({ kind: "not-what-its-name-says", expected: ".txt" });
      }
      const { text, encoding } = decodeText(bytes);
      return checked({ paragraphs: readPlain(text), encoding });
    }
    case "doc":
      throw new ImportRefused({ kind: "old-word-format" });
    default:
      throw new ImportRefused({ kind: "unsupported-kind", extension });
  }
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Reads what the page took from the clipboard: its HTML when it held formatting, else its plain text (`import_paste`). */
export function importPaste(html: string | null, text: string): ImportedText {
  const size = (html === null ? 0 : byteLength(html)) + byteLength(text);
  if (size > MAX_IMPORT_BYTES) throw new ImportRefused({ kind: "too-large", bytes: size });
  if (html !== null && html.trim() !== "") {
    const { paragraphs, pictures } = readHtmlCounted(html);
    if (paragraphs.length > 0) return checked({ paragraphs, encoding: null, pictures });
  }
  return checked({ paragraphs: readPlain(text), encoding: null });
}

/**
 * The import sentence: "Imported Interview intro.txt: 18 paragraphs, 1,240 words, 3 cues.
 * Read as UTF-8." `source` is the file's name, or "the pasted text". The double reads no
 * Word document, so of what is left out it counts only a paste's pictures.
 */
export function importSentence(source: string, imported: ImportedText): string {
  const paragraphs = imported.paragraphs;
  let sentence = `Imported ${source}: ${counted(paragraphs.length, "paragraph", "paragraphs")}, ${counted(
    wordCount(paragraphs),
    "word",
    "words"
  )}, ${counted(cueTargets(paragraphs).length, "cue", "cues")}.`;
  if (imported.pictures) sentence += ` Left out: ${counted(imported.pictures, "picture", "pictures")}.`;
  if (imported.encoding) sentence += ` Read as ${imported.encoding}.`;
  return sentence;
}
