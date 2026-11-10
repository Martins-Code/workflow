<?php

declare(strict_types=1);

/*
 * Echo service for the Render forwarding experiment.
 *
 * It reports exactly what reached it, so the test page can check whether a
 * Render static-site rewrite preserves the methods, bodies, headers and
 * cookies that Laravel Sanctum depends on. It is not part of WorkFlow,
 * stores nothing and has no authentication.
 */

const SERVICE_NAME = 'render-proxy-experiment-backend';
const MAX_BODY_BYTES = 1_048_576;
const SESSION_COOKIE = 'wf_experiment_session';
const XSRF_COOKIE = 'XSRF-TOKEN';
const COOKIE_LIFETIME_SECONDS = 7200;

$requestStart = hrtime(true);

function bootedAt(): int
{
    // The Docker start command writes this file, so a recent value means the
    // container has just started: evidence of a cold start for check P6.
    $file = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'render-proxy-booted-at';
    if (!is_file($file)) {
        @file_put_contents($file, (string) time());
    }
    $value = @file_get_contents($file);

    return $value === false ? time() : (int) trim($value);
}

/** @return array<string, string> Lower-case header name => value. */
function requestHeaders(): array
{
    $headers = [];
    foreach ($_SERVER as $key => $value) {
        if (is_string($value) && str_starts_with($key, 'HTTP_')) {
            $headers[strtolower(str_replace('_', '-', substr($key, 5)))] = $value;
        }
    }
    foreach (['CONTENT_TYPE' => 'content-type', 'CONTENT_LENGTH' => 'content-length'] as $key => $name) {
        if (isset($_SERVER[$key]) && $_SERVER[$key] !== '') {
            $headers[$name] = (string) $_SERVER[$key];
        }
    }
    ksort($headers);

    return $headers;
}

/** @param array<string, string> $headers */
function cookiesShouldBeSecure(array $headers): bool
{
    // COOKIE_SECURE=true on Render mirrors SESSION_SECURE_COOKIE=true in Laravel.
    // "auto" (the default) follows the request scheme, for local HTTP testing.
    $setting = strtolower((string) (getenv('COOKIE_SECURE') ?: 'auto'));
    if ($setting === 'true') {
        return true;
    }
    if ($setting === 'false') {
        return false;
    }
    $forwardedProto = strtolower(trim(explode(',', $headers['x-forwarded-proto'] ?? '')[0]));

    return ($_SERVER['HTTPS'] ?? '') === 'on' || $forwardedProto === 'https';
}

function setTestCookie(string $name, string $value, int $expires, bool $httpOnly, bool $secure): void
{
    // No "domain" option: the cookie is host-only, exactly as Laravel sets it
    // when SESSION_DOMAIN is empty. Through a proxy, the browser should store
    // it for the frontend's host.
    setcookie($name, $value, [
        'expires' => $expires,
        'path' => '/',
        'secure' => $secure,
        'httponly' => $httpOnly,
        'samesite' => 'Lax',
    ]);
}

/**
 * @param array<string, mixed> $payload
 * @param array<string, string> $extraHeaders
 */
function sendJson(int $status, array $payload, array $extraHeaders = []): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    foreach ($extraHeaders as $name => $value) {
        header("{$name}: {$value}");
    }
    echo json_encode(
        $payload,
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_INVALID_UTF8_SUBSTITUTE
    );
    exit;
}

/** Returns null when the body is larger than MAX_BODY_BYTES. */
function readBody(): ?string
{
    $raw = file_get_contents('php://input', false, null, 0, MAX_BODY_BYTES + 1);
    if ($raw === false) {
        return '';
    }

    return strlen($raw) > MAX_BODY_BYTES ? null : $raw;
}

/** @return list<string> */
function splitList(?string $value): array
{
    if ($value === null) {
        return [];
    }

    return array_values(array_filter(array_map('trim', explode(',', $value)), static fn (string $v): bool => $v !== ''));
}

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$headers = requestHeaders();
$secureCookies = cookiesShouldBeSecure($headers);
$booted = bootedAt();
$elapsedMs = static fn (): float => round((hrtime(true) - $requestStart) / 1_000_000, 2);

// Every response identifies itself, so the frontend can tell a backend
// response apart from a Render error page or the static site's index.html.
header('X-Experiment-Service: ' . SERVICE_NAME);
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

$requireMethod = static function (string ...$allowed) use ($method): void {
    if (!in_array($method, $allowed, true)) {
        sendJson(405, ['message' => 'Method not allowed.', 'service' => SERVICE_NAME], ['Allow' => implode(', ', $allowed)]);
    }
};

if ($path === '/' || $path === '/up') {
    sendJson(200, [
        'service' => SERVICE_NAME,
        'status' => 'ok',
        'booted_at' => $booted,
        'uptime_seconds' => time() - $booted,
    ]);
}

if ($path === '/sanctum/csrf-cookie') {
    // Mirrors Laravel Sanctum: two Set-Cookie headers in one 204 response.
    // The session cookie is HttpOnly; XSRF-TOKEN must be readable by JavaScript.
    $requireMethod('GET');
    $expires = time() + COOKIE_LIFETIME_SECONDS;
    setTestCookie(SESSION_COOKIE, bin2hex(random_bytes(20)), $expires, true, $secureCookies);
    setTestCookie(XSRF_COOKIE, bin2hex(random_bytes(20)), $expires, false, $secureCookies);
    http_response_code(204);
    exit;
}

if ($path === '/api/clear-cookies') {
    $requireMethod('POST');
    setTestCookie(SESSION_COOKIE, '', time() - 3600, true, $secureCookies);
    setTestCookie(XSRF_COOKIE, '', time() - 3600, false, $secureCookies);
    sendJson(200, ['service' => SERVICE_NAME, 'cleared' => [SESSION_COOKIE, XSRF_COOKIE]]);
}

if ($path === '/api/ping') {
    $requireMethod('GET');
    sendJson(200, [
        'service' => SERVICE_NAME,
        'pong' => true,
        'booted_at' => $booted,
        'uptime_seconds' => time() - $booted,
        'server_time' => time(),
        'server_ms' => $elapsedMs(),
    ]);
}

if (preg_match('#^/api/status/(\d{3})$#', $path, $match) === 1) {
    // Bodies and headers mirror what Laravel returns for these errors.
    $responses = [
        419 => [['message' => 'CSRF token mismatch.'], []],
        422 => [
            ['message' => 'The name field is required.', 'errors' => ['name' => ['The name field is required.']]],
            [],
        ],
        429 => [
            ['message' => 'Too Many Attempts.'],
            ['Retry-After' => '30', 'X-RateLimit-Limit' => '5', 'X-RateLimit-Remaining' => '0'],
        ],
    ];
    $code = (int) $match[1];
    if (!isset($responses[$code])) {
        sendJson(404, ['message' => 'Only 419, 422 and 429 are available.', 'service' => SERVICE_NAME]);
    }
    [$body, $extraHeaders] = $responses[$code];
    sendJson($code, $body, $extraHeaders);
}

if ($path === '/api/echo') {
    $requireMethod('GET', 'POST', 'PUT', 'PATCH', 'DELETE');

    $raw = readBody();
    if ($raw === null) {
        sendJson(413, ['message' => 'Body larger than 1 MB.', 'service' => SERVICE_NAME]);
    }

    $decoded = null;
    $jsonValid = false;
    if ($raw !== '') {
        try {
            $decoded = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
            $jsonValid = true;
        } catch (JsonException) {
            $decoded = null;
        }
    }

    $xsrfHeader = $headers['x-xsrf-token'] ?? null;
    $xsrfCookie = $_COOKIE[XSRF_COOKIE] ?? null;

    sendJson(200, [
        'service' => SERVICE_NAME,
        'method' => $method,
        'path' => $path,
        'query_string' => $_SERVER['QUERY_STRING'] ?? '',
        'query' => $_GET,
        'headers' => $headers,
        'cookies' => $_COOKIE,
        'body' => [
            'length_bytes' => strlen($raw),
            'sha256' => hash('sha256', $raw),
            'json_valid' => $jsonValid,
            'json' => $decoded,
        ],
        'csrf' => [
            'header_present' => $xsrfHeader !== null,
            'cookie_present' => $xsrfCookie !== null,
            'header_matches_cookie' => is_string($xsrfHeader) && is_string($xsrfCookie) && hash_equals($xsrfCookie, $xsrfHeader),
        ],
        // Each source is reported separately. The test page sends fake values
        // in these headers to see which ones the platform overwrites.
        'client_ip' => [
            'remote_addr' => $_SERVER['REMOTE_ADDR'] ?? null,
            'x_forwarded_for' => $headers['x-forwarded-for'] ?? null,
            'x_forwarded_for_list' => splitList($headers['x-forwarded-for'] ?? null),
            'x_real_ip' => $headers['x-real-ip'] ?? null,
            'true_client_ip' => $headers['true-client-ip'] ?? null,
            'cf_connecting_ip' => $headers['cf-connecting-ip'] ?? null,
            'forwarded' => $headers['forwarded'] ?? null,
        ],
        'forwarding' => [
            'host' => $headers['host'] ?? null,
            'x_forwarded_host' => $headers['x-forwarded-host'] ?? null,
            'x_forwarded_proto' => $headers['x-forwarded-proto'] ?? null,
        ],
        'cookie_settings' => [
            'secure' => $secureCookies,
            'http_only_session' => true,
            'same_site' => 'Lax',
            'domain' => null,
            'path' => '/',
        ],
        'booted_at' => $booted,
        'uptime_seconds' => time() - $booted,
        'server_ms' => $elapsedMs(),
    ]);
}

sendJson(404, [
    'message' => 'Not found.',
    'service' => SERVICE_NAME,
    'method' => $method,
    'path_received' => $path,
]);
