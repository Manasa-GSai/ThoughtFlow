environment        = "dev"
aws_region         = "us-east-1"
domain_name        = "thoughtflow.app"
vpc_cidr           = "10.0.0.0/16"
availability_zones = ["us-east-1a", "us-east-1b"]

# Compute — smaller footprint for dev
apprunner_cpu           = 1024
apprunner_memory        = 2048
apprunner_min_instances = 1
apprunner_max_instances = 3

# Database — minimal for dev
db_instance_class        = "db.t3.micro"
db_allocated_storage     = 20
db_max_allocated_storage = 50
db_backup_retention_days = 7
enable_read_replica      = false

# Redis — small node for dev
redis_node_type = "cache.t3.micro"
