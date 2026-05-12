resource "aws_db_subnet_group" "this" {
  name       = "${local.name}-metadata"
  subnet_ids = var.private_subnet_ids
  tags       = { Name = "${local.name}-metadata" }
}

resource "aws_security_group" "db" {
  name        = "${local.name}-metadata-db"
  description = "Postgres access for the dbconnector metadata DB"
  vpc_id      = var.vpc_id
  tags        = { Name = "${local.name}-metadata-db" }
}

# Only allow ingress from the EKS workload security group. If you ever need to
# reach the DB from your laptop, add a /32 to `allowed_public_cidrs` — never
# leave 0.0.0.0/0 open on 5432.
resource "aws_security_group_rule" "db_ingress_eks" {
  count                    = local.has_eks ? 1 : 0
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.db.id
  source_security_group_id = local.eks_sg_id
  description              = "Postgres from EKS pods"
}

# Per-CIDR public ingress, only created when `allowed_public_cidrs` is non-empty.
# Using for_each (not count) so adding/removing one CIDR doesn't recreate the others.
resource "aws_security_group_rule" "db_ingress_public" {
  for_each          = toset(var.allowed_public_cidrs)
  type              = "ingress"
  from_port         = 5432
  to_port           = 5432
  protocol          = "tcp"
  security_group_id = aws_security_group.db.id
  cidr_blocks       = [each.value]
  description       = "Postgres from ${each.value}"
}

# Egress is implicit-deny for SGs by default; this opens it so the DB can do
# whatever it wants outbound (RDS uses this for snapshots, OS updates, etc).
resource "aws_security_group_rule" "db_egress_all" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  security_group_id = aws_security_group.db.id
  cidr_blocks       = ["0.0.0.0/0"]
  description       = "All egress"
}

# Force SSL on every connection. The app's pg client uses `ssl: rejectUnauthorized:false`
# by default; for higher trust, ship the RDS root CA in the image and pin it.
resource "aws_db_parameter_group" "this" {
  name        = "${local.name}-metadata-pg17"
  family      = "postgres17"
  description = "Parameter group for dbconnector metadata DB"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
}

resource "random_password" "db" {
  length           = 24
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "aws_db_instance" "this" {
  identifier     = "${local.name}-metadata"
  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  allocated_storage     = var.db_storage_gb
  max_allocated_storage = var.db_max_storage_gb
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db.result

  port                 = 5432
  db_subnet_group_name = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.db.id]
  parameter_group_name = aws_db_parameter_group.this.name

  multi_az            = var.db_multi_az
  publicly_accessible = length(var.allowed_public_cidrs) > 0

  backup_retention_period   = var.db_backup_retention_days
  backup_window             = "03:00-04:00"
  maintenance_window        = "Mon:04:00-Mon:05:00"
  copy_tags_to_snapshot     = true
  delete_automated_backups  = true

  auto_minor_version_upgrade = true
  apply_immediately          = true

  deletion_protection = var.db_deletion_protection
  skip_final_snapshot = var.db_skip_final_snapshot
  final_snapshot_identifier = var.db_skip_final_snapshot ? null : "${local.name}-metadata-final-${formatdate("YYYYMMDDHHmmss", timestamp())}"

  performance_insights_enabled = false
  monitoring_interval          = 0

  tags = { Name = "${local.name}-metadata" }

  lifecycle {
    ignore_changes = [final_snapshot_identifier]
  }
}
