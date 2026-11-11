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
    let modal = null;
    let nextTask = 0;
    const timers = new Map();
    const frames = new Map();
    const panzooms = [];
    const observers = [];
    const eventTarget = () => ({
        listeners: new Map(),
        addEventListener(event, handler) {
            if (!this.listeners.has(event)) this.listeners.set(event, new Set());
            this.listeners.get(event).add(handler);
        },
        removeEventListener(event, handler) { this.listeners.get(event)?.delete(handler); },
        dispatch(event, detail = {}) { this.listeners.get(event)?.forEach(handler => handler({ type: event, preventDefault() {}, stopPropagation() {}, ...detail })); }
    });
    const element = () => ({
        classList: { contains: () => false, add() {}, remove() {} },
            style: { setProperty(name, value) { this[name] = value; } }, dataset: {}, clientWidth: 390, clientHeight: 740,
        ...eventTarget(),
        setAttribute(name, value) { this[name] = value; },
        remove() { if (modal === this) modal = null; },
        removeAttribute(name) { delete this[name]; },
        appendChild() {},
        insertBefore() {},
        getBoundingClientRect() {
            if (!this.panzoomInstance) return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight };
            const pz = this.panzoomInstance, viewport = modal.querySelector('.map-viewport');
            const width = parseFloat(this.style.width) * pz.scale, height = parseFloat(this.style.height) * pz.scale;
            return { left: viewport.clientWidth / 2 - width / 2 + pz.position[0] * pz.scale,
                top: viewport.clientHeight / 2 - height / 2 + pz.position[1] * pz.scale, width, height };
        },
        nodes: new Map(),
        querySelector(selector) {
            if (!this.nodes.has(selector)) this.nodes.set(selector, element());
            return this.nodes.get(selector);
        },
        querySelectorAll() { return []; }
    });
    const elements = new Map();
    const window = {
        ...eventTarget(), innerWidth: 390, innerHeight: 844, scrollX: 0, scrollY: 0,
        screen: { orientation: { ...eventTarget(), type: 'portrait-primary' } },
        getComputedStyle: () => ({ paddingRight: '0px' }),
        scrollTo(x, y) { this.scrollX = x; this.scrollY = y; },
        requestAnimationFrame(callback) { const id = ++nextTask; frames.set(id, callback); return id; },
        cancelAnimationFrame(id) { frames.delete(id); },
        ResizeObserver: class {
            constructor(callback) { this.callback = callback; observers.push(this); }
            observe(target) { this.target = target; }
            disconnect() { this.disconnected = true; }
        }
    };
    const context = vm.createContext({
        document: {
            ...eventTarget(),
            getElementById: id => {
                if (id === 'interactiveMapModal') return modal;
                if (!elements.has(id)) elements.set(id, element());
                return elements.get(id);
            },
            createElement: () => { createdMaps++; return element(); },
            createElementNS: () => element(),
            documentElement: { style: {}, clientWidth: 390 },
            body: { ...element(), appendChild(node) { modal = node; } }
        },
        window, console: { log() {}, error() {} },
        fetch: async (url, options) => {
            if (url.startsWith('/data/parking-spots/')) {
                return { ok: true, json: async () => coordinates === undefined
                    ? (url === '/data/parking-spots/lot-1.json' ? firstLotCoordinates : JSON.parse(fs.readFileSync(`public${url}`, 'utf8'))) : coordinates };
            }
            return typeof fetchResponse === 'function' ? fetchResponse(url, options) : fetchResponse;
        },
        Image: ImageClass,
        setTimeout(callback) { const id = ++nextTask; timers.set(id, callback); return id; },
        clearTimeout(id) { timers.delete(id); },
        Panzoom(target, options) {
            const instance = {
                target, options, resets: 0, scale: 1, position: [0,0], destroyed: false,
                zoomWithWheel(event) { event.preventDefault(); this.zoom(this.scale * (event.deltaY < 0 ? 1.1 : 1/1.1)); },
                getScale() { return this.scale; },
                getPan() { return { x: this.position[0], y: this.position[1] }; },
                setOptions(next) { Object.assign(this.options, next); },
                zoom(scale) { this.scale = Math.min(this.options.maxScale, Math.max(this.options.minScale, scale)); },
                zoomToPoint(scale) { this.zoom(scale); },
                pan(x, y) { this.position = [x,y]; },
                reset() { this.resets++; this.scale = 1; this.position = [0,0]; },
                destroy() { this.destroyed = true; }
            };
            target.panzoomInstance = instance;
            panzooms.push(instance);
            return instance;
        }
    });
    vm.runInContext(fs.readFileSync('public/parking-map-data.js', 'utf8'), context);
    vm.runInContext(fs.readFileSync('public/map-search.js', 'utf8'), context);
    vm.runInContext(fs.readFileSync('public/script.js', 'utf8'), context);
    vm.runInContext('currentUser = { studentId: "test-a" };', context);
    vm.runInContext('parkingData = [{ id: 1, capacity: 530 }, { id: 2, capacity: 205 }, { id: 5, capacity: 61 }, { id: 3, capacity: 706 }, { id: 4, capacity: 78 }, { id: 7, capacity: 104 }];', context);
    context.showNotification = message => notifications.push(message);
    const flush = tasks => { const callbacks = [...tasks.values()]; tasks.clear(); callbacks.forEach(callback => callback()); };
    return { context, notifications, maps: () => createdMaps, elements, panzooms, observers,
        modal: () => modal, flushTimers: () => flush(timers), flushFrames: () => flush(frames),
        pendingTimers: () => timers.size, pendingFrames: () => frames.size };
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

class LayoutImage {
    constructor() { this.naturalWidth = 911; this.naturalHeight = 824; }
    set src(value) { this.onload(); }
}

test('map layout uses the supplied lot name and capacity with a fixed header and real-state legend', async () => {
    const page = screen({ ok: true, json: async () => [] }, LayoutImage);
    vm.runInContext('parkingData = [{id:5,name:"検証用 & 駐車場",capacity:66}];', page.context);
    await page.context.openInteractiveMap(5, 'images/img5.jpg');
    const html = page.modal().innerHTML;
    for (const fragment of ['map-header','map-viewport','map-footer','検証用 &amp; 駐車場','66台','緑：空き','赤：使用中','黄枠：自分']) {
        assert.ok(html.includes(fragment), fragment);
    }
    assert.ok(!html.includes('95vw') && !html.includes('85vh'));
    assert.equal((html.match(/<button /g) || []).length, 6, 'close, three map controls, search, and the explicit result action');
    page.flushTimers();
    assert.equal(page.panzooms.length, 1);
    assert.equal(page.panzooms[0].options.maxScale, 5);
    const view = vm.runInContext('activeMapView', page.context);
    assert.ok(Math.abs(parseFloat(view.element.style.width) / parseFloat(view.element.style.height) - 911/824) < 0.000001);
    assert.ok(Math.abs(parseFloat(view.element.style.marginTop) - (740 - parseFloat(view.element.style.height)) / 2) < 0.000001);
    assert.equal(view.mode, 'overview');
    assert.equal(page.panzooms[0].options.minScale, 1);
    assert.ok(!html.includes('id="main-area"') && !html.includes('onclick="handleSpotCheckIn'));
});

test('map opening locks background scroll and closing restores the prior styles and scroll position', async () => {
    const page = screen({ ok: true, json: async () => [] }, LayoutImage);
    const body = page.context.document.body;
    Object.assign(body.style, { position: 'relative', top: '3px', left: '5px', width: '80%', overflow: 'auto', paddingRight: '9px' });
    page.context.document.documentElement.style.overflow = 'scroll';
    page.context.document.documentElement.clientWidth = 375;
    Object.assign(page.context.window, { scrollX: 12, scrollY: 456, getComputedStyle: () => ({ paddingRight: '9px' }) });
    await page.context.openInteractiveMap(5, 'images/img5.jpg');
    assert.equal(body.style.position, 'fixed');
    assert.equal(body.style.top, '-456px');
    assert.equal(body.style.paddingRight, '24px');
    assert.equal(page.context.document.documentElement.style.overflow, 'hidden');
    page.context.closeInteractiveMap();
    assert.equal(body.style.position, 'relative');
    assert.equal(body.style.top, '3px');
    assert.equal(body.style.left, '5px');
    assert.equal(body.style.width, '80%');
    assert.equal(body.style.overflow, 'auto');
    assert.equal(body.style.paddingRight, '9px');
    assert.equal(page.context.document.documentElement.style.overflow, 'scroll');
    assert.equal(page.context.window.scrollX, 12);
    assert.equal(page.context.window.scrollY, 456);
    assert.equal(page.pendingTimers(), 0);
});

test('closing a map before delayed initialization cancels Panzoom and does not affect a later map', async () => {
    const page = screen({ ok: true, json: async () => [] }, LayoutImage);
    await page.context.openInteractiveMap(5, 'images/img5.jpg');
    page.context.closeInteractiveMap();
    page.flushTimers();
    assert.equal(page.panzooms.length, 0);
    await page.context.openInteractiveMap(7, 'images/img7-system.svg');
    page.flushTimers();
    assert.equal(page.panzooms.length, 1);
    assert.equal(vm.runInContext('latestMapStatus.lotId', page.context), '7');
});

test('toolbar and keyboard height changes preserve zoom while device rotation resets only the overview', async () => {
    const page = screen({ ok: true, json: async () => [] }, LayoutImage);
    await page.context.openInteractiveMap(5, 'images/img5.jpg');
    page.flushTimers();
    const panzoom = page.panzooms[0];
    const view = vm.runInContext('activeMapView', page.context);
    panzoom.scale = 4;
    panzoom.position = [19,-50];
    page.context.setInteractiveMapMode(view, 'selection');
    page.context.openEndTimeModal(5, 22);
    const timeInput = page.context.document.getElementById('endTimeInput');
    timeInput.value = '15:30';
    vm.runInContext('myParkingInfo = { lot_id:"5",space_id:61 };', page.context);
    page.context.window.innerHeight = 680;
    view.viewport.clientHeight = 576;
    page.context.window.dispatch('resize');
    page.flushFrames();
    assert.equal(panzoom.scale, 4);
    assert.deepEqual(panzoom.position, [19,-50]);
    assert.equal(panzoom.resets, 0);
    assert.equal(view.mode, 'selection');
    Object.assign(page.context.window, { innerWidth: 844, innerHeight: 390 });
    Object.assign(view.viewport, { clientWidth: 844, clientHeight: 306 });
    page.context.window.screen.orientation.type = 'landscape-primary';
    page.context.window.screen.orientation.dispatch('change');
    page.context.window.dispatch('resize');
    page.flushFrames();
    assert.equal(panzoom.resets, 1);
    assert.equal(panzoom.scale, 1);
    assert.deepEqual(panzoom.position, [0,0]);
    assert.equal(view.mode, 'overview');
    assert.ok(Math.abs(parseFloat(view.element.style.height) - 306) < 0.001);
    assert.equal(timeInput.value, '15:30');
    assert.equal(page.context.document.getElementById('endTimeModal').style.display, 'block');
    assert.equal(vm.runInContext('myParkingInfo.space_id', page.context), 61);
    page.observers[0].callback();
    page.flushFrames();
    assert.equal(panzoom.resets, 1);
});

test('repeated map opening and closing disposes wheel, rotation, resize observer, and pending frame handlers', async () => {
    const page = screen({ ok: true, json: async () => [] }, LayoutImage);
    for (let index = 0; index < 3; index++) {
        await page.context.openInteractiveMap(5, 'images/img5.jpg');
        page.flushTimers();
        const view = vm.runInContext('activeMapView', page.context);
        assert.equal(view.viewport.listeners.get('wheel').size, 1);
        page.context.window.dispatch('resize');
        assert.equal(page.pendingFrames(), 1);
        page.context.closeInteractiveMap();
        assert.equal(page.pendingFrames(), 0);
        assert.equal(view.viewport.listeners.get('wheel').size, 0);
        assert.equal(page.panzooms[index].destroyed, true);
        assert.equal(page.observers[index].disconnected, true);
        for (const listeners of page.context.window.listeners.values()) assert.equal(listeners.size, 0);
        for (const listeners of page.context.window.screen.orientation.listeners.values()) assert.equal(listeners.size, 0);
    }
});

test('cancelling departure-time input keeps the current map and selected spot information available', async () => {
    const page = screen({ ok: true, json: async () => [] }, LayoutImage);
    await page.context.openInteractiveMap(5, 'images/img5.jpg');
    page.flushTimers();
    const map = page.modal();
    const view = mapView(page);
    tapMap(page, clientSpot(view, 22)); tapMap(page, clientSpot(view, 22));
    const scale = view.panzoom.scale, position = [...view.panzoom.position];
    assert.equal(page.context.document.getElementById('endTimeModal').style.display, 'block');
    page.context.closeEndTimeModal();
    assert.equal(page.context.document.getElementById('endTimeModal').style.display, 'none');
    assert.equal(page.modal(), map);
    assert.equal(vm.runInContext('latestMapStatus.lotId', page.context), '5');
    assert.equal(page.context.document.getElementById('endTimeSubmitBtn').dataset.spaceId, 22);
    assert.equal(page.panzooms[0].destroyed, false);
    assert.equal(view.mode, 'selection');
    assert.equal(view.panzoom.scale, scale);
    assert.deepEqual(view.panzoom.position, position);
});

function mapView(page) { return vm.runInContext('activeMapView', page.context); }
function clientSpot(view, id = 1) {
    const rect = view.element.getBoundingClientRect();
    const center = view.metrics.spots.find(spot => spot.id === id).center;
    return { clientX: rect.left + center[0] / view.metrics.width * rect.width,
        clientY: rect.top + center[1] / view.metrics.height * rect.height };
}
function tapMap(page, point, cancel = false) {
    const view = mapView(page);
    const event = { pointerId: 1, button: 0, ...point };
    view.viewport.dispatch('pointerdown', event);
    page.context.document.dispatch(cancel ? 'pointercancel' : 'pointerup', event);
    view.viewport.dispatch('click', event);
    page.flushFrames();
}

test('first tap zooms and centers without registration; only the next valid bay tap selects', async () => {
    const page = screen({ok:true,json:async()=>[]}, LayoutImage);
    await page.context.openInteractiveMap(5, 'images/img5.jpg'); page.flushTimers();
    const view = mapView(page);
    let registrations = 0; page.context.openEndTimeModal = () => registrations++;
    tapMap(page, clientSpot(view));
    assert.equal(registrations, 0);
    assert.equal(view.mode, 'selection');
    assert.ok(view.autoScale > 2 && view.autoScale < 3);
    assert.ok(view.modal.querySelector('.map-guide').textContent.includes('空いている'));
    tapMap(page, clientSpot(view));
    assert.equal(registrations, 1);
    const scale = view.panzoom.scale, position = [...view.panzoom.position];
    page.context.openEndTimeModal = () => {};
    page.context.closeEndTimeModal();
    assert.equal(view.panzoom.scale, scale);
    assert.deepEqual(view.panzoom.position, position);
    assert.equal(view.mode, 'selection');
});

test('background tap is ignored, image whitespace zooms, and whitespace never registers', async () => {
    const page = screen({ok:true,json:async()=>[]}, LayoutImage);
    await page.context.openInteractiveMap(5, 'images/img5.jpg'); page.flushTimers();
    const view = mapView(page); let registrations = 0; page.context.openEndTimeModal = () => registrations++;
    tapMap(page, {clientX:0,clientY:0});
    assert.equal(view.mode, 'overview'); assert.equal(view.panzoom.scale, 1);
    const rect = view.element.getBoundingClientRect();
    tapMap(page, {clientX:rect.left + 1,clientY:rect.top + 1});
    assert.equal(view.mode, 'selection');
    const enlarged = view.element.getBoundingClientRect();
    tapMap(page, {clientX:enlarged.left + 1,clientY:enlarged.top + 1});
    assert.equal(registrations, 0);
});

test('drag returning to its start, canceled pointers, and pinch compatibility clicks cannot select', async () => {
    const page = screen({ok:true,json:async()=>[]}, LayoutImage);
    await page.context.openInteractiveMap(5, 'images/img5.jpg'); page.flushTimers();
    const view = mapView(page); let registrations = 0; page.context.openEndTimeModal = () => registrations++;
    tapMap(page, clientSpot(view));
    const point = clientSpot(view), one = {pointerId:1,button:0,...point};
    view.viewport.dispatch('pointerdown', one);
    page.context.document.dispatch('pointermove', {...one,clientX:one.clientX+8});
    page.context.document.dispatch('pointermove', one);
    page.context.document.dispatch('pointerup', one); view.viewport.dispatch('click', one);
    tapMap(page, point, true);
    view.viewport.dispatch('pointerdown', one);
    const two = {...one,pointerId:2,clientX:one.clientX+40};
    view.viewport.dispatch('pointerdown', two);
    page.context.document.dispatch('pointerup', two);
    page.context.document.dispatch('pointerup', one); view.viewport.dispatch('click', one);
    assert.equal(registrations, 0);
    tapMap(page, clientSpot(view)); assert.equal(registrations, 1);
});

test('large initial bays select at scale one and internal layout updates preserve the mode', async () => {
    const page = screen({ok:true,json:async()=>[]}, LayoutImage);
    await page.context.openInteractiveMap(5, 'images/img5.jpg'); page.flushTimers();
    const view = mapView(page);
    Object.assign(view.viewport, {clientWidth:3000,clientHeight:2500}); page.context.fitInteractiveMapImage(view);
    tapMap(page, clientSpot(view));
    assert.equal(view.mode, 'selection'); assert.equal(view.panzoom.scale, 1);
    page.context.window.dispatch('resize'); page.flushFrames();
    assert.equal(view.mode, 'selection');
    page.context.resetInteractiveMapOverview(view);
    assert.equal(view.mode, 'overview');
});

test('max zoom permits very small bays while ambiguous overlapping bays abort safely', async () => {
    const tiny = [{id:1,polygon:[[10,10],[10.01,10],[10.01,20],[10,20]]}];
    const page = screen({ok:true,json:async()=>[]}, LayoutImage, tiny);
    await page.context.openInteractiveMap(5, 'images/img5.jpg'); page.flushTimers();
    const view = mapView(page); tapMap(page, clientSpot(view));
    assert.equal(view.panzoom.scale, 16); assert.equal(view.mode, 'selection');
    assert.ok(view.metrics.median * view.fitScale * 16 < 32);
    const overlap = screen({ok:true,json:async()=>[]}, LayoutImage, [tiny[0],{...tiny[0],id:2}]);
    await overlap.context.openInteractiveMap(5, 'images/img5.jpg'); overlap.flushTimers();
    tapMap(overlap, clientSpot(mapView(overlap))); tapMap(overlap, clientSpot(mapView(overlap)));
    assert.equal(overlap.modal(), null);
    assert.ok(overlap.notifications.some(message => message.includes('正しく操作')));
});

test('zoom buttons use factor 1.3, retain selection on partial zoom-out, and reset centrally', async () => {
    const page = screen({ok:true,json:async()=>[]}, LayoutImage);
    await page.context.openInteractiveMap(5, 'images/img5.jpg'); page.flushTimers();
    const view = mapView(page);
    const press = action => view.modal.querySelector(`[data-map-action="${action}"]`).dispatch('click');
    press('in'); assert.equal(view.panzoom.scale, 1.3); assert.equal(view.mode, 'overview');
    for (let i = 0; i < 3; i++) press('in');
    assert.ok(Math.abs(view.panzoom.scale - 1.3**4) < 1e-8); assert.equal(view.mode, 'selection');
    press('out'); assert.equal(view.mode, 'selection');
    press('overview'); assert.equal(view.mode, 'overview'); assert.equal(view.panzoom.scale, 1);
    assert.deepEqual(view.panzoom.position, [0,0]);
    tapMap(page, clientSpot(view));
    for (let i = 0; i < 20; i++) press('out');
    assert.equal(view.mode, 'overview'); assert.equal(view.panzoom.scale, 1);
});

test('wheel and pinch zoom share mode switching, including explicit shrink at scale one', async () => {
    const page = screen({ok:true,json:async()=>[]}, LayoutImage);
    await page.context.openInteractiveMap(5, 'images/img5.jpg'); page.flushTimers();
    const view = mapView(page);
    for (let i = 0; i < 12; i++) view.viewport.dispatch('wheel', {...clientSpot(view),deltaY:-100,preventDefault(){}});
    assert.equal(view.mode, 'selection');
    page.context.resetInteractiveMapOverview(view);
    const one = {pointerId:1,button:0,...clientSpot(view)};
    const two = {...one,pointerId:2,clientX:one.clientX+40};
    view.viewport.dispatch('pointerdown', one); view.viewport.dispatch('pointerdown', two);
    page.context.document.dispatch('pointermove', {...two,clientX:two.clientX+20});
    view.panzoom.scale = 2.5;
    view.element.dispatch('panzoomzoom', {detail:{originalEvent:{type:'pointermove'}}});
    assert.equal(view.mode, 'selection');
    page.context.document.dispatch('pointermove', {...two,clientX:one.clientX+20});
    view.panzoom.scale = 1;
    view.element.dispatch('panzoomzoom', {detail:{originalEvent:{type:'pointermove'}}});
    assert.equal(view.mode, 'overview');
    page.context.document.dispatch('pointerup', two); page.context.document.dispatch('pointerup', one);
    Object.assign(view.viewport, {clientWidth:3000,clientHeight:2500}); page.context.fitInteractiveMapImage(view);
    tapMap(page, clientSpot(view)); assert.equal(view.mode, 'selection'); assert.equal(view.panzoom.scale, 1);
    view.modal.querySelector('[data-map-action="out"]').dispatch('click'); assert.equal(view.mode, 'overview');
});

test('manual max scale permits small bays and closing cancels pending selection and all gesture listeners', async () => {
    const tiny = [{id:1,polygon:[[10,10],[10.01,10],[10.01,20],[10,20]]}];
    const page = screen({ok:true,json:async()=>[]}, LayoutImage, tiny);
    await page.context.openInteractiveMap(5, 'images/img5.jpg'); page.flushTimers();
    const view = mapView(page);
    for (let i = 0; i < 20; i++) view.modal.querySelector('[data-map-action="in"]').dispatch('click');
    assert.equal(view.panzoom.scale, 16); assert.equal(view.mode, 'selection');
    page.context.resetInteractiveMapOverview(view);
    const event = {pointerId:1,button:0,...clientSpot(view)};
    view.viewport.dispatch('pointerdown', event); page.context.document.dispatch('pointerup', event); view.viewport.dispatch('click', event);
    assert.ok(page.pendingFrames() > 0);
    page.context.closeInteractiveMap(); page.flushFrames();
    assert.equal(page.pendingFrames(), 0); assert.equal(page.modal(), null);
    for (const [type,listeners] of page.context.document.listeners) if (type.startsWith('pointer')) assert.equal(listeners.size, 0);
    for (const listeners of view.viewport.listeners.values()) assert.equal(listeners.size, 0);
    for (const listeners of view.element.listeners.values()) assert.equal(listeners.size, 0);
});

function registeredLot(page, id, capacity) {
    vm.runInContext(`parkingData = [{id:${id},name:'第${id}駐車場',capacity:${capacity},spaces:Array.from({length:${capacity}},(_,i)=>({id:i+1}))}];`,page.context);
}
async function submitSearch(page, view, number) {
    view.searchNodes.input.value=String(number);
    await page.context.searchInteractiveMap(view);
    page.flushFrames();page.flushFrames();page.flushFrames();
}

for(const [id,capacity] of [[1,530],[2,205],[3,706],[4,78],[5,61],[7,104]]) {
    test(`integrated lot ${id}: search only locates, an already zoomed search pans, and the action uses shared registration`,async()=>{
        const page=screen({ok:true,json:async()=>[]},LayoutImage);
        registeredLot(page,id,capacity);
        await page.context.openInteractiveMap(id,`images/img${id}.jpg`);page.flushTimers();
        const view=mapView(page);let registrations=0;
        page.context.openEndTimeModal=()=>registrations++;
        await submitSearch(page,view,1);
        assert.equal(registrations,0);assert.equal(view.mode,'selection');
        assert.equal(view.searchHighlight['data-search-number'],'1');
        const scale=view.panzoom.scale,position=[...view.panzoom.position];
        await submitSearch(page,view,capacity);
        assert.ok(view.panzoom.scale>=scale);
        assert.notDeepEqual(view.panzoom.position,position);
        assert.equal(view.selectedNumber,capacity);
        assert.match(view.searchNodes.title.textContent,new RegExp(`${capacity}番`));
        assert.equal(view.searchNodes.result['data-space-state'],'available');
        assert.equal(view.searchNodes.action.hidden,false);
        view.searchNodes.action.dispatch('click');assert.equal(registrations,1);
        page.context.resetInteractiveMapOverview(view);
        assert.equal(view.searchHighlight,null);assert.equal(view.searchNodes.result.hidden,true);
        assert.equal(view.mode,'overview');assert.equal(view.panzoom.scale,1);
        page.context.closeInteractiveMap();assert.equal(page.pendingFrames(),0);
    });
}

test('search results distinguish occupied and own spaces; only an explicit own action opens checkout',async()=>{
    const rows=[{lot_id:'2',spot_number:100,status:'occupied',end_time:'15:30'}];
    const page=screen({ok:true,json:async()=>rows},LayoutImage);registeredLot(page,2,205);
    await page.context.openInteractiveMap(2,'images/img2.jpg');page.flushTimers();const view=mapView(page);
    let checkouts=0,registrations=0;page.context.openCheckoutModal=()=>checkouts++;page.context.openEndTimeModal=()=>registrations++;
    await submitSearch(page,view,100);
    assert.equal(view.searchNodes.action.hidden,true);assert.match(view.searchNodes.state.textContent,/使用中.*15:30/);
    vm.runInContext('myParkingInfo={lot_id:2,space_id:100,estimated_end_time:"16:00"};',page.context);
    await submitSearch(page,view,100);
    assert.match(view.searchNodes.state.textContent,/自分の駐車枠.*16:00/);
    assert.equal(view.searchNodes.action.textContent,'出庫手続き');assert.equal(checkouts,0);
    view.searchNodes.action.dispatch('click');assert.equal(checkouts,1);assert.equal(registrations,0);
    const original=view.modal.querySelector('#spot-2-100');assert.equal(original.style.stroke,'#f1c40f');
});

test('invalid input, unregistered numbers and missing coordinates have distinct inline failures without network or selection',async()=>{
    let requests=0;
    const page=screen(async()=>{requests++;return{ok:true,json:async()=>[]};},LayoutImage,[{id:1,polygon:[[10,10],[20,10],[20,20],[10,20]]}]);
    registeredLot(page,2,205);await page.context.openInteractiveMap(2,'images/img2.jpg');page.flushTimers();const view=mapView(page);
    for(const value of ['',0,-1,'1.5','128a',206,100]){
        await submitSearch(page,view,value);
        assert.equal(view.searchNodes.error.hidden,false);assert.equal(view.selectedNumber,null);
    }
    assert.match(view.searchNodes.error.textContent,/100番は存在しますが/);assert.equal(requests,1);
    view.searchNodes.input.value='206';view.searchNodes.form.dispatch('submit');
    assert.match(view.searchNodes.error.textContent,/第2駐車場に206番はありません/);
});

test('search fetch failure preserves safe old map, reports inline, and restores controls',async()=>{
    let fail=false;
    const page=screen(async()=>fail?{ok:false,json:async()=>({message:'Unavailable'})}:{ok:true,json:async()=>[]},LayoutImage);
    registeredLot(page,5,61);await page.context.openInteractiveMap(5,'images/img5.jpg');page.flushTimers();const view=mapView(page);
    fail=true;await submitSearch(page,view,1);
    assert.match(view.searchNodes.error.textContent,/空き情報を取得できません/);
    assert.equal(view.searchNodes.submit.disabled,false);assert.equal(view.searchNodes.input.readOnly,false);
    assert.equal(view.searchNodes.result.hidden,true);assert.equal(view.searchHighlight,null);
});

test('pending search rejects double submit and cannot leak into a later lot or appear after reset',async()=>{
    let pending=false,resolveRequest,calls=0;
    const page=screen(async()=>{calls++;if(pending)return new Promise(resolve=>resolveRequest=resolve);return{ok:true,json:async()=>[]};},LayoutImage);
    registeredLot(page,5,61);await page.context.openInteractiveMap(5,'images/img5.jpg');page.flushTimers();const old=mapView(page);
    pending=true;old.searchNodes.input.value='1';const searching=page.context.searchInteractiveMap(old);
    await Promise.resolve();assert.equal(old.searchPending,true);
    await page.context.searchInteractiveMap(old);assert.equal(calls,2);
    page.context.closeInteractiveMap();pending=false;
    registeredLot(page,4,78);await page.context.openInteractiveMap(4,'images/img4.jpg');page.flushTimers();
    resolveRequest({ok:true,json:async()=>[]});await searching;page.flushFrames();page.flushFrames();
    const current=mapView(page);assert.equal(current.lotId,'4');assert.equal(current.selectedNumber,null);
    await submitSearch(page,current,1);
    page.context.resetInteractiveMapOverview(current);page.flushFrames();
    assert.equal(current.selectedNumber,null);assert.equal(current.searchHighlight,null);
});

test('search highlight and result survive rotation, while composition Enter and field clicks cannot select bays',async()=>{
    const page=screen({ok:true,json:async()=>[]},LayoutImage);registeredLot(page,3,706);
    await page.context.openInteractiveMap(3,'images/img3.jpg');page.flushTimers();const view=mapView(page);
    await submitSearch(page,view,128);
    view.viewport.clientWidth=852;view.viewport.clientHeight=280;page.context.window.screen.orientation.type='landscape-primary';
    page.context.window.screen.orientation.dispatch('change');page.flushFrames();page.flushFrames();
    assert.equal(view.selectedNumber,128);assert.equal(view.searchHighlight['data-search-number'],'128');
    assert.equal(view.mode,'selection');
    let prevented=false;view.searchNodes.input.dispatch('keydown',{key:'Enter',isComposing:true,preventDefault(){prevented=true;}});
    assert.equal(prevented,true);
    let registrations=0;page.context.openEndTimeModal=()=>registrations++;
    view.searchNodes.input.dispatch('click');assert.equal(registrations,0);
    page.context.closeInteractiveMap();assert.equal(page.pendingFrames(),0);
});

test('keyboard viewport resize preserves searched position and its listener is removed on close',async()=>{
    const page=screen({ok:true,json:async()=>[]},LayoutImage);registeredLot(page,3,706);
    const vv={height:600,listeners:new Map(),addEventListener(name,fn){this.listeners.set(name,fn);},removeEventListener(name){this.listeners.delete(name);}};
    page.context.window.visualViewport=vv;
    await page.context.openInteractiveMap(3,'images/img3.jpg');page.flushTimers();page.flushFrames();const view=mapView(page);
    await submitSearch(page,view,128);const scale=view.panzoom.scale;
    view.searchNodes.input.dispatch('focus');vv.height=350;vv.listeners.get('resize')();page.flushFrames();
    assert.equal(view.modal.style['--map-visible-height'],'350px');assert.equal(view.selectedNumber,128);
    assert.equal(view.panzoom.scale,scale);
    view.searchNodes.input.dispatch('blur');vv.height=844;vv.listeners.get('resize')();page.flushFrames();
    assert.equal(view.selectedNumber,128);
    page.context.closeInteractiveMap();assert.equal(vv.listeners.size,0);assert.equal(page.pendingFrames(),0);
});

test('search halo compensates CSS zoom and keeps the original own-space line visible',async()=>{
    const page=screen({ok:true,json:async()=>[]},LayoutImage);registeredLot(page,5,61);
    vm.runInContext('myParkingInfo={lot_id:5,space_id:1};',page.context);
    await page.context.openInteractiveMap(5,'images/img5.jpg');page.flushTimers();const view=mapView(page);
    await submitSearch(page,view,1);
    const base=.6*Math.max(view.image.naturalWidth,view.image.naturalHeight)*view.fitScale/100;
    assert.ok(Math.abs(parseFloat(view.searchHighlight.style.strokeWidth)*view.panzoom.scale-base*view.panzoom.scale-6)<1e-8);
    view.panzoom.zoom(view.maxScale);view.element.dispatch('panzoomchange');
    assert.ok(Math.abs(parseFloat(view.searchHighlight.style.strokeWidth)*view.panzoom.scale-base*view.panzoom.scale-6)<1e-8);
    assert.equal(view.modal.querySelector('#spot-5-1').style.stroke,'#f1c40f');
});

test('search lays out its result panel before fitting the map and calculating edge movement',async()=>{
    const page=screen({ok:true,json:async()=>[]},LayoutImage);registeredLot(page,5,61);
    await page.context.openInteractiveMap(5,'images/img5.jpg');page.flushTimers();const view=mapView(page);
    Object.defineProperty(view.viewport,'clientHeight',{get(){return view.searchNodes.result.hidden?740:400;}});
    await submitSearch(page,view,1);
    const imageHeight=parseFloat(view.element.style.height);
    assert.ok(Math.abs(parseFloat(view.element.style.marginTop)-(400-imageHeight)/2)<1e-8);
    assert.equal(view.selectedNumber,1);assert.equal(view.searchNodes.result.hidden,false);
});

test('normal cards hide only the legacy entry while retaining both original click handlers',()=>{
    const page=screen();registeredLot(page,5,61);
    const created=[],factory=page.context.document.createElement;
    page.context.document.createElement=tag=>{const node=factory(tag);created.push({tag,node});return node;};
    const clone=factory('div');
    page.context.document.getElementById('parking-card-template').content={cloneNode:()=>clone};
    vm.runInContext('parkingData[0].available=60;parkingData[0].imageUrl="images/img5.jpg";',page.context);
    let numberLot,mapLot;page.context.showLotDetail=id=>numberLot=id;page.context.openInteractiveMap=id=>mapLot=id;
    page.context.renderParkingLots();
    const number=created.find(item=>item.node.className==='action-btn btn-number').node;
    const map=created.find(item=>item.node.className==='action-btn btn-map').node;
    assert.equal(number.hidden,true);assert.notEqual(map.hidden,true);
    number.onclick({stopPropagation(){}});map.onclick({stopPropagation(){}});
    assert.equal(numberLot,5);assert.equal(mapLot,5);
});

test('reset during a delayed search invalidates the response and permits a new search',async()=>{
    let deferred=false,resolveResponse;
    const page=screen(async()=>deferred?new Promise(resolve=>resolveResponse=resolve):{ok:true,json:async()=>[]},LayoutImage);
    registeredLot(page,2,205);await page.context.openInteractiveMap(2,'images/img2.jpg');page.flushTimers();const view=mapView(page);
    deferred=true;view.searchNodes.input.value='100';const pending=page.context.searchInteractiveMap(view);await Promise.resolve();
    page.context.resetInteractiveMapOverview(view);resolveResponse({ok:true,json:async()=>[]});await pending;
    page.flushFrames();page.flushFrames();assert.equal(view.selectedNumber,null);assert.equal(view.searchHighlight,null);
    deferred=false;await submitSearch(page,view,128);assert.equal(view.selectedNumber,128);
});
