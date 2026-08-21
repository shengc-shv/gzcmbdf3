/**
 * #33 回归（2026-08-21 三次更新）：全国 cn-wealth/cn-credit/cn-private 业务线报道
 * 移入广州商机(gz)面板。gz 面板合并为单一 gz-all 合并流（「广州能参考的商机」），
 * 面板内仅按「官方政府 / 媒体智库」两类 tab 展现（不再按业务线/本地全国分层）。
 * 锁定：① 渲染契约（finance 不含 cn-*、gz 仅 gz-all）；② LLM 候选清单含三项；
 * ③ 端到端：cn-wealth 文章（移入 gz）渲染进 gz-all 子标签并出现官方/媒体 tab。
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
  tier: "T1" | "T1.5" | "T2" = "T2",
): ArticleInput => ({
  sourceId: "test-src",
  source: "测试源",
  title,
  url,
  excerpt: "摘要内容",
  summary: "AI 摘要",
  category: "finance",
  subcategories: [subcategory],
  tier,
  publishedAt: new Date(`${REPORT_DATE}T08:00:00Z`),
  fetchedToday: true,
});

test("#33 渲染契约：finance 面板不再含 cn-* 三项", () => {
  const order = SUBCATEGORY_ORDER.finance ?? [];
  assert.ok(!order.includes("cn-wealth"), "finance 不应再包含 全国财富");
  assert.ok(!order.includes("cn-credit"), "finance 不应再包含 全国零售信贷");
  assert.ok(!order.includes("cn-private"), "finance 不应再包含 全国私行");
});

test("#33 渲染契约：gz 面板合并为单一 gz-all 合并流", () => {
  const order = SUBCATEGORY_ORDER.gz ?? [];
  assert.deepEqual(order, ["gz-all"], "gz 面板应为单一 gz-all 子标签");
  assert.equal(SUBCATEGORY_LABELS["gz-all"], "广州商机");
});

test("#33 渲染契约：cn-* 标签名保留（全国财富/全国零售信贷/全国私行）", () => {
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

test("#33/#9 端到端：gz-all 文章按广州锚拆分为 广州本地 / 业务启示（2026-08-21 重构单层 tab）", () => {
  const raw = emptyRaw();
  raw.gz = [
    {
      id: "gz-all",
      name: "广州商机",
      sources: [
        {
          sourceId: "_merged",
          sourceName: "广州商机",
          items: [
            finItem("https://x/w1", "全国理财市场规模突破新高", "gz-wealth", "T2"),
            finItem("https://x/g1", "广州市政府发布金融支持政策", "gz-policy", "T1"),
            finItem("https://x/c1", "全国消费贷利率下调", "gz-credit", "T2"),
          ],
          merged: true,
        },
      ],
    },
  ];
  const html = renderHtml(report(), raw, REPORT_DATE);
  // 单层 tab：广州本地 + 业务启示
  assert.ok(html.includes('data-target="p-gz"') && html.includes("广州本地"), "应渲染 广州本地 tab");
  assert.ok(html.includes('data-target="p-biz"') && html.includes("业务启示"), "应渲染 业务启示 tab");
  // 广州锚文章进 广州本地 面板；全国文章进 业务启示 面板
  const gzPanel = html.split('id="p-gz"')[1]?.split('id="p-biz"')[0] ?? "";
  const bizPanel = html.split('id="p-biz"')[1]?.split('id="p-pol"')[0] ?? "";
  assert.ok(gzPanel.includes("广州市政府发布金融支持政策"), "广州锚文章应在 广州本地 面板");
  assert.ok(bizPanel.includes("全国理财市场规模突破新高") && bizPanel.includes("全国消费贷利率下调"), "全国文章应在 业务启示 面板");
});
