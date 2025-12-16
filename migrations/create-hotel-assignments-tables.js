const { Pool } = require('pg');

async function createHotelAssignmentsTables(existingPool) {
    // 전달된 pool 사용하거나 새로 생성
    const pool = existingPool || new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
    });

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        console.log('🔧 호텔 수배서 테이블 생성/확인 시작...');
        
        // 1. hotel_assignments 메인 테이블 (이미 있으면 유지)
        await client.query(`
            CREATE TABLE IF NOT EXISTS hotel_assignments (
                id SERIAL PRIMARY KEY,
                reservation_id INTEGER,
                assignment_type VARCHAR(20) NOT NULL,
                revision_number INTEGER DEFAULT 0,
                assignment_token VARCHAR(255) UNIQUE,
                
                -- 예약 정보 스냅샷
                hotel_id INTEGER,
                hotel_name VARCHAR(255),
                booking_agency_id INTEGER,
                booking_agency_name VARCHAR(255),
                agency_contact_person VARCHAR(100),
                agency_contact_email VARCHAR(255),
                
                check_in_date DATE,
                check_out_date DATE,
                nights INTEGER,
                arrival_flight VARCHAR(50),
                departure_flight VARCHAR(50),
                
                total_amount DECIMAL(10,2) DEFAULT 0,
                agency_fee DECIMAL(10,2) DEFAULT 0,
                hotel_payment DECIMAL(10,2) DEFAULT 0,
                
                internal_memo TEXT,
                changes_description TEXT,
                
                -- 전송 정보
                sent_to_email VARCHAR(255),
                sent_at TIMESTAMP,
                sent_by VARCHAR(100),
                email_message_id VARCHAR(255),
                
                -- 열람 추적
                email_viewed BOOLEAN DEFAULT FALSE,
                viewed_at TIMESTAMP,
                view_count INTEGER DEFAULT 0,
                
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ hotel_assignments 테이블 생성 완료');
        
        // 2. hotel_assignment_rooms 테이블 (이미 있으면 유지)
        await client.query(`
            CREATE TABLE IF NOT EXISTS hotel_assignment_rooms (
                id SERIAL PRIMARY KEY,
                assignment_id INTEGER REFERENCES hotel_assignments(id) ON DELETE CASCADE,
                room_number INTEGER,
                
                room_type_id INTEGER,
                room_type_name VARCHAR(100),
                room_rate DECIMAL(10,2) DEFAULT 0,
                total_selling_price DECIMAL(10,2) DEFAULT 0,
                promotion_code VARCHAR(50),
                
                breakfast_included BOOLEAN DEFAULT FALSE,
                breakfast_days INTEGER DEFAULT 0,
                breakfast_adult_count INTEGER DEFAULT 0,
                breakfast_adult_price DECIMAL(10,2) DEFAULT 0,
                breakfast_child_count INTEGER DEFAULT 0,
                breakfast_child_price DECIMAL(10,2) DEFAULT 0,
                
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ hotel_assignment_rooms 테이블 생성 완료');
        
        // 3. hotel_assignment_guests 테이블 (이미 있으면 유지)
        await client.query(`
            CREATE TABLE IF NOT EXISTS hotel_assignment_guests (
                id SERIAL PRIMARY KEY,
                assignment_room_id INTEGER REFERENCES hotel_assignment_rooms(id) ON DELETE CASCADE,
                guest_number INTEGER,
                
                korean_name VARCHAR(100),
                english_first_name VARCHAR(100),
                english_last_name VARCHAR(100),
                birth_date DATE,
                
                is_adult BOOLEAN DEFAULT TRUE,
                is_child BOOLEAN DEFAULT FALSE,
                is_infant BOOLEAN DEFAULT FALSE,
                
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ hotel_assignment_guests 테이블 생성 완료');
        
        // 4. hotel_assignment_extras 테이블 (이미 있으면 유지)
        await client.query(`
            CREATE TABLE IF NOT EXISTS hotel_assignment_extras (
                id SERIAL PRIMARY KEY,
                assignment_id INTEGER REFERENCES hotel_assignments(id) ON DELETE CASCADE,
                item_number INTEGER,
                
                item_name VARCHAR(255),
                charge DECIMAL(10,2) DEFAULT 0,
                
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('✅ hotel_assignment_extras 테이블 생성 완료');
        
        // 인덱스 생성
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_assignments_reservation 
            ON hotel_assignments(reservation_id)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_assignments_token 
            ON hotel_assignments(assignment_token)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_assignments_type 
            ON hotel_assignments(assignment_type)
        `);
        console.log('✅ 인덱스 생성 완료');
        
        await client.query('COMMIT');
        console.log('🎉 호텔 수배서 테이블 생성 완료!');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 테이블 생성 오류:', error);
        throw error;
    } finally {
        client.release();
        // 전달받은 pool이면 종료하지 않음
        if (!existingPool) {
            await pool.end();
        }
    }
}

// 직접 실행 시
if (require.main === module) {
    createHotelAssignmentsTables()
        .then(() => {
            console.log('✅ 마이그레이션 완료');
            process.exit(0);
        })
        .catch(err => {
            console.error('❌ 마이그레이션 실패:', err);
            process.exit(1);
        });
}

module.exports = createHotelAssignmentsTables;
