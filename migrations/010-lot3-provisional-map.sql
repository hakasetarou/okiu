BEGIN;

-- 図面の693台とは分けて、位置を確認するための暫定706枠を公開する。
LOCK TABLE parking_lots, parking_spaces, parking_sessions IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
    IF (SELECT COUNT(*) FROM parking_lots WHERE id IN ('lot-3', '3')) <> 1
        OR NOT EXISTS (SELECT 1 FROM parking_lots WHERE id IN ('lot-3', '3') AND capacity = 693)
    THEN
        RAISE EXCEPTION '第3駐車場の変更前の設定（693台）を確認してください。';
    END IF;
    -- 旧番号だけの登録から実際の位置を判断できないため、使用中なら変更を止める。
    IF EXISTS (SELECT 1 FROM parking_sessions WHERE lot_id IN ('lot-3', '3'))
        OR EXISTS (SELECT 1 FROM parking_spaces WHERE lot_id IN ('lot-3', '3') AND status = 'occupied')
    THEN
        RAISE EXCEPTION '第3駐車場に駐車記録があります。出庫・位置の確認後に変更してください。';
    END IF;
    IF EXISTS (
        SELECT 1 FROM parking_spaces WHERE lot_id IN ('lot-3', '3')
            AND (spot_number IS NULL OR spot_number < 1 OR spot_number > 693)
    ) THEN
        RAISE EXCEPTION '第3駐車場に想定外の枠番号があります。既存データを確認してください。';
    END IF;
END $$;

UPDATE parking_lots SET capacity = 706, image_url = '/images/img3-system.svg'
WHERE id IN ('lot-3', '3');

COMMIT;
