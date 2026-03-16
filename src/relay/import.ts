import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { parseTarGz } from "./tar.js";
import { sha256Hex } from "./hash.js";
import type { RelayManifestV1 } from "./manifest.js";

export interface ImportOptions {
  bundlePath: string;
  artifactRoot: string;
  overwrite?: boolean;
}

export type ImportResult =
  | { ok: true; files: string[] }
  | { ok: false; code: string; message: string };

function extractSha256Prefix(bundlePath: string): string | null {
  const base = bundlePath.replace(/\\/g, "/").split("/").pop() ?? "";
  if (!base.endsWith(".tar.gz")) return null;
  const parts = base.slice(0, -7).split("_");
  const last = parts[parts.length - 1];
  return /^[0-9a-f]{12}$/.test(last) ? last : null;
}

function isSafePath(p: string): boolean {
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return false;
  const norm = p.replace(/\\/g, "/");
  if (norm.includes("../") || norm.startsWith("..") || norm.includes("/..")) return false;
  return true;
}

export async function relayImport(opts: ImportOptions): Promise<ImportResult> {
  const { bundlePath, artifactRoot, overwrite = false } = opts;

  // 1. Parse expected sha256 prefix from filename
  const expectedPrefix = extractSha256Prefix(bundlePath);
  if (!expectedPrefix) {
    return { ok: false, code: "RELAY_IMPORT_INVALID_FILENAME", message: "No valid sha256 prefix in filename" };
  }

  // 2. Read archive
  let archiveData: Buffer;
  try { archiveData = readFileSync(bundlePath); }
  catch (e) { return { ok: false, code: "RELAY_IMPORT_READ_FAILED", message: String(e) }; }

  // 3. Verify archive sha256 against filename prefix
  const actualSha256 = sha256Hex(archiveData);
  if (!actualSha256.startsWith(expectedPrefix)) {
    return { ok: false, code: "RELAY_IMPORT_HASH_MISMATCH", message: `sha256 prefix mismatch: got ${actualSha256.slice(0, 12)}, expected ${expectedPrefix}` };
  }

  // 4. Parse tar.gz
  let entries: Awaited<ReturnType<typeof parseTarGz>>;
  try { entries = await parseTarGz(archiveData); }
  catch (e) { return { ok: false, code: "RELAY_IMPORT_PARSE_FAILED", message: String(e) }; }

  // 5. Reject symlinks (before anything else)
  for (const e of entries) {
    if (e.typeflag === "2") {
      return { ok: false, code: "RELAY_IMPORT_SYMLINK_REJECTED", message: `Symlink rejected: ${e.name}` };
    }
  }

  // 6. Find and parse relay-manifest.json
  const manifestEntry = entries.find((e) => e.name === "relay-manifest.json");
  if (!manifestEntry) {
    return { ok: false, code: "RELAY_IMPORT_MANIFEST_MISSING", message: "relay-manifest.json not found" };
  }
  let manifest: RelayManifestV1;
  try { manifest = JSON.parse(manifestEntry.data.toString("utf8")) as RelayManifestV1; }
  catch { return { ok: false, code: "RELAY_IMPORT_MANIFEST_INVALID", message: "relay-manifest.json invalid JSON" }; }

  // 7. Validate all paths for traversal (archive entries + manifest files)
  for (const e of entries) {
    if (e.name === "relay-manifest.json") continue;
    if (!isSafePath(e.name)) {
      return { ok: false, code: "RELAY_IMPORT_PATH_TRAVERSAL", message: `Unsafe archive path: ${e.name}` };
    }
  }
  for (const f of manifest.files) {
    if (!isSafePath(f.path)) {
      return { ok: false, code: "RELAY_IMPORT_PATH_TRAVERSAL", message: `Unsafe manifest path: ${f.path}` };
    }
  }

  // 8. Build dest directory and verify resolved paths stay inside it
  const stepDirName = `${manifest.step_index}-${manifest.step_id}`;
  const destStepDir = resolve(join(artifactRoot, "steps", stepDirName));

  for (const f of manifest.files) {
    const resolved = resolve(join(destStepDir, f.path));
    if (!resolved.startsWith(destStepDir + "/") && !resolved.startsWith(destStepDir + "\\") && resolved !== destStepDir) {
      return { ok: false, code: "RELAY_IMPORT_PATH_TRAVERSAL", message: `Path escapes dest: ${f.path}` };
    }
  }

  // 9. Build entry map; verify per-file sha256 + byte count
  const entryMap = new Map(entries.map((e) => [e.name, e.data]));
  for (const f of manifest.files) {
    const data = entryMap.get(f.path);
    if (!data) {
      return { ok: false, code: "RELAY_IMPORT_FILE_MISSING", message: `File missing in archive: ${f.path}` };
    }
    if (data.length !== f.bytes) {
      return { ok: false, code: "RELAY_IMPORT_FILE_SIZE_MISMATCH", message: `Size mismatch: ${f.path}` };
    }
    if (sha256Hex(data) !== f.sha256) {
      return { ok: false, code: "RELAY_IMPORT_FILE_HASH_MISMATCH", message: `sha256 mismatch: ${f.path}` };
    }
  }

  // 10. Non-destructive check
  if (!overwrite) {
    for (const f of manifest.files) {
      const dest = join(destStepDir, f.path);
      if (existsSync(dest)) {
        return { ok: false, code: "RELAY_IMPORT_DEST_EXISTS", message: `File exists (use --overwrite): ${dest}` };
      }
    }
  }

  // 11. All checks passed — write files
  const written: string[] = [];
  for (const f of manifest.files) {
    const dest = join(destStepDir, f.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, entryMap.get(f.path)!);
    written.push(dest);
  }

  return { ok: true, files: written };
}
