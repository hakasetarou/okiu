// db.js
const { Pool } = require('pg');

// データベースへの接続設定
// Poolは複数の接続を効率的に管理してくれます
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'parking_systems',
    password: '23db029ryu', // ★★★ 提供いただいたパスワードに修正しました ★★★
    port: 5432,
});

// 他のファイルからこのpoolオブジェクトを使えるようにする
module.exports = pool;