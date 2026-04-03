import https from 'https';
import fs from 'fs';

const files = [
  'scramjet.bundle.js',
  'scramjet.client.js',
  'scramjet.codecs.js',
  'scramjet.config.js',
  'scramjet.worker.js'
];

fs.mkdirSync('public/scram', { recursive: true });

files.forEach(file => {
  https.get(`https://unpkg.com/@mercuryworkshop/scramjet@1.0.2/dist/${file}`, (res) => {
    if (res.statusCode === 302) {
      https.get(res.headers.location, (res2) => {
        res2.pipe(fs.createWriteStream(`public/scram/${file}`));
      });
    } else {
      res.pipe(fs.createWriteStream(`public/scram/${file}`));
    }
  });
});
