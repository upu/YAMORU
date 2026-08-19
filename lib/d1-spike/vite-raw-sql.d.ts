// Issue #116スパイク: Vitestの`?raw`インポート(SQLファイルを文字列として読み込む)用の型宣言。
declare module "*.sql?raw" {
  const content: string;
  export default content;
}
