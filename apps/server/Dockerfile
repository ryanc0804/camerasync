FROM node:20-alpine

WORKDIR /app

# ffmpeg reads the audio of uploaded videos to find the sync beep that
# lines a take's angles up (src/recordings/syncBeep.js).
RUN apk add --no-cache ffmpeg

COPY package.json package-lock.json ./
RUN npm install

COPY . .

EXPOSE 4000

CMD ["npm", "run", "dev"]
