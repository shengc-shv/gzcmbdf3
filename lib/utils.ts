/**
 * Resolve the timezone used for date-keyed filenames AND for date strings
 * rendered in HTML. Defaults to the system local timezone — set
 * `REPORT_TZ` (any IANA name, e.g. "America/Los_Angeles", "Europe/Berlin",
 * "Asia/Shanghai", or "UTC") to override.
 *
 * Lazy on purpose: `scripts/daily.ts` loads `.env.local` AFTER its
 * imports execute, so capturing the value at module init would freeze it
 * before dotenv has run. Each call site reads `process.env` fresh.
 */
export function getReportTz(): string | undefined {
  return process.env.REPORT_TZ?.trim() || undefined;
}

export function todayKey(d: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: getReportTz(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d);
}

/**
 * 从 URL 路径提取发布日期（YYYY-MM-DD）。支持 20260820 / 2026-08-20 / 2026/08/20
 * 等常见日期形态；无日期或非法日期返回 undefined（2026-08-20 由 merge.ts 迁入，供
 * dispatch 直抓源与爬虫源统一兜底——sina-money/21jingji 等首页列表无内联日期，但
 * 文章 URL 含日期，可借此补齐 publishedAt）。
 */
export function extractDateFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  const m = url.match(/(\d{4})[-/]?(\d{1,2})[-/]?(\d{1,2})/);
  if (!m) return undefined;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
