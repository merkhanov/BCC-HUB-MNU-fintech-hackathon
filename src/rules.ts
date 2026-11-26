import type { SetCriterion } from "./criteria.ts";
import type { Severity } from "./pipeline.ts";

/**
 * Checks that code runs over the document text without calling the model. Each rule is a general pattern
 * (one quantity in two units, one field with two types, a mutating GET, a status section that names another
 * code), so its findings are the same on every run. Quotes are copied from the document, so they always ground.
 * Tables and headings are read as Markdown; on PDF and DOCX text only the line-based rules fire.
 */
export interface CodeFinding {
  rule: string;
  criterion: SetCriterion;
  severity: Severity;
  quotes: string[];
  problem: string;
  fix: string;
  question: string;
  /** What a model finding must mention to count as the same defect, so code adds only what the model missed. */
  topic: RegExp;
}

interface Line {
  no: number;
  text: string;
}

/** Text of a line without Markdown emphasis, code marks and table pipes. */
const clean = (s: string) =>
  s
    .replace(/^\s*#+\s*/, "")
    .replace(/[*`]/g, "")
    .replace(/\s*\|\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The sentence of a line that contains the match, so a quote stays short. */
function sentenceWith(text: string, re: RegExp): string {
  const parts = clean(text).split(/(?<=[.!?])\s+/);
  return parts.find((p) => re.test(p)) ?? clean(text);
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.replace(/[*`]/g, "").trim());

function tables(lines: Line[]): { header: string[]; rows: { cells: string[]; line: Line }[] }[] {
  const out: { header: string[]; rows: { cells: string[]; line: Line }[] }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]!.text.trim().startsWith("|") || !/^\s*\|?\s*:?-{2,}/.test(lines[i + 1]?.text ?? "")) continue;
    const header = cells(lines[i]!.text).map((h) => h.toLowerCase());
    const rows: { cells: string[]; line: Line }[] = [];
    let j = i + 2;
    for (; j < lines.length && lines[j]!.text.trim().startsWith("|"); j++) rows.push({ cells: cells(lines[j]!.text), line: lines[j]! });
    out.push({ header, rows });
    i = j - 1;
  }
  return out;
}

const CURRENCIES = [
  { major: /тенге|₸|\bKZT\b/iu, minor: /тиын/iu, majorName: "тенге", minorName: "тиын" },
  { major: /рубл|₽|\bRUB\b/iu, minor: /копе[ейк]/iu, majorName: "рубль", minorName: "копейка" },
  { major: /доллар|\bUSD\b/iu, minor: /цент/iu, majorName: "доллар", minorName: "цент" },
];
const CONVERSION = /(=\s*100\b|\b100\s*(тиын|коп|цент)|(раздел|умнож|дел)\p{L}*\s+на\s+100|[×x*]\s*100\b)/iu;

/** One currency in its major and minor units, with no stated conversion between them. */
function moneyUnits(lines: Line[]): CodeFinding[] {
  if (lines.some((l) => CONVERSION.test(l.text))) return [];
  const out: CodeFinding[] = [];
  for (const c of CURRENCIES) {
    const minor = lines.find((l) => c.minor.test(l.text));
    const major = lines.find((l) => c.major.test(l.text) && l !== minor);
    if (!minor || !(c.major.test(minor.text) || major)) continue;
    const both = c.major.test(sentenceWith(minor.text, c.minor));
    const quotes = both ? [sentenceWith(minor.text, c.minor)] : [sentenceWith(minor.text, c.minor), sentenceWith(major!.text, c.major)];
    out.push({
      rule: "money-units",
      criterion: "consistent",
      severity: "medium",
      quotes,
      problem: `Суммы заданы в разных единицах одной валюты: «${c.majorName}» и «${c.minorName}». Правило пересчёта между ними в документе не указано, поэтому сравнение таких сумм без пересчёта ошибается в 100 раз.`,
      fix: `Укажите одну единицу для хранения и сравнения сумм или явно задайте пересчёт (1 ${c.majorName} = 100 ${c.minorName}) и место, где он выполняется.`,
      question: `В каких единицах хранятся и сравниваются суммы и где выполняется пересчёт между «${c.majorName}» и «${c.minorName}»?`,
      topic: new RegExp(`${c.minorName.slice(0, 4)}|единиц`, "iu"),
    });
  }
  return out;
}

const TYPE_CLASSES: [RegExp, string][] = [
  [/^(int|integer|long|short|number|numeric|decimal|float|double|число|целое)/i, "число"],
  [/^(string|str|text|строка)/i, "строка"],
  [/^(bool|boolean)/i, "логическое"],
];

/** The same field name with types of different kinds in different tables, e.g. integer in a request and string in a response. */
function fieldTypes(lines: Line[]): CodeFinding[] {
  const seen = new Map<string, Map<string, { type: string; quote: string }>>();
  for (const t of tables(lines)) {
    const typeCol = t.header.findIndex((h) => /^(format|type|тип|формат)$/.test(h));
    const nameCol = Math.max(0, t.header.findIndex((h) => /^(parameter|параметр|поле|field|name|имя)$/.test(h)));
    if (typeCol < 0) continue;
    for (const r of t.rows) {
      const name = r.cells[nameCol];
      const type = r.cells[typeCol] ?? "";
      const cls = TYPE_CLASSES.find(([re]) => re.test(type))?.[1];
      if (!name || !cls) continue;
      const byClass = seen.get(name) ?? new Map();
      if (!byClass.has(cls)) byClass.set(cls, { type, quote: clean(r.line.text) });
      seen.set(name, byClass);
    }
  }
  const out: CodeFinding[] = [];
  for (const [name, byClass] of seen) {
    if (byClass.size < 2) continue;
    const kinds = [...byClass.values()];
    out.push({
      rule: "field-types",
      criterion: "consistent",
      severity: "medium",
      quotes: kinds.slice(0, 3).map((k) => k.quote),
      problem: `Поле «${name}» описано с разными типами: ${kinds.map((k) => k.type).join(" и ")}. Клиент и сервер, написанные по разным таблицам, разойдутся в формате.`,
      fix: `Задайте полю «${name}» один тип во всех таблицах или явно опишите преобразование.`,
      question: `Какой тип у поля «${name}» в запросе и в ответе и нужно ли его преобразовывать?`,
      topic: new RegExp(`(${name}[\\s\\S]*(тип|string|integer|строк|числ))|((тип|string|integer)[\\s\\S]*${name})`, "iu"),
    });
  }
  return out;
}

const METHOD_LINE = /(REST type|HTTP[- ]?(method|метод)|метод запроса|тип запроса|method)\W[^\n]*?\b(GET|POST|PUT|PATCH|DELETE)\b/i;
const MUTATING_PATH = /\/[\w/-]*?(save|create|update|delete|remove|set|add|edit|change|insert)\w*/i;
const MUTATING_WORD = /(сохран|созда|измен|удал|обнов|запис)\p{L}*/iu;

/** A GET method whose path or description says it changes data. */
function mutatingGet(lines: Line[]): CodeFinding[] {
  const method = lines.find((l) => METHOD_LINE.exec(l.text)?.[3]?.toUpperCase() === "GET");
  if (!method) return [];
  const evidence =
    lines.find((l) => l !== method && MUTATING_PATH.test(l.text) && !/curl/i.test(l.text)) ??
    lines.find((l) => l !== method && /(description|описание)/i.test(l.text) && MUTATING_WORD.test(l.text));
  if (!evidence) return [];
  const what = MUTATING_PATH.exec(evidence.text)?.[0] ?? MUTATING_WORD.exec(evidence.text)?.[0] ?? "";
  return [
    {
      rule: "mutating-get",
      criterion: "consistent",
      severity: "medium",
      quotes: [clean(method.text), sentenceWith(evidence.text, new RegExp(what.replace(/[/\\^$.*+?()[\]{}|]/g, "\\$&"), "i"))],
      problem: `Метод объявлен как GET, но по описанию он меняет данные («${what}»). По HTTP запрос GET не должен менять состояние: его повторяют, кэшируют и логируют вместе с параметрами.`,
      fix: "Опишите сохранение методом POST, PUT или PATCH с параметрами в теле, а чтение отдельным методом GET.",
      question: "Какой HTTP-метод должен сохранять настройку и есть ли отдельный метод для её чтения?",
      topic: /\bGET\b/,
    },
  ];
}

/** JSON declared as the content type of a request that, by the same document, has no body. */
function jsonWithoutBody(lines: Line[]): CodeFinding[] {
  const ct = lines.find((l) => /content-type/i.test(l.text) && /application\/json/i.test(l.text));
  if (!ct) return [];
  const noBody = lines.find(
    (l) => Math.abs(l.no - ct.no) <= 5 && /(тело|body)[^.\n]{0,30}(не используется|отсутствует|не переда[её]тся|not used|is empty|none)/iu.test(l.text),
  );
  if (!noBody) return [];
  return [
    {
      rule: "json-without-body",
      criterion: "consistent",
      severity: "low",
      quotes: [clean(ct.text), clean(noBody.text)],
      problem: "Для запроса указан Content-Type application/json, но тут же сказано, что тело запроса не используется. Непонятно, передаются ли параметры в JSON или только в строке запроса.",
      fix: "Уберите Content-Type для запроса без тела или опишите JSON-тело запроса.",
      question: "Передаёт ли запрос тело в JSON или параметры идут только в строке запроса?",
      topic: /тел[оа]|body|content-type/i,
    },
  ];
}

/** A response section headed with one status code whose text returns another, and a success section that shows an error. */
function statusSections(lines: Line[]): CodeFinding[] {
  const out: CodeFinding[] = [];
  for (let i = 0; i < lines.length; i++) {
    const h = /^(#{2,6})\s+\**\s*([1-5]\d{2})\b/.exec(lines[i]!.text);
    if (!h) continue;
    const level = h[1]!.length;
    const code = h[2]!;
    const body: Line[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const next = /^(#{1,6})\s/.exec(lines[j]!.text);
      if (next && next[1]!.length <= level) break;
      body.push(lines[j]!);
    }
    const other = body.find((l) => {
      const m = /(возвраща\p{L}*|returns?|код\p{L}*|статус\p{L}*|status)\D{0,20}\b([1-5]\d{2})\b/iu.exec(l.text) ?? /^\s*\*\*([1-5]\d{2})\*\*\s*$/.exec(l.text);
      const named = m?.[m.length - 1];
      return named !== undefined && named !== code;
    });
    if (other) {
      const named = /\b([1-5]\d{2})\b/.exec(clean(other.text))![1]!;
      out.push({
        rule: "status-section",
        criterion: "consistent",
        severity: "medium",
        quotes: [clean(lines[i]!.text), clean(other.text)],
        problem: `Раздел ответа озаглавлен кодом ${code}, но в его тексте возвращается код ${named}. По документу нельзя понять, какой код получит клиент в этом случае.`,
        fix: `Оставьте в разделе ${code} только ответ с этим кодом, а случай с кодом ${named} опишите в своём разделе.`,
        question: `Какой код ответа получает клиент в случае, описанном в разделе ${code}: ${code} или ${named}?`,
        topic: new RegExp(`(${code}[\\s\\S]*${named})|(${named}[\\s\\S]*${code})`),
      });
    }
    const error = code.startsWith("2") ? body.find((l) => /"(result|status)"\s*:\s*"(error|fail\w*)"/i.test(l.text)) : undefined;
    if (error) {
      out.push({
        rule: "error-in-success",
        criterion: "consistent",
        severity: "medium",
        quotes: [clean(lines[i]!.text), clean(error.text)],
        problem: `В разделе успешного ответа ${code} приведён пример с ошибкой. Клиенту придётся проверять поле результата при коде ${code}, а коды ошибок перестают однозначно говорить об исходе.`,
        fix: `Возвращайте ошибку с кодом ошибки (например 400 или 422) или явно опишите, что код ${code} означает «запрос принят», а исход лежит в поле результата.`,
        question: `Какой HTTP-код получает клиент, если сохранение отклонено: ${code} с ошибкой в теле или код ошибки?`,
        topic: new RegExp(`(${code}[\\s\\S]*(ERROR|ошибк))|((ERROR|ошибк)[\\s\\S]*${code})`, "i"),
      });
    }
  }
  return out;
}

const PLACEHOLDER = /(не заполнен\p{L}*|не проставлен\p{L}*|заполня\p{L}+ (позже|тестировщик\p{L}*)|\bTBD\b|\bTODO\b|уточняется)/iu;

/** Empty values («Prod: —», a table row with «—») and placeholder text left in the document. */
function emptyValues(lines: Line[]): CodeFinding[] {
  const quotes: string[] = [];
  const labels: string[] = [];
  for (const l of lines) {
    const inline = /([\p{L}][\p{L}\w]{1,20}):\s*[—–-]\s*(\||$)/u.exec(l.text);
    if (inline && !l.text.trim().startsWith("|---")) {
      labels.push(inline[1]!);
      quotes.push(`${inline[1]}: —`);
      continue;
    }
    const c = l.text.trim().startsWith("|") ? cells(l.text) : [];
    if (c.length === 2 && /^[—–-]?$/.test(c[1]!) && c[0] && !/^:?-+:?$/.test(c[0])) {
      labels.push(c[0]);
      quotes.push(`${c[0]} ${c[1] || ""}`.trim());
      continue;
    }
    if (PLACEHOLDER.test(l.text)) {
      const s = sentenceWith(l.text, PLACEHOLDER);
      labels.push(s.length <= 60 ? s.replace(/\.$/, "") : `${s.slice(0, s.lastIndexOf(" ", 57))}…`);
      quotes.push(sentenceWith(l.text, PLACEHOLDER));
    }
  }
  if (quotes.length === 0) return [];
  return [
    {
      rule: "empty-values",
      criterion: "complete",
      severity: "low",
      quotes: quotes.slice(0, 4),
      problem: `В документе остались незаполненные места: ${labels.slice(0, 6).map((x) => `«${x}»`).join(", ")}${labels.length > 6 ? ` и ещё ${labels.length - 6}` : ""}.`,
      fix: "Заполните пустые поля или укажите, что значение не требуется и почему.",
      question: "Какие значения должны стоять в пустых полях документа, или какие из них не нужны?",
      topic: /не заполн|не указ|отсутств|пуст|не определ/iu,
    },
  ];
}

export function codeChecks(text: string): CodeFinding[] {
  const lines = text.split(/\r?\n/).map((t, i) => ({ no: i + 1, text: t }));
  return [...moneyUnits(lines), ...fieldTypes(lines), ...mutatingGet(lines), ...jsonWithoutBody(lines), ...statusSections(lines), ...emptyValues(lines)];
}
