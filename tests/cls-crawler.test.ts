import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ClsCrawler } from "../lib/sources/crawlers/sources/cls-api";

/** 伪造首屏 assemble 响应（含 depth_list）与分页 list 响应 */
function fakeResponses() {
  const first = JSON.stringify({
    errno: 0,
    data: {
      depth_list: [
        { id: 2459142, title: "当索罗斯门徒铁了心稳美债", brief: "摘要一", ctime: 1787194723 },
        { id: 2458956, title: "8月LPR报价出炉：5年期和1年期利率均维持不变", brief: "摘要二", ctime: 1787187752 },
      ],
    },
  });
  const paged = JSON.stringify({
    errno: 0,
    data: [
      { id: 2456857, title: "G10长债全崩了", brief: "摘要三", ctime: 1787031768 },
      // 重复 id，应去重
      { id: 2458956, title: "LPR重复", brief: "", ctime: 1787187752 },
    ],
  });
  return { first, paged };
}

describe("ClsCrawler", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("解析首屏+分页：提取 id/title/brief、ctime 转日期、URL、去重", async () => {
    const { first, paged } = fakeResponses();
    let calls = 0;
    globalThis.fetch = (async (_url: string | URL | Request, _init?: RequestInit) => {
      calls++;
      const url = String(_url);
      const body = url.includes("/depth/list/") ? paged : first;
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const crawler = new ClsCrawler();
    const result = await crawler.run();
    const items = result.filter((r) => r.sourceId === "cls");

    // 首屏 2 + 分页新增 1（重复去重） = 3
    assert.equal(items.length, 3, "应得 3 条唯一文章（分页重复 id 去重）");
    assert.equal(calls, 2, "应调用首屏 + 1 次分页");

    const a = items.find((r) => (r.url ?? "").includes("2459142"));
    assert.ok(a);
    assert.equal(a?.title, "当索罗斯门徒铁了心稳美债");
    assert.equal(a?.excerpt, "摘要一");
    assert.equal(a?.url, "https://www.cls.cn/detail/2459142");
    assert.equal(a?.publishedAt, "2026-08-20", "ctime=1787194723 → 北京 2026-08-20");
    assert.equal(a?.source, "财联社");

    const dup = items.filter((r) => (r.url ?? "").includes("2458956"));
    assert.equal(dup.length, 1, "分页中的重复 id 应被去重");
  });

  it("接口返回 errno 错误时返回 0 条不抛异常", async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ errno: "10012", msg: "签名错误" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const crawler = new ClsCrawler();
    const result = await crawler.run();
    assert.equal(result.length, 0);
  });
});
