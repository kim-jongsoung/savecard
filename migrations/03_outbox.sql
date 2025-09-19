-- Migration: Create outbox pattern tables for reliable messaging
-- Purpose: Email and notification queue with retry mechanism

CREATE TABLE IF NOT EXISTS email_outbox (
    id BIGSERIAL PRIMARY KEY,
    booking_id BIGINT,                       -- Optional reference to reservation
    recipient_email TEXT NOT NULL,
    recipient_name TEXT,
    subject TEXT NOT NULL,
    body_text TEXT,
    body_html TEXT,
    template_key TEXT,                       -- Reference to email template
    template_data JSONB,                     -- Data for template rendering
    priority INTEGER DEFAULT 5,             -- 1=highest, 10=lowest
    status TEXT DEFAULT 'pending' CHECK (status IN (
        'pending', 'processing', 'sent', 'failed', 'cancelled'
    )),
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    last_attempt_at TIMESTAMP,
    last_error TEXT,
    scheduled_at TIMESTAMP DEFAULT NOW(),   -- When to send
    sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sms_outbox (
    id BIGSERIAL PRIMARY KEY,
    booking_id BIGINT,                       -- Optional reference to reservation
    recipient_phone TEXT NOT NULL,
    recipient_name TEXT,
    message TEXT NOT NULL,
    template_key TEXT,                       -- Reference to SMS template (KakaoTalk)
    template_data JSONB,                     -- Data for template rendering
    provider TEXT DEFAULT 'kakaotalk',      -- 'kakaotalk', 'sms', etc.
    priority INTEGER DEFAULT 5,
    status TEXT DEFAULT 'pending' CHECK (status IN (
        'pending', 'processing', 'sent', 'failed', 'cancelled'
    )),
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    last_attempt_at TIMESTAMP,
    last_error TEXT,
    scheduled_at TIMESTAMP DEFAULT NOW(),
    sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Notification templates table
CREATE TABLE IF NOT EXISTS notif_templates (
    key TEXT PRIMARY KEY,                    -- Template identifier
    name TEXT NOT NULL,                      -- Human readable name
    type TEXT NOT NULL CHECK (type IN ('email', 'sms', 'kakaotalk')),
    subject TEXT,                            -- For email templates
    body_text TEXT,                          -- Plain text version
    body_html TEXT,                          -- HTML version (email)
    variables JSONB,                         -- Available template variables
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_email_outbox_status ON email_outbox (status);
CREATE INDEX IF NOT EXISTS idx_email_outbox_scheduled_at ON email_outbox (scheduled_at);
CREATE INDEX IF NOT EXISTS idx_email_outbox_booking_id ON email_outbox (booking_id);
CREATE INDEX IF NOT EXISTS idx_email_outbox_priority_scheduled ON email_outbox (priority, scheduled_at) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_sms_outbox_status ON sms_outbox (status);
CREATE INDEX IF NOT EXISTS idx_sms_outbox_scheduled_at ON sms_outbox (scheduled_at);
CREATE INDEX IF NOT EXISTS idx_sms_outbox_booking_id ON sms_outbox (booking_id);
CREATE INDEX IF NOT EXISTS idx_sms_outbox_priority_scheduled ON sms_outbox (priority, scheduled_at) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_notif_templates_type ON notif_templates (type);
CREATE INDEX IF NOT EXISTS idx_notif_templates_is_active ON notif_templates (is_active);

-- Foreign key constraints
ALTER TABLE email_outbox 
ADD CONSTRAINT fk_email_outbox_booking_id 
FOREIGN KEY (booking_id) REFERENCES reservations(id) ON DELETE SET NULL;

ALTER TABLE sms_outbox 
ADD CONSTRAINT fk_sms_outbox_booking_id 
FOREIGN KEY (booking_id) REFERENCES reservations(id) ON DELETE SET NULL;

-- Update triggers
CREATE OR REPLACE FUNCTION update_outbox_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_email_outbox_updated_at
    BEFORE UPDATE ON email_outbox
    FOR EACH ROW
    EXECUTE FUNCTION update_outbox_updated_at();

CREATE TRIGGER trigger_sms_outbox_updated_at
    BEFORE UPDATE ON sms_outbox
    FOR EACH ROW
    EXECUTE FUNCTION update_outbox_updated_at();

CREATE TRIGGER trigger_notif_templates_updated_at
    BEFORE UPDATE ON notif_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_outbox_updated_at();

-- Helper functions for queuing messages
CREATE OR REPLACE FUNCTION queue_email(
    p_booking_id BIGINT,
    p_recipient_email TEXT,
    p_recipient_name TEXT,
    p_subject TEXT,
    p_body_text TEXT DEFAULT NULL,
    p_body_html TEXT DEFAULT NULL,
    p_template_key TEXT DEFAULT NULL,
    p_template_data JSONB DEFAULT NULL,
    p_priority INTEGER DEFAULT 5,
    p_scheduled_at TIMESTAMP DEFAULT NOW()
) RETURNS BIGINT AS $$
DECLARE
    email_id BIGINT;
BEGIN
    INSERT INTO email_outbox (
        booking_id, recipient_email, recipient_name, subject,
        body_text, body_html, template_key, template_data,
        priority, scheduled_at
    ) VALUES (
        p_booking_id, p_recipient_email, p_recipient_name, p_subject,
        p_body_text, p_body_html, p_template_key, p_template_data,
        p_priority, p_scheduled_at
    ) RETURNING id INTO email_id;
    
    RETURN email_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION queue_sms(
    p_booking_id BIGINT,
    p_recipient_phone TEXT,
    p_recipient_name TEXT,
    p_message TEXT,
    p_template_key TEXT DEFAULT NULL,
    p_template_data JSONB DEFAULT NULL,
    p_provider TEXT DEFAULT 'kakaotalk',
    p_priority INTEGER DEFAULT 5,
    p_scheduled_at TIMESTAMP DEFAULT NOW()
) RETURNS BIGINT AS $$
DECLARE
    sms_id BIGINT;
BEGIN
    INSERT INTO sms_outbox (
        booking_id, recipient_phone, recipient_name, message,
        template_key, template_data, provider, priority, scheduled_at
    ) VALUES (
        p_booking_id, p_recipient_phone, p_recipient_name, p_message,
        p_template_key, p_template_data, p_provider, p_priority, p_scheduled_at
    ) RETURNING id INTO sms_id;
    
    RETURN sms_id;
END;
$$ LANGUAGE plpgsql;

-- Insert default notification templates
INSERT INTO notif_templates (key, name, type, subject, body_text, variables) VALUES
('booking_confirmation', 'Booking Confirmation', 'email', 
 'Booking Confirmation - {{reservation_number}}',
 'Dear {{customer_name}},\n\nYour booking has been confirmed.\n\nReservation Number: {{reservation_number}}\nProduct: {{product_name}}\nDate: {{usage_date}}\nTime: {{usage_time}}\n\nThank you for choosing our service!',
 '{"customer_name": "string", "reservation_number": "string", "product_name": "string", "usage_date": "date", "usage_time": "time"}'),

('booking_reminder', 'Booking Reminder', 'sms',
 NULL,
 '[GuamSaveCard] Reminder: Your {{product_name}} is scheduled for {{usage_date}} at {{usage_time}}. Reservation: {{reservation_number}}',
 '{"product_name": "string", "usage_date": "date", "usage_time": "time", "reservation_number": "string"}'),

('booking_cancellation', 'Booking Cancellation', 'email',
 'Booking Cancelled - {{reservation_number}}',
 'Dear {{customer_name}},\n\nYour booking has been cancelled.\n\nReservation Number: {{reservation_number}}\nProduct: {{product_name}}\nCancellation Reason: {{cancellation_reason}}\n\nIf you have any questions, please contact us.',
 '{"customer_name": "string", "reservation_number": "string", "product_name": "string", "cancellation_reason": "string"}')

ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE email_outbox IS 'Outbox pattern for reliable email delivery';
COMMENT ON TABLE sms_outbox IS 'Outbox pattern for reliable SMS/KakaoTalk delivery';
COMMENT ON TABLE notif_templates IS 'Templates for email and SMS notifications';
COMMENT ON FUNCTION queue_email IS 'Helper function to queue email messages';
COMMENT ON FUNCTION queue_sms IS 'Helper function to queue SMS messages';
