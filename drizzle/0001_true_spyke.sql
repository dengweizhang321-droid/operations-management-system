CREATE TABLE `sales_import_upload_chunks` (
	`upload_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`object_key` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_import_upload_chunks_upload_chunk_uq` ON `sales_import_upload_chunks` (`upload_id`,`chunk_index`);--> statement-breakpoint
CREATE INDEX `sales_import_upload_chunks_upload_id_idx` ON `sales_import_upload_chunks` (`upload_id`);--> statement-breakpoint
CREATE TABLE `sales_import_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`file_name` text NOT NULL,
	`file_size_bytes` integer NOT NULL,
	`chunk_size_bytes` integer NOT NULL,
	`chunk_count` integer NOT NULL,
	`received_chunk_count` integer DEFAULT 0 NOT NULL,
	`received_bytes` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'uploading' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_import_uploads_fingerprint_uq` ON `sales_import_uploads` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `sales_import_uploads_expires_at_idx` ON `sales_import_uploads` (`expires_at`);