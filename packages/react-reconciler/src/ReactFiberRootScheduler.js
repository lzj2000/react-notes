import { scheduleMicrotask, supportsMicrotasks } from "./ReactFiberConfigDOM";
import { performWorkOnRoot } from "./ReactFiberWorkLoop";
import {
  ImmediatePriority as ImmediateSchedulerPriority,
  scheduleCallback as Scheduler_scheduleCallback,
  now,
} from "./Scheduler";

// 已调度更新的 FiberRoot 链表头节点：存储所有等待处理更新的根节点，形成链表结构
let firstScheduledRoot: FiberRoot | null = null;
// 已调度更新的 FiberRoot 链表尾节点：用于快速追加新的根节点到链表
let lastScheduledRoot: FiberRoot | null = null;

// 标记是否已调度“根节点更新处理”的微任务
let didScheduleMicrotask: boolean = false;
// 是否存在待处理的同步更新标记：用于判断是否需要触发同步更新流程
let mightHavePendingSyncWork: boolean = false;

/**
 * 调度“立即处理根节点更新”的任务
 * 根据环境是否支持微任务，选择不同的调度方式：优先用微任务（高优先级），否则用调度器的立即优先级宏任务
 */
function scheduleImmediateRootScheduleTask() {
  if (supportsMicrotasks) {
    // 环境支持微任务：用微任务调度，确保在当前同步代码后、下一个宏任务前执行
    scheduleMicrotask(() => {
      // 获取当前执行上下文（如渲染阶段、提交阶段）
      const executionContext = getExecutionContext();
      // 若当前处于渲染阶段或提交阶段，避免嵌套执行，改用调度器的立即优先级宏任务
      if ((executionContext & (RenderContext | CommitContext)) !== NoContext) {
        Scheduler_scheduleCallback(
          ImmediateSchedulerPriority, // 立即执行的优先级
          processRootScheduleInImmediateTask // 实际处理根节点更新的回调
        );
        return;
      }
      // 若不在关键阶段，直接在微任务中处理根节点更新
      processRootScheduleInMicrotask();
    });
  } else {
    // 环境不支持微任务：降级用调度器的立即优先级宏任务处理
    Scheduler_scheduleCallback(
      ImmediateSchedulerPriority,
      processRootScheduleInImmediateTask
    );
  }
}

/**
 * 在微任务期间为 FiberRoot 根节点调度更新任务
 * 核心作用：根据当前时间和根节点状态，计算待处理的优先级通道（Lane），
 * 并决定是否需要调度新任务（或复用已有任务），确保更新按优先级有序执行
 *
 * 注意：此函数仅在微任务中或渲染任务末尾（即将让出主线程前）调用，
 * 从不同步执行 React 工作，仅负责“调度”后续执行的任务
 *
 * @param root - 需要调度任务的 FiberRoot 根节点
 * @param currentTime - 当前时间（用于判断更新是否过期、计算优先级）
 * @returns {Lane} - 调度完成后，根节点对应的最高优先级通道；无待处理更新时返回 NoLane
 */
function scheduleTaskForRootDuringMicrotask(
  root: FiberRoot,
  currentTime: number
): Lane {
  // 1. 标记“被饥饿”的优先级通道为过期
  // （“被饥饿”指低优先级更新长期被高优先级更新阻塞，超过阈值后升级为过期，确保最终能被处理）
  markStarvedLanesAsExpired(root, currentTime);

  // 2. 准备计算“下一批待处理的 lanes”所需的上下文变量
  const rootWithPendingPassiveEffects = getRootWithPendingPassiveEffects(); // 有待处理被动副作用（如 useEffect）的根节点
  const pendingPassiveEffectsLanes = getPendingPassiveEffectsLanes(); // 被动副作用对应的优先级通道
  const workInProgressRoot = getWorkInProgressRoot(); // 当前正在构建的 workInProgress 根节点
  const workInProgressRootRenderLanes = getWorkInProgressRootRenderLanes(); // 当前 workInProgress 根节点的渲染通道
  const rootHasPendingCommit = // 判断根节点是否有待提交的更新（如取消提交、超时处理）
    root.cancelPendingCommit !== null || root.timeoutHandle !== noTimeout;

  // 3. 计算当前根节点下一批待处理的 lanes
  const nextLanes =
    enableYieldingBeforePassive && root === rootWithPendingPassiveEffects
      ? // 特殊场景：若支持“被动副作用前让出线程”且当前根节点有待处理被动副作用，
        // 则优先使用被动副作用对应的 lanes（确保副作用相关更新优先调度）
        pendingPassiveEffectsLanes
      : // 常规场景：调用 getNextLanes 计算待处理 lanes（结合 workInProgress 状态和待提交状态）
        getNextLanes(
          root,
          root === workInProgressRoot ? workInProgressRootRenderLanes : NoLanes,
          rootHasPendingCommit
        );

  // 4. 处理“无待处理更新”或“根节点被挂起”的情况
  const existingCallbackNode = root.callbackNode; // 根节点当前已调度的任务节点（若有）
  if (
    nextLanes === NoLane || // 无待处理的优先级通道，无需调度
    // 场景1：根节点处于渲染阶段挂起（等待数据解析，如 Suspense 加载），无需调度渲染任务
    (root === workInProgressRoot && isWorkLoopSuspendedOnData()) ||
    // 场景2：根节点处于提交阶段挂起（有取消提交的标记），无需调度新任务
    root.cancelPendingCommit !== null
  ) {
    // 快速路径：无工作可处理，取消已有的调度任务（若存在）
    if (existingCallbackNode !== null) {
      cancelCallback(existingCallbackNode); // 取消当前已调度的任务
    }
    root.callbackNode = null; // 重置根节点的任务节点标记
    root.callbackPriority = NoLane; // 重置根节点的任务优先级标记
    return NoLane; // 无待处理更新，返回 NoLane
  }

  // 5. 调度新任务（分“同步更新”和“异步更新”两种场景）
  if (
    includesSyncLane(nextLanes) && // 待处理 lanes 包含同步通道（如用户输入触发的同步更新）
    // 排除“预渲染场景”：预渲染时即使是同步 lanes，也需用并发工作循环，避免阻塞主线程
    !(enableSiblingPrerendering && checkIfRootIsPrerendering(root, nextLanes))
  ) {
    // 场景A：同步更新——微任务末尾会自动刷新同步工作，无需额外调度任务
    if (existingCallbackNode !== null) {
      cancelCallback(existingCallbackNode); // 取消已有的异步任务（同步更新无需异步任务）
    }
    root.callbackPriority = SyncLane; // 标记任务优先级为同步通道
    root.callbackNode = null; // 同步更新无需任务节点，重置为 null
    return SyncLane; // 返回同步通道作为结果
  } else {
    // 场景B：异步更新——根据优先级调度对应的异步任务
    const existingCallbackPriority = root.callbackPriority; // 当前已调度任务的优先级
    const newCallbackPriority = getHighestPriorityLane(nextLanes); // 新任务的最高优先级（从待处理 lanes 中取）

    // 5.1 检查是否可复用已有任务（优先级未变化且非 act 测试场景）
    if (
      newCallbackPriority === existingCallbackPriority &&
      // 开发环境特殊处理：若当前处于 act 测试队列，且已有任务不是 act 任务，才需要重新调度
      !(
        __DEV__ &&
        ReactSharedInternals.actQueue !== null &&
        existingCallbackNode !== fakeActCallbackNode
      )
    ) {
      // 优先级未变，可复用已有任务，无需重新调度
      return newCallbackPriority;
    } else {
      // 5.2 优先级变化或需重新调度，先取消已有任务
      if (existingCallbackNode !== null) {
        cancelCallback(existingCallbackNode);
      }
    }

    // 5.3 将 React 优先级（Lane）映射为调度器优先级（Scheduler Priority）
    let schedulerPriorityLevel;
    switch (lanesToEventPriority(nextLanes)) {
      // 离散事件优先级（如点击、输入）和连续事件优先级（如滚动、拖拽）→ 用户阻塞优先级
      case DiscreteEventPriority:
      case ContinuousEventPriority:
        schedulerPriorityLevel = UserBlockingSchedulerPriority;
        break;
      // 默认事件优先级 → 正常优先级
      case DefaultEventPriority:
        schedulerPriorityLevel = NormalSchedulerPriority;
        break;
      // 空闲事件优先级 → 空闲优先级（仅在主线程空闲时执行）
      case IdleEventPriority:
        schedulerPriorityLevel = IdleSchedulerPriority;
        break;
      // 默认 fallback 为正常优先级
      default:
        schedulerPriorityLevel = NormalSchedulerPriority;
        break;
    }

    // 5.4 调度新的异步任务（绑定根节点，任务执行时调用 performWorkOnRootViaSchedulerTask）
    const newCallbackNode = scheduleCallback(
      schedulerPriorityLevel,
      performWorkOnRootViaSchedulerTask.bind(null, root)
    );

    // 5.5 更新根节点的任务状态（记录新任务节点和优先级）
    root.callbackPriority = newCallbackPriority;
    root.callbackNode = newCallbackNode;

    // 返回新任务的最高优先级通道
    return newCallbackPriority;
  }
}

/**
 * 在微任务中处理根节点的更新调度
 * 核心逻辑：遍历所有已调度的根节点，计算每个根节点的待处理 lanes，筛选出需要同步处理的更新，最终触发同步更新
 */
function processRootScheduleInMicrotask() {
  // 重置“已调度微任务”标记：允许后续再次调度微任务
  didScheduleMicrotask = false;

  // 暂时重置“存在待处理同步更新”标记：后续会根据实际情况重新标记
  mightHavePendingSyncWork = false;

  // 同步过渡的 lanes：存储当前事件触发的同步过渡更新（如 Transitions API 触发的同步更新）
  let syncTransitionLanes = NoLanes;
  if (currentEventTransitionLane !== NoLane) {
    // 若当前事件存在过渡 lane，且满足“急切过渡”条件，标记为同步过渡 lanes
    if (shouldAttemptEagerTransition()) {
      syncTransitionLanes = currentEventTransitionLane;
    }
    // 重置当前事件的过渡 lane：避免重复处理
    currentEventTransitionLane = NoLane;
  }

  // 获取当前时间：用于计算更新的过期时间、优先级判断
  const currentTime = now();

  // 遍历已调度的根节点链表，处理每个根节点
  let prev = null; // 链表中当前节点的前一个节点（用于删除节点时维护链表）
  let root = firstScheduledRoot; // 从链表头开始遍历
  while (root !== null) {
    const next = root.next; // 记录下一个根节点，避免遍历中链表结构变化导致丢失
    // 为当前根节点计算“待处理的 lanes”（根据当前时间筛选出需要处理的优先级通道）
    const nextLanes = scheduleTaskForRootDuringMicrotask(root, currentTime);

    if (nextLanes === NoLane) {
      // 若当前根节点没有待处理 lanes，将其从链表中移除（已无更新需要处理）
      root.next = null;
      if (prev === null) {
        // 若当前节点是链表头，更新表头为下一个节点
        firstScheduledRoot = next;
      } else {
        // 若不是表头，将前一个节点的 next 指向后一个节点
        prev.next = next;
      }
      // 若当前节点是链表尾，更新表尾为前一个节点
      if (next === null) {
        lastScheduledRoot = prev;
      }
    } else {
      // 若当前根节点有待处理 lanes，更新 prev 为当前节点（继续遍历）
      prev = root;

      // 判断当前根节点的更新是否需要同步处理：
      // 1. 存在同步过渡 lanes；2. 待处理 lanes 包含同步 lane；3. 是手势触发的渲染更新（如滑动过渡）
      if (
        syncTransitionLanes !== NoLanes ||
        includesSyncLane(nextLanes) ||
        (enableSwipeTransition && isGestureRender(nextLanes))
      ) {
        // 标记存在待处理的同步更新，后续会触发同步更新流程
        mightHavePendingSyncWork = true;
      }
    }
    // 遍历下一个根节点
    root = next;
  }

  // 跨所有根节点触发同步更新处理（传入同步过渡 lanes，不限制仅处理 legacy 根节点）
  flushSyncWorkAcrossRoots_impl(syncTransitionLanes, false);
}

/**
 * 跨所有根节点执行同步更新的核心实现
 * 遍历所有已调度的根节点，检查并执行每个根节点的同步更新，直到无新的同步更新可处理
 * @param syncTransitionLanes - 需要同步处理的过渡 lanes
 * @param onlyLegacy - 是否仅处理 legacy 模式的根节点（区分 Concurrent Mode 和 Legacy Mode）
 */
function flushSyncWorkAcrossRoots_impl(
  syncTransitionLanes: Lanes | Lane,
  onlyLegacy: boolean
) {
  // 若当前已在处理更新流程中，直接返回（避免嵌套处理）
  if (isFlushingWork) {
    return;
  }

  // 若不存在待处理的同步更新，直接返回（无需执行）
  if (!mightHavePendingSyncWork) {
    return;
  }

  let didPerformSomeWork; // 标记本次循环是否执行了更新工作
  isFlushingWork = true; // 标记当前进入更新处理流程
  // 循环处理更新：直到某次循环未执行任何更新（确保所有嵌套触发的同步更新都被处理）
  do {
    didPerformSomeWork = false; // 初始化为“未执行更新”
    let root = firstScheduledRoot; // 从链表头开始遍历所有根节点
    while (root !== null) {
      // 若仅处理 legacy 根节点，且当前根节点不是 legacy 模式，跳过
      if (onlyLegacy && (disableLegacyMode || root.tag !== LegacyRoot)) {
        // 空分支：仅用于条件过滤，满足条件时不处理当前根节点
      } else {
        if (syncTransitionLanes !== NoLanes) {
          // 场景1：存在同步过渡 lanes，获取当前根节点需要同步刷新的 lanes
          const nextLanes = getNextLanesToFlushSync(root, syncTransitionLanes);
          if (nextLanes !== NoLanes) {
            didPerformSomeWork = true; // 标记执行了更新
            performSyncWorkOnRoot(root, nextLanes); // 执行当前根节点的同步更新
          }
        } else {
          // 场景2：无同步过渡 lanes，按常规逻辑筛选待处理 lanes
          // 获取当前正在构建的 workInProgress 根节点（若存在）
          const workInProgressRoot = getWorkInProgressRoot();
          // 获取当前 workInProgress 根节点的渲染 lanes
          const workInProgressRootRenderLanes =
            getWorkInProgressRootRenderLanes();
          // 判断当前根节点是否有待提交的更新（如取消提交、超时处理）
          const rootHasPendingCommit =
            root.cancelPendingCommit !== null ||
            root.timeoutHandle !== noTimeout;
          // 计算当前根节点的下一批待处理 lanes（结合 workInProgress 状态和待提交状态）
          const nextLanes = getNextLanes(
            root,
            root === workInProgressRoot
              ? workInProgressRootRenderLanes
              : NoLanes,
            rootHasPendingCommit
          );
          // 判断是否需要同步处理：包含同步 lane / 是手势渲染更新，且不是预渲染根节点
          if (
            (includesSyncLane(nextLanes) ||
              (enableSwipeTransition && isGestureRender(nextLanes))) &&
            !checkIfRootIsPrerendering(root, nextLanes)
          ) {
            didPerformSomeWork = true; // 标记执行了更新
            performSyncWorkOnRoot(root, nextLanes); // 执行当前根节点的同步更新
          }
        }
      }
      // 遍历下一个根节点
      root = root.next;
    }
  } while (didPerformSomeWork); // 若本次循环执行了更新，继续循环（处理嵌套更新）
  isFlushingWork = false; // 标记更新处理流程结束
}

/**
 * 执行单个根节点的同步更新
 * 先处理待执行的被动副作用（如 useEffect），再调用核心更新函数处理根节点的更新
 * @param root - 需要处理的 FiberRoot 根节点
 * @param lanes - 当前根节点需要处理的优先级 lanes
 */
function performSyncWorkOnRoot(root: FiberRoot, lanes: Lanes) {
  // 先刷新所有待处理的被动副作用（如 useEffect 回调），返回是否执行了副作用
  const didFlushPassiveEffects = flushPendingEffects();
  // 若执行了被动副作用，直接返回（副作用可能已触发新更新，后续会重新调度）
  if (didFlushPassiveEffects) {
    return null;
  }

  // 开发环境：若开启 Profiler 计时器和嵌套更新阶段记录，同步嵌套更新标记
  if (enableProfilerTimer && enableProfilerNestedUpdatePhase) {
    syncNestedUpdateFlag();
  }

  // 标记为“强制同步更新”：跳过并发调度逻辑，直接同步处理更新
  const forceSync = true;

  // 调用核心工作循环函数，处理根节点的更新（传入强制同步标记）
  performWorkOnRoot(root, lanes, forceSync);
}

/**
 * 确保 FiberRoot 根节点被加入调度队列，等待后续处理更新
 * 核心逻辑：将根节点加入调度链表，标记可能存在同步更新，并触发调度任务
 * @param root - 需要调度更新的 FiberRoot 根节点
 */
export function ensureRootIsScheduled(root: FiberRoot): void {
  // 若根节点已在调度链表中（是尾节点或有后续节点），无需重复加入
  if (root === lastScheduledRoot || root.next !== null) {
    // 空分支：已存在于链表，直接返回
  } else {
    // 若根节点不在链表中，将其加入链表尾部
    if (lastScheduledRoot === null) {
      // 链表为空时，根节点既是表头也是表尾
      firstScheduledRoot = lastScheduledRoot = root;
    } else {
      // 链表非空时，将根节点追加到表尾，并更新表尾指针
      lastScheduledRoot.next = root;
      lastScheduledRoot = root;
    }
  }

  // 标记当前可能存在待处理的同步更新（后续会检查是否需要处理）
  mightHavePendingSyncWork = true;

  // 开发环境：若处于 act 测试环境（React 测试工具的批量更新机制）
  if (__DEV__ && ReactSharedInternals.actQueue !== null) {
    // 若尚未调度过微任务，调度微任务并标记
    if (!didScheduleMicrotask_act) {
      didScheduleMicrotask_act = true;
      scheduleImmediateRootScheduleTask();
    }
  } else {
    // 生产环境：若尚未调度过微任务，调度微任务并标记
    if (!didScheduleMicrotask) {
      didScheduleMicrotask = true;
      scheduleImmediateRootScheduleTask();
    }
  }
}
