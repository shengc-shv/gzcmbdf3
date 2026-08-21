/**
 * fetchNbd（每日经济新闻首页）解析测试。
 * 验证（2026-08-21 接入）：
 *  - 从首页 HTML 提取 articles/YYYY-MM-DD/<id>.html 链接
 *  - 日期从 URL 路径推导（publishedAt 正确）
 *  - 去重、跳过空/占位标题、limit 截断
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNbdHtml } from "../lib/sources/domestic-finance";

const fakeHtml = `
<!DOCTYPE html><html><body>
  <a href="https://www.nbd.com.cn/articles/2026-08-21/4550150.html">银监法修订草案即将二审！全国人大常委会法工委回应每经</a>
  <a href="https://www.nbd.com.cn/articles/2026-08-21/4549968.html">每经热评 | 美国财政部干预美债"一日游"</a>
  <!-- 重复链接，应去重 -->
  <a href="https://www.nbd.com.cn/articles/2026-08-21/4550150.html">重复标题</a>
  <!-- 占位标题（<8 字），应跳过 -->
  <a href="https://www.nbd.com.cn/articles/2026-08-20/4549000.html">查看更多</a>
  <!-- 非 articles 链接，应忽略 -->
  <a href="https://www.nbd.com.cn/channels/25.html">金融频道</a>
  <!-- 更早日期，验证日期推导 -->
  <a href="https://www.nbd.com.cn/articles/2026-08-12/4540132.html">但斌二季度美股持仓大换血：狂扫7只AI硬件股</a>
</body></html>
`;

test("parseNbdHtml: 提取 articles 链接、推导日期、去重、跳过占位", () => {
  const items = parseNbdHtml(fakeHtml, "nbd", 20);
  assert.equal(items.length, 3, "应提取 3 条唯一文章（重复+占位+频道链接被滤）");
  assert.ok(items.every((it) => it.sourceId === "nbd"));
  assert.ok(items.every((it) => it.category === "finance"));

  const a = items.find((it) => it.url.includes("4550150"));
  assert.ok(a, "应含首条文章");
  assert.equal(a?.title, "银监法修订草案即将二审！全国人大常委会法工委回应每经");
  assert.equal(a?.publishedAt?.toISOString().slice(0, 10), "2026-08-21");

  const old = items.find((it) => it.url.includes("4540132"));
  assert.ok(old, "应含更早日期文章");
  assert.equal(old?.publishedAt?.toISOString().slice(0, 10), "2026-08-12");
});

test("parseNbdHtml: limit 截断", () => {
  const html = Array.from(
    { length: 5 },
    (_, i) =>
      `<a href="https://www.nbd.com.cn/articles/2026-08-21/4550${i}00.html">测试文章标题第${i}条足够长</a>`,
  ).join("");
  const items = parseNbdHtml(html, "nbd", 3);
  assert.equal(items.length, 3);
});

test("parseNbdHtml: 空 HTML 返回空数组（不抛异常）", () => {
  assert.deepEqual(parseNbdHtml("<html><body></body></html>", "nbd"), []);
});
