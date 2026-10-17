-- 内容の再生成時刻とは別に、同じ候補区間で最初に検出した時刻を保持する。
-- 既存区間の過去の観測は推測せず、保存済みの生成時刻で補う。
ALTER TABLE attention_candidates ADD COLUMN first_detected_at TEXT;
UPDATE attention_candidates SET first_detected_at = generated_at WHERE first_detected_at IS NULL;

-- 旧WorkerのINSERTも変更せず動かせる。payload更新ではこの時刻を動かさない。
CREATE TRIGGER attention_candidates_first_detected
AFTER INSERT ON attention_candidates WHEN NEW.first_detected_at IS NULL
BEGIN
  UPDATE attention_candidates SET first_detected_at = NEW.generated_at WHERE id = NEW.id;
END;
