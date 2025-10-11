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

// 2. ログインAPI (データベース対応版)
router.post('/login', async (req, res) => {
    const { studentId, password } = req.body;
    try {
        const query = 'SELECT * FROM users WHERE student_id = $1';
        const result = await pool.query(query, [studentId]);

        if (result.rows.length === 0) {
            // ユーザーが見つからない
            return res.status(401).json({ message: '学籍番号またはパスワードが正しくありません。' });
        }

        const user = result.rows[0];
        // パスワードの比較（現状は平文比較。将来的にはハッシュ化が望ましい）
        if (user.password === password) {
            console.log('User logged in from DB:', { studentId: user.student_id, name: user.name });
            // ログイン成功時に返すユーザー情報からパスワードを除外する
            res.json({
                message: 'ログイン成功',
                user: { studentId: user.student_id, name: user.name }
                // myParkingInfoは別途実装が必要
            });
        } else {
            // パスワードが違う
            res.status(401).json({ message: '学籍番号またはパスワードが正しくありません。' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'データベースエラーが発生しました。' });
    }
});


// ...駐車場関連のAPIは、同様にデータベースに問い合わせる形に修正が必要です...


// module.exports はファイルの最後に記述
module.exports = router;