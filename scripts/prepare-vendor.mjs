import { copyFileSync, mkdirSync } from 'node:fs';

// Restore the browser dependency locally; generated third-party code is ignored.
mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
copyFileSync(
  new URL('../node_modules/ethers/dist/ethers.min.js', import.meta.url),
  new URL('../dist/ethers.js', import.meta.url),
);
console.log('Prepared ethers 6.13.5 browser dependency.');
