variable "project_name" {
  description = "Project name for resource naming"
  type        = string
}

variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for the DB subnet group"
  type        = list(string)
}

variable "db_security_group_id" {
  description = "Security group ID for the database"
  type        = string
}

variable "instance_class" {
  description = "RDS instance class"
  type        = string
}

variable "allocated_storage" {
  description = "Allocated storage in GB"
  type        = number
}

variable "max_allocated_storage" {
  description = "Max allocated storage for autoscaling in GB"
  type        = number
}

variable "backup_retention_period" {
  description = "Number of days to retain automated backups"
  type        = number
  default     = 30
}

variable "enable_read_replica" {
  description = "Whether to create a read replica"
  type        = bool
  default     = false
}

variable "db_credentials_secret_arn" {
  description = "ARN of the Secrets Manager secret containing DB credentials"
  type        = string
}
