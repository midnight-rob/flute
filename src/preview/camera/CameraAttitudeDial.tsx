import { useEffect, useRef, useState, type CSSProperties } from "react";

type Axis = "pitch" | "yaw";

const degreesPerTick = 3;
const visibleHalfAngle = 74;
const showDelayMs = 70;
const hideDelayMs = 650;
const smoothing = 0.28;

/** Eases a displayed angle toward its target so pointer steps read as continuous motion. */
function useSmoothed(target: number) {
  const [value, setValue] = useState(target);
  const current = useRef(target);

  useEffect(() => {
    let frame = 0;
    const step = () => {
      const remaining = target - current.current;
      current.current = Math.abs(remaining) < 0.01 ? target : current.current + remaining * smoothing;
      setValue(current.current);
      if (current.current !== target) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return value;
}

/** True shortly after `value` starts changing, and false again once it has been still for a moment. */
function useRecentChange(value: number, enabled: boolean) {
  const previous = useRef(value);
  const shown = useRef(false);
  const timers = useRef<{ show?: number; hide?: number }>({});
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const changed = value !== previous.current;
    previous.current = value;
    if (!changed || !enabled) return;
    const pending = timers.current;
    if (!shown.current && pending.show === undefined) {
      pending.show = window.setTimeout(() => {
        pending.show = undefined;
        shown.current = true;
        setVisible(true);
      }, showDelayMs);
    }
    window.clearTimeout(pending.hide);
    pending.hide = window.setTimeout(() => {
      window.clearTimeout(pending.show);
      pending.show = undefined;
      shown.current = false;
      setVisible(false);
    }, hideDelayMs);
  }, [value, enabled]);

  useEffect(() => () => {
    window.clearTimeout(timers.current.show);
    window.clearTimeout(timers.current.hide);
  }, []);

  return visible;
}

const halfAngleRadians = visibleHalfAngle * Math.PI / 180;
const markHalfLength = 0.035;

type Vec = [number, number, number];
type Camera = { eye: Vec; pitch: number };

// The sphere has radius 1 and sits at the origin; the eye is inside it, facing the far inner surface.
// Yaw is seen from above and looking down, so its ribbon forms a curved arc whose far centre rides high.
// Pitch is seen straight on, so its column stays centred.
const cameras: Record<Axis, Camera> = {
  pitch: { eye: [0, 0, 0.5], pitch: 0 },
  yaw: { eye: [0, 0.13, 0.5], pitch: 0.08 },
};

function toScreen({ eye, pitch }: Camera, point: Vec) {
  const x = point[0] - eye[0], y = point[1] - eye[1], z = point[2] - eye[2];
  const sin = Math.sin(pitch), cos = Math.cos(pitch);
  const depth = -y * sin - z * cos;
  return { x: x / depth, y: -(y * cos - z * sin) / depth, depth };
}

/** Point on the far inner surface at `radians` along the axis' great circle (longitude for yaw, latitude for pitch). */
function surfacePoint(axis: Axis, radians: number): Vec {
  return axis === "yaw"
    ? [Math.sin(radians), 0, -Math.cos(radians)]
    : [0, Math.sin(radians), -Math.cos(radians)];
}

function projector(axis: Axis) {
  const camera = cameras[axis];
  const origin = toScreen(camera, surfacePoint(axis, 0));
  const edge = toScreen(camera, surfacePoint(axis, halfAngleRadians));
  const extent = axis === "yaw" ? Math.abs(edge.x) : Math.abs(edge.y - origin.y);
  return {
    camera, origin, extent,
    edgeNearness: origin.depth / edge.depth,
  };
}

const projectors = { pitch: projector("pitch"), yaw: projector("yaw") };

/** Screen-space centre, length and angle of one mark, plus how near it is (1 at the far centre). */
function markGeometry(axis: Axis, radians: number, reach: number, lift: number) {
  const { camera, origin, extent } = projectors[axis];
  const centre = surfacePoint(axis, radians);
  // Yaw marks run up and down; pitch marks run side to side. Both keep a fixed length on the sphere.
  const span: Vec = axis === "yaw" ? [0, markHalfLength, 0] : [markHalfLength, 0, 0];
  const start = toScreen(camera, [centre[0] - span[0], centre[1] - span[1], centre[2] - span[2]]);
  const end = toScreen(camera, [centre[0] + span[0], centre[1] + span[1], centre[2] + span[2]]);
  const unit = reach / extent;
  const x = ((start.x + end.x) / 2 - origin.x) * unit;
  const y = ((start.y + end.y) / 2 - origin.y) * unit - lift;
  const dx = (end.x - start.x) * unit, dy = (end.y - start.y) * unit;
  return {
    x, y,
    length: Math.hypot(dx, dy),
    angle: Math.atan2(dy, dx),
    near: origin.depth / toScreen(camera, centre).depth,
  };
}

function Dial({ axis, value, enabled, reach, lift }: { axis: Axis; value: number; enabled: boolean; reach: number; lift: number }) {
  const visible = useRecentChange(value, enabled);
  const angle = useSmoothed(value);
  const base = Math.round(angle / degreesPerTick);
  const count = Math.ceil(visibleHalfAngle / degreesPerTick);
  const { edgeNearness } = projectors[axis];
  const ticks = [];

  for (let k = -count; k <= count; k++) {
    const index = base + k;
    const offset = (index * degreesPerTick - angle) * (axis === "pitch" ? -1 : 1);
    if (Math.abs(offset) > visibleHalfAngle) continue;
    const mark = markGeometry(axis, offset * Math.PI / 180, reach, lift);
    ticks.push(<i key={index}
      data-zero={index === 0 ? "" : undefined}
      style={{
        "--tick-x": `${mark.x}px`,
        "--tick-y": `${mark.y}px`,
        "--tick-length": `${mark.length}px`,
        "--tick-angle": `${mark.angle}rad`,
        "--tick-thickness": `${Math.min(2, mark.near)}px`,
        opacity: Math.min(1, 0.42 + 0.58 * (mark.near - 1) / (edgeNearness - 1)),
      } as CSSProperties}/>);
  }

  return <div className="flute-hud-dial" data-axis={axis} data-visible={visible ? "" : undefined}
    style={{ "--dial-reach": `${reach}px` } as CSSProperties}>
    {ticks}
  </div>;
}

export function CameraAttitudeDial({ pitch, yaw, active, width, height }: {
  pitch: number;
  yaw: number;
  active: boolean;
  width: number;
  height: number;
}) {
  if (width <= 0 || height <= 0) return null;
  return <div className="flute-hud-attitude" aria-hidden="true">
    <Dial axis="pitch" value={pitch} enabled={active} reach={Math.min(height * 0.4, 360)} lift={0}/>
    <Dial axis="yaw" value={yaw} enabled={active} reach={Math.min(width * 0.36, 640)} lift={Math.min(height * 0.075, 46)}/>
  </div>;
}
