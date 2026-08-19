/**
 * AI 调用埋点（M2-指令③）。
 *
 * 在 lib/ai/llm.ts 的 runLlm 出口统一计数（backend/stage/ok/ms），
 * 追加写 data/metrics/ai-calls-<date>.jsonl（按日 append-only）。
 * 与既有 lib/ai/log.ts（logs/llm-calls.jsonl，字符级详情）并存：
 * 本模块管 stage 维度与按日聚合，供 quota-report 统计/估算花费。
 *
 * 旁路：AI_TELEMETRY=off 时关闭。埋点自身失败绝不影响 LLM 主流程。
 */
import fs from "node:fs";
import path from "node:path";
import type { LlmBackendId } from "./llm";
import type { AiStage } from "./mode";

export interface AiCallMetric {
  ts: string;
  date: string;
  backend: LlmBackendId;
  stage: AiStage;
  ok: boolean;
  ms: number;
  /** 每次调用的 token 估算：claude-cli（Max 订阅）无计量，恒 0。 */
  tokens: number;
  modelTag: string;
}

export function aiTelemetryEnabled(): boolean {
  return process.env.AI_TELEMETRY !== "off";
}

export function recordAiCall(m: AiCallMetric): void {
  if (!aiTelemetryEnabled()) return;
  try {
    const dir = path.join("data", "metrics");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, `ai-calls-${m.date}.jsonl`),
      JSON.stringify(m) + "\n",
      "utf8",
    );
  } catch {
    // 埋点失败不得影响 LLM 主流程
  }
}

/** 读取某日 metrics（供 quota-report 等汇总）。 */
export function loadAiCalls(date?: string): AiCallMetric[] {
  const dir = path.join("data", "metrics");
  if (!fs.existsSync(dir)) return [];
  const files = date
    ? [path.join(dir, `ai-calls-${date}.jsonl`)]
    : fs
        .readdirSync(dir)
        .filter((f) => /^ai-calls-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
        .map((f) => path.join(dir, f));
  const out: AiCallMetric[] = [];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as AiCallMetric);
      } catch {
        // 跳过损坏行
      }
    }
  }
  return out;
}
