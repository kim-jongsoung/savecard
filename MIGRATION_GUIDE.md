# 예약 시스템 마이그레이션 가이드

## 개요
기존 단일 `reservations` 테이블을 새로운 6개 테이블 구조로 마이그레이션하는 가이드입니다.

## 새로운 테이블 구조
1. **reservations** - 예약 기본 정보
2. **reservation_schedules** - 이용 일정
3. **reservation_customers** - 예약자 및 고객 정보
4. **reservation_payments** - 결제 내역
5. **cancellation_policies** - 취소/환불 규정
6. **reservation_logs** - 예약 변경 이력

## 마이그레이션 실행 방법

### 1. 환경 변수 설정
```bash
# Railway PostgreSQL 연결 정보 확인
echo $DATABASE_URL
```

### 2. 마이그레이션 실행
```bash
# 마이그레이션 스크립트 실행
node migrate-reservations.js
```

### 3. 실행 과정
1. 기존 데이터 백업 (`reservations_backup` 테이블 생성)
2. 기존 테이블 삭제
3. 새로운 6개 테이블 생성
4. 백업 데이터를 새 구조로 변환하여 삽입
5. 인덱스 생성
6. 통계 출력

## 주의사항

### ⚠️ 실행 전 확인사항
- **데이터베이스 백업**: 중요한 데이터가 있다면 전체 데이터베이스를 별도 백업
- **서비스 중단**: 마이그레이션 중에는 예약 관련 기능 사용 중단
- **연결 확인**: PostgreSQL 연결이 정상적으로 작동하는지 확인

### 🔄 롤백 방법
마이그레이션 실패 시 백업 테이블에서 복구:
```sql
-- 새 테이블들 삭제
DROP TABLE IF EXISTS reservation_logs CASCADE;
DROP TABLE IF EXISTS cancellation_policies CASCADE;
DROP TABLE IF EXISTS reservation_payments CASCADE;
DROP TABLE IF EXISTS reservation_customers CASCADE;
DROP TABLE IF EXISTS reservation_schedules CASCADE;
DROP TABLE IF EXISTS reservations CASCADE;

-- 백업에서 복구
CREATE TABLE reservations AS SELECT * FROM reservations_backup;
```

## 마이그레이션 후 확인사항

### 1. 데이터 검증
```sql
-- 예약 수 확인
SELECT COUNT(*) FROM reservations;

-- 관련 테이블 데이터 확인
SELECT 
    COUNT(DISTINCT r.reservation_id) as reservations,
    COUNT(DISTINCT s.schedule_id) as schedules,
    COUNT(DISTINCT c.customer_id) as customers,
    COUNT(DISTINCT p.payment_id) as payments
FROM reservations r
LEFT JOIN reservation_schedules s ON r.reservation_id = s.reservation_id
LEFT JOIN reservation_customers c ON r.reservation_id = c.reservation_id
LEFT JOIN reservation_payments p ON r.reservation_id = p.reservation_id;
```

### 2. 애플리케이션 테스트
- 예약 목록 조회 확인
- 예약 등록 기능 확인
- 예약 상세 정보 표시 확인
- 코드 발급 기능 확인

### 3. 백업 테이블 정리
마이그레이션이 성공적으로 완료되고 모든 기능이 정상 작동하면:
```sql
DROP TABLE reservations_backup;
```

## 문제 해결

### 마이그레이션 실패 시
1. 오류 메시지 확인
2. 데이터베이스 연결 상태 점검
3. 필요시 백업에서 복구
4. 문제 해결 후 재실행

### 성능 이슈 시
- 인덱스 추가 생성
- 쿼리 최적화
- 데이터베이스 통계 업데이트

## 완료 후 혜택
- 정규화된 데이터 구조로 데이터 무결성 향상
- 확장 가능한 스키마 구조
- 트랜잭션 처리로 데이터 일관성 보장
- 상세한 예약 정보 관리 가능
- 변경 이력 추적 가능
