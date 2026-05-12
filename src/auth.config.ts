import type { NextAuthConfig } from "next-auth";

/**
 * Edge-runtime-safe Auth.js config. Used by the middleware. It must NOT import
 * anything that pulls in Node-only modules (e.g. better-sqlite3, bcryptjs).
 * The full config (with the credentials provider and DB lookups) lives in
 * src/auth.ts.
 */
export const authConfig: NextAuthConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as { id: string }).id;
        token.isSuperAdmin = (user as { isSuperAdmin?: boolean }).isSuperAdmin ?? false;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id as string;
      session.user.isSuperAdmin = (token.isSuperAdmin as boolean) ?? false;
      return session;
    },
    authorized({ auth: session, request }) {
      const isAuth = !!session?.user;
      const path = request.nextUrl.pathname;
      if (path.startsWith("/login")) return true;
      return isAuth;
    },
  },
};
