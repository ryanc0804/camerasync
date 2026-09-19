# Deploying 8kount to AWS

One t3.small EC2 instance runs everything with Docker Compose: Postgres, the
Express/Socket.IO server, and Caddy serving the built React app over HTTPS.
Recordings are stored on the instance disk until the S3 work (SCRUM-61) lands.

## One-time provisioning (SCRUM-52)

From a machine with the AWS CLI configured as an admin of the 8kount account:

```bash
bash deploy/provision.sh
```

This creates the key pair, security group, instance and Elastic IP, and prints
the public IP. Then point DNS at it: an `A` record for `8kount.app` -> that IP.

## First deploy

```bash
ssh -i ~/.ssh/8kount-prod.pem ubuntu@<public-ip>
git clone https://github.com/ryanc0804/camerasync.git && cd camerasync
bash deploy/deploy.sh          # creates deploy/prod.env, check DOMAIN
bash deploy/deploy.sh          # builds and starts everything, applies schema.sql
```

Caddy requests the certificate on first start; that needs DNS to already
resolve to the instance. Check with `curl -s https://8kount.app/health`.

## Redeploy after merging to main

```bash
ssh -i ~/.ssh/8kount-prod.pem ubuntu@<public-ip>
cd camerasync && bash deploy/deploy.sh
```

## Cost control

The account is on the AWS Free plan with credits. Stop the instance when the
team isn't using it; the disk, data and IP are kept.

```bash
aws ec2 stop-instances  --instance-ids <id>
aws ec2 start-instances --instance-ids <id>
```

## What talks to what

| Path                                   | Handled by                  |
| -------------------------------------- | --------------------------- |
| `/api/*`, `/socket.io/*`, `/timesync/*`, `/health` | Express server on port 4000 |
| everything else                        | built React app (static)    |

Web and API share the origin `https://8kount.app`, so the httpOnly session
cookie works without CORS or third-party-cookie problems. The Flutter app
should point its base URL at `https://8kount.app` as well.
