FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@11.2.2 --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages ./packages
COPY apps/worker ./apps/worker
COPY apps/api/package.json ./apps/api/package.json
RUN pnpm install --frozen-lockfile --filter @maester/worker...
RUN pnpm --filter @maester/worker build
RUN pnpm --filter @maester/worker deploy --prod --legacy /out

FROM node:22-slim
ENV NODE_ENV=production
RUN useradd -m app
WORKDIR /app
COPY --from=build /out/dist ./dist
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
USER app
EXPOSE 8080
CMD ["node", "dist/server.js"]
