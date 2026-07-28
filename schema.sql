-- Run this in your Supabase SQL editor (https://supabase.com/dashboard/project/mdrnjwljpbmfhttadwxj/sql/new)

CREATE TABLE IF NOT EXISTS parties (
  id TEXT PRIMARY KEY,
  anime_id TEXT NOT NULL,
  episode INTEGER NOT NULL DEFAULT 1,
  series_title TEXT NOT NULL DEFAULT '',
  is_private BOOLEAN NOT NULL DEFAULT false,
  password TEXT,
  created_by UUID REFERENCES auth.users,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read parties" ON parties FOR SELECT USING (true);
CREATE POLICY "Anyone can create parties" ON parties FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can delete old parties" ON parties FOR DELETE USING (true);

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGSERIAL PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read chat" ON chat_messages FOR SELECT USING (true);
CREATE POLICY "Anyone can insert chat" ON chat_messages FOR INSERT WITH CHECK (true);

CREATE TABLE IF NOT EXISTS watch_history (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  anime_id TEXT NOT NULL,
  episode INTEGER NOT NULL DEFAULT 1,
  title TEXT,
  cover_image TEXT,
  type TEXT DEFAULT 'anilist',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, anime_id, episode)
);
ALTER TABLE watch_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own history" ON watch_history FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users upsert own history" ON watch_history FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own history" ON watch_history FOR UPDATE USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS bookmarks (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  anime_id TEXT NOT NULL,
  title TEXT,
  cover_image TEXT,
  type TEXT DEFAULT 'anilist',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, anime_id)
);
ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own bookmarks" ON bookmarks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own bookmarks" ON bookmarks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own bookmarks" ON bookmarks FOR DELETE USING (auth.uid() = user_id);
