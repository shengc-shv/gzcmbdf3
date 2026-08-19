/**
 * 爬虫 runner 入口（M3-A：双采集系统合并）
 *
 * 原 scripts/crawlers/run-all.mjs（IPO 六源 → data/crawled-articles.json）与
 * scripts/crawlers/run-gz.mjs（广州商机三源 → data/crawled-gz.json）的逻辑合并：
 * 由 daily.ts 进程内直接调用本入口，不再 shell 出去写 JSON 中间文件。
 *
 * 每个爬虫独立 try/catch 隔离（单源失败不连坐），结果按 URL 去重。
 */
import type { CrawledArticle } from "../../ingest/merge";
import { BaseCrawler } from "./base-crawler";
import { HKEXCrawler } from "./sources/hkex-ipo";
import { SSEAPICrawler } from "./sources/sse-api";
import { SZSEAPICrawler } from "./sources/szse-api-crawler";
import { BSEAPICrawler } from "./sources/bse-api";
import { EastMoneyIPOCrawler } from "./sources/eastmoney-ipo";
import { TonghuashunIPOCrawler } from "./sources/tonghuashun-ipo";
import { GzStatsCrawler } from "./sources/gz-stats";
import { GzGovCrawler } from "./sources/gz-gov";
import { GzNanshaCrawler } from "./sources/gz-nansha";

export interface CrawledBundle {
  ipo: CrawledArticle[];
  gz: CrawledArticle[];
}

/** 按 URL 去重（保留首次出现） */
function dedupeByUrl<T extends { url?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const key = it.url || "";
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(it);
  }
  return out;
}

export async function fetchCrawledArticles(): Promise<CrawledBundle> {
  // —— IPO / 新股（六源）→ 走 toGzcmbdf3Format（带 sourceId/region）——
  const ipoCrawlers: BaseCrawler[] = [
    new HKEXCrawler(),
    new SSEAPICrawler(),
    new SZSEAPICrawler(),
    new BSEAPICrawler(),
    new EastMoneyIPOCrawler(),
    new TonghuashunIPOCrawler(),
  ];

  const ipo: CrawledArticle[] = [];
  for (const crawler of ipoCrawlers) {
    try {
      await crawler.run();
      ipo.push(...(crawler.toGzcmbdf3Format() as CrawledArticle[]));
    } catch (err) {
      console.error(`[${crawler.name}] 爬虫异常:`, (err as Error).message);
    }
  }

  // —— 广州商机（三源）→ 取原始 results（保留 category/subcategory/region/sourceId）——
  const gzCrawlers: BaseCrawler[] = [
    new GzStatsCrawler(),
    new GzGovCrawler(),
    new GzNanshaCrawler(),
  ];

  const gz: CrawledArticle[] = [];
  for (const crawler of gzCrawlers) {
    try {
      await crawler.run();
      gz.push(...(crawler.results as CrawledArticle[]));
    } catch (err) {
      console.error(`[${crawler.name}] 异常:`, (err as Error).message);
    }
  }

  return { ipo: dedupeByUrl(ipo), gz: dedupeByUrl(gz) };
}
