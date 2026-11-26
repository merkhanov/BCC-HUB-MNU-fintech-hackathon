#!/usr/bin/env bun
/**
 * Recall check: which known defects of the issued document did a report find?
 *   bun run recall [report.json]   (default reports/requirements.report.json)
 * Prints a Markdown table to stdout. Makes no API calls.
 */
import { type KnownDefect, KNOWN } from "./requirements.known.ts";

interface ReportFinding {
  label: string;
  quotes: string[];
  text: string;
}

interface ReportJson {
  findings: { reqId: string; criterion: string; quote: string; problem: string; fix: string }[];
  setFindings: { id: string | null; criterion: string; places: { quote: string }[]; problem: string; fix: string }[];
}

export function flatten(r: ReportJson): ReportFinding[] {
  return [
    ...r.findings.map((f) => ({ label: `${f.reqId} ${f.criterion}`, quotes: [f.quote], text: `${f.problem} ${f.fix}` })),
    ...r.setFindings.map((f, i) => ({
      label: `${f.id ?? `набор ${i + 1}`} ${f.criterion}`,
      quotes: f.places.map((p) => p.quote),
      text: `${f.problem} ${f.fix}`,
    })),
  ];
}

export function recall(r: ReportJson, known: KnownDefect[] = KNOWN) {
  const all = flatten(r);
  return known.map((d) => ({
    defect: d,
    hits: all.filter((f) => f.quotes.some((q) => d.where.test(q)) && d.about.test(f.text)).map((f) => f.label),
  }));
}

if (import.meta.main) {
  const file = Bun.argv[2] ?? "reports/requirements.report.json";
  const report = (await Bun.file(file).json()) as ReportJson;
  const rows = recall(report);
  const found = rows.filter((x) => x.hits.length).length;
  const out = [
    `Отчёт: ${file}`,
    "",
    "| Известный дефект | Найден | Находки |",
    "| --- | --- | --- |",
    ...rows.map((x) => `| ${x.defect.title} | ${x.hits.length ? "да" : "**нет**"} | ${x.hits.join("; ") || "—"} |`),
    "",
    `Найдено известных дефектов: ${found} из ${rows.length}.`,
  ];
  process.stdout.write(`${out.join("\n")}\n`);
}
