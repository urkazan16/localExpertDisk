import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const runtime = mkdtempSync(join(tmpdir(), "local-expert-disk-e2e-"));
const root = join(runtime, "fixture");
const state = join(runtime, "state");
const trash = join(runtime, "trash");

function write(relativePath, contents) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function run(command, args, environment = process.env) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function runNpm(args, environment = process.env) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error("npm_execpath is unavailable; run E2E through npm");
  }
  return run(process.execPath, [npmCli, ...args], environment);
}

try {
  write("alpha/deep/map-file.bin", Buffer.alloc(256, 1));
  write("alpha/explorer-file.txt", "explorer");
  write("beta/secondary.bin", Buffer.alloc(64, 2));
  for (const name of ["copy-a.bin", "copy-b.bin", "copy-c.bin"])
    write(name, "confirmed duplicate content");

  const buildStatus = runNpm(["run", "desktop:e2e:build"], {
    ...process.env,
    VITE_E2E: "1",
  });
  if (buildStatus !== 0) process.exitCode = buildStatus;
  else {
    const environment = {
      ...process.env,
      LOCAL_EXPERT_DISK_E2E_ROOT: root,
      LOCAL_EXPERT_DISK_E2E_DB: join(state, "index.db"),
      LOCAL_EXPERT_DISK_E2E_TRASH: trash,
      LOCAL_EXPERT_DISK_PERFORMANCE_THRESHOLDS: resolve(
        "benchmark-results/thresholds.json",
      ),
      LOCAL_EXPERT_DISK_E2E_EVIDENCE_DIR:
        process.env.LOCAL_EXPERT_DISK_E2E_EVIDENCE_DIR,
    };
    for (const phase of ["scan", "restart"]) {
      const status = runNpm(
        ["exec", "--", "wdio", "run", "tests/e2e/wdio.conf.mjs"],
        { ...environment, LOCAL_EXPERT_DISK_E2E_PHASE: phase },
      );
      if (status !== 0) {
        process.exitCode = status;
        break;
      }
    }
  }
} finally {
  rmSync(runtime, { recursive: true, force: true });
}
