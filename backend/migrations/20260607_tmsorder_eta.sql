-- Add ETA field to TmsOrder for transfer logistics scheduling
ALTER TABLE "TmsOrder" ADD COLUMN IF NOT EXISTS eta TIMESTAMPTZ;
