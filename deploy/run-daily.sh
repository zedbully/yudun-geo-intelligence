#!/bin/sh
set -eu
set -a
. /opt/yudun-geo-intelligence/.env.production
set +a

exec curl --fail --silent --show-error \
  --connect-timeout 10 \
  --max-time 900 \
  -X POST \
  -H "Authorization: Bearer ${YUDUN_OPS_SECRET}" \
  http://127.0.0.1:18100/api/ops/run
