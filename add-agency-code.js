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

// 4자리 랜덤 코드 생성
function generateCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

async function addAgencyCode() {
    try {
        console.log('🔧 업체 코드 시스템 추가 시작...\n');
        
        // 1. agency_code 컬럼 추가
        console.log('1️⃣ agency_code 컬럼 추가...');
        await pool.query(`
            ALTER TABLE pickup_agencies 
            ADD COLUMN IF NOT EXISTS agency_code VARCHAR(4) UNIQUE
        `);
        console.log('✅ 컬럼 추가 완료');
        
        // 2. 기존 업체들에 코드 부여
        console.log('\n2️⃣ 기존 업체에 코드 자동 생성...');
        const agencies = await pool.query(`
            SELECT id, agency_name, agency_code 
            FROM pickup_agencies 
            WHERE agency_code IS NULL
        `);
        
        console.log(`📋 코드가 없는 업체: ${agencies.rows.length}개`);
        
        for (const agency of agencies.rows) {
            let code;
            let isUnique = false;
            
            // 중복되지 않는 코드 생성
            while (!isUnique) {
                code = generateCode();
                const check = await pool.query(
                    'SELECT id FROM pickup_agencies WHERE agency_code = $1',
                    [code]
                );
                if (check.rows.length === 0) {
                    isUnique = true;
                }
            }
            
            await pool.query(
                'UPDATE pickup_agencies SET agency_code = $1 WHERE id = $2',
                [code, agency.id]
            );
            
            console.log(`✅ ${agency.agency_name}: 코드 ${code} 부여`);
        }
        
        // 3. 결과 확인
        console.log('\n3️⃣ 업체 코드 현황:');
        const result = await pool.query(`
            SELECT id, agency_name, agency_code, is_active
            FROM pickup_agencies
            ORDER BY agency_name
        `);
        
        console.table(result.rows);
        
        console.log('\n✅ 업체 코드 시스템 추가 완료!');
        console.log('이제 각 업체는 고유한 4자리 코드로 예약을 등록할 수 있습니다.');
        
    } catch (error) {
        console.error('❌ 오류 발생:', error.message);
        console.error(error);
    } finally {
        await pool.end();
    }
}

addAgencyCode();
