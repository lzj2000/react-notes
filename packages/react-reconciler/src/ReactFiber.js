import { NoFlags } from './ReactFiberFlags';

/** Fiber 节点类，用于构建 Fiber 树 */
function FiberNode(
    this: $FlowFixMe,        // Flow 类型检查忽略
    tag: WorkTag,            // 工作标签，标识节点类型
    pendingProps: mixed,     // 待处理的属性
    key: null | string,      // 唯一标识符
    mode: TypeOfMode,        // 渲染模式
) {
    // 实例属性
    this.tag = tag;              // 节点类型标签（如 FunctionComponent, ClassComponent, HostComponent）
    this.key = key;              // 用于 diff 算法的唯一键
    this.elementType = null;     // 元素的类型（原始类型）
    this.type = null;            // 元素的类型（可能是包装后的类型）
    this.stateNode = null;       // 对应的真实 DOM 节点或组件实例

    // Fiber 树结构属性
    this.return = null;          // 父节点
    this.child = null;           // 第一个子节点
    this.sibling = null;         // 下一个兄弟节点
    this.index = 0;              // 在父节点中的索引

    // 引用属性
    this.ref = null;             // React ref
    this.refCleanup = null;      // ref 清理函数

    // 属性和状态管理
    this.pendingProps = pendingProps;    // 待处理的属性
    this.memoizedProps = null;           // 已处理的属性
    this.updateQueue = null;             // 更新队列
    this.memoizedState = null;           // 已处理的状态
    this.dependencies = null;            // 依赖项

    // 渲染模式
    this.mode = mode;            // 渲染模式（并发模式、 严格模式、 阻塞模式）

    // 副作用标记
    this.flags = NoFlags;        // 当前节点的副作用标记
    this.subtreeFlags = NoFlags; // 子树的副作用标记
    this.deletions = null;       // 待删除的子节点列表

    // 优先级和调度
    this.lanes = NoLanes;        // 当前节点的优先级车道
    this.childLanes = NoLanes;   // 子节点的优先级车道

    // 双缓存机制
    this.alternate = null;       // 对应的 alternate fiber

    // 性能分析（可选）
    if (enableProfilerTimer) {
        this.actualDuration = -0;        // 实际渲染时间
        this.actualStartTime = -1.1;     // 实际开始时间
        this.selfBaseDuration = -0;      // 自身基础渲染时间
        this.treeBaseDuration = -0;      // 子树基础渲染时间
    }
}

/**
 * 创建「工作中 Fiber 节点」（workInProgress）的核心函数
 * 
 * @param {Fiber} current - 当前 Fiber 节点（来自 current 树，与 DOM 同步）
 * @param {any} pendingProps - 当前更新的待应用属性（如组件新接收的 props）
 * @returns {Fiber} - 生成的 workInProgress 节点，用于后续渲染阶段的 Diff 和副作用处理
 */
export function createWorkInProgress(current: Fiber, pendingProps: any): Fiber {
    // 第一步：尝试复用 current 节点的 alternate 作为 workInProgress（双缓冲复用）
    // alternate 是 Fiber 节点的双向指针，current.alternate 指向上次的 workInProgress，反之亦然
    let workInProgress = current.alternate;

    // 分支1：若 alternate 不存在（首次更新或节点未被复用），新建 workInProgress 节点
    if (workInProgress === null) {
        // 注释说明：双缓冲池技术的核心逻辑——因 React 仅需维护两棵树（当前/工作），
        // 复用未使用的节点避免重复创建，减少内存开销，且支持内存回收
        // We use a double buffering pooling technique because we know that we'll
        // only ever need at most two versions of a tree. We pool the "other" unused
        // node that we're free to reuse. This is lazily created to avoid allocating
        // extra objects for things that are never updated. It also allow us to
        // reclaim the extra memory if needed.

        // 调用 createFiber 新建 Fiber 节点，继承 current 的核心标识（类型、key、模式等）
        workInProgress = createFiber(
            current.tag,        // 节点类型（如 FunctionComponent、HostComponent）
            pendingProps,       // 当前待应用的 props
            current.key,        // 节点唯一 key（用于 Diff 算法识别）
            current.mode,       // 节点模式（如 ConcurrentMode、StrictMode）
        );

        // 继承 current 节点的静态属性（不随更新变化的属性）
        workInProgress.elementType = current.elementType; // 元素类型（如组件构造函数/函数）
        workInProgress.type = current.type;               // 节点类型（与 tag 配合，区分具体组件类型）
        workInProgress.stateNode = current.stateNode;     // 关联的真实节点（如 DOM 元素、组件实例）

        // 开发环境：继承调试相关属性，用于 DevTools 追踪组件来源、调用栈等
        if (__DEV__) {
            workInProgress._debugOwner = current._debugOwner;       // 调试用：组件的父级所有者
            workInProgress._debugStack = current._debugStack;       // 调试用：组件创建时的调用栈
            workInProgress._debugTask = current._debugTask;         // 调试用：关联的调度任务
            workInProgress._debugHookTypes = current._debugHookTypes; // 调试用：组件使用的 Hook 类型
        }

        // 建立 current 与 workInProgress 的双向 alternate 关联（双缓冲指针）
        workInProgress.alternate = current;
        current.alternate = workInProgress;
    }
    // 分支2：若 alternate 已存在（非首次更新，可复用），重置并更新属性
    else {
        // 更新待应用的 props（此次更新的新 props）
        workInProgress.pendingProps = pendingProps;
        // 重置节点类型（因 Blocks 类型节点会在 type 上存储数据，需同步 current 的最新类型）
        // Needed because Blocks store data on type.
        workInProgress.type = current.type;

        // 重置副作用相关状态（上次更新的副作用已处理，此次更新需重新计算）
        workInProgress.flags = NoFlags;                  // 重置副作用标志位（无任何副作用）
        workInProgress.subtreeFlags = NoFlags;           // 重置子树副作用标志位（子树无副作用）
        workInProgress.deletions = null;                 // 重置子树删除列表（无待删除子节点）

        // 若启用性能分析计时器，重置实际执行时长相关属性
        // 避免不同更新的时长累加，确保每次更新的时长统计准确（支持中断后恢复）
        if (enableProfilerTimer) {
            // We intentionally reset, rather than copy, actualDuration & actualStartTime.
            // This prevents time from endlessly accumulating in new commits.
            // This has the downside of resetting values for different priority renders,
            // But works for yielding (the common case) and should support resuming.
            workInProgress.actualDuration = -0;  // 重置节点自身的实际执行时长
            workInProgress.actualStartTime = -1.1;// 重置节点开始执行的时间戳
        }
    }

    // 第二步：同步 current 节点的核心状态（复用未变化的属性，减少计算）
    // 1. 保留静态标志位（StaticMask 包含的标志位，如是否依赖被动副作用，不随单次更新变化）
    workInProgress.flags = current.flags & StaticMask;
    // 2. 同步子节点车道（子树待处理的优先级车道，未处理完的优先级需继承）
    workInProgress.childLanes = current.childLanes;
    // 3. 同步当前节点车道（当前节点待处理的优先级车道）
    workInProgress.lanes = current.lanes;

    // 4. 同步子节点、 memoized 属性与状态（复用上次渲染的结果，Diff 时对比 pendingProps）
    workInProgress.child = current.child;                 // 子 Fiber 节点（初始复用，Diff 时可能更新）
    workInProgress.memoizedProps = current.memoizedProps; // 上次渲染的 props（用于对比是否需要更新）
    workInProgress.memoizedState = current.memoizedState; // 上次渲染的状态（如组件 state、Hook 状态）
    workInProgress.updateQueue = current.updateQueue;     // 更新队列（如 setState 队列，需继承未处理的更新）

    // 5. 克隆依赖对象（dependencies 记录节点依赖的车道和上下文，渲染阶段会修改，不能共享）
    const currentDependencies = current.dependencies;
    workInProgress.dependencies =
        currentDependencies === null
            ? null // 无依赖时直接设为 null
            : __DEV__
                // 开发环境：克隆依赖对象，包含调试用的 thenable 状态
                ? {
                    lanes: currentDependencies.lanes,               // 依赖的优先级车道
                    firstContext: currentDependencies.firstContext, // 依赖的首个上下文
                    _debugThenableState: currentDependencies._debugThenableState, // 调试用：thenable 状态（如 Suspense 依赖）
                }
                // 生产环境：仅克隆核心依赖字段，减少开销
                : {
                    lanes: currentDependencies.lanes,
                    firstContext: currentDependencies.firstContext,
                };

    // 6. 同步兄弟节点、索引、ref 等属性（父节点 reconciliation 阶段可能覆盖这些值）
    // These will be overridden during the parent's reconciliation
    workInProgress.sibling = current.sibling;           // 兄弟 Fiber 节点（父节点 Diff 时可能调整顺序）
    workInProgress.index = current.index;               // 在父节点子列表中的索引
    workInProgress.ref = current.ref;                   // 节点的 ref（如 useRef 关联的引用）
    workInProgress.refCleanup = current.refCleanup;     // ref 卸载时的清理函数


    // 返回构建完成的 workInProgress 节点，用于后续的 beginWork（Diff）和 completeWork（副作用处理）
    return workInProgress;
}