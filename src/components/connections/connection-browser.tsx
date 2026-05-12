"use client";
import * as React from "react";
import { Database } from "lucide-react";
import { SchemaTree } from "@/components/query/schema-tree";

export function ConnectionBrowser({
  connectionId,
  connectionType,
}: {
  connectionId: string;
  connectionType: string;
  access?: "read" | "write";
}) {
  return (
    <div className="grid grid-cols-12 h-full">
      <aside className="col-span-3 border-r overflow-auto">
        <SchemaTree connectionId={connectionId} connectionType={connectionType} />
      </aside>
      <main className="col-span-9 flex items-center justify-center text-muted-foreground p-6">
        <div className="text-center">
          <Database className="h-10 w-10 mx-auto" />
          <p className="mt-2 text-sm">Pick a table or collection from the left to view data.</p>
        </div>
      </main>
    </div>
  );
}
