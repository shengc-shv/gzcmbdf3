import { curlFetch } from "./curl-fetch";
import type { RawArticle } from "./types";
import { extractDateFromUrl } from "../utils";

/**
 * 财富管理 / 个人信贷 商机源
 *
 * - fetchSinaMoney：新浪财经「理财/保险」频道（finance.sina.com.cn/money/），
 *   服务端渲染列表可抓，按关键词过滤出 理财/基金/保险/黄金/存款/利率 类 → 财富业务。
 * - fetch21jingji：21世纪经济报道·金融频道（21jingji.com/channel/finance），
 *   按关键词过滤出 房贷/消费贷/普惠/信贷/金融监管 类 → 个人信贷。
 *
 * 两者归 category=gz（广州商机），子标签由启发式/AI 分类路由到 gz-wealth / gz-credit。
 */

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

function clean(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
}

/** 财富业务关键词（理财/保险/基金/黄金/存款/利率） */
const WEALTH_KW = /理财|保险|基金|黄金|存款|利率|养老金|资管|信托|债券基金|净值|申购|赎回|寿险|财险|贵金属/;
/** 个人信贷关键词（房贷/消费贷/普惠/信贷/银行/金融） */
const CREDIT_KW = /房贷|消费贷|普惠|信贷|贷款|按揭|首付|利率|融资|助贷|信用卡|公积金|LPR|银行|金融|债券|存款|人民币|货币|监管/;

export async function fetchSinaMoney(
  sourceId: string,
  limit = 20,
): Promise<RawArticle[]> {
  const html = await curlFetch("https://finance.sina.com.cn/money/", HEADERS);
  const re = /<a href="([^"]+)"[^>]*>([^<]{10,60})<\/a>/g;
  const out: RawArticle[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.length < limit) {
    const href = m[1];
    const title = clean(m[2]);
    if (href.startsWith("javascript:") || title.length < 10) continue;
    if (!WEALTH_KW.test(title)) continue; // 只留财富业务相关
    const url = href.startsWith("http") ? href : `https://finance.sina.com.cn${href}`;
    // 列表页无内联日期 → URL 路径含 YYYY-MM-DD（/roll/2026-08-21/doc-*.shtml）兜底
    const d = extractDateFromUrl(url);
    out.push({
      sourceId,
      title,
      url,
      excerpt: `【财富管理】${title}`,
      category: "gz",
      ...(d ? { publishedAt: new Date(`${d}T00:00:00.000Z`) } : {}),
    });
  }
  return out;
}

export async function fetch21jingjiFinance(
  sourceId: string,
  limit = 20,
): Promise<RawArticle[]> {
  const html = await curlFetch("https://www.21jingji.com/channel/finance", HEADERS);
  const re = /<a[^>]+href="([^"]+)"[^>]*title="([^"]{10,80})"[^>]*>/g;
  const out: RawArticle[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.length < limit) {
    const href = m[1];
    const title = clean(m[2]);
    if (!CREDIT_KW.test(title)) continue; // 只留信贷/金融监管相关
    const url = href.startsWith("http") ? href : `https://www.21jingji.com${href}`;
    // 文章 URL 含 YYYYMMDD（m.21jingji.com/article/20260820/...）→ 兜底补日期
    const d = extractDateFromUrl(url);
    out.push({
      sourceId,
      title,
      url,
      excerpt: `【21财经】${title}`,
      category: "gz",
      ...(d ? { publishedAt: new Date(`${d}T00:00:00.000Z`) } : {}),
    });
  }
  return out;
}
