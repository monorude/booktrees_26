-- ============================================================
-- Phase 1: 最初のテーブル定義
--   このファイルは「マイグレーション」と呼ばれるもので、
--   データベースの構造を作る SQL を書いておく場所。
--   `npm run db:migrate:local` を実行すると、この中身が実行される。
-- ============================================================

-- ------------------------------------------------------------
-- users: ログインしたユーザ 1 人につき 1 行
--   認証自体は Cloudflare Access + Google に任せているので、
--   パスワードなどは一切保存しない。メールアドレスだけを持つ。
-- ------------------------------------------------------------
CREATE TABLE users (
  id         TEXT PRIMARY KEY,          -- ランダムな UUID
  email      TEXT NOT NULL UNIQUE,      -- Google アカウントのメールアドレス
  created_at TEXT NOT NULL              -- 作成日時（ISO 8601 の文字列）
);

-- ------------------------------------------------------------
-- statuses: 蔵書状態（「未設定」「売却」「破棄」＋ユーザが自由に追加）
--   ユーザごとに別々のリストを持つ（user_id で区切る）。
--   is_protected = 1 の行（「未設定」）は削除できない。
--   他のステータスが削除されたとき、その本はここに戻される。
-- ------------------------------------------------------------
CREATE TABLE statuses (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  is_protected INTEGER NOT NULL DEFAULT 0,  -- 1 = 削除不可（「未設定」用）
  sort_order   INTEGER NOT NULL DEFAULT 0,  -- 画面に並べるときの順番
  created_at   TEXT NOT NULL,
  UNIQUE (user_id, name)                    -- 同じ名前のステータスは作れない
);

-- ------------------------------------------------------------
-- genres: 同人誌のジャンル（1 段階・ユーザが追加/削除可能）
--   statuses と同じ考え方。「未設定」が削除不可のフォールバック。
-- ------------------------------------------------------------
CREATE TABLE genres (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  is_protected INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  UNIQUE (user_id, name)
);

-- ------------------------------------------------------------
-- books: 蔵書そのもの
--   一般書籍と同人誌を 1 つのテーブルにまとめ、book_type で区別する。
--   （画面上はタブで分けるが、検索や書影の扱いが共通なので同じ表にしている）
-- ------------------------------------------------------------
CREATE TABLE books (
  id        TEXT NOT NULL PRIMARY KEY,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_type TEXT NOT NULL CHECK (book_type IN ('general', 'doujin')),

  -- 共通項目
  title  TEXT NOT NULL,
  memo   TEXT,
  status_id TEXT REFERENCES statuses(id),

  -- 一般書籍の項目（同人誌では NULL のまま）
  isbn           TEXT,   -- ハイフンを除去した 10 桁 or 13 桁の数字
  author         TEXT,
  publisher      TEXT,
  published_date TEXT,
  description    TEXT,   -- 販促用テキスト。Phase 5 のクラスタリングで使う

  -- 同人誌の項目（一般書籍では NULL のまま）
  circle_name         TEXT,
  representative_name TEXT,
  event_name          TEXT,
  genre_id            TEXT REFERENCES genres(id),

  -- 書影（Phase 4 で本格運用）
  cover_r2_key     TEXT,  -- R2 に保存したファイルのキー。これが正
  cover_source_url TEXT,  -- 取得元の URL。R2 が空だったときの復旧用

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL   -- 端末間の競合解決（Phase 4）で使う
);

-- 一覧表示は「自分の本を種別ごとに新しい順」で引くことが多いので索引を張る
CREATE INDEX idx_books_user_type ON books (user_id, book_type, created_at DESC);
-- ISBN による重複チェックを速くするための索引
CREATE INDEX idx_books_user_isbn ON books (user_id, isbn);

-- 同人誌は「タイトル + サークル名」が完全一致したら重複、という仕様なので、
-- アプリ側のチェックをすり抜けた場合の保険としてデータベース側でも禁止しておく。
-- （一般書籍はタイトル重複を許すので、book_type = 'doujin' の行だけが対象）
CREATE UNIQUE INDEX idx_doujin_unique
  ON books (user_id, title, circle_name)
  WHERE book_type = 'doujin';
