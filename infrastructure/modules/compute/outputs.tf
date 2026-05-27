output "service_url" {
  description = "App Runner service URL"
  value       = aws_apprunner_service.api.service_url
}

output "service_arn" {
  description = "App Runner service ARN"
  value       = aws_apprunner_service.api.arn
}

output "service_id" {
  description = "App Runner service ID"
  value       = aws_apprunner_service.api.service_id
}
