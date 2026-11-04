# finder-selection-sync

Organize files on macOS: sync Finder tags, find files without matching originals, or keep and remove files using a filename list. Available as a desktop app and a command-line tool.

Preview changes before applying them. Desktop cleanup moves files to Trash; tag operations update Finder tags without moving files.

## Desktop app

### Install

Download the Apple Silicon (`arm64.dmg`) installer from this repository's **Releases** page. Open the DMG, drag **Finder Selection Sync** to **Applications**, and open the app.

The desktop download supports Apple Silicon Macs (M-series). It does not require Node.js or npm.

### Choose a workflow

- **Clean by reference** — Keep a reference format, such as NEF, CR3 or JPG, and find other files without a matching original. Choose **Same folder** if originals and exports are together, or **Separate folders** if they are stored apart.
- **Finder tags** — Copy tags from reference files to matching target files. **Keep existing target tags** is enabled by default. Use **Set tags** to replace existing tags with one or more selected colors, or **Clear tags** to remove them.
- **Organize by list** — Load a UTF-8 text file or paste one filename per line. Choose whether to keep the listed files or move the listed files to Trash.

### Preview and apply

1. Choose the folders, or drag them from Finder. Click an existing folder to replace it; use **+ Add** to add another target folder.
2. Adjust the rules. The preview updates automatically whenever a folder or rule changes. Use **Refresh** after changing files outside the app.
3. Review the planned actions and uncheck any files you want to leave alone. Use search, **Changes only**, or **Expand preview** to inspect a large list.
4. Click the action button at the bottom and confirm. Only checked files are processed.

Click the workflow title to collapse or expand folder options. Click an image thumbnail for a larger view. Right-click a preview item to **Show in Finder** or **Copy pathname**.

The **×** beside a folder removes it from the current setup. **Reset all** clears the folders and filename list in the current workflow. Neither action deletes files. In the tag picker, **Clear selection** deselects colors; use the separate **Clear tags** action to remove tags from files.

**Activity** shows results for the current app session. Use **Clear all** to clear those records, or **Export report** to save a report yourself. Activity is not saved automatically after quitting.

### Languages

English, Simplified Chinese and Japanese are included. Switch languages using the menu at the top right.

To add or update a language:

1. Choose **Open language pack folder** from the language menu.
2. Copy `en-US.template.json` to a locale filename such as `fr-FR.json`. Change `_meta.label` to the language's display name and translate the values. Keep message keys and placeholders such as `{count}` unchanged.
3. Choose **Reload language packs**, then select the language.

Missing translations fall back to English. A custom `en-US.json`, `zh-CN.json` or `ja-JP.json` overrides the corresponding built-in translations.

## Command-line tool

Requires macOS and Node.js 18 or newer.

Install globally:

```bash
npm install --global finder-selection-sync
```

Or run without a global installation:

```bash
npx finder-selection-sync --help
```

**All commands preview changes by default.** Add `--apply` only after reviewing the output. Replace the example paths below with your folders.

### Sync Finder tags

Copy tags from reference files to matching exports, preserving existing export tags:

```bash
finder-selection-sync '/path/to/originals' '/path/to/exports' --sync-tags --merge-tags
```

Remove `--merge-tags` to replace the complete target tag set. Untagged reference files are skipped unless you add `--include-clear`, which also clears their matching target files' tags. Conflicting tags on references with the same match key stop tag syncing.

Tag matching ignores folders, extensions, letter case and processing suffixes beginning with `-[`. For example, `IMG_0001.NEF` matches `img_0001-[web].jpg`. Add more target paths to process multiple folders.

### Set or clear tags

Set matching target files to green:

```bash
finder-selection-sync '/path/to/originals' '/path/to/exports' --color green
```

Use `--select unmatched` for files without a reference match, or `--select all` for every target file. The CLI's `--color` option sets one color and replaces existing tags. Available colors are `gray`, `green`, `purple`, `blue`, `yellow`, `red` and `orange`.

Clear tags on every target file:

```bash
finder-selection-sync '/path/to/originals' '/path/to/exports' --clear-all
```

Use `--color clear` with `--select matched` or `--select unmatched` to clear only that selection.

### Clean by reference

Find files without a matching NEF in a folder containing both originals and exports:

```bash
finder-selection-sync clean-orphans '/path/to/photos' --reference-ext nef
```

For separate original and export folders:

```bash
finder-selection-sync clean-orphans --base '/path/to/originals' --target '/path/to/exports' --reference-ext nef
```

With `--reference-ext nef`, `A.NEF` protects matching files such as `A.JPG` and `A.XMP`; `B.JPG` is a cleanup candidate when there is no matching `B.NEF`. All other extensions are eligible, including sidecars, documents and videos. Reference-format files and files without an extension are kept.

Cleanup matches by relative subfolder and filename stem, ignoring case. Add `--match-by name` to ignore subfolders. Processing suffixes are preserved: `A-[web].JPG` does not match `A.NEF`. Separate reference and target folders must not overlap.

### Organize by list

Create a UTF-8 text file with one filename per line:

```text
IMG_0001.JPG
IMG_0002.JPG
```

Keep the listed files and preview removal of other files:

```bash
finder-selection-sync clean-list '/path/to/exports' --list '/path/to/keep.txt' --mode keep
```

Preview removal of only the listed files:

```bash
finder-selection-sync clean-list '/path/to/exports' --list '/path/to/remove.txt' --mode delete
```

Lists match full filenames, including extensions, with exact case by default. Use `--ignore-case` for case-insensitive matching, or `--match-by stem` to ignore extensions. Filename spaces are preserved. The list file itself is protected from cleanup.

### Apply changes and get help

After reviewing a preview, repeat the command with `--apply`. For example:

```bash
finder-selection-sync clean-orphans '/path/to/photos' --reference-ext nef --apply
```

`clean-orphans` and `clean-list` move files to macOS Trash unless `--permanent` is also supplied. The legacy `--delete-unmatched --apply` option **permanently deletes** files. Cleanup never deletes directories and skips hidden entries and symlinks. Empty references or lists are rejected unless you explicitly use `--allow-empty`.

Use `--list-limit 0` to show every planned file, or `--no-recursive` to scan only the top level. Avoid changing the same files while an operation is running.

For all options, including selection scopes, extension filters and folder depth:

```bash
finder-selection-sync --help
finder-selection-sync clean-orphans --help
finder-selection-sync clean-list --help
```

## Contributing

For working on the source code, see the [development guide](docs/DEVELOPMENT.md).

## License

MIT
