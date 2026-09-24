// ============================================================
// Worker の入り口
//
// public/ にあるファイル（HTML・CSS・JS）は Worker を通らずに配信される。
// ここに来るのは主に /api/... へのリクエスト。
//
// Hono は「どの URL が来たらどの処理をするか」を書きやすくするための小さな部品。
// ============================================================

import { Hono } from "hono";
import { requireUser } from "./auth";
import { listBooks, listGenres, listStatuses } from "./db";
import type { AppContext, BookType } from "./types";

const app = new Hono<AppContext>();

// /api/ で始まるリクエストは、すべて認証を通してから処理する。
// これ以降の処理では c.get("user") で「今ログインしている人」が取れる。
app.use("/api/*", requireUser);

/** ログイン中のユーザ情報。画面右上の表示に使う */
app.get("/api/me", (c) => {
  return c.json({ user: c.get("user") });
});

/** 書籍一覧。?type=general（一般書籍）か ?type=doujin（同人誌）で切り替える */
app.get("/api/books", async (c) => {
  const type = c.req.query("type") ?? "general";
  if (type !== "general" && type !== "doujin") {
    return c.json({ error: "type は general か doujin を指定してください" }, 400);
  }

  const books = await listBooks(c.env.DB, c.get("user").id, type as BookType);
  return c.json({ books });
});

/** 蔵書状態の一覧（未設定 / 売却 / 破棄 / ユーザが追加したもの） */
app.get("/api/statuses", async (c) => {
  const statuses = await listStatuses(c.env.DB, c.get("user").id);
  return c.json({ statuses });
});

/** ジャンルの一覧（同人誌用） */
app.get("/api/genres", async (c) => {
  const genres = await listGenres(c.env.DB, c.get("user").id);
  return c.json({ genres });
});

// 上のどれにも当てはまらない /api/... は 404 を返す。
// （HTML を返してしまうとフロント側の fetch が変な壊れ方をするため）
app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

// 処理中に予想外のエラーが起きた場合も JSON で返す。
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal error" }, 500);
});

export default app;
