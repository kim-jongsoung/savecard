-- Notification Templates for Booking Management System
-- 예약 관리 시스템용 알림 템플릿

-- Create notification templates table if not exists
CREATE TABLE IF NOT EXISTS notif_templates (
    template_id SERIAL PRIMARY KEY,
    template_code VARCHAR(50) UNIQUE NOT NULL,
    template_name VARCHAR(100) NOT NULL,
    template_type VARCHAR(20) NOT NULL CHECK (template_type IN ('email', 'kakao', 'sms')),
    subject VARCHAR(200),
    content TEXT NOT NULL,
    variables JSONB,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Clear existing templates
DELETE FROM notif_templates WHERE template_code LIKE 'BOOKING_%' OR template_code LIKE 'RESERVATION_%';

-- Email Templates
INSERT INTO notif_templates (template_code, template_name, template_type, subject, content, variables, is_active) VALUES

-- Booking Confirmation Email
('BOOKING_CONFIRMATION', '예약 확인 이메일', 'email', '[괌세이브카드] 예약 확인 - {{product_name}}', 
'<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>예약 확인</title>
    <style>
        body { font-family: "Noto Sans KR", Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(45deg, #667eea, #764ba2); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
        .info-row { margin: 15px 0; padding: 10px; background: white; border-radius: 5px; display: flex; }
        .label { font-weight: bold; color: #495057; min-width: 120px; }
        .value { color: #212529; flex: 1; }
        .footer { text-align: center; margin-top: 30px; color: #6c757d; font-size: 14px; }
        .highlight { background: #d4edda; padding: 15px; border-radius: 5px; border-left: 4px solid #28a745; margin: 20px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎉 예약이 확정되었습니다!</h1>
            <p>괌세이브카드와 함께하는 특별한 여행</p>
        </div>
        <div class="content">
            <div class="highlight">
                <strong>예약번호: {{reservation_number}}</strong><br>
                예약 확인 및 문의 시 반드시 필요한 번호입니다.
            </div>
            
            <div class="info-row">
                <span class="label">상품명:</span>
                <span class="value">{{product_name}}</span>
            </div>
            <div class="info-row">
                <span class="label">예약자:</span>
                <span class="value">{{customer_name}}</span>
            </div>
            <div class="info-row">
                <span class="label">이용일:</span>
                <span class="value">{{usage_date}}</span>
            </div>
            {{#if usage_time}}
            <div class="info-row">
                <span class="label">이용시간:</span>
                <span class="value">{{usage_time}}</span>
            </div>
            {{/if}}
            <div class="info-row">
                <span class="label">인원:</span>
                <span class="value">성인 {{people_adult}}명{{#if people_child}}, 소아 {{people_child}}명{{/if}}{{#if people_infant}}, 유아 {{people_infant}}명{{/if}}</span>
            </div>
            <div class="info-row">
                <span class="label">총 금액:</span>
                <span class="value">${{total_amount}}</span>
            </div>
            {{#if pickup_location}}
            <div class="info-row">
                <span class="label">픽업 장소:</span>
                <span class="value">{{pickup_location}}</span>
            </div>
            {{/if}}
            {{#if special_requests}}
            <div class="info-row">
                <span class="label">특별 요청:</span>
                <span class="value">{{special_requests}}</span>
            </div>
            {{/if}}
        </div>
        <div class="footer">
            <p><strong>중요 안내사항</strong></p>
            <p>• 투어 전날 픽업 시간과 장소를 재확인해 드립니다.</p>
            <p>• 날씨나 현지 사정에 따라 일정이 변경될 수 있습니다.</p>
            <p>• 취소는 이용일 24시간 전까지 가능합니다.</p>
            <br>
            <p>문의사항이 있으시면 언제든 연락주세요.</p>
            <p><strong>괌세이브카드 고객센터</strong></p>
            <p>📞 1588-0000 | 📧 support@guamsavecard.com</p>
        </div>
    </div>
</body>
</html>', 
'{"reservation_number": "string", "product_name": "string", "customer_name": "string", "usage_date": "string", "usage_time": "string", "people_adult": "number", "people_child": "number", "people_infant": "number", "total_amount": "number", "pickup_location": "string", "special_requests": "string"}', 
true),

-- Booking Cancellation Email
('BOOKING_CANCELLATION', '예약 취소 이메일', 'email', '[괌세이브카드] 예약 취소 안내 - {{product_name}}',
'<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>예약 취소 안내</title>
    <style>
        body { font-family: "Noto Sans KR", Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #dc3545; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
        .info-row { margin: 15px 0; padding: 10px; background: white; border-radius: 5px; display: flex; }
        .label { font-weight: bold; color: #495057; min-width: 120px; }
        .value { color: #212529; flex: 1; }
        .footer { text-align: center; margin-top: 30px; color: #6c757d; font-size: 14px; }
        .warning { background: #fff3cd; padding: 15px; border-radius: 5px; border-left: 4px solid #ffc107; margin: 20px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>예약이 취소되었습니다</h1>
            <p>취소 처리가 완료되었습니다</p>
        </div>
        <div class="content">
            <div class="info-row">
                <span class="label">예약번호:</span>
                <span class="value">{{reservation_number}}</span>
            </div>
            <div class="info-row">
                <span class="label">상품명:</span>
                <span class="value">{{product_name}}</span>
            </div>
            <div class="info-row">
                <span class="label">예약자:</span>
                <span class="value">{{customer_name}}</span>
            </div>
            <div class="info-row">
                <span class="label">취소일:</span>
                <span class="value">{{cancellation_date}}</span>
            </div>
            {{#if cancellation_reason}}
            <div class="info-row">
                <span class="label">취소 사유:</span>
                <span class="value">{{cancellation_reason}}</span>
            </div>
            {{/if}}
            
            <div class="warning">
                <strong>환불 안내</strong><br>
                환불 처리는 결제 수단에 따라 3-7일 소요될 수 있습니다.<br>
                환불 금액: ${{refund_amount}}
            </div>
        </div>
        <div class="footer">
            <p>환불 관련 문의사항이 있으시면 고객센터로 연락주세요.</p>
            <p><strong>괌세이브카드 고객센터</strong></p>
            <p>📞 1588-0000 | 📧 support@guamsavecard.com</p>
        </div>
    </div>
</body>
</html>',
'{"reservation_number": "string", "product_name": "string", "customer_name": "string", "cancellation_date": "string", "cancellation_reason": "string", "refund_amount": "number"}',
true),

-- Reminder Email (Day Before)
('BOOKING_REMINDER_D1', '예약 리마인더 (전날)', 'email', '[괌세이브카드] 내일 예약 안내 - {{product_name}}',
'<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>예약 리마인더</title>
    <style>
        body { font-family: "Noto Sans KR", Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(45deg, #28a745, #20c997); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
        .info-row { margin: 15px 0; padding: 10px; background: white; border-radius: 5px; display: flex; }
        .label { font-weight: bold; color: #495057; min-width: 120px; }
        .value { color: #212529; flex: 1; }
        .footer { text-align: center; margin-top: 30px; color: #6c757d; font-size: 14px; }
        .highlight { background: #d4edda; padding: 15px; border-radius: 5px; border-left: 4px solid #28a745; margin: 20px 0; }
        .checklist { background: #e3f2fd; padding: 15px; border-radius: 5px; margin: 20px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔔 내일 예약 안내</h1>
            <p>곧 다가오는 예약을 확인해주세요</p>
        </div>
        <div class="content">
            <div class="highlight">
                <strong>내일 이용 예정인 예약이 있습니다!</strong>
            </div>
            
            <div class="info-row">
                <span class="label">예약번호:</span>
                <span class="value">{{reservation_number}}</span>
            </div>
            <div class="info-row">
                <span class="label">상품명:</span>
                <span class="value">{{product_name}}</span>
            </div>
            <div class="info-row">
                <span class="label">이용일:</span>
                <span class="value">{{usage_date}}</span>
            </div>
            {{#if pickup_time}}
            <div class="info-row">
                <span class="label">픽업 시간:</span>
                <span class="value">{{pickup_time}}</span>
            </div>
            {{/if}}
            {{#if pickup_location}}
            <div class="info-row">
                <span class="label">픽업 장소:</span>
                <span class="value">{{pickup_location}}</span>
            </div>
            {{/if}}
            
            <div class="checklist">
                <strong>📋 투어 전 체크리스트</strong><br>
                ✅ 여권 또는 신분증 지참<br>
                ✅ 편안한 복장과 운동화 착용<br>
                ✅ 선크림 및 모자 준비<br>
                ✅ 충분한 수분 섭취<br>
                {{#if special_requirements}}
                ✅ 특별 요청사항: {{special_requirements}}
                {{/if}}
            </div>
        </div>
        <div class="footer">
            <p>즐거운 여행 되시기 바랍니다! 🌴</p>
            <p><strong>괌세이브카드 고객센터</strong></p>
            <p>📞 1588-0000 | 📧 support@guamsavecard.com</p>
        </div>
    </div>
</body>
</html>',
'{"reservation_number": "string", "product_name": "string", "usage_date": "string", "pickup_time": "string", "pickup_location": "string", "special_requirements": "string"}',
true);

-- KakaoTalk Templates
INSERT INTO notif_templates (template_code, template_name, template_type, subject, content, variables, is_active) VALUES

-- KakaoTalk Confirmation
('KAKAO_BOOKING_CONFIRM', '카카오톡 예약 확인', 'kakao', NULL,
'🎉 예약이 확정되었습니다!

📋 예약 정보
• 예약번호: {{reservation_number}}
• 상품명: {{product_name}}
• 예약자: {{customer_name}}
• 이용일: {{usage_date}}
{{#if usage_time}}• 이용시간: {{usage_time}}{{/if}}
• 인원: 성인{{people_adult}}명{{#if people_child}}, 소아{{people_child}}명{{/if}}
• 금액: ${{total_amount}}

{{#if pickup_location}}
🚌 픽업 정보
• 장소: {{pickup_location}}
{{#if pickup_time}}• 시간: {{pickup_time}}{{/if}}
{{/if}}

📞 문의: 1588-0000
🌐 괌세이브카드',
'{"reservation_number": "string", "product_name": "string", "customer_name": "string", "usage_date": "string", "usage_time": "string", "people_adult": "number", "people_child": "number", "total_amount": "number", "pickup_location": "string", "pickup_time": "string"}',
true),

-- KakaoTalk Cancellation
('KAKAO_BOOKING_CANCEL', '카카오톡 예약 취소', 'kakao', NULL,
'❌ 예약이 취소되었습니다

📋 취소 정보
• 예약번호: {{reservation_number}}
• 상품명: {{product_name}}
• 예약자: {{customer_name}}
• 취소일: {{cancellation_date}}
{{#if cancellation_reason}}• 취소사유: {{cancellation_reason}}{{/if}}

💰 환불 안내
• 환불금액: ${{refund_amount}}
• 처리기간: 3-7일

📞 문의: 1588-0000
🌐 괌세이브카드',
'{"reservation_number": "string", "product_name": "string", "customer_name": "string", "cancellation_date": "string", "cancellation_reason": "string", "refund_amount": "number"}',
true),

-- KakaoTalk Reminder
('KAKAO_BOOKING_REMINDER', '카카오톡 예약 리마인더', 'kakao', NULL,
'🔔 내일 예약 안내

📋 예약 정보
• 예약번호: {{reservation_number}}
• 상품명: {{product_name}}
• 이용일: {{usage_date}}
{{#if pickup_time}}• 픽업시간: {{pickup_time}}{{/if}}
{{#if pickup_location}}• 픽업장소: {{pickup_location}}{{/if}}

📝 준비사항
✅ 신분증 지참
✅ 편안한 복장
✅ 선크림, 모자
✅ 충분한 수분

🌴 즐거운 여행 되세요!
📞 문의: 1588-0000',
'{"reservation_number": "string", "product_name": "string", "usage_date": "string", "pickup_time": "string", "pickup_location": "string"}',
true);

-- SMS Templates
INSERT INTO notif_templates (template_code, template_name, template_type, subject, content, variables, is_active) VALUES

-- SMS Confirmation
('SMS_BOOKING_CONFIRM', 'SMS 예약 확인', 'sms', NULL,
'[괌세이브카드] 예약확정
예약번호: {{reservation_number}}
상품: {{product_name}}
일시: {{usage_date}} {{usage_time}}
문의: 1588-0000',
'{"reservation_number": "string", "product_name": "string", "usage_date": "string", "usage_time": "string"}',
true),

-- SMS Reminder
('SMS_BOOKING_REMINDER', 'SMS 예약 리마인더', 'sms', NULL,
'[괌세이브카드] 내일 예약안내
{{product_name}}
{{usage_date}} {{pickup_time}}
{{pickup_location}}
문의: 1588-0000',
'{"product_name": "string", "usage_date": "string", "pickup_time": "string", "pickup_location": "string"}',
true),

-- SMS Cancellation
('SMS_BOOKING_CANCEL', 'SMS 예약 취소', 'sms', NULL,
'[괌세이브카드] 예약취소
예약번호: {{reservation_number}}
환불: ${{refund_amount}} (3-7일)
문의: 1588-0000',
'{"reservation_number": "string", "refund_amount": "number"}',
true);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_notif_templates_code ON notif_templates (template_code);
CREATE INDEX IF NOT EXISTS idx_notif_templates_type ON notif_templates (template_type);
CREATE INDEX IF NOT EXISTS idx_notif_templates_active ON notif_templates (is_active);

-- Create trigger to update updated_at
CREATE OR REPLACE FUNCTION update_notif_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_notif_templates_updated_at
    BEFORE UPDATE ON notif_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_notif_templates_updated_at();

-- Display summary
SELECT 
    template_type,
    COUNT(*) as template_count,
    COUNT(CASE WHEN is_active = true THEN 1 END) as active_count
FROM notif_templates 
GROUP BY template_type
ORDER BY template_type;
