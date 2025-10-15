# 픽업 관리 테이블 마이그레이션 가이드

## 🚨 문제 상황
- **항공편 관리**: 서버 재시작 시 데이터가 초기화됨
- **업체 관리**: 업체 삭제가 되지 않음

## 🔍 원인
데이터베이스에 `pickup_flights`와 `pickup_agencies` 테이블이 생성되지 않아서 데이터를 저장할 수 없었습니다.

## ✅ 해결 방법

### 방법 1: npm 스크립트로 실행 (추천)

```bash
npm run migrate:pickup
```

### 방법 2: 직접 실행

```bash
node run-pickup-migration.js
```

### 방법 3: SQL 파일 직접 실행

Railway 대시보드나 PostgreSQL 클라이언트에서 다음 파일을 실행:
```
migrations/004-pickup-flights-agencies.sql
```

## 📋 생성되는 테이블

### 1. pickup_flights (항공편 관리)
```sql
CREATE TABLE pickup_flights (
  id SERIAL PRIMARY KEY,
  flight_number VARCHAR(50) NOT NULL UNIQUE,
  airline VARCHAR(100),
  departure_time TIME NOT NULL,
  arrival_time TIME NOT NULL,
  flight_hours DECIMAL(4,2),
  departure_airport VARCHAR(10) NOT NULL,
  arrival_airport VARCHAR(10) NOT NULL,
  days_of_week VARCHAR(50) DEFAULT '1,2,3,4,5,6,7',
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 2. pickup_agencies (업체 관리)
```sql
CREATE TABLE pickup_agencies (
  id SERIAL PRIMARY KEY,
  agency_name VARCHAR(200) NOT NULL,
  contact_person VARCHAR(100),
  phone VARCHAR(50),
  email VARCHAR(200),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 🎉 마이그레이션 완료 후

마이그레이션이 성공적으로 완료되면:

1. ✅ 항공편 관리에서 추가한 데이터가 서버 재시작 후에도 유지됩니다
2. ✅ 업체 관리에서 업체 삭제가 정상적으로 작동합니다
3. ✅ 업체 수정이 정상적으로 작동합니다
4. ✅ 샘플 항공편 데이터 2개가 자동으로 추가됩니다 (UA200, UA201)

## 🔧 확인 방법

마이그레이션 후 다음 쿼리로 테이블이 생성되었는지 확인:

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('pickup_flights', 'pickup_agencies');
```

데이터 확인:
```sql
SELECT * FROM pickup_flights;
SELECT * FROM pickup_agencies;
```

## 📞 문제 발생 시

마이그레이션이 실패하면:
1. DATABASE_URL 환경변수가 올바른지 확인
2. PostgreSQL 연결이 정상인지 확인
3. 에러 메시지를 확인하고 필요 시 수동으로 SQL 실행

---

**작성일**: 2025-10-15  
**버전**: 1.0.0
