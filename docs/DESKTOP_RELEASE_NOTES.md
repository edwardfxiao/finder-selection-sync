## Changes in 2.2.3

- Assign multiple Finder color tags, with saved single-color preferences migrated automatically.
- Require at least one selected tag before previewing tag assignment.
- Ad-hoc sign the app and helper processes so the repackaged bundle has valid code signatures.
- Verify bundle integrity and launch the packaged app in a temporary profile before uploading the ARM64 installer.

## Changes in 2.2.2

- Clear session activity records without changing files or exported reports.
- Show Finder color dots in the color selector and selected value.
- Export source without Git history by default, excluding local credentials and filesystem metadata; history requires an explicit option.
- Expand activity and color-selection regression coverage and preserve asynchronous cleanup checks.

## Desktop app

Finder Selection Sync now includes a macOS desktop app alongside the npm CLI. This release bundles the shared matching and cleanup core; a separate Node.js installation is not required.

- Preview and clean orphan files using a reference extension such as NEF, CR3 or JPG.
- Keep or remove files using a text list, with checked-row execution.
- Synchronize, merge, assign or clear Finder tags.
- Preview images, reveal files in Finder, and export operation reports.
- English, Simplified Chinese and Japanese interfaces.
- Native confirmation, progress and cancellation; cleanup moves files to Trash.

## Downloads

- `arm64.dmg`: Apple Silicon Macs (M-series).

This desktop release supports Apple Silicon only.

Open the DMG and install the app in Applications.

## Signing status

The app is ad-hoc signed to verify bundle integrity. It is not Developer ID signed or notarized by Apple, so macOS Gatekeeper may still block launch or require explicit approval under System Settings → Privacy & Security. Ad-hoc signing does not establish developer identity or replace notarization.

Do not move or edit the same files concurrently while an operation is running. File operations are checked before execution but are not atomic transactions.
