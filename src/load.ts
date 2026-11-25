import { basename, extname } from "node:path";

export type Format = "md" | "txt" | "pdf" | "docx";

export interface SourceDoc {
  path: string;
  name: string;
  format: Format;
  /** Full text. PDF pages are joined with "\n\f\n" so offsets map back to pages. */
  text: string;
  pageCount?: number;
  sha256: string;
}

const FORMATS: Record<string, Format> = {
  ".md": "md",
  ".markdown": "md",
  ".txt": "txt",
  ".pdf": "pdf",
  ".docx": "docx",
};

export const SUPPORTED = Object.keys(FORMATS);

export class InputError extends Error {}

export async function loadDocument(path: string): Promise<SourceDoc> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new InputError(`Файл не найден: ${path}`);

  const format = FORMATS[extname(path).toLowerCase()];
  if (!format) {
    throw new InputError(
      `Формат ${extname(path) || "(без расширения)"} не поддерживается. Поддерживаются: ${SUPPORTED.join(", ")}`,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  const base = { path, name: basename(path), format, sha256 };

  if (format === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const joined = text.join("\n\f\n");
    if (!joined.replace(/\s/g, "")) {
      throw new InputError("В PDF нет текстового слоя (скан?). Распознайте текст и повторите.");
    }
    return { ...base, text: joined, pageCount: totalPages };
  }

  if (format === "docx") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return { ...base, text: value };
  }

  return { ...base, text: new TextDecoder().decode(bytes) };
}

export interface Location {
  page?: number;
  /** Line number, or paragraph number for DOCX (Word shows no line numbers). */
  line: number;
  endLine: number;
  unit: "line" | "paragraph";
}

/** Map a character range in doc.text to a page and line numbers (lines count within the page for PDF). */
export function locate(doc: SourceDoc, start: number, end: number): Location {
  const before = doc.text.slice(0, start);
  if (doc.format === "pdf") {
    const pageStart = before.lastIndexOf("\f") + 1;
    const page = (before.match(/\f/g)?.length ?? 0) + 1;
    const line = countLines(doc.text.slice(pageStart, start)) - (pageStart > 0 ? 1 : 0);
    return { page, line, endLine: line + countLines(doc.text.slice(start, end)) - 1, unit: "line" };
  }
  if (doc.format === "docx") {
    const line = countParagraphs(doc.text.slice(0, start + 1));
    return { line, endLine: countParagraphs(doc.text.slice(0, end)), unit: "paragraph" };
  }
  const line = countLines(before);
  return { line, endLine: line + countLines(doc.text.slice(start, end)) - 1, unit: "line" };
}

function countLines(s: string): number {
  let n = 1;
  for (const ch of s) if (ch === "\n") n++;
  return n;
}

function countParagraphs(s: string): number {
  return s.split("\n").filter((l) => l.trim()).length;
}

export function formatLocation(loc: Location | null): string {
  if (!loc) return "не найдено";
  const [one, many] = loc.unit === "paragraph" ? ["абзац", "абзацы"] : ["строка", "строки"];
  const lines = loc.line === loc.endLine ? `${one} ${loc.line}` : `${many} ${loc.line}–${loc.endLine}`;
  return loc.page ? `с. ${loc.page}, ${lines}` : lines;
}
