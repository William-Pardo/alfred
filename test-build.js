const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

try {
  execSync('npm run build', { stdio: 'inherit', cwd: __dirname });
} catch (e) {
  console.error('Build failed');
  process.exit(1);
}

const bundlePath = path.join(__dirname, 'dist', 'bundle.js');

if (!fs.existsSync(bundlePath)) {
  console.error('Bundle file not found after build');
  process.exit(1);
}

const stats = fs.statSync(bundlePath);
const sizeInBytes = stats.size;

if (sizeInBytes > 300 * 1024) {
  console.error(`Bundle size ${sizeInBytes} bytes exceeds 300KB limit`);
  process.exit(1);
