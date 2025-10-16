const { Pool } = require('pg');
const fs = require('fs');

// 환경변수 로드
if (fs.existsSync('./railsql.env')) {
    require('dotenv').config({ path: './railsql.env' });
} else {
    require('dotenv').config();
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function fixDisplayTimes() {
    try {
        console.log('🔧 기존 예약의 display_time을 항공편 스케줄로 수정 시작...\n');
        
        // 1. 현재 상태 확인
        console.log('1️⃣ 수정 전 상태 확인...');
        const before = await pool.query(`
            SELECT 
                ap.id,
                ap.flight_number,
                ap.record_type,
                ap.display_date,
                ap.display_time as current_display_time,
                pf.departure_time as flight_departure,
                pf.arrival_time as flight_arrival
            FROM airport_pickups ap
            LEFT JOIN pickup_flights pf ON ap.flight_number = pf.flight_number
            WHERE ap.status = 'active'
            ORDER BY ap.display_date DESC, ap.id
            LIMIT 10
        `);
        
        console.log('샘플 데이터 (최근 10건):');
        console.table(before.rows);
        
        // 2. 도착 레코드의 display_time을 항공편의 arrival_time으로 업데이트
        console.log('\n2️⃣ 도착 레코드 display_time 수정 중...');
        const arrivalUpdate = await pool.query(`
            UPDATE airport_pickups ap
            SET display_time = pf.arrival_time,
                updated_at = NOW()
            FROM pickup_flights pf
            WHERE ap.flight_number = pf.flight_number
              AND ap.record_type = 'arrival'
              AND ap.status = 'active'
              AND ap.display_time != pf.arrival_time
            RETURNING ap.id, ap.flight_number, ap.display_time
        `);
        
        console.log(`✅ ${arrivalUpdate.rowCount}건의 도착 레코드 수정 완료`);
        if (arrivalUpdate.rowCount > 0) {
            console.log('수정된 레코드 샘플:');
            console.table(arrivalUpdate.rows.slice(0, 5));
        }
        
        // 3. 출발 레코드의 display_time을 항공편의 departure_time으로 업데이트
        console.log('\n3️⃣ 출발 레코드 display_time 수정 중...');
        const departureUpdate = await pool.query(`
            UPDATE airport_pickups ap
            SET display_time = pf.departure_time,
                updated_at = NOW()
            FROM pickup_flights pf
            WHERE ap.flight_number = pf.flight_number
              AND ap.record_type = 'departure'
              AND ap.status = 'active'
              AND ap.display_time != pf.departure_time
            RETURNING ap.id, ap.flight_number, ap.display_time
        `);
        
        console.log(`✅ ${departureUpdate.rowCount}건의 출발 레코드 수정 완료`);
        if (departureUpdate.rowCount > 0) {
            console.log('수정된 레코드 샘플:');
            console.table(departureUpdate.rows.slice(0, 5));
        }
        
        // 4. 수정 후 확인
        console.log('\n4️⃣ 수정 후 상태 확인...');
        const after = await pool.query(`
            SELECT 
                ap.id,
                ap.flight_number,
                ap.record_type,
                ap.display_date,
                ap.display_time as current_display_time,
                pf.departure_time as flight_departure,
                pf.arrival_time as flight_arrival,
                CASE 
                    WHEN ap.record_type = 'departure' AND ap.display_time = pf.departure_time THEN '✅'
                    WHEN ap.record_type = 'arrival' AND ap.display_time = pf.arrival_time THEN '✅'
                    ELSE '❌'
                END as status
            FROM airport_pickups ap
            LEFT JOIN pickup_flights pf ON ap.flight_number = pf.flight_number
            WHERE ap.status = 'active'
            ORDER BY ap.display_date DESC, ap.id
            LIMIT 10
        `);
        
        console.log('수정 후 샘플 데이터 (최근 10건):');
        console.table(after.rows);
        
        console.log('\n✅ 모든 기존 예약의 display_time 수정 완료!');
        console.log(`총 ${arrivalUpdate.rowCount + departureUpdate.rowCount}건 업데이트됨`);
        console.log('\n이제 달력과 상세보기에서 항공편 스케줄 시간이 정확히 표시됩니다! 🎉');
        
    } catch (error) {
        console.error('❌ 오류 발생:', error.message);
        console.error(error);
    } finally {
        await pool.end();
    }
}

fixDisplayTimes();
