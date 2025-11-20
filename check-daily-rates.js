require('dotenv').config({ path: './railsql.env' });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('railway.app') ? { rejectUnauthorized: false } : false
});

async function check() {
  try {
    const roomTypeId = 4; // 디럭스오션프론트
    const checkIn = '2026-01-04';
    const checkOut = '2026-01-07';
    
    console.log('🔍 프로모션 날짜별 요금 데이터 확인\n');
    console.log(`객실 타입 ID: ${roomTypeId}`);
    console.log(`체크인: ${checkIn} ~ 체크아웃: ${checkOut}\n`);
    
    // 1. 전체 프로모션 확인
    const promosResult = await pool.query(`
      SELECT id, promo_code, promo_name
      FROM promotions
      WHERE hotel_id = 1 AND is_active = true
    `);
    
    console.log(`📊 호텔 ID 1의 활성 프로모션: ${promosResult.rows.length}개\n`);
    
    // 2. 각 프로모션별 날짜별 요금 데이터 확인
    for (const promo of promosResult.rows) {
      console.log(`\n🎁 [${promo.promo_code}] ${promo.promo_name}`);
      
      // 객실 타입 4에 대한 요금 데이터 확인
      const ratesResult = await pool.query(`
        SELECT 
          stay_date,
          rate_per_night,
          min_nights,
          room_type_id
        FROM promotion_daily_rates
        WHERE promotion_id = $1
          AND room_type_id = $2
        ORDER BY stay_date
        LIMIT 10
      `, [promo.id, roomTypeId]);
      
      console.log(`  - 객실 타입 ${roomTypeId}의 요금 데이터: ${ratesResult.rows.length}개`);
      
      if (ratesResult.rows.length > 0) {
        console.log(`  - 날짜 범위: ${ratesResult.rows[0].stay_date} ~ ${ratesResult.rows[ratesResult.rows.length - 1].stay_date}`);
        console.log(`  - 첫 3개 날짜:`);
        ratesResult.rows.slice(0, 3).forEach(r => {
          console.log(`    ${r.stay_date}: $${r.rate_per_night} (최소 ${r.min_nights}박)`);
        });
      }
      
      // 모든 객실 타입의 요금 데이터 확인
      const allRatesResult = await pool.query(`
        SELECT 
          rt.room_type_name,
          COUNT(pdr.id) as rate_count
        FROM promotion_daily_rates pdr
        JOIN room_types rt ON pdr.room_type_id = rt.id
        WHERE pdr.promotion_id = $1
        GROUP BY rt.id, rt.room_type_name
      `, [promo.id]);
      
      if (allRatesResult.rows.length > 0) {
        console.log(`  - 전체 객실 타입별 요금 데이터:`);
        allRatesResult.rows.forEach(r => {
          console.log(`    ${r.room_type_name}: ${r.rate_count}개`);
        });
      }
      
      // 특정 날짜(2026-01-04 ~ 2026-01-06) 확인
      const specificDatesResult = await pool.query(`
        SELECT stay_date, rate_per_night, min_nights
        FROM promotion_daily_rates
        WHERE promotion_id = $1
          AND room_type_id = $2
          AND stay_date IN ('2026-01-04', '2026-01-05', '2026-01-06')
        ORDER BY stay_date
      `, [promo.id, roomTypeId]);
      
      console.log(`  - 2026-01-04 ~ 2026-01-06 요금 데이터: ${specificDatesResult.rows.length}개`);
      if (specificDatesResult.rows.length > 0) {
        specificDatesResult.rows.forEach(r => {
          console.log(`    ✅ ${r.stay_date}: $${r.rate_per_night} (최소 ${r.min_nights}박)`);
        });
      } else {
        console.log(`    ❌ 해당 날짜의 요금 데이터 없음!`);
      }
    }
    
    // 3. 객실 타입 4 정보 확인
    console.log('\n🚪 객실 타입 정보:');
    const roomTypeResult = await pool.query(`
      SELECT id, room_type_code, room_type_name, hotel_id
      FROM room_types
      WHERE id = $1
    `, [roomTypeId]);
    
    if (roomTypeResult.rows.length > 0) {
      const rt = roomTypeResult.rows[0];
      console.log(`  ID ${rt.id}: ${rt.room_type_code} (${rt.room_type_name}), 호텔 ID: ${rt.hotel_id}`);
    }
    
  } catch (error) {
    console.error('❌ 오류:', error.message);
  } finally {
    await pool.end();
  }
}

check();
