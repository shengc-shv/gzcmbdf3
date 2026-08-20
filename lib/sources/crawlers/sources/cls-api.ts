import { createHash } from "node:crypto";
import { BaseCrawler, type CrawlerResult } from "../base-crawler";

/**
 * 财联社·金融深度频道（cls.cn/depth?id=1032）爬虫
 *
 * 为什么不用 type:scrape 直接抓首页：cls.cn 是 Next.js SSR，页面只有 10KB 壳，
 * 真实数据由 JS 通过接口异步加载（首页 HTML 无文章列表），必须调后端 JSON 接口。
 *
 * 接口逆向（2026-08-20，已实测打通）：
 *   首屏  GET /v3/depth/home/assembled/1032
 *          → data.depth_list: [{ id, title, brief, ctime(Unix秒), ... }]
 *   分页  GET /v3/depth/list/1032?last_time=<上批末条ctime>&rn=20&id=1032
 *          → data: [ {...} ]（按 ctime 游标取更早文章）
 *   签名  sign = md5( hex(sha1( 排序后的 query 字符串 )) )
 *         固定参数 app=CailianpressWeb&os=web&sv=8.7.9（由 _app.js request 封装逆向；
 *         无签名返回 errno=10012「签名错误」）。sv 版本会变，失败时需同步页面 JS 里的版本。
 *   文章  URL = https://www.cls.cn/detail/<id>；日期由 ctime 转北京时间 YYYY-MM-DD。
 *
 * 频道 1032 = 金融深度（银行/政策/市场/机构等深度报道与要闻）。
 *
 * 产物：sourceId=cls，category=finance（经 SOURCE_ROUTE），subcategory=cn-finance（国内财经新闻标签）。
 */
const CLS_BASE = "https://www.cls.cn";
const CLS_DEPTH_ID = "1032"; // 金融频道
const CLS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const CLS_REF = "https://www.cls.cn/depth?id=1032";
/** 从页面 JS（_app.js request 封装）逆向的固定参数；sv 变更时需同步 */
const CLS_FIXED = { app: "CailianpressWeb", os: "web", sv: "8.7.9" };
/** 每批条数 + 分页批数（首屏 depth_list ~27 + 分页 1 批 20 → ~47 条/小时） */
const PAGE_SIZE = 20;
const MAX_LIST_CALLS = 1;

/** 财联社签名：md5( hex(sha1( 排序后 query )) ) */
function clsSign(params: Record<string, string>): string {
  const qs = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  const sha1hex = createHash("sha1").update(qs, "utf8").digest("hex");
  return createHash("md5").update(sha1hex, "utf8").digest("hex");
}

/** Unix 秒 → 北京时间 YYYY-MM-DD（无效返回 ""） */
function dateFromCtime(ctime: number): string {
  if (!Number.isFinite(ctime) || ctime <= 0) return "";
  return new Date((ctime + 8 * 3600) * 1000).toISOString().slice(0, 10);
}

interface ClsItem {
  id: number | string;
  title: string;
  brief?: string;
  ctime?: number;
}

export class ClsCrawler extends BaseCrawler {
  constructor() {
    super({ name: "财联社", timeout: 15000, retries: 2 });
  }

  /** 带签名的 GET JSON（重试 + 超时 + 中文 UA/Referer） */
  private async _getJson(path: string, params: Record<string, string>): Promise<Record<string, unknown> | null> {
    const qs = Object.keys(params)
      .sort()
      .map((k) => `${k}=${encodeURIComponent(params[k])}`)
      .join("&");
    const sign = clsSign(params);
    const url = `${CLS_BASE}${path}?${qs}&sign=${sign}`;
    const maxAttempts = this.retries + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const resp = await fetch(url, {
          headers: { "User-Agent": CLS_UA, Referer: CLS_REF, Accept: "application/json" },
          signal: AbortSignal.timeout(this.timeout),
        });
        if (!resp.ok) {
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 800 * attempt));
            continue;
          }
          console.warn(`[${this.name}] ${path} 返回 ${resp.status}`);
          return null;
        }
        return (await resp.json()) as Record<string, unknown>;
      } catch (err) {
        console.warn(
          `[${this.name}] ${path} 请求失败（尝试 ${attempt}/${maxAttempts}）: ${(err as Error).message}`,
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

  /** 从接口 data 中提取文章数组（depth_list 或分页裸数组） */
  private _extractItems(data: unknown): ClsItem[] {
    const list = Array.isArray(data) ? data : (data as { depth_list?: unknown })?.depth_list;
    if (!Array.isArray(list)) return [];
    return list
      .filter((it): it is Record<string, unknown> => !!it && typeof it === "object")
      .map((it) => ({
        id: String(it.id ?? ""),
        title: String(it.title ?? "").trim(),
        brief: it.brief ? String(it.brief).trim() : "",
        ctime: typeof it.ctime === "number" ? it.ctime : Number(it.ctime ?? 0),
      }))
      .filter((it) => it.id && it.title);
  }

  async run(): Promise<CrawlerResult[]> {
    console.log(`[${this.name}] 开始抓取 (v3/depth API, 频道 ${CLS_DEPTH_ID})`);
    const seen = new Set<string>();

    // 首屏
    const first = await this._getJson(`/v3/depth/home/assembled/${CLS_DEPTH_ID}`, { ...CLS_FIXED });
    const items = first ? this._extractItems(first.data) : [];
    let lastTime = "";
    for (const it of items) {
      if (seen.has(String(it.id))) continue;
      seen.add(String(it.id));
      this.results.push({
        title: it.title,
        url: `${CLS_BASE}/detail/${it.id}`,
        excerpt: it.brief ?? "",
        publishedAt: dateFromCtime(it.ctime ?? 0) || new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10),
        sourceId: "cls",
        source: "财联社",
      });
      lastTime = String(it.ctime ?? lastTime);
    }
    console.log(`[${this.name}] 首屏解析 ${items.length} 条（累计 ${this.results.length}）`);

    // 分页（游标 last_time）
    for (let i = 0; i < MAX_LIST_CALLS && lastTime; i++) {
      const paged = await this._getJson(`/v3/depth/list/${CLS_DEPTH_ID}`, {
        ...CLS_FIXED,
        id: CLS_DEPTH_ID,
        last_time: lastTime,
        rn: String(PAGE_SIZE),
      });
      const more = paged ? this._extractItems(paged.data) : [];
      let newCount = 0;
      for (const it of more) {
        if (seen.has(String(it.id))) continue;
        seen.add(String(it.id));
        this.results.push({
          title: it.title,
          url: `${CLS_BASE}/detail/${it.id}`,
          excerpt: it.brief ?? "",
          publishedAt: dateFromCtime(it.ctime ?? 0) || new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10),
          sourceId: "cls",
          source: "财联社",
        });
        newCount++;
        lastTime = String(it.ctime ?? lastTime);
      }
      console.log(`[${this.name}] 分页${i + 1} 解析 ${more.length} 条（新增 ${newCount}，累计 ${this.results.length}）`);
      if (newCount === 0) break;
      await new Promise((r) => setTimeout(r, 300));
    }

    console.log(`[${this.name}] 完成，共 ${this.results.length} 条（去重后）`);
    return this.results;
  }
}

export function createCrawler(): ClsCrawler {
  return new ClsCrawler();
}
