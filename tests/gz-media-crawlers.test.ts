/**
 * 广州本地媒体爬虫解析测试（2026-08-21 第一梯队接入）。
 * 覆盖：大洋网广州 / 南方经济 / 中新网广东 / 央广网广东。
 * 验证：URL 形态匹配、日期推导、去重由 run 层负责、标题清理、忽略导航/栏目链接。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDayooGzHtml } from "../lib/sources/crawlers/sources/dayoo-gz";
import { parseSouthcnEconomyHtml } from "../lib/sources/crawlers/sources/southcn-economy";
import { parseChinanewsGdHtml } from "../lib/sources/crawlers/sources/chinanews-gd";
import { parseCnrGdHtml } from "../lib/sources/crawlers/sources/cnr-gd";

test("dayoo: 提取文章+日期，忽略导航，丢弃无效日期", () => {
  const html = `
  <a href="https://news.dayoo.com/guangzhou/202608/21/139995_54993415.htm" target="_blank">琶洲算法大赛上线</a>
  <a href="https://news.dayoo.com/guangzhou/202608/20/139995_54993001.htm">海珠区数字经济新进展</a>
  <a href="https://news.dayoo.com/guangzhou/140271.shtml">广州栏目导航</a>
  <a href="https://news.dayoo.com/china/202108/12/139997_54017108.htm">全国新闻（非广州频道）</a>`;
  const items = parseDayooGzHtml(html);
  assert.equal(items.length, 2, "应只提取广州频道 2 条文章（导航/其他频道被滤）");
  assert.equal(items[0]!.date, "2026-08-21");
  assert.equal(items[1]!.date, "2026-08-20");
  assert.ok(items.every((i) => i.url.startsWith("https://news.dayoo.com/guangzhou/")));
});

test("southcn: 提取 node_ 文章，忽略裸栏目", () => {
  const html = `
  <li><a href="https://news.southcn.com/node_812903b83a/215fb87f22.shtml" target="_blank">前7月广东规上工业增加值同比增长5.7%</a></li>
  <li><a href="https://news.southcn.com/node_810c33d731/a22199607f.shtml">金饰克价月内涨超100元</a></li>
  <li><a href="https://news.southcn.com/node_810c33d731" target="_blank">资讯栏目</a></li>
  <li><a href="https://economy.southcn.com/node_71505a4d28/de38af5865.shtml">科创者品牌战略升维</a></li>`;
  const items = parseSouthcnEconomyHtml(html);
  assert.equal(items.length, 3, "应提取 3 条文章（裸栏目导航被滤）");
  assert.ok(items.every((i) => /\/node_[^/]+\/[a-f0-9]+\.shtml$/.test(i.url)));
});

test("chinanews-gd: 提取文章+日期，忽略专题/导航", () => {
  const html = `
  <a href="https://www.gd.chinanews.com.cn/2026/2026-08-08/449065.shtml">穗港联手开展公益亲子历奇营</a>
  <a href="https://www.gd.chinanews.com.cn/2026/2026-08-18/449178.shtml">广东七夕共登记结婚6056对</a>
  <a href="https://www.gd.chinanews.com.cn/zhuanti/2026/lmgd/index.html">专题导航</a>
  <a href="https://www.gd.chinanews.com.cn/index/yw.html">要闻栏目</a>`;
  const items = parseChinanewsGdHtml(html);
  assert.equal(items.length, 2, "应提取 2 条文章（专题/栏目导航被滤）");
  assert.equal(items[0]!.date, "2026-08-08");
  assert.equal(items[1]!.date, "2026-08-18");
});

test("cnr-gd: 提取文章+日期，忽略栏目", () => {
  const html = `
  <a href="https://www.cnr.cn/gd/dishidongtai/20260806/t20260806_527750982.shtml">南网数字集团立项IEC国标</a>
  <a href="https://www.cnr.cn/gd/fxgz/20260820/t20260820_527760001.shtml">广东高质量发展观察报告发布</a>
  <a href="https://www.cnr.cn/gd/dishidongtai/">地市动态栏目</a>
  <a href="https://news.cnr.cn/2025zt/zkygw/">专题</a>`;
  const items = parseCnrGdHtml(html);
  assert.equal(items.length, 2, "应提取 2 条文章（栏目/专题被滤）");
  assert.equal(items[0]!.date, "2026-08-06");
  assert.equal(items[1]!.date, "2026-08-20");
});
