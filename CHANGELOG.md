# Changelog

All notable changes to `@midnight-rob/flute` are listed here. The project follows [semantic versioning](https://semver.org/). This fork is based on [Flute by Web Prodigies](https://github.com/webprodigies-org/flute) 0.1.2.

## 0.1.5

### Changed
- The package moved to the `@midnight-rob` scope (`@midnight-rob/flute`) and the source to [midnight-rob/flute](https://github.com/midnight-rob/flute) after the GitHub account was renamed. Update imports from `@rob3rt0-connected/flute` to `@midnight-rob/flute`.
- This is the first version published to npm. It includes everything from 0.1.4 below; 0.1.4 was only tagged on GitHub and never published.

## 0.1.4

### Added
- Pitch and yaw dials in the camera HUD. They appear only while orbiting (middle-button drag or Shift + left drag), drawn as marks on the inner back surface of a sphere with perspective, and fade in and out smoothly.
- `attitude` prop on `CameraHud` (`{ pitch, yaw, active }`) to drive the dials.

### Changed
- Camera edits create or update a keyframe automatically at the current time. The unsaved-draft flow is gone, including the keyframe count, **Save keyframe**, **Discard** and **Revert draft** controls and the export guard that blocked export during a draft.
- **+ Keyframe** and **K** now only add a keyframe at the current time when none exists there.
- The focus slider's maximum is computed once per scene, so its range no longer changes while a keyframe is edited.

### Fixed
- The keyframe hover menu is no longer clipped for keyframes at the very start or end of the timeline.

## 0.1.3

### Changed
- Continuous camera edits are batched per animation frame for smoother HUD drags and orbiting.
- Improved zoom, focus and roll response, with Shift for finer steps.

## 0.1.2 and earlier

- Camera editor with HUD controls and a keyframe timeline, published under the `@rob3rt0-connected` scope. Keyframes are stored per project and scene in the browser and carried in the preview URL.
- Everything before the fork comes from Flute 0.1.2 by Web Prodigies.
