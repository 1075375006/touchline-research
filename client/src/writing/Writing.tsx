import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import ThinkingControls from "../ThinkingControls";
import {
  thinkingConfig,
  thinkingSummary,
  thinkingValidation,
} from "../../../server/thinking";
import {
  PenLine,
  Settings2,
  Download,
  ArrowRight,
  Square,
  RotateCcw,
} from "lucide-react";
import {
  api,
  body,
  useLoad,
  useAuth,
  useToast,
  PageHead,
  Field,
  Submit,
  Loading,
  ErrorBox,
  Empty,
  Modal,
  fmt,
} from "../lib";
const names: Record<string, string> = {
  queued: "等待写作",
  running: "写作中",
  completed: "稿件完成",
  needs_review: "待复核",
  failed: "生成失败",
  cancelled: "已取消",
};
const fixtureName = (f: any) =>
  (f?.home || "主队") + " vs " + (f?.away || "客队");
export function Writing() {
  const [params, setParams] = useSearchParams();
  const materials = useLoad<any[]>("/writing/materials");
  const styles = useLoad<any[]>("/writing/styles");
  const providers = useLoad<any[]>("/providers");
  const history = useLoad<any[]>("/writing/runs", 4000);
  const [jobId, setJobId] = useState(params.get("jobId") || "");
  const [styleId, setStyleId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [duration, setDuration] = useState(3);
  const [rate, setRate] = useState(240);
  const [instructions, setInstructions] = useState("");
  const [supplementSearch, setSupplementSearch] = useState(true);
  const [maxSupplementQueries, setMaxSupplementQueries] = useState(6);
  const [pagesPerQuery, setPagesPerQuery] = useState(2);
  const [inheritThinking, setInheritThinking] = useState(true);
  const [thinking, setThinking] = useState(thinkingConfig());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const user = useAuth(),
    toast = useToast();
  const selected = params.get("run") || "";
  useEffect(() => {
    const s = styles.data?.find((s) => s.enabled);
    if (!styleId && s) {
      setStyleId(s.id);
      setRate(s.charsPerMinute);
    }
  }, [styles.data]);
  useEffect(() => {
    if (!providerId)
      setProviderId(providers.data?.find((p) => p.enabled)?.id || "");
  }, [providers.data]);
  const target = Math.round(duration * rate);
  const material = materials.data?.find((m) => m.id === jobId);
  const style = styles.data?.find((s) => s.id === styleId);
  const provider = providers.data?.find((p) => p.id === providerId);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const thinkingProblem =
        provider &&
        thinkingValidation({
          ...provider,
          thinking: inheritThinking ? provider.thinking : thinking,
        });
      if (thinkingProblem) throw new Error(thinkingProblem);
      const r = await api(
        "/writing/runs",
        body({
          jobId,
          styleId,
          providerId,
          durationMinutes: duration,
          charsPerMinute: rate,
          instructions,
          supplementSearch,
          maxSupplementQueries,
          pagesPerQuery,
          thinking: inheritThinking ? undefined : thinking,
        }),
      );
      setParams({ jobId, run: r.id });
      void history.reload();
      toast("已开始独立写作，研究资料已保存快照");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function clone(r: any) {
    setJobId(r.job_id || "");
    setStyleId(r.input.styleId || "");
    setProviderId(r.input.providerId || "");
    setDuration(r.input.durationMinutes || 3);
    setRate(r.input.charsPerMinute || 240);
    setInstructions(r.input.instructions || "");
    setSupplementSearch(r.input.supplementSearch === true);
    setMaxSupplementQueries(r.input.maxSupplementQueries || 6);
    setPagesPerQuery(r.input.pagesPerQuery || 2);
    setInheritThinking(false);
    setThinking(thinkingConfig(r.input.provider?.thinking));
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast("已填入上次设置；点击开始后会使用当前风格和研究资料创建新版本");
  }
  return (
    <>
      <PageHead
        eyebrow="WRITING STUDIO"
        title="口播写作"
        description="研究之后，再决定如何讲。选择一份研究资料，独立生成不同风格、不同长度的口播稿。"
        actions={
          <Link className="btn" to="/writing/styles">
            <Settings2 size={17} />
            风格与知识库
          </Link>
        }
      />
      <div className="writing-layout">
        <section className="panel writing-form">
          <div className="panel-heading">
            <h2>
              <PenLine size={19} /> 开始一篇新稿
            </h2>
            <span className="pill">手动发起</span>
          </div>
          <form onSubmit={submit}>
            <Field label="研究资料">
              <select
                aria-label="研究资料"
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
                required
              >
                <option value="">选择已有研究报告</option>
                {materials.data?.map((m) => (
                  <option
                    key={m.id}
                    value={m.id}
                    disabled={["queued", "running"].includes(m.status)}
                  >
                    {fixtureName(m.fixture)} · {m.direction} ·{" "}
                    {fmt(m.report_at)}
                  </option>
                ))}
              </select>
            </Field>
            {material && (
              <div className="writing-material">
                <strong>{material.direction}</strong>
                <span>
                  {material.evidence_count} 条证据 · 报告{" "}
                  {fmt(material.report_at)}
                </span>
                <Link to={"/jobs/" + jobId}>
                  查看研究与来源 <ArrowRight size={13} />
                </Link>
                {material.status !== "completed" && (
                  <p>
                    这份研究尚不完整。写作保留其资料缺口与判断条件，不补造事实。
                  </p>
                )}
              </div>
            )}
            {!materials.loading && !materials.data?.length && (
              <p className="muted small">
                先在<Link to="/matches">比赛中心</Link>
                完成资料研究，再回到这里写稿。
              </p>
            )}
            <Field label="写作模型">
              <select
                aria-label="写作模型"
                value={providerId}
                onChange={(e) => {
                  setProviderId(e.target.value);
                  setInheritThinking(true);
                }}
                required
              >
                <option value="">选择启用的模型</option>
                {providers.data
                  ?.filter((p) => p.enabled)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.model}
                    </option>
                  ))}
              </select>
            </Field>
            {provider && (
              <details className="writing-details writing-thinking">
                <summary>
                  写作模型思考 ·{" "}
                  {thinkingSummary({
                    ...provider,
                    thinking: inheritThinking ? provider.thinking : thinking,
                  })}
                </summary>
                <label className="writing-check">
                  <input
                    type="checkbox"
                    checked={!inheritThinking}
                    onChange={(e) => {
                      setInheritThinking(!e.target.checked);
                      if (e.target.checked)
                        setThinking(thinkingConfig(provider.thinking));
                    }}
                  />
                  自定义本次写作的思考设置
                </label>
                {!inheritThinking && (
                  <ThinkingControls
                    type={provider.type}
                    model={provider.model}
                    value={thinking}
                    onChange={setThinking}
                    description="应用于写前缺口分析、写中补搜决策、证据核验、口播生成与最终审核。发送模型原生思考参数；不支持时会明确报错。"
                  />
                )}
                {inheritThinking && (
                  <p className="muted small">
                    当前沿用所选模型的思考配置。勾选后可为这篇稿件单独选择模式、深度或预算。
                  </p>
                )}
              </details>
            )}
            <Field label="口播风格">
              <select
                aria-label="口播风格"
                value={styleId}
                onChange={(e) => {
                  const s = styles.data?.find((s) => s.id === e.target.value);
                  setStyleId(e.target.value);
                  if (s) setRate(s.charsPerMinute);
                }}
                required
              >
                <option value="">选择风格</option>
                {styles.data
                  ?.filter((s) => s.enabled)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </Field>
            {style && (
              <p className="muted small">
                {style.description} · 启用{" "}
                {style.knowledge.filter((k: any) => k.enabled).length}{" "}
                个知识条目
              </p>
            )}
            <div className="form-grid">
              <Field label="预计时长（分钟）">
                <input
                  aria-label="预计时长（分钟）"
                  type="number"
                  min=".5"
                  max="30"
                  step=".5"
                  required
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                />
              </Field>
              <Field label="语速（字/分钟）">
                <input
                  aria-label="语速（字/分钟）"
                  type="number"
                  min="120"
                  max="360"
                  step="1"
                  required
                  value={rate}
                  onChange={(e) => setRate(Number(e.target.value))}
                />
              </Field>
            </div>
            <div className="writing-target">
              <span>目标有效字数</span>
              <strong>
                {Number.isFinite(target) ? target.toLocaleString() : "—"}{" "}
                <small>字</small>
              </strong>
              <span>
                验收区间 {Math.floor((target * 9) / 10)}—
                {Math.ceil((target * 11) / 10)} 字
              </span>
            </div>
            <p className="muted small">
              按时长 ×
              语速估算，只计汉字、字母、数字。实际朗读受停顿与表达影响；语速可自行调整。
            </p>
            <div className="writing-search-options">
              <label className="writing-check">
                <input
                  type="checkbox"
                  checked={supplementSearch}
                  onChange={(e) => setSupplementSearch(e.target.checked)}
                />
                允许 AI 主动补搜证据
              </label>
              <p className="muted small">
                写前先分析资料缺口，逐段写作时按需搜索、阅读与核验。使用后台当前搜索引擎配置；无需专用
                AI 搜索模型。
              </p>
              {supplementSearch && (
                <div className="form-grid">
                  <Field label="补搜查询上限">
                    <input
                      aria-label="补搜查询上限"
                      type="number"
                      min={1}
                      max={12}
                      required
                      value={maxSupplementQueries}
                      onChange={(e) =>
                        setMaxSupplementQueries(Number(e.target.value))
                      }
                    />
                  </Field>
                  <Field label="每次最多阅读网页">
                    <input
                      aria-label="每次最多阅读网页"
                      type="number"
                      min={1}
                      max={4}
                      required
                      value={pagesPerQuery}
                      onChange={(e) => setPagesPerQuery(Number(e.target.value))}
                    />
                  </Field>
                </div>
              )}
              <p className="muted small">
                补充材料截至开始写作时，最晚不超过比赛开球时间。无法核验的细节会删去或注明未知，搜索限制会保留在稿件记录中。
              </p>
            </div>
            <Field label="本次补充要求（选填）">
              <textarea
                rows={3}
                maxLength={3000}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="例如：开头用一个问题引入，结尾提醒阵容变化。"
              />
            </Field>
            {(error || materials.error || styles.error || providers.error) && (
              <ErrorBox
                message={
                  error || materials.error || styles.error || providers.error
                }
              />
            )}
            {user.role !== "viewer" ? (
              <Submit busy={busy}>开始写口播稿</Submit>
            ) : (
              <div className="notice">
                只读成员可以查看稿件；创建需要研究员或管理员权限。
              </div>
            )}
            <p className="muted small writing-boundary">
              研究资料与写作补搜分别保存。每次生成独立成稿，修改风格和知识库不会改变历史稿件。
            </p>
          </form>
        </section>
        <div className="writing-output">
          {selected ? (
            <Draft
              key={selected}
              id={selected}
              onClone={clone}
              onDeleted={() => {
                setParams(jobId ? { jobId } : {});
                void history.reload();
              }}
            />
          ) : (
            <section className="panel writing-welcome">
              <span className="writing-symbol">
                <PenLine size={28} />
              </span>
              <h2>资料就绪，表达由你决定。</h2>
              <p>
                研究与写作各有自己的任务记录。你可以为同一场比赛生成多种风格，每一版都有独立的证据快照和字数检查。
              </p>
              <div className="writing-steps">
                <span>01 选研究</span>
                <span>02 定风格与时长</span>
                <span>03 生成与复核</span>
              </div>
            </section>
          )}
        </div>
      </div>
      <section className="panel writing-history">
        <div className="panel-heading">
          <h2>稿件档案</h2>
          <span className="muted small">最近 200 个版本</span>
        </div>
        {history.error && (
          <ErrorBox message={history.error} retry={history.reload} />
        )}
        {history.loading ? (
          <Loading />
        ) : !history.data?.length ? (
          <Empty
            title="还没有口播稿"
            detail="研究结束后不会自动写稿。准备好时，选择资料并手动开始。"
          />
        ) : (
          <div className="writing-history-list">
            {history.data.map((r) => (
              <button
                key={r.id}
                className={
                  "writing-history-row " + (selected === r.id ? "selected" : "")
                }
                onClick={() =>
                  setParams({
                    run: r.id,
                    ...(r.job_id ? { jobId: r.job_id } : {}),
                  })
                }
              >
                <div>
                  <strong>{fixtureName(r.fixture)}</strong>
                  <span>
                    {r.styleName} ·{" "}
                    {r.durationMinutes
                      ? r.durationMinutes + " 分钟目标"
                      : "历史迁入"}{" "}
                    · {fmt(r.created_at)}
                  </span>
                </div>
                <div>
                  <span className={"badge " + r.status}>{names[r.status]}</span>
                  <span>{r.character_count} 字</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
function Draft({
  id,
  onClone,
  onDeleted,
}: {
  id: string;
  onClone: (r: any) => void;
  onDeleted: () => void;
}) {
  const {
    data: r,
    loading,
    error,
    reload,
  } = useLoad("/writing/runs/" + id, 2500);
  const [confirm, setConfirm] = useState(""),
    [busy, setBusy] = useState(false);
  const user = useAuth(),
    toast = useToast();
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} retry={reload} />;
  if (!r) return null;
  const supplement = r.progress.supplement;
  const evidence = [
    ...(r.input.evidence || []),
    ...(supplement?.evidence || []),
  ];
  const sources = [
    ...(r.input.sources || []),
    ...(supplement?.pages || [])
      .filter((p: any) => p.source)
      .map((p: any) => p.source),
  ];
  const running = ["queued", "running"].includes(r.status),
    own =
      user.role === "admin" ||
      (user.role === "researcher" && r.created_by === user.id);
  async function act() {
    setBusy(true);
    try {
      await api(
        "/writing/runs/" + id + (confirm === "cancel" ? "/cancel" : ""),
        confirm === "cancel" ? body({}) : { method: "DELETE" },
      );
      setConfirm("");
      if (confirm === "delete") onDeleted();
      else await reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel writing-draft">
      <div className="panel-heading">
        <div>
          <span className={"badge " + r.status}>{names[r.status]}</span>
          <h2>{r.progress.outline?.title || fixtureName(r.input.fixture)}</h2>
        </div>
        <div className="head-actions">
          {own && running && (
            <button className="btn small" onClick={() => setConfirm("cancel")}>
              <Square size={13} />
              取消
            </button>
          )}
          {user.role !== "viewer" && !r.input.legacy && (
            <button className="btn small" onClick={() => onClone(r)}>
              <RotateCcw size={13} />
              新建版本
            </button>
          )}
        </div>
      </div>
      <div className="writing-draft-meta">
        <span>{r.input.style.name}</span>
        <span>
          实际 {r.character_count} 字
          {r.input.target && " / 目标 " + r.input.target.target + " 字"}
        </span>
        <span>
          估计 {(r.character_count / r.input.charsPerMinute).toFixed(1)} 分钟
        </span>
      </div>
      <div className="writing-draft-body">
        {r.error && <ErrorBox message={r.error} />}
        {r.progress.issues?.length > 0 && (
          <div className="notice">
            <strong>需要复核</strong>
            <ul>
              {r.progress.issues.map((issue: string, i: number) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          </div>
        )}
        {r.content ? (
          <>
            <div className="writing-script">{r.content}</div>
            <p className="muted small">
              这是待人工复核的口播稿。模型审核不替代人工核查，发布前请确认事实、时效与表达。
            </p>
          </>
        ) : (
          <Empty
            title={running ? "正在准备稿件" : "还没有生成正文"}
            detail={
              running
                ? "队列独立运行；离开页面后继续。每段完成后会保存。"
                : "可保留此记录，调整设置后新建版本。"
            }
          />
        )}
        {r.content && (
          <div className="head-actions">
            {["txt", "md", "json"].map((f) => (
              <a
                key={f}
                className="btn small"
                href={"/api/writing/runs/" + id + "/export?format=" + f}
              >
                <Download size={13} />
                {f === "txt" ? "纯文本" : f === "md" ? "Markdown" : "证据快照"}
              </a>
            ))}
          </div>
        )}
        {r.input.supplementSearch && (
          <details className="writing-details" open={running}>
            <summary>
              写作补搜 · {supplement?.queries?.length || 0}/
              {r.input.maxSupplementQueries} 次查询 ·{" "}
              {supplement?.evidence?.length || 0} 条已核验证据
            </summary>
            <p className="muted small">
              补搜资料截至 {fmt(r.input.supplementCutoff)}
              。仅进入本篇稿件，不修改原研究报告。
            </p>
            {Object.entries(supplement?.checkpoints || {}).map(
              ([key, step]: [string, any]) => (
                <div key={key} className="writing-citation">
                  <strong>
                    {step.plan.needsSearch
                      ? "发现资料缺口"
                      : "资料足够，无需补搜"}
                  </strong>
                  <p>{step.plan.reason}</p>
                  {step.plan.gaps?.length > 0 && (
                    <p className="muted small">{step.plan.gaps.join("；")}</p>
                  )}
                </div>
              ),
            )}
            {supplement?.queries?.map((q: any) => (
              <div key={q.id} className="writing-citation">
                <strong>{q.query}</strong>
                <p>{q.intent}</p>
                <span className="muted small">
                  {(
                    {
                      searching: "搜索中",
                      reading: "阅读与核验中",
                      done: "已处理",
                      failed: "搜索失败",
                      interrupted: "已中断",
                    } as any
                  )[q.status] || q.status}{" "}
                  · 返回 {q.hitCount || 0} 条结果
                </span>
              </div>
            ))}
            {supplement?.pages
              ?.filter((p: any) => p.source)
              .map((p: any) => (
                <p key={p.id} className="small">
                  <a href={p.source.url} target="_blank" rel="noreferrer">
                    {p.source.title || p.source.domain}
                  </a>{" "}
                  · {p.source.status} ·{" "}
                  {p.source.published
                    ? fmt(p.source.published)
                    : "发布日期不明"}
                </p>
              ))}
            {supplement?.warnings?.length > 0 && (
              <div className="notice">
                <strong>补搜限制与未通过核验的材料</strong>
                <ul>
                  {supplement.warnings.map((w: string, i: number) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </details>
        )}
        <details className="writing-details">
          <summary>本次风格、知识库与证据快照</summary>
          <p>
            研究资料截至 {fmt(r.input.cutoff)} · 报告 {fmt(r.input.reportAt)}
          </p>
          <h4>角色指令</h4>
          <p className="prewrap">{r.input.style.instructions}</p>
          <h4>知识库（{r.input.knowledge?.length || 0}）</h4>
          {r.input.knowledge?.map((k: any) => (
            <details key={k.id}>
              <summary>{k.title}</summary>
              <p className="prewrap">{k.content}</p>
            </details>
          ))}
          {r.progress.paragraphs?.map((p: any, i: number) => (
            <details key={i}>
              <summary>
                第 {i + 1} 段 · {p.evidenceIds?.length || 0} 条证据
              </summary>
              {p.evidenceIds?.map((eid: string) => {
                const e = evidence.find((e: any) => e.id === eid),
                  s = sources.find((s: any) => s.id === e?.sourceId);
                return (
                  <div key={eid} className="writing-citation">
                    <strong>{e?.claim || eid}</strong>
                    <span className="muted small">
                      {e?.origin === "writing"
                        ? "写作补搜证据"
                        : "研究快照证据"}
                      {e?.limitation ? " · " + e.limitation : ""}
                    </span>
                    <blockquote>{e?.quote}</blockquote>
                    {s && (
                      <a href={s.url} target="_blank" rel="noreferrer">
                        {s.title || s.domain}
                      </a>
                    )}
                  </div>
                );
              })}
            </details>
          ))}
        </details>
        <details className="writing-details" open={running}>
          <summary>
            写作记录 · {r.model_calls} 次模型请求 · {r.tokens.toLocaleString()}{" "}
            tokens
          </summary>
          <div className="writing-events">
            {r.events?.map((e: any) => (
              <div key={e.id}>
                <span>{fmt(e.created_at)}</span>
                <p>{e.message}</p>
                {e.type === "thinking" && e.data && (
                  <p className="muted small">
                    {e.data.summary} ·{" "}
                    {e.data.observed
                      ? "上游返回思考标记"
                      : "上游未返回可观察的思考标记"}
                    {e.data.reasoningTokens != null
                      ? " · 思考 " + e.data.reasoningTokens + " tokens"
                      : ""}
                  </p>
                )}
              </div>
            ))}
          </div>
        </details>
        {own && !running && (
          <button
            className="btn small danger"
            onClick={() => setConfirm("delete")}
          >
            删除这个版本
          </button>
        )}
      </div>
      {confirm && (
        <Modal
          title={confirm === "cancel" ? "取消口播写作？" : "删除这个稿件版本？"}
          onClose={() => setConfirm("")}
        >
          <p>
            {confirm === "cancel"
              ? "已生成的段落和证据快照会保留。"
              : "此版本及其写作记录将永久删除，研究资料不受影响。"}
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setConfirm("")}>
              返回
            </button>
            <button disabled={busy} className="btn danger" onClick={act}>
              确认{confirm === "cancel" ? "取消" : "删除"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
