import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadLocalAcquired,
  filterLocalAcquiredRecent,
  LOCAL_ACQUIRED_DAYS,
} from "../lib/sources/local-acquired";
import type { CrawledArticle } from "../lib/ingest/merge";

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 3600 * 1000).toISOString();
}

const sample: CrawledArticle[] = [
  { sourceId: "nfra", source: "国家金融监督管理总局", title: "今日政策", url: "https://www.nfra.gov.cn/1", publishedAt: daysAgo(0) },
  { sourceId: "pbc", source: "中国人民银行", title: "央行公告", url: "https://www.pbc.gov.cn/1", publishedAt: daysAgo(1) },
  { sourceId: "cls", source: "财联社", title: "金融深度", url: "https://www.cls.cn/detail/1", publishedAt: daysAgo(6) },
  { sourceId: "gd-szse", source: "同花顺", title: "广东预披露", url: "https://data.10jqka.com.cn/1", publishedAt: daysAgo(2), region: "gd" },
  { sourceId: "pbc", title: "过期旧文", url: "https://www.pbc.gov.cn/old", publishedAt: daysAgo(9) },
  { sourceId: "nfra", title: "无日期", url: "https://www.nfra.gov.cn/nodate" },
];

describe("local-acquired（本地手动采集文件）", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lacq-"));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("loadLocalAcquired：正常读取；缺失/损坏/结构不符 → null", async () => {
    const good = path.join(tmp, "good.json");
    await fs.writeFile(good, JSON.stringify({ fetchedAt: daysAgo(0), items: sample }), "utf8");
    const d = loadLocalAcquired(good);
    assert.ok(d);
    assert.equal(d.items.length, 6);
    assert.ok(d.fetchedAt);

    assert.equal(loadLocalAcquired(path.join(tmp, "nope.json")), null, "缺失 → null");
    const corrupt = path.join(tmp, "c.json");
    await fs.writeFile(corrupt, "{bad", "utf8");
    assert.equal(loadLocalAcquired(corrupt), null, "损坏 → null");
    const badShape = path.join(tmp, "b.json");
    await fs.writeFile(badShape, JSON.stringify({ foo: 1 }), "utf8");
    assert.equal(loadLocalAcquired(badShape), null, "结构不符 → null");
  });

  it("filterLocalAcquiredRecent：只留最近 7 天、丢弃无日期", () => {
    const recent = filterLocalAcquiredRecent(sample, LOCAL_ACQUIRED_DAYS);
    const urls = recent.map((it) => it.url);
    assert.ok(urls.includes("https://www.nfra.gov.cn/1"), "今天应保留");
    assert.ok(urls.includes("https://www.pbc.gov.cn/1"), "1 天前应保留");
    assert.ok(urls.includes("https://www.cls.cn/detail/1"), "6 天前应保留（边界内）");
    assert.ok(urls.includes("https://data.10jqka.com.cn/1"), "2 天前应保留");
    assert.ok(!urls.includes("https://www.pbc.gov.cn/old"), "9 天前应丢弃");
    assert.ok(!urls.includes("https://www.nfra.gov.cn/nodate"), "无日期应丢弃");
    assert.equal(recent.length, 4);
  });

  it("自定义天数窗口生效", () => {
    const r1 = filterLocalAcquiredRecent(sample, 3);
    assert.equal(r1.length, 3, "3 天窗口：今天/1天前/2天前");
    const r2 = filterLocalAcquiredRecent(sample, 10);
    assert.equal(r2.length, 5, "10 天窗口：含 9 天前，无日期仍丢弃");
  });
});
