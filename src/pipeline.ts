import { CRITICAL_CRITERIA, type IndividualCriterion, type SetCriterion } from "./criteria.ts";
import { Grounder } from "./ground.ts";
import type { LLM } from "./llm.ts";
import type { Location, SourceDoc } from "./load.ts";
import { CheckSchema, checkPrompt, ExtractSchema, extractPrompt, SetSchema, setPrompt } from "./prompts.ts";

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
  critical: boolean;
}

export interface SetFinding {
  criterion: SetCriterion;
  severity: Severity;
  reqIds: string[];
  places: { quote: string; location: Location }[];
  problem: string;
  fix: string;
  critical: boolean;
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
  setFindings: SetFinding[];
  rejected: Rejected[];
}

const BATCH_SIZE = 8;

export function isCritical(criterion: string, severity: Severity): boolean {
  return severity === "high" || (severity === "medium" && CRITICAL_CRITERIA.has(criterion));
}

export async function runChecks(doc: SourceDoc, llm: LLM, log: (msg: string) => void = () => {}): Promise<RunResult> {
  const grounder = new Grounder(doc);
  const rejected: Rejected[] = [];

  log("1/3 Нарезка требований");
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
    const out = await llm.json(step, checkPrompt(doc.text, input), CheckSchema);
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
          critical: isCritical(f.criterion, f.severity),
        });
      }
    }
  };

  const batches = chunk(requirements, BATCH_SIZE);
  for (const [i, batch] of batches.entries()) {
    log(`2/3 Проверка требований, пакет ${i + 1}/${batches.length}`);
    await assess(`check-${i + 1}`, batch);
    const missing = batch.filter((r) => !r.checked);
    if (missing.length) {
      log(`   модель пропустила ${missing.map((r) => r.id).join(", ")}, повторный запрос`);
      await assess(`check-${i + 1}-retry`, missing);
    }
  }
  const unchecked = requirements.filter((r) => !r.checked);
  if (unchecked.length) log(`   не проверены: ${unchecked.map((r) => r.id).join(", ")}`);

  log("3/3 Проверка набора требований");
  const setOut = await llm.json(
    "set",
    setPrompt(
      doc.text,
      requirements.map((r) => ({ id: key(r), doc_id: r.docId, summary: r.summary })),
    ),
    SetSchema,
  );
  const setFindings: SetFinding[] = [];
  for (const f of setOut.findings) {
    const places = f.quotes.flatMap((q) => {
      const g = grounder.find(q);
      return g ? [{ quote: q, location: g.location }] : [];
    });
    if (places.length === 0) {
      rejected.push({ scope: "набор", criterion: f.criterion, quotes: f.quotes, problem: f.problem });
      continue;
    }
    setFindings.push({
      criterion: f.criterion,
      severity: f.severity,
      reqIds: [...new Set(f.req_ids.flatMap((k) => byKey(k)?.id ?? []))],
      places,
      problem: f.problem,
      fix: f.fix,
      critical: isCritical(f.criterion, f.severity),
    });
  }

  return { title: extracted.title.trim() || doc.name, requirements, findings, setFindings, rejected };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
