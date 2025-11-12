const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function checkPricingData() {
    try {
        console.log('🔍 요금 RAG 데이터 확인 중...\n');
        
        // 1. 전체 데이터 조회
        const allResult = await pool.query(`
            SELECT id, platform_name, product_name, is_active, 
                   LENGTH(platform_name) as platform_len,
                   LENGTH(product_name) as product_len
            FROM product_pricing
            ORDER BY id DESC
            LIMIT 10
        `);
        
        console.log('📊 최근 등록된 요금 데이터 (최대 10개):\n');
        allResult.rows.forEach((row, idx) => {
            console.log(`${idx + 1}. ID: ${row.id}`);
            console.log(`   업체명: "${row.platform_name}" (길이: ${row.platform_len}자)`);
            console.log(`   상품명: "${row.product_name}" (길이: ${row.product_len}자)`);
            console.log(`   활성: ${row.is_active}`);
            console.log('');
        });
        
        // 2. NOL 관련 데이터 조회
        const nolResult = await pool.query(`
            SELECT id, platform_name, product_name, is_active
            FROM product_pricing
            WHERE platform_name ILIKE '%NOL%'
            ORDER BY id DESC
        `);
        
        console.log('🔍 NOL 관련 데이터:\n');
        nolResult.rows.forEach((row, idx) => {
            console.log(`${idx + 1}. ID: ${row.id}`);
            console.log(`   업체명: "${row.platform_name}"`);
            console.log(`   상품명: "${row.product_name}"`);
            console.log(`   활성: ${row.is_active}`);
            console.log('');
        });
        
        // 3. 스타돌핀 관련 데이터 조회
        const dolphinResult = await pool.query(`
            SELECT id, platform_name, product_name, is_active
            FROM product_pricing
            WHERE product_name ILIKE '%돌핀%'
            ORDER BY id DESC
        `);
        
        console.log('🐬 돌핀 관련 데이터:\n');
        dolphinResult.rows.forEach((row, idx) => {
            console.log(`${idx + 1}. ID: ${row.id}`);
            console.log(`   업체명: "${row.platform_name}"`);
            console.log(`   상품명: "${row.product_name}"`);
            console.log(`   활성: ${row.is_active}`);
            console.log('');
        });
        
        // 4. 정확한 매칭 테스트
        console.log('🎯 정확한 매칭 테스트:\n');
        
        const testCases = [
            { platform: 'NOL', product: '스타돌핀크루즈' },
            { platform: 'NOL 유니버스', product: '스타돌핀크루즈' },
            { platform: 'NOL인터파크투어', product: '스타돌핀크루즈' }
        ];
        
        for (const testCase of testCases) {
            const result = await pool.query(`
                SELECT id, platform_name, product_name
                FROM product_pricing
                WHERE platform_name = $1 
                AND product_name = $2
                AND is_active = true
            `, [testCase.platform, testCase.product]);
            
            console.log(`테스트: platform="${testCase.platform}", product="${testCase.product}"`);
            console.log(`결과: ${result.rows.length > 0 ? '✅ 매칭 성공' : '❌ 매칭 실패'}`);
            if (result.rows.length > 0) {
                console.log(`   → ID: ${result.rows[0].id}, 등록명: "${result.rows[0].platform_name}" / "${result.rows[0].product_name}"`);
            }
            console.log('');
        }
        
        await pool.end();
        
    } catch (error) {
        console.error('❌ 오류:', error);
        await pool.end();
    }
}

checkPricingData();
