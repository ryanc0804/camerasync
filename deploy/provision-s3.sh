#!/usr/bin/env bash
# Provision recording storage on AWS (SCRUM-102).
#
# Creates, idempotently:
#   - a private S3 bucket "8kount-recordings-<account-id>" (public access
#     blocked, SSE-S3 encryption, incomplete multipart uploads aborted after
#     a day)
#   - an IAM user "8kount-server" whose only permission is object access on
#     that bucket, plus one access key for it
#
# Prints the lines to paste into deploy/prod.env on the instance.
#
# Requires: aws cli configured as an admin (aws sts get-caller-identity works).
# Usage:    bash deploy/provision-s3.sh
#           AWS_REGION=us-west-2 bash deploy/provision-s3.sh
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
USER_NAME="8kount-server"
POLICY_NAME="8kount-recordings-access"
export AWS_DEFAULT_REGION="$REGION"

log() { printf '\n==> %s\n' "$*"; }

log "Account"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
aws sts get-caller-identity --query Arn --output text
BUCKET="${S3_BUCKET:-8kount-recordings-${ACCOUNT_ID}}"

# ---------------------------------------------------------------- bucket
log "Bucket $BUCKET ($REGION)"
if aws s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  echo "exists"
else
  if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$BUCKET" >/dev/null
  else
    aws s3api create-bucket --bucket "$BUCKET" \
      --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
  fi
  echo "created"
fi
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration '{
  "Rules": [{
    "ID": "abort-incomplete-multipart",
    "Status": "Enabled",
    "Filter": {},
    "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 1}
  }]
}'
aws s3api put-bucket-tagging --bucket "$BUCKET" --tagging 'TagSet=[{Key=Project,Value=8kount}]'
echo "public access blocked, encryption on, stale multipart uploads expire after 1 day"

# ---------------------------------------------------------------- iam user
log "IAM user $USER_NAME"
if aws iam get-user --user-name "$USER_NAME" >/dev/null 2>&1; then
  echo "exists"
else
  aws iam create-user --user-name "$USER_NAME" --tags Key=Project,Value=8kount >/dev/null
  echo "created"
fi

# Least privilege: the server only ever puts, gets and deletes objects under
# the bucket, plus the multipart calls lib-storage uses for large files.
aws iam put-user-policy --user-name "$USER_NAME" --policy-name "$POLICY_NAME" --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    {
      \"Sid\": \"BucketAccess\",
      \"Effect\": \"Allow\",
      \"Action\": [\"s3:ListBucket\", \"s3:ListBucketMultipartUploads\"],
      \"Resource\": \"arn:aws:s3:::${BUCKET}\"
    },
    {
      \"Sid\": \"ObjectAccess\",
      \"Effect\": \"Allow\",
      \"Action\": [
        \"s3:PutObject\", \"s3:GetObject\", \"s3:DeleteObject\",
        \"s3:AbortMultipartUpload\", \"s3:ListMultipartUploadParts\"
      ],
      \"Resource\": \"arn:aws:s3:::${BUCKET}/*\"
    }
  ]
}"
echo "policy $POLICY_NAME attached"

# ---------------------------------------------------------------- access key
log "Access key"
KEY_COUNT="$(aws iam list-access-keys --user-name "$USER_NAME" --query 'length(AccessKeyMetadata)' --output text)"
if [ "$KEY_COUNT" != "0" ]; then
  echo "$KEY_COUNT key(s) already exist. AWS cannot show a secret again; to rotate, delete one with:"
  aws iam list-access-keys --user-name "$USER_NAME" --query 'AccessKeyMetadata[].AccessKeyId' --output text | tr '\t' '\n' | sed 's/^/  aws iam delete-access-key --user-name '"$USER_NAME"' --access-key-id /'
  ACCESS_KEY_ID="<existing key id>"
  SECRET="<its secret, from when it was created>"
else
  read -r ACCESS_KEY_ID SECRET < <(aws iam create-access-key --user-name "$USER_NAME" \
    --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)
  echo "created (the secret is shown once, below)"
fi

log "Done"
cat <<EOT
Add these lines to deploy/prod.env on the instance, then run  bash deploy/deploy.sh

STORAGE_DRIVER=s3
S3_BUCKET=$BUCKET
AWS_REGION=$REGION
AWS_ACCESS_KEY_ID=$ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY=$SECRET

Recordings already on the instance disk are not moved. Copy them once with:
  docker compose --env-file deploy/prod.env -f deploy/docker-compose.prod.yml exec server \\
    sh -c 'ls /data/uploads' | head     # see what is there
  aws s3 sync <path-to-uploads-volume> s3://$BUCKET/recordings/ --exclude 'incoming/*'
EOT
