import { expect, test } from "bun:test";
import type { LLM } from "../src/llm.ts";
import type { SourceDoc } from "../src/load.ts";
import { runChecks } from "../src/pipeline.ts";
import { pairHint, relatedPairs } from "../src/rules.ts";

// A made-up payment-reminder spec, not the hackathon document.
const TEXT = `# Напоминания

* **П-1.** Клиент получает напоминание об оплате максимум один раз в неделю.
* **П-2.** При смене даты оплаты напоминание приходит снова независимо от прошлых напоминаний.
* **П-3.** Дата оплаты определяется по часовому поясу клиента.

### Критерии приёмки

| Условие | Действие | Результат |
| --- | --- | --- |
| Оплата 1 марта, клиент в Алматы | Наступило 28 февраля 23:50 по часовому поясу банка | Платёж попал в мартовский отчёт |
`;
const doc = { name: "t.md", format: "md", text: TEXT, sha256: "" } as unknown as SourceDoc;

const req = (doc_id: string, quote: string) => ({ doc_id, section: "Требования", type: "functional", summary: quote, quote });
const conflict = (a: string, b: string, quotes: string[], scenario = "Клиенту уже пришло напоминание на этой неделе, затем дата оплаты сменилась.") => ({
  a,
  b,
  check: scenario,
  conflict: true,
  scenario,
  severity: "high",
  quotes,
  problem: "Два места требуют разного.",
  fix: "Выберите одно правило.",
  question: "Как в первом месте, как во втором или оба при условии?",
});

function fake(answers: Record<string, unknown>): LLM & { steps: string[] } {
  const steps: string[] = [];
  return {
    provider: "fake",
    model: "fake",
    stepModels: {},
    calls: 0,
    cached: 0,
    steps,
    async json<T>(step: string): Promise<T> {
      steps.push(step);
      if (step === "extract")
        return {
          title: "Напоминания",
          requirements: [
            req("П-1", "Клиент получает напоминание об оплате максимум один раз в неделю."),
            req("П-2", "При смене даты оплаты напоминание приходит снова независимо от прошлых напоминаний."),
            req("П-3", "Дата оплаты определяется по часовому поясу клиента."),
          ],
        } as T;
      if (step.startsWith("check")) return { results: ["R1", "R2", "R3"].map((req_id) => ({ req_id, findings: [] })) } as T;
      if (step === "set") return { findings: [] } as T;
      if (step === "questions") return { questions: [] } as T;
      return (answers[step] ?? { pairs: [] }) as T;
    },
  };
}

test("code pairs a limit with its override and the acceptance row with its rule, with a hint for each", () => {
  const reqs = [
    { id: "R1", type: "functional", quote: "Клиент получает напоминание об оплате максимум один раз в неделю." },
    { id: "R2", type: "functional", quote: "При смене даты оплаты напоминание приходит снова независимо от прошлых напоминаний." },
    { id: "R3", type: "functional", quote: "Дата оплаты определяется по часовому поясу клиента." },
    { id: "A1", type: "acceptance", quote: "Оплата 1 марта Наступило 28 февраля по часовому поясу банка Платёж попал в мартовский отчёт" },
  ];
  const pairs = relatedPairs(reqs);
  expect(pairs).toContainEqual(["R1", "R2"]);
  expect(pairs).toContainEqual(["R3", "A1"]);
  expect(pairHint(reqs[0]!, reqs[1]!)).toContain("ограничивает действие («максимум»)");
  expect(pairHint(reqs[2]!, reqs[3]!)).toContain("ожидаемым результатом примера");
});

test("a pair contradiction needs a concrete case and two found quotes, and a second look can add one", async () => {
  const llm = fake({
    pairs: {
      pairs: [
        conflict("R1", "R2", ["максимум один раз в неделю", "приходит снова независимо от прошлых напоминаний"]),
        conflict("R1", "R3", ["максимум один раз в неделю", "цитаты нет в документе"]),
        conflict("R2", "R3", ["приходит снова", "по часовому поясу клиента"], ""),
      ],
    },
    "pairs-2": {
      pairs: [conflict("R3", "КП-1", ["Дата оплаты определяется по часовому поясу клиента", "Платёж попал в мартовский отчёт"])],
    },
  });
  const r = await runChecks(doc, llm);
  const contradictions = r.setFindings.filter((f) => f.criterion === "consistent" && f.by === "model");
  expect(contradictions).toHaveLength(2);
  expect(contradictions.map((f) => f.reqIds)).toContainEqual(["ТР-01", "ТР-02"]);
  expect(contradictions.map((f) => f.reqIds)).toContainEqual(["ТР-03"]);
  expect(contradictions[0]!.problem).toContain("Пример:");
  expect(llm.steps).toEqual(["extract", "check-1", "set", "pairs", "pairs-2", "questions"]);
});
