const { buildMapFile } = require('./build-parking-map');
const { buildDisplayImage } = require('./build-parking-display-image');
const fs = require('node:fs');
const path = require('node:path');

try {
    const spots = buildMapFile(7, process.argv.includes('--replace'));
    const root = path.resolve(__dirname, '..');
    const spec = JSON.parse(fs.readFileSync(path.join(root, 'docs/lot-7-map-rows.json'), 'utf8'));
    fs.writeFileSync(path.join(root, spec.displayImage), buildDisplayImage(spec, fs.readFileSync(path.join(root, spec.image))));
    console.log(`第7駐車場の暫定${spots.length}枠と表示用地図を生成しました。`);
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
