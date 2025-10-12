require('dotenv').config();
require('dotenv').config({ path: 'railsql.env' });
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function createAssignmentViewsTable() {
    try {
        console.log('🔍 assignment_views 테이블 확인 중...');
        
        // 테이블 존재 확인
        const checkTable = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'assignment_views'
            );
        `);
        
        if (checkTable.rows[0].exists) {
            console.log('✅ assignment_views 테이블이 이미 존재합니다.');
        } else {
            console.log('⚠️ assignment_views 테이블이 없습니다. 생성 중...');
            
            await pool.query(`
                CREATE TABLE assignment_views (
                    id SERIAL PRIMARY KEY,
                    assignment_token VARCHAR(255) NOT NULL,
                    reservation_id INTEGER,
                    viewed_at TIMESTAMP DEFAULT NOW(),
                    ip_address VARCHAR(100),
                    country VARCHAR(100),
                    city VARCHAR(100),
                    user_agent TEXT,
                    device_type VARCHAR(50),
                    browser VARCHAR(50),
                    os VARCHAR(50),
                    screen_size VARCHAR(50),
                    referrer TEXT,
                    created_at TIMESTAMP DEFAULT NOW()
                );
                
                CREATE INDEX idx_assignment_views_token ON assignment_views(assignment_token);
                CREATE INDEX idx_assignment_views_reservation ON assignment_views(reservation_id);
                CREATE INDEX idx_assignment_views_viewed_at ON assignment_views(viewed_at DESC);
            `);
            
            console.log('✅ assignment_views 테이블 생성 완료!');
        }
        
        // assignments 테이블에 viewed_at 컬럼 확인
        console.log('🔍 assignments 테이블의 viewed_at 컬럼 확인 중...');
        
        const checkColumn = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'assignments' 
            AND column_name = 'viewed_at';
        `);
        
        if (checkColumn.rows.length > 0) {
            console.log('✅ assignments.viewed_at 컬럼이 존재합니다.');
        } else {
            console.log('⚠️ assignments.viewed_at 컬럼이 없습니다. 추가 중...');
            
            await pool.query(`
                ALTER TABLE assignments 
                ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMP;
            `);
            
            console.log('✅ assignments.viewed_at 컬럼 추가 완료!');
        }
        
        // 테이블 구조 확인
        console.log('\n📊 assignment_views 테이블 구조:');
        const structure = await pool.query(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'assignment_views' 
            ORDER BY ordinal_position;
        `);
        
        structure.rows.forEach(col => {
            console.log(`  - ${col.column_name}: ${col.data_type} (NULL: ${col.is_nullable})`);
        });
        
        console.log('\n✅ 모든 작업 완료!');
        
    } catch (error) {
        console.error('❌ 오류 발생:', error.message);
        console.error(error);
    } finally {
        await pool.end();
    }
}

createAssignmentViewsTable();
