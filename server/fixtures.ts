import { db, getSetting, setSetting } from "./db.js";
import { Fixture, FixtureSchema, now, json } from "./domain.js";
import { requestText } from "./network.js";
export const SPORTTERY =
  "https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry?channel=c&poolCode=hhad,had";
export function normalizeFixtures(payload: any): Fixture[] {
  const rows = Array.isArray(payload.matches)
    ? payload.matches
    : (
        payload.value?.matchInfoList ||
        payload.data?.value?.matchInfoList ||
        []
      ).flatMap((g: any) =>
        (g.subMatchList || []).map((r: any) => ({
          ...r,
          businessDate: r.businessDate || g.businessDate,
        })),
      );
  return rows.flatMap((r: any) => {
    try {
      const v = FixtureSchema.parse({
        home: r.homeTeamAllName || r.homeTeamAbbName,
        away: r.awayTeamAllName || r.awayTeamAbbName,
        league: r.leagueAllName || r.leagueAbbName,
        kickoff:
          r.matchDate +
          "T" +
          (r.matchTime.length === 5 ? r.matchTime + ":00" : r.matchTime) +
          "+08:00",
        sourceUrl: SPORTTERY,
      });
      if (!r.matchId) return [];
      return [
        {
          ...v,
          kickoff: new Date(v.kickoff).toISOString(),
          id: "sporttery-" + String(r.matchId),
          source: "sporttery",
          businessDate: r.businessDate || r.matchDate,
          matchNumber: r.matchNumStr || String(r.matchNum || ""),
          updatedAt: now(),
        },
      ];
    } catch {
      return [];
    }
  });
}
export function saveFixture(f: Fixture) {
  db.prepare(
    "INSERT INTO fixtures(id,data,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at",
  ).run(f.id, JSON.stringify(f), now());
}
export async function syncFixtures() {
  const config = getSetting("fixtures", { mode: "sporttery", redBlackUrl: "" });
  const upstream =
    config.mode === "redblack"
      ? new URL("/api/matches", config.redBlackUrl).href
      : SPORTTERY;
  const res = await requestText(upstream, {
    trusted: config.mode === "redblack",
    timeout: 30000,
    headers: {
      referer: "https://www.sporttery.cn/",
      "user-agent": "Mozilla/5.0 TouchlineResearch/1.0",
    },
  });
  const rows = normalizeFixtures(JSON.parse(res.text));
  if (!rows.length)
    throw new Error(
      "上游未返回可用比赛。可使用红黑记录地址或手动录入；海外服务器可能需要国内数据出口。",
    );
  rows.forEach(saveFixture);
  const result = { count: rows.length, at: now(), mode: config.mode };
  setSetting("lastSync", result);
  return result;
}
export function listFixtures(): Fixture[] {
  return db
    .prepare("SELECT data FROM fixtures ORDER BY updated_at DESC LIMIT 1000")
    .all()
    .map((r) => json<Fixture>(r.data, {} as Fixture))
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff));
}
