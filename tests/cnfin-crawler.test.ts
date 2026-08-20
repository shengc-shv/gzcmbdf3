import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { CnfinCrawler } from "../lib/sources/crawlers/sources/cnfin-web";

/** 构造一个栏目列表页 HTML（含若干 detail 链接 + 1 条重复 + 1 条 footer 噪声链接） */
function fakeColumnHtml(): string {
  return `
    <div class="ui-zxlist-item">
      <div class="zxlist-text-cont">
        <h3><a href="//www.cnfin.com/yw-lb/detail/20260820/4457743_1.html" target="_blank">中国240小时过境免签朋友圈扩展至57国</a></h3>
        <p>摘要一</p>
      </div>
    </div>
    <div class="ui-zxlist-item">
      <h3><a href="//www.cnfin.com/hg-lb/detail/20260819/4457001_1.html">日本连续3个月出现贸易逆差</a></h3>
      <p>摘要二</p>
    </div>
    <!-- 同一文章重复出现（已在上方），应去重 -->
    <a href="//www.cnfin.com/yw-lb/detail/20260820/4457743_1.html">中国240小时过境免签朋友圈扩展至57国（重复）</a>
    <!-- footer 噪声：非 -lb/detail 链接，不应被抓取 -->
    <a href="//www.cnfin.com/publish/main/926">政策法规</a>
    <a href="//www.cnfin.com/d/index.html#b">专业终端</a>
  `;
}

describe("CnfinCrawler", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("解析栏目列表页：提取 detail 链接、推导日期、去重、忽略 footer 噪声", async () => {
    const html = fakeColumnHtml();
    globalThis.fetch = (async (_url: string | URL | Request, _init?: RequestInit) => {
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }) as unknown as typeof fetch;

    const crawler = new CnfinCrawler();
    const result = await crawler.run();

    // 4 个栏目各返回相同 HTML，但同 URL 全局去重 → 不重复计
    // 每条 detail 链接在 4 栏各出现 1 次，去重后应只有 2 条（yw + hg），footer 噪声不计
    const cnfinItems = result.filter((r) => r.sourceId === "cnfin");
    const urls = new Set(cnfinItems.map((r) => r.url ?? ""));
    assert.equal(urls.size, 2, "应去重为 2 条唯一 detail 文章");
    assert.equal(cnfinItems.length, 2, "结果总数为 2（无 footer 噪声、无重复）");

    const yw = cnfinItems.find((r) => (r.url ?? "").includes("4457743"));
    assert.ok(yw, "应含要闻 detail");
    assert.equal(yw?.title, "中国240小时过境免签朋友圈扩展至57国");
    assert.equal(yw?.publishedAt, "2026-08-20", "日期由路径前8位推导");
    assert.equal(yw?.source, "新华财经");

    const hg = cnfinItems.find((r) => (r.url ?? "").includes("4457001"));
    assert.equal(hg?.publishedAt, "2026-08-19");
  });

  it("某栏目抓取失败时不应连坐其他栏目", async () => {
    let calls = 0;
    globalThis.fetch = (async (_url: string | URL | Request, _init?: RequestInit) => {
      calls++;
      // 第一个栏目（要闻）失败，其余成功
      if (calls === 1) {
        return new Response("not found", { status: 404 }) as Response;
      }
      return new Response(fakeColumnHtml(), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }) as unknown as typeof fetch;

    const crawler = new CnfinCrawler();
    const result = await crawler.run();
    const cnfinItems = result.filter((r) => r.sourceId === "cnfin");
    // 要闻栏失败时，其余 3 栏仍能产出 2 条唯一文章
    assert.equal(cnfinItems.length, 2, "单栏失败不应连坐，其余栏正常产出");
  });
});
