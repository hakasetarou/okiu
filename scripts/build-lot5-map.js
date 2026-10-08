const { buildMapFile } = require('./build-parking-map');

if (require.main === module) {
    try {
        const spots = buildMapFile(5, process.argv.includes('--replace'));
        console.log(`第5駐車場の既存${spots.length}枠を、番号を維持して生成しました。`);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
