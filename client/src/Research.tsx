import { useState } from "react";
import {
  Link,
  useParams,
  useSearchParams,
  useNavigate,
} from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  Globe2,
  ListFilter,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Square,
  Target,
  Trash2,
} from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { STAGES } from "../../server/domain";
import {
  api,
  body,
  useLoad,
  useToast,
  useAuth,
  PageHead,
  Badge,
  Loading,
  ErrorBox,
  Empty,
  fmt,
  fullDate,
  Modal,
  Field,
  Submit,
} from "./lib";
const effectNames: Record<string, string> = {
  supports: "支持方向",
  opposes: "反对方向",
  neutral: "中性事实",
  unknown: "尚不确定",
};
export function Jobs() {
  const { data, loading, error, reload } = useLoad<any[]>("/jobs", 4000),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState("");
  const items = (data || []).filter(
    (j) =>
      (filter === "all" || j.status === filter) &&
      (!query ||
        (j.fixture.home + j.fixture.away + j.direction)
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  return (
    <>
      <PageHead
        eyebrow="RESEARCH OPERATIONS"
        title="研究任务"
        description="每个阶段都有记录。离开页面后，Agent 仍在后台继续工作。"
        actions={
          <Link to="/matches" className="btn primary">
            <Plus size={16} />
            新建研究
          </Link>
        }
      />
      <div className="filter-bar">
        <div className="search-input">
          <Search size={17} />
          <input
            aria-label="搜索研究任务"
            placeholder="搜索球队或研究方向…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          aria-label="筛选任务状态"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">全部状态</option>
          {[
            "queued",
            "running",
            "paused",
            "completed",
            "partial",
            "failed",
            "cancelled",
          ].map((s) => (
            <option key={s} value={s}>
              {
                (
                  {
                    queued: "排队中",
                    running: "研究中",
                    paused: "已暂停",
                    completed: "已完成",
                    partial: "研究受限",
                    failed: "失败",
                    cancelled: "已取消",
                  } as any
                )[s]
              }
            </option>
          ))}
        </select>
        <span className="filter-count">{items.length} 个任务</span>
        <button className="icon-btn" aria-label="刷新任务" onClick={reload}>
          <RefreshCw size={17} />
        </button>
      </div>
      <section className="panel">
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox message={error} retry={reload} />
        ) : !items.length ? (
          <Empty
            title="还没有研究任务"
            detail="选定一场比赛并写下你的判断，Agent 将拆解问题并开始搜索。"
            action={
              <Link to="/matches" className="btn">
                前往比赛中心 <ArrowRight size={15} />
              </Link>
            }
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>比赛 / 研究方向</th>
                  <th>状态</th>
                  <th>当前进度</th>
                  <th>分析模型</th>
                  <th>创建时间</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((j) => (
                  <tr key={j.id}>
                    <td>
                      <Link className="table-title" to={"/jobs/" + j.id}>
                        {j.fixture.home} vs {j.fixture.away}
                      </Link>
                      <p className="table-sub">{j.direction}</p>
                    </td>
                    <td>
                      <Badge status={j.status} />
                    </td>
                    <td>
                      <div className="task-progress">
                        <span>
                          {j.status === "completed"
                            ? "研究结束"
                            : STAGES[j.stage_index]?.name || "等待启动"}
                        </span>
                        <div className="progress">
                          <i
                            style={{
                              width:
                                (j.status === "completed"
                                  ? 100
                                  : (j.stage_index / STAGES.length) * 100) +
                                "%",
                            }}
                          />
                        </div>
                      </div>
                    </td>
                    <td>
                      {j.provider_name}
                      <small className="block muted">{j.queries} 次搜索</small>
                    </td>
                    <td className="muted nowrap">{fmt(j.created_at)}</td>
                    <td>
                      <Link
                        className="icon-btn"
                        aria-label="查看任务"
                        to={"/jobs/" + j.id}
                      >
                        <ArrowUpRight size={18} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
function EvidenceCard({ e, s }: { e: any; s: any }) {
  return (
    <article className="evidence-card">
      <div className="evidence-top">
        <span className={"evidence-effect " + e.effect}>
          {effectNames[e.effect]}
        </span>
        <span className="muted">
          {e.kind === "fact" ? "事实" : "推断"} ·{" "}
          {({ high: "高", medium: "中", low: "低" } as any)[e.confidence]}置信度
        </span>
      </div>
      <h3>{e.claim}</h3>
      <blockquote>{e.quote}</blockquote>
      {e.directionReason && (
        <p className="muted">与用户方向的关系：{e.directionReason}</p>
      )}
      {e.limitation && <p className="evidence-limitation">{e.limitation}</p>}
      <div className="evidence-source">
        <span>
          <Globe2 size={14} />
          {s?.domain || "来源"}{" "}
          <span className="muted">
            · {s?.published ? fmt(s.published) : "发布时间未确认"}
          </span>
        </span>
        {s && (
          <a href={s.url} target="_blank" rel="noreferrer">
            查看原文 <ExternalLink size={13} />
          </a>
        )}
      </div>
    </article>
  );
}
export function JobDetail() {
  const { id } = useParams(),
    [search, setSearch] = useSearchParams();
  const tab = search.get("tab") || "progress";
  const { data: j, loading, error, reload } = useLoad("/jobs/" + id, 3000);
  const [busy, setBusy] = useState(""),
    [effect, setEffect] = useState("all"),
    [confirm, setConfirm] = useState(""),
    [source, setSource] = useState<any>(null),
    [budget, setBudget] = useState(false);
  const toast = useToast(),
    user = useAuth(),
    navigate = useNavigate();
  const canWrite =
    j &&
    (user.role === "admin" ||
      (user.role === "researcher" && j.created_by === user.id));
  async function act(action: string) {
    setBusy(action);
    try {
      if (action === "delete") {
        await api("/jobs/" + id, { method: "DELETE" });
        toast("任务及其资料已删除");
        navigate("/jobs");
        return;
      }
      await api("/jobs/" + id + "/" + action, body({}));
      toast(
        action === "refresh-search"
          ? "搜索配置已更新，已保存的资料和冻结时间保留"
          : "任务状态已更新",
      );
      await reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy("");
      setConfirm("");
    }
  }
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} retry={reload} />;
  const kickedOff = Date.parse(j.fixture.kickoff) <= Date.now();
  const searchEngines =
    j.search_config.engine === "searxng"
      ? "SearXNG"
      : [
          ...(["free", "hybrid"].includes(j.search_config.enginePool)
            ? j.search_config.engines
            : []),
          ...(["api", "hybrid"].includes(j.search_config.enginePool)
            ? Object.entries(j.search_config.apiProviders || {})
                .filter(([, p]: any) => p.enabled && p.hasKey)
                .map(([name]) => name + " API")
            : []),
        ].join(" / ") || "无可用引擎";
  const closed = j.stages.filter((s: any) => s.status === "closed").length,
    progress = Math.round((closed / STAGES.length) * 100);
  const evidence = j.evidence.filter(
    (e: any) => effect === "all" || effect === e.effect,
  );
  return (
    <>
      <Link className="back-link" to="/jobs">
        <ArrowLeft size={15} />
        全部研究任务
      </Link>
      <PageHead
        title={j.fixture.home + " vs " + j.fixture.away}
        description={
          j.fixture.league +
          " · " +
          fullDate(j.fixture.kickoff) +
          " · " +
          j.provider_name
        }
        actions={
          canWrite ? (
            <>
              {["running", "queued"].includes(j.status) && (
                <button
                  className="btn"
                  disabled={!!busy}
                  onClick={() => act("pause")}
                >
                  <Pause size={16} />
                  暂停
                </button>
              )}
              {["paused", "failed", "cancelled", "partial"].includes(
                j.status,
              ) && (
                <button
                  className="btn primary"
                  disabled={!!busy || kickedOff}
                  title={
                    kickedOff
                      ? "比赛已经开球，不能继续赛前研究"
                      : "从检查点继续研究"
                  }
                  onClick={() => act("resume")}
                >
                  <Play size={16} />
                  继续研究
                </button>
              )}
              {["paused", "failed", "cancelled", "partial"].includes(
                j.status,
              ) && (
                <button className="btn" onClick={() => setBudget(true)}>
                  调整预算 / 补查
                </button>
              )}
              {["running", "queued", "paused"].includes(j.status) && (
                <button
                  className="btn danger-ghost"
                  disabled={!!busy}
                  onClick={() => setConfirm("cancel")}
                >
                  <Square size={14} />
                  取消任务
                </button>
              )}
              {["failed", "cancelled", "completed", "partial"].includes(
                j.status,
              ) && (
                <button
                  className="btn danger-ghost"
                  onClick={() => setConfirm("delete")}
                >
                  <Trash2 size={15} />
                  删除
                </button>
              )}
            </>
          ) : null
        }
      />
      <div className="direction-banner">
        <Target size={20} />
        <div>
          <small>用户研究方向</small>
          <strong>{j.direction}</strong>
        </div>
        <div className="direction-line">{j.line || "未指定精确盘口"}</div>
        <Badge status={j.status} />
      </div>
      {j.error && <ErrorBox message={j.error} />}
      <section className="panel task-search-status">
        <div>
          <strong>本任务搜索引擎：{searchEngines}</strong>
          <p className="muted">
            研究主线：各阶段优先寻找支持用户方向的证据，再补充独立佐证；真实矛盾与证据缺口如实记录。
          </p>
          {j.stages.some(
            (s: any) => s.status === "closed" && !s.data.directionPolicyVersion,
          ) && (
            <p className="muted">
              此任务包含旧版已完成阶段，原结果已保留；新建任务和重新打开的阶段采用上述取证规则。
            </p>
          )}
          <p className="muted">
            {j.searchConfigChanged
              ? "本任务仍使用创建时的配置，与当前保存的系统设置不同。更新后失败查询可重试。"
              : "任务使用保存的搜索配置；查询与原文均保留检查点。"}
          </p>
          {kickedOff &&
            ["paused", "failed", "cancelled", "partial"].includes(j.status) && (
              <p className="muted">
                本场已于 {fullDate(j.fixture.kickoff)}{" "}
                开球，赛前任务不能继续；已有资料保留供复盘。
              </p>
            )}
        </div>
        {canWrite &&
          j.searchConfigChanged &&
          ["paused", "failed", "cancelled", "partial"].includes(j.status) && (
            <button
              className="btn"
              disabled={!!busy}
              onClick={() => act("refresh-search")}
            >
              更新搜索配置
            </button>
          )}
      </section>
      <div className="job-stats">
        <div>
          <small>已审计阶段</small>
          <strong>
            {closed}
            <span> / {STAGES.length}</span>
          </strong>
        </div>
        <div>
          <small>已搜索</small>
          <strong>
            {j.queries}
            <span> / {j.config.maxQueries}</span>
          </strong>
        </div>
        <div>
          <small>原文证据</small>
          <strong>
            {j.evidence.length}
            <span> 条</span>
          </strong>
        </div>
        <div>
          <small>模型调用</small>
          <strong>
            {j.model_calls}
            <span> / {j.config.maxModelCalls}</span>
          </strong>
        </div>
        <div>
          <small>报告的用量记录</small>
          <strong>
            {j.tokens.toLocaleString()}
            <span> tokens</span>
          </strong>
        </div>
      </div>
      <div className="tabs page-tabs">
        {[
          { id: "progress", label: "研究进度", icon: WaypointsIcon },
          { id: "evidence", label: "证据与来源", icon: BookOpen },
          { id: "data", label: "逐场数据", icon: ListFilter },
          { id: "report", label: "研究报告", icon: FileText },
        ].map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "active" : ""}
            onClick={() => setSearch({ tab: t.id })}
          >
            <t.icon size={16} />
            {t.label}
            {t.id === "evidence" && <span>{j.evidence.length}</span>}
          </button>
        ))}
      </div>
      {tab === "progress" && (
        <div className="research-grid">
          <section className="panel stages-panel">
            <div className="panel-heading">
              <h2>研究阶段</h2>
              <span>{progress}%</span>
            </div>
            <div className="progress large">
              <i style={{ width: progress + "%" }} />
            </div>
            <div className="stage-list">
              {STAGES.map((s, i) => {
                const state = j.stages.find((x: any) => x.stage_id === s.id);
                return (
                  <div className={"stage-row " + state?.status} key={s.id}>
                    <span className="stage-number">
                      {state?.status === "closed" ? (
                        <Check size={15} />
                      ) : state?.status === "running" &&
                        j.status === "running" ? (
                        <LoaderCircle size={15} className="spin" />
                      ) : (
                        String(i + 1).padStart(2, "0")
                      )}
                    </span>
                    <div>
                      <strong>{s.name}</strong>
                      <small>
                        {state?.status === "closed"
                          ? String(state.data.evidenceIds?.length || 0) +
                            " 条证据 · " +
                            String(state.data.gaps?.length || 0) +
                            " 个缺口"
                          : ["running", "failed", "paused", "limited"].includes(
                                state?.status,
                              )
                            ? (state?.status === "failed"
                                ? "阶段中断"
                                : state?.status === "limited"
                                  ? "预算受限"
                                  : state?.status === "paused"
                                    ? "已暂停"
                                    : "当前阶段") + " · 已保存检查点"
                            : "等待研究"}
                      </small>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
          <section className="panel event-panel">
            <div className="panel-heading">
              <h2>行动日志</h2>
              <span className="live-label">
                <i />每 3 秒更新
              </span>
            </div>
            <div className="run-info">
              <span>信息冻结时间</span>
              <strong>{fullDate(j.cutoff)}</strong>
            </div>
            {j.events.length ? (
              <div className="event-list">
                {[...j.events].reverse().map((e: any) => (
                  <div className={"event-item " + e.type} key={e.id}>
                    <span className="event-dot" />
                    <div>
                      <div className="event-meta">
                        <span>
                          {(
                            {
                              search: "网页搜索",
                              search_done: "读取来源",
                              model_start: "主动思考请求",
                              model_done: "模型步骤完成",
                              search_warning: "搜索限制",
                              audit: "覆盖审计",
                              stage_started: "阶段开始",
                              stage_closed: "阶段结束",
                              evidence_rejected: "证据剔除",
                              failed: "运行失败",
                              budget: "预算限制",
                              report_saved: "报告已存",
                            } as any
                          )[e.type] || "任务记录"}
                        </span>
                        <time>{fmt(e.created_at)}</time>
                      </div>
                      <p>{e.message}</p>
                      {e.data?.step && <small>{e.data.step}</small>}
                      {typeof e.data?.thinking?.reasoningTokens ===
                        "number" && (
                        <small>
                          上游思考用量：{e.data.thinking.reasoningTokens} tokens
                        </small>
                      )}
                      {e.data?.reason && <small>{e.data.reason}</small>}
                      {e.data?.supportAngle && (
                        <small>
                          {(
                            {
                              support: "寻找支持证据",
                              corroboration: "补充独立佐证",
                              verification: "核验支持条件",
                            } as Record<string, string>
                          )[e.data.purpose] || "支持取证切口"}
                          ：{e.data.supportAngle}
                        </small>
                      )}
                      {e.data?.warnings?.length > 0 && (
                        <details>
                          <summary>查看限制详情</summary>
                          <p>{e.data.warnings.join("；")}</p>
                        </details>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                title="等待 Agent 开始"
                detail={"计划启动：" + fullDate(j.run_after)}
              />
            )}
          </section>
        </div>
      )}
      {tab === "evidence" && (
        <>
          <div className="filter-bar">
            <select
              aria-label="筛选证据方向"
              value={effect}
              onChange={(e) => setEffect(e.target.value)}
            >
              <option value="all">全部证据</option>
              {Object.entries(effectNames).map(([k, v]) => (
                <option value={k} key={k}>
                  {v}
                </option>
              ))}
            </select>
            <span className="muted">
              原文摘录通过逐字匹配；推断与时效仍需核查。
            </span>
          </div>
          {evidence.length ? (
            <div className="evidence-grid">
              {evidence.map((e: any) => (
                <EvidenceCard
                  e={e}
                  s={j.sources.find((s: any) => s.id === e.sourceId)}
                  key={e.id}
                />
              ))}
            </div>
          ) : (
            <section className="panel">
              <Empty
                title="还没有可核验的证据"
                detail="仅有搜索摘要、引语不匹配或晚于冻结时间的材料，不会计入有效证据。"
              />
            </section>
          )}
          <section className="panel sources-panel">
            <div className="panel-heading">
              <h2>
                全部来源 <span className="count">{j.sources.length}</span>
              </h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>来源</th>
                    <th>读取状态</th>
                    <th>发布时间</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {j.sources.map((s: any) => (
                    <tr key={s.id}>
                      <td>
                        <a
                          target="_blank"
                          rel="noreferrer"
                          href={s.url}
                          className="table-title"
                        >
                          {s.title || s.domain}
                        </a>
                        <small className="block muted">
                          {s.domain}
                          {s.error ? " · " + s.error : ""}
                        </small>
                      </td>
                      <td>
                        <Badge status={s.status} />
                      </td>
                      <td className="nowrap muted">
                        {s.published ? fmt(s.published) : "未确认"}
                      </td>
                      <td>
                        <button
                          className="text-btn"
                          onClick={async () => {
                            try {
                              setSource(await api("/sources/" + s.id));
                            } catch (e) {
                              toast((e as Error).message, true);
                            }
                          }}
                        >
                          快照
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {tab === "data" && (
        <>
          <div className="notice">
            每场比赛独立记录 38
            个指标。未知、未搜索与已验证分开显示；不跨数据商混算指标。
          </div>
          {j.stages.find((s: any) => s.stage_id === "recent")?.data?.packs
            ?.length ? (
            j.stages
              .find((s: any) => s.stage_id === "recent")
              .data.packs.map((p: any, i: number) => (
                <section className="panel data-panel" key={i}>
                  <div className="panel-heading">
                    <h2>
                      {p.match.home} vs {p.match.away}
                      <small className="block muted">{p.match.date}</small>
                    </h2>
                    <span className="subtle-badge">
                      {
                        (
                          {
                            complete: "指标齐全",
                            limited: "公开数据有限",
                            partial: "部分搜索",
                          } as any
                        )[p.status]
                      }
                    </span>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>指标</th>
                          <th>主队</th>
                          <th>客队</th>
                          <th>状态</th>
                          <th>定义 / 提供方</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.metrics.map((m: any) => (
                          <tr key={m.name}>
                            <td>{m.name}</td>
                            <td>{m.home ?? "—"}</td>
                            <td>{m.away ?? "—"}</td>
                            <td>
                              {
                                (
                                  {
                                    verified: "原文已核验",
                                    unknown: "暂未查到",
                                    unsearched: "尚未搜索",
                                  } as any
                                )[m.status]
                              }
                            </td>
                            <td className="muted">
                              {m.provider || "—"}
                              <small className="block">{m.definition}</small>
                              {m.attempted?.length > 0 && (
                                <details>
                                  <summary>搜索记录</summary>
                                  {m.attempted.map((q: string) => (
                                    <p key={q}>{q}</p>
                                  ))}
                                </details>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))
          ) : (
            <section className="panel">
              <Empty
                title="逐场数据尚未建立"
                detail="近期表现阶段会先核验关键比赛身份，再分组检索全部指标。可靠来源不足时，不会虚构比赛。"
              />
            </section>
          )}
        </>
      )}
      {tab === "report" &&
        (j.report ? (
          <section className="panel report-panel">
            <div className="panel-heading">
              <h2>方向研究报告</h2>
              <div className="head-actions">
                <Link className="btn primary small" to={"/writing?jobId=" + id}>
                  去写口播稿
                </Link>
                <a
                  className="btn small"
                  href={"/api/reports/" + id + "/export?format=json"}
                >
                  <Download size={14} />
                  完整证据包
                </a>
                <a
                  className="btn small"
                  href={"/api/reports/" + id + "/export?format=md"}
                >
                  <Download size={14} />
                  Markdown
                </a>
              </div>
            </div>
            <div className="report-markdown">
              <Markdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: (props) => (
                    <a {...props} target="_blank" rel="noreferrer" />
                  ),
                }}
              >
                {j.report.markdown}
              </Markdown>
            </div>
          </section>
        ) : (
          <section className="panel">
            <Empty
              title="报告正在等待证据"
              detail="全部阶段结束后综合判断。遇到预算限制，会生成明确披露缺口的受限报告。"
            />
          </section>
        ))}
      {budget && (
        <BudgetModal
          job={j}
          onClose={() => setBudget(false)}
          onSaved={reload}
        />
      )}
      {confirm && (
        <Modal
          title={
            confirm === "delete"
              ? "永久删除这个研究任务？"
              : "取消这个研究任务？"
          }
          onClose={() => setConfirm("")}
        >
          <p>
            {confirm === "delete"
              ? "任务、报告、来源与证据将从此工作空间删除。请先导出需要的资料。"
              : "当前搜索会停止，已获取的来源、证据和阶段检查点会保留。"}
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setConfirm("")}>
              继续研究
            </button>
            <button
              className="btn danger"
              disabled={!!busy}
              onClick={() => act(confirm)}
            >
              {confirm === "delete" ? "确认删除" : "确认取消"}
            </button>
          </div>
        </Modal>
      )}
      {source && (
        <Modal
          title="原文快照"
          subtitle={source.url}
          wide
          onClose={() => setSource(null)}
        >
          <div className="notice">
            抓取时间：{fullDate(source.fetchedAt)} · {source.status}
          </div>
          <pre className="source-text">
            {source.text || source.error || "没有可读取的正文"}
          </pre>
        </Modal>
      )}
    </>
  );
}
function WaypointsIcon({ size }: { size: number }) {
  return <Target size={size} />;
}
export function Reports() {
  const { data, loading, error, reload } = useLoad<any[]>("/reports"),
    [query, setQuery] = useState("");
  const items = (data || []).filter((r) =>
    (r.fixture.home + r.fixture.away + r.direction).includes(query),
  );
  return (
    <>
      <PageHead
        eyebrow="RESEARCH LIBRARY"
        title="报告档案"
        description="把研究留存下来。方向判断、反证、逐场数据与原始来源，在同一份档案里。"
        actions={
          <Link className="btn primary" to="/matches">
            <Plus size={16} />
            发起研究
          </Link>
        }
      />
      <div className="filter-bar">
        <div className="search-input">
          <Search size={17} />
          <input
            aria-label="搜索报告"
            placeholder="搜索比赛或方向…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <span className="filter-count">{items.length} 份报告</span>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} retry={reload} />
      ) : items.length ? (
        <div className="report-grid">
          {items.map((r) => (
            <article className="report-card" key={r.job_id}>
              <div className="report-card-top">
                <div className="report-icon">
                  <FileText size={24} />
                </div>
                <Badge status={r.status} />
              </div>
              <small>
                {r.fixture.league} · {fmt(r.fixture.kickoff)}
              </small>
              <h2>
                {r.fixture.home}
                <span>vs</span>
                {r.fixture.away}
              </h2>
              <p>{r.direction}</p>
              <div className="report-verdict">
                <strong>{r.verdict}</strong>
                <span>
                  {
                    ({ high: "高", medium: "中", low: "低" } as any)[
                      r.confidence
                    ]
                  }
                  置信度
                </span>
              </div>
              <div className="report-card-bottom">
                <Link to={"/jobs/" + r.job_id + "?tab=report"}>
                  阅读报告 <ArrowUpRight size={16} />
                </Link>
                <a
                  aria-label="下载报告"
                  className="icon-btn"
                  href={"/api/reports/" + r.job_id + "/export"}
                >
                  <Download size={17} />
                </a>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="panel">
          <Empty
            title="研究成果将在这里归档"
            detail="报告生成后，可在线阅读或导出 Markdown 与包含证据快照的 JSON。"
          />
        </section>
      )}
    </>
  );
}
export function EvidencePage() {
  const { data, loading, error, reload } = useLoad<any[]>("/evidence"),
    [query, setQuery] = useState(""),
    [effect, setEffect] = useState("all");
  const items = (data || []).filter(
    (e) =>
      (effect === "all" || e.effect === effect) &&
      (!query ||
        (e.claim + e.fixture.home + e.fixture.away + e.source.domain)
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  return (
    <>
      <PageHead
        eyebrow="TRACEABLE INTELLIGENCE"
        title="证据库"
        description="事实、推断与未知分开保存。每条证据都能回到来源和产生它的研究任务。"
      />
      <div className="filter-bar">
        <div className="search-input">
          <Search size={17} />
          <input
            aria-label="搜索证据"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索事实、球队或来源…"
          />
        </div>
        <select
          aria-label="筛选证据"
          value={effect}
          onChange={(e) => setEffect(e.target.value)}
        >
          <option value="all">全部方向</option>
          {Object.entries(effectNames).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <span className="filter-count">{items.length} 条 · 最近 500 条</span>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} retry={reload} />
      ) : items.length ? (
        <div className="evidence-grid">
          {items.map((e) => (
            <div key={e.id}>
              <Link
                className="evidence-task"
                to={"/jobs/" + e.jobId + "?tab=evidence"}
              >
                {e.fixture.home} vs {e.fixture.away}
                <ChevronRight size={13} />
              </Link>
              <EvidenceCard e={e} s={e.source} />
            </div>
          ))}
        </div>
      ) : (
        <section className="panel">
          <Empty
            title="这里存放有出处的判断"
            detail="Agent 读取网页、匹配原文引语后，可追溯的证据会自动进入证据库。"
          />
        </section>
      )}
    </>
  );
}

function BudgetModal({
  job,
  onClose,
  onSaved,
}: {
  job: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
      maxQueries: Math.min(
        400,
        Math.max(job.config.maxQueries, job.queries + 40),
      ),
      maxModelCalls: Math.min(
        200,
        Math.max(job.config.maxModelCalls, job.model_calls + 30),
      ),
      maxRunMinutes: job.config.maxRunMinutes,
      retryGaps: true,
    }),
    [busy, setBusy] = useState(false);
  const toast = useToast();
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/jobs/" + job.id + "/budget", body(form, "PATCH"));
      toast("预算已更新，可点击继续研究");
      onSaved();
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="调整预算与缺口补查" onClose={onClose}>
      <form onSubmit={save}>
        <p className="muted">
          预算是此任务累计上限，已使用次数不会清零。勾选补查后，会重新打开存在缺口的阶段并保留上一轮记录。
        </p>
        {[
          { key: "maxQueries", label: "搜索总预算", min: 40, max: 400 },
          { key: "maxModelCalls", label: "模型请求总预算", min: 30, max: 200 },
          {
            key: "maxRunMinutes",
            label: "单次运行上限（分钟）",
            min: 10,
            max: 240,
          },
        ].map((f) => (
          <Field label={f.label} key={f.key}>
            <input
              required
              type="number"
              min={f.min}
              max={f.max}
              value={(form as any)[f.key]}
              onChange={(e) =>
                setForm({ ...form, [f.key]: Number(e.target.value) })
              }
            />
          </Field>
        ))}
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={form.retryGaps}
            onChange={(e) => setForm({ ...form, retryGaps: e.target.checked })}
          />
          重新检索存在缺口的阶段
        </label>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <Submit busy={busy}>保存设置</Submit>
        </div>
      </form>
    </Modal>
  );
}
