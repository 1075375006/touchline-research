import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Plus, Pencil, BookOpen, Trash2 } from "lucide-react";
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
} from "../lib";
export function WritingStyles() {
  const { data, loading, error, reload } = useLoad<any[]>("/writing/styles");
  const [selected, setSelected] = useState(""),
    [edit, setEdit] = useState<any>(null),
    [knowledge, setKnowledge] = useState<any>(null),
    [remove, setRemove] = useState<any>(null);
  const [busy, setBusy] = useState(false),
    [formError, setFormError] = useState("");
  const admin = useAuth().role === "admin",
    toast = useToast();
  const current = data?.find((s) => s.id === selected) || data?.[0];
  function beginStyle(s: any = {}) {
    setFormError("");
    setEdit({
      name: "",
      description: "",
      instructions: "",
      charsPerMinute: 240,
      enabled: true,
      ...s,
    });
  }
  function beginKnowledge(k: any = {}) {
    setFormError("");
    setKnowledge({
      title: "",
      content: "",
      enabled: true,
      style_id: current?.id,
      ...k,
    });
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      if (edit) {
        const r = await api(
          "/writing/styles" + (edit.id ? "/" + edit.id : ""),
          body(edit, edit.id ? "PUT" : "POST"),
        );
        setSelected(edit.id || r.id);
        setEdit(null);
      } else {
        await api(
          knowledge.id
            ? "/writing/knowledge/" + knowledge.id
            : "/writing/styles/" + knowledge.style_id + "/knowledge",
          body(knowledge, knowledge.id ? "PUT" : "POST"),
        );
        setKnowledge(null);
      }
      await reload();
      toast("已保存；将在下次写作时使用");
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function destroy() {
    setBusy(true);
    try {
      await api(
        "/writing/" +
          (remove.kind === "style" ? "styles/" : "knowledge/") +
          remove.id,
        { method: "DELETE" },
      );
      setRemove(null);
      await reload();
      toast("已删除，历史稿件的快照仍然保留");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHead
        eyebrow="VOICE & KNOWLEDGE"
        title="风格与知识库"
        description="把你的表达方式沉淀成可复用的角色指令。每种风格都有独立知识库，在开始写作时一起加载。"
        actions={
          <>
            <Link className="btn" to="/writing">
              <ArrowLeft size={16} />
              返回写作
            </Link>
            {admin && (
              <button className="btn primary" onClick={() => beginStyle()}>
                <Plus size={16} />
                新增风格
              </button>
            )}
          </>
        }
      />
      {!admin && (
        <div className="notice">
          你可以查看所有风格。修改角色指令和知识库需要管理员权限。
        </div>
      )}
      {error && <ErrorBox message={error} retry={reload} />}
      {loading ? (
        <Loading />
      ) : !data?.length ? (
        <section className="panel">
          <Empty
            title="创建你的第一种口播风格"
            detail="添加角色指令、默认语速和可选知识库，写稿时即可选择。"
            action={
              admin && (
                <button className="btn primary" onClick={() => beginStyle()}>
                  新增风格
                </button>
              )
            }
          />
        </section>
      ) : (
        <div className="writing-styles-layout">
          <div className="writing-style-list">
            {data.map((s) => (
              <button
                key={s.id}
                className={
                  "writing-style-card " +
                  (current?.id === s.id ? "selected" : "")
                }
                onClick={() => setSelected(s.id)}
              >
                <span className="eyebrow">
                  {s.enabled ? "可用于写作" : "已停用"}
                </span>
                <h3>{s.name}</h3>
                <p>{s.description || "尚未填写简介"}</p>
                <span>
                  {s.charsPerMinute} 字/分钟 · {s.knowledge.length} 个知识条目
                </span>
              </button>
            ))}
          </div>
          {current && (
            <section className="panel writing-style-detail">
              <div className="panel-heading">
                <h2>{current.name}</h2>
                {admin && (
                  <div className="head-actions">
                    <button
                      className="btn small"
                      onClick={() => beginStyle(current)}
                    >
                      <Pencil size={14} />
                      编辑风格
                    </button>
                    <button
                      className="btn small danger"
                      onClick={() =>
                        setRemove({
                          kind: "style",
                          id: current.id,
                          name: current.name,
                        })
                      }
                    >
                      <Trash2 size={14} />
                      删除风格
                    </button>
                  </div>
                )}
              </div>
              <div className="writing-style-content">
                <span className="eyebrow">角色指令</span>
                <p className="prewrap role-instructions">
                  {current.instructions}
                </p>
                <div className="writing-knowledge-heading">
                  <div>
                    <h3>
                      <BookOpen size={18} /> 专属知识库
                    </h3>
                    <p className="muted small">
                      可保存结构范式、开场方式、用词偏好与示例。启用内容合计最多
                      20,000 字。
                    </p>
                  </div>
                  {admin && (
                    <button
                      className="btn small"
                      onClick={() => beginKnowledge()}
                    >
                      <Plus size={14} />
                      新增知识
                    </button>
                  )}
                </div>
                <div className="notice">
                  知识库用于写作风格与表达参考。示例里的球队、比分、时间和引语不会作为本场比赛的事实依据。
                </div>
                {!current.knowledge.length ? (
                  <Empty
                    title="这份风格还没有知识条目"
                    detail="角色指令已可直接使用；加入写作范式或自己的示例后，下一次生成会同时参考。"
                  />
                ) : (
                  current.knowledge.map((k: any) => (
                    <article className="writing-knowledge-card" key={k.id}>
                      <div>
                        <h4>{k.title}</h4>
                        <span className="muted small">
                          {k.enabled ? "启用" : "停用"} · {k.content.length}{" "}
                          字符
                        </span>
                        {admin && (
                          <div className="head-actions">
                            <button
                              className="btn small"
                              onClick={() => beginKnowledge(k)}
                            >
                              编辑知识
                            </button>
                            <button
                              className="btn small danger"
                              onClick={() =>
                                setRemove({
                                  kind: "knowledge",
                                  id: k.id,
                                  name: k.title,
                                })
                              }
                            >
                              删除知识
                            </button>
                          </div>
                        )}
                      </div>
                      <details>
                        <summary>查看内容</summary>
                        <p className="prewrap">{k.content}</p>
                      </details>
                    </article>
                  ))
                )}
              </div>
            </section>
          )}
        </div>
      )}
      {edit && (
        <Modal
          title={edit.id ? "编辑写作风格" : "新增写作风格"}
          onClose={() => setEdit(null)}
          wide
        >
          <form onSubmit={save}>
            <Field label="风格名称">
              <input
                aria-label="风格名称"
                required
                maxLength={80}
                value={edit.name}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
            </Field>
            <Field label="风格简介">
              <input
                maxLength={500}
                value={edit.description}
                onChange={(e) =>
                  setEdit({ ...edit, description: e.target.value })
                }
              />
            </Field>
            <Field
              label="角色指令"
              hint="描述角色、语气、结构、表达节奏与禁忌。10—8000 字符。"
            >
              <textarea
                aria-label="角色指令"
                rows={9}
                required
                minLength={10}
                maxLength={8000}
                value={edit.instructions}
                onChange={(e) =>
                  setEdit({ ...edit, instructions: e.target.value })
                }
                placeholder="你是一位……开头……正文……结尾……"
              />
            </Field>
            <Field label="默认语速（字/分钟）">
              <input
                aria-label="默认语速（字/分钟）"
                type="number"
                min={120}
                max={360}
                required
                value={edit.charsPerMinute}
                onChange={(e) =>
                  setEdit({ ...edit, charsPerMinute: Number(e.target.value) })
                }
              />
            </Field>
            <label className="writing-toggle">
              <input
                type="checkbox"
                checked={edit.enabled}
                onChange={(e) =>
                  setEdit({ ...edit, enabled: e.target.checked })
                }
              />
              启用此风格
            </label>
            <p className="muted small">
              更改只影响之后开始的写作，已有版本保留原设置。
            </p>
            {formError && <ErrorBox message={formError} />}
            <Submit busy={busy}>保存风格</Submit>
          </form>
        </Modal>
      )}
      {knowledge && (
        <Modal
          title={knowledge.id ? "编辑知识条目" : "新增知识条目"}
          onClose={() => setKnowledge(null)}
          wide
        >
          <form onSubmit={save}>
            <Field label="知识标题">
              <input
                aria-label="知识标题"
                required
                maxLength={120}
                value={knowledge.title}
                onChange={(e) =>
                  setKnowledge({ ...knowledge, title: e.target.value })
                }
              />
            </Field>
            <Field
              label="知识内容"
              hint="支持粘贴纯文本或 Markdown。单条最多 10000 字符。"
            >
              <textarea
                aria-label="知识内容"
                rows={13}
                required
                maxLength={10000}
                value={knowledge.content}
                onChange={(e) =>
                  setKnowledge({ ...knowledge, content: e.target.value })
                }
                placeholder="例如：开头先提出一个矛盾，随后用两组证据解释，最后回到判断成立的条件。"
              />
            </Field>
            <label className="writing-toggle">
              <input
                type="checkbox"
                checked={knowledge.enabled}
                onChange={(e) =>
                  setKnowledge({ ...knowledge, enabled: e.target.checked })
                }
              />
              写作时使用此条知识
            </label>
            {formError && <ErrorBox message={formError} />}
            <Submit busy={busy}>保存知识</Submit>
          </form>
        </Modal>
      )}
      {remove && (
        <Modal
          title={
            "删除" + (remove.kind === "style" ? "风格" : "知识条目") + "？"
          }
          onClose={() => setRemove(null)}
        >
          <p>
            确认删除“{remove.name}”？
            {remove.kind === "style" ? "其知识条目也会删除。" : ""}
            已有稿件仍保存当时使用的角色与知识快照。
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setRemove(null)}>
              保留
            </button>
            <button className="btn danger" disabled={busy} onClick={destroy}>
              确认删除
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
