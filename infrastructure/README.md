# ThoughtFlow Infrastructure

Terraform IaC for provisioning ThoughtFlow's cloud infrastructure on AWS.

## Architecture

- **Compute**: AWS App Runner (managed container platform with autoscaling)
- **Database**: RDS PostgreSQL 15 (encrypted, automated backups, read replica in prod)
- **Cache**: ElastiCache Redis 7 (TLS-enabled, private subnet)
- **Storage**: S3 (transient audio blobs with 1-hour lifecycle auto-delete)
- **Container Registry**: ECR (immutable tags, vulnerability scanning)
- **Networking**: VPC with public/private subnets, NAT gateways, security groups
- **Secrets**: AWS Secrets Manager (DB credentials, API keys, JWT secret)
- **DNS/TLS**: Route53 + ACM (managed certificates with DNS validation)

## Environments

| Environment | VPC CIDR | Compute Scale | DB | Redis |
|---|---|---|---|---|
| dev | 10.0.0.0/16 | 1-3 instances | db.t3.micro | cache.t3.micro |
| staging | 10.1.0.0/16 | 1-5 instances | db.t3.small | cache.t3.small |
| production | 10.2.0.0/16 | 2-20 instances | db.t3.medium + replica | cache.t3.medium |

## Usage

### Prerequisites

- Terraform >= 1.5.0
- AWS CLI configured with appropriate credentials
- S3 bucket `thoughtflow-terraform-state` for remote state
- DynamoDB table `thoughtflow-terraform-locks` for state locking

### Deploy an Environment

```bash
cd infrastructure

# Initialize
terraform init

# Plan for a specific environment
terraform plan -var-file=environments/dev.tfvars

# Apply
terraform apply -var-file=environments/dev.tfvars

# Destroy (non-production only)
terraform destroy -var-file=environments/dev.tfvars
```

### Using Workspaces

```bash
terraform workspace new dev
terraform workspace new staging
terraform workspace new production

terraform workspace select dev
terraform apply -var-file=environments/dev.tfvars
```

## Security

- Database and Redis are in private subnets with no public IP
- Only App Runner (via VPC connector) can reach data services
- All secrets stored in AWS Secrets Manager
- S3 bucket enforces SSL-only access
- ECR images scanned on push
- TLS certificates managed via ACM

## Module Structure

```
infrastructure/
├── main.tf                    # Root module composition
├── variables.tf               # Input variables
├── outputs.tf                 # Root outputs
├── providers.tf               # Provider configuration
├── backend.tf                 # Remote state configuration
├── environments/              # Per-environment variable files
│   ├── dev.tfvars
│   ├── staging.tfvars
│   └── production.tfvars
└── modules/
    ├── networking/            # VPC, subnets, NAT, security groups
    ├── database/              # RDS PostgreSQL
    ├── redis/                 # ElastiCache Redis
    ├── storage/               # S3 buckets
    ├── container_registry/    # ECR + CI/CD IAM
    ├── compute/               # App Runner
    ├── secrets/               # Secrets Manager
    └── dns_tls/               # Route53 + ACM
```
