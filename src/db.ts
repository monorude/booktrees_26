// ============================================================
// データベース（D1）への読み書きをまとめたファイル
//
// 重要な約束ごと:
//   * SQL に値を埋め込むときは必ず .bind() を使う（文字列連結は絶対にしない）。
//     これを守っている限り SQL インジェクションは起きない。
//   * 本・ステータス・ジャンルを読むときは必ず user_id で絞り込む。
//     これを忘れると他人のデータが見えてしまう。
// ============================================================

import type { BookType, Genre, Status, User } from "./types";

/** 初回ログイン時に作られる蔵書状態。「未設定」だけは削除できない */
const DEFAULT_STATUSES = [
  { name: "未設定", isProtected: true },
  { name: "売却", isProtected: false },
  { name: "破棄", isProtected: false },
];

/** 初回ログイン時に作られるジャンル */
const DEFAULT_GENRES = [{ name: "未設定", isProtected: true }];

/**
 * メールアドレスからユーザを探し、居なければ作る。
 * 新規作成のときはデフォルトのステータス・ジャンルも一緒に入れる。
 */
export async function findOrCreateUser(
  db: D1Database,
  email: string,
): Promise<User> {
  const existing = await selectUserByEmail(db, email);
  if (existing) return existing;

  const userId = crypto.randomUUID();
  const now = new Date().toISOString();

  // batch() に渡した SQL はまとめて 1 つのトランザクションとして実行される。
  // 途中で失敗したら全部取り消されるので、「ユーザだけ出来てステータスが無い」
  // という中途半端な状態にはならない。
  const statements: D1PreparedStatement[] = [
    db
      .prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)")
      .bind(userId, email, now),
  ];

  DEFAULT_STATUSES.forEach((status, index) => {
    statements.push(
      db
        .prepare(
          `INSERT INTO statuses (id, user_id, name, is_protected, sort_order, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          userId,
          status.name,
          status.isProtected ? 1 : 0,
          index,
          now,
        ),
    );
  });

  for (const genre of DEFAULT_GENRES) {
    statements.push(
      db
        .prepare(
          `INSERT INTO genres (id, user_id, name, is_protected, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          userId,
          genre.name,
          genre.isProtected ? 1 : 0,
          now,
        ),
    );
  }

  try {
    await db.batch(statements);
    return { id: userId, email };
  } catch (error) {
    // ブラウザが複数の API を同時に呼ぶと、初回ログイン時に
    // 「同じユーザを作る処理」が同時に走ることがある。
    // その場合 users.email の UNIQUE 制約で片方が失敗するが、
    // 先に成功した行を読み直せばよいだけなので、ここで拾って再取得する。
    const retry = await selectUserByEmail(db, email);
    if (retry) return retry;
    throw error;
  }
}

async function selectUserByEmail(
  db: D1Database,
  email: string,
): Promise<User | null> {
  const row = await db
    .prepare("SELECT id, email FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string; email: string }>();
  return row ? { id: row.id, email: row.email } : null;
}

/** そのユーザの蔵書状態の一覧 */
export async function listStatuses(
  db: D1Database,
  userId: string,
): Promise<Status[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, is_protected, sort_order
         FROM statuses
        WHERE user_id = ?
        ORDER BY sort_order, created_at`,
    )
    .bind(userId)
    .all<{
      id: string;
      name: string;
      is_protected: number;
      sort_order: number;
    }>();

  return results.map((row) => ({
    id: row.id,
    name: row.name,
    isProtected: row.is_protected === 1,
    sortOrder: row.sort_order,
  }));
}

/** そのユーザのジャンルの一覧 */
export async function listGenres(
  db: D1Database,
  userId: string,
): Promise<Genre[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, is_protected
         FROM genres
        WHERE user_id = ?
        ORDER BY is_protected DESC, name`,
    )
    .bind(userId)
    .all<{ id: string; name: string; is_protected: number }>();

  return results.map((row) => ({
    id: row.id,
    name: row.name,
    isProtected: row.is_protected === 1,
  }));
}

/** 一覧画面に出す 1 行分のデータ。書影はリスト表示では使わないので含めない */
export interface BookListItem {
  id: string;
  title: string;
  author: string | null;
  circleName: string | null;
  statusName: string | null;
  createdAt: string;
}

/**
 * そのユーザの書籍一覧を種別（一般書籍 / 同人誌）ごとに取得する。
 * 並び順・検索は Phase 2 で足すので、今は登録の新しい順に固定。
 */
export async function listBooks(
  db: D1Database,
  userId: string,
  bookType: BookType,
): Promise<BookListItem[]> {
  const { results } = await db
    .prepare(
      `SELECT b.id, b.title, b.author, b.circle_name, b.created_at, s.name AS status_name
         FROM books b
         LEFT JOIN statuses s ON s.id = b.status_id
        WHERE b.user_id = ? AND b.book_type = ?
        ORDER BY b.created_at DESC`,
    )
    .bind(userId, bookType)
    .all<{
      id: string;
      title: string;
      author: string | null;
      circle_name: string | null;
      created_at: string;
      status_name: string | null;
    }>();

  return results.map((row) => ({
    id: row.id,
    title: row.title,
    author: row.author,
    circleName: row.circle_name,
    statusName: row.status_name,
    createdAt: row.created_at,
  }));
}
