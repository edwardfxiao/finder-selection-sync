# finder-selection-sync

Sync macOS Finder Tags across original and processed file folders, clean files by a reference extension, and keep or delete files using a text list.

## Repository and releases

One repository contains two independently versioned products:

```text
bin/                     CLI entry point
src/                     Shared matching, Finder tag and cleanup core
test/                    CLI/core regression tests
package.json             Public npm CLI package (Node.js 18+, no runtime dependencies)
electron/
  package.json           Private desktop package, its own version and dependencies
  package-lock.json      Desktop dependency lockfile
  main.js / preload.cjs  Electron integration
  service.js             Desktop preview/execution adapter using the shared core
  renderer/              React 19 / shadcn UI
  locales/               Editable JSON language packs
  test/                  Desktop service and packaging tests
  scripts/               Desktop staging and native image checks
  electron-builder.cjs   macOS packaging configuration
scripts/                 CLI package validation and source transfer
.github/workflows/       CI, npm publishing, desktop releases
```

Electron depends on the root package through `file:..`; changes to `src/` are used directly during development. Packaging stages a self-contained copy of that same core under the app's `node_modules`, preserving the core's own version metadata. Do not edit generated files in `electron/.build/`.

The npm tarball contains only the CLI/core and package documentation. Electron, React, renderer code and installers are excluded. `npm-v<version>` tags publish the root package to npm; `desktop-v<version>` tags build Apple Silicon (arm64) DMGs for GitHub Releases. Ordinary commits only run CI. The desktop package is `private: true`.

**Moving to another Mac / continuing with another account:** see [Development, transfer and release guide](docs/DEVELOPMENT.md). Run `npm run transfer` to create a source archive containing current work and Git history, without dependencies, build outputs, account configuration or a configured remote. The npm package name is **`finder-selection-sync`**. When transferring to a different account, review the GitHub repository URLs and author metadata before publishing.

## Desktop app

The macOS Electron app uses **React 19, TypeScript, shadcn/ui and Tailwind CSS**. Use Node.js **24** for development (`.nvmrc`); desktop tools require 22.12+, and the published CLI still supports Node.js 18+.

```bash
npm ci
npm run setup:desktop
npm start
```

Choose one of three workflows in the sidebar: reference cleanup, Finder tags, or list cleanup. Click anywhere in a reference, target, or list-file region to choose a path, or drop files/folders from Finder. Adjust the rules, review the preview, and uncheck individual files before confirming the operation.

Right-click a selected reference folder, target folder, or list file to **Show in Finder**. The menu also opens with Shift+F10 or the context-menu key while a path is focused. Click an existing target row to replace just that folder with a single folder; cancelling keeps the current selection. Use **+ Add** at the top right of the target-folder header to append folders. Hover and keyboard-focus feedback stays within the content row, including empty placeholders. The active highlight lasts only while the picker or context menu is open, then clears. Each selected path has a **×** control that clears only that selection; it does not delete the file or folder. Pasted lists also have a clear button.

- Every rule or folder change automatically refreshes the preview. Text input is debounced by 400 ms; outdated scans are cancelled and their results discarded. A manual refresh is also available for changes made outside the app. Refreshes show a skeleton in the preview area and keep the folder section's collapsed state. File operations retain their progress and stop controls.
- **Expand preview** opens a large dialog with the same search, filters, pages and checked files. Closing it preserves those choices in the workspace. In dropdowns and selects, Tab / Shift+Tab close the popup and move to the next / previous control; Up / Down wrap through enabled options, and Enter selects the focused item.
- The workflow title is a full-width toggle bar that stays in the same position whether folder options are expanded or collapsed. Click the same spot again to toggle back. Scrolling upward also collapses the options; scrolling down from the start of the file list restores them. The search, selection and current page stay in place.
- Tag changes use a horizontal before/after layout with color dots and a hollow circle for no tags; hover a dot to see its tag name. Right-click any preview row, including in the expanded dialog, to **Show in Finder** or **Copy pathname** without changing which files are checked. Hover a filename for its full path and matching reason; the preview has no separate detail pane.
- Images show thumbnails as they approach the visible area. Click a thumbnail to open a larger preview; Escape returns to the same item. macOS decodes supported image formats, with a file icon and Finder fallback for unavailable formats. Decoding is limited to two files at a time and the cache has a memory limit.
- Reference cleanup offers **Separate folders / Same folder** above the folder cards. Finder tag workflows use independent reference and target folders. List cleanup takes a UTF-8 file or pasted filenames.
- Cleanup moves checked files to macOS Trash. Tag syncing defaults to merging with existing target tags; replacement, fixed colors, and clearing tags are also available. Native confirmation, progress, cancellation, and a result report accompany execution.
- Files and directory inventories are verified again before execution. A changed file, tag conflict, or failure stops the operation. The latest 20 runs are retained for the current app session and can be exported as JSON.

### Languages

Built-in language packs live in [`electron/locales`](electron/locales): [`en-US.json`](electron/locales/en-US.json), [`zh-CN.json`](electron/locales/zh-CN.json), and [`ja-JP.json`](electron/locales/ja-JP.json). The app initially follows the system language and remembers manual language selection. Japanese appears as **日本語** in the language menu. System locales such as `ja` resolve to the available Japanese pack.

To add a language to an installed app:

1. Open the language menu at the top right and choose **Open language folder**.
2. Copy `en-US.template.json` to a locale filename such as `fr-FR.json`.
3. Set `_meta.label` to the language's display name and translate the values. Keep message keys and parameters such as `{count}` unchanged.
4. Choose **Reload languages**, then select the new language. Editing an existing file and reloading also updates its translations without restarting.

For example, a partial `fr-FR.json` pack can start with:

```json
{
  "_meta": { "label": "Français", "direction": "ltr" },
  "task.tags": "Étiquettes Finder",
  "preview.selected": "{count} fichiers sélectionnés"
}
```

Missing messages fall back to English. Custom files named `en-US.json`, `zh-CN.json`, or `ja-JP.json` override corresponding built-in messages. Files must contain a `_meta.label`, use flat string message values, and be no larger than 2 MB; malformed files are skipped with a notification. `.template.json` files are not loaded as languages. To ship a new built-in language, add its JSON file to `electron/locales` and rebuild; no registry or UI code changes are required.

### Build and validation

```bash
npm test                 # CLI / shared core; no Electron dependency installation needed
npm run test:desktop     # Desktop planners, auto-preview, language packs and packaging
npm run test:ui          # React interactions and real-filesystem workflow integration
npm run test:images      # macOS native JPG/PNG thumbnail and large-preview decoding
npm run test:filesystem  # Electron ASAR handling and physical filesystem guards
npm run test:package     # Pack/install the npm artifact and check the CLI without Electron
npm run test:all         # CLI, desktop, UI and npm package checks
npm run check            # React / TypeScript
npm run build:mac        # macOS .app in electron/dist/
npm run dist:mac         # .app and .dmg in electron/dist/
npm run transfer         # Portable source archive in transfer/
```

UI tests run in jsdom. They exercise React/Radix interactions and connect the app to the real desktop service and shared core using temporary files. Integration cases cover all three workflows, declined confirmations, checked-only execution, stale files, list editing, error recovery, delayed path requests across workflow switches, and a 1,004-file preview. OS dialogs, Trash and tag writes are substituted in those integration cases; layout, trackpad behavior and native dialog interaction still require a manual macOS check. The image and filesystem smoke tests run in Electron itself.

Local builds target the current Mac architecture. The desktop release workflow builds only arm64 on an Apple Silicon runner. Builds currently have no Developer ID signing or notarization; configure your own Apple credentials and the builder configuration before distributing a signed/notarized app. A packaged app runs without a separate Node.js installation or a published npm package.

## Photo and list cleanup (2.2.0)

These subcommands integrate the workflows previously provided by `photome` and `deletebutme`.

```bash
# Mixed folder: keep NEF and all matching filenames; preview orphan files of other extensions
finder-selection-sync clean-orphans '/path/to/photos' --reference-ext nef

# Any one extension can be the reference: CR3, JPG, ARW, DNG, etc.
finder-selection-sync clean-orphans '/path/to/photos' --reference-ext jpg

# Separate folders: base supplies reference filenames, targets are cleaned
finder-selection-sync clean-orphans --base '/path/to/NEF' --target '/path/to/exports' --reference-ext nef

# Keep filenames listed in a UTF-8 text file; preview everything else
finder-selection-sync clean-list '/path/to/target' --list '/path/to/keep.txt' --mode keep

# Delete only listed filenames; preview
finder-selection-sync clean-list '/path/to/target' --list '/path/to/delete.txt' --mode delete
```

New commands are dry runs by default. Add `--apply` to move selected files to macOS Trash, or `--apply --permanent` to permanently delete. Trash uses Finder and may require macOS Automation permission. A failure stops subsequent operations without falling back to permanent deletion. `--list-limit 0` shows every candidate.

`clean-orphans` uses `--reference-ext <extension>` to keep the specified extension and clean **all other extensions** that have no matching reference filename. No RAW-format setting or target-extension list is needed. For example:

```text
Input                         With --reference-ext nef
A.NEF                         keep (reference)
A.JPG / A.CR3 / A.XMP / A.TIF   keep (matching reference A.NEF)
B.JPG / B.CR3 / B.XMP / B.PSD   clean (no B.NEF)
```

This includes orphan sidecars, documents and videos, not just image formats. Files without an extension (including names ending in a bare dot) are preserved. Reference-extension files are never selected, including those in target directories. In separate-folder mode only the **base** supplies reference keys; target reference files do not expand that set. With an empty reference and explicit `--allow-empty`, all eligible non-reference extensions are selected.

The extension is case-insensitive, may include a leading dot (`nef`, `NEF`, `.nef`), and must be a single extension. `jpg` and `jpeg` are distinct: `--reference-ext jpg` uses only `.jpg` files as references; matching `.jpeg` files are retained as other formats. Matching uses the filename without its **last** extension, so `A.NEF.XMP` has stem `A.NEF`, not `A`.

Matching is case-insensitive by relative subdirectory and filename stem; use `--match-by name` to ignore directories. Processing suffixes are **not** stripped. Separate reference and target roots must not overlap; use the single-folder syntax for mixed photos. Multiple `--target` folders are supported.

The older `--reference cr3` / `--reference jpeg` options remain available with their original **paired CR3/JPEG-only scope**. They cannot be combined with `--reference-ext`. Use the new option for multi-format cleanup.

Lists require explicit `--mode keep|delete`. Default matching is by full filename, including extension, with exact case and Unicode NFC normalization. Options:

- `--match-by name|relative|stem`: full basename (default), relative file path, or basename without extension.
- `--ignore-case`: case-insensitive list matching.
- `--include-ext jpg,jpeg`: restrict eligible file types.
- `--exclude-ext cr3,xmp`: always preserve these types; exclusions take precedence.
- Multiple positional targets or repeated `--target` options.

List lines may contain paths in name/stem modes; only the basename is used. Relative mode rejects absolute paths and traversal. A single leading UTF-8 encoding BOM is removed; any subsequent literal BOM character belongs to the filename. Blank lines are ignored, filename whitespace is preserved, and lines are not shell commands or comments. Lists and their hard links are protected from cleanup.

Both commands support `--no-recursive` or `--depth N` (0 = top level), reject overlapping cleanup roots, and skip hidden entries and symlinks. Empty references/lists fail unless `--allow-empty` is explicitly passed. With an empty keep-list, all eligible candidates are selected; an empty delete-list selects nothing. Directories are never deleted. Planned files and directory inventories are rechecked before execution. During orphan cleanup, a newly matching reference stops further deletion; this check uses the same directory, case and Unicode rules as planning. Directory paths are revalidated before descent to detect substituted symlinks. These checks reduce stale-plan risks but do not make cleanup transactional; avoid concurrent changes while it runs.

Use `clean-orphans --help` or `clean-list --help` for all options. Before publishing/installing this version, run `node ./bin/finder-selection-sync.js` from this checkout instead of the global command or `npx`.

The original commands below remain supported. In particular, **legacy `--delete-unmatched --apply` still permanently deletes files**; it now refuses empty reference folders and overlapping roots. Relative base paths literally named `clean-orphans` or `clean-list` must use `./clean-orphans` / `./clean-list` to avoid subcommand parsing.

## Finder tag workflows

The CLI treats a base folder as the reference selection and matches its filenames against one or more target folders. It can assign one color tag to a selection or copy every Finder Tag from each base file to its target matches. A single file may contain multiple colors and custom named tags. It works with processing workflows that append bracketed variants such as `-[variant-a][small]`.

## Requirements

- macOS
- Node.js 18 or newer

## Install

Run without installing:

```bash
npx finder-selection-sync <base> <target...>
```

Or install the CLI globally:

```bash
npm install --global finder-selection-sync
```

## Quick start

Preview the matching files in two processed target folders:

```bash
finder-selection-sync \
  '/path/to/base-selection' \
  '/path/to/processed-target-1' \
  '/path/to/processed-target-2'
```

All commands are dry runs by default. Add `--apply` only after reviewing the output:

```bash
finder-selection-sync \
  '/path/to/base-selection' \
  '/path/to/processed-target' \
  --apply
```

## Sync existing base tags

Copy all Finder Tags from each tagged base file to every matching target file:

```bash
finder-selection-sync \
  '/path/to/base' \
  '/path/to/processed-target-1' \
  '/path/to/processed-target-2' \
  --sync-tags
```

The command above is a dry run. After reviewing each planned tag set, apply the changes:

```bash
finder-selection-sync <base> <target...> \
  --sync-tags \
  --apply
```

By default, the base tag set replaces the complete target tag set. To preserve target-only tags and add the base tags, use `--merge-tags`:

```bash
finder-selection-sync <base> <target...> \
  --sync-tags \
  --merge-tags \
  --apply
```

Untagged base files are skipped and do not change their target matches. To synchronize the untagged state as well, use `--include-clear`; matching target tags will then be cleared:

```bash
finder-selection-sync <base> <target...> \
  --sync-tags \
  --include-clear \
  --apply
```

If duplicate base files have the same match key but different tag sets, the CLI reports the conflicting files and makes no changes. Tag order does not create a conflict. Without `--include-clear`, an untagged duplicate is ignored when another duplicate has tags.

`--sync-tags` operates on targets and cannot be combined with `--scope base|both`, `--select`, `--color`, `--match`, or `--clear-all`.

## Positive and inverse selection

The default scope is `targets`.

| Selection | Option | Result |
| --- | --- | --- |
| Positive | `--select matched` | Target files with a matching filename in base |
| Inverse | `--select unmatched` | Target files without a matching filename in base |
| All | `--select all` | Every file in each target, regardless of matching |

Replace the tags on the inverse selection with a green color tag:

```bash
finder-selection-sync \
  '/path/to/base-selection' \
  '/path/to/processed-target-1' \
  '/path/to/processed-target-2' \
  --select unmatched \
  --color green \
  --apply
```

## Clear tags

Clear all Finder Tags from every file in the target folders:

```bash
finder-selection-sync \
  '/path/to/base-selection' \
  '/path/to/processed-target-1' \
  '/path/to/processed-target-2' \
  --clear-all \
  --apply
```

`--clear-all` is a shortcut for `--select all --color clear`. It follows the selected scope, which is `targets` by default. Without `--apply`, the command only previews the files whose tags would be cleared.

To clear tags only from a positive or inverse selection, combine that selection with `--color clear`:

```bash
finder-selection-sync <base> <target...> \
  --select unmatched \
  --color clear \
  --apply
```

## Delete unmatched target files

Preview target files that do not have a matching filename in the base folder:

```bash
finder-selection-sync <base> <target...> --delete-unmatched
```

After reviewing the complete list, permanently delete those files:

```bash
finder-selection-sync <base> <target...> \
  --delete-unmatched \
  --list-limit 0 \
  --apply
```

`--delete-unmatched` affects target files only. It does not delete base files or directories, and it cannot be combined with tag operations, `--select`, `--color`, or `--match`. Deletion is permanent and does not move files to the Trash.

## Filename matching

Matching is case-insensitive. File extensions and the processing suffix beginning with the first `-[` are ignored. These files therefore share the match key `item_0001`:

- `ITEM_0001.DAT`
- `ITEM_0001-[variant-a][small].dat`
- `ITEM_0001-[variant-a][small][export][web].dat`

Files with the same match key are all selected; the implementation does not discard duplicates.

## Options

```text
--scope <base|targets|both>    Side on which tag changes are applied (default: targets)
--select <mode>                matched, unmatched, or all (default: matched)
--clear-all                    Clear all Finder tags from the selected scope
--sync-tags                    Copy all base Finder tags to matching target files
--merge-tags                   Merge base and target tags instead of replacing
--include-clear                Also copy the untagged state with --sync-tags
--delete-unmatched             Permanently delete target files not found in base
--match <any|all>              Match base files in any or all targets (default: any)
--color <color>                Finder tag color (default: green)
--apply                        Apply changes; otherwise preview only
--no-recursive                 Do not scan nested folders
--list-limit <number>          Maximum selected paths to print; 0 prints all
-v, --version                  Show the installed version
-h, --help                     Show help
```

Available colors are `clear`, `gray`, `green`, `purple`, `blue`, `yellow`, `red`, and `orange`. Applying a color replaces the selected files' tag sets with that single color tag. `clear` removes all tags from the selected files.

`--match any|all` affects selection in `base` scope. Each target is compared directly with the base folder when the scope is `targets`.

## Base and both scopes

Select base files found in at least one target:

```bash
finder-selection-sync <base> <target...> --scope base --match any
```

Select base files found in every target:

```bash
finder-selection-sync <base> <target...> --scope base --match all
```

Apply the selection to both sides:

```bash
finder-selection-sync <base> <target...> --scope both --apply
```

## Safety

- The CLI never writes tags unless `--apply` is present.
- Hidden files and hidden directories are ignored.
- Existing unrelated `com.apple.FinderInfo` data is preserved; only Finder's color bits are updated for compatibility.
- Modern Finder Tags are read from and written to `com.apple.metadata:_kMDItemUserTags`.
- `--sync-tags` skips untagged base files unless `--include-clear` is present.
- Conflicting base tag sets stop the entire tag-sync operation before any file is changed.
- `--delete-unmatched` is a dry run unless `--apply` is present, and it never deletes directories.
- Paths are passed directly to `xattr` without shell interpolation.

## Development and tests

```bash
npm test
npm run test:coverage
```

Tests use temporary files and cover both cleanup directions, lists, filtering, filesystem guards, CLI integration, generated datasets, and Finder metadata. The default suite uses a substitute executor for Trash argument handling and failures and does not alter the user's Trash. An explicit macOS integration test exercises real Finder deletion, filename collisions, Unicode/quotes, list/reference preservation, and stopping when a new matching reference appears:

```bash
# From the source checkout only; may request macOS Automation permission
npm run test:finder-trash
```

This opt-in test creates isolated temporary fixtures, verifies their contents at the exact Trash paths returned by Finder, then restores and removes only those fixtures. It never enumerates or empties Trash. It does not run under `npm test` or during publishing. If recovery fails, retain the printed fixture directory for investigation; do not empty Trash. Concurrency checks are not a filesystem transaction and cannot eliminate every race between checking a path and modifying it.

## License

MIT
