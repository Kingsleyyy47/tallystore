import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sizes = [
  { size: 192, name: 'icon-192x192.png' },
  { size: 512, name: 'icon-512x512.png' },
  { size: 180, name: 'apple-touch-icon.png' },
  { size: 192, name: 'icon-maskable-192x192.png', maskable: true },
  { size: 512, name: 'icon-maskable-512x512.png', maskable: true },
];

const inputPath = path.join(__dirname, '../public/TALLYAPPLOGO.png');
const outputDir = path.join(__dirname, '../public');

async function generateIcons() {
  console.log('🎨 Generating PWA icons from TALLYAPPLOGO.png...\n');

  for (const { size, name, maskable } of sizes) {
    try {
      let pipeline = sharp(inputPath).resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      });

      // For maskable icons, add safe zone padding (80% of canvas)
      if (maskable) {
        const paddedSize = Math.round(size * 0.8);
        pipeline = sharp(inputPath).resize(paddedSize, paddedSize, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        }).extend({
          top: Math.round((size - paddedSize) / 2),
          bottom: Math.round((size - paddedSize) / 2),
          left: Math.round((size - paddedSize) / 2),
          right: Math.round((size - paddedSize) / 2),
          background: { r: 139, g: 92, b: 246, alpha: 1 } // Purple background for maskable
        });
      }

      await pipeline.png().toFile(path.join(outputDir, name));
      console.log(`✅ Generated: ${name} (${size}x${size})`);
    } catch (error) {
      console.error(`❌ Failed to generate ${name}:`, error.message);
    }
  }

  console.log('\n🎉 All icons generated successfully!');
}

generateIcons();
