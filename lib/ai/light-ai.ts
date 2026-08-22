// 2026-08-22 降本：以下命中率偏低（10%~34%）但保留作本地热点发现的爬虫源，
// 每源每天最多取 LIGHT_AI_MAX_PER_SOURCE 条进 AI 管线，且 raw_text 截断到 LIGHT_AI_RAW_CAP 字，
// 两项叠加使 PASS1 对它们的 token 占用降 ~90%（PASS2 本就很少为低命中源成稿）。
export const LIGHT_AI_SOURCES = new Set<string>([
  "cnfin",
  "stcn",
  "dayoo-gz",
  "southcn",
  "cnr-gd",
]);
export const LIGHT_AI_MAX_PER_SOURCE = 6;
export const LIGHT_AI_RAW_CAP = 200;

export interface LightAiArticle {
  sourceId?: string;
  publishedAt?: Date;
}

/**
 * 对 lightAi 源按 sourceId 分组、每源保留最新 maxPer 条；其余源原样保留。
 * 用于降 AI 管线 token 占用：低命中率源只取少量最新条目送 PASS1。
 */
export function capLightAiSources<T extends LightAiArticle>(
  articles: T[],
  lightSet: Set<string>,
  maxPer: number,
): T[] {
  const lightGroups = new Map<string, T[]>();
  const others: T[] = [];
  for (const a of articles) {
    const sid = a.sourceId ?? "";
    if (lightSet.has(sid)) {
      if (!lightGroups.has(sid)) lightGroups.set(sid, []);
      lightGroups.get(sid)!.push(a);
    } else {
      others.push(a);
    }
  }
  const capped: T[] = [];
  for (const items of lightGroups.values()) {
    items.sort(
      (x, y) => (y.publishedAt?.getTime() ?? 0) - (x.publishedAt?.getTime() ?? 0),
    );
    capped.push(...items.slice(0, maxPer));
  }
  return [...others, ...capped];
}
