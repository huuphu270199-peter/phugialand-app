require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const Pulsar = require('pulsar-client');
const { TuyaContext } = require('@tuya/tuya-connector-nodejs');

const energyCodes = new Set(['total_forward_energy', 'add_ele']);

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function getConfiguration() {
  let saved = {};
  try {
    const state = JSON.parse(await fs.readFile(path.join(__dirname, 'data', 'state.json'), 'utf8'));
    saved = JSON.parse(state.state?.['nvp-smart-home-config'] || '{}');
  } catch {}
  return {
    accessId: String(process.env.TUYA_ACCESS_ID || saved.tuyaAccessId || '').trim() || required('TUYA_ACCESS_ID'),
    accessSecret: String(process.env.TUYA_ACCESS_SECRET || saved.tuyaAccessSecret || '').trim() || required('TUYA_ACCESS_SECRET'),
    endpoint: String(process.env.TUYA_ENDPOINT || saved.tuyaEndpoint || 'https://openapi-sg.iotbing.com').replace(/openapi\.tuyaas\.com|openapi\.tuyas\.com|openapi\.tuyaus\.com/, 'openapi-sg.iotbing.com'),
    mqEndpoint: String(process.env.TUYA_MQ_ENDPOINT || saved.tuyaMqEndpoint || 'wss://mqe.tuyaus.com:8285/').replace(/mqe\.tuyaas\.com|mqe\.tuyas\.com/, 'mqe.tuyaus.com'),
    topic: String(process.env.TUYA_MQ_TOPIC || saved.tuyaTopic || '').trim() || required('TUYA_MQ_TOPIC'),
    subscription: process.env.TUYA_MQ_SUBSCRIPTION || saved.tuyaSubscription || `phu-gia-energy-${process.env.TUYA_ACCESS_ID || saved.tuyaAccessId}`,
    token: String(process.env.TUYA_MQ_TOKEN || saved.tuyaMqToken || '').trim() || required('TUYA_MQ_TOKEN'),
    payloadKey: String(process.env.TUYA_MQ_PAYLOAD_KEY || saved.tuyaPayloadKey || '').trim()
  };
}

function createTuyaClient(config) {
  return new TuyaContext({
    baseUrl: config.endpoint,
    accessKey: config.accessId,
    secretKey: config.accessSecret
  });
}

function decodeMessage(data, payloadKey) {
  const raw = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
  const message = JSON.parse(raw);
  if (!message.encrypt || !payloadKey) return message;

  const encrypted = Buffer.from(message.data, 'base64');
  const key = crypto.createHash('sha256').update(payloadKey).digest();
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.alloc(16));
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  return { ...message, data: JSON.parse(decrypted) };
}

function findEnergyStatus(message) {
  const payload = message.data && typeof message.data === 'object' ? message.data : message;
  const status = Array.isArray(payload.status) ? payload.status : [];
  const reading = status.find((item) => energyCodes.has(item.code));
  if (!reading || !Number.isFinite(Number(reading.value))) return null;

  return {
    deviceId: String(payload.devId || payload.device_id || payload.deviceId || ''),
    code: reading.code,
    value: Number(reading.value),
    timestamp: payload.t || payload.time || Date.now()
  };
}

async function persistEnergyReading(reading) {
  // Replace this hook with database persistence or a WebSocket broadcast when needed.
  return reading;
}

async function validateOpenApiAccess(tuya) {
  await tuya.request({ method: 'GET', path: '/v1.0/token?grant_type=1', body: {} });
}

async function startEnergyListener() {
  const config = await getConfiguration();
  const tuya = createTuyaClient(config);
  await validateOpenApiAccess(tuya);

  const client = new Pulsar.Client({
    serviceUrl: config.mqEndpoint,
    authentication: new Pulsar.AuthenticationToken({ token: config.token })
  });
  const consumer = await client.subscribe({ topic: config.topic, subscription: config.subscription });

  console.log(`Tuya energy listener connected to ${config.mqEndpoint}`);
  while (true) {
    const message = await consumer.receive();
    try {
      const reading = findEnergyStatus(decodeMessage(message.getData(), config.payloadKey));
      if (reading) {
        const seconds = Number(reading.timestamp) < 10_000_000_000;
        const time = new Date(Number(reading.timestamp) * (seconds ? 1000 : 1)).toISOString();
        console.log(`[${time}] - Thiết bị ${reading.deviceId} vừa tiêu thụ: ${reading.value} kW·h`);
        await persistEnergyReading(reading);
      }
      consumer.acknowledge(message);
    } catch (error) {
      console.error('Unable to process Tuya MQ message:', error.message);
      consumer.negativeAcknowledge(message);
    }
  }
}

if (require.main === module) {
  startEnergyListener().catch((error) => {
    console.error(`Tuya energy listener stopped: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { decodeMessage, findEnergyStatus, persistEnergyReading, startEnergyListener };