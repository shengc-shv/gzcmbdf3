import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { StcnCrawler } from "../lib/sources/crawlers/sources/stcn-web";

/** 构造一个栏目列表页 HTML（含若干 tt 列表项 + 1 条重复 + 1 条 footer 噪声链接） */
function fakeColumnHtml(): string {
  return `
    <ul class="list infinite-list" data-url="/article/list.html?type=xw">
      <li class="">
        <div class="content">
          <div class="tt">
            <a href="/article/detail/4090000.html" target="_blank">
              “一船货浮亏数千万元曾是常态”！锂电企业如何破局？
            </a>
          </div>
          <div class="text ellipsis-2"><a href="/article/detail/4090000.html" target="_blank">摘要一</a></div>
        </div>
      </li>
      <li class="">
        <div class="content">
          <div class="tt">
            <a href="/article/detail/4090281.html">超42万手买单封涨停！14天8板！</a>
          </div>
        </div>
      </li>
      <!-- 同一文章重复出现（已在上方），应去重 -->
      <div class="tt"><a href="/article/detail/4090000.html">锂电企业如何破局（重复）</a></div>
      <!-- footer 噪声：非 /article/detail 链接，不应被抓取 -->
      <a href="/article/list/zt.html">专题</a>
      <a href="/quotes/index/sh000001.html">上证指数</a>
    </ul>
  `;
}

describe("StcnCrawler", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("解析列表页：提取 detail 链接、去重、忽略 footer 噪声、日期为抓取当天", async () => {
    const html = fakeColumnHtml();
    globalThis.fetch = (async (_url: string | URL | Request, _init?: RequestInit) => {
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }) as unknown as typeof fetch;

    const crawler = new StcnCrawler();
    const result = await crawler.run();

    // 3 个栏目各返回相同 HTML，但同 URL 全局去重 → 应只有 2 条唯一 detail 文章
    const stcnItems = result.filter((r) => r.sourceId === "stcn");
    const urls = new Set(stcnItems.map((r) => r.url ?? ""));
    assert.equal(urls.size, 2, "应去重为 2 条唯一 detail 文章");
    assert.equal(stcnItems.length, 2, "结果总数为 2（无 footer 噪声、无重复）");

    const item1 = stcnItems.find((r) => (r.url ?? "").includes("4090000"));
    assert.ok(item1, "应含 4090000 文章");
    assert.ok(
      item1?.title?.includes("锂电企业如何破局"),
      "标题应去掉空白与嵌套标签",
    );
    assert.equal(item1?.url, "https://www.stcn.com/article/detail/4090000.html");
    assert.equal(item1?.source, "证券时报");
    // 日期为北京当天（列表页无日期字段，用抓取日近似）
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    assert.equal(item1?.publishedAt, today);

    const item2 = stcnItems.find((r) => (r.url ?? "").includes("4090281"));
    assert.ok(item2, "应含 4090281 文章");
  });

  it("某栏目抓取失败时不应连坐其他栏目", async () => {
    let calls = 0;
    globalThis.fetch = (async (_url: string | URL | Request, _init?: RequestInit) => {
      calls++;
      // 第一个栏目（新闻）失败，其余成功
      if (calls === 1) {
        return new Response("not found", { status: 404 }) as Response;
      }
      return new Response(fakeColumnHtml(), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }) as unknown as typeof fetch;

    const crawler = new StcnCrawler();
    const result = await crawler.run();
    const stcnItems = result.filter((r) => r.sourceId === "stcn");
    // 新闻栏失败时，其余 2 栏仍能产出 2 条唯一文章
    assert.equal(stcnItems.length, 2, "单栏失败不应连坐，其余栏正常产出");
  });
});
