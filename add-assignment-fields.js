const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function addAssignmentFields() {
    try {
        console.log('🔧 assignments 테이블에 필요한 필드들을 추가합니다...');

        // 1. assignment_token 필드 추가 (수배서 링크용 고유 토큰)
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'assignments' AND column_name = 'assignment_token'
                ) THEN
                    ALTER TABLE assignments ADD COLUMN assignment_token VARCHAR(100) UNIQUE;
                    CREATE INDEX IF NOT EXISTS idx_assignments_token ON assignments(assignment_token);
                END IF;
            END $$;
        `);
        console.log('✅ assignment_token 필드 추가 완료');

        // 2. viewed_at 필드 추가 (수배처가 수배서를 열람한 시간)
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'assignments' AND column_name = 'viewed_at'
                ) THEN
                    ALTER TABLE assignments ADD COLUMN viewed_at TIMESTAMP;
                END IF;
            END $$;
        `);
        console.log('✅ viewed_at 필드 추가 완료');

        // 3. response_at 필드 추가 (수배처가 응답한 시간)
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'assignments' AND column_name = 'response_at'
                ) THEN
                    ALTER TABLE assignments ADD COLUMN response_at TIMESTAMP;
                END IF;
            END $$;
        `);
        console.log('✅ response_at 필드 추가 완료');

        // 4. confirmation_number 필드 추가 (확정번호)
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'assignments' AND column_name = 'confirmation_number'
                ) THEN
                    ALTER TABLE assignments ADD COLUMN confirmation_number VARCHAR(100);
                END IF;
            END $$;
        `);
        console.log('✅ confirmation_number 필드 추가 완료');

        // 5. voucher_token 필드 추가 (바우처 링크용 고유 토큰)
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'assignments' AND column_name = 'voucher_token'
                ) THEN
                    ALTER TABLE assignments ADD COLUMN voucher_token VARCHAR(100) UNIQUE;
                    CREATE INDEX IF NOT EXISTS idx_assignments_voucher_token ON assignments(voucher_token);
                END IF;
            END $$;
        `);
        console.log('✅ voucher_token 필드 추가 완료');

        // 6. sent_at 필드 추가 (수배서 전송 시간)
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'assignments' AND column_name = 'sent_at'
                ) THEN
                    ALTER TABLE assignments ADD COLUMN sent_at TIMESTAMP;
                END IF;
            END $$;
        `);
        console.log('✅ sent_at 필드 추가 완료');

        // 7. rejection_reason 필드 추가 (거절 사유)
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'assignments' AND column_name = 'rejection_reason'
                ) THEN
                    ALTER TABLE assignments ADD COLUMN rejection_reason TEXT;
                END IF;
            END $$;
        `);
        console.log('✅ rejection_reason 필드 추가 완료');

        // 현재 테이블 구조 확인
        const result = await pool.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_name = 'assignments'
            ORDER BY ordinal_position
        `);

        console.log('\n📋 assignments 테이블 현재 구조:');
        console.table(result.rows);

        console.log('\n🎉 assignments 테이블 필드 추가가 완료되었습니다!');

    } catch (error) {
        console.error('❌ assignments 테이블 필드 추가 중 오류:', error);
    } finally {
        await pool.end();
    }
}

// 스크립트 실행
if (require.main === module) {
    addAssignmentFields();
}

module.exports = { addAssignmentFields };
