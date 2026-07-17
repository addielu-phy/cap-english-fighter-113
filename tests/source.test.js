const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const exam = JSON.parse(fs.readFileSync(path.join(root, "data", "exam113.json"), "utf8"));
const meta = JSON.parse(fs.readFileSync(path.join(root, "data", "meta113.json"), "utf8"));
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, "questions.js"), "utf8"), sandbox);
const generated = sandbox.window.ENGLISH_QUESTIONS;

function question(number) {
  return exam.questions.find((item) => Number(item.number) === number);
}

test("第22與23題共用Philip/Jason完整短文圖", () => {
  const q22 = question(22);
  const q23 = question(23);
  assert.equal(q22.contextImages.length, 1);
  assert.deepEqual(q23.contextImages, q22.contextImages);
  assert.match(q22.contextImages[0], /context-p04-philip-jason\.webp$/);
  const localPath = path.join(root, "assets", "questions", path.basename(q22.contextImages[0]));
  assert.ok(fs.existsSync(localPath), localPath);
});

test("第22至43題的所有官方題組都掛上完整共用資料", () => {
  const groups = [
    { numbers: [22, 23], contexts: ["context-p04-philip-jason.webp"] },
    { numbers: [24, 25], contexts: ["context-p05-top.webp"] },
    { numbers: [26, 27], contexts: ["context-p06-top.webp"] },
    { numbers: [28, 29], contexts: ["context-p07-top.webp"] },
    { numbers: [30, 31, 32], contexts: ["context-p08.webp"] },
    { numbers: [33, 34, 35], contexts: ["context-p10-top.webp"] },
    { numbers: [36, 37, 38, 39], contexts: ["context-p12.webp"] },
    { numbers: [40, 41, 42, 43], contexts: ["context-p14.webp", "context-p15-top.webp"] }
  ];
  for (const group of groups) {
    for (const number of group.numbers) {
      assert.deepEqual(question(number).contextImages.map((value) => path.basename(value)), group.contexts, `q${number}`);
    }
  }
});

test("生成題庫逐題等於官方映射與教學meta", () => {
  assert.equal(generated.length, 43);
  for (const item of generated) {
    const source = question(item.number);
    const teaching = meta.find((row) => row.number === item.number);
    const remap = (values) => values.map((value) => `assets/questions/${path.basename(value)}`);
    assert.equal(item.id, `113-eng-q${String(item.number).padStart(2, "0")}`);
    assert.equal(item.answer, source.answer);
    assert.deepEqual(Array.from(item.images), remap(source.images));
    assert.deepEqual(Array.from(item.contextImages), remap(source.contextImages));
    for (const field of ["unit", "difficulty", "explanation", "trap"]) {
      assert.equal(item[field], teaching[field], `q${item.number} ${field}`);
    }
  }
});

test("內容審查修正與常見誤區標籤不重複", () => {
  const q36 = meta.find((row) => row.number === 36);
  const q41 = meta.find((row) => row.number === 41);
  assert.match(q36.explanation, /後文又補充/);
  assert.doesNotMatch(q36.explanation, /下一句立即/);
  assert.match(q41.explanation, /每十萬人24週累計死亡數/);
  assert.ok(meta.every((row) => !/^常見誤區/.test(row.trap)));
});

test("生產程式不使用HTML注入或遠端送出介面", () => {
  const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
  assert.doesNotMatch(source, /\.innerHTML\s*=|\beval\s*\(|new\s+Function\s*\(/);
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|sendBeacon/);
});
