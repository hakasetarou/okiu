const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const express = require('express');
const { Pool } = require('pg');
const basePool = require('../db');
const { createAuthRouter } = require('../routes/auth');

// 実際の利用者データとは別の、一時的なDB領域だけを使う。
const schema = `parking_test_${process.pid}`;
let pool;
let server;
let baseUrl;

test.before(async () => {
    await basePool.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ ...basePool.options, password: basePool.options.password,
        options: `-c search_path=${schema}`, connectionTimeoutMillis: 3000 });
    await pool.query(`
        CREATE TABLE users (student_id TEXT PRIMARY KEY, name TEXT, password TEXT);
        CREATE TABLE parking_lots (id TEXT PRIMARY KEY, name TEXT, capacity INTEGER, image_url TEXT);
        CREATE TABLE parking_spaces (
            id SERIAL PRIMARY KEY, lot_id VARCHAR(50), spot_number INTEGER, status VARCHAR(20),
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(lot_id, spot_number)
        );
        CREATE TABLE parking_sessions (
            session_id SERIAL PRIMARY KEY, user_id TEXT, lot_id TEXT, space_id INTEGER,
            start_time TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, estimated_end_time TEXT
        );
        INSERT INTO users VALUES ('test-a', 'Test A', 'Test12345'), ('test-b', 'Test B', 'Test12345');
        INSERT INTO parking_lots VALUES ('lot-5', 'Test lot', 61, '/images/img5.jpg');
        INSERT INTO parking_spaces(lot_id, spot_number, status) VALUES ('5', 1, 'available');
    `);
    await pool.query(fs.readFileSync('migrations/001-parking-integrity.sql', 'utf8'));
    const app = express();
    app.use(express.json());
    app.use('/api', createAuthRouter(pool));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.end();
    // 自分が作った一時領域だけを削除する。
    await basePool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await basePool.end();
});

test.beforeEach(async () => {
    await pool.query('DELETE FROM parking_sessions');
    await pool.query('DELETE FROM parking_spaces');
});

async function request(endpoint, body) {
    const response = await fetch(baseUrl + endpoint, body === undefined ? {} : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
}
function checkin(userId, spaceId = 1, endTime = '15:30') {
    return request('/parking/checkin', { userId, lotId: 5, spaceId, endTime, layoutVersion: 2 });
}

test('registration, estimated departure, and checkout stay consistent', async () => {
    const registered = await checkin('test-a', 61);
    assert.equal(registered.status, 200);
    assert.equal(registered.body.lot_id, '5');
    const loggedIn = await request('/login', { studentId: 'test-a', password: 'Test12345' });
    assert.equal(loggedIn.status, 200);
    assert.equal(loggedIn.body.myParkingInfo.lot_id, '5');
    assert.equal(loggedIn.body.myParkingInfo.space_id, 61);
    const listing = await request('/parking-data');
    assert.equal(listing.body[0].capacity, 61);
    assert.equal(listing.body[0].available, 60);
    assert.equal(listing.body[0].imageUrl, 'images/img5.jpg');
    assert.equal(listing.body[0].spaces[60].endTime, '15:30');
    const status = await request('/parking/status');
    assert.equal(status.body[0].status, 'occupied');
    assert.equal(status.body[0].lot_id, '5');
    assert.equal((await request('/parking/checkout', { userId: 'test-a' })).status, 200);
    assert.equal((await request('/parking-data')).body[0].available, 61);
    assert.equal((await pool.query('SELECT * FROM parking_sessions')).rowCount, 0);
    assert.equal((await request('/login', { studentId: 'test-a', password: 'Test12345' })).body.myParkingInfo, null);
});

test('occupied space is rejected without adding a session', async () => {
    await pool.query("INSERT INTO parking_spaces(lot_id, spot_number, status) VALUES ('lot-5', 1, 'occupied')");
    assert.equal((await checkin('test-a')).status, 409);
    assert.equal((await pool.query('SELECT * FROM parking_sessions')).rowCount, 0);
});

test('two users registering the same space simultaneously: only one succeeds', async () => {
    const results = await Promise.all([checkin('test-a'), checkin('test-b')]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    assert.equal((await pool.query('SELECT * FROM parking_sessions')).rowCount, 1);
    assert.equal((await request('/parking-data')).body[0].available, 60);
});

test('one user registering two spaces simultaneously: only one succeeds', async () => {
    const results = await Promise.all([checkin('test-a', 1), checkin('test-a', 2)]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    assert.equal((await pool.query('SELECT * FROM parking_sessions')).rowCount, 1);
    assert.equal((await pool.query("SELECT * FROM parking_spaces WHERE status='occupied'")).rowCount, 1);
});

test('invalid spot, time, and missing user are rejected', async () => {
    assert.equal((await checkin('test-a', 62)).status, 400);
    assert.equal((await checkin('test-a', 1, '25:00')).status, 400);
    assert.equal((await checkin('unknown')).status, 400);
    assert.equal((await pool.query('SELECT * FROM parking_sessions')).rowCount, 0);
});

test('master updates are reflected and missing images are reported as unavailable', async () => {
    await pool.query("UPDATE parking_lots SET capacity=63, image_url='/images/missing.jpg' WHERE id='lot-5'");
    try {
        const result = await request('/parking-data');
        assert.equal(result.body[0].capacity, 63);
        assert.equal(result.body[0].imageUrl, null);
    } finally {
        await pool.query("UPDATE parking_lots SET capacity=61, image_url='/images/img5.jpg' WHERE id='lot-5'");
    }
});

test('DB constraints reject duplicates even outside the registration API', async () => {
    await checkin('test-a');
    await assert.rejects(pool.query("INSERT INTO parking_sessions(user_id,lot_id,space_id) VALUES ('test-a','lot-5',2)"), { code: '23505' });
    await assert.rejects(pool.query("INSERT INTO parking_sessions(user_id,lot_id,space_id) VALUES ('test-b','lot-5',1)"), { code: '23505' });
});

test('old toggle API cannot bypass registration', async () => {
    assert.equal((await request('/parking/toggle', { lotId: 5, spotNumber: 1 })).status, 410);
    assert.equal((await pool.query('SELECT * FROM parking_spaces')).rowCount, 0);
});

test('migration normalizes old IDs and can be applied again', async () => {
    await pool.query("INSERT INTO parking_spaces(lot_id,spot_number,status) VALUES ('5',3,'available')");
    await pool.query(fs.readFileSync('migrations/001-parking-integrity.sql', 'utf8'));
    const result = await pool.query('SELECT lot_id FROM parking_spaces');
    assert.equal(result.rows[0].lot_id, 'lot-5');
});

test('capacity correction changes the earlier 62-slot setting to 61', async () => {
    await pool.query("UPDATE parking_lots SET capacity=30 WHERE id='lot-5'");
    await pool.query(fs.readFileSync('migrations/002-lot5-map-capacity.sql', 'utf8'));
    await pool.query(fs.readFileSync('migrations/003-lot5-capacity-correction.sql', 'utf8'));
    const result = await request('/parking-data');
    assert.equal(result.body[0].capacity, 61);
    assert.equal(result.body[0].spaces.length, 61);
    assert.equal((await checkin('test-a', 62)).status, 400);
});

test('capacity correction refuses to hide an existing parking record at spot 62', async () => {
    await pool.query("UPDATE parking_lots SET capacity=62 WHERE id='lot-5'");
    await checkin('test-a', 62);
    const client = await pool.connect();
    try {
        await assert.rejects(client.query(fs.readFileSync('migrations/003-lot5-capacity-correction.sql', 'utf8')));
        await client.query('ROLLBACK');
        assert.equal((await request('/parking-data')).body[0].capacity, 62);
        assert.equal((await pool.query('SELECT * FROM parking_sessions')).rowCount, 1);
    } finally {
        await client.query('ROLLBACK');
        client.release();
        await pool.query("UPDATE parking_lots SET capacity=61 WHERE id='lot-5'");
    }
});

test('removing old spot 22 preserves parking at old 23 and shifts it to new 22', async () => {
    await pool.query(`
        INSERT INTO parking_spaces(lot_id,spot_number,status) VALUES
            ('lot-5',21,'available'), ('lot-5',22,'available'),
            ('lot-5',23,'occupied'), ('lot-5',24,'available'),
            ('5',33,'available'), ('lot-5',62,'available'), ('lot-1',23,'available');
        INSERT INTO parking_sessions(user_id,lot_id,space_id,estimated_end_time)
            VALUES ('test-a','lot-5',23,'15:30');
    `);
    await pool.query(fs.readFileSync('migrations/004-lot5-remove-extra-spot.sql', 'utf8'));
    const spaces = await pool.query("SELECT spot_number,status FROM parking_spaces WHERE lot_id='lot-5' ORDER BY spot_number");
    assert.deepEqual(spaces.rows.map(row => row.spot_number), [21, 22, 23, 32, 61]);
    assert.equal(spaces.rows[1].status, 'occupied');
    assert.equal((await pool.query("SELECT spot_number FROM parking_spaces WHERE lot_id='lot-1'")).rows[0].spot_number, 23);
    const loggedIn = await request('/login', { studentId: 'test-a', password: 'Test12345' });
    assert.equal(loggedIn.body.myParkingInfo.space_id, 22);
    const listing = await request('/parking-data');
    assert.equal(listing.body[0].spaces[21].isParked, true);
    assert.equal(listing.body[0].spaces[21].endTime, '15:30');
    assert.equal((await request('/parking/checkout', { userId: 'test-a' })).status, 200);
    assert.equal((await request('/parking-data')).body[0].available, 61);
});

test('removing old spot 22 stops if the extra area has an active registration', async () => {
    await checkin('test-a', 22);
    const client = await pool.connect();
    try {
        await assert.rejects(client.query(fs.readFileSync('migrations/004-lot5-remove-extra-spot.sql', 'utf8')));
        await client.query('ROLLBACK');
        const parked = await request('/login', { studentId: 'test-a', password: 'Test12345' });
        assert.equal(parked.body.myParkingInfo.space_id, 22);
        assert.equal((await pool.query('SELECT * FROM parking_sessions')).rowCount, 1);
    } finally {
        await client.query('ROLLBACK');
        client.release();
    }
});

test('old map clients cannot register using the previous numbering', async () => {
    const result = await request('/parking/checkin', { userId: 'test-a', lotId: 5, spaceId: 23, endTime: '15:30' });
    assert.equal(result.status, 409);
    assert.equal((await pool.query('SELECT * FROM parking_sessions')).rowCount, 0);
    assert.equal((await checkin('test-a', 22)).status, 200);
});

test('removing lot 6 leaves lots 1 to 5 and 7, adjusts totals, and rejects lot 6 registration', async () => {
    await pool.query(`
        INSERT INTO parking_lots(id,name,capacity,image_url) VALUES
            ('lot-1','Lot 1',2,'/images/img1.jpg'), ('lot-2','Lot 2',2,'/images/img2.jpg'),
            ('lot-3','Lot 3',2,'/images/img3.jpg'), ('lot-4','Lot 4',2,'/images/img4.jpg'),
            ('lot-6','Lot 6',50,'/images/img6.jpg'), ('lot-7','Lot 7',2,'/images/img7.jpg');
        INSERT INTO parking_spaces(lot_id,spot_number,status) VALUES
            ('lot-6',1,'available'), ('lot-7',1,'available');
    `);
    try {
        await pool.query(fs.readFileSync('migrations/005-remove-parking-lot6.sql', 'utf8'));
        const listing = await request('/parking-data');
        assert.deepEqual(listing.body.map(lot => lot.id), [1, 2, 3, 4, 5, 7]);
        assert.equal(listing.body.reduce((sum, lot) => sum + lot.capacity, 0), 71);
        assert.equal(listing.body.reduce((sum, lot) => sum + lot.available, 0), 71);
        const status = await request('/parking/status');
        assert.ok(status.body.every(space => space.lot_id !== '6'));
        assert.equal((await request('/parking/checkin', { userId: 'test-a', lotId: 6, spaceId: 1, endTime: '15:30' })).status, 400);
        const seventh = await request('/parking/checkin', { userId: 'test-a', lotId: 7, spaceId: 1, endTime: '15:30', layoutVersion: 2 });
        assert.equal(seventh.status, 200);
        assert.equal(seventh.body.lot_id, '7');
    } finally {
        await pool.query("DELETE FROM parking_lots WHERE id <> 'lot-5'");
    }
});

test('lot 6 removal stops without discarding active parking', async () => {
    await pool.query("INSERT INTO parking_lots(id,name,capacity) VALUES ('lot-6','Lot 6',50)");
    await request('/parking/checkin', { userId: 'test-a', lotId: 6, spaceId: 1, endTime: '15:30' });
    const client = await pool.connect();
    try {
        await assert.rejects(client.query(fs.readFileSync('migrations/005-remove-parking-lot6.sql', 'utf8')));
        await client.query('ROLLBACK');
        assert.equal((await pool.query("SELECT * FROM parking_lots WHERE id='lot-6'")).rowCount, 1);
        assert.equal((await pool.query("SELECT * FROM parking_sessions WHERE lot_id='lot-6'")).rowCount, 1);
    } finally {
        await client.query('ROLLBACK');
        client.release();
        await pool.query("DELETE FROM parking_lots WHERE id='lot-6'");
    }
});

test('each other remaining lot supports the common checkin and checkout flow', async () => {
    const ids = [1, 2, 3, 4, 7];
    for (const id of ids) {
        await pool.query('INSERT INTO parking_lots(id,name,capacity,image_url) VALUES ($1,$2,2,$3)',
            [`lot-${id}`, `Lot ${id}`, `/images/img${id}.jpg`]);
    }
    try {
        for (const id of ids) {
            const registered = await request('/parking/checkin', { userId: 'test-a', lotId: id, spaceId: 2, endTime: '未定', layoutVersion: { 1: 4, 2: 2, 3: 1, 4: 1, 7: 2 }[id] });
            assert.equal(registered.status, 200);
            assert.equal(registered.body.lot_id, String(id));
            const status = await request('/parking/status');
            assert.ok(status.body.some(spot => spot.lot_id === String(id) && spot.spot_number === 2 && spot.status === 'occupied'));
            assert.equal((await request('/parking/checkout', { userId: 'test-a' })).status, 200);
            const listing = await request('/parking-data');
            assert.equal(listing.body.find(lot => lot.id === id).available, 2);
        }
    } finally {
        await pool.query("DELETE FROM parking_lots WHERE id <> 'lot-5'");
    }
});

test('confirmed capacities total 1661, preserve parking, and allow the newly added highest spots', async () => {
    const targets = [[1, 530], [2, 206], [3, 693], [4, 78], [7, 93]];
    for (const [id] of targets) {
        await pool.query('INSERT INTO parking_lots(id,name,capacity,image_url) VALUES ($1,$2,2,$3)',
            [`lot-${id}`, `Lot ${id}`, `/images/img${id}.jpg`]);
    }
    try {
        assert.equal((await request('/parking/checkin', { userId: 'test-a', lotId: 1, spaceId: 1, endTime: '15:30', layoutVersion: 4 })).status, 200);
        const previousParking = (await pool.query('SELECT * FROM parking_sessions')).rows;
        const migration = fs.readFileSync('migrations/006-confirm-parking-capacities.sql', 'utf8');
        await pool.query(migration);
        await pool.query(migration);
        assert.deepEqual((await pool.query('SELECT * FROM parking_sessions')).rows, previousParking);
        const listing = await request('/parking-data');
        assert.deepEqual(listing.body.map(lot => [lot.id, lot.capacity]), [[1, 530], [2, 206], [3, 693], [4, 78], [5, 61], [7, 93]]);
        assert.equal(listing.body.reduce((sum, lot) => sum + lot.capacity, 0), 1661);
        assert.equal(listing.body.find(lot => lot.id === 1).spaces[0].isParked, true);
        assert.equal(listing.body.find(lot => lot.id === 1).spaces[0].endTime, '15:30');
        for (const [id, capacity] of targets) {
            const parked = await request('/parking/checkin', { userId: 'test-b', lotId: id, spaceId: capacity, endTime: '未定', layoutVersion: { 1: 4, 2: 2, 3: 1, 4: 1, 7: 2 }[id] });
            assert.equal(parked.status, 200);
            assert.equal(parked.body.space_id, capacity);
            assert.equal((await request('/parking/checkout', { userId: 'test-b' })).status, 200);
            assert.equal((await request('/parking/checkin', { userId: 'test-b', lotId: id, spaceId: capacity + 1, endTime: '未定', layoutVersion: { 1: 4, 2: 2, 3: 1, 4: 1, 7: 2 }[id] })).status, 400);
        }
        assert.equal((await request('/parking/checkout', { userId: 'test-a' })).status, 200);
    } finally {
        await pool.query("DELETE FROM parking_lots WHERE id <> 'lot-5'");
    }
});

test('capacity confirmation stops atomically if active parking is beyond an approved limit', async () => {
    const ids = [1, 2, 3, 4, 7];
    for (const id of ids) {
        await pool.query('INSERT INTO parking_lots(id,name,capacity) VALUES ($1,$2,1000)', [`lot-${id}`, `Lot ${id}`]);
    }
    await pool.query("INSERT INTO parking_spaces(lot_id,spot_number,status) VALUES ('lot-1',531,'occupied')");
    const previous = (await pool.query('SELECT id,capacity FROM parking_lots ORDER BY id')).rows;
    const client = await pool.connect();
    try {
        await assert.rejects(client.query(fs.readFileSync('migrations/006-confirm-parking-capacities.sql', 'utf8')), /収容台数を超える/);
        await client.query('ROLLBACK');
        assert.deepEqual((await pool.query('SELECT id,capacity FROM parking_lots ORDER BY id')).rows, previous);
        assert.equal((await pool.query("SELECT status FROM parking_spaces WHERE lot_id='lot-1' AND spot_number=531")).rows[0].status, 'occupied');
    } finally {
        await client.query('ROLLBACK');
        client.release();
        await pool.query("DELETE FROM parking_lots WHERE id <> 'lot-5'");
    }
});

test('first-lot correction preserves parking positions, renumbers the tail, and allows 532 spots', async () => {
    await pool.query("INSERT INTO parking_lots(id,name,capacity,image_url) VALUES ('lot-1','Lot 1',530,'/images/img1.jpg')");
    await pool.query(`
        INSERT INTO parking_spaces(lot_id,spot_number,status) VALUES
            ('1',483,'available'), ('lot-1',484,'available'), ('lot-1',485,'occupied'),
            ('lot-1',486,'available'), ('lot-1',529,'available'), ('lot-1',530,'occupied'),
            ('lot-5',61,'available');
        INSERT INTO parking_sessions(user_id,lot_id,space_id,estimated_end_time) VALUES
            ('test-a','lot-1',485,'15:30'), ('test-b','lot-1',530,'未定');
    `);
    const before = (await pool.query('SELECT * FROM parking_sessions ORDER BY user_id')).rows;
    try {
        await pool.query(fs.readFileSync('migrations/007-lot1-map-correction.sql', 'utf8'));
        const after = (await pool.query('SELECT * FROM parking_sessions ORDER BY user_id')).rows;
        assert.deepEqual(after, before.map(session => ({ ...session, space_id: session.space_id - 1 })));
        const spaces = (await pool.query("SELECT spot_number,status FROM parking_spaces WHERE lot_id='lot-1' ORDER BY spot_number")).rows;
        assert.deepEqual(spaces.map(space => space.spot_number), [483, 484, 485, 528, 529]);
        assert.equal(spaces.find(space => space.spot_number === 484).status, 'occupied');
        const listing = await request('/parking-data');
        const first = listing.body.find(lot => lot.id === 1);
        assert.equal(first.capacity, 532);
        assert.equal(first.available, 530);
        assert.equal(first.spaces[483].endTime, '15:30');
        assert.equal(first.spaces[528].isParked, true);
        assert.equal(listing.body.find(lot => lot.id === 5).capacity, 61);
        assert.equal((await pool.query("SELECT spot_number FROM parking_spaces WHERE lot_id='lot-5'")).rows[0].spot_number, 61);
        for (const userId of ['test-a', 'test-b']) assert.equal((await request('/parking/checkout', { userId })).status, 200);
        for (const spaceId of [530, 531, 532]) {
            assert.equal((await request('/parking/checkin', { userId: 'test-a', lotId: 1, spaceId, endTime: '未定', layoutVersion: 4 })).status, 200);
            assert.equal((await request('/parking/checkout', { userId: 'test-a' })).status, 200);
        }
        assert.equal((await request('/parking/checkin', { userId: 'test-a', lotId: 1, spaceId: 533, endTime: '未定', layoutVersion: 4 })).status, 400);
    } finally {
        await pool.query("DELETE FROM parking_lots WHERE id='lot-1'");
    }
});

test('first-lot correction stops atomically if the removed old spot 484 is occupied', async () => {
    await pool.query("INSERT INTO parking_lots(id,name,capacity,image_url) VALUES ('lot-1','Lot 1',530,'/images/img1.jpg')");
    await request('/parking/checkin', { userId: 'test-a', lotId: 1, spaceId: 484, endTime: '15:30', layoutVersion: 4 });
    await pool.query("INSERT INTO parking_spaces(lot_id,spot_number,status) VALUES ('lot-1',485,'available')");
    const client = await pool.connect();
    try {
        await assert.rejects(client.query(fs.readFileSync('migrations/007-lot1-map-correction.sql', 'utf8')), /旧484番に駐車記録/);
        await client.query('ROLLBACK');
        assert.equal((await pool.query("SELECT capacity FROM parking_lots WHERE id='lot-1'")).rows[0].capacity, 530);
        assert.equal((await pool.query("SELECT space_id FROM parking_sessions WHERE user_id='test-a'")).rows[0].space_id, 484);
        assert.deepEqual((await pool.query("SELECT spot_number FROM parking_spaces WHERE lot_id='lot-1' ORDER BY spot_number")).rows.map(row => row.spot_number), [484, 485]);
    } finally {
        await client.query('ROLLBACK');
        client.release();
        await pool.query("DELETE FROM parking_lots WHERE id='lot-1'");
    }
});

test('first-lot correction stops if an unexpected old number is present', async () => {
    await pool.query("INSERT INTO parking_lots(id,name,capacity) VALUES ('lot-1','Lot 1',530)");
    await pool.query("INSERT INTO parking_spaces(lot_id,spot_number,status) VALUES ('lot-1',531,'occupied')");
    const client = await pool.connect();
    try {
        await assert.rejects(client.query(fs.readFileSync('migrations/007-lot1-map-correction.sql', 'utf8')), /想定外の枠番号/);
        await client.query('ROLLBACK');
        assert.equal((await pool.query("SELECT capacity FROM parking_lots WHERE id='lot-1'")).rows[0].capacity, 530);
        assert.equal((await pool.query("SELECT spot_number FROM parking_spaces WHERE lot_id='lot-1'")).rows[0].spot_number, 531);
    } finally {
        await client.query('ROLLBACK');
        client.release();
        await pool.query("DELETE FROM parking_lots WHERE id='lot-1'");
    }
});

test('first-lot clients with previous layout versions cannot register old numbers', async () => {
    await pool.query("INSERT INTO parking_lots(id,name,capacity,image_url) VALUES ('lot-1','Lot 1',530,'/images/img1.jpg')");
    try {
        for (const layoutVersion of [undefined, 1, 2, 3]) {
            const result = await request('/parking/checkin', { userId: 'test-a', lotId: 1, spaceId: 485, endTime: '未定', layoutVersion });
            assert.equal(result.status, 409);
            assert.ok(result.body.message.includes('再読み込み'));
        }
        assert.equal((await pool.query('SELECT * FROM parking_sessions')).rowCount, 0);
        assert.equal((await request('/parking/checkin', { userId: 'test-a', lotId: 1, spaceId: 530, endTime: '未定', layoutVersion: 4 })).status, 200);
        assert.equal((await request('/parking/checkout', { userId: 'test-a' })).status, 200);
    } finally {
        await pool.query("DELETE FROM parking_lots WHERE id='lot-1'");
    }
});

test('area numbering removes only old 7 and 133 and preserves every other space and parking record', async () => {
    const numbering = JSON.parse(fs.readFileSync('docs/lot-1-renumbering-v4.json', 'utf8'));
    const numberMap = new Map(numbering.mappings.map(row => [row.oldNumber, row.newNumber]));
    await pool.query("INSERT INTO parking_lots(id,name,capacity,image_url) VALUES ('lot-1','Lot 1',532,'/images/img1.jpg')");
    await pool.query(`
        INSERT INTO parking_spaces(lot_id,spot_number,status)
        SELECT 'lot-1', number, CASE WHEN number IN (8,212) THEN 'occupied' ELSE 'available' END
        FROM generate_series(1,532) number;
        INSERT INTO parking_spaces(lot_id,spot_number,status) VALUES ('5',61,'available');
        INSERT INTO parking_sessions(user_id,lot_id,space_id,estimated_end_time) VALUES
            ('test-a','lot-1',8,'15:30'), ('test-b','lot-1',212,'未定');
    `);
    const beforeSpaces = (await pool.query("SELECT * FROM parking_spaces WHERE lot_id='lot-1' ORDER BY spot_number")).rows;
    const beforeSessions = (await pool.query('SELECT * FROM parking_sessions ORDER BY user_id')).rows;
    try {
        await pool.query(fs.readFileSync('migrations/008-lot1-area-numbering.sql', 'utf8'));
        const afterSpaces = (await pool.query("SELECT * FROM parking_spaces WHERE lot_id='lot-1' ORDER BY spot_number")).rows;
        const expectedSpaces = beforeSpaces.filter(space => numberMap.has(space.spot_number))
            .map(space => ({ ...space, spot_number: numberMap.get(space.spot_number) }))
            .sort((a, b) => a.spot_number - b.spot_number);
        assert.deepEqual(afterSpaces, expectedSpaces);
        assert.deepEqual(afterSpaces.map(space => space.spot_number), Array.from({ length: 530 }, (_, index) => index + 1));
        const sessions = (await pool.query('SELECT * FROM parking_sessions ORDER BY user_id')).rows;
        assert.deepEqual(sessions, beforeSessions.map(session => ({ ...session, space_id: numberMap.get(session.space_id) })));
        assert.deepEqual(sessions.map(session => session.space_id), [104, 278]);
        const listing = await request('/parking-data');
        const first = listing.body.find(lot => lot.id === 1);
        assert.equal(first.capacity, 530);
        assert.equal(first.available, 528);
        assert.equal(first.spaces[103].endTime, '15:30');
        assert.equal(first.spaces[277].isParked, true);
        assert.equal((await pool.query("SELECT spot_number FROM parking_spaces WHERE lot_id='5'")).rows[0].spot_number, 61);
        assert.equal(listing.body.find(lot => lot.id === 5).capacity, 61);
        for (const userId of ['test-a', 'test-b']) assert.equal((await request('/parking/checkout', { userId })).status, 200);
        for (const spaceId of [7, 133, 530]) {
            assert.equal((await request('/parking/checkin', { userId: 'test-a', lotId: 1, spaceId, endTime: '未定', layoutVersion: 4 })).status, 200);
            assert.equal((await request('/parking/checkout', { userId: 'test-a' })).status, 200);
        }
        assert.equal((await request('/parking/checkin', { userId: 'test-a', lotId: 1, spaceId: 531, endTime: '未定', layoutVersion: 4 })).status, 400);
    } finally {
        await pool.query("DELETE FROM parking_lots WHERE id='lot-1'");
    }
});

test('area numbering refuses to discard parking at either removed old number', async () => {
    await pool.query("INSERT INTO parking_lots(id,name,capacity,image_url) VALUES ('lot-1','Lot 1',532,'/images/img1.jpg')");
    const client = await pool.connect();
    try {
        for (const [number, hasSession] of [[7, true], [133, true], [7, false]]) {
            await pool.query('DELETE FROM parking_sessions');
            await pool.query('DELETE FROM parking_spaces');
            if (hasSession) {
                assert.equal((await request('/parking/checkin', { userId: 'test-a', lotId: 1, spaceId: number, endTime: '15:30', layoutVersion: 4 })).status, 200);
            } else {
                await pool.query("INSERT INTO parking_spaces(lot_id,spot_number,status) VALUES ('lot-1',$1,'occupied')", [number]);
            }
            await pool.query("INSERT INTO parking_spaces(lot_id,spot_number,status) VALUES ('lot-1',212,'available')");
            const before = (await pool.query('SELECT * FROM parking_spaces ORDER BY spot_number')).rows;
            await assert.rejects(client.query(fs.readFileSync('migrations/008-lot1-area-numbering.sql', 'utf8')), /旧7番または133番に駐車記録/);
            await client.query('ROLLBACK');
            assert.deepEqual((await pool.query('SELECT * FROM parking_spaces ORDER BY spot_number')).rows, before);
            assert.equal((await pool.query("SELECT capacity FROM parking_lots WHERE id='lot-1'")).rows[0].capacity, 532);
            if (hasSession) assert.equal((await pool.query('SELECT space_id FROM parking_sessions')).rows[0].space_id, number);
        }
    } finally {
        await client.query('ROLLBACK');
        client.release();
        await pool.query("DELETE FROM parking_lots WHERE id='lot-1'");
    }
});

test('area numbering stops atomically for numbers outside the old layout', async () => {
    await pool.query("INSERT INTO parking_lots(id,name,capacity) VALUES ('lot-1','Lot 1',532)");
    await pool.query("INSERT INTO parking_spaces(lot_id,spot_number,status) VALUES ('lot-1',533,'available')");
    const client = await pool.connect();
    try {
        await assert.rejects(client.query(fs.readFileSync('migrations/008-lot1-area-numbering.sql', 'utf8')), /想定外の枠番号/);
        await client.query('ROLLBACK');
        assert.equal((await pool.query("SELECT capacity FROM parking_lots WHERE id='lot-1'")).rows[0].capacity, 532);
        assert.equal((await pool.query("SELECT spot_number FROM parking_spaces WHERE lot_id='lot-1'")).rows[0].spot_number, 533);
    } finally {
        await client.query('ROLLBACK');
        client.release();
        await pool.query("DELETE FROM parking_lots WHERE id='lot-1'");
    }
});

test('tree-space correction preserves parking positions and records and totals 1660 spaces', async () => {
    for (const [id, capacity] of [[1,530], [2,206], [3,693], [4,78], [7,93]]) {
        await pool.query('INSERT INTO parking_lots(id,name,capacity,image_url) VALUES ($1,$2,$3,$4)',
            [`lot-${id}`, `Lot ${id}`, capacity, `/images/img${id}.jpg`]);
    }
    await pool.query(`
        INSERT INTO parking_spaces(lot_id,spot_number,status)
        SELECT CASE WHEN number % 2 = 0 THEN '2' ELSE 'lot-2' END, number,
            CASE WHEN number IN (177,206) THEN 'occupied' ELSE 'available' END
        FROM generate_series(1,206) number;
        INSERT INTO parking_spaces(lot_id,spot_number,status) VALUES ('lot-5',61,'available');
        INSERT INTO parking_sessions(user_id,lot_id,space_id,estimated_end_time) VALUES
            ('test-a','2',177,'15:30'), ('test-b','lot-2',206,'未定');
    `);
    const beforeSpaces = (await pool.query("SELECT * FROM parking_spaces WHERE lot_id IN ('lot-2','2') ORDER BY spot_number")).rows;
    const beforeSessions = (await pool.query('SELECT * FROM parking_sessions ORDER BY user_id')).rows;
    const fifthLot = (await pool.query("SELECT * FROM parking_spaces WHERE lot_id='lot-5'")).rows;
    try {
        await pool.query(fs.readFileSync('migrations/009-lot2-remove-tree-space.sql', 'utf8'));
        const after = (await pool.query("SELECT * FROM parking_spaces WHERE lot_id='lot-2' ORDER BY spot_number")).rows;
        assert.deepEqual(after, beforeSpaces.filter(space => space.spot_number !== 176).map(space => ({
            ...space, lot_id: 'lot-2', spot_number: space.spot_number > 176 ? space.spot_number - 1 : space.spot_number
        })));
        assert.deepEqual(after.map(space => space.spot_number), Array.from({ length: 205 }, (_, i) => i + 1));
        assert.deepEqual((await pool.query('SELECT * FROM parking_sessions ORDER BY user_id')).rows,
            beforeSessions.map(session => ({ ...session, lot_id: 'lot-2', space_id: session.space_id - 1 })));
        assert.deepEqual((await pool.query("SELECT * FROM parking_spaces WHERE lot_id='lot-5'")).rows, fifthLot);
        const listing = await request('/parking-data');
        assert.equal(listing.body.reduce((sum, lot) => sum + lot.capacity, 0), 1660);
        const second = listing.body.find(lot => lot.id === 2);
        assert.equal(second.capacity, 205);
        assert.equal(second.available, 203);
        assert.equal(second.imageUrl, 'images/img2-system.svg');
        assert.equal(second.spaces[175].endTime, '15:30');
        assert.equal(second.spaces[204].isParked, true);
        for (const userId of ['test-a','test-b']) assert.equal((await request('/parking/checkout', { userId })).status, 200);
        for (const spaceId of [176,205]) {
            assert.equal((await request('/parking/checkin', { userId: 'test-a', lotId: 2, spaceId, endTime: '未定', layoutVersion: 2 })).status, 200);
            assert.equal((await request('/parking/checkout', { userId: 'test-a' })).status, 200);
        }
        assert.equal((await request('/parking/checkin', { userId: 'test-a', lotId: 2, spaceId: 206, endTime: '未定', layoutVersion: 2 })).status, 400);
    } finally {
        await pool.query("DELETE FROM parking_lots WHERE id <> 'lot-5'");
    }
});

test('tree-space correction stops atomically if old 176 is occupied or has a parking record', async () => {
    await pool.query("INSERT INTO parking_lots(id,name,capacity,image_url) VALUES ('lot-2','Lot 2',206,'/images/img2.jpg')");
    const client = await pool.connect();
    try {
        for (const hasSession of [true,false]) {
            await pool.query('DELETE FROM parking_sessions');
            await pool.query('DELETE FROM parking_spaces');
            await pool.query("INSERT INTO parking_spaces(lot_id,spot_number,status) VALUES ('lot-2',176,$1),('lot-2',177,'available')",
                [hasSession ? 'available' : 'occupied']);
            if (hasSession) await pool.query("INSERT INTO parking_sessions(user_id,lot_id,space_id) VALUES ('test-a','lot-2',176)");
            const before = (await pool.query('SELECT * FROM parking_spaces ORDER BY spot_number')).rows;
            const sessions = (await pool.query('SELECT * FROM parking_sessions')).rows;
            await assert.rejects(client.query(fs.readFileSync('migrations/009-lot2-remove-tree-space.sql', 'utf8')), /旧176番に駐車記録/);
            await client.query('ROLLBACK');
            assert.deepEqual((await pool.query('SELECT * FROM parking_spaces ORDER BY spot_number')).rows, before);
            assert.deepEqual((await pool.query('SELECT * FROM parking_sessions')).rows, sessions);
            assert.deepEqual((await pool.query("SELECT capacity,image_url FROM parking_lots WHERE id='lot-2'")).rows[0],
                { capacity: 206, image_url: '/images/img2.jpg' });
        }
    } finally {
        await client.query('ROLLBACK');
        client.release();
        await pool.query("DELETE FROM parking_lots WHERE id='lot-2'");
    }
});

test('tree-space correction refuses unexpected old numbers without changing capacity', async () => {
    await pool.query("INSERT INTO parking_lots(id,name,capacity) VALUES ('lot-2','Lot 2',206)");
    await pool.query("INSERT INTO parking_spaces(lot_id,spot_number,status) VALUES ('lot-2',207,'occupied')");
    const client = await pool.connect();
    try {
        await assert.rejects(client.query(fs.readFileSync('migrations/009-lot2-remove-tree-space.sql', 'utf8')), /想定外の枠番号/);
        await client.query('ROLLBACK');
        assert.equal((await pool.query("SELECT capacity FROM parking_lots WHERE id='lot-2'")).rows[0].capacity, 206);
        assert.equal((await pool.query("SELECT spot_number FROM parking_spaces WHERE lot_id='lot-2'")).rows[0].spot_number, 207);
    } finally {
        await client.query('ROLLBACK');
        client.release();
        await pool.query("DELETE FROM parking_lots WHERE id='lot-2'");
    }
});

test('second-lot clients with the old layout cannot register renumbered spaces', async () => {
    await pool.query("INSERT INTO parking_lots(id,name,capacity,image_url) VALUES ('lot-2','Lot 2',205,'/images/img2-system.svg')");
    try {
        for (const layoutVersion of [undefined,1]) {
            const result = await request('/parking/checkin', { userId: 'test-a', lotId: 2, spaceId: 176, endTime: '未定', layoutVersion });
            assert.equal(result.status, 409);
            assert.ok(result.body.message.includes('再読み込み'));
        }
        assert.equal((await pool.query('SELECT * FROM parking_sessions')).rowCount, 0);
        assert.equal((await request('/parking/checkin', { userId: 'test-a', lotId: 2, spaceId: 205, endTime: '未定', layoutVersion: 2 })).status, 200);
        assert.equal((await request('/parking/checkout', { userId: 'test-a' })).status, 200);
    } finally {
        await pool.query("DELETE FROM parking_lots WHERE id='lot-2'");
    }
});

test('third-lot provisional publication preserves existing records and exposes 706 spaces', async () => {
    for (const [id, capacity] of [[1,530], [2,205], [3,693], [4,78], [7,93]]) {
        await pool.query('INSERT INTO parking_lots(id,name,capacity,image_url) VALUES ($1,$2,$3,$4)',
            [`lot-${id}`, `Lot ${id}`, capacity, `/images/img${id}.jpg`]);
    }
    await pool.query("INSERT INTO parking_spaces(lot_id,spot_number,status) VALUES ('lot-3',693,'available'),('lot-5',61,'occupied')");
    await pool.query("INSERT INTO parking_sessions(user_id,lot_id,space_id,estimated_end_time) VALUES ('test-b','lot-5',61,'15:30')");
    const beforeLots = (await pool.query("SELECT * FROM parking_lots WHERE id <> 'lot-3' ORDER BY id")).rows;
    const beforeSpaces = (await pool.query('SELECT * FROM parking_spaces ORDER BY id')).rows;
    const beforeSessions = (await pool.query('SELECT * FROM parking_sessions ORDER BY session_id')).rows;
    try {
        await pool.query(fs.readFileSync('migrations/010-lot3-provisional-map.sql', 'utf8'));
        assert.deepEqual((await pool.query("SELECT * FROM parking_lots WHERE id <> 'lot-3' ORDER BY id")).rows, beforeLots);
        assert.deepEqual((await pool.query('SELECT * FROM parking_spaces ORDER BY id')).rows, beforeSpaces);
        assert.deepEqual((await pool.query('SELECT * FROM parking_sessions ORDER BY session_id')).rows, beforeSessions);
        const listing = await request('/parking-data');
        assert.equal(listing.body.reduce((sum, lot) => sum + lot.capacity, 0), 1673);
        const third = listing.body.find(lot => lot.id === 3);
        assert.equal(third.capacity, 706);
        assert.equal(third.available, 706);
        assert.equal(third.imageUrl, 'images/img3-system.svg');
        for (const layoutVersion of [undefined,0]) {
            assert.equal((await request('/parking/checkin', { userId: 'test-a', lotId: 3, spaceId: 706, endTime: '未定', layoutVersion })).status, 409);
        }
        assert.deepEqual((await pool.query('SELECT * FROM parking_sessions ORDER BY session_id')).rows, beforeSessions);
        assert.equal((await request('/parking/checkin', { userId: 'test-a', lotId: 3, spaceId: 707, endTime: '未定', layoutVersion: 1 })).status, 400);
        assert.equal((await request('/parking/checkin', { userId: 'test-a', lotId: 3, spaceId: 706, endTime: '15:30', layoutVersion: 1 })).status, 200);
        assert.equal((await request('/parking-data')).body.find(lot => lot.id === 3).available, 705);
        assert.ok((await request('/parking/status')).body.some(spot => spot.lot_id === '3' && spot.spot_number === 706 && spot.status === 'occupied'));
        assert.equal((await request('/parking/checkout', { userId: 'test-a' })).status, 200);
        assert.equal((await request('/parking-data')).body.find(lot => lot.id === 3).available, 706);
        assert.deepEqual((await pool.query('SELECT * FROM parking_sessions ORDER BY session_id')).rows, beforeSessions);
    } finally {
        await pool.query("DELETE FROM parking_lots WHERE id <> 'lot-5'");
    }
});

test('third-lot publication stops atomically for parked cars or unexpected old numbers', async () => {
    await pool.query("INSERT INTO parking_lots(id,name,capacity,image_url) VALUES ('lot-3','Lot 3',693,'/images/img3.jpg')");
    const client = await pool.connect();
    try {
        for (const kind of ['session','occupied','out-of-range']) {
            await pool.query('DELETE FROM parking_sessions');
            await pool.query('DELETE FROM parking_spaces');
            await pool.query("INSERT INTO parking_spaces(lot_id,spot_number,status) VALUES ('lot-3',$1,$2)",
                [kind === 'out-of-range' ? 694 : 1, kind === 'occupied' ? 'occupied' : 'available']);
            if (kind === 'session') await pool.query("INSERT INTO parking_sessions(user_id,lot_id,space_id) VALUES ('test-a','lot-3',1)");
            const spaces = (await pool.query('SELECT * FROM parking_spaces')).rows;
            const sessions = (await pool.query('SELECT * FROM parking_sessions')).rows;
            await assert.rejects(client.query(fs.readFileSync('migrations/010-lot3-provisional-map.sql', 'utf8')),
                kind === 'out-of-range' ? /想定外の枠番号/ : /第3駐車場に駐車記録/);
            await client.query('ROLLBACK');
            assert.deepEqual((await pool.query('SELECT * FROM parking_spaces')).rows, spaces);
            assert.deepEqual((await pool.query('SELECT * FROM parking_sessions')).rows, sessions);
            assert.deepEqual((await pool.query("SELECT capacity,image_url FROM parking_lots WHERE id='lot-3'")).rows[0],
                { capacity: 693, image_url: '/images/img3.jpg' });
        }
    } finally {
        await client.query('ROLLBACK');
        client.release();
        await pool.query("DELETE FROM parking_lots WHERE id='lot-3'");
    }
});

test('fourth-lot publication preserves all DB records and supports 78 spaces with the new layout', async () => {
    await pool.query("INSERT INTO parking_lots(id,name,capacity,image_url) VALUES ('lot-4','Lot 4',78,'/images/img4.jpg')");
    await pool.query("INSERT INTO parking_spaces(lot_id,spot_number,status) VALUES ('lot-4',78,'available'),('lot-5',61,'occupied')");
    await pool.query("INSERT INTO parking_sessions(user_id,lot_id,space_id,estimated_end_time) VALUES ('test-b','lot-5',61,'15:30')");
    const beforeLots = (await pool.query('SELECT * FROM parking_lots ORDER BY id')).rows;
    const beforeSpaces = (await pool.query('SELECT * FROM parking_spaces ORDER BY id')).rows;
    const beforeSessions = (await pool.query('SELECT * FROM parking_sessions ORDER BY session_id')).rows;
    try {
        await pool.query(fs.readFileSync('migrations/011-lot4-map-publication.sql', 'utf8'));
        assert.deepEqual((await pool.query('SELECT * FROM parking_lots ORDER BY id')).rows, beforeLots);
        assert.deepEqual((await pool.query('SELECT * FROM parking_spaces ORDER BY id')).rows, beforeSpaces);
        assert.deepEqual((await pool.query('SELECT * FROM parking_sessions ORDER BY session_id')).rows, beforeSessions);
        const lot = (await request('/parking-data')).body.find(lot => lot.id === 4);
        assert.equal(lot.capacity, 78);
        assert.equal(lot.available, 78);
        assert.equal(lot.imageUrl, 'images/img4.jpg');
        for (const layoutVersion of [undefined,0]) {
            assert.equal((await request('/parking/checkin', { userId: 'test-a', lotId: 4, spaceId: 78, endTime: '未定', layoutVersion })).status, 409);
        }
        assert.deepEqual((await pool.query('SELECT * FROM parking_sessions ORDER BY session_id')).rows, beforeSessions);
        assert.equal((await request('/parking/checkin', { userId: 'test-a', lotId: 4, spaceId: 79, endTime: '未定', layoutVersion: 1 })).status, 400);
        assert.equal((await request('/parking/checkin', { userId: 'test-a', lotId: 4, spaceId: 78, endTime: '15:30', layoutVersion: 1 })).status, 200);
        assert.equal((await request('/parking-data')).body.find(lot => lot.id === 4).available, 77);
        assert.ok((await request('/parking/status')).body.some(spot => spot.lot_id === '4' && spot.spot_number === 78 && spot.status === 'occupied'));
        assert.equal((await request('/parking/checkout', { userId: 'test-a' })).status, 200);
        assert.equal((await request('/parking-data')).body.find(lot => lot.id === 4).available, 78);
        assert.deepEqual((await pool.query('SELECT * FROM parking_sessions ORDER BY session_id')).rows, beforeSessions);
    } finally {
        await pool.query("DELETE FROM parking_lots WHERE id='lot-4'");
    }
});

test('fourth-lot publication stops without changing records for parked cars or unexpected settings', async () => {
    await pool.query("INSERT INTO parking_lots(id,name,capacity,image_url) VALUES ('lot-4','Lot 4',78,'/images/img4.jpg')");
    const client = await pool.connect();
    try {
        for (const kind of ['session','occupied','out-of-range','capacity']) {
            await pool.query('DELETE FROM parking_sessions');
            await pool.query('DELETE FROM parking_spaces');
            await pool.query("UPDATE parking_lots SET capacity=$1 WHERE id='lot-4'", [kind === 'capacity' ? 77 : 78]);
            await pool.query("INSERT INTO parking_spaces(lot_id,spot_number,status) VALUES ('lot-4',$1,$2)",
                [kind === 'out-of-range' ? 79 : 1, kind === 'occupied' ? 'occupied' : 'available']);
            if (kind === 'session') await pool.query("INSERT INTO parking_sessions(user_id,lot_id,space_id) VALUES ('test-a','lot-4',1)");
            const lots = (await pool.query('SELECT * FROM parking_lots ORDER BY id')).rows;
            const spaces = (await pool.query('SELECT * FROM parking_spaces')).rows;
            const sessions = (await pool.query('SELECT * FROM parking_sessions')).rows;
            const error = kind === 'out-of-range' ? /想定外の枠番号/ : kind === 'capacity' ? /第4駐車場の設定/ : /第4駐車場に駐車記録/;
            await assert.rejects(client.query(fs.readFileSync('migrations/011-lot4-map-publication.sql', 'utf8')), error);
            await client.query('ROLLBACK');
            assert.deepEqual((await pool.query('SELECT * FROM parking_lots ORDER BY id')).rows, lots);
            assert.deepEqual((await pool.query('SELECT * FROM parking_spaces')).rows, spaces);
            assert.deepEqual((await pool.query('SELECT * FROM parking_sessions')).rows, sessions);
        }
    } finally {
        await client.query('ROLLBACK');
        client.release();
        await pool.query("DELETE FROM parking_lots WHERE id='lot-4'");
    }
});

test('seventh-lot provisional publication preserves records and exposes 102 spaces', async () => {
    for (const [id, capacity] of [[1,530], [2,205], [3,706], [4,78], [7,93]]) {
        await pool.query('INSERT INTO parking_lots(id,name,capacity,image_url) VALUES ($1,$2,$3,$4)',
            [`lot-${id}`, `Lot ${id}`, capacity, `/images/img${id}.jpg`]);
    }
    await pool.query("INSERT INTO parking_spaces(lot_id,spot_number,status) VALUES ('lot-7',93,'available'),('lot-5',61,'occupied')");
    await pool.query("INSERT INTO parking_sessions(user_id,lot_id,space_id,estimated_end_time) VALUES ('test-b','lot-5',61,'15:30')");
    const beforeLots = (await pool.query("SELECT * FROM parking_lots WHERE id <> 'lot-7' ORDER BY id")).rows;
    const beforeSpaces = (await pool.query('SELECT * FROM parking_spaces ORDER BY id')).rows;
    const beforeSessions = (await pool.query('SELECT * FROM parking_sessions ORDER BY session_id')).rows;
    try {
        await pool.query(fs.readFileSync('migrations/012-lot7-provisional-map.sql', 'utf8'));
        assert.deepEqual((await pool.query("SELECT * FROM parking_lots WHERE id <> 'lot-7' ORDER BY id")).rows, beforeLots);
        assert.deepEqual((await pool.query('SELECT * FROM parking_spaces ORDER BY id')).rows, beforeSpaces);
        assert.deepEqual((await pool.query('SELECT * FROM parking_sessions ORDER BY session_id')).rows, beforeSessions);
        const listing = await request('/parking-data');
        assert.equal(listing.body.reduce((sum, lot) => sum + lot.capacity, 0), 1682);
        const lot = listing.body.find(lot => lot.id === 7);
        assert.equal(lot.capacity, 102);
        assert.equal(lot.available, 102);
        assert.equal(lot.imageUrl, 'images/img7-system.svg');
        for (const layoutVersion of [undefined,0]) {
            assert.equal((await request('/parking/checkin', { userId: 'test-a', lotId: 7, spaceId: 102, endTime: '未定', layoutVersion })).status, 409);
        }
        assert.deepEqual((await pool.query('SELECT * FROM parking_sessions ORDER BY session_id')).rows, beforeSessions);
        assert.equal((await request('/parking/checkin', { userId: 'test-a', lotId: 7, spaceId: 103, endTime: '未定', layoutVersion: 2 })).status, 400);
        assert.equal((await request('/parking/checkin', { userId: 'test-a', lotId: 7, spaceId: 102, endTime: '15:30', layoutVersion: 2 })).status, 200);
        assert.equal((await request('/parking-data')).body.find(lot => lot.id === 7).available, 101);
        assert.ok((await request('/parking/status')).body.some(spot => spot.lot_id === '7' && spot.spot_number === 102 && spot.status === 'occupied'));
        assert.equal((await request('/parking/checkout', { userId: 'test-a' })).status, 200);
        assert.equal((await request('/parking-data')).body.find(lot => lot.id === 7).available, 102);
        assert.deepEqual((await pool.query('SELECT * FROM parking_sessions ORDER BY session_id')).rows, beforeSessions);
    } finally {
        await pool.query("DELETE FROM parking_lots WHERE id <> 'lot-5'");
    }
});

test('seventh-lot publication refuses parked cars or unexpected settings without discarding records', async () => {
    await pool.query("INSERT INTO parking_lots(id,name,capacity,image_url) VALUES ('lot-7','Lot 7',93,'/images/img7.jpg')");
    const client = await pool.connect();
    try {
        for (const kind of ['session','occupied','out-of-range','capacity']) {
            await pool.query('DELETE FROM parking_sessions');
            await pool.query('DELETE FROM parking_spaces');
            await pool.query("UPDATE parking_lots SET capacity=$1 WHERE id='lot-7'", [kind === 'capacity' ? 92 : 93]);
            await pool.query("INSERT INTO parking_spaces(lot_id,spot_number,status) VALUES ('lot-7',$1,$2)",
                [kind === 'out-of-range' ? 94 : 1, kind === 'occupied' ? 'occupied' : 'available']);
            if (kind === 'session') await pool.query("INSERT INTO parking_sessions(user_id,lot_id,space_id) VALUES ('test-a','lot-7',1)");
            const lots = (await pool.query('SELECT * FROM parking_lots ORDER BY id')).rows;
            const spaces = (await pool.query('SELECT * FROM parking_spaces')).rows;
            const sessions = (await pool.query('SELECT * FROM parking_sessions')).rows;
            const error = kind === 'out-of-range' ? /想定外の枠番号/ : kind === 'capacity' ? /第7駐車場の変更前/ : /第7駐車場に駐車記録/;
            await assert.rejects(client.query(fs.readFileSync('migrations/012-lot7-provisional-map.sql', 'utf8')), error);
            await client.query('ROLLBACK');
            assert.deepEqual((await pool.query('SELECT * FROM parking_lots ORDER BY id')).rows, lots);
            assert.deepEqual((await pool.query('SELECT * FROM parking_spaces')).rows, spaces);
            assert.deepEqual((await pool.query('SELECT * FROM parking_sessions')).rows, sessions);
        }
    } finally {
        await client.query('ROLLBACK');
        client.release();
        await pool.query("DELETE FROM parking_lots WHERE id='lot-7'");
    }
});

test('seventh-lot area renumbering preserves all 102 records and active sessions and opens the two added bays', async () => {
    const numbering = JSON.parse(fs.readFileSync('docs/lot-7-renumbering-v2.json', 'utf8'));
    const numberMap = new Map(numbering.mappings.map(row => [row.oldNumber, row.newNumber]));
    for (const [id, capacity] of [[1,530], [2,205], [3,706], [4,78], [7,102]]) {
        await pool.query('INSERT INTO parking_lots(id,name,capacity,image_url) VALUES ($1,$2,$3,$4)',
            [`lot-${id}`, `Lot ${id}`, capacity, `/images/img${id}.jpg`]);
    }
    await pool.query(`INSERT INTO parking_spaces(lot_id,spot_number,status,updated_at)
        SELECT CASE WHEN number % 2 = 0 THEN '7' ELSE 'lot-7' END, number,
            CASE WHEN number IN (22,50) THEN 'occupied' ELSE 'available' END, '2026-01-01 10:00:00'::timestamp
        FROM generate_series(1,102) number`);
    await pool.query("INSERT INTO parking_spaces(lot_id,spot_number,status) VALUES ('lot-5',61,'available')");
    await pool.query(`INSERT INTO parking_sessions(user_id,lot_id,space_id,estimated_end_time)
        VALUES ('test-a','7',22,'15:30'), ('test-b','lot-7',50,'16:30')`);
    const beforeLots = (await pool.query("SELECT * FROM parking_lots WHERE id <> 'lot-7' ORDER BY id")).rows;
    const beforeSpaces = (await pool.query('SELECT * FROM parking_spaces ORDER BY id')).rows;
    const beforeSessions = (await pool.query('SELECT * FROM parking_sessions ORDER BY session_id')).rows;
    const expectedSpaces = beforeSpaces.map(row => row.lot_id === 'lot-5' ? row :
        { ...row, lot_id: 'lot-7', spot_number: numberMap.get(row.spot_number) });
    const expectedSessions = beforeSessions.map(row => ({ ...row, lot_id: 'lot-7', space_id: numberMap.get(row.space_id) }));
    try {
        await pool.query(fs.readFileSync('migrations/013-lot7-area-numbering.sql', 'utf8'));
        assert.deepEqual((await pool.query("SELECT * FROM parking_lots WHERE id <> 'lot-7' ORDER BY id")).rows, beforeLots);
        assert.deepEqual((await pool.query('SELECT * FROM parking_spaces ORDER BY id')).rows, expectedSpaces);
        assert.deepEqual((await pool.query('SELECT * FROM parking_sessions ORDER BY session_id')).rows, expectedSessions);
        const listing = await request('/parking-data');
        assert.equal(listing.body.reduce((sum, lot) => sum + lot.capacity, 0), 1684);
        const lot = listing.body.find(lot => lot.id === 7);
        assert.equal(lot.capacity, 104);
        assert.equal(lot.available, 102);
        assert.equal(lot.imageUrl, 'images/img7-system.svg');
        assert.equal(lot.spaces[34].endTime, '15:30');
        assert.equal(lot.spaces[23].endTime, '16:30');
        for (const id of [22,23,104]) assert.equal(lot.spaces[id - 1].isParked, false);
        for (const layoutVersion of [undefined,0,1]) {
            assert.equal((await request('/parking/checkin', { userId: 'test-a', lotId: 7, spaceId: 22, endTime: '未定', layoutVersion })).status, 409);
        }
        assert.deepEqual((await pool.query('SELECT * FROM parking_sessions ORDER BY session_id')).rows, expectedSessions);
        for (const userId of ['test-a','test-b']) assert.equal((await request('/parking/checkout', { userId })).status, 200);
        for (const id of [22,23,104]) {
            assert.equal((await request('/parking/checkin', { userId: 'test-a', lotId: 7, spaceId: id, endTime: '未定', layoutVersion: 2 })).status, 200);
            assert.ok((await request('/parking/status')).body.some(row => row.lot_id === '7' && row.spot_number === id && row.status === 'occupied'));
            assert.equal((await request('/parking/checkout', { userId: 'test-a' })).status, 200);
        }
        assert.equal((await request('/parking/checkin', { userId: 'test-a', lotId: 7, spaceId: 105, endTime: '未定', layoutVersion: 2 })).status, 400);
        assert.equal((await request('/parking-data')).body.find(lot => lot.id === 7).available, 104);
    } finally {
        await pool.query("DELETE FROM parking_lots WHERE id <> 'lot-5'");
    }
});

test('seventh-lot area renumbering rejects unexpected numbers, duplicate states, and capacities atomically', async () => {
    await pool.query("INSERT INTO parking_lots(id,name,capacity,image_url) VALUES ('lot-7','Lot 7',102,'/images/img7-system.svg')");
    const client = await pool.connect();
    try {
        for (const kind of ['space-range','session-range','space-null','session-null','duplicate','capacity']) {
            await pool.query('DELETE FROM parking_sessions');
            await pool.query('DELETE FROM parking_spaces');
            await pool.query("UPDATE parking_lots SET capacity=$1 WHERE id='lot-7'", [kind === 'capacity' ? 101 : 102]);
            await pool.query("INSERT INTO parking_spaces(lot_id,spot_number,status) VALUES ('lot-7',$1,'available')",
                [kind === 'space-range' ? 103 : kind === 'space-null' ? null : 1]);
            if (kind === 'duplicate') await pool.query("INSERT INTO parking_spaces(lot_id,spot_number,status) VALUES ('7',1,'available')");
            if (kind.startsWith('session-')) await pool.query("INSERT INTO parking_sessions(user_id,lot_id,space_id) VALUES ('test-a','7',$1)",
                [kind === 'session-null' ? null : 103]);
            const lots = (await pool.query('SELECT * FROM parking_lots ORDER BY id')).rows;
            const spaces = (await pool.query('SELECT * FROM parking_spaces ORDER BY id')).rows;
            const sessions = (await pool.query('SELECT * FROM parking_sessions ORDER BY session_id')).rows;
            const error = kind === 'capacity' ? /変更前の設定/ : kind === 'duplicate' ? /状態が重複/ : /想定外の枠番号/;
            await assert.rejects(client.query(fs.readFileSync('migrations/013-lot7-area-numbering.sql', 'utf8')), error);
            await client.query('ROLLBACK');
            assert.deepEqual((await pool.query('SELECT * FROM parking_lots ORDER BY id')).rows, lots);
            assert.deepEqual((await pool.query('SELECT * FROM parking_spaces ORDER BY id')).rows, spaces);
            assert.deepEqual((await pool.query('SELECT * FROM parking_sessions ORDER BY session_id')).rows, sessions);
        }
    } finally {
        await client.query('ROLLBACK');
        client.release();
        await pool.query("DELETE FROM parking_lots WHERE id='lot-7'");
    }
});
