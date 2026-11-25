import { describe, expect, test } from "bun:test";
import { Grounder, normalize } from "../src/ground.ts";
import { formatLocation, type SourceDoc } from "../src/load.ts";

const md = (text: string): SourceDoc => ({ path: "x.md", name: "x.md", format: "md", text, sha256: "" });

describe("Grounder", () => {
  const doc = md("# Заголовок\n\n| **REST type** | GET |\n* **Ф-1.** Держатель   карты задаёт «порог».\nПоследняя строка — итог.");
  const g = new Grounder(doc);

  test("ignores Markdown markup, case, whitespace and quote styles", () => {
    expect(formatLocation(g.find("REST type GET")!.location)).toBe("строка 3");
    expect(formatLocation(g.find('ф-1. держатель карты задаёт "порог"')!.location)).toBe("строка 4");
  });

  test("normalizes dashes and ё", () => {
    expect(g.find("последняя строка - итог")).not.toBeNull();
    expect(g.find("Держатель карты задаeт")).toBeNull();
    expect(new Grounder(md("Ёлка")).find("елка")).not.toBeNull();
  });

  test("matches fragments around an ellipsis in order, across lines", () => {
    const hit = g.find("Держатель карты … Последняя строка");
    expect(hit && formatLocation(hit.location)).toBe("строки 4–5");
    expect(g.find("Последняя строка … Держатель карты")).toBeNull();
  });

  test("matches words broken across PDF lines, with or without a hyphen", () => {
    const pdf = md("Пере\nводы и сня-\nтие наличных");
    const g2 = new Grounder(pdf);
    expect(g2.find("Переводы и снятие наличных")).not.toBeNull();
  });

  test("rejects quotes that are not in the document or too short", () => {
    expect(g.find("этого нет")).toBeNull();
    expect(g.find("Ф")).toBeNull();
    expect(g.find("")).toBeNull();
  });

  test("normalize keeps an offset map into the original", () => {
    const { norm, map } = normalize("**Аб**  в");
    expect(norm).toBe("абв");
    expect(map).toEqual([2, 3, 8]);
  });
});

test("PDF locations report page and line within the page", () => {
  const doc: SourceDoc = { path: "x.pdf", name: "x.pdf", format: "pdf", text: "стр1\nещё\n\f\nпервая\nвторая", sha256: "", pageCount: 2 };
  expect(formatLocation(new Grounder(doc).find("вторая")!.location)).toBe("с. 2, строка 2");
});

test("DOCX locations count paragraphs", () => {
  const doc: SourceDoc = { path: "x.docx", name: "x.docx", format: "docx", text: "Один\n\nДва\n\nТри", sha256: "" };
  expect(formatLocation(new Grounder(doc).find("Три")!.location)).toBe("абзац 3");
});
