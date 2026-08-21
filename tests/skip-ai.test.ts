/**
 * skipAiRunner（SKIP_AI 确定性降级 runner）功能测试。
 * 用真实 buildPass1User / buildPass2User 提示验证：
 *  - PASS1 提示是裸文章数组（含 category 无 section）→ 全部 keep 并按 category 归板块
 *  - PASS2 提示是裸保留条目数组（含 section + raw_text）→ sections 非空
 *  - summary 优先取预填缓存，否则取 raw_text 前 90 字
 * 回归保护：早期实现用 parsed.items 读取，但提示是裸数组 → 解析为 0 条 → 空报告（页面空白）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { makeSkipAiRunner } from "../lib/ai/pipeline";
import {
  buildPass1User,
  buildPass2User,
  PASS1_SYSTEM,
  PASS2_SYSTEM,
} from "../lib/ai/prompts";
import { extractJson } from "../lib/ai/json-util";

const pass1Articles = [
  { url: "https://a/1", title: "广州房贷利率下调", source: "广州市政府", date: "08/21", raw_text: "广州出台房贷新政", category: "gz" },
  { url: "https://a/2", title: "央行宣布降准", source: "央行", date: "08/21", raw_text: "央行宣布降准0.5个百分点", category: "finance" },
  { url: "https://a/3", title: "AI 芯片突破", source: "媒体", date: "08/21", raw_text: "国产 AI 芯片量产", category: "tech" },
  { url: "https://a/4", title: "某司 IPO 过会", source: "交易所", date: "08/21", raw_text: "某公司在深交所过会", category: "ipo" },
];

const pass2Items = [
  { url: "https://a/1", title_cn: "广州房贷利率下调", title_orig: "", source: "广州市政府", source_type: "official", date: "08/21", tags: [], locale: "national", locale_evidence: "", section: "biz_insight", raw_text: "广州出台房贷新政，首套利率降至3.2%。" },
  { url: "https://a/2", title_cn: "央行宣布降准", title_orig: "", source: "央行", source_type: "official", date: "08/21", tags: [], locale: "national", locale_evidence: "", section: "policy_market", raw_text: "央行宣布降准0.5个百分点，释放长期资金约1万亿元。" },
];

test("PASS1: 裸数组提示被正确解析为全 keep 并按 category 归板块", async () => {
  const runner = makeSkipAiRunner();
  const out: any = JSON.parse(await runner(PASS1_SYSTEM, buildPass1User(JSON.stringify(pass1Articles))));
  assert.ok(Array.isArray(out.items) && out.items.length === 4, "应解析出 4 条（裸数组不再是 0）");
  const byUrl = new Map<string, any>(out.items.map((i: any) => [i.url, i] as [string, any]));
  assert.equal(byUrl.get("https://a/1").keep, true);
  assert.equal(byUrl.get("https://a/1").section, "biz_insight"); // gz 保守归业务启示
  assert.equal(byUrl.get("https://a/2").section, "policy_market");
  assert.equal(byUrl.get("https://a/3").section, "tech");
  assert.equal(byUrl.get("https://a/4").section, "ipo");
});

test("PASS1: gz_hint 条目 → 广州本地板块 + locale=gz（提权生效）", async () => {
  const runner = makeSkipAiRunner();
  const gzHintArticles = [
    { url: "https://dayoo/1", title: "琶洲算法大赛上线", source: "广州日报·大洋网", date: "08/21", raw_text: "琶洲算法大赛今日开幕", category: "gz", gz_hint: true },
    { url: "https://southcn/2", title: "前7月广东规上工业增加值同比增长5.7%", source: "南方网", date: "08/21", raw_text: "广东工业数据", category: "gz" },
  ];
  const out: any = JSON.parse(await runner(PASS1_SYSTEM, buildPass1User(JSON.stringify(gzHintArticles))));
  const byUrl = new Map<string, any>(out.items.map((i: any) => [i.url, i] as [string, any]));
  assert.equal(byUrl.get("https://dayoo/1").section, "gz_local", "gz_hint → 广州本地");
  assert.equal(byUrl.get("https://dayoo/1").locale, "gz", "gz_hint → locale=gz");
  assert.equal(byUrl.get("https://southcn/2").section, "biz_insight", "无 gz_hint → gz 保守归业务启示");
  assert.equal(byUrl.get("https://southcn/2").locale, "national");
});

test("PASS2: 裸数组提示产出非空 sections，summary 取 raw_text 前 90 字", async () => {
  const runner = makeSkipAiRunner();
  const out: any = JSON.parse(await runner(PASS2_SYSTEM, buildPass2User(JSON.stringify(pass2Items), "")));
  assert.equal(out.sections.biz_insight.length, 1);
  assert.equal(out.sections.policy_market.length, 1);
  assert.equal(out.sections.biz_insight[0].summary, "广州出台房贷新政，首套利率降至3.2%。".slice(0, 90));
  assert.equal(out.sections.policy_market[0].summary, "央行宣布降准0.5个百分点，释放长期资金约1万亿元。".slice(0, 90));
  assert.equal(out.sections.biz_insight[0].importance, 2);
});

test("PASS2: 预填摘要缓存优先于 raw_text", async () => {
  const cache = new Map<string, string>([["https://a/1", "预填解读：广州房贷利率下调，利好首套客群。"]]);
  const runner = makeSkipAiRunner(cache);
  const out: any = JSON.parse(await runner(PASS2_SYSTEM, buildPass2User(JSON.stringify(pass2Items), "")));
  assert.equal(out.sections.biz_insight[0].summary, "预填解读：广州房贷利率下调，利好首套客群。");
  // 无缓存的条目仍回退 raw_text
  assert.equal(out.sections.policy_market[0].summary, "央行宣布降准0.5个百分点，释放长期资金约1万亿元。".slice(0, 90));
});

test("空提示返回空 items（不抛异常）", async () => {
  const runner = makeSkipAiRunner();
  const out: any = JSON.parse(await runner(PASS1_SYSTEM, "no json here"));
  assert.deepEqual(out, { items: [] });
});

// 保障 extractJson 在真实提示上抓到的是首个平衡数组（裸数组本身），而非末尾示例
test("extractJson 对 PASS1 真实提示抓到裸数组", () => {
  const txt = buildPass1User(JSON.stringify(pass1Articles));
  const arr = JSON.parse(extractJson(txt));
  assert.ok(Array.isArray(arr) && arr.length === 4);
});
