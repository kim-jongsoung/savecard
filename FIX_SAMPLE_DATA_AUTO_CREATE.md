# 샘플 데이터 자동 생성 문제 해결

## 🔍 문제 상황

**증상**: 
- 항공편(UA200, UA201)을 삭제해도 서버 재시작 시 다시 생성됨
- 삭제 기능이 작동하지 않는 것처럼 보임

**원인**:
마이그레이션 파일(`004-pickup-flights-agencies.sql`)에 샘플 데이터 삽입 코드가 포함되어 있었습니다.

```sql
-- 문제가 되는 코드
INSERT INTO pickup_flights (...)
VALUES 
  ('UA200', 'United Airlines', ...),
  ('UA201', 'United Airlines', ...)
ON CONFLICT (flight_number) DO NOTHING;
```

## ✅ 해결 방법

### 1단계: 마이그레이션 파일 수정 (완료) ✅

`migrations/004-pickup-flights-agencies.sql`에서 샘플 데이터 삽입 코드를 제거했습니다.

**수정 전**:
```sql
-- 기본 샘플 데이터 (옵션)
INSERT INTO pickup_flights (flight_number, airline, ...)
VALUES ('UA200', ...), ('UA201', ...)
ON CONFLICT (flight_number) DO NOTHING;
```

**수정 후**:
```sql
-- 샘플 데이터는 제거됨 (자동 생성 방지)
```

### 2단계: 실서버 샘플 데이터 삭제

다음 명령어로 실서버의 샘플 데이터를 삭제하세요:

```bash
npm run clean:sample-flights
```

또는 Railway 데이터베이스에 직접 접속해서:

```sql
DELETE FROM pickup_flights 
WHERE flight_number IN ('UA200', 'UA201')
  AND airline = 'United Airlines';
```

## 📋 생성된 파일

1. **`remove-sample-flights.js`**
   - 샘플 데이터 자동 삭제 스크립트
   - `npm run clean:sample-flights` 명령어로 실행

2. **`remove-sample-flights.sql`**
   - 수동 삭제용 SQL 스크립트
   - Railway 콘솔에서 직접 실행 가능

3. **`package.json`**
   - `clean:sample-flights` 스크립트 추가

## 🚀 실행 방법

### 방법 1: npm 스크립트 (권장)

```bash
npm run clean:sample-flights
```

**실행 결과**:
```
🚀 샘플 항공편 데이터 삭제 시작...

📊 삭제 전 샘플 데이터: 2개

🗑️  삭제할 항공편:
  - UA200: ICN → GUM (United Airlines)
  - UA201: GUM → ICN (United Airlines)

✅ 2개의 샘플 항공편이 삭제되었습니다!

📈 현재 항공편 데이터: 0개

🎉 완료! 이제 서버를 재시작해도 샘플 데이터가 생성되지 않습니다.
```

### 방법 2: Railway 콘솔에서 직접 실행

1. Railway 대시보드 접속
2. PostgreSQL 서비스 선택
3. Query 탭 클릭
4. `remove-sample-flights.sql` 내용 복사/붙여넣기
5. 실행

## 🎯 확인 방법

### 1. 삭제 확인
```sql
SELECT * FROM pickup_flights 
WHERE flight_number IN ('UA200', 'UA201');
```
결과: 0 rows (데이터 없음)

### 2. 서버 재시작 후 확인
1. 서버 재시작
2. 항공편 관리 페이지 접속
3. UA200, UA201이 없는지 확인

### 3. 삭제 기능 테스트
1. 새 항공편 추가 (예: KE123)
2. 삭제 버튼 클릭
3. 서버 재시작
4. KE123이 다시 생성되지 않는지 확인

## 🔧 이제 정상 작동하는 기능

### ✅ 완전 삭제
```
항공편 삭제
  ↓
사용 중인 픽업건 확인
  ↓
없음 → DELETE 실행
  ↓
서버 재시작
  ↓
삭제된 상태 유지 ✅
```

### ✅ 비활성화
```
사용 중인 항공편 삭제
  ↓
is_active = false
  ↓
서버 재시작
  ↓
비활성 상태 유지 ✅
```

## 📊 기대 효과

### Before (수정 전)
```
1. UA200 삭제 → ✅ 성공
2. 서버 재시작
3. UA200 다시 생성 ❌
4. 사용자: "삭제가 안 돼요!"
```

### After (수정 후)
```
1. UA200 삭제 → ✅ 성공
2. 서버 재시작
3. UA200 없음 ✅
4. 사용자: "완벽해요!"
```

## 🎉 완료!

이제 다음이 보장됩니다:

- ✅ 항공편 삭제 시 완전히 삭제됨
- ✅ 서버 재시작 시 자동 생성 안 됨
- ✅ 비활성화된 항공편도 유지됨
- ✅ 깨끗한 데이터베이스 상태

---

**작성일**: 2025-10-15  
**버전**: 1.0.0  
**문제**: 샘플 데이터 자동 생성  
**해결**: 마이그레이션 파일 수정 + 샘플 데이터 삭제
