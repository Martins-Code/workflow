#!/bin/sh
# Render static-site build step. Writes config.js from an environment variable.
# The value is a public URL that ends up in browser JavaScript: never put a secret here.
set -eu

cat > config.js <<EOF
window.PROXY_TEST_CONFIG = {
  directBackendUrl: "${DIRECT_BACKEND_URL:-}"
};
EOF

echo "config.js written (directBackendUrl=${DIRECT_BACKEND_URL:-<not set>})"
