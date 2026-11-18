# --- Stage 1: Build ---
FROM node:22-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-dev \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY patches ./patches
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build

# --- Stage 2: Production ---
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV NODE_OPTIONS="--max-old-space-size=220"
ENV PYTHON_MAX_CONCURRENCY=1

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    pkg-config \
    libcairo2 \
    libcairo2-dev \
    libpangocairo-1.0-0 \
    libpango1.0-dev \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt --break-system-packages

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/src ./src
COPY --from=builder /app/lib ./lib

RUN mkdir -p /app/outputs

EXPOSE 3001
CMD ["npm", "start"]
