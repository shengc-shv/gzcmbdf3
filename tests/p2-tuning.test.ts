/**
 * P2 调词优化回归测试（不动数据源，仅调关键词体系 / 分类 prompt）。
 * - #37 retail_ops 补团体金融词
 * - #39 新增 retail_digital 维度（仅零售渠道经营视角，排除 IT 词）
 * - #40 item-classifier RULES 加「利率敏感型国际宏观 → relevant=true」
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadKeywordConfig } from "../lib/filters/config";
import { applyKeywordFilter } from "../lib/filters/keyword-filter";
import { RULES } from "../lib/ai/item-classifier";
import type { RawArticleInput } from "../lib/filters/types";

const cfg = loadKeywordConfig();

const art = (title: string, content = ""): RawArticleInput => ({
  title,
  content,
  sourceId: "test-src",
  url: "https://x/" + encodeURIComponent(title),
});

test("#37 团体金融：企业年金/团办卡/批量开卡 命中 retail_ops 维度", () => {
  const r = applyKeywordFilter(art("某国企企业年金团办卡批量开卡服务上线"), cfg);
  assert.equal(r.pass, true, "无 L0 命中，应放行");
  assert.ok(r.dimensions.includes("retail_ops"), "应命中 零售基础客群(retail_ops) 维度");
});

test("#37 团体金融：薪资代发/员工福利 命中 retail_ops", () => {
  const r = applyKeywordFilter(art("银行薪资代发与员工福利批量开卡落地"), cfg);
  assert.ok(r.dimensions.includes("retail_ops"), "薪资代发/员工福利应命中 retail_ops");
});

test("#39 零售数字化：手机银行/数字人民币/远程银行/线上获客 命中 retail_digital", () => {
  const r = applyKeywordFilter(
    art("手机银行数字人民币远程银行线上获客能力升级"),
    cfg,
  );
  assert.equal(r.pass, true);
  assert.ok(r.dimensions.includes("retail_digital"), "应命中 零售数字化 维度");
});

test("#39 零售数字化 exclude：IT 中台/信创/DevOps 不归 retail_digital", () => {
  const r = applyKeywordFilter(art("银行数据中台DevOps核心系统信创改造"), cfg);
  assert.equal(r.pass, true, "L0 不拦 IT 词，宏观财经参考保留");
  assert.ok(
    !r.dimensions.includes("retail_digital"),
    "含 exclude 词(数据中台/DevOps/核心系统)不应判零售数字化",
  );
});

test("#40 国际宏观利率敏感规则进入 item-classifier RULES", () => {
  assert.ok(RULES.includes("国际宏观"), "RULES 应含国际宏观特别规则段");
  assert.ok(RULES.includes("美联储"), "应明确点名 美联储 为利率敏感信号");
  assert.ok(RULES.includes("relevant=true"), "应规定利率敏感型国际宏观判 relevant=true");
});

test("#40 国际宏观误杀修复：美联储/美债 类标题应被明示为相关（文案约束）", () => {
  // 验证 RULES 要求该类信息 relevant=true 且 subcategories 含 news
  assert.ok(
    RULES.includes("subcategories 含 news") || RULES.includes("含 news"),
    "应要求利率敏感型国际宏观归 news 标签且 relevant=true",
  );
});
