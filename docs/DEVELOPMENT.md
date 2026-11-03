# Development, transfer and releases

This repository contains one shared core and two independently released products. The root package is the public npm CLI, named **`finder-selection-sync`**. The private `electron/` package has its own dependencies, lockfile, version and build configuration. Existing CLI commands and arguments remain compatible.

Write repository documentation in English.

## 1. Transfer the project to another Mac

From the repository root, run:

```bash
npm run transfer
```

Transfer both the generated `.tar.gz` and its `.sha256` file from `transfer/` to the other Mac. The archive includes current uncommitted changes, new source files, tests, language packs, release workflows and existing Git history. Unlike `git archive`, it does not require committing new work before transferring it.

Dependencies, build outputs, installers, machine-specific account settings, Git hooks and the original remote configuration are excluded. Historical commit authors remain intact; future commits use the identity configured on the destination Mac. Application preferences, selected folder paths and photo files are not part of the source archive.

On the destination Mac, verify the archive with `shasum -a 256 -c <archive-name>.sha256`, extract it, and open the resulting `finder-selection-sync/` directory.

## 2. Install dependencies and develop

Use macOS and Node.js 24. If nvm is installed:

```bash
nvm install
nvm use
npm ci
npm run setup:desktop
npm run test:all
npm start
```

Without nvm, install Node.js 24 and start with `npm ci`. CLI-only development does not require desktop dependencies:

```bash
npm ci
npm test
node bin/finder-selection-sync.js --help
```

- `src/`: shared matching, Finder tag read/write, cleanup rules and execution. Both the CLI and Electron use this code.
- `bin/`: CLI entry point. The root `package.json` defines the npm package, executable and public module exports.
- `electron/service.js`: adapts the shared core to previews, checked rows, progress and cancellation.
- `electron/main.js` / `preload.cjs`: windows, IPC, file dialogs and operating system integration.
- `electron/renderer/`: React 19, shadcn/ui and styles. The shadcn, Vite, TypeScript and Vitest configuration files also live in `electron/`.
- `electron/locales/`: `en-US.json`, `zh-CN.json`, `ja-JP.json` and additional language packs. Japanese is available from the language menu and is selected on first launch when the system language is Japanese.
- Root `test/`: CLI/core tests. `electron/test/`: desktop service and packaging tests. `electron/renderer/tests/`: UI tests.

During development, `electron/node_modules/finder-selection-sync` links to the repository root, so changing the core does not require publishing it. `prepare-app.mjs` stages a standalone app in `electron/.build/app/`, including the current shared core and its own package metadata. Installed apps need neither that development link nor access to npm. Do not maintain a second copy of the core or edit generated staging files.

Preserve the current UI behavior when making structural changes: automatic previews with skeleton loading; a stationary title toggle for folder options; fully clickable path regions with clear/reveal controls in all three modes; expanded preview, image thumbnails/viewer and row context menus; horizontal tag dots with a hollow circle for untagged files.

## 3. Use the destination computer's GitHub account

The transfer archive has no configured remote. Sign in to GitHub on the destination Mac. With GitHub CLI, use `gh auth login` and confirm the active account with `gh auth status`.

Create an empty repository on GitHub, then configure this checkout's author identity and remote. Replace these example values manually:

```bash
git config user.name "Your Name"
git config user.email "your-email@example.com"
git remote add origin https://github.com/example/finder-selection-sync.git
git status
git add .
git commit -m "Separate CLI and Electron development and releases"
git push -u origin main
```

If you copied the original project directory instead of using the transfer archive, check `git remote -v` first. To replace an existing remote, use `git remote set-url origin <your-repository-url>`.

Before publishing, update the root `package.json` fields `repository`, `homepage`, `bugs` and `author`, plus `author` in `electron/package.json`. The `example` values in the commands above are placeholders; the package metadata in this checkout is configured for Edward Xiao. Keep the public npm package name and CLI command **`finder-selection-sync`**. The npm release check rejects the placeholder repository and verifies that the package repository matches the actual GitHub Actions repository.

The desktop dependency `finder-selection-sync: file:..` is a local reference to this repository's core, not a registry download. The CLI executable name is controlled separately by the root `bin` field.

## 4. Publish the CLI to npm

The root `package.json` controls the CLI version. Pushing an `npm-v<version>` tag triggers `.github/workflows/publish-npm.yml`; it does not build desktop installers.

The destination computer's npm account must have publishing access to **`finder-selection-sync`**. If another account owns it, grant the new account access or transfer ownership. Changing the author field in `package.json` does not grant npm publishing access.

Check the published version before choosing a new, unused version:

```bash
npm view finder-selection-sync version
```

The package is already published, so its existing npm settings can be used to configure trusted publishing. For a manual release instead, sign in with `npm login`, verify `npm whoami`, update the root version and both lockfiles, and run `npm publish --access public` from the repository root. This runs the CLI and package checks before publishing. Use either the manual publish or the tag workflow for a given version, not both.

For subsequent automated releases, configure a GitHub Actions trusted publisher in the npm package settings. Enter the actual owner and repository, use **`publish-npm.yml`** as the workflow filename, and allow **`npm publish`**. Leave the environment field empty because this workflow does not declare one. The workflow uses Node.js 24 and `id-token: write`; no personal npm token is stored in the repository. See the [official npm trusted publishing guide](https://docs.npmjs.com/trusted-publishers/).

Example release (`2.2.1` must match the root package version):

```bash
npm version patch --no-git-tag-version
npm --prefix electron install --package-lock-only --ignore-scripts
npm test
npm run test:package
git add .
git commit -m "Release CLI 2.2.1"
git tag npm-v2.2.1
git push origin main
git push origin npm-v2.2.1
```

The workflow validates the tag, version and repository, runs the CLI regressions and an actual npm pack/install check, then publishes. Stable versions use the npm `latest` tag; prerelease versions such as `2.2.1-beta.1` use `next`. Published npm versions cannot be overwritten; increment the version for a new release. Monitor **Actions → Publish CLI to npm** in GitHub; verify the result with `npm view finder-selection-sync version`.

## 5. Publish the desktop app to GitHub Releases

The desktop version is controlled independently by `electron/package.json`. Pushing a `desktop-v<version>` tag triggers `.github/workflows/release-desktop.yml`; it does not publish to npm.

Build locally with:

```bash
npm run dist:mac
```

Artifacts are written to `electron/dist/`. Local builds target the current Mac architecture. The release workflow tests and builds an arm64 DMG on an Apple Silicon runner, then creates a Release in the current repository using `GITHUB_TOKEN` and attaches the installer. Normal branch pushes run CI only. Versions with a prerelease suffix are marked as prereleases. No npm publisher setup is needed to release the desktop app.

Example release (`2.2.1` must match the Electron package version):

```bash
npm --prefix electron version patch --no-git-tag-version
npm run test:all
npm run dist:mac
git add .
git commit -m "Release desktop 2.2.1"
git tag desktop-v2.2.1
git push origin main
git push origin desktop-v2.2.1
```

Monitor **Actions → Release Electron app**. When both architecture builds and the release job succeed, open the repository's **Releases** page to download the DMGs. Running `npm run dist:mac` alone builds local files; pushing the `desktop-v...` tag is what triggers the GitHub release.

The current builder configuration produces DMGs without Developer ID signing or notarization, so macOS Gatekeeper affects installation. For signed/notarized distribution, configure your own Apple Developer ID certificate, notarization credentials and `electron/electron-builder.cjs`. Apple signing is separate from GitHub/npm authentication.

Both products use the shared core from the same Git revision, but their release schedules are independent. UI-only changes can ship as desktop releases. For core behavior changes, verify both CLI and desktop tests and release the channels that need the change.
