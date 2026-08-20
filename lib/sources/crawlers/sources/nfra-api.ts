import { BaseCrawler } from "../base-crawler";

/**
 * 国家金融监督管理总局（NFRA）政策/行政处罚爬虫
 *
 * 为什么不用 type:scrape：nfra.gov.cn 首页是 Angular 客户端渲染（<meta refresh> 跳转壳 +
 * 文章链接全为 {{x.agencyShortlink}} 模板占位），CI 无 JS 引擎，静态抓取必为空。
 * 真实数据由后端 ESD CMS（原 CBIRC 模板，mangren.com/cbirc.gov.cnV5）的 JSON 接口提供，
 * 站点通过 /cbircweb 反向代理暴露，可直连：
 *   - 菜单树：  GET  https://www.nfra.gov.cn/cbircweb/item/getWebMenuItem?lang=CN
 *   - 文档列表：GET  https://www.nfra.gov.cn/cbircweb/DocInfo/SelectDocByItemUUIdsAndChild
 *                 ?itemUUIds=<逗号分隔叶子栏目UUID>&pageSize=50&orderBy=builddate
 * （前端 angular.1.2.32 用 global.getCDN 把 params 拼成 query string 发 GET 请求，
 *  故此处一律 GET + query，POST/单数 itemUUid 均无效——已实测。）
 *
 * 抓取目标栏目（菜单 itemId 稳定）：
 *   政策法规(926) / 行政处罚(931) / 政策解读(916) / 公告通知(925)
 * 每个栏目递归收集其叶子栏目 itemUUid，批量拉取文档；菜单解析失败则回退硬编码叶子。
 *
 * 产物：sourceId=nfra，category=finance（经 SOURCE_ROUTE），subcategory 由 item-classifier
 * 按「金融监管总局」命中归 cn-policy（国家政策标签）。
 */
const NFRA_API = "https://www.nfra.gov.cn/cbircweb";
const NFRA_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const NFRA_REF = "https://www.nfra.gov.cn/cn/view/pages/index/index.html";

/** 目标栏目菜单 itemId（稳定，权威发布结构） */
const NFRA_COLUMNS = [926, 931, 916, 925];

/** 菜单解析失败时的兜底叶子 itemUUid（接口逆向实测，policy+penalty 子树） */
const NFRA_FALLBACK_LEAVES = [
  "91030301",
  "91030302", // 政策法规 → 法律法规 / 政策规章规范性文件
  "91030501",
  "91030502",
  "91030503", // 行政处罚 → 总局机关 / 派出机构 / 监管局本级 等
];

interface MenuNode {
  itemName?: string;
  itemId?: number;
  itemUUid?: string;
  subItemslist?: MenuNode[] | null;
}
interface NfraDoc {
  docId?: number;
  docTitle?: string;
  docSubtitle?: string;
  docSummary?: string | null;
  publishDate?: string;
  itemId?: number;
  itemName?: string;
}

export class NfraCrawler extends BaseCrawler {
  constructor() {
    super({ name: "国家金融监督管理总局", timeout: 15000, retries: 2 });
  }

  /** GET JSON（带重试 + 超时 + 中文 UA/Referer，绕过反爬） */
  private async _getJson(
    path: string,
    params?: Record<string, string>,
  ): Promise<unknown | null> {
    const url = new URL(NFRA_API + path);
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const maxAttempts = this.retries + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const resp = await fetch(url.toString(), {
          headers: {
            "User-Agent": NFRA_UA,
            Referer: NFRA_REF,
            Accept: "application/json",
          },
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
        return await resp.json();
      } catch (err) {
        console.warn(
          `[${this.name}] ${path} 抓取失败（尝试 ${attempt}/${maxAttempts}）: ${(err as Error).message}`,
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

  /** 递归收集菜单叶子节点的 itemUUid（无子节点者才是有文档的终端栏目） */
  private _collectLeafUuids(node: MenuNode, out: Set<string>): void {
    const kids = node.subItemslist && node.subItemslist.length ? node.subItemslist : null;
    if (!kids) {
      if (node.itemUUid) out.add(node.itemUUid);
      return;
    }
    for (const k of kids) this._collectLeafUuids(k, out);
  }

  async run(): Promise<import("../base-crawler").CrawlerResult[]> {
    console.log(`[${this.name}] 开始抓取 (ESD 后端 /cbircweb)`);
    const leaves = new Set<string>();

    // 1) 拉菜单树，定位目标栏目并收集叶子 itemUUid
    const menu = (await this._getJson("/item/getWebMenuItem", { lang: "CN" })) as
      | { data?: MenuNode[] }
      | null;
    const tree = menu?.data;
    if (Array.isArray(tree)) {
      const byId = (id: number): MenuNode | undefined => {
        const stack: MenuNode[] = [...tree];
        while (stack.length) {
          const n = stack.pop()!;
          if (n.itemId === id) return n;
          if (n.subItemslist) stack.push(...n.subItemslist);
        }
        return undefined;
      };
      for (const col of NFRA_COLUMNS) {
        const node = byId(col);
        if (node) this._collectLeafUuids(node, leaves);
      }
    }
    if (leaves.size === 0) {
      NFRA_FALLBACK_LEAVES.forEach((u) => leaves.add(u));
      console.warn(`[${this.name}] 菜单解析失败，使用兜底叶子 itemUUid`);
    }

    // 2) 批量拉取文档（每次最多 10 个叶子，避免超长 query）
    const uuids = [...leaves];
    const seen = new Set<string>();
    for (let i = 0; i < uuids.length; i += 10) {
      const chunk = uuids.slice(i, i + 10);
      const data = (await this._getJson("/DocInfo/SelectDocByItemUUIdsAndChild", {
        itemUUIds: chunk.join(","),
        pageSize: "50",
        orderBy: "builddate",
      })) as { data?: NfraDoc[] } | null;
      const docs = data?.data;
      if (!Array.isArray(docs)) continue;
      for (const doc of docs) {
        const docId = doc.docId;
        if (!docId) continue;
        const key = String(docId);
        if (seen.has(key)) continue;
        seen.add(key);
        const title = (doc.docTitle || doc.docSubtitle || "").trim();
        if (!title) continue;
        // 取不到发布日期 → undefined（不伪造"今天"，避免旧文绕过窗口进历史库）
        const pub = doc.publishDate ? doc.publishDate.slice(0, 10) : undefined;
        const subtitle = doc.docSubtitle && doc.docSubtitle !== title ? doc.docSubtitle : "";
        const excerpt = (subtitle || doc.docSummary || "").toString().slice(0, 200);
        this.results.push({
          title,
          url: `https://www.nfra.gov.cn/cn/view/pages/ItemDetail.html?docId=${docId}`,
          excerpt,
          publishedAt: pub,
          sourceId: "nfra",
          source: "国家金融监督管理总局",
        });
      }
      await new Promise((r) => setTimeout(r, 300));
    }

    console.log(`[${this.name}] 完成，共 ${this.results.length} 条（去重后）`);
    return this.results;
  }
}

export function createCrawler(): NfraCrawler {
  return new NfraCrawler();
}
