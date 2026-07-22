export function getStatusColor(status?: string) {
  switch (status) {
    case "online":
      return "var(--theme-success)"
    case "idle":
      return "var(--theme-warning)"
    case "dnd":
      return "var(--theme-danger)"
    default:
      return "var(--theme-presence-offline)"
  }
}

export function getStatusLabel(status?: string) {
  switch (status) {
    case "online":
      return "Online"
    case "idle":
      return "Idle"
    case "dnd":
      return "Do Not Disturb"
    case "invisible":
      return "Invisible"
    default:
      return "Offline"
  }
}
