import { useState, FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  FileText,
  Globe2,
  Layers3,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Upload,
  Waypoints,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  api,
  body,
  useLoad,
  useToast,
  useAuth,
  PageHead,
  Loading,
  ErrorBox,
  Empty,
  Modal,
  Field,
  Submit,
  Badge,
  fmt,
  localInput,
} from "./lib";
export function Dashboard() {
  const { data: d, loading, error, reload } = useLoad("/dashboard", 8000);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} retry={reload} />;
  const running = d.counts
    .filter((x: any) => ["running", "queued"].includes(x.status))
    .reduce((s: number, x: any) => s + x.count, 0);
  return (
    <>
      <PageHead
        eyebrow="YOUR RESEARCH, IN FOCUS"
        title="研究，从一个好问题开始。"
        description="选择比赛，给出方向。让 Agent 搜集、核验，再把证据连接起来。"
        actions={
          <Link className="btn primary" to="/matches">
            <Plus size={17} />
            发起研究
          </Link>
        }
      />
      <section className="hero-card">
        <div className="hero-copy">
          <div className="hero-kicker">
            <span className="pulse-dot" />
            AUTONOMOUS FOOTBALL RESEARCH
          </div>
          <h2>
            把赛前信息，
            <br />
            变成有依据的判断。
          </h2>
          <p>
            普通大模型负责规划与分析，独立搜索引擎负责发现信息。
            <br className="desktop-only" />
            每一步搜索、每一次追问、每条原文，都留有记录。
          </p>
          <Link to="/matches">
            进入比赛中心 <ArrowUpRight size={17} />
          </Link>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="radar r1" />
          <div className="radar r2" />
          <div className="radar r3" />
          <div className="radar-axis" />
          <div className="art-label label-a">
            <Globe2 size={16} /> 全网线索
          </div>
          <div className="art-label label-b">
            <ShieldCheck size={16} /> 原文核验
          </div>
          <div className="art-core">
            <Waypoints size={39} />
          </div>
          <div className="art-label label-c">
            <FileText size={16} /> 方向报告
          </div>
          <div className="art-coordinate">EVIDENCE → INSIGHT</div>
        </div>
      </section>
      <div className="stat-grid">
        {[
          {
            label: "可选比赛",
            value: d.fixtures,
            sub: "已同步与手动录入",
            icon: CalendarDays,
            to: "/matches",
          },
          {
            label: "进行中的研究",
            value: running,
            sub: "后台任务持续运行",
            icon: Activity,
            to: "/jobs",
          },
          {
            label: "研究报告",
            value: d.reports,
            sub: "含已完成与受限报告",
            icon: FileText,
            to: "/reports",
          },
          {
            label: "可追溯证据",
            value: d.evidence,
            sub: "关联已打开的原文",
            icon: BookOpen,
            to: "/evidence",
          },
        ].map((x) => (
          <Link className="stat-card" to={x.to} key={x.label}>
            <div className="stat-top">
              <span>{x.label}</span>
              <x.icon size={19} />
            </div>
            <strong>{x.value.toLocaleString()}</strong>
            <span className="stat-sub">
              {x.sub}
              <ArrowUpRight size={15} />
            </span>
          </Link>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>
              最近的研究 <span className="count">{d.recent.length}</span>
            </h2>
            <Link to="/jobs">
              查看全部 <ArrowRight size={15} />
            </Link>
          </div>
          {d.recent.length ? (
            <div className="recent-list">
              {d.recent.map((j: any) => (
                <Link to={"/jobs/" + j.id} className="recent-item" key={j.id}>
                  <span className="match-mini">
                    <Target size={20} />
                  </span>
                  <div className="grow">
                    <strong>
                      {j.fixture.home} <span className="muted">vs</span>{" "}
                      {j.fixture.away}
                    </strong>
                    <p>{j.direction}</p>
                  </div>
                  <div className="recent-right">
                    <Badge status={j.status} />
                    <small>{fmt(j.created_at)}</small>
                  </div>
                  <ChevronRight size={17} />
                </Link>
              ))}
            </div>
          ) : (
            <Empty
              title="你的第一份研究，从这里开始"
              detail="连接一个模型，选择比赛并填写方向。后台会保存每个阶段的研究记录。"
              action={
                <Link to="/matches" className="btn">
                  <Plus size={15} />
                  选择一场比赛
                </Link>
              }
            />
          )}
        </section>
        <section className="panel setup-panel">
          <div className="panel-heading">
            <h2>工作台状态</h2>
            <span className="subtle-badge">LIVE</span>
          </div>
          {[
            {
              ok: d.modelCount > 0,
              title: "分析模型",
              detail: d.modelCount
                ? d.modelCount + " 个模型配置可用"
                : "先添加一个普通对话模型",
              to: "/settings",
            },
            {
              ok: true,
              title: "独立搜索",
              detail:
                d.search === "searchboost"
                  ? "SearchBoost · 免费引擎池"
                  : d.search === "searchboost-api"
                    ? "SearchBoost · 第三方搜索 API"
                    : "SearXNG · 自托管搜索",
              to: "/settings",
            },
            {
              ok: !!d.lastSync,
              title: "比赛数据",
              detail: d.lastSync
                ? "上次同步 " + fmt(d.lastSync.at)
                : "可同步体彩或连接红黑记录",
              to: "/matches",
            },
          ].map((x) => (
            <Link className="setup-row" to={x.to} key={x.title}>
              <span className={"check-icon " + (x.ok ? "ok" : "")}>
                {x.ok ? <Check size={15} /> : <Plus size={15} />}
              </span>
              <div>
                <strong>{x.title}</strong>
                <small>{x.detail}</small>
              </div>
              <ChevronRight size={15} />
            </Link>
          ))}
          <div className="small-callout">
            <ShieldCheck size={18} />
            <p>方向是待验证的假设。报告会保留最强反证与未知信息。</p>
          </div>
        </section>
      </div>
      <section className="process-strip">
        <div>
          <span className="eyebrow">HOW IT WORKS</span>
          <h3>一条完整的研究路径</h3>
        </div>
        {[
          { icon: Target, title: "给出方向", desc: "选比赛 · 填假设" },
          { icon: Globe2, title: "多源搜索", desc: "当地语言 · 原文读取" },
          { icon: Layers3, title: "审计与追问", desc: "12 阶段 · 动态补搜" },
          { icon: FileText, title: "形成报告", desc: "证据链 · 反证 · 条件" },
        ].map((s, i) => (
          <div className="process-step" key={s.title}>
            <span>0{i + 1}</span>
            <s.icon size={19} />
            <strong>
              {s.title}
              <small>{s.desc}</small>
            </strong>
            {i < 3 && <ChevronRight className="step-arrow" size={15} />}
          </div>
        ))}
      </section>
    </>
  );
}
export function NewJob({
  fixture,
  onClose,
}: {
  fixture: any;
  onClose: () => void;
}) {
  const { data: providers } = useLoad<any[]>("/providers"),
    [busy, setBusy] = useState(false),
    [scheduled, setScheduled] = useState(false),
    [error, setError] = useState("");
  const navigate = useNavigate();
  const enabled = providers?.filter((p) => p.enabled) || [];
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const result = await api(
        "/jobs",
        body({
          fixtureId: fixture.id,
          direction: f.get("direction"),
          line: f.get("line"),
          providerId: f.get("providerId"),
          ...(scheduled
            ? { runAfter: new Date(String(f.get("runAfter"))).toISOString() }
            : {}),
        }),
      );
      navigate("/jobs/" + result.id);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="发起比赛研究"
      subtitle="一个明确的假设，是深入研究的起点。"
      onClose={onClose}
    >
      <div className="modal-match">
        <span>
          {fixture.league} · {fmt(fixture.kickoff)}
        </span>
        <strong>
          {fixture.home} <b>vs</b> {fixture.away}
        </strong>
      </div>
      <form onSubmit={submit}>
        <Field
          label="你的研究方向"
          hint="Agent 会优先搜集支持材料，同时核查最强反证。"
        >
          <textarea
            name="direction"
            required
            minLength={2}
            maxLength={1500}
            rows={3}
            placeholder="例如：主队不败。重点核查主队高位逼抢能否限制客队的出球。"
          />
        </Field>
        <div className="form-grid">
          <Field label="分析模型">
            <select name="providerId" required defaultValue="">
              <option value="" disabled>
                选择模型配置
              </option>
              {enabled.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.model}
                </option>
              ))}
            </select>
          </Field>
          <Field label="盘口 / 门槛（可选）">
            <input name="line" maxLength={200} placeholder="例如：主队 +0.25" />
          </Field>
        </div>
        {!enabled.length && (
          <div className="small-callout">
            尚无启用的模型。<Link to="/settings">前往配置</Link>
          </div>
        )}
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={scheduled}
            onChange={(e) => setScheduled(e.target.checked)}
          />
          预约启动时间
        </label>
        {scheduled && (
          <Field label="启动时间（本地时区）">
            <input
              type="datetime-local"
              name="runAfter"
              defaultValue={localInput()}
              required
            />
          </Field>
        )}
        <div className="small-callout">
          <BookOpen size={17} />
          <p>
            包括全景选题、逐阶段核验、关键场次 38
            项指标、定向追问与反证检查。预算不足会生成受限报告。
          </p>
        </div>
        {error && <ErrorBox message={error} />}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <Submit busy={busy}>
            开始研究 <ArrowRight size={16} />
          </Submit>
        </div>
      </form>
    </Modal>
  );
}
function AddFixture({
  onClose,
  onSaved,
  fixture,
}: {
  onClose: () => void;
  onSaved: () => void;
  fixture?: any;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [mode, setMode] = useState("manual");
  const toast = useToast();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      if (mode === "import")
        await api("/fixtures/import", body(JSON.parse(String(f.get("json")))));
      else
        await api(
          "/fixtures" + (fixture ? "/" + fixture.id : ""),
          body(
            {
              ...Object.fromEntries(f),
              kickoff: new Date(String(f.get("kickoff"))).toISOString(),
            },
            fixture ? "PUT" : "POST",
          ),
        );
      toast("比赛已保存");
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={fixture ? "编辑比赛" : "添加比赛"}
      subtitle="官方数据暂不可用时，也可以手动建立研究对象。"
      onClose={onClose}
    >
      {!fixture && (
        <div className="tabs">
          <button
            className={mode === "manual" ? "active" : ""}
            onClick={() => setMode("manual")}
          >
            手动录入
          </button>
          <button
            className={mode === "import" ? "active" : ""}
            onClick={() => setMode("import")}
          >
            JSON 批量导入
          </button>
        </div>
      )}
      <form onSubmit={submit}>
        {mode === "manual" ? (
          <>
            <div className="form-grid">
              <Field label="主队">
                <input
                  name="home"
                  defaultValue={fixture?.home}
                  required
                  maxLength={120}
                  placeholder="主队名称"
                />
              </Field>
              <Field label="客队">
                <input
                  name="away"
                  defaultValue={fixture?.away}
                  required
                  maxLength={120}
                  placeholder="客队名称"
                />
              </Field>
              <Field label="赛事">
                <input
                  name="league"
                  defaultValue={fixture?.league}
                  required
                  maxLength={120}
                  placeholder="赛事名称"
                />
              </Field>
              <Field label="开球时间（本地时区）">
                <input
                  type="datetime-local"
                  name="kickoff"
                  defaultValue={
                    fixture ? localInput(new Date(fixture.kickoff)) : ""
                  }
                  required
                />
              </Field>
              <Field label="主队当地名称（可选）">
                <input
                  name="homeLocal"
                  defaultValue={fixture?.homeLocal}
                  placeholder="官方 / 当地语言名称"
                />
              </Field>
              <Field label="客队当地名称（可选）">
                <input
                  name="awayLocal"
                  defaultValue={fixture?.awayLocal}
                  placeholder="官方 / 当地语言名称"
                />
              </Field>
            </div>
            <Field label="主要搜索语言（可选）">
              <input
                name="language"
                defaultValue={fixture?.language}
                placeholder="例如：德语；留空由模型核查"
              />
            </Field>
            <Field label="比赛来源链接（可选）">
              <input
                type="url"
                name="sourceUrl"
                defaultValue={fixture?.sourceUrl}
                placeholder="https://…"
              />
            </Field>
          </>
        ) : (
          <Field
            label="比赛 JSON 数组"
            hint="字段：home、away、league、kickoff（含时区的 ISO 时间），可选 homeLocal、awayLocal、sourceUrl。一次最多 100 场。"
          >
            <textarea
              name="json"
              rows={12}
              required
              placeholder="粘贴符合字段要求的比赛数组"
            />
          </Field>
        )}
        {error && <ErrorBox message={error} />}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <Submit busy={busy}>保存比赛</Submit>
        </div>
      </form>
    </Modal>
  );
}
export function Matches() {
  const { data, loading, error, reload } = useLoad("/fixtures"),
    [query, setQuery] = useState(""),
    [league, setLeague] = useState("all"),
    [date, setDate] = useState(""),
    [past, setPast] = useState(false),
    [syncing, setSyncing] = useState(false),
    [add, setAdd] = useState(false),
    [selected, setSelected] = useState<any>(null),
    [editing, setEditing] = useState<any>(null),
    [deleting, setDeleting] = useState<any>(null);
  const toast = useToast(),
    user = useAuth();
  const writable = user.role !== "viewer";
  const items = (data?.items || []).filter(
    (m: any) =>
      (past || new Date(m.kickoff) > new Date()) &&
      (league === "all" || m.league === league) &&
      (!date || new Date(m.kickoff).toLocaleDateString("en-CA") === date) &&
      (!query ||
        (m.home + " " + m.away + " " + m.league)
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  async function sync() {
    setSyncing(true);
    try {
      const r = await api("/fixtures/sync", body({}));
      toast("已同步 " + r.count + " 场比赛");
      await reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setSyncing(false);
    }
  }
  return (
    <>
      <PageHead
        eyebrow="MATCH CENTER"
        title="比赛中心"
        description="找到值得研究的比赛，给出你的方向。时间以当前浏览器时区显示。"
        actions={
          writable ? (
            <>
              <button className="btn" onClick={() => setAdd(true)}>
                <Plus size={16} />
                添加比赛
              </button>
              <button className="btn primary" disabled={syncing} onClick={sync}>
                <RefreshCw size={16} className={syncing ? "spin" : ""} />
                {syncing ? "同步中…" : "同步比赛"}
              </button>
            </>
          ) : null
        }
      />
      <div className="source-bar">
        <span>
          <span className="dot green" />
          体彩竞彩 / 红黑记录 / 手动录入
        </span>
        <span>
          上次同步：{data?.lastSync ? fmt(data.lastSync.at) : "尚未同步"}
        </span>
      </div>
      <div className="filter-bar">
        <div className="search-input">
          <Search size={17} />
          <input
            aria-label="搜索比赛"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索球队、赛事…"
          />
        </div>
        <select
          aria-label="筛选赛事"
          value={league}
          onChange={(e) => setLeague(e.target.value)}
        >
          <option value="all">全部赛事</option>
          {[
            ...new Set<string>((data?.items || []).map((m: any) => m.league)),
          ].map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
        <input
          aria-label="筛选比赛日期"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={past}
            onChange={(e) => setPast(e.target.checked)}
          />
          显示历史
        </label>
        <span className="filter-count">{items.length} 场比赛</span>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} retry={reload} />
      ) : items.length ? (
        <div className="matches-grid">
          {items.map((m: any) => (
            <article className="match-card" key={m.id}>
              <div className="match-card-top">
                <span>
                  <span className="league-dot" />
                  {m.league}
                </span>
                <small>{m.matchNumber || "手动录入"}</small>
                <div className="fixture-tools">
                  {writable && ["manual", "import"].includes(m.source) && (
                    <button
                      className="icon-btn"
                      aria-label={"编辑 " + m.home + " vs " + m.away}
                      onClick={() => setEditing(m)}
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                  {user.role === "admin" && (
                    <button
                      className="icon-btn"
                      aria-label={"删除 " + m.home + " vs " + m.away}
                      onClick={() => setDeleting(m)}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
              <div className="match-date">
                <Clock3 size={13} />
                {fmt(m.kickoff)}
              </div>
              <div className="teams">
                <div>
                  <span className="team-crest home">{m.home.slice(0, 2)}</span>
                  <strong>{m.home}</strong>
                  <small>主队</small>
                </div>
                <span className="versus">VS</span>
                <div>
                  <span className="team-crest away">{m.away.slice(0, 2)}</span>
                  <strong>{m.away}</strong>
                  <small>客队</small>
                </div>
              </div>
              <div className="match-card-bottom">
                <span className="subtle-badge">
                  {new Date(m.kickoff) > new Date() ? "未开赛" : "已到开球时间"}
                </span>
                {writable && new Date(m.kickoff) > new Date() && (
                  <button onClick={() => setSelected(m)}>
                    研究这场 <ArrowUpRight size={16} />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="panel">
          <Empty
            title={
              data?.items?.length ? "没有符合条件的比赛" : "比赛中心准备就绪"
            }
            detail={
              data?.items?.length
                ? "尝试调整日期、赛事或搜索条件。"
                : "同步竞彩列表，连接已有红黑记录实例，或手动添加一场比赛。"
            }
            action={
              writable ? (
                <button
                  className="btn primary"
                  onClick={sync}
                  disabled={syncing}
                >
                  <RefreshCw size={16} />
                  同步比赛
                </button>
              ) : null
            }
          />
        </section>
      )}
      <p className="footnote">
        <Globe2 size={14} />
        上游接口可能受地区网络限制。可在系统配置中连接国内部署的红黑记录，或导入自有比赛列表。
      </p>
      {add && (
        <AddFixture onClose={() => setAdd(false)} onSaved={reload} />
      )}{" "}
      {editing && (
        <AddFixture
          fixture={editing}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
      {deleting && (
        <Modal title="删除比赛？" onClose={() => setDeleting(null)}>
          <p>
            {deleting.home} vs {deleting.away}。存在研究任务的比赛不能删除。
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setDeleting(null)}>
              取消
            </button>
            <button
              className="btn danger"
              onClick={async () => {
                try {
                  await api("/fixtures/" + deleting.id, { method: "DELETE" });
                  setDeleting(null);
                  await reload();
                  toast("比赛已删除");
                } catch (e) {
                  toast((e as Error).message, true);
                }
              }}
            >
              确认删除
            </button>
          </div>
        </Modal>
      )}
      {selected && (
        <NewJob fixture={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
