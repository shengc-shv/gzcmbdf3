import "./_env";

import fs from "node:fs";
import path from "node:path";

import { sources, loadAllSources, REPORT_LOCALE } from "../lib/sources/registry";
import { SOURCE_ROUTE } from "../lib/sources/constants";
import type { Category } from "../lib/sources/types";
import { fetchSource } from "../lib/sources/dispatch";
import {
  toMergeArticle,
  dedupeByUrl,
  filterByWindow,
  type CrawledArticle,
} from "../lib/ingest/merge";
import { fetchCrawledArticles } from "../lib/sources/crawlers";
import {
  loadLocalAcquired,
  filterLocalAcquiredRecent,
} from "../lib/sources/local-acquired";
import { applyKeywordFilter } from "../lib/filters/keyword-filter";
import {
  keywordFilterEnabled,
  keywordFilterFallbackEnabled,
  loadKeywordConfig,
  dedupSimilarEnabled,
  loadDedupConfig,
} from "../lib/filters/config";
import {
  dedupeByTitleSimilarity,
  dedupeAgainstHistory,
  type HistorySimilarEntry,
} from "../lib/ingest/dedup-similar";
import type { FilterResult, RawArticleInput } from "../lib/filters/types";
import {
  type ArticleInput,
  type BriefItem,
  type DailyReport,
} from "../lib/types";
import { getModelTag, validateBackendCredentials } from "../lib/ai/llm";
import {
  enrichFinanceNewsSummaries,
  enrichGithubTrendingSummaries,
} from "../lib/ai/enrich";
import {
  groupRaw,
  isSportsArticle,
  MERGED_SUBGROUP_LIMITS,
  MERGE_PER_SOURCE_CAP,
  SOURCE_DISPLAY_LIMITS,
  renderHtml,
  renderMarkdown,
  type RawByCategory,
} from "../lib/output/render";
import { DISPLAY_WINDOW_DAYS } from "../lib/output/render/cards";
import {
  loadHistory,
  buildRolling,
  saveHistory,
  type HistoryStore,
} from "../lib/output/history";
import { analyzeWatchlist } from "../lib/trading/runner";
import { classifyItemsWithLlm } from "../lib/ai/item-classifier";
import { fetchCryptoFearGreed } from "../lib/trading/fear-greed";
import { fetchCryptoGlobal } from "../lib/trading/coingecko";
import { generateTradingCommentary } from "../lib/ai/trading-commentary";
import { generateExecutiveSummary, selectExecutiveSummary, writeStore, loadStore } from "../lib/ai/executive-summary";
import type { TradingSection } from "../lib/types";
import { todayKey } from "../lib/utils";
import {
  loadAiAssets,
  saveAiAssets,
  dailyAssetKey,
  assetSummary,
  assetDaily,
  type AiAssetStore,
  type ArticleAiAsset,
} from "../lib/ai/assets";
import type { ExecutiveSummary } from "../lib/ai/executive-summary";
import { REPORTS_DIR } from "../lib/output/paths";

// SKIP_AI 开关已收敛到 lib/ai/mode.ts（唯一 env 读取点，行为不变；stage 维度供 M2-③ 埋点复用）。
import { aiEnabled } from "../lib/ai/mode";
const SKIP_AI = !aiEnabled();

/**
 * Rolling 30-day article history + AI-summary cache. Loaded once in main(),
 * read by every `enrich*` helper (to skip LLM calls for already-analyzed
 * URLs), and rewritten at the end of the run.
 */
let history: HistoryStore = {};
/** M2-④：AI 付费产物账本（data/ai-assets/store.json）。读取优先、写回 append-only。 */
let aiAssets: AiAssetStore = {};

/**
 * Reuse previously-generated AI summaries from the history so we don't pay
 * to re-analyze the same URL. Returns the subset that still needs analysis.
 */
function applyCache(items: ArticleInput[]): ArticleInput[] {
  const pending: ArticleInput[] = [];
  for (const a of items) {
    // M2-④：AI 资产账本优先（付费资产永不丢），history 缓存兜底
    const cached = assetSummary(aiAssets, a.url) ?? history[a.url]?.summary;
    if (cached) {
      a.summary = cached;
    } else {
      pending.push(a);
    }
  }
  return pending;
}

async function fetchAll(): Promise<ArticleInput[]> {
  const articles: ArticleInput[] = [];
  const enabled = sources.filter((s) => s.enabled !== false);
  for (const source of enabled) {
    try {
      const items = await fetchSource(source);
      console.log(`  ${source.id.padEnd(20)} ${items.length}`);
      // 采集层声明源等级 tier（T6）：源定义 → 文章；
      // 无发布时间 → 回退采集时间（本次抓取时刻）
      articles.push(
        ...items.map((it) => ({
          ...it,
          source: source.name,
          tier: source.tier,
          ...(it.publishedAt ? {} : { fetchedAt: new Date() }),
        })),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  ${source.id.padEnd(20)} FAILED — ${msg}`);
    }
  }
  return articles;
}

async function enrichGhTrending(articles: ArticleInput[]): Promise<void> {
  // Only the final displayed slice — matches SOURCE_DISPLAY_LIMITS["tech:github-trending"].
  const gh = articles
    .filter((a) => a.sourceId === "github-trending")
    .slice(0, SOURCE_DISPLAY_LIMITS["tech:github-trending"] ?? 20);
  if (gh.length === 0) return;
  const pending = applyCache(gh);
  if (pending.length === 0) {
    console.log(`[daily] enriching GitHub Trending: ${gh.length} 条全部命中历史缓存，跳过 LLM`);
    return;
  }
  if (SKIP_AI) {
    console.log(`[daily] SKIP_AI: 跳过 GitHub Trending LLM 富集（${pending.length} 条仅用历史缓存摘要）`);
    return;
  }
  console.log(
    `[daily] enriching ${pending.length}/${gh.length} GitHub Trending repos with ${REPORT_LOCALE} summaries…`,
  );
  const t0 = Date.now();
  const summaries = await enrichGithubTrendingSummaries(pending);
  for (const a of pending) {
    const s = summaries.get(a.url);
    if (s) a.summary = s;
  }
  console.log(
    `[daily] enrichment done in ${((Date.now() - t0) / 1000).toFixed(1)}s, matched ${summaries.size}/${pending.length}`,
  );
}

/**
 * finance:news is rendered as a merged time-sorted list (see
 * MERGED_SUBGROUP_LIMITS in render.ts). Enrich exactly the items that
 * will be displayed: take all enabled finance:news articles, sort by
 * publishedAt desc, slice to the merge limit, ask Sonnet for Chinese
 * factual summaries.
 */
async function enrichFinanceNews(articles: ArticleInput[]): Promise<void> {
  await enrichMergedSubgroup(articles, "finance", "news");
}

async function enrichPolitics(articles: ArticleInput[]): Promise<void> {
  await enrichMergedSubgroup(articles, "politics", "world");
}

async function enrichOverseasTech(articles: ArticleInput[]): Promise<void> {
  await enrichMergedSubgroup(articles, "tech", "overseas-tech");
}

/**
 * Shared implementation for "merged subgroup" enrichment: collect all
 * enabled articles in (category, subcategory), sort by date desc, take
 * the display cap (from MERGED_SUBGROUP_LIMITS), and ask the LLM to
 * summarize them into REPORT_LOCALE in a single batch. Symmetric to the
 * merge logic in render.ts groupRaw, so display and enrichment stay aligned.
 *
 * Sources whose `lang` already matches REPORT_LOCALE are skipped — no
 * point translating English to English (en mode) or Chinese to Chinese
 * (zh mode).
 */
async function enrichMergedSubgroup(
  articles: ArticleInput[],
  category: "tech" | "finance" | "politics",
  subcategory: string,
): Promise<void> {
  const subSources = sources.filter(
    (s) =>
      s.category === category &&
      s.subcategory === subcategory &&
      s.enabled !== false,
  );
  const sameLocaleIds = new Set(
    subSources.filter((s) => (s.lang ?? "en") === REPORT_LOCALE).map((s) => s.id),
  );
  const limit = MERGED_SUBGROUP_LIMITS[`${category}:${subcategory}`] ?? 12;
  const perCap = MERGE_PER_SOURCE_CAP[`${category}:${subcategory}`];
  // Mirror render.ts groupRaw EXACTLY: cap each source to perCap (so one
  // fresh source can't flood the whole merged timeline), concat, then take
  // the top-N by date. This keeps AI enrichment scoped to the FINAL displayed
  // items only — no LLM spend on items the reader will never see.
  const perSourceItems: ArticleInput[] = [];
  for (const s of subSources) {
    const srcItems = articles
      .filter((a) => a.sourceId === s.id)
      .filter((a) => category !== "politics" || !isSportsArticle(a.title))
      .sort(
        (a, b) =>
          (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
      );
    perSourceItems.push(...(perCap ? srcItems.slice(0, perCap) : srcItems));
  }
  const top = perSourceItems
    .sort(
      (a, b) =>
        (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
    )
    .slice(0, limit);
  const toEnrich = top.filter((a) => !sameLocaleIds.has(a.sourceId));
  const pending = applyCache(toEnrich);
  if (pending.length === 0) {
    console.log(
      `[daily] enriching ${category}:${subcategory}: ${toEnrich.length} 条全部命中历史缓存，跳过 LLM`,
    );
    return;
  }
  if (SKIP_AI) {
    console.log(`[daily] SKIP_AI: 跳过 ${category}:${subcategory} LLM 富集（${pending.length} 条仅用历史缓存摘要）`);
    return;
  }
  console.log(
    `[daily] enriching ${pending.length}/${toEnrich.length} ${category}:${subcategory} items with ${REPORT_LOCALE} summaries…`,
  );
  const t0 = Date.now();
  const summaries = await enrichFinanceNewsSummaries(pending);
  for (const a of pending) {
    const s = summaries.get(a.url);
    if (s) a.summary = s;
  }
  console.log(
    `[daily] enrichment done in ${((Date.now() - t0) / 1000).toFixed(1)}s, matched ${summaries.size}/${pending.length}`,
  );
}

/**
 * Pull daily OHLCV from Yahoo for every ticker in the watchlist, compute
 * indicators + signals, then ask Sonnet for a market overview + a
 * picks-to-watch list. Returns null if no ticker came back.
 */
async function runTrading(): Promise<TradingSection | null> {
  console.log(`[daily] analyzing watchlist + crypto context (Yahoo / alt.me / CoinGecko)…`);
  const t0 = Date.now();
  const [tickers, cryptoFearGreed, cryptoGlobal] = await Promise.all([
    analyzeWatchlist(),
    fetchCryptoFearGreed(),
    fetchCryptoGlobal(),
  ]);
  console.log(
    `[daily] indicators ready in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${tickers.length} tickers` +
      (cryptoFearGreed ? `, F&G ${cryptoFearGreed.value}` : ", F&G ✗") +
      (cryptoGlobal
        ? `, BTC dom ${cryptoGlobal.btcDominance.toFixed(1)}%`
        : ", CG ✗"),
  );
  if (tickers.length === 0) return null;
  console.log(`[daily] generating trading commentary${SKIP_AI ? " (SKIP_AI: 跳过)" : ` with ${getModelTag()}`}…`);
  const t1 = Date.now();
  const commentary = SKIP_AI
    ? null
    : await generateTradingCommentary({
        tickers,
        cryptoFearGreed: cryptoFearGreed ?? undefined,
        cryptoGlobal: cryptoGlobal ?? undefined,
      });
  if (!SKIP_AI) {
    console.log(
      `[daily] trading commentary ready in ${((Date.now() - t1) / 1000).toFixed(1)}s`,
    );
  }
  return {
    ...commentary,
    tickers,
    crypto_fear_greed: cryptoFearGreed ?? undefined,
    crypto_global: cryptoGlobal ?? undefined,
    generated_at: new Date().toISOString(),
  };
}

/**
 * Cheap, AI-free DailyReport builder used once the per-item summaries are
 * attached (and the market/trading section, if any, is ready).
 *
 * This REPLACES the old `generateDailyReport` cross-category LLM digest:
 * we no longer spend a large Sonnet call re-synthesizing items that were
 * already summarized one-by-one. The digest now just mirrors the FINAL
 * displayed sets (grouped by category) using each article's own summary /
 * excerpt, so the markdown export stays useful at zero extra token cost.
 * (The HTML site never rendered the digest anyway.)
 */
function buildReportFromRaw(raw: RawByCategory): DailyReport {
  const flatten = (cat: Category): ArticleInput[] =>
    (raw[cat] ?? []).flatMap((sg) => sg.sources.flatMap((s) => s.items));
  const toBrief = (a: ArticleInput): BriefItem => ({
    title: a.title,
    url: a.url,
    source: a.source,
    summary: a.summary || a.excerpt || "",
    importance: 1,
  });
  return {
    hero_headline: "",
    daily_overview: "",
    tech_briefs: flatten("tech").slice(0, 5).map(toBrief),
    finance_briefs: flatten("finance").slice(0, 5).map(toBrief),
    politics_briefs: flatten("politics").slice(0, 3).map(toBrief),
    gd_ipo_briefs: [...flatten("gd-ipo"), ...flatten("ipo")].slice(0, 20).map(toBrief),
    editor_note: "",
    keywords: [],
  };
}

async function main() {
  // Fail fast on misconfigured backend before we spend 30s fetching
  // 500+ articles only to discover the LLM has no credentials.
  // SKIP_AI 模式不调用 LLM，无需凭证，跳过该校验。
  if (!SKIP_AI) validateBackendCredentials();

  // 加载滚动 30 天历史（含已解读的 AI 摘要缓存），供富集去重 + 过去30天 tab 使用。
  history = loadHistory();
  console.log(`[daily] 已加载历史缓存: ${Object.keys(history).length} 条（来自 data/article-history.json）`);
  aiAssets = loadAiAssets();
  console.log(`[daily] 已加载 AI 资产账本: ${Object.keys(aiAssets).length} 键（data/ai-assets/，${process.env.PERSIST_AI === "off" ? "PERSIST_AI=off 旁路" : "启用"}`);

  const date = todayKey();
  console.log(`[daily] ${date} — fetching sources…\n`);
  let articles = await fetchAll();
  console.log(`\n[daily] total articles: ${articles.length}`);

  // —— 归一化（边界②）：采集产物汇合 + URL 去重 + region 分流（gd-→gz- 前缀改写）——
  // M3-A：爬虫已 TS 化并由本进程内 fetchCrawledArticles() 直接调用（不再 shell 出去写
  // crawled-articles.json / crawled-gz.json 中间文件）；逻辑集中在 lib/ingest/merge.ts（纯函数、可单测）。
  let crawled: { ipo: CrawledArticle[]; gz: CrawledArticle[] } = { ipo: [], gz: [] };
  try {
    crawled = await fetchCrawledArticles();
    console.log(
      `[daily] ✅ 爬虫抓取: IPO/新股 ${crawled.ipo.length} 条 / 广州商机 ${crawled.gz.length} 条`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[daily] ⚠️ 爬虫抓取失败（跳过爬虫源）: ${msg}`);
  }

  // IPO / 新股（crawled-articles.json 等价路径，mode=ipo）
  if (crawled.ipo.length) {
    const { merged, added, skipped } = dedupeByUrl(
      articles,
      crawled.ipo.map((it) => toMergeArticle(it, "ipo")),
    );
    articles = merged;
    console.log(`[daily] ✅ 加载爬虫数据 ${added} 条（跳过 ${skipped} 条重复）`);
  }

  // 广州商机（crawled-gz.json 等价路径，mode=gz）。category 按集中路由表判定
  // （M3-D：SOURCE_ROUTE，不依赖 config 里的 file:// 占位源）。
  // 注意：走「今日抓取」数组 → buildRolling 自动打 fetchedToday=true（当天）；
  // 次日经 saveHistory 进入历史缓存后 fetchedToday 自动为 false（过去7天）。当天/历史严格区分。
  if (crawled.gz.length) {
    const regCat = (id?: string) => (id ? SOURCE_ROUTE[id]?.category : undefined);
    const { merged, added, skipped } = dedupeByUrl(
      articles,
      crawled.gz.map((it) => toMergeArticle(it, "gz", { gzCategory: regCat(it.sourceId) })),
    );
    articles = merged;
    console.log(`[daily] ✅ 加载广州商机数据 ${added} 条（跳过 ${skipped} 条重复）`);
  }

  // —— 本地手动采集（data/local-acquired.json，2026-08-20 方案）——
  // 被 WAF 拦的国内源（NFRA/PBC/财联社/同花顺）由用户本地 skill（local-acquire）抓取后
  // 提交到该文件；此处只取「最新 7 天」条目，按 region/sourceId 分 ipo/gz 两类，
  // 与爬虫产物同构（toMergeArticle + dedupeByUrl）并入同一管线（后续漏斗/AI/分类/渲染一致）。
  const localAcq = loadLocalAcquired();
  if (localAcq && localAcq.items.length) {
    const recent = filterLocalAcquiredRecent(localAcq.items);
    const isIpoItem = (it: CrawledArticle) =>
      it.region === "gd" || (it.sourceId ?? "").startsWith("gd-");
    const localIpo = recent.filter(isIpoItem);
    const localGz = recent.filter((it) => !isIpoItem(it));
    if (localIpo.length) {
      const { merged, added, skipped } = dedupeByUrl(
        articles,
        localIpo.map((it) => toMergeArticle(it, "ipo")),
      );
      articles = merged;
      console.log(`[daily] ✅ 本地手动采集(IPO) ${added} 条（跳过 ${skipped} 条重复，共 ${recent.length} 条 7 天内）`);
    }
    if (localGz.length) {
      const regCat = (id?: string) => (id ? SOURCE_ROUTE[id]?.category : undefined);
      const { merged, added, skipped } = dedupeByUrl(
        articles,
        localGz.map((it) => toMergeArticle(it, "gz", { gzCategory: regCat(it.sourceId) })),
      );
      articles = merged;
      console.log(`[daily] ✅ 本地手动采集(商机财经) ${added} 条（跳过 ${skipped} 条重复，共 ${recent.length} 条 7 天内）`);
    }
  } else {
    console.log(`[daily] ℹ️ 无本地手动采集文件（data/local-acquired.json 缺失或为空）`);
  }

  // —— 源等级 tier 补齐（T6）：爬虫产物未带 tier 的条目，按源定义透传（归一化层只透传、不渲染）——
  const tierBySource = new Map(loadAllSources().map((s) => [s.id, s.tier]));
  articles = articles.map((a) =>
    a.tier === undefined && tierBySource.has(a.sourceId)
      ? { ...a, tier: tierBySource.get(a.sourceId) }
      : a,
  );
  if (articles.length === 0) {
    throw new Error("no articles fetched — aborting");
  }

  // —— 关键词漏斗（边界③最前端，零成本）：银行零售关键词体系硬过滤 ——
  // 未命中直接丢弃（决策②：硬过滤），不进入任何 AI 富集/分类；KEYWORD_FILTER=off 旁路。
  if (keywordFilterEnabled()) {
    const kwConfig = loadKeywordConfig();
    const before = articles.length;
    const keep: ArticleInput[] = [];
    let opp = 0;
    let weekly = 0;
    for (const a of articles) {
      const input: RawArticleInput = {
        title: a.title,
        content: a.excerpt,
        sourceId: a.sourceId,
        url: a.url,
        category: a.category, // 参考区（tech/ipo/gd-ipo/politics）豁免漏斗，仅商机扫描
      };
      const r = applyKeywordFilter(input, kwConfig);
      if (!r.pass) continue;
      const tagged = a as ArticleInput & {
        filterBucket?: string;
        filterDimensions?: string[];
        filterOpportunities?: FilterResult["opportunities"];
      };
      tagged.filterBucket = r.bucket;
      tagged.filterDimensions = r.dimensions;
      if (r.opportunities?.length) tagged.filterOpportunities = r.opportunities;
      if (r.bucket === "opportunity") opp++;
      if (r.bucket === "weekly") weekly++;
      keep.push(a);
    }
    if (keep.length === 0 && keywordFilterFallbackEnabled()) {
      console.warn(`[daily] ⚠️ 关键词漏斗将全部 ${before} 条过滤为 0（疑似误杀/词表过严）— 回退全量保底，避免空报告`);
    } else {
      articles = keep;
      console.log(`[daily] 🔻 关键词漏斗: ${before} → ${articles.length} 条（商机 ${opp} / 周报 ${weekly}，其余日报池）`);
    }
  }

  // —— 标题相似度判重（归一化②，漏斗之后 AI 之前）：同一主题最多 maxPerTheme 条、
  // 同 tier 只留 1 条（政府+媒体 = 政府 1 + 媒体 1）。让 LLM 只处理保留条目（省钱）。
  if (dedupSimilarEnabled()) {
    const dd = loadDedupConfig();
    const before = articles.length;
    const { kept, removed } = dedupeByTitleSimilarity(articles, {
      threshold: dd.threshold,
      maxPerTheme: dd.maxPerTheme,
    });
    if (removed.length > 0) {
      console.log(
        `[daily] 🔁 标题相似度判重: ${before} → ${kept.length} 条（阈值 ${dd.threshold}、每主题 ≤${dd.maxPerTheme}、同 tier 只留 1；移除 ${removed.length} 条重复报道）`,
      );
    }
    articles = kept;
  }

  // —— 超窗口旧文过滤（归一化②）：rss 流混入的 7 天前旧文不进 AI、不展示（展示窗口 {{DISPLAY}} 天）——
  // 否则旧文 URL 不在 7 天历史缓存，会被误判为「新条目」进 AI 分类（白花钱）。
  const wBefore = articles.length;
  articles = filterByWindow(articles, DISPLAY_WINDOW_DAYS);
  if (articles.length !== wBefore) {
    console.log(
      `[daily] 🗓 超窗口旧文过滤: ${wBefore} → ${articles.length} 条（移除 ${wBefore - articles.length} 条 7 天前旧文）`,
    );
  }

  // —— 跨天标题判重（先来后到）：新抓取 vs 历史库已有条目 ——
  // 同主题（标题相似 ≥0.7）重复报道：同 tier 只留 1、不同 tier 最多 2 条、
  // 历史先来者优先占位。例：政府今天发公积金，明天某媒体再发、后天又一家——
  // 仅当该 tier 空缺且总数 < 2 时才补充，否则视为无效重复丢弃。
  const histSim: HistorySimilarEntry[] = Object.values(history).map((e) => ({
    title: e.title,
    url: e.url,
    tier: tierBySource.get(e.sourceId),
  }));
  const dhBefore = articles.length;
  const dh = dedupeAgainstHistory(articles, histSim, { maxPerTheme: 2 }) // 跨天阈值默认 0.6（Dice）;
  if (dh.removed.length > 0) {
    console.log(
      `[daily] 🔄 跨天标题判重: ${dhBefore} → ${dh.kept.length} 条（历史库已覆盖 ${dh.removed.length} 条重复主题）`,
    );
  }
  articles = dh.kept;

  // Enrich tech / politics subgroups with summaries (tech/politics 不参与银行相关分类，
  // 走各自专属摘要 prompt)。finance 不再单独 enrich——其摘要+分类统一由下方
  // classifyItemsWithLlm 一次批量调用完成（中文/英文源全覆盖，省一次重复调用）。
  await enrichGhTrending(articles);
  await enrichPolitics(articles);
  await enrichOverseasTech(articles);
  
  // ===== 为 gd-ipo / 全国ipo 数据生成中文摘要（复用历史缓存去重）=====
  const gdIpoArticles = articles.filter(a => a.category === 'gd-ipo' || a.category === 'ipo');
  if (gdIpoArticles.length > 0) {
    const pending = applyCache(gdIpoArticles);
    if (pending.length === 0) {
      console.log(`[daily] enriching gd-ipo+ipo: ${gdIpoArticles.length} 条全部命中历史缓存，跳过 LLM`);
    } else if (SKIP_AI) {
      console.log(`[daily] SKIP_AI: 跳过 gd-ipo+ipo LLM 富集（${pending.length} 条仅用历史缓存摘要）`);
    } else {
      console.log(`[daily] enriching ${pending.length}/${gdIpoArticles.length} gd-ipo+ipo items with ${REPORT_LOCALE} summaries…`);
      const t0 = Date.now();
      const summaries = await enrichFinanceNewsSummaries(pending);
      for (const a of pending) {
        const s = summaries.get(a.url);
        if (s) a.summary = s;
      }
      console.log(
        `[daily] enrichment done in ${((Date.now() - t0) / 1000).toFixed(1)}s, matched ${summaries.size}/${pending.length}`,
      );
    }
  }
  // Trading signals: Yahoo fetch + indicators + commentary. Non-fatal —
  // if it errors, we still ship the news digest.
  // SKIP_AI 模式下跳过整个交易板块：其点评(market_overview/picks)由 LLM 生成，
  // 仅指标无点评时 renderTradingPanel 会因读取 commentary.picks 等字段崩溃。
  let trading: TradingSection | null = null;
  if (SKIP_AI) {
    console.log(`[daily] SKIP_AI: 跳过交易分析板块（含 LLM 点评）`);
  } else {
    try {
      trading = await runTrading();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[daily] trading section failed: ${msg}`);
    }
  }

  // 条目级 LLM 分类：对**所有类别**的「全新条目」（历史库未命中）做 AI 分析，
  // 由 AI 决定进入哪个子标签(subcategory) + 写银行视角摘要(summary) + 银行相关性(relevant)。
  // 这是用户设计核心：所有信息都经 AI 打标，不依赖源配置的硬编码子类。
  // - gz/finance：AI 判银行相关性(relevant) + 业务线子标签(gz-*/cn-* 等)。
  // - tech/ipo/gd-ipo/politics 等参考区：relevant 固定 true（不按银行相关性过滤），
  //   AI 仅决定 subcategory（各自标签体系，见 item-classifier 的 RULES）。
  // - gd-ipo 渲染路由最终由三道闸区域分类器(classifyGdIpo)裁定，此处 AI 标注仅作初步。
  // 摘要：gz/finance 无独立 enrich，由本分类器输出 summary；tech/ipo/gd-ipo 已有各自 enrich
  // 摘要，循环中仅在条目确实无摘要时(!a.summary)用分类器摘要兜底，避免覆盖。
  // 历史命中(已分析过)一律跳过，绝不复选。
  // 失败（如 LLM 余额不足）→ 自动跳过，降级到启发式/注册表分类，绝不影响主流程。
  const classifyPending = articles.filter((a) => !history[a.url]);
  if (classifyPending.length > 0) {
    if (SKIP_AI) {
      console.log(`[daily] SKIP_AI: 跳过 ${classifyPending.length} 条新条目 LLM 分类（仅用历史缓存摘要）`);
    } else {
      console.log(`[daily] classifying ${classifyPending.length} new items (LLM per-item tag)…`);
      try {
        const cls = await classifyItemsWithLlm(
          classifyPending.map((a) => ({ url: a.url, title: a.title, source: a.source, category: a.category })),
        );
        let tagged = 0;
        for (const a of classifyPending) {
          const r = cls.get(a.url);
          if (r) {
            if (r.subcategories.length > 0) {
              a.subcategories = r.subcategories;
              a.subcategory = r.subcategories[0]; // 兼容旧消费方（主标签）
            }
            a.relevant = r.relevant;
            if (r.summary && r.summary.length > 10 && !a.summary) a.summary = r.summary;
            tagged++;
          }
        }
        console.log(`[daily] item classification done: ${tagged}/${classifyPending.length} tagged`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[daily] item classification skipped (${msg}) — falling back to heuristic/registry`);
      }
    }
  }

  // 回写历史缓存（含今日 AI 摘要），并构建「当天 + 过去30天」滚动列表用于渲染。
  const nowIso = new Date().toISOString();
  history = saveHistory(articles, history, nowIso);
  const rolling = buildRolling(articles, history);
  console.log(
    `[daily] 历史缓存已更新: ${Object.keys(history).length} 条（含今日 ${articles.length} 条）；渲染滚动列表 ${rolling.length} 条`,
  );

  // 组装最终报告：仅用「最终展示数据」的摘要（不调用 AI）。
  // 旧逻辑会再发一次大 LLM 请求做跨分类摘要（generateDailyReport），现已移除以省钱。
  const raw = groupRaw(rolling, sources);
  const report = buildReportFromRaw(raw);
  if (trading) report.trading = trading;

  // ===== 执行摘要 / 商机提示（每天一次 LLM 调用；失败不崩、页面不渲染该板块）=====
  try {
    const flat = (cat: Category) =>
      (raw[cat] ?? [])
        .flatMap((sg) => sg.sources.flatMap((s) => s.items))
        .slice(0, 12)
        .map((a) => ({ title: a.title, summary: a.summary, subcategory: a.subcategory }));
    // 持久化执行摘要源（2026-08-20 扩展）：history/<date>/store.json 优先
    // （随报告提交进 main，CI 跨运行可复用），其次 data/ai-assets 的 daily:<date>.executive。
    const persistedExec =
      loadStore(date) ??
      (assetDaily(aiAssets, date)?.executive as ExecutiveSummary | undefined);
    // 强制重生成开关：REGEN_STORE=1 → 忽略已存在归档、重新调 LLM 并覆盖写。
    // 仅在非 SKIP_AI 模式有意义；SKIP_AI 下矛盾，忽略并告警。
    const forceRegen = !!process.env.REGEN_STORE && !SKIP_AI;
    if (process.env.REGEN_STORE && SKIP_AI) {
      console.warn("[daily] REGEN_STORE 仅在非 SKIP_AI 模式生效，已忽略（保留复用）");
    }
    const execSummary = await selectExecutiveSummary({
      skipAi: SKIP_AI,
      persisted: persistedExec,
      forceRegen,
      generate: () =>
        generateExecutiveSummary({
          date,
          finance: flat("finance"),
          gz: flat("gz"),
          marketOverview: trading?.market_overview,
        }),
    });
    if (execSummary) {
      report.executive_summary = execSummary;
      // 归档进 history/<date>/store.json，随 CI「Archive reports to history/」步骤提交，
      // 使后续 SKIP_AI / 正常模式重跑都能复用（真正的跨运行持久化）。覆盖写幂等。
      writeStore(date, execSummary);
      const tag = SKIP_AI ? "已复用(持久化)" : forceRegen ? "已重新生成(覆盖)" : persistedExec ? "已复用(持久化)" : "已生成";
      console.log(
        `[daily] 执行摘要${tag}: 必读 ${execSummary.must_read.length} 条 / 商机提示 ${execSummary.insights.length} 条`,
      );
    } else if (!SKIP_AI) {
      console.warn("[daily] 执行摘要生成失败（LLM 不可用或解析失败），跳过该板块");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[daily] 执行摘要生成异常（${msg}），跳过该板块`);
  }

  // —— M2-④：AI 资产账本写回（append-only，永不 7 天裁剪；PERSIST_AI=off 旁路）——
  for (const a of articles) {
    const prev = aiAssets[a.url] as ArticleAiAsset | undefined;
    aiAssets[a.url] = {
      ...(prev ?? {}),
      summary: a.summary || prev?.summary,
      subcategory: a.subcategory ?? prev?.subcategory,
      subcategories: a.subcategories ?? prev?.subcategories,
      relevant: a.relevant ?? prev?.relevant,
      updatedAt: nowIso,
    };
  }
  const dk = dailyAssetKey(date);
  const dailyPrev = assetDaily(aiAssets, date);
  aiAssets[dk] = {
    ...(dailyPrev ?? {}),
    ...(report.executive_summary ? { executive: report.executive_summary } : {}),
    ...(trading ? { trading } : {}),
    updatedAt: nowIso,
  };
  saveAiAssets(aiAssets);
  console.log(`[daily] AI 资产账本已更新: ${Object.keys(aiAssets).length} 键`);

  // —— M2-⑤ 存储合并（去双写，2026-08-19 用户确认未上线）——
  // data/history/reports/ 是唯一报告存储；daily_reports/（gh-pages 发布目录）
  // 由 build-site.mjs 在构建时从唯一存储同步，daily.ts 不再写旧目录。
  const html = renderHtml(report, raw, date);
  const md = process.env.OUTPUT_MARKDOWN === "true" ? renderMarkdown(report, date) : null;
  const writeBundle = (dir: string) => {
    const d = path.join(dir, date);
    fs.mkdirSync(d, { recursive: true });
    const b = path.join(d, date);
    fs.writeFileSync(`${b}.json`, JSON.stringify(report, null, 2), "utf8");
    // Sidecar with the rolling article list (today + past-30d) + LLM-attached
    // summary, so scripts/render.ts can rebuild HTML/MD for UI iteration
    // without re-fetching or re-calling the LLM.
    fs.writeFileSync(
      `${b}-articles.json`,
      JSON.stringify({ date, articles: rolling }, null, 2),
      "utf8",
    );
    fs.writeFileSync(`${b}.html`, html, "utf8");
    if (md) fs.writeFileSync(`${b}.md`, md, "utf8");
    return b;
  };
  const base = writeBundle(REPORTS_DIR);
  console.log(`[daily] wrote ${base}.{json,html${md ? ",md" : ""},articles.json}（唯一存储 data/history/reports/）`);

  // 导出信息源抓取结果（排除爬虫产物 gd-*/gz-*），供「预 AI 分析加载」任务拉回比对：
  // 识别历史库中不存在的信息源新增条目 → AI 分析打标。与 dry-run 导出逻辑一致（漏斗后）。
  const fetched = articles.filter((a) => !/^(gd-|gz-)/.test(a.sourceId || ""));
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync("data/fetched-articles.json", JSON.stringify(fetched, null, 2), "utf8");
  console.log(`[daily] 📤 信息源抓取结果导出: ${fetched.length} 条 → data/fetched-articles.json`);

  console.log(`[daily] done.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`[daily] FAILED:`, e);
    process.exit(1);
  });
