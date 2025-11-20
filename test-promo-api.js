const axios = require('axios');

async function testAPI() {
  try {
    const roomTypeId = 4; // 디럭스오션프론트
    const checkIn = '2026-01-05';
    const checkOut = '2026-01-07';
    
    const url = `http://localhost:3000/api/promotions/room-type/${roomTypeId}/rates?checkIn=${checkIn}&checkOut=${checkOut}`;
    
    console.log('🔍 API 테스트 중...');
    console.log('URL:', url);
    console.log('');
    
    const response = await axios.get(url);
    
    console.log('📊 응답 상태:', response.status);
    console.log('📊 응답 데이터:', JSON.stringify(response.data, null, 2));
    
    if (response.data.success && response.data.promotions) {
      console.log(`\n✅ 프로모션 ${response.data.promotions.length}개 발견!`);
      response.data.promotions.forEach(p => {
        console.log(`  💰 ${p.promo_code}: $${p.total_amount} (${p.nights}박)`);
      });
    } else {
      console.log('\n❌ 프로모션 없음:', response.data.message);
    }
    
  } catch (error) {
    console.error('❌ API 호출 오류:', error.message);
    if (error.response) {
      console.error('   응답 상태:', error.response.status);
      console.error('   응답 데이터:', error.response.data);
    }
  }
}

testAPI();
