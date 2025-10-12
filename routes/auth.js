// routes/auth.js

const express = require('express');
const router = express.Router();
const pool = require('../db'); // ★★★ ステップ3で作成したdb.jsを読み込む ★★★

// --- データ管理部分を削除 ---
// let users = []; や let parkingData = ... はもう使いません。
// データは全てPostgreSQLが管理します。

// 1. 新規登録API (データベース対応版)
router.post('/register', async (req, res) => {
    const { studentId, name, password } = req.body;
    try {
        // SQLインジェクション攻撃を防ぐため、必ずプレースホルダ($1, $2)を使う
        const query = 'INSERT INTO users (student_id, name, password) VALUES ($1, $2, $3)';
        await pool.query(query, [studentId, name, password]);
        
        console.log('New user registered to DB:', { studentId, name });
        res.status(201).json({ message: '新規登録が完了しました。' });
    } catch (error) {
        console.error(error);
        // 学籍番号が重複した場合など
        if (error.code === '23505') { // 23505は一意性制約違反のエラーコード
            return res.status(409).json({ message: 'この学籍番号は既に使用されています。' });
        }
        res.status(500).json({ message: 'データベースエラーが発生しました。' });
    }
});

// 2. ログインAPI (駐車状況の確認機能付き)
router.post('/login', async (req, res) => {
    const { studentId, password } = req.body;
    try {
        const userQuery = 'SELECT * FROM users WHERE student_id = $1';
        const userResult = await pool.query(userQuery, [studentId]);

        if (userResult.rows.length === 0) {
            return res.status(401).json({ message: '学籍番号またはパスワードが正しくありません。' });
        }

        const user = userResult.rows[0];
        if (user.password !== password) {
            return res.status(401).json({ message: '学籍番号またはパスワードが正しくありません。' });
        }

        // ★★★ ここからが新しい処理 ★★★
        // ログインしたユーザーの駐車情報をparking_sessionsテーブルから探す
        const sessionQuery = 'SELECT * FROM parking_sessions WHERE user_id = $1';
        const sessionResult = await pool.query(sessionQuery, [user.student_id]);

        // 駐車情報が見つかればmyParkingInfoに設定、なければnull
        const myParkingInfo = sessionResult.rows.length > 0 ? sessionResult.rows[0] : null;
        // ★★★ ここまでが新しい処理 ★★★

        console.log('User logged in from DB:', { studentId: user.student_id, name: user.name });

        // フロントエンドに返す情報に、myParkingInfoを追加する
        res.json({
            message: 'ログイン成功',
            user: { studentId: user.student_id, name: user.name },
            myParkingInfo: myParkingInfo // ★★★ この行が重要！ ★★★
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'データベースエラーが発生しました。' });
    }
});
// ...駐車場関連のAPIは、同様にデータベースに問い合わせる形に修正が必要です...

// 3. 駐車場データを取得するAPI (各スペースの情報も追加)
router.get('/parking-data', async (req, res) => {
    try {
        // 1. まず全ての駐車場情報を取得
        const lotsResult = await pool.query('SELECT * FROM parking_lots ORDER BY name');
        const lots = lotsResult.rows;

        // 2. 次に現在駐車中のセッションを全て取得
        const sessionsResult = await pool.query('SELECT * FROM parking_sessions');
        const sessions = sessionsResult.rows;

        // 3. 駐車場データと駐車中セッションをJavaScriptで結合する
        const dataWithSpaces = lots.map(lot => {
            const parkedSessionsInLot = sessions.filter(s => s.lot_id === lot.id);

            // 各駐車場のスペース情報を生成する (1番からcapacity番まで)
            const spaces = [];
            for (let i = 1; i <= lot.capacity; i++) {
                const parkedSession = parkedSessionsInLot.find(s => s.space_id === i);
                spaces.push({
                    id: i,
                    isParked: !!parkedSession, // 駐車されていればtrue, そうでなければfalse
                    userId: parkedSession ? parkedSession.user_id : null
                });
            }

            // フロントエンドに返す最終的なデータ構造
            return {
                id: lot.id,
                name: lot.name,
                capacity: lot.capacity,
                available: lot.capacity - parkedSessionsInLot.length,
                spaces: spaces // ★★★ この詳細なスペース情報が追加された！ ★★★
            };
        });

        res.json(dataWithSpaces);

    } catch (error) {
        console.error('Failed to get parking data:', error);
        res.status(500).json({ message: 'データベースエラーで駐車場データの取得に失敗しました。' });
    }
});

// 4. 駐車（チェックイン）処理を行うAPI
router.post('/parking/checkin', async (req, res) => {
    // フロントエンドから送られてきた情報を取得
    const { userId, lotId, spaceId } = req.body;

    try {
        // 1. まず、その人が既に駐車していないか確認
        const existingSessionQuery = 'SELECT * FROM parking_sessions WHERE user_id = $1';
        const existingSession = await pool.query(existingSessionQuery, [userId]);
        if (existingSession.rows.length > 0) {
            return res.status(409).json({ message: '既に他の場所に駐車済みです。' });
        }

        // 2. 駐車記録をデータベースにINSERTする
        const insertQuery = `
            INSERT INTO parking_sessions (user_id, lot_id, space_id) 
            VALUES ($1, $2, $3) RETURNING *
        `;
        const result = await pool.query(insertQuery, [userId, lotId, spaceId]);

        console.log('User checked in:', result.rows[0]);
        // 成功したら、新しい駐車情報をフロントエンドに返す
        res.status(201).json(result.rows[0]);

    } catch (error) {
        // spaceIdが重複した場合など
        if (error.code === '23505') {
            return res.status(409).json({ message: 'その場所は既に使用されています。' });
        }
        console.error('Check-in failed:', error);
        res.status(500).json({ message: '駐車処理中にエラーが発生しました。' });
    }
});

// 5. 退庫（チェックアウト）処理を行うAPI
router.post('/parking/checkout', async (req, res) => {
    const { userId } = req.body;

    try {
        // 1. データベースからそのユーザーの駐車記録を削除する
        const deleteQuery = 'DELETE FROM parking_sessions WHERE user_id = $1 RETURNING *';
        const result = await pool.query(deleteQuery, [userId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: '駐車情報が見つかりませんでした。' });
        }

        console.log('User checked out:', result.rows[0]);
        // 成功したことをフロントエンドに伝える
        res.json({ message: '退庫が完了しました。' });

    } catch (error) {
        console.error('Check-out failed:', error);
        res.status(500).json({ message: '退庫処理中にエラーが発生しました。' });
    }
});
// module.exports はファイルの最後に記述
module.exports = router;