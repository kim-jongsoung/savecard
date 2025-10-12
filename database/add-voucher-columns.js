const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function addVoucherColumns() {
    const client = await pool.connect();
    
    try {
        console.log('🔧 바우처 컬럼 추가 시작...');
        
        // 1. voucher_token 컬럼 추가
        console.log('1️⃣ voucher_token 컬럼 추가...');
        await client.query(`
            ALTER TABLE reservations 
            ADD COLUMN IF NOT EXISTS voucher_token VARCHAR(100) UNIQUE
        `);
        
        // 2. qr_code_data 컬럼 추가
        console.log('2️⃣ qr_code_data 컬럼 추가...');
        await client.query(`
            ALTER TABLE reservations 
            ADD COLUMN IF NOT EXISTS qr_code_data TEXT
        `);
        
        // 3. qr_image_path 컬럼 추가
        console.log('3️⃣ qr_image_path 컬럼 추가...');
        await client.query(`
            ALTER TABLE reservations 
            ADD COLUMN IF NOT EXISTS qr_image_path VARCHAR(255)
        `);
        
        // 4. vendor_voucher_path 컬럼 추가
        console.log('4️⃣ vendor_voucher_path 컬럼 추가...');
        await client.query(`
            ALTER TABLE reservations 
            ADD COLUMN IF NOT EXISTS vendor_voucher_path VARCHAR(255)
        `);
        
        // 5. voucher_sent_at 컬럼 추가
        console.log('5️⃣ voucher_sent_at 컬럼 추가...');
        await client.query(`
            ALTER TABLE reservations 
            ADD COLUMN IF NOT EXISTS voucher_sent_at TIMESTAMP
        `);
        
        // 6. 인덱스 생성
        console.log('6️⃣ 인덱스 생성...');
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_reservations_voucher_token 
            ON reservations(voucher_token)
        `);
        
        // 7. 확인
        console.log('\n✅ 컬럼 추가 완료! 확인중...\n');
        const result = await client.query(`
            SELECT 
                column_name, 
                data_type, 
                is_nullable,
                column_default
            FROM information_schema.columns 
            WHERE table_name = 'reservations' 
              AND column_name IN ('voucher_token', 'qr_code_data', 'qr_image_path', 'vendor_voucher_path', 'voucher_sent_at')
            ORDER BY column_name
        `);
        
        console.log('📋 추가된 컬럼 목록:');
        console.table(result.rows);
        
        console.log('\n🎉 바우처 컬럼 추가 성공!');
        
    } catch (error) {
        console.error('❌ 오류 발생:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// 실행
if (require.main === module) {
    addVoucherColumns()
        .then(() => {
            console.log('\n✅ 완료! 이제 서버를 다시 시작하세요.');
            process.exit(0);
        })
        .catch(err => {
            console.error('\n❌ 실패:', err.message);
            process.exit(1);
        });
}

module.exports = { addVoucherColumns };
