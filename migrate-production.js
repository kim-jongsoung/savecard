// 실서버 DB에 직접 마이그레이션 실행
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Railway 실서버 DATABASE_URL을 여기에 입력하세요
// Railway Variables 탭에서 DATABASE_URL을 복사해서 아래에 붙여넣으세요
const DATABASE_URL = process.env.DATABASE_URL || 'RAILWAY_DATABASE_URL_HERE';

async function runProductionMigrations() {
    const pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('🔗 실서버 데이터베이스 연결 중...');
        
        // 마이그레이션 추적 테이블 생성
        await pool.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version VARCHAR(255) PRIMARY KEY,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        const migrationsDir = path.join(__dirname, 'migrations');
        const migrationFiles = fs.readdirSync(migrationsDir)
            .filter(file => file.endsWith('.sql'))
            .sort();

        console.log(`📁 발견된 마이그레이션 파일: ${migrationFiles.length}개`);
        
        for (const file of migrationFiles) {
            const version = file.replace('.sql', '');
            
            // 이미 적용된 마이그레이션인지 확인
            const { rows } = await pool.query(
                'SELECT version FROM schema_migrations WHERE version = $1',
                [version]
            );
            
            if (rows.length > 0) {
                console.log(`✅ ${file} - 이미 적용됨`);
                continue;
            }
            
            console.log(`🔄 ${file} 실행 중...`);
            
            // 마이그레이션 실행
            const migrationSQL = fs.readFileSync(path.join(migrationsDir, file), { encoding: 'utf8' });
            
            await pool.query('BEGIN');
            try {
                await pool.query(migrationSQL);
                await pool.query(
                    'INSERT INTO schema_migrations (version) VALUES ($1)',
                    [version]
                );
                await pool.query('COMMIT');
                console.log(`✅ ${file} - 성공적으로 적용됨`);
            } catch (error) {
                await pool.query('ROLLBACK');
                console.error(`❌ ${file} - 실패: ${error.message}`);
                throw error;
            }
        }
        
        console.log('🎉 모든 마이그레이션이 완료되었습니다!');
        
    } catch (error) {
        console.error('❌ 마이그레이션 실행 오류:', error);
    } finally {
        await pool.end();
    }
}

runProductionMigrations();
