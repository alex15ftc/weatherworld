// Uploads the packed storm art (tools/pack-textures.py) to Roblox through Open Cloud and writes
// the image ids to Shared/Weather/Textures.luau, which StormController draws with.
//
//   node roblox/tools/upload-images.mjs check            what the key can do, and whose it is
//   node roblox/tools/upload-images.mjs upload [dir]     upload what is not uploaded yet
//   node roblox/tools/upload-images.mjs model <file.fbx> <out.rbxm>
//                                                        upload a mesh as a Model and save the
//                                                        model Roblox makes of it (MeshPart, Bones)
//
// The key is the one roblox-devflow keeps (tools/set-opencloud-key.ps1, or `devflow key set`):
// DPAPI-encrypted for this Windows user in %LOCALAPPDATA%\devflow\opencloud-key.dat. It is read
// into memory only, never printed. DEVFLOW_OPENCLOUD_KEY overrides it (CI, other machines).
// Uploads go to the key's owner. Images are moderated; until Roblox approves one it does not
// show, and StormController keeps drawing the part-built storm.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROBLOX = path.resolve(HERE, '..');
const OUT_LUAU = path.join(ROBLOX, 'Shared', 'Weather', 'Textures.luau');
const RECORD = path.join(ROBLOX, 'Textures', 'uploaded.json'); // file hash -> image id, so nothing uploads twice
const API = 'https://apis.roblox.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function readKey() {
  if (process.env.DEVFLOW_OPENCLOUD_KEY) return process.env.DEVFLOW_OPENCLOUD_KEY;
  const file = path.join(process.env.LOCALAPPDATA ?? '', 'devflow', 'opencloud-key.dat');
  if (!existsSync(file)) throw new Error(`No key: run roblox/tools/set-opencloud-key.ps1 (or devflow key set)`);
  const script = `[Net.NetworkCredential]::new('', (Get-Content -LiteralPath '${file.replace(/'/g, "''")}' | ConvertTo-SecureString)).Password`;
  const key = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' }).trim();
  if (!key) throw new Error('The stored key could not be read');
  return key;
}

async function call(key, method, url, body, headers = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url.startsWith('http') ? url : API + url, { method, body, headers: { 'x-api-key': key, ...headers } });
    const text = await res.text();
    // Rate limited (or Roblox busy): wait and try again, longer each time.
    if ((res.status === 429 || res.status >= 500) && attempt < 8) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 5000 * 2 ** attempt;
      console.log(`  ${res.status} from ${url}; waiting ${Math.round(wait / 1000)} s`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${text.slice(0, 300)}`);
    return text;
  }
}

async function introspect(key) {
  return JSON.parse(await call(key, 'POST', '/api-keys/v1/introspect', JSON.stringify({ apiKey: key }), { 'content-type': 'application/json' }));
}


// Uploads one PNG as a Decal and waits for the operation; returns the asset id.
async function uploadDecal(key, userId, file, name) {
  const form = new FormData();
  form.append('request', JSON.stringify({
    assetType: 'Decal',
    displayName: name,
    description: 'WeatherWorld storm art',
    creationContext: { creator: { userId: String(userId) } },
  }));
  form.append('fileContent', new Blob([readFileSync(file)], { type: 'image/png' }), path.basename(file));
  let op = JSON.parse(await call(key, 'POST', '/assets/v1/assets', form));
  for (let i = 0; !op.done && i < 60; i++) {
    await sleep(2000);
    op = JSON.parse(await call(key, 'GET', `/assets/v1/${op.path}`));
  }
  if (!op.done) throw new Error(`upload of ${name} did not finish`);
  if (op.error) throw new Error(`upload of ${name} failed: ${JSON.stringify(op.error)}`);
  return op.response.assetId;
}

// Uploads one .glb, .fbx or .rbxm as a Model (Roblox imports its mesh) and waits; returns the model's asset id.
async function uploadModel(key, userId, file, name) {
  const form = new FormData();
  form.append('request', JSON.stringify({
    assetType: 'Model',
    displayName: name,
    description: 'WeatherWorld storm volume mesh',
    creationContext: { creator: { userId: String(userId) } },
  }));
  const type = { '.fbx': 'model/fbx', '.rbxm': 'model/x-rbxm', '.rbxmx': 'model/x-rbxmx' }[path.extname(file)] ?? 'model/gltf-binary';
  form.append('fileContent', new Blob([readFileSync(file)], { type }), path.basename(file));
  let op = JSON.parse(await call(key, 'POST', '/assets/v1/assets', form));
  for (let i = 0; !op.done && i < 60; i++) {
    await sleep(2000);
    op = JSON.parse(await call(key, 'GET', `/assets/v1/${op.path}`));
  }
  if (!op.done) throw new Error(`upload of ${name} did not finish`);
  if (op.error) throw new Error(`upload of ${name} failed: ${JSON.stringify(op.error)}`);
  return op.response.assetId;
}

// An uploaded model's file (.rbxm).
async function downloadModel(key, modelId) {
  const where = JSON.parse(await call(key, 'GET', `/asset-delivery-api/v1/assetId/${modelId}`));
  return Buffer.from(await (await fetch(where.location)).arrayBuffer());
}

// The mesh inside an uploaded model: download the model and read its MeshPart (tools/mesh-id.luau).
async function meshIdOf(key, modelId) {
  const bytes = await downloadModel(key, modelId);
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'ww-mesh-')), 'model.rbxm');
  writeFileSync(file, bytes);
  const id = execFileSync('lune', ['run', path.join(HERE, 'mesh-id.luau'), file], { encoding: 'utf8', cwd: ROBLOX }).trim();
  if (!/^\d+$/.test(id)) throw new Error(`no mesh id in model ${modelId}: ${id}`);
  return id;
}

// A Decal wraps an Image; ImageLabels need the Image's id. Asset delivery gives either the PNG
// itself (already an image id) or the decal's model, which names its texture.
async function imageIdOf(key, assetId) {
  const where = JSON.parse(await call(key, 'GET', `/asset-delivery-api/v1/assetId/${assetId}`));
  const res = await fetch(where.location);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.subarray(0, 4).toString('hex') === '89504e47') return String(assetId);
  const text = bytes.toString('latin1');
  const match = text.match(/(?:\?id=|rbxassetid:\/\/)(\d+)/);
  if (!match) throw new Error(`could not find the image inside decal ${assetId}`);
  return match[1];
}

function writeLuau(manifest, ids) {
  const id = file => (ids[file] ? `"rbxassetid://${ids[file]}"` : '""');
  const lines = [
    '--!strict',
    '-- GENERATED by roblox/tools/upload-images.mjs from the baked storm art (scripts/bake-tornadoes.mjs,',
    '-- tools/pack-textures.py). Image ids for StormController\x27s sprites; "" where not uploaded yet.',
    '',
    '-- A tornado shape (the engine\x27s name, describeFunnel; -multi for several vortices): its life',
    '-- (frames: lowering, mature, roping out, lifting) on sheets of grid x grid, one per side it is',
    '-- seen from (views: bearings of the camera from it). A frame is frameShare cloud-base heights',
    '-- square, standing on the ground; the funnel\x27s radius halfway up is midRadiusShare of the base.',
    'export type Tornado = {',
    '	shape: string,',
    '	vortices: number,',
    '	grid: number,',
    '	frames: number,',
    '	frameShare: number,',
    '	midRadiusShare: number,',
    '	views: { number },',
    '	sheets: { string },',
    '}',
    '',
    'local tornadoes: { [string]: Tornado } = {',
  ];
  for (const [name, t] of Object.entries(manifest.tornadoes ?? {})) {
    lines.push(
      `	["${name}"] = {`,
      `		shape = "${t.shape}",`,
      `		vortices = ${t.vortices},`,
      `		grid = ${t.grid},`,
      `		frames = ${t.frames},`,
      `		frameShare = ${t.frameShare.toFixed(4)},`,
      `		midRadiusShare = ${t.midRadiusShare.toFixed(4)},`,
      `		views = { ${t.views.join(', ')} },`,
      `		sheets = { ${t.views.map(v => id(t.files[v])).join(', ')} },`,
      '	},',
    );
  }
  lines.push(
    '}',
    '',
    '-- Storm volume shell meshes (scripts/bake-volume-meshes.mjs), uploaded for where the game',
    '-- cannot build them with EditableMesh: per kind, per variant, the mesh of each shell.',
    'local volumes: { [string]: { { string } } } = {',
    ...Object.entries(manifest.volumes ?? {}).map(([kind, variants]) =>
      `	${kind} = { ${variants.map(files => `{ ${files.map(f => id(f)).join(', ')} }`).join(', ')} },`),
    '}',
    '',
    'return table.freeze({',
    '	tornadoes = table.freeze(tornadoes),',
    '	volumes = table.freeze(volumes),',
    '	clouds = table.freeze({',
    ...Object.entries(manifest.clouds ?? {}).map(([kind, c]) => `		${kind} = table.freeze({ image = ${id(c.file)}, grid = ${c.grid} }),`),
    '	}),',
    '})',
    '',
  );
  writeFileSync(OUT_LUAU, lines.join('\n'));
}

async function main() {
  const [command = 'check', dirArg] = process.argv.slice(2);
  const key = readKey();
  const info = await introspect(key);
  const scopes = (info.scopes ?? []).map(s => `${s.name}: ${(s.operations ?? []).join(', ')}`);
  const owner = info.authorizedUserId;
  if (command === 'check') {
    console.log(`key "${info.name}" for user ${owner}; enabled ${info.enabled}, expired ${info.expired}`);
    for (const s of scopes) console.log(`  ${s}`);
    return;
  }
  if (!owner) throw new Error('the key has no owning user (group keys are not supported here)');
  if (command === 'model') {
    const [file, out] = process.argv.slice(3);
    if (!file || !out) throw new Error('usage: model <file.fbx|.glb> <out.rbxm>');
    const modelId = await uploadModel(key, owner, path.resolve(file), `WeatherWorld ${path.basename(file).replace(/\.\w+$/, '')}`);
    writeFileSync(out, await downloadModel(key, modelId));
    console.log(`${file}: model ${modelId} -> ${out}`);
    return;
  }
  if (command !== 'upload') throw new Error(`unknown command ${command}`);
  const dir = path.resolve(dirArg ?? path.join(ROBLOX, 'Textures', 'build'));
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const record = existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, 'utf8')) : {};
  const files = [
    ...Object.values(manifest.tornadoes ?? {}).flatMap(t => t.views.map(v => t.files[v])),
    ...Object.values(manifest.clouds ?? {}).map(c => c.file),
    ...Object.values(manifest.volumes ?? {}).flat(2),
  ];
  const ids = {};
  for (const file of files) {
    const full = path.join(dir, file);
    const hash = createHash('sha256').update(readFileSync(full)).digest('hex');
    if (record[hash]) {
      ids[file] = record[hash];
      console.log(`${file}: already uploaded (${record[hash]})`);
      continue;
    }
    if (file.endsWith('.glb')) {
      const modelId = await uploadModel(key, owner, full, `WeatherWorld ${path.basename(file, '.glb')}`);
      const meshId = await meshIdOf(key, modelId);
      record[hash] = meshId;
      ids[file] = meshId;
      writeFileSync(RECORD, JSON.stringify(record, null, 2));
      console.log(`${file}: model ${modelId}, mesh ${meshId}`);
      continue;
    }
    const assetId = await uploadDecal(key, owner, full, `WeatherWorld ${file.replace(/\.png$/, '')}`);
    const imageId = await imageIdOf(key, assetId);
    record[hash] = imageId;
    ids[file] = imageId;
    writeFileSync(RECORD, JSON.stringify(record, null, 2));
    console.log(`${file}: decal ${assetId}, image ${imageId}`);
  }
  writeLuau(manifest, ids);
  console.log(`wrote ${path.relative(process.cwd(), OUT_LUAU)}`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
