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
        const seventh = await request('/parking/checkin', { userId: 'test-a', lotId: 7, spaceId: 1, endTime: '15:30' });
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
