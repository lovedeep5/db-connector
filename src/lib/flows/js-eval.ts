import vm from "node:vm";

/**
 * Run a small piece of user JS inside a vm sandbox. Shared by the if-else,
 * filter, and JS Code nodes so the security/timeout story stays in one place.
 *
 * The provided `body` is wrapped as the body of an async IIFE, so you can
 * either `return <expr>` (for predicates) or write multiple statements.
 */
export async function evalUserJs(opts: {
  body: string;
  scope: Record<string, unknown>;
  timeoutMs: number;
  filename: string;
  log?: (line: string) => void;
}): Promise<unknown> {
  const sandbox: Record<string, unknown> = {
    ...opts.scope,
    console: makeConsole(opts.log),
    Buffer,
    URL,
    URLSearchParams,
    fetch,
    Math,
    Date,
    JSON,
    Promise,
    setTimeout,
    clearTimeout,
  };
  const script = new vm.Script(`(async () => { ${opts.body}\n })();`, { filename: opts.filename });
  const context = vm.createContext(sandbox, { name: opts.filename });
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      script.runInContext(context),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`User code timed out after ${opts.timeoutMs}ms`)),
          opts.timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function makeConsole(log?: (line: string) => void) {
  if (!log) return undefined;
  const wrap = (level: string) => (...args: unknown[]) => {
    const line = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
    log(`[${level}] ${line}`);
  };
  return { log: wrap("log"), info: wrap("info"), warn: wrap("warn"), error: wrap("error") };
}
