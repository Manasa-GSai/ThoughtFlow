locals {
  name_prefix = "${var.project_name}-${var.environment}"
}

resource "aws_s3_bucket" "audio" {
  bucket = "${local.name_prefix}-audio-blobs"

  tags = {
    Name    = "${local.name_prefix}-audio-blobs"
    Purpose = "Transient audio storage for voice captures"
  }
}

resource "aws_s3_bucket_versioning" "audio" {
  bucket = aws_s3_bucket.audio.id

  versioning_configuration {
    status = "Suspended"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "audio" {
  bucket = aws_s3_bucket.audio.id

  rule {
    id     = "auto-delete-after-1-hour"
    status = "Enabled"

    expiration {
      days = 1
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }

    filter {
      prefix = ""
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audio" {
  bucket = aws_s3_bucket.audio.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "audio" {
  bucket = aws_s3_bucket.audio.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "audio_ssl_only" {
  bucket = aws_s3_bucket.audio.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "EnforceSSLOnly"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.audio.arn,
          "${aws_s3_bucket.audio.arn}/*"
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      }
    ]
  })
}
