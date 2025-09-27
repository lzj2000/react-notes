// 描述当前 React 执行栈的状态
// ExecutionContext 是一个位掩码类型，用于标记当前 React 所处的执行阶段（如：是否在批量更新中、是否在合成事件处理中、是否在渲染阶段等）

import { enableThrottledScheduling } from "../../shared/ReactFeatureFlags";

// 初始值为 NoContext，表示当前没有处于特殊的执行上下文
let executionContext: ExecutionContext = NoContext;

// 当前正在处理的 Fiber 根节点
let workInProgressRoot: FiberRoot | null = null;

// 当前正在处理的 Fiber 节点
let workInProgress: Fiber | null = null;

// 当前渲染任务对应的车道集
let workInProgressRootRenderLanes: Lanes = NoLanes;

const shouldTimeSlice =
    // 没有强制同步渲染
    (!forceSync &&
        // 当前渲染车道不包含阻塞车道
        !includesBlockingLane(lanes) &&
        // 当前渲染车道不包含过期车道
        !includesExpiredLane(root, lanes)) ||
    // 启用了兄弟预渲染且当前根节点正在预渲染
    (enableSiblingPrerendering && checkIfRootIsPrerendering(root, lanes));

let exitStatus = shouldTimeSlice
    ? renderRootConcurrent(root, lanes)  // 并发渲染（时间切片）
    : renderRootSync(root, lanes, true); // 同步渲染


/**  React 并发渲染的核心调度系统，负责协调和管理整个渲染过程 */
function renderRootConcurrent(root: FiberRoot, lanes: Lanes) {
    // 初始化和上下文设置
    // 当前执行上下文，标识 React 当前处于哪个阶段（无上下文、批处理上下文、渲染上下文...）
    const prevExecutionContext = executionContext;
    executionContext |= RenderContext;
    const prevDispatcher = pushDispatcher(root.containerInfo);
    const prevAsyncDispatcher = pushAsyncDispatcher();

    // 工作栈准备
    // 检查是否需要准备新的工作栈
    // workInProgressRoot是当前正在工作的根节点，标识当前是否有渲染任务在进行
    // workInProgressRootRenderLanes是当前工作根节点的渲染车道
    if (workInProgressRoot !== root || workInProgressRootRenderLanes !== lanes) {
        // 开发工具相关处理
        if (enableUpdaterTracking) {
            if (isDevToolsPresent) {
                const memoizedUpdaters = root.memoizedUpdaters;
                if (memoizedUpdaters.size > 0) {
                    restorePendingUpdaters(root, workInProgressRootRenderLanes);
                    memoizedUpdaters.clear();
                }
                movePendingFibersToMemoized(root, lanes);
            }
        }

        // 获取过渡状态
        workInProgressTransitions = getTransitionsForLanes(root, lanes);

        // 重置渲染计时器
        resetRenderTimer();
        // 准备新的工作栈
        prepareFreshStack(root, lanes);
    } else {
        // 检查是否正在预渲染
        workInProgressRootIsPrerendering = checkIfRootIsPrerendering(root, lanes);
    }

    // 性能分析标记
    if (enableSchedulingProfiler) {
        markRenderStarted(lanes);
    }

    // 主工作循环
    outer: do {
        try {
            // 处理挂起状态
            // workInProgressSuspendedReason是当前工作被挂起的原因（NotSuspended未挂起、SuspendedOnError因错误挂起...）
            // workInProgress当前正在处理的工作单元（Fiber 节点）
            // 挂起指React 为了等待异步资源（数据），暂时中断该节点的渲染，并通过 Suspense 提供友好的占位内容
            if (
                workInProgressSuspendedReason !== NotSuspended &&
                workInProgress !== null
            ) {
                const unitOfWork = workInProgress;
                // 当前工作抛出的值（通常是 Promise 或错误）
                const thrownValue = workInProgressThrownValue;
                // React 支持多种挂起状态，每种都有不同的处理逻辑：
                resumeOrUnwind: switch (workInProgressSuspendedReason) {
                    // 误挂起
                    case SuspendedOnError: {
                        workInProgressSuspendedReason = NotSuspended;
                        workInProgressThrownValue = null;
                        throwAndUnwindWorkLoop(
                            root,
                            unitOfWork,
                            thrownValue,
                            SuspendedOnError,
                        );
                        break;
                    }
                    // 数据挂起
                    case SuspendedOnData:
                    case SuspendedOnAction: {
                        const thenable: Thenable<mixed> = (thrownValue: any);
                        if (isThenableResolved(thenable)) {
                            workInProgressSuspendedReason = NotSuspended;
                            workInProgressThrownValue = null;
                            replaySuspendedUnitOfWork(unitOfWork);
                            break;
                        }
                        const onResolution = () => {
                            if (
                                (workInProgressSuspendedReason === SuspendedOnData ||
                                    workInProgressSuspendedReason === SuspendedOnAction) &&
                                workInProgressRoot === root
                            ) {
                                workInProgressSuspendedReason = SuspendedAndReadyToContinue;
                            }
                            ensureRootIsScheduled(root);
                        };
                        thenable.then(onResolution, onResolution);
                        break outer;
                    }
                    // 立即挂起
                    case SuspendedOnImmediate: {
                        workInProgressSuspendedReason = SuspendedAndReadyToContinue;
                        break outer;
                    }
                    // 实例挂起
                    case SuspendedOnInstance: {
                        workInProgressSuspendedReason =
                            SuspendedOnInstanceAndReadyToContinue;
                        break outer;
                    }
                    // 准备继续状态
                    case SuspendedAndReadyToContinue: {
                        const thenable: Thenable<mixed> = (thrownValue: any);
                        if (isThenableResolved(thenable)) {
                            workInProgressSuspendedReason = NotSuspended;
                            workInProgressThrownValue = null;
                            replaySuspendedUnitOfWork(unitOfWork);
                        } else {
                            workInProgressSuspendedReason = NotSuspended;
                            workInProgressThrownValue = null;
                            throwAndUnwindWorkLoop(
                                root,
                                unitOfWork,
                                thrownValue,
                                SuspendedAndReadyToContinue,
                            );
                        }
                        break;
                    }
                    case SuspendedOnInstanceAndReadyToContinue: {
                        let resource: null | Resource = null;
                        switch (workInProgress.tag) {
                            case HostHoistable: {
                                resource = workInProgress.memoizedState;
                            }
                            case HostComponent:
                            case HostSingleton: {
                                const hostFiber = workInProgress;
                                const type = hostFiber.type;
                                const props = hostFiber.pendingProps;
                                const isReady = resource
                                    ? preloadResource(resource)
                                    : preloadInstance(type, props);
                                if (isReady) {
                                    workInProgressSuspendedReason = NotSuspended;
                                    workInProgressThrownValue = null;
                                    const sibling = hostFiber.sibling;
                                    if (sibling !== null) {
                                        workInProgress = sibling;
                                    } else {
                                        const returnFiber = hostFiber.return;
                                        if (returnFiber !== null) {
                                            workInProgress = returnFiber;
                                            completeUnitOfWork(returnFiber);
                                        } else {
                                            workInProgress = null;
                                        }
                                    }
                                    break resumeOrUnwind;
                                }
                                break;
                            }
                            default: {
                                break;
                            }
                        }
                        workInProgressSuspendedReason = NotSuspended;
                        workInProgressThrownValue = null;
                        throwAndUnwindWorkLoop(
                            root,
                            unitOfWork,
                            thrownValue,
                            SuspendedOnInstanceAndReadyToContinue,
                        );
                        break;
                    }
                    case SuspendedOnDeprecatedThrowPromise: {
                        workInProgressSuspendedReason = NotSuspended;
                        workInProgressThrownValue = null;
                        throwAndUnwindWorkLoop(
                            root,
                            unitOfWork,
                            thrownValue,
                            SuspendedOnDeprecatedThrowPromise,
                        );
                        break;
                    }
                    case SuspendedOnHydration: {
                        resetWorkInProgressStack();
                        workInProgressRootExitStatus = RootSuspendedAtTheShell;
                        break outer;
                    }
                    default: {
                        throw new Error(
                            'Unexpected SuspendedReason. This is a bug in React.',
                        );
                    }
                }
            }

            // 工作循环执行
            if (enableThrottledScheduling) {
                // 节流调度：基于时间片的调度
                workLoopConcurrent(includesNonIdleWork(lanes));
            } else {
                // 调度器调度：基于调度器的调度
                workLoopConcurrentByScheduler();
            }
            break;
        } catch (thrownValue) {
            handleThrow(root, thrownValue);
        }
    } while (true);
    // 1. 重置上下文依赖
    // React 在渲染过程中会追踪组件依赖的上下文（如 createContext 提供的上下文），若当前任务中断，需要清空本次追踪的依赖记录，避免下次渲染时误用本次的依赖信息
    resetContextDependencies();
    // 2. 恢复之前的调度器（dispatcher）
    // dispatcher 是 React 内部的「方法分发器」，控制 setState、useState 等 API 的具体实现
    popDispatcher(prevDispatcher);
    popAsyncDispatcher(prevAsyncDispatcher);
    // 3. 恢复之前的执行上下文
    executionContext = prevExecutionContext;

    // workInProgress 是「当前正在处理的 Fiber 节点」—— 若它不为 null，说明渲染任务未完成
    if (workInProgress !== null) {
        // 若启用调度分析器，标记“渲染已暂停（yielded）”,用于开发环境分析性能
        if (enableSchedulingProfiler) {
            markRenderYielded();
        }
        // 返回“根节点处理中”状态，告知调度器：任务未完成，需后续继续
        return RootInProgress; // 工作未完成
    } else
    // 当渲染任务全部完成（所有 Fiber 节点处理完毕），执行 “状态清理与任务收尾” 逻辑：
    {
        // 若启用调度分析器，标记“渲染已停止（完成）”
        if (enableSchedulingProfiler) {
            markRenderStopped();
        }

        // 清理根节点相关的临时状态（避免下次任务误用）
        workInProgressRoot = null;
        workInProgressRootRenderLanes = NoLanes;

        // 完成并发更新的队列处理（确保所有更新都已入队）
        finishQueueingConcurrentUpdates();

        // 返回任务最终的退出状态（如“成功”“出错”“挂起”）
        return workInProgressRootExitStatus;
    }
}

/** 基于时间片的工作循环 */
// nonIdle：布尔值参数，标记当前任务是否为「非空闲任务」（即需要优先处理的较高优先级任务）。
function workLoopConcurrent(nonIdle: boolean) {
    // 若为 null，表示没有待处理的任务，直接退出循环；若不为 null，则开始处理任务。
    if (workInProgress !== null) {
        // 计算超时时间点 yieldAfter（当前时间 + 最大执行时长）
        // 若 nonIdle = true（非空闲任务，如用户交互触发的更新）：超时时间 = 当前时间 + 25ms。
        // 若 nonIdle = false（空闲任务，如低优先级的列表渲染）：超时时间 = 当前时间 + 5ms。
        const yieldAfter = now() + (nonIdle ? 25 : 5);

        // 循环处理任务单元，直到任务完成或超时
        do {
            performUnitOfWork(workInProgress); // 处理当前Fiber节点
        } while (workInProgress !== null && now() < yieldAfter);
        // 检查当前时间是否超过预设的超时时间点。若未超时，继续处理下一个节点；若超时，立即终止循环，暂停渲染任务。
    }
}
/** 于调度器的工作循环 */
function workLoopConcurrentByScheduler() {
    // 判断是否还有待处理的 Fiber 节点
    // shouldYield() 是调度器提供的函数，返回 true 表示「需要暂停渲染，让出主线程」；!shouldYield() 则表示「可以继续执行渲染任务」
    while (workInProgress !== null && !shouldYield()) {
        performUnitOfWork(workInProgress);
    }
}
/** 工作单元执行 */
function performUnitOfWork(unitOfWork: Fiber): void {
    const current = unitOfWork.alternate;

    let next;
    if (enableProfilerTimer && (unitOfWork.mode & ProfileMode) !== NoMode) {
        startProfilerTimer(unitOfWork);

        next = beginWork(current, unitOfWork, entangledRenderLanes);

        stopProfilerTimerIfRunningAndRecordDuration(unitOfWork);
    } else {

        next = beginWork(current, unitOfWork, entangledRenderLanes);

    }

    unitOfWork.memoizedProps = unitOfWork.pendingProps;
    if (next === null) {
        completeUnitOfWork(unitOfWork);
    } else {
        workInProgress = next;
    }
}


/** 同步工作循环
 * 特点：不进行时间切片，连续执行直到完成
 * 用于高优先级或紧急更新
 */
function workLoopSync() {
    while (workInProgress !== null) {
        performUnitOfWork(workInProgress);
    }
}
/** 同步渲染函数 */
function renderRootSync(
    root: FiberRoot,
    lanes: Lanes,
    shouldYieldForPrerendering: boolean,
): RootExitStatus {
    const prevExecutionContext = executionContext;
    executionContext |= RenderContext;
    const prevDispatcher = pushDispatcher(root.containerInfo);
    const prevAsyncDispatcher = pushAsyncDispatcher();

    if (workInProgressRoot !== root || workInProgressRootRenderLanes !== lanes) {
        if (enableUpdaterTracking) {
            if (isDevToolsPresent) {
                const memoizedUpdaters = root.memoizedUpdaters;
                if (memoizedUpdaters.size > 0) {
                    restorePendingUpdaters(root, workInProgressRootRenderLanes);
                    memoizedUpdaters.clear();
                }

                movePendingFibersToMemoized(root, lanes);
            }
        }

        workInProgressTransitions = getTransitionsForLanes(root, lanes);
        prepareFreshStack(root, lanes);
    }

    if (enableSchedulingProfiler) {
        markRenderStarted(lanes);
    }

    let didSuspendInShell = false;
    let exitStatus = workInProgressRootExitStatus;
    outer: do {
        try {
            if (
                workInProgressSuspendedReason !== NotSuspended &&
                workInProgress !== null
            ) {
                const unitOfWork = workInProgress;
                const thrownValue = workInProgressThrownValue;
                switch (workInProgressSuspendedReason) {
                    case SuspendedOnHydration: {
                        resetWorkInProgressStack();
                        exitStatus = RootSuspendedAtTheShell;
                        break outer;
                    }
                    case SuspendedOnImmediate:
                    case SuspendedOnData:
                    case SuspendedOnAction:
                    case SuspendedOnDeprecatedThrowPromise: {
                        if (getSuspenseHandler() === null) {
                            didSuspendInShell = true;
                        }
                        const reason = workInProgressSuspendedReason;
                        workInProgressSuspendedReason = NotSuspended;
                        workInProgressThrownValue = null;
                        throwAndUnwindWorkLoop(root, unitOfWork, thrownValue, reason);
                        if (
                            enableSiblingPrerendering &&
                            shouldYieldForPrerendering &&
                            workInProgressRootIsPrerendering
                        ) {
                            exitStatus = RootInProgress;
                            break outer;
                        }
                        break;
                    }
                    default: {
                        const reason = workInProgressSuspendedReason;
                        workInProgressSuspendedReason = NotSuspended;
                        workInProgressThrownValue = null;
                        throwAndUnwindWorkLoop(root, unitOfWork, thrownValue, reason);
                        break;
                    }
                }
            }
            workLoopSync();
            exitStatus = workInProgressRootExitStatus;
            break;
        } catch (thrownValue) {
            handleThrow(root, thrownValue);
        }
    } while (true);

    if (didSuspendInShell) {
        root.shellSuspendCounter++;
    }

    resetContextDependencies();

    executionContext = prevExecutionContext;
    popDispatcher(prevDispatcher);
    popAsyncDispatcher(prevAsyncDispatcher);

    if (enableSchedulingProfiler) {
        markRenderStopped();
    }

    if (workInProgress !== null) {
    } else {
        workInProgressRoot = null;
        workInProgressRootRenderLanes = NoLanes;

        finishQueueingConcurrentUpdates();
    }

    return exitStatus;
}