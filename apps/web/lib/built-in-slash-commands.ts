import type { SlashCommand } from "@/hooks/use-slash-command-autocomplete"
import type { Permission } from "@vortex/shared"
import { PERMISSIONS } from "@vortex/shared"

/**
 * Built-in slash commands available in every channel.
 * These map to existing UI features (poll creator, GIF picker, moderation)
 * or insert text shortcuts (shrug, tableflip).
 *
 * Commands with `requiredPermission` are only shown to users who have that
 * permission (or are the server owner / administrator).
 *
 * New commands added here automatically appear in the autocomplete
 * when a user types `/`.
 */

export interface BuiltInSlashCommand extends SlashCommand {
  /** Distinguishes built-in from app commands during execution. */
  builtIn: true
  /** If set, the command only appears for users with this permission (or admin/owner). */
  requiredPermission?: Permission
}

let _nextId = 0
function def(commandName: string, description: string, requiredPermission?: Permission): BuiltInSlashCommand {
  return {
    id: `builtin-${_nextId++}`,
    appId: "builtin",
    appName: "VortexChat",
    commandName,
    description,
    builtIn: true,
    ...(requiredPermission ? { requiredPermission } : {}),
  }
}

/** All built-in commands — call `getAvailableBuiltInCommands` to filter by permissions. */
export const BUILT_IN_SLASH_COMMANDS: BuiltInSlashCommand[] = [
  // --- General (everyone) ---
  def("giphy", "Search for a GIF to send"),
  def("gif", "Search for a GIF to send"),
  def("sticker", "Search for a sticker to send"),
  def("poll", "Create a poll in the current channel"),
  def("thread", "Create a new thread"),
  def("shrug", "Appends ¯\\_(ツ)_/¯ to your message"),
  def("tableflip", "Appends (╯°□°)╯︵ ┻━┻ to your message"),
  def("unflip", "Appends ┬─┬ノ( º _ ºノ) to your message"),
  def("lenny", "Appends ( ͡° ͜ʖ ͡°) to your message"),
  def("spoiler", "Wrap your message in a spoiler tag"),
  def("me", "Send an action message (italic)"),
  def("nick", "Change your nickname in this server"),

  // --- Moderation (permission-gated) ---
  def("kick", "Kick a member from the server", "KICK_MEMBERS"),
  def("ban", "Ban a member from the server", "BAN_MEMBERS"),
  def("unban", "Unban a member from the server", "BAN_MEMBERS"),
  def("timeout", "Timeout a member (prevent them from chatting)", "MODERATE_MEMBERS"),
  def("mute", "Timeout a member for 10 minutes", "MUTE_MEMBERS"),
]

/**
 * Returns the subset of built-in commands the user is allowed to see,
 * based on their effective permission bitmask and owner status.
 */
export function getAvailableBuiltInCommands(
  permissions: number,
  isOwner: boolean,
  hasThread: boolean,
): BuiltInSlashCommand[] {
  const isAdmin = isOwner || !!(permissions & PERMISSIONS.ADMINISTRATOR)
  return BUILT_IN_SLASH_COMMANDS.filter((cmd) => {
    // Filter /thread if thread creation isn't available
    if (cmd.commandName === "thread" && !hasThread) return false
    // No permission required — everyone sees it
    if (!cmd.requiredPermission) return true
    // Admin/owner sees everything
    if (isAdmin) return true
    // Check specific permission
    return !!(permissions & PERMISSIONS[cmd.requiredPermission])
  })
}

/** Text-insertion commands — returns the text to append/replace, or null if not a text command. */
export function getTextInsertionForBuiltIn(commandName: string, args: string): string | null {
  switch (commandName) {
    case "shrug":
      return args ? `${args} ¯\\_(ツ)_/¯` : "¯\\_(ツ)_/¯"
    case "tableflip":
      return args ? `${args} (╯°□°)╯︵ ┻━┻` : "(╯°□°)╯︵ ┻━┻"
    case "unflip":
      return args ? `${args} ┬─┬ノ( º _ ºノ)` : "┬─┬ノ( º _ ºノ)"
    case "lenny":
      return args ? `${args} ( ͡° ͜ʖ ͡°)` : "( ͡° ͜ʖ ͡°)"
    case "spoiler":
      return args ? `||${args}||` : ""
    case "me":
      return args ? `*${args}*` : ""
    default:
      return null
  }
}
