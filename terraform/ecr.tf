resource "aws_ecr_repository" "app" {
  count                = var.create_ecr ? 1 : 0
  name                 = var.ecr_repository_name
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

# Keep only the 20 most-recent images; older ones get auto-pruned.
# Stops ECR storage costs from creeping up as you iterate on the image.
resource "aws_ecr_lifecycle_policy" "app" {
  count      = var.create_ecr ? 1 : 0
  repository = aws_ecr_repository.app[0].name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 20 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 20
      }
      action = { type = "expire" }
    }]
  })
}
