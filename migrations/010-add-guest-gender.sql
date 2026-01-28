-- 패키지 예약 투숙객 테이블에 성별 컬럼 추가
-- Migration: 010-add-guest-gender.sql
-- Date: 2026-01-28

-- package_reservation_guests 테이블에 gender 컬럼 추가
ALTER TABLE package_reservation_guests 
ADD COLUMN IF NOT EXISTS gender VARCHAR(10);

-- 기존 데이터에 대한 코멘트
COMMENT ON COLUMN package_reservation_guests.gender IS '성별: 남자, 여자 (성인의 경우 필수)';
