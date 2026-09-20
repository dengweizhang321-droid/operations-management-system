UPDATE `ai_models`
SET
  `model_type` = 'vision',
  `is_default_text_model` = 0,
  `last_test_result` = '需重新测试：历史“图片”类型已升级为视觉识别，请验证真实图片输入',
  `last_tested_at` = NULL,
  `updated_at` = CURRENT_TIMESTAMP
WHERE `model_type` = 'image';

UPDATE `ai_models`
SET
  `last_test_result` = '需重新测试：此前只验证了文本连接，请验证真实图片输入',
  `last_tested_at` = NULL,
  `updated_at` = CURRENT_TIMESTAMP
WHERE `model_type` = 'vision'
  AND `last_test_result` LIKE '连接成功：OK%';
