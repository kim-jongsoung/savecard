require('dotenv').config({ path: './railsql.env' });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('railway.app') ? { rejectUnauthorized: false } : false
});

async function check() {
  try {
    console.log('🔍 호텔 ID 1 확인...\n');
    
    const hotelResult = await pool.query('SELECT id, hotel_name FROM hotels WHERE id = 1');
    if (hotelResult.rows.length > 0) {
      console.log(`호텔 ID 1: ${hotelResult.rows[0].hotel_name}\n`);
    } else {
      console.log('❌ 호텔 ID 1이 없습니다!\n');
    }
    
    console.log('🎁 호텔 ID 1의 프로모션 확인...\n');
    
    const promoResult = await pool.query(`
      SELECT 
        id, promo_code, promo_name,
        booking_start_date, booking_end_date,
        stay_start_date, stay_end_date,
        is_active
      FROM promotions
      WHERE hotel_id = 1
      ORDER BY id DESC
    `);
    
    console.log(`프로모션 개수: ${promoResult.rows.length}개\n`);
    
    if (promoResult.rows.length === 0) {
      console.log('❌ 호텔 ID 1에 프로모션이 없습니다!');
      console.log('\n모든 호텔의 프로모션:');
      
      const allPromos = await pool.query(`
        SELECT h.hotel_name, p.promo_code, p.hotel_id
        FROM promotions p
        JOIN hotels h ON p.hotel_id = h.id
        WHERE is_active = true
      `);
      
      allPromos.rows.forEach(p => {
        console.log(`  - ${p.hotel_name} (ID: ${p.hotel_id}): ${p.promo_code}`);
      });
    } else {
      promoResult.rows.forEach(p => {
        console.log(`✅ [${p.promo_code}] ${p.promo_name}`);
        console.log(`   예약: ${p.booking_start_date} ~ ${p.booking_end_date}`);
        console.log(`   투숙: ${p.stay_start_date} ~ ${p.stay_end_date}`);
        console.log(`   활성: ${p.is_active ? 'YES' : 'NO'}\n`);
      });
      
      // 2026-01-05 ~ 2026-01-07 체크
      console.log('\n📅 2026-01-05 ~ 2026-01-07 예약 시 적용 가능한 프로모션:\n');
      
      const validPromos = await pool.query(`
        SELECT promo_code, promo_name
        FROM promotions
        WHERE hotel_id = 1
          AND is_active = true
          AND '2025-11-20'::date BETWEEN booking_start_date AND booking_end_date
          AND '2026-01-05'::date BETWEEN stay_start_date AND stay_end_date
          AND '2026-01-07'::date BETWEEN stay_start_date AND stay_end_date
      `);
      
      if (validPromos.rows.length > 0) {
        validPromos.rows.forEach(p => {
          console.log(`  ✅ ${p.promo_code}: ${p.promo_name}`);
        });
      } else {
        console.log('  ❌ 적용 가능한 프로모션 없음');
      }
    }
    
    // 객실 타입 4 확인
    console.log('\n🚪 객실 타입 ID 4 확인...\n');
    const roomTypeResult = await pool.query(`
      SELECT rt.id, rt.room_type_name, h.hotel_name
      FROM room_types rt
      JOIN hotels h ON rt.hotel_id = h.id
      WHERE rt.id = 4
    `);
    
    if (roomTypeResult.rows.length > 0) {
      const rt = roomTypeResult.rows[0];
      console.log(`객실 ID 4: ${rt.room_type_name} (호텔: ${rt.hotel_name})`);
    }
    
    // 프로모션 날짜별 요금 확인
    console.log('\n💰 프로모션 날짜별 요금 데이터 확인...\n');
    const ratesResult = await pool.query(`
      SELECT 
        p.promo_code,
        COUNT(pdr.id) as rate_count
      FROM promotions p
      LEFT JOIN promotion_daily_rates pdr ON p.id = pdr.promotion_id AND pdr.room_type_id = 4
      WHERE p.hotel_id = 1 AND p.is_active = true
      GROUP BY p.id, p.promo_code
    `);
    
    ratesResult.rows.forEach(r => {
      console.log(`  ${r.promo_code}: ${r.rate_count}개의 날짜별 요금 데이터`);
    });
    
  } catch (error) {
    console.error('❌ 오류:', error.message);
  } finally {
    await pool.end();
  }
}

check();
