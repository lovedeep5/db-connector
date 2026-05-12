"use client";
import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Save, Globe, Users, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { saveQuery, updateSavedQuery } from "@/server/actions/saved-queries";

const Schema = z
  .object({
    name: z.string().min(1, "Required").max(120),
    description: z.string().max(2000).optional(),
    visibility: z.enum(["private", "team", "connection"]),
    sharedWithTeamId: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.visibility === "team" && !v.sharedWithTeamId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sharedWithTeamId"],
        message: "Pick a team",
      });
    }
  });

type Vals = z.infer<typeof Schema>;

type Mode =
  | {
      mode: "create";
      connectionId: string;
      statement: string;
    }
  | {
      mode: "edit";
      id: string;
      statement: string;
      initial: Partial<Vals>;
    };

export function SaveQueryDialog({
  open,
  onOpenChange,
  myTeams,
  onSaved,
  ...rest
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  myTeams: { id: string; name: string }[];
  onSaved?: () => void;
} & Mode) {
  const defaults: Vals =
    rest.mode === "edit"
      ? {
          name: rest.initial.name ?? "",
          description: rest.initial.description ?? "",
          visibility: rest.initial.visibility ?? "private",
          sharedWithTeamId: rest.initial.sharedWithTeamId,
        }
      : { name: "", description: "", visibility: "private" };

  const { register, handleSubmit, control, watch, formState: { errors, isSubmitting }, reset } =
    useForm<Vals>({ resolver: zodResolver(Schema), defaultValues: defaults });

  React.useEffect(() => {
    if (open) reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const visibility = watch("visibility");

  const onSubmit = async (vals: Vals) => {
    try {
      if (rest.mode === "create") {
        await saveQuery({
          connectionId: rest.connectionId,
          name: vals.name,
          description: vals.description ?? null,
          statement: rest.statement,
          visibility: vals.visibility,
          sharedWithTeamId: vals.visibility === "team" ? vals.sharedWithTeamId ?? null : null,
        });
        toast.success("Query saved");
      } else {
        await updateSavedQuery(rest.id, {
          name: vals.name,
          description: vals.description ?? null,
          statement: rest.statement,
          visibility: vals.visibility,
          sharedWithTeamId: vals.visibility === "team" ? vals.sharedWithTeamId ?? null : null,
        });
        toast.success("Query updated");
      }
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const noTeams = myTeams.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>
              {rest.mode === "edit" ? "Edit saved query" : "Save query"}
            </DialogTitle>
            <DialogDescription>
              Give it a clear name and a one-line note on why teammates would want to run it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" autoFocus placeholder="Active users by region" {...register("name")} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Why this query (optional)</Label>
            <Textarea
              id="description"
              rows={3}
              placeholder="Use this to check daily active users grouped by region. Filter by signup_date for cohorts."
              {...register("description")}
            />
          </div>

          <div className="space-y-2">
            <Label>Who can see it</Label>
            <Controller
              control={control}
              name="visibility"
              render={({ field }) => (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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
                    description={noTeams ? "Join a team first" : "Pick a team"}
                    selected={field.value === "team"}
                    onSelect={() => !noTeams && field.onChange("team")}
                    disabled={noTeams}
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
          </div>

          {visibility === "team" && (
            <div className="space-y-2">
              <Label>Team</Label>
              <Controller
                control={control}
                name="sharedWithTeamId"
                render={({ field }) => (
                  <Select value={field.value ?? ""} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="Pick a team" /></SelectTrigger>
                    <SelectContent>
                      {myTeams.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.sharedWithTeamId && (
                <p className="text-xs text-destructive">{errors.sharedWithTeamId.message}</p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {rest.mode === "edit" ? "Update" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
