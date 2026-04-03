import https from 'https';

https.get('https://docs.titaniumnetwork.org/services/browsing/holy-unblocker/', (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    console.log(data);
  });
});
