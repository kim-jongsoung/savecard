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

async function createPricingTables() {
    const client = await pool.connect();
    
    try {
        console.log('💰 요금 관리 테이블 생성 시작...\n');
        
        // ==========================================
        // 1. room_rates (기본 요금)
        // ==========================================
        await client.query(`
            CREATE TABLE IF NOT EXISTS room_rates (
                id SERIAL PRIMARY KEY,
                hotel_id INTEGER REFERENCES hotels(id) ON DELETE CASCADE,
                room_type_id INTEGER REFERENCES room_types(id) ON DELETE CASCADE,
                
                -- 요금 (원가)
                rate_per_night DECIMAL(10, 2) NOT NULL,
                currency VARCHAR(3) DEFAULT 'USD',
                
                -- 유효 기간
                start_date DATE NOT NULL,
                end_date DATE NOT NULL,
                
                -- 시즌명 (참고용)
                season_name VARCHAR(100),
                
                -- 메모
                notes TEXT,
                
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ room_rates 테이블 생성 완료 (기본 요금)');
        
        try {
            await client.query(`CREATE INDEX IF NOT EXISTS idx_rates_hotel_room ON room_rates(hotel_id, room_type_id)`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_rates_dates ON room_rates(start_date, end_date)`);
            console.log('   인덱스 생성 완료');
        } catch (e) {
            console.log('   인덱스 이미 존재 (무시)');
        }
        
        // ==========================================
        // 2. hotel_promotions (프로모션)
        // ==========================================
        await client.query(`
            CREATE TABLE IF NOT EXISTS hotel_promotions (
                id SERIAL PRIMARY KEY,
                hotel_id INTEGER REFERENCES hotels(id) ON DELETE CASCADE,
                promotion_code VARCHAR(50) NOT NULL,
                promotion_name VARCHAR(200),
                
                -- 할인 타입 및 금액
                discount_type VARCHAR(20) DEFAULT 'fixed_amount',
                discount_value DECIMAL(10, 2) DEFAULT 0,
                
                -- 적용 대상 (NULL이면 전체 객실)
                applicable_room_type_ids TEXT,
                
                -- 유효 기간
                start_date DATE,
                end_date DATE,
                
                -- 메모
                description TEXT,
                
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ hotel_promotions 테이블 생성 완료 (프로모션)');
        
        try {
            await client.query(`CREATE INDEX IF NOT EXISTS idx_promotions_hotel ON hotel_promotions(hotel_id)`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_promotions_code ON hotel_promotions(promotion_code)`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_promotions_dates ON hotel_promotions(start_date, end_date)`);
            console.log('   인덱스 생성 완료');
        } catch (e) {
            console.log('   인덱스 이미 존재 (무시)');
        }
        
        // ==========================================
        // 3. agency_pricing_rules (거래처별 가격 정책)
        // ==========================================
        await client.query(`
            CREATE TABLE IF NOT EXISTS agency_pricing_rules (
                id SERIAL PRIMARY KEY,
                booking_agency_id INTEGER REFERENCES booking_agencies(id) ON DELETE CASCADE,
                hotel_id INTEGER REFERENCES hotels(id) ON DELETE CASCADE,
                
                -- 마진 설정
                markup_type VARCHAR(20) DEFAULT 'percentage',
                markup_value DECIMAL(10, 2) DEFAULT 0,
                
                -- 수수료 설정
                service_fee_per_night DECIMAL(10, 2) DEFAULT 0,
                service_fee_cap DECIMAL(10, 2) DEFAULT NULL,
                cap_after_nights INTEGER DEFAULT NULL,
                
                -- 특정 객실 타입만 적용 (NULL이면 전체)
                applicable_room_type_ids TEXT,
                
                -- 유효 기간
                start_date DATE,
                end_date DATE,
                
                -- 메모
                notes TEXT,
                
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                
                -- 중복 방지: 같은 거래처+호텔+기간은 1개만
                UNIQUE(booking_agency_id, hotel_id, start_date, end_date)
            )
        `);
        console.log('✅ agency_pricing_rules 테이블 생성 완료 (거래처별 가격정책)');
        
        try {
            await client.query(`CREATE INDEX IF NOT EXISTS idx_agency_rules_agency ON agency_pricing_rules(booking_agency_id)`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_agency_rules_hotel ON agency_pricing_rules(hotel_id)`);
            await client.query(`CREATE INDEX IF NOT EXISTS idx_agency_rules_dates ON agency_pricing_rules(start_date, end_date)`);
            console.log('   인덱스 생성 완료');
        } catch (e) {
            console.log('   인덱스 이미 존재 (무시)');
        }
        
        console.log('\n🎉 요금 관리 테이블 생성 완료!\n');
        console.log('📋 생성된 테이블:');
        console.log('');
        console.log('1️⃣ room_rates (기본 요금 - 원가)');
        console.log('   - rate_per_night: 박당 요금');
        console.log('   - start_date ~ end_date: 유효 기간');
        console.log('   - season_name: 시즌명 (성수기/비수기)');
        console.log('');
        console.log('2️⃣ hotel_promotions (프로모션)');
        console.log('   - promotion_code: 프로모션 코드 (dusit25summer)');
        console.log('   - discount_type: fixed_amount or percentage');
        console.log('   - discount_value: 할인액 ($10 또는 10%)');
        console.log('   - applicable_room_type_ids: 적용 객실 타입');
        console.log('');
        console.log('3️⃣ agency_pricing_rules (거래처별 가격정책)');
        console.log('   - markup_value: 마진율 (10%, 15%)');
        console.log('   - service_fee_per_night: 박당 수수료 ($10)');
        console.log('   - service_fee_cap: 최대 수수료 ($30)');
        console.log('   - cap_after_nights: 캡핑 기준 (3박)');
        console.log('');
        console.log('💡 계산 공식:');
        console.log('   최종 판매가 = (원가 - 프로모션) × (1 + 마진율) + 수수료');
        console.log('   수수료 = MIN(박수 × 박당수수료, 캡핑금액)');
        console.log('');
        
    } catch (error) {
        console.error('❌ 테이블 생성 오류:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// 실행
if (require.main === module) {
    createPricingTables()
        .then(() => {
            console.log('✅ 완료!');
            process.exit(0);
        })
        .catch(err => {
            console.error('❌ 실패:', err);
            process.exit(1);
        });
}

module.exports = { createPricingTables };
