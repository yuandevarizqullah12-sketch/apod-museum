// Usage: npm i --no-save sharp && node scripts/optimize-hero.mjs [source-image]
// Converts the source (default assets/images/hero-source.jpg) into the single hero file assets/images/hero-space.webp (1920x960).
import sharp from 'sharp';
import { statSync } from 'node:fs';
const src = process.argv[2] || 'assets/images/hero-source.jpg', out = 'assets/images/hero-space.webp';
await sharp(src).resize({ width: 1920, height: 960, fit: 'cover' }).webp({ quality: 72 }).toFile(out);
console.log(out, statSync(out).size, 'bytes');
