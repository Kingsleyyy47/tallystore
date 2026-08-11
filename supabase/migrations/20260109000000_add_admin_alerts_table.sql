-- Migration: Add admin_alerts table for SageCloud balance monitoring
-- Date: 2026-01-09
-- Purpose: Store alerts for admin dashboard when SageCloud balance is low/critical

-- Create admin_alerts table
CREATE TABLE IF NOT EXISTS admin_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Alert classification
    alert_type TEXT NOT NULL CHECK (alert_type IN ('low_balance', 'critical_balance', 'insufficient_balance', 'system_error', 'security')),
    severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'critical')),
    
    -- Alert content
    message TEXT NOT NULL,
    context JSONB DEFAULT '{}',
    
    -- Alert management
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    acknowledged_by UUID REFERENCES auth.users(id),
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID REFERENCES auth.users(id),
    resolution_notes TEXT
);

-- Create indexes for common queries
CREATE INDEX idx_admin_alerts_created_at ON admin_alerts(created_at DESC);
CREATE INDEX idx_admin_alerts_type ON admin_alerts(alert_type);
CREATE INDEX idx_admin_alerts_severity ON admin_alerts(severity);
CREATE INDEX idx_admin_alerts_acknowledged ON admin_alerts(acknowledged) WHERE acknowledged = FALSE;

-- Enable RLS
ALTER TABLE admin_alerts ENABLE ROW LEVEL SECURITY;

-- Only admins can view/manage alerts
CREATE POLICY "Admins can view all alerts"
    ON admin_alerts FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.is_admin = TRUE
        )
    );

CREATE POLICY "Admins can update alerts"
    ON admin_alerts FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.is_admin = TRUE
        )
    );

-- Service role (edge functions) can insert alerts
CREATE POLICY "Service role can insert alerts"
    ON admin_alerts FOR INSERT
    TO service_role
    WITH CHECK (TRUE);

-- Also allow authenticated users (via service role key) to insert
-- This is needed because edge functions use service role key
CREATE POLICY "Allow insert via service role"
    ON admin_alerts FOR INSERT
    TO authenticated
    WITH CHECK (TRUE);

-- Create function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_admin_alerts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_admin_alerts_updated_at
    BEFORE UPDATE ON admin_alerts
    FOR EACH ROW
    EXECUTE FUNCTION update_admin_alerts_updated_at();

-- Add comment for documentation
COMMENT ON TABLE admin_alerts IS 'Stores system alerts for admin dashboard - SageCloud balance warnings, security alerts, etc.';
COMMENT ON COLUMN admin_alerts.alert_type IS 'Type: low_balance, critical_balance, insufficient_balance, system_error, security';
COMMENT ON COLUMN admin_alerts.severity IS 'Severity level: info, warning, error, critical';
COMMENT ON COLUMN admin_alerts.context IS 'JSON context data including balance info, thresholds, user_id, etc.';
