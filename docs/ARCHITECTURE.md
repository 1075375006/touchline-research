# 实现与扩展

React 后台 → 同源 Express API → SQLite 持久化队列 → 研究编排器 → 普通模型 / 独立搜索 → 原文 → 摘录校验 → 报告归档。

工作进程在 API 服务中，定时取到期任务；不是浏览器计时器。适合个人/小团队单实例部署。不要多个 app 副本共用数据库，本版本用进程内并发锁，尚未实现分布式任务租约。

| 文件                 | 职责                                             |
| -------------------- | ------------------------------------------------ |
| server/domain.ts     | 阶段、38 指标、配置 Schema                       |
| server/db.ts         | 持久化、加密、会话、审计                         |
| server/network.ts    | 超时、大小、公开网络校验、DNS 固定               |
| server/models.ts     | 五协议、JSON 修复、实际请求预算钩子              |
| server/search.ts     | SearchBoost/SearXNG、原文与时间分类              |
| server/fixtures.ts   | 比赛格式统一                                     |
| server/research.ts   | 规划、审计、补搜、检查点、证据、数据、报告、队列 |
| server/app.ts        | 认证、权限、管理 API、静态页面                   |
| client/src/          | 响应式管理界面                                   |
| tests/system.test.ts | 隔离集成测试与协议桩                             |

任务保存比赛、方向、盘口、搜索和研究配置快照。provider 按引用读取：更换后台密钥后恢复任务会用新配置；要保留旧连接请另建 provider。

queued → running → completed / partial / failed；支持 pause/cancel 后恢复。每阶段保存 plan/searches/initial/audit/followups/final/evidenceIds。每次搜索或审计后持久化，未写完的单个请求可能重做。预算在请求前扣减，失败重试无法无限消耗。恢复重置单次运行计时，但累计搜索/请求次数不清零。

重开缺口阶段把旧 pass 存入 previousPasses。可读快照保留，失败来源可重读。恢复不移动冻结时间；要按新时间研究，应新建任务。

## 新协议

在 domain.ts 增加 ProviderSchema 类型，models.ts 实现请求/响应，Settings.tsx 添加表单，补充 HTTP 桩测试。模型模块不依赖厂商搜索或工具调用能力。

## API

业务 API 前缀 /api，健康检查、登录状态和初始化以外需要会话。

- GET /health, /auth/status；POST /auth/setup, /auth/login, /auth/logout, /auth/password
- GET /dashboard
- GET/POST /providers；PUT/DELETE /providers/:id；POST /providers/:id/test
- GET /settings；PUT /settings/:key；POST /search/test
- GET/POST /fixtures；PUT/DELETE /fixtures/:id；POST /fixtures/sync, /fixtures/import
- GET/POST /jobs；GET/DELETE /jobs/:id；POST /jobs/:id/{pause,cancel,resume,retry}；PATCH /jobs/:id/budget
- GET /reports；GET /reports/:jobId/export?format=md|json|script
- GET /evidence；GET /sources/:id
- GET/POST /users；PATCH /users/:id；GET /audit

研究员只改变自己的任务；资料对工作空间已登录用户可读。管理员配置的本地网关属于可信配置，抓取搜索结果始终启用公开地址保护。
