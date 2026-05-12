# DBConnector

A modern, multi-database workbench with role-based access. Connect to PostgreSQL, MySQL,
MongoDB and Oracle from one place. Create teams, assign roles, and control read/write
access per connection. Run queries in a Monaco-powered editor, browse and edit data,
and export results to CSV, JSON, or Excel.

## Stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Tailwind v4** + shadcn-style UI primitives (Radix)
- **Drizzle ORM** + **better-sqlite3** for the metadata database (users, roles, teams, connections)
- **Auth.js v5** with credentials provider
- **Monaco editor** for SQL/JSON authoring
- **TanStack Query** + **Zustand** + **React Hook Form** + **Zod**
- DB drivers: `pg`, `mysql2`, `mongodb`, `oracledb`

## Project structure

```
src/
  app/
    (app)/              authenticated UI: dashboard, connections, query, admin
    login/              public login page
    api/
      auth/[...nextauth]
      db/{schemas,objects,describe,query,rows}
  auth.ts               Auth.js v5 setup
  middleware.ts         auth-gated routing
  components/
    ui/                 reusable shadcn-style primitives
    layout/             app shell (sidebar, topbar)
    auth/, admin/, query/, data/, connections/
  lib/
    db/                 metadata DB (drizzle schema, bootstrap, seed)
    drivers/            DB driver abstraction + per-engine implementations
    crypto.ts           AES-256-GCM encryption for connection credentials
    rbac.ts             effective permissions resolver
    session.ts          server-side auth + RBAC helpers
    export.ts           CSV / JSON / Excel exporters (client side)
  server/
    actions/            "use server" mutations (users, roles, teams, connections)
    services/           db-access service used by API routes
```

## Getting started

### 1. Install

> Requires Node.js 20+. The `oracledb` driver needs Oracle Instant Client for live
> Oracle connections; other drivers work out of the box.

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

Generate a strong encryption key (used to encrypt stored DB credentials at rest):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste it into `ENCRYPTION_KEY=...`. Also set `AUTH_SECRET` to a long random value.

### 3. Initialize and seed

The metadata schema bootstraps automatically on first run, but you must seed the
system roles (Admin/Editor/Viewer) and the initial administrator:

```bash
npm run db:seed
```

This creates an admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (defaults:
`admin@example.com` / `ChangeMe!123`).

### 4. Run

```bash
npm run dev
```

Open <http://localhost:3000>, sign in, and start adding connections.

## Concepts

### Permissions

Permissions are coarse-grained switches:

| Key                    | Effect                                          |
| ---------------------- | ----------------------------------------------- |
| `manage:users`         | Create, disable, delete users                   |
| `manage:roles`         | Create roles and toggle permissions             |
| `manage:teams`         | Create teams and assign members + connections   |
| `manage:connections`   | Create / update / delete database connections   |
| `connection:read`      | Read data on assigned connections               |
| `connection:write`     | Write to assigned connections (default for SQL) |
| `query:run`            | Use the query workbench                         |
| `data:export`          | Export query / table results                    |
| `data:edit`            | Insert / update / delete table rows from the UI |

### Roles

The seeded **Admin** role has every permission. **Editor** allows write + edit;
**Viewer** is read-only. Admins can create additional custom roles.

### Teams

A team groups users and grants access to specific connections. Each member has a
role *within the team*. Permissions on the team's role apply globally to that
member. A team's access to a particular connection defaults to whatever the
member's role allows (`connection:read` ⇒ read; `connection:write` ⇒ write), but
can be overridden per-connection (e.g. force read-only).

### Connections

Admins add connections; credentials are encrypted with AES-256-GCM before being
written to the metadata DB. Each user only sees the connections their team has
been granted access to.

### Query workbench

Pick a connection, browse schemas/tables on the left, write SQL (or a MongoDB
JSON command) in the editor, and press <kbd>Ctrl/⌘+Enter</kbd> to run. Read-only
users are blocked from non-SELECT statements server-side. All runs are logged
to `query_history`.

For MongoDB, statements look like:

```json
{ "collection": "users", "operation": "find", "filter": {}, "limit": 50 }
```

Supported operations: `find`, `aggregate`, `count`, `distinct`.

### Data browser

Click a table from the schema tree to open the data browser. Rows can be
inserted, edited, or deleted in place (if the table has a primary key and the
user has `connection:write` + `data:edit`). Results paginate at 100 rows; use
the export menu to download as CSV, JSON, or Excel.

## Security notes

- Connection credentials are encrypted at rest with AES-256-GCM, never returned
  to the client.
- Server-side identifier validation prevents quoting issues when building row
  CRUD statements; all column values are parameterised.
- Read-only enforcement is checked on the server before issuing the statement —
  the client UI is advisory, not the source of truth.
- All mutations go through Server Actions or API routes that call
  `requirePermission` / `connectionAccess`.

## Production notes

- For multi-instance deployment, swap the metadata store (better-sqlite3) for
  Postgres by changing the Drizzle dialect and providing a connection URL.
  The schema is portable.
- Run `npm run db:generate` (drizzle-kit) and `npm run db:migrate` for managed
  migrations once you go beyond the bootstrap.
- Increase `bcrypt` cost or move to a dedicated password hashing service if you
  expect large user counts.

## License

MIT
