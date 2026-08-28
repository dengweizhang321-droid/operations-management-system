from __future__ import annotations

import json
import math
import time
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from sales.projection_sync import (
    ProjectionSyncError,
    initialize_checkpoint,
    resolve_source_path,
    retry_source_changes,
    sync_projection_once,
)


class Command(BaseCommand):
    help = (
        "Consume the D1 sales/ERP transactional outbox into the Django read "
        "projection, failing closed on any source or sequence drift."
    )

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--source",
            required=True,
            help="Exact path to the authoritative, read-only D1 SQLite file",
        )
        parser.add_argument(
            "--initialize-checkpoint",
            action="store_true",
            help="Bind the current source epoch/head after a verified full migration",
        )
        parser.add_argument(
            "--watch",
            action="store_true",
            help="Keep polling after every successful synchronization attempt",
        )
        parser.add_argument("--interval-seconds", type=float, default=5.0)
        parser.add_argument("--max-events", type=int, default=1000)
        parser.add_argument("--batch-size", type=int, default=1000)
        parser.add_argument("--source-change-retries", type=int, default=3)

    def handle(self, *args, **options) -> None:
        initialize = bool(options["initialize_checkpoint"])
        watch = bool(options["watch"])
        if initialize and watch:
            raise CommandError("--initialize-checkpoint 不能与 --watch 同时使用")

        interval_seconds = float(options["interval_seconds"])
        if (
            not math.isfinite(interval_seconds)
            or interval_seconds < 0.1
            or interval_seconds > 3600
        ):
            raise CommandError("--interval-seconds 必须在 0.1 到 3600 之间")
        retries = int(options["source_change_retries"])
        max_events = int(options["max_events"])
        batch_size = int(options["batch_size"])

        try:
            source = resolve_source_path(Path(options["source"]))

            if initialize:
                result = retry_source_changes(
                    lambda: initialize_checkpoint(source), attempts=retries
                )
                self.stdout.write(json.dumps(result, ensure_ascii=False))
                return

            while True:
                result = retry_source_changes(
                    lambda: sync_projection_once(
                        source,
                        max_events=max_events,
                        batch_size=batch_size,
                    ),
                    attempts=retries,
                )
                self.stdout.write(json.dumps(result, ensure_ascii=False))
                if not watch:
                    return
                time.sleep(interval_seconds)
        except KeyboardInterrupt:
            if not watch:
                raise
            self.stderr.write("销售投影 watch 已停止")
        except ProjectionSyncError as error:
            raise CommandError(str(error)) from error
        except Exception as error:
            raise CommandError("销售投影同步失败；目标事务已回滚") from error
