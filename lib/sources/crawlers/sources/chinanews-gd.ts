import { BaseCrawler, type CrawlerResult } from "../base-crawler";

/**
 * 中新网广东频道（www.gd.chinanews.com.cn）爬虫
 *
 * 背景（2026-08-21 用户第一梯队：广州本地媒体解决"热点发现"）：
 * 中新网广东频道对广东/广州热点 T+0 跟进（词元八条案例中省级频道当天跟进），
 * 是"热点发现"的重要一环。
 *
 * 经实测（2026-08-21）：
 *   首页 https://www.gd.chinanews.com.cn/ 服务端渲染 49KB，文章链接形如
 *     https://www.gd.chinanews.com.cn/2026/2026-08-08/449065.shtml
 *   日期由路径 /YYYY/YYYY-MM-DD/ 直接推导；标题在 <a> 内直接文本。
 *   栏目导航：index/yw.html 要闻、index/zxzq.html 中新广东（滚动）、index/tsgd.html 特色广东。
 *   v1 抓首页 + 要闻（index/yw.html）两个列表页（首页即最新滚动，要闻为精选）。
 *
 * 产物：sourceId=chinanews-gd，category=gz（经 SOURCE_ROUTE），subcategory=gz-media（广州本地媒体）。
 */
const GDCN_BASE = "https://www.gd.chinanews.com.cn";
const GDCN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const GDCN_REF = "https://www.gd.chinanews.com.cn/";

/** 目标页面（首页 + 要闻栏目） */
const GDCN_PAGES: string[] = [
  `${GDCN_BASE}/`,
  `${GDCN_BASE}/index/yw.html`,
];

/**
 * 匹配文章链接并捕获标题：
 *   href="https://www.gd.chinanews.com.cn/2026/2026-08-08/449065.shtml" ...>标题</a>
 * 仅匹配 /YYYY/YYYY-MM-DD/ 路径文章页，排除专题/栏目导航。
 */
const ARTICLE_RE =
  /<a[^>]*href="(https:\/\/www\.gd\.chinanews\.com\.cn\/\d{4}\/(\d{4}-\d{2}-\d{2})\/[^"]+\.shtml)"[^>]*>([\s\S]*?)<\/a>/g;

/** 去 HTML 标签 + 折叠空白 */
function stripTags(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 校验日期格式 YYYY-MM-DD 并返回（非法返回 ""） */
function validDate(raw: string): string {
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

interface ParsedItem {
  title: string;
  url: string;
  date: string;
}

export class ChinanewsGdCrawler extends BaseCrawler {
  constructor() {
    super({ name: "中新网·广东", timeout: 15000, retries: 2 });
  }

  /** GET 返回 HTML 文本（带重试 + 超时 + 中文 UA/Referer） */
  private async _getHtml(url: string): Promise<string | null> {
    const maxAttempts = this.retries + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const resp = await fetch(url, {
          headers: {
            "User-Agent": GDCN_UA,
            Referer: GDCN_REF,
            Accept: "text/html,application/xhtml+xml",
          },
          signal: AbortSignal.timeout(this.timeout),
        });
        if (!resp.ok) {
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 800 * attempt));
            continue;
          }
          console.warn(`[${this.name}] ${url} 返回 ${resp.status}`);
          return null;
        }
        // 页面声明 gb2312（GBK 超集）：Node 默认 UTF-8 解码会乱码，须按 gbk 解码
        const buf = new Uint8Array(await resp.arrayBuffer());
        return new TextDecoder("gbk").decode(buf);
      } catch (err) {
        console.warn(
          `[${this.name}] ${url} 抓取失败（尝试 ${attempt}/${maxAttempts}）: ${(err as Error).message}`,
        );
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 800 * attempt));
          continue;
        }
        return null;
      }
    }
    return null;
  }

  /** 从列表页 HTML 解析文章链接 + 标题 + 日期（URL 去重在 run 层做） */
  private _parseList(html: string): ParsedItem[] {
    return parseChinanewsGdHtml(html);
  }

  async run(): Promise<CrawlerResult[]> {
    console.log(`[${this.name}] 开始抓取 (广东频道)`);
    const seen = new Set<string>();
    for (const page of GDCN_PAGES) {
      const html = await this._getHtml(page);
      if (!html) continue;
      for (const it of this._parseList(html)) {
        if (seen.has(it.url)) continue;
        seen.add(it.url);
        this.results.push({
          title: it.title,
          url: it.url,
          excerpt: "",
          publishedAt: it.date,
          sourceId: "chinanews-gd",
          source: "中新网·广东",
        });
      }
    }
    console.log(`[${this.name}] 完成，共 ${this.results.length} 条（去重后）`);
    return this.results;
  }
}

export function createCrawler(): ChinanewsGdCrawler {
  return new ChinanewsGdCrawler();
}

/** 纯解析：从中新网广东 HTML 提取文章（导出供单测，与 run() 共用）。 */
export function parseChinanewsGdHtml(html: string): ParsedItem[] {
  const out: ParsedItem[] = [];
  ARTICLE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ARTICLE_RE.exec(html))) {
    const url = m[1];
    const date = validDate(m[2]);
    const title = stripTags(m[3]);
    if (!title || title.length < 8) continue;
    if (!date) continue; // 无有效日期 → 丢弃（时间体系红线）
    out.push({ title, url, date });
  }
  return out;
}
