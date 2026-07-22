interface NavigatorUAData {
  platform?: string
}

declare global {
  interface Navigator {
    userAgentData?: NavigatorUAData
  }
}

export {}
