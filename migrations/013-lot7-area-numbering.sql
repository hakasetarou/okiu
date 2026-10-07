BEGIN;

-- 上側左の2枠を追加し、内側のL字型の列へつなげる。
-- 既存102枠の位置・記録は維持し、座標と同じ対応表で番号だけを変更する。
LOCK TABLE parking_lots, parking_spaces, parking_sessions IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE lot7_spot_renumbering (
    old_number INTEGER PRIMARY KEY CHECK (old_number BETWEEN 1 AND 102),
    new_number INTEGER NOT NULL UNIQUE CHECK (new_number BETWEEN 1 AND 104)
) ON COMMIT DROP;

INSERT INTO lot7_spot_renumbering(old_number, new_number)
SELECT number, CASE
    WHEN number BETWEEN 22 AND 49 THEN number + 13
    WHEN number BETWEEN 50 AND 60 THEN number - 26
    WHEN number BETWEEN 61 AND 102 THEN number + 2
    ELSE number
END FROM generate_series(1,102) number;

DO $$
BEGIN
    IF (SELECT COUNT(*) FROM parking_lots WHERE id IN ('lot-7', '7')) <> 1
        OR NOT EXISTS (SELECT 1 FROM parking_lots WHERE id IN ('lot-7', '7') AND capacity = 102)
    THEN
        RAISE EXCEPTION '第7駐車場の変更前の設定（102台）を確認してください。';
    END IF;
    IF (SELECT COUNT(*) FROM lot7_spot_renumbering) <> 102
        OR EXISTS (SELECT 1 FROM lot7_spot_renumbering WHERE new_number IN (22,23))
    THEN
        RAISE EXCEPTION '第7駐車場の番号対応表を確認してください。';
    END IF;
    IF EXISTS (
        SELECT 1 FROM parking_sessions WHERE lot_id IN ('lot-7', '7')
            AND (space_id IS NULL OR space_id NOT IN (SELECT old_number FROM lot7_spot_renumbering))
    ) OR EXISTS (
        SELECT 1 FROM parking_spaces WHERE lot_id IN ('lot-7', '7')
            AND (spot_number IS NULL OR spot_number NOT IN (SELECT old_number FROM lot7_spot_renumbering))
    ) THEN
        RAISE EXCEPTION '第7駐車場に想定外の枠番号があります。既存データを確認してください。';
    END IF;
    IF EXISTS (
        SELECT spot_number FROM parking_spaces WHERE lot_id IN ('lot-7', '7')
        GROUP BY spot_number HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION '第7駐車場の枠の状態が重複しています。既存データを確認してください。';
    END IF;
END $$;

UPDATE parking_spaces p SET lot_id = l.id FROM parking_lots l
WHERE p.lot_id IN ('7', 'lot-7') AND l.id IN ('7', 'lot-7') AND p.lot_id <> l.id;
UPDATE parking_sessions s SET lot_id = l.id FROM parking_lots l
WHERE s.lot_id IN ('7', 'lot-7') AND l.id IN ('7', 'lot-7') AND s.lot_id <> l.id;

-- 一時的に負の番号へ移し、番号の入れ替えによる一意制約との衝突を防ぐ。
UPDATE parking_spaces SET spot_number = -spot_number WHERE lot_id IN ('lot-7', '7');
UPDATE parking_sessions SET space_id = -space_id WHERE lot_id IN ('lot-7', '7');

UPDATE parking_spaces p SET spot_number = mapping.new_number
FROM lot7_spot_renumbering mapping
WHERE p.lot_id IN ('lot-7', '7') AND p.spot_number = -mapping.old_number;
UPDATE parking_sessions s SET space_id = mapping.new_number
FROM lot7_spot_renumbering mapping
WHERE s.lot_id IN ('lot-7', '7') AND s.space_id = -mapping.old_number;

UPDATE parking_lots SET capacity = 104, image_url = '/images/img7-system.svg'
WHERE id IN ('lot-7', '7');

COMMIT;
