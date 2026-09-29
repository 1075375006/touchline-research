import { z } from "zod";

export const DIRECTION_POLICY_VERSION = 1;
export const DIRECTION_POLICY =
  "研究主线：用户给定的方向是本次取证目标。每一个阶段都先拆解该方向在本阶段成立需要的可核实条件，主动搜索支持这些条件的事实，再寻找独立来源或不同类型数据的佐证。不能只在报告末尾才讨论用户方向，也不能把阶段变成与方向无关的资料汇总。先搜支持线索，再补独立佐证；发现的真实反证用于校验支持理由、标注适用条件和风险。搜索目标不等于既定结论：不得把希望找到的事实当作已知，不改写不利数据，不将同稿转载算作独立佐证；找不到支持时明确记录本阶段支持证据不足。";

export const DIRECTION_QUERY_CONTRACT =
  "每条查询返回 {query,reason,purpose,supportAngle}。purpose 只能为 support（寻找支持方向的事实）、corroboration（以独立来源或不同数据佐证支持线索）、verification（核对身份、时效、冲突或必要条件）。supportAngle 明确本条要查的事实为什么可能支持用户方向，或要核验哪条支持理由；它是待查目标，不是已经证实的事实。query 用队名、日期和具体事实关键词组成，避免直接搜索‘证明我的观点正确’等口号。reason 说明选择该来源或事实的依据。";

export const DirectionQuerySchema = z.object({
  query: z.string().min(4).max(300),
  reason: z.string().min(1).max(2000),
  purpose: z.enum(["support", "corroboration", "verification"]),
  supportAngle: z.string().min(4).max(1000),
});
export type DirectionQuery = z.infer<typeof DirectionQuerySchema>;
export const DirectionPlanQueriesSchema = z
  .array(DirectionQuerySchema)
  .min(2)
  .max(5)
  .refine(
    (queries) =>
      queries.some((q) => q.purpose === "support") &&
      queries.some((q) => q.purpose === "corroboration"),
    "每阶段计划必须包含寻找支持证据和独立佐证两类查询",
  )
  .refine(
    (queries) =>
      new Set(queries.map((q) => q.query.trim().toLowerCase())).size ===
      queries.length,
    "查询不能重复，独立佐证必须另拟具体查询",
  );
export const DirectionFollowupQueriesSchema = z
  .array(DirectionQuerySchema)
  .min(1)
  .max(3)
  .refine(
    (queries) =>
      queries.some(
        (q) => q.purpose === "support" || q.purpose === "corroboration",
      ),
    "补搜至少包含一条寻找支持事实或独立佐证的查询，不能全部变成反方核查",
  );
export const purposeLabel = {
  support: "寻找支持证据",
  corroboration: "补充独立佐证",
  verification: "核验支持条件",
};
export function prioritizeDirectionQueries<T extends { purpose?: string }>(
  queries: T[],
): T[] {
  const rank = (purpose?: string) =>
    purpose === "support" ? 0 : purpose === "corroboration" ? 1 : 2;
  return queries
    .map((query, index) => ({ query, index }))
    .sort(
      (a, b) =>
        rank(a.query.purpose) - rank(b.query.purpose) || a.index - b.index,
    )
    .map(({ query }) => query);
}

export const STAGE_SUPPORT_GOALS: Record<string, string> = {
  identity:
    "先核对比赛身份，再围绕用户方向找至少五个不同领域的支持切口，选最值得继续取证的一条；候选题必须解释其与用户方向的关系。",
  recent:
    "从两队最近五场完整比赛索引中寻找可支持用户方向的重复表现、比分过程和对手条件，以逐场报告与比赛数据交叉佐证；不得只挑有利比赛而隐藏完整样本。",
  data: "查找可能支持用户方向的机会质量、进攻效率、防守稳定性与同类对手表现，以同提供方、同口径数据佐证，说明样本与本场的关联。",
  operations:
    "寻找财务、注册、转会、管理层和内部稳定性中可能有利于用户方向的可观察变化，查明其如何传导到本场人员或表现，优先原始公告与独立报道。",
  tactics:
    "寻找能支持用户方向的区域、人员、动作和对位机制，用具体比赛案例与数据佐证优势如何形成，以及对手采取回应后是否仍然成立。",
  squad:
    "寻找有利于用户方向的已确认伤停、复出、停赛、注册与可用阵容变化，以官方名单、发布会和独立报道佐证；不将预测首发当作事实。",
  fitness:
    "寻找可能支持用户方向的休息间隔、连续上场分钟、旅行和轮换条件，用实际赛程、出场记录及官方备战信息佐证。",
  motivation:
    "寻找可能支持用户方向的积分与晋级约束、赛程优先级及球队公开安排，以规则、积分和发言佐证，不能从‘需要赢’直接推导‘一定赢’。",
  coach:
    "寻找可能支持用户方向的教练部署、针对性准备与调整能力，用采访原文和可观察的临场案例佐证。",
  cohesion:
    "寻找可能支持用户方向的阵容连续性、职责清晰度和配合模式，用首发、分钟、位置和比赛过程佐证，不编造私人关系。",
  external:
    "寻找可能支持用户方向的场地、环境及有明确比赛影响的外部因素，以本地原始报道和独立来源佐证；不把舆论或传闻直接写成实力依据。",
  referee:
    "在确认裁判身份后寻找可能支持用户方向的判罚特点与球队对位关系，用有定义和样本量的数据佐证；未公布或样本不足则标注无法支持。",
};

/** Re-plan only an unfinished legacy stage; keep searches, sources and match packs. */
export function upgradeDirectionCheckpoint(data: any): boolean {
  if (data.directionPolicyVersion === DIRECTION_POLICY_VERSION) return false;
  const keys = ["plan", "initial", "audit", "final", "claimAudit", "followups"];
  const prior = Object.fromEntries(
    keys
      .filter((key) => data[key] !== undefined)
      .map((key) => [key, data[key]]),
  );
  if (Object.keys(prior).length) {
    data.previousDirectionPasses ||= [];
    data.previousDirectionPasses.push({
      ...prior,
      reason: "改为各阶段优先搜索支持方向的事实与独立佐证",
      archivedAt: new Date().toISOString(),
    });
    for (const key of keys) delete data[key];
  }
  data.directionPolicyVersion = DIRECTION_POLICY_VERSION;
  return Object.keys(prior).length > 0;
}
