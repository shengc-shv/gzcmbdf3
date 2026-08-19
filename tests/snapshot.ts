/**
 * 最小快照工具（零依赖，node:test 配套）。
 *
 * 用法：
 *   UPDATE_SNAPSHOTS=1 npm run test   # 首次/更新快照
 *   npm run test                      # 校验快照
 *
 * 首次运行某快照会自动生成文件并抛错提示，CI 友好的"先落盘、再核对"流程。
 */
import fs from "node:fs";
import path from "node:path";

const SNAP_DIR = path.resolve(import.meta.dirname, "snapshots");

function normalize(v: unknown): string {
  if (typeof v === "string") return v; // HTML 等文本保留原样，便于阅读差异
  return JSON.stringify(v, null, 2);
}

export function toMatchSnapshot(name: string, value: unknown): void {
  const file = path.join(SNAP_DIR, `${name}.snap`);
  const normalized = normalize(value);
  const update = process.env.UPDATE_SNAPSHOTS === "1";
  if (update || !fs.existsSync(file)) {
    fs.mkdirSync(SNAP_DIR, { recursive: true });
    fs.writeFileSync(file, normalized, "utf8");
    if (!update) {
      throw new Error(
        `Snapshot "${name}" created at ${file} — 请核对内容后重新运行测试`,
      );
    }
    return;
  }
  const existing = fs.readFileSync(file, "utf8");
  if (existing !== normalized) {
    throw new Error(
      `Snapshot "${name}" mismatch — 若为预期变更请用 UPDATE_SNAPSHOTS=1 更新`,
    );
  }
}
