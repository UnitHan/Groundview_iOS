import fs from 'fs/promises';
import path from 'path';

export type Logger = (line: string) => void;

export function createFileLogger(filePath: string): Logger {
  const target = path.resolve(filePath);
  return (line: string) => {
    const dir = path.dirname(target);
    fs.mkdir(dir, { recursive: true }).catch(() => {});
    fs.appendFile(target, `${line}\n`).catch(() => {});
  };
}

export function combineLoggers(...loggers: (Logger | undefined)[]): Logger {
  const active = loggers.filter(Boolean) as Logger[];
  return (line: string) => {
    active.forEach((l) => l(line));
  };
}
