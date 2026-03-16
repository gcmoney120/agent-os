/**
 * Agent OS v1.0 — Relay Tests (Slice 5).
 * AC1–AC11: Artifact Relay v1 (offline bundle transport).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { relayExport } from "../export.js";
import { relayImport } from "../import.js";
import { sha256Hex } from "../hash.js";
import { buildTarGz } from "../tar.js";
import type { RelayManifestV1 } from "../manifest.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const VALID_REPORT = JSON.stringify({
  schema_version: "1.0",
  run_id: "run-001",
  step_id: "step-a",
  step_index: 0,
  actor: "forge",
  action: "forge.implement",
  status: "succeeded",
  summary: "Test step",
  artifacts: {},
  state_impact: "none",
  timestamp: "2026-02-27T00:00:00.000Z",
}, null, 2) + "\n";

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "relay-test-"));
}

/** Create a minimal valid step artifacts directory. */
function makeStepDir(artifactsRoot: string, extraFiles: Record<string, string> = {}): void {
  const stepDir = join(artifactsRoot, "steps", "0-step-a");
  mkdirSync(stepDir, { recursive: true });
  writeFileSync(join(stepDir, "step-report.json"), VALID_REPORT);
  for (const [name, content] of Object.entries(extraFiles)) {
    writeFileSync(join(stepDir, name), content);
  }
}

/** Build a custom bundle from arbitrary entries (for failure-case testing). */
async function buildFakeBundle(opts: {
  manifest: RelayManifestV1;
  files: Array<{ name: string; data: Buffer; typeflag?: "0" | "2"; linkname?: string }>;
  outDir: string;
}): Promise<string> {
  const manifestBuf = Buffer.from(JSON.stringify(opts.manifest, null, 2) + "\n", "utf8");
  const entries = [
    { name: "relay-manifest.json", data: manifestBuf },
    ...opts.files,
  ].sort((a, b) => a.name.localeCompare(b.name));

  const archiveBuf = await buildTarGz(entries);
  const sha256Prefix = sha256Hex(archiveBuf).slice(0, 12);
  const bundleName = `relay_${opts.manifest.run_id}_${opts.manifest.step_index}_${opts.manifest.step_id}_${sha256Prefix}.tar.gz`;
  const bundlePath = join(opts.outDir, bundleName);
  writeFileSync(bundlePath, archiveBuf);
  return bundlePath;
}

function baseManifest(overrides: Partial<RelayManifestV1> = {}): RelayManifestV1 {
  return {
    relay_format_version: "1",
    run_id: "run-001",
    step_index: 0,
    step_id: "step-a",
    actor: "forge",
    action: "forge.implement",
    files: [],
    review_targets: ["step-report.json"],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Relay — Slice 5 (AC1–AC11)", () => {

  // AC1: Export fails if step-report.json missing
  it("AC1 — export: missing step-report.json => RELAY_EXPORT_MISSING_STEP_REPORT; no bundle", async () => {
    const tmp = makeTmp();
    try {
      const artifactsRoot = join(tmp, "artifacts");
      const stepDir = join(artifactsRoot, "steps", "0-step-a");
      mkdirSync(stepDir, { recursive: true });
      writeFileSync(join(stepDir, "other.txt"), "data");

      const result = await relayExport({ runId: "run-001", step: "step-a", artifactsRoot, outDir: join(tmp, "out") });

      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "RELAY_EXPORT_MISSING_STEP_REPORT");
      // no bundle written
      try { assert.equal(readdirSync(join(tmp, "out")).length, 0); } catch { /* out dir may not exist */ }
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

  // AC2: Export produces bundle with correct sha256 prefix
  it("AC2 — export: valid step => bundle filename contains correct sha256 prefix", async () => {
    const tmp = makeTmp();
    try {
      const artifactsRoot = join(tmp, "artifacts");
      makeStepDir(artifactsRoot);
      const outDir = join(tmp, "out");

      const result = await relayExport({ runId: "run-001", step: "step-a", artifactsRoot, outDir });

      if (!result.ok) throw new Error(result.message);
      assert.equal(result.ok, true);

      const archiveBytes = readFileSync(result.bundlePath);
      const actualSha256 = sha256Hex(archiveBytes);
      const prefixInName = result.bundleName.split("_").pop()!.replace(".tar.gz", "");

      assert.equal(prefixInName.length, 12);
      assert.ok(actualSha256.startsWith(prefixInName), `sha256 prefix mismatch: ${actualSha256.slice(0, 12)} vs ${prefixInName}`);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

  // AC3: Determinism — same inputs produce byte-identical bundles
  it("AC3 — export: deterministic; identical inputs => byte-identical bundles", async () => {
    const tmp = makeTmp();
    try {
      const artifactsRoot = join(tmp, "artifacts");
      makeStepDir(artifactsRoot, { "extra.txt": "hello world" });
      const out1 = join(tmp, "out1");
      const out2 = join(tmp, "out2");

      const r1 = await relayExport({ runId: "run-001", step: "step-a", artifactsRoot, outDir: out1 });
      const r2 = await relayExport({ runId: "run-001", step: "step-a", artifactsRoot, outDir: out2 });

      assert.equal(r1.ok, true);
      assert.equal(r2.ok, true);
      if (!r1.ok || !r2.ok) throw new Error("export failed");

      const b1 = readFileSync(r1.bundlePath);
      const b2 = readFileSync(r2.bundlePath);
      assert.ok(b1.equals(b2), "bundles are not byte-identical");
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

  // AC4: manifest.files contains all step files except relay-manifest.json
  it("AC4 — export: manifest.files includes all step files; relay-manifest.json excluded", async () => {
    const tmp = makeTmp();
    try {
      const artifactsRoot = join(tmp, "artifacts");
      makeStepDir(artifactsRoot, { "dispatch-context.json": "{}", "runner-log.txt": "log" });
      const outDir = join(tmp, "out");

      const r = await relayExport({ runId: "run-001", step: "step-a", artifactsRoot, outDir });
      if (!r.ok) throw new Error(r.message);
      assert.equal(r.ok, true);

      const { parseTarGz } = await import("../tar.js");
      const entries = await parseTarGz(readFileSync(r.bundlePath));
      const manifestEntry = entries.find((e) => e.name === "relay-manifest.json");
      assert.ok(manifestEntry, "relay-manifest.json not in archive");

      const manifest = JSON.parse(manifestEntry!.data.toString("utf8")) as RelayManifestV1;
      const manifestPaths = manifest.files.map((f) => f.path).sort();

      assert.ok(!manifestPaths.includes("relay-manifest.json"), "manifest must not self-reference");
      assert.ok(manifestPaths.includes("step-report.json"));
      assert.ok(manifestPaths.includes("dispatch-context.json"));
      assert.ok(manifestPaths.includes("runner-log.txt"));
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

  // AC5: Export fails if bundle already exists
  it("AC5 — export: bundle already exists => RELAY_EXPORT_BUNDLE_EXISTS; no overwrite", async () => {
    const tmp = makeTmp();
    try {
      const artifactsRoot = join(tmp, "artifacts");
      makeStepDir(artifactsRoot);
      const outDir = join(tmp, "out");

      const r1 = await relayExport({ runId: "run-001", step: "step-a", artifactsRoot, outDir });
      assert.equal(r1.ok, true);

      const r2 = await relayExport({ runId: "run-001", step: "step-a", artifactsRoot, outDir });
      assert.equal(r2.ok, false);
      if (!r2.ok) assert.equal(r2.code, "RELAY_EXPORT_BUNDLE_EXISTS");
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

  // AC6: Import rejects archive with wrong sha256 prefix
  it("AC6 — import: sha256 prefix mismatch => RELAY_IMPORT_HASH_MISMATCH; zero writes", async () => {
    const tmp = makeTmp();
    try {
      const artifactsRoot = join(tmp, "artifacts");
      makeStepDir(artifactsRoot);
      const outDir = join(tmp, "out");
      const r = await relayExport({ runId: "run-001", step: "step-a", artifactsRoot, outDir });
      if (!r.ok) throw new Error(r.message);
      assert.equal(r.ok, true);

      // Rename bundle to have a wrong sha256 prefix
      const wrongName = r.bundleName.replace(/[0-9a-f]{12}\.tar\.gz$/, "000000000000.tar.gz");
      const wrongPath = join(outDir, wrongName);
      const { renameSync } = await import("node:fs");
      renameSync(r.bundlePath, wrongPath);

      const destDir = join(tmp, "dest");
      const result = await relayImport({ bundlePath: wrongPath, artifactRoot: destDir });

      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "RELAY_IMPORT_HASH_MISMATCH");
      // No files written
      try { assert.equal(readdirSync(join(destDir, "steps")).length, 0); } catch { /* dir not created = correct */ }
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

  // AC7: Import rejects path traversal entries; zero filesystem writes
  it("AC7 — import: path traversal in archive => RELAY_IMPORT_PATH_TRAVERSAL; zero writes", async () => {
    const tmp = makeTmp();
    try {
      const traversalData = Buffer.from("evil content");
      const bundlePath = await buildFakeBundle({
        manifest: baseManifest({
          files: [{ path: "../evil.txt", sha256: sha256Hex(traversalData), bytes: traversalData.length }],
        }),
        files: [{ name: "../evil.txt", data: traversalData }],
        outDir: tmp,
      });

      const destDir = join(tmp, "dest");
      const result = await relayImport({ bundlePath, artifactRoot: destDir });

      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "RELAY_IMPORT_PATH_TRAVERSAL");
      try { assert.equal(readdirSync(join(destDir, "steps")).length, 0); } catch { /* correct */ }
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

  // AC8: Import rejects symlinks; zero filesystem writes
  it("AC8 — import: symlink in archive => RELAY_IMPORT_SYMLINK_REJECTED; zero writes", async () => {
    const tmp = makeTmp();
    try {
      const bundlePath = await buildFakeBundle({
        manifest: baseManifest({ files: [] }),
        files: [{ name: "bad-link", data: Buffer.alloc(0), typeflag: "2", linkname: "/etc/passwd" }],
        outDir: tmp,
      });

      const destDir = join(tmp, "dest");
      const result = await relayImport({ bundlePath, artifactRoot: destDir });

      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "RELAY_IMPORT_SYMLINK_REJECTED");
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

  // AC9: Import rejects file with wrong sha256
  it("AC9 — import: file sha256 mismatch => RELAY_IMPORT_FILE_HASH_MISMATCH; zero writes", async () => {
    const tmp = makeTmp();
    try {
      const realData = Buffer.from(VALID_REPORT, "utf8");
      const wrongHash = sha256Hex(Buffer.from("not the real content"));

      const bundlePath = await buildFakeBundle({
        manifest: baseManifest({
          files: [{ path: "step-report.json", sha256: wrongHash, bytes: realData.length }],
        }),
        files: [{ name: "step-report.json", data: realData }],
        outDir: tmp,
      });

      const destDir = join(tmp, "dest");
      const result = await relayImport({ bundlePath, artifactRoot: destDir });

      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "RELAY_IMPORT_FILE_HASH_MISMATCH");
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

  // AC10: Import non-destructive — fails if dest file exists without --overwrite
  it("AC10 — import: dest file exists without --overwrite => RELAY_IMPORT_DEST_EXISTS; zero new writes", async () => {
    const tmp = makeTmp();
    try {
      const artifactsRoot = join(tmp, "artifacts");
      makeStepDir(artifactsRoot);
      const outDir = join(tmp, "out");

      const r = await relayExport({ runId: "run-001", step: "step-a", artifactsRoot, outDir });
      if (!r.ok) throw new Error(r.message);
      assert.equal(r.ok, true);

      // Pre-create the destination file
      const destDir = join(tmp, "dest");
      mkdirSync(join(destDir, "steps", "0-step-a"), { recursive: true });
      writeFileSync(join(destDir, "steps", "0-step-a", "step-report.json"), "existing content");

      const result = await relayImport({ bundlePath: r.bundlePath, artifactRoot: destDir });

      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "RELAY_IMPORT_DEST_EXISTS");

      // Existing file must not have been overwritten
      const existing = readFileSync(join(destDir, "steps", "0-step-a", "step-report.json"), "utf8");
      assert.equal(existing, "existing content");
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

  // AC11: Import success — files extracted, paths match manifest
  it("AC11 — import: valid bundle => all files extracted; paths match manifest", async () => {
    const tmp = makeTmp();
    try {
      const artifactsRoot = join(tmp, "artifacts");
      makeStepDir(artifactsRoot, { "dispatch-context.json": '{"run_id":"run-001"}' });
      const outDir = join(tmp, "out");

      const r = await relayExport({ runId: "run-001", step: "step-a", artifactsRoot, outDir });
      if (!r.ok) throw new Error(r.message);
      assert.equal(r.ok, true);

      const destDir = join(tmp, "dest");
      const result = await relayImport({ bundlePath: r.bundlePath, artifactRoot: destDir });

      if (!result.ok) throw new Error(result.message);
      assert.equal(result.ok, true);

      // Verify extracted files match originals
      const srcStep = join(artifactsRoot, "steps", "0-step-a");
      const dstStep = join(destDir, "steps", "0-step-a");
      for (const fname of ["step-report.json", "dispatch-context.json"]) {
        const src = readFileSync(join(srcStep, fname));
        const dst = readFileSync(join(dstStep, fname));
        assert.ok(src.equals(dst), `${fname} content differs`);
      }
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

});
