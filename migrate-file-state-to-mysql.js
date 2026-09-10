require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');

const requiredSettings = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missing = requiredSettings.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`Missing required database settings: ${missing.join(', ')}`);

async function migrate() {
  const sourceFile = path.join(__dirname, 'data', 'state.json');
  const source = JSON.parse(await fs.readFile(sourceFile, 'utf8'));
  const state = source.state && typeof source.state === 'object' ? source.state : {};
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    charset: 'utf8mb4'
  });
  try {
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