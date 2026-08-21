# repo-remote — 類似OSS・隣接アプローチ横断調査

**対象:** [`yo4e/repo-remote`](https://github.com/yo4e/repo-remote) / Issue #6
**作成日:** 2026-08-22（GMT+9）
**作成者:** Manus AI

## 結論

本調査で、**完全一致する公開OSSは確認できませんでした**。最も近いのは [`issue-ops/self-service`](https://github.com/issue-ops/self-service) であり、Issue forms、GitHub Actions、GitHub Appを用いて組織・複数リポジトリの自己サービス操作を実現します。しかし、`repo-remote`の中核である「**Issue本文をversioned JSON commandとして受理し、control repositoryのownerに対象を固定し、description・homepage・topicsだけを変更する、常駐サービス不要の小さなpolicy boundary**」という組合せは確認できませんでした。[1] [5]

したがって、`repo-remote`には明確な存在理由があります。最も簡潔で防御可能な位置付けは、次の一文です。

> **repo-remote は、Issueを作成できる任意のAI agent／自動化から、所有者が明示的に許可した少数のGitHub repository metadata操作だけを、安全に実行するための、serverlessかつ監査可能なcontrol bridgeである。**

v0.1は**Issue → Actionsのtransportを維持**し、GitHub App認証はv0.2のopt-in機能として後置すべきです。Wiki操作はv0.1のcommand surfaceへ加えず、成熟したWiki同期Actionを利用するレシピとして提供することを推奨します。[3] [11] [13]

## 調査前提と現行実装の評価

Issue #6は、exact / near-exact OSS、ChatOps、GitHub Apps、MCP bridges、settings-as-code、Wiki自動化を横断し、再利用候補・セキュリティ・差別化・実装順序を判断することを要求しています。[1] 本レポートは各プロジェクトのREADME、公式ドキュメント、公開リポジトリの構成を一次情報として確認しました。スター数とcommit数は調査時点の**粗い採用・活動シグナル**であり、品質や安全性の証明としては扱いません。

現行`repo-remote`は、Issueのopened/edited/labeledイベントに限定し、open状態、明示ラベル、Issue authorとevent actorの二重認可、初回run限定を満たした場合だけ実行します。`GITHUB_TOKEN`は`contents: read`と`issues: write`に限定され、Issue bodyはPATを渡さないvalidation stepで検証され、dry runにもPATを渡しません。[3] [4] command schemaはunknown keyを拒否し、versionを固定し、metadata fieldごとに長さと件数の上限を持ちます。[4]

この現行方針は、直接write toolをAIへ公開するMCPや、全設定を継続同期するsettings-as-codeとは異なる、意図的に狭い設計です。今後の拡張でも、credentialが可能な操作範囲ではなく、**checked-in schemaとsemantic validationが許可した操作範囲**を真のpolicy boundaryとして維持すべきです。[2] [3]

## exact / near-exact および隣接OSSの比較

| 区分・候補 | ライセンス / 活動・採用シグナル | アーキテクチャと認証 | repo-remoteとの関係・再利用判断 |
|---|---:|---|---|
| **issue-ops/self-service** | MIT。339 commits、4 stars。 | Issue forms、Actions、GitHub Pages portal、GitHub Appを組み合わせ、repo作成・rename・archive・visibility変更などの組織／repo操作を自己サービス化する。全機能ではAdministration等の広いApp権限を要求する。[5] | **最重要near-exact**。operation/permission catalogue、Issue form UX、GitHub Appへの委任方式は参考になる。一方、破壊的操作と常駐portalを含む広いsurfaceはコピーしない。 |
| **github/command** | MIT。266 commits、167 stars。 | `issue_comment: created`でIssueOps commandを検出し、actor権限、個人／team allowlist、context、fork、CI・reviewをgateして後段jobの`continue`を制御する。[6] | コメント型transportの成熟した認可層。`issue_comment`、actor allowlist、fork拒否、trusted contextのパターンは有用。ただしmetadataの型付きcommand schemaやcross-repo target policyは利用者責任である。 |
| **github/branch-deploy** | MIT。2,068 commits、570 stars。 | PR commentからdeployを起動し、branch protection、review、status checks、commit verification、deployment lock、rollbackを組み合わせる。[7] | **安全なIssueOpsの運用規範**。exact commit SHAでのcheckout、dry-run/no-op、状態の可視化を参考にする。デプロイ固有の複雑さをmetadata変更へ移植しない。 |
| **peter-evans/slash-command-dispatch** | MIT。594 commits、704 stars。 | Issue/PR commentのslash commandを`repository_dispatch`または`workflow_dispatch`へ転送する。cross-repo dispatchにはPATを用い、必要権限・対象種別・編集可否を設定する。[8] | ingestionとprivileged executionを分ける設計は有用。ただしPATとdispatch先の検証を追加し、Issue本文の完全な監査性を弱めるため、v0.1 transportの代替にはしない。 |
| **repository-settings/app** | ISC。1,401 commits、1,049 stars。 | GitHub Appが各repoの`.github/settings.yml`を同期し、repo settings変更をPR化する。[9] | PRによる変更統制と、configへのwrite権が実質admin権になるという明文化を採用する。常駐Appによる全面同期は別の製品カテゴリである。 |
| **safe-settings** | ISC。1,232 commits、911 stars。 | 中央admin repoの階層YAMLをGitHub App/serviceが読み、dry-run・差分計算・webhook/cronによるdrift reconciliationを行う。[10] | dry-runのbefore/after、冪等性、対象repo include/exclude、CODEOWNERSによるsource-of-truth保護は採用価値が高い。任意validator codeと大きなdesired-state面は採用しない。 |
| **github/github-mcp-server** | MIT。1,099 commits、32,415 stars。 | AI hostへIssue/PR、Actions、repo、securityなどの直接ツールを提供する。remote OAuth/PATとlocal OAuth/PAT/App authを扱い、toolset allowlistとread-only modeを持つ。[11] | 直接MCP統合の強い選択肢だが、agentに広いwrite surfaceを公開する。`repo-remote`はMCP代替ではなく、MCPがなくても使える**narrow bridge**として差別化する。 |
| **Andrew-Chen-Wang/github-wiki-action** | Apache-2.0。188 commits、111 stars。 | repo内folderと`OWNER/REPO.wiki.git`を同期する。dry-run、cross-repo、wiki→sourceのpull、`gollum`起点のPR化に対応する。[13] | Wikiの同期用途では最優先の再利用候補。単発の`wiki.create/update/delete/rename` RPCの代替ではないため、v0.1のcommand familyに混ぜない。 |
| **newrelic/wiki-sync-action** | Apache-2.0。15 commits、33 stars。 | `gollum`を使う双方向Wiki同期。ただしWiki側のdeleteはGitHub API eventの制約でsourceへ逆同期されない。[14] | 双方向同期の削除非対称性を理解する資料として有用。保守シグナルは前者より小さく、第一推奨にはしない。 |
| **github/issue-parser** | MIT。159 commits、28 stars。 | Issue form Markdownをtemplateに照らして型付きJSONへ変換するGitHub製package。[21] | human-friendly Issue formを追加する場合の入力正規化候補。Issue本文の編集を許容する前提のため、単独でsecurity boundaryには使わず、schema/semantic validationを必ず併用する。 |

`issue-ops/self-service`は最も近い先行実装ですが、処理できる操作が広く、repo create・transfer・archive・visibility等も扱います。[5] これに対して`repo-remote`は、いまのmetadata-only scopeを維持する限り、攻撃者・誤作動・credential漏洩時の影響範囲を理解しやすく抑えられます。

## ChatOps / MCP / settings-as-codeから採るもの、採らないもの

ChatOps系は、**コマンド認識、actor authorization、command feedback、実行のゲーティング**を成熟させています。`github/command`は`issue_comment`を用い、必要なrepo permissionとallowlistを組み合わせます。[6] `branch-deploy`は、未信頼コードをcheckoutするなら不変のcommit SHAを用いること、forkを既定拒否にすること、状態をIssue/PR上で見える化することを示します。[7] これらは将来のコメントtransportに流用可能ですが、v0.1のJSON Issue packetを自由形式slash commandへ置き換える理由にはなりません。

MCP系は、agentの便利さを最大化する一方、AI hostへ直接のread/write toolを渡します。公式GitHub MCP Serverはtoolsetや個別toolのallowlist、read-only modeを用意しており、この**capability縮小**は参考になります。[11] しかし、agentがMCPを導入しOAuth/PATを持つ必要があり、実行履歴・承認・prompt-injection対策をhost側に依存します。`repo-remote`は「agentがIssueを作れる」という最小共通能力だけを前提にし、commandと結果をGitHub Issueに残すことで、agent/vendor lock-inを下げるべきです。[1] [2]

settings-as-code系は、desired stateをPRでレビューし、dry-run差分を表示し、継続的にdriftを是正する点で優れます。[9] [10] ただし`repo-remote`は宣言的な組織ポリシー管理ではなく、ownerの限定操作を一回ずつ実行するcommand bridgeです。v0.1では、**before/after preview、冪等なAPI呼出し、明確な対象allowlist**だけを取り込み、background reconciliationや任意script validatorは取り込まないのが適切です。

## セキュリティ評価と公開前の必須判断

現行の二重actor検査、open Issue限定、manual re-run拒否、owner固定、schemaの`additionalProperties: false`、PATの遅延注入、dry-runの無資格実行、ログredactionは妥当な防御です。[3] [4] Issue #7にあるP0/P1の多くはすでに実装済みであるため、公開前の焦点は同じ項目を繰り返すことではなく、**供給網、変更統制、resource消費、証跡の強化**へ移すべきです。[3] [22]

| 優先度 | 推奨変更 | 理由と完了基準 |
|---|---|---|
| **Release blocker** | workflowで参照するActionをfull commit SHAへ固定する。`actions/checkout@v6`のようなtag参照も固定対象にする。 | GitHubはfull SHA pinをimmutable releaseを使う唯一の方法として推奨している。SHAのorigin確認とDependabot更新を併用する。[18] |
| **Release blocker** | `.github/workflows/**`、`scripts/**`、`schemas/**`、`SECURITY.md`をCODEOWNERSとdefault branch protectionで保護する。 | workflow / policy codeへ書き込める者はcross-repo credentialの実効policyを変えられる。GitHubもworkflow fileをCODEOWNERSで監視することを推奨する。[18] |
| **Release blocker** | JSON parse前のIssue body byte上限と、parse直後の最大depth / node数上限を追加し、境界テストを固定する。 | schemaはfieldごとの上限を持つが、document全体の巨大化や過大nestingのresource消費を直接は抑えない。[4] |
| **P1** | 成功コメントを`operation / target / dry_run / changed fields / SHA-256 fingerprint / run URL`の定形にする。 | Issue本文を再掲せず、特定runがどのvalidated packetを処理したかを後から照合できる。fingerprintはreplay防止ではなく、監査上の相関IDとして扱う。 |
| **P1** | `REPO_REMOTE_TOKEN`をEnvironment secretに置く場合のrequired reviewer方針を明示する。 | GitHubはEnvironment secretへのaccessをreviewで保護できる。単独所有者では任意、委任運用や高リスクcommand追加時は推奨とする。[18] |
| **P2** | Dependabot、CodeQL、OpenSSF Scorecardを継続運用に入れる。 | GitHubはAction依存の更新・workflowの危険パターンの検出にこれらを推奨している。[18] |

GitHub Actionsでは、Issue body、title、commentなどを**未信頼データ**として扱う必要があります。式展開した値をinline shellへ埋め込まず、環境変数またはaction引数として渡し、引用して処理することが公式の推奨です。[18] 現行はNode parserへ環境変数としてbodyを渡しており、方向性は正しいものの、今後Wikiや追加命令を作る際にもこの性質を崩してはいけません。[4]

本調査では、候補各社・各プロジェクトの公開README、SECURITY、公式Docsを確認しましたが、網羅的なCVE/アドバイザリDB監査までは実施していません。従って、表に**「既知の事故なし」**とは記載しません。採用するActionごとに、リリース時点でGitHub Advisory、Dependabot alerts、OpenSSF Scorecardを確認する運用を完了条件とすべきです。

## GitHub App と fine-grained PAT の判断

現行のfine-grained PATは、対象repositoryを`Selected repositories`へ絞り、Administration: Read and writeだけを付与する構成です。[2] 少数の個人所有repoを操作するv0.1には、設定が単純で、現在の小さなcommand surfaceとの整合性が高い方式です。ただしPATの寿命と主体は人間アカウントに紐付きます。

GitHub App installation tokenは、Appがインストール済みのrepoを超えてアクセスできず、発行時にrepo集合とpermissionsをさらに縮小でき、有効期限は1時間です。[16] GitHub公式の`actions/create-github-app-token`は、対象repoとpermissionを明示してtokenを発行し、既定でjob後にrevokeし、値をmaskします。[17]

| 観点 | fine-grained PAT（v0.1） | GitHub App installation token（v0.2 opt-in） |
|---|---|---|
| 初期設定 | token発行・secret保存のみで小さい。 | App登録、private key secret、対象repoへのinstallation、permission承認が必要。 |
| 有効期限・主体 | token policyに依存し、人間アカウント主体。 | 1時間。bot主体で、installationと発行時のrepo集合に束縛できる。[16] |
| 最小権限 | Selected repositoriesで実現可能。 | App installation、`repositories`、`permissions`の多段で縮小可能。[16] [17] |
| 適する利用者 | 単独所有者、少数repo、最短導入。 | 組織、複数repo、委任運用、token rotationを減らしたい利用者。 |

結論として、**GitHub Appをv0.1のrelease blockerにはしません**。ただしv0.2では`auth: app`をPATと同じschema・validation・owner policyの後段credential providerとして実装し、App tokenも特定target repoのみへscopeするべきです。App modeの導入はcommand surfaceの拡張と結び付けず、credential blast radiusを縮めるためだけに行います。

## Wiki操作の結論

GitHub WikiはGit backendであり、public repositoryのWikiは公開、private repositoryのWikiはrepoアクセス権を持つ利用者だけが閲覧できます。デフォルトではwrite権者だけが編集でき、Wikiは合計5,000 filesのsoft limitを持ちます。[15] `github-wiki-action`はsource folderを`.wiki.git`へ同期し、同一repoなら`contents: write`の`GITHUB_TOKEN`で動きますが、cross-repoでは対象WikiへpushできるPATが必要です。[13]

重要なのは、Wiki backendを最初に生成するために手動のdummy page作成が必要なこと、`init` strategyはforce-pushを行うこと、UI編集をsourceへ戻さなければ次回syncで上書きされ得ることです。[13] 双方向syncを使っても、Wiki側のdeleteを確実にsourceへ逆同期できない実装があります。[14]

従って、v0.1では`wiki.*` command familyを実装しません。代わりに、SHA固定した`github-wiki-action`のdocs publishing recipeをREADMEまたはexamplesに載せます。将来、AI agentが単発Wikiページを変更する要件が実証された場合のみ、別RFCとして次を満たしてから検討します。

| 必須設計条件 | 内容 |
|---|---|
| remote固定 | `${owner}/${repo}.wiki.git`以外を受け取らない。外部URL・任意remoteは禁止する。 |
| file safety | page nameを正規化し、`..`、absolute path、Git option injectionを拒否する。contentをshell interpolationしない。 |
| concurrency | repo単位のlockを設け、clone/push競合と強制pushを防ぐ。 |
| lifecycle | 未初期化Wiki、private Wiki、削除、rename、UI編集との競合を明示的に状態遷移として扱う。 |
| scope | page bytes、総pages、1 command当たり変更数を上限化し、まずpreviewから始める。 |

## Actionsのコスト・運用モデル

`repo-remote`は利用者自身のcontrol repositoryで実行されるため、中央サービスが他者のtokenやrunner費用を負担するモデルではありません。standard GitHub-hosted runnerはpublic repoで無料であり、self-hosted runnerも無料です。private repoでGitHub-hosted runnerを使う場合は、ownerのプランのminutes / storage quotaを消費し、超過分もownerに請求されます。[19]

このモデルは小規模なmetadata operationに適します。一方、public control repoでは、無認可Issueでもeventがworkflow runを起動し得るため、mutation gateとは別にrunner消費の懸念が残ります。GitHubにはworkflow trigger event rate等のplatform limitがありますが、防御策として依存すべきではありません。[20] READMEには、private control repoを推奨するか、public運用時にはIssue作成・編集がvalidate runを消費しうること、body size capとActions metrics監視を行うことを記載すべきです。

## 実装ロードマップと「コピーしないもの」

| 段階 | 推奨実装判断 | 意図 |
|---|---|---|
| **v0.1** | Issue → Actions、raw JSON v1、metadata-only、fine-grained PATを維持する。 | 最も小さく、agent-agnosticで、現行hardeningを活かす。 |
| **v0.1.1** | SHA pin、CODEOWNERS/branch protection、body resource cap、監査コメントfingerprint、billing/spam documentationを完了する。 | P0/P1実装後のrelease evidenceを強化する。 |
| **v0.2** | opt-in GitHub App authを追加する。必要ならIssue formを入力補助として追加するが、最終的なJSON schema validationは維持する。 | organization/複数repo利用時の短寿命・bot主体・最小scopeを得る。 |
| **後続RFC** | WikiはAction recipeを先に提供し、個別`wiki.*`は独立設計として判断する。MCPはIssue command creation専用の狭いadapterに留める。 | Git transportや直接tool surfaceのリスクをmetadata command pathへ持ち込まない。 |

特にコピーしないべきものは三つです。第一に、MCPのような任意repository・任意API操作に近い広いtool surfaceです。第二に、settings-as-codeの常駐service、cron reconciliation、任意script validatorです。第三に、Wikiのforce-pushを通常更新の既定にすることです。これらはいずれもそれぞれの目的には合理的ですが、`repo-remote`の価値である**小さく監査可能なpolicy boundary**を曖昧にします。[10] [11] [13]

## 最終判断

| Issue #6の決定質問 | 回答 |
|---|---|
| exact OSSは存在するか | **本調査では未確認**。`issue-ops/self-service`が強いnear-exactだが、操作面・常駐構成・認証設計が異なる。 |
| それでもrepo-remoteの理由はあるか | **ある。** 任意のIssue-creating agentに対するserverless、owner-bounded、metadata-only、Issue監査ログという組合せが明瞭である。 |
| 最も単純な差別化は何か | **「GitHub API proxyではなく、Issueから起動する、所有者固定・schema固定の最小metadata control bridge」**。 |
| 初回releaseはIssue → Actionsのままか | **維持する。** 新transportはv0.1の攻撃面とsetup負担を増やす。 |
| GitHub Appはv0.1前か後か | **後。** v0.2でopt-in auth providerとして追加する。 |
| Wikiは既存Actionで十分か | **folder-to-Wiki syncは十分に再利用可能。** 単発page RPCは別問題であり、初回releaseには不要。 |
| releaseを止めるsecurity practiceは何か | **full SHA pin、policy fileのCODEOWNERS/branch protection、input resource cap、監査証跡の定形化**。既存P0/P1にこれらを積み増す。 |

## 参考文献

[1]: https://github.com/yo4e/repo-remote/issues/6 "Issue #6 — Research: similar OSS, prior art, and adjacent approaches"
[2]: https://github.com/yo4e/repo-remote "yo4e/repo-remote README"
[3]: https://github.com/yo4e/repo-remote/blob/main/SECURITY.md "repo-remote SECURITY.md"
[4]: https://github.com/yo4e/repo-remote/blob/main/.github/workflows/repo-remote.yml "repo-remote workflow and command schema"
[5]: https://github.com/issue-ops/self-service "issue-ops/self-service"
[6]: https://github.com/github/command "github/command"
[7]: https://github.com/github/branch-deploy "github/branch-deploy"
[8]: https://github.com/peter-evans/slash-command-dispatch "peter-evans/slash-command-dispatch"
[9]: https://github.com/repository-settings/app "repository-settings/app"
[10]: https://github.com/github-community-projects/safe-settings "github-community-projects/safe-settings"
[11]: https://github.com/github/github-mcp-server "GitHub MCP Server"
[12]: https://github.com/modelcontextprotocol/servers-archived/tree/main/src/github "Archived MCP GitHub Server"
[13]: https://github.com/Andrew-Chen-Wang/github-wiki-action "Andrew-Chen-Wang/github-wiki-action"
[14]: https://github.com/newrelic/wiki-sync-action "newrelic/wiki-sync-action"
[15]: https://docs.github.com/en/communities/documenting-your-project-with-wikis/about-wikis "GitHub Docs — About wikis"
[16]: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app "GitHub Docs — Installation access tokens"
[17]: https://github.com/actions/create-github-app-token "actions/create-github-app-token"
[18]: https://docs.github.com/en/actions/reference/security/secure-use "GitHub Docs — Secure use reference"
[19]: https://docs.github.com/en/actions/concepts/billing-and-usage "GitHub Docs — Actions billing and usage"
[20]: https://docs.github.com/en/actions/reference/limits "GitHub Docs — Actions limits"
[21]: https://github.com/github/issue-parser "github/issue-parser"
[22]: https://github.com/yo4e/repo-remote/issues/7 "Issue #7 — Security hardening checklist"
