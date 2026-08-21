/**
 * #33 回归（2026-08-21 更新）：全国 cn-wealth / cn-credit / cn-private 子标签
 * 从宏观政策(finance)面板移入广州商机(gz)面板，与 gz-* 广州业务线成对区分全国/广州。
 * 锁定：① 渲染契约（SUBCATEGORY_ORDER + LABELS：finance 不含 cn-*、gz 含 cn-* 且成对）；
 * ② LLM 候选清单包含三项；③ 端到端：cn-wealth 文章渲染进 gz 面板的「全国财富」子标签。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHtml, type RawByCategory } from "../lib/output/render";
import { SUBCATEGORY_ORDER, SUBCATEGORY_LABELS } from "../lib/output/render/i18n";
import { RULES } from "../lib/ai/item-classifier";
import type { DailyReport, ArticleInput } from "../lib/types";

const REPORT_DATE = "2026-08-19";

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

const finItem = (
  url: string,
  title: string,
  subcategory: string,
): ArticleInput => ({
  sourceId: "test-src",
  source: "测试源",
  title,
  url,
  excerpt: "摘要内容",
  summary: "AI 摘要",
  category: "finance",
  subcategories: [subcategory],
  publishedAt: new Date(`${REPORT_DATE}T08:00:00Z`),
  fetchedToday: true,
});

test("#33 渲染契约：finance 面板不再含 cn-* 三项", () => {
  const order = SUBCATEGORY_ORDER.finance ?? [];
  assert.ok(!order.includes("cn-wealth"), "finance 不应再包含 全国财富");
  assert.ok(!order.includes("cn-credit"), "finance 不应再包含 全国零售信贷");
  assert.ok(!order.includes("cn-private"), "finance 不应再包含 全国私行");
});

test("#33 渲染契约：gz 面板含 cn-* 三项，且与 gz-* 成对（广州在前、全国在后）", () => {
  const order = SUBCATEGORY_ORDER.gz ?? [];
  assert.ok(order.includes("cn-wealth"), "gz 应包含 全国财富");
  assert.ok(order.includes("cn-credit"), "gz 应包含 全国零售信贷");
  assert.ok(order.includes("cn-private"), "gz 应包含 全国私行");
  const pos = (s: string) => order.indexOf(s);
  assert.ok(pos("gz-wealth") < pos("cn-wealth"), "广州财富 应在 全国财富 之前");
  assert.ok(pos("gz-credit") < pos("cn-credit"), "广州个人信贷 应在 全国零售信贷 之前");
  assert.ok(pos("gz-private") < pos("cn-private"), "广州私行 应在 全国私行 之前");
});

test("#33 渲染契约：全国/广州标签名区分", () => {
  assert.equal(SUBCATEGORY_LABELS["cn-wealth"], "全国财富");
  assert.equal(SUBCATEGORY_LABELS["cn-credit"], "全国零售信贷");
  assert.equal(SUBCATEGORY_LABELS["cn-private"], "全国私行");
  assert.equal(SUBCATEGORY_LABELS["gz-wealth"], "广州财富");
  assert.equal(SUBCATEGORY_LABELS["gz-credit"], "广州个人信贷");
  assert.equal(SUBCATEGORY_LABELS["gz-private"], "广州私行");
});

test("#33 LLM 候选清单：RULES 含全国三项业务线标签 + 更新口诀", () => {
  assert.ok(RULES.includes("cn-wealth"), "LLM 候选应包含 全国财富");
  assert.ok(RULES.includes("cn-credit"), "LLM 候选应包含 全国零售信贷");
  assert.ok(RULES.includes("cn-private"), "LLM 候选应包含 全国私行");
  assert.ok(
    RULES.includes("cn-wealth/cn-credit/cn-private"),
    "口诀应引导全国性报道按业务线细分",
  );
  assert.ok(
    !RULES.includes("全国性报道一律 cn-finance/news/cn-policy"),
    "旧口诀（一律 cn-finance）应已移除",
  );
});

test("#33 端到端：cn-wealth 文章渲染进 gz 面板的「全国财富」子标签", () => {
  const raw = emptyRaw();
  raw.gz = [
    {
      id: "cn-wealth",
      name: "全国财富",
      sources: [
        {
          sourceId: "_merged",
          sourceName: "全国财富",
          items: [finItem("https://x/w1", "全国理财市场规模突破新高", "cn-wealth")],
          merged: true,
        },
      ],
    },
  ];
  const html = renderHtml(report(), raw, REPORT_DATE);
  assert.ok(
    html.includes('data-sub="cn-wealth"') || html.includes('data-sub-content="cn-wealth"'),
    "应渲染 全国财富 子标签",
  );
  assert.ok(html.includes("全国财富"), "子标签应显示中文名 全国财富");
  assert.ok(html.includes("全国理财市场规模突破新高"), "该文章应出现在 全国财富 子标签内");
});

test("#33 端到端：cn-credit / cn-private 子标签同样渲染", () => {
  const raw = emptyRaw();
  raw.gz = [
    {
      id: "cn-credit",
      name: "全国零售信贷",
      sources: [
        {
          sourceId: "_merged",
          sourceName: "全国零售信贷",
          items: [finItem("https://x/c1", "全国消费贷利率下调", "cn-credit")],
          merged: true,
        },
      ],
    },
    {
      id: "cn-private",
      name: "全国私行",
      sources: [
        {
          sourceId: "_merged",
          sourceName: "全国私行",
          items: [finItem("https://x/p1", "全国家族信托规模增长", "cn-private")],
          merged: true,
        },
      ],
    },
  ];
  const html = renderHtml(report(), raw, REPORT_DATE);
  assert.ok(html.includes("全国零售信贷"), "应渲染 全国零售信贷 标签");
  assert.ok(html.includes("全国私行"), "应渲染 全国私行 标签");
});
