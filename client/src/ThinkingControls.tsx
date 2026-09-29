import { Field } from "./lib";
import {
  adaptersFor,
  adapterLabels,
  effortLabels,
  resolveThinkingAdapter,
  thinkingEfforts,
  type ThinkingConfig,
} from "../../server/thinking";
export default function ThinkingControls({
  type,
  model,
  value,
  onChange,
  description = "用于搜索规划、证据审查、补搜决策和最终报告。发送模型的原生思考参数；实际支持的等级取决于模型及网关。",
}: {
  type: string;
  model: string;
  value: ThinkingConfig;
  onChange: (value: ThinkingConfig) => void;
  description?: string;
}) {
  const adapter = resolveThinkingAdapter({
    type,
    model,
    maxTokens: 32768,
    thinking: value,
  });
  const efforts = thinkingEfforts(adapter);
  const budget = ["anthropic-budget", "gemini-budget", "qwen"].includes(
    adapter,
  );
  return (
    <div className="panel" style={{ padding: 18, marginBottom: 18 }}>
      <h3>主动思考</h3>
      <p className="muted small">{description}</p>
      <Field label="思考模式">
        <select
          aria-label="思考模式"
          value={value.mode}
          onChange={(e) =>
            onChange({
              ...value,
              mode: e.target.value as ThinkingConfig["mode"],
            })
          }
        >
          <option value="enabled">开启主动思考（推荐）</option>
          <option value="default">模型默认（不发送思考参数）</option>
          <option value="disabled">请求关闭思考（模型需支持）</option>
        </select>
      </Field>
      <Field
        label="思考参数格式"
        hint={
          "当前解析为：" + adapterLabels[adapter] + "。网关映射不同可手动选择。"
        }
      >
        <select
          aria-label="思考参数格式"
          value={value.adapter}
          onChange={(e) => {
            const next = {
              ...value,
              adapter: e.target.value as ThinkingConfig["adapter"],
            };
            const levels = thinkingEfforts(
              resolveThinkingAdapter({
                type,
                model,
                maxTokens: 32768,
                thinking: next,
              }),
            );
            if (levels.length && !levels.includes(next.effort))
              next.effort = "high";
            onChange(next);
          }}
        >
          {adaptersFor(type).map((a) => (
            <option key={a} value={a}>
              {adapterLabels[a]}
            </option>
          ))}
        </select>
      </Field>
      {efforts.length > 0 && (
        <Field
          label="思考深度"
          hint="更深通常需要更多时间和 tokens；请选择当前模型支持的等级。"
        >
          <select
            aria-label="思考深度"
            value={value.effort}
            disabled={value.mode !== "enabled"}
            onChange={(e) =>
              onChange({
                ...value,
                effort: e.target.value as ThinkingConfig["effort"],
              })
            }
          >
            {efforts.map((e) => (
              <option key={e} value={e}>
                {effortLabels[e]} · {e}
              </option>
            ))}
          </select>
        </Field>
      )}
      {budget && (
        <Field
          label="思考预算（tokens）"
          hint="该参数格式通过 token 预算控制思考量；为最终 JSON 输出另留充足空间。"
        >
          <input
            aria-label="思考预算（tokens）"
            type="number"
            min={1024}
            max={24576}
            step={1}
            required
            disabled={value.mode !== "enabled"}
            value={value.budgetTokens}
            onChange={(e) =>
              onChange({ ...value, budgetTokens: Number(e.target.value) })
            }
          />
        </Field>
      )}
      {adapter === "ollama-boolean" && (
        <p className="muted small">
          此格式提供思考开关，没有独立深度参数。支持等级的 gpt-oss 模型可选择
          Ollama 思考等级。
        </p>
      )}
      <p className="muted small">
        参数不受支持时明确报错，不会自动降级成不思考。日志记录决策摘要和上游思考标记，不展示或保存私有思维链。
      </p>
    </div>
  );
}
