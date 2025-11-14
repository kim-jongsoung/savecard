const { Pool } = require('pg');

// Railway PostgreSQL 직접 연결
const pool = new Pool({
    connectionString: 'postgresql://postgres:UWGlOaPdwvynoOILFdKfbNyJjmPPjgcg@metro.proxy.rlwy.net:25887/railway',
    ssl: {
        rejectUnauthorized: false
    }
});

async function fix() {
    const client = await pool.connect();
    
    try {
        console.log('🔌 Railway PostgreSQL 연결 성공!\n');
        
        // 1. 컬럼 확인
        console.log('1️⃣ reservation_date 컬럼 확인...');
        const check = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'hotel_reservations' 
            AND column_name = 'reservation_date'
        `);
        
        if (check.rows.length > 0) {
            console.log('✅ reservation_date 컬럼이 이미 있습니다!\n');
            
            // 2. 테이블 구조 확인
            console.log('📊 hotel_reservations 테이블 구조:');
            const structure = await client.query(`
                SELECT 
                    column_name, 
                    data_type, 
                    column_default,
                    is_nullable
                FROM information_schema.columns 
                WHERE table_name = 'hotel_reservations' 
                ORDER BY ordinal_position
            `);
            
            console.log(`총 ${structure.rows.length}개 컬럼:\n`);
            structure.rows.forEach((col, idx) => {
                if (idx < 10 || col.column_name === 'reservation_date' || col.column_name === 'status') {
                    console.log(`   ${(idx + 1).toString().padStart(2)}. ${col.column_name.padEnd(25)} ${col.data_type.padEnd(15)} ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
                }
            });
            console.log('   ...');
            console.log(`   ${structure.rows.length}. ${structure.rows[structure.rows.length - 1].column_name.padEnd(25)} ${structure.rows[structure.rows.length - 1].data_type.padEnd(15)}`);
            
        } else {
            console.log('❌ reservation_date 컬럼이 없습니다. 추가합니다...\n');
            
            // 컬럼 추가
            await client.query(`
                ALTER TABLE hotel_reservations 
                ADD COLUMN reservation_date DATE DEFAULT CURRENT_DATE
            `);
            
            console.log('✅ reservation_date 컬럼 추가 완료!');
            
            // 기존 데이터 업데이트
            const updateResult = await client.query(`
                UPDATE hotel_reservations 
                SET reservation_date = DATE(created_at)
                WHERE reservation_date IS NULL
            `);
            
            console.log(`✅ ${updateResult.rowCount}개 레코드 업데이트 완료!`);
            
            // 인덱스 생성
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_hotel_res_reservation_date 
                ON hotel_reservations(reservation_date)
            `);
            
            console.log('✅ 인덱스 생성 완료!');
        }
        
        // 3. 테스트 쿼리 실행
        console.log('\n3️⃣ 테스트 쿼리 실행...');
        try {
            await client.query(`
                SELECT 
                    id,
                    reservation_number,
                    reservation_date,
                    check_in_date,
                    status
                FROM hotel_reservations
                LIMIT 1
            `);
            console.log('✅ SELECT 쿼리 정상 작동!');
        } catch (selectErr) {
            console.error('❌ SELECT 쿼리 실패:', selectErr.message);
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
fix()
    .then(() => {
        console.log('\n🎉 완료!');
        console.log('\n💡 이제 Railway 서버를 재시작하세요:');
        console.log('   1. Railway 대시보드');
        console.log('   2. Settings → Restart Deployment');
        process.exit(0);
    })
    .catch(error => {
        console.error('\n💥 치명적 오류:', error);
        process.exit(1);
    });
