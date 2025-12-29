-- Run this script in your Supabase SQL Editor to fix the schema issues

-- Add unread_count column to chats table if it doesn't exist
ALTER TABLE chats ADD COLUMN IF NOT EXISTS unread_count INTEGER DEFAULT 0;

-- Ensure profile_pic_url column exists (it should, but just in case)
ALTER TABLE chats ADD COLUMN IF NOT EXISTS profile_pic_url TEXT;

-- Ensure other columns exist
ALTER TABLE chats ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS last_message TEXT;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS timestamp BIGINT;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS session_id TEXT;

-- Verify messages table columns
ALTER TABLE messages ADD COLUMN IF NOT EXISTS ack INTEGER;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_type TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS caption TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS participant_id TEXT;
