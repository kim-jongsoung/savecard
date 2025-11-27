const { Pool } = require('pg');

console.log('🔍 hotel_reservations 테이블의 status 제약 조건 확인 중...\n');

const pool = new Pool({
    host: 'metro.proxy.rlwy.net',
    port: 25887,
    user: 'postgres',
    password: 'UWGlOaPdwvynoOILFdKfbNyJjmPPjgcg',
    database: 'railway',
    ssl: false
});

async function checkStatusConstraint() {
    const client = await pool.connect();
    
    try {
        // status 컬럼의 CHECK 제약 조건 확인
        const query = `
            SELECT 
                conname as constraint_name,
                pg_get_constraintdef(oid) as constraint_definition
            FROM pg_constraint
            WHERE conrelid = 'hotel_reservations'::regclass
            AND contype = 'c'
            AND conname LIKE '%status%';
        `;
        
        const result = await client.query(query);
        
        console.log('📋 Status 제약 조건:\n');
        console.log('='.repeat(80));
        
        if (result.rows.length > 0) {
            result.rows.forEach(row => {
                console.log(`제약 조건명: ${row.constraint_name}`);
                console.log(`정의: ${row.constraint_definition}\n`);
            });
        } else {
            console.log('제약 조건을 찾을 수 없습니다.\n');
        }
        
        // 현재 사용 중인 status 값들 확인
        const statusQuery = `
            SELECT DISTINCT status, COUNT(*) as count
            FROM hotel_reservations
            GROUP BY status
            ORDER BY count DESC;
        `;
        
        const statusResult = await client.query(statusQuery);
        
        console.log('='.repeat(80));
        console.log('\n📊 현재 사용 중인 status 값:\n');
        statusResult.rows.forEach(row => {
            console.log(`  ${row.status}: ${row.count}건`);
        });
        
        console.log('\n' + '='.repeat(80));
        
    } catch (error) {
        console.error('❌ 오류:', error.message);
    } finally {
        client.release();
        await pool.end();
    }
}

checkStatusConstraint()
    .then(() => {
        console.log('\n✅ 확인 완료');
        process.exit(0);
    })
    .catch(error => {
        console.error('\n❌ 실패:', error);
        process.exit(1);
    });
