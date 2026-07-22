import type { SlashCommand } from "@/hooks/use-slash-command-autocomplete"

/**
 * Built-in slash commands available in every DM/group chat.
 * These map to existing UI features (poll creator, GIF picker)
 * or insert text shortcuts (shrug, tableflip).
 *
 * New commands added here automatically appear in the autocomplete
 * when a user types `/`.
 */

export interface BuiltInSlashCommand extends SlashCommand {
  /** Distinguishes built-in from app commands during execution. */
  builtIn: true
}

let _nextId = 0
function def(commandName: string, description: string): BuiltInSlashCommand {
  return {
    id: `builtin-${_nextId++}`,
    appId: "builtin",
    appName: "VortexChat",
    commandName,
    description,
    builtIn: true,
  }
}

/** All built-in commands, available to every user in every DM/group chat. */
export const BUILT_IN_SLASH_COMMANDS: BuiltInSlashCommand[] = [
  def("giphy", "Search for a GIF to send"),
  def("gif", "Search for a GIF to send"),
  def("sticker", "Search for a sticker to send"),
  def("poll", "Create a poll in this conversation"),
  def("shrug", "Appends ¯\\_(ツ)_/¯ to your message"),
  def("tableflip", "Appends (╯°□°)╯︵ ┻━┻ to your message"),
  def("unflip", "Appends ┬─┬ノ( º _ ºノ) to your message"),
  def("lenny", "Appends ( ͡° ͜ʖ ͡°) to your message"),
  def("spoiler", "Wrap your message in a spoiler tag"),
  def("me", "Send an action message (italic)"),
]

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
