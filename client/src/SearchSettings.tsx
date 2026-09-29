import { FormEvent, useState } from "react";
import { Activity, ExternalLink, Save } from "lucide-react";
import { api, body, Field, Submit, useToast } from "./lib";
const providers = ["tavily", "brave", "exa", "anysearch"];
const engines = ["bing", "ddg", "yahoo", "exa-free", "anysearch"];
const names: Record<string, string> = {
  tavily: "Tavily",
  brave: "Brave Search",
  exa: "Exa",
  anysearch: "AnySearch",
  bing: "Bing",
  ddg: "DuckDuckGo",
  yahoo: "Yahoo",
  "exa-free": "Exa 免费",
};
const examples: Record<string, any> = {
  fused_search: { query: "UEFA official football fixtures", max_results: 6 },
  fetch_page: { url: "https://www.uefa.com/" },
  x_search: {
    type: "keyword",
    query: "football injury team news",
    max_results: 5,
  },
  adaptive_search: {
    questions: ["这场比赛双方有哪些已确认的伤停和轮换信息？"],
    intent: "优先官方来源，保留相反信息。",
    keywords: ["伤停", "轮换"],
    constraints: [],
    page_size: 20,
  },
  search_stats: {},
  search_layer: { layer: "show" },
  clear_cache: {},
};
const toolNames: Record<string, string> = {
  fused_search: "融合搜索",
  fetch_page: "正文读取",
  x_search: "X 平台搜索",
  adaptive_search: "Jev 主动搜索",
  search_stats: "能力 / 统计 / 缓存",
  search_layer: "查看或切换兼容层",
  clear_cache: "清空当前搜索缓存",
};
const help: Record<string, string> = {
  fused_search:
    "支持 queries、engines、engine_pool、ranking、engine_weights、complexity、community、include_domains、exclude_domains、recency、min_score、max_results。",
  fetch_page:
    "url 必填；focus 可选，按关键词提取段落。focus 未命中不代表页面没有信息。",
  x_search:
    "type 支持 keyword / semantic / user / thread。分别填写 query、username 或 post_id；支持 from_date、to_date、allowed_x_handles、excluded_x_handles、max_results。",
  adaptive_search:
    "新版恰好一个 questions 问题；支持 intent、keywords、constraints、page_size。返回 nextCursor 后可继续分页，不重复发起搜索。",
  search_stats:
    "只读取当前配置就绪状态与本进程统计，不等于外部服务连通性测试。",
  search_layer:
    "layer=show 只读；free 或 api 会保存配置。原生 api 兼容层对应 hybrid 引擎池；仅付费池请在上方选择 api。",
  clear_cache:
    "清除当前配置的内存搜索、正文、X 和 Jev 分页缓存，不删除研究记录。",
};
const lines = (v: string) =>
  v
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);
export default function SearchSettings({
  config,
  onSaved,
}: {
  config: any;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<any>(() => structuredClone(config));
  const [weights, setWeights] = useState(
    JSON.stringify(config.engineWeights || {}, null, 2),
  );
  const [lists, setLists] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      [
        "includeDomains",
        "excludeDomains",
        "trustedDomains",
        "keywords",
        "constraints",
      ].map((k) => [
        k,
        (k === "keywords" || k === "constraints"
          ? config.jev[k]
          : config[k]
        ).join("\n"),
      ]),
    ),
  );
  const [busy, setBusy] = useState(false),
    [testing, setTesting] = useState(false),
    [test, setTest] = useState<any>(null);
  const [tool, setTool] = useState("fused_search"),
    [input, setInput] = useState(
      JSON.stringify(examples.fused_search, null, 2),
    );
  const [running, setRunning] = useState(false),
    [result, setResult] = useState<any>(null),
    [toolError, setToolError] = useState("");
  const toast = useToast();
  const set = (path: string, value: any) =>
    setDraft((old: any) => {
      const next = structuredClone(old);
      const parts = path.split(".");
      let item = next;
      for (const part of parts.slice(0, -1)) item = item[part];
      item[parts.at(-1)!] = value;
      if (path === "enginePool" && next.engine !== "searxng")
        next.engine = value === "free" ? "searchboost" : "searchboost-api";
      return next;
    });
  const text = (path: string, value: string, props: any = {}) => (
    <input
      value={value || ""}
      onChange={(e) => set(path, e.target.value)}
      {...props}
    />
  );
  const number = (path: string, value: number, min: number, max: number) => (
    <input
      type="number"
      required
      min={min}
      max={max}
      value={value}
      onChange={(e) => set(path, Number(e.target.value))}
    />
  );
  const select = (path: string, value: string, choices: [string, string][]) => (
    <select value={value} onChange={(e) => set(path, e.target.value)}>
      {choices.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
  const check = (path: string, value: boolean, label: string) => (
    <label className="checkbox-row">
      <input
        type="checkbox"
        checked={!!value}
        onChange={(e) => set(path, e.target.checked)}
      />
      {label}
    </label>
  );
  const secret = (path: string, c: any) => (
    <>
      <Field
        label="API Key"
        hint={
          c.hasKey
            ? "已加密保存；留空保留原密钥。"
            : "密钥仅保存在服务端，不进入报告或模型提示。"
        }
      >
        {text(path + ".apiKey", c.apiKey, {
          type: "password",
          autoComplete: "new-password",
          placeholder: c.hasKey ? "已保存，留空不修改" : "输入 API Key",
        })}
      </Field>
      {c.hasKey && check(path + ".removeKey", c.removeKey, "移除当前配置密钥")}
    </>
  );
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(
        "/settings/search",
        body(
          {
            ...draft,
            includeDomains: lines(lists.includeDomains),
            excludeDomains: lines(lists.excludeDomains),
            trustedDomains: lines(lists.trustedDomains),
            jev: {
              ...draft.jev,
              keywords: lines(lists.keywords),
              constraints: lines(lists.constraints),
            },
            engineWeights: JSON.parse(weights || "{}"),
          },
          "PUT",
        ),
      );
      setDraft((old: any) => {
        const next = structuredClone(old);
        for (const item of [
          ...Object.values(next.apiProviders),
          next.jev,
          next.x,
        ] as any[]) {
          if (item.apiKey) item.hasKey = true;
          if (item.removeKey) item.hasKey = false;
          delete item.apiKey;
          delete item.removeKey;
        }
        return next;
      });
      toast("搜索配置已保存，新任务使用此配置");
      onSaved();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function run(payload?: any) {
    setRunning(true);
    setResult(null);
    setToolError("");
    try {
      const value = await api(
        "/search/tools",
        body({ tool, input: payload ?? JSON.parse(input) }),
      );
      setResult(value);
      if (
        tool === "search_layer" &&
        (payload ?? JSON.parse(input)).layer !== "show"
      )
        onSaved();
    } catch (e) {
      setToolError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>搜索引擎与第三方 API</h2>
          <p>
            SearchBoost 0.2.4-beta.2 · 搜索、Jev 筛选与报告分析模型独立配置。
          </p>
        </div>
      </div>
      <form onSubmit={save}>
        <div className="choice-grid search-modes">
          {[
            [
              "searchboost",
              "免费搜索",
              "免密钥",
              "Bing、DuckDuckGo、Yahoo、Exa-free、AnySearch。",
            ],
            [
              "searchboost-api",
              "第三方搜索 API",
              "API / 混合",
              "Tavily、Brave、Exa、AnySearch，支持兼容网关。",
            ],
            ["searxng", "SearXNG", "自托管", "保留独立 Docker 搜索服务接入。"],
          ].map(([id, name, tag, desc]) => (
            <label
              className={
                "choice-card " + (draft.engine === id ? "selected" : "")
              }
              key={id}
            >
              <input
                type="radio"
                name="searchMode"
                checked={draft.engine === id}
                onChange={() => {
                  set("engine", id);
                  if (id === "searchboost") set("enginePool", "free");
                  if (id === "searchboost-api") set("enginePool", "api");
                }}
              />
              <div>
                <strong>
                  {name}
                  <span>{tag}</span>
                </strong>
                <p>{desc}</p>
              </div>
            </label>
          ))}
        </div>
        {draft.engine === "searxng" ? (
          <Field
            label="SearXNG 地址"
            hint="仅比赛研究的搜索走 SearXNG；下方工具实验室使用 SearchBoost 原生工具。"
          >
            {text("searxngUrl", draft.searxngUrl, {
              type: "url",
              required: true,
            })}
          </Field>
        ) : (
          <div className="form-grid">
            <Field label="引擎池">
              {select("enginePool", draft.enginePool, [
                ["free", "free · 只用免费引擎"],
                ["api", "api · 只用已配置 API"],
                ["hybrid", "hybrid · 免费与 API 混合"],
              ])}
            </Field>
            <Field label="研究任务的搜索策略">
              {select("strategy", draft.strategy, [
                ["fused", "融合搜索 → 研究 Agent 主动追问"],
                ["adaptive", "Jev 主动筛选 → 研究 Agent 核验"],
              ])}
            </Field>
          </div>
        )}
        <div className="field">
          <span>免费引擎选择</span>
          <div className="checkbox-group">
            {engines.map((name) => (
              <label className="checkbox-row" key={name}>
                <input
                  type="checkbox"
                  checked={draft.engines.includes(name)}
                  onChange={(e) =>
                    set(
                      "engines",
                      e.target.checked
                        ? [...draft.engines, name]
                        : draft.engines.filter((n: string) => n !== name),
                    )
                  }
                />
                {names[name]}
              </label>
            ))}
          </div>
        </div>
        <div className="section-heading">
          <div>
            <h3>第三方搜索 API</h3>
            <p>
              Base URL 填基础地址，自动追加搜索路径。AnySearch 在 free
              池匿名，在 api 池需要密钥。
            </p>
          </div>
        </div>
        <div className="search-provider-grid">
          {providers.map((name) => {
            const c = draft.apiProviders[name],
              path = "apiProviders." + name;
            return (
              <section className="search-provider-card" key={name}>
                <h3>{names[name]}</h3>
                {check(path + ".enabled", c.enabled, "允许使用此 API")}
                <Field
                  label="API 基础地址"
                  hint={
                    name === "brave"
                      ? "自动追加 /web/search"
                      : "自动追加 /search；保留网关路径前缀"
                  }
                >
                  {text(path + ".baseUrl", c.baseUrl, {
                    type: "url",
                    required: true,
                  })}
                </Field>
                {secret(path, c)}
              </section>
            );
          })}
        </div>
        <details
          className="search-advanced"
          open={draft.strategy === "adaptive" ? true : undefined}
        >
          <summary>Jev 智能筛选与主动续搜 · 实验功能</summary>
          <p>
            Jev 是专用评估接口，不是普通 Chat Completions 模型。支持 TypeSafe 与
            Vercel AI
            Gateway；它从已就绪的原生引擎中选择搜索，可能使用已启用的付费
            API。方向用于判断阅读价值，不要求材料同意方向。
          </p>
          {check("jev.enabled", draft.jev.enabled, "启用 Jev 第三方评估服务")}
          <div className="form-grid">
            <Field
              label="Jev 基础地址"
              hint="https://api.typesafe.ai/v1 或 https://ai-gateway.vercel.sh/v1，也支持兼容 TypeSafe 的网关。"
            >
              {text("jev.baseUrl", draft.jev.baseUrl, {
                type: "url",
                required: true,
              })}
            </Field>
            <Field label="单次 Jev 主动搜索上限（秒）">
              {number("jev.timeoutSeconds", draft.jev.timeoutSeconds, 30, 600)}
            </Field>
          </div>
          {secret("jev", draft.jev)}
          <Field label="Jev 搜索意图">
            <textarea
              rows={3}
              value={draft.jev.intent}
              onChange={(e) => set("jev.intent", e.target.value)}
            />
          </Field>
          <div className="form-grid">
            <Field
              label="关注点 keywords"
              hint="最多 8 项，每行一项；留空由 Jev 拆解当前问题。"
            >
              <textarea
                rows={3}
                value={lists.keywords}
                onChange={(e) =>
                  setLists({ ...lists, keywords: e.target.value })
                }
              />
            </Field>
            <Field
              label="硬条件 constraints"
              hint="最多 8 项；只填必须满足的客观条件，不能填写必须支持方向。"
            >
              <textarea
                rows={3}
                value={lists.constraints}
                onChange={(e) =>
                  setLists({ ...lists, constraints: e.target.value })
                }
              />
            </Field>
          </div>
          <p>
            检索分数收敛不代表事实已核实。每次主动搜索可能包含多轮检索与 Jev
            请求；研究总预算计入口调用次数，服务商内部请求可能另行计费。
          </p>
        </details>
        <details className="search-advanced">
          <summary>X 搜索与社区信息</summary>
          <p>
            可填写 xAI API Key
            使用官方路径，留空使用原生匿名回退。支持关键词、语义、用户时间线、讨论串；结果仍需核验，不能代表全平台意见。
          </p>
          {secret("x", draft.x)}
          {check("community", draft.community, "在融合搜索中混入 X 社区结果")}
        </details>
        <details className="search-advanced">
          <summary>排序、时效、域名、正文读取与工具开关</summary>
          <div className="form-grid">
            <Field label="排序预设">
              {select("ranking", draft.ranking, [
                ["balanced", "均衡 balanced"],
                ["research", "深度 research"],
                ["fresh", "时效 fresh"],
              ])}
            </Field>
            <Field label="查询复杂度">
              {select("complexity", draft.complexity, [
                ["simple", "simple · 1 个变体"],
                ["medium", "medium · 最多 2 个"],
                ["complex", "complex · 最多 3 个"],
              ])}
            </Field>
            <Field
              label="时效偏好"
              hint="部分引擎支持；不是严格日期核验。历史研究请选择不限。"
            >
              {select("recency", draft.recency, [
                ["", "不限"],
                ["day", "一天"],
                ["week", "一周"],
                ["month", "一个月"],
                ["year", "一年"],
              ])}
            </Field>
            <Field label="候选结果上限" hint="实际读取数量仍由研究规则控制。">
              {number("maxResults", draft.maxResults, 1, 20)}
            </Field>
            <Field label="单次检索 / 读取超时（秒）">
              {number("timeoutSeconds", draft.timeoutSeconds, 10, 120)}
            </Field>
            <Field
              label="最低融合评分"
              hint="评分不是概率，默认 0；过高可能过滤全部结果。"
            >
              {number("minScore", draft.minScore, 0, 100)}
            </Field>
            <Field label="搜索深度">
              {select("depth", draft.depth, [
                ["", "由复杂度决定"],
                ["basic", "basic"],
                ["advanced", "advanced"],
              ])}
            </Field>
            <Field
              label="正文读取方式"
              hint="SearchBoost 先读原站，失败时可通过 Jina Reader。"
            >
              {select("reader", draft.reader, [
                ["direct", "本地 HTML / 纯文本读取"],
                ["searchboost", "SearchBoost fetch_page"],
              ])}
            </Field>
            {[
              ["includeDomains", "限制来源域名"],
              ["excludeDomains", "排除来源域名"],
              ["trustedDomains", "可信来源域名"],
            ].map(([key, label]) => (
              <Field
                label={label}
                key={key}
                hint="每行一个域名。可信标记不代替原文核验。"
              >
                <textarea
                  rows={4}
                  value={lists[key]}
                  onChange={(e) =>
                    setLists({ ...lists, [key]: e.target.value })
                  }
                />
              </Field>
            ))}
            <Field
              label="引擎权重 JSON"
              hint='例如 {"tavily":1.2,"brave":1}；留 {} 使用预设。权重不负责启用引擎。'
            >
              <textarea
                rows={4}
                value={weights}
                onChange={(e) => setWeights(e.target.value)}
              />
            </Field>
          </div>
          <div className="checkbox-group">
            {Object.keys(draft.tools).map((name) => (
              <span key={name}>
                {check("tools." + name, draft.tools[name], toolNames[name])}
              </span>
            ))}
          </div>
          <p>
            开关控制工具入口；已启用 Jev
            可执行其内部检索，融合搜索的社区模式也可使用内部 X 检索。
          </p>
        </details>
        <div className="form-footer">
          <span>
            只修改新任务配置，已有任务保留自己的参数和凭据版本。付费 API
            按服务商规则计费。
          </span>
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
        <p>使用已保存配置测试，真实调用所选服务。</p>
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
              {test.ok ? "找到 " + test.hits.length + " 条结果" : "未找到结果"}{" "}
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
            {test.diagnostics && (
              <details>
                <summary>引擎状态与筛选诊断</summary>
                <pre className="search-json">
                  {JSON.stringify(test.diagnostics, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}
      </div>
      <div className="diagnostic">
        <h3>SearchBoost 原生工具实验室</h3>
        <p>
          提供四个检索工具、状态、缓存和兼容层功能。请求使用已保存配置，API
          调用可能计费。
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <Field label="选择工具">
            <select
              value={tool}
              onChange={(e) => {
                setTool(e.target.value);
                setInput(JSON.stringify(examples[e.target.value], null, 2));
                setResult(null);
                setToolError("");
              }}
            >
              {Object.entries(toolNames).map(([id, name]) => (
                <option key={id} value={id}>
                  {name} · {id}
                </option>
              ))}
            </select>
          </Field>
          <p>{help[tool]}</p>
          <Field label="工具参数 JSON">
            <textarea
              className="search-json-input"
              rows={8}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              spellCheck={false}
            />
          </Field>
          <Submit busy={running}>执行工具</Submit>
        </form>
        {toolError && (
          <p className="text-error" role="alert">
            {toolError}
          </p>
        )}
        {result && (
          <>
            <pre className="search-json" aria-label="工具运行结果">
              {JSON.stringify(result, null, 2)}
            </pre>
            {tool === "adaptive_search" && result.result?.nextCursor && (
              <button
                className="btn"
                disabled={running}
                onClick={() =>
                  run({ cursor: result.result.nextCursor, page_size: 20 })
                }
              >
                读取下一页（不重复搜索）
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}
