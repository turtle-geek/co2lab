// "Add a device": computers join with a one-line installer and wait here for approval
// (device-code pairing); Android phones scan a QR / type a 6-digit code.

import { useEffect, useRef, useState } from "react";
import type { DeviceView, PendingDevice } from "@co2lab/shared";
import { Modal } from "./Modal";
import { Qr } from "./Qr";
import { useNow } from "../format";
import type { PairCode } from "../state/hubState";

type PairTab = "computer" | "android";

function countdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "bkdf qrwt" -> "BKDF-QRWT", like the hub does. */
function normalizeCode(input: string): string {
  const s = input.toUpperCase().replace(/[^A-Z]/g, "");
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}

/** Copies text, falling back to selecting it when the clipboard API is blocked. */
function useCopy(): [string | null, (key: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.getElementById(`copy-${key}`);
      if (el) window.getSelection()?.selectAllChildren(el);
      document.execCommand("copy");
    }
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
  }
  return [copied, copy];
}

function Command({ id, label, command, copied, onCopy }: { id: string; label: string; command: string; copied: boolean; onCopy(): void }) {
  return (
    <div className="cmd">
      <p className="cmd__label">{label}</p>
      <div className="cmd__row">
        <code id={`copy-${id}`} className="cmd__text">
          {command}
        </code>
        <button className="btn btn--small" onClick={onCopy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function PendingCard({
  p,
  highlight,
  connected,
  onApprove,
  onDeny,
}: {
  p: PendingDevice;
  highlight: boolean;
  connected: boolean;
  onApprove(userCode: string, name: string): void;
  onDeny(userCode: string): void;
}) {
  const [name, setName] = useState(p.name);
  const now = useNow(1000);
  const left = p.expiresAt - now;
  const i = p.info;
  const facts: [string, string][] = [
    ["System", i.os],
    ["Model", i.model ?? "unknown"],
    ["CPU", i.cpu ?? "unknown"],
    ["Memory", i.ramGb != null ? `${i.ramGb} GB` : "unknown"],
    ["Battery", i.hasBattery ? "yes" : "no"],
    ["Browser", i.browser ?? "none found (Chromium will be downloaded)"],
    ["Hostname", i.hostname],
    ["From", p.ip ?? "unknown"],
  ];
  return (
    <li className={highlight ? "pending pending--match" : "pending"}>
      <div className="pending__head">
        <span className="pending__code">{p.userCode}</span>
        <span className="pending__kind">{p.kind === "desktop" ? "Desktop" : p.kind === "cloud" ? "Cloud" : "Laptop"}</span>
        <span className={left <= 60_000 ? "pending__timer pending__timer--low" : "pending__timer"}>{countdown(left)}</span>
      </div>
      {highlight && <p className="pending__hint">Check that the computer shows this same code.</p>}
      <label className="pending__name">
        <span>Name</span>
        <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      </label>
      <dl className="pending__facts">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="pending__actions">
        <button className="btn btn--primary" disabled={!connected || !name.trim()} onClick={() => onApprove(p.userCode, name.trim())}>
          Approve
        </button>
        <button className="link-btn" disabled={!connected} onClick={() => onDeny(p.userCode)}>
          Deny
        </button>
      </div>
    </li>
  );
}

export function PairDialog({
  pair,
  paired,
  connected,
  pending,
  hubUrl,
  highlightCode = null,
  onNewCode,
  onApprove,
  onDeny,
  onClose,
}: {
  pair: PairCode | null;
  paired: DeviceView | null;
  connected: boolean;
  pending: PendingDevice[];
  hubUrl: string | null;
  /** From /approve?code=XXXX-XXXX: the request the owner came to approve. */
  highlightCode?: string | null;
  onNewCode(): void;
  onApprove(userCode: string, name: string): void;
  onDeny(userCode: string): void;
  onClose(): void;
}) {
  const now = useNow(500);
  const [tab, setTab] = useState<PairTab>("computer");
  const [copied, copy] = useCopy();
  const left = pair ? pair.expiresAt - now : 0;
  const expired = !!pair && left <= 0;

  // Android codes are only made when that tab is first opened.
  const asked = useRef(false);
  useEffect(() => {
    if (tab === "android" && connected && !asked.current) {
      asked.current = true;
      onNewCode();
    }
  }, [tab, connected, onNewCode]);

  const live = pending.filter((p) => p.expiresAt > now);
  const wanted = highlightCode ? normalizeCode(highlightCode) : null;
  const shown = wanted ? [...live].sort((a, b) => Number(b.userCode === wanted) - Number(a.userCode === wanted)) : live;
  const missing = !!wanted && !live.some((p) => p.userCode === wanted);
  const hub = hubUrl ?? location.origin;
  const ps = `irm ${hub}/install.ps1 | iex`;
  const sh = `curl -fsSL ${hub}/install.sh | sh`;

  return (
    <Modal title="Add a device" onClose={onClose}>
      {paired ? (
        <div className="pair pair--done">
          <p className="pair__done">🌱 {paired.name} joined the team.</p>
          <button className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        </div>
      ) : (
        <>
          <div className="seg" role="tablist" aria-label="Device type">
            <button role="tab" aria-selected={tab === "computer"} className={tab === "computer" ? "seg__btn seg__btn--on" : "seg__btn"} onClick={() => setTab("computer")}>
              Laptop or desktop
            </button>
            <button role="tab" aria-selected={tab === "android"} className={tab === "android" ? "seg__btn seg__btn--on" : "seg__btn"} onClick={() => setTab("android")}>
              Android phone
            </button>
          </div>

          {tab === "computer" ? (
            <div className="join">
              <Command id="ps" label="On the computer, open PowerShell and run:" command={ps} copied={copied === "ps"} onCopy={() => copy("ps", ps)} />
              <Command id="sh" label="macOS or Linux terminal:" command={sh} copied={copied === "sh"} onCopy={() => copy("sh", sh)} />
              <p className="join__note">It installs Node if needed, detects the computer and shows a code. Approve it below.</p>

              <h3 className="join__title">Waiting for approval</h3>
              {missing && (
                <p className="join__missing">
                  No computer is waiting with code <b>{wanted}</b>. It may have expired: run the command again.
                </p>
              )}
              {shown.length === 0 ? (
                <p className="pair__wait">{connected ? "Nothing yet. Computers show up here after they run the command." : "Waiting for the hub connection…"}</p>
              ) : (
                <ul className="pending-list">
                  {shown.map((p) => (
                    <PendingCard key={p.userCode} p={p} highlight={p.userCode === wanted} connected={connected} onApprove={onApprove} onDeny={onDeny} />
                  ))}
                </ul>
              )}
            </div>
          ) : !pair ? (
            <p className="pair__wait">{connected ? "Getting a code from the hub…" : "Waiting for the hub connection…"}</p>
          ) : (
            <div className="pair">
              <div className={expired ? "pair__qr pair__qr--expired" : "pair__qr"}>
                <Qr value={pair.qrPayload} size={196} label="Pairing QR code" />
              </div>
              <div className="pair__side">
                <p className="pair__label">One-time code</p>
                <p className="pair__code" aria-live="polite">
                  {pair.code.slice(0, 3)}&nbsp;{pair.code.slice(3)}
                </p>
                <p className={expired ? "pair__timer pair__timer--expired" : "pair__timer"}>
                  {expired ? "Code expired" : `Expires in ${countdown(left)}`}
                </p>
                {expired && (
                  <button className="btn btn--primary" onClick={onNewCode} disabled={!connected}>
                    New code
                  </button>
                )}
                <p className="pair__steps">Open CO₂LAB on the phone → Scan QR (or type the code).</p>
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
