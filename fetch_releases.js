import https from 'https';

https.get('https://api.github.com/repos/MercuryWorkshop/scramjet/releases', {
  headers: { 'User-Agent': 'Node.js' }
}, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    console.log(data);
  });
});
