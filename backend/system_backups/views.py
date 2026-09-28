from django.conf import settings
from django.views.decorators.http import require_http_methods

from access_control.views import _admin, _body, _error, _json
from access_control.service import revision_header
from .runner import launch, production_store
from .storage import BackupError


@require_http_methods(["GET", "POST"])
def backups(request):
    try:
        role = settings.DJANGO_PROCESS_ROLE
        if role != "development" and role != ("access_control_reader" if request.method == "GET" else "access_control_writer"):
            raise BackupError("备份操作与服务角色不符", "access_denied", 403)
        principal = _admin(request)  # Signed envelope AND current unrestricted admin authorization.
        store = production_store()
        if request.method == "GET":
            if set(request.GET) == {"downloadId", "offset"} and all(len(request.GET.getlist(k)) == 1 for k in request.GET):
                raw = request.GET["offset"]
                if not raw.isascii() or not raw.isdigit() or len(raw) > 12:
                    raise BackupError("下载偏移无效")
                payload = store.download(principal.email, request.GET["downloadId"], int(raw))
            elif not request.GET:
                payload = store.status(principal.email)
            else:
                raise BackupError("备份查询字段无效")
        else:
            body = _body(request)
            operation = body.pop("operation", None)
            if operation == "upload-start":
                item = store.begin_upload(principal.email, body)
                payload = {"id": item["id"], "offset": item["offset"]}
            elif operation == "upload-chunk":
                payload = store.upload_chunk(principal.email, body)
            elif operation == "discard-upload" and set(body) == {"id"}:
                store.discard(principal.email, body["id"])
                payload = {"discarded": True}
            elif operation == "job":
                job, created = store.submit(principal.email, body)
                if created:
                    try:
                        launch(job["id"])
                    except Exception:
                        job = store.update_job(job["id"], status="unknown", error="任务启动结果未确认，请核查后处理")
                payload = {"job": store.public_job(job)}
            else:
                raise BackupError("备份操作无效")
        return _json(payload, revision=revision_header())
    except BackupError as error:
        return _json({"error": str(error), "code": error.code}, error.status)
    except Exception as error:
        return _error(error, "备份管理暂时不可用")
