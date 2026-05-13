/**
 * Builds the TypeScript declarations that Monaco uses to type the JS Code
 * node's sandbox globals (`$input`, `$prev`, `$node.<id>`, `fetch`, etc.).
 *
 * Field shapes come from the most recent test run — each upstream node's
 * `output` is inferred into a TS type via `inferTsType`. With this in place,
 * typing `$input.` inside the JS Code editor shows the real fields from
 * the upstream node (rows, site, status, …) rather than the flat keyword
 * suggestions Monaco emits with no type info.
 *
 * If there's no test-run data yet, the helpers fall back to `unknown`
 * everywhere — the user can still write code; they just won't get rich
 * autocomplete until the first run produces sample data.
 */
import type { FlowDefinition } from "@/lib/flows/types";
import type { TestRunResult } from "@/server/services/flow-test-runner";

const MAX_DEPTH = 4;
const MAX_FIELDS = 50;
const SAFE_KEY_RE = /^[a-zA-Z_$][\w$]*$/;

/**
 * Best-effort TypeScript type from a runtime value. Caps recursion depth and
 * field count so a million-row sample doesn't generate a million-line `.d.ts`.
 */
export function inferTsType(value: unknown, depth = 0): string {
  if (depth >= MAX_DEPTH) return "unknown";
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  const t = typeof value;
  if (t === "string") return "string";
  if (t === "number") return "number";
  if (t === "boolean") return "boolean";
  if (t === "bigint") return "bigint";
  if (Array.isArray(value)) {
    if (value.length === 0) return "unknown[]";
    return `Array<${inferTsType(value[0], depth + 1)}>`;
  }
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const entries = Object.entries(obj).slice(0, MAX_FIELDS);
    const fields = entries.map(
      ([k, v]) => `${safeKey(k)}: ${inferTsType(v, depth + 1)}`
    );
    return `{ ${fields.join("; ")} }`;
  }
  return "unknown";
}

function safeKey(k: string): string {
  return SAFE_KEY_RE.test(k) ? k : JSON.stringify(k);
}

/**
 * Build the `.d.ts` to inject into Monaco for the currently-selected JS Code
 * node. Falls back to a "no data yet" baseline of `unknown` for `$input`.
 *
 * `$input` is typed as the most recent upstream node's output (matches the
 * executor's `[...prevOutputs.values()].pop()` semantics). `$node.<id>` is
 * a typed object covering every node that has produced output in the last
 * run — so users can also access historical values, not just the immediate
 * upstream.
 */
export function buildJsCodeContextDts(
  selectedNodeId: string | null,
  def: FlowDefinition | null,
  lastTestRun: TestRunResult | null
): string {
  let inputType = "unknown";
  let nodeMapType = "{ [nodeId: string]: unknown }";

  if (selectedNodeId && def && lastTestRun) {
    const upstreamId = def.edges.find((e) => e.target === selectedNodeId)?.source;
    if (upstreamId) {
      const upstreamRun = lastTestRun.nodes.find((nr) => nr.nodeId === upstreamId);
      if (upstreamRun?.output !== undefined) {
        inputType = inferTsType(upstreamRun.output);
      }
    }
    // Build $node typed map from every run with a non-null output.
    const fields = lastTestRun.nodes
      .filter((nr) => nr.output !== undefined && nr.output !== null)
      .slice(0, MAX_FIELDS)
      .map((nr) => `  ${safeKey(nr.nodeId)}: ${inferTsType(nr.output)};`);
    if (fields.length > 0) {
      nodeMapType = `{\n${fields.join("\n")}\n  [other: string]: unknown;\n}`;
    }
  }

  return `// Auto-generated for the JS Code node. Reflects the last test run.

declare const $input: ${inputType};
declare const $prev: Map<string, unknown>;
declare const $node: ${nodeMapType};

declare function fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
declare const console: {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};
`;
}
