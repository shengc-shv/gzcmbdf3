import fs from "node:fs";
import path from "node:path";

/**
 * 存储路径常量（M2-⑤ 存储合并）。
 *
 * - PUBLISH_DIR  daily_reports/      gh-pages 发布目录（daily.yml 的
 *   ls -1d daily_reports/20* 还原依赖，双写过渡期不删）
 * - REPORTS_DIR  data/history/reports/  合并后的统一历史报告目录
 * - HISTORY_DIR  data/history/           统一历史记录根（含 index.json）
 */
export const PUBLISH_DIR = "daily_reports";
export const HISTORY_DIR = "data/history";
export const REPORTS_DIR = "data/history/reports";

/**
 * 解析某日期的报告目录（读路径，双写过渡期兼容）：
 * 优先合并后的统一历史目录 data/history/reports/{date}，
 * 不存在则回退旧发布目录 daily_reports/{date}。
 * 供 regen 系列与 render 等辅助脚本安全读写（与 build-site/deploy/open 一致）。
 */
export function resolveDateDir(date: string): string {
  const newer = path.join(REPORTS_DIR, date);
  return fs.existsSync(newer) ? newer : path.join(PUBLISH_DIR, date);
}
