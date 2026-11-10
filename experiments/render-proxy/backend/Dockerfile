# Minimal image for the Render forwarding experiment.
# This is not the WorkFlow backend image, which will use Nginx and PHP-FPM.
FROM php:8.3-cli-alpine

WORKDIR /app
COPY index.php /app/index.php

# Run as an unprivileged user.
RUN adduser -D -H -s /sbin/nologin experiment
USER experiment

# Render injects PORT (its default is 10000). PHP's built-in server is
# adequate for a diagnostic service with no data and no secrets.
ENV PORT=10000 \
    PHP_CLI_SERVER_WORKERS=4
EXPOSE 10000

# Record the container start time, so the test page can tell a cold start
# (check P6) from a warm one, then hand the process over to PHP.
CMD ["sh", "-c", "date +%s > /tmp/render-proxy-booted-at && exec php -S 0.0.0.0:${PORT} /app/index.php"]
