import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { useFrameBatch } from "./useFrameBatch";

const ringAssets = import.meta.glob<string>("./assets/zoom-ring-*.svg", {
  eager: true, query: "?inline", import: "default",
});

export const hudRanges = {
  zoom: { min: -300, max: 1500, step: 5 },
  aperture: { min: 1.4, max: 16, step: 0.1 },
  roll: { min: -90, max: 90, step: 1 },
};

type HudControl = keyof typeof hudRanges;
export type CameraHudControl = HudControl | "focus";
type HudValues = Record<HudControl, number>;
type CircleControl = "zoom" | "focus";
type DragControl = CircleControl | "roll";

const diameter = 505;
const radius = diameter / 2;
const horizonWidth = 1569;
const rollDisplayLimit = 3;
const fineAdjustment = 0.2;
const rollTickCount = 33;
const rollTickStep = 1.75;
const circleLimits = {
  zoom: { min: -50, max: 450, ringInterval: 170 },
  focus: { min: 700, max: 2400, ringInterval: 450 },
};
const ringLayers = [
  ["zoom-ring-inner-3", 363], ["zoom-ring-inner-2", 411], ["zoom-ring-inner-1", 451],
  ["zoom-ring-outer-1", 547], ["zoom-ring-outer-2", 607], ["zoom-ring-outer-3", 701],
] as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function fraction(value: number, min: number, max: number) {
  return clamp((value - min) / (max - min), 0, 1);
}

function tunnelRingStyle(index: number, assetSize: number, travel: number) {
  const count = ringLayers.length;
  // Recycle each ring at the ends of the tunnel after it fades out.
  const position = (((index + 0.5 + travel) % count) + count) % count;
  const depth = 1 - position / count;
  const projectedDiameter = diameter * 0.65 / (0.44 + depth * 0.56);
  return {
    "--guide-scale": projectedDiameter / assetSize,
    opacity: Math.min(1, 2 * position, 2 * (count - position)),
  };
}

function polar(angle: number, distance: number) {
  const radians = angle * Math.PI / 180;
  return { x: Math.cos(radians) * distance, y: Math.sin(radians) * distance };
}

function ringPosition(angle: number) {
  const { x, y } = polar(angle, radius);
  return { left: radius + x, top: radius + y };
}

function angleAt(x: number, y: number) {
  return Math.atan2(y, x) * 180 / Math.PI;
}

function angleDifference(to: number, from: number) {
  return (to - from + 540) % 360 - 180;
}

function rollTickStyle(index: number, radius: number, overflow: number) {
  const span = rollTickCount * rollTickStep;
  const shifted = (index + 0.5) * rollTickStep + overflow / 2;
  const position = ((shifted % span) + span) % span;
  return {
    transform: `rotate(${position - span / 2}deg) translateX(${radius}px)`,
    opacity: Math.min(1, position / rollTickStep, (span - position) / rollTickStep),
  };
}

type HudDrag = {
  id: number;
  x: number;
  y: number;
  originX: number;
  originY: number;
  moved: boolean;
} & (
  | { control: CircleControl; start: number; lastDistance: number; distance: number }
  | { control: "roll"; start: number; value: number; lastAngle?: number | null }
);

function controlAt(target: EventTarget | null) {
  if (target instanceof Element) {
    return target.closest<HTMLElement>("[data-hud-control]")?.dataset.hudControl as CameraHudControl | undefined;
  }
}

export function CameraNumber({ label, value, decimals = 0, unit, onCommit }: {
  label: string;
  value: number;
  decimals?: number;
  unit: string;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const display = text ?? value.toFixed(decimals);

  return <label className="flute-camera-number">
    <span>{label}</span>
    <span className="flute-camera-number-field">
      <input type="text" inputMode="decimal" value={display} size={Math.max(1, display.length)} maxLength={12}
        onFocus={event => event.currentTarget.select()}
        onChange={event => setText(event.currentTarget.value)}
        onBlur={() => {
          const next = Number(text);
          if (text?.trim() && Number.isFinite(next) && next !== value) onCommit(next);
          setText(null);
        }}
        onKeyDown={event => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape" && text !== null) {
            event.stopPropagation();
            setText(null);
          }
        }}/>
      <span aria-hidden="true">{unit}</span>
    </span>
  </label>;
}

export function CameraHud({ values, focus, onChange, onFocusChange, lockedControl, onLockChange, children }: {
  values: HudValues;
  focus: { distance: number; min: number; max: number };
  onChange: (control: HudControl, value: number, continuous: boolean) => void;
  onFocusChange: (distance: number, continuous: boolean) => void;
  lockedControl: CameraHudControl | null;
  onLockChange: (control: CameraHudControl | null) => void;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const circle = useRef<HTMLDivElement>(null);
  const drag = useRef<HudDrag | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [rollTilt, setRollTilt] = useState<number | null>(null);
  const rollPreview = useFrameBatch<number>(setRollTilt);
  const circleControl = lockedControl === "focus" ? "focus" : "zoom";
  const rollLocked = lockedControl === "roll";

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const hud = root.current;
    const viewport = hud?.parentElement;
    if (!hud || !viewport) return;

    const clearHover = () => hud.removeAttribute("data-hovered");

    const circleSectionAt = (event: globalThis.MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.classList.contains("flute-camera-surface")) return;

      const bounds = circle.current?.getBoundingClientRect();
      if (!bounds) return;
      const x = event.clientX - (bounds.left + bounds.width / 2);
      const y = event.clientY - (bounds.top + bounds.height / 2);
      const section = y < 0 ? "zoom" : "focus";
      const reach = hud.dataset.circleControl === section ? bounds.width * 0.74 : bounds.width / 2;
      if (Math.hypot(x, y) <= reach) return section;
    };

    const highlight = (event: globalThis.PointerEvent) => {
      if (event.pointerType === "touch" || lockedControl) return;
      const section = controlAt(event.target) ?? circleSectionAt(event);
      if (section) {
        if (hud.dataset.hovered !== section) hud.dataset.hovered = section;
      } else clearHover();
    };

    const select = (event: globalThis.MouseEvent) => {
      if (event.shiftKey) return;
      const section = circleSectionAt(event);
      if (section && section !== lockedControl) onLockChange(section);
    };

    clearHover();
    viewport.addEventListener("pointermove", highlight);
    viewport.addEventListener("pointerleave", clearHover);
    viewport.addEventListener("click", select);
    return () => {
      viewport.removeEventListener("pointermove", highlight);
      viewport.removeEventListener("pointerleave", clearHover);
      viewport.removeEventListener("click", select);
    };
  }, [lockedControl, onLockChange]);

  const { zoom, aperture, roll } = values;
  const dragValues = { zoom, roll, focus: focus.distance };
  const dragRanges = { zoom: hudRanges.zoom, roll: hudRanges.roll, focus: { min: focus.min, max: focus.max, step: 5 } };
  const preferredDiameter = Math.max(size.width * 0.205, Math.min(size.width * 0.44, 195));
  const baseDiameter = Math.min(preferredDiameter, size.height * 0.34, 260);
  const limits = circleLimits[circleControl];
  const circleValue = dragValues[circleControl];
  const displayValue = clamp(circleValue, limits.min, limits.max);
  const displayProgress = fraction(displayValue, limits.min, limits.max);
  const scale = baseDiameter / diameter * (0.88 + displayProgress * 0.24);
  const tunnelTravel = (circleValue - displayValue) / limits.ringInterval;
  const rollRadius = Math.min(size.width * 0.405, size.height * 0.72);
  const displayRoll = rollLocked ? rollTilt ?? 0 : 0;
  const rollOverflow = roll - clamp(roll, -rollDisplayLimit, rollDisplayLimit);
  const rollAngle = Math.round(Math.abs(roll) * 10) / 10;
  const rollDisplay = rollAngle === 0 ? "0°" : `${roll > 0 ? "+" : "−"}${rollAngle}°`;

  function commit(control: CameraHudControl, value: number, continuous = false) {
    if (lockedControl !== control) return;
    const { min, max } = control === "focus" ? focus : hudRanges[control];
    const next = clamp(value, min, max);
    if (control === "focus") {
      if (continuous || next !== focus.distance) onFocusChange(next, continuous);
    } else if (continuous || next !== values[control]) onChange(control, next, continuous);
  }

  function start(control: DragControl, event: PointerEvent<HTMLElement>) {
    if (lockedControl !== control || event.button !== 0 || !event.isPrimary || drag.current) return;
    const bounds = root.current?.getBoundingClientRect();
    if (!bounds) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const pointer = {
      id: event.pointerId, x: event.clientX, y: event.clientY, moved: false,
      originX: bounds.left + bounds.width / 2, originY: bounds.top + bounds.height / 2,
    };
    if (control === "roll") {
      const start = clamp(roll, hudRanges.roll.min, hudRanges.roll.max);
      drag.current = { ...pointer, control, start, value: start };
    } else {
      drag.current = { ...pointer, control, start: dragValues[control], lastDistance: 0, distance: 0 };
    }
  }

  function move(event: PointerEvent<HTMLElement>) {
    const gesture = drag.current;
    if (!gesture || gesture.control !== lockedControl || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.moved && Math.hypot(dx, dy) < 3) return;
    gesture.moved = true;

    const x = gesture.x - gesture.originX;
    const y = gesture.y - gesture.originY;
    const angle = angleAt(x, y);
    const { control } = gesture;
    const { min, max } = dragRanges[control];
    const sensitivity = event.shiftKey ? fineAdjustment : 1;
    if (control !== "roll") {
      const startValue = clamp(gesture.start, min, max);
      const direction = polar(angle, 1);
      const distance = dx * direction.x + dy * direction.y;
      gesture.distance += (distance - gesture.lastDistance) * sensitivity;
      gesture.lastDistance = distance;
      const dragRange = Math.max(96, baseDiameter * 0.48);
      commit(control, Math.round(startValue + gesture.distance / dragRange * (max - min)), true);
    } else {
      if (Math.hypot(x, y) < 16) return;
      if (Math.hypot(x + dx, y + dy) < 16) {
        gesture.lastAngle = null;
        return;
      }
      const nextAngle = angleAt(x + dx, y + dy);
      const previousAngle = gesture.lastAngle === undefined ? angle : gesture.lastAngle ?? nextAngle;
      gesture.lastAngle = nextAngle;
      gesture.value = clamp(gesture.value + angleDifference(nextAngle, previousAngle) * 2 * sensitivity, min, max);
      rollPreview.schedule(clamp(gesture.value - gesture.start, -rollDisplayLimit, rollDisplayLimit));
      commit(control, Math.round(gesture.value * 10) / 10, true);
    }
  }

  function finish(event: PointerEvent<HTMLElement>) {
    const gesture = drag.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    if (gesture.control === "roll") {
      rollPreview.take();
      setRollTilt(null);
    }
    drag.current = null;
  }

  function adjust(control: DragControl, event: KeyboardEvent<HTMLElement>) {
    const { min, max, step } = dragRanges[control];
    const value = dragValues[control];
    switch (event.key) {
      case "ArrowLeft": case "ArrowDown": commit(control, Number((value - step).toFixed(1))); break;
      case "ArrowRight": case "ArrowUp": commit(control, Number((value + step).toFixed(1))); break;
      case "Home": commit(control, min); break;
      case "End": commit(control, max); break;
      default: return;
    }
    event.preventDefault();
  }

  function selectOnClick(event: MouseEvent<HTMLDivElement>) {
    const control = controlAt(event.target);
    if (!control || lockedControl === control) return;
    event.preventDefault();
    event.stopPropagation();
    onLockChange(control);
    if (event.target instanceof Element) {
      event.target.closest<HTMLElement>("button, input, [role='slider']")?.focus({ preventScroll: true });
    }
  }

  function dragHandle(control: CircleControl, label: string, angle: number) {
    const { min, max } = dragRanges[control];
    const value = dragValues[control];
    return <div className={`flute-hud-handle flute-hud-${control}-handle`}
      style={ringPosition(angle)} role="slider" tabIndex={0} aria-label={label}
      title={lockedControl !== control ? undefined
        : control === "zoom" ? "Drag outward to zoom in" : "Drag outward to focus farther, inward to focus nearer"}
      aria-valuemin={Math.min(min, value)} aria-valuemax={Math.max(max, value)}
      aria-valuenow={value} aria-valuetext={`${Math.round(value)} pixels`}
      onPointerDown={event => start(control, event)} onPointerMove={move}
      onLostPointerCapture={finish} onKeyDown={event => adjust(control, event)}/>;
  }

  const tunnelRings = ringLayers.map(([asset, size], index) => <span key={asset} aria-hidden="true" className="flute-hud-ring flute-hud-ring-guide"
    style={{
      width: size,
      height: size,
      maskImage: `url("${ringAssets[`./assets/${asset}.svg`]}")`,
      ...tunnelRingStyle(index, size, tunnelTravel),
    } as CSSProperties}/>);

  return <div className="flute-camera-hud" ref={root} data-circle-control={circleControl} data-locked={lockedControl ?? undefined}
    role="group" aria-label="Camera HUD" data-flute-preview-chrome
    onPointerDownCapture={event => {
      const control = controlAt(event.target);
      if (!control || lockedControl === control) return;
      event.preventDefault();
      event.stopPropagation();
    }}
    onClickCapture={selectOnClick}
    onKeyDownCapture={event => {
      const control = controlAt(event.target);
      if (!control || lockedControl === control || event.key === "Tab" || event.key === "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat && (event.key === "Enter" || event.key === " ")) onLockChange(control);
    }}
    onKeyDown={event => {
      if (event.key !== "Escape" || !lockedControl || event.defaultPrevented) return;
      event.preventDefault();
      onLockChange(null);
    }}>
    {scale > 0 && <>
      <div className="flute-hud-circle" ref={circle} style={{
        transform: `translate(-50%, -50%) scale(${scale})`,
        "--inverse-circle-scale": 1 / scale,
      } as CSSProperties}>
        <span className="flute-hud-ring flute-hud-ring-main" aria-hidden="true"/>
        <div className="flute-hud-section flute-hud-zoom-section" data-hud-control="zoom">
          {circleControl === "zoom" && tunnelRings}
          <div className="flute-hud-zoom-value">
            <CameraNumber label="Zoom" value={zoom} unit="px"
              onCommit={value => commit("zoom", value)}/>
          </div>
          {dragHandle("zoom", "Drag zoom", -28)}
        </div>
        <div className="flute-hud-section flute-hud-focus-section" data-hud-control="focus">
          {circleControl === "focus" && tunnelRings}
          <div className="flute-hud-focus-value">
            <CameraNumber label="Focus" value={focus.distance} unit="px"
              onCommit={value => commit("focus", value)}/>
          </div>
          {dragHandle("focus", "Focus distance", 28)}
        </div>
      </div>
      {rollLocked && <div className="flute-hud-roll-ticks" aria-hidden="true">
        {Array.from({ length: rollTickCount }, (_, index) =>
          <i key={index} style={rollTickStyle(index, rollRadius, rollOverflow)}/>)}
      </div>}
      <div className="flute-hud-horizon" data-roll-dragging={rollLocked && rollTilt !== null ? "" : undefined}
        style={{ transform: `rotate(${displayRoll}deg)` }}>
        <button type="button" className="flute-hud-roll-line" data-hud-control="roll" aria-label="Camera roll" aria-pressed={rollLocked}
          title={rollLocked ? "Drag to roll" : undefined}
          onPointerDown={event => start("roll", event)} onPointerMove={move} onLostPointerCapture={finish}
          onKeyDown={event => {
            if (rollLocked) adjust("roll", event);
          }}>
          <span aria-hidden="true" style={{ transform: `translate(-50%, -50%) scaleX(${size.width * 0.92 / horizonWidth})` }}/>
        </button>
        <div className="flute-hud-aperture" data-hud-control="aperture" style={{
          "--aperture-clearance": `${radius * scale + 12}px`,
          "--aperture-label-angle": `${-displayRoll}deg`,
        } as CSSProperties}>
          <CameraNumber label="Aperture" value={aperture} decimals={1} unit="f/"
            onCommit={value => commit("aperture", value)}/>
          <input className="flute-hud-aperture-slider" type="range" aria-label="Aperture f-stop"
            title={lockedControl === "aperture" ? "Drag left to open the aperture or right to close it" : undefined}
            min={hudRanges.aperture.min} max={hudRanges.aperture.max} step={hudRanges.aperture.step} value={aperture}
            aria-valuetext={`f/${aperture.toFixed(1)}`}
            onChange={event => commit("aperture", event.currentTarget.valueAsNumber, true)}/>
        </div>
        <div className="flute-hud-roll-end" data-hud-control="roll"
          style={{ left: `calc(50% + ${rollRadius}px)`, transform: `translate(-50%, -50%) rotate(${-displayRoll}deg)` }}>
          <button type="button" className="flute-hud-handle flute-hud-roll-reset"
            aria-label="Reset camera roll" title={rollLocked ? "Reset roll to 0°" : undefined}
            onClick={() => commit("roll", 0)}/>
          {rollLocked && <output aria-label="Camera roll angle">{rollDisplay}</output>}
        </div>
      </div>
      {children && <details className="flute-hud-more">
        <summary>Motion</summary>
        <div className="flute-camera-overlay">{children}</div>
      </details>}
    </>}
  </div>;
}
