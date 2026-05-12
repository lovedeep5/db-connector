import { z } from "zod";
import vm from "node:vm";
import type { NodeDef } from "../types";

const Config = z.object({
  /**
   * JS body. Receives `$input` (latest upstream output) and `$prev` (Map of all
   * previous outputs by node id). Must return the new output value.
   * Async functions / `await` are supported.
   */
  code: z.string().min(1),
  timeoutMs: z.number().int().positive().max(5 * 60_000).default(30_000),
});

export const jsCodeNode: NodeDef<z.infer<typeof Config>, unknown> = {
  type: "code.js",
  label: "JS Code",
  description: "Transform data with a small JS function. Runs in a sandbox with a timeout.",
  category: "transform",
  icon: "Code2",
  accent: "rose",
  schema: Config,
  defaultConfig: () => ({
    code: "// $input is the latest upstream output.\n// $prev is a Map<nodeId, output>.\nreturn $input;",
    timeoutMs: 30_000,
  }),
  takesInput: true,
  async execute(ctx, cfg) {
    // Latest upstream output. The executor stores outputs in insertion order.
    const lastValue = [...ctx.prevOutputs.values()].pop();
    const prev = ctx.prevOutputs;
    const sandbox: Record<string, unknown> = {
      $input: lastValue,
      $prev: prev,
      console: makeConsole(ctx.log),
      // Minimal globals; intentionally no `require`, `process`, `fs`.
      Buffer,
      URL,
      URLSearchParams,
      fetch,
      Math,
      Date,
      JSON,
      // Promise / setTimeout are needed for async / await to function.
      Promise,
      setTimeout,
      clearTimeout,
    };
    const script = new vm.Script(
      `(async () => { ${cfg.code}\n })();`,
      { filename: `flow-node-${ctx.flowRunId}.js` }
    );
    const context = vm.createContext(sandbox, { name: "flow-code-node" });
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        script.runInContext(context),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Code timed out after ${cfg.timeoutMs}ms`)),
            cfg.timeoutMs
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  },
};

function makeConsole(log: (line: string) => void) {
  const wrap = (level: string) => (...args: unknown[]) => {
    const line = args
      .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
      .join(" ");
    log(`[${level}] ${line}`);
  };
  return {
    log: wrap("log"),
    info: wrap("info"),
    warn: wrap("warn"),
    error: wrap("error"),
  };
}
