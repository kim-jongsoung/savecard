require('dotenv').config({ path: './railsql.env' });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('railway.app') ? { rejectUnauthorized: false } : false
});

async function checkPromos() {
  try {
    console.log('🔍 프로모션 데이터 확인 중...\n');
    
    // 1. 모든 프로모션 조회
    const result = await pool.query(`
      SELECT 
        p.id,
        h.hotel_name,
        p.promo_code,
        p.promo_name,
        p.booking_start_date,
        p.booking_end_date,
        p.stay_start_date,
        p.stay_end_date,
        p.is_active
      FROM promotions p
      JOIN hotels h ON p.hotel_id = h.id
      ORDER BY p.id DESC
      LIMIT 10
    `);
    
    console.log(`📊 총 프로모션 개수: ${result.rows.length}개\n`);
    
    if (result.rows.length === 0) {
      console.log('❌ 프로모션 데이터가 없습니다!');
      console.log('\n해결 방법:');
      console.log('1. 관리자 페이지에서 수동으로 프로모션 등록');
      console.log('2. 또는 아래 SQL로 샘플 데이터 직접 입력\n');
      
      // 호텔과 객실 타입 조회
      const hotelResult = await pool.query('SELECT id, hotel_name FROM hotels WHERE is_active = true LIMIT 1');
      if (hotelResult.rows.length > 0) {
        const hotel = hotelResult.rows[0];
        console.log(`\n--- 샘플 프로모션 SQL (호텔: ${hotel.hotel_name}) ---`);
        console.log(`
INSERT INTO promotions (hotel_id, promo_code, promo_name, booking_start_date, booking_end_date, stay_start_date, stay_end_date, is_active)
VALUES (${hotel.id}, 'EARLYWINTER2025', '조기예약 겨울 특별 프로모션', '2025-11-14', '2025-12-31', '2026-01-10', '2026-02-28', true);
        `);
      }
    } else {
      result.rows.forEach((p, idx) => {
        console.log(`${idx + 1}. [${p.promo_code}] ${p.promo_name}`);
        console.log(`   호텔: ${p.hotel_name}`);
        console.log(`   예약 기간: ${p.booking_start_date} ~ ${p.booking_end_date}`);
        console.log(`   투숙 기간: ${p.stay_start_date} ~ ${p.stay_end_date}`);
        console.log(`   활성화: ${p.is_active ? '✅' : '❌'}\n`);
      });
    }
    
    // 2. 현재 날짜 기준으로 유효한 프로모션 확인
    const activeResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM promotions
      WHERE is_active = true
        AND CURRENT_DATE BETWEEN booking_start_date AND booking_end_date
    `);
    
    console.log(`\n✅ 현재 예약 가능한 프로모션: ${activeResult.rows[0].count}개`);
    
  } catch (error) {
    console.error('❌ 오류:', error.message);
  } finally {
    await pool.end();
  }
}

checkPromos();
