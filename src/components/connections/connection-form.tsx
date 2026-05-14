"use client";
import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Loader2, PlugZap, Save, Lock, Users, Globe } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createConnection, testConfig, updateConnection } from "@/server/actions/connections";

const Schema = z
  .object({
    name: z.string().min(1, "Required"),
    description: z.string().optional(),
    type: z.enum(["postgres", "mysql", "mongodb", "oracle", "smtp", "s3"]),
    visibility: z.enum(["private", "team", "everyone"]).default("private"),
    // SQL fields
    host: z.string().optional(),
    port: z.string().optional(),
    database: z.string().optional(),
    user: z.string().optional(),
    password: z.string().optional(),
    ssl: z.boolean().optional(),
    // Mongo
    url: z.string().optional(),
    // Oracle
    connectString: z.string().optional(),
    // SMTP
    secure: z.boolean().optional(),
    from: z.string().optional(),
    // S3 / S3-compatible object storage
    region: z.string().optional(),
    accessKeyId: z.string().optional(),
    secretAccessKey: z.string().optional(),
    endpoint: z.string().optional(),
    defaultBucket: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    const need = (k: keyof typeof val, msg = "Required") => {
      if (!val[k]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [k], message: msg });
    };
    if (val.type === "postgres" || val.type === "mysql") {
      need("host"); need("port"); need("database"); need("user");
    } else if (val.type === "mongodb") {
      need("url"); need("database");
    } else if (val.type === "oracle") {
      need("connectString"); need("user");
    } else if (val.type === "smtp") {
      need("host"); need("port"); need("from");
    } else if (val.type === "s3") {
      need("region"); need("accessKeyId"); need("secretAccessKey");
    }
  });

type FormValues = z.infer<typeof Schema>;

const DEFAULT_PORTS: Record<string, string> = { postgres: "5432", mysql: "3306", smtp: "587" };

function buildConfig(values: FormValues) {
  switch (values.type) {
    case "postgres":
    case "mysql":
      return {
        type: values.type,
        host: values.host!,
        port: Number(values.port),
        database: values.database!,
        user: values.user!,
        password: values.password ?? "",
        ssl: !!values.ssl,
      };
    case "mongodb":
      return { type: "mongodb" as const, url: values.url!, database: values.database! };
    case "oracle":
      return {
        type: "oracle" as const,
        connectString: values.connectString!,
        user: values.user!,
        password: values.password ?? "",
      };
    case "smtp":
      return {
        type: "smtp" as const,
        host: values.host!,
        port: Number(values.port),
        secure: !!values.secure,
        user: values.user || undefined,
        password: values.password || undefined,
        from: values.from!,
      };
    case "s3":
      return {
        type: "s3" as const,
        region: values.region!,
        accessKeyId: values.accessKeyId!,
        secretAccessKey: values.secretAccessKey!,
        endpoint: values.endpoint || undefined,
        defaultBucket: values.defaultBucket || undefined,
      };
  }
}

export function ConnectionForm({
  canCreateShared,
  editId,
  initial,
}: {
  canCreateShared?: boolean;
  /** When set, the form is in edit mode and submits via `updateConnection`. */
  editId?: string;
  /** Prefill values for edit mode. */
  initial?: Partial<FormValues>;
}) {
  const router = useRouter();
  const {
    register,
    control,
    handleSubmit,
    watch,
    getValues,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: {
      type: "postgres",
      ssl: false,
      port: "5432",
      visibility: "private",
      ...initial,
    },
  });
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<null | { ok: boolean; message?: string; serverVersion?: string }>(null);

  const type = watch("type");

  React.useEffect(() => {
    if (DEFAULT_PORTS[type] && !getValues("port")) setValue("port", DEFAULT_PORTS[type]);
    // For SMTP, force port to 587 when type changes if blank
    if (type === "smtp" && !getValues("port")) setValue("port", "587");
  }, [type, getValues, setValue]);

  const onTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const cfg = buildConfig(getValues());
      const r = await testConfig(cfg);
      setTestResult(r);
      if (r.ok) toast.success("Connection successful");
      else toast.error(r.message ?? "Connection failed");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const onSubmit = async (values: FormValues) => {
    try {
      const payload = {
        name: values.name,
        description: values.description ?? null,
        config: buildConfig(values),
        visibility: values.visibility,
      };
      if (editId) {
        await updateConnection(editId, payload);
        toast.success("Credential updated");
      } else {
        await createConnection(payload);
        toast.success("Credential saved");
      }
      router.push("/credentials");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Basics</CardTitle>
          <CardDescription>How this connection appears in the workspace.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" placeholder="Production DB" {...register("name")} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Controller
                name="type"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="postgres">PostgreSQL</SelectItem>
                      <SelectItem value="mysql">MySQL</SelectItem>
                      <SelectItem value="mongodb">MongoDB</SelectItem>
                      <SelectItem value="oracle">Oracle</SelectItem>
                      <SelectItem value="smtp">SMTP (Email)</SelectItem>
                      <SelectItem value="s3">AWS S3 (Object storage)</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea id="description" rows={2} {...register("description")} />
          </div>
          <div className="space-y-2">
            <Label>Visibility</Label>
            <Controller
              name="visibility"
              control={control}
              render={({ field }) => (
                <div className="grid grid-cols-3 gap-2">
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
                    description={canCreateShared ? "Admin shares via team" : "Admin only"}
                    selected={field.value === "team"}
                    onSelect={() => canCreateShared && field.onChange("team")}
                    disabled={!canCreateShared}
                  />
                  <VisibilityCard
                    icon={Globe}
                    title="Everyone"
                    description={canCreateShared ? "Whole workspace" : "Admin only"}
                    selected={field.value === "everyone"}
                    onSelect={() => canCreateShared && field.onChange("everyone")}
                    disabled={!canCreateShared}
                  />
                </div>
              )}
            />
            <p className="text-[11px] text-muted-foreground">
              {canCreateShared
                ? "Private = only you. Team / Everyone share with others (admins grant team access separately)."
                : "Only admins can create team or everyone-shared connections. Yours will be private."}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Connection details</CardTitle>
          <CardDescription>Encrypted at rest with AES-256-GCM.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(type === "postgres" || type === "mysql") && (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2 md:col-span-2">
                  <Label>Host</Label>
                  <Input placeholder="localhost" {...register("host")} />
                  {errors.host && <p className="text-xs text-destructive">{errors.host.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label>Port</Label>
                  <Input type="number" {...register("port")} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Database</Label>
                <Input {...register("database")} />
                {errors.database && <p className="text-xs text-destructive">{errors.database.message}</p>}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>User</Label>
                  <Input {...register("user")} />
                </div>
                <div className="space-y-2">
                  <Label>Password</Label>
                  <Input type="password" {...register("password")} />
                </div>
              </div>
              <Controller
                name="ssl"
                control={control}
                render={({ field }) => (
                  <div className="flex items-center gap-2">
                    <Switch checked={!!field.value} onCheckedChange={field.onChange} id="ssl" />
                    <Label htmlFor="ssl">Use SSL</Label>
                  </div>
                )}
              />
            </>
          )}

          {type === "mongodb" && (
            <>
              <div className="space-y-2">
                <Label>Connection URL</Label>
                <Input placeholder="mongodb://user:pass@host:27017" {...register("url")} />
                {errors.url && <p className="text-xs text-destructive">{errors.url.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Database</Label>
                <Input {...register("database")} />
              </div>
            </>
          )}

          {type === "oracle" && (
            <>
              <div className="space-y-2">
                <Label>Connect string</Label>
                <Input placeholder="host:1521/service" {...register("connectString")} />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>User</Label>
                  <Input {...register("user")} />
                </div>
                <div className="space-y-2">
                  <Label>Password</Label>
                  <Input type="password" {...register("password")} />
                </div>
              </div>
            </>
          )}

          {type === "smtp" && (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2 md:col-span-2">
                  <Label>SMTP host</Label>
                  <Input placeholder="smtp.your-provider.com" {...register("host")} />
                  {errors.host && <p className="text-xs text-destructive">{errors.host.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label>Port</Label>
                  <Input type="number" {...register("port")} />
                </div>
              </div>
              <Controller
                name="secure"
                control={control}
                render={({ field }) => (
                  <div className="flex items-center gap-2">
                    <Switch checked={!!field.value} onCheckedChange={field.onChange} id="secure" />
                    <Label htmlFor="secure">Use TLS (typical for port 465; 587 uses STARTTLS automatically)</Label>
                  </div>
                )}
              />
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Username (optional)</Label>
                  <Input {...register("user")} />
                </div>
                <div className="space-y-2">
                  <Label>Password</Label>
                  <Input type="password" {...register("password")} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>From address</Label>
                <Input placeholder={`"Reports" <noreply@your.co>`} {...register("from")} />
                {errors.from && <p className="text-xs text-destructive">{errors.from.message}</p>}
              </div>
            </>
          )}

          {type === "s3" && (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>AWS region</Label>
                  <Input placeholder="us-east-1" {...register("region")} />
                  {errors.region && <p className="text-xs text-destructive">{errors.region.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label>Default bucket (optional)</Label>
                  <Input placeholder="my-bucket" {...register("defaultBucket")} />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Access key ID</Label>
                  <Input placeholder="AKIA..." {...register("accessKeyId")} />
                  {errors.accessKeyId && <p className="text-xs text-destructive">{errors.accessKeyId.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label>Secret access key</Label>
                  <Input type="password" {...register("secretAccessKey")} />
                  {errors.secretAccessKey && <p className="text-xs text-destructive">{errors.secretAccessKey.message}</p>}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Custom endpoint (optional)</Label>
                <Input placeholder="https://minio.local:9000   or   https://<account>.r2.cloudflarestorage.com" {...register("endpoint")} />
                <p className="text-[11px] text-muted-foreground">
                  Leave blank for real AWS S3. Set this for MinIO, Cloudflare R2, DigitalOcean Spaces, or any other S3-compatible storage.
                </p>
              </div>
            </>
          )}

          {testResult && (
            <div className="flex items-center gap-2 text-sm">
              <Badge variant={testResult.ok ? "success" : "destructive"}>
                {testResult.ok ? "Connected" : "Failed"}
              </Badge>
              <span className="text-muted-foreground">
                {testResult.serverVersion ?? testResult.message}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onTest} disabled={testing}>
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
          Test connection
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save connection
        </Button>
      </div>
    </form>
  );
}

function VisibilityCard({
  icon: Icon, title, description, selected, onSelect, disabled,
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
