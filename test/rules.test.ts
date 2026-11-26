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
