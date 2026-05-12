"use client";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { CheckCircle2, Loader2, MinusCircle, XCircle } from "lucide-react";
import { findCatalog } from "./node-catalog";
import { cn } from "@/lib/utils";

const ACCENT: Record<string, { border: string; bg: string; text: string }> = {
  blue:    { border: "border-blue-500/40",    bg: "bg-blue-500/5",    text: "text-blue-600" },
  violet:  { border: "border-violet-500/40",  bg: "bg-violet-500/5",  text: "text-violet-600" },
  emerald: { border: "border-emerald-500/40", bg: "bg-emerald-500/5", text: "text-emerald-600" },
  amber:   { border: "border-amber-500/40",   bg: "bg-amber-500/5",   text: "text-amber-700" },
  rose:    { border: "border-rose-500/40",    bg: "bg-rose-500/5",    text: "text-rose-600" },
  slate:   { border: "border-slate-500/40",   bg: "bg-slate-500/5",   text: "text-slate-600" },
};

const PORT_COLOR: Record<string, string> = {
  true: "!bg-emerald-500",
  false: "!bg-rose-500",
  item: "!bg-amber-500",
  done: "!bg-emerald-500",
};

type Data = {
  label: string;
  type: string;
  isTrigger: boolean;
  summary?: string;
  lastRunStatus?: "success" | "error" | "skipped";
  /** True while this node is currently executing in a live test run. */
  isRunning?: boolean;
};

const STATUS_RING: Record<NonNullable<Data["lastRunStatus"]>, string> = {
  success: "ring-2 ring-emerald-500/60",
  error: "ring-2 ring-destructive",
  skipped: "ring-2 ring-muted-foreground/40",
};

// Animated outline used while a node's step is in flight on the server. The
// inner pulsing dot in the header is the secondary cue.
const RUNNING_RING = "ring-2 ring-amber-400 animate-pulse";

/**
 * Tiny status badge in the node header — sits where the lucide icon would go
 * in a list app. While running, the spinner takes precedence; once finished
 * it shows the terminal state. Pairs with the ring color around the node so
 * users have both a glance signal (the ring) and a precise one (this badge).
 */
function StatusBadge({ isRunning, status }: { isRunning?: boolean; status?: Data["lastRunStatus"] }) {
  if (isRunning) {
    return (
      <span
        className="flex items-center gap-1 text-[9px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400 shrink-0"
        title="Currently running"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        running
      </span>
    );
  }
  if (status === "success") {
    return (
      <CheckCircle2
        className="h-3.5 w-3.5 text-emerald-500 shrink-0"
        aria-label="Completed successfully"
      >
        <title>Completed successfully</title>
      </CheckCircle2>
    );
  }
  if (status === "error") {
    return (
      <XCircle
        className="h-3.5 w-3.5 text-destructive shrink-0"
        aria-label="Failed"
      >
        <title>Failed</title>
      </XCircle>
    );
  }
  if (status === "skipped") {
    return (
      <MinusCircle
        className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0"
        aria-label="Skipped (an upstream branch didn't fire)"
      >
        <title>Skipped</title>
      </MinusCircle>
    );
  }
  return null;
}

export function CanvasNode(props: NodeProps) {
  const data = props.data as unknown as Data;
  const cat = findCatalog(data.type);
  const Icon = cat?.icon;
  const accent = ACCENT[cat?.accent ?? "slate"] ?? ACCENT.slate;
  // While running, the running ring beats the last-run color so users see
  // the live state clearly. Once the node finishes, the lastRunStatus ring
  // takes over.
  const statusRing = data.isRunning
    ? RUNNING_RING
    : data.lastRunStatus
      ? STATUS_RING[data.lastRunStatus]
      : "";
  // Multi-port nodes (e.g. If/Else) declare their outputs in the catalog.
  const ports = cat?.outputPorts && cat.outputPorts.length > 1 ? cat.outputPorts : null;
  return (
    <div
      className={cn(
        "rounded-lg border-2 shadow-sm bg-background w-56 text-sm relative",
        accent.border,
        statusRing,
        props.selected && "ring-2 ring-primary"
      )}
    >
      {!data.isTrigger && (
        <Handle
          type="target"
          position={Position.Left}
          className="!h-3 !w-3 !bg-foreground/70 !border-2 !border-background"
        />
      )}
      <div className={cn("flex items-center gap-2 px-3 py-2 rounded-t-md", accent.bg)}>
        {Icon && <Icon className={cn("h-4 w-4", accent.text)} />}
        <span className="font-medium truncate flex-1">{data.label}</span>
        <StatusBadge isRunning={data.isRunning} status={data.lastRunStatus} />
      </div>
      {data.summary && (
        <div className="px-3 py-2 text-xs text-muted-foreground border-t border-dashed truncate">
          {data.summary}
        </div>
      )}

      {ports ? (
        // One labeled handle per port (e.g. true/false on If/Else).
        ports.map((p, i) => {
          const top = `${((i + 1) * 100) / (ports.length + 1)}%`;
          return (
            <div key={p}>
              <Handle
                id={p}
                type="source"
                position={Position.Right}
                style={{ top }}
                className={cn(
                  "!h-3 !w-3 !border-2 !border-background",
                  PORT_COLOR[p] ?? "!bg-foreground/70"
                )}
              />
              <span
                style={{ top, transform: "translate(8px, -50%)" }}
                className="absolute right-[-30px] text-[9px] uppercase tracking-wide text-muted-foreground pointer-events-none"
              >
                {p}
              </span>
            </div>
          );
        })
      ) : cat?.noSourceHandle ? null : (
        <Handle
          type="source"
          position={Position.Right}
          className="!h-3 !w-3 !bg-foreground/70 !border-2 !border-background"
        />
      )}
    </div>
  );
}
