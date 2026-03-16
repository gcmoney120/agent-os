---
file_class: CLASS_B_ARCHIVE
owner: Command
write_rule: APPEND_ONLY
purpose: Index of all archived control-plane documents in this directory. Archive files are written once by the originating agent after Command closes a slice. Immutable after initial write. Command maintains this index.
---

# ARCHIVE INDEX

## Archive policy
- Files in this directory are written once by the originating agent post-closure.
- Naming conventions:
  - Architecture archives: `ARCH_{slice-id}_v{n}.md` — written by Atlas
  - Sentinel review archives: `REVIEW_SENTINEL_{slice-id}.md` — written by Sentinel
  - Compass validation archives: `REVIEW_COMPASS_{slice-id}.md` — written by Compass
- Files are immutable after initial write.
- Command maintains this INDEX.md as a live index (append-only for the entries list; header updatable).

## Contents

(Empty at CTRL-S1 initialization. Entries will be appended as slices close.)
