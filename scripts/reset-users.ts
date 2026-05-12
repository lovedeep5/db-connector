/**
 * Reset users: delete everyone, then create two fresh accounts.
 * Run from project root: `npx tsx --env-file=.env scripts/reset-users.ts`
 */
import bcrypt from "bcryptjs";
import { Pool } from "pg";

const PG_URL = process.env.METADATA_DATABASE_URL;
if (!PG_URL) throw new Error("METADATA_DATABASE_URL is not set");

const u = new URL(PG_URL);
const pg = new Pool({
  host: u.hostname,
  port: u.port ? Number(u.port) : 5432,
  database: decodeURIComponent(u.pathname.replace(/^\//, "")),
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  ssl: u.searchParams.get("sslmode") !== "disable" ? { rejectUnauthorized: false } : undefined,
});

async function main() {
  const before = await pg.query<{ count: string }>("select count(*)::text from users");
  console.log(`Deleting ${before.rows[0].count} existing users…`);
  await pg.query("DELETE FROM users");

  const accounts = [
    { email: "admin@example.com", name: "Admin",   isSuperAdmin: true,  password: "123456" },
    { email: "user@example.com",  name: "User",    isSuperAdmin: false, password: "123456" },
  ];

  for (const a of accounts) {
    const hash = await bcrypt.hash(a.password, 12);
    await pg.query(
      `INSERT INTO users (id, email, name, password_hash, is_active, is_super_admin, created_at)
       VALUES (gen_random_uuid()::text, $1, $2, $3, TRUE, $4, NOW())`,
      [a.email, a.name, hash, a.isSuperAdmin]
    );
    console.log(`Created ${a.email} (super_admin=${a.isSuperAdmin})`);
  }

  await pg.end();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
