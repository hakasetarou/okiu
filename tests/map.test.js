const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function screen(fetchResponse, ImageClass = class {}) {
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
        fetch: async () => fetchResponse,
        Image: ImageClass,
        setTimeout() {}
    });
    vm.runInContext(fs.readFileSync('public/script.js', 'utf8'), context);
    vm.runInContext('currentUser = { studentId: "test-a" };', context);
    vm.runInContext('parkingData = [{ id: 5, capacity: 61 }, { id: 3, capacity: 200 }];', context);
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
    const page = screen();
    await page.context.openInteractiveMap(3, 'images/img3.jpg');
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
    assert.ok(map.innerHTML.includes('id="spot-5-61"'));
    assert.ok(!map.innerHTML.includes('id="spot-5-62"'));
    assert.equal(vm.runInContext('PARKING_SPOTS_DATA[5].length', page.context), 61);
    assert.deepEqual(Array.from(vm.runInContext('PARKING_SPOTS_DATA[5].map(spot => spot.id)', page.context)),
        Array.from({ length: 61 }, (_, index) => index + 1));
    const new22 = vm.runInContext('PARKING_SPOTS_DATA[5].find(spot => spot.id === 22)', page.context);
    assert.equal(new22.name, '22');
    assert.deepEqual(Array.from(new22.polygon[0]), [29.967, 61.974]);
    const last = vm.runInContext('PARKING_SPOTS_DATA[5][60]', page.context);
    assert.equal(last.name, '61');
    assert.deepEqual(Array.from(last.polygon[0]), [36.883, 55.461]);
});
