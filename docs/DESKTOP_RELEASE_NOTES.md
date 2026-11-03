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
- `x64.dmg`: Intel Macs.

Open the appropriate DMG and install the app in Applications.

## Signing status

These installers are not Developer ID signed or notarized by Apple. macOS Gatekeeper may block launch or require explicit approval. This release is intended for users who understand and accept that distribution limitation; it is not a signed/notarized production build.

Do not move or edit the same files concurrently while an operation is running. File operations are checked before execution but are not atomic transactions.
