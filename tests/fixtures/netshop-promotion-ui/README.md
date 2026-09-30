# A 推广栏目隔离 UI 验收外壳

本外壳直接 import `app/netshop/promotion/PromotionInsightsView.tsx`、系统 `app/globals.css`、M2 原导航/期间/上下文函数；没有复制页面、拦截 fetch 或改写 DTO。初始为京东全店、2026-09-01—07、custom、合成管理员。

总控先启动自身私有 PostgreSQL 和真实 Python reader，端口 `127.0.0.1:18150`。随后在本独立工作树运行：

```powershell
npx vite --config tests/fixtures/netshop-promotion-ui/vite.config.ts
```

前端固定 `http://127.0.0.1:3150`，`strictPort=true`，不换空闲端口、不终止未知占用者。Ctrl+C 正常关闭前端；reader/PG 生命周期由总控负责。

Vite 使用普通 React 插件，未装载 vinext/Worker；`envDir=false`、空 envPrefix，不加载生产配置或暴露继承的客户端环境变量。API 代理仅到固定 `http://127.0.0.1:18150`，只允许 GET/HEAD 两个 A 接口和原 promotion-diagnostic；源端重定向被拒绝。POST 仅开放显式 QA 工具 `/fixture/advance-revision` 与 `/fixture/account-status`；其他 API、fixture 写入和付费模型请求均被前端中间件拒绝。CSP 禁止外部连接、框架嵌入和表单提交。

外壳“推进合成来源版本”不会把新数据冒充旧快照；推进后在实际栏目触发下一次读取，核验版本失效，再手动重新读取。此控制不是产品按钮。

“暂停合成账号权限”与“恢复合成账号权限”分别只发送固定 `{status:"disabled"}` / `{status:"active"}` 到 `/fixture/account-status`。Root 读取器只修改私有 PostgreSQL 的 `promotion-ui@example.test` 合成 AppUser 状态并递增其版本。前端 currentUser 保留原缓存管理员，不修改客户端角色、不改写 DTO；暂停后触发实际 A 读取或原报告读取，核验真实 actor_fence 的 403 与旧全页结果/报告清空，恢复后手动重读。两个按钮仅用于隔离权限验收，不是产品操作或生产权限管理。

`window.__promotionUiQA.events/errors/location` 和底部日志保留最多 100 条有界文本，记录异常、console error/warning、上下文与精确钻取/返回；不保存整个 DTO。账号角色暂固定合成管理员；viewer/unsupported 的真实 reader 控制须由总控定义后再接，不用客户端角色伪造权限验证。

商品钻取只展示实际 M2 导航合同得到的目标身份、期间和返回地址，不导入尚未组合的 P 实现；最终 A/P 真实组合由总控验收。此外壳是合成数据/私有 PostgreSQL UI 验证，不是生产来源或正式上线验收。
