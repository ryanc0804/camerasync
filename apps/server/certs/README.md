# Extra CA certificates

Drop additional root/intermediate CA certificates here as PEM files ending in
`.crt` (for example `my-private-ca.crt`). The server image installs them into
the system trust store at build time and Node picks them up through
`NODE_EXTRA_CA_CERTS`, so S3, SMTP and any other outbound HTTPS/TLS call will
trust them.

Only public certificates belong here, never private keys. Rebuild after
changing anything in this folder:

```bash
docker compose --env-file deploy/prod.env -f deploy/docker-compose.prod.yml up -d --build server
```

Public CAs (Let's Encrypt, Amazon, etc.) are already trusted and need nothing.
