import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { BaseLLM, errorText, type LLMOptions, type Prompt } from "../src/llm.ts";

const tmp = await mkdtemp(join(tmpdir(), "req-checker-llm-"));
afterAll(() => rm(tmp, { recursive: true, force: true }));

const Schema = z.object({ ok: z.boolean() });
const prompt: Prompt = { system: "s", user: "u" };

/** "busy" always answers 503; any other model answers {"ok":true}, the first time with broken JSON. */
class FakeLLM extends BaseLLM {
  requests: string[] = [];
  private broken = true;
  constructor(models: string[], opts: LLMOptions) {
    super("fake", models, { backoffMs: 0, ...opts });
  }
  protected async complete(model: string) {
    this.requests.push(model);
    if (model === "busy") throw Object.assign(new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}'), { status: 503 });
    if (this.broken) {
      this.broken = false;
      return { text: "{not json" };
    }
    return { text: '{"ok":true}', reportedModel: `${model}-001` };
  }
}

test("falls back to the next model on overload, retries bad JSON, then serves later runs from cache", async () => {
  const cacheDir = join(tmp, "cache");
  const first = new FakeLLM(["busy", "spare"], { cacheDir });
  expect(await first.json("extract", prompt, Schema)).toEqual({ ok: true });
  expect(first.requests).toEqual(["busy", "busy", "busy", "busy", "busy", "spare", "spare"]);
  expect(first.stepModels).toEqual({ extract: "spare-001" });

  const second = new FakeLLM(["busy", "spare"], { cacheDir });
  expect(await second.json("extract", prompt, Schema)).toEqual({ ok: true });
  expect(second.requests).toEqual([]); // the cached fallback answer is used without retrying "busy"
  expect(second.cached).toBe(1);
});

test("readCache: false asks the model again but still saves the answer", async () => {
  const cacheDir = join(tmp, "cache-fresh");
  const fresh = new FakeLLM(["spare"], { cacheDir, readCache: false });
  await fresh.json("set", prompt, Schema);
  await fresh.json("set", prompt, Schema);
  expect(fresh.requests).toEqual(["spare", "spare", "spare"]); // broken JSON once, then two real answers
  const replay = new FakeLLM(["spare"], { cacheDir });
  await replay.json("set", prompt, Schema);
  expect(replay.cached).toBe(1);
});

test("non-transient errors are not retried", async () => {
  class Denied extends FakeLLM {
    protected override async complete(model: string): Promise<never> {
      this.requests.push(model);
      throw Object.assign(new Error("API key not valid"), { status: 400 });
    }
  }
  const llm = new Denied(["a", "b"], {});
  await expect(llm.json("extract", prompt, Schema)).rejects.toThrow("API key not valid");
  expect(llm.requests).toEqual(["a"]);
});

test("errorText unwraps Gemini JSON errors", () => {
  expect(errorText(new Error('{"error":{"code":503,"status":"UNAVAILABLE","message":"high demand"}}'))).toBe(
    "503 UNAVAILABLE: high demand",
  );
  expect(errorText(new Error("plain"))).toBe("plain");
});
