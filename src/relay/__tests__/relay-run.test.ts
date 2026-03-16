/**
 * Agent OS v1.0 — Run-level Relay Tests (Slice 7).
 *
 * AC7-1: Deterministic export — byte-identical bundles across two exports of same run.
 * AC7-2: Only files under the run root are included in the bundle.
 * AC7-3: Manifest sha256/bytes verification enforced on import.
 * AC7-4: Import fails closed on archive content mismatch — zero writes.
 * AC7-5: Non-destructive by default — existing run dir blocks import.
 * AC7-6: Path traversal rejected in archive entries and manifest paths.
 * AC7-7: Symlinks inside archive are rejected.
 * AC7-8: Full suite green (verified by overall test run).
 *
 * Uses Node.js native test runner. Operates on a real temp filesystem.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { relayExportRun } from "../export-run.js";
import { relayImportRun } from "../import-run.js";
import { buildTarGz } from "../tar.js";
import { sha256Hex } from "../hash.js";
import type { RunRelayManifestV1 } from "../manifest.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Create a minimal run directory structure under `runsRoot/<runId>`.
 * Returns the run directory path.
 */
function makeRunDir(
  runsRoot: string,
  runId: string,
  files: Record<string, string> = {},
): string {
  const runDir = join(runsRoot, runId);
  mkdirSync(runDir, { recursive: true });

  // Default files every run has.
  const defaults: Record<string, string> = {
    "invocation.json": JSON.stringify({ run_id: runId, schema_version: "1.0" }) + "\n",
    "execution_log.jsonl": JSON.stringify({ event: "start", run_id: runId }) + "\n",
    "steps/0-step-a/step-report.json":
      JSON.stringify({ schema_version: "1.0", run_id: runId, step_id: "step-a" }) + "\n",
  };

  const merged = { ...defaults, ...files };
  for (const [rel, content] of Object.entries(merged)) {
    const dest = join(runDir, rel);
    mkdirSync(join(dest, ".."), { recursive: true });
    writeFileSync(dest, content, "utf8");
  }

  return runDir;
}

/**
 * Build a fake run-relay bundle in-memory from raw tar entries.
 * Computes the sha256 of the resulting archive and returns both the archive
 * Buffer and the expected bundle filename.
 */
async function buildFakeRunBundle(
  runId: string,
  entries: Array<{ name: string; data: Buffer; typeflag?: "0" | "2"; linkname?: string }>,
  manifest: RunRelayManifestV1,
): Promise<{ archive: Buffer; filename: string }> {
  const manifestData = Buffer.from(
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );
  const allEntries = [
    { name: "run-relay-manifest.json", data: manifestData },
    ...entries,
  ];
  const archive = await buildTarGz(allEntries);
  const prefix = sha256Hex(archive).slice(0, 12);
  return { archive, filename: `run_${runId}_${prefix}.tar.gz` };
}

// ── Shared temp directory ─────────────────────────────────────────────────────

let tmpRoot: string;

describe("Relay Run — Slice 7 (AC7-1 through AC7-7)", () => {
  before(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "agent-os-relay-run-"));
  });

  after(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  // ── AC7-1: Deterministic export ─────────────────────────────────────────────

  it("AC7-1 — deterministic export: byte-identical bundles across two exports", async () => {
    const runsRoot = join(tmpRoot, "ac7-1-runs");
    const out1 = join(tmpRoot, "ac7-1-out1");
    const out2 = join(tmpRoot, "ac7-1-out2");

    makeRunDir(runsRoot, "run-det");

    const r1 = await relayExportRun({ runId: "run-det", runsRoot, outDir: out1 });
    const r2 = await relayExportRun({ runId: "run-det", runsRoot, outDir: out2 });

    assert.equal(r1.ok, true, `export-1 failed: ${r1.ok ? "" : r1.message}`);
    assert.equal(r2.ok, true, `export-2 failed: ${r2.ok ? "" : r2.message}`);

    if (r1.ok && r2.ok) {
      // Filenames must match (same sha256 prefix implies byte-identical content).
      assert.equal(basename(r1.bundlePath), basename(r2.bundlePath), "filenames must be identical");

      // Byte-level comparison.
      const b1 = readFileSync(r1.bundlePath);
      const b2 = readFileSync(r2.bundlePath);
      assert.ok(b1.equals(b2), "archive bytes must be identical across two exports");
    }
  });

  // ── AC7-2: Only run-root files included ─────────────────────────────────────

  it("AC7-2 — only files under the run root are included in the bundle", async () => {
    const runsRoot = join(tmpRoot, "ac7-2-runs");
    const outDir = join(tmpRoot, "ac7-2-out");

    // Create two runs side by side.
    makeRunDir(runsRoot, "run-alpha", { "alpha-only.txt": "alpha content\n" });
    makeRunDir(runsRoot, "run-beta", { "beta-only.txt": "beta content\n" });

    // Export only run-alpha.
    const result = await relayExportRun({
      runId: "run-alpha",
      runsRoot,
      outDir,
    });

    assert.equal(result.ok, true, `export failed: ${result.ok ? "" : result.message}`);
    if (!result.ok) return;

    // Import to a fresh root and verify beta files are absent.
    const importRoot = join(tmpRoot, "ac7-2-import");
    const importResult = await relayImportRun({
      bundlePath: result.bundlePath,
      runsRoot: importRoot,
    });

    assert.equal(importResult.ok, true, `import failed: ${importResult.ok ? "" : importResult.message}`);
    if (!importResult.ok) return;

    // alpha-only.txt must be present.
    assert.ok(
      existsSync(join(importRoot, "run-alpha", "alpha-only.txt")),
      "alpha-only.txt must be restored",
    );
    // beta-only.txt must NOT be present.
    assert.ok(
      !existsSync(join(importRoot, "run-alpha", "beta-only.txt")),
      "beta-only.txt must NOT be present in run-alpha bundle",
    );
    // run-beta directory must not exist.
    assert.ok(
      !existsSync(join(importRoot, "run-beta")),
      "run-beta directory must not be created",
    );
  });

  // ── AC7-3: Manifest verification enforced ───────────────────────────────────

  it("AC7-3 — manifest sha256 mismatch is rejected on import; zero writes", async () => {
    const runsRoot = join(tmpRoot, "ac7-3-runs");
    const outDir = join(tmpRoot, "ac7-3-out");
    makeRunDir(runsRoot, "run-verify");

    const exportResult = await relayExportRun({
      runId: "run-verify",
      runsRoot,
      outDir,
    });
    assert.equal(exportResult.ok, true);
    if (!exportResult.ok) return;

    // Build a tampered bundle: correct archive structure but a manifest that
    // claims a wrong sha256 for one of the files.
    const realFileData = Buffer.from(
      JSON.stringify({ run_id: "run-verify", schema_version: "1.0" }) + "\n",
      "utf8",
    );
    const tamperedManifest: RunRelayManifestV1 = {
      relay_format_version: "1",
      run_id: "run-verify",
      files: [
        {
          path: "invocation.json",
          sha256: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef", // wrong
          bytes: realFileData.length,
        },
      ],
    };

    const { archive, filename } = await buildFakeRunBundle(
      "run-verify",
      [{ name: "invocation.json", data: realFileData }],
      tamperedManifest,
    );

    const bundleDir = join(tmpRoot, "ac7-3-tampered");
    mkdirSync(bundleDir, { recursive: true });
    const bundlePath = join(bundleDir, filename);
    writeFileSync(bundlePath, archive);

    const importRoot = join(tmpRoot, "ac7-3-import");
    const importResult = await relayImportRun({
      bundlePath,
      runsRoot: importRoot,
    });

    assert.equal(importResult.ok, false);
    if (!importResult.ok) {
      assert.equal(importResult.code, "RELAY_IMPORT_RUN_FILE_HASH_MISMATCH");
    }
    // Zero writes — destination run directory must not exist.
    assert.ok(
      !existsSync(join(importRoot, "run-verify")),
      "run directory must not be created on manifest hash mismatch",
    );
  });

  // ── AC7-4: Import fails closed on archive content mismatch ──────────────────

  it("AC7-4 — archive content mismatch => import fails; zero writes", async () => {
    // Build a bundle where the archive file content differs from what the
    // manifest declares (byte-count mismatch triggers before sha256 check).
    const runId = "run-corrupt";
    const correctData = Buffer.from("correct content\n", "utf8");
    const corruptData  = Buffer.from("CORRUPTED CONTENT LONGER\n", "utf8");

    const manifest: RunRelayManifestV1 = {
      relay_format_version: "1",
      run_id: runId,
      files: [
        {
          path: "invocation.json",
          sha256: sha256Hex(correctData),
          bytes: correctData.length,         // correct length declared
        },
      ],
    };

    // But the archive contains corruptData (different length and hash).
    const { archive, filename } = await buildFakeRunBundle(
      runId,
      [{ name: "invocation.json", data: corruptData }],
      manifest,
    );

    const bundleDir = join(tmpRoot, "ac7-4-bundle");
    mkdirSync(bundleDir, { recursive: true });
    const bundlePath = join(bundleDir, filename);
    writeFileSync(bundlePath, archive);

    const importRoot = join(tmpRoot, "ac7-4-import");
    const result = await relayImportRun({ bundlePath, runsRoot: importRoot });

    assert.equal(result.ok, false);
    if (!result.ok) {
      // Either size or hash mismatch — both mean import fails closed.
      assert.ok(
        result.code === "RELAY_IMPORT_RUN_FILE_SIZE_MISMATCH" ||
        result.code === "RELAY_IMPORT_RUN_FILE_HASH_MISMATCH",
        `expected size or hash mismatch, got: ${result.code}`,
      );
    }
    assert.ok(
      !existsSync(join(importRoot, runId)),
      "run directory must not be created on content mismatch",
    );
  });

  // ── AC7-5: Non-destructive by default ───────────────────────────────────────

  it("AC7-5 — import without --overwrite fails if run directory already exists", async () => {
    const runsRoot = join(tmpRoot, "ac7-5-src-runs");
    const outDir = join(tmpRoot, "ac7-5-out");
    makeRunDir(runsRoot, "run-nodestr");

    const exportResult = await relayExportRun({
      runId: "run-nodestr",
      runsRoot,
      outDir,
    });
    assert.equal(exportResult.ok, true);
    if (!exportResult.ok) return;

    // First import — must succeed.
    const importRoot = join(tmpRoot, "ac7-5-import");
    const first = await relayImportRun({
      bundlePath: exportResult.bundlePath,
      runsRoot: importRoot,
    });
    assert.equal(first.ok, true, `first import failed: ${first.ok ? "" : first.message}`);

    // Second import without --overwrite — must fail.
    const second = await relayImportRun({
      bundlePath: exportResult.bundlePath,
      runsRoot: importRoot,
    });
    assert.equal(second.ok, false);
    if (!second.ok) {
      assert.equal(second.code, "RELAY_IMPORT_RUN_DEST_EXISTS");
      assert.match(second.message, /--overwrite/);
    }

    // Third import with --overwrite — must succeed.
    const third = await relayImportRun({
      bundlePath: exportResult.bundlePath,
      runsRoot: importRoot,
      overwrite: true,
    });
    assert.equal(third.ok, true, `overwrite import failed: ${third.ok ? "" : third.message}`);
  });

  // ── AC7-6: Path traversal rejection ─────────────────────────────────────────

  it("AC7-6 — path traversal in archive entry => RELAY_IMPORT_RUN_PATH_TRAVERSAL; zero writes", async () => {
    const runId = "run-traversal";
    const safeData = Buffer.from("safe\n", "utf8");

    const manifest: RunRelayManifestV1 = {
      relay_format_version: "1",
      run_id: runId,
      files: [
        { path: "safe-file.txt", sha256: sha256Hex(safeData), bytes: safeData.length },
        { path: "../escape.txt", sha256: sha256Hex(safeData), bytes: safeData.length },
      ],
    };

    const { archive, filename } = await buildFakeRunBundle(
      runId,
      [
        { name: "safe-file.txt", data: safeData },
        { name: "../escape.txt", data: safeData },
      ],
      manifest,
    );

    const bundleDir = join(tmpRoot, "ac7-6-bundle");
    mkdirSync(bundleDir, { recursive: true });
    const bundlePath = join(bundleDir, filename);
    writeFileSync(bundlePath, archive);

    const importRoot = join(tmpRoot, "ac7-6-import");
    const result = await relayImportRun({ bundlePath, runsRoot: importRoot });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "RELAY_IMPORT_RUN_PATH_TRAVERSAL");
      assert.match(result.message, /escape\.txt/);
    }
    assert.ok(
      !existsSync(join(importRoot, runId)),
      "run directory must not be created on path traversal",
    );
  });

  // ── AC7-7: Symlink rejection ─────────────────────────────────────────────────

  it("AC7-7 — symlink entry in archive => RELAY_IMPORT_RUN_SYMLINK_REJECTED; zero writes", async () => {
    const runId = "run-symlink";
    const realData = Buffer.from("real content\n", "utf8");

    const manifest: RunRelayManifestV1 = {
      relay_format_version: "1",
      run_id: runId,
      files: [
        { path: "real-file.txt", sha256: sha256Hex(realData), bytes: realData.length },
      ],
    };

    // Build the tar manually: include a symlink entry alongside the real file.
    const manifestData = Buffer.from(
      JSON.stringify(manifest, null, 2) + "\n",
      "utf8",
    );
    const archive = await buildTarGz([
      { name: "run-relay-manifest.json", data: manifestData },
      { name: "real-file.txt", data: realData },
      // Symlink: typeflag="2", linkname points somewhere.
      {
        name: "evil-link",
        data: Buffer.alloc(0),
        typeflag: "2",
        linkname: "/etc/passwd",
      },
    ]);

    const prefix = sha256Hex(archive).slice(0, 12);
    const filename = `run_${runId}_${prefix}.tar.gz`;

    const bundleDir = join(tmpRoot, "ac7-7-bundle");
    mkdirSync(bundleDir, { recursive: true });
    const bundlePath = join(bundleDir, filename);
    writeFileSync(bundlePath, archive);

    const importRoot = join(tmpRoot, "ac7-7-import");
    const result = await relayImportRun({ bundlePath, runsRoot: importRoot });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "RELAY_IMPORT_RUN_SYMLINK_REJECTED");
      assert.match(result.message, /evil-link/);
    }
    assert.ok(
      !existsSync(join(importRoot, runId)),
      "run directory must not be created when symlink is present",
    );
  });

  // ── AC7-RunId: Filename run_id mismatch ─────────────────────────────────────

  it("AC7-RunId — filename run_id segment mismatch => RELAY_IMPORT_RUN_RUN_ID_MISMATCH; zero writes", async () => {
    const runsRoot = join(tmpRoot, "ac7-runid-runs");
    const outDir = join(tmpRoot, "ac7-runid-out");

    // Export a real bundle for "run-real".
    makeRunDir(runsRoot, "run-real");
    const exportResult = await relayExportRun({
      runId: "run-real",
      runsRoot,
      outDir,
    });
    assert.equal(exportResult.ok, true, `export failed: ${exportResult.ok ? "" : exportResult.message}`);
    if (!exportResult.ok) return;

    // Rename: swap "run-real" → "run-fake" in the filename.
    // The archive bytes are unchanged so the sha256 prefix still matches the
    // archive content — only the run_id segment in the name is wrong.
    const origBase = basename(exportResult.bundlePath);
    const fakeBase = origBase.replace("run-real", "run-fake");
    const renamedDir = join(tmpRoot, "ac7-runid-renamed");
    mkdirSync(renamedDir, { recursive: true });
    const fakePath = join(renamedDir, fakeBase);
    writeFileSync(fakePath, readFileSync(exportResult.bundlePath));

    const importRoot = join(tmpRoot, "ac7-runid-import");
    const result = await relayImportRun({ bundlePath: fakePath, runsRoot: importRoot });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "RELAY_IMPORT_RUN_RUN_ID_MISMATCH");
      assert.match(result.message, /run-fake/);
      assert.match(result.message, /run-real/);
    }
    // Zero writes — neither the real nor the fake run dir may be created.
    assert.ok(
      !existsSync(join(importRoot, "run-real")),
      "run-real directory must not be created",
    );
    assert.ok(
      !existsSync(join(importRoot, "run-fake")),
      "run-fake directory must not be created",
    );
  });

  // ── AC7-Extra: Extra file in archive not in manifest ─────────────────────────

  it("AC7-Extra — archive contains extra file not in manifest => RELAY_IMPORT_RUN_EXTRA_FILE; zero writes", async () => {
    const runId = "run-extra-file";
    const listedData = Buffer.from("listed content\n", "utf8");
    const extraData  = Buffer.from("extra content\n", "utf8");

    // Manifest lists only invocation.json — extra.txt is NOT listed.
    const manifest: RunRelayManifestV1 = {
      relay_format_version: "1",
      run_id: runId,
      files: [
        {
          path: "invocation.json",
          sha256: sha256Hex(listedData),
          bytes: listedData.length,
        },
      ],
    };

    // Archive contains both invocation.json AND extra.txt (unlisted).
    const { archive, filename } = await buildFakeRunBundle(
      runId,
      [
        { name: "invocation.json", data: listedData },
        { name: "extra.txt",       data: extraData },
      ],
      manifest,
    );

    const bundleDir = join(tmpRoot, "ac7-extra-bundle");
    mkdirSync(bundleDir, { recursive: true });
    const bundlePath = join(bundleDir, filename);
    writeFileSync(bundlePath, archive);

    const importRoot = join(tmpRoot, "ac7-extra-import");
    const result = await relayImportRun({ bundlePath, runsRoot: importRoot });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "RELAY_IMPORT_RUN_EXTRA_FILE");
      assert.match(result.message, /extra\.txt/);
    }
    // Zero writes — destination run directory must not exist.
    assert.ok(
      !existsSync(join(importRoot, runId)),
      "run directory must not be created when archive contains unlisted file",
    );
  });
}); // end Relay Run — Slice 7
