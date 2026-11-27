import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export interface Prompt {
  system: string;
  user: string;
}

export interface LLM {
  provider: string;
  /** First configured model. */
  model: string;
  /** Model that answered each step (the API-reported version when available). */
  stepModels: Record<string, string>;
  /** Requests sent to the API, including retries. */
  calls: number;
  /** Steps answered from the local cache without calling the API. */
  cached: number;
  /** `attempts` lowers the per-model attempt limit for a step that has its own fallback. */
  json<T>(step: string, prompt: Prompt, schema: z.ZodType<T>, opts?: StepOptions): Promise<T>;
}

export interface StepOptions {
  attempts?: number;
}

export interface LLMOptions {
  /** Directory for cached answers; undefined disables the cache. */
  cacheDir?: string;
  /** false: ask the model again but still save answers, so a failed run can resume. */
  readCache?: boolean;
  log?: (msg: string) => void;
  /** Base of the exponential backoff; tests set it to 0. */
  backoffMs?: number;
  /** Hard limit per request; tests set it low. */
  timeoutMs?: number;
}

export class ConfigError extends Error {}

const TEMPERATURE = 0.1;
/** Per-request limit. Thinking models need a minute or two on the full document. */
const REQUEST_TIMEOUT_MS = 300_000;
/** Backoff 5, 10, 20, 40 s… capped at 60 s. */
const ATTEMPTS_WITH_FALLBACK = 5;
const ATTEMPTS_LAST_MODEL = 8;
/**
 * A request that hung until the deadline has likely been counted against the daily quota and cost 5 minutes.
 * After this many on one model, the next model in the chain gets the step.
 */
const TIMEOUTS_BEFORE_SWITCH = 2;

export function createLLM(env: Record<string, string | undefined> = process.env, opts: LLMOptions = {}): LLM {
  const provider = (env.LLM_PROVIDER ?? "gemini").toLowerCase();
  if (provider === "gemini") {
    if (!env.GEMINI_API_KEY || env.GEMINI_API_KEY === "your_gemini_api_key_here") {
      throw new ConfigError(
        "Не задан GEMINI_API_KEY. Скопируйте .env.example в .env и укажите ключ из https://aistudio.google.com/apikey",
      );
    }
    return new GeminiLLM(env.GEMINI_API_KEY, models(env.GEMINI_MODEL, "gemini-3.6-flash,gemini-3.5-flash-lite"), opts);
  }
  if (provider === "openai") {
    if (!env.OPENAI_MODEL) throw new ConfigError("Не задан OPENAI_MODEL для LLM_PROVIDER=openai");
    return new OpenAICompatibleLLM(
      env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      env.OPENAI_API_KEY ?? "",
      models(env.OPENAI_MODEL, ""),
      opts,
    );
  }
  if (provider === "fixture") {
    if (!env.FIXTURE_DIR) throw new ConfigError("Не задан FIXTURE_DIR для LLM_PROVIDER=fixture");
    return new FixtureLLM(env.FIXTURE_DIR);
  }
  throw new ConfigError(`Неизвестный LLM_PROVIDER=${provider}. Допустимо: gemini, openai, fixture`);
}

/** "a, b" → ["a", "b"]: the first model is primary, the rest are fallbacks for overload. */
function models(value: string | undefined, fallback: string): string[] {
  const list = (value || fallback).split(",").map((m) => m.trim()).filter(Boolean);
  if (list.length === 0) throw new ConfigError("Не задана модель");
  return list;
}

/** JSON Schema for the model, without the keys Gemini rejects. */
function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _, ...rest } = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  return rest;
}

function parse<T>(raw: string, schema: z.ZodType<T>): T {
  const text = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  return schema.parse(JSON.parse(text));
}

class RetryableError extends Error {}

class RequestTimeout extends Error {
  override name = "TimeoutError";
}

/** A per-day quota (429 with a PerDay quota id) does not clear within minutes: switch model instead of retrying. */
export function isDailyQuota(e: unknown): boolean {
  const err = e as { status?: number; message?: string };
  return err?.status === 429 && /PerDay/i.test(err?.message ?? "");
}

/** Overload, rate limit, server error, timeout or dropped connection: worth retrying or switching model. */
export function isTransient(e: unknown): boolean {
  const err = e as { status?: number; name?: string; message?: string };
  if (err?.status === 429 || (typeof err?.status === "number" && err.status >= 500)) return true;
  if (err?.name === "AbortError" || err?.name === "TimeoutError") return true;
  return /timed? ?out|fetch failed|ECONNRESET|socket|network/i.test(err?.message ?? "");
}

/** Gemini puts a JSON body in the error message; keep only "503 UNAVAILABLE: text". */
export function errorText(e: unknown): string {
  const msg = String((e as Error)?.message ?? e);
  try {
    const { error } = JSON.parse(msg) as { error: { code?: number; status?: string; message?: string } };
    return [error.code, error.status].filter(Boolean).join(" ") + (error.message ? `: ${error.message}` : "");
  } catch {
    return msg;
  }
}

interface Completion {
  text: string;
  reportedModel?: string;
}

/** Retries, model fallback and the answer cache, shared by the real providers. */
export abstract class BaseLLM implements LLM {
  stepModels: Record<string, string> = {};
  calls = 0;
  cached = 0;
  private current = 0;

  constructor(
    readonly provider: string,
    private readonly models: string[],
    private readonly opts: LLMOptions,
  ) {}

  get model(): string {
    return this.models[0]!;
  }

  protected abstract complete(model: string, prompt: Prompt, schema: z.ZodType, signal: AbortSignal): Promise<Completion>;

  /**
   * One request with a hard deadline. The SDK timeout alone once let a response hang for 55 minutes,
   * so the request is also aborted and raced against a timer here.
   */
  private async completeWithDeadline(model: string, prompt: Prompt, schema: z.ZodType): Promise<Completion> {
    const ms = this.opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctrl.abort();
        reject(new RequestTimeout(`нет ответа за ${Math.round(ms / 1000)} с`));
      }, ms);
    });
    try {
      return await Promise.race([this.complete(model, prompt, schema, ctrl.signal), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  async json<T>(step: string, prompt: Prompt, schema: z.ZodType<T>, stepOpts: StepOptions = {}): Promise<T> {
    const log = this.opts.log ?? (() => {});
    const fileFor = (model: string) =>
      this.opts.cacheDir && join(this.opts.cacheDir, `${cacheKey(this.provider, model, prompt, schema)}.json`);

    // An answer cached from any model still in the chain beats waiting on an overloaded one.
    for (const model of this.opts.readCache === false ? [] : this.models.slice(this.current)) {
      const file = fileFor(model);
      const hit = file ? await readCache(file, schema) : null;
      if (hit) {
        this.cached++;
        this.stepModels[step] = hit.model;
        log(`   [${step}] ответ из кэша (${hit.model})`);
        return hit.value;
      }
    }

    for (;;) {
      const model = this.models[this.current]!;
      const cacheFile = fileFor(model);
      const last = this.current === this.models.length - 1;
      try {
        const started = Date.now();
        const limit = last ? ATTEMPTS_LAST_MODEL : ATTEMPTS_WITH_FALLBACK;
        const attempts = Math.min(limit, stepOpts.attempts ?? limit);
        const { value, reportedModel } = await this.withRetry(step, model, prompt, schema, attempts, last);
        const used = reportedModel || model;
        this.stepModels[step] = used;
        log(`   [${step}] ${((Date.now() - started) / 1000).toFixed(0)} с, ${used}`);
        if (cacheFile) {
          await mkdir(this.opts.cacheDir!, { recursive: true });
          await Bun.write(cacheFile, JSON.stringify({ model: used, value }));
        }
        return value;
      } catch (e) {
        if (last || !isTransient(e)) throw e;
        this.current++;
        log(`   [${step}] ${model} недоступна, переключаюсь на ${this.models[this.current]}`);
      }
    }
  }

  private async withRetry<T>(
    step: string,
    model: string,
    prompt: Prompt,
    schema: z.ZodType<T>,
    attempts: number,
    last: boolean,
  ) {
    let feedback: string | undefined;
    let timeouts = 0;
    for (let attempt = 1; ; attempt++) {
      try {
        this.calls++;
        const user = feedback
          ? `${prompt.user}\n\nПредыдущий ответ не прошёл проверку схемы: ${feedback}\nВерни корректный JSON.`
          : prompt.user;
        const res = await this.completeWithDeadline(model, { system: prompt.system, user }, schema);
        return { value: parse(res.text, schema), reportedModel: res.reportedModel };
      } catch (e) {
        const badAnswer = e instanceof RetryableError || e instanceof z.ZodError || e instanceof SyntaxError;
        if ((!badAnswer && !isTransient(e)) || isDailyQuota(e) || attempt >= attempts) throw e;
        if (e instanceof RequestTimeout && ++timeouts >= TIMEOUTS_BEFORE_SWITCH && !last) throw e;
        const msg = e instanceof z.ZodError ? z.prettifyError(e) : errorText(e);
        if (badAnswer) feedback = msg.slice(0, 1000);
        const delay = Math.min(60_000, 2 ** attempt * (this.opts.backoffMs ?? 2_500));
        (this.opts.log ?? console.error)(
          `   [${step}] ${model}, попытка ${attempt}/${attempts}: ${msg.replace(/\s+/g, " ").slice(0, 160)}. Повтор через ${delay / 1000} с`,
        );
        await Bun.sleep(delay);
      }
    }
  }
}

function cacheKey(provider: string, model: string, prompt: Prompt, schema: z.ZodType): string {
  const key = JSON.stringify([provider, model, prompt.system, prompt.user, jsonSchema(schema)]);
  return new Bun.CryptoHasher("sha256").update(key).digest("hex");
}

async function readCache<T>(file: string, schema: z.ZodType<T>): Promise<{ model: string; value: T } | null> {
  const f = Bun.file(file);
  if (!(await f.exists())) return null;
  try {
    const { model, value } = (await f.json()) as { model: string; value: unknown };
    return { model, value: schema.parse(value) };
  } catch {
    return null; // stale or corrupt entry: ask the model again
  }
}

class GeminiLLM extends BaseLLM {
  private client?: import("@google/genai").GoogleGenAI;

  constructor(
    private readonly apiKey: string,
    models: string[],
    opts: LLMOptions,
  ) {
    super("Google Gemini API", models, opts);
  }

  protected async complete(model: string, prompt: Prompt, schema: z.ZodType, signal: AbortSignal): Promise<Completion> {
    const { GoogleGenAI } = await import("@google/genai");
    // The SDK's own retries would multiply ours, so they are off.
    this.client ??= new GoogleGenAI({
      apiKey: this.apiKey,
      httpOptions: { timeout: REQUEST_TIMEOUT_MS, retryOptions: { attempts: 1 } },
    });
    const res = await this.client.models.generateContent({
      model,
      contents: prompt.user,
      config: {
        abortSignal: signal,
        systemInstruction: prompt.system,
        temperature: TEMPERATURE,
        responseMimeType: "application/json",
        responseJsonSchema: jsonSchema(schema),
      },
    });
    if (!res.text) throw new RetryableError(`пустой ответ (${res.candidates?.[0]?.finishReason ?? "без причины"})`);
    return { text: res.text, reportedModel: res.modelVersion };
  }
}

/** Any OpenAI-compatible chat completions endpoint: OpenAI, OpenRouter, Ollama, vLLM. */
class OpenAICompatibleLLM extends BaseLLM {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    models: string[],
    opts: LLMOptions,
  ) {
    super(`OpenAI-совместимый API (${new URL(baseUrl).host})`, models, opts);
  }

  /** Models that reject a temperature setting (OpenAI reasoning models); learned from their first 400 answer. */
  private readonly noTemperature = new Set<string>();

  protected async complete(model: string, prompt: Prompt, schema: z.ZodType, signal: AbortSignal): Promise<Completion> {
    const send = () =>
      fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model,
          ...(this.noTemperature.has(model) ? {} : { temperature: TEMPERATURE }),
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: `${prompt.system}\n\nОтвечай только JSON по схеме:\n${JSON.stringify(jsonSchema(schema))}` },
            { role: "user", content: prompt.user },
          ],
        }),
      });
    let res = await send();
    let text = res.ok ? "" : await res.text();
    if (res.status === 400 && /temperature/i.test(text) && !this.noTemperature.has(model)) {
      this.noTemperature.add(model);
      res = await send();
      text = res.ok ? "" : await res.text();
    }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`) as Error & { status: number };
      err.status = res.status;
      throw err;
    }
    const body = (await res.json()) as { model?: string; choices: { message: { content: string } }[] };
    return { text: body.choices[0]?.message.content ?? "", reportedModel: body.model };
  }
}

/** Replays saved model answers from FIXTURE_DIR/<step>.json. Used by tests, never for a real report. */
class FixtureLLM implements LLM {
  provider = "fixture (тестовый режим, не модель)";
  model = "fixture";
  stepModels: Record<string, string> = {};
  calls = 0;
  cached = 0;

  constructor(private readonly dir: string) {}

  async json<T>(step: string, _prompt: Prompt, schema: z.ZodType<T>): Promise<T> {
    this.calls++;
    this.stepModels[step] = "fixture";
    const file = Bun.file(join(this.dir, `${step}.json`));
    if (!(await file.exists())) throw new ConfigError(`Нет фикстуры ${step}.json в ${this.dir}`);
    return parse(await file.text(), schema);
  }
}
