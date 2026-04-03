export const nexusConfig = {
  prefix: '/nexus/',
  wispPath: '/wisp/',
  port: 3000,
  encodeUrl: (url: string) => {
    if (!url) return url;
    const xored = url.split('').map((char, i) => i % 2 ? String.fromCharCode(char.charCodeAt(0) ^ 2) : char).join('');
    return Buffer.from(xored).toString('base64').replace(/\//g, '_').replace(/\+/g, '-').replace(/=/g, '');
  },
  decodeUrl: (url: string) => {
    if (!url) return url;
    try {
      let str = url.replace(/_/g, '/').replace(/-/g, '+');
      while (str.length % 4) str += '=';
      const decoded = Buffer.from(str, 'base64').toString('utf-8');
      return decoded.split('').map((char, i) => i % 2 ? String.fromCharCode(char.charCodeAt(0) ^ 2) : char).join('');
    } catch (e) {
      return url;
    }
  }
};
