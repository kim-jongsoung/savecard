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

async function fixBX614() {
    try {
        console.log('🔧 BX614편 도착시간 수정 시작...\n');
        
        // 1. 현재 데이터 확인
        console.log('1️⃣ 현재 BX614편 정보:');
        const current = await pool.query(`
            SELECT flight_number, departure_time, arrival_time, flight_hours, departure_airport, arrival_airport
            FROM pickup_flights 
            WHERE flight_number = 'BX614'
        `);
        
        if (current.rows.length > 0) {
            console.table(current.rows);
        } else {
            console.log('❌ BX614편이 데이터베이스에 없습니다.');
        }
        
        // 2. BX614편 추가 또는 수정
        console.log('\n2️⃣ BX614편 도착시간을 02:30으로 수정/추가...');
        await pool.query(`
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
                departure_time = '21:30',
                departure_airport = 'PUS',
                arrival_airport = 'GUM',
                updated_at = NOW()
        `);
        
        console.log('✅ 수정 완료!');
        
        // 3. 수정 후 확인
        console.log('\n3️⃣ 수정된 BX614편 정보:');
        const updated = await pool.query(`
            SELECT flight_number, departure_time, arrival_time, flight_hours, departure_airport, arrival_airport
            FROM pickup_flights 
            WHERE flight_number = 'BX614'
        `);
        
        console.table(updated.rows);
        
        console.log('\n✅ BX614편 수정 완료!');
        console.log('이제 새로운 예약은 02:30으로 표시됩니다.');
        console.log('\n⚠️ 기존 예약은 재등록해야 수정된 시간이 반영됩니다.');
        
    } catch (error) {
        console.error('❌ 오류 발생:', error.message);
    } finally {
        await pool.end();
    }
}

fixBX614();
