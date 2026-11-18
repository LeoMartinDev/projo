-- §29.6 search: programmes stored before `search_text` existed have it empty. Clearing each
-- source's last guide attempt makes the hourly `tv-guide-refresh` read every guide again, which
-- writes the column, so they become searchable within the hour.
UPDATE `tv_sources` SET `guide_attempt_at` = NULL;
