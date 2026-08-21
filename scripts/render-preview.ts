/**
 * 一次性预览渲染：完全使用本地已预加载的数据（data/article-history.json 中
 * 已写入的 AI 摘要）生成报告页面，**不调用任何 AI、不联网抓取**。
 *
 * 用途：把"预加载清单"的效果直接渲染成项目同款 HTML，供预览与发布。
 * 渲染逻辑复用项目的 render.ts（renderHtml / renderMarkdown），保证样式与
 * 正式 daily 流程一致。
 */
import fs from "node:fs";
import path from "node:path";

import { sources, loadAllSources } from "../lib/sources/registry";
import { loadHistory } from "../lib/output/history";
import { renderHtml, renderMarkdown } from "../lib/output/render";
import { buildNoAiReport } from "../lib/output/report-from-articles";
import { todayKey } from "../lib/utils";
import type { ArticleInput, DailyReport } from "../lib/types";

const OUTPUT_DIR = "daily_reports";

function main() {
  const date = todayKey();
  const history = loadHistory();
  const today = date; // "2026-08-17"

  // 1) 由本地历史构建文章列表，按"信息发生时间(publishedAt)"拆分时间标签进行预览：
  //    "当天" = 发生于今天；"过去7天" = 发生于最近 7 天（不含今天）。
  //    无 publishedAt 时回退 lastSeenAt（分析时间）兜底。仅保留窗口内条目。
  //    注：正式 daily 流程中 "当天"=本运行新抓取(fetchedToday)，"过去7天"=按发生时间回滚的存量；
  //        此处为静态快照预览，改用发生时间拆分以直观展示两个标签。
  const DAY = 86_400_000;
  const repDayStart = new Date(today + "T00:00:00Z").getTime();
  const startOfDay = (d: Date) =>
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).getTime();
  const articles: ArticleInput[] = [];
  let withSummary = 0;
  for (const e of Object.values(history)) {
    const ref = e.publishedAt
      ? new Date(e.publishedAt)
      : e.lastSeenAt
        ? new Date(e.lastSeenAt)
        : null;
    let fetchedToday: boolean;
    if (e.category === "gd-ipo") {
      // 广东地区IPO：按信息发生时间(publishedAt)拆"当天 / 过去7天"，与正式 daily 一致。
      if (!ref) {
        fetchedToday = false; // 既无发生时间也无分析时间，归入过去（兜底）
      } else {
        const ageDays = Math.floor((repDayStart - startOfDay(ref)) / DAY);
        if (ageDays <= 0) fetchedToday = true; // 今天或未来（时区误差）
        else if (ageDays >= 1 && ageDays <= 7) fetchedToday = false; // 过去7天
        else continue; // 超出 7 天窗口
      }
    } else {
      // 技术动态 / 财经要点 / 时政：预览模拟"当日完整抓取"，全部计入"当天"，
      // 对应正式 daily 中本运行新抓取的当日热门条目（不暴露历史库存）。
      fetchedToday = true;
    }
    if (e.summary) withSummary++;
    articles.push({
      sourceId: e.sourceId,
      title: e.title,
      url: e.url,
      excerpt: e.excerpt,
      publishedAt: e.publishedAt ? new Date(e.publishedAt) : undefined,
      category: e.category,
      summary: e.summary,
      source: e.source,
      fetchedToday,
    });
  }
  console.log(
    `📊 本地历史 ${Object.keys(history).length} 条 ｜ 其中含 AI 摘要 ${withSummary} 条 ｜ 渲染文章 ${articles.length} 条`,
  );

  // 2) 由本地历史（已预加载的 AI 摘要）合成新 schema 报告（sections 驱动渲染）。
  const report = buildNoAiReport(articles);

  // 3) 渲染 HTML / Markdown（项目同款）。
  const html = renderHtml(report, date);
  const md = renderMarkdown(report, date);

  const dateDir = path.join(OUTPUT_DIR, date);
  fs.mkdirSync(dateDir, { recursive: true });
  fs.writeFileSync(path.join(dateDir, `${date}.html`), html, "utf8");
  fs.writeFileSync(path.join(dateDir, `${date}.md`), md, "utf8");
  console.log(`✅ 报告已生成: ${path.join(dateDir, date)}.html`);
  console.log(`✅ Markdown 摘要已生成: ${path.join(dateDir, date)}.md`);
}

main();
