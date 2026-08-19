import { BaseCrawler } from "../base-crawler";
import { parseGovList, absUrl } from "../gz-utils";

/**
 * 广州市统计局 - 数据发布栏目
 * 站点: http://tjj.gz.gov.cn/stats_newtjyw/sjfb/
 * 内容: 广州社零 / 居民收入 / 服务业 / 产业数据（直接对应零售客群画像）
 *
 * M3-A 移植：原 scripts/crawlers/sources/gz-stats.mjs 逐字移植。
 */
export class GzStatsCrawler extends BaseCrawler {
  constructor() {
    super({
      name: "广州统计局",
      keywords: [],
      timeout: 15000,
      retries: 2,
    });
  }

  async getUrls(): Promise<import("../base-crawler").CrawlUrl[]> {
    const base = "http://tjj.gz.gov.cn/stats_newtjyw/sjfb/";
    return [base + "index.html", base + "index_1.html", base + "index_2.html"].map((u) => ({
      url: u,
      headers: { "User-Agent": this.userAgent },
    }));
  }

  async parseArticle(
    html: string,
    url: string,
  ): Promise<import("../base-crawler").CrawlerResult[]> {
    const items = parseGovList(html, { minLen: 8 });
    const base = new URL(url).origin;
    return items.map((it) => ({
      ...it,
      url: absUrl(it.url, base),
      excerpt: `【广州统计局】${it.title}`,
      category: "gz",
      subcategory: "gz-customer",
      region: "gz",
      sourceId: "gz-stats",
      source: "广州市统计局",
    }));
  }
}

export function createCrawler(): GzStatsCrawler {
  return new GzStatsCrawler();
}
