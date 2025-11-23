const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function addViewedAtColumn() {
    const client = await pool.connect();
    
    try {
        console.log('🔧 hotel_assignment_history 테이블에 viewed_at 컬럼 추가 중...');
        
        await client.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'hotel_assignment_history' 
                    AND column_name = 'viewed_at'
                ) THEN
                    ALTER TABLE hotel_assignment_history 
                    ADD COLUMN viewed_at TIMESTAMP;
                    
                    COMMENT ON COLUMN hotel_assignment_history.viewed_at IS '수배서 열람 시간';
                END IF;
            END $$;
        `);
        
        console.log('✅ viewed_at 컬럼 추가 완료');
        
    } catch (error) {
        console.error('❌ 마이그레이션 오류:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

addViewedAtColumn()
    .then(() => {
        console.log('✅ 마이그레이션 성공');
        process.exit(0);
    })
    .catch(err => {
        console.error('❌ 마이그레이션 실패:', err);
        process.exit(1);
    });
