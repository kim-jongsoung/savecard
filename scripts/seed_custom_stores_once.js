// One-time seeding of custom partner stores
// Usage: node scripts/seed_custom_stores_once.js
require('dotenv').config();
const { Pool } = require('pg');

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  const items = [
    { name: "민즈 오사카 마트 (Min's Osaka Mart)", location: '투몬', discount: '10% 할인. 담배 및 주류 품목은 할인에서 제외됩니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: '셀프픽스 카페 (Safpix Café)', location: '투몬', discount: '결제 금액 $20당 무료 음료 1잔이 제공됩니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: '돈키호테 (Don Don Donki Guam)', location: '타무닝', discount: '$50 이상 결제 시 5% 할인이 적용됩니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: '아이스 우나 괌 (i e Una Guam)', location: '투몬', discount: '전체 금액 10% 할인이 적용됩니다. $80 이상 구매 시 5% 할인 및 랜덤 선물(열쇠고리, 에코백 등)이 제공됩니다. 서비스 차지 및 추가 비용은 현장에서 청구될 수 있습니다. 혜택 이용 시 결제 전 디지털 괌 세이브 카드를 직원에게 확인해야 합니다. 주문 후 카드를 제시하는 경우 혜택을 받을 수 없습니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: '인퓨전 커피&티 DFS (Infusion Coffee & Tea)', location: '투몬', discount: '음료만 10% 할인이 적용됩니다. 음식 및 소매품은 할인 혜택에서 제외됩니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: '하팔로하 (Hafaloha)', location: '투몬', discount: '메인 메뉴 구매 시 테이블 및 결제당 전체 금액 15% 할인이 적용됩니다. 다른 할인 및 프로모션과 중복 할인은 불가능하며, 연속 혜택 사용도 불가능합니다.' },
    { name: '고메 괌 (Gourmet Guam)', location: '타무닝', discount: '10% 할인. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: '이자카야 바이 지미 (EZ-KAYA BY JIMMY)', location: '투몬', discount: '5% 할인이 적용됩니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: '카페 치노 (Caffe Cino)', location: '힐튼 괌', discount: '10% 할인과 함께 룸피아 또는 교자 1개가 제공됩니다. 혜택은 하루 1번, 주문 1번으로 제한됩니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: "뉴 초이 레스토랑 (New Choi's Restaurant)", location: '타무닝', discount: '$40 이상 결제 시 5% 할인이 적용됩니다. 식사, 음료, 주류 모두 할인 적용됩니다. 메인 메뉴당 밥 1공기와 기본 반찬이 제공됩니다. 혜택 제공 시간은 16:30~21:30입니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: '치킨 펍 & 카페 (Chicken Pub & Cafe)', location: '투몬', discount: '$45 이상 결제 시 아이스 커피 2잔이 제공됩니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: '피카 (Manang Pika)', location: '타무닝', discount: '10% 할인. 주류 품목은 할인에서 제외됩니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: "부니스 바케이드 앤 비스트로 (Binnie's Barkede N Bistro)", location: '투몬', discount: '메인 메뉴 주문 시 음료 1잔이 제공됩니다. $30 이상 결제 시 5% 할인이 추가로 적용되며, 이 혜택은 중복 가능합니다. 전체 결제 금액에 주류 포함 할인 혜택이 적용됩니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: 'CRC 루프탑 (CRC Rooftop)', location: '투몬', discount: '저녁 식사 메뉴 주문 시 노래방 이용 50% 할인이 적용됩니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: '블레이즈 레스토랑 & 바 (Blaze Restaurant & Bar)', location: '투몬', discount: '전체 금액 10% 할인이 적용됩니다. 해피 아워 타임의 음식, 음료, 주류 할인 혜택은 제외됩니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: '차모로 바베큐 & 씨푸드 (Chamorro BBQ & Seafood)', location: '투몬', discount: '전체 결제 금액 10% 할인이 적용됩니다 (생참치 제외). 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: '모두의 분식 (BRINGIK)', location: '타무닝', discount: '10% 할인. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: '청담 (Cheong Dam)', location: '투몬', discount: '10% 할인. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: "민즈 라운지 (Min's Lounge)", location: '투몬', discount: '주류 및 음료 10% 할인이 적용됩니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: 'K-치킨 (K-Chicken)', location: '타무닝', discount: '$25 이상 결제 시 음료 1잔이 제공됩니다. 매장 식사, 테이크아웃 모두 혜택 가능합니다. 배달 주문 시 호텔 위치에 따라 혜택이 상이할 수 있습니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: '타코스 시날로아 (Tacos Sinaloa)', location: '투몬', discount: '전체 금액 15% 할인이 적용됩니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: 'K-라멘 (K-Ramen)', location: '투몬', discount: '라멘 1인분 주문 시 콜라 1잔이 무료로 제공됩니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: 'A & L Foods (A&L Foods)', location: '야시장 / 차모로 빌리지', discount: '10% 할인. 카드 소지자 및 테이블당 매장 식사 또는 테이크아웃이 가능합니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: "Loida's Foods (Loite's Foods)", location: '스키너 플라자 푸드 트럭 나이트 / 데데도', discount: '10% 할인이 적용됩니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: '마루가메 우동 (Marugame Udon)', location: '타무닝', discount: '10% 할인이 적용됩니다. 11세 미만 아동에게는 메인 메뉴 주문 시 과일 주스가 무료로 제공됩니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: '올리브 가든 (Olive Garden)', location: '데데도 야시장 / 차모로 빌리지', discount: '10% 할인. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: '와카 사쿠라 스시 (Waka Sakura Sushi)', location: '스키너 플라자 푸드 트럭 나이트 / 데데도', discount: '무료 3피스 셰프 오마카세 세트가 제공됩니다. 가족당 1세트, 매장 방문 식사/결제가 필수입니다. 괌 구매 확인 이메일과 괌 세이브 카드를 제시해야 하며, 캡처본은 불가합니다. 재료나 양은 변동될 수 있고, 재고 소진 시 일시 중단될 수 있습니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: '라이스 & 라멘 (Rice & Ramen)', location: '투몬', discount: '10% 할인이 적용됩니다. 매장 식사 시 식음료에 한해 할인 적용됩니다. 주류 및 맥주는 할인 적용에서 제외됩니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: "애플비 (Applebee's)", location: '타무닝', discount: '10% 할인. 매장 식사 시 식음료에 한해 할인 적용됩니다. 주류 및 맥주는 할인 적용에서 제외됩니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: '파이올로지 (Pieology)', location: '타무닝', discount: '10% 할인. 매장 식사 시 식음료에 한해 할인 적용됩니다. 주류 및 맥주는 할인 적용에서 제외됩니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: '롱혼 스테이크하우스 (Longhorn Steakhouse)', location: '아갓간', discount: '10% 할인. 매장 식사 시 식음료에 한해 할인 적용됩니다. 주류 및 맥주는 할인 적용에서 제외됩니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: '아지 라멘 (Ajisen Ramen)', location: '타무닝', discount: '5% 할인이 적용됩니다. 매장 식사 시 식음료에 한해 할인 적용됩니다. 주류 및 맥주는 할인 적용에서 제외됩니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: '아이홉 (IHOP)', location: '투몬', discount: '10% 할인. 매장 식사 시 식음료에 한해 할인 적용됩니다. 주류 및 맥주는 할인 적용에서 제외됩니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: '마우이 타코스 (Maui Tacos)', location: '타무닝', discount: '10% 할인. 매장 식사 또는 테이크아웃 시 식음료에 한해 할인 적용됩니다. 주류 및 맥주는 할인 적용에서 제외됩니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: "피셔맨즈 코브 (Fisherman's Cove)", location: '힐튼 괌', discount: '10% 할인. 식사, 음료, 주류 모두 할인 적용됩니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: '텐쥬도 스파 (Tenjudo Spa)', location: '투몬', discount: '이용객 1인당 $5 할인이 적용됩니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: "탈라포포 폴즈 리조트 (Talofofo Fall's Resort Park)", location: '탈라포포', discount: '성인 입장료 $5 할인이 적용됩니다. 탈로포포 야외 사격 갤러리 입장료 $10 면제와 리조트 파크 내 짚라인 아동 및 성인 $5 할인이 제공됩니다. 예약 없이 방문할 수 있습니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: '아일렌더 테라스 (Islander Terrace)', location: '힐튼 괌', discount: '10% 할인. 식사, 음료, 주류 모두 할인 적용됩니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: "로이즈 (Roy's)", location: '힐튼 괌', discount: '10% 할인. 식사, 음료, 주류 모두 할인 적용됩니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: '트리 바 (Tree Bar)', location: '힐튼 괌', discount: '10% 할인. 식사, 음료, 주류 모두 할인 적용됩니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
    { name: '쉘 주유소 (Shell)', location: '투몬', discount: '주유 6% 할인이 적용됩니다. 괌 전 지역에서 사용 가능합니다. 다른 할인 및 프로모션과 중복 할인은 불가능합니다.' },
  ];

  let updated = 0;
  let inserted = 0;

  try {
    for (const s of items) {
      const name = (s.name || '').trim();
      if (!name) continue;
      const location = s.location || null;
      const discount = s.discount || null;

      const up = await pool.query(
        `UPDATE stores
         SET discount = $2, location = $3, is_active = true, updated_at = CURRENT_TIMESTAMP
         WHERE LOWER(name) = LOWER($1)`,
        [name, discount, location]
      );

      if (up.rowCount > 0) {
        updated += up.rowCount;
        continue;
      }

      await pool.query(
        `INSERT INTO stores (name, category, discount, location, is_active, usage_count)
         VALUES ($1, $2, $3, $4, true, 0)`,
        [name, null, discount, location]
      );
      inserted += 1;
    }

    console.log(`완료: 업데이트 ${updated}건, 신규 ${inserted}건`);
  } catch (err) {
    console.error('에러:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
