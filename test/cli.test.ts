import { afterAll, expect, test } from "bun:test";
import { cp, mkdtemp, rm } from "node:fs/promises";
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
    "## 7. Уточняющие вопросы к автору документа",
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

  // questions: merged and ordered by the code, a question citing an unknown finding is dropped
  expect(report).toContain("| **В-01** | Тестированию | За какое время от события напоминание должно дойти до клиента, и как это измерять? | строка 5 |");
  expect(report).toContain("- Из находок: ТР-02 (Т-2), Проверяемость");
  expect(report).toContain("- Из находок: Н-01");
  expect(report).toContain("- Из находок: ТР-03, Проверяемость; ТР-03, Трассируемость");
  expect(report).not.toContain("Вопрос по находке, которой нет");
  expect(report).toContain("Вопросов: 3, из них по критичным дефектам: 3.");
  expect(report).toContain("| Уточнения автора | нет, первый прогон |");
  expect(res.stderr.toString()).toContain("отброшено вопросов без ссылки на находки: 1");
  expect(res.stderr.toString()).toContain("В-01. Тестированию: За какое время");

  const json = await Bun.file(out.replace(/\.md$/, ".json")).json();
  expect(json.requirements).toHaveLength(3);
  expect(json.rejected).toHaveLength(3);
  expect(json.questions).toHaveLength(3);
  expect(json.setFindings[0].id).toBe("Н-01");

  const questions = await Bun.file(out.replace(/\.md$/, ".questions.md")).text();
  expect(questions).toContain("## В-01. Тестированию, по критичному дефекту");
  expect(questions).toContain(`--answers ${out.replace(/\.md$/, ".questions.md")}`);
  expect(questions.match(/^Ответ:$/gm)).toHaveLength(3);
});

test("answers from the questions file go back into the check and are listed in the report", async () => {
  const out = join(tmp, "answered.report.md");
  const env = { LLM_PROVIDER: "fixture", FIXTURE_DIR: "test/fixtures/llm" };
  expect(run(["test/fixtures/sample.md", out], env).exitCode).toBe(0);
  const qfile = out.replace(/\.md$/, ".questions.md");
  const filled = (await Bun.file(qfile).text()).replace(/^Ответ:$/m, "Ответ: за 60 секунд по серверному времени");
  await Bun.write(qfile, filled);

  const res = run(["test/fixtures/sample.md", out, "--answers", qfile], env);
  expect(res.exitCode).toBe(0);
  expect(res.stderr.toString()).toContain("Ответы автора: 1");
  const report = await Bun.file(out).text();
  expect(report).toContain("### Учтённые ответы автора");
  expect(report).toContain("| За какое время от события напоминание должно дойти до клиента, и как это измерять? | за 60 секунд по серверному времени |");
  expect(report).toContain("ответов: 1, файл");
  // the answers survive in their own file although the questions file is rewritten for the new run
  expect(await Bun.file(out.replace(/\.md$/, ".answers.md")).text()).toContain("за 60 секунд");

  const empty = join(tmp, "empty.questions.md");
  await Bun.write(empty, "## В-01\nВопрос: x\nОтвет:\n");
  expect(run(["test/fixtures/sample.md", out, "--answers", empty], env).exitCode).toBe(2);
});

test("if the questions step fails, the run still ends with the critical findings' own questions", async () => {
  const dir = join(tmp, "no-questions");
  await cp("test/fixtures/llm", dir, { recursive: true });
  await rm(join(dir, "questions.json"));
  const out = join(tmp, "fallback.report.md");
  const res = run(["test/fixtures/sample.md", out], { LLM_PROVIDER: "fixture", FIXTURE_DIR: dir });
  expect(res.exitCode).toBe(0);
  expect(res.stderr.toString()).toContain("шаг вопросов не удался");
  const report = await Bun.file(out).text();
  expect(report).toContain("Шаг составления вопросов не удался");
  expect(report).toContain("За какое время от события напоминание должно дойти до клиента?");
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

test("the author's answers reach the check and set prompts, and the questions file parses back", async () => {
  const { checkPrompt, setPrompt } = await import("../src/prompts.ts");
  const { parseAnswers } = await import("../src/answers.ts");
  const answers = parseAnswers("# x\n\n## В-01. Аналитику\n\nВопрос: Сколько?\n\nОтвет: 60 секунд\nс момента события\n\n## В-02\n\nВопрос: Где?\n\nОтвет:\n");
  expect(answers).toEqual([{ question: "Сколько?", answer: "60 секунд\nс момента события" }]);
  const batch = [{ id: "R1", doc_id: null, section: "s", quote: "q" }];
  expect(checkPrompt("doc", batch, answers).user).toContain("Ответ автора: 60 секунд");
  expect(setPrompt("doc", [], answers).user).toContain("Вопрос: Сколько?");
  expect(checkPrompt("doc", batch).user).not.toContain("Уточнения автора");
});
