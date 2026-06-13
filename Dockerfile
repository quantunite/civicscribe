# CivicScribe production image.
#
# A single image powers both runtime processes:
#   • web    — the Next.js app:  npm start            (default CMD)
#   • worker — the job poller:   npm run worker        (override the command)
#
# ffmpeg + yt-dlp are installed because stream-URL capture shells out to them.
# (Zoom and direct-upload sources do not need them, but they're small enough
# to keep the image fully featured.)

FROM node:22-bookworm-slim AS base

# System dependencies for stream capture / audio extraction.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
    && curl -fL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
         -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install all dependencies (devDeps included: the build needs Tailwind/TS, and
# the worker process runs via tsx).
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# Build the app.
COPY . .
RUN npm run build

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

EXPOSE 3000

CMD ["npm", "start"]
