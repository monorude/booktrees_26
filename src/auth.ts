// ============================================================
// 認証まわり
//
// このアプリは自前でログイン画面を作らない。代わりに Cloudflare Access に任せる。
// 流れは次のとおり:
//
//   ブラウザ → Cloudflare Access（ここで Google ログインが要求される）
//           → 通過した人だけ Worker に届く
//
// Access は通過したリクエストに「誰がログインしたか」を書いた JWT という
// 署名付きの文字列を付けてくれる。Worker 側はその署名を検証し、
// 中に入っているメールアドレスを取り出すだけでよい。
// ============================================================

import { createRemoteJWKSet, jwtVerify } from "jose";
import type { MiddlewareHandler } from "hono";
import type { AppContext, AppEnv } from "./types";
import { findOrCreateUser } from "./db";

/**
 * JWKS = Access が署名に使った鍵の「公開鍵」一覧。
 * 毎回ダウンロードすると遅いので、一度作ったものを使い回す（Worker のメモリ上に残る）。
 */
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let cachedJwksDomain = "";

function getJwks(teamDomain: string) {
  if (!cachedJwks || cachedJwksDomain !== teamDomain) {
    cachedJwks = createRemoteJWKSet(
      new URL(`https://${teamDomain}/cdn-cgi/access/certs`),
    );
    cachedJwksDomain = teamDomain;
  }
  return cachedJwks;
}

/** Access が設定済みかどうか（team domain と AUD の両方が入っていれば設定済み） */
function isAccessConfigured(env: AppEnv): boolean {
  return Boolean(env.ACCESS_TEAM_DOMAIN?.trim() && env.ACCESS_AUD?.trim());
}

/**
 * リクエストからログイン中のメールアドレスを取り出す。
 * 取り出せなければ null（＝未認証）。
 */
async function resolveEmail(
  request: Request,
  env: AppEnv,
): Promise<string | null> {
  // --- 本番: Cloudflare Access の JWT を検証する ---
  if (isAccessConfigured(env)) {
    const teamDomain = env.ACCESS_TEAM_DOMAIN.trim();
    const aud = env.ACCESS_AUD.trim();

    // JWT はヘッダに入ってくるのが基本。ブラウザ直アクセスの場合は Cookie にも入る。
    const token =
      request.headers.get("Cf-Access-Jwt-Assertion") ??
      readCookie(request, "CF_Authorization");
    if (!token) return null;

    try {
      const { payload } = await jwtVerify(token, getJwks(teamDomain), {
        // aud と iss が想定どおりかも同時に検証する。
        // これを省くと「別のアプリ向けに発行された JWT」でも通ってしまう。
        audience: aud,
        issuer: `https://${teamDomain}`,
      });
      const email = payload.email;
      return typeof email === "string" && email.length > 0 ? email : null;
    } catch {
      // 署名が不正・期限切れなどはすべて「未認証」として扱う
      return null;
    }
  }

  // --- ローカル開発: Access が無いので .dev.vars の DEV_EMAIL を使う ---
  // 上の isAccessConfigured() が true のとき（＝本番設定が入っているとき）は
  // ここに来ないので、本番でこの抜け道が使われることはない。
  const devEmail = env.DEV_EMAIL?.trim();
  return devEmail ? devEmail : null;
}

/** リクエストの Cookie ヘッダから 1 個だけ値を取り出す小さな関数 */
function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/**
 * /api/* の前に必ず通す処理。
 * 1) 誰がログインしているか確認する
 * 2) その人の users レコードを用意する（初回ログインなら作る）
 * 3) 後続の処理から c.get("user") で参照できるようにする
 *
 * ここで必ずユーザを特定することが、「各ユーザが自分のデータだけを見る」という
 * 仕様を守るための土台になっている。以降の SQL は必ず user_id で絞り込むこと。
 */
export const requireUser: MiddlewareHandler<AppContext> = async (c, next) => {
  const email = await resolveEmail(c.req.raw, c.env);

  if (!email) {
    const hint = isAccessConfigured(c.env)
      ? "Cloudflare Access のログインが必要です。"
      : "ローカル開発では .dev.vars に DEV_EMAIL を設定してください。";
    return c.json({ error: "unauthorized", hint }, 401);
  }

  const user = await findOrCreateUser(c.env.DB, email);
  c.set("user", user);
  await next();
};
