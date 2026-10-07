BEGIN;

-- 台数と元画像は維持する。旧番号だけの記録を新しい位置へ割り当てないよう公開前に確認する。
LOCK TABLE parking_lots, parking_spaces, parking_sessions IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
    IF (SELECT COUNT(*) FROM parking_lots WHERE id IN ('lot-4', '4')) <> 1
        OR NOT EXISTS (SELECT 1 FROM parking_lots WHERE id IN ('lot-4', '4') AND capacity = 78)
    THEN
        RAISE EXCEPTION '第4駐車場の設定（78台）を確認してください。';
    END IF;
    IF EXISTS (SELECT 1 FROM parking_sessions WHERE lot_id IN ('lot-4', '4'))
        OR EXISTS (SELECT 1 FROM parking_spaces WHERE lot_id IN ('lot-4', '4') AND status = 'occupied')
    THEN
        RAISE EXCEPTION '第4駐車場に駐車記録があります。出庫・位置の確認後に変更してください。';
    END IF;
    IF EXISTS (
        SELECT 1 FROM parking_spaces WHERE lot_id IN ('lot-4', '4')
            AND (spot_number IS NULL OR spot_number < 1 OR spot_number > 78)
    ) THEN
        RAISE EXCEPTION '第4駐車場に想定外の枠番号があります。既存データを確認してください。';
    END IF;
END $$;

-- 公開の確認結果は、共通のDB更新処理が適用済みとして保存する。
-- 利用者・駐車記録・枠の状態・台数・画像には書き込まない。
COMMIT;
