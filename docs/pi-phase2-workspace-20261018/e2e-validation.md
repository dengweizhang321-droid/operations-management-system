# 真实工作区传输与浏览器验证

最终强绑定记录：`D:\codex-artifacts\pi-phase2-workspace-20261018\e2e\attempt-20261018T200157`。真实 Chrome、React 组件、Miniflare/workerd、原薄 Worker route、Django/私有 PostgreSQL、HMAC Runner、Pi 1.3.0 与容器 PTY/Python；principal、供应商 HTTP 和中央业务来源为合成边界，没有付费供应商调用。

实际覆盖：一期取数→Python→四表 Excel 下载→刷新同代际续问、停止后续问与 unknown 围栏；新增中文 PTY、交互程序、resize、Ctrl+C、关闭、GET 重连不重发输入、同 ID 回执复用/改内容拒绝、控制响应丢失后只读恢复、文件编辑与 SHA 冲突、收集下载后同名修改仍下载原字节、文件 action 注入拒绝、会话树/统计、环境暂停与唤醒。普通扩展 select/confirm/input/editor 经真实页面回应，prefill 回读正确，set_editor_text 只填编辑器而不新增模型调用。内部网关响应没有开放给浏览器。

`source-binding.json` 含直接相关 Django、UI、route、模型/迁移及 Runner source SHA，`run-result.json` 确认运行前后未变；`runner-health.json` 验证实际拷贝 Runner SHA 与本地绑定一致。`phase2-browser-evidence.json` 保存独立输入回执、不可变下载及普通 UI 的结果。退出后容器/卷为0、Runner/PG已退出、四个私有端口关闭。

后置唯一 UI 变化为 `run.hasGap && …` 改成 `Boolean(run.hasGap) && …`，用于修复 TypeScript unknown→ReactNode。独立审查精确反构原 SHA，在实际 boolean 协议下行为等价；不冒称旧 E2E 与新文件字节一致。当前全部直接导入闭包 TypeScript 为0诊断，8个前端测试与丢回执/同轮 steer+follow_up 浏览器测试通过。增量绑定 `D:\codex-artifacts\pi-phase2-workspace-20261018\frontend-typeguard-delta.json`。

完整前端生产构建在普通权限和清空业务连接环境下完成，19.401秒、退出码0，源码前后指纹一致；仅上述同一 UI 类型增量按独审资格复用。未宣称该开发构建等同最终原生 Worker PREPARED。
