import type {
  ArticleInput,
  BriefItem,
  DailyReport,
  TradingSection,
} from "../types";
import type { WatchlistPick } from "../ai/trading-commentary";
import { REPORT_LOCALE,loadAllSources  } from "../sources/registry";
import { STR, SUBCATEGORY_ORDER, SUBCATEGORY_LABELS } from "./render/i18n";
import {
  renderRawCategoryPanel,
  countItemsToday,
  CATEGORY_LABELS,
  CATEGORY_DIGEST_LABELS,
  TECH_MAIN_SUBS,
  type SourceGroup,
  type SubGroup,
  type RawByCategory,
} from "./render/cards";
import { renderTradingPanel, renderExecutiveSummary, TREND_LABEL } from "./render/sections";
export type { SourceGroup, SubGroup, RawByCategory } from "./render/cards";
import { TIER_COLORS, THEME_CSS } from "./render/theme";
import { getReportTz } from "../utils";
import type { Category, SourceDef } from "../sources/types";
import { SOURCE_TIER_LABELS, type SourceTier } from "../sources/tiers";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { V2EX_OFF_TOPIC_RE } from "../sources/v2ex";
import type { TickerAnalysis } from "../trading/signals";
import {
  getAssetGroupLabels,
  ASSET_GROUP_ORDER,
  type AssetGroup,
} from "../trading/watchlist";
import { classifyGdIpo, type GdIssuerRegistry } from "../classify/gdIpo";


// ----- types -----


// ----- labels & ordering -----

/**
 * 广州商机杂讯兜底词表（与 scripts/analyze-gz.ts 的 HEURISTIC_RULES 无关词表一致，
 * 生产验证过）。南沙/政府列表页会长期挂旧政策文件库存（电费补贴/招聘/摆卖/殡葬/
 * 诊所备案等），LLM 相关性分类偶有漏网——此词表在渲染层兜底过滤。
 */
const GZ_NOISE_RE =
  /历史建筑|门前三包|禁燃|黑烟|柴油货车|限行|交通管制|禁停|环境保护|生态|绿化|消防|防汛|水务|河道|畜牧|兽医|文物|非遗|民政局|街道办|居委会|司法厅|决定书|注销|律师|执业|行政许可|招聘|竞投|摆卖|摊位|路灯|景观照明|电费补贴|排污|噪声|拆迁补偿|工伤|教师资格|招生|赛事|演出|博物馆|公园|厕所|殡葬|诊所备案|欠薪|养犬|渔港|见义勇为|储备土地|低保|入学|气瓶/;



/**
 * Per-source item caps in the raw display, keyed by "category:subcategory".
 * Each source inside the subcategory shows up to N items. Missing keys = no cap.
 *
 * Default 20 across all L3-tabbed subcategories keeps each tab a single
 * comfortable scroll instead of 25-30 items. Merged subgroups (blog-weekly,
 * finance:news, politics:world) ignore this — they use MERGED_SUBGROUP_LIMITS.
 */
export const SOURCE_DISPLAY_LIMITS: Record<string, number> = {
  "tech:github-trending": 10,
  "tech:cn-community": 10,
  // 热门论文 / X 推文：单源子标签，每源≤5（保留抓取端热度/点赞排序，不切合并流）
  "tech:x-viral": 5,
  "tech:trending-papers": 5,
};

/**
 * Sources whose fetcher returns items already sorted by an engagement/heat
 * algorithm we want to preserve. groupRaw skips its default date-desc sort
 * for these so the final render reflects the source's own ranking.
 */
const PRESERVE_FETCH_ORDER_SOURCES = new Set([
  "attentionvc-ai",
  "huggingface-papers",
]);

function displayLimitFor(
  category: Category,
  subId: string | undefined,
): number | undefined {
  if (!subId) return undefined;
  return SOURCE_DISPLAY_LIMITS[`${category}:${subId}`];
}

/**
 * Take the first `n` items of `list`, but always put today's freshly-fetched
 * items first (preserving relative order inside each group). The renderer
 * only shows `fetchedToday` items under "当天", so slicing a mixed rolling
 * list naively lets older history entries crowd out today's items — e.g.
 * trending papers whose history copy sorts before today's fetch, leaving
 * the sub-tab empty.
 */
function takeFirstToday(list: ArticleInput[], n: number): ArticleInput[] {
  if (list.length <= n) return list;
  const today: ArticleInput[] = [];
  const past: ArticleInput[] = [];
  for (const a of list) (a.fetchedToday === true ? today : past).push(a);
  return today.concat(past).slice(0, n);
}

/**
 * Cheap local heuristic for cross-source story dedup (no LLM cost):
 * normalize a title to lowercase alphanumeric tokens, then compare either
 * by exact normalized equality or by token Jaccard similarity.
 */
function normalizeTitleForDedup(t: string): string {
  return (t ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenJaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Collapse same-story items inside a merged subgroup. The kept item (first
 * in list order) records the other sources in `alsoFrom` so the renderer can
 * show "多家来源：…". Thresholds are conservative to avoid merging distinct
 * stories that merely share keywords.
 */
function mergeSimilarStories(items: ArticleInput[]): ArticleInput[] {
  const groups: { rep: ArticleInput }[] = [];
  for (const a of items) {
    const norm = normalizeTitleForDedup(a.title);
    const tokens = norm.split(" ").filter(Boolean);
    const target = groups.find((g) => {
      const gNorm = normalizeTitleForDedup(g.rep.title);
      if (gNorm === norm) return true;
      if (tokens.length < 3) return false; // too short to risk a merge
      return tokenJaccard(tokens, gNorm.split(" ").filter(Boolean)) >= 0.75;
    });
    if (!target) {
      groups.push({ rep: a });
      continue;
    }
    if (a.source && a.source !== target.rep.source) {
      target.rep.alsoFrom = target.rep.alsoFrom ?? [];
      if (!target.rep.alsoFrom.includes(a.source)) target.rep.alsoFrom.push(a.source);
    }
  }
  return groups.map((g) => g.rep);
}

/**
 * Subcategories that should collapse their sources into a single flat
 * time-sorted list (no L3 source tabs), keyed by "category:subcategory".
 * Value = number of items kept after merging. Each rendered article
 * will display its `source` label inline since the per-source tab row
 * is suppressed.
 *
 * Used when:
 *  - sources are heterogeneous but each publishes few items (blog-weekly)
 *  - the user explicitly wants a curated time-sorted feed rather than
 *    per-source browsing (finance:news, only authoritative sources)
 *
 * Exported so daily.ts can read the cap to keep enrichment in sync.
 */
export const MERGED_SUBGROUP_LIMITS: Record<string, number> = {
  // 技术动态 / 财经要点 合并流：每数据源≤5、子标签整体≤10
  // （省钱 + 避免单一源霸屏）。典型子标签：AI媒体 / 国内技术 / 国际财经。
  "tech:ai-news": 10,
  "tech:cn-tech": 10,
  "finance:news": 10,
  // 国内财经：上限 20，按接入的信息源平摊（见 groupRaw 的 cn-finance 逻辑）
  "finance:cn-finance": 20,
  // 时政不在本次范围，保留原整体上限
  "politics:world": 15,
};

/**
 * 合并流中单源最多贡献的条数。避免某一源条目过多、按时间降序时把同子标签下
 * 其他源整屏挤出（例如国内财经若某源日期较新、10 条上限会被它独占）。
 * 技术动态 / 财经要点 合并子标签统一为 5（典型：AI媒体 / 国内技术 / 国际财经）。
 * 国内财经（cn-finance）不在此表——它按「子标签上限 / 接入源数量」平摊（20/源数）。
 * 缺省不限制（undefined）即沿用旧行为。
 */
export const MERGE_PER_SOURCE_CAP: Record<string, number> = {
  "tech:ai-news": 5,
  "tech:cn-tech": 5,
  "finance:news": 5,
};

/**
 * Politics sources (especially Al Jazeera / BBC / The Diplomat) regularly
 * mix in World Cup / Olympic / football coverage. Filter at the title level
 * so the merged "国际要闻" stream stays politics-only.
 *
 * Pattern is intentionally specific — avoid generic words like "team" or
 * "match" that overlap with diplomacy headlines.
 */
const POLITICS_SPORTS_RE =
  /\b(World\s*Cup|Olympics?|UEFA|FIFA|NBA|NFL|NHL|MLB|ATP|WTA|Premier\s*League|Bundesliga|La\s*Liga|Serie\s*A|Champions\s*League|Eurovision|Wimbledon|Grand\s*Slam|F1|Formula\s*1|Ronaldo|Messi|Mbappe|Beckham|Lukaku|Mitoma|sportsman|footballer|squad)\b|世界杯|奥运|残奥|冬奥|欧冠|英超|西甲|意甲|德甲|网球|足球|篮球|高尔夫|棒球|板球|橄榄球/i;

export function isSportsArticle(title: string): boolean {
  return POLITICS_SPORTS_RE.test(title);
}

// 广东发行人注册表（结构化地域信号，优先于关键词兜底）
let _gdIssuersCache: GdIssuerRegistry | undefined | null = null;
function loadGdIssuers(): GdIssuerRegistry | undefined {
  if (_gdIssuersCache !== null) return _gdIssuersCache ?? undefined;
  try {
    const raw = readFileSync(
      join(process.cwd(), "data", "gd-issuers.json"),
      "utf8",
    );
    _gdIssuersCache = JSON.parse(raw) as GdIssuerRegistry;
  } catch {
    _gdIssuersCache = undefined;
  }
  return _gdIssuersCache ?? undefined;
}

function mergedLimitFor(
  category: Category,
  subId: string,
): number | undefined {
  return MERGED_SUBGROUP_LIMITS[`${category}:${subId}`];
}

// ----- grouping -----

export function groupRaw(
  articles: ArticleInput[],
  registry: SourceDef[],
): RawByCategory {
   const subcatOf = new Map<string, string | undefined>();
  for (const s of registry) subcatOf.set(s.id, s.subcategory);
  // Keep articles from *every* registered source id — including disabled ones
  // like gd-local-scraper. When scripts/render.ts re-renders against a stale
  // sidecar, that file still holds the disabled source's fetched data; we must
  // not silently drop it. (We deliberately do NOT filter by `enabled !== false`.)
  const knownSourceIds = new Set(loadAllSources().map((s) => s.id));

  // console.log('[groupRaw] enabledIds 包含的 sourceId 列表:', Array.from(enabledIds));
  // console.log('[groupRaw] gd-local-scraper 是否在 enabledIds 中:', enabledIds.has('gd-local-scraper'));

  type Bucket = { sourceName: string; items: ArticleInput[] };
  const buckets: Record<Category, Map<string, Bucket>> = {
    tech: new Map(),
    finance: new Map(),
    politics: new Map(),
    'gd-ipo': new Map(),
    ipo: new Map(),
    gz: new Map(),
  };

  // 广东地区IPO：文章级三道闸分类后，按 classifier 决定的子标签归桶
  // （一个源如巨潮可能同时含深/沪/京，不能再靠 sourceId 定 sub）。
  const gdSubs = new Map<string, Bucket>();
  // 全国IPO/新股：crawler 已按 region 分流好（非广东沪深 + 媒体源），
  // 直接按 registry 的 subcategory 归桶（sse/szse/ipo-media），不再过三道闸。
  const ipoSubs = new Map<string, Bucket>();
  // 广东公司但非IPO类（财报/分红/解禁等）→ 转财经要点「news」合并流
  const financeExtra: ArticleInput[] = [];
  const gdIssuers = loadGdIssuers();

  // console.log('[groupRaw] buckets keys:', Object.keys(buckets));
  // console.log('[groupRaw] buckets[gd-ipo] size:', buckets['gd-ipo']?.size);
  // Pre-seed empty buckets for every enabled source so per-source-tabbed
  // subcategories (e.g. cn-community) still render a tab for sources that
  // returned 0 items today. Without this, a transient LinuxDo Cloudflare
  // block would silently collapse the L3 tab nav, making users wonder
  // whether the other forum even exists.
  for (const s of registry) {
    if (s.enabled === false) continue;
    if (!buckets[s.category].has(s.id)) {
      buckets[s.category].set(s.id, { sourceName: s.name, items: [] });
    }
  }

  for (const a of articles) {
    if (!knownSourceIds.has(a.sourceId)) continue;
    // 条目级相关性过滤：AI/启发式判断「与银行业务无关」的条目不进任何面板。
    // 仅对 广州商机(gz) 与 宏观政策(finance) 生效——这两个分类定位是"商机/政策"，
    // 需要精准过滤（历史建筑/招聘/娱乐等）；tech/ipo/politics 参考区不做银行相关
    // 过滤，避免 LLM 误判把 GitHub/论文/IPO 全清空。
    if (a.relevant === false && (a.category === "gz" || a.category === "finance")) continue;
    // gz 杂讯兜底（不依赖 LLM）：AI 未明确判相关(relevant!==true) 且标题命中
    // 城市治理/民生杂讯词（电费补贴/招聘/摆卖/殡葬/诊所备案等）→ 过滤。
    // 南沙/政府列表页会长期挂旧政策文件库存，LLM 分类偶有漏网（ai_relevant=null），
    // 此兜底保证垃圾内容绝不进商机面板。
    if (
      a.category === "gz" &&
      a.relevant !== true &&
      GZ_NOISE_RE.test(a.title)
    )
      continue;
    if (a.category === "politics" && isSportsArticle(a.title)) continue;
    if (
      (a.sourceId === "v2ex-hot" || a.sourceId === "linuxdo") &&
      V2EX_OFF_TOPIC_RE.test(a.title)
    )
      continue;
    // 广东地区IPO：先过三道闸分类器，再决定归哪个子标签 / 是否转财经 / 丢弃
    if (a.category === "gd-ipo") {
      const res = classifyGdIpo(
        {
          title: a.title,
          excerpt: a.excerpt,
          url: a.url,
          sourceId: a.sourceId,
          source: a.source,
          publishedAt: a.publishedAt,
          stockCode: (a as ArticleInput & { stockCode?: string }).stockCode,
          registeredProvince: (a as ArticleInput & { registeredProvince?: string })
            .registeredProvince,
        },
        { gdIssuers },
      );
      if (res.action === "drop") continue;
      if (res.action === "finance") {
        financeExtra.push(a);
        continue;
      }
      let b = gdSubs.get(res.sub);
      if (!b) {
        b = { sourceName: SUBCATEGORY_LABELS[res.sub] ?? res.sub, items: [] };
        gdSubs.set(res.sub, b);
      }
      b.items.push(a);
      continue;
    }
    // 全国IPO/新股：按 sourceId → registry subcategory 归桶（sse/szse/bse 交易所权威源）
    if (a.category === "ipo") {
      const sub = subcatOf.get(a.sourceId) ?? "sse";
      let b = ipoSubs.get(sub);
      if (!b) {
        b = { sourceName: SUBCATEGORY_LABELS[sub] ?? sub, items: [] };
        ipoSubs.set(sub, b);
      }
      b.items.push(a);
      continue;
    }
    const map = buckets[a.category];
    let b = map.get(a.sourceId);
    if (!b) {
      b = { sourceName: a.source, items: [] };
      map.set(a.sourceId, b);
    }
    
    b.items.push(a);
    // console.log('[groupRaw] buckets[gd-ipo] size after filling:', buckets['gd-ipo']?.size);
  }

  for (const cat of Object.keys(buckets) as Category[]) {
    for (const [id, b] of buckets[cat].entries()) {
      if (PRESERVE_FETCH_ORDER_SOURCES.has(id)) continue;
      b.items.sort(
        (a, b) =>
          (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
      );
    }
  }

  // 广东公司但非IPO类（财报/分红/解禁等）→ 并入财经要点「国内财经」合并流
  if (financeExtra.length > 0) {
    const sid = "_gd_finance";
    subcatOf.set(sid, "cn-finance");
    const b =
      buckets["finance"].get(sid) ??
      ({ sourceName: "广东公司公告", items: [] } as Bucket);
    b.items.push(...financeExtra);
    buckets["finance"].set(sid, b);
  }

  // 按 SUBCATEGORY_ORDER 构建子标签，始终渲染全部二级标签（空则占位）。
  // gd-ipo 用三道闸分类结果 gdSubs；全国 ipo 用 subcatOf 归桶结果 ipoSubs。
  function buildOrderedSubs(subMap: Map<string, Bucket>, cat: Category): SubGroup[] {
    const order = SUBCATEGORY_ORDER[cat] ?? [];
    const subs: SubGroup[] = [];
    for (const subId of order) {
      const b = subMap.get(subId);
      if (!b || b.items.length === 0) {
        subs.push({
          id: subId,
          name: SUBCATEGORY_LABELS[subId] ?? subId,
          sources: [],
        });
        continue;
      }
      b.items.sort(
        (a, b) =>
          (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
      );
      subs.push({
        id: subId,
        name: SUBCATEGORY_LABELS[subId] ?? subId,
        sources: [
          {
            sourceId: "_merged",
            sourceName: SUBCATEGORY_LABELS[subId] ?? subId,
            items: b.items,
            merged: true,
          },
        ],
      });
    }
    return subs;
  }

  function toSourceGroup(
    sourceId: string,
    b: Bucket,
    limit: number | undefined,
  ): SourceGroup {
    return {
      sourceId,
      sourceName: b.sourceName,
      items: limit ? takeFirstToday(b.items, limit) : b.items,
    };
  }

  function sortByRegistry(list: SourceGroup[]): SourceGroup[] {
    return [...list].sort((a, b) => {
      const ia = registry.findIndex((s) => s.id === a.sourceId);
      const ib = registry.findIndex((s) => s.id === b.sourceId);
      return ia - ib;
    });
  }

 const out: RawByCategory = {
  tech: [],
  finance: [],
  politics: [],
  'gd-ipo': [],
  ipo: [],
  gz: [],
  };
  
  for (const cat of Object.keys(buckets) as Category[]) {
    // 广东地区IPO / 全国IPO 已由各自分流逻辑（三道闸 / subcatOf）文章级分发，单独构建
    if (cat === "gd-ipo") {
      out["gd-ipo"] = buildOrderedSubs(gdSubs, "gd-ipo");
      continue;
    }
    if (cat === "ipo") {
      out["ipo"] = buildOrderedSubs(ipoSubs, "ipo");
      continue;
    }
    const order = SUBCATEGORY_ORDER[cat];
    if (!order) {
      // Flat: one synthetic subgroup with every source.
      const sources: SourceGroup[] = [];
      for (const [id, b] of buckets[cat].entries()) {
        sources.push(toSourceGroup(id, b, undefined));
      }
      out[cat] = sources.length
        ? [{ id: "all", name: CATEGORY_LABELS[cat], sources: sortByRegistry(sources) }]
        : [];
      continue;
    }
    // Subcategory split: bucket each source under its registered subcategory.
    const subs: SubGroup[] = [];
    for (const subId of order) {
      const mergeLimit = mergedLimitFor(cat, subId);
      if (mergeLimit !== undefined) {
        // Merge: flatten all sources under this subcategory into a single
        // time-sorted SourceGroup. Articles keep their `source` field so
        // the renderer can label them.
        const flat: ArticleInput[] = [];
        // Per-source cap: fixed for most merged subgroups; 国内财经 shares
        // its subcategory limit evenly across the enabled sources.
        let perCap = MERGE_PER_SOURCE_CAP[`${cat}:${subId}`];
        if (perCap === undefined && subId === "cn-finance") {
          const n = registry.filter(
            (s) =>
              s.category === cat &&
              s.subcategory === subId &&
              s.enabled !== false,
          ).length;
          if (n > 0) perCap = Math.ceil((mergeLimit ?? 20) / n);
        }
        for (const [id, b] of buckets[cat].entries()) {
          // 条目级 subcategory 优先（AI/启发式分类），注册表源级兜底
          const matched = b.items.filter(
            (a) => (a.subcategory ?? subcatOf.get(id)) === subId,
          );
          if (matched.length) {
            flat.push(...(perCap ? takeFirstToday(matched, perCap) : matched));
          }
        }
        if (flat.length === 0) {
          if (cat === "finance") {
            subs.push({
              id: subId,
              name: SUBCATEGORY_LABELS[subId] ?? subId,
              sources: [],
            });
          }
          continue;
        }
        flat.sort(
          (a, b) =>
            (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
        );
        const top = takeFirstToday(flat, mergeLimit);
        if (top.length === 0) continue;
        // Cross-source story dedup: several sources may cover the same story.
        // Collapse near-identical titles into one item and record the other
        // sources on `alsoFrom` (cheap local heuristic — zero LLM calls).
        const deduped = mergeSimilarStories(top);
        subs.push({
          id: subId,
          name: SUBCATEGORY_LABELS[subId] ?? subId,
          sources: [
            {
              sourceId: "_merged",
              sourceName: SUBCATEGORY_LABELS[subId] ?? subId,
              items: deduped,
              merged: true,
            },
          ],
        });
        continue;
      }

      const limit = displayLimitFor(cat, subId);
      const sources: SourceGroup[] = [];
      for (const [id, b] of buckets[cat].entries()) {
        // 条目级 subcategory 优先（AI/启发式分类），注册表源级兜底
        const items = b.items.filter(
          (a) => (a.subcategory ?? subcatOf.get(id)) === subId,
        );
        if (items.length) {
          sources.push({ sourceId: id, sourceName: b.sourceName, items });
        }
      }
      // 广东地区IPO / 财经要点 / 广州商机 的二级标签始终渲染，即使当天为空也保留
      // 标签 + “暂无内容”占位，保证结构稳定可见（不折叠成单子标签）。
      if (sources.length === 0) {
        if (cat === 'gd-ipo' || cat === 'finance' || cat === 'gz') {
          subs.push({ id: subId, name: SUBCATEGORY_LABELS[subId] ?? subId, sources: [] });
          continue;
        }
        continue;
      }
      subs.push({
        id: subId,
        name: SUBCATEGORY_LABELS[subId] ?? subId,
        sources: sortByRegistry(sources),
      });
    }
    out[cat] = subs;
  }
  // Safety net: if gd-ipo has data but the subcategory split above produced
  // an empty panel (e.g. a future source whose subcategory isn't in
  // SUBCATEGORY_ORDER), force a flat render so the data is never lost.
  if (buckets['gd-ipo'] && buckets['gd-ipo'].size > 0 && (out['gd-ipo'] || []).length === 0) {
    const flatSources: SourceGroup[] = [];
    for (const [id, b] of buckets['gd-ipo'].entries()) {
      flatSources.push(toSourceGroup(id, b, undefined));
    }
    if (flatSources.length > 0) {
      out['gd-ipo'] = [{
        id: 'all',
        name: CATEGORY_LABELS['gd-ipo'],
        sources: sortByRegistry(flatSources),
      }];
    }
  }
  return out;
}


// ----- top-level renderer -----

export function renderHtml(
  report: DailyReport,
  raw: RawByCategory,
  date: string,
): string {
  const trading = report.trading;

  // "tech" L1 panel shows the main subs; the community sub-sources
  // (V2EX / LinuxDo) are not in this fork's default source config, so they
  // are filtered out and the tech panel renders only the configured subs.
  const techMainSubs = raw.tech.filter((s) => TECH_MAIN_SUBS.has(s.id));

  const sumItems = (subs: SubGroup[]) =>
    subs.reduce(
      (n, sg) => n + sg.sources.reduce((m, s) => m + s.items.length, 0),
      0,
    );
  const counts = {
    tech: countItemsToday(techMainSubs),
    finance: countItemsToday(raw.finance),
    'gd-ipo': sumItems(raw['gd-ipo'] || []),
    ipo: sumItems(raw['ipo'] || []),
    gz: sumItems(raw['gz'] || []),
     politics: sumItems(raw.politics),
  };

  return `<!doctype html>
<html lang="${REPORT_LOCALE === "en" ? "en" : "zh-CN"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${STR.siteTitle} · ${date}</title>
<style>
${THEME_CSS}
  </style>
</head>
<body>
<main>
  <header class="report-header">
    <span class="eyebrow">${STR.siteTitle}</span>
    <h1 class="report-title">${date}</h1>
    ${process.env.WEB_MODE === "true" ? `<a class="archive-link" href="../archive.html">${STR.archiveLink}</a>` : ""}
  </header>

  ${report.executive_summary ? renderExecutiveSummary(report.executive_summary) : ""}

  <nav class="tabs" role="tablist">
    <button class="tab active" data-tab="finance">${CATEGORY_LABELS.finance}<span class="count">${counts.finance}</span></button>
    ${trading ? `<button class="tab" data-tab="trading">${STR.catTrading}<span class="count">${trading.tickers.length}</span></button>` : ""}
    <button class="tab" data-tab="gz">${CATEGORY_LABELS['gz']}<span class="count">${counts['gz']}</span></button>
    <button class="tab tab-fold" data-tab="ipo">${CATEGORY_LABELS['ipo']}<span class="count">${counts['ipo']}</span></button>
    <button class="tab tab-fold" data-tab="tech">${CATEGORY_LABELS.tech}<span class="count">${counts.tech}</span></button>
  </nav>

  <section class="panel active" data-panel="finance">
    ${renderRawCategoryPanel("finance", raw.finance, date)}
  </section>
  ${trading ? `<section class="panel" data-panel="trading">${renderTradingPanel(trading)}</section>` : ""}
  <section class="panel" data-panel="gz">
    ${renderRawCategoryPanel("gz", raw["gz"] || [], date)}
  </section>
  <section class="panel" data-panel="ipo">
    ${renderRawCategoryPanel("ipo", raw["ipo"] || [], date)}
  </section>
  <section class="panel" data-panel="tech">
    ${renderRawCategoryPanel("tech", techMainSubs, date)}
  </section>
  
  

  <footer>
    ${STR.footer}
  </footer>
</main>
<script>
  document.querySelectorAll('.tabs > .tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.dataset.tab;
      document.querySelectorAll('.tabs > .tab').forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
      document.querySelectorAll('.panel').forEach(function (p) {
        p.classList.toggle('active', p.dataset.panel === target);
      });
    });
  });
  // Scope sub-tab / source-tab toggles to the parent .panel so two L1 panels
  // can share the same data-cat (e.g. tech main + community both data-cat=tech)
  // without stomping on each other's active state.
  document.querySelectorAll('.sub-tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var panel = btn.closest('.panel');
      if (!panel) return;
      var sub = btn.dataset.sub;
      panel.querySelectorAll('.sub-tab').forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
      panel.querySelectorAll('.sub-content').forEach(function (p) {
        p.classList.toggle('active', p.dataset.subContent === sub);
      });
    });
  });
  // Time split (当天 / 过去7天) — scoped to the parent .sub-content so it
  // doesn't interfere with sibling L2 tabs sharing the same data-cat.
  document.querySelectorAll('.time-tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var subContent = btn.closest('.sub-content');
      if (!subContent) return;
      var time = btn.dataset.time;
      subContent.querySelectorAll('.time-tab').forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
      subContent.querySelectorAll('.time-content').forEach(function (p) {
        p.classList.toggle('active', p.dataset.timeContent === time);
      });
    });
  });
  document.querySelectorAll('.source-tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var subContent = btn.closest('.sub-content');
      if (!subContent) return;
      var src = btn.dataset.source;
      subContent.querySelectorAll('.source-tab').forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
      subContent.querySelectorAll('.source-content').forEach(function (p) {
        p.classList.toggle('active', p.dataset.sourceContent === src);
      });
    });
  });
  // Trading panel: asset-group sub-tabs (US/crypto/china/commodity)
  document.querySelectorAll('.trading-group-tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var grp = btn.dataset.group;
      document.querySelectorAll('.trading-group-tab').forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
      document.querySelectorAll('.trading-group-content').forEach(function (p) {
        p.classList.toggle('active', p.dataset.group === grp);
      });
    });
  });
</script>
</body>
</html>`;
}

// ----- trading panel -----

const SIGNAL_TONE: Record<string, "bull" | "bear" | "caution"> = {
  "golden-cross": "bull",
  "macd-bull-cross": "bull",
  "above-sma50-sma200": "bull",
  "near-52w-high": "bull",
  "death-cross": "bear",
  "macd-bear-cross": "bear",
  "below-sma50-sma200": "bear",
  "near-52w-low": "bear",
  "rsi-overbought": "caution",
  "rsi-oversold": "caution",
};

// ----- markdown -----

function renderBriefMarkdown(b: BriefItem): string {
  const importance = Number.isFinite(b.importance) ? b.importance : 0;
  return `### [${b.title}](${b.url})\n${b.source} · ${STR.mdImportance} ${importance}/10\n\n${b.summary}\n`;
}

function renderSectionMarkdown(title: string, briefs: BriefItem[]): string {
  if (briefs.length === 0) return "";
  return `## ${title}\n\n${briefs.map(renderBriefMarkdown).join("\n")}\n`;
}

export function renderMarkdown(report: DailyReport, date: string): string {
  const blocks: string[] = [];
  blocks.push(`# ${STR.siteTitle} · ${date}\n`);
  if (report.hero_headline) blocks.push(`> ${report.hero_headline}\n`);
  if (report.daily_overview) {
    blocks.push(`## ${STR.mdTodayOverview}\n\n${report.daily_overview}\n`);
  }
  blocks.push(
    renderSectionMarkdown(CATEGORY_DIGEST_LABELS.tech, report.tech_briefs),
  );
  blocks.push(
    renderSectionMarkdown(
      CATEGORY_DIGEST_LABELS.finance,
      report.finance_briefs,
    ),
  );
  blocks.push(
    renderSectionMarkdown(
      CATEGORY_DIGEST_LABELS.politics,
      report.politics_briefs,
    ),
  );
  blocks.push(
    renderSectionMarkdown(
      CATEGORY_DIGEST_LABELS['gd-ipo'],
      report.gd_ipo_briefs,
    ),
  );
  if (report.editor_note) {
    blocks.push(`## ${STR.mdEditorNote}\n\n${report.editor_note}\n`);
  }
  if (report.keywords.length > 0) {
    blocks.push(
      `## ${STR.mdTodayKeywords}\n\n${report.keywords.map((k) => `\`#${k}\``).join(" ")}\n`,
    );
  }
  return blocks.filter(Boolean).join("\n");
}
