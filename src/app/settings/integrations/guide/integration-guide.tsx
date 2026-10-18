import Link from "next/link";
import { INTEGRATION_SCOPES, SCOPE_DESCRIPTIONS } from "../../../../features/integration/scopes";

export function IntegrationGuide({ endpoint }: { endpoint: string | null }) {
  return <>
    <header className="detail-hero"><h1>会話連携の始め方</h1><p>YAMORUが記録と予定を管理し、会話アシスタントが対象の確認・操作・お知らせを手伝います。</p></header>
    <section className="detail-card" aria-labelledby="connect-title"><h2 id="connect-title">1. 会話アシスタントから接続する</h2>
      {endpoint ? <><p>接続先のアプリでMCPサーバーを追加し、このYAMORUのアドレスを指定します。</p><p><code style={{ overflowWrap: "anywhere" }}>{endpoint}</code></p></>
        : <p>現在、このYAMORUでは新しい外部サービスとの連携を受け付けていません。管理者に、利用するサービスが接続を許可されているか確認してください。</p>}
      <p>開いたYAMORUの同意画面で、アカウント・家庭・接続元と許可する範囲を確認してください。パスワードや認証コードを会話へ貼らないでください。</p>
      <ul>{INTEGRATION_SCOPES.map((scope) => <li key={scope}><strong>{SCOPE_DESCRIPTIONS[scope].label}</strong>：{SCOPE_DESCRIPTIONS[scope].detail}</li>)}</ul>
      <p>読み取りは必須です。家庭の記録を変える場合だけ変更を許可します。通知設定はこの画面からも変更でき、通知の受け取りとは別の許可です。</p>
    </section>
    <section className="detail-card" aria-labelledby="test-title"><h2 id="test-title">2. 接続と一度だけのお知らせを確かめる</h2>
      <p>まず会話で「YAMORUの接続先と家庭、許可している操作を確認して」と伝えます。表示された家庭が自分の家庭か確かめてください。</p>
      <p>通知を使う場合は、通知先を選んで有効にし、知らせる時間・静かな時間・タイムゾーンを保存します。</p>
      <p><Link href="/settings/notifications">通知設定と配信履歴</Link></p>
      <p>次に「いま通知できる用事を一度だけ知らせて。予定や完了を変更せず、定期タスクは作らないで」と会話で頼みます。対象がない場合や静かな時間には、お知らせが出ないことがあります。</p>
      <p>配信履歴の「案内したと報告」と、会話に表示されたお知らせを両方確認してください。履歴だけでは、読んだことやTodoの完了を示しません。</p>
    </section>
    <section className="detail-card" aria-labelledby="periodic-title"><h2 id="periodic-title">3. 連携先で定期的な確認を設定する</h2>
      <p>定期タスクを使える会話アシスタントで「YAMORUのそろそろ対応する用事を15分ごとに確認し、必要なものだけ知らせて」と依頼します。連携先が対応していなければ、自動のお知らせは利用できません。</p>
      <p>保存後にタスク名・有効状態・周期・次回予定を確認し、実際の実行結果と会話へのお知らせを確かめてください。15分ぴったりの起動や到達時刻は保証されません。利用条件は連携先のサービスに従います。</p>
      <p>YAMORUから外部の定期タスクは作成・停止しません。YAMORU内の設定が有効でも、外部タスクが停止・失敗していれば届きません。この版では定期取得を使い、MCP Eventsによる自動送信は提供していません。</p>
    </section>
    <section className="detail-card" aria-labelledby="reply-title"><h2 id="reply-title">お知らせへの返答と記録の確認</h2>
      <p>「やった」「昨日済ませた」は完了、「明日9時に教えて」は自分への通知だけの延期、「今回の期限を10月25日へ」は家庭で共有する期限の変更です。複数件のお知らせでは、どの用事か伝えてください。</p>
      <p>結果に出る実施日・記録日・次回予定を確認してください。間違えた場合は、同じ用事の完了日や実施者の訂正、完了取消を依頼できます。後から次回を操作した場合など、取り消せないこともあります。</p>
      <p>対象の詳細リンクを開くと履歴を確認できます。応答が途切れた場合は「直前の操作の保存結果だけを確認して。再実行しないで」と伝え、結果が不明なまま同じ変更を新しく依頼し直さないでください。</p>
    </section>
    <section className="detail-card" aria-labelledby="recovery-title"><h2 id="recovery-title">通知が来ないとき・連携を止めるとき</h2>
      <ol>
        <li>連携先の定期タスクが有効か、次回予定と直近の実行結果を確認します。タスクがなければ、連携先で設定します。</li>
        <li>YAMORUの通知がOFF・全体休止・用事ごとの休止になっていないか確認します。日次まとめの時刻、静かな時間、タイムゾーンも確認します。</li>
        <li>用事が完了済み、まだ時期ではない、すでに案内済みなら新しく知らせない場合があります。配信履歴で見送り理由を確認します。結果不明なら会話に届いたか照合し、無条件に再送しません。</li>
        <li>接続が期限切れ・解除済み、または必要な許可が不足していれば、連携先から接続し直します。家庭を離れたりパスワードを変更した場合も再連携が必要です。</li>
      </ol>
      <p>一時的に止める場合は、YAMORUの通知をOFFにし、連携先の定期タスクも無効にして次回予定がないことを確認します。家庭のTodoは消えません。</p>
      <p>読み取りや変更も止める場合は、外部サービスとの連携を解除します。解除前の家庭の記録は残り、元の接続は再利用できません。再開時は接続し直して通知先を選び直します。外部タスクが停止したかも連携先で確認してください。</p>
      <p><Link href="/settings/integrations">連携状態の確認・解除</Link></p>
    </section>
  </>;
}
