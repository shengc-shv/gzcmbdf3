/**
 * gz_hint 本地关键词提权测试（2026-08-21 第二梯队第 4 项）。
 *
 * 背景：广州本地媒体源（第一梯队）与全国财经源中，标题明确含广州地名的条目
 * （广州/穗/天河/海珠/琶洲 等）此前常被「保留标准第2~4条」门槛刷掉（Pass 1
 * 把 locale 判 national / 直接 keep=false）。gz_hint 在输入侧标记，让 Pass 1
 * 倾向判 locale=gz + section=gz_local，且 locale_evidence 允许取自标题。
 *
 * 验证：
 *  1. GZ_ANCHOR_RE 命中广州标题、不误伤全国标题
 *  2. runPass1 对 gz_hint 条目：locale=gz 时证据可取自标题（不再强制 raw_text 子串）
 *  3. runPass1 对非 gz_hint 条目：证据仍须 raw_text 子串（原严校验不回退）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runPass1, type Pass1Input } from "../lib/ai/pass1";
import { GZ_ANCHOR_RE } from "../lib/output/render/cards";

test("GZ_ANCHOR_RE: 命中广州地名标题", () => {
  assert.ok(GZ_ANCHOR_RE.test("琶洲算法大赛上线"));
  assert.ok(GZ_ANCHOR_RE.test("天河区发布数字人民币试点方案"));
  assert.ok(GZ_ANCHOR_RE.test("海珠区赋能百千万工程"));
  assert.ok(GZ_ANCHOR_RE.test("广州写字楼空置率下降"));
  assert.ok(GZ_ANCHOR_RE.test("穗港联手开展公益项目"));
});

test("GZ_ANCHOR_RE: 不误伤全国性标题", () => {
  assert.ok(!GZ_ANCHOR_RE.test("央行宣布降准0.5个百分点"));
  assert.ok(!GZ_ANCHOR_RE.test("广东规上工业增加值同比增长5.7%")); // 广东≠广州锚
  assert.ok(!GZ_ANCHOR_RE.test("LPR连续15个月维持不变"));
});

/** mock runner：直接返回预设 AI 判断 */
function fakeRunner(judgements: Map<string, any>) {
  return async (_sys: string, _user: string) =>
    JSON.stringify({ items: [...judgements.entries()].map(([url, j]) => ({ url, ...j })) });
}

test("gz_hint: locale=gz 时证据可取自标题（提权生效）", async () => {
  const input: Pass1Input = {
    url: "https://dayoo/1",
    title: "琶洲算法大赛上线",
    source: "广州日报·大洋网",
    date: "08/21",
    raw_text: "第五届琶洲算法大赛今日在广交会展馆开幕。",
    category: "gz",
    gz_hint: true,
  };
  // AI 判 locale=gz，但 locale_evidence 只摘录标题里的「琶洲」（raw_text 无该词）
  const judgements = new Map([
    [
      input.url,
      {
        keep: true,
        section: "gz_local",
        source_type: "media",
        locale: "gz",
        locale_evidence: "琶洲",
        tags: [],
        title_cn: "琶洲算法大赛上线",
        importance_candidate: 2,
      },
    ],
  ]);
  const kept = await runPass1([input], fakeRunner(judgements));
  assert.equal(kept.length, 1, "gz_hint 条目应保留");
  assert.equal(kept[0]!.locale, "gz", "gz_hint 条目证据取自标题应通过校验");
  assert.equal(kept[0]!.section, "gz_local");
});

test("gz_hint: 无提权时证据非 raw_text 子串仍降级 national（不回退）", async () => {
  const input: Pass1Input = {
    url: "https://media/2",
    title: "某行业论坛今日开幕",
    source: "某媒体",
    date: "08/21",
    raw_text: "大会聚焦行业趋势。",
    category: "finance",
    // gz_hint 缺省 → 不享受提权
  };
  const judgements = new Map([
    [
      input.url,
      {
        keep: true,
        section: "gz_local",
        source_type: "media",
        locale: "gz",
        locale_evidence: "琶洲",
        tags: [],
        title_cn: "某行业论坛今日开幕",
        importance_candidate: 2,
      },
    ],
  ]);
  const kept = await runPass1([input], fakeRunner(judgements));
  assert.equal(kept.length, 1, "内容仍保留（只丢地域资格不丢内容）");
  assert.equal(kept[0]!.locale, "national", "无 gz_hint → 证据非 raw_text 子串 → 降级 national");
  assert.equal(kept[0]!.section, "biz_insight", "section=gz_local 且 locale≠gz → 改归 biz_insight");
});

test("gz_hint: 标题含广州地名的全国源也提权", async () => {
  // 全国财经源里有一条标题含「广州」的（如 21jingji 报道广州分行的业务动态）
  const input: Pass1Input = {
    url: "https://21j/3",
    title: "广州多家银行下调房贷利率",
    source: "21世纪经济报道",
    date: "08/21",
    raw_text: "据调查，广州地区首套房贷利率已降至3.2%。",
    category: "finance",
    gz_hint: true,
  };
  const judgements = new Map([
    [
      input.url,
      {
        keep: true,
        section: "gz_local",
        source_type: "media",
        locale: "gz",
        locale_evidence: "广州",
        tags: ["信贷"],
        title_cn: "广州多家银行下调房贷利率",
        importance_candidate: 3,
      },
    ],
  ]);
  const kept = await runPass1([input], fakeRunner(judgements));
  assert.equal(kept.length, 1);
  assert.equal(kept[0]!.locale, "gz", "标题含广州 + gz_hint → locale=gz 保留");
});
