FROM node:20-alpine

WORKDIR /app

# ffmpeg reads the audio of uploaded videos to find the sync beep that
# lines a take's angles up (src/recordings/syncBeep.js).
# ca-certificates provides the system trust store for the outbound TLS the
# server makes (S3, SMTP, and anything behind a private CA).
RUN apk add --no-cache ffmpeg ca-certificates

# Extra root CAs (e.g. a private S3-compatible store or SMTP relay) go in
# certs/ as PEM files named *.crt; see certs/README.md.
COPY certs/ /usr/local/share/ca-certificates/
RUN update-ca-certificates

# Node ships its own CA list and ignores the system store, so point it at the
# merged bundle. This adds to the built-in roots rather than replacing them.
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

COPY package.json package-lock.json ./
RUN npm install

COPY . .

EXPOSE 4000

CMD ["npm", "run", "dev"]
