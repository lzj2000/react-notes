import { enqueueUpdate } from "./ReactFiberClassUpdateQueue"
import { scheduleUpdateOnFiber } from "./ReactFiberWorkLoop"

/**
 * 创建 React 容器（OpaqueRoot）的函数，是 React 应用挂载的入口之一
 * 内部通过调用 createFiberRoot 创建 Fiber 根节点，初始化应用的基础环境
 * 
 * @param {Container} containerInfo - 宿主环境的容器信息（如 DOM 元素），应用将挂载到该容器
 * @param {RootTag} tag - 根节点类型标记（如 LegacyRoot 或 ConcurrentRoot），决定渲染模式
 * @param {null | SuspenseHydrationCallbacks} hydrationCallbacks - 水合过程的回调函数集合
 * @param {boolean} isStrictMode - 是否启用严格模式，启用后会进行额外的检查和警告
 * @param {null | boolean} concurrentUpdatesByDefaultOverride - 已废弃参数，用于兼容旧版本，当前忽略
 * @param {string} identifierPrefix - 生成唯一标识符的前缀，避免多应用 ID 冲突
 * @param {(error: mixed, errorInfo: {+componentStack?: ?string}) => void} onUncaughtError - 未捕获错误的回调
 * @param {(error: mixed, errorInfo: {+componentStack?: ?string, +errorBoundary?: ?React$Component<any, any>}) => void} onCaughtError - 已捕获错误的回调
 * @param {(error: mixed, errorInfo: {+componentStack?: ?string}) => void} onRecoverableError - 可恢复错误的回调
 * @param {null | TransitionTracingCallbacks} transitionCallbacks - 过渡追踪相关的回调函数
 * @returns {OpaqueRoot} - 创建的不透明根容器（对外隐藏内部实现细节）
 */
export function createContainer(
    containerInfo: Container,
    tag: RootTag,
    hydrationCallbacks: null | SuspenseHydrationCallbacks,
    isStrictMode: boolean,
    concurrentUpdatesByDefaultOverride: null | boolean,
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
): OpaqueRoot {
    const hydrate = false; // 标记为非水合模式（客户端全新渲染，非服务端渲染后激活）
    const initialChildren = null; // 初始子节点为空，后续通过 updateContainer 设置

    // 调用 createFiberRoot 创建 Fiber 根节点并返回
    return createFiberRoot(
        containerInfo,
        tag,
        hydrate,
        initialChildren,
        hydrationCallbacks,
        isStrictMode,
        identifierPrefix,
        onUncaughtError,
        onCaughtError,
        onRecoverableError,
        transitionCallbacks,
        null,
    );
}

/**
 * 更新容器内容的函数，是触发 React 应用重新渲染的核心入口
 * 用于将新的 React 元素（如根组件）更新到容器中，返回此次更新的优先级车道
 * 
 * @param {ReactNodeList} element - 要渲染到容器中的 React 元素（如 <App />）
 * @param {OpaqueRoot} container - 目标容器（由 createContainer 创建的根容器）
 * @param {?React$Component<any, any>} parentComponent - 父组件（通常为 null，用于特殊场景）
 * @param {?Function} callback - 更新完成后的回调函数（在 commit 阶段执行）
 * @returns {Lane} - 此次更新的优先级车道（Lane），用于调度优先级管理
 */
export function updateContainer(
    element: ReactNodeList,
    container: OpaqueRoot,
    parentComponent: ?React$Component<any, any>,
    callback: ?Function,
): Lane {
    const current = container.current; // 获取容器当前激活的根 Fiber 节点
    const lane = requestUpdateLane(current); // 为此次更新请求一个优先级车道（根据更新类型分配）

    // 调用内部实现函数执行实际的更新逻辑
    updateContainerImpl(
        current,
        lane,
        element,
        container,
        parentComponent,
        callback,
    );

    return lane; // 返回此次更新的优先级车道
}

/**
 * updateContainer 的内部实现函数，负责创建更新对象、入队更新并调度渲染
 * 
 * @param {Fiber} rootFiber - 根 Fiber 节点
 * @param {Lane} lane - 此次更新的优先级车道
 * @param {ReactNodeList} element - 要渲染的 React 元素
 * @param {OpaqueRoot} container - 目标容器
 * @param {?React$Component<any, any>} parentComponent - 父组件
 * @param {?Function} callback - 更新完成后的回调函数
 */
function updateContainerImpl(
    rootFiber: Fiber,
    lane: Lane,
    element: ReactNodeList,
    container: OpaqueRoot,
    parentComponent: ?React$Component<any, any>,
    callback: ?Function,
): void {
    // 若启用调度分析器，标记此次渲染已调度（用于性能分析）
    if (enableSchedulingProfiler) {
        markRenderScheduled(lane);
    }

    // 获取子树的上下文环境（从父组件继承或使用默认上下文）
    const context = getContextForSubtree(parentComponent);
    // 更新容器的上下文：若容器无当前上下文，则直接设置；否则暂存为待更新上下文
    if (container.context === null) {
        container.context = context;
    } else {
        container.pendingContext = context;
    }

    // 创建一个更新对象（Update），并关联此次更新的优先级车道
    const update = createUpdate(lane);
    // 更新对象的 payload 存储要渲染的元素（React DevTools 依赖该属性名为 "element"）
    update.payload = { element };

    // 处理回调函数：未定义则设为 null，避免后续判断问题
    callback = callback === undefined ? null : callback;
    if (callback !== null) {
        update.callback = callback; // 将回调函数关联到更新对象（更新完成后执行）
    }

    // 将更新对象入队到根 Fiber 的更新队列，并返回根节点
    const root = enqueueUpdate(rootFiber, update, lane);
    if (root !== null) {
        // 为此次更新的车道启动计时器（用于监控更新耗时，判断是否过期）
        startUpdateTimerByLane(lane);
        // 调度 Fiber 上的更新（进入渲染调度流程）
        scheduleUpdateOnFiber(root, rootFiber, lane);
        // 处理与此次更新相关的过渡（transition）纠缠关系（管理过渡优先级依赖）
        entangleTransitions(root, rootFiber, lane);
    }
}