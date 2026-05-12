import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex h-full items-center justify-center p-10">
      <div className="text-center max-w-md space-y-3">
        <FileQuestion className="h-10 w-10 text-muted-foreground mx-auto" />
        <h2 className="text-xl font-semibold">Not found</h2>
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t find what you were looking for.
        </p>
        <Button asChild>
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
