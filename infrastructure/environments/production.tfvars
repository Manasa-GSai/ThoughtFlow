environment        = "production"
aws_region         = "us-east-1"
domain_name        = "thoughtflow.app"
vpc_cidr           = "10.2.0.0/16"
availability_zones = ["us-east-1a", "us-east-1b", "us-east-1c"]

# Compute — production scale (min 2, max 20 per acceptance criteria)
apprunner_cpu           = 1024
apprunner_memory        = 2048
apprunner_min_instances = 2
apprunner_max_instances = 20

# Database — production scale with read replica
db_instance_class        = "db.t3.medium"
db_allocated_storage     = 50
db_max_allocated_storage = 500
db_backup_retention_days = 30
enable_read_replica      = true

# Redis — production scale
redis_node_type = "cache.t3.medium"
