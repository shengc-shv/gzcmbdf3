/**
 * 本地手动采集（被 WAF 拦截的国内源专用，2026-08-20 方案）
 *
 * 替代已放弃的 self-hosted runner：NFRA / PBC / 财联社 / 同花顺 等站点拦截
 * GitHub 托管 runner 的国外出口 IP（CI 下 0 条、本地直连正常）。由本地 WorkBuddy
 * 的 skill（local-acquire）触发本脚本：
 *   1. 本地抓取这 4 个源（国内 IP 直连）；
 *   2. 归一化 CrawledArticle（与爬虫产物同构）；
 *   3. 合并进 data/local-acquired.json（URL 去重 + 只留最近 7 天）→ 写回；
 *   4. 由 skill 层 git 提交推送，CI 正式跑时 daily 读取该文件并入管线。
 *
 * 用法：npm run acquire:local（提交推送由 skill 层执行，本脚本不碰 git）
 */
import fs from "node:fs";
import type { CrawledArticle } from "../lib/ingest/merge";
import { NfraCrawler } from "../lib/sources/crawlers/sources/nfra-api";
import { PbcCrawler } from "../lib/sources/crawlers/sources/pbc-web";
import { ClsCrawler } from "../lib/sources/crawlers/sources/cls-api";
import { TonghuashunIPOCrawler } from "../lib/sources/crawlers/sources/tonghuashun-ipo";
import { loadLocalAcquired, filterLocalAcquiredRecent, LOCAL_ACQUIRED_DAYS } from "../lib/sources/local-acquired";

const OUT = "data/local-acquired.json";
const DAYS = LOCAL_ACQUIRED_DAYS;

/** URL 去重（保序，保留首次出现）；无 URL 条目跳过 */
function dedupeByUrl(items: CrawledArticle[]): CrawledArticle[] {
  const seen = new Set<string>();
  const out: CrawledArticle[] = [];
  for (const it of items) {
    const key = it.url || "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

async function main(): Promise<void> {
  console.log("[acquire:local] 开始本地采集（NFRA / PBC / 财联社 / 同花顺）…");

  const fresh: CrawledArticle[] = [];
  const crawlers = [
    new NfraCrawler(),
    new PbcCrawler(),
    new ClsCrawler(),
    new TonghuashunIPOCrawler(),
  ];
  for (const c of crawlers) {
    try {
      await c.run();
      fresh.push(...(c.results as CrawledArticle[]));
      console.log(`[acquire:local] ${c.name}: ${c.results.length} 条`);
    } catch (err) {
      console.warn(`[acquire:local] ${c.name} 抓取异常，跳过:`, (err as Error).message);
    }
  }
  console.log(`[acquire:local] 本次抓到 ${fresh.length} 条`);

  // 合并：已有条目先按 7 天裁剪，本次新抓**同样**按 7 天裁剪后再合并
  // （2026-08-20：此前只裁 kept，PBC 列表页常青旧文（预算/决算/续展公示）每次重进文件，
  // 与 SKILL.md「合并时已按 7 天裁剪」表述不符；裁剪后旧文不再写回，文件只留近 7 天）
  const existing = loadLocalAcquired()?.items ?? [];
  const cutoff = Date.now() - DAYS * 24 * 3600 * 1000;
  const kept = existing.filter((it) => {
    if (!it.publishedAt) return false;
    const t = Date.parse(it.publishedAt);
    return Number.isFinite(t) && t >= cutoff;
  });
  const freshRecent = filterLocalAcquiredRecent(fresh, DAYS);
  const merged = dedupeByUrl([...freshRecent, ...kept]);
  const file = {
    fetchedAt: new Date().toISOString(),
    items: merged,
  };
  fs.writeFileSync(OUT, JSON.stringify(file, null, 2), "utf8");
  console.log(
    `[acquire:local] ✅ 已写回 ${OUT}: 本次 ${fresh.length} 条（7天内 ${freshRecent.length} 条） + 保留 ${kept.length} 条 → 合并 ${merged.length} 条（最近 ${DAYS} 天）`,
  );
}

main().catch((err) => {
  console.error("[acquire:local] 失败:", (err as Error).message);
  process.exit(1);
});
