import { BaseCrawler, CrawlerResult } from "../base-crawler";
import { parseGovList, absUrl, dateToIso } from "../gz-utils";

/**
 * 广州市人民政府 - 市政府文件 + 政策解读
 * 站点: https://www.gz.gov.cn/zwgk/fggw/szfwj/  /  https://www.gz.gov.cn/zwgk/zcjd/
 * 内容: 广州产业政策 / 招商 / 城市治理文件（商机类核心源）
 *
 * 日期处理（2026-08-20 修复）：
 * szfwj/zcjd 列表页**无内联日期**（实抓验证），原设计让 publishedAt 留空由上游 fallback，
 * 但上游 `publishedAt ?? fetchedAt` 会让归档旧文（2024/2025）永远显得"今天新鲜"常驻展示窗。
 * 修复：重写 run()，super.run() 拿到列表条目后，并发进详情页取 `<meta name="PubDate">`
 * 或正文日期 补 publishedAt；单条失败静默跳过（保留原无日期 fallback，由下游窗口兜底）。
 *
 * M3-A 移植：原 scripts/crawlers/sources/gz-gov.mjs 逐字移植。
 */
export class GzGovCrawler extends BaseCrawler {
  constructor() {
    super({
      name: "广州市政府",
      keywords: [],
      timeout: 15000,
      retries: 2,
    });
  }

  async getUrls(): Promise<import("../base-crawler").CrawlUrl[]> {
    // 分页规律（2026-08-20 实测）：第1页 index.html，第N页(N≥2) index_N.html（index_1.html 不存在，404）
    return [
      { url: "https://www.gz.gov.cn/zwgk/fggw/szfwj/index.html", sub: "gz-industry" },
      { url: "https://www.gz.gov.cn/zwgk/fggw/szfwj/index_2.html", sub: "gz-industry" },
      { url: "https://www.gz.gov.cn/zwgk/zcjd/index.html", sub: "gz-industry" },
    ].map((u) => ({ ...u, headers: { "User-Agent": this.userAgent } }));
  }

  async parseArticle(
    html: string,
    url: string,
  ): Promise<import("../base-crawler").CrawlerResult[]> {
    const items = parseGovList(html, { minLen: 8 });
    const base = "https://www.gz.gov.cn";
    return items.map((it) => ({
      ...it,
      url: absUrl(it.url, base),
      excerpt: `【广州市政府】${it.title}`,
      category: "gz",
      subcategory: "gz-policy",
      region: "gz",
      sourceId: "gz-gov",
      source: "广州市政府",
    }));
  }

  /**
   * 列表页无内联日期 → super.run() 后并发进详情页补 publishedAt（原地改 items，
   * this.results 同步更新，调用方读 crawler.results 即含日期）。
   */
  async run(): Promise<CrawlerResult[]> {
    const items = await super.run();
    await this.enrichDetailDates(items);
    return items;
  }

  /** 并发抓详情页提取日期；单条失败静默跳过（保留无日期 fallback）。 */
  private async enrichDetailDates(items: CrawlerResult[]): Promise<void> {
    const pending = items.filter((it) => it.url && !it.publishedAt);
    if (!pending.length) return;
    console.log(`[${this.name}] 详情页补日期: ${pending.length} 条（并发5）…`);
    const CONCURRENCY = 5;
    let cursor = 0;
    const worker = async () => {
      while (cursor < pending.length) {
        const it = pending[cursor++];
        try {
          const resp = await fetch(it.url!, {
            headers: { "User-Agent": this.userAgent },
            signal: AbortSignal.timeout(10_000),
          });
          if (!resp.ok) continue;
          const html = await resp.text();
          const pub = this.extractDetailDate(html);
          if (pub) it.publishedAt = pub;
        } catch {
          // 单条失败静默跳过
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, pending.length) }, () => worker()),
    );
    const got = pending.filter((it) => it.publishedAt).length;
    console.log(`[${this.name}] 详情页补日期完成: ${got}/${pending.length} 条`);
  }

  /** 详情页取发布日期：优先 <meta name="PubDate">，其次正文日期（含中文年月日）。 */
  private extractDetailDate(html: string): string | undefined {
    const meta =
      html.match(/<meta[^>]+name=["']PubDate["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*name=["']PubDate["']/i);
    if (meta) {
      const d = dateToIso(meta[1]);
      if (d) return d;
    }
    const m = html.match(/(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})日?/);
    if (m) {
      const d = dateToIso(`${m[1]}-${m[2]}-${m[3]}`);
      if (d) return d;
    }
    return undefined;
  }
}

export function createCrawler(): GzGovCrawler {
  return new GzGovCrawler();
}
