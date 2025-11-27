const { Pool } = require('pg');

const pool = new Pool({
    host: 'metro.proxy.rlwy.net',
    port: 25887,
    user: 'postgres',
    password: 'UWGlOaPdwvynoOILFdKfbNyJjmPPjgcg',
    database: 'railway',
    ssl: false
});

async function checkSchema() {
    const client = await pool.connect();
    
    try {
        console.log('🔍 hotel_reservations 테이블 스키마 확인 중...\n');
        
        const query = `
            SELECT 
                column_name,
                data_type,
                is_nullable,
                column_default
            FROM information_schema.columns
            WHERE table_name = 'hotel_reservations'
            ORDER BY ordinal_position;
        `;
        
        const result = await client.query(query);
        
        console.log('📋 hotel_reservations 컬럼 목록:\n');
        console.log('='.repeat(80));
        
        result.rows.forEach(row => {
            console.log(`${row.column_name.padEnd(30)} | ${row.data_type.padEnd(20)} | Nullable: ${row.is_nullable}`);
        });
        
        console.log('\n' + '='.repeat(80));
        
        // agency 관련 컬럼 찾기
        const agencyColumns = result.rows.filter(r => r.column_name.includes('agency'));
        console.log('\n🔍 Agency 관련 컬럼:');
        agencyColumns.forEach(col => {
            console.log(`  - ${col.column_name} (${col.data_type})`);
        });
        
    } catch (error) {
        console.error('❌ 오류:', error.message);
    } finally {
        client.release();
        await pool.end();
    }
}

checkSchema()
    .then(() => {
        console.log('\n✅ 확인 완료');
        process.exit(0);
    })
    .catch(error => {
        console.error('\n❌ 실패:', error);
        process.exit(1);
    });
