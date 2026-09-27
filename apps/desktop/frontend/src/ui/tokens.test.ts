import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function css(path: string) {
  return readFileSync(resolve(process.cwd(), "src", path), "utf8");
}

function source(path: string) {
  return readFileSync(resolve(process.cwd(), "src", path), "utf8");
}

const appCss = css("styles.css");
const previewCss = css("ui/preview.css");
const tokenCss = css("ui/tokens.css");
const uiCss = css("ui/ui.css");

type Rgb = [number, number, number];

function token(name: string) {
  const match = tokenCss.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`Missing design token: ${name}`);
  return match[1].trim();
}

function hex(value: string): Rgb {
  const match = value.match(/^#([0-9a-f]{6})$/i);
  if (!match)
    throw new Error(`Expected an opaque hex color, received ${value}`);
  return [0, 2, 4].map((offset) =>
    Number.parseInt(match[1].slice(offset, offset + 2), 16),
  ) as Rgb;
}

function composite(foreground: Rgb, background: Rgb, alpha: number): Rgb {
  return foreground.map((channel, index) =>
    Math.round(channel * alpha + background[index] * (1 - alpha)),
  ) as Rgb;
}

function relativeLuminance(color: Rgb) {
  const channels = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground: Rgb, background: Rgb) {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

describe("semantic design tokens", () => {
  it("keeps ordinary text combinations at WCAG AA contrast", () => {
    const dangerSurface = composite(
      [255, 90, 95],
      hex(token("color-background-surface")),
      0.14,
    );
    const combinations: Array<[string, Rgb, Rgb]> = [
      [
        "primary/base",
        hex(token("color-text-primary")),
        hex(token("color-background-base")),
      ],
      [
        "primary/surface",
        hex(token("color-text-primary")),
        hex(token("color-background-surface")),
      ],
      [
        "primary/elevated",
        hex(token("color-text-primary")),
        hex(token("color-background-elevated")),
      ],
      [
        "primary/accent",
        hex(token("color-text-primary")),
        hex(token("color-accent-primary")),
      ],
      [
        "secondary/base",
        hex(token("color-text-secondary")),
        hex(token("color-background-base")),
      ],
      [
        "muted/surface",
        hex(token("color-text-muted")),
        hex(token("color-background-surface")),
      ],
      [
        "danger/danger-surface",
        hex(token("color-status-danger")),
        dangerSurface,
      ],
    ];

    for (const [name, foreground, background] of combinations) {
      expect(contrast(foreground, background), name).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it("keeps raw colors inside the token source", () => {
    const rawColor = /#[0-9a-f]{3,8}\b|\brgb\(/i;
    expect(appCss).not.toMatch(rawColor);
    expect(previewCss).not.toMatch(rawColor);
    expect(uiCss).not.toMatch(rawColor);
  });

  it("defines interaction states and desktop hit areas for primary controls", () => {
    expect(uiCss).toMatch(/\.ui-button--primary:hover:not\(:disabled\)/);
    expect(uiCss).toMatch(/\.ui-button--primary:active:not\(:disabled\)/);
    expect(uiCss).toMatch(/\.ui-button:focus-visible/);
    expect(uiCss).toMatch(/\.ui-button:disabled/);
    expect(uiCss).toMatch(/\.ui-segmented__item\[aria-pressed="true"\]/);
    expect(uiCss).toMatch(/\.ui-select__trigger\s*{/);
    expect(uiCss).toMatch(/\.ui-select__listbox\s*{/);
    expect(uiCss).toMatch(/\.ui-select__option\[aria-selected="true"\]/);
    expect(uiCss).toMatch(/\.ui-checkbox\s*{[^}]*appearance:\s*none/s);
    expect(uiCss).toMatch(
      /\.ui-search:has\(\.ui-search__input:focus-visible\)/,
    );
    expect(uiCss).toMatch(/\.ui-input:disabled/);

    const smallHeight = Number.parseFloat(token("control-height-compact"));
    const mediumHeight = Number.parseFloat(token("control-height-default"));
    const segmentedHeight = Number.parseFloat(
      token("control-height-segmented"),
    );
    const searchHeight = Number.parseFloat(token("control-height-search"));
    expect(smallHeight).toBe(2);
    expect(mediumHeight).toBeGreaterThanOrEqual(2.25);
    expect(mediumHeight).toBeLessThanOrEqual(2.5);
    expect(segmentedHeight).toBe(2.25);
    expect(searchHeight).toBeGreaterThanOrEqual(2.625);
    expect(searchHeight).toBeLessThanOrEqual(2.875);
    expect(token("font-size-control")).toBe("0.875rem");
    expect(token("checkbox-size")).toBe("1.125rem");
    expect(token("scrollbar-size")).toBe("0.625rem");
    expect(token("row-height-column")).toBe("3.125rem");
    expect(token("column-width")).toBe("16rem");
    expect(token("control-background")).toBe("var(--color-background-subtle)");
    expect(token("control-border-focus")).toBe("var(--color-border-focus)");
  });

  it("routes screen form controls through the shared primitives", () => {
    const screens = [
      "AnalyzerPanel.tsx",
      "HistoryDuplicatesPanel.tsx",
      "OldFilesPanel.tsx",
      "ScanPanel.tsx",
      "components/ColumnBrowser.tsx",
    ];

    for (const path of screens) {
      const content = source(path);
      expect(content, `${path} contains a raw select`).not.toMatch(/<select\b/);
      expect(content, `${path} contains a raw checkbox`).not.toMatch(
        /type="checkbox"/,
      );
      expect(content, `${path} contains a legacy secondary button`).not.toMatch(
        /<button\b[^>]*className="[^"]*secondary/,
      );
      expect(content, `${path} contains a raw input`).not.toMatch(/<input\b/);
    }
  });

  it("renders volumes as rich rows with stable numeric metadata", () => {
    const sidebar = source("shell/Sidebar.tsx");
    expect(sidebar).toMatch(/className="sidebar-item sidebar-volume"/);
    expect(sidebar).toMatch(/formatBytes\(volume\.available_bytes\)/);
    expect(sidebar).toMatch(/formatBytes\(volume\.total_bytes\)/);
    expect(sidebar).toMatch(/volumeNameCounts/);
    expect(sidebar).toMatch(/className="sidebar-volume__mount"/);
    expect(appCss).toMatch(/\.sidebar-volume\s*{[^}]*min-height:\s*4rem/s);
    expect(appCss).toMatch(
      /\.sidebar-volume__stats\s*{[^}]*font-variant-numeric:\s*tabular-nums/s,
    );
  });

  it("preserves desktop navigation and overflow behavior at the minimum window", () => {
    expect(appCss).toMatch(/@media \(max-width: 62rem\)/);
    expect(appCss).toMatch(/\.column-browser\s*{[^}]*overflow-x:\s*auto/s);
    expect(appCss).toMatch(
      /\.app-bottom-bar span\s*{[^}]*text-overflow:\s*ellipsis/s,
    );
    expect(appCss).not.toMatch(/\.app-sidebar\s*{[^}]*display:\s*none/s);
    expect(tokenCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(appCss).toMatch(/overflow-wrap:\s*anywhere/);
  });
});
