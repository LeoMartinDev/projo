ALTER TABLE `items` ADD `metadata_language` text;
--> statement-breakpoint
-- §9.1 backfill: every TMDB item (`tmdb_id` set) takes the language it resolves to today, the
-- language of the oldest library (`created_at`, then `id`) holding a file of its movie or series
-- (episodes included), else the server setting `metadata.language`, else `fr-FR`. Local items keep
-- no language (no TMDB metadata).
WITH `_top` AS (
	SELECT i.`id` AS `item_id`, coalesce(g.`id`, p.`id`, i.`id`) AS `top_id`
	FROM `items` AS i
	LEFT JOIN `items` AS p ON p.`id` = i.`parent_id`
	LEFT JOIN `items` AS g ON g.`id` = p.`parent_id`
), `_deciding` AS (
	SELECT t.`top_id`, l.`metadata_language` AS `language`,
		row_number() OVER (PARTITION BY t.`top_id` ORDER BY l.`created_at`, l.`id`) AS `rank`
	FROM `_top` AS t
	JOIN `source_items` AS si ON si.`item_id` = t.`item_id`
	JOIN `sources` AS s ON s.`id` = si.`source_id`
	JOIN `libraries` AS l ON l.`id` = s.`library_id`
)
UPDATE `items` SET `metadata_language` = coalesce(
	(SELECT d.`language` FROM `_top` AS t
		JOIN `_deciding` AS d ON d.`top_id` = t.`top_id` AND d.`rank` = 1
		WHERE t.`item_id` = `items`.`id`),
	(SELECT CASE WHEN json_valid(`value`) AND json_type(`value`) = 'text'
		THEN nullif(trim(json_extract(`value`, '$')), '') END
		FROM `settings` WHERE `key` = 'metadata.language'),
	'fr-FR')
WHERE `tmdb_id` IS NOT NULL;
