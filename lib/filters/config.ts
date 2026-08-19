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
