import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const script = resolve("tools/release-artifacts.mjs");

test("stages both Linux packages and writes reproducible checksums", () => {
  const root = mkdtempSync(join(tmpdir(), "release-artifacts-test-"));
  const source = join(root, "bundle");
  const output = join(root, "output");
  mkdirSync(join(source, "appimage"), { recursive: true });
  mkdirSync(join(source, "deb"), { recursive: true });
  writeFileSync(
    join(source, "appimage", "Local.Expert.Disk.AppImage"),
    "appimage",
  );
  writeFileSync(join(source, "deb", "local-expert-disk.deb"), "deb");

  execFileSync(process.execPath, [script, "stage", "linux", source, output]);
  const sums = readFileSync(join(output, "SHA256SUMS.linux"), "utf8");
  assert.match(sums, /Local\.Expert\.Disk\.AppImage/);
  assert.match(sums, /local-expert-disk\.deb/);
  assert.equal(sums.trim().split("\n").length, 2);
  execFileSync(process.execPath, [script, "verify", output]);
  writeFileSync(join(output, "local-expert-disk.deb"), "tampered");
  assert.notEqual(
    spawnSync(process.execPath, [script, "verify", output]).status,
    0,
  );
});

test("refuses an incomplete platform bundle", () => {
  const root = mkdtempSync(join(tmpdir(), "release-artifacts-test-"));
  const source = join(root, "bundle");
  mkdirSync(source);
  const result = spawnSync(process.execPath, [
    script,
    "stage",
    "windows",
    source,
    join(root, "output"),
  ]);
  assert.notEqual(result.status, 0);
});

test("release versions agree across all manifests", () => {
  assert.equal(
    execFileSync(process.execPath, [resolve("tools/release-version.mjs")], {
      encoding: "utf8",
    }).trim(),
    "0.1.0",
  );
});
