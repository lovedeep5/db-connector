"use client";
import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ArrowLeft, Globe, Loader2, Lock, Save, Users } from "lucide-react";
import parser from "cron-parser";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createSchedule, updateSchedule } from "@/server/actions/schedules";
import type { Schedule } from "@/components/automations/automations-panel";

const MonacoEditor = dynamic(
  () => import("@/components/query/monaco-editor").then((m) => m.MonacoEditor),
  { ssr: false, loading: () => <div className="text-xs text-muted-foreground p-4">Loading editor…</div> }
);

const CRON_PRESETS = [
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every day · 9:00", value: "0 9 * * *" },
  { label: "Every weekday · 9:00", value: "0 9 * * 1-5" },
  { label: "Every Monday · 8:00", value: "0 8 * * 1" },
  { label: "Every 15 minutes", value: "*/15 * * * *" },
  { label: "First of month · 6:00", value: "0 6 1 * *" },
];

const Schema = z
  .object({
    connectionId: z.string().min(1, "Pick a connection"),
    name: z.string().min(1, "Required").max(120),
    description: z.string().max(2000).optional(),
    statement: z.string().min(1, "Write the query"),
    cronExpression: z.string().min(1, "Required"),
    emailTo: z.string().min(1, "At least one recipient"),
    emailSubject: z.string().max(200).optional(),
    visibility: z.enum(["private", "team", "connection"]),
    sharedWithTeamId: z.string().optional(),
    isActive: z.boolean().optional().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.visibility === "team" && !v.sharedWithTeamId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sharedWithTeamId"], message: "Pick a team" });
    }
  });

type Vals = z.infer<typeof Schema>;

export function ScheduleForm({
  mode,
  connections,
  myTeams,
  schedule,
}: {
  mode: "create" | "edit";
  connections: { id: string; name: string; type: string }[];
  myTeams: { id: string; name: string }[];
  schedule?: Schedule;
}) {
  const router = useRouter();

  const defaults: Vals = schedule
    ? {
        connectionId: schedule.connection?.id ?? "",
        name: schedule.name,
        description: schedule.description ?? "",
        statement: schedule.statement,
        cronExpression: schedule.cronExpression,
        emailTo: schedule.emailTo,
        emailSubject: schedule.emailSubject ?? "",
        visibility: schedule.visibility,
        sharedWithTeamId: schedule.sharedWithTeamId ?? undefined,
        isActive: schedule.isActive,
      }
    : {
        connectionId: connections[0]?.id ?? "",
        name: "",
        description: "",
        statement: "select 1;",
        cronExpression: "0 9 * * *",
        emailTo: "",
        emailSubject: "",
        visibility: "private",
        isActive: true,
      };

  const { register, control, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } =
    useForm<Vals>({ resolver: zodResolver(Schema), defaultValues: defaults });

  const connectionId = watch("connectionId");
  const cronExpression = watch("cronExpression");
  const statement = watch("statement");
  const visibility = watch("visibility");

  const conn = connections.find((c) => c.id === connectionId);
  const language = conn?.type === "mongodb" ? "json" : "sql";

  const cronPreview = React.useMemo(() => {
    try {
      const it = parser.parseExpression(cronExpression);
      return [it.next().toDate(), it.next().toDate(), it.next().toDate()];
    } catch {
      return null;
    }
  }, [cronExpression]);

  const onSubmit = async (vals: Vals) => {
    try {
      if (mode === "edit" && schedule) {
        await updateSchedule(schedule.id, {
          ...vals,
          description: vals.description ?? null,
          emailSubject: vals.emailSubject ?? null,
          sharedWithTeamId: vals.visibility === "team" ? vals.sharedWithTeamId ?? null : null,
        });
        toast.success("Updated");
      } else {
        await createSchedule({
          ...vals,
          description: vals.description ?? null,
          emailSubject: vals.emailSubject ?? null,
          sharedWithTeamId: vals.visibility === "team" ? vals.sharedWithTeamId ?? null : null,
        });
        toast.success("Created");
      }
      router.push("/automations");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Button asChild variant="ghost" size="icon">
            <Link href="/automations"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">
              {mode === "edit" ? "Edit automation" : "New automation"}
            </h1>
            <p className="text-sm text-muted-foreground">
              On schedule, run a query and email the result. The query runs as you, with your permissions.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" type="button">
            <Link href="/automations">Cancel</Link>
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {mode === "edit" ? "Update" : "Create"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Basics</CardTitle>
          <CardDescription>How this automation appears in the list and in emails.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input autoFocus {...register("name")} placeholder="Daily active users" />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Connection</Label>
              <Controller
                control={control}
                name="connectionId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="Pick a database" /></SelectTrigger>
                    <SelectContent>
                      {connections.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name} ({c.type})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.connectionId && <p className="text-xs text-destructive">{errors.connectionId.message}</p>}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Description (optional)</Label>
            <Textarea rows={2} {...register("description")} placeholder="What does this report tell us?" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Query</CardTitle>
          <CardDescription>
            {conn?.type === "mongodb"
              ? "MongoDB JSON command (find, aggregate, count, distinct)."
              : "SQL — runs against the connection as you, with the same access rules as the workbench."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md overflow-hidden h-72">
            <MonacoEditor
              value={statement}
              onChange={(v) => setValue("statement", v, { shouldValidate: true })}
              language={language}
            />
          </div>
          {errors.statement && <p className="text-xs text-destructive mt-2">{errors.statement.message}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schedule &amp; recipients</CardTitle>
          <CardDescription>Cron uses server time. Up to 20 recipients per automation.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Schedule (cron)</Label>
              <Input {...register("cronExpression")} className="font-mono" placeholder="0 9 * * *" />
              <div className="flex flex-wrap gap-1">
                {CRON_PRESETS.map((p) => (
                  <button
                    type="button"
                    key={p.value}
                    onClick={() => setValue("cronExpression", p.value, { shouldValidate: true })}
                    className="text-[10px] px-2 py-0.5 rounded border hover:bg-accent"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {cronPreview ? (
                <p className="text-[11px] text-muted-foreground">
                  Next runs: {cronPreview.map((d) => d.toLocaleString()).join(" · ")}
                </p>
              ) : (
                <p className="text-[11px] text-destructive">Invalid cron expression</p>
              )}
              {errors.cronExpression && <p className="text-xs text-destructive">{errors.cronExpression.message}</p>}
            </div>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Recipients (comma-separated)</Label>
                <Input {...register("emailTo")} placeholder="alice@co.com, bob@co.com" />
                {errors.emailTo && <p className="text-xs text-destructive">{errors.emailTo.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Subject override (optional)</Label>
                <Input {...register("emailSubject")} placeholder={defaults.name || "Defaults to the automation name"} />
              </div>
            </div>
          </div>
          <Badge variant="outline" className="text-[10px]">
            Tip: when the result has &gt; 200 rows the email includes a CSV attachment.
          </Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sharing</CardTitle>
          <CardDescription>Who else can see this automation (recipients still get the email regardless).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Controller
            control={control}
            name="visibility"
            render={({ field }) => (
              <div className="grid gap-2 md:grid-cols-3">
                <VisibilityCard
                  icon={Lock}
                  title="Private"
                  description="Only you"
                  selected={field.value === "private"}
                  onSelect={() => field.onChange("private")}
                />
                <VisibilityCard
                  icon={Users}
                  title="Team"
                  description={myTeams.length === 0 ? "Join a team first" : "Pick a team"}
                  selected={field.value === "team"}
                  onSelect={() => myTeams.length > 0 && field.onChange("team")}
                  disabled={myTeams.length === 0}
                />
                <VisibilityCard
                  icon={Globe}
                  title="Connection-wide"
                  description="Anyone with DB access"
                  selected={field.value === "connection"}
                  onSelect={() => field.onChange("connection")}
                />
              </div>
            )}
          />
          {visibility === "team" && (
            <Controller
              control={control}
              name="sharedWithTeamId"
              render={({ field }) => (
                <Select value={field.value ?? ""} onValueChange={field.onChange}>
                  <SelectTrigger className="max-w-sm"><SelectValue placeholder="Pick a team" /></SelectTrigger>
                  <SelectContent>
                    {myTeams.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          )}
          {errors.sharedWithTeamId && (
            <p className="text-xs text-destructive">{errors.sharedWithTeamId.message}</p>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2 pb-6">
        <Button asChild variant="outline" type="button">
          <Link href="/automations">Cancel</Link>
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {mode === "edit" ? "Update" : "Create"}
        </Button>
      </div>
    </form>
  );
}

function VisibilityCard({
  icon: Icon,
  title,
  description,
  selected,
  onSelect,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={
        "border rounded-md p-3 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed " +
        (selected
          ? "border-primary bg-primary/5 ring-2 ring-primary/30"
          : "border-input hover:bg-accent hover:text-accent-foreground")
      }
    >
      <Icon className="h-4 w-4 mb-1" />
      <div className="font-medium text-sm">{title}</div>
      <div className="text-xs text-muted-foreground">{description}</div>
    </button>
  );
}
