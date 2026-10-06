BEGIN;

-- 地図の余分な旧22番を除き、旧23〜62番を新22〜61番にそろえる。
-- 更新中に別の操作が番号を変更しないよう、対象テーブルを一時的にロックする。
LOCK TABLE parking_spaces, parking_sessions IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM parking_sessions
        WHERE lot_id IN ('lot-5', '5') AND space_id = 22
    ) OR EXISTS (
        SELECT 1 FROM parking_spaces
        WHERE lot_id IN ('lot-5', '5') AND spot_number = 22 AND status = 'occupied'
    ) THEN
        RAISE EXCEPTION '余分な旧22番に駐車記録があります。記録を確認してから番号を修正してください。';
    END IF;
    IF EXISTS (
        SELECT 1 FROM parking_sessions
        WHERE lot_id IN ('lot-5', '5') AND (space_id < 1 OR space_id > 62)
    ) OR EXISTS (
        SELECT 1 FROM parking_spaces
        WHERE lot_id IN ('lot-5', '5') AND (spot_number < 1 OR spot_number > 62)
    ) THEN
        RAISE EXCEPTION '第5駐車場に想定外の枠番号があります。既存データを確認してください。';
    END IF;
END $$;

-- 旧サーバーが保存した数値形式の駐車場IDも、DBの設定にそろえる。
UPDATE parking_spaces p SET lot_id = l.id FROM parking_lots l
WHERE p.lot_id IN ('5', 'lot-5') AND l.id IN ('5', 'lot-5') AND p.lot_id <> l.id;
UPDATE parking_sessions s SET lot_id = l.id FROM parking_lots l
WHERE s.lot_id IN ('5', 'lot-5') AND l.id IN ('5', 'lot-5') AND s.lot_id <> l.id;

-- 余分な枠の空き状態だけを削除する。駐車中の記録があれば上で停止する。
DELETE FROM parking_spaces WHERE lot_id IN ('lot-5', '5') AND spot_number = 22 AND status = 'available';

-- 一時的な負の番号を使い、連続する枠の一意制約との衝突を防ぐ。
UPDATE parking_spaces SET spot_number = -spot_number
WHERE lot_id IN ('lot-5', '5') AND spot_number BETWEEN 23 AND 62;
UPDATE parking_sessions SET space_id = -space_id
WHERE lot_id IN ('lot-5', '5') AND space_id BETWEEN 23 AND 62;

UPDATE parking_spaces SET spot_number = -spot_number - 1
WHERE lot_id IN ('lot-5', '5') AND spot_number BETWEEN -62 AND -23;
UPDATE parking_sessions SET space_id = -space_id - 1
WHERE lot_id IN ('lot-5', '5') AND space_id BETWEEN -62 AND -23;

UPDATE parking_lots SET capacity = 61 WHERE id IN ('lot-5', '5');

COMMIT;
