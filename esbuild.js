const esbuild = require('esbuild');
const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const ctx = esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
});

(async () => {
  const c = await ctx;
  if (watch) await c.watch();
  else { await c.rebuild(); await c.dispose(); }
})();
