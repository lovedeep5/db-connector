import { z } from "zod";
import type { NodeDef } from "../types";

const Config = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  url: z.string().url("Enter a full URL"),
  headers: z.record(z.string()).optional(),
  body: z.unknown().optional(),
  timeoutMs: z.number().int().positive().optional(),
  /** When true, parse the response as JSON; otherwise return the raw text. */
  parseJson: z.boolean().default(true),
});

type HttpOutput = {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: unknown;
};

export const httpRequestNode: NodeDef<z.infer<typeof Config>, HttpOutput> = {
  type: "http.request",
  label: "HTTP Request",
  description: "Call any external HTTP endpoint and pass the response on.",
  category: "io",
  icon: "Globe",
  accent: "violet",
  schema: Config,
  defaultConfig: () => ({ method: "GET", url: "https://api.example.com/", parseJson: true }),
  takesInput: true,
  async execute(_ctx, cfg) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs ?? 30_000);
    try {
      const init: RequestInit = {
        method: cfg.method,
        headers: cfg.headers,
        signal: ctrl.signal,
      };
      if (cfg.body !== undefined && cfg.method !== "GET") {
        init.body = typeof cfg.body === "string" ? cfg.body : JSON.stringify(cfg.body);
        if (!cfg.headers || !("content-type" in lowerKey(cfg.headers))) {
          init.headers = { ...(cfg.headers ?? {}), "content-type": "application/json" };
        }
      }
      const res = await fetch(cfg.url, init);
      const text = await res.text();
      const body = cfg.parseJson ? safeJson(text) : text;
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k] = v));
      return { status: res.status, ok: res.ok, headers, body };
    } finally {
      clearTimeout(timer);
    }
  },
};

function safeJson(s: string): unknown {
  try { return s ? JSON.parse(s) : null; } catch { return s; }
}

function lowerKey(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v;
  return out;
}
