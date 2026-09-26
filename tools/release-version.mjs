import { readFileSync } from "node:fs";

const rootPackage = JSON.parse(readFileSync("package.json", "utf8"));
const tauriConfig = JSON.parse(
  readFileSync("apps/desktop/src-tauri/tauri.conf.json", "utf8"),
);
const cargoWorkspace = readFileSync("Cargo.toml", "utf8");
const cargoVersion = cargoWorkspace.match(
  /\[workspace\.package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/,
)?.[1];

if (!cargoVersion) throw new Error("workspace package version is missing");
const versions = new Set([
  rootPackage.version,
  tauriConfig.version,
  cargoVersion,
]);
if (versions.size !== 1)
  throw new Error(
    `release versions differ: npm=${rootPackage.version}, tauri=${tauriConfig.version}, cargo=${cargoVersion}`,
  );

const tag = process.env.RELEASE_TAG;
if (tag && tag !== `v${cargoVersion}`)
  throw new Error(`release tag ${tag} does not match version v${cargoVersion}`);

process.stdout.write(`${cargoVersion}\n`);
