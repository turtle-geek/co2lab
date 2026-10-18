import type { DeviceView, RunView } from "@co2lab/shared";
import type { LiveFrame, LiveStep } from "../state/hubState";
import { ago, capabilityLabel, useNow } from "../format";

function Screen({ device, frame, step, now, done }: { device: DeviceView; frame?: LiveFrame; step?: LiveStep; now: number; done: boolean }) {
  const phone = device.kind === "android";
  const task = device.currentTask;
  const fresh = frame && (done || !task || frame.subtaskId === null || frame.subtaskId === task.subtaskId);
  const caption = done ? (step?.text ?? "Finished") : step && (!task || step.subtaskId === task.subtaskId) ? step.text : task ? `Starting ${task.label}…` : "";
  const img = fresh ? <img src={frame.src} alt={`Live screen of ${device.name}`} width={frame.width} height={frame.height} /> : <div className="screen__empty">Waiting for the first frame…</div>;

  return (
    <figure className={`screen ${phone ? "screen--phone" : "screen--browser"}${done ? " screen--done" : ""}`}>
      <figcaption className="screen__head">
        <b>{device.name}</b>
        {task && <span className="screen__task">{task.label || capabilityLabel(task.capability)}</span>}
        {done ? (
          <span className="screen__done">✓ Done</span>
        ) : (
          <span className="screen__live" aria-label="live">
            ● {frame ? ago(frame.at, now) : "live"}
          </span>
        )}
      </figcaption>
      {phone ? (
        <div className="phone">
          <div className="phone__notch" />
          <div className="phone__glass">{img}</div>
        </div>
      ) : (
        <div className="browser">
          <div className="browser__bar">
            <span className="browser__dots">
              <i />
              <i />
              <i />
            </span>
            <span className="browser__url">{task ? capabilityLabel(task.capability) : ""}</span>
          </div>
          <div className="browser__glass">{img}</div>
        </div>
      )}
      <p className="screen__caption" aria-live="polite">
        {caption}
      </p>
    </figure>
  );
}

/** How long a device keeps its slot (with its last frame) after it stops working. */
const KEEP_MS = 60_000;

export function LiveScreens({
  devices,
  frames,
  steps,
  run,
}: {
  devices: DeviceView[];
  frames: Record<string, LiveFrame>;
  steps: Record<string, LiveStep>;
  /** The current run: every device that worked on it keeps a stable slot. */
  run?: RunView | null;
}) {
  const now = useNow();
  const inRun = new Set((run?.subtasks ?? []).map((s) => s.deviceId).filter((id): id is string => !!id));
  const runRecent = run && (run.finishedAt === null || now - run.finishedAt < KEEP_MS);
  const isWorking = (d: DeviceView) => d.state === "working" || !!d.currentTask;
  // Device order is the grid's order, so slots never swap places.
  const shown = devices.filter((d) => isWorking(d) || (runRecent && inRun.has(d.id) && frames[d.id]));
  if (shown.length === 0) return null;
  return (
    <section className="panel live" aria-label="Live screens">
      <h2 className="panel__title">Live screens</h2>
      {(
        <div className="live__grid">
          {shown.map((d) => (
            <Screen key={d.id} device={d} frame={frames[d.id]} step={steps[d.id]} now={now} done={!isWorking(d)} />
          ))}
        </div>
      )}
    </section>
  );
}
