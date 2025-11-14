/**
 * Migration 007 샘플 데이터 생성
 * 
 * 테스트용 시즌, 요금, 프로모션, 수배피 데이터 생성
 */

require('dotenv').config({ path: './railsql.env' });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('railway.app') ? { rejectUnauthorized: false } : false
});

async function seed() {
  const client = await pool.connect();
  
  try {
    console.log('🌱 샘플 데이터 생성 시작...\n');
    
    // 호텔과 객실 타입 조회
    const hotelsResult = await client.query(`
      SELECT id, hotel_name FROM hotels WHERE is_active = true LIMIT 1
    `);
    
    if (hotelsResult.rows.length === 0) {
      console.log('⚠️  활성화된 호텔이 없습니다. 먼저 호텔을 등록해주세요.');
      return;
    }
    
    const hotel = hotelsResult.rows[0];
    console.log(`📍 호텔: ${hotel.hotel_name} (ID: ${hotel.id})\n`);
    
    const roomTypesResult = await client.query(`
      SELECT id, room_type_code, room_type_name 
      FROM room_types 
      WHERE hotel_id = $1 AND is_active = true
    `, [hotel.id]);
    
    if (roomTypesResult.rows.length === 0) {
      console.log('⚠️  해당 호텔에 객실 타입이 없습니다.');
      return;
    }
    
    const roomTypes = roomTypesResult.rows;
    console.log(`🚪 객실 타입: ${roomTypes.length}개 발견\n`);
    
    // 거래처 조회
    const agenciesResult = await client.query(`
      SELECT id, agency_name FROM booking_agencies WHERE is_active = true LIMIT 3
    `);
    
    const agencies = agenciesResult.rows;
    console.log(`🏢 거래처: ${agencies.length}개 발견\n`);
    
    await client.query('BEGIN');
    
    // ==========================================
    // 1. 시즌 생성
    // ==========================================
    console.log('📅 1/4: 시즌 데이터 생성 중...');
    
    // 큰 시즌 (2025년 11월~12월 전체)
    const mainSeasonResult = await client.query(`
      INSERT INTO seasons (
        hotel_id, season_name, season_code, 
        start_date, end_date, priority, description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `, [
      hotel.id, 
      '2025 겨울 시즌', 
      'WINTER2025',
      '2025-11-01',
      '2025-12-31',
      1,
      '2025년 11월~12월 겨울 시즌'
    ]);
    
    const mainSeasonId = mainSeasonResult.rows[0].id;
    console.log(`  ✓ 메인 시즌 생성 (ID: ${mainSeasonId})`);
    
    // 작은 시즌 (크리스마스 특별)
    const xmasSeasonResult = await client.query(`
      INSERT INTO seasons (
        hotel_id, season_name, season_code, 
        start_date, end_date, priority, description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `, [
      hotel.id,
      '크리스마스 특별',
      'XMAS2025',
      '2025-12-20',
      '2025-12-26',
      10,  // 높은 우선순위
      '크리스마스 기간 특별 시즌 (메인 시즌 내 중첩)'
    ]);
    
    const xmasSeasonId = xmasSeasonResult.rows[0].id;
    console.log(`  ✓ 크리스마스 시즌 생성 (ID: ${xmasSeasonId})`);
    console.log('✅ 시즌 데이터 생성 완료\n');
    
    // ==========================================
    // 2. 호텔 요금 생성
    // ==========================================
    console.log('💰 2/4: 호텔 요금 데이터 생성 중...');
    
    for (const roomType of roomTypes) {
      // 기본 요금
      await client.query(`
        INSERT INTO hotel_rates (
          hotel_id, room_type_id, season_id, rate_type, rate_per_night, description
        ) VALUES ($1, $2, NULL, 'base', $3, $4)
      `, [
        hotel.id,
        roomType.id,
        150.00,
        `${roomType.room_type_name} 기본 요금`
      ]);
      
      // 겨울 시즌 요금
      await client.query(`
        INSERT INTO hotel_rates (
          hotel_id, room_type_id, season_id, rate_type, rate_per_night, description
        ) VALUES ($1, $2, $3, 'season', $4, $5)
      `, [
        hotel.id,
        roomType.id,
        mainSeasonId,
        180.00,
        `${roomType.room_type_name} 겨울 시즌 요금`
      ]);
      
      // 크리스마스 시즌 요금
      await client.query(`
        INSERT INTO hotel_rates (
          hotel_id, room_type_id, season_id, rate_type, rate_per_night, description
        ) VALUES ($1, $2, $3, 'season', $4, $5)
      `, [
        hotel.id,
        roomType.id,
        xmasSeasonId,
        250.00,
        `${roomType.room_type_name} 크리스마스 특별 요금`
      ]);
      
      console.log(`  ✓ ${roomType.room_type_code} 요금 생성 (기본/겨울/크리스마스)`);
    }
    
    console.log('✅ 호텔 요금 데이터 생성 완료\n');
    
    // ==========================================
    // 3. 프로모션 생성
    // ==========================================
    console.log('🎁 3/4: 프로모션 데이터 생성 중...');
    
    const promoResult = await client.query(`
      INSERT INTO promotions (
        hotel_id, promo_code, promo_name,
        booking_start_date, booking_end_date,
        stay_start_date, stay_end_date,
        discount_type, min_nights, description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id
    `, [
      hotel.id,
      'EARLYWINTER2025',
      '조기예약 겨울 특별 프로모션',
      '2025-11-14',  // 예약 생성 가능 기간 시작
      '2025-12-31',  // 예약 생성 가능 기간 종료
      '2026-01-10',  // 투숙 가능 기간 시작
      '2026-02-28',  // 투숙 가능 기간 종료
      'amount',
      2,
      '조기예약시 1박당 $30 할인! 2박 이상 예약시 적용'
    ]);
    
    const promoId = promoResult.rows[0].id;
    console.log(`  ✓ 프로모션 생성 (ID: ${promoId}, 코드: EARLYWINTER2025)`);
    
    // 프로모션 객실 할인
    for (const roomType of roomTypes) {
      await client.query(`
        INSERT INTO promotion_room_discounts (
          promotion_id, room_type_id, discount_value, description
        ) VALUES ($1, $2, $3, $4)
      `, [
        promoId,
        roomType.id,
        30.00,
        `${roomType.room_type_name} - 1박당 $30 할인`
      ]);
      console.log(`  ✓ ${roomType.room_type_code} 할인 설정 ($30/박)`);
    }
    
    // 프로모션 베네핏
    await client.query(`
      INSERT INTO promotion_benefits (
        promotion_id, benefit_type, benefit_name, benefit_value, quantity
      ) VALUES 
        ($1, 'drink_coupon', '웰컴 드링크 쿠폰', '2잔', 2),
        ($1, 'late_checkout', '무료 레이트 체크아웃', '14:00까지', 1),
        ($1, 'breakfast', '조식 1회 무료', '뷔페식 조식', 1)
    `, [promoId]);
    
    console.log(`  ✓ 베네핏 3개 추가 (웰컴드링크, 레이트체크아웃, 조식)`);
    console.log('✅ 프로모션 데이터 생성 완료\n');
    
    // ==========================================
    // 4. 거래처 수배피 생성
    // ==========================================
    console.log('💵 4/4: 거래처 수배피 데이터 생성 중...');
    
    if (agencies.length > 0) {
      // 업체 A: 1박당 $10 무제한
      await client.query(`
        INSERT INTO agency_procurement_fees (
          agency_id, hotel_id, fee_name, fee_type, fee_per_night, description
        ) VALUES ($1, NULL, $2, $3, $4, $5)
      `, [
        agencies[0].id,
        '기본 수배피',
        'per_night',
        10.00,
        '1박당 $10 무제한 (모든 호텔 적용)'
      ]);
      console.log(`  ✓ ${agencies[0].agency_name}: 1박당 $10 무제한`);
      
      if (agencies.length > 1) {
        // 업체 B: 3박까지 1박당 $10, 4박 이상 $30 고정
        await client.query(`
          INSERT INTO agency_procurement_fees (
            agency_id, hotel_id, fee_name, fee_type, 
            fee_per_night, max_nights_for_fee, flat_fee_amount, description
          ) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7)
        `, [
          agencies[1].id,
          '3박 이상 정액제',
          'flat',
          10.00,
          3,
          30.00,
          '3박까지 1박당 $10, 4박 이상 $30 고정'
        ]);
        console.log(`  ✓ ${agencies[1].agency_name}: 3박까지 $10/박, 4박+ $30 고정`);
      }
      
      if (agencies.length > 2) {
        // 업체 C: 시즌별 수배피 (성수기)
        await client.query(`
          INSERT INTO agency_procurement_fees (
            agency_id, hotel_id, fee_name, fee_type, 
            fee_per_night, effective_date, expiry_date, description
          ) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7)
        `, [
          agencies[2].id,
          '성수기 수배피',
          'per_night',
          15.00,
          '2025-12-15',
          '2026-01-10',
          '성수기 1박당 $15'
        ]);
        
        // 업체 C: 비수기 수배피
        await client.query(`
          INSERT INTO agency_procurement_fees (
            agency_id, hotel_id, fee_name, fee_type, 
            fee_per_night, effective_date, expiry_date, description
          ) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7)
        `, [
          agencies[2].id,
          '비수기 수배피',
          'per_night',
          10.00,
          '2025-01-11',
          '2025-12-14',
          '비수기 1박당 $10'
        ]);
        
        console.log(`  ✓ ${agencies[2].agency_name}: 시즌별 수배피 (성수기 $15, 비수기 $10)`);
      }
    }
    
    console.log('✅ 거래처 수배피 데이터 생성 완료\n');
    
    await client.query('COMMIT');
    
    console.log('✨ 샘플 데이터 생성 완료!\n');
    console.log('📊 생성된 데이터 요약:');
    console.log(`  - 시즌: 2개 (겨울, 크리스마스)`);
    console.log(`  - 호텔 요금: ${roomTypes.length * 3}개 (객실타입별 기본/겨울/크리스마스)`);
    console.log(`  - 프로모션: 1개 (조기예약 겨울 특별)`);
    console.log(`  - 프로모션 할인: ${roomTypes.length}개`);
    console.log(`  - 프로모션 베네핏: 3개`);
    console.log(`  - 거래처 수배피: ${Math.min(agencies.length * 2, 5)}개\n`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ 샘플 데이터 생성 실패:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// 실행
if (require.main === module) {
  seed()
    .then(() => {
      console.log('🎊 샘플 데이터 생성이 완료되었습니다!');
      process.exit(0);
    })
    .catch(error => {
      console.error('💥 샘플 데이터 생성 중 오류:', error.message);
      process.exit(1);
    });
}

module.exports = { seed };
