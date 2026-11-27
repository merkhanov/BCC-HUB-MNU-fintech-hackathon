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

test("Ф-3 against Ф-4 counts when a limit and its override are named, even without the word «противоречие»", () => {
  const quotes = [{ quote: "Ф-3. На карту приходится максимум один такой push за календарный месяц." }, { quote: "Ф-4. следующее достижение вызывает push независимо от истории предыдущей настройки." }];
  const rows = recall({
    findings: [
      finding("следующее достижение вызывает push независимо от истории предыдущей настройки", "Формулировка «независимо от истории предыдущей настройки» не описывает конкретный ожидаемый флаг или триггер в базе данных"),
    ],
    setFindings: [
      { id: "Н-03", criterion: "consistent", places: quotes, problem: "Требование Ф-3 ограничивает количество push до одного на карту за календарный месяц, а требование Ф-4 обязывает отправлять push при достижении нового порога независимо от ранее отправленных уведомлений.", fix: "" },
    ],
  });
  expect(rows.find((r) => r.defect.id === "f3-vs-f4")!.hits).toEqual(["Н-03"]);
});

test("acceptance gaps count when the finding says no criterion checks a rule, not only «не покрыто»", () => {
  const rows = recall({
    findings: [],
    setFindings: [
      { id: "Н-36", criterion: "validatable", places: [{ quote: "Держатель активной карты KZT задаёт целый порог от 1 000 до 1 000 000 ₸" }], problem: "Ни один критерий не проверяет обе включённые границы.", fix: "" },
      { id: "Н-38", criterion: "validatable", places: [{ quote: "Ф-4. При изменении порога накопленная сумма сохраняется." }], problem: "Проверяется только точное достижение. Нет приёмки изменения порога с сохранением суммы.", fix: "" },
      { id: "Н-39", criterion: "validatable", places: [{ quote: "Сервис передаёт push на отправку в течение минуты" }], problem: "Критерий не измеряет минутный норматив.", fix: "" },
    ],
  });
  expect(rows.find((r) => r.defect.id === "acceptance-gaps")!.hits).toEqual(["Н-36", "Н-38"]);
});

test("Ф-3 against Ф-4 also counts when the finding calls it «неоднозначность»", () => {
  const places = [{ quote: "Ф-3. На карту приходится максимум один такой push за календарный месяц." }, { quote: "Ф-4. следующее достижение вызывает push независимо от истории предыдущей настройки." }];
  const rows = recall({
    findings: [],
    setFindings: [{ id: "Н-03", criterion: "consistent", places, problem: "Ф-3 устанавливает жёсткое ограничение в максимум одно push-уведомление, тогда как Ф-4 обязывает отправить push. При смене порога возникнет неоднозначность реализации.", fix: "" }],
  });
  expect(rows.find((r) => r.defect.id === "f3-vs-f4")!.hits).toEqual(["Н-03"]);
});
