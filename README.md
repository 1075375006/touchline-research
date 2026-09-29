# 边线情报 · Touchline Research

一个可以自行 Docker 部署的足球赛前研究 Agent。选择比赛，填写研究方向和可选盘口，选择你的模型；后台自动拆解问题、搜索网页、读取原文、审计证据、主动补搜并生成报告。

**搜索与推理解耦。** 网页搜索默认使用 SearchBoost 的免费 Bing / DuckDuckGo / Yahoo 通道，不需要 AI 搜索服务或其 API Key。也可切换到自己部署的 SearXNG。研究规划、提取和报告仍需要普通语言模型，或者本地 Ollama。

方向是待检验假设：优先查找支持材料，同时记录最强反证、未知和失效条件。材料不足时输出受限报告，不伪造有利事实。

## Docker 启动

需要 Docker Engine、Compose v2 和 openssl。

```sh
sh scripts/deploy.sh
```

打开 http://localhost:4318 。首次页面要求从服务器的 `.env` 复制 `SETUP_TOKEN`，再创建管理员和至少 12 位密码。没有共享默认密码。脚本生成随机 APP_SECRET / SETUP_TOKEN，并构建生产镜像与持久化服务。已有 .env 不覆盖；若复制了空白 .env.example，请先填入真实值。

本次交付的本机实例已初始化时，随机凭据保存在 `.local-admin.txt`（不进入交付包）；其他服务器仍走首次初始化。

```sh
docker compose ps
docker compose logs -f --tail=100 app
docker compose restart app
docker compose down
```

down 不删除数据卷。**除非要清空全部数据，否则不要使用 down -v。**

## 使用顺序

1. **系统设置 → 分析模型**：添加协议、基础 URL、模型名和密钥，保存并测试连接。
2. **网页搜索**：默认免费引擎；使用测试框检查部署地区和网络。
3. **比赛中心**：同步列表，筛选日期/赛事，或手动录入 / JSON 导入。
4. **发起研究**：填写方向与可选准确盘口，可预约在开球前启动。
5. **研究任务**：查看阶段、搜索理由、审计、来源快照、38 项逐场指标与报告；离开浏览器后任务继续。
6. **报告档案**：阅读或导出 Markdown / 完整 JSON 证据包；满足证据门槛后生成中文口播草稿。

暂停会取消当前请求并保留检查点；重启自动恢复运行中的任务。预算耗尽生成受限报告，可以在任务详情“调整预算 / 补查”增加预算、重开有缺口的阶段，再继续研究。上一轮记录保存在证据包。已开球的比赛不能新建或恢复赛前研究。

## 模型适配

| 协议                         | Base URL 示例                                    |
| ---------------------------- | ------------------------------------------------ |
| OpenAI Chat Completions 兼容 | https://api.openai.com/v1 或兼容网关             |
| OpenAI Responses             | https://api.openai.com/v1                        |
| Anthropic Messages           | https://api.anthropic.com/v1                     |
| Gemini generateContent       | https://generativelanguage.googleapis.com/v1beta |
| Ollama                       | http://host.docker.internal:11434                |

模型名填写服务商/本地实际支持的 ID。Base URL 不要重复填写 /chat/completions 等完整端点。OpenAI 兼容通道在 HTTP 400 时尝试旧 max_tokens 参数。

“可替换模型”指这些协议和自定义模型 ID，不代表所有模型都能稳定完成同样研究。模型需要足够上下文与 JSON 能力，建议至少 4096 输出 tokens；截断时提高上限。结构校验失败修复重试一次，真实重试也计入预算。

Docker 内 localhost 是容器自己。宿主 Ollama 使用 host.docker.internal，并确保 Ollama 允许该容器访问。Compose 已添加 host-gateway；不要直接暴露 Ollama 到公网。

## 比赛列表

默认使用 Sporttery 公开接口。比赛来源可以改为已有 red-black-record 服务地址，读取其 /api/matches；同时支持 {matches:[...]} 和 Sporttery 分组格式。无需复制或修改红黑记录项目。

国内接口可能受地区、网络、上游调整影响。失败会提示并保留现有列表；手动和 JSON 导入独立可用。格式示例（不会自动导入示例数据）：

```json
[
  {
    "home": "主队",
    "away": "客队",
    "league": "赛事",
    "kickoff": "2027-01-01T20:00:00+08:00",
    "homeLocal": "当地队名",
    "awayLocal": "当地队名",
    "language": "当地语言"
  }
]
```

## 可选 SearXNG

```sh
docker compose --profile searxng up -d
```

后台改用 SearXNG，URL 填 http://searxng:8080 。config/searxng.yml 已启用 JSON 响应，不映射搜索服务公网端口。可通过 SEARXNG_IMAGE 固定已验证镜像标签/digest。

免费搜索仍可能验证码、限流、空结果或 HTML 结构变化。多引擎会保留可用结果并报告失败引擎；不承诺免费服务永久可用。

## 研究方法

- 十二阶段：核验全景、近期逐场、真实实力、经营内部稳定、战术、伤停、体能旅行、赛制动机、教练、阵容磨合、外部因素、裁判 VAR。
- 每阶段执行：带理由的规划 → 独立搜索 → 打开原文 → 初审 → 覆盖审计 → 定向追问 → 修正和入库。
- 全景寻找至少五个可证伪候选问题，选一个窄问题；优先当地语言，英文补充。
- 核验双方近期比赛身份，再选关键场次：默认总计两场、可调六场，每场分组搜索 38 指标。未知、未搜索与已核验区分，不用均值或跨提供方口径填空。
- 事实绑定来源、连续摘录、发布时间、事实/推断、方向影响、置信度与限制；未读正文、摘录不匹配或晚于冻结时间不能当有效事实。
- 冻结时间在首次实际启动确定，恢复保持原值。未确认发布时间的来源降级并提示复核；无法保证识别网页后续全部编辑。
- 报告含支持、反证、因果链、分支、失效条件、未知、复查项、逐场数据及来源。最低三条证据、两个来源域名；多个域名不自动代表独立事实。
- 口播草稿还要求三条绑定证据的因果链与反证。篇幅服从材料，段落绑定保存在完整导出中。

默认预算：120 次搜索、80 次真实模型请求、每查询最多 3 个页面、每阶段至少 1 次补搜、单次运行 90 分钟、并发 1。新任务保存配置快照；旧任务单独调预算。tokens 仅记录模型实际返回值，不估算未知用量或费用。

## 管理与安全

- 总览、比赛、任务、报告、证据库、原文快照和审计。
- 模型管理/密钥更换、连接测试、搜索测试、预算并发设置、比赛来源管理。
- 管理员 / 研究员 / 只读用户，启停账户、重置和修改密码。
- 单工作空间：所有已登录用户可阅读资料，研究员只管理自己的任务，管理员管理全部。不是多租户隔离系统。
- SQLite WAL 和 Docker 命名卷持久化；模型密钥 AES-256-GCM，密码 scrypt，httpOnly/SameSite 会话，限流和来源校验。
- 网页请求阻止私网/保留地址并固定 DNS，逐跳检查重定向。管理员配置的模型/搜索/红黑网关允许私网，便于本地服务连接。
- 读取公开 HTML/纯文本：单响应最大 2MB，保存最多 22,000 字符，送模型单页最多 6,500 字符。不执行网页 JS、不 OCR PDF、不绕过登录/验证码/付费墙。

摘录匹配不是事实真实性保证。模型的语义理解、同名球队、去重和因果解释仍需人工复核。报告是研究底稿，不接入下注、不自动发布，也不承诺收益。

## 公网部署与备份

前置 HTTPS 反向代理，设 PUBLIC_URL=https://你的域名 与 COOKIE_SECURE=true；只有一层可信代理时设 TRUST_PROXY=1。可设 BIND_ADDRESS=127.0.0.1，只允许本机代理访问。开发 HTTP 保持 COOKIE_SECURE=false。

备份前停写，复制整个 /app/data，另存 APP_SECRET。丢失密钥就无法解密已有模型配置。

```sh
docker compose stop app
backup_dir="backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
docker compose cp app:/app/data "$backup_dir/data"
docker compose start app
```

恢复同样先停服务，将保存的数据复制回挂载目录，确保 UID 1000 有写权限，保留原 APP_SECRET 后启动。不要公开提交 .env、数据库或快照。

## 开发与测试

Node.js ≥22.13。

```sh
npm ci
npm run setup
npm run dev:api
# 另开终端
npm run dev:web
```

API 默认 4318，Vite 5173 代理 /api。Docker 占用 4318 时先停止 app 容器。

```sh
npm test
npm run check
npm run build
npm start
```

测试使用临时隔离数据库和本地模型 HTTP 桩：覆盖初始化、角色、加密、SSRF、五协议、重试预算、完整十二阶段、38 指标、伪引语剔除、导出、中断和恢复。协议桩不代表真实付费模型已验证；未提供你的密钥时不会冒充完成真实模型调用。

## 参考来源

- [red-black-record](https://github.com/1075375006/red-black-record)，6d3c894：比赛接口适配。
- [search-boost](https://github.com/Mr-remon219/search-boost)，0.2.3 / 7592723：作为依赖使用免费多引擎检索，保留依赖许可证。
- [perplexity-football-research](https://github.com/1075375006/perplexity-football-research)，62d65c0：阶段审计、追问、当地语言、经营、逐场数据与反证。
- [paoge-football-copywriting](https://github.com/1075375006/paoge-football-copywriting)，6241016：全景选题、窄问题、因果链与原创口播。

参考方法和接口，独立实现应用，未复制未确认授权的项目源码。把原人工浏览器方法改造成有限预算的 API 模型与独立搜索任务，不要求使用 Perplexity 界面，也不宣称完全等同原技能。

模块与 API 见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。实际验证结果与验证边界见 [docs/VERIFICATION.md](docs/VERIFICATION.md)。
