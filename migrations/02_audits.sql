-- Migration: Create reservation_audits table for audit logging
-- Purpose: Track all changes to reservations with full diff and metadata

CREATE TABLE IF NOT EXISTS reservation_audits (
    audit_id BIGSERIAL PRIMARY KEY,
    booking_id BIGINT NOT NULL,              -- Reference to reservations.id
    actor TEXT,                              -- Who made the change (user ID, system, etc.)
    action TEXT NOT NULL CHECK (action IN (  -- What action was performed
        'create', 'update', 'cancel', 'restore', 'delete', 'bulk_update'
    )),
    diff JSONB,                              -- Detailed diff of changes
    previous_values JSONB,                   -- Previous state (for rollback)
    current_values JSONB,                    -- Current state after change
    reason TEXT,                             -- Reason for change
    ip_address INET,                         -- IP address of actor
    user_agent TEXT,                         -- User agent string
    request_id TEXT,                         -- Request ID for tracing
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_audits_booking_id ON reservation_audits (booking_id);
CREATE INDEX IF NOT EXISTS idx_audits_actor ON reservation_audits (actor);
CREATE INDEX IF NOT EXISTS idx_audits_action ON reservation_audits (action);
CREATE INDEX IF NOT EXISTS idx_audits_created_at ON reservation_audits (created_at);
CREATE INDEX IF NOT EXISTS idx_audits_request_id ON reservation_audits (request_id);

-- Foreign key constraint
ALTER TABLE reservation_audits 
ADD CONSTRAINT fk_audits_booking_id 
FOREIGN KEY (booking_id) REFERENCES reservations(id) ON DELETE CASCADE;

-- Function to automatically create audit log
CREATE OR REPLACE FUNCTION create_reservation_audit(
    p_booking_id BIGINT,
    p_actor TEXT,
    p_action TEXT,
    p_diff JSONB DEFAULT NULL,
    p_previous_values JSONB DEFAULT NULL,
    p_current_values JSONB DEFAULT NULL,
    p_reason TEXT DEFAULT NULL,
    p_ip_address INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL,
    p_request_id TEXT DEFAULT NULL
) RETURNS BIGINT AS $$
DECLARE
    audit_id BIGINT;
BEGIN
    INSERT INTO reservation_audits (
        booking_id, actor, action, diff, previous_values, 
        current_values, reason, ip_address, user_agent, request_id
    ) VALUES (
        p_booking_id, p_actor, p_action, p_diff, p_previous_values,
        p_current_values, p_reason, p_ip_address, p_user_agent, p_request_id
    ) RETURNING reservation_audits.audit_id INTO audit_id;
    
    RETURN audit_id;
END;
$$ LANGUAGE plpgsql;

-- Trigger function for automatic audit logging on reservations table
CREATE OR REPLACE FUNCTION reservation_audit_trigger()
RETURNS TRIGGER AS $$
DECLARE
    diff_json JSONB;
    actor_name TEXT;
BEGIN
    -- Get actor from session variable (set by application)
    actor_name := current_setting('app.current_actor', true);
    IF actor_name IS NULL OR actor_name = '' THEN
        actor_name := 'system';
    END IF;

    IF TG_OP = 'INSERT' THEN
        PERFORM create_reservation_audit(
            NEW.id,
            actor_name,
            'create',
            NULL,
            NULL,
            to_jsonb(NEW),
            'Record created'
        );
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        -- Calculate diff
        diff_json := jsonb_diff(to_jsonb(OLD), to_jsonb(NEW));
        
        IF diff_json != '{}'::jsonb THEN
            PERFORM create_reservation_audit(
                NEW.id,
                actor_name,
                'update',
                diff_json,
                to_jsonb(OLD),
                to_jsonb(NEW),
                'Record updated'
            );
        END IF;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM create_reservation_audit(
            OLD.id,
            actor_name,
            'delete',
            NULL,
            to_jsonb(OLD),
            NULL,
            'Record deleted'
        );
        RETURN OLD;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate JSONB diff
CREATE OR REPLACE FUNCTION jsonb_diff(old_val JSONB, new_val JSONB)
RETURNS JSONB AS $$
DECLARE
    result JSONB := '{}'::jsonb;
    key TEXT;
    old_sub JSONB;
    new_sub JSONB;
BEGIN
    -- Find changed and new keys
    FOR key IN SELECT jsonb_object_keys(new_val) LOOP
        new_sub := new_val -> key;
        old_sub := old_val -> key;
        
        IF old_sub IS NULL THEN
            -- New key
            result := result || jsonb_build_object(key, jsonb_build_object('new', new_sub));
        ELSIF old_sub != new_sub THEN
            -- Changed key
            result := result || jsonb_build_object(key, jsonb_build_object('old', old_sub, 'new', new_sub));
        END IF;
    END LOOP;
    
    -- Find deleted keys
    FOR key IN SELECT jsonb_object_keys(old_val) LOOP
        IF new_val -> key IS NULL THEN
            result := result || jsonb_build_object(key, jsonb_build_object('old', old_val -> key, 'deleted', true));
        END IF;
    END LOOP;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Create trigger (disabled by default, enable when needed)
-- CREATE TRIGGER reservation_audit_trigger
--     AFTER INSERT OR UPDATE OR DELETE ON reservations
--     FOR EACH ROW EXECUTE FUNCTION reservation_audit_trigger();

COMMENT ON TABLE reservation_audits IS 'Audit log for all reservation changes';
COMMENT ON COLUMN reservation_audits.diff IS 'JSONB diff showing what changed';
COMMENT ON COLUMN reservation_audits.actor IS 'User ID or system identifier who made the change';
COMMENT ON FUNCTION create_reservation_audit IS 'Helper function to create audit entries';
