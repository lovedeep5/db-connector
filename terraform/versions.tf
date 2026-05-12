terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Local state by default — fine for an MVP / one-person workflow.
  # For team use, uncomment the S3 backend below and `terraform init -migrate-state`.
  #
  # backend "s3" {
  #   bucket         = "your-tfstate-bucket"
  #   key            = "dbconnector/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "your-tflock-table"
  #   encrypt        = true
  # }
}
