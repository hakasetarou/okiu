// 利用者登録・ログイン。駐車場のAPIはparking.jsで管理する。
const express = require('express');
const { createParkingRouter, sessionForScreen } = require('../parking');

function createAuthRouter(pool) {
    const router = express.Router();

    // ==========================================
    // 1. ユーザー認証関連 API
    // ==========================================

    // 新規登録API
    router.post('/register', async (req, res) => {
        const { studentId, name, password } = req.body;
        try {
            const query = 'INSERT INTO users (student_id, name, password) VALUES ($1, $2, $3)';
            await pool.query(query, [studentId, name, password]);

            console.log('New user registered to DB:', { studentId, name });
            res.status(201).json({ message: '新規登録が完了しました。' });
        } catch (error) {
            console.error(error);
            if (error.code === '23505') {
                return res.status(409).json({ message: 'この学籍番号は既に使用されています。' });
            }
            res.status(500).json({ message: 'データベースエラーが発生しました。' });
        }
    });

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

            // 現在の駐車情報を取得し、画面の駐車場番号にそろえて返す。
            const sessionQuery = 'SELECT * FROM parking_sessions WHERE user_id = $1';
            const sessionResult = await pool.query(sessionQuery, [studentId]);
            const activeSession = sessionResult.rows.length > 0 ? sessionResult.rows[0] : null;

            // 駐車情報を myParkingInfo にセットしてフロントエンドへ返す
            res.json({
                message: 'ログイン成功',
                user: { studentId: user.student_id, name: user.name },
                myParkingInfo: sessionForScreen(activeSession)
            });

        } catch (error) {
            console.error(error);
            res.status(500).json({ message: 'データベースエラーが発生しました。' });
        }
    });

    router.use(createParkingRouter(pool));
    return router;
}

module.exports = createAuthRouter(require('../db'));
module.exports.createAuthRouter = createAuthRouter;
