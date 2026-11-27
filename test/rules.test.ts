import { expect, test } from "bun:test";
import { Grounder } from "../src/ground.ts";
import type { SourceDoc } from "../src/load.ts";
import { codeChecks } from "../src/rules.ts";

const doc = (text: string): SourceDoc => ({ name: "t.md", format: "md", text, sha256: "", pageCount: undefined } as unknown as SourceDoc);
const rules = (text: string) => codeChecks(text).map((f) => f.rule);

// A made-up order-service spec, not the hackathon document.
const SPEC = `# Заказы

Скидка хранится в копейках, сумма заказа в рублях.

| Parameter | Format | Description |
| --- | --- | --- |
| \`total\` | integer | Сумма |

| Поле | Тип |
| --- | --- |
| total | string |

| Поле | Значение |
| --- | --- |
| **REST type** | GET |
| **Request URL** | \`/orders/createOrder\` |
| **Swagger** | — |

* **Content-Type:** \`application/json\` .
* Тело не используется.

#### 200. OK
\`\`\`json
{"status":"ERROR"}
\`\`\`

#### 409. Conflict
Для дубликата возвращается 400.
`;

test("each rule fires on its pattern and every quote is found in the document", () => {
  const found = codeChecks(SPEC);
  expect(found.map((f) => f.rule).sort()).toEqual(
    ["empty-values", "error-in-success", "field-types", "json-without-body", "money-units", "mutating-get", "status-section"].sort(),
  );
  const g = new Grounder(doc(SPEC));
  for (const f of found) for (const q of f.quotes) expect(g.find(q), `${f.rule}: ${q}`).not.toBeNull();
  expect(found.find((f) => f.rule === "status-section")!.problem).toContain("кодом 409, но в его тексте возвращается код 400");
  expect(found.find((f) => f.rule === "field-types")!.problem).toContain("«total»");
});

test("rules stay quiet when the document is consistent", () => {
  const clean = `Скидка и сумма хранятся в копейках, 1 рубль = 100 копеек, сумма в рублях только на экране.

| Parameter | Format |
| --- | --- |
| total | integer |

| Поле | Тип |
| --- | --- |
| total | int |

| **REST type** | POST |
| **Request URL** | \`/orders/createOrder\` |

* Content-Type: application/json.
* Тело: JSON с полем total.

#### 404. Not found
Возвращается 404, если заказа нет.
`;
  expect(rules(clean)).toEqual([]);
});

test("a GET that only reads is not flagged", () => {
  expect(rules("| **REST type** | GET |\n| **Request URL** | `/orders/getOrder` |\n")).toEqual([]);
});

test("an empty value counts as found only if the model names the field and says it is missing", () => {
  const prod = codeChecks("| **Request URL** | Dev: `/a` . Prod: — |\n").find((f) => f.rule === "empty-values")!;
  expect(prod.topic.test("Для Prod не указан URL метода")).toBe(true);
  expect(prod.topic.test("Пропущен сценарий отката, не указан порядок согласования")).toBe(false);
});

test("a numbered rule that no acceptance example touches is reported", () => {
  const text = `* **П-1.** Напоминание приходит за 3 дня до даты оплаты.
* **П-2.** При переносе даты оплаты напоминание переносится вместе с ней.

### Критерии приёмки

| Условие | Действие | Результат |
| --- | --- | --- |
| Оплата 10 марта | Наступило 7 марта | Напоминание приходит 7 марта |
`;
  const f = codeChecks(text).find((x) => x.rule === "acceptance-coverage")!;
  expect(f.problem).toContain("Правило П-2 не покрыто");
  const g = new Grounder(doc(text));
  expect(g.find(f.quotes[0]!)).not.toBeNull();
});

test("a code finding is dropped only when a model finding on the same lines names its subject", async () => {
  const { groundCode, notYetFound } = await import("../src/pipeline.ts");
  const text = "Скидка хранится в копейках, сумма заказа в рублях.\n";
  const code = groundCode(doc(text), new Grounder(doc(text)));
  const at = [code[0]!.places[0]!.location];
  expect(notYetFound(code, [{ at, text: "Сумма в рублях, а скидка в копейках: единицы не совпадают" }])).toHaveLength(0);
  expect(notYetFound(code, [{ at, text: "Не сказано, когда применяется скидка" }])).toHaveLength(1);
  expect(notYetFound(code, [{ at: [{ ...at[0]!, line: 9, endLine: 9 }], text: "единицы не совпадают" }])).toHaveLength(1);
});

test("a model finding a rule confirms gets a question even when the model rated it low", async () => {
  const { runChecks } = await import("../src/pipeline.ts");
  const text = "| Поле | Формат |\n| --- | --- |\n| `total` | integer |\n\n| Поле | Тип |\n| --- | --- |\n| total | string |\n";
  const quote = "total string";
  const llm = {
    provider: "fake",
    model: "fake",
    stepModels: {},
    calls: 0,
    cached: 0,
    async json<T>(step: string): Promise<T> {
      if (step === "extract")
        return { title: "t", requirements: [{ doc_id: null, section: "API", type: "data", summary: "total", quote }] } as T;
      if (step.startsWith("check"))
        return {
          results: [
            {
              req_id: "R1",
              findings: [{ criterion: "unambiguous", severity: "low", quote, problem: "Поле total описано как string, а выше как integer: типы не совпадают.", fix: "Указать один тип.", question: "Какой тип у total?" }],
            },
          ],
        } as T;
      return { findings: [], pairs: [], questions: [] } as T;
    },
  };
  const r = await runChecks(doc(text), llm as never);
  expect(r.findings[0]!.confirmedBy).toBe("field-types");
  expect(r.findings[0]!.critical).toBe(false);
  expect(r.setFindings.filter((f) => f.rule === "field-types")).toHaveLength(0);
  expect(r.questions.map((q) => [q.by, q.question])).toContainEqual(["code", "Какой тип у total?"]);
});

test("step 2 withdraws a finding only with a quote from another place that code finds in the document", async () => {
  const { runChecks } = await import("../src/pipeline.ts");
  const text = "* Поле message заполняется при ошибке.\n\n| Поле | Когда |\n| --- | --- |\n| message | При ошибке |\n";
  const quote = "Поле message заполняется при ошибке.";
  const f = (elsewhere: string, answered: boolean) => ({ criterion: "complete", quote, elsewhere, answered, severity: "medium", problem: `Не сказано, когда есть message (${elsewhere || "нет"})`, fix: "", question: "Когда?" });
  const llm = {
    provider: "fake",
    model: "fake",
    stepModels: {},
    calls: 0,
    cached: 0,
    async json<T>(step: string): Promise<T> {
      if (step === "extract") return { title: "t", requirements: [{ doc_id: null, section: "API", type: "data", summary: "m", quote }] } as T;
      if (step.startsWith("check"))
        return { results: [{ req_id: "R1", findings: [f("message При ошибке", true), f("такой строки нет", true), f("", false), f(quote, true)] }] } as T;
      return { findings: [], pairs: [], questions: [] } as T;
    },
  };
  const r = await runChecks(doc(text), llm as never);
  expect(r.answered.map((a) => a.answer.quote)).toEqual(["message При ошибке"]);
  expect(r.answered[0]!.answer.location.line).toBe(5);
  // An answer quote that is not in the document, no answer, or the finding's own line: the finding stays.
  expect(r.findings).toHaveLength(3);
});

test("a withdrawn finding comes back when a rule sees the same defect at the place the model called the answer", async () => {
  const { runChecks } = await import("../src/pipeline.ts");
  const text = "| Поле | Формат |\n| --- | --- |\n| `total` | integer |\n\n| Поле | Тип |\n| --- | --- |\n| total | string |\n";
  const quote = "`total` | integer";
  const llm = {
    provider: "fake",
    model: "fake",
    stepModels: {},
    calls: 0,
    cached: 0,
    async json<T>(step: string): Promise<T> {
      if (step === "extract") return { title: "t", requirements: [{ doc_id: null, section: "API", type: "data", summary: "total", quote }] } as T;
      if (step.startsWith("check"))
        return {
          results: [
            {
              req_id: "R1",
              findings: [{ criterion: "unambiguous", quote, elsewhere: "total | string", answered: true, severity: "medium", problem: "total здесь integer, а в ответе string: типы не совпадают.", fix: "", question: "Какой тип у total?" }],
            },
          ],
        } as T;
      return { findings: [], pairs: [], questions: [] } as T;
    },
  };
  const r = await runChecks(doc(text), llm as never);
  expect(r.answered).toHaveLength(0);
  expect(r.findings.map((f) => f.confirmedBy)).toEqual(["field-types"]);
});

test("low, level-of-detail and template remarks become minor unless a rule confirms them", async () => {
  const { runChecks } = await import("../src/pipeline.ts");
  const text = "| Поле | Формат |\n| --- | --- |\n| `total` | integer |\n\n| Поле | Тип |\n| --- | --- |\n| total | string |\n\n* Контроллер OrdersController.\n";
  const f = (criterion: string, severity: string, quote: string, problem: string) => ({ criterion, quote, elsewhere: "", answered: false, severity, problem, fix: "", question: "?" });
  const llm = {
    provider: "fake",
    model: "fake",
    stepModels: {},
    calls: 0,
    cached: 0,
    async json<T>(step: string): Promise<T> {
      if (step === "extract")
        return {
          title: "t",
          requirements: [
            { doc_id: null, section: "API", type: "data", summary: "total", quote: "`total` | integer" },
            { doc_id: null, section: "API", type: "integration", summary: "c", quote: "Контроллер OrdersController." },
          ],
        } as T;
      if (step.startsWith("check"))
        return {
          results: [
            { req_id: "R1", findings: [f("unambiguous", "low", "`total` | integer", "total integer, а ниже string: типы не совпадают.")] },
            { req_id: "R2", findings: [f("appropriate", "medium", "Контроллер OrdersController.", "Имя класса лишнее."), f("complete", "medium", "Контроллер OrdersController.", "Нет методов контроллера.")] },
          ],
        } as T;
      return { findings: [], pairs: [], questions: [] } as T;
    },
  };
  const r = await runChecks(doc(text), llm as never);
  expect(r.minor.map((x) => x.criterion)).toEqual(["appropriate"]);
  expect(r.findings.map((x) => [x.criterion, x.confirmedBy])).toEqual([["unambiguous", "field-types"], ["complete", undefined]]);
});

test("the acceptance gap counts as found only when the model names the acceptance examples", () => {
  const text = "* **П-1.** Напоминание приходит за 3 дня.\n* **П-2.** При переносе даты напоминание переносится.\n\n### Критерии приёмки\n\n| Условие | Действие | Результат |\n| --- | --- | --- |\n| Оплата 10 марта | Наступило 7 марта | Напоминание приходит 7 марта |\n";
  const f = codeChecks(text).find((x) => x.rule === "acceptance-coverage")!;
  expect(f.topic.test("Не описан случай включения при достигнутом пороге, сценарий не покрыт правилом перехода.")).toBe(false);
  expect(f.topic.test("Ни один критерий не проверяет перенос даты.")).toBe(true);
  expect(f.topic.test("Нет приёмки переноса даты.")).toBe(true);
  expect(f.topic.test("Перенос даты не покрыт критериями приёмки.")).toBe(true);
});
