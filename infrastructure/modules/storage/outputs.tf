output "audio_bucket_name" {
  description = "Audio blobs S3 bucket name"
  value       = aws_s3_bucket.audio.bucket
}

output "audio_bucket_arn" {
  description = "Audio blobs S3 bucket ARN"
  value       = aws_s3_bucket.audio.arn
}
