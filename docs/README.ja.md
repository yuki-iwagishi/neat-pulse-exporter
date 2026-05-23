# Neat Pulse 設定エクスポーター

**[English](../README.md)** · [日本語](./README.ja.md) · [한국어](./README.ko.md) · [繁體中文](./README.zh-TW.md) · [简体中文](./README.zh-CN.md)

---

[Neat Pulse API](https://api.pulse.neat.no/docs/) からデバイスごとの設定を CSV ファイルとしてエクスポートし、会議室デバイスの Excel 在庫管理表と照合するための Node.js 製 Web ツールです。

> ⚠️ **非公式ツールです。** Neat 社とは無関係であり、公式に承認されたものではありません。公開ドキュメントに記載されたエンドポイントを、提供された API キーを使って呼び出すのみです。

## 機能

- **ルーム単位**でデバイスを取得（`GET /orgs/{org}/rooms` → `GET /orgs/{org}/rooms/{id}`）するため、ロケーションおよびリージョンの情報が含まれます。
- 各デバイスの現在の設定（`GET /endpoints/{id}/config`）と、割り当てられたプロファイル（`GET /profiles/{profileId}`）を取得します。
- 各設定キーに対して 3 種類の列を出力します：
  - `config.*` — デバイス本体に書き込まれた値
  - `profile.*` — 割り当てプロファイルで宣言された値
  - `effective.*` — デバイス優先・プロファイル補完のマージ値
- base64 エンコードされた MAC / IPv4 / IPv6 / ゲートウェイフィールドをデコードし、ストレージ容量を GB 単位で表示します。
- Server-Sent Events を使ってブラウザにリアルタイムで進捗を表示します。
- パスワード・トークン・シークレット等のキーに対応する値を自動的にマスクします（`settingsPasswordRequired` のようなフラグは除く）。
- Excel で UTF-8 を正しく開けるよう、CSV に UTF-8 BOM を付与します。

## 検証済みスケール

実環境のテナント（**560 エンドポイント、296 ルーム、25 プロファイル、11 モデル**）でエラー 0 件での完全エクスポートを確認済みです。デフォルトの `CONCURRENCY=3` はこの規模でのレート制限回避に合わせて設定しています。小規模環境では引き上げ可能です。

## 動作要件

- Node.js 18 以上（グローバル `fetch` を使用）
- Neat Pulse **Plus** または **Pro** プラン（API キー発行に必要）
- **Pulse → Settings → API** で発行した API キー
- 組織 ID（`orgId`）

## セットアップ

```bash
git clone https://github.com/<your-account>/neat-pulse-exporter.git
cd neat-pulse-exporter
npm install
cp .env.example .env   # 任意、下記参照
npm start
```

ブラウザで <http://127.0.0.1:3000> を開いてください。

### `.env` による設定（任意）

`.env.example` を `.env` にコピーして値を記入します。すべての変数は省略可能です。

| 変数名          | デフォルト  | 説明                                                                |
| --------------- | ----------- | ------------------------------------------------------------------- |
| `PORT`          | `3000`      | HTTP ポート番号                                                     |
| `HOST`          | `127.0.0.1` | バインドアドレス。LAN 公開する場合のみ `0.0.0.0` を使用            |
| `CONCURRENCY`   | `3`         | Pulse API への最大同時リクエスト数                                   |
| `PULSE_API_KEY` | _(空)_      | 設定するとブラウザ UI での入力が不要になります                       |
| `PULSE_ORG_ID`  | _(空)_      | 同上（組織 ID）                                                     |

> **実際の `.env` は絶対にコミットしないでください。** `.gitignore` に登録済みです。

## 使い方

1. `npm start` を実行してブラウザでページを開く。
2. API キーと組織 ID を入力（`.env` に設定済みの場合は不要）。
3. **CSV にエクスポート** をクリック。進捗がリアルタイムで表示されます。
4. 完了すると CSV ダウンロードが自動的に始まります。

CSV はデバイス 1 台につき 1 行です。列はすべてのデバイスのキーをユニオンしてアルファベット順に並べるため、異なるモデルが混在しても 1 ファイルに収まります。

## カスタマイズ

### 機密フィールドのマスク

`src/server.js` 内の `isSecretKey()` 関数がマスク対象を判定します。キー名に `password`、`secret`、`token`、`apiKey`、`privateKey`、`credential` が含まれる場合に値を `***MASKED***` に置換します。必要に応じてパターンを編集してください。

### Excel シートの列に合わせる

デフォルトでは API が返すすべてのキーが列になります。Excel の固定列に合わせる場合は、Excel 側で `VLOOKUP` / Power Query を使うか、`/api/export` 内の `buildRow()` 関数を編集して必要なキーだけを出力するよう変更してください。

## Pulse API の既知の制限

実環境の Pulse API に対して調査・確認した事項です（2026 年 5 月）。

### 1. モデル依存のキー

一部の設定はデバイスのモデルが対応している場合のみ `/endpoints/{id}/config` に含まれます。例えば `hdmiSleepSignal` は Neat Bar Pro では対応していますが、旧 Neat Bar では含まれません。対応していないモデルでは `config.hdmiSleepSignal` が空欄になりますが、`effective.*` はプロファイルの値で補完します（ただし実際にデバイスに適用されているとは限りません）。

### 2. プロファイル継承値はデバイス設定から省略される

`GET /endpoints/{id}/config` はデバイスに**明示的に書き込まれたキーのみ**を返します。プロファイルからの継承値は省略されます。これは Pulse の正常な仕様です。ツールはプロファイルも取得してマージし `effective.*` に反映します。

### 3. プロファイルロック設定へのローカル上書き

プロファイル適用時、Pulse UI は設定を「locked by profile」として表示しますが、デバイス本体の UI から上書きは可能です。上書きされると Pulse UI に警告（「A locked profile setting has been changed on this device」）が表示されます。上書き値は `/endpoints/{id}/config` に反映されるため `effective.*` は正しい値を示しますが、**どのキーが上書き状態かは API から判定できません**。`_source.*` 列でデバイス由来かプロファイル由来かを確認できますが、上書き状態の検出には Pulse UI での目視確認が必要です。

### 4. `office_hours`（スリープスケジュール）は書き込み専用

スリープスケジュールのトグルと時刻範囲（内部キー名 `office_hours`、`office_hours_enabled`）は UI で設定でき監査ログにも記録されますが、いかなる Read API エンドポイントからも返されません。CSV にはエクスポートできないため、Excel 照合は手動で行う必要があります。Neat に報告済みです。

### 5. その他の書き込み専用キー

560 エンドポイント規模のテナントでの調査で、さらに **24 個のキー**が `office_hours` と同様に書き込み専用（Read API に含まれない）であることを確認しました：

**Channel apps（16 個）** — アプリ別の有効化トグルは一切返されません：

```
channelAppsAppspace      channelAppsKahoot       channelAppsSmartenspaces
channelAppsAround        channelAppsMiro         channelAppsSpotify
channelAppsBrowser       channelAppsRobin        channelAppsTeams
channelAppsHubspot       channelAppsSlack        channelAppsTrello
channelAppsJira          channelAppsZoom         channelAppsWhatsapp
                                                  channelAppsWorkplace
```

**その他の書き込み専用キー：**

```
homeApp                       avosChannel
kioskMode                     scheduledFirmwareUpdateDelay
ngmsEnabled                   settingsPassword
ngmsFeatureToggle             settingsPasswordMode
```

`settingsPassword` と Remote access パスワードはセキュリティ上の理由で省略されており、それ以外は Read API のギャップと見られます。`office_hours` 件とあわせて Neat に報告済みです。

### カバレッジの概要

プロファイルが割り当てられた一般的なデバイスでは、Pulse UI で表示される設定のうち **35 / 45 項目程度**を `profile.*` で取得でき、さらに `pairingSerial` や `wifiEnabled` など 14 個のデバイス固有キーを `config.*` で取得できます。上記の 24 + 2 個のキーは Neat が Read API で公開するまで取得不可です。

## セキュリティに関する注意事項

- **API キーはブラウザからローカルの Node プロセスへ POST リクエストのボディで送信されます。** URL クエリパラメータには含まれません。ログへの記録も永続保存も一切行われません。
- **エクスポートした CSV にはネットワーク情報**（MAC アドレス、IP アドレス、ルーム・ロケーションのメタデータ）が含まれることがあります。他の機密ドキュメントと同様に適切に管理してください。
- **デフォルトは `127.0.0.1` にバインドされます。** `HOST` に非ループバックアドレスを指定するとサーバー起動時に警告が表示され、UI にもバナーが表示されます。同一ネットワーク上の誰でもエクスポートを実行できる状態になります。
- **Web UI に認証機能は組み込まれていません。** チームで共有する場合は既存の SSO / リバースプロキシの背後に配置するか、Electron デスクトップアプリとしてパッケージングしてください。

### シークレット検出の限界

キー名のパターン（`password`、`secret`、`token`、`apiKey`、`privateKey`、`credential`）でマスク対象を判定しています。この手法には既知の限界があります：

| 種別 | 誤検出の例 |
|------|-----------|
| 過剰マスク（誤検知） | `secretariatMode`、`tokenRefreshInterval` |
| マスク漏れ（未検知） | `pwd`、`clientKey`、`bearer`、`passphrase` |

**外部に共有する前に、必ずエクスポートした CSV を目視確認してください。**

## プロジェクト構成

```
neat-pulse-exporter/
├── docs/
│   ├── api_findings.md        # Pulse API の調査記録
│   ├── README.ja.md           # このファイル
│   ├── README.ko.md           # 한국어
│   ├── README.zh-TW.md        # 繁體中文
│   └── README.zh-CN.md        # 简体中文
├── examples/
│   └── sample_output_columns.txt   # CSV 列一覧サンプル
├── public/
│   └── index.html        # Web UI（ビルド不要）
├── src/
│   └── server.js         # Express サーバー + Pulse API クライアント
├── .env.example
├── .gitignore
├── CHANGELOG.md
├── LICENSE
├── package.json
└── README.md             # English
```

## 参考リソース

- [`docs/api_findings.md`](./api_findings.md) — ツール作成中に調査した Pulse API の詳細な挙動ノート
- [`examples/sample_output_columns.txt`](../examples/sample_output_columns.txt) — 560 エンドポイント規模のテナントで出力された CSV 列一覧

## トラブルシューティング

| 症状 | 原因 / 対処法 |
|------|--------------|
| `Pulse API 401` | API キーが無効または期限切れ。Pulse Settings で再発行してください |
| `Pulse API 403` | キーに Read スコープがないか、プランが API 利用をサポートしていません |
| `/profiles/{id}` で `Pulse API 404` | デバイスにプロファイルが割り当てられていません。行はエクスポートされますが `profile.*` 列は空欄です |
| `_configError` 列に値がある | `/config` の取得でエラー（タイムアウト等）。他の列は有効です |
| `endpoints` が空配列 | `orgId` が誤っているか、キーが別の組織のものです |
| Excel で文字化け | Excel 2016 未満は BOM を無視することがあります。「データ → テキスト/CSV から」でインポートしてください |

## 将来の改善候補

- **IPv6 アドレスの RFC 5952 圧縮** — 現在は非圧縮形式で出力。可読性向上のため将来対応予定。
- **大規模テナント向けストリーミング CSV** — 現在はすべての行をメモリに保持してから出力。数千台規模ではメモリスパイクが発生する可能性があります。
- **セッション / ジョブ分離** — SSE の進捗配信と CSV のダウンロードを分離し、長時間のエクスポートの安定性を向上させる。

## ライセンス

MIT — [LICENSE](../LICENSE) を参照してください。
