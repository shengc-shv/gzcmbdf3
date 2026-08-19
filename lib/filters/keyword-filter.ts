/**
 * 关键词漏斗（边界③最前端，零成本）。
 *
 * 消费 sources.keywords.json（银行零售业务关键词体系 v4），对每条文章做
 * 三级过滤：L0 全局硬排除 → 地域分 → 维度命中 → 商机触发。
 * 未命中一律 pass=false（硬过滤，不进任何 AI 调用）。
 *
 * 匹配语义（v1 实现约定）：
 *  - L0 global_exclude 仅匹配标题（配置 `_note` 要求：误杀率<5%，命中即丢）。
 *  - geo / dimensions / opportunity 匹配 title+content（excerpt）拼接文本；
 *    `filter_rules.matching_mode=title_first` 的「正文≥3词复审池」分支为可选
 *    优化（配置注记建议初期关闭），v1 统一按全文本匹配实现。
 *  - 类正则 token（如 branch_expansion 的 "招聘.*人"）按正则编译，其余按精确子串。
 */
import type {
  KeywordConfig,
  DimensionRule,
  OpportunityTracker,
  RawArticleInput,
  FilterResult,
} from "./types";

const REGEX_META = /[.*+?^${}()|[\]\\]/;

/** 类正则 token 按正则编译匹配（失败降级子串），其余按精确子串。 */
function matchToken(token: string, text: string): boolean {
  if (REGEX_META.test(token)) {
    try {
      return new RegExp(token).test(text);
    } catch {
      return text.includes(token);
    }
  }
  return text.includes(token);
}

function anyTokenMatch(tokens: string[] | undefined, text: string): boolean {
  if (!tokens || tokens.length === 0) return false;
  return tokens.some((t) => matchToken(t, text));
}

function matchGeo(
  config: KeywordConfig,
  text: string,
): { score: number; hit: boolean } {
  const g = config.geo_filter;
  if (!g) return { score: 0, hit: false };
  if (anyTokenMatch(g.tier1_exact, text)) {
    return { score: g.weight?.tier1_hit ?? 100, hit: true };
  }
  if (anyTokenMatch(g.tier2_risky, text)) {
    return { score: g.weight?.tier2_only ?? 60, hit: false };
  }
  return { score: 0, hit: false };
}

function matchDimension(
  d: DimensionRule,
  text: string,
): { hit: boolean; strong: boolean; matched: string[] } {
  const matched: string[] = [];
  // exclude 优先：命中即强制不归入该维度
  if (d.exclude && d.exclude.some((w) => text.includes(w))) {
    return { hit: false, strong: false, matched };
  }
  for (const w of d.strong_keywords ?? []) {
    if (text.includes(w)) return { hit: true, strong: true, matched: [w] };
  }
  // weak 关键词必须与其 cooccurrence 词共现才算命中（无共现配置的 weak 词不单独命中）
  for (const [weak, coWords] of Object.entries(d.cooccurrence_for_weak ?? {})) {
    if (!(d.weak_keywords ?? []).includes(weak)) continue;
    if (text.includes(weak) && coWords.some((c) => text.includes(c))) {
      return { hit: true, strong: false, matched: [weak] };
    }
  }
  return { hit: false, strong: false, matched };
}

function matchTracker(
  t: OpportunityTracker,
  text: string,
  geoHit: boolean,
): { hit: boolean; matched: string[] } {
  if (t.geo_lock && !geoHit) return { hit: false, matched: [] };
  if (t.exclude_if_in_title && t.exclude_if_in_title.some((c) => text.includes(c))) {
    return { hit: false, matched: [] };
  }
  for (const tok of [...(t.strong_triggers ?? []), ...(t.triggers ?? [])]) {
    if (matchToken(tok, text)) return { hit: true, matched: [tok] };
  }
  return { hit: false, matched: [] };
}

/**
 * 对单条文章执行关键词漏斗（硬过滤）。
 *
 * @returns FilterResult — pass=false 表示未命中，应直接丢弃、不进 AI。
 */
export function applyKeywordFilter(
  article: RawArticleInput,
  config: KeywordConfig,
): FilterResult {
  const title = article.title ?? "";
  const full = `${title}\n${article.content ?? ""}`;
  const matched: string[] = [];

  // L0 全局硬排除（仅标题，命中即丢，负向优先）
  for (const group of Object.values(config.global_exclude ?? {})) {
    if (!Array.isArray(group)) continue; // 跳过 _note 等描述字段
    for (const w of group) {
      if (title.includes(w)) {
        matched.push(w);
        return { pass: false, score: 0, dimensions: [], matched, bucket: "dropped" };
      }
    }
  }

  const geo = matchGeo(config, full);

  // 维度命中（multi_dimension: all_hit — 允许多维度同时命中）
  const hitDims: string[] = [];
  let dimScore = 0;
  let weekly = false;
  for (const [key, d] of Object.entries(config.dimensions ?? {})) {
    if (!d || typeof d !== "object" || Array.isArray(d)) continue;
    const r = matchDimension(d, full);
    if (r.hit) {
      hitDims.push(key);
      dimScore += r.strong ? 2 : 1;
      if (d.weekly) weekly = true;
      matched.push(...r.matched);
    }
  }

  // 商机追踪（命中即商机池，极高优先级；按配置顺序取首个最高优先级）
  let opportunity: FilterResult["opportunity"];
  let oppScore = 0;
  for (const [key, t] of Object.entries(config.opportunity_tracker ?? {})) {
    if (!t || typeof t !== "object" || Array.isArray(t)) continue;
    if (t.priority !== "S" && t.priority !== "A" && t.priority !== "B") continue;
    const r = matchTracker(t, full, geo.hit);
    if (r.hit) {
      opportunity = {
        tracker: key,
        priority: t.priority,
        label: t.label ?? key,
        fields: t.fields ?? [],
        action: t.action ?? "",
      };
      oppScore = 1000;
      matched.push(...r.matched);
      break;
    }
  }

  let bucket: FilterResult["bucket"] = "dropped";
  if (opportunity) bucket = "opportunity";
  else if (weekly) bucket = "weekly";
  else if (hitDims.length > 0) bucket = "daily";

  return {
    pass: bucket !== "dropped",
    score: geo.score + dimScore + oppScore,
    dimensions: hitDims,
    ...(opportunity ? { opportunity } : {}),
    matched,
    bucket,
  };
}
