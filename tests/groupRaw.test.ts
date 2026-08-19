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
