# 四方牌桌

基于 Void、Solid 和 Cloudflare Durable Objects 的四人网页麻将。

## 本地运行

首次启动时，从 [env.example](env.example) 创建项目根目录下的 `.env`。已有 `.env` 时，只补齐缺少的变量。

```powershell
if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath 'env.example' -Destination '.env'
}
```

模板中的 `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` 供 `pnpm dev` 和 `pnpm test:worker` 初始化本地 `HYPERDRIVE` 绑定。试玩可使用示例值，无需启动 PostgreSQL。需要执行本地 PostgreSQL 迁移时，在 `.env` 中设置实际的 `DATABASE_URL`。

```sh
pnpm install
pnpm dev
```

打开开发服务器的首页 `/`，点击麻将进入 `/games/mahjong`。选中玩法卡片后，填写昵称创建房间，或输入房间码加入。邀请链接 `/games/mahjong?room=<roomId>` 直接打开加入表单。带有效房间码的旧链接 `/?room=<roomId>` 会自动跳转。

本机可以用四个独立标签页加入同一房间，每个标签页保存自己的座位凭证。刷新页面或网络中断时会尝试恢复座位。房间和牌局由本地 Worker 的 Durable Object 保存。牌桌当前使用 2D 渲染，三种玩法均为四人单局。[玩法规则](docs/rules.md)

## 代码入口

| 审核入口 | 职责 |
| --- | --- |
| [`pages/index.tsx`](pages/index.tsx) · [`pages/games/mahjong.tsx`](pages/games/mahjong.tsx) | 游戏目录、麻将玩法卡片、入房与牌桌。 |
| [`routes/api/rooms/`](routes/api/rooms) · [`room/http.ts`](src/room/http.ts) | 通用房间 HTTP 入口与共享参数校验，负责建房、加入和转发 WebSocket 握手。 |
| [`room/session.ts`](src/room/session.ts) · [`room/engine.ts`](src/room/engine.ts) | 通用房间及引擎接口。房间检查建房冲突，负责按桌串行执行、命令去重、保存和重连。 |
| [`mahjong/engine.ts`](src/mahjong/engine.ts) · [`rules/registry.ts`](src/mahjong/rules/registry.ts) | 麻将引擎按注册表取已登记的规则。玩法模块提供 ID、名称、版本、人数和规则实现。 |
| [`durable-objects/room-object.ts`](durable-objects/room-object.ts) · [`game-registry.ts`](src/game-registry.ts) | 共用的 DO 入口。建房时按请求装配游戏，处理加入、消息和 Alarm 时恢复会话。 |
| [`room/game-adapter.ts`](src/room/game-adapter.ts) · [`mahjong/room-adapter.ts`](src/mahjong/room-adapter.ts) | 将游戏引擎和消息解析器装配到同一会话。DO 直接调用 `Room` 的生命周期方法，动作由解析器转换为房间命令。 |
| [`protocol/messages.ts`](src/mahjong/protocol/messages.ts) · [`client/board.tsx`](src/mahjong/client/board.tsx) | 网络边界及只消费座位视图的牌桌。 |
| [系统架构](docs/architecture/mahjong.md) | 依赖图、方法调用时序、新增玩法与游戏的接入方式。 |

## 验证

```sh
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm test:worker
pnpm build
```

`pnpm test:coverage` 统计通用房间、麻将引擎、接入配置、规则和协议的覆盖率。语句、行和函数至少 90%，分支至少 80%。`pnpm test:worker` 启动独立端口的本地 Void Worker，通过真实 HTTP 和 WebSocket 验证游戏入口、玩法选择、邀请链接、建房校验、三种玩法联机、重连和 Alarm。设置 `MAHJONG_TEST_URL` 可指定已经运行的开发服务器地址。[测试配置](vitest.config.ts) · [Worker 集成测试](tests/worker/room.test.ts)

## Cloudflare 部署

仓库的部署工作流需要目标 Cloudflare 账号的 `CLOUDFLARE_API_TOKEN`。仓库也保留了已有的 PostgreSQL Hyperdrive 和数据库迁移，部署工作流使用 `DATABASE_URL` 执行 PostgreSQL 迁移。房间与麻将牌局只使用 Durable Object 存储。[部署工作流](.github/workflows/void-deploy.yml) · [Void 资源锁文件](void.lock.json)
