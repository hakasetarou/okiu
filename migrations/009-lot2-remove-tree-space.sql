BEGIN;

-- 現地確認で木のある旧176番を除き、旧177〜206番を新176〜205番へ変更する。
-- 元の図面は保存し、表示用地図の左上に205台と表記する。
LOCK TABLE parking_lots, parking_spaces, parking_sessions IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
    IF (SELECT COUNT(*) FROM parking_lots WHERE id IN ('lot-2', '2')) <> 1
        OR NOT EXISTS (SELECT 1 FROM parking_lots WHERE id IN ('lot-2', '2') AND capacity = 206)
    THEN
        RAISE EXCEPTION '第2駐車場の変更前の設定（206台）を確認してください。';
    END IF;
    IF EXISTS (
        SELECT 1 FROM parking_sessions WHERE lot_id IN ('lot-2', '2') AND space_id = 176
    ) OR EXISTS (
        SELECT 1 FROM parking_spaces
        WHERE lot_id IN ('lot-2', '2') AND spot_number = 176 AND status = 'occupied'
    ) THEN
        RAISE EXCEPTION '木のある旧176番に駐車記録があります。出庫・記録の確認後に変更してください。';
    END IF;
    IF EXISTS (
        SELECT 1 FROM parking_sessions
        WHERE lot_id IN ('lot-2', '2') AND (space_id IS NULL OR space_id < 1 OR space_id > 206)
    ) OR EXISTS (
        SELECT 1 FROM parking_spaces
        WHERE lot_id IN ('lot-2', '2') AND (spot_number IS NULL OR spot_number < 1 OR spot_number > 206)
    ) THEN
        RAISE EXCEPTION '第2駐車場に想定外の枠番号があります。既存データを確認してください。';
    END IF;
END $$;

UPDATE parking_spaces p SET lot_id = l.id FROM parking_lots l
WHERE p.lot_id IN ('2', 'lot-2') AND l.id IN ('2', 'lot-2') AND p.lot_id <> l.id;
UPDATE parking_sessions s SET lot_id = l.id FROM parking_lots l
WHERE s.lot_id IN ('2', 'lot-2') AND l.id IN ('2', 'lot-2') AND s.lot_id <> l.id;

DELETE FROM parking_spaces WHERE lot_id IN ('lot-2', '2') AND spot_number = 176;

-- 一時的な負の番号を使い、一意制約との衝突を防ぐ。
UPDATE parking_spaces SET spot_number = -spot_number
WHERE lot_id IN ('lot-2', '2') AND spot_number BETWEEN 177 AND 206;
UPDATE parking_sessions SET space_id = -space_id
WHERE lot_id IN ('lot-2', '2') AND space_id BETWEEN 177 AND 206;

UPDATE parking_spaces SET spot_number = -spot_number - 1
WHERE lot_id IN ('lot-2', '2') AND spot_number BETWEEN -206 AND -177;
UPDATE parking_sessions SET space_id = -space_id - 1
WHERE lot_id IN ('lot-2', '2') AND space_id BETWEEN -206 AND -177;

UPDATE parking_lots SET capacity = 205, image_url = '/images/img2-system.svg'
WHERE id IN ('lot-2', '2');

COMMIT;
