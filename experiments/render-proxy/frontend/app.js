'use strict';

/*
 * Browser-side checks for the Render forwarding experiment.
 *
 * Every request goes to this page's own origin. Render (or the local dev
 * proxy) is expected to forward /api/* and /sanctum/* to the separate backend.
 * A check passes only when the backend proves it received exactly what was
 * sent. An HTTP 200 on its own proves nothing.
 */

const BACKEND_SERVICE = 'render-proxy-experiment-backend';
const FRONTEND_MARKER = 'proxy-experiment-frontend';
const PASS = 'PASS';
const FAIL = 'FAIL';
const INCONCLUSIVE = 'INCONCLUSIVE';

// Documentation-range addresses (RFC 5737) that can never be a real visitor.
const FAKE_IP_HEADERS = {
  'X-Forwarded-For': '203.0.113.77',
  'X-Real-IP': '203.0.113.78',
  'True-Client-IP': '203.0.113.79',
  'CF-Connecting-IP': '203.0.113.80',
  Forwarded: 'for=203.0.113.81',
};
const FAKE_IPS = ['203.0.113.77', '203.0.113.78', '203.0.113.79', '203.0.113.80', '203.0.113.81'];

// Must match the bodies in backend/index.php, which mirror Laravel's.
const EXPECTED_STATUS = {
  419: { body: { message: 'CSRF token mismatch.' }, headers: {} },
  422: {
    body: { message: 'The name field is required.', errors: { name: ['The name field is required.'] } },
    headers: {},
  },
  429: { body: { message: 'Too Many Attempts.' }, headers: { 'retry-after': '30' } },
};

const TESTS = [
  { id: 'P1', name: 'Methods and JSON bodies' },
  { id: 'P2', name: 'Cookie creation, storage and readability' },
  { id: 'P3', name: 'Headers and cookies reach the backend' },
  { id: 'P4', name: 'Status codes, JSON bodies and Retry-After' },
  { id: 'P5', name: 'Visitor IP and spoofed headers' },
  { id: 'P6', name: 'Backend sleep and wake behaviour' },
  { id: 'P7', name: 'Latency through forwarding' },
];

const config = Object.assign({ directBackendUrl: '' }, window.PROXY_TEST_CONFIG || {});
const results = {};

/* ---------- Small helpers ---------- */

function randomId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function sha256Hex(text) {
  if (!window.crypto || !crypto.subtle) return null; // Requires HTTPS or localhost.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function readCookie(name) {
  for (const part of document.cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function normaliseIp(value) {
  if (!value) return '';
  let ip = String(value).trim().toLowerCase().replace(/^\[|\]$/g, '');
  ip = ip.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, '$1');
  ip = ip.replace(/^(\d+\.\d+\.\d+\.\d+):\d+$/, '$1');
  return ip;
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (p) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
  return { count: sorted.length, min: sorted[0], median: pick(0.5), p95: pick(0.95), max: sorted[sorted.length - 1] };
}

function directBaseUrl() {
  const value = (document.getElementById('direct-url').value || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/]+$/i.test(value) ? value : '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path, { method = 'GET', headers = {}, body, timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(path, {
      method,
      headers,
      body,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'manual', // A redirect instead of a rewrite must be visible, not silently followed.
      signal: controller.signal,
    });
    const text = response.type === 'opaqueredirect' ? '' : await response.text();
    const ms = Math.round(performance.now() - started);
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const picked = {};
    for (const name of ['content-type', 'retry-after', 'x-experiment-service', 'x-ratelimit-limit', 'x-ratelimit-remaining']) {
      const value = response.headers.get(name);
      if (value !== null) picked[name] = value;
    }
    return { ok: true, status: response.status, type: response.type, contentType: picked['content-type'] || '', headers: picked, text, json, ms };
  } catch (error) {
    const message = error && error.name === 'AbortError' ? `Timed out after ${timeoutMs} ms` : String(error);
    return { ok: false, error: message, ms: Math.round(performance.now() - started), headers: {}, text: '', json: null };
  } finally {
    clearTimeout(timer);
  }
}

function summarise(res) {
  if (!res) return null;
  if (!res.ok) return { error: res.error, ms: res.ms };
  return {
    status: res.status,
    responseType: res.type,
    ms: res.ms,
    headers: res.headers,
    bodyPreview: res.text.length > 400 ? `${res.text.slice(0, 400)}… (${res.text.length} characters)` : res.text,
  };
}

function isBackendJson(res) {
  return Boolean(res && res.ok && res.json && res.json.service === BACKEND_SERVICE);
}

function describeNonBackend(res) {
  if (!res) return 'no response';
  if (!res.ok) return res.error;
  if (res.type === 'opaqueredirect') return 'Render returned a redirect instead of forwarding the request';
  if (!res.json) return `status ${res.status}, non-JSON response (${res.contentType || 'no content-type'})`;
  return `status ${res.status}, JSON without the backend marker`;
}

function makeChecker() {
  const checks = [];
  return {
    checks,
    add(label, ok, detail = '') {
      checks.push({ label, ok: Boolean(ok), detail: String(detail) });
      return Boolean(ok);
    },
  };
}

function outcome(id, checker, diagnostics, { summaryPass, notes = [] } = {}) {
  const failed = checker.checks.filter((c) => !c.ok);
  const status = failed.length === 0 && checker.checks.length > 0 ? PASS : FAIL;
  const summary = status === PASS ? summaryPass : `${failed.length} of ${checker.checks.length} checks failed: ${failed.map((c) => c.label).join('; ')}`;
  return { id, status, summary, checks: checker.checks, notes, diagnostics };
}

/* ---------- P1: methods and JSON bodies ---------- */

async function testP1() {
  const c = makeChecker();
  const diagnostics = {};
  const nonce = randomId();

  const get = await request(`/api/echo?q=a%20b&x=1&nonce=${nonce}`);
  diagnostics.GET = summarise(get);
  if (c.add('GET reached the backend', isBackendJson(get), isBackendJson(get) ? '' : describeNonBackend(get))) {
    c.add('GET method preserved', get.json.method === 'GET', `received ${get.json.method}`);
    c.add('GET path preserved', get.json.path === '/api/echo', `received ${get.json.path}`);
    const q = get.json.query || {};
    c.add('Query string preserved', q.q === 'a b' && q.x === '1' && q.nonce === nonce, `received "${get.json.query_string}"`);
  }

  // About 64 KB, with non-ASCII text, to catch truncation or re-encoding.
  const payload = {
    nonce,
    text: 'Unicode check: café, naïve, 日本語, emoji 🚀',
    nested: { count: 42, flags: [true, false, null], list: [1, 2, 3] },
    padding: 'x'.repeat(64 * 1024),
  };
  const bodyText = JSON.stringify(payload);
  const bodyBytes = new TextEncoder().encode(bodyText).length;
  const bodyHash = await sha256Hex(bodyText);

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const res = await request('/api/echo', {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: bodyText,
    });
    diagnostics[method] = summarise(res);
    if (!c.add(`${method} reached the backend`, isBackendJson(res), isBackendJson(res) ? '' : describeNonBackend(res))) continue;
    const body = res.json.body || {};
    c.add(`${method} method preserved`, res.json.method === method, `received ${res.json.method}`);
    c.add(`${method} body size preserved`, body.length_bytes === bodyBytes, `sent ${bodyBytes} bytes, received ${body.length_bytes}`);
    if (bodyHash) c.add(`${method} body SHA-256 matches`, body.sha256 === bodyHash, `sent ${bodyHash.slice(0, 16)}…, received ${String(body.sha256).slice(0, 16)}…`);
    c.add(`${method} JSON content identical`, body.json_valid && canonical(body.json) === canonical(payload), body.json_valid ? 'compared field by field' : 'backend could not parse the body as JSON');
  }

  // Rule order: /api/* must win over the /* → /index.html fallback, and
  // client-side routes must still return the SPA.
  const unknownApi = await request('/api/does-not-exist');
  diagnostics.unknownApi = summarise(unknownApi);
  c.add('/api/* is forwarded before the SPA fallback', unknownApi.ok && unknownApi.status === 404 && unknownApi.headers['x-experiment-service'] === BACKEND_SERVICE, describeNonBackend(unknownApi));

  const clientRoute = await request(`/w/demo/projects/${nonce}`);
  diagnostics.clientRoute = summarise(clientRoute);
  c.add('Client-side routes fall back to index.html', clientRoute.ok && clientRoute.status === 200 && clientRoute.text.includes(FRONTEND_MARKER), `status ${clientRoute.status}, ${clientRoute.contentType || clientRoute.error || ''}`);

  const notes = bodyHash ? [] : ['SHA-256 comparison skipped: the browser only allows it on HTTPS or localhost. Field-by-field comparison still ran.'];
  return outcome('P1', c, diagnostics, {
    summaryPass: 'GET, POST, PUT, PATCH and DELETE arrived with method, path, query and a 64 KB JSON body unchanged. Routing order is correct.',
    notes,
  });
}

/* ---------- P2: cookies ---------- */

async function testP2() {
  const c = makeChecker();
  const diagnostics = {};

  const cleared = await request('/api/clear-cookies', { method: 'POST', headers: { Accept: 'application/json' } });
  diagnostics.clear = summarise(cleared);
  c.add('Cookie reset request reached the backend', isBackendJson(cleared), describeNonBackend(cleared));
  c.add('Expiring Set-Cookie removed the old XSRF-TOKEN', readCookie('XSRF-TOKEN') === null, `document.cookie: "${document.cookie}"`);

  const csrf = await request('/sanctum/csrf-cookie');
  diagnostics.csrfCookie = summarise(csrf);
  c.add('/sanctum/csrf-cookie returned 204 from the backend', csrf.ok && csrf.status === 204 && csrf.headers['x-experiment-service'] === BACKEND_SERVICE, csrf.ok ? `status ${csrf.status}` : csrf.error);

  const xsrf = readCookie('XSRF-TOKEN');
  c.add('Readable XSRF-TOKEN cookie stored for this site', Boolean(xsrf), xsrf ? 'present in document.cookie' : `missing; document.cookie: "${document.cookie}"`);
  c.add('HttpOnly session cookie hidden from JavaScript', readCookie('wf_experiment_session') === null, 'wf_experiment_session must not appear in document.cookie');

  const echo = await request('/api/echo');
  diagnostics.echo = summarise(echo);
  if (c.add('Follow-up request reached the backend', isBackendJson(echo), describeNonBackend(echo))) {
    const cookies = echo.json.cookies || {};
    c.add('Browser stored and returned the HttpOnly session cookie', typeof cookies.wf_experiment_session === 'string' && cookies.wf_experiment_session.length > 0, Object.keys(cookies).join(', ') || 'no cookies received');
    c.add('Browser returned XSRF-TOKEN unchanged', Boolean(xsrf) && cookies['XSRF-TOKEN'] === xsrf, 'cookie value compared with document.cookie');
    if (location.protocol === 'https:') {
      c.add('Backend marked cookies Secure on HTTPS', echo.json.cookie_settings && echo.json.cookie_settings.secure === true, 'set COOKIE_SECURE=true on the backend service if this fails');
    }
    diagnostics.cookieSettings = echo.json.cookie_settings;
  }

  return outcome('P2', c, diagnostics, {
    summaryPass: 'Both cookies from one 204 response were stored for this site. XSRF-TOKEN is readable, the session cookie is HttpOnly, and both are sent back.',
    notes: ['JavaScript cannot read cookie attributes. Confirm Domain, Secure, HttpOnly and SameSite manually in DevTools → Application → Cookies (see the README).'],
  });
}

/* ---------- P3: headers and cookies reach the backend ---------- */

async function testP3() {
  const c = makeChecker();
  const diagnostics = {};
  const notes = [];

  let xsrf = readCookie('XSRF-TOKEN');
  if (!xsrf) {
    await request('/sanctum/csrf-cookie');
    xsrf = readCookie('XSRF-TOKEN');
  }
  if (!xsrf) {
    return {
      id: 'P3',
      status: INCONCLUSIVE,
      summary: 'No XSRF-TOKEN cookie is available, so header forwarding could not be tested. Fix P2 first.',
      checks: [],
      notes,
      diagnostics,
    };
  }

  const post = await request('/api/echo', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-XSRF-TOKEN': xsrf,
    },
    body: JSON.stringify({ check: 'P3' }),
  });
  diagnostics.post = summarise(post);
  if (c.add('POST reached the backend', isBackendJson(post), describeNonBackend(post))) {
    const h = post.json.headers || {};
    const cookieHeader = h.cookie || '';
    diagnostics.receivedHeaders = h;
    diagnostics.forwarding = post.json.forwarding;
    c.add('Cookie header contains both test cookies', cookieHeader.includes('wf_experiment_session=') && cookieHeader.includes('XSRF-TOKEN='), cookieHeader ? 'cookie names checked' : 'no Cookie header received');
    c.add('X-XSRF-TOKEN arrived and matches the cookie', post.json.csrf && post.json.csrf.header_matches_cookie === true, JSON.stringify(post.json.csrf));
    c.add('Accept header preserved', (h.accept || '').includes('application/json'), `received "${h.accept || ''}"`);
    c.add('X-Requested-With preserved', h['x-requested-with'] === 'XMLHttpRequest', `received "${h['x-requested-with'] || ''}"`);
    c.add('Referer arrived with this site\'s origin', (h.referer || '').startsWith(`${location.origin}/`), `received "${h.referer || ''}"`);
    if (h.origin === undefined) {
      notes.push('The browser sent no Origin header on this same-origin POST. Sanctum then uses Referer, which was checked above.');
    } else {
      c.add('Origin arrived unchanged (not rewritten to the backend host)', h.origin === location.origin, `received "${h.origin}", expected "${location.origin}"`);
    }
  }

  const get = await request('/api/echo', { headers: { Accept: 'application/json' } });
  diagnostics.get = summarise(get);
  if (c.add('GET reached the backend', isBackendJson(get), describeNonBackend(get))) {
    const referer = (get.json.headers || {}).referer || '';
    c.add('Referer arrives on GET requests too', referer.startsWith(`${location.origin}/`), `received "${referer}"`);
  }
  notes.push('Host and X-Forwarded-Host are shown under diagnostics → forwarding. WorkFlow\'s trustHosts setting will need these values.');

  return outcome('P3', c, diagnostics, {
    summaryPass: 'Cookie, X-XSRF-TOKEN, Accept, X-Requested-With, Referer and Origin reached the backend unchanged.',
    notes,
  });
}

/* ---------- P4: status codes, JSON bodies and Retry-After ---------- */

async function testP4() {
  const c = makeChecker();
  const diagnostics = {};
  for (const [code, expected] of Object.entries(EXPECTED_STATUS)) {
    const res = await request(`/api/status/${code}`, { headers: { Accept: 'application/json' } });
    diagnostics[code] = summarise(res);
    if (!c.add(`${code} returned by the backend`, res.ok && res.headers['x-experiment-service'] === BACKEND_SERVICE, res.ok ? `status ${res.status}` : res.error)) continue;
    c.add(`${code} status code unchanged`, res.status === Number(code), `received ${res.status}`);
    c.add(`${code} Content-Type is JSON`, res.contentType.includes('application/json'), `received "${res.contentType}"`);
    c.add(`${code} JSON body unchanged`, res.json !== null && canonical(res.json) === canonical(expected.body), res.json ? 'compared field by field' : 'body was not JSON');
    for (const [name, value] of Object.entries(expected.headers)) {
      c.add(`${code} ${name} header unchanged`, res.headers[name] === value, `received "${res.headers[name] ?? ''}"`);
    }
  }
  return outcome('P4', c, diagnostics, {
    summaryPass: '419, 422 and 429 came back with the right status, JSON body and Retry-After header, not replaced by a platform error page.',
  });
}

/* ---------- P5: visitor IP and spoofed headers ---------- */

async function testP5() {
  const diagnostics = {};
  const realIp = normaliseIp(document.getElementById('real-ip').value);

  const baseline = await request('/api/echo');
  const spoofed = await request('/api/echo', { headers: FAKE_IP_HEADERS });
  diagnostics.baseline = isBackendJson(baseline) ? baseline.json.client_ip : summarise(baseline);
  diagnostics.withFakeHeaders = isBackendJson(spoofed) ? spoofed.json.client_ip : summarise(spoofed);
  diagnostics.fakeValuesSent = FAKE_IP_HEADERS;

  if (!isBackendJson(baseline) || !isBackendJson(spoofed)) {
    return { id: 'P5', status: FAIL, summary: `Backend not reached: ${describeNonBackend(isBackendJson(baseline) ? spoofed : baseline)}`, checks: [], notes: [], diagnostics };
  }

  const b = baseline.json.client_ip;
  const s = spoofed.json.client_ip;
  const singleSources = ['remote_addr', 'true_client_ip', 'cf_connecting_ip', 'x_real_ip'];
  const fakeAccepted = Object.entries(s)
    .filter(([, value]) => FAKE_IPS.some((fake) => String(value ?? '').includes(fake)))
    .map(([field]) => field);
  diagnostics.fieldsContainingFakeValues = fakeAccepted;

  if (!realIp) {
    return {
      id: 'P5',
      status: INCONCLUSIVE,
      summary: 'Enter your public IP address and run again. Without it, I can\'t tell your address apart from the platform\'s own.',
      checks: [],
      notes: ['Diagnostics still show which headers kept the fake values, which is useful on its own.'],
      diagnostics,
    };
  }

  const c = makeChecker();
  const trustworthy = [];
  for (const field of singleSources) {
    if (normaliseIp(b[field]) === realIp && normaliseIp(s[field]) === realIp) {
      trustworthy.push(`${field}: always your address, even when a fake was sent`);
    }
  }
  // X-Forwarded-For grows from the left with whatever the client sent, so the
  // trustworthy entry is the one a fixed number of positions from the right.
  const bl = (b.x_forwarded_for_list || []).map(normaliseIp);
  const sl = (s.x_forwarded_for_list || []).map(normaliseIp);
  const fromRight = (list) => (list.includes(realIp) ? list.length - 1 - list.lastIndexOf(realIp) : -1);
  const bPos = fromRight(bl);
  const sPos = fromRight(sl);
  if (bPos >= 0 && bPos === sPos) {
    trustworthy.push(`X-Forwarded-For: entry ${sPos + 1} from the right, in both requests`);
  }
  diagnostics.realIpEntered = realIp;
  diagnostics.xForwardedForPositionFromRight = { baseline: bPos, withFakeHeaders: sPos };

  const visibleAnywhere = Object.values(b).flat().some((value) => normaliseIp(value) === realIp || String(value ?? '').toLowerCase().includes(realIp));
  c.add('Your public IP is visible to the backend', visibleAnywhere, visibleAnywhere ? '' : 'not found in any IP header. If your network uses IPv6, check whether you entered the IPv6 or IPv4 address');
  c.add('At least one source cannot be overridden by the client', trustworthy.length > 0, trustworthy.join('; ') || 'every source containing your address was missing or replaced when fakes were sent');

  const notes = [];
  if (fakeAccepted.length) {
    notes.push(`These fields contained a fake value: ${fakeAccepted.join(', ')}. Laravel must not trust them. Configure trusted proxies to read only the trustworthy source.`);
  }
  return outcome('P5', c, diagnostics, { summaryPass: `Trustworthy source: ${trustworthy.join('; ')}.`, notes });
}

/* ---------- P6: sleep and wake ---------- */

function classifyAttempt(res) {
  if (isBackendJson(res)) return 'backend-json';
  if (!res.ok) return 'error';
  return 'non-backend-response';
}

async function runWakeSequence(firstAttempt) {
  const attempts = [];
  const started = performance.now();
  const limitMs = 4 * 60 * 1000;
  let res = firstAttempt;
  while (true) {
    if (!res) res = await request(`/api/ping?wake=${Date.now()}`, { timeoutMs: 120000 });
    attempts.push({
      attempt: attempts.length + 1,
      outcome: classifyAttempt(res),
      ms: res.ms,
      status: res.status ?? null,
      contentType: res.contentType || null,
      error: res.error || null,
      preview: res.text ? res.text.slice(0, 200) : '',
      uptimeSeconds: isBackendJson(res) ? res.json.uptime_seconds : null,
    });
    setStatus(`Wake test: attempt ${attempts.length}, ${classifyAttempt(res)}, ${Math.round((performance.now() - started) / 1000)} s elapsed…`);
    if (isBackendJson(res) || performance.now() - started > limitMs) break;
    res = null;
    await sleep(5000);
  }
  const totalSeconds = Math.round((performance.now() - started) / 1000);
  const success = attempts[attempts.length - 1].outcome === 'backend-json';
  const finalUptime = attempts[attempts.length - 1].uptimeSeconds;
  const diagnostics = { attempts, totalSeconds };

  if (!success) {
    return { id: 'P6', status: FAIL, summary: `The backend did not respond with JSON within 4 minutes (${attempts.length} attempts).`, checks: [], notes: [], diagnostics };
  }
  if (finalUptime !== null && finalUptime > 300) {
    return {
      id: 'P6',
      status: INCONCLUSIVE,
      summary: `The backend was already awake (running for ${finalUptime} s), so no wake-up was observed. Close every tab using it, wait at least 16 minutes, then press "Run wake test (P6)" without running anything else first.`,
      checks: [],
      notes: [],
      diagnostics,
    };
  }
  const before = attempts.slice(0, -1).map((a) => a.outcome);
  let behaviour = 'The first request waited, then returned the backend JSON';
  if (before.includes('non-backend-response')) behaviour = 'Requests received a non-backend response (for example Render\'s loading page) before the backend answered';
  else if (before.includes('error')) behaviour = 'Requests failed or timed out before the backend answered';
  return {
    id: 'P6',
    status: PASS,
    summary: `Wake-up observed in ${totalSeconds} s. ${behaviour}. Every response before the backend was ready was distinguishable from a real API response.`,
    checks: [],
    notes: ['WorkFlow\'s API client must treat any response without the expected JSON, or a timeout, as "waking up" and retry, using the pattern recorded here.'],
    diagnostics,
  };
}

async function evaluateP6FromProbe(probe) {
  if (!isBackendJson(probe)) return runWakeSequence(probe);
  const uptime = probe.json.uptime_seconds;
  if (uptime <= 300 && probe.ms > 3000) {
    return {
      id: 'P6',
      status: PASS,
      summary: `Wake-up observed: the first request waited ${Math.round(probe.ms / 1000)} s and then returned the backend JSON (container up for ${uptime} s).`,
      checks: [],
      notes: [],
      diagnostics: { probe: summarise(probe), uptimeSeconds: uptime },
    };
  }
  return {
    id: 'P6',
    status: INCONCLUSIVE,
    summary: `The backend was already awake (running for ${uptime} s). To test waking, close every tab using it, wait at least 16 minutes, then press "Run wake test (P6)" first.`,
    checks: [],
    notes: [],
    diagnostics: { probe: summarise(probe), uptimeSeconds: uptime },
  };
}

/* ---------- P7: latency ---------- */

async function timeDirect(url) {
  // Cross-origin without CORS: the response is opaque, but the time until it
  // arrives is still measurable. The backend deliberately allows no CORS.
  const started = performance.now();
  try {
    await fetch(url, { mode: 'no-cors', cache: 'no-store', credentials: 'omit' });
    return Math.round(performance.now() - started);
  } catch {
    return null;
  }
}

async function testP7() {
  const c = makeChecker();
  const diagnostics = {};
  const samples = 15;
  const notes = ['Latency depends on your distance from the Render region. Record where you ran the test from.'];

  await request('/api/ping?warm=1');
  await request('/api/ping?warm=2');
  const forwarded = [];
  const serverMs = [];
  for (let i = 0; i < samples; i += 1) {
    const res = await request(`/api/ping?n=${i}&t=${Date.now()}`);
    if (!isBackendJson(res)) {
      return { id: 'P7', status: FAIL, summary: `Ping ${i + 1} did not reach the backend: ${describeNonBackend(res)}`, checks: [], notes, diagnostics };
    }
    forwarded.push(res.ms);
    serverMs.push(res.json.server_ms);
  }
  diagnostics.forwardedMs = stats(forwarded);
  diagnostics.backendProcessingMs = stats(serverMs);

  const base = directBaseUrl();
  let direct = null;
  if (base) {
    await timeDirect(`${base}/api/ping?warm=1&t=${Date.now()}`);
    const times = [];
    for (let i = 0; i < samples; i += 1) {
      times.push(await timeDirect(`${base}/api/ping?direct=${i}&t=${Date.now()}`));
    }
    if (times.every((t) => t !== null)) {
      direct = stats(times);
      diagnostics.directMs = direct;
    } else {
      notes.push(`Direct requests to ${base} failed, so no comparison was made. Check the direct backend URL.`);
    }
  } else {
    notes.push('No direct backend URL was given, so absolute thresholds were used instead of a comparison.');
  }

  const fwd = diagnostics.forwardedMs;
  if (direct) {
    const overhead = fwd.median - direct.median;
    diagnostics.addedByForwardingMs = overhead;
    if (overhead > 600 || fwd.median > 1500) {
      c.add('Forwarding overhead acceptable', false, `median ${fwd.median} ms forwarded vs ${direct.median} ms direct (+${overhead} ms)`);
      return outcome('P7', c, diagnostics, { notes });
    }
    if (overhead <= 250 && fwd.p95 <= 1500) {
      c.add('Forwarding overhead acceptable', true);
      return outcome('P7', c, diagnostics, {
        summaryPass: `Median ${fwd.median} ms forwarded vs ${direct.median} ms direct (+${overhead} ms). 95th percentile ${fwd.p95} ms.`,
        notes,
      });
    }
    return { id: 'P7', status: INCONCLUSIVE, summary: `Borderline: median ${fwd.median} ms forwarded vs ${direct.median} ms direct (+${overhead} ms), 95th percentile ${fwd.p95} ms. Needs a judgement call.`, checks: [], notes, diagnostics };
  }

  if (fwd.median > 1000) {
    c.add('Forwarded latency acceptable', false, `median ${fwd.median} ms, 95th percentile ${fwd.p95} ms`);
    return outcome('P7', c, diagnostics, { notes });
  }
  if (fwd.median <= 400 && fwd.p95 <= 1000) {
    c.add('Forwarded latency acceptable', true);
    return outcome('P7', c, diagnostics, { summaryPass: `Median ${fwd.median} ms, 95th percentile ${fwd.p95} ms through forwarding.`, notes });
  }
  return { id: 'P7', status: INCONCLUSIVE, summary: `Borderline: median ${fwd.median} ms, 95th percentile ${fwd.p95} ms. Add the direct URL for a comparison.`, checks: [], notes, diagnostics };
}

/* ---------- Rendering ---------- */

function setStatus(text) {
  document.getElementById('status').textContent = text;
}

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text; // Never innerHTML: responses may contain arbitrary HTML.
  return node;
}

function renderResults() {
  const tbody = document.getElementById('results');
  tbody.replaceChildren();
  for (const test of TESTS) {
    const result = results[test.id];
    const status = result ? result.status : 'NOT-RUN';
    const row = el('tr');
    const label = el('td');
    label.append(el('strong', {}, test.id), document.createTextNode(` ${test.name}`));
    const badgeCell = el('td');
    badgeCell.append(el('span', { class: `badge ${status}` }, status === 'NOT-RUN' ? 'NOT RUN' : status));
    const detailCell = el('td');
    detailCell.append(el('div', {}, result ? result.summary : 'Not run yet.'));
    if (result) {
      const details = el('details');
      details.append(el('summary', {}, 'Checks and diagnostics'));
      if (result.checks.length) {
        const list = el('ul', { class: 'checks' });
        for (const check of result.checks) {
          list.append(el('li', { class: check.ok ? 'ok' : 'bad' }, check.detail ? `${check.label}: ${check.detail}` : check.label));
        }
        details.append(list);
      }
      for (const note of result.notes || []) details.append(el('p', {}, `Note: ${note}`));
      details.append(el('pre', {}, JSON.stringify(result.diagnostics, null, 2)));
      if (status === FAIL) details.open = true;
      detailCell.append(details);
    }
    row.append(label, badgeCell, detailCell);
    tbody.append(row);
  }
}

function renderEnvironment() {
  const dl = document.getElementById('environment');
  dl.replaceChildren();
  const entries = {
    'Page origin': location.origin,
    'Secure context': String(window.isSecureContext),
    'Direct backend URL': directBaseUrl() || '(not set)',
    Browser: navigator.userAgent,
    'Local time': new Date().toString(),
  };
  for (const [key, value] of Object.entries(entries)) dl.append(el('dt', {}, key), el('dd', {}, value));
}

function setBusy(busy) {
  for (const id of ['run-all', 'run-wake']) document.getElementById(id).disabled = busy;
}

async function runOne(id, fn) {
  results[id] = { id, status: 'RUNNING', summary: 'Running…', checks: [], notes: [], diagnostics: {} };
  renderResults();
  try {
    results[id] = await fn();
  } catch (error) {
    results[id] = { id, status: FAIL, summary: `Test harness error: ${error && error.message ? error.message : error}`, checks: [], notes: ['This is a bug in the test page, not necessarily in the forwarding.'], diagnostics: {} };
  }
  renderResults();
}

async function runAll() {
  setBusy(true);
  renderEnvironment();
  setStatus('Contacting the backend. If it is asleep this can take about a minute…');
  // The first request doubles as the P6 probe: if the backend was asleep,
  // this is where the wake-up happens.
  const probe = await request(`/api/ping?probe=${Date.now()}`, { timeoutMs: 120000 });
  const p6 = evaluateP6FromProbe(probe);
  await runOne('P6', () => p6);
  const order = [['P1', testP1], ['P2', testP2], ['P3', testP3], ['P4', testP4], ['P5', testP5], ['P7', testP7]];
  for (const [id, fn] of order) {
    setStatus(`Running ${id}…`);
    await runOne(id, fn);
  }
  const counts = Object.values(results).reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
  setStatus(`Finished: ${counts.PASS || 0} pass, ${counts.FAIL || 0} fail, ${counts.INCONCLUSIVE || 0} inconclusive.`);
  setBusy(false);
}

async function runWakeOnly() {
  setBusy(true);
  renderEnvironment();
  await runOne('P6', () => runWakeSequence(null));
  setStatus(`P6 finished: ${results.P6.status}.`);
  setBusy(false);
}

async function copyResults() {
  const report = {
    experiment: 'render-proxy',
    generatedAt: new Date().toISOString(),
    pageOrigin: location.origin,
    directBackendUrl: directBaseUrl() || null,
    browser: navigator.userAgent,
    results: TESTS.map((t) => results[t.id] || { id: t.id, status: 'NOT RUN' }),
  };
  const text = JSON.stringify(report, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    setStatus('Results copied to the clipboard.');
  } catch {
    const pre = el('pre', {}, text);
    document.querySelector('main').append(pre);
    setStatus('Clipboard unavailable: the results are shown at the bottom of the page.');
  }
}

document.getElementById('direct-url').value = config.directBackendUrl || '';
document.getElementById('direct-url').addEventListener('change', renderEnvironment);
document.getElementById('run-all').addEventListener('click', runAll);
document.getElementById('run-wake').addEventListener('click', runWakeOnly);
document.getElementById('copy').addEventListener('click', copyResults);
renderResults();
renderEnvironment();
