import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { browser, $, $$, expect } from "@wdio/globals";

const root = process.env.LOCAL_EXPERT_DISK_E2E_ROOT;
const database = process.env.LOCAL_EXPERT_DISK_E2E_DB;
const trash = process.env.LOCAL_EXPERT_DISK_E2E_TRASH;
const phase = process.env.LOCAL_EXPERT_DISK_E2E_PHASE;

if (!root || !database || !trash || !phase)
  throw new Error("E2E fixture environment is not configured");

async function waitForButton(name) {
  const element = await $(`button=${name}`);
  await element.waitForClickable();
  return element;
}

async function runScan(expectedState) {
  const previous = await $(".scan-result");
  const previousId = (await previous.isExisting())
    ? await previous.getAttribute("data-scan-id")
    : null;
  const input = await $("#scan-root");
  await input.waitForEnabled();
  await input.setValue(root);
  await (await waitForButton("Сканировать")).click();
  await browser.waitUntil(
    async () =>
      (await $(".scan-result").getAttribute("data-scan-id")) !== previousId,
    { timeoutMsg: "scan session id did not change" },
  );
  const heading = await $(`h3=${expectedState}`);
  await heading.waitForDisplayed({ timeout: 30_000 });
}

async function explorerRow(name) {
  const explorer = await $('[aria-label="Содержимое каталога"]');
  await explorer.waitForDisplayed();
  return explorer.$(
    `.//*[self::li or @role="listitem"][.//strong[normalize-space()="${name}"]]`,
  );
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

      const alpha = await explorerRow("alpha");
      await alpha.$("button=Открыть").click();
      const deepMap = await $('[aria-label="Открыть каталог deep на карте"]');
      await deepMap.waitForClickable();
      await deepMap.click();
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
        expect.stringContaining("Приложение подключено"),
      );
      await expect($("body")).toHaveText(
        expect.stringContaining("Сканирование завершено не полностью"),
      );
      expect(
        readdirSync(join(database, "..")).some((name) => name === "index.db"),
      ).toBe(true);

      let rows = await historyRows();
      const oldest = rows.at(-1);
      await oldest.$("button=Открыть анализ").click();
      await expect(oldest).toHaveText(expect.stringContaining("Активный"));

      rows = await historyRows();
      const partial = rows[0];
      await partial.$("button=Открыть анализ").click();
      await expect($(".warning")).toHaveText(
        expect.stringContaining("Часть объектов недоступна"),
      );

      rows = await historyRows();
      await rows.at(-1).$('input[type="checkbox"]').click();
      await rows.at(-2).$('input[type="checkbox"]').click();
      await (await waitForButton("Сравнить выбранные")).click();
      await expect($(".comparison-details")).toHaveText(
        expect.stringContaining("Добавлено: 1"),
      );

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
