const { buildSpots, buildMapFile } = require('./build-parking-map');

if (require.main === module) {
    try {
        const spots = buildMapFile(1, process.argv.includes('--replace'));
        console.log(`第1駐車場の${spots.length}枠を生成しました。`);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = { buildSpots };
