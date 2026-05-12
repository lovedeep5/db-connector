import { LoginForm } from "@/components/auth/login-form";
import { Database } from "lucide-react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between p-10 bg-gradient-to-br from-primary/15 via-background to-background border-r">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <Database className="h-6 w-6 text-primary" />
          DBConnector
        </div>
        <div className="space-y-4 max-w-md">
          <h1 className="text-4xl font-bold tracking-tight">
            One workspace. Every database.
          </h1>
          <p className="text-muted-foreground">
            Connect to Postgres, MySQL, MongoDB and Oracle. Give teams the exact access
            they need. Run, edit and export — all in a fast, modern UI.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} DBConnector</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
