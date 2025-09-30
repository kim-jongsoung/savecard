// assignments 테이블 누락된 컬럼 추가 스크립트
const { Pool } = require('pg');

// 데이터베이스 연결 설정
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function fixAssignmentsTable() {
    try {
        console.log('🔍 assignments 테이블 구조 확인 중...');
        
        // 현재 테이블 구조 확인
        const currentColumns = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'assignments'
        `);
        
        const existingColumns = currentColumns.rows.map(row => row.column_name);
        console.log('📋 기존 컬럼들:', existingColumns);
        
        // 필요한 컬럼들 정의
        const requiredColumns = [
            { name: 'responded_at', type: 'TIMESTAMP', description: '수배업체 응답 시간' },
            { name: 'view_count', type: 'INTEGER DEFAULT 0', description: '조회 횟수' },
            { name: 'confirmed_at', type: 'TIMESTAMP', description: '확정 시간' },
            { name: 'rejected_at', type: 'TIMESTAMP', description: '거절 시간' }
        ];
        
        // 누락된 컬럼 추가
        for (const column of requiredColumns) {
            if (!existingColumns.includes(column.name)) {
                console.log(`➕ ${column.name} 컬럼 추가 중...`);
                
                const alterQuery = `ALTER TABLE assignments ADD COLUMN ${column.name} ${column.type}`;
                await pool.query(alterQuery);
                
                console.log(`✅ ${column.name} 컬럼 추가 완료 (${column.description})`);
            } else {
                console.log(`✓ ${column.name} 컬럼 이미 존재`);
            }
        }
        
        // 업데이트된 테이블 구조 확인
        console.log('\n🔍 업데이트된 테이블 구조:');
        const updatedColumns = await pool.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_name = 'assignments' 
            ORDER BY ordinal_position
        `);
        
        console.table(updatedColumns.rows);
        
        console.log('\n✅ assignments 테이블 수정 완료!');
        
    } catch (error) {
        console.error('❌ 테이블 수정 오류:', error);
        throw error;
    } finally {
        await pool.end();
    }
}

// 스크립트 실행
if (require.main === module) {
    fixAssignmentsTable()
        .then(() => {
            console.log('🎉 스크립트 실행 완료');
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 스크립트 실행 실패:', error);
            process.exit(1);
        });
}

module.exports = { fixAssignmentsTable };
