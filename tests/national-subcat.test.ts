/**
 * #33 回归：新增全国 cn-wealth / cn-credit / cn-private 子标签（宏观政策 finance 面板）。
 * 锁定三件事：① 渲染契约（SUBCATEGORY_ORDER + LABELS）；② LLM 候选清单包含三项；
 * ③ 端到端：带 subcategory=cn-wealth 的 finance 文章渲染进「全国财富」子标签。
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

test("#33 渲染契约：finance 子标签顺序含全国三项，且位于 cn-policy 之后、cn-finance 之前", () => {
  const order = SUBCATEGORY_ORDER.finance ?? [];
  assert.ok(order.includes("cn-wealth"), "应包含 全国财富");
  assert.ok(order.includes("cn-credit"), "应包含 全国零售信贷");
  assert.ok(order.includes("cn-private"), "应包含 全国私行");
  // 顺序：cn-policy < cn-wealth < cn-credit < cn-private < cn-finance
  const pos = (s: string) => order.indexOf(s);
  assert.ok(pos("cn-policy") < pos("cn-wealth"), "cn-policy 应在 全国财富 之前");
  assert.ok(pos("cn-wealth") < pos("cn-credit"));
  assert.ok(pos("cn-credit") < pos("cn-private"));
  assert.ok(pos("cn-private") < pos("cn-finance"), "cn-private 应在 国内财经(综合) 之前");
});

test("#33 渲染契约：三项均有中文标签", () => {
  assert.equal(SUBCATEGORY_LABELS["cn-wealth"], "全国财富");
  assert.equal(SUBCATEGORY_LABELS["cn-credit"], "全国零售信贷");
  assert.equal(SUBCATEGORY_LABELS["cn-private"], "全国私行");
});

test("#33 LLM 候选清单：RULES 含全国三项业务线标签 + 更新口诀", () => {
  assert.ok(RULES.includes("cn-wealth"), "LLM 候选应包含 全国财富");
  assert.ok(RULES.includes("cn-credit"), "LLM 候选应包含 全国零售信贷");
  assert.ok(RULES.includes("cn-private"), "LLM 候选应包含 全国私行");
  // 口诀应改为「按业务线细分归 cn-wealth/cn-credit/cn-private」，不再「一律 cn-finance」
  assert.ok(
    RULES.includes("cn-wealth/cn-credit/cn-private"),
    "口诀应引导全国性报道按业务线细分",
  );
  assert.ok(
    !RULES.includes("全国性报道一律 cn-finance/news/cn-policy"),
    "旧口诀（一律 cn-finance）应已移除",
  );
});

test("#33 端到端：finance 文章按 subcategory=cn-wealth 渲染进「全国财富」子标签", () => {
  const raw = emptyRaw();
  raw.finance = [
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
  // 子标签导航应出现 全国财富 的 data-sub
  assert.ok(
    html.includes('data-sub="cn-wealth"') || html.includes('data-sub-content="cn-wealth"'),
    "应渲染 全国财富 子标签",
  );
  assert.ok(html.includes("全国财富"), "子标签应显示中文名 全国财富");
  assert.ok(html.includes("全国理财市场规模突破新高"), "该文章应出现在 全国财富 子标签内");
});

test("#33 端到端：cn-credit / cn-private 子标签同样渲染", () => {
  const raw = emptyRaw();
  raw.finance = [
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
