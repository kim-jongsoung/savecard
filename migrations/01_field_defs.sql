-- Migration: Create field_defs table for dynamic field management
-- Purpose: Define custom fields, validation rules, and UI metadata

CREATE TABLE IF NOT EXISTS field_defs (
    key TEXT PRIMARY KEY,                    -- Field key (e.g., "pickup_time", "golf_bag_count")
    label TEXT NOT NULL,                     -- Display name for UI
    type TEXT NOT NULL CHECK (type IN (      -- Field type
        'string', 'number', 'date', 'time', 'datetime', 
        'boolean', 'select', 'multiselect', 'textarea', 'email', 'phone'
    )),
    required BOOLEAN DEFAULT FALSE,          -- Is field required
    pattern TEXT,                           -- Regex pattern for validation
    options JSONB,                          -- Options for select/multiselect fields
    default_value TEXT,                     -- Default value
    placeholder TEXT,                       -- Placeholder text
    help_text TEXT,                         -- Help text for UI
    category TEXT DEFAULT 'general',        -- Category for grouping fields
    sort_order INTEGER DEFAULT 0,           -- Sort order in forms
    is_active BOOLEAN DEFAULT TRUE,         -- Is field active
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_field_defs_category ON field_defs (category);
CREATE INDEX IF NOT EXISTS idx_field_defs_sort_order ON field_defs (sort_order);
CREATE INDEX IF NOT EXISTS idx_field_defs_is_active ON field_defs (is_active);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_field_defs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_field_defs_updated_at
    BEFORE UPDATE ON field_defs
    FOR EACH ROW
    EXECUTE FUNCTION update_field_defs_updated_at();

-- Insert default field definitions
INSERT INTO field_defs (key, label, type, category, sort_order, help_text) VALUES
('pickup_location', 'Pickup Location', 'string', 'logistics', 10, 'Hotel or location for pickup'),
('pickup_time', 'Pickup Time', 'time', 'logistics', 20, 'Scheduled pickup time'),
('drop_off_location', 'Drop-off Location', 'string', 'logistics', 30, 'Drop-off location'),
('special_requests', 'Special Requests', 'textarea', 'preferences', 10, 'Any special requests or notes'),
('dietary_restrictions', 'Dietary Restrictions', 'multiselect', 'preferences', 20, 'Dietary restrictions', 
 '{"options": ["vegetarian", "vegan", "gluten_free", "halal", "kosher", "no_seafood", "no_nuts"]}'),
('mobility_assistance', 'Mobility Assistance', 'boolean', 'accessibility', 10, 'Requires mobility assistance'),
('language_preference', 'Language Preference', 'select', 'preferences', 30, 'Preferred guide language',
 '{"options": ["korean", "english", "japanese", "chinese", "spanish"]}'),
('emergency_contact', 'Emergency Contact', 'string', 'contact', 10, 'Emergency contact information'),
('group_size', 'Group Size', 'number', 'booking', 10, 'Total group size'),
('voucher_number', 'Voucher Number', 'string', 'booking', 20, 'Voucher or confirmation number'),
('insurance_required', 'Insurance Required', 'boolean', 'booking', 30, 'Travel insurance required'),
('weather_dependent', 'Weather Dependent', 'boolean', 'booking', 40, 'Activity depends on weather conditions')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE field_defs IS 'Dynamic field definitions for reservation extras';
COMMENT ON COLUMN field_defs.key IS 'Unique field identifier';
COMMENT ON COLUMN field_defs.options IS 'JSON options for select fields: {"options": ["opt1", "opt2"]}';
COMMENT ON COLUMN field_defs.category IS 'Field category for UI grouping';
