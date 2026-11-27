import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJudge, type Judge } from "../src/judge.ts";
import type { SourceDoc } from "../src/load.ts";
import { runChecks } from "../src/pipeline.ts";

const tmp = await mkdtemp(join(tmpdir(), "req-checker-judge-"));
afterAll(() => rm(tmp, { recursive: true, force: true }));

test("the judge sends one noul question per finding, reads probabilities, caches, and gives up on 400", async () => {
  const bodies: { model: string; state: string; questions: Record<string, { type: string; criteria: object }> }[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as (typeof bodies)[number];
      bodies.push(body);
      if (req.headers.get("authorization") !== "Bearer good") return new Response('{"detail":"bad key"}', { status: 401 });
      const answers = Object.fromEntries(Object.keys(body.questions).map((k, i) => [k, { type: "noul", noul: i === 0 ? 0.9 : 0.1 }]));
      return Response.json({ model: "jev-1.14.0", answers, usage: { input_tokens: 10, output_tokens: 2 } });
    },
  });
  try {
    const url = `http://localhost:${server.port}/v1/systemone`;
    const items = [
      { key: "a", quote: "GET", text: "GET меняет данные" },
      { key: "b", quote: "AlertsController", text: "Имя класса лишнее" },
    ];
    const judge = createJudge({ TYPESAFE_API_KEY: "good" }, { cacheDir: tmp, url })!;
    expect(await judge.score("Документ", items)).toEqual({ a: 0.9, b: 0.1 });
    expect(judge.model).toBe("jev-1.14.0");
    expect(bodies[0]!.model).toBe("jev-latest");
    expect(Object.values(bodies[0]!.questions).map((q) => q.type)).toEqual(["noul", "noul"]);
    expect(bodies[0]!.state).toContain("Документ");
    expect(await judge.score("Документ", items)).toEqual({ a: 0.9, b: 0.1 });
    expect(bodies).toHaveLength(1);
    const bad = createJudge({ TYPESAFE_API_KEY: "wrong" }, { url })!;
    expect(await bad.score("Документ", items)).toBeNull();
    expect(createJudge({})).toBeNull();
    expect(() => createJudge({ TYPESAFE_API_KEY: "k", TYPESAFE_THRESHOLD: "2" })).toThrow("TYPESAFE_THRESHOLD");
  } finally {
    server.stop(true);
  }
});

test("findings the judge scores below the threshold leave the count; rule-confirmed ones are never sent", async () => {
  const text = "| Поле | Формат |\n| --- | --- |\n| `total` | integer |\n\n| Поле | Тип |\n| --- | --- |\n| total | string |\n\n* Контроллер OrdersController.\n";
  const doc = { name: "t.md", format: "md", text, sha256: "" } as unknown as SourceDoc;
  const f = (criterion: string, quote: string, problem: string) => ({ criterion, quote, elsewhere: "", answered: false, severity: "medium", problem, fix: "", question: "?" });
  const llm = {
    provider: "fake",
    model: "fake",
    stepModels: {},
    calls: 0,
    cached: 0,
    async json<T>(step: string): Promise<T> {
      if (step === "extract")
        return {
          title: "t",
          requirements: [
            { doc_id: null, section: "API", type: "data", summary: "total", quote: "`total` | integer" },
            { doc_id: null, section: "API", type: "integration", summary: "c", quote: "Контроллер OrdersController." },
          ],
        } as T;
      if (step.startsWith("check"))
        return {
          results: [
            { req_id: "R1", findings: [f("unambiguous", "`total` | integer", "total integer, а ниже string: типы не совпадают.")] },
            { req_id: "R2", findings: [f("complete", "Контроллер OrdersController.", "Нет методов контроллера."), f("complete", "Контроллер OrdersController.", "Не указан формат токена.")] },
          ],
        } as T;
      return { findings: [], pairs: [], questions: [] } as T;
    },
  };
  const sent: string[] = [];
  const judge: Judge = {
    model: "jev-test",
    threshold: 0.5,
    async score(_doc, items) {
      sent.push(...items.map((i) => i.text));
      return Object.fromEntries(items.map((i) => [i.key, /токен/.test(i.text) ? 0.2 : 0.8]));
    },
  };
  const r = await runChecks(doc, llm as never, () => {}, [], judge);
  expect(sent.some((t) => t.includes("типы не совпадают"))).toBe(false);
  expect(r.findings.map((x) => x.problem)).toEqual(["total integer, а ниже string: типы не совпадают.", "Нет методов контроллера."]);
  expect(r.judged).toMatchObject({ model: "jev-test", threshold: 0.5, scored: 2, dropped: [{ problem: "Не указан формат токена.", p: 0.2 }] });
});
