import type { Platform } from "./api/generated";

export function revealActionLabel(platform: Platform | null = null): string {
  switch (platform) {
    case "macos":
      return "Показать в Finder";
    case "windows":
      return "Показать в Проводнике";
    case "linux":
    case "unsupported":
    case null:
      return "Показать в файловом менеджере";
  }
}
