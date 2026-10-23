const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
fs.copyFileSync(path.join(root,'js/core/ledger.js'),path.join(root,'functions/ledger.mjs'));
