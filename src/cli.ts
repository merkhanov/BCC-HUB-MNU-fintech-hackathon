#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import pkg from "../package.json";
import { parseAnswers, renderQuestionsFile } from "./answers.ts";
import { ConfigError, createLLM, errorText, isDailyQuota, isTransient } from "./llm.ts";
import { InputError, loadDocument, SUPPORTED } from "./load.ts";
import { type RunResult, runChecks } from "./pipeline.ts";
import type { Answer } from "./prompts.ts";
import { ADDRESSEE, formatOptions, type Passport, renderReport } from "./report.ts";

const USAGE = `Агент проверки требований (ISO/IEC/IEEE 29148:2018, IEEE 830-1998)

Использование:
  bun start <файл требований> [файл отчёта]

  <файл требований>  ${SUPPORTED.join(", ")}
  [файл отчёта]      Markdown-отчёт. По умолчанию reports/<имя>.report.md
                     Рядом пишутся <отчёт>.json с теми же данными в машинном виде
                     и <отчёт>.questions.md с уточняющими вопросами к автору.

  --answers <файл>   Файл вопросов с заполненными строками «Ответ:». Агент передаёт
                     ответы модели как дополнения к документу и проверяет заново.
  --ask              После прогона задать уточняющие вопросы в терминале, сохранить
                     ответы и предложить повторную проверку с ними.

  --no-cache         Спросить модель заново, не беря ответы из .cache/llm. Новые ответы
                     всё равно сохраняются, чтобы прогон можно было продолжить после сбоя.
  -h, --help         Эта справка.

Настройки в .env (см. .env.example): LLM_PROVIDER, GEMINI_API_KEY, GEMINI_MODEL.`;

const ROOT = resolve(import.meta.dir, "..");
/** Progress goes to stderr; console.error would colour every line red in a terminal. */
const say = (m: string) => process.stderr.write(`${m}\n`);

async function agentVersion(): Promise<string> {
  const git = await Bun.$`git -C ${ROOT} describe --always --tags`.quiet().nothrow();
  if (git.exitCode !== 0) return `${pkg.name} ${pkg.version}, вне git`;
  // --dirty ignores untracked files, so check the agent's own folder explicitly.
  const status = await Bun.$`git -C ${ROOT} status --porcelain -- . :!reports`.quiet().nothrow();
  const dirty = status.stdout.toString().trim() ? " + незакоммиченные изменения" : "";
  return `${pkg.name} ${pkg.version}, коммит ${git.stdout.toString().trim()}${dirty}`;
}

const SHOW_QUESTIONS = 5;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      "no-cache": { type: "boolean" },
      answers: { type: "string" },
      ask: { type: "boolean" },
    },
    allowPositionals: true,
  });
  if (values.help || positionals.length === 0 || positionals.length > 2) {
    say(USAGE);
    return values.help ? 0 : 2;
  }

  const input = positionals[0]!;
  const output = positionals[1] ?? join("reports", `${basename(input, extname(input))}.report.md`);
  const base = output.replace(/\.md$/, "");
  const questionsFile = `${base}.questions.md`;
  const answersCopy = `${base}.answers.md`;

  const doc = await loadDocument(input);
  let answers: Answer[] = [];
  if (values.answers) {
    const file = Bun.file(values.answers);
    if (!(await file.exists())) throw new InputError(`Файл ответов не найден: ${values.answers}`);
    answers = parseAnswers(await file.text());
  }
  const version = await agentVersion(); // read before the run writes any files
  const llm = createLLM(process.env, { cacheDir: join(ROOT, ".cache", "llm"), readCache: !values["no-cache"], log: say });
  say(`Документ: ${input} (${doc.format}, ${doc.text.length} символов). Модель: ${llm.model}`);
  if (answers.length) say(`Ответы автора: ${answers.length} из ${values.answers}`);

  const once = async (given: Answer[], answersFile?: string) => {
    const startedAt = new Date();
    const [calls0, cached0] = [llm.calls, llm.cached];
    // The questions file is rewritten below, so keep the author's answers in a copy of their own.
    if (answersFile && resolve(answersFile) !== resolve(answersCopy)) await Bun.write(answersCopy, Bun.file(answersFile));
    const result = await runChecks(doc, llm, say, given);
    const passport: Passport = {
      file: input,
      format: doc.format,
      pages: doc.pageCount,
      sha256: doc.sha256,
      startedAt,
      durationMs: Date.now() - startedAt.getTime(),
      provider: llm.provider,
      model: llm.model,
      stepModels: { ...llm.stepModels },
      agentVersion: version,
      calls: llm.calls - calls0,
      cached: llm.cached - cached0,
      answersFile: answersFile && answersCopy,
    };
    await mkdir(dirname(output) || ".", { recursive: true });
    await Bun.write(output, renderReport(result, passport));
    await Bun.write(`${base}.json`, JSON.stringify({ passport, ...result }, null, 2));
    const rerun = `bun start ${input} ${output} --answers ${questionsFile}`;
    await Bun.write(questionsFile, renderQuestionsFile(result.title, result.questions, rerun));
    summary(result, output);
    return { result, rerun };
  };

  const { result, rerun } = await once(answers, values.answers);
  if (!values.ask) {
    if (result.questions.length) say(`Вопросы к автору: ${questionsFile}. Ответы можно передать так: ${rerun}`);
    return 0;
  }
  // Answers reach every prompt except the extraction, so a re-check repeats all other steps of this run.
  const callsPerRun = Math.max(1, llm.calls + llm.cached - 1);
  if (await ask(result, questionsFile, rerun, callsPerRun))
    await once(parseAnswers(await Bun.file(questionsFile).text()), questionsFile);
  return 0;
}

function summary(result: RunResult, output: string) {
  const critical = result.findings.filter((f) => f.critical).length + result.setFindings.filter((f) => f.critical).length;
  say(
    `Готово: ${output}. Требований: ${result.requirements.length}, нарушений: ${result.findings.length + result.setFindings.length}, критичных: ${critical}, отклонено без цитаты: ${result.rejected.length}, вопросов автору: ${result.questions.length}`,
  );
  if (result.questions.length === 0) return;
  say("\nГлавные вопросы к автору документа:");
  for (const q of result.questions.slice(0, SHOW_QUESTIONS)) say(`  ${q.id}. ${ADDRESSEE[q.addressee]}: ${q.question}`);
  if (result.questions.length > SHOW_QUESTIONS) say(`  ...ещё ${result.questions.length - SHOW_QUESTIONS} в разделе 7 отчёта`);
  say("");
}

/**
 * Ask the questions in the terminal and save the answers into the questions file.
 * Returns true when the author wants a re-check with those answers.
 */
async function ask(result: RunResult, questionsFile: string, rerun: string, callsPerRun: number): Promise<boolean> {
  if (result.questions.length === 0) return false;
  if (!process.stdin.isTTY) {
    say("--ask работает только в интерактивном терминале. Ответьте в файле: " + questionsFile);
    return false;
  }
  say("Ответьте на вопросы. Enter пропускает вопрос, «q» завершает опрос.\n");
  const filled = new Map<string, string>();
  for (const q of result.questions) {
    say(`${q.id}. ${ADDRESSEE[q.addressee]}: ${q.question}`);
    if (q.options.length) say(`   Варианты: ${formatOptions(q.options)}`);
    const raw = (prompt("   Ответ:") ?? "").trim();
    if (raw.toLowerCase() === "q") break;
    if (!raw) continue;
    // A bare option number picks that option's text.
    const pick = /^\d$/.test(raw) ? q.options[Number(raw) - 1] : undefined;
    filled.set(q.id, pick ?? raw);
  }
  await Bun.write(questionsFile, renderQuestionsFile(result.title, result.questions, rerun, filled));
  if (filled.size === 0) {
    say("Ответов нет, повторная проверка не нужна.");
    return false;
  }
  say(`\nОтветы сохранены в ${questionsFile} (${filled.size}).`);
  const again = (prompt(`Проверить документ заново с ответами? Это ещё ~${callsPerRun} запросов к модели [y/N]`) ?? "").trim();
  if (/^(y|д|yes|да)$/i.test(again)) return true;
  say(`Повторить позже: ${rerun}`);
  return false;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    if (e instanceof InputError || e instanceof ConfigError) {
      say(`Ошибка: ${e.message}`);
      process.exit(2);
    }
    say(`Сбой прогона: ${errorText(e)}`);
    if (isDailyQuota(e))
      say(
        "Исчерпана дневная квота модели. Добавьте в GEMINI_MODEL другую модель, возьмите ключ из другого проекта Google Cloud или подождите до сброса квоты. Готовые шаги сохранены в .cache/llm, повторный запуск продолжит с места сбоя.",
      );
    else if (isTransient(e))
      say("Модель перегружена. Готовые шаги сохранены в .cache/llm, повторный запуск продолжит с места сбоя.");
    process.exit(1);
  },
);
