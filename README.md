# Flute · Connected fork

Cinematic 3D scenes made from your **real React UI**. Your coding agent composes the camera, depth, focus and motion. Flute provides the renderer, scene library, playback and MP4 export. Your app keeps its components, providers and styles.

This repository is a fork of [Flute by Web Prodigies](https://github.com/webprodigies-org/flute) that adds a hands-on **camera editor** to the preview: orbit, zoom, roll, aperture and focus controls, live pitch/yaw dials, and a keyframe timeline you can edit directly. It is published as [`@rob3rt0-connected/flute`](https://www.npmjs.com/package/@rob3rt0-connected/flute).

Open source under the [MIT license](LICENSE). Runs locally, with your existing coding agent. No account or AI subscription connection is needed in Flute.

- [What this fork adds](#what-this-fork-adds)
- [Install](#install)
- [Camera editor](#camera-editor)
- [Give your coding agent this prompt](#give-your-coding-agent-this-prompt)
- [Scenes and studio](#scenes-and-studio)
- [Export video](#export-video)
- [Other React hosts](#other-react-hosts-including-electron-renderers)
- [Develop Flute](#develop-flute)
- [Build and publish](#build-and-publish)
- [Staying in sync with upstream](#staying-in-sync-with-upstream)
- [Credits and license](#credits-and-license)

## What this fork adds

| Area | Behaviour |
| --- | --- |
| Camera editor | Animated scenes opened through `ProjectPreview` load their saved camera motion immediately. The editor starts collapsed; enable it from the **Camera** button. |
| Orbit dials | While you orbit (middle-button drag, or **Shift** + left drag on a trackpad), a vertical column of marks shows pitch and a horizontal ribbon shows yaw. The marks sit on the inner back surface of a sphere, so marks near the edges look closer and larger and marks near the centre look smaller and farther. The dials fade in after a short delay and out once you stop. |
| HUD controls | Circular HUD for zoom, roll, aperture and focus. Hold **Shift** for finer zoom, focus and roll drags or finer scroll zoom. |
| Automatic keyframes | Changing the camera at an empty point on the timeline creates a keyframe there; changing it at an existing keyframe updates it. There is no save or discard step. |
| Keyframe menu | Hover a timeline marker to set an exact time in seconds, duplicate it or delete it. Drag a marker to move it. The menu stays on screen even at the very start or end of the timeline. |
| Portable shots | Keyframes are stored per project and scene in the browser and carried in the preview URL (`keys`), so an export reproduces the same shot. |

Your scene components and recipes live in your app. The package ships the HUD graphics and styles.

## Install

Requires **React DOM 18.2+ or 19** and **Node 22.12+** for the CLI. The renderer is independent of your router and build tool. Setup has automatic connections for Next.js (App and Pages Router) and standard Vite projects; other React hosts use the same portable wrapper.

From your existing app's directory, **create a separate Git branch before installing**. Flute adds integration and scene files to your codebase, and a branch keeps those changes separate while you create and review your animations. Commit or stash existing work first.

```sh
git switch -c flute-scenes
npm install -D @rob3rt0-connected/flute
npx flute init
npm run dev
```

pnpm and yarn work the same way (`pnpm add -D @rob3rt0-connected/flute`, `pnpm exec flute init`).

### Install from a tarball

Use a tarball when you want to test an unpublished build or pin an exact archive in a private project. Build one from this checkout (see [Build and publish](#build-and-publish)), then install it:

```sh
npm install -D ./vendor/rob3rt0-connected-flute-0.1.4.tgz
npx flute init
```

Keep the archive inside the consuming project (for example `vendor/`) when its lockfile has to work on another machine or in CI. An archive stored outside the project must be available wherever that project installs dependencies.

### Migrating from `@webprodigies/flute`

Change your `@webprodigies/flute` and `@webprodigies/flute/preview` imports to `@rob3rt0-connected/flute` and `@rob3rt0-connected/flute/preview`. Then:

- `ProjectPreview` enables the camera editor on animated scenes by default. Pass `camera={{ sceneIds: ["your-scene"] }}` to limit it to particular scenes, or `camera={false}` to turn it off.
- Pass `storagePrefix` in that options object when migrating existing camera keys that use a custom namespace.
- Custom hosts can render `CameraPreview` from `@rob3rt0-connected/flute/preview` with their scene ID, preview definition and original scene children.

### Open the studio

Keep your existing dev server if it is already running and use the URL it prints:

```sh
npx flute open --url http://127.0.0.1:5173
```

In Next.js, open `/flute` on your dev server (usually port 3000). Setup adds this development-only route without rewriting your app, layout or providers. In Vite, setup connects the existing root. Both create `FLUTE.md`. Repeating setup is safe, and conflicting user-owned files get a repair message. Normal app routes and production builds stay ordinary. One installed app owns one scene catalog.

## Camera editor

Open a scene, then press **Camera** in the controls to enable the editor.

| Input | Action |
| --- | --- |
| Arrow keys | Pan the camera |
| Middle-button drag, or **Shift** + left drag | Orbit (shows the pitch/yaw dials) |
| Scroll wheel | Zoom |
| HUD rings and sliders | Zoom, roll, aperture, focus |
| **Shift** while dragging or scrolling | Fine adjustment |
| **K** or **+ Keyframe** | Add a keyframe at the current time |
| Hover a timeline marker | Edit its time, duplicate or delete it |
| Drag a timeline marker | Move the keyframe |

Edits made while the playhead is on an empty point create a keyframe automatically. Move the playhead first to decide where a change lands.

## Give your coding agent this prompt

> Read FLUTE.md and run `npx flute guide --json`. Inspect this app's real dashboard page and create a cinematic Flute scene from its existing components. Choose intentional close perspective, camera travel and depth of field. Preserve the app's design and providers. Verify it in the browser, save a snapshot, and give me the scene URL.

Replace "dashboard" with the page you want. Claude Code, Codex CLI or another repository-capable agent can use the same installed guide. Flute does not run or authenticate the agent for you.

The guide explains concepts, tradeoffs, exact APIs and a tested file-pair example. It leaves the composition to the creator. Ask your agent to revise the source when you want a different shot.

## Scenes and studio

The agent creates `src/flute/scenes/my-shot.scene.json` and a matching `my-shot.tsx` or `my-shot.jsx` (one component per recipe). The JSON owns the scene definition. The component imports actual host UI and returns stable `Surface` elements. The shared studio supplies the camera renderer, playback and capture, with no separate scene editor or duplicated renderer.

Outside Vite, run `npx flute sync` after adding or removing scene pairs. Existing file edits use your host's hot reload. Open the scene library, select a scene, play or seek, and revise its source through your running dev server.

```sh
npx flute scenes
npx flute open --scene my-shot --url http://127.0.0.1:5173
npx flute snapshot --scene my-shot --url http://127.0.0.1:5173
```

Snapshots cache rendered local pixels in the recipe. Refresh them after visual changes, because they may include visible app data.

## Export video

Install FFmpeg on your system and Chromium once:

```sh
npx playwright install chromium
```

The studio's Export control supplies the command for the selected scene. For example:

```sh
npx flute export --url 'http://127.0.0.1:5173/?flute-preview=1&flute-scene=my-shot' --output my-shot.mp4 --fps 60
```

30, 60 and 120 FPS are supported. Export samples the live scene deterministically and excludes studio controls. Choose a new output filename, since existing files are not overwritten. Keep the host server running. Camera depth of field uses a performant DOM blur approximation, not ray-traced bokeh.

## Other React hosts (including Electron renderers)

Run `npx flute init --adapter react`. Setup creates a framework-independent wrapper and tells your agent how to connect it. It deliberately does not guess or replace your application root:

```jsx
import { FluteProjectPreview } from "./flute/ProjectPreview";

<ExistingProviders>
  <FluteProjectPreview enabled={yourDevelopmentFlag}>
    <ExistingApp />
  </FluteProjectPreview>
</ExistingProviders>
```

For production bundle exclusion, have your agent load the generated module only behind your bundler's compile-time development condition. The `enabled` prop is a runtime guard, not a substitute for removing development imports. Next and Vite automatic connections include their native compile-time guards.

Use your host's actual development flag, then open its route with `?flute-preview=1`. For a dedicated route, pass `active`. This uses the existing React renderer, including Electron's renderer process, with no changes to main/preload, security settings or build tools. A React Native application without browser DOM is not supported.

The underlying `ProjectPreview` export accepts `projectId`, `enabled`, optional `active`, `sceneModules` (lazy module loaders) and `children`. This is the shared integration contract. Named framework connections are conveniences, not renderer dependencies. Next.js scene bindings are client components, so keep server-only imports in the host's server layer and supply their data through that boundary.

## Develop Flute

Use Node 22.12 or newer.

```sh
npm ci
npm run verify:agent
npm run build
npm run setup:local
npm run dev
```

`npm run setup:local` packs the current source, installs it into the isolated `local-project/` and runs `flute init` there. Re-run it after every change, then restart `npm run dev`, because the dev server caches the installed package. `local-project/` exercises installation with real scenes and is not shipped in the package. The unconnected product opens with an honest empty scene list.

Camera editor code lives in `src/preview/camera/`:

| File | Role |
| --- | --- |
| `CameraPreview.tsx` | Editor state, keyframe commits, timeline and keyboard shortcuts |
| `CameraHud.tsx` | Circular HUD for zoom, roll, aperture and focus |
| `CameraAttitudeDial.tsx` | Pitch and yaw dials projected on a sphere |
| `keyframes.ts` | Keyframe encoding for the URL and local storage |
| `camera-controls.css`, `camera-hud.css` | Dock, timeline and HUD styles |

Read [architecture](docs/architecture.md) for canonical code owners and [product](docs/product.md) for scope. The installed `flute guide` is the authoritative authoring reference. Build and boundary checks reject architectural drift. See the [changelog](CHANGELOG.md) for release history.

## Build and publish

### Build a tarball

```sh
npm ci
npm run release:local
```

This runs the `prepack` build (architecture check, type-check, library and CLI builds) and writes `rob3rt0-connected-flute-<version>.tgz` into `.release/`. Inspect what would ship, which is only `package.json`, `README.md`, `LICENSE` and `dist/`:

```sh
npm pack --dry-run
```

### Publish to npm

1. Update the version with `npm version patch --no-git-tag-version` (or `minor`) and add an entry to [CHANGELOG.md](CHANGELOG.md).
2. Run the local verification suite: `npm run verify:release`. It includes architecture, browser, installed-app, export and hardware checks, with logs in `.release/logs/`. Chromium and FFmpeg are required.
3. Commit the version, lockfile and changelog, then push to `main`.

Two ways to publish:

- **Manually:** from the clean committed candidate, run `npm run release:publish` and complete npm's private authentication prompt.
- **GitHub Actions:** [`publish.yml`](.github/workflows/publish.yml) publishes new versions from `main` through npm trusted publishing (OIDC), so no token is stored. It checks npm first and stops if the version already exists. Configure the trusted publisher on npm with GitHub owner `rob3rt0-connected`, repository `flute`, workflow `publish.yml` and environment `npm`, and let the GitHub `npm` environment deploy from `main`. Never commit npm tokens.

npm versions are immutable, so changing source without a version bump does not update the public package. After publishing, run `npm run test:published` to check the exact public version in a fresh installed app.

Code-only and documentation-only pushes do not start a workflow. Package or lockfile changes can trigger the small version lookup. A failed release can be retried from Actions → Publish npm package → Run workflow on `main`.

## Staying in sync with upstream

```sh
git remote add upstream https://github.com/webprodigies-org/flute.git
git fetch upstream
git merge upstream/main
```

Resolve conflicts in `src/preview/camera/` and the package scope, re-run `npm run verify:agent`, bump the version and tag a release.

## Credits and license

Flute is created by [Web Prodigies](https://www.youtube.com/@webprodigies). This fork keeps their MIT license and adds the Connected camera editor. Source: [rob3rt0-connected/flute](https://github.com/rob3rt0-connected/flute). Upstream: [webprodigies-org/flute](https://github.com/webprodigies-org/flute).

Released under the [MIT license](LICENSE).
