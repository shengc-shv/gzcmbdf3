/**
 * renderHtml i18n 测试（en locale）。
 *
 * 注意：REPORT_LOCALE 在 registry 模块加载时读取，因此本文件必须**动态 import**
 * render 模块；node --test 对每个测试文件跑独立进程，不会污染其他文件的 locale。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { RawByCategory } from "../lib/output/render";
import type { DailyReport } from "../lib/types";

test("renderHtml: en locale 输出 lang=en", async () => {
  process.env.REPORT_LOCALE = "en";
  const { renderHtml } = await import("../lib/output/render");
  const raw: RawByCategory = {
    tech: [],
    finance: [],
    politics: [],
    "gd-ipo": [],
    ipo: [],
    gz: [],
  };
  const report: DailyReport = {
    hero_headline: "",
    daily_overview: "",
    tech_briefs: [],
    finance_briefs: [],
    politics_briefs: [],
    gd_ipo_briefs: [],
    editor_note: "",
    keywords: [],
  };
  const html = renderHtml(report, raw, "2026-08-19");
  assert.ok(html.includes('lang="en"'), "en locale 应输出 lang=en");
});
