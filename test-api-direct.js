require('dotenv').config({ path: './railsql.env' });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('railway.app') ? { rejectUnauthorized: false } : false
});

async function testQuery() {
  try {
    const roomTypeId = 4;
    const checkIn = '2026-01-04';
    const checkOut = '2026-01-07';
    
    // 날짜 배열 생성
    const dates = [];
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().split('T')[0]);
    }
    
    console.log('📅 날짜 배열:', dates);
    console.log('🔍 쿼리 실행 중...\n');
    
    const promosQuery = `
      SELECT DISTINCT
        p.id as promotion_id,
        p.promo_code,
        p.promo_name,
        p.booking_start_date,
        p.booking_end_date,
        p.stay_start_date,
        p.stay_end_date,
        CURRENT_DATE as today
      FROM promotions p
      WHERE p.is_active = true
        AND p.booking_start_date <= CURRENT_DATE
        AND p.booking_end_date >= CURRENT_DATE
        AND p.stay_start_date <= $1::date
        AND p.stay_end_date >= $2::date
        AND EXISTS (
          SELECT 1 FROM promotion_daily_rates pdr
          WHERE pdr.promotion_id = p.id
            AND pdr.room_type_id = $3
            AND pdr.stay_date = ANY($4::date[])
        )
      ORDER BY p.promo_code
    `;
    
    const result = await pool.query(promosQuery, [checkIn, checkOut, roomTypeId, dates]);
    
    console.log(`✅ 조회된 프로모션: ${result.rows.length}개\n`);
    
    if (result.rows.length > 0) {
      result.rows.forEach(p => {
        console.log(`🎁 ${p.promo_code}: ${p.promo_name}`);
        console.log(`   오늘: ${p.today}`);
        console.log(`   예약 기간: ${p.booking_start_date} ~ ${p.booking_end_date}`);
        console.log(`   투숙 기간: ${p.stay_start_date} ~ ${p.stay_end_date}`);
        console.log('');
      });
    } else {
      console.log('❌ 프로모션이 조회되지 않았습니다!\n');
      console.log('조건 확인:');
      console.log('1. is_active = true');
      console.log(`2. booking_start_date <= CURRENT_DATE (오늘)`);
      console.log(`3. booking_end_date >= CURRENT_DATE (오늘)`);
      console.log(`4. stay_start_date <= ${checkIn}`);
      console.log(`5. stay_end_date >= ${checkOut}`);
      console.log(`6. room_type_id = ${roomTypeId}의 요금 데이터 존재`);
      console.log(`7. stay_date IN (${dates.join(', ')})`);
      
      // 각 조건별로 확인
      console.log('\n🔍 조건별 확인:\n');
      
      const activePromos = await pool.query(`
        SELECT promo_code, is_active, booking_start_date, booking_end_date
        FROM promotions
        WHERE hotel_id = 1
      `);
      
      console.log('호텔 ID 1의 모든 프로모션:');
      activePromos.rows.forEach(p => {
        const bookingValid = p.booking_start_date <= new Date() && p.booking_end_date >= new Date();
        console.log(`  ${p.promo_code}: active=${p.is_active}, booking_valid=${bookingValid}`);
        console.log(`    예약기간: ${p.booking_start_date} ~ ${p.booking_end_date}`);
      });
    }
    
  } catch (error) {
    console.error('❌ 오류:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

testQuery();
