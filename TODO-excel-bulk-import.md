# TODO: 엑셀 다중 행 일괄 입력 기능 구현

## 🎯 목표
엑셀에서 여러 줄을 복사하여 한 번에 여러 픽업을 등록할 수 있도록 구현

---

## 📋 요구사항

### 1. 엑셀 데이터 형식
```
날짜        시간    호텔      이름    영문명        인원  차량명  차량번호    대여시간  항공편  연락처        비고
2025-02-02  15:00  Hilton   김철수  KIM CHULSU   3    K5     12가3456   3시간    KE111  010-1234-5678  특이사항
2025-02-02  16:00  Nikko    이영희  LEE YOUNGHEE 2    Sonata 34나5678   5시간    KE112  010-2345-6789
```

### 2. 지원해야 할 구분자
- **탭(Tab)**: 엑셀 기본 복사 형식
- **쉼표(,)**: CSV 형식
- **자동 감지**: 첫 줄을 보고 구분자 자동 결정

### 3. 처리 로직
1. textarea에 붙여넣기
2. 줄바꿈으로 분리 (`\n`)
3. 각 줄을 탭 또는 쉼표로 분리
4. 첫 줄이 헤더인지 확인 (선택적)
5. 각 행을 픽업 데이터로 파싱
6. 일괄 INSERT

---

## 🔧 구현 위치

### 파일: `views/pickup/schedule.ejs`

### 수정할 부분:

#### 1. AI 파싱 탭 수정
```html
<div id="aiTab" class="tab-content active">
  <textarea 
    id="aiParseText" 
    class="ai-parse-area" 
    placeholder="엑셀에서 복사한 데이터를 붙여넣으세요...&#10;&#10;지원 형식:&#10;1. 엑셀 복사 (탭 구분)&#10;2. CSV (쉼표 구분)&#10;&#10;예시:&#10;2025-02-02    15:00    Hilton    김철수    3    K5    12가3456    3시간    KE111    010-1234-5678&#10;2025-02-02    16:00    Nikko     이영희    2    Sonata  34나5678    5시간    KE112    010-2345-6789"
  ></textarea>
  <button class="btn-primary" onclick="parseExcelData()">📊 엑셀 데이터 일괄 입력</button>
</div>
```

#### 2. JavaScript 함수 추가

```javascript
async function parseExcelData() {
  const text = document.getElementById('aiParseText').value.trim();
  if (!text) {
    showToast('데이터를 입력해주세요', 'error');
    return;
  }
  
  try {
    // 1. 줄바꿈으로 분리
    const lines = text.split('\n').filter(line => line.trim());
    
    if (lines.length === 0) {
      showToast('유효한 데이터가 없습니다', 'error');
      return;
    }
    
    // 2. 구분자 자동 감지 (탭 우선, 없으면 쉼표)
    const delimiter = lines[0].includes('\t') ? '\t' : ',';
    
    // 3. 각 줄 파싱
    const pickups = [];
    let startIndex = 0;
    
    // 첫 줄이 헤더인지 확인 (날짜 형식이 아니면 헤더)
    if (!/\d{4}-\d{2}-\d{2}/.test(lines[0])) {
      startIndex = 1; // 헤더 건너뛰기
    }
    
    for (let i = startIndex; i < lines.length; i++) {
      const cols = lines[i].split(delimiter).map(col => col.trim());
      
      // 최소 4개 컬럼 필요 (날짜, 시간, 이름, 인원)
      if (cols.length < 4) continue;
      
      pickups.push({
        pickup_date: cols[0] || currentDate,
        pickup_time: cols[1] || '09:00',
        hotel_name: cols[2] || '',
        customer_name: cols[3] || '',
        english_name: cols[4] || '',
        passenger_count: parseInt(cols[5]) || 1,
        rental_vehicle: cols[6] || '',
        rental_number: cols[7] || '',
        rental_duration: cols[8] || '',
        flight_number: cols[9] || '',
        phone: cols[10] || '',
        remark: cols[11] || ''
      });
    }
    
    if (pickups.length === 0) {
      showToast('파싱할 수 있는 데이터가 없습니다', 'error');
      return;
    }
    
    // 4. 확인 후 일괄 등록
    if (!confirm(`${pickups.length}개의 픽업을 등록하시겠습니까?`)) {
      return;
    }
    
    // 5. 순차 등록 (프로그레스 바 표시 가능)
    let successCount = 0;
    let failCount = 0;
    
    for (const pickup of pickups) {
      try {
        const response = await fetch('/pickup/api/manual-pickup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pickup)
        });
        
        if (response.ok) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (error) {
        failCount++;
      }
    }
    
    // 6. 결과 표시
    showToast(`성공: ${successCount}개, 실패: ${failCount}개`);
    
    // 7. 성공한 경우 폼 초기화 및 새로고침
    if (successCount > 0) {
      document.getElementById('aiParseText').value = '';
      loadSchedule(currentDate);
    }
    
  } catch (error) {
    console.error('엑셀 파싱 오류:', error);
    showToast('데이터 파싱 실패', 'error');
  }
}
```

---

## 🎨 UI 개선 (선택사항)

### 프로그레스 바 추가
```html
<div id="uploadProgress" style="display: none;">
  <div class="progress">
    <div class="progress-bar" role="progressbar" style="width: 0%"></div>
  </div>
  <p id="progressText">0/0 완료</p>
</div>
```

---

## 📊 테스트 시나리오

### 테스트 데이터 1: 탭 구분 (엑셀 복사)
```
2025-02-02	15:00	Hilton	김철수	KIM CHULSU	3	K5	12가3456	3시간	KE111	010-1234-5678	VIP고객
2025-02-02	16:00	Nikko	이영희	LEE YOUNGHEE	2	Sonata	34나5678	5시간	KE112	010-2345-6789	
2025-02-02	17:00	Hyatt	박민수	PARK MINSU	4	Avante	56다7890	24시간	KE113	010-3456-7890	짐 많음
```

### 테스트 데이터 2: CSV (쉼표 구분)
```
날짜,시간,호텔,이름,영문명,인원,차량명,차량번호,대여시간,항공편,연락처,비고
2025-02-02,15:00,Hilton,김철수,KIM CHULSU,3,K5,12가3456,3시간,KE111,010-1234-5678,VIP고객
2025-02-02,16:00,Nikko,이영희,LEE YOUNGHEE,2,Sonata,34나5678,5시간,KE112,010-2345-6789,
```

### 예상 결과
- 3개 픽업이 한 번에 등록됨
- 각 픽업이 `airport_pickups` 테이블에 저장
- `record_type = 'manual'`, `pickup_source = 'manual'`
- 성공 메시지: "성공: 3개, 실패: 0개"

---

## 🚀 구현 순서

1. ✅ `views/pickup/schedule.ejs` 파일 열기
2. ✅ AI 파싱 textarea placeholder 수정
3. ✅ `parseExcelData()` 함수 추가
4. ✅ Git commit & push
5. ✅ Railway 배포
6. ✅ 테스트

---

## 💡 추가 기능 아이디어

### 1. 컬럼 매핑 UI
사용자가 컬럼 순서를 선택할 수 있도록:
```
1번 컬럼: [날짜 ▼]
2번 컬럼: [시간 ▼]
3번 컬럼: [호텔 ▼]
...
```

### 2. 미리보기
붙여넣기 후 파싱된 데이터를 테이블로 미리 보여주고 확인 후 등록

### 3. 오류 행 표시
파싱 실패한 행을 빨간색으로 표시

---

## 📝 참고사항

- 엑셀 복사 시 탭으로 구분됨
- CSV는 쉼표로 구분
- 날짜 형식: `YYYY-MM-DD` 또는 `YYYY/MM/DD`
- 시간 형식: `HH:MM` (24시간)
- 빈 셀은 기본값으로 처리

---

## 🎯 완료 체크리스트

- [ ] `parseExcelData()` 함수 구현
- [ ] UI 텍스트 수정
- [ ] 구분자 자동 감지
- [ ] 헤더 행 처리
- [ ] 다중 행 일괄 등록
- [ ] 성공/실패 카운트
- [ ] 오류 처리
- [ ] Git push
- [ ] 배포
- [ ] 테스트

---

**작업 예상 시간**: 30분 ~ 1시간
**난이도**: ⭐⭐⭐ (중간)
**우선순위**: 높음 🔥

내일 출근하시면 이 파일을 참고해서 작업하시면 됩니다! 😊
