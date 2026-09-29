import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { z } from "zod";
import {
  ThinkingSchema,
  applyThinking,
  thinkingConfig,
  thinkingUsage,
  resolveThinkingAdapter,
  thinkingValidation,
} from "../server/thinking.js";
const directory = mkdtempSync(join(tmpdir(), "touchline-thinking-"));
process.env.DATA_DIR = directory;
process.env.APP_SECRET = "d".repeat(64);
process.env.SETUP_TOKEN = "thinking-test-setup";
const {
  modelRequest: buildModelRequest,
  completeJson,
  getProvider,
} = await import("../server/models.js");
const modelRequest = (provider: Parameters<typeof buildModelRequest>[0]) =>
  buildModelRequest(provider, "test");
const { createApp } = await import("../server/app.js");
const { db } = await import("../server/db.js");
const { ProviderSchema } = await import("../server/domain.js");
const target = (
  type = "responses",
  model = "custom-reasoner",
  thinking = thinkingConfig(),
) => ({
  id: "model",
  name: "Model",
  type: type as any,
  model,
  thinking,
  baseUrl: "https://gateway.example/v1",
  secret: "secret-key",
  enabled: true,
  maxTokens: 8192,
  timeoutSeconds: 10,
});
after(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
test("native thinking configuration and protocol integration", async (t) => {
  await t.test(
    "defaults request high thinking and reject incompatible budgets or adapters",
    () => {
      assert.equal(ThinkingSchema.parse({}).mode, "enabled");
      assert.equal(ThinkingSchema.parse({}).effort, "high");
      assert.equal(
        resolveThinkingAdapter(target("openai", "qwen3.5-plus")),
        "qwen",
      );
      assert.equal(
        resolveThinkingAdapter(target("anthropic", "claude-sonnet-4-6")),
        "anthropic-adaptive",
      );
      assert.equal(
        resolveThinkingAdapter(target("gemini", "gemini-2.5-flash")),
        "gemini-budget",
      );
      assert.equal(
        resolveThinkingAdapter(target("ollama", "gpt-oss:20b")),
        "ollama-level",
      );
      assert(
        !ProviderSchema.safeParse({
          ...target("anthropic", "claude-sonnet-4-5"),
          maxTokens: 2048,
        }).success,
      );
      assert.match(
        thinkingValidation(
          target("responses", "reasoner", thinkingConfig({ adapter: "qwen" })),
        ) || "",
        /不匹配/,
      );
    },
  );
  await t.test(
    "OpenAI chat and Responses send configured effort; explicit default omits it",
    () => {
      for (const effort of [
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ] as const) {
        const config = thinkingConfig({ effort });
        assert.equal(
          (modelRequest(target("openai", "reasoner", config)).body as any)
            .reasoning_effort,
          effort,
        );
        assert.equal(
          (modelRequest(target("responses", "reasoner", config)).body as any)
            .reasoning.effort,
          effort,
        );
      }
      const response: any = modelRequest(
        target("responses", "reasoner", thinkingConfig({ mode: "default" })),
      ).body;
      assert.equal(response.reasoning, undefined);
      const disabled: any = modelRequest(
        target("responses", "reasoner", thinkingConfig({ mode: "disabled" })),
      ).body;
      assert.equal(disabled.reasoning.effort, "none");
    },
  );
  await t.test("native adapters keep their distinct request fields", () => {
    let body: any = modelRequest(target("openai", "deepseek-v4-pro")).body;
    assert.deepEqual(body.thinking, { type: "enabled" });
    assert.equal(body.max_tokens, 8192);
    assert.equal(body.max_completion_tokens, undefined);
    assert.equal(body.reasoning_effort, "high");
    body = modelRequest(target("openai", "qwen3.5-plus")).body;
    assert.equal(body.enable_thinking, true);
    assert.equal(body.max_tokens, 8192);
    assert.equal(body.thinking_budget, 2048);
    assert.equal(body.reasoning_effort, undefined);
    body = modelRequest(target("anthropic", "claude-sonnet-4-6")).body;
    assert.deepEqual(body.thinking, { type: "adaptive" });
    assert.equal(body.output_config.effort, "high");
    body = modelRequest(target("anthropic", "claude-sonnet-4-5")).body;
    assert.deepEqual(body.thinking, { type: "enabled", budget_tokens: 2048 });
    body = modelRequest(target("gemini", "gemini-3.1-pro")).body;
    assert.deepEqual(body.generationConfig.thinkingConfig, {
      thinkingLevel: "HIGH",
    });
    body = modelRequest(target("gemini", "gemini-2.5-flash")).body;
    assert.deepEqual(body.generationConfig.thinkingConfig, {
      thinkingBudget: 2048,
    });
    body = modelRequest(target("ollama", "qwen3:8b")).body;
    assert.equal(body.think, true);
    body = modelRequest(target("ollama", "gpt-oss:20b")).body;
    assert.equal(body.think, "high");
  });
  await t.test(
    "thinking telemetry reports actual markers without retaining private reasoning",
    () => {
      const output = thinkingUsage(target(), {
        usage: { output_tokens_details: { reasoning_tokens: 237 } },
        output: [{ type: "reasoning", content: "private-thought-secret" }],
      });
      assert.equal(output.reasoningTokens, 237);
      assert.equal(output.observed, true);
      assert(!JSON.stringify(output).includes("private-thought-secret"));
      const noSignal = thinkingUsage(target(), {
        usage: { total_tokens: 100 },
      });
      assert.equal(noSignal.requested, true);
      assert.equal(noSignal.observed, false);
      assert.equal(noSignal.reasoningTokens, null);
      assert(
        thinkingUsage(target("openai"), {
          choices: [
            { message: { reasoning_content: "private-thought-secret" } },
          ],
        }).observed,
      );
    },
  );
  await t.test(
    "model configuration persists thinking settings, preserves encrypted key, and validates errors",
    async () => {
      const admin = request.agent(createApp());
      await admin
        .post("/api/auth/setup")
        .send({
          username: "admin",
          password: "thinking-test-password",
          setupToken: "thinking-test-setup",
        })
        .expect(201);
      await admin
        .post("/api/auth/login")
        .send({ username: "admin", password: "thinking-test-password" })
        .expect(200);
      const input = {
        name: "Thinking provider",
        type: "responses",
        baseUrl: "https://gateway.example/v1",
        model: "reasoner",
        apiKey: "keep-this-key",
        thinking: thinkingConfig({ effort: "medium" }),
      };
      const created = await admin
        .post("/api/providers")
        .send(input)
        .expect(201);
      const id = created.body.id;
      const secret = db
        .prepare("SELECT secret FROM providers WHERE id=?")
        .get(id)?.secret;
      let listed = await admin.get("/api/providers").expect(200);
      assert.equal(listed.body[0].thinking.effort, "medium");
      assert(!JSON.stringify(listed.body).includes("keep-this-key"));
      await admin
        .put("/api/providers/" + id)
        .send({
          ...input,
          apiKey: "",
          thinking: thinkingConfig({ effort: "high" }),
        })
        .expect(200);
      assert.equal(
        db.prepare("SELECT secret FROM providers WHERE id=?").get(id)?.secret,
        secret,
      );
      assert.equal(getProvider(id).thinking?.effort, "high");
      await admin
        .put("/api/providers/" + id)
        .send({ ...input, thinking: thinkingConfig({ adapter: "qwen" }) })
        .expect(400);
      assert.equal(getProvider(id).thinking?.effort, "high");
      db.prepare("UPDATE providers SET thinking=? WHERE id=?").run("{}", id);
      assert.equal(getProvider(id).thinking?.mode, "enabled");
    },
  );
  await t.test(
    "actual HTTP JSON repair retains native effort and reports metadata",
    async () => {
      const bodies: any[] = [];
      let usage: any;
      const mock = createServer(async (req, res) => {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw);
        bodies.push(body);
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            status: "completed",
            output: [
              { type: "reasoning" },
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text:
                      bodies.length === 1
                        ? "bad-json"
                        : JSON.stringify({ ok: true }),
                  },
                ],
              },
            ],
            usage: {
              total_tokens: 53,
              output_tokens_details: { reasoning_tokens: 21 },
            },
          }),
        );
      });
      await new Promise<void>((resolve) =>
        mock.listen(0, "127.0.0.1", resolve),
      );
      try {
        const p = {
          ...target(),
          baseUrl: "http://127.0.0.1:" + (mock.address() as any).port,
        };
        const result = await completeJson(
          p,
          "生成下一步搜索计划",
          z.object({ ok: z.literal(true) }),
          undefined,
          (_tokens, meta) => {
            usage = meta;
          },
        );
        assert(result.ok);
        assert.equal(bodies.length, 2);
        assert(bodies.every((b) => b.reasoning.effort === "high"));
        assert.equal(usage.reasoningTokens, 21);
      } finally {
        await new Promise<void>((resolve) => mock.close(() => resolve()));
      }
    },
  );
  await t.test(
    "unsupported native effort fails explicitly without disabling thinking",
    async () => {
      const bodies: any[] = [];
      const mock = createServer(async (req, res) => {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        bodies.push(JSON.parse(raw));
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            error: { message: "unsupported reasoning parameter" },
          }),
        );
      });
      await new Promise<void>((resolve) =>
        mock.listen(0, "127.0.0.1", resolve),
      );
      try {
        const p = {
          ...target(),
          baseUrl: "http://127.0.0.1:" + (mock.address() as any).port,
        };
        await assert.rejects(
          completeJson(p, "test", z.object({ ok: z.boolean() })),
          /不会静默关闭思考/,
        );
        assert.equal(bodies.length, 1);
        assert.equal(bodies[0].reasoning.effort, "high");
      } finally {
        await new Promise<void>((resolve) => mock.close(() => resolve()));
      }
    },
  );
  await t.test(
    "native thinking truncation never accepts partial JSON or silently retries",
    async () => {
      const bodies: any[] = [];
      const mock = createServer(async (req, res) => {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        bodies.push(JSON.parse(raw));
        const text = JSON.stringify({ ok: true });
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            choices: [{ finish_reason: "length", message: { content: text } }],
            stop_reason: "max_tokens",
            content: [{ type: "text", text }],
            candidates: [
              { finishReason: "MAX_TOKENS", content: { parts: [{ text }] } },
            ],
            done_reason: "length",
            message: { content: text },
          }),
        );
      });
      await new Promise<void>((resolve) =>
        mock.listen(0, "127.0.0.1", resolve),
      );
      try {
        for (const type of ["openai", "anthropic", "gemini", "ollama"]) {
          const before = bodies.length;
          await assert.rejects(
            completeJson(
              {
                ...target(type),
                baseUrl: "http://127.0.0.1:" + (mock.address() as any).port,
              },
              "test",
              z.object({ ok: z.boolean() }),
            ),
            /达到单次输出上限/,
          );
          assert.equal(bodies.length, before + 1);
        }
      } finally {
        await new Promise<void>((resolve) => mock.close(() => resolve()));
      }
    },
  );
});
