/**
 * 关键词漏斗类型契约（M1）。
 *
 * 对应 sources.keywords.json（银行零售业务关键词体系 v4）的结构 + 过滤结果类型。
 * 本文件只做类型定义，不做实现。
 */
import type { SourceTier } from "../sources/tiers";

/** 单个业务维度规则（dimensions.*）。 */
export interface DimensionRule {
  label?: string;
  tier?: string; // "core" | "opportunity" 等，语义由配置定义
  weekly?: boolean; // true = 命中进周报池，不混入日报
  strong_keywords?: string[];
  weak_keywords?: string[];
  /** weak 关键词 → 必须共现的词（弱词仅凭自身不足命中）。 */
  cooccurrence_for_weak?: Record<string, string[]>;
  /** 命中即强制剔除该维度。 */
  exclude?: string[];
  note?: string;
}

/** 商机追踪器（opportunity_tracker.*）。 */
export interface OpportunityTracker {
  label?: string;
  priority?: "S" | "A" | "B";
  strong_triggers?: string[];
  triggers?: string[];
  /** 命中要求地域命中（geo tier1 词出现在文本中）。 */
  geo_lock?: boolean;
  geo_required?: boolean;
  /** 标题出现任一城市名则跳过该追踪器。 */
  exclude_if_in_title?: string[];
  action?: string;
  fields?: string[];
}

/** sources.keywords.json 顶层结构。 */
export interface KeywordConfig {
  version?: number;
  note?: string;
  meta?: {
    markets?: string[];
    organization?: string;
    daily_flow_target?: string;
    opportunity_target?: string;
  };
  global_exclude?: Record<string, string[]>;
  geo_filter?: {
    tier1_exact?: string[];
    tier2_risky?: string[];
    weight?: { tier1_hit?: number; tier2_only?: number };
  };
  dimensions?: Record<string, DimensionRule>;
  opportunity_tracker?: Record<string, OpportunityTracker>;
  filter_rules?: {
    matching_mode?: string;
    multi_dimension?: { enabled?: boolean; strategy?: string };
    deduplication?: { enabled?: boolean; rule?: string; threshold?: number; max_per_theme?: number };
    bucket_allocation?: Record<string, unknown>;
  };
  ml_enhancement?: Record<string, unknown>;
  changelog?: string[];
}

/** 漏斗输入：一条待判文章（来自归一化层，只读）。 */
export interface RawArticleInput {
  title: string;
  /** 正文/摘要（excerpt），weak 共现与商机匹配会用到。 */
  content?: string;
  sourceId: string;
  url?: string;
  /** 归一化 region 分流结果（gz / gd / …），当前过滤以文本地域判定为准，此字段仅透传。 */
  region?: string;
  /**
   * 文章分类（归一化层 category）。参考区（tech / ipo / gd-ipo / politics）
   * 不参与银行零售维度过滤（参考区是展示窗口，有独立 AI enrich），
   * 仅扫描商机追踪器；finance / gz 走完整漏斗。
   */
  category?: string;
  /** 源等级（T6 透传），供 bucket_allocation 分池参考。 */
  tier?: SourceTier;
}

export type FilterBucket = "daily" | "opportunity" | "weekly" | "dropped";

export interface FilterResult {
  /** 硬过滤：false 即丢弃，不进任何 AI 调用。 */
  pass: boolean;
  /** 综合权重分（geo + 维度 + 商机加分），供排序/复审参考。 */
  score: number;
  /** 命中的维度 key 列表（多维度，multi_dimension: all_hit）。 */
  dimensions: string[];
  /**
   * 命中的商机追踪器列表（多值：一条信息可进多个商机池）。
   * 按优先级 S > A > B 排序；无命中时为 undefined。
   */
  opportunities?: Array<{
    tracker: string;
    priority: "S" | "A" | "B";
    label: string;
    fields: string[];
    action: string;
  }>;
  /** 命中的关键词/触发词（用于调试与测试断言）。 */
  matched: string[];
  bucket: FilterBucket;
}
