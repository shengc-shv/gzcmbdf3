/**
 * 数据源等级（T1/T1.5/T2）—— 采集层声明的源权威性元数据。
 *
 * - T1   = 官方一手（政府 / 央行 / 监管机构）
 * - T1.5 = 准官方·机构一手（交易所 / 行业协会 / 官方背景机构）
 * - T2   = 媒体·智库
 *
 * 边界纪律：采集层声明 tier → 归一化层透传（只透传、不渲染）→ 渲染层差异化标识。
 */

export type SourceTier = "T1" | "T1.5" | "T2";

export const SOURCE_TIERS: readonly SourceTier[] = ["T1", "T1.5", "T2"];

export const SOURCE_TIER_LABELS: Record<SourceTier, string> = {
  T1: "官方一手",
  "T1.5": "准官方·机构一手",
  T2: "媒体·智库",
};

/** 排序权重：T1 > T1.5 > T2，数值越大越优先。 */
export const SOURCE_TIER_ORDER: Record<SourceTier, number> = {
  T1: 3,
  "T1.5": 2,
  T2: 1,
};

export function isSourceTier(v: unknown): v is SourceTier {
  return v === "T1" || v === "T1.5" || v === "T2";
}
