import https from 'https';

https.get('https://unpkg.com/@mercuryworkshop/scramjet@1.0.2/?meta', (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    console.log(data);
  });
});
