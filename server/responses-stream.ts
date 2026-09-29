/** Responses SSE is complete only after response.completed, never at a delta or [DONE]. */
export class ResponsesStreamError extends Error {
  constructor(
    message: string,
    public retryable = false,
    public code = "",
  ) {
    super(message);
    this.name = "ResponsesStreamError";
  }
}
function safeCode(value: unknown): string {
  return typeof value === "string" && /^[a-zA-Z0-9_]{1,80}$/.test(value)
    ? value
    : "unknown";
}
export function assertResponsesComplete(response: any) {
  if (response?.status === "incomplete") {
    const reason = safeCode(response.incomplete_details?.reason);
    throw new ResponsesStreamError(
      reason === "max_output_tokens"
        ? "模型输出达到输出上限，结果不完整；请提高模型输出 Token 上限后继续研究"
        : "模型结果不完整 [" + reason + "]",
    );
  }
  if (response?.error || response?.status === "failed") {
    const code = safeCode(response.error?.code);
    throw new ResponsesStreamError(
      "模型上游生成失败 [" + code + "]",
      ["server_error", "rate_limit_exceeded"].includes(code),
      code,
    );
  }
  if (response?.status && response.status !== "completed")
    throw new ResponsesStreamError(
      "模型返回未完成状态 [" + safeCode(response.status) + "]",
    );
}
export class ResponsesStream {
  private buffer = "";
  private completed: any;
  events = 0;
  get done() {
    return this.completed !== undefined;
  }
  push(chunk: string): boolean {
    this.buffer += chunk;
    // Preserve CRLF split across TCP chunks; SSE frames end with a blank line.
    let boundary: RegExpExecArray | null;
    while ((boundary = /\r?\n\r?\n/.exec(this.buffer))) {
      const frame = this.buffer.slice(0, boundary.index);
      this.buffer = this.buffer.slice(boundary.index + boundary[0].length);
      const lines = frame.split(/\r?\n/);
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (!data || data === "[DONE]") continue;
      let event: any;
      try {
        event = JSON.parse(data);
      } catch {
        throw new ResponsesStreamError("模型流返回无效事件 JSON");
      }
      this.events++;
      if (event.type === "error") {
        assertResponsesComplete({ status: "failed", error: event });
      }
      if (["response.failed", "response.incomplete"].includes(event.type)) {
        assertResponsesComplete({
          ...event.response,
          status: event.type.slice(9),
        });
      }
      if (event.type === "response.completed") {
        if (!event.response || typeof event.response !== "object")
          throw new ResponsesStreamError("模型流完成事件缺少 response");
        assertResponsesComplete(event.response);
        this.completed = event.response;
        return true;
      }
    }
    return false;
  }
  result() {
    if (!this.done)
      throw new ResponsesStreamError(
        "模型流提前结束，未收到 response.completed；未采用残缺输出",
        true,
      );
    return this.completed;
  }
}
