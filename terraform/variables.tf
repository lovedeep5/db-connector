variable "aws_region" {
  description = "AWS region to deploy into. Should match your EKS cluster's region."
  type        = string
}

variable "name_prefix" {
  description = "Prefix applied to every resource name. Lets you run multiple environments side-by-side."
  type        = string
  default     = "dbconnector"
}

variable "tags" {
  description = "Tags applied to every resource."
  type        = map(string)
  default = {
    Project   = "dbconnector"
    ManagedBy = "terraform"
  }
}

# ─── Networking (bring your own VPC) ─────────────────────────────────────────

variable "vpc_id" {
  description = "ID of the VPC where the EKS cluster lives. RDS will sit in the same VPC for free intra-VPC traffic."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs (typically 2+ AZs) for the RDS subnet group. Single-AZ DB is allowed; multiple subnets are still required by AWS."
  type        = list(string)
  validation {
    condition     = length(var.private_subnet_ids) >= 2
    error_message = "RDS requires a subnet group spanning at least 2 availability zones."
  }
}

# Either pass eks_cluster_name (we'll auto-discover the cluster security group)
# or eks_node_security_group_id (you supply it directly).

variable "eks_cluster_name" {
  description = "Existing EKS cluster name. If set, we auto-derive its security group (for DB ingress) and OIDC issuer URL (for IRSA)."
  type        = string
  default     = ""
}

variable "eks_node_security_group_id" {
  description = "Security group ID used by EKS worker nodes / pods. Optional fallback if eks_cluster_name is not set."
  type        = string
  default     = ""
}

# ─── RDS PostgreSQL ─────────────────────────────────────────────────────────

variable "db_instance_class" {
  description = "RDS instance class. db.t4g.micro is the cheapest Postgres-compatible class (~$11.68/mo)."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_engine_version" {
  description = "Postgres engine version. Use latest available minor for the major you target."
  type        = string
  default     = "17.4"
}

variable "db_storage_gb" {
  description = "Initial allocated storage in GB. gp3 minimum is 20."
  type        = number
  default     = 20
}

variable "db_max_storage_gb" {
  description = "Storage autoscaling ceiling. 0 disables autoscaling."
  type        = number
  default     = 100
}

variable "db_name" {
  description = "Database name created at provisioning. The app expects this database to exist."
  type        = string
  default     = "dbconnector"
}

variable "db_username" {
  description = "Master DB username. Generated password is stored in Secrets Manager."
  type        = string
  default     = "dbconnector"
}

variable "db_backup_retention_days" {
  description = "Automated backup retention (days). Free up to the size of provisioned storage."
  type        = number
  default     = 7
}

variable "db_multi_az" {
  description = "Multi-AZ failover. Doubles cost; only worth it for production."
  type        = bool
  default     = false
}

variable "db_deletion_protection" {
  description = "Block terraform destroy / RDS console delete until disabled. Turn ON for production."
  type        = bool
  default     = false
}

variable "db_skip_final_snapshot" {
  description = "Skip the final snapshot when the DB is destroyed. Useful for dev; set false in prod."
  type        = bool
  default     = true
}

# ─── Optional public access (local dev) ────────────────────────────────────
#
# Leave empty for production: RDS stays inside the VPC, reachable only from
# EKS or a bastion. To develop locally against the real DB, set this to your
# laptop's public IP as a /32 CIDR. The list is also accepted for office IPs.

variable "allowed_public_cidrs" {
  description = "Optional list of CIDR blocks allowed to reach the DB over the public internet (e.g. [\"203.0.113.42/32\"]). When non-empty, RDS publicly_accessible is enabled."
  type        = list(string)
  default     = []
}

# ─── ECR ─────────────────────────────────────────────────────────────────────

variable "create_ecr" {
  description = "Create an ECR repository to hold the dbconnector container image."
  type        = bool
  default     = true
}

variable "ecr_repository_name" {
  description = "Name of the ECR repository to create."
  type        = string
  default     = "dbconnector"
}
