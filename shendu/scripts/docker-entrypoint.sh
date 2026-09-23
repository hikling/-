#!/bin/sh
set -eu
umask 077

data_dir="${SHENDU_DATA_DIR:-/app/data}"
tmp_dir="${SHENDU_TMP_DIR:-/app/tmp}"

mkdir -p "$data_dir" "$tmp_dir"
chown -R node:node "$data_dir" "$tmp_dir"

exec su-exec node "$@"
