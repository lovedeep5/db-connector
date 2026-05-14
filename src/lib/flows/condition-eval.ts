/**
 * Form-based condition evaluator shared by the If/Else and Filter nodes.
 * Conditions are { left, operator, right } triples on values that come out
 * of the templating engine — so the user picks fields from the previous
 * step via `{{ $node.q1.rows[0].count }}` etc. without touching JS.
 *
 * Operator set matches n8n's IfV2: covers the common typed comparisons
 * plus the type-free is-empty / is-not-empty checks. Numeric and date
 * comparisons coerce both sides (parseFloat, Date.parse); regex/contains
 * coerce to strings. When coercion fails (e.g. greaterThan on "abc"),
 * the comparison returns false rather than throwing — keeps a single
 * bad row from killing the whole flow.
 */

export const OPERATORS = [
  // Equality
  "equals",
  "notEquals",
  // String
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
  "regex",
  // Numeric / date
  "greaterThan",
  "lessThan",
  "greaterOrEqual",
  "lessOrEqual",
  // Existence / boolean
  "isEmpty",
  "isNotEmpty",
  "isTrue",
  "isFalse",
] as const;
export type Operator = typeof OPERATORS[number];

export const OPERATOR_LABEL: Record<Operator, string> = {
  equals: "is equal to",
  notEquals: "is not equal to",
  contains: "contains",
  notContains: "does not contain",
  startsWith: "starts with",
  endsWith: "ends with",
  regex: "matches regex",
  greaterThan: "is greater than",
  lessThan: "is less than",
  greaterOrEqual: "is greater or equal",
  lessOrEqual: "is less or equal",
  isEmpty: "is empty",
  isNotEmpty: "is not empty",
  isTrue: "is true",
  isFalse: "is false",
};

/** Right-side input is meaningless for these unary operators. */
export const UNARY_OPERATORS: ReadonlySet<Operator> = new Set([
  "isEmpty",
  "isNotEmpty",
  "isTrue",
  "isFalse",
]);

export type Condition = {
  left: unknown;
  operator: Operator;
  right?: unknown;
};

export type Combinator = "and" | "or";

export function evaluateCondition(c: Condition): boolean {
  switch (c.operator) {
    case "equals":      return looseEq(c.left, c.right);
    case "notEquals":   return !looseEq(c.left, c.right);
    case "contains":    return asString(c.left).includes(asString(c.right));
    case "notContains": return !asString(c.left).includes(asString(c.right));
    case "startsWith":  return asString(c.left).startsWith(asString(c.right));
    case "endsWith":    return asString(c.left).endsWith(asString(c.right));
    case "regex": {
      try { return new RegExp(asString(c.right)).test(asString(c.left)); }
      catch { return false; }
    }
    case "greaterThan":    return cmpNumeric(c.left, c.right) > 0;
    case "lessThan":       return cmpNumeric(c.left, c.right) < 0;
    case "greaterOrEqual": return cmpNumeric(c.left, c.right) >= 0;
    case "lessOrEqual":    return cmpNumeric(c.left, c.right) <= 0;
    case "isEmpty":        return isEmpty(c.left);
    case "isNotEmpty":     return !isEmpty(c.left);
    case "isTrue":         return c.left === true || asString(c.left).toLowerCase() === "true";
    case "isFalse":        return c.left === false || asString(c.left).toLowerCase() === "false";
  }
}

export function evaluateAll(conditions: Condition[], combinator: Combinator): boolean {
  if (conditions.length === 0) return false;
  if (combinator === "or") return conditions.some(evaluateCondition);
  return conditions.every(evaluateCondition);
}

function looseEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // string-vs-number coercion (form values often come back as strings)
  if (typeof a === "string" && typeof b === "number") return Number(a) === b;
  if (typeof a === "number" && typeof b === "string") return a === Number(b);
  // null vs undefined treated as same "empty"
  if (a == null && b == null) return true;
  return false;
}

function asString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

function cmpNumeric(a: unknown, b: unknown): number {
  // Try Date first when one side is an ISO-ish string. Otherwise number.
  const ad = tryDate(a);
  const bd = tryDate(b);
  if (ad != null && bd != null) return ad - bd;
  const an = Number(a);
  const bn = Number(b);
  if (Number.isNaN(an) || Number.isNaN(bn)) return Number.NaN;
  return an - bn;
}

function tryDate(v: unknown): number | null {
  if (v instanceof Date) return v.getTime();
  if (typeof v !== "string") return null;
  // Heuristic: only treat as date when the string actually looks date-shaped.
  if (!/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

function isEmpty(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.length === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}
