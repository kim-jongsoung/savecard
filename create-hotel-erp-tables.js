const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function createHotelTables() {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        console.log('🏨 호텔 ERP 테이블 생성 시작...');
        
        // 1. 호텔 마스터
        await client.query(`
            CREATE TABLE IF NOT EXISTS hotels (
                id SERIAL PRIMARY KEY,
                hotel_name VARCHAR(100) NOT NULL,
                hotel_code VARCHAR(50) UNIQUE NOT NULL,
                hotel_name_en VARCHAR(100),
                address TEXT,
                contact_email VARCHAR(100),
                contact_phone VARCHAR(50),
                description TEXT,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ hotels 테이블 생성 완료');
        
        // 2. 객실 타입
        await client.query(`
            CREATE TABLE IF NOT EXISTS room_types (
                id SERIAL PRIMARY KEY,
                hotel_id INTEGER REFERENCES hotels(id) ON DELETE CASCADE,
                room_type_name VARCHAR(100) NOT NULL,
                room_type_code VARCHAR(50) NOT NULL,
                description TEXT,
                max_occupancy INTEGER DEFAULT 2,
                standard_rate DECIMAL(10, 2),
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(hotel_id, room_type_code)
            )
        `);
        console.log('✅ room_types 테이블 생성 완료');
        
        // 3. 객실 가능 여부 (RAG 핵심!)
        await client.query(`
            CREATE TABLE IF NOT EXISTS room_availability (
                id SERIAL PRIMARY KEY,
                room_type_id INTEGER REFERENCES room_types(id) ON DELETE CASCADE,
                availability_date DATE NOT NULL,
                status VARCHAR(20) NOT NULL CHECK (status IN ('available', 'closed')),
                updated_at TIMESTAMP DEFAULT NOW(),
                updated_by VARCHAR(100),
                UNIQUE(room_type_id, availability_date)
            )
        `);
        
        // 인덱스 (실시간 조회 성능 최적화)
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_room_availability_date 
            ON room_availability(availability_date)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_room_availability_lookup 
            ON room_availability(room_type_id, availability_date)
        `);
        console.log('✅ room_availability 테이블 + 인덱스 생성 완료');
        
        // 4. 가능 여부 업로드 히스토리 (검증용)
        await client.query(`
            CREATE TABLE IF NOT EXISTS availability_uploads (
                id SERIAL PRIMARY KEY,
                hotel_id INTEGER REFERENCES hotels(id) ON DELETE CASCADE,
                upload_date TIMESTAMP DEFAULT NOW(),
                uploaded_by VARCHAR(100),
                file_name VARCHAR(255),
                image_url TEXT,
                parsed_data JSONB,
                status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'failed')),
                error_message TEXT,
                confirmed_at TIMESTAMP,
                confirmed_by VARCHAR(100)
            )
        `);
        console.log('✅ availability_uploads 테이블 생성 완료');
        
        // 5. 호텔 예약 (투어 reservations와 별도)
        await client.query(`
            CREATE TABLE IF NOT EXISTS hotel_reservations (
                id SERIAL PRIMARY KEY,
                reservation_number VARCHAR(100) UNIQUE NOT NULL,
                hotel_id INTEGER REFERENCES hotels(id),
                room_type_id INTEGER REFERENCES room_types(id),
                
                -- 날짜 정보 (호텔 특성: 체크인/체크아웃)
                check_in_date DATE NOT NULL,
                check_out_date DATE NOT NULL,
                nights INTEGER NOT NULL,
                
                -- 예약자 정보
                korean_name VARCHAR(100),
                english_first_name VARCHAR(100),
                english_last_name VARCHAR(100),
                email VARCHAR(255),
                phone VARCHAR(50),
                kakao_id VARCHAR(100),
                
                -- 인원
                adults INTEGER DEFAULT 2,
                children INTEGER DEFAULT 0,
                
                -- 가격 정보
                room_rate DECIMAL(10, 2),
                total_amount DECIMAL(10, 2),
                currency VARCHAR(10) DEFAULT 'USD',
                
                -- 상태 관리
                payment_status VARCHAR(20) DEFAULT 'pending' 
                    CHECK (payment_status IN ('pending', 'in_progress', 'confirmed', 'cancelled', 'refunded')),
                
                -- 담당자 (개인화)
                assigned_to VARCHAR(100),
                created_by VARCHAR(100),
                created_by_email VARCHAR(100),
                
                -- 메모
                memo TEXT,
                special_requests TEXT,
                
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        
        // 인덱스
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_hotel_res_checkin 
            ON hotel_reservations(check_in_date)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_hotel_res_status 
            ON hotel_reservations(payment_status)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_hotel_res_assigned 
            ON hotel_reservations(assigned_to)
        `);
        console.log('✅ hotel_reservations 테이블 + 인덱스 생성 완료');
        
        // 6. 호텔 수배 관리
        await client.query(`
            CREATE TABLE IF NOT EXISTS hotel_assignments (
                id SERIAL PRIMARY KEY,
                hotel_reservation_id INTEGER REFERENCES hotel_reservations(id) ON DELETE CASCADE,
                hotel_id INTEGER REFERENCES hotels(id),
                
                -- 수배 정보
                assignment_number VARCHAR(100) UNIQUE,
                assignment_status VARCHAR(20) DEFAULT 'pending'
                    CHECK (assignment_status IN ('pending', 'sent', 'confirmed', 'failed', 'cancelled')),
                
                -- 수배서 발송
                sent_at TIMESTAMP,
                sent_by VARCHAR(100),
                sent_method VARCHAR(20), -- email, kakao, manual
                
                -- 확인
                confirmed_at TIMESTAMP,
                confirmed_by VARCHAR(100),
                confirmation_number VARCHAR(100),
                
                -- 메모
                notes TEXT,
                
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ hotel_assignments 테이블 생성 완료');
        
        await client.query('COMMIT');
        
        console.log('\n🎉 호텔 ERP 테이블 생성 완료!');
        console.log('\n생성된 테이블:');
        console.log('  1. hotels - 호텔 마스터');
        console.log('  2. room_types - 객실 타입');
        console.log('  3. room_availability - 객실 RAG (가능 여부)');
        console.log('  4. availability_uploads - 업로드 히스토리');
        console.log('  5. hotel_reservations - 호텔 예약');
        console.log('  6. hotel_assignments - 호텔 수배 관리');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 테이블 생성 오류:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// 실행
if (require.main === module) {
    createHotelTables()
        .then(() => {
            console.log('\n✅ 완료!');
            process.exit(0);
        })
        .catch(err => {
            console.error('❌ 실패:', err);
            process.exit(1);
        });
}

module.exports = { createHotelTables };
