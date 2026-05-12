# Kiro setup instructions — DBConnector

You're setting up this project on a fresh machine for the first time. Follow these steps in order. Stop and ask the user only when this file explicitly tells you to.

---

## What this project is

**DBConnector** is a web-based database workbench + automation builder. Single Next.js 15 app (App Router, React 19, TypeScript). It lets users:

- Connect to PostgreSQL, MySQL, MongoDB, Oracle, and SMTP servers
- Run queries against any of those (with RBAC: private connections per user, plus team-shared)
- Build "flows" — visual automation graphs with triggers (schedule, manual, webhook), data nodes (DB query, HTTP, download file), transforms (filter, set variable, extract path, JS code), and outputs (send email, to-file).
- Send scheduled email reports

**Stack:**
- Next.js 15.x, React 19, Tailwind v4, shadcn-style UI
- Drizzle ORM → **PostgreSQL** for app metadata (users, connections, flows)
- Auth.js v5 (credentials provider, JWT sessions)
- `pg`, `mysql2`, `mongodb`, `oracledb` for connecting to user-added databases
- `node-cron` + in-process executor for scheduled flows
- React Flow (`@xyflow/react`) for the flow editor canvas

**Architecture decisions already baked in:**
- App's own metadata lives in **AWS RDS Postgres** (not SQLite).
- Provisioning is via **Terraform** in `terraform/` — creates RDS, ECR repo, Secrets Manager secret, security group, IAM role (when EKS is configured).
- Encrypted at rest: stored DB connection credentials use AES-256-GCM via `src/lib/crypto.ts`. The encryption key is in `.env` as `ENCRYPTION_KEY`.
- Single-pod model right now (in-process scheduler). Multi-pod requires migrating to `pg-boss` later — **don't change this**; it's intentional.

**Don't run** `terraform destroy`, `npm run dev` in production mode, or modify schema/migrations without asking. Everything else, follow the steps.

---

## Goal

Get the app running locally on this machine, talking to its own freshly provisioned AWS RDS Postgres. End state: user opens `http://localhost:3000`, signs in as `admin@example.com / ChangeMe!123`, sees the dashboard.

---

## Step 1 — Verify prerequisites

Run these checks. If any are missing, **stop and tell the user which one is missing**. Do NOT try to install them yourself — they may be controlled by IT policy on this machine.

```powershell
node --version              # need v20 or higher
npm --version
aws --version               # need v2.x
terraform --version         # need v1.6 or higher
```

Also confirm AWS credentials are configured for this account:

```powershell
aws sts get-caller-identity
```

This must return an account ID and an ARN. If it returns an error like `Unable to locate credentials`, **stop and ask the user to run `aws configure` with their AWS access key + secret + default region** (most likely `us-east-1`, but ask).

---

## Step 2 — Install npm dependencies

From the project root:

```powershell
npm install --no-audit --no-fund
```

This takes 3–6 minutes. Some dependencies (`better-sqlite3` is **not** in the list — we use Postgres; `oracledb` is) build native modules. If `npm install` fails on a corporate network with `EAI_AGAIN` or proxy errors, tell the user — likely a proxy issue, they'll have to point npm at their internal mirror:

```powershell
npm config set registry https://registry.npmjs.org/
```

---

## Step 3 — Discover AWS networking info

Before Terraform can run, we need three values for `terraform/terraform.tfvars`:

1. **AWS region** — read from the current AWS config:
   ```powershell
   aws configure get region
   ```
   If empty, ask the user which region this project should deploy into.

2. **VPC ID** — find a VPC to use. List them:
   ```powershell
   aws ec2 describe-vpcs --query "Vpcs[].{VpcId:VpcId,IsDefault:IsDefault,Cidr:CidrBlock}" --output table
   ```
   - If there's a default VPC (IsDefault = true), use that.
   - If there are multiple VPCs, **stop and ask the user which one to use**.

3. **At least 2 subnet IDs from that VPC**, in **different availability zones**:
   ```powershell
   aws ec2 describe-subnets --filters "Name=vpc-id,Values=<vpc-id>" --query "Subnets[].{Id:SubnetId,AZ:AvailabilityZone}" --output table
   ```
   Pick two subnets in two different AZs.

4. **The current machine's public IP** (needed so the dev box can reach RDS over the internet):
   ```powershell
   (Invoke-WebRequest -UseBasicParsing -Uri "https://api.ipify.org").Content
   ```
   If `api.ipify.org` is blocked, try `https://checkip.amazonaws.com`.

---

## Step 4 — Configure Terraform

```powershell
cd terraform
copy terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` to fill in the values discovered above. The file is mostly self-documenting. The keys that need real values:

```hcl
aws_region          = "us-east-1"                   # from Step 3.1
vpc_id              = "vpc-XXXXXXXX"                # from Step 3.2
private_subnet_ids  = ["subnet-AAA", "subnet-BBB"]  # from Step 3.3, two AZs

# Leave EKS empty — this machine is local-only:
eks_cluster_name = ""

# Allow this laptop to reach RDS over the internet:
allowed_public_cidrs = ["<public-ip>/32"]            # from Step 3.4
```

Keep all the other defaults (`db_instance_class = "db.t4g.micro"`, `db_backup_retention_days = 0`, `db_deletion_protection = false`, etc.). They're tuned for low-cost dev use and the file already has them right.

---

## Step 5 — Provision AWS

```powershell
terraform init
terraform plan -var-file=terraform.tfvars
```

Review the plan — should show **~10 resources to add** (RDS instance, parameter group, subnet group, security group, ingress rule, egress rule, secret + version, ECR repo + lifecycle, random password).

If the plan looks reasonable:

```powershell
terraform apply -var-file=terraform.tfvars -auto-approve
```

**This takes 8–12 minutes.** RDS creation is the slow part. Wait for it to finish.

When done, grab the outputs:

```powershell
terraform output
```

You'll need `db_secret_name` for the next step.

If `terraform apply` fails with `FreeTierRestrictionError`, the account has used its free tier elsewhere — set `db_backup_retention_days = 0` in `terraform.tfvars` if it isn't already, then re-apply.

---

## Step 6 — Build the `.env` file

Generate two random secrets and fetch the DB URL from Secrets Manager. Run these from the project root (cd back out of `terraform/`):

```powershell
cd ..

# Generate the JWT signing secret
$authSecret = node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# Generate the encryption key (used to encrypt stored DB credentials)
$encKey = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Fetch the RDS connection URL from Secrets Manager
$dbUrl = aws secretsmanager get-secret-value --secret-id dbconnector/metadata/database --query SecretString --output text | ConvertFrom-Json | Select-Object -ExpandProperty url
```

Now write `.env` in the project root. **If `.env` already exists, ask the user before overwriting it** — it may have local customizations.

The contents should be:

```env
NEXTAUTH_URL=http://localhost:3000
AUTH_SECRET=<paste $authSecret here>
METADATA_DATABASE_URL=<paste $dbUrl here>
ENCRYPTION_KEY=<paste $encKey here>
APP_BASE_URL=http://localhost:3000
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=ChangeMe!123
```

Use Write tool to create the file. Verify the file exists and has all four required secrets non-empty.

**Important to tell the user:** the `ENCRYPTION_KEY` must never change after the first user adds DB connections. If lost, stored connection credentials are unrecoverable. They should back it up (a password manager is fine).

---

## Step 7 — Initialize the database schema and create the admin user

```powershell
npm run db:seed
```

This connects to RDS, runs the bootstrap (which creates all 16+ tables idempotently), seeds the three system roles (Admin, Editor, Viewer with their permission sets), and creates the admin user from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.

Expected output:

```
Created admin: admin@example.com / ChangeMe!123
Seed complete.
```

If it fails with `Connection terminated due to connection timeout`, the laptop's public IP probably isn't in `allowed_public_cidrs`. Re-check Step 3.4 and re-apply Terraform.

If it fails with `self-signed certificate in certificate chain`, the SSL config in `src/lib/db/client.ts` should already handle this (it sets `rejectUnauthorized: false`). If this error still appears, **stop and report it to the user** — the code may have regressed.

---

## Step 8 — Start the dev server

```powershell
npm run dev
```

Wait for the line `✓ Ready in <Ns>` in the output. The first page load triggers Next.js to compile that route lazily, so initial requests can take 10–30s. Subsequent loads are fast.

Verify it's up:

```powershell
Invoke-WebRequest -UseBasicParsing -Uri http://localhost:3000/api/auth/session -TimeoutSec 30
```

Should return HTTP 200 with body `null` (no session yet).

---

## Step 9 — Hand off

Tell the user:

> The app is ready. Open `http://localhost:3000`, sign in with:
> - Email: `admin@example.com`
> - Password: `ChangeMe!123`
>
> Once in: Settings → Email lets you configure SMTP. Connections → New connection lets you add your real databases. Flows → Try a sample creates a pre-wired example flow. Change the admin password from the Users page when you're ready.

---

## Cleanup later

If they want to tear down the AWS resources (RDS, ECR, secret):

```powershell
cd terraform
terraform destroy -var-file=terraform.tfvars
```

Takes ~5 minutes. Doesn't delete the local `.env` or the project files.

---

## Things you (Kiro) should NOT do

- Don't modify code in `src/`, `terraform/*.tf`, or `package.json` while doing setup — these are working as intended.
- Don't run `npm install` with a `--force` flag if you hit dependency conflicts; **stop and report** instead.
- Don't change `db_deletion_protection` to `true` mid-setup. The tfvars default is `false`, which is correct for dev.
- Don't `terraform apply` more than once in a row if the first one is still running. Always wait.
- Don't put real production credentials anywhere. This is a dev POC.
- Don't push secrets to git. `.env` is already `.gitignore`d.

If anything in this file conflicts with what the user tells you directly, the user wins. Ask before deviating.
