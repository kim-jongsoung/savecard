const { Pool } = require('pg');

// Railway PostgreSQL 연결 설정
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/guam_savecard',
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function createAssignmentLogsTable() {
    try {
        console.log('🔧 assignment_logs 테이블 생성 중...');
        
        // assignment_logs 테이블 생성
        await pool.query(`
            CREATE TABLE IF NOT EXISTS assignment_logs (
                id SERIAL PRIMARY KEY,
                reservation_id INTEGER NOT NULL,
                action_type VARCHAR(50) NOT NULL,
                details TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                created_by VARCHAR(100),
                ip_address INET,
                user_agent TEXT
            );
        `);
        
        console.log('✅ assignment_logs 테이블 생성 완료');
        
        // 인덱스 생성
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_assignment_logs_reservation ON assignment_logs(reservation_id);
            CREATE INDEX IF NOT EXISTS idx_assignment_logs_created_at ON assignment_logs(created_at);
            CREATE INDEX IF NOT EXISTS idx_assignment_logs_action_type ON assignment_logs(action_type);
        `);
        
        console.log('✅ assignment_logs 인덱스 생성 완료');
        
        // 샘플 데이터 삽입 (테스트용)
        await pool.query(`
            INSERT INTO assignment_logs (reservation_id, action_type, details, created_at)
            VALUES 
                (1, 'assignment_created', '수배서 생성', NOW() - INTERVAL '2 hours'),
                (1, 'link_generated', '수배서 링크 생성', NOW() - INTERVAL '1 hour'),
                (1, 'email_sent', '수배업체 메일 전송', NOW() - INTERVAL '30 minutes'),
                (2, 'assignment_created', '수배서 생성', NOW() - INTERVAL '1 day'),
                (2, 'word_downloaded', '워드파일 다운로드', NOW() - INTERVAL '12 hours')
            ON CONFLICT DO NOTHING;
        `);
        
        console.log('✅ 샘플 로그 데이터 삽입 완료');
        
        // 테이블 정보 확인
        const result = await pool.query(`
            SELECT COUNT(*) as log_count FROM assignment_logs;
        `);
        
        console.log(`📊 총 ${result.rows[0].log_count}개의 로그가 있습니다.`);
        
    } catch (error) {
        console.error('❌ assignment_logs 테이블 생성 실패:', error);
        throw error;
    } finally {
        await pool.end();
    }
}

// 스크립트 실행
if (require.main === module) {
    createAssignmentLogsTable()
        .then(() => {
            console.log('🎉 assignment_logs 테이블 설정 완료!');
            process.exit(0);
        })
        .catch(error => {
            console.error('💥 실행 실패:', error);
            process.exit(1);
        });
}

module.exports = { createAssignmentLogsTable };
