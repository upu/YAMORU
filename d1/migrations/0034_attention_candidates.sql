-- #440: additive projection storage. Business rows remain the source of truth.
CREATE VIEW attention_sources AS
SELECT o.household_id, 'todo_occurrence' AS kind, o.id,
 CASE WHEN json_type(o.rule_snapshot,'$.title') IS NULL THEN r.title ELSE json_extract(o.rule_snapshot,'$.title') END AS name,
 o.status, o.assignee_user_id,
 CASE WHEN json_type(o.rule_snapshot,'$.deadlineKind') IS NULL THEN r.deadline_kind ELSE json_extract(o.rule_snapshot,'$.deadlineKind') END AS deadline_kind,
 o.scheduled_for, o.due_at, o.must_complete_by, NULL AS stock_status
FROM task_occurrences o JOIN task_rules r ON r.id=o.task_rule_id AND r.household_id=o.household_id
UNION ALL
SELECT household_id,'consumable',id,name,'pending',NULL,NULL,NULL,NULL,NULL,stock_status FROM consumables;

CREATE VIEW attention_eligibility AS
SELECT *, CASE WHEN kind='consumable' THEN CASE WHEN stock_status IN ('low','out') THEN '0000-01-01' END
 WHEN status='pending' THEN nullif(min(coalesce(must_complete_by,'9999-12-31'),
   coalesce(date(CASE WHEN deadline_kind='maintenance' THEN scheduled_for ELSE due_at END,'+9 hours'),'9999-12-31')), '9999-12-31') END AS eligible_on
FROM attention_sources;

CREATE TABLE attention_candidates (
 id TEXT PRIMARY KEY,
 household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
 occurrence_id TEXT,
 consumable_id TEXT,
 source_key TEXT NOT NULL,
 payload TEXT NOT NULL CHECK(json_valid(payload)),
 sort_key TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 generated_at TEXT NOT NULL,
 evaluated_on TEXT NOT NULL,
 UNIQUE(household_id,source_key),
 CHECK((occurrence_id IS NOT NULL)+(consumable_id IS NOT NULL)=1),
 CHECK(source_key=CASE WHEN occurrence_id IS NOT NULL THEN 'todo_occurrence:'||occurrence_id ELSE 'consumable:'||consumable_id END),
 FOREIGN KEY(occurrence_id,household_id) REFERENCES task_occurrences(id,household_id) ON DELETE CASCADE,
 FOREIGN KEY(consumable_id,household_id) REFERENCES consumables(id,household_id) ON DELETE CASCADE
);
CREATE INDEX attention_candidates_order ON attention_candidates(household_id,sort_key);
CREATE TABLE attention_changes (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
 candidate_id TEXT NOT NULL,
 recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX attention_changes_household_sequence ON attention_changes(household_id,sequence);
CREATE INDEX attention_changes_candidate ON attention_changes(household_id,candidate_id,sequence);
CREATE TABLE attention_refresh (
 household_id TEXT PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
 epoch TEXT NOT NULL,
 version INTEGER NOT NULL,
 evaluated_on TEXT NOT NULL
);
-- Transaction assertion; rows are inserted and removed in the same batch.
CREATE TABLE attention_guards (id TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid=1));

CREATE TRIGGER attention_insert AFTER INSERT ON attention_candidates BEGIN
 INSERT INTO attention_changes(household_id,candidate_id) VALUES(NEW.household_id,NEW.id);
END;
CREATE TRIGGER attention_update AFTER UPDATE OF payload ON attention_candidates WHEN OLD.payload<>NEW.payload BEGIN
 INSERT INTO attention_changes(household_id,candidate_id) VALUES(NEW.household_id,NEW.id);
END;
CREATE TRIGGER attention_delete AFTER DELETE ON attention_candidates BEGIN
 INSERT INTO attention_changes(household_id,candidate_id) SELECT OLD.household_id,OLD.id WHERE EXISTS(SELECT 1 FROM households WHERE id=OLD.household_id);
END;

-- Capture resolve/recur even when no reader runs between business writes.
CREATE TRIGGER attention_occurrence_resolved AFTER UPDATE ON task_occurrences BEGIN
 DELETE FROM attention_candidates WHERE occurrence_id=NEW.id AND household_id=OLD.household_id
 AND NOT EXISTS (SELECT 1 FROM attention_eligibility s WHERE s.household_id=attention_candidates.household_id
   AND s.kind='todo_occurrence' AND s.id=NEW.id AND s.eligible_on<=max(attention_candidates.evaluated_on,date('now','+9 hours')));
END;
CREATE TRIGGER attention_stock_resolved AFTER UPDATE ON consumables BEGIN
 DELETE FROM attention_candidates WHERE consumable_id=NEW.id AND household_id=OLD.household_id
 AND (NEW.stock_status='available' OR NEW.household_id<>OLD.household_id);
END;
CREATE TRIGGER attention_rule_resolved AFTER UPDATE ON task_rules BEGIN
 DELETE FROM attention_candidates WHERE household_id=OLD.household_id
 AND occurrence_id IN (SELECT id FROM task_occurrences WHERE task_rule_id=NEW.id AND household_id=OLD.household_id)
 AND NOT EXISTS (SELECT 1 FROM attention_eligibility s WHERE s.household_id=attention_candidates.household_id
   AND s.kind='todo_occurrence' AND s.id=attention_candidates.occurrence_id AND s.eligible_on<=max(attention_candidates.evaluated_on,date('now','+9 hours')));
END;
