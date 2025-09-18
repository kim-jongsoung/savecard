# 괌세이브카드 예약 파싱 검수형 백엔드

Node.js(Express) + PostgreSQL + Railway 환경에서 운영되는 예약 파싱 검수형 시스템입니다.

## 🏗️ 시스템 구조

### 데이터베이스 테이블
- `reservation_drafts`: 파싱 결과 임시 저장 및 검수용
- `reservations`: 최종 승인된 예약 데이터

### 처리 흐름
1. **파싱**: OpenAI API로 원본 텍스트 → JSON 변환
2. **정규화**: 데이터 형식 표준화 및 검증
3. **검수**: 운영자가 수동으로 데이터 확인/수정
4. **커밋**: 최종 검증 후 예약 테이블에 저장

## 🔧 환경 설정

### 필수 환경변수 (.env)
```bash
# OpenAI API 설정
OPENAI_API_KEY=sk-your-openai-api-key-here

# 데이터베이스 설정 (Railway PostgreSQL)
DATABASE_URL=postgresql://username:password@host:port/database

# API 인증 키
API_KEY=your-secret-api-key

# 서버 포트
PORT=3000

# 환경 설정
NODE_ENV=production
```

### Railway 환경변수 설정
Railway 대시보드에서 다음 변수들을 설정하세요:
- `OPENAI_API_KEY`: OpenAI API 키
- `DATABASE_URL`: Railway에서 자동 제공
- `API_KEY`: API 인증용 비밀키
- `PORT`: Railway에서 자동 설정

## 📦 설치 및 실행

### 로컬 개발
```bash
# 의존성 설치
npm install

# 환경변수 설정
cp env.example .env
# .env 파일을 편집하여 실제 값 입력

# 개발 서버 실행
node server-drafts.js
```

### Railway 배포
```bash
# Git 저장소에 푸시
git add .
git commit -m "Deploy drafts system"
git push

# Railway에서 자동 배포됨
```

## 🔌 API 엔드포인트

모든 API 요청에는 `Authorization: Bearer {API_KEY}` 헤더가 필요합니다.

### 1. 예약 텍스트 파싱
```http
POST /parse
Content-Type: application/json
Authorization: Bearer your-api-key

{
  "rawText": "예약 원본 텍스트..."
}
```

**응답:**
```json
{
  "success": true,
  "draft_id": 123,
  "confidence": 0.95,
  "extracted_notes": "모든 필수 정보가 명확함",
  "parsed_data": { ... },
  "normalized_data": { ... }
}
```

### 2. 드래프트 조회
```http
GET /drafts/{draft_id}
Authorization: Bearer your-api-key
```

### 3. 드래프트 수정
```http
PUT /drafts/{draft_id}
Content-Type: application/json
Authorization: Bearer your-api-key

{
  "manual_json": {
    "korean_name": "수정된 이름",
    "memo": "추가 메모 내용"
  }
}
```

### 4. 드래프트 커밋 (최종 예약 생성)
```http
POST /drafts/{draft_id}/commit
Authorization: Bearer your-api-key
```

### 5. 예약 목록 조회
```http
GET /bookings?page=1&limit=20&status=confirmed&search=김철수
Authorization: Bearer your-api-key
```

### 6. 예약 상세 조회
```http
GET /bookings/{booking_id}
Authorization: Bearer your-api-key
```

### 7. 예약 수정
```http
PATCH /bookings/{booking_id}
Content-Type: application/json
Authorization: Bearer your-api-key

{
  "korean_name": "수정된 이름",
  "total_amount": 350.00
}
```

### 8. 예약 취소
```http
DELETE /bookings/{booking_id}
Authorization: Bearer your-api-key
```

## 🧪 테스트

### 통합 테스트 실행
```bash
# 서버가 실행 중인 상태에서
node testDrafts.js
```

테스트는 다음 시나리오를 실행합니다:
1. NOL 인터파크 예약 텍스트 파싱
2. KLOOK 예약 텍스트 파싱  
3. Viator 예약 텍스트 파싱
4. 각각에 대해 드래프트 생성 → 수정 → 커밋 → 조회
5. 예약 목록 조회

### 수동 테스트 시나리오

#### 시나리오 1: 기본 파싱 테스트
```bash
curl -X POST http://localhost:3000/parse \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"rawText": "예약번호: 123456\n상품: 괌 투어\n예약자: 김철수"}'
```

#### 시나리오 2: 드래프트 수정 후 커밋
```bash
# 1. 파싱 (draft_id 획득)
# 2. 수정
curl -X PUT http://localhost:3000/drafts/1 \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"manual_json": {"memo": "검수 완료"}}'

# 3. 커밋
curl -X POST http://localhost:3000/drafts/1/commit \
  -H "Authorization: Bearer your-api-key"
```

## 📊 데이터 스키마

### reservation_drafts 테이블
```sql
CREATE TABLE reservation_drafts (
    draft_id SERIAL PRIMARY KEY,
    raw_text TEXT NOT NULL,
    parsed_json JSONB,
    normalized_json JSONB,
    manual_json JSONB,
    flags JSONB DEFAULT '{}',
    confidence DECIMAL(3,2) DEFAULT 0.0,
    status VARCHAR(20) DEFAULT 'draft',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### reservations 테이블
```sql
CREATE TABLE reservations (
    id SERIAL PRIMARY KEY,
    reservation_number VARCHAR(100) UNIQUE NOT NULL,
    confirmation_number VARCHAR(100),
    channel VARCHAR(50) DEFAULT '웹',
    product_name VARCHAR(200),
    total_amount DECIMAL(10,2),
    package_type VARCHAR(100),
    usage_date DATE,
    usage_time TIME,
    quantity INTEGER DEFAULT 1,
    korean_name VARCHAR(100),
    english_first_name VARCHAR(100),
    english_last_name VARCHAR(100),
    email VARCHAR(200),
    phone VARCHAR(50),
    kakao_id VARCHAR(100),
    guest_count INTEGER DEFAULT 1,
    memo TEXT,
    reservation_datetime TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    issue_code_id INTEGER,
    code_issued BOOLEAN DEFAULT FALSE,
    code_issued_at TIMESTAMP,
    platform_name VARCHAR(50) DEFAULT 'NOL',
    people_adult INTEGER DEFAULT 1,
    people_child INTEGER DEFAULT 0,
    people_infant INTEGER DEFAULT 0,
    adult_unit_price DECIMAL(10,2),
    child_unit_price DECIMAL(10,2),
    payment_status VARCHAR(20) DEFAULT 'pending'
);
```

## 🔍 검증 규칙

### 스키마 검증 (Ajv)
- 필수 필드 존재 여부
- 데이터 타입 검증
- 날짜/시간 형식 검증
- 이메일 형식 검증

### 비즈니스 로직 검증
- 인원수 일치 (guest_count = people_adult + people_child + people_infant)
- 금액 계산 일치
- 과거 날짜 사용 여부
- 필수 정보 누락 검사

### 플래그 시스템
검증 과정에서 발견되는 이슈들을 플래그로 표시:
- `인원수_불일치`
- `이름_누락`
- `연락처_누락`
- `상품명_누락`
- `이용일_누락`
- `금액_불일치`
- `과거_이용일`
- `예약번호_형식_오류`

## 🚨 오류 처리

### 일반적인 오류 상황
1. **OpenAI API 오류**: 파싱 실패 시 기본 구조 반환
2. **예약번호 중복**: 자동으로 새 번호 생성
3. **검증 실패**: 상세한 오류 메시지와 플래그 반환
4. **데이터베이스 오류**: 트랜잭션 롤백 및 오류 로깅

### 로그 모니터링
- 모든 API 요청/응답 로깅
- 파싱 성공률 및 신뢰도 추적
- 검증 실패 패턴 분석

## 🔐 보안

### API 인증
- Bearer 토큰 방식
- 환경변수로 API 키 관리

### SQL 인젝션 방지
- 모든 쿼리에 parameterized query 사용
- 입력값 검증 및 이스케이프

### 데이터 보호
- 민감한 정보 로깅 제외
- HTTPS 통신 (프로덕션)

## 📈 성능 최적화

### 데이터베이스 인덱스
```sql
CREATE INDEX idx_drafts_status ON reservation_drafts(status);
CREATE INDEX idx_drafts_created ON reservation_drafts(created_at);
CREATE INDEX idx_reservations_number ON reservations(reservation_number);
CREATE INDEX idx_reservations_status ON reservations(payment_status);
```

### 페이지네이션
- 예약 목록 조회 시 기본 20개씩 페이징
- 검색 및 필터링 지원

## 🛠️ 유지보수

### 정기 작업
1. 오래된 드래프트 정리 (30일 이상)
2. 로그 파일 로테이션
3. 데이터베이스 백업

### 모니터링 지표
- API 응답 시간
- 파싱 성공률
- 검증 통과율
- 오류 발생 빈도

## 📞 문의

시스템 관련 문의사항이나 버그 리포트는 개발팀에 연락하세요.
