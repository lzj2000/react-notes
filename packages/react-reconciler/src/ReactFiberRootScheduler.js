export function ensureRootIsScheduled(root: FiberRoot): void {
    if (root === lastScheduledRoot || root.next !== null) {
    } else {
      if (lastScheduledRoot === null) {
        firstScheduledRoot = lastScheduledRoot = root;
      } else {
        lastScheduledRoot.next = root;
        lastScheduledRoot = root;
      }
    }
  
    mightHavePendingSyncWork = true;
  
    if (__DEV__ && ReactSharedInternals.actQueue !== null) {
      if (!didScheduleMicrotask_act) {
        didScheduleMicrotask_act = true;
        scheduleImmediateRootScheduleTask();
      }
    } else {
      if (!didScheduleMicrotask) {
        didScheduleMicrotask = true;
        scheduleImmediateRootScheduleTask();
      }
    }
  }