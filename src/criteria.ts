// Quality criteria from ISO/IEC/IEEE 29148:2018 (5.2.5, 5.2.6) and IEEE Std 830-1998 (4.3).

export const INDIVIDUAL = [
  "necessary",
  "appropriate",
  "unambiguous",
  "complete",
  "singular",
  "feasible",
  "verifiable",
  "correct",
  "conforming",
  "traceable",
] as const;

export const SET = [
  "complete",
  "consistent",
  "feasible",
  "comprehensible",
  "validatable",
  "ranked",
  "modifiable",
] as const;

export type IndividualCriterion = (typeof INDIVIDUAL)[number];
export type SetCriterion = (typeof SET)[number];

interface CriterionInfo {
  name: string;
  short: string;
  source: string;
  question: string;
}

export const INDIVIDUAL_INFO: Record<IndividualCriterion, CriterionInfo> = {
  necessary: {
    name: "Необходимость",
    short: "Необх.",
    source: "29148 5.2.5 a",
    question:
      "Требование задаёт существенную возможность или ограничение. Без него появится дефицит, который другие требования не закрывают.",
  },
  appropriate: {
    name: "Уместность уровня",
    short: "Уровн.",
    source: "29148 5.2.5 b",
    question:
      "Детализация соответствует уровню документа. Требование говорит, ЧТО нужно, и не навязывает проектное решение (КАК), если это не обязательное ограничение.",
  },
  unambiguous: {
    name: "Однозначность",
    short: "Однозн.",
    source: "29148 5.2.5 c; 830 4.3.2",
    question:
      "Формулировку можно понять только одним способом. Нет размытых слов, неопределённых терминов, неясных ссылок и единиц.",
  },
  complete: {
    name: "Полнота",
    short: "Полн.",
    source: "29148 5.2.5 d; 830 4.3.3",
    question:
      "Требование описывает всё, что нужно для его реализации: входы, реакцию на допустимые и недопустимые значения, граничные случаи, единицы измерения. Нет TBD и пустых полей.",
  },
  singular: {
    name: "Единичность",
    short: "Един.",
    source: "29148 5.2.5 e",
    question:
      "Требование задаёт одну возможность, характеристику или ограничение. Несколько независимых условий в одном пункте нарушают критерий.",
  },
  feasible: {
    name: "Выполнимость",
    short: "Выполн.",
    source: "29148 5.2.5 f",
    question: "Требование реализуемо в рамках описанных систем и ограничений.",
  },
  verifiable: {
    name: "Проверяемость",
    short: "Пров.",
    source: "29148 5.2.5 g; 830 4.3.6",
    question:
      "Есть конечный объективный способ доказать выполнение: измеримый порог, точка измерения, условие, ожидаемый результат.",
  },
  correct: {
    name: "Корректность",
    short: "Корр.",
    source: "29148 5.2.5 h; 830 4.3.1",
    question:
      "Требование верно отражает потребность, заявленную в целях и бизнес-процессе, и не содержит фактических ошибок.",
  },
  conforming: {
    name: "Соответствие шаблону",
    short: "Шабл.",
    source: "29148 5.2.5 i",
    question:
      "Требование оформлено по принятому в документе шаблону и стилю: идентификатор, формулировка, применимые разделы.",
  },
  traceable: {
    name: "Трассируемость",
    short: "Трасс.",
    source: "830 4.3.8",
    question:
      "У требования есть уникальный идентификатор и понятный источник, на него можно сослаться из тестов и кода.",
  },
};

export const SET_INFO: Record<SetCriterion, CriterionInfo> = {
  complete: {
    name: "Полнота набора",
    short: "Полн.",
    source: "29148 5.2.6 a; 830 4.3.3",
    question:
      "Набор покрывает все цели, сценарии, ошибки, роли и интерфейсы. Нет пустых разделов и пропущенных сценариев.",
  },
  consistent: {
    name: "Непротиворечивость",
    short: "Непрот.",
    source: "29148 5.2.6 b; 830 4.3.4",
    question:
      "Требования не противоречат друг другу, критериям приёмки, диаграммам и дочерним документам. Термины и единицы используются одинаково.",
  },
  feasible: {
    name: "Выполнимость набора",
    short: "Выполн.",
    source: "29148 5.2.6 c",
    question: "Набор реализуем целиком, в пределах ограничений по срокам, системам и рискам.",
  },
  comprehensible: {
    name: "Понятность",
    short: "Понятн.",
    source: "29148 5.2.6 d",
    question:
      "Понятно, что ожидается от системы и как она связана с окружением. Структура и ссылки между частями ясны.",
  },
  validatable: {
    name: "Валидируемость",
    short: "Валид.",
    source: "29148 5.2.6 e",
    question:
      "Можно доказать, что набор требований решает бизнес-задачу: есть критерии приёмки, покрывающие требования.",
  },
  ranked: {
    name: "Ранжированность",
    short: "Ранж.",
    source: "830 4.3.5",
    question: "Указаны важность и стабильность требований (приоритеты).",
  },
  modifiable: {
    name: "Модифицируемость",
    short: "Модиф.",
    source: "830 4.3.7",
    question:
      "Структура позволяет вносить изменения: есть версия, нет дублирования одного правила в разных местах с разными формулировками.",
  },
};

/** Defects the brief calls critical: unverifiable, contradictory, incomplete. */
export const CRITICAL_CRITERIA = new Set<string>(["verifiable", "consistent", "complete"]);

export function describeCriteria(info: Record<string, CriterionInfo>): string {
  return Object.entries(info)
    .map(([key, c]) => `- ${key} — ${c.name} (${c.source}): ${c.question}`)
    .join("\n");
}
