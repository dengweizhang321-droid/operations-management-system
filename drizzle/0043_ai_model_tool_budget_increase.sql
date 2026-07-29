UPDATE `ai_models`
SET
  `max_tool_rounds` = MIN(`max_tool_rounds` + 50, 62),
  `max_total_tool_calls` = MIN(`max_total_tool_calls` + 50, 74),
  `updated_at` = CURRENT_TIMESTAMP
WHERE `model_type` = 'text'
  AND NOT EXISTS (
    SELECT 1
    FROM `ai_system_settings`
    WHERE `key` = 'ai-model-tool-budget-increase-2026-07-30'
  );
--> statement-breakpoint
INSERT INTO `ai_system_settings` (`key`, `value_json`, `updated_by`, `updated_at`)
VALUES (
  'ai-model-tool-budget-increase-2026-07-30',
  '{"increaseBy":50,"maximumRounds":62,"maximumTotalCalls":74}',
  'system_migration',
  CURRENT_TIMESTAMP
)
ON CONFLICT(`key`) DO NOTHING;
