require('dotenv').config();

const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ZipArchive } = require('archiver');

async function createBackup() {
  const root = __dirname;
  const dataDirectory = process.env.NVP_DATA_DIRECTORY ? path.resolve(process.env.NVP_DATA_DIRECTORY) : path.join(root, 'data');
  const stateFile = path.join(dataDirectory, 'state.json');
  const source = JSON.parse((await fs.readFile(stateFile, 'utf8')).replace(/^\uFEFF/, ''));
  if (!source.state || typeof source.state !== 'object' || Array.isArray(source.state)) throw new Error('Source state.json is invalid');

  const requestedOutput = process.argv[2];
  const outputFile = requestedOutput
    ? path.resolve(requestedOutput)
    : path.join(root, `phu-gia-land-backup-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}.zip`);
  await fs.mkdir(path.dirname(outputFile), { recursive: true });

  const output = fsSync.createWriteStream(outputFile, { flags: 'wx' });
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const completed = new Promise((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
  });
  archive.pipe(output);
  archive.append(JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), state: source.state }, null, 2), { name: 'backup.json' });

  const mediaDirectory = path.join(dataDirectory, 'media');
  const documentDirectory = path.join(dataDirectory, 'documents');
  if (fsSync.existsSync(mediaDirectory)) archive.directory(mediaDirectory, 'media');
  if (fsSync.existsSync(documentDirectory)) archive.directory(documentDirectory, 'documents');
  await archive.finalize();
  await completed;
  console.log(`Created private data backup: ${outputFile}`);
}

createBackup().catch((error) => {
  console.error(`Data backup failed: ${error.message}`);
  process.exitCode = 1;
});