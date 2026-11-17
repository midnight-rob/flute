import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { MotionSchema, PreviewDefinitionSchema, type PreviewDefinitionInput } from "../../core";
import { useSceneTime } from "../../react";
import { ScenePreview, type ScenePreviewProps } from "../ScenePreview";
import {
  decodeCameraKeyframes,
  encodeCameraKeyframes,
  keyframeLimit,
  poseAt,
  setCameraKeyframe,
  withCameraKeyframes,
  type CameraDefinition,
  type CameraKeyframe,
  type CameraPose,
} from "./keyframes";
import { CameraHud, CameraNumber, hudRanges, type CameraHudControl } from "./CameraHud";
import { useFrameBatch } from "./useFrameBatch";
import controlsCss from "./camera-controls.css?inline";
import hudCss from "./camera-hud.css?inline";

function cameraSettings(camera: CameraDefinition["scene"]["camera"], fStop: number) {
  return {
    pitch: { label: "Pitch", initial: camera.rotateX, min: -80, max: 80, step: 1, unit: "°" },
    yaw: { label: "Yaw", initial: camera.rotateY, min: -80, max: 80, step: 1, unit: "°" },
    roll: { label: "Roll", initial: camera.rotateZ, ...hudRanges.roll, unit: "°" },
    panX: { label: "Pan X", initial: 0, min: -400, max: 400, step: 5, unit: " px" },
    panY: { label: "Pan Y", initial: 0, min: -350, max: 350, step: 5, unit: " px" },
    zoom: { label: "Zoom", initial: 0, ...hudRanges.zoom, unit: " px" },
    aperture: { label: "Aperture", initial: fStop, ...hudRanges.aperture, unit: "" },
    focus: { label: "Focus offset", initial: 0, min: -400, max: 400, step: 5, unit: " px" },
    travel: { label: "Camera travel", initial: 100, min: 0, max: 125, step: 5, unit: "%" },
  };
}

type Setting = keyof ReturnType<typeof cameraSettings>;
type Settings = Record<Setting, number>;

const cameraQueryKeys = ["keys", "pitch", "yaw", "roll", "panX", "panY", "zoom", "aperture", "focus", "travel"] as const;

export function clearCameraQuery(params: URLSearchParams) {
  for (const key of cameraQueryKeys) params.delete(key);
}

function createCameraScene(id: string, storagePrefix: string, original: ReturnType<typeof PreviewDefinitionSchema.parse>) {
  const camera = original.scene.camera;
  const motion = MotionSchema.parse(original.motion);
  const lens = original.scene.focus;
  const minFocus = lens.focalLength + 25;
  const keyframeStorage = `${storagePrefix}:${id}:camera-keyframes`;
  const controls = cameraSettings(camera, lens.fStop);
  const entries = Object.entries(controls) as [Setting, (typeof controls)[Setting]][];
  const defaults = Object.fromEntries(entries.map(([key, control]) => [key, control.initial])) as Settings;

  function readSettings(query: Pick<URLSearchParams, "get">): Settings {
    return Object.fromEntries(entries.map(([key, control]) => {
      const input = query.get(key);
      const value = input ? Number(input) : NaN;
      return [key, Number.isFinite(value) ? Math.min(control.max, Math.max(control.min, value)) : control.initial];
    })) as Settings;
  }

  function zoomFocusShift({ pitch, yaw, zoom }: Settings) {
    const radians = Math.PI / 180;
    return zoom * Math.cos(pitch * radians) * Math.cos(yaw * radians);
  }

  function poseFromSettings(settings: Settings): CameraPose {
    return {
      x: camera.x + settings.panX,
      y: camera.y + settings.panY,
      z: camera.z - settings.zoom,
      rotateX: settings.pitch,
      rotateY: settings.yaw,
      rotateZ: settings.roll,
      fStop: settings.aperture,
      distance: Math.max(minFocus, lens.distance + settings.focus - zoomFocusShift(settings)),
    };
  }

  function settingsFromPose(pose: CameraPose): Settings {
    const settings = {
      ...defaults,
      panX: pose.x - camera.x,
      panY: pose.y - camera.y,
      zoom: camera.z - pose.z,
      pitch: pose.rotateX,
      yaw: pose.rotateY,
      roll: pose.rotateZ,
      aperture: pose.fStop,
    };
    return { ...settings, focus: pose.distance - lens.distance + zoomFocusShift(settings) };
  }

  function previewDefinition(settings: Settings): CameraDefinition {
    const offsets: Record<string, number> = { x: settings.panX, y: settings.panY, z: -settings.zoom };
    const focusOffset = settings.focus - zoomFocusShift(settings);
    const { fStop, distance, ...pose } = poseFromSettings(settings);
    return {
      ...original,
      scene: {
        ...original.scene,
        version: 3,
        camera: { ...camera, ...pose },
        focus: { ...lens, fStop, distance },
      },
      motion: {
        ...motion,
        tracks: motion.tracks.map(track => {
          const isFocusDistance = track.target.kind === "focus" && track.property === "distance";
          if (track.target.kind !== "camera" && !isFocusDistance) return track;
          const first = track.keyframes[0].value;
          const offset = isFocusDistance ? focusOffset : offsets[track.property] ?? 0;
          return {
            ...track,
            keyframes: track.keyframes.map(frame => {
              const value = first + (frame.value - first) * settings.travel / 100 + offset;
              return { ...frame, value: isFocusDistance ? Math.max(minFocus, value) : value };
            }),
          };
        }),
      },
    };
  }

  function seekTo(timeMs: number) {
    (window as CaptureWindow).__FLUTE_CAPTURE__?.seek(timeMs / motion.speed);
  }

  function frameTime(timeMs: number) {
    return `${(timeMs / motion.speed / 1000).toFixed(2)} s`;
  }

  // Older links can contain poses outside the current gesture range. Let edits bring them back gradually.
  function moveSetting(key: Setting, current: number, delta: number) {
    const { min, max } = controls[key];
    return bounded(current + delta, Math.min(min, current), Math.max(max, current));
  }

  // Fixed upper bound for focus so the slider range does not grow while a keyframe is being edited.
  const focusCeiling = Math.max(4000, Math.ceil(lens.distance), ...motion.tracks.flatMap(track =>
    track.target.kind === "focus" && track.property === "distance" ? track.keyframes.map(frame => Math.ceil(frame.value)) : []));

  return { motion, camera, minFocus, focusCeiling, keyframeStorage, entries, defaults,
    readSettings, poseFromSettings, settingsFromPose, previewDefinition, seekTo, frameTime, moveSetting };
}

type CameraScene = ReturnType<typeof createCameraScene>;
type DraftEdit = (previous: CameraKeyframe | null) => CameraKeyframe;

type CameraControlsProps = {
  scene: CameraScene;
  active: boolean;
  onActiveChange: (active: boolean) => void;
  definition: CameraDefinition;
  travel: number;
  frames: CameraKeyframe[];
  onEdit: (edit: DraftEdit, continuous: boolean) => void;
  onSave: (frame: CameraKeyframe) => void;
  onRemove: (timeMs: number) => void;
  onMove: (from: number, to: number) => void;
  onDuplicate: (from: number, to: number) => void;
  onTravel: (travel: number) => void;
  onReset: () => void;
};

type CaptureWindow = Window & { __FLUTE_CAPTURE__?: { seek: (elapsedMs: number) => void } };
type DragPoint = { id: number; x: number; y: number };

function bounded(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function startDrag(event: PointerEvent<HTMLElement>, drag: { current: DragPoint | null }) {
  if (drag.current) return;
  event.preventDefault();
  event.currentTarget.focus({ preventScroll: true });
  event.currentTarget.setPointerCapture(event.pointerId);
  drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
}

function dragDelta(event: PointerEvent<HTMLElement>, drag: { current: DragPoint | null }) {
  const previous = drag.current;
  if (!previous || previous.id !== event.pointerId) return null;
  drag.current = { id: previous.id, x: event.clientX, y: event.clientY };
  return { x: event.clientX - previous.x, y: event.clientY - previous.y };
}

const panDirections: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

function CameraTimelineKeyframe({ scene, timeMs, active, current, canDuplicate, onMove, onDuplicate, onRemove, onInvalidTime }: {
  scene: CameraScene;
  timeMs: number;
  active: boolean;
  current: boolean;
  canDuplicate: boolean;
  onMove: (timeMs: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onInvalidTime: () => void;
}) {
  const drag = useRef<{ pointerId: number; startX: number; width: number; moved: boolean } | null>(null);
  const { motion, seekTo, frameTime } = scene;
  const ignoreClick = useRef(false);
  const [dragTime, setDragTime] = useState<number | null>(null);
  const dragPreview = useFrameBatch<number>(setDragTime);
  const shownTime = dragTime ?? timeMs;

  function timeAt(clientX: number, startX: number, width: number) {
    const elapsed = (timeMs + (clientX - startX) / width * motion.durationMs) / motion.speed;
    return bounded(Math.round(Math.round(elapsed / 10) * 10 * motion.speed), 0, motion.durationMs);
  }

  function clearDrag() {
    drag.current = null;
    dragPreview.take();
    setDragTime(null);
  }

  return <div className="flute-camera-keyframe"
    style={{ left: `${100 * shownTime / motion.durationMs}%` }}
    data-edge={shownTime / motion.durationMs < 0.12 ? "start" : shownTime / motion.durationMs > 0.88 ? "end" : undefined}
    data-editable={active ? "" : undefined} data-dragging={dragTime !== null ? "" : undefined}>
    <button type="button" className="flute-camera-marker"
      aria-label={`Keyframe at ${frameTime(shownTime)}`}
      title={active ? undefined : frameTime(shownTime)}
      aria-current={current ? "true" : undefined}
      onPointerDown={event => {
        ignoreClick.current = false;
        if (!active || event.button !== 0 || !event.isPrimary) return;
        const width = event.currentTarget.closest(".flute-camera-markers")?.getBoundingClientRect().width;
        if (!width) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, startX: event.clientX, width, moved: false };
      }}
      onPointerMove={event => {
        const start = drag.current;
        if (!active || !start || start.pointerId !== event.pointerId) return;
        if (!start.moved && Math.abs(event.clientX - start.startX) < 4) return;
        start.moved = true;
        dragPreview.schedule(timeAt(event.clientX, start.startX, start.width));
      }}
      onPointerUp={event => {
        const start = drag.current;
        if (!start || start.pointerId !== event.pointerId) return;
        ignoreClick.current = start.moved;
        clearDrag();
        if (active && start.moved) onMove(timeAt(event.clientX, start.startX, start.width));
      }}
      onLostPointerCapture={clearDrag}
      onClick={event => {
        if (!ignoreClick.current || event.detail === 0) seekTo(timeMs);
        ignoreClick.current = false;
      }}/>
    {active && <div className="flute-camera-keyframe-popover">
      {dragTime !== null ? <span>{frameTime(shownTime)}</span> : <>
        <form className="flute-camera-keyframe-time" onSubmit={event => {
          event.preventDefault();
          const input = event.currentTarget.elements.namedItem("time");
          if (!(input instanceof HTMLInputElement)) return;
          const seconds = input.valueAsNumber;
          const to = Math.round(seconds * 1000 * motion.speed);
          if (!Number.isFinite(to) || seconds < 0 || to > motion.durationMs) {
            onInvalidTime();
            return;
          }
          onMove(to);
        }} noValidate>
          <label>
            <input type="number" name="time" step="any" inputMode="decimal"
              aria-label="Keyframe time in seconds"
              defaultValue={Number((timeMs / motion.speed / 1000).toFixed(6))}
              onFocus={event => event.currentTarget.select()}/> s
          </label>
          <button type="submit">Move</button>
        </form>
        <button type="button" disabled={!canDuplicate} onClick={onDuplicate}>Duplicate</button>
        <button type="button" onClick={onRemove}>Delete</button>
      </>}
    </div>}
  </div>;
}

function CameraControls({ scene, active, onActiveChange, definition, travel, frames, onEdit, onSave, onRemove, onMove, onDuplicate, onTravel, onReset }: CameraControlsProps) {
  const { motion, camera, minFocus, frameTime, seekTo, poseFromSettings, settingsFromPose, moveSetting } = scene;
  const sceneTime = Math.round(useSceneTime());
  const anchor = useRef<HTMLSpanElement>(null);
  const drag = useRef<DragPoint | null>(null);
  const [hosts, setHosts] = useState<{ viewport: HTMLElement; dock: HTMLElement } | null>(null);
  const [notice, setNotice] = useState("");
  const [lockedControl, setLockedControl] = useState<CameraHudControl | null>(null);
  const [orbiting, setOrbiting] = useState(false);
  const saveTime = sceneTime;
  const pose = useMemo(() => active ? poseAt(definition, saveTime) : null, [active, definition, saveTime]);
  const existing = frames.some(frame => frame.timeMs === saveTime);
  const canSave = existing || frames.length < keyframeLimit;

  useEffect(() => {
    const root = anchor.current?.closest("[data-flute-preview]");
    const viewport = root?.querySelector<HTMLElement>(".flute-viewport");
    const dock = root?.querySelector<HTMLElement>(".flute-dock");
    if (!viewport || !dock) return;

    dock.classList.add("flute-camera-dock");
    setHosts({ viewport, dock });
    return () => dock.classList.remove("flute-camera-dock");
  }, []);

  function editPose(update: (previous: CameraPose) => CameraPose, continuous = false) {
    if (!pose) return;
    setNotice("");
    onEdit(previous => ({
      timeMs: previous?.timeMs ?? saveTime,
      pose: update(previous?.pose ?? pose),
    }), continuous);
  }

  function moveCamera(deltas: Partial<Settings>, continuous = false) {
    editPose(current => {
      const settings = settingsFromPose(current);
      for (const key of Object.keys(deltas) as Setting[]) {
        settings[key] = moveSetting(key, settings[key], deltas[key] ?? 0);
      }
      return poseFromSettings(settings);
    }, continuous);
  }

  function changeHud(control: keyof typeof hudRanges, value: number, continuous: boolean) {
    editPose(current => {
      if (control === "roll") return { ...current, rotateZ: value };
      if (control === "aperture") return { ...current, fStop: value };
      return poseFromSettings({ ...settingsFromPose(current), zoom: value });
    }, continuous);
  }

  function save() {
    if (!pose || !canSave) return;
    setNotice("");
    onSave({ timeMs: saveTime, pose });
  }

  function moveKeyframe(from: number, to: number) {
    if (from === to) {
      setNotice("");
      return;
    }
    if (frames.some(frame => frame.timeMs === to)) {
      setNotice(`A keyframe already uses ${frameTime(to)}`);
      return;
    }
    setNotice("");
    onMove(from, to);
    seekTo(to);
  }

  function duplicateKeyframe(from: number) {
    const occupied = new Set(frames.map(frame => frame.timeMs));
    const offset = Math.max(1, Math.round(500 * motion.speed));
    let to = from + offset;
    while (occupied.has(to)) to++;
    if (to > motion.durationMs) {
      to = Math.max(0, from - offset);
      while (occupied.has(to)) to++;
    }
    if (to > motion.durationMs) return;

    setNotice("");
    onDuplicate(from, to);
    seekTo(to);
  }

  function handleWheel(event: WheelEvent) {
    if (!active) return;
    if (!(event.target instanceof Element) || !event.target.closest(".flute-camera-surface")) return;
    if (event.ctrlKey || event.metaKey || event.deltaY === 0) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 200 : 1;
    if (event.target instanceof HTMLElement) event.target.focus({ preventScroll: true });
    const zoom = bounded(-event.deltaY * unit * 0.65, -100, 100);
    moveCamera({ zoom: event.shiftKey ? zoom * 0.2 : zoom }, true);
  }

  function handleKey(event: KeyboardEvent) {
    if (!active) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || event.defaultPrevented || event.isComposing ||
        event.metaKey || event.ctrlKey || event.altKey) return;
    const surface = target.classList.contains("flute-camera-surface");
    const timeline = !!hosts?.dock.contains(target);
    const guide = !!target.closest(".flute-camera-controls, .flute-camera-hud");
    if ((!surface && !timeline && !guide) || target.isContentEditable ||
        target.matches("input:not(.flute-timeline), textarea, select")) return;

    if (event.key === "Escape" && lockedControl) {
      event.preventDefault();
      setLockedControl(null);
      return;
    }

    const direction = panDirections[event.key];
    if (direction && (surface || target.classList.contains("flute-camera-toggle"))) {
      event.preventDefault();
      const step = event.shiftKey ? 25 : 5;
      moveCamera({ panX: direction.x * step, panY: direction.y * step });
    } else if (event.key.toLowerCase() === "k" && !event.repeat) {
      event.preventDefault();
      save();
    }
  }

  const handlers = useRef({ handleWheel, handleKey });
  useLayoutEffect(() => { handlers.current = { handleWheel, handleKey }; });

  useEffect(() => {
    if (!hosts || !active) return;
    const wheel = (event: WheelEvent) => handlers.current.handleWheel(event);
    const key = (event: KeyboardEvent) => handlers.current.handleKey(event);
    hosts.viewport.addEventListener("wheel", wheel, { passive: false });
    document.addEventListener("keydown", key);
    return () => {
      hosts.viewport.removeEventListener("wheel", wheel);
      document.removeEventListener("keydown", key);
    };
  }, [hosts, active]);

  return <>
    <span ref={anchor} hidden />
    {hosts && active && pose && createPortal(
      <>
        <div className="flute-camera-surface" role="region" aria-label="Camera preview"
          aria-describedby="flute-camera-gestures" tabIndex={0} data-flute-preview-chrome
          onPointerDown={event => {
            if (event.button === 1 || (event.button === 0 && event.shiftKey)) {
              startDrag(event, drag);
              setOrbiting(true);
            }
          }}
          onPointerMove={event => {
            const delta = dragDelta(event, drag);
            if (delta && (delta.x || delta.y)) {
              moveCamera({ yaw: -delta.x * 0.22, pitch: delta.y * 0.22 }, true);
            }
          }}
          onLostPointerCapture={() => { drag.current = null; setOrbiting(false); }}
          onAuxClick={event => {
            if (event.button === 1) event.preventDefault();
          }}/>
        <CameraHud values={{ zoom: camera.z - pose.z, aperture: pose.fStop, roll: pose.rotateZ }}
          attitude={{ pitch: pose.rotateX, yaw: pose.rotateY, active: orbiting }}
          focus={{ distance: pose.distance, min: minFocus, max: scene.focusCeiling }}
          lockedControl={lockedControl} onLockChange={setLockedControl}
          onFocusChange={(distance, continuous) => editPose(current => ({ ...current, distance }), continuous)}
          onChange={changeHud}>
          {frames.length === 0 && <>
            <CameraNumber label="Travel amount" value={travel} unit="%" onCommit={onTravel}/>
            <button type="button" onClick={onReset}>Reset camera</button>
          </>}
        </CameraHud>
      </>,
      hosts.viewport,
    )}
    {hosts && createPortal(
      <>
        <div className="flute-camera-markers" role="group" aria-label="Camera keyframes" data-flute-preview-chrome>
          {frames.map(({ timeMs }) => (
            <CameraTimelineKeyframe key={timeMs} scene={scene} timeMs={timeMs} active={active}
              current={timeMs === sceneTime}
              canDuplicate={frames.length < keyframeLimit}
              onMove={to => moveKeyframe(timeMs, to)} onDuplicate={() => duplicateKeyframe(timeMs)}
              onInvalidTime={() => setNotice(`Enter a time from 0 to ${frameTime(motion.durationMs)}`)}
              onRemove={() => {
                setNotice("");
                onRemove(timeMs);
              }}/>
          ))}
        </div>
        {active && (notice || (!existing && canSave) || (!existing && !canSave)) && <div className="flute-camera-actions" data-flute-preview-chrome>
          {(notice || !canSave) && <span role="status">{notice || "Keyframe limit reached"}</span>}
          {!existing && canSave && <button type="button" className="flute-camera-save" onClick={save}
            aria-keyshortcuts="K" title={`Add a keyframe at ${frameTime(saveTime)} (K)`}>
            + Keyframe
          </button>}
        </div>}
      </>,
      hosts.dock,
    )}
    {hosts && createPortal(
      <aside className="flute-camera-controls" aria-label="Camera controls" data-active={active} data-flute-preview-chrome>
        <div className="flute-camera-guide">
          <button type="button" className="flute-camera-toggle" aria-expanded={active}
            aria-controls="flute-camera-options" onClick={() => {
              if (active) {
                drag.current = null;
                setLockedControl(null);
                setNotice("");
              }
              onActiveChange(!active);
            }}>
            Camera
            {!active && <span className="flute-camera-off" aria-hidden="true">Off</span>}
          </button>
          <div className="flute-camera-options" id="flute-camera-options">
            <span className="flute-camera-instructions" id="flute-camera-gestures">
              <span title="Hold Shift to pan faster"><kbd>↑↓←→</kbd> Pan</span>
              <span title="Shift + drag also works on a trackpad"><kbd>Middle drag</kbd> Orbit</span>
              <span><kbd>Scroll</kbd> Zoom</span>
              {active && <span title="Hold Shift while dragging zoom, focus, or roll"><kbd>Shift</kbd> Fine HUD adjustment</span>}
              <span><kbd>K</kbd> Add keyframe</span>
            </span>
          </div>
        </div>
      </aside>,
      document.body,
    )}
  </>;
}

export type CameraPreviewProps = Omit<ScenePreviewProps, "definition"> & {
  sceneId: string;
  storagePrefix?: string;
  definition: PreviewDefinitionInput;
};

export function CameraPreview({ sceneId, storagePrefix = "flute", definition, ...props }: CameraPreviewProps) {
  const parsed = useMemo(() => PreviewDefinitionSchema.safeParse(definition), [definition]);
  const scene = useMemo(() => parsed.success && parsed.data.motion?.durationMs
    ? createCameraScene(sceneId, storagePrefix, parsed.data)
    : null, [parsed, sceneId, storagePrefix]);

  if (!scene) return <ScenePreview {...props} definition={definition}/>;
  return <CameraScenePreview key={scene.keyframeStorage} {...props} scene={scene}/>;
}

function CameraScenePreview({ scene, children, ...props }: Omit<ScenePreviewProps, "definition"> & { scene: CameraScene }) {
  const { motion, minFocus, keyframeStorage, readSettings, previewDefinition, entries, defaults } = scene;
  const [query] = useState(() => new URLSearchParams(typeof window === "undefined" ? "" : window.location.search));
  const [settings, setSettings] = useState(() => readSettings(query));
  const [frames, setFrames] = useState(() =>
    decodeCameraKeyframes(query.get("keys"), motion.durationMs, minFocus),
  );
  const [active, setActive] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const base = useMemo(() => previewDefinition(settings), [previewDefinition, settings]);
  const saved = useMemo(() => withCameraKeyframes(base, frames), [base, frames]);

  // A camera change commits straight to the timeline: it updates the keyframe at the current time,
  // or creates one when that time is empty.
  function commitFrame(next: CameraKeyframe) {
    setFrames(previous => previous.length >= keyframeLimit && !previous.some(frame => frame.timeMs === next.timeMs)
      ? previous
      : setCameraKeyframe(previous, next));
  }

  function applyEdit(edit: DraftEdit) {
    const next = edit(null);
    if (frames.length >= keyframeLimit && !frames.some(frame => frame.timeMs === next.timeMs)) return;
    scene.seekTo(next.timeMs);
    commitFrame(next);
  }

  const edits = useFrameBatch(applyEdit, (first, next) => previous => next(first(previous)));

  function saveFrame(frame: CameraKeyframe) {
    edits.flush();
    scene.seekTo(frame.timeMs);
    commitFrame(frame);
  }

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const url = new URL(window.location.href);
      if (!url.searchParams.has("keys")) {
        try {
          const saved = localStorage.getItem(keyframeStorage);
          if (saved) setFrames(decodeCameraKeyframes(saved, motion.durationMs, minFocus));
        } catch { /* The preview URL also stores saved keyframes. */ }
      }
      setLoaded(true);
    });
    return () => { active = false; };
  }, [keyframeStorage, minFocus, motion.durationMs]);

  useEffect(() => {
    if (!loaded) return;
    const url = new URL(window.location.href);
    for (const [key, control] of entries) {
      if (settings[key] === control.initial) url.searchParams.delete(key);
      else url.searchParams.set(key, String(settings[key]));
    }
    const encoded = encodeCameraKeyframes(frames);
    if (encoded) url.searchParams.set("keys", encoded);
    else url.searchParams.delete("keys");
    try {
      if (encoded) localStorage.setItem(keyframeStorage, encoded);
      else localStorage.removeItem(keyframeStorage);
    } catch { /* The preview URL also stores saved keyframes. */ }
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
  }, [entries, keyframeStorage, settings, frames, loaded]);

  if (!loaded) return null;

  return <ScenePreview {...props} definition={saved}>
    <style>{controlsCss + "\n" + hudCss}</style>
    {children}
    <CameraControls scene={scene} active={active} onActiveChange={enabled => {
      if (!enabled) edits.flush();
      setActive(enabled);
    }} definition={saved}
      travel={settings.travel} frames={frames}
      onTravel={travel => setSettings(previous => ({ ...previous, travel: bounded(travel, 0, 125) }))}
      onEdit={(edit, continuous) => {
        if (continuous) edits.schedule(edit);
        else {
          edits.flush();
          applyEdit(edit);
        }
      }}
      onSave={saveFrame}
      onRemove={timeMs => {
        edits.flush();
        setFrames(previous => previous.filter(frame => frame.timeMs !== timeMs));
      }}
      onMove={(from, to) => {
        edits.flush();
        setFrames(previous => {
          const source = previous.find(frame => frame.timeMs === from);
          if (!source || previous.some(frame => frame.timeMs === to)) return previous;
          return setCameraKeyframe(previous.filter(frame => frame !== source), { ...source, timeMs: to });
        });
      }}
      onDuplicate={(from, to) => {
        setFrames(previous => {
          const source = previous.find(frame => frame.timeMs === from);
          if (!source || previous.length >= keyframeLimit || previous.some(frame => frame.timeMs === to)) return previous;
          return setCameraKeyframe(previous, { ...source, timeMs: to });
        });
      }}
      onReset={() => setSettings(defaults)}/>
  </ScenePreview>;
}
