const { Pool } = require('pg');

// Railway PostgreSQL 직접 연결
const pool = new Pool({
    connectionString: 'postgresql://postgres:UWGlOaPdwvynoOILFdKfbNyJjmPPjgcg@metro.proxy.rlwy.net:25887/railway',
    ssl: {
        rejectUnauthorized: false
    }
});

async function migrate() {
    const client = await pool.connect();
    
    try {
        console.log('🔌 Railway PostgreSQL 연결 성공!');
        console.log('');
        
        // 1. reservation_date 컬럼 추가
        console.log('1️⃣ reservation_date 컬럼 추가 중...');
        await client.query(`
            ALTER TABLE hotel_reservations 
            ADD COLUMN IF NOT EXISTS reservation_date DATE DEFAULT CURRENT_DATE
        `);
        console.log('✅ reservation_date 컬럼 추가 완료');
        
        // 2. 기존 데이터 업데이트
        console.log('2️⃣ 기존 데이터 업데이트 중...');
        const updateResult = await client.query(`
            UPDATE hotel_reservations 
            SET reservation_date = DATE(created_at)
            WHERE reservation_date IS NULL
        `);
        console.log(`✅ ${updateResult.rowCount}개 레코드 업데이트 완료`);
        
        // 3. 인덱스 생성
        console.log('3️⃣ 인덱스 생성 중...');
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_hotel_res_reservation_date 
            ON hotel_reservations(reservation_date)
        `);
        console.log('✅ 인덱스 생성 완료');
        
        // 4. status 제약조건 업데이트
        console.log('4️⃣ status 제약조건 업데이트 중...');
        
        // 기존 제약조건 확인 및 삭제
        const constraints = await client.query(`
            SELECT constraint_name 
            FROM information_schema.table_constraints 
            WHERE table_name = 'hotel_reservations' 
            AND constraint_type = 'CHECK'
            AND constraint_name LIKE '%status%'
        `);
        
        for (const row of constraints.rows) {
            await client.query(`
                ALTER TABLE hotel_reservations 
                DROP CONSTRAINT IF EXISTS ${row.constraint_name}
            `);
            console.log(`   - ${row.constraint_name} 제거`);
        }
        
        // 새 제약조건 추가
        await client.query(`
            ALTER TABLE hotel_reservations 
            ADD CONSTRAINT hotel_reservations_status_check 
            CHECK (status IN ('pending', 'processing', 'confirmed', 'voucher', 'settlement', 'cancelled', 'modifying', 'completed'))
        `);
        console.log('✅ status 제약조건 업데이트 완료');
        
        // 5. 확인
        console.log('');
        console.log('📊 확인 중...');
        const checkResult = await client.query(`
            SELECT column_name, data_type, column_default 
            FROM information_schema.columns 
            WHERE table_name = 'hotel_reservations' 
            AND column_name IN ('reservation_date', 'status')
            ORDER BY ordinal_position
        `);
        
        console.log('');
        console.log('✅ 마이그레이션 완료!');
        console.log('');
        console.log('📋 컬럼 상태:');
        checkResult.rows.forEach(col => {
            console.log(`   - ${col.column_name}: ${col.data_type} (기본값: ${col.column_default || 'None'})`);
        });
        
    } catch (error) {
        console.error('❌ 마이그레이션 실패:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// 실행
migrate()
    .then(() => {
        console.log('');
        console.log('🎉 모든 작업 완료!');
        process.exit(0);
    })
    .catch(error => {
        console.error('');
        console.error('💥 치명적 오류:', error);
        process.exit(1);
    });
