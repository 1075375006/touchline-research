import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { LoaderCircle, X, SearchX, Check, AlertCircle } from "lucide-react";
export async function api<T = any>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch("/api" + url, {
    ...options,
    headers: { "content-type": "application/json", ...options.headers },
  });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event("session-expired"));
    throw new Error(data.error || "请求失败");
  }
  return data;
}
export const body = (data: unknown, method = "POST") => ({
  method,
  body: JSON.stringify(data),
});
export function useLoad<T = any>(url: string, poll = 0) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try {
      setData(await api<T>(url));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [url]);
  useEffect(() => {
    setLoading(true);
    void reload();
    if (poll) {
      const timer = setInterval(() => void reload(), poll);
      return () => clearInterval(timer);
    }
  }, [reload, poll]);
  return { data, error, loading, reload };
}
export const AuthContext = createContext<any>(null);
export const useAuth = () => useContext(AuthContext);
const ToastContext = createContext<(text: string, error?: boolean) => void>(
  () => {},
);
export const useToast = () => useContext(ToastContext);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<
    { id: number; text: string; error: boolean }[]
  >([]);
  const notify = useCallback((text: string, error = false) => {
    const id = Date.now() + Math.random();
    setItems((old) => [...old, { id, text, error }]);
    setTimeout(() => setItems((old) => old.filter((x) => x.id !== id)), 6500);
  }, []);
  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((x) => (
          <div className={"toast " + (x.error ? "error" : "")} key={x.id}>
            {x.error ? <AlertCircle size={18} /> : <Check size={18} />}
            <span>{x.text}</span>
            <button
              aria-label="关闭通知"
              onClick={() =>
                setItems((old) => old.filter((i) => i.id !== x.id))
              }
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export function Empty({
  title = "还没有内容",
  detail,
  action,
}: {
  title?: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <SearchX size={27} />
      </div>
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading">
      <LoaderCircle className="spin" size={22} />
      正在读取工作台…
    </div>
  );
}
export function ErrorBox({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="error-box" role="alert">
      <AlertCircle size={18} />
      <span>{message}</span>
      {retry && (
        <button className="btn small" onClick={retry}>
          重试
        </button>
      )}
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key);
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = old;
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className={"modal " + (wide ? "wide" : "")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-btn" aria-label="关闭弹窗" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export const fmt = (d: string | undefined) =>
  d
    ? new Date(d).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "—";
export const fullDate = (d: string) =>
  new Date(d).toLocaleString("zh-CN", { hour12: false });
export const localInput = (d = new Date()) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
export const statusNames: Record<string, string> = {
  queued: "排队中",
  running: "研究中",
  paused: "已暂停",
  completed: "已完成",
  partial: "研究受限",
  failed: "失败",
  cancelled: "已取消",
  closed: "已审计",
  read: "原文已读取",
  snippet: "仅摘要",
  after_cutoff: "超出冻结时间",
};
export function Badge({ status }: { status: string }) {
  return (
    <span className={"badge " + status}>
      <i />
      {statusNames[status] || status}
    </span>
  );
}
export function PageHead({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="head-actions">{actions}</div>
    </div>
  );
}
export function Submit({
  busy,
  children,
}: {
  busy: boolean;
  children: ReactNode;
}) {
  return (
    <button className="btn primary" disabled={busy} type="submit">
      {busy ? <LoaderCircle size={16} className="spin" /> : null}
      {busy ? "处理中…" : children}
    </button>
  );
}
