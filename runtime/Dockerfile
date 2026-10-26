# syntax=docker/dockerfile:1.7
# Build from the repo root: docker build -f runtime/Dockerfile .
# Targets: `runtime` (Bun + media tools + supervisor, no app), `app` (default: runtime + seed bundle).

ARG BUN_VERSION=1.4.4
ARG DEBIAN_RELEASE=trixie

FROM oven/bun:${BUN_VERSION}-debian AS bun

# ---------------------------------------------------------------------------
FROM debian:${DEBIAN_RELEASE}-slim AS runtime

# x86_64: Intel's VAAPI driver (iHD) for hardware transcoding (PRODUCT.md §10.3). The non-free
# build: the free one cannot encode H.264 on Gen9 iGPUs (Apollo Lake, Gemini Lake) without HuC.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libchromaprint-tools tini ca-certificates tzdata \
 && if [ "$(dpkg --print-architecture)" = amd64 ]; then \
      sed -i 's/^Components: main$/Components: main non-free/' /etc/apt/sources.list.d/debian.sources \
      && apt-get update \
      && apt-get install -y --no-install-recommends intel-media-va-driver-non-free; \
    fi \
 && rm -rf /var/lib/apt/lists/*

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

RUN groupadd --system --gid 1000 projo \
 && useradd --system --uid 1000 --gid projo --home-dir /home/projo --create-home --shell /usr/sbin/nologin projo \
 && mkdir -p /data \
 && chown projo:projo /data

COPY runtime/VERSION /opt/projo/VERSION
COPY --chmod=755 runtime/entrypoint.sh /opt/projo/entrypoint.sh
COPY runtime/supervisor/ /opt/projo/supervisor/

ENV PORT=8080 \
    DATA_DIR=/data \
    TRUST_PROXY=false \
    LOG_LEVEL=info

LABEL org.opencontainers.image.title="projo" \
      org.opencontainers.image.source="https://github.com/LeoMartinDev/projo" \
      org.opencontainers.image.licenses="MIT"

VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["bun", "/opt/projo/supervisor/healthcheck.ts"]

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/projo/entrypoint.sh"]
CMD ["bun", "/opt/projo/supervisor/main.ts"]

# ---------------------------------------------------------------------------
# The bundle is pure JS: build it once on the build platform, whatever the target arch.
FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION}-debian AS build

WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile
ARG APP_VERSION=""
RUN PROJO_VERSION="${APP_VERSION}" bun run build:bundle

# ---------------------------------------------------------------------------
FROM runtime AS app

COPY --from=build /src/dist/app /opt/projo/app
