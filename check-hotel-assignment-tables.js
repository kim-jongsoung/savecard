const { Pool } = require('pg');
require('dotenv').config({ path: './railsql.env' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function checkTables() {
    const client = await pool.connect();
    
    try {
        console.log('🔍 호텔 수배서 테이블 확인 중...\n');
        
        // 1. hotel_assignment_history 테이블 존재 확인
        const tableCheck = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'hotel_assignment_history'
            )
        `);
        
        if (tableCheck.rows[0].exists) {
            console.log('✅ hotel_assignment_history 테이블 존재');
            
            // 컬럼 확인
            const columns = await client.query(`
                SELECT column_name, data_type, is_nullable
                FROM information_schema.columns
                WHERE table_name = 'hotel_assignment_history'
                ORDER BY ordinal_position
            `);
            
            console.log('\n📋 컬럼 목록:');
            columns.rows.forEach(col => {
                console.log(`  - ${col.column_name} (${col.data_type}) ${col.is_nullable === 'NO' ? '필수' : '선택'}`);
            });
            
            // 데이터 개수 확인
            const count = await client.query('SELECT COUNT(*) FROM hotel_assignment_history');
            console.log(`\n📊 저장된 이력 개수: ${count.rows[0].count}개`);
            
        } else {
            console.log('❌ hotel_assignment_history 테이블이 없습니다!');
        }
        
        // 2. hotel_reservations.assignment_token 컬럼 확인
        const tokenColumn = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.columns 
                WHERE table_name = 'hotel_reservations' 
                AND column_name = 'assignment_token'
            )
        `);
        
        if (tokenColumn.rows[0].exists) {
            console.log('\n✅ hotel_reservations.assignment_token 컬럼 존재');
            
            // token이 있는 예약 개수
            const tokenCount = await client.query(`
                SELECT COUNT(*) 
                FROM hotel_reservations 
                WHERE assignment_token IS NOT NULL
            `);
            console.log(`📊 토큰이 있는 예약: ${tokenCount.rows[0].count}개`);
            
        } else {
            console.log('\n❌ hotel_reservations.assignment_token 컬럼이 없습니다!');
        }
        
        // 3. 인덱스 확인
        const indexes = await client.query(`
            SELECT indexname, indexdef
            FROM pg_indexes
            WHERE tablename = 'hotel_assignment_history'
        `);
        
        if (indexes.rows.length > 0) {
            console.log('\n📌 인덱스 목록:');
            indexes.rows.forEach(idx => {
                console.log(`  - ${idx.indexname}`);
            });
        }
        
        console.log('\n✅ 마이그레이션 확인 완료!');
        
    } catch (error) {
        console.error('❌ 확인 오류:', error.message);
    } finally {
        client.release();
        await pool.end();
    }
}

checkTables();
