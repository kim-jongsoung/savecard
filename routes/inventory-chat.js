const express = require('express');
const router = express.Router();
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ==========================================
// 챗봇 API - 재고 기반 질의응답
// POST /api/inventory/chat
// ==========================================
router.post('/api/inventory/chat', async (req, res) => {
  const pool = req.app.locals.pool;
  const { message, hotelId } = req.body;
  
  try {
    console.log('💬 챗봇 질문:', message, '호텔ID:', hotelId);
    
    // 1. 현재 재고 데이터 조회
    const today = new Date();
    const threeMonthsLater = new Date(today);
    threeMonthsLater.setMonth(threeMonthsLater.getMonth() + 3);
    
    let query = `
      SELECT 
        h.id as hotel_id,
        h.hotel_name,
        h.hotel_code,
        rt.id as room_type_id,
        rt.room_type_name,
        rt.room_type_code,
        ra.availability_date,
        ra.status,
        ra.available_rooms,
        ra.memo
      FROM room_availability ra
      LEFT JOIN room_types rt ON ra.room_type_id = rt.id
      LEFT JOIN hotels h ON rt.hotel_id = h.id
      WHERE ra.availability_date >= $1 
        AND ra.availability_date <= $2
        AND h.is_active = true
        AND rt.is_active = true
    `;
    
    const params = [
      today.toISOString().split('T')[0],
      threeMonthsLater.toISOString().split('T')[0]
    ];
    
    // 특정 호텔 선택된 경우
    if (hotelId) {
      query += ` AND h.id = $3`;
      params.push(hotelId);
    }
    
    query += ` ORDER BY h.hotel_name, rt.room_type_name, ra.availability_date`;
    
    const result = await pool.query(query, params);
    console.log(`📊 재고 데이터 ${result.rows.length}개 조회`);
    
    // 2. 호텔 정보 조회
    const hotelsResult = await pool.query(`
      SELECT id, hotel_name, hotel_code, inventory_type 
      FROM hotels 
      WHERE is_active = true
      ORDER BY hotel_name
    `);
    const hotels = hotelsResult.rows;
    
    // 3. 재고 데이터를 GPT가 읽기 쉬운 형식으로 변환
    const inventorySummary = [];
    const inventoryMap = {};
    
    result.rows.forEach(row => {
      const dateStr = row.availability_date.toISOString().split('T')[0];
      const key = `${row.hotel_name}|${row.room_type_name}|${dateStr}`;
      inventoryMap[key] = row.available_rooms;
      
      inventorySummary.push({
        호텔: row.hotel_name,
        객실타입: row.room_type_name,
        날짜: dateStr,
        가능객실수: row.available_rooms,
        상태: row.available_rooms >= 5 ? '충분' : row.available_rooms > 0 ? '잔여적음' : '마감'
      });
    });
    
    // 호텔별로 그룹화하여 간결한 텍스트 생성
    const hotelGroups = {};
    result.rows.forEach(row => {
      const hotelName = row.hotel_name;
      if (!hotelGroups[hotelName]) {
        hotelGroups[hotelName] = [];
      }
      hotelGroups[hotelName].push({
        객실: row.room_type_name,
        날짜: row.availability_date.toISOString().split('T')[0],
        수량: row.available_rooms
      });
    });
    
    // 간결한 텍스트 형식으로 변환 (날짜별로 그룹화)
    let inventoryText = '';
    Object.keys(hotelGroups).forEach(hotelName => {
      inventoryText += `\n### ${hotelName}\n`;
      
      // 날짜별로 그룹화
      const dateGroups = {};
      hotelGroups[hotelName].forEach(item => {
        if (!dateGroups[item.날짜]) {
          dateGroups[item.날짜] = [];
        }
        dateGroups[item.날짜].push(`${item.객실} ${item.수량}개`);
      });
      
      // 날짜 순으로 정렬
      const sortedDates = Object.keys(dateGroups).sort();
      sortedDates.forEach(date => {
        inventoryText += `- **${date}**: ${dateGroups[date].join(', ')}\n`;
      });
    });
    
    // 4. GPT에게 컨텍스트와 함께 질문
    const systemPrompt = `당신은 호텔 객실 예약 전문 상담사입니다.

**현재 호텔 목록:**
${hotels.map(h => `- ${h.hotel_name}`).join('\n')}

**재고 데이터:**
${inventoryText}

**중요 규칙:**
1. 위 재고 데이터에서 호텔명과 날짜를 찾아서 답변하세요.
2. 숫자가 5개 이상이면 "충분히 가능합니다", 1-4개면 "잔여 적음", 0개면 "마감"으로 답변하세요.
3. 연박 문의는 각 날짜의 재고를 모두 확인하세요.
4. 재고 데이터에 해당 날짜가 있으면 적극적으로 답변하세요.
5. 정말 데이터가 없는 경우에만 "확인이 필요합니다"라고 하세요.
6. 한국어로 친절하고 간결하게 (3-4문장) 답변하세요.

**올바른 답변 예시:**
질문: "두짓타니 12월 3일 가능해?"
(데이터에 2025-12-03: 8개 있음)
답변: "네, 두짓타니 12월 3일은 예약 가능합니다! 😊 디럭스룸 8개 남아있어서 충분히 여유롭습니다."

질문: "하얏트 11월 20일부터 2박 가능해?"
(데이터에 2025-11-20: 3개, 2025-11-21: 5개 있음)
답변: "하얏트 11월 20일부터 2박은 가능합니다! 20일은 잔여 3개로 적지만, 21일은 5개로 여유있습니다. 빠른 예약을 추천드려요!"`;

    console.log('📝 GPT 프롬프트 길이:', systemPrompt.length, '글자');
    console.log('📊 전송하는 재고 데이터 샘플:', inventoryText.substring(0, 500));

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ],
      temperature: 0.7,
      max_tokens: 500
    });

    const reply = completion.choices[0].message.content;
    console.log('🤖 GPT 응답:', reply);

    res.json({ 
      success: true, 
      reply,
      dataSource: {
        totalRecords: result.rows.length,
        dateRange: `${params[0]} ~ ${params[1]}`,
        hotelsIncluded: Object.keys(inventoryByHotel).length
      }
    });

  } catch (error) {
    console.error('❌ 챗봇 오류:', error);
    
    // OpenAI API 오류 처리
    if (error.code === 'insufficient_quota') {
      return res.json({
        success: true,
        reply: '죄송합니다. AI 서비스가 일시적으로 이용 불가합니다. 💬\n\n직접 재고 현황 표를 확인하시거나, 전화로 문의해주세요!\n☎️ 010-XXXX-XXXX'
      });
    }
    
    res.status(500).json({ 
      error: error.message,
      reply: '죄송합니다. 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
    });
  }
});

module.exports = router;
