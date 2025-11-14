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
    
    // 3. 재고 데이터를 구조화
    const inventoryByHotel = {};
    result.rows.forEach(row => {
      const hotelKey = row.hotel_name;
      if (!inventoryByHotel[hotelKey]) {
        inventoryByHotel[hotelKey] = {
          hotel_id: row.hotel_id,
          hotel_code: row.hotel_code,
          rooms: {}
        };
      }
      
      const roomKey = row.room_type_name;
      if (!inventoryByHotel[hotelKey].rooms[roomKey]) {
        inventoryByHotel[hotelKey].rooms[roomKey] = [];
      }
      
      inventoryByHotel[hotelKey].rooms[roomKey].push({
        date: row.availability_date.toISOString().split('T')[0],
        status: row.status,
        available: row.available_rooms,
        memo: row.memo
      });
    });
    
    // 4. GPT에게 컨텍스트와 함께 질문
    const systemPrompt = `당신은 호텔 객실 예약 전문 상담사입니다.

**현재 호텔 목록:**
${hotels.map(h => `- ${h.hotel_name} (${h.hotel_code}): ${h.inventory_type === 'count' ? '숫자 카운팅' : '상태 표시'} 방식`).join('\n')}

**재고 데이터:**
${JSON.stringify(inventoryByHotel, null, 2)}

**역할 및 규칙:**
1. 제공된 재고 데이터만을 기반으로 답변하세요.
2. 데이터에 없는 날짜나 호텔에 대해서는 "확인이 필요합니다"라고 답하세요.
3. 한국어로 친절하게 답변하세요.
4. 날짜는 YYYY-MM-DD 형식으로 확인하세요.
5. "가능해요", "어려워요", "마감입니다" 등 명확한 표현을 사용하세요.
6. available_rooms가 0이면 마감, 1-4이면 잔여 적음, 5 이상이면 충분함으로 판단하세요.
7. 연박 문의 시 해당 기간의 모든 날짜를 체크하세요.
8. 답변은 3-4문장 이내로 간결하게 작성하세요.

**예시:**
질문: "두짓타니 12월 3일부터 3박 가능해?"
답변: "두짓타니 12월 3일부터 3박(12/3-12/5)은 모든 객실 타입에서 예약 가능합니다! 🎉 디럭스룸 8개, 스위트룸 3개 남아있어요. 어떤 객실 타입을 원하시나요?"

질문: "다음주 하얏트 가능해?"
답변: "다음주 정확한 날짜(예: 11월 20일부터 2박)를 알려주시면 더 정확하게 확인해드릴게요! 😊"`;

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
