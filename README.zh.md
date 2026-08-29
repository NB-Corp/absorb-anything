<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.svg">
  <img src="docs/assets/banner-light.svg" alt="Absorb Anything" width="720">
</picture>

**什么都能吸纳，学到的都留下。**

[![CI](https://github.com/NB-Corp/absorb-anything/actions/workflows/ci.yml/badge.svg)](https://github.com/NB-Corp/absorb-anything/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.13-brightgreen.svg)](https://nodejs.org)

[网站](https://nb-corp.github.io/absorb-anything/) · [安装](#安装) · [一个闭环](#一个闭环) · [own-work（建设半边）](https://github.com/NB-Corp/own-work)

[English](./README.md) · 简体中文

</div>

---

这是一个 local-first 的 CLI，写给一直在吸纳新东西的人——以及 AI agent。要评估的代码库、准备借鉴的库、一份参考实现、论文和它的配套仓库：把它指向你正在研读的任何材料，这份材料就有了一个**家**：checkout、观察记录、分析和沉淀下来的知识都攒在这里，而不是随着终端关闭、下一个对话从零开始而蒸发。

```bash
absorb init                                      # 在现有仓库里落一个 .absorb/
absorb add https://github.com/qiskit/qiskit      # 仓库 URL 或任意文件夹，给它安个家
absorb log qiskit                                # 上次读完之后它变了什么
absorb analysis new "调度器值得采用吗" --for-source qiskit
absorb knowledge add pattern "Pulse schedule 是不可变的计划对象"
```

> 状态：0.1.0 预发布，尚未上 npm，请按下面的步骤从源码构建。上面的命令面是首个版本的既定契约，不是效果图。

## 安装

需要 Node >= 22.13 与 pnpm 11。

```bash
git clone https://github.com/NB-Corp/absorb-anything
cd absorb-anything
pnpm install && pnpm build
```

CLI 在 `packages/absorb-anything/dist/cli.js`。怎么挂上 PATH 随你，一个 alias 就够：

```bash
alias absorb="node $PWD/packages/absorb-anything/dist/cli.js"
```

## 一个闭环

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/loop-dark.svg">
    <img src="docs/assets/loop-light.svg" alt="sources/（吸纳它）→ analyses/（对它下判断）→ knowledge/（留下经得住的）" width="640">
  </picture>
</p>

**Source** 是任何保持来源与变化可读的外部材料：会同步的 git checkout，或者其他任何东西的一次性拷贝。**Analysis** 是读代码、下判断的工作台面。**Knowledge** 是判断之后活下来、值得复用的东西。从头到尾都是文件：没有服务、没有数据库、不用注册。所有记录都收在你现有仓库的一个 `.absorb/` 目录里；想给证据单开一个专用仓，`absorb init --standalone`。

吸纳一个来源时，它从哪来、你看到的是什么状态，都会记下：

```console
$ absorb add https://github.com/sindresorhus/slugify
Added source: .absorb/sources/slugify
Observation: .absorb/sources/slugify/observations/20260828-7c318bd1aa4b.yaml
Checkout: .absorb/sources/slugify/checkout
Materials: .absorb/sources/slugify/materials
Hint: Observe changes with `absorb sync`; preserve decision-critical bytes with `absorb capture`.

$ absorb log slugify
Source log: slugify
2026-08-28T19:59:18+08:00 add normal 20260828-7c318bd1aa4b
  checkout-backed source added from https://github.com/sindresorhus/slugify
```

## Clone 一次，处处引用

跨项目研究代码的真实成本不是磁盘，是**重复读**：同一个库被 clone 进五个项目、从零理解五遍。

在这里，一个 source 的家只有一个，其他工作区用几十字节引用它：

```bash
absorb link ../research qiskit    # sources/qiskit/source.ref.yaml，整个文件就这么大
absorb sync qiskit                # 在任何引用处执行，写穿透到真正的家
absorb home qiskit                # 看家在哪
```

本机注册表记得你安过的每个家：对研究过的 URL 再执行 `absorb add` 会在 clone 之前提醒你；引用断了会告诉你家搬去了哪。

## 证据按决策计价

记录的深度跟着决策的分量走，不按工具能测什么收费：

- 随手翻翻？一条记录就是别名加日期。
- 要采用或否决？pin 一个 commit——git 来源零成本。
- 字节本身要在上游消失后活下来？`absorb capture` 带完整性哈希快照。

sync 永远不会因为 checkout 脏了就拒绝工作。在别人代码上做本地实验本来就是"读"的一部分，账本如实记下即可。

## 为 AI agent 而生

工具语义只活在文档里，agent 就会乱用。这个 CLI 在使用现场解释自己：

```bash
absorb prime            # 一屏：每个对象是干什么的 + 当前工作区状态
absorb explain source   # 对象为什么存在、何时不该用、常见误用
```

写操作结尾附一行最常被违反的规则，报错直接陈述正确模型而不是光拒绝。会话开局跑一次 `absorb prime`，agent 在有机会误读之前就拿到了语义。

## 成对使用

Absorb Anything 是双工具套件的研读半边。[`own-work`](https://github.com/NB-Corp/own-work) 是建设半边：task、roadmap、spec 与你正在建的 system，跑在同一套磁盘格式上。单用一半，或者让两个工具共用同一个 `.absorb/` 目录。

**Absorb anything. Build Your Own.**

## License

MIT.
