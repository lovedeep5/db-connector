/**
 * Tiny templating engine for "{{ $node.q1.rows }}" style references inside
 * node config values. Supports:
 *
 *   {{ $node.<nodeId>.<path...> }}    — output of a previous node
 *   {{ $trigger.<path...> }}          — original trigger payload
 *   {{ $env.<name> }}                 — process.env (read-only)
 *   {{ $loop.<index|total|isFirst|isLast> }} — current iteration metadata
 *     (only populated for nodes that run inside a Loop body — `$node.<loopId>`
 *     itself carries the bare per-iter item so simple `$input.field` access
 *     works the way any other node-to-node edge does)
 *   {{ $item.<path...> }} / {{ $index }} — current array item / index
 *     (only populated by the Filter / If-Else inner pass per array item).
 *     When NOT in scope, these tokens are left UNRESOLVED in the string
 *     so a later per-item pass can fill them in.
 *
 * Strings are interpolated; if the template matches the *entire* value and
 * resolves to a non-string, the resolved value is returned as-is (so you can
 * pass an array of rows to a downstream node without stringifying it).
 */

type Scope = {
  node: Record<string, unknown>;
  trigger: unknown;
  env: NodeJS.ProcessEnv;
  loop?: Record<string, unknown>;
  /** Current array item — bound by Filter / If-Else inner evaluation. */
  item?: unknown;
  /** Current array index — bound alongside `item`. */
  index?: number;
};

const EXPR_RE = /\{\{\s*([^}]+?)\s*\}\}/g;
/**
 * Prefixes that aren't always in scope and should be LEFT ALONE by the
 * outer config-templating pass. The Filter / If-Else nodes apply a second
 * pass per array item with `$item` bound; if the outer pass replaced the
 * token with "" first, the inner pass would have nothing to work with.
 */
const DEFERRED_PREFIXES = new Set(["$item", "$index"]);

function readPath(root: unknown, path: string[]): unknown {
  let cur: unknown = root;
  for (const part of path) {
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

function headOf(expr: string): string {
  return expr.trim().split(".")[0].trim();
}

function isDeferred(expr: string, scope: Scope): boolean {
  const head = headOf(expr);
  if (head === "$item") return scope.item === undefined;
  if (head === "$index") return scope.index === undefined;
  return false;
}

function resolveExpression(expr: string, scope: Scope): unknown {
  const parts = expr.split(".").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;
  const [head, ...rest] = parts;
  if (head === "$node") return readPath(scope.node, rest);
  if (head === "$trigger") return readPath(scope.trigger, rest);
  if (head === "$env") return rest[0] ? scope.env[rest[0]] : undefined;
  if (head === "$loop") return readPath(scope.loop ?? {}, rest);
  if (head === "$item") return rest.length === 0 ? scope.item : readPath(scope.item, rest);
  if (head === "$index") return scope.index;
  return undefined;
}

export function applyTemplate(value: unknown, scope: Scope): unknown {
  if (value == null) return value;
  if (typeof value === "string") return applyTemplateString(value, scope);
  if (Array.isArray(value)) return value.map((v) => applyTemplate(v, scope));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = applyTemplate(v, scope);
    return out;
  }
  return value;
}

function applyTemplateString(input: string, scope: Scope): unknown {
  const trimmed = input.trim();
  const single = trimmed.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
  if (single) {
    // Deferred prefix → leave the token untouched so a later pass can resolve it.
    if (isDeferred(single[1], scope)) return input;
    return resolveExpression(single[1], scope);
  }

  return input.replace(EXPR_RE, (whole, expr) => {
    if (isDeferred(String(expr), scope)) return whole;
    const v = resolveExpression(String(expr), scope);
    if (v == null) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  });
}

export function buildScope(args: {
  prevOutputs: Map<string, unknown>;
  trigger: unknown;
  /** Per-iteration metadata exposed as {{ $loop.* }} inside a Loop body. */
  loop?: Record<string, unknown>;
  /** Bound only by Filter / If-Else's per-item inner pass. */
  item?: unknown;
  index?: number;
}): Scope {
  const node: Record<string, unknown> = {};
  for (const [k, v] of args.prevOutputs.entries()) node[k] = v;
  return {
    node,
    trigger: args.trigger,
    env: process.env,
    loop: args.loop,
    item: args.item,
    index: args.index,
  };
}
