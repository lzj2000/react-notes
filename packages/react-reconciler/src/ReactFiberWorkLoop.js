import { enableThrottledScheduling } from "../../shared/ReactFeatureFlags";

// 描述当前 React 执行栈的状态
// ExecutionContext 是一个位掩码类型，用于标记当前 React 所处的执行阶段（如：是否在批量更新中、是否在合成事件处理中、是否在渲染阶段等）
// 初始值为 NoContext，表示当前没有处于特殊的执行上下文
let executionContext: ExecutionContext = NoContext;

// 当前正在处理的 Fiber 根节点
let workInProgressRoot: FiberRoot | null = null;

// 当前正在处理的 Fiber 节点
let workInProgress: Fiber | null = null;

// 当前渲染任务对应的车道集
let workInProgressRootRenderLanes: Lanes = NoLanes;

/**
 * 准备一个新的工作栈（Work Stack），用于开始新一轮的 Fiber 树渲染工作
 * 该函数会重置当前的工作状态，创建新的 workInProgress 树，并初始化各种渲染相关的参数
 *
 * @param {FiberRoot} root - 需要准备工作栈的 Fiber 根节点
 * @param {Lanes} lanes - 当前需要处理的更新车道（优先级）集合
 * @returns {Fiber} - 新创建的根节点对应的 workInProgress Fiber 节点
 */
function prepareFreshStack(root: FiberRoot, lanes: Lanes): Fiber {
  // 清除根节点的超时句柄（如果存在）
  const timeoutHandle = root.timeoutHandle;
  if (timeoutHandle !== noTimeout) {
    root.timeoutHandle = noTimeout;
    cancelTimeout(timeoutHandle);
  }

  // 取消任何 pending 的提交操作（如果存在）
  const cancelPendingCommit = root.cancelPendingCommit;
  if (cancelPendingCommit !== null) {
    root.cancelPendingCommit = null;
    cancelPendingCommit();
  }

  // 重置工作栈状态
  resetWorkInProgressStack();

  // 设置当前工作中的根节点
  workInProgressRoot = root;

  // 基于当前根节点的 current 树创建新的 workInProgress 树
  // workInProgress 树是用于构建新渲染结果的 Fiber 树（双缓存机制）
  const rootWorkInProgress = createWorkInProgress(root.current, null);

  // 设置当前工作中的 Fiber 节点为根节点的 workInProgress
  workInProgress = rootWorkInProgress;

  // 记录当前根节点需要处理的渲染车道
  workInProgressRootRenderLanes = lanes;

  // 初始化挂起原因（默认为未挂起）
  workInProgressSuspendedReason = NotSuspended;

  // 初始化渲染过程中抛出的值（用于错误处理）
  workInProgressThrownValue = null;

  // 标记是否跳过了挂起的兄弟节点
  workInProgressRootDidSkipSuspendedSiblings = false;

  // 标记当前根节点是否处于预渲染状态
  workInProgressRootIsPrerendering = checkIfRootIsPrerendering(root, lanes);

  // 标记是否已附加 ping 监听器（用于 Suspense 恢复）
  workInProgressRootDidAttachPingListener = false;

  // 初始化根节点的退出状态为"进行中"
  workInProgressRootExitStatus = RootInProgress;

  // 记录被跳过的车道
  workInProgressRootSkippedLanes = NoLanes;

  // 记录在渲染过程中交错发生的更新车道
  workInProgressRootInterleavedUpdatedLanes = NoLanes;

  // 记录在渲染阶段发生的更新车道
  workInProgressRootRenderPhaseUpdatedLanes = NoLanes;

  // 记录被 ping 过的车道（用于 Suspense 恢复）
  workInProgressRootPingedLanes = NoLanes;

  // 记录被推迟处理的车道
  workInProgressDeferredLane = NoLane;

  // 记录挂起后需要重试的车道
  workInProgressSuspendedRetryLanes = NoLanes;

  // 记录并发渲染过程中的错误
  workInProgressRootConcurrentErrors = null;

  // 记录可恢复的错误
  workInProgressRootRecoverableErrors = null;

  // 标记是否包含递归渲染更新
  workInProgressRootDidIncludeRecursiveRenderUpdate = false;

  // 获取与当前车道纠缠的车道（用于处理相关联的更新）
  entangledRenderLanes = getEntangledLanes(root, lanes);

  // 完成并发更新的排队工作
  finishQueueingConcurrentUpdates();

  // 返回根节点的 workInProgress Fiber 节点
  return rootWorkInProgress;
}

/**
 * 对指定的 FiberRoot 执行工作（渲染和提交）
 * 这是 React 工作循环中的核心函数，负责协调渲染过程并处理不同的渲染模式
 *
 * @param {FiberRoot} root - 要处理的 Fiber 根节点
 * @param {Lanes} lanes - 需要处理的更新车道（优先级）集合
 * @param {boolean} forceSync - 是否强制同步渲染，忽略时间切片
 */
export function performWorkOnRoot(
  root: FiberRoot,
  lanes: Lanes,
  forceSync: boolean
): void {
  // 检查当前是否已经处于渲染或提交上下文，如果是则抛出错误
  // 确保一次只能有一个工作循环在执行
  if ((executionContext & (RenderContext | CommitContext)) !== NoContext) {
    throw new Error("Should not already be working.");
  }

  // 性能分析相关：如果启用了性能计时器和组件性能跟踪
  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    // 如果存在正在进行的渲染且有工作中的 Fiber 节点
    if (workInProgressRootRenderLanes !== NoLanes && workInProgress !== null) {
      const yieldedFiber = workInProgress;
      const yieldEndTime = now();
      // 根据不同的暂停原因记录不同类型的暂停时间
      switch (yieldReason) {
        case SuspendedOnImmediate:
        case SuspendedOnData:
          logSuspendedYieldTime(yieldStartTime, yieldEndTime, yieldedFiber);
          break;
        case SuspendedOnAction:
          logActionYieldTime(yieldStartTime, yieldEndTime, yieldedFiber);
          break;
        default:
          logYieldTime(yieldStartTime, yieldEndTime);
      }
    }
  }

  // 决定是否应该使用时间切片（并发渲染）
  // 条件：非强制同步、不包含阻塞车道、不包含过期车道，或者处于预渲染状态
  const shouldTimeSlice =
    (!forceSync &&
      !includesBlockingLane(lanes) &&
      !includesExpiredLane(root, lanes)) ||
    (enableSiblingPrerendering && checkIfRootIsPrerendering(root, lanes));

  // 根据是否使用时间切片，选择并发渲染或同步渲染
  let exitStatus = shouldTimeSlice
    ? renderRootConcurrent(root, lanes)
    : renderRootSync(root, lanes, true);

  let renderWasConcurrent = shouldTimeSlice;

  // 处理渲染结果的循环
  do {
    // 如果渲染仍在进行中（RootInProgress）
    if (exitStatus === RootInProgress) {
      // 处理预渲染的特殊情况
      if (
        enableSiblingPrerendering &&
        workInProgressRootIsPrerendering &&
        !shouldTimeSlice
      ) {
        const didAttemptEntireTree = false;
        markRootSuspended(root, lanes, NoLane, didAttemptEntireTree);
      }
      // 启动性能计时器记录暂停时间
      if (enableProfilerTimer && enableComponentPerformanceTrack) {
        startYieldTimer(workInProgressSuspendedReason);
      }
      break;
    } else {
      let renderEndTime = 0;
      // 记录渲染结束时间（性能分析）
      if (enableProfilerTimer && enableComponentPerformanceTrack) {
        renderEndTime = now();
      }
      // 获取完成的工作树（workInProgress 树，current 的替代树）
      const finishedWork: Fiber = (root.current.alternate: any);

      // 检查渲染结果是否与外部存储一致（如 Context、Redux 等）
      if (
        renderWasConcurrent &&
        !isRenderConsistentWithExternalStores(finishedWork)
      ) {
        // 如果不一致，记录性能信息并重新同步渲染
        if (enableProfilerTimer && enableComponentPerformanceTrack) {
          setCurrentTrackFromLanes(lanes);
          logInconsistentRender(renderStartTime, renderEndTime);
          finalizeRender(lanes, renderEndTime);
        }
        exitStatus = renderRootSync(root, lanes, false);
        renderWasConcurrent = false;
        continue;
      }

      // 处理渲染错误的情况（非 Legacy 模式或非 LegacyRoot）
      if (
        (disableLegacyMode || root.tag !== LegacyRoot) &&
        exitStatus === RootErrored
      ) {
        const lanesThatJustErrored = lanes;
        // 获取需要同步重试的车道
        const errorRetryLanes = getLanesToRetrySynchronouslyOnError(
          root,
          lanesThatJustErrored
        );
        // 如果有需要重试的车道
        if (errorRetryLanes !== NoLanes) {
          if (enableProfilerTimer && enableComponentPerformanceTrack) {
            setCurrentTrackFromLanes(lanes);
            logErroredRenderPhase(renderStartTime, renderEndTime, lanes);
            finalizeRender(lanes, renderEndTime);
          }
          lanes = errorRetryLanes;
          // 从并发错误中恢复
          exitStatus = recoverFromConcurrentError(
            root,
            lanesThatJustErrored,
            errorRetryLanes
          );
          renderWasConcurrent = false;
          // 如果恢复成功，继续循环处理新的渲染结果
          if (exitStatus !== RootErrored) {
            continue;
          } else {
            if (enableProfilerTimer && enableComponentPerformanceTrack) {
              renderEndTime = now();
            }
          }
        }
      }

      // 处理致命错误情况
      if (exitStatus === RootFatalErrored) {
        if (enableProfilerTimer && enableComponentPerformanceTrack) {
          setCurrentTrackFromLanes(lanes);
          logErroredRenderPhase(renderStartTime, renderEndTime, lanes);
          finalizeRender(lanes, renderEndTime);
        }
        // 准备新的工作栈，标记根节点为挂起状态
        prepareFreshStack(root, NoLanes);
        const didAttemptEntireTree = true;
        markRootSuspended(root, lanes, NoLane, didAttemptEntireTree);
        break;
      }

      // 完成并发渲染，进入提交阶段
      finishConcurrentRender(
        root,
        exitStatus,
        finishedWork,
        lanes,
        renderEndTime
      );
    }
    break;
  } while (true);

  // 确保根节点被正确调度以处理任何剩余的更新
  ensureRootIsScheduled(root);
}

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
              SuspendedOnError
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
                SuspendedAndReadyToContinue
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
              SuspendedOnInstanceAndReadyToContinue
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
              SuspendedOnDeprecatedThrowPromise
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
              "Unexpected SuspendedReason. This is a bug in React."
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
  }
  // 当渲染任务全部完成（所有 Fiber 节点处理完毕），执行 “状态清理与任务收尾” 逻辑：
  else {
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
// 责处理单个工作单元（Fiber 节点
function performUnitOfWork(unitOfWork: Fiber): void {
  // alternate是对应的另一棵树的节点，这里获取的是当前显示版本的 Fiber 节点
  const current = unitOfWork.alternate;

  let next;
  // 检查是否启用了性能分析器且当前 Fiber 节点处于性能分析模式
  if (enableProfilerTimer && (unitOfWork.mode & ProfileMode) !== NoMode) {
    startProfilerTimer(unitOfWork);

    next = beginWork(current, unitOfWork, entangledRenderLanes);

    stopProfilerTimerIfRunningAndRecordDuration(unitOfWork);
  } else {
    // 根据 Fiber 节点的类型（函数组件、类组件、DOM 节点等）执行相应的处理逻辑
    // 创建或更新子 Fiber 节点
    // 返回下一个要处理的 Fiber 节点
    next = beginWork(current, unitOfWork, entangledRenderLanes);
  }

  // 将待处理的 props（pendingProps）赋值给已处理的 props（memoizedProps）
  unitOfWork.memoizedProps = unitOfWork.pendingProps;
  // 当前节点没有子节点需要处理
  if (next === null) {
    // 调用 completeUnitOfWork 完成当前节点的处理
    // 这通常意味着要开始"归"阶段（complete phase），处理副作用
    completeUnitOfWork(unitOfWork);
  } else {
    // 还有子节点需要处理
    // 将 next 设置为新的 workInProgress
    // 继续"递"阶段（begin phase），处理下一个节点
    workInProgress = next;
  }
}

function completeUnitOfWork(unitOfWork: Fiber): void {
  // 跟踪当前正在完成的工作单元
  let completedWork: Fiber = unitOfWork;
  // 使用 do-while 循环，确保至少执行一次
  // 这个循环会持续处理当前节点及其兄弟节点，直到回到根节点
  do {
    // 检查当前节点是否标记为不完整（通常发生在节点处理过程中出现错误或需要回滚）
    if ((completedWork.flags & Incomplete) !== NoFlags) {
      // 根据 workInProgressRootDidSkipSuspendedSiblings 决定是否跳过兄弟节点
      const skipSiblings = workInProgressRootDidSkipSuspendedSiblings;
      // 回滚当前节点的工作
      unwindUnitOfWork(completedWork, skipSiblings);
      return;
    }

    // 当前显示版本的 Fiber 节点
    const current = completedWork.alternate;
    // 父节点，用于在完成当前节点后向上回溯
    const returnFiber = completedWork.return;

    let next;

    // 创建或更新 DOM 节点，处理副作用（如事件绑定、样式应用），返回下一个需要处理的节点
    next = completeWork(current, completedWork, entangledRenderLanes);

    // 如果 completeWork 返回了下一个节点，设置 workInProgress 并返回
    if (next !== null) {
      workInProgress = next;
      return;
    }

    // 获取兄弟节点
    const siblingFiber = completedWork.sibling;
    if (siblingFiber !== null) {
      // 如果存在兄弟节点，将其设置为下一个工作单元并返回
      workInProgress = siblingFiber;
      return;
    }
    // 回溯到父节点
    completedWork = returnFiber;
    // 更新工作进度
    workInProgress = completedWork;

    // 循环结束：当 completedWork 为 null 时，说明已经回溯到根节点，所有工作完成
  } while (completedWork !== null);

  // 更新根状态，如果当前根节点状态是"处理中"
  if (workInProgressRootExitStatus === RootInProgress) {
    // 将其更新为"已完成"
    workInProgressRootExitStatus = RootCompleted;
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

/**
 * 以同步模式渲染 Fiber 根节点，处理指定车道（Lane）的更新
 * 同步渲染会阻塞主线程，直到所有渲染工作（协调阶段）完成，不支持时间切片（与并发渲染相对）
 * 
 * @param {FiberRoot} root - 需要渲染的 Fiber 根节点（关联 DOM 容器和 Fiber 树）
 * @param {Lanes} lanes - 当前需要处理的更新车道集合（标记更新优先级）
 * @param {boolean} shouldYieldForPrerendering - 预渲染场景下是否允许暂停（仅预渲染特性生效）
 * @returns {RootExitStatus} - 渲染结束后的根节点状态（如完成、挂起、错误等）
 */
function renderRootSync(
  root: FiberRoot,
  lanes: Lanes,
  shouldYieldForPrerendering: boolean
): RootExitStatus {
  // 保存当前执行上下文，后续恢复（执行上下文用于标记 React 当前所处阶段，如 RenderContext/CommitContext）
  const prevExecutionContext = executionContext;
  // 将执行上下文标记为“渲染阶段”，确保后续操作在渲染上下文内执行
  executionContext |= RenderContext;

  // 保存当前的 React 调度器（Dispatcher），并推入根节点对应的容器调度器
  // Dispatcher 用于关联组件与当前根节点的更新逻辑（如 useState/useEffect 的实现）
  const prevDispatcher = pushDispatcher(root.containerInfo);
  // 保存当前的异步调度器，推入新的异步调度器（用于处理异步更新相关逻辑）
  const prevAsyncDispatcher = pushAsyncDispatcher();

  // 检查当前工作中的根节点/车道是否与目标根节点/车道一致
  // 不一致说明需要重新初始化工作栈（如切换渲染目标或优先级变更）
  if (workInProgressRoot !== root || workInProgressRootRenderLanes !== lanes) {
    // 若启用更新追踪（用于 DevTools 或调试）
    if (enableUpdaterTracking) {
      if (isDevToolsPresent) {
        // 获取根节点上缓存的更新器（记录待处理的更新）
        const memoizedUpdaters = root.memoizedUpdaters;
        // 若存在缓存的更新器，恢复这些更新到待处理状态并清空缓存
        if (memoizedUpdaters.size > 0) {
          restorePendingUpdaters(root, workInProgressRootRenderLanes);
          memoizedUpdaters.clear();
        }
        // 将待处理的 Fiber 节点移动到根节点的缓存中，确保更新不丢失
        movePendingFibersToMemoized(root, lanes);
      }
    }

    // 获取当前车道对应的过渡任务（如 useTransition 标记的低优先级更新）
    workInProgressTransitions = getTransitionsForLanes(root, lanes);
    // 准备新的工作栈：重置渲染状态，创建新的 workInProgress 树（基于 current 树）
    prepareFreshStack(root, lanes);
  }

  // 若启用调度分析器（用于性能监控），标记渲染开始并记录当前车道
  if (enableSchedulingProfiler) {
    markRenderStarted(lanes);
  }

  // 标记是否在“壳组件”（如 Suspense 外层容器）中发生挂起
  let didSuspendInShell = false;
  // 初始化渲染退出状态（默认继承当前工作根节点的退出状态，如 RootInProgress）
  let exitStatus = workInProgressRootExitStatus;

  // 外层循环：处理渲染过程中的挂起/错误恢复，支持重试渲染
  outer: do {
    try {
      // 检查当前是否存在挂起状态，且有未处理a的 Fiber 节点
      if (
        workInProgressSuspendedReason !== NotSuspended &&
        workInProgress !== null
      ) {
        // 保存当前正在处理的 Fiber 节点（挂起点）
        const unitOfWork = workInProgress;
        // 保存挂起时抛出的值（如 Suspense 的 Promise）
        const thrownValue = workInProgressThrownValue;

        // 根据挂起原因分类处理
        switch (workInProgressSuspendedReason) {
          //  hydration 过程中挂起（服务端渲染 hydration 时遇到异步依赖）
          case SuspendedOnHydration: {
            // 重置工作栈，放弃当前渲染
            resetWorkInProgressStack();
            // 标记根节点状态为“在壳组件挂起”
            exitStatus = RootSuspendedAtTheShell;
            // 跳出外层循环，结束渲染
            break outer;
          }

          // 即时挂起、数据加载挂起、动作触发挂起、废弃的 Promise 抛出挂起
          case SuspendedOnImmediate:
          case SuspendedOnData:
          case SuspendedOnAction:
          case SuspendedOnDeprecatedThrowPromise: {
            // 若没有 Suspense 处理器（无法处理挂起），标记在壳组件挂起
            if (getSuspenseHandler() === null) {
              didSuspendInShell = true;
            }

            // 保存挂起原因，重置当前挂起状态（避免重复处理）
            const reason = workInProgressSuspendedReason;
            workInProgressSuspendedReason = NotSuspended;
            workInProgressThrownValue = null;

            // 抛出异常并回滚工作循环：清理挂起点之后的 Fiber 节点，准备重试
            throwAndUnwindWorkLoop(root, unitOfWork, thrownValue, reason);

            // 预渲染场景：若允许暂停且当前处于预渲染状态，标记渲染未完成
            if (
              enableSiblingPrerendering &&
              shouldYieldForPrerendering &&
              workInProgressRootIsPrerendering
            ) {
              exitStatus = RootInProgress;
              break outer;
            }
            // 继续循环，重试渲染
            break;
          }

          // 其他未分类的挂起原因
          default: {
            const reason = workInProgressSuspendedReason;
            workInProgressSuspendedReason = NotSuspended;
            workInProgressThrownValue = null;

            // 抛出异常并回滚工作循环
            throwAndUnwindWorkLoop(root, unitOfWork, thrownValue, reason);
            // 继续循环，重试渲染
            break;
          }
        }
      }

      // 执行同步工作循环：从 workInProgress 树的根节点开始，遍历处理所有 Fiber 节点
      // 同步模式下会一次性处理完所有工作，不中断
      workLoopSync();

      // 工作循环结束后，获取最终的渲染退出状态
      exitStatus = workInProgressRootExitStatus;
      // 跳出循环，结束渲染
      break;

    } catch (thrownValue) {
      // 捕获渲染过程中抛出的异常（如未被错误边界处理的错误）
      // 处理异常：标记错误状态，准备错误恢复或终止渲染
      handleThrow(root, thrownValue);
      // 继续循环，尝试从错误中恢复（如错误边界生效后重试）
    }
  } while (true);

  // 若在壳组件中发生挂起，递增根节点的壳挂起计数器（用于 Suspense 相关状态管理）
  if (didSuspendInShell) {
    root.shellSuspendCounter++;
  }

  // 重置上下文依赖（如 useContext 相关的依赖缓存），避免影响后续渲染
  resetContextDependencies();

  // 恢复执行上下文到渲染前的状态
  executionContext = prevExecutionContext;
  // 恢复调度器到渲染前的状态
  popDispatcher(prevDispatcher);
  popAsyncDispatcher(prevAsyncDispatcher);

  // 若启用调度分析器，标记渲染结束
  if (enableSchedulingProfiler) {
    markRenderStopped();
  }

  // 检查工作栈是否处理完成（workInProgress 为 null 表示所有工作已处理）
  if (workInProgress !== null) {
    // 工作未完成（如被挂起或错误）：不清理工作根节点状态，保留现场用于后续恢复
  } else {
    // 工作已完成：清理工作根节点相关状态
    workInProgressRoot = null;
    workInProgressRootRenderLanes = NoLanes;

    // 完成并发更新的排队：将待处理的并发更新合并到正式队列中
    finishQueueingConcurrentUpdates();
  }

  // 返回渲染结束后的根节点状态（如 RootCompleted、RootSuspended、RootErrored 等）
  return exitStatus;
}
