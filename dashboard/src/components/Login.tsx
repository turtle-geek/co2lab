import { useState, type FormEvent } from "react";
import type { LoginResult } from "../net/backend";
import { Tree } from "./Tree";

export function Login({ onLogin }: { onLogin(passphrase: string): Promise<LoginResult> }) {
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!pass) return;
    setBusy(true);
    setError(null);
    const r = await onLogin(pass);
    setBusy(false);
    if (r === "wrong") setError("That passphrase is not right.");
    else if (r === "error") setError("Cannot reach the hub. Try again in a moment.");
  }

  return (
    <main className="center-screen">
      <form className="card login" onSubmit={submit}>
        <div className="login__tree">
          <Tree mood="offline" />
        </div>
        <h1>Co2lab</h1>
        <p className="login__sub">Wake up your device team.</p>
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          placeholder="Owner passphrase"
          aria-label="Owner passphrase"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          autoFocus
        />
        {error && <p className="login__error" role="alert">{error}</p>}
        <button className="btn btn--primary" disabled={busy || !pass}>
          {busy ? "Checking…" : "Log in"}
        </button>
        <p className="login__hint">Judges: ask the owner for a viewer link.</p>
      </form>
    </main>
  );
}

export function Expired() {
  return (
    <main className="center-screen">
      <div className="card login">
        <div className="login__tree">
          <Tree mood="offline" />
        </div>
        <h1>This link has expired</h1>
        <p className="login__sub">Ask the owner for a new viewer link.</p>
      </div>
    </main>
  );
}
