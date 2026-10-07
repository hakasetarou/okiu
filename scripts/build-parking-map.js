// 各駐車場の測定値から、共通形式の番号付き座標ファイルを生成する。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateSpots } = require('../public/parking-map-data');

function buildSpots(spec) {
    const spots = [];
    const between = (a, b, fraction) => a.map((value, index) => value + (b[index] - value) * fraction);
    for (const row of spec.rows) {
        if (row.startId !== spots.length + 1 || row.endId !== row.startId + row.count - 1) {
            throw new Error(`${row.name}: 枠番号と台数が一致していません。`);
        }
        if (row.polygons ? row.polygons.length !== row.count :
            !row.corners && (!row.separators || row.separators.length !== row.count + 1)) {
            throw new Error(`${row.name}: 枠線の位置を確認してください。`);
        }
        if (row.reverse !== undefined && typeof row.reverse !== 'boolean') {
            throw new Error(`${row.name}: 番号の向きを確認してください。`);
        }
        for (let index = 0; index < row.count; index++) {
            // 両面の列は端で折り返し、隣の列へ連番をつなぐ。座標の形は変えない。
            const position = row.reverse ? row.count - 1 - index : index;
            const corners = row.corners;
            let polygon = row.polygons ? row.polygons[position] : corners ? [
                between(corners[0], corners[1], position / row.count),
                between(corners[0], corners[1], (position + 1) / row.count),
                between(corners[3], corners[2], (position + 1) / row.count),
                between(corners[3], corners[2], position / row.count)
            ] : [
                row.separators[position][0], row.separators[position + 1][0],
                row.separators[position + 1][1], row.separators[position][1]
            ];
            const center = polygon.reduce((sum, point) => [sum[0] + point[0] / polygon.length, sum[1] + point[1] / polygon.length], [0, 0]);
            // 枠線に重ならないよう少し内側へ寄せ、画像に対する百分率にする。
            polygon = polygon.map(point => [
                Number((100 * (center[0] + (point[0] - center[0]) * spec.insetScale) / spec.width).toFixed(3)),
                Number((100 * (center[1] + (point[1] - center[1]) * spec.insetScale) / spec.height).toFixed(3))
            ]);
            const id = row.startId + index;
            spots.push({ id, name: String(id), polygon });
        }
    }
    if (spots.length !== spec.capacity) throw new Error('収容台数と座標数が一致していません。');
    return validateSpots(spots, spec.capacity);
}

function buildMapFile(lotId, replace = false) {
    if (![1, 2, 3, 4, 5, 7].includes(lotId)) throw new Error('対象外の駐車場です。');
    const root = path.resolve(__dirname, '..');
    const spec = JSON.parse(fs.readFileSync(path.join(root, `docs/lot-${lotId}-map-rows.json`), 'utf8'));
    const image = fs.readFileSync(path.join(root, spec.image));
    if (crypto.createHash('sha256').update(image).digest('hex') !== spec.imageSha256) {
        throw new Error('地図画像が変更されています。測定値を確認してから生成してください。');
    }
    const spots = buildSpots(spec);
    const output = path.join(root, `public/data/parking-spots/lot-${lotId}.json`);
    const current = JSON.parse(fs.readFileSync(output, 'utf8'));
    if (current.length && JSON.stringify(current) !== JSON.stringify(spots) && !replace) {
        throw new Error('既存の座標が編集されています。上書きする場合は --replace を指定してください。');
    }
    fs.writeFileSync(output + '.tmp', JSON.stringify(spots, null, 2) + '\n');
    fs.renameSync(output + '.tmp', output);
    return spots;
}

module.exports = { buildSpots, buildMapFile };
