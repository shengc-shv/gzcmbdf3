import { test } from "node:test";
import assert from "node:assert/strict";
import { NfraCrawler } from "../lib/sources/crawlers/sources/nfra-api";

/** 构造一个最小菜单树：4 个目标栏目各带 2 个叶子 itemUUid */
function mockMenu(): unknown {
  const leaf = (id: number, uuid: string) => ({
    itemName: `L${id}`,
    itemId: id,
    itemUUid: uuid,
    subItemslist: null,
  });
  return {
    rptCode: 200,
    msg: "成功",
    data: [
      { itemName: "政策法规", itemId: 926, subItemslist: [leaf(927, "91030301"), leaf(928, "91030302")] },
      { itemName: "行政处罚", itemId: 931, subItemslist: [leaf(4113, "91030501"), leaf(4293, "91030502")] },
      { itemName: "政策解读", itemId: 916, subItemslist: [leaf(917, "91020201")] },
      { itemName: "公告通知", itemId: 925, subItemslist: [leaf(950, "91030201")] },
    ],
  };
}

function mockDocs(): unknown {
  return {
    rptCode: 200,
    msg: "成功",
    data: [
      {
        docId: 111,
        docTitle: "关于健全金融机构治理的实施意见",
        docSubtitle: "金融监管总局 人民银行 证监会 财政部",
        docSummary: null,
        publishDate: "2026-08-10 16:00:00",
        itemId: 928,
      },
      {
        docId: 222,
        docTitle: "泉州金融监管分局行政处罚信息公示表",
        publishDate: "2026-08-19 17:00:00",
        itemId: 4113,
      },
    ],
  };
}

function installFetchMock() {
  const calls: string[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    calls.push(url);
    let body: unknown;
    if (url.includes("getWebMenuItem")) body = mockMenu();
    else if (url.includes("SelectDocByItemUUIdsAndChild")) body = mockDocs();
    else body = { rptCode: 501, msg: "参数错误", data: null };
    return {
      ok: true,
      status: 200,
      json: async () => body,
    } as Response;
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = orig) };
}

test("NfraCrawler: 菜单+文档接口解析出 sourceId=nfra 的政策/处罚文档", async () => {
  const mock = installFetchMock();
  try {
    const crawler = new NfraCrawler();
    const results = await crawler.run();
    // 去重后应拿到 2 条（mockDocs 返回 2 个 docId）
    assert.equal(results.length, 2);
    for (const r of results) {
      assert.equal(r.sourceId, "nfra");
      assert.equal(r.source, "国家金融监督管理总局");
      assert.ok(r.url && r.url.startsWith("https://www.nfra.gov.cn/cn/view/pages/ItemDetail.html?docId="));
      assert.ok(r.publishedAt && /^\d{4}-\d{2}-\d{2}$/.test(r.publishedAt));
    }
    // 行政处罚文档应保留标题
    const penalty = results.find((r) => r.title?.includes("行政处罚"));
    assert.ok(penalty, "应包含行政处罚文档");
    // 菜单接口被调用一次、文档接口被调用（叶子分批）
    assert.ok(mock.calls.some((c) => c.includes("getWebMenuItem")));
    assert.ok(mock.calls.some((c) => c.includes("SelectDocByItemUUIdsAndChild")));
  } finally {
    mock.restore();
  }
});

test("NfraCrawler: 菜单解析失败时回退硬编码叶子仍可出文档", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    const body = url.includes("getWebMenuItem")
      ? { rptCode: 200, msg: "成功", data: [] } // 空菜单 → 触发兜底
      : mockDocs();
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as typeof fetch;
  try {
    const crawler = new NfraCrawler();
    const results = await crawler.run();
    assert.equal(results.length, 2, "兜底叶子应仍拉到 2 条文档");
    assert.ok(results.every((r) => r.sourceId === "nfra"));
  } finally {
    globalThis.fetch = orig;
  }
});
