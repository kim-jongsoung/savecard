/**
 * 인박스 프로모션 조회 테스트
 * 
 * 실행: node test-inbox-promotion.js
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function testInboxPromotion() {
  try {
    console.log('\n🔍 인박스 프로모션 조회 테스트 시작...\n');
    
    // 1. 활성 프로모션 목록 확인
    console.log('📋 1. 활성 프로모션 확인');
    const promosResult = await pool.query(`
      SELECT 
        p.id,
        p.promo_code,
        p.promo_name,
        h.hotel_name,
        p.booking_start_date,
        p.booking_end_date,
        p.stay_start_date,
        p.stay_end_date,
        p.is_active,
        COUNT(DISTINCT pdr.id) as rate_count
      FROM promotions p
      JOIN hotels h ON p.hotel_id = h.id
      LEFT JOIN promotion_daily_rates pdr ON p.id = pdr.promotion_id
      WHERE p.is_active = true
      GROUP BY p.id, h.hotel_name
      ORDER BY p.id
    `);
    
    if (promosResult.rows.length === 0) {
      console.log('   ❌ 활성 프로모션이 없습니다!');
      console.log('   💡 /admin/promotions에서 프로모션을 먼저 등록하고 활성화하세요.');
      await pool.end();
      return;
    }
    
    console.log(`   ✅ 활성 프로모션: ${promosResult.rows.length}개`);
    promosResult.rows.forEach(p => {
      console.log(`\n   [${p.promo_code}] ${p.promo_name}`);
      console.log(`   - 호텔: ${p.hotel_name}`);
      console.log(`   - 예약 기간: ${p.booking_start_date.toISOString().split('T')[0]} ~ ${p.booking_end_date.toISOString().split('T')[0]}`);
      console.log(`   - 투숙 기간: ${p.stay_start_date.toISOString().split('T')[0]} ~ ${p.stay_end_date.toISOString().split('T')[0]}`);
      console.log(`   - 등록된 요금: ${p.rate_count}개`);
      
      const today = new Date().toISOString().split('T')[0];
      const bookingValid = p.booking_start_date <= new Date() && p.booking_end_date >= new Date();
      console.log(`   - 예약 기간 유효 (오늘 ${today}): ${bookingValid ? '✅' : '❌'}`);
    });
    
    // 2. 활성 룸타입 목록
    console.log('\n\n📋 2. 활성 룸타입 확인');
    const roomTypesResult = await pool.query(`
      SELECT 
        rt.id,
        rt.room_type_name,
        h.hotel_name,
        h.id as hotel_id
      FROM room_types rt
      JOIN hotels h ON rt.hotel_id = h.id
      WHERE rt.is_active = true
      ORDER BY h.hotel_name, rt.room_type_name
    `);
    
    console.log(`   ✅ 활성 룸타입: ${roomTypesResult.rows.length}개`);
    roomTypesResult.rows.forEach(rt => {
      console.log(`   - [ID: ${rt.id}] ${rt.hotel_name} - ${rt.room_type_name}`);
    });
    
    // 3. 프로모션별 룸타입 및 날짜 매핑 확인
    console.log('\n\n📋 3. 프로모션 요금 데이터 상세');
    for (const promo of promosResult.rows) {
      const ratesDetail = await pool.query(`
        SELECT 
          pdr.room_type_id,
          rt.room_type_name,
          MIN(pdr.stay_date) as first_date,
          MAX(pdr.stay_date) as last_date,
          COUNT(*) as date_count,
          MIN(pdr.rate_per_night) as min_rate,
          MAX(pdr.rate_per_night) as max_rate
        FROM promotion_daily_rates pdr
        JOIN room_types rt ON pdr.room_type_id = rt.id
        WHERE pdr.promotion_id = $1
        GROUP BY pdr.room_type_id, rt.room_type_name
        ORDER BY rt.room_type_name
      `, [promo.id]);
      
      console.log(`\n   [${promo.promo_code}]`);
      if (ratesDetail.rows.length === 0) {
        console.log(`   ❌ 요금 데이터가 없습니다!`);
        console.log(`   💡 프로모션 수정 → Step 2에서 요금을 등록하세요.`);
      } else {
        ratesDetail.rows.forEach(r => {
          console.log(`   - ${r.room_type_name} (ID: ${r.room_type_id})`);
          console.log(`     요금 날짜: ${r.first_date.toISOString().split('T')[0]} ~ ${r.last_date.toISOString().split('T')[0]}`);
          console.log(`     등록 일수: ${r.date_count}일`);
          console.log(`     요금 범위: $${r.min_rate} ~ $${r.max_rate}`);
        });
      }
    }
    
    // 4. 실제 API 시뮬레이션 테스트
    console.log('\n\n📋 4. API 시뮬레이션 테스트');
    if (roomTypesResult.rows.length > 0 && promosResult.rows.length > 0) {
      const testRoomType = roomTypesResult.rows[0];
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dayAfter = new Date(today);
      dayAfter.setDate(dayAfter.getDate() + 3);
      
      const checkIn = tomorrow.toISOString().split('T')[0];
      const checkOut = dayAfter.toISOString().split('T')[0];
      
      console.log(`\n   테스트 조건:`);
      console.log(`   - 룸타입: ${testRoomType.room_type_name} (ID: ${testRoomType.id})`);
      console.log(`   - 체크인: ${checkIn}`);
      console.log(`   - 체크아웃: ${checkOut}`);
      
      // 날짜 배열 생성
      const dates = [];
      const start = new Date(checkIn);
      const end = new Date(checkOut);
      
      for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
        dates.push(d.toISOString().split('T')[0]);
      }
      
      console.log(`   - 투숙 날짜: ${dates.join(', ')} (${dates.length}박)`);
      
      // 실제 API 쿼리 실행
      const apiQuery = `
        SELECT DISTINCT
          p.id as promotion_id,
          p.promo_code,
          p.promo_name,
          p.description,
          p.booking_start_date,
          p.booking_end_date,
          p.stay_start_date,
          p.stay_end_date
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
      
      const apiResult = await pool.query(apiQuery, [checkIn, checkOut, testRoomType.id, dates]);
      
      console.log(`\n   결과: ${apiResult.rows.length}개의 프로모션 조회됨`);
      
      if (apiResult.rows.length === 0) {
        console.log(`\n   ❌ 조회된 프로모션이 없습니다!`);
        console.log(`\n   💡 가능한 원인:`);
        console.log(`   1. 프로모션의 예약 기간(booking_start_date ~ booking_end_date)이 오늘을 포함하지 않음`);
        console.log(`   2. 프로모션의 투숙 기간(stay_start_date ~ stay_end_date)이 테스트 날짜를 포함하지 않음`);
        console.log(`   3. 해당 룸타입(${testRoomType.room_type_name})에 대한 요금이 등록되지 않음`);
        console.log(`   4. 테스트 날짜(${dates.join(', ')})에 요금이 등록되지 않음`);
        
        // 디버깅: 각 조건별로 확인
        console.log(`\n   🔍 상세 진단:`);
        
        for (const promo of promosResult.rows) {
          console.log(`\n   [${promo.promo_code}]`);
          
          const bookingValid = promo.booking_start_date <= new Date() && promo.booking_end_date >= new Date();
          console.log(`   - 예약 기간 체크: ${bookingValid ? '✅' : '❌'}`);
          
          const stayValid = new Date(promo.stay_start_date) <= new Date(checkIn) && 
                           new Date(promo.stay_end_date) >= new Date(checkOut);
          console.log(`   - 투숙 기간 체크: ${stayValid ? '✅' : '❌'}`);
          
          const ratesCheck = await pool.query(`
            SELECT COUNT(*) as cnt
            FROM promotion_daily_rates
            WHERE promotion_id = $1
              AND room_type_id = $2
              AND stay_date = ANY($3::date[])
          `, [promo.id, testRoomType.id, dates]);
          
          const hasAllDates = parseInt(ratesCheck.rows[0].cnt) === dates.length;
          console.log(`   - 요금 데이터 체크: ${hasAllDates ? '✅' : '❌'} (${ratesCheck.rows[0].cnt}/${dates.length}일)`);
        }
        
      } else {
        console.log(`\n   ✅ 조회 성공!`);
        for (const promo of apiResult.rows) {
          const ratesQuery = `
            SELECT 
              stay_date,
              rate_per_night
            FROM promotion_daily_rates
            WHERE promotion_id = $1
              AND room_type_id = $2
              AND stay_date = ANY($3::date[])
            ORDER BY stay_date
          `;
          
          const ratesResult = await pool.query(ratesQuery, [promo.promotion_id, testRoomType.id, dates]);
          const totalAmount = ratesResult.rows.reduce((sum, r) => sum + parseFloat(r.rate_per_night), 0);
          const avgRate = Math.round(totalAmount / dates.length);
          
          console.log(`\n   [${promo.promo_code}] ${promo.promo_name}`);
          console.log(`   - 총액: $${Math.round(totalAmount)}`);
          console.log(`   - 평균: $${avgRate}/박`);
          console.log(`   - 일별 요금:`);
          ratesResult.rows.forEach(r => {
            console.log(`     ${r.stay_date.toISOString().split('T')[0]}: $${r.rate_per_night}`);
          });
        }
      }
    }
    
    console.log('\n✅ 테스트 완료\n');
    
  } catch (error) {
    console.error('\n❌ 오류 발생:', error.message);
    console.error(error);
  } finally {
    await pool.end();
  }
}

testInboxPromotion();
