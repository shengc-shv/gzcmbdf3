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

/** 摘要自述「与银行零售无关/无直接关联/不属于/无参考」→ 强制 ai_relevant=false。
 * （2026-08-22 用户口径：摘要自己都说无关的条目一律不显示，标题带不带「广州」
 *  都保护不了——曾因标题锚点含「广州」而放过「广州启动玫瑰合伙人计划」这类本地
 *  活动垃圾。浦发信用卡/银监法/加息/平安寿险等摘要被预分析误写「无直接关联」的
 *  同业条目，按「围绕广州股份行零售研判」口径删除同样正确。也不含「不纳入商机」
 *  （那是「非商机」≠「无关」）。摘要文本是 AI 的真实判断，是排除的最硬证据。） */
const SELF_DECLARE_IRRELEVANT =
  /无关|不相关|无[^。，]{0,8}(直接)?关联|不属于|无[^。，]{0,6}参考|无借鉴/;

/** 摘要纯空话：≤70字 且只写「对广州分行…具参考」且标题无任何零售/金融/本地锚点 →
 *  相关性无实据，强制移除（2026-08-22：预分析把 90 条网易财报/召回/港交所公告/
 *  商品指数/海外政治用一句空话糊进报告）。锚点刻意放宽，宁可漏网不误杀。 */
const FILLER_SUMMARY = /^.{0,70}对广州分行.*(具参考|参考)/;
const TITLE_RETAIL_ANCHOR =
  /银行|金融|信贷|贷款|房贷|消费贷|信用卡|理财|基金|黄金|金价|银价|贵金属|保险|寿险|险资|保费|保单|养老|财富|私行|客群|代发|收单|支付|利率|汇率|存款|国债|美债|债券|LPR|央行|监管|银监|处罚|罚单|证券|券商|信托|资管|AUM|普惠|小微|公积金|上市|IPO|融资|并购|港股|A股|股权|外汇|人民币|数字货币|同业|不良|征信|消保|县域|产业园|商圈|跨境|结算|商户|供应链|消费|零售|社零|GDP|经济|投资|外贸|出口|进口|就业|CPI|社融|M2|降准|降息|加息|再贷款|再贴现|逆回购|MLF|票据|湾区|粤港澳|珠三角|广州|广东|南沙|湛江|清远/;

/** 人工研判清单（2026-08-22 一次性清理）：一眼非零售——科技公司业绩/机器人/汽车/
 *  商品现货指数/粮食/教育/加密货币/本地活动（标题带「广州」但摘要自述无关或纯空话，
 *  如「广州启动玫瑰合伙人计划」「第34届广州博览会」）。固化进脚本保证可复现。 */
const MANUAL_DROP = [
  "AI Infra", "热联集团", "北京现代", "荣耀Robot", "WAIC", "南方电网多款自研机器人",
  "星忆智能", "世界机器人大会", "绿色算力", "多晶硅", "硅片与电池", "车辆被召回",
  "矿山智能化", "固态电池", "筹码连续多期集中", "国晟科技", "爆仓", "中国奶牛",
  "香蕉产地价格指数", "山东港口", "长飞光纤", "光峰科技", "天娱数科", "天创时尚",
  "博腾股份", "丽珠集团", "科沃斯", "威力传动", "宝莱特", "大金重工", "美的置业",
  "东方甄选", "广东实验中学", "粮食危机", "秋粮生产", "厄尔尼诺", "三小孩",
  "中泰证券出手回购", "复宏汉霖", "奶茶店", "潮玩嘉年华", "泡泡玛特", "网易", "亚朵",
  "玫瑰合伙人", "广州博览会", "国际发明展",
];

for (const [url, e] of entries) {
  const input: RawArticleInput = {
    title: e.title || "",
    content: e.excerpt || "",
    sourceId: e.sourceId || "",
    url,
    category: catOf(e),
  };
  const r = applyKeywordFilter(input, cfg); // 仅 L0 排除（reverted）
  // 规则1：标题命中 L0 明显噪声 → 强制移除（女兵征兵/国际军事/天气/马拉松等）
  // 规则2：摘要自述无关 → 强制移除（玫瑰合伙人/白云山等，标题锚点不保护——摘要
  //        是 AI 真实判断，排除的最硬证据；「广州」在标题里不代表业务相关）
  // 规则3：摘要纯空话 且 标题无零售锚点 → 强制移除（相关性无实据）
  // 规则4：人工研判清单 → 强制移除（一眼非零售的历史打标）
  const titleAnchor = TITLE_RETAIL_ANCHOR.test(e.title || "");
  const selfDeclared =
    e.ai_relevant && !!e.summary && SELF_DECLARE_IRRELEVANT.test(e.summary);
  const fillerNoAnchor =
    e.ai_relevant && !!e.summary && FILLER_SUMMARY.test(e.summary) && !titleAnchor;
  const manualDrop = MANUAL_DROP.some((w) => (e.title || "").includes(w));
  if (!r.pass || selfDeclared || fillerNoAnchor || manualDrop) {
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
