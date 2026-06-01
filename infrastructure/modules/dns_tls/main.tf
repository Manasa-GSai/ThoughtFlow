locals {
  name_prefix = "${var.project_name}-${var.environment}"
  api_domain  = var.environment == "production" ? "api.${var.domain_name}" : "api-${var.environment}.${var.domain_name}"
}

resource "aws_acm_certificate" "api" {
  domain_name       = local.api_domain
  validation_method = "DNS"

  subject_alternative_names = [
    local.api_domain
  ]

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "${local.name_prefix}-api-cert"
  }
}

resource "aws_route53_zone" "main" {
  count = var.environment == "production" ? 1 : 0
  name  = var.domain_name

  tags = {
    Name = "${local.name_prefix}-hosted-zone"
  }
}

data "aws_route53_zone" "existing" {
  count        = var.environment != "production" ? 1 : 0
  name         = var.domain_name
  private_zone = false
}

locals {
  zone_id = var.environment == "production" ? aws_route53_zone.main[0].zone_id : data.aws_route53_zone.existing[0].zone_id
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.api.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = local.zone_id
}

resource "aws_acm_certificate_validation" "api" {
  certificate_arn         = aws_acm_certificate.api.arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}
