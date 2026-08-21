/**
 * 任务三（#43）：合并流按权威等级拆「官方 / 媒体」两视觉带，官方置顶。
 * 覆盖：renderSourcesBlock 对 merged 源拆带、官方带在上、带标题渲染、
 * 官方带含 T1+T1.5 / 媒体带含 T2、非 merged 源不拆带、单类流只渲染对应带。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderSourcesBlock, renderBandedFeed, type SourceGroup } from "../lib/output/render/cards";
import type { ArticleInput } from "../lib/types";
import type { Category } from "../lib/sources/types";

const art = (over: Partial<ArticleInput>): ArticleInput => ({
  sourceId: "x",
  source: "x",
  title: "t",
  url: "https://example.com/x",
  category: "finance",
  publishedAt: new Date(),
  ...over,
} as ArticleInput);

test("#43 合并流拆『官方/媒体』两带，官方带在上", () => {
  const gov = art({ title: "国务院发布养老新政", tier: "T1", source: "国务院" });
  const semi = art({ title: "央行广州分行数据", tier: "T1.5", source: "央行广州分行" });
  const media = art({ title: "财联社解读", tier: "T2", source: "财联社" });
  const sources: SourceGroup[] = [
    { sourceId: "_merged", sourceName: "国内财经", items: [media, gov, semi], merged: true },
  ];
  const html = renderSourcesBlock("finance", "cn-finance", sources);
  assert.ok(html.includes("feed-band-official"), "应渲染官方带");
  assert.ok(html.includes("feed-band-media"), "应渲染媒体带");
  assert.ok(html.includes("官方 / 政府一手来源"), "官方带标题");
  assert.ok(html.includes("媒体 / 智库解读"), "媒体带标题");
  // 官方带位置在媒体带之前
  assert.ok(html.indexOf("feed-band-official") < html.indexOf("feed-band-media"));
  // 官方内容落在官方带内、媒体内容落在媒体带内
  const officialStart = html.indexOf("feed-band-official");
  const mediaStart = html.indexOf("feed-band-media");
  assert.ok(html.slice(officialStart, mediaStart).includes("国务院发布养老新政"));
  assert.ok(html.slice(mediaStart).includes("财联社解读"));
});

test("#43 官方带含 T1+T1.5，媒体带含 T2", () => {
  const items = [
    art({ title: "媒体文", tier: "T2", source: "财联社" }),
    art({ title: "官方文", tier: "T1", source: "国务院" }),
    art({ title: "准官方文", tier: "T1.5", source: "央视" }),
    art({ title: "另一媒体", tier: "T2", source: "证券时报" }),
  ];
  const html = renderBandedFeed(items, true);
  const officialStart = html.indexOf("feed-band-official");
  const mediaStart = html.indexOf("feed-band-media");
  const officialSeg = html.slice(officialStart, mediaStart);
  const mediaSeg = html.slice(mediaStart);
  assert.ok(officialSeg.includes("官方文") && officialSeg.includes("准官方文"));
  assert.ok(!officialSeg.includes("媒体文") && !officialSeg.includes("另一媒体"));
  assert.ok(mediaSeg.includes("媒体文") && mediaSeg.includes("另一媒体"));
  assert.ok(!mediaSeg.includes("官方文") && !mediaSeg.includes("准官方文"));
});

test("#43 非 merged 源不拆带（保持原来源 tabs 渲染）", () => {
  const sources: SourceGroup[] = [
    { sourceId: "s1", sourceName: "国务院", items: [art({ title: "a", tier: "T1" })], merged: false },
    { sourceId: "s2", sourceName: "财联社", items: [art({ title: "b", tier: "T2" })], merged: false },
  ];
  const html = renderSourcesBlock("finance", "cn-finance", sources);
  assert.ok(!html.includes("feed-band-official"), "非合并流不应出现分带");
  assert.ok(html.includes("source-tabs") || html.includes("source-content"), "应保持来源 tabs 结构");
});

test("#43 全官方/全媒体流只渲染对应一条带", () => {
  const onlyMedia = renderBandedFeed([art({ title: "m", tier: "T2" })], true);
  assert.ok(onlyMedia.includes("feed-band-media") && !onlyMedia.includes("feed-band-official"));
  const onlyOfficial = renderBandedFeed([art({ title: "o", tier: "T1" })], true);
  assert.ok(onlyOfficial.includes("feed-band-official") && !onlyOfficial.includes("feed-band-media"));
});

test("#43 带内仍按时间倒序（带内 sortByTierAndTime）", () => {
  const newer = art({ title: "官方新", tier: "T1", publishedAt: new Date("2026-08-21T10:00:00Z") });
  const older = art({ title: "官方旧", tier: "T1", publishedAt: new Date("2026-08-20T10:00:00Z") });
  const html = renderBandedFeed([older, newer], true);
  assert.ok(html.indexOf("官方新") < html.indexOf("官方旧"), "带内应按发布时间倒序");
});
