/**
 * RSS 源级关键词过滤（lib/sources/rss.ts 的 filterByKeywords，2026-08-20）。
 * 场景：arXiv 金融科技流（q-fin/cs.AI/cs.LG）按 banking / financial services /
 * credit risk / compliance 过滤，只保留金融科技相关论文。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { filterByKeywords } from "../lib/sources/rss";
import type { RawArticle } from "../lib/sources/types";

const art = (title: string, excerpt = ""): RawArticle => ({
  sourceId: "arxiv-fintech",
  title,
  url: "https://arxiv.org/abs/2608.00001",
  excerpt,
  category: "tech",
});

const KEYWORDS = ["banking", "financial services", "credit risk", "compliance"];

test("无 keywords：原样返回，不过滤", () => {
  const items = [art("A New LLM Architecture"), art("Quantum Computing Survey")];
  assert.deepEqual(filterByKeywords(items, undefined), items);
  assert.deepEqual(filterByKeywords(items, []), items);
});

test("title 命中任一关键词即保留（大小写不敏感）", () => {
  const items = [
    art("Deep Learning for Credit Risk Assessment"),
    art("A Survey of Quantum Error Correction"),
  ];
  const kept = filterByKeywords(items, KEYWORDS);
  assert.equal(kept.length, 1);
  assert.ok(kept[0].title.includes("Credit Risk"));
});

test("excerpt 命中关键词也保留（title 未命中时）", () => {
  const items = [
    art("Transformer Advances in 2026", "We study applications in banking and financial services."),
    art("Neural Scaling Laws", "No finance-related content here."),
  ];
  const kept = filterByKeywords(items, KEYWORDS);
  assert.equal(kept.length, 1);
  assert.ok(kept[0].title.includes("Transformer"));
});

test("多关键词：命中任意一个即可（financial services 多词短语）", () => {
  const items = [
    art("Regulatory Technology", "A framework for compliance automation in banks."),
    art("Graph Models for Social Networks", "Unrelated abstract."),
    art("Liquidity Modeling", "Quantitative approaches in financial services."),
  ];
  const kept = filterByKeywords(items, KEYWORDS);
  assert.equal(kept.length, 2);
  const titles = kept.map((k) => k.title);
  assert.ok(titles.includes("Regulatory Technology"));
  assert.ok(titles.includes("Liquidity Modeling"));
});

test("全部未命中 → 空列表", () => {
  const items = [
    art("Image Generation Benchmarks"),
    art("Formal Verification of Compilers"),
  ];
  assert.deepEqual(filterByKeywords(items, KEYWORDS), []);
});
