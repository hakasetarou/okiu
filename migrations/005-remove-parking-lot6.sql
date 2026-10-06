BEGIN;

-- 第6駐車場を対象から除く。第7駐車場の番号は変更しない。
LOCK TABLE parking_lots, parking_spaces, parking_sessions IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM parking_sessions WHERE lot_id IN ('lot-6', '6')
    ) OR EXISTS (
        SELECT 1 FROM parking_spaces
        WHERE lot_id IN ('lot-6', '6') AND status = 'occupied'
    ) THEN
        RAISE EXCEPTION '第6駐車場に駐車記録があります。出庫を確認してから削除してください。';
    END IF;
END $$;

DELETE FROM parking_spaces WHERE lot_id IN ('lot-6', '6');
DELETE FROM parking_lots WHERE id IN ('lot-6', '6');

COMMIT;
