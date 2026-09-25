import { resolve } from "node:path";

const executable = process.platform === "win32" ? "desktop.exe" : "desktop";
const application = resolve("target", "debug", executable);
if (!process.env.LOCAL_EXPERT_DISK_E2E_ROOT)
  throw new Error("E2E fixture environment is not configured");

export const config = {
  runner: "local",
  logLevel: "error",
  specs: [resolve("tests", "e2e", "specs", "**", "*.e2e.js")],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": { application },
    },
  ],
  services: [
    [
      "@wdio/tauri-service",
      {
        appBinaryPath: application,
        driverProvider: "embedded",
        logLevel: "error",
        captureBackendLogs: false,
        captureFrontendLogs: false,
      },
    ],
  ],
  framework: "mocha",
  reporters: ["spec"],
  waitforTimeout: 20_000,
  connectionRetryTimeout: 120_000,
  mochaOpts: {
    ui: "bdd",
    timeout: 120_000,
  },
};
