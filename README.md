# finder-selection-sync

Sync macOS Finder Tags across original and processed file folders.

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
- Paths are passed directly to `xattr` without shell interpolation.

## License

MIT
