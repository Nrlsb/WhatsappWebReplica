-- Script to update the messages table with new media columns

ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS media_type TEXT,
ADD COLUMN IF NOT EXISTS media_url TEXT,
ADD COLUMN IF NOT EXISTS caption TEXT;

-- Optional: Add comments
COMMENT ON COLUMN messages.media_type IS 'Type of media: image, video, audio, document';
COMMENT ON COLUMN messages.media_url IS 'URL or local path to the stored media file';
