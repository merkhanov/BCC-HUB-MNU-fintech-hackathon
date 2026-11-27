import { CRITICAL_CRITERIA, INDIVIDUAL_INFO, type IndividualCriterion, type SetCriterion } from "./criteria.ts";
import { Grounder } from "./ground.ts";
import type { Judge } from "./judge.ts";
import { errorText, type LLM } from "./llm.ts";
import { acceptanceRows, type CodeFinding, codeChecks, pairHint, RULE_INFO, relatedPairs } from "./rules.ts";
import type { Location, SourceDoc } from "./load.ts";
import {
  type Addressee,
  type Answer,
  CheckSchema,
  checkPrompt,
  ExtractSchema,
  extractPrompt,
  type FindingBrief,
  PairsSchema,
  pairsPrompt,
  QuestionsSchema,
  questionsPrompt,
  SetSchema,
  setPrompt,
} from "./prompts.ts";

export type Severity = "high" | "medium" | "low";

export interface Requirement {
  id: string;
  docId: string | null;
  section: string;
  type: string;
  summary: string;
  quote: string;
  /** null when the extracted quote was not found verbatim in the document. */
  location: Location | null;
  /** false when the model returned no assessment for this requirement, even after a retry. */
  checked: boolean;
}

export interface Finding {
  reqId: string;
  criterion: IndividualCriterion;
  severity: Severity;
  quote: string;
  location: Location;
  problem: string;
  fix: string;
  question: string;
  critical: boolean;
  /** The rule in src/rules.ts that found the same defect; such a finding always gets a question. */
  confirmedBy?: string;
}

export interface SetFinding {
  /** Н-01, Н-02… in priority order. */
  id: string;
  criterion: SetCriterion;
  severity: Severity;
  reqIds: string[];
  places: { quote: string; location: Location }[];
  problem: string;
  fix: string;
  question: string;
  critical: boolean;
  /** "code" when a rule in src/rules.ts found it without the model. */
  by: "model" | "code";
  /** The rule in src/rules.ts that found it. */
  rule?: string;
  /** The rule in src/rules.ts that found the same defect as this model finding. */
  confirmedBy?: string;
}

/** A clarifying question to the document's author, tied to the findings it would resolve. */
export interface Question {
  /** В-01, В-02… in priority order. */
  id: string;
  addressee: Addressee;
  question: string;
  why: string;
  options: string[];
  critical: boolean;
  severity: Severity;
  /** Labels of the findings the question resolves: «ТР-12, Корректность», «Н-02». */
  sources: string[];
  /**
   * How much one answer resolves: summed severity (high 3, medium 2, low 1) of its first WEIGHT_CAP findings.
   * Breaks ties inside a priority tier; the cap keeps a question from winning by listing many small findings.
   */
  weight: number;
  /** "code" when code asked it because no model question covered a critical or code finding. */
  by: "model" | "code";
  reqIds: string[];
  places: { quote: string; location: Location }[];
}

/** A model finding whose quote does not occur in the document. Kept out of the counts. */
export interface Rejected {
  scope: string;
  criterion: string;
  quotes: string[];
  problem: string;
}

/** A step 2 finding the model withdrew because another place in the document already answers it. */
export interface Answered {
  reqId: string;
  criterion: IndividualCriterion;
  quote: string;
  problem: string;
  /** The place that answers it, found in the document by code. */
  answer: { quote: string; location: Location };
}

export interface RunResult {
  title: string;
  requirements: Requirement[];
  findings: Finding[];
  /** Sorted by severity and numbered Н-01.. in that order; the report keeps this order. */
  setFindings: SetFinding[];
  questions: Question[];
  /** true when the questions step failed and the list was built from the findings' own questions. */
  questionsFallback: boolean;
  answers: Answer[];
  rejected: Rejected[];
  /** Withdrawn findings, with the place in the document that answers each. */
  answered: Answered[];
  /** Minor remarks: listed in the report, not counted as violations and not asked about. */
  minor: Finding[];
  /** The TypeSafe judge's verdict, when TYPESAFE_API_KEY is set and the call succeeded. */
  judged?: Judged;
}

/** Model findings the judge scored below its threshold. Code findings and rule-confirmed findings are never judged. */
export interface Judged {
  model: string;
  threshold: number;
  scored: number;
  dropped: { where: string; criterion: string; quote: string; problem: string; p: number }[];
}

/**
 * Low-severity findings and remarks on level of detail or template are mostly nitpicks: on three labelled
 * Flash-Lite runs 9 of 33 low findings and none of 7 «appropriate» findings were real. They become minor remarks
 * unless a code rule found the same defect.
 */
export const isMinor = (f: Finding) => !f.confirmedBy && (f.severity === "low" || f.criterion === "appropriate" || f.criterion === "conforming");

const BATCH_SIZE = 8;

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
const SEVERITY_WEIGHT: Record<Severity, number> = { high: 3, medium: 2, low: 1 };
const WEIGHT_CAP = 3;
/** Within one severity, contradictions block work first, then untestable, ambiguous and incomplete items. */
const CRITERION_ORDER: Record<string, number> = { consistent: 0, correct: 1, verifiable: 2, unambiguous: 3, complete: 4 };

/**
 * Can development and testing start from this document? «no» when nothing was extracted or a critical
 * defect was found, «incomplete» when the model left requirements unchecked, «with_reservations» when only
 * non-critical violations remain. The report's section 6 and the JSON both use this one decision.
 */
export interface Verdict {
  decision: "yes" | "with_reservations" | "incomplete" | "no";
  canStart: boolean;
  requirements: number;
  violations: number;
  critical: number;
  unchecked: string[];
}

export function assess(r: Pick<RunResult, "requirements" | "findings" | "setFindings">): Verdict {
  const requirements = r.requirements.length;
  const violations = r.findings.length + r.setFindings.length;
  const critical = r.findings.filter((f) => f.critical).length + r.setFindings.filter((f) => f.critical).length;
  const unchecked = r.requirements.filter((x) => !x.checked).map((x) => x.id);
  const decision: Verdict["decision"] =
    requirements === 0 || critical > 0
      ? "no"
      : unchecked.length
        ? "incomplete"
        : violations > 0
          ? "with_reservations"
          : "yes";
  return {
    decision,
    canStart: decision === "yes" || decision === "with_reservations",
    requirements,
    violations,
    critical,
    unchecked,
  };
}

export function bySeverity<T extends { severity: Severity; critical: boolean; criterion?: string }>(a: T, b: T): number {
  return (
    Number(b.critical) - Number(a.critical) ||
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    (CRITERION_ORDER[a.criterion ?? ""] ?? 9) - (CRITERION_ORDER[b.criterion ?? ""] ?? 9)
  );
}

const MAX_QUESTIONS = 20;
const QUESTION_ATTEMPTS = 3;

export function isCritical(criterion: string, severity: Severity): boolean {
  return severity === "high" || (severity === "medium" && CRITICAL_CRITERIA.has(criterion));
}

export async function runChecks(
  doc: SourceDoc,
  llm: LLM,
  log: (msg: string) => void = () => {},
  answers: Answer[] = [],
  judge: Judge | null = null,
): Promise<RunResult> {
  const grounder = new Grounder(doc);
  const rejected: Rejected[] = [];
  const answered: Answered[] = [];
  /** Withdrawn findings, kept whole until the code rules have run: a rule can still put one back. */
  const staged: { finding: Finding; answer?: Answered["answer"] }[] = [];

  log("1/4 Нарезка требований");
  const extracted = await llm.json("extract", extractPrompt(doc.text), ExtractSchema);
  const width = Math.max(2, String(extracted.requirements.length).length);
  const requirements: Requirement[] = extracted.requirements.map((r, i) => ({
    id: `ТР-${String(i + 1).padStart(width, "0")}`,
    checked: false,
    docId: r.doc_id?.trim() || null,
    section: r.section,
    type: r.type,
    summary: r.summary,
    quote: r.quote,
    location: grounder.find(r.quote)?.location ?? null,
  }));
  // The model sees ASCII keys (R1, R2…): Cyrillic «ТР-01» is easy to echo back with Latin look-alikes.
  const byKey = (raw: string) => {
    const m = /^\s*R-?0*(\d+)\s*$/i.exec(raw);
    return m ? requirements[Number(m[1]) - 1] : undefined;
  };
  const key = (r: Requirement) => `R${requirements.indexOf(r) + 1}`;
  log(`   найдено требований: ${requirements.length}`);

  const assess = async (step: string, batch: Requirement[]) => {
    const input = batch.map((r) => ({ id: key(r), doc_id: r.docId, section: r.section, quote: r.quote }));
    const out = await llm.json(step, checkPrompt(doc.text, input, answers), CheckSchema);
    for (const res of out.results) {
      const req = byKey(res.req_id);
      if (!req || !batch.includes(req)) {
        for (const f of res.findings)
          rejected.push({ scope: `неизвестный ID ${res.req_id}`, criterion: f.criterion, quotes: [f.quote], problem: f.problem });
        continue;
      }
      if (req.checked) continue;
      req.checked = true;
      for (const f of res.findings) {
        const g = grounder.find(f.quote);
        if (!g) {
          rejected.push({ scope: req.id, criterion: f.criterion, quotes: [f.quote], problem: f.problem });
          continue;
        }
        // The model may withdraw a finding only with a quote code finds elsewhere in the document; without one the
        // finding stays.
        const answer = f.answered && f.elsewhere?.trim() ? grounder.find(f.elsewhere) : null;
        const finding: Finding = {
          reqId: req.id,
          criterion: f.criterion,
          severity: f.severity,
          quote: f.quote,
          location: g.location,
          problem: f.problem,
          fix: f.fix,
          question: f.question,
          critical: isCritical(f.criterion, f.severity),
        };
        staged.push(answer && !overlaps(answer.location, g.location) ? { finding, answer: { quote: f.elsewhere, location: answer.location } } : { finding });
      }
    }
  };

  const batches = chunk(requirements, BATCH_SIZE);
  for (const [i, batch] of batches.entries()) {
    log(`2/4 Проверка требований, пакет ${i + 1}/${batches.length}`);
    await assess(`check-${i + 1}`, batch);
    const missing = batch.filter((r) => !r.checked);
    if (missing.length) {
      log(`   модель пропустила ${missing.map((r) => r.id).join(", ")}, повторный запрос`);
      await assess(`check-${i + 1}-retry`, missing);
    }
  }
  const unchecked = requirements.filter((r) => !r.checked);
  if (unchecked.length) log(`   не проверены: ${unchecked.map((r) => r.id).join(", ")}`);

  log("3/4 Проверка набора требований");
  // Code findings the step 2 reviewers missed go into the set prompt as already found, so the model spends its
  // attention elsewhere; only what survives both steps is added to the report.
  const allCode = groundCode(doc, grounder);
  // The model often takes the conflicting place for the answer («amount string» answers «amount integer»). A rule
  // that sees the same defect on the finding's lines or on the answer's lines puts the finding back.
  const findings: Finding[] = [];
  for (const { finding: f, answer } of staged) {
    const text = `${f.problem} ${f.fix}`;
    const rule = answer && allCode.find((c) => sameDefect(c, { at: [f.location], text }) || sameDefect(c, { at: [answer.location], text }));
    if (!answer || rule) findings.push(f);
    else answered.push({ reqId: f.reqId, criterion: f.criterion, quote: f.quote, problem: f.problem, answer });
  }
  const withdrawn = staged.filter((s) => s.answer).length;
  if (withdrawn) log(`   сняты как уже отвеченные в документе: ${answered.length}, возвращены правилами: ${withdrawn - answered.length}`);
  confirm(allCode, staged.map((s) => s.finding));
  const minor = findings.filter(isMinor);
  findings.splice(0, findings.length, ...findings.filter((f) => !isMinor(f)));
  if (minor.length) log(`   мелких замечаний вне подсчёта: ${minor.length}`);
  const code = notYetFound(allCode, asModel(findings));
  const setOut = await llm.json(
    "set",
    setPrompt(
      doc.text,
      requirements.map((r) => ({ id: key(r), doc_id: r.docId, summary: r.summary })),
      answers,
      { foundByCode: code.map((c) => c.problem) },
    ),
    SetSchema,
  );
  const unnumbered: Omit<SetFinding, "id">[] = [];
  for (const f of setOut.findings) {
    const places = f.quotes.flatMap((q) => {
      const g = grounder.find(q);
      return g ? [{ quote: q, location: g.location }] : [];
    });
    if (places.length === 0) {
      rejected.push({ scope: "набор", criterion: f.criterion, quotes: f.quotes, problem: f.problem });
      continue;
    }
    unnumbered.push({
      criterion: f.criterion,
      severity: f.severity,
      reqIds: [...new Set(f.req_ids.flatMap((k) => byKey(k)?.id ?? []))],
      places,
      problem: f.problem,
      fix: f.fix,
      question: f.question,
      critical: isCritical(f.criterion, f.severity),
      by: "model",
    });
  }
  confirm(code, unnumbered);
  const added = notYetFound(code, asModel(unnumbered));
  unnumbered.push(...added.map((c) => toSetFinding(c, requirements)));
  if (added.length) log(`   правила в коде добавили находок: ${added.length}`);
  unnumbered.push(...(await checkPairs(doc, llm, log, grounder, requirements, unnumbered, key, answers)));

  let judged: Judged | undefined;
  if (judge) {
    log("   судья находок TypeSafe");
    const reqItems = findings.filter((f) => !f.confirmedBy);
    const setItems = unnumbered.filter((f) => f.by === "model" && !f.confirmedBy);
    const docIdOf = new Map(requirements.map((r) => [r.id, r.docId]));
    const items = [
      ...reqItems.map((f, i) => ({ key: `F${i}`, quote: f.quote, text: `${f.problem} ${f.fix}`, f, where: `${reqLabel(f.reqId, docIdOf.get(f.reqId))}` })),
      ...setItems.map((f, i) => ({ key: `S${i}`, quote: f.places[0]!.quote, text: `${f.problem} ${f.fix}`, f, where: "набор" })),
    ];
    const p = await judge.score(doc.text, items);
    if (p) {
      const low = new Set(items.filter((it) => (p[it.key] ?? 1) < judge.threshold).map((it) => it.f));
      judged = {
        model: judge.model,
        threshold: judge.threshold,
        scored: items.length,
        dropped: items
          .filter((it) => low.has(it.f))
          .map((it) => ({ where: it.where, criterion: it.f.criterion, quote: it.quote, problem: it.f.problem, p: p[it.key]! })),
      };
      findings.splice(0, findings.length, ...findings.filter((f) => !low.has(f)));
      unnumbered.splice(0, unnumbered.length, ...unnumbered.filter((f) => !low.has(f)));
      log(`   судья оценил находок: ${items.length}, снял с вероятностью ниже ${judge.threshold}: ${judged.dropped.length}`);
    }
  }

  const setFindings: SetFinding[] = unnumbered
    .sort(bySeverity)
    .map((f, i) => ({ id: `Н-${String(i + 1).padStart(2, "0")}`, ...f }));

  log("4/4 Уточняющие вопросы автору");
  const { questions, fallback } = await askQuestions(doc.text, llm, log, requirements, findings, setFindings);
  log(`   вопросов: ${questions.length}${fallback ? " (собраны из находок, шаг вопросов не удался)" : ""}`);

  return {
    title: extracted.title.trim() || doc.name,
    requirements,
    findings,
    setFindings,
    questions,
    questionsFallback: fallback,
    answers,
    rejected,
    answered,
    minor,
    judged,
  };
}

/** «ТР-12 (Ф-2)» when the document numbered the requirement, otherwise «ТР-12». */
export function reqLabel(id: string, docId: string | null | undefined): string {
  return docId ? `${id} (${docId})` : id;
}

/** Keep the first item for each key, in order. */
function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** A finding of either kind with the F1../S1.. key the questions step cites it by. */
const overlaps = (a: Location, b: Location) =>
  (a.page ?? 0) === (b.page ?? 0) && a.line <= b.endLine && b.line <= a.endLine;

type GroundedCode = CodeFinding & { places: { quote: string; location: Location }[] };

/** Code findings with their places in the document; a finding whose quotes are all missing is dropped. */
export function groundCode(doc: SourceDoc, grounder: Grounder): GroundedCode[] {
  return codeChecks(doc.text).flatMap((c) => {
    const places = c.quotes.flatMap((q) => {
      const g = grounder.find(q);
      return g ? [{ quote: q, location: g.location }] : [];
    });
    return places.length ? [{ ...c, places }] : [];
  });
}

/**
 * Keep the code findings the model did not already make. A model finding counts as the same defect when it sits
 * on an overlapping line and its text names the rule's topic.
 */
export function notYetFound(code: GroundedCode[], model: { at: Location[]; text: string }[]): GroundedCode[] {
  return code.filter((c) => !model.some((m) => sameDefect(c, m)));
}

const sameDefect = (c: GroundedCode, m: { at: Location[]; text: string }) =>
  c.topic.test(m.text) && m.at.some((l) => c.places.some((p) => overlaps(l, p.location)));

/**
 * Mark each model finding that a code rule also found. The model may rate such a finding low, but the rule shows a
 * defect that blocks work (a type mismatch, a GET that saves), so the questions step treats it like a code finding.
 */
export function confirm(code: GroundedCode[], model: (Finding | Omit<SetFinding, "id">)[]): void {
  for (const f of model) {
    const [m] = asModel([f]);
    f.confirmedBy ??= code.find((c) => sameDefect(c, m!))?.rule;
  }
}

const asModel = (fs: (Finding | Omit<SetFinding, "id">)[]) =>
  fs.map((f) => ({ at: "places" in f ? f.places.map((p) => p.location) : [f.location], text: `${f.problem} ${f.fix}` }));

function toSetFinding(c: GroundedCode, requirements: Requirement[]): Omit<SetFinding, "id"> {
  return {
    criterion: c.criterion,
    severity: c.severity,
    reqIds: requirements.filter((r) => r.location && c.places.some((p) => overlaps(r.location!, p.location))).map((r) => r.id),
    places: c.places,
    problem: c.problem,
    fix: c.fix,
    question: c.question,
    critical: isCritical(c.criterion, c.severity),
    by: "code",
    rule: c.rule,
  };
}

const PAIR_ATTEMPTS = 3;

/**
 * One request over pairs of requirements that code picked by shared rare terms. A contradiction is accepted only
 * with a concrete case and a found quote from each side, and pairs the set step already reported are skipped.
 */
async function checkPairs(
  doc: SourceDoc,
  llm: LLM,
  log: (msg: string) => void,
  grounder: Grounder,
  requirements: Requirement[],
  setFindings: Omit<SetFinding, "id">[],
  key: (r: Requirement) => string,
  answers: Answer[],
): Promise<Omit<SetFinding, "id">[]> {
  // Acceptance rows the extraction left out are read from the table, so a worked example still meets its rule.
  const extra: Requirement[] = acceptanceRows(doc.text)
    .filter((row) => !requirements.some((r) => r.location && r.location.line <= row.line && row.line <= r.location.endLine))
    .map((row, i) => ({
      id: `КП-${i + 1}`,
      docId: null,
      section: "Критерии приёмки",
      type: "acceptance",
      summary: row.quote,
      quote: row.quote,
      location: grounder.find(row.quote)?.location ?? null,
      checked: true,
    }));
  const items = [...requirements, ...extra];
  const idOf = (r: Requirement) => (extra.includes(r) ? r.id : key(r));
  const byKey = new Map(items.map((r) => [idOf(r), r]));
  const reported = (a: Requirement, b: Requirement) =>
    setFindings.some((f) => f.criterion === "consistent" && f.reqIds.includes(a.id) && f.reqIds.includes(b.id));
  const pairs = relatedPairs(items.map((r) => ({ id: idOf(r), quote: r.quote, type: r.type })))
    .map(([a, b]) => [byKey.get(a)!, byKey.get(b)!] as const)
    .filter(([a, b]) => !reported(a, b));
  if (pairs.length === 0) return [];
  const brief = (r: Requirement) => ({ id: idOf(r), doc_id: r.docId, section: r.section, quote: r.quote });
  const ask = async (step: string, list: (readonly [Requirement, Requirement])[]) => {
    try {
      const out = await llm.json(step, pairsPrompt(doc.text, list.map(([a, b]) => ({ a: brief(a), b: brief(b), hint: pairHint(a, b) })), answers), PairsSchema, {
        attempts: PAIR_ATTEMPTS,
      });
      return out.pairs;
    } catch (e) {
      log(`   сверка пар не удалась: ${errorText(e).slice(0, 200)}`);
      return [];
    }
  };
  const found: Omit<SetFinding, "id">[] = [];
  const accepted = new Set<string>();
  const accept = (p: Awaited<ReturnType<typeof ask>>[number]) => {
    const a = byKey.get(p.a.trim());
    const b = byKey.get(p.b.trim());
    if (!p.conflict || !p.scenario.trim() || !a || !b) return;
    const places = p.quotes.flatMap((q) => {
      const g = grounder.find(q);
      return g ? [{ quote: q, location: g.location }] : [];
    });
    if (places.length < 2) return;
    accepted.add(`${idOf(a)}|${idOf(b)}`);
    found.push({
      criterion: "consistent",
      severity: p.severity,
      reqIds: [a, b].filter((r) => !extra.includes(r)).map((r) => r.id),
      places,
      problem: `${p.problem} Пример: ${p.scenario}`,
      fix: p.fix,
      question: p.question,
      critical: isCritical("consistent", p.severity),
      by: "model",
    });
  };
  for (const p of await ask("pairs", pairs)) accept(p);
  // A second look at the pairs the first answer called clean, in reverse order. One answer on a small model flips
  // between runs; taking the union of two answers keeps a contradiction that either of them saw.
  const rest = pairs.filter(([a, b]) => !accepted.has(`${idOf(a)}|${idOf(b)}`)).reverse();
  if (rest.length) for (const p of await ask("pairs-2", rest)) if (!accepted.has(`${p.a.trim()}|${p.b.trim()}`)) accept(p);
  log(`   сверка пар: проверено ${pairs.length}, противоречий ${found.length}`);
  return found;
}

type AnyFinding = ((Finding & { kind: "req" }) | (SetFinding & { kind: "set" })) & { key: string };

/**
 * One request turns the findings into a deduplicated, prioritized list of questions. The model only groups and
 * phrases; code checks that every question cites findings that exist and takes places and priority from them.
 * If the step fails, the run still finishes with the findings' own questions.
 */
async function askQuestions(
  docText: string,
  llm: LLM,
  log: (msg: string) => void,
  requirements: Requirement[],
  findings: Finding[],
  setFindings: SetFinding[],
): Promise<{ questions: Question[]; fallback: boolean }> {
  const all: AnyFinding[] = [
    ...findings.map((f, i) => ({ ...f, kind: "req" as const, key: `F${i + 1}` })),
    ...setFindings.map((f, i) => ({ ...f, kind: "set" as const, key: `S${i + 1}` })),
  ];
  if (all.length === 0) return { questions: [], fallback: false };

  const docIdOf = new Map(requirements.map((r) => [r.id, r.docId]));
  const label = (f: AnyFinding) => {
    if (f.kind === "set") return f.id;
    return `${reqLabel(f.reqId, docIdOf.get(f.reqId))}, ${INDIVIDUAL_INFO[f.criterion].name}`;
  };
  const places = (f: AnyFinding) => (f.kind === "set" ? f.places : [{ quote: f.quote, location: f.location }]);
  const reqIdsOf = (f: AnyFinding) => (f.kind === "set" ? f.reqIds : [f.reqId]);
  const keyOf = new Map(all.map((f) => [f.key, f]));

  const build = (
    raw: { addressee: Addressee; question: string; why: string; options: string[] },
    sources: AnyFinding[],
    by: Question["by"] = "model",
  ): Omit<Question, "id"> => {
    const sorted = [...sources].sort(bySeverity);
    const top = sorted[0]!;
    return {
      ...raw,
      by,
      critical: sorted.some((f) => f.critical),
      severity: top.severity,
      weight: sorted.slice(0, WEIGHT_CAP).reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0),
      sources: sorted.map(label),
      reqIds: [...new Set(sorted.flatMap(reqIdsOf))],
      places: uniqueBy(sorted.flatMap(places), (p) => `${p.location.line}:${p.location.page ?? 0}`).slice(0, 3),
    };
  };
  const order = (a: Omit<Question, "id">, b: Omit<Question, "id">) => bySeverity(a, b) || b.weight - a.weight;
  const typeOf = new Map(requirements.map((r) => [r.id, r.type]));
  const addresseeFor = (f: AnyFinding): Addressee => {
    if (f.kind === "set") return (f.rule && RULE_INFO[f.rule]?.addressee) || (f.criterion === "validatable" ? "qa" : "analyst");
    if (f.criterion === "verifiable") return "qa";
    return /interface|integration|data/.test(typeOf.get(f.reqId) ?? "") ? "architect" : "analyst";
  };
  /**
   * Every critical finding, every code finding and every finding a code rule confirmed gets a question. The ones no model question cites are asked by
   * code, one question per requirement or per rule (findings a rule confirmed group under that rule), after the model's
   * questions.
   */
  const coverRest = (asked: Omit<Question, "id">[]): Omit<Question, "id">[] => {
    const cited = new Set(asked.flatMap((q) => q.sources));
    const groups = new Map<string, AnyFinding[]>();
    for (const f of all) {
      if (!(f.critical || f.confirmedBy || (f.kind === "set" && f.by === "code")) || cited.has(label(f)) || !f.question.trim()) continue;
      const rule = f.kind === "set" ? (f.rule ?? f.confirmedBy) : f.confirmedBy;
      const k = rule ? `rule:${rule}` : f.kind === "req" ? `req:${f.reqId}` : `set:${f.id}`;
      groups.set(k, [...(groups.get(k) ?? []), f]);
    }
    const extra = [...groups.values()].map((g) => {
      const sorted = [...g].sort(bySeverity);
      const top = sorted[0]!;
      const rule = top.kind === "set" ? (top.rule ?? top.confirmedBy) : top.confirmedBy;
      const merged = g.length > 1 && rule ? RULE_INFO[rule]?.groupQuestion : undefined;
      return build({ addressee: addresseeFor(top), question: merged ?? top.question, why: top.problem, options: [] }, sorted, "code");
    });
    return uniqueBy(extra.sort(order), (q) => q.question.trim().toLowerCase());
  };
  const number = (asked: Omit<Question, "id">[]) => {
    const main = asked.sort(order).slice(0, MAX_QUESTIONS);
    return [...main, ...coverRest(main)].map((q, i) => ({ id: `В-${String(i + 1).padStart(2, "0")}`, ...q }));
  };

  const briefs: FindingBrief[] = all.map((f) => ({
    id: f.key,
    where: label(f),
    criterion: f.criterion,
    severity: f.severity,
    critical: f.critical,
    quote: places(f)[0]!.quote,
    problem: f.problem,
    question: f.question,
  }));
  try {
    // The step has a fallback below, so it gets fewer attempts than the checks that have none.
    const out = await llm.json("questions", questionsPrompt(docText, briefs), QuestionsSchema, { attempts: QUESTION_ATTEMPTS });
    const built: Omit<Question, "id">[] = [];
    let dropped = 0;
    for (const q of out.questions) {
      const sources = [...new Set(q.source_ids.flatMap((k) => keyOf.get(k.trim().toUpperCase()) ?? []))];
      if (sources.length === 0 || !q.question.trim()) {
        dropped++;
        continue;
      }
      built.push(build(q, sources));
    }
    if (dropped) log(`   отброшено вопросов без ссылки на находки: ${dropped}`);
    if (built.length > 0) return { questions: number(built), fallback: false };
    log("   модель не вернула ни одного вопроса со ссылкой на находки");
  } catch (e) {
    log(`   шаг вопросов не удался: ${errorText(e).slice(0, 200)}`);
  }
  return { questions: number([]), fallback: true };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
