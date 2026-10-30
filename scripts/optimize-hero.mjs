// Usage: npm i --no-save sharp && node scripts/optimize-hero.mjs
// Makes hero-640/1280/1920.webp from assets/images/hero-space.jpg and shrinks the JPG fallback to 1920px.
import sharp from 'sharp';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
const dir = 'assets/images/', src = readFileSync(dir + 'hero-space.jpg');
for (const w of [640, 1280, 1920]) {
  await sharp(src).resize({ width: w, height: Math.round(w / 2), fit: 'cover', withoutEnlargement: true }).webp({ quality: 72 }).toFile(`${dir}hero-${w}.webp`);
  console.log(`hero-${w}.webp`, statSync(`${dir}hero-${w}.webp`).size, 'bytes');
}
writeFileSync(dir + 'hero-space.jpg', await sharp(src).resize({ width: 1920, withoutEnlargement: true }).jpeg({ quality: 75, mozjpeg: true }).toBuffer());
console.log('hero-space.jpg (fallback)', statSync(dir + 'hero-space.jpg').size, 'bytes');
