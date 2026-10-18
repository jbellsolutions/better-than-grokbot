// Node 24+: npm run brand:render. All artwork comes from the fork's editable SVG sources.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { mascotSvg, PICTURE_COLORS, PICTURE_SHAPES } from '../lib/mascot.ts';

const mark = readFileSync('assets/icon.svg');
for (const [file, size] of [['desktop/icon.png', 1024], ['site/apple-touch-icon.png', 180]]) {
  await sharp(mark).resize(size, size).png().toFile(file);
}
const icons = [];
for (const size of [16, 32, 48]) icons.push({ size, data: await sharp(mark).resize(size, size).png().toBuffer() });
const header = Buffer.alloc(6 + 16 * icons.length);
header.writeUInt16LE(1, 2); header.writeUInt16LE(icons.length, 4);
let offset = header.length;
for (const [i, { size, data }] of icons.entries()) {
  const at = 6 + 16 * i;
  header[at] = size; header[at + 1] = size;
  header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(data.length, at + 8); header.writeUInt32LE(offset, at + 12);
  offset += data.length;
}
writeFileSync('app/favicon.ico', Buffer.concat([header, ...icons.map(i => i.data)]));
const jobs = [{ name: 'main-0A0A0A', id: 'boppy', color: '#0A0A0A' },
  ...PICTURE_COLORS.map(color => ({ name: `blob-${color.slice(1)}`, id: 'bot', color })),
  ...Object.entries(PICTURE_SHAPES).map(([id, color]) => ({ name: `${id}-${color.slice(1)}`, id, color }))];
for (const base of ['edge/public', 'cloud/public']) {
  mkdirSync(`${base}/mascot`, { recursive: true }); mkdirSync(`${base}/brand`, { recursive: true });
  for (const job of jobs) {
    const svg = Buffer.from(mascotSvg(job.id, job.color, 512));
    await sharp(svg).png().toFile(`${base}/mascot/${job.name}.png`);
    await sharp(svg).flatten({ background: '#FDFFF6' }).jpeg({ quality: 92 }).toFile(`${base}/mascot/${job.name}.jpg`);
  }
  for (const size of [512, 1024]) await sharp(mark).resize(size, size).png().toFile(`${base}/brand/bops-${size}.png`);
}
mkdirSync('.scratch/brand.iconset', { recursive: true });
for (const size of [16, 32, 128, 256, 512]) {
  await sharp(mark).resize(size, size).png().toFile(`.scratch/brand.iconset/icon_${size}x${size}.png`);
  await sharp(mark).resize(size * 2, size * 2).png().toFile(`.scratch/brand.iconset/icon_${size}x${size}@2x.png`);
}
console.log(`Rendered desktop/web icons and ${jobs.length} agent pictures for both servers. On macOS run: iconutil -c icns .scratch/brand.iconset -o desktop/icon.icns`);
