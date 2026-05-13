"use client";
import * as React from "react";
import dynamic from "next/dynamic";
import parser from "cron-parser";
import { Loader2, Play, Plus, Trash2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TemplateField, TemplateTextarea } from "./template-field";
import type { RefGroup } from "./ref-picker";

const MonacoEditor = dynamic(
  () => import("@/components/query/monaco-editor").then((m) => m.MonacoEditor),
  { ssr: false, loading: () => <div className="text-xs text-muted-foreground p-2">Loading editor…</div> }
);

type ConnectionOpt = { id: string; name: string; type: string };

export type NodeConfigProps = {
  nodeId: string;
  nodeType: string;
  /** "trigger" or null (regular node) */
  triggerKind?: "schedule" | "manual" | "webhook" | "s3.objectCreated";
  config: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  onDelete?: () => void;
  connections: ConnectionOpt[];
  /** Reference groups for the Insert-ref dropdown (upstream nodes + trigger). */
  availableRefs?: RefGroup[];
  /** Fires the "Run this step" subgraph test. */
  onRunStep?: () => void;
  runningStep?: boolean;
  /**
   * Pre-built TypeScript .d.ts describing the JS Code sandbox ($input, $prev,
   * $node) for this node. Only meaningful when nodeType === "code.js". The
   * flow editor builds this from the last test run so Monaco's autocomplete
   * surfaces real field names instead of generic identifiers.
   */
  jsCodeContextDts?: string;
};

/**
 * Renders the right-side config form for the currently-selected node. We use
 * one component per node type to keep each form short and readable.
 */
export function NodeConfig(props: NodeConfigProps) {
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">Configure</h3>
        <div className="flex items-center gap-1">
          {props.onRunStep && !props.triggerKind && (
            <Button variant="outline" size="sm" onClick={props.onRunStep} disabled={props.runningStep}>
              {props.runningStep ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Run this step
            </Button>
          )}
          {props.onDelete && !props.triggerKind && (
            <Button variant="ghost" size="sm" className="text-destructive" onClick={props.onDelete}>
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </Button>
          )}
        </div>
      </div>
      <Body {...props} />
    </div>
  );
}

function Body(props: NodeConfigProps) {
  const { triggerKind, nodeType } = props;
  if (triggerKind === "schedule") return <ScheduleTriggerForm {...props} />;
  if (triggerKind === "manual") return <ManualTriggerForm />;
  if (triggerKind === "webhook") return <WebhookTriggerForm />;
  if (triggerKind === "s3.objectCreated") return <S3TriggerForm {...props} />;
  if (nodeType === "db.query") return <DbQueryForm {...props} />;
  if (nodeType === "http.request") return <HttpRequestForm {...props} />;
  if (nodeType === "email.send") return <SendEmailForm {...props} />;
  if (nodeType === "transform.toFile") return <ToFileForm {...props} />;
  if (nodeType === "code.js") return <JsCodeForm {...props} />;
  if (nodeType === "control.ifElse") return <IfElseForm {...props} />;
  if (nodeType === "transform.filter") return <FilterForm {...props} />;
  if (nodeType === "transform.setVariable") return <SetVariableForm {...props} />;
  if (nodeType === "transform.extractPath") return <ExtractPathForm {...props} />;
  if (nodeType === "control.delay") return <DelayForm {...props} />;
  if (nodeType === "control.loop") return <LoopForm {...props} />;
  if (nodeType === "control.loopEnd") return <LoopEndForm {...props} />;
  if (nodeType === "io.downloadFile") return <DownloadFileForm {...props} />;
  return <p className="text-xs text-muted-foreground">Unknown node type.</p>;
}

function set(props: NodeConfigProps, key: string, value: unknown) {
  props.onChange({ ...props.config, [key]: value });
}
function get<T>(props: NodeConfigProps, key: string, dflt: T): T {
  const v = props.config[key];
  return (v as T) ?? dflt;
}

// ─── Triggers ─────────────────────────────────────────────────────────

const CRON_PRESETS = [
  { label: "Every hour", value: "0 * * * *" },
  { label: "Daily 9:00", value: "0 9 * * *" },
  { label: "Weekdays 9:00", value: "0 9 * * 1-5" },
  { label: "Every 15 min", value: "*/15 * * * *" },
];

function ScheduleTriggerForm(props: NodeConfigProps) {
  const cron = get(props, "cron", "0 9 * * *");
  const preview = React.useMemo(() => {
    try {
      const it = parser.parseExpression(cron as string);
      return [it.next().toDate(), it.next().toDate()];
    } catch { return null; }
  }, [cron]);
  return (
    <div className="space-y-2">
      <Label>Cron expression (server time)</Label>
      <Input value={cron as string} onChange={(e) => set(props, "cron", e.target.value)} className="font-mono" />
      <div className="flex flex-wrap gap-1">
        {CRON_PRESETS.map((p) => (
          <button key={p.value} type="button"
            onClick={() => set(props, "cron", p.value)}
            className="text-[10px] px-2 py-0.5 rounded border hover:bg-accent">
            {p.label}
          </button>
        ))}
      </div>
      {preview ? (
        <p className="text-[11px] text-muted-foreground">Next: {preview.map((d) => d.toLocaleString()).join(" · ")}</p>
      ) : (
        <p className="text-[11px] text-destructive">Invalid cron expression</p>
      )}
    </div>
  );
}

function ManualTriggerForm() {
  return (
    <p className="text-sm text-muted-foreground">
      This flow runs only when someone clicks <strong>Run now</strong>.
    </p>
  );
}

function WebhookTriggerForm() {
  return (
    <div className="space-y-2 text-sm">
      <p className="text-muted-foreground">
        After saving, an inbound URL is generated. Copy it from the flow detail page and POST to it with your data.
      </p>
      <Badge variant="outline" className="text-[10px]">
        Authentication: per-flow secret in <code>?secret=</code> OR HMAC header <code>X-DBConnector-Signature</code>
      </Badge>
    </div>
  );
}

function S3TriggerForm(props: NodeConfigProps) {
  const s3Conns = props.connections.filter((c) => c.type === "s3");
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">S3 credential</Label>
        <Select value={get(props, "connectionId", "") as string} onValueChange={(v) => set(props, "connectionId", v)}>
          <SelectTrigger><SelectValue placeholder="Pick an S3 credential" /></SelectTrigger>
          <SelectContent>
            {s3Conns.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {s3Conns.length === 0 && (
          <p className="text-[10px] text-muted-foreground">
            No S3 credentials yet. Add one in <strong>Credentials → New credential → AWS S3</strong>.
          </p>
        )}
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Bucket</Label>
        <Input value={get(props, "bucket", "") as string} onChange={(e) => set(props, "bucket", e.target.value)} placeholder="my-bucket" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Prefix (folder, optional)</Label>
          <Input value={get(props, "prefix", "") as string} onChange={(e) => set(props, "prefix", e.target.value)} placeholder="uploads/incoming/" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Suffix (optional)</Label>
          <Input value={get(props, "suffix", "") as string} onChange={(e) => set(props, "suffix", e.target.value)} placeholder=".csv" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Poll interval (seconds)</Label>
          <Input
            type="number"
            min={30}
            max={1800}
            value={get(props, "pollIntervalSec", 60) as number}
            onChange={(e) => set(props, "pollIntervalSec", Math.max(30, Math.min(1800, Number(e.target.value) || 60)))}
          />
          <p className="text-[10px] text-muted-foreground">30–1800. Default 60.</p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Max objects per poll</Label>
          <Input
            type="number"
            min={1}
            max={1000}
            value={get(props, "maxBatch", 50) as number}
            onChange={(e) => set(props, "maxBatch", Math.max(1, Math.min(1000, Number(e.target.value) || 50)))}
          />
          <p className="text-[10px] text-muted-foreground">Backlog spills to next poll.</p>
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">First-poll mode</Label>
        <Select value={get(props, "mode", "skipExisting") as string} onValueChange={(v) => set(props, "mode", v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="skipExisting">Skip existing — only fire for new uploads from now on</SelectItem>
            <SelectItem value="processAll">Process all — backfill every existing object</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="rounded border border-dashed p-2 text-[11px] text-muted-foreground space-y-1">
        <p>Each new object fires the flow once. The trigger payload includes:</p>
        <ul className="ml-3 list-disc space-y-0.5">
          <li><code>{`{{ $trigger.bucket }}`}</code> · <code>{`{{ $trigger.key }}`}</code> · <code>{`{{ $trigger.size }}`}</code></li>
          <li><code>{`{{ $trigger.lastModified }}`}</code> · <code>{`{{ $trigger.etag }}`}</code></li>
          <li><code>{`{{ $trigger.presignedUrl }}`}</code> — drop into the <strong className="text-foreground">Download File</strong> node to fetch it</li>
        </ul>
      </div>
    </div>
  );
}

// ─── Actions ──────────────────────────────────────────────────────────

function DbQueryForm(props: NodeConfigProps) {
  const connectionId = get(props, "connectionId", "");
  const statement = get(props, "statement", "select 1;");
  const dbConns = props.connections.filter((c) => c.type !== "smtp");
  const conn = dbConns.find((c) => c.id === connectionId);
  const lang = conn?.type === "mongodb" ? "json" : "sql";
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Connection</Label>
        <Select value={connectionId as string} onValueChange={(v) => set(props, "connectionId", v)}>
          <SelectTrigger><SelectValue placeholder="Pick a database" /></SelectTrigger>
          <SelectContent>
            {dbConns.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name} ({c.type})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Statement</Label>
        <div className="border rounded h-40 overflow-hidden">
          <MonacoEditor value={statement as string} language={lang} onChange={(v) => set(props, "statement", v)} />
        </div>
        <p className="text-[10px] text-muted-foreground">
          Templates: <code className="font-mono">{`{{ $trigger.body.X }}`}</code>, <code className="font-mono">{`{{ $node.<id>.rows }}`}</code>
        </p>
      </div>
    </div>
  );
}

function HttpRequestForm(props: NodeConfigProps) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Method</Label>
          <Select value={get(props, "method", "GET") as string} onValueChange={(v) => set(props, "method", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-3">
          <TemplateField
            label="URL"
            value={get(props, "url", "") as string}
            onChange={(v) => set(props, "url", v)}
            placeholder="https://api.example.com/x"
            refs={props.availableRefs}
          />
        </div>
      </div>
      <TemplateTextarea
        label="Headers (JSON object, optional)"
        rows={3}
        value={JSON.stringify(get(props, "headers", {}), null, 2)}
        onChange={(v) => {
          try { set(props, "headers", JSON.parse(v || "{}")); } catch { /* keep typing */ }
        }}
        refs={props.availableRefs}
      />
      <TemplateTextarea
        label="Body (JSON or templated string, optional)"
        rows={4}
        value={typeof props.config.body === "string" ? props.config.body : JSON.stringify(get(props, "body", {}), null, 2)}
        onChange={(v) => {
          try { set(props, "body", JSON.parse(v)); } catch { set(props, "body", v); }
        }}
        refs={props.availableRefs}
      />
      <div className="flex items-center gap-2">
        <Switch checked={!!get(props, "parseJson", true)} onCheckedChange={(v) => set(props, "parseJson", v)} />
        <Label className="text-xs">Parse response as JSON</Label>
      </div>
    </div>
  );
}

function SendEmailForm(props: NodeConfigProps) {
  const smtpConnections = props.connections.filter((c) => c.type === "smtp");
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">SMTP connection (optional)</Label>
        <Select
          value={get(props, "smtpConnectionId", "") as string || "__default__"}
          onValueChange={(v) => set(props, "smtpConnectionId", v === "__default__" ? "" : v)}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__default__">Workspace default (Settings → Email)</SelectItem>
            {smtpConnections.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {smtpConnections.length === 0 && (
          <p className="text-[10px] text-muted-foreground">
            No SMTP connections yet. Add one in <strong>Connections → New connection → SMTP</strong> to use a per-flow mail server.
          </p>
        )}
      </div>
      <TemplateField
        label="To (comma-separated)"
        value={get(props, "to", "") as string}
        onChange={(v) => set(props, "to", v)}
        placeholder="alice@co.com, bob@co.com"
        refs={props.availableRefs}
      />
      <TemplateField
        label="Subject"
        value={get(props, "subject", "") as string}
        onChange={(v) => set(props, "subject", v)}
        refs={props.availableRefs}
      />
      <TemplateTextarea
        label="HTML body"
        rows={6}
        value={get(props, "html", "") as string}
        onChange={(v) => set(props, "html", v)}
        placeholder={'<p>Report attached.</p>\n<p>Row count: {{ $node.q1.rowCount }}</p>'}
        refs={props.availableRefs}
      />
      <AttachmentField {...props} />
    </div>
  );
}

function AttachmentField(props: NodeConfigProps) {
  // The form stores `attachment` as a templated string (e.g.
  // "{{ $node.transform_toFile_abc.contentType }}" — except we want the FULL
  // file object, so the user should pick "{{ $node.<id> }}" via Insert ref).
  // Same pattern as Loop's `items` and To File's `rows`: ref in, validate the
  // resolved shape via zod (the send-email schema already expects a FileOutput
  // object). No more "type a node id and we'll wrap it for you" magic.
  const raw = props.config.attachment;
  const valueForField =
    typeof raw === "string"
      ? raw
      : raw == null
        ? ""
        : JSON.stringify(raw);
  return (
    <TemplateField
      label="Attachment (optional)"
      value={valueForField}
      onChange={(v) => set(props, "attachment", v || null)}
      placeholder="{{ $node.transform_toFile_abc123 }}"
      helpText="Reference the file via Insert ref — pick the To File node's whole output, e.g. {{ $node.transform_toFile_abc123 }}. Leave blank for no attachment."
      refs={props.availableRefs}
    />
  );
}

function ToFileForm(props: NodeConfigProps) {
  // The form holds `rows` as a templated string (e.g. "{{ $node.q1.rows }}").
  // The executor resolves the template before the schema validates that the
  // resolved value is an array of objects. Same pattern as the Loop node's
  // Items field — no path-string guessing here.
  const rowsRaw = props.config.rows;
  const rowsForField =
    typeof rowsRaw === "string"
      ? rowsRaw
      : Array.isArray(rowsRaw) && rowsRaw.length === 0
        ? ""
        : JSON.stringify(rowsRaw ?? "");
  return (
    <div className="space-y-3">
      <TemplateField
        label="Rows"
        value={rowsForField}
        onChange={(v) => set(props, "rows", v)}
        placeholder="{{ $node.query_1.rows }}"
        helpText="Reference the upstream array via Insert ref. Examples: {{ $node.query_1.rows }} (DB query), {{ $node.loop_1.results }} (collected from a loop), {{ $node.http_1.body }} (HTTP returning an array)."
        refs={props.availableRefs}
      />
      <TemplateField
        label="Filename (no extension)"
        value={get(props, "filename", "report") as string}
        onChange={(v) => set(props, "filename", v)}
        refs={props.availableRefs}
      />
      <div className="space-y-1">
        <Label className="text-xs">Format</Label>
        <Select value={get(props, "format", "csv") as string} onValueChange={(v) => set(props, "format", v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="csv">CSV</SelectItem>
            <SelectItem value="xlsx">Excel (XLSX)</SelectItem>
            <SelectItem value="json">JSON</SelectItem>
            <SelectItem value="ndjson">NDJSON (one row per line)</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function JsCodeForm(props: NodeConfigProps) {
  return (
    <div className="space-y-2">
      <Label>JS code</Label>
      <div className="border rounded h-56 overflow-hidden">
        <MonacoEditor
          language="javascript"
          value={get(props, "code", "return $input;") as string}
          onChange={(v) => set(props, "code", v)}
          extraTypeDeclarations={props.jsCodeContextDts}
        />
      </div>
      <p className="text-[10px] text-muted-foreground">
        Available: <code>$input</code> (latest output), <code>$prev</code> (Map), <code>$node</code> (by id),
        <code>fetch</code>, <code>console.log</code>. Must <code>return</code> a value. After a test run,
        IntelliSense knows the real shape of <code>$input</code>.
      </p>
      <div className="space-y-1">
        <Label className="text-xs">Timeout (ms)</Label>
        <Input
          type="number"
          value={get(props, "timeoutMs", 30000) as number}
          onChange={(e) => set(props, "timeoutMs", Number(e.target.value))}
        />
      </div>
    </div>
  );
}

// ─── Phase 2A: control flow & transforms ───────────────────────────────

function IfElseForm(props: NodeConfigProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">Condition (JS expression)</Label>
        <div className="border rounded h-32 overflow-hidden">
          <MonacoEditor
            language="javascript"
            value={get(props, "expression", "$input.rowCount > 0") as string}
            onChange={(v) => set(props, "expression", v)}
          />
        </div>
        <p className="text-[10px] text-muted-foreground">
          Truthy → <code>true</code> port fires; falsy → <code>false</code> port fires.
          Use <code>$input</code> or <code>$prev</code>. Connect the two output ports to different branches.
        </p>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Timeout (ms)</Label>
        <Input
          type="number"
          value={get(props, "timeoutMs", 5_000) as number}
          onChange={(e) => set(props, "timeoutMs", Number(e.target.value))}
        />
      </div>
    </div>
  );
}

function FilterForm(props: NodeConfigProps) {
  return (
    <div className="space-y-3">
      <TemplateField
        label="Array path on input (optional)"
        value={get(props, "arrayPath", "") as string}
        onChange={(v) => set(props, "arrayPath", v)}
        placeholder="e.g. rows  or  body.data"
        helpText="Leave blank when the input is already an array or a { rows: [...] } object."
        refs={props.availableRefs}
      />
      <div className="space-y-1">
        <Label className="text-xs">Predicate (JS, runs per item)</Label>
        <div className="border rounded h-32 overflow-hidden">
          <MonacoEditor
            language="javascript"
            value={get(props, "predicate", "$item.active === true") as string}
            onChange={(v) => set(props, "predicate", v)}
          />
        </div>
        <p className="text-[10px] text-muted-foreground">
          Receives <code>$item</code>, <code>$index</code>, <code>$input</code> (whole array). Return truthy to keep.
        </p>
      </div>
    </div>
  );
}

type VarEntry = { name: string; value: unknown };

function SetVariableForm(props: NodeConfigProps) {
  // Normalise legacy { name, value } config into the new `vars` array shape
  // for editing. Schema preprocess does the same on save, so flows created
  // before multi-var support keep working seamlessly.
  const vars = React.useMemo<VarEntry[]>(() => {
    const raw = props.config as Record<string, unknown>;
    if (Array.isArray(raw.vars)) return raw.vars as VarEntry[];
    if (typeof raw.name === "string") return [{ name: raw.name, value: raw.value ?? "" }];
    return [{ name: "myVar", value: "" }];
  }, [props.config]);

  const update = (next: VarEntry[]) => {
    // Strip the legacy `name`/`value` top-level keys when we write `vars`,
    // so the saved JSON stays clean rather than carrying both shapes.
    const cleaned = { ...props.config };
    delete (cleaned as Record<string, unknown>).name;
    delete (cleaned as Record<string, unknown>).value;
    props.onChange({ ...cleaned, vars: next });
  };

  const setOne = (i: number, patch: Partial<VarEntry>) => {
    update(vars.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  };
  const add = () => {
    if (vars.length >= 15) return;
    update([...vars, { name: `var${vars.length + 1}`, value: "" }]);
  };
  const remove = (i: number) => {
    if (vars.length <= 1) return;
    update(vars.filter((_, idx) => idx !== i));
  };

  return (
    <div className="space-y-3">
      {vars.map((v, i) => (
        <div key={i} className="rounded border p-2 space-y-2 bg-muted/30">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Variable {i + 1}
            </span>
            {vars.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-destructive"
                onClick={() => remove(i)}
                aria-label={`Remove variable ${i + 1}`}
                title="Remove this variable"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
          <TemplateField
            label="Name"
            value={v.name}
            onChange={(s) => setOne(i, { name: s })}
            helpText={`Reference later as {{ $node.${props.nodeId}.${v.name || "<name>"} }}`}
          />
          <TemplateField
            label="Value"
            value={typeof v.value === "string" ? v.value : JSON.stringify(v.value ?? "")}
            onChange={(s) => setOne(i, { value: s })}
            placeholder='"hello" or {{ $node.q1.rowCount }}'
            refs={props.availableRefs}
          />
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={add}
          disabled={vars.length >= 15}
          className="h-7 text-xs gap-1"
        >
          <Plus className="h-3 w-3" /> Add variable
        </Button>
        <span className="text-[10px] text-muted-foreground">{vars.length} / 15</span>
      </div>
    </div>
  );
}

function ExtractPathForm(props: NodeConfigProps) {
  return (
    <div className="space-y-3">
      <TemplateField
        label="Path"
        value={get(props, "path", "body") as string}
        onChange={(v) => set(props, "path", v)}
        placeholder="body.data   or   rows[0].email"
        helpText="Dot-path into the latest upstream output. Supports [index] for arrays."
      />
    </div>
  );
}

function LoopForm(props: NodeConfigProps) {
  const batchSize = get(props, "batchSize", 1) as number;
  // The form holds `items` as a templated string (e.g. "{{ $node.q1.rows }}").
  // The executor resolves the template before the schema validates that the
  // resolved value is actually an array.
  const itemsRaw = props.config.items;
  const itemsForField =
    typeof itemsRaw === "string"
      ? itemsRaw
      : Array.isArray(itemsRaw) && itemsRaw.length === 0
        ? ""
        : JSON.stringify(itemsRaw ?? "");
  return (
    <div className="space-y-3">
      <TemplateField
        label="Items"
        value={itemsForField}
        onChange={(v) => set(props, "items", v)}
        placeholder="{{ $node.query_1.rows }}"
        helpText="Reference the upstream array via Insert ref. Examples: {{ $node.query_1.rows }} (DB query), {{ $node.http_1.body }} (HTTP returning an array), {{ $node.http_1.body.data.users }} (nested)."
        refs={props.availableRefs}
      />
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Batch size</Label>
          <Input
            type="number"
            min={1}
            value={batchSize}
            onChange={(e) => set(props, "batchSize", Math.max(1, Number(e.target.value) || 1))}
          />
          <p className="text-[10px] text-muted-foreground">
            1 = one element per iteration. N = group of N.
          </p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Max iterations</Label>
          <Input
            type="number"
            min={1}
            value={get(props, "maxIterations", 1000) as number}
            onChange={(e) => set(props, "maxIterations", Math.max(1, Number(e.target.value) || 1))}
          />
          <p className="text-[10px] text-muted-foreground">Safety cap.</p>
        </div>
      </div>
      <div className="rounded border border-dashed p-2 text-[11px] text-muted-foreground space-y-1">
        <p>
          <strong className="text-foreground">item</strong> port carries the current{" "}
          {batchSize === 1 ? "element" : "batch (array of " + batchSize + ")"}. Body nodes see it the same way they
          see any upstream value:
        </p>
        <ul className="ml-3 list-disc space-y-0.5">
          <li><code>{"$input"}</code> or <code>{`{{ $node.${props.nodeId} }}`}</code> — the {batchSize === 1 ? "element" : "batch"} itself</li>
          <li><code>{`{{ $node.${props.nodeId}.<field> }}`}</code> — a property on it (when {batchSize === 1 ? "the element is an object" : "the batch is an array"})</li>
        </ul>
        <p>Iteration metadata is a separate scope:</p>
        <ul className="ml-3 list-disc space-y-0.5">
          <li><code>{`{{ $loop.index }}`}</code> · <code>.total</code> · <code>.isFirst</code> · <code>.isLast</code></li>
        </ul>
        <p>
          End your body with a <strong className="text-foreground">Loop End</strong> node — whatever feeds into it
          becomes <code>results[i]</code> for that iteration. If you don&apos;t add one, the body&apos;s sole sink is
          used automatically.
        </p>
        <p>
          <strong className="text-foreground">done</strong> port fires once after all iterations:
        </p>
        <ul className="ml-3 list-disc space-y-0.5">
          <li><code>{`{{ $node.${props.nodeId}.results }}`}</code> — array of collected per-iter outputs</li>
          <li><code>{`{{ $node.${props.nodeId}.inputs }}`}</code> · <code>.count</code> · <code>.iterations</code></li>
        </ul>
      </div>
    </div>
  );
}

function LoopEndForm(props: NodeConfigProps) {
  return (
    <div className="space-y-3">
      <TemplateField
        label="Note (optional)"
        value={get(props, "note", "") as string}
        onChange={(v) => set(props, "note", v)}
        placeholder="e.g. happy path, error branch"
        helpText="Shown on the node when you have multiple Loop Ends in a body (one per if/else branch)."
      />
      <div className="rounded border border-dashed p-2 text-[11px] text-muted-foreground space-y-1">
        <p>
          This is a body terminator. The value flowing into Loop End becomes <code>results[i]</code> on the parent
          Loop&apos;s <strong className="text-foreground">done</strong> port for the current iteration.
        </p>
        <p>
          You can have multiple Loop End nodes in a body (one per branch of an if/else, for example). Whichever
          one runs that iteration is the one whose value gets collected.
        </p>
        <p>Loop End has no output — nothing flows past it within an iteration.</p>
      </div>
    </div>
  );
}

function DelayForm(props: NodeConfigProps) {
  return (
    <div className="space-y-2">
      <Label className="text-xs">Duration (milliseconds)</Label>
      <Input
        type="number"
        value={get(props, "durationMs", 1000) as number}
        onChange={(e) => set(props, "durationMs", Number(e.target.value))}
      />
      <p className="text-[10px] text-muted-foreground">Capped at 30 minutes (1 800 000 ms).</p>
    </div>
  );
}

function DownloadFileForm(props: NodeConfigProps) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Method</Label>
          <Select value={get(props, "method", "GET") as string} onValueChange={(v) => set(props, "method", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="GET">GET</SelectItem>
              <SelectItem value="POST">POST</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-3">
          <TemplateField
            label="URL"
            value={get(props, "url", "") as string}
            onChange={(v) => set(props, "url", v)}
            placeholder="https://.../data.csv"
            refs={props.availableRefs}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Mode</Label>
        <Select value={get(props, "mode", "auto") as string} onValueChange={(v) => set(props, "mode", v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto — detect & parse if it&apos;s a table</SelectItem>
            <SelectItem value="parsed">Parsed — fail if not a table</SelectItem>
            <SelectItem value="raw">Raw — never parse</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground">
          Parsed tables also keep the raw bytes — output has both <code>rows</code> and <code>contentBase64</code>.
        </p>
      </div>

      <TemplateField
        label="Filename override (optional)"
        value={get(props, "filenameOverride", "") as string}
        onChange={(v) => set(props, "filenameOverride", v)}
        placeholder="defaults to URL basename"
        refs={props.availableRefs}
      />

      <TemplateTextarea
        label="Headers (JSON object, optional)"
        rows={3}
        value={JSON.stringify(get(props, "headers", {}), null, 2)}
        onChange={(v) => {
          try { set(props, "headers", JSON.parse(v || "{}")); } catch { /* keep typing */ }
        }}
        refs={props.availableRefs}
      />

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Max size (bytes)</Label>
          <Input
            type="number"
            value={get(props, "maxBytes", 100 * 1024 * 1024) as number}
            onChange={(e) => set(props, "maxBytes", Number(e.target.value))}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Timeout (ms)</Label>
          <Input
            type="number"
            value={get(props, "timeoutMs", 60_000) as number}
            onChange={(e) => set(props, "timeoutMs", Number(e.target.value))}
          />
        </div>
      </div>
    </div>
  );
}
