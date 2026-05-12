"use client";
import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { KeyRound, Loader2, Plus, ShieldAlert, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  createUser,
  deleteUser,
  resetPassword,
  setUserActive,
  setUserSuperAdmin,
} from "@/server/actions/users";

type Row = {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  isSuperAdmin: boolean;
  createdAt: string;
};

const CreateSchema = z.object({
  name: z.string().min(1, "Required"),
  email: z.string().email("Invalid email"),
  password: z.string().min(8, "Min 8 characters"),
  isSuperAdmin: z.boolean().optional().default(false),
});

export function UsersPanel({ users }: { users: Row[] }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <CreateUserDialog />
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Admin</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <UserRow key={u.id} user={u} />
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function UserRow({ user }: { user: Row }) {
  const [busy, setBusy] = React.useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <TableRow>
      <TableCell className="font-medium">{user.name}</TableCell>
      <TableCell className="text-muted-foreground">{user.email}</TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Switch
            checked={user.isActive}
            disabled={busy}
            onCheckedChange={(v) => run(() => setUserActive(user.id, v))}
          />
          <Badge variant={user.isActive ? "success" : "secondary"}>
            {user.isActive ? "Active" : "Disabled"}
          </Badge>
        </div>
      </TableCell>
      <TableCell>
        <Switch
          checked={user.isSuperAdmin}
          disabled={busy}
          onCheckedChange={(v) => run(() => setUserSuperAdmin(user.id, v))}
        />
      </TableCell>
      <TableCell className="text-right space-x-2">
        <ResetPasswordDialog userId={user.id} email={user.email} />
        <DeleteUserDialog userId={user.id} email={user.email} />
      </TableCell>
    </TableRow>
  );
}

function CreateUserDialog() {
  const [open, setOpen] = React.useState(false);
  type Vals = z.infer<typeof CreateSchema>;
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Vals>({
    resolver: zodResolver(CreateSchema),
  });
  const onSubmit = async (v: Vals) => {
    try {
      await createUser(v);
      toast.success("User created");
      reset(); setOpen(false);
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4" />New user</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Create user</DialogTitle>
            <DialogDescription>
              The user will be able to sign in immediately with the credentials below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Name</Label>
            <Input {...register("name")} autoFocus />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input type="email" {...register("email")} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Password</Label>
            <Input type="password" {...register("password")} />
            {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
          </div>
          <div className="flex items-center gap-2">
            <input id="admin" type="checkbox" {...register("isSuperAdmin")} />
            <Label htmlFor="admin">Make this user an administrator</Label>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ userId, email }: { userId: string; email: string }) {
  const [open, setOpen] = React.useState(false);
  const [pw, setPw] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const submit = async () => {
    setBusy(true);
    try { await resetPassword(userId, pw); toast.success("Password updated"); setOpen(false); setPw(""); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><KeyRound className="h-4 w-4" /> Reset</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>Set a new password for {email}.</DialogDescription>
        </DialogHeader>
        <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        <DialogFooter>
          <Button onClick={submit} disabled={busy || pw.length < 8}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Update
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteUserDialog({ userId, email }: { userId: string; email: string }) {
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
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" /> Delete user?
          </DialogTitle>
          <DialogDescription>
            This will permanently remove {email} and all of their saved queries and history.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { await deleteUser(userId); toast.success("User deleted"); setOpen(false); }
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
