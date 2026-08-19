/**
 * AI 资产账本（lib/ai/assets.ts）边界测试。
 * 通过 chdir 到临时目录隔离，避免写脏仓库 data/ai-assets/。
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadAiAssets,
  saveAiAssets,
  dailyAssetKey,
  assetSummary,
  assetDaily,
  type AiAssetStore,
} from "../lib/ai/assets";

const ORIG_CWD = process.cwd();
let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gz-ai-assets-"));
  process.chdir(tmp);
});

afterEach(() => {
  process.chdir(ORIG_CWD);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("save → load roundtrip：文章资产与每日资产均可持久化", () => {
  const store: AiAssetStore = {
    "https://x/u1": { summary: "AI 摘要", subcategory: "gz-credit", relevant: true, updatedAt: "2026-08-19T00:00:00Z" },
    [dailyAssetKey("2026-08-19")]: { executive: { must_read: [] }, updatedAt: "2026-08-19T00:00:00Z" },
  };
  saveAiAssets(store);
  const loaded = loadAiAssets();
  assert.equal(loaded["https://x/u1"].summary, "AI 摘要");
  assert.equal(assetSummary(loaded, "https://x/u1"), "AI 摘要");
  assert.ok(assetDaily(loaded, "2026-08-19")?.executive, "每日资产可读");
});

test("AI_ASSETS_MAX 上限：超限按 updatedAt 最旧优先裁剪", () => {
  process.env.AI_ASSETS_MAX = "2";
  try {
    const store: AiAssetStore = {
      old: { summary: "a", updatedAt: "2026-08-01T00:00:00Z" },
      mid: { summary: "b", updatedAt: "2026-08-10T00:00:00Z" },
      new: { summary: "c", updatedAt: "2026-08-19T00:00:00Z" },
    };
    saveAiAssets(store);
    const loaded = loadAiAssets();
    assert.equal(Object.keys(loaded).length, 2, "应裁剪到 2 键");
    assert.ok(!loaded.old, "最旧的应被裁剪");
    assert.ok(loaded.new && loaded.mid);
  } finally {
    delete process.env.AI_ASSETS_MAX;
  }
});

test("PERSIST_AI=off：不读不写", () => {
  process.env.PERSIST_AI = "off";
  try {
    const store: AiAssetStore = { u: { summary: "x", updatedAt: "2026-08-19T00:00:00Z" } };
    saveAiAssets(store);
    assert.equal(fs.existsSync("data/ai-assets/store.json"), false, "off 时不落盘");
    assert.deepEqual(loadAiAssets(), {}, "off 时读空");
  } finally {
    delete process.env.PERSIST_AI;
  }
});

test("dailyAssetKey / assetSummary / assetDaily 便捷函数", () => {
  assert.equal(dailyAssetKey("2026-08-19"), "daily:2026-08-19");
  const store: AiAssetStore = {
    u1: { summary: "s", updatedAt: "t" },
    [dailyAssetKey("d")]: { executive: { x: 1 }, updatedAt: "t" },
  };
  assert.equal(assetSummary(store, "u1"), "s");
  assert.equal(assetSummary(store, "nope"), undefined);
  assert.equal(assetDaily(store, "d")?.executive?.x, 1);
  assert.equal(assetDaily(store, "nope"), undefined);
});
