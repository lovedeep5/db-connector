/**
 * Tiny helpers used by SQL drivers (Postgres / MySQL / Oracle).
 * They build minimal parametrized statements and the caller passes only
 * identifiers that originate from the database catalog, not user input —
 * so the qualifier helpers do strict identifier validation as defense in depth.
 */

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_$]*$/;
const READ_VERBS = new Set([
  "select",
  "show",
  "explain",
  "with",
  "describe",
  "desc",
  "values",
  "table", // PostgreSQL `TABLE foo` shorthand for SELECT * FROM foo
]);

export function assertIdent(name: string): string {
  if (!IDENT_RE.test(name)) throw new Error(`Invalid identifier: ${name}`);
  return name;
}

export function quoteIdent(name: string, q: '"' | "`" = '"'): string {
  assertIdent(name);
  return `${q}${name.replace(new RegExp(q, "g"), q + q)}${q}`;
}

export function qualified(schema: string, name: string, q: '"' | "`" = '"'): string {
  return `${quoteIdent(schema, q)}.${quoteIdent(name, q)}`;
}

/**
 * Strip block comments, line comments, and string literals so subsequent
 * parsing is not fooled by SQL embedded inside them. Conservative: when in
 * doubt we err on returning content that won't be classified as read-only.
 */
function stripCommentsAndStrings(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/"(?:""|[^"])*"/g, '""');
}

export function splitStatements(sql: string): string[] {
  return stripCommentsAndStrings(sql)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Best-effort read-only detection. Splits on `;` after stripping comments
 * and strings, then requires every non-empty statement to start with a
 * read-only verb. This is *not* a SQL sandbox — server-side timeouts and
 * the database's own permissions are still the source of truth.
 */
export function isReadOnly(sql: string): boolean {
  const statements = splitStatements(sql);
  if (statements.length === 0) return true;
  return statements.every((s) => {
    const first = s.match(/[a-z]+/i)?.[0]?.toLowerCase() ?? "";
    return READ_VERBS.has(first);
  });
}

/** Single read-only statement (suitable to wrap with a server-side cursor). */
export function isSingleReadOnly(sql: string): boolean {
  const statements = splitStatements(sql);
  if (statements.length !== 1) return false;
  const first = statements[0].match(/[a-z]+/i)?.[0]?.toLowerCase() ?? "";
  return READ_VERBS.has(first);
}
