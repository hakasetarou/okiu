const express = require('express');
const fs = require('fs');
const path = require('path');

// DBの「lot-5」と画面の「5」を同じ駐車場として扱う。
function lotNumber(value) {
    const match = /^(?:lot-)?([1-9]\d*)$/.exec(String(value));
    return match ? Number(match[1]) : null;
}

function sessionForScreen(session) {
    return session ? { ...session, lot_id: String(lotNumber(session.lot_id)) } : null;
}

function imageForScreen(imageUrl) {
    const relativePath = String(imageUrl || '').replace(/^(?:\.\/|\/)/, '');
    if (!/^images\/[\w.-]+$/.test(relativePath)) return null;
    return fs.existsSync(path.join(__dirname, 'public', relativePath)) ? relativePath : null;
}

function parkingError(status, message) {
    return Object.assign(new Error(message), { status });
}

// 駐車記録と枠の状態を合わせて取得し、退庫予定時刻も返す。
const STATUS_QUERY = `
    SELECT COALESCE(p.lot_id, s.lot_id) AS lot_id,
           COALESCE(p.spot_number, s.space_id) AS spot_number,
           CASE WHEN p.status = 'occupied' OR s.user_id IS NOT NULL
                THEN 'occupied' ELSE 'available' END AS status,
           s.estimated_end_time AS end_time
    FROM parking_spaces p
    FULL OUTER JOIN parking_sessions s
        ON p.lot_id = s.lot_id AND p.spot_number = s.space_id
`;

function createParkingRouter(pool) {
    const router = express.Router();

    async function findLot(client, requestedId) {
        const number = lotNumber(requestedId);
        if (!number) throw parkingError(400, '駐車場番号が正しくありません。');
        const result = await client.query(
            'SELECT id, name, capacity, image_url FROM parking_lots WHERE id = $1 OR id = $2',
            [String(number), `lot-${number}`]
        );
        if (result.rows.length !== 1) throw parkingError(400, '駐車場の設定を確認してください。');
        return result.rows[0];
    }

    // 処理が途中で失敗したら、DBを操作前の状態に戻す。
    async function transaction(res, operation) {
        let client;
        try {
            client = await pool.connect();
            await client.query('BEGIN');
            const result = await operation(client);
            await client.query('COMMIT');
            res.json(result);
        } catch (error) {
            if (client) await client.query('ROLLBACK').catch(() => {});
            const status = error.status || (error.code === '23505' ? 409 : 500);
            if (status === 500) console.error('Parking operation failed:', error);
            res.status(status).json({
                message: error.status ? error.message : status === 409
                    ? '同じ利用者または駐車枠が既に登録されています。最新の状況を確認してください。'
                    : '駐車処理に失敗しました。時間をおいて再度お試しください。'
            });
        } finally {
            if (client) client.release();
        }
    }

    router.get('/parking-data', async (req, res) => {
        try {
            const lots = await pool.query('SELECT id, name, capacity, image_url FROM parking_lots ORDER BY id');
            const statuses = await pool.query(STATUS_QUERY);
            const data = lots.rows.map(lot => {
                const spaces = Array.from({ length: lot.capacity }, (_, index) => {
                    const number = index + 1;
                    const status = statuses.rows.find(row => row.lot_id === lot.id && row.spot_number === number);
                    return {
                        id: number,
                        isParked: status?.status === 'occupied',
                        endTime: status?.status === 'occupied' ? status.end_time || '未定' : null
                    };
                });
                return {
                    id: lotNumber(lot.id), name: lot.name, capacity: lot.capacity,
                    available: spaces.filter(space => !space.isParked).length,
                    imageUrl: imageForScreen(lot.image_url), spaces
                };
            });
            res.json(data);
        } catch (error) {
            console.error('Failed to get parking data:', error);
            res.status(500).json({ message: '駐車場データの取得に失敗しました。' });
        }
    });

    router.get('/parking/status', async (req, res) => {
        try {
            const result = await pool.query(STATUS_QUERY);
            res.json(result.rows.map(row => ({ ...row, lot_id: String(lotNumber(row.lot_id)) })));
        } catch (error) {
            console.error('Failed to fetch parking status:', error);
            res.status(500).json({ message: '空き状況を取得できません。時間をおいて再度お試しください。' });
        }
    });

    // 利用者の駐車記録を更新しない旧APIは、状態の不一致を防ぐため廃止。
    router.post('/parking/toggle', (req, res) => {
        res.status(410).json({ message: '駐車・出庫の登録操作を使用してください。' });
    });

    router.post('/parking/checkin', async (req, res) => {
        const { userId, lotId, spaceId, endTime, layoutVersion } = req.body || {};
        const spotNumber = Number(spaceId);
        if (typeof userId !== 'string' || !userId.trim() || !Number.isInteger(spotNumber) || spotNumber < 1 ||
            !(endTime === '未定' || (typeof endTime === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(endTime)))) {
            return res.status(400).json({ message: '利用者、駐車枠、退庫予定時刻の入力を確認してください。' });
        }
        const number = lotNumber(lotId);
        const expectedLayoutVersion = { 1: 4, 2: 2, 3: 1, 4: 1, 5: 2, 7: 2 }[number];
        if (expectedLayoutVersion && layoutVersion !== expectedLayoutVersion) {
            return res.status(409).json({ message: `第${number}駐車場の枠番号が更新されています。画面を再読み込みしてから登録してください。` });
        }

        await transaction(res, async client => {
            // 同じ利用者から同時に来た操作を、順番に処理する。
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`parking-user:${userId}`]);
            const user = await client.query('SELECT student_id FROM users WHERE student_id = $1', [userId]);
            if (!user.rows.length) throw parkingError(400, '利用者が見つかりません。ログインし直してください。');
            const lot = await findLot(client, lotId);
            if (spotNumber > lot.capacity) throw parkingError(400, 'この駐車場には指定した番号の枠がありません。');
            const existing = await client.query('SELECT session_id FROM parking_sessions WHERE user_id = $1', [userId]);
            if (existing.rows.length) throw parkingError(409, 'すでに駐車登録されています。出庫してから登録してください。');

            await client.query(`
                INSERT INTO parking_spaces (lot_id, spot_number, status)
                VALUES ($1, $2, 'available') ON CONFLICT (lot_id, spot_number) DO NOTHING
            `, [lot.id, spotNumber]);
            // 同じ枠への同時登録も、最初の操作が終わるまで待つ。
            const space = await client.query(
                'SELECT status FROM parking_spaces WHERE lot_id = $1 AND spot_number = $2 FOR UPDATE',
                [lot.id, spotNumber]
            );
            const parked = await client.query(
                'SELECT session_id FROM parking_sessions WHERE lot_id = $1 AND space_id = $2',
                [lot.id, spotNumber]
            );
            if (space.rows[0].status === 'occupied' || parked.rows.length) {
                throw parkingError(409, 'その駐車枠は使用中です。別の空き枠を選んでください。');
            }
            const result = await client.query(`
                INSERT INTO parking_sessions (user_id, lot_id, space_id, estimated_end_time)
                VALUES ($1, $2, $3, $4) RETURNING *
            `, [userId, lot.id, spotNumber, endTime]);
            await client.query(`
                UPDATE parking_spaces SET status = 'occupied', updated_at = CURRENT_TIMESTAMP
                WHERE lot_id = $1 AND spot_number = $2
            `, [lot.id, spotNumber]);
            return sessionForScreen(result.rows[0]);
        });
    });

    router.post('/parking/checkout', async (req, res) => {
        const { userId } = req.body || {};
        if (typeof userId !== 'string' || !userId.trim()) {
            return res.status(400).json({ message: '利用者の情報を確認してください。' });
        }
        await transaction(res, async client => {
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`parking-user:${userId}`]);
            const result = await client.query('SELECT lot_id, space_id FROM parking_sessions WHERE user_id = $1 FOR UPDATE', [userId]);
            if (!result.rows.length) throw parkingError(404, '駐車記録が見つかりません。');
            const session = result.rows[0];
            await client.query('DELETE FROM parking_sessions WHERE user_id = $1', [userId]);
            await client.query(`
                UPDATE parking_spaces SET status = 'available', updated_at = CURRENT_TIMESTAMP
                WHERE lot_id = $1 AND spot_number = $2
            `, [session.lot_id, session.space_id]);
            return { message: '出庫処理が完了しました。' };
        });
    });
    return router;
}

module.exports = { createParkingRouter, lotNumber, sessionForScreen };
