/* global document, HTMLElement, MouseEvent, MutationObserver, requestAnimationFrame */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { browser, $, $$, expect } from "@wdio/globals";

const root = process.env.LOCAL_EXPERT_DISK_E2E_ROOT;
const database = process.env.LOCAL_EXPERT_DISK_E2E_DB;
const trash = process.env.LOCAL_EXPERT_DISK_E2E_TRASH;
const phase = process.env.LOCAL_EXPERT_DISK_E2E_PHASE;
const thresholdsPath = process.env.LOCAL_EXPERT_DISK_PERFORMANCE_THRESHOLDS;
const evidenceDirectory = process.env.LOCAL_EXPERT_DISK_E2E_EVIDENCE_DIR;

if (!root || !database || !trash || !phase || !thresholdsPath)
  throw new Error("E2E fixture environment is not configured");
const thresholds = JSON.parse(readFileSync(thresholdsPath, "utf8"));

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
    if (selector)
      document.querySelector(selector)?.scrollIntoView({ block: "start" });
  }, focusSelector);
  await browser.saveScreenshot(join(evidenceDirectory, name));
}

async function measureDomReaction(action, selector) {
  return browser.executeAsync(
    (actionName, resultSelector, done) => {
      const started = performance.now();
      const finish = () => done(performance.now() - started);
      const observer = new MutationObserver(() => {
        if (document.querySelector(resultSelector)) {
          observer.disconnect();
          requestAnimationFrame(finish);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      const target = document.querySelector(actionName);
      if (!(target instanceof HTMLElement)) {
        observer.disconnect();
        done(-1);
        return;
      }
      target.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    },
    action,
    selector,
  );
}

async function runScan(expectedState) {
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
  await (await waitForButton("Начать сканирование")).click();
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
      await expect($("body")).toHaveText(
        expect.stringContaining("Local Expert Disk"),
      );
      await runScan("Сканирование завершено");
      await saveEvidence("02-structure-result.png", ".structure-workspace");

      await (await waitForButton("Крупные файлы")).click();
      await (await waitForButton("Обновить выборку")).click();
      await (await waitForButton("Категории")).click();
      await expect($("body")).toHaveText(
        expect.stringContaining("Обзор диска"),
      );
      await (await waitForButton("Структура")).click();

      const cachedDirectoryMs = await measureDomReaction(
        '[role="option"][aria-label^="alpha,"]',
        '[aria-label="Колонка каталога alpha"]',
      );
      expect(cachedDirectoryMs).toBeGreaterThanOrEqual(0);
      expect(cachedDirectoryMs).toBeLessThanOrEqual(
        thresholds.max_cached_directory_ms,
      );
      await (await waitForButton("Назад")).click();
      const alpha = await explorerRow("alpha");
      await alpha.$('input[type="checkbox"]').click();
      await expect($(".selection-action-bar")).toHaveText(
        expect.stringContaining("Выбрано: 1"),
      );
      await (await waitForButton("В корзину")).click();
      await expect($("[role='dialog']")).toHaveText(
        expect.stringContaining("alpha"),
      );
      await saveEvidence("03-selection-review.png", ".structure-workspace");
      await (await waitForButton("Отмена")).click();
      await alpha.doubleClick();
      const deepMap = await $('[aria-label="Выбрать deep в Sunburst"]');
      await deepMap.waitForDisplayed();
      await browser.execute((element) => element.focus(), deepMap);
      await browser.keys(["Enter"]);
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
      expect(performance.now() - firstDisplayStarted).toBeLessThanOrEqual(
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
