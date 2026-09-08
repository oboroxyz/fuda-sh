# リファクタリング診断 — 操作の寿命と責務の集中を先に整理する

2026-09-08。対象は `main` の `2a9313d` と現在の作業ツリー。README.md と package.json の既存変更は保持した。これは提案中の作業資料であり、現行仕様の正本ではない。今回は診断と計画作成までで、実装は開始していない。

## 優先するのはダッシュボード、issuer API、Graph 通信

確認した範囲では、全体の作り直しを勧める根拠はない。API の chain adapter、入場判定、パス生成、SDK の HTTP 処理はすでに分離されている。一方、機能追加で責務が集まった箇所と、既存の共通処理を使っていない箇所には改善の余地がある。候補に関係する既存テストは計108件が通った。これは選択したテストの結果で、リポジトリ全体の正常性を保証するものではない。

| 優先度 | 対象 | 判断の根拠 | 提案 |
| --- | --- | --- | --- |
| P1 | `apps/dash/src/App.tsx` | member 一覧の世代管理、認証、登録、ロゴ更新、ENS claim、表示が同居。注入可能な `DashIo` は一覧・発行・失効だけ | operator 操作の依存を注入し、セッションに属する非同期操作の寿命を統一する |
| P2 | `apps/api/src/routes/issuers.ts` | HTTP 処理に DB 検索、issuer/card/session の一括書き込み、会員番号生成、Bearer 発行、ENS mirror が混在 | 検索と登録を issuer module に移し、self-serve 発行 route を分ける |
| P3 | `packages/sdk/src/graph.ts` | `postGraph` が存在するが `fetchAnnouncements` は fetch・HTTP 判定・JSON 検証を再実装 | 通信と検証のみ `postGraph` に統一。カーソル処理は維持する |

P1 は競合時の表示・状態への影響が大きい。P2 は仕様変更のたびに読む範囲を減らす効果がある。P3 は小さな重複解消で、単独で実施できる。実装順は P1 → P2 → P3 を推奨するが、依存関係はない。

## ダッシュボードでは、古い応答を反映する条件が揃っていない

`App.tsx:252` の `reload` は token と load generation を確認する。これに対して `onCreate`（447行付近）は await 後に無条件で operator を更新し、`/published` へ遷移する。`onCommitLogo`（473行付近）は現在の issuer の存在だけを確認する。`onSignOut` は API の完了後に session を初期化し、`runClaim` の emit は直接 `setClaimState` に渡している。

ここから「旧操作の完了が、切り替え後の状態へ反映される経路がある」と判断した。ブラウザで競合を再現した確定障害ではない。計画には deferred promise による再現テストを含め、構造変更と挙動修正を分けた。新しい session への遅延反映を防ぐ修正は、純粋なファイル移動とは区別してレビューする。

`ens-claim.ts` にある `initialClaimState` も App では使われていない。ログイン時に読み取った claim 状態と表示の初期状態を合わせる作業を同じ計画に含めた。既存の `app-controller.test.tsx` は admin 操作の競合を詳しく検査している一方、operator 操作を同じ方法で差し替えられない。まず依存を注入できるようにする理由はここにある。

## issuer API は、原子性と応答を維持して分離する

`insertIssuerAndCard`（220行付近）は issuer、最初の card、session の関連付けを `db.batch` でまとめている。このまとまりを保って移動する。汎用 repository interface や全テーブル共通 CRUD は必要ない。`cardsOf` と `venueOf` をまとめ、登録処理は `Context<AppEnv>` 全体を受け取らず、DB・operator・入力・時刻だけを受け取る形にする。

別件として、`insertCard` の全例外を `slug_taken`、issuer 作成時の全例外を `handle_taken` とする処理がある。DB 障害まで競合として扱う可能性があるが、実際の障害注入は未実施。エラー分類の変更はこのリファクタリングに混ぜない。また、logo upload の claim は batch より前に行われるため、これを batch 内へ移す変更も対象外とする。現行の副作用順序を記録したうえで分離する。

## 今回の実装対象にしない候補

`apps/app/src/CardScreen.tsx` は表示と発行・保存・wallet link の取得を含む。`card-screen.test.tsx` は主に表示を検査しており、controller の競合確認は追加調査の価値がある。ただし現状の最上位 route はブラウザの location から決まり、実際に画面をまたぐ経路の確認が必要なので P1 にまとめて扱わない。

`apps/app/src/member-pass-list.ts` は HTTP helper、一覧構築、更新タイマーを含むが、依存を渡せる関数と更新世代の管理がある。大量の right を持つ場合の同時リクエスト数は測定していないため、性能改善を理由に今すぐ変更しない。

`packages/ens-contracts/src/deploy/topology.ts` は長いが、処理順序と chain の操作を表す。preflight、transaction、verify への分離もある。行数だけを理由に分割すると、手順を追いにくくする可能性がある。暗号・Solidity・Rust/AssemblyScript の網羅的監査や live chain の検証は今回実施していない。

`apps/dash/src/copy.ts` の大きさは翻訳データによるもの。分割の優先度を上げる理由にしない。gate の API 呼び出しは既存の SDK HTTP module を利用しており、アプリ全体の通信基盤を作り直す必要も見つからなかった。

## 調査方法と確認結果

構成・ファイル規模を走査し、主要候補の実装、呼び出し元、テストを確認した。`docs/architecture.md` と関連する仕様・ADR の参照関係も確認した。規模は候補選びにだけ使い、優先順位は責務の集中、依存の注入、非同期操作の所有者、重複処理から判断した。すべてのファイルを精査した診断ではない。

| 実行コマンド | 結果 |
| --- | --- |
| `pnpm --filter @fuda/sdk test --run src/graph.test.ts` | 1 file / 25 tests passed、exit 0 |
| `pnpm --filter dash test --run src/app-controller.test.tsx src/app-actions.test.ts src/operator-sign-in.test.ts src/ens-claim.test.ts` | 4 files / 39 tests passed、exit 0 |
| `pnpm --filter api test --run test/issuers.test.ts test/operator-scope.test.ts test/logo.test.ts` | 3 files / 44 tests passed、exit 0。workerd の Broken pipe ログあり。原因未調査 |

全体の `pnpm check` / `pnpm test`、本番アクセス、migration、deploy は実行していない。実装時は各計画の最終 gate で全体検証を行う。

## 独立した Superpowers 計画

各案について、現状維持、責務に沿った分離、汎用フレームワークへの置き換えを比較した。現状維持は短期コストが小さいが P1 の検査不足と P2 の集中を残す。汎用化は interface と移行範囲を増やすため採用しない。既存 module を活かした局所的な分離を推奨する。

- [Dashboard design](2026-09-08-dashboard-operations-design.md) / [implementation plan](../plans/2026-09-08-dashboard-operations.md)
- [Issuer API design](2026-09-08-issuer-modules-design.md) / [implementation plan](../plans/2026-09-08-issuer-modules.md)
- [Graph transport design](2026-09-08-graph-transport-design.md) / [implementation plan](../plans/2026-09-08-graph-transport.md)

計画作成は今回の依頼に基づいて完了させる。実装開始や設計案の承認を受けたとは扱わない。実装後は必要な仕様を正本へ反映し、完了した計画と設計を削除する。この診断は全候補の採否が決まった時点で削除する。
