type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold: Level = (process.env.LOG_LEVEL as Level) || "info";

export function setLogLevel(level: Level): void {
  threshold = level;
}

function write(level: Level, msg: string, data?: Record<string, unknown>): void {
  if (ORDER[level] < ORDER[threshold]) return;
  const line: Record<string, unknown> = { t: new Date().toISOString(), level, msg };
  if (data) {
    for (const [k, v] of Object.entries(data)) {
      line[k] = v instanceof Error ? { name: v.name, message: v.message } : v;
    }
  }
  const out = JSON.stringify(line);
  if (level === "error" || level === "warn") process.stderr.write(out + "\n");
  else process.stdout.write(out + "\n");
}

export const log = {
  debug: (msg: string, data?: Record<string, unknown>) => write("debug", msg, data),
  info: (msg: string, data?: Record<string, unknown>) => write("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => write("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) => write("error", msg, data),
};
