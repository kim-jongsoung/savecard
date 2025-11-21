const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function createHotelTablesV2() {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        console.log('🏨 호텔 ERP 테이블 생성/업데이트 시작...\n');
        
        // ==========================================
        // 1. 호텔 마스터
        // ==========================================
        await client.query(`
            CREATE TABLE IF NOT EXISTS hotels (
                id SERIAL PRIMARY KEY,
                hotel_code VARCHAR(50) UNIQUE NOT NULL,
                hotel_name VARCHAR(100) NOT NULL,
                hotel_name_en VARCHAR(100),
                region VARCHAR(50),
                address TEXT,
                contact_email VARCHAR(100),
                contact_phone VARCHAR(50),
                description TEXT,
                check_in_time TIME DEFAULT '15:00',
                check_out_time TIME DEFAULT '11:00',
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ hotels 테이블 생성 완료');
        
        // hotels 새 컬럼 마이그레이션
        const hotelNewColumns = [
            'region VARCHAR(50)',
            'check_in_time TIME DEFAULT \'15:00\'',
            'check_out_time TIME DEFAULT \'11:00\''
        ];
        
        for (const col of hotelNewColumns) {
            const colName = col.split(' ')[0];
            await client.query(`
                DO $$ 
                BEGIN 
                    IF NOT EXISTS (
                        SELECT FROM information_schema.columns 
                        WHERE table_name = 'hotels' AND column_name = '${colName}'
                    ) THEN
                        ALTER TABLE hotels ADD COLUMN ${col};
                    END IF;
                END $$;
            `);
        }
        console.log('✅ hotels 컬럼 마이그레이션 완료');
        
        // ==========================================
        // 2. 예약업체 관리 (신규)
        // ==========================================
        await client.query(`
            CREATE TABLE IF NOT EXISTS booking_agencies (
                id SERIAL PRIMARY KEY,
                agency_code VARCHAR(50) UNIQUE NOT NULL,
                agency_name VARCHAR(100) NOT NULL,
                agency_type VARCHAR(20),
                contact_person VARCHAR(100),
                contact_email VARCHAR(100),
                contact_phone VARCHAR(50),
                commission_rate DECIMAL(5, 2) DEFAULT 0,
                payment_terms TEXT,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ booking_agencies 테이블 생성 완료');
        
        // ==========================================
        // 3. 객실 타입 (표준화 + 매핑)
        // ==========================================
        await client.query(`
            CREATE TABLE IF NOT EXISTS room_types (
                id SERIAL PRIMARY KEY,
                hotel_id INTEGER REFERENCES hotels(id) ON DELETE CASCADE,
                room_type_code VARCHAR(50) NOT NULL,
                room_type_name VARCHAR(100) NOT NULL,
                hotel_room_name VARCHAR(100),
                description TEXT,
                
                -- 인원 제한
                max_adults INTEGER DEFAULT 2,
                max_children INTEGER DEFAULT 1,
                max_infants INTEGER DEFAULT 1,
                max_total_occupancy INTEGER DEFAULT 3,
                
                -- 기본 요금 (참고용, 실제 판매는 room_rates)
                base_room_rate DECIMAL(10, 2),
                breakfast_included BOOLEAN DEFAULT false,
                breakfast_rate_per_person DECIMAL(10, 2) DEFAULT 0,
                extra_adult_rate DECIMAL(10, 2) DEFAULT 0,
                extra_child_rate DECIMAL(10, 2) DEFAULT 0,
                
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(hotel_id, room_type_code)
            )
        `);
        console.log('✅ room_types 테이블 생성 완료');
        
        // room_types 새 컬럼 마이그레이션
        const roomTypeNewColumns = [
            'hotel_room_name VARCHAR(100)',
            'max_adults INTEGER DEFAULT 2',
            'max_children INTEGER DEFAULT 1',
            'max_infants INTEGER DEFAULT 1',
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
        
        // ==========================================
        // 4. 객실 재고 관리 (가능 여부 + 개수)
        // ==========================================
        await client.query(`
            CREATE TABLE IF NOT EXISTS room_availability (
                id SERIAL PRIMARY KEY,
                room_type_id INTEGER REFERENCES room_types(id) ON DELETE CASCADE,
                availability_date DATE NOT NULL,
                status VARCHAR(20) NOT NULL CHECK (status IN ('available', 'closed', 'soldout')),
                available_rooms INTEGER DEFAULT 0,
                total_allocation INTEGER,
                booked_rooms INTEGER DEFAULT 0,
                memo TEXT,
                updated_at TIMESTAMP DEFAULT NOW(),
                updated_by VARCHAR(100),
                UNIQUE(room_type_id, availability_date)
            )
        `);
        console.log('✅ room_availability 테이블 생성 완료');
        
        // room_availability 새 컬럼 마이그레이션
        const availabilityNewColumns = [
            'available_rooms INTEGER DEFAULT 0',
            'total_allocation INTEGER',
            'booked_rooms INTEGER DEFAULT 0',
            'memo TEXT'
        ];
        
        for (const col of availabilityNewColumns) {
            const colName = col.split(' ')[0];
            await client.query(`
                DO $$ 
                BEGIN 
                    IF NOT EXISTS (
                        SELECT FROM information_schema.columns 
                        WHERE table_name = 'room_availability' AND column_name = '${colName}'
                    ) THEN
                        ALTER TABLE room_availability ADD COLUMN ${col};
                    END IF;
                END $$;
            `);
        }
        
        // status CHECK constraint 업데이트 (soldout 추가)
        await client.query(`
            DO $$ 
            BEGIN 
                -- 기존 constraint 삭제
                ALTER TABLE room_availability DROP CONSTRAINT IF EXISTS room_availability_status_check;
                -- 새 constraint 추가
                ALTER TABLE room_availability ADD CONSTRAINT room_availability_status_check 
                    CHECK (status IN ('available', 'closed', 'soldout'));
            EXCEPTION WHEN OTHERS THEN
                NULL; -- 이미 존재하면 무시
            END $$;
        `);
        console.log('✅ room_availability 컬럼 마이그레이션 완료');
        
        // 인덱스
        await client.query(`CREATE INDEX IF NOT EXISTS idx_room_availability_date ON room_availability(availability_date)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_room_availability_lookup ON room_availability(room_type_id, availability_date)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_room_availability_status ON room_availability(status)`);
        console.log('✅ room_availability 인덱스 생성 완료');
        
        // ==========================================
        // 5. 재고 업로드 히스토리
        // ==========================================
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
        
        // ==========================================
        // 6. 프로모션/특가 관리 (신규)
        // ==========================================
        await client.query(`
            CREATE TABLE IF NOT EXISTS promotions (
                id SERIAL PRIMARY KEY,
                promo_code VARCHAR(50) UNIQUE NOT NULL,
                promo_name VARCHAR(100) NOT NULL,
                promo_type VARCHAR(20),
                valid_from DATE NOT NULL,
                valid_to DATE NOT NULL,
                discount_type VARCHAR(20),
                discount_value DECIMAL(10, 2),
                description TEXT,
                terms_conditions TEXT,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ promotions 테이블 생성 완료');
        
        // ==========================================
        // 7. 요금 조건 (취소/변경 규정) (신규)
        // ==========================================
        await client.query(`
            CREATE TABLE IF NOT EXISTS rate_conditions (
                id SERIAL PRIMARY KEY,
                condition_code VARCHAR(50) UNIQUE NOT NULL,
                condition_name VARCHAR(100) NOT NULL,
                cancellation_policy JSONB,
                modification_allowed BOOLEAN DEFAULT true,
                modification_fee DECIMAL(10, 2),
                prepayment_required BOOLEAN DEFAULT false,
                refundable BOOLEAN DEFAULT true,
                description TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ rate_conditions 테이블 생성 완료');
        
        // ==========================================
        // 8. 객실 요금 그리드 (핵심!) (신규)
        // ==========================================
        await client.query(`
            CREATE TABLE IF NOT EXISTS room_rates (
                id SERIAL PRIMARY KEY,
                room_type_id INTEGER REFERENCES room_types(id) ON DELETE CASCADE,
                apply_date DATE NOT NULL,
                day_of_week INTEGER,
                rate_amount DECIMAL(10, 2) NOT NULL,
                breakfast_rate DECIMAL(10, 2) DEFAULT 0,
                breakfast_included BOOLEAN DEFAULT false,
                min_stay INTEGER DEFAULT 1,
                max_stay INTEGER,
                promotion_id INTEGER REFERENCES promotions(id),
                rate_condition_id INTEGER REFERENCES rate_conditions(id),
                is_available BOOLEAN DEFAULT true,
                allocation INTEGER,
                memo TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                created_by VARCHAR(100),
                UNIQUE(room_type_id, apply_date)
            )
        `);
        console.log('✅ room_rates 테이블 생성 완료');
        
        // room_rates 인덱스
        await client.query(`CREATE INDEX IF NOT EXISTS idx_room_rates_date ON room_rates(apply_date)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_room_rates_lookup ON room_rates(room_type_id, apply_date)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_room_rates_available ON room_rates(is_available)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_room_rates_promo ON room_rates(promotion_id)`);
        console.log('✅ room_rates 인덱스 생성 완료');
        
        // ==========================================
        // 9. 호텔 예약
        // ==========================================
        await client.query(`
            CREATE TABLE IF NOT EXISTS hotel_reservations (
                id SERIAL PRIMARY KEY,
                reservation_number VARCHAR(100) UNIQUE NOT NULL,
                hotel_id INTEGER REFERENCES hotels(id),
                room_type_id INTEGER REFERENCES room_types(id),
                booking_agency_id INTEGER REFERENCES booking_agencies(id),
                
                -- 날짜 정보
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
                
                -- 투숙객 전체 명단
                guests JSONB,
                
                -- 인원
                adults INTEGER DEFAULT 2,
                children INTEGER DEFAULT 0,
                infants INTEGER DEFAULT 0,
                
                -- 항공편 정보
                arrival_flight VARCHAR(50),
                arrival_date DATE,
                arrival_time TIME,
                departure_flight VARCHAR(50),
                departure_date DATE,
                departure_time TIME,
                
                -- 조식 옵션
                breakfast_included BOOLEAN DEFAULT false,
                breakfast_count INTEGER DEFAULT 0,
                
                -- 가격 상세
                base_room_rate DECIMAL(10, 2),
                breakfast_amount DECIMAL(10, 2) DEFAULT 0,
                extra_person_amount DECIMAL(10, 2) DEFAULT 0,
                total_amount DECIMAL(10, 2),
                selling_price DECIMAL(10, 2),
                cost_price DECIMAL(10, 2),
                currency VARCHAR(10) DEFAULT 'USD',
                
                -- 프로모션 및 조건
                promotion_code VARCHAR(50),
                rate_condition_id INTEGER REFERENCES rate_conditions(id),
                
                -- 상태 관리
                payment_status VARCHAR(20) DEFAULT 'pending' 
                    CHECK (payment_status IN ('pending', 'in_progress', 'confirmed', 'cancelled', 'refunded')),
                
                -- 담당자
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
            'booking_agency_id INTEGER',
            'guests JSONB',
            'infants INTEGER DEFAULT 0',
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
            'extra_person_amount DECIMAL(10, 2) DEFAULT 0',
            'selling_price DECIMAL(10, 2)',
            'cost_price DECIMAL(10, 2)',
            'promotion_code VARCHAR(50)',
            'rate_condition_id INTEGER'
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
        
        // hotel_reservations 인덱스
        await client.query(`CREATE INDEX IF NOT EXISTS idx_hotel_res_checkin ON hotel_reservations(check_in_date)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_hotel_res_status ON hotel_reservations(payment_status)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_hotel_res_assigned ON hotel_reservations(assigned_to)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_hotel_res_agency ON hotel_reservations(booking_agency_id)`);
        
        try {
            await client.query(`CREATE INDEX IF NOT EXISTS idx_hotel_res_guests ON hotel_reservations USING GIN(guests)`);
            console.log('✅ hotel_reservations JSONB 인덱스 생성 완료');
        } catch (err) {
            console.log('⚠️  guests 인덱스 생성 건너뜀');
        }
        
        console.log('✅ hotel_reservations 인덱스 생성 완료');
        
        // ==========================================
        // 10. 호텔 수배 관리
        // ==========================================
        await client.query(`
            CREATE TABLE IF NOT EXISTS hotel_assignments (
                id SERIAL PRIMARY KEY,
                hotel_reservation_id INTEGER REFERENCES hotel_reservations(id) ON DELETE CASCADE,
                hotel_id INTEGER REFERENCES hotels(id),
                assignment_number VARCHAR(100) UNIQUE,
                assignment_status VARCHAR(20) DEFAULT 'pending'
                    CHECK (assignment_status IN ('pending', 'sent', 'confirmed', 'failed', 'cancelled')),
                sent_at TIMESTAMP,
                sent_by VARCHAR(100),
                sent_method VARCHAR(20),
                confirmed_at TIMESTAMP,
                confirmed_by VARCHAR(100),
                confirmation_number VARCHAR(100),
                notes TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ hotel_assignments 테이블 생성 완료');

        // ==========================================
        // 10-1. 호텔 수배 객실 (신규)
        // ==========================================
        await client.query(`
            CREATE TABLE IF NOT EXISTS hotel_assignment_rooms (
                id SERIAL PRIMARY KEY,
                assignment_id INTEGER REFERENCES hotel_assignments(id) ON DELETE CASCADE,
                room_number INTEGER,
                room_type_id INTEGER REFERENCES room_types(id),
                room_type_name VARCHAR(100),
                room_rate DECIMAL(10, 2),
                promotion_code VARCHAR(50),
                breakfast_included BOOLEAN DEFAULT false,
                breakfast_adult_count INTEGER DEFAULT 0,
                breakfast_adult_price DECIMAL(10, 2) DEFAULT 0,
                breakfast_child_count INTEGER DEFAULT 0,
                breakfast_child_price DECIMAL(10, 2) DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ hotel_assignment_rooms 테이블 생성 완료');

        // ==========================================
        // 10-2. 호텔 수배 투숙객 (신규)
        // ==========================================
        await client.query(`
            CREATE TABLE IF NOT EXISTS hotel_assignment_guests (
                id SERIAL PRIMARY KEY,
                assignment_room_id INTEGER REFERENCES hotel_assignment_rooms(id) ON DELETE CASCADE,
                guest_number INTEGER,
                guest_name_ko VARCHAR(100),
                guest_name_en VARCHAR(100),
                birth_date DATE,
                is_adult BOOLEAN DEFAULT true,
                is_child BOOLEAN DEFAULT false,
                is_infant BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ hotel_assignment_guests 테이블 생성 완료');

        // hotel_assignment_guests 컬럼 마이그레이션 (guest_name_ko/en 확인)
        await client.query(`
            DO $$ 
            BEGIN 
                -- guest_name_ko 추가
                IF NOT EXISTS (
                    SELECT FROM information_schema.columns 
                    WHERE table_name = 'hotel_assignment_guests' AND column_name = 'guest_name_ko'
                ) THEN
                    ALTER TABLE hotel_assignment_guests ADD COLUMN guest_name_ko VARCHAR(100);
                END IF;

                -- guest_name_en 추가
                IF NOT EXISTS (
                    SELECT FROM information_schema.columns 
                    WHERE table_name = 'hotel_assignment_guests' AND column_name = 'guest_name_en'
                ) THEN
                    ALTER TABLE hotel_assignment_guests ADD COLUMN guest_name_en VARCHAR(100);
                END IF;
            END $$;
        `);
        console.log('✅ hotel_assignment_guests 컬럼 마이그레이션 완료');

        // ==========================================
        // 10-3. 호텔 수배 추가항목 (신규)
        // ==========================================
        await client.query(`
            CREATE TABLE IF NOT EXISTS hotel_assignment_extras (
                id SERIAL PRIMARY KEY,
                assignment_id INTEGER REFERENCES hotel_assignments(id) ON DELETE CASCADE,
                item_number INTEGER,
                item_name VARCHAR(100),
                charge DECIMAL(10, 2),
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ hotel_assignment_extras 테이블 생성 완료');
        
        // ==========================================
        // 11. 호텔 정산 관리 (신규)
        // ==========================================
        await client.query(`
            CREATE TABLE IF NOT EXISTS hotel_settlements (
                id SERIAL PRIMARY KEY,
                hotel_reservation_id INTEGER REFERENCES hotel_reservations(id) ON DELETE CASCADE,
                booking_agency_id INTEGER REFERENCES booking_agencies(id),
                selling_price DECIMAL(10, 2) NOT NULL,
                cost_price DECIMAL(10, 2) NOT NULL,
                margin DECIMAL(10, 2),
                commission_amount DECIMAL(10, 2),
                exchange_rate DECIMAL(10, 4),
                payment_received BOOLEAN DEFAULT false,
                payment_received_date DATE,
                payment_sent BOOLEAN DEFAULT false,
                payment_sent_date DATE,
                memo TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ hotel_settlements 테이블 생성 완료');
        
        await client.query('COMMIT');
        
        console.log('\n🎉 호텔 ERP 테이블 생성/업데이트 완료!\n');
        console.log('📋 생성된 테이블 목록:');
        console.log('  1. hotels - 호텔 마스터 (지역, 체크인/아웃 시간)');
        console.log('  2. booking_agencies - 예약업체 관리 ⭐신규');
        console.log('  3. room_types - 객실 타입 (표준화 + 매핑, 유아 인원)');
        console.log('  4. room_availability - 객실 재고 (가능수/총배정/예약수) ⭐보완');
        console.log('  5. availability_uploads - 재고 업로드 히스토리');
        console.log('  6. promotions - 프로모션/특가 관리 ⭐신규');
        console.log('  7. rate_conditions - 취소/변경 규정 ⭐신규');
        console.log('  8. room_rates - 요금 그리드 (핵심!) ⭐신규');
        console.log('  9. hotel_reservations - 호텔 예약 (인박스 연동)');
        console.log(' 10. hotel_assignments - 호텔 수배 관리');
        console.log(' 11. hotel_settlements - 호텔 정산 관리 ⭐신규\n');
        
        console.log('✨ 주요 개선사항:');
        console.log('  ✅ 객실 재고 관리 (가능 객실 수 추적)');
        console.log('  ✅ 요금 그리드 시스템 (날짜별 요금 관리)');
        console.log('  ✅ 프로모션 코드 시스템');
        console.log('  ✅ 취소/변경 규정 관리');
        console.log('  ✅ 예약업체별 수수료 관리');
        console.log('  ✅ 판매가/원가 분리 (정산 연동)');
        console.log('  ✅ 유아 인원 구분\n');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 테이블 생성 오류:', error);
        throw error;
    } finally {
        client.release();
        // 주의: 모듈로 사용될 때 pool을 닫으면 안됨
        if (require.main === module) {
            await pool.end();
        }
    }
}

// 실행
if (require.main === module) {
    createHotelTablesV2()
        .then(() => {
            console.log('✅ 완료!');
            process.exit(0);
        })
        .catch(err => {
            console.error('❌ 실패:', err);
            process.exit(1);
        });
}

module.exports = { createHotelTablesV2 };
