import https from 'https';

https.get('https://docs.titaniumnetwork.org/proxies/scramjet/', (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    console.log(data);
  });
});
