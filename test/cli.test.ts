import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const tmp = await mkdtemp(join(tmpdir(), "req-checker-"));
afterAll(() => rm(tmp, { recursive: true, force: true }));

function run(args: string[], env: Record<string, string> = {}) {
  return Bun.spawnSync(["bun", "run", "src/cli.ts", ...args], {
    cwd: ROOT,
    env: { PATH: process.env.PATH!, HOME: process.env.HOME!, ...env },
  });
}

test("end-to-end run with replayed model answers writes every report section", async () => {
  const out = join(tmp, "sample.report.md");
  const res = run(["test/fixtures/sample.md", out], { LLM_PROVIDER: "fixture", FIXTURE_DIR: "test/fixtures/llm" });
  expect(res.stderr.toString()).toContain("Готово");
  expect(res.exitCode).toBe(0);

  const report = await Bun.file(out).text();
  for (const h of [
    "## 1. Паспорт прогона",
    "## 2. Как агент нарезал требования",
    "## 3. Проверка каждого требования",
    "## 4. Проверка всего набора требований",
    "## 5. Сводка",
    "## 6. Итог",
  ])
    expect(report).toContain(h);

  // slicing table keeps document IDs, assigns own IDs and locates quotes
  expect(report).toContain("| ТР-01 | Т-1 | функц. | Функциональные требования | строка 4 |");
  expect(report).toContain("| ТР-03 | — | нефункц. |");

  // grounded findings are counted; fabricated quotes and unknown IDs are not
  expect(report).toContain("| Нарушений всего | 4 |");
  expect(report).toContain("| Критичных нарушений | 3 |");
  expect(report).toContain("## Приложение. Отклонённые находки");
  expect(report).toContain("Напоминание приходит по SMS и push");
  expect(report).toContain("| неизвестный ID R99 |");

  // a requirement the model skipped (also on retry) is marked unchecked, not clean
  expect(report).toMatch(/\| ТР-01 \| Т-1 \|( — \|){10} \*\*не проверено\*\* \|/);
  expect(report).toContain("| Требований не проверено моделью | 1: ТР-01 |");
  expect(report).toContain("модель не проверила требования ТР-01");
  expect(report).toContain("- Требования: ТР-01 (Т-1).");
  expect(report).toContain("**Тестовый прогон.**");

  expect(report).toContain("**Нет, начинать разработку и тестирование по документу в текущем виде нельзя.**");

  const json = await Bun.file(out.replace(/\.md$/, ".json")).json();
  expect(json.requirements).toHaveLength(3);
  expect(json.rejected).toHaveLength(3);
});

test("PDF input is read and quotes are located by page", async () => {
  const out = join(tmp, "sample-pdf.report.md");
  const res = run(["test/fixtures/sample.pdf", out], { LLM_PROVIDER: "fixture", FIXTURE_DIR: "test/fixtures/llm" });
  expect(res.exitCode).toBe(0);
  const report = await Bun.file(out).text();
  expect(report).toContain("PDF, страниц: 1");
  expect(report).toMatch(/\| ТР-02 \| Т-2 \| функц\. \| Функциональные требования \| с\. 1, строка \d+ \|/);
  expect(report).toContain("| Нарушений всего | 4 |");
});

test("missing API key exits with code 2 and a hint", () => {
  const res = run(["test/fixtures/sample.md", join(tmp, "x.md")], { LLM_PROVIDER: "gemini", GEMINI_API_KEY: "" });
  expect(res.exitCode).toBe(2);
  expect(res.stderr.toString()).toContain("GEMINI_API_KEY");
});

test("unsupported format and missing file exit with code 2", () => {
  expect(run(["package.json"]).exitCode).toBe(2);
  expect(run(["nope.pdf"]).exitCode).toBe(2);
});
