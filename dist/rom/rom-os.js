/**
 * ets_run: deliver the oldest event of the highest-priority task that has
 * one, forever; with none, call the idle routine if there is one and wait
 * for an interrupt. The event is handed over as a pointer to { signal,
 * parameter } in the task's own queue memory.
 */
function runTasks(c) {
    const { tasks, idle } = c.state;
    let best = -1;
    for (const [priority, task] of tasks) {
        if (task.events.length && priority > best)
            best = priority;
    }
    if (best >= 0) {
        const task = tasks.get(best);
        const [signal, parameter] = task.events.shift();
        c.write32(task.queue, signal);
        c.write32(task.queue + 4, parameter);
        return { callGuest: { fn: task.fn, args: [task.queue], then: () => runTasks(c) } };
    }
    const wait = { wait: () => runTasks(c) };
    if (idle.fn)
        return { callGuest: { fn: idle.fn, args: [idle.arg], then: () => wait } };
    return wait;
}
export const OS_FUNCTIONS = {
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
        if (!task || task.events.length >= task.length)
            return 1;
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
        if (c.arg(1))
            c.state.exceptionHandlers.set(cause, c.arg(1));
        else
            c.state.exceptionHandlers.delete(cause);
        return previous;
    },
};
//# sourceMappingURL=rom-os.js.map