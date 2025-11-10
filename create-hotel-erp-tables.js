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
                
                -- 인원 제한
                max_adults INTEGER DEFAULT 2,
                max_children INTEGER DEFAULT 1,
                max_total_occupancy INTEGER DEFAULT 3,
                
                -- 요금 구조
                base_room_rate DECIMAL(10, 2),  -- 기본 객실 요금
                breakfast_included BOOLEAN DEFAULT false,  -- 조식 포함 여부
                breakfast_rate_per_person DECIMAL(10, 2) DEFAULT 0,  -- 1인당 조식 요금
                extra_adult_rate DECIMAL(10, 2) DEFAULT 0,  -- 추가 성인 요금
                extra_child_rate DECIMAL(10, 2) DEFAULT 0,  -- 추가 소아 요금
                
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(hotel_id, room_type_code)
            )
        `);
        console.log('✅ room_types 테이블 생성 완료');
        
        // room_types 새 컬럼 마이그레이션
        const roomTypeNewColumns = [
            'max_adults INTEGER DEFAULT 2',
            'max_children INTEGER DEFAULT 1',
            'max_total_occupancy INTEGER DEFAULT 3',
            'base_room_rate DECIMAL(10, 2)',
            'breakfast_included BOOLEAN DEFAULT false',
            'breakfast_rate_per_person DECIMAL(10, 2) DEFAULT 0',
            'extra_adult_rate DECIMAL(10, 2) DEFAULT 0',
            'extra_child_rate DECIMAL(10, 2) DEFAULT 0'
        ];
        
        for (const col of roomTypeNewColumns) {
            const colName = col.split(' ')[0];
            await client.query(`
                DO $$ 
                BEGIN 
                    IF NOT EXISTS (
                        SELECT FROM information_schema.columns 
                        WHERE table_name = 'room_types' AND column_name = '${colName}'
                    ) THEN
                        ALTER TABLE room_types ADD COLUMN ${col};
                    END IF;
                END $$;
            `);
        }
        console.log('✅ room_types 컬럼 마이그레이션 완료');
        
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
                
                -- 예약 대표자 정보
                korean_name VARCHAR(100),
                english_first_name VARCHAR(100),
                english_last_name VARCHAR(100),
                email VARCHAR(255),
                phone VARCHAR(50),
                kakao_id VARCHAR(100),
                
                -- 투숙객 전체 명단 (JSON 배열)
                guests JSONB,
                -- 예시: [
                --   {"type": "adult", "first_name": "John", "last_name": "Doe"},
                --   {"type": "adult", "first_name": "Jane", "last_name": "Doe"},
                --   {"type": "child", "first_name": "Tom", "last_name": "Doe", "age": 8}
                -- ]
                
                -- 인원
                adults INTEGER DEFAULT 2,
                children INTEGER DEFAULT 0,
                
                -- 항공편 정보
                arrival_flight VARCHAR(50),  -- 도착 항공편명 (예: KE123)
                arrival_date DATE,
                arrival_time TIME,
                departure_flight VARCHAR(50),  -- 출발 항공편명
                departure_date DATE,
                departure_time TIME,
                
                -- 조식 옵션
                breakfast_included BOOLEAN DEFAULT false,
                breakfast_count INTEGER DEFAULT 0,  -- 조식 인원 수
                
                -- 가격 상세
                base_room_rate DECIMAL(10, 2),  -- 기본 객실 요금
                breakfast_amount DECIMAL(10, 2) DEFAULT 0,  -- 조식 총액
                extra_person_amount DECIMAL(10, 2) DEFAULT 0,  -- 추가 인원 요금
                total_amount DECIMAL(10, 2),  -- 최종 총액
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
        console.log('✅ hotel_reservations 테이블 생성 완료');
        
        // hotel_reservations 새 컬럼 마이그레이션
        const hotelResNewColumns = [
            'guests JSONB',
            'arrival_flight VARCHAR(50)',
            'arrival_date DATE',
            'arrival_time TIME',
            'departure_flight VARCHAR(50)',
            'departure_date DATE',
            'departure_time TIME',
            'breakfast_included BOOLEAN DEFAULT false',
            'breakfast_count INTEGER DEFAULT 0',
            'base_room_rate DECIMAL(10, 2)',
            'breakfast_amount DECIMAL(10, 2) DEFAULT 0',
            'extra_person_amount DECIMAL(10, 2) DEFAULT 0'
        ];
        
        for (const col of hotelResNewColumns) {
            const colName = col.split(' ')[0];
            await client.query(`
                DO $$ 
                BEGIN 
                    IF NOT EXISTS (
                        SELECT FROM information_schema.columns 
                        WHERE table_name = 'hotel_reservations' AND column_name = '${colName}'
                    ) THEN
                        ALTER TABLE hotel_reservations ADD COLUMN ${col};
                    END IF;
                END $$;
            `);
        }
        console.log('✅ hotel_reservations 컬럼 마이그레이션 완료');
        
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
        
        // guests 컬럼이 있을 때만 GIN 인덱스 생성
        try {
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_hotel_res_guests 
                ON hotel_reservations USING GIN(guests)
            `);
            console.log('✅ guests JSONB 인덱스 생성 완료');
        } catch (err) {
            console.log('⚠️  guests 인덱스 생성 건너뜀 (컬럼 없음)');
        }
        
        console.log('✅ hotel_reservations 인덱스 생성 완료');
        
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
        console.log('  2. room_types - 객실 타입 (인원 제한, 조식, 요금 구조)');
        console.log('  3. room_availability - 객실 RAG (가능 여부)');
        console.log('  4. availability_uploads - 업로드 히스토리');
        console.log('  5. hotel_reservations - 호텔 예약 (투숙객 전체, 항공편, 가격 상세)');
        console.log('  6. hotel_assignments - 호텔 수배 관리');
        console.log('\n📋 주요 기능:');
        console.log('  ✅ 투숙객 전체 명단 (guests JSONB)');
        console.log('  ✅ 룸타입별 인원 제한 (성인/소아 구분)');
        console.log('  ✅ 항공편 정보 (도착/출발 편명)');
        console.log('  ✅ 조식 옵션 및 요금');
        console.log('  ✅ 가격 상세: 객실요금 + 조식요금 + 추가인원요금');
        console.log('\n💡 요금 계산 예시:');
        console.log('  기본 객실 요금: $200 (성인2명 기준)');
        console.log('  조식 요금: $15 x 4명 = $60');
        console.log('  추가 소아 요금: $30 x 2명 = $60');
        console.log('  최종 총액: $200 + $60 + $60 = $320');
        
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
