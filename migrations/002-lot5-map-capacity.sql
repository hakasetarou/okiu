BEGIN;

-- アプリの登録可能枠数を既存の座標データ（1〜62番）にそろえる。
-- 実地で確認した収容台数ではない。実地確認後はparking_lotsで管理する。
UPDATE parking_lots SET capacity = 62 WHERE id IN ('lot-5', '5');

COMMIT;
