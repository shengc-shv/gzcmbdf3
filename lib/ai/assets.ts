/**
 * AI 产物持久化账本（M2-指令④）。
 *
 * 所有 AI 输出都是「花钱的资产」，存 data/ai-assets/store.json（append-only 语义：
 * 永不按 7 天窗口裁剪，仅受 AI_ASSETS_MAX 上限约束）。daily.ts 优先读、未命中才调 LLM。
 *
 * 键：文章用 url；每日聚合用 `daily:<date>`（执行摘要 / 交易点评）。
 * 旁路：PERSIST_AI=off 时不读不写（回退原 history 缓存行为）。
 * 上限：AI_ASSETS_MAX=N（正整数）时，超限按 updatedAt 最旧优先裁剪；0/缺省 = 不限制。
 */
import fs from "node:fs";
import path from "node:path";

export interface ArticleAiAsset {
  summary?: string;
  subcategory?: string;
  subcategories?: string[];
  relevant?: boolean;
  updatedAt: string;
}

export interface DailyAiAsset {
  executive?: unknown;
  trading?: unknown;
  updatedAt: string;
}

export type AiAssetStore = Record<string, ArticleAiAsset | DailyAiAsset>;

const ASSETS_PATH = "data/ai-assets/store.json";

export function aiAssetsEnabled(): boolean {
  return process.env.PERSIST_AI !== "off";
}

export function loadAiAssets(): AiAssetStore {
  if (!aiAssetsEnabled()) return {};
  try {
    if (fs.existsSync(ASSETS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(ASSETS_PATH, "utf8"));
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        return raw as AiAssetStore;
      }
    }
  } catch {
    // 损坏文件 → 重新开始，绝不 crash
  }
  return {};
}

export function saveAiAssets(store: AiAssetStore): void {
  if (!aiAssetsEnabled()) return;
  try {
    const max = Number(process.env.AI_ASSETS_MAX ?? "0");
    if (max > 0 && Object.keys(store).length > max) {
      const entries = Object.entries(store).sort((a, b) =>
        a[1].updatedAt < b[1].updatedAt ? -1 : 1,
      );
      for (const [k] of entries.slice(0, entries.length - max)) delete store[k];
    }
    fs.mkdirSync(path.dirname(ASSETS_PATH), { recursive: true });
    fs.writeFileSync(ASSETS_PATH, JSON.stringify(store, null, 2), "utf8");
  } catch {
    // 写盘失败不打断主流程
  }
}

/** 每日聚合资产键（执行摘要/交易点评）。 */
export function dailyAssetKey(date: string): string {
  return `daily:${date}`;
}

/** 便捷读取：文章的 AI 摘要（无则 undefined）。 */
export function assetSummary(store: AiAssetStore, url: string): string | undefined {
  const a = store[url];
  if (a && "summary" in a) return a.summary;
  return undefined;
}

/** 便捷读取：每日聚合资产。 */
export function assetDaily(store: AiAssetStore, date: string): DailyAiAsset | undefined {
  const a = store[dailyAssetKey(date)];
  return a && "executive" in a ? (a as DailyAiAsset) : undefined;
}
