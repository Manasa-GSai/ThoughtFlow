variable "project_name" {
  description = "Project name for resource naming"
  type        = string
}

variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "ecr_repository_url" {
  description = "ECR repository URL"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for VPC connector"
  type        = list(string)
}

variable "apprunner_security_group_id" {
  description = "Security group ID for App Runner VPC connector"
  type        = string
}

variable "cpu" {
  description = "CPU units (1024 = 1 vCPU)"
  type        = number
}

variable "memory" {
  description = "Memory in MB"
  type        = number
}

variable "min_instances" {
  description = "Minimum number of instances"
  type        = number
}

variable "max_instances" {
  description = "Maximum number of instances"
  type        = number
}

variable "secrets_arns" {
  description = "List of Secrets Manager ARNs the service needs access to"
  type        = list(string)
}

variable "db_endpoint" {
  description = "Database endpoint for environment variable injection"
  type        = string
}

variable "redis_endpoint" {
  description = "Redis endpoint for environment variable injection"
  type        = string
}
