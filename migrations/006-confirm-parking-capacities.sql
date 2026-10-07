BEGIN;

-- 利用者が確認した地図画像の台数を設定する。第5駐車場は61台のまま。
LOCK TABLE parking_lots, parking_spaces, parking_sessions IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE confirmed_parking_capacities (
    lot_id TEXT PRIMARY KEY,
    capacity INTEGER NOT NULL
) ON COMMIT DROP;

INSERT INTO confirmed_parking_capacities(lot_id, capacity) VALUES
    ('lot-1', 530),
    ('lot-2', 206),
    ('lot-3', 693),
    ('lot-4', 78),
    ('lot-7', 93);

DO $$
BEGIN
    IF EXISTS (
        SELECT target.lot_id
        FROM confirmed_parking_capacities target
        LEFT JOIN parking_lots lot
            ON lot.id IN (target.lot_id, SUBSTRING(target.lot_id FROM 5))
        GROUP BY target.lot_id
        HAVING COUNT(lot.id) <> 1
    ) THEN
        RAISE EXCEPTION '台数を変更する駐車場の設定が不足、または重複しています。';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM parking_sessions session
        JOIN confirmed_parking_capacities target
            ON session.lot_id IN (target.lot_id, SUBSTRING(target.lot_id FROM 5))
        WHERE session.space_id < 1 OR session.space_id > target.capacity
    ) OR EXISTS (
        SELECT 1
        FROM parking_spaces space
        JOIN confirmed_parking_capacities target
            ON space.lot_id IN (target.lot_id, SUBSTRING(target.lot_id FROM 5))
        WHERE space.status = 'occupied'
            AND (space.spot_number < 1 OR space.spot_number > target.capacity)
    ) THEN
        RAISE EXCEPTION '確認した収容台数を超える駐車記録があります。枠番号を確認してください。';
    END IF;
END $$;

UPDATE parking_lots lot
SET capacity = target.capacity
FROM confirmed_parking_capacities target
WHERE lot.id IN (target.lot_id, SUBSTRING(target.lot_id FROM 5));

COMMIT;
