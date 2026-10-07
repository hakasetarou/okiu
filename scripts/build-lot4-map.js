const { buildMapFile } = require('./build-parking-map');

try {
    const spots = buildMapFile(4, process.argv.includes('--replace'));
    console.log(`第4駐車場の${spots.length}枠を生成しました。`);
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
