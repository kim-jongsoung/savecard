const { Pool } = require('pg');
const fs = require('fs');

// 환경변수 로드
if (fs.existsSync('./railsql.env')) {
    console.log('🔧 railsql.env 파일을 사용합니다 (로컬 Railway 연동)');
    require('dotenv').config({ path: './railsql.env' });
} else {
    console.log('🔧 기본 .env 파일을 사용합니다');
    require('dotenv').config();
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('railway.app') ? { rejectUnauthorized: false } : false
});

async function createParsingSettingsTable() {
    try {
        console.log('📊 parsing_settings 테이블 생성 시작...');
        
        // parsing_settings 테이블 생성
        await pool.query(`
            CREATE TABLE IF NOT EXISTS parsing_settings (
                id SERIAL PRIMARY KEY,
                admin_username VARCHAR(100) NOT NULL UNIQUE,
                preprocessing_rules JSONB DEFAULT '[]'::jsonb,
                custom_prompt TEXT,
                custom_parsing_rules JSONB DEFAULT '[]'::jsonb,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ parsing_settings 테이블 생성 완료');
        
        // 업데이트 시간 자동 갱신 트리거 생성
        await pool.query(`
            CREATE OR REPLACE FUNCTION update_parsing_settings_timestamp()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated_at = CURRENT_TIMESTAMP;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        `);
        
        await pool.query(`
            DROP TRIGGER IF EXISTS parsing_settings_updated_at_trigger ON parsing_settings;
            CREATE TRIGGER parsing_settings_updated_at_trigger
            BEFORE UPDATE ON parsing_settings
            FOR EACH ROW
            EXECUTE FUNCTION update_parsing_settings_timestamp();
        `);
        console.log('✅ 자동 업데이트 트리거 생성 완료');
        
        // 공유 설정 추가 (모든 관리자가 사용)
        await pool.query(`
            INSERT INTO parsing_settings (admin_username, preprocessing_rules, custom_parsing_rules)
            VALUES ('shared', '[]'::jsonb, '[]'::jsonb)
            ON CONFLICT (admin_username) DO NOTHING
        `);
        console.log('✅ 공유 파싱 설정 추가 완료 (모든 관리자가 사용)');
        
        console.log('');
        console.log('🎉 parsing_settings 테이블 생성 완료!');
        console.log('');
        console.log('📋 테이블 구조:');
        console.log('  - id: 자동 증가 ID');
        console.log('  - admin_username: 관리자 아이디 (고유값)');
        console.log('  - preprocessing_rules: 전처리 규칙 (JSONB)');
        console.log('  - custom_prompt: 커스텀 프롬프트 (TEXT)');
        console.log('  - custom_parsing_rules: 커스텀 파싱 규칙 (JSONB)');
        console.log('  - created_at: 생성 시간');
        console.log('  - updated_at: 수정 시간 (자동 갱신)');
        
    } catch (error) {
        console.error('❌ 테이블 생성 실패:', error);
        throw error;
    } finally {
        await pool.end();
    }
}

createParsingSettingsTable();
