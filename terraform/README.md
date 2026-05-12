# DBConnector — AWS infrastructure

Terraform that provisions everything the app needs on AWS:

- **RDS PostgreSQL** (`db.t4g.micro`, single-AZ, gp3, 20 GB, `force_ssl=1`) — the metadata DB.
- **Secrets Manager** secret with the full connection URL (`postgres://…?sslmode=require`) and structured fields, ready for AWS-native rotation if you ever turn it on.
- **ECR** repository for the application image, with a "keep last 20" lifecycle rule so old images don't pile up.
- **IAM role for IRSA** — your EKS pod's ServiceAccount assumes this to read the DB secret. No static AWS keys in the cluster.
- **Security group** that only allows inbound 5432 from the EKS workload SG.

## What you need first

- AWS CLI configured (`aws configure` with an IAM principal that can create RDS, Secrets Manager, IAM, ECR).
- An **existing EKS cluster + VPC** (this stack does not provision EKS).
- Terraform `>= 1.6`.

## Quickstart

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars: fill in aws_region, vpc_id, private_subnet_ids, eks_cluster_name

terraform init
terraform plan
terraform apply
```

First-time apply takes ~8-12 minutes (RDS creation is the slow part).

## Outputs you'll use

```bash
terraform output db_secret_arn          # paste into your K8s manifest
terraform output ecr_repository_url     # docker push target
terraform output pod_role_arn           # K8s ServiceAccount annotation
terraform output fetch_db_url_command   # copy-paste to print the Postgres URL
```

## Hooking the app to RDS

After apply, your K8s `ServiceAccount` and `Deployment` should look roughly like:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: dbconnector
  namespace: default
  annotations:
    eks.amazonaws.com/role-arn: <output: pod_role_arn>
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: dbconnector-web }
spec:
  replicas: 2
  template:
    spec:
      serviceAccountName: dbconnector
      containers:
      - name: app
        image: <output: ecr_repository_url>:<tag>
        env:
        - name: METADATA_DATABASE_URL
          valueFrom:
            secretKeyRef:
              # populated by external-secrets-operator from the RDS secret;
              # or fetch at boot via the AWS SDK using the IRSA role.
              name: dbconnector-db
              key: url
        - name: AUTH_SECRET
          valueFrom: { secretKeyRef: { name: dbconnector-app, key: auth_secret } }
        - name: ENCRYPTION_KEY
          valueFrom: { secretKeyRef: { name: dbconnector-app, key: encryption_key } }
```

We'll wire this up in the app migration step (next phase).

## Cost (after AWS Free Tier — first 12 months are $0 for new accounts)

| Item | Monthly |
|---|---|
| `db.t4g.micro` Postgres single-AZ | ~$11.68 |
| 20 GB gp3 storage | ~$2.30 |
| 7-day automated backups (≤ provisioned size) | $0 |
| Secrets Manager (1 secret) | $0.40 |
| ECR storage (a few image layers) | ~$0.10 |
| **Total** | **~$14/month** |

Set `db_multi_az = true` to double the instance cost in exchange for auto-failover (only worth it for production).

## Easy cleanup

```bash
terraform destroy
```

Defaults are tuned for clean teardown:

- `db_deletion_protection = false`
- `db_skip_final_snapshot = true`
- Secrets Manager `recovery_window_in_days = 0` (immediate delete)
- ECR `image_tag_mutability = MUTABLE` and the repo is force-deleted via lifecycle

For **production**, flip these:

```hcl
db_deletion_protection = true
db_skip_final_snapshot = false
```

(Then a `terraform destroy` will fail until you flip them back — that's the point.)

## Notes

- The `db_engine_version` default tracks Postgres 17 (`17.4`). RDS auto-applies minor updates inside the maintenance window.
- The DB is **not publicly accessible**. Reach it via a port-forward from an EKS pod (`kubectl exec` into any pod and `psql`) or a bastion.
- The IRSA trust policy assumes your K8s ServiceAccount is `default/dbconnector`. Edit `iam.tf` `local.k8s_namespace` / `k8s_service_account` if you use different names.
- State file is local by default. Once a teammate joins, uncomment the S3 backend in `versions.tf`.
