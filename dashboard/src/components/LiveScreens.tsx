import type { DeviceView } from "@co2lab/shared";
import type { LiveFrame, LiveStep } from "../state/hubState";
import { ago, capabilityLabel, useNow } from "../format";

function Screen({ device, frame, step, now }: { device: DeviceView; frame?: LiveFrame; step?: LiveStep; now: number }) {
  const phone = device.kind === "android";
  const task = device.currentTask;
  const fresh = frame && (!task || frame.subtaskId === null || frame.subtaskId === task.subtaskId);
  const caption = step && (!task || step.subtaskId === task.subtaskId) ? step.text : task ? `Starting ${task.label}…` : "";
  const img = fresh ? <img src={frame.src} alt={`Live screen of ${device.name}`} width={frame.width} height={frame.height} /> : <div className="screen__empty">Waiting for the first frame…</div>;

  return (
    <figure className={`screen ${phone ? "screen--phone" : "screen--browser"}`}>
      <figcaption className="screen__head">
        <b>{device.name}</b>
        {task && <span className="screen__task">{capabilityLabel(task.capability)}</span>}
        <span className="screen__live" aria-label="live">
          ● {frame ? ago(frame.at, now) : "live"}
        </span>
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

export function LiveScreens({
  devices,
  frames,
  steps,
}: {
  devices: DeviceView[];
  frames: Record<string, LiveFrame>;
  steps: Record<string, LiveStep>;
}) {
  const now = useNow();
  const working = devices.filter((d) => d.state === "working" || d.currentTask);
  return (
    <section className="panel live" aria-label="Live screens">
      <h2 className="panel__title">Live screens</h2>
      {working.length === 0 ? (
        <p className="empty">Screens show up here while a device is working.</p>
      ) : (
        <div className="live__grid">
          {working.map((d) => (
            <Screen key={d.id} device={d} frame={frames[d.id]} step={steps[d.id]} now={now} />
          ))}
        </div>
      )}
    </section>
  );
}
