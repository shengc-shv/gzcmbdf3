/**
 * #33 回归（2026-08-21 二次更新）：全国 cn-wealth/cn-credit/cn-private 业务线报道
 * 从宏观政策(finance)面板移入广州商机(gz)面板，groupRaw 映射回业务线子标签
 * （cn-wealth→gz-wealth 等）并置 region="cn"；渲染层在业务线子标签内拆「本地/全国」tab。
 * 锁定：① 渲染契约（finance 不含 cn-*、gz 仅 4 业务线）；② LLM 候选清单含三项；
 * ③ 端到端：cn-wealth 文章（region=cn）渲染进 gz 面板「财富业务」子标签的全国 tab。
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
  region?: "gz" | "cn",
): ArticleInput => ({
  sourceId: "test-src",
  source: "测试源",
  title,
  url,
  excerpt: "摘要内容",
  summary: "AI 摘要",
  category: "finance",
  subcategories: [subcategory],
  region,
  publishedAt: new Date(`${REPORT_DATE}T08:00:00Z`),
  fetchedToday: true,
});

test("#33 渲染契约：finance 面板不再含 cn-* 三项", () => {
  const order = SUBCATEGORY_ORDER.finance ?? [];
  assert.ok(!order.includes("cn-wealth"), "finance 不应再包含 全国财富");
  assert.ok(!order.includes("cn-credit"), "finance 不应再包含 全国零售信贷");
  assert.ok(!order.includes("cn-private"), "finance 不应再包含 全国私行");
});

test("#33 渲染契约：gz 面板恢复 4 个业务线子标签（不含 cn-* 平铺）", () => {
  const order = SUBCATEGORY_ORDER.gz ?? [];
  assert.deepEqual(order, ["gz-wealth", "gz-credit", "gz-customer", "gz-private"]);
  assert.ok(!order.includes("cn-wealth"), "gz 不应平铺 全国财富");
  assert.ok(!order.includes("cn-credit"), "gz 不应平铺 全国零售信贷");
  assert.ok(!order.includes("cn-private"), "gz 不应平铺 全国私行");
});

test("#33 渲染契约：业务线标签名（财富业务/个人信贷/零售客群/私行业务）", () => {
  assert.equal(SUBCATEGORY_LABELS["gz-wealth"], "财富业务");
  assert.equal(SUBCATEGORY_LABELS["gz-credit"], "个人信贷");
  assert.equal(SUBCATEGORY_LABELS["gz-customer"], "零售客群");
  assert.equal(SUBCATEGORY_LABELS["gz-private"], "私行业务");
  assert.equal(SUBCATEGORY_LABELS["cn-wealth"], "全国财富");
  assert.equal(SUBCATEGORY_LABELS["cn-credit"], "全国零售信贷");
  assert.equal(SUBCATEGORY_LABELS["cn-private"], "全国私行");
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

test("#33 端到端：cn-wealth 文章（region=cn）渲染进 gz「财富业务」子标签的全国 tab", () => {
  const raw = emptyRaw();
  raw.gz = [
    {
      id: "gz-wealth",
      name: "财富业务",
      sources: [
        {
          sourceId: "_merged",
          sourceName: "财富业务",
          items: [
            finItem("https://x/w1", "全国理财市场规模突破新高", "gz-wealth", "cn"),
            finItem("https://x/w2", "广州银行理财代销数据", "gz-wealth"),
          ],
          merged: true,
        },
      ],
    },
  ];
  const html = renderHtml(report(), raw, REPORT_DATE);
  assert.ok(
    html.includes('data-sub="gz-wealth"') || html.includes('data-sub-content="gz-wealth"'),
    "应渲染 财富业务 子标签",
  );
  assert.ok(html.includes("财富业务"), "子标签应显示中文名 财富业务");
  // 业务线子标签内应有 本地/全国 tab
  assert.ok(html.includes("本地") && html.includes("全国"), "应渲染 本地/全国 tab");
  assert.ok(html.includes('data-band="local"') && html.includes('data-band="national"'), "tab data-band");
  // 全国 tab 默认不激活（本地优先），本地 tab 默认 active
  assert.ok(
    html.includes('class="band-panel active" data-band-panel="local"'),
    "本地 tab 默认 active（分行视角优先）",
  );
});

test("#33 端到端：cn-credit / cn-private 映射进 个人信贷 / 私行业务 子标签", () => {
  const raw = emptyRaw();
  raw.gz = [
    {
      id: "gz-credit",
      name: "个人信贷",
      sources: [
        {
          sourceId: "_merged",
          sourceName: "个人信贷",
          items: [finItem("https://x/c1", "全国消费贷利率下调", "gz-credit", "cn")],
          merged: true,
        },
      ],
    },
    {
      id: "gz-private",
      name: "私行业务",
      sources: [
        {
          sourceId: "_merged",
          sourceName: "私行业务",
          items: [finItem("https://x/p1", "全国家族信托规模增长", "gz-private", "cn")],
          merged: true,
        },
      ],
    },
  ];
  const html = renderHtml(report(), raw, REPORT_DATE);
  assert.ok(html.includes("个人信贷"), "应渲染 个人信贷 标签");
  assert.ok(html.includes("私行业务"), "应渲染 私行业务 标签");
  assert.ok(html.includes("全国消费贷利率下调"), "全国信贷内容在 个人信贷 子标签内");
  assert.ok(html.includes("全国家族信托规模增长"), "全国私行内容在 私行业务 子标签内");
});
