"use client";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Type filter chips at the top of the Credentials page. Each chip is a Link
 * that toggles the `?type=` search param — keeps the page server-rendered
 * (no client-side filtering state) and bookmarkable.
 */
const TYPES: { value: string | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "postgres", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL" },
  { value: "mongodb", label: "MongoDB" },
  { value: "oracle", label: "Oracle" },
  { value: "smtp", label: "SMTP" },
  { value: "s3", label: "AWS S3" },
];

export function CredentialsFilter({ active }: { active: string | null }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {TYPES.map((t) => {
        const selected = (t.value ?? null) === (active ?? null);
        const href = t.value ? `/credentials?type=${t.value}` : "/credentials";
        return (
          <Link
            key={t.label}
            href={href}
            className={cn(
              "text-xs px-2.5 py-1 rounded-full border transition-colors",
              selected
                ? "border-primary bg-primary/10 text-primary"
                : "border-input text-muted-foreground hover:bg-accent"
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
