// Small cross-links between the Agent and Devices tabs, so splitting them does not hide anything:
// the Agent tab shows who is working (TeamStrip); the Devices tab shows that a run is going (RunBanner).

import type { DeviceView, RunView } from "@co2lab/shared";
import { STATE_LABEL } from "../format";

/** One chip per device: name, state and current task. Click to open the Devices tab. */
export function TeamStrip({ devices, onOpen }: { devices: DeviceView[]; onOpen(): void }) {
  if (!devices.length) return null;
  return (
    <div className="team" aria-label="Your devices">
      {devices.map((d) => (
        <button key={d.id} className={`team__chip team__chip--${d.state}`} onClick={onOpen} title={`${d.name}: ${STATE_LABEL[d.state]} (open Devices)`}>
          <span className={`team__dot team__dot--${d.state}`} aria-hidden />
          <span className="team__name">{d.name}</span>
          <span className="team__task">{d.currentTask ? d.currentTask.label : STATE_LABEL[d.state]}</span>
        </button>
      ))}
    </div>
  );
}

/** On the Devices tab while a request runs: progress and a link back to the steps. */
export function RunBanner({ run, onOpen }: { run: RunView | null; onOpen(): void }) {
  if (!run || !(run.status === "planning" || run.status === "running" || run.status === "merging")) return null;
  const done = run.subtasks.filter((s) => s.status === "done" || s.status === "failed").length;
  const text =
    run.status === "planning" ? "Gemini is planning" : run.status === "merging" ? "Writing the answer" : `${done} of ${run.subtasks.length} tasks done`;
  return (
    <button className="runbanner" onClick={onOpen}>
      <span className="step__icon step__icon--running" aria-hidden />
      <span>
        <b>Agent run:</b> “{run.prompt}” · {text}
      </span>
      <span className="runbanner__go">See steps →</span>
    </button>
  );
}
