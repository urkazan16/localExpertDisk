/* global clearTimeout, document, HTMLElement, MouseEvent, MutationObserver, requestAnimationFrame, setTimeout, window */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { arch, platform } from "node:os";
import { dirname, join } from "node:path";
import { browser, $, $$, expect } from "@wdio/globals";

const root = process.env.LOCAL_EXPERT_DISK_E2E_ROOT;
const database = process.env.LOCAL_EXPERT_DISK_E2E_DB;
const trash = process.env.LOCAL_EXPERT_DISK_E2E_TRASH;
const phase = process.env.LOCAL_EXPERT_DISK_E2E_PHASE;
const thresholdsPath = process.env.LOCAL_EXPERT_DISK_PERFORMANCE_THRESHOLDS;
const evidenceDirectory = process.env.LOCAL_EXPERT_DISK_E2E_EVIDENCE_DIR;
const performanceReport = process.env.LOCAL_EXPERT_DISK_UI_PERFORMANCE_REPORT;

if (!root || !database || !trash || !phase || !thresholdsPath)
  throw new Error("E2E fixture environment is not configured");
const thresholds = JSON.parse(readFileSync(thresholdsPath, "utf8"));

function newPerformanceReport() {
  return {
    generated_at: new Date().toISOString(),
    platform: platform(),
    architecture: arch(),
    build_mode: "debug-e2e",
    fixture: "tests/e2e/run.mjs synthetic fixture",
    metrics: {},
  };
}

function initializePerformanceReport() {
  if (!performanceReport) return;
  mkdirSync(dirname(performanceReport), { recursive: true });
  writeFileSync(
    performanceReport,
    `${JSON.stringify(newPerformanceReport(), null, 2)}\n`,
  );
}

function recordPerformance(name, value, limit, unit = "ms") {
  if (!performanceReport) return;
  let report = newPerformanceReport();
  try {
    report = JSON.parse(readFileSync(performanceReport, "utf8"));
  } catch {
    mkdirSync(dirname(performanceReport), { recursive: true });
  }
  report.generated_at = new Date().toISOString();
  const measured = Math.round(value * 100) / 100;
  report.metrics[name] = {
    value: measured,
    limit,
    unit,
    passed: measured <= limit,
  };
  writeFileSync(performanceReport, `${JSON.stringify(report, null, 2)}\n`);
}

function recordMinimumPerformance(name, value, minimum, unit) {
  if (!performanceReport) return;
  let report;
  try {
    report = JSON.parse(readFileSync(performanceReport, "utf8"));
  } catch {
    mkdirSync(dirname(performanceReport), { recursive: true });
    report = newPerformanceReport();
  }
  report.generated_at = new Date().toISOString();
  const measured = Math.round(value * 100) / 100;
  report.metrics[name] = {
    value: measured,
    minimum,
    unit,
    passed: measured >= minimum,
  };
  writeFileSync(performanceReport, `${JSON.stringify(report, null, 2)}\n`);
}

async function waitForButton(name) {
  const element = await $(`button=${name}`);
  await element.waitForClickable();
  return element;
}

async function saveEvidence(name, focusSelector = null) {
  if (!evidenceDirectory) return;
  mkdirSync(evidenceDirectory, { recursive: true });
  await browser.execute((selector) => {
    document.scrollingElement?.scrollTo(0, 0);
    document.querySelector(".app-sidebar")?.scrollTo(0, 0);
    const workspace = document.querySelector(".app-workspace");
    workspace?.scrollTo(0, 0);
    if (selector) {
      document.querySelector(selector)?.scrollIntoView({
        block: "start",
        inline: "nearest",
      });
      document.scrollingElement?.scrollTo({
        left: 0,
        top: 0,
      });
      window.scrollTo({ left: 0, top: 0 });
      workspace?.scrollTo({ left: 0, top: workspace.scrollTop });
    }
  }, focusSelector);
  await browser.saveScreenshot(join(evidenceDirectory, name));
}

async function measureDomReaction(action, selector) {
  return browser.executeAsync(
    (actionName, resultSelector, done) => {
      const started = performance.now();
      let finished = false;
      const timeout = setTimeout(() => finish(-2), 10_000);
      const finish = (value = performance.now() - started) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        done(value);
      };
      const observer = new MutationObserver(() => {
        if (document.querySelector(resultSelector)) {
          observer.disconnect();
          requestAnimationFrame(() => finish());
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      const target = document.querySelector(actionName);
      if (!(target instanceof HTMLElement)) {
        observer.disconnect();
        finish(-1);
        return;
      }
      target.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    },
    action,
    selector,
  );
}

async function measureWebdriverClickReaction(action, selector, expectedText) {
  const key = `${Date.now()}-${Math.random()}`;
  await browser.execute(
    (metricKey, resultSelector, text) => {
      window.__localExpertPerformance ??= {};
      const started = performance.now();
      let finished = false;
      const observer = new MutationObserver(check);
      const timeout = setTimeout(() => finish(-2), 10_000);
      function finish(value = performance.now() - started) {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        observer.disconnect();
        window.__localExpertPerformance[metricKey] = value;
      }
      function check() {
        const result = document.querySelector(resultSelector);
        if (finished || !result?.textContent?.includes(text)) return;
        requestAnimationFrame(() => finish());
      }
      window.__localExpertPerformance[metricKey] = null;
      observer.observe(document.body, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      });
      check();
    },
    key,
    selector,
    expectedText,
  );
  await action.click();
  await browser.waitUntil(
    async () =>
      typeof (await browser.execute(
        (metricKey) => window.__localExpertPerformance?.[metricKey],
        key,
      )) === "number",
    { timeout: 11_000, timeoutMsg: `No DOM reaction for ${selector}` },
  );
  return browser.execute(
    (metricKey) => window.__localExpertPerformance[metricKey],
    key,
  );
}

async function measureFormSubmitReaction(formSelector, selector, expectedText) {
  return browser.executeAsync(
    (targetSelector, resultSelector, text, done) => {
      const form = document.querySelector(targetSelector);
      if (!form || typeof form.requestSubmit !== "function") {
        done(-1);
        return;
      }
      const started = performance.now();
      let finished = false;
      const observer = new MutationObserver(check);
      const timeout = setTimeout(() => finish(-2), 10_000);
      function finish(value = performance.now() - started) {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        observer.disconnect();
        done(value);
      }
      function check() {
        const result = document.querySelector(resultSelector);
        if (finished || !result?.textContent?.includes(text)) return;
        requestAnimationFrame(() => finish());
      }
      observer.observe(document.body, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      });
      form.requestSubmit();
      check();
    },
    formSelector,
    selector,
    expectedText,
  );
}

async function measureFocusFeedback(selector) {
  return browser.executeAsync((targetSelector, done) => {
    const target = document.querySelector(targetSelector);
    if (!target || typeof target.focus !== "function") {
      done(-1);
      return;
    }
    const started = performance.now();
    target.focus();
    requestAnimationFrame(() =>
      done(
        document.activeElement === target ? performance.now() - started : -1,
      ),
    );
  }, selector);
}

async function measureInteractionFps(durationMs) {
  return browser.executeAsync((duration, done) => {
    const scroller = document.querySelector(".column-browser");
    const segment = document.querySelector(".sunburst-segment");
    const started = performance.now();
    let frames = 0;
    let active = true;
    function frame() {
      if (!active) return;
      frames += 1;
      if (scroller instanceof HTMLElement)
        scroller.scrollLeft = frames % 2 ? scroller.scrollWidth : 0;
      if (segment instanceof HTMLElement)
        segment.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    setTimeout(() => {
      active = false;
      const elapsed = performance.now() - started;
      done(elapsed > 0 ? (frames * 1000) / elapsed : 0);
    }, duration);
  }, durationMs);
}

async function runScan(expectedState, measureStartFeedback = false) {
  const previous = await $(".analyzer");
  const previousId = (await previous.isExisting())
    ? await previous.getAttribute("data-analyzer-scan-id")
    : null;
  const input = await $("#manual-target-path");
  if (!(await input.isDisplayed())) {
    await (await $("summary=Указать путь вручную")).click();
  }
  await input.waitForEnabled();
  await input.setValue(root);
  await (await waitForButton("Использовать путь")).click();
  await saveEvidence("01-selected-target.png");
  const volumeRows = await $$(".sidebar-volume");
  if (volumeRows.length) {
    expect(await volumeRows[0].getSize("height")).toBeGreaterThanOrEqual(64);
    await expect(volumeRows[0].$(".sidebar-volume__stats")).toHaveText(
      expect.stringMatching(/[КМГТПЭ]иБ/),
    );
    await saveEvidence("08-volumes-sidebar.png", ".app-sidebar");
  }
  const startButton = await waitForButton("Начать сканирование");
  if (measureStartFeedback) {
    const scanStartFeedbackMs = await measureWebdriverClickReaction(
      startButton,
      ".start-screen__action",
      "Запуск…",
    );
    expect(scanStartFeedbackMs).toBeGreaterThanOrEqual(0);
    expect(scanStartFeedbackMs).toBeLessThanOrEqual(
      thresholds.max_scan_start_feedback_ms,
    );
    recordPerformance(
      "scan_start_feedback_ms",
      scanStartFeedbackMs,
      thresholds.max_scan_start_feedback_ms,
    );
  } else {
    await startButton.click();
  }
  await browser.waitUntil(
    async () => {
      const analyzer = await $(".analyzer");
      return (
        (await analyzer.isExisting()) &&
        (await analyzer.getAttribute("data-analyzer-scan-id")) !== previousId
      );
    },
    { timeout: 30_000, timeoutMsg: "scan session id did not change" },
  );
  if (expectedState.includes("не полностью")) {
    const partialNotice = await $(".scan-partial-notice");
    await partialNotice.waitForDisplayed({ timeout: 30_000 });
    await expect(partialNotice).toHaveText(
      expect.stringContaining("Часть объектов недоступна"),
    );
  } else {
    await expect($(".analyzer")).toBeDisplayed();
  }
}

async function explorerRow(name) {
  const explorer = await $('[aria-label^="Содержимое каталога "]');
  await explorer.waitForDisplayed();
  return explorer.$(`[role="option"][aria-label^="${name},"]`);
}

async function historyRows() {
  await browser.waitUntil(async () => (await $$(".history-row")).length >= 3, {
    timeout: 20_000,
    timeoutMsg: "scan history did not restore three scans",
  });
  return $$(".history-row");
}

describe(`desktop analyzer workflow: ${phase}`, () => {
  if (phase === "scan") {
    it("runs synthetic scans and keeps map navigation synchronized", async () => {
      initializePerformanceReport();
      await expect($("body")).toHaveText(
        expect.stringContaining("Local Expert Disk"),
      );
      await runScan("Сканирование завершено", true);
      await saveEvidence("02-structure-result.png", ".structure-workspace");

      const folderSort = await $(
        '[role="combobox"][aria-label="Сортировка содержимого каталога"]',
      );
      const folderSortListboxSelector =
        '[role="listbox"][aria-label="Сортировка содержимого каталога"]';
      await folderSort.click();
      await $(folderSortListboxSelector).waitForDisplayed();
      await saveEvidence("07-custom-select-popup.png", ".structure-workspace");
      await browser.execute((selector) => {
        document.querySelector(selector)?.focus();
      }, folderSortListboxSelector);
      await browser.keys(["ArrowDown", "Enter"]);
      await expect(folderSort).toHaveText(expect.stringContaining("Имя: А–Я"));
      await folderSort.click();
      await $(folderSortListboxSelector).waitForDisplayed();
      await browser.execute((selector) => {
        document.querySelector(selector)?.focus();
      }, folderSortListboxSelector);
      await browser.keys(["ArrowUp", "Enter"]);
      await expect(folderSort).toHaveText(
        expect.stringContaining("Размер: больше сначала"),
      );

      await (await waitForButton("Крупные файлы")).click();
      await (await waitForButton("Обновить выборку")).click();
      await saveEvidence("05-large-files-controls.png", ".analyzer");
      await (await waitForButton("Категории")).click();
      await expect($("body")).toHaveText(
        expect.stringContaining("Обзор диска"),
      );
      await (await waitForButton("Поиск")).click();
      await $("#entry-search").setValue("alpha");
      await waitForButton("Найти");
      const searchFirstPageMs = await measureFormSubmitReaction(
        ".analyzer-header-search",
        "body",
        "alpha",
      );
      expect(searchFirstPageMs).toBeGreaterThanOrEqual(0);
      expect(searchFirstPageMs).toBeLessThanOrEqual(
        thresholds.max_search_first_page_ms,
      );
      recordPerformance(
        "search_first_page_ms",
        searchFirstPageMs,
        thresholds.max_search_first_page_ms,
      );
      await saveEvidence("06-search-controls.png", ".analyzer");
      await (await waitForButton("Структура")).click();

      const interactionFps = await measureInteractionFps(
        thresholds.interaction_profile_duration_ms,
      );
      expect(interactionFps).toBeGreaterThanOrEqual(
        thresholds.min_interaction_fps,
      );
      recordMinimumPerformance(
        "interaction_fps",
        interactionFps,
        thresholds.min_interaction_fps,
        "fps",
      );

      const cachedDirectoryMs = await measureDomReaction(
        '[role="option"][aria-label^="alpha,"]',
        '[aria-label="Колонка каталога alpha"]',
      );
      expect(cachedDirectoryMs).toBeGreaterThanOrEqual(0);
      expect(cachedDirectoryMs).toBeLessThanOrEqual(
        thresholds.max_cached_directory_ms,
      );
      recordPerformance(
        "cached_directory_ms",
        cachedDirectoryMs,
        thresholds.max_cached_directory_ms,
      );
      await (await waitForButton("Назад")).click();
      let alpha = await explorerRow("alpha");
      const selectionFeedbackMs = await measureWebdriverClickReaction(
        await alpha.$('input[type="checkbox"]'),
        ".selection-action-bar",
        "Выбрано: 1",
      );
      expect(selectionFeedbackMs).toBeGreaterThanOrEqual(0);
      expect(selectionFeedbackMs).toBeLessThanOrEqual(
        thresholds.max_selection_feedback_ms,
      );
      recordPerformance(
        "selection_feedback_ms",
        selectionFeedbackMs,
        thresholds.max_selection_feedback_ms,
      );
      await expect($(".selection-action-bar")).toHaveText(
        expect.stringContaining("Выбрано: 1"),
      );
      await (await waitForButton("В корзину")).click();
      await expect($("[role='dialog']")).toHaveText(
        expect.stringContaining("alpha"),
      );
      await saveEvidence("04-selection-review.png", ".structure-workspace");
      await (await waitForButton("Отмена")).click();
      alpha = await explorerRow("alpha");
      await alpha.doubleClick();
      const deepMap = await $('[aria-label="Выбрать deep в Sunburst"]');
      await deepMap.waitForDisplayed();
      const focusFeedbackMs = await measureFocusFeedback(
        '[aria-label="Выбрать deep в Sunburst"]',
      );
      expect(focusFeedbackMs).toBeGreaterThanOrEqual(0);
      expect(focusFeedbackMs).toBeLessThanOrEqual(
        thresholds.max_focus_feedback_ms,
      );
      recordPerformance(
        "focus_feedback_ms",
        focusFeedbackMs,
        thresholds.max_focus_feedback_ms,
      );
      await browser.keys(["Enter"]);
      await saveEvidence("03-nested-directory.png", ".structure-workspace");
      const breadcrumbs = await $('nav[aria-label="Путь к каталогу"]');
      await (await breadcrumbs.$("button=alpha")).click();
      await (await waitForButton("Назад")).click();
      await (await waitForButton("Вперёд")).click();
      await expect($(".analyzer .scan-path")).toHaveText(
        expect.stringContaining("alpha"),
      );

      writeFileSync(join(root, "added-after-first.txt"), "new scan content");
      await runScan("Сканирование завершено");

      const denied = join(root, "partial-denied");
      mkdirSync(denied);
      writeFileSync(join(denied, "unreadable.bin"), "managed fault");
      await runScan("Сканирование завершено не полностью");
    });
  }

  if (phase === "restart") {
    it("restores SQLite history and completes comparison and duplicate trash", async () => {
      await expect($("body")).toHaveText(
        expect.stringContaining("Готово к работе"),
      );
      await expect($("body")).toHaveText(
        expect.stringContaining("Часть объектов недоступна"),
      );
      expect(
        readdirSync(join(database, "..")).some((name) => name === "index.db"),
      ).toBe(true);

      await (await waitForButton("История")).click();
      let rows = await historyRows();
      const oldest = rows.at(-1);
      const oldestScanId = await oldest.getAttribute("data-scan-id");
      const firstDisplayStarted = performance.now();
      await oldest.$("button=Открыть анализ").click();
      const oldestAnalyzer = await $(
        `.analyzer[data-analyzer-scan-id="${oldestScanId}"]`,
      );
      await oldestAnalyzer
        .$('[aria-label^="Sunburst каталога"]')
        .waitForDisplayed();
      const firstDisplayMs = performance.now() - firstDisplayStarted;
      expect(firstDisplayMs).toBeLessThanOrEqual(
        thresholds.max_first_display_ms,
      );
      recordPerformance(
        "first_display_ms",
        firstDisplayMs,
        thresholds.max_first_display_ms,
      );
      await (await waitForButton("История")).click();
      rows = await historyRows();
      const partial = rows[0];
      await partial.$("button=Открыть анализ").click();
      await expect($(".scan-partial-notice")).toHaveText(
        expect.stringContaining("Часть объектов недоступна"),
      );

      await (await waitForButton("История")).click();
      rows = await historyRows();
      await rows.at(-1).$('input[type="checkbox"]').click();
      await rows.at(-2).$('input[type="checkbox"]').click();
      await (await waitForButton("Сравнить выбранные")).click();
      await expect($(".comparison-details")).toHaveText(
        expect.stringContaining("Добавлено: 1"),
      );

      await (await waitForButton("Дубликаты")).click();
      await (await waitForButton("Проверить содержимое")).click();
      const group = await $(".duplicate-group-toggle");
      await group.waitForClickable({ timeout: 30_000 });
      await group.click();
      const duplicateFiles = await $(".duplicate-files");
      const copyA = await duplicateFiles.$(
        './/label[contains(., "copy-a.bin")]',
      );
      const copyB = await duplicateFiles.$(
        './/label[contains(., "copy-b.bin")]',
      );
      await copyA.$('input[type="checkbox"]').click();
      await copyB.$('input[type="checkbox"]').click();
      await (
        await waitForButton("Переместить выбранные в корзину (2)")
      ).click();
      await (await waitForButton("Подтвердить перемещение")).click();
      await expect($("[role='status']")).toHaveText(
        expect.stringContaining("Перемещено в корзину: 2"),
      );
      const trashedFiles = readdirSync(trash);
      expect(trashedFiles.some((name) => name.endsWith("copy-a.bin"))).toBe(
        true,
      );
      expect(trashedFiles.some((name) => name.endsWith("copy-b.bin"))).toBe(
        true,
      );
    });
  }
});
