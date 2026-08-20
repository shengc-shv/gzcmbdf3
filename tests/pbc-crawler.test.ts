import { test } from "node:test";
import assert from "node:assert/strict";
import { PbcCrawler } from "../lib/sources/crawlers/sources/pbc-web";

/** 新闻发布 第1页：2 条带 hui12 日期 + 下一页指向 11040-2.html */
const NEWS_PAGE1 = `
<table><tbody><tr>
<td><font class="newslist_style"><a href="/goutongjiaoliu/113456/113469/2026081919184870631/index.html" target="_blank" title="中澳两国央行续签双边本币互换协议">中澳两国央行续签双边本币互换协议</a></font><span class="hui12">2026-08-19</span></td>
</tr><tr>
<td><font class="newslist_style"><a href="/goutongjiaoliu/113456/113469/2026081417014187625/index.html" target="_blank" title="中国人民银行公告﹝2026﹞第21号">中国人民银行公告﹝2026﹞第21号</a></font><span class="hui12">2026-08-14</span></td>
</tr></tbody></table>
<a style="cursor:pointer" onclick="queryArticleByCondition(this,'/goutongjiaoliu/113456/113469/11040-2.html')" class="pagingNormal">下一页</a>
`;

/** 新闻发布 第2页：1 条，无下一页 */
const NEWS_PAGE2 = `
<table><tbody><tr>
<td><font class="newslist_style"><a href="/goutongjiaoliu/113456/113469/2026073110395678929/index.html" target="_blank">2026年第二季度货币政策执行报告解读</a></font><span class="hui12">2026-07-31</span></td>
</tr></tbody></table>
`;

/** 公告信息 第1页：1 条带日期，无下一页 */
const ANNOUNCE_PAGE1 = `
<table><tbody><tr>
<td><font class="newslist_style"><a href="/rmyh/105208/2026072315420899920/index.html" target="_blank">中国人民银行2025年度部门决算</a></font><span class="hui12">2026-07-23</span></td>
</tr></tbody></table>
`;

function installFetchMock(): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    calls.push(url);
    let body: string;
    if (url.includes("/goutongjiaoliu/113456/113469/index.html")) body = NEWS_PAGE1;
    else if (url.includes("11040-2.html")) body = NEWS_PAGE2;
    else if (url.includes("/rmyh/105208/index.html")) body = ANNOUNCE_PAGE1;
    else body = "<html></html>";
    return {
      ok: true,
      status: 200,
      text: async () => body,
    } as Response;
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = orig) };
}

test("PbcCrawler: 解析新闻发布+公告信息列表，跟随分页，产出 sourceId=pbc", async () => {
  const mock = installFetchMock();
  try {
    const results = await new PbcCrawler().run();
    // 新闻发布 2 条 + 第2页 1 条 + 公告信息 1 条 = 4
    assert.equal(results.length, 4);
    for (const r of results) {
      assert.equal(r.sourceId, "pbc");
      assert.equal(r.source, "中国人民银行");
      assert.ok(r.url && r.url.startsWith("https://www.pbc.gov.cn/"));
      assert.ok(r.publishedAt && /^\d{4}-\d{2}-\d{2}$/.test(r.publishedAt!));
    }
    // 日期应来自 hui12
    const swap = results.find((r) => r.title?.includes("互换协议"));
    assert.equal(swap?.publishedAt, "2026-08-19");
    const ann = results.find((r) => r.title?.includes("部门决算"));
    assert.equal(ann?.publishedAt, "2026-07-23");
    // 分页被跟随：新闻发布第2页(11040-2.html)被请求
    assert.ok(mock.calls.some((c) => c.includes("11040-2.html")), "应跟随下一页");
    // 公告信息第1页被请求
    assert.ok(mock.calls.some((c) => c.includes("/rmyh/105208/index.html")));
  } finally {
    mock.restore();
  }
});

test("PbcCrawler: 列表无 hui12 日期时，从文章 ID 时间戳推导日期", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    // 仅新闻发布第1页：一条无 hui12 日期、ID 编码 2026-08-20
    const html = url.includes("/goutongjiaoliu/113456/113469/index.html")
      ? `<a href="/goutongjiaoliu/113456/113469/2026082012000000001/index.html">无日期项</a>`
      : "<html></html>";
    return { ok: true, status: 200, text: async () => html } as Response;
  }) as typeof fetch;
  try {
    const results = await new PbcCrawler().run();
    const it = results.find((r) => r.title === "无日期项");
    assert.ok(it, "应解析出无日期项");
    assert.equal(it!.publishedAt, "2026-08-20", "日期应从 ID 前8位推导");
  } finally {
    globalThis.fetch = orig;
  }
});
