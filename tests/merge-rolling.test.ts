/**
 * mergeRollingIntoReport（近 7 天历史并入渲染）功能测试。
 * 验证（2026-08-21 用户诉求）：
 *  - 历史符合要求条目（AI 相关、有摘要/可摘录）并入对应板块
 *  - 与今日成稿 URL 去重（今日优先）
 *  - ai_relevant===false 的历史条目不并入
 *  - 有摘要用摘要、无则摘录 excerpt 前 90 字
 *  - source_type 按 tier 推断（T1/T1.5 → official）
 *  - subcategory 映射为中文部门 tag（财富/信贷/私行/客群，无 gz-* 原始字段）
 *  - 历史条目按发布时间倒序追加在今日条目之后
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { mergeRollingIntoReport } from "../lib/output/render";
import type { ArticleInput, DailyReport, ReportItem } from "../lib/types";
import type { SourceTier } from "../lib/sources/tiers";

const emptyReport: DailyReport = {
  date: "2026-08-21",
  hero_line: "今日定调：中行算力贷在穗抢跑落地。",
  must_read: [],
  insights: [],
  sections: { gz_local: [], biz_insight: [], policy_market: [], tech: [], ipo: [] },
};

function mkArticle(partial: Partial<Omit<ArticleInput, "url">> & { url: string }): ArticleInput {
  const { url, ...rest } = partial;
  return {
    sourceId: "test-src",
    title: url,
    url,
    category: "finance",
    source: "测试源",
    excerpt: "原文摘录内容，用于无摘要时兜底。",
    publishedAt: new Date("2026-08-21T02:00:00+08:00"),
    relevant: true, // 默认 AI 判相关；测试 false/None 时显式覆盖
    ...rest,
  };
}

const tierMap = new Map<string, SourceTier | undefined>([
  ["gov-src", "T1"],
  ["media-src", "T2"],
]);

test("历史相关条目并入对应板块（category→section）", () => {
  const report = {
    ...emptyReport,
    sections: { ...emptyReport.sections, biz_insight: [] as ReportItem[] },
  };
  const rolling: ArticleInput[] = [
    mkArticle({ url: "https://h/1", title: "广州公积金新政解读", category: "gz", summary: "历史摘要：公积金新政影响住房金融。", sourceId: "gov-src" }),
    mkArticle({ url: "https://h/2", title: "央行降准", category: "finance", summary: "历史摘要：央行降准0.5%。", sourceId: "gov-src" }),
    mkArticle({ url: "https://h/3", title: "AI芯片突破", category: "tech", excerpt: "科技前沿摘录内容。", sourceId: "media-src" }),
    mkArticle({ url: "https://h/4", title: "某司IPO过会", category: "ipo", summary: "历史摘要：某司深交所过会。", sourceId: "gov-src" }),
  ];
  mergeRollingIntoReport(report, rolling, tierMap);
  assert.equal(report.sections.gz_local.length, 1);
  assert.equal(report.sections.policy_market.length, 1);
  assert.equal(report.sections.tech.length, 1);
  assert.equal(report.sections.ipo.length, 1);
  assert.equal(report.sections.gz_local[0].summary, "历史摘要：公积金新政影响住房金融。");
});

test("与今日成稿 URL 去重（今日优先）", () => {
  const report = {
    ...emptyReport,
    sections: {
      ...emptyReport.sections,
      policy_market: [
        {
          url: "https://h/2",
          title_cn: "央行降准（今日成稿）",
          source: "央行",
          source_type: "official" as const,
          date: "08/21",
          summary: "今日摘要",
          importance: 3 as const,
          rank: 1,
          tags: [],
          locale: "national" as const,
        },
      ],
    },
  };
  const rolling: ArticleInput[] = [
    mkArticle({ url: "https://h/2", title: "央行降准", category: "finance", summary: "历史摘要", sourceId: "gov-src" }),
    mkArticle({ url: "https://h/9", title: "LPR下调", category: "finance", summary: "历史摘要：LPR下调。", sourceId: "gov-src" }),
  ];
  mergeRollingIntoReport(report, rolling, tierMap);
  assert.equal(report.sections.policy_market.length, 2);
  assert.equal(report.sections.policy_market[0].title_cn, "央行降准（今日成稿）"); // 今日在前
  assert.equal(report.sections.policy_market[1].title_cn, "LPR下调"); // 历史追加在后
  assert.equal(report.sections.policy_market[0].rank, 1);
  assert.equal(report.sections.policy_market[1].rank, 2);
});

test("仅 ai_relevant=true 的历史条目并入（false 与未打标 None 均排除）", () => {
  const report = { ...emptyReport, sections: { ...emptyReport.sections, policy_market: [] as ReportItem[] } };
  const rolling: ArticleInput[] = [
    mkArticle({ url: "https://h/x", title: "某娱乐新闻", category: "finance", summary: "无关内容", sourceId: "media-src", relevant: false }),
    mkArticle({ url: "https://h/y", title: "同业动态", category: "finance", summary: "相关摘要", sourceId: "media-src", relevant: true }),
    mkArticle({ url: "https://h/z", title: "未打标条目", category: "finance", summary: "未判内容", sourceId: "media-src", relevant: undefined as unknown as boolean }), // 显式 None
  ];
  mergeRollingIntoReport(report, rolling, tierMap);
  assert.equal(report.sections.policy_market.length, 1);
  assert.equal(report.sections.policy_market[0].url, "https://h/y");
});

test("无摘要时摘录 excerpt 前 90 字；无摘要且无正文则跳过", () => {
  const report = { ...emptyReport, sections: { ...emptyReport.sections, tech: [] as ReportItem[] } };
  const rolling: ArticleInput[] = [
    mkArticle({ url: "https://h/t1", title: "技术前沿A", category: "tech", excerpt: "很长的一段技术摘录内容，".repeat(20), sourceId: "media-src" }),
    mkArticle({ url: "https://h/t2", title: "技术前沿B", category: "tech", excerpt: "", summary: "", sourceId: "media-src" }),
  ];
  mergeRollingIntoReport(report, rolling, tierMap);
  const t1 = report.sections.tech.find((i) => i.url === "https://h/t1");
  assert.ok(t1, "t1 应并入");
  assert.equal(t1.summary.length, 90);
  assert.equal(t1.summary, "很长的一段技术摘录内容，".repeat(20).slice(0, 90));
});

test("source_type 按 tier 推断（T1→official / T2→media）", () => {
  const report = { ...emptyReport, sections: { ...emptyReport.sections, policy_market: [] as ReportItem[] } };
  const rolling: ArticleInput[] = [
    mkArticle({ url: "https://h/o", title: "官方政策", category: "finance", summary: "官方摘要", sourceId: "gov-src" }),
    mkArticle({ url: "https://h/m", title: "媒体报道", category: "finance", summary: "媒体摘要", sourceId: "media-src" }),
  ];
  mergeRollingIntoReport(report, rolling, tierMap);
  const official = report.sections.policy_market.find((i) => i.url === "https://h/o");
  const media = report.sections.policy_market.find((i) => i.url === "https://h/m");
  assert.ok(official, "official 应并入");
  assert.ok(media, "media 应并入");
  assert.equal(official.source_type, "official");
  assert.equal(media.source_type, "media");
});

test("subcategory 映射为中文部门 tag（无 gz-* 原始字段）", () => {
  const report = { ...emptyReport, sections: { ...emptyReport.sections, biz_insight: [] as ReportItem[] } };
  const rolling: ArticleInput[] = [
    mkArticle({
      url: "https://h/w",
      title: "广州财富管理新规",
      category: "gz",
      subcategory: "gz-wealth",
      subcategories: ["gz-wealth", "gz-private"],
      summary: "财富摘要",
      sourceId: "media-src",
    }),
  ];
  mergeRollingIntoReport(report, rolling, tierMap);
  const item = report.sections.gz_local[0];
  assert.ok(item, "gz 条目应并入");
  assert.deepEqual(item.tags, ["财富", "私行"]);
  assert.ok(!JSON.stringify(item).includes("gz-wealth"), "不应外露 gz-* 原始字段");
});

test("历史条目按发布时间倒序追加", () => {
  const report = {
    ...emptyReport,
    sections: {
      ...emptyReport.sections,
      policy_market: [
        {
          url: "https://today/1",
          title_cn: "今日条目",
          source: "央行",
          source_type: "official" as const,
          date: "08/21",
          summary: "今日摘要",
          importance: 3 as const,
          rank: 1,
          tags: [],
          locale: "national" as const,
        },
      ],
    },
  };
  const rolling: ArticleInput[] = [
    mkArticle({ url: "https://h/old", title: "较早政策", category: "finance", summary: "较早摘要", sourceId: "gov-src", publishedAt: new Date("2026-08-19T02:00:00+08:00") }),
    mkArticle({ url: "https://h/new", title: "较新政策", category: "finance", summary: "较新摘要", sourceId: "gov-src", publishedAt: new Date("2026-08-20T02:00:00+08:00") }),
  ];
  mergeRollingIntoReport(report, rolling, tierMap);
  const titles = report.sections.policy_market.map((i) => i.title_cn);
  assert.deepEqual(titles, ["今日条目", "较新政策", "较早政策"]);
});

test("category=gz 严格过滤：标题含广州锚→gz_local；外地地名→policy_market；其余→业务启示", () => {
  const report = { ...emptyReport, sections: { ...emptyReport.sections, gz_local: [] as ReportItem[], biz_insight: [] as ReportItem[], policy_market: [] as ReportItem[] } };
  const rolling: ArticleInput[] = [
    // 真广州（标题含海珠）→ gz_local
    mkArticle({ url: "https://h/gz1", title: "广州海珠区发布词元八条", category: "gz", summary: "海珠区政策", sourceId: "gov-src" }),
    // 外地地名（上海）→ policy_market（全国政策），即使摘要提「广州」也不进 gz_local
    mkArticle({ url: "https://h/sh", title: "上海优化个人住房信贷政策", category: "gz", summary: "上海政策，分行应跟踪广州房贷", sourceId: "media-src" }),
    // 无锚（黄金理财）→ 业务启示
    mkArticle({ url: "https://h/gold", title: "多只固收+黄金理财产品净值修复", category: "gz", summary: "黄金理财全国新闻", sourceId: "media-src" }),
  ];
  mergeRollingIntoReport(report, rolling, tierMap);
  assert.equal(report.sections.gz_local.length, 1);
  assert.equal(report.sections.gz_local[0].url, "https://h/gz1");
  assert.equal(report.sections.policy_market.length, 1);
  assert.equal(report.sections.policy_market[0].url, "https://h/sh");
  assert.equal(report.sections.biz_insight.length, 1);
  assert.equal(report.sections.biz_insight[0].url, "https://h/gold");
});

test("finance 类但标题含广州锚（如广州市政府批复）→ gz_local", () => {
  const report = { ...emptyReport, sections: { ...emptyReport.sections, gz_local: [] as ReportItem[], policy_market: [] as ReportItem[] } };
  const rolling: ArticleInput[] = [
    mkArticle({ url: "https://h/gz2", title: "广州市人民政府关于同意海珠区规划成果的批复", category: "finance", summary: "市政府批复", sourceId: "gov-src" }),
    mkArticle({ url: "https://h/pol", title: "央行宣布降准", category: "finance", summary: "全国政策", sourceId: "gov-src" }),
  ];
  mergeRollingIntoReport(report, rolling, tierMap);
  assert.equal(report.sections.gz_local.length, 1);
  assert.equal(report.sections.gz_local[0].url, "https://h/gz2");
  assert.equal(report.sections.policy_market.length, 1);
  assert.equal(report.sections.policy_market[0].url, "https://h/pol");
});
