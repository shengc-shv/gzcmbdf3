/**
 * 执行摘要来源选择（lib/ai/executive-summary.ts 的 selectExecutiveSummary）。
 * 核心验证：SKIP_AI 必须复用持久化资产且不触达 LLM；正常模式优先复用、缺失回退。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  selectExecutiveSummary,
  writeStore,
  loadStore,
  type ExecutiveSummary,
} from "../lib/ai/executive-summary";

const SAMPLE: ExecutiveSummary = {
  must_read: [{ title: "t", why: "w" }],
  insights: [{ topic: "p", impact: "i", action: "a" }],
};

test("SKIP_AI：复用持久化 exec，且不调用 generate", async () => {
  let called = false;
  const res = await selectExecutiveSummary({
    skipAi: true,
    persisted: SAMPLE,
    generate: async () => {
      called = true;
      return SAMPLE;
    },
  });
  assert.deepEqual(res, SAMPLE);
  assert.equal(called, false, "SKIP_AI 不应触达 generate");
});

test("SKIP_AI 且无持久化：返回 null，且不调用 generate", async () => {
  let called = false;
  const res = await selectExecutiveSummary({
    skipAi: true,
    persisted: undefined,
    generate: async () => {
      called = true;
      return SAMPLE;
    },
  });
  assert.equal(res, null);
  assert.equal(called, false);
});

test("正常模式：有持久化则复用，不调用 generate", async () => {
  let called = false;
  const res = await selectExecutiveSummary({
    skipAi: false,
    persisted: SAMPLE,
    generate: async () => {
      called = true;
      return SAMPLE;
    },
  });
  assert.deepEqual(res, SAMPLE);
  assert.equal(called, false, "应优先复用持久化");
});

test("正常模式：无持久化则回退 generate", async () => {
  let called = false;
  const res = await selectExecutiveSummary({
    skipAi: false,
    persisted: undefined,
    generate: async () => {
      called = true;
      return SAMPLE;
    },
  });
  assert.deepEqual(res, SAMPLE);
  assert.equal(called, true);
});

test("归档 round-trip：writeStore 后可 loadStore 读回", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "gzcmbdf3-exec-"));
  const date = "2026-08-20";
  writeStore(date, SAMPLE, { baseDir: base });
  const p = path.join(base, "history", date, "store.json");
  assert.ok(fs.existsSync(p), "应生成 history/<date>/store.json");
  const back = loadStore(date, { baseDir: base });
  assert.deepEqual(back, SAMPLE);
  fs.rmSync(base, { recursive: true, force: true });
});

test("归档读取：缺失日期返回 undefined", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "gzcmbdf3-exec-"));
  assert.equal(loadStore("2026-08-21", { baseDir: base }), undefined);
  fs.rmSync(base, { recursive: true, force: true });
});

test("归档读取：损坏文件返回 undefined（不 crash）", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "gzcmbdf3-exec-"));
  const date = "2026-08-20";
  const dir = path.join(base, "history", date);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "store.json"), "{broken", "utf8");
  assert.equal(loadStore(date, { baseDir: base }), undefined);
  fs.rmSync(base, { recursive: true, force: true });
});

test("loadStore 过渡兼容：无 store.json 时回退读旧 executive.json", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "gzcmbdf3-exec-"));
  const date = "2026-08-20";
  const dir = path.join(base, "history", date);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "executive.json"), JSON.stringify({ date, executive: SAMPLE }), "utf8");
  assert.deepEqual(loadStore(date, { baseDir: base }), SAMPLE, "应回退读 executive.json");
  fs.rmSync(base, { recursive: true, force: true });
});

test("forceRegen：忽略已存在持久化，强制调用 generate", async () => {
  let called = false;
  const fresh = { must_read: [{ title: "new", why: "n" }], insights: [] };
  const res = await selectExecutiveSummary({
    skipAi: false,
    persisted: SAMPLE,
    forceRegen: true,
    generate: async () => {
      called = true;
      return fresh;
    },
  });
  assert.deepEqual(res, fresh, "forceRegen 应返回新生成结果");
  assert.equal(called, true, "forceRegen 应触达 generate");
});

test("forceRegen 在 SKIP_AI 下被忽略：仍复用持久化、不调用 generate", async () => {
  let called = false;
  const res = await selectExecutiveSummary({
    skipAi: true,
    persisted: SAMPLE,
    forceRegen: true,
    generate: async () => {
      called = true;
      return SAMPLE;
    },
  });
  assert.deepEqual(res, SAMPLE, "SKIP_AI+forceRegen 应忽略 forceRegen 复用持久化");
  assert.equal(called, false);
});
