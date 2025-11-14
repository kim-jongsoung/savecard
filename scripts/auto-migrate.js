/**
 * 서버 시작 시 자동 마이그레이션
 * 테이블이 없으면 자동으로 생성
 */

const fs = require('fs');
const path = require('path');

async function autoMigrate(pool) {
    try {
        // 1. season_types 테이블 존재 확인 (006)
        const checkSeasonTable = await pool.query(
            `SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'season_types'
            )`
        );
        
        if (!checkSeasonTable.rows[0].exists) {
            console.log('🔧 시즌 테이블이 없습니다. 마이그레이션 006을 실행합니다...');
            
            const migration006 = path.join(__dirname, '../migrations/006_create_season_tables.sql');
            const sql006 = fs.readFileSync(migration006, 'utf8');
            
            await pool.query(sql006);
            console.log('✅ 시즌 관리 테이블 생성 완료!');
        } else {
            console.log('✅ 시즌 테이블이 이미 존재합니다.');
        }
        
        // 2. promotion_daily_rates 테이블 존재 확인 (008)
        const checkPromoTable = await pool.query(
            `SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'promotion_daily_rates'
            )`
        );
        
        if (!checkPromoTable.rows[0].exists) {
            console.log('🔧 프로모션 테이블을 재설계합니다. 마이그레이션 008을 실행합니다...');
            
            const migration008 = path.join(__dirname, '../migrations/008_recreate_promotions_simple.sql');
            const sql008 = fs.readFileSync(migration008, 'utf8');
            
            console.log('📄 SQL 파일 로드 완료, 실행 중...');
            await pool.query(sql008);
            console.log('✅ 프로모션 시스템 재설계 완료!');
        } else {
            console.log('✅ 프로모션 테이블이 이미 최신 버전입니다.');
        }
    } catch (error) {
        console.error('❌ 자동 마이그레이션 실패:', error.message);
        // 에러가 나도 서버는 계속 실행
    }
}

module.exports = { autoMigrate };
