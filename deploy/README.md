# Deploying 8kount to AWS

One t3.small EC2 instance runs everything with Docker Compose: Postgres, the
Express/Socket.IO server, and Caddy serving the built React app over HTTPS.
Recordings go to a private S3 bucket (see "Recording storage" below); the
instance disk only holds an upload while it is being validated.

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

## Recording storage (SCRUM-63 / SCRUM-102)

The server stores recordings through one of two drivers, picked by
`prod.env`: local disk (the default, in the `uploads` volume) or S3. To move
production to S3:

1. From an admin machine, create the bucket and a least-privilege IAM user:

   ```bash
   bash deploy/provision-s3.sh
   ```

   It prints the `STORAGE_DRIVER`, `S3_BUCKET`, `AWS_REGION`,
   `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` lines to add to
   `deploy/prod.env` on the instance. The secret is shown once.
2. Add those lines and redeploy with `bash deploy/deploy.sh`. The server logs
   `[storage] S3 bucket "..."` at start-up; a bad bucket name or key shows up
   there as `[storage] check failed`.
3. Recordings uploaded before the switch stay on the disk and are not served
   once the driver is S3. Copy them into the bucket under the `recordings/`
   prefix (the script prints an `aws s3 sync` line) or accept losing them.

Playback still streams through the server, so no CORS settings are needed on
the bucket and the session cookie keeps gating every video. Bytes therefore
still cross the instance on every view; Cloudflare Stream (SCRUM-64) is the
planned fix for that.

To exercise the S3 driver locally, point the server at any S3-compatible
store with `S3_ENDPOINT` (see `apps/server/.env.example`).

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
