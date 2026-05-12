"use client";
import * as React from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  addTeamMember,
  grantTeamConnection,
  removeTeamMember,
  revokeTeamConnection,
} from "@/server/actions/teams";

type Team = { id: string; name: string; description: string | null };
type User = { id: string; name: string; email: string };
type Role = { id: string; name: string };
type Conn = { id: string; name: string; type: string };
type Member = { teamId: string; userId: string; roleId: string };
type TC = { teamId: string; connectionId: string; accessLevel: "read" | "write" | null };

export function TeamDetail({
  team,
  members,
  teamConnections,
  allUsers,
  allRoles,
  allConnections,
}: {
  team: Team;
  members: Member[];
  teamConnections: TC[];
  allUsers: User[];
  allRoles: Role[];
  allConnections: Conn[];
}) {
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{team.name}</h1>
        {team.description && <p className="text-sm text-muted-foreground">{team.description}</p>}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle>Members</CardTitle>
            <CardDescription>People in this team and the role they hold.</CardDescription>
          </div>
          <AddMemberDialog teamId={team.id} users={allUsers} roles={allRoles} existing={members} />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    No members yet.
                  </TableCell>
                </TableRow>
              )}
              {members.map((m) => {
                const user = allUsers.find((u) => u.id === m.userId);
                return (
                  <TableRow key={m.userId}>
                    <TableCell>
                      <div className="font-medium">{user?.name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{user?.email}</div>
                    </TableCell>
                    <TableCell>
                      <MemberRoleSelect
                        teamId={team.id}
                        userId={m.userId}
                        roleId={m.roleId}
                        roles={allRoles}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <RemoveMemberButton teamId={team.id} userId={m.userId} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle>Connections</CardTitle>
            <CardDescription>Databases this team has access to.</CardDescription>
          </div>
          <GrantConnectionDialog teamId={team.id} connections={allConnections} existing={teamConnections} />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Connection</TableHead>
                <TableHead>Access</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teamConnections.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    No connections assigned yet.
                  </TableCell>
                </TableRow>
              )}
              {teamConnections.map((tc) => {
                const conn = allConnections.find((c) => c.id === tc.connectionId);
                return (
                  <TableRow key={tc.connectionId}>
                    <TableCell>
                      <div className="font-medium">{conn?.name}</div>
                      <Badge variant="secondary">{conn?.type}</Badge>
                    </TableCell>
                    <TableCell>
                      <AccessLevelSelect teamId={team.id} connectionId={tc.connectionId} value={tc.accessLevel} />
                    </TableCell>
                    <TableCell className="text-right">
                      <RevokeConnectionButton teamId={team.id} connectionId={tc.connectionId} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function MemberRoleSelect({
  teamId,
  userId,
  roleId,
  roles,
}: {
  teamId: string;
  userId: string;
  roleId: string;
  roles: Role[];
}) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Select
      value={roleId}
      disabled={busy}
      onValueChange={async (v) => {
        setBusy(true);
        try { await addTeamMember(teamId, userId, v); toast.success("Role updated"); }
        catch (e) { toast.error((e as Error).message); }
        finally { setBusy(false); }
      }}
    >
      <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
      <SelectContent>
        {roles.map((r) => (
          <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RemoveMemberButton({ teamId, userId }: { teamId: string; userId: string }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-destructive"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try { await removeTeamMember(teamId, userId); toast.success("Removed"); }
        catch (e) { toast.error((e as Error).message); }
        finally { setBusy(false); }
      }}
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}

function AddMemberDialog({
  teamId,
  users,
  roles,
  existing,
}: {
  teamId: string;
  users: User[];
  roles: Role[];
  existing: Member[];
}) {
  const [open, setOpen] = React.useState(false);
  const [userId, setUserId] = React.useState("");
  const [roleId, setRoleId] = React.useState(roles[0]?.id ?? "");
  const [busy, setBusy] = React.useState(false);
  const available = users.filter((u) => !existing.some((m) => m.userId === u.id));
  const submit = async () => {
    setBusy(true);
    try { await addTeamMember(teamId, userId, roleId); toast.success("Member added"); setOpen(false); setUserId(""); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><UserPlus className="h-4 w-4" /> Add member</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
          <DialogDescription>Pick a user and the role they should hold in this team.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger><SelectValue placeholder="Select user" /></SelectTrigger>
            <SelectContent>
              {available.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.name} ({u.email})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={roleId} onValueChange={setRoleId}>
            <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
            <SelectContent>
              {roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy || !userId || !roleId}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GrantConnectionDialog({
  teamId,
  connections,
  existing,
}: {
  teamId: string;
  connections: Conn[];
  existing: TC[];
}) {
  const [open, setOpen] = React.useState(false);
  const [connectionId, setConnectionId] = React.useState("");
  const [level, setLevel] = React.useState<"read" | "write" | "role">("role");
  const [busy, setBusy] = React.useState(false);
  const available = connections.filter((c) => !existing.some((tc) => tc.connectionId === c.id));
  const submit = async () => {
    setBusy(true);
    try {
      await grantTeamConnection(teamId, connectionId, level === "role" ? null : level);
      toast.success("Access granted");
      setOpen(false); setConnectionId(""); setLevel("role");
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4" /> Grant access</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Grant connection</DialogTitle>
          <DialogDescription>
            Give this team access to a database. The default is to use the access level from each
            member&apos;s role; you can override it here.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={connectionId} onValueChange={setConnectionId}>
            <SelectTrigger><SelectValue placeholder="Select connection" /></SelectTrigger>
            <SelectContent>
              {available.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={level} onValueChange={(v: "read" | "write" | "role") => setLevel(v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="role">Use member&apos;s role</SelectItem>
              <SelectItem value="read">Force read only</SelectItem>
              <SelectItem value="write">Force read and write</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy || !connectionId}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Grant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AccessLevelSelect({
  teamId,
  connectionId,
  value,
}: {
  teamId: string;
  connectionId: string;
  value: "read" | "write" | null;
}) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Select
      value={value ?? "role"}
      disabled={busy}
      onValueChange={async (v: "read" | "write" | "role") => {
        setBusy(true);
        try {
          await grantTeamConnection(teamId, connectionId, v === "role" ? null : v);
          toast.success("Access updated");
        } catch (e) { toast.error((e as Error).message); }
        finally { setBusy(false); }
      }}
    >
      <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="role">Use role</SelectItem>
        <SelectItem value="read">Read only</SelectItem>
        <SelectItem value="write">Read &amp; write</SelectItem>
      </SelectContent>
    </Select>
  );
}

function RevokeConnectionButton({ teamId, connectionId }: { teamId: string; connectionId: string }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-destructive"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try { await revokeTeamConnection(teamId, connectionId); toast.success("Access revoked"); }
        catch (e) { toast.error((e as Error).message); }
        finally { setBusy(false); }
      }}
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}
