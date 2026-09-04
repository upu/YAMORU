# .claude

Claude Codeがこのリポジトリのskillを読み込むための入口です。

## skillの配置

skillの正本は`.agents/skills/`に置き、Claude Code向けには`.claude/skills`からシンボリックリンクで参照します。

```
.claude/skills -> ../.agents/skills
```

Claude Codeは`.claude/skills/<name>/SKILL.md`をskillとして読み込むため、このリンクによって`.agents/skills/yamoru-release/SKILL.md`が`yamoru-release` skillとして使えます。skillの内容は`.agents/skills/`側だけを編集し、新しいskillを`.agents/skills/`へ追加した場合はリンクの張り直しなしでそのまま認識されます。

## Windowsでcloneする場合

このリンクはgit上でsymlink(mode 120000)として管理しています。Windowsでsymlinkが無効なままcloneすると、`.claude/skills`がリンク先のパスを書いただけのテキストファイルになり、skillが読み込まれません。その場合は開発者モードを有効にしたうえで次を実行してください。

```powershell
git config core.symlinks true
git checkout -- .claude/skills
```

symlinkを使えない環境では、代わりに`.claude/skills`をjunctionとして作成します(gitの作業ツリーが汚れるため、コミットはしません)。

```powershell
Remove-Item .claude\skills -Force
New-Item -ItemType Junction -Path .claude\skills -Target .agents\skills
```
