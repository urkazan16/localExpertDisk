import { describe, expect, it } from "vitest";
import { revealActionLabel } from "./platformLabels";

describe("platform labels", () => {
  it.each([
    ["macos", "Показать в Finder"],
    ["windows", "Показать в Проводнике"],
    ["linux", "Показать в файловом менеджере"],
    ["unsupported", "Показать в файловом менеджере"],
  ] as const)("uses the native reveal label on %s", (platform, label) => {
    expect(revealActionLabel(platform)).toBe(label);
  });
});
