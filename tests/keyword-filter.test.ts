/**
 * 关键词漏斗（lib/filters/keyword-filter.ts）单测。
 * 使用真实配置 sources.keywords.json（银行零售业务关键词体系 v4）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadKeywordConfig } from "../lib/filters/config";
import { applyKeywordFilter } from "../lib/filters/keyword-filter";
import type { RawArticleInput } from "../lib/filters/types";

const cfg = loadKeywordConfig();

const art = (title: string, content = ""): RawArticleInput => ({
  title,
  content,
  sourceId: "test-src",
  url: "https://x/" + encodeURIComponent(title),
});

test("L0 硬排除：标题含全局排除词直接丢弃（负向优先）", () => {
  const r = applyKeywordFilter(art("A股今日涨停，沪指报3400点"), cfg);
  assert.equal(r.pass, false);
  assert.equal(r.bucket, "dropped");
  assert.ok(r.matched.length > 0, "应记录命中的排除词");
});

test("L0 硬排除：非金融干扰词（招聘）同样丢弃", () => {
  assert.equal(applyKeywordFilter(art("某公司招聘500人"), cfg).pass, false);
});

test("geo+维度：广州房贷利率下调 → 个人信贷命中（多维度 all_hit）", () => {
  const r = applyKeywordFilter(art("广州房贷利率下调，首付比例调整"), cfg);
  assert.equal(r.pass, true);
  assert.equal(r.bucket, "daily");
  assert.ok(r.dimensions.includes("personal_credit"), "应命中个人信贷");
});

test("weak 共现：消费贷款命中个人信贷；纯弱词无共现不命中", () => {
  const hit = applyKeywordFilter(art("广州消费贷款利率优惠"), cfg);
  assert.equal(hit.pass, true);
  assert.ok(hit.dimensions.includes("personal_credit"));

  const miss = applyKeywordFilter(art("信贷规模持续增长"), cfg);
  assert.equal(miss.pass, false, "无共现词的弱词不应命中");
  assert.ok(!miss.dimensions.includes("personal_credit"));
});

test("商机S：上市辅导备案 → listing_pipeline（需地域命中 geo_lock）", () => {
  const r = applyKeywordFilter(art("广州某企业启动上市辅导备案"), cfg);
  assert.equal(r.pass, true);
  assert.equal(r.bucket, "opportunity");
  assert.equal(r.opportunities?.[0]?.tracker, "listing_pipeline");
  assert.equal(r.opportunities?.[0]?.priority, "S");
});

test("商机A：落户广州设立研发中心 → branch_expansion；北京被 exclude_if_in_title 排除", () => {
  const hit = applyKeywordFilter(art("某企业落户广州设立研发中心扩编500人"), cfg);
  assert.equal(hit.bucket, "opportunity");
  assert.equal(hit.opportunities?.[0]?.tracker, "branch_expansion");

  const skip = applyKeywordFilter(art("某企业落户北京设立研发中心扩编500人"), cfg);
  assert.equal(skip.pass, false, "标题含北京应被排除");
});

test("周报池：私行维度命中 → weekly bucket", () => {
  const r = applyKeywordFilter(art("高净值客户家族信托需求增长"), cfg);
  assert.equal(r.bucket, "weekly");
  assert.ok(r.dimensions.includes("private_banking"));
});

test("多商机：一条信息同时命中 listing_pipeline 与 funding_milestones", () => {
  const r = applyKeywordFilter(art("广州某企业启动上市辅导备案并完成B轮融资"), cfg);
  assert.equal(r.bucket, "opportunity");
  const trackers = (r.opportunities ?? []).map((o) => o.tracker);
  assert.ok(trackers.includes("listing_pipeline"), "应收录上市进程商机");
  assert.ok(trackers.includes("funding_milestones"), "应收录融资里程碑商机");
  assert.equal(r.opportunities?.[0]?.priority, "S", "优先级 S 应排在最前");
});

test("硬过滤：与银行零售无关内容不通过", () => {
  const r = applyKeywordFilter(art("某科技公司发布新款手机"), cfg);
  assert.equal(r.pass, false);
  assert.equal(r.bucket, "dropped");
});

// —— 参考区豁免（2026-08-19 修复：tech/ipo/gd-ipo/politics 不过银行零售漏斗）——
test("参考区豁免：tech 技术动态不过漏斗，直接放行", () => {
  const r = applyKeywordFilter({ ...art("OpenAI 发布 GPT-5，多模态能力大幅提升"), category: "tech" }, cfg);
  assert.equal(r.pass, true, "参考区条目应放行");
  assert.notEqual(r.bucket, "dropped");
});

test("参考区豁免：L0 全局排除词对参考区不生效（仅银行零售线适用）", () => {
  const r = applyKeywordFilter({ ...art("A股涨停，沪指报3400点"), category: "tech" }, cfg);
  assert.equal(r.pass, true, "tech 参考区不受 L0 排除词约束");
});

test("参考区豁免：tech 条目仍可触发商机追踪器", () => {
  const r = applyKeywordFilter({ ...art("广州某 AI 公司完成B轮融资"), category: "tech" }, cfg);
  assert.equal(r.pass, true);
  assert.equal(r.bucket, "opportunity");
  const trackers = (r.opportunities ?? []).map((o) => o.tracker);
  assert.ok(trackers.includes("funding_milestones"), "tech 参考区里的融资新闻应进商机池");
});

test("参考区豁免：ipo/gd-ipo/politics 同样放行", () => {
  for (const category of ["ipo", "gd-ipo", "politics"]) {
    const r = applyKeywordFilter(
      { ...art(`[${category}] 常规参考区内容示例`), category },
      cfg,
    );
    assert.equal(r.pass, true, `${category} 参考区应放行`);
  }
});

test("参考区豁免：finance/gz 仍走完整漏斗（银行零售主战场）", () => {
  for (const category of ["finance", "gz"]) {
    const r = applyKeywordFilter(
      { ...art("某科技公司发布新款手机"), category },
      cfg,
    );
    assert.equal(r.pass, false, `${category} 应仍被银行零售漏斗硬过滤`);
  }
});
