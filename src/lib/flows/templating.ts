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
};

const EXPR_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

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

function resolveExpression(expr: string, scope: Scope): unknown {
  const parts = expr.split(".").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;
  const [head, ...rest] = parts;
  if (head === "$node") return readPath(scope.node, rest);
  if (head === "$trigger") return readPath(scope.trigger, rest);
  if (head === "$env") return rest[0] ? scope.env[rest[0]] : undefined;
  if (head === "$loop") return readPath(scope.loop ?? {}, rest);
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
  // If the whole string is one expression, return the raw resolved value.
  const trimmed = input.trim();
  const single = trimmed.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
  if (single) return resolveExpression(single[1], scope);

  // Otherwise stringify-interpolate.
  return input.replace(EXPR_RE, (_, expr) => {
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
}): Scope {
  const node: Record<string, unknown> = {};
  for (const [k, v] of args.prevOutputs.entries()) node[k] = v;
  return { node, trigger: args.trigger, env: process.env, loop: args.loop };
}
