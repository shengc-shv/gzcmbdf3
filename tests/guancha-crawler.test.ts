import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GuanchaCrawler } from "../lib/sources/crawlers/sources/guancha-web";

function fakeHtml(): string {
  return `
    <li>
      <a href="/GuanJinRong/2026_08_19_827900.shtml" target="_blank">
        <div class="t36-column-list2-left"><h1>上海银行获批收购上银国际100%股权</h1></div>
      </a>
    </li>
    <li>
      <a href="/GuanJinRong/2026_08_18_827754.shtml">
        <div class="t36-column-list2-left"><h1>汇丰启动存量排查，内地投资客户面临合规限制</h1></div>
      </a>
    </li>
    <!-- 重复文章，应去重 -->
    <a href="/GuanJinRong/2026_08_19_827900.shtml"><h1>上海银行重复</h1></a>
    <!-- 非金融栏目链接，不应被抓取 -->
    <a href="/politics/2026_04_28_815265.shtml">政治局会议讨论经济工作</a>
    <a href="/wudawenzhang">五大文章</a>
  `;
}

describe("GuanchaCrawler", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("解析列表页：提取金融文章、链接日期、h1 标题、去重、过滤其他栏目", async () => {
    globalThis.fetch = (async () => {
      return new Response(fakeHtml(), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }) as unknown as typeof fetch;

    const crawler = new GuanchaCrawler();
    const result = await crawler.run();
    const items = result.filter((r) => r.sourceId === "guancha");

    assert.equal(items.length, 2, "应提取 2 条唯一金融文章（重复去重、过滤 politics）");
    const urls = new Set(items.map((r) => r.url));
    assert.equal(urls.size, 2);

    const a = items.find((r) => (r.url ?? "").includes("827900"));
    assert.ok(a);
    assert.equal(a?.title, "上海银行获批收购上银国际100%股权");
    assert.equal(a?.publishedAt, "2026-08-19", "日期由链接推导");
    assert.equal(a?.url, "https://www.guancha.cn/GuanJinRong/2026_08_19_827900.shtml");
    assert.equal(a?.source, "观察者网·金融");

    const b = items.find((r) => (r.url ?? "").includes("827754"));
    assert.equal(b?.publishedAt, "2026-08-18");
  });

  it("列表页抓取失败时返回 0 条不抛异常", async () => {
    globalThis.fetch = (async () => {
      return new Response("forbidden", { status: 403 }) as Response;
    }) as unknown as typeof fetch;

    const crawler = new GuanchaCrawler();
    const result = await crawler.run();
    assert.equal(result.length, 0, "失败应返回空而非抛错");
  });
});
