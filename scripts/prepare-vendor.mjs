import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';

// Only bundle the public RPC and injected-wallet APIs used by the console.
// Unused hosted-provider integrations and their default API identifiers stay out.
const result = await build({
  stdin: {
    contents: "export { BrowserProvider, JsonRpcProvider, FetchRequest, Contract, getAddress, ZeroAddress, Interface } from 'ethers';",
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
    sourcefile: 'zypto-ethers-entry.js',
  },
  outfile: fileURLToPath(new URL('../dist/ethers.js', import.meta.url)),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  treeShaking: true,
  minify: true,
  legalComments: 'eof',
  metafile: true,
  banner: { js: '/*! Third-party license notices: ethers.LICENSE.txt */' },
});
const packages = new Set(Object.keys(result.metafile.inputs).filter(path => path.startsWith('node_modules/')).map(path => {
  const parts = path.slice('node_modules/'.length).split('/');
  return parts[0].startsWith('@') ? parts.slice(0,2).join('/') : parts[0];
}));
const notices = [...packages].sort().map(name => {
  const root = new URL('../node_modules/' + name + '/', import.meta.url);
  const license = ['LICENSE.md','LICENSE','LICENSE.txt'].map(file => new URL(file,root)).find(file => existsSync(file));
  if (!license) throw Error('Missing third-party license for ' + name);
  return name + '\n\n' + readFileSync(license,'utf8');
}).join('\n\n--------------------\n\n');
writeFileSync(new URL('../dist/ethers.LICENSE.txt',import.meta.url),notices);
console.log('Prepared minimal ethers 6.13.5 browser dependency.');
