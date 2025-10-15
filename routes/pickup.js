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
      `SELECT flight_number, departure_time, arrival_time, flight_hours 
       FROM pickup_flights 
       WHERE is_active = true`
    );
    
    const flights = {};
    result.rows.forEach(f => {
      flights[f.flight_number] = {
        time: f.departure_time?.substring(0, 5) || '00:00',
        arrival_time: f.arrival_time?.substring(0, 5) || '00:00',
        hours: parseFloat(f.flight_hours) || 4
      };
    });
    
    FLIGHTS_CACHE = flights;
    FLIGHTS_LAST_LOAD = Date.now();
    return flights;
  } catch (error) {
    console.error('❌ 항공편 로드 실패:', error);
    // 실패 시 기본값 사용
    return {
      'KE111': { time: '07:30', arrival_time: '12:30', hours: 4 },
      'KE123': { time: '22:00', arrival_time: '03:00', hours: 4 },
      'OZ456': { time: '10:00', arrival_time: '15:00', hours: 4 },
      'OZ789': { time: '15:30', arrival_time: '20:30', hours: 4 },
      'UA873': { time: '13:20', arrival_time: '18:20', hours: 4 }
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

// API: 픽업 생성
router.post('/api/create', async (req, res) => {
  const pool = req.app.locals.pool;
  const { 
    pickup_type, agency_id, 
    kr_departure_date, kr_flight_number,
    customer_name, passenger_count, hotel_name,
    phone, kakao_id, memo,
    adult_count, child_count, infant_count, luggage_count
  } = req.body;
  
  try {
    const FLIGHTS = await getFlights(pool);
    
    let data = {
      pickup_type, agency_id,
      customer_name, hotel_name,
      phone, kakao_id, memo,
      adult_count: adult_count || 0,
      child_count: child_count || 0,
      infant_count: infant_count || 0,
      luggage_count: luggage_count || 0,
      passenger_count: (adult_count || 0) + (child_count || 0) + (infant_count || 0)
    };
    
    // 공항→호텔 또는 왕복
    if (pickup_type === 'airport_to_hotel' || pickup_type === 'roundtrip') {
      const flight = FLIGHTS[kr_flight_number];
      if (!flight) {
        return res.status(400).json({ error: '비행편 정보를 찾을 수 없습니다' });
      }
      
      const arrival = calculateArrival(kr_departure_date, flight.time, kr_flight_number, FLIGHTS);
      data.kr_departure_date = kr_departure_date;
      data.kr_departure_time = flight.time;
      data.kr_flight_number = kr_flight_number;
      data.guam_arrival_date = arrival.date;
      data.guam_arrival_time = arrival.time;
    }
    
    // 호텔→공항 또는 왕복
    if (pickup_type === 'hotel_to_airport' || pickup_type === 'roundtrip') {
      const { guam_departure_date, departure_flight_number } = req.body;
      const flight = FLIGHTS[departure_flight_number];
      if (!flight) {
        return res.status(400).json({ error: '출발 비행편 정보를 찾을 수 없습니다' });
      }
      
      const pickup = calculateHotelPickup(guam_departure_date, flight.time);
      data.guam_departure_date = guam_departure_date;
      data.guam_departure_time = flight.time;
      data.departure_flight_number = departure_flight_number;
      data.hotel_pickup_date = pickup.date;
      data.hotel_pickup_time = pickup.time;
      data.is_early_morning = pickup.isEarlyMorning;
    }
    
    const columns = Object.keys(data).join(', ');
    const values = Object.values(data);
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    
    const result = await pool.query(
      `INSERT INTO airport_pickups (${columns}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    
    res.json({ success: true, data: result.rows[0] });
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

// API: 예약 수정
router.put('/api/:id', async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  const { customer_name, passenger_count, hotel_name, phone, kakao_id, memo } = req.body;
  
  try {
    const result = await pool.query(
      `UPDATE airport_pickups 
       SET customer_name = $1, passenger_count = $2, hotel_name = $3,
           phone = $4, kakao_id = $5, memo = $6, updated_at = NOW()
       WHERE id = $7 RETURNING *`,
      [customer_name, passenger_count, hotel_name, phone, kakao_id, memo, id]
    );
    
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('❌ 예약 수정 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 예약 취소
router.delete('/api/:id', async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  
  try {
    await pool.query(
      `UPDATE airport_pickups SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [id]
    );
    
    res.json({ success: true });
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
    res.json(result.rows);
  } catch (error) {
    console.error('❌ 업체 조회 실패:', error);
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
  const { agency_name, contact_person, phone, email, is_active } = req.body;
  
  try {
    const result = await pool.query(
      `INSERT INTO pickup_agencies (agency_name, contact_person, phone, email, is_active)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [agency_name, contact_person, phone, email, is_active !== false]
    );
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
  const { agency_name, contact_person, phone, email, is_active } = req.body;
  
  try {
    const result = await pool.query(
      `UPDATE pickup_agencies 
       SET agency_name = $1, contact_person = $2, phone = $3, email = $4, is_active = $5
       WHERE id = $6 RETURNING *`,
      [agency_name, contact_person, phone, email, is_active, id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('❌ 업체 수정 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: 업체 삭제
router.delete('/api/agencies/:id', async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  
  try {
    await pool.query(`DELETE FROM pickup_agencies WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ 업체 삭제 실패:', error);
    res.status(500).json({ error: error.message });
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
           departure_airport = $6, arrival_airport = $7, days_of_week = $8, notes = $9, is_active = $10, updated_at = NOW()
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

// API: 항공편 삭제
router.delete('/api/flights/:id', async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  
  try {
    await pool.query(`DELETE FROM pickup_flights WHERE id = $1`, [id]);
    
    // 캐시 갱신
    await loadFlightsFromDB(pool);
    
    res.json({ success: true });
  } catch (error) {
    console.error('❌ 항공편 삭제 실패:', error);
    res.status(500).json({ error: error.message });
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

// API: 월별 예약 조회 (달력용 - 전체 예약 목록 포함)
router.get('/api/calendar', async (req, res) => {
  const pool = req.app.locals.pool;
  const { year, month } = req.query;
  
  try {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month).padStart(2, '0')}-31`;
    
    // 공항 픽업 (도착일 기준)
    const arrivals = await pool.query(`
      SELECT 
        ap.*,
        pa.agency_name
      FROM airport_pickups ap
      LEFT JOIN pickup_agencies pa ON ap.agency_id = pa.id
      WHERE ap.guam_arrival_date BETWEEN $1 AND $2
        AND ap.pickup_type IN ('airport_to_hotel', 'roundtrip')
        AND ap.status = 'active'
      ORDER BY ap.guam_arrival_date, ap.guam_arrival_time
    `, [startDate, endDate]);
    
    // 호텔 픽업 (픽업일 기준)
    const departures = await pool.query(`
      SELECT 
        ap.*,
        pa.agency_name
      FROM airport_pickups ap
      LEFT JOIN pickup_agencies pa ON ap.agency_id = pa.id
      WHERE ap.hotel_pickup_date BETWEEN $1 AND $2
        AND ap.pickup_type IN ('hotel_to_airport', 'roundtrip')
        AND ap.status = 'active'
      ORDER BY ap.hotel_pickup_date, ap.hotel_pickup_time
    `, [startDate, endDate]);
    
    res.json({ arrivals: arrivals.rows, departures: departures.rows });
  } catch (error) {
    console.error('❌ 달력 조회 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
