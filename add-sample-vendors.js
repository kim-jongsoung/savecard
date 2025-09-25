const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const fs = require('fs');

// 환경변수 로드 (railsql.env 우선)
if (fs.existsSync('./railsql.env')) {
    console.log('🔧 railsql.env 파일을 사용합니다');
    require('dotenv').config({ path: './railsql.env' });
} else {
    require('dotenv').config();
}

// Railway PostgreSQL 연결 설정
const connectionString = process.env.DATABASE_URL;
const isRailway = connectionString && (connectionString.includes('railway') || connectionString.includes('metro.proxy.rlwy.net'));

const pool = new Pool({
    connectionString: connectionString,
    ssl: isRailway ? { rejectUnauthorized: false } : false,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
});

async function addSampleVendors() {
    const client = await pool.connect();
    
    try {
        console.log('🏢 샘플 수배업체 데이터 추가 시작...');
        
        await client.query('BEGIN');
        
        // 샘플 수배업체 데이터
        const vendors = [
            {
                vendor_name: '괌 돌핀크루즈',
                vendor_id: 'dolphin_cruise',
                password: 'dolphin123',
                email: 'dolphin@guam.com',
                phone: '+1-671-555-0001',
                contact_person: 'John Kim',
                business_type: '해양레저',
                description: '괌 최고의 돌핀 크루즈 투어 전문업체',
                notification_email: 'booking@dolphincruise.com',
                products: [
                    { keyword: '돌핀', priority: 1 },
                    { keyword: '크루즈', priority: 1 },
                    { keyword: '돌고래', priority: 1 },
                    { keyword: '해양', priority: 2 }
                ]
            },
            {
                vendor_name: '괌 공연장',
                vendor_id: 'guam_theater',
                password: 'theater123',
                email: 'theater@guam.com',
                phone: '+1-671-555-0002',
                contact_person: 'Sarah Lee',
                business_type: '공연/엔터테인먼트',
                description: '괌 대표 공연장 및 쇼 전문업체',
                notification_email: 'shows@guamtheater.com',
                products: [
                    { keyword: '공연', priority: 1 },
                    { keyword: '쇼', priority: 1 },
                    { keyword: '매직', priority: 1 },
                    { keyword: '디너쇼', priority: 1 },
                    { keyword: '엔터테인먼트', priority: 2 }
                ]
            },
            {
                vendor_name: '정글리버크루즈',
                vendor_id: 'jungle_river',
                password: 'jungle123',
                email: 'jungle@guam.com',
                phone: '+1-671-555-0003',
                contact_person: 'Mike Johnson',
                business_type: '자연투어',
                description: '정글 리버 크루즈 및 자연 투어 전문',
                notification_email: 'tours@jungleriver.com',
                products: [
                    { keyword: '정글', priority: 1 },
                    { keyword: '리버', priority: 1 },
                    { keyword: '자연', priority: 2 },
                    { keyword: '트레킹', priority: 2 }
                ]
            }
        ];
        
        for (const vendor of vendors) {
            // 패스워드 해시화
            const password_hash = await bcrypt.hash(vendor.password, 10);
            
            // 수배업체 등록
            const vendorResult = await client.query(`
                INSERT INTO vendors (
                    vendor_name, vendor_id, password_hash, email, phone, 
                    contact_person, business_type, description, notification_email
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (vendor_name) DO NOTHING
                RETURNING id, vendor_name
            `, [
                vendor.vendor_name, vendor.vendor_id, password_hash, vendor.email, vendor.phone,
                vendor.contact_person, vendor.business_type, vendor.description, vendor.notification_email
            ]);
            
            if (vendorResult.rows.length > 0) {
                const vendorId = vendorResult.rows[0].id;
                console.log(`✅ ${vendor.vendor_name} 등록 완료 (ID: ${vendorId})`);
                
                // 담당 상품 등록
                for (const product of vendor.products) {
                    await client.query(`
                        INSERT INTO vendor_products (vendor_id, product_keyword, priority)
                        VALUES ($1, $2, $3)
                        ON CONFLICT (vendor_id, product_keyword) DO NOTHING
                    `, [vendorId, product.keyword, product.priority]);
                }
                console.log(`   📦 담당 상품 ${vendor.products.length}개 등록 완료`);
            } else {
                console.log(`⚠️ ${vendor.vendor_name} 이미 존재함 (건너뜀)`);
            }
        }
        
        await client.query('COMMIT');
        
        // 등록된 수배업체 확인
        const result = await client.query(`
            SELECT v.vendor_name, v.business_type, COUNT(vp.id) as product_count
            FROM vendors v
            LEFT JOIN vendor_products vp ON v.id = vp.vendor_id AND vp.is_active = true
            WHERE v.is_active = true
            GROUP BY v.id, v.vendor_name, v.business_type
            ORDER BY v.vendor_name
        `);
        
        console.log('\n📊 등록된 수배업체 목록:');
        result.rows.forEach(row => {
            console.log(`   🏢 ${row.vendor_name} (${row.business_type}) - 담당상품 ${row.product_count}개`);
        });
        
        console.log('\n🎉 샘플 수배업체 데이터 추가 완료!');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 샘플 데이터 추가 실패:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

// 스크립트 실행
addSampleVendors();
