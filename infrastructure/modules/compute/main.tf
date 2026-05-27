locals {
  name_prefix = "${var.project_name}-${var.environment}"
}

resource "aws_iam_role" "apprunner_instance" {
  name = "${local.name_prefix}-apprunner-instance"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "tasks.apprunner.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name = "${local.name_prefix}-apprunner-instance-role"
  }
}

resource "aws_iam_role_policy" "apprunner_instance" {
  name = "${local.name_prefix}-apprunner-instance-policy"
  role = aws_iam_role.apprunner_instance.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = var.secrets_arns
      },
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ]
        Resource = [
          "arn:aws:s3:::${local.name_prefix}-audio-blobs",
          "arn:aws:s3:::${local.name_prefix}-audio-blobs/*"
        ]
      }
    ]
  })
}

resource "aws_iam_role" "apprunner_ecr_access" {
  name = "${local.name_prefix}-apprunner-ecr-access"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "build.apprunner.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name = "${local.name_prefix}-apprunner-ecr-access-role"
  }
}

resource "aws_iam_role_policy_attachment" "apprunner_ecr_access" {
  role       = aws_iam_role.apprunner_ecr_access.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess"
}

resource "aws_apprunner_vpc_connector" "main" {
  vpc_connector_name = "${local.name_prefix}-vpc-connector"
  subnets            = var.private_subnet_ids
  security_groups    = [var.apprunner_security_group_id]

  tags = {
    Name = "${local.name_prefix}-vpc-connector"
  }
}

resource "aws_apprunner_auto_scaling_configuration_version" "main" {
  auto_scaling_configuration_name = "${local.name_prefix}-autoscaling"

  max_concurrency = 80
  max_size        = var.max_instances
  min_size        = var.min_instances

  tags = {
    Name = "${local.name_prefix}-autoscaling"
  }
}

resource "aws_apprunner_service" "api" {
  service_name = "${local.name_prefix}-api"

  source_configuration {
    authentication_configuration {
      access_role_arn = aws_iam_role.apprunner_ecr_access.arn
    }

    image_repository {
      image_configuration {
        port = "3000"

        runtime_environment_variables = {
          NODE_ENV       = var.environment
          DB_HOST        = split(":", var.db_endpoint)[0]
          DB_PORT        = "5432"
          DB_NAME        = "thoughtflow"
          REDIS_HOST     = var.redis_endpoint
          REDIS_PORT     = "6379"
          REDIS_TLS      = "true"
        }
      }

      image_identifier      = "${var.ecr_repository_url}:latest"
      image_repository_type = "ECR"
    }

    auto_deployments_enabled = false
  }

  instance_configuration {
    cpu               = tostring(var.cpu)
    memory            = tostring(var.memory)
    instance_role_arn = aws_iam_role.apprunner_instance.arn
  }

  network_configuration {
    egress_configuration {
      egress_type       = "VPC"
      vpc_connector_arn = aws_apprunner_vpc_connector.main.arn
    }
  }

  auto_scaling_configuration_arn = aws_apprunner_auto_scaling_configuration_version.main.arn

  health_check_configuration {
    protocol            = "HTTP"
    path                = "/health"
    interval            = 10
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = {
    Name = "${local.name_prefix}-api"
  }
}
