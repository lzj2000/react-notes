function beginWork(
    current: Fiber | null,
    workInProgress: Fiber,
    renderLanes: Lanes,
): Fiber | null {
    if (__DEV__) {
        if (workInProgress._debugNeedsRemount && current !== null) {
            // This will restart the begin phase with a new fiber.
            const copiedFiber = createFiberFromTypeAndProps(
                workInProgress.type,
                workInProgress.key,
                workInProgress.pendingProps,
                workInProgress._debugOwner || null,
                workInProgress.mode,
                workInProgress.lanes,
            );
            copiedFiber._debugStack = workInProgress._debugStack;
            copiedFiber._debugTask = workInProgress._debugTask;
            return remountFiber(current, workInProgress, copiedFiber);
        }
    }

    if (current !== null) {
        const oldProps = current.memoizedProps;
        const newProps = workInProgress.pendingProps;

        if (
            oldProps !== newProps ||
            hasLegacyContextChanged() ||
            // Force a re-render if the implementation changed due to hot reload:
            (__DEV__ ? workInProgress.type !== current.type : false)
        ) {
            // If props or context changed, mark the fiber as having performed work.
            // This may be unset if the props are determined to be equal later (memo).
            didReceiveUpdate = true;
        } else {
            // Neither props nor legacy context changes. Check if there's a pending
            // update or context change.
            const hasScheduledUpdateOrContext = checkScheduledUpdateOrContext(
                current,
                renderLanes,
            );
            if (
                !hasScheduledUpdateOrContext &&
                // If this is the second pass of an error or suspense boundary, there
                // may not be work scheduled on `current`, so we check for this flag.
                (workInProgress.flags & DidCapture) === NoFlags
            ) {
                // No pending updates or context. Bail out now.
                didReceiveUpdate = false;
                return attemptEarlyBailoutIfNoScheduledUpdate(
                    current,
                    workInProgress,
                    renderLanes,
                );
            }
            if ((current.flags & ForceUpdateForLegacySuspense) !== NoFlags) {
                // This is a special case that only exists for legacy mode.
                // See https://github.com/facebook/react/pull/19216.
                didReceiveUpdate = true;
            } else {
                // An update was scheduled on this fiber, but there are no new props
                // nor legacy context. Set this to false. If an update queue or context
                // consumer produces a changed value, it will set this to true. Otherwise,
                // the component will assume the children have not changed and bail out.
                didReceiveUpdate = false;
            }
        }
    } else {
        didReceiveUpdate = false;

        if (getIsHydrating() && isForkedChild(workInProgress)) {
            // Check if this child belongs to a list of muliple children in
            // its parent.
            //
            // In a true multi-threaded implementation, we would render children on
            // parallel threads. This would represent the beginning of a new render
            // thread for this subtree.
            //
            // We only use this for id generation during hydration, which is why the
            // logic is located in this special branch.
            const slotIndex = workInProgress.index;
            const numberOfForks = getForksAtLevel(workInProgress);
            pushTreeId(workInProgress, numberOfForks, slotIndex);
        }
    }

    // Before entering the begin phase, clear pending update priority.
    // TODO: This assumes that we're about to evaluate the component and process
    // the update queue. However, there's an exception: SimpleMemoComponent
    // sometimes bails out later in the begin phase. This indicates that we should
    // move this assignment out of the common path and into each branch.
    workInProgress.lanes = NoLanes;

    switch (workInProgress.tag) {
        case LazyComponent: {
            const elementType = workInProgress.elementType;
            return mountLazyComponent(
                current,
                workInProgress,
                elementType,
                renderLanes,
            );
        }
        case FunctionComponent: {
            const Component = workInProgress.type;
            const unresolvedProps = workInProgress.pendingProps;
            const resolvedProps =
                disableDefaultPropsExceptForClasses ||
                    workInProgress.elementType === Component
                    ? unresolvedProps
                    : resolveDefaultPropsOnNonClassComponent(Component, unresolvedProps);
            return updateFunctionComponent(
                current,
                workInProgress,
                Component,
                resolvedProps,
                renderLanes,
            );
        }
        case ClassComponent: {
            const Component = workInProgress.type;
            const unresolvedProps = workInProgress.pendingProps;
            const resolvedProps = resolveClassComponentProps(
                Component,
                unresolvedProps,
                workInProgress.elementType === Component,
            );
            return updateClassComponent(
                current,
                workInProgress,
                Component,
                resolvedProps,
                renderLanes,
            );
        }
        case HostRoot:
            return updateHostRoot(current, workInProgress, renderLanes);
        case HostHoistable:
            if (supportsResources) {
                return updateHostHoistable(current, workInProgress, renderLanes);
            }
        // Fall through
        case HostSingleton:
            if (supportsSingletons) {
                return updateHostSingleton(current, workInProgress, renderLanes);
            }
        // Fall through
        case HostComponent:
            return updateHostComponent(current, workInProgress, renderLanes);
        case HostText:
            return updateHostText(current, workInProgress);
        case SuspenseComponent:
            return updateSuspenseComponent(current, workInProgress, renderLanes);
        case HostPortal:
            return updatePortalComponent(current, workInProgress, renderLanes);
        case ForwardRef: {
            const type = workInProgress.type;
            const unresolvedProps = workInProgress.pendingProps;
            const resolvedProps =
                disableDefaultPropsExceptForClasses ||
                    workInProgress.elementType === type
                    ? unresolvedProps
                    : resolveDefaultPropsOnNonClassComponent(type, unresolvedProps);
            return updateForwardRef(
                current,
                workInProgress,
                type,
                resolvedProps,
                renderLanes,
            );
        }
        case Fragment:
            return updateFragment(current, workInProgress, renderLanes);
        case Mode:
            return updateMode(current, workInProgress, renderLanes);
        case Profiler:
            return updateProfiler(current, workInProgress, renderLanes);
        case ContextProvider:
            return updateContextProvider(current, workInProgress, renderLanes);
        case ContextConsumer:
            return updateContextConsumer(current, workInProgress, renderLanes);
        case MemoComponent: {
            const type = workInProgress.type;
            const unresolvedProps = workInProgress.pendingProps;
            // Resolve outer props first, then resolve inner props.
            let resolvedProps = disableDefaultPropsExceptForClasses
                ? unresolvedProps
                : resolveDefaultPropsOnNonClassComponent(type, unresolvedProps);
            resolvedProps = disableDefaultPropsExceptForClasses
                ? resolvedProps
                : resolveDefaultPropsOnNonClassComponent(type.type, resolvedProps);
            return updateMemoComponent(
                current,
                workInProgress,
                type,
                resolvedProps,
                renderLanes,
            );
        }
        case SimpleMemoComponent: {
            return updateSimpleMemoComponent(
                current,
                workInProgress,
                workInProgress.type,
                workInProgress.pendingProps,
                renderLanes,
            );
        }
        case IncompleteClassComponent: {
            if (disableLegacyMode) {
                break;
            }
            const Component = workInProgress.type;
            const unresolvedProps = workInProgress.pendingProps;
            const resolvedProps = resolveClassComponentProps(
                Component,
                unresolvedProps,
                workInProgress.elementType === Component,
            );
            return mountIncompleteClassComponent(
                current,
                workInProgress,
                Component,
                resolvedProps,
                renderLanes,
            );
        }
        case IncompleteFunctionComponent: {
            if (disableLegacyMode) {
                break;
            }
            const Component = workInProgress.type;
            const unresolvedProps = workInProgress.pendingProps;
            const resolvedProps = resolveClassComponentProps(
                Component,
                unresolvedProps,
                workInProgress.elementType === Component,
            );
            return mountIncompleteFunctionComponent(
                current,
                workInProgress,
                Component,
                resolvedProps,
                renderLanes,
            );
        }
        case SuspenseListComponent: {
            return updateSuspenseListComponent(current, workInProgress, renderLanes);
        }
        case ScopeComponent: {
            if (enableScopeAPI) {
                return updateScopeComponent(current, workInProgress, renderLanes);
            }
            break;
        }
        case ActivityComponent: {
            return updateActivityComponent(current, workInProgress, renderLanes);
        }
        case OffscreenComponent: {
            return updateOffscreenComponent(current, workInProgress, renderLanes);
        }
        case LegacyHiddenComponent: {
            if (enableLegacyHidden) {
                return updateLegacyHiddenComponent(
                    current,
                    workInProgress,
                    renderLanes,
                );
            }
            break;
        }
        case CacheComponent: {
            return updateCacheComponent(current, workInProgress, renderLanes);
        }
        case TracingMarkerComponent: {
            if (enableTransitionTracing) {
                return updateTracingMarkerComponent(
                    current,
                    workInProgress,
                    renderLanes,
                );
            }
            break;
        }
        case ViewTransitionComponent: {
            if (enableViewTransition) {
                return updateViewTransition(current, workInProgress, renderLanes);
            }
            break;
        }
        case Throw: {
            // This represents a Component that threw in the reconciliation phase.
            // So we'll rethrow here. This might be a Thenable.
            throw workInProgress.pendingProps;
        }
    }

    throw new Error(
        `Unknown unit of work tag (${workInProgress.tag}). This error is likely caused by a bug in ` +
        'React. Please file an issue.',
    );
}

export { beginWork };
