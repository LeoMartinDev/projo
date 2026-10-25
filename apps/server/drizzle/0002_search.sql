-- §13.5 search: FTS5 over the title and original title of movies and series, accent and case
-- insensitive. `search_documents` gives each indexed item a stable integer rowid (items have a
-- text primary key, whose implicit rowid VACUUM may renumber). Kept in sync by triggers.
CREATE TABLE `search_documents` (
	`id` integer PRIMARY KEY,
	`item_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_documents_item_id_unique` ON `search_documents` (`item_id`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `items_fts` USING fts5(title, original_title, tokenize = 'unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER `items_search_insert` AFTER INSERT ON `items` WHEN NEW.kind IN ('movie', 'series') BEGIN
	INSERT OR IGNORE INTO search_documents (item_id) VALUES (NEW.id);
	INSERT INTO items_fts (rowid, title, original_title)
		SELECT id, NEW.title, coalesce(NEW.original_title, '') FROM search_documents WHERE item_id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER `items_search_update` AFTER UPDATE OF title, original_title, kind ON `items` BEGIN
	DELETE FROM items_fts WHERE rowid IN (SELECT id FROM search_documents WHERE item_id = OLD.id);
	DELETE FROM search_documents WHERE item_id = OLD.id AND NEW.kind NOT IN ('movie', 'series');
	INSERT OR IGNORE INTO search_documents (item_id) SELECT NEW.id WHERE NEW.kind IN ('movie', 'series');
	INSERT INTO items_fts (rowid, title, original_title)
		SELECT id, NEW.title, coalesce(NEW.original_title, '') FROM search_documents
		WHERE item_id = NEW.id AND NEW.kind IN ('movie', 'series');
END;
--> statement-breakpoint
CREATE TRIGGER `items_search_delete` AFTER DELETE ON `items` WHEN OLD.kind IN ('movie', 'series') BEGIN
	DELETE FROM items_fts WHERE rowid IN (SELECT id FROM search_documents WHERE item_id = OLD.id);
	DELETE FROM search_documents WHERE item_id = OLD.id;
END;
--> statement-breakpoint
INSERT INTO search_documents (item_id)
	SELECT id FROM items WHERE kind IN ('movie', 'series') ORDER BY created_at, id;
--> statement-breakpoint
INSERT INTO items_fts (rowid, title, original_title)
	SELECT d.id, i.title, coalesce(i.original_title, '') FROM search_documents d JOIN items i ON i.id = d.item_id;
--> statement-breakpoint
-- §13.3 "Ajoutés récemment": a series (and its season) comes back up when a new episode becomes
-- ready. An episode's `added_at` (first ready source) raises its season's and series'.
CREATE TRIGGER `items_added_bubble_update` AFTER UPDATE OF added_at ON `items`
	WHEN NEW.kind = 'episode' AND NEW.added_at IS NOT NULL BEGIN
	UPDATE items SET added_at = NEW.added_at
		WHERE id IN (NEW.parent_id, (SELECT parent_id FROM items WHERE id = NEW.parent_id))
			AND (added_at IS NULL OR added_at < NEW.added_at);
END;
--> statement-breakpoint
CREATE TRIGGER `items_added_bubble_insert` AFTER INSERT ON `items`
	WHEN NEW.kind = 'episode' AND NEW.added_at IS NOT NULL BEGIN
	UPDATE items SET added_at = NEW.added_at
		WHERE id IN (NEW.parent_id, (SELECT parent_id FROM items WHERE id = NEW.parent_id))
			AND (added_at IS NULL OR added_at < NEW.added_at);
END;
--> statement-breakpoint
UPDATE items SET added_at = (
		SELECT max(e.added_at) FROM items e WHERE e.parent_id = items.id AND e.kind = 'episode')
	WHERE kind = 'season' AND EXISTS (
		SELECT 1 FROM items e WHERE e.parent_id = items.id AND e.kind = 'episode'
			AND e.added_at > coalesce(items.added_at, ''));
--> statement-breakpoint
UPDATE items SET added_at = (
		SELECT max(s.added_at) FROM items s WHERE s.parent_id = items.id AND s.kind = 'season')
	WHERE kind = 'series' AND EXISTS (
		SELECT 1 FROM items s WHERE s.parent_id = items.id AND s.kind = 'season'
			AND s.added_at > coalesce(items.added_at, ''));
--> statement-breakpoint
-- `GET /images/:id` checks that an image belongs to a visible item or person (§14).
CREATE INDEX `items_poster_image_id_idx` ON `items` (`poster_image_id`) WHERE `poster_image_id` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `items_backdrop_image_id_idx` ON `items` (`backdrop_image_id`) WHERE `backdrop_image_id` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `items_logo_image_id_idx` ON `items` (`logo_image_id`) WHERE `logo_image_id` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `items_still_image_id_idx` ON `items` (`still_image_id`) WHERE `still_image_id` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `people_profile_image_id_idx` ON `people` (`profile_image_id`) WHERE `profile_image_id` IS NOT NULL;
