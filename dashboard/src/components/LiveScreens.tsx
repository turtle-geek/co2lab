import type { DeviceView, RunView } from "@co2lab/shared";
import type { LiveFrame, LiveStep } from "../state/hubState";
import { ago, capabilityLabel, useNow } from "../format";

function Screen({ device, frame, step, now, done }: { device: DeviceView; frame?: LiveFrame; step?: LiveStep; now: number; done: boolean }) {
  const phone = device.kind === "android";
  const task = device.currentTask;
  const fresh = frame && (done || !task || frame.subtaskId === null || frame.subtaskId === task.subtaskId);
  const caption = done ? (step?.text ?? "") : step && (!task || step.subtaskId === task.subtaskId) ? step.text : task ? `Starting ${task.label}…` : "";
  const img = fresh ? <img src={frame.src} alt={`Live screen of ${device.name}`} width={frame.width} height={frame.height} /> : <div className="screen__empty">{done ? "No screen yet. It shows up when this device works." : "Waiting for the first frame…"}</div>;

  return (
    <figure className={`screen ${phone ? "screen--phone" : "screen--browser"}${done ? " screen--done" : ""}`}>
      <figcaption className="screen__head">
        <b>{device.name}</b>
        {task && <span className="screen__task">{task.label || capabilityLabel(task.capability)}</span>}
        {done ? (
          <span className="screen__done">{frame ? `last screen · ${ago(frame.at, now)}` : "idle"}</span>
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

/** Devices that take part in this request (or are working right now): they get a screen. */
export function screenDevices(devices: DeviceView[], run: RunView | null | undefined): DeviceView[] {
  const inRun = new Set((run?.subtasks ?? []).map((s) => s.deviceId).filter((id): id is string => !!id));
  return devices.filter((d) => d.state !== "revoked" && (inRun.has(d.id) || d.state === "working" || !!d.currentTask));
}

/**
 * A screen per device that takes part in the current request. A screen slides in when its device
 * starts and then keeps its slot (with the last frame) until the next request, so nothing jumps.
 */
export function LiveScreens({
  devices,
  frames,
  steps,
  run,
}: {
  devices: DeviceView[];
  frames: Record<string, LiveFrame>;
  steps: Record<string, LiveStep>;
  run?: RunView | null;
}) {
  const now = useNow();
  const shown = screenDevices(devices, run);
  if (!shown.length) return null;
  return (
    <section className="panel live" aria-label="Screens">
      <h2 className="panel__title">Screens</h2>
      <div className="live__grid">
        {shown.map((d) => (
          <Screen key={d.id} device={d} frame={frames[d.id]} step={steps[d.id]} now={now} done={!(d.state === "working" || !!d.currentTask)} />
        ))}
      </div>
    </section>
  );
}
