# gzcmbdf3

招商银行广州分行 · 零售业务决策商机简报（银行零售领域定制版 DailyBrief）。

> 上游归属：leiting-eric/DailyBrief（DailyBrief 项目本身），本仓库为其 fork 演进，
> 融入「gd-ipo / 广州商机」扩展并整体更名 gzcmbdf3。

## 它做什么

每天自动采集 40+ 信息源（政府/央行、交易所、财经媒体、科技社区、广州本地商机源），
经 **关键词漏斗**（银行零售业务体系，零成本粗筛）→ **AI 富集与分类**（逐条打标、
写银行视角摘要）→ 渲染为单文件 HTML 日报，并发布到 GitHub Pages。

设计目标：**日报 15–30 条/日**（聚焦银行零售业务，去除大盘行情/娱乐等噪音），
**商机 0–5 条/日**（广州优先：上市辅导、融资里程碑、机构扩张、产业政策、同业动态）。

## 架构：五清晰边界

```
① 采集 Collection  →  ② 归一化 Normalization  →  ③ AI  →  ④ 渲染 Render  →  ⑤ 部署 Deploy
```

| 边界 | 职责 | 关键模块 |
|---|---|---|
| ① 采集 | 从各源抓取原始数据（TS 源 + `.mjs` 爬虫产物） | `lib/sources/*`、`scripts/crawlers/*` |
| ② 归一化 | 汇合 / URL 去重 / region 分流（`gd-`→`gz-` 改写）/ tier 透传 | `lib/ingest/merge.ts`、`lib/sources/constants.ts` |
| ③ AI | 关键词漏斗（零成本）→ LLM 富集 / 分类 / 摘要 / 交易点评 / 执行摘要 | `lib/filters/*`、`lib/ai/*` |
| ④ 渲染 | 把规范数据渲染为单文件 HTML（i18n / theme / cards / sections） | `lib/output/render.ts` + `lib/output/render/` |
| ⑤ 部署 | 构建静态站、发布 gh-pages、滚动历史归档 | `scripts/build-site.mjs`、`data/history/` |

纪律：归一化层是唯一允许去重/region 改写的地方；漏斗在 AI 之前、零成本；渲染层不取数、不调 AI。

## 快速开始

```bash
npm ci
cp .env.example .env.local   # 按需配置 LLM_BACKEND + API Key
npm run daily                # 跑一次日报（含爬虫产物读取 + 漏斗 + AI）
npm test                     # 运行测试（node:test，30+ 用例）
npm run build-site           # 生成静态站（index.html / archive.html）
```

`SKIP_AI=true npm run daily`：跳过所有 LLM 调用，仅用历史缓存/AI 资产渲染（失败恢复用）。

## 命令

| 命令 | 说明 |
|---|---|
| `npm run daily` | 主编排：采集→归一化→漏斗→AI→渲染→写盘 |
| `npm run crawl:gz` | 跑广州商机爬虫（统计局/市政府/南沙） |
| `npm run render` | 用 sidecar 重新渲染 HTML/MD（不重抓不调 AI） |
| `npm run sources` / `sources:check` | 查看/校验数据源配置 |
| `npm run quota-report` | AI 调用量与花费估算（基于 `data/metrics/`） |
| `npm run build-site` / `deploy` / `open` | 静态站构建 / 发布 / 本地打开 |
| `npm test` | node:test 测试套件 |

## 数据源与等级

`data/` / `sources.config.json` 46 个源，每个带 **tier 等级**，渲染时差异化角标：

- **T1 官方一手**（政府/央行/监管）：govcn-policy、fed-press、广州政府系
- **T1.5 准官方·机构一手**（交易所/官方博客/央视）：沪深北港交易所、巨潮、DeepMind/HF 博客
- **T2 媒体·智库**：财经媒体（新浪/央视财经之外）、科技媒体、个人博客

`scripts/crawlers/*.mjs` 产出 `data/crawled-articles.json`（IPO/新股）与
`data/crawled-gz.json`（广州商机），经 `lib/ingest/merge.ts` 归一化接入主流程。

## 关键词漏斗（银行零售业务体系 v4）

配置：`sources.keywords.json`（已 commit）。三级漏斗 `applyKeywordFilter`：

1. **L0 全局硬排除**（仅标题）：大盘行情 / 证券分析 / 非金融噪音 / 行政事务 → 直接丢弃
2. **地域分**：tier1（广州/湛江/清远/广东/大湾区…）+100，tier2 区名 +60
3. **五维度命中**：个人信贷 / 财富管理 / 零售基础客群 / 私行(周报) / 宏观政策
   （strong 直接命中；weak 需 `cooccurrence_for_weak` 共现；`exclude` 剔除）
4. **五商机追踪器**：上市进程(S) / 融资里程碑(A) / 机构扩张(A) / 产业人才政策(B) / 同业竞争(B)
   （`geo_lock` 需地域命中；`exclude_if_in_title` 排除异地）

硬过滤（未命中即丢，不进 AI）；`KEYWORD_FILTER=off` 旁路；全量误杀时回退保底。

## 数据存储

```
data/
  article-history.json      # 7 天滚动缓存（URL 去重 + AI 摘要，展示窗口）
  article-history-backup.json  # 被裁条目的持久归档（去重）
  crawled-articles.json     # IPO 爬虫产物（CI 生成，不入库）
  crawled-gz.json           # 广州商机爬虫产物（同上）
  history/reports/<date>.json   # 合并后的统一历史报告目录（M2-⑤）
  ai-assets/                # AI 付费产物账本（append-only，永不 7 天裁剪）
  metrics/ai-calls-<date>.jsonl # AI 调用埋点（backend/stage/ok/ms）
daily_reports/              # 发布目录（{date}/ + index.html + archive.html）
```

## AI 后端

`LLM_BACKEND` 可选：`claude-cli`(默认) / `anthropic` / `openai` / `deepseek` / `minimax` / `zhipu`。
统一经 `lib/ai/llm.ts` 的 `runLlm` 分发；`SKIP_AI=true` 全部跳过。

## 测试与质量

- `npm test`：node:test 套件（merge 归一化 / history 7 天边界 / render 结构与快照 /
  i18n / tier 角标 / 关键词漏斗）。
- 快照：`tests/snapshots/`，`UPDATE_SNAPSHOTS=1 npm test` 更新。
- 无持久 LLM 凭据时不要跑 `npm run daily`（会 `validateBackendCredentials` 快速失败）。

## CI/CD（GitHub Actions）

- `daily.yml`：cron 北京 8:05/8:25/8:45，采集→AI→渲染→发布 gh-pages（含 gate 闸门，每天至多一次）。
- `test.yml` / `test2.yml`：手动验证工作流（SKIP_AI 失败恢复路径）。
- `cleanup-history.yml`：滚动历史裁剪。
- 上游归因与 AGENTS 约定见仓库内文档；`data/article-history.json` 等由 CI 回写提交。

## 整改路线（M0–M3）

- M0 ✅ 测试基线（node:test）+ 归一化层 + 源等级 tier（T6）
- M1 ✅ 关键词漏斗 + daily 集成
- M2 🚧 AI 埋点 / AI 资产持久化 / 存储合并（进行中）
- M3 ✅/🚧 删 pipeline 死代码、SKIP_AI 开关层、占位源角色化、集中路由常量、render 拆分(i18n/theme)；双采集本体 TS 化与 cards/sections 拆分为二期

详见 `docs/`（架构分析报告 / 整改计划 / M1 任务文档）。
