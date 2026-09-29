import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { STAGES } from "../server/domain.js";
import {
  DIRECTION_POLICY_VERSION,
  DirectionPlanQueriesSchema,
  DirectionFollowupQueriesSchema,
  STAGE_SUPPORT_GOALS,
  prioritizeDirectionQueries,
  upgradeDirectionCheckpoint,
} from "../server/direction.js";
const support = {
  query: "Alpha Beta 2026 defensive record",
  reason: "核对主队防守条件",
  purpose: "support",
  supportAngle: "稳定的防守可能支持主队不败，尚待原文确认",
};
const corroboration = {
  query: "Alpha Beta 2026 official match report",
  reason: "查找独立比赛报告",
  purpose: "corroboration",
  supportAngle: "用不同原始来源验证防守稳定性，不能重复计算转载",
};
const verification = {
  query: "Alpha Beta 2026 injury correction",
  reason: "核验原始材料的冲突",
  purpose: "verification",
  supportAngle: "确认支持理由所需的主力是否能出场",
};

test("direction-oriented research contract", async (t) => {
  await t.test("every stage has a concrete support objective", () => {
    assert.equal(STAGES.length, 12);
    for (const stage of STAGES) {
      assert(STAGE_SUPPORT_GOALS[stage.id]?.length > 25, stage.id);
      assert.match(STAGE_SUPPORT_GOALS[stage.id], /支持|方向/);
    }
  });
  await t.test(
    "plans require both support and independent corroboration, without duplicate queries",
    () => {
      assert(
        DirectionPlanQueriesSchema.safeParse([support, corroboration]).success,
      );
      assert(
        !DirectionPlanQueriesSchema.safeParse([support, verification]).success,
      );
      assert(
        !DirectionPlanQueriesSchema.safeParse([
          verification,
          { ...verification, query: "Alpha Beta other issue" },
        ]).success,
      );
      assert(
        !DirectionPlanQueriesSchema.safeParse([
          support,
          { ...corroboration, query: support.query },
        ]).success,
      );
      assert(
        !DirectionPlanQueriesSchema.safeParse([
          { ...support, supportAngle: "" },
          corroboration,
        ]).success,
      );
      const schema = z.toJSONSchema(DirectionPlanQueriesSchema, {
        io: "input",
        unrepresentable: "any",
      });
      assert(JSON.stringify(schema).includes("supportAngle"));
    },
  );
  await t.test(
    "one follow-up slot prioritizes support or corroboration, never all counterchecks",
    () => {
      assert(!DirectionFollowupQueriesSchema.safeParse([verification]).success);
      const queries = DirectionFollowupQueriesSchema.parse([
        verification,
        corroboration,
      ]);
      assert.equal(
        prioritizeDirectionQueries(queries).slice(0, 1)[0].purpose,
        "corroboration",
      );
      const input = [verification, corroboration, support];
      assert.deepEqual(
        prioritizeDirectionQueries(input).map((q) => q.purpose),
        ["support", "corroboration", "verification"],
      );
      assert.equal(input[0], verification);
    },
  );
  await t.test(
    "unfinished legacy passes are archived once while preserving sources, searches and packs",
    () => {
      const plan = {
        queries: [
          { query: "legacy counterexample", reason: "previous purpose" },
        ],
      };
      const data: any = {
        plan,
        initial: { claims: [] },
        audit: { followups: [] },
        final: { claims: [] },
        claimAudit: { decisions: [] },
        followups: [{ done: true }],
        sourceIds: ["source-1"],
        searches: [{ query: "existing", done: true }],
        packs: [{ match: "existing match" }],
      };
      assert(upgradeDirectionCheckpoint(data));
      assert.equal(data.directionPolicyVersion, DIRECTION_POLICY_VERSION);
      assert.equal(data.previousDirectionPasses[0].plan, plan);
      assert.equal(data.plan, undefined);
      assert.equal(data.audit, undefined);
      assert.equal(data.final, undefined);
      assert.deepEqual(data.sourceIds, ["source-1"]);
      assert.equal(data.searches[0].done, true);
      assert.equal(data.packs.length, 1);
      assert(!upgradeDirectionCheckpoint(data));
      assert.equal(data.previousDirectionPasses.length, 1);
    },
  );
});
