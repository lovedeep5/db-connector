import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ForbiddenPage() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-3xl font-semibold">Access denied</h1>
      <p className="text-muted-foreground max-w-md">
        You don&apos;t have permission to view this page. Ask your administrator to grant you
        access.
      </p>
      <Button asChild>
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
