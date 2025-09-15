const { Pool } = require('pg');

// PostgreSQL 연결 설정
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/guamsavecard',
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function migrateReservations() {
    const client = await pool.connect();
    
    try {
        console.log('🔄 예약 데이터 마이그레이션 시작...');
        
        // 1. 기존 reservations 테이블 백업
        console.log('📋 기존 데이터 백업 중...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS reservations_backup AS 
            SELECT * FROM reservations WHERE 1=0
        `);
        
        // 기존 데이터가 있다면 백업
        const existingData = await client.query('SELECT COUNT(*) FROM reservations');
        if (existingData.rows[0].count > 0) {
            await client.query('INSERT INTO reservations_backup SELECT * FROM reservations');
            console.log(`✅ ${existingData.rows[0].count}개 레코드 백업 완료`);
        }
        
        // 2. 기존 테이블 삭제 (CASCADE로 연관 데이터도 삭제)
        console.log('🗑️ 기존 테이블 구조 삭제 중...');
        await client.query('DROP TABLE IF EXISTS reservations CASCADE');
        
        // 3. 새로운 6개 테이블 생성
        console.log('🏗️ 새로운 테이블 구조 생성 중...');
        
        // 1. reservations (예약 기본) 테이블 생성
        await client.query(`
            CREATE TABLE IF NOT EXISTS reservations (
                reservation_id SERIAL PRIMARY KEY,
                reservation_code VARCHAR(100) UNIQUE NOT NULL,
                reservation_channel VARCHAR(50),
                platform_name VARCHAR(50),
                reservation_status VARCHAR(20) DEFAULT '접수',
                reservation_datetime TIMESTAMP,
                product_name VARCHAR(200),
                total_quantity INTEGER DEFAULT 1,
                total_price DECIMAL(12,2),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // 2. reservation_schedules (이용 일정) 테이블 생성
        await client.query(`
            CREATE TABLE IF NOT EXISTS reservation_schedules (
                schedule_id SERIAL PRIMARY KEY,
                reservation_id INTEGER REFERENCES reservations(reservation_id) ON DELETE CASCADE,
                usage_date DATE,
                usage_time TIME,
                package_type VARCHAR(50),
                package_count INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // 3. reservation_customers (예약자 및 고객 정보) 테이블 생성
        await client.query(`
            CREATE TABLE IF NOT EXISTS reservation_customers (
                customer_id SERIAL PRIMARY KEY,
                reservation_id INTEGER REFERENCES reservations(reservation_id) ON DELETE CASCADE,
                name_kr VARCHAR(100),
                name_en_first VARCHAR(100),
                name_en_last VARCHAR(100),
                phone VARCHAR(50),
                email VARCHAR(200),
                kakao_id VARCHAR(100),
                people_adult INTEGER DEFAULT 0,
                people_child INTEGER DEFAULT 0,
                people_infant INTEGER DEFAULT 0,
                memo TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // 4. reservation_payments (결제 내역) 테이블 생성
        await client.query(`
            CREATE TABLE IF NOT EXISTS reservation_payments (
                payment_id SERIAL PRIMARY KEY,
                reservation_id INTEGER REFERENCES reservations(reservation_id) ON DELETE CASCADE,
                adult_unit_price DECIMAL(10,2) DEFAULT 0,
                child_unit_price DECIMAL(10,2) DEFAULT 0,
                infant_unit_price DECIMAL(10,2) DEFAULT 0,
                adult_count INTEGER DEFAULT 0,
                child_count INTEGER DEFAULT 0,
                infant_count INTEGER DEFAULT 0,
                platform_sale_amount DECIMAL(12,2),
                platform_settlement_amount DECIMAL(12,2),
                payment_status VARCHAR(20) DEFAULT '대기',
                payment_date DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // 5. cancellation_policies (취소/환불 규정) 테이블 생성
        await client.query(`
            CREATE TABLE IF NOT EXISTS cancellation_policies (
                policy_id SERIAL PRIMARY KEY,
                reservation_id INTEGER REFERENCES reservations(reservation_id) ON DELETE CASCADE,
                policy_text TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // 6. reservation_logs (예약 변경 이력) 테이블 생성
        await client.query(`
            CREATE TABLE IF NOT EXISTS reservation_logs (
                log_id SERIAL PRIMARY KEY,
                reservation_id INTEGER REFERENCES reservations(reservation_id) ON DELETE CASCADE,
                action VARCHAR(50),
                changed_by VARCHAR(100),
                changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                old_data JSONB,
                new_data JSONB
            )
        `);
        
        console.log('✅ 새로운 테이블 구조 생성 완료');
        
        // 4. 백업 데이터를 새로운 구조로 마이그레이션
        const backupCount = await client.query('SELECT COUNT(*) FROM reservations_backup');
        if (backupCount.rows[0].count > 0) {
            console.log('🔄 백업 데이터를 새로운 구조로 마이그레이션 중...');
            
            const backupData = await client.query(`
                SELECT * FROM reservations_backup ORDER BY created_at
            `);
            
            let migratedCount = 0;
            
            for (const oldRecord of backupData.rows) {
                await client.query('BEGIN');
                
                try {
                    // 1. reservations 테이블에 삽입
                    const reservationResult = await client.query(`
                        INSERT INTO reservations (
                            reservation_code, reservation_channel, platform_name, 
                            reservation_status, product_name, total_quantity, 
                            total_price, created_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                        RETURNING reservation_id
                    `, [
                        oldRecord.reservation_number || oldRecord.id,
                        oldRecord.channel || '웹',
                        'NOL', // 기본값
                        '접수',
                        oldRecord.product_name,
                        oldRecord.guest_count || 1,
                        oldRecord.total_amount,
                        oldRecord.created_at
                    ]);
                    
                    const newReservationId = reservationResult.rows[0].reservation_id;
                    
                    // 2. reservation_schedules 테이블에 삽입
                    if (oldRecord.usage_date || oldRecord.usage_time) {
                        await client.query(`
                            INSERT INTO reservation_schedules (
                                reservation_id, usage_date, usage_time, package_type, package_count
                            ) VALUES ($1, $2, $3, $4, $5)
                        `, [
                            newReservationId,
                            oldRecord.usage_date,
                            oldRecord.usage_time,
                            oldRecord.package_type || '기본',
                            oldRecord.guest_count || 1
                        ]);
                    }
                    
                    // 3. reservation_customers 테이블에 삽입
                    await client.query(`
                        INSERT INTO reservation_customers (
                            reservation_id, name_kr, name_en_first, name_en_last,
                            phone, email, kakao_id, people_adult, memo
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    `, [
                        newReservationId,
                        oldRecord.korean_name,
                        oldRecord.english_first_name,
                        oldRecord.english_last_name,
                        oldRecord.phone,
                        oldRecord.email,
                        oldRecord.kakao_id,
                        oldRecord.guest_count || 1,
                        oldRecord.memo
                    ]);
                    
                    // 4. reservation_payments 테이블에 삽입
                    if (oldRecord.total_amount) {
                        await client.query(`
                            INSERT INTO reservation_payments (
                                reservation_id, adult_count, platform_sale_amount,
                                platform_settlement_amount, payment_status
                            ) VALUES ($1, $2, $3, $4, $5)
                        `, [
                            newReservationId,
                            oldRecord.guest_count || 1,
                            oldRecord.total_amount,
                            oldRecord.total_amount,
                            oldRecord.code_issued ? '완료' : '대기'
                        ]);
                    }
                    
                    // 5. reservation_logs 테이블에 삽입
                    await client.query(`
                        INSERT INTO reservation_logs (
                            reservation_id, action, changed_by, old_data
                        ) VALUES ($1, $2, $3, $4)
                    `, [
                        newReservationId,
                        '마이그레이션',
                        '시스템',
                        JSON.stringify(oldRecord)
                    ]);
                    
                    await client.query('COMMIT');
                    migratedCount++;
                    
                } catch (error) {
                    await client.query('ROLLBACK');
                    console.error(`❌ 레코드 마이그레이션 실패 (ID: ${oldRecord.id}):`, error.message);
                }
            }
            
            console.log(`✅ ${migratedCount}개 레코드 마이그레이션 완료`);
        }
        
        // 5. 인덱스 생성
        console.log('🔍 인덱스 생성 중...');
        await client.query('CREATE INDEX IF NOT EXISTS idx_reservations_code ON reservations(reservation_code)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_reservations_platform ON reservations(platform_name)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_customers_email ON reservation_customers(email)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_schedules_date ON reservation_schedules(usage_date)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_payments_status ON reservation_payments(payment_status)');
        
        console.log('✅ 인덱스 생성 완료');
        
        // 6. 통계 출력
        const stats = await client.query(`
            SELECT 
                COUNT(DISTINCT r.reservation_id) as total_reservations,
                COUNT(DISTINCT s.schedule_id) as total_schedules,
                COUNT(DISTINCT c.customer_id) as total_customers,
                COUNT(DISTINCT p.payment_id) as total_payments,
                COUNT(DISTINCT pol.policy_id) as total_policies,
                COUNT(DISTINCT l.log_id) as total_logs
            FROM reservations r
            LEFT JOIN reservation_schedules s ON r.reservation_id = s.reservation_id
            LEFT JOIN reservation_customers c ON r.reservation_id = c.reservation_id
            LEFT JOIN reservation_payments p ON r.reservation_id = p.reservation_id
            LEFT JOIN cancellation_policies pol ON r.reservation_id = pol.reservation_id
            LEFT JOIN reservation_logs l ON r.reservation_id = l.reservation_id
        `);
        
        console.log('\n📊 마이그레이션 완료 통계:');
        console.log(`- 예약: ${stats.rows[0].total_reservations}개`);
        console.log(`- 일정: ${stats.rows[0].total_schedules}개`);
        console.log(`- 고객: ${stats.rows[0].total_customers}개`);
        console.log(`- 결제: ${stats.rows[0].total_payments}개`);
        console.log(`- 정책: ${stats.rows[0].total_policies}개`);
        console.log(`- 로그: ${stats.rows[0].total_logs}개`);
        
        console.log('\n🎉 예약 데이터 마이그레이션이 성공적으로 완료되었습니다!');
        console.log('💡 백업 테이블(reservations_backup)은 확인 후 수동으로 삭제하세요.');
        
    } catch (error) {
        console.error('❌ 마이그레이션 실패:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// 스크립트 실행
if (require.main === module) {
    migrateReservations()
        .then(() => {
            console.log('✅ 마이그레이션 스크립트 실행 완료');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ 마이그레이션 스크립트 실행 실패:', error);
            process.exit(1);
        });
}

module.exports = { migrateReservations };
