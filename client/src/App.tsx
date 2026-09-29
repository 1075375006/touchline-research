import { Writing } from "./writing/Writing";
import { WritingStyles } from "./writing/Styles";
import { useEffect, useState, FormEvent } from "react";
import { Routes, Route, NavLink, useLocation } from "react-router-dom";
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  FileText,
  Globe2,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings2,
  ShieldCheck,
  Users,
  Waypoints,
  X,
} from "lucide-react";
import {
  api,
  body,
  AuthContext,
  useLoad,
  Loading,
  ToastProvider,
  useToast,
  Field,
  Submit,
  ErrorBox,
} from "./lib";
import { Dashboard, Matches } from "./Workspace";
import { Jobs, JobDetail, Reports, EvidencePage } from "./Research";
import { Settings, UsersPage, AuditPage, Account } from "./Settings";
function Login({
  initialized,
  onLogin,
}: {
  initialized: boolean;
  onLogin: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (!initialized) await api("/auth/setup", body(values));
      await api("/auth/login", body(values));
      onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-screen">
      <div className="auth-story">
        <div className="brand">
          <span className="brand-mark">
            <Waypoints size={25} />
          </span>
          <span>
            边线情报<small>TOUCHLINE RESEARCH</small>
          </span>
        </div>
        <div className="auth-story-content">
          <span className="pill">独立搜索 · 自主研究 · 证据可追溯</span>
          <h1>
            每一个方向，
            <br />
            都有据可查。
          </h1>
          <p>
            从一场比赛、一个判断出发。让 Agent
            找到信息、追问缺口，把纷杂的线索变成一份可信的报告。
          </p>
          <div className="pitch">
            <div className="pitch-center" />
            <span className="pitch-dot one" />
            <span className="pitch-dot two" />
            <span className="pitch-dot three" />
            <div className="pitch-note">
              <ShieldCheck size={16} /> 观点可以改变，证据不能编造。
            </div>
          </div>
        </div>
        <small>YOUR MODEL. YOUR RESEARCH. YOUR CONTROL.</small>
      </div>
      <div className="auth-form">
        <div className="auth-form-inner">
          <span className="eyebrow">RESEARCH WORKSPACE</span>
          <h2>{initialized ? "欢迎回到边线" : "建立你的研究工作台"}</h2>
          <p>
            {initialized
              ? "登录后继续你的比赛研究。"
              : "首次使用，创建一个管理员账户。"}
          </p>
          <form onSubmit={submit}>
            {!initialized && (
              <Field
                label="初始化令牌"
                hint="运行 npm run setup 后，从项目 .env 文件复制 SETUP_TOKEN。"
              >
                <input
                  name="setupToken"
                  type="password"
                  autoComplete="off"
                  required
                  placeholder="粘贴部署时生成的令牌"
                />
              </Field>
            )}
            <Field label="用户名">
              <input
                name="username"
                autoComplete="username"
                required
                minLength={3}
                pattern="[a-zA-Z0-9_.-]+"
                placeholder="输入用户名"
              />
            </Field>
            <Field
              label="密码"
              hint={
                !initialized
                  ? "至少 12 个字符；不使用预设共享密码。"
                  : undefined
              }
            >
              <input
                name="password"
                type="password"
                autoComplete={initialized ? "current-password" : "new-password"}
                required
                minLength={initialized ? 1 : 12}
                placeholder="输入密码"
              />
            </Field>
            {error && <ErrorBox message={error} />}
            <Submit busy={busy}>
              {initialized ? "登录工作台" : "创建账户并进入"}
            </Submit>
          </form>
          <div className="auth-foot">
            <ShieldCheck size={15} />
            模型密钥加密保存，仅用于你配置的服务。
          </div>
        </div>
      </div>
    </div>
  );
}
function Shell({ user, reload }: { user: any; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const toast = useToast(),
    location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  const nav = [
    { to: "/", label: "工作台", icon: LayoutDashboard },
    { to: "/matches", label: "比赛中心", icon: CalendarDays },
    { to: "/jobs", label: "资料研究", icon: Waypoints },
    { to: "/writing", label: "口播写作", icon: BookOpen },
    { to: "/reports", label: "报告档案", icon: FileText },
    { to: "/evidence", label: "证据库", icon: BookOpen },
  ];
  return (
    <AuthContext.Provider value={user}>
      <div className="app-shell">
        {open && (
          <div className="sidebar-overlay" onClick={() => setOpen(false)} />
        )}
        <aside className={"sidebar " + (open ? "open" : "")}>
          <NavLink className="brand" to="/">
            <span className="brand-mark">
              <Waypoints size={23} />
            </span>
            <span>
              边线情报<small>TOUCHLINE RESEARCH</small>
            </span>
          </NavLink>
          <div className="workspace-label">
            <span className="workspace-avatar">T</span>
            <div>
              我的研究空间<small>自主足球情报工作台</small>
            </div>
            <span className="workspace-version">V1</span>
          </div>
          <div className="nav-caption">研究空间</div>
          <nav>
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.to === "/"}>
                <n.icon size={19} />
                <span>{n.label}</span>
                {n.to === "/jobs" && <span className="nav-dot" />}
              </NavLink>
            ))}
          </nav>
          {user.role === "admin" && (
            <>
              <div className="nav-caption">后台管理</div>
              <nav>
                <NavLink to="/settings">
                  <Settings2 size={19} />
                  系统配置
                </NavLink>
                <NavLink to="/users">
                  <Users size={19} />
                  成员与权限
                </NavLink>
                <NavLink to="/audit">
                  <ShieldCheck size={19} />
                  操作日志
                </NavLink>
              </nav>
            </>
          )}
          <div className="sidebar-bottom">
            <div className="independent-search">
              <Globe2 size={19} />
              <div>
                搜索独立于模型<small>无需 AI 搜索模型订阅</small>
              </div>
            </div>
            <div className="profile">
              <NavLink to="/account" className="profile-link">
                <span className="avatar">
                  {user.username.slice(0, 1).toUpperCase()}
                </span>
                <span>
                  {user.username}
                  <small>
                    {
                      (
                        {
                          admin: "管理员",
                          researcher: "研究员",
                          viewer: "只读成员",
                        } as any
                      )[user.role]
                    }
                  </small>
                </span>
              </NavLink>
              <button
                aria-label="退出登录"
                className="icon-btn"
                onClick={async () => {
                  try {
                    await api("/auth/logout", body({}));
                    reload();
                  } catch (e) {
                    toast((e as Error).message, true);
                  }
                }}
              >
                <LogOut size={17} />
              </button>
            </div>
          </div>
        </aside>
        <main className="main">
          <header className="topbar">
            <div>
              <button
                aria-label="打开导航"
                className="icon-btn mobile-menu"
                onClick={() => setOpen(true)}
              >
                <Menu size={21} />
              </button>
              <span>研究空间</span>
              <span className="slash">/</span>
              <strong>
                {nav.find((n) =>
                  n.to === "/"
                    ? location.pathname === "/"
                    : location.pathname.startsWith(n.to),
                )?.label || "后台管理"}
              </strong>
            </div>
            <div className="topbar-right">
              <span className="system-state">
                <i />
                私有部署
              </span>
              <span className="top-date">
                {new Date().toLocaleDateString("zh-CN", {
                  month: "long",
                  day: "numeric",
                  weekday: "short",
                })}
              </span>
              <NavLink to="/account" className="mini-avatar">
                {user.username.slice(0, 1).toUpperCase()}
              </NavLink>
            </div>
          </header>
          <div className="page">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/matches" element={<Matches />} />
              <Route path="/jobs" element={<Jobs />} />
              <Route path="/jobs/:id" element={<JobDetail />} />
              <Route path="/writing" element={<Writing />} />
              <Route path="/writing/styles" element={<WritingStyles />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/evidence" element={<EvidencePage />} />
              <Route
                path="/settings"
                element={
                  user.role === "admin" ? (
                    <Settings />
                  ) : (
                    <div>仅管理员可以管理配置。</div>
                  )
                }
              />
              <Route
                path="/users"
                element={
                  user.role === "admin" ? (
                    <UsersPage />
                  ) : (
                    <div>仅管理员可以管理成员。</div>
                  )
                }
              />
              <Route
                path="/audit"
                element={
                  user.role === "admin" ? (
                    <AuditPage />
                  ) : (
                    <div>仅管理员可以查看日志。</div>
                  )
                }
              />
              <Route path="/account" element={<Account onChanged={reload} />} />
              <Route
                path="*"
                element={
                  <div className="empty">
                    <h2>页面不存在</h2>
                    <NavLink to="/">返回工作台</NavLink>
                  </div>
                }
              />
            </Routes>
          </div>
          <footer className="app-footer">
            <span>Touchline Research</span>
            <span>以方向为起点，以证据为边界。</span>
          </footer>
        </main>
      </div>
    </AuthContext.Provider>
  );
}
export default function App() {
  const { data, loading, error, reload } = useLoad<any>("/auth/status");
  useEffect(() => {
    const fn = () => void reload();
    window.addEventListener("session-expired", fn);
    return () => window.removeEventListener("session-expired", fn);
  }, [reload]);
  return (
    <ToastProvider>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} retry={reload} />
      ) : data?.user ? (
        <Shell user={data.user} reload={reload} />
      ) : (
        <Login initialized={!!data?.initialized} onLogin={reload} />
      )}
    </ToastProvider>
  );
}
