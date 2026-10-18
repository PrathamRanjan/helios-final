# Build from repository root: docker build -f web/Dockerfile .
FROM node:22-bookworm-slim AS dependencies
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS build
COPY web/ ./
ARG NEXT_PUBLIC_GOOGLE_MAPS_KEY
ENV NEXT_PUBLIC_GOOGLE_MAPS_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_KEY \
    NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1
RUN test -n "$NEXT_PUBLIC_GOOGLE_MAPS_KEY" && npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app/web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=8080
COPY --from=build --chown=node:node /app/web/.next/standalone ./
COPY --from=build --chown=node:node /app/web/.next/static ./.next/static
COPY --from=build --chown=node:node /app/web/public ./public
# Many routes read dynamic data paths; explicitly include the frozen datasets.
COPY --from=build --chown=node:node /app/web/data ./data
USER node
EXPOSE 8080
CMD ["node", "server.js"]
