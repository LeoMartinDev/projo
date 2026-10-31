-- §13.5 search: ligatures folded in the index like `foldLigatures` (core/catalog/search.ts) folds
-- the query (œ → oe, æ → ae, ß → ss): "coeur" finds "Cœur". `unicode61 remove_diacritics` does
-- not split them. The two indexing triggers of `0002_search` are recreated with the folding, then
-- every indexed title is written again.
DROP TRIGGER `items_search_insert`;
--> statement-breakpoint
DROP TRIGGER `items_search_update`;
--> statement-breakpoint
CREATE TRIGGER `items_search_insert` AFTER INSERT ON `items` WHEN NEW.kind IN ('movie', 'series') BEGIN
	INSERT OR IGNORE INTO search_documents (item_id) VALUES (NEW.id);
	INSERT INTO items_fts (rowid, title, original_title)
		SELECT id, replace(replace(replace(replace(replace(replace(NEW.title, 'Œ', 'OE'), 'œ', 'oe'), 'Æ', 'AE'), 'æ', 'ae'), 'ẞ', 'SS'), 'ß', 'ss'),
			replace(replace(replace(replace(replace(replace(coalesce(NEW.original_title, ''), 'Œ', 'OE'), 'œ', 'oe'), 'Æ', 'AE'), 'æ', 'ae'), 'ẞ', 'SS'), 'ß', 'ss')
		FROM search_documents WHERE item_id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER `items_search_update` AFTER UPDATE OF title, original_title, kind ON `items` BEGIN
	DELETE FROM items_fts WHERE rowid IN (SELECT id FROM search_documents WHERE item_id = OLD.id);
	DELETE FROM search_documents WHERE item_id = OLD.id AND NEW.kind NOT IN ('movie', 'series');
	INSERT OR IGNORE INTO search_documents (item_id) SELECT NEW.id WHERE NEW.kind IN ('movie', 'series');
	INSERT INTO items_fts (rowid, title, original_title)
		SELECT id, replace(replace(replace(replace(replace(replace(NEW.title, 'Œ', 'OE'), 'œ', 'oe'), 'Æ', 'AE'), 'æ', 'ae'), 'ẞ', 'SS'), 'ß', 'ss'),
			replace(replace(replace(replace(replace(replace(coalesce(NEW.original_title, ''), 'Œ', 'OE'), 'œ', 'oe'), 'Æ', 'AE'), 'æ', 'ae'), 'ẞ', 'SS'), 'ß', 'ss')
		FROM search_documents
		WHERE item_id = NEW.id AND NEW.kind IN ('movie', 'series');
END;
--> statement-breakpoint
DELETE FROM items_fts;
--> statement-breakpoint
INSERT INTO items_fts (rowid, title, original_title)
	SELECT d.id, replace(replace(replace(replace(replace(replace(i.title, 'Œ', 'OE'), 'œ', 'oe'), 'Æ', 'AE'), 'æ', 'ae'), 'ẞ', 'SS'), 'ß', 'ss'),
		replace(replace(replace(replace(replace(replace(coalesce(i.original_title, ''), 'Œ', 'OE'), 'œ', 'oe'), 'Æ', 'AE'), 'æ', 'ae'), 'ẞ', 'SS'), 'ß', 'ss')
	FROM search_documents d JOIN items i ON i.id = d.item_id;
