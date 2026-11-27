// Ask TypeSafe Jev how each pair of Part A requirements relates; the answers for the submitted report are in
// eval/runs/judge-jev/graph-part-a.json, and eval/judge-graph-html.ts draws them as a matrix.
//   TYPESAFE_API_KEY=... bun eval/judge-graph.ts reports/requirements.report.json <out.json>
const [reportPath, outPath] = Bun.argv.slice(2);
const doc = await Bun.file(new URL("../docs/requirements.md", import.meta.url).pathname).text();
const report = await Bun.file(reportPath!).json();
const nodes = (report.requirements as { id: string; docId: string | null; type: string; section: string; summary: string; quote: string }[]).filter(
  (r) => r.section.startsWith("Часть A") && r.type !== "other",
);
const label = (r: (typeof nodes)[number]) => (r.docId ? `${r.id} (${r.docId})` : r.id);
const pairs: [number, number][] = [];
for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) pairs.push([i, j]);

const CRITERIA = {
  conflict: "Требования противоречат друг другу: есть конкретный случай, когда выполнить оба нельзя или по ним получается разный результат.",
  refines: "Требования связаны без противоречия: одно уточняет, ограничивает, реализует или проверяет другое, например критерий приёмки проверяет правило.",
  none: "Требования не связаны: каждое можно реализовать и проверить, не глядя на другое.",
};
const questions = Object.fromEntries(
  pairs.map(([i, j], k) => [
    `p${k}`,
    {
      type: "choice",
      instructions: `Как связаны два требования документа выше?\nA (${label(nodes[i]!)}): «${nodes[i]!.quote.slice(0, 400)}»\nB (${label(nodes[j]!)}): «${nodes[j]!.quote.slice(0, 400)}»`,
      criteria: CRITERIA,
    },
  ]),
);
const res = await fetch("https://api.typesafe.ai/v1/systemone", {
  method: "POST",
  headers: { authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, "content-type": "application/json", "TypeSafe-Danger-Zone-Long-Context": "true" },
  body: JSON.stringify({ model: "jev-latest", state: `Документ требований:\n${doc}`, questions }),
});
const body = (await res.json()) as { model: string; usage: unknown; answers: Record<string, { choice: string; confidence: number; probabilities: Record<string, number> }> };
if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
console.log(body.model, JSON.stringify(body.usage), "pairs", pairs.length);
const edges = pairs.map(([i, j], k) => ({ a: label(nodes[i]!), b: label(nodes[j]!), ...body.answers[`p${k}`]! }));
await Bun.write(
  outPath!,
  JSON.stringify({ model: body.model, nodes: nodes.map((n) => ({ id: label(n), type: n.type, summary: n.summary })), edges }, null, 1),
);
const by = (c: string) => edges.filter((e) => e.choice === c).sort((x, y) => y.confidence - x.confidence);
for (const c of ["conflict", "refines"]) {
  console.log(`\n${c}: ${by(c).length}`);
  for (const e of by(c)) console.log(`  ${e.a} — ${e.b}  ${e.confidence.toFixed(2)}`);
}

export {};
