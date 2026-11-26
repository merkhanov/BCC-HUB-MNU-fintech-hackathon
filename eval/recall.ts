#!/usr/bin/env bun
/**
 * Recall check: which known defects of the issued document did a report find, and did a question reach them?
 *   bun run recall [report.json]   (default reports/requirements.report.json)
 * With <report>.labels.json next to the report ({"ТР-19/appropriate": true, "Н-03": false, ...}) it also prints
 * precision over the labelled findings. Prints Markdown to stdout. Makes no API calls.
 */
import { INDIVIDUAL_INFO, type IndividualCriterion } from "../src/criteria.ts";
import { reqLabel } from "../src/pipeline.ts";
import { type KnownDefect, KNOWN } from "./requirements.known.ts";

interface ReportFinding {
  /** Stable key for labels: «ТР-19/appropriate» or «Н-03». */
  key: string;
  /** The label the pipeline puts in a question's sources. */
  source: string;
  quotes: string[];
  text: string;
  by?: string;
}

interface ReportJson {
  requirements?: { id: string; docId: string | null }[];
  findings: { reqId: string; criterion: string; quote: string; problem: string; fix: string }[];
  setFindings: { id: string | null; criterion: string; places: { quote: string }[]; problem: string; fix: string; by?: string }[];
  questions?: { id: string; sources: string[] }[];
}

export function flatten(r: ReportJson): ReportFinding[] {
  const docId = new Map((r.requirements ?? []).map((x) => [x.id, x.docId]));
  return [
    ...r.findings.map((f) => ({
      key: `${f.reqId}/${f.criterion}`,
      source: `${reqLabel(f.reqId, docId.get(f.reqId))}, ${INDIVIDUAL_INFO[f.criterion as IndividualCriterion]?.name ?? f.criterion}`,
      quotes: [f.quote],
      text: `${f.problem} ${f.fix}`,
    })),
    ...r.setFindings.map((f, i) => ({
      key: f.id ?? `набор ${i + 1}`,
      source: f.id ?? `набор ${i + 1}`,
      quotes: f.places.map((p) => p.quote),
      text: `${f.problem} ${f.fix}`,
      by: f.by,
    })),
  ];
}

export function recall(r: ReportJson, known: KnownDefect[] = KNOWN) {
  const all = flatten(r);
  return known.map((d) => {
    const hits = all.filter((f) => f.quotes.some((q) => d.where.test(q)) && d.about.test(f.text));
    const sources = new Set(hits.map((h) => h.source));
    const questions = (r.questions ?? []).filter((q) => q.sources.some((s) => sources.has(s))).map((q) => q.id);
    return { defect: d, hits: hits.map((h) => `${h.key}${h.by === "code" ? " (код)" : ""}`), questions };
  });
}

/** Share of labelled findings that are real defects. Unlabelled findings are counted, not guessed. */
export function precision(r: ReportJson, labels: Record<string, boolean>) {
  const all = flatten(r);
  const labelled = all.filter((f) => f.key in labels);
  const truePositives = labelled.filter((f) => labels[f.key]).length;
  return { total: all.length, labelled: labelled.length, truePositives, precision: labelled.length ? truePositives / labelled.length : null };
}

if (import.meta.main) {
  const file = Bun.argv[2] ?? "reports/requirements.report.json";
  const report = (await Bun.file(file).json()) as ReportJson;
  const rows = recall(report);
  const found = rows.filter((x) => x.hits.length).length;
  const hasQuestions = (report.questions?.length ?? 0) > 0;
  const asked = rows.filter((x) => x.questions.length).length;
  const out = [
    `Отчёт: ${file}`,
    "",
    "| Известный дефект | Найден | Находки | Вопросы |",
    "| --- | --- | --- | --- |",
    ...rows.map(
      (x) => `| ${x.defect.title} | ${x.hits.length ? "да" : "**нет**"} | ${x.hits.join("; ") || "—"} | ${x.questions.join(", ") || "—"} |`,
    ),
    "",
    `Найдено известных дефектов: ${found} из ${rows.length}.`,
    hasQuestions
      ? `Известных дефектов, по которым автору задан вопрос: ${asked} из ${rows.length}.`
      : "В отчёте нет вопросов к автору.",
  ];
  const labelsFile = Bun.file(file.replace(/\.json$/, ".labels.json"));
  if (await labelsFile.exists()) {
    const p = precision(report, await labelsFile.json());
    out.push(
      p.precision === null
        ? "В файле разметки нет ни одной находки этого отчёта."
        : `Точность по разметке: ${p.truePositives} из ${p.labelled} размеченных находок верны (${Math.round(p.precision * 100)}%). Не размечено: ${p.total - p.labelled}.`,
    );
  }
  process.stdout.write(`${out.join("\n")}\n`);
}
