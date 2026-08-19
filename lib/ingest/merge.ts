/**
 * 归一化层（边界②）：把采集产物（TS 源 + .mjs 爬虫）汇合成统一结构。
 *
 * 边界纪律：本模块是**唯一**允许做以下事情的地方——
 *  1. 按 URL 去重（dedupeByUrl）
 *  2. region 分流 + `gd-`→`gz-` 前缀改写（routeRegion）
 *  3. 源等级 tier 透传（toMergeArticle）
 * 其他层一律只读归一化结果。全部为纯函数、无 IO，便于单测。
 */
import type { SourceTier } from "../sources/tiers";
import type { Category } from "../sources/types";

/** .mjs 爬虫产物（crawled-articles.json / crawled-gz.json 的条目）。 */
export interface CrawledArticle {
  sourceId?: string;
  source?: string;
  title?: string;
  url?: string;
  excerpt?: string;
  publishedAt?: string;
  /** 来源地域标记：gz（招行广州分行辖区）/ gd / nation / 其它或缺省。 */
  region?: string;
  category?: string;
  summary?: string;
  /** 源等级（T6）：T1 官方一手 / T1.5 准官方·机构一手 / T2 媒体·智库。 */
  tier?: SourceTier;
}

/** 爬虫数据的两条进入路径：IPO/新股（crawled-articles.json）与广州商机（crawled-gz.json）。 */
export type CrawlMode = "ipo" | "gz";

/** 归一化后的统一文章结构（与 ArticleInput 结构兼容，由调用方透传）。 */
export interface MergeArticle {
  sourceId: string;
  source: string;
  title: string;
  url: string;
  excerpt: string;
  publishedAt?: Date;
  category: Category;
  summary: string;
  tier?: SourceTier;
}

export interface RouteOpts {
  /** gz 模式下，若调用方查得到注册表 category（如 gz-gov → finance）则传入，缺省 'gz'。 */
  gzCategory?: Category;
  /** ipo 模式下爬虫条目的 region 标记（'gz' → 归入广州辖区并改写 gz- 前缀）。 */
  region?: string;
}

/**
 * region 分流 + 前缀改写（原 daily.ts 第 400-402 行逻辑的纯函数版）。
 * - ipo 模式：region==='gz' → category='gz' 且 sourceId `gd-`→`gz-` 改写；否则 category='ipo' 不改写。
 * - gz 模式：sourceId 原样保留，category 用 gzCategory ?? 'gz'。
 */
export function routeRegion(
  srcId: string,
  mode: CrawlMode,
  opts: RouteOpts = {},
): { sourceId: string; category: Category } {
  if (mode === "ipo") {
    const category = opts.region === "gz" ? "gz" : "ipo";
    const sourceId = category === "gz" ? srcId.replace(/^gd-/, "gz-") : srcId;
    return { sourceId, category };
  }
  return { sourceId: srcId, category: opts.gzCategory ?? "gz" };
}

/** 单条爬虫产物 → MergeArticle（含默认值映射与 tier 透传）。 */
export function toMergeArticle(
  item: CrawledArticle,
  mode: CrawlMode,
  opts: RouteOpts = {},
): MergeArticle {
  const srcId = item.sourceId || (mode === "ipo" ? "gd-local-scraper" : "gz-local");
  const { sourceId, category } = routeRegion(srcId, mode, {
    gzCategory: opts.gzCategory,
    region: item.region,
  });
  return {
    sourceId,
    source: item.source || (mode === "ipo" ? "广东本地爬虫" : "广州商机"),
    title: item.title || "无标题",
    url: item.url || "",
    excerpt: item.excerpt || "",
    publishedAt: item.publishedAt ? new Date(item.publishedAt) : undefined,
    category,
    summary: item.summary || "",
    ...(item.tier ? { tier: item.tier } : {}),
  };
}

/** 按 URL 去重合并：保留 base 中已存在者（incoming 重复项跳过），返回合并结果与计数。 */
export function dedupeByUrl<T extends { url: string }>(
  base: T[],
  incoming: T[],
): { merged: T[]; added: number; skipped: number } {
  const merged = [...base];
  let added = 0;
  for (const it of incoming) {
    if (merged.some((a) => a.url === it.url)) continue;
    merged.push(it);
    added++;
  }
  return { merged, added, skipped: incoming.length - added };
}
