import { z } from "zod";
import type { NodeDef } from "../types";

const Config = z.object({
  /**
   * Dot-path to extract from the latest upstream output. Examples:
   *   "body"            → HTTP response body
   *   "body.data"       → JSON array nested under .data
   *   "rows[0].email"   → first row's email
   */
  path: z.string().min(1, "Path required"),
});

export const extractPathNode: NodeDef<z.infer<typeof Config>, unknown> = {
  type: "transform.extractPath",
  label: "Extract Path",
  description: "Pull a value out of the upstream output by dot-path. Closes the HTTP → To File gap.",
  category: "transform",
  icon: "MoveDown",
  accent: "blue",
  schema: Config,
  defaultConfig: () => ({ path: "body" }),
  takesInput: true,
  async execute(ctx, cfg) {
    const lastValue = [...ctx.prevOutputs.values()].pop();
    return readPath(lastValue, cfg.path);
  },
};

function readPath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  // Split on "." and "[N]" so users can write rows[0].email
  const parts = path
    .replace(/\[(\w+)\]/g, ".$1")
    .split(".")
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of parts) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(part);
      cur = Number.isFinite(idx) ? cur[idx] : undefined;
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}
