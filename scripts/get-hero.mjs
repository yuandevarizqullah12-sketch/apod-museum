// Downloads the hero photo from Wikimedia Commons into assets/images/hero-space.jpg and validates it.
// File page: https://commons.wikimedia.org/wiki/File:Center_of_the_Milky_Way_Galaxy_IV_–_Composite.jpg
// Author: NASA/JPL-Caltech/ESA/CXC/STScI. License: public domain (NASA). Confirm on the Commons page.
import { writeFileSync, mkdirSync } from 'node:fs';
const name = 'Center_of_the_Milky_Way_Galaxy_IV_–_Composite.jpg';
const url = 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(name) + '?width=2400';
const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'NASA-APOD-Museum/1.0 (educational project)' } });
if (!r.ok) throw new Error('Download failed: HTTP ' + r.status);
const b = Buffer.from(await r.arrayBuffer());
if (b[0] !== 0xff || b[1] !== 0xd8 || b.length < 50000) throw new Error('Not a valid JPEG (' + b.length + ' bytes)');
mkdirSync('assets/images', { recursive: true });
writeFileSync('assets/images/hero-space.jpg', b);
console.log('Saved assets/images/hero-space.jpg', b.length, 'bytes');
