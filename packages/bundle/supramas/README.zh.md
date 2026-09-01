---
description: "通过源码交付的持久、证据支撑型 SupraMAS 材料研究 DSH profile。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-supramas-bundle

[English](README.md) | 中文

## 概述

这个静态 profile patch 按依赖顺序向 DSH profile 加入持久 SupraMAS 能力、兼容文件写入器、学术检索与 PDF 导入 provider、版本化浏览器 API、十八工具模型消费者和实时非技术研究工作区。它不改变 agent loop 行为，本身也不拥有运行时状态。

## 目录

- [使用方式](#use-this-package)
- [安装并运行源码二开仓库](#install-and-run-the-source-fork)
- [升级源码 checkout](#upgrade-a-source-checkout)
- [发布边界](#release-boundary)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>

## 使用方式

把本 bundle 加在 base 和 Web profile bundle 之后。base profile 提供 SupraMAS 使用的 DSH storage 服务。选择内置 `supramas` agent preset，即可使用材料科学 persona、skills、用户提问和进程内委派控制。

从源码 checkout 试运行时，先构建一次，再把本 bundle 作为 overlay 启动普通 Web profile：

```powershell
pnpm run build
pnpm run build:web
pnpm dsh web --patch packages/bundle/supramas/cordis.patch.yml
```

<a id="install-and-run-the-source-fork"></a>

## 安装并运行源码二开仓库

使用 Node.js `^22.19.0` 或 `>=24.0.0`、pnpm `11.7.0`，并为全文 PDF 抽取准备带 `pypdf` 的 Python 环境。

```powershell
git clone --branch feat/supramas-platform https://github.com/zztyac/supramas_dsh.git
cd supramas_dsh
corepack enable
pnpm install --frozen-lockfile
python -m pip install pypdf
pnpm run migrate:supramas-storage
pnpm run build
pnpm run build:web
pnpm run test:supramas
pnpm dsh web --patch packages/bundle/supramas/cordis.patch.yml
```

打开 `http://127.0.0.1:3080`，选择 **SupraMAS** 预设，再进入 **材料任务**。`pnpm run verify:supramas` 是较慢的发布前检查：它会重新生成 Host 契约、对浏览器 face 做类型检查，并运行完整 SupraMAS 包测试。

<a id="upgrade-a-source-checkout"></a>

## 升级源码 checkout

继续使用同一工作目录，使产物根目录和已有 `runs/` 目录树保持稳定。升级时保留配置好的 DSH storage，不要删除 `runs/`。

```powershell
git switch feat/supramas-platform
git pull --ff-only origin feat/supramas-platform
corepack enable
pnpm install --frozen-lockfile
python -m pip install --upgrade pypdf
pnpm run migrate:supramas-storage
pnpm run build
pnpm run build:web
pnpm run verify:supramas
```

存储迁移可以重复执行。检测到旧版 v1 SupraMAS 存储时，命令会先创建带时间戳的 `.bak` 备份，再以原子方式升级数据。旧版摘要证据仍明确标记为摘要证据；迁移不会虚构 PDF 来源或子智能体交接标识。

检查通过后重启 Web 命令。持久工作流状态仍是权威来源；已完成的兼容成果可以幂等地重新生成。

<a id="release-boundary"></a>

## 发布边界

当前二开仓库通过源码分支交付。包名和版本仍跟随上游 `@deepseek-ai` 发布族，因此在迁移到自有 npm scope 并协调修改全部包名之前，个人 fork 不得执行 `release:publish`。

不发布到 npm 的发布检查仍然可用：

```powershell
pnpm run build:official
pnpm run release:verify --family dsh
pnpm run release:pack --family dsh --out dist/npm --concurrency 4
```

bundle 发布契约测试会验证声明的打包入口文件、每个已挂载 provider 的安装依赖，以及覆盖全部 SupraMAS 工作区包的依赖闭包。

<a id="understand-the-implementation"></a>

## 实现说明

`cordis.patch.yml` 按依赖顺序插入运行时、工作区内的产物写入器、文献注册表、OpenAlex provider、有界 HTTP 获取、受管 `pypdf` 解析器、论文导入协调器、Typert API、模型工具和浏览器 UI。运行时打开带版本的 `supramas` 存储领域；产物写入器使用进程工作区作为根目录；静态 bundle 本身仍不提供服务。

<a id="model-experience"></a>

## 模型体验

### Profile 组合

#### 模型看到什么

carrier 本身不显示内容。插入的包贡献十八个 `supramas_*` 运行、文献、导入、证据、导出修复和 Stage 1 工作流工具；角色白名单决定哪些 schema 可见。

#### Token 影响

bundle 没有直接成本；可见工具 schema 和所选 preset 文本产生 token 成本。

#### KV Cache 影响

修改插入行或角色可见工具会改变组合后的模型界面，并可能使前缀缓存失效。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与后续工作

- 学术检索受 OpenAlex 可用性和限流约束。
- 全文抽取需要 `pypdf`；图像型 PDF 尚无 OCR。
- 活动任务的浏览器进度使用有界轮询，而不是实时服务端事件流。
- 在 npm 包所有权从上游 scope 迁出前，本 fork 仍通过源码交付。

<a id="dev-note"></a>

### 开发备注

base 存储 provider 和 SupraMAS 能力 provider 必须位于消费者之前。不要把材料科学 行为移入 DSH core loop。
