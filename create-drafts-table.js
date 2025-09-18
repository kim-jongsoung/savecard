const { pool, dbMode, createTables } = require('./database');

async function createDraftsTable() {
    if (dbMode !== 'postgresql' || !pool) {
        console.log('❌ PostgreSQL 모드가 아닙니다.');
        return;
    }

    const client = await pool.connect();
    
    try {
        console.log('🔧 reservation_drafts 테이블 생성 중...');
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS reservation_drafts (
                draft_id SERIAL PRIMARY KEY,
                raw_text TEXT NOT NULL,
                parsed_json JSONB,
                normalized_json JSONB,
                manual_json JSONB,
                confidence DECIMAL(3,2) DEFAULT 0.8,
                extracted_notes TEXT,
                status VARCHAR(20) DEFAULT 'pending_review',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                reviewed_by VARCHAR(100),
                reviewed_at TIMESTAMP,
                committed_reservation_id INTEGER
            )
        `);
        
        console.log('✅ reservation_drafts 테이블 생성 완료');
        
        // 테이블 존재 확인
        const result = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'reservation_drafts'
        `);
        
        if (result.rows.length > 0) {
            console.log('✅ 테이블 존재 확인됨');
        } else {
            console.log('❌ 테이블 생성 실패');
        }
        
    } catch (error) {
        console.error('❌ 테이블 생성 오류:', error);
    } finally {
        client.release();
        process.exit(0);
    }
}

createDraftsTable();
