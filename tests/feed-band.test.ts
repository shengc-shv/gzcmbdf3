/**
 * 任务三（#43 改版，2026-08-21）：合并流按权威等级拆「官方 / 媒体」两个子标签 tab，
 * 官方 tab 默认展示。覆盖：tab 结构渲染、官方 tab 默认 active、官方 panel 含 T1+T1.5 /
 * 媒体 panel 含 T2、非 merged 源不拆、空带占位、panel 内时间倒序。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderSourcesBlock, renderBandedFeed, type SourceGroup } from "../lib/output/render/cards";
import type { ArticleInput } from "../lib/types";

const art = (over: Partial<ArticleInput>): ArticleInput => ({
  sourceId: "x",
  source: "x",
  title: "t",
  url: "https://example.com/x",
  category: "finance",
  publishedAt: new Date(),
  ...over,
} as ArticleInput);

test("#43 合并流渲染『官方/媒体』tab，官方 tab 默认 active 且在前", () => {
  const gov = art({ title: "国务院发布养老新政", tier: "T1", source: "国务院" });
  const semi = art({ title: "央行广州分行数据", tier: "T1.5", source: "央行广州分行" });
  const media = art({ title: "财联社解读", tier: "T2", source: "财联社" });
  const sources: SourceGroup[] = [
    { sourceId: "_merged", sourceName: "国内财经", items: [media, gov, semi], merged: true },
  ];
  const html = renderSourcesBlock("finance", "cn-finance", sources);
  assert.ok(html.includes("band-tabs"), "应渲染 tab 导航");
  assert.ok(html.includes("band-tab"), "应渲染官方/媒体 tab 按钮");
  assert.ok(html.includes("官方 / 政府一手来源"), "官方 tab 文案");
  assert.ok(html.includes("媒体 / 智库解读"), "媒体 tab 文案");
  assert.ok(html.includes('data-band="official"'), "官方 tab data-band");
  assert.ok(html.includes('data-band="media"'), "媒体 tab data-band");
  // 官方 tab 在媒体 tab 之前
  assert.ok(html.indexOf("官方 / 政府一手来源") < html.indexOf("媒体 / 智库解读"));
  // 官方 panel 默认 active
  assert.ok(html.includes('class="band-panel active" data-band-panel="official"'), "官方 panel 默认 active");
  assert.ok(html.includes('data-band-panel="media"'), "媒体 panel 存在");
  // 官方 panel 含官方/准官方内容，媒体 panel 含媒体内容
  const officialPanel = html.split('data-band-panel="official"')[1]?.split('data-band-panel="media"')[0] ?? "";
  const mediaPanel = html.split('data-band-panel="media"')[1] ?? "";
  assert.ok(officialPanel.includes("国务院发布养老新政") && officialPanel.includes("央行广州分行数据"));
  assert.ok(mediaPanel.includes("财联社解读"));
});

test("#43 官方 panel 含 T1+T1.5，媒体 panel 含 T2", () => {
  const items = [
    art({ title: "媒体文", tier: "T2", source: "财联社" }),
    art({ title: "官方文", tier: "T1", source: "国务院" }),
    art({ title: "准官方文", tier: "T1.5", source: "央视" }),
    art({ title: "另一媒体", tier: "T2", source: "证券时报" }),
  ];
  const html = renderBandedFeed(items, true);
  const officialPanel = html.split('data-band-panel="official"')[1]?.split('data-band-panel="media"')[0] ?? "";
  const mediaPanel = html.split('data-band-panel="media"')[1] ?? "";
  assert.ok(officialPanel.includes("官方文") && officialPanel.includes("准官方文"));
  assert.ok(!officialPanel.includes("媒体文") && !officialPanel.includes("另一媒体"));
  assert.ok(mediaPanel.includes("媒体文") && mediaPanel.includes("另一媒体"));
  assert.ok(!mediaPanel.includes("官方文") && !mediaPanel.includes("准官方文"));
});

test("#43 非 merged 源不拆带（保持原来源 tabs 渲染）", () => {
  const sources: SourceGroup[] = [
    { sourceId: "s1", sourceName: "国务院", items: [art({ title: "a", tier: "T1" })], merged: false },
    { sourceId: "s2", sourceName: "财联社", items: [art({ title: "b", tier: "T2" })], merged: false },
  ];
  const html = renderSourcesBlock("finance", "cn-finance", sources);
  assert.ok(!html.includes("band-tabs"), "非合并流不应出现官方/媒体 tab");
  assert.ok(html.includes("source-tabs") || html.includes("source-content"), "应保持来源 tabs 结构");
});

test("#43 单类流仍渲染两个 tab，空 panel 显示占位", () => {
  const onlyMedia = renderBandedFeed([art({ title: "m", tier: "T2" })], true);
  assert.ok(onlyMedia.includes('data-band="official"') && onlyMedia.includes('data-band="media"'), "两个 tab 恒渲染");
  assert.ok(onlyMedia.includes("class=\"empty\""), "空官方 panel 应显示占位");
  const onlyOfficial = renderBandedFeed([art({ title: "o", tier: "T1" })], true);
  assert.ok(onlyOfficial.includes('data-band="official"') && onlyOfficial.includes('data-band="media"'), "两个 tab 恒渲染");
  assert.ok(onlyOfficial.includes("class=\"empty\""), "空媒体 panel 应显示占位");
});

test("#43 panel 内仍按时间倒序（panel 内 sortByTierAndTime）", () => {
  const newer = art({ title: "官方新", tier: "T1", publishedAt: new Date("2026-08-21T10:00:00Z") });
  const older = art({ title: "官方旧", tier: "T1", publishedAt: new Date("2026-08-20T10:00:00Z") });
  const html = renderBandedFeed([older, newer], true);
  const officialPanel = html.split('data-band-panel="official"')[1]?.split('data-band-panel="media"')[0] ?? "";
  assert.ok(officialPanel.indexOf("官方新") < officialPanel.indexOf("官方旧"), "panel 内应按发布时间倒序");
});
