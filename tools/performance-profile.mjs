import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const profiles = {
  "1m": {
    name: "WIDE-1M-GATE",
    files: "1000000",
    iterations: "1",
    output: "benchmark-results/wide-1m-gate.json",
  },
  "5m": {
    name: "WIDE-5M-CONTROLLED",
    files: "5000000",
    iterations: "1",
    output: "benchmark-results/wide-5m-controlled.json",
    controlled: true,
  },
  soak: {
    name: "WIDE-100K-SOAK-20",
    files: "100000",
    iterations: "20",
    output: "benchmark-results/wide-100k-soak-20.json",
    controlled: true,
  },
};

const requested = process.argv[2];
const profile = profiles[requested];
if (!profile) {
  throw new Error(
    "usage: node tools/performance-profile.mjs 1m|5m|soak [OUTPUT]",
  );
}
if (requested === "5m" && process.env.LOCAL_EXPERT_DISK_CONTROLLED !== "1") {
  throw new Error(
    "5M requires a controlled host and LOCAL_EXPERT_DISK_CONTROLLED=1",
  );
}

const runtime = mkdtempSync(join(tmpdir(), `local-expert-disk-${requested}-`));
const fixture = join(runtime, "fixture");
const output = resolve(process.argv[3] ?? profile.output);
const args = [
  "run",
  "--release",
  "-p",
  "scanner-benchmark",
  "--",
  fixture,
  "--output",
  output,
  "--profile",
  profile.name,
  "--generate-files",
  profile.files,
  "--generate-directories",
  "0",
  "--generate-depth",
  "0",
  "--file-size",
  "0",
  "--iterations",
  profile.iterations,
  "--thresholds",
  resolve("benchmark-results/thresholds.json"),
];
if (profile.controlled) args.push("--controlled");

try {
  const result = spawnSync("cargo", args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(runtime, { recursive: true, force: true });
}
