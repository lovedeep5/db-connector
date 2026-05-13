import { Loader2 } from "lucide-react";

/**
 * Rendered immediately by Next while a route is fetching its server data —
 * gives an instant visual response on first navigation. Subsequent visits
 * within `staleTimes.dynamic` (next.config.ts) skip server fetch entirely
 * and never see this.
 */
export default function AppLoading() {
  return (
    <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin mr-2" />
      <span className="text-sm">Loading…</span>
    </div>
  );
}
