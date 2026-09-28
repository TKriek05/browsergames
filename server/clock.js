// Server clock in epoch milliseconds (float, monotonic within the process).
// Clients estimate their offset to this clock via ping/pong.
export const serverNow = () => performance.timeOrigin + performance.now();
