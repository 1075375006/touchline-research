import { useState, FormEvent } from "react";
import {
  Activity,
  ArrowRight,
  Check,
  ChevronRight,
  Cpu,
  ExternalLink,
  Globe2,
  KeyRound,
  LoaderCircle,
  Pencil,
  Plus,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Users,
  Zap,
} from "lucide-react";
import {
  api,
  body,
  useLoad,
  useToast,
  PageHead,
  Field,
  Submit,
  Modal,
  Empty,
  Loading,
  ErrorBox,
  fmt,
  useAuth,
} from "./lib";
const protocols: Record<string, { label: string; base: string; hint: string }> =
  {
    openai: {
      label: "OpenAI 兼容 · Chat Completions",
      base: "https://api.openai.com/v1",
      hint: "兼容 /chat/completions 的网关与模型；填写包含 /v1 的基础地址。",
    },
    responses: {
      label: "OpenAI · Responses",
      base: "https://api.openai.com/v1",
      hint: "使用 /responses 协议的模型。",
    },
    anthropic: {
      label: "Anthropic · Messages",
      base: "https://api.anthropic.com/v1",
      hint: "支持原生 Messages API 或兼容网关。",
    },
    gemini: {
      label: "Google Gemini · GenerateContent",
      base: "https://generativelanguage.googleapis.com/v1beta",
      hint: "支持原生 generateContent 协议。",
    },
    ollama: {
      label: "Ollama · 本地模型",
      base: "http://host.docker.internal:11434",
      hint: "无需 API Key。容器访问宿主机使用 host.docker.internal；本地开发可用 localhost。",
    },
  };
function ProviderModal({
  provider,
  onClose,
  onSaved,
}: {
  provider?: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState(provider?.type || "openai"),
    [base, setBase] = useState(provider?.baseUrl || protocols.openai.base),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const toast = useToast();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      await api(
        "/providers" + (provider ? "/" + provider.id : ""),
        body(
          {
            name: f.get("name"),
            type,
            baseUrl: base,
            model: f.get("model"),
            apiKey: f.get("apiKey") || undefined,
            enabled: f.get("enabled") === "on",
            maxTokens: Number(f.get("maxTokens")),
            timeoutSeconds: Number(f.get("timeoutSeconds")),
          },
          provider ? "PUT" : "POST",
        ),
      );
      toast("模型配置已保存");
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
      title={provider ? "编辑模型配置" : "连接一个分析模型"}
      subtitle="不要求模型原生联网或工具调用；Agent 自己执行搜索。"
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <Field label="配置名称">
          <input
            name="name"
            required
            maxLength={80}
            defaultValue={provider?.name}
            placeholder="例如：我的主力研究模型"
          />
        </Field>
        <Field label="接口协议">
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setBase(protocols[e.target.value].base);
            }}
          >
            {Object.entries(protocols).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="API 基础地址" hint={protocols[type].hint}>
          <input
            type="url"
            value={base}
            onChange={(e) => setBase(e.target.value)}
            required
          />
        </Field>
        <Field
          label="模型标识"
          hint="使用服务商提供的完整模型名称，不能填写产品订阅名称。"
        >
          <input
            name="model"
            defaultValue={provider?.model}
            required
            maxLength={150}
            placeholder="填写实际可用的模型 ID"
          />
        </Field>
        <Field
          label="API Key"
          hint={
            provider?.hasKey
              ? "密钥已加密保存；留空保持不变。"
              : "只保存在服务端；Ollama 或免鉴权私有网关可留空。"
          }
        >
          <input
            name="apiKey"
            type="password"
            autoComplete="new-password"
            placeholder={
              provider?.hasKey ? "已配置 · 留空保持" : "输入 API Key（如需）"
            }
          />
        </Field>
        <div className="form-grid">
          <Field label="单次输出上限（tokens）">
            <input
              name="maxTokens"
              type="number"
              min={512}
              max={32768}
              defaultValue={provider?.maxTokens || 4096}
              required
            />
          </Field>
          <Field label="请求超时（秒）">
            <input
              name="timeoutSeconds"
              type="number"
              min={10}
              max={600}
              defaultValue={provider?.timeoutSeconds || 180}
              required
            />
          </Field>
        </div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={provider?.enabled ?? true}
          />
          启用此模型
        </label>
        {error && <ErrorBox message={error} />}
        <div className="modal-actions">
          <button className="btn" type="button" onClick={onClose}>
            取消
          </button>
          <Submit busy={busy}>保存模型</Submit>
        </div>
      </form>
    </Modal>
  );
}
function ModelSettings() {
  const { data, loading, error, reload } = useLoad<any[]>("/providers"),
    [edit, setEdit] = useState<any>(null),
    [adding, setAdding] = useState(false),
    [testing, setTesting] = useState(""),
    [result, setResult] = useState<Record<string, string>>({}),
    [remove, setRemove] = useState<any>(null);
  const toast = useToast();
  async function test(id: string) {
    setTesting(id);
    try {
      const r = await api("/providers/" + id + "/test", body({}));
      setResult((old) => ({
        ...old,
        [id]: "连接成功 · " + (r.latency / 1000).toFixed(1) + " 秒",
      }));
      toast("模型连接与 JSON 输出测试通过");
    } catch (e) {
      setResult((old) => ({
        ...old,
        [id]: "测试失败：" + (e as Error).message,
      }));
      toast((e as Error).message, true);
    } finally {
      setTesting("");
    }
  }
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>模型连接</h2>
          <p>同一套研究流程，自由选择不同的模型服务。</p>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>
          <Plus size={16} />
          添加模型
        </button>
      </div>
      <div className="notice">
        <Cpu size={18} />
        <span>
          支持 OpenAI 兼容、Responses、Anthropic、Gemini 与
          Ollama。模型需要能遵循指令并输出 JSON；实际兼容性以连接测试为准。
        </span>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} retry={reload} />
      ) : !data?.length ? (
        <Empty
          title="先连接你的第一个模型"
          detail="普通对话模型即可参与研究，不需要订阅 Perplexity 或其他 AI 搜索服务。"
          action={
            <button className="btn" onClick={() => setAdding(true)}>
              <Plus size={15} />
              添加模型配置
            </button>
          }
        />
      ) : (
        <div className="provider-list">
          {data.map((p) => (
            <article className="provider-card" key={p.id}>
              <div className="provider-heading">
                <span className="provider-icon">
                  <Cpu size={23} />
                </span>
                <div className="grow">
                  <h3>{p.name}</h3>
                  <span>{protocols[p.type]?.label}</span>
                </div>
                <span className={"subtle-badge " + (p.enabled ? "green" : "")}>
                  {p.enabled ? "已启用" : "已停用"}
                </span>
              </div>
              <div className="provider-details">
                <div>
                  <small>模型</small>
                  <code>{p.model}</code>
                </div>
                <div>
                  <small>基础地址</small>
                  <span>{p.baseUrl}</span>
                </div>
                <div>
                  <small>密钥</small>
                  <span>
                    {p.hasKey ? "•••••••• 已加密" : "未配置 / 本地免密钥"}
                  </span>
                </div>
              </div>
              <div className="provider-bottom">
                <span
                  className={
                    result[p.id]?.startsWith("测试失败")
                      ? "text-error"
                      : "muted"
                  }
                >
                  {result[p.id] || "尚未在本次会话测试"}
                </span>
                <div>
                  <button
                    className="btn small"
                    disabled={!!testing || !p.enabled}
                    onClick={() => test(p.id)}
                  >
                    {testing === p.id ? (
                      <LoaderCircle className="spin" size={14} />
                    ) : (
                      <Zap size={14} />
                    )}
                    测试连接
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={"编辑 " + p.name}
                    onClick={() => setEdit(p)}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={"删除 " + p.name}
                    onClick={() => setRemove(p)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {(adding || edit) && (
        <ProviderModal
          provider={edit}
          onClose={() => {
            setAdding(false);
            setEdit(null);
          }}
          onSaved={reload}
        />
      )}{" "}
      {remove && (
        <Modal title="删除模型配置？" onClose={() => setRemove(null)}>
          <p>{remove.name} 的配置和密钥将被删除。有任务引用的模型只能停用。</p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setRemove(null)}>
              取消
            </button>
            <button
              className="btn danger"
              onClick={async () => {
                try {
                  await api("/providers/" + remove.id, { method: "DELETE" });
                  setRemove(null);
                  await reload();
                  toast("配置已删除");
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
    </>
  );
}
function SearchSettings({
  config,
  onSaved,
}: {
  config: any;
  onSaved: () => void;
}) {
  const [engine, setEngine] = useState(config.engine),
    [busy, setBusy] = useState(false),
    [testing, setTesting] = useState(false),
    [test, setTest] = useState<any>(null);
  const toast = useToast();
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      await api(
        "/settings/search",
        body(
          {
            engine,
            searxngUrl: f.get("searxngUrl"),
            engines: f.getAll("engines"),
            timeoutSeconds: Number(f.get("timeoutSeconds")),
            excludeDomains: String(f.get("excludeDomains"))
              .split(/[,\n]/)
              .map((s) => s.trim())
              .filter(Boolean),
            trustedDomains: String(f.get("trustedDomains"))
              .split(/[,\n]/)
              .map((s) => s.trim())
              .filter(Boolean),
          },
          "PUT",
        ),
      );
      toast("搜索设置已保存，新任务将使用此配置");
      onSaved();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>独立搜索引擎</h2>
          <p>搜索负责发现网页；分析模型只负责提出问题和理解证据。</p>
        </div>
      </div>
      <form onSubmit={save}>
        <div className="choice-grid">
          {[
            {
              id: "searchboost",
              name: "SearchBoost",
              tag: "免搜索密钥",
              desc: "聚合 Bing、DuckDuckGo、Yahoo，去重后读取网页原文。",
            },
            {
              id: "searxng",
              name: "SearXNG",
              tag: "自托管",
              desc: "通过 Docker 搜索服务汇聚结果，部署与数据都由你控制。",
            },
          ].map((x) => (
            <label
              className={"choice-card " + (engine === x.id ? "selected" : "")}
              key={x.id}
            >
              <input
                type="radio"
                name="engine"
                checked={engine === x.id}
                onChange={() => setEngine(x.id)}
              />
              <div>
                <strong>
                  {x.name}
                  <span>{x.tag}</span>
                </strong>
                <p>{x.desc}</p>
              </div>
            </label>
          ))}
        </div>
        <Field
          label="SearXNG 地址"
          hint="使用附带 Compose 服务时为 http://searxng:8080；需启用 JSON 输出。"
        >
          <input
            name="searxngUrl"
            type="url"
            defaultValue={config.searxngUrl}
          />
        </Field>
        <div className="field">
          <span>SearchBoost 免费引擎</span>
          <div className="checkbox-group">
            {[
              ["bing", "Bing"],
              ["ddg", "DuckDuckGo"],
              ["yahoo", "Yahoo"],
            ].map(([id, label]) => (
              <label className="checkbox-row" key={id}>
                <input
                  type="checkbox"
                  name="engines"
                  value={id}
                  defaultChecked={config.engines.includes(id)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
        <div className="form-grid">
          <Field
            label="可信来源域名"
            hint="每行一个域名。信任级别不替代原文和时效核验。"
          >
            <textarea
              name="trustedDomains"
              rows={5}
              defaultValue={config.trustedDomains.join("\n")}
            />
          </Field>
          <Field label="排除来源域名" hint="每行一个域名，同时排除其子域名。">
            <textarea
              name="excludeDomains"
              rows={5}
              defaultValue={config.excludeDomains.join("\n")}
              placeholder="填写不希望采集的站点"
            />
          </Field>
        </div>
        <Field label="单次搜索 / 读取超时（秒）">
          <input
            name="timeoutSeconds"
            type="number"
            min={10}
            max={90}
            required
            defaultValue={config.timeoutSeconds}
          />
        </Field>
        <div className="form-footer">
          <span>免费引擎可能限流或返回验证页；系统会记录真实错误。</span>
          <Submit busy={busy}>
            <Save size={16} />
            保存搜索配置
          </Submit>
        </div>
      </form>
      <div className="diagnostic">
        <h3>
          <Activity size={18} />
          搜索连通性诊断
        </h3>
        <p>使用已保存的配置测试，直接检查实际返回的网页结果。</p>
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setTesting(true);
            setTest(null);
            const f = new FormData(e.currentTarget);
            try {
              setTest(
                await api("/search/test", body({ query: f.get("query") })),
              );
            } catch (e) {
              toast((e as Error).message, true);
            } finally {
              setTesting(false);
            }
          }}
        >
          <input
            name="query"
            aria-label="测试搜索词"
            required
            defaultValue="UEFA official football fixtures"
          />
          <Submit busy={testing}>测试搜索</Submit>
        </form>
        {test && (
          <div className="test-result">
            <strong>
              {test.ok
                ? "找到 " + test.hits.length + " 条结果"
                : "未找到可用结果"}{" "}
              · {(test.latency / 1000).toFixed(1)} 秒
            </strong>
            {test.warnings?.length > 0 && (
              <p className="text-error">{test.warnings.join("；")}</p>
            )}
            {test.hits.map((h: any) => (
              <a key={h.url} href={h.url} target="_blank" rel="noreferrer">
                {h.title}
                <ExternalLink size={13} />
              </a>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
function ResearchSettings({
  config,
  onSaved,
}: {
  config: any;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const fields = [
    ["maxQueries", "总搜索预算", 40, 400, "所有阶段和逐场指标共享预算。"],
    [
      "resultsPerQuery",
      "每次搜索读取来源数",
      2,
      8,
      "控制正文读取量与模型上下文。",
    ],
    ["followups", "每阶段定向追问", 1, 3, "每阶段至少一次审计和一次补搜。"],
    [
      "criticalMatches",
      "关键比赛深挖数量",
      1,
      6,
      "优先覆盖两队，每场检索38项指标。",
    ],
    ["concurrency", "后台并行任务数", 1, 3, "避免同时启动过多模型和搜索请求。"],
    ["maxModelCalls", "模型调用预算", 30, 200, "限制单个研究任务的模型请求。"],
    [
      "maxRunMinutes",
      "单次运行时限（分钟）",
      10,
      240,
      "达到上限保留检查点与受限报告。",
    ],
  ];
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>研究规则与预算</h2>
          <p>预算控制深度。证据不足时保留未知，不填补不存在的事实。</p>
        </div>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const f = new FormData(e.currentTarget);
          try {
            const values: any = {
              customInstructions: f.get("customInstructions"),
            };
            fields.forEach(([k]) => (values[k] = Number(f.get(String(k)))));
            await api("/settings/research", body(values, "PUT"));
            toast("研究设置已保存");
            onSaved();
          } catch (e) {
            toast((e as Error).message, true);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          {fields.map(([key, label, min, max, hint]) => (
            <Field key={key} label={String(label)} hint={String(hint)}>
              <input
                name={String(key)}
                type="number"
                min={min}
                max={max}
                defaultValue={config[key]}
                required
              />
            </Field>
          ))}
        </div>
        <Field
          label="附加研究要求"
          hint="作为研究偏好传给模型；不覆盖来源核验、反证检查与未知披露。"
        >
          <textarea
            name="customInstructions"
            rows={4}
            maxLength={4000}
            defaultValue={config.customInstructions}
            placeholder="例如：重点核查发布会和本地媒体。优先使用官方来源。"
          />
        </Field>
        <div className="notice">
          <ShieldCheck size={18} />
          <span>
            固定流程包括全景选题、10
            个研究阶段和经营稳定性模块。已有任务保存创建时的预算与搜索配置；修改配置只影响新任务，并行数量立即生效。
          </span>
        </div>
        <div className="form-footer">
          <span>调用量与 token 以服务端记录为准，不估算费用。</span>
          <Submit busy={busy}>
            <Save size={16} />
            保存研究规则
          </Submit>
        </div>
      </form>
    </>
  );
}
function FeedSettings({
  config,
  onSaved,
}: {
  config: any;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState(config.mode),
    [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>比赛数据源</h2>
          <p>沿用红黑记录的比赛结构，或者直接读取体彩竞彩列表。</p>
        </div>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const f = new FormData(e.currentTarget);
          try {
            await api(
              "/settings/fixtures",
              body({ mode, redBlackUrl: f.get("redBlackUrl") }, "PUT"),
            );
            toast("比赛数据源已保存");
            onSaved();
          } catch (e) {
            toast((e as Error).message, true);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="读取方式">
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="sporttery">直接读取体彩公开比赛接口</option>
            <option value="redblack">连接已有红黑记录实例</option>
          </select>
        </Field>
        <Field
          label="红黑记录基础地址"
          hint="系统调用此地址的 /api/matches。只读取比赛，不更改原项目的数据。"
        >
          <input
            name="redBlackUrl"
            type="url"
            required={mode === "redblack"}
            defaultValue={config.redBlackUrl}
            placeholder="http://host.docker.internal:4399"
          />
        </Field>
        <div className="notice">
          <Globe2 size={18} />
          <span>
            体彩接口可能限制海外出口。可连接能访问体彩的红黑记录实例；手动录入和
            JSON 导入始终可用。
          </span>
        </div>
        <div className="form-footer">
          <span>保存后，在比赛中心点击「同步比赛」。</span>
          <Submit busy={busy}>保存数据源</Submit>
        </div>
      </form>
    </>
  );
}
export function Settings() {
  const [tab, setTab] = useState("models");
  const { data, loading, error, reload } = useLoad("/settings");
  return (
    <>
      <PageHead
        eyebrow="CONTROL CENTER"
        title="系统配置"
        description="管理模型、搜索和研究规则。让同一套 Agent 适配你的运行环境。"
      />
      <div className="settings-layout">
        <nav className="settings-nav">
          {[
            { id: "models", label: "分析模型", icon: Cpu },
            { id: "search", label: "搜索引擎", icon: Globe2 },
            { id: "research", label: "研究规则", icon: SlidersHorizontal },
            { id: "fixtures", label: "比赛数据源", icon: Settings2 },
          ].map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "active" : ""}
              onClick={() => setTab(t.id)}
            >
              <t.icon size={18} />
              {t.label}
              <ChevronRight size={15} />
            </button>
          ))}
        </nav>
        <section className="panel settings-content">
          {loading ? (
            <Loading />
          ) : error ? (
            <ErrorBox message={error} retry={reload} />
          ) : tab === "models" ? (
            <ModelSettings />
          ) : tab === "search" ? (
            <SearchSettings
              key={"search-" + JSON.stringify(data.search)}
              config={data.search}
              onSaved={reload}
            />
          ) : tab === "research" ? (
            <ResearchSettings
              key={"research-" + JSON.stringify(data.research)}
              config={data.research}
              onSaved={reload}
            />
          ) : (
            <FeedSettings
              key={"fixtures-" + JSON.stringify(data.fixtures)}
              config={data.fixtures}
              onSaved={reload}
            />
          )}
        </section>
      </div>
    </>
  );
}
function UserModal({
  user,
  onClose,
  onSaved,
}: {
  user: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const toast = useToast();
  return (
    <Modal
      title={user ? "编辑成员" : "添加成员"}
      subtitle="角色变化、禁用或重置密码会撤销该账户的现有会话。"
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const f = new FormData(e.currentTarget);
          try {
            const values: any = {
              role: f.get("role"),
              enabled: f.get("enabled") === "on",
              ...(f.get("password") ? { password: f.get("password") } : {}),
            };
            if (!user) values.username = f.get("username");
            await api(
              "/users" + (user ? "/" + user.id : ""),
              body(values, user ? "PATCH" : "POST"),
            );
            toast("成员已保存");
            onSaved();
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {!user && (
          <Field label="用户名">
            <input
              name="username"
              required
              minLength={3}
              maxLength={40}
              pattern="[a-zA-Z0-9_.-]+"
              placeholder="字母、数字、下划线或连字符"
            />
          </Field>
        )}
        <Field label="权限角色">
          <select name="role" defaultValue={user?.role || "researcher"}>
            <option value="admin">管理员 · 配置与所有任务</option>
            <option value="researcher">研究员 · 创建与管理自己的任务</option>
            <option value="viewer">只读成员 · 查看共享研究成果</option>
          </select>
        </Field>
        <Field
          label={user ? "重置密码（留空不修改）" : "初始密码"}
          hint="至少 12 个字符。"
        >
          <input
            type="password"
            name="password"
            required={!user}
            minLength={12}
            autoComplete="new-password"
          />
        </Field>
        <label className="checkbox-row">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={user?.enabled ?? true}
          />
          启用账户
        </label>
        {error && <ErrorBox message={error} />}
        <div className="modal-actions">
          <button className="btn" type="button" onClick={onClose}>
            取消
          </button>
          <Submit busy={busy}>保存成员</Submit>
        </div>
      </form>
    </Modal>
  );
}
export function UsersPage() {
  const { data, loading, error, reload } = useLoad<any[]>("/users"),
    [adding, setAdding] = useState(false),
    [edit, setEdit] = useState<any>(null);
  return (
    <>
      <PageHead
        eyebrow="TEAM & ACCESS"
        title="成员与权限"
        description="同一个研究空间，按角色分配操作权限。研究成果在成员间共享。"
        actions={
          <button className="btn primary" onClick={() => setAdding(true)}>
            <Plus size={16} />
            添加成员
          </button>
        }
      />
      <section className="panel">
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox message={error} retry={reload} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>成员</th>
                  <th>角色</th>
                  <th>状态</th>
                  <th>创建时间</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data?.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="user-cell">
                        <span className="avatar">
                          {u.username.slice(0, 1).toUpperCase()}
                        </span>
                        <strong>{u.username}</strong>
                      </div>
                    </td>
                    <td>
                      {
                        (
                          {
                            admin: "管理员",
                            researcher: "研究员",
                            viewer: "只读成员",
                          } as any
                        )[u.role]
                      }
                    </td>
                    <td>
                      <span
                        className={"subtle-badge " + (u.enabled ? "green" : "")}
                      >
                        {u.enabled ? "已启用" : "已禁用"}
                      </span>
                    </td>
                    <td className="muted">{fmt(u.createdAt)}</td>
                    <td>
                      <button className="btn small" onClick={() => setEdit(u)}>
                        <Pencil size={14} />
                        编辑
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {(adding || edit) && (
        <UserModal
          user={edit}
          onClose={() => {
            setAdding(false);
            setEdit(null);
          }}
          onSaved={reload}
        />
      )}
    </>
  );
}
export function AuditPage() {
  const { data, loading, error, reload } = useLoad<any[]>("/audit", 10000);
  return (
    <>
      <PageHead
        eyebrow="AUDIT TRAIL"
        title="操作日志"
        description="记录账户、配置、比赛与研究任务的关键管理操作。日志不包含密钥。"
      />
      <section className="panel">
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox message={error} retry={reload} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>操作人</th>
                  <th>操作</th>
                  <th>详情</th>
                </tr>
              </thead>
              <tbody>
                {data?.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap muted">{fmt(r.created_at)}</td>
                    <td>{r.username || "系统"}</td>
                    <td>
                      <code>{r.action}</code>
                    </td>
                    <td>{r.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="footnote">
        显示最近 300 条操作日志；研究中的搜索过程请到对应任务查看。
      </p>
    </>
  );
}
export function Account({ onChanged }: { onChanged: () => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const user = useAuth(),
    toast = useToast();
  return (
    <>
      <PageHead
        eyebrow="MY ACCOUNT"
        title="账户设置"
        description={"当前登录：" + user.username}
      />
      <section className="panel narrow settings-content">
        <div className="section-heading">
          <div>
            <h2>修改登录密码</h2>
            <p>更新密码后，所有设备会话将退出。</p>
          </div>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const f = new FormData(e.currentTarget);
            if (f.get("newPassword") !== f.get("confirm")) {
              setError("两次新密码不一致");
              setBusy(false);
              return;
            }
            try {
              await api("/auth/password", body(Object.fromEntries(f)));
              toast("密码已更新，请重新登录");
              onChanged();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="当前密码">
            <input
              type="password"
              name="oldPassword"
              autoComplete="current-password"
              required
            />
          </Field>
          <Field label="新密码">
            <input
              type="password"
              name="newPassword"
              autoComplete="new-password"
              minLength={12}
              maxLength={200}
              required
            />
          </Field>
          <Field label="确认新密码">
            <input
              type="password"
              name="confirm"
              autoComplete="new-password"
              minLength={12}
              required
            />
          </Field>
          {error && <ErrorBox message={error} />}
          <div className="form-footer">
            <span>至少 12 个字符</span>
            <Submit busy={busy}>更新密码</Submit>
          </div>
        </form>
      </section>
    </>
  );
}
