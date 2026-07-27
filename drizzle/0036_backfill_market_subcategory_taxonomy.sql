WITH `defaults` (`category`, `segments_json`) AS (VALUES
  ('商用绞肉机切肉机切片机', '["台式绞肉机","立式绞肉机","盆式绞肉机","台式切肉机","立式切肉机","台式绞切一体机","立式绞切一体机","商用切片机","家用切片机","手动切片机","切菜机","切块机","电动锯骨机","电动切骨机","去皮机","粉碎机","其他"]'),
  ('商用洗碗机', '["揭盖式洗碗机","长龙式洗碗机","通道式洗碗机","篮传式洗碗机","超声波洗碗机","台下式洗碗机","台式洗碗机","洗杯机","水槽式洗碗机","洗碗机配套设备","其他"]'),
  ('商用切菜机', '["多功能切菜机","切丝切片机","切丁机","切葱切段机","切菜馅机","果蔬切片机","蔬菜脱水机","果蔬清洗机","土豆去皮机","饲料碎菜机","其他"]'),
  ('商用炒菜机', '["滚筒炒菜机","行星搅拌炒锅","自动炒菜机器人","台式炒菜机","立式炒菜机","电磁炒菜机","燃气炒菜机","炒饭炒粉机","多功能烹饪机","其他"]'),
  ('商用净水设备', '["RO反渗透净水设备","超滤净水设备","工业纯水设备","中央净水设备","软水设备","水处理设备","自动售水机","餐饮净水器","商用净饮一体机","滤芯及净水配件","其他"]'),
  ('商用净饮水设备', '["商用直饮机","净饮一体机","校园饮水机","工厂饮水机","幼儿园饮水机","商用管线机","桶装水饮水机","商用咖啡机","商用饮料机","滤芯及饮水配件","其他"]'),
  ('商用开水器蒸气奶泡机', '["步进式开水器","即热式开水器","储水式开水器","电热开水器","商用开水炉","直饮开水器","蒸汽开水机","蒸汽奶泡机","开水器底座及配件","其他"]')
)
INSERT OR IGNORE INTO `market_subcategory_taxonomy`
  (`id`, `category`, `subcategory`, `status`, `sort_order`, `created_by`, `updated_by`)
SELECT 'market-subcategory-default-' || lower(hex(d.category)) || '-' || lower(hex(CAST(j.value AS TEXT))),
  d.category, CAST(j.value AS TEXT), 'active', CAST(j.key AS INTEGER), 'system-default', 'system-default'
FROM `defaults` d, json_each(d.segments_json) j;
--> statement-breakpoint
INSERT OR IGNORE INTO `market_subcategory_taxonomy`
  (`id`, `category`, `subcategory`, `status`, `sort_order`, `created_by`, `updated_by`)
SELECT 'market-subcategory-ranking-' || lower(hex(category)) || '-' || lower(hex(subcategory)),
  category, subcategory, 'active', 999, 'system-migration', 'system-migration'
FROM `market_ranking_entries` WHERE category<>'' AND subcategory<>'' GROUP BY category, subcategory;
--> statement-breakpoint
INSERT OR IGNORE INTO `market_subcategory_taxonomy`
  (`id`, `category`, `subcategory`, `status`, `sort_order`, `created_by`, `updated_by`)
SELECT 'market-subcategory-annotation-' || lower(hex(category)) || '-' || lower(hex(segment)),
  category, segment, 'active', 999, 'system-migration', 'system-migration'
FROM `market_sku_annotations` WHERE category<>'' AND segment<>'' GROUP BY category, segment;
--> statement-breakpoint
INSERT OR IGNORE INTO `market_subcategory_taxonomy`
  (`id`, `category`, `subcategory`, `status`, `sort_order`, `created_by`, `updated_by`)
SELECT 'market-subcategory-item-' || lower(hex(category)) || '-' || lower(hex(subcategory)),
  category, subcategory, 'active', 999, 'system-migration', 'system-migration'
FROM (
  SELECT category, ai_segment subcategory FROM market_annotation_items WHERE category<>'' AND ai_segment<>''
  UNION SELECT category, reviewed_segment subcategory FROM market_annotation_items WHERE category<>'' AND reviewed_segment<>''
) GROUP BY category, subcategory;
--> statement-breakpoint
INSERT OR IGNORE INTO `market_subcategory_taxonomy`
  (`id`, `category`, `subcategory`, `status`, `sort_order`, `created_by`, `updated_by`)
SELECT 'market-subcategory-prompt-' || lower(hex(p.category)) || '-' || lower(hex(CAST(j.value AS TEXT))),
  p.category, CAST(j.value AS TEXT), 'active', 999, 'system-migration', 'system-migration'
FROM `market_annotation_prompt_versions` p, json_each(p.segments_json) j
WHERE p.category<>'' AND p.status<>'deleted' AND TRIM(CAST(j.value AS TEXT))<>''
GROUP BY p.category, CAST(j.value AS TEXT);
--> statement-breakpoint
INSERT OR IGNORE INTO `market_master_audit_logs`
  (`id`, `actor_email`, `actor_role`, `action`, `entity_type`, `entity_id`, `before_json`, `after_json`)
VALUES ('market-subcategory-taxonomy-v1', 'system', 'system', 'backfill_subcategory_taxonomy',
  'runtime_schema', 'market-subcategory-taxonomy-v1', '{}', '{"version":1}');
