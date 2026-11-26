import { CRITICAL_CRITERIA, INDIVIDUAL_INFO, type IndividualCriterion, type SetCriterion } from "./criteria.ts";
import { Grounder } from "./ground.ts";
import { errorText, type LLM } from "./llm.ts";
import type { Location, SourceDoc } from "./load.ts";
import {
  type Addressee,
  type Answer,
  CheckSchema,
  checkPrompt,
  ExtractSchema,
  extractPrompt,
  type FindingBrief,
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
}

const BATCH_SIZE = 8;

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
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

export function isCritical(criterion: string, severity: Severity): boolean {
  return severity === "high" || (severity === "medium" && CRITICAL_CRITERIA.has(criterion));
}

export async function runChecks(
  doc: SourceDoc,
  llm: LLM,
  log: (msg: string) => void = () => {},
  answers: Answer[] = [],
): Promise<RunResult> {
  const grounder = new Grounder(doc);
  const rejected: Rejected[] = [];

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

  const findings: Finding[] = [];
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
        findings.push({
          reqId: req.id,
          criterion: f.criterion,
          severity: f.severity,
          quote: f.quote,
          location: g.location,
          problem: f.problem,
          fix: f.fix,
          question: f.question,
          critical: isCritical(f.criterion, f.severity),
        });
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
  const setOut = await llm.json(
    "set",
    setPrompt(
      doc.text,
      requirements.map((r) => ({ id: key(r), doc_id: r.docId, summary: r.summary })),
      answers,
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
    });
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
  ): Omit<Question, "id"> => {
    const sorted = [...sources].sort(bySeverity);
    const top = sorted[0]!;
    return {
      ...raw,
      critical: sorted.some((f) => f.critical),
      severity: top.severity,
      sources: sorted.map(label),
      reqIds: [...new Set(sorted.flatMap(reqIdsOf))],
      places: uniqueBy(sorted.flatMap(places), (p) => `${p.location.line}:${p.location.page ?? 0}`).slice(0, 3),
    };
  };
  const number = (qs: Omit<Question, "id">[]) =>
    qs
      .sort(bySeverity)
      .slice(0, MAX_QUESTIONS)
      .map((q, i) => ({ id: `В-${String(i + 1).padStart(2, "0")}`, ...q }));

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
    const out = await llm.json("questions", questionsPrompt(docText, briefs), QuestionsSchema);
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
  const own = uniqueBy(
    all.filter((f) => f.critical && f.question.trim()).sort(bySeverity),
    (f) => f.question.trim().toLowerCase(),
  ).map((f) => build({ addressee: "analyst", question: f.question, why: f.problem, options: [] }, [f]));
  return { questions: number(own), fallback: true };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
