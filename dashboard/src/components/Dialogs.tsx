import { useState } from "react";
import type { DeviceView } from "@co2lab/shared";
import { Modal } from "./Modal";
import { Qr } from "./Qr";
import { useNow } from "../format";
import type { PairCode } from "../state/hubState";

function countdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function PairDialog({
  pair,
  paired,
  connected,
  onNewCode,
  onClose,
}: {
  pair: PairCode | null;
  paired: DeviceView | null;
  connected: boolean;
  onNewCode(): void;
  onClose(): void;
}) {
  const now = useNow(500);
  const left = pair ? pair.expiresAt - now : 0;
  const expired = !!pair && left <= 0;

  return (
    <Modal title="Pair an old device" onClose={onClose}>
      {paired ? (
        <div className="pair pair--done">
          <p className="pair__done">🌱 {paired.name} joined the team.</p>
          <button className="btn btn--primary" onClick={onClose}>
            Done
          </button>
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
            <ol className="pair__steps">
              <li>
                <b>Android:</b> open CO₂LAB → Scan QR (or type the code).
              </li>
              <li>
                <b>Laptop:</b> <code>npm run pair -- {pair.code}</code> in <code>worker-web/</code>.
              </li>
            </ol>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function ShareDialog({
  link,
  connected,
  onCreate,
  onClose,
}: {
  link: { url: string; expiresAt: number } | null;
  connected: boolean;
  onCreate(): void;
  onClose(): void;
}) {
  const [copied, setCopied] = useState(false);
  const now = useNow(10_000);

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
    } catch {
      const input = document.getElementById("viewer-link") as HTMLInputElement | null;
      input?.select();
      document.execCommand("copy");
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <Modal title="Share a read-only view" onClose={onClose}>
      {!link ? (
        <p className="pair__wait">{connected ? "Creating a viewer link…" : "Waiting for the hub connection…"}</p>
      ) : (
        <div className="share">
          <Qr value={link.url} size={196} label="Viewer link QR code" />
          <div className="share__side">
            <p className="share__hint">Judges scan this to watch live on their phones. They cannot change anything.</p>
            <div className="share__row">
              <input id="viewer-link" className="input" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
              <button className="btn btn--primary" onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="share__expiry">Expires in {Math.max(0, Math.round((link.expiresAt - now) / 60000))} min</p>
            <button className="link-btn" onClick={onCreate} disabled={!connected}>
              Make a new link
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
