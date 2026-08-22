/**
 * 按「漏斗仅 L0 明显噪声排除」重清理 data/article-history.json（2026-08-22 回退）。
 *
 * 背景：此前曾用「相关性闸门」重写 ai_relevant，误杀了「央行货币政策执行报告」
 * 「落户…研发中心」等本应进 AI 研判的条目，违背「准确性第一、宁花 AI 成本」取舍。
 * 现 revert：keyword-filter 在 L0 之后一律放行进 AI，相关性准度交由 PASS1/PASS2 裁决。
 *
 * 本脚本因此只做一件事：把标题命中 L0 全局排除词（女兵征兵/国际军事/天气/马拉松…）
 * 的条目强制 ai_relevant=false；其余条目的既有 AI 判定（本地预分析或 PASS1/PASS2）
 * 一律保留（不复活、不移除）。写回 data/article-history.json。
 *
 * 用法：node --import tsx scripts/retag-relevance.ts
 */
import fs from "node:fs";
import { loadKeywordConfig } from "../lib/filters/config";
import { applyKeywordFilter } from "../lib/filters/keyword-filter";
import type { RawArticleInput } from "../lib/filters/types";

const cfg = loadKeywordConfig();
const histPath = "data/article-history.json";
const hist = JSON.parse(fs.readFileSync(histPath, "utf8")) as Record<string, any>;
const entries = Object.entries(hist);

function catOf(e: any): string {
  if (e.category) return e.category;
  const sub = e.subcategory || "";
  if (sub.startsWith("gz-")) return "gz";
  if (sub === "tech" || sub === "ipo" || sub === "gd-ipo" || sub === "politics") return sub;
  return "finance"; // cn-* / news / 其他 → finance
}

let changed = 0;
const droppedTitles: string[] = [];

for (const [url, e] of entries) {
  const input: RawArticleInput = {
    title: e.title || "",
    content: e.excerpt || "",
    sourceId: e.sourceId || "",
    url,
    category: catOf(e),
  };
  const r = applyKeywordFilter(input, cfg); // 仅 L0 排除（reverted）
  // 仅当标题命中 L0 明显噪声时才强制移除；非 L0 保留既有 AI 判定
  if (!r.pass) {
    if (e.ai_relevant) changed++;
    e.ai_relevant = false;
    droppedTitles.push(`[${catOf(e)}] ${e.title ?? url}`);
  }
}

fs.writeFileSync(histPath, JSON.stringify(hist, null, 2), "utf8");
const kept = entries.filter(([, e]) => e.ai_relevant).length;
const dropped = entries.length - kept;
console.log(`\n✅ L0 清理完成：保留(ai_relevant=true)=${kept}，移除(ai_relevant=false)=${dropped}，本次变更=${changed}`);
console.log(`历史库总条目=${entries.length}`);
console.log(`\n--- 本次 L0 移除的 ${droppedTitles.length} 条（供人工复核，确认无误杀）---`);
for (const t of droppedTitles.slice(0, 80)) console.log("  - " + t);
if (droppedTitles.length > 80) console.log(`  …（其余 ${droppedTitles.length - 80} 条略）`);
