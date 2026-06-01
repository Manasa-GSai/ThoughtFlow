module "networking" {
  source = "./modules/networking"

  project_name       = var.project_name
  environment        = var.environment
  vpc_cidr           = var.vpc_cidr
  availability_zones = var.availability_zones
}

module "secrets" {
  source = "./modules/secrets"

  project_name = var.project_name
  environment  = var.environment
}

module "database" {
  source = "./modules/database"

  project_name             = var.project_name
  environment              = var.environment
  vpc_id                   = module.networking.vpc_id
  private_subnet_ids       = module.networking.private_subnet_ids
  db_security_group_id     = module.networking.db_security_group_id
  instance_class           = var.db_instance_class
  allocated_storage        = var.db_allocated_storage
  max_allocated_storage    = var.db_max_allocated_storage
  backup_retention_period  = var.db_backup_retention_days
  enable_read_replica      = var.enable_read_replica
  db_credentials_secret_arn = module.secrets.db_credentials_secret_arn
}

module "redis" {
  source = "./modules/redis"

  project_name          = var.project_name
  environment           = var.environment
  private_subnet_ids    = module.networking.private_subnet_ids
  redis_security_group_id = module.networking.redis_security_group_id
  node_type             = var.redis_node_type
}

module "storage" {
  source = "./modules/storage"

  project_name = var.project_name
  environment  = var.environment
}

module "container_registry" {
  source = "./modules/container_registry"

  project_name = var.project_name
  environment  = var.environment
}

module "compute" {
  source = "./modules/compute"

  project_name       = var.project_name
  environment        = var.environment
  ecr_repository_url = module.container_registry.repository_url
  vpc_id             = module.networking.vpc_id
  private_subnet_ids = module.networking.private_subnet_ids
  apprunner_security_group_id = module.networking.apprunner_security_group_id
  cpu                = var.apprunner_cpu
  memory             = var.apprunner_memory
  min_instances      = var.apprunner_min_instances
  max_instances      = var.apprunner_max_instances
  secrets_arns       = module.secrets.all_secret_arns
  db_endpoint        = module.database.db_endpoint
  redis_endpoint     = module.redis.redis_endpoint
}

module "dns_tls" {
  source = "./modules/dns_tls"

  project_name = var.project_name
  environment  = var.environment
  domain_name  = var.domain_name
}
