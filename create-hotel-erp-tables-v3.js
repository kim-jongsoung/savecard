const { Pool } = require('pg');
const fs = require('fs');

// 환경변수 로드 (railsql.env 우선)
if (fs.existsSync('./railsql.env')) {
    console.log('🔧 railsql.env 파일을 사용합니다 (로컬 Railway 연동)');
    require('dotenv').config({ path: './railsql.env' });
} else {
    console.log('🔧 기본 .env 파일을 사용합니다');
    require('dotenv').config();
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function createHotelTablesV3() {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        console.log('🏨 호텔 ERP 테이블 생성/업데이트 시작 (v3)...\n');
        
        // ==========================================
        // 1. 호텔 마스터 (국가, 예약과 정보 추가)
        // ==========================================
        await client.query(`
            CREATE TABLE IF NOT EXISTS hotels (
                id SERIAL PRIMARY KEY,
                hotel_code VARCHAR(50) UNIQUE NOT NULL,
                hotel_name VARCHAR(100) NOT NULL,
                hotel_name_en VARCHAR(100),
                country VARCHAR(50),
                region VARCHAR(50),
                address TEXT,
                contact_email VARCHAR(100),
                contact_phone VARCHAR(50),
                reservation_email VARCHAR(255),
                reservation_fax VARCHAR(50),
                contact_person VARCHAR(100),
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
            'country VARCHAR(50)',
            'reservation_email VARCHAR(255)',
            'reservation_fax VARCHAR(50)',
            'contact_person VARCHAR(100)'
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
        console.log('✅ hotels 컬럼 마이그레이션 완료 (국가, 예약과 정보)');
        
        // ==========================================
        // 2. 거래처 관리 (한국 여행사)
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
                bank_info TEXT,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ booking_agencies 테이블 생성 완료 (거래처 관리)');
        
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
                
                -- 기본 요금 (참고용)
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
        
        // ==========================================
        // 4. 객실 재고 관리
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
        
        await client.query(`CREATE INDEX IF NOT EXISTS idx_room_availability_date ON room_availability(availability_date)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_room_availability_lookup ON room_availability(room_type_id, availability_date)`);
        
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
                status VARCHAR(20) DEFAULT 'pending',
                error_message TEXT,
                confirmed_at TIMESTAMP,
                confirmed_by VARCHAR(100)
            )
        `);
        console.log('✅ availability_uploads 테이블 생성 완료');
        
        // ==========================================
        // 6. 프로모션 관리
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
        // 7. 요금 조건 (취소/변경 규정)
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
        // 8. 객실 요금 그리드 (핵심!)
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
        
        await client.query(`CREATE INDEX IF NOT EXISTS idx_room_rates_date ON room_rates(apply_date)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_room_rates_lookup ON room_rates(room_type_id, apply_date)`);
        
        // ==========================================
        // 9. 호텔 예약 (메인 - 전체 요약)
        // ==========================================
        await client.query(`
            CREATE TABLE IF NOT EXISTS hotel_reservations (
                id SERIAL PRIMARY KEY,
                reservation_number VARCHAR(100) UNIQUE NOT NULL,
                booking_agency_id INTEGER REFERENCES booking_agencies(id),
                hotel_id INTEGER REFERENCES hotels(id),
                
                -- 날짜 정보
                check_in_date DATE NOT NULL,
                check_out_date DATE NOT NULL,
                nights INTEGER NOT NULL,
                
                -- 객실 및 인원 요약
                total_rooms INTEGER DEFAULT 1,
                total_guests INTEGER DEFAULT 2,
                total_adults INTEGER DEFAULT 2,
                total_children INTEGER DEFAULT 0,
                total_infants INTEGER DEFAULT 0,
                
                -- 가격 요약
                total_selling_price DECIMAL(10, 2),
                total_cost_price DECIMAL(10, 2),
                total_margin DECIMAL(10, 2),
                currency VARCHAR(10) DEFAULT 'USD',
                
                -- 상태 관리
                status VARCHAR(20) DEFAULT 'pending' 
                    CHECK (status IN ('pending', 'processing', 'confirmed', 'voucher', 'settlement', 'cancelled', 'completed')),
                
                -- 담당자
                assigned_to VARCHAR(100),
                created_by VARCHAR(100),
                
                -- 전체 메모 및 특별 요청
                special_requests TEXT,
                internal_memo TEXT,
                
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ hotel_reservations 테이블 생성 완료');
        
        // hotel_reservations 새 컬럼 마이그레이션
        const hotelResNewColumns = [
            'total_rooms INTEGER DEFAULT 1',
            'total_guests INTEGER DEFAULT 2',
            'total_adults INTEGER DEFAULT 2',
            'total_children INTEGER DEFAULT 0',
            'total_infants INTEGER DEFAULT 0',
            'total_selling_price DECIMAL(10, 2)',
            'total_cost_price DECIMAL(10, 2)',
            'total_margin DECIMAL(10, 2)',
            'internal_memo TEXT',
            'status VARCHAR(20) DEFAULT \'pending\''
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
        
        await client.query(`CREATE INDEX IF NOT EXISTS idx_hotel_res_checkin ON hotel_reservations(check_in_date)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_hotel_res_status ON hotel_reservations(status)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_hotel_res_agency ON hotel_reservations(booking_agency_id)`);
        
        // ==========================================
        // 10. 객실별 상세 정보 ⭐ 신규!
        // ==========================================
        await client.query(`
            CREATE TABLE IF NOT EXISTS hotel_reservation_rooms (
                id SERIAL PRIMARY KEY,
                reservation_id INTEGER REFERENCES hotel_reservations(id) ON DELETE CASCADE,
                room_number INTEGER NOT NULL,
                room_type_id INTEGER REFERENCES room_types(id),
                
                -- 객실 옵션
                bed_type VARCHAR(50),
                smoking VARCHAR(20),
                floor_preference VARCHAR(50),
                view_type VARCHAR(50),
                
                -- 인원
                adults_count INTEGER DEFAULT 2,
                children_count INTEGER DEFAULT 0,
                infants_count INTEGER DEFAULT 0,
                total_guests INTEGER DEFAULT 2,
                
                -- 요금
                room_rate_per_night DECIMAL(10, 2),
                total_room_charge DECIMAL(10, 2),
                breakfast_included BOOLEAN DEFAULT false,
                breakfast_count INTEGER DEFAULT 0,
                breakfast_charge DECIMAL(10, 2) DEFAULT 0,
                extra_charges DECIMAL(10, 2) DEFAULT 0,
                room_selling_price DECIMAL(10, 2),
                room_cost_price DECIMAL(10, 2),
                
                -- 항공편 정보
                arrival_flight VARCHAR(50),
                arrival_date DATE,
                arrival_time TIME,
                departure_flight VARCHAR(50),
                departure_date DATE,
                departure_time TIME,
                
                -- 특별 요청
                room_special_requests TEXT,
                
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ hotel_reservation_rooms 테이블 생성 완료 ⭐ 신규');
        
        await client.query(`CREATE INDEX IF NOT EXISTS idx_res_rooms_reservation ON hotel_reservation_rooms(reservation_id)`);
        
        // ==========================================
        // 11. 투숙객별 상세 정보 ⭐ 신규!
        // ==========================================
        await client.query(`
            CREATE TABLE IF NOT EXISTS hotel_reservation_guests (
                id SERIAL PRIMARY KEY,
                reservation_room_id INTEGER REFERENCES hotel_reservation_rooms(id) ON DELETE CASCADE,
                guest_type VARCHAR(20) DEFAULT 'primary' 
                    CHECK (guest_type IN ('primary', 'companion')),
                
                -- 투숙객 정보
                guest_name_ko VARCHAR(100),
                guest_name_en VARCHAR(200),
                date_of_birth DATE,
                gender VARCHAR(10),
                nationality VARCHAR(50),
                passport_number VARCHAR(50),
                phone VARCHAR(50),
                email VARCHAR(255),
                relationship VARCHAR(50),
                age_category VARCHAR(20) 
                    CHECK (age_category IN ('adult', 'child', 'infant')),
                
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ hotel_reservation_guests 테이블 생성 완료 ⭐ 신규');
        
        await client.query(`CREATE INDEX IF NOT EXISTS idx_res_guests_room ON hotel_reservation_guests(reservation_room_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_res_guests_type ON hotel_reservation_guests(guest_type)`);
        
        // ==========================================
        // 12. 호텔 수배 관리
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
        // 13. 인보이스 관리 ⭐ 신규!
        // ==========================================
        await client.query(`
            CREATE TABLE IF NOT EXISTS hotel_invoices (
                id SERIAL PRIMARY KEY,
                invoice_number VARCHAR(100) UNIQUE NOT NULL,
                hotel_reservation_id INTEGER REFERENCES hotel_reservations(id) ON DELETE CASCADE,
                booking_agency_id INTEGER REFERENCES booking_agencies(id),
                
                -- 인보이스 상세
                invoice_date DATE DEFAULT CURRENT_DATE,
                due_date DATE,
                total_amount DECIMAL(10, 2),
                currency VARCHAR(10) DEFAULT 'USD',
                
                -- 발송 정보
                status VARCHAR(20) DEFAULT 'draft'
                    CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
                sent_at TIMESTAMP,
                sent_by VARCHAR(100),
                sent_method VARCHAR(20),
                
                -- 결제 정보
                paid_at TIMESTAMP,
                payment_method VARCHAR(50),
                payment_reference VARCHAR(100),
                
                -- 메모
                notes TEXT,
                
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ hotel_invoices 테이블 생성 완료 ⭐ 신규');
        
        await client.query(`CREATE INDEX IF NOT EXISTS idx_invoices_reservation ON hotel_invoices(hotel_reservation_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_invoices_agency ON hotel_invoices(booking_agency_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_invoices_status ON hotel_invoices(status)`);
        
        // ==========================================
        // 14. 호텔 정산 관리
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
        
        console.log('\n🎉 호텔 ERP 테이블 생성/업데이트 완료! (v3)\n');
        console.log('📋 생성된 테이블 목록:');
        console.log('  1. hotels - 호텔 마스터 (국가, 예약과 정보 추가) ⭐');
        console.log('  2. booking_agencies - 거래처 관리 (한국 여행사)');
        console.log('  3. room_types - 객실 타입');
        console.log('  4. room_availability - 객실 재고');
        console.log('  5. availability_uploads - 재고 업로드 히스토리');
        console.log('  6. promotions - 프로모션 관리');
        console.log('  7. rate_conditions - 취소/변경 규정');
        console.log('  8. room_rates - 요금 그리드');
        console.log('  9. hotel_reservations - 호텔 예약 (전체 요약)');
        console.log(' 10. hotel_reservation_rooms - 객실별 상세 ⭐ 신규');
        console.log(' 11. hotel_reservation_guests - 투숙객별 상세 ⭐ 신규');
        console.log(' 12. hotel_assignments - 수배 관리');
        console.log(' 13. hotel_invoices - 인보이스 관리 ⭐ 신규');
        console.log(' 14. hotel_settlements - 정산 관리\n');
        
        console.log('✨ v3 주요 개선사항:');
        console.log('  ✅ hotels: 국가, 예약과 이메일/팩스 추가');
        console.log('  ✅ hotel_reservation_rooms: 객실별 상세 정보 (N개 객실 지원)');
        console.log('  ✅ hotel_reservation_guests: 투숙객별 정보 (대표+동반)');
        console.log('  ✅ hotel_invoices: 인보이스 발송 관리');
        console.log('  ✅ 객실별 항공편 정보 독립 관리\n');
        
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
    createHotelTablesV3()
        .then(() => {
            console.log('✅ 완료!');
            process.exit(0);
        })
        .catch(err => {
            console.error('❌ 실패:', err);
            process.exit(1);
        });
}

module.exports = { createHotelTablesV3 };
