const http = require('node:http');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { ZipArchive } = require('archiver');
const unzipper = require('unzipper');
const webpush = require('web-push');
const mysql = require('mysql2/promise');
const { TuyaContext } = require('@tuya/tuya-connector-nodejs');

require('dotenv').config();

const port = Number(process.env.PORT || 4176);
const apiToken = process.env.NVP_API_TOKEN || '';
const smartHomePushToken = process.env.NVP_SMART_HOME_PUSH_TOKEN || apiToken;
let adminEmail = String(process.env.NVP_ADMIN_EMAIL || '').trim().toLowerCase();
let adminPassword = String(process.env.NVP_ADMIN_PASSWORD || '');
let adminPasswordChangeRequired = process.env.NVP_ADMIN_PASSWORD_CHANGE_REQUIRED !== 'false';
const sessionSecret = String(process.env.NVP_SESSION_SECRET || '');
const bankWebhookSecret = process.env.NVP_BANK_WEBHOOK_SECRET || '';
const vapidPublicKey = process.env.NVP_VAPID_PUBLIC_KEY || '';
const vapidPrivateKey = process.env.NVP_VAPID_PRIVATE_KEY || '';
const vapidSubject = process.env.NVP_VAPID_SUBJECT || '';
const missingRequiredEnvironment = [
  ['NVP_ADMIN_EMAIL', adminEmail],
  ['NVP_ADMIN_PASSWORD', adminPassword],
  ['NVP_SESSION_SECRET', sessionSecret]
].filter(([, value]) => !value).map(([name]) => name);
if (missingRequiredEnvironment.length) throw new Error(`Missing required environment variables: ${missingRequiredEnvironment.join(', ')}`);
if (adminPassword.length < 12) throw new Error('NVP_ADMIN_PASSWORD must contain at least 12 characters');
if (sessionSecret.length < 32) throw new Error('NVP_SESSION_SECRET must contain at least 32 characters');
if ((vapidPublicKey || vapidPrivateKey) && (!vapidPublicKey || !vapidPrivateKey || !vapidSubject)) throw new Error('NVP_VAPID_PUBLIC_KEY, NVP_VAPID_PRIVATE_KEY, and NVP_VAPID_SUBJECT must be configured together');
if (vapidPublicKey && vapidPrivateKey) webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
const maxBodyBytes = 100_000_000;
const root = __dirname;
const dataDirectory = process.env.NVP_DATA_DIRECTORY ? path.resolve(process.env.NVP_DATA_DIRECTORY) : path.join(root, 'data');
const dataFile = path.join(dataDirectory, 'state.json');
const ownerCredentialsFile = path.join(dataDirectory, 'owner-credentials.json');
const documentDirectory = path.join(dataDirectory, 'documents');
const mediaDirectory = path.join(dataDirectory, 'media');
let adminPasswordHash = '';
let ownerCredentialsLoaded = false;
const databaseSettings = {
  host: process.env.DB_HOST || '',
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME || '',
  user: process.env.DB_USER || '',
  password: process.env.DB_PASSWORD || ''
};
const usingMySqlState = Boolean(databaseSettings.host || databaseSettings.database || databaseSettings.user || databaseSettings.password);
if (usingMySqlState && (!databaseSettings.host || !databaseSettings.database || !databaseSettings.user || !databaseSettings.password)) {
  throw new Error('DB_HOST, DB_NAME, DB_USER, and DB_PASSWORD are all required for MySQL state storage');
}
const databasePool = usingMySqlState ? mysql.createPool({ ...databaseSettings, waitForConnections: true, connectionLimit: 5, charset: 'utf8mb4' }) : null;
const tuyaDataCenters = {
  china: { name: 'China', endpoint: 'https://openapi.tuyacn.com' },
  westernAmerica: { name: 'Western America', endpoint: 'https://openapi.tuyaus.com' },
  easternAmerica: { name: 'Eastern America', endpoint: 'https://openapi-ueaz.tuyaus.com' },
  centralEurope: { name: 'Central Europe', endpoint: 'https://openapi.tuyaeu.com' },
  westernEurope: { name: 'Western Europe', endpoint: 'https://openapi-weaz.tuyaeu.com' },
  india: { name: 'India', endpoint: 'https://openapi.tuyain.com' },
  singapore: { name: 'Singapore', endpoint: 'https://openapi-sg.iotbing.com' }
};
const tuyaSingaporeEndpoint = tuyaDataCenters.singapore.endpoint;
const tuyaSingaporeMqEndpoint = 'wss://mqe.tuyaus.com:8285/';
const loginAttempts = new Map();
const administrativeUnitsUrl = 'https://provinces.open-api.vn/api/v2/?depth=2';
const applicationRelease = '2026-09-12.3';
const bankDirectoryUrl = process.env.NVP_BANK_DIRECTORY_URL === undefined ? 'https://api.vietqr.io/v2/banks' : String(process.env.NVP_BANK_DIRECTORY_URL);
const fallbackBanks = [
  ['970405', 'Agribank', 'Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam'],
  ['970416', 'ACB', 'Ngân hàng TMCP Á Châu'],
  ['970418', 'BIDV', 'Ngân hàng TMCP Đầu tư và Phát triển Việt Nam'],
  ['970437', 'HDBank', 'Ngân hàng TMCP Phát triển TP.HCM'],
  ['970422', 'MBBank', 'Ngân hàng TMCP Quân đội'],
  ['970426', 'MSB', 'Ngân hàng TMCP Hàng Hải Việt Nam'],
  ['970448', 'OCB', 'Ngân hàng TMCP Phương Đông'],
  ['970403', 'Sacombank', 'Ngân hàng TMCP Sài Gòn Thương Tín'],
  ['970443', 'SHB', 'Ngân hàng TMCP Sài Gòn - Hà Nội'],
  ['970407', 'Techcombank', 'Ngân hàng TMCP Kỹ thương Việt Nam'],
  ['970423', 'TPBank', 'Ngân hàng TMCP Tiên Phong'],
  ['970441', 'VIB', 'Ngân hàng TMCP Quốc tế Việt Nam'],
  ['970433', 'VietBank', 'Ngân hàng TMCP Việt Nam Thương Tín'],
  ['970436', 'Vietcombank', 'Ngân hàng TMCP Ngoại thương Việt Nam'],
  ['970415', 'VietinBank', 'Ngân hàng TMCP Công thương Việt Nam'],
  ['970432', 'VPBank', 'Ngân hàng TMCP Việt Nam Thịnh Vượng']
].map(([bin, shortName, name]) => ({ bin, shortName, name }));
let bankDirectoryCache = { expiresAt: 0, banks: [] };
const allowedKeys = new Set([
  'nvp-buildings',
  'nvp-leads',
  'nvp-reservations',
  'nvp-tasks',
  'nvp-invoices',
  'nvp-cashflow',
  'nvp-catalogs'
  , 'nvp-customers',
  'nvp-bookings',
  'nvp-locations',
  'nvp-meter-logs',
  'nvp-commissions',
  'nvp-deposit-ledger',
  'nvp-notifications',
  'nvp-users',
  'nvp-feedback',
  'nvp-invoice-settings',
  'nvp-smart-home-config',
  'nvp-push-subscriptions'
]);
const staffRestrictedKeys = new Set([
  'nvp-cashflow',
  'nvp-commissions',
  'nvp-deposit-ledger',
  'nvp-users',
  'nvp-smart-home-config'
]);
const staffRestrictedCatalogs = new Set(['daily', 'profit', 'debts', 'finance-settings', 'accounts', 'debt-accounts', 'einvoice', 'income-types']);
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
const appFiles = new Set(['index.html', 'styles.css', 'modal.css', 'enhancements.css', 'redesign.css', 'crud.css', 'utility-manager.css', 'building-form.css', 'building-manager.css', 'homestay.css', 'customer-manager.css', 'customer-detail.css', 'vp-theme.css', 'vietnamese-typography.css', 'app.js', 'sw.js', 'manifest.webmanifest', 'assets/icon.svg', 'assets/Logo BPG.jpg', 'assets/pwa-icon-192.png', 'assets/pwa-icon-512.png']);
const websiteFiles = new Set(['public.html', 'public.css', 'vp-theme.css', 'vietnamese-typography.css', 'public.js', 'assets/icon.svg', 'assets/Logo BPG.jpg']);
const loginFiles = new Set(['login.html', 'login.css', 'vp-theme.css', 'vietnamese-typography.css', 'login.js', 'manifest.webmanifest', 'sw.js', 'assets/icon.svg', 'assets/Logo BPG.jpg', 'assets/pwa-icon-192.png', 'assets/pwa-icon-512.png']);
const tenantFiles = new Set(['tenant.html', 'tenant.css', 'vietnamese-typography.css', 'tenant.js', 'tenant.webmanifest', 'sw.js', 'assets/icon.svg', 'assets/Logo BPG.jpg', 'assets/pwa-icon-192.png', 'assets/pwa-icon-512.png']);

function getRequestHost(request) {
  return String(request.headers.host || '').split(':')[0].toLowerCase();
}

function configuredHosts(name, defaults) {
  return new Set(String(process.env[name] || defaults).split(',').map((host) => host.trim().toLowerCase()).filter(Boolean));
}

const applicationHosts = configuredHosts('NVP_APP_HOSTS', 'app.phugialand.vn,app.localhost,localhost,127.0.0.1');
const tenantHosts = configuredHosts('NVP_TENANT_HOSTS', 'tenant.phugialand.vn,tenant.localhost');

function isApplicationHost(request) {
  return applicationHosts.has(getRequestHost(request));
}

function isTenantHost(request) {
  return tenantHosts.has(getRequestHost(request));
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').map((item) => item.trim().split('=').map(decodeURIComponent)).filter(([key]) => key));
}

function signSession(email, role) {
  return crypto.createHmac('sha256', sessionSecret).update(`${role}:${email.toLowerCase()}`).digest('base64url');
}

function getApplicationSession(request) {
  if (!adminEmail || !adminPassword || !sessionSecret) return false;
  const cookies = parseCookies(request);
  const session = Buffer.from(cookies.nvp_session || '');
  const email = String(cookies.nvp_user_email || '').toLowerCase();
  const role = cookies.nvp_user_role;
  if (email && ['owner', 'staff'].includes(role)) {
    const expected = Buffer.from(signSession(email, role));
    if (session.length === expected.length && crypto.timingSafeEqual(session, expected)) return { email, role };
  }
  const legacySignature = Buffer.from(signSession(adminEmail, 'manager'));
  if (session.length === legacySignature.length && crypto.timingSafeEqual(session, legacySignature)) return { email: adminEmail.toLowerCase(), role: 'owner' };
  return null;
}

function isAuthenticated(request) {
  return Boolean(getApplicationSession(request));
}

function isOwner(request) {
  return getApplicationSession(request)?.role === 'owner';
}

function applicationSessionCookies(email, role, secure) {
  const options = `Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure}`;
  return [
    `nvp_user_email=${encodeURIComponent(email)}; ${options}`,
    `nvp_user_role=${encodeURIComponent(role)}; ${options}`,
    `nvp_session=${encodeURIComponent(signSession(email, role))}; ${options}`
  ];
}

function filterStateForRole(state, role) {
  if (role !== 'staff') return state;
  const filtered = Object.fromEntries(Object.entries(state.state || {}).filter(([key]) => !staffRestrictedKeys.has(key)));
  const catalogs = parseStateValue(state, 'nvp-catalogs', {});
  Object.keys(catalogs).forEach((key) => { if (staffRestrictedCatalogs.has(key)) delete catalogs[key]; });
  if (Object.prototype.hasOwnProperty.call(filtered, 'nvp-catalogs')) filtered['nvp-catalogs'] = JSON.stringify(catalogs);
  return { ...state, state: filtered };
}

function filterIncomingStateForRole(incoming, role, currentState) {
  if (role !== 'staff') return Object.fromEntries(Object.entries(incoming).filter(([key]) => allowedKeys.has(key)));
  const filtered = Object.fromEntries(Object.entries(incoming).filter(([key]) => allowedKeys.has(key) && !staffRestrictedKeys.has(key)));
  if (Object.prototype.hasOwnProperty.call(filtered, 'nvp-catalogs')) {
    const currentCatalogs = parseStateValue(currentState, 'nvp-catalogs', {});
    let incomingCatalogs = {};
    try { incomingCatalogs = JSON.parse(filtered['nvp-catalogs'] || '{}'); } catch {}
    staffRestrictedCatalogs.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(currentCatalogs, key)) incomingCatalogs[key] = currentCatalogs[key];
      else delete incomingCatalogs[key];
    });
    filtered['nvp-catalogs'] = JSON.stringify(incomingCatalogs);
  }
  return filtered;
}

function validateIncomingFinancialState(incoming) {
  const collectionRules = {
    'nvp-invoices': (item) => Number.isFinite(Number(item.amount)) && Number(item.amount) >= 0 && ['pending', 'approved'].includes(item.approvalStatus || 'approved') && ['unpaid', 'paid'].includes(item.status || 'unpaid'),
    'nvp-cashflow': (item) => Number.isFinite(Number(item.amount)) && Number(item.amount) >= 0 && ['income', 'expense'].includes(item.type),
    'nvp-commissions': (item) => Number.isFinite(Number(item.amount)) && Number(item.amount) >= 0,
    'nvp-reservations': (item) => Number.isFinite(Number(item.amount)) && Number(item.amount) >= 0
  };
  for (const [key, isValid] of Object.entries(collectionRules)) {
    if (!Object.prototype.hasOwnProperty.call(incoming, key)) continue;
    let records;
    try { records = JSON.parse(incoming[key] || '[]'); } catch { return `${key} must contain valid JSON`; }
    if (!Array.isArray(records) || records.some((item) => !item || typeof item !== 'object' || !isValid(item))) return `${key} contains invalid financial data`;
  }
  if (Object.prototype.hasOwnProperty.call(incoming, 'nvp-catalogs')) {
    let catalogs;
    try { catalogs = JSON.parse(incoming['nvp-catalogs'] || '{}'); } catch { return 'nvp-catalogs must contain valid JSON'; }
    const amounts = [...(catalogs.assets || []).map((item) => item.purchaseAmount || 0), ...(catalogs['asset-fix'] || []).map((item) => item.cost || 0)];
    if (amounts.some((amount) => !Number.isFinite(Number(amount)) || Number(amount) < 0)) return 'nvp-catalogs contains invalid financial data';
  }
  return '';
}

function isAdministratorPasswordChangeRequired() {
  return adminPasswordChangeRequired;
}

async function loadOwnerCredentials() {
  if (ownerCredentialsLoaded) return;
  try {
    const stored = JSON.parse(await fs.readFile(ownerCredentialsFile, 'utf8'));
    if (!stored.passwordHash || typeof stored.passwordChangeRequired !== 'boolean') throw new Error('Invalid owner credentials file');
    adminPasswordHash = stored.passwordHash;
    adminPasswordChangeRequired = stored.passwordChangeRequired;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  ownerCredentialsLoaded = true;
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
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https://img.vietqr.io; connect-src 'self'"
  };
}

function isTrustedOrigin(request) {
  const origin = String(request.headers.origin || '');
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const expectedHost = String(request.headers['x-forwarded-host'] || request.headers.host || '').toLowerCase();
    return originUrl.host.toLowerCase() === expectedHost;
  } catch {
    return false;
  }
}

function loginAttemptKey(request, email, portal) {
  const address = String(request.headers['x-forwarded-for'] || request.socket.remoteAddress || '').split(',')[0].trim();
  return `${portal}:${address}:${email}`;
}

function loginRateLimit(request, email, portal) {
  const key = loginAttemptKey(request, email, portal);
  const now = Date.now();
  const record = loginAttempts.get(key);
  if (!record || record.resetAt <= now) return { key, blocked: false };
  return { key, blocked: record.count >= 5, retryAfter: Math.ceil((record.resetAt - now) / 1000) };
}

function recordLoginFailure(key) {
  const now = Date.now();
  const current = loginAttempts.get(key);
  loginAttempts.set(key, !current || current.resetAt <= now ? { count: 1, resetAt: now + 5 * 60_000 } : { ...current, count: current.count + 1 });
}

function repairMojibakeText(value) {
  if (typeof value !== 'string') return value;
  const mojibakePattern = /Ã|Â|Ä|Æ|áº|á»|\uFFFD/gu;
  const score = (text) => (text.match(mojibakePattern) || []).length;
  const windows1252Bytes = new Map([
    [0x20AC, 0x80], [0x201A, 0x82], [0x0192, 0x83], [0x201E, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87],
    [0x02C6, 0x88], [0x2030, 0x89], [0x0160, 0x8A], [0x2039, 0x8B], [0x0152, 0x8C], [0x017D, 0x8E], [0x2018, 0x91],
    [0x2019, 0x92], [0x201C, 0x93], [0x201D, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97], [0x02DC, 0x98],
    [0x2122, 0x99], [0x0161, 0x9A], [0x203A, 0x9B], [0x0153, 0x9C], [0x017E, 0x9E], [0x0178, 0x9F]
  ]);
  const decodeWindows1252AsUtf8 = (text) => {
    const bytes = [];
    for (const character of text) {
      const codePoint = character.codePointAt(0);
      const byte = codePoint <= 0xFF ? codePoint : windows1252Bytes.get(codePoint);
      if (byte === undefined) return text;
      bytes.push(byte);
    }
    return Buffer.from(bytes).toString('utf8');
  };
  let repaired = value;
  for (let pass = 0; pass < 3 && score(repaired); pass += 1) {
    const candidate = decodeWindows1252AsUtf8(repaired);
    if (candidate.includes('\uFFFD') || score(candidate) >= score(repaired)) break;
    repaired = candidate;
  }
  return repaired;
}

function repairMojibake(value) {
  if (typeof value === 'string') return repairMojibakeText(value);
  if (Array.isArray(value)) return value.map(repairMojibake);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, repairMojibake(item)]));
  return value;
}

function normalizePropertyTypes(state) {
  const normalizedState = { ...state, state: { ...(state?.state || {}) } };
  for (const [key, value] of Object.entries(normalizedState.state)) {
    if (typeof value !== 'string') continue;
    try {
      normalizedState.state[key] = JSON.stringify(repairMojibake(JSON.parse(value)));
    } catch {
      normalizedState.state[key] = repairMojibakeText(value);
    }
  }
  delete normalizedState.state['nvp-contracts'];
  try {
    const buildings = JSON.parse(normalizedState.state['nvp-buildings'] || '[]');
    if (Array.isArray(buildings)) {
      normalizedState.state['nvp-buildings'] = JSON.stringify(buildings.map((building) => {
        const settings = { ...(building.settings || {}) };
        delete settings.contractTemplate;
        return {
          ...building,
          settings,
          apartments: Array.isArray(building.apartments)
            ? building.apartments.map((apartment) => apartment.propertyType === 'sleepbox' ? { ...apartment, propertyType: 'shared-room' } : apartment)
            : building.apartments
        };
      }));
    }
  } catch {}
  try {
    const catalogs = JSON.parse(normalizedState.state['nvp-catalogs'] || '{}');
    delete catalogs['rental-contract'];
    if (Object.prototype.hasOwnProperty.call(normalizedState.state, 'nvp-catalogs')) normalizedState.state['nvp-catalogs'] = JSON.stringify(catalogs);
  } catch {}
  try {
    const invoices = JSON.parse(normalizedState.state['nvp-invoices'] || '[]');
    if (Array.isArray(invoices)) normalizedState.state['nvp-invoices'] = JSON.stringify(invoices.map((invoice) => ({ approvalStatus: 'approved', ...invoice })));
  } catch {}
  return normalizedState;
}

async function readState() {
  if (databasePool) {
    const [rows] = await databasePool.query('SELECT state_key, state_value, updated_at FROM app_state');
    const state = Object.fromEntries(rows.map((row) => [row.state_key, row.state_value]));
    const updatedAt = rows.reduce((latest, row) => !latest || new Date(row.updated_at) > new Date(latest) ? row.updated_at : latest, null);
    return normalizePropertyTypes({ version: 1, updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null, state });
  }
  try {
    return normalizePropertyTypes(JSON.parse((await fs.readFile(dataFile, 'utf8')).replace(/^\uFEFF/, '')));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { version: 1, updatedAt: null, state: {} };
  }
}

async function writeState(state) {
  state = normalizePropertyTypes(state);
  if (databasePool) {
    const connection = await databasePool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('DELETE FROM app_state');
      for (const [key, value] of Object.entries(state.state || {})) {
        await connection.execute('INSERT INTO app_state (state_key, state_value) VALUES (?, ?)', [key, value ?? null]);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return;
  }
  await fs.mkdir(dataDirectory, { recursive: true });
  const temporaryFile = `${dataFile}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryFile, JSON.stringify(state, null, 2), 'utf8');
  await fs.rename(temporaryFile, dataFile);
}

let stateMutationQueue = Promise.resolve();

function withStateMutation(operation) {
  const result = stateMutationQueue.then(operation);
  stateMutationQueue = result.catch(() => {});
  return result;
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...securityHeaders()
  });
  response.end(JSON.stringify(payload));
}

function getAvailableApartments(state, requestedFrom = '', requestedTo = '') {
  const today = new Date().toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(requestedFrom) ? requestedFrom : today;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(requestedTo) && requestedTo >= from ? requestedTo : from;
  const requestedDates = [];
  for (const cursor = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) requestedDates.push(cursor.toISOString().slice(0, 10));
  let buildings = state.state?.['nvp-buildings'];
  let customers = state.state?.['nvp-customers'];
  try {
    buildings = typeof buildings === 'string' ? JSON.parse(buildings) : buildings;
    customers = typeof customers === 'string' ? JSON.parse(customers) : customers;
  } catch {
    buildings = [];
    customers = [];
  }
  if (!Array.isArray(buildings)) return [];
  const rentedSpaces = new Set((Array.isArray(customers) ? customers : []).filter((customer) => customer.status === 'renting' && customer.apartment).map((customer) => `${String(customer.building || '').trim()} | ${String(customer.apartment).trim()}`));
  return buildings.flatMap((building) => {
    const apartments = Array.isArray(building.apartments) ? building.apartments : [];
    const spaces = apartments.length ? apartments : building.listingType === 'whole-building' && building.active !== false ? [{ name: building.name, title: building.name, propertyType: 'whole-building', status: 'empty', media: building.media, image: building.image }] : [];
    return spaces
    .filter((apartment) => apartment.status === 'empty' && !rentedSpaces.has(`${String(building.name || '').trim()} | ${String(apartment.name || '').trim()}`) && !rentedSpaces.has(` | ${String(apartment.name || '').trim()}`) && !(apartment.propertyType === 'homestay' && Array.isArray(apartment.bookedDates) && requestedDates.some((date) => apartment.bookedDates.includes(date))))
    .map((apartment) => ({
      building: String(building.name || 'Phú Gia Land'),
      address: String(building.address || ''),
      name: String(apartment.name || 'Căn hộ trống'),
      propertyType: String(apartment.propertyType || (building.listingType === 'whole-building' ? 'whole-building' : 'apartment')),
      title: String(apartment.title || apartment.name || 'Căn hộ trống'),
      description: String(apartment.description || ''),
      image: typeof apartment.image === 'string' && (apartment.image.startsWith('data:image/') || apartment.image.startsWith('/api/media/')) ? apartment.image : String(apartment.media?.find((item) => item.kind === 'image')?.url || ''),
      media: Array.isArray(apartment.media) ? apartment.media.filter((item) => item?.url && (item.kind === 'image' || item.kind === 'video')).map((item) => ({ kind: item.kind, url: item.url, mimeType: item.mimeType })) : [],
      beds: Number(apartment.beds || 0),
      bookedDates: Array.isArray(apartment.bookedDates) ? apartment.bookedDates.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)).sort() : []
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

function verifyAdministratorPassword(password) {
  return adminPasswordHash ? verifyPassword(password, adminPasswordHash) : hasMatchingSecret(password, adminPassword);
}

async function writeOwnerCredentials(password, passwordChangeRequired) {
  await fs.mkdir(dataDirectory, { recursive: true });
  const temporaryFile = `${ownerCredentialsFile}.${crypto.randomUUID()}.tmp`;
  const credentials = { passwordHash: hashPassword(password), passwordChangeRequired };
  await fs.writeFile(temporaryFile, JSON.stringify(credentials, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporaryFile, ownerCredentialsFile);
  adminPasswordHash = credentials.passwordHash;
  adminPasswordChangeRequired = passwordChangeRequired;
}

function getTuyaDataCenter(config = {}) {
  if (tuyaDataCenters[config.tuyaDataCenter]) return config.tuyaDataCenter;
  const endpoint = String(config.tuyaEndpoint || '');
  return Object.entries(tuyaDataCenters).find(([, item]) => item.endpoint === endpoint)?.[0] || 'singapore';
}

function getTuyaEndpoint(config = {}) {
  return tuyaDataCenters[getTuyaDataCenter(config)].endpoint;
}

async function restoreBackupArchive(dataUrl) {
  const matched = /^data:(?:application\/zip|application\/x-zip-compressed|application\/octet-stream);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!matched) throw new Error('Backup must be a ZIP file');
  const archive = Buffer.from(matched[1], 'base64');
  if (!archive.length || archive.length > 75_000_000) throw new Error('Backup archive is empty or too large');
  const entries = await unzipper.Open.buffer(archive);
  const backupEntry = entries.files.find((entry) => entry.path === 'backup.json');
  if (!backupEntry) throw new Error('Backup file does not contain backup.json');
  let backup;
  try {
    backup = JSON.parse((await backupEntry.buffer()).toString('utf8'));
  } catch {
    throw new Error('Backup state is invalid');
  }
  if (!backup?.state || typeof backup.state !== 'object') throw new Error('Backup state is invalid');
  const state = Object.fromEntries(Object.entries(backup.state).filter(([key, value]) => allowedKeys.has(key) && (typeof value === 'string' || value === null)));
  const restoreDirectory = path.join(dataDirectory, `.restore-${crypto.randomUUID()}`);
  const restoreMediaDirectory = path.join(restoreDirectory, 'media');
  const restoreDocumentDirectory = path.join(restoreDirectory, 'documents');
  await fs.mkdir(restoreDirectory, { recursive: true });
  try {
    for (const entry of entries.files) {
      const entryPath = entry.path.replaceAll('\\', '/');
      if (entry.type === 'Directory' || entryPath === 'backup.json') continue;
      if (!/^(media|documents)\/[a-zA-Z0-9._-]+$/.test(entryPath)) throw new Error('Backup contains an invalid file path');
      const destination = path.resolve(restoreDirectory, entryPath);
      if (!destination.startsWith(`${restoreDirectory}${path.sep}`)) throw new Error('Backup contains an invalid file path');
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, await entry.buffer());
    }
    const oldMediaDirectory = path.join(dataDirectory, `.previous-media-${crypto.randomUUID()}`);
    const oldDocumentDirectory = path.join(dataDirectory, `.previous-documents-${crypto.randomUUID()}`);
    await fs.rename(mediaDirectory, oldMediaDirectory).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    await fs.rename(documentDirectory, oldDocumentDirectory).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    await fs.rename(restoreMediaDirectory, mediaDirectory).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    await fs.rename(restoreDocumentDirectory, documentDirectory).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    await writeState({ version: 1, updatedAt: new Date().toISOString(), state });
    await Promise.all([fs.rm(oldMediaDirectory, { recursive: true, force: true }), fs.rm(oldDocumentDirectory, { recursive: true, force: true })]);
  } finally {
    await fs.rm(restoreDirectory, { recursive: true, force: true });
  }
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
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function paymentDueDate(month, paymentDay = 5) {
  const [year, monthNumber] = String(month).split('-').map(Number);
  const targetMonth = new Date(Date.UTC(year, monthNumber, 1));
  const lastDay = new Date(Date.UTC(year, monthNumber + 1, 0)).getUTCDate();
  targetMonth.setUTCDate(Math.min(Math.max(Number(paymentDay) || 5, 1), lastDay));
  return targetMonth.toISOString().slice(0, 10);
}

function configuredAmount(...values) {
  const configured = values.find((value) => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value)));
  return Number(configured ?? 0);
}

function financialActor(request) {
  const session = getApplicationSession(request);
  return session ? { email: session.email, role: session.role } : { email: 'bank-webhook', role: 'system' };
}

function createCashflowEntry({ title, type, amount, category, method, building, apartment, sourceType, sourceId, invoiceCode, actor, createdAt = new Date().toISOString(), reversalOf = '' }) {
  return {
    id: crypto.randomUUID(),
    title,
    type,
    amount: Number(amount),
    category,
    method,
    building: building || '',
    apartment: apartment || '',
    sourceType,
    sourceId,
    invoiceCode: invoiceCode || '',
    recordedBy: actor?.email || 'system',
    recordedRole: actor?.role || 'system',
    createdAt,
    reversalOf
  };
}

function collectInvoice(invoices, cashflow, invoice, { amount, method, actor, transactionId = '', content = '' }) {
  const existingEntry = cashflow.find((entry) => entry.sourceType === 'invoice-payment' && entry.sourceId === invoice.id && !entry.reversalOf && !cashflow.some((candidate) => candidate.reversalOf === entry.id));
  if (invoice.status === 'paid' || existingEntry) return { duplicate: true, invoice, cashflowEntry: existingEntry };
  if (invoice.approvalStatus !== 'approved') return { error: 'Invoice is not approved', status: 409 };
  const paidAmount = Number(amount);
  if (!Number.isFinite(paidAmount) || paidAmount < Number(invoice.amount || 0)) return { error: 'Payment amount is insufficient', status: 400 };
  const paidAt = new Date().toISOString();
  Object.assign(invoice, { status: 'paid', paidAt, paidAmount, paymentMethod: method, paidBy: actor?.email || 'system', overpayment: Math.max(paidAmount - Number(invoice.amount || 0), 0) });
  if (transactionId) invoice.bankTransactionId = transactionId;
  if (content) invoice.bankContent = content;
  const cashflowEntry = createCashflowEntry({ title: `Thu hóa đơn ${invoice.paymentCode || invoice.title}`, type: 'income', amount: paidAmount, category: 'invoice-payment', method, building: invoice.building, apartment: invoice.apartment, sourceType: 'invoice-payment', sourceId: invoice.id, invoiceCode: invoice.paymentCode, actor, createdAt: paidAt });
  if (transactionId) cashflowEntry.bankTransactionId = transactionId;
  cashflow.push(cashflowEntry);
  return { duplicate: false, invoice, cashflowEntry };
}

async function getBankDirectory() {
  if (bankDirectoryCache.expiresAt > Date.now() && bankDirectoryCache.banks.length) return bankDirectoryCache.banks;
  let banks = fallbackBanks;
  if (bankDirectoryUrl) {
    try {
      const response = await fetch(bankDirectoryUrl, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`Bank directory returned ${response.status}`);
      const payload = await response.json();
      const remoteBanks = (Array.isArray(payload.data) ? payload.data : [])
        .filter((bank) => bank.transferSupported === 1 && /^\d{6}$/.test(String(bank.bin || '')) && bank.shortName && bank.name)
        .map((bank) => ({ bin: String(bank.bin), shortName: String(bank.shortName), name: String(bank.name) }));
      if (remoteBanks.length) banks = remoteBanks;
    } catch (error) {
      console.warn('Unable to refresh bank directory, using fallback:', error.message);
    }
  }
  banks = [...banks].sort((left, right) => left.shortName.localeCompare(right.shortName, 'vi'));
  bankDirectoryCache = { expiresAt: Date.now() + 24 * 60 * 60_000, banks };
  return banks;
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
    if (!customer || invoices.some((invoice) => invoice.month === month && invoice.building === building.name && invoice.apartment === apartment.name && invoice.source === 'monthly-closing')) return;
    const records = meterLogs.filter((log) => log.month === month && log.apartment === `${building.name} | ${apartment.name}`);
    const electricity = records.filter((log) => log.service === 'electricity').reduce((total, log) => total + Number(log.amount || 0), 0);
    const configuredWaterMode = apartment.waterBillingMode || building.settings?.waterBillingMode || 'metered';
    const meteredWater = records.filter((log) => log.service === 'water').reduce((total, log) => total + Number(log.amount || 0), 0);
    const water = configuredWaterMode === 'fixed' ? configuredAmount(apartment.waterFixedAmount, (building.settings?.waterFloorRates || {})[apartment.floor], building.settings?.waterFixedAmount) : meteredWater;
    const rent = Number(apartment.rentAmount || 0);
    const service = configuredAmount(apartment.serviceFee, building.settings?.managementFee);
    const amount = rent + electricity + water + service;
    if (amount <= 0) return;
    const invoice = { id: crypto.randomUUID(), paymentCode: `NVP-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`, building: building.name, apartment: apartment.name, tenantEmail: customer.email || '', tenantName: customer.name || '', title: `Hóa đơn tháng ${month} - ${apartment.name}`, type: 'monthly', source: 'monthly-closing', month, amount, billingLines: { rent, electricity, water, service, serviceLabel: apartment.serviceFeeLabel || 'Phí dịch vụ' }, utilityLines: { electricity, water }, dueDate: paymentDueDate(month, building.settings?.paymentDay), approvalStatus: 'pending', status: 'unpaid', createdAt: new Date().toISOString() };
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

async function sendPushToEmail(state, email, title, body) {
  if (!email || !vapidPublicKey || !vapidPrivateKey) return 0;
  const subscriptions = parseStateValue(state, 'nvp-push-subscriptions', []).filter((item) => String(item.email || '').toLowerCase() === String(email).toLowerCase());
  const message = JSON.stringify({ title, body, url: '/tenant.html' });
  const results = await Promise.allSettled(subscriptions.map((item) => webpush.sendNotification(item.subscription, message)));
  return results.filter((result) => result.status === 'fulfilled').length;
}

async function sendOverdueInvoiceReminders(today = new Date()) {
  const state = await readState();
  const invoices = parseStateValue(state, 'nvp-invoices', []);
  const notifications = parseStateValue(state, 'nvp-notifications', []);
  const reminderDate = today.toISOString().slice(0, 10);
  const overdue = invoices.filter((invoice) => invoice.approvalStatus === 'approved' && invoice.status !== 'paid' && invoice.dueDate && invoice.dueDate < reminderDate && invoice.lastReminderDate !== reminderDate);
  for (const invoice of overdue) {
    const message = `${invoice.title}: ${Number(invoice.amount || 0).toLocaleString('vi-VN')} đ đã quá hạn thanh toán.`;
    notifications.unshift({ id: crypto.randomUUID(), title: 'Nhắc thanh toán hóa đơn', message, recipientEmail: invoice.tenantEmail || '', audience: invoice.tenantEmail ? undefined : 'admins', invoiceId: invoice.id, createdAt: new Date().toISOString(), read: false });
    invoice.lastReminderDate = reminderDate;
    await sendPushToEmail(state, invoice.tenantEmail, 'Nhắc thanh toán hóa đơn', message);
  }
  if (overdue.length) {
    notifications.unshift({ id: crypto.randomUUID(), title: 'Hóa đơn quá hạn', message: `${overdue.length} hóa đơn đã duyệt vẫn chưa thanh toán.`, audience: 'admins', createdAt: new Date().toISOString(), read: false });
    state.updatedAt = new Date().toISOString();
    state.state['nvp-invoices'] = JSON.stringify(invoices);
    state.state['nvp-notifications'] = JSON.stringify(notifications);
    await writeState(state);
  }
  return overdue;
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
  const tuya = new TuyaContext({
    baseUrl: getTuyaEndpoint(config),
    accessKey: config.tuyaAccessId,
    secretKey: config.tuyaAccessSecret
  });
  const paths = deviceIds.length
    ? [`/v1.0/iot-03/devices?device_ids=${encodeURIComponent(deviceIds.join(','))}`, `/v1.0/devices?device_ids=${encodeURIComponent(deviceIds.join(','))}`]
    : ['/v1.0/iot-01/associated-users/devices?size=100', '/v1.0/devices?page_no=1&page_size=100'];
  let response;
  const errors = [];
  for (const path of paths) {
    response = await tuya.request({ method: 'GET', path, body: {} });
    if (response?.success) break;
    if (response?.msg) errors.push(response.msg);
  }
  if (!response?.success) throw new Error(errors.at(-1) || 'Tuya device discovery failed. Link the Tuya Smart/Smart Life account to this Cloud Project, then try again.');
  const devices = response.result?.devices || response.result?.list || response.result?.data || (Array.isArray(response.result) ? response.result : []);
  return devices.map((device) => ({
    meterId: String(device.id || device.device_id || device.dev_id || '').trim(),
    name: String(device.name || device.product_name || device.productName || '').trim()
  })).filter((device) => device.meterId);
}

async function fetchTuyaEnergyReadings(config) {
  if (!config?.tuyaAccessId || !config?.tuyaAccessSecret) throw new Error('Tuya Cloud is not configured');
  const configuredDeviceIds = String(config.tuyaDeviceIds || '').split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
  const deviceIds = configuredDeviceIds.length ? configuredDeviceIds : (await fetchTuyaMeters(config)).map((device) => device.meterId);
  if (!deviceIds.length) throw new Error('No Tuya devices were found. Link the Tuya Smart/Smart Life account to this Cloud Project.');
  const tuya = new TuyaContext({
    baseUrl: getTuyaEndpoint(config),
    accessKey: config.tuyaAccessId,
    secretKey: config.tuyaAccessSecret
  });
  const readings = await Promise.all(deviceIds.map(async (meterId) => {
    const response = await tuya.request({ method: 'GET', path: `/v1.0/iot-03/devices/${encodeURIComponent(meterId)}/status`, body: {} });
    if (!response?.success) throw new Error(response?.msg || `Tuya status query failed for ${meterId}`);
    const energy = (response.result || []).find((item) => item.code === 'total_forward_energy' || item.code === 'add_ele');
    if (!energy || !Number.isFinite(Number(energy.value))) return null;
    const scale = Number.isInteger(Number(energy.scale)) ? Number(energy.scale) : 2;
    return { meterId, current: Number(energy.value) / (10 ** scale), timestamp: new Date().toISOString() };
  }));
  return readings.filter(Boolean);
}

async function syncTuyaEnergyReadings(month = new Date().toISOString().slice(0, 7)) {
  const state = await readState();
  const config = parseStateValue(state, 'nvp-smart-home-config', {});
  const readings = await fetchTuyaEnergyReadings(config);
  const buildings = parseStateValue(state, 'nvp-buildings', []);
  const customers = parseStateValue(state, 'nvp-customers', []);
  const meterLogs = parseStateValue(state, 'nvp-meter-logs', []);
  const synced = [];
  const skipped = [];
  readings.forEach((reading) => {
    const building = buildings.find((item) => (item.apartments || []).some((apartment) => String(apartment.meterId || '').trim() === reading.meterId));
    const apartment = building?.apartments?.find((item) => String(item.meterId || '').trim() === reading.meterId);
    if (!building || !apartment) { skipped.push({ meterId: reading.meterId, reason: 'Meter is not mapped to an apartment' }); return; }
    const apartmentKey = `${building.name} | ${apartment.name}`;
    apartment.latestElectricityReading = reading.current;
    apartment.latestElectricityReadingAt = reading.timestamp;
    const activeTenant = customers.some((customer) => customer.status === 'renting' && String(customer.apartment || '').trim() === String(apartment.name || '').trim() && (!customer.building || String(customer.building).trim() === String(building.name).trim()));
    if (!activeTenant) { skipped.push({ meterId: reading.meterId, reason: 'Apartment has no active tenant', current: reading.current }); return; }
    const existing = meterLogs.find((log) => log.service === 'electricity' && log.meterId === reading.meterId && log.month === month);
    const previousLog = meterLogs.filter((log) => log.service === 'electricity' && log.meterId === reading.meterId && log !== existing).at(-1);
    const hasBaseline = apartment.electricityBaseline !== '' && apartment.electricityBaseline !== null && apartment.electricityBaseline !== undefined && Number.isFinite(Number(apartment.electricityBaseline));
    const baselineIsNewer = hasBaseline && (!previousLog || new Date(apartment.electricityBaselineAt || 0) > new Date(previousLog.updatedAt || previousLog.createdAt || 0));
    if (!existing && !previousLog && !hasBaseline) {
      apartment.electricityBaseline = reading.current;
      apartment.electricityBaselineAt = reading.timestamp;
      skipped.push({ meterId: reading.meterId, reason: 'Initial tenant meter baseline captured', current: reading.current });
      return;
    }
    const previous = Number(existing?.previous ?? (baselineIsNewer ? apartment.electricityBaseline : previousLog?.current) ?? apartment.electricityBaseline);
    if (reading.current < previous) { skipped.push({ meterId: reading.meterId, reason: 'Current reading is lower than previous reading' }); return; }
    const rate = configuredAmount(apartment.electricityRate, (building.settings?.electricityFloorRates || {})[apartment.floor], building.settings?.electricityRate);
    if (reading.current === previous) { skipped.push({ meterId: reading.meterId, reason: 'Reading has not changed' }); return; }
    if (!Number.isFinite(rate) || rate <= 0) { skipped.push({ meterId: reading.meterId, reason: 'Electricity rate is not configured' }); return; }
    const log = { id: existing?.id || crypto.randomUUID(), apartment: apartmentKey, meterId: reading.meterId, service: 'electricity', previous, current: reading.current, usage: reading.current - previous, rate, amount: (reading.current - previous) * rate, month, source: 'tuya-cloud', createdAt: existing?.createdAt || reading.timestamp, updatedAt: reading.timestamp };
    if (existing) Object.assign(existing, log);
    else meterLogs.push(log);
    synced.push({ meterId: reading.meterId, apartment: apartment.name, current: reading.current, usage: log.usage });
  });
  state.updatedAt = new Date().toISOString();
  state.state['nvp-buildings'] = JSON.stringify(buildings);
  state.state['nvp-meter-logs'] = JSON.stringify(meterLogs);
  await writeState(state);
  return { month, synced, skipped };
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
    await loadOwnerCredentials();
    if (request.method === 'GET' && request.url === '/api/health') {
      sendJson(response, 200, { ok: true, service: 'phu-gia-land-api', release: applicationRelease, capabilities: { bankDirectory: true }, host: getRequestHost(request), forwardedHost: String(request.headers['x-forwarded-host'] || '') });
      return;
    }
    if (['POST', 'PUT', 'DELETE'].includes(request.method) && !isTrustedOrigin(request)) {
      sendJson(response, 403, { error: 'Untrusted request origin' });
      return;
    }
    if (request.method === 'GET' && request.url === '/api/session') {
      const session = getApplicationSession(request);
      if (!session) { sendJson(response, 401, { error: 'Unauthorized' }); return; }
      let name = 'Chủ nhà';
      if (session.role === 'staff') {
        const users = parseStateValue(await readState(), 'nvp-users', []);
        const user = users.find((item) => String(item.email || '').toLowerCase() === session.email && item.role === 'staff' && item.active !== false);
        if (!user) { sendJson(response, 401, { error: 'Unauthorized' }); return; }
        name = user.name;
      }
      sendJson(response, 200, { authenticated: true, ...session, name, passwordChangeRequired: session.role === 'owner' && isAdministratorPasswordChangeRequired() });
      return;
    }
    if (isOwner(request) && isAdministratorPasswordChangeRequired() && !['/api/admin-password', '/api/logout'].includes(request.url)) {
      sendJson(response, 403, { error: 'Password change is required before using the application' });
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
    if (request.method === 'GET' && request.url.startsWith('/api/availability')) {
      const state = await readState();
      const availabilityUrl = new URL(request.url, 'http://localhost');
      const from = availabilityUrl.searchParams.get('from') || availabilityUrl.searchParams.get('date') || '';
      const to = availabilityUrl.searchParams.get('to') || from;
      sendJson(response, 200, { updatedAt: state.updatedAt, from, to, apartments: getAvailableApartments(state, from, to) });
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
    const invoiceApprovalMatch = request.method === 'POST' && request.url.match(/^\/api\/invoices\/([^/]+)\/approve$/);
    if (invoiceApprovalMatch) {
      if (!isOwner(request)) { sendJson(response, 403, { error: 'Owner access required' }); return; }
      const state = await readState();
      const invoices = parseStateValue(state, 'nvp-invoices', []);
      const notifications = parseStateValue(state, 'nvp-notifications', []);
      const invoice = invoices.find((item) => item.id === decodeURIComponent(invoiceApprovalMatch[1]));
      if (!invoice) { sendJson(response, 404, { error: 'Invoice not found' }); return; }
      if (invoice.approvalStatus !== 'approved') {
        invoice.approvalStatus = 'approved';
        invoice.approvedAt = new Date().toISOString();
        const message = `${invoice.title}: ${Number(invoice.amount || 0).toLocaleString('vi-VN')} đ. Hạn thanh toán ${invoice.dueDate || 'chưa xác định'}.`;
        if (invoice.tenantEmail) notifications.unshift({ id: crypto.randomUUID(), title: 'Hóa đơn mới', message, recipientEmail: invoice.tenantEmail, invoiceId: invoice.id, createdAt: invoice.approvedAt, read: false });
        state.updatedAt = invoice.approvedAt;
        state.state['nvp-invoices'] = JSON.stringify(invoices);
        state.state['nvp-notifications'] = JSON.stringify(notifications);
        await writeState(state);
        await sendPushToEmail(state, invoice.tenantEmail, 'Hóa đơn mới', message);
      }
      sendJson(response, 200, { ok: true, invoice });
      return;
    }
    const invoiceCollectionMatch = request.method === 'POST' && request.url.match(/^\/api\/invoices\/([^/]+)\/collect$/);
    if (invoiceCollectionMatch) {
      if (!isAuthenticated(request)) { sendJson(response, 401, { error: 'Unauthorized' }); return; }
      const payload = await readBody(request);
      const result = await withStateMutation(async () => {
        const state = await readState();
        const invoices = parseStateValue(state, 'nvp-invoices', []);
        const cashflow = parseStateValue(state, 'nvp-cashflow', []);
        const invoice = invoices.find((item) => item.id === decodeURIComponent(invoiceCollectionMatch[1]));
        if (!invoice) return { status: 404, payload: { error: 'Invoice not found' } };
        const collected = collectInvoice(invoices, cashflow, invoice, { amount: payload.amount ?? invoice.amount, method: ['cash', 'bank-transfer', 'other'].includes(payload.method) ? payload.method : 'cash', actor: financialActor(request) });
        if (collected.error) return { status: collected.status, payload: { error: collected.error } };
        if (!collected.duplicate) {
          state.updatedAt = collected.invoice.paidAt;
          state.state['nvp-invoices'] = JSON.stringify(invoices);
          state.state['nvp-cashflow'] = JSON.stringify(cashflow);
          await writeState(state);
        }
        return { status: 200, payload: { ok: true, duplicate: collected.duplicate, invoice: collected.invoice, cashflowEntry: collected.cashflowEntry } };
      });
      sendJson(response, result.status, result.payload);
      return;
    }
    const invoiceReversalMatch = request.method === 'POST' && request.url.match(/^\/api\/invoices\/([^/]+)\/reverse$/);
    if (invoiceReversalMatch) {
      if (!isOwner(request)) { sendJson(response, 403, { error: 'Owner access required' }); return; }
      const payload = await readBody(request);
      const reason = String(payload.reason || '').trim();
      if (reason.length < 3) { sendJson(response, 400, { error: 'Reversal reason is required' }); return; }
      const result = await withStateMutation(async () => {
        const state = await readState();
        const invoices = parseStateValue(state, 'nvp-invoices', []);
        const cashflow = parseStateValue(state, 'nvp-cashflow', []);
        const invoice = invoices.find((item) => item.id === decodeURIComponent(invoiceReversalMatch[1]));
        if (!invoice) return { status: 404, payload: { error: 'Invoice not found' } };
        if (invoice.status !== 'paid') return { status: 409, payload: { error: 'Invoice is not paid' } };
        const original = [...cashflow].reverse().find((entry) => entry.sourceType === 'invoice-payment' && entry.sourceId === invoice.id && !entry.reversalOf);
        if (!original) return { status: 409, payload: { error: 'Payment transaction not found' } };
        const existingReversal = cashflow.find((entry) => entry.reversalOf === original.id);
        if (existingReversal) return { status: 200, payload: { ok: true, duplicate: true, invoice, cashflowEntry: existingReversal } };
        const reversedAt = new Date().toISOString();
        const actor = financialActor(request);
        const reversal = createCashflowEntry({ title: `Hoàn tác ${original.title}`, type: 'expense', amount: original.amount, category: 'payment-reversal', method: original.method, building: invoice.building, apartment: invoice.apartment, sourceType: 'invoice-payment-reversal', sourceId: invoice.id, invoiceCode: invoice.paymentCode, actor, createdAt: reversedAt, reversalOf: original.id });
        reversal.note = reason;
        cashflow.push(reversal);
        Object.assign(invoice, { status: 'unpaid', paymentReversedAt: reversedAt, paymentReversedBy: actor.email, paymentReversalReason: reason });
        state.updatedAt = reversedAt;
        state.state['nvp-invoices'] = JSON.stringify(invoices);
        state.state['nvp-cashflow'] = JSON.stringify(cashflow);
        await writeState(state);
        return { status: 200, payload: { ok: true, invoice, cashflowEntry: reversal } };
      });
      sendJson(response, result.status, result.payload);
      return;
    }
    if (request.method === 'POST' && request.url === '/api/financial-events') {
      if (!isAuthenticated(request)) { sendJson(response, 401, { error: 'Unauthorized' }); return; }
      const payload = await readBody(request);
      const amount = Number(payload.amount || 0);
      const allowedSourceTypes = new Set(['commission-payment', 'asset-repair', 'asset-purchase', 'deposit-receipt', 'deposit-refund', 'deposit-forfeit', 'deposit-apply']);
      if (!allowedSourceTypes.has(payload.sourceType) || !String(payload.sourceId || '').trim() || !Number.isFinite(amount) || amount <= 0) { sendJson(response, 400, { error: 'Invalid financial event' }); return; }
      const result = await withStateMutation(async () => {
        const state = await readState();
        const cashflow = parseStateValue(state, 'nvp-cashflow', []);
        const existing = cashflow.find((entry) => entry.sourceType === payload.sourceType && entry.sourceId === payload.sourceId && !cashflow.some((candidate) => candidate.reversalOf === entry.id));
        if (existing && Number(existing.amount) !== amount) return { conflict: true, cashflowEntry: existing };
        if (existing) return { duplicate: true, cashflowEntry: existing };
        const cashflowEntry = createCashflowEntry({ title: String(payload.title || 'Giao dịch phát sinh').slice(0, 160), type: payload.type === 'income' ? 'income' : 'expense', amount, category: String(payload.category || payload.sourceType).slice(0, 60), method: ['cash', 'bank-transfer', 'other'].includes(payload.method) ? payload.method : 'cash', building: String(payload.building || '').slice(0, 120), apartment: String(payload.apartment || '').slice(0, 120), sourceType: payload.sourceType, sourceId: String(payload.sourceId), actor: financialActor(request) });
        cashflowEntry.affectsProfit = !['deposit-receipt', 'deposit-refund'].includes(payload.sourceType);
        cashflowEntry.affectsCash = !['deposit-forfeit', 'deposit-apply'].includes(payload.sourceType);
        cashflow.push(cashflowEntry);
        state.updatedAt = cashflowEntry.createdAt;
        state.state['nvp-cashflow'] = JSON.stringify(cashflow);
        await writeState(state);
        return { duplicate: false, cashflowEntry };
      });
      if (result.conflict) { sendJson(response, 409, { error: 'Reverse the existing transaction before changing its amount', cashflowEntry: result.cashflowEntry }); return; }
      sendJson(response, 200, { ok: true, ...result });
      return;
    }
    const depositDispositionMatch = request.method === 'POST' && request.url.match(/^\/api\/deposits\/([^/]+)\/dispose$/);
    if (depositDispositionMatch) {
      if (!isOwner(request)) { sendJson(response, 403, { error: 'Owner access required' }); return; }
      const payload = await readBody(request);
      if (!['refunded', 'forfeited', 'applied'].includes(payload.disposition)) { sendJson(response, 400, { error: 'Invalid deposit disposition' }); return; }
      const result = await withStateMutation(async () => {
        const state = await readState();
        const reservations = parseStateValue(state, 'nvp-reservations', []);
        const invoices = parseStateValue(state, 'nvp-invoices', []);
        const cashflow = parseStateValue(state, 'nvp-cashflow', []);
        const reservation = reservations.find((item) => item.id === decodeURIComponent(depositDispositionMatch[1]));
        if (!reservation) return { status: 404, payload: { error: 'Deposit not found' } };
        if (!['active', 'held'].includes(reservation.status)) return { status: 409, payload: { error: 'Deposit was already settled' } };
        const amount = Number(reservation.amount || 0);
        if (!Number.isFinite(amount) || amount <= 0) return { status: 400, payload: { error: 'Deposit amount is invalid' } };
        let invoice = null;
        let appliedAmount = amount;
        if (payload.disposition === 'applied') {
          invoice = invoices.find((item) => item.id === payload.invoiceId && item.approvalStatus === 'approved' && item.status !== 'paid');
          if (!invoice) return { status: 409, payload: { error: 'Eligible invoice not found' } };
          appliedAmount = Math.min(amount, Number(invoice.amount || 0));
          invoice.originalAmount ||= Number(invoice.amount || 0);
          invoice.depositApplied = Number(invoice.depositApplied || 0) + appliedAmount;
          invoice.amount = Math.max(Number(invoice.amount || 0) - appliedAmount, 0);
          if (invoice.amount === 0) Object.assign(invoice, { status: 'paid', paidAt: new Date().toISOString(), paidAmount: 0, paymentMethod: 'deposit' });
        }
        const sourceType = payload.disposition === 'refunded' ? 'deposit-refund' : payload.disposition === 'forfeited' ? 'deposit-forfeit' : 'deposit-apply';
        const existing = cashflow.find((entry) => entry.sourceType === sourceType && entry.sourceId === reservation.id);
        if (existing) return { status: 200, payload: { ok: true, duplicate: true, reservation, invoice, cashflowEntry: existing } };
        const actor = financialActor(request);
        const entry = createCashflowEntry({ title: payload.disposition === 'refunded' ? `Hoàn cọc - ${reservation.name}` : payload.disposition === 'forfeited' ? `Ghi nhận cọc giữ lại - ${reservation.name}` : `Khấu trừ cọc vào hóa đơn - ${reservation.name}`, type: payload.disposition === 'refunded' ? 'expense' : 'income', amount: appliedAmount, category: sourceType, method: payload.disposition === 'refunded' ? (['cash', 'bank-transfer', 'other'].includes(payload.method) ? payload.method : 'bank-transfer') : 'other', building: reservation.building, apartment: reservation.apartment, sourceType, sourceId: reservation.id, invoiceCode: invoice?.paymentCode, actor });
        entry.affectsCash = payload.disposition === 'refunded';
        entry.affectsProfit = payload.disposition !== 'refunded';
        cashflow.push(entry);
        Object.assign(reservation, { status: payload.disposition, disposedAt: entry.createdAt, disposedBy: actor.email, dispositionNote: String(payload.note || '').slice(0, 300), appliedInvoiceId: invoice?.id || '', appliedAmount });
        state.updatedAt = entry.createdAt;
        state.state['nvp-reservations'] = JSON.stringify(reservations);
        state.state['nvp-invoices'] = JSON.stringify(invoices);
        state.state['nvp-cashflow'] = JSON.stringify(cashflow);
        await writeState(state);
        return { status: 200, payload: { ok: true, reservation, invoice, cashflowEntry: entry } };
      });
      sendJson(response, result.status, result.payload);
      return;
    }
    const cashflowReversalMatch = request.method === 'POST' && request.url.match(/^\/api\/cashflow\/([^/]+)\/reverse$/);
    if (cashflowReversalMatch) {
      if (!isOwner(request)) { sendJson(response, 403, { error: 'Owner access required' }); return; }
      const payload = await readBody(request);
      const reason = String(payload.reason || '').trim();
      if (reason.length < 3) { sendJson(response, 400, { error: 'Reversal reason is required' }); return; }
      const result = await withStateMutation(async () => {
        const state = await readState();
        const cashflow = parseStateValue(state, 'nvp-cashflow', []);
        const original = cashflow.find((entry) => entry.id === decodeURIComponent(cashflowReversalMatch[1]));
        if (!original) return { status: 404, payload: { error: 'Transaction not found' } };
        if (original.reversalOf) return { status: 409, payload: { error: 'A reversal cannot be reversed' } };
        const existing = cashflow.find((entry) => entry.reversalOf === original.id);
        if (existing) return { status: 200, payload: { ok: true, duplicate: true, cashflowEntry: existing } };
        const reversal = createCashflowEntry({ title: `Hoàn tác ${original.title}`, type: original.type === 'income' ? 'expense' : 'income', amount: original.amount, category: 'transaction-reversal', method: original.method || 'other', building: original.building, apartment: original.apartment, sourceType: 'cashflow-reversal', sourceId: original.id, invoiceCode: original.invoiceCode, actor: financialActor(request), reversalOf: original.id });
        reversal.affectsCash = original.affectsCash !== false;
        reversal.affectsProfit = original.affectsProfit !== false;
        reversal.note = reason;
        cashflow.push(reversal);
        state.updatedAt = reversal.createdAt;
        state.state['nvp-cashflow'] = JSON.stringify(cashflow);
        await writeState(state);
        return { status: 200, payload: { ok: true, cashflowEntry: reversal } };
      });
      sendJson(response, result.status, result.payload);
      return;
    }
    if (request.method === 'POST' && request.url === '/api/smart-home/readings') {
      if (!isAuthenticated(request)) { sendJson(response, 401, { error: 'Unauthorized' }); return; }
      try {
        const config = parseStateValue(await readState(), 'nvp-smart-home-config', {});
        sendJson(response, 200, { readings: await fetchSmartHomeReadings({ url: config.smartHomeUrl, apiKey: config.smartHomeApiKey, token: config.smartHomeToken }) });
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
    if (request.method === 'GET' && request.url === '/api/smart-home/current-readings') {
      if (!isAuthenticated(request)) { sendJson(response, 401, { error: 'Unauthorized' }); return; }
      try {
        const config = parseStateValue(await readState(), 'nvp-smart-home-config', {});
        sendJson(response, 200, { readings: await fetchTuyaEnergyReadings(config) });
      } catch (error) {
        sendJson(response, 502, { error: error.message || 'Unable to retrieve current Tuya readings' });
      }
      return;
    }
    if (request.method === 'POST' && request.url === '/api/smart-home/sync-energy') {
      if (!isAuthenticated(request)) { sendJson(response, 401, { error: 'Unauthorized' }); return; }
      try {
        sendJson(response, 200, { ok: true, ...(await syncTuyaEnergyReadings()) });
      } catch (error) {
        sendJson(response, 502, { error: error.message || 'Unable to sync Tuya energy readings' });
      }
      return;
    }
    if (request.url === '/api/smart-home/config' && request.method === 'GET') {
      if (!isOwner(request)) { sendJson(response, 403, { error: 'Owner access required' }); return; }
      const config = parseStateValue(await readState(), 'nvp-smart-home-config', {});
      sendJson(response, 200, {
        endpoint: '/api/smart-home/push-readings',
        configured: Boolean(config.pushToken || smartHomePushToken),
        tokenSet: Boolean(config.pushToken || smartHomePushToken),
        smartHomeUrl: config.smartHomeUrl || '',
        smartHomeApiKeySet: Boolean(config.smartHomeApiKey),
        smartHomeTokenSet: Boolean(config.smartHomeToken),
        tuyaAccessId: config.tuyaAccessId || '',
        tuyaDataCenter: getTuyaDataCenter(config),
        tuyaDataCenters: Object.entries(tuyaDataCenters).map(([value, item]) => ({ value, name: item.name })),
        tuyaEndpoint: getTuyaEndpoint(config),
        tuyaMqEndpoint: String(config.tuyaMqEndpoint || tuyaSingaporeMqEndpoint).replace(/mqe\.tuyaas\.com|mqe\.tuyas\.com/, 'mqe.tuyaus.com'),
        tuyaDeviceIds: config.tuyaDeviceIds || '',
        tuyaTopic: config.tuyaTopic || '',
        tuyaSubscription: config.tuyaSubscription || 'phu-gia-energy',
        tuyaSecretSet: Boolean(config.tuyaAccessSecret),
        tuyaMqTokenSet: Boolean(config.tuyaMqToken)
      });
      return;
    }
    if (request.url === '/api/smart-home/test' && request.method === 'POST') {
      if (!isOwner(request)) { sendJson(response, 403, { error: 'Owner access required' }); return; }
      const payload = await readBody(request);
      const existing = parseStateValue(await readState(), 'nvp-smart-home-config', {});
      const tuyaDataCenter = String(payload.tuyaDataCenter || getTuyaDataCenter(existing));
      if (!tuyaDataCenters[tuyaDataCenter]) { sendJson(response, 400, { error: 'Invalid Tuya data center' }); return; }
      const config = {
        tuyaAccessId: String(payload.tuyaAccessId || existing.tuyaAccessId || '').trim(),
        tuyaAccessSecret: String(payload.tuyaAccessSecret || existing.tuyaAccessSecret || '').trim(),
        tuyaDataCenter,
        tuyaDeviceIds: ''
      };
      if (!config.tuyaAccessId || !config.tuyaAccessSecret) { sendJson(response, 400, { error: 'Tuya Access ID and Access Secret are required' }); return; }
      try {
        const meters = await fetchTuyaMeters(config);
        sendJson(response, 200, { ok: true, endpoint: getTuyaEndpoint(config), meters });
      } catch (error) {
        sendJson(response, 502, { error: error.message || 'Unable to connect to Tuya Cloud' });
      }
      return;
    }
    if (request.url === '/api/smart-home/config' && request.method === 'PUT') {
      if (!isOwner(request)) { sendJson(response, 403, { error: 'Owner access required' }); return; }
      const payload = await readBody(request);
      const pushToken = String(payload.pushToken || '').trim();
      const state = await readState();
      const existing = parseStateValue(state, 'nvp-smart-home-config', {});
      const hasTuyaInput = ['tuyaAccessId', 'tuyaAccessSecret', 'tuyaDataCenter', 'tuyaDeviceIds'].some((key) => key in payload);
      if (pushToken && pushToken.length < 16) { sendJson(response, 400, { error: 'Smart Home token must be at least 16 characters' }); return; }
      if (hasTuyaInput && !String(payload.tuyaAccessId || existing.tuyaAccessId || '').trim()) { sendJson(response, 400, { error: 'Tuya Access ID is required' }); return; }
      if (hasTuyaInput && !String(payload.tuyaAccessSecret || existing.tuyaAccessSecret || '').trim()) { sendJson(response, 400, { error: 'Tuya Access Secret is required' }); return; }
      const tuyaDataCenter = String(payload.tuyaDataCenter || getTuyaDataCenter(existing));
      if (!tuyaDataCenters[tuyaDataCenter]) { sendJson(response, 400, { error: 'Invalid Tuya data center' }); return; }
      const config = {
        ...existing,
        pushToken: pushToken || existing.pushToken || '',
        smartHomeUrl: String(payload.smartHomeUrl || existing.smartHomeUrl || '').trim(),
        smartHomeApiKey: String(payload.smartHomeApiKey || existing.smartHomeApiKey || '').trim(),
        smartHomeToken: String(payload.smartHomeToken || existing.smartHomeToken || '').trim(),
        tuyaAccessId: String(payload.tuyaAccessId || existing.tuyaAccessId || '').trim(),
        tuyaAccessSecret: String(payload.tuyaAccessSecret || existing.tuyaAccessSecret || '').trim(),
        tuyaDataCenter,
        tuyaEndpoint: tuyaDataCenters[tuyaDataCenter].endpoint,
        tuyaMqEndpoint: String(payload.tuyaMqEndpoint || existing.tuyaMqEndpoint || tuyaSingaporeMqEndpoint).trim().replace(/mqe\.tuyaas\.com|mqe\.tuyas\.com/, 'mqe.tuyaus.com'),
        tuyaDeviceIds: String(Object.prototype.hasOwnProperty.call(payload, 'tuyaDeviceIds') ? payload.tuyaDeviceIds : existing.tuyaDeviceIds || '').trim(),
        tuyaTopic: String(payload.tuyaTopic || existing.tuyaTopic || '').trim(),
        tuyaMqToken: String(payload.tuyaMqToken || existing.tuyaMqToken || '').trim(),
        tuyaSubscription: String(payload.tuyaSubscription || existing.tuyaSubscription || 'phu-gia-energy').trim(),
        updatedAt: new Date().toISOString()
      };
      if (!/^wss:\/\//i.test(config.tuyaMqEndpoint)) { sendJson(response, 400, { error: 'Tuya MQ endpoint must use WSS' }); return; }
      await withStateMutation(async () => {
        const latestState = await readState();
        latestState.state['nvp-smart-home-config'] = JSON.stringify(config);
        latestState.updatedAt = new Date().toISOString();
        await writeState(latestState);
      });
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
      const building = buildings.find((item) => String(payload.buildingCode || '').trim() === String(item.code || '').trim() || String(payload.buildingCode || '').trim() === String(item.name || '').trim());
      if (!building) { sendJson(response, 404, { error: 'Building not found' }); return; }
      const processed = [];
      const skipped = [];
      readings.forEach((reading) => {
        const apartment = (building.apartments || []).find((item) => String(item.meterId || '').trim() === reading.meterId);
        if (!apartment) { skipped.push({ meterId: reading.meterId, reason: 'Meter is not mapped to an apartment' }); return; }
        const apartmentKey = `${building.name} | ${apartment.name}`;
        apartment.latestElectricityReading = reading.current;
        apartment.latestElectricityReadingAt = reading.timestamp;
        const customer = customers.find((item) => String(item.apartment || '').trim() === String(apartment.name || '').trim() && (!item.building || String(item.building).trim() === String(building.name).trim()) && item.status === 'renting');
        if (!customer) { skipped.push({ meterId: reading.meterId, reason: 'Apartment has no active tenant', current: reading.current }); return; }
        const previousLog = meterLogs.filter((item) => item.service === 'electricity' && (item.meterId === reading.meterId || item.apartment === apartmentKey)).at(-1);
        const hasBaseline = apartment.electricityBaseline !== '' && apartment.electricityBaseline !== null && apartment.electricityBaseline !== undefined && Number.isFinite(Number(apartment.electricityBaseline));
        const baselineIsNewer = hasBaseline && (!previousLog || new Date(apartment.electricityBaselineAt || 0) > new Date(previousLog.createdAt || 0));
        if (!previousLog && !hasBaseline) {
          apartment.electricityBaseline = reading.current;
          apartment.electricityBaselineAt = reading.timestamp;
          skipped.push({ meterId: reading.meterId, reason: 'Initial tenant meter baseline captured', current: reading.current });
          return;
        }
        const previous = Number(baselineIsNewer ? apartment.electricityBaseline : previousLog?.current ?? apartment.electricityBaseline);
        if (reading.current < previous) { skipped.push({ meterId: reading.meterId, reason: 'Current reading is lower than previous reading' }); return; }
        if (meterLogs.some((item) => item.service === 'electricity' && item.meterId === reading.meterId && item.month === month && Number(item.current) === reading.current)) { skipped.push({ meterId: reading.meterId, reason: 'Reading already processed' }); return; }
        const rate = configuredAmount(apartment.electricityRate, (building.settings?.electricityFloorRates || {})[apartment.floor], building.settings?.electricityRate);
        const usage = reading.current - previous;
        const amount = usage * rate;
        if (usage <= 0) { skipped.push({ meterId: reading.meterId, reason: 'Reading has not changed' }); return; }
        if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(amount) || amount <= 0) { skipped.push({ meterId: reading.meterId, reason: 'Electricity rate is not configured' }); return; }
        const createdAt = new Date().toISOString();
        meterLogs.push({ id: crypto.randomUUID(), apartment: apartmentKey, meterId: reading.meterId, service: 'electricity', previous, current: reading.current, usage, rate, amount, month, source: 'smart-home-api', createdAt });
        processed.push({ meterId: reading.meterId, apartment: apartment.name, previous, current: reading.current, usage, rate, amount, tenantEmail: customer.email || '' });
      });
      state.updatedAt = new Date().toISOString();
      state.state['nvp-buildings'] = JSON.stringify(buildings);
      state.state['nvp-meter-logs'] = JSON.stringify(meterLogs);
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
    if (request.method === 'GET' && request.url === '/api/banks') {
      sendJson(response, 200, { banks: await getBankDirectory() });
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
      const result = await withStateMutation(async () => {
        const current = await readState();
        const invoices = parseStateValue(current, 'nvp-invoices', []);
        const cashflow = parseStateValue(current, 'nvp-cashflow', []);
        const existing = invoices.find((invoice) => invoice.bankTransactionId === transactionId);
        if (existing) return { status: 200, payload: { ok: true, duplicate: true, invoice: existing.paymentCode } };
        const matchedInvoice = invoices.find((item) => item.status !== 'paid' && item.paymentCode && content.toUpperCase().includes(String(item.paymentCode).toUpperCase()));
        if (!matchedInvoice) return { status: 202, payload: { ok: false, reason: 'Payment code not matched' } };
        const invoice = matchedInvoice;
        const collected = collectInvoice(invoices, cashflow, invoice, { amount, method: 'bank-transfer', actor: financialActor(request), transactionId, content });
        if (collected.error) return { status: 202, payload: { ok: false, reason: collected.error, invoice: invoice.paymentCode } };
        current.updatedAt = new Date().toISOString();
        current.state['nvp-invoices'] = JSON.stringify(invoices);
        current.state['nvp-cashflow'] = JSON.stringify(cashflow);
        await writeState(current);
        return { status: 200, payload: { ok: true, invoice: invoice.paymentCode, overpayment: invoice.overpayment } };
      });
      sendJson(response, result.status, result.payload);
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
      const email = String(payload.email || '').trim().toLowerCase();
      const password = String(payload.password || '');
      const rateLimit = loginRateLimit(request, email, 'application');
      let role = '';
      let name = '';
      if (email === adminEmail.toLowerCase() && verifyAdministratorPassword(password)) {
        role = 'owner';
        name = 'Chủ nhà';
      } else {
        const users = parseStateValue(await readState(), 'nvp-users', []);
        const user = users.find((item) => String(item.email || '').toLowerCase() === email && item.role === 'staff' && item.active !== false && verifyPassword(password, item.passwordHash));
        if (user) { role = 'staff'; name = user.name; }
      }
      if (!role) {
        if (rateLimit.blocked) { response.setHeader('Retry-After', rateLimit.retryAfter); sendJson(response, 429, { error: 'Too many login attempts' }); return; }
        recordLoginFailure(rateLimit.key);
        sendJson(response, 401, { error: 'Invalid credentials' });
        return;
      }
      loginAttempts.delete(rateLimit.key);
      const secure = request.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...securityHeaders(), 'Set-Cookie': applicationSessionCookies(email, role, secure) });
      response.end(JSON.stringify({ ok: true, role, name, passwordChangeRequired: role === 'owner' && isAdministratorPasswordChangeRequired() }));
      return;
    }
    if (request.method === 'POST' && request.url === '/api/admin-password') {
      if (!isOwner(request)) { sendJson(response, 403, { error: 'Owner access required' }); return; }
      const payload = await readBody(request);
      const currentPassword = String(payload.currentPassword || '');
      const newPassword = String(payload.newPassword || '');
      if (!verifyAdministratorPassword(currentPassword)) { sendJson(response, 400, { error: 'Current password is incorrect' }); return; }
      if (newPassword.length < 12 || /[\r\n]/.test(newPassword)) { sendJson(response, 400, { error: 'New password must contain at least 12 characters' }); return; }
      try {
        await writeOwnerCredentials(newPassword, false);
        sendJson(response, 200, { ok: true });
      } catch (error) {
        console.error('Unable to update administrator password:', error);
        sendJson(response, 500, { error: 'Unable to update password' });
      }
      return;
    }
    if (request.method === 'POST' && request.url === '/api/logout') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...securityHeaders(), 'Set-Cookie': ['nvp_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0', 'nvp_user_email=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0', 'nvp_user_role=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0', 'nvp_tenant_email=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0', 'nvp_tenant_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'] });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (request.method === 'POST' && request.url === '/api/tenant-login') {
      const payload = await readBody(request);
      const email = String(payload.email || '').trim().toLowerCase();
      const password = String(payload.password || '');
      const rateLimit = loginRateLimit(request, email, 'tenant');
      if (rateLimit.blocked) { response.setHeader('Retry-After', rateLimit.retryAfter); sendJson(response, 429, { error: 'Too many login attempts' }); return; }
      const users = parseStateValue(await readState(), 'nvp-users', []);
      const user = users.find((item) => String(item.email || '').toLowerCase() === email && item.role === 'tenant' && item.active !== false && verifyPassword(password, item.passwordHash));
      if (!user || !sessionSecret) { recordLoginFailure(rateLimit.key); sendJson(response, 401, { error: 'Invalid credentials' }); return; }
      loginAttempts.delete(rateLimit.key);
      const secure = request.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...securityHeaders(), 'Set-Cookie': [`nvp_tenant_email=${encodeURIComponent(email)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure}`, `nvp_tenant_session=${encodeURIComponent(signSession(email, 'tenant'))}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure}`] });
      response.end(JSON.stringify({ ok: true, role: 'tenant' }));
      return;
    }
    if (request.method === 'POST' && ['/api/users', '/api/tenant-users'].includes(request.url)) {
      if (!isOwner(request)) { sendJson(response, 403, { error: 'Owner access required' }); return; }
      const payload = await readBody(request);
      const name = String(payload.name || '').trim();
      const email = String(payload.email || '').trim().toLowerCase();
      const password = String(payload.password || '');
      const customerId = String(payload.customerId || '').trim();
      const role = payload.role === 'staff' ? 'staff' : 'tenant';
      if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) { sendJson(response, 400, { error: 'Invalid user data' }); return; }
      const user = await withStateMutation(async () => {
        const current = await readState();
        const users = parseStateValue(current, 'nvp-users', []);
        const customers = parseStateValue(current, 'nvp-customers', []);
        if (users.some((item) => String(item.email || '').toLowerCase() === email)) return null;
        const createdUser = { id: crypto.randomUUID(), customerId: role === 'tenant' ? customerId : '', name, email, passwordHash: hashPassword(password), role, active: true, createdAt: new Date().toISOString() };
        users.push(createdUser);
        const customer = role === 'tenant' ? customers.find((item) => item.id === customerId) : null;
        if (customer) { customer.email = email; customer.accountId = createdUser.id; }
        current.updatedAt = new Date().toISOString();
        current.state['nvp-users'] = JSON.stringify(users);
        current.state['nvp-customers'] = JSON.stringify(customers);
        await writeState(current);
        return createdUser;
      });
      if (!user) { sendJson(response, 409, { error: 'Email already exists' }); return; }
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
      const invoices = parseStateValue(state, 'nvp-invoices', []).filter((item) => item.approvalStatus !== 'pending' && String(item.tenantEmail || '').toLowerCase() === email);
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
      await withStateMutation(async () => {
        const current = await readState();
        const feedback = parseStateValue(current, 'nvp-feedback', []);
        feedback.unshift(item);
        current.updatedAt = new Date().toISOString();
        current.state['nvp-feedback'] = JSON.stringify(feedback);
        await writeState(current);
      });
      sendJson(response, 201, { feedback: item });
      return;
    }
    if (request.method === 'GET' && request.url === '/api/backup') {
      if (!isOwner(request)) { sendJson(response, 403, { error: 'Owner access required' }); return; }
      const state = await readState();
      const fileName = `phu-gia-land-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      const archive = new ZipArchive({ zlib: { level: 9 } });
      archive.on('error', (error) => response.destroy(error));
      response.writeHead(200, { ...securityHeaders(), 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'no-store' });
      archive.pipe(response);
      archive.append(JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), state: state.state }, null, 2), { name: 'backup.json' });
      if (fsSync.existsSync(mediaDirectory)) archive.directory(mediaDirectory, 'media');
      if (fsSync.existsSync(documentDirectory)) archive.directory(documentDirectory, 'documents');
      await archive.finalize();
      return;
    }
    if (request.method === 'POST' && request.url === '/api/restore') {
      if (!isOwner(request)) { sendJson(response, 403, { error: 'Owner access required' }); return; }
      const payload = await readBody(request);
      await restoreBackupArchive(payload.archiveDataUrl);
      sendJson(response, 200, { ok: true });
      return;
    }
    if (request.method === 'GET' && request.url === '/api/state') {
      const session = getApplicationSession(request);
      const tokenAuthorized = apiToken && request.headers.authorization === `Bearer ${apiToken}`;
      if (!session && !tokenAuthorized) {
        sendJson(response, 401, { error: 'Unauthorized' });
        return;
      }
      const state = await readState();
      sendJson(response, 200, tokenAuthorized ? state : filterStateForRole(state, session.role));
      return;
    }
    if (request.method === 'PUT' && request.url === '/api/state') {
      const session = getApplicationSession(request);
      const tokenAuthorized = apiToken && request.headers.authorization === `Bearer ${apiToken}`;
      if (!session && !tokenAuthorized) {
        sendJson(response, 401, { error: 'Unauthorized' });
        return;
      }
      const payload = await readBody(request);
      const incoming = payload.state && typeof payload.state === 'object' ? payload.state : {};
      if (session?.role === 'staff' && Object.keys(incoming).some((key) => staffRestrictedKeys.has(key))) {
        sendJson(response, 403, { error: 'Staff cannot modify restricted data' });
        return;
      }
      const validationError = validateIncomingFinancialState(incoming);
      if (validationError) { sendJson(response, 400, { error: validationError }); return; }
      const next = await withStateMutation(async () => {
        const current = await readState();
        const state = filterIncomingStateForRole(incoming, tokenAuthorized ? 'owner' : session.role, current);
        const updated = { version: 1, updatedAt: new Date().toISOString(), state: { ...current.state, ...state } };
        await removeOrphanedMedia(current, updated);
        await writeState(updated);
        return updated;
      });
      sendJson(response, 200, next);
      return;
    }
    if (request.method === 'DELETE' && request.url === '/api/state') {
      if (!isOwner(request) && (!apiToken || request.headers.authorization !== `Bearer ${apiToken}`)) {
        sendJson(response, 403, { error: 'Owner access required' });
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
  const runBillingAutomation = async () => {
    const now = new Date();
    if (now.getDate() >= 1) {
      const month = previousMonth(now);
      const state = await readState();
      const monthlyInvoicesExist = parseStateValue(state, 'nvp-invoices', []).some((invoice) => invoice.month === month && invoice.source === 'monthly-closing');
      if (!monthlyInvoicesExist) {
        try {
          await syncTuyaEnergyReadings(month);
        } catch (error) {
          console.error('Automatic Tuya sync failed:', error.message);
        }
      }
      closeUtilityInvoices(month).then((invoices) => console.log(`Monthly draft billing: ${invoices.length} invoice(s) created`)).catch((error) => console.error('Monthly billing failed:', error.message));
    }
    if (now.getDate() >= 6) sendOverdueInvoiceReminders(now).then((invoices) => console.log(`Overdue reminders: ${invoices.length} invoice(s)`)).catch((error) => console.error('Overdue reminder failed:', error.message));
  };
  if (process.env.NVP_DISABLE_SCHEDULED_JOBS !== 'true') {
    runBillingAutomation();
    setInterval(runBillingAutomation, 60 * 60 * 1000);
  }
});
