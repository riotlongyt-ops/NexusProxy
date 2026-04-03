const https = require('https');
const fs = require('fs');
const zlib = require('zlib');
const tar = require('tar');

fs.mkdirSync('/scramjet-repo', { recursive: true });

https.get('https://github.com/MercuryWorkshop/scramjet/archive/refs/heads/main.tar.gz', (res) => {
  if (res.statusCode === 302) {
    https.get(res.headers.location, (res2) => {
      res2.pipe(zlib.createGunzip()).pipe(tar.x({ cwd: '/scramjet-repo', strip: 1 })).on('finish', () => {
        console.log('Extracted to /scramjet-repo');
      });
    });
  } else {
    res.pipe(zlib.createGunzip()).pipe(tar.x({ cwd: '/scramjet-repo', strip: 1 })).on('finish', () => {
      console.log('Extracted to /scramjet-repo');
    });
  }
});
