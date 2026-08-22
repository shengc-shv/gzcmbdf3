/**
 * 任务二：IPO 板块合并去重 + 按上市阶段拆分（任务二 #42）
 * 覆盖：inferStage 阶段推断 / GZ_CONDUCTION_RULES 去 gz-ipo 冗余 / i18n 阶段标签 /
 * groupRaw 对 gd-ipo 按阶段归桶（不再按交易所分栏）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { inferStage } from "../lib/classify/gdIpo";
import { conductToGzSubs, groupRaw } from "../lib/output/render";
import { renderRawCategoryPanel } from "../lib/output/render/cards";
import { SUBCATEGORY_ORDER, SUBCATEGORY_LABELS } from "../lib/output/render/i18n";
import { loadAllSources } from "../lib/sources/registry";
import type { ArticleInput } from "../lib/types";

const base = (over: Partial<ArticleInput> & { stockCode?: string }): ArticleInput => ({
  sourceId: "gd-sse",
  source: "上交所",
  title: "t",
  url: "https://example.com/x",
  category: "gd-ipo",
  publishedAt: new Date(),
  ...over,
} as ArticleInput);

test("inferStage: 已上市·新股", () => {
  assert.equal(inferStage("XX 公司在深交所挂牌上市"), "stage-listed");
  assert.equal(inferStage("XX 新股上市 发行结果公告"), "stage-listed");
  assert.equal(inferStage("XX 中签结果出炉"), "stage-listed");
});

test("inferStage: 注册生效·过会", () => {
  assert.equal(inferStage("XX 注册生效 即将发行"), "stage-registered");
  assert.equal(inferStage("XX IPO 过会"), "stage-registered");
  assert.equal(inferStage("XX 同意注册"), "stage-registered");
});

test("inferStage: 在审·已受理", () => {
  assert.equal(inferStage("XX IPO 已受理"), "stage-reviewing");
  assert.equal(inferStage("XX 进入问询阶段"), "stage-reviewing");
  assert.equal(inferStage("XX 上会审议"), "stage-reviewing");
});

test("inferStage: 辅导备案·Pre-IPO", () => {
  assert.equal(inferStage("XX 辅导备案 接受上市辅导"), "stage-tutoring");
  assert.equal(inferStage("XX IPO辅导协议签署"), "stage-tutoring");
  // 兜底：仅含裸 IPO 无阶段词 → Pre-IPO
  assert.equal(inferStage("XX 启动 IPO"), "stage-tutoring");
});

test("inferStage: 未上市信号优先于裸上市（避免'即将上市'误判已上市）", () => {
  assert.equal(inferStage("XX 注册生效 即将上市"), "stage-registered");
  assert.equal(inferStage("XX 过会 拟上市"), "stage-registered");
});

test("GZ_CONDUCTION_RULES 去冗余：finance 的 IPO 词不再传导 gz-ipo", () => {
  const subs = conductToGzSubs("证监会发布 IPO 新规 多家企业上市");
  assert.ok(!subs.includes("gz-ipo"), `不应含 gz-ipo，实际: ${subs.join(",")}`);
  // 财富/信贷等业务线传导仍正常
  assert.ok(conductToGzSubs("广州公积金贷款新政").includes("gz-credit"));
  assert.ok(conductToGzSubs("广州理财市场升温").includes("gz-wealth"));
});

test("i18n: gd-ipo 子标签顺序为上市阶段 + gz 不含 gz-ipo", () => {
  assert.deepEqual(SUBCATEGORY_ORDER["gd-ipo"], [
    "stage-listed",
    "stage-registered",
    "stage-reviewing",
    "stage-tutoring",
  ]);
  assert.equal(SUBCATEGORY_LABELS["stage-listed"], "已上市·新股");
  assert.equal(SUBCATEGORY_LABELS["stage-registered"], "注册生效·过会");
  assert.equal(SUBCATEGORY_LABELS["stage-reviewing"], "在审·已受理");
  assert.equal(SUBCATEGORY_LABELS["stage-tutoring"], "辅导备案·Pre-IPO");
  // gz 商机面板不再含 gz-ipo 子标签
  assert.ok(!(SUBCATEGORY_ORDER["gz"] ?? []).includes("gz-ipo"));
});

test("groupRaw: gd-ipo 按上市阶段归桶（不再按交易所分栏）", () => {
  const registry = loadAllSources();
  const articles: ArticleInput[] = [
    base({ title: "广东某科技企业挂牌上市", sourceId: "gd-sse", category: "gd-ipo", stockCode: "300001" }),
    base({ title: "广东某公司注册生效 即将发行", sourceId: "gd-szse", category: "gd-ipo", stockCode: "000001" }),
    base({ title: "广东某企业IPO已受理", sourceId: "gd-bse", category: "gd-ipo", stockCode: "830001" }),
    base({ title: "广东某公司辅导备案", sourceId: "gd-em-ipo", category: "gd-ipo" }),
  ];
  const raw = groupRaw(articles, registry);
  const gd = raw["gd-ipo"].map((s) => s.id);
  for (const stage of ["stage-listed", "stage-registered", "stage-reviewing", "stage-tutoring"]) {
    assert.ok(gd.includes(stage), `应含 ${stage}，实际: ${gd.join(",")}`);
  }
  // 不应再按交易所来源分栏
  assert.ok(
    !gd.includes("sse") && !gd.includes("szse") && !gd.includes("ipo-tutoring"),
    `不应含交易所子标签，实际: ${gd.join(",")}`,
  );
  // 每个阶段至少命中 1 条（归桶正确）
  const listed = raw["gd-ipo"].find((s) => s.id === "stage-listed");
  assert.ok(listed && listed.sources[0].items.length >= 1);
});

test("renderRawCategoryPanel: gd-ipo 阶段栏渲染含标签 + 股份行广州分行商机线索", () => {
  const registry = loadAllSources();
  const articles: ArticleInput[] = [
    base({ title: "广东某科技企业挂牌上市", sourceId: "gd-sse", category: "gd-ipo", stockCode: "300001" }),
    base({ title: "广东某公司注册生效 即将发行", sourceId: "gd-szse", category: "gd-ipo", stockCode: "000001" }),
    base({ title: "广东某企业IPO已受理", sourceId: "gd-bse", category: "gd-ipo", stockCode: "830001" }),
    base({ title: "广东某公司辅导备案", sourceId: "gd-em-ipo", category: "gd-ipo" }),
  ];
  const raw = groupRaw(articles, registry);
  const html = renderRawCategoryPanel("gd-ipo", raw["gd-ipo"], "2026-08-21");
  assert.ok(html.includes("已上市·新股"));
  assert.ok(html.includes("注册生效·过会"));
  assert.ok(html.includes("在审·已受理"));
  assert.ok(html.includes("辅导备案·Pre-IPO"));
  // 各阶段栏顶部注入股份行广州分行商机线索提示
  assert.ok(html.includes("商机线索"), "应注入股份行广州分行商机线索提示");
  assert.ok(html.includes('class="biz-tip"'), "应渲染 biz-tip 样式容器");
});
