#!/usr/bin/env node

/**
 * Railway 마이그레이션 실행 스크립트
 * Railway 콘솔에서 직접 실행 가능
 * 
 * 사용법:
 * 1. Railway 대시보드 → 프로젝트 → Variables 탭
 * 2. RUN_MIGRATION=true 환경변수 추가
 * 3. 서버 재시작 또는 이 스크립트 직접 실행
 */

const { Pool } = require('pg');

// Railway PostgreSQL 연결
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runSettlementMigration() {
    try {
        console.log('🚀 Railway 정산 필드 마이그레이션 시작...');
        console.log('📅 실행 시간:', new Date().toISOString());
        
        // 연결 테스트
        await pool.query('SELECT NOW()');
        console.log('✅ 데이터베이스 연결 성공');
        
        // migration_log 테이블 생성 (없으면)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS migration_log (
                id SERIAL PRIMARY KEY,
                version VARCHAR(10) UNIQUE NOT NULL,
                description TEXT,
                executed_at TIMESTAMP DEFAULT NOW()
            )
        `);
        
        // 마이그레이션 004 실행 여부 확인
        const migration004Check = await pool.query(
            'SELECT * FROM migration_log WHERE version = $1',
            ['004']
        ).catch(() => ({ rows: [] }));
        
        if (migration004Check.rows.length > 0) {
            console.log('⚠️ 마이그레이션 004가 이미 실행되었습니다. 강제 재실행...');
            await pool.query('DELETE FROM migration_log WHERE version = $1', ['004']);
        }
        
        console.log('🔧 정산 필드 추가 시작...');
        
        await pool.query('BEGIN');
        
        // 정산 관련 컬럼들 추가
        await pool.query(`
            DO $$ 
            BEGIN
                -- 매출 금액 (고객이 지불한 금액)
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'reservations' AND column_name = 'sale_amount'
                ) THEN
                    ALTER TABLE reservations ADD COLUMN sale_amount DECIMAL(10,2);
                    RAISE NOTICE '✅ sale_amount 컬럼 추가됨';
                ELSE
                    RAISE NOTICE 'ℹ️ sale_amount 컬럼이 이미 존재함';
                END IF;
                
                -- 매입 금액 (수배업체에 지불할 금액)
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'reservations' AND column_name = 'cost_amount'
                ) THEN
                    ALTER TABLE reservations ADD COLUMN cost_amount DECIMAL(10,2);
                    RAISE NOTICE '✅ cost_amount 컬럼 추가됨';
                ELSE
                    RAISE NOTICE 'ℹ️ cost_amount 컬럼이 이미 존재함';
                END IF;
                
                -- 마진 (매출 - 매입)
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'reservations' AND column_name = 'profit_amount'
                ) THEN
                    ALTER TABLE reservations ADD COLUMN profit_amount DECIMAL(10,2);
                    RAISE NOTICE '✅ profit_amount 컬럼 추가됨';
                ELSE
                    RAISE NOTICE 'ℹ️ profit_amount 컬럼이 이미 존재함';
                END IF;
                
                -- 정산 상태 (pending, settled, overdue)
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'reservations' AND column_name = 'settlement_status'
                ) THEN
                    ALTER TABLE reservations ADD COLUMN settlement_status VARCHAR(20) DEFAULT 'pending';
                    RAISE NOTICE '✅ settlement_status 컬럼 추가됨';
                ELSE
                    RAISE NOTICE 'ℹ️ settlement_status 컬럼이 이미 존재함';
                END IF;
                
                -- 정산 메모
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'reservations' AND column_name = 'settlement_notes'
                ) THEN
                    ALTER TABLE reservations ADD COLUMN settlement_notes TEXT;
                    RAISE NOTICE '✅ settlement_notes 컬럼 추가됨';
                ELSE
                    RAISE NOTICE 'ℹ️ settlement_notes 컬럼이 이미 존재함';
                END IF;
                
                -- 정산 완료 일시
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'reservations' AND column_name = 'settled_at'
                ) THEN
                    ALTER TABLE reservations ADD COLUMN settled_at TIMESTAMP;
                    RAISE NOTICE '✅ settled_at 컬럼 추가됨';
                ELSE
                    RAISE NOTICE 'ℹ️ settled_at 컬럼이 이미 존재함';
                END IF;
                
                -- 정산 담당자
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'reservations' AND column_name = 'settled_by'
                ) THEN
                    ALTER TABLE reservations ADD COLUMN settled_by VARCHAR(100);
                    RAISE NOTICE '✅ settled_by 컬럼 추가됨';
                ELSE
                    RAISE NOTICE 'ℹ️ settled_by 컬럼이 이미 존재함';
                END IF;
            END $$;
        `);
        
        // 인덱스 추가 (성능 최적화)
        console.log('🔧 인덱스 생성 중...');
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_reservations_settlement_status ON reservations(settlement_status);
            CREATE INDEX IF NOT EXISTS idx_reservations_settled_at ON reservations(settled_at);
            CREATE INDEX IF NOT EXISTS idx_reservations_payment_settlement ON reservations(payment_status, settlement_status);
        `);
        
        // 기존 바우처 전송 완료 예약들의 정산 상태 초기화
        console.log('🔧 기존 예약 정산 상태 초기화 중...');
        const updateQuery = `
            UPDATE reservations 
            SET settlement_status = 'pending',
                sale_amount = COALESCE(total_amount, 0)
            WHERE payment_status = 'voucher_sent' 
            AND settlement_status IS NULL
        `;
        
        const result = await pool.query(updateQuery);
        console.log(`✅ 기존 예약 ${result.rowCount}건의 정산 상태 초기화 완료`);
        
        // 마이그레이션 로그 기록
        await pool.query(
            'INSERT INTO migration_log (version, description) VALUES ($1, $2)',
            ['004', '정산관리 필드 추가: sale_amount, cost_amount, profit_amount, settlement_status 등']
        );
        
        await pool.query('COMMIT');
        
        console.log('✅ 정산 필드 마이그레이션 004 완료!');
        
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
        
        console.log('🎉 마이그레이션 성공적으로 완료!');
        
    } catch (error) {
        await pool.query('ROLLBACK');
        console.error('❌ 정산 필드 마이그레이션 실패:', error);
        throw error;
    } finally {
        await pool.end();
    }
}

// 스크립트 실행
if (require.main === module) {
    runSettlementMigration()
        .then(() => {
            console.log('✅ Railway 마이그레이션 스크립트 완료');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ 마이그레이션 실행 실패:', error);
            process.exit(1);
        });
}

module.exports = { runSettlementMigration };
