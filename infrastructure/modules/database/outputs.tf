output "db_endpoint" {
  description = "Primary database endpoint"
  value       = aws_db_instance.primary.endpoint
}

output "db_read_replica_endpoint" {
  description = "Read replica endpoint (empty if not created)"
  value       = var.enable_read_replica ? aws_db_instance.read_replica[0].endpoint : ""
}

output "db_name" {
  description = "Database name"
  value       = aws_db_instance.primary.db_name
}

output "db_port" {
  description = "Database port"
  value       = aws_db_instance.primary.port
}
