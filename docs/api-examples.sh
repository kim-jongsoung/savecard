#!/bin/bash

# 괌세이브카드 예약 관리 API 예제 스크립트
# Usage: ./api-examples.sh [BASE_URL] [API_KEY]

BASE_URL=${1:-"http://localhost:3001"}
API_KEY=${2:-"your-api-key-here"}

echo "🚀 괌세이브카드 예약 관리 API 테스트"
echo "📍 Base URL: $BASE_URL"
echo "🔑 API Key: ${API_KEY:0:10}..."
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper function to make API calls
api_call() {
    local method=$1
    local endpoint=$2
    local data=$3
    local description=$4
    
    echo -e "${BLUE}📡 $description${NC}"
    echo -e "${YELLOW}$method $endpoint${NC}"
    
    if [ -n "$data" ]; then
        echo -e "${YELLOW}Data: $data${NC}"
        response=$(curl -s -X $method "$BASE_URL$endpoint" \
            -H "Content-Type: application/json" \
            -H "X-API-Key: $API_KEY" \
            -d "$data")
    else
        response=$(curl -s -X $method "$BASE_URL$endpoint" \
            -H "X-API-Key: $API_KEY")
    fi
    
    # Check if response is valid JSON
    if echo "$response" | jq empty 2>/dev/null; then
        echo -e "${GREEN}✅ Response:${NC}"
        echo "$response" | jq '.'
    else
        echo -e "${RED}❌ Invalid JSON response:${NC}"
        echo "$response"
    fi
    
    echo ""
    echo "----------------------------------------"
    echo ""
}

# 1. Health Check
api_call "GET" "/healthz" "" "헬스 체크"

# 2. System Info
api_call "GET" "/api/system/info" "" "시스템 정보 조회"

# 3. Field Definitions - List
api_call "GET" "/api/field-defs" "" "필드 정의 목록 조회"

# 4. Field Definitions - Create
field_def_data='{
  "key": "pickup_location",
  "label": "픽업 장소",
  "type": "string",
  "required": true,
  "category": "logistics",
  "help_text": "호텔 또는 픽업 장소를 입력하세요",
  "placeholder": "예: 힐튼 괌 리조트 로비"
}'
api_call "POST" "/api/field-defs" "$field_def_data" "필드 정의 생성"

# 5. Bookings - Create
booking_data='{
  "reservation_number": "TEST001",
  "channel": "웹",
  "platform_name": "NOL",
  "product_name": "괌 시티투어 + 쇼핑",
  "korean_name": "김철수",
  "english_first_name": "CHUL",
  "english_last_name": "KIM",
  "email": "test@example.com",
  "phone": "010-1234-5678",
  "usage_date": "2025-10-15",
  "usage_time": "09:00",
  "people_adult": 2,
  "people_child": 1,
  "people_infant": 0,
  "total_amount": 250.00,
  "adult_unit_price": 100.00,
  "child_unit_price": 50.00,
  "payment_status": "confirmed",
  "extras": {
    "pickup_location": "힐튼 괌 리조트 로비",
    "special_requests": "아이 알레르기 있음 - 견과류 제외",
    "group_size": 3,
    "dietary_restrictions": ["vegetarian"],
    "emergency_contact": "010-9876-5432"
  },
  "_raw_text": "괌 시티투어 예약\n예약자: 김철수\n이용일: 2025년 10월 15일\n성인 2명, 아동 1명\n총 금액: $250"
}'
api_call "POST" "/api/bookings" "$booking_data" "예약 생성"

# 6. Bookings - List with filters
api_call "GET" "/api/bookings?q=김철수&status=confirmed&page=1&page_size=10" "" "예약 목록 조회 (필터링)"

# 7. Bookings - Get specific booking (assuming ID 1 exists)
api_call "GET" "/api/bookings/1" "" "예약 상세 조회"

# 8. Bookings - Update
update_data='{
  "memo": "고객 요청으로 픽업 시간 변경",
  "usage_time": "10:00",
  "extras": {
    "pickup_location": "PIC 괌 로비",
    "special_requests": "아이 알레르기 있음 - 견과류 제외, 픽업 시간 10시로 변경"
  },
  "_reason": "고객 요청에 의한 픽업 시간 변경"
}'
api_call "PATCH" "/api/bookings/1" "$update_data" "예약 수정"

# 9. Bookings - Status update
status_update='{
  "payment_status": "confirmed",
  "reason": "결제 확인 완료"
}'
api_call "PATCH" "/api/bookings/1/status" "$status_update" "예약 상태 변경"

# 10. Bookings - Bulk operation (create test bookings first)
bulk_create_data='{
  "reservation_number": "BULK001",
  "korean_name": "이영희",
  "product_name": "괌 스노클링 투어",
  "usage_date": "2025-10-16",
  "total_amount": 180.00,
  "people_adult": 2,
  "payment_status": "pending"
}'
api_call "POST" "/api/bookings" "$bulk_create_data" "일괄 작업용 예약 생성 1"

bulk_create_data2='{
  "reservation_number": "BULK002",
  "korean_name": "박민수",
  "product_name": "괌 스노클링 투어",
  "usage_date": "2025-10-16",
  "total_amount": 180.00,
  "people_adult": 2,
  "payment_status": "pending"
}'
api_call "POST" "/api/bookings" "$bulk_create_data2" "일괄 작업용 예약 생성 2"

# 11. Bulk status update
bulk_operation='{
  "action": "status",
  "filters": {
    "status": "pending",
    "from": "2025-10-16",
    "to": "2025-10-16"
  },
  "new_status": "confirmed",
  "reason": "일괄 결제 확인 처리"
}'
api_call "POST" "/api/bookings/bulk" "$bulk_operation" "일괄 상태 변경"

# 12. Audit logs
api_call "GET" "/api/audits/recent?limit=10" "" "최근 감사 로그 조회"

# 13. Booking audit history
api_call "GET" "/api/bookings/1/audits" "" "특정 예약 감사 로그"

# 14. Import booking (integration endpoint)
import_data='{
  "raw_text": "롱혼 스테이크 하우스 예약\n예약번호: 459447\n예약자: 구병모\n이용일: 2025-10-09\n성인 2명, 아동 1명\n총 금액: $304",
  "parsed_data": {
    "reservation_number": "459447",
    "korean_name": "구병모",
    "product_name": "롱혼 스테이크 하우스",
    "usage_date": "2025-10-09",
    "people_adult": 2,
    "people_child": 1,
    "total_amount": 304.00,
    "platform_name": "NOL"
  },
  "parsing_method": "openai",
  "confidence": 0.95
}'
api_call "POST" "/import-booking" "$import_data" "예약 가져오기 (파싱 통합)"

# 15. Export bookings
export_data='{
  "action": "export",
  "filters": {
    "from": "2025-10-01",
    "to": "2025-10-31"
  },
  "export_fields": ["id", "reservation_number", "korean_name", "product_name", "usage_date", "total_amount", "payment_status"]
}'

echo -e "${BLUE}📡 예약 데이터 내보내기 (CSV)${NC}"
echo -e "${YELLOW}POST /api/bookings/bulk${NC}"
echo -e "${YELLOW}Data: $export_data${NC}"

curl -X POST "$BASE_URL/api/bookings/bulk" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: $API_KEY" \
    -d "$export_data" \
    -o "bookings_export.csv"

if [ -f "bookings_export.csv" ]; then
    echo -e "${GREEN}✅ CSV 파일 저장됨: bookings_export.csv${NC}"
    echo "파일 내용 미리보기:"
    head -5 bookings_export.csv
else
    echo -e "${RED}❌ CSV 파일 저장 실패${NC}"
fi

echo ""
echo "----------------------------------------"
echo ""

# 16. Field definitions bulk import
bulk_fields='{
  "fields": [
    {
      "key": "hotel_name",
      "label": "호텔명",
      "type": "string",
      "category": "accommodation",
      "help_text": "투숙 호텔명을 입력하세요"
    },
    {
      "key": "flight_arrival",
      "label": "도착 항공편",
      "type": "string",
      "category": "flight",
      "pattern": "^[A-Z]{2}[0-9]{3,4}$",
      "help_text": "항공편명 (예: KE123)"
    },
    {
      "key": "flight_departure",
      "label": "출발 항공편",
      "type": "string",
      "category": "flight",
      "pattern": "^[A-Z]{2}[0-9]{3,4}$",
      "help_text": "항공편명 (예: KE124)"
    },
    {
      "key": "tour_guide_language",
      "label": "가이드 언어",
      "type": "select",
      "category": "preferences",
      "options": {
        "options": ["korean", "english", "japanese", "chinese"]
      },
      "default_value": "korean"
    }
  ]
}'
api_call "POST" "/api/field-defs/bulk-import" "$bulk_fields" "필드 정의 일괄 가져오기"

# 17. Advanced audit search
audit_search='{
  "actors": ["admin", "system"],
  "actions": ["create", "update"],
  "date_from": "2025-01-01",
  "date_to": "2025-12-31",
  "search_term": "김철수",
  "page": 1,
  "page_size": 20
}'
api_call "POST" "/api/audits/search" "$audit_search" "고급 감사 로그 검색"

# 18. Booking validation (without saving)
validation_data='{
  "reservation_number": "VALIDATE001",
  "korean_name": "테스트사용자",
  "product_name": "테스트 상품",
  "usage_date": "2025-12-01",
  "people_adult": 2,
  "total_amount": 200.00,
  "extras": {
    "pickup_location": "테스트 호텔",
    "special_requests": "테스트 요청사항"
  }
}'
api_call "POST" "/api/bookings/validate" "$validation_data" "예약 데이터 검증 (저장하지 않음)"

# 19. SSE Status
api_call "GET" "/api/sse/status" "" "SSE 연결 상태 확인"

echo -e "${GREEN}🎉 모든 API 테스트 완료!${NC}"
echo ""
echo -e "${YELLOW}📝 추가 테스트 방법:${NC}"
echo "1. SSE 이벤트 구독: curl -N -H 'Accept: text/event-stream' $BASE_URL/events"
echo "2. 실시간 로그 확인: tail -f logs/booking-management.log"
echo "3. 데이터베이스 직접 확인: psql \$DATABASE_URL -c 'SELECT COUNT(*) FROM reservations;'"
echo ""
echo -e "${BLUE}📚 더 많은 예제는 docs/README-BOOKING-MANAGEMENT.md를 참조하세요.${NC}"
