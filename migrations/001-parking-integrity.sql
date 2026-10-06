BEGIN;

-- 過去の画面が保存した「5」を、parking_lotsの「lot-5」に統一する。
-- 衝突があればトランザクション全体を取り消し、既存データは削除しない。
UPDATE parking_spaces p SET lot_id = l.id
FROM parking_lots l
WHERE p.lot_id <> l.id
  AND regexp_replace(p.lot_id, '^lot-', '') = regexp_replace(l.id, '^lot-', '');

UPDATE parking_sessions s SET lot_id = l.id
FROM parking_lots l
WHERE s.lot_id <> l.id
  AND regexp_replace(s.lot_id, '^lot-', '') = regexp_replace(l.id, '^lot-', '');

CREATE UNIQUE INDEX IF NOT EXISTS parking_sessions_user_unique ON parking_sessions (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS parking_sessions_space_unique ON parking_sessions (lot_id, space_id);

-- 既存の駐車記録がある枠を使用中にそろえる。
INSERT INTO parking_spaces (lot_id, spot_number, status)
SELECT lot_id, space_id, 'occupied' FROM parking_sessions
ON CONFLICT (lot_id, spot_number) DO UPDATE SET status = 'occupied';

COMMIT;
