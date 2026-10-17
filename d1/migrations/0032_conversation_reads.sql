-- #435: additive read revisions and aliases; independent of OAuth migration 0031.
CREATE TABLE household_read_versions (
 household_id TEXT PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
 epoch TEXT NOT NULL DEFAULT (lower(hex(randomblob(16)))),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
 changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO household_read_versions(household_id) SELECT id FROM households;
CREATE TRIGGER read_version_household_insert AFTER INSERT ON households BEGIN
 INSERT INTO household_read_versions(household_id) VALUES (NEW.id);
END;
CREATE TABLE entity_aliases (
 id TEXT PRIMARY KEY,
 household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
 managed_item_id TEXT,
 todo_rule_id TEXT,
 todo_occurrence_id TEXT,
 consumable_id TEXT,
 alias TEXT NOT NULL CHECK(alias = trim(alias) AND length(alias) BETWEEN 1 AND 100),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK((managed_item_id IS NOT NULL)+(todo_rule_id IS NOT NULL)+(todo_occurrence_id IS NOT NULL)+(consumable_id IS NOT NULL)=1),
 FOREIGN KEY(managed_item_id,household_id) REFERENCES managed_items(id,household_id) ON DELETE CASCADE,
 FOREIGN KEY(todo_rule_id,household_id) REFERENCES task_rules(id,household_id) ON DELETE CASCADE,
 FOREIGN KEY(todo_occurrence_id,household_id) REFERENCES task_occurrences(id,household_id) ON DELETE CASCADE,
 FOREIGN KEY(consumable_id,household_id) REFERENCES consumables(id,household_id) ON DELETE CASCADE
);
CREATE INDEX entity_aliases_household ON entity_aliases(household_id);
CREATE UNIQUE INDEX aliases_managed_item_id ON entity_aliases(household_id,managed_item_id,alias) WHERE managed_item_id IS NOT NULL;
CREATE UNIQUE INDEX aliases_todo_rule_id ON entity_aliases(household_id,todo_rule_id,alias) WHERE todo_rule_id IS NOT NULL;
CREATE UNIQUE INDEX aliases_todo_occurrence_id ON entity_aliases(household_id,todo_occurrence_id,alias) WHERE todo_occurrence_id IS NOT NULL;
CREATE UNIQUE INDEX aliases_consumable_id ON entity_aliases(household_id,consumable_id,alias) WHERE consumable_id IS NOT NULL;
CREATE TRIGGER read_version_managed_items_insert AFTER INSERT ON managed_items BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_managed_items_update AFTER UPDATE ON managed_items BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id OR household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_managed_items_delete AFTER DELETE ON managed_items BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id;
END;
CREATE TRIGGER read_version_managed_item_classifications_insert AFTER INSERT ON managed_item_classifications BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_managed_item_classifications_update AFTER UPDATE ON managed_item_classifications BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id OR household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_managed_item_classifications_delete AFTER DELETE ON managed_item_classifications BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id;
END;
CREATE TRIGGER read_version_managed_item_tags_insert AFTER INSERT ON managed_item_tags BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_managed_item_tags_update AFTER UPDATE ON managed_item_tags BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id OR household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_managed_item_tags_delete AFTER DELETE ON managed_item_tags BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id;
END;
CREATE TRIGGER read_version_tags_insert AFTER INSERT ON tags BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_tags_update AFTER UPDATE ON tags BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id OR household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_tags_delete AFTER DELETE ON tags BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id;
END;
CREATE TRIGGER read_version_managed_item_consumables_insert AFTER INSERT ON managed_item_consumables BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_managed_item_consumables_update AFTER UPDATE ON managed_item_consumables BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id OR household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_managed_item_consumables_delete AFTER DELETE ON managed_item_consumables BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id;
END;
CREATE TRIGGER read_version_task_rules_insert AFTER INSERT ON task_rules BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_task_rules_update AFTER UPDATE ON task_rules BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id OR household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_task_rules_delete AFTER DELETE ON task_rules BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id;
END;
CREATE TRIGGER read_version_task_rule_schedules_insert AFTER INSERT ON task_rule_schedules BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_task_rule_schedules_update AFTER UPDATE ON task_rule_schedules BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id OR household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_task_rule_schedules_delete AFTER DELETE ON task_rule_schedules BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id;
END;
CREATE TRIGGER read_version_task_rule_consumables_insert AFTER INSERT ON task_rule_consumables BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_task_rule_consumables_update AFTER UPDATE ON task_rule_consumables BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id OR household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_task_rule_consumables_delete AFTER DELETE ON task_rule_consumables BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id;
END;
CREATE TRIGGER read_version_task_occurrences_insert AFTER INSERT ON task_occurrences BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_task_occurrences_update AFTER UPDATE ON task_occurrences BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id OR household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_task_occurrences_delete AFTER DELETE ON task_occurrences BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id;
END;
CREATE TRIGGER read_version_activity_logs_insert AFTER INSERT ON activity_logs BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_activity_logs_update AFTER UPDATE ON activity_logs BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id OR household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_activity_logs_delete AFTER DELETE ON activity_logs BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id;
END;
CREATE TRIGGER read_version_completion_corrections_insert AFTER INSERT ON completion_corrections BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_completion_corrections_update AFTER UPDATE ON completion_corrections BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id OR household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_completion_corrections_delete AFTER DELETE ON completion_corrections BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id;
END;
CREATE TRIGGER read_version_task_rule_changes_insert AFTER INSERT ON task_rule_changes BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_task_rule_changes_update AFTER UPDATE ON task_rule_changes BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id OR household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_task_rule_changes_delete AFTER DELETE ON task_rule_changes BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id;
END;
CREATE TRIGGER read_version_task_deadline_changes_insert AFTER INSERT ON task_deadline_changes BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_task_deadline_changes_update AFTER UPDATE ON task_deadline_changes BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id OR household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_task_deadline_changes_delete AFTER DELETE ON task_deadline_changes BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id;
END;
CREATE TRIGGER read_version_consumables_insert AFTER INSERT ON consumables BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_consumables_update AFTER UPDATE ON consumables BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id OR household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_consumables_delete AFTER DELETE ON consumables BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id;
END;
CREATE TRIGGER read_version_consumable_refills_insert AFTER INSERT ON consumable_refills BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_consumable_refills_update AFTER UPDATE ON consumable_refills BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id OR household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_consumable_refills_delete AFTER DELETE ON consumable_refills BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id;
END;
CREATE TRIGGER read_version_entity_aliases_insert AFTER INSERT ON entity_aliases BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_entity_aliases_update AFTER UPDATE ON entity_aliases BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id OR household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_entity_aliases_delete AFTER DELETE ON entity_aliases BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id;
END;
CREATE TRIGGER read_version_household_members_insert AFTER INSERT ON household_members BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_household_members_update AFTER UPDATE ON household_members BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id OR household_id = NEW.household_id;
END;
CREATE TRIGGER read_version_household_members_delete AFTER DELETE ON household_members BEGIN
 UPDATE household_read_versions SET version=version+1, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id = OLD.household_id;
END;
CREATE TRIGGER aliases_limit_insert BEFORE INSERT ON entity_aliases
 WHEN (SELECT count(*) FROM entity_aliases a WHERE a.household_id=NEW.household_id AND a.id<>NEW.id AND
 (a.managed_item_id=NEW.managed_item_id OR a.todo_rule_id=NEW.todo_rule_id OR a.todo_occurrence_id=NEW.todo_occurrence_id OR a.consumable_id=NEW.consumable_id)) >= 10
 BEGIN SELECT RAISE(ABORT,'At most ten aliases per entity'); END;
CREATE TRIGGER aliases_limit_update BEFORE UPDATE ON entity_aliases
 WHEN (SELECT count(*) FROM entity_aliases a WHERE a.household_id=NEW.household_id AND a.id<>NEW.id AND
 (a.managed_item_id=NEW.managed_item_id OR a.todo_rule_id=NEW.todo_rule_id OR a.todo_occurrence_id=NEW.todo_occurrence_id OR a.consumable_id=NEW.consumable_id)) >= 10
 BEGIN SELECT RAISE(ABORT,'At most ten aliases per entity'); END;
