# finder-selection-sync

Organize files on macOS: sync Finder tags, clean up files, filter folders, or compare filenames across two folders. Available as a desktop app and a command-line tool.

Preview changes before applying them. Desktop cleanup moves files to Trash; tag operations update Finder tags without moving files.

## Desktop app

### Install

Download the Apple Silicon (`arm64.dmg`) installer from this repository's **Releases** page. Open the DMG, drag **Finder Selection Sync** to **Applications**, and open the app.

The desktop download supports Apple Silicon Macs (M-series). It does not require Node.js or npm.

### Choose a workflow

- **Clean by reference** — Enter a reference format, such as NEF, CR3 or JPG, to keep that format and find other files without a matching original. Choose **Same folder** if originals and exports are together, or **Separate folders** if they are stored apart.
- **Finder tags** — Copy tags from reference files to matching target files. **Keep existing target tags** is enabled by default. Use **Set tags** to replace existing tags with one or more selected colors, or **Clear tags** to remove them.
- **Organize by list** — Load a UTF-8 text file or paste one filename per line. Choose whether to keep listed files or move listed files to Trash. You can also check any preview files and use the separate **Set tags** action.
- **Filter files** — Search one or more folders by filename text, regular expression, extension, size and modification date. Choose whether to include subfolders and set a maximum depth. Browse matches without changing files, or check results to set Finder tags or move them to Trash after confirmation.
- **Compare folders** — Find filenames present in both folders, only in one folder, or in either folder but not both. Check files on either side to set Finder tags. By default, matching uses the full filename, including its extension, and ignores subdirectories. This compares names, not file contents; relative-path and filename-stem matching are also available.

### Preview and apply

1. Choose the folders, or drag them from Finder. Click an existing folder to replace it; use **+ Add** to add another target folder.
2. Adjust the rules. The preview updates automatically whenever a folder or rule changes. Use **Refresh** after changing files outside the app.
3. Review the planned actions and uncheck any files you want to leave alone. Use search, **Changes only**, or **Expand preview** to inspect a large list.
4. Click the action button at the bottom and confirm. Only checked files are processed.

Click the workflow title to collapse or expand folder options. Conditions and preview rows scroll together in the main workspace. Scrolling does not automatically collapse or expand options; preview controls and the bottom action bar remain accessible. Click an image thumbnail for a larger view. Right-click a preview item to **Show in Finder** or **Copy pathname**.

Click anywhere on a file row to toggle its checkbox. **Shift-click** selects a range; **Command-click** toggles individual files and **Command-Shift-click** adds a range while keeping other selections. The keyboard button beside the selection count shows the available shortcuts:

- **↑ / ↓** selects the previous or next file; hold **Shift** to extend or shrink the range.
- **Option-↑ / ↓** selects the first or last result; **Shift-Option-↑ / ↓** selects through that end of the results.
- **Command-A** selects all selectable results across pages; **Shift-Command-A** deselects all. Search fields keep their normal text-selection shortcuts.

Range selection follows the current search and filter results, works across pages, and skips files whose checkboxes are disabled.

The **×** beside a folder removes it from the current setup. **Reset workflow** clears the current page's folders, inputs and selections. **Reset all** at the bottom of the sidebar clears all five workflows after confirmation, while keeping your language, appearance and Activity records. Neither action changes files or their tags.

Each workflow keeps its preview, checked files, search and scroll position when you switch sidebar pages during the current session. Returning to a page does not rescan it. Use **Refresh** after changing files in Finder; changing rules or applying an operation also updates the preview. Files are checked again before an operation runs.

**Activity** shows results for the current app session. Use **Clear all** to clear those records, or **Export report** to save a report yourself. Activity is not saved automatically after quitting.

In **Filter files**, all filled conditions must match; blank fields impose no restriction. Enter extensions separated by commas (such as `.jpg, .png`). Regex patterns match the filename including its extension, without `/` delimiters. Modification dates include both the start and end day in local time; sizes use 1024 bytes per KB. A depth of `0` scans only the chosen folders, `1` also includes one subfolder level, and blank means unlimited. Hidden files and symbolic links are skipped. Overlapping search folders are combined without duplicate files.

**Invert filter results** finds files that fail the combined conditions, including extension exclusions. **Invert selection** toggles checkboxes across all pages of the current search results. Filter results start unchecked; refreshing or changing a condition clears the selection. **Clear filters** resets conditions while keeping the folders and scan depth.

In **Organize by list**, **Filter files** and **Compare folders**, check files and click **Set tags** beside the selection count. The same dialog lets you add or replace color tags, or choose **Clear file tags** to remove all tags. Review **Current → After**, then apply and confirm. **Deselect colors** only resets the color choices in the dialog; it does not remove tags from files. Choosing colors does not rescan the folders or change your file selection. Compare results start unchecked.

In **Organize by list**, you can tag checked files marked **Keep** or excluded from cleanup by extension filters. Tagging does not change the list rules or move files. The bottom **Move to Trash** button processes only checked cleanup candidates; kept files remain protected. Use **Clear extension filters** to remove the extension restrictions on cleanup. Updated tags appear beside filenames after applying.

The **Appearance** menu in the title bar offers **Light**, **Dark**, and **Follow system**. Your choice is remembered between launches.

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
