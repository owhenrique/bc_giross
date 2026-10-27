import { pino, type DestinationStream, type Logger } from 'pino';

export function createLogger(level: string, destination?: DestinationStream): Logger {
  return pino({ level, redact: ['req.headers.authorization'] }, destination);
}
