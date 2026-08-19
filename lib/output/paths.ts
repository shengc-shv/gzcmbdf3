/**
 * 存储路径常量（M2-⑤ 存储合并）。
 *
 * - PUBLISH_DIR  daily_reports/      gh-pages 发布目录（daily.yml 的
 *   `ls -1d daily_reports/20*/` 还原依赖，双写过渡期不删）
 * - REPORTS_DIR  data/history/reports/  合并后的统一历史报告目录
 * - HISTORY_DIR  data/history/           统一历史记录根（含 index.json）
 */
export const PUBLISH_DIR = "daily_reports";
export const HISTORY_DIR = "data/history";
export const REPORTS_DIR = "data/history/reports";
