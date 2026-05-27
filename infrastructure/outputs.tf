output "vpc_id" {
  description = "VPC ID"
  value       = module.networking.vpc_id
}

output "apprunner_service_url" {
  description = "App Runner service URL"
  value       = module.compute.service_url
}

output "ecr_repository_url" {
  description = "ECR repository URL for pushing container images"
  value       = module.container_registry.repository_url
}

output "db_endpoint" {
  description = "RDS PostgreSQL endpoint"
  value       = module.database.db_endpoint
  sensitive   = true
}

output "redis_endpoint" {
  description = "ElastiCache Redis endpoint"
  value       = module.redis.redis_endpoint
  sensitive   = true
}

output "audio_bucket_name" {
  description = "S3 bucket for transient audio storage"
  value       = module.storage.audio_bucket_name
}

output "certificate_arn" {
  description = "ACM certificate ARN"
  value       = module.dns_tls.certificate_arn
}

output "db_credentials_secret_arn" {
  description = "ARN of the Secrets Manager secret for database credentials"
  value       = module.secrets.db_credentials_secret_arn
  sensitive   = true
}
