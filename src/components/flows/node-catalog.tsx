/**
 * Client-side catalog of available node types. Used by the palette
 * (left sidebar) and by the config panel (right sidebar) to look up label,
 * icon and accent without round-tripping to the server. Mirrors the server
 * registry — keep them in sync when adding nodes.
 */
import {
  CalendarClock, MousePointerClick, Webhook, Database, Globe, Mail, FileDown, Code2,
  Split, Filter, Variable, MoveDown, Clock, Download, Repeat, CornerDownLeft,
} from "lucide-react";

export type CatalogEntry = {
  type: string;
  label: string;
  description: string;
  category: "trigger" | "data" | "io" | "transform" | "control";
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  isTrigger?: boolean;
  /** For branching nodes, the named output ports shown on the canvas. */
  outputPorts?: string[];
  /** Sinks (e.g. Loop End): omit the right-hand source handle entirely. */
  noSourceHandle?: boolean;
};

export const CATALOG: CatalogEntry[] = [
  // Triggers
  { type: "schedule", label: "Schedule", description: "Run on a cron expression.", category: "trigger", icon: CalendarClock, accent: "blue", isTrigger: true },
  { type: "manual", label: "Manual", description: "Only runs when someone clicks Run.", category: "trigger", icon: MousePointerClick, accent: "slate", isTrigger: true },
  { type: "webhook", label: "Webhook", description: "Run when an external system POSTs to a URL.", category: "trigger", icon: Webhook, accent: "violet", isTrigger: true },

  // Actions
  { type: "db.query", label: "DB Query", description: "Run SQL/Mongo against a connection.", category: "data", icon: Database, accent: "blue" },
  { type: "http.request", label: "HTTP Request", description: "Call an HTTP endpoint.", category: "io", icon: Globe, accent: "violet" },
  { type: "io.downloadFile", label: "Download File", description: "Fetch a file (CSV/XLSX auto-parse into rows; binaries stay raw).", category: "io", icon: Download, accent: "blue" },
  { type: "email.send", label: "Send Email", description: "Send via workspace SMTP.", category: "io", icon: Mail, accent: "emerald" },
  { type: "transform.toFile", label: "To File", description: "Convert rows → CSV / XLSX / JSON.", category: "transform", icon: FileDown, accent: "amber" },
  { type: "code.js", label: "JS Code", description: "Transform with sandboxed JS.", category: "transform", icon: Code2, accent: "rose" },

  // Phase 2A — control flow & transforms
  { type: "control.ifElse", label: "If / Else", description: "Branch on a JS condition. Two output ports.", category: "control", icon: Split, accent: "amber", outputPorts: ["true", "false"] },
  { type: "transform.filter", label: "Filter", description: "Keep array items matching a predicate.", category: "transform", icon: Filter, accent: "violet" },
  { type: "transform.setVariable", label: "Set Variable", description: "Name a value for downstream nodes.", category: "transform", icon: Variable, accent: "slate" },
  { type: "transform.extractPath", label: "Extract Path", description: "Pull a value by dot-path (e.g. body.data).", category: "transform", icon: MoveDown, accent: "blue" },
  { type: "control.delay", label: "Delay", description: "Pause for N ms before continuing.", category: "control", icon: Clock, accent: "slate" },
  { type: "control.loop", label: "Loop", description: "Iterate over an array. 'item' port fires per batch; 'done' fires after all iterations.", category: "control", icon: Repeat, accent: "amber", outputPorts: ["item", "done"] },
  { type: "control.loopEnd", label: "Loop End", description: "Marks the end of a Loop body. The value flowing in becomes results[i] on the parent Loop's `done` port.", category: "control", icon: CornerDownLeft, accent: "amber", noSourceHandle: true },
];

export function findCatalog(type: string): CatalogEntry | undefined {
  return CATALOG.find((c) => c.type === type);
}

export const TRIGGER_CATALOG = CATALOG.filter((c) => c.isTrigger);
export const ACTION_CATALOG = CATALOG.filter((c) => !c.isTrigger);
