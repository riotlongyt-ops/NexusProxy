const https = require('https');
const fs = require('fs');
const zlib = require('zlib');
const tar = require('tar');

https.get('https://registry.npmjs.org/@mercuryworkshop/scramjet/-/scramjet-1.0.2.tgz', (res) => {
  res.pipe(zlib.createGunzip()).pipe(tar.x({ cwd: '/tmp' })).on('finish', () => {
    console.log('Extracted to /tmp/package');
  });
});
