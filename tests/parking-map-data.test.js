const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { lotIds, spotFile, validateSpots, rowSpots } = require('../public/parking-map-data');
const { buildSpots } = require('../scripts/build-lot1-map');

test('seventh-lot provisional map has 104 consecutive bays including the two added areas without overlaps', () => {
    const spots = validateSpots(JSON.parse(fs.readFileSync('public/data/parking-spots/lot-7.json', 'utf8')), 104);
    const numbering = JSON.parse(fs.readFileSync('docs/lot-7-renumbering-v2.json', 'utf8'));
    const numberMap = new Map(numbering.mappings.map(row => [row.oldNumber, row.newNumber]));
    assert.deepEqual(spots.map(spot => spot.id), Array.from({ length: 104 }, (_, i) => i + 1));
    function contains(polygon, [x, y]) {
        const point = [100 * x / 951, 100 * y / 765];
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const a = polygon[i], b = polygon[j];
            if ((a[1] > point[1]) !== (b[1] > point[1]) &&
                point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
        }
        return inside;
    }
    for (const [id, point] of [[1,[198,721]], [7,[349,641]], [8,[148,621]], [12,[94,519]],
        [13,[82,461]], [17,[112,351]], [18,[112,310]], [21,[94,227]], [22,[307,201]],
        [29,[505,195]], [30,[590,53]], [38,[744,177]], [39,[516,130]], [45,[631,222]],
        [46,[604,256]], [49,[546,212]], [50,[268,258]], [60,[399,520]], [61,[207,458]],
        [65,[261,560]], [66,[434,329]], [74,[550,522]], [75,[600,493]], [82,[498,323]],
        [83,[662,352]], [90,[777,514]], [91,[887,648]], [102,[494,639]]]) {
        assert.ok(contains(spots[numberMap.get(id) - 1].polygon, point), `old ${id} position`);
    }
    assert.ok(contains(spots[21].polygon, [261,203]));
    assert.ok(contains(spots[22].polygon, [262,226]));
    // 通路、矢印、曲がり角のすき間、小さな三角形はクリックできる枠に含めない。
    for (const point of [[609,370], [665,558], [468,580], [389,290], [410,550],
        [775,178], [190,750], [107,333], [90,210], [150,15]]) {
        assert.equal(spots.some(spot => contains(spot.polygon, point)), false, `${point}`);
    }
    function overlaps(a, b) {
        return [a, b].every(polygon => polygon.every((p, i) => {
            const next = polygon[(i + 1) % polygon.length];
            const nx = p[1] - next[1], ny = next[0] - p[0];
            const project = shape => shape.map(v => v[0] * nx + v[1] * ny);
            const pa = project(a), pb = project(b);
            return Math.max(...pa) > Math.min(...pb) && Math.max(...pb) > Math.min(...pa);
        }));
    }
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
        assert.equal(overlaps(spots[i].polygon, spots[j].polygon), false, `spots ${i + 1}/${j + 1}`);
    }
});

test('seventh-lot area numbering preserves every existing polygon and connects the added bays to the inner column', () => {
    const spec = JSON.parse(fs.readFileSync('docs/lot-7-map-rows.json', 'utf8'));
    const previous = buildSpots(JSON.parse(fs.readFileSync('docs/lot-7-map-rows-v1.json', 'utf8')));
    const spots = buildSpots(spec);
    const numbering = JSON.parse(fs.readFileSync('docs/lot-7-renumbering-v2.json', 'utf8'));
    assert.deepEqual(spots, JSON.parse(fs.readFileSync('public/data/parking-spots/lot-7.json', 'utf8')));
    assert.equal(numbering.layoutVersion, spec.layoutVersion);
    assert.equal(numbering.mappings.length, previous.length);
    assert.equal(new Set(numbering.mappings.map(row => row.oldNumber)).size, 102);
    assert.equal(new Set(numbering.mappings.map(row => row.newNumber)).size, 102);
    for (const { oldNumber, newNumber } of numbering.mappings) {
        assert.deepEqual(spots[newNumber - 1].polygon, previous[oldNumber - 1].polygon, `old ${oldNumber} -> new ${newNumber}`);
    }
    const mapped = new Set(numbering.mappings.map(row => row.newNumber));
    assert.deepEqual(spots.filter(spot => !mapped.has(spot.id)).map(spot => spot.id), [22, 23]);
    assert.deepEqual(numbering.addedNumbers, [22, 23]);
    assert.deepEqual(spec.areas.map(area => [area.startId, area.endId]), [
        [1,7], [8,21], [22,34], [35,42], [43,51], [52,62], [63,67], [68,84], [85,92], [93,104]
    ]);
    const center = id => spots[id - 1].polygon.reduce((sum, point) => [sum[0] + point[0] / 4, sum[1] + point[1] / 4], [0,0]);
    const distance = (a,b) => Math.hypot(...center(a).map((value,i) => value - center(b)[i]));
    assert.ok(center(22)[1] < center(23)[1] && center(23)[1] < center(24)[1]);
    assert.ok(distance(23,24) < distance(23,35));
    // Both paired islands turn back at the end instead of jumping across the aisle.
    for (const [start, turn, end] of [[52,58,62], [68,76,84]]) {
        for (let id = start; id < turn; id++) assert.ok(center(id)[0] < center(id + 1)[0]);
        for (let id = turn + 1; id < end; id++) assert.ok(center(id)[0] > center(id + 1)[0]);
        assert.ok(distance(turn,turn + 1) < distance(start,turn + 1));
    }
});

test('seventh-lot display image retains the original diagram and marks the provisional capacity', () => {
    const svg = fs.readFileSync('public/images/img7-system.svg', 'utf8');
    const embedded = /href="data:image\/jpeg;base64,([A-Za-z0-9+/=]+)"/.exec(svg);
    assert.ok(embedded);
    assert.deepEqual(Buffer.from(embedded[1], 'base64'), fs.readFileSync('public/images/img7.jpg'));
    assert.ok(svg.includes('第7駐車場（暫定104台）'));
    assert.ok(svg.includes('viewBox="0 0 951 765"'));
    assert.ok(svg.includes('<rect x="0" y="0" width="360" height="30" fill="white"/>'));
    const spots = JSON.parse(fs.readFileSync('public/data/parking-spots/lot-7.json', 'utf8'));
    for (const spot of spots) {
        assert.ok(spot.polygon.every(([x,y]) => x * 951 / 100 > 360 || y * 765 / 100 > 30));
    }
});

test('fourth-lot map covers 78 consecutive bays, folds paired rows, and excludes roads', () => {
    const spots = validateSpots(JSON.parse(fs.readFileSync('public/data/parking-spots/lot-4.json', 'utf8')), 78);
    assert.deepEqual(spots.map(spot => spot.id), Array.from({ length: 78 }, (_, i) => i + 1));
    function contains(polygon, [x, y]) {
        const point = [100 * x / 930, 100 * y / 756];
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const a = polygon[i], b = polygon[j];
            if ((a[1] > point[1]) !== (b[1] > point[1]) &&
                point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
        }
        return inside;
    }
    for (const [id, point] of [[1,[410.4,722.8]], [13,[193.6,402.1]], [14,[245.3,291.5]],
        [23,[446.6,81.4]], [24,[519.6,164.2]], [29,[668,266.5]], [31,[615,303.5]],
        [32,[459.9,256.8]], [41,[625.3,495.9]], [42,[586.6,522.6]], [51,[421.1,283.5]],
        [52,[349.6,372.4]], [60,[498.4,583.8]], [61,[459.9,610.4]], [69,[311,399]],
        [70,[756.6,341.2]], [73,[675.9,394.9]], [74,[702.5,433.5]], [78,[810.2,362]]]) {
        assert.ok(contains(spots[id - 1].polygon, point), `${id} position`);
    }
    for (const point of [[400,200], [600,350], [600,620], [865,162], [150,15]]) {
        assert.equal(spots.some(spot => contains(spot.polygon, point)), false);
    }
    function overlaps(a, b) {
        return [a, b].every(polygon => polygon.every((p, i) => {
            const next = polygon[(i + 1) % polygon.length];
            const nx = p[1] - next[1], ny = next[0] - p[0];
            const project = shape => shape.map(v => v[0] * nx + v[1] * ny);
            const pa = project(a), pb = project(b);
            return Math.max(...pa) > Math.min(...pb) && Math.max(...pb) > Math.min(...pa);
        }));
    }
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
        assert.equal(overlaps(spots[i].polygon, spots[j].polygon), false, `spots ${i + 1}/${j + 1}`);
    }
});

test('third-lot provisional map has 706 consecutive non-overlapping bays including the split and additions', () => {
    const spots = validateSpots(JSON.parse(fs.readFileSync('public/data/parking-spots/lot-3.json', 'utf8')), 706);
    assert.deepEqual(spots.map(spot => spot.id), Array.from({ length: 706 }, (_, i) => i + 1));
    function contains(polygon, [x, y]) {
        const point = [100 * x / 923, 100 * y / 790];
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const a = polygon[i], b = polygon[j];
            if ((a[1] > point[1]) !== (b[1] > point[1]) &&
                point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
        }
        return inside;
    }
    for (const [id, point] of [[586,[759.42,500.73]], [587,[763.30,507.53]],
        [588,[766.75,514.59]], [589,[770.57,521.57]]]) {
        assert.equal(spots.filter(spot => contains(spot.polygon, point)).length, 1);
        assert.ok(contains(spots[id - 1].polygon, point));
    }
    // 小さな三角形や通路の位置を駐車枠として扱わない。
    for (const point of [[325,142], [549,104], [599,313]]) {
        assert.equal(spots.some(spot => contains(spot.polygon, point)), false);
    }
    function overlaps(a, b) {
        return [a, b].every(polygon => polygon.every((p, i) => {
            const next = polygon[(i + 1) % polygon.length];
            const nx = -(next[1] - p[1]), ny = next[0] - p[0];
            const project = shape => shape.map(v => v[0] * nx + v[1] * ny);
            const pa = project(a), pb = project(b);
            return Math.max(...pa) > Math.min(...pb) && Math.max(...pb) > Math.min(...pa);
        }));
    }
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
        assert.equal(overlaps(spots[i].polygon, spots[j].polygon), false, `spots ${spots[i].id}/${spots[j].id}`);
    }
});

test('third-lot display image retains the source diagram and marks the provisional capacity', () => {
    const svg = fs.readFileSync('public/images/img3-system.svg', 'utf8');
    const embedded = /href="data:image\/jpeg;base64,([A-Za-z0-9+/=]+)"/.exec(svg);
    assert.ok(embedded);
    assert.deepEqual(Buffer.from(embedded[1], 'base64'), fs.readFileSync('public/images/img3.jpg'));
    assert.ok(svg.includes('第3駐車場（暫定706台）'));
    assert.ok(svg.includes('viewBox="0 0 923 790"'));
    assert.ok(svg.includes('<rect x="0" y="0" width="475" height="30" fill="white"/>'));
    const spots = JSON.parse(fs.readFileSync('public/data/parking-spots/lot-3.json', 'utf8'));
    for (const spot of spots) {
        assert.ok(spot.polygon.every(([x,y]) => x * 923 / 100 > 475 || y * 790 / 100 > 30));
    }
});

test('second-lot map covers 205 bays and excludes the tree and triangular ends', () => {
    const spots = validateSpots(JSON.parse(fs.readFileSync('public/data/parking-spots/lot-2.json', 'utf8')), 205);
    assert.deepEqual(spots.map(spot => spot.id), Array.from({ length: 205 }, (_, i) => i + 1));
    function contains(polygon, imagePoint) {
        const point = [100 * imagePoint[0] / 823, 100 * imagePoint[1] / 777];
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const a = polygon[i], b = polygon[j];
            if ((a[1] > point[1]) !== (b[1] > point[1]) &&
                point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
        }
        return inside;
    }
    for (let i = 0; i < 9; i++) {
        assert.ok(contains(spots[145 + i].polygon, [528.33 + i * 12.667, 540.56 - i * 6.889]));
    }
    for (const [id, point] of [[1,[145,724]], [16,[326,647]], [175,[614.53,186.23]], [176,[600.35,160.43]], [205,[660,30]]]) {
        assert.ok(contains(spots[id - 1].polygon, point));
    }
    for (const point of [[220.2,608.95], [280.96,526.15], [326.17,452.91], [378.3,392.43],
        [423.66,319.1], [468.81,245.81], [567.3,236.53], [492.91,134.91], [672.11,103.83], [710,140], [607.5,173.4]]) {
        assert.equal(spots.some(spot => contains(spot.polygon, point)), false);
    }
    // Separating-axis check: two convex bay polygons must not have overlapping interiors.
    function overlaps(a, b) {
        return [a, b].every(polygon => polygon.every((p, i) => {
            const next = polygon[(i + 1) % polygon.length];
            const nx = -(next[1] - p[1]), ny = next[0] - p[0];
            const project = shape => shape.map(v => v[0] * nx + v[1] * ny);
            const pa = project(a), pb = project(b);
            return Math.max(...pa) > Math.min(...pb) && Math.max(...pb) > Math.min(...pa);
        }));
    }
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
        assert.equal(overlaps(spots[i].polygon, spots[j].polygon), false, `spots ${spots[i].id}/${spots[j].id}`);
    }
});

test('second-lot display image retains the original diagram and corrects only the caption area', () => {
    const svg = fs.readFileSync('public/images/img2-system.svg', 'utf8');
    const image = fs.readFileSync('public/images/img2.jpg');
    const embedded = /href="data:image\/jpeg;base64,([A-Za-z0-9+/=]+)"/.exec(svg);
    assert.ok(embedded);
    assert.deepEqual(Buffer.from(embedded[1], 'base64'), image);
    assert.ok(svg.includes('viewBox="0 0 823 777"'));
    assert.ok(svg.includes('第2駐車場（205台）'));
    assert.ok(svg.includes('<rect x="0" y="0" width="310" height="30" fill="white"/>'));
    const spots = JSON.parse(fs.readFileSync('public/data/parking-spots/lot-2.json', 'utf8'));
    for (const spot of spots) {
        assert.ok(spot.polygon.every(([x,y]) => x * 823 / 100 > 310 || y * 777 / 100 > 30));
    }
});

test('coordinate files exist for the six remaining lots', () => {
    assert.deepEqual(lotIds, [1, 2, 3, 4, 5, 7]);
    lotIds.forEach(id => validateSpots(JSON.parse(fs.readFileSync(`public${spotFile(id)}`, 'utf8'))));
    assert.throws(() => spotFile(6));
});

test('a rotated row is split along its length and keeps shared borders', () => {
    const corners = [[10, 10], [30, 30], [25, 35], [5, 15]];
    const spots = rowSpots(7, 2, corners);
    assert.deepEqual(spots.map(spot => spot.id), [7, 8]);
    assert.deepEqual(spots[0].polygon, [[10, 10], [20, 20], [15, 25], [5, 15]]);
    assert.deepEqual(spots[1].polygon, [[20, 20], [30, 30], [25, 35], [15, 25]]);
    assert.deepEqual(spots[0].polygon[1], spots[1].polygon[0]);
    assert.deepEqual(spots[0].polygon[2], spots[1].polygon[3]);
});

test('duplicate, out of image, zero area, and out of capacity coordinates are rejected', () => {
    const spot = { id: 1, polygon: [[10, 10], [20, 10], [20, 20], [10, 20]] };
    assert.throws(() => validateSpots([spot, spot]), /重複/);
    assert.throws(() => validateSpots([{ ...spot, id: 2 }], 1), /収容台数/);
    assert.throws(() => validateSpots([{ id: 1, polygon: [[-1, 0], [1, 0], [1, 1]] }]), /正しく/);
    assert.throws(() => validateSpots([{ id: 1, polygon: [[1, 1], [2, 2], [3, 3]] }]), /面積/);
    assert.throws(() => validateSpots([{ id: 1, polygon: [[0, 0], [20, 0], [0, 20], [30, 20]] }]), /交差/);
    assert.throws(() => rowSpots(1, 0, spot.polygon));
});

test('first-lot map keeps the confirmed bays and excludes all three removed areas', () => {
    const spots = validateSpots(buildSpots(JSON.parse(fs.readFileSync('docs/lot-1-map-rows.json', 'utf8'))), 530);
    assert.deepEqual(spots.map(spot => spot.id), Array.from({ length: 530 }, (_, index) => index + 1));
    function contains(polygon, imagePoint) {
        const point = [100 * imagePoint[0] / 1160, 100 * imagePoint[1] / 808];
        let inside = false;
        for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
            const a = polygon[index], b = polygon[previous];
            if ((a[1] > point[1]) !== (b[1] > point[1]) &&
                point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
        }
        return inside;
    }
    // 元画像上で、利用者が赤丸で指定した各枠の内側の位置。
    for (const [id, point] of [[103, [824, 260]], [133, [938, 274]], [242, [256, 416]]]) {
        assert.equal(contains(spots.find(spot => spot.id === id).polygon, point), true);
    }
    for (const point of [[873, 642], [967.5, 226], [679.23, 313.31]]) {
        assert.equal(spots.some(spot => contains(spot.polygon, point)), false);
    }
});

test('first-lot numbers are consecutive by area and turn at the end of paired rows', () => {
    const spec = JSON.parse(fs.readFileSync('docs/lot-1-map-rows.json', 'utf8'));
    const spots = buildSpots(spec);
    assert.deepEqual(spec.areas.map(area => [area.startId, area.endId]), [
        [1, 69], [70, 103], [104, 114], [115, 153], [154, 198],
        [199, 241], [242, 318], [319, 404], [405, 493], [494, 530]
    ]);
    const x = id => spots.find(spot => spot.id === id).polygon.reduce((sum, point) => sum + point[0] / 4, 0);
    // 中央上段は上の列を左→右、下の列を右→左へたどれる。
    for (let id = 243; id < 278; id++) assert.ok(x(id) < x(id + 1));
    assert.ok(Math.abs(x(278) - x(279)) < 1);
    for (let id = 279; id < 318; id++) assert.ok(x(id) > x(id + 1));
    // 右側上段の追加枠も、近くの列に組み込まれ、末尾へ飛ばない。
    assert.ok(Math.abs(x(132) - x(133)) < 3);
    assert.ok(Math.abs(x(133) - x(134)) < 3);
    for (let id = 134; id < 153; id++) assert.ok(x(id) > x(id + 1));
});
