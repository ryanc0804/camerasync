FROM node:20-alpine

# Build-time switch: docker build --build-arg NODE_ENV=production ...
#   development (default): nodemon
#   production:            node src/index.js
ARG NODE_ENV=development
# Persist it so the running container (and src/db/pool.js) sees it
ENV NODE_ENV=$NODE_ENV

WORKDIR /app

COPY package.json package-lock.json ./
# Production: skip devDependencies (nodemon). Development: install everything.
RUN if [ "$NODE_ENV" = "production" ]; then npm install --omit=dev; else npm install; fi

COPY . .

# The app listens on $PORT (default 4000); publish it with docker -p / compose ports.
EXPOSE 4000

# Shell form so $NODE_ENV is evaluated when the container starts
CMD if [ "$NODE_ENV" = "production" ]; then npm start; else npm run dev; fi
