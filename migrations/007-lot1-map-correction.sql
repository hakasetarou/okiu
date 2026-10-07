BEGIN;

-- 利用者が確認した3枠を追加し、右下の余分な旧484番を削除する。
-- 旧485〜530番は新484〜529番へ移し、追加枠は530〜532番とする。
-- scripts/migrate.js が適用記録を保存し、この番号変更は一度だけ実行する。
LOCK TABLE parking_lots, parking_spaces, parking_sessions IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
    IF (SELECT COUNT(*) FROM parking_lots WHERE id IN ('lot-1', '1')) <> 1
        OR NOT EXISTS (SELECT 1 FROM parking_lots WHERE id IN ('lot-1', '1') AND capacity = 530)
    THEN
        RAISE EXCEPTION '第1駐車場の変更前の設定（530台）を確認してください。';
    END IF;

    IF EXISTS (
        SELECT 1 FROM parking_sessions WHERE lot_id IN ('lot-1', '1') AND space_id = 484
    ) OR EXISTS (
        SELECT 1 FROM parking_spaces
        WHERE lot_id IN ('lot-1', '1') AND spot_number = 484 AND status = 'occupied'
    ) THEN
        RAISE EXCEPTION '削除する第1駐車場の旧484番に駐車記録があります。出庫・記録の確認後に変更してください。';
    END IF;

    IF EXISTS (
        SELECT 1 FROM parking_sessions
        WHERE lot_id IN ('lot-1', '1') AND (space_id IS NULL OR space_id < 1 OR space_id > 530)
    ) OR EXISTS (
        SELECT 1 FROM parking_spaces
        WHERE lot_id IN ('lot-1', '1') AND (spot_number IS NULL OR spot_number < 1 OR spot_number > 530)
    ) THEN
        RAISE EXCEPTION '第1駐車場に想定外の枠番号があります。既存データを確認してください。';
    END IF;
END $$;

UPDATE parking_spaces p SET lot_id = l.id FROM parking_lots l
WHERE p.lot_id IN ('1', 'lot-1') AND l.id IN ('1', 'lot-1') AND p.lot_id <> l.id;
UPDATE parking_sessions s SET lot_id = l.id FROM parking_lots l
WHERE s.lot_id IN ('1', 'lot-1') AND l.id IN ('1', 'lot-1') AND s.lot_id <> l.id;

-- 駐車中なら上で停止する。空の旧484番の状態だけを削除する。
DELETE FROM parking_spaces WHERE lot_id IN ('lot-1', '1') AND spot_number = 484;

-- 一時的に負の番号へ移し、番号の一意制約との衝突を防ぐ。
UPDATE parking_spaces SET spot_number = -spot_number
WHERE lot_id IN ('lot-1', '1') AND spot_number BETWEEN 485 AND 530;
UPDATE parking_sessions SET space_id = -space_id
WHERE lot_id IN ('lot-1', '1') AND space_id BETWEEN 485 AND 530;

UPDATE parking_spaces SET spot_number = -spot_number - 1
WHERE lot_id IN ('lot-1', '1') AND spot_number BETWEEN -530 AND -485;
UPDATE parking_sessions SET space_id = -space_id - 1
WHERE lot_id IN ('lot-1', '1') AND space_id BETWEEN -530 AND -485;

UPDATE parking_lots SET capacity = 532 WHERE id IN ('lot-1', '1');

COMMIT;
