import P from 'pino'

export interface ILogger {
    level: string
    child(obj: object): ILogger
    trace(obj: object, msg?: string): void
    debug(obj: object, msg?: string): void
    info(obj: object, msg?: string): void
    warn(obj: object, msg?: string): void
    error(obj: object, msg?: string): void
    fatal(obj: object, msg?: string): void
}

const transport = P.transport({
	targets: [
		{
			level: 'debug',
			target: 'pino-pretty',
			options: { levelFirst: true, translateTime: true, colorize: true }
		}
	]
})

export default P(transport)
