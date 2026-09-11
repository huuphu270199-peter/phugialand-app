require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');

const requiredSettings = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missing = requiredSettings.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`Missing required database settings: ${missing.join(', ')}`);

async function migrate() {
  const dataDirectory = process.env.NVP_DATA_DIRECTORY ? path.resolve(process.env.NVP_DATA_DIRECTORY) : path.join(__dirname, 'data');
  const sourceFile = path.join(dataDirectory, 'state.json');
  const source = JSON.parse(await fs.readFile(sourceFile, 'utf8'));
  if (!source.state || typeof source.state !== 'object' || Array.isArray(source.state)) throw new Error('Source state.json is invalid');
  const state = source.state;
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    charset: 'utf8mb4'
  });
  try {
    await connection.execute(`CREATE TABLE IF NOT EXISTS app_state (
      state_key VARCHAR(191) NOT NULL PRIMARY KEY,
      state_value LONGTEXT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.beginTransaction();
    await connection.execute('DELETE FROM app_state');
    for (const [key, value] of Object.entries(state)) {
      await connection.execute('INSERT INTO app_state (state_key, state_value) VALUES (?, ?)', [key, value ?? null]);
    }
    await connection.commit();
    console.log(`Migrated ${Object.keys(state).length} state records to MySQL.`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

migrate().catch((error) => {
  console.error(`MySQL migration failed: ${error.message}`);
  process.exitCode = 1;
});