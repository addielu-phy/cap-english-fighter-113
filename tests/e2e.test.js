"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { chromium } = require("playwright-core");

const root = path.join(__dirname, "..");
const edgeCandidates = process.platform === "win32" ? [
  process.env.EDGE_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean) : [process.env.CHROME_PATH, "/usr/bin/chromium", "/usr/bin/google-chrome"].filter(Boolean);
const executablePath = edgeCandidates.find((candidate) => fs.existsSync(candidate));
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".webp": "image/webp", ".txt": "text/plain; charset=utf-8" };
let server;
let baseURL;
let browser;

function resolvePublicFile(requestPath) {
  try {
    const relative = decodeURIComponent(requestPath === "/" ? "/index.html" : requestPath);
    if (/^[\\/]{2}/.test(relative) || /^[\\/][A-Za-z]:/.test(relative)) return null;
    const filename = path.resolve(root, `.${relative}`);
    const boundary = path.relative(root, filename);
    if (boundary === ".." || boundary.startsWith(`..${path.sep}`) || path.isAbsolute(boundary)) return null;
    return filename;
  } catch {
    return null;
  }
}

function serve(request, response) {
  const url = new URL(request.url, "http://127.0.0.1");
  const filename = resolvePublicFile(url.pathname);
  if (!filename || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
    response.writeHead(404).end("not found");
    return;
  }
  response.setHeader("Content-Type", mime[path.extname(filename)] || "application/octet-stream");
  fs.createReadStream(filename).pipe(response);
}

function loadQuestions() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, "questions.js"), "utf8"), sandbox);
  return sandbox.window.ENGLISH_QUESTIONS;
}

test("測試伺服器路徑不可逃出專案根目錄", () => {
  const sibling = `${path.basename(root)}-private`;
  const blocked = [
    `/../${sibling}/secret.txt`,
    `/..%5c${sibling}%5csecret.txt`,
    "/%E0%A4%A",
    "/C:%5cWindows%5csecret.txt",
    "/%5c%5cserver%5cshare%5csecret.txt"
  ];
  for (const requestPath of blocked) {
    assert.equal(resolvePublicFile(requestPath), null, requestPath);
  }
});

test("題庫有43題、答案合法、解析完整且所有52張資產皆被引用或存在", () => {
  const questions = loadQuestions();
  assert.equal(questions.length, 43);
  assert.equal(new Set(questions.map((q) => q.id)).size, 43);
  assert.deepEqual(Array.from(questions, (q) => q.number), Array.from({ length: 43 }, (_, i) => i + 1));
  assert.equal(questions.map((q) => "ABCD"[q.answer]).join(""), "ACBBDDBDCDCAAACDCDACBDCCBADBBADAABABBCCABBD");
  for (const question of questions) {
    assert.ok(Number.isInteger(question.answer) && question.answer >= 0 && question.answer <= 3);
    assert.ok(question.explanation.length >= 35, `q${question.number} explanation`);
    assert.ok(question.trap.length >= 20, `q${question.number} trap`);
    for (const rel of [...question.contextImages, ...question.images]) {
      assert.ok(fs.existsSync(path.join(root, rel)), rel);
    }
  }
  assert.equal(fs.readdirSync(path.join(root, "assets", "questions")).filter((name) => name.endsWith(".webp")).length, 52);
});

test.before(async () => {
  assert.ok(executablePath, "Edge/Chromium is required for E2E tests");
  server = http.createServer(serve);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath, headless: true });
});

test.after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function deterministicPage(viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.addInitScript(() => { Math.random = () => 0.999999; });
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(`${message.text()} @ ${message.location().url || "inline"}`); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(baseURL, { waitUntil: "networkidle" });
  return { context, page, errors };
}

test("所有52張題圖與共用文章皆可由瀏覽器完整解碼", { timeout: 30000 }, async (t) => {
  if (!browser) return t.skip("找不到Edge/Chromium");
  const { context, page, errors } = await deterministicPage();
  const result = await page.evaluate(async () => {
    const sources = [...new Set(window.ENGLISH_QUESTIONS.flatMap((q) => [...q.contextImages, ...q.images]))];
    const rows = await Promise.all(sources.map((src) => new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve({ src, ok: image.naturalWidth > 600 && image.naturalHeight > 80, width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => resolve({ src, ok: false, width: 0, height: 0 });
      image.src = src;
    })));
    return { count: sources.length, failures: rows.filter((row) => !row.ok) };
  });
  assert.equal(result.count, 52);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(errors, []);
  await context.close();
});

test("桌機可完成選角、燈箱、文法護盾、答對攻擊與雙共用題組", { timeout: 45000 }, async (t) => {
  if (!browser) return t.skip("找不到Edge/Chromium");
  const { context, page, errors } = await deterministicPage();
  assert.equal(await page.locator(".year-link").getAttribute("href"), "https://addielu-phy.github.io/cap-english-fighter-years/");
  await page.getByRole("button", { name: /PRESS START/ }).click();
  await page.getByRole("radio", { name: /文法法師/ }).click();
  await page.getByRole("button", { name: /開始對戰/ }).click();
  assert.equal((await page.locator("#questionNumber").textContent()).trim(), "113會考第1題");
  assert.equal((await page.locator("#roundTotal").textContent()).trim(), "/12");
  assert.equal(await page.locator("#questionMedia img").count(), 1);
  assert.equal(await page.locator(".answer-button").count(), 4);
  assert.equal((await page.locator("#timerText").textContent()).trim(), "75");

  await page.locator("#questionMedia .image-button").click();
  await page.locator("#lightbox[open]").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#lightbox").evaluate((node) => node.open), false);

  await page.getByRole("button", { name: "選擇B選項" }).click();
  assert.match(await page.locator("#feedbackTitle").textContent(), /文法護盾.*正解 A/);
  assert.equal((await page.locator("#playerHpText").textContent()).trim(), "100 / 100");
  assert.equal((await page.locator(".answer-button.correct").textContent()).trim(), "A");

  await page.getByRole("button", { name: /下一回合/ }).click();
  assert.equal((await page.locator("#questionNumber").textContent()).trim(), "113會考第2題");
  await page.getByRole("button", { name: "選擇C選項" }).click();
  assert.match(await page.locator("#feedbackTitle").textContent(), /正確命中.*正解 C/);
  assert.equal((await page.locator("#bossHpText").textContent()).trim(), "134 / 144");
  assert.equal((await page.locator("#energyText").textContent()).trim(), "40%");

  await page.evaluate(() => localStorage.setItem("capEnglishFighter113_wrong_v1", JSON.stringify(["113-eng-q40"])));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /PRESS START/ }).click();
  await page.getByRole("button", { name: /重練歷史錯題 1/ }).click();
  assert.equal((await page.locator("#questionNumber").textContent()).trim(), "113會考第40題");
  assert.equal(await page.locator("#questionMedia img").count(), 3);
  assert.equal(await page.locator(".context-label").count(), 2);
  const dimensions = await page.locator("#questionMedia img").evaluateAll((images) => images.map((image) => [image.complete, image.naturalWidth, image.naturalHeight]));
  assert.ok(dimensions.every(([complete, width, height]) => complete && width > 600 && height > 80), JSON.stringify(dimensions));
  assert.deepEqual(errors, []);
  await context.close();
});

test("燈箱與隱藏戰鬥畫面不接受全域作答或下一題快捷鍵", { timeout: 30000 }, async (t) => {
  if (!browser) return t.skip("找不到Edge/Chromium");
  const { context, page, errors } = await deterministicPage();
  await page.getByRole("button", { name: /PRESS START/ }).click();
  await page.getByRole("button", { name: /開始對戰/ }).click();
  const originalQuestion = (await page.locator("#questionNumber").textContent()).trim();

  await page.locator("#questionMedia .image-button").click();
  await page.locator("#lightbox[open]").waitFor();
  await page.keyboard.press("B");
  assert.equal(await page.locator("#feedbackPanel").evaluate((node) => node.hidden), true);
  assert.equal(await page.locator(".answer-button:disabled").count(), 0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "選擇B選項" }).click();
  assert.equal(await page.locator("#feedbackPanel").evaluate((node) => node.hidden), false);
  await page.locator("#homeButton").click();
  assert.equal(await page.locator("#setupScreen").evaluate((node) => node.hidden), false);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(100);
  assert.equal((await page.locator("#questionNumber").textContent()).trim(), originalQuestion);
  assert.equal(await page.locator("#battleScreen").evaluate((node) => node.hidden), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test("大招擊敗Boss後返回入口會取消延遲結算", { timeout: 45000 }, async (t) => {
  if (!browser) return t.skip("找不到Edge/Chromium");
  const { context, page, errors } = await deterministicPage();
  await page.getByRole("button", { name: /PRESS START/ }).click();
  await page.getByRole("radio", { name: /字彙騎士/ }).click();
  await page.getByRole("button", { name: /開始對戰/ }).click();
  const answers = "ACBBDDBDCD";
  for (const letter of answers) {
    await page.getByRole("button", { name: `選擇${letter}選項` }).click();
    await page.getByRole("button", { name: /下一回合/ }).click();
  }
  assert.equal((await page.locator("#bossHpText").textContent()).trim(), "17 / 144");
  await page.locator("#specialButton").click();
  await page.locator("#homeButton").click();
  await page.waitForTimeout(650);
  assert.equal(await page.locator("#setupScreen").evaluate((node) => node.hidden), false);
  assert.equal(await page.locator("#resultScreen").evaluate((node) => node.hidden), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test("360px手機無整頁橫向溢出，題圖可滑讀且偏好設定生效", { timeout: 30000 }, async (t) => {
  if (!browser) return t.skip("找不到Edge/Chromium");
  const { context, page, errors } = await deterministicPage({ width: 360, height: 800 });
  const yearLinkBox = await page.locator(".year-link").boundingBox();
  assert.ok(yearLinkBox.width >= 64, `year link width ${yearLinkBox.width}`);
  assert.ok(yearLinkBox.height <= 42, `year link height ${yearLinkBox.height}`);
  await page.getByRole("button", { name: /PRESS START/ }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.locator("#motionButton").click();
  await page.locator("#contrastButton").click();
  assert.equal(await page.locator("body").evaluate((body) => body.classList.contains("reduce-motion")), true);
  assert.equal(await page.locator("body").evaluate((body) => body.classList.contains("high-contrast")), true);
  await page.getByRole("button", { name: /開始對戰/ }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  const minAnswerHeight = Math.min(...await page.locator(".answer-button").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height)));
  assert.ok(minAnswerHeight >= 44, String(minAnswerHeight));
  const imageMetrics = await page.locator("#questionMedia .image-button").first().evaluate((button) => {
    const image = button.querySelector("img");
    return { buttonWidth: button.getBoundingClientRect().width, imageWidth: image.getBoundingClientRect().width, scrollWidth: button.scrollWidth, pageWidth: document.documentElement.scrollWidth, viewport: innerWidth, touchAction: getComputedStyle(button).touchAction };
  });
  assert.ok(imageMetrics.pageWidth <= imageMetrics.viewport, JSON.stringify(imageMetrics));
  assert.ok(imageMetrics.buttonWidth <= 336 && imageMetrics.buttonWidth > 250, JSON.stringify(imageMetrics));
  assert.ok(imageMetrics.imageWidth >= 650 && imageMetrics.scrollWidth > imageMetrics.buttonWidth, JSON.stringify(imageMetrics));
  assert.match(imageMetrics.touchAction, /pan-y/);
  assert.deepEqual(errors, []);
  await context.close();
});

test("錯題只存在本機並可在重新載入後重練", { timeout: 30000 }, async (t) => {
  if (!browser) return t.skip("找不到Edge/Chromium");
  const { context, page, errors } = await deterministicPage();
  await page.getByRole("button", { name: /PRESS START/ }).click();
  await page.getByRole("button", { name: /開始對戰/ }).click();
  await page.getByRole("button", { name: "選擇B選項" }).click();
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("capEnglishFighter113_wrong_v1"))), ["113-eng-q01"]);
  assert.equal(await page.evaluate(() => localStorage.getItem("capEnglishFighter_wrong_v1")), null);
  await page.evaluate(() => localStorage.setItem("capEnglishFighter113_wrong_v1", JSON.stringify([
    "113-eng-q01", "113-eng-q01", "unknown-id", 7, null
  ])));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /PRESS START/ }).click();
  const retry = page.getByRole("button", { name: /重練歷史錯題 1/ });
  assert.equal(await retry.isEnabled(), true);
  await retry.click();
  assert.equal((await page.locator("#roundTotal").textContent()).trim(), "/1");
  assert.equal((await page.locator("#questionNumber").textContent()).trim(), "113會考第1題");
  assert.deepEqual(errors, []);
  await context.close();
});
