"use client";
import * as React from "react";
import { toast } from "sonner";
import { Lock, Plus, Save, Trash2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { createRole, deleteRole, updateRolePermissions } from "@/server/actions/roles";
import type { Permission } from "@/lib/db/schema";

type Role = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
};

const PERM_LABELS: Record<string, { label: string; group: string }> = {
  "manage:users": { label: "Manage users", group: "Admin" },
  "manage:roles": { label: "Manage roles", group: "Admin" },
  "manage:teams": { label: "Manage teams", group: "Admin" },
  "manage:connections": { label: "Manage connections", group: "Admin" },
  "connection:read": { label: "Read connections", group: "Data" },
  "connection:write": { label: "Write to connections", group: "Data" },
  "query:run": { label: "Run queries", group: "Data" },
  "data:export": { label: "Export data", group: "Data" },
  "data:edit": { label: "Edit table rows", group: "Data" },
};

export function RolesPanel({ roles, allPermissions }: { roles: Role[]; allPermissions: Permission[] }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <CreateRoleDialog allPermissions={allPermissions} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {roles.map((r) => (
          <RoleCard key={r.id} role={r} allPermissions={allPermissions} />
        ))}
      </div>
    </div>
  );
}

function RoleCard({ role, allPermissions }: { role: Role; allPermissions: Permission[] }) {
  const [selected, setSelected] = React.useState(new Set(role.permissions));
  const [saving, setSaving] = React.useState(false);
  const grouped = React.useMemo(() => {
    const byGroup: Record<string, Permission[]> = {};
    for (const p of allPermissions) {
      const g = PERM_LABELS[p]?.group ?? "Other";
      (byGroup[g] ??= []).push(p);
    }
    return byGroup;
  }, [allPermissions]);

  const toggle = (p: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await updateRolePermissions(role.id, [...selected] as Permission[]);
      toast.success("Permissions updated");
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-medium">{role.name}</h3>
            {role.isSystem && <Badge variant="secondary"><Lock className="h-3 w-3" /> System</Badge>}
          </div>
          {role.description && <p className="text-sm text-muted-foreground">{role.description}</p>}
        </div>
        {!role.isSystem && (
          <DeleteRoleButton id={role.id} name={role.name} />
        )}
      </div>
      <div className="space-y-3">
        {Object.entries(grouped).map(([group, perms]) => (
          <div key={group}>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">{group}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {perms.map((p) => (
                <label key={p} className="flex items-center gap-2 cursor-pointer text-sm">
                  <Checkbox checked={selected.has(p)} onCheckedChange={() => toggle(p)} />
                  {PERM_LABELS[p]?.label ?? p}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save permissions
        </Button>
      </div>
    </Card>
  );
}

function CreateRoleDialog({ allPermissions }: { allPermissions: Permission[] }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [perms, setPerms] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await createRole({ name, description, permissions: [...perms] as Permission[] });
      toast.success("Role created");
      setOpen(false); setName(""); setDescription(""); setPerms(new Set());
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4" />New role</Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New role</DialogTitle>
          <DialogDescription>Create a role and assign permissions.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="space-y-2">
            <Label>Permissions</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {allPermissions.map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={perms.has(p)}
                    onCheckedChange={() =>
                      setPerms((prev) => {
                        const next = new Set(prev);
                        if (next.has(p)) next.delete(p); else next.add(p);
                        return next;
                      })
                    }
                  />
                  {PERM_LABELS[p]?.label ?? p}
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy || !name}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteRoleButton({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive">
          <Trash2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete role &quot;{name}&quot;?</DialogTitle>
          <DialogDescription>Members assigned to this role will lose its permissions.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { await deleteRole(id); toast.success("Role deleted"); setOpen(false); }
              catch (e) { toast.error((e as Error).message); }
              finally { setBusy(false); }
            }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
