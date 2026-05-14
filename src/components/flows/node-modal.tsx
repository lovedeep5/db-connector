"use client";
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Group, Panel, Separator } from "react-resizable-panels";
import { X, Play, Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NodeConfig, type NodeConfigProps } from "./node-config";
import { findCatalog } from "./node-catalog";
import type { Node, Edge } from "@xyflow/react";
import type { TestRunResult } from "@/server/services/flow-test-runner";
import { cn } from "@/lib/utils";

type ConfigProps = Omit<NodeConfigProps, "nodeId" | "nodeType" | "config" | "onChange" | "onDelete" | "onRunStep" | "runningStep" | "triggerKind">;

/**
 * Rich per-node editor — n8n-style. Three resizable columns:
 *
 *   ┌──────────────┬─────────────────────────┬──────────────┐
 *   │   INPUT      │   FORM (node config)    │   OUTPUT     │
 *   │              │                         │              │
 *   │ upstream     │ existing NodeConfig     │ this node's  │
 *   │ node(s) JSON │ form for this node      │ last run     │
 *   └──────────────┴─────────────────────────┴──────────────┘
 *
 * Opens on double-click of a canvas node. The "Run this step" button at the
 * top-right re-uses the existing flow runner pipeline. Closing the modal
 * persists nothing extra — the parent flow-editor's setNodes already
 * captures every config change through onConfigChange.
 */
export function NodeModal({
  open,
  onOpenChange,
  selectedNode,
  nodes,
  edges,
  lastTestRun,
  onConfigChange,
  onDelete,
  onRunStep,
  runningStep,
  configProps,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedNode: Node | undefined;
  nodes: Node[];
  edges: Edge[];
  lastTestRun: TestRunResult | null;
  onConfigChange: (cfg: Record<string, unknown>) => void;
  onDelete?: () => void;
  onRunStep?: () => void;
  runningStep: boolean;
  configProps: ConfigProps;
}) {
  if (!selectedNode) return null;
  const data = selectedNode.data as Record<string, unknown>;
  const type = (data.type as string) ?? "";
  const cat = findCatalog(type);
  const label = (data.label as string) ?? type;
  const isTrigger = !!data.isTrigger;

  // Upstream node(s): every node connected into this one via an edge. Show
  // their latest output side-by-side so the user knows what shape they're
  // mapping from.
  const upstreamIds = React.useMemo(
    () => edges.filter((e) => e.target === selectedNode.id).map((e) => e.source),
    [edges, selectedNode.id]
  );
  const upstreamNodes = React.useMemo(
    () => upstreamIds.map((id) => nodes.find((n) => n.id === id)).filter(Boolean) as Node[],
    [upstreamIds, nodes]
  );
  const upstreamOutputs = React.useMemo(
    () =>
      upstreamNodes.map((n) => ({
        node: n,
        output: lastTestRun?.nodes.find((r) => r.nodeId === n.id)?.output,
        status: lastTestRun?.nodes.find((r) => r.nodeId === n.id)?.status,
      })),
    [upstreamNodes, lastTestRun]
  );

  const thisOutput = lastTestRun?.nodes.find((r) => r.nodeId === selectedNode.id);

  // The button label mirrors what NodeConfig already uses, but we render the
  // button here at the modal header level instead of inside the form.
  const runLabel =
    type === "s3.objectCreated"
      ? "Pull from S3"
      : isTrigger
      ? "Test this trigger"
      : "Run this step";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          // Wide modal: 95vw on small screens, capped at 1400px on large.
          className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 flex flex-col w-[95vw] max-w-[1400px] h-[88vh] bg-background border rounded-lg shadow-2xl"
          onPointerDownOutside={(e) => {
            // Don't close when the user drags off a panel resize handle.
            if ((e.target as HTMLElement)?.closest("[data-resize-handle]")) {
              e.preventDefault();
            }
          }}
        >
          {/* a11y title: required by Radix even when visually de-emphasized. */}
          <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>

          <header className="flex items-center gap-3 px-4 py-2.5 border-b">
            {cat?.icon && (
              <cat.icon className={cn("h-4 w-4 shrink-0", `text-${cat.accent}-600`)} />
            )}
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate">{label}</div>
              <div className="text-[10px] text-muted-foreground truncate">
                <span className="font-mono">{selectedNode.id}</span>
                <span className="mx-1">·</span>
                {type}
              </div>
            </div>
            {onRunStep && (
              <Button variant="outline" size="sm" onClick={onRunStep} disabled={runningStep}>
                {runningStep ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                {runLabel}
              </Button>
            )}
            {onDelete && !isTrigger && (
              <Button variant="ghost" size="sm" className="text-destructive" onClick={onDelete} title="Remove this node">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </DialogPrimitive.Close>
          </header>

          <div className="flex-1 min-h-0">
            <Group orientation="horizontal" className="h-full flex">
              {/* INPUT */}
              <Panel defaultSize={28} minSize={15}>
                <SidePanel title="Input" subtitle="From upstream node(s)">
                  {isTrigger ? (
                    <p className="text-xs text-muted-foreground">
                      Triggers are entry points — they don&apos;t receive data from upstream.
                    </p>
                  ) : upstreamOutputs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Nothing connected into this node yet. Wire an upstream node first.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {upstreamOutputs.map(({ node, output, status }) => (
                        <UpstreamCard
                          key={node.id}
                          nodeId={node.id}
                          nodeType={(node.data as Record<string, unknown>).type as string}
                          nodeLabel={(node.data as Record<string, unknown>).label as string}
                          output={output}
                          status={status}
                        />
                      ))}
                    </div>
                  )}
                </SidePanel>
              </Panel>
              <ResizeHandle />

              {/* FORM */}
              <Panel defaultSize={44} minSize={25}>
                <div className="h-full overflow-y-auto bg-background">
                  <NodeConfig
                    nodeId={selectedNode.id}
                    nodeType={type}
                    triggerKind={isTrigger ? (type as never) : undefined}
                    config={(data.config as Record<string, unknown>) ?? {}}
                    onChange={onConfigChange}
                    {...configProps}
                  />
                </div>
              </Panel>
              <ResizeHandle />

              {/* OUTPUT */}
              <Panel defaultSize={28} minSize={15}>
                <SidePanel
                  title="Output"
                  subtitle={
                    thisOutput
                      ? `${thisOutput.status} · ${thisOutput.durationMs}ms`
                      : "Run this step to see output"
                  }
                >
                  {!thisOutput ? (
                    <p className="text-xs text-muted-foreground">
                      Click <strong>{runLabel}</strong> above to run this node and see its output.
                    </p>
                  ) : (
                    <OutputView result={thisOutput} />
                  )}
                </SidePanel>
              </Panel>
            </Group>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function ResizeHandle() {
  return (
    <Separator
      data-resize-handle
      className="w-1.5 bg-border hover:bg-primary/30 transition-colors cursor-col-resize"
    />
  );
}

function SidePanel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full flex flex-col bg-muted/20">
      <div className="px-3 py-2 border-b bg-card/50">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
        {subtitle && <div className="text-[10px] text-muted-foreground/80 truncate">{subtitle}</div>}
      </div>
      <div className="flex-1 overflow-auto p-3">{children}</div>
    </div>
  );
}

function UpstreamCard({
  nodeId,
  nodeType,
  nodeLabel,
  output,
  status,
}: {
  nodeId: string;
  nodeType: string;
  nodeLabel?: string;
  output: unknown;
  status?: "success" | "error" | "skipped";
}) {
  return (
    <div className="rounded border bg-background">
      <div className="px-2 py-1.5 border-b flex items-center gap-1.5">
        <span className={cn(
          "h-1.5 w-1.5 rounded-full shrink-0",
          status === "success" ? "bg-emerald-500"
          : status === "error" ? "bg-destructive"
          : status === "skipped" ? "bg-muted-foreground/50"
          : "bg-muted-foreground/30"
        )} />
        <span className="font-medium text-xs truncate">{nodeLabel ?? nodeType}</span>
        <Badge variant="outline" className="text-[9px] ml-auto shrink-0">{nodeType}</Badge>
      </div>
      <div className="p-2">
        {output === undefined ? (
          <p className="text-[11px] text-muted-foreground italic">
            No data — run the upstream node or click <strong>Test run</strong> in the topbar.
          </p>
        ) : (
          <pre className="text-[10px] font-mono leading-snug whitespace-pre">
{JSON.stringify(output, null, 2)}
          </pre>
        )}
        <div className="mt-1 text-[9px] text-muted-foreground">
          Use in this form as <code>{`{{ $node.${nodeId} }}`}</code>
        </div>
      </div>
    </div>
  );
}

type NodeRunResult = NonNullable<TestRunResult["nodes"]>[number];

function OutputView({ result }: { result: NodeRunResult }) {
  // Single scroll: the SidePanel wrapping us already does `overflow-auto`
  // on its content area, so each pre block uses `whitespace-pre` (or
  // `whitespace-pre-wrap` for text) WITHOUT its own max-h / overflow.
  // That stops the "two scrollbars" stacking the user reported.
  return (
    <div className="space-y-3 text-xs">
      {result.errorMessage && (
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-destructive mb-1">Error</div>
          <pre className="bg-destructive/10 text-destructive p-2 rounded whitespace-pre-wrap">
{result.errorMessage}
          </pre>
        </div>
      )}
      {result.logs && result.logs.length > 0 && (
        <details open>
          <summary className="cursor-pointer text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Logs ({result.logs.length})
          </summary>
          <pre className="mt-1 p-2 bg-background rounded border whitespace-pre-wrap">
{result.logs.join("\n")}
          </pre>
        </details>
      )}
      {result.output !== undefined && (
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">Output</div>
          <pre className="p-2 bg-background rounded border whitespace-pre font-mono">
{JSON.stringify(result.output, null, 2)}
          </pre>
        </div>
      )}
      {result.input !== undefined && (
        <details>
          <summary className="cursor-pointer text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Resolved input</summary>
          <pre className="mt-1 p-2 bg-background rounded border whitespace-pre font-mono">
{JSON.stringify(result.input, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
