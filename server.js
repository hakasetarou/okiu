// server.js

// 必要なモジュールを読み込む
const express = require('express');
const cors = require('cors');
const app = express();
const path = require('path');
const apiRoutes = require('./routes'); // ★★★ 修正点: routes/index.js を読み込む
const PORT = 3000;

// --- Middleware ---
// POSTリクエストのbodyをJSONとして解析するために必要
app.use(express.json());
// 静的ファイル（HTML, CSS, JS）を配信するフォルダを指定
app.use(express.static(path.join(__dirname, 'public')));
// '/api'で始まるリクエストは全てapiRoutesに処理を任せる
app.use(cors()); 
app.use('/api', apiRoutes);

// --- サーバー起動 ---
app.listen(PORT, () => {
    console.log(`サーバーがポート ${PORT} で起動しました。 http://localhost:${PORT}`);
});

// ★★★ 注記: ここにあったAPI関連の記述は全て削除しました ★★★