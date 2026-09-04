---
name: yamoru-release
description: YAMORUのstable GitHub ReleaseをPreview検証からProduction確認まで安全に進める。$yamoru-release が明示されたrelease準備、dry-run、公開にだけ使い、通常のdeploy、pre-release、VS Code拡張のreleaseには使わない。
---

# YAMORU Release

YAMORUのstable Releaseを、同一commitのPreview検証と利用者の公開承認を境界にして進める。このスキルは明示的に`$yamoru-release`と指定されたときだけ使う。

## 正本と境界

作業開始時に、リポジトリルートの`docs/index.md`と`docs/references/cloudflare-production-operations.md`を最後まで読み直す。後者の「stable Release前のpreview家族通し確認」と「stable Releaseからproductionへ配備する」を現行手順の正本とする。スキル内の例と正本またはworkflowが食い違う場合は操作を止め、差分を報告する。変化しやすい手順をこのファイルだけで判断しない。

対象はGitHubのstable Releaseと、それを起点にするCloudflare production配備である。次は行わない。

- `dev-flow:release`の変更、VS Code Marketplace公開、`.vsix`作成
- Releaseのためだけの`package.json` version変更や日英`CHANGELOG`更新
- ローカルからのproduction migrationまたはproduction deploy
- Secret、認証情報、家庭の実データの表示、保存、Issueへの転記
- preview資格情報のproduction利用、またはproduction資格情報のpreview利用

Previewでは固定の架空アカウントだけを使う。ProductionのSecret入力、最初の実利用者作成、家庭の実データ入力、実端末確認は利用者主導の別の受入確認として扱う。

## 実行環境

このスキルはWindows(PowerShell)でも、Linux/macOS(bashなど)でも同じ判断で使う。実行環境が利用者の常用作業ツリーではない使い捨てcloneであっても、後述のgateと確認項目はそのまま適用する。

- コマンド例は表記であり、shellの指定ではない。示した`git`コマンドはどのshellでも同じ文字列で実行できる。終了codeの参照方法だけはshellに合わせる(PowerShellは`$LASTEXITCODE`、bashなどは`$?`)。
- 正本の手順がPowerShellで書かれていても、確認する事実と順序が正本である。shellが違うことを理由に、手順や確認項目を省略・簡略化しない。
- GitHubの読み取りと操作は、その環境で使える手段(`gh` CLI、GitHub MCPなどのAPI経由の道具、GitHubのWeb UI)のどれで行ってもよい。満たすべきはRelease、milestone、workflow runについて確認する事実であり、特定のコマンドの形ではない。
- 必要な確認や操作をどの手段でも実行できない場合は、推測や既定値で補わず、不足している手段を明示して`NO_GO`とする。未実施の確認を成功と表現しない。

## 入力

開始時に次を確定し、完全な値を利用者へ示す。

- `release_tag`: `vX.Y.Z`形式のstable SemVer。pre-releaseは対象外
- `milestone`: このReleaseで完了させるGitHub milestone
- `target_sha`: Release対象とする`origin/main`の40桁commit SHA
- `mode`: `dry-run`または`execute`。指定がなければ、依頼が評価だけなら`dry-run`、Release実施なら`execute`

不足値はリポジトリとGitHubから読み取って候補を示せるが、複数候補があるversionまたはmilestoneを推測で選ばない。`target_sha`は同期確認後の`origin/main`から導出し、短縮SHAへ置き換えない。`execute`の依頼は、後述する安全条件をすべて満たすlocal `main`のfast-forward同期を含む。この同期だけを理由に追加承認を求めない。

## 状態とNo-Go

進行状態を次のいずれかで明示する。

- `READY_FOR_DRAFT`: Draft作成前の全ゲートが成功した
- `AWAITING_PREVIEW_E2E`: 対象SHA固定のDraftを確認し、E2Eの完了待ち
- `NO_GO`: 失敗または不整合があり、Release公開へ進めない
- `AWAITING_PUBLISH_APPROVAL`: Preview E2Eが成功し、利用者の公開承認待ち
- `PRODUCTION_IN_PROGRESS`: stable Releaseを公開し、Production workflowの完了待ち
- `COMPLETE`: 公開後の全確認が成功した

次のいずれかに該当すれば`NO_GO`として、その後の変更操作を止める。

- tag、milestone、target SHAが未確定、形式不正、または互いに対応しない
- milestoneにopen Issueが残る
- 作業ツリーがdirty、現在branchが`main`でない、または後述する許可済み同期後もlocal `main`・`origin/main`・target SHAが一致しない
- target SHAに対する`Quality checks`または`Deploy preview`が未完了、失敗、あるいは別SHA向け
- 同名tagまたはReleaseが意図しない状態・対象で既に存在する
- Draftが`draft=true`、`prerelease=false`、完全なtarget SHAを同時に満たさない
- `Preview family sharing E2E`が失敗、cancel、timeout、対象不明、別tag、別SHA、または別branch向け
- 公開後の`Deploy production`でQuality、target確認、D1 migration、build、deploy、smokeのいずれかが未完了または失敗
- 正本、workflow、GitHub上の状態に解消できない矛盾がある
- Secret、実データ、preview/production分離を損なう操作が必要になる

公開承認がまだない状態は失敗ではなく`AWAITING_PUBLISH_APPROVAL`である。最初のRelease依頼を公開承認として流用せず、E2E成功の証拠を示した後に改めて承認を得る。

## 1. 準備確認と安全なmain同期

最初はGitHub Release、tag、workflowを変更しない。`execute`で許可する唯一のローカル変更は、以下の条件を満たすlocal `main`のfast-forward同期である。少なくとも次を確認する。

1. `git status --short`が空で、現在branchが`main`である。
2. `git fetch origin main --tags --prune`後、次を実行してlocal `main`と`origin/main`の完全なSHA、ahead/behind件数、祖先関係を確認する。`git rev-list`の出力は左がlocalだけにあるcommit数、右が`origin/main`だけにあるcommit数である。

   ```
   git rev-parse main
   git rev-parse origin/main
   git rev-list --left-right --count main...origin/main
   git merge-base --is-ancestor main origin/main
   ```

3. SHAが異なり、`mode`が`execute`で、手順1の条件を維持し、`git rev-list`が`0 N`(`N > 0`)かつ`git merge-base --is-ancestor`が終了code 0のbehind-onlyの場合だけ、追加承認なしで`git merge --ff-only origin/main`を実行する。実行直後に`git branch --show-current`、`git status --short`、手順2の4コマンドを再実行し、branchが`main`、statusが空、SHAが一致、件数が`0 0`、祖先確認が終了code 0であることを確認する。fast-forwardや確認コマンドに失敗した場合、左の件数が1以上の場合、または祖先確認が終了code 0でない場合はahead/divergedとして`NO_GO`で停止する。
4. `dry-run`ではbranchやworktreeを変更しない。local `main`と`origin/main`が異なる場合は、同期候補を示して`NO_GO`とする。
5. local `main`と`origin/main`が一致し、その40桁SHAが`target_sha`である。
6. milestoneが存在し、対象versionと対応し、open Issueが0件である。
7. `target_sha`に対するmainの`Quality checks`が成功している。
8. 同じ`target_sha`に対する`Deploy preview`が成功している。
9. `release_tag`と同名の既存Releaseまたはremote tagがない。中断したDraftを再開する場合は、上書きせず後述のDraft条件をすべて照合する。

workflowは最新の`.github/workflows/`を読み、runの`headSha`、event、status、conclusion、URLを照合する。名前だけ一致する古いrunを証拠にしない。結果をtag、milestone、完全なSHA、各run URL付きで提示する。

`dry-run`はここで終了し、fetch以外の変更系コマンドを実行しない。全項目成功なら`READY_FOR_DRAFT`、一項目でも失敗なら`NO_GO`を返す。これにより、正常なsnapshotと、例えばlocal `main`の遅れ、別SHAのPreview run、未完了Issueを含むsnapshotの両方を評価できる。

## 2. Draft ReleaseとPreview E2E

`execute`では、`READY_FOR_DRAFT`になった場合だけ完全な`target_sha`を指定してDraft Releaseを作る。stable SemVerのtag、Release title、notesを見直し、pre-releaseにはしない。既存Draftを再開する場合は新しく作らない。

作成または再開直後にGitHubからReleaseを読み直し、次をすべて確認する。

- `draft=true`
- `prerelease=false`
- targetが意図した40桁`target_sha`
- tagとtitleが意図したversion

一致しなければ`NO_GO`としてDraftを公開しない。一致した場合だけ、正本に記載された`Preview family sharing E2E`を`release_tag`、`target_sha`、および起動branchとして`main`を指定して明示実行する(`gh`なら`--ref main`、Web UIならActions画面のbranch選択、API経由の道具なら同等のref指定)。dispatch時刻を記録し、それより後に作成された同workflowのrunから、`workflow_dispatch`、main、`target_sha`が一致するrunを特定する。候補が複数あり特定できなければ停止する。

runの完了を待ち、URL、run ID、tag、完全なSHA、conclusionを記録する。失敗時は`NO_GO`であり、Releaseを公開せずProductionへ進まない。失敗step、assertion、Playwright traceから秘密情報を除いた再現可能な問題は、既存Issueとの重複を確認してIssue化する。修正後はmainとPreview配備を再確認し、正本どおり新しいDraftでやり直す。

## 3. 公開承認

Preview E2Eが成功したら、次を一つの公開判定として利用者へ提示する。

- Release tag、milestone、完全なtarget SHA、Draft URL
- target SHAのQuality URLとDeploy preview URL
- Preview family sharing E2Eのrun URLと成功結果
- Release notesの要約
- 公開するとstable Releaseの`published` eventによりProduction配備が始まること

ここで`AWAITING_PUBLISH_APPROVAL`として停止し、「このDraftをstable Releaseとして公開してよい」という明示的な承認を待つ。承認前にDraft解除、tag公開、Production操作を行わない。

## 4. Production配備を待つ

承認後にだけDraftをstable Releaseとして公開する。公開直後にReleaseを読み直し、`draft=false`かつ`prerelease=false`であることを確認する。公開時刻より後に作成された`Deploy production` runを特定し、Release tagとtarget SHAが一致する一意なrunであることを確認して完了まで待つ。

run全体のsuccessだけでなく、次のjobまたはstepが実際に成功したことをrun詳細で確認する。

- Quality: lint、typecheck、test、build、およびD1 migration/authorization tests
- stable Release target確認
- production D1 migration
- Cloudflare build
- production deploy
- public assetsとauthentication boundaryのsmoke

失敗時は`NO_GO`として、公開済みReleaseとProductionの実状態を明示する。ローカルからmigrationやdeployを再実行せず、復旧またはforward fixは正本の手順と新たな承認に従う。再現可能なworkflow不備は既存Issueとの重複を確認してIssue化する。

## 5. 完了確認と出力

Production workflow成功後に、次をGitHubとローカルから読み直す。

- GitHub Releaseがstable、対象tag、対象SHA、`latest`である
- remote tagが同じ完全なtarget SHAを指す
- milestoneの全Issueがclosedであり、milestoneの状態が意図したRelease完了状態である
- local `main`と`origin/main`がtarget SHAに一致し、作業ツリーがcleanである

milestoneの状態変更が必要なら、現在状態と変更内容を示し、Release依頼の範囲内であることを確認してから行う。確認できなければ`COMPLETE`にしない。

完了報告には、実施した操作だけを記載する。

- 状態: `COMPLETE`または具体的な停止状態
- Release tag、GitHub Release URL、完全なtarget SHA、latest確認
- milestone名と最終状態
- Quality、Deploy preview、Preview E2E、Deploy productionの各run URLと結果
- ProductionのQuality、migration、build、deploy、smokeの確認結果
- local worktreeのbranch、同期、clean状態
- 未実施または利用者主導で残したproduction実データ・実端末確認

Secret、token、パスワード、メールアドレス本文、家庭の実データは出力へ含めない。未実施の確認を成功と表現しない。
