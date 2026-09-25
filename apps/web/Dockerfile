FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@11.2.2 --activate
WORKDIR /web
# apps/web is a standalone pnpm project with its own lockfile; it is not a
# member of the root workspace.
COPY apps/web/package.json apps/web/pnpm-lock.yaml apps/web/pnpm-workspace.yaml apps/web/.npmrc ./
RUN pnpm install --frozen-lockfile
COPY apps/web ./
RUN pnpm build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /web/build /usr/share/nginx/html
EXPOSE 8080
