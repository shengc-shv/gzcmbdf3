/**
 * 两阶段管线端到端测试（文档第 6/7/10 节验收）：用 mock LlmRunner 覆盖
 * §10 验收项——空输入 / 池外URL / BTC 违禁词 / 地域降级 / 相似去重 /
 * importance 分布 / 截断 JSON 自愈 / 连续 block 走降级 / 落盘无内部字段。
 *
 * 设计原则：AI 负责创作，但每条创作必须能被代码证伪；校验不过打回重写，
 * 重写不过降级丢弃——单条内容永远丢得起，信任丢不起。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateDaily, preFilterForAi } from "../lib/ai/pipeline";
import { validateReport, SECTIONS } from "../lib/ai/validator";
import type { Pass1Input } from "../lib/ai/pass1";
import type { DailyReport, ReportItem, ReportSectionKey } from "../lib/types";

const HERO = "今日广州分行关注重点资讯更新，更多详见各板块。"; // 22 字，15~70

function mkInput(url: string, category: string, title: string): Pass1Input {
  return {
    url,
    title,
    source: "源",
    date: "08/19",
    raw_text: `关于${title}的详细报道内容。`,
    category,
  };
}

function allItems(report: DailyReport): ReportItem[] {
  return SECTIONS.flatMap((s) => report.sections[s]);
}
function allUrls(report: DailyReport): Set<string> {
  return new Set(allItems(report).map((i) => i.url));
}

/** 由 PASS2 输入条目构造一份合法 JSON（可注入 mutate 制造 block）。 */
function pass2Json(
  items: any[],
  mutate?: (out: any, it: any) => void,
): string {
  const sections: Record<ReportSectionKey, any[]> = {
    gz_local: [],
    biz_insight: [],
    policy_market: [],
    tech: [],
    ipo: [],
  };
  for (const it of items) {
    const sec: ReportSectionKey = SECTIONS.includes(it.section) ? it.section : "biz_insight";
    const out: any = {
      url: it.url,
      title_cn: it.title_cn || it.title || "",
      title_orig: it.title_orig || "",
      source: it.source || "源",
      source_type: it.source_type || "media",
      date: it.date || "08/19",
      summary: (it.raw_text || "").slice(0, 90) || "摘要内容",
      importance: 2,
      tags: Array.isArray(it.tags) ? it.tags : [],
      locale: it.locale || "national",
      locale_evidence: it.locale_evidence || "",
    };
    if (mutate) mutate(out, it);
    sections[sec].push(out);
  }
  return JSON.stringify({ hero_line: HERO, must_read: [], insights: [], sections });
}

/**
 * 从可能含模板噪声（如 PASS1 提示里的示例 `{"items":[...]}`）的 prompt 中，
 * 抽取「第一个平衡 JSON 数组」。PASS1 提示把文章数组直接注入，PASS2 提示把
 * 已保留条目数组直接注入——二者都是裸数组，故按首个 `[...]` 提取最稳。
 */
function extractArray(s: string): any[] {
  const start = s.indexOf("[");
  if (start === -1) return [];
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return [];
        }
      }
    }
  }
  return [];
}

/**
 * mock LlmRunner：
 * - PASS1（数组元素含 category、无 section）：全部 keep，按原始 category 启发式归板块。
 * - PASS2（数组元素含 section）：照抄字段；可注入 mutate 制造 block；可截断 JSON 自愈。
 * 用「首个元素是否含 section」区分两个 PASS，避免使用含示例噪声的 parsed.items。
 */
function makeRunner(opts: {
  mutate?: (out: any, it: any) => void;
  truncatedFirst?: boolean;
} = {}) {
  let pass2Attempt = 0;
  return async (_system: string, userPrompt: string): Promise<string> => {
    const arr = extractArray(userPrompt);
    const isPass2 = arr.length > 0 && arr[0]?.section !== undefined;
    if (!isPass2) {
      return JSON.stringify({
        items: arr.map((it: any) => ({
          url: it.url,
          keep: true,
          section:
            it.category === "tech"
              ? "tech"
              : it.category === "ipo" || it.category === "gd-ipo"
                ? "ipo"
                : it.category === "gz"
                  ? "biz_insight"
                  : "policy_market",
          source_type: "media",
          locale: "national",
          locale_evidence: "",
          tags: [],
          title_cn: it.title || "",
          title_orig: "",
          importance_candidate: 2,
        })),
      });
    }
    pass2Attempt++;
    const json = pass2Json(arr, opts.mutate);
    if (opts.truncatedFirst && pass2Attempt === 1) {
      // 截断 JSON（去掉结尾 }），触发管线解析兜底/重试
      return json.replace(/}$/, "");
    }
    return json;
  };
}

test("空输入：PASS1 全丢弃 → 合法空报告（HERO 兜底，板块全空），不抛异常", async () => {
  const report = await generateDaily([], "2026-08-19", { runner: makeRunner() });
  assert.equal(allItems(report).length, 0);
  const h = report.hero_line ?? "";
  assert.ok(h.length >= 15 && h.length <= 70, "hero_line 应兜底为 15~70 字");
});

test("正常输入：产出含条目且校验零 block", async () => {
  const inputs = [
    mkInput("https://x/tech", "tech", "AI 算力芯片突破"),
    mkInput("https://x/fin", "finance", "央行降准"),
  ];
  const report = await generateDaily(inputs, "2026-08-19", { runner: makeRunner() });
  assert.equal(allItems(report).length, 2);
  assert.equal(blocksOf(report).length, 0, "正常成稿应零 block");
});

test("池外 URL：PASS2 引用不在输入池的 url → 静默丢弃，最终报告不含该 url", async () => {
  const inputs = [
    mkInput("https://x/1", "finance", "央行降准"),
    mkInput("https://x/2", "tech", "AI 芯片"),
  ];
  const report = await generateDaily(inputs, "2026-08-19", {
    runner: makeRunner({
      mutate: (out, it) => {
        if (it.url === "https://x/2") out.url = "https://x/outside";
      },
    }),
  });
  assert.ok(!allUrls(report).has("https://x/outside"), "池外 URL 不应进入最终报告");
  assert.ok(allUrls(report).has("https://x/1"), "合法条目应保留");
});

test("BTC 违禁词：summary 含 BTC → R6 block → 降级丢弃该条", async () => {
  const inputs = [mkInput("https://x/1", "tech", "加密市场观察")];
  const report = await generateDaily(inputs, "2026-08-19", {
    runner: makeRunner({ mutate: (out) => { out.summary = "BTC 今日大涨，市场火热。"; } }),
  });
  assert.equal(blocksOf(report).length, 0, "降级后不应残留 block");
  assert.ok(!JSON.stringify(report).includes("BTC"), "降级应清除违禁词条目");
});

test("地域降级：locale≠gz 但 summary 出现「广东公司」→ R3 block → 降级丢弃", async () => {
  const inputs = [mkInput("https://x/1", "finance", "区域企业动态")];
  const report = await generateDaily(inputs, "2026-08-19", {
    runner: makeRunner({
      mutate: (out) => {
        out.locale = "national";
        out.summary = "广东某公司发布新产品，值得关注。";
      },
    }),
  });
  assert.equal(blocksOf(report).length, 0, "降级后不应残留 block");
  assert.ok(!JSON.stringify(report).includes("广东某公司"), "地域表述错误条目应被丢弃");
});

test("相似去重：两条高度相似标题 → R9 block → 降级保留首条", async () => {
  const inputs = [
    mkInput("https://x/1", "finance", "广州房贷利率下调"),
    mkInput("https://x/2", "finance", "广州房贷利率下调"),
  ];
  const report = await generateDaily(inputs, "2026-08-19", { runner: makeRunner() });
  // 两条同标题 → 跨板块/同板块去重后仅保留首条
  assert.equal(allItems(report).length, 1, "相似标题应去重至 1 条");
  assert.ok(allUrls(report).has("https://x/1"));
});

test("importance 分布：4 条全 importance=3 → R5 block → 降级后全量≤3 且每板块≤1", async () => {
  const inputs = [
    mkInput("https://x/t", "tech", "技术新闻"),
    mkInput("https://x/f", "finance", "财经新闻"),
    mkInput("https://x/g", "gz", "广州商机"),
    mkInput("https://x/i", "ipo", "IPO 动态"),
  ];
  const report = await generateDaily(inputs, "2026-08-19", {
    runner: makeRunner({ mutate: (out) => { out.importance = 3; } }),
  });
  const threes = allItems(report).filter((i) => i.importance === 3);
  assert.ok(threes.length <= 3, `全量 importance=3 应 ≤3，实际 ${threes.length}`);
  for (const sec of SECTIONS) {
    const n = report.sections[sec].filter((i) => i.importance === 3).length;
    assert.ok(n <= 1, `板块 ${sec} 内 importance=3 应 ≤1，实际 ${n}`);
  }
  assert.equal(blocksOf(report).length, 0, "降级后不应残留 block");
});

test("截断 JSON 自愈：首次返回截断 JSON → 解析兜底/重试后仍产出合法报告", async () => {
  const inputs = [mkInput("https://x/1", "finance", "央行降准")];
  const report = await generateDaily(inputs, "2026-08-19", {
    runner: makeRunner({ truncatedFirst: true }),
  });
  assert.ok(allUrls(report).has("https://x/1"), "自愈后合法条目应保留");
  assert.equal(blocksOf(report).length, 0, "自愈后报告应合法");
});

test("连续 block 走降级：每次成稿都含 BTC → 重试耗尽后降级清空，最终零 block", async () => {
  const inputs = [mkInput("https://x/1", "tech", "加密市场观察")];
  const report = await generateDaily(inputs, "2026-08-19", {
    runner: makeRunner({ mutate: (out) => { out.summary = "BTC 持续大涨。"; } }),
  });
  assert.equal(blocksOf(report).length, 0, "连续 block 应降级至零 block");
  assert.equal(allItems(report).length, 0, "违禁词条目降级后应为空");
});

test("落盘无内部字段：成稿条目不含 raw_text / _sec / section 等内部字段", async () => {
  const inputs = [mkInput("https://x/1", "finance", "央行降准")];
  const report = await generateDaily(inputs, "2026-08-19", { runner: makeRunner() });
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes('"raw_text"'), "落盘报告不应含 raw_text 内部字段");
  assert.ok(!serialized.includes('"_sec"'), "落盘报告不应含 _sec 临时字段");
  const it = allItems(report)[0];
  assert.ok(it && !("raw_text" in it) && !("section" in it), "Item 不应携带内部字段");
});

function blocksOf(report: DailyReport): ReturnType<typeof validateReport> {
  return validateReport(report, {
    get: () => ({ raw_text: "" }),
  }).filter((i) => i.level === "block");
}

test("preFilterForAi：零 LLM 前置过滤掉违禁词与同正文重复，输出零变化", () => {
  const clean1 = mkInput("u1", "finance", "LPR 年内第三次下调");
  const banned = mkInput("u2", "tech", "某项目进展");
  banned.raw_text = "本报告涉及加密资产的炒作风险提示。";
  const clean2 = mkInput("u3", "finance", "广州发布促消费新政");
  const longText = "x".repeat(120);
  const dupA = mkInput("u5", "tech", "A");
  const dupB = mkInput("u6", "tech", "B");
  dupA.raw_text = longText;
  dupB.raw_text = longText; // 与 dupA 同正文指纹

  const { kept, droppedBanned, droppedDup } = preFilterForAi([
    clean1,
    banned,
    clean2,
    dupA,
    dupB,
  ]);
  assert.equal(droppedBanned, 1);
  assert.equal(droppedDup, 1);
  const urls = kept.map((k) => k.url).sort();
  assert.deepEqual(urls, ["u1", "u3", "u5"].sort());
});
