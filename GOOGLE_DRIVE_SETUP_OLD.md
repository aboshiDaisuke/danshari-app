# Google Drive連携の設定方法

この断捨離アプリでGoogle Driveに写真を自動保存するには、Google Cloud ConsoleでAPIを有効にし、認証情報を取得する必要があります。

## 手順

### 1. Google Cloud Projectの作成

1. [Google Cloud Console](https://console.cloud.google.com) にアクセス
2. 新しいプロジェクトを作成
   - プロジェクト名: 「Danshari App」など任意の名前
   - 「作成」をクリック

### 2. Google Drive APIとPicker APIの有効化

1. 左メニューから「APIとサービス」→「ライブラリ」を選択
2. 「Google Drive API」を検索して有効化
3. 「Google Picker API」も検索して有効化

### 3. OAuth同意画面の設定

1. 「APIとサービス」→「OAuth同意画面」を選択
2. ユーザータイプ:
   - **外部**を選択（個人利用の場合）
3. アプリ情報を入力:
   - アプリ名: 「Danshari」
   - ユーザーサポートメール: 自分のGmailアドレス
   - デベロッパーの連絡先情報: 自分のGmailアドレス
4. スコープの追加:
   - 「スコープを追加または削除」をクリック
   - 「Google Drive API」の「.../auth/drive.file」を選択
5. テストユーザーの追加:
   - 自分のGmailアドレスを追加
6. 「保存して次へ」で完了

### 4. OAuth 2.0 クライアントIDの作成

1. 「APIとサービス」→「認証情報」を選択
2. 「認証情報を作成」→「OAuth クライアント ID」をクリック
3. アプリケーションの種類:
   - **ウェブ アプリケーション**を選択
4. 名前: 「Danshari Web Client」
5. 承認済みのJavaScript生成元:
   - ローカルでテストする場合: `http://localhost:5500`
   - 本番環境: あなたのWebサイトのURL
6. 承認済みのリダイレクトURI:
   - 同じURLを入力
7. 「作成」をクリック
8. **クライアントIDをコピー**して保存

### 5. APIキーの作成

1. 同じ「認証情報」画面で「認証情報を作成」→「APIキー」をクリック
2. **APIキーをコピー**して保存
3. （オプション）「キーを制限」で以下を設定:
   - アプリケーションの制限: HTTPリファラー
   - APIの制限: Google Drive APIとGoogle Picker API

### 6. アプリでの設定

1. 断捨離アプリを開く
2. 設定（⚙️）→「Googleドライブ自動同期」セクション
3. 取得した**クライアントID**と**APIキー**を入力
4. 「Googleアカウントでログイン」をクリック
5. Googleアカウントでログイン
6. 保存先フォルダを選択

## 注意事項

- **テストモード**: OAuth同意画面が「テスト」状態の場合、追加したテストユーザーのみがログインできます
- **公開する場合**: アプリを他の人と共有する場合は、OAuth同意画面を「本番」に移行する必要があります（Googleの審査が必要）
- **セキュリティ**: APIキーとクライアントIDは公開しても問題ありませんが、機密情報ではないことを確認してください

## トラブルシューティング

### 「このアプリはGoogleで確認されていません」と表示される
- テストモードの場合は「詳細」→「(アプリ名)に移動」をクリック
- テストユーザーとして追加したアカウントでログインしていることを確認

### ログインできない
- OAuth同意画面でテストユーザーとして追加されているか確認
- 承認済みのJavaScript生成元が正しく設定されているか確認

### フォルダ選択画面が表示されない
- Google Picker APIが有効になっているか確認
- ブラウザのコンソールでエラーを確認

## 参考リンク

- [Google Cloud Console](https://console.cloud.google.com)
- [Google Drive API ドキュメント](https://developers.google.com/drive)
- [Google Picker API ドキュメント](https://developers.google.com/picker)
