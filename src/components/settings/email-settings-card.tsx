"use client";
import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Mail, Save, Send, ShieldCheck, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  saveEmailSettings,
  sendTestEmail,
  verifyEmailSettings,
} from "@/server/actions/email-settings";

type Public = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  hasPassword: boolean;
  from: string;
};

const Schema = z.object({
  host: z.string().min(1, "Required"),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().optional(),
  password: z.string().optional(),
  keepExistingPassword: z.boolean(),
  from: z.string().min(1, "Required"),
});
type Vals = z.infer<typeof Schema>;

export function EmailSettingsCard({ initial }: { initial: Public }) {
  const isConfigured = !!initial.host;
  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Vals>({
    resolver: zodResolver(Schema),
    defaultValues: {
      host: initial.host,
      port: initial.port,
      secure: initial.secure,
      user: initial.user,
      password: "",
      keepExistingPassword: initial.hasPassword,
      from: initial.from,
    },
  });

  const [verifyState, setVerifyState] = React.useState<null | { ok: boolean; message?: string }>(null);
  const [verifying, setVerifying] = React.useState(false);
  const [testTo, setTestTo] = React.useState("");
  const [sendingTest, setSendingTest] = React.useState(false);

  const keepExisting = watch("keepExistingPassword");
  const password = watch("password");

  const onSubmit = async (vals: Vals) => {
    try {
      await saveEmailSettings(vals);
      toast.success("Email settings saved");
      setVerifyState(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const verify = async () => {
    setVerifying(true);
    setVerifyState(null);
    try {
      const r = await verifyEmailSettings();
      setVerifyState(r);
      if (r.ok) toast.success("Connected to SMTP server");
      else toast.error(r.message ?? "Verification failed");
    } finally {
      setVerifying(false);
    }
  };

  const sendTest = async () => {
    setSendingTest(true);
    try {
      await sendTestEmail(testTo);
      toast.success(`Test email sent to ${testTo}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" /> Email (SMTP)
            </CardTitle>
            <CardDescription>
              Used by scheduled automations to send query results. Credentials encrypted at rest.
            </CardDescription>
          </div>
          {isConfigured ? (
            <Badge variant="success" className="gap-1">
              <ShieldCheck className="h-3 w-3" /> Configured
            </Badge>
          ) : (
            <Badge variant="warning" className="gap-1">
              <AlertTriangle className="h-3 w-3" /> Not set up
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2 space-y-2">
              <Label>SMTP host</Label>
              <Input placeholder="smtp.your-provider.com" {...register("host")} />
              {errors.host && <p className="text-xs text-destructive">{errors.host.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Port</Label>
              <Input type="number" {...register("port")} />
              {errors.port && <p className="text-xs text-destructive">{errors.port.message}</p>}
            </div>
          </div>

          <Controller
            control={control}
            name="secure"
            render={({ field }) => (
              <div className="flex items-center gap-2">
                <Switch checked={!!field.value} onCheckedChange={field.onChange} id="secure" />
                <Label htmlFor="secure">Use TLS (typical for port 465; 587 uses STARTTLS automatically)</Label>
              </div>
            )}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Username (optional)</Label>
              <Input placeholder="your-smtp-user" {...register("user")} />
            </div>
            <div className="space-y-2">
              <Label>Password</Label>
              <Input
                type="password"
                placeholder={keepExisting ? "•••••••• (unchanged)" : ""}
                {...register("password")}
                onChange={(e) => {
                  register("password").onChange(e);
                  if (e.target.value) setValue("keepExistingPassword", false, { shouldDirty: true });
                }}
              />
              {keepExisting && !password && (
                <p className="text-[11px] text-muted-foreground">
                  Leave blank to keep the previously saved password.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>From address</Label>
            <Input placeholder={`"DBConnector" <noreply@your.co>`} {...register("from")} />
            {errors.from && <p className="text-xs text-destructive">{errors.from.message}</p>}
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="submit" disabled={isSubmitting || (!isDirty && isConfigured)}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </Button>
            <Button type="button" variant="outline" onClick={verify} disabled={verifying || !isConfigured}>
              {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Verify connection
            </Button>
          </div>

          {verifyState && (
            <div className="flex items-center gap-2 text-sm">
              <Badge variant={verifyState.ok ? "success" : "destructive"}>
                {verifyState.ok ? "Verified" : "Failed"}
              </Badge>
              {verifyState.message && (
                <span className="text-muted-foreground">{verifyState.message}</span>
              )}
            </div>
          )}
        </form>

        <div className="mt-6 pt-4 border-t space-y-2">
          <Label>Send a test email</Label>
          <div className="flex gap-2">
            <Input
              placeholder="you@your.co"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              className="max-w-sm"
            />
            <Button
              variant="outline"
              onClick={sendTest}
              disabled={sendingTest || !testTo || !isConfigured}
            >
              {sendingTest ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send test
            </Button>
          </div>
          {!isConfigured && (
            <p className="text-[11px] text-muted-foreground">
              Save the SMTP settings first, then send a test to make sure delivery works.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
