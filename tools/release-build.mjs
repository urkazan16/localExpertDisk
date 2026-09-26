import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const platform = process.argv[2];
const bundles = {
  macos: "app,dmg",
  windows: "nsis",
  linux: "appimage,deb",
}[platform];
if (!bundles) throw new Error("expected platform: macos, windows or linux");

const requireSigning = process.env.RELEASE_REQUIRE_SIGNING === "1";
if (platform === "macos" && requireSigning) {
  for (const name of [
    "APPLE_CERTIFICATE",
    "APPLE_CERTIFICATE_PASSWORD",
    "APPLE_ID",
    "APPLE_PASSWORD",
    "APPLE_TEAM_ID",
  ]) {
    if (!process.env[name])
      throw new Error(`required release secret is missing: ${name}`);
  }
}

const temporary = mkdtempSync(join(tmpdir(), "local-expert-disk-release-"));
try {
  const args = ["run", "desktop:build", "--", "--bundles", bundles, "--ci"];
  if (platform === "windows" && process.env.WINDOWS_CERTIFICATE_THUMBPRINT) {
    const config = join(temporary, "windows-signing.json");
    writeFileSync(
      config,
      JSON.stringify({
        bundle: {
          windows: {
            certificateThumbprint: process.env.WINDOWS_CERTIFICATE_THUMBPRINT,
            digestAlgorithm: "sha256",
            timestampUrl: "http://timestamp.digicert.com",
          },
        },
      }),
    );
    args.push("--config", config);
  } else if (platform === "windows" && requireSigning) {
    throw new Error("required Windows signing certificate is missing");
  }
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const environment = { ...process.env };
  environment.CI ??= "true";
  if (platform === "macos" && !requireSigning) {
    for (const name of [
      "APPLE_CERTIFICATE",
      "APPLE_CERTIFICATE_PASSWORD",
      "APPLE_ID",
      "APPLE_PASSWORD",
      "APPLE_TEAM_ID",
    ])
      delete environment[name];
  }
  const result = spawnSync(npm, args, {
    stdio: "inherit",
    env: environment,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
