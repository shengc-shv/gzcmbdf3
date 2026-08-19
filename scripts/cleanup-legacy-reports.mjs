#!/usr/bin/env node
/**
 * 双写过渡期到期清理（M2-⑤ 决策③：旧发布目录 daily_reports/ 保留 7 天）。
 *
 * daily.ts 自 M2-⑤ 起双写：daily_reports/{date}/（gh-pages 发布目录）+
 * data/history/reports/{date}/（合并后的统一历史目录）。过渡期结束后，
 * 旧目录不再需要——本脚本保留最近 7 天，删除更早的日期目录。
 *
 * 默认 dry-run（仅列出待删目录），加 --apply 才真正删除。
 *
 * Usage:
 *   npm run cleanup:legacy            # dry-run，列出待删
 *   npm run cleanup:legacy -- --apply  # 真删（保留最近 7 天）
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = "daily_reports";
const KEEP_DAYS = 7;
const APPLY = process.argv.includes("--apply");

function main() {
  if (!fs.existsSync(ROOT)) {
    console.log(`[cleanup-legacy] ${ROOT}/ 不存在，无需清理`);
    return;
  }

  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  const dirs = fs
    .readdirSync(ROOT)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .map((d) => ({ d, t: new Date(`${d}T00:00:00`).getTime() }))
    .filter((x) => !Number.isNaN(x.t))
    .sort((a, b) => a.t - b.t);

  const expired = dirs.filter((x) => x.t < cutoff);
  const keep = dirs.length - expired.length;

  if (expired.length === 0) {
    console.log(
      `[cleanup-legacy] ${ROOT}/ 共 ${dirs.length} 个日期目录，均未超过 ${KEEP_DAYS} 天，无需清理`,
    );
    return;
  }

  console.log(
    `[cleanup-legacy] ${ROOT}/ 共 ${dirs.length} 个日期目录：保留最近 ${keep} 个，待删 ${expired.length} 个：`,
  );
  for (const { d } of expired) {
    console.log(`  - ${d}`);
  }

  if (!APPLY) {
    console.log(
      `[cleanup-legacy] ⚠️ dry-run 模式，未删除任何目录。确认无误后加 --apply 执行：`,
    );
    console.log(`  npm run cleanup:legacy -- --apply`);
    return;
  }

  for (const { d } of expired) {
    fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
    console.log(`  ✂️ 已删除 ${d}/`);
  }
  console.log(
    `[cleanup-legacy] 完成：删除 ${expired.length} 个过期目录，保留最近 ${KEEP_DAYS} 天（${keep} 个）`,
  );
}

main();
