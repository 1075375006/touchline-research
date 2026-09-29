import { z } from "zod";

export const ThinkingSchema = z.object({
  mode: z.enum(["enabled", "default", "disabled"]).default("enabled"),
  effort: z
    .enum(["minimal", "low", "medium", "high", "xhigh", "max"])
    .default("high"),
  adapter: z
    .enum([
      "auto",
      "openai",
      "deepseek",
      "qwen",
      "anthropic-adaptive",
      "anthropic-budget",
      "gemini-level",
      "gemini-budget",
      "ollama-boolean",
      "ollama-level",
    ])
    .default("auto"),
  budgetTokens: z.number().int().min(1024).max(24576).default(2048),
});
export type ThinkingConfig = z.infer<typeof ThinkingSchema>;
export const effortLabels: Record<ThinkingConfig["effort"], string> = {
  minimal: "最少",
  low: "轻度",
  medium: "标准",
  high: "深度",
  xhigh: "更深",
  max: "最高",
};
export const adapterLabels: Record<ThinkingConfig["adapter"], string> = {
  auto: "按协议和模型自动选择",
  openai: "OpenAI reasoning effort",
  deepseek: "DeepSeek thinking",
  qwen: "Qwen / 百炼 enable_thinking",
  "anthropic-adaptive": "Claude 自适应思考",
  "anthropic-budget": "Claude 思考 token 预算",
  "gemini-level": "Gemini thinkingLevel",
  "gemini-budget": "Gemini thinkingBudget",
  "ollama-boolean": "Ollama 思考开关",
  "ollama-level": "Ollama 思考等级",
};
type Target = {
  type: string;
  model: string;
  maxTokens: number;
  thinking?: ThinkingConfig;
};
export function thinkingConfig(value?: unknown): ThinkingConfig {
  return ThinkingSchema.parse(value || {});
}
export function adaptersFor(type: string): ThinkingConfig["adapter"][] {
  if (type === "openai") return ["auto", "openai", "deepseek", "qwen"];
  if (type === "responses") return ["auto", "openai"];
  if (type === "anthropic")
    return ["auto", "anthropic-adaptive", "anthropic-budget"];
  if (type === "gemini") return ["auto", "gemini-level", "gemini-budget"];
  return ["auto", "ollama-boolean", "ollama-level"];
}
export function resolveThinkingAdapter(p: Target): ThinkingConfig["adapter"] {
  const c = thinkingConfig(p.thinking);
  if (c.adapter !== "auto") return c.adapter;
  const model = p.model.toLowerCase();
  if (p.type === "responses") return "openai";
  if (p.type === "openai")
    return model.includes("deepseek")
      ? "deepseek"
      : model.includes("qwen")
        ? "qwen"
        : "openai";
  if (p.type === "anthropic")
    return /(?:sonnet|opus)[-.]4[-.]6|(?:opus|sonnet)[-.](?:4[-.][7-9]|[5-9])|(?:fable|mythos)[-.]5/.test(
      model,
    )
      ? "anthropic-adaptive"
      : "anthropic-budget";
  if (p.type === "gemini")
    return model.includes("gemini-2.5") ? "gemini-budget" : "gemini-level";
  return model.includes("gpt-oss") ? "ollama-level" : "ollama-boolean";
}
export function thinkingEfforts(adapter: string): ThinkingConfig["effort"][] {
  if (
    adapter === "anthropic-budget" ||
    adapter === "gemini-budget" ||
    adapter === "qwen" ||
    adapter === "ollama-boolean"
  )
    return [];
  if (adapter === "gemini-level") return ["minimal", "low", "medium", "high"];
  if (adapter === "ollama-level") return ["low", "medium", "high"];
  if (adapter === "deepseek") return ["low", "high", "max"];
  if (adapter === "anthropic-adaptive")
    return ["low", "medium", "high", "xhigh", "max"];
  return ["minimal", "low", "medium", "high", "xhigh", "max"];
}
export function thinkingValidation(p: Target): string | undefined {
  const c = thinkingConfig(p.thinking);
  if (!adaptersFor(p.type).includes(c.adapter))
    return "思考参数格式与接口协议不匹配";
  if (c.mode === "disabled" && resolveThinkingAdapter(p) === "gemini-level")
    return "Gemini 等级模式不支持统一的关闭指令；请选择模型默认或该模型支持的预算模式";
  if (c.mode !== "enabled") return;
  const adapter = resolveThinkingAdapter(p),
    levels = thinkingEfforts(adapter);
  if (levels.length && !levels.includes(c.effort))
    return "当前参数格式不支持该思考深度，请选择支持的等级";
  if (
    ["anthropic-budget", "gemini-budget"].includes(adapter) &&
    c.budgetTokens + 1024 > p.maxTokens
  )
    return "总输出上限需至少比思考预算多 1024 tokens，为最终研究 JSON 保留空间";
}
export function applyThinking(p: Target, body: any) {
  const problem = thinkingValidation(p);
  if (problem) throw new Error(problem);
  const c = thinkingConfig(p.thinking);
  if (c.mode === "default") return;
  const adapter = resolveThinkingAdapter(p),
    enabled = c.mode === "enabled";
  if (adapter === "openai") {
    if (p.type === "responses")
      body.reasoning = { effort: enabled ? c.effort : "none" };
    else body.reasoning_effort = enabled ? c.effort : "none";
  } else if (adapter === "deepseek") {
    body.thinking = { type: enabled ? "enabled" : "disabled" };
    if (enabled) body.reasoning_effort = c.effort;
  } else if (adapter === "qwen") {
    body.enable_thinking = enabled;
    if (enabled) body.thinking_budget = c.budgetTokens;
  } else if (adapter === "anthropic-adaptive") {
    body.thinking = { type: enabled ? "adaptive" : "disabled" };
    if (enabled) body.output_config = { effort: c.effort };
  } else if (adapter === "anthropic-budget") {
    body.thinking = enabled
      ? { type: "enabled", budget_tokens: c.budgetTokens }
      : { type: "disabled" };
  } else if (adapter === "gemini-level") {
    if (!enabled)
      throw new Error(
        "Gemini 等级模式不承诺支持关闭思考；请按模型文档选择模型默认或预算模式",
      );
    body.generationConfig.thinkingConfig = {
      thinkingLevel: c.effort.toUpperCase(),
    };
  } else if (adapter === "gemini-budget") {
    body.generationConfig.thinkingConfig = {
      thinkingBudget: enabled ? c.budgetTokens : 0,
    };
  } else {
    body.think = enabled
      ? adapter === "ollama-level"
        ? c.effort
        : true
      : false;
  }
}
export function thinkingSummary(p: Target) {
  const c = thinkingConfig(p.thinking),
    adapter = resolveThinkingAdapter(p);
  if (c.mode === "default") return "模型默认（不发送思考参数）";
  if (c.mode === "disabled") return "请求关闭原生思考";
  const level = thinkingEfforts(adapter).length
    ? effortLabels[c.effort]
    : adapter === "ollama-boolean"
      ? "开启"
      : c.budgetTokens + " tokens 预算";
  return "主动思考 · " + level + " · " + adapterLabels[adapter];
}
export type ThinkingUsage = {
  requested: boolean;
  mode: ThinkingConfig["mode"];
  adapter: string;
  effort: string | null;
  budgetTokens: number | null;
  observed: boolean;
  reasoningTokens: number | null;
  summary: string;
};
export function thinkingUsage(p: Target, r: any): ThinkingUsage {
  const c = thinkingConfig(p.thinking),
    adapter = resolveThinkingAdapter(p);
  const value =
    r.usage?.output_tokens_details?.reasoning_tokens ??
    r.usage?.completion_tokens_details?.reasoning_tokens ??
    r.usageMetadata?.thoughtsTokenCount;
  const reasoningTokens =
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : null;
  const observed =
    (reasoningTokens ?? 0) > 0 ||
    Boolean(r.choices?.[0]?.message?.reasoning_content) ||
    Boolean(r.message?.thinking) ||
    (r.candidates?.[0]?.content?.parts || []).some(
      (x: any) => x.thought === true,
    ) ||
    (r.content || []).some(
      (x: any) => x.type === "thinking" || x.type === "redacted_thinking",
    ) ||
    (r.output || []).some((x: any) => x.type === "reasoning");
  return {
    requested: c.mode === "enabled",
    mode: c.mode,
    adapter,
    effort:
      c.mode === "enabled" && thinkingEfforts(adapter).length ? c.effort : null,
    budgetTokens:
      c.mode === "enabled" &&
      ["anthropic-budget", "gemini-budget", "qwen"].includes(adapter)
        ? c.budgetTokens
        : null,
    observed,
    reasoningTokens,
    summary: thinkingSummary(p),
  };
}
export const ACTIVE_RESEARCH_POLICY =
  "主动研究要求：每轮先判断现有材料能回答什么、还缺什么，再决定最有信息价值的查询或独立核验；收到新来源后修正后续搜索和结论，不机械重复固定关键词。只输出可审查的搜索计划、简短决策依据、证据缺口与结论，不输出私有思维链。";
