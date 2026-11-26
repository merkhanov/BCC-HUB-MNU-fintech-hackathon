import { expect, test } from "bun:test";
import { precision, recall } from "../eval/recall.ts";
import { KNOWN } from "../eval/requirements.known.ts";

const finding = (quote: string, problem: string) => ({ reqId: "ТР-01", criterion: "correct", quote, problem, fix: "" });

test("recall counts a defect only when the quote and the problem both match", () => {
  const rows = recall({
    findings: [
      finding("REST type GET", "Метод сохраняет порог, но описан как GET"),
      finding("Тело не используется.", "Избыточное описание для GET-запроса"),
    ],
    setFindings: [
      { id: "Н-01", criterion: "consistent", places: [{ quote: "403. Ответ в случае" }, { quote: "возвращается 404" }], problem: "Под заголовком 403 описан код 404", fix: "" },
    ],
  });
  const hits = Object.fromEntries(rows.map((r) => [r.defect.id, r.hits]));
  expect(hits["get-saves"]).toEqual(["ТР-01/correct"]);
  expect(hits["404-in-403"]).toEqual(["Н-01"]);
  expect(hits["f3-vs-f4"]).toEqual([]);
});

test("known defect ids are unique", () => {
  expect(new Set(KNOWN.map((d) => d.id)).size).toBe(KNOWN.length);
});

test("a question covers a known defect when it cites one of the matching findings", () => {
  const report = {
    requirements: [{ id: "ТР-01", docId: "Ф-1" }],
    findings: [finding("REST type GET", "Метод сохраняет порог, но описан как GET")],
    setFindings: [],
    questions: [
      { id: "В-01", sources: ["ТР-01 (Ф-1), Корректность"] },
      { id: "В-02", sources: ["ТР-02, Корректность"] },
    ],
  };
  const row = recall(report).find((r) => r.defect.id === "get-saves")!;
  expect(row.questions).toEqual(["В-01"]);
  expect(precision(report, { "ТР-01/correct": true })).toEqual({ total: 1, labelled: 1, truePositives: 1, precision: 1 });
});
