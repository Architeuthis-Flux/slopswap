-- One row per notebook: its JSON, the number that goes up with every change, and when it last changed (ms).
CREATE TABLE IF NOT EXISTS notebook (id TEXT PRIMARY KEY, rev INTEGER NOT NULL, body TEXT NOT NULL, t INTEGER NOT NULL);
