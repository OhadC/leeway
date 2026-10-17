FROM docker.io/library/node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends iproute2 procps lsof && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@12.9.1
WORKDIR /work
