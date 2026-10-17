import { useState } from "react";
import { Modal } from "./Modal";
import { Qr } from "./Qr";
import { useNow } from "../format";

export { PairDialog } from "./PairDialog";

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
