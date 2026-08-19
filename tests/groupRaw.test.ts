/**
 * groupRaw 多归桶测试（多标签）：一条信息命中多个业务线标签 → 进多个子组。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupRaw } from "../lib/output/render";
import { loadAllSources } from "../lib/sources/registry";
import type { ArticleInput } from "../lib/types";

const registry = loadAllSources();

test("groupRaw: subcategories 多值 → 同一 URL 进多个业务线子组", () => {
  const url = "https://x/multi";
  const articles: ArticleInput[] = [
    {
      sourceId: "gz-gov",
      source: "广州政府",
      title: "广州多项金融政策落地影响多个业务线",
      url,
      excerpt: "",
      category: "finance",
      subcategories: ["gz-policy", "cn-policy"], // AI 多标签：同时影响广州政策 + 国家级政策
      publishedAt: new Date("2026-08-19T08:00:00Z"),
      fetchedToday: true,
    },
  ];
  const raw = groupRaw(articles, registry);
  const finance = raw.finance;
  const gzPolicy = finance.find((s) => s.id === "gz-policy");
  const cnPolicy = finance.find((s) => s.id === "cn-policy");
  assert.ok(gzPolicy, "应构建 gz-policy 子组");
  assert.ok(cnPolicy, "应构建 cn-policy 子组");
  const inGz = gzPolicy!.sources.some((src) => src.items.some((a) => a.url === url));
  const inCn = cnPolicy!.sources.some((src) => src.items.some((a) => a.url === url));
  assert.ok(inGz, "条目应出现在 gz-policy 组（多归桶）");
  assert.ok(inCn, "条目应出现在 cn-policy 组（多归桶）");
});

test("groupRaw: 无 AI 标签时回退注册表源级 subcategory（单桶）", () => {
  const url = "https://x/single";
  const articles: ArticleInput[] = [
    {
      sourceId: "gz-gov",
      source: "广州政府",
      title: "广州政策文件",
      url,
      excerpt: "",
      category: "finance",
      publishedAt: new Date("2026-08-19T08:00:00Z"),
      fetchedToday: true,
    },
  ];
  const raw = groupRaw(articles, registry);
  const gzPolicy = raw.finance.find((s) => s.id === "gz-policy");
  assert.ok(gzPolicy, "gz-gov 源按注册表归 gz-policy 组");
  const inGz = gzPolicy!.sources.some((src) => src.items.some((a) => a.url === url));
  assert.ok(inGz);
});

// —— 上位法传导（「包含关系」）：finance（宏观政策）板块的全国/省政策 → 广州商机板块镜像 ——
function findSub(raw: ReturnType<typeof groupRaw>, cat: "gz" | "finance", subId: string) {
  return raw[cat].find((s) => s.id === subId);
}

test("groupRaw: 全国公积金政策（finance/cn-policy）传导镜像到 广州商机·个人信贷", () => {
  const url = "https://x/gjj";
  const articles: ArticleInput[] = [
    {
      sourceId: "govcn-policy",
      source: "中国政府网",
      title: "国务院关于修改《住房公积金管理条例》的决定",
      url,
      excerpt: "",
      category: "finance",
      subcategory: "cn-policy",
      publishedAt: new Date("2026-08-19T08:00:00Z"),
      fetchedToday: true,
    },
  ];
  const raw = groupRaw(articles, registry);
  // 宏观政策板块原样保留（国家政策）
  const cnPolicy = findSub(raw, "finance", "cn-policy");
  assert.ok(cnPolicy, "finance 板块应保留 cn-policy 子组");
  assert.ok(
    cnPolicy!.sources.some((src) => src.items.some((a) => a.url === url)),
    "宏观板块应保留原条目",
  );
  // 广州商机板块传导一条（个人信贷）
  const gzCredit = findSub(raw, "gz", "gz-credit");
  assert.ok(gzCredit, "gz 板块应构建 gz-credit 子组");
  const mirrored = gzCredit!.sources.flatMap((s) => s.items).filter((a) => a.url === url);
  assert.equal(mirrored.length, 1, "广州商机·个人信贷应恰好出现 1 条传导条目");
  assert.equal(mirrored[0]!.category, "gz", "镜像条目 category 应覆盖为 gz");
  assert.deepEqual(mirrored[0]!.subcategories, ["gz-credit"]);
});

test("groupRaw: 上位政策命中多个业务线 → 广州商机多子标签传导", () => {
  const url = "https://x/multi-line";
  const articles: ArticleInput[] = [
    {
      sourceId: "govcn-policy",
      source: "中国政府网",
      title: "国务院出台新政：公积金贷款与住房消费促进措施",
      url,
      excerpt: "",
      category: "finance",
      subcategory: "cn-policy",
      publishedAt: new Date("2026-08-19T08:00:00Z"),
      fetchedToday: true,
    },
  ];
  const raw = groupRaw(articles, registry);
  const gzCredit = findSub(raw, "gz", "gz-credit");
  const gzCustomer = findSub(raw, "gz", "gz-customer");
  assert.ok(gzCredit && gzCustomer, "应构建 gz-credit/gz-customer 子组");
  const inCredit = gzCredit!.sources.some((src) => src.items.some((a) => a.url === url));
  const inCustomer = gzCustomer!.sources.some((src) => src.items.some((a) => a.url === url));
  assert.ok(inCredit, "公积金贷款 → gz-credit");
  assert.ok(inCustomer, "住房消费 → gz-customer");
});

test("groupRaw: 与广州业务线无关的 finance 条目不传导", () => {
  const url = "https://x/forest";
  const articles: ArticleInput[] = [
    {
      sourceId: "govcn-policy",
      source: "中国政府网",
      title: "国务院批复森林年采伐限额",
      url,
      excerpt: "",
      category: "finance",
      subcategory: "cn-policy",
      publishedAt: new Date("2026-08-19T08:00:00Z"),
      fetchedToday: true,
    },
  ];
  const raw = groupRaw(articles, registry);
  const gzAny = raw.gz.some((sub) => sub.sources.some((src) => src.items.some((a) => a.url === url)));
  assert.ok(!gzAny, "无关政策不应出现在广州商机板块");
});

test("groupRaw: relevant=false 的 finance 条目不传导也不进宏观面板", () => {
  const url = "https://x/noise";
  const articles: ArticleInput[] = [
    {
      sourceId: "govcn-policy",
      source: "中国政府网",
      title: "国务院关于历史文化名城保护的决定",
      url,
      excerpt: "",
      category: "finance",
      subcategory: "cn-policy",
      relevant: false,
      publishedAt: new Date("2026-08-19T08:00:00Z"),
      fetchedToday: true,
    },
  ];
  const raw = groupRaw(articles, registry);
  const inFinance = raw.finance.some((sub) => sub.sources.some((src) => src.items.some((a) => a.url === url)));
  const inGz = raw.gz.some((sub) => sub.sources.some((src) => src.items.some((a) => a.url === url)));
  assert.ok(!inFinance, "relevant=false 不进宏观面板");
  assert.ok(!inGz, "relevant=false 不传导到广州商机");
});
