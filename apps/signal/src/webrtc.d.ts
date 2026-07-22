// WebRTC types used for signaling data passed through from clients.
// These objects are relayed as-is and never constructed server-side.

interface RTCSessionDescriptionInit {
  type: "answer" | "offer" | "pranswer" | "rollback"
  sdp?: string
}

interface RTCIceCandidateInit {
  candidate?: string
  sdpMLineIndex?: number | null
  sdpMid?: string | null
  usernameFragment?: string | null
}
