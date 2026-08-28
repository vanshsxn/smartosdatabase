import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BarChart3,
  Clock,
  Cloud,
  DollarSign,
  FileText,
  LayoutGrid,
  ListTree,
  LogOut,
  Menu,
  MonitorCog,
  PlusSquare,
  Settings,
  Users,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { healthQuery } from "@/lib/engine-queries";
import { TENANTS, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutGrid },
  { to: "/submit", label: "Submit Job", icon: PlusSquare },
  { to: "/jobs", label: "All Jobs", icon: ListTree },
  { to: "/scheduler", label: "Scheduler", icon: Clock },
  { to: "/resources", label: "Resources", icon: MonitorCog },
  { to: "/tenants", label: "Tenants", icon: Users },
  { to: "/billing", label: "Billing", icon: DollarSign },
  { to: "/logs", label: "Logs", icon: FileText },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppLayout({ title, children }: { title: string; children: ReactNode }) {
  const { user, ready, tenantId, setTenantId, signOut } = useSession();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const health = useQuery(healthQuery);

  useEffect(() => {
    if (ready && !user) navigate({ to: "/login", replace: true });
  }, [ready, user, navigate]);

  if (!ready || !user) {
    return <div className="min-h-screen bg-background" />;
  }

  const online = health.isSuccess && (health.data?.reachable ?? health.data?.status === "ok");
  const paused = health.data?.paused;

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-sidebar-border bg-sidebar transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center gap-3 px-5 py-5">
          <Cloud className="h-8 w-8 text-primary" />
          <div>
            <p className="text-base font-semibold leading-tight">Smart Cloud</p>
            <p className="text-xs text-muted-foreground">Task Engine</p>
          </div>
        </div>
        <p className="px-5 pb-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          Main menu
        </p>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3">
          {NAV.map(({ to, label, icon: Icon }) => {
            const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="m-3 rounded-lg border border-sidebar-border bg-card/60 p-4">
          <p className="text-sm font-medium">System Status</p>
          <p className="mt-2 flex items-center gap-2 text-sm">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                online ? (paused ? "bg-warning" : "bg-success") : "bg-destructive",
              )}
            />
            <span className={online ? (paused ? "text-warning" : "text-success") : "text-destructive"}>
              {online ? (paused ? "PAUSED" : "RUNNING") : "OFFLINE"}
            </span>
          </p>
          <p className="mt-3 text-xs text-muted-foreground">Policy</p>
          <p className="text-sm font-semibold">{health.data?.policy ?? "—"}</p>
        </div>
      </aside>

      {open && (
        <button
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-background/70 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col lg:ml-64">
        <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-semibold sm:text-2xl">{title}</h1>
          <div className="ml-auto flex items-center gap-3">
            <Select value={tenantId || "all"} onValueChange={(v) => setTenantId(v === "all" ? "" : v)}>
              <SelectTrigger className="w-[190px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tenant: All Tenants</SelectItem>
                {TENANTS.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    Tenant: {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
              <Activity className="h-4 w-4" />
              {online ? "Engine online" : "Engine offline"}
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {user.initials}
            </div>
            <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>
        <main className="min-w-0 flex-1 space-y-4 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
