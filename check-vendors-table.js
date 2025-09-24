const { Pool } = require('pg');

async function checkVendorsTable() {
    const pool = new Pool({ 
        connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/guamsavecard' 
    });

    try {
        const result = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'vendors'
        `);
        
        if (result.rows.length > 0) {
            console.log('✅ vendors 테이블이 존재합니다.');
            
            // 테이블 구조 확인
            const columns = await pool.query(`
                SELECT column_name, data_type, is_nullable 
                FROM information_schema.columns 
                WHERE table_name = 'vendors'
                ORDER BY ordinal_position
            `);
            
            console.log('📋 vendors 테이블 구조:');
            columns.rows.forEach(col => {
                console.log(`  - ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'NULL 허용' : 'NOT NULL'})`);
            });
            
            // 데이터 개수 확인
            const count = await pool.query('SELECT COUNT(*) FROM vendors');
            console.log(`📊 등록된 수배업체: ${count.rows[0].count}개`);
            
        } else {
            console.log('❌ vendors 테이블이 존재하지 않습니다.');
            console.log('💡 create-vendors-table.js를 실행하여 테이블을 생성하세요.');
        }
        
    } catch (error) {
        console.error('❌ 데이터베이스 연결 오류:', error.message);
    } finally {
        await pool.end();
    }
}

checkVendorsTable();
