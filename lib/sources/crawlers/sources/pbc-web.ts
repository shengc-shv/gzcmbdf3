import { BaseCrawler } from "../base-crawler";

/**
 * 中国人民银行（PBC）政策/公告爬虫
 *
 * 为什么不用 type:scrape 直接抓首页：www.pbc.gov.cn 是 eportal CMS 服务端渲染页，
 * 首页仅 140KB 导航壳，无文章列表；真实内容分散在「司局 → 子栏目」深层静态列表中，
 * 须逐栏目抓列表页解析。本站无 NFRA 那种 JSON 后端，只能 HTML 解析。
 *
 * 经实测（2026-08-20）选定两个结构干净、高价值的栏目：
 *   新闻发布  /goutongjiaoliu/113456/113469/index.html   —— 央行公告/货币政策执行报告/政策通知/互换协议（核心宏观信号）
 *   公告信息  /rmyh/105208/index.html                     —— 公告/公示/行政许可（支付机构续展等）
 * 两栏均为：文章链接 = 栏目路径 + /<时间戳ID>/index.html，日期在邻近 <span class="hui12"> 中，
 * 分页 = 栏目内容ID-N.html（由「下一页」onclick 的 queryArticleByCondition(this,'URL') 给出）。
 *
 * 未纳入（v1 排除，HTML 不规整、日期与链接不相邻且混入 footer 噪声，解析为 0）：
 *   货币政策 /rmyh/105145/、法律法规 /tiaofasi/144941/、政策解读 /rmyh/3963412/
 *   —— 如需覆盖，需为各栏写定制选择器，后续单独扩展。
 *
 * 产物：sourceId=pbc，category=finance（经 SOURCE_ROUTE），subcategory=cn-policy（国家政策标签）。
 */
const PBC_BASE = "https://www.pbc.gov.cn";
const PBC_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const PBC_REF = "https://www.pbc.gov.cn/";

interface PbcColumn {
  name: string;
  listUrl: string;
  basePath: string;
}
/** 目标栏目（basePath = 栏目目录，用于过滤本站文章链接、排除 footer 噪声） */
const PBC_COLUMNS: PbcColumn[] = [
  {
    name: "新闻发布",
    listUrl: `${PBC_BASE}/goutongjiaoliu/113456/113469/index.html`,
    basePath: "/goutongjiaoliu/113456/113469",
  },
  {
    name: "公告信息",
    listUrl: `${PBC_BASE}/rmyh/105208/index.html`,
    basePath: "/rmyh/105208",
  },
];
/** 每栏最多抓的列表页数（首页 + 次页，控制总量、保近期） */
const MAX_PAGES_PER_COLUMN = 2;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 把 2026/08/14、2026.08.14、2026年08月14日 归一为 YYYY-MM-DD（无效返回 ""） */
function normalizeDate(raw: string): string {
  const m = raw.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (!m) return "";
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 从文章 ID（时间戳，如 /2026081919184870631/index.html）前 8 位推导日期 */
function deriveDateFromId(url: string): string {
  const m = url.match(/\/(\d{14,})\/index\.html/);
  if (!m) return "";
  return normalizeDate(m[1].slice(0, 8));
}

interface ParsedItem {
  title: string;
  url: string;
  date: string;
}

export class PbcCrawler extends BaseCrawler {
  constructor() {
    super({ name: "中国人民银行", timeout: 15000, retries: 2 });
  }

  /** GET 返回 HTML 文本（带重试 + 超时 + 中文 UA/Referer，绕过反爬） */
  private async _getHtml(url: string): Promise<string | null> {
    const maxAttempts = this.retries + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const resp = await fetch(url, {
          headers: {
            "User-Agent": PBC_UA,
            Referer: PBC_REF,
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
        return await resp.text();
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

  /** 从列表页 HTML 解析本站文章链接 + 日期 */
  private _parseList(html: string, basePath: string): ParsedItem[] {
    const out: ParsedItem[] = [];
    const re = new RegExp(
      `<a\\s+href="(${escapeRegExp(basePath)}/[0-9]{6,}/index\\.html)"[^>]*>([^<]{2,120}?)</a>`,
      "g",
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const url = PBC_BASE + m[1];
      const title = m[2].trim();
      if (!title) continue;
      // 向后 600 字符内找 hui12 日期
      const after = html.slice(m.index, m.index + 600);
      const dm = after.match(/class="hui12"[^>]*>(20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2})/);
      const date = dm ? normalizeDate(dm[1]) : deriveDateFromId(m[1]);
      out.push({ title, url, date: date || new Date().toISOString().slice(0, 10) });
    }
    return out;
  }

  /** 取「下一页」onclick 中的真实分页页 URL（栏目内容ID-N.html），无则 null */
  private _nextPage(html: string): string | null {
    const m = html.match(
      /queryArticleByCondition\(this,'([^']+)'\)"[^>]*>下一页<\/a>/,
    );
    return m ? m[1] : null;
  }

  async run(): Promise<import("../base-crawler").CrawlerResult[]> {
    console.log(`[${this.name}] 开始抓取 (eportal 列表页)`);
    const seen = new Set<string>();

    for (const col of PBC_COLUMNS) {
      let pageUrl = col.listUrl;
      for (let p = 0; p < MAX_PAGES_PER_COLUMN; p++) {
        const html = await this._getHtml(pageUrl);
        if (!html) break;
        const items = this._parseList(html, col.basePath);
        for (const it of items) {
          if (seen.has(it.url)) continue;
          seen.add(it.url);
          this.results.push({
            title: it.title,
            url: it.url,
            excerpt: "",
            publishedAt: it.date,
            sourceId: "pbc",
            source: "中国人民银行",
          });
        }
        console.log(
          `[${this.name}] ${col.name} 第${p + 1}页解析 ${items.length} 条（累计 ${this.results.length}）`,
        );
        const next = this._nextPage(html);
        if (!next) break;
        pageUrl = PBC_BASE + next;
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    console.log(`[${this.name}] 完成，共 ${this.results.length} 条（去重后）`);
    return this.results;
  }
}

export function createCrawler(): PbcCrawler {
  return new PbcCrawler();
}
