terraform {
  backend "s3" {
    bucket         = "thoughtflow-terraform-state"
    key            = "infrastructure/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "thoughtflow-terraform-locks"
  }
}
