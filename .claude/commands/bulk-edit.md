Apply changes safely across multiple files without breaking JSX, CSS, or TypeScript.

Change description: $ARGUMENTS

---

## Safe Bulk Edit Protocol

This protocol eliminates the regex/sed breakage cycle by enforcing file-by-file edits with incremental verification.

### Rules (non-negotiable)

1. **NEVER use `sed`, `awk`, or regex-based Bash scripts** on JSX/TSX/CSS files. These consistently mangle closing tags, CSS classes, and introduce CRLF issues.
2. **Use the Edit tool** for each file individually.
3. **After every 5 files edited**, run `npx tsc --noEmit` and fix any errors before continuing.
4. **If an edit breaks the build**, revert that specific file (`git checkout -- [file]`) and retry with a corrected approach.
5. **Track progress** using tasks — create a checklist of files to modify and mark each as complete.

### Execution Steps

#### Step 1 — Discover Files

Find all files matching the change scope:
- Use Glob to find files matching the pattern (e.g., `**/*.tsx`, `src/components/**/*.tsx`)
- List all matching files and count them
- Confirm the scope with the principal if more than 20 files are affected

#### Step 2 — Plan the Change

For each file, determine:
- What specific text needs to change (the Edit tool's `old_string`)
- What it should change to (the `new_string`)
- Whether the change is identical across files or requires per-file adaptation

#### Step 3 — Execute File-by-File

For each file:
1. Read the file (or the relevant section)
2. Apply the edit using the Edit tool
3. Every 5 files: run `npx tsc --noEmit`
4. If errors: fix immediately before continuing

#### Step 4 — Final Verification

After all files are edited:
1. Run `npx tsc --noEmit` — must pass clean
2. Run `npm run build` if available — must pass clean
3. Run `git diff --stat` to confirm the scope matches expectations
4. Report: X files modified, Y errors encountered and fixed, build status

### Recovery

If bulk edits have gone wrong mid-way:
- `git diff --name-only` to see what changed
- `git checkout -- [file]` to revert individual files
- `git stash` to save partial progress if needed
- Start over with the corrected approach

Do NOT attempt to fix broken bulk edits with more bulk edits. Reset and apply cleanly.
