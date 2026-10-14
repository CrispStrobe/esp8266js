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
import type { RomFunction } from './rom-hle';
export declare const OS_FUNCTIONS: Readonly<Record<string, RomFunction>>;
