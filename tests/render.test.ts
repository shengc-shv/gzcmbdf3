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

test("技术动态 sub-tab 计数与内容口径一致：只算最近 3 天（统一展示窗口）", () => {
  // 两个子组触发 sub-tabs 渲染；每组混入 3 天前的旧条目（超窗口，不计入）
  const now = new Date();
  const oldDate = new Date(now.getTime() - 5 * 86_400_000).toISOString();
  const subs: SubGroup[] = [
    {
      id: "cn-tech",
      name: "技术动态",
      sources: [
        {
          sourceId: "test-src",
          sourceName: "测试源",
          items: [
            { ...item("https://x/a", "今天的技术新闻", "tech"), publishedAt: now },
            { ...item("https://x/b", "5天前的技术新闻", "tech"), publishedAt: new Date(oldDate) },
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
            { ...item("https://x/c", "今天 AI 动态", "tech"), publishedAt: now },
            { ...item("https://x/d", "5天前 AI 动态", "tech"), publishedAt: new Date(oldDate) },
            { ...item("https://x/e", "5天前 AI 动态2", "tech"), publishedAt: new Date(oldDate) },
          ],
        },
      ],
    },
  ];
  const html = renderRawCategoryPanel("tech", subs, "2026-08-19");
  // 计数应只统计最近 3 天：cn-tech=1、ai-news=1（而非全量 2/3）
  assert.ok(html.includes('data-sub="cn-tech" data-cat="tech">技术动态<span class="count">1</span>'), "cn-tech 计数应只算最近 3 天 1 条");
  assert.ok(html.includes('data-sub="ai-news" data-cat="tech">AI 动态<span class="count">1</span>'), "ai-news 计数应只算最近 3 天 1 条");
  assert.ok(!html.includes('<span class="count">3</span>'), "不应把超窗口条目计入 tab 计数");
});

test("财经面板「国家政策」sub-tab 计数同口径：只算最近 3 天", () => {
  // 用户场景：finance 面板 cn-policy 子组，2 条超窗口旧文 + 1 条 3 天内
  const now = new Date();
  const oldDate = new Date(now.getTime() - 5 * 86_400_000).toISOString();
  const subs: SubGroup[] = [
    {
      id: "cn-policy",
      name: "国家政策",
      sources: [
        {
          sourceId: "test-src",
          sourceName: "测试源",
          items: [
            { ...item("https://x/p1", "最近的宏观政策", "finance"), publishedAt: now },
            { ...item("https://x/p2", "5天前宏观政策1", "finance"), publishedAt: new Date(oldDate) },
            { ...item("https://x/p3", "5天前宏观政策2", "finance"), publishedAt: new Date(oldDate) },
          ],
        },
      ],
    },
    {
      id: "news",
      name: "要闻",
      sources: [
        {
          sourceId: "test-src",
          sourceName: "测试源",
          items: [{ ...item("https://x/n1", "最近要闻", "finance"), publishedAt: now }],
        },
      ],
    },
  ];
  const html = renderRawCategoryPanel("finance", subs, "2026-08-19");
  // cn-policy 计数应为最近 3 天 1 条（而非全量 3 条）
  assert.ok(html.includes('data-sub="cn-policy" data-cat="finance">国家政策<span class="count">1</span>'), "cn-policy 计数应只算最近 3 天 1 条");
  assert.ok(!html.includes('<span class="count">3</span>'), "不应把超窗口条目计入 cn-policy 计数");
});
