import { INDIVIDUAL, INDIVIDUAL_INFO, type IndividualCriterion, SET, SET_INFO, type SetCriterion } from "./criteria.ts";
import { formatLocation, type Location } from "./load.ts";
import { assess, bySeverity, type RunResult, reqLabel, type Severity, type Verdict } from "./pipeline.ts";
import type { Addressee } from "./prompts.ts";

export interface Passport {
  file: string;
  format: string;
  pages?: number;
  sha256: string;
  startedAt: Date;
  durationMs: number;
  provider: string;
  model: string;
  stepModels: Record<string, string>;
  agentVersion: string;
  calls: number;
  cached: number;
  /** File with the author's answers to an earlier run's questions. */
  answersFile?: string;
}

const SEVERITY: Record<Severity, string> = { high: "высокая", medium: "средняя", low: "низкая" };
const TYPE: Record<string, string> = {
  functional: "функц.",
  nonfunctional: "нефункц.",
  data: "данные",
  integration: "интеграция",
  interface: "интерфейс",
  ui: "UI",
  acceptance: "приёмка",
  other: "прочее",
};
const TOP_FIXES = 10;

function cell(s: string | number | null | undefined): string {
  return String(s ?? "—")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim() || "—";
}

function table(head: string[], rows: (string | number | null | undefined)[][]): string {
  return [
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
  ].join("\n");
}

const q = (s: string) => `«${s.replace(/\s+/g, " ").trim()}»`;

type Place = { quote: string; location: Location };
/** «1) да; 2) нет». */
export const formatOptions = (options: string[]) => options.map((o, i) => `${i + 1}) ${o}`).join("; ");
/** «строка 12; строка 40». */
export const formatPlaces = (places: Place[]) => places.map((pl) => formatLocation(pl.location)).join("; ");
const quotedPlaces = (places: Place[]) => places.map((pl) => `${q(pl.quote)} (${formatLocation(pl.location)})`).join("; ");

export const ADDRESSEE: Record<Addressee, string> = {
  business: "Бизнес-заказчику",
  analyst: "Аналитику",
  architect: "Архитектору",
  qa: "Тестированию",
  security: "Безопасности",
};

function formatDate(d: Date): string {
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const mm = String(Math.abs(offset) % 60).padStart(2, "0");
  const local = new Date(d.getTime() + offset * 60_000).toISOString().slice(0, 19).replace("T", " ");
  return `${local} (UTC${sign}${hh}:${mm})`;
}

export function renderReport(r: RunResult, p: Passport): string {
  const reqById = new Map(r.requirements.map((x) => [x.id, x]));
  const label = (id: string) => reqLabel(id, reqById.get(id)?.docId);
  const findingsOf = (id: string) => r.findings.filter((f) => f.reqId === id).sort(bySeverity);
  const allCritical = [...r.findings.filter((f) => f.critical), ...r.setFindings.filter((f) => f.critical)];

  const out: string[] = [];
  out.push(`# Отчёт о проверке требований`, "", `**Документ:** ${r.title}`, "");
  if (p.model === "fixture")
    out.push("> **Тестовый прогон.** Ответы модели взяты из фикстур, это не результат проверки моделью.", "");

  // 1. Passport
  out.push("## 1. Паспорт прогона", "");
  out.push(
    table(
      ["Поле", "Значение"],
      [
        ["Название документа", r.title],
        ["Файл", `\`${p.file}\``],
        ["Формат", p.pages ? `${p.format.toUpperCase()}, страниц: ${p.pages}` : p.format.toUpperCase()],
        ["SHA-256 файла", `\`${p.sha256}\``],
        ["Дата прогона", formatDate(p.startedAt)],
        ["Длительность", `${(p.durationMs / 1000).toFixed(1)} с`],
        ["Провайдер LLM", p.provider],
        ["Модель", modelLine(p)],
        ["Запросов к API", p.cached ? `${p.calls}, ещё шагов из кэша прошлого прогона: ${p.cached}` : p.calls],
        ["Уточнения автора", p.answersFile ? `ответов: ${r.answers.length}, файл \`${p.answersFile}\`` : "нет, первый прогон"],
        ["Версия агента", `\`${p.agentVersion}\``],
        ["Критерии", "ISO/IEC/IEEE 29148:2018 п. 5.2.5, 5.2.6; IEEE Std 830-1998 п. 4.3"],
      ],
    ),
    "",
  );

  // 2. Slicing
  out.push("## 2. Как агент нарезал требования", "");
  out.push(
    "Идентификаторы ТР-NN присвоил агент в порядке документа. Колонка «ID в документе» пустая, если в документе у требования нет номера. Место в документе агент нашёл по цитате программно.",
    "",
  );
  out.push(
    table(
      ["ID в отчёте", "ID в документе", "Тип", "Раздел", "Место", "Краткая формулировка", "Цитата"],
      r.requirements.map((x) => [
        x.id,
        x.docId,
        TYPE[x.type] ?? x.type,
        x.section,
        x.location ? formatLocation(x.location) : "цитата не найдена дословно",
        x.summary,
        q(x.quote),
      ]),
    ),
    "",
  );

  // 3. Per-requirement checks
  out.push("## 3. Проверка каждого требования", "");
  out.push("### 3.1. Матрица критериев", "");
  out.push(
    "✓ — нарушений не найдено, ✗ — есть нарушение, **✗** — есть критичное нарушение, — — модель не вернула оценку. Критерии: " +
      INDIVIDUAL.map((c) => `${INDIVIDUAL_INFO[c].short} — ${INDIVIDUAL_INFO[c].name} (${INDIVIDUAL_INFO[c].source})`).join("; ") +
      ".",
    "",
  );
  out.push(
    table(
      ["ID", "ID в док.", ...INDIVIDUAL.map((c) => INDIVIDUAL_INFO[c].short), "Нарушений"],
      r.requirements.map((x) => {
        const fs = findingsOf(x.id);
        if (!x.checked) return [x.id, x.docId, ...INDIVIDUAL.map(() => "—"), "**не проверено**"];
        return [
          x.id,
          x.docId,
          ...INDIVIDUAL.map((c) => {
            const hit = fs.filter((f) => f.criterion === c);
            if (hit.length === 0) return "✓";
            return hit.some((f) => f.critical) ? "**✗**" : "✗";
          }),
          fs.length,
        ];
      }),
    ),
    "",
  );

  out.push("### 3.2. Требования по порядку", "");
  for (const x of r.requirements) {
    const fs = findingsOf(x.id);
    out.push(`#### ${label(x.id)}. ${x.summary}`, "");
    out.push(`> ${x.quote.replace(/\s*\n\s*/g, " ")}`, "");
    out.push(`Раздел: ${x.section}. Место: ${x.location ? formatLocation(x.location) : "цитата не найдена дословно"}.`, "");
    if (!x.checked) {
      out.push("**Не проверено.** Модель не вернула оценку этого требования даже после повторного запроса. Проверьте его вручную или повторите прогон.", "");
      continue;
    }
    if (fs.length === 0) {
      out.push("Нарушений по критериям 29148 п. 5.2.5 и IEEE 830 п. 4.3 агент не нашёл.", "");
      continue;
    }
    out.push(
      table(
        ["Критерий", "Серьёзность", "Место", "Цитата", "Нарушение", "Как исправить", "Вопрос автору"],
        fs.map((f) => [
          INDIVIDUAL_INFO[f.criterion].name,
          f.critical ? `**${SEVERITY[f.severity]}, критично**` : SEVERITY[f.severity],
          formatLocation(f.location),
          q(f.quote),
          f.problem,
          f.fix,
          f.question,
        ]),
      ),
      "",
    );
  }

  // 4. Set checks
  out.push("## 4. Проверка всего набора требований", "");
  const byCode = r.setFindings.filter((f) => f.by === "code").length;
  if (byCode)
    out.push(
      `Находки с пометкой «найдено кодом» (${byCode}) агент нашёл правилами в коде без модели: одна сумма в двух единицах, одно поле с двумя типами, GET для изменения данных, JSON без тела, код ответа не своего раздела, пустые поля. Модель их не нашла, поэтому код добавил их сам.`,
      "",
    );
  out.push(
    table(
      ["Критерий", "Источник", "Итог", "Находок"],
      SET.map((c) => {
        const fs = r.setFindings.filter((f) => f.criterion === c);
        const verdict = fs.length === 0 ? "выполнен" : fs.some((f) => f.critical) ? "**нарушен, критично**" : "нарушен";
        return [SET_INFO[c].name, SET_INFO[c].source, verdict, fs.length];
      }),
    ),
    "",
  );
  // The pipeline already sorted the set findings by severity and numbered them in that order.
  for (const f of r.setFindings) {
    out.push(`#### ${f.id}. ${SET_INFO[f.criterion].name}, ${SEVERITY[f.severity]}${f.critical ? ", критично" : ""}${f.by === "code" ? ", найдено кодом" : ""}`, "");
    out.push(`- Места: ${quotedPlaces(f.places)}.`);
    if (f.reqIds.length) out.push(`- Требования: ${f.reqIds.map(label).join(", ")}.`);
    out.push(`- Нарушение: ${f.problem}`, `- Как исправить: ${f.fix}`, `- Вопрос автору: ${f.question}`, "");
  }
  if (r.setFindings.length === 0) out.push("Нарушений на уровне набора агент не нашёл.", "");

  // 5. Summary
  const withDefects = r.requirements.filter((x) => findingsOf(x.id).length > 0).length;
  const unchecked = r.requirements.filter((x) => !x.checked).map((x) => x.id);
  const total = r.findings.length + r.setFindings.length;
  out.push("## 5. Сводка", "");
  out.push(
    table(
      ["Показатель", "Значение"],
      [
        ["Требований выделено", r.requirements.length],
        ["Требований с нарушениями", `${withDefects} из ${r.requirements.length}`],
        ["Требований не проверено моделью", unchecked.length ? `${unchecked.length}: ${unchecked.join(", ")}` : 0],
        ["Нарушений всего", total],
        ["В отдельных требованиях", r.findings.length],
        ["В наборе требований", r.setFindings.length],
        ["Критичных нарушений", allCritical.length],
        ...(["high", "medium", "low"] as const).map((s) => [
          `Серьёзность «${SEVERITY[s]}»`,
          [...r.findings, ...r.setFindings].filter((f) => f.severity === s).length,
        ]),
      ],
    ),
    "",
  );
  out.push("### Нарушения по критериям", "");
  out.push(
    table(
      ["Критерий", "Уровень", "Нарушений", "Критичных"],
      [
        ...INDIVIDUAL.map((c) => {
          const fs = r.findings.filter((f) => f.criterion === c);
          return [INDIVIDUAL_INFO[c].name, "требование", fs.length, fs.filter((f) => f.critical).length];
        }),
        ...SET.map((c) => {
          const fs = r.setFindings.filter((f) => f.criterion === c);
          return [SET_INFO[c].name, "набор", fs.length, fs.filter((f) => f.critical).length];
        }),
      ].filter((row) => (row[2] as number) > 0),
    ),
    "",
  );
  out.push("### Критичные дефекты", "");
  out.push(
    "Критичным агент считает нарушение с высокой серьёзностью, а также непроверяемость, неполноту и противоречие со средней серьёзностью.",
    "",
  );
  if (allCritical.length === 0) out.push("Критичных дефектов не найдено.", "");
  else
    out.push(
      table(
        ["Где", "Критерий", "Место", "Суть"],
        allCritical.sort(bySeverity).map((f) =>
          "reqId" in f
            ? [label(f.reqId), INDIVIDUAL_INFO[f.criterion].name, formatLocation(f.location), f.problem]
            : [
                `${f.id} (набор${f.by === "code" ? ", код" : ""})`,
                SET_INFO[f.criterion].name,
                formatPlaces(f.places),
                f.problem,
              ],
        ),
      ),
      "",
    );

  // 6. Verdict
  out.push("## 6. Итог", "");
  out.push(verdictText(assess(r)), "");
  if (allCritical.length || total) {
    out.push("Что исправить в первую очередь:", "");
    const top = (allCritical.length ? allCritical : [...r.findings, ...r.setFindings]).sort(bySeverity).slice(0, TOP_FIXES);
    top.forEach((f, i) => {
      const where = "reqId" in f ? `${label(f.reqId)}, ${formatLocation(f.location)}` : `${f.id}, ${formatLocation(f.places[0]!.location)}`;
      out.push(`${i + 1}. ${where}. ${f.fix}`);
    });
    if (allCritical.length > TOP_FIXES) out.push("", `Остальные критичные дефекты (${allCritical.length - TOP_FIXES}) перечислены в разделе 5.`);
    out.push("");
  }
  if (r.questions.length) {
    const crit = r.questions.filter((x) => x.critical).length;
    out.push(
      `Чтобы исправить документ, автору нужно ответить на уточняющие вопросы из раздела 7. Вопросов: ${r.questions.length}, из них по критичным дефектам: ${crit}.`,
      "",
    );
  }

  // 7. Clarifying questions
  out.push("## 7. Уточняющие вопросы к автору документа", "");
  if (r.questions.length === 0) out.push("Вопросов нет: агент не нашёл нарушений, которые требуют уточнения.", "");
  else {
    out.push(
      r.questionsFallback
        ? "Шаг составления вопросов не удался, поэтому вопросы ниже составил код из критичных находок и находок правил, по одному на требование или правило."
        : "Агент объединил находки, на которые отвечает один и тот же ответ, в один вопрос и расположил вопросы по важности. Каждый вопрос ссылается на находки и места документа, из которых он вырос.",
      "",
    );
    // Code-added questions are drafts from single findings; they follow the model's list in their own part so the
    // merged questions with answer options stay first and short.
    const split = !r.questionsFallback && r.questions.some((x) => x.by === "code") && r.questions.some((x) => x.by === "model");
    const main = split ? r.questions.filter((x) => x.by === "model") : r.questions;
    const extra = split ? r.questions.filter((x) => x.by === "code") : [];
    const questionTable = (qs: typeof r.questions) =>
      table(
        ["№", "Кому", "Вопрос", "Место"],
        qs.map((x) => [x.critical ? `**${x.id}**` : x.id, ADDRESSEE[x.addressee], x.question, formatPlaces(x.places)]),
      );
    const questionBlocks = (qs: typeof r.questions) => {
      for (const x of qs) {
        out.push(`#### ${x.id}. ${ADDRESSEE[x.addressee]}${x.critical ? ", по критичному дефекту" : ""}`, "");
        out.push(`**${x.question}**`, "");
        out.push(`- Почему важно: ${x.why}`);
        if (x.options.length) out.push(`- Варианты ответа: ${formatOptions(x.options)}`);
        out.push(`- Места: ${quotedPlaces(x.places)}`);
        out.push(`- Из находок: ${x.sources.join("; ")}`, "");
      }
    };
    out.push(questionTable(main), "");
    questionBlocks(main);
    if (extra.length) {
      out.push("### Вопросы по остальным критичным находкам", "");
      out.push(
        `Эти вопросы (${extra.length}) добавил код. Модель не включила эти находки ни в один вопрос выше, а каждая из них критичная или найдена правилом, поэтому без ответа автора её не исправить. Вопрос взят из самой серьёзной находки по требованию или правилу.`,
        "",
      );
      out.push(questionTable(extra), "");
      questionBlocks(extra);
    }
  }
  if (r.answers.length) {
    out.push("### Учтённые ответы автора", "");
    out.push("Эти ответы на вопросы прошлого прогона агент передал модели как дополнения к документу.", "");
    out.push(table(["Вопрос", "Ответ автора"], r.answers.map((a) => [a.question, a.answer])), "");
  }

  if (r.rejected.length) {
    out.push("## Приложение. Отклонённые находки", "");
    out.push(
      `Цитат этих находок модели нет в документе дословно (всего: ${r.rejected.length}). Агент не включил их в подсчёты и выводы, чтобы в отчёте не было нарушений без привязки к тексту.`,
      "",
    );
    out.push(
      table(
        ["Где", "Критерий", "Цитата модели", "Суть"],
        r.rejected.map((x) => [
          x.scope,
          (x.scope === "набор" ? SET_INFO[x.criterion as SetCriterion] : INDIVIDUAL_INFO[x.criterion as IndividualCriterion])?.name ?? x.criterion,
          x.quotes.map(q).join("; "),
          x.problem,
        ]),
      ),
      "",
    );
  }

  return out.join("\n");
}

/** One model normally; with fallback, which steps each model answered. */
function modelLine(p: Passport): string {
  const byModel = new Map<string, string[]>();
  for (const [step, m] of Object.entries(p.stepModels)) byModel.set(m, [...(byModel.get(m) ?? []), step]);
  if (byModel.size === 0) return p.model;
  if (byModel.size === 1) return [...byModel.keys()][0]!;
  return [...byModel].map(([m, steps]) => `${m} (шаги: ${steps.join(", ")})`).join("; ");
}

function verdictText(v: Verdict): string {
  if (v.requirements === 0) return "**Нет.** Агент не выделил в документе ни одного требования.";
  const unchecked = v.unchecked.join(", ");
  switch (v.decision) {
    case "no": {
      const gap = unchecked ? ` Кроме того, модель не проверила требования ${unchecked}, по ним вывода нет.` : "";
      return `**Нет, начинать разработку и тестирование по документу в текущем виде нельзя.** Найдено критичных дефектов: ${v.critical}. По затронутым требованиям нельзя однозначно реализовать функцию или написать тест с ожидаемым результатом. Сначала исправьте пункты ниже и повторите проверку.${gap}`;
    }
    case "incomplete":
      return `**Нет, проверка неполная.** Модель не вернула оценку требований ${unchecked}. Повторите прогон, прежде чем принимать решение.`;
    case "with_reservations":
      return `**Можно, с оговорками.** Критичных дефектов нет, но найдено ${v.violations} некритичных нарушений. Их стоит исправить до приёмки.`;
    case "yes":
      return "**Да.** Нарушений не найдено, документ можно передавать в разработку и тестирование.";
  }
}

