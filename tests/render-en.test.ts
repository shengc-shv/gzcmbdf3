/**
 * renderHtml i18n 测试（en locale）。
 *
 * 注意：REPORT_LOCALE 在 registry 模块加载时读取，因此本文件必须**动态 import**
 * render 模块；node --test 对每个测试文件跑独立进程，不会污染其他文件的 locale。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DailyReport } from "../lib/types";

test("renderHtml: en locale 输出 lang=en", async () => {
  process.env.REPORT_LOCALE = "en";
  const { renderHtml } = await import("../lib/output/render");
  const report: DailyReport = {
    date: "",
    hero_line: "",
    must_read: [],
    insights: [],
    sections: { gz_local: [], biz_insight: [], policy_market: [], tech: [], ipo: [] },
  };
  const html = renderHtml(report, "2026-08-19");
  assert.ok(html.includes('lang="en"'), "en locale 应输出 lang=en");
});
