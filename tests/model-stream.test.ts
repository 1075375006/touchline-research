import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Provider } from "../server/domain.js";
const directory = mkdtempSync(join(tmpdir(), "touchline-stream-"));
process.env.DATA_DIR = directory;
process.env.APP_SECRET = "d".repeat(64);
const { complete } = await import("../server/models.js");
const { db } = await import("../server/db.js");
after(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

test("Responses streaming transport", async (t) => {
  let mode = "",
    calls = 0;
  const answer = {
    status: "completed",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: '{"结果":"通过⚽"}' }],
      },
    ],
    usage: { total_tokens: 34 },
  };
  const frame = (value: unknown) =>
    "data: " + JSON.stringify(value) + "\r\n\r\n";
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const request = JSON.parse(raw);
    calls++;
    assert.equal(request.stream, true);
    assert.equal(req.headers.authorization, "Bearer test-secret");
    if (mode === "json" || mode === "json-incomplete") {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify(
          mode === "json"
            ? answer
            : {
                ...answer,
                status: "incomplete",
                incomplete_details: { reason: "max_output_tokens" },
              },
        ),
      );
      return;
    }
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.write(
      ": keepalive\r\n\r\n" +
        frame({
          type: "response.created",
          response: { status: "in_progress" },
        }),
    );
    if (mode === "abort") return;
    if (mode === "socket" && calls === 1) {
      res.write(
        frame({
          type: "response.output_text.delta",
          delta: '{"partial":true}',
        }),
      );
      await delay(10);
      res.destroy();
      return;
    }
    if (mode === "truncated") {
      res.end(
        frame({
          type: "response.output_text.delta",
          delta: '{"partial":true}',
        }) + "data: [DONE]\n\n",
      );
      return;
    }
    if (mode === "incomplete") {
      res.end(
        frame({
          type: "response.incomplete",
          response: {
            ...answer,
            status: "incomplete",
            incomplete_details: { reason: "max_output_tokens" },
          },
        }),
      );
      return;
    }
    if (mode === "failed" || (mode === "server-error" && calls === 1)) {
      res.end(
        frame({
          type: "response.failed",
          response: {
            status: "failed",
            error: {
              code: mode === "failed" ? "invalid_api_key" : "server_error",
              message: "test-secret must never appear",
            },
          },
        }),
      );
      return;
    }
    if (mode === "error-event") {
      res.end(
        frame({
          type: "error",
          code: "invalid_api_key",
          message: "test-secret",
        }),
      );
      return;
    }
    if (mode === "malformed") {
      res.end("data: {broken\n\n");
      return;
    }
    const bytes = Buffer.from(
      frame({ type: "response.completed", response: answer }),
    );
    // Split UTF-8 inside a Chinese character and CRLF between network chunks.
    const split = bytes.indexOf(Buffer.from("通过")) + 1;
    res.write(bytes.subarray(0, split));
    await delay(5);
    res.write(bytes.subarray(split, bytes.length - 1));
    await delay(5);
    res.write(bytes.subarray(bytes.length - 1));
    // Deliberately keep the connection open: completion must terminate the reader.
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const provider: Provider = {
    id: "test",
    name: "test",
    type: "responses",
    model: "test",
    baseUrl: "http://127.0.0.1:" + (server.address() as any).port,
    secret: "test-secret",
    enabled: true,
    timeoutSeconds: 2,
    maxTokens: 4096,
  };
  const begin = (next: string) => {
    mode = next;
    calls = 0;
  };
  try {
    await t.test(
      "Unicode survives chunk boundaries and completion ends an open stream",
      async () => {
        begin("success");
        const result = await complete(provider, "source material");
        assert.deepEqual(JSON.parse(result.text), { 结果: "通过⚽" });
        assert.equal(result.tokens, 34);
        assert.equal(calls, 1);
      },
    );
    await t.test(
      "gateways returning plain JSON remain compatible",
      async () => {
        begin("json");
        assert.equal((await complete(provider, "prompt")).tokens, 34);
      },
    );
    await t.test(
      "partial socket failures retry and count both actual requests",
      async () => {
        begin("socket");
        let counted = 0;
        assert.equal(
          (await complete(provider, "prompt", undefined, () => counted++))
            .tokens,
          34,
        );
        assert.equal(calls, 2);
        assert.equal(counted, 2);
      },
    );
    await t.test(
      "EOF and DONE without completion never accept partial output",
      async () => {
        begin("truncated");
        await assert.rejects(
          complete(provider, "prompt"),
          /自动重试后仍失败.*未收到 response.completed/,
        );
        assert.equal(calls, 2);
      },
    );
    await t.test(
      "truncated output limits reject otherwise valid JSON without retry",
      async () => {
        for (const next of ["incomplete", "json-incomplete"]) {
          begin(next);
          await assert.rejects(
            complete(provider, "prompt"),
            /提高模型输出 Token 上限/,
          );
          assert.equal(calls, 1);
        }
      },
    );
    await t.test(
      "retry server failures but not permanent errors; never leak upstream messages",
      async () => {
        begin("server-error");
        assert.equal((await complete(provider, "prompt")).tokens, 34);
        assert.equal(calls, 2);
        for (const next of ["failed", "error-event", "malformed"]) {
          begin(next);
          await assert.rejects(complete(provider, "prompt"), (e: Error) => {
            assert(!e.message.includes("test-secret"));
            assert.match(e.message, /invalid_api_key|无效事件 JSON/);
            return true;
          });
          assert.equal(calls, 1);
        }
      },
    );
    await t.test(
      "caller cancellation interrupts a waiting stream without retry",
      async () => {
        begin("abort");
        await assert.rejects(
          complete(provider, "prompt", AbortSignal.timeout(60)),
        );
        assert.equal(calls, 1);
      },
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
