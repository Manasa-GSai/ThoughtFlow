output "repository_url" {
  description = "ECR repository URL"
  value       = aws_ecr_repository.api.repository_url
}

output "repository_arn" {
  description = "ECR repository ARN"
  value       = aws_ecr_repository.api.arn
}

output "cicd_role_arn" {
  description = "IAM role ARN for CI/CD to push images"
  value       = aws_iam_role.cicd_ecr_push.arn
}
