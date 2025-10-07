const { Pool } = require('pg');

// PostgreSQL 연결 설정
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'guamsavecard',
    password: 'your_password_here',
    port: 5432,
});

async function addSavecardField() {
    try {
        console.log('🔧 assignments 테이블에 savecard_code 필드 추가 중...');

        // savecard_code 필드 추가
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'assignments' AND column_name = 'savecard_code'
                ) THEN
                    ALTER TABLE assignments ADD COLUMN savecard_code VARCHAR(10);
                    CREATE INDEX IF NOT EXISTS idx_assignments_savecard_code ON assignments(savecard_code);
                    PRINT '✅ savecard_code 필드가 추가되었습니다.';
                ELSE
                    PRINT '📋 savecard_code 필드가 이미 존재합니다.';
                END IF;
            END $$;
        `);

        // sent_at, viewed_at 필드도 확인하고 추가
        await pool.query(`
            DO $$ 
            BEGIN
                -- sent_at 필드 추가
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'assignments' AND column_name = 'sent_at'
                ) THEN
                    ALTER TABLE assignments ADD COLUMN sent_at TIMESTAMP;
                END IF;

                -- viewed_at 필드 추가  
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'assignments' AND column_name = 'viewed_at'
                ) THEN
                    ALTER TABLE assignments ADD COLUMN viewed_at TIMESTAMP;
                END IF;
            END $$;
        `);

        console.log('✅ assignments 테이블 필드 추가 완료!');

        // 현재 테이블 구조 확인
        const result = await pool.query(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'assignments' 
            ORDER BY ordinal_position
        `);

        console.log('\n📋 assignments 테이블 현재 구조:');
        result.rows.forEach(row => {
            console.log(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
        });

    } catch (error) {
        console.error('❌ 필드 추가 오류:', error);
    } finally {
        await pool.end();
    }
}

// 스크립트 실행
addSavecardField();
