import { InputError, formatLocation } from "./load.ts";
import type { Question } from "./pipeline.ts";
import type { Answer } from "./prompts.ts";
import { ADDRESSEE } from "./report.ts";

/**
 * The questions file is plain Markdown with an empty «Ответ:» line under each question. The author fills
 * the lines in and passes the file back with --answers; empty answers are skipped.
 */
export function renderQuestionsFile(
  title: string,
  questions: Question[],
  rerun: string,
  filled: Map<string, string> = new Map(),
): string {
  const out = [
    `# Уточняющие вопросы к документу «${title}»`,
    "",
    "Вопросы составил агент проверки требований по найденным дефектам. Впишите ответы после «Ответ:», пустые ответы агент пропустит. Затем запустите повторную проверку с ответами:",
    "",
    "```",
    rerun,
    "```",
    "",
  ];
  for (const q of questions) {
    out.push(`## ${q.id}. ${ADDRESSEE[q.addressee]}${q.critical ? ", по критичному дефекту" : ""}`, "");
    out.push(`Вопрос: ${q.question}`, "");
    out.push(`Почему важно: ${q.why}`, "");
    if (q.options.length) out.push(`Варианты: ${q.options.map((o, i) => `${i + 1}) ${o}`).join("; ")}`, "");
    out.push(`Место: ${q.places.map((p) => formatLocation(p.location)).join("; ")}`, "");
    out.push(`Ответ: ${filled.get(q.id) ?? ""}`.trimEnd(), "");
  }
  return out.join("\n");
}

/** Read the answered questions back. Throws InputError when the file has no filled «Ответ:» line. */
export function parseAnswers(text: string): Answer[] {
  const answers: Answer[] = [];
  for (const block of text.split(/^## /m).slice(1)) {
    const question = /^Вопрос:[ \t]*(.+)$/m.exec(block)?.[1]?.trim();
    const answer = /^Ответ:[ \t]*([\s\S]*)$/m.exec(block)?.[1]?.trim();
    if (question && answer) answers.push({ question, answer });
  }
  if (answers.length === 0) throw new InputError("В файле ответов нет заполненных строк «Ответ:»");
  return answers;
}
