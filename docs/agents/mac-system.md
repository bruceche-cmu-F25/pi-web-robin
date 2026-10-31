# Robin Mac monitor and cleanup

Entry: `/tools` → `/tools/mac`. This is a Robin utility, not a Pi SDK tool or
an arbitrary filesystem manager. Do not add cleanup to the assistant allow-lists.

## Files and boundary

- `extension/robin/mac-system.ts`: client-safe contracts, metric parsers and byte formatting.
- `extension/robin/mac-system-domain.ts`: bounded, read-only host sampling.
- `extension/robin/mac-cleanup-domain.ts`: fixed scan targets, ephemeral plans and native Trash.
- `app/api/robin/mac/route.ts`: GET metrics; POST `scan` or confirmed `trash`.
- `components/robin/MacWorkspace.tsx` + `.module.css`: monitor, scan results and confirmation.
- `lib/i18n/messages/mac-system.ts`: English, Simplified and Traditional Chinese.

The route retains proxy password/origin protections and additionally requires a
loopback Host, like Open in Finder. **Host is not peer authentication.** Keep the
normal loopback server bind; LAN/reverse-proxy operators must enforce access at
the listener/proxy. The UI describes the server Mac, not the browser's device.

## Monitoring

No agent turn, extra package, resident helper, sudo or background daemon. The
existing visibility-aware polling hook requests every three seconds; pause
unmounts only the sampler, preserving displayed values. The collector shares
one in-flight request across tabs and caches completed samples for two seconds.
Commands have two-second timeouts and bounded output. Unsupported/missing
measurements are null, never fabricated zeros. A failed refresh retains data
with a stale warning and sample timestamp. Up to 61 actual samples are retained;
SVG lines use real timestamps in a 30–180 second window that grows with the observed
history, with gaps across pauses. CPU/GPU/RAM have labelled axes; disk capacity is
shown separately above the scan, never inferred from scanned folder sizes.

- CPU: Node per-core cumulative ticks, measured across 400 ms. Aggregate is
  weighted by ticks, not a percentage since boot.
- GPU: `/usr/sbin/ioreg -r -d 1 -c IOAccelerator`, Device Utilization % or
  GPU Activity(%). Multiple accelerators show the busiest. No claim to GPU
  temperature, frequency or per-process attribution.
- RAM: `vm_stat` page size × (anonymous minus purgeable + wired + physically
  occupied compressor pages). This is an estimate, **not memory pressure** or
  guaranteed Activity Monitor parity. Swap comes from `sysctl vm.swapusage`.
- Disk: `statfs('/System/Volumes/Data')`, capacity minus available includes APFS
  shared-volume/snapshot occupation. Do not label it all as removable data.

## Scan and cleanup invariants

1. Scan only on user action. Six personal folders (Downloads, Documents, Desktop,
   Library, Movies, Pictures) are size-only. They never become cleanup targets.
2. Only these six cache paths are eligible: `.npm/_cacache`, `.npm/_logs`,
   `Library/Caches/pip`, `.cache/uv`, `Library/Caches/Homebrew`, and
   `Library/Developer/Xcode/DerivedData`, relative to the canonical home.
3. Sizes use `/usr/bin/du -skx`, two concurrent commands: caches first with a
   6.5-second per-command budget; personal directories get 30 seconds each,
   bounded by 45 seconds for the full scan. Failed output is never treated as a
   complete size. Permission, timeout, changed, excluded and generic failure
   have distinct reason codes, without exposing command stderr. Partial scans
   show unknown, not zero. Parent folders and caches overlap; never add them
   into a whole-disk total. APFS clones/snapshots mean allocated-block sizes are
   not reclaimable promises. The V2 in-memory service slot deliberately drops
   old plans/budgets when this contract is first hot-reloaded.
4. No default selections. Explain close-app/re-download/rebuild costs. The native
   modal lists exact paths and measured sizes, with cancel focused by default.
5. The server keeps at most three random-ID plans for ten minutes in memory.
   Clients send only plan ID, allow-listed item IDs and `confirmed: true`, never
   a filesystem path. HMR/server restart may invalidate a plan; rescan.
6. Reject linked, cross-device/mounted or foreign-owned ancestors/targets. Record device, inode,
   modification and change time; preflight the entire selection and recheck
   each target immediately before moving. This detects replacement/root changes,
   **not every nested write**, and is not an atomic defense against a hostile
   same-UID process racing a path. Users must stop relevant applications.
7. One disk operation per Web process. No OS-wide lease: another Web process or
   package manager may still be active. Do not claim global exclusion.
8. All plans are consumed before the first move. Move each selected cache with
   Apple's `/usr/bin/trash -s <absolute-path>` (macOS 15+), bounded at 15 seconds.
   Never use a shell, `rm`, sudo, or a permanent-delete fallback. Older systems
   can monitor/scan, but cleanup is unavailable. No real-user cleanup in tests.
9. Partial failure is per-item. Timeout or lost HTTP response means outcome is
   uncertain; inspect original and Trash before rescanning. Never retry a move
   automatically or claim rollback. Navigating away does not cancel a move.
10. Moving to Trash does **not** release disk space. Display this before and
    after confirmation. Users restore/empty via Finder themselves. No empty-Trash
    endpoint and no misleading "space freed" counter.

## Disk visualization and verification

The capacity bar refers to the startup APFS filesystem/container; the directory
ring is **only a distribution of measured home folders**. Its denominator is the
sum of those folders, not the largest folder and not total disk capacity. Show
measured count / requested count beside the subtotal, an explicit partial-scope
label, and a table of percentages and sizes. Unknown/absent entries have no
segment or percentage, but remain visible with their reason. Tiny nonzero shares
read `<0.1%`, not zero. Never merge the separate cache subtotal into this ring.

Names are localized with the original path below them. Native details disclose
what each directory normally holds; Pictures may contain Photos libraries and
personal images, not junk and not all images across the Mac. These descriptions
are explanations of folder purpose, not claims that every example file exists.
All directory details are read-only; keyboard/touch expansion never sends a
cleanup request. Colors distinguish folders, with text/percentages carrying the
same facts. All measurement and confirmation safety rules above still apply.

2026-10-27 diagnosis: the earlier 6.5-second cap repeatedly killed `du` on Library
without a permission error or completed total. A bounded 30-second check completed
in about 22 seconds with 60,143,636 KiB (~57.4 GiB). The updated HTTP scan completed
all six directories in about 27 seconds. Pictures was then 901,688 KiB (~880.6 MiB),
including 885,548 KiB in `Photos Library.photoslibrary`. These are historical
observations, not constants or a promise that later scans match. No files were moved.

## Workspace surfaces

The utility uses scoped vivid teal primary actions (separate light/dark contrast
pairs), blue/purple secondary metric traces, and shared shape tokens: 16px metric,
disk, folder and cache cards; 8px controls; a 24px native confirmation dialog.
Cards sit on the theme ground with the existing subtle shadow. Do not clip shared
cards to achieve rounding or change the monitoring/cleanup behavior for styling.
Pointer hover is fine-pointer-only. The browser regression checks actual radii,
primary colors, narrow layouts and unchanged confirmation/cancellation behavior;
all scan/Trash operations remain mocked.

## Reference research

Inspected upstream source and license metadata on 2026-10-27. These references
are not runtime dependencies; no upstream implementation was copied or vendored.

- [Atoll](https://github.com/Atoll-Labs/Atoll), GPL-3.0:
  [StatsManager.swift](https://github.com/Atoll-Labs/Atoll/blob/main/DynamicIsland/managers/StatsManager.swift)
  and [NotchStatsView.swift](https://github.com/Atoll-Labs/Atoll/blob/main/DynamicIsland/components/Notch/NotchStatsView.swift).
  SwiftUI cannot be embedded in React; reference for grouped metrics/history.
- [Stats](https://github.com/exelban/stats), MIT:
  [GPU reader](https://github.com/exelban/stats/blob/master/Modules/GPU/reader.swift),
  IORegistry metric availability. Node executes Apple's tools independently.
- [Mole](https://github.com/tw93/Mole), GPL-3.0:
  [analysis deletion boundary](https://github.com/tw93/Mole/blob/main/cmd/analyze/delete.go)
  and [memory collector](https://github.com/tw93/Mole/blob/main/cmd/status/metrics_memory.go).
  Reference for review-before-delete, protected paths, bounded collection and native Trash.
- [Pearcleaner](https://github.com/alienator88/Pearcleaner) was also examined;
  its current repository reports a nonstandard license. Do not assume MIT or
  freely transplant its app-uninstall engine.
- Local Apple `man trash`: macOS 15+, `-s` stops on error; no Finder automation
  permission or third-party executable required.

## Checks

```sh
node --experimental-strip-types --test extension/robin/mac-system.test.mjs extension/robin/mac-cleanup-domain.test.mjs app/api/robin/mac/route.test.mjs
node --env-file-if-exists=.env.local --experimental-strip-types e2e/mac-workspace.mjs
```

Filesystem tests use temporary fixtures and fake Trash. E2E reads the real
metrics endpoint once, then mocks monitor/scan/cleanup data; it tests selection,
confirmation/cancel, pause, failed-response handling and mobile/dark/light layouts.
No test moves an actual cache, empties Trash or starts a second Next server.
