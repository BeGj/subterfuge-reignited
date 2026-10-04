# Multi-stage build: compile engine + Angular client, then ship a slim
# runtime image with only the server's production dependencies.

FROM node:24-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN npm ci --omit=dev --workspace=@subterfuge/server --include-workspace-root=false \
  && npm cache clean --force
COPY --from=build /repo/packages/engine/dist packages/engine/dist
COPY --from=build /repo/apps/client/dist apps/client/dist
COPY apps/server/src apps/server/src
COPY apps/server/migrations apps/server/migrations
USER node
EXPOSE 3000
CMD ["node", "apps/server/src/main.ts"]
