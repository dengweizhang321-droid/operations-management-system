CREATE TABLE `workflow_tasks` (
  `id` text PRIMARY KEY NOT NULL,
  `title` text NOT NULL,
  `work_content` text DEFAULT '' NOT NULL,
  `category` text DEFAULT '工作计划' NOT NULL,
  `owner` text DEFAULT '' NOT NULL,
  `shop_name` text DEFAULT '' NOT NULL,
  `start_date` text DEFAULT '' NOT NULL,
  `due_date` text DEFAULT '' NOT NULL,
  `status` text NOT NULL,
  `priority` text NOT NULL,
  `created_by` text DEFAULT '' NOT NULL,
  `updated_by` text DEFAULT '' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workflow_tasks_status_created_idx` ON `workflow_tasks` (`status`,`created_at`);
--> statement-breakpoint
CREATE TABLE `workflow_task_bootstrap` (
  `key` text PRIMARY KEY NOT NULL,
  `seeded_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
