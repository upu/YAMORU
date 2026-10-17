-- #438 / YDR-057: additive stock facts and append-only corrections.
ALTER TABLE consumables ADD COLUMN stock_revision INTEGER NOT NULL DEFAULT 0 CHECK(stock_revision >= 0);
CREATE UNIQUE INDEX consumable_refills_record_parent ON consumable_refills(id,household_id,consumable_id);

CREATE TABLE consumable_stock_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  record_id TEXT NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  consumable_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('observation','refill','state_snapshot')),
  action TEXT NOT NULL CHECK(action IN ('created','corrected','voided')),
  revision INTEGER NOT NULL CHECK(revision >= 0),
  previous_event_id TEXT UNIQUE,
  refill_id TEXT,
  occurred_on TEXT,
  occurred_at TEXT,
  stock_status TEXT NOT NULL CHECK(stock_status IN ('available','low','out')),
  recorded_at TEXT NOT NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  performer_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK(source IN ('unknown','web','integration')),
  idempotency_key TEXT,
  request_hash TEXT,
  result TEXT CHECK(result IS NULL OR json_valid(result)),
  UNIQUE(id,household_id,consumable_id),
  UNIQUE(id,household_id,consumable_id,kind),
  UNIQUE(id,record_id,household_id,consumable_id),
  UNIQUE(record_id,revision),
  UNIQUE(household_id,idempotency_key),
  FOREIGN KEY(consumable_id,household_id) REFERENCES consumables(id,household_id) ON DELETE CASCADE,
  FOREIGN KEY(record_id,household_id,consumable_id,kind) REFERENCES consumable_stock_events(id,household_id,consumable_id,kind) ON DELETE CASCADE,
  FOREIGN KEY(previous_event_id,record_id,household_id,consumable_id) REFERENCES consumable_stock_events(id,record_id,household_id,consumable_id),
  FOREIGN KEY(refill_id,household_id,consumable_id) REFERENCES consumable_refills(id,household_id,consumable_id) ON DELETE CASCADE,
  CHECK((action='created' AND revision=0 AND previous_event_id IS NULL AND record_id=id)
     OR (action<>'created' AND revision>0 AND previous_event_id IS NOT NULL AND record_id<>id)),
  CHECK((kind='state_snapshot' AND action='created' AND occurred_on IS NULL AND occurred_at IS NULL AND refill_id IS NULL)
     OR (kind IN ('observation','refill') AND occurred_on IS NOT NULL)),
  CHECK((kind='refill' AND refill_id IS NOT NULL AND stock_status='available') OR (kind<>'refill' AND refill_id IS NULL)),
  CHECK(action='voided' OR source='unknown' OR occurred_on IS NULL OR (occurred_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(occurred_on,'+0 days') IS NOT NULL AND date(occurred_on,'+0 days')=occurred_on)),
  CHECK(action='voided' OR source='unknown' OR occurred_at IS NULL OR (strftime('%Y-%m-%dT%H:%M:%fZ',occurred_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',occurred_at)=occurred_at AND date(occurred_at,'+9 hours')=occurred_on)),
  CHECK(source='unknown' OR (strftime('%Y-%m-%dT%H:%M:%fZ',recorded_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',recorded_at)=recorded_at)),
  CHECK((idempotency_key IS NULL)=(request_hash IS NULL))
);
CREATE INDEX consumable_stock_events_history ON consumable_stock_events(household_id,consumable_id,sequence DESC);
CREATE INDEX consumable_stock_events_record ON consumable_stock_events(record_id,revision DESC);

CREATE TABLE consumable_stock_current (
  record_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  consumable_id TEXT NOT NULL,
  latest_event_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  kind TEXT NOT NULL,
  occurred_on TEXT,
  occurred_at TEXT,
  stock_status TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  voided INTEGER NOT NULL CHECK(voided IN (0,1)),
  root_sequence INTEGER NOT NULL,
  UNIQUE(record_id,household_id,consumable_id),
  FOREIGN KEY(record_id,household_id,consumable_id) REFERENCES consumable_stock_events(id,household_id,consumable_id) ON DELETE CASCADE,
  FOREIGN KEY(latest_event_id,record_id,household_id,consumable_id) REFERENCES consumable_stock_events(id,record_id,household_id,consumable_id) ON DELETE CASCADE
);
CREATE INDEX consumable_stock_current_dates ON consumable_stock_current(household_id,consumable_id,voided,occurred_on DESC,root_sequence DESC);

CREATE TABLE consumable_stock_heads (
  consumable_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  FOREIGN KEY(consumable_id,household_id) REFERENCES consumables(id,household_id) ON DELETE CASCADE,
  FOREIGN KEY(record_id,household_id,consumable_id) REFERENCES consumable_stock_current(record_id,household_id,consumable_id) ON DELETE CASCADE
);
-- A transaction assertion and a fence against capturing a new write as legacy SQL.
CREATE TABLE consumable_stock_write_guards (
  consumable_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  valid INTEGER NOT NULL CHECK(valid=1),
  FOREIGN KEY(consumable_id,household_id) REFERENCES consumables(id,household_id) ON DELETE CASCADE
);

-- Preserve the old refill IDs and timestamps; unknown authors stay unknown.
INSERT INTO consumable_stock_events(id,record_id,household_id,consumable_id,kind,action,revision,refill_id,occurred_on,stock_status,recorded_at,source)
SELECT 'refill:'||id,'refill:'||id,household_id,consumable_id,'refill','created',0,id,refilled_on,'available',recorded_at,'unknown' FROM consumable_refills;
-- A saved state is not an invented observation or an invented observation date.
INSERT INTO consumable_stock_events(id,record_id,household_id,consumable_id,kind,action,revision,stock_status,recorded_at,source)
SELECT 'snapshot:'||id,'snapshot:'||id,household_id,id,'state_snapshot','created',0,stock_status,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'unknown' FROM consumables;
INSERT INTO consumable_stock_current(record_id,household_id,consumable_id,latest_event_id,revision,kind,occurred_on,occurred_at,stock_status,recorded_at,voided,root_sequence)
SELECT record_id,household_id,consumable_id,id,revision,kind,occurred_on,occurred_at,stock_status,recorded_at,0,sequence FROM consumable_stock_events;
INSERT INTO consumable_stock_heads(consumable_id,household_id,record_id) SELECT id,household_id,'snapshot:'||id FROM consumables;

CREATE TRIGGER stock_event_previous BEFORE INSERT ON consumable_stock_events WHEN NEW.action<>'created' BEGIN
  SELECT RAISE(ABORT,'stock_event_conflict') WHERE NOT EXISTS(SELECT 1 FROM consumable_stock_current c WHERE c.record_id=NEW.record_id AND c.household_id=NEW.household_id
    AND c.consumable_id=NEW.consumable_id AND c.latest_event_id=NEW.previous_event_id AND c.revision=NEW.revision-1)
    ;
END;
CREATE TRIGGER stock_event_insert AFTER INSERT ON consumable_stock_events BEGIN
  INSERT INTO consumable_stock_current(record_id,household_id,consumable_id,latest_event_id,revision,kind,occurred_on,occurred_at,stock_status,recorded_at,voided,root_sequence)
    VALUES(NEW.record_id,NEW.household_id,NEW.consumable_id,NEW.id,NEW.revision,NEW.kind,NEW.occurred_on,NEW.occurred_at,NEW.stock_status,NEW.recorded_at,NEW.action='voided',NEW.sequence)
    ON CONFLICT(record_id) DO UPDATE SET latest_event_id=excluded.latest_event_id,revision=excluded.revision,occurred_on=excluded.occurred_on,
      occurred_at=excluded.occurred_at,stock_status=excluded.stock_status,recorded_at=excluded.recorded_at,voided=excluded.voided;
  UPDATE consumables SET stock_revision=stock_revision+1 WHERE id=NEW.consumable_id AND household_id=NEW.household_id;
END;
CREATE TRIGGER stock_event_delete AFTER DELETE ON consumable_stock_events BEGIN
  UPDATE consumables SET stock_revision=stock_revision+1 WHERE id=OLD.consumable_id AND household_id=OLD.household_id;
END;

CREATE TRIGGER stock_legacy_consumable_insert AFTER INSERT ON consumables BEGIN
  INSERT INTO consumable_stock_events(id,record_id,household_id,consumable_id,kind,action,revision,stock_status,recorded_at,source)
    VALUES('snapshot:'||NEW.id,'snapshot:'||NEW.id,NEW.household_id,NEW.id,'state_snapshot','created',0,NEW.stock_status,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'unknown');
  INSERT INTO consumable_stock_heads(consumable_id,household_id,record_id) VALUES(NEW.id,NEW.household_id,'snapshot:'||NEW.id);
END;
CREATE TRIGGER stock_legacy_status AFTER UPDATE OF stock_status ON consumables
WHEN NOT EXISTS(SELECT 1 FROM consumable_stock_write_guards WHERE consumable_id=NEW.id AND household_id=NEW.household_id) BEGIN
  INSERT INTO consumable_stock_events(id,record_id,household_id,consumable_id,kind,action,revision,stock_status,recorded_at,source)
    SELECT id,id,NEW.household_id,NEW.id,'state_snapshot','created',0,NEW.stock_status,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'unknown'
      FROM (SELECT 'state:'||lower(hex(randomblob(16))) AS id);
  INSERT INTO consumable_stock_heads(consumable_id,household_id,record_id)
    SELECT NEW.id,NEW.household_id,id FROM consumable_stock_events WHERE household_id=NEW.household_id AND consumable_id=NEW.id AND kind='state_snapshot' ORDER BY sequence DESC LIMIT 1
    ON CONFLICT(consumable_id) DO UPDATE SET record_id=excluded.record_id;
END;
CREATE TRIGGER stock_legacy_refill_insert AFTER INSERT ON consumable_refills
WHEN NOT EXISTS(SELECT 1 FROM consumable_stock_write_guards WHERE consumable_id=NEW.consumable_id AND household_id=NEW.household_id) BEGIN
  INSERT INTO consumable_stock_events(id,record_id,household_id,consumable_id,kind,action,revision,refill_id,occurred_on,stock_status,recorded_at,source)
    VALUES('refill:'||NEW.id,'refill:'||NEW.id,NEW.household_id,NEW.consumable_id,'refill','created',0,NEW.id,NEW.refilled_on,'available',NEW.recorded_at,'unknown');
END;
CREATE TRIGGER stock_legacy_refill_update AFTER UPDATE OF refilled_on ON consumable_refills
WHEN OLD.refilled_on<>NEW.refilled_on AND NOT EXISTS(SELECT 1 FROM consumable_stock_write_guards WHERE consumable_id=NEW.consumable_id AND household_id=NEW.household_id) BEGIN
  INSERT INTO consumable_stock_events(id,record_id,household_id,consumable_id,kind,action,revision,previous_event_id,refill_id,occurred_on,stock_status,recorded_at,performer_user_id,source)
    SELECT 'correction:'||lower(hex(randomblob(16))),c.record_id,NEW.household_id,NEW.consumable_id,'refill','corrected',c.revision+1,c.latest_event_id,NEW.id,NEW.refilled_on,'available',strftime('%Y-%m-%dT%H:%M:%fZ','now'),e.performer_user_id,'unknown'
      FROM consumable_stock_current c JOIN consumable_stock_events e ON e.id=c.latest_event_id WHERE c.record_id='refill:'||NEW.id;
END;
