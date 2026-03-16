/**
 * Agent OS v1.0 — Run-level Relay Import (Slice 7).
 *
 * relayImportRun() restores an entire run directory from a tar.gz bundle
 * previously produced by relayExportRun().
 *
 * Security checks (in order):
 *   1. sha256 prefix in filename matches actual archive hash.
 *   2. No symlink entries in the archive.
 *   3. Manifest present and parseable.
 *   4. All archive paths are safe (no traversal).
 *   5. No extra files in archive (files not listed in manifest).
 *   6. Per-file sha256 + byte size match manifest records.
 *   7. Destination run directory does not already exist (unless --overwrite).
 *
 * Zero writes on any failure.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import { parseTarGz } from "./tar.js";
import { sha256Hex } from "./hash.js";
import type { RunRelayManifestV1 } from "./manifest.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ImportRunOptions {
  /** Absolute path to the .tar.gz bundle. */
  bundlePath: string;
  /** Root directory into which the run directory will be restored. */
  runsRoot: string;
  /** When true, overwrite an existing run directory. */
  overwrite?: boolean;
}

export type ImportRunResult =
  | { ok: true; runId: string; files: string[] }
  | { ok: false; code: string; message: string };

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Parses a run bundle filename of the form:
 *   run_<runId>_<sha256prefix12>.tar.gz
 *
 * `runId` may itself contain underscores; the sha256 prefix is always the last
 * 12 lowercase-hex characters before `.tar.gz`.  The leading segment must be
 * exactly "run".
 *
 * Returns `{ runId, sha256Prefix }` or `null` if the filename does not conform.
 */
function parseRunBundleFilename(
  bundlePath: string,
): { runId: string; sha256Prefix: string } | null {
  const base = bundlePath.replace(/\\/g, "/").split("/").pop() ?? "";
  if (!base.endsWith(".tar.gz")) return null;
  const withoutExt = base.slice(0, -7); // strip ".tar.gz"
  const parts = withoutExt.split("_");
  // Minimum: ["run", <runId-part>, <sha12>] = 3 parts
  if (parts.length < 3) return null;
  if (parts[0] !== "run") return null;
  const sha256Prefix = parts[parts.length - 1];
  if (!/^[0-9a-f]{12}$/.test(sha256Prefix)) return null;
  const runId = parts.slice(1, -1).join("_");
  if (!runId) return null;
  return { runId, sha256Prefix };
}

/**
 * Returns true when `p` is safe to embed in a filesystem path:
 *   - Not absolute (no leading `/` or drive letter)
 *   - Contains no `../` traversal sequences
 */
function isSafePath(p: string): boolean {
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return false;
  const norm = p.replace(/\\/g, "/");
  if (norm.includes("../") || norm.startsWith("..") || norm.includes("/.."))
    return false;
  return true;
}

// ── Importer ───────────────────────────────────────────────────────────────────

export async function relayImportRun(
  opts: ImportRunOptions,
): Promise<ImportRunResult> {
  const { bundlePath, runsRoot, overwrite = false } = opts;

  // 1. Parse expected run_id + sha256 prefix from filename.
  const parsedFilename = parseRunBundleFilename(bundlePath);
  if (!parsedFilename) {
    return {
      ok: false,
      code: "RELAY_IMPORT_RUN_INVALID_FILENAME",
      message: "Filename does not match expected format run_<runId>_<sha256prefix12>.tar.gz",
    };
  }
  const { runId: filenameRunId, sha256Prefix: expectedPrefix } = parsedFilename;

  // 2. Read archive.
  let archiveData: Buffer;
  try {
    archiveData = readFileSync(bundlePath);
  } catch (e) {
    return {
      ok: false,
      code: "RELAY_IMPORT_RUN_READ_FAILED",
      message: String(e),
    };
  }

  // 3. Verify archive sha256 against filename prefix.
  const actualSha256 = sha256Hex(archiveData);
  if (!actualSha256.startsWith(expectedPrefix)) {
    return {
      ok: false,
      code: "RELAY_IMPORT_RUN_HASH_MISMATCH",
      message: `sha256 prefix mismatch: got ${actualSha256.slice(0, 12)}, expected ${expectedPrefix}`,
    };
  }

  // 4. Parse tar.gz.
  let entries: Awaited<ReturnType<typeof parseTarGz>>;
  try {
    entries = await parseTarGz(archiveData);
  } catch (e) {
    return {
      ok: false,
      code: "RELAY_IMPORT_RUN_PARSE_FAILED",
      message: String(e),
    };
  }

  // 5. Reject symlinks (before anything else).
  for (const e of entries) {
    if (e.typeflag === "2") {
      return {
        ok: false,
        code: "RELAY_IMPORT_RUN_SYMLINK_REJECTED",
        message: `Symlink rejected: ${e.name}`,
      };
    }
  }

  // 6. Find and parse run-relay-manifest.json.
  const manifestEntry = entries.find(
    (e) => e.name === "run-relay-manifest.json",
  );
  if (!manifestEntry) {
    return {
      ok: false,
      code: "RELAY_IMPORT_RUN_MANIFEST_MISSING",
      message: "run-relay-manifest.json not found in archive",
    };
  }
  let manifest: RunRelayManifestV1;
  try {
    manifest = JSON.parse(
      manifestEntry.data.toString("utf8"),
    ) as RunRelayManifestV1;
  } catch {
    return {
      ok: false,
      code: "RELAY_IMPORT_RUN_MANIFEST_INVALID",
      message: "run-relay-manifest.json contains invalid JSON",
    };
  }

  // 7a. Verify filename run_id matches manifest.run_id (Slice 7.2).
  if (filenameRunId !== manifest.run_id) {
    return {
      ok: false,
      code: "RELAY_IMPORT_RUN_RUN_ID_MISMATCH",
      message: `Filename run_id '${filenameRunId}' does not match manifest run_id '${manifest.run_id}'`,
    };
  }

  // 7. Validate all paths for traversal (archive entries + manifest files).
  for (const e of entries) {
    if (e.name === "run-relay-manifest.json") continue;
    if (!isSafePath(e.name)) {
      return {
        ok: false,
        code: "RELAY_IMPORT_RUN_PATH_TRAVERSAL",
        message: `Unsafe archive path: ${e.name}`,
      };
    }
  }
  for (const f of manifest.files) {
    if (!isSafePath(f.path)) {
      return {
        ok: false,
        code: "RELAY_IMPORT_RUN_PATH_TRAVERSAL",
        message: `Unsafe manifest path: ${f.path}`,
      };
    }
  }

  // 8. Build entry map (excludes manifest itself).
  const entryMap = new Map(
    entries
      .filter((e) => e.name !== "run-relay-manifest.json")
      .map((e) => [e.name, e.data]),
  );

  // 9. Reject extra files — archive entries not listed in the manifest.
  const manifestPaths = new Set(manifest.files.map((f) => f.path));
  for (const [name] of entryMap) {
    if (!manifestPaths.has(name)) {
      return {
        ok: false,
        code: "RELAY_IMPORT_RUN_EXTRA_FILE",
        message: `Archive contains file not listed in manifest: ${name}`,
      };
    }
  }

  // 10. Verify per-file sha256 + byte count.
  for (const f of manifest.files) {
    const data = entryMap.get(f.path);
    if (!data) {
      return {
        ok: false,
        code: "RELAY_IMPORT_RUN_FILE_MISSING",
        message: `File listed in manifest but absent from archive: ${f.path}`,
      };
    }
    if (data.length !== f.bytes) {
      return {
        ok: false,
        code: "RELAY_IMPORT_RUN_FILE_SIZE_MISMATCH",
        message: `Byte count mismatch for: ${f.path}`,
      };
    }
    if (sha256Hex(data) !== f.sha256) {
      return {
        ok: false,
        code: "RELAY_IMPORT_RUN_FILE_HASH_MISMATCH",
        message: `sha256 mismatch for: ${f.path}`,
      };
    }
  }

  // 11. Compute and validate destination paths.
  const runId = manifest.run_id;
  const destRunDir = resolve(join(runsRoot, runId));
  const runsRootResolved = resolve(runsRoot);

  // run_id must not escape runsRoot.
  if (
    !destRunDir.startsWith(runsRootResolved + sep) &&
    destRunDir !== runsRootResolved
  ) {
    return {
      ok: false,
      code: "RELAY_IMPORT_RUN_PATH_TRAVERSAL",
      message: `run_id escapes runs root: ${runId}`,
    };
  }

  // Individual files must resolve inside destRunDir.
  for (const f of manifest.files) {
    const resolved = resolve(join(destRunDir, f.path));
    if (
      !resolved.startsWith(destRunDir + "/") &&
      !resolved.startsWith(destRunDir + "\\") &&
      resolved !== destRunDir
    ) {
      return {
        ok: false,
        code: "RELAY_IMPORT_RUN_PATH_TRAVERSAL",
        message: `Path escapes run directory: ${f.path}`,
      };
    }
  }

  // 12. Non-destructive check.
  if (!overwrite && existsSync(destRunDir)) {
    return {
      ok: false,
      code: "RELAY_IMPORT_RUN_DEST_EXISTS",
      message: `Run directory already exists (use --overwrite): ${destRunDir}`,
    };
  }

  // 13. All checks passed — write files.
  const written: string[] = [];
  for (const f of manifest.files) {
    const dest = join(destRunDir, f.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, entryMap.get(f.path)!);
    written.push(dest);
  }

  return { ok: true, runId, files: written };
}
