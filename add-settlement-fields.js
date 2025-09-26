const { Pool } = require('pg');

// Railway PostgreSQL 연결
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function addSettlementFields() {
    try {
        console.log('🔍 정산관리 필드 추가 시작...');

        // 정산 관련 컬럼들 추가
        const alterQueries = [
            // 매출 금액 (고객이 지불한 금액)
            `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS sale_amount DECIMAL(10,2)`,
            
            // 매입 금액 (수배업체에 지불할 금액)
            `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS cost_amount DECIMAL(10,2)`,
            
            // 마진 (매출 - 매입)
            `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS profit_amount DECIMAL(10,2)`,
            
            // 정산 상태 (pending, settled, overdue)
            `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS settlement_status VARCHAR(20) DEFAULT 'pending'`,
            
            // 정산 메모
            `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS settlement_notes TEXT`,
            
            // 정산 완료 일시
            `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS settled_at TIMESTAMP`,
            
            // 정산 담당자
            `ALTER TABLE reservations ADD COLUMN IF NOT EXISTS settled_by VARCHAR(100)`
        ];

        for (const query of alterQueries) {
            try {
                await pool.query(query);
                console.log('✅ 컬럼 추가 성공:', query.split('ADD COLUMN IF NOT EXISTS')[1]?.split(' ')[1] || 'unknown');
            } catch (error) {
                if (error.message.includes('already exists')) {
                    console.log('ℹ️ 컬럼이 이미 존재함:', query.split('ADD COLUMN IF NOT EXISTS')[1]?.split(' ')[1] || 'unknown');
                } else {
                    console.error('❌ 컬럼 추가 실패:', error.message);
                }
            }
        }

        // 인덱스 추가 (성능 최적화)
        const indexQueries = [
            `CREATE INDEX IF NOT EXISTS idx_reservations_settlement_status ON reservations(settlement_status)`,
            `CREATE INDEX IF NOT EXISTS idx_reservations_settled_at ON reservations(settled_at)`,
            `CREATE INDEX IF NOT EXISTS idx_reservations_payment_settlement ON reservations(payment_status, settlement_status)`
        ];

        for (const query of indexQueries) {
            try {
                await pool.query(query);
                console.log('✅ 인덱스 생성 성공:', query.split('idx_')[1]?.split(' ')[0] || 'unknown');
            } catch (error) {
                if (error.message.includes('already exists')) {
                    console.log('ℹ️ 인덱스가 이미 존재함:', query.split('idx_')[1]?.split(' ')[0] || 'unknown');
                } else {
                    console.error('❌ 인덱스 생성 실패:', error.message);
                }
            }
        }

        // 기존 바우처 전송 완료 예약들의 정산 상태 초기화
        const updateQuery = `
            UPDATE reservations 
            SET settlement_status = 'pending',
                sale_amount = COALESCE(total_amount, 0)
            WHERE payment_status = 'voucher_sent' 
            AND settlement_status IS NULL
        `;
        
        const result = await pool.query(updateQuery);
        console.log(`✅ 기존 예약 ${result.rowCount}건의 정산 상태 초기화 완료`);

        console.log('🎉 정산관리 필드 추가 완료!');
        
        // 현재 정산 대상 예약 수 확인
        const countQuery = `
            SELECT 
                COUNT(*) as total_voucher_sent,
                COUNT(CASE WHEN settlement_status = 'pending' THEN 1 END) as pending_settlement,
                COUNT(CASE WHEN settlement_status = 'settled' THEN 1 END) as settled
            FROM reservations 
            WHERE payment_status = 'voucher_sent'
        `;
        
        const countResult = await pool.query(countQuery);
        const stats = countResult.rows[0];
        
        console.log('📊 정산 현황:');
        console.log(`   - 바우처 전송 완료: ${stats.total_voucher_sent}건`);
        console.log(`   - 정산 대기: ${stats.pending_settlement}건`);
        console.log(`   - 정산 완료: ${stats.settled}건`);

    } catch (error) {
        console.error('❌ 정산관리 필드 추가 실패:', error);
        throw error;
    } finally {
        await pool.end();
    }
}

// 스크립트 실행
if (require.main === module) {
    addSettlementFields()
        .then(() => {
            console.log('✅ 정산관리 필드 추가 스크립트 완료');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ 스크립트 실행 실패:', error);
            process.exit(1);
        });
}

module.exports = { addSettlementFields };
