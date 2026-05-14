"use client";
import * as React from "react";
import {
  ReactFlow,
  Background,
  Controls,
  ControlButton,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  Loader2, Save, ArrowLeft, Play, AlertCircle, CheckCircle2,
  PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen,
  Wand2, Maximize2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CanvasNode } from "./canvas-node";
import { DeletableEdge } from "./deletable-edge";
import { NodePalette, NODE_DRAG_TYPE } from "./node-palette";
import { NodeConfig } from "./node-config";
import { findCatalog } from "./node-catalog";
import { applyDagreLayout } from "./auto-layout";
import { createFlow, updateFlow } from "@/server/actions/flows";
import { testRunFlowAction, testRunUpToNodeAction } from "@/server/actions/flow-test";
import type { TestNodeResult, TestRunResult } from "@/server/services/flow-test-runner";
import type { FlowDefinition, FlowNode as DefNode, FlowEdge } from "@/lib/flows/types";
import { isTriggerType, TRIGGER_NODE_TYPES } from "@/lib/flows/types";
import { normalizeFlowDefinition } from "@/lib/flows/definition";
import { buildAvailableRefs } from "./refs-builder";
import { buildJsCodeContextDts } from "./js-code-context";

type Conn = { id: string; name: string; type: string };
type Team = { id: string; name: string };

type FlowMeta = {
  id?: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  visibility: "private" | "team" | "everyone";
  sharedWithTeamId?: string | null;
  executionMode: "sequential" | "parallel";
  maxConcurrentRuns: number;
  defaultNodeTimeoutMs: number;
  webhookSecret?: string | null;
};

const nodeTypes: NodeTypes = { dbcNode: CanvasNode };
const edgeTypes: EdgeTypes = { deletable: DeletableEdge };

export function FlowEditor(props: {
  mode: "create" | "edit";
  flowId?: string;
  initial?: FlowDefinition;
  meta?: FlowMeta;
  connections: Conn[];
  myTeams: Team[];
}) {
  // ReactFlowProvider is required so that `useReactFlow()` works inside the
  // editor (we use it for screen-to-flow coordinate conversion on drop).
  return (
    <ReactFlowProvider>
      <FlowEditorInner {...props} />
    </ReactFlowProvider>
  );
}

function FlowEditorInner({
  mode,
  flowId,
  initial,
  meta: initialMeta,
  connections,
  myTeams,
}: {
  mode: "create" | "edit";
  flowId?: string;
  initial?: FlowDefinition;
  meta?: FlowMeta;
  connections: Conn[];
  myTeams: Team[];
}) {
  const router = useRouter();
  const { screenToFlowPosition, fitView } = useReactFlow();
  // React Flow 12 themes its MiniMap, Controls and edge defaults from this prop.
  // Without it the controls render as bright white tiles on the dark theme.
  const { resolvedTheme } = useTheme();
  const colorMode: "dark" | "light" = resolvedTheme === "dark" ? "dark" : "light";

  // Bring the flow definition into React Flow's node/edge state.
  const [meta, setMeta] = React.useState<FlowMeta>(
    initialMeta ?? {
      name: "Untitled flow",
      description: "",
      isActive: true,
      visibility: "private",
      executionMode: "parallel",
      maxConcurrentRuns: 10,
      defaultNodeTimeoutMs: 60_000,
    }
  );
  // v2: triggers are first-class entries in `nodes`. Normalize any legacy v1
  // definition on load so the editor only deals with one shape.
  const normalizedInitial = React.useMemo(
    () => (initial ? normalizeFlowDefinition(initial) : undefined),
    [initial]
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(defaultNodes(normalizedInitial));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    (normalizedInitial?.edges ?? []).map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourcePort ?? null,
      type: "deletable",
    }))
  );
  // Default selection: the first trigger if any, else nothing.
  const [selectedId, setSelectedId] = React.useState<string | null>(() => {
    const first = (normalizedInitial?.nodes ?? []).find((n) => isTriggerType(n.type));
    return first?.id ?? null;
  });

  // ── Undo / redo ────────────────────────────────────────────────────────
  // History stack snapshotted at structural change boundaries (add / remove
  // node, end-of-drag, edge add/remove). Per-keystroke config edits aren't
  // snapshotted — they're too noisy and are saved explicitly via Save.
  type Snapshot = { nodes: Node[]; edges: Edge[] };
  const history = React.useRef<{ past: Snapshot[]; future: Snapshot[] }>({
    past: [],
    future: [],
  });
  const HISTORY_MAX = 50;
  const captureSnapshot = React.useCallback(() => {
    history.current.past.push({ nodes: [...nodes], edges: [...edges] });
    if (history.current.past.length > HISTORY_MAX) history.current.past.shift();
    history.current.future = [];
  }, [nodes, edges]);
  const undo = React.useCallback(() => {
    const prev = history.current.past.pop();
    if (!prev) return;
    history.current.future.push({ nodes: [...nodes], edges: [...edges] });
    setNodes(prev.nodes);
    setEdges(prev.edges);
  }, [nodes, edges, setNodes, setEdges]);
  const redo = React.useCallback(() => {
    const next = history.current.future.pop();
    if (!next) return;
    history.current.past.push({ nodes: [...nodes], edges: [...edges] });
    setNodes(next.nodes);
    setEdges(next.edges);
  }, [nodes, edges, setNodes, setEdges]);
  // Select-every-node helper, used by Ctrl+A.
  const selectAll = React.useCallback(() => {
    setNodes((ns) => ns.map((n) => (n.selected ? n : { ...n, selected: true })));
    setEdges((es) => es.map((e) => (e.selected ? e : { ...e, selected: true })));
  }, [setNodes, setEdges]);
  const [lastTestRun, setLastTestRun] = React.useState<TestRunResult | null>(null);
  const [paletteOpen, setPaletteOpen] = React.useState(true);
  const [inspectorOpen, setInspectorOpen] = React.useState(true);
  // Lifted up here so the `lastTestRun`/`runningNodeId` sync effect below
  // sees it. Set by the streaming test runner.
  const [runningNodeId, setRunningNodeId] = React.useState<string | null>(null);

  const handleConnect = React.useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return;
      setEdges((es) =>
        addEdge({ ...c, id: `e_${c.source}_${c.target}_${Date.now()}`, type: "deletable" }, es)
      );
    },
    [setEdges]
  );

  const handleNodesChange = React.useCallback(
    (changes: NodeChange[]) => {
      // Snapshot history before applying any structural change. We treat
      // `add` / `remove` / drag-stop as structural; `position` mid-drag and
      // pure `select` changes are too chatty to record.
      const structural = changes.some(
        (c) =>
          c.type === "add" ||
          c.type === "remove" ||
          (c.type === "position" && c.dragging === false)
      );
      if (structural) captureSnapshot();
      onNodesChange(changes);
    },
    [onNodesChange, captureSnapshot]
  );

  // Edge add/remove also goes into the undo history.
  const handleEdgesChange = React.useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      const structural = changes.some((c) => c.type === "add" || c.type === "remove");
      if (structural) captureSnapshot();
      onEdgesChange(changes);
    },
    [onEdgesChange, captureSnapshot]
  );

  // Global key handler for Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z / Ctrl+A. We skip
  // when focus is inside a form field so Monaco / inputs keep their own
  // semantics (Ctrl+A in a textarea selects text, not canvas nodes).
  React.useEffect(() => {
    const isEditable = (el: EventTarget | null): boolean => {
      if (!el || !(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (el.isContentEditable) return true;
      // Monaco's textarea is buried inside .monaco-editor — bail for any
      // descendant of one.
      return !!el.closest(".monaco-editor");
    };
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        redo();
      } else if (k === "a") {
        e.preventDefault();
        selectAll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, selectAll]);

  // Re-arrange every node into a clean left-to-right DAG layout via Dagre.
  // Multi-port nodes (if/else, loop) untangle automatically because dagre
  // only cares about source→target relationships, not port semantics.
  // Then refit so the new layout fills the viewport.
  const handleBeautify = React.useCallback(() => {
    setNodes((current) => applyDagreLayout(current, edges, { direction: "LR" }));
    // Defer fitView until after React paints the new positions.
    setTimeout(() => fitView({ padding: 0.2, duration: 250 }), 50);
  }, [edges, setNodes, fitView]);

  const handleFitAll = React.useCallback(() => {
    fitView({ padding: 0.2, duration: 250 });
  }, [fitView]);

  // ── Drag-and-drop from palette to canvas ────────────────────────────
  const onDragOver = React.useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(NODE_DRAG_TYPE)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  }, []);

  const onDrop = React.useCallback(
    (e: React.DragEvent) => {
      const type = e.dataTransfer.getData(NODE_DRAG_TYPE);
      if (!type) return;
      e.preventDefault();
      const cat = findCatalog(type);
      if (!cat) return;
      // Triggers and action nodes both add to the canvas. v2: triggers are
      // first-class members of `nodes[]` — drop a second trigger to add an
      // alternate entry point (e.g. schedule + webhook on the same flow).
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const id = `${type.replace(/\W/g, "_")}_${Math.random().toString(36).slice(2, 7)}`;
      setNodes((ns) => [
        ...ns,
        {
          id,
          type: "dbcNode",
          position,
          data: {
            label: cat.label,
            type,
            isTrigger: cat.isTrigger ?? false,
            config: defaultConfigFor(type),
          },
        },
      ]);
      setSelectedId(id);
    },
    [screenToFlowPosition, setNodes]
  );

  const addNode = (type: string) => {
    const cat = findCatalog(type);
    if (!cat) return;
    const id = `${type.replace(/\W/g, "_")}_${Math.random().toString(36).slice(2, 7)}`;
    // Triggers default to the left edge so they look like entry points;
    // actions cascade further right.
    const triggerCount = nodes.filter(
      (n) => isTriggerType(((n.data as Record<string, unknown>).type as string) ?? "")
    ).length;
    const position = cat.isTrigger
      ? { x: 80, y: 160 + triggerCount * 100 }
      : { x: 280 + (nodes.length - 1) * 240, y: 160 + ((nodes.length - 1) % 3) * 80 };
    setNodes((ns) => [
      ...ns,
      {
        id,
        type: "dbcNode",
        position,
        data: {
          label: cat.label,
          type,
          isTrigger: cat.isTrigger ?? false,
          config: defaultConfigFor(type),
        },
      },
    ]);
    setSelectedId(id);
  };

  const selectedNode = nodes.find((n) => n.id === selectedId);
  // True when the currently-selected node is a trigger node (v2: triggers
  // live in `nodes[]`). Used by the Inspector to render trigger config forms
  // and by the OutputPanel to suppress run results for entry points.
  const selectedTrigger = !!selectedNode && isTriggerType(
    ((selectedNode.data as Record<string, unknown>).type as string) ?? ""
  );

  const onConfigChange = (cfg: Record<string, unknown>) => {
    if (!selectedNode) return;
    setNodes((ns) =>
      ns.map((n) =>
        n.id === selectedNode.id
          ? { ...n, data: { ...n.data, config: cfg, summary: summarise(n.data.type as string, cfg) } }
          : n
      )
    );
  };

  const onDeleteSelected = () => {
    if (!selectedNode) return;
    setNodes((ns) => ns.filter((n) => n.id !== selectedNode.id));
    setEdges((es) => es.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
    setSelectedId(null);
  };

  // Canvas nodes get a `lastRunStatus` annotation when a test run completes,
  // and an `isRunning` flag during a live stream so they can pulse/spinner
  // while their step is executing on the server.
  React.useEffect(() => {
    setNodes((ns) =>
      ns.map((n) => {
        const r = lastTestRun?.nodes.find((x) => x.nodeId === n.id);
        const isRunning = runningNodeId === n.id;
        return { ...n, data: { ...n.data, lastRunStatus: r?.status, isRunning } };
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastTestRun, runningNodeId]);

  const currentDefinition = React.useCallback<() => FlowDefinition>(() => ({
    version: 2,
    nodes: nodes.map<DefNode>((n) => ({
      id: n.id,
      type: (n.data as Record<string, unknown>).type as string,
      config: ((n.data as Record<string, unknown>).config as Record<string, unknown>) ?? {},
      position: n.position,
    })),
    edges: edges.map<FlowEdge>((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourcePort: e.sourceHandle ?? undefined,
    })),
  }), [nodes, edges]);

  // ── Save ────────────────────────────────────────────────────────────
  const [saving, setSaving] = React.useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const def = currentDefinition();
      if (mode === "create") {
        const newId = await createFlow({ ...meta, definition: def });
        toast.success("Flow created");
        router.push(`/flows/${newId}/edit`);
      } else if (flowId) {
        await updateFlow(flowId, { ...meta, definition: def });
        toast.success("Updated");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // ── Test run (no persistence) ───────────────────────────────────────
  const [testing, setTesting] = React.useState(false);
  // runningNodeId is declared near the top of this component so the
  // node-data sync effect can see it.
  const testRun = async () => {
    // Need at least one non-trigger node to have something to run.
    const hasActions = nodes.some((n) => {
      const t = ((n.data as Record<string, unknown>).type as string) ?? "";
      return t && !isTriggerType(t);
    });
    if (!hasActions) {
      toast.error("Add a trigger and at least one action before running");
      return;
    }
    setTesting(true);
    setRunningNodeId(null);
    // Clear stale per-node statuses before a fresh run so the user sees the
    // live progression rather than the previous run's ring colors.
    setLastTestRun(null);
    try {
      await runTestStream(
        { definition: currentDefinition(), defaultNodeTimeoutMs: meta.defaultNodeTimeoutMs },
        {
          onStart: (id) => setRunningNodeId(id),
          onEnd: () => setRunningNodeId(null),
          onDone: (result) => {
            setLastTestRun(result);
            if (result.status === "success") {
              toast.success(`Test run OK · ${result.durationMs}ms`);
            } else {
              toast.error(`Test failed: ${result.errorMessage ?? "unknown error"}`);
              const failed = result.nodes.find((n) => n.status === "error");
              if (failed) setSelectedId(failed.nodeId);
            }
          },
        }
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTesting(false);
      setRunningNodeId(null);
    }
  };

  // Step-level test run. Two modes share one button:
  //   - Action node  → "Run this step"  : run target + its ancestors only.
  //   - Trigger node → "Test this trigger" : fire the run as if THIS trigger
  //     activated. S3 triggers poll the bucket for real so the user gets
  //     to see whether their credentials / prefix actually find anything.
  const [steppingId, setSteppingId] = React.useState<string | null>(null);
  const runStep = async () => {
    if (!selectedNode) return;
    setSteppingId(selectedNode.id);
    setRunningNodeId(null);
    setLastTestRun(null);
    try {
      const body = selectedTrigger
        ? {
            definition: currentDefinition(),
            defaultNodeTimeoutMs: meta.defaultNodeTimeoutMs,
            entryTriggerId: selectedNode.id,
          }
        : {
            definition: currentDefinition(),
            defaultNodeTimeoutMs: meta.defaultNodeTimeoutMs,
            targetNodeId: selectedNode.id,
          };
      await runTestStream(body, {
        onStart: (id) => setRunningNodeId(id),
        onEnd: () => setRunningNodeId(null),
        onDone: (result) => {
          setLastTestRun(result);
          if (result.status === "success") {
            toast.success(
              selectedTrigger
                ? `Trigger fired OK · ${result.durationMs}ms`
                : `Step "${selectedNode.id}" ran OK · ${result.durationMs}ms`
            );
          } else {
            toast.error(`Failed: ${result.errorMessage ?? "unknown error"}`);
            const failed = result.nodes.find((n) => n.status === "error");
            if (failed) setSelectedId(failed.nodeId);
          }
        },
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSteppingId(null);
      setRunningNodeId(null);
    }
  };

  // Available references for the selected node — recomputed when the canvas,
  // selection, or test-run output changes.
  const availableRefs = React.useMemo(
    () =>
      buildAvailableRefs({
        definition: currentDefinition(),
        selectedNodeId: selectedTrigger ? null : selectedNode?.id ?? null,
        lastTestRun,
      }),
    [currentDefinition, selectedNode, selectedTrigger, lastTestRun]
  );

  // TS declarations for the JS Code node's Monaco editor. Built from the last
  // test run so autocomplete shows real upstream fields (rows, site, etc.)
  // instead of just the identifiers Monaco sees in the file.
  const jsCodeContextDts = React.useMemo(() => {
    const isJsCode =
      !!selectedNode &&
      (selectedNode.data as Record<string, unknown>).type === "code.js";
    if (!isJsCode) return undefined;
    return buildJsCodeContextDts(selectedNode!.id, currentDefinition(), lastTestRun);
  }, [selectedNode, currentDefinition, lastTestRun]);

  return (
    <div className="flex flex-col h-full">
      <Header
        meta={meta}
        setMeta={setMeta}
        onBack={() => router.push("/flows")}
        onSave={save}
        saving={saving}
        onTestRun={testRun}
        testing={testing}
        lastTestRun={lastTestRun}
      />

      <div className="flex flex-1 overflow-hidden">
        {paletteOpen ? (
          <aside className="w-52 border-r flex flex-col bg-card/40">
            <div className="flex items-center justify-between px-2 py-1.5 border-b">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Nodes</span>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() => setPaletteOpen(false)}
                title="Collapse"
              >
                <PanelLeftClose className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <NodePalette onAdd={addNode} />
            </div>
          </aside>
        ) : (
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="w-7 border-r bg-card/40 flex flex-col items-center pt-2 gap-2 hover:bg-accent"
            title="Show node palette"
          >
            <PanelLeftOpen className="h-3.5 w-3.5" />
            <span className="text-[9px] text-muted-foreground [writing-mode:vertical-rl] rotate-180">Nodes</span>
          </button>
        )}

        <div className="flex-1 min-w-0" onDragOver={onDragOver} onDrop={onDrop}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            onNodeClick={(_e, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={{ type: "deletable" }}
            colorMode={colorMode}
            fitView
            proOptions={{ hideAttribution: true }}
            // Space-pan disabled because it conflicted with Monaco typing
            // in the Inspector. Only Delete deletes (not Backspace) for the
            // same reason — backspace stays a normal text edit everywhere.
            panActivationKeyCode={null}
            deleteKeyCode={"Delete"}
            // Pan = plain left-click drag (default). Rubber-band multi-
            // select = Shift + drag (React Flow's default `selectionKeyCode`
            // is "Shift"). This is the Figma/n8n convention people expect.
          >
            <Background gap={20} size={1} />
            <MiniMap pannable zoomable />
            <Controls>
              <ControlButton onClick={handleBeautify} title="Auto-layout (Beautify)">
                <Wand2 />
              </ControlButton>
              <ControlButton onClick={handleFitAll} title="Fit all nodes in view">
                <Maximize2 />
              </ControlButton>
            </Controls>
          </ReactFlow>
        </div>

        {!inspectorOpen && (
          <button
            type="button"
            onClick={() => setInspectorOpen(true)}
            className="w-7 border-l bg-card/40 flex flex-col items-center pt-2 gap-2 hover:bg-accent"
            title="Show inspector"
          >
            <PanelRightOpen className="h-3.5 w-3.5" />
            <span className="text-[9px] text-muted-foreground [writing-mode:vertical-rl] rotate-180">Inspector</span>
          </button>
        )}
        {inspectorOpen && (
        <aside className="w-80 border-l flex flex-col bg-card/40">
          <Tabs defaultValue="config" className="h-full flex flex-col">
            <div className="flex items-center justify-between px-2 pt-2">
              <TabsList>
                <TabsTrigger value="config">Inspector</TabsTrigger>
                <TabsTrigger value="output">Output</TabsTrigger>
                <TabsTrigger value="settings">Settings</TabsTrigger>
              </TabsList>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() => setInspectorOpen(false)}
                title="Collapse"
              >
                <PanelRightClose className="h-3.5 w-3.5" />
              </Button>
            </div>
            <TabsContent value="config" className="flex-1 overflow-y-auto m-0">
              {selectedNode ? (
                <NodeConfig
                  nodeId={selectedNode.id}
                  nodeType={(selectedNode.data as Record<string, unknown>).type as string}
                  // Triggers and action nodes both use NodeConfig; `triggerKind`
                  // when set tells the form to render the trigger config UI.
                  triggerKind={
                    selectedTrigger
                      ? (((selectedNode.data as Record<string, unknown>).type as string) as never)
                      : undefined
                  }
                  config={((selectedNode.data as Record<string, unknown>).config as Record<string, unknown>) ?? {}}
                  onChange={onConfigChange}
                  onDelete={onDeleteSelected}
                  connections={connections}
                  availableRefs={availableRefs}
                  onRunStep={runStep}
                  runningStep={steppingId === selectedNode.id}
                  jsCodeContextDts={jsCodeContextDts}
                  flowId={flowId}
                />
              ) : (
                <div className="p-4 text-sm text-muted-foreground">
                  Drag a node from the palette to start. Begin with a trigger (Schedule, Manual,
                  Webhook, S3) so the flow knows when to run.
                </div>
              )}
            </TabsContent>
            <TabsContent value="output" className="m-0 p-4 flex-1 overflow-y-auto">
              <OutputPanel
                selectedNodeId={selectedNode?.id ?? null}
                result={lastTestRun}
                onSelectNode={setSelectedId}
              />
            </TabsContent>
            <TabsContent value="settings" className="m-0 p-4 flex-1 overflow-y-auto">
              <SettingsForm meta={meta} setMeta={setMeta} myTeams={myTeams} />
            </TabsContent>
          </Tabs>
        </aside>
        )}
      </div>
    </div>
  );
}

function Header({
  meta, setMeta, onBack, onSave, saving, onTestRun, testing, lastTestRun,
}: {
  meta: FlowMeta;
  setMeta: (m: FlowMeta) => void;
  onBack: () => void;
  onSave: () => void;
  saving: boolean;
  onTestRun: () => void;
  testing: boolean;
  lastTestRun: TestRunResult | null;
}) {
  return (
    <div className="border-b p-3 flex items-center gap-3 bg-card/40">
      <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
      <Input
        value={meta.name}
        onChange={(e) => setMeta({ ...meta, name: e.target.value })}
        className="max-w-md font-medium"
        placeholder="Flow name"
      />
      <Badge variant={meta.isActive ? "success" : "secondary"} className="text-[10px]">
        {meta.isActive ? "active" : "paused"}
      </Badge>
      {lastTestRun && (
        <Badge variant={lastTestRun.status === "success" ? "success" : "destructive"} className="gap-1">
          {lastTestRun.status === "success" ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
          test {lastTestRun.status} · {lastTestRun.durationMs}ms
        </Badge>
      )}
      <div className="flex-1" />
      <Button variant="outline" onClick={onTestRun} disabled={testing}>
        {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Test run
      </Button>
      <Button onClick={onSave} disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
      </Button>
    </div>
  );
}

function OutputPanel({
  selectedNodeId,
  result,
  onSelectNode,
}: {
  selectedNodeId: string | null;
  result: TestRunResult | null;
  onSelectNode?: (id: string) => void;
}) {
  if (!result) {
    return <p className="text-sm text-muted-foreground">Run the flow with <strong>Test run</strong> to see per-node output here.</p>;
  }
  if (!selectedNodeId) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-muted-foreground">Click any row below (or a node on the canvas) to see its result.</p>
        <ul className="space-y-1 mt-3">
          {result.nodes.map((n) => (
            <li key={n.nodeId}>
              <button
                type="button"
                onClick={() => onSelectNode?.(n.nodeId)}
                className="w-full flex items-center gap-2 text-xs rounded px-2 py-1 hover:bg-accent transition-colors text-left"
                disabled={!onSelectNode}
              >
                <StatusDot status={n.status} />
                <span className="font-mono truncate">{n.nodeId}</span>
                <span className="text-muted-foreground truncate">{n.nodeType}</span>
                <span className="text-muted-foreground ml-auto shrink-0">{n.durationMs}ms</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const nodeResult = result.nodes.find((n) => n.nodeId === selectedNodeId);
  if (!nodeResult) {
    return <p className="text-xs text-muted-foreground">This node hasn&apos;t run yet (the flow stopped before reaching it).</p>;
  }
  return <NodeRunDetail r={nodeResult} />;
}

function NodeRunDetail({ r }: { r: TestNodeResult }) {
  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center gap-2">
        <StatusDot status={r.status} />
        <span className="font-mono">{r.nodeId}</span>
        <Badge variant="outline" className="text-[10px]">{r.nodeType}</Badge>
        <span className="text-muted-foreground ml-auto">{r.durationMs}ms</span>
      </div>
      {r.errorMessage && (
        <pre className="bg-destructive/10 text-destructive p-2 rounded whitespace-pre-wrap max-h-48 overflow-auto">{r.errorMessage}</pre>
      )}
      {r.logs && r.logs.length > 0 && (
        <details open>
          <summary className="cursor-pointer text-muted-foreground">logs ({r.logs.length})</summary>
          <pre className="mt-1 p-2 bg-muted rounded overflow-auto whitespace-pre-wrap max-h-64">{r.logs.join("\n")}</pre>
        </details>
      )}
      {r.input !== undefined && (
        <details>
          <summary className="cursor-pointer text-muted-foreground">input</summary>
          <pre className="mt-1 p-2 bg-muted rounded overflow-auto whitespace-pre max-h-80">{JSON.stringify(r.input, null, 2)}</pre>
        </details>
      )}
      {r.output !== undefined && (
        <details open>
          <summary className="cursor-pointer text-muted-foreground">output</summary>
          <pre className="mt-1 p-2 bg-muted rounded overflow-auto whitespace-pre max-h-96">{JSON.stringify(r.output, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: "success" | "error" | "skipped" }) {
  if (status === "success") return <span className="h-2 w-2 rounded-full bg-emerald-500" />;
  if (status === "error") return <span className="h-2 w-2 rounded-full bg-destructive" />;
  return <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />;
}

function SettingsForm({
  meta, setMeta, myTeams,
}: {
  meta: FlowMeta;
  setMeta: (m: FlowMeta) => void;
  myTeams: Team[];
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>Description</Label>
        <Textarea rows={2} value={meta.description ?? ""} onChange={(e) => setMeta({ ...meta, description: e.target.value })} />
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={meta.isActive} onCheckedChange={(v) => setMeta({ ...meta, isActive: v })} />
        <Label>Active</Label>
      </div>

      <div className="space-y-1">
        <Label>Execution mode</Label>
        <Select value={meta.executionMode} onValueChange={(v) => setMeta({ ...meta, executionMode: v as "parallel" | "sequential" })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="parallel">Parallel — up to N runs at once</SelectItem>
            <SelectItem value="sequential">Sequential — only one run at a time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Max concurrent runs</Label>
          <Input
            type="number"
            value={meta.maxConcurrentRuns}
            disabled={meta.executionMode === "sequential"}
            onChange={(e) => setMeta({ ...meta, maxConcurrentRuns: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-1">
          <Label>Default node timeout (ms)</Label>
          <Input
            type="number"
            value={meta.defaultNodeTimeoutMs}
            onChange={(e) => setMeta({ ...meta, defaultNodeTimeoutMs: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label>Visibility</Label>
        <Select value={meta.visibility} onValueChange={(v) => setMeta({ ...meta, visibility: v as FlowMeta["visibility"] })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="private">Private — only you</SelectItem>
            <SelectItem value="team" disabled={myTeams.length === 0}>Share with a team</SelectItem>
            <SelectItem value="everyone">Everyone in the workspace</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {meta.visibility === "team" && (
        <div className="space-y-1">
          <Label>Team</Label>
          <Select value={meta.sharedWithTeamId ?? ""} onValueChange={(v) => setMeta({ ...meta, sharedWithTeamId: v })}>
            <SelectTrigger><SelectValue placeholder="Pick a team" /></SelectTrigger>
            <SelectContent>
              {myTeams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────

function defaultNodes(def?: FlowDefinition): Node[] {
  // v2: triggers live in `def.nodes` like any other node. The caller is
  // responsible for normalizing v1 → v2 via `normalizeFlowDefinition` before
  // passing the definition in.
  if (!def?.nodes?.length) return [];
  return def.nodes.map((n) => ({
    id: n.id,
    type: "dbcNode",
    position: n.position ?? { x: 280, y: 160 },
    data: {
      label: findCatalog(n.type)?.label ?? n.type,
      type: n.type,
      isTrigger: TRIGGER_NODE_TYPES.includes(n.type as never),
      config: n.config,
      summary: summarise(n.type, n.config),
    },
  }));
}

/**
 * POSTs the flow definition to /api/flows/test-stream and reads the NDJSON
 * response, dispatching `nodeStart`, `nodeEnd` and `done` events to the
 * caller. Each chunk is one JSON line.
 */
async function runTestStream(
  body: {
    definition: FlowDefinition;
    defaultNodeTimeoutMs?: number;
    targetNodeId?: string;
    /** Fire as if this trigger node activated. Mutually exclusive with targetNodeId. */
    entryTriggerId?: string;
  },
  handlers: {
    onStart: (nodeId: string) => void;
    onEnd: (nodeId: string) => void;
    onDone: (result: TestRunResult) => void;
  }
) {
  const res = await fetch("/api/flows/test-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Stream failed: ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  // NDJSON: one event per line. The trailing partial line stays in `buf`
  // until the next chunk completes it.
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line) continue;
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      const e = event as { type?: string; nodeId?: string; result?: unknown; message?: string };
      if (e.type === "nodeStart" && e.nodeId) handlers.onStart(e.nodeId);
      else if (e.type === "nodeEnd") {
        const r = e.result as { nodeId?: string } | undefined;
        if (r?.nodeId) handlers.onEnd(r.nodeId);
      } else if (e.type === "done") {
        handlers.onDone(e.result as TestRunResult);
      } else if (e.type === "fatal") {
        throw new Error(e.message ?? "Test run failed");
      }
    }
  }
}

function defaultConfigFor(type: string): Record<string, unknown> {
  switch (type) {
    case "db.query": return { connectionId: "", statement: "select 1;" };
    case "http.request": return { method: "GET", url: "https://api.example.com/", parseJson: true };
    case "email.send": return { to: "", subject: "Report", html: "<p>Hi,</p>" };
    case "transform.toFile": return { filename: "report", format: "csv" };
    case "code.js": return { code: "return $input;", timeoutMs: 30_000 };
    case "control.ifElse": return { expression: "$input.rowCount > 0", timeoutMs: 5_000 };
    case "transform.filter": return { predicate: "$item.active === true", timeoutMs: 10_000 };
    case "transform.setVariable": return { name: "myVar", value: "" };
    case "transform.extractPath": return { path: "body" };
    case "control.delay": return { durationMs: 1_000 };
    case "io.downloadFile": return {
      url: "https://example.com/data.csv",
      method: "GET",
      mode: "auto",
      maxBytes: 100 * 1024 * 1024,
      timeoutMs: 60_000,
    };
    default: return {};
  }
}

function summarise(type: string, cfg: Record<string, unknown>): string {
  if (type === "db.query") return (cfg.statement as string ?? "").slice(0, 40);
  if (type === "http.request") return `${cfg.method ?? "GET"} ${(cfg.url as string ?? "").slice(0, 30)}`;
  if (type === "email.send") return `→ ${cfg.to ?? ""}`;
  if (type === "transform.toFile") return `${cfg.filename ?? "report"}.${cfg.format ?? "csv"}`;
  if (type === "code.js") return "JS snippet";
  return "";
}
