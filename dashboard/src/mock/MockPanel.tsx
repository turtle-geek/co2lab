// DEV-ONLY controls for the mock hub: force tree moods, close the laptop lid,
// finish pairing, and drop the connection to test the reconnect banner.

import { useEffect, useReducer, useState } from "react";
import type { DeviceState } from "@co2lab/shared";
import { mockHub } from "./mockHub";

const STATES: (DeviceState | "auto")[] = ["auto", "idle", "working", "offline", "resting", "hot", "error"];

export function MockPanel() {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    mockHub.listeners.add(rerender);
    return () => void mockHub.listeners.delete(rerender);
  }, []);

  return (
    <div className="mock-panel" data-open={open}>
      <button className="mock-panel__toggle" onClick={() => setOpen(!open)}>
        MOCK HUB {open ? "▾" : "▸"}
      </button>
      {open && (
        <div className="mock-panel__body">
          <p className="mock-panel__hint">Dev-only fake hub. Owner passphrase: <code>demo</code>. Type “fail” in a prompt to make Popeyes fail.</p>
          {[...mockHub.devices.values()].map((d) => (
            <label key={d.id} className="mock-panel__row">
              <span>{d.name}</span>
              <select defaultValue="auto" onChange={(e) => mockHub.forceState(d.id, e.target.value as DeviceState | "auto")}>
                {STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
          ))}
          <div className="mock-panel__buttons">
            <button onClick={() => mockHub.toggleLid()}>
              {mockHub.devices.get("dev-dragonfly")?.state === "offline" ? "Open" : "Close"} Dragonfly lid
            </button>
            <button disabled={!mockHub.pairCode} onClick={() => mockHub.pairDevice()}>Pair device with code</button>
            <button onClick={() => mockHub.requestJoin()}>Computer asks to join</button>
            <button onClick={() => mockHub.dropConnections(5000)}>Drop connection 5 s</button>
          </div>
        </div>
      )}
    </div>
  );
}
