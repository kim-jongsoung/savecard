// 발급코드 테이블 및 데이터 확인/생성 스크립트
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DB_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function checkAndCreateIssueCodes() {
    try {
        console.log('🔍 issue_codes 테이블 확인 중...');
        
        // 1. 테이블 존재 확인
        const tableCheck = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'issue_codes'
        `);
        
        if (tableCheck.rows.length === 0) {
            console.log('❌ issue_codes 테이블이 존재하지 않음. 생성 중...');
            
            // 테이블 생성
            await pool.query(`
                CREATE TABLE issue_codes (
                    id SERIAL PRIMARY KEY,
                    code VARCHAR(10) UNIQUE NOT NULL,
                    is_used BOOLEAN DEFAULT FALSE,
                    used_by_user_id INTEGER,
                    user_name VARCHAR(255),
                    user_phone VARCHAR(50),
                    user_email VARCHAR(255),
                    qr_code_url TEXT,
                    used_at TIMESTAMP,
                    notes TEXT,
                    is_delivered BOOLEAN DEFAULT FALSE,
                    delivered_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('✅ issue_codes 테이블 생성 완료');
        } else {
            console.log('✅ issue_codes 테이블 존재함');
            
            // 컬럼 확인 및 추가
            const columns = await pool.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'issue_codes'
            `);
            
            const existingColumns = columns.rows.map(row => row.column_name);
            console.log('📋 기존 컬럼들:', existingColumns);
            
            // 필요한 컬럼들 추가
            const requiredColumns = [
                'user_name VARCHAR(255)',
                'user_phone VARCHAR(50)', 
                'user_email VARCHAR(255)',
                'qr_code_url TEXT',
                'notes TEXT'
            ];
            
            for (const col of requiredColumns) {
                const colName = col.split(' ')[0];
                if (!existingColumns.includes(colName)) {
                    try {
                        await pool.query(`ALTER TABLE issue_codes ADD COLUMN IF NOT EXISTS ${col}`);
                        console.log(`✅ ${colName} 컬럼 추가됨`);
                    } catch (err) {
                        console.log(`⚠️ ${colName} 컬럼 추가 실패:`, err.message);
                    }
                }
            }
        }
        
        // 2. 데이터 확인
        const dataCheck = await pool.query('SELECT COUNT(*) as count FROM issue_codes');
        const count = parseInt(dataCheck.rows[0].count);
        console.log(`📊 현재 발급코드 개수: ${count}개`);
        
        if (count === 0) {
            console.log('🎫 테스트용 발급코드 생성 중...');
            
            // 테스트용 코드 생성 (a1234b 형태)
            const testCodes = [];
            for (let i = 1; i <= 5; i++) {
                const letters = 'abcdefghijklmnopqrstuvwxyz';
                const firstLetter = letters[Math.floor(Math.random() * letters.length)];
                const lastLetter = letters[Math.floor(Math.random() * letters.length)];
                const numbers = String(Math.floor(Math.random() * 9000) + 1000);
                const code = `${firstLetter}${numbers}${lastLetter}`;
                testCodes.push(code);
            }
            
            for (const code of testCodes) {
                try {
                    await pool.query(`
                        INSERT INTO issue_codes (code, notes) 
                        VALUES ($1, $2)
                    `, [code, '테스트용 발급코드']);
                    console.log(`✅ 테스트 코드 생성: ${code}`);
                } catch (err) {
                    console.log(`⚠️ 코드 생성 실패 (${code}):`, err.message);
                }
            }
        }
        
        // 3. 최종 확인
        const finalCheck = await pool.query(`
            SELECT 
                id, code, is_used, is_delivered, notes, created_at
            FROM issue_codes 
            ORDER BY created_at DESC 
            LIMIT 10
        `);
        
        console.log('\n📋 현재 발급코드 목록:');
        finalCheck.rows.forEach(row => {
            console.log(`- ${row.code} (ID: ${row.id}, 사용: ${row.is_used ? 'Y' : 'N'}, 전달: ${row.is_delivered ? 'Y' : 'N'})`);
        });
        
    } catch (error) {
        console.error('❌ 오류 발생:', error.message);
        console.error(error.stack);
    } finally {
        await pool.end();
    }
}

checkAndCreateIssueCodes();
