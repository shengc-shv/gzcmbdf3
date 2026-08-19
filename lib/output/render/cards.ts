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
 * 展示窗口（天）：所有面板统一展示最近 N 天发布的内容，按发布时间倒序。
 * （2026-08-19 用户调整：不再区分「当天/过去7天」时间拆分，全部展示最近 3 天。）
 */
export const DISPLAY_WINDOW_DAYS = 3;



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
  const time = formatDate(a.publishedAt ?? a.fetchedAt);
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
  // 多维度影响 chips（AI 多标签）：展示该条还影响的其他业务线，避免多归桶造成困惑
  const subTags =
    (a.subcategories && a.subcategories.length > 0
      ? a.subcategories
      : a.subcategory
        ? [a.subcategory]
        : []
    ).length > 0
      ? `<p class="article-subs">${(a.subcategories && a.subcategories.length > 0
          ? a.subcategories
          : a.subcategory
            ? [a.subcategory]
            : []
        )
          .map(
            (s) =>
              `<span class="sub-chip">${escapeHtml(SUBCATEGORY_LABELS[s] ?? s)}</span>`,
          )
          .join("")}</p>`
      : "";
  // News-style summary label for finance/politics, project-intro style for GH/tech.
  const newsy = a.category === "finance" || a.category === "politics";
  const summaryLabel = newsy ? STR.summaryLabelNews : STR.summaryLabelIntro;
  return `<article class="article">
  <h3 class="article-title"><a href="${url}" target="_blank" rel="noopener noreferrer">${title}</a></h3>
  ${meta ? `<p class="article-stats">${meta}</p>` : ""}
  ${metaLine ? `<p class="article-meta">${metaLine}</p>` : ""}
  ${subTags}
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
 * 保留每个源中「最近 days 天」的条目，并按时间倒序排序。
 * 时间判定统一为 `publishedAt ?? fetchedAt`（2026-08-19 用户确认：
 * 没有发布时间的采用信息采集时间）；两者皆无的保留（时间未知）。
 */
export function filterRecentDays(sources: SourceGroup[], days = DISPLAY_WINDOW_DAYS): SourceGroup[] {
  const cutoff = Date.now() - days * 86_400_000;
  return sources.map((s) => {
    const items = s.items
      .filter((a) => {
        const t = a.publishedAt ?? a.fetchedAt;
        if (!t) return true;
        return t.getTime() >= cutoff;
      })
      .sort((a, b) => {
        const at = (a.publishedAt ?? a.fetchedAt)?.getTime() ?? 0;
        const bt = (b.publishedAt ?? b.fetchedAt)?.getTime() ?? 0;
        return bt - at;
      });
    return { ...s, items };
  });
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


export function countItems(sources: SourceGroup[]): number {
  return sources.reduce((n, s) => n + s.items.length, 0);
}

/** 最近 N 天（默认 DISPLAY_WINDOW_DAYS）的条数合计——顶部 tab 徽标。 */
export function countItemsRecent(subs: SubGroup[], days = DISPLAY_WINDOW_DAYS): number {
  return subs.reduce((n, sg) => n + countItems(filterRecentDays(sg.sources, days)), 0);
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
  const activeCls = isActive ? " active" : "";
  const subAttr = `data-sub-content="${escapeHtml(sub.id)}" data-cat="${category}"`;

  // 空 sub 直接占位
  if (sub.sources.length === 0) {
    return `<div class="sub-content${activeCls}" ${subAttr}><p class="empty">${STR.emptySource}</p></div>`;
  }

  // 统一展示窗口（2026-08-19 用户调整）：所有分类展示最近 DISPLAY_WINDOW_DAYS 天
  // 发布的内容，按发布时间倒序；不再区分「当天 / 过去7天」时间拆分。
  const recent = filterRecentDays(sub.sources, DISPLAY_WINDOW_DAYS);
  return `<div class="sub-content${activeCls}" ${subAttr}>
    ${renderSourcesBlock(category, sub.id, recent)}
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
      // 计数与内容口径一致：最近 DISPLAY_WINDOW_DAYS 天、按发布时间倒序
      const count = countItems(filterRecentDays(s.sources, DISPLAY_WINDOW_DAYS));
      return `<button class="sub-tab${i === 0 ? " active" : ""}" data-sub="${escapeHtml(s.id)}" data-cat="${category}">${escapeHtml(s.name)}<span class="count">${count}</span></button>`;
    })
    .join("");
  const panels = subs
    .map((s, i) => renderSubContent(category, s, i === 0, date))
    .join("\n");
  return `<nav class="sub-tabs">${subTabs}</nav>\n<div class="sub-contents">${panels}</div>`;
}
