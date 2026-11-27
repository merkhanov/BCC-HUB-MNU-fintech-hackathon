/**
 * Optional second opinion on the model's findings from TypeSafe System One (model Jev): one request with the document
 * as state and one yes/no question per finding, answered as a probability that the finding is a real defect.
 * On 373 hand-labelled findings from seven runs Jev's probability separated real findings from false ones with
 * AUC 0.82; see README, «Судья находок».
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export interface JudgeItem {
  key: string;
  quote: string;
  text: string;
}

export interface Judge {
  /** Model name as the API reports it, e.g. «jev-1.14.0». */
  model: string;
  threshold: number;
  /** Probability per item key that the finding is a real defect; null when the call failed. */
  score(docText: string, items: JudgeItem[]): Promise<Record<string, number> | null>;
}

const API_URL = "https://api.typesafe.ai/v1/systemone";
const TIMEOUT_MS = 300_000;
const ATTEMPTS = 3;

const Answer = z.object({
  model: z.string(),
  answers: z.record(z.string(), z.object({ noul: z.number().min(0).max(1) })),
});

/** The question is fixed: it was written once and not tuned on the labels it was measured against. */
const question = (item: JudgeItem) =>
  `Находка рецензента к документу требований выше. Место: «${item.quote.slice(0, 300)}». Суть: ${item.text.slice(0, 700)}\n` +
  "Это реальный дефект требований, который нужно исправить или уточнить у автора до начала разработки?";
const CRITERIA = {
  true: "Документ действительно не отвечает на этот вопрос или противоречит сам себе, и без исправления разработчики или тестировщики могут сделать разное.",
  false:
    "Придирка к оформлению или служебным полям, проектная деталь, которую команда решит сама, или вопрос, на который документ уже отвечает в другом разделе.",
};

export function createJudge(
  env: Record<string, string | undefined>,
  opts: { cacheDir?: string; readCache?: boolean; log?: (msg: string) => void; url?: string } = {},
): Judge | null {
  const apiKey = env.TYPESAFE_API_KEY;
  if (!apiKey) return null;
  const threshold = env.TYPESAFE_THRESHOLD ? Number(env.TYPESAFE_THRESHOLD) : 0.5;
  if (!(threshold >= 0 && threshold <= 1)) throw new Error(`TYPESAFE_THRESHOLD должен быть числом от 0 до 1, сейчас «${env.TYPESAFE_THRESHOLD}»`);
  const requested = env.TYPESAFE_MODEL || "jev-latest";
  const log = opts.log ?? (() => {});
  const judge: Judge = {
    model: requested,
    threshold,
    async score(docText, items) {
      if (items.length === 0) return {};
      const body = JSON.stringify({
        model: requested,
        state: `Документ требований:\n${docText}`,
        questions: Object.fromEntries(items.map((it, i) => [`q${i}`, { type: "noul", instructions: question(it), criteria: CRITERIA }])),
      });
      const cacheFile = opts.cacheDir ? join(opts.cacheDir, `judge-${new Bun.CryptoHasher("sha256").update(body).digest("hex")}.json`) : null;
      if (cacheFile && opts.readCache !== false && (await Bun.file(cacheFile).exists())) {
        const cached = Answer.parse(await Bun.file(cacheFile).json());
        judge.model = cached.model;
        log(`   [judge] ответ из кэша (${cached.model})`);
        return byKey(items, cached);
      }
      for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        const started = Date.now();
        try {
          const res = await fetch(opts.url ?? API_URL, {
            method: "POST",
            signal: AbortSignal.timeout(TIMEOUT_MS),
            headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "TypeSafe-Danger-Zone-Long-Context": "true" },
            body,
          });
          const text = await res.text();
          if (!res.ok) {
            if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
            log(`   [judge] TypeSafe ответил ${res.status}: ${text.slice(0, 200)}. Прогон продолжается без судьи`);
            return null;
          }
          const parsed = Answer.parse(JSON.parse(text));
          if (cacheFile) {
            await mkdir(opts.cacheDir!, { recursive: true });
            await Bun.write(cacheFile, text);
          }
          judge.model = parsed.model;
          log(`   [judge] ${Math.round((Date.now() - started) / 1000)} с, ${parsed.model}`);
          return byKey(items, parsed);
        } catch (e) {
          log(`   [judge] попытка ${attempt}/${ATTEMPTS}: ${String((e as Error).message).slice(0, 200)}`);
          if (attempt < ATTEMPTS) await Bun.sleep(2000 * attempt);
        }
      }
      log("   [judge] TypeSafe не ответил. Прогон продолжается без судьи");
      return null;
    },
  };
  return judge;
}

function byKey(items: JudgeItem[], answer: z.infer<typeof Answer>): Record<string, number> {
  const out: Record<string, number> = {};
  items.forEach((it, i) => {
    const a = answer.answers[`q${i}`];
    if (a) out[it.key] = a.noul;
  });
  return out;
}
