# Releasing `@midnight-rob/flute`

The checklist for shipping changes to this repo ([midnight-rob/flute](https://github.com/midnight-rob/flute)) and the npm package ([`@midnight-rob/flute`](https://www.npmjs.com/package/@midnight-rob/flute)). The README has the short version.

## Ground rules

- `main` is the release branch and the publish workflow only runs from it. Do feature work on a branch and merge when it is ready.
- **npm versions are immutable.** A version can never be re-published or changed. If something is wrong, ship a new patch version. Never reuse a version number or move a release tag.
- Source changes without a version bump do **not** update the npm package.
- Every commit that lands on `main` gets a message with a short subject and a body that says what changed and why. Commits are public.
- Never commit npm tokens or `.env` files. Publishing uses your npm login or OIDC trusted publishing.

## 1. Develop and verify locally

```sh
git switch -c my-change
npm ci
npm run typecheck
npm run test:architecture
npm run setup:local   # pack, install into local-project/, run flute init
npm run dev           # restart after every setup:local; the dev server caches the package
```

Check the change in the browser. The vitest suites (`npm run test:launch`, `test:react`) need a Node version where jsdom loads; if they fail with `ERR_REQUIRE_ESM` on your Node, run them on another 22.12+ release or in CI-like conditions and note in the commit if they could not run.

## 2. Commit

Split work into logical commits (feature, fix, docs, release). Format:

```
Short imperative subject (under 72 characters)

What changed and why, as a short paragraph or bullets.
Mention behaviour changes and anything not verified.
```

## 3. Prepare the release

1. Pick the version: patch for fixes, minor for features, major for breaking changes.
   ```sh
   npm version patch --no-git-tag-version   # or minor / major
   ```
2. Add an entry at the top of [CHANGELOG.md](CHANGELOG.md) under the new version (Added, Changed, Fixed).
3. Update the README if install steps, controls or behaviour changed.
4. Point `local-project/package.json` at the new tarball name (`midnight-rob-flute-<version>.tgz`) and run `npm run setup:local` so its lockfile updates.
5. Run the full gate: `npm run verify:release`. It needs Chromium (`npx playwright install chromium`) and FFmpeg, and writes logs to `.release/logs/`.
6. Build and inspect the artifact:
   ```sh
   npm run release:local          # writes .release/midnight-rob-flute-<version>.tgz
   node scripts/release.mjs check # validates identity, files and the CLI
   npm pack --dry-run             # should list only package.json, README.md, LICENSE and dist/
   ```
7. Commit the version, lockfiles, changelog and docs, for example `Release 0.1.6`, with a body summarising the changes.

## 4. Push to GitHub

```sh
git push origin main
git tag v<version>
git push origin v<version>
```

The tag must match `package.json` (`v0.1.6` for `0.1.6`). Optionally create release notes:

```sh
gh release create v<version> --generate-notes -R midnight-rob/flute
```

## 5. Publish to npm

Pick one route.

**Manual (works today):** from the clean, committed checkout:

```sh
npm publish .release/midnight-rob-flute-<version>.tgz --access public --ignore-scripts --otp=<code>
```

`node scripts/release.mjs publish` does the same after refusing to run with uncommitted changes. The account needs 2FA, so npm asks for a one-time code.

**GitHub Actions (optional, needs one-time setup):** [`publish.yml`](.github/workflows/publish.yml) publishes new versions from `main` using npm trusted publishing, with no stored token. Pushing `package.json`, `package-lock.json`, `scripts/release.mjs` or the workflow to `main` starts it. It first checks npm and skips versions that already exist. Setup, once:

1. Repo → Actions: enable workflows on the fork.
2. Repo → Settings → Environments: create `npm` and allow deployment from `main`.
3. npm → `@midnight-rob/flute` → Settings → Trusted publisher: owner `midnight-rob`, repository `flute`, workflow `publish.yml`, environment `npm`.

A failed run can be retried from Actions → Publish npm package → Run workflow on `main`.

## 6. Verify the published package

```sh
npm view @midnight-rob/flute version
npm run test:published   # installs the exact public version into a fresh app and checks it
```

## 7. Update consumers

- **Journey Studio** (`journey-studio/package.json`): change the dependency to the new version, run `npm install`, and check the `/flute` route and camera editor.
- Any project using a tarball: replace the archive under `vendor/`, update the dependency path and reinstall.

## Pulling in upstream changes

```sh
git fetch upstream
git merge upstream/main
```

Resolve conflicts in `src/preview/camera/` and the package scope, run the verification gate, add a changelog entry and release a new version as above.

## If a release goes wrong

- Bad version published: publish a fixed patch version. Use `npm deprecate @midnight-rob/flute@<version> "Use <fixed version>"` to warn users. Unpublishing is limited by npm policy and should be a last resort.
- Wrong tag pushed: delete the tag (`git push origin :refs/tags/v<version>`) only if the version was never published to npm. Otherwise leave it and release a new version.
- Wrong package contents: the packed-file allow-list in `scripts/release.mjs` rejects unexpected files. Fix `files` in `package.json` and rebuild before publishing.
