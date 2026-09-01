# finder-selection-sync

Sync macOS Finder color-label selections across original and processed file folders.

The CLI treats a base folder as the reference selection and matches its filenames against one or more target folders. It can assign one color to a selection or copy each base file's existing Finder color label to its target matches. It works with processing workflows that append bracketed variants such as `-[variant-a][small]`.

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

## Sync existing base labels

Copy the actual Finder color label from each labeled base file to every matching target file:

```bash
finder-selection-sync \
  '/path/to/base' \
  '/path/to/processed-target-1' \
  '/path/to/processed-target-2' \
  --sync-labels
```

The command above is a dry run. After reviewing each planned color, apply the changes:

```bash
finder-selection-sync <base> <target...> \
  --sync-labels \
  --apply
```

By default, unlabeled base files are skipped and do not change their target matches. To synchronize the unlabeled state as well, use `--include-clear`; matching target labels will then be cleared:

```bash
finder-selection-sync <base> <target...> \
  --sync-labels \
  --include-clear \
  --apply
```

If duplicate base files have the same match key but different color labels, the CLI reports the conflicting files and makes no changes. Without `--include-clear`, an unlabeled duplicate is ignored when another duplicate has a color label.

`--sync-labels` operates on targets and cannot be combined with `--scope base|both`, `--select`, `--color`, `--match`, or `--clear-all`.

## Positive and inverse selection

The default scope is `targets`.

| Selection | Option | Result |
| --- | --- | --- |
| Positive | `--select matched` | Target files with a matching filename in base |
| Inverse | `--select unmatched` | Target files without a matching filename in base |
| All | `--select all` | Every file in each target, regardless of matching |

Apply a green label to the inverse selection in every target:

```bash
finder-selection-sync \
  '/path/to/base-selection' \
  '/path/to/processed-target-1' \
  '/path/to/processed-target-2' \
  --select unmatched \
  --color green \
  --apply
```

## Clear labels

Clear Finder color labels from every file in the target folders:

```bash
finder-selection-sync \
  '/path/to/base-selection' \
  '/path/to/processed-target-1' \
  '/path/to/processed-target-2' \
  --clear-all \
  --apply
```

`--clear-all` is a shortcut for `--select all --color clear`. It follows the selected scope, which is `targets` by default. Without `--apply`, the command only previews the files whose labels would be cleared.

To clear labels only from a positive or inverse selection, combine that selection with `--color clear`:

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
--scope <base|targets|both>    Side on which labels are applied (default: targets)
--select <mode>                matched, unmatched, or all (default: matched)
--clear-all                    Shortcut for --select all --color clear
--sync-labels                  Copy existing base labels to matching target files
--include-clear                Also copy the unlabeled state with --sync-labels
--match <any|all>              Match base files in any or all targets (default: any)
--color <color>                Finder label color (default: green)
--apply                        Apply changes; otherwise preview only
--no-recursive                 Do not scan nested folders
--list-limit <number>          Maximum selected paths to print; 0 prints all
-v, --version                  Show the installed version
-h, --help                     Show help
```

Available colors are `clear`, `gray`, `green`, `purple`, `blue`, `yellow`, `red`, and `orange`.

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

- The CLI never writes labels unless `--apply` is present.
- Hidden files and hidden directories are ignored.
- Existing `com.apple.FinderInfo` data is preserved; only the Finder color-label bits are changed.
- `--sync-labels` skips unlabeled base files unless `--include-clear` is present.
- Conflicting base labels stop the entire label-sync operation before any file is changed.
- Paths are passed directly to `xattr` without shell interpolation.

## License

MIT
