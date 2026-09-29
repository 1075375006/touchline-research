# 模型主动思考配置（1.1.5）

更新日期：2026-09-29（Asia/Shanghai）。

## 后台使用

打开“系统设置 → 分析模型 → 编辑”。默认“开启主动思考”、深度 high、参数格式自动；也可主动选择模型默认或请求关闭。按协议和模型 ID 选择格式仅是路由规则，不是能力探测。自建网关使用别名时，可手动指定参数格式。

DeepSeek/Qwen 格式直接发送原生 max_tokens，其他 Chat 兼容格式先发送 max_completion_tokens。返回额度截断时明确失败，不接收不完整的研究结论。

深度越高通常耗时和用量越多。界面提供该参数格式允许的候选等级；具体模型可能只支持其中一部分，不支持的等级需要按服务商说明调整。Claude/Gemini 预算模式的单次总输出上限至少比思考预算多 1024 tokens，为最终 JSON 留空间。Qwen 思考预算与输出上限分开传递。

## 实际请求参数

| 接口 / 格式 | 开启时发送 | 控制方法 |
| --- | --- | --- |
| OpenAI Responses | reasoning.effort | minimal / low / medium / high / xhigh / max，具体支持由模型决定 |
| OpenAI Chat 兼容 | reasoning_effort | 同上；仅对支持此参数的模型/网关有效 |
| DeepSeek Chat | thinking.type=enabled、reasoning_effort | low / high / max |
| Qwen / 百炼 Chat | enable_thinking=true、thinking_budget | token 预算 |
| Claude 自适应 | thinking.type=adaptive、output_config.effort | low / medium / high / xhigh / max，按模型支持选择 |
| Claude 预算 | thinking.type=enabled、thinking.budget_tokens | token 预算 |
| Gemini 等级 | generationConfig.thinkingConfig.thinkingLevel | MINIMAL / LOW / MEDIUM / HIGH，按模型支持选择 |
| Gemini 预算 | generationConfig.thinkingConfig.thinkingBudget | token 预算 |
| Ollama 开关 | think=true | 开启或关闭 |
| Ollama 等级 | think=low / medium / high | 适用于接受等级的模型，例如 gpt-oss |

“模型默认”不发送上述参数，不能保证上游开启思考。“请求关闭”使用对应协议的关闭参数；模型不支持关闭时仍可能拒绝。Gemini 等级模式没有统一关闭语义，配置校验会拒绝关闭，需按模型能力使用默认或预算格式。

Responses 使用流式传输，其他现有协议使用非流式响应。某些只接受流式思考输出的 Qwen 服务与当前 Chat 通道不兼容；对应适配器字段已实现并经协议桩验证，不等于所有 Qwen 服务均已实网验收。不会为了连通而静默删除思考参数。

## 主动搜索流程

1. 每个阶段根据用户方向拆解成立条件，确定支持事实与独立佐证的缺口。
2. 模型在原生思考设置下输出结构化搜索计划、简短决策依据与支持切口；Agent 执行独立网页搜索。
3. 阅读新原文后重新审查支持关系、出处与未知，决定补搜及独立核验，不机械重复关键词。
4. 后续审计、逐条引语审核、逐场指标、报告和 JSON 修复使用同一个模型思考配置。

思考不要求接入 AI 搜索模型，也不增加新的固定搜索轮数；原有阶段、预算、取消与检查点逻辑继续生效。原生思考不能保证来源真实，所有主张仍须原文和审计支持。

## 观测与保存

研究日志区分“主动思考请求”和“模型步骤完成”。完成事件显示上游返回的 reasoning token 数或原生思考标记；未提供标记时明确显示“未提供思考确认”，不从耗时猜测。只保存配置、步骤摘要、结构化决策和用量元数据，不保存或展示私有思维链。

连接测试与研究发送同样的思考参数，但短连接测试成功不等于完整研究成功。实际服务的等级、预算、限流、超时和输出截断仍可能不同。提高深度后应检查单次输出上限与超时。

## 迁移与生效

providers.thinking 是幂等新增列，原有配置、加密密钥、会话和任务不被替换。旧记录默认解析为开启/high/auto，符合此次启用主动思考的要求。模型在每次研究启动/恢复时读取；运行中修改不会混用两种配置，下一次启动/恢复生效。已完成阶段、累计查询与模型预算不自动重置，也不会因升级而重跑历史研究。

## 官方参数依据

2026-09-29 核对以下官方文档。文档中的具体模型可用性可能改变，接入时以所用服务商支持为准。

- OpenAI reasoning: https://developers.openai.com/api/docs/guides/reasoning
- Claude adaptive thinking: https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking
- Gemini thinking: https://ai.google.dev/gemini-api/docs/thinking
- Gemini generateContent / ThinkingConfig: https://ai.google.dev/api/generate-content
- DeepSeek thinking mode: https://api-docs.deepseek.com/guides/thinking_mode
- Qwen deep thinking: https://www.alibabacloud.com/help/en/model-studio/deep-thinking
- Ollama thinking: https://docs.ollama.com/capabilities/thinking
