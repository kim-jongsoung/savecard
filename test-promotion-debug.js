/**
 * 프로모션 조회 디버깅 스크립트
 * 
 * 실행: node test-promotion-debug.js
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function debugPromotions() {
  try {
    console.log('\n🔍 프로모션 시스템 진단 시작...\n');
    
    // 1. 프로모션 테이블 존재 확인
    console.log('📋 1. 프로모션 테이블 확인');
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name LIKE '%promo%'
      ORDER BY table_name
    `);
    console.log('   프로모션 관련 테이블:', tablesResult.rows.map(r => r.table_name));
    
    // 2. 프로모션 목록 조회
    console.log('\n📋 2. 등록된 프로모션 목록');
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
        p.is_active
      FROM promotions p
      LEFT JOIN hotels h ON p.hotel_id = h.id
      ORDER BY p.id
    `);
    
    if (promosResult.rows.length === 0) {
      console.log('   ❌ 등록된 프로모션이 없습니다!');
      console.log('\n💡 해결 방법: /admin/promotions 페이지에서 프로모션을 먼저 등록하세요.');
    } else {
      console.log(`   ✅ 총 ${promosResult.rows.length}개의 프로모션 발견`);
      promosResult.rows.forEach(p => {
        console.log(`\n   프로모션 ID: ${p.id}`);
        console.log(`   코드: ${p.promo_code}`);
        console.log(`   이름: ${p.promo_name}`);
        console.log(`   호텔: ${p.hotel_name}`);
        console.log(`   예약 기간: ${p.booking_start_date} ~ ${p.booking_end_date}`);
        console.log(`   투숙 기간: ${p.stay_start_date} ~ ${p.stay_end_date}`);
        console.log(`   활성 상태: ${p.is_active ? '✅ 활성' : '❌ 비활성'}`);
      });
    }
    
    // 3. 프로모션별 요금 데이터 확인
    console.log('\n📋 3. 프로모션 요금 데이터 확인 (promotion_daily_rates)');
    const ratesResult = await pool.query(`
      SELECT 
        pdr.id,
        pdr.promotion_id,
        p.promo_code,
        rt.room_type_name,
        pdr.stay_date,
        pdr.rate_per_night,
        pdr.min_nights,
        pdr.currency
      FROM promotion_daily_rates pdr
      JOIN promotions p ON pdr.promotion_id = p.id
      LEFT JOIN room_types rt ON pdr.room_type_id = rt.id
      ORDER BY pdr.promotion_id, pdr.stay_date
      LIMIT 20
    `);
    
    if (ratesResult.rows.length === 0) {
      console.log('   ❌ 등록된 프로모션 요금이 없습니다!');
      console.log('\n💡 해결 방법: 프로모션 등록 시 Step 2에서 날짜별 요금을 반드시 입력하세요.');
    } else {
      console.log(`   ✅ 총 ${ratesResult.rows.length}개의 요금 데이터 발견 (최대 20개 표시)`);
      
      // 프로모션별로 그룹화
      const grouped = {};
      ratesResult.rows.forEach(r => {
        if (!grouped[r.promotion_id]) {
          grouped[r.promotion_id] = {
            promo_code: r.promo_code,
            rates: []
          };
        }
        grouped[r.promotion_id].rates.push(r);
      });
      
      Object.entries(grouped).forEach(([promoId, data]) => {
        console.log(`\n   [${data.promo_code}] (ID: ${promoId})`);
        data.rates.forEach(r => {
          console.log(`     - ${r.stay_date}: ${r.room_type_name} = ${r.currency} ${r.rate_per_night}`);
        });
      });
    }
    
    // 4. 룸타입 테이블 확인
    console.log('\n📋 4. 룸타입 테이블 확인');
    const roomTypesResult = await pool.query(`
      SELECT 
        rt.id,
        rt.room_type_name,
        h.hotel_name,
        rt.is_active
      FROM room_types rt
      LEFT JOIN hotels h ON rt.hotel_id = h.id
      WHERE rt.is_active = true
      ORDER BY h.hotel_name, rt.room_type_name
    `);
    
    console.log(`   ✅ 총 ${roomTypesResult.rows.length}개의 활성 룸타입`);
    roomTypesResult.rows.forEach(rt => {
      console.log(`     - [ID: ${rt.id}] ${rt.hotel_name} - ${rt.room_type_name}`);
    });
    
    // 5. 테스트: 특정 룸타입으로 프로모션 조회
    if (roomTypesResult.rows.length > 0 && promosResult.rows.length > 0) {
      console.log('\n📋 5. 프로모션 조회 테스트');
      const testRoomType = roomTypesResult.rows[0];
      const testCheckIn = new Date().toISOString().split('T')[0];
      const testCheckOut = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      console.log(`   테스트 조건:`);
      console.log(`   - 룸타입: ${testRoomType.room_type_name} (ID: ${testRoomType.id})`);
      console.log(`   - 체크인: ${testCheckIn}`);
      console.log(`   - 체크아웃: ${testCheckOut}`);
      
      // 날짜 배열 생성
      const dates = [];
      const start = new Date(testCheckIn);
      const end = new Date(testCheckOut);
      for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
        dates.push(d.toISOString().split('T')[0]);
      }
      
      const testQuery = `
        SELECT DISTINCT
          p.id as promotion_id,
          p.promo_code,
          p.promo_name,
          p.description
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
      `;
      
      const testResult = await pool.query(testQuery, [testCheckIn, testCheckOut, testRoomType.id, dates]);
      
      console.log(`\n   결과: ${testResult.rows.length}개의 프로모션 조회됨`);
      if (testResult.rows.length === 0) {
        console.log('   ❌ 조회된 프로모션이 없습니다!');
        console.log('\n   💡 가능한 원인:');
        console.log('      1. 프로모션의 예약 기간(booking_start_date ~ booking_end_date)이 오늘 날짜를 포함하지 않음');
        console.log('      2. 프로모션의 투숙 기간(stay_start_date ~ stay_end_date)이 테스트 날짜를 포함하지 않음');
        console.log('      3. 해당 룸타입에 대한 요금이 promotion_daily_rates에 등록되지 않음');
        console.log('      4. 프로모션이 비활성(is_active = false) 상태');
      } else {
        testResult.rows.forEach(p => {
          console.log(`   ✅ ${p.promo_code} - ${p.promo_name}`);
        });
      }
    }
    
    console.log('\n✅ 진단 완료\n');
    
  } catch (error) {
    console.error('❌ 오류 발생:', error.message);
    console.error(error);
  } finally {
    await pool.end();
  }
}

debugPromotions();
