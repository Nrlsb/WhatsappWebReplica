-- Add whatsapp_id column and unique constraint to messages table

ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS whatsapp_id TEXT;

-- Add unique constraint to prevent duplicates
-- We use a unique index on whatsapp_id. 
-- Note: If you have existing duplicates, this creation might fail. 
-- You might need to delete duplicates first or drop the table if it's just test data.
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_whatsapp_id ON messages(whatsapp_id);
