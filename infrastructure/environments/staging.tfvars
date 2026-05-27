environment        = "staging"
aws_region         = "us-east-1"
domain_name        = "thoughtflow.app"
vpc_cidr           = "10.1.0.0/16"
availability_zones = ["us-east-1a", "us-east-1b"]

# Compute — moderate for staging
apprunner_cpu           = 1024
apprunner_memory        = 2048
apprunner_min_instances = 1
apprunner_max_instances = 5

# Database — moderate for staging
db_instance_class        = "db.t3.small"
db_allocated_storage     = 20
db_max_allocated_storage = 100
db_backup_retention_days = 14
enable_read_replica      = false

# Redis — moderate for staging
redis_node_type = "cache.t3.small"
