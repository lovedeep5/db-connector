# IRSA (IAM Roles for Service Accounts): the EKS service account our pod uses
# assumes this role at runtime, so the pod can `secretsmanager:GetSecretValue`
# on its own DB secret without any static AWS credentials baked in.
#
# After apply, annotate the K8s ServiceAccount:
#   eks.amazonaws.com/role-arn: <pod_role_arn from outputs>

data "aws_caller_identity" "current" {}

# OIDC provider URL for the cluster. Skipped if no EKS cluster name was provided.
data "aws_iam_openid_connect_provider" "eks" {
  count = var.eks_cluster_name == "" ? 0 : 1
  url   = data.aws_eks_cluster.this[0].identity[0].oidc[0].issuer
}

locals {
  oidc_provider_arn = (
    length(data.aws_iam_openid_connect_provider.eks) > 0
    ? data.aws_iam_openid_connect_provider.eks[0].arn
    : ""
  )
  oidc_provider_url = (
    length(data.aws_eks_cluster.this) > 0
    ? replace(data.aws_eks_cluster.this[0].identity[0].oidc[0].issuer, "https://", "")
    : ""
  )

  # The K8s ServiceAccount we expect the pod to run as.
  # Override these defaults to whatever you actually deploy with.
  k8s_namespace       = "default"
  k8s_service_account = "dbconnector"
}

data "aws_iam_policy_document" "pod_trust" {
  count = var.eks_cluster_name == "" ? 0 : 1

  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_provider_url}:sub"
      values   = ["system:serviceaccount:${local.k8s_namespace}:${local.k8s_service_account}"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_provider_url}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "pod" {
  count              = var.eks_cluster_name == "" ? 0 : 1
  name               = "${local.name}-pod"
  assume_role_policy = data.aws_iam_policy_document.pod_trust[0].json
}

data "aws_iam_policy_document" "pod_permissions" {
  count = var.eks_cluster_name == "" ? 0 : 1

  statement {
    sid       = "ReadDbSecret"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = [aws_secretsmanager_secret.db.arn]
  }
}

resource "aws_iam_policy" "pod" {
  count  = var.eks_cluster_name == "" ? 0 : 1
  name   = "${local.name}-pod"
  policy = data.aws_iam_policy_document.pod_permissions[0].json
}

resource "aws_iam_role_policy_attachment" "pod" {
  count      = var.eks_cluster_name == "" ? 0 : 1
  role       = aws_iam_role.pod[0].name
  policy_arn = aws_iam_policy.pod[0].arn
}
