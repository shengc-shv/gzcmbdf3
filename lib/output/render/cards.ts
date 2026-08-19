/**
 * 渲染卡片/面板（M3-C 二期拆分自 lib/output/render.ts）：
 * 单篇文章卡片、来源 tab、L2 子面板、分类面板与共享类型。
 */
import type { ArticleInput } from "../../types";
import type { Category } from "../../sources/types";
import { STR, SUBCATEGORY_ORDER, SUBCATEGORY_LABELS } from "./i18n";
import { TIER_COLORS } from "./theme";
import { SOURCE_TIER_LABELS } from "../../sources/tiers";
import { REPORT_LOCALE } from "../../sources/registry";
import { getReportTz } from "../../utils";

// ----- types -----
export type SourceGroup = {
  sourceId: string;
  sourceName: string;
  items: ArticleInput[];
  /**
   * When true, items come from multiple merged sources and the renderer
   * should label each article with `a.source` since the source-tab row
   * is suppressed (only one synthetic group).
   */
  merged?: boolean;
};

export type SubGroup = {
  id: string;
  name: string;
  sources: SourceGroup[];
};

export type RawByCategory = Record<Category, SubGroup[]>;

export const CATEGORY_LABELS: Record<Category, string> = {
  tech: STR.catTech,
  finance: STR.catFinance,
  politics: STR.catPolitics,
  'gd-ipo': '广东地区IPO',
  ipo: STR.catIpo,
  gz: '广州商机',
};

export const CATEGORY_DIGEST_LABELS: Record<Category, string> = {
  tech: STR.catTech,
  finance: STR.catFinance,
  politics: STR.catPolitics,
  'gd-ipo': STR.catGdIpo,
  ipo: STR.catIpo,
  gz: '广州商机',
};

/**
 * 仅这些分类在 L2 子面板内展示"当天 / 过去7天"时间拆分。
 *  - 技术动态、财经要点：只看当天（热门），不暴露历史库存，故不渲染时间标签。
 *  - 广东地区IPO、全国IPO/新股：按信息发生时间 publishedAt 做 当天/过去7天 回溯。
 *  - 市场行情：在线生成的当日宏观数据，由独立 trading 面板渲染，不在此时间拆分体系内。
 */
export const TIME_SPLIT_CATEGORIES = new Set<Category>(["gd-ipo", "ipo", "gz"]);


export const TECH_MAIN_SUBS = new Set(["github-trending", "trending-papers", "x-viral", "ai-news", "cn-tech"]);
export const TECH_COMMUNITY_SUBS = new Set(["cn-community", "overseas-community"]);

// ----- HTML helpers -----

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatDate(d: Date | undefined): string {
  if (!d) return "";
  try {
    // zh: "05/20 16:00"  · en: "May 20, 4:00 PM" → keep 24h en-GB style "20/05 16:00"
    const localeTag = REPORT_LOCALE === "en" ? "en-GB" : "zh-CN";
    return d.toLocaleString(localeTag, {
      timeZone: getReportTz(),
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "";
  }
}

// ----- raw article renderers -----

export function renderArticleHtml(a: ArticleInput, showSource = false): string {
  const title = escapeHtml(a.title);
  const url = escapeHtml(a.url);
  const excerpt = a.excerpt ? escapeHtml(a.excerpt) : "";
  // Backwards-compat: old sidecar JSON files may carry `cnSummary` instead.
  const summaryText = a.summary ?? (a as unknown as { cnSummary?: string }).cnSummary;
  const summary = summaryText ? escapeHtml(summaryText) : "";
  const meta = a.meta ? escapeHtml(a.meta) : "";
  const time = formatDate(a.publishedAt);
  const sourceLabel = showSource && a.source ? escapeHtml(a.source) : "";
  const alsoFrom = (a.alsoFrom ?? []).filter(Boolean);
  const alsoLine =
    alsoFrom.length > 0
      ? `${escapeHtml("多家来源")}：${alsoFrom.map(escapeHtml).join("、")}`
      : "";
  // 源等级差异化角标（T6）：T1 官方一手（红）/ T1.5 准官方·机构一手（琥珀）/ T2 媒体·智库（灰）
  const tierBadge = a.tier
    ? `<span class="tier-badge tier-${escapeHtml(a.tier)}" style="display:inline-block;font-size:11px;line-height:1;padding:2px 6px;border-radius:8px;margin-right:6px;color:#fff;background:${TIER_COLORS[a.tier]}">${escapeHtml(SOURCE_TIER_LABELS[a.tier] ?? a.tier)}</span>`
    : "";
  const metaLine = [tierBadge, sourceLabel, time, alsoLine].filter(Boolean).join(" · ");
  // News-style summary label for finance/politics, project-intro style for GH/tech.
  const newsy = a.category === "finance" || a.category === "politics";
  const summaryLabel = newsy ? STR.summaryLabelNews : STR.summaryLabelIntro;
  return `<article class="article">
  <h3 class="article-title"><a href="${url}" target="_blank" rel="noopener noreferrer">${title}</a></h3>
  ${meta ? `<p class="article-stats">${meta}</p>` : ""}
  ${metaLine ? `<p class="article-meta">${metaLine}</p>` : ""}
  ${excerpt ? `<p class="article-excerpt">${excerpt}</p>` : ""}
  ${summary ? `<p class="article-summary"><span class="summary-label">${summaryLabel}</span> ${summary}</p>` : ""}
</article>`;
}

export function renderSourceContent(
  category: Category,
  subId: string,
  source: SourceGroup,
  isActive: boolean,
): string {
  const showSource = source.merged === true;
  return `<div class="source-content${isActive ? " active" : ""}" data-source-content="${escapeHtml(source.sourceId)}" data-sub="${escapeHtml(subId)}" data-cat="${category}">
    ${source.items.length === 0 ? `<p class="empty">${STR.emptySource}</p>` : source.items.map((a) => renderArticleHtml(a, showSource)).join("\n")}
  </div>`;
}

export function renderSourceTabs(
  category: Category,
  subId: string,
  sources: SourceGroup[],
): string {
  // Single-source L2s (X 推文 / GitHub Trending) skip the L3 row — the L2 tab
  // label already identifies the dataset. L3 only earns its row when there
  // are ≥2 sources to switch between (e.g. 社区讨论 V2EX vs LinuxDo).
  if (sources.length < 2) return "";
  return `<nav class="source-tabs">${sources
    .map(
      (s, i) =>
        `<button class="source-tab${i === 0 ? " active" : ""}" data-source="${escapeHtml(s.sourceId)}" data-sub="${escapeHtml(subId)}" data-cat="${category}">${escapeHtml(s.sourceName)}<span class="count">${s.items.length}</span></button>`,
    )
    .join("")}</nav>`;
}

/**
 * Keep only the articles of each source that match the time window.
 * `todayOnly=true` → fetched in the current run (`fetchedToday`);
 * `todayOnly=false` → carried from the rolling 7-day history.
 */
export function filterByTime(sources: SourceGroup[], todayOnly: boolean): SourceGroup[] {
  return sources.map((s) => ({
    ...s,
    items: s.items.filter((a) =>
      todayOnly ? a.fetchedToday === true : a.fetchedToday !== true,
    ),
  }));
}

let _tzFmt: Intl.DateTimeFormat | undefined;
/** Report-timezone date string "YYYY-MM-DD" for a Date. */
export function tzDateStr(d: Date): string {
  if (!_tzFmt) {
    _tzFmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: getReportTz(),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
  return _tzFmt.format(d);
}

/**
 * 广东地区IPO / 全国IPO / 广州商机 的「当天 / 过去7天」按信息发生时间 publishedAt（发文/公告日期）拆分，
 * 而不是按抓取时间 fetchedToday —— 否则今天抓到的 8 月 12 日公告（或 5 月的月度数据）会被错放进
 * 「当天」。规则（严格 7 天窗口）：
 *  - 有 publishedAt：发文=今天 → 当天；在 [过去7天窗口, 今天) 内 → 过去7天；
 *  - 有 publishedAt 但早于 7 天窗口（如 2025 年旧数据、过期月度数据）：超窗口，**不显示**（不属于最近7天简报）；
 *  - 无 publishedAt：回退 fetchedToday（今天抓到 → 当天；历史缓存 → 过去7天），避免丢失。
 */
export function splitGdIpoByPublishedAt(
  sources: SourceGroup[],
  dateStr: string,
): { today: SourceGroup[]; past: SourceGroup[] } {
  const pastStartMs = Date.UTC(
    Number(dateStr.slice(0, 4)),
    Number(dateStr.slice(5, 7)) - 1,
    Number(dateStr.slice(8, 10)) - 7,
  );
  const pastStartStr = tzDateStr(new Date(pastStartMs));
  const today: SourceGroup[] = [];
  const past: SourceGroup[] = [];
  for (const s of sources) {
    const t: ArticleInput[] = [];
    const p: ArticleInput[] = [];
    for (const a of s.items) {
      const ds = a.publishedAt ? tzDateStr(a.publishedAt) : undefined;
      if (ds === dateStr) t.push(a);
      else if (ds && ds >= pastStartStr && ds < dateStr) p.push(a);
      // 有日期但早于 7 天窗口（2025 年旧数据/过期月度数据）：超窗口，直接丢弃不进任何视图
      else if (ds && ds < pastStartStr) continue;
      else if (!ds && a.fetchedToday === true) t.push(a);
      else p.push(a);
    }
    if (t.length) today.push({ ...s, items: t });
    if (p.length) past.push({ ...s, items: p });
  }
  return { today, past };
}

export function countItems(sources: SourceGroup[]): number {
  return sources.reduce((n, s) => n + s.items.length, 0);
}

/** Sum only the "当天" (fetchedToday) items across subgroups — used for the
 *  top-level tab badge of categories that don't expose a 过去7天 backlog. */
export function countItemsToday(subs: SubGroup[]): number {
  return subs.reduce((n, sg) => n + countItems(filterByTime(sg.sources, true)), 0);
}

export function renderSourcesBlock(
  category: Category,
  subId: string,
  sources: SourceGroup[],
): string {
  if (sources.length === 0) {
    return `<p class="empty">${STR.emptySource}</p>`;
  }
  return `${renderSourceTabs(category, subId, sources)}
  <div class="source-contents">
    ${sources.map((s, i) => renderSourceContent(category, subId, s, i === 0)).join("\n")}
  </div>`;
}

export function renderSubContent(category: Category, sub: SubGroup, isActive: boolean, date: string): string {
  const usesTimeSplit = TIME_SPLIT_CATEGORIES.has(category);
  const activeCls = isActive ? " active" : "";
  const subAttr = `data-sub-content="${escapeHtml(sub.id)}" data-cat="${category}"`;

  // 空 sub 占位结构：
  //  - 需要时间拆分的（gd-ipo）保留"当天 / 过去7天"两个空面板，结构稳定可见；
  //  - 其他分类（技术动态 / 财经要点）直接显示"今日无内容"。
  if (sub.sources.length === 0) {
    if (!usesTimeSplit) {
      return `<div class="sub-content${activeCls}" ${subAttr}><p class="empty">${STR.emptySource}</p></div>`;
    }
    return `<div class="sub-content${activeCls}" ${subAttr}>
    <nav class="time-tabs">
      <button class="time-tab active" data-time="today" data-cat="${category}" data-sub="${escapeHtml(sub.id)}">${STR.timeToday}<span class="count">0</span></button>
      <button class="time-tab" data-time="past" data-cat="${category}" data-sub="${escapeHtml(sub.id)}">${STR.timePast7}<span class="count">0</span></button>
    </nav>
    <div class="time-contents">
      <div class="time-content active" data-time-content="today" data-cat="${category}" data-sub="${escapeHtml(sub.id)}"><p class="empty">${STR.emptySource}</p></div>
      <div class="time-content" data-time-content="past" data-cat="${category}" data-sub="${escapeHtml(sub.id)}"><p class="empty">${STR.emptySource}</p></div>
    </div>
  </div>`;
  }

  // 不需要时间拆分的分类（技术动态 / 财经要点）：只渲染当天抓取的条目，
  // 不出现"过去7天"标签。
  if (!usesTimeSplit) {
    const todaySrc = filterByTime(sub.sources, true);
    return `<div class="sub-content${activeCls}" ${subAttr}>
      ${renderSourcesBlock(category, sub.id, todaySrc)}
    </div>`;
  }

  // 需要时间拆分（广东地区IPO）：当天 vs 过去7天（按公告时间 publishedAt）。
  const { today: todaySrc, past: pastSrc } = splitGdIpoByPublishedAt(
    sub.sources,
    date,
  );
  const todayCount = countItems(todaySrc);
  const pastCount = countItems(pastSrc);
  return `<div class="sub-content${activeCls}" ${subAttr}>
    <nav class="time-tabs">
      <button class="time-tab active" data-time="today" data-cat="${category}" data-sub="${escapeHtml(sub.id)}">${STR.timeToday}<span class="count">${todayCount}</span></button>
      <button class="time-tab" data-time="past" data-cat="${category}" data-sub="${escapeHtml(sub.id)}">${STR.timePast7}<span class="count">${pastCount}</span></button>
    </nav>
    <div class="time-contents">
      <div class="time-content active" data-time-content="today" data-cat="${category}" data-sub="${escapeHtml(sub.id)}">
        ${renderSourcesBlock(category, sub.id, todaySrc)}
      </div>
      <div class="time-content" data-time-content="past" data-cat="${category}" data-sub="${escapeHtml(sub.id)}">
        ${renderSourcesBlock(category, sub.id, pastSrc)}
      </div>
    </div>
  </div>`;
}

export function renderRawCategoryPanel(
  category: Category,
  subs: SubGroup[],
  date: string,
): string {
  if (subs.length === 0) {
    return `<p class="empty">${STR.emptyCategory}</p>`;
  }
  if (subs.length === 1) {
    return renderSubContent(category, subs[0], true, date);
  }
  const subTabs = subs
    .map((s, i) => {
      const count = s.sources.reduce((n, src) => n + src.items.length, 0);
      return `<button class="sub-tab${i === 0 ? " active" : ""}" data-sub="${escapeHtml(s.id)}" data-cat="${category}">${escapeHtml(s.name)}<span class="count">${count}</span></button>`;
    })
    .join("");
  const panels = subs
    .map((s, i) => renderSubContent(category, s, i === 0, date))
    .join("\n");
  return `<nav class="sub-tabs">${subTabs}</nav>\n<div class="sub-contents">${panels}</div>`;
}
