/** Unified dangerous file extension list — shared between malware scanning and upload validation. */
export const DANGEROUS_EXTENSIONS = new Set([
  "exe", "dll", "bat", "cmd", "js", "scr", "msi", "jar", "vbs", "ps1", "com", "sh"
])

/** MIME types that indicate executable content. */
export const EXECUTABLE_MIMES = new Set([
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-elf",
  "application/x-executable",
  "application/x-dosexec",
])

/** MIME prefixes that suggest potentially dangerous content. */
export const HIGH_RISK_MIME_PREFIXES = ["application/x-ms", "application/x-dosexec"]
