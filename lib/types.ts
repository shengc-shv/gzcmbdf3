/**
 * 共享领域类型（M3-B 迁移自已删除的 lib/ai/pipeline.ts 的类型部分）。
 *
 * pipeline.ts 的运行时实现（generateDailyReport / selectRoundRobin / callOnce）
 * 已确认全仓无调用（daily.ts 注释「已移除以省钱」），整文件删除；4 个被
 * daily/history/render 等依赖的类型保留于此。
 */
import type { RawArticle } from "./sources/types";
import type { TickerAnalysis } from "./trading/signals";
import type { CryptoGlobalStats } from "./trading/coingecko";
import type { FearGreedSnapshot } from "./trading/fear-greed";
import type { TradingCommentary, WatchlistPick } from "./ai/trading-commentary";

export interface BriefItem {
  title: string;
  url: string;
  source: string;
  summary: string;
  importance: number;
}

export interface DailyReport {
  hero_headline: string;
  daily_overview: string;
  tech_briefs: BriefItem[];
  finance_briefs: BriefItem[];
  politics_briefs: BriefItem[];
  gd_ipo_briefs: BriefItem[]; // 广东地区 IPO
  editor_note: string;
  keywords: string[];
  /** Optional trading-signals section, present when scripts/daily.ts ran successfully. */
  trading?: TradingSection;
  /** Optional executive summary (今日必读 + 商机提示), present when LLM call succeeded. */
  executive_summary?: import("./ai/executive-summary").ExecutiveSummary;
}

export interface TradingSection {
  // SKIP_AI / LLM 失败恢复路径下以下字段可能缺失 → 全部可选
  market_overview?: string;
  watchlist?: WatchlistPick[];
  risk_caveat?: string;
  generated_at: string;
  tickers: TickerAnalysis[];
  crypto_fear_greed?: FearGreedSnapshot;
  crypto_global?: CryptoGlobalStats;
}

export interface ArticleInput extends RawArticle {
  source: string;
}
