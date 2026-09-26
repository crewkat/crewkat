# Crewkat standalone server — Docker image for Render.
#
# Build stage compiles the server action bundle, the privileged-handler
# bundle (PDF via pdftoppm, Resend email, Stripe), and the React client from
# the app source snapshot in ./app.
#
# NOTE on HATCH_SPACES_BUILD_DRIVER: the vendored SDK's client builder
# refuses hand-invoked builds outside the artifact pipeline. Setting this
# variable is the supported switch for self-hosted builds; it only affects
# this image build and never touches the live private web artifact.

FROM oven/bun:1 AS build
WORKDIR /build

# Install dependencies first (cached layer). package.json references the
# vendored SDK as file:../vendor/space-sdk.tgz, so the tarball must land at
# /build/vendor/space-sdk.tgz. NOTE: a COPY destination containing "../"
# proved unreliable on some builders (the tarball silently missed its target
# and `bun install` failed) — stage everything with plain relative paths.
COPY app/package.json app/bun.lock ./app/
COPY vendor/space-sdk.tgz ./vendor/space-sdk.tgz
WORKDIR /build/app
RUN bun install --frozen-lockfile

# Full source, then compile the bundles.
WORKDIR /build
COPY app/ ./app/
WORKDIR /build/app
RUN bun run build:server && bun run build:privileged
RUN HATCH_SPACES_BUILD_DRIVER=1 bun run build:client

# Runtime stage: Bun + poppler-utils (pdftoppm for PDF page previews),
# the standalone harness, compiled bundles, and migrations.
FROM oven/bun:1

RUN apt-get update \
  && apt-get install -y --no-install-recommends poppler-utils ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

COPY server.mjs ./
COPY --from=build /build/app/server/dist ./app/server/dist
COPY --from=build /build/app/client/dist ./app/client/dist
COPY --from=build /build/app/drizzle ./app/drizzle

# /data is the Render persistent disk (see render.yaml): app.db + blobs live here.
ENV DATA_DIR=/data \
    PORT=3000 \
    NODE_ENV=production

EXPOSE 3000

CMD ["bun", "server.mjs"]
