# Absorb Anything

**把任何代码库吸纳成可沉淀、可复用的证据。**

这是一个 local-first 的 CLI，写给靠读别人代码吃饭的人——以及 AI agent。把它指向一个你在评估、研究或准备借鉴的仓库，它会给这个来源一个**家**：checkout、观察记录、分析和沉淀下来的知识都攒在这里，而不是随着终端关闭、下一个对话从零开始而蒸发。

```bash
absorb init                                      # 建一个证据工作区
absorb add https://github.com/qiskit/qiskit      # 给一个代码库安家
absorb log qiskit                                # 上次读完之后它变了什么
absorb analysis new "调度器值得采用吗" --for-source qiskit
absorb knowledge add pattern "Pulse schedule 是不可变的计划对象"
```

> 状态：预发布，尚未上 npm。上面的命令面是首个版本的既定契约，不是效果图。

## 一个闭环

```
sources/ ──▶ analyses/ ──▶ knowledge/
  吸纳它       对它下判断      留下经得住的
```

**Source** 是保持来源与变化可读的外部代码：会同步的 git checkout，或一次性拷贝。**Analysis** 是读代码、下判断的工作台面。**Knowledge** 是判断之后活下来、值得复用的东西。从头到尾都是文件：没有服务、没有数据库、不用注册。

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

写操作结尾附一行最常被违反的规则，报错直接陈述正确模型而不是光拒绝。会话开局跑 `absorb prime`，后面就不容易跑偏。

## 成对使用

Absorb Anything 是双工具套件的研读半边：[`own-work`](../own-work) 在同一套磁盘格式上管理你基于证据去建设的东西——task、roadmap、spec、system。单用一半或两个都装均可。

**Absorb Anything. Build Your Own.**

## License

MIT.
