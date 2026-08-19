/**
 * renderHtml 快照/结构测试（zh 默认 locale）：
 * 结构存在性 / 关键 CSS class / 关键文本 / 空数据兜底 / 日期。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHtml, type RawByCategory } from "../lib/output/render";
import { renderRawCategoryPanel, type SubGroup } from "../lib/output/render/cards";
import type { DailyReport, ArticleInput } from "../lib/types";
import { toMatchSnapshot } from "./snapshot";

const emptyRaw = (): RawByCategory => ({
  tech: [],
  finance: [],
  politics: [],
  "gd-ipo": [],
  ipo: [],
  gz: [],
});

const report = (): DailyReport => ({
  hero_headline: "",
  daily_overview: "",
  tech_briefs: [],
  finance_briefs: [],
  politics_briefs: [],
  gd_ipo_briefs: [],
  editor_note: "",
  keywords: [],
});

const item = (
  url: string,
  title: string,
  category: ArticleInput["category"],
): ArticleInput => ({
  sourceId: "test-src",
  source: "测试源",
  title,
  url,
  excerpt: "摘要内容",
  summary: "AI 摘要",
  category,
  publishedAt: new Date("2026-08-19T08:00:00Z"),
  fetchedToday: true, // 当天条目，渲染进 finance 面板的"当天" tab
});

test("renderHtml: 基础结构存在性（html/style/script/zh locale）", () => {
  const html = renderHtml(report(), emptyRaw(), "2026-08-19");
  assert.ok(html.includes("<!doctype html>"));
  assert.ok(html.includes("</html>"));
  assert.ok(html.includes("<style>"));
  assert.ok(html.includes("<script"));
  assert.ok(html.includes('lang="zh-CN"'), "zh 默认 locale 应输出 lang=zh-CN");
});

test("renderHtml: 文章卡片渲染关键 CSS class 与文本", () => {
  const raw = emptyRaw();
  raw.finance = [
    {
      id: "news",
      name: "要闻",
      sources: [
        {
          sourceId: "test-src",
          sourceName: "测试源",
          items: [item("https://x/u1", "广州房贷利率下调", "finance")],
        },
      ],
    },
  ];
  const html = renderHtml(report(), raw, "2026-08-19");
  assert.ok(html.includes('class="article"'), "卡片容器 class");
  assert.ok(html.includes('class="article-title"'), "标题 class");
  assert.ok(html.includes("广州房贷利率下调"), "文章标题文本");
  assert.ok(html.includes("https://x/u1"), "文章链接");
  assert.ok(html.includes("AI 摘要"), "摘要文本");
});

test("renderHtml: 空数据兜底不抛错", () => {
  const html = renderHtml(report(), emptyRaw(), "2026-08-19");
  assert.ok(html.includes("</html>"));
});

test("renderHtml: 日期出现在标题", () => {
  const html = renderHtml(report(), emptyRaw(), "2026-08-19");
  assert.ok(html.includes("2026-08-19"));
});

test("renderHtml: CSS class 清单快照（防渲染回归）", () => {
  const raw = emptyRaw();
  raw.finance = [
    {
      id: "news",
      name: "要闻",
      sources: [
        {
          sourceId: "test-src",
          sourceName: "测试源",
          items: [item("https://x/u1", "广州房贷利率下调", "finance")],
        },
      ],
    },
  ];
  const html = renderHtml(report(), raw, "2026-08-19");
  const classes = new Set<string>();
  for (const m of html.matchAll(/class="([^"]+)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c) classes.add(c);
  }
  toMatchSnapshot("render-zh-class-inventory", [...classes].sort().join("\n"));
});

test("renderHtml: 源等级 tier 角标差异化（T6）", () => {
  const raw = emptyRaw();
  raw.finance = [
    {
      id: "news",
      name: "要闻",
      sources: [
        {
          sourceId: "test-src",
          sourceName: "测试源",
          items: [item("https://x/u1", "广州房贷利率下调", "finance")],
        },
      ],
    },
  ];
  // 无 tier → 不渲染角标
  assert.ok(!renderHtml(report(), raw, "2026-08-19").includes("tier-badge"));
  // 带 tier=T1 → 出现角标 class 与中文标签
  raw.finance[0].sources[0].items[0].tier = "T1";
  const html = renderHtml(report(), raw, "2026-08-19");
  assert.ok(html.includes('class="tier-badge tier-T1"'), "应渲染 T1 角标 class");
  assert.ok(html.includes("官方一手"), "应渲染 T1 中文标签");
});

test("技术动态 sub-tab 计数与内容口径一致：只算当天（修复 tab 有数点进去空）", () => {
  // 两个子组触发 sub-tabs 渲染；每组都混入历史缓存条目（fetchedToday=false）
  const subs: SubGroup[] = [
    {
      id: "cn-tech",
      name: "技术动态",
      sources: [
        {
          sourceId: "test-src",
          sourceName: "测试源",
          items: [
            { ...item("https://x/a", "今天的技术新闻", "tech"), fetchedToday: true },
            { ...item("https://x/b", "历史缓存的技术新闻", "tech"), fetchedToday: false },
          ],
        },
      ],
    },
    {
      id: "ai-news",
      name: "AI 动态",
      sources: [
        {
          sourceId: "test-src",
          sourceName: "测试源",
          items: [
            { ...item("https://x/c", "今天 AI 动态", "tech"), fetchedToday: true },
            { ...item("https://x/d", "历史缓存 AI 动态", "tech"), fetchedToday: false },
            { ...item("https://x/e", "历史缓存 AI 动态2", "tech"), fetchedToday: false },
          ],
        },
      ],
    },
  ];
  const html = renderRawCategoryPanel("tech", subs, "2026-08-19");
  // tab 计数应只统计当天：cn-tech=1、ai-news=1（而非全量 2/3）
  assert.ok(html.includes('data-sub="cn-tech" data-cat="tech">技术动态<span class="count">1</span>'), "cn-tech 计数应只算当天 1 条");
  assert.ok(html.includes('data-sub="ai-news" data-cat="tech">AI 动态<span class="count">1</span>'), "ai-news 计数应只算当天 1 条");
  assert.ok(!html.includes('<span class="count">3</span>'), "不应把历史缓存计入 tab 计数");
});
