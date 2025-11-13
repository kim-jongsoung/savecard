const { Pool } = require('pg');
const fs = require('fs');

// 환경변수 로드
if (fs.existsSync('./railsql.env')) {
    console.log('🔧 railsql.env 파일을 사용합니다');
    require('dotenv').config({ path: './railsql.env' });
} else {
    require('dotenv').config();
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function addRoomTypePricingDetails() {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        console.log('🛏️ 객실 타입 요금 상세 컬럼 추가 시작...\n');
        
        // 추가할 컬럼들
        const newColumns = [
            // 조식 요금 (성인/소아/유아 분리)
            { name: 'breakfast_rate_adult', type: 'DECIMAL(10, 2) DEFAULT 0', comment: '조식 요금 (성인)' },
            { name: 'breakfast_rate_child', type: 'DECIMAL(10, 2) DEFAULT 0', comment: '조식 요금 (소아)' },
            { name: 'breakfast_rate_infant', type: 'DECIMAL(10, 2) DEFAULT 0', comment: '조식 요금 (유아)' },
            
            // 추가 인원 요금
            { name: 'extra_infant_rate', type: 'DECIMAL(10, 2) DEFAULT 0', comment: '추가 유아 요금' },
            
            // 엑스트라베드 요금
            { name: 'extra_bed_rate', type: 'DECIMAL(10, 2) DEFAULT 0', comment: '엑스트라베드 추가 비용' },
            { name: 'baby_cot_rate', type: 'DECIMAL(10, 2) DEFAULT 0', comment: '베이비 코트 추가 비용' }
        ];
        
        for (const col of newColumns) {
            try {
                await client.query(`
                    DO $$ 
                    BEGIN 
                        IF NOT EXISTS (
                            SELECT FROM information_schema.columns 
                            WHERE table_name = 'room_types' AND column_name = '${col.name}'
                        ) THEN
                            ALTER TABLE room_types ADD COLUMN ${col.name} ${col.type};
                            RAISE NOTICE '✅ % 컬럼 추가 완료: %', '${col.name}', '${col.comment}';
                        ELSE
                            RAISE NOTICE '⏭️  % 컬럼 이미 존재', '${col.name}';
                        END IF;
                    END $$;
                `);
                console.log(`✅ ${col.name} - ${col.comment}`);
            } catch (error) {
                console.error(`❌ ${col.name} 추가 실패:`, error.message);
            }
        }
        
        // breakfast_rate_per_person 컬럼 제거 (더 이상 필요 없음)
        console.log('\n🗑️  기존 breakfast_rate_per_person 컬럼 확인...');
        await client.query(`
            DO $$ 
            BEGIN 
                IF EXISTS (
                    SELECT FROM information_schema.columns 
                    WHERE table_name = 'room_types' AND column_name = 'breakfast_rate_per_person'
                ) THEN
                    -- 제거하지 않고 유지 (기존 데이터 호환성)
                    RAISE NOTICE '⚠️  breakfast_rate_per_person 컬럼은 호환성을 위해 유지됩니다';
                END IF;
            END $$;
        `);
        
        await client.query('COMMIT');
        
        console.log('\n🎉 객실 타입 요금 상세 컬럼 추가 완료!\n');
        console.log('📋 추가된 컬럼:');
        console.log('  - breakfast_rate_adult (조식 요금 - 성인)');
        console.log('  - breakfast_rate_child (조식 요금 - 소아)');
        console.log('  - breakfast_rate_infant (조식 요금 - 유아)');
        console.log('  - extra_infant_rate (추가 유아 요금)');
        console.log('  - extra_bed_rate (엑스트라베드 추가 비용)');
        console.log('  - baby_cot_rate (베이비 코트 추가 비용)\n');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 컬럼 추가 오류:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// 실행
if (require.main === module) {
    addRoomTypePricingDetails()
        .then(() => {
            console.log('✅ 완료!');
            process.exit(0);
        })
        .catch(err => {
            console.error('❌ 실패:', err);
            process.exit(1);
        });
}

module.exports = { addRoomTypePricingDetails };
