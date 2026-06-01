output "certificate_arn" {
  description = "ACM certificate ARN"
  value       = aws_acm_certificate.api.arn
}

output "certificate_domain" {
  description = "Domain the certificate is issued for"
  value       = local.api_domain
}

output "zone_id" {
  description = "Route53 hosted zone ID"
  value       = local.zone_id
}
