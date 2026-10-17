import { useEffect, useState } from "react";
import type { Backend } from "./net/backend";
import { useHub } from "./net/useHub";
import { currentRun } from "./state/hubState";
import { DeviceGrid } from "./components/DeviceGrid";
import { AskBar, BurnMeter } from "./components/AskBar";
import { LiveScreens } from "./components/LiveScreens";
import { Approvals, Results } from "./components/Results";
import { PairDialog, ShareDialog } from "./components/Dialogs";
import { Expired, Login } from "./components/Login";
import { Lab } from "./labSlot";

type Tab = "devices" | "lab";

export function App({ backend, viewerToken }: { backend: Backend; viewerToken: string | null }) {
  const role = viewerToken ? "viewer" : "owner";
  const hub = useHub(backend, role, viewerToken ?? undefined);
  const { state, status } = hub;
  const [tab, setTab] = useState<Tab>("devices");
  // https://<hub>/approve?code=XXXX-XXXX (printed by the worker installer) opens the add-device dialog.
  const [approveCode] = useState(() => (location.pathname === "/approve" ? new URLSearchParams(location.search).get("code") ?? "" : null));
  const [pairOpen, setPairOpen] = useState(approveCode !== null);
  const [shareOpen, setShareOpen] = useState(false);
  const DevPanel = backend.DevPanel;

  const readOnly = role === "viewer" || state.role === "viewer";
  const connected = status === "open";
  const run = currentRun(state.runs);
  const busy = !!hub.pendingRunId && !state.runs.some((r) => r.clientRunId === hub.pendingRunId);

  // Auto-hide hub errors after a few seconds.
  useEffect(() => {
    if (!state.lastError) return;
    const t = setTimeout(() => hub.dispatch({ type: "local.clearError" }), 5000);
    return () => clearTimeout(t);
  }, [state.lastError, hub]);

  if (status === "unauthorized") {
    return (
      <>
        {role === "viewer" ? (
          <Expired />
        ) : (
          <Login
            onLogin={async (p) => {
              const r = await backend.login(p);
              if (r === "ok") hub.restart();
              return r;
            }}
          />
        )}
        {DevPanel && <DevPanel />}
      </>
    );
  }

  if (!state.ready) {
    return (
      <main className="center-screen">
        <p className="connecting">
          <span className="spinner" aria-hidden /> Connecting to the hub…
        </p>
        {DevPanel && <DevPanel />}
      </main>
    );
  }

  const pairedDevice = pairOpen && state.newDeviceIds.length ? state.devices.find((d) => d.id === state.newDeviceIds.at(-1)) ?? null : null;

  function openPair() {
    hub.dispatch({ type: "local.clearPair" });
    setPairOpen(true);
  }

  function newPairCode() {
    hub.send({ type: "pair.start" });
  }

  function openShare() {
    setShareOpen(true);
    if (!state.viewerLink || state.viewerLink.expiresAt < Date.now()) hub.send({ type: "viewer.create" });
  }

  return (
    <div className={readOnly ? "app app--viewer" : "app"}>
      {status !== "open" && (
        <div className="banner" role="status">
          <span className="spinner" aria-hidden /> Reconnecting… showing the last known state.
        </div>
      )}
      {state.lastError && (
        <div className="toast" role="alert" onClick={() => hub.dispatch({ type: "local.clearError" })}>
          {state.lastError.message}
        </div>
      )}

      <header className="top">
        <div className="brand">
          <svg viewBox="0 0 200 200" width="30" height="30" aria-hidden>
            <rect x="92" y="120" width="16" height="64" rx="6" fill="#7a5233" />
            <circle cx="100" cy="88" r="62" fill="#5c9f4c" />
          </svg>
          <span className="brand-name" aria-label="CO2LAB">CO<sub>2</sub>LAB</span>
          {readOnly && <span className="badge">View only</span>}
          {DevPanel && <span className="badge badge--mock">Mock hub</span>}
        </div>
        <nav className="tabs" aria-label="Sections">
          <button className={tab === "devices" ? "tab tab--on" : "tab"} onClick={() => setTab("devices")}>
            Devices
          </button>
          <button className={tab === "lab" ? "tab tab--on" : "tab"} onClick={() => setTab("lab")}>
            Lab
          </button>
        </nav>
        {!readOnly && (
          <div className="top__actions">
            <button className="btn btn--small" onClick={openShare} disabled={!connected}>
              Share view
            </button>
            <button
              className="link-btn"
              onClick={async () => {
                await backend.logout();
                hub.restart();
              }}
            >
              Log out
            </button>
          </div>
        )}
      </header>

      {tab === "lab" ? (
        <main className="main">
          <Lab experiments={state.experiments} defaultConfig={state.defaultConfig} devices={state.devices} readOnly={readOnly} connected={connected} send={hub.send} />
        </main>
      ) : (
        <main className="main">
          <div className="ask-row">
            <AskBar readOnly={readOnly} connected={connected} busy={busy} onAsk={hub.createRun} />
            <BurnMeter run={run} />
          </div>

          <DeviceGrid
            devices={state.devices}
            readOnly={readOnly}
            connected={connected}
            onAdd={openPair}
            onRevoke={(id) => hub.send({ type: "device.revoke", deviceId: id })}
          />


          <div className={state.devices.some((d) => d.state === "working" || d.currentTask) ? "split" : "split split--solo"}>
            <LiveScreens devices={state.devices} frames={state.frames} steps={state.steps} />
            <Results
              run={run}
              devices={state.devices}
              readOnly={readOnly}
              connected={connected}
              onShare={(runId, target) => hub.send({ type: "share.request", runId, target })}
            >
              <Approvals
                approvals={state.approvals}
                readOnly={readOnly}
                connected={connected}
                onRespond={(id, approve) => hub.send({ type: "approval.respond", approvalId: id, approve })}
              />
            </Results>
          </div>
        </main>
      )}

      {pairOpen && !readOnly && (
        <PairDialog
          pair={state.pairCode}
          paired={pairedDevice}
          connected={connected}
          pending={state.pendingDevices}
          hubUrl={state.hubUrl}
          highlightCode={approveCode}
          onNewCode={newPairCode}
          onApprove={(userCode, name) => hub.send({ type: "devicecode.approve", userCode, name })}
          onDeny={(userCode) => hub.send({ type: "devicecode.deny", userCode })}
          onClose={() => {
            setPairOpen(false);
            hub.dispatch({ type: "local.clearPair" });
            if (location.pathname === "/approve") history.replaceState(null, "", "/");
          }}
        />
      )}
      {shareOpen && !readOnly && (
        <ShareDialog link={state.viewerLink} connected={connected} onCreate={() => hub.send({ type: "viewer.create" })} onClose={() => setShareOpen(false)} />
      )}
      {DevPanel && <DevPanel />}
    </div>
  );
}
