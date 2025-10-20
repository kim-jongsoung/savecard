const express = require('express');
const router = express.Router();

// 비행편 데이터 (DB에서 로드하도록 변경)
let FLIGHTS_CACHE = {};
let FLIGHTS_LAST_LOAD = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5분

// DB에서 항공편 로드
async function loadFlightsFromDB(pool) {
  try {
    const result = await pool.query(
      `SELECT flight_number, departure_time, arrival_time, flight_hours, 
              departure_airport, arrival_airport
       FROM pickup_flights 
       WHERE is_active = true`
    );
    
    const flights = {};
    result.rows.forEach(f => {
      flights[f.flight_number] = {
        time: f.departure_time?.substring(0, 5) || '00:00',
        arrival_time: f.arrival_time?.substring(0, 5) || '00:00',
        hours: parseFloat(f.flight_hours) || 4,
        departure_airport: f.departure_airport || '',
        arrival_airport: f.arrival_airport || ''
      };
    });
    
    FLIGHTS_CACHE = flights;
    FLIGHTS_LAST_LOAD = Date.now();
    return flights;
  } catch (error) {
    console.error('❌ 항공편 로드 실패:', error);
    // 실패 시 기본값 사용
    return {
      'KE111': { time: '07:30', arrival_time: '12:30', hours: 4, departure_airport: 'ICN', arrival_airport: 'GUM' },
      'KE123': { time: '22:00', arrival_time: '03:00', hours: 4, departure_airport: 'ICN', arrival_airport: 'GUM' },
      'KE124': { time: '03:30', arrival_time: '06:30', hours: 4, departure_airport: 'GUM', arrival_airport: 'ICN' },
      'OZ456': { time: '10:00', arrival_time: '15:00', hours: 4, departure_airport: 'ICN', arrival_airport: 'GUM' },
      'OZ789': { time: '15:30', arrival_time: '20:30', hours: 4, departure_airport: 'ICN', arrival_airport: 'GUM' },
      'UA873': { time: '13:20', arrival_time: '18:20', hours: 4, departure_airport: 'ICN', arrival_airport: 'GUM' }
    };
  }
}

// 캐시된 항공편 가져오기
async function getFlights(pool) {
  if (Date.now() - FLIGHTS_LAST_LOAD > CACHE_DURATION) {
    return await loadFlightsFromDB(pool);
  }
  return FLIGHTS_CACHE;
}

// 날짜/시간 계산 헬퍼 - 비행시간 사용하여 도착일시 계산
function calculateArrival(krDate, krTime, flightNum, flightData) {
  const flight = flightData[flightNum];
  if (!flight) return null;
  
  // 출발일시 + 비행시간으로 도착일시 계산
  const krDateTime = new Date(`${krDate}T${krTime}:00+09:00`);
  const guamDateTime = new Date(krDateTime);
  
  // 비행시간을 더하고 시차 반영 (+1시간)
  guamDateTime.setHours(guamDateTime.getHours() + flight.hours + 1);
  
  return {
    date: guamDateTime.toISOString().split('T')[0],
    time: guamDateTime.toTimeString().slice(0, 5)
  };
}

function calculateHotelPickup(guamDate, guamTime) {
  const flightDateTime = new Date(`${guamDate}T${guamTime}:00+10:00`);
  const hour = flightDateTime.getHours();
  
  // 새벽 비행기 (00:00-05:59) → 전날 23:59
  if (hour >= 0 && hour < 6) {
    const prevDay = new Date(flightDateTime);
    prevDay.setDate(prevDay.getDate() - 1);
    prevDay.setHours(23, 59, 0);
    return {
      date: prevDay.toISOString().split('T')[0],
      time: '23:59',
      isEarlyMorning: true
    };
  }
  
  // 정상 비행기 → 3시간 전
  const pickupDateTime = new Date(flightDateTime);
  pickupDateTime.setHours(pickupDateTime.getHours() - 3);
  return {
    date: pickupDateTime.toISOString().split('T')[0],
    time: pickupDateTime.toTimeString().slice(0, 5),
    isEarlyMorning: false
  };
}

// API: 픽업 생성 (항상 2개 레코드: 출발 파란색 + 도착 빨간색)
router.post('/api/create', async (req, res) => {
  const pool = req.app.locals.pool;
  const { 
    pickup_type, agency_id, 
    flight_date, flight_number,
    customer_name, passenger_count, hotel_name,
    phone, kakao_id, memo,
    adult_count, child_count, infant_count, luggage_count
  } = req.body;
  
  try {
    const FLIGHTS = await getFlights(pool);
    const flight = FLIGHTS[flight_number];
    
    if (!flight) {
      return res.status(400).json({ error: '비행편 정보를 찾을 수 없습니다' });
    }
    
    const baseData = {
      pickup_type, agency_id,
      customer_name, hotel_name,
      phone, kakao_id, memo,
      adult_count: adult_count || 0,
      child_count: child_count || 0,
      infant_count: infant_count || 0,
      luggage_count: luggage_count || 0,
      passenger_count: (adult_count || 0) + (child_count || 0) + (infant_count || 0),
      flight_number
    };
    
    // 도착일시 계산 (비행시간 기반)
    const isToGuam = flight.arrival_airport === 'GUM';
    const depTZ = isToGuam ? '+09:00' : '+10:00'; // 출발지 시간대
    const arrTZ = isToGuam ? 10 : 9; // 도착지 UTC 오프셋
    
    const depDateTime = new Date(`${flight_date}T${flight.time}:00${depTZ}`);
    const arrMillis = depDateTime.getTime() + (flight.hours * 3600000);
    const arrDateTime = new Date(arrMillis);
    
    // UTC 시간 추출
    const utcHours = arrDateTime.getUTCHours();
    const utcMinutes = arrDateTime.getUTCMinutes();
    const utcDate = arrDateTime.getUTCDate();
    const utcMonth = arrDateTime.getUTCMonth();
    const utcYear = arrDateTime.getUTCFullYear();
    
    // 도착지 시간 계산
    let arrHours = utcHours + arrTZ;
    let arrDateObj = new Date(Date.UTC(utcYear, utcMonth, utcDate));
    
    if (arrHours >= 24) {
      arrHours -= 24;
      arrDateObj.setUTCDate(arrDateObj.getUTCDate() + 1);
    }
    
    const arrivalDate = arrDateObj.toISOString().split('T')[0];
    const arrivalTime = String(arrHours).padStart(2, '0') + ':' + String(utcMinutes).padStart(2, '0');
    
    const createdRecords = [];
    
    // 1. 출발 레코드 (파란색)
    const departureData = {
      ...baseData,
      departure_date: flight_date,
      departure_time: flight.time,
      departure_airport: flight.departure_airport,
      arrival_date: arrivalDate,
      arrival_time: arrivalTime,
      arrival_airport: flight.arrival_airport,
      record_type: 'departure',
      display_date: flight_date,
      display_time: flight.time
    };
    
    const depColumns = Object.keys(departureData).join(', ');
    const depValues = Object.values(departureData);
    const depPlaceholders = depValues.map((_, i) => `$${i + 1}`).join(', ');
    
    const depResult = await pool.query(
      `INSERT INTO airport_pickups (${depColumns}) VALUES (${depPlaceholders}) RETURNING *`,
      depValues
    );
    
    // 2. 도착 레코드 (빨간색)
    const arrivalData = {
      ...baseData,
      departure_date: flight_date,
      departure_time: flight.time,
      departure_airport: flight.departure_airport,
      arrival_date: arrivalDate,
      arrival_time: arrivalTime,
      arrival_airport: flight.arrival_airport,
      record_type: 'arrival',
      display_date: arrivalDate,
      display_time: flight.arrival_time, // 실제 항공편 도착시간 표시 (날짜만 시간대 반영)
      linked_id: depResult.rows[0].id
    };
    
    const arrColumns = Object.keys(arrivalData).join(', ');
    const arrValues = Object.values(arrivalData);
    const arrPlaceholders = arrValues.map((_, i) => `$${i + 1}`).join(', ');
    
    const arrResult = await pool.query(
      `INSERT INTO airport_pickups (${arrColumns}) VALUES (${arrPlaceholders}) RETURNING *`,
      arrValues
    );
    
    // 출발 레코드에 linked_id 업데이트
    await pool.query(
      `UPDATE airport_pickups SET linked_id = $1 WHERE id = $2`,
      [arrResult.rows[0].id, depResult.rows[0].id]
    );
    
    createdRecords.push(depResult.rows[0], arrResult.rows[0]);
    
    res.json({ success: true, data: createdRecords });
  } catch (error) {
    console.error('❌ 픽업 등록 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 날짜별 픽업 조회 (기사용)
router.get('/api/list', async (req, res) => {
  const pool = req.app.locals.pool;
  const { date } = req.query;
  
  try {
    // 공항 픽업 (공항→호텔)
    const arrivals = await pool.query(`
      SELECT p.*, a.agency_name 
      FROM airport_pickups p
      LEFT JOIN pickup_agencies a ON p.agency_id = a.id
      WHERE p.guam_arrival_date = $1 
        AND p.pickup_type IN ('airport_to_hotel', 'roundtrip')
        AND p.status = 'active'
      ORDER BY p.guam_arrival_time
    `, [date]);
    
    // 호텔 픽업 (호텔→공항)
    const departures = await pool.query(`
      SELECT p.*, a.agency_name 
      FROM airport_pickups p
      LEFT JOIN pickup_agencies a ON p.agency_id = a.id
      WHERE p.hotel_pickup_date = $1 
        AND p.pickup_type IN ('hotel_to_airport', 'roundtrip')
        AND p.status = 'active'
      ORDER BY p.hotel_pickup_time
    `, [date]);
    
    res.json({
      arrivals: arrivals.rows,
      departures: departures.rows
    });
  } catch (error) {
    console.error('❌ 픽업 조회 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 차량 배정
router.put('/api/:id/vehicle', async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  const { vehicle_type, vehicle_ready } = req.body;
  
  try {
    const result = await pool.query(
      `UPDATE airport_pickups 
       SET vehicle_type = $1, vehicle_ready = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [vehicle_type, vehicle_ready, id]
    );
    
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('❌ 차량 배정 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 예약 수정 (날짜/편명 변경 시 재생성)
router.put('/api/:id', async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  const { 
    customer_name, hotel_name, phone, kakao_id, memo,
    adult_count, child_count, infant_count, luggage_count,
    agency_id, pickup_type, flight_date, flight_number
  } = req.body;
  
  try {
    const passenger_count = (adult_count || 0) + (child_count || 0) + (infant_count || 0);
    
    // 1. 기존 레코드 조회
    const oldRecord = await pool.query(
      `SELECT * FROM airport_pickups WHERE id = $1`,
      [id]
    );
    
    if (oldRecord.rows.length === 0) {
      return res.status(404).json({ error: '예약을 찾을 수 없습니다' });
    }
    
    const old = oldRecord.rows[0];
    const linkedId = old.linked_id;
    
    // 2. 날짜나 편명이 변경되었는지 확인
    const dateChanged = flight_date && flight_date !== old.departure_date;
    const flightChanged = flight_number && flight_number !== old.flight_number;
    
    if (dateChanged || flightChanged) {
      // 날짜/편명 변경 → 기존 레코드 삭제 후 재생성
      console.log('📅 날짜/편명 변경 감지 - 레코드 재생성');
      
      // 기존 레코드 삭제
      await pool.query(
        `UPDATE airport_pickups SET status = 'cancelled' WHERE id = $1 OR id = $2`,
        [id, linkedId]
      );
      
      // 새로운 레코드 생성 (기존 create 로직 재사용)
      const flights = await getFlights(pool);
      const flight = flights[flight_number];
      if (!flight) {
        return res.status(400).json({ error: '유효하지 않은 편명입니다' });
      }
      
      // 도착일시 계산
      const isToGuam = flight.arrival_airport === 'GUM';
      const depTZ = isToGuam ? '+09:00' : '+10:00';
      const arrTZ = isToGuam ? 10 : 9;
      
      const depDateTime = new Date(`${flight_date}T${flight.time}:00${depTZ}`);
      const arrMillis = depDateTime.getTime() + (flight.hours * 3600000);
      const arrDateTime = new Date(arrMillis);
      
      const utcHours = arrDateTime.getUTCHours();
      const utcMinutes = arrDateTime.getUTCMinutes();
      const utcDate = arrDateTime.getUTCDate();
      const utcMonth = arrDateTime.getUTCMonth();
      const utcYear = arrDateTime.getUTCFullYear();
      
      let arrHours = utcHours + arrTZ;
      let arrDateObj = new Date(Date.UTC(utcYear, utcMonth, utcDate));
      
      if (arrHours >= 24) {
        arrHours -= 24;
        arrDateObj.setUTCDate(arrDateObj.getUTCDate() + 1);
      }
      
      const arrivalDate = arrDateObj.toISOString().split('T')[0];
      const arrivalTime = String(arrHours).padStart(2, '0') + ':' + String(utcMinutes).padStart(2, '0');
      
      // 1. 출발 레코드 생성
      const depResult = await pool.query(
        `INSERT INTO airport_pickups (
          pickup_type, departure_date, departure_time, departure_airport,
          arrival_date, arrival_time, arrival_airport, flight_number,
          display_date, display_time, record_type,
          customer_name, hotel_name, phone, kakao_id, memo,
          adult_count, child_count, infant_count, luggage_count, passenger_count, agency_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
        RETURNING id`,
        [
          pickup_type, flight_date, flight.time, flight.departure_airport,
          arrivalDate, arrivalTime, flight.arrival_airport, flight_number,
          flight_date, flight.time, 'departure',
          customer_name, hotel_name, phone, kakao_id, memo,
          adult_count, child_count, infant_count, luggage_count, passenger_count, agency_id
        ]
      );
      
      // 2. 도착 레코드 생성
      const arrResult = await pool.query(
        `INSERT INTO airport_pickups (
          pickup_type, departure_date, departure_time, departure_airport,
          arrival_date, arrival_time, arrival_airport, flight_number,
          display_date, display_time, record_type,
          customer_name, hotel_name, phone, kakao_id, memo,
          adult_count, child_count, infant_count, luggage_count, passenger_count, agency_id, linked_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
        RETURNING id`,
        [
          pickup_type, flight_date, flight.time, flight.departure_airport,
          arrivalDate, arrivalTime, flight.arrival_airport, flight_number,
          arrivalDate, flight.arrival_time, 'arrival', // 실제 항공편 도착시간 표시
          customer_name, hotel_name, phone, kakao_id, memo,
          adult_count, child_count, infant_count, luggage_count, passenger_count, agency_id,
          depResult.rows[0].id
        ]
      );
      
      const newRecords = [depResult.rows[0].id, arrResult.rows[0].id];
      
      // linked_id 연결
      if (newRecords.length === 2) {
        await pool.query(
          `UPDATE airport_pickups SET linked_id = $1 WHERE id = $2`,
          [newRecords[1], newRecords[0]]
        );
        await pool.query(
          `UPDATE airport_pickups SET linked_id = $1 WHERE id = $2`,
          [newRecords[0], newRecords[1]]
        );
      }
      
      return res.json({ success: true, updatedCount: 2, recreated: true });
    }
    
    // 3. 고객 정보만 수정 (날짜/편명 변경 없음)
    await pool.query(
      `UPDATE airport_pickups 
       SET customer_name = $1, passenger_count = $2, hotel_name = $3,
           phone = $4, kakao_id = $5, memo = $6,
           adult_count = $7, child_count = $8, infant_count = $9, luggage_count = $10,
           agency_id = $11, updated_at = NOW()
       WHERE id = $12`,
      [customer_name, passenger_count, hotel_name, phone, kakao_id, memo,
       adult_count, child_count, infant_count, luggage_count, agency_id, id]
    );
    
    if (linkedId) {
      await pool.query(
        `UPDATE airport_pickups 
         SET customer_name = $1, passenger_count = $2, hotel_name = $3,
             phone = $4, kakao_id = $5, memo = $6,
             adult_count = $7, child_count = $8, infant_count = $9, luggage_count = $10,
             agency_id = $11, updated_at = NOW()
         WHERE id = $12`,
        [customer_name, passenger_count, hotel_name, phone, kakao_id, memo,
         adult_count, child_count, infant_count, luggage_count, agency_id, linkedId]
      );
    }
    
    res.json({ success: true, updatedCount: linkedId ? 2 : 1 });
  } catch (error) {
    console.error('❌ 예약 수정 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 예약 취소 (linked_id로 연결된 레코드도 함께 취소)
router.delete('/api/:id', async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  
  try {
    // 1. 해당 레코드의 linked_id 조회
    const record = await pool.query(
      `SELECT linked_id FROM airport_pickups WHERE id = $1`,
      [id]
    );
    
    if (record.rows.length === 0) {
      return res.status(404).json({ error: '예약을 찾을 수 없습니다' });
    }
    
    const linkedId = record.rows[0].linked_id;
    
    // 2. 현재 레코드 취소
    await pool.query(
      `UPDATE airport_pickups SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [id]
    );
    
    // 3. 연결된 레코드도 취소 (linked_id가 있는 경우)
    if (linkedId) {
      await pool.query(
        `UPDATE airport_pickups SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
        [linkedId]
      );
    }
    
    res.json({ success: true, deletedCount: linkedId ? 2 : 1 });
  } catch (error) {
    console.error('❌ 예약 취소 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 업체 목록 (활성만)
router.get('/api/agencies', async (req, res) => {
  const pool = req.app.locals.pool;
  
  try {
    const result = await pool.query(
      `SELECT * FROM pickup_agencies WHERE is_active = true ORDER BY agency_name`
    );
    res.json({ agencies: result.rows });
  } catch (error) {
    console.error('❌ 업체 조회 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: AI 파싱하여 픽업 추가
router.post('/api/ai-parse', async (req, res) => {
  const pool = req.app.locals.pool;
  const { text } = req.body;
  
  if (!text || text.trim().length === 0) {
    return res.status(400).json({ error: '텍스트를 입력해주세요' });
  }
  
  try {
    // 간단한 패턴 매칭 파싱 (향후 OpenAI API로 업그레이드 가능)
    const lines = text.split('\n').filter(line => line.trim());
    const pickups = [];
    
    for (const line of lines) {
      const pickup = {
        pickup_source: 'ai_parsed',
        record_type: 'manual',
        status: 'active',
        contact_status: 'pending'
      };
      
      // 날짜 파싱 (10/20, 2025-10-20, 10월 20일 등)
      const dateMatch = line.match(/(\d{1,2})[\/\-월](\d{1,2})/);
      if (dateMatch) {
        const month = dateMatch[1].padStart(2, '0');
        const day = dateMatch[2].padStart(2, '0');
        pickup.display_date = `2025-${month}-${day}`;
      }
      
      // 시간 파싱 (15:00, 오후 3시 등)
      const timeMatch = line.match(/(\d{1,2}):(\d{2})/);
      if (timeMatch) {
        pickup.actual_pickup_time = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
      }
      
      // 호텔명 파싱
      const hotelMatch = line.match(/(힐튼|하얏트|PIC|아웃리거|웨스틴|두짓타니|레오팔래스|니코|롯데|온워드|피쉬아이|타무닝)/i);
      if (hotelMatch) {
        pickup.hotel_name = hotelMatch[0];
      }
      
      // 이름 파싱 (한글 2-4자)
      const nameMatch = line.match(/([가-힣]{2,4})/);
      if (nameMatch && !pickup.hotel_name) {
        pickup.customer_name = nameMatch[0];
      } else if (nameMatch) {
        pickup.customer_name = nameMatch[0];
      }
      
      // 인원수 파싱
      const personMatch = line.match(/(\d+)\s*명/);
      if (personMatch) {
        pickup.passenger_count = parseInt(personMatch[1]);
      }
      
      // 차량 파싱
      const vehicleMatch = line.match(/([A-Z]\d)/);
      if (vehicleMatch) {
        pickup.rental_vehicle = vehicleMatch[0];
      }
      
      // 차량번호 파싱
      const numberMatch = line.match(/(\d{2,3}[가-힣]\d{4})/);
      if (numberMatch) {
        pickup.rental_number = numberMatch[0];
      }
      
      // 시간(렌탈 시간) 파싱
      const durationMatch = line.match(/(\d+)\s*시간/);
      if (durationMatch) {
        pickup.rental_duration = `${durationMatch[1]}시간`;
      }
      
      // 항공편 파싱
      const flightMatch = line.match(/(KE|OZ|UA|DL|AA|JL)\s*\d{2,4}/i);
      if (flightMatch) {
        pickup.flight_number = flightMatch[0].toUpperCase();
      }
      
      // 연락처 파싱
      const phoneMatch = line.match(/(\d{2,3}[-\s]?\d{3,4}[-\s]?\d{4})/);
      if (phoneMatch) {
        pickup.phone = phoneMatch[0];
      }
      
      // 최소 필수 정보가 있는 경우에만 추가
      if (pickup.display_date && pickup.customer_name) {
        pickups.push(pickup);
      }
    }
    
    if (pickups.length === 0) {
      return res.status(400).json({ error: '파싱 가능한 픽업 정보를 찾을 수 없습니다' });
    }
    
    // DB에 저장
    const savedPickups = [];
    for (const pickup of pickups) {
      const columns = Object.keys(pickup);
      const values = Object.values(pickup);
      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
      
      const result = await pool.query(
        `INSERT INTO airport_pickups (${columns.join(', ')}) 
         VALUES (${placeholders}) RETURNING *`,
        values
      );
      
      savedPickups.push(result.rows[0]);
    }
    
    console.log(`✅ AI 파싱 완료: ${savedPickups.length}건`);
    res.json({ success: true, count: savedPickups.length, data: savedPickups });
    
  } catch (error) {
    console.error('❌ AI 파싱 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 업체 전체 목록 (관리용)
router.get('/api/agencies/all', async (req, res) => {
  const pool = req.app.locals.pool;
  
  try {
    const result = await pool.query(
      `SELECT * FROM pickup_agencies ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('❌ 업체 조회 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 업체 추가
router.post('/api/agencies', async (req, res) => {
  const pool = req.app.locals.pool;
  const { agency_name, cost_price, contact_person, phone, email, is_active } = req.body;
  
  try {
    // 4자리 고유 코드 생성
    let agency_code;
    let isUnique = false;
    
    while (!isUnique) {
      // 1000-9999 범위의 랜덤 숫자 생성
      agency_code = Math.floor(1000 + Math.random() * 9000).toString();
      
      // 중복 체크
      const check = await pool.query(
        'SELECT id FROM pickup_agencies WHERE agency_code = $1',
        [agency_code]
      );
      
      if (check.rows.length === 0) {
        isUnique = true;
      }
    }
    
    const result = await pool.query(
      `INSERT INTO pickup_agencies (agency_name, agency_code, cost_price, contact_person, phone, email, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [agency_name, agency_code, cost_price || 0, contact_person, phone, email, is_active !== false]
    );
    
    console.log(`✅ 신규 업체 등록: ${agency_name} (코드: ${agency_code}, 원가: $${cost_price})`);
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('❌ 업체 추가 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 업체 수정
router.put('/api/agencies/:id', async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  const { agency_name, cost_price, contact_person, phone, email, is_active } = req.body;
  
  try {
    // 기존 데이터 조회
    const existing = await pool.query(
      `SELECT * FROM pickup_agencies WHERE id = $1`,
      [id]
    );
    
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: '업체를 찾을 수 없습니다.' });
    }
    
    const current = existing.rows[0];
    
    // 부분 업데이트 지원 (제공된 값만 업데이트)
    const result = await pool.query(
      `UPDATE pickup_agencies 
       SET agency_name = $1, cost_price = $2, contact_person = $3, phone = $4, email = $5, is_active = $6
       WHERE id = $7 RETURNING *`,
      [
        agency_name !== undefined ? agency_name : current.agency_name,
        cost_price !== undefined ? cost_price : current.cost_price,
        contact_person !== undefined ? contact_person : current.contact_person,
        phone !== undefined ? phone : current.phone,
        email !== undefined ? email : current.email,
        is_active !== undefined ? is_active : current.is_active,
        id
      ]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('❌ 업체 수정 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 업체 삭제 (논리 삭제)
router.delete('/api/agencies/:id', async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  
  try {
    // 해당 업체를 사용하는 픽업건이 있는지 확인 (모든 상태 포함)
    const checkResult = await pool.query(
      `SELECT COUNT(*) as count FROM airport_pickups WHERE agency_id = $1`,
      [id]
    );
    
    const usageCount = parseInt(checkResult.rows[0].count);
    
    if (usageCount > 0) {
      // 픽업건이 하나라도 있으면 비활성화만 가능 (취소된 것 포함)
      await pool.query(
        `UPDATE pickup_agencies SET is_active = false WHERE id = $1`,
        [id]
      );
      
      // 활성/취소 상태별 카운트
      const statusCount = await pool.query(
        `SELECT status, COUNT(*) as count 
         FROM airport_pickups 
         WHERE agency_id = $1 
         GROUP BY status`,
        [id]
      );
      
      const statusInfo = statusCount.rows.map(r => `${r.status}: ${r.count}건`).join(', ');
      
      res.json({ 
        success: true, 
        message: `해당 업체를 사용하는 픽업건이 ${usageCount}건 있어 비활성화 처리되었습니다.\n(${statusInfo})`,
        deactivated: true,
        usageCount,
        statusInfo
      });
    } else {
      // 픽업건이 전혀 없으면 완전 삭제
      await pool.query(`DELETE FROM pickup_agencies WHERE id = $1`, [id]);
      res.json({ success: true, message: '업체가 삭제되었습니다.', deleted: true });
    }
  } catch (error) {
    console.error('❌ 업체 삭제 실패:', error);
    
    // 외래키 제약조건 에러 처리
    if (error.code === '23503') {
      res.status(400).json({ 
        error: '해당 업체를 사용하는 픽업 예약이 있어 삭제할 수 없습니다. 비활성화 처리됩니다.',
        hint: '업체를 삭제하려면 먼저 해당 업체를 사용하는 모든 픽업 예약을 삭제하거나 다른 업체로 변경해주세요.'
      });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// API: 비행편 자동완성 데이터 (활성 항공편만)
router.get('/api/flights', async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const flights = await getFlights(pool);
    res.json(flights);
  } catch (error) {
    console.error('❌ 항공편 조회 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 항공편 전체 목록 (관리용)
router.get('/api/flights/all', async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const result = await pool.query(
      `SELECT * FROM pickup_flights ORDER BY airline, departure_time`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('❌ 항공편 조회 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 항공편 상세
router.get('/api/flights/:id', async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT * FROM pickup_flights WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '항공편을 찾을 수 없습니다' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ 항공편 조회 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 항공편 추가
router.post('/api/flights', async (req, res) => {
  const pool = req.app.locals.pool;
  const { 
    flight_number, airline, departure_time, arrival_time, flight_hours,
    departure_airport, arrival_airport, days_of_week, notes, is_active 
  } = req.body;
  
  try {
    const result = await pool.query(
      `INSERT INTO pickup_flights 
       (flight_number, airline, departure_time, arrival_time, flight_hours, departure_airport, arrival_airport, days_of_week, notes, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [flight_number, airline, departure_time, arrival_time, flight_hours, departure_airport, arrival_airport, days_of_week || '1,2,3,4,5,6,7', notes, is_active !== false]
    );
    
    // 캐시 갱신
    await loadFlightsFromDB(pool);
    
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('❌ 항공편 추가 실패:', error);
    if (error.code === '23505') { // unique violation
      res.status(400).json({ error: '이미 존재하는 편명입니다' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// API: 항공편 수정
router.put('/api/flights/:id', async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  const { 
    flight_number, airline, departure_time, arrival_time, flight_hours,
    departure_airport, arrival_airport, days_of_week, notes, is_active 
  } = req.body;
  
  try {
    const result = await pool.query(
      `UPDATE pickup_flights 
       SET flight_number = $1, airline = $2, departure_time = $3, arrival_time = $4, flight_hours = $5,
           departure_airport = $6, arrival_airport = $7, days_of_week = $8, notes = $9, is_active = $10
       WHERE id = $11 RETURNING *`,
      [flight_number, airline, departure_time, arrival_time, flight_hours, departure_airport, arrival_airport, days_of_week, notes, is_active, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '항공편을 찾을 수 없습니다' });
    }
    
    // 캐시 갱신
    await loadFlightsFromDB(pool);
    
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('❌ 항공편 수정 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 항공편 삭제 (스마트 삭제)
router.delete('/api/flights/:id', async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  
  try {
    // 먼저 항공편 정보 조회
    const flightResult = await pool.query(
      `SELECT flight_number FROM pickup_flights WHERE id = $1`,
      [id]
    );
    
    if (flightResult.rows.length === 0) {
      return res.status(404).json({ error: '항공편을 찾을 수 없습니다.' });
    }
    
    const flightNumber = flightResult.rows[0].flight_number;
    
    // 해당 항공편을 사용하는 픽업건이 있는지 확인
    const checkResult = await pool.query(
      `SELECT COUNT(*) as count FROM airport_pickups 
       WHERE flight_number = $1 AND status = 'active'`,
      [flightNumber]
    );
    
    const usageCount = parseInt(checkResult.rows[0].count);
    
    if (usageCount > 0) {
      // 사용 중인 항공편은 비활성화만 가능
      await pool.query(
        `UPDATE pickup_flights SET is_active = false WHERE id = $1`,
        [id]
      );
      
      // 캐시 갱신
      await loadFlightsFromDB(pool);
      
      res.json({ 
        success: true, 
        message: `해당 항공편을 사용하는 픽업건이 ${usageCount}건 있어 비활성화 처리되었습니다.`,
        deactivated: true
      });
    } else {
      // 사용 중이지 않은 항공편은 완전 삭제
      await pool.query(`DELETE FROM pickup_flights WHERE id = $1`, [id]);
      
      // 캐시 갱신
      await loadFlightsFromDB(pool);
      
      res.json({ success: true, message: '항공편이 삭제되었습니다.', deleted: true });
    }
  } catch (error) {
    console.error('❌ 항공편 삭제 실패:', error);
    
    // 외래키 제약조건 에러 처리
    if (error.code === '23503') {
      res.status(400).json({ 
        error: '해당 항공편을 사용하는 픽업 예약이 있어 삭제할 수 없습니다.',
        hint: '항공편을 삭제하려면 먼저 해당 항공편을 사용하는 모든 픽업 예약을 삭제하거나 다른 항공편으로 변경해주세요.'
      });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// 픽업 루트 경로 - 로그인 페이지로 리다이렉트
router.get('/', (req, res) => {
  // 이미 로그인되어 있으면 스케줄로, 아니면 로그인 페이지로
  const isMainAdmin = req.session && req.session.adminId;
  const isPickupAdmin = req.session && req.session.admin;
  
  if (isMainAdmin || isPickupAdmin) {
    res.redirect('/pickup/schedule');
  } else {
    res.redirect('/pickup/login');
  }
});

// 픽업 전용 로그인 페이지
router.get('/login', (req, res) => {
  res.render('pickup/login', { 
    title: '공항픽업 관리 시스템',
    error: null 
  });
});

// 픽업 로그인 처리 (POST)
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  // 환경변수에서 관리자 계정 확인
  const adminUsername = process.env.ADMIN_USERNAME || 'koreatour';
  const adminPassword = process.env.ADMIN_PASSWORD || 'korea01@';
  
  if (username === adminUsername && password === adminPassword) {
    // 세션 설정
    req.session.admin = {
      username: username,
      loginTime: new Date()
    };
    
    // 세션 저장 후 리다이렉트
    req.session.save((err) => {
      if (err) {
        console.error('세션 저장 실패:', err);
        return res.render('pickup/login', {
          title: '공항픽업 관리 시스템',
          error: '로그인 처리 중 오류가 발생했습니다.'
        });
      }
      res.redirect('/pickup/schedule');
    });
  } else {
    res.render('pickup/login', {
      title: '공항픽업 관리 시스템',
      error: '아이디 또는 비밀번호가 올바르지 않습니다.'
    });
  }
});

// API: 기사 화면
router.get('/driver', (req, res) => {
  res.render('pickup/driver');
});

// 테스트 화면
router.get('/test', (req, res) => {
  res.render('pickup/test');
});

// 일반 고객 직접 예약 페이지
router.get('/booking', (req, res) => {
  res.render('pickup/customer-booking');
});

// 정산 관리 화면 (로그인 필요 - ERP 관리자 또는 픽업 관리자)
router.get('/settlement', (req, res) => {
  // ERP 관리자 세션 또는 픽업 전용 세션 체크
  const isMainAdmin = req.session && req.session.adminId;
  const isPickupAdmin = req.session && req.session.admin;
  
  if (!isMainAdmin && !isPickupAdmin) {
    return res.redirect('/pickup/login');
  }
  
  res.render('pickup/settlement');
});

// API: 정산 전 픽업건 조회 (이용일이 지난 출발건만)
router.get('/api/settlement/pending', async (req, res) => {
  const pool = req.app.locals.pool;
  const { agency_id, start_date, end_date } = req.query;
  
  try {
    const today = new Date().toISOString().split('T')[0];
    
    let query = `
      SELECT 
        ap.*,
        pa.agency_name
      FROM airport_pickups ap
      LEFT JOIN pickup_agencies pa ON ap.agency_id = pa.id
      WHERE ap.display_date < $1
        AND ap.status = 'active'
        AND ap.settlement_date IS NULL
        AND ap.record_type = 'departure'
    `;
    
    const params = [today];
    let paramCount = 2;
    
    // 업체 필터
    if (agency_id) {
      query += ` AND ap.agency_id = $${paramCount}`;
      params.push(agency_id);
      paramCount++;
    }
    
    // 출발일 시작 필터
    if (start_date) {
      query += ` AND ap.display_date >= $${paramCount}`;
      params.push(start_date);
      paramCount++;
    }
    
    // 출발일 종료 필터
    if (end_date) {
      query += ` AND ap.display_date <= $${paramCount}`;
      params.push(end_date);
      paramCount++;
    }
    
    query += ` ORDER BY ap.display_date DESC, ap.display_time DESC`;
    
    const result = await pool.query(query, params);
    
    res.json({ pickups: result.rows });
  } catch (error) {
    console.error('❌ 정산 전 목록 조회 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 정산 완료 픽업건 조회
router.get('/api/settlement/completed', async (req, res) => {
  const pool = req.app.locals.pool;
  const { agency_id, start_date, end_date } = req.query;
  
  try {
    let query = `
      SELECT 
        ap.*,
        pa.agency_name
      FROM airport_pickups ap
      LEFT JOIN pickup_agencies pa ON ap.agency_id = pa.id
      WHERE ap.settlement_date IS NOT NULL
        AND ap.status = 'active'
        AND ap.record_type = 'departure'
    `;
    
    const params = [];
    let paramCount = 1;
    
    // 업체 필터
    if (agency_id) {
      query += ` AND ap.agency_id = $${paramCount}`;
      params.push(agency_id);
      paramCount++;
    }
    
    // 픽업일 시작 필터
    if (start_date) {
      query += ` AND ap.display_date >= $${paramCount}`;
      params.push(start_date);
      paramCount++;
    }
    
    // 픽업일 종료 필터
    if (end_date) {
      query += ` AND ap.display_date <= $${paramCount}`;
      params.push(end_date);
      paramCount++;
    }
    
    query += ` ORDER BY ap.settlement_date DESC, ap.display_date DESC`;
    
    const result = await pool.query(query, params);
    
    res.json({ pickups: result.rows });
  } catch (error) {
    console.error('❌ 정산 완료 목록 조회 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 정산 완료 처리
router.post('/api/settlement/complete', async (req, res) => {
  const pool = req.app.locals.pool;
  const { ids } = req.body;
  
  if (!ids || ids.length === 0) {
    return res.status(400).json({ error: '정산할 픽업건을 선택해주세요' });
  }
  
  try {
    const now = new Date().toISOString();
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    
    const result = await pool.query(`
      UPDATE airport_pickups
      SET settlement_date = $${ids.length + 1},
          settlement_status = 'completed'
      WHERE id IN (${placeholders})
        AND settlement_date IS NULL
      RETURNING id
    `, [...ids, now]);
    
    res.json({ 
      success: true, 
      count: result.rowCount,
      message: `${result.rowCount}건 정산 완료 처리되었습니다`
    });
  } catch (error) {
    console.error('❌ 정산 처리 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 월별 예약 조회 (달력용 - display_date 기준)
router.get('/api/calendar', async (req, res) => {
  const pool = req.app.locals.pool;
  const { year, month } = req.query;
  
  try {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    
    // 해당 월의 마지막 날 계산
    const nextMonth = parseInt(month) === 12 ? 1 : parseInt(month) + 1;
    const nextYear = parseInt(month) === 12 ? parseInt(year) + 1 : parseInt(year);
    const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
    
    // display_date 기준으로 모든 레코드 조회 (해당 월만, 확정된 예약만)
    const pickups = await pool.query(`
      SELECT 
        ap.*,
        pa.agency_name
      FROM airport_pickups ap
      LEFT JOIN pickup_agencies pa ON ap.agency_id = pa.id
      WHERE ap.display_date >= $1 AND ap.display_date < $2
        AND ap.status = 'active'
        AND ap.confirmation_status = 'confirmed'
      ORDER BY ap.display_date, ap.display_time
    `, [startDate, endDate]);
    
    res.json({ pickups: pickups.rows });
  } catch (error) {
    console.error('❌ 달력 조회 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 마감날짜 목록 조회
router.get('/api/closed-dates', async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const result = await pool.query(`
      SELECT * FROM pickup_closed_dates 
      ORDER BY closed_date DESC
    `);
    res.json({ closedDates: result.rows });
  } catch (error) {
    console.error('❌ 마감날짜 조회 실패:', error);
    
    // 테이블이 없는 경우 빈 배열 반환
    if (error.code === '42P01') {
      console.warn('⚠️ pickup_closed_dates 테이블이 없습니다. 빈 배열을 반환합니다.');
      return res.json({ closedDates: [] });
    }
    
    res.status(500).json({ error: error.message });
  }
});

// API: 특정 날짜 마감 여부 확인
router.get('/api/closed-dates/check', async (req, res) => {
  const pool = req.app.locals.pool;
  const { date } = req.query;
  
  try {
    const result = await pool.query(`
      SELECT * FROM pickup_closed_dates 
      WHERE closed_date = $1
    `, [date]);
    
    res.json({ 
      isClosed: result.rows.length > 0,
      data: result.rows[0] || null
    });
  } catch (error) {
    console.error('❌ 마감날짜 확인 실패:', error);
    
    // 테이블이 없는 경우 마감되지 않은 것으로 처리
    if (error.code === '42P01') {
      console.warn('⚠️ pickup_closed_dates 테이블이 없습니다. 마감되지 않은 것으로 처리합니다.');
      return res.json({ isClosed: false, data: null });
    }
    
    res.status(500).json({ error: error.message });
  }
});

// API: 마감날짜 등록
router.post('/api/closed-dates', async (req, res) => {
  const pool = req.app.locals.pool;
  const { closed_date, reason } = req.body;
  
  if (!closed_date) {
    return res.status(400).json({ error: '마감날짜를 입력해주세요' });
  }
  
  try {
    const result = await pool.query(`
      INSERT INTO pickup_closed_dates (closed_date, reason, created_by)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [closed_date, reason || '', req.session?.username || 'admin']);
    
    res.json({ 
      success: true, 
      data: result.rows[0],
      message: '마감날짜가 등록되었습니다'
    });
  } catch (error) {
    console.error('❌ 마감날짜 등록 실패:', error);
    
    // 테이블이 없는 경우
    if (error.code === '42P01') {
      return res.status(500).json({ 
        error: '마감날짜 테이블이 생성되지 않았습니다. 관리자에게 문의하세요.',
        hint: 'Railway 데이터베이스에서 pickup_closed_dates 테이블을 생성해야 합니다.'
      });
    }
    
    // 중복 날짜 에러 처리
    if (error.code === '23505') {
      return res.status(400).json({ error: '이미 마감 처리된 날짜입니다' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

// API: 마감날짜 삭제 (마감 해제)
router.delete('/api/closed-dates/:id', async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  
  try {
    const result = await pool.query(`
      DELETE FROM pickup_closed_dates 
      WHERE id = $1
      RETURNING closed_date
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '마감날짜를 찾을 수 없습니다' });
    }
    
    res.json({ 
      success: true, 
      message: `${result.rows[0].closed_date} 마감이 해제되었습니다` 
    });
  } catch (error) {
    console.error('❌ 마감날짜 삭제 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 날짜로 마감날짜 삭제 (마감 해제)
router.delete('/api/closed-dates/by-date/:date', async (req, res) => {
  const pool = req.app.locals.pool;
  const { date } = req.params;
  
  try {
    const result = await pool.query(`
      DELETE FROM pickup_closed_dates 
      WHERE closed_date = $1
      RETURNING *
    `, [date]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '마감날짜를 찾을 수 없습니다' });
    }
    
    res.json({ 
      success: true, 
      message: `${date} 마감이 해제되었습니다` 
    });
  } catch (error) {
    console.error('❌ 마감날짜 삭제 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== 업체 포털 ====================

// 업체용 예약 페이지
router.get('/agency/:code', async (req, res) => {
  const pool = req.app.locals.pool;
  const { code } = req.params;
  
  try {
    const result = await pool.query(
      `SELECT id, agency_name, agency_code FROM pickup_agencies WHERE agency_code = $1 AND is_active = true`,
      [code]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).send('유효하지 않은 업체 코드입니다.');
    }
    
    const agency = result.rows[0];
    res.render('pickup/agency-portal', {
      agencyId: agency.id,
      agencyName: agency.agency_name,
      agencyCode: agency.agency_code
    });
  } catch (error) {
    console.error('❌ 업체 포털 로드 실패:', error);
    res.status(500).send('서버 오류가 발생했습니다.');
  }
});

// API: 업체가 예약 등록
router.post('/api/agency-register', async (req, res) => {
  const pool = req.app.locals.pool;
  const {
    pickup_type, flight_date, flight_number,
    customer_name, hotel_name, phone, kakao_id, memo,
    adult_count, child_count, infant_count, luggage_count,
    agency_id
  } = req.body;
  
  try {
    // 항공편 정보 조회
    const flights = await getFlights(pool);
    const flight = flights[flight_number];
    
    if (!flight) {
      return res.status(400).json({ error: '유효하지 않은 편명입니다' });
    }
    
    const passenger_count = (adult_count || 0) + (child_count || 0) + (infant_count || 0);
    
    // 도착일시 계산
    const isToGuam = flight.arrival_airport === 'GUM';
    const depTZ = isToGuam ? '+09:00' : '+10:00';
    const arrTZ = isToGuam ? 10 : 9;
    
    const depDateTime = new Date(`${flight_date}T${flight.time}:00${depTZ}`);
    const arrMillis = depDateTime.getTime() + (flight.hours * 3600000);
    const arrDateTime = new Date(arrMillis);
    
    const utcHours = arrDateTime.getUTCHours();
    const utcMinutes = arrDateTime.getUTCMinutes();
    const utcDate = arrDateTime.getUTCDate();
    const utcMonth = arrDateTime.getUTCMonth();
    const utcYear = arrDateTime.getUTCFullYear();
    
    let arrHours = utcHours + arrTZ;
    let arrDateObj = new Date(Date.UTC(utcYear, utcMonth, utcDate));
    
    if (arrHours >= 24) {
      arrHours -= 24;
      arrDateObj.setUTCDate(arrDateObj.getUTCDate() + 1);
    }
    
    const arrivalDate = arrDateObj.toISOString().split('T')[0];
    const arrivalTime = String(arrHours).padStart(2, '0') + ':' + String(utcMinutes).padStart(2, '0');
    
    // 공통 데이터
    const baseData = {
      pickup_type, flight_number, customer_name, hotel_name, phone, kakao_id, memo,
      adult_count, child_count, infant_count, luggage_count, passenger_count, agency_id,
      status: 'active',
      confirmation_status: 'pending'  // 업체 예약은 검수 대기 상태
    };
    
    // 1. 출발 레코드
    const depData = {
      ...baseData,
      departure_date: flight_date,
      departure_time: flight.time,
      departure_airport: flight.departure_airport,
      arrival_date: arrivalDate,
      arrival_time: arrivalTime,
      arrival_airport: flight.arrival_airport,
      record_type: 'departure',
      display_date: flight_date,
      display_time: flight.time
    };
    
    const depColumns = Object.keys(depData).join(', ');
    const depValues = Object.values(depData);
    const depPlaceholders = depValues.map((_, i) => `$${i + 1}`).join(', ');
    
    const depResult = await pool.query(
      `INSERT INTO airport_pickups (${depColumns}) VALUES (${depPlaceholders}) RETURNING *`,
      depValues
    );
    
    // 2. 도착 레코드
    const arrivalData = {
      ...baseData,
      departure_date: flight_date,
      departure_time: flight.time,
      departure_airport: flight.departure_airport,
      arrival_date: arrivalDate,
      arrival_time: arrivalTime,
      arrival_airport: flight.arrival_airport,
      record_type: 'arrival',
      display_date: arrivalDate,
      display_time: flight.arrival_time,
      linked_id: depResult.rows[0].id
    };
    
    const arrColumns = Object.keys(arrivalData).join(', ');
    const arrValues = Object.values(arrivalData);
    const arrPlaceholders = arrValues.map((_, i) => `$${i + 1}`).join(', ');
    
    const arrResult = await pool.query(
      `INSERT INTO airport_pickups (${arrColumns}) VALUES (${arrPlaceholders}) RETURNING *`,
      arrValues
    );
    
    // linked_id 양방향 연결
    await pool.query(
      `UPDATE airport_pickups SET linked_id = $1 WHERE id = $2`,
      [arrResult.rows[0].id, depResult.rows[0].id]
    );
    
    res.json({ 
      success: true, 
      departure: depResult.rows[0],
      arrival: arrResult.rows[0]
    });
  } catch (error) {
    console.error('❌ 업체 예약 등록 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 일반 고객 직접 예약 등록 (괌 출발편만)
router.post('/api/customer-booking', async (req, res) => {
  const pool = req.app.locals.pool;
  const {
    flight_date, flight_number, customer_name, hotel_name,
    adult_count, child_count, infant_count, luggage_count,
    phone, kakao_id, memo
  } = req.body;
  
  try {
    // 항공편 정보 가져오기
    const flights = await getFlights(pool);
    const flight = flights[flight_number];
    
    if (!flight) {
      return res.status(400).json({ error: '유효하지 않은 편명입니다' });
    }
    
    // 괌 출발편만 허용
    if (flight.departure_airport !== 'GUM') {
      return res.status(400).json({ error: '괌 출발편만 예약 가능합니다' });
    }
    
    const passenger_count = (adult_count || 0) + (child_count || 0) + (infant_count || 0);
    
    // 도착일시 계산
    const depTZ = '+10:00'; // 괌 시간
    const arrTZ = 9; // 한국 시간
    
    const depDateTime = new Date(`${flight_date}T${flight.time}:00${depTZ}`);
    const arrMillis = depDateTime.getTime() + (flight.hours * 3600000);
    const arrDateTime = new Date(arrMillis);
    
    const utcHours = arrDateTime.getUTCHours();
    const utcMinutes = arrDateTime.getUTCMinutes();
    const utcDate = arrDateTime.getUTCDate();
    const utcMonth = arrDateTime.getUTCMonth();
    const utcYear = arrDateTime.getUTCFullYear();
    
    let arrHours = utcHours + arrTZ;
    let arrDateObj = new Date(Date.UTC(utcYear, utcMonth, utcDate));
    
    if (arrHours >= 24) {
      arrHours -= 24;
      arrDateObj.setUTCDate(arrDateObj.getUTCDate() + 1);
    }
    
    const arrivalDate = arrDateObj.toISOString().split('T')[0];
    const arrivalTime = String(arrHours).padStart(2, '0') + ':' + String(utcMinutes).padStart(2, '0');
    
    // 출발 레코드 생성 (괌 → 한국)
    const pickupData = {
      pickup_type: 'airport',
      flight_number,
      customer_name,
      hotel_name,
      phone,
      kakao_id,
      memo,
      adult_count,
      child_count,
      infant_count,
      luggage_count,
      passenger_count,
      departure_date: flight_date,
      departure_time: flight.time,
      departure_airport: flight.departure_airport,
      arrival_date: arrivalDate,
      arrival_time: arrivalTime,
      arrival_airport: flight.arrival_airport,
      record_type: 'departure',
      display_date: flight_date,
      display_time: flight.time,
      status: 'active',
      confirmation_status: 'pending',
      agency_id: null // 일반 고객은 agency_id 없음
    };
    
    const columns = Object.keys(pickupData).join(', ');
    const values = Object.values(pickupData);
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    
    const result = await pool.query(
      `INSERT INTO airport_pickups (${columns}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    
    res.json({ 
      success: true, 
      pickup: result.rows[0]
    });
  } catch (error) {
    console.error('❌ 고객 예약 등록 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 업체 예약 내역 조회 (검색 필터 지원)
router.get('/api/agency-pickups', async (req, res) => {
  const pool = req.app.locals.pool;
  const { agency_id, dateFrom, dateTo, name, status } = req.query;
  
  try {
    let query = `
      SELECT * FROM airport_pickups 
      WHERE agency_id = $1 AND status = 'active'
    `;
    const params = [agency_id];
    let paramIndex = 2;
    
    // 출발일 기간 검색 (시작일)
    if (dateFrom) {
      query += ` AND display_date >= $${paramIndex}`;
      params.push(dateFrom);
      paramIndex++;
    }
    
    // 출발일 기간 검색 (종료일)
    if (dateTo) {
      query += ` AND display_date <= $${paramIndex}`;
      params.push(dateTo);
      paramIndex++;
    }
    
    // 고객명 검색
    if (name) {
      query += ` AND customer_name ILIKE $${paramIndex}`;
      params.push(`%${name}%`);
      paramIndex++;
    }
    
    // 상태 검색
    if (status) {
      if (status === 'settled') {
        query += ` AND (settlement_status = 'completed' OR settlement_date IS NOT NULL)`;
      } else {
        query += ` AND confirmation_status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
      }
    }
    
    query += ` ORDER BY display_date DESC, display_time DESC`;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ 업체 예약 조회 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== 신규예약 확정 관리 ====================

// API: 신규예약 카운트 (왕복 그룹화 후)
router.get('/api/pending-count', async (req, res) => {
  const pool = req.app.locals.pool;
  
  try {
    // departure 레코드만 카운트 (왕복 예약은 1개로 계산)
    const result = await pool.query(`
      SELECT COUNT(*) as count 
      FROM airport_pickups 
      WHERE status = 'active' 
        AND confirmation_status = 'pending'
        AND record_type = 'departure'
    `);
    
    res.json({ pending: parseInt(result.rows[0].count) });
  } catch (error) {
    console.error('❌ 카운트 조회 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 신규예약 리스트 (pending, rejected)
router.get('/api/pending-reservations', async (req, res) => {
  const pool = req.app.locals.pool;
  
  try {
    const pendingResult = await pool.query(`
      SELECT * FROM airport_pickups 
      WHERE status = 'active' AND confirmation_status = 'pending'
      ORDER BY created_at DESC
    `);
    
    const rejectedResult = await pool.query(`
      SELECT * FROM airport_pickups 
      WHERE status = 'active' AND confirmation_status = 'rejected'
      ORDER BY created_at DESC
    `);
    
    res.json({
      pending: pendingResult.rows,
      rejected: rejectedResult.rows
    });
  } catch (error) {
    console.error('❌ 예약 리스트 조회 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 예약 확정 (달력 표시)
router.post('/api/confirm-reservation', async (req, res) => {
  const pool = req.app.locals.pool;
  const { id, linkedId } = req.body;
  
  try {
    // 본인 확정
    await pool.query(
      `UPDATE airport_pickups SET confirmation_status = 'confirmed' WHERE id = $1`,
      [id]
    );
    
    // 연결된 예약도 확정
    if (linkedId) {
      await pool.query(
        `UPDATE airport_pickups SET confirmation_status = 'confirmed' WHERE id = $1`,
        [linkedId]
      );
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('❌ 예약 확정 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 예약 미확정
router.post('/api/reject-reservation', async (req, res) => {
  const pool = req.app.locals.pool;
  const { id, linkedId, reason } = req.body;
  
  try {
    // 메모에 미확정 사유 추가
    if (reason) {
      await pool.query(
        `UPDATE airport_pickups 
         SET confirmation_status = 'rejected', 
             memo = CASE 
               WHEN memo IS NULL OR memo = '' THEN $1 
               ELSE memo || '\n[미확정 사유] ' || $1 
             END 
         WHERE id = $2`,
        [reason, id]
      );
    } else {
      await pool.query(
        `UPDATE airport_pickups SET confirmation_status = 'rejected' WHERE id = $1`,
        [id]
      );
    }
    
    // 연결된 예약도 미확정
    if (linkedId) {
      if (reason) {
        await pool.query(
          `UPDATE airport_pickups 
           SET confirmation_status = 'rejected', 
               memo = CASE 
                 WHEN memo IS NULL OR memo = '' THEN $1 
                 ELSE memo || '\n[미확정 사유] ' || $1 
               END 
           WHERE id = $2`,
          [reason, linkedId]
        );
      } else {
        await pool.query(
          `UPDATE airport_pickups SET confirmation_status = 'rejected' WHERE id = $1`,
          [linkedId]
        );
      }
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('❌ 예약 미확정 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 예약 삭제
router.post('/api/delete-reservation', async (req, res) => {
  const pool = req.app.locals.pool;
  const { id, linkedId } = req.body;
  
  try {
    // 소프트 삭제 (status = 'deleted')
    await pool.query(
      `UPDATE airport_pickups SET status = 'deleted' WHERE id = $1`,
      [id]
    );
    
    // 연결된 예약도 삭제
    if (linkedId) {
      await pool.query(
        `UPDATE airport_pickups SET status = 'deleted' WHERE id = $1`,
        [linkedId]
      );
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('❌ 예약 삭제 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 예약 상세 조회
router.get('/api/pickup/:id', async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  
  try {
    const result = await pool.query(
      `SELECT * FROM airport_pickups WHERE id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '예약을 찾을 수 없습니다' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ 예약 조회 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 예약 수정
router.put('/api/pickup/:id', async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  const {
    customer_name, hotel_name, phone, kakao_id,
    adult_count, child_count, infant_count, luggage_count,
    passenger_count, memo
  } = req.body;
  
  try {
    await pool.query(
      `UPDATE airport_pickups 
       SET customer_name = $1, hotel_name = $2, phone = $3, kakao_id = $4,
           adult_count = $5, child_count = $6, infant_count = $7, luggage_count = $8,
           passenger_count = $9, memo = $10
       WHERE id = $11`,
      [customer_name, hotel_name, phone, kakao_id,
       adult_count, child_count, infant_count, luggage_count,
       passenger_count, memo, id]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('❌ 예약 수정 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== 스케줄 관리 API ====================

// API: 통합 스케줄 조회 (시스템 + 수동)
router.get('/api/schedule/:date', async (req, res) => {
  const pool = req.app.locals.pool;
  const { date } = req.params;
  
  try {
    const result = await pool.query(`
      SELECT 
        ap.id, ap.pickup_source, ap.pickup_type, ap.route_type, ap.record_type,
        ap.display_date, ap.display_time, ap.actual_pickup_time,
        ap.departure_date, ap.departure_time, ap.arrival_date, ap.arrival_time,
        ap.departure_airport, ap.arrival_airport, ap.flight_number,
        ap.customer_name, ap.english_name, ap.phone, ap.kakao_id,
        ap.passenger_count, ap.adult_count, ap.child_count, ap.infant_count, ap.luggage_count,
        ap.hotel_name, ap.agency_id,
        ap.contact_status, ap.driver_name, ap.driver_vehicle,
        ap.payment_status, ap.special_request, ap.remark,
        ap.rental_vehicle, ap.rental_number, ap.rental_duration,
        ap.status, ap.created_at,
        pa.agency_name
      FROM airport_pickups ap
      LEFT JOIN pickup_agencies pa ON ap.agency_id = pa.id
      WHERE ap.display_date = $1 
        AND ap.status = 'active'
        AND (
          -- 괌 도착편 (한국→괌): 괌 공항 도착만 표시
          (ap.record_type = 'arrival' AND ap.arrival_airport = 'GUM')
          OR
          -- 괌 출발편 (괌→한국): 괌 공항 출발만 표시  
          (ap.record_type = 'departure' AND ap.departure_airport = 'GUM')
          OR
          -- 수동 입력 픽업 (괌 현지 픽업)
          ap.record_type = 'manual'
        )
      ORDER BY ap.display_time, ap.id
    `, [date]);
    
    // 통계 계산
    const pickups = result.rows;
    const summary = {
      total: pickups.length,
      contacted: pickups.filter(p => p.contact_status === 'CONTACTED').length,
      pending: pickups.filter(p => p.contact_status === 'PENDING').length,
      total_passengers: pickups.reduce((sum, p) => sum + (p.passenger_count || 0), 0)
    };
    
    res.json({
      date,
      pickups,
      summary
    });
  } catch (error) {
    console.error('❌ 스케줄 조회 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: AI 파싱
router.post('/api/parse-manual', async (req, res) => {
  const { raw_text } = req.body;
  
  if (!raw_text) {
    return res.status(400).json({ error: '파싱할 텍스트가 필요합니다' });
  }
  
  try {
    // OpenAI 파싱 (나중에 구현)
    // 지금은 간단한 응답만
    res.json({
      success: true,
      data: {
        pickup_time: null,
        customer_name: null,
        route_type: null,
        phone: null,
        passenger_count: null
      },
      message: 'AI 파싱 기능은 다음 단계에서 구현됩니다'
    });
  } catch (error) {
    console.error('❌ AI 파싱 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 수동 픽업 추가
router.post('/api/manual-pickup', async (req, res) => {
  const pool = req.app.locals.pool;
  const {
    pickup_date,
    pickup_time,
    route_type,
    customer_name,
    english_name,
    phone,
    passenger_count,
    adult_count,
    child_count,
    infant_count,
    luggage_count,
    driver_name,
    driver_vehicle,
    flight_number,
    rental_vehicle,
    rental_number,
    rental_duration,
    hotel_name,
    remark,
    parsed_by
  } = req.body;
  
  try {
    const result = await pool.query(`
      INSERT INTO airport_pickups (
        pickup_source, pickup_type, route_type,
        display_date, display_time, actual_pickup_time,
        customer_name, english_name, phone,
        passenger_count, adult_count, child_count, infant_count, luggage_count,
        driver_name, driver_vehicle, flight_number,
        rental_vehicle, rental_number, rental_duration,
        hotel_name, remark,
        contact_status, status, parsed_by,
        record_type
      ) VALUES (
        'manual', 'other', $1,
        $2, $3, $3,
        $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14,
        $15, $16, $17,
        $18, $19,
        'PENDING', 'active', $20,
        'manual'
      ) RETURNING *
    `, [
      route_type, pickup_date, pickup_time,
      customer_name, english_name, phone,
      passenger_count || 0, adult_count || 0, child_count || 0, infant_count || 0, luggage_count || 0,
      driver_name, driver_vehicle, flight_number,
      rental_vehicle, rental_number, rental_duration,
      hotel_name, remark,
      parsed_by || 'manual'
    ]);
    
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('❌ 수동 픽업 추가 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 필드 업데이트 (인라인 편집)
router.put('/api/:id/update-field', async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  const { field, value } = req.body;
  
  // 허용된 필드만 업데이트
  const allowedFields = [
    'contact_status', 'actual_pickup_time', 'driver_name', 'driver_vehicle',
    'payment_status', 'remark', 'phone', 'passenger_count',
    'rental_vehicle', 'rental_number', 'rental_duration', 'hotel_name'
  ];
  
  if (!allowedFields.includes(field)) {
    return res.status(400).json({ error: '허용되지 않은 필드입니다' });
  }
  
  try {
    // linked_id가 있으면 함께 업데이트
    const linkedResult = await pool.query(
      'SELECT linked_id FROM airport_pickups WHERE id = $1',
      [id]
    );
    
    const query = `UPDATE airport_pickups SET ${field} = $1, updated_at = NOW() WHERE id = $2`;
    await pool.query(query, [value, id]);
    
    // 연결된 레코드도 업데이트
    if (linkedResult.rows[0]?.linked_id) {
      await pool.query(query, [value, linkedResult.rows[0].linked_id]);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('❌ 필드 업데이트 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 수동 픽업 삭제
router.delete('/api/manual-pickup/:id', async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  
  try {
    // 수동 픽업만 삭제 가능
    const result = await pool.query(
      `UPDATE airport_pickups 
       SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND pickup_source = 'manual' AND record_type = 'manual'
       RETURNING *`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(400).json({ error: '수동 픽업만 삭제할 수 있습니다' });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('❌ 삭제 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== 스케줄 페이지 라우트 ====================

// 공개 스케줄 페이지 (로그인 불필요) - 먼저 정의!
router.get('/schedule/public/:date?', (req, res) => {
  const date = req.params.date || 'today';
  res.render('pickup/schedule-public', { 
    title: 'HKT Daily Schedule',
    initialDate: date
  });
});

// 일별 스케줄 페이지 (로그인 필요) - 달력에서 전체보기 클릭시
router.get('/schedule/daily', (req, res) => {
  // ERP 관리자 세션 또는 픽업 전용 세션 체크
  const isMainAdmin = req.session && req.session.adminId;
  const isPickupAdmin = req.session && req.session.admin;
  
  if (!isMainAdmin && !isPickupAdmin) {
    return res.redirect('/pickup/login');
  }
  
  // 쿼리 파라미터에서 날짜 가져오기 (없으면 오늘 날짜)
  const initialDate = req.query.date || 'today';
  
  res.render('pickup/schedule', { 
    title: 'HKT 픽업 스케줄 조회',
    admin: req.session.admin || { username: req.session.adminUsername || 'admin' },
    initialDate: initialDate
  });
});

// 관리자 스케줄 페이지 (로그인 필요 - ERP 관리자 또는 픽업 관리자) - 달력 화면
router.get('/schedule', (req, res) => {
  // ERP 관리자 세션 또는 픽업 전용 세션 체크
  const isMainAdmin = req.session && req.session.adminId;
  const isPickupAdmin = req.session && req.session.admin;
  
  if (!isMainAdmin && !isPickupAdmin) {
    return res.redirect('/pickup/login');
  }
  
  res.render('pickup/admin', { 
    title: 'HKT 픽업 스케줄 관리',
    admin: req.session.admin || { username: req.session.adminUsername || 'admin' }
  });
});

module.exports = router;
