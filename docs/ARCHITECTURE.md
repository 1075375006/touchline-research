# 实现与扩展

React 后台 → 同源 Express API → SQLite 持久化队列 → 研究编排器 → 普通模型 / 独立搜索 → 原文 → 摘录校验 → 报告归档。

工作进程在 API 服务中，定时取到期任务；不是浏览器计时器。适合个人/小团队单实例部署。不要多个 app 副本共用数据库，本版本用进程内并发锁，尚未实现分布式任务租约。

| 文件                                         | 职责                                             |
| -------------------------------------------- | ------------------------------------------------ |
| server/direction.ts                          | 全阶段方向策略、查询约束、优先级与旧检查点迁移   |
| server/domain.ts                             | 阶段、38 指标、配置 Schema                       |
| server/db.ts                                 | 持久化、加密、会话、审计                         |
| server/network.ts                            | 超时、大小、公开网络校验、DNS 固定               |
| server/models.ts                             | 五协议、JSON 修复、实际请求预算钩子              |
| server/search.ts                             | SearchBoost/SearXNG、原文与时间分类              |
| server/search-config.ts                      | 搜索凭据版本、加密存储和公开配置脱敏             |
| server/search-runtime.ts / search-worker.mjs | 配置隔离 Worker、超时取消和原生工具适配          |
| server/fixtures.ts                           | 比赛格式统一                                     |
| server/research.ts                           | 规划、审计、补搜、检查点、证据、数据、报告、队列 |
| server/app.ts                                | 认证、权限、管理 API、静态页面                   |
| client/src/                                  | 响应式管理界面                                   |
| tests/system.test.ts                         | 隔离集成测试与协议桩                             |

任务保存比赛、方向、盘口、搜索和研究配置快照；搜索凭据使用不可变版本引用，旧任务默认恢复不读取新搜索密钥；已停止任务可显式更新为当前保存的搜索配置，并记录操作事件。provider 按引用读取：更换后台密钥后恢复任务会用新配置；要保留旧连接请另建 provider。

queued → running → completed / partial / failed；支持 pause/cancel 后恢复。每阶段保存 plan/searches/initial/audit/followups/final/claimAudit/evidenceIds。每次搜索或审计后持久化，未写完的单个请求可能重做。预算在请求前扣减，失败重试无法无限消耗。恢复重置单次运行计时，但累计搜索/请求次数不清零。异常空搜索标为 retryable，暂停后续模型流程；正常零结果仍可完成。恢复逐场数据读取使用同查询最后一次成功结果。

重开缺口阶段把旧 pass 存入 previousPasses。可读快照保留，失败来源可重读。恢复不移动冻结时间；要按新时间研究，应新建任务。

## 1.1.4 方向取证

server/direction.ts 集中定义十二阶段支持切口及查询结构。模型 system 与每轮 user 指令均携带方向策略；搜索 intent 携带实际方向、阶段目标和本次支持切口。运行时校验每阶段至少一条 support 与一条 corroboration，并按 support → corroboration → verification 稳定排序。补搜至少包含 support/corroboration，避免只有一个补搜名额时默认搜索反方。逐场数据仍保留完整样本及中性、不利数据。

证据新增可选 directionReason，旧记录可直接读取；来源与连续引语及逐条语义审核保持。未完成的旧阶段将旧计划/初审/审计/复核存入 previousDirectionPasses，再按新版规划，保留搜索、来源、逐场数据和累计预算；已闭合阶段不会自动重跑。新阶段记录 directionPolicyVersion=1。报告以支持材料和独立佐证组织，文案不再要求必须存在反方证据。详见 [DIRECTION-RESEARCH.md](DIRECTION-RESEARCH.md)。

## 1.1.5 原生主动思考

server/thinking.ts 统一思考 Schema、协议适配、预算校验和脱敏观测，前端 ThinkingControls.tsx 共享相同选项。providers 新增 thinking JSON 列；幂等迁移保留密钥及已有记录，旧空配置解析为 enabled/high/auto。运行开始读取一次 provider，全部阶段、补搜、报告、重试和 JSON 修复沿用该配置；运行中的设置变更在下次启动/恢复生效。

models.ts 为五类协议填入原生参数，不通过提示词冒充原生思考。research.ts 同时在每轮要求检查材料缺口、选择下一次有信息价值的搜索并依据新资料修正。model_start / model_done 只记录配置、步骤摘要与上游用量/标记，不保存原生思维链。旧事件可继续阅读。连接测试走同一个 completeJson 调用链。

参数不兼容时返回明确错误，不自动切换为关闭思考。具体参数及能力边界见 [MODEL-THINKING.md](MODEL-THINKING.md)。

## 新协议

在 domain.ts 增加 ProviderSchema 类型，models.ts 实现请求/响应，Settings.tsx 添加表单，补充 HTTP 桩测试。模型模块不依赖厂商搜索或工具调用能力。

## API

业务 API 前缀 /api，健康检查、登录状态和初始化以外需要会话。

- GET /health, /auth/status；POST /auth/setup, /auth/login, /auth/logout, /auth/password
- GET /dashboard
- GET/POST /providers；PUT/DELETE /providers/:id；POST /providers/:id/test
- GET /settings；PUT /settings/:key；POST /search/test, /search/tools
- GET/POST /fixtures；PUT/DELETE /fixtures/:id；POST /fixtures/sync, /fixtures/import
- GET/POST /jobs；GET/DELETE /jobs/:id；POST /jobs/:id/{pause,cancel,resume,retry}；PATCH /jobs/:id/budget
- GET /reports；GET /reports/:jobId/export?format=md|json|script
- GET /evidence；GET /sources/:id
- GET/POST /users；PATCH /users/:id；GET /audit

研究员只改变自己的任务；资料对工作空间已登录用户可读。管理员配置的本地网关属于可信配置，抓取搜索结果始终启用公开地址保护。

搜索扩展、Jev 协议、计费边界和临时凭据处理见 [SEARCHBOOST.md](SEARCHBOOST.md)。

## 1.1.1 恢复和证据约束

模型请求附 JSON Schema；格式修复只发送上一次输出和字段错误。网络失败最多重试一次，每次实际请求检查预算和取消信号。各阶段最终候选还需逐条支持审核，来源绑定不符、漏审、重复决策、不支持或不确定均不能入库；这一层属于模型语义审核，不能代替人工事实核验。

未完成的旧版审核恢复时，初审/审计/修正结果移入 previousReviews，来源与搜索检查点保留。原始失败日志保留；失败阶段状态纠正为 failed。

server/publication.ts 提取文章发布元数据和时区，记录 publishedBasis；时间资格由服务器统一计算后传给模型。缺少足够日期/时区信息保留 unknown。冻结时间不可通过恢复或更新搜索配置移动。
