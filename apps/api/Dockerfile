FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@11.2.2 --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/worker/package.json ./apps/worker/package.json
RUN pnpm install --frozen-lockfile --filter @maester/api...
RUN pnpm --filter @maester/api build
RUN pnpm --filter @maester/api deploy --prod --legacy /out

FROM node:22-slim
ENV NODE_ENV=production
RUN useradd -m app
WORKDIR /app
COPY --from=build /out/dist ./dist
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/packages/db/drizzle ./drizzle
ENV MIGRATIONS_FOLDER=/app/drizzle
USER app
EXPOSE 8080
CMD ["node", "dist/server.js"]
