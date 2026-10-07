// 第3駐車場の確認用データを作る。公開座標やDBには書き込まない。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildSpots } = require('./build-parking-map');

try {
    const root = path.resolve(__dirname, '..');
    const spec = JSON.parse(fs.readFileSync(path.join(root, 'docs/lot-3-map-review-rows.json'), 'utf8'));
    const source = fs.readFileSync(path.join(root, spec.image));
    if (crypto.createHash('sha256').update(source).digest('hex') !== spec.imageSha256) {
        throw new Error('元の地図画像が変更されています。候補の位置を確認してください。');
    }
    const spots = buildSpots(spec);
    fs.writeFileSync(path.join(root, 'docs/lot-3-map-review-coordinates.json'), JSON.stringify(spots, null, 2) + '\n');
    console.log(`第3駐車場の確認用領域候補${spots.length}個を生成しました（公開設定は${spec.systemCapacity}台のまま）。`);
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
