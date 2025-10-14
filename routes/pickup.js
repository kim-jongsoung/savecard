const express = require('express');
const router = express.Router();

// 비행편 데이터
const FLIGHTS = {
  'KE111': { time: '07:30', hours: 4 },
  'KE123': { time: '22:00', hours: 4 },
  'OZ456': { time: '10:00', hours: 4 },
  'OZ789': { time: '15:30', hours: 4 },
  'UA873': { time: '13:20', hours: 4 },
  'OZ678': { time: '11:00', hours: 3 } // 도쿄발
};

// 날짜/시간 계산 헬퍼
function calculateArrival(krDate, krTime, flightNum) {
  const flight = FLIGHTS[flightNum];
  if (!flight) return null;
  
  const krDateTime = new Date(`${krDate}T${krTime}:00+09:00`);
  const guamDateTime = new Date(krDateTime);
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
    phone, kakao_id, memo
  } = req.body;
  
  try {
    let data = {
      pickup_type, agency_id,
      customer_name, passenger_count, hotel_name,
      phone, kakao_id, memo
    };
    
    // 공항→호텔 또는 왕복
    if (pickup_type === 'airport_to_hotel' || pickup_type === 'roundtrip') {
      const flight = FLIGHTS[kr_flight_number];
      if (!flight) {
        return res.status(400).json({ error: '비행편 정보를 찾을 수 없습니다' });
      }
      
      const arrival = calculateArrival(kr_departure_date, flight.time, kr_flight_number);
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

// API: 업체 목록
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

// API: 비행편 자동완성 데이터
router.get('/api/flights', (req, res) => {
  res.json(FLIGHTS);
});

module.exports = router;
