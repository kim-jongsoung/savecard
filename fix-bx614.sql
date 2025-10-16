-- BX614편 도착시간 수정 (02:30으로 변경)

-- 1. 현재 데이터 확인
SELECT flight_number, departure_time, arrival_time, flight_hours
FROM pickup_flights 
WHERE flight_number = 'BX614';

-- 2. 도착시간 수정
UPDATE pickup_flights 
SET arrival_time = '02:30',
    flight_hours = 6.0,
    updated_at = NOW()
WHERE flight_number = 'BX614';

-- 3. 수정 확인
SELECT flight_number, departure_time, arrival_time, flight_hours
FROM pickup_flights 
WHERE flight_number = 'BX614';

-- 4. BX614편이 없다면 추가
INSERT INTO pickup_flights (
    flight_number, airline, 
    departure_time, arrival_time, flight_hours,
    departure_airport, arrival_airport,
    days_of_week, is_active, notes
) VALUES (
    'BX614', 'BX',
    '21:30', '02:30', 6.0,
    'PUS', 'GUM',
    '1,2,3,4,5,6,7', true, '부산-괌 심야편'
)
ON CONFLICT (flight_number) DO UPDATE 
SET arrival_time = '02:30',
    flight_hours = 6.0,
    updated_at = NOW();
