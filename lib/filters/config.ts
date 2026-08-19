/**
 * 关键词漏斗配置加载与旁路开关。
 *
 * 配置：仓库根 sources.keywords.json（fs 读取，不依赖 tsconfig resolveJsonModule）。
 * 旁路：KEYWORD_FILTER=off 时跳过漏斗，保留全量（回退原行为）。
 */
import fs from "node:fs";
import path from "node:path";
import type { KeywordConfig } from "./types";

export function loadKeywordConfig(): KeywordConfig {
  const p = path.resolve(process.cwd(), "sources.keywords.json");
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw) as KeywordConfig;
}

/** 漏斗是否启用：默认开启；KEYWORD_FILTER=off 旁路关闭。 */
export function keywordFilterEnabled(): boolean {
  return process.env.KEYWORD_FILTER !== "off";
}

/** 全量被误杀时是否回退保底（默认回退，避免空报告）。KEYWORD_FILTER_FALLBACK=off 关闭。 */
export function keywordFilterFallbackEnabled(): boolean {
  return process.env.KEYWORD_FILTER_FALLBACK !== "off";
}

// —— 标题相似度判重配置（消费 sources.keywords.json 的 filter_rules.deduplication）——
export interface DedupConfig {
  enabled: boolean;
  threshold: number;
  maxPerTheme: number;
}

/** 标题相似度判重是否启用：默认开启；DEDUP_SIMILAR=off 旁路关闭。 */
export function dedupSimilarEnabled(): boolean {
  return process.env.DEDUP_SIMILAR !== "off";
}

/**
 * 读取判重参数：优先 sources.keywords.json 的 filter_rules.deduplication
 * （threshold / max_per_theme），缺省 threshold=0.7、max_per_theme=2。
 */
export function loadDedupConfig(): DedupConfig {
  const cfg: DedupConfig = {
    enabled: dedupSimilarEnabled(),
    threshold: 0.7,
    maxPerTheme: 2,
  };
  try {
    const raw = loadKeywordConfig();
    const d = raw.filter_rules?.deduplication;
    if (d) {
      if (typeof d.threshold === "number") cfg.threshold = d.threshold;
      if (typeof d.max_per_theme === "number") cfg.maxPerTheme = d.max_per_theme;
    }
  } catch {
    // 配置缺失时用默认参数
  }
  return cfg;
}
