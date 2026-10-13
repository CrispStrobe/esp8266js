/**
 * ROM stand-ins for the small operating system in the ROM: tasks with event
 * queues, interrupt service routines, exception handlers.
 *
 * Contracts are the ones the SDK's ets_sys.h declares:
 *   ets_task(task, priority, queue, queue length)
 *   ets_post(priority, signal, parameter)   0 = posted, 1 = queue full
 *   ets_run()                               never returns
 *   ets_set_idle_cb(routine, argument)
 *   ets_isr_attach(number, routine, argument), ets_isr_mask / unmask(bit mask)
 *   _xtos_set_exception_handler(cause, handler) -> the previous handler
 * The interrupt and exception entry itself is in rom-hle.ts.
 */
import type { IRomCall, RomFunction, RomResult } from './rom-hle';

/**
 * ets_run: deliver the oldest event of the highest-priority task that has
 * one, forever; with none, call the idle routine if there is one and wait
 * for an interrupt. The event is handed over as a pointer to { signal,
 * parameter } in the task's own queue memory.
 */
function runTasks(c: IRomCall): RomResult {
  const { tasks, idle } = c.state;
  let best = -1;
  for (const [priority, task] of tasks) {
    if (task.events.length && priority > best) best = priority;
  }
  if (best >= 0) {
    const task = tasks.get(best)!;
    const [signal, parameter] = task.events.shift()!;
    c.write32(task.queue, signal);
    c.write32(task.queue + 4, parameter);
    return { callGuest: { fn: task.fn, args: [task.queue], then: () => runTasks(c) } };
  }
  const wait: RomResult = { wait: () => runTasks(c) };
  if (idle.fn) return { callGuest: { fn: idle.fn, args: [idle.arg], then: () => wait } };
  return wait;
}

export const OS_FUNCTIONS: Readonly<Record<string, RomFunction>> = {
  ets_task: (c) => {
    c.state.tasks.set(c.arg(1) & 0xff, {
      fn: c.arg(0),
      queue: c.arg(2),
      length: c.arg(3) & 0xff,
      events: [],
    });
  },
  ets_post_rom: (c) => {
    const task = c.state.tasks.get(c.arg(0) & 0xff);
    if (!task || task.events.length >= task.length) return 1;
    task.events.push([c.arg(1), c.arg(2)]);
    return 0;
  },
  ets_run: (c) => runTasks(c),
  ets_set_idle_cb: (c) => {
    c.state.idle = { fn: c.arg(0), arg: c.arg(1) };
  },

  ets_isr_attach: (c) => {
    c.state.isr.set(c.arg(0), { fn: c.arg(1), arg: c.arg(2) });
  },
  ets_isr_mask: (c) => {
    c.interruptEnable((mask) => mask & ~c.arg(0));
  },
  ets_isr_unmask: (c) => {
    c.interruptEnable((mask) => mask | c.arg(0));
  },
  _xtos_set_exception_handler: (c) => {
    const cause = c.arg(0);
    const previous = c.state.exceptionHandlers.get(cause) ?? 0;
    if (c.arg(1)) c.state.exceptionHandlers.set(cause, c.arg(1));
    else c.state.exceptionHandlers.delete(cause);
    return previous;
  },
};
