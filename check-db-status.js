const { Pool } = require('pg');

// Railway PostgreSQL 직접 연결
const pool = new Pool({
    connectionString: 'postgresql://postgres:UWGlOaPdwvynoOILFdKfbNyJjmPPjgcg@metro.proxy.rlwy.net:25887/railway',
    ssl: {
        rejectUnauthorized: false
    }
});

async function checkDB() {
    const client = await pool.connect();
    
    try {
        console.log('🔌 Railway PostgreSQL 연결 성공!\n');
        
        // 1. hotel_reservations 테이블 존재 확인
        console.log('📋 1. hotel_reservations 테이블 확인...');
        const tableCheck = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'hotel_reservations'
            );
        `);
        
        if (tableCheck.rows[0].exists) {
            console.log('✅ hotel_reservations 테이블 존재함\n');
            
            // 2. 컬럼 목록 확인
            console.log('📊 2. hotel_reservations 테이블 컬럼 목록:');
            const columns = await client.query(`
                SELECT 
                    column_name, 
                    data_type, 
                    column_default,
                    is_nullable
                FROM information_schema.columns 
                WHERE table_name = 'hotel_reservations' 
                ORDER BY ordinal_position
            `);
            
            columns.rows.forEach(col => {
                const nullable = col.is_nullable === 'YES' ? 'NULL 허용' : 'NOT NULL';
                const defaultVal = col.column_default || '기본값 없음';
                console.log(`   - ${col.column_name.padEnd(25)} ${col.data_type.padEnd(20)} ${nullable.padEnd(15)} (${defaultVal})`);
            });
            
            // 3. reservation_date 컬럼 확인
            console.log('\n🔍 3. reservation_date 컬럼 확인...');
            const hasResDate = columns.rows.some(col => col.column_name === 'reservation_date');
            if (hasResDate) {
                console.log('✅ reservation_date 컬럼 있음');
            } else {
                console.log('❌ reservation_date 컬럼 없음 - 추가 필요!');
            }
            
            // 4. 데이터 개수 확인
            console.log('\n📈 4. 데이터 개수:');
            const count = await client.query('SELECT COUNT(*) FROM hotel_reservations');
            console.log(`   총 ${count.rows[0].count}개의 예약 데이터`);
            
        } else {
            console.log('❌ hotel_reservations 테이블 없음 - 생성 필요!');
        }
        
    } catch (error) {
        console.error('❌ 오류:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// 실행
checkDB()
    .then(() => {
        console.log('\n🎉 확인 완료!');
        process.exit(0);
    })
    .catch(error => {
        console.error('\n💥 치명적 오류:', error);
        process.exit(1);
    });
