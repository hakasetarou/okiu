const { buildMapFile } = require('./build-parking-map');
const fs = require('node:fs');
const path = require('node:path');
const { buildDisplayImage } = require('./build-parking-display-image');

if (require.main === module) {
    try {
        const spots = buildMapFile(2, process.argv.includes('--replace'));
        const root = path.resolve(__dirname, '..');
        const spec = JSON.parse(fs.readFileSync(path.join(root, 'docs/lot-2-map-rows.json'), 'utf8'));
        const displayImage = buildDisplayImage(spec, fs.readFileSync(path.join(root, spec.image)));
        fs.writeFileSync(path.join(root, spec.displayImage), displayImage);
        console.log(`第2駐車場の${spots.length}枠と表示用地図を生成しました。`);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = { buildDisplayImage };
