export interface AppDefinition {
  id: string
  name: string
  installScopes: string[]
  permissions: string[]
  credentials: Record<string, string>
}

export interface CommandDefinition {
  name: string
  appId: string
  description?: string
  execute: (ctx: RuntimeContext) => Promise<RuntimeResponse> | RuntimeResponse
}

export interface RuntimeContext {
  appId: string
  serverId: string
  actorId: string
  payload?: Record<string, unknown>
  logger?: {
    error: (...args: unknown[]) => void
  }
}

export interface RuntimeResponse {
  ok: boolean
  message: string
}

export interface EventSubscription {
  appInstallId: string
  appId: string
  eventKey: string
  enabled: boolean
}

export interface RateLimitRule {
  requestsPerMinute: number
}

interface InteractionRecord {
  timestamp: number
}

export class AppInteractionRuntime {
  private commands = new Map<string, CommandDefinition>()
  private subscriptions: EventSubscription[] = []
  private usage = new Map<string, InteractionRecord[]>()

  private commandKey(appId: string, name: string) {
    return `${appId}:${name.trim().toLowerCase()}`
  }

  registerCommand(command: CommandDefinition) {
    const normalized = command.name.trim().toLowerCase()
    this.commands.set(this.commandKey(command.appId, normalized), { ...command, name: normalized })
  }

  subscribeToEvent(subscription: EventSubscription) {
    this.subscriptions = [
      ...this.subscriptions.filter(
        (entry) => !(entry.appInstallId === subscription.appInstallId && entry.eventKey === subscription.eventKey)
      ),
      subscription,
    ]
  }

  getSubscribers(eventKey: string) {
    return this.subscriptions.filter((sub) => sub.eventKey === eventKey && sub.enabled)
  }

  enforceRateLimit(appId: string, rule: RateLimitRule, nowMs = Date.now()) {
    const bucket = this.usage.get(appId) ?? []
    const windowStart = nowMs - 60_000
    const next = bucket.filter((entry) => entry.timestamp >= windowStart)

    if (next.length >= rule.requestsPerMinute) {
      return { allowed: false, remaining: 0 }
    }

    next.push({ timestamp: nowMs })
    this.usage.set(appId, next)

    return {
      allowed: true,
      remaining: Math.max(0, rule.requestsPerMinute - next.length),
    }
  }

  async executeCommand(name: string, context: RuntimeContext, rule?: RateLimitRule) {
    const command = this.commands.get(this.commandKey(context.appId, name))
    if (!command) {
      return { ok: false, message: `Command ${name} is not registered.` }
    }

    if (command.appId !== context.appId) {
      return { ok: false, message: "Command/app mismatch." }
    }

    if (rule) {
      const rate = this.enforceRateLimit(context.appId, rule)
      if (!rate.allowed) {
        return { ok: false, message: "Rate limit exceeded." }
      }
    }

    try {
      return await command.execute(context)
    } catch (error) {
      if (context.logger) {
        context.logger.error("app command failed", { appId: context.appId, error })
      } else {
        console.error("app command failed", { appId: context.appId, error })
      }
      return {
        ok: false,
        message: error instanceof Error ? `App command failed. ${error.message}` : "App command failed.",
      }
    }
  }
}

export function validateInstallPermissions(requested: string[], granted: string[]) {
  return requested.every((permission) => granted.includes(permission))
}

export function redactCredentials(credentials: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(credentials).map(([key]) => [key, "••••••"])
  )
}
