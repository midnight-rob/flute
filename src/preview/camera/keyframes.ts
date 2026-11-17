import {
  evaluateMotion,
  type MotionDefinition,
  type MotionTrack,
  type PreviewDefinition,
} from "../../core";

const cameraProperties = ["x", "y", "z", "rotateX", "rotateY", "rotateZ"] as const;
const lensProperties = ["distance", "fStop"] as const;
const poseProperties = [...cameraProperties, ...lensProperties] as const;

export type CameraPose = Record<(typeof poseProperties)[number], number>;
export type CameraKeyframe = { timeMs: number; pose: CameraPose };
export type CameraDefinition = PreviewDefinition & { motion: MotionDefinition };

export const keyframeLimit = 20;

export function poseAt(definition: CameraDefinition, authoredTime: number): CameraPose {
  const { camera, focus } = definition.scene;
  const sample = evaluateMotion(definition.motion, authoredTime / definition.motion.speed);
  return {
    ...camera,
    ...sample.camera,
    distance: sample.focus.distance ?? focus.distance,
    fStop: sample.focus.fStop ?? focus.fStop,
  };
}

export function setCameraKeyframe(frames: CameraKeyframe[], next: CameraKeyframe) {
  return [...frames.filter(frame => frame.timeMs !== next.timeMs), next]
    .sort((first, second) => first.timeMs - second.timeMs);
}

export function withCameraKeyframes(definition: CameraDefinition, frames: CameraKeyframe[]): CameraDefinition {
  if (!frames.length) return definition;

  const keyframesFor = (property: keyof CameraPose) => frames.map(({ timeMs, pose }) => ({
    timeMs, value: pose[property], easing: "cinematic" as const,
  }));
  const tracks: MotionTrack[] = [
    ...definition.motion.tracks.filter(track =>
      track.target.kind === "surface" ||
      (track.target.kind === "focus" && track.property !== "distance" && track.property !== "fStop"),
    ),
    ...cameraProperties.map(property => ({
      target: { kind: "camera" as const }, property, keyframes: keyframesFor(property),
    })),
    ...lensProperties.map(property => ({
      target: { kind: "focus" as const }, property, keyframes: keyframesFor(property),
    })),
  ];

  return { ...definition, motion: { ...definition.motion, tracks } };
}

export function encodeCameraKeyframes(frames: CameraKeyframe[]) {
  return frames.map(({ timeMs, pose }) =>
    [timeMs, ...poseProperties.map(key => Number(pose[key].toFixed(3)))].join(","),
  ).join(";");
}

export function decodeCameraKeyframes(encoded: string | null, durationMs: number, minFocus: number) {
  let frames: CameraKeyframe[] = [];
  for (const row of (encoded ?? "").split(";", keyframeLimit)) {
    const fields = row.split(",");
    if (fields.length !== poseProperties.length + 1 || fields.some(field => !field.trim())) continue;
    const [timeMs, ...values] = fields.map(Number);
    if (!Number.isInteger(timeMs) || timeMs < 0 || timeMs > durationMs ||
      values.some(value => !Number.isFinite(value) || Math.abs(value) > 10_000)) continue;

    const pose = Object.fromEntries(poseProperties.map((key, index) => [key, values[index]])) as CameraPose;
    if (pose.distance < minFocus || pose.fStop < 1.4 || pose.fStop > 16) continue;
    frames = setCameraKeyframe(frames, { timeMs, pose });
  }
  return frames;
}
