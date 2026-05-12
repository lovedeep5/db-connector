provider "aws" {
  region = var.aws_region
  default_tags {
    tags = var.tags
  }
}

locals {
  name = var.name_prefix
}

# Read the existing EKS cluster only when its name was provided. We use it for:
#   - the cluster security group (to allow pod traffic to the DB)
#   - the OIDC issuer URL (for IRSA so pods can read Secrets Manager)
data "aws_eks_cluster" "this" {
  count = var.eks_cluster_name == "" ? 0 : 1
  name  = var.eks_cluster_name
}

# Which security group to allow on the DB? Prefer the explicit value; otherwise
# use the cluster security group exposed by the EKS data source.
locals {
  eks_sg_id = (
    var.eks_node_security_group_id != ""
    ? var.eks_node_security_group_id
    : (length(data.aws_eks_cluster.this) > 0
      ? data.aws_eks_cluster.this[0].vpc_config[0].cluster_security_group_id
      : "")
  )

  has_eks = var.eks_cluster_name != "" || var.eks_node_security_group_id != ""
}
