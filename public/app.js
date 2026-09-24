// ============================================================
// 画面側の処理（フレームワークなしの素の JavaScript）
//
// やっていることは 3 つだけ:
//   1. /api/me を呼んで、ログイン中のメールアドレスを表示する
//   2. タブ（一般書籍 / 同人誌）の切り替えを受け付ける
//   3. /api/books を呼んで、一覧を描画する（今は 0 件なので空メッセージが出る）
// ============================================================

const userLabel = document.getElementById("current-user");
const tabs = document.getElementById("tabs");
const bookList = document.getElementById("book-list");
const notice = document.getElementById("notice");

// いま表示している種別。タブを押すと切り替わる。
let currentType = "general";

/**
 * API を呼ぶ共通処理。
 * サーバは常に JSON を返す約束になっているので、ここでまとめて解釈する。
 */
async function callApi(path) {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // サーバが返した説明文（hint）があればそれを、無ければ汎用メッセージを使う
    throw new Error(data.hint || data.error || `通信に失敗しました (${response.status})`);
  }
  return data;
}

/** 画面下部のメッセージ欄。空文字を渡すと非表示になる */
function setNotice(message) {
  notice.textContent = message;
  notice.hidden = message === "";
}

/** ログイン中のユーザを表示する */
async function loadCurrentUser() {
  try {
    const data = await callApi("/api/me");
    userLabel.textContent = data.user.email;
  } catch (error) {
    userLabel.textContent = "未ログイン";
    setNotice(error.message);
  }
}

/** 書籍一覧を読み込んで描画する */
async function loadBooks() {
  try {
    const data = await callApi(`/api/books?type=${currentType}`);
    renderBooks(data.books);
  } catch (error) {
    bookList.replaceChildren();
    setNotice(error.message);
  }
}

/**
 * 一覧を組み立てる。
 * 注意: ユーザが入力した文字列は innerHTML ではなく textContent で入れること。
 * タイトルに HTML タグのような文字が入っていても、そのまま文字として表示される
 * （＝スクリプトを埋め込まれる事故を防げる）。
 */
function renderBooks(books) {
  bookList.replaceChildren();

  if (books.length === 0) {
    setNotice(
      currentType === "general"
        ? "登録されている一般書籍はありません。"
        : "登録されている同人誌はありません。",
    );
    return;
  }

  setNotice("");

  for (const book of books) {
    const item = document.createElement("li");
    item.className = "book";

    const title = document.createElement("span");
    title.className = "book__title";
    title.textContent = book.title;

    // 一般書籍は著者名、同人誌はサークル名を副題として出す
    const sub = document.createElement("span");
    sub.className = "book__sub";
    sub.textContent = book.author || book.circleName || "";

    const status = document.createElement("span");
    status.className = "book__status";
    status.textContent = book.statusName || "";

    item.append(title, sub, status);
    bookList.append(item);
  }
}

/** タブが押されたときの処理 */
tabs.addEventListener("click", (event) => {
  const button = event.target.closest(".tab");
  if (!button) return;

  currentType = button.dataset.type;

  // 見た目上の「選択中」を付け替える
  for (const tab of tabs.querySelectorAll(".tab")) {
    tab.classList.toggle("is-active", tab === button);
  }

  loadBooks();
});

// 起動時の読み込み。
// 初回ログイン時はここでサーバ側にユーザ行とデフォルトのステータス/ジャンルが作られる。
loadCurrentUser().then(loadBooks);
