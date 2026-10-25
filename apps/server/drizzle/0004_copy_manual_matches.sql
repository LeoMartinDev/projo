-- §9.2: corrections remembered by file (library + relative path, then signature) instead of by
-- `sources` row, so that purging a missing source no longer loses them. Copies the existing
-- corrections with the path and signature of their source.
INSERT OR IGNORE INTO `manual_matches` (`library_id`, `relative_path`, `signature`, `source_id`, `tmdb_id`, `kind`, `season_number`, `episode_number`, `created_by`, `created_at`)
SELECT s.`library_id`, s.`relative_path`, s.`signature`, m.`source_id`, m.`tmdb_id`, m.`kind`, m.`season_number`, m.`episode_number`, m.`created_by`, m.`created_at`
FROM `item_manual_matches` m
JOIN `sources` s ON s.`id` = m.`source_id`
ORDER BY m.`created_at` DESC;
