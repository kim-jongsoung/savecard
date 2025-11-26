# 호텔 정산 관리 시스템 개발 TODO

## 📅 작업 일정: 2025년 11월 27일

---

## 🎯 목표
호텔 예약의 정산 관리 시스템 구축 (수배관리 → 정산관리 워크플로우 완성)

---

## 📋 개발 항목

### 1. 데이터베이스 설계
- [ ] `hotel_settlements` 테이블 생성
  - 예약 ID 연결
  - 거래액, 매입액, 환율, 마진 등
  - 입금일, 송금일
  - 정산 상태 (pending, completed)
  
### 2. 백엔드 API 개발
- [ ] `routes/hotel-settlements.js` 생성
  - GET `/api/hotel-settlements` - 정산 목록 조회
  - POST `/api/hotel-settlements/transfer` - 정산 이관
  - POST `/api/hotel-settlements/bulk-payment` - 일괄 입금/송금 처리
  - PUT `/api/hotel-settlements/:id` - 정산 정보 수정
  - DELETE `/api/hotel-settlements/:id` - 정산 삭제

### 3. 프론트엔드 개발
- [ ] `views/admin/hotel-settlements.ejs` 생성
  - 미완료/완료 탭
  - 정산 목록 테이블
  - 검색 및 필터 기능
  - 일괄 처리 버튼
  - 정산 상세/수정 모달

### 4. 통합 작업
- [ ] `server-postgresql.js`에 라우트 연결
- [ ] 수배관리 페이지에서 정산 이관 버튼 추가
- [ ] 상태 흐름 연결 (voucher → settlement)

### 5. 테스트
- [ ] 정산 이관 테스트
- [ ] 입금/송금 처리 테스트
- [ ] 금액 계산 로직 검증
- [ ] 상태 변경 테스트

---

## 📚 참고 자료

### 기존 커밋 참고
- **커밋**: bf56e9b
- **파일들**:
  - `routes/hotel-settlements.js`
  - `migrations/recreate-hotel-settlements.js`
  - `views/admin/hotel-reservation-modal.ejs`

### 기존 시스템 참고
- 투어 정산: `views/admin/settlements.ejs`
- 투어 정산 API: `routes/settlements.js` (있다면)

### 데이터 흐름
```
예약관리 (pending)
  ↓
수배관리 (processing → confirmed)
  ↓
바우처 전송 (voucher)
  ↓
정산관리 (settlement → completed)
```

---

## 💡 개발 시 고려사항

1. **금액 계산**
   - 거래액 (판매가)
   - 매입액 (호텔 지불액)
   - 수배피 (agency_fee)
   - 환율 적용
   - 마진 및 부가세 계산

2. **상태 관리**
   - 정산 이관 시 예약 상태 변경
   - 입금/송금 완료 시 정산 상태 변경
   - 되돌리기 기능 고려

3. **UI/UX**
   - 기존 투어 정산 페이지와 일관성 유지
   - 일괄 처리 기능
   - 업체별 필터링
   - 날짜 범위 검색

4. **권한 관리**
   - 정산 관리는 관리자만 접근
   - 일반 직원은 조회만 가능

---

## ✅ 완료 조건

- [ ] 수배관리에서 정산 이관 가능
- [ ] 정산 목록 조회 및 필터링 작동
- [ ] 입금/송금 일괄 처리 작동
- [ ] 정산 정보 수정 가능
- [ ] 금액 계산 정확성 검증
- [ ] 실서버 배포 및 테스트 완료

---

## 🚀 다음 단계 (향후)

- 정산서 PDF 생성
- 월별 정산 통계
- 업체별 정산 리포트
- 자동 환율 적용
- 정산 알림 기능
