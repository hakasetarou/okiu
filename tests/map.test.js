const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const { buildSpots } = require('../scripts/build-lot1-map');
// 第1駐車場は、公開前でも新しい測定値の地図をテストできるようにする。
const firstLotCoordinates = buildSpots(JSON.parse(fs.readFileSync('docs/lot-1-map-rows.json', 'utf8')));

function screen(fetchResponse, ImageClass = class {}, coordinates) {
    let notifications = [];
    let createdMaps = 0;
    const element = () => ({
        classList: { contains: () => false, add() {}, remove() {} },
        style: {}, dataset: {}, remove() {}, appendChild() {}, addEventListener() {}
    });
    const elements = new Map();
    const context = vm.createContext({
        document: {
            getElementById: id => {
                if (id === 'interactiveMapModal') return null;
                if (!elements.has(id)) elements.set(id, element());
                return elements.get(id);
            },
            addEventListener() {},
            createElement: () => { createdMaps++; return element(); },
            body: { appendChild() {} }
        },
        window: {}, console: { log() {}, error() {} },
        fetch: async url => {
            if (url.startsWith('/data/parking-spots/')) {
                return { ok: true, json: async () => coordinates === undefined
                    ? (url === '/data/parking-spots/lot-1.json' ? firstLotCoordinates : JSON.parse(fs.readFileSync(`public${url}`, 'utf8'))) : coordinates };
            }
            return fetchResponse;
        },
        Image: ImageClass,
        setTimeout() {}
    });
    vm.runInContext(fs.readFileSync('public/parking-map-data.js', 'utf8'), context);
    vm.runInContext(fs.readFileSync('public/script.js', 'utf8'), context);
    vm.runInContext('currentUser = { studentId: "test-a" };', context);
    vm.runInContext('parkingData = [{ id: 1, capacity: 530 }, { id: 2, capacity: 205 }, { id: 5, capacity: 61 }, { id: 3, capacity: 706 }, { id: 4, capacity: 78 }, { id: 7, capacity: 104 }];', context);
    context.showNotification = message => notifications.push(message);
    return { context, notifications, maps: () => createdMaps, elements };
}

test('failed status request never opens a green map', async () => {
    const page = screen({ ok: false, status: 500, json: async () => ({ message: 'Unavailable' }) });
    await page.context.openInteractiveMap(5, 'images/img5.jpg');
    assert.equal(page.maps(), 0);
    assert.ok(page.notifications.length);
    assert.equal(vm.runInContext('latestMapStatus', page.context), null);
});

test('occupied map spot cannot open registration; available spot can', async () => {
    const page = screen();
    vm.runInContext('latestMapStatus = { lotId: "5", spots: [{ lot_id: "5", spot_number: 1, status: "occupied" }] };', page.context);
    let registrations = 0;
    page.context.openEndTimeModal = () => registrations++;
    await page.context.handleSpotCheckIn(5, 1);
    assert.equal(registrations, 0);
    await page.context.handleSpotCheckIn(5, 2);
    assert.equal(registrations, 1);
});

test('missing coordinates show an explanation instead of an empty map', async () => {
    const page = screen(undefined, class {}, []);
    await page.context.openInteractiveMap(7, 'images/img7.jpg');
    assert.equal(page.maps(), 0);
    assert.ok(page.notifications.length);
});

test('missing image cancels the map and clears status used for registration', async () => {
    class BrokenImage {
        set src(value) { this.onerror(); }
    }
    const page = screen({ ok: true, json: async () => [] }, BrokenImage);
    await page.context.openInteractiveMap(5, 'images/missing.jpg');
    assert.equal(vm.runInContext('latestMapStatus', page.context), null);
    assert.ok(page.notifications.length);
});

test('spot 62 is excluded from registration for a 61-space lot', async () => {
    const page = screen();
    vm.runInContext('latestMapStatus = { lotId: "5", spots: [] };', page.context);
    let registrations = 0;
    page.context.openEndTimeModal = () => registrations++;
    await page.context.handleSpotCheckIn(5, 62);
    assert.equal(registrations, 0);
    await page.context.handleSpotCheckIn(5, 61);
    assert.equal(registrations, 1);
});

test('corrected map contains and renders exactly 61 consecutive spaces', async () => {
    class LoadedImage {
        set src(value) { this.onload(); }
    }
    const page = screen({ ok: true, json: async () => [] }, LoadedImage);
    let map;
    page.context.document.body.appendChild = element => { map = element; };
    await page.context.openInteractiveMap(5, 'images/img5.jpg');
    assert.equal((map.innerHTML.match(/class="spot-polygon"/g) || []).length, 61);
    assert.equal((map.innerHTML.match(/class="map-spot-number"/g) || []).length, 61);
    assert.ok(map.innerHTML.includes('id="spot-5-61"'));
    assert.ok(!map.innerHTML.includes('id="spot-5-62"'));
    const coordinates = JSON.parse(fs.readFileSync('public/data/parking-spots/lot-5.json', 'utf8'));
    assert.equal(coordinates.length, 61);
    assert.deepEqual(coordinates.map(spot => spot.id),
        Array.from({ length: 61 }, (_, index) => index + 1));
    const new22 = coordinates.find(spot => spot.id === 22);
    assert.equal(new22.name, '22');
    const last = coordinates[60];
    assert.equal(last.name, '61');
    assert.ok(map.innerHTML.includes('>61</text>'));
});

test('another lot uses its own coordinates and status instead of lot 5', async () => {
    class LoadedImage { set src(value) { this.onload(); } }
    const coordinates = [{ id: 1, polygon: [[10, 10], [20, 10], [20, 20], [10, 20]] }];
    const page = screen({ ok: true, json: async () => [{ lot_id: '3', spot_number: 1, status: 'occupied' }] }, LoadedImage, coordinates);
    let map;
    page.context.document.body.appendChild = element => { map = element; };
    await page.context.openInteractiveMap(3, 'images/img3.jpg');
    assert.ok(map.innerHTML.includes('id="spot-3-1"'));
    assert.ok(map.innerHTML.includes('rgba(231, 76, 60, 0.6)'));
    assert.ok(!map.innerHTML.includes('id="spot-5-'));
    assert.equal(vm.runInContext('latestMapStatus.lotId', page.context), '3');
});

test('only the current user parking space opens map checkout', async () => {
    const page = screen();
    vm.runInContext('myParkingInfo = { lot_id: "3", space_id: 1 }; latestMapStatus = { lotId: "3", spots: [{ lot_id: "3", spot_number: 1, status: "occupied" }] };', page.context);
    let checkouts = 0;
    let registrations = 0;
    page.context.openCheckoutModal = () => checkouts++;
    page.context.openEndTimeModal = () => registrations++;
    await page.context.handleSpotCheckIn(3, 1);
    assert.equal(checkouts, 1);
    await page.context.handleSpotCheckIn(3, 2);
    vm.runInContext('latestMapStatus = { lotId: "5", spots: [] };', page.context);
    await page.context.handleSpotCheckIn(5, 1);
    assert.equal(checkouts, 1);
    assert.equal(registrations, 0);
});

test('map checkout clears the users parking and closes the map with its stale status', async () => {
    class LoadedImage { set src(value) { this.onload(); } }
    const page = screen({ ok: true, json: async () => [{ lot_id: '5', spot_number: 61, status: 'occupied' }] }, LoadedImage);
    vm.runInContext('myParkingInfo = { lot_id: "5", space_id: 61 };', page.context);
    let map;
    let removed = false;
    page.context.document.body.appendChild = element => { map = element; map.remove = () => { removed = true; }; };
    await page.context.openInteractiveMap(5, 'images/img5.jpg');
    assert.ok(map.innerHTML.includes('自分の駐車枠'));
    assert.ok(map.innerHTML.includes('#f1c40f'));
    const originalGet = page.context.document.getElementById;
    page.context.document.getElementById = id => id === 'interactiveMapModal' ? map : originalGet(id);
    let checkout;
    page.context.apiRequest = async (url, options) => {
        if (url === '/api/parking/checkout') checkout = JSON.parse(options.body);
        return url === '/api/parking-data' ? [{ id: 5, capacity: 61, available: 61 }] : {};
    };
    page.context.refreshUI = () => {};
    page.context.displayMyParkingStatus = () => {};
    await page.context.executeCheckout();
    assert.deepEqual(checkout, { userId: 'test-a' });
    assert.equal(removed, true);
    assert.equal(vm.runInContext('myParkingInfo', page.context), null);
    assert.equal(vm.runInContext('latestMapStatus', page.context), null);
});

test('closing a map invalidates its status and cancels pending coordinate loading', async () => {
    const page = screen();
    let finish;
    page.context.fetch = () => new Promise(resolve => { finish = resolve; });
    const opening = page.context.openInteractiveMap(5, 'images/img5.jpg');
    page.context.closeInteractiveMap();
    finish({ ok: true, json: async () => JSON.parse(fs.readFileSync('public/data/parking-spots/lot-5.json', 'utf8')) });
    await opening;
    assert.equal(page.maps(), 0);
    assert.equal(vm.runInContext('latestMapStatus', page.context), null);
});

test('invalid coordinates never create clickable parking spaces', async () => {
    const page = screen({ ok: true, json: async () => [] }, class {}, [{ id: 62, polygon: [[0, 0], [1, 0], [1, 1]] }]);
    await page.context.openInteractiveMap(5, 'images/img5.jpg');
    assert.equal(page.maps(), 0);
    assert.ok(page.notifications.some(message => message.includes('収容台数')));
});

test('first lot renders all 530 numbered spots and supports map checkin and own-spot checkout', async () => {
    class LoadedImage { set src(value) { this.onload(); } }
    const page = screen({ ok: true, json: async () => [] }, LoadedImage);
    let map;
    page.context.document.body.appendChild = element => { map = element; };
    await page.context.openInteractiveMap(1, 'images/img1.jpg');
    assert.equal((map.innerHTML.match(/class="spot-polygon"/g) || []).length, 530);
    assert.equal((map.innerHTML.match(/class="map-spot-number"/g) || []).length, 530);
    assert.ok(map.innerHTML.includes('id="spot-1-530"'));
    assert.ok(!map.innerHTML.includes('id="spot-1-531"'));
    assert.ok(map.innerHTML.includes('第1駐車場：530台'));
    let registration;
    let checkouts = 0;
    page.context.openEndTimeModal = (lot, spot) => { registration = [lot, spot]; };
    page.context.openCheckoutModal = () => checkouts++;
    await page.context.handleSpotCheckIn(1, 530);
    assert.deepEqual(registration, [1, 530]);
    vm.runInContext('myParkingInfo = { lot_id: "1", space_id: 530 };', page.context);
    await page.context.handleSpotCheckIn(1, 530);
    assert.equal(checkouts, 1);
    await page.context.handleSpotCheckIn(1, 529);
    assert.equal(checkouts, 1);
});

test('checkin sends the correct layout version for each renumbered lot', async () => {
    const page = screen();
    const sent = [];
    page.context.apiRequest = async (url, options) => {
        if (url === '/api/parking/checkin') {
            const body = JSON.parse(options.body);
            sent.push(body);
            return { lot_id: String(body.lotId), space_id: body.spaceId };
        }
        return [];
    };
    page.context.refreshUI = () => {};
    page.context.displayMyParkingStatus = () => {};
    page.context.closeDetailModal = () => {};
    page.context.closeEndTimeModal = () => {};
    await page.context.processSpaceCheckin(1, 530, '未定');
    vm.runInContext('myParkingInfo = null;', page.context);
    await page.context.processSpaceCheckin(5, 61, '未定');
    vm.runInContext('myParkingInfo = null;', page.context);
    await page.context.processSpaceCheckin(2, 205, '未定');
    vm.runInContext('myParkingInfo = null;', page.context);
    await page.context.processSpaceCheckin(3, 706, '未定');
    vm.runInContext('myParkingInfo = null;', page.context);
    await page.context.processSpaceCheckin(4, 78, '未定');
    vm.runInContext('myParkingInfo = null;', page.context);
    await page.context.processSpaceCheckin(7, 104, '未定');
    assert.deepEqual(sent.map(body => [body.lotId, body.spaceId, body.layoutVersion]), [[1, 530, 4], [5, 61, 2], [2, 205, 2], [3, 706, 1], [4, 78, 1], [7, 104, 2]]);
});

test('provisional third lot renders 706 numbered spots with occupancy and map entry and exit', async () => {
    class LoadedImage { set src(value) { this.onload(); } }
    const page = screen({ ok: true, json: async () => [{ lot_id: '3', spot_number: 2, status: 'occupied' }] }, LoadedImage);
    let map;
    page.context.document.body.appendChild = element => { map = element; };
    await page.context.openInteractiveMap(3, 'images/img3-system.svg');
    assert.equal((map.innerHTML.match(/class="spot-polygon"/g) || []).length, 706);
    assert.equal((map.innerHTML.match(/class="map-spot-number"/g) || []).length, 706);
    assert.ok(map.innerHTML.includes('第3駐車場：706台（暫定・位置を確認中）'));
    assert.ok(map.innerHTML.includes('images/img3-system.svg'));
    assert.ok(map.innerHTML.includes('rgba(231, 76, 60, 0.6)'));
    assert.ok(map.innerHTML.includes('rgba(46, 204, 113, 0.4)'));
    const registrations = [];
    let checkouts = 0;
    page.context.openEndTimeModal = (lot, spot) => registrations.push([lot, spot]);
    page.context.openCheckoutModal = () => checkouts++;
    await page.context.handleSpotCheckIn(3, 2);
    await page.context.handleSpotCheckIn(3, 707);
    assert.equal(registrations.length, 0);
    await page.context.handleSpotCheckIn(3, 706);
    assert.deepEqual(registrations, [[3, 706]]);
    vm.runInContext('myParkingInfo = { lot_id: "3", space_id: 706 };', page.context);
    await page.context.openInteractiveMap(3, 'images/img3-system.svg');
    assert.ok(map.innerHTML.includes('#f1c40f'));
    await page.context.handleSpotCheckIn(3, 706);
    await page.context.handleSpotCheckIn(3, 705);
    assert.equal(checkouts, 1);
    assert.equal(registrations.length, 1);
});

for (const [lotId, capacity, imageUrl] of [[4, 78, 'images/img4.jpg'], [7, 104, 'images/img7-system.svg']]) {
    test(`lot ${lotId} renders ${capacity} visible numbers and supports map checkin and checkout with fresh status`, async () => {
        class LoadedImage { set src(value) { this.onload(); } }
        const statuses = [{ lot_id: String(lotId), spot_number: 2, status: 'occupied' }];
        const page = screen({ ok: true, json: async () => statuses }, LoadedImage);
        let map;
        page.context.document.body.appendChild = element => { map = element; };
        await page.context.openInteractiveMap(lotId, imageUrl);
        assert.equal((map.innerHTML.match(/class="spot-polygon"/g) || []).length, capacity);
        assert.equal((map.innerHTML.match(/class="map-spot-number"/g) || []).length, capacity);
        assert.ok(map.innerHTML.includes(`第${lotId}駐車場：${capacity}台`));
        assert.ok(map.innerHTML.includes(`id="spot-${lotId}-${capacity}"`));
        assert.ok(!map.innerHTML.includes(`id="spot-${lotId}-${capacity + 1}"`));
        assert.ok(map.innerHTML.includes('font-size: 0.9px'));
        if (lotId === 7) assert.ok(map.innerHTML.includes('暫定・位置を確認中'));
        assert.ok(map.innerHTML.includes('rgba(231, 76, 60, 0.6)'));
        assert.ok(map.innerHTML.includes('rgba(46, 204, 113, 0.4)'));
        const registrations = [];
        let checkouts = 0;
        page.context.openEndTimeModal = (lot, spot) => registrations.push([lot, spot]);
        page.context.openCheckoutModal = () => checkouts++;
        await page.context.handleSpotCheckIn(lotId, 2);
        await page.context.handleSpotCheckIn(lotId, capacity + 1);
        assert.equal(registrations.length, 0);
        await page.context.handleSpotCheckIn(lotId, capacity);
        assert.deepEqual(registrations, [[lotId, capacity]]);
        let checkin;
        const originalApiRequest = page.context.apiRequest;
        page.context.apiRequest = async (url, options) => {
            if (url === '/api/parking/checkin') {
                checkin = JSON.parse(options.body);
                statuses.push({ lot_id: String(lotId), spot_number: capacity, status: 'occupied' });
                return { lot_id: String(lotId), space_id: capacity };
            }
            if (url === '/api/parking-data') return [{ id: lotId, capacity, available: capacity - 2 }];
            return originalApiRequest(url, options);
        };
        page.context.refreshUI = () => {};
        page.context.displayMyParkingStatus = () => {};
        page.context.closeDetailModal = () => {};
        page.context.closeEndTimeModal = () => {};
        await page.context.processSpaceCheckin(lotId, capacity, '未定');
        assert.deepEqual(checkin, { userId: 'test-a', lotId, spaceId: capacity, endTime: '未定', layoutVersion: lotId === 7 ? 2 : 1 });
        assert.equal(vm.runInContext('latestMapStatus', page.context), null);
        await page.context.openInteractiveMap(lotId, imageUrl);
        assert.ok(map.innerHTML.includes('#f1c40f'));
        await page.context.handleSpotCheckIn(lotId, capacity);
        await page.context.handleSpotCheckIn(lotId, capacity - 1);
        assert.equal(checkouts, 1);
        assert.equal(registrations.length, 1);
    });
}

test('second lot renders 205 spaces with occupancy and supports checkin and own checkout', async () => {
    class LoadedImage { set src(value) { this.onload(); } }
    const statuses = [{ lot_id: '2', spot_number: 2, status: 'occupied' }];
    const page = screen({ ok: true, json: async () => statuses }, LoadedImage);
    let map;
    page.context.document.body.appendChild = element => { map = element; };
    await page.context.openInteractiveMap(2, 'images/img2-system.svg');
    assert.equal((map.innerHTML.match(/class="spot-polygon"/g) || []).length, 205);
    assert.equal((map.innerHTML.match(/class="map-spot-number"/g) || []).length, 205);
    assert.ok(map.innerHTML.includes('id="spot-2-205"'));
    assert.ok(!map.innerHTML.includes('id="spot-2-206"'));
    assert.ok(map.innerHTML.includes('第2駐車場：205台'));
    assert.ok(map.innerHTML.includes('rgba(231, 76, 60, 0.6)'));
    assert.ok(map.innerHTML.includes('rgba(46, 204, 113, 0.4)'));
    const registrations = [];
    let checkouts = 0;
    page.context.openEndTimeModal = (lot, spot) => registrations.push([lot, spot]);
    page.context.openCheckoutModal = () => checkouts++;
    await page.context.handleSpotCheckIn(2, 2);
    await page.context.handleSpotCheckIn(2, 206);
    assert.equal(registrations.length, 0);
    await page.context.handleSpotCheckIn(2, 205);
    assert.deepEqual(registrations, [[2, 205]]);
    let checkin;
    const originalApiRequest = page.context.apiRequest;
    page.context.apiRequest = async (url, options) => {
        if (url === '/api/parking/checkin') {
            checkin = JSON.parse(options.body);
            statuses.push({ lot_id: '2', spot_number: 205, status: 'occupied' });
            return { lot_id: '2', space_id: 205 };
        }
        if (url === '/api/parking-data') return [{ id: 2, capacity: 205, available: 203 }];
        return originalApiRequest(url, options);
    };
    page.context.refreshUI = () => {};
    page.context.displayMyParkingStatus = () => {};
    page.context.closeDetailModal = () => {};
    page.context.closeEndTimeModal = () => {};
    await page.context.processSpaceCheckin(2, 205, '未定');
    assert.deepEqual(checkin, { userId: 'test-a', lotId: 2, spaceId: 205, endTime: '未定', layoutVersion: 2 });
    assert.equal(vm.runInContext('latestMapStatus', page.context), null);
    await page.context.openInteractiveMap(2, 'images/img2-system.svg');
    assert.ok(map.innerHTML.includes('自分の駐車枠'));
    assert.ok(map.innerHTML.includes('#f1c40f'));
    await page.context.handleSpotCheckIn(2, 205);
    assert.equal(checkouts, 1);
    await page.context.handleSpotCheckIn(2, 204);
    assert.equal(registrations.length, 1);
});
