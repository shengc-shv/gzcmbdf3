/**
 * 归一化层（lib/ingest/merge.ts）单测：汇合 / 去重 / region 分流 / tier 透传。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dedupeByUrl,
  routeRegion,
  toMergeArticle,
} from "../lib/ingest/merge";

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
