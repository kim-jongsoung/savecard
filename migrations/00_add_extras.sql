-- Migration: Add extras JSONB column to reservations table
-- Purpose: Store dynamic fields without schema changes

-- Add extras column if not exists
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS extras JSONB DEFAULT '{}'::jsonb;

-- Add indexes for extras queries
CREATE INDEX IF NOT EXISTS idx_reservations_extras_gin ON reservations USING GIN (extras);

-- Add review_status if not exists
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS review_status VARCHAR(50) DEFAULT 'pending';

-- Add flags for tracking missing/ambiguous data
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS flags JSONB DEFAULT '{}'::jsonb;

-- Add origin_hash for idempotency
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS origin_hash VARCHAR(64);

-- Add is_deleted for soft delete
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;

-- Add lock_version for optimistic locking
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS lock_version INTEGER DEFAULT 1;

-- Update indexes
CREATE INDEX IF NOT EXISTS idx_reservations_review_status ON reservations (review_status);
CREATE INDEX IF NOT EXISTS idx_reservations_is_deleted ON reservations (is_deleted);
CREATE INDEX IF NOT EXISTS idx_reservations_origin_hash ON reservations (origin_hash);
CREATE INDEX IF NOT EXISTS idx_reservations_usage_date ON reservations (usage_date);
CREATE INDEX IF NOT EXISTS idx_reservations_created_at ON reservations (created_at);
CREATE INDEX IF NOT EXISTS idx_reservations_payment_status ON reservations (payment_status);
CREATE INDEX IF NOT EXISTS idx_reservations_korean_name ON reservations (korean_name);
CREATE INDEX IF NOT EXISTS idx_reservations_email ON reservations (email);

-- Add unique constraint for reservation_number + channel
CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_number_channel 
ON reservations (reservation_number, channel) 
WHERE reservation_number IS NOT NULL AND channel IS NOT NULL;

COMMENT ON COLUMN reservations.extras IS 'Dynamic fields stored as JSONB';
COMMENT ON COLUMN reservations.review_status IS 'Review status: pending, needs_review, reviewed, confirmed, cancelled';
COMMENT ON COLUMN reservations.flags IS 'Flags for missing/ambiguous data';
COMMENT ON COLUMN reservations.origin_hash IS 'Hash for idempotency checks';
COMMENT ON COLUMN reservations.is_deleted IS 'Soft delete flag';
COMMENT ON COLUMN reservations.lock_version IS 'Version for optimistic locking';
