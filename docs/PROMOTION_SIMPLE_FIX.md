# ✅ 프로모션 시스템 간단 수정 방안

## 📌 사용자 요구사항

**핵심:**
- 프로모션 등록 UI는 기존 그대로 유지
- 룸타입 하나에 여러 프로모션 저장 가능 (이미 됨!)
- 인박스에서 룸타입 선택 → 프로모션 목록 표시 → 선택
- 기본판매가는 필요 없음

---

## ✅ 현재 DB 구조 (완벽함!)

```sql
promotions
├── id
├── hotel_id
├── promo_code
├── promo_name
├── booking_start_date
├── booking_end_date
├── stay_start_date
└── stay_end_date

promotion_daily_rates (핵심!)
├── id
├── promotion_id
├── room_type_id  ← 한 룸타입에 여러 프로모션 가능!
├── stay_date
├── rate_per_night
└── min_nights
```

**이미 원하는 구조:**
```
Hilton Guam - Deluxe Ocean View
├── 프로모션 A (SUMMER20)
│   └── 2025-06-01 ~ 2025-08-31: $180/박
├── 프로모션 B (EARLYBIRD)
│   └── 2025-06-01 ~ 2025-08-31: $150/박
└── 프로모션 C (LASTMINUTE)
    └── 2025-06-01 ~ 2025-08-31: $200/박
```

---

## 🔧 필요한 작업: API + UI 수정만!

### **1. 신규 API 추가**

#### **A. 룸타입별 프로모션 목록 조회**
```javascript
// GET /api/promotions/room-type/:roomTypeId/rates
// 특정 룸타입 + 투숙일로 적용 가능한 프로모션 조회

요청:
- roomTypeId: 8 (Deluxe Ocean View)
- checkInDate: 2025-06-15
- checkOutDate: 2025-06-18
- nights: 3

응답:
{
  success: true,
  promotions: [
    {
      promotion_id: 1,
      promo_code: "SUMMER20",
      promo_name: "여름 특가",
      total_amount: 540,  // $180 × 3박
      avg_rate: 180,
      dates: [
        { date: "2025-06-15", rate: 180 },
        { date: "2025-06-16", rate: 180 },
        { date: "2025-06-17", rate: 180 }
      ]
    },
    {
      promotion_id: 2,
      promo_code: "EARLYBIRD",
      promo_name: "얼리버드",
      total_amount: 450,  // $150 × 3박
      avg_rate: 150,
      dates: [
        { date: "2025-06-15", rate: 150 },
        { date: "2025-06-16", rate: 150 },
        { date: "2025-06-17", rate: 150 }
      ]
    }
  ]
}
```

---

### **2. 인박스 UI 수정**

#### **기존 워크플로우 (문제)**
```
1. 인박스 파싱
2. 호텔 선택
3. 룸타입 자동 매칭 또는 수동 선택
4. 저장 (프로모션 선택 불가)
```

#### **새로운 워크플로우 (개선)**
```
1. 인박스 파싱
2. 호텔 선택
3. 룸타입 선택
4. 👉 프로모션 선택 (드롭다운)
   ├── API 호출: /api/promotions/room-type/{id}/rates
   ├── 투숙일 기준 적용 가능한 프로모션 목록 표시
   └── 각 프로모션별 총액 표시
5. 프로모션 선택 시 자동으로 총액 계산
6. 저장
```

#### **UI 예시**
```html
<!-- 룸타입 선택 -->
<select id="roomTypeSelect" onchange="loadAvailablePromotions()">
  <option value="">룸타입 선택</option>
  <option value="8">Deluxe Ocean View</option>
  <option value="9">Premier Ocean Front</option>
</select>

<!-- 프로모션 선택 (룸타입 선택 후 표시) -->
<div id="promotionSelectGroup" style="display: none;">
  <label>프로모션 선택</label>
  <select id="promotionSelect" onchange="applyPromotionRate()">
    <option value="">프로모션 없음 (기본 요금)</option>
    <!-- 동적으로 로드 -->
    <option value="1" data-amount="540">
      SUMMER20 - 여름 특가 ($540 for 3 nights)
    </option>
    <option value="2" data-amount="450">
      EARLYBIRD - 얼리버드 ($450 for 3 nights)
    </option>
  </select>
</div>

<!-- 총액 표시 -->
<div class="alert alert-info">
  <strong>총 숙박 요금:</strong> $<span id="totalAmount">0</span>
</div>
```

---

### **3. JavaScript 로직**

```javascript
// 룸타입 선택 시 프로모션 목록 로드
async function loadAvailablePromotions() {
  const roomTypeId = document.getElementById('roomTypeSelect').value;
  const checkIn = document.getElementById('checkInDate').value;
  const checkOut = document.getElementById('checkOutDate').value;
  
  if (!roomTypeId || !checkIn || !checkOut) return;
  
  try {
    const response = await fetch(
      `/api/promotions/room-type/${roomTypeId}/rates?` +
      `checkIn=${checkIn}&checkOut=${checkOut}`
    );
    const data = await response.json();
    
    if (data.success && data.promotions.length > 0) {
      // 프로모션 드롭다운 표시
      renderPromotionDropdown(data.promotions);
      document.getElementById('promotionSelectGroup').style.display = 'block';
    } else {
      document.getElementById('promotionSelectGroup').style.display = 'none';
      alert('선택한 날짜에 적용 가능한 프로모션이 없습니다.');
    }
  } catch (error) {
    console.error('프로모션 로드 오류:', error);
  }
}

// 프로모션 드롭다운 렌더링
function renderPromotionDropdown(promotions) {
  const select = document.getElementById('promotionSelect');
  select.innerHTML = '<option value="">프로모션 없음</option>';
  
  promotions.forEach(promo => {
    const option = document.createElement('option');
    option.value = promo.promotion_id;
    option.dataset.amount = promo.total_amount;
    option.dataset.promoCode = promo.promo_code;
    option.textContent = 
      `${promo.promo_code} - ${promo.promo_name} ($${promo.total_amount} for ${promo.dates.length} nights)`;
    select.appendChild(option);
  });
}

// 프로모션 선택 시 총액 적용
function applyPromotionRate() {
  const select = document.getElementById('promotionSelect');
  const selectedOption = select.options[select.selectedIndex];
  
  if (selectedOption.value) {
    const amount = selectedOption.dataset.amount;
    const promoCode = selectedOption.dataset.promoCode;
    
    // 총액 표시
    document.getElementById('totalAmount').textContent = amount;
    
    // hidden input에 프로모션 정보 저장
    document.getElementById('selectedPromotionId').value = selectedOption.value;
    document.getElementById('selectedPromoCode').value = promoCode;
  } else {
    document.getElementById('totalAmount').textContent = '0';
    document.getElementById('selectedPromotionId').value = '';
    document.getElementById('selectedPromoCode').value = '';
  }
}

// 예약 저장 시
async function saveReservation() {
  const data = {
    hotel_id: document.getElementById('hotelSelect').value,
    room_type_id: document.getElementById('roomTypeSelect').value,
    promotion_id: document.getElementById('selectedPromotionId').value,
    promotion_code: document.getElementById('selectedPromoCode').value,
    check_in_date: document.getElementById('checkInDate').value,
    check_out_date: document.getElementById('checkOutDate').value,
    total_selling_price: document.getElementById('totalAmount').textContent,
    // ... 기타 필드
  };
  
  const response = await fetch('/api/hotel-reservations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  
  // ...
}
```

---

## 🚀 구현 순서

### **Step 1: API 추가 (routes/promotions.js)**
```javascript
// GET /api/promotions/room-type/:roomTypeId/rates
router.get('/api/promotions/room-type/:roomTypeId/rates', async (req, res) => {
  const { roomTypeId } = req.params;
  const { checkIn, checkOut } = req.query;
  
  // 1. 투숙일 배열 생성
  const dates = getDateRange(checkIn, checkOut);
  
  // 2. 해당 룸타입 + 날짜에 해당하는 프로모션 조회
  const query = `
    SELECT DISTINCT
      p.id as promotion_id,
      p.promo_code,
      p.promo_name,
      p.booking_start_date,
      p.booking_end_date,
      p.stay_start_date,
      p.stay_end_date
    FROM promotions p
    WHERE p.is_active = true
      AND p.booking_start_date <= CURRENT_DATE
      AND p.booking_end_date >= CURRENT_DATE
      AND p.stay_start_date <= $1
      AND p.stay_end_date >= $2
      AND EXISTS (
        SELECT 1 FROM promotion_daily_rates pdr
        WHERE pdr.promotion_id = p.id
          AND pdr.room_type_id = $3
          AND pdr.stay_date = ANY($4)
      )
  `;
  
  // 3. 각 프로모션별로 날짜별 요금 조회 및 총액 계산
  // ...
});
```

### **Step 2: 인박스 UI 수정 (views/admin/inbox.ejs)**
```html
<!-- 프로모션 선택 섹션 추가 -->
<div class="mb-3">
  <label class="form-label">프로모션 선택</label>
  <select class="form-select" id="promotionSelect" onchange="applyPromotionRate()">
    <option value="">프로모션 없음</option>
  </select>
  <input type="hidden" id="selectedPromotionId">
  <input type="hidden" id="selectedPromoCode">
</div>
```

### **Step 3: 테스트**
1. 프로모션 등록 (기존 방식)
2. 인박스에서 룸타입 선택
3. 프로모션 목록 표시 확인
4. 프로모션 선택 후 총액 계산 확인
5. 예약 저장 확인

---

## ✅ 장점

1. **DB 재설계 불필요**: 현재 구조 그대로 사용
2. **프로모션 등록 UI 유지**: 기존 작업 방식 그대로
3. **간단한 수정**: API 1개 + UI 수정만
4. **유연한 운영**: 룸타입당 무제한 프로모션 등록 가능
5. **직관적인 UX**: 프로모션 선택 시 총액 즉시 표시

---

## 📋 작업 예상 시간

- **API 개발**: 1-2시간
- **인박스 UI 수정**: 1-2시간
- **테스트**: 30분

**총 소요 시간: 약 3-4시간**

---

**작성일**: 2025-01-20  
**작성자**: Cascade AI
