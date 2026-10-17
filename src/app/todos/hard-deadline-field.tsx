export function HardDeadlineField({ defaultValue = "" }: { defaultValue?: string }) {
  return (
    <div className="todo-fieldset">
      <label htmlFor="todo-hard-deadline">今回の必達日（任意）</label>
      <input id="todo-hard-deadline" type="date" name="mustCompleteBy" defaultValue={defaultValue} aria-describedby="todo-hard-deadline-help" />
      <p id="todo-hard-deadline-help" className="input-help">この日までに必ず行う場合に設定します。予定や目安とは別で、次回には引き継ぎません。空欄にすると解除できます。</p>
    </div>
  );
}
