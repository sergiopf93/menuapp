import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const output = new URL('dist/', root);
await rm(output, { recursive: true, force: true });
await mkdir(output);
// Allowlist: server code, credentials, tests and local data are never published as assets.
for (const name of ['index.html','manifest.json','service-worker.js','js','css','assets','data']) {
  await cp(new URL(name, root), new URL(name, output), { recursive: true });
}
await writeFile(new URL('js/auth-config.js', output), 'globalThis.MENUAPP_SERVER_AUTH = true;\n');
console.log(`Assets preparados en ${fileURLToPath(output)}`);
