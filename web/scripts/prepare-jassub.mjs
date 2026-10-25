/**
 * Prepara o JASSUB pra ser servido como estático em /jassub/.
 *
 * O worker do JASSUB importa pacotes por nome (abslink, lfa-ponyfill), então não
 * dá pra só copiar a pasta: precisa empacotar. E o builder do Angular não empacota
 * o `new Worker(new URL(...))` que está dentro do node_modules. Então este script
 * gera o worker com o esbuild (que já vem com o @angular/build) e copia os .wasm
 * e a fonte padrão. Roda sozinho antes do `npm start` e do `npm run build`.
 */
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'node_modules', 'jassub', 'dist');
const out = join(root, 'public', 'jassub');

mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(dist, 'worker', 'worker.js')],
  outfile: join(out, 'worker.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  logLevel: 'warning',
});

for (const [from, to] of [
  ['wasm/jassub-worker.wasm', 'jassub-worker.wasm'],
  ['wasm/jassub-worker-modern.wasm', 'jassub-worker-modern.wasm'],
  ['default.woff2', 'default.woff2'],
]) {
  copyFileSync(join(dist, from), join(out, to));
}

console.log('jassub pronto em public/jassub/');
