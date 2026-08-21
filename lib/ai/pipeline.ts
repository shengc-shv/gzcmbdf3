/**
 * 管线编排（文档第 6/7 节）：归一化 → PASS1 → PASS2 重试循环 → 仍不过则降级 → finalize。
 *
 * 设计原则（文档第 0 节）：AI 负责创作，但每条创作必须能被代码证伪；
 * 校验不过打回重写，重写不过降级丢弃——单条内容永远丢得起，信任丢不起。
 */
import { runPass1, type LlmRunner, type Pass1Input } from "./pass1";
import { runPass2, ensureSchema, finalizeRanks } from "./pass2";
import {
  validateReport,
  ALLOWED_TAGS,
  BANNED_WORDS,
  SECTIONS,
  type Issue,
  type ValidationPool,
} from "./validator";
import { extractJson } from "./json-util";
import type { DailyReport, ReportItem, ReportSectionKey } from "../types";
import { titleSimilarity } from "../ingest/dedup-similar";

const MAX_PASS2_RETRY = 2;
const R9_THRESHOLD = 0.8;
const HERO_FALLBACK = "今日暂无可推送重点，详见各板块资讯。";

/** SKIP_AI 模式（无 LLM）下的文章原始分类 → 板块启发式映射。 */
function categoryToSection(cat?: string): ReportSectionKey {
  switch (cat) {
    case "tech":
      return "tech";
    case "ipo":
    case "gd-ipo":
      return "ipo";
    case "gz":
      return "biz_insight"; // 无法判断 locale，保守归业务启示
    case "finance":
    case "politics":
      return "policy_market";
    default:
      return "biz_insight";
  }
}

/**
 * SKIP_AI 确定性降级 runner：不调用任何 LLM，纯靠输入池字段构造合法 JSON。
 * - PASS1（条目含 raw_text/category）：全部 keep，按原始 category 启发式归板块。
 * - PASS2（条目含 section）：照抄字段，summary 取 raw_text 前 90 字，importance=2。
 * 使 SKIP_AI 模式（CI 失败恢复 / 预分析取全量）仍能产出可读报告。
 */
export const skipAiRunner: LlmRunner = async (_system, userPrompt) => {
  let parsed: any = {};
  try {
    parsed = JSON.parse(extractJson(userPrompt));
  } catch {
    parsed = {};
  }
  const items: any[] = Array.isArray(parsed?.items) ? parsed.items : [];
  const isPass2 = items.length > 0 && items[0]?.section !== undefined;
  if (!isPass2) {
    return JSON.stringify({
      items: items.map((it) => ({
        url: it.url,
        keep: true,
        section: categoryToSection(it.category),
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
  const sections: Record<ReportSectionKey, any[]> = {
    gz_local: [],
    biz_insight: [],
    policy_market: [],
    tech: [],
    ipo: [],
  };
  for (const it of items) {
    const sec: ReportSectionKey = SECTIONS.includes(it.section) ? it.section : "biz_insight";
    sections[sec].push({
      url: it.url,
      title_cn: it.title_cn || "",
      title_orig: it.title_orig || "",
      source: it.source || "",
      source_type: it.source_type || "media",
      date: it.date || "",
      summary: (it.raw_text || "").slice(0, 90),
      importance: 2,
      tags: Array.isArray(it.tags) ? it.tags : [],
      locale: it.locale || "national",
      locale_evidence: it.locale_evidence || "",
    });
  }
  return JSON.stringify({ hero_line: "", must_read: [], insights: [], sections });
};

export interface PipelineOptions {
  /** 注入 mock LLM 便于测试。 */
  runner?: LlmRunner;
  /** 回炉次数上限（文档 MAX_PASS2_RETRY=2）。 */
  maxPass2Retry?: number;
}

/** 把 block 问题清单格式化为回炉 prompt 片段。 */
export function formatFeedback(blockers: Issue[]): string {
  return blockers
    .map((b, i) => `${i + 1}. 【${b.msg}】涉及《${b.where}》`)
    .join("\n");
}

/** 构造校验池（url → raw_text）。 */
function buildPool(inputs: Pass1Input[]): ValidationPool {
  const m = new Map<string, { raw_text: string }>();
  for (const i of inputs) m.set(i.url, { raw_text: i.raw_text });
  return {
    get: (url: string) => m.get(url),
  };
}

function allItems(report: DailyReport): ReportItem[] {
  return SECTIONS.flatMap((s) => report.sections[s]);
}
function allUrls(report: DailyReport): Set<string> {
  return new Set(allItems(report).map((i) => i.url));
}

function bannedIn(text: string): boolean {
  return BANNED_WORDS.some((w) => text.includes(w));
}

/** 降级步骤①：跨板块相似标题去重，保留先出现者，丢弃其余。 */
function degradeDedup(report: DailyReport): void {
  const seen: Array<{ title: string; key: string }> = [];
  for (const sec of SECTIONS) {
    const kept: ReportItem[] = [];
    for (const it of report.sections[sec]) {
      const t = it.title_cn || it.title_orig || "";
      const dup = seen.find(
        (s) =>
          (s.title && t && titleSimilarity(s.title, t) > R9_THRESHOLD) ||
          (s.key && it.url === s.key),
      );
      if (dup) continue;
      seen.push({ title: t, key: it.url });
      kept.push(it);
    }
    report.sections[sec] = kept;
  }
}

/** 降级步骤③：importance 强制分布（全量 ≤3，每板块 ≤1；must_read 命中优先保 3）。 */
function degradeImportance(report: DailyReport): void {
  const mustSet = new Set(report.must_read.map((m) => m.url).filter(Boolean));
  // 每板块 ≤1
  for (const sec of SECTIONS) {
    let threes = 0;
    for (const it of report.sections[sec]) {
      if (it.importance === 3) {
        threes++;
        if (threes > 1) it.importance = 2;
      }
    }
  }
  // 全量 ≤3：must_read 命中优先
  const all = allItems(report).sort((a, b) => {
    const am = mustSet.has(a.url) ? 1 : 0;
    const bm = mustSet.has(b.url) ? 1 : 0;
    return bm - am;
  });
  let threes = 0;
  for (const it of all) {
    if (it.importance === 3) {
      threes++;
      if (threes > 3) it.importance = 2;
    }
  }
}

/** 通过 URL 或标题在报告中定位并删除某条（降级步骤②）。 */
function dropItemByWhere(report: DailyReport, where: string): void {
  for (const sec of SECTIONS) {
    report.sections[sec] = report.sections[sec].filter(
      (it) => it.url !== where && (it.title_cn || "") !== where,
    );
  }
}

/**
 * 降级（文档第 7.2 节，绝不带病上线，粒度从细到粗）。
 * 返回是否发生任何修改（便于测试）。
 */
export function degrade(report: DailyReport, blockers: Issue[]): DailyReport {
  // ① R9 去重
  degradeDedup(report);
  // ② 单条内容错误（where 为条目标题或 url）
  for (const b of blockers) {
    if (/R2|R3|R7|R10|R1/.test(b.msg)) dropItemByWhere(report, b.where);
  }
  // ③ R5 importance 超限
  degradeImportance(report);
  // ④ 违禁词兜底：逐条序列化扫描 sections 与 insights，命中即丢
  for (const sec of SECTIONS) {
    report.sections[sec] = report.sections[sec].filter(
      (it) => !bannedIn(JSON.stringify(it)),
    );
  }
  report.insights = report.insights.filter((it) => !bannedIn(JSON.stringify(it)));
  // ⑤ insights 兜底：impact/action 为空的丢弃，截断至 5
  report.insights = report.insights
    .filter((it) => it.impact?.trim() && it.action?.trim())
    .slice(0, 5);
  // ⑥ R10 非法 tag 兜底（清理而非丢条）
  for (const sec of SECTIONS) {
    const allowed = new Set<string>(ALLOWED_TAGS);
    for (const it of report.sections[sec]) {
      it.tags = it.tags.filter((t) => allowed.has(t));
    }
  }
  // ⑦ hero_line 兜底
  const h = report.hero_line?.trim() ?? "";
  const n = [...h].length;
  if (!h || n < 15 || n > 70) {
    const first = report.must_read[0];
    if (first?.url) {
      const it = allItems(report).find((x) => x.url === first.url);
      if (it) report.hero_line = `今日关注：${it.title_cn || it.title_orig || ""}`.slice(0, 70);
    }
    if (!report.hero_line || [...(report.hero_line || "")].length < 15) {
      report.hero_line = HERO_FALLBACK;
    }
  }
  // ⑧ must_read 兜底：剔除指向已删除条目的引用，截断至 5
  const urls = allUrls(report);
  report.must_read = report.must_read
    .filter((m) => !m.url || urls.has(m.url))
    .slice(0, 5);
  return report;
}

/**
 * 主入口：生成当日报告。
 * @param inputs 经归一化 + 关键词漏斗预筛后的文章池
 * @param date YYYY-MM-DD
 */
export async function generateDaily(
  inputs: Pass1Input[],
  date: string,
  opts: PipelineOptions = {},
): Promise<DailyReport> {
  const runner = opts.runner;
  const maxRetry = opts.maxPass2Retry ?? MAX_PASS2_RETRY;
  const pool = buildPool(inputs);

  // 空输入（PASS1 全丢弃）→ 合法空报告，不抛异常
  const kept = await runPass1(inputs, runner);
  if (kept.length === 0) {
    return {
      date,
      hero_line: HERO_FALLBACK,
      must_read: [],
      insights: [],
      sections: {
        gz_local: [],
        biz_insight: [],
        policy_market: [],
        tech: [],
        ipo: [],
      },
    };
  }

  let report: DailyReport = { date, hero_line: "", must_read: [], insights: [], sections: { gz_local: [], biz_insight: [], policy_market: [], tech: [], ipo: [] } };
  let blockers: Issue[] = [];

  // PASS2 重试循环（首次 + maxRetry 次回炉）；全部失败则进入降级
  for (let attempt = 1; attempt <= maxRetry + 1; attempt++) {
    const feedback = blockers.length ? formatFeedback(blockers) : "";
    report = await runPass2(kept, runner!, feedback);
    report.date = date;
    ensureSchema(report);
    finalizeRanks(report);
    const issues = validateReport(report, pool);
    blockers = issues.filter((i) => i.level === "block");
    if (blockers.length === 0) break;
    console.warn(
      `[pipeline] PASS2 第 ${attempt} 次存在 ${blockers.length} 条 block（回炉/降级）`,
    );
  }

  if (blockers.length > 0) {
    console.warn(`[pipeline] 进入降级路径，block ${blockers.length} 条`);
    report = degrade(report, blockers);
    ensureSchema(report);
    finalizeRanks(report);
  }

  return report;
}
