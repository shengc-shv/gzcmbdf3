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
import { NfraCrawler } from "./sources/nfra-api";
import { PbcCrawler } from "./sources/pbc-web";
import { CnfinCrawler } from "./sources/cnfin-web";
// 2026-08-20 用户决定：取消南沙信息源（只看广州市政府 gz-gov），GzNanshaCrawler 停用，
// 文件保留便于未来恢复。

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

  // —— 广州商机 + 部委政策（两源，2026-08-20 起南沙停用）→ 取原始 results（保留 category/subcategory/region/sourceId）——
  // 注：nfra（国家金融监督管理总局）虽为全国性部委政策，但复用同一条「非 IPO 爬虫」通道，
  // 经 SOURCE_ROUTE 路由到 finance/cn-policy，与 gz-gov（国务院政策→finance/gz-policy）同模式。
  const gzCrawlers: BaseCrawler[] = [
    new GzStatsCrawler(),
    new GzGovCrawler(),
    new NfraCrawler(),
    new PbcCrawler(),
    new CnfinCrawler(),
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
