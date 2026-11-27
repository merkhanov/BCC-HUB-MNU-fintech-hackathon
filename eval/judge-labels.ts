// Measure the TypeSafe judge against the hand labels: AUC and precision at two thresholds per labelled run.
//   TYPESAFE_API_KEY=... bun eval/judge-labels.ts eval/runs/*.report.json   (Jev answers kept in eval/runs/judge-jev)
import { flatten, recall } from "./recall.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const doc = await Bun.file(`${ROOT}/docs/requirements.md`).text();
// Jev answers are committed, so the numbers repeat without a key.
const cacheDir = `${ROOT}eval/runs/judge-jev`;
const key = process.env.TYPESAFE_API_KEY!;

const QUESTION = (quote: string, text: string) =>
  `Находка рецензента к документу требований выше. Место: «${quote.slice(0, 300)}». Суть: ${text.slice(0, 700)}\n` +
  "Это реальный дефект требований, который нужно исправить или уточнить у автора до начала разработки?";
const CRITERIA = {
  true: "Документ действительно не отвечает на этот вопрос или противоречит сам себе, и без исправления разработчики или тестировщики могут сделать разное.",
  false:
    "Придирка к оформлению или служебным полям, проектная деталь, которую команда решит сама, или вопрос, на который документ уже отвечает в другом разделе.",
};

async function judge(name: string, items: { key: string; quote: string; text: string }[]): Promise<Record<string, number>> {
  const file = Bun.file(`${cacheDir}/${name}.json`);
  if (await file.exists()) return file.json();
  const questions = Object.fromEntries(
    items.map((f, i) => [`q${i}`, { type: "noul", instructions: QUESTION(f.quote, f.text), criteria: CRITERIA }]),
  );
  const res = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "TypeSafe-Danger-Zone-Long-Context": "true" },
    body: JSON.stringify({ model: "jev-latest", state: `Документ требований:\n${doc}`, questions }),
  });
  const body = (await res.json()) as { answers?: Record<string, { noul: number }>; usage?: unknown; model?: string };
  if (!res.ok || !body.answers) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body).slice(0, 400)}`);
  console.log(`  ${name}: ${body.model}, usage ${JSON.stringify(body.usage)}`);
  const out = Object.fromEntries(items.map((f, i) => [f.key, body.answers![`q${i}`]!.noul]));
  await Bun.write(file, JSON.stringify(out, null, 1));
  return out;
}

const all: { run: string; key: string; p: number; label: boolean }[] = [];
for (const path of Bun.argv.slice(2)) {
  const name = path.split("/").pop()!.replace(/\.report\.json$/, "");
  const report = await Bun.file(path).json();
  const labels = (await Bun.file(path.replace(/\.json$/, ".labels.json")).json()) as Record<string, boolean>;
  const items = flatten(report)
    .filter((f) => f.key in labels)
    .map((f) => ({ key: f.key, quote: f.quotes[0] ?? "", text: f.text }));
  const p = await judge(name, items);
  for (const f of items) all.push({ run: name, key: f.key, p: p[f.key]!, label: labels[f.key]! });
}

// AUC: chance a random real finding scores above a random false one.
function auc(rows: typeof all) {
  const pos = rows.filter((r) => r.label), neg = rows.filter((r) => !r.label);
  let s = 0;
  for (const a of pos) for (const b of neg) s += a.p > b.p ? 1 : a.p === b.p ? 0.5 : 0;
  return pos.length && neg.length ? s / (pos.length * neg.length) : NaN;
}
const runs = [...new Set(all.map((r) => r.run))];
console.log("\nrun                              n   real  AUC   | keep p>=0.3        | keep p>=0.5");
for (const run of [...runs, "ALL"]) {
  const rows = run === "ALL" ? all : all.filter((r) => r.run === run);
  const at = (t: number) => {
    const kept = rows.filter((r) => r.p >= t);
    const real = kept.filter((r) => r.label).length;
    const lostReal = rows.filter((r) => r.label && r.p < t).length;
    return `${real}/${kept.length} ${kept.length ? Math.round((100 * real) / kept.length) : 0}% lost ${lostReal}`.padEnd(18);
  };
  const real = rows.filter((r) => r.label).length;
  console.log(`${run.padEnd(32)} ${String(rows.length).padStart(3)} ${String(Math.round((100 * real) / rows.length)).padStart(4)}%  ${auc(rows).toFixed(2)}  | ${at(0.3)} | ${at(0.5)}`);
}

// Known-defect recall after dropping findings with p < 0.5, per run.
console.log("\nrecall after the p>=0.5 filter (found / asked out of 12):");
for (const path of Bun.argv.slice(2)) {
  const name = path.split("/").pop()!.replace(/\.report\.json$/, "");
  const report = await Bun.file(path).json();
  const p = await judge(name, []);
  const keys = flatten(report).map((f) => f.key);
  const drop = new Set(keys.filter((k) => k in p && p[k]! < 0.5));
  const kept = {
    ...report,
    findings: report.findings.filter((_: unknown, i: number) => !drop.has(keys[i]!)),
    setFindings: report.setFindings.filter((_: unknown, i: number) => !drop.has(keys[report.findings.length + i]!)),
  };
  const rows = recall(kept);
  console.log(`  ${name}: ${rows.filter((r) => r.hits.length).length} / ${rows.filter((r) => r.questions.length).length}`);
}

// As the agent applies it: code findings and rule-confirmed findings are never judged.
console.log("\nas in the agent (code and rule-confirmed findings kept):");
const total: Record<string, [number, number, number]> = {};
for (const path of Bun.argv.slice(2)) {
  const name = path.split("/").pop()!.replace(/\.report\.json$/, "");
  const r = await Bun.file(path).json();
  const L = (await Bun.file(path.replace(/\.json$/, ".labels.json")).json()) as Record<string, boolean>;
  const p = await judge(name, []);
  const flat = flatten(r);
  const n = r.findings.length;
  const kept = new Set(flat.filter((f, i) => f.by === "code" || (i < n ? r.findings[i].confirmedBy : r.setFindings[i - n].confirmedBy)).map((f) => f.key));
  const line = [`  ${name.padEnd(28)}`];
  for (const t of [0.3, 0.5]) {
    const keys = flat.map((f) => f.key);
    const drop = new Set(keys.filter((k) => k in p && p[k]! < t && !kept.has(k)));
    const rest = {
      ...r,
      findings: r.findings.filter((_: unknown, i: number) => !drop.has(keys[i]!)),
      setFindings: r.setFindings.filter((_: unknown, i: number) => !drop.has(keys[n + i]!)),
    };
    const labelled = flatten(rest).filter((f) => f.key in L);
    const real = labelled.filter((f) => L[f.key]).length;
    const lost = [...drop].filter((k) => L[k]).length;
    const found = recall(rest).filter((x) => x.hits.length).length;
    const tt = (total[t] ??= [0, 0, 0]);
    tt[0] += real;
    tt[1] += labelled.length;
    tt[2] += lost;
    line.push(`t=${t}: ${real}/${labelled.length} ${Math.round((100 * real) / labelled.length)}% real lost ${lost} found ${found}/12`);
  }
  console.log(line.join(" | "));
}
for (const [t, [a, b, c]] of Object.entries(total)) console.log(`  ALL t=${t}: ${a}/${b} ${Math.round((100 * a) / b)}%, real findings lost ${c}`);
