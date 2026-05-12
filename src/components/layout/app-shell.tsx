"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Database,
  LayoutDashboard,
  Terminal,
  Users,
  ShieldCheck,
  Network,
  Sun,
  Moon,
  LogOut,
  Menu,
  CalendarClock,
  Workflow,
  Settings as SettingsIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { signOut } from "next-auth/react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Permission } from "@/lib/db/schema";

type Perms = { isSuperAdmin: boolean; global: Permission[] };
type User = { id: string; name: string; email: string; isSuperAdmin: boolean };

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  requires?: Permission | "admin";
};

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/connections", label: "Connections", icon: Database },
  { href: "/query", label: "Query", icon: Terminal, requires: "query:run" },
  { href: "/automations", label: "Automations", icon: CalendarClock, requires: "query:run" },
  { href: "/teams", label: "Teams", icon: Network, requires: "admin" },
  { href: "/roles", label: "Roles", icon: ShieldCheck, requires: "admin" },
  { href: "/flows", label: "Flows", icon: Workflow, requires: "query:run" },
  { href: "/users", label: "Users", icon: Users, requires: "admin" },
  { href: "/settings", label: "Settings", icon: SettingsIcon, requires: "admin" },
];

void CalendarClock;

function canSee(item: NavItem, perms: Perms): boolean {
  if (!item.requires) return true;
  if (item.requires === "admin") return perms.isSuperAdmin;
  if (perms.isSuperAdmin) return true;
  return perms.global.includes(item.requires);
}

export function AppShell({
  user,
  perms,
  children,
}: {
  user: User;
  perms: Perms;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar perms={perms} className={cn("hidden md:flex", "transition-all")} />
      <MobileSidebar perms={perms} open={open} onOpenChange={setOpen} />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar user={user} onOpenMobile={() => setOpen(true)} />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

function Sidebar({ perms, className }: { perms: Perms; className?: string }) {
  return (
    <aside className={cn("w-64 border-r bg-card flex flex-col", className)}>
      <div className="h-14 flex items-center gap-2 px-4 border-b">
        <Database className="h-5 w-5 text-primary" />
        <span className="font-semibold">DBConnector</span>
      </div>
      <nav className="flex-1 p-3 space-y-0.5">
        {NAV.filter((i) => canSee(i, perms)).map((item) => (
          <NavLink key={item.href} item={item} />
        ))}
      </nav>
      <div className="p-3 text-xs text-muted-foreground">
        v0.1.0 · {perms.isSuperAdmin ? "Admin" : "Member"}
      </div>
    </aside>
  );
}

function MobileSidebar({
  perms,
  open,
  onOpenChange,
}: {
  perms: Perms;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  if (!open) return null;
  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50 md:hidden"
        onClick={() => onOpenChange(false)}
      />
      <div className="fixed inset-y-0 left-0 z-50 md:hidden">
        <Sidebar perms={perms} />
      </div>
    </>
  );
}

function NavLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const Icon = item.icon;
  const active = pathname === item.href || pathname.startsWith(item.href + "/");
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-accent"
      )}
    >
      <Icon className="h-4 w-4" />
      {item.label}
    </Link>
  );
}

function Topbar({ user, onOpenMobile }: { user: User; onOpenMobile: () => void }) {
  return (
    <header className="h-14 border-b flex items-center justify-between px-4 bg-card/40 backdrop-blur">
      <Button variant="ghost" size="icon" className="md:hidden" onClick={onOpenMobile} aria-label="Menu">
        <Menu className="h-5 w-5" />
      </Button>
      <div />
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <UserMenu user={user} />
      </div>
    </header>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return <Button variant="ghost" size="icon" aria-label="Theme" />;
  const isDark = theme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label="Toggle theme"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}

function UserMenu({ user }: { user: User }) {
  const initials = (user.name || user.email)
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-primary text-xs font-semibold">
            {initials}
          </span>
          <span className="hidden md:inline text-sm">{user.name || user.email}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="font-medium">{user.name}</div>
          <div className="text-xs text-muted-foreground">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => signOut({ callbackUrl: "/login" })}>
          <LogOut className="h-4 w-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
