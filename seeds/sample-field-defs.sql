-- Sample Field Definitions for Booking Management System
-- 예약 관리 시스템용 샘플 필드 정의

-- Clear existing data
DELETE FROM field_defs WHERE key LIKE 'sample_%' OR category IN ('logistics', 'accommodation', 'flight', 'preferences', 'contact', 'accessibility', 'payment');

-- Logistics Fields (물류/교통)
INSERT INTO field_defs (key, label, type, required, pattern, options, default_value, placeholder, help_text, category, sort_order, is_active) VALUES
('pickup_location', '픽업 장소', 'string', true, NULL, NULL, NULL, '예: 힐튼 괌 리조트 로비', '호텔 또는 픽업 장소를 정확히 입력하세요', 'logistics', 10, true),
('pickup_time', '픽업 시간', 'time', false, '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$', NULL, '09:00', '09:00', '픽업 예정 시간 (24시간 형식)', 'logistics', 20, true),
('drop_off_location', '하차 장소', 'string', false, NULL, NULL, NULL, '예: 괌 국제공항', '투어 종료 후 하차 장소', 'logistics', 30, true),
('transportation_type', '교통수단', 'select', false, NULL, '{"options": ["bus", "van", "car", "walking", "boat"]}', 'bus', NULL, '이용할 교통수단 종류', 'logistics', 40, true),
('meeting_point', '집합 장소', 'string', false, NULL, NULL, NULL, '예: 투몬 비치 입구', '투어 시작 집합 장소', 'logistics', 50, true),

-- Accommodation Fields (숙박)
('hotel_name', '호텔명', 'string', false, NULL, NULL, NULL, '예: 힐튼 괌 리조트 & 스파', '투숙 중인 호텔명', 'accommodation', 10, true),
('room_number', '객실 번호', 'string', false, NULL, NULL, NULL, '예: 1205', '호텔 객실 번호', 'accommodation', 20, true),
('hotel_phone', '호텔 전화번호', 'phone', false, NULL, NULL, NULL, '+1-671-646-1835', '호텔 대표 전화번호', 'accommodation', 30, true),
('check_in_date', '체크인 날짜', 'date', false, NULL, NULL, NULL, NULL, '호텔 체크인 날짜', 'accommodation', 40, true),
('check_out_date', '체크아웃 날짜', 'date', false, NULL, NULL, NULL, NULL, '호텔 체크아웃 날짜', 'accommodation', 50, true),

-- Flight Information (항공편)
('flight_arrival', '도착 항공편', 'string', false, '^[A-Z]{2}[0-9]{3,4}$', NULL, NULL, '예: KE123', '괌 도착 항공편명', 'flight', 10, true),
('flight_departure', '출발 항공편', 'string', false, '^[A-Z]{2}[0-9]{3,4}$', NULL, NULL, '예: KE124', '괌 출발 항공편명', 'flight', 20, true),
('arrival_time', '도착 시간', 'datetime', false, NULL, NULL, NULL, NULL, '괌 도착 일시', 'flight', 30, true),
('departure_time', '출발 시간', 'datetime', false, NULL, NULL, NULL, NULL, '괌 출발 일시', 'flight', 40, true),
('airline', '항공사', 'select', false, NULL, '{"options": ["대한항공", "아시아나항공", "제주항공", "진에어", "티웨이항공", "이스타항공", "기타"]}', NULL, NULL, '이용 항공사', 'flight', 50, true),

-- Customer Preferences (고객 선호사항)
('dietary_restrictions', '식이 제한', 'multiselect', false, NULL, '{"options": ["vegetarian", "vegan", "gluten_free", "halal", "kosher", "no_seafood", "no_nuts", "no_dairy", "diabetic"]}', NULL, NULL, '식이 제한사항 (복수 선택 가능)', 'preferences', 10, true),
('tour_guide_language', '가이드 언어', 'select', false, NULL, '{"options": ["korean", "english", "japanese", "chinese", "mixed"]}', 'korean', NULL, '선호하는 가이드 언어', 'preferences', 20, true),
('activity_level', '활동 강도', 'select', false, NULL, '{"options": ["low", "moderate", "high", "extreme"]}', 'moderate', NULL, '선호하는 활동 강도', 'preferences', 30, true),
('photography_service', '사진 촬영 서비스', 'boolean', false, NULL, NULL, 'false', NULL, '전문 사진 촬영 서비스 이용 여부', 'preferences', 40, true),
('souvenir_shopping', '기념품 쇼핑', 'boolean', false, NULL, NULL, 'true', NULL, '기념품 쇼핑 포함 여부', 'preferences', 50, true),

-- Contact Information (연락처)
('emergency_contact', '비상 연락처', 'phone', false, NULL, NULL, NULL, '010-9876-5432', '비상시 연락 가능한 전화번호', 'contact', 10, true),
('emergency_contact_name', '비상 연락처 이름', 'string', false, NULL, NULL, NULL, '김영희 (배우자)', '비상 연락처 관계', 'contact', 20, true),
('local_contact', '현지 연락처', 'phone', false, NULL, NULL, NULL, '+1-671-xxx-xxxx', '괌 현지에서 사용할 전화번호', 'contact', 30, true),
('kakao_talk_id', '카카오톡 ID', 'string', false, NULL, NULL, NULL, 'guam_traveler', '카카오톡 알림용 ID', 'contact', 40, true),
('line_id', '라인 ID', 'string', false, NULL, NULL, NULL, 'guam_traveler', '라인 메신저 ID', 'contact', 50, true),

-- Accessibility (접근성)
('mobility_assistance', '이동 보조', 'boolean', false, NULL, NULL, 'false', NULL, '휠체어 또는 이동 보조 필요 여부', 'accessibility', 10, true),
('wheelchair_accessible', '휠체어 접근', 'boolean', false, NULL, NULL, 'false', NULL, '휠체어 접근 가능한 투어 필요', 'accessibility', 20, true),
('hearing_impaired', '청각 장애', 'boolean', false, NULL, NULL, 'false', NULL, '청각 장애로 인한 특별 배려 필요', 'accessibility', 30, true),
('visual_impaired', '시각 장애', 'boolean', false, NULL, NULL, 'false', NULL, '시각 장애로 인한 특별 배려 필요', 'accessibility', 40, true),
('medical_conditions', '의료 상태', 'textarea', false, NULL, NULL, NULL, '당뇨, 고혈압 등', '투어 중 주의해야 할 의료 상태', 'accessibility', 50, true),

-- Payment Information (결제 정보)
('payment_method', '결제 수단', 'select', false, NULL, '{"options": ["credit_card", "debit_card", "paypal", "bank_transfer", "cash", "cryptocurrency"]}', 'credit_card', NULL, '사용한 결제 수단', 'payment', 10, true),
('card_last_four', '카드 마지막 4자리', 'string', false, '^[0-9]{4}$', NULL, NULL, '1234', '결제 카드 마지막 4자리', 'payment', 20, true),
('payment_currency', '결제 통화', 'select', false, NULL, '{"options": ["USD", "KRW", "JPY", "CNY", "EUR"]}', 'USD', NULL, '실제 결제된 통화', 'payment', 30, true),
('exchange_rate', '환율', 'number', false, NULL, NULL, NULL, '1350.50', '결제 시점의 환율 (KRW 기준)', 'payment', 40, true),
('payment_confirmation', '결제 확인번호', 'string', false, NULL, NULL, NULL, 'PAY123456789', '결제 시스템 확인번호', 'payment', 50, true),

-- Special Requirements (특별 요구사항)
('special_occasion', '특별한 날', 'select', false, NULL, '{"options": ["birthday", "anniversary", "honeymoon", "graduation", "retirement", "family_reunion", "none"]}', 'none', NULL, '특별한 기념일이나 행사', 'preferences', 60, true),
('group_leader', '그룹 리더', 'string', false, NULL, NULL, NULL, '김철수', '그룹 투어 시 대표자', 'preferences', 70, true),
('insurance_required', '보험 필요', 'boolean', false, NULL, NULL, 'false', NULL, '여행자 보험 가입 필요 여부', 'preferences', 80, true),
('weather_dependent', '날씨 의존', 'boolean', false, NULL, NULL, 'true', NULL, '날씨에 따른 투어 변경 가능', 'preferences', 90, true),
('cancellation_insurance', '취소 보험', 'boolean', false, NULL, NULL, 'false', NULL, '취소 보험 가입 여부', 'payment', 60, true);

-- Update timestamps
UPDATE field_defs SET updated_at = NOW() WHERE category IN ('logistics', 'accommodation', 'flight', 'preferences', 'contact', 'accessibility', 'payment');

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_field_defs_category_active ON field_defs (category, is_active);
CREATE INDEX IF NOT EXISTS idx_field_defs_sort_order ON field_defs (sort_order);

-- Display summary
SELECT 
    category,
    COUNT(*) as field_count,
    COUNT(CASE WHEN required = true THEN 1 END) as required_count,
    COUNT(CASE WHEN is_active = true THEN 1 END) as active_count
FROM field_defs 
WHERE category IN ('logistics', 'accommodation', 'flight', 'preferences', 'contact', 'accessibility', 'payment')
GROUP BY category
ORDER BY category;
