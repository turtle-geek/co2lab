import type { DeviceView, RunView, SubtaskView } from "@co2lab/shared";
import type { LiveFrame, LiveStep } from "../state/hubState";
import { STATE_LABEL, ago, capabilityLabel, useNow } from "../format";
import { TelemetryLine } from "./DeviceGrid";

/** What this device last finished in the run, for its "done" card. */
function lastFinished(run: RunView | null | undefined, deviceId: string): SubtaskView | undefined {
  const mine = (run?.subtasks ?? []).filter((s) => s.deviceId === deviceId && (s.status === "done" || s.status === "failed"));
  return mine.sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))[0];
}

/** Shown in place of the screen once the device has no task: no frozen last frame. */
function DoneCard({ sub }: { sub?: SubtaskView }) {
  if (!sub) return <div className="screen__empty">Waiting for a task</div>;
  const ok = sub.status === "done";
  const result = !ok ? sub.error ?? "failed" : sub.tool && sub.tool !== "deals" ? sub.findings ?? `${sub.dealCount} found` : `${sub.dealCount} deal${sub.dealCount === 1 ? "" : "s"}`;
  return (
    <div className={`screen__finished${ok ? "" : " screen__finished--failed"}`}>
      <span className="screen__finished-icon" aria-hidden>
        <svg viewBox="0 0 24 24" width="22" height="22">
          {ok ? <path d="M6 12.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /> : <path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />}
        </svg>
      </span>
      <b>{sub.name ?? sub.label ?? capabilityLabel(sub.capability)}</b>
      <span className="screen__finished-result">{result}</span>
    </div>
  );
}

function Screen({ device, frame, step, now, done, run }: { device: DeviceView; frame?: LiveFrame; step?: LiveStep; now: number; done: boolean; run?: RunView | null }) {
  const phone = device.kind === "android";
  const task = device.currentTask;
  const fresh = frame && (!task || frame.subtaskId === null || frame.subtaskId === task.subtaskId);
  const caption = done ? "" : step && (!task || step.subtaskId === task.subtaskId) ? step.text : task ? `Starting ${task.label}…` : "";
  const img = done ? (
    <DoneCard sub={lastFinished(run, device.id)} />
  ) : fresh ? (
    <img src={frame.src} alt={`Live screen of ${device.name}`} width={frame.width} height={frame.height} />
  ) : (
    <div className="screen__empty">Waiting for the first frame…</div>
  );

  return (
    <figure className={`screen ${phone ? "screen--phone" : "screen--browser"}${done ? " screen--done" : ""}`}>
      <figcaption className="screen__head">
        <span className="screen__name">
          <b>{device.name}</b>
          <span className={`pill pill--${device.state}`}>{STATE_LABEL[device.state]}</span>
          {!done && (
            <span className="screen__live" aria-label="live">
              ● {frame ? ago(frame.at, now) : "live"}
            </span>
          )}
        </span>
        <TelemetryLine device={device} now={now} />
        {task && <span className="screen__task">{task.label || capabilityLabel(task.capability)}</span>}
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

/** Devices that take part in this request while it runs: they get a screen. Once the run ends the screens leave. */
export function screenDevices(devices: DeviceView[], run: RunView | null | undefined): DeviceView[] {
  if (!run || !(run.status === "planning" || run.status === "running" || run.status === "merging")) return [];
  const inRun = new Set((run?.subtasks ?? []).map((s) => s.deviceId).filter((id): id is string => !!id));
  return devices.filter((d) => d.state !== "revoked" && (inRun.has(d.id) || d.state === "working" || !!d.currentTask));
}

/**
 * A screen per device in the running request. A screen slides in when its device starts; when the
 * device finishes, its screen turns into a short "done" card; when the run ends, the screens leave.
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
    <section className="panel live" aria-label="Device screens">
      <div className="live__grid">
        {shown.map((d) => (
          <Screen key={d.id} device={d} frame={frames[d.id]} step={steps[d.id]} now={now} run={run} done={!(d.state === "working" || !!d.currentTask)} />
        ))}
      </div>
    </section>
  );
}
