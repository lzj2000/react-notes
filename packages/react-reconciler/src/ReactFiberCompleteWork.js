function completeWork(
    current: Fiber | null,
    workInProgress: Fiber,
    renderLanes: Lanes,
  ): Fiber | null {
    const newProps = workInProgress.pendingProps;
    // Note: This intentionally doesn't check if we're hydrating because comparing
    // to the current tree provider fiber is just as fast and less error-prone.
    // Ideally we would have a special version of the work loop only
    // for hydration.
    popTreeContext(workInProgress);
    switch (workInProgress.tag) {
      case IncompleteFunctionComponent: {
        if (disableLegacyMode) {
          break;
        }
        // Fallthrough
      }
      case ActivityComponent:
      case LazyComponent:
      case SimpleMemoComponent:
      case FunctionComponent:
      case ForwardRef:
      case Fragment:
      case Mode:
      case Profiler:
      case ContextConsumer:
      case MemoComponent:
        bubbleProperties(workInProgress);
        return null;
      case ClassComponent: {
        const Component = workInProgress.type;
        if (isLegacyContextProvider(Component)) {
          popLegacyContext(workInProgress);
        }
        bubbleProperties(workInProgress);
        return null;
      }
      case HostRoot: {
        const fiberRoot = (workInProgress.stateNode: FiberRoot);
  
        if (enableTransitionTracing) {
          const transitions = getWorkInProgressTransitions();
          // We set the Passive flag here because if there are new transitions,
          // we will need to schedule callbacks and process the transitions,
          // which we do in the passive phase
          if (transitions !== null) {
            workInProgress.flags |= Passive;
          }
        }
  
        let previousCache: Cache | null = null;
        if (current !== null) {
          previousCache = current.memoizedState.cache;
        }
        const cache: Cache = workInProgress.memoizedState.cache;
        if (cache !== previousCache) {
          // Run passive effects to retain/release the cache.
          workInProgress.flags |= Passive;
        }
        popCacheProvider(workInProgress, cache);
  
        if (enableTransitionTracing) {
          popRootMarkerInstance(workInProgress);
        }
  
        popRootTransition(workInProgress, fiberRoot, renderLanes);
        popHostContainer(workInProgress);
        popTopLevelLegacyContextObject(workInProgress);
        if (fiberRoot.pendingContext) {
          fiberRoot.context = fiberRoot.pendingContext;
          fiberRoot.pendingContext = null;
        }
        if (current === null || current.child === null) {
          // If we hydrated, pop so that we can delete any remaining children
          // that weren't hydrated.
          const wasHydrated = popHydrationState(workInProgress);
          if (wasHydrated) {
            emitPendingHydrationWarnings();
            // If we hydrated, then we'll need to schedule an update for
            // the commit side-effects on the root.
            markUpdate(workInProgress);
          } else {
            if (current !== null) {
              const prevState: RootState = current.memoizedState;
              if (
                // Check if this is a client root
                !prevState.isDehydrated ||
                // Check if we reverted to client rendering (e.g. due to an error)
                (workInProgress.flags & ForceClientRender) !== NoFlags
              ) {
                // Schedule an effect to clear this container at the start of the
                // next commit. This handles the case of React rendering into a
                // container with previous children. It's also safe to do for
                // updates too, because current.child would only be null if the
                // previous render was null (so the container would already
                // be empty).
                workInProgress.flags |= Snapshot;
  
                // If this was a forced client render, there may have been
                // recoverable errors during first hydration attempt. If so, add
                // them to a queue so we can log them in the commit phase.
                upgradeHydrationErrorsToRecoverable();
              }
            }
          }
        }
        updateHostContainer(current, workInProgress);
        bubbleProperties(workInProgress);
        if (enableTransitionTracing) {
          if ((workInProgress.subtreeFlags & Visibility) !== NoFlags) {
            // If any of our suspense children toggle visibility, this means that
            // the pending boundaries array needs to be updated, which we only
            // do in the passive phase.
            workInProgress.flags |= Passive;
          }
        }
        return null;
      }
      case HostHoistable: {
        if (supportsResources) {
          // The branching here is more complicated than you might expect because
          // a HostHoistable sometimes corresponds to a Resource and sometimes
          // corresponds to an Instance. It can also switch during an update.
  
          const type = workInProgress.type;
          const nextResource: Resource | null = workInProgress.memoizedState;
          if (current === null) {
            // We are mounting and must Update this Hoistable in this commit
            // @TODO refactor this block to create the instance here in complete
            // phase if we are not hydrating.
            markUpdate(workInProgress);
            if (nextResource !== null) {
              // This is a Hoistable Resource
  
              // This must come at the very end of the complete phase.
              bubbleProperties(workInProgress);
              preloadResourceAndSuspendIfNeeded(
                workInProgress,
                nextResource,
                type,
                newProps,
                renderLanes,
              );
              return null;
            } else {
              // This is a Hoistable Instance
              // This must come at the very end of the complete phase.
              bubbleProperties(workInProgress);
              preloadInstanceAndSuspendIfNeeded(
                workInProgress,
                type,
                newProps,
                renderLanes,
              );
              return null;
            }
          } else {
            // This is an update.
            if (nextResource) {
              // This is a Resource
              if (nextResource !== current.memoizedState) {
                // we have a new Resource. we need to update
                markUpdate(workInProgress);
                // This must come at the very end of the complete phase.
                bubbleProperties(workInProgress);
                // This must come at the very end of the complete phase, because it might
                // throw to suspend, and if the resource immediately loads, the work loop
                // will resume rendering as if the work-in-progress completed. So it must
                // fully complete.
                preloadResourceAndSuspendIfNeeded(
                  workInProgress,
                  nextResource,
                  type,
                  newProps,
                  renderLanes,
                );
                return null;
              } else {
                // This must come at the very end of the complete phase.
                bubbleProperties(workInProgress);
                workInProgress.flags &= ~MaySuspendCommit;
                return null;
              }
            } else {
              // This is an Instance
              // We may have props to update on the Hoistable instance.
              if (supportsMutation) {
                const oldProps = current.memoizedProps;
                if (oldProps !== newProps) {
                  markUpdate(workInProgress);
                }
              } else {
                // We use the updateHostComponent path becuase it produces
                // the update queue we need for Hoistables.
                updateHostComponent(
                  current,
                  workInProgress,
                  type,
                  newProps,
                  renderLanes,
                );
              }
              // This must come at the very end of the complete phase.
              bubbleProperties(workInProgress);
              preloadInstanceAndSuspendIfNeeded(
                workInProgress,
                type,
                newProps,
                renderLanes,
              );
              return null;
            }
          }
        }
        // Fall through
      }
      case HostSingleton: {
        if (supportsSingletons) {
          popHostContext(workInProgress);
          const rootContainerInstance = getRootHostContainer();
          const type = workInProgress.type;
          if (current !== null && workInProgress.stateNode != null) {
            if (supportsMutation) {
              const oldProps = current.memoizedProps;
              if (oldProps !== newProps) {
                markUpdate(workInProgress);
              }
            } else {
              updateHostComponent(
                current,
                workInProgress,
                type,
                newProps,
                renderLanes,
              );
            }
          } else {
            if (!newProps) {
              if (workInProgress.stateNode === null) {
                throw new Error(
                  'We must have new props for new mounts. This error is likely ' +
                    'caused by a bug in React. Please file an issue.',
                );
              }
  
              // This can happen when we abort work.
              bubbleProperties(workInProgress);
              if (enableViewTransition) {
                // Host Components act as their own View Transitions which doesn't run enter/exit animations.
                // We clear any ViewTransitionStatic flag bubbled from inner View Transitions.
                workInProgress.subtreeFlags &= ~ViewTransitionStatic;
              }
              return null;
            }
  
            const currentHostContext = getHostContext();
            const wasHydrated = popHydrationState(workInProgress);
            let instance: Instance;
            if (wasHydrated) {
              // We ignore the boolean indicating there is an updateQueue because
              // it is used only to set text children and HostSingletons do not
              // use them.
              prepareToHydrateHostInstance(workInProgress, currentHostContext);
              instance = workInProgress.stateNode;
            } else {
              instance = resolveSingletonInstance(
                type,
                newProps,
                rootContainerInstance,
                currentHostContext,
                true,
              );
              workInProgress.stateNode = instance;
              markUpdate(workInProgress);
            }
          }
          bubbleProperties(workInProgress);
          if (enableViewTransition) {
            // Host Components act as their own View Transitions which doesn't run enter/exit animations.
            // We clear any ViewTransitionStatic flag bubbled from inner View Transitions.
            workInProgress.subtreeFlags &= ~ViewTransitionStatic;
          }
          return null;
        }
        // Fall through
      }
      case HostComponent: {
        popHostContext(workInProgress);
        const type = workInProgress.type;
        if (current !== null && workInProgress.stateNode != null) {
          updateHostComponent(
            current,
            workInProgress,
            type,
            newProps,
            renderLanes,
          );
        } else {
          if (!newProps) {
            if (workInProgress.stateNode === null) {
              throw new Error(
                'We must have new props for new mounts. This error is likely ' +
                  'caused by a bug in React. Please file an issue.',
              );
            }
  
            // This can happen when we abort work.
            bubbleProperties(workInProgress);
            if (enableViewTransition) {
              // Host Components act as their own View Transitions which doesn't run enter/exit animations.
              // We clear any ViewTransitionStatic flag bubbled from inner View Transitions.
              workInProgress.subtreeFlags &= ~ViewTransitionStatic;
            }
            return null;
          }
  
          const currentHostContext = getHostContext();
          // TODO: Move createInstance to beginWork and keep it on a context
          // "stack" as the parent. Then append children as we go in beginWork
          // or completeWork depending on whether we want to add them top->down or
          // bottom->up. Top->down is faster in IE11.
          const wasHydrated = popHydrationState(workInProgress);
          if (wasHydrated) {
            // TODO: Move this and createInstance step into the beginPhase
            // to consolidate.
            prepareToHydrateHostInstance(workInProgress, currentHostContext);
          } else {
            const rootContainerInstance = getRootHostContainer();
            const instance = createInstance(
              type,
              newProps,
              rootContainerInstance,
              currentHostContext,
              workInProgress,
            );
            // TODO: For persistent renderers, we should pass children as part
            // of the initial instance creation
            markCloned(workInProgress);
            appendAllChildren(instance, workInProgress, false, false);
            workInProgress.stateNode = instance;
  
            // Certain renderers require commit-time effects for initial mount.
            // (eg DOM renderer supports auto-focus for certain elements).
            // Make sure such renderers get scheduled for later work.
            if (
              finalizeInitialChildren(
                instance,
                type,
                newProps,
                currentHostContext,
              )
            ) {
              markUpdate(workInProgress);
            }
          }
        }
        bubbleProperties(workInProgress);
        if (enableViewTransition) {
          // Host Components act as their own View Transitions which doesn't run enter/exit animations.
          // We clear any ViewTransitionStatic flag bubbled from inner View Transitions.
          workInProgress.subtreeFlags &= ~ViewTransitionStatic;
        }
  
        // This must come at the very end of the complete phase, because it might
        // throw to suspend, and if the resource immediately loads, the work loop
        // will resume rendering as if the work-in-progress completed. So it must
        // fully complete.
        preloadInstanceAndSuspendIfNeeded(
          workInProgress,
          workInProgress.type,
          workInProgress.pendingProps,
          renderLanes,
        );
        return null;
      }
      case HostText: {
        const newText = newProps;
        if (current && workInProgress.stateNode != null) {
          const oldText = current.memoizedProps;
          // If we have an alternate, that means this is an update and we need
          // to schedule a side-effect to do the updates.
          updateHostText(current, workInProgress, oldText, newText);
        } else {
          if (typeof newText !== 'string') {
            if (workInProgress.stateNode === null) {
              throw new Error(
                'We must have new props for new mounts. This error is likely ' +
                  'caused by a bug in React. Please file an issue.',
              );
            }
            // This can happen when we abort work.
          }
          const rootContainerInstance = getRootHostContainer();
          const currentHostContext = getHostContext();
          const wasHydrated = popHydrationState(workInProgress);
          if (wasHydrated) {
            prepareToHydrateHostTextInstance(workInProgress);
          } else {
            markCloned(workInProgress);
            workInProgress.stateNode = createTextInstance(
              newText,
              rootContainerInstance,
              currentHostContext,
              workInProgress,
            );
          }
        }
        bubbleProperties(workInProgress);
        return null;
      }
      case SuspenseComponent: {
        const nextState: null | SuspenseState = workInProgress.memoizedState;
  
        // Special path for dehydrated boundaries. We may eventually move this
        // to its own fiber type so that we can add other kinds of hydration
        // boundaries that aren't associated with a Suspense tree. In anticipation
        // of such a refactor, all the hydration logic is contained in
        // this branch.
        if (
          current === null ||
          (current.memoizedState !== null &&
            current.memoizedState.dehydrated !== null)
        ) {
          const fallthroughToNormalSuspensePath =
            completeDehydratedSuspenseBoundary(
              current,
              workInProgress,
              nextState,
            );
          if (!fallthroughToNormalSuspensePath) {
            if (workInProgress.flags & ForceClientRender) {
              popSuspenseHandler(workInProgress);
              // Special case. There were remaining unhydrated nodes. We treat
              // this as a mismatch. Revert to client rendering.
              return workInProgress;
            } else {
              popSuspenseHandler(workInProgress);
              // Did not finish hydrating, either because this is the initial
              // render or because something suspended.
              return null;
            }
          }
  
          // Continue with the normal Suspense path.
        }
  
        popSuspenseHandler(workInProgress);
  
        if ((workInProgress.flags & DidCapture) !== NoFlags) {
          // Something suspended. Re-render with the fallback children.
          workInProgress.lanes = renderLanes;
          // Do not reset the effect list.
          if (
            enableProfilerTimer &&
            (workInProgress.mode & ProfileMode) !== NoMode
          ) {
            transferActualDuration(workInProgress);
          }
          // Don't bubble properties in this case.
          return workInProgress;
        }
  
        const nextDidTimeout = nextState !== null;
        const prevDidTimeout =
          current !== null &&
          (current.memoizedState: null | SuspenseState) !== null;
  
        if (nextDidTimeout) {
          const offscreenFiber: Fiber = (workInProgress.child: any);
          let previousCache: Cache | null = null;
          if (
            offscreenFiber.alternate !== null &&
            offscreenFiber.alternate.memoizedState !== null &&
            offscreenFiber.alternate.memoizedState.cachePool !== null
          ) {
            previousCache = offscreenFiber.alternate.memoizedState.cachePool.pool;
          }
          let cache: Cache | null = null;
          if (
            offscreenFiber.memoizedState !== null &&
            offscreenFiber.memoizedState.cachePool !== null
          ) {
            cache = offscreenFiber.memoizedState.cachePool.pool;
          }
          if (cache !== previousCache) {
            // Run passive effects to retain/release the cache.
            offscreenFiber.flags |= Passive;
          }
        }
  
        // If the suspended state of the boundary changes, we need to schedule
        // a passive effect, which is when we process the transitions
        if (nextDidTimeout !== prevDidTimeout) {
          if (enableTransitionTracing) {
            const offscreenFiber: Fiber = (workInProgress.child: any);
            offscreenFiber.flags |= Passive;
          }
  
          // If the suspended state of the boundary changes, we need to schedule
          // an effect to toggle the subtree's visibility. When we switch from
          // fallback -> primary, the inner Offscreen fiber schedules this effect
          // as part of its normal complete phase. But when we switch from
          // primary -> fallback, the inner Offscreen fiber does not have a complete
          // phase. So we need to schedule its effect here.
          //
          // We also use this flag to connect/disconnect the effects, but the same
          // logic applies: when re-connecting, the Offscreen fiber's complete
          // phase will handle scheduling the effect. It's only when the fallback
          // is active that we have to do anything special.
          if (nextDidTimeout) {
            const offscreenFiber: Fiber = (workInProgress.child: any);
            offscreenFiber.flags |= Visibility;
          }
        }
  
        const retryQueue: RetryQueue | null = (workInProgress.updateQueue: any);
        scheduleRetryEffect(workInProgress, retryQueue);
  
        if (
          enableSuspenseCallback &&
          workInProgress.updateQueue !== null &&
          workInProgress.memoizedProps.suspenseCallback != null
        ) {
          // Always notify the callback
          // TODO: Move to passive phase
          workInProgress.flags |= Update;
        }
        bubbleProperties(workInProgress);
        if (enableProfilerTimer) {
          if ((workInProgress.mode & ProfileMode) !== NoMode) {
            if (nextDidTimeout) {
              // Don't count time spent in a timed out Suspense subtree as part of the base duration.
              const primaryChildFragment = workInProgress.child;
              if (primaryChildFragment !== null) {
                // $FlowFixMe[unsafe-arithmetic] Flow doesn't support type casting in combination with the -= operator
                workInProgress.treeBaseDuration -=
                  ((primaryChildFragment.treeBaseDuration: any): number);
              }
            }
          }
        }
        return null;
      }
      case HostPortal:
        popHostContainer(workInProgress);
        updateHostContainer(current, workInProgress);
        if (current === null) {
          preparePortalMount(workInProgress.stateNode.containerInfo);
        }
        bubbleProperties(workInProgress);
        return null;
      case ContextProvider:
        // Pop provider fiber
        let context: ReactContext<any>;
        if (enableRenderableContext) {
          context = workInProgress.type;
        } else {
          context = workInProgress.type._context;
        }
        popProvider(context, workInProgress);
        bubbleProperties(workInProgress);
        return null;
      case IncompleteClassComponent: {
        if (disableLegacyMode) {
          break;
        }
        // Same as class component case. I put it down here so that the tags are
        // sequential to ensure this switch is compiled to a jump table.
        const Component = workInProgress.type;
        if (isLegacyContextProvider(Component)) {
          popLegacyContext(workInProgress);
        }
        bubbleProperties(workInProgress);
        return null;
      }
      case SuspenseListComponent: {
        popSuspenseListContext(workInProgress);
  
        const renderState: null | SuspenseListRenderState =
          workInProgress.memoizedState;
  
        if (renderState === null) {
          // We're running in the default, "independent" mode.
          // We don't do anything in this mode.
          bubbleProperties(workInProgress);
          return null;
        }
  
        let didSuspendAlready = (workInProgress.flags & DidCapture) !== NoFlags;
  
        const renderedTail = renderState.rendering;
        if (renderedTail === null) {
          // We just rendered the head.
          if (!didSuspendAlready) {
            // This is the first pass. We need to figure out if anything is still
            // suspended in the rendered set.
  
            // If new content unsuspended, but there's still some content that
            // didn't. Then we need to do a second pass that forces everything
            // to keep showing their fallbacks.
  
            // We might be suspended if something in this render pass suspended, or
            // something in the previous committed pass suspended. Otherwise,
            // there's no chance so we can skip the expensive call to
            // findFirstSuspended.
            const cannotBeSuspended =
              renderHasNotSuspendedYet() &&
              (current === null || (current.flags & DidCapture) === NoFlags);
            if (!cannotBeSuspended) {
              let row = workInProgress.child;
              while (row !== null) {
                const suspended = findFirstSuspended(row);
                if (suspended !== null) {
                  didSuspendAlready = true;
                  workInProgress.flags |= DidCapture;
                  cutOffTailIfNeeded(renderState, false);
  
                  // If this is a newly suspended tree, it might not get committed as
                  // part of the second pass. In that case nothing will subscribe to
                  // its thenables. Instead, we'll transfer its thenables to the
                  // SuspenseList so that it can retry if they resolve.
                  // There might be multiple of these in the list but since we're
                  // going to wait for all of them anyway, it doesn't really matter
                  // which ones gets to ping. In theory we could get clever and keep
                  // track of how many dependencies remain but it gets tricky because
                  // in the meantime, we can add/remove/change items and dependencies.
                  // We might bail out of the loop before finding any but that
                  // doesn't matter since that means that the other boundaries that
                  // we did find already has their listeners attached.
                  const retryQueue: RetryQueue | null =
                    (suspended.updateQueue: any);
                  workInProgress.updateQueue = retryQueue;
                  scheduleRetryEffect(workInProgress, retryQueue);
  
                  // Rerender the whole list, but this time, we'll force fallbacks
                  // to stay in place.
                  // Reset the effect flags before doing the second pass since that's now invalid.
                  // Reset the child fibers to their original state.
                  workInProgress.subtreeFlags = NoFlags;
                  resetChildFibers(workInProgress, renderLanes);
  
                  // Set up the Suspense List Context to force suspense and
                  // immediately rerender the children.
                  pushSuspenseListContext(
                    workInProgress,
                    setShallowSuspenseListContext(
                      suspenseStackCursor.current,
                      ForceSuspenseFallback,
                    ),
                  );
                  // Don't bubble properties in this case.
                  return workInProgress.child;
                }
                row = row.sibling;
              }
            }
  
            if (renderState.tail !== null && now() > getRenderTargetTime()) {
              // We have already passed our CPU deadline but we still have rows
              // left in the tail. We'll just give up further attempts to render
              // the main content and only render fallbacks.
              workInProgress.flags |= DidCapture;
              didSuspendAlready = true;
  
              cutOffTailIfNeeded(renderState, false);
  
              // Since nothing actually suspended, there will nothing to ping this
              // to get it started back up to attempt the next item. While in terms
              // of priority this work has the same priority as this current render,
              // it's not part of the same transition once the transition has
              // committed. If it's sync, we still want to yield so that it can be
              // painted. Conceptually, this is really the same as pinging.
              // We can use any RetryLane even if it's the one currently rendering
              // since we're leaving it behind on this node.
              workInProgress.lanes = SomeRetryLane;
            }
          } else {
            cutOffTailIfNeeded(renderState, false);
          }
          // Next we're going to render the tail.
        } else {
          // Append the rendered row to the child list.
          if (!didSuspendAlready) {
            const suspended = findFirstSuspended(renderedTail);
            if (suspended !== null) {
              workInProgress.flags |= DidCapture;
              didSuspendAlready = true;
  
              // Ensure we transfer the update queue to the parent so that it doesn't
              // get lost if this row ends up dropped during a second pass.
              const retryQueue: RetryQueue | null = (suspended.updateQueue: any);
              workInProgress.updateQueue = retryQueue;
              scheduleRetryEffect(workInProgress, retryQueue);
  
              cutOffTailIfNeeded(renderState, true);
              // This might have been modified.
              if (
                renderState.tail === null &&
                renderState.tailMode === 'hidden' &&
                !renderedTail.alternate &&
                !getIsHydrating() // We don't cut it if we're hydrating.
              ) {
                // We're done.
                bubbleProperties(workInProgress);
                return null;
              }
            } else if (
              // The time it took to render last row is greater than the remaining
              // time we have to render. So rendering one more row would likely
              // exceed it.
              now() * 2 - renderState.renderingStartTime >
                getRenderTargetTime() &&
              renderLanes !== OffscreenLane
            ) {
              // We have now passed our CPU deadline and we'll just give up further
              // attempts to render the main content and only render fallbacks.
              // The assumption is that this is usually faster.
              workInProgress.flags |= DidCapture;
              didSuspendAlready = true;
  
              cutOffTailIfNeeded(renderState, false);
  
              // Since nothing actually suspended, there will nothing to ping this
              // to get it started back up to attempt the next item. While in terms
              // of priority this work has the same priority as this current render,
              // it's not part of the same transition once the transition has
              // committed. If it's sync, we still want to yield so that it can be
              // painted. Conceptually, this is really the same as pinging.
              // We can use any RetryLane even if it's the one currently rendering
              // since we're leaving it behind on this node.
              workInProgress.lanes = SomeRetryLane;
            }
          }
          if (renderState.isBackwards) {
            // The effect list of the backwards tail will have been added
            // to the end. This breaks the guarantee that life-cycles fire in
            // sibling order but that isn't a strong guarantee promised by React.
            // Especially since these might also just pop in during future commits.
            // Append to the beginning of the list.
            renderedTail.sibling = workInProgress.child;
            workInProgress.child = renderedTail;
          } else {
            const previousSibling = renderState.last;
            if (previousSibling !== null) {
              previousSibling.sibling = renderedTail;
            } else {
              workInProgress.child = renderedTail;
            }
            renderState.last = renderedTail;
          }
        }
  
        if (renderState.tail !== null) {
          // We still have tail rows to render.
          // Pop a row.
          const next = renderState.tail;
          renderState.rendering = next;
          renderState.tail = next.sibling;
          renderState.renderingStartTime = now();
          next.sibling = null;
  
          // Restore the context.
          // TODO: We can probably just avoid popping it instead and only
          // setting it the first time we go from not suspended to suspended.
          let suspenseContext = suspenseStackCursor.current;
          if (didSuspendAlready) {
            suspenseContext = setShallowSuspenseListContext(
              suspenseContext,
              ForceSuspenseFallback,
            );
          } else {
            suspenseContext =
              setDefaultShallowSuspenseListContext(suspenseContext);
          }
          pushSuspenseListContext(workInProgress, suspenseContext);
          // Do a pass over the next row.
          // Don't bubble properties in this case.
          return next;
        }
        bubbleProperties(workInProgress);
        return null;
      }
      case ScopeComponent: {
        if (enableScopeAPI) {
          if (current === null) {
            const scopeInstance: ReactScopeInstance = createScopeInstance();
            workInProgress.stateNode = scopeInstance;
            prepareScopeUpdate(scopeInstance, workInProgress);
            if (workInProgress.ref !== null) {
              // Scope components always do work in the commit phase if there's a
              // ref attached.
              markUpdate(workInProgress);
            }
          } else {
            if (workInProgress.ref !== null) {
              // Scope components always do work in the commit phase if there's a
              // ref attached.
              markUpdate(workInProgress);
            }
          }
          bubbleProperties(workInProgress);
          return null;
        }
        break;
      }
      case OffscreenComponent:
      case LegacyHiddenComponent: {
        popSuspenseHandler(workInProgress);
        popHiddenContext(workInProgress);
        const nextState: OffscreenState | null = workInProgress.memoizedState;
        const nextIsHidden = nextState !== null;
  
        // Schedule a Visibility effect if the visibility has changed
        if (enableLegacyHidden && workInProgress.tag === LegacyHiddenComponent) {
          // LegacyHidden doesn't do any hiding — it only pre-renders.
        } else {
          if (current !== null) {
            const prevState: OffscreenState | null = current.memoizedState;
            const prevIsHidden = prevState !== null;
            if (prevIsHidden !== nextIsHidden) {
              workInProgress.flags |= Visibility;
            }
          } else {
            // On initial mount, we only need a Visibility effect if the tree
            // is hidden.
            if (nextIsHidden) {
              workInProgress.flags |= Visibility;
            }
          }
        }
  
        if (
          !nextIsHidden ||
          (!disableLegacyMode &&
            (workInProgress.mode & ConcurrentMode) === NoMode)
        ) {
          bubbleProperties(workInProgress);
        } else {
          // Don't bubble properties for hidden children unless we're rendering
          // at offscreen priority.
          if (
            includesSomeLane(renderLanes, (OffscreenLane: Lane)) &&
            // Also don't bubble if the tree suspended
            (workInProgress.flags & DidCapture) === NoLanes
          ) {
            bubbleProperties(workInProgress);
            // Check if there was an insertion or update in the hidden subtree.
            // If so, we need to hide those nodes in the commit phase, so
            // schedule a visibility effect.
            if (
              (!enableLegacyHidden ||
                workInProgress.tag !== LegacyHiddenComponent) &&
              workInProgress.subtreeFlags & (Placement | Update)
            ) {
              workInProgress.flags |= Visibility;
            }
          }
        }
  
        const offscreenQueue: OffscreenQueue | null =
          (workInProgress.updateQueue: any);
        if (offscreenQueue !== null) {
          const retryQueue = offscreenQueue.retryQueue;
          scheduleRetryEffect(workInProgress, retryQueue);
        }
  
        let previousCache: Cache | null = null;
        if (
          current !== null &&
          current.memoizedState !== null &&
          current.memoizedState.cachePool !== null
        ) {
          previousCache = current.memoizedState.cachePool.pool;
        }
        let cache: Cache | null = null;
        if (
          workInProgress.memoizedState !== null &&
          workInProgress.memoizedState.cachePool !== null
        ) {
          cache = workInProgress.memoizedState.cachePool.pool;
        }
        if (cache !== previousCache) {
          // Run passive effects to retain/release the cache.
          workInProgress.flags |= Passive;
        }
  
        popTransition(workInProgress, current);
  
        return null;
      }
      case CacheComponent: {
        let previousCache: Cache | null = null;
        if (current !== null) {
          previousCache = current.memoizedState.cache;
        }
        const cache: Cache = workInProgress.memoizedState.cache;
        if (cache !== previousCache) {
          // Run passive effects to retain/release the cache.
          workInProgress.flags |= Passive;
        }
        popCacheProvider(workInProgress, cache);
        bubbleProperties(workInProgress);
        return null;
      }
      case TracingMarkerComponent: {
        if (enableTransitionTracing) {
          const instance: TracingMarkerInstance | null = workInProgress.stateNode;
          if (instance !== null) {
            popMarkerInstance(workInProgress);
          }
          bubbleProperties(workInProgress);
        }
        return null;
      }
      case ViewTransitionComponent: {
        if (enableViewTransition) {
          // We're a component that might need an exit transition. This flag will
          // bubble up to the parent tree to indicate that there's a child that
          // might need an exit View Transition upon unmount.
          workInProgress.flags |= ViewTransitionStatic;
          bubbleProperties(workInProgress);
        }
        return null;
      }
      case Throw: {
        if (!disableLegacyMode) {
          // Only Legacy Mode completes an errored node.
          return null;
        }
      }
    }
  
    throw new Error(
      `Unknown unit of work tag (${workInProgress.tag}). This error is likely caused by a bug in ` +
        'React. Please file an issue.',
    );
  }
  
  export {completeWork};
  