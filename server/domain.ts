import {
  ThinkingSchema,
  thinkingValidation,
  type ThinkingConfig,
} from "./thinking.js";
import { z } from "zod";
export const STAGES = [
  {
    id: "identity",
    name: "比赛核验与全景扫描",
    focus:
      "核验赛事、双方官方名称、当地语言、日期、场地、赛制和赛前时间。广扫异常与变化，生成至少五个可证伪候选问题，再选一个窄问题。",
  },
  {
    id: "recent",
    name: "近期逐场表现",
    focus:
      "索引双方最近五场正式比赛。辨别红牌、比分状态与对手强弱。选择关键场次独立深挖，不能用总战绩代替过程。",
  },
  {
    id: "data",
    name: "关键数据与真实实力",
    focus:
      "比较同提供方、同口径的xG、机会质量、进攻区域和防守数据。稀疏单场样本不能虚构长期趋势。",
  },
  {
    id: "operations",
    name: "经营与内部稳定",
    focus:
      "分别核查两队欠薪财务、转会注册、管理层、教练和更衣室。区分O0即时硬约束、O1可验证比赛传导、O2背景；传闻不能当事实。",
  },
  {
    id: "tactics",
    name: "战术与对位",
    focus:
      "具体分析人员、区域、动作、对手回应与代价。用真实同类比赛和最强反例检验因果链。",
  },
  {
    id: "squad",
    name: "伤停与阵容",
    focus:
      "官方伤病、停赛、注册、复出和发布会，区分确认缺席、出场存疑、推测首发，给出能使方向翻转的条件。",
  },
  {
    id: "fitness",
    name: "体能、轮换与旅行",
    focus:
      "实际休息天数、比赛分钟、旅程、轮换、备战与天气，禁止捏造疲劳百分比。",
  },
  {
    id: "motivation",
    name: "积分、赛制与动机",
    focus:
      "积分和晋级条件、次回合规则、赛程优先级；动机必须有可观察约束，不能由排名直接推断必胜。",
  },
  {
    id: "coach",
    name: "教练与临场调整",
    focus: "查证教练采访原文、换人模式及逆风调整，区分引语、事实与解释。",
  },
  {
    id: "cohesion",
    name: "阵容结构与磨合",
    focus: "核查阵容更替、配合、关键球员职责与位置适配，不编造私人关系。",
  },
  {
    id: "external",
    name: "媒体与外部因素",
    focus:
      "本地报道、球迷、赛场环境与心理线索。只保留来源明确且能解释本场影响的材料。",
  },
  {
    id: "referee",
    name: "裁判与VAR",
    focus:
      "确认主裁与VAR身份、判罚口径、样本量和可能的对位影响。未公布明确记为未知。",
  },
];
export const METRICS = [
  "控球率",
  "xG",
  "对方禁区内触球",
  "绝佳机会",
  "错失绝佳机会",
  "运动战xG",
  "定位球xG",
  "NPxG",
  "xGOT/PSxG",
  "进攻区域分布",
  "射门",
  "射正",
  "射偏",
  "射门被封堵",
  "击中门框",
  "禁区内射门",
  "禁区外射门",
  "精准传球",
  "总传球",
  "我方半场传球",
  "对方半场传球",
  "精准长传",
  "精准传中",
  "掷球",
  "越位",
  "角球",
  "黄牌",
  "红牌",
  "犯规",
  "抢断",
  "拦截",
  "防守阻挡",
  "解围",
  "扑救",
  "对抗成功",
  "地面对抗成功",
  "争顶成功",
  "盘带成功",
];
export const ProviderSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    type: z.enum(["openai", "responses", "anthropic", "gemini", "ollama"]),
    baseUrl: z.string().url().max(500),
    model: z.string().trim().min(1).max(150),
    apiKey: z.string().max(2000).optional(),
    thinking: ThinkingSchema.prefault({}),
    enabled: z.boolean().default(true),
    maxTokens: z.number().int().min(512).max(32768).default(4096),
    timeoutSeconds: z.number().int().min(10).max(600).default(180),
  })
  .superRefine((p, ctx) => {
    const problem = thinkingValidation(p);
    if (problem)
      ctx.addIssue({ code: "custom", path: ["thinking"], message: problem });
  });
export const ResearchSchema = z.object({
  maxQueries: z.number().int().min(40).max(400).default(120),
  resultsPerQuery: z.number().int().min(2).max(8).default(3),
  followups: z.number().int().min(1).max(3).default(1),
  criticalMatches: z.number().int().min(1).max(6).default(2),
  concurrency: z.number().int().min(1).max(3).default(1),
  maxModelCalls: z.number().int().min(30).max(200).default(80),
  maxRunMinutes: z.number().int().min(10).max(240).default(90),
  customInstructions: z.string().max(4000).default(""),
});
export const SEARCH_API_NAMES = [
  "tavily",
  "brave",
  "exa",
  "anysearch",
] as const;
export const SEARCH_ENGINE_NAMES = [
  "bing",
  "ddg",
  "yahoo",
  "exa-free",
  "anysearch",
  "tavily",
  "brave",
  "exa",
] as const;
export const SearchBaseUrl = z
  .string()
  .url()
  .max(500)
  .refine((value) => {
    const u = new URL(value);
    return (
      ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash
    );
  }, "接口地址仅支持 HTTP(S)，不能携带用户名、密码、查询串或片段");
const searchProvider = (baseUrl: string) =>
  z
    .object({
      baseUrl: SearchBaseUrl.default(baseUrl),
      enabled: z.boolean().default(true),
      credentialId: z.string().max(80).default(""),
    })
    .prefault({});
export const SearchSchema = z.object({
  engine: z
    .enum(["searchboost", "searchboost-api", "searxng"])
    .default("searchboost"),
  searxngUrl: z.string().max(500).default("http://searxng:8080"),
  engines: z
    .array(z.enum(["bing", "ddg", "yahoo", "exa-free", "anysearch"]))
    .min(1)
    .default(["bing", "ddg", "yahoo", "exa-free", "anysearch"]),
  excludeDomains: z.array(z.string().max(200)).max(100).default([]),
  trustedDomains: z
    .array(z.string().max(200))
    .max(100)
    .default([
      "uefa.com",
      "fifa.com",
      "premierleague.com",
      "bundesliga.com",
      "laliga.com",
      "bbc.com",
      "reuters.com",
    ]),
  timeoutSeconds: z.number().int().min(10).max(120).default(25),
  enginePool: z.enum(["free", "api", "hybrid"]).default("free"),
  ranking: z.enum(["balanced", "research", "fresh"]).default("balanced"),
  complexity: z.enum(["simple", "medium", "complex"]).default("simple"),
  maxResults: z.number().int().min(1).max(20).default(8),
  recency: z.enum(["", "day", "week", "month", "year"]).default(""),
  includeDomains: z.array(z.string().max(200)).max(100).default([]),
  engineWeights: z
    .partialRecord(z.enum(SEARCH_ENGINE_NAMES), z.number().min(0).max(100))
    .default({}),
  minScore: z.number().min(0).max(100).default(0),
  depth: z.enum(["", "basic", "advanced"]).default(""),
  community: z.boolean().default(false),
  reader: z.enum(["direct", "searchboost"]).default("direct"),
  strategy: z.enum(["fused", "adaptive"]).default("fused"),
  apiProviders: z
    .object({
      tavily: searchProvider("https://api.tavily.com"),
      brave: searchProvider("https://api.search.brave.com/res/v1"),
      exa: searchProvider("https://api.exa.ai"),
      anysearch: searchProvider("https://api.anysearch.com/v1"),
    })
    .prefault({}),
  jev: z
    .object({
      baseUrl: SearchBaseUrl.default("https://api.typesafe.ai/v1"),
      credentialId: z.string().max(80).default(""),
      enabled: z.boolean().default(false),
      timeoutSeconds: z.number().int().min(30).max(600).default(180),
      intent: z
        .string()
        .max(2000)
        .default(
          "优先寻找可核验的足球赛前原始资料，同时保留反证和不确定信息。",
        ),
      keywords: z.array(z.string().min(1).max(100)).max(8).default([]),
      constraints: z.array(z.string().min(1).max(300)).max(8).default([]),
    })
    .prefault({}),
  x: z.object({ credentialId: z.string().max(80).default("") }).prefault({}),
  tools: z
    .object({
      fused_search: z.boolean().default(true),
      fetch_page: z.boolean().default(true),
      x_search: z.boolean().default(true),
      adaptive_search: z.boolean().default(true),
    })
    .prefault({}),
});
export const FixtureSchema = z.object({
  home: z.string().trim().min(1).max(120),
  away: z.string().trim().min(1).max(120),
  league: z.string().trim().min(1).max(120),
  kickoff: z.string().datetime({ offset: true }),
  homeLocal: z.string().max(120).default(""),
  awayLocal: z.string().max(120).default(""),
  language: z.string().max(50).default(""),
  sourceUrl: z.union([z.string().url().max(2000), z.literal("")]).default(""),
});
export type Provider = Omit<z.infer<typeof ProviderSchema>, "thinking"> & {
  thinking?: ThinkingConfig;
  id: string;
  secret: string;
};
export type ResearchConfig = z.infer<typeof ResearchSchema>;
export type SearchConfig = z.infer<typeof SearchSchema>;
export type Fixture = z.infer<typeof FixtureSchema> & {
  id: string;
  source: string;
  businessDate?: string;
  matchNumber?: string;
  updatedAt: string;
};
export type Evidence = {
  directionReason?: string;
  id: string;
  stage: string;
  claim: string;
  quote: string;
  sourceId: string;
  effect: "supports" | "opposes" | "neutral" | "unknown";
  kind: "fact" | "inference";
  confidence: "high" | "medium" | "low";
  limitation: string;
};
export type Source = {
  id: string;
  url: string;
  title: string;
  domain: string;
  text: string;
  snippet: string;
  published: string | null;
  publishedBasis?: string;
  fetchedAt: string;
  status: "read" | "snippet" | "failed" | "after_cutoff";
  engine: string;
  tier: "official_or_trusted" | "unclassified";
  error?: string;
  reader?: string;
};
export function json<T>(raw: unknown, fallback: T): T {
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}
export const now = () => new Date().toISOString();
export const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : String(e);
