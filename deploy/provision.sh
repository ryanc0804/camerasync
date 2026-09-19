#!/usr/bin/env bash
# Provision the 8kount production host on AWS (SCRUM-52).
#
# Creates, idempotently:
#   - an ed25519 SSH key pair "8kount-prod" (private key -> ~/.ssh/8kount-prod.pem)
#   - a security group "8kount-web" (22 from your IP, 80/443 from anywhere)
#   - one Ubuntu 24.04 t3.small instance with a 30 GB gp3 disk, Docker preinstalled
#   - an Elastic IP attached to the instance
#
# Requires: aws cli configured (aws sts get-caller-identity works), region us-east-1.
# Usage:    bash deploy/provision.sh            # create everything
#           INSTANCE_TYPE=t3.micro bash deploy/provision.sh
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
NAME="8kount-prod"
SG_NAME="8kount-web"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.small}"
DISK_GB="${DISK_GB:-30}"
KEY_FILE="$HOME/.ssh/${NAME}.pem"
export AWS_DEFAULT_REGION="$REGION"

log() { printf '\n==> %s\n' "$*"; }

log "Account"
aws sts get-caller-identity --query 'Arn' --output text

MY_IP="$(curl -s https://checkip.amazonaws.com)"
VPC_ID="$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)"
SUBNET_ID="$(aws ec2 describe-subnets --filters Name=vpc-id,Values="$VPC_ID" Name=default-for-az,Values=true --query 'Subnets[0].SubnetId' --output text)"

# ---------------------------------------------------------------- key pair
log "Key pair $NAME"
if aws ec2 describe-key-pairs --key-names "$NAME" >/dev/null 2>&1; then
  echo "exists (private key must already be at $KEY_FILE)"
else
  umask 077
  mkdir -p "$HOME/.ssh"
  aws ec2 create-key-pair --key-name "$NAME" --key-type ed25519 --key-format pem \
    --query KeyMaterial --output text > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
  echo "created, private key saved to $KEY_FILE (back it up, AWS cannot re-issue it)"
fi

# ---------------------------------------------------------------- security group
log "Security group $SG_NAME"
SG_ID="$(aws ec2 describe-security-groups --filters Name=group-name,Values="$SG_NAME" Name=vpc-id,Values="$VPC_ID" \
          --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)"
if [ -z "$SG_ID" ] || [ "$SG_ID" = "None" ]; then
  SG_ID="$(aws ec2 create-security-group --group-name "$SG_NAME" --vpc-id "$VPC_ID" \
            --description "8kount app server: SSH from admin IP, HTTP/HTTPS public" --query GroupId --output text)"
  aws ec2 create-tags --resources "$SG_ID" --tags Key=Name,Value="$SG_NAME" Key=Project,Value=8kount
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --ip-permissions \
    "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=${MY_IP}/32,Description=admin SSH}]" \
    'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0,Description=HTTP}]' \
    'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0,Description=HTTPS}]' >/dev/null
  echo "created $SG_ID (SSH allowed from $MY_IP)"
else
  echo "exists $SG_ID"
fi

# ---------------------------------------------------------------- instance
log "Instance $NAME ($INSTANCE_TYPE, ${DISK_GB} GB)"
INSTANCE_ID="$(aws ec2 describe-instances --filters Name=tag:Name,Values="$NAME" Name=instance-state-name,Values=pending,running,stopping,stopped \
               --query 'Reservations[0].Instances[0].InstanceId' --output text 2>/dev/null || true)"
if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" = "None" ]; then
  AMI_ID="$(aws ssm get-parameters --names /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
            --query 'Parameters[0].Value' --output text)"
  USER_DATA="$(cat <<'EOF'
#!/bin/bash
set -eux
apt-get update
apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sh
usermod -aG docker ubuntu
systemctl enable --now docker
EOF
)"
  INSTANCE_ID="$(aws ec2 run-instances \
    --image-id "$AMI_ID" --instance-type "$INSTANCE_TYPE" --key-name "$NAME" \
    --security-group-ids "$SG_ID" --subnet-id "$SUBNET_ID" \
    --block-device-mappings "DeviceName=/dev/sda1,Ebs={VolumeSize=${DISK_GB},VolumeType=gp3,DeleteOnTermination=true}" \
    --user-data "$USER_DATA" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME},{Key=Project,Value=8kount}]" \
                         "ResourceType=volume,Tags=[{Key=Name,Value=$NAME},{Key=Project,Value=8kount}]" \
    --query 'Instances[0].InstanceId' --output text)"
  echo "launched $INSTANCE_ID from $AMI_ID"
else
  echo "exists $INSTANCE_ID"
fi
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"

# ---------------------------------------------------------------- elastic ip
log "Elastic IP"
ALLOC_ID="$(aws ec2 describe-addresses --filters Name=tag:Name,Values="$NAME" --query 'Addresses[0].AllocationId' --output text 2>/dev/null || true)"
if [ -z "$ALLOC_ID" ] || [ "$ALLOC_ID" = "None" ]; then
  ALLOC_ID="$(aws ec2 allocate-address --domain vpc --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NAME},{Key=Project,Value=8kount}]" \
              --query AllocationId --output text)"
fi
aws ec2 associate-address --instance-id "$INSTANCE_ID" --allocation-id "$ALLOC_ID" --allow-reassociation >/dev/null
PUBLIC_IP="$(aws ec2 describe-addresses --allocation-ids "$ALLOC_ID" --query 'Addresses[0].PublicIp' --output text)"

log "Done"
cat <<EOF
Instance:   $INSTANCE_ID  ($INSTANCE_TYPE)
Public IP:  $PUBLIC_IP
SSH:        ssh -i $KEY_FILE ubuntu@$PUBLIC_IP   (wait ~2 min for Docker install on first boot)

Next steps:
  1. DNS: create an A record   8kount.app -> $PUBLIC_IP   (and www if you want it)
  2. On the instance:          git clone <repo> && cd camerasync && bash deploy/deploy.sh
  3. Stop when idle:           aws ec2 stop-instances --instance-ids $INSTANCE_ID
     Start again:              aws ec2 start-instances --instance-ids $INSTANCE_ID
EOF
