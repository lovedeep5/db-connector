"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Database,
  LayoutDashboard,
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
  KeyRound,
  ChevronDown,
  ChevronRight,
  Zap,
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

type Leaf = {
  kind: "leaf";
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  requires?: Permission | "admin";
};

type Group = {
  kind: "group";
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Show the group header even if no children are visible. */
  defaultOpen?: boolean;
  /** Sub-items the user can navigate to. */
  items: Leaf[];
};

type NavEntry = Leaf | Group;

const NAV: NavEntry[] = [
  { kind: "leaf", href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { kind: "leaf", href: "/connections", label: "DB Manager", icon: Database, requires: "query:run" },
  {
    kind: "group",
    key: "automations",
    label: "Automations",
    icon: Zap,
    defaultOpen: true,
    items: [
      { kind: "leaf", href: "/flows", label: "Flow automation", icon: Workflow, requires: "query:run" },
      { kind: "leaf", href: "/automations", label: "Query Email automation", icon: CalendarClock, requires: "query:run" },
    ],
  },
  {
    kind: "group",
    key: "access",
    label: "Access",
    icon: ShieldCheck,
    defaultOpen: true,
    items: [
      { kind: "leaf", href: "/users", label: "Users", icon: Users, requires: "admin" },
      { kind: "leaf", href: "/teams", label: "Teams", icon: Network, requires: "admin" },
      { kind: "leaf", href: "/roles", label: "Roles", icon: ShieldCheck, requires: "admin" },
    ],
  },
  { kind: "leaf", href: "/credentials", label: "Credentials", icon: KeyRound, requires: "query:run" },
  { kind: "leaf", href: "/settings", label: "Settings", icon: SettingsIcon, requires: "admin" },
];

function canSee(item: Leaf, perms: Perms): boolean {
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
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {NAV.map((entry) => (entry.kind === "leaf" ? (
          canSee(entry, perms) && <NavLink key={entry.href} item={entry} />
        ) : (
          <NavGroup key={entry.key} group={entry} perms={perms} />
        )))}
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

function NavLink({ item, indent }: { item: Leaf; indent?: boolean }) {
  const pathname = usePathname();
  const Icon = item.icon;
  const active = pathname === item.href || pathname.startsWith(item.href + "/");
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-2.5 rounded-md py-2 text-sm font-medium transition-colors",
        indent ? "pl-9 pr-3" : "px-3",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-accent"
      )}
    >
      <Icon className={cn("h-4 w-4", indent && "h-3.5 w-3.5")} />
      {item.label}
    </Link>
  );
}

/**
 * Collapsable section. Auto-opens on first render if the current pathname is
 * inside one of its children — saves users an extra click when they land on
 * a deep page via bookmark.
 */
function NavGroup({ group, perms }: { group: Group; perms: Perms }) {
  const pathname = usePathname();
  const visible = group.items.filter((i) => canSee(i, perms));
  const childActive = visible.some((i) => pathname === i.href || pathname.startsWith(i.href + "/"));
  const [open, setOpen] = React.useState<boolean>(group.defaultOpen ?? false);
  // If the user navigates into a child, ensure the group is open.
  React.useEffect(() => {
    if (childActive) setOpen(true);
  }, [childActive]);
  if (visible.length === 0) return null;
  const Icon = group.icon;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-full flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          childActive
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-accent"
        )}
      >
        <Icon className="h-4 w-4" />
        <span className="flex-1 text-left">{group.label}</span>
        <Chevron className="h-3.5 w-3.5 opacity-60" />
      </button>
      {open && (
        <div className="space-y-0.5">
          {visible.map((leaf) => (
            <NavLink key={leaf.href} item={leaf} indent />
          ))}
        </div>
      )}
    </div>
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
