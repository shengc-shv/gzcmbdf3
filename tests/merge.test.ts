/**
 * 归一化层（lib/ingest/merge.ts）单测：汇合 / 去重 / region 分流 / tier 透传。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dedupeByUrl,
  routeRegion,
  toMergeArticle,
  filterByWindow,
} from "../lib/ingest/merge";

test("filterByWindow: publishedAt 早于 7 天窗口的旧文丢弃，窗口内保留", () => {
  const now = Date.now();
  const day = 86_400_000;
  const items = [
    { url: "a", publishedAt: new Date(now) },                       // 今天
    { url: "b", publishedAt: new Date(now - 2 * day) },             // 2 天前（窗口内）
    { url: "c", publishedAt: new Date(now - 6 * day) },             // 6 天前（窗口内边界）
    { url: "d", publishedAt: new Date(now - 8 * day) },             // 8 天前（超窗口）
    { url: "e", publishedAt: new Date(now - 40 * day) },            // 40 天前旧文
    { url: "f" },                                                   // 无时间戳 → 保留
  ];
  const kept = filterByWindow(items, 7);
  assert.deepEqual(
    kept.map((x) => x.url),
    ["a", "b", "c", "f"],
    "窗口内 + 无时间戳保留；超窗口旧文（d/e）丢弃",
  );
});

test("filterByWindow: 兼容字符串时间戳（JSON 数据）", () => {
  const now = Date.now();
  const kept = filterByWindow(
    [
      { url: "a", publishedAt: new Date(now - 1 * 86_400_000).toISOString() },
      { url: "b", publishedAt: new Date(now - 30 * 86_400_000).toISOString() },
    ],
    7,
  );
  assert.deepEqual(kept.map((x) => x.url), ["a"]);
});

test("filterByWindow: 无发布时间 → 回退采集时间 fetchedAt 判定窗口", () => {
  const now = Date.now();
  const day = 86_400_000;
  const kept = filterByWindow(
    [
      { url: "a", fetchedAt: new Date(now) },                 // 采集于今天 → 保留
      { url: "b", fetchedAt: new Date(now - 2 * day) },       // 采集于 2 天前 → 保留
      { url: "c", fetchedAt: new Date(now - 40 * day) },      // 采集于 40 天前 → 丢弃
      { url: "d" },                                           // 两者皆无 → 保留
    ],
    7,
  );
  assert.deepEqual(
    kept.map((x) => x.url),
    ["a", "b", "d"],
    "无 publishedAt 时按 fetchedAt 判定；两者皆无才保留",
  );
});

test("dedupeByUrl: 重复 URL 仅保留先出现的，计数正确", () => {
  const base = [{ url: "a" }, { url: "b" }];
  const incoming = [{ url: "b" }, { url: "c" }];
  const { merged, added, skipped } = dedupeByUrl(base, incoming);
  assert.deepEqual(merged.map((x) => x.url), ["a", "b", "c"]);
  assert.equal(added, 1);
  assert.equal(skipped, 1);
});

test("dedupeByUrl: 空输入不改变 base", () => {
  const { merged, added, skipped } = dedupeByUrl([{ url: "a" }], []);
  assert.equal(merged.length, 1);
  assert.equal(added, 0);
  assert.equal(skipped, 0);
});

test("routeRegion(ipo): gz region → gz- 前缀改写 + category=gz", () => {
  assert.deepEqual(routeRegion("gd-sse", "ipo", { region: "gz" }), {
    sourceId: "gz-sse",
    category: "gz",
  });
});

test("routeRegion(ipo): 非 gz / 缺省 region → 不改写 + category=ipo", () => {
  assert.deepEqual(routeRegion("gd-sse", "ipo", { region: "gd" }), {
    sourceId: "gd-sse",
    category: "ipo",
  });
  assert.deepEqual(routeRegion("gd-sse", "ipo"), {
    sourceId: "gd-sse",
    category: "ipo",
  });
});

test("routeRegion(gz): sourceId 原样保留，category 用 gzCategory ?? gz", () => {
  assert.deepEqual(routeRegion("gz-stats", "gz", { gzCategory: "finance" }), {
    sourceId: "gz-stats",
    category: "finance",
  });
  assert.deepEqual(routeRegion("gz-stats", "gz"), {
    sourceId: "gz-stats",
    category: "gz",
  });
});

test("toMergeArticle: 默认值映射（sourceId/source/title/category/excerpt）", () => {
  const a = toMergeArticle({ url: "u1", title: "T", publishedAt: "2026-08-19T00:00:00Z" }, "gz");
  assert.equal(a.sourceId, "gz-local");
  assert.equal(a.source, "广州商机");
  assert.equal(a.title, "T");
  assert.equal(a.url, "u1");
  assert.equal(a.category, "gz");
  assert.equal(a.excerpt, "");
  assert.ok(a.publishedAt instanceof Date);
});

test("toMergeArticle: ipo 模式默认 sourceId 与 source 标签", () => {
  const a = toMergeArticle({ url: "u2", title: "T" }, "ipo");
  assert.equal(a.sourceId, "gd-local-scraper");
  assert.equal(a.source, "广东本地爬虫");
  assert.equal(a.category, "ipo");
});

test("toMergeArticle: tier 透传（T6 数据契约）", () => {
  const a = toMergeArticle({ url: "u3", title: "T", tier: "T1" }, "gz");
  assert.equal(a.tier, "T1");
  const b = toMergeArticle({ url: "u4", title: "T" }, "gz");
  assert.equal(b.tier, undefined);
});
