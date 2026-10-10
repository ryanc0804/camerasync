#!/usr/bin/env bash
# Daily snapshots of the production disk, kept for 7 days (about $1/month).
#
# The database runs on the instance rather than RDS, so this is what keeps a
# copy off the box: each snapshot holds the database, the nightly dumps from
# backup.sh and any recordings stored on disk. A future team moving to RDS
# gets RDS's own backups instead.
#
# Creates, idempotently, an EBS Data Lifecycle Manager policy for volumes
# tagged Name=8kount-prod (provision.sh tags the disk that way).
#
# Requires: aws cli configured, region us-east-1.
# Usage:    bash deploy/provision-snapshots.sh
#
# Restore: EC2 console > Snapshots > pick one > Create volume, then swap it in
# for the instance's root volume (Instance > Storage > Replace root volume).
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
NAME="8kount-prod"
DESCRIPTION="$NAME daily snapshots"
export AWS_DEFAULT_REGION="$REGION"

log() { printf '\n==> %s\n' "$*"; }

log "Account"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
echo "$ACCOUNT_ID"

log "Volumes tagged Name=$NAME"
aws ec2 describe-volumes --filters Name=tag:Name,Values="$NAME" \
  --query 'Volumes[].[VolumeId,Size,State]' --output text

log "Lifecycle Manager role"
# Errors when the role already exists, which is fine.
aws dlm create-default-role --resource-type snapshot >/dev/null 2>&1 || true
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/AWSDataLifecycleManagerDefaultRole"
echo "$ROLE_ARN"

log "Snapshot policy"
EXISTING="$(aws dlm get-lifecycle-policies \
  --query "Policies[?Description=='$DESCRIPTION'].PolicyId | [0]" --output text)"
if [ -n "$EXISTING" ] && [ "$EXISTING" != "None" ]; then
  echo "exists $EXISTING"
  exit 0
fi

# 04:00 UTC, after backup.sh's 03:15 dump has been written.
aws dlm create-lifecycle-policy \
  --description "$DESCRIPTION" \
  --state ENABLED \
  --execution-role-arn "$ROLE_ARN" \
  --tags "Name=$NAME,Project=8kount" \
  --policy-details "{
    \"PolicyType\": \"EBS_SNAPSHOT_MANAGEMENT\",
    \"ResourceTypes\": [\"VOLUME\"],
    \"TargetTags\": [{\"Key\": \"Name\", \"Value\": \"$NAME\"}],
    \"Schedules\": [{
      \"Name\": \"daily\",
      \"CopyTags\": true,
      \"CreateRule\": {\"Interval\": 24, \"IntervalUnit\": \"HOURS\", \"Times\": [\"04:00\"]},
      \"RetainRule\": {\"Count\": 7}
    }]
  }" \
  --query PolicyId --output text
