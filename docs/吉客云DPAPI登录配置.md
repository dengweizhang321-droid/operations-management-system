# 吉客云 Windows DPAPI 登录配置

吉客云自动化使用当前 Windows 用户加密保存的凭据。已有有效登录态时直接复用；登录失效时，最多填写并提交一次吉客号、手机号或工号、密码。只有企业号与受控菜单同时验证通过，才算登录成功。

## 录入或更换密码

在 PowerShell 中进入已采用当前代码的项目目录，执行：

```powershell
Set-Location -LiteralPath 'D:\运营管理系统'
npm run jackyun:credential:setup
```

本机会出现“吉客云登录凭据 · Windows DPAPI”窗口。确认显示的吉客号，在窗口内填写手机号或工号和密码，点击“加密保存”。命令返回 `status=stored`、`ready=true` 表示加密保存和本机解密复验均成功。取消窗口不会覆盖已有凭据。账号密码只在这个本机窗口输入，不粘贴到聊天、工作流或命令行参数。

检查保存结果：

```powershell
npm run jackyun:credential:status
```

`ready=true` 表示当前 Windows 用户可以解密绑定的凭据；它不代表平台已接受密码。验证平台登录：

```powershell
npm run jackyun:authenticate
```

该命令只登录并检查企业号，不筛选数据、不创建导出、不导入，也不会修改 n8n 未完成运行。只有返回 `status=authenticated` 和 `tenantVerified=true` 才算平台验证成功。`authentication=windows_dpapi_credentials` 表示当次确实使用了 DPAPI 凭据，`existing_session` 表示复用了已有登录态。

## 绑定与保密边界

- 非敏感配置在 `config/jackyun-login.json`，包括吉客号、独立 Profile、调试端口及等待预算；当前绑定吉客号为 `771168`。
- 密文在 `%LOCALAPPDATA%\TERUISI\JackyunCredentials`。文件名是绑定摘要，文件不保存明文账号或密码；DPAPI 使用 `CurrentUser`，加密附加信息和内容同时绑定吉客号与规范化 Profile 路径。目录关闭权限继承，仅允许当前用户、SYSTEM 和管理员；重解析路径、所有者/ACL 异常、内容损坏或绑定不符均拒绝读取。
- n8n 继续只调用 helper，不持有账号、密码、Cookie、环境变量或解密接口。固定 DPAPI 程序随不可变 helper 编译，未放宽 release builder、verifier 或 Django 发布门禁。
- 更换 Windows 用户、吉客号或 Profile 后，需重新配置相应绑定。不得复制别人的凭据文件或将旧密文伪装为新账号。

## 失败处理

页面初始加载最多等待 30 秒，提交后最多等待 45 秒。自动化先验证浏览器进程属于当前 Windows 用户，且可执行文件、Profile 和端口匹配，再检查精确站点 `https://web.jackyun.com`。真实登录表单的控件为 `#selAccount`、`#txtUserName`、`#txtPwd` 和 `#btnLogin`；隐藏的找回密码表单不会被当成登录表单。字段句柄绑定已观察的文档，页面跳转时不得把凭据自动重试填入新页面。

验证码、短信、滑块、安全验证、密码拒绝、企业号错误、表单不唯一或提交结果不确定都会停止。不要反复点击登录或重复启动业务流程；有人工验证时使用 `npm run jackyun:login` 打开专用浏览器处理。登录维护前必须等待共享 helper 空闲，并持有相同的吉客云全局运行锁。

n8n execution `841` 在旧登录探测阶段停止的记录继续保留。配置 DPAPI 不会关闭原计划、删除 active 清单或证明五表导出导入已经完成；后续业务恢复仍需遵守五表流程的原运行证据规则。

## 验证记录

2026-09-06，操作者在本机窗口完成录入，凭据状态检查返回 `ready=true`。隔离工作树中的纯登录验证返回 `authenticated / windows_dpapi_credentials / tenantVerified=true`，证明当前用户的 DPAPI 凭据已被吉客云接受；本次未触发导出或业务导入。n8n 运行中的 helper 采用情况以受控 release 回读为准，不能用源码验证代替已发布证据。

相关 36 项登录/导出状态机检查通过，包含本地页面夹具与 Windows DPAPI 合成凭据往返、复制绑定、密文损坏和权限继承拒绝测试。最终完整回归 1,871 项通过、20 项跳过、0 失败；lint 为 0 错误、9 项既有警告，生产构建、20 项渲染检查及 Django 边界检查通过。全库 TypeScript 当前与同一 main 基线均为 142 项既有诊断，按文件、错误码和消息比较无增减，不宣称全库类型检查通过。
