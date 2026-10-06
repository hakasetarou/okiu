const fs = require('fs');
const path = require('path');
const pool = require('../db');

(async () => {
    let client;
    try {
        client = await pool.connect();
        await client.query(`CREATE TABLE IF NOT EXISTS parking_schema_migrations (
            name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )`);
        const migrationDirectory = path.join(__dirname, '../migrations');
        const files = fs.readdirSync(migrationDirectory).filter(file => file.endsWith('.sql')).sort();
        for (const file of files) {
            await client.query('BEGIN');
            await client.query("SELECT pg_advisory_xact_lock(hashtext('parking-migrations'))");
            const applied = await client.query('SELECT name FROM parking_schema_migrations WHERE name = $1', [file]);
            if (!applied.rows.length) {
                // 各SQLと適用記録を、一つのトランザクションで保存する。
                const sql = fs.readFileSync(path.join(migrationDirectory, file), 'utf8')
                    .replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, '');
                await client.query(sql);
                await client.query('INSERT INTO parking_schema_migrations(name) VALUES ($1)', [file]);
            }
            await client.query('COMMIT');
        }
        console.log('駐車場IDの統一と、重複登録を防ぐDB設定を適用しました。');
    } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        console.error('DB設定を適用できませんでした。既存データの重複を確認してください。', error.code || error.message);
        process.exitCode = 1;
    } finally {
        if (client) client.release();
        await pool.end();
    }
})();
