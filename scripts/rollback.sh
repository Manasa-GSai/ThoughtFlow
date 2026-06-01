#!/bin/bash
set -euo pipefail

SERVICE_ARN="${1:?Usage: rollback.sh <service-arn> [image-tag]}"
IMAGE_TAG="${2:-}"
REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION:-us-east-1}.amazonaws.com"
IMAGE_NAME="thoughtflow-api"

if [ -z "$IMAGE_TAG" ]; then
  echo "No image tag specified, fetching previous deployment..."
  IMAGE_TAG=$(aws apprunner list-operations \
    --service-arn "$SERVICE_ARN" \
    --query 'OperationSummaryList[1].Id' --output text)
  echo "Note: Manual tag specification recommended. Use: $0 <service-arn> <image-tag>"
  exit 1
fi

FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"
echo "Rolling back to: $FULL_IMAGE"

aws apprunner update-service \
  --service-arn "$SERVICE_ARN" \
  --source-configuration "{
    \"ImageRepository\": {
      \"ImageIdentifier\": \"${FULL_IMAGE}\",
      \"ImageRepositoryType\": \"ECR\",
      \"ImageConfiguration\": {
        \"Port\": \"3000\"
      }
    },
    \"AutoDeploymentsEnabled\": false
  }"

echo "Waiting for rollback to complete..."
for i in $(seq 1 30); do
  STATUS=$(aws apprunner describe-service \
    --service-arn "$SERVICE_ARN" \
    --query 'Service.Status' --output text)
  if [ "$STATUS" = "RUNNING" ]; then
    echo "Rollback successful - service is running"
    exit 0
  elif [ "$STATUS" = "OPERATION_FAILED" ]; then
    echo "Rollback failed!"
    exit 1
  fi
  echo "Status: $STATUS - waiting... ($i/30)"
  sleep 20
done

echo "Rollback timed out"
exit 1
