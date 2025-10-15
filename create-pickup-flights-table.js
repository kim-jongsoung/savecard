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
                airline VARCHAR(50),
                departure_time TIME NOT NULL,
                arrival_time TIME NOT NULL,
                departure_airport VARCHAR(100),
                arrival_airport VARCHAR(100),
                days_of_week VARCHAR(20), -- '1,2,3,4,5,6,7' (월화수목금토일)
                is_active BOOLEAN DEFAULT true,
                notes TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        `);
        console.log('✅ pickup_flights 테이블 생성');
        
        // 인덱스 생성
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_flight_number ON pickup_flights(flight_number);
            CREATE INDEX IF NOT EXISTS idx_is_active ON pickup_flights(is_active);
        `);
        console.log('✅ 인덱스 생성 완료');
        
        // 기존 하드코딩된 항공편 데이터 이관
        await client.query(`
            INSERT INTO pickup_flights (flight_number, airline, departure_time, arrival_time, departure_airport, arrival_airport, days_of_week, notes) 
            VALUES 
                ('KE111', '대한항공', '07:30', '12:30', '인천국제공항(ICN)', '괌국제공항(GUM)', '1,2,3,4,5,6,7', '정상 운항'),
                ('KE123', '대한항공', '22:00', '03:00', '인천국제공항(ICN)', '괌국제공항(GUM)', '1,2,3,4,5,6,7', '심야편 - 다음날 도착'),
                ('KE124', '대한항공', '03:30', '07:30', '괌국제공항(GUM)', '인천국제공항(ICN)', '1,2,3,4,5,6,7', '새벽 출발 - 전날 23:59 픽업'),
                ('OZ456', '아시아나', '10:00', '15:00', '인천국제공항(ICN)', '괌국제공항(GUM)', '1,2,3,4,5,6,7', '정상 운항'),
                ('OZ458', '아시아나', '17:00', '21:00', '괌국제공항(GUM)', '인천국제공항(ICN)', '1,2,3,4,5,6,7', '정상 운항'),
                ('OZ789', '아시아나', '15:30', '20:30', '인천국제공항(ICN)', '괌국제공항(GUM)', '1,2,3,4,5,6,7', '정상 운항'),
                ('OZ678', '아시아나', '11:00', '13:00', '나리타공항(NRT)', '괌국제공항(GUM)', '2,4,6', '도쿄발'),
                ('UA873', '유나이티드', '13:20', '18:20', '인천국제공항(ICN)', '괌국제공항(GUM)', '1,2,3,4,5,6,7', '정상 운항')
            ON CONFLICT (flight_number) DO NOTHING;
        `);
        console.log('✅ 기본 항공편 데이터 추가');
        
        // 현재 항공편 목록 확인
        const result = await client.query(`
            SELECT flight_number, airline, departure_time, arrival_time, departure_airport, arrival_airport, is_active
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
