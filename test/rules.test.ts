import { expect, test } from "bun:test";
import { Grounder } from "../src/ground.ts";
import type { SourceDoc } from "../src/load.ts";
import { codeChecks, relatedPairs } from "../src/rules.ts";

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

test("related pairs put a limit next to its override and an acceptance case next to its rule", () => {
  const reqs = [
    { id: "R1", type: "functional", quote: "Клиент получает напоминание об оплате максимум один раз в неделю." },
    { id: "R2", type: "functional", quote: "При смене даты оплаты напоминание приходит снова независимо от прошлых напоминаний." },
    { id: "R3", type: "functional", quote: "Дата оплаты определяется по часовому поясу клиента." },
    { id: "R4", type: "acceptance", quote: "Платёж на 1 марта в 23:50 по часовому поясу банка попадает в мартовский отчёт." },
    { id: "R5", type: "ui", quote: "Экран показывает список платежей и кнопку «Оплатить»." },
  ];
  const pairs = relatedPairs(reqs);
  expect(pairs).toContainEqual(["R3", "R4"]);
  expect(pairs).toContainEqual(["R1", "R2"]);
  expect(pairs.flat()).not.toContain("R5");
});
