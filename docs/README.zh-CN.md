# Neat Pulse 设置导出工具

**[English](../README.md)** · [日本語](./README.ja.md) · [한국어](./README.ko.md) · [繁體中文](./README.zh-TW.md) · [简体中文](./README.zh-CN.md)

---

一款小型 Node.js Web 工具，可将 [Neat Pulse API](https://api.pulse.neat.no/docs/) 中各设备的配置导出为 CSV 文件，供您与现有 Excel 会议室设备清单进行交叉比对。

> ⚠️ **非官方工具。** 本项目与 Neat 公司无关，未获官方认可。仅使用您提供的 API 密钥调用公开文档中记载的端点。

## 功能

- 以**房间为单位**遍历设备（`GET /orgs/{org}/rooms` → `GET /orgs/{org}/rooms/{id}`），因此输出包含位置（Location）及区域（Region）信息。
- 获取各设备的当前配置（`GET /endpoints/{id}/config`）及已分配的配置文件（`GET /profiles/{profileId}`）。
- 每个配置键输出三组列：
  - `config.*` — 设备本身写入的值
  - `profile.*` — 分配的配置文件中声明的值
  - `effective.*` — 设备优先、配置文件补充的合并值
- 通过 Server-Sent Events 将进度实时推送至浏览器。
- 自动遮蔽键名含有 `password`、`token`、`secret`、`apiKey`、`privateKey`、`credential` 的敏感值（`settingsPasswordRequired` 等布尔标志除外）。
- CSV 添加 UTF-8 BOM，使 Excel 默认以 UTF-8 打开。

## 验证规模

已在实际生产租户（**560 个端点、296 个房间、25 个配置文件、11 种设备型号**）完成零错误的完整导出。默认 `CONCURRENCY=3` 是为了在此规模下避免触发 Pulse API 速率限制；较小的环境可安全地调高此值。

## 系统要求

- Node.js 18 或更高版本（使用全局 `fetch`）
- Neat Pulse **Plus** 或 **Pro** 订阅（生成 API 密钥的必要条件）
- 在 **Pulse → Settings → API** 生成的 API 密钥
- 您的组织 ID（`orgId`）

## 安装与启动

```bash
git clone https://github.com/yuki-iwagishi/neat-pulse-exporter.git
cd neat-pulse-exporter
npm install
cp .env.example .env   # 可选，详见下文
npm start
```

然后在浏览器中打开 <http://127.0.0.1:3000>。

### 通过 `.env` 进行配置（可选）

将 `.env.example` 复制为 `.env` 并填写所需值。所有变量均为可选。

| 变量名称        | 默认值      | 说明                                                              |
| --------------- | ----------- | ----------------------------------------------------------------- |
| `PORT`          | `3000`      | HTTP 监听端口                                                     |
| `HOST`          | `127.0.0.1` | 绑定地址。仅在需要局域网访问时使用 `0.0.0.0`                      |
| `CONCURRENCY`   | `3`         | 对 Pulse API 的最大并发请求数                                      |
| `PULSE_API_KEY` | _(空)_      | 设置后，UI 的 API 密钥字段可留空                                   |
| `PULSE_ORG_ID`  | _(空)_      | 同上（组织 ID）                                                   |

> **请勿提交真实的 `.env` 文件。** 该文件已列入 `.gitignore`。

## 使用方法

1. 执行 `npm start` 并在浏览器中打开页面。
2. 粘贴 API 密钥与组织 ID（若已在 `.env` 中设置则可省略）。
3. 点击 **导出为 CSV**，进度会实时显示于面板中。
4. 完成后会自动触发 CSV 下载。

CSV 每台设备一行。列为所有设备键的并集，按字母顺序排列，因此不同型号的设备可共存于同一文件中。

## 自定义

### 敏感字段遮蔽

`src/server.js` 中的 `isSecretKey()` 函数负责判断遮蔽对象。键名包含 `password`、`secret`、`token`、`apiKey`、`privateKey`、`credential` 时，值会被替换为 `***MASKED***`。请根据您的策略调整此模式。

### 对应 Excel 表格的列

默认情况下，API 返回的所有键均会成为列。若需配合 Excel 的固定列结构，最简单的方式是在 Excel 中使用 `VLOOKUP` / Power Query，或修改 `/api/export` 中的 `buildRow()` 函数，仅输出所需的键。


### 覆盖率摘要

对于已分配配置文件的一般设备，本工具可通过 `profile.*` 获取 Pulse UI 显示配置中**约 35 / 45 项**，并通过 `config.*` 额外获取 `pairingSerial`、`wifiEnabled` 等 14 个设备专属键。上述 24 + 2 个键在 Neat 于 Read API 中公开前无法获取。

## 安全注意事项

- **API 密钥通过浏览器以 POST 请求正文发送至本地 Node 进程**，不会出现在 URL 查询参数中，也不会记录或持久化存储。
- **导出的 CSV 可能包含网络信息**（MAC 地址、IP 地址、房间/位置元数据），即使遮蔽后仍需妥善保管。
- **默认绑定至 `127.0.0.1`。** 若将 `HOST` 设为非回环地址，服务器启动时会显示警告，UI 也会出现横幅提示。同一网络中的任何人均可触发导出。
- **Web UI 未内置认证功能。** 若需团队共用，请将服务器置于现有 SSO / 反向代理后方，或封装为 Electron 桌面应用程序。

### 密钥检测的局限性

通过键名模式（`password`、`secret`、`token`、`apiKey`、`privateKey`、`credential`）判断遮蔽对象，此方法存在已知的误判情况：

| 类型 | 可能误处理的键名示例 |
|------|-------------------|
| 过度遮蔽（误报） | `secretariatMode`、`tokenRefreshInterval` |
| 遮蔽遗漏（漏报） | `pwd`、`clientKey`、`bearer`、`passphrase` |

**对外分享前，请务必亲自确认导出的 CSV 文件内容。**

## 项目结构

```
neat-pulse-exporter/
├── .github/
│   └── workflows/
│       └── ci.yml             # Syntax check + smoke test (Node 18/20/22)
├── docs/
│   ├── README.ja.md           # 日本語
│   ├── README.ko.md           # 한국어
│   ├── README.zh-TW.md        # 繁體中文
│   └── README.zh-CN.md        # 简体中文
├── public/
│   └── index.html        # Single-file UI (no build step)
├── src/
│   └── server.js         # Express server + Pulse API client
├── .dockerignore
├── .env.example
├── .gitignore
├── CHANGELOG.md
├── Dockerfile
├── LICENSE
├── package.json
└── README.md
```

## 故障排除

| 症状 | 原因 / 处理方式 |
|------|---------------|
| `Pulse API 401` | API 密钥无效或已过期。请在 Pulse Settings 重新生成 |
| `Pulse API 403` | 密钥无 Read 权限，或订阅套餐不支持 API 访问 |
| `/profiles/{id}` 出现 `Pulse API 404` | 设备未分配配置文件。数据行仍会导出，但 `profile.*` 列为空 |
| `_configError` 列有值 | `/config` 获取时发生错误（如超时）。其他列仍有效 |
| `endpoints` 数组为空 | `orgId` 错误，或密钥属于其他组织 |
| Excel 显示乱码 | Excel 2016 以前的版本可能忽略 BOM。请改用"数据 → 从文本/CSV"导入 |

## 未来改进方向

- **IPv6 地址 RFC 5952 压缩** — 目前以非压缩格式输出，未来将改善可读性。
- **大型租户的流式 CSV** — 目前将所有数据行保留在内存后再输出，数千台规模可能造成内存峰值。
- **会话 / 任务分离** — 将 SSE 进度流与 CSV 下载分离，提升长时间导出的稳定性。

## 许可证

MIT — 请参阅 [LICENSE](../LICENSE)。
