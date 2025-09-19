# 괌세이브카드 예약 관리 시스템

완전한 예약 파싱 이후 운영 관리 백엔드 시스템

## 📋 개요

이 시스템은 OpenAI 기반 예약 텍스트 파싱 이후의 운영 관리를 위한 완전한 백엔드 솔루션입니다. 동적 필드 관리, 감사 로그, 실시간 이벤트, 일괄 작업 등 엔터프라이즈급 기능을 제공합니다.

### 주요 기능

- ✅ **OpenAI 지능형 파싱**: GPT-4o-mini 모델을 활용한 정확한 텍스트 파싱
- ✅ **동적 필드 관리**: JSONB 기반 확장 가능한 필드 시스템
- ✅ **완전한 CRUD**: 생성, 조회, 수정, 삭제, 복구 기능
- ✅ **감사 로그**: 모든 변경사항 추적 및 롤백 지원
- ✅ **실시간 이벤트**: SSE 기반 실시간 알림
- ✅ **일괄 작업**: 대량 데이터 처리 및 내보내기
- ✅ **알림 시스템**: 이메일/카카오톡 알림 지원
- ✅ **낙관적 잠금**: 동시 수정 충돌 방지

## 🏗️ 시스템 아키텍처

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend UI   │    │   Admin Panel   │    │   Mobile App    │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
                    ┌─────────────┴─────────────┐
                    │   Express.js Server       │
                    │   - API Routes            │
                    │   - SSE Events            │
                    │   - Authentication        │
                    └─────────────┬─────────────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          │                      │                      │
    ┌─────┴─────┐        ┌───────┴───────┐      ┌──────┴──────┐
    │PostgreSQL │        │  OpenAI API   │      │ Notification│
    │ Database  │        │   Parsing     │      │  Services   │
    └───────────┘        └───────────────┘      └─────────────┘
```

## 📊 데이터베이스 스키마

### 핵심 테이블

#### reservations
```sql
-- 예약 메인 테이블 (기존 + 확장)
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS extras JSONB DEFAULT '{}'::jsonb;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS review_status VARCHAR(50) DEFAULT 'pending';
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS flags JSONB DEFAULT '{}'::jsonb;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS origin_hash VARCHAR(64);
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS lock_version INTEGER DEFAULT 1;
```

#### field_defs
```sql
-- 동적 필드 정의 테이블
CREATE TABLE field_defs (
    key TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('string', 'number', 'date', 'time', 'datetime', 'boolean', 'select', 'multiselect', 'textarea', 'email', 'phone')),
    required BOOLEAN DEFAULT FALSE,
    pattern TEXT,
    options JSONB,
    default_value TEXT,
    placeholder TEXT,
    help_text TEXT,
    category TEXT DEFAULT 'general',
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

#### reservation_audits
```sql
-- 감사 로그 테이블
CREATE TABLE reservation_audits (
    audit_id BIGSERIAL PRIMARY KEY,
    booking_id BIGINT NOT NULL,
    actor TEXT,
    action TEXT NOT NULL CHECK (action IN ('create', 'update', 'cancel', 'restore', 'delete', 'bulk_update')),
    diff JSONB,
    previous_values JSONB,
    current_values JSONB,
    reason TEXT,
    ip_address INET,
    user_agent TEXT,
    request_id TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
```

## 🚀 설치 및 실행

### 1. 환경 설정

```bash
# 환경변수 설정 (.env 파일)
DATABASE_URL=postgresql://user:password@host:port/database
OPENAI_API_KEY=sk-your-openai-api-key
SESSION_SECRET=your-session-secret
NODE_ENV=production
PORT=3001

# 이메일 알림 (선택사항)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=noreply@guamsavecard.com
```

### 2. 의존성 설치

```bash
npm install express pg cors express-session
npm install nodemailer ajv ajv-formats
npm install dotenv
```

### 3. 데이터베이스 마이그레이션

```bash
# 마이그레이션 실행
node run-migrations.js

# 또는 서버 시작 시 자동 실행
node server-booking-management.js
```

### 4. 서버 시작

```bash
# 개발 모드
NODE_ENV=development node server-booking-management.js

# 프로덕션 모드
NODE_ENV=production node server-booking-management.js
```

## 📡 API 엔드포인트

### 예약 관리

```http
GET    /api/bookings              # 예약 목록 (필터링, 페이징)
POST   /api/bookings              # 예약 생성
GET    /api/bookings/{id}         # 예약 상세
PATCH  /api/bookings/{id}         # 예약 수정 (낙관적 잠금)
DELETE /api/bookings/{id}         # 예약 취소/삭제
POST   /api/bookings/{id}/restore # 예약 복구
POST   /api/bookings/bulk         # 일괄 작업
```

### 필드 정의 관리

```http
GET    /api/field-defs            # 필드 정의 목록
POST   /api/field-defs            # 필드 정의 생성
GET    /api/field-defs/{key}      # 필드 정의 상세
PATCH  /api/field-defs/{key}      # 필드 정의 수정
DELETE /api/field-defs/{key}      # 필드 정의 삭제
```

### 감사 로그

```http
GET    /api/audits/recent         # 최근 감사 로그
GET    /api/audits/{audit_id}     # 감사 로그 상세
POST   /api/audits/search         # 감사 로그 검색
GET    /api/bookings/{id}/audits  # 특정 예약의 감사 로그
```

### 시스템

```http
GET    /healthz                   # 헬스 체크
GET    /events                    # SSE 이벤트 스트림
GET    /api/system/info           # 시스템 정보
POST   /api/system/migrate        # 수동 마이그레이션
```

## 🔧 사용 예시

### 1. 예약 목록 조회

```bash
curl -X GET "http://localhost:3001/api/bookings?q=김철수&status=confirmed&page=1&page_size=20" \
  -H "X-API-Key: your-api-key"
```

### 2. 예약 생성

```bash
curl -X POST "http://localhost:3001/api/bookings" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "reservation_number": "TEST001",
    "korean_name": "김철수",
    "product_name": "괌 시티투어",
    "usage_date": "2025-10-15",
    "total_amount": 150.00,
    "people_adult": 2,
    "extras": {
      "pickup_location": "호텔 로비",
      "special_requests": "휠체어 이용"
    }
  }'
```

### 3. 일괄 취소

```bash
curl -X POST "http://localhost:3001/api/bookings/bulk" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "action": "cancel",
    "ids": [1, 2, 3],
    "reason": "고객 요청에 의한 일괄 취소"
  }'
```

### 4. SSE 이벤트 구독

```javascript
const eventSource = new EventSource('/events');
eventSource.onmessage = function(event) {
    const data = JSON.parse(event.data);
    console.log('예약 이벤트:', data);
};
```

## 🔒 보안 및 권한

### 인증 방식

1. **API Key**: `X-API-Key` 헤더
2. **Session**: 쿠키 기반 세션 (관리자 패널)

### 권한 레벨

- **admin**: 모든 기능 접근
- **operator**: 예약 관리, 제한적 설정
- **viewer**: 읽기 전용 접근

### 보안 기능

- 낙관적 잠금으로 동시 수정 방지
- 감사 로그로 모든 변경사항 추적
- IP 주소 및 User-Agent 기록
- 소프트 삭제로 데이터 보호

## 📈 성능 최적화

### 데이터베이스 인덱스

```sql
-- 주요 인덱스
CREATE INDEX idx_reservations_usage_date ON reservations (usage_date);
CREATE INDEX idx_reservations_created_at ON reservations (created_at);
CREATE INDEX idx_reservations_payment_status ON reservations (payment_status);
CREATE INDEX idx_reservations_korean_name ON reservations (korean_name);
CREATE INDEX idx_reservations_email ON reservations (email);
CREATE INDEX idx_reservations_extras_gin ON reservations USING GIN (extras);

-- 감사 로그 인덱스
CREATE INDEX idx_audits_booking_id ON reservation_audits (booking_id);
CREATE INDEX idx_audits_created_at ON reservation_audits (created_at);
CREATE INDEX idx_audits_actor ON reservation_audits (actor);
```

### 캐싱 전략

- 필드 정의: 메모리 캐시 (10분)
- 통계 데이터: Redis 캐시 (5분)
- SSE 이벤트: 최근 100개 메모리 저장

## 🔄 업무 프로세스

### 예약 생명주기

```
파싱 → 드래프트 → 검수 → 승인 → 확정 → 완료
  ↓       ↓       ↓      ↓      ↓      ↓
저장    수정    보정   승인   알림   완료
```

### 상태 전이

```
pending → needs_review → reviewed → confirmed
   ↓           ↓           ↓          ↓
cancelled ← cancelled ← cancelled ← cancelled
   ↓
restored (24시간 이내)
```

### 검수 워크플로우

1. **자동 파싱**: OpenAI로 텍스트 파싱
2. **품질 검사**: 필수 필드 및 애매한 데이터 확인
3. **플래그 설정**: missing, ambiguous 필드 표시
4. **검수 대기**: review_status = 'needs_review'
5. **수동 검수**: 운영자가 데이터 확인 및 수정
6. **승인**: review_status = 'reviewed'
7. **알림 발송**: 고객에게 확인 알림

## 🚨 모니터링 및 알림

### 헬스 체크

```bash
curl http://localhost:3001/healthz
```

### 로그 모니터링

```bash
# 실시간 로그 확인
tail -f logs/booking-management.log

# 에러 로그 필터링
grep "❌" logs/booking-management.log
```

### 알림 설정

- **이메일**: 예약 확인, 취소, 리마인더
- **카카오톡**: 예약 알림 (API 연동 필요)
- **SSE**: 실시간 관리자 알림

## 🔧 트러블슈팅

### 일반적인 문제

1. **데이터베이스 연결 실패**
   ```bash
   # 연결 테스트
   psql $DATABASE_URL -c "SELECT NOW();"
   ```

2. **마이그레이션 실패**
   ```bash
   # 수동 마이그레이션
   node run-migrations.js
   ```

3. **OpenAI API 오류**
   ```bash
   # API 키 확인
   echo $OPENAI_API_KEY
   ```

4. **SSE 연결 문제**
   ```javascript
   // 재연결 로직
   eventSource.onerror = function() {
       setTimeout(() => {
           eventSource = new EventSource('/events');
       }, 5000);
   };
   ```

### 성능 문제

1. **느린 쿼리 최적화**
   ```sql
   -- 쿼리 실행 계획 확인
   EXPLAIN ANALYZE SELECT * FROM reservations WHERE usage_date >= '2025-01-01';
   ```

2. **인덱스 사용률 확인**
   ```sql
   -- 인덱스 통계
   SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch 
   FROM pg_stat_user_indexes;
   ```

## 📚 추가 문서

- [OpenAPI 스펙](./OPENAPI.yaml)
- [데이터베이스 스키마](../migrations/)
- [배포 가이드](./DEPLOYMENT.md)
- [개발 가이드](./DEVELOPMENT.md)

## 🤝 기여하기

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📄 라이선스

이 프로젝트는 MIT 라이선스 하에 있습니다.

## 📞 지원

- **이메일**: support@guamsavecard.com
- **문서**: https://docs.guamsavecard.com
- **이슈**: GitHub Issues
