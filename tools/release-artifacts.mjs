import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? [path, ...walk(path)] : [path];
  });
}

function checksum(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeChecksums(directory, name = "SHA256SUMS") {
  const files = walk(directory)
    .filter((path) => statSync(path).isFile())
    .filter((path) => !basename(path).startsWith("SHA256SUMS"))
    .sort((left, right) => basename(left).localeCompare(basename(right)));
  if (!files.length)
    throw new Error(`no release artifacts found in ${directory}`);
  writeFileSync(
    join(directory, name),
    `${files.map((path) => `${checksum(path)}  ${basename(path)}`).join("\n")}\n`,
  );
}

function verifyChecksums(directory) {
  const manifests = walk(directory).filter(
    (path) =>
      statSync(path).isFile() && basename(path).startsWith("SHA256SUMS"),
  );
  if (!manifests.length) throw new Error("checksum manifest was not found");
  for (const manifest of manifests) {
    for (const line of readFileSync(manifest, "utf8").trim().split("\n")) {
      const match = line.match(/^([a-f0-9]{64}) {2}(.+)$/);
      if (!match || basename(match[2]) !== match[2])
        throw new Error(`invalid checksum entry in ${manifest}`);
      const artifact = join(directory, match[2]);
      if (checksum(artifact) !== match[1])
        throw new Error(`checksum mismatch for ${match[2]}`);
    }
  }
}

function stage(platform, source, output) {
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  const paths = walk(source);
  let files;
  if (platform === "windows") {
    files = paths.filter(
      (path) =>
        path.toLowerCase().endsWith(".exe") &&
        path.includes(`${join("", "nsis")}`),
    );
  } else if (platform === "linux") {
    files = paths.filter(
      (path) => path.endsWith(".AppImage") || path.endsWith(".deb"),
    );
  } else if (platform === "macos") {
    files = paths.filter(
      (path) => path.endsWith(".dmg") && !basename(path).startsWith("rw."),
    );
    const application = paths.find(
      (path) => path.endsWith(".app") && statSync(path).isDirectory(),
    );
    if (!application) throw new Error("macOS application bundle was not found");
    const archive = join(output, `${basename(application)}.zip`);
    const result = spawnSync(
      "ditto",
      ["-c", "-k", "--sequesterRsrc", "--keepParent", application, archive],
      { stdio: "inherit" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error("failed to archive macOS application bundle");
  } else {
    throw new Error("expected platform: macos, windows or linux");
  }
  const required = platform === "linux" ? 2 : 1;
  if (files.length < required)
    throw new Error(`incomplete ${platform} release bundle in ${source}`);
  for (const path of files) copyFileSync(path, join(output, basename(path)));
  writeChecksums(output, `SHA256SUMS.${platform}`);
}

const [command, first, second, third] = process.argv.slice(2);
if (command === "stage") stage(first, resolve(second), resolve(third));
else if (command === "checksums") writeChecksums(resolve(first));
else if (command === "verify") verifyChecksums(resolve(first));
else
  throw new Error(
    "expected stage <platform> <source> <output>, checksums <directory> or verify <directory>",
  );
