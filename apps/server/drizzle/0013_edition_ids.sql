-- §7.7, §8.1 editions: `sources.parsed.edition` holds an edition id (`editionIds` of
-- packages/shared/api/versions.ts) instead of an English label, and the text of a `{edition-…}`
-- tag moves to `parsed.editionName`, as written. `version_label` is no longer written nor read:
-- the version (resolution, dynamic range, codec, edition) is derived from `probe` and `parsed`.
-- 1. a path with a `{edition-…}` tag: the stored text is the tag's → `editionName`;
-- 2. a known label → its id; the `stack_group_id` of a stacked file ends with the edition, it
--    takes the id too (the key a scan would compute now);
-- 3. any other text → `editionName`.
CREATE TEMP TABLE `_editions` (`label` text NOT NULL, `id` text NOT NULL);
--> statement-breakpoint
INSERT INTO `_editions` (`label`, `id`) VALUES
	('Director''s Cut', 'directors_cut'),
	('Extended Cut', 'extended'),
	('Theatrical Cut', 'theatrical'),
	('Final Cut', 'final_cut'),
	('Unrated Cut', 'unrated'),
	('Uncut', 'uncut'),
	('Special Edition', 'special_edition'),
	('Ultimate Edition', 'ultimate_edition'),
	('IMAX', 'imax'),
	('Remastered', 'remastered');
--> statement-breakpoint
UPDATE `sources` SET `parsed` = json_set(
	json_remove(`parsed`, '$.edition'), '$.editionName', json_extract(`parsed`, '$.edition')
)
WHERE json_valid(`parsed`) AND json_type(`parsed`, '$.edition') = 'text'
	AND lower(`relative_path`) LIKE '%{%edition%-%}%';
--> statement-breakpoint
UPDATE `sources` SET `stack_group_id` = (
	SELECT substr(`sources`.`stack_group_id`, 1, length(`sources`.`stack_group_id`) - length(e.`label`)) || e.`id`
	FROM `_editions` e WHERE e.`label` = json_extract(`sources`.`parsed`, '$.edition')
)
WHERE `stack_group_id` IS NOT NULL AND json_valid(`parsed`) AND json_type(`parsed`, '$.edition') = 'text'
	AND EXISTS (
		SELECT 1 FROM `_editions` e
		WHERE e.`label` = json_extract(`sources`.`parsed`, '$.edition')
			AND substr(`sources`.`stack_group_id`, -length(e.`label`) - 1) = '|' || e.`label`
	);
--> statement-breakpoint
UPDATE `sources` SET `parsed` = json_set(`parsed`, '$.edition', (
	SELECT e.`id` FROM `_editions` e WHERE e.`label` = json_extract(`sources`.`parsed`, '$.edition')
))
WHERE json_valid(`parsed`) AND json_type(`parsed`, '$.edition') = 'text'
	AND EXISTS (SELECT 1 FROM `_editions` e WHERE e.`label` = json_extract(`sources`.`parsed`, '$.edition'));
--> statement-breakpoint
UPDATE `sources` SET `parsed` = json_set(
	json_remove(`parsed`, '$.edition'), '$.editionName', json_extract(`parsed`, '$.edition')
)
WHERE json_valid(`parsed`) AND json_type(`parsed`, '$.edition') = 'text'
	AND json_extract(`parsed`, '$.edition') NOT IN (SELECT `id` FROM `_editions`);
--> statement-breakpoint
UPDATE `sources` SET `parsed` = json_remove(`parsed`, '$.edition')
WHERE json_valid(`parsed`) AND json_type(`parsed`, '$.edition') IS NOT NULL
	AND json_type(`parsed`, '$.edition') <> 'text';
--> statement-breakpoint
DROP TABLE `_editions`;
