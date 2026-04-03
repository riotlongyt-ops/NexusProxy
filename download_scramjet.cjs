const https = require('https');
const fs = require('fs');
const zlib = require('zlib');
const tar = require('tar');

fs.mkdirSync('./scramjet-pkg', { recursive: true });

https.get('https://registry.npmjs.org/@mercuryworkshop/scramjet/-/scramjet-1.0.2.tgz', (res) => {
  res.pipe(zlib.createGunzip()).pipe(tar.x({ cwd: './scramjet-pkg' })).on('finish', () => {
    console.log('Extracted to ./scramjet-pkg/package');
  });
});
