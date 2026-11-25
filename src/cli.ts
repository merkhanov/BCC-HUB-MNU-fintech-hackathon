#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import pkg from "../package.json";
import { ConfigError, createLLM, errorText, isDailyQuota, isTransient } from "./llm.ts";
import { InputError, loadDocument, SUPPORTED } from "./load.ts";
import { runChecks } from "./pipeline.ts";
import { renderReport } from "./report.ts";

const USAGE = `Агент проверки требований (ISO/IEC/IEEE 29148:2018, IEEE 830-1998)

Использование:
  bun start <файл требований> [файл отчёта]

  <файл требований>  ${SUPPORTED.join(", ")}
  [файл отчёта]      Markdown-отчёт. По умолчанию reports/<имя>.report.md
                     Рядом пишется <отчёт>.json с теми же данными в машинном виде.

  --no-cache         Спросить модель заново, не беря ответы из .cache/llm. Новые ответы
                     всё равно сохраняются, чтобы прогон можно было продолжить после сбоя.
  -h, --help         Эта справка.

Настройки в .env (см. .env.example): LLM_PROVIDER, GEMINI_API_KEY, GEMINI_MODEL.`;

const ROOT = resolve(import.meta.dir, "..");

async function agentVersion(): Promise<string> {
  const git = await Bun.$`git -C ${ROOT} describe --always --tags`.quiet().nothrow();
  if (git.exitCode !== 0) return `${pkg.name} ${pkg.version}, вне git`;
  // --dirty ignores untracked files, so check the agent's own folder explicitly.
  const status = await Bun.$`git -C ${ROOT} status --porcelain -- . :!reports`.quiet().nothrow();
  const dirty = status.stdout.toString().trim() ? " + незакоммиченные изменения" : "";
  return `${pkg.name} ${pkg.version}, коммит ${git.stdout.toString().trim()}${dirty}`;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: { help: { type: "boolean", short: "h" }, "no-cache": { type: "boolean" } },
    allowPositionals: true,
  });
  if (values.help || positionals.length === 0 || positionals.length > 2) {
    console.error(USAGE);
    return values.help ? 0 : 2;
  }

  const input = positionals[0]!;
  const output = positionals[1] ?? join("reports", `${basename(input, extname(input))}.report.md`);
  const startedAt = new Date();

  const doc = await loadDocument(input);
  const log = (m: string) => console.error(m);
  const llm = createLLM(process.env, { cacheDir: join(ROOT, ".cache", "llm"), readCache: !values["no-cache"], log });
  console.error(`Документ: ${input} (${doc.format}, ${doc.text.length} символов). Модель: ${llm.model}`);

  const result = await runChecks(doc, llm, log);
  const passport = {
    file: input,
    format: doc.format,
    pages: doc.pageCount,
    sha256: doc.sha256,
    startedAt,
    durationMs: Date.now() - startedAt.getTime(),
    provider: llm.provider,
    model: llm.model,
    stepModels: llm.stepModels,
    agentVersion: await agentVersion(),
    calls: llm.calls,
    cached: llm.cached,
  };

  await mkdir(dirname(output) || ".", { recursive: true });
  await Bun.write(output, renderReport(result, passport));
  await Bun.write(`${output.replace(/\.md$/, "")}.json`, JSON.stringify({ passport, ...result }, null, 2));

  const critical = result.findings.filter((f) => f.critical).length + result.setFindings.filter((f) => f.critical).length;
  console.error(
    `Готово: ${output}. Требований: ${result.requirements.length}, нарушений: ${result.findings.length + result.setFindings.length}, критичных: ${critical}, отклонено без цитаты: ${result.rejected.length}`,
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    if (e instanceof InputError || e instanceof ConfigError) {
      console.error(`Ошибка: ${e.message}`);
      process.exit(2);
    }
    console.error(`Сбой прогона: ${errorText(e)}`);
    if (isDailyQuota(e))
      console.error(
        "Исчерпана дневная квота модели. Добавьте в GEMINI_MODEL другую модель, возьмите ключ из другого проекта Google Cloud или подождите до сброса квоты. Готовые шаги сохранены в .cache/llm, повторный запуск продолжит с места сбоя.",
      );
    else if (isTransient(e))
      console.error("Модель перегружена. Готовые шаги сохранены в .cache/llm, повторный запуск продолжит с места сбоя.");
    process.exit(1);
  },
);
