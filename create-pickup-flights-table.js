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
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function createFlightsTable() {
    const client = await pool.connect();
    
    try {
        console.log('🚀 항공편 관리 테이블 생성 시작...');
        
        // 항공편 마스터 테이블
        await client.query(`
            CREATE TABLE IF NOT EXISTS pickup_flights (
                id SERIAL PRIMARY KEY,
                flight_number VARCHAR(20) UNIQUE NOT NULL,
                airline VARCHAR(3),
                departure_time TIME NOT NULL,
                arrival_time TIME NOT NULL,
                flight_hours DECIMAL(3,1) NOT NULL,
                departure_airport VARCHAR(3),
                arrival_airport VARCHAR(3),
                days_of_week VARCHAR(20), -- '1,2,3,4,5,6,7' (월화수목금토일)
                is_active BOOLEAN DEFAULT true,
                notes TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        `);
        console.log('✅ pickup_flights 테이블 생성');
        
        // 기존 테이블이 있다면 컬럼 타입 변경 (에러 무시)
        try {
            await client.query(`
                ALTER TABLE pickup_flights 
                ALTER COLUMN airline TYPE VARCHAR(3),
                ALTER COLUMN departure_airport TYPE VARCHAR(3),
                ALTER COLUMN arrival_airport TYPE VARCHAR(3);
            `);
            console.log('✅ 컬럼 타입 변경 완료');
        } catch (err) {
            console.log('⚠️ 컬럼 타입 변경 스킵 (이미 변경되었거나 필요없음)');
        }
        
        // 인덱스 생성
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_flight_number ON pickup_flights(flight_number);
            CREATE INDEX IF NOT EXISTS idx_is_active ON pickup_flights(is_active);
        `);
        console.log('✅ 인덱스 생성 완료');
        
        // 기존 하드코딩된 항공편 데이터 이관
        await client.query(`
            INSERT INTO pickup_flights (flight_number, airline, departure_time, arrival_time, flight_hours, departure_airport, arrival_airport, days_of_week, notes) 
            VALUES 
                ('KE111', 'KE', '07:30', '12:30', 4.0, 'ICN', 'GUM', '1,2,3,4,5,6,7', '정상 운항'),
                ('KE123', 'KE', '22:00', '03:00', 4.0, 'ICN', 'GUM', '1,2,3,4,5,6,7', '심야편 - 다음날 도착'),
                ('KE124', 'KE', '03:30', '07:30', 4.0, 'GUM', 'ICN', '1,2,3,4,5,6,7', '새벽 출발 - 전날 23:59 픽업'),
                ('OZ456', 'OZ', '10:00', '15:00', 4.0, 'ICN', 'GUM', '1,2,3,4,5,6,7', '정상 운항'),
                ('OZ458', 'OZ', '17:00', '21:00', 4.0, 'GUM', 'ICN', '1,2,3,4,5,6,7', '정상 운항'),
                ('OZ789', 'OZ', '15:30', '20:30', 4.0, 'ICN', 'GUM', '1,2,3,4,5,6,7', '정상 운항'),
                ('OZ678', 'OZ', '11:00', '13:00', 3.0, 'NRT', 'GUM', '2,4,6', '도쿄발'),
                ('UA873', 'UA', '13:20', '18:20', 4.0, 'ICN', 'GUM', '1,2,3,4,5,6,7', '정상 운항')
            ON CONFLICT (flight_number) DO NOTHING;
        `);
        console.log('✅ 기본 항공편 데이터 추가');
        
        // 현재 항공편 목록 확인
        const result = await client.query(`
            SELECT flight_number, airline, departure_time, arrival_time, flight_hours, departure_airport, arrival_airport, is_active
            FROM pickup_flights 
            ORDER BY airline, departure_time
        `);
        
        console.log('\n📋 등록된 항공편 목록:');
        console.table(result.rows);
        
        console.log('\n🎉 항공편 관리 시스템 테이블 생성 완료!');
        
    } catch (error) {
        console.error('❌ 테이블 생성 실패:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// 스크립트 실행
if (require.main === module) {
    createFlightsTable();
}

module.exports = { createFlightsTable };
