# OpenAI API 기반 예약 파싱 시스템

Railway + PostgreSQL + OpenAI API를 사용한 지능형 예약 관리 시스템입니다.

## 🚀 주요 기능

- **OpenAI GPT-4o-mini**를 활용한 고정밀 예약 텍스트 파싱
- **PostgreSQL** 기반 안정적인 데이터 저장
- **RESTful API**를 통한 완전한 CRUD 작업
- **Bearer Token** 인증으로 보안 강화
- **Railway** 클라우드 배포 지원

## 📋 시스템 구조

```
├── utils/
│   └── aiParser.js          # OpenAI API 파싱 로직
├── server-openai.js         # Express 서버 및 API 엔드포인트
├── testOpenAI.js           # 파싱 테스트 스크립트
├── package.json            # 의존성 관리
└── env.example             # 환경변수 예시
```

## 🔧 환경 설정

### 1. 환경변수 설정

`.env` 파일을 생성하고 다음 변수들을 설정하세요:

```bash
# OpenAI API 설정
OPENAI_API_KEY=sk-your-openai-api-key-here

# 데이터베이스 설정 (Railway PostgreSQL)
DATABASE_URL=postgresql://username:password@host:port/database

# API 인증 키
API_KEY=your-secret-api-key

# 서버 포트 (Railway에서 자동 설정)
PORT=3000

# 환경 설정
NODE_ENV=production
```

### 2. 의존성 설치

```bash
npm install
```

### 3. 서버 실행

```bash
# 프로덕션 모드
npm start

# 개발 모드
npm run dev
```

## 📊 데이터베이스 스키마

`reservations` 테이블이 자동으로 생성됩니다:

```sql
CREATE TABLE reservations (
    id SERIAL PRIMARY KEY,
    reservation_number VARCHAR(100) UNIQUE NOT NULL,
    confirmation_number VARCHAR(100),
    channel VARCHAR(50) DEFAULT '웹',
    product_name TEXT,
    total_amount DECIMAL(10,2),
    package_type VARCHAR(100),
    usage_date DATE,
    usage_time TIME,
    quantity INTEGER DEFAULT 1,
    korean_name VARCHAR(100),
    english_first_name VARCHAR(100),
    english_last_name VARCHAR(100),
    email VARCHAR(255),
    phone VARCHAR(50),
    kakao_id VARCHAR(100),
    guest_count INTEGER DEFAULT 1,
    memo TEXT,
    reservation_datetime TIMESTAMP,
    issue_code_id INTEGER,
    code_issued BOOLEAN DEFAULT FALSE,
    code_issued_at TIMESTAMP,
    platform_name VARCHAR(50) DEFAULT 'OTHER',
    people_adult INTEGER DEFAULT 1,
    people_child INTEGER DEFAULT 0,
    people_infant INTEGER DEFAULT 0,
    adult_unit_price DECIMAL(10,2),
    child_unit_price DECIMAL(10,2),
    payment_status VARCHAR(50) DEFAULT '대기',
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 🔌 API 엔드포인트

모든 API 요청에는 `Authorization: Bearer {API_KEY}` 헤더가 필요합니다.

### 1. 예약 텍스트 파싱 및 저장

```http
POST /import-booking
Content-Type: application/json
Authorization: Bearer your-api-key

{
  "rawText": "예약번호: NOL123456\n상품명: 괌 돌핀 워칭 투어\n이용일: 2024-12-15\n예약자: 김철수\n..."
}
```

**응답:**
```json
{
  "success": true,
  "message": "예약이 성공적으로 저장되었습니다",
  "booking": { /* 저장된 예약 데이터 */ },
  "parsed_data": { /* OpenAI 파싱 결과 */ }
}
```

### 2. 예약 목록 조회

```http
GET /bookings?page=1&limit=50&status=active&platform=NOL&search=김철수
Authorization: Bearer your-api-key
```

**쿼리 파라미터:**
- `page`: 페이지 번호 (기본값: 1)
- `limit`: 페이지당 항목 수 (기본값: 50)
- `status`: 예약 상태 (active/cancelled)
- `platform`: 플랫폼 필터 (NOL/KLOOK/VIATOR 등)
- `search`: 검색어 (예약번호/이름/상품명)

### 3. 예약 상세 조회

```http
GET /bookings/{id}
Authorization: Bearer your-api-key
```

### 4. 수기 예약 생성

```http
POST /bookings
Content-Type: application/json
Authorization: Bearer your-api-key

{
  "reservation_number": "MANUAL001",
  "product_name": "괌 시내 관광",
  "korean_name": "홍길동",
  "usage_date": "2024-12-20",
  "guest_count": 2,
  "total_amount": 150.00
}
```

### 5. 예약 수정

```http
PUT /bookings/{id}
Content-Type: application/json
Authorization: Bearer your-api-key

{
  "usage_date": "2024-12-25",
  "guest_count": 3,
  "memo": "일정 변경 요청"
}
```

### 6. 예약 취소

```http
DELETE /bookings/{id}
Authorization: Bearer your-api-key
```

### 7. 통계 조회

```http
GET /stats
Authorization: Bearer your-api-key
```

**응답:**
```json
{
  "success": true,
  "data": {
    "total_bookings": 150,
    "active_bookings": 120,
    "cancelled_bookings": 30,
    "code_issued": 80,
    "platforms": 5,
    "total_revenue": 15000.00
  }
}
```

## 🧪 테스트

### OpenAI 파싱 테스트

```bash
# 모든 테스트 케이스 실행
node testOpenAI.js

# 특정 테스트 케이스만 실행
node testOpenAI.js single 0

# 커스텀 텍스트 테스트
node testOpenAI.js custom "예약번호: TEST123 상품: 괌 투어 이름: 김철수"
```

### API 테스트 (curl 예시)

```bash
# 예약 파싱 테스트
curl -X POST https://your-railway-app.up.railway.app/import-booking \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "rawText": "예약번호: NOL123456\n상품명: 괌 돌핀 워칭 투어\n이용일: 2024-12-15\n예약자: 김철수"
  }'

# 예약 목록 조회
curl -H "Authorization: Bearer your-api-key" \
  https://your-railway-app.up.railway.app/bookings

# 통계 조회
curl -H "Authorization: Bearer your-api-key" \
  https://your-railway-app.up.railway.app/stats
```

## 🤖 OpenAI 파싱 기능

### 지원 플랫폼
- **NOL 인터파크**: 한국어 예약 정보 특화 파싱
- **KLOOK**: 영문/한글 혼합 예약 정보
- **VIATOR**: 영문 투어 예약
- **AGODA**: 숙박 예약 정보
- **기타**: 일반적인 예약 텍스트

### 파싱 가능한 정보
- 예약번호, 확인번호
- 상품명, 패키지 타입
- 이용일시, 예약일시
- 예약자 정보 (한글명, 영문명)
- 연락처 (전화번호, 이메일, 카카오톡 ID)
- 인원 정보 (성인/소아/유아)
- 금액 정보 (총액, 단가)
- 결제 상태, 플랫폼 정보

### 데이터 검증 및 후처리
- 날짜/시간 형식 자동 변환
- 이메일/전화번호 유효성 검증
- 원화 → 달러 자동 환산 (1,300원 = $1)
- 누락된 필드 기본값 설정

## 🚀 Railway 배포

### 1. Railway 프로젝트 생성
```bash
railway login
railway init
```

### 2. 환경변수 설정
Railway 대시보드에서 다음 환경변수를 설정:
- `OPENAI_API_KEY`
- `DATABASE_URL` (PostgreSQL 플러그인 자동 설정)
- `API_KEY`
- `NODE_ENV=production`

### 3. 배포
```bash
railway up
```

## 📈 모니터링 및 로깅

서버는 다음과 같은 로그를 출력합니다:

```
🚀 OpenAI Booking Parser API 서버 시작
📡 포트: 3000
🔑 인증: Bearer Token 필요
🤖 OpenAI API: 연결됨
🗄️ 데이터베이스: 연결됨
```

## 🔒 보안 고려사항

1. **API 키 보안**: 환경변수로만 관리, 코드에 하드코딩 금지
2. **Bearer Token**: 모든 API 요청에 인증 필요
3. **SQL Injection 방지**: Parameterized Query 사용
4. **Rate Limiting**: 필요시 express-rate-limit 추가 권장

## 🐛 문제 해결

### OpenAI API 오류
- API 키 확인: `process.env.OPENAI_API_KEY`
- 요금 한도 확인: OpenAI 대시보드
- 네트워크 연결 확인

### 데이터베이스 연결 오류
- `DATABASE_URL` 환경변수 확인
- Railway PostgreSQL 플러그인 상태 확인
- 연결 문자열 형식 검증

### 파싱 품질 개선
- 시스템 프롬프트 조정 (`utils/aiParser.js`)
- 테스트 케이스 추가 (`testOpenAI.js`)
- 후처리 로직 개선

## 📞 지원

문제가 발생하거나 기능 개선이 필요한 경우:
1. 로그 확인 및 오류 메시지 수집
2. 테스트 케이스로 문제 재현
3. GitHub Issues 또는 개발팀 연락

---

**개발팀**: Guam Save Card Team  
**버전**: 1.0.0  
**라이선스**: MIT
