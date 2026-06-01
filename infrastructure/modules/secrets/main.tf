locals {
  name_prefix = "${var.project_name}-${var.environment}"
}

resource "random_password" "db_password" {
  length  = 32
  special = true
  override_special = "!#$%&*()-_=+[]{}|:?,."
}

resource "aws_secretsmanager_secret" "db_credentials" {
  name        = "${local.name_prefix}/database/credentials"
  description = "PostgreSQL database credentials for ThoughtFlow ${var.environment}"

  recovery_window_in_days = var.environment == "production" ? 30 : 0

  tags = {
    Name = "${local.name_prefix}-db-credentials"
  }
}

resource "aws_secretsmanager_secret_version" "db_credentials" {
  secret_id = aws_secretsmanager_secret.db_credentials.id

  secret_string = jsonencode({
    username = "thoughtflow_app"
    password = random_password.db_password.result
    dbname   = "thoughtflow"
    port     = 5432
  })
}

resource "aws_secretsmanager_secret" "whisper_api_key" {
  name        = "${local.name_prefix}/api-keys/openai-whisper"
  description = "OpenAI Whisper API key for ThoughtFlow ${var.environment}"

  recovery_window_in_days = var.environment == "production" ? 30 : 0

  tags = {
    Name = "${local.name_prefix}-whisper-api-key"
  }
}

resource "aws_secretsmanager_secret" "claude_api_key" {
  name        = "${local.name_prefix}/api-keys/anthropic-claude"
  description = "Anthropic Claude API key for ThoughtFlow ${var.environment}"

  recovery_window_in_days = var.environment == "production" ? 30 : 0

  tags = {
    Name = "${local.name_prefix}-claude-api-key"
  }
}

resource "aws_secretsmanager_secret" "stripe_api_key" {
  name        = "${local.name_prefix}/api-keys/stripe"
  description = "Stripe API key for ThoughtFlow ${var.environment}"

  recovery_window_in_days = var.environment == "production" ? 30 : 0

  tags = {
    Name = "${local.name_prefix}-stripe-api-key"
  }
}

resource "aws_secretsmanager_secret" "jwt_secret" {
  name        = "${local.name_prefix}/auth/jwt-secret"
  description = "JWT signing secret for ThoughtFlow ${var.environment}"

  recovery_window_in_days = var.environment == "production" ? 30 : 0

  tags = {
    Name = "${local.name_prefix}-jwt-secret"
  }
}

resource "random_password" "jwt_secret" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret_version" "jwt_secret" {
  secret_id     = aws_secretsmanager_secret.jwt_secret.id
  secret_string = random_password.jwt_secret.result
}
