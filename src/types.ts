// アプリ全体で使う型をまとめたファイル。
//
// `Env`（DB や COVERS などの「バインディング」の型）は wrangler が
// worker-configuration.d.ts に自動生成してくれるので、ここでは定義しない。
// `npm run cf-typegen` を実行すると wrangler.jsonc の内容から作り直される。

/**
 * Worker が受け取る環境の型。
 * 自動生成された Env に、ローカル開発でだけ使う変数（.dev.vars の中身）を足したもの。
 */
export type AppEnv = Env & {
  /** ローカル開発用。Cloudflare Access が無い環境で「このユーザとしてログイン中」とみなす */
  DEV_EMAIL?: string;
};

/** ログイン中のユーザ */
export interface User {
  id: string;
  email: string;
}

/** 蔵書状態（未設定 / 売却 / 破棄 / ユーザが追加したもの） */
export interface Status {
  id: string;
  name: string;
  /** 1 なら削除禁止（「未設定」がこれにあたる） */
  isProtected: boolean;
  sortOrder: number;
}

/** 同人誌のジャンル */
export interface Genre {
  id: string;
  name: string;
  isProtected: boolean;
}

/** 書籍の種別。画面のタブと 1 対 1 で対応する */
export type BookType = "general" | "doujin";

/**
 * Hono に渡す型定義。
 * Bindings = env の中身、Variables = ミドルウェアが後続に受け渡す値。
 * これを書いておくと c.env.DB や c.get("user") に型が付く。
 */
export type AppContext = {
  Bindings: AppEnv;
  Variables: {
    user: User;
  };
};
