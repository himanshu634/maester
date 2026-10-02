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
# Defaults for Cloud Run; docker-compose overrides them for the local stack.
ENV NGINX_RESOLVER=169.254.169.254 \
    API_PROXY_TARGET=http://localhost:8787 \
    API_PROXY_HOST=localhost:8787
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /web/build /usr/share/nginx/html
# Fail the build on a broken config: render the template once and test it.
RUN envsubst '$NGINX_RESOLVER $API_PROXY_TARGET $API_PROXY_HOST' \
      < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf \
    && nginx -t
EXPOSE 8080
