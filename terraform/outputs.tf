output "db_endpoint" {
  description = "DB host:port (informational; pull the real connection string from Secrets Manager)."
  value       = "${aws_db_instance.this.address}:${aws_db_instance.this.port}"
}

output "db_name" {
  description = "Database name created on the instance."
  value       = aws_db_instance.this.db_name
}

output "db_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the full connection URL and credentials."
  value       = aws_secretsmanager_secret.db.arn
}

output "db_secret_name" {
  description = "Name of the Secrets Manager secret (use this with the AWS CLI to fetch the URL)."
  value       = aws_secretsmanager_secret.db.name
}

output "ecr_repository_url" {
  description = "Push your built image here: docker push <ecr_repository_url>:<tag>"
  value       = var.create_ecr ? aws_ecr_repository.app[0].repository_url : null
}

output "pod_role_arn" {
  description = "Annotate your K8s ServiceAccount with eks.amazonaws.com/role-arn: <this>"
  value       = var.eks_cluster_name == "" ? null : aws_iam_role.pod[0].arn
}

output "service_account_namespace" {
  description = "K8s namespace the IRSA trust policy expects."
  value       = local.k8s_namespace
}

output "service_account_name" {
  description = "K8s ServiceAccount name the IRSA trust policy expects."
  value       = local.k8s_service_account
}

output "fetch_db_url_command" {
  description = "Run this locally to print the Postgres URL (after `aws configure`)."
  value       = "aws secretsmanager get-secret-value --secret-id ${aws_secretsmanager_secret.db.name} --query SecretString --output text | jq -r .url"
}
