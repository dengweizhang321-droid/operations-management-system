# 全景隔离组件验收

此入口只渲染实际 S/P/A React 组件并代理到 `127.0.0.1:18160` 私有测试读取器。合成事实存于随机端口、随机 SCRAM 凭据的 PostgreSQL；处理器实际查询数据库。它不使用正式 cookie、配置、网关或生产数据，不把夹具安装到正式页面。公共 Home、SDK、gateway、权限签名与旧视图组合由总控在精确公共提交上另验。

- UI：3162；只读服务：18160；13160保留不用。端口占用失败，不接管、终止或替换别人的进程。
- `pg-ui-server.py --evidence-directory E:/codex-artifacts/netshop-panorama-M5-20261001/ui-private-<unique>` 创建自己的全新证据/数据库；`serve.mjs` 使用新的同根 `ui-vite-<unique>` 证据目录。仅启动本次隔离资源，不调用系统服务引擎。
- GET 仅固定的全景、F context、P list/detail、A list/detail。其它 API 拒绝。固定 fixture POST 仅在私有库修改测试账号、修订或启用故障/延迟注入，不写业务库。
- 将 `stop.request` 写入相应独占证据目录，按正常关闭路径停止自己的 HTTP/PG 或 Vite。900秒自动到期，不由 shell stdin 的 EOF 决定生命周期。
- 证据分别标明 SQL 实际读取、故障注入、客户端协议夹具、组件 UI；合成源不等于生产来源验收。未接公共 consumer 的章节明确 `dependency_pending`，不记为完成。
