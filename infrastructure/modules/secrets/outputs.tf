output "db_credentials_secret_arn" {
  description = "ARN of the database credentials secret"
  value       = aws_secretsmanager_secret.db_credentials.arn
}

output "whisper_api_key_secret_arn" {
  description = "ARN of the Whisper API key secret"
  value       = aws_secretsmanager_secret.whisper_api_key.arn
}

output "claude_api_key_secret_arn" {
  description = "ARN of the Claude API key secret"
  value       = aws_secretsmanager_secret.claude_api_key.arn
}

output "stripe_api_key_secret_arn" {
  description = "ARN of the Stripe API key secret"
  value       = aws_secretsmanager_secret.stripe_api_key.arn
}

output "jwt_secret_arn" {
  description = "ARN of the JWT signing secret"
  value       = aws_secretsmanager_secret.jwt_secret.arn
}

output "all_secret_arns" {
  description = "List of all secret ARNs for IAM policy attachment"
  value = [
    aws_secretsmanager_secret.db_credentials.arn,
    aws_secretsmanager_secret.whisper_api_key.arn,
    aws_secretsmanager_secret.claude_api_key.arn,
    aws_secretsmanager_secret.stripe_api_key.arn,
    aws_secretsmanager_secret.jwt_secret.arn,
  ]
}
