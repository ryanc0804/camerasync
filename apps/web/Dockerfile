# Build-time switch: docker build --build-arg NODE_ENV=production ...
#   development (default): Vite dev server on 5173
#   production:            static bundle served by nginx on port 80 (ECS/Fargate)
# Declared before the first FROM so the final stage can be picked with it.
ARG NODE_ENV=development

# ---- development ----------------------------------------------------------
FROM node:20-alpine AS development
ENV NODE_ENV=development
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# ---- production: build the bundle ------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# vite is a devDependency and is needed to build
RUN npm install --include=dev
COPY . .
# Vite inlines VITE_* at build time (.env is dockerignored), so pass the public
# API URL as a build arg: --build-arg VITE_SERVER_URL=https://api.example.com
ARG VITE_SERVER_URL=
ENV VITE_SERVER_URL=$VITE_SERVER_URL
RUN npm run build

# ---- production: serve it --------------------------------------------------
FROM nginx:1.27-alpine AS production
ENV NODE_ENV=production
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

# ---- selected by NODE_ENV (must stay the last stage) -----------------------
FROM ${NODE_ENV} AS final
