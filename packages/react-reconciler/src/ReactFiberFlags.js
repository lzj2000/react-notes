/**
 * React Fiber 标志位定义文件
 * 
 * 此文件是 React Fiber 架构的核心配置之一，定义了所有用于标记 Fiber 节点状态、
 * 待执行操作及副作用的「标志位」。这些标志位采用「位掩码（bitmask）」技术实现，
 * 通过二进制位的组合与运算，高效地在单个数字变量中存储/判断多个状态，大幅提升
 * Fiber 树遍历和更新处理的性能。
 * 
 * 核心设计思路：
 * 1. 每个标志位对应一个唯一的二进制位（如 0b10 代表第2位，0b100 代表第3位）
 * 2. 通过「按位或（|）」组合多个标志（如 Placement | Update 表示同时需要插入和更新）
 * 3. 通过「按位与（&）」判断是否包含某个标志（如 flags & Placement !== 0 表示需要插入）
 * 
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * 源代码基于 MIT 协议开源，可在项目根目录的 LICENSE 文件中查看完整协议。
 *
 * @flow  // Flow 类型检查标识，确保代码类型安全
 */

// 导入 React 特性开关，用于根据配置动态启用/禁用部分标志位逻辑
import {
    enableCreateEventHandleAPI,    // 启用 createEventHandle API 的特性开关（用于事件处理相关功能）
    enableUseEffectEventHook,      // 启用 useEffectEvent Hook 的特性开关（用于副作用事件优化）
} from 'shared/ReactFeatureFlags';

// 定义 Flags 类型为数字类型，因为标志位本质是二进制位组合的数字
export type Flags = number;

// ==================== 基础标志位（核心不可修改）====================
// 注意：这些标志位的值不可随意修改，React DevTools（开发者工具）依赖此值识别节点状态
// 每个标志位对应一个独立的二进制位，避免位冲突

/** 
 * 无标志位 
 * 表示当前 Fiber 节点没有任何待执行的副作用或操作，处于「空闲状态」
 */
export const NoFlags = /*                      */ 0b0000000000000000000000000000000;

/** 
 * 已执行工作标志 
 * 标记当前 Fiber 节点已经完成了渲染阶段的核心计算（如 Diff 对比、子树构建），
 * 用于 React 内部追踪节点的工作状态，避免重复计算
 */
export const PerformedWork = /*                */ 0b0000000000000000000000000000001;

/** 
 * 插入标志 
 * 标记当前 Fiber 节点对应的真实 DOM 需要被「插入到 DOM 树中」，
 * 仅用于新创建的节点（首次渲染或动态新增的节点）
 */
export const Placement = /*                    */ 0b0000000000000000000000000000010;

/** 
 * 已捕获错误标志 
 * 标记当前 Fiber 节点（通常是错误边界组件）已经捕获了子树抛出的错误，
 * 用于 React 错误处理机制，避免错误冒泡到更上层组件
 */
export const DidCapture = /*                   */ 0b0000000000000000000000010000000;

/** 
 * 水合标志 
 * 标记当前 Fiber 节点正在执行「服务端渲染（SSR）的水合过程」，
 * 即把服务端返回的静态 HTML 转换为可交互的 React 组件，此过程中会复用现有 DOM 结构
 */
export const Hydrating = /*                    */ 0b0000000000000000001000000000000;

// ==================== 可变标志位（可扩展新增）====================
// 这些标志位用于标记具体的业务操作或副作用，后续可根据新特性扩展（需确保位不冲突）

/** 
 * 更新标志 
 * 标记当前 Fiber 节点对应的真实 DOM 需要「更新属性或内容」，
 * 如 props 变化（className 从 'old' 变 'new'）、文本内容变化等
 */
export const Update = /*                       */ 0b0000000000000000000000000000100;

/** 
 * 克隆标志 
 * 标记当前 Fiber 节点是从其他 Fiber 节点（通常是 current 树的节点）「克隆而来」，
 * 用于 Fiber 树复用优化，避免重复创建结构相同的节点
 */
export const Cloned = /*                       */ 0b0000000000000000000000000001000;

/** 
 * 子节点删除标志 
 * 标记当前 Fiber 节点的「子节点中存在需要删除的节点」，
 * 后续提交阶段会遍历子树，移除对应的真实 DOM
 */
export const ChildDeletion = /*                */ 0b0000000000000000000000000010000;

/** 
 * 内容重置标志 
 * 标记当前 Fiber 节点的内容需要「重置为初始状态」，
 * 常见场景：表单重置、组件强制刷新内容等
 */
export const ContentReset = /*                 */ 0b0000000000000000000000000100000;

/** 
 * 回调标志 
 * 标记当前 Fiber 节点有「待执行的回调函数」，
 * 如类组件的 componentDidMount、componentDidUpdate 等生命周期回调
 */
export const Callback = /*                     */ 0b0000000000000000000000001000000;
/* 注：0b0000000000000000000000010000000 此位已被 DidCapture 占用，不可重复使用 */

/** 
 * 强制客户端渲染标志 
 * 强制当前 Fiber 节点「跳过服务端渲染的水合过程，直接在客户端重新渲染」，
 * 用于解决服务端渲染与客户端状态不匹配的场景（如客户端特有状态的组件）
 */
export const ForceClientRender = /*            */ 0b0000000000000000000000100000000;

/** 
 * 引用标志 
 * 标记当前 Fiber 节点有「ref 需要处理」，
 * 如组件中使用了 useRef 或 createRef，后续需将真实 DOM 或组件实例赋值给 ref
 */
export const Ref = /*                          */ 0b0000000000000000000001000000000;

/** 
 * 快照标志 
 * 标记当前 Fiber 节点需要在「快照阶段（BeforeMutation）执行副作用」，
 * 如 useSnapshot Hook 的回调、获取 DOM 状态快照（滚动位置、输入框值等）
 */
export const Snapshot = /*                     */ 0b0000000000000000000010000000000;

/** 
 * 被动副作用标志 
 * 标记当前 Fiber 节点有「被动副作用需要执行」，
 * 特指 useEffect、useLayoutEffect 等 Hook 注册的副作用（含挂载和卸载回调）
 */
export const Passive = /*                      */ 0b0000000000000000000100000000000;
/* 注：0b0000000000000000001000000000000 此位已被 Hydrating 占用，不可重复使用 */

/** 
 * 可见性标志 
 * 标记当前 Fiber 节点的「可见性状态发生变化」，
 * 如使用了 useInView 等监测元素可见性的 Hook，用于触发可见性相关的副作用
 */
export const Visibility = /*                   */ 0b0000000000000000010000000000000;

/** 
 * 存储一致性标志 
 * 标记当前 Fiber 节点需要「检查并保证状态存储的一致性」，
 * 如 Redux、MobX 等状态管理库与组件状态的同步校验
 */
export const StoreConsistency = /*             */ 0b0000000000000000100000000000000;

// ==================== 标志位复用（避免位资源耗尽）====================
// 说明：部分标志位在不同 Fiber 类型中是「互斥」的（如某标志仅用于 HostComponent，另一标志仅用于类组件），
// 因此可复用相同的二进制位，避免因标志位过多导致数字溢出（JavaScript 数字最大支持 64 位）
export const ScheduleRetry = StoreConsistency; // 调度重试标志：复用 StoreConsistency 的位，用于任务重试调度
export const ShouldSuspendCommit = Visibility; // 提交阶段挂起标志：复用 Visibility 的位，标记提交时需挂起
export const ViewTransitionNamedMount = ShouldSuspendCommit; // 命名视图过渡挂载标志：复用挂起标志的位，用于视图过渡
export const DidDefer = ContentReset; // 已延迟标志：复用 ContentReset 的位，标记任务已被延迟执行
export const FormReset = Snapshot; // 表单重置标志：复用 Snapshot 的位，特指表单重置操作
export const AffectedParentLayout = ContentReset; // 父布局影响标志：复用 ContentReset 的位，标记影响父节点布局

// ==================== 标志位组合（批量标识一类操作）====================
// 组合多个相关标志位，方便一次性判断某类操作是否存在，减少重复位运算

/** 
 * 生命周期副作用掩码 
 * 组合所有与「生命周期相关的副作用标志」，用于快速判断节点是否有生命周期回调需要执行
 */
export const LifecycleEffectMask =
    Passive | Update | Callback | Ref | Snapshot | StoreConsistency;

/** 
 * 宿主环境副作用掩码 
 * 组合所有与「真实 DOM 操作相关的标志」，覆盖提交阶段可能涉及的所有宿主环境操作，
 * 用于判断节点是否需要处理 DOM 相关的副作用（插入、更新、删除等）
 */
export const HostEffectMask = /*               */ 0b0000000000000000111111111111111;

// ==================== 非副作用标志（复用标志位字段存储其他状态）====================
// 说明：Fiber 节点的 flags 字段不仅存储副作用，也用于存储部分内部状态（非副作用相关）

/** 
 * 未完成标志 
 * 标记当前 Fiber 节点的工作「尚未完成」（如渲染阶段被高优先级任务中断），
 * 用于 React 任务调度机制，后续需恢复未完成的工作
 */
export const Incomplete = /*                   */ 0b0000000000000001000000000000000;

/** 
 * 应捕获标志 
 * 标记当前 Fiber 节点「需要捕获子树抛出的错误」（通常是错误边界组件的初始状态），
 * 用于错误边界的错误捕获逻辑触发
 */
export const ShouldCapture = /*                */ 0b0000000000000010000000000000000;

/** 
 * 旧版挂起强制更新标志 
 * 标记当前 Fiber 节点需要为「旧版 Suspense 机制强制更新」，
 * 用于兼容早期 Suspense 实现的过渡逻辑
 */
export const ForceUpdateForLegacySuspense = /* */ 0b0000000000000100000000000000000;

/** 
 * 已传播上下文标志 
 * 标记当前 Fiber 节点的「上下文已经传播到子树」，
 * 用于上下文机制优化，避免子树重复接收上下文
 */
export const DidPropagateContext = /*          */ 0b0000000000001000000000000000000;

/** 
 * 需要传播标志 
 * 标记当前 Fiber 节点的「上下文需要传播到子树」，
 * 用于触发上下文的向下传递逻辑
 */
export const NeedsPropagation = /*             */ 0b0000000000010000000000000000000;

/** 
 * 分叉标志 
 * 标记当前 Fiber 节点是「从主 Fiber 树分叉出来的分支节点」，
 * 用于并发渲染中的任务分支管理（如时间切片中的临时分支）
 */
export const Forked = /*                       */ 0b0000000000100000000000000000000;

// ==================== 静态标志位（持久化状态，不随渲染周期重置）====================
// 静态标志位描述 Fiber 节点的「持久化特性」（不随单次渲染周期变化），
// 用于优化卸载阶段的副作用处理（如无需遍历子树即可判断是否有被动副作用）

/** 
 * 快照静态标志 
 * 标记当前 Fiber 节点「长期存在快照相关的副作用」（即使当前渲染无更新），
 * 用于卸载时快速判断是否需要执行快照相关的清理逻辑
 */
export const SnapshotStatic = /*               */ 0b0000000001000000000000000000000;

/** 
 * 布局静态标志 
 * 标记当前 Fiber 节点「长期存在布局相关的副作用」，
 * 用于卸载时快速判断是否需要执行布局相关的清理逻辑（如移除布局事件监听）
 */
export const LayoutStatic = /*                 */ 0b0000000010000000000000000000000;

/** 
 * 引用静态标志 
 * 复用 LayoutStatic 的位，标记当前 Fiber 节点「长期使用 ref」，
 * 用于卸载时快速判断是否需要清理 ref 引用
 */
export const RefStatic = LayoutStatic;

/** 
 * 被动静态标志 
 * 标记当前 Fiber 节点「长期存在被动副作用」（如 useEffect 注册的持久化副作用），
 * 用于卸载时快速判断是否需要执行被动副作用的清理逻辑（如清除定时器）
 */
export const PassiveStatic = /*                */ 0b0000000100000000000000000000000;

/** 
 * 提交阶段可能挂起标志 
 * 标记当前 Fiber 节点「在提交阶段可能需要挂起」，
 * 用于视图过渡（View Transition）等特性，处理提交时的异步状态
 */
export const MaySuspendCommit = /*             */ 0b0000001000000000000000000000000;

/** 
 * 命名视图过渡静态标志 
 * 组合 SnapshotStatic 和 MaySuspendCommit，标记当前 Fiber 节点「包含命名视图过渡组件」，
 * 用于清理阶段快速定位需要处理的视图过渡节点
 */
export const ViewTransitionNamedStatic =
    /*    */ SnapshotStatic | MaySuspendCommit;

/** 
 * 视图过渡静态标志 
 * 标记当前 Fiber 节点「包含视图过渡组件」（从最近的 HostComponent 向下），
 * 用于视图过渡特性中快速识别过渡相关节点，且在每个 HostComponent 层级重置
 */
export const ViewTransitionStatic = /*         */ 0b0000010000000000000000000000000;

// ==================== 开发环境专用标志位（仅在 DEV 模式生效）====================
// 这些标志位仅用于开发环境的调试和校验，生产环境会被移除，避免性能开销

/** 
 * 开发环境插入标志 
 * 仅在开发环境生效，标记当前 Fiber 节点是「新插入的节点」，
 * 与生产环境的 Placement 不同：Placement 在提交后会被重置，而此标志用于 DevTools 持久化显示插入状态
 */
export const PlacementDEV = /*                 */ 0b0000100000000000000000000000000;

/** 
 * 开发环境布局挂载标志 
 * 仅在开发环境生效，标记当前 Fiber 节点「在布局阶段完成挂载」，
 * 用于开发环境的布局相关调试和警告（如避免在布局阶段执行副作用）
 */
export const MountLayoutDev = /*               */ 0b000100000000000000000000000000;
  /**
  开发环境被动副作用挂载标志
  仅在开发环境生效，标记当前 Fiber 节点「在被动副作用阶段完成挂载」，
  用于开发环境的被动副作用（如 useEffect）调试和警告（如检测副作用依赖缺失）
  /
  export const MountPassiveDev = / */ 0b0010000000000000000000000000000;
// ==================== 提交阶段标志位组合（按阶段分类）====================// 按提交阶段（BeforeMutation、Mutation、Layout）分类组合标志位，// 用于遍历 Fiber 树时快速跳过无对应阶段副作用的子树，提升性能
/**
突变前阶段掩码（BeforeMutation 阶段）
组合「突变前阶段」需要处理的所有标志位，此阶段主要执行：
快照相关操作（如获取 DOM 状态）
特定事件处理（如 createEventHandleAPI 启用时的 beforeblur 事件）
根据特性开关动态调整包含的标志位，确保仅处理必要操作
*/
export const BeforeMutationMask: number =
    Snapshot |
    (enableCreateEventHandleAPI
        ? // 启用 createEventHandleAPI 时：需处理更新、子节点删除、可见性变化（用于触发 beforeblur）
        // 注：理论上仅需在元素聚焦时处理删除操作，但为简化逻辑暂包含所有 ChildDeletion
        Update | ChildDeletion | Visibility
        : enableUseEffectEventHook
            ? // 启用 useEffectEventHook 时：需处理更新（用于副作用事件的快照阶段清理）
            Update
            : 0);
/**
突变前后视图过渡掩码
组合「视图过渡特性」在突变前 / 后阶段需要处理的标志位，
用于视图过渡时扫描子树、标记受影响节点，确保过渡效果正确执行
*/
export const BeforeAndAfterMutationTransitionMask: number =
    Snapshot | Update | Placement | ChildDeletion | Visibility | ContentReset;
/**
突变阶段掩码（Mutation 阶段）
组合「突变阶段」需要处理的所有标志位，此阶段是核心 DOM 操作阶段，执行：
节点插入（Placement）、更新（Update）、删除（ChildDeletion）
内容重置（ContentReset）、表单重置（FormReset）
ref 处理（Ref）、服务端水合（Hydrating）、可见性变化（Visibility）
此阶段直接修改真实 DOM，是提交阶段的核心
*/
export const MutationMask =
    Placement |
    Update |
    ChildDeletion |
    ContentReset |
    Ref |
    Hydrating |
    Visibility |
    FormReset;
/**
布局阶段掩码（Layout 阶段）
组合「布局阶段」需要处理的所有标志位，此阶段在 DOM 突变后执行，主要任务：
执行布局相关回调（如类组件的 componentDidMount/update）
处理 ref（将 DOM 实例赋值给 ref）
处理可见性变化（更新可见性相关状态）
此阶段可安全读取 DOM 布局信息（如宽高、位置）
*/
export const LayoutMask = Update | Callback | Ref | Visibility;
/**
被动副作用掩码（Passive 阶段）
组合「被动副作用阶段」需要处理的所有标志位，此阶段执行：
被动副作用（如 useEffect 的回调）
可见性变化回调、子节点删除相关清理
注：暂未拆分「挂载时被动副作用」和「卸载时被动副作用」，后续可能优化
*/
export const PassiveMask = Passive | Visibility | ChildDeletion;
/**
被动副作用视图过渡掩码
组合「视图过渡特性」在被动副作用阶段需要处理的标志位，
用于视图过渡完成后恢复节点状态（如还原 view-transition-name），
包含被动副作用掩码及插入、更新标志，确保覆盖所有过渡相关操作
*/
export const PassiveTransitionMask: number = PassiveMask | Update | Placement;
/**
静态标志位掩码
组合所有「静态标志位」，这些标志位的生命周期不局限于单次渲染，
用于 Fiber 节点克隆时「无需重新计算」的持久化特性（如是否包含被动副作用、视图过渡组件），
避免重复遍历子树判断特性，提升性能
*/
export const StaticMask =
    LayoutStatic |
    PassiveStatic |
    RefStatic |
    MaySuspendCommit |
    ViewTransitionStatic |
    ViewTransitionNamedStatic;