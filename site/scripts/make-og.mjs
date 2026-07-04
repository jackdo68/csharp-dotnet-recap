// Renders the social-card (Open Graph) image from og-source.svg → public/og.png.
// Run with: npm run og
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(__dirname, 'og-source.svg');
const out = path.join(__dirname, '..', 'public', 'og.png');

const svg = readFileSync(src);
await sharp(svg, { density: 144 })
  .resize(1200, 630)
  .png()
  .toFile(out);

console.log('Wrote', path.relative(path.join(__dirname, '..'), out));
