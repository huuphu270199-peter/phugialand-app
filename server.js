const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const webpush = require('web-push');
const { TuyaContext } = require('@tuya/tuya-connector-nodejs');

const port = Number(process.env.PORT || 4176);
const apiToken = process.env.NVP_API_TOKEN || '';
const smartHomePushToken = process.env.NVP_SMART_HOME_PUSH_TOKEN || apiToken;
const adminEmail = process.env.NVP_ADMIN_EMAIL || '';
const adminPassword = process.env.NVP_ADMIN_PASSWORD || '';
const sessionSecret = process.env.NVP_SESSION_SECRET || apiToken;
const bankWebhookSecret = process.env.NVP_BANK_WEBHOOK_SECRET || '';
const vapidPublicKey = process.env.NVP_VAPID_PUBLIC_KEY || '';
const vapidPrivateKey = process.env.NVP_VAPID_PRIVATE_KEY || '';
const vapidSubject = process.env.NVP_VAPID_SUBJECT || 'mailto:info.nhavanphuc@gmail.com';
if (vapidPublicKey && vapidPrivateKey) webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
const maxBodyBytes = 30_000_000;
const root = __dirname;
const dataDirectory = path.join(root, 'data');
const dataFile = path.join(dataDirectory, 'state.json');
const documentDirectory = path.join(dataDirectory, 'documents');
const mediaDirectory = path.join(dataDirectory, 'media');
const tuyaSingaporeEndpoint = 'https://openapi-sg.iotbing.com';
const tuyaSingaporeMqEndpoint = 'wss://mqe.tuyaus.com:8285/';
const administrativeUnitsUrl = 'https://provinces.open-api.vn/api/v2/?depth=2';
const allowedKeys = new Set([
  'nvp-buildings',
  'nvp-selected-building',
  'nvp-leads',
  'nvp-reservations',
  'nvp-contracts',
  'nvp-tasks',
  'nvp-invoices',
  'nvp-cashflow',
  'nvp-catalogs'
  , 'nvp-customers',
  'nvp-bookings',
  'nvp-locations',
  'nvp-meter-logs',
  'nvp-commissions',
  'nvp-prepayments',
  'nvp-deposit-ledger',
  'nvp-notifications',
  'nvp-users',
  'nvp-feedback',
  'nvp-smart-home-config',
  'nvp-push-subscriptions'
]);
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.pdf': 'application/pdf',
  '.ico': 'image/x-icon'
};
const appFiles = new Set(['index.html', 'styles.css', 'modal.css', 'enhancements.css', 'redesign.css', 'crud.css', 'utility-manager.css', 'building-form.css', 'building-manager.css', 'customer-manager.css', 'customer-detail.css', 'vp-theme.css', 'app.js', 'sw.js', 'manifest.webmanifest', 'assets/icon.svg', 'assets/Logo BPG.jpg']);
const websiteFiles = new Set(['public.html', 'public.css', 'vp-theme.css', 'public.js', 'assets/icon.svg', 'assets/Logo BPG.jpg']);
const loginFiles = new Set(['login.html', 'login.css', 'vp-theme.css', 'login.js', 'assets/icon.svg', 'assets/Logo BPG.jpg']);
const tenantFiles = new Set(['tenant.html', 'tenant.css', 'tenant.js', 'assets/icon.svg', 'assets/Logo BPG.jpg']);

function isApplicationHost(request) {
  const host = (request.headers.host || '').split(':')[0].toLowerCase();
  return host === 'phugialand.vn' || host === 'www.phugialand.vn' || host === 'app.phugialand.vn' || host === 'app.localhost' || host === 'localhost' || host === '127.0.0.1';
}

function isTenantHost(request) {
  const host = (request.headers.host || '').split(':')[0].toLowerCase();
  return host === 'tenant.phugialand.vn' || host === 'tenant.localhost';
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').map((item) => item.trim().split('=').map(decodeURIComponent)).filter(([key]) => key));
}

function signSession(email, role) {
  return crypto.createHmac('sha256', sessionSecret).update(`${role}:${email.toLowerCase()}`).digest('base64url');
}

function isAuthenticated(request) {
  if (!adminEmail || !adminPassword || !sessionSecret) return false;
  const cookies = parseCookies(request);
  const expected = signSession(adminEmail, 'manager');
  const session = Buffer.from(cookies.nvp_session || '');
  const signature = Buffer.from(expected);
  return session.length === signature.length && crypto.timingSafeEqual(session, signature);
}

function getTenantEmail(request) {
  if (!sessionSecret) return '';
  const email = parseCookies(request).nvp_tenant_email || '';
  const session = Buffer.from(parseCookies(request).nvp_tenant_session || '');
  const expected = Buffer.from(signSession(email, 'tenant'));
  return email && session.length === expected.length && crypto.timingSafeEqual(session, expected) ? email.toLowerCase() : '';
}

function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https://img.vietqr.io; connect-src 'self' http://localhost:4176 https://app.phugialand.vn"
  };
}

async function readState() {
  try {
    return JSON.parse(await fs.readFile(dataFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { version: 1, updatedAt: null, state: {} };
  }
}

async function writeState(state) {
  await fs.mkdir(dataDirectory, { recursive: true });
  const temporaryFile = `${dataFile}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryFile, JSON.stringify(state, null, 2), 'utf8');
  await fs.rename(temporaryFile, dataFile);
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...securityHeaders(),
    'Access-Control-Allow-Origin': 'http://localhost:4176',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  response.end(JSON.stringify(payload));
}

function getAvailableApartments(state) {
  let buildings = state.state?.['nvp-buildings'];
  try {
    buildings = typeof buildings === 'string' ? JSON.parse(buildings) : buildings;
  } catch {
    buildings = [];
  }
  if (!Array.isArray(buildings)) return [];
  return buildings.flatMap((building) => {
    const apartments = Array.isArray(building.apartments) ? building.apartments : [];
    const spaces = apartments.length ? apartments : building.listingType === 'whole-building' && building.active !== false ? [{ name: building.name, title: building.name, propertyType: 'whole-building', status: 'empty', media: building.media, image: building.image }] : [];
    return spaces
    .filter((apartment) => apartment.status === 'empty')
    .map((apartment) => ({
      building: String(building.name || 'Phú Gia Land'),
      address: String(building.address || ''),
      name: String(apartment.name || 'Căn hộ trống'),
      propertyType: String(apartment.propertyType || (building.listingType === 'whole-building' ? 'whole-building' : 'apartment')),
      title: String(apartment.title || apartment.name || 'Căn hộ trống'),
      description: String(apartment.description || ''),
      image: typeof apartment.image === 'string' && (apartment.image.startsWith('data:image/') || apartment.image.startsWith('/api/media/')) ? apartment.image : String(apartment.media?.find((item) => item.kind === 'image')?.url || ''),
      media: Array.isArray(apartment.media) ? apartment.media.filter((item) => item?.url && (item.kind === 'image' || item.kind === 'video')).map((item) => ({ kind: item.kind, url: item.url, mimeType: item.mimeType })) : [],
      beds: Number(apartment.beds || 0)
    }));
  });
}

async function serveStatic(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }
  const requestedPath = decodeURIComponent(request.url.split('?')[0]);
  const application = isApplicationHost(request);
  const tenant = isTenantHost(request);
  if (tenant) {
    const relativePath = requestedPath === '/' ? 'tenant.html' : requestedPath.replace(/^\/+/, '');
    if (!tenantFiles.has(relativePath)) { response.writeHead(404, securityHeaders()); response.end('Not found'); return; }
    const file = await fs.readFile(path.join(root, relativePath));
    response.writeHead(200, { ...securityHeaders(), 'Content-Type': mimeTypes[path.extname(relativePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    if (request.method === 'HEAD') response.end(); else response.end(file);
    return;
  }
  if (application && !isAuthenticated(request)) {
    const loginPath = requestedPath === '/' ? 'login.html' : requestedPath.replace(/^\/+/, '');
    if (!loginFiles.has(loginPath)) {
      response.writeHead(302, { Location: '/login.html', ...securityHeaders() });
      response.end();
      return;
    }
    const file = await fs.readFile(path.join(root, loginPath));
    response.writeHead(200, { ...securityHeaders(), 'Content-Type': mimeTypes[path.extname(loginPath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    if (request.method === 'HEAD') response.end();
    else response.end(file);
    return;
  }
  const files = application ? appFiles : websiteFiles;
  const relativePath = requestedPath === '/' ? (application ? 'index.html' : 'public.html') : requestedPath.replace(/^\/+/, '');
  if (!files.has(relativePath)) {
    response.writeHead(404, securityHeaders());
    response.end('Not found');
    return;
  }
  const filePath = path.resolve(root, relativePath);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  try {
    const file = await fs.readFile(filePath);
    response.writeHead(200, { ...securityHeaders(), 'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    if (request.method === 'HEAD') response.end();
    else response.end(file);
  } catch (error) {
    if (error.code === 'ENOENT' && !path.extname(relativePath)) {
      const fallback = await fs.readFile(path.join(root, application ? 'index.html' : 'public.html'));
      response.writeHead(200, { ...securityHeaders(), 'Content-Type': mimeTypes['.html'], 'Cache-Control': 'no-cache' });
      response.end(fallback);
      return;
    }
    response.writeHead(error.code === 'ENOENT' ? 404 : 500);
    response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
  }
}

async function readBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > maxBodyBytes) throw new Error('Payload too large');
  }
  return JSON.parse(body || '{}');
}

function parseStateValue(state, key, fallback) {
  try {
    const value = state.state?.[key];
    return typeof value === 'string' ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function hasMatchingSecret(value, secret) {
  const received = Buffer.from(String(value || ''));
  const expected = Buffer.from(secret);
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function isAuthorizedExternalApi(request, secret) {
  if (!secret) return false;
  const authorization = String(request.headers.authorization || '');
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : request.headers['x-nvp-api-token'];
  return hasMatchingSecret(token, secret);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('base64url')) {
  return `${salt}:${crypto.scryptSync(password, salt, 32).toString('base64url')}`;
}

function verifyPassword(password, storedHash) {
  const [salt, digest] = String(storedHash || '').split(':');
  if (!salt || !digest) return false;
  const actual = Buffer.from(crypto.scryptSync(password, salt, 32).toString('base64url'));
  const expected = Buffer.from(digest);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function normalizeSmartHomeReadings(payload) {
  const candidates = Array.isArray(payload) ? payload : payload?.readings || payload?.meters || payload?.data || payload?.devices || [];
  if (!Array.isArray(candidates)) return [];
  return candidates.map((item) => {
    const source = item && typeof item === 'object' ? item : { value: item };
    const meterId = source.meterId ?? source.deviceId ?? source.id ?? source.code ?? source.name ?? source.room ?? source.apartment;
    const current = source.current ?? source.reading ?? source.value ?? source.energy ?? source.total ?? source.kwh;
    const numericCurrent = Number(current);
    return { meterId: String(meterId || '').trim(), current: numericCurrent, timestamp: source.timestamp || source.updatedAt || null };
  }).filter((item) => item.meterId && Number.isFinite(item.current));
}

function previousMonth(now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return date.toISOString().slice(0, 7);
}

async function closeUtilityInvoices(month = previousMonth()) {
  const state = await readState();
  const buildings = parseStateValue(state, 'nvp-buildings', []);
  const customers = parseStateValue(state, 'nvp-customers', []);
  const meterLogs = parseStateValue(state, 'nvp-meter-logs', []);
  const invoices = parseStateValue(state, 'nvp-invoices', []);
  const created = [];
  buildings.forEach((building) => (building.apartments || []).forEach((apartment) => {
    const customer = customers.find((item) => item.status === 'renting' && String(item.apartment || '').trim() === String(apartment.name || '').trim() && (!item.building || String(item.building).trim() === String(building.name).trim()));
    if (!customer || invoices.some((invoice) => invoice.type === 'utilities' && invoice.month === month && invoice.building === building.name && invoice.apartment === apartment.name)) return;
    const records = meterLogs.filter((log) => log.month === month && log.apartment === `${building.name} | ${apartment.name}`);
    const electricity = records.filter((log) => log.service === 'electricity').reduce((total, log) => total + Number(log.amount || 0), 0);
    const water = records.filter((log) => log.service === 'water').reduce((total, log) => total + Number(log.amount || 0), 0);
    if (!records.length) return;
    const dueDate = new Date(`${month}-01T00:00:00`);
    dueDate.setMonth(dueDate.getMonth() + 1);
    dueDate.setDate(Math.min(Math.max(Number(building.settings?.paymentDay || 5), 1), 28));
    const invoice = { id: crypto.randomUUID(), paymentCode: `NVP-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`, building: building.name, apartment: apartment.name, tenantEmail: customer.email || '', tenantName: customer.name || '', title: `Điện nước ${month} - ${apartment.name}`, type: 'utilities', month, amount: electricity + water, utilityLines: { electricity, water }, dueDate: dueDate.toISOString().slice(0, 10), status: 'unpaid', createdAt: new Date().toISOString() };
    invoices.push(invoice);
    created.push(invoice);
  }));
  if (created.length) {
    state.updatedAt = new Date().toISOString();
    state.state['nvp-invoices'] = JSON.stringify(invoices);
    await writeState(state);
  }
  return created;
}

async function fetchSmartHomeReadings(config) {
  const endpoint = String(config?.url || '').trim();
  if (!/^https?:\/\//i.test(endpoint)) throw new Error('Smart Home URL must use http or https');
  const headers = { Accept: 'application/json' };
  if (config.token) headers.Authorization = `Bearer ${String(config.token)}`;
  if (config.apiKey) headers['X-API-Key'] = String(config.apiKey);
  const upstream = await fetch(endpoint, { headers });
  if (!upstream.ok) throw new Error(`Smart Home API returned ${upstream.status}`);
  return normalizeSmartHomeReadings(await upstream.json());
}

async function fetchTuyaMeters(config) {
  if (!config?.tuyaAccessId || !config?.tuyaAccessSecret) throw new Error('Tuya Cloud is not configured');
  const deviceIds = String(config.tuyaDeviceIds || '').split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
  if (!deviceIds.length) throw new Error('Add at least one Tuya Device ID in Smart Home settings');
  const tuya = new TuyaContext({
    baseUrl: String(config.tuyaEndpoint || tuyaSingaporeEndpoint).replace(/openapi\.tuyaas\.com|openapi\.tuyas\.com|openapi\.tuyaus\.com/, 'openapi-sg.iotbing.com'),
    accessKey: config.tuyaAccessId,
    secretKey: config.tuyaAccessSecret
  });
  const response = await tuya.request({
    method: 'GET',
    path: `/v1.0/iot-03/devices?device_ids=${encodeURIComponent(deviceIds.join(','))}`,
    body: {}
  });
  if (!response?.success) throw new Error(response?.msg || 'Tuya device query failed');
  const devices = response.result?.list || [];
  return devices.map((device) => ({
    meterId: String(device.id || device.device_id || device.dev_id || '').trim(),
    name: String(device.name || device.product_name || device.productName || '').trim()
  })).filter((device) => device.meterId);
}

function getDocumentType(dataUrl) {
  const matched = /^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,/.exec(dataUrl);
  if (!matched) return null;
  return { mimeType: matched[1], extension: ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' })[matched[1]] };
}

function getMediaType(dataUrl) {
  const matched = /^data:(image\/(?:jpeg|png|webp)|video\/(?:mp4|webm|quicktime));base64,/.exec(dataUrl);
  if (!matched) return null;
  return { mimeType: matched[1], extension: ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' })[matched[1]] };
}

function safeMediaPart(value, fallback) {
  const normalized = String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toUpperCase().slice(0, 40);
  return normalized || fallback;
}

function collectMediaNames(state) {
  let buildings = parseStateValue(state, 'nvp-buildings', []);
  if (!Array.isArray(buildings)) buildings = [];
  const names = new Set();
  buildings.forEach((building) => {
    [...(building.media || []), ...(building.apartments || []).flatMap((apartment) => apartment.media || [])].forEach((item) => {
      if (item?.fileName) names.add(path.basename(item.fileName));
    });
  });
  return names;
}

async function removeOrphanedMedia(previousState, nextState) {
  const previousNames = collectMediaNames(previousState);
  const nextNames = collectMediaNames(nextState);
  await Promise.all([...previousNames].filter((fileName) => !nextNames.has(fileName)).map(async (fileName) => {
    try { await fs.unlink(path.join(mediaDirectory, fileName)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }));
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {});
    return;
  }
  try {
    if (!request.url.startsWith('/api/')) {
      await serveStatic(request, response);
      return;
    }
    if (request.method === 'GET' && request.url === '/api/health') {
      sendJson(response, 200, { ok: true, service: 'phu-gia-land-api' });
      return;
    }
    if (request.method === 'GET' && request.url === '/api/push-config') {
      sendJson(response, 200, { enabled: Boolean(vapidPublicKey && vapidPrivateKey), publicKey: vapidPublicKey });
      return;
    }
    if (request.method === 'POST' && request.url === '/api/push-subscriptions') {
      const email = getTenantEmail(request);
      if (!email) { sendJson(response, 401, { error: 'Unauthorized' }); return; }
      const payload = await readBody(request);
      if (!payload.subscription?.endpoint) { sendJson(response, 400, { error: 'Invalid subscription' }); return; }
      const state = await readState();
      const subscriptions = parseStateValue(state, 'nvp-push-subscriptions', []);
        const next = subscriptions.filter((item) => item.email !== email || item.subscription.endpoint !== payload.subscription.endpoint);
      next.push({ email, subscription: payload.subscription, updatedAt: new Date().toISOString() });
      state.updatedAt = new Date().toISOString();
      state.state['nvp-push-subscriptions'] = JSON.stringify(next);
      await writeState(state);
      sendJson(response, 201, { ok: true, enabled: Boolean(vapidPublicKey && vapidPrivateKey) });
      return;
    }
    if (request.method === 'POST' && request.url === '/api/push-notify') {
      if (!isAuthenticated(request)) { sendJson(response, 401, { error: 'Unauthorized' }); return; }
      if (!vapidPublicKey || !vapidPrivateKey) { sendJson(response, 503, { error: 'Push is not configured' }); return; }
      const payload = await readBody(request);
      const state = await readState();
      const subscriptions = parseStateValue(state, 'nvp-push-subscriptions', []);
      const targets = subscriptions.filter((item) => payload.email ? item.email === String(payload.email).toLowerCase() : payload.audience === 'all-tenants');
      const message = JSON.stringify({ title: String(payload.title || 'Phú Gia Land'), body: String(payload.body || ''), url: '/'});
      const results = await Promise.allSettled(targets.map((item) => webpush.sendNotification(item.subscription, message)));
      const expired = new Set(results.map((result, index) => result.status === 'rejected' && [404, 410].includes(result.reason?.statusCode) ? targets[index].subscription.endpoint : '').filter(Boolean));
      if (expired.size) { state.state['nvp-push-subscriptions'] = JSON.stringify(subscriptions.filter((item) => !expired.has(item.subscription.endpoint))); await writeState(state); }
      sendJson(response, 200, { ok: true, sent: results.filter((result) => result.status === 'fulfilled').length });
      return;
    }
    if (request.method === 'GET' && request.url === '/api/availability') {
      const state = await readState();
      sendJson(response, 200, { updatedAt: state.updatedAt, apartments: getAvailableApartments(state) });
      return;
    }
    if (request.method === 'POST' && request.url === '/api/utilities/close') {
      if (!isAuthenticated(request)) { sendJson(response, 401, { error: 'Unauthorized' }); return; }
      const payload = await readBody(request);
      const month = /^\d{4}-\d{2}$/.test(String(payload.month || '')) ? payload.month : previousMonth();
      const invoices = await closeUtilityInvoices(month);
      sendJson(response, 200, { ok: true, month, created: invoices.length });
      return;
    }
    if (request.method === 'POST' && request.url === '/api/smart-home/readings') {
      if (!isAuthenticated(request)) { sendJson(response, 401, { error: 'Unauthorized' }); return; }
      const payload = await readBody(request);
      try {
        sendJson(response, 200, { readings: await fetchSmartHomeReadings(payload) });
      } catch (error) {
        sendJson(response, 502, { error: error.message || 'Smart Home API unavailable' });
      }
      return;
    }
    if (request.method === 'GET' && request.url === '/api/smart-home/meters') {
      if (!isAuthenticated(request)) { sendJson(response, 401, { error: 'Unauthorized' }); return; }
      try {
        const config = parseStateValue(await readState(), 'nvp-smart-home-config', {});
        sendJson(response, 200, { meters: await fetchTuyaMeters(config) });
      } catch (error) {
        sendJson(response, 502, { error: error.message || 'Unable to retrieve Tuya devices' });
      }
      return;
    }
    if (request.url === '/api/smart-home/config' && request.method === 'GET') {
      if (!isAuthenticated(request)) { sendJson(response, 401, { error: 'Unauthorized' }); return; }
      const config = parseStateValue(await readState(), 'nvp-smart-home-config', {});
      sendJson(response, 200, {
        endpoint: '/api/smart-home/push-readings',
        configured: Boolean(config.pushToken || smartHomePushToken),
        tokenSet: Boolean(config.pushToken || smartHomePushToken),
        tuyaAccessId: config.tuyaAccessId || '',
        tuyaEndpoint: String(config.tuyaEndpoint || tuyaSingaporeEndpoint).replace(/openapi\.tuyaas\.com|openapi\.tuyas\.com|openapi\.tuyaus\.com/, 'openapi-sg.iotbing.com'),
        tuyaMqEndpoint: String(config.tuyaMqEndpoint || tuyaSingaporeMqEndpoint).replace(/mqe\.tuyaas\.com|mqe\.tuyas\.com/, 'mqe.tuyaus.com'),
        tuyaDeviceIds: config.tuyaDeviceIds || '',
        tuyaTopic: config.tuyaTopic || '',
        tuyaSubscription: config.tuyaSubscription || 'phu-gia-energy',
        tuyaSecretSet: Boolean(config.tuyaAccessSecret),
        tuyaMqTokenSet: Boolean(config.tuyaMqToken)
      });
      return;
    }
    if (request.url === '/api/smart-home/config' && request.method === 'PUT') {
      if (!isAuthenticated(request)) { sendJson(response, 401, { error: 'Unauthorized' }); return; }
      const payload = await readBody(request);
      const pushToken = String(payload.pushToken || '').trim();
      const state = await readState();
      const existing = parseStateValue(state, 'nvp-smart-home-config', {});
      const hasTuyaInput = ['tuyaAccessId', 'tuyaAccessSecret', 'tuyaEndpoint', 'tuyaMqEndpoint', 'tuyaDeviceIds', 'tuyaTopic', 'tuyaMqToken', 'tuyaSubscription'].some((key) => key in payload);
      if (pushToken && pushToken.length < 16) { sendJson(response, 400, { error: 'Smart Home token must be at least 16 characters' }); return; }
      if (hasTuyaInput && !String(payload.tuyaAccessId || existing.tuyaAccessId || '').trim()) { sendJson(response, 400, { error: 'Tuya Access ID is required' }); return; }
      if (hasTuyaInput && !String(payload.tuyaAccessSecret || existing.tuyaAccessSecret || '').trim()) { sendJson(response, 400, { error: 'Tuya Access Secret is required' }); return; }
      const config = {
        ...existing,
        pushToken: pushToken || existing.pushToken || '',
        tuyaAccessId: String(payload.tuyaAccessId || existing.tuyaAccessId || '').trim(),
        tuyaAccessSecret: String(payload.tuyaAccessSecret || existing.tuyaAccessSecret || '').trim(),
        tuyaEndpoint: String(payload.tuyaEndpoint || existing.tuyaEndpoint || tuyaSingaporeEndpoint).trim().replace(/openapi\.tuyaas\.com|openapi\.tuyas\.com|openapi\.tuyaus\.com/, 'openapi-sg.iotbing.com'),
        tuyaMqEndpoint: String(payload.tuyaMqEndpoint || existing.tuyaMqEndpoint || tuyaSingaporeMqEndpoint).trim().replace(/mqe\.tuyaas\.com|mqe\.tuyas\.com/, 'mqe.tuyaus.com'),
        tuyaDeviceIds: String(payload.tuyaDeviceIds || existing.tuyaDeviceIds || '').trim(),
        tuyaTopic: String(payload.tuyaTopic || existing.tuyaTopic || '').trim(),
        tuyaMqToken: String(payload.tuyaMqToken || existing.tuyaMqToken || '').trim(),
        tuyaSubscription: String(payload.tuyaSubscription || existing.tuyaSubscription || 'phu-gia-energy').trim(),
        updatedAt: new Date().toISOString()
      };
      if (!/^https:\/\//i.test(config.tuyaEndpoint) || !/^wss:\/\//i.test(config.tuyaMqEndpoint)) { sendJson(response, 400, { error: 'Tuya endpoints must use HTTPS and WSS' }); return; }
      state.state['nvp-smart-home-config'] = JSON.stringify(config);
      state.updatedAt = new Date().toISOString();
      await writeState(state);
      sendJson(response, 200, { ok: true, endpoint: '/api/smart-home/push-readings', tuyaConfigured: Boolean(config.tuyaAccessId && config.tuyaAccessSecret) });
      return;
    }
    if (request.method === 'POST' && request.url === '/api/smart-home/push-readings') {
      const configured = parseStateValue(await readState(), 'nvp-smart-home-config', {});
      if (!isAuthorizedExternalApi(request, configured.pushToken || smartHomePushToken)) { sendJson(response, 401, { error: 'Unauthorized' }); return; }
      const payload = await readBody(request);
      const readings = normalizeSmartHomeReadings(payload);
      const month = String(payload.month || new Date().toISOString().slice(0, 7));
      const state = await readState();
      const buildings = parseStateValue(state, 'nvp-buildings', []);
      const customers = parseStateValue(state, 'nvp-customers', []);
      const meterLogs = parseStateValue(state, 'nvp-meter-logs', []);
      const invoices = parseStateValue(state, 'nvp-invoices', []);
      const building = buildings.find((item) => String(payload.buildingCode || '').trim() === String(item.code || '').trim() || String(payload.buildingCode || '').trim() === String(item.name || '').trim());
      if (!building) { sendJson(response, 404, { error: 'Building not found' }); return; }
      const processed = [];
      const skipped = [];
      readings.forEach((reading) => {
        const apartment = (building.apartments || []).find((item) => String(item.meterId || '').trim() === reading.meterId);
        if (!apartment) { skipped.push({ meterId: reading.meterId, reason: 'Meter is not mapped to an apartment' }); return; }
        const apartmentKey = `${building.name} | ${apartment.name}`;
        const previousLog = meterLogs.filter((item) => item.service === 'electricity' && (item.meterId === reading.meterId || item.apartment === apartmentKey)).at(-1);
        const previous = Number(previousLog?.current || 0);
        if (reading.current < previous) { skipped.push({ meterId: reading.meterId, reason: 'Current reading is lower than previous reading' }); return; }
        if (meterLogs.some((item) => item.service === 'electricity' && item.meterId === reading.meterId && item.month === month && Number(item.current) === reading.current)) { skipped.push({ meterId: reading.meterId, reason: 'Reading already processed' }); return; }
        const floorRate = Number((building.settings?.electricityFloorRates || {})[apartment.floor] || 0);
        const rate = Number(apartment.electricityRate || floorRate || building.settings?.electricityRate || 0);
        const usage = reading.current - previous;
        const amount = usage * rate;
        const customer = customers.find((item) => String(item.apartment || '').trim() === String(apartment.name || '').trim() && (!item.building || String(item.building).trim() === String(building.name).trim()) && item.status === 'renting');
        const createdAt = new Date().toISOString();
        const invoice = { id: crypto.randomUUID(), paymentCode: `NVP-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`, building: building.name, tenantEmail: customer?.email || '', apartment: apartment.name, meterId: reading.meterId, title: `Tiền điện ${month} - ${apartment.name}`, type: 'electricity', amount, usage, rate, dueDate: month, status: 'unpaid', createdAt };
        meterLogs.push({ id: crypto.randomUUID(), apartment: apartmentKey, meterId: reading.meterId, service: 'electricity', previous, current: reading.current, usage, rate, amount, month, source: 'smart-home-api', createdAt });
        invoices.push(invoice);
        processed.push({ meterId: reading.meterId, apartment: apartment.name, previous, current: reading.current, usage, rate, amount, invoiceId: invoice.id, tenantEmail: invoice.tenantEmail });
      });
      state.updatedAt = new Date().toISOString();
      state.state['nvp-meter-logs'] = JSON.stringify(meterLogs);
      state.state['nvp-invoices'] = JSON.stringify(invoices);
      await writeState(state);
      sendJson(response, 200, { ok: true, month, building: building.name, processed, skipped });
      return;
    }
    if (request.method === 'GET' && request.url === '/api/administrative-units') {
      const upstream = await fetch(administrativeUnitsUrl);
      if (!upstream.ok) throw new Error('Administrative data unavailable');
      sendJson(response, 200, await upstream.json());
      return;
    }
    if (request.method === 'POST' && request.url === '/api/bank-webhook') {
      if (!bankWebhookSecret) {
        sendJson(response, 503, { error: 'Bank webhook is not configured' });
        return;
      }
      if (!hasMatchingSecret(request.headers['x-nvp-webhook-secret'], bankWebhookSecret)) {
        sendJson(response, 401, { error: 'Unauthorized' });
        return;
      }
      const payload = await readBody(request);
      const transactionId = String(payload.transactionId || '').trim();
      const content = String(payload.content || '');
      const amount = Number(payload.amount || 0);
      if (!transactionId || !Number.isFinite(amount) || amount <= 0) {
        sendJson(response, 400, { error: 'Invalid transaction' });
        return;
      }
      const current = await readState();
      const invoices = parseStateValue(current, 'nvp-invoices', []);
      const cashflow = parseStateValue(current, 'nvp-cashflow', []);
      const existing = invoices.find((invoice) => invoice.bankTransactionId === transactionId);
      if (existing) {
        sendJson(response, 200, { ok: true, duplicate: true, invoice: existing.paymentCode });
        return;
      }
      const invoice = invoices.find((item) => item.status !== 'paid' && item.paymentCode && content.toUpperCase().includes(String(item.paymentCode).toUpperCase()));
      if (!invoice) {
        sendJson(response, 202, { ok: false, reason: 'Payment code not matched' });
        return;
      }
      if (amount < Number(invoice.amount || 0)) {
        sendJson(response, 202, { ok: false, reason: 'Payment amount is insufficient', invoice: invoice.paymentCode });
        return;
      }
      invoice.status = 'paid';
      invoice.paidAt = new Date().toISOString();
      invoice.paidAmount = amount;
      invoice.overpayment = Math.max(amount - Number(invoice.amount || 0), 0);
      invoice.bankTransactionId = transactionId;
      invoice.bankContent = content;
      cashflow.push({ id: crypto.randomUUID(), title: `Thu hóa đơn ${invoice.paymentCode}`, type: 'income', amount, invoiceCode: invoice.paymentCode, bankTransactionId: transactionId, createdAt: invoice.paidAt });
      current.updatedAt = new Date().toISOString();
      current.state['nvp-invoices'] = JSON.stringify(invoices);
      current.state['nvp-cashflow'] = JSON.stringify(cashflow);
      await writeState(current);
      sendJson(response, 200, { ok: true, invoice: invoice.paymentCode, overpayment: invoice.overpayment });
      return;
    }
    if (request.method === 'POST' && request.url === '/api/documents') {
      if (!isAuthenticated(request)) {
        sendJson(response, 401, { error: 'Unauthorized' });
        return;
      }
      const payload = await readBody(request);
      const dataUrl = String(payload.dataUrl || '');
      const documentType = getDocumentType(dataUrl);
      if (!documentType) {
        sendJson(response, 400, { error: 'Unsupported document format' });
        return;
      }
      const content = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
      if (!content.length || content.length > 700_000) {
        sendJson(response, 413, { error: 'Document too large' });
        return;
      }
      await fs.mkdir(documentDirectory, { recursive: true });
      const id = crypto.randomUUID();
      await fs.writeFile(path.join(documentDirectory, `${id}.${documentType.extension}`), content);
      sendJson(response, 201, { id, fileName: String(payload.fileName || 'Giay-to').slice(0, 120), url: `/api/documents/${id}.${documentType.extension}` });
      return;
    }
    if (request.method === 'POST' && request.url === '/api/media') {
      if (!isAuthenticated(request)) {
        sendJson(response, 401, { error: 'Unauthorized' });
        return;
      }
      const payload = await readBody(request);
      const dataUrl = String(payload.dataUrl || '');
      const mediaType = getMediaType(dataUrl);
      if (!mediaType) {
        sendJson(response, 400, { error: 'Unsupported media format' });
        return;
      }
      const content = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
      const maxMediaBytes = mediaType.mimeType.startsWith('video/') ? 20_000_000 : 5_000_000;
      if (!content.length || content.length > maxMediaBytes) {
        sendJson(response, 413, { error: 'Media too large' });
        return;
      }
      const kind = mediaType.mimeType.startsWith('video/') ? 'video' : 'image';
      const prefix = safeMediaPart(payload.buildingCode, 'BUILDING');
      const assetCode = safeMediaPart(payload.assetCode, 'SPACE');
      const suffix = kind === 'video' ? 'VIDEO' : String(Math.max(1, Number(payload.index) || 1)).padStart(2, '0');
      const fileName = `${prefix}-${assetCode}-${suffix}.${mediaType.extension}`;
      await fs.mkdir(mediaDirectory, { recursive: true });
      await fs.writeFile(path.join(mediaDirectory, fileName), content);
      sendJson(response, 201, { media: { fileName, kind, mimeType: mediaType.mimeType, url: `/api/media/${encodeURIComponent(fileName)}` } });
      return;
    }
    if (request.method === 'GET' && request.url.startsWith('/api/media/')) {
      const fileName = path.basename(decodeURIComponent(request.url.slice('/api/media/'.length)));
      if (!/^[A-Z0-9-]+\.(jpg|png|webp|mp4|webm|mov)$/.test(fileName)) {
        sendJson(response, 404, { error: 'Media not found' });
        return;
      }
      try {
        const file = await fs.readFile(path.join(mediaDirectory, fileName));
        const extension = path.extname(fileName);
        response.writeHead(200, { ...securityHeaders(), 'Content-Type': mimeTypes[extension] || (extension === '.mp4' ? 'video/mp4' : 'application/octet-stream'), 'Content-Disposition': 'inline', 'Cache-Control': 'public, max-age=31536000, immutable' });
        response.end(file);
      } catch (error) {
        sendJson(response, error.code === 'ENOENT' ? 404 : 500, { error: 'Media not found' });
      }
      return;
    }
    if (request.method === 'GET' && request.url.startsWith('/api/documents/')) {
      const filename = path.basename(request.url.slice('/api/documents/'.length));
      const tenantEmail = getTenantEmail(request);
      const tenantState = tenantEmail ? await readState() : null;
      const tenantFeedback = tenantEmail ? parseStateValue(tenantState, 'nvp-feedback', []) : [];
      const tenantOwnsDocument = tenantFeedback.some((item) => String(item.tenantEmail || '').toLowerCase() === tenantEmail && String(item.imageUrl || '').endsWith(filename));
      if (!isAuthenticated(request) && !tenantOwnsDocument) {
        sendJson(response, 401, { error: 'Unauthorized' });
        return;
      }
      if (!/^[a-f0-9-]{36}\.(jpg|png|webp|pdf)$/.test(filename)) {
        sendJson(response, 404, { error: 'Document not found' });
        return;
      }
      const filePath = path.join(documentDirectory, filename);
      try {
        const file = await fs.readFile(filePath);
        const extension = path.extname(filename);
        response.writeHead(200, { ...securityHeaders(), 'Content-Type': mimeTypes[extension] || 'application/octet-stream', 'Content-Disposition': 'inline' });
        response.end(file);
      } catch (error) {
        sendJson(response, error.code === 'ENOENT' ? 404 : 500, { error: 'Document not found' });
      }
      return;
    }
    if (request.method === 'POST' && request.url === '/api/login') {
      const payload = await readBody(request);
      if (!adminEmail || !adminPassword || !sessionSecret) {
        sendJson(response, 503, { error: 'Authentication is not configured' });
        return;
      }
      const email = String(payload.email || '').trim().toLowerCase();
      const password = String(payload.password || '');
      if (email !== adminEmail.toLowerCase() || password !== adminPassword) {
        sendJson(response, 401, { error: 'Invalid credentials' });
        return;
      }
      const secure = request.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...securityHeaders(), 'Set-Cookie': `nvp_session=${encodeURIComponent(signSession(adminEmail, 'manager'))}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure}` });
      response.end(JSON.stringify({ ok: true, role: 'manager' }));
      return;
    }
    if (request.method === 'POST' && request.url === '/api/logout') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...securityHeaders(), 'Set-Cookie': ['nvp_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0', 'nvp_tenant_email=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0', 'nvp_tenant_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'] });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (request.method === 'POST' && request.url === '/api/tenant-login') {
      const payload = await readBody(request);
      const email = String(payload.email || '').trim().toLowerCase();
      const password = String(payload.password || '');
      const users = parseStateValue(await readState(), 'nvp-users', []);
      const user = users.find((item) => String(item.email || '').toLowerCase() === email && item.role === 'tenant' && item.active !== false && verifyPassword(password, item.passwordHash));
      if (!user || !sessionSecret) { sendJson(response, 401, { error: 'Invalid credentials' }); return; }
      const secure = request.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...securityHeaders(), 'Set-Cookie': [`nvp_tenant_email=${encodeURIComponent(email)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure}`, `nvp_tenant_session=${encodeURIComponent(signSession(email, 'tenant'))}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure}`] });
      response.end(JSON.stringify({ ok: true, role: 'tenant' }));
      return;
    }
    if (request.method === 'POST' && request.url === '/api/tenant-users') {
      if (!isAuthenticated(request)) { sendJson(response, 401, { error: 'Unauthorized' }); return; }
      const payload = await readBody(request);
      const name = String(payload.name || '').trim();
      const email = String(payload.email || '').trim().toLowerCase();
      const password = String(payload.password || '');
      const customerId = String(payload.customerId || '').trim();
      if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) { sendJson(response, 400, { error: 'Invalid user data' }); return; }
      const current = await readState();
      const users = parseStateValue(current, 'nvp-users', []);
      const customers = parseStateValue(current, 'nvp-customers', []);
      if (users.some((item) => String(item.email || '').toLowerCase() === email)) { sendJson(response, 409, { error: 'Email already exists' }); return; }
      const user = { id: crypto.randomUUID(), customerId, name, email, passwordHash: hashPassword(password), role: 'tenant', active: true, createdAt: new Date().toISOString() };
      users.push(user);
      const customer = customers.find((item) => item.id === customerId);
      if (customer) { customer.email = email; customer.accountId = user.id; }
      current.updatedAt = new Date().toISOString();
      current.state['nvp-users'] = JSON.stringify(users);
      current.state['nvp-customers'] = JSON.stringify(customers);
      await writeState(current);
      sendJson(response, 201, { user });
      return;
    }
    if (request.method === 'GET' && request.url === '/api/tenant-portal') {
      const email = getTenantEmail(request);
      if (!email) { sendJson(response, 401, { error: 'Unauthorized' }); return; }
      const state = await readState();
      const users = parseStateValue(state, 'nvp-users', []);
      const user = users.find((item) => String(item.email || '').toLowerCase() === email);
      const notifications = parseStateValue(state, 'nvp-notifications', []).filter((item) => String(item.recipientEmail || '').toLowerCase() === email || item.audience === 'all-tenants');
      const invoices = parseStateValue(state, 'nvp-invoices', []).filter((item) => String(item.tenantEmail || '').toLowerCase() === email);
      const feedback = parseStateValue(state, 'nvp-feedback', []).filter((item) => String(item.tenantEmail || '').toLowerCase() === email);
      sendJson(response, 200, { user: { name: user?.name || email, email }, notifications, invoices, feedback });
      return;
    }
    if (request.method === 'POST' && request.url === '/api/tenant-feedback') {
      const email = getTenantEmail(request);
      if (!email) { sendJson(response, 401, { error: 'Unauthorized' }); return; }
      const payload = await readBody(request);
      const title = String(payload.title || '').trim();
      const message = String(payload.message || '').trim();
      const category = String(payload.category || 'other');
      const priority = String(payload.priority || 'normal');
      if (!title || !message) { sendJson(response, 400, { error: 'Title and message are required' }); return; }
      const current = await readState();
      const feedback = parseStateValue(current, 'nvp-feedback', []);
      let imageUrl = '';
      const dataUrl = String(payload.imageDataUrl || '');
      if (dataUrl) {
        const documentType = getDocumentType(dataUrl);
        if (!documentType || !documentType.mimeType.startsWith('image/')) { sendJson(response, 400, { error: 'Unsupported image format' }); return; }
        const content = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
        if (!content.length || content.length > 700_000) { sendJson(response, 413, { error: 'Image too large' }); return; }
        await fs.mkdir(documentDirectory, { recursive: true });
        const id = crypto.randomUUID();
        await fs.writeFile(path.join(documentDirectory, `${id}.${documentType.extension}`), content);
        imageUrl = `/api/documents/${id}.${documentType.extension}`;
      }
      const item = { id: crypto.randomUUID(), tenantEmail: email, title, message, category, priority, imageUrl, status: 'new', createdAt: new Date().toISOString() };
      feedback.unshift(item);
      current.updatedAt = new Date().toISOString();
      current.state['nvp-feedback'] = JSON.stringify(feedback);
      await writeState(current);
      sendJson(response, 201, { feedback: item });
      return;
    }
    if (request.method === 'GET' && request.url === '/api/state') {
      if (!isAuthenticated(request) && (!apiToken || request.headers.authorization !== `Bearer ${apiToken}`)) {
        sendJson(response, 401, { error: 'Unauthorized' });
        return;
      }
      sendJson(response, 200, await readState());
      return;
    }
    if (request.method === 'PUT' && request.url === '/api/state') {
      if (!isAuthenticated(request) && (!apiToken || request.headers.authorization !== `Bearer ${apiToken}`)) {
        sendJson(response, 401, { error: 'Unauthorized' });
        return;
      }
      const payload = await readBody(request);
      const current = await readState();
      const incoming = payload.state && typeof payload.state === 'object' ? payload.state : {};
      const state = Object.fromEntries(Object.entries(incoming).filter(([key]) => allowedKeys.has(key)));
      const next = { version: 1, updatedAt: new Date().toISOString(), state: { ...current.state, ...state } };
      await removeOrphanedMedia(current, next);
      await writeState(next);
      sendJson(response, 200, next);
      return;
    }
    if (request.method === 'DELETE' && request.url === '/api/state') {
      if (!isAuthenticated(request) && (!apiToken || request.headers.authorization !== `Bearer ${apiToken}`)) {
        sendJson(response, 401, { error: 'Unauthorized' });
        return;
      }
      await Promise.all([
        fs.rm(documentDirectory, { recursive: true, force: true }),
        fs.rm(mediaDirectory, { recursive: true, force: true })
      ]);
      await writeState({ version: 1, updatedAt: new Date().toISOString(), state: {} });
      sendJson(response, 200, { ok: true });
      return;
    }
    sendJson(response, 404, { error: 'API endpoint not found' });
  } catch (error) {
    console.error(error);
    sendJson(response, error.message === 'Payload too large' ? 413 : 400, { error: 'Invalid request' });
  }
});

server.listen(port, () => {
  console.log(`Phu Gia Land API listening on http://localhost:${port}`);
  const runMonthlyClosing = () => {
    if (new Date().getDate() === 1) closeUtilityInvoices().then((invoices) => console.log(`Utility closing: ${invoices.length} invoice(s) created`)).catch((error) => console.error('Utility closing failed:', error.message));
  };
  runMonthlyClosing();
  setInterval(runMonthlyClosing, 60 * 60 * 1000);
});
