import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { apiJson, jsonRequest, sessionExpiredEvent, updateAccountSession } from "../lib/api.js";
import { ConfirmDialog } from "./ConfirmDialog.js";

export type LocalAccount = { id: string; username: string; role: "admin" | "member"; disabled_at: string | null };
type Session = { account: LocalAccount | null; needs_setup: boolean };

export function AccountGate({ children }: { children: (account: LocalAccount, signOut: () => Promise<void>) => ReactNode }) {
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let mounted = true;
    setError("");
    apiJson<Session>("/account/session")
      .then((value) => { if (mounted) setSession(value); })
      .catch((reason: Error) => { if (mounted) setError(reason.message); });
    return () => { mounted = false; };
  }, [reload]);

  useEffect(() => {
    function expired() {
      updateAccountSession();
      setSession({ account: null, needs_setup: false });
    }
    window.addEventListener(sessionExpiredEvent, expired);
    return () => window.removeEventListener(sessionExpiredEvent, expired);
  }, []);

  if (session?.account) return children(session.account, async () => {
    await apiJson("/account/logout", { method: "POST" });
    updateAccountSession();
    setSession({ account: null, needs_setup: false });
    window.location.hash = "#/tasks";
  });

  return <main className="account-layout">
    <section className="panel settings-panel account-card">
      <div className="panel-heading"><h1>Personal AI OS</h1></div>
      {session ? <LoginForm setup={session.needs_setup} onLogin={(account, token) => {
        updateAccountSession(token);
        setSession({ account, needs_setup: false });
      }} /> : error ? <>
        <p className="notice error" role="alert">{error}</p>
        <button className="secondary-button" type="button" onClick={() => setReload(reload + 1)}>重试</button>
      </> : <p role="status">正在连接本机服务…</p>}
    </section>
  </main>;
}

function LoginForm({ setup, onLogin }: { setup: boolean; onLogin: (account: LocalAccount, token?: string) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      const credentials = { username: data.get("username"), password: data.get("password") };
      const result = await apiJson<{ account: LocalAccount; session_token?: string }>(
        setup ? "/account/setup" : "/account/login",
        jsonRequest("POST", setup ? { ...credentials, setup_code: data.get("code") } : credentials)
      );
      onLogin(result.account, result.session_token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败");
    } finally {
      setPending(false);
    }
  }

  return <form className="account-form" onSubmit={(event) => void submit(event)}>
    {setup && <p className="settings-help">首次设置请从数据目录下的 <code>.accounts/setup-code.txt</code> 获取验证码。原有数据归此管理员账号。</p>}
    <label className="form-field">登录名 <input className="cell-input" name="username" autoComplete="username" required maxLength={32} /></label>
    <label className="form-field">密码 <input className="cell-input" name="password" type="password" autoComplete={setup ? "new-password" : "current-password"} required minLength={12} maxLength={128} /></label>
    {setup && <label className="form-field">初始化验证码 <input className="cell-input" name="code" required autoComplete="off" maxLength={48} /></label>}
    {error && <p className="notice error" role="alert">{error}</p>}
    <button className="primary-button" type="submit" disabled={pending}>{setup ? "创建管理员" : "登录"}</button>
  </form>;
}

export function AccountSettings({ account, signOut }: { account: LocalAccount; signOut: () => Promise<void> }) {
  const [members, setMembers] = useState<LocalAccount[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<LocalAccount>();

  async function refresh() {
    const result = await apiJson<{ accounts: LocalAccount[] }>("/account/users");
    setMembers(result.accounts);
  }

  useEffect(() => {
    if (account.role === "admin") void refresh().catch((reason: Error) => setError(reason.message));
  }, [account.id, account.role]);

  async function run(action: () => Promise<void>) {
    setPending(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "账号操作失败");
    } finally {
      setPending(false);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    await run(async () => {
      await apiJson("/account/users", jsonRequest("POST", { username: fields.get("username"), password: fields.get("password") }));
      form.reset();
      await refresh();
    });
  }

  return <section className="panel settings-panel">
    <div className="panel-heading">
      <h2>本地账号</h2>
      <button className="secondary-button" type="button" disabled={pending} onClick={() => void run(signOut)}>退出登录</button>
    </div>
    <p>{account.username} · {account.role === "admin" ? "管理员" : "普通用户"}</p>
    {account.role === "admin" && <>
      <form className="account-form" onSubmit={(event) => void create(event)} autoComplete="off">
        <label className="form-field">新账号登录名 <input className="cell-input" name="username" minLength={3} maxLength={32} pattern={"[a-zA-Z][a-zA-Z0-9_\\-]{2,31}"} required /></label>
        <label className="form-field">初始密码 <input className="cell-input" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
        <button className="primary-button" type="submit" disabled={pending}>创建普通账号</button>
      </form>
      <ul className="account-members">
        {members.filter((member) => member.role === "member").map((member) => <li key={member.id}>
          <span>{member.username}</span>
          {member.disabled_at ? <span className="muted">已停用</span> : <button className="secondary-button" type="button" disabled={pending} onClick={() => setSelected(member)}>停用</button>}
        </li>)}
      </ul>
    </>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {selected && <ConfirmDialog title="停用账号？" confirmLabel="停用账号"
      message={"账号 " + selected.username + " 的登录会立即失效，历史数据会保留。"}
      onCancel={() => setSelected(undefined)}
      onConfirm={() => {
        const member = selected;
        setSelected(undefined);
        void run(async () => {
          await apiJson("/account/users/" + encodeURIComponent(member.id) + "/disable", { method: "POST" });
          await refresh();
        });
      }}
    />}
  </section>;
}
