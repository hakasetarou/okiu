BEGIN;

-- 利用者の確認に基づき、第5駐車場の収容台数を61台に修正する。
-- 範囲外の枠に駐車記録がある場合は、記録を隠さず修正を中止する。
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM parking_sessions
        WHERE lot_id IN ('lot-5', '5') AND space_id > 61
    ) OR EXISTS (
        SELECT 1 FROM parking_spaces
        WHERE lot_id IN ('lot-5', '5') AND spot_number > 61 AND status = 'occupied'
    ) THEN
        RAISE EXCEPTION '第5駐車場の62番以降に駐車記録があります。出庫状況を確認してください。';
    END IF;
END $$;

UPDATE parking_lots SET capacity = 61 WHERE id IN ('lot-5', '5');

COMMIT;
