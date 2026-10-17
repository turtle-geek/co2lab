// Slot for the Research Mode tab (task T7 owns src/lab/).
// If src/lab/LabTab.tsx exists, its default export is rendered with LabProps; otherwise a placeholder.
// T7 does not need to edit any file outside src/lab/.

import { Suspense, lazy, type ComponentType } from "react";
import type { AgentConfig, ClientToHub, DeviceView, ExperimentView } from "@co2lab/shared";

export interface LabProps {
  experiments: ExperimentView[];
  defaultConfig: AgentConfig | null;
  devices: DeviceView[];
  /** Viewer mode: hide every control. */
  readOnly: boolean;
  connected: boolean;
  /** Sends a research.* command; returns false while disconnected or in viewer mode. */
  send(msg: ClientToHub): boolean;
}

const found = import.meta.glob<{ default: ComponentType<LabProps> }>("./lab/LabTab.tsx");
const loader = Object.values(found)[0];
const LabTab = loader ? lazy(loader) : null;

export function Lab(props: LabProps) {
  if (!LabTab) {
    return (
      <section className="panel">
        <h2 className="panel__title">Lab</h2>
        <p className="empty">Research Mode is not built yet.</p>
      </section>
    );
  }
  return (
    <Suspense fallback={<p className="empty">Loading the Lab…</p>}>
      <LabTab {...props} />
    </Suspense>
  );
}
