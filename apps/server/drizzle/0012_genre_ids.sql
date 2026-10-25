-- §9.1 genres: `items.genres` and the `genres` overrides hold projo genre ids (`genreIds` of
-- packages/shared/api/genres.ts) instead of TMDB names in the metadata language.
-- 1. every item: TMDB names (fr and en, case insensitive for ASCII; the ids themselves are
--    accepted too) → ids, unknown names dropped;
-- 2. movies and series: ids from their cached TMDB details (`tmdb_responses`), more exact;
-- 3. seasons and episodes: the genres of their series;
-- 4. `item_overrides` (field `genres`): names → ids, and the items take the override back.
-- Order kept (TMDB order, then the order of a split genre), duplicates dropped. Locked items
-- (a `genres` override) are left to step 4.
CREATE TEMP TABLE `_genre_tmdb` (`kind` text NOT NULL, `tmdb_id` integer NOT NULL, `genre` text NOT NULL, `pos` integer NOT NULL);
--> statement-breakpoint
INSERT INTO `_genre_tmdb` (`kind`, `tmdb_id`, `genre`, `pos`) VALUES
	('movie', 28, 'action', 0),
	('movie', 12, 'adventure', 0),
	('movie', 16, 'animation', 0),
	('movie', 35, 'comedy', 0),
	('movie', 80, 'crime', 0),
	('movie', 99, 'documentary', 0),
	('movie', 18, 'drama', 0),
	('movie', 10751, 'family', 0),
	('movie', 14, 'fantasy', 0),
	('movie', 36, 'history', 0),
	('movie', 27, 'horror', 0),
	('movie', 10402, 'music', 0),
	('movie', 9648, 'mystery', 0),
	('movie', 10749, 'romance', 0),
	('movie', 878, 'science_fiction', 0),
	('movie', 10770, 'tv_movie', 0),
	('movie', 53, 'thriller', 0),
	('movie', 10752, 'war', 0),
	('movie', 37, 'western', 0),
	('series', 16, 'animation', 0),
	('series', 35, 'comedy', 0),
	('series', 80, 'crime', 0),
	('series', 99, 'documentary', 0),
	('series', 18, 'drama', 0),
	('series', 10751, 'family', 0),
	('series', 9648, 'mystery', 0),
	('series', 37, 'western', 0),
	('series', 10759, 'action', 0),
	('series', 10759, 'adventure', 1),
	('series', 10762, 'kids', 0),
	('series', 10763, 'news', 0),
	('series', 10764, 'reality', 0),
	('series', 10765, 'science_fiction', 0),
	('series', 10765, 'fantasy', 1),
	('series', 10766, 'soap', 0),
	('series', 10767, 'talk', 0),
	('series', 10768, 'war', 0),
	('series', 10768, 'politics', 1);
--> statement-breakpoint
CREATE TEMP TABLE `_genre_names` (`name` text NOT NULL COLLATE NOCASE, `genre` text NOT NULL, `pos` integer NOT NULL);
--> statement-breakpoint
INSERT INTO `_genre_names` (`name`, `genre`, `pos`) VALUES
	('action', 'action', 0), ('adventure', 'adventure', 0), ('animation', 'animation', 0),
	('comedy', 'comedy', 0), ('crime', 'crime', 0), ('documentary', 'documentary', 0),
	('drama', 'drama', 0), ('family', 'family', 0), ('fantasy', 'fantasy', 0),
	('history', 'history', 0), ('horror', 'horror', 0), ('kids', 'kids', 0), ('music', 'music', 0),
	('mystery', 'mystery', 0), ('news', 'news', 0), ('politics', 'politics', 0),
	('reality', 'reality', 0), ('romance', 'romance', 0), ('science_fiction', 'science_fiction', 0),
	('soap', 'soap', 0), ('talk', 'talk', 0), ('thriller', 'thriller', 0),
	('tv_movie', 'tv_movie', 0), ('war', 'war', 0), ('western', 'western', 0),
	('Aventure', 'adventure', 0), ('Comédie', 'comedy', 0), ('Policier', 'crime', 0),
	('Documentaire', 'documentary', 0), ('Drame', 'drama', 0), ('Familial', 'family', 0),
	('Famille', 'family', 0), ('Fantastique', 'fantasy', 0), ('Histoire', 'history', 0),
	('Horreur', 'horror', 0), ('Enfants', 'kids', 0), ('Musique', 'music', 0),
	('Mystère', 'mystery', 0), ('Actualités', 'news', 0), ('Informations', 'news', 0),
	('Politique', 'politics', 0), ('Téléréalité', 'reality', 0), ('Science-Fiction', 'science_fiction', 0),
	('Science Fiction', 'science_fiction', 0), ('Feuilleton', 'soap', 0), ('Talk-show', 'talk', 0),
	('Téléfilm', 'tv_movie', 0), ('TV Movie', 'tv_movie', 0), ('Guerre', 'war', 0),
	('Action & Adventure', 'action', 0), ('Action & Adventure', 'adventure', 1),
	('Action & Aventure', 'action', 0), ('Action & Aventure', 'adventure', 1),
	('Sci-Fi & Fantasy', 'science_fiction', 0), ('Sci-Fi & Fantasy', 'fantasy', 1),
	('Science-Fiction & Fantastique', 'science_fiction', 0), ('Science-Fiction & Fantastique', 'fantasy', 1),
	('War & Politics', 'war', 0), ('War & Politics', 'politics', 1),
	('Guerre & Politique', 'war', 0), ('Guerre & Politique', 'politics', 1);
--> statement-breakpoint
UPDATE `items` SET `genres` = (
	SELECT json_group_array(`genre`) FROM (
		SELECT n.`genre`, min(g.`key` * 10 + n.`pos`) AS `ord`
		FROM json_each(CASE WHEN json_valid(`items`.`genres`) AND json_type(`items`.`genres`) = 'array' THEN `items`.`genres` ELSE '[]' END) g
		JOIN `_genre_names` n ON n.`name` = trim(CASE g.`type` WHEN 'object' THEN json_extract(g.`value`, '$.name') ELSE g.`value` END)
		GROUP BY n.`genre` ORDER BY `ord` LIMIT -1
	)
);
--> statement-breakpoint
UPDATE `items` SET `genres` = (
	SELECT json_group_array(`genre`) FROM (
		SELECT m.`genre`, min(g.`key` * 10 + m.`pos`) AS `ord`
		FROM json_each((
			SELECT r.`payload` FROM `tmdb_responses` r
			WHERE r.`key` LIKE (CASE `items`.`kind` WHEN 'movie' THEN 'movie/' ELSE 'tv/' END) || `items`.`tmdb_id` || '?%' AND json_valid(r.`payload`)
			ORDER BY r.`fetched_at` DESC LIMIT 1
		), '$.genres') g
		JOIN `_genre_tmdb` m ON m.`kind` = `items`.`kind` AND m.`tmdb_id` = json_extract(g.`value`, '$.id')
		GROUP BY m.`genre` ORDER BY `ord` LIMIT -1
	)
)
WHERE `kind` IN ('movie', 'series') AND `tmdb_id` IS NOT NULL
	AND EXISTS (
		SELECT 1 FROM `tmdb_responses` r
		WHERE r.`key` LIKE (CASE `items`.`kind` WHEN 'movie' THEN 'movie/' ELSE 'tv/' END) || `items`.`tmdb_id` || '?%' AND json_valid(r.`payload`)
	)
	AND NOT EXISTS (SELECT 1 FROM `item_overrides` o WHERE o.`item_id` = `items`.`id` AND o.`field` = 'genres');
--> statement-breakpoint
UPDATE `items` SET `genres` = (
	SELECT s.`genres` FROM `items` s
	WHERE s.`kind` = 'series'
		AND s.`id` IN (`items`.`parent_id`, (SELECT p.`parent_id` FROM `items` p WHERE p.`id` = `items`.`parent_id`))
)
WHERE `kind` IN ('season', 'episode')
	AND EXISTS (
		SELECT 1 FROM `items` s
		WHERE s.`kind` = 'series'
			AND s.`id` IN (`items`.`parent_id`, (SELECT p.`parent_id` FROM `items` p WHERE p.`id` = `items`.`parent_id`))
	)
	AND NOT EXISTS (SELECT 1 FROM `item_overrides` o WHERE o.`item_id` = `items`.`id` AND o.`field` = 'genres');
--> statement-breakpoint
UPDATE `item_overrides` SET `value` = (
	SELECT json_group_array(`genre`) FROM (
		SELECT n.`genre`, min(g.`key` * 10 + n.`pos`) AS `ord`
		FROM json_each(CASE WHEN json_valid(`item_overrides`.`value`) AND json_type(`item_overrides`.`value`) = 'array' THEN `item_overrides`.`value` ELSE '[]' END) g
		JOIN `_genre_names` n ON n.`name` = trim(CASE g.`type` WHEN 'object' THEN json_extract(g.`value`, '$.name') ELSE g.`value` END)
		GROUP BY n.`genre` ORDER BY `ord` LIMIT -1
	)
)
WHERE `field` = 'genres';
--> statement-breakpoint
UPDATE `items` SET `genres` = (
	SELECT o.`value` FROM `item_overrides` o WHERE o.`item_id` = `items`.`id` AND o.`field` = 'genres'
)
WHERE EXISTS (SELECT 1 FROM `item_overrides` o WHERE o.`item_id` = `items`.`id` AND o.`field` = 'genres');
--> statement-breakpoint
DROP TABLE `_genre_tmdb`;
--> statement-breakpoint
DROP TABLE `_genre_names`;
