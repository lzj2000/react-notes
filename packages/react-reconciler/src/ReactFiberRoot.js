/**
 * FiberRootNode 构造函数：创建 React 应用的根节点对象（ FiberRoot ）
 * @param {any} containerInfo - 真实 DOM 容器信息（如 div#root 元素），                            React 渲染的目标容器，Fiber 树最终会映射到该容器
 * @param {*} tag - 根节点类型标记（如 LegacyRoot 传统模式、ConcurrentRoot 并发模式），              决定应用的渲染模式和特性支持
 * @param {any} hydrate - 是否启用服务端水合（hydration）模式，               用于将服务端渲染的 HTML 转换为可交互的客户端 DOM
 * @param {any} identifierPrefix - 用于生成唯一标识符的前缀（如 React DevTools 中的组件 ID），
 *                                避免多 React 应用共存时的 ID 冲突
 * @param {any} onUncaughtError - 未捕获错误的回调函数，用于处理渲染过程中未被捕获的异常
 * @param {any} onCaughtError - 已捕获错误的回调函数，用于处理被错误边界捕获的异常
 * @param {any} onRecoverableError - 可恢复错误的回调函数，用于处理可重试的错误（如 Suspense 重试）
 * @param {ReactFormState<any, any> | null} formState - 根节点关联的表单状态，
 *                                                    用于管理跨组件的表单数据（实验性特性）
 */
function FiberRootNode(
    this: $FlowFixMe,
    containerInfo: any,
    tag,
    hydrate: any,
    identifierPrefix: any,
    onUncaughtError: any,
    onCaughtError: any,
    onRecoverableError: any,
    formState: ReactFormState<any, any> | null,
) {
    // 根节点类型标记：若禁用传统模式，强制使用并发模式根节点；否则使用传入的 tag
    // 决定应用是否支持并发渲染、时间切片等现代特性
    this.tag = disableLegacyMode ? ConcurrentRoot : tag;

    // 存储真实 DOM 容器信息（如挂载 React 应用的 div 元素）
    this.containerInfo = containerInfo;

    // 待处理的子节点：用于批量更新根节点的子元素（如 ReactDOM.render 传入的新元素）
    this.pendingChildren = null;

    // 当前激活的 Fiber 树（current 树）：与真实 DOM 同步的 Fiber 树，
    // 每次渲染会生成 workInProgress 树，完成后与 current 树替换
    this.current = null;

    // 用于存储 Suspense 组件的 ping 缓存：记录需要重试的 Suspense 边界，
    // 当异步资源就绪后，通过 ping 机制触发重新渲染
    this.pingCache = null;

    // 超时句柄：用于调度过期任务的计时器 ID（如 setTimeout 返回值），
    // 当任务超时未完成时，触发优先级提升
    this.timeoutHandle = noTimeout;

    // 取消待提交的任务：用于中断正在准备提交的渲染任务（如高优任务插入时）
    this.cancelPendingCommit = null;

    // 当前激活的上下文：存储根节点级别的上下文信息，供子组件消费
    this.context = null;

    // 待应用的上下文：新的上下文变更，将在下一次渲染时生效
    this.pendingContext = null;

    // 链表中的下一个根节点：用于管理多个 React 根应用（如同一页面有多个独立的 React 实例）
    this.next = null;

    // 回调节点：与当前根节点关联的调度回调（如 requestIdleCallback 返回的 ID），
    // 用于追踪和取消待执行的回调
    this.callbackNode = null;

    // 回调优先级：当前调度回调的优先级车道（Lane），决定回调执行的先后顺序
    this.callbackPriority = NoLane;

    // 过期时间映射表：为每个车道（Lane）存储对应的过期时间戳，
    // 用于判断任务是否超时（超过该时间需强制执行）
    this.expirationTimes = createLaneMap(NoTimestamp);

    // 待处理的车道集：标记需要在下一次渲染中处理的优先级车道（如用户交互、数据更新等）
    this.pendingLanes = NoLanes;

    // 挂起的车道集：因 Suspense 挂起而未完成的车道，需等待异步资源就绪后重新调度
    this.suspendedLanes = NoLanes;

    // 已 Ping 的车道集：记录已触发重试的挂起车道（如 Suspense 资源就绪后标记为可重试）
    this.pingedLanes = NoLanes;

    // 预热的车道集：标记已部分处理的低优先级车道，用于优化后续渲染（避免重复计算）
    this.warmLanes = NoLanes;

    // 已过期的车道集：超过过期时间的车道，需立即执行（即使有高优任务也不中断）
    this.expiredLanes = NoLanes;

    // 禁用错误恢复的车道集：标记不允许错误恢复的车道（如关键任务出错后直接崩溃而非重试）
    this.errorRecoveryDisabledLanes = NoLanes;

    // Shell 挂起计数器：用于追踪 Shell 组件（顶层框架组件）的挂起状态，
    // 控制根节点级别的 Suspense 行为
    this.shellSuspendCounter = 0;

    // 纠缠的车道集：与其他车道存在依赖关系的车道（如一个更新依赖另一个更新的结果）
    this.entangledLanes = NoLanes;

    // 纠缠关系映射表：记录每个车道与哪些车道存在纠缠关系，用于优先级调度时的依赖处理
    this.entanglements = createLaneMap(NoLanes);

    // 隐藏更新映射表：存储被暂时隐藏的更新（如被 Suspense 中断的更新），
    // 待条件满足后重新应用
    this.hiddenUpdates = createLaneMap(null);

    // 标识符前缀：用于生成组件唯一 ID（如在 DevTools 或服务端渲染中避免冲突）
    this.identifierPrefix = identifierPrefix;

    // 未捕获错误回调：处理未被错误边界捕获的全局异常
    this.onUncaughtError = onUncaughtError;

    // 已捕获错误回调：处理被错误边界捕获的异常（可用于日志上报）
    this.onCaughtError = onCaughtError;

    // 可恢复错误回调：处理可重试的错误（如网络波动导致的 Suspense 挂起）
    this.onRecoverableError = onRecoverableError;

    // 池化缓存：共享的缓存池（如 React Server Components 的缓存），
    // 用于复用跨渲染的计算结果
    this.pooledCache = null;

    // 池化缓存对应的车道集：标记哪些车道的更新可以使用池化缓存
    this.pooledCacheLanes = NoLanes;

    // 若启用 Suspense 回调特性：存储水合过程中的回调函数（如 Suspense 内容加载完成后的通知）
    if (enableSuspenseCallback) {
        this.hydrationCallbacks = null;
    }

    // 根节点关联的表单状态：管理跨组件的表单数据（实验性特性，用于统一表单状态管理）
    this.formState = formState;

    // 若启用滑动过渡特性：管理与滑动手势相关的状态
    if (enableSwipeTransition) {
        this.pendingGestures = null;       // 待处理的滑动手势
        this.stoppingGestures = null;      // 正在停止的滑动手势
        this.gestureClone = null;          // 手势操作对应的 Fiber 树克隆
    }

    // 未完成的过渡：存储正在进行中的过渡（transition）任务，
    // 用于跟踪和管理过渡的生命周期（如中断未完成的过渡）
    this.incompleteTransitions = new Map();

}

/**
 * 创建 Fiber 根节点（FiberRoot）的工厂函数
 * 
 * @param {Container} containerInfo - 宿主环境的容器信息（如 DOM 元素），
 * @param {RootTag} tag - 根节点类型标记（如 LegacyRoot 传统模式、ConcurrentRoot 并发模式），
 * @param {boolean} hydrate - 是否启用服务端水合（hydration）模式，
 * @param {ReactNodeList} initialChildren - 初始渲染的子节点（如 ReactDOM.render 传入的根组件）
 * @param {null | SuspenseHydrationCallbacks} hydrationCallbacks - 水合过程中的回调函数集合，
 * @param {boolean} isStrictMode - 是否启用严格模式（Strict Mode），
 * @param {string} identifierPrefix - 用于生成唯一标识符的前缀，
 * @param {(error: mixed, errorInfo: {+componentStack?: ?string}) => void} onUncaughtError - 
 * @param {(error: mixed, errorInfo: {+componentStack?: ?string, +errorBoundary?: ?React$Component<any, any>}) => void} onCaughtError - 
 * @param {(error: mixed, errorInfo: {+componentStack?: ?string}) => void} onRecoverableError - 
 * @param {null | TransitionTracingCallbacks} transitionCallbacks - 过渡（transition）追踪回调，
 * @param {ReactFormState<any, any> | null} formState - 根节点关联的表单状态，
 * @returns {FiberRoot} - 创建完成的 Fiber 根节点，作为整个应用的顶层容器
 */
export function createFiberRoot(
    containerInfo: Container,
    tag: RootTag,
    hydrate: boolean,
    initialChildren: ReactNodeList,
    hydrationCallbacks: null | SuspenseHydrationCallbacks,
    isStrictMode: boolean,
    identifierPrefix: string,
    onUncaughtError: (
        error: mixed,
        errorInfo: {+componentStack ?: ? string},
    ) => void,
    onCaughtError: (
        error: mixed,
        errorInfo: {
        +componentStack ?: ? string,
    +errorBoundary ?: ? React$Component < any, any >,
      },
    ) => void,
    onRecoverableError: (
        error: mixed,
        errorInfo: {+componentStack ?: ? string},
    ) => void,
    transitionCallbacks: null | TransitionTracingCallbacks,
        formState: ReactFormState < any, any > | null,
  ): FiberRoot {
    // 创建 FiberRootNode 实例（根节点容器），并传入初始化参数
    // $FlowFixMe 用于兼容 Flow 类型检查（忽略函数调用 new 的类型限制）
    const root: FiberRoot = (new FiberRootNode(
        containerInfo,
        tag,
        hydrate,
        identifierPrefix,
        onUncaughtError,
        onCaughtError,
        onRecoverableError,
        formState,
    ): any);

    // 若启用 Suspense 回调特性，设置水合过程中的回调函数
    if (enableSuspenseCallback) {
        root.hydrationCallbacks = hydrationCallbacks;
    }

    // 若启用过渡追踪特性，设置过渡相关的回调函数
    if (enableTransitionTracing) {
        root.transitionCallbacks = transitionCallbacks;
    }

    // 创建根 Fiber 节点（HostRootFiber），作为 Fiber 树的顶层节点
    // 参数 tag 决定根 Fiber 的特性（如是否支持并发渲染），isStrictMode 启用严格模式检查
    const uninitializedFiber = createHostRootFiber(tag, isStrictMode);

    // 建立 FiberRoot 与根 Fiber 的双向关联：
    // 1. 根节点的 current 指向当前激活的 Fiber 树（初始为刚创建的根 Fiber）
    root.current = uninitializedFiber;
    // 2. 根 Fiber 的 stateNode 指向 FiberRoot（形成循环引用，便于相互访问）
    uninitializedFiber.stateNode = root;

    // 创建初始缓存实例并保留（retain），用于缓存跨渲染的计算结果（如 React Server Components）
    const initialCache = createCache();
    retainCache(initialCache);

    // 初始化池化缓存（pooledCache）：
    // 用于临时存储渲染过程中新挂载组件的缓存数据，渲染结束后要么释放，要么转移到 Offscreen 组件
    // 需单独保留（retain），与主缓存（memoizedState.cache）的生命周期区分开
    root.pooledCache = initialCache;
    retainCache(initialCache);

    // 根 Fiber 的初始状态：包含初始渲染的元素、水合标记和缓存实例
    const initialState: RootState = {
        element: initialChildren,       // 初始渲染的子节点（如根组件）
        isDehydrated: hydrate,         // 是否处于脱水状态（服务端渲染后未水合的状态）
        cache: initialCache,           // 关联的缓存实例
    };
    // 将初始状态存储到根 Fiber 的 memoizedState 中（Fiber 节点的状态存储区）
    uninitializedFiber.memoizedState = initialState;

    // 初始化根 Fiber 的更新队列（UpdateQueue），用于接收和处理状态更新
    initializeUpdateQueue(uninitializedFiber);

    // 返回创建完成的 Fiber 根节点，此时应用已具备初始渲染的基础结构
    return root;
}