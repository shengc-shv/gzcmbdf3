import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { SinaBankCrawler } from "../lib/sources/crawlers/sources/sina-bank-web";

function fakeHtml(): string {
  return `
    <ul class="list01">
      <li><a target="_blank" href="https://finance.sina.com.cn/jinrong/yh/2026-08-20/doc-ininxkrs8080324.shtml">净息差四年来首度环比增长 银行业盈利模式亟待重构</a></li>
      <li><a target="_blank" href="https://finance.sina.com.cn/money/bank/bank_hydt/2026-08-19/doc-ininwawh8324203.shtml">同日获批！贵州三地27家农村中小金融机构解散</a></li>
      <!-- 重复文章，应去重 -->
      <li><a href="https://finance.sina.com.cn/jinrong/yh/2026-08-20/doc-ininxkrs8080324.shtml">重复标题</a></li>
      <!-- 导航/专题链接，不应被抓取（非 doc-xxx.shtml 或路径无日期） -->
      <li><a href="https://finance.sina.com.cn/column/bank/">银行专栏</a></li>
      <li><a href="https://finance.sina.com.cn/bond/">债市</a></li>
      <li><a href="https://finance.sina.com.cn/calc/money_call_deposit.html">存款计算器</a></li>
      <!-- 数据点「详细」链接，标题非完整文章标题，应被过滤 -->
      <dd>2025年，六大行实现归母净利润1.42万亿元<a href="https://finance.sina.com.cn/jinrong/yh/2026-03-30/doc-inhsuqus9576183.shtml">【详细】</a></dd>
    </ul>
  `;
}

describe("SinaBankCrawler", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("解析列表页：提取 doc 文章、路径推导日期、去重、忽略导航链接", async () => {
    globalThis.fetch = (async () => {
      return new Response(fakeHtml(), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }) as unknown as typeof fetch;

    const crawler = new SinaBankCrawler();
    const result = await crawler.run();
    const items = result.filter((r) => r.sourceId === "sina-bank");

    assert.equal(items.length, 2, "应提取 2 条唯一 doc 文章");
    const urls = new Set(items.map((r) => r.url));
    assert.equal(urls.size, 2);

    const a = items.find((r) => (r.url ?? "").includes("doc-ininxkrs"));
    assert.ok(a, "应含首条文章");
    assert.equal(a?.title, "净息差四年来首度环比增长 银行业盈利模式亟待重构");
    assert.equal(a?.publishedAt, "2026-08-20", "日期由路径推导");
    assert.equal(a?.source, "新浪财经·银行频道");
    assert.equal(a?.url, "https://finance.sina.com.cn/jinrong/yh/2026-08-20/doc-ininxkrs8080324.shtml");

    const b = items.find((r) => (r.url ?? "").includes("doc-ininwawh"));
    assert.equal(b?.publishedAt, "2026-08-19");
  });

  it("列表页抓取失败时返回 0 条不抛异常", async () => {
    globalThis.fetch = (async () => {
      return new Response("forbidden", { status: 403 }) as Response;
    }) as unknown as typeof fetch;

    const crawler = new SinaBankCrawler();
    const result = await crawler.run();
    assert.equal(result.length, 0, "失败应返回空而非抛错");
  });
});
