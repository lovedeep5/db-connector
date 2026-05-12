"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Clock, Loader2, MinusCircle } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import type { Schedule } from "@/components/automations/automations-panel";

type Run = {
  id: string;
  ranAt: string;
  status: "success" | "error" | "skipped";
  durationMs: number;
  rowCount: number | null;
  recipients: string | null;
  errorMessage: string | null;
};

export function RunHistoryDialog({
  open,
  onOpenChange,
  schedule,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  schedule: Schedule;
}) {
  const { data, isLoading } = useQuery<{ data: Run[] }>({
    queryKey: ["schedule-runs", schedule.id],
    queryFn: async () => {
      const r = await fetch(`/api/schedules/${schedule.id}/runs`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      return j as { data: Run[] };
    },
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Run history — {schedule.name}</DialogTitle>
          <DialogDescription>Last 50 executions, most recent first.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <div className="p-6 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
          ) : (data?.data ?? []).length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            <ul className="divide-y">
              {(data?.data ?? []).map((r) => (
                <li key={r.id} className="py-3 px-1">
                  <div className="flex items-center gap-2 text-sm">
                    <StatusBadge status={r.status} />
                    <span className="text-muted-foreground">
                      {new Date(r.ranAt).toLocaleString()}
                    </span>
                    <span className="text-muted-foreground">· {r.durationMs}ms</span>
                    {r.rowCount !== null && (
                      <span className="text-muted-foreground">· {r.rowCount.toLocaleString()} rows</span>
                    )}
                  </div>
                  {r.recipients && (
                    <p className="text-xs text-muted-foreground mt-1">→ {r.recipients}</p>
                  )}
                  {r.errorMessage && (
                    <pre className="text-xs text-destructive bg-destructive/5 rounded p-2 mt-1 whitespace-pre-wrap">
                      {r.errorMessage}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ status }: { status: Run["status"] }) {
  if (status === "success") {
    return <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" /> success</Badge>;
  }
  if (status === "error") {
    return <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" /> error</Badge>;
  }
  return <Badge variant="secondary" className="gap-1"><MinusCircle className="h-3 w-3" /> skipped</Badge>;
}

void Clock;
