export const perfUserPrefix = "perf-user";

export const perfUsers = Array.from({ length: 5 }).map((_, index) => ({
  email: `${perfUserPrefix}-${index + 1}@collab-board.local`,
  name: `Performance User ${index + 1}`
}));

export const perfUserPassword = "PerfTestPassword123!";
