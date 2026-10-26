#!/bin/sh
# Started as root (default): give /data to the projo user if needed, then drop privileges,
# keeping the groups given with `group_add` (the GPU render node's, PRODUCT.md §10.3).
# Started with --user: run as is.
set -eu

data_dir="${DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$data_dir"
  if [ "$(stat -c %u "$data_dir")" != "$(id -u projo)" ]; then
    printf '{"time":"%s","level":"info","source":"entrypoint","msg":"giving the data dir to the projo user","dataDir":"%s"}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$data_dir"
    chown -R projo:projo "$data_dir"
  fi
  extra_groups="$(id -G | tr ' ' '\n' | grep -vx 0 | paste -sd, -)"
  if [ -n "$extra_groups" ]; then
    exec setpriv --reuid=projo --regid=projo --groups="$extra_groups" -- "$@"
  fi
  exec setpriv --reuid=projo --regid=projo --init-groups -- "$@"
fi

exec "$@"
